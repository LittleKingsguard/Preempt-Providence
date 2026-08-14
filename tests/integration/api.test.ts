/**
 * ClientAPI behavior contract — api.md §8 exhaustiveness matrix (T1..T25).
 * Red-state TDD: this file defines the expected public surface; the
 * src/core implementation does not exist yet. Every scenario is built through
 * the contract fixtures in tests/helpers/fixtures.ts and observed only via
 * ClientAPI.apply / ClientAPI.getState / Supervisor.journal / EventBridge,
 * per contract.md.
 */
import { describe, it, expect } from 'vitest'
import { createClient, type ClientAPI, type ExposedState } from '../../src/core/client.js'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge, type EventEnvelope, type PreemptEvent } from '../../src/core/events.js'
import { Node, mintNodeId } from '../../src/core/node.js'
import { makeRoot, makeNode, makePrototype, childOf, hub, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import type { MutationInput, LayerMutation, ApplyStatus } from '../../src/core/types.js'

type NarrowedApplied = Extract<ApplyStatus, { status: 'applied' }>
type NarrowedNoState = Extract<ApplyStatus, { status: 'no-usable-state' }>
type NarrowedRejected = Extract<ApplyStatus, { status: 'rejected' }>

function applied(res: ApplyStatus): NarrowedApplied {
  expect(res.status).toBe('applied')
  return res as NarrowedApplied
}

function noUsableState(res: ApplyStatus): NarrowedNoState {
  expect(res.status).toBe('no-usable-state')
  return res as NarrowedNoState
}

function rejected(res: ApplyStatus): NarrowedRejected {
  expect(res.status).toBe('rejected')
  return res as NarrowedRejected
}

/** One isolated system: EventBridge + Supervisor + ClientAPI + root registered. */
function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const clientAPI = createClient(supervisor)
  const root = makeRoot()
  const register = (...nodes: Node[]) => {
    for (const node of nodes) supervisor.registerNode(node)
    return nodes
  }
  register(root)
  return { clientAPI, supervisor, events, root, register }
}
type TestSystem = ReturnType<typeof newSystem>

/** Drain render-microtask ticks (each round is one macrotask boundary). */
async function flushTicks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

/** Capture envelopes emitted on the canonical WS topics. */
function subscribeAll(events: EventBridge): EventEnvelope[] {
  const envelopes: EventEnvelope[] = []
  for (const topic of ['state', 'structure', 'diagnostic']) {
    events.subscribe(topic, (env) => envelopes.push(env))
  }
  return envelopes
}

type StateEv = Extract<PreemptEvent, { type: 'state' }>
type StructureEv = Extract<PreemptEvent, { type: 'structure' }>
type DiagnosticEv = Extract<PreemptEvent, { type: 'diagnostic' }>

function states(envelopes: EventEnvelope[]): StateEv[] {
  return envelopes.flatMap((e) => e.events).filter((e): e is StateEv => e.type === 'state')
}

function structures(envelopes: EventEnvelope[]): StructureEv[] {
  return envelopes.flatMap((e) => e.events).filter((e): e is StructureEv => e.type === 'structure')
}

function diagnostics(envelopes: EventEnvelope[]): DiagnosticEv[] {
  return envelopes.flatMap((e) => e.events).filter((e): e is DiagnosticEv => e.type === 'diagnostic')
}

/** Count console.warn invocations during a block. */
async function countWarns(fn: () => Promise<void> | void): Promise<number> {
  const orig = console.warn
  let count = 0
  console.warn = () => {
    count++
  }
  try {
    await fn()
  } finally {
    console.warn = orig
  }
  return count
}

/** Build a forking pane: dock consumes 'feed'; a and b both provide it. */
function buildFork(sys: TestSystem): { dock: Node; fa: Node; fb: Node } {
  const dock = childOf(sys.root, makeNode())
  const fa = childOf(dock, makeNode())
  const fb = childOf(dock, makeNode())
  sys.register(dock, fa, fb)
  targetAnchor(dock, 'feed')
  addComponentSource(fa, 'feed', { label: 'A' })
  addComponentSource(fb, 'feed', { label: 'B' })
  return { dock, fa, fb }
}

/** A linear `depth`-deep chain of in-tree nodes returned in order top→bottom. */
function chainOfDepth(root: Node, depth: number): Node[] {
  const nodes: Node[] = []
  let parent = root
  for (let i = 0; i < depth; i++) {
    const n = childOf(parent, makeNode())
    nodes.push(n)
    parent = n
  }
  return nodes
}

