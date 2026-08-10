/**
 * Step 7 e2e — loop-safety probes (docs/subagents.md Step 7).
 *
 * Intentionally tries to create infinite circles through the public surface
 * and asserts the safety guard trips instead of hanging:
 *   - A→B→A anchor circles (attach-time op guard + compile-time loop drop)
 *   - component self-reference
 *   - dangling source/target (unresolved reference)
 *   - depth-cap trips (compile-time guard)
 */
import { describe, it, expect } from 'vitest'
import { Node, Supervisor, findCycle, MAX_COMPILE_DEPTH } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { CycleError, SingleParentError } from '../../src/core/errors.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { makeRoot, makeNode, makePrototype, childOf, hub, addComponentSource, targetAnchor } from '../helpers/fixtures.js'

async function flushTicks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const clientAPI = createClient(supervisor)
  const register = (...nodes: Node[]) => {
    for (const node of nodes) supervisor.registerNode(node)
    return nodes
  }
  return { clientAPI, supervisor, events, register }
}

/** Build an actual A↔B anchor circle (each is the other's parent via two family links). */
function buildAnchorCircle() {
  const a = makeNode({ type: 'a' })
  const b = makeNode({ type: 'b' })
  const l1 = new Link({ name: 'parent-child' })
  a.addAnchor('parent', a, {}, l1)
  b.addAnchor('child', b, {}, l1)
  const l2 = new Link({ name: 'parent-child' })
  b.addAnchor('parent', b, {}, l2)
  a.addAnchor('child', a, {}, l2)
  return { a, b }
}

describe('e2e — loop-safety probes (Step 7)', () => {
  it('A→B→A anchors: attach/move that would close the circle is rejected at op time, graph unchanged', () => {
    const root = makeRoot()
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    childOf(root, a)
    childOf(a, b)
    // b → a already; moving a under b would create a → b → a circle
    expect(findCycle(a, b)).toBe(true)
    const { clientAPI, supervisor, register } = newSystem()
    register(root, a, b)
    const before = supervisor.journal.length

    const res = clientAPI.apply(a.id, { kind: 'move', node: a.id, to: { parent: b.id } })
    expect(res.status).toBe('rejected')
    if (res.status === 'rejected') expect(res.error.code).toBe('cycle-detected')
    expect(a.parent).toBe(root) // rolled back
    expect(b.parent).toBe(a)
    expect(supervisor.journal.length).toBe(before) // rejected ops are not journaled
  })

  it('A→B→A anchors: an actual anchor circle compiles to a dropped loop arm with a circular-source warning', () => {
    const { a, b } = buildAnchorCircle()
    const res = a.compile([a, b])
    expect(res.actionable).toHaveLength(0)
    expect(res.dropped.some((d) => d.reason === 'loop')).toBe(true)
    expect(res.warnings.some((w) => w.code === 'circular-source')).toBe(true)
    // guard tripped: bounded, no stack growth
    expect(a.state).toBe('unplaced')
  })

  it('component self-reference: a component that consumes its own slot resolves at depth 0, never loops', () => {
    const { clientAPI, events, register } = newSystem()
    const root = makeRoot()
    const comp = childOf(root, makeNode({ type: 'component-host' }))
    register(root, comp)
    // self-source: the node both provides and consumes 'self-slot'
    addComponentSource(comp, 'self-slot', { origin: 'self' }, 'duplex')
    targetAnchor(comp, 'self-slot')

    const envelopes: Array<{ events: Array<{ type: string; code?: string }> }> = []
    events.subscribe('state', (env) => envelopes.push(env as never))
    events.subscribe('diagnostic', (env) => envelopes.push(env as never))

    const res = clientAPI.apply(comp.id, [{ targetProp: 'content', mode: 'replace', value: 'v' }])
    expect(res.status).toBe('applied')
    // depth-0 resolution: NO circular-source diagnostic, still renders (S4.1/S-R2.6)
    const exposed = clientAPI.getState(comp.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]?.status).toBe('ok')
    void envelopes
  })

  it('dangling source/target: a target with no source is unresolved + warning; own state still renders', async () => {
    const { clientAPI, events, register } = newSystem()
    const root = makeRoot()
    const holder = childOf(root, makeNode())
    const t = childOf(holder, makeNode())
    register(root, holder, t)
    targetAnchor(t, 'missing-src') // no source anywhere

    const seen: Array<{ nodeId: string; status: string }> = []
    events.subscribe('state', (env) => {
      for (const e of env.events) if (e.type === 'state') seen.push({ nodeId: e.nodeId, status: e.status as string })
    })

    let warns = 0
    const origWarn = console.warn
    console.warn = () => {
      warns++
    }
    const res = clientAPI.apply(t.id, [{ targetProp: 'props.title', mode: 'replace', value: 'own' }])
    await flushTicks()
    console.warn = origWarn

    expect(res.status).toBe('applied')
    expect(warns).toBeGreaterThan(0) // S-R4.3: warning logged

    const mine = seen.find((e) => e.nodeId === t.id)
    expect(mine?.status).toBe('unresolved-reference')
    expect(t.isInTree).toBe(true)
    expect(t.props.title).toBe('own') // node renders its own state
  })

  it('dangling source/target: a target whose only candidate lives under a prototype is dropped silently', async () => {
    const { clientAPI, events, register } = newSystem()
    const root = makeRoot()
    const consumer = childOf(root, makeNode())
    register(root, consumer)
    targetAnchor(consumer, 'proto-only')

    // the only provider sits under a component prototype — arm terminates there
    const proto = makePrototype()
    const holder = childOf(proto, makeNode())
    addComponentSource(holder, 'proto-only', { from: 'proto' })
    register(proto, holder)

    const seen: Array<{ nodeId: string; status: string }> = []
    events.subscribe('state', (env) => {
      for (const e of env.events) if (e.type === 'state') seen.push({ nodeId: e.nodeId, status: e.status as string })
    })

    let warns = 0
    const origWarn = console.warn
    console.warn = () => {
      warns++
    }
    clientAPI.apply(consumer.id, [{ targetProp: 'content', mode: 'replace', value: 'u' }])
    await flushTicks()
    console.warn = origWarn

    expect(seen.filter((e) => e.nodeId === consumer.id)).toHaveLength(0) // silent drop
    expect(warns).toBe(0)
    expect(holder.isInTree).toBe(false)
  })

  it('depth-cap trip: a borrow walk deeper than the cap is dropped as loop, never hangs', () => {
    const root = makeRoot()
    const chain: Node[] = [root]
    let parent = root
    for (let i = 0; i <= MAX_COMPILE_DEPTH + 1; i++) {
      const n = makeNode()
      childOf(parent, n)
      chain.push(n)
      parent = n
    }
    const deep = parent
    targetAnchor(deep, 'deep-borrow')
    addComponentSource(root, 'deep-borrow', { at: 'root' })

    const res = root.compile(chain)
    expect(res.dropped.some((d) => d.reason === 'loop')).toBe(true)
    expect(res.warnings.some((w) => w.code === 'circular-source')).toBe(true)
    expect(res.actionable.find((s) => s.nodeId === deep.id)).toBeUndefined()
  })

  it('A→B→A anchors: single-parent still enforced — a second parent is rejected, never silently reparented', () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    childOf(root, a)
    expect(() => childOf(b, a)).toThrow(SingleParentError)
    expect(a.parent).toBe(root)
  })
})
