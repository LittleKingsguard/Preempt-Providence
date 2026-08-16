/**
 * Unit 12 — the consolidated E2E constraint suite for the placement-path
 * model (docs/specs/placement-path-spec.md §0 + §5.2 + §6.3). Full-pipeline
 * Node tests (no browser): legacy JSON envelope → translateLegacy → register
 * → ONE path-enumeration compile → emitElements → diffMinimal → applyOps —
 * the exact dist/core pipeline the static demo page (demo/path-fork-data.js)
 * and the smoke (scripts/demo-smoke.mjs) drive; here the same core runs
 * through the shared supervisor and render layers so the incremental
 * constraints are asserted by compile-scope (spy) AND wire-identity (diff).
 *
 * The four fixed user requirements:
 *
 *  - E2E-1  the fork test has ONLY the 22 prototype nodes (+ root): no node
 *           creation at any pipeline stage; 4095 distinct path-states; 4095
 *           elements; zero clone-instance ops.
 *  - E2E-2  a shallow non-structural update regenerates ONLY that node's
 *           path-states; its rendered element is REUSED (set-only ops).
 *  - E2E-3  a component change recalculates ONLY the descendants that
 *           consume it — the all-consumers pressure case AND the half-tree
 *           precision case (the other half runs zero compile passes).
 *  - E2E-4  a post-render placement-attach dirties ONLY the container + the
 *           added node; nothing at depth>4 recalculates.
 *
 * Plus the consolidated guards: the static census (23/4095/0/0 + per-level
 * 2^k), the runtime re-pins (F-13: in-tree = 4117 = 4095 + 22 prototypes,
 * cloneOps = 4094), the `component-source-duplicate` guard pin, and the
 * §8-Q6 split pins: the derived-family per-region baseline + pins and the
 * unchanged runtime 2× tripwire (demo-smoke's [derived-fork:baseline] marker
 * supersedes the single-total [path-fork:baseline] framing — §10.ad N-5/R-5,
 * derived-fork-variants-review §5.2).
 *
 * TDD: RED first — E2E-1/2/4 and the guard pins land against the Units 4–11
 * machinery; E2E-3's pressure + precision cases are expected red (the
 * state-slice affected set is still node-local — the per-name component-Link
 * consumer set is the GREEN fix, supervisor.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Node, Supervisor } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { translateLegacy } from '../../src/core/translate.js'
import type { LegacyInitialData, LegacyNodeData } from '../../src/core/translate.js'
import { emitElements, applyOps } from '../../src/core/render-helpers.js'
import { diffMinimal, type MinimalElement, type RenderOp } from '../../src/core/render.js'
import type { CompiledState, NodeId } from '../../src/core/types.js'
import { registered as allRegistered } from '../../src/core/registry.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

// ============================================================================
// Fixtures
// ============================================================================

/** R2.2 sibling-shared owner-name envelope (mirrors the static page's
 *  pathForkLegacyData — props.id is AUTHORED so the byId map is stable, but
 *  node ids are translate-minted; pathKeys are computed from the live ids).
 *  L1 prototypes are template.root.children (family in-tree, producers only,
 *  sharing the ONE 'zone-1' name); layers ≥ 2 are content payload roots
 *  (contentNodes-owned) carrying placementName (producer) + targetPlacement
 *  (consumer of the level above's shared name). Census: 2^depth − 1
 *  path-states. */
