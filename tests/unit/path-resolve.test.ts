/**
 * Unit 5 — resolve-side first-match walk (docs/specs/placement-path-spec.md
 * §1.2 preference-ordered first-match, §2.5 activePlacement, §6.2 resolve
 * rows; Q8 path-only resolution). RED-state TDD: the compile prunes to the
 * CHOSEN name's paths, the relevance predicate decides silent abort, and a
 * path-state's component targets resolve against ITS path ancestors only.
 *
 * Unit 4 enumerated all valid paths; this unit prunes to the chosen name's
 * paths. Trigger-identity plumbing (passing the changed placement link into
 * the compile) is Unit 6 — the seam is exercised through the predicate.
 */
import { describe, it, expect, vi } from 'vitest'
import { Link } from '../../src/core/link.js'
import { makeRoot, makeNode, childOf, makePrototype } from '../helpers/fixtures.js'
import { placementChangeIrrelevant, activePlacementOf } from '../../src/core/resolve.js'
import type { Anchor, CompiledState } from '../../src/core/types.js'

function sourceOn(node: import('../../src/core/node.js').Node, name: string, value: unknown, link: Link): Anchor {
  const a = node.addAnchor('source', name, {}, link)
  if (a === null) throw new Error(`component-source-duplicate: ${node.id} already carries source "${name}"`)
  a.value = value
  return a
}

