/**
 * ENG-DESTROY-PLACEMENT-ANCHOR-RESIDUE — destroy dissolves placement anchors
 * (Astrographer handoff, gate docs/specs/handoffs-review-10.md §5.3). TDD red
 * set — written BEFORE implementation.
 *
 * The defect: `Node.destroyLinks` dissolves only `child`-role anchors; the
 * node's `container`/`content` placement anchors survive, so the shared per-name
 * placement Link accumulates a stale anchor per destroyed root. The fix detaches
 * ONLY the destroyed node's anchors (never `link.destroy()`, which would dissolve
 * other nodes' anchors).
 */
import { describe, it, expect } from 'vitest'
import { drainPendingDestroy } from '../../src/core/registry.js'
import { makeNode, hub } from '../helpers/fixtures.js'

describe('ENG-DESTROY-PLACEMENT-ANCHOR-RESIDUE — destroyLinks dissolves placement anchors', () => {
  it('a destroyed container dissolver: node.anchors + the shared Link drop the anchor', () => {
    const link = hub().linkFor('slot-a', 'placement')
    const zone = makeNode()
    const anchor = zone.addAnchor('container', 'slot-a', {}, link)!
    expect(anchor).not.toBeNull()
    expect(link.anchorsOf('container')).toHaveLength(1)

    zone.destroyLinks()
    drainPendingDestroy()

    expect(zone.anchors.includes(anchor)).toBe(false)
    expect(link.anchorsOf('container')).toHaveLength(0)
  })

  it('a destroyed consumer drops only ITS content anchor — siblings survive', () => {
    const link = hub().linkFor('slot-a', 'placement')
    const consumerA = makeNode()
    const consumerB = makeNode()
    consumerA.addAnchor('content', 'slot-a', {}, link)
    consumerB.addAnchor('content', 'slot-a', {}, link)
    expect(link.anchorsOf('content')).toHaveLength(2)

    consumerA.destroyLinks()
    drainPendingDestroy()

    const remaining = link.anchorsOf('content')
    expect(remaining).toHaveLength(1)
    expect(remaining[0]!.owner).toBe(consumerB)
  })

  it('destroying a producer leaves its consumers intact', () => {
    const link = hub().linkFor('slot-a', 'placement')
    const producer = makeNode()
    const consumerA = makeNode()
    const consumerB = makeNode()
    producer.addAnchor('container', 'slot-a', {}, link)
    consumerA.addAnchor('content', 'slot-a', {}, link)
    consumerB.addAnchor('content', 'slot-a', {}, link)

    producer.destroyLinks()
    drainPendingDestroy()

    expect(link.anchorsOf('container')).toHaveLength(0)
    expect(link.anchorsOf('content')).toHaveLength(2)
  })
})