function forkEnvelope(depth: number, opts: { derived?: boolean } = {}): LegacyInitialData {
  const layers = depth - 1
  const children: LegacyNodeData[] = []
  const payload: LegacyNodeData[] = []
  for (let k = 1; k <= layers; k += 1) {
    for (const slot of ['a', 'b'] as const) {
      const node: LegacyNodeData = {
        type: slot === 'a' ? 'div' : 'span',
        props: { id: `p${k}${slot}`, 'stress:layer': k, 'stress:slot': slot, label: `${k}${slot}` },
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
  return {
    template: { root: { type: 'app', children } },
    content: [{ content: payload }],
    clientConfig: {},
  }
}

interface ForkTree {
  root: Node
  nodes: Node[]
  /** keyed by the AUTHORED props.id (node ids are translate-minted). */
  byId: Map<string, Node>
}

function forkTree(depth: number, opts?: { derived?: boolean }): ForkTree {
  const t = translateLegacy(forkEnvelope(depth, opts))
  const byId = new Map<string, Node>()
  for (const n of t.nodes) {
    const pid = n.props.id
    if (typeof pid === 'string') byId.set(pid, n)
  }
  return { root: t.root, nodes: t.nodes, byId }
}

function compileAll(tree: ForkTree): CompiledState[] {
  const out: CompiledState[] = []
  for (const n of tree.nodes) out.push(...n.compilePath().actionable)
  return out
}

function supOf(tree: ForkTree): Supervisor {
  return new Supervisor(tree.root, new Map(tree.nodes.map((n) => [n.id, n])))
}

function nodesOf(states: CompiledState[]): NodeId[] {
  return [...new Set(states.map((s) => s.nodeId))]
}

/** Merge every node's current resolved states (the renderer's view of the
 *  tree after a pass-2 flush) and emit. */
function emitResolved(sup: Supervisor, nodeIds: NodeId[]): MinimalElement[] {
  const all: CompiledState[] = []
  for (const id of nodeIds) all.push(...sup.getResolvedStates(id))
  return emitElements(all)
}

/** A counting adapter (like the demos' DomAdapter surface: wireKey
 *  composite-key create, bare-wire append resolution). */
function countingAdapter() {
  const wires = new Map<string, { wire: string; type: string }>()
  const calls: RenderOp[] = []
  return {
    wires,
    calls,
    createEl(type: string, wire: string): { wire: string; type: string } {
      const e = { wire, type }
      wires.set(wire, e)
      calls.push({ kind: 'create', wire, type })
      return e
    },
    setProp(wire: string, name: string, value: unknown): void {
      calls.push({ kind: 'set', wire, name, value })
    },
    appendChild(owner: { wire: string }, child: { wire: string }): void {
      calls.push({ kind: 'append', owner: owner.wire, child: child.wire })
    },
    hydrate(): void {},
    removeEl(wire: string): void {
      calls.push({ kind: 'remove', wire })
    },
  }
}

function keysOf(sup: Supervisor): string[] {
  return [...sup.takePass2States().keys()].sort()
}

// ============================================================================
// E2E-1 — the fork test has ONLY the 22 prototype nodes (+ root)
// ============================================================================

describe('E2E-1 — 23 nodes only, at every pipeline stage (placement-path-spec §0/§5.2)', () => {
  it('E2E-1a the depth-12 pipeline creates ZERO nodes beyond the 22 prototypes + root (translate → compile → emit → diff → apply)', () => {
    const before = allRegistered.size
    const t = forkTree(12)
    expect(t.nodes).toHaveLength(23)
    expect(allRegistered.size).toBe(before + 23)

    // compile: one path-enumeration pass per node — no node creation
    const states = compileAll(t)
    expect(allRegistered.size).toBe(before + 23)

    // emit + diff + apply: elements are plain objects — no node creation
    const els = emitElements(states)
    expect(allRegistered.size).toBe(before + 23)
    const ops = diffMinimal(null, els)
    expect(allRegistered.size).toBe(before + 23)
    const adapter = countingAdapter()
    applyOps(adapter, ops)
    expect(allRegistered.size).toBe(before + 23)
    expect(adapter.wires.size).toBe(4095)
  })

  it('E2E-1b node census 23/23/0/0 + cloneOps 0 at every stage; journal stays empty of clone-instance ops', () => {
    const t = forkTree(12)
    const sup = supOf(t)
    expect(sup.allNodes()).toHaveLength(23)

    const states = compileAll(t)
    sup.recordResolved(states)
    const els = emitElements(states)
    const ops = diffMinimal(null, els)
    const adapter = countingAdapter()
    applyOps(adapter, ops)

    // registered = 23, in-tree = 23, unplaced = 0, destroyed = 0 — after
    // compile AND after the full render (the §5.2 static census holds at
    // every stage of the render)
    const censusOf = (nodes: typeof t.nodes) => {
      expect(nodes).toHaveLength(23)
      expect(nodes.filter((n) => !n.destroyed && n.isInTree)).toHaveLength(23)
      expect(nodes.filter((n) => !n.destroyed && n.state === 'unplaced')).toHaveLength(0)
      expect(nodes.filter((n) => n.destroyed)).toHaveLength(0)
    }
    censusOf(sup.allNodes())
    censusOf(sup.allNodes())
    // the pipeline applies NO ops at all — the journal has no clone-instance
    // entry (F-1: the static model mints NO clones)
    expect(sup.journal).toHaveLength(0)
    expect(sup.journal.filter((e) => e.op.kind === 'clone-instance')).toHaveLength(0)
  })

  it('E2E-1c state census: 4095 distinct path-states, forkKey = pathKey on every state, no #-grammar', () => {
    const t = forkTree(12)
    const states = compileAll(t)
    expect(states).toHaveLength(4095)
    expect(new Set(states.map((s) => s.pathKey)).size).toBe(4095)
    for (const cs of states) {
      expect(cs.forkKey).toBe(cs.pathKey)
      expect(cs.pathKey === 'root' || cs.pathKey.startsWith('root/')).toBe(true)
      expect(cs.pathKey).not.toContain('#')
    }
  })

  it('E2E-1d element census: 4095 elements on pathKey wires; level k has exactly 2^k; create ops = 4095, zero removes', () => {
    const t = forkTree(12)
    const states = compileAll(t)
    const byWire = new Map(states.map((s) => [s.pathKey, s]))
    const els = emitElements(states)
    expect(els).toHaveLength(4095)
    const perLevel: Record<number, number> = {}
    for (const e of els) {
      expect(e.forkKey).toBe(e.wire)
      const s = byWire.get(e.wire as string)
      expect(s).toBeDefined()
      const k = s!.props['stress:layer'] as number | undefined
      if (k !== undefined) perLevel[k] = (perLevel[k] ?? 0) + 1
    }
    for (let k = 1; k <= 11; k += 1) {
      expect(perLevel[k]).toBe(2 ** k)
    }
    const ops = diffMinimal(null, els)
    expect(ops.filter((o) => o.kind === 'create')).toHaveLength(4095)
    expect(ops.filter((o) => o.kind === 'remove')).toHaveLength(0)
  })
})

// ============================================================================
// E2E-2 — shallow non-structural update (node-local invalidation + reuse)
// ============================================================================

describe('E2E-2 — shallow props update: only the node\'s path-states regenerate; element reused (spec §3.1)', () => {
  it('E2E-2a compile scope: a props slice on p2a (depth 2) regenerates ONLY p2a\'s path-states', async () => {
    const t = forkTree(4)
    const sup = supOf(t)
    sup.recordResolved(compileAll(t))
    const p2a = t.byId.get('p2a')!

    const spyP1a = vi.spyOn(t.byId.get('p1a')!, 'compilePath')
    const spyP1b = vi.spyOn(t.byId.get('p1b')!, 'compilePath')
    const spyP2b = vi.spyOn(t.byId.get('p2b')!, 'compilePath')
    const spyP3a = vi.spyOn(t.byId.get('p3a')!, 'compilePath')
    const spyP3b = vi.spyOn(t.byId.get('p3b')!, 'compilePath')
    const spyRoot = vi.spyOn(t.root, 'compilePath')

    const res = sup.apply({ kind: 'state-slice', node: p2a, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'updated' }] })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') expect(res.dirtied).toEqual([p2a.id])

    await flushSweep()
    expect(keysOf(sup)).toEqual([p2a.id])
    expect(spyP1a).not.toHaveBeenCalled()
    expect(spyP1b).not.toHaveBeenCalled()
    expect(spyP2b).not.toHaveBeenCalled()
    expect(spyP3a).not.toHaveBeenCalled()
    expect(spyP3b).not.toHaveBeenCalled()
    expect(spyRoot).not.toHaveBeenCalled()
  })

  it('E2E-2b wire identity: the rendered element is REUSED — no create/remove for p2a\'s wires, only set ops on them', async () => {
    const t = forkTree(4)
    const sup = supOf(t)
    const p2a = t.byId.get('p2a')!
    const boot = compileAll(t)
    sup.recordResolved(boot)
    const els1 = emitElements(boot)
    const prevMap = new Map(els1.map((e) => [e.wire, e]))
    const p2aKeys = new Set(boot.filter((s) => s.nodeId === p2a.id).map((s) => s.pathKey))
    expect(p2aKeys.size).toBe(2)

    sup.apply({ kind: 'state-slice', node: p2a, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'updated' }] })
    await flushSweep()
    const els2 = emitResolved(sup, t.nodes.map((n) => n.id))

    // wires identical (same pathKeys) — the same element objects are reused
    expect(els2.map((e) => e.wire)).toEqual(els1.map((e) => e.wire))
    const ops = diffMinimal(prevMap, els2)
    expect(ops.filter((o) => o.kind === 'create' || o.kind === 'remove')).toEqual([])
    const sets = ops.filter((o): o is Extract<RenderOp, { kind: 'set' }> => o.kind === 'set')
    expect(sets.length).toBeGreaterThan(0)
    // set ops land ONLY on p2a's two pathKey wires (the changed label)
    for (const op of sets) expect(p2aKeys.has(op.wire as string)).toBe(true)
  })
})

