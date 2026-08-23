/**
 * REQ-GAP-12 (handoffs-review-2 §REQ-GAP-12, user ruling 1, 2026-08-21) — the
 * explicit-destroy cascade trigger flag: the destroy op marks the destroy as
 * cascade-capable; the sweep's `finalizeDestroyed` then recurses into the
 * destroyed node's EXPLICIT (family parent-child) children — INCLUDING
 * payload-owned content children — while SKIPPING placement-owned nodes
 * (placement-may-return letter intact) and 'component'-token prototype nodes
 * (def/seam prototypes untouched). Teardown-to-root becomes ONE destroy op on
 * the tree owner (family trees were already O(1); payload trees become O(1)).
 * The flag is internal state, never an op payload (journal shape unchanged).
 */
import { describe, it, expect } from 'vitest'
import { Supervisor } from '../../src/core/supervisor.js'
import type { Node } from '../../src/core/node.js'
import { registerContentNode, isContentNode, registered, resolveNodeRef } from '../../src/core/registry.js'
import { makeRoot, makeNode, makePrototype, childOf, hub } from '../helpers/fixtures.js'
import { placementAttach } from '../../src/core/ops.js'
import { appendToPayload, type Payload } from '../../src/core/payload.js'

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function supOf(root: Node, ...rest: Node[]): Supervisor {
  const nodes = new Map<string, Node>()
  nodes.set(root.id, root)
  for (const n of rest) nodes.set(n.id, n)
  return new Supervisor(root, nodes)
}

