/**
 * handlers.ts unit contract — event handlers + handler context.
 * Written against the STUB surface; dispatch must make every assertion pass.
 */
import { describe, it, expect } from 'vitest'
import { makeHandlerContext, dispatchEvent, dispatchPhase, dispatchPhaseForNodes } from '../../src/core/handlers.js'
import type { HandlerContext } from '../../src/core/handlers.js'
import { Supervisor } from '../../src/core/node.js'
import { createClient } from '../../src/core/client.js'
import { EventBridge } from '../../src/core/events.js'
import { makeRoot, makeNode, childOf, hub } from '../helpers/fixtures.js'
import type { HandlerDef } from '../../src/core/types.js'

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const clientAPI = createClient(supervisor)
  const root = makeRoot()
  supervisor.registerNode(root)
  return { supervisor, clientAPI, events, root }
}

function nodeWithHandlers(handlers: HandlerDef[]): HandlerDef[] {
  return handlers
}

describe('handlers — HandlerContext', () => {
  it('ctx exposes the mutation channel + tree search', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const ctx: HandlerContext = makeHandlerContext(supervisor, clientAPI)

    expect(ctx.clientAPI).toBe(clientAPI)
    expect(ctx.supervisor).toBe(supervisor)
    expect(ctx.tree.getNode(root.id)).toBe(root)
    expect(ctx.tree.allNodes().map((n) => n.id)).toContain(root.id)
  })

  it('tree search: ancestorsOf walks to root, descendantsOf covers the subtree', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const a = childOf(root, makeNode())
    const b = childOf(a, makeNode())
    supervisor.registerNode(a)
    supervisor.registerNode(b)
    const ctx = makeHandlerContext(supervisor, clientAPI)

    expect(ctx.tree.ancestorsOf(b).map((n) => n.id)).toEqual([a.id, root.id])
    expect(ctx.tree.ancestorsOf(root)).toEqual([])
    expect(ctx.tree.descendantsOf(root).map((n) => n.id).sort()).toEqual([a.id, b.id].sort())
    expect(ctx.tree.descendantsOf(b)).toEqual([])
  })
})

describe('handlers — dispatchEvent', () => {
  it('invokes matching event handlers with (ctx, ...args) and returns results', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const seen: unknown[] = []
    const n = childOf(root, makeNode())
    n.addLayer({ id: 'h', handlers: nodeWithHandlers([{ name: 'click', event: 'click', body: (ctx, arg) => { seen.push(ctx, arg); return 7 } }]) })
    supervisor.registerNode(n)
    const ctx = makeHandlerContext(supervisor, clientAPI)

    const results = dispatchEvent(n, ctx, 'click', 'x')
    expect(results).toEqual([7])
    expect(seen).toHaveLength(2)
    expect(seen[0]).toBe(ctx)
    expect(seen[1]).toBe('x')
  })

  it('runs handlers matching by name when no event field is set', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const n = childOf(root, makeNode())
    n.addLayer({ id: 'h', handlers: nodeWithHandlers([{ name: 'hover', body: () => 'ran' }]) })
    supervisor.registerNode(n)
    const ctx = makeHandlerContext(supervisor, clientAPI)
    expect(dispatchEvent(n, ctx, 'hover')).toEqual(['ran'])
  })

  it('skips non-matching events and missing bodies', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const n = childOf(root, makeNode())
    n.addLayer({ id: 'h', handlers: nodeWithHandlers([{ name: 'a', event: 'a', body: () => 1 }, { name: 'b', event: 'b' }]) })
    supervisor.registerNode(n)
    const ctx = makeHandlerContext(supervisor, clientAPI)
    expect(dispatchEvent(n, ctx, 'other')).toEqual([])
    expect(dispatchEvent(n, ctx, 'b')).toEqual([])
  })

  it('contains handler errors — returned in the result list, not thrown', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const n = childOf(root, makeNode())
    n.addLayer({ id: 'h', handlers: nodeWithHandlers([{ name: 'boom', event: 'boom', body: () => { throw new Error('handler-fail') } }]) })
    supervisor.registerNode(n)
    const ctx = makeHandlerContext(supervisor, clientAPI)
    const results = dispatchEvent(n, ctx, 'boom')
    expect(results).toHaveLength(1)
    expect(results[0]).toBeInstanceOf(Error)
  })

  it('handlers can push managed, reversible updates through ctx.clientAPI', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    n.addLayer({
      id: 'h',
      handlers: nodeWithHandlers([
        {
          name: 'apply',
          event: 'apply',
          body: (ctx: unknown) => {
            const c = ctx as HandlerContext
            return c.clientAPI.apply(n.id, [{ targetProp: 'content', mode: 'replace', value: 'via-handler' }])
          },
        },
      ]),
    })
    const ctx = makeHandlerContext(supervisor, clientAPI)
    dispatchEvent(n, ctx, 'apply')
    expect(n.content).toBe('via-handler')
    expect(supervisor.journal).toHaveLength(1)
    expect(supervisor.journal[0]!.id).toBeDefined() // identifiable
  })
})

describe('handlers — dispatchPhase / dispatchPhaseForNodes', () => {
  it('runs only handlers whose phase matches', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const n = childOf(root, makeNode())
    const order: string[] = []
    n.addLayer({
      id: 'h',
      handlers: nodeWithHandlers([
        { name: 'pre', phase: 'before-compile', body: () => order.push('pre') },
        { name: 'post', phase: 'after-compile', body: () => order.push('post') },
        { name: 'render', phase: 'after-render', body: () => order.push('render') },
      ]),
    })
    supervisor.registerNode(n)
    const ctx = makeHandlerContext(supervisor, clientAPI)

    dispatchPhase(n, ctx, 'before-compile')
    dispatchPhase(n, ctx, 'after-compile')
    dispatchPhase(n, ctx, 'after-render')
    expect(order).toEqual(['pre', 'post', 'render'])
  })

  it('dispatchPhaseForNodes runs the phase across the given set, containing errors', () => {
    const { supervisor, clientAPI, root } = newSystem()
    const a = childOf(root, makeNode())
    const b = childOf(root, makeNode())
    supervisor.registerNode(a)
    supervisor.registerNode(b)
    a.addLayer({ id: 'h', handlers: nodeWithHandlers([{ name: 'p', phase: 'after-render', body: () => 'a' }]) })
    b.addLayer({ id: 'h', handlers: nodeWithHandlers([{ name: 'p', phase: 'after-render', body: () => { throw new Error('b-fail') } }]) })
    const ctx = makeHandlerContext(supervisor, clientAPI)

    const results = dispatchPhaseForNodes([a, b], ctx, 'after-render')
    expect(results).toHaveLength(2)
    expect(results[0]).toBe('a')
    expect(results[1]).toBeInstanceOf(Error)
  })
})