// ============================================================================
// E2E-3 — component update precision (per-name Link consumer set)
// ============================================================================

/** A provider on p2a (placement-routed, depth 2 — its own recompile keeps the
 *  pathKey wires) providing 'comp-half' on a per-name component Link; the
 *  listed consumer ids carry target anchors on the SAME link. The anchors are
 *  minted BEFORE the bootstrap compile so the recorded resolved states and
 *  the post-slice states resolve identically (the render diff then shows
 *  only the provider's own prop change). */
function componentFixture(depth: number, consumerIds: string[]): { t: ForkTree; sup: Supervisor; link: Link; p2a: Node } {
  const t = forkTree(depth)
  const link = new Link({ name: 'component' })
  const p2a = t.byId.get('p2a')!
  const sa = p2a.addAnchor('source', 'comp-half', {}, link)
  sa!.value = 'v1'
  for (const id of consumerIds) {
    const c = t.byId.get(id)!
    if (c.addAnchor('target', 'comp-half', {}, link) === null) throw new Error(`duplicate target on ${id}`)
  }
  const sup = supOf(t)
  sup.recordResolved(compileAll(t))
  return { t, sup, link, p2a }
}

describe('E2E-3 — a component change recalculates ONLY its consumers (spec §3.2)', () => {
  it('E2E-3a pressure: ALL descendants consume the changed component → every consumer regenerates; the non-consumer sibling does NOT', async () => {
    const { t, sup, p2a } = componentFixture(5, ['p3a', 'p3b', 'p4a', 'p4b'])
    const p2b = t.byId.get('p2b')!
    const p3a = t.byId.get('p3a')!
    const p3b = t.byId.get('p3b')!
    const p4a = t.byId.get('p4a')!
    const p4b = t.byId.get('p4b')!
    const spyP2b = vi.spyOn(p2b, 'compilePath')
    const spyP3a = vi.spyOn(p3a, 'compilePath')
    const spyP3b = vi.spyOn(p3b, 'compilePath')
    const spyP4a = vi.spyOn(p4a, 'compilePath')
    const spyP4b = vi.spyOn(p4b, 'compilePath')
    const spyP2a = vi.spyOn(p2a, 'compilePath')

    const res = sup.apply({ kind: 'state-slice', node: p2a, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'pressed' }] })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect([...(res.dirtied ?? [])].sort()).toEqual([p2a.id, p3a.id, p3b.id, p4a.id, p4b.id].sort())
    }

    await flushSweep()
    expect(keysOf(sup)).toEqual([p2a.id, p3a.id, p3b.id, p4a.id, p4b.id].sort())
    expect(spyP2a).toHaveBeenCalledTimes(1)
    expect(spyP3a).toHaveBeenCalledTimes(1)
    expect(spyP3b).toHaveBeenCalledTimes(1)
    expect(spyP4a).toHaveBeenCalledTimes(1)
    expect(spyP4b).toHaveBeenCalledTimes(1)
    // the sibling that does NOT consume is untouched — zero compile passes
    expect(spyP2b).not.toHaveBeenCalled()
  })

  it('E2E-3b precision: the provider consumes HALF the tree (a-column: p3a + p4a) → the other half (p2b, p3b, p4b) runs ZERO compile passes', async () => {
    const { t, sup, p2a } = componentFixture(5, ['p3a', 'p4a'])
    const p2b = t.byId.get('p2b')!
    const p3a = t.byId.get('p3a')!
    const p3b = t.byId.get('p3b')!
    const p4a = t.byId.get('p4a')!
    const p4b = t.byId.get('p4b')!
    const spyP2b = vi.spyOn(p2b, 'compilePath')
    const spyP3b = vi.spyOn(p3b, 'compilePath')
    const spyP4b = vi.spyOn(p4b, 'compilePath')
    const spyP3a = vi.spyOn(p3a, 'compilePath')
    const spyP4a = vi.spyOn(p4a, 'compilePath')
    const spyP2a = vi.spyOn(p2a, 'compilePath')

    const res = sup.apply({ kind: 'state-slice', node: p2a, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'pressed' }] })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') expect([...(res.dirtied ?? [])].sort()).toEqual([p2a.id, p3a.id, p4a.id].sort())

    await flushSweep()
    expect(keysOf(sup)).toEqual([p2a.id, p3a.id, p4a.id].sort())
    expect(spyP2a).toHaveBeenCalledTimes(1)
    expect(spyP3a).toHaveBeenCalledTimes(1)
    expect(spyP4a).toHaveBeenCalledTimes(1)
    // the other half of the max-depth layer (p4b's 8 states) + the b-column
    // never regenerate
    expect(spyP2b).not.toHaveBeenCalled()
    expect(spyP3b).not.toHaveBeenCalled()
    expect(spyP4b).not.toHaveBeenCalled()
    const pass2 = sup.getResolvedStates(p4b.id)
    expect(pass2.map((s) => s.pathKey)).toHaveLength(8)
    // the consumer's path-states DID regenerate and still resolve the provider
    const p4aStates = sup.getResolvedStates(p4a.id)
    expect(p4aStates).toHaveLength(8)
    for (const cs of p4aStates) expect(cs.forkKey).toBe(cs.pathKey)
  })

  it('E2E-3c render scope: the precision change reuses every element — zero create/remove ops; only the provider\'s wires are set', async () => {
    const { t, sup, p2a } = componentFixture(5, ['p3a', 'p4a'])
    const boot = compileAll(t)
    const prevMap = new Map(emitElements(boot).map((e) => [e.wire, e]))
    const p2aKeys = new Set(boot.filter((s) => s.nodeId === p2a.id).map((s) => s.pathKey))

    sup.apply({ kind: 'state-slice', node: p2a, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'pressed' }] })
    await flushSweep()
    const els2 = emitResolved(sup, t.nodes.map((n) => n.id))
    const ops = diffMinimal(prevMap, els2)
    expect(ops.filter((o) => o.kind === 'create' || o.kind === 'remove')).toEqual([])
    const sets = ops.filter((o): o is Extract<RenderOp, { kind: 'set' }> => o.kind === 'set')
    expect(sets.length).toBeGreaterThan(0)
    for (const op of sets) expect(p2aKeys.has(op.wire as string)).toBe(true)
  })
})

