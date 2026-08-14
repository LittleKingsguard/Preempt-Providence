import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { EventBridge, type PreemptEvent } from '../../src/core/events.js'
import { makeRoot, makeNode, childOf, hub, familyLink } from '../helpers/fixtures.js'
import { activePlacementOf } from '../../src/core/resolve.js'
import type { CompiledState, LinkConfigNameHub } from '../../src/core/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function supOf(root: Node, ...rest: Node[]): Supervisor {
  const nodes = new Map<string, Node>()
  nodes.set(root.id, root)
  for (const n of rest) nodes.set(n.id, n)
  return new Supervisor(root, nodes)
}

function ofRole(node: Node, role: string) {
  return node.anchors.filter(a => a.role === role)
}

function flushSweep(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

describe('supervisor journal / undo-redo / cascade-destroy sweep (integration)', () => {
  it('O13 journal replay re-executes ops in order and reproduces the same rejection', () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    const c = makeNode()
    const sup = supOf(root, a, b, c)

    sup.apply({ kind: 'attach', node: a, to: root })
    sup.apply({ kind: 'attach', node: b, to: a })
    sup.apply({ kind: 'attach', node: c, to: b })

    const cycleLive = sup.apply({ kind: 'move', node: b, to: { parent: c } })
    expect(cycleLive.status).toBe('rejected')
    expect(b.parent).toBe(a)

    sup.replay()
    expect(a.parent).toBe(root)
    expect(b.parent).toBe(a)
    expect(c.parent).toBe(b)
    expect(a.state).toBe('in-tree')

    const cycleReplay = sup.apply({ kind: 'move', node: b, to: { parent: c } })
    expect(cycleReplay.status).toBe('rejected')
  })

  it('O14 undo and redo invert and reapply the named op stream', () => {
    const root = makeRoot()
    const a = makeNode()
    const sup = supOf(root, a)

    sup.apply({ kind: 'attach', node: a, to: root })
    expect(a.parent).toBe(root)
    expect(a.state).toBe('in-tree')

    sup.undo()
    expect(a.parent).toBeNull()
    expect(a.state).toBe('unplaced')

    sup.redo()
    expect(a.parent).toBe(root)
    expect(a.state).toBe('in-tree')
  })

  it('O15 an anchor-adding effect forces a new sweep, populating anchors only after the op', async () => {
    const root = makeRoot()
    const node = makeNode()
    childOf(root, node)

    node.addLayer({ id: 'placement-1', anchors: [{ role: 'container', target: 'slot-alpha' }] })
    expect(node.dirty.has('anchor-populate')).toBe(true)

    await flushSweep()
    const placements = ofRole(node, 'container')
    expect(placements).toHaveLength(1)
    expect(placements[0]!.link).toBeDefined()
  })

  it('O18 a batch of dirtied dependents is coalesced into one pass-2 sweep with no whole-tree recompile', async () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    const far = makeNode()
    childOf(root, a)
    childOf(root, b)

    const spyA = vi.spyOn(a, 'compileRemote')
    const spyB = vi.spyOn(b, 'compileRemote')
    const spyFar = vi.spyOn(far, 'compileRemote')

    const sup = supOf(root, a, b, far)
    sup.apply({ kind: 'state-slice', node: a, mutation: [{ targetProp: 'content', mode: 'replace', value: '1' }] })
    sup.apply({ kind: 'state-slice', node: b, mutation: [{ targetProp: 'content', mode: 'replace', value: '2' }] })

    await flushSweep()
    expect(spyA).toHaveBeenCalledTimes(1)
    expect(spyB).toHaveBeenCalledTimes(1)
    expect(spyFar).not.toHaveBeenCalled()
  })
})

