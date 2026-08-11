/**
 * Workstream B — read-only pass-2 RESOLVED exposure for handlers.
 * Covers: supervisor.getResolvedStates (non-draining), Node.resolved
 * (read-only defensive copies), recordResolved (bootstrap seeding), and
 * ctx.tree.getState(id) phase semantics (after-compile sees states,
 * before-compile does not).
 */
import { describe, it, expect, afterEach, vi } from 'vitest'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import type { HandlerContext } from '../../src/core/handlers.js'
import type { CompiledState } from '../../src/core/types.js'

afterEach(() => vi.restoreAllMocks())

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const root = makeRoot()
  supervisor.registerNode(root)
  return { supervisor, events, root }
}

async function flushTicks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('integration — read-only pass-2 resolved exposure', () => {
  it('after an apply + flush, getResolvedStates returns the pass-2 compiled states', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ type: 'card' }))
    supervisor.registerNode(n)
    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'hello' }] })
    await flushTicks()

    const states = supervisor.getResolvedStates(n.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.nodeId).toBe(n.id)
    expect(states[0]!.type).toBe('card')
    expect(states[0]!.state).toBe('in-tree')
    expect(states[0]!.pathKey).toBe(n.pathKey)
    expect(states[0]!.content).toBe('hello')
  })

  it('getResolvedStates is non-draining and independent of the renderer snapshot', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'hello' }] })
    await flushTicks()

    const drained = supervisor.takePass2States()
    expect(drained.has(n.id)).toBe(true) // the renderer snapshot (draining store) held it

    const first = supervisor.getResolvedStates(n.id)
    expect(first.length).toBeGreaterThan(0)
    expect(first[0]!.content).toBe('hello')
    const second = supervisor.getResolvedStates(n.id)
    expect(second).toEqual(first) // stable across reads — none of them consumed anything
  })

  it('node.resolved is populated, read-only, and returns defensive copies', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'hello' }] })
    await flushTicks()

    const node = supervisor.getNode(n.id)!
    const len = node.resolved.length
    expect(len).toBeGreaterThan(0)
    const initialContent = node.resolved[0]!.content

    // mutating the returned array must not touch the internal cache
    const returned = node.resolved
    ;(returned as unknown as unknown[]).push('tampered')
    expect(node.resolved).toHaveLength(len)
    expect(node.resolved[0]!.content).toBe(initialContent)

    // fresh shallow copies on every read
    const a = node.resolved
    const b = node.resolved
    expect(a).not.toBe(b)
    expect(a).toEqual(b)

    // no setter: assignment on the getter-only property throws (strict mode)
    expect(() => {
      ;(node as unknown as { resolved: unknown }).resolved = 'nope'
    }).toThrow()
  })

  it('a node consuming a name with 2 sources yields 2 fork arms with distinct pathKeys', async () => {
    const { supervisor, root } = newSystem()
    addComponentSource(root, 'color', 'red')
    addComponentSource(root, 'color', 'blue')
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    targetAnchor(n, 'color')
    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    await flushTicks()

    const states = supervisor.getResolvedStates(n.id)
    expect(states).toHaveLength(2)
    const paths = new Set(states.map((s) => s.pathKey))
    expect(paths.size).toBe(2) // distinct fork-arm pathKeys
    expect(states.some((s) => s.bindings.color === 'red')).toBe(true)
    expect(states.some((s) => s.bindings.color === 'blue')).toBe(true)
    expect(supervisor.getNode(n.id)!.resolved).toHaveLength(2)
  })

  it('recordResolved seeds the resolved store after a direct bootstrap compile', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ type: 'card' }))
    supervisor.registerNode(n)

    const cr = root.compile([root, n]) // the demos' bootstrap compile (no supervisor)
    expect(cr.actionable.length).toBeGreaterThan(0)
    supervisor.recordResolved(cr.actionable)

    expect(supervisor.getResolvedStates(root.id).length).toBeGreaterThan(0)
    const states = supervisor.getResolvedStates(n.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.nodeId).toBe(n.id)
    expect(states[0]!.type).toBe('card')
    expect(supervisor.getNode(n.id)!.resolved).toHaveLength(1)
    // recordResolved never touches the draining store
    expect(supervisor.takePass2States().size).toBe(0)
  })

  it('after-compile handlers read resolved states via ctx.tree.getState; before-compile sees none', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ type: 'row' }))
    supervisor.registerNode(n)
    let beforeState: CompiledState[] | null = null
    let afterState: CompiledState[] = []
    n.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'observe-before',
          phase: 'before-compile',
          body: (c: unknown) => {
            beforeState = (c as HandlerContext).tree.getState(n.id)
          },
        },
        {
          name: 'observe-after',
          phase: 'after-compile',
          body: (c: unknown) => {
            afterState = (c as HandlerContext).tree.getState(n.id)
          },
        },
      ],
    })

    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'hello' }] })
    // before-compile runs pre-pass-2: no resolved states yet
    expect(beforeState).toEqual([])
    await flushTicks()
    expect(beforeState).toEqual([]) // unchanged — it observed the pre-pass-2 moment
    expect(afterState.length).toBeGreaterThan(0) // after-compile sees the fresh pass-2
    expect(afterState[0]!.nodeId).toBe(n.id)
    expect(afterState[0]!.state).toBe('in-tree')
    expect(afterState[0]!.content).toBe('hello')
  })

  it('resolved states carry component binding values from provider source anchors', async () => {
    const { supervisor, root } = newSystem()
    const source = addComponentSource(root, 'label', 'provided-label')
    expect(source.value).toBe('provided-label')
    const consumer = childOf(root, makeNode({ type: 'label' }))
    supervisor.registerNode(consumer)
    targetAnchor(consumer, 'label')
    supervisor.apply({ kind: 'state-slice', node: consumer, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    await flushTicks()

    const states = supervisor.getResolvedStates(consumer.id)
    expect(states.length).toBeGreaterThan(0)
    expect(states[0]!.bindings.label).toBe('provided-label')
    expect(supervisor.getNode(consumer.id)!.resolved[0]!.bindings.label).toBe('provided-label')
  })

  it('an after-compile handler reads a resolved binding via ctx.tree.getState', async () => {
    const { supervisor, root } = newSystem()
    addComponentSource(root, 'label', 'capability-value')
    const display = childOf(root, makeNode({ type: 'display' }))
    supervisor.registerNode(display)
    targetAnchor(display, 'label')
    let captured: CompiledState[] = []
    display.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'capture',
          phase: 'after-compile',
          body: (c: unknown) => {
            captured = (c as HandlerContext).tree.getState(display.id)
          },
        },
      ],
    })

    supervisor.apply({ kind: 'state-slice', node: display, mutation: [{ targetProp: 'content', mode: 'replace', value: 'go' }] })
    await flushTicks()
    expect(captured.length).toBeGreaterThan(0)
    expect(captured[0]!.nodeId).toBe(display.id)
    expect(captured[0]!.bindings.label).toBe('capability-value')
  })
})