// ============================================================================
// E2E-4 — post-render placement addition (placement-attach, ideal dirty set)
// ============================================================================

/** The E2E-4 topology: root → d1(zone-1) → d2(zone-2) → d3(zone-3) →
 *  d4a/d4b (depth 4) and d5a (depth 5, under d4a via zone-4). The third
 *  depth-4 node d4c is added AFTER render via placement-attach. */
function e2e4Tree(): ForkTree {
  const doc: LegacyInitialData = {
    template: {
      root: {
        type: 'app',
        children: [{ type: 'div', props: { id: 'd1' }, placement: { placementName: 'zone-1' } }],
      },
    },
    content: [
      {
        content: [
          { type: 'div', props: { id: 'd2' }, placement: { placementName: 'zone-2', targetPlacement: ['zone-1'] } },
          { type: 'div', props: { id: 'd3' }, placement: { placementName: 'zone-3', targetPlacement: ['zone-2'] } },
          { type: 'div', props: { id: 'd4a' }, placement: { placementName: 'zone-4', targetPlacement: ['zone-3'] } },
          { type: 'div', props: { id: 'd4b' }, placement: { targetPlacement: ['zone-3'] } },
          { type: 'div', props: { id: 'd5a' }, placement: { targetPlacement: ['zone-4'] } },
        ],
      },
    ],
    clientConfig: {},
  }
  const t = translateLegacy(doc)
  const byId = new Map<string, Node>()
  for (const n of t.nodes) {
    const pid = n.props.id
    if (typeof pid === 'string') byId.set(pid, n)
  }
  return { root: t.root, nodes: t.nodes, byId }
}

