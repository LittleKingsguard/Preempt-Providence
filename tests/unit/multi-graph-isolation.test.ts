/**
 * MULTI-GRAPH / REGISTRY ISOLATION — TDD red set for D1-D8
 * (docs/specs/multi-graph-isolation-spec.md + -review.md).
 *
 * The isolation guarantee: an OPT-IN isolated graph (a per-graph GraphScope)
 * is fully disjoint from another graph — a graph-A agent can never resolve,
 * compile, or destroy a graph-B handler def / node / userData / minted set.
 * The DEFAULT (no opt-in) is the current module singleton (D8) — these tests
 * only exercise the explicit opt-in path.
 *
 *   D2  (acceptance) — an isolated graph never resolves/compiles a handler
 *       def body registered in another scope.
 *   D3  per-scope byId/resolveNodeRef/registered — same-id graphs never
 *       address each other's node.
 *   D4  per-scope translateUserData — no single-slot clobber.
 *   D5  a graph-A removeLayer never cross-destroys graph-B's minted set.
 *   D6  a graph-A destroy never finalizes/evicts graph-B's nodes (one timer,
 *       per-scope partition).
 *   D8  regression gate — the DEFAULT path is byte-identical; the module
 *       accessors still operate on the shared singleton with no opt-in.
 */
import { describe, it, expect } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import {
  createIsolatedScope,
  registerHandlerDef,
  handlerDef,
  setTranslateUserData,
  getTranslateUserData,
  resolveNodeRef,
  registerMinted,
  mintedByOrigin,
  registered,
  DEFAULT_SCOPE,
} from '../../src/core/registry.js'
import { hub, childOf } from '../helpers/fixtures.js'

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('D2 — handlerDefs resolution is per-scope (the security-critical acceptance criterion)', () => {
  it('a handler def registered in graph A is never resolved from an isolated graph B', () => {
    const scopeA = createIsolatedScope()
    const scopeB = createIsolatedScope()
    registerHandlerDef('ghost', { name: 'ghost', body: '() => 1' }, scopeA)
    // graph B binds 'ghost' — must NOT resolve/compile the graph-A body
    expect(handlerDef('ghost', scopeB)).toBeUndefined()
    // graph A still resolves its own
    expect(handlerDef('ghost', scopeA)).toEqual(expect.objectContaining({ name: 'ghost' }))
  })

  it('a handler def registered in an isolated graph is NOT visible in the shared default', () => {
    const scopeB = createIsolatedScope()
    registerHandlerDef('ghost', { name: 'ghost', body: '() => 1' }, scopeB)
    expect(handlerDef('ghost', DEFAULT_SCOPE)).toBeUndefined()
    expect(handlerDef('ghost')).toBeUndefined()
  })
})

describe('D3 — byId/resolveNodeRef/registered are per-scope', () => {
  it('two isolated graphs with the SAME node id never address each other', () => {
    const scopeA = createIsolatedScope()
    const scopeB = createIsolatedScope()
    const nodeA = new Node({ type: 'div' }, hub(), 'shared-id', undefined, scopeA)
    const nodeB = new Node({ type: 'div' }, hub(), 'shared-id', undefined, scopeB)
    expect(resolveNodeRef('shared-id', scopeB)).toBe(nodeB)
    expect(resolveNodeRef('shared-id', scopeA)).toBe(nodeA)
    // neither isolated node leaks into the shared default (both are opt-in)
    expect(resolveNodeRef('shared-id')).toBeUndefined()
  })

  it('an isolated graph node never leaks into another scope registered set', () => {
    const scopeA = createIsolatedScope()
    const scopeB = createIsolatedScope()
    const nodeA = new Node({ type: 'div' }, hub(), 'leak-a', undefined, scopeA)
    expect(scopeB.registered.has(nodeA)).toBe(false)
    expect(scopeB.byId.has('leak-a')).toBe(false)
    expect(scopeA.registered.has(nodeA)).toBe(true)
  })
})

