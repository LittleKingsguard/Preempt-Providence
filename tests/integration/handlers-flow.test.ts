/**
 * Step 6 integration — handlers + phases + translated trees through the
 * managed channel (Supervisor.apply → journal → pass-2 events).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Supervisor } from '../../src/core/node.js'
import type { Node } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { makeRoot, makeNode, childOf, hub } from '../helpers/fixtures.js'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'
import { dispatchEvent } from '../../src/core/handlers.js'
import type { HandlerContext } from '../../src/core/handlers.js'

afterEach(() => vi.restoreAllMocks())

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const clientAPI = createClient(supervisor)
  const root = makeRoot()
  supervisor.registerNode(root)
  return { supervisor, clientAPI, events, root }
}

async function flushTicks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('integration — handler flow through journal + events', () => {
  it('a dispatched event handler applies through ctx.clientAPI; the update journals and emits a state event next tick', async () => {
    const { supervisor, clientAPI, events, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    n.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'update',
          event: 'update',
          body: (ctx: unknown, payload: unknown) => {
            const c = ctx as HandlerContext
            return c.clientAPI.apply(n.id, [{ targetProp: 'content', mode: 'replace', value: payload }])
          },
        },
      ],
    })

    const envelopes: Array<{ events: Array<{ type: string; nodeId: string }> }> = []
    events.subscribe('state', (env) => envelopes.push(env as never))

    dispatchViaSupervisor(supervisor, n.id, 'update', 'hello')
    expect(n.content).toBe('hello')
    expect(supervisor.journal).toHaveLength(1)
    expect(supervisor.journal[0]!.id).toBeDefined()

    await flushTicks()
    const stateEvs = envelopes.flatMap((e) => e.events).filter((e) => e.type === 'state')
    expect(stateEvs.map((e) => e.nodeId)).toContain(n.id)
  })

  it('a before-compile phase handler can push a managed update before the op; both land journaled in order', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    n.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'pre',
          phase: 'before-compile',
          body: (ctx: unknown) => {
            const c = ctx as HandlerContext
            c.clientAPI.apply(n.id, [{ targetProp: 'props.note', mode: 'replace', value: 'pre-set' }])
          },
        },
      ],
    })

    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'main' }] })
    expect(supervisor.journal).toHaveLength(2)
    expect(n.props.note).toBe('pre-set')
    expect(n.content).toBe('main')
  })

  it('state-slice can mutate handlers (targetProp handlers) as a layer', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    supervisor.apply({
      kind: 'state-slice',
      node: n,
      mutation: [{ targetProp: 'handlers', mode: 'replace', value: [{ name: 'ping', event: 'ping', body: () => 'pong' }] }],
    })
    expect(n.handlers).toHaveLength(1)
  })

  it('structural ops return dirtied; attach emits structure + state', async () => {
    const { supervisor, events, root } = newSystem()
    const n = makeNode()
    supervisor.registerNode(n)
    const envelopes: Array<{ events: Array<{ type: string; op?: string }> }> = []
    events.subscribe('structure', (env) => envelopes.push(env as never))

    const res = supervisor.apply({ kind: 'attach', node: n, to: root })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') expect(res.dirtied).toEqual([n.id])
    expect(n.isInTree).toBe(true)

    await flushTicks()
    const structs = envelopes.flatMap((e) => e.events)
    expect(structs.some((e) => e.type === 'structure' && e.op === 'attach')).toBe(true)
  })

  it('clone-instance resolves source, attaches into slot with priority, journals + emits', async () => {
    const { supervisor, events, root } = newSystem()
    const proto = childOf(root, makeNode({ type: 'proto', content: 'P' }))
    const slot = childOf(root, makeNode({ type: 'slot' }))
    supervisor.registerNode(proto)
    supervisor.registerNode(slot)
    const envelopes: Array<{ events: Array<{ type: string; op?: string }> }> = []
    events.subscribe('structure', (env) => envelopes.push(env as never))

    const res = supervisor.apply({ kind: 'clone-instance', source: proto, slot, priority: 3 })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') expect(res.dirtied).toHaveLength(1)
    const copy = supervisor.allNodes().find((n) => n !== root && n !== proto && n !== slot && n.type === 'proto')
    expect(copy).toBeDefined()
    expect(copy!.parent).toBe(slot)
    expect(copy!.childAnchor()?.options.priority).toBe(3)

    await flushTicks()
    const structs = envelopes.flatMap((e) => e.events)
    expect(structs.some((e) => e.type === 'structure' && e.op === 'clone-instance')).toBe(true)
  })

  it('pass-2 focuses warnings on the dirty node: an unrelated dangling node is never re-flagged', async () => {
    const { supervisor, root } = newSystem()
    const dangling = childOf(root, makeNode())
    targetAnchorDangling(dangling)
    supervisor.registerNode(dangling)

    // first apply ON the dangling node → its unresolved warning fires once
    let warns = 0
    const origWarn = console.warn
    console.warn = () => {
      warns++
    }
    supervisor.apply({ kind: 'state-slice', node: dangling, mutation: [{ targetProp: 'content', mode: 'replace', value: 'own' }] })
    await flushTicks()
    expect(warns).toBeGreaterThan(0)
    warns = 0

    // subsequent applies on UNRELATED nodes must not re-log the dangling warning
    const other = childOf(root, makeNode())
    supervisor.registerNode(other)
    for (let i = 0; i < 3; i += 1) {
      supervisor.apply({ kind: 'state-slice', node: other, mutation: [{ targetProp: 'content', mode: 'replace', value: `v${i}` }] })
      await flushTicks()
    }
    console.warn = origWarn
    expect(warns).toBe(0)
    expect(other.content).toBe('v2')
    expect(dangling.isInTree).toBe(true) // untouched by the unrelated updates
  })

  it('a translated legacy tree flows through the managed channel and its in-tree parts render', async () => {
    const { supervisor, events } = newSystem()
    const legacy: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          children: [{ type: 'header', content: 'legacy head' }],
          component: { reference: 'shell' },
          handlers: [{ name: 'boot', phase: 'after-render', body: () => 'booted' }],
        },
        children: [{ type: 'hero', content: 'unplaced hero' }],
      },
      content: [{ metadata: { k: 'v' }, content: [{ type: 'card', placement: { placementName: 'slot-alpha' } }] }],
      clientConfig: { runInstantiation: true, runMonitoring: true },
    }
    const t = translateLegacy(legacy)
    for (const n of t.nodes) supervisor.registerNode(n)

    // content nodes are unplaced — not actionable
    const cr = t.root.compile(t.nodes)
    for (const c of t.content) {
      expect(cr.actionable.map((s) => s.nodeId)).not.toContain(c.id)
    }
    // root subtree is actionable and in-tree
    expect(cr.actionable.map((s) => s.nodeId)).toContain(t.root.id)
    expect(cr.actionable.find((s) => s.nodeId === t.root.id)?.state).toBe('in-tree')
    expect(cr.actionable.map((s) => s.nodeId)).toContain(t.root.children[0]!.id)

    // phase handler on the translated root fires through the managed channel
    const bootLog: string[] = []
    t.root.layers.push({ id: 'b', handlers: [{ name: 'boot2', phase: 'after-render', body: () => bootLog.push('booted2') }] })
    const res = supervisor.apply({ kind: 'state-slice', node: t.root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    expect(res.status).toBe('applied')
    await flushTicks()
    expect(bootLog).toEqual(['booted2'])
    expect(t.metadata).toEqual({ k: 'v' })
    expect(t.clientConfig).toEqual({ adapter: 'ssr', persistence: true })
  })
})

/** Attach a dangling target (no source anywhere) — S-R4.3 unresolved case. */
function targetAnchorDangling(node: Node): void {
  node.addAnchor('target', 'missing-src', {}, new Link({ name: 'component' }))
}

/** Dispatch an event through a node's handlers using the supervisor context. */
function dispatchViaSupervisor(supervisor: Supervisor, nodeId: string, event: string, ...args: unknown[]): unknown[] {
  const node = supervisor.getNode(nodeId)!
  return dispatchEvent(node, supervisor.handlerContext, event, ...args)
}