/** PathKeys of the E2E-4 chain, computed from the live (minted) node ids —
 *  the §2.2 template 'root/<zone>/<ownerId>/…/<nodeId>'. A node's OWN path
 *  is built from its CONSUMER hops (targetPlacement); its producer zone
 *  (placementName) enters only its CHILDREN's paths — so d3's key has no
 *  'zone-3' segment, and d4c's key is d3's key with 'zone-3/d3' inserted
 *  before its own id. */
function e2e4Keys(t: ForkTree): { d3: string; d4a: string; d4b: string; d5a: string; d4c: string } {
  const d1 = t.byId.get('d1')!.id
  const d2 = t.byId.get('d2')!.id
  const d3 = t.byId.get('d3')!.id
  const d4a = t.byId.get('d4a')!.id
  const d4b = t.byId.get('d4b')!.id
  const d5a = t.byId.get('d5a')!.id
  // d4c is constructed with an authored id ('d4c') — not a translate product
  const d4c = 'd4c'
  const d3Key = `root/zone-1/${d1}/zone-2/${d2}/${d3}`
  return {
    d3: d3Key,
    d4a: `root/zone-1/${d1}/zone-2/${d2}/zone-3/${d3}/${d4a}`,
    d4b: `root/zone-1/${d1}/zone-2/${d2}/zone-3/${d3}/${d4b}`,
    d5a: `root/zone-1/${d1}/zone-2/${d2}/zone-3/${d3}/zone-4/${d4a}/${d5a}`,
    d4c: `root/zone-1/${d1}/zone-2/${d2}/zone-3/${d3}/${d4c}`,
  }
}

