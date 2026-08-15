/**
 * Placement-path enumeration compile mode — docs/specs/placement-path-spec.md
 * §2 (path-multiplicative compile). Red-state TDD for Unit 4 of the
 * placement-path chain: the compile-side enumeration (which paths exist),
 * per-path keys, viability, path-derived children, the per-walk cycle guard,
 * and the E2E-2 incremental foundation — RE-PINNED by Unit 5 for the §1.2
 * preference-ordered first-match (only the CHOSEN name's branches enumerate;
 * later names are never consulted) on the R2.2 sibling-shared owner-name
 * topology, plus the chosen-name fan-out and `activePlacement` exposure.
 * The resolve-side first-match pruning, relevance predicate, and per-path
 * component resolution are Unit 5's resolve tests (path-resolve.test.ts);
 * emit is Unit 7.
 *
 * Topologies:
 *  - `staticTree(depth)`: the fork-stress R2.2 sibling-shared owner-name
 *    topology — the L1 prototypes are family children of the root (producers
 *    only); layers ≥ 2 are contentNodes-owned content payload roots carrying
 *    `placementName` (producer/container) + `targetPlacement`
 *    (consumer/'content'). Expected census: 2^depth − 1 path-states.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { makeRoot, makeNode, childOf } from '../helpers/fixtures.js'
import { translateLegacy } from '../../src/core/translate.js'
import type { LegacyInitialData, LegacyNodeData } from '../../src/core/translate.js'
import type { CompiledState } from '../../src/core/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function flushSweep(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** R2.2 sibling-shared owner-name topology via a legacy envelope
 *  (archive/reviews/2026-08-15/2026-08-15-path-fork-review.md R2.2: "both level-(k−1) prototypes own ONE placement
 *  name; both level-k prototypes target it"): L1 prototypes are
 *  template.root.children (family in-tree, producers) sharing ONE zone name;
 *  L2..L(depth−1) are content payload roots (contentNodes-owned) that target
 *  the single shared zone name of the level above (first-match = that name;
 *  the two sibling containers of the chosen name fan out — §1.2, Unit 5).
 *  Census: 2^depth − 1 path-states (Σ 2^k, k=1..depth−1, + root). */
function staticTree(depth: number, opts: { derived?: boolean } = {}): {
  root: Node
  nodes: Node[]
  content: Node[]
} {
  const layers = depth - 1
  const children: LegacyNodeData[] = []
  const payload: LegacyNodeData[] = []
  for (let k = 1; k <= layers; k += 1) {
    for (const slot of ['a', 'b'] as const) {
      const node: LegacyNodeData = {
        type: slot === 'a' ? 'div' : 'span',
        props: { 'stress:layer': k, 'stress:slot': slot, label: `${k}${slot}` },
        css: { style: slot === 'a' ? 'color:red' : 'color:blue' },
        placement: {
          placementName: `zone-${k}`,
          ...(k >= 2 ? { targetPlacement: [`zone-${k - 1}`] } : {}),
        },
        ...(opts.derived
          ? {
              derived: {
                props: {
                  'stress:expanded': {
                    $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true, else: false },
                  },
                },
              },
            }
          : {}),
      }
      if (k === 1) children.push(node)
      else payload.push(node)
    }
  }
  const doc: LegacyInitialData = {
    template: { root: { type: 'app', children } },
    content: [{ content: payload }],
    clientConfig: {},
  }
  const t = translateLegacy(doc)
  return { root: t.root, nodes: t.nodes, content: t.content }
}

function compileAll(tree: { nodes: Node[] }): CompiledState[] {
  const out: CompiledState[] = []
  for (const n of tree.nodes) out.push(...n.compilePath().actionable)
  return out
}