describe('REQ-GAP-12 — destroy-cascade: payload teardown-to-root in ONE destroy op', () => {
  it('destroy the OWNER → every explicit content child destroyed + unregistered from contentNodes (O(1) teardown)', async () => {
    const root = makeRoot()
    const owner = childOf(root, makeNode({ type: 'owner' }))
    const payload: Payload = { id: 'p', roots: [] }
    const kids = Array.from({ length: 5 }, (_, i) => makeNode({ type: 'div', content: `c${i}` }))
    appendToPayload(payload, kids, owner)
    expect(kids.every((k) => isContentNode(k))).toBe(true)
    const baseline = registered.size
    const sup = supOf(root, owner, ...kids)

    const res = sup.apply({ kind: 'destroy', node: owner })
    expect(res.status).toBe('applied')
    // ONE destroy op on the owner — no per-child destroy ops
    expect(sup.journal).toHaveLength(1)
    expect(sup.journal[0]!.op.kind).toBe('destroy')

    await flushSweep()
    expect(owner.destroyed).toBe(true)
    expect(kids.every((k) => k.destroyed)).toBe(true)
    expect(kids.every((k) => !isContentNode(k))).toBe(true)
    // REQ-GAP-11 integration: the whole doomed subtree left the registries
    expect(registered.size).toBe(baseline - 6)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id])
  })

  it('the cascade recurses through destroyed content children (grandchildren destroyed; placement-owned grandchildren skipped)', async () => {
    const root = makeRoot()
    const owner = childOf(root, makeNode({ type: 'owner' }))
    const mid = childOf(owner, makeNode({ type: 'mid' }))
    registerContentNode(mid)
    const deep = childOf(mid, makeNode({ type: 'deep' }))
    registerContentNode(deep)
    const placedDeep = childOf(mid, makeNode({ type: 'placed' }))
    registerContentNode(placedDeep)
    placementAttach(placedDeep, root, ['zone-b'], hub())
    const sup = supOf(root, owner, mid, deep, placedDeep)

    sup.apply({ kind: 'destroy', node: owner })
    await flushSweep()

    expect(mid.destroyed).toBe(true)
    expect(deep.destroyed).toBe(true)
    expect(placedDeep.destroyed).toBe(false)
    expect(isContentNode(placedDeep)).toBe(true)
  })

  it('placement-owned children survive an owner destroy (placement-may-return letter intact)', async () => {
    const root = makeRoot()
    const owner = childOf(root, makeNode({ type: 'owner' }))
    const placed = childOf(owner, makeNode({ type: 'div' }))
    registerContentNode(placed)
    placementAttach(placed, owner, ['zone-a'], hub())
    expect(placed.anchors.some((a) => a.role === 'content')).toBe(true)
    const plain = childOf(owner, makeNode({ type: 'div' }))
    registerContentNode(plain)
    const sup = supOf(root, owner, placed, plain)

    sup.apply({ kind: 'destroy', node: owner })
    await flushSweep()

    expect(owner.destroyed).toBe(true)
    // placement-owned: survives, still payload-owned (placement may return)
    expect(placed.destroyed).toBe(false)
    expect(isContentNode(placed)).toBe(true)
    expect(placed.anchors.some((a) => a.role === 'content')).toBe(true)
    // plain payload content: cascaded with its owner
    expect(plain.destroyed).toBe(true)
    expect(isContentNode(plain)).toBe(false)
  })

  it("'component'-token prototype children survive an owner destroy (def/seam prototypes untouched)", async () => {
    const root = makeRoot()
    // the def-root pattern (translate.ts mintDefPrototypes): the def-root is
    // 'component'-token-terminated (out-of-tree prototype, never renders); the
    // def children are family children of the def-root — their chain
    // terminates at the 'component' token via the def-root, so their state is
    // 'prototype'
    const defRoot = makePrototype({ type: 'def-root' })
    const defKids = [childOf(defRoot, makeNode({ type: 'def-child' })), childOf(defRoot, makeNode({ type: 'def-child' }))]
    expect(defKids.every((k) => k.state === 'prototype')).toBe(true)
    const sup = supOf(root, defRoot, ...defKids)

    sup.apply({ kind: 'destroy', node: defRoot })
    await flushSweep()

    expect(defRoot.destroyed).toBe(true)
    // def/seam prototypes untouched: never destroyed, never evicted by the
    // cascade (they read 'unplaced' only because the defRoot's own destroy
    // dissolved its token edge — they were never rendered either way)
    expect(defKids.every((k) => k.destroyed)).toBe(false)
    expect(defKids.every((k) => resolveNodeRef(k.id) === k)).toBe(true)
    expect(defKids.every((k) => k.state === 'unplaced')).toBe(true)
  })

  it('retention split: runtimeMinted children are markDestroyed by the cascade (walk slots stable — parent still lists them)', async () => {
    const root = makeRoot()
    const proto = makePrototype()
    const owner = childOf(root, makeNode({ type: 'owner' }))
    const sup = supOf(root, proto, owner)
    const ids: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const res = sup.apply({ kind: 'clone-instance', source: proto, slot: owner, priority: i })
      expect(res.status).toBe('applied')
      ids.push((res.dirtied as string[])[0]!)
    }
    const clones = owner.children
    expect(clones).toHaveLength(3)
    expect(clones.every((c) => c.runtimeMinted)).toBe(true)
    const ownerRef = owner.id

    sup.apply({ kind: 'destroy', node: owner })
    await flushSweep()

    expect(owner.destroyed).toBe(true)
    // retention half: marked destroyed, NOT dissolved — the family walk keeps
    // every slot position stable (the destroyed owner's children list intact)
    expect(clones.every((c) => c.destroyed)).toBe(true)
    expect(sup.getNode(ownerRef)!.children.map((c) => c.id)).toEqual(ids)
    expect(clones[0]!.parent).toBe(owner)
    expect(clones.every((c) => c.runtimeMinted)).toBe(true)
  })

  it('replay-safe: the journal entry shape is UNCHANGED (the flag is internal, never an op payload)', async () => {
    const root = makeRoot()
    const owner = childOf(root, makeNode({ type: 'owner' }))
    const kid = childOf(owner, makeNode())
    registerContentNode(kid)
    const sup = supOf(root, owner, kid)

    sup.apply({ kind: 'destroy', node: owner })
    await flushSweep()

    const entry = sup.journal[0]!
    expect(entry.op.kind).toBe('destroy')
    expect(Object.keys(entry.op).sort()).toEqual(['kind', 'node'])
    // the flag is internal state, never an op payload field
    expect(Object.keys(entry.op).some((k) => k.toLowerCase().includes('cascade'))).toBe(false)
    expect(entry.result.status).toBe('applied')
  })

  it('detached payload content (non-destroy path) still persists — the relaxation is destroy-op-scoped', async () => {
    const root = makeRoot()
    const owner = childOf(root, makeNode({ type: 'owner' }))
    const kid = childOf(owner, makeNode())
    registerContentNode(kid)
    const sup = supOf(root, owner, kid)

    // the owner is DETACHED (orphaned), never explicitly destroyed
    sup.apply({ kind: 'detach', node: owner })
    await flushSweep()

    expect(owner.destroyed).toBe(true)
    // the content exemption holds on the non-destroy path: the payload-owned
    // child persists in the background (placement may return)
    expect(kid.destroyed).toBe(false)
    expect(isContentNode(kid)).toBe(true)
  })
})