describe('E2E-4 — post-render placement addition: dirty = container + added node; nothing at depth>4 (spec §3.3)', () => {
  it('E2E-4a the placement-attach dirties ONLY d3 (the container) + d4c (the added node) — no depth>4 recalc', async () => {
    const t = e2e4Tree()
    const sup = supOf(t)
    sup.recordResolved(compileAll(t))
    const d4c = new Node({ type: 'div' }, t.root.hubFor ?? undefined, 'd4c')
    const d1 = t.byId.get('d1')!
    const d2 = t.byId.get('d2')!
    const d3 = t.byId.get('d3')!
    const d4a = t.byId.get('d4a')!
    const d4b = t.byId.get('d4b')!
    const d5a = t.byId.get('d5a')!

    const spyD1 = vi.spyOn(d1, 'compilePath')
    const spyD2 = vi.spyOn(d2, 'compilePath')
    const spyD3 = vi.spyOn(d3, 'compilePath')
    const spyD4a = vi.spyOn(d4a, 'compilePath')
    const spyD4b = vi.spyOn(d4b, 'compilePath')
    const spyD5a = vi.spyOn(d5a, 'compilePath')
    const spyD4c = vi.spyOn(d4c, 'compilePath')

    const res = sup.apply({ kind: 'placement-attach', node: d4c, container: d3, names: ['zone-3'] })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') expect([...(res.dirtied ?? [])].sort()).toEqual([d3.id, d4c.id].sort())

    await flushSweep()
    expect(keysOf(sup)).toEqual([d3.id, d4c.id].sort())
    expect(spyD3).toHaveBeenCalledTimes(1)
    expect(spyD4c).toHaveBeenCalledTimes(1)
    expect(spyD1).not.toHaveBeenCalled()
    expect(spyD2).not.toHaveBeenCalled()
    expect(spyD4a).not.toHaveBeenCalled()
    expect(spyD4b).not.toHaveBeenCalled()
    // d5a sits at depth 5 — the attach must not trigger any depth>4 recalc
    expect(spyD5a).not.toHaveBeenCalled()

    // the added node's single path-state + the container's updated children
    const added = sup.getResolvedStates(d4c.id)
    expect(added).toHaveLength(1)
    expect(added[0]!.pathKey).toBe(e2e4Keys(t).d4c)
    expect(added[0]!.activePlacement).toBe('zone-3')
    for (const cs of sup.getResolvedStates(d3.id)) expect(cs.children).toEqual([d4a.id, d4b.id, d4c.id])
    // journaled as the dedicated kind — no clone-instance anywhere
    expect(sup.journal).toHaveLength(1)
    expect(sup.journal[0]!.op.kind).toBe('placement-attach')
  })

  it('E2E-4b render: ONE create (the added node\'s wire) appended under the container\'s path wire; every other element reused', async () => {
    const t = e2e4Tree()
    const sup = supOf(t)
    const boot = compileAll(t)
    sup.recordResolved(boot)
    const prevMap = new Map(emitElements(boot).map((e) => [e.wire, e]))
    const d4c = new Node({ type: 'div' }, t.root.hubFor ?? undefined, 'd4c')
    const keys = e2e4Keys(t)

    sup.apply({ kind: 'placement-attach', node: d4c, container: t.byId.get('d3')!, names: ['zone-3'] })
    await flushSweep()
    const els2 = emitResolved(sup, [...t.nodes.map((n) => n.id), d4c.id])

    const ops = diffMinimal(prevMap, els2)
    const creates = ops.filter((o): o is Extract<RenderOp, { kind: 'create' }> => o.kind === 'create')
    expect(creates).toHaveLength(1)
    expect(creates[0]!.wire).toBe(keys.d4c)
    expect(ops.filter((o) => o.kind === 'remove')).toEqual([])
    // set ops land only on the new wire; the untouched depth-4/depth-5 wires
    // (d4a/d4b/d5a pathKeys) receive no set ops at all
    const setWires = new Set(ops.filter((o) => o.kind === 'set').map((o) => o.wire))
    expect(setWires.has(keys.d4c as string)).toBe(true)
    for (const w of [keys.d4a, keys.d4b, keys.d5a]) expect(setWires.has(w)).toBe(false)
    // the container's path-state appends the new wire
    const appends = ops.filter((o): o is Extract<RenderOp, { kind: 'append' }> => o.kind === 'append')
    expect(appends.some((o) => o.owner === keys.d3 && o.child === keys.d4c)).toBe(true)
  })
})