describe('placement-path resolve-side first-match (P3 §1.2) — Unit 5', () => {
  it('(a) preference pruning: both names have containers → only the CHOSEN name is enumerated', () => {
    const root = makeRoot()
    const P1 = childOf(root, makeNode({}, 'P1'))
    const P2 = childOf(root, makeNode({}, 'P2'))
    const F = childOf(root, makeNode({}, 'F'))
    const pref = new Link({ name: 'placement' })
    const fall = new Link({ name: 'placement' })
    P1.addAnchor('container', 'preferred', {}, pref)
    P2.addAnchor('container', 'preferred', {}, pref)
    F.addAnchor('container', 'fallback', {}, fall)
    const C = makeNode({ type: 'button' }, 'C')
    C.addAnchor('content', 'preferred', {}, pref)
    C.addAnchor('content', 'fallback', {}, fall)

    const cr = C.compilePath()
    // 'preferred' is first in the ordered list and HAS containers → chosen;
    // 'fallback' is NEVER consulted — only preferred's zones fan out
    expect(cr.actionable).toHaveLength(2)
    expect(cr.actionable.map(s => s.pathKey).sort()).toEqual(
      [`root/preferred/P1/C`, `root/preferred/P2/C`].sort(),
    )
    for (const cs of cr.actionable) {
      expect(cs.activePlacement).toBe('preferred')
      expect(cs.forkKey).toBe(cs.pathKey)
    }
    // the pruned name is silent — no dropped arm, no warning (§1.2); the only
    // drop is the unplaced node's own family no-edge walk
    expect(cr.dropped).toEqual([{ arm: [C.id], reason: 'owner-terminated' }])
    expect(cr.warnings).toEqual([])
  })

  it('(b) names without a viable container are skipped; the next name is chosen', () => {
    const root = makeRoot()
    // 'missing' HAS a container — but its owner's walk is non-viable
    // (component token) → no path to root → skipped, not fatal
    const M = makePrototype({}, 'M')
    const presentNode = childOf(root, makeNode({}, 'presentNode'))
    const missLink = new Link({ name: 'placement' })
    const presLink = new Link({ name: 'placement' })
    M.addAnchor('container', 'missing', {}, missLink)
    presentNode.addAnchor('container', 'present', {}, presLink)
    const C = makeNode({}, 'C')
    C.addAnchor('content', 'missing', {}, missLink)
    C.addAnchor('content', 'present', {}, presLink)

    const cr = C.compilePath()
    expect(cr.actionable.map(s => s.pathKey)).toEqual([`root/present/presentNode/C`])
    for (const cs of cr.actionable) expect(cs.activePlacement).toBe('present')
    // the non-viable name's branch is skipped SILENTLY — never a dropped arm
    // (the only drop is the unplaced node's own family no-edge walk)
    expect(cr.dropped).toEqual([{ arm: [C.id], reason: 'owner-terminated' }])
    expect(cr.warnings).toEqual([])

    // whole-array miss: no name has a viable container → nothing forks
    const C2 = makeNode({}, 'C2')
    C2.addAnchor('content', 'missing', {}, missLink)
    C2.addAnchor('content', 'nowhere', {}, new Link({ name: 'placement' }))
    const cr2 = C2.compilePath()
    expect(cr2.actionable).toEqual([])
    expect(cr2.dropped.length).toBeGreaterThan(0)
  })

  it('(d) relevance predicate: less-favored link changes are irrelevant (silent abort decision)', () => {
    const root = makeRoot()
    const P = childOf(root, makeNode({}, 'P'))
    const F = childOf(root, makeNode({}, 'F'))
    const pref = new Link({ name: 'placement' })
    const fall = new Link({ name: 'placement' })
    P.addAnchor('container', 'preferred', {}, pref)
    F.addAnchor('container', 'fallback', {}, fall)
    const C = makeNode({}, 'C')
    C.addAnchor('content', 'preferred', {}, pref)
    C.addAnchor('content', 'fallback', {}, fall)

    const chosen = C.compilePath().actionable[0]!.activePlacement!
    expect(chosen).toBe('preferred')

    // update on a LESS-favored link (ranks below the chosen name) → IRRELEVANT
    expect(placementChangeIrrelevant(C, chosen, 'fallback')).toBe(true)
    // update on the CHOSEN name's link → RELEVANT (regenerate — the instance
    // set or the choice itself can change)
    expect(placementChangeIrrelevant(C, chosen, 'preferred')).toBe(false)
    // update on a MORE-favored link (a container appearing above the choice)
    // → RELEVANT (the choice can flip to it)
    expect(placementChangeIrrelevant(C, 'fallback', 'preferred')).toBe(false)
    // a link the node never requests → conservative: RELEVANT
    expect(placementChangeIrrelevant(C, chosen, 'unrequested')).toBe(false)
    // no satisfied choice yet → a requested-link change is RELEVANT
    expect(placementChangeIrrelevant(C, null, 'preferred')).toBe(false)
    // a non-placement-routed node (no content anchors) → RELEVANT
    expect(placementChangeIrrelevant(P, null, 'preferred')).toBe(false)
  })

  it('(d2) Unit-6 seam: the relevance pre-check gates the compile — abort ⇒ no states, no events', () => {
    const root = makeRoot()
    const P = childOf(root, makeNode({}, 'P'))
    const F = childOf(root, makeNode({}, 'F'))
    const pref = new Link({ name: 'placement' })
    const fall = new Link({ name: 'placement' })
    P.addAnchor('container', 'preferred', {}, pref)
    F.addAnchor('container', 'fallback', {}, fall)
    const C = makeNode({}, 'C')
    C.addAnchor('content', 'preferred', {}, pref)
    C.addAnchor('content', 'fallback', {}, fall)
    const chosen = C.compilePath().actionable[0]!.activePlacement!

    const spy = vi.spyOn(C, 'compilePath')
    // the Unit-6 flow shape: relevance pre-check runs BEFORE node.compile —
    // an irrelevant update never reaches the compile (no regeneration, hence
    // no pass-2 states and no events)
    const decide = (changedLink: string): 'abort' | 'compile' => {
      if (placementChangeIrrelevant(C, chosen, changedLink)) return 'abort'
      C.compilePath()
      return 'compile'
    }

    expect(decide('fallback')).toBe('abort')
    expect(spy).not.toHaveBeenCalled()

    expect(decide('preferred')).toBe('compile')
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('(d3) activePlacementOf: the Unit-6 pre-check reads the last states\' chosen name (skip states without one)', () => {
    const root = makeRoot()
    const P = childOf(root, makeNode({}, 'P'))
    const pref = new Link({ name: 'placement' })
    P.addAnchor('container', 'preferred', {}, pref)
    // family-attached: the walk order is family-first, then placement — the
    // family state carries NO activePlacement and must be skipped
    const C = childOf(root, makeNode({}, 'C'))
    C.addAnchor('content', 'preferred', {}, pref)

    const states = C.compilePath().actionable
    expect(states.some(s => s.activePlacement === undefined)).toBe(true)
    expect(activePlacementOf(states)).toBe('preferred')
    expect(activePlacementOf([])).toBeNull()
    const plain = makeNode({}, 'plain')
    expect(activePlacementOf(plain.compilePath().actionable)).toBeNull()
  })

  it('(e) activePlacement = the chosen name even when it is NOT the first requested', () => {
    const root = makeRoot()
    const presentNode = childOf(root, makeNode({}, 'presentNode'))
    const missLink = new Link({ name: 'placement' })
    const presLink = new Link({ name: 'placement' })
    presentNode.addAnchor('container', 'present', {}, presLink)
    const C = makeNode({}, 'C')
    C.addAnchor('content', 'missing', {}, missLink)
    C.addAnchor('content', 'present', {}, presLink)

    const states = C.compilePath().actionable
    expect(states).toHaveLength(1)
    expect(states[0]!.activePlacement).toBe('present')
    expect(states[0]!.pathKey).toBe(`root/present/presentNode/C`)
  })

  it('(f) per-path component resolution: bindings walk the state\'s OWN path ancestors, never beyond', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({}, 'A'))
    const B = childOf(root, makeNode({}, 'B'))
    const zone = new Link({ name: 'placement' })
    A.addAnchor('container', 'zone-1', {}, zone)
    B.addAnchor('container', 'zone-1', {}, zone)
    const comp = new Link({ name: 'component' })
    sourceOn(A, 'comp', 'from-A', comp)
    const C = makeNode({ type: 'button' }, 'C')
    C.addAnchor('content', 'zone-1', {}, zone)
    C.addAnchor('target', 'comp', {}, comp)
    // own published values seed every path-state alongside the resolution
    sourceOn(C, 'own', 'self', new Link({ name: 'component' }))

    const states: CompiledState[] = C.compilePath().actionable
    expect(states).toHaveLength(2)
    const viaA = states.find(s => s.pathKey === `root/zone-1/A/C`)!
    const viaB = states.find(s => s.pathKey === `root/zone-1/B/C`)!
    // A is ON the A-path → its provider value binds there and only there
    expect(viaA.bindings).toEqual({ comp: 'from-A', own: 'self' })
    expect(viaA.unresolved).toEqual([])
    // the B-path never passes A → the reference stays unresolved on it
    expect(viaB.bindings).toEqual({ own: 'self' })
    expect(viaB.unresolved).toEqual([{ referenceName: 'comp', code: 'unresolved-reference' }])
  })

  it('(g) multi-provider paths: nearest-wins — ≤1 hit per name per path', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({}, 'A'))
    const B = childOf(root, makeNode({}, 'B'))
    const zone = new Link({ name: 'placement' })
    A.addAnchor('container', 'zone-1', {}, zone)
    B.addAnchor('container', 'zone-1', {}, zone)
    const comp = new Link({ name: 'component' })
    sourceOn(A, 'comp', 'from-A', comp)
    // the root is the final hop of EVERY path — a second provider node
    sourceOn(root, 'comp', 'from-root', comp)
    const C = makeNode({}, 'C')
    C.addAnchor('content', 'zone-1', {}, zone)
    C.addAnchor('target', 'comp', {}, comp)

    const states: CompiledState[] = C.compilePath().actionable
    const viaA = states.find(s => s.pathKey === `root/zone-1/A/C`)!
    const viaB = states.find(s => s.pathKey === `root/zone-1/B/C`)!
    // A is nearer than the root on the A-path → ONE hit, the nearest one
    expect(viaA.bindings).toEqual({ comp: 'from-A' })
    expect(viaA.unresolved).toEqual([])
    // the B-path has no A → the root (on the path) provides the single hit
    expect(viaB.bindings).toEqual({ comp: 'from-root' })
    expect(viaB.unresolved).toEqual([])
  })

  it('(g2) own providers resolve before path ancestors (depth-0 first)', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({}, 'A'))
    const zone = new Link({ name: 'placement' })
    A.addAnchor('container', 'zone-1', {}, zone)
    const comp = new Link({ name: 'component' })
    sourceOn(A, 'comp', 'from-A', comp)
    const C = makeNode({}, 'C')
    C.addAnchor('content', 'zone-1', {}, zone)
    C.addAnchor('target', 'comp', {}, comp)
    sourceOn(C, 'comp', 'self', comp)

    const states = C.compilePath().actionable
    expect(states).toHaveLength(1)
    expect(states[0]!.bindings).toEqual({ comp: 'self' })
    expect(states[0]!.unresolved).toEqual([])
  })
})