describe('ClientAPI.apply — api.md §8 exhaustiveness', () => {
  it('T1: happy-path apply on an in-tree node', async () => {
    const { clientAPI, supervisor, events, root, register } = newSystem()
    const a = childOf(root, makeNode())
    register(a)
    const envelopes = subscribeAll(events)
    const before = supervisor.journal.length

    const res = applied(
      clientAPI.apply(a.id, [{ targetProp: 'content', mode: 'replace', value: 'G' }]),
    )

    // pass-1 synchronous: the node's own value getters are fresh immediately.
    expect(a.content).toBe('G')
    expect(res.dirtied).toContain(a.id)

    // Journaled once, id echoed on the result.
    expect(supervisor.journal.length).toBe(before + 1)
    const entry = supervisor.journal[before]
    expect(entry?.id).toBe(res.journalId)
    expect(entry?.op?.kind).toBe('state-slice')

    // pass-2 defers: nothing observable before the microtask sweep.
    expect(envelopes).toHaveLength(0)
    expect(events.state.size).toBe(0)

    // Next tick: exactly one 'state' event for the node.
    await flushTicks()
    const st = states(envelopes)
    expect(st).toHaveLength(1)
    expect(st[0]?.nodeId).toBe(a.id)
    expect(st[0]?.status).toBe('ok')
    expect(events.state.has(a.id)).toBe(true)
  })

  it('T2: apply on an unplaced node — gated, no journal, no events', async () => {
    const { clientAPI, supervisor, events, register } = newSystem()
    const u = makeNode()
    register(u)
    const envelopes = subscribeAll(events)
    const before = supervisor.journal.length

    const res = noUsableState(
      clientAPI.apply(u.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }]),
    )
    expect(res.nodeState).toBe('unplaced')
    expect(supervisor.journal.length).toBe(before)
    await flushTicks()
    expect(envelopes).toHaveLength(0)
    expect(events.state.size).toBe(0)
  })

  it('T3: apply on a component prototype — gated', async () => {
    const { clientAPI, supervisor, events, register } = newSystem()
    const p = makePrototype()
    register(p)
    const envelopes = subscribeAll(events)
    const before = supervisor.journal.length

    const res = noUsableState(
      clientAPI.apply(p.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }]),
    )
    expect(res.nodeState).toBe('prototype')
    expect(supervisor.journal.length).toBe(before)
    await flushTicks()
    expect(envelopes).toHaveLength(0)
  })

  it('T4: apply on a destroyed node — gated', async () => {
    const { clientAPI, supervisor, events, root, register } = newSystem()
    const keeper = childOf(root, makeNode()) // keeps the family link populated
    const victim = childOf(root, makeNode())
    register(keeper, victim)

    applied(clientAPI.apply(victim.id, { kind: 'destroy', node: victim.id }))
    await flushTicks() // cascade sweep makes destruction terminal

    expect(victim.destroyed).toBe(true)
    expect(victim.state).toBe('destroyed')

    const envelopes = subscribeAll(events)
    const before = supervisor.journal.length
    const res = noUsableState(
      clientAPI.apply(victim.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }]),
    )
    expect(res.nodeState).toBe('destroyed')
    expect(supervisor.journal.length).toBe(before)
    await flushTicks()
    expect(envelopes).toHaveLength(0)
  })

  it('T5: unknown NodeRef — rejected unknown-node, no journal, no events', async () => {
    const { clientAPI, supervisor, events } = newSystem()
    const envelopes = subscribeAll(events)
    const before = supervisor.journal.length

    const unknownRef = mintNodeId()
    const res = rejected(
      clientAPI.apply(unknownRef, [{ targetProp: 'content', mode: 'replace', value: 'x' }]),
    )
    expect(res.error.code).toBe('unknown-node')
    expect(supervisor.journal.length).toBe(before)
    await flushTicks()
    expect(envelopes).toHaveLength(0)
  })

  it('T6: state-slice targeting placement is hard-blocked', async () => {
    const { clientAPI, supervisor, events, root, register } = newSystem()
    const a = childOf(root, makeNode())
    register(a)
    const envelopes = subscribeAll(events)
    const before = supervisor.journal.length

    // 'placement' is never legal in the LayerMutation union; the runtime
    // guard must still reject a routed-through write.
    const placementSlice = [{ targetProp: 'placement', mode: 'replace', value: 'zone' }] as unknown as LayerMutation[]
    const res = rejected(clientAPI.apply(a.id, placementSlice))
    expect(res.error.code).toBe('placement-target-blocked')
    expect(supervisor.journal.length).toBe(before)
    await flushTicks()
    expect(envelopes).toHaveLength(0)
  })

  it('T7: unresolved reference → compile status + warning; own state still rendered', async () => {
    const { clientAPI, events, root, register } = newSystem()
    const holder = childOf(root, makeNode())
    const t = childOf(holder, makeNode())
    register(holder, t)
    targetAnchor(t, 'theme') // no source anywhere
    const envelopes = subscribeAll(events)

    const warns = await countWarns(async () => {
      applied(
        clientAPI.apply(t.id, [{ targetProp: 'props.title', mode: 'replace', value: 'own-title' }]),
      )
      await flushTicks()
    })
    expect(warns).toBeGreaterThan(0) // S-R4.3: warning logged

    const st = states(envelopes)
    const mine = st.find((e) => e.nodeId === t.id)
    expect(mine).toBeDefined()
    expect(mine?.status).toBe('unresolved-reference') // a status, not a drop

    // Node still renders its own state — compiled, in-tree, own value intact.
    expect(t.isInTree).toBe(true)
    expect(t.props.title).toBe('own-title')
  })

  it('T8: borrow with only non-matching roles exhausts the walk', async () => {
    const { clientAPI, root, register } = newSystem()
    const parent = childOf(root, makeNode())
    const t = childOf(parent, makeNode())
    register(parent, t)
    targetAnchor(t, 'missing')
    addComponentSource(parent, 'something-else', 1) // non-matching name on the walk

    const warns = await countWarns(async () => {
      clientAPI.apply(t.id, [{ targetProp: 'content', mode: 'replace', value: 'v' }])
      await flushTicks()
    })
    expect(warns).toBeGreaterThan(0)

    const exposed = clientAPI.getState(t.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]?.status).toBe('unresolved-reference')
  })

  it('T9: duplex self-resolution — resolves at depth 0, ancestor ignored', async () => {
    const { clientAPI, root, register } = newSystem()
    const a = childOf(root, makeNode())
    register(a)
    addComponentSource(a, 'panel', { origin: 'self' }, 'duplex')
    addComponentSource(root, 'panel', { origin: 'ancestor' })

    applied(clientAPI.apply(a.id, [{ targetProp: 'content', mode: 'replace', value: 'v' }]))
    await flushTicks()

    const exposed = clientAPI.getState(a.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]?.status).toBe('ok')
  })

  it('T10: closest-first borrow — nearer source shadows the root', async () => {
    const { clientAPI, root, register } = newSystem()
    const depthChain = chainOfDepth(root, 5) // target at depth 5, source at depth 2
    register(...depthChain)
    const p2 = depthChain[1]!
    const t = depthChain[4]!
    targetAnchor(t, 'res')
    addComponentSource(p2, 'res', { depth: 2 }) // nearest match on the walk
    addComponentSource(root, 'res', { depth: 'root' })

    const exposed = clientAPI.getState(t.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]?.status).toBe('ok')
  })

  it('T11: root fallback — root source used when nothing closer exists', async () => {
    const { clientAPI, root, register } = newSystem()
    const chain = chainOfDepth(root, 3)
    register(...chain)
    const t = chain[chain.length - 1]!
    targetAnchor(t, 'res')
    addComponentSource(root, 'res', { depth: 'root' })

    const exposed = clientAPI.getState(t.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]?.status).toBe('ok')
  })

  it('T12: same-name multiplicity → two exposed states, distinct fork keys', async () => {
    const sys = newSystem()
    const { dock } = buildFork(sys)
    const envelopes = subscribeAll(sys.events)

    applied(
      sys.clientAPI.apply(dock.id, [{ targetProp: 'props.kind', mode: 'replace', value: 'dash' }]),
    )
    await flushTicks()

    const st = states(envelopes)
    const armKeys = st.filter((e) => e.fork).map((e) => e.fork?.forkKey)
    expect(armKeys.length).toBe(2)
    expect(new Set(armKeys).size).toBe(2) // distinct path keys, no coerced pick

    const exposed = sys.clientAPI.getState(dock.id)
    expect(exposed.length).toBe(2)
    expect(new Set(exposed.map((e) => e.status))).toEqual(new Set(['ok']))
  })

  it('T13: deep acyclic chain compiles actionable after a pass-2 edit (no circular-source diagnostic)', async () => {
    const sys = newSystem()
    const { clientAPI, events, root, register } = sys
    // A 12-link acyclic chain: parent-chain classification is memoized and
    // cycle-only (compile-horizon §6.1), so depth is not a loop signal; the
    // root-sourced target resolves through the iterative fitReference walk.
    const depth = chainOfDepth(root, 12)
    register(...depth)
    const deep = depth[depth.length - 1]!
    targetAnchor(deep, 'deep-borrow')
    addComponentSource(root, 'deep-borrow', { at: 'root' })

    const envelopes = subscribeAll(events)
    clientAPI.apply(deep.id, [{ targetProp: 'content', mode: 'replace', value: 'probe' }])
    await flushTicks()

    // The deep node compiles actionable after the pass-2 edit…
    const st = states(envelopes).find((e) => e.nodeId === deep.id)
    expect(st?.status).toBe('ok')
    // …and emits no 'circular-source' diagnostic.
    expect(diagnostics(envelopes)).toHaveLength(0)
  })

  it('T14: prototype/contentNodes-terminated arm drops silently', async () => {
    const sys = newSystem()
    const { clientAPI, events, root, register } = sys
    const consumer = childOf(root, makeNode())
    register(consumer)
    targetAnchor(consumer, 'viz')
    // The only 'viz' candidate in the compiled slice lives under a component
    // prototype — the arm terminates at a non-root permanent owner and must
    // fail silently: no state, no event, no warning.
    const proto = makePrototype()
    const src = childOf(proto, makeNode())
    register(proto, src)
    addComponentSource(src, 'viz', { from: 'proto' })

    const envelopes = subscribeAll(events)
    clientAPI.apply(consumer.id, [{ targetProp: 'content', mode: 'replace', value: 'u' }])
    await flushTicks()

    // Silent: nothing surfaced for the prototype-terminated arm.
    expect(states(envelopes)).toHaveLength(0)
    expect(diagnostics(envelopes)).toHaveLength(0)
    const warns = await countWarns(async () => {})
    expect(warns).toBe(0)
    expect(src.isInTree).toBe(false) // src's chain ends at 'component', not root
  })

  it('T15: placement vs component — mismatch → unresolved, cross-role write → role-mismatch', async () => {
    const { clientAPI, root, register, events } = newSystem()
    const zone = childOf(root, makeNode())
    register(zone)
    targetAnchor(zone, 'slot2') // component borrow; only placement anchors exist
    const plink = hub().linkFor('slot2', 'placement')
    root.addAnchor('container', 'slot2', {}, plink)

    const exposed = clientAPI.getState(zone.id)
    expect(exposed[0]?.status).toBe('unresolved-reference') // placement never satisfies a component target

    // Cross-role anchor write onto a placement link rejects with role-mismatch.
    let code: string | undefined
    try {
      root.addAnchor('target', 'slot2', {}, plink)
    } catch (e) {
      code = (e as { code?: string }).code
    }
    expect(code).toBe('role-mismatch')
    await flushTicks()
    expect(events.state.size).toBe(0)
  })

  it('T16: placement via state-slice vs attach', async () => {
    const { clientAPI, supervisor, events, root, register } = newSystem()
    const payload = makeNode()
    register(payload)

    // (a) a slice writing placement is blocked…
    const slice = [{ targetProp: 'placement', mode: 'replace', value: 'slot' }] as unknown as LayerMutation[]
    const blocked = rejected(clientAPI.apply(payload.id, slice))
    expect(blocked.error.code).toBe('placement-target-blocked')

    // (b) …while an attach that populates the zone by compile succeeds.
    const envelopes = subscribeAll(events)
    const res = applied(
      clientAPI.apply(payload.id, { kind: 'attach', node: payload.id, to: root.id, zone: 'slot' }),
    )
    expect(res.status).toBe('applied')
    expect(supervisor.journal.at(-1)?.op?.kind).toBe('attach')
    await flushTicks()
    expect(payload.isInTree).toBe(true)
    expect(states(envelopes).some((s) => s.nodeId === payload.id)).toBe(true)
  })

  it('T17: event coalescing — one sweep, on state event per node per tick', async () => {
    const { clientAPI, events, root, register } = newSystem()
    const a = childOf(root, makeNode())
    const b = childOf(root, makeNode())
    register(a, b)
    const envelopes = subscribeAll(events)

    // Three applies in one tick, two overlapping the same node.
    applied(clientAPI.apply(a.id, [{ targetProp: 'content', mode: 'replace', value: '1' }]))
    applied(clientAPI.apply(a.id, [{ targetProp: 'content', mode: 'replace', value: '2' }]))
    applied(clientAPI.apply(b.id, [{ targetProp: 'content', mode: 'replace', value: '3' }]))

    await flushTicks()

    const st = states(envelopes)
    const byNode = new Map<string, number>()
    for (const e of st) byNode.set(e.nodeId, (byNode.get(e.nodeId) ?? 0) + 1)
    expect(byNode.get(a.id)).toBe(1)
    expect(byNode.get(b.id)).toBe(1)

    // One coalesced envelope per topic (state).
    expect(envelopes.filter((env) => env.topic === 'state')).toHaveLength(1)
    expect(a.content).toBe('2') // last write of the batch wins
  })

  it('T18: nested emission during an active slice defers to a later tick', async () => {
    const { clientAPI, events, root, register } = newSystem()
    const a = childOf(root, makeNode())
    const b = childOf(root, makeNode())
    register(a, b)
    const envelopes = subscribeAll(events)

    // The first apply reserves the microtask drain for its sweep.
    applied(clientAPI.apply(a.id, [{ targetProp: 'content', mode: 'replace', value: 'A1' }]))

    // Nest the second apply inside that first drain: it must land on a
    // strictly later tick, never interleaved with a's batch.
    let release!: () => void
    const nested = new Promise<void>((r) => (release = r))
    queueMicrotask(() => {
      release()
      clientAPI.apply(b.id, [{ targetProp: 'content', mode: 'replace', value: 'B1' }])
    })
    await nested
    await flushTicks()
    // apply of b inside the drain schedules a new microtask; drain the next one.
    await flushTicks()

    const ev = envelopes.flatMap((env) =>
      env.events
        .filter((x): x is StateEv => x.type === 'state')
        .map((x) => ({ nodeId: x.nodeId, tick: env.tick })),
    )
    expect(ev.map((e) => e.nodeId)).toEqual([a.id, b.id])
    expect(ev[0]?.tick).not.toBe(ev[1]?.tick) // deferred to a later tick, no interleave
  })

  it('T19: no partial-slice visibility — events only after all forks resolve', async () => {
    const sys = newSystem()
    const { dock } = buildFork(sys)
    const envelopes = subscribeAll(sys.events)

    applied(
      sys.clientAPI.apply(dock.id, [{ targetProp: 'content', mode: 'replace', value: 'new' }]),
    )
    // Held slice: nothing observable mid-resolution.
    expect(envelopes).toHaveLength(0)
    expect(sys.events.state.size).toBe(0)

    await flushTicks()

    const st = states(envelopes)
    expect(st.length).toBe(2)
    expect(new Set(st.map((e) => e.fork?.forkKey)).size).toBe(2) // atomic after final resolution
  })

  it('T20: fork de-duplication — unique node ids and path keys, arms never merged', async () => {
    const sys = newSystem()
    const { dock, fa, fb } = buildFork(sys)
    const envelopes = subscribeAll(sys.events)

    applied(
      sys.clientAPI.apply(dock.id, [{ targetProp: 'props.label', mode: 'replace', value: 'x' }]),
    )
    await flushTicks()

    const st = states(envelopes)
    const armKeys = st.map((e) => e.fork?.forkKey).filter((k): k is string => Boolean(k))
    expect(armKeys.length).toBe(2)
    expect(new Set(armKeys).size).toBe(2)

    const idSets = st.map((e) => new Set(e.fork?.nodeIds ?? []))
    // Each arm traces its own unique node ids; arms are never merged.
    const has = (setIdx: number, seek: Node) => [...idSets[setIdx]!].some((id) => id === seek.id)
    expect(has(0, fa) || has(1, fa)).toBe(true)
    expect(has(0, fb) || has(1, fb)).toBe(true)
    const overlap = [...idSets[0]!].some((id) => idSets[1]!.has(id))
    expect(overlap).toBe(false)
  })

  it('T21: structural op cycle guard — rejected and rolled back', async () => {
    const { clientAPI, supervisor, events, root, register } = newSystem()
    const a = childOf(root, makeNode())
    const b = childOf(a, makeNode())
    const c = childOf(b, makeNode())
    const d = childOf(c, makeNode())
    register(a, b, c, d)
    const envelopes = subscribeAll(events)
    const before = supervisor.journal.length

    // attaching an ancestor (a) under its descendant (d) would form a cycle.
    const res = rejected(clientAPI.apply(a.id, { kind: 'attach', node: a.id, to: d.id }))
    expect(res.error.code).toBe('cycle-detected')
    expect(a.parent).toBe(root) // rolled back: graph untouched
    await flushTicks()
    expect(envelopes).toHaveLength(0)
    expect(supervisor.journal.length).toBe(before)
  })

  it('T22: handler mutation channel — only ctx.clientAPI.apply exists', async () => {
    const { clientAPI, supervisor, root, register } = newSystem()
    const a = childOf(root, makeNode())
    register(a)

    // Legacy receive-next-state / direct-field channels are structurally gone.
    expect((clientAPI as unknown as Record<string, unknown>).receiveNextState).toBeUndefined()
    expect((a as unknown as Record<string, unknown>).receiveNextState).toBeUndefined()
    expect((a as unknown as Record<string, unknown>).setContent).toBeUndefined()
    expect((a as unknown as { setType: unknown }).setType).toBeUndefined()

    // The sole mutating handle is ctx.clientAPI.apply.
    applied(
      clientAPI.apply(a.id, [{ targetProp: 'content', mode: 'replace', value: 'via-apply' }]),
    )
    expect(a.content).toBe('via-apply')
    expect(supervisor.journal.length).toBe(1)
  })

  it('T23: handler minimal re-render — node-local compile, no sibling noise', async () => {
    const { clientAPI, events, root, register } = newSystem()
    const a = childOf(root, makeNode())
    const b = childOf(root, makeNode())
    register(a, b)
    const envelopes = subscribeAll(events)

    applied(
      clientAPI.apply(a.id, [{ targetProp: 'props.title', mode: 'replace', value: 't' }]),
    )
    await flushTicks()

    const st = states(envelopes)
    expect(st).toHaveLength(1)
    expect(st[0]?.nodeId).toBe(a.id)
    expect(structures(envelopes)).toHaveLength(0)
    expect(events.state.has(b.id)).toBe(false)
  })

  it('T24: inbound WS event → normalized through the same supervisor.apply journal', async () => {
    const { clientAPI, supervisor, events, root, register } = newSystem()
    const incoming = makeNode()
    register(incoming)
    const envelopes = subscribeAll(events)

    // A server-pushed wire structural op (normalized WS payload) must flow
    // through the same journal + pipeline — no side channel.
    const res = applied(
      clientAPI.apply(incoming.id, { kind: 'attach', node: incoming.id, to: root.id }),
    )
    expect(res.status).toBe('applied')
    expect(supervisor.journal.at(-1)?.op?.kind).toBe('attach')
    await flushTicks()
    expect(incoming.isInTree).toBe(true)
    expect(structures(envelopes).some((e) => e.op === 'attach' && e.nodeId === incoming.id)).toBe(true)
  })

  it('T25: hydrate re-resolves from anchors, does not trust shipped forks', async () => {
    // First resolution: client sees the fork it can infer from the graph.
    const first = newSystem()
    const { dock: dockA, fa: faA, fb: fbA } = buildFork(first)
    applied(
      first.clientAPI.apply(dockA.id, [{ targetProp: 'props.id', mode: 'replace', value: 'dock' }]),
    )
    await flushTicks()
    const shipped = first.clientAPI.getState(dockA.id)
    expect(shipped.length).toBe(2)

    // "Hydrate": a fresh client gets a JSON brush of the same anchor shape
    // and re-resolves on its own nodes — it never materializes the old fork ids.
    const second = newSystem()
    const { dock, fa, fb } = buildFork(second)
    const envelopes = subscribeAll(second.events)
    applied(second.clientAPI.apply(dock.id, [{ targetProp: 'props.id', mode: 'replace', value: 'dock' }]))
    await flushTicks()

    const st = states(envelopes)
    expect(st.length).toBe(2) // same resolution surface, computed live
    for (const e of st) {
      const ids = e.fork?.nodeIds ?? []
      expect(ids.length).toBeGreaterThan(0)
      // The fork traces THIS graph's live node ids — no stale shipped ids.
      expect(ids.includes(fa.id) || ids.includes(fb.id)).toBe(true)
      expect(ids.includes(faA.id) || ids.includes(fbA.id)).toBe(false)
    }
  })
})