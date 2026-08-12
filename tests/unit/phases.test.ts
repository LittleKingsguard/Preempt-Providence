/**
 * Phase-handler contract — Supervisor.runPhase + ordering hooks.
 * Written against the STUB surface; the implementation must satisfy:
 *   before-compile → after-compile (before render) → after-render
 */
import { describe, it, expect } from 'vitest'
import { Supervisor, focusedSliceFor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { Node } from '../../src/core/node.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor, familyLink } from '../helpers/fixtures.js'
import type { HandlerPhase } from '../../src/core/handlers.js'

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const root = makeRoot()
  supervisor.registerNode(root)
  return { supervisor, events, root }
}

describe('Supervisor phase hooks (stub contract)', () => {
  it('exposes clientAPI and a handler context on the supervisor', () => {
    const { supervisor } = newSystem()
    expect(typeof supervisor.clientAPI.apply).toBe('function')
    expect(typeof supervisor.clientAPI.getState).toBe('function')
    expect(typeof supervisor.handlerContext.tree.allNodes).toBe('function')
    expect(typeof supervisor.handlerContext.tree.getNode).toBe('function')
    expect(typeof supervisor.handlerContext.tree.ancestorsOf).toBe('function')
    expect(typeof supervisor.handlerContext.tree.descendantsOf).toBe('function')
    expect(supervisor.handlerContext.clientAPI).toBe(supervisor.clientAPI)
  })

  it('runPhase dispatches a phase on a single node and on all nodes', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const hits: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [{ name: 'p', phase: 'after-render', body: () => hits.push('single') }],
    })
    root.addLayer({
      id: 'h',
      handlers: [{ name: 'p', phase: 'after-render', body: () => hits.push('all') }],
    })

    supervisor.runPhase('after-render', n.id)
    expect(hits).toEqual(['single'])
    supervisor.runPhase('after-render')
    expect(hits).toEqual(['single', 'all', 'single'])
  })

  it('runPhase with an unknown node id is a safe no-op', () => {
    const { supervisor } = newSystem()
    expect(() => supervisor.runPhase('before-compile', 'nope')).not.toThrow()
  })

  it('apply() runs before-compile handlers on the op node before the op executes', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ content: 'orig' }))
    supervisor.registerNode(n)
    const order: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [
        { name: 'pre', phase: 'before-compile', body: () => order.push('pre:' + n.content) },
      ],
    })

    const res = supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'new' }] })
    expect(res.status).toBe('applied')
    // before-compile observed the PRE-op value; the op applied after
    expect(order).toEqual(['pre:orig'])
    expect(n.content).toBe('new')
  })

  it('pass-2 flush runs after-compile (before render) then after-render, in order', async () => {
    const { supervisor, events, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const order: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [
        { name: 'after', phase: 'after-compile', body: () => order.push('after-compile') },
        { name: 'rendered', phase: 'after-render', body: () => order.push('after-render') },
      ],
    })
    events.subscribe('state', () => order.push('state-event'))

    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'v' }] })
    // pass-2 + events flush on the microtask queue
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(order).toEqual(['after-compile', 'state-event', 'after-render'])
  })

  it('the three phases run in order across an apply+flush cycle', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const order: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [
        { name: 'pre', phase: 'before-compile', body: () => order.push('before-compile') },
        { name: 'after', phase: 'after-compile', body: () => order.push('after-compile') },
        { name: 'rendered', phase: 'after-render', body: () => order.push('after-render') },
      ],
    })

    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(order).toEqual(['before-compile', 'after-compile', 'after-render'])
    void (null as unknown as HandlerPhase)
  })
})

describe('focusedSliceFor — bounded pass-2 slices stay bounded (no all-tree scans per pass)', () => {
  it('excludes the source-bearing universe when the walk path has NO targets (no resolution can run, so the fallback is dead weight)', () => {
    const root = makeRoot()
    const child = makeNode({ type: 'div' })
    childOf(root, child)
    // every node is a source PROVIDER (values-style page): providers on the
    // walk path resolve depth-0 at themselves and never need the universe
    addComponentSource(child, 'values-1.a', 'value-A-1')
    addComponentSource(root, 'values-0.a', 'value-A-0')
    // an OFF-PATH provider must NOT be swept into the slice
    const offPath = makeNode({ type: 'div' })
    addComponentSource(offPath, 'values-9.b', 'value-B-9')
    const slice = focusedSliceFor(child, [root, child, offPath])
    expect(slice.map((n) => n.id).sort()).toEqual([root.id, child.id].sort())
  })

  it('keeps the universe when the walk path carries a target (arm termination needs the fallback)', () => {
    const root = makeRoot()
    const child = makeNode({ type: 'div' })
    childOf(root, child)
    targetAnchor(child, 'theme')
    const provider = makeNode({ type: 'div' })
    addComponentSource(provider, 'ghost', 'x')
    const slice = focusedSliceFor(child, [root, child, provider])
    expect(slice.map((n) => n.id).sort()).toEqual([root.id, child.id, provider.id].sort())
  })

  it('shared-hub trees: the per-name component Link provides the providers — NO full-graph sweep (slice = walk path only)', () => {
    const h = hub()
    const root = new Node({ type: 'app' }, h)
    familyLink(root, 'rootNode')
    const child = new Node({ type: 'div' }, h)
    childOf(root, child)
    child.addAnchor('target', 'theme', {}, h.linkFor('theme', 'component'))
    // an off-path prototype provider sharing the SAME hub: the link knows it
    const provider = new Node({ type: 'section' }, h)
    familyLink(provider, 'component')
    const src = provider.addAnchor('source', 'theme', {}, h.linkFor('theme', 'component'))
    src.value = 'dark'
    const slice = focusedSliceFor(child, [root, child, provider])
    expect(slice.map((n) => n.id).sort()).toEqual([root.id, child.id].sort())
  })
})