describe('placement-path enumeration — compilePath (P3 §2)', () => {
  it('P-E1 two-zone doc: root containers A/B sharing one name → one state per container path', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({ type: 'div' }, 'A'))
    const B = childOf(root, makeNode({ type: 'div' }, 'B'))
    const slot = new Link({ name: 'placement' })
    A.addAnchor('container', 'slot-a', {}, slot)
    B.addAnchor('container', 'slot-a', {}, slot)
    const C = makeNode({ type: 'button', props: { label: 'go' }, content: 'Go' }, 'C')
    C.addAnchor('content', 'slot-a', {}, slot)

    const cr = C.compilePath()
    expect(cr.actionable).toHaveLength(2)
    const keys = cr.actionable.map(s => s.pathKey).sort()
    // §2.2 template 'root/<zone>/<ownerId>/…/<nodeId>': zone, then its container owner
    expect(keys).toEqual([`root/slot-a/A/C`, `root/slot-a/B/C`].sort())
    for (const cs of cr.actionable) {
      expect(cs.forkKey).toBe(cs.pathKey)
      expect(cs.nodeId).toBe('C')
      expect(cs.parent).not.toBeNull()
      expect(cs.children).toEqual([])
      expect(cs.type).toBe('button')
      expect(cs.props.label).toBe('go')
      expect(cs.content).toBe('Go')
    }
  })

  it('P-E2 fork-stress probe (depth 4): 15 path-states, distinct pathKeys, forkKey = pathKey, path-derived children', () => {
    const t = staticTree(4)
    const [p1a, p1b] = t.root.children
    const [p2a, p2b, p3a, p3b] = t.content
    const all = compileAll(t)

    expect(all).toHaveLength(15)
    const keys = all.map(s => s.pathKey)
    expect(new Set(keys).size).toBe(15)
    for (const cs of all) expect(cs.forkKey).toBe(cs.pathKey)

    const byNode = new Map<string, CompiledState[]>()
    for (const cs of all) {
      const arr = byNode.get(cs.nodeId) ?? []
      arr.push(cs)
      byNode.set(cs.nodeId, arr)
    }
    const keysOf = (n: Node): string[] => byNode.get(n.id)!.map(s => s.pathKey).sort()

    expect(keysOf(t.root)).toEqual(['root'])
    expect(keysOf(p1a!)).toEqual([`root/${p1a!.id}`])
    expect(keysOf(p1b!)).toEqual([`root/${p1b!.id}`])
    // R2.2 sibling-shared name: both zones of the CHOSEN name 'zone-1' fan out
    expect(keysOf(p2a!)).toEqual(
      [`root/zone-1/${p1a!.id}/${p2a!.id}`, `root/zone-1/${p1b!.id}/${p2a!.id}`].sort(),
    )
    expect(keysOf(p2b!)).toEqual(
      [`root/zone-1/${p1a!.id}/${p2b!.id}`, `root/zone-1/${p1b!.id}/${p2b!.id}`].sort(),
    )
    expect(keysOf(p3a!)).toEqual(
      [
        `root/zone-1/${p1a!.id}/zone-2/${p2a!.id}/${p3a!.id}`,
        `root/zone-1/${p1b!.id}/zone-2/${p2a!.id}/${p3a!.id}`,
        `root/zone-1/${p1a!.id}/zone-2/${p2b!.id}/${p3a!.id}`,
        `root/zone-1/${p1b!.id}/zone-2/${p2b!.id}/${p3a!.id}`,
      ].sort(),
    )

    // path-derived children: level-k states carry the level-(k+1) child nodes
    expect(byNode.get(t.root.id)![0]!.children).toEqual([p1a!.id, p1b!.id])
    expect(byNode.get(p1a!.id)![0]!.children).toEqual([p2a!.id, p2b!.id])
    for (const cs of byNode.get(p2a!.id)!) expect(cs.children).toEqual([p3a!.id, p3b!.id])
    for (const cs of byNode.get(p3a!.id)!) expect(cs.children).toEqual([])
  })

  it('P-E2b fork-stress census (depth 12, 23 nodes): 4095 path-states, all distinct, forkKey = pathKey (E2E-1)', () => {
    const t = staticTree(12)
    expect(t.nodes).toHaveLength(23)
    const all = compileAll(t)
    expect(all).toHaveLength(4095)
    expect(new Set(all.map(s => s.pathKey)).size).toBe(4095)
    for (const cs of all) expect(cs.forkKey).toBe(cs.pathKey)
    // leaf layers have zero children; every non-leaf path-state has 2
    for (const cs of all) {
      if (cs.pathKey.startsWith('root/zone-10/')) {
        expect(cs.children).toEqual([])
      }
    }
  })

  it('P-E3 contentNodes-owned family-in-tree nodes with placement paths compile viable, emit-worthy states', () => {
    const t = staticTree(4)
    const p2a = t.content[0]!
    // family fact: the contentNodes permanent-owner token labels it in-tree
    expect(p2a.state).toBe('in-tree')
    const cr = p2a.compilePath()
    expect(cr.actionable).toHaveLength(2)
    for (const cs of cr.actionable) {
      // honest label: the NODE's family-derived state, untouched
      expect(cs.state).toBe('in-tree')
      expect(cs.type).toBe('div')
      expect(cs.props['stress:layer']).toBe(2)
      expect(cs.props.label).toBe('2a')
      expect(cs.css.style).toBe('color:red')
      expect(cs.parent).not.toBeNull()
      expect(cs.forkKey).toBe(cs.pathKey)
      expect(cs.bindings).toEqual({})
      expect(cs.unresolved).toEqual([])
    }
    // the family branch (contentNodes token) drops SILENTLY — no warning
    expect(cr.warnings).toEqual([])
  })

  it('P-E4 placement cycle: the looped arm drops with circular-source; sibling walks unaffected', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({}, 'A'))
    const B = childOf(A, makeNode({}, 'B'))
    const C = childOf(B, makeNode({}, 'C'))
    const z1 = new Link({ name: 'placement' })
    A.addAnchor('container', 'z1', {}, z1)
    B.addAnchor('content', 'z1', {}, z1)
    // B requests z1 then z2; z1's container A is viable → z1 is B's CHOSEN
    // name (§1.2 first-match) — z2 is NEVER consulted on B's OWN compile
    const z2 = new Link({ name: 'placement' })
    C.addAnchor('container', 'z2', {}, z2)
    B.addAnchor('content', 'z2', {}, z2)

    const cr = B.compilePath()
    // family path + the z1 placement path survive; the z2 arm is pruned
    expect(cr.actionable).toHaveLength(2)
    expect(cr.actionable.map(s => s.pathKey).sort()).toEqual([`root/A/B`, `root/z1/A/B`].sort())
    // the CHOSEN name's state carries activePlacement; the family-path state
    // (no placement hop) carries none
    const viaZ1 = cr.actionable.find(s => s.pathKey === `root/z1/A/B`)!
    expect(viaZ1.activePlacement).toBe('z1')
    const viaFamily = cr.actionable.find(s => s.pathKey === `root/A/B`)!
    expect(viaFamily.activePlacement).toBeUndefined()
    // the never-consulted z2 branch is SILENT — no drop, no warning (§1.2)
    expect(cr.dropped).toEqual([])
    expect(cr.warnings).toEqual([])

    // the descendant's own walk continues through B's OWN paths (family AND
    // placement — §2.1 "walk BOTH edge kinds"); C is NOT placement-routed, so
    // its walk from B consults ALL of B's edges — only the z2 arm loops
    const crC = C.compilePath()
    expect(crC.actionable).toHaveLength(2)
    expect(crC.actionable.map(s => s.pathKey).sort()).toEqual([`root/A/B/C`, `root/z1/A/B/C`].sort())
    expect(crC.dropped.filter(d => d.reason === 'loop')).toHaveLength(1)
    expect(crC.warnings.some(w => w.code === 'circular-source')).toBe(true)
    // C's states must NOT claim B as a path child: B's z2 extension would revisit
    expect(crC.actionable[0]!.children).toEqual([])
    expect(crC.actionable[1]!.children).toEqual([])
  })

  it('P-E5 family-only nodes keep the focused-slice compile path unchanged', async () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({ type: 'section' }, 'A'))
    const B = childOf(A, makeNode({}, 'B'))
    const nodes = new Map<string, Node>([[root.id, root], [A.id, A], [B.id, B]])
    const sup = new Supervisor(root, nodes)

    sup.apply({ kind: 'state-slice', node: A, mutation: [{ targetProp: 'content', mode: 'replace', value: 'hi' }] })
    await flushSweep()
    const states = sup.takePass2States().get(A.id)!
    expect(states).toHaveLength(1)
    // unchanged focused-slice surface: family pathKey (root/A), family children
    expect(states[0]!.pathKey).toBe('root/A')
    expect(states[0]!.children).toEqual([B.id])
    expect(states[0]!.content).toBe('hi')
  })

  it('P-E6 derived children.length reads the path-derived children per path-state', () => {
    const t = staticTree(4, { derived: true })
    const p2a = t.content[0]!
    const p3a = t.content[2]!
    const cs2 = p2a.compilePath().actionable[0]!
    const cs3 = p3a.compilePath().actionable[0]!
    expect(cs2.children).toHaveLength(2)
    expect(cs2.props['stress:expanded']).toBe(true)
    expect(cs3.children).toHaveLength(0)
    expect(cs3.props['stress:expanded']).toBe(false)
  })

  it('P-F1 (Unit 5c) first-match fan-out: ALL zones of the chosen name produce instances', () => {
    const t = staticTree(4)
    const [p1a, p1b] = t.root.children
    const p2a = t.content[0]!
    const cr = p2a.compilePath()
    // p2a's single request name 'zone-1' is chosen; its TWO sibling containers
    // (the R2.2 sibling-shared owner name) both produce a path-state
    expect(cr.actionable).toHaveLength(2)
    expect(cr.actionable.map(s => s.pathKey).sort()).toEqual(
      [`root/zone-1/${p1a!.id}/${p2a.id}`, `root/zone-1/${p1b!.id}/${p2a.id}`].sort(),
    )
    // the only drop is p2a's own family branch — the contentNodes token arm
    // (silent, no warning); no loop arms, no non-chosen branches
    expect(cr.dropped).toEqual([{ arm: [p2a.id], reason: 'owner-terminated' }])
    expect(cr.warnings).toEqual([])
  })

  it('P-F2 (Unit 5e) activePlacement: the chosen name is exposed on every path-state', () => {
    const t = staticTree(4)
    // single-name request → the name itself is the chosen name
    for (const cs of t.content[0]!.compilePath().actionable) expect(cs.activePlacement).toBe('zone-1')
    for (const cs of t.content[2]!.compilePath().actionable) expect(cs.activePlacement).toBe('zone-2')
    // non-placement-routed nodes carry NO activePlacement (never authored, §2.5)
    for (const cs of t.root.compilePath().actionable) expect(cs.activePlacement).toBeUndefined()
    for (const cs of t.root.children[0]!.compilePath().actionable) expect(cs.activePlacement).toBeUndefined()
  })

  it('P-E7 E2E-2 foundation: a props mutation on a shallow placement-routed node regenerates ONLY its path-states', async () => {
    const t = staticTree(4)
    const sup = new Supervisor(t.root, new Map(t.nodes.map(n => [n.id, n])))
    const boot: CompiledState[] = []
    for (const n of t.nodes) boot.push(...n.compilePath().actionable)
    sup.recordResolved(boot)

    const p2a = t.content[0]!
    const spyP3a = vi.spyOn(t.content[2]!, 'compilePath')
    const spyP3b = vi.spyOn(t.content[3]!, 'compilePath')
    const spyRoot = vi.spyOn(t.root, 'compilePath')

    const res = sup.apply({ kind: 'state-slice', node: p2a, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'updated' }] })
    expect(res.status).toBe('applied')
    await flushSweep()

    const pass2 = sup.takePass2States()
    expect([...pass2.keys()]).toEqual([p2a.id])
    expect(spyP3a).not.toHaveBeenCalled()
    expect(spyP3b).not.toHaveBeenCalled()
    expect(spyRoot).not.toHaveBeenCalled()
    const arr = pass2.get(p2a.id)!
    expect(arr).toHaveLength(2)
    for (const cs of arr) {
      expect(cs.forkKey).toBe(cs.pathKey)
      expect(cs.props.label).toBe('updated')
      expect(cs.children).toEqual([t.content[2]!.id, t.content[3]!.id])
    }
  })
})