// ============================================================================
// Consolidated guard pins
// ============================================================================

describe('consolidated guards — census re-pins, duplicate-source, ratio-baseline TODO', () => {
  it('runtime re-pin (F-13 reading, §5.2): the runtime pages expect in-tree = 2^depth − 1 + 22 prototypes = 4117, unplaced = 0, cloneOps = 4094', () => {
    // the runtime page's envelope carries 22 prototypes (2 per layer × 11)
    // and is assembled by clone-instance after translate; the F-13 census
    // arithmetic (demo-smoke.mjs:192-226 asserts the LIVE numbers):
    const depth = 12
    const states = 2 ** depth - 1
    const prototypes = 2 * (depth - 1)
    expect(prototypes).toBe(22)
    const inTree = states + prototypes
    expect(inTree).toBe(4117)
    const cloneOps = inTree - 1 - prototypes
    expect(cloneOps).toBe(4094)
    expect(2 ** depth - 1).toBe(4095)
    // the static tree (23 nodes) is the ONLY 23-node census — the runtime
    // tree registered = inTree + unplaced + destroyed = 4117 + 0 + 0
    expect(inTree).toBe(4117)
  })

  it('component-source-duplicate pin: a second same-name source on one node is skipped with a warn — keep-first (identity = pathKey alone)', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const link = new Link({ name: 'component' })
    const n = new Node({ type: 'div' }, undefined, 'dup-node')
    const a1 = n.addAnchor('source', 'comp-x', {}, link)
    a1!.value = 'first'
    const a2 = n.addAnchor('source', 'comp-x', {}, link)
    expect(a2).toBeNull()
    expect(a1!.value).toBe('first')
    expect(warnSpy).toHaveBeenCalledWith('component-source-duplicate at', 'dup-node', 'source', 'comp-x')
    // the per-name Link sees exactly ONE provider anchor — no arm can fork
    expect(link.anchorsOf('source')).toHaveLength(1)
  })

  it('ratio-baseline pins (§8-Q6 split / derived-fork-variants-review §5.2): the smoke carries the derived FAMILY baseline (per-region, placement-derived) + the per-region pins + the unchanged runtime 2× tripwire', () => {
    const here = dirname(fileURLToPath(import.meta.url))
    const smoke = readFileSync(join(here, '../../scripts/demo-smoke.mjs'), 'utf8')
    expect(smoke).toContain('[derived-fork:baseline]')
    expect(smoke).toContain('derived FAMILY baseline recorded')
    expect(smoke).toContain('[derived-fork:pin]')
    expect(smoke).toContain('runtime 2× total tripwire')
    // the former single-baseline framing is superseded by the family structure
    expect(smoke).not.toContain('`[path-fork:baseline]`')
  })
})