describe('placement-attach op, trigger identity, silent abort, per-path events (P3 §3.3, §9-Q3, E2E-4) — Unit 6', () => {
  function eventsOf(bridge: EventBridge, topic: string): PreemptEvent[] {
    const out: PreemptEvent[] = []
    bridge.subscribe(topic, env => out.push(...env.events))
    return out
  }

  function mkNode(h: LinkConfigNameHub, id: string, placement: { placementName?: string; targetPlacement?: string[] }): Node {
    const n = new Node({ type: 'div' }, h, id)
    if (placement.placementName) {
      n.addAnchor('container', placement.placementName, {}, h.linkFor(placement.placementName, 'placement'))
    }
    for (const name of placement.targetPlacement ?? []) n.addAnchor('content', name, {}, h.linkFor(name, 'placement'))
    return n
  }

  /** Single-container-per-zone chain: root → d1(z1) → d2(z2) → d3(z3) → d4a/d4b
   *  + d5a below d4a. The third depth-4 node (d4c) is the E2E-4 attach. */
  function e2e4Tree(): { h: LinkConfigNameHub; root: Node; d1: Node; d2: Node; d3: Node; d4a: Node; d4b: Node; d5a: Node; d4c: Node } {
    const h = hub()
    const root = new Node({ type: 'app' }, h, 'root')
    familyLink(root, 'rootNode')
    const d1 = mkNode(h, 'd1', { placementName: 'zone-1' })
    childOf(root, d1)
    const d2 = mkNode(h, 'd2', { placementName: 'zone-2', targetPlacement: ['zone-1'] })
    const d3 = mkNode(h, 'd3', { placementName: 'zone-3', targetPlacement: ['zone-2'] })
    const d4a = mkNode(h, 'd4a', { placementName: 'zone-4', targetPlacement: ['zone-3'] })
    const d5a = mkNode(h, 'd5a', { targetPlacement: ['zone-4'] })
    const d4b = mkNode(h, 'd4b', { targetPlacement: ['zone-3'] })
    const d4c = new Node({ type: 'div' }, h, 'd4c')
    return { h, root, d1, d2, d3, d4a, d4b, d5a, d4c }
  }

  function supWith(h: LinkConfigNameHub, nodes: Node[], bridge?: EventBridge): Supervisor {
    const opts: { hub?: LinkConfigNameHub; events?: EventBridge } = { hub: h }
    if (bridge) opts.events = bridge
    const sup = new Supervisor(opts)
    for (const n of nodes) sup.registerNode(n)
    return sup
  }

  it('S-P1 E2E-4: placement-attach dirties ONLY the container + the added node — nothing at depth>4 recompiles', async () => {
    const t = e2e4Tree()
    const sup = supWith(t.h, [t.root, t.d1, t.d2, t.d3, t.d4a, t.d4b, t.d5a, t.d4c])
    const boot: CompiledState[] = []
    for (const n of [t.root, t.d1, t.d2, t.d3, t.d4a, t.d4b, t.d5a]) boot.push(...n.compilePath().actionable)
    sup.recordResolved(boot)

    const spyD1 = vi.spyOn(t.d1, 'compilePath')
    const spyD2 = vi.spyOn(t.d2, 'compilePath')
    const spyD4a = vi.spyOn(t.d4a, 'compilePath')
    const spyD4b = vi.spyOn(t.d4b, 'compilePath')
    const spyD5a = vi.spyOn(t.d5a, 'compilePath')
    const spyD3 = vi.spyOn(t.d3, 'compilePath')
    const spyD4c = vi.spyOn(t.d4c, 'compilePath')

    const res = sup.apply({ kind: 'placement-attach', node: t.d4c, container: t.d3, names: ['zone-3'] })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') expect(res.dirtied).toEqual([t.d3.id, t.d4c.id])
    expect(sup.getNode(t.d4c.id)).toBeDefined()

    await flushSweep()
    const pass2 = sup.takePass2States()
    expect([...pass2.keys()].sort()).toEqual([t.d3.id, t.d4c.id].sort())
    expect(spyD1).not.toHaveBeenCalled()
    expect(spyD2).not.toHaveBeenCalled()
    expect(spyD4a).not.toHaveBeenCalled()
    expect(spyD4b).not.toHaveBeenCalled()
    expect(spyD5a).not.toHaveBeenCalled()
    expect(spyD3).toHaveBeenCalledTimes(1)
    expect(spyD4c).toHaveBeenCalledTimes(1)
    // the container's path-states pick up the added node as a path-child (§2.3)
    for (const cs of pass2.get(t.d3.id)!) expect(cs.children).toEqual([t.d4a.id, t.d4b.id, t.d4c.id])
    const added = pass2.get(t.d4c.id)!
    expect(added).toHaveLength(1)
    expect(added[0]!.pathKey).toBe('root/zone-1/d1/zone-2/d2/zone-3/d3/d4c')
    expect(added[0]!.activePlacement).toBe('zone-3')
  })

  it('S-P2 the op is journaled verbatim (trigger fields included) and replays idempotently', () => {
    const t = e2e4Tree()
    const sup = supWith(t.h, [t.root, t.d1, t.d2, t.d3])
    const trigger = { kind: 'placement', linkName: 'zone-3', direction: 'content-added' } as const
    const res = sup.apply({ kind: 'placement-attach', node: t.d4c, container: t.d3, names: ['zone-3'], trigger })
    expect(res.status).toBe('applied')
    expect(sup.journal).toHaveLength(1)
    const entry = sup.journal[0]!
    expect(entry.op.kind).toBe('placement-attach')
    expect(entry.op.names).toEqual(['zone-3'])
    expect(entry.op.trigger).toEqual(trigger)
    expect((entry.op as unknown as { node: Node }).node.id).toBe(t.d4c.id)
    expect((entry.op as unknown as { container: Node }).container.id).toBe(t.d3.id)

    expect(ofRole(t.d4c, 'content')).toHaveLength(1)
    expect(ofRole(t.d3, 'container')).toHaveLength(1)

    sup.replay()
    expect(ofRole(t.d4c, 'content')).toHaveLength(1)
    expect(ofRole(t.d3, 'container')).toHaveLength(1)
  })

  it('S-P3 ClientAPI.apply resolves the container ref and carries the trigger fields through', () => {
    const t = e2e4Tree()
    const sup = supWith(t.h, [t.root, t.d1, t.d2, t.d3, t.d4c])
    const trigger = { kind: 'placement', linkName: 'zone-3', direction: 'content-added' } as const
    const res = sup.clientAPI.apply(t.d4c.id, { kind: 'placement-attach', container: t.d3.id, names: ['zone-3'], trigger })
    expect(res.status).toBe('applied')
    expect(ofRole(t.d4c, 'content')).toHaveLength(1)
    expect(ofRole(t.d3, 'container')).toHaveLength(1)
    expect(sup.journal[0]!.op.trigger).toEqual(trigger)
  })

  it('S-P4 trigger-identity silent abort: a less-favored update regenerates nothing and emits nothing; the chosen link regenerates', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = hub()
    const root = new Node({ type: 'app' }, h, 'root')
    familyLink(root, 'rootNode')
    const P1 = mkNode(h, 'P1', { placementName: 'preferred' })
    childOf(root, P1)
    // C: serves 'fallback' AND consumes ['preferred', 'fallback'] (its own zone
    // ranks BELOW the choice — the loop arm is pruned, not consulted)
    const C = mkNode(h, 'C', { placementName: 'fallback', targetPlacement: ['preferred', 'fallback'] })
    childOf(root, C)
    const D = mkNode(h, 'D', { targetPlacement: ['preferred', 'fallback'] })
    childOf(root, D)
    const bridge = new EventBridge()
    const events = eventsOf(bridge, 'state')
    const sup = supWith(h, [root, P1, C, D], bridge)

    // bootstrap: both consumers compile with the chosen name 'preferred'
    const bootC = sup.apply({ kind: 'state-slice', node: C, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'c' }] })
    expect(bootC.status).toBe('applied')
    await flushSweep()
    const bootD = sup.apply({ kind: 'state-slice', node: D, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'd' }] })
    expect(bootD.status).toBe('applied')
    await flushSweep()
    expect(activePlacementOf(sup.getResolvedStates(C.id))).toBe('preferred')
    expect(activePlacementOf(sup.getResolvedStates(D.id))).toBe('preferred')
    sup.takePass2States()
    events.length = 0

    const spyC = vi.spyOn(C, 'compilePath')
    const spyD = vi.spyOn(D, 'compilePath')

    // IRRELEVANT: an attach into the less-favored 'fallback' zone — both dirty
    // nodes carry 'fallback' BELOW their chosen 'preferred' → silent abort:
    // zero state regeneration, zero events (the derived trigger rides apply)
    const irr = sup.apply({ kind: 'placement-attach', node: D, container: C, names: ['fallback'] })
    expect(irr.status).toBe('applied')
    if (irr.status === 'applied') expect(irr.dirtied).toEqual([C.id, D.id])
    await flushSweep()
    expect(spyC).not.toHaveBeenCalled()
    expect(spyD).not.toHaveBeenCalled()
    expect(sup.takePass2States().size).toBe(0)
    expect(events.filter(e => e.type === 'state')).toHaveLength(0)

    // RELEVANT: an attach on the CHOSEN link ('preferred') regenerates D
    const rel = sup.apply({ kind: 'placement-attach', node: D, container: P1, names: ['preferred'] })
    expect(rel.status).toBe('applied')
    await flushSweep()
    expect(spyD).toHaveBeenCalledTimes(1)
    const pass2 = sup.takePass2States()
    expect(pass2.has(D.id)).toBe(true)
    const dEvents = events.filter(e => e.type === 'state' && e.nodeId === D.id)
    expect(dEvents.length).toBeGreaterThan(0)
  })

  it('S-P5 path-states emit per-path events (forkKey = pathKey, no #f dependency); only the affected node emits', async () => {
    const h = hub()
    const root = new Node({ type: 'app' }, h, 'root')
    familyLink(root, 'rootNode')
    const P = mkNode(h, 'P', { placementName: 'zone-1' })
    childOf(root, P)
    const C = mkNode(h, 'C', { targetPlacement: ['zone-1'] })
    childOf(root, C)
    const S = mkNode(h, 'S', { targetPlacement: ['zone-1'] })
    childOf(root, S)
    const bridge = new EventBridge()
    const events = eventsOf(bridge, 'state')
    const sup = supWith(h, [root, P, C, S], bridge)

    const spyS = vi.spyOn(S, 'compilePath')
    const res = sup.apply({ kind: 'state-slice', node: C, mutation: [{ targetProp: 'props.label', mode: 'replace', value: 'x' }] })
    expect(res.status).toBe('applied')
    await flushSweep()

    const cEvents = events.filter(e => e.type === 'state' && e.nodeId === C.id)
    expect(cEvents).toHaveLength(2)
    const stateEvents = cEvents.filter((e): e is Extract<PreemptEvent, { type: 'state' }> => e.type === 'state')
    const forks = stateEvents.map(e => e.fork!.forkKey).sort()
    expect(forks).toEqual(['root/C', 'root/zone-1/P/C'])
    // the path's node ids, root-down (the enumerated walk records the root landing)
    const viaZone = stateEvents.find(e => e.fork!.forkKey === 'root/zone-1/P/C')!
    expect(viaZone.fork!.nodeIds).toEqual(['root', 'P', 'C'])
    const viaFamily = stateEvents.find(e => e.fork!.forkKey === 'root/C')!
    expect(viaFamily.fork!.nodeIds).toEqual(['root', 'C'])
    // affected-set-only: the sibling (a content-routed node, not dirtied) emits nothing
    expect(events.filter(e => e.type === 'state' && e.nodeId === S.id)).toHaveLength(0)
    expect(spyS).not.toHaveBeenCalled()
  })

  it('S-P6 W2 dedup keeps path-unique keys: one event per path-state, never a per-node collapse', async () => {
    const h = hub()
    const root = new Node({ type: 'app' }, h, 'root')
    familyLink(root, 'rootNode')
    const P = mkNode(h, 'P', { placementName: 'zone-1' })
    childOf(root, P)
    const C = mkNode(h, 'C', { targetPlacement: ['zone-1'] })
    childOf(root, C)
    const bridge = new EventBridge()
    const events = eventsOf(bridge, 'state')
    const sup = supWith(h, [root, P, C], bridge)

    sup.apply({ kind: 'state-slice', node: C, mutation: [{ targetProp: 'props.a', mode: 'replace', value: 1 }] })
    sup.apply({ kind: 'state-slice', node: C, mutation: [{ targetProp: 'props.b', mode: 'replace', value: 2 }] })
    await flushSweep()

    const cEvents = events.filter(e => e.type === 'state' && e.nodeId === C.id)
    // with forkKey = pathKey the (nodeId, forkKey) dedup keys are path-unique —
    // the C-6 collapse (empty fork key for every path-state) would leave ONE event
    expect(cEvents).toHaveLength(2)
    const stateEvents = cEvents.filter((e): e is Extract<PreemptEvent, { type: 'state' }> => e.type === 'state')
    expect(stateEvents.map(e => e.fork!.forkKey).sort()).toEqual(['root/C', 'root/zone-1/P/C'])
  })
})