describe('D4 — translateUserData is per-scope', () => {
  it('graph A userData is NOT visible in isolated graph B', () => {
    const scopeA = createIsolatedScope()
    const scopeB = createIsolatedScope()
    setTranslateUserData('A-secret', scopeA)
    expect(getTranslateUserData(scopeB)).toBeUndefined()
    expect(getTranslateUserData(scopeA)).toBe('A-secret')
    // the shared default carries only what the shared path wrote
    expect(getTranslateUserData(DEFAULT_SCOPE)).toBeUndefined()
  })
})

describe('D5 — a graph-A removeLayer never cross-destroys graph-B minted set', () => {
  it('same layerId + same node id in two isolated graphs: A teardown leaves B alive', async () => {
    const scopeA = createIsolatedScope()
    const scopeB = createIsolatedScope()
    const hubA = hub()
    const hubB = hub()
    const creatorA = new Node({ type: 'section' }, hubA, 'creator-a', undefined, scopeA)
    const creatorB = new Node({ type: 'section' }, hubB, 'creator-b', undefined, scopeB)
    const mintA = new Node({ type: 'span', props: { id: 'm1' } }, hubA, 'm1', undefined, scopeA)
    const mintB = new Node({ type: 'span', props: { id: 'm1' } }, hubB, 'm1', undefined, scopeB)
    childOf(creatorA, mintA)
    childOf(creatorB, mintB)
    registerMinted(mintA.id, 'inject-1', scopeA)
    registerMinted(mintB.id, 'inject-1', scopeB)
    // the layer must EXIST on the creator for removeLayer to fire the teardown
    creatorA.addLayer({ id: 'inject-1' })
    creatorB.addLayer({ id: 'inject-1' })
    expect(mintedByOrigin('inject-1', scopeB)).toContain('m1')

    creatorA.removeLayer('inject-1') // A tears down its minted set under 'inject-1'
    await flushSweep()

    // B's minted node under the SAME layerId/node-id must survive
    expect(mintB.destroyed).toBe(false)
    expect(mintB.childAnchor()).not.toBeNull()
    expect(mintedByOrigin('inject-1', scopeB)).toContain('m1')
    expect(mintedByOrigin('inject-1', scopeA)).toEqual([])
  })
})

describe('D6 — a destroy in graph A does not finalize/evict graph B nodes (one sweep, per-scope partition)', () => {
  it('same-id graph B node stays registered + resolvable after A\'s destroy sweeps', async () => {
    const scopeA = createIsolatedScope()
    const scopeB = createIsolatedScope()
    const nodeA = new Node({ type: 'div' }, hub(), 'id', undefined, scopeA)
    const nodeB = new Node({ type: 'div' }, hub(), 'id', undefined, scopeB)

    nodeA.destroy()
    await flushSweep()

    expect(nodeB.destroyed).toBe(false)
    expect(scopeB.registered.has(nodeB)).toBe(true)
    expect(resolveNodeRef('id', scopeB)).toBe(nodeB)
  })
})

describe('D8 — the default (no opt-in) stays the shared module singleton', () => {
  it('DEFAULT_SCOPE IS the module singleton the accessors read by default', () => {
    expect(DEFAULT_SCOPE.registered).toBe(registered)
    const a = createIsolatedScope()
    expect(a).not.toBe(DEFAULT_SCOPE)
    expect(a.registered).not.toBe(registered)
  })

  it('an unopt host (no graphScope) still shares one byId across graphs — the existing cross-graph default', () => {
    // the smoke's same-id re-seeded graphs share byId; register two default nodes
    const a = new Node({ type: 'div' }, hub(), 'shared-default')
    const b = new Node({ type: 'div' }, hub(), 'shared-default')
    expect(resolveNodeRef('shared-default')).toBe(b)
    expect(registered.has(a)).toBe(true)
    expect(registered.has(b)).toBe(true)
  })
})