describe('path-enum — seam content delivery in the path scope (blind-test engine defect 2026-08-15)', () => {
  // DEFECT: materializeSeam ran only in compile(slice) (node.ts:956) — the
  // content-target seam layer (ALS-7) never materialized for nodes compiled
  // via compilePath, so a def-carrying content seam rendered empty in the
  // path-enumeration scope (blind-test SED-3 FAIL). Type/children seams are
  // emit-side and path-agnostic; the content seam is graph-side (a layer on
  // the node) — hence scope-bound.
  it('a content-target seam consumer compiled via compilePath carries the def text in its path-states', () => {
    const env: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          component: [
            { reference: 'titleDef', value: { type: 'span', content: 'The def text' } },
          ],
          children: [
            // placement-routed consumer: requests side-zone (multi-zone fan-out)
            {
              type: 'h1',
              placement: [{ targetPlacement: ['side-zone'] }],
              component: [{ target: 'content', reference: 'titleDef' }],
            },
            { type: 'div', placement: [{ placementName: 'side-zone' }], content: 'zone-a', css: { style: { color: 'red' } } },
            { type: 'div', placement: [{ placementName: 'side-zone' }], content: 'zone-b', css: { style: { color: 'blue' } } },
          ],
        },
      },
      content: [],
    }
    const t = translateLegacy(env)
    // compilePath is PER-NODE (the demos loop translated.nodes)
    const states = t.nodes.flatMap((n) => n.compilePath().actionable)
    // the h1 is a family child AND placement-routed → 1 family-first
    // state + path-states for BOTH zones (fan-out) = 3
    const h1States = states.filter((s: CompiledState) => s.nodeId === t.root.children[0]!.id)
    expect(h1States.length).toBe(3)
    expect(h1States.filter((s: CompiledState) => s.activePlacement === 'side-zone')).toHaveLength(2)
    for (const cs of h1States) {
      // the def's text rides every path-state of the content-seam consumer
      expect(cs.content).toBe('The def text')
    }
  })

  it('a family-first content-seam consumer compiled via compilePath also carries the def text', () => {
    const env: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          component: [
            { reference: 'titleDef', value: { type: 'span', content: 'The def text' } },
          ],
          children: [
            { type: 'h1', component: [{ target: 'content', reference: 'titleDef' }] },
          ],
        },
      },
      content: [],
    }
    const t = translateLegacy(env)
    const states = t.nodes.flatMap((n) => n.compilePath().actionable)
    const h1 = states.find((s: CompiledState) => s.nodeId === t.root.children[0]!.id)
    expect(h1).toBeDefined()
    expect(h1!.content).toBe('The def text')
  })
})
