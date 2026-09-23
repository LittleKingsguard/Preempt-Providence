/**
 * ENG-SUPERVISOR-HOOK-ACCUMULATION — `Supervisor.dispose()` (Astrographer
 * handoff, gate docs/specs/handoffs-review-10.md §5.2). TDD red set — written
 * BEFORE implementation.
 *
 * The defect: each `new Supervisor` registers a MODULE-LEVEL `onNodeFinalized`
 * hook that is never removed, so a discarded Supervisor (and its node map) is
 * retained forever. The fix: `onNodeFinalized` returns an idempotent
 * unsubscribe, a `finalizeHookCount()` diagnostic exposes the registry size,
 * and `Supervisor.dispose()` unregisters + clears its maps.
 */
import { describe, it, expect } from 'vitest'
import {
  onNodeFinalized,
  finalizeHookCount,
  drainPendingDestroy,
} from '../../src/core/registry.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { makeRoot, makeNode, childOf } from '../helpers/fixtures.js'

describe('ENG-SUPERVISOR-HOOK-ACCUMULATION — finalize-hook unsubscribe', () => {
  it('onNodeFinalized returns an idempotent unsubscribe that stops the hook firing', () => {
    const before = finalizeHookCount()
    let called = 0
    const un = onNodeFinalized(() => {
      called += 1
    })
    expect(finalizeHookCount()).toBe(before + 1)

    un()
    un() // idempotent
    expect(finalizeHookCount()).toBe(before)

    const root = makeRoot()
    const doomed = childOf(root, makeNode())
    doomed.destroy()
    drainPendingDestroy()
    expect(called).toBe(0)
  })
})

describe('ENG-SUPERVISOR-HOOK-ACCUMULATION — Supervisor.dispose()', () => {
  it('dispose unregisters exactly its OWN hook (another Supervisor is unaffected)', () => {
    const base = finalizeHookCount()
    const a = new Supervisor({})
    const b = new Supervisor({})
    expect(finalizeHookCount()).toBe(base + 2)

    a.dispose()
    expect(finalizeHookCount()).toBe(base + 1)

    b.dispose()
    expect(finalizeHookCount()).toBe(base)
  })

  it('dispose clears the node maps and is idempotent', () => {
    const root = makeRoot()
    const sup = new Supervisor(root)
    expect(sup.getNode(root.id)).toBe(root)
    expect(sup.allNodes()).toHaveLength(1)

    sup.dispose()
    expect(sup.getNode(root.id)).toBeUndefined()
    expect(sup.allNodes()).toHaveLength(0)

    // double-dispose does not throw and did not touch another hook
    const base = finalizeHookCount()
    expect(() => sup.dispose()).not.toThrow()
    expect(finalizeHookCount()).toBe(base)
  })
})
