// REQ-GAP-11 — destroyed-node self-eviction (handoffs-review-2.md §REQ-GAP-11
// + the 2026-08-21 amendment): destroyed nodes must stop accumulating in the
// module-level registry (`registered`/`byId`) and in the per-supervisor maps
// (`this.nodes` → `allNodes()`), so long-lived hosts see the live-tree
// baseline after teardown. The retention letter (walk/anchors slot stability)
// stays intact: a destroyed node's family slot + `getNode` resolution persist;
// only the scan surfaces (allNodes/registered) drop it. NO new public surface.
import { describe, it, expect } from 'vitest'
import { Supervisor, Node } from '../../src/core/node.js'
import { createClient } from '../../src/core/client.js'
import {
  registered,
  resolveNodeRef,
  isContentNode,
  registerContentNode,
} from '../../src/core/registry.js'
import { makeRoot, makeNode, makePrototype, childOf } from '../helpers/fixtures.js'

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function supOf(root: Node, ...rest: Node[]): Supervisor {
  const nodes = new Map<string, Node>()
  nodes.set(root.id, root)
  for (const n of rest) nodes.set(n.id, n)
  return new Supervisor(root, nodes)
}

describe('REQ-GAP-11 — sweep eviction: destroyed nodes leave the registries', () => {
  it('destroy N plain family nodes → registered/byId/allNodes() return to the live-tree baseline', async () => {
    const root = makeRoot()
    const kids = Array.from({ length: 5 }, () => childOf(root, makeNode()))
    const sup = supOf(root, ...kids)
    const baseline = registered.size

    for (const k of kids) {
      const res = sup.apply({ kind: 'destroy', node: k })
      expect(res.status).toBe('applied')
    }
    // the op evicts the target synchronously (both destroy branches)
    expect(registered.size).toBe(baseline - kids.length)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id])
    expect(resolveNodeRef(kids[0]!.id)).toBeUndefined()

    await flushSweep()
    expect(kids.every((k) => k.destroyed)).toBe(true)
    expect(registered.size).toBe(baseline - kids.length)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id])
    expect(root.children).toHaveLength(0)
  })

  it('destroy a parent with family descendants → the whole doomed subtree is evicted by the sweep', async () => {
    const root = makeRoot()
    const parent = childOf(root, makeNode())
    const kids = [childOf(parent, makeNode()), childOf(parent, makeNode())]
    const sup = supOf(root, parent, ...kids)
    const baseline = registered.size

    sup.apply({ kind: 'destroy', node: parent })
    await flushSweep()

    expect(parent.destroyed).toBe(true)
    expect(kids.every((k) => k.destroyed)).toBe(true)
    expect(registered.size).toBe(baseline - 3)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id])
    expect(resolveNodeRef(kids[0]!.id)).toBeUndefined()
    expect(root.children).toHaveLength(0)
  })

  it('destroy N runtimeMinted clones (clone-instance) → evicted AND the walk slot stays stable', async () => {
    const root = makeRoot()
    const proto = makePrototype()
    const sup = supOf(root, proto)
    const cloneIds: string[] = []
    for (let i = 0; i < 3; i += 1) {
      const res = sup.apply({ kind: 'clone-instance', source: proto, slot: root, priority: i })
      expect(res.status).toBe('applied')
    }
    const clones = root.children
    expect(clones).toHaveLength(3)
    expect(clones.every((c) => c.runtimeMinted)).toBe(true)
    cloneIds.push(...clones.map((c) => c.id))
    const baseline = registered.size

    for (const c of clones) {
      const res = sup.apply({ kind: 'destroy', node: c })
      expect(res.status).toBe('applied')
    }
    // markDestroyed branch: no sweep scheduled — eviction is synchronous
    await flushSweep()
    expect(clones.every((c) => c.destroyed)).toBe(true)
    expect(registered.size).toBe(baseline - 3)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id, proto.id])
    expect(resolveNodeRef(cloneIds[0]!)).toBeUndefined()
    // retention half: the family walk keeps every slot position stable
    expect(root.children.map((c) => c.id)).toEqual(cloneIds)
    expect(clones[0]!.parent).toBe(root)
    // and the destroyed node stays resolvable (getNode tombstone) so stale
    // refs gate no-usable-state instead of unknown-node
    expect(sup.getNode(cloneIds[0]!)).toBe(clones[0])
  })

  it('destroy a content-owned node explicitly → contentNodes no longer holds it', async () => {
    const root = makeRoot()
    const owned = childOf(root, makeNode())
    registerContentNode(owned)
    expect(isContentNode(owned)).toBe(true)
    const sup = supOf(root, owned)

    sup.apply({ kind: 'destroy', node: owned })
    await flushSweep()

    expect(owned.destroyed).toBe(true)
    expect(isContentNode(owned)).toBe(false)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id])
  })

  it('two supervisors in one process — evicting graph A\u2019s node never touches graph B\u2019s nodes', async () => {
    const rootA = makeRoot()
    const kidA = childOf(rootA, makeNode())
    const rootB = makeRoot()
    const kidB = childOf(rootB, makeNode())
    const supA = supOf(rootA, kidA)
    const supB = supOf(rootB, kidB)

    supA.apply({ kind: 'destroy', node: kidA })
    await flushSweep()

    expect(kidA.destroyed).toBe(true)
    expect(kidB.destroyed).toBe(false)
    expect(supA.allNodes().map((n) => n.id)).toEqual([rootA.id])
    expect(supB.allNodes().map((n) => n.id)).toEqual([rootB.id, kidB.id])
    expect(resolveNodeRef(kidB.id)).toBe(kidB)
    expect(registered.has(kidB)).toBe(true)
  })

  it('in-tree/prototype nodes are NEVER evicted (permanent-owner gate)', async () => {
    const root = makeRoot()
    const proto = makePrototype()
    const plain = childOf(root, makeNode())
    const sup = supOf(root, proto, plain)

    sup.apply({ kind: 'destroy', node: plain })
    await flushSweep()

    expect(plain.destroyed).toBe(true)
    expect(plain.state).toBe('destroyed')
    expect(registered.has(root)).toBe(true)
    expect(registered.has(proto)).toBe(true)
    expect(resolveNodeRef(root.id)).toBe(root)
    expect(resolveNodeRef(proto.id)).toBe(proto)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id, proto.id])
  })

  it('the destroy→re-attach rescue race (F17) keeps the rescued child registered + resolvable', async () => {
    const root = makeRoot()
    const parent = childOf(root, makeNode())
    const child = childOf(parent, makeNode())
    const sup = supOf(root, parent, child)

    sup.apply({ kind: 'destroy', node: parent })
    // re-attach the child to the root BEFORE the sweep (the managed channel)
    const res = sup.apply({ kind: 'move', node: child, to: { parent: root } })
    expect(res.status).toBe('applied')
    await flushSweep()

    expect(parent.destroyed).toBe(true)
    expect(child.destroyed).toBe(false)
    expect(child.state).toBe('in-tree')
    expect(sup.getNode(child.id)).toBe(child)
    expect(sup.allNodes().map((n) => n.id)).toEqual([root.id, child.id])
    expect(registered.has(child)).toBe(true)
    expect(resolveNodeRef(child.id)).toBe(child)
  })

  it('applying to a destroyed node id still gates no-usable-state (T4 contract, not unknown-node)', async () => {
    const root = makeRoot()
    const victim = childOf(root, makeNode())
    const sup = supOf(root, victim)
    const clientAPI = createClient(sup)

    const destroy = clientAPI.apply(victim.id, { kind: 'destroy', node: victim.id })
    expect(destroy.status).toBe('applied')
    await flushSweep()
    expect(victim.destroyed).toBe(true)

    const res = clientAPI.apply(victim.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }])
    expect(res.status).toBe('no-usable-state')
    expect((res as { nodeState?: string }).nodeState).toBe('destroyed')
    void root
  })

  it('two supervisors sharing one destroyed node\u2019s id space: tombstone resolution is per-supervisor', async () => {
    const rootA = makeRoot()
    const kidA = childOf(rootA, makeNode())
    const rootB = makeRoot()
    const kidB = childOf(rootB, makeNode())
    const supA = supOf(rootA, kidA)
    const supB = supOf(rootB, kidB)
    const clientB = createClient(supB)

    supA.apply({ kind: 'destroy', node: kidA })
    await flushSweep()

    // B's live id must NOT be tombstoned by A's destroy
    const res = clientB.apply(kidB.id, [{ targetProp: 'content', mode: 'replace', value: 'y' }])
    expect(res.status).toBe('applied')
    expect(kidB.content).toBe('y')
  })

  it('SAME node id on two graphs: graph A\u2019s destroy never evicts graph B\u2019s re-seeded entry (the loadState re-seed collision)', async () => {
    // The smoke runs several loadState-re-seeded graphs in ONE process; the
    // re-seeded graphs carry the SAME node ids. The eviction must be
    // INSTANCE-guarded: an id-keyed delete would remove graph B's live entry
    // when graph A's deferred sweep fires mid-run (observed mode-toggle flake,
    // fixed 2026-08-22).
    const rootA = makeRoot({ type: 'div' }, 'shared-root')
    const kidA = childOf(rootA, makeNode({ type: 'span' }, 'shared-kid'))
    const rootB = makeRoot({ type: 'div' }, 'shared-root')
    const kidB = childOf(rootB, makeNode({ type: 'span' }, 'shared-kid'))
    const supA = supOf(rootA, kidA)
    const supB = supOf(rootB, kidB)
    const clientB = createClient(supB)

    supA.apply({ kind: 'destroy', node: kidA })
    await flushSweep()

    // B's same-id node survives: registered holds B's instance, byId resolves
    // to B's instance, and B's supervisor still owns it (allNodes).
    expect(registered.has(kidB)).toBe(true)
    expect(resolveNodeRef('shared-kid')).toBe(kidB)
    expect(supB.allNodes().map((n) => n.id)).toContain('shared-kid')
    expect(supB.getNode('shared-kid')).toBe(kidB)

    // B can still mutate its own node (the managed channel sees a live node)
    const res = clientB.apply(kidB.id, [{ targetProp: 'content', mode: 'replace', value: 'z' }])
    expect(res.status).toBe('applied')
    expect(kidB.content).toBe('z')
    // ...and A's destroyed node stays destroyed + tombstoned on A only
    expect(kidA.destroyed).toBe(true)
    expect(supA.getNode('shared-kid')).toBe(kidA)
    expect(supA.allNodes().map((n) => n.id)).not.toContain('shared-kid')
  })
})