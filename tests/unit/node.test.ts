/**
 * `Node` behavior contract — docs/specs/node.md TestWriter matrix (§4–§10).
 * Red-state TDD: `../src/core/*.js` does not exist yet. Every scenario is
 * assembled through the public fixtures (tests/helpers/fixtures.ts) and
 * observed only via the `Node`/`Link` surface in contract.md.
 */
import { describe, it, expect, vi } from 'vitest'
import { Node, mintNodeId, MAX_COMPILE_DEPTH, reconcileParentTargets } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { LinkConfigError, SingleParentError, CycleError } from '../../src/core/errors.js'
import { applyStateSlice } from '../../src/core/ops.js'
import { SliceLock } from '../../src/core/pipeline.js'
import { serializeNode } from '../../src/core/serialize.js'
import { translateLegacy, reverseTranslate } from '../../src/core/translate.js'
import { emitElements } from '../../src/core/render-helpers.js'
import type { NodeBaseData, NodeState, Anchor, CompileResult, LayerMutation } from '../../src/core/types.js'
import {
  makeRoot,
  makeNode,
  makePrototype,
  childOf,
  hub,
  anchorsOf,
  addComponentSource,
  targetAnchor,
  familyLink,
} from '../helpers/fixtures.js'

/** Drain the render-microtask sweep (cascade-destroy + pass-2) to completion. */
async function drainSweep(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise<void>(r => queueMicrotask(r))
  await new Promise<void>(r => setTimeout(r, 0))
}

/** True when the thrown value is an Error carrying the machine-readable `code`. */
function hasCode(e: unknown, code: string): boolean {
  return e instanceof Error && 'code' in e && (e as { code?: unknown }).code === code
}

/** Assert a function throws an Error whose `code` property matches. */
function expectCode(fn: () => unknown, code: string): void {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(Error)
  expect(hasCode(thrown, code)).toBe(true)
}

/** Serialize an AnchorTarget to a stable string token (C2, §9 rollback proofs). */
function targetKey(a: Anchor['target']): string {
  return typeof a === 'string' ? `token:${a}` : `node:${a.id}`
}

/** Order-preserving "byte" image of a node's own anchor set. */
function nodeKey(n: Node): string {
  return n.anchors.map(a => `${a.role}@${targetKey(a.target)}:${JSON.stringify(a.options)}`).join('|')
}

describe('constructor — §4 post-conditions', () => {
  it('P1 id minted and unique process-wide; auto-IDs filled into props/css when absent (S3.1)', () => {
    const a = new Node({ type: 'div' }, hub())
    const b = new Node({ type: 'div' }, hub())
    expect(a.id).not.toBe(b.id)
    const m1 = mintNodeId()
    const m2 = mintNodeId()
    expect(m1).not.toBe(m2)
    expect(new Set([a.id, b.id, m1, m2]).size).toBe(4)

    const fixed = new Node({ type: 'img', props: {} }, hub(), 'fixed-id')
    expect(fixed.id).toBe('fixed-id')
    expect(typeof fixed.props.id).toBe('string')
    expect(String(fixed.props.id).startsWith('preempt-node-')).toBe(true)
  })

  it('P2 base is frozen (readonly canon); seed layers appended', () => {
    const seed: NodeBaseData = { type: 'box', props: { a: 1 } }
    const n = new Node(seed, hub())
    expect(Object.isFrozen(n.base)).toBe(true)
    expect(n.base.type).toBe('box')
    expect(n.layers.length).toBeGreaterThan(0)
  })

  it('P3 compileLocal ran once: anchors materialized, pass-1 cache valid', () => {
    const n = new Node({ type: 'text', props: { title: 'T' }, content: 'hi' }, hub())
    expect(Array.isArray(n.anchors)).toBe(true)
    expect(n.type).toBe('text')
    expect(n.props.title).toBe('T')
    expect(n.content).toBe('hi')
  })

  it('P4 state derives from the seed parent-link chain per permanent owner', () => {
    expect(makeRoot().state).toBe('in-tree')
    expect(makePrototype().state).toBe('prototype')
    expect(makeNode().state).toBe('unplaced')
    expect(makeRoot().isInTree).toBe(true)
    expect(makePrototype().isInTree).toBe(false)
    expect(makeNode().isInTree).toBe(false)
  })

  it('P5 dirty starts empty; no Link is shared with any other node', () => {
    const a = new Node({ type: 'div' }, hub())
    const b = new Node({ type: 'span' }, hub())
    expect(a.dirty.size).toBe(0)
    expect(b.dirty.size).toBe(0)

    const ra = makeRoot()
    const rb = makeRoot()
    const linkA = anchorsOf(ra, 'child')[0]?.link
    const linkB = anchorsOf(rb, 'child')[0]?.link
    expect(linkA).toBeDefined()
    expect(linkB).toBeDefined()
    expect(linkA).not.toBe(linkB)
    for (const anc of a.anchors) expect(anc.link).not.toBe(linkA)
    for (const anc of b.anchors) expect(anc.link).not.toBe(linkB)
    expect(ra.anchors.every(aN => aN.link !== linkB)).toBe(true)
    expect(rb.anchors.every(aN => aN.link !== linkA)).toBe(true)
  })
})

describe('absent fields — no write surface (§1.1/§3)', () => {
  it('A1 assigning node.parent is impossible at runtime', () => {
    const n = makeNode()
    const before = n.parent
    // @ts-expect-error — parent is a getter-only derived field
    expect(() => { n.parent = makeNode() }).toThrow(TypeError)
    expect(before).toBeNull()
  })

  it('A2 assigning node.children is impossible at runtime', () => {
    const n = makeNode()
    // @ts-expect-error — children is a getter-only derived array
    expect(() => { n.children = [] }).toThrow(TypeError)
    expect(n.children).toHaveLength(0)
  })

  it('A3 assigning node.state is impossible at runtime', () => {
    const n = makeNode()
    // @ts-expect-error — state is derived, never written
    expect(() => { n.state = 'in-tree' }).toThrow(TypeError)
    expect(n.state).toBe('unplaced')
  })

  it('A4 assignment to node.anchors is impossible (reconciled materialization)', () => {
    const n = makeNode()
    const before = n.anchors
    // @ts-expect-error — anchors is a readonly reconciled exposure
    expect(() => { n.anchors = [] }).toThrow(TypeError)
    expect(n.anchors).toEqual(before)
  })

  it('A5 legacy fields (nodeState / _referencingNodes / setters) are gone', () => {
    const n = makeNode()
    const probe = n as unknown as Record<string, unknown>
    expect(probe._referencingNodes).toBeUndefined()
    expect(probe.nodeState).toBeUndefined()
    expect(probe.setParent).toBeUndefined()
    expect(probe.setContent).toBeUndefined()
  })
})

describe('getters — all setter-less, all derived (§5)', () => {
  it('D-1 state derives from the ≤1 child anchor → link → parent-anchor target chain', () => {
    const root = makeRoot()
    const inside = childOf(root, makeNode())
    expect(inside.state).toBe('in-tree')
    const proto = makePrototype()
    const underProto = childOf(proto, makeNode())
    expect(underProto.state).toBe('prototype')
    const lone = makeNode()
    expect(lone.state).toBe('unplaced')
  })

  it('D-2 isInTree() is the only legal membership predicate', () => {
    const root = makeRoot()
    const inside = childOf(root, makeNode())
    expect(root.isInTree).toBe(true)
    expect(inside.isInTree).toBe(true)
    expect(makePrototype().isInTree).toBe(false)
    expect(makeNode().isInTree).toBe(false)
  })

  it('D-3 parent resolves via the child anchor → link → parent anchor → node (O(1))', () => {
    const root = makeRoot()
    const kid = makeNode({ type: 'kid' })
    childOf(root, kid)
    expect(kid.parent).toBe(root)
  })

  it('D-4 null-parent shapes are disambiguated by .state: token-chain vs no-child', () => {
    const root = makeRoot()          // chain ends at 'rootNode' → parent null, still in-tree
    const lone = makeNode()          // no child anchor → parent null, unplaced
    expect(root.parent).toBeNull()
    expect(lone.parent).toBeNull()
    expect(root.state).toBe('in-tree')
    expect(lone.state).toBe('unplaced')
  })

  it('D-5 children are priority-sorted from the family Link child anchors (S3.2)', () => {
    const root = makeRoot()
    const mid = childOf(root, makeNode({ type: 'mid' }), 20)
    const first = childOf(root, makeNode({ type: 'first' }), 10)
    const last = childOf(root, makeNode({ type: 'last' }), 30)
    expect(root.children.map(c => c.id)).toEqual([first.id, mid.id, last.id])
  })

  it('D-6 a node without a parent anchor reports [] children (SI-2)', () => {
    const lone = makeNode()
    expect(lone.children).toHaveLength(0)
  })

  it('D-7 value getters type/props/css/content read the pass-1 cache', () => {
    const n = makeNode({ type: 'div', props: { title: 'T' }, content: 'hello' })
    expect(n.type).toBe('div')
    expect(n.props.title).toBe('T')
    expect(n.content).toBe('hello')
  })
})

describe('methods — mutating surface inside an op (§6.1–§6.5)', () => {
  it('M-1 addLayer appends to the canon and re-runs compileLocal synchronously', () => {
    const n = makeNode({ type: 'base' })
    expect(n.type).toBe('base')
    n.addLayer({ id: 'l1', type: 'section' })
    expect(n.layers.some(l => l.id === 'l1')).toBe(true)
    expect(n.type).toBe('section')
  })

  it('M-2 an anchor-carrying layer is materialized and flagged anchor-populate (S-R3.12)', () => {
    const n = makeNode()
    const before = n.anchors.length
    n.addLayer({ id: 'l-anchor', anchors: [{ role: 'target', target: 'theme' }] })
    expect(n.anchors.length).toBe(before + 1)
    expect(n.dirty.has('anchor-populate')).toBe(true)
  })

  it('M-3 addLayer marks remote dependents dirty — own pass-1 is synchronous, remote stale', () => {
    const root = makeRoot()
    const kid = childOf(root, makeNode())
    kid.addLayer({ id: 'fresh', type: 'n' })
    expect(kid.type).toBe('n')
    expect(root.dirty.has('remote')).toBe(true)
  })

  it('M-4 removeLayer is idempotent and value getters revert to the surviving stack', () => {
    const n = makeNode({ type: 'a' })
    n.addLayer({ id: 'l', type: 'b' })
    expect(n.type).toBe('b')
    n.removeLayer('l')
    expect(n.type).toBe('a')
    expect(n.layers.some(l => l.id === 'l')).toBe(false)
    expect(() => n.removeLayer('l')).not.toThrow()
  })

  it('M-5 removeLayersForSource drops every layer carrying that source, traceably', () => {
    const n = makeNode({ type: 'a' })
    n.addLayer({ id: 'b1', sourceName: 'sys', type: 'b' })
    n.addLayer({ id: 'b2', sourceName: 'sys', props: { k: 1 } })
    n.addLayer({ id: 'c', sourceName: 'client', type: 'c' })
    expect(n.type).toBe('c')
    n.removeLayersForSource('sys')
    expect(n.layers.filter(l => l.sourceName === 'sys')).toEqual([])
    expect(n.layers.some(l => l.id === 'c')).toBe(true)
    expect(n.type).toBe('c')
  })

  it('M-6 clone copies base + layers + anchor profile by default; fresh id; name-keyed links SHARED (DEFECT #9), family links fresh; runtime-minted flag set', () => {
    const src = makeNode({ type: 'box', props: { kind: 'copy' } })
    src.addLayer({ id: 'extra', type: 'flex' })
    addComponentSource(src, 'persona', { n: 1 })

    const copy = src.clone('actor')
    expect(copy).not.toBe(src)
    expect(copy.id).not.toBe(src.id)
    expect(copy.destroyed).toBe(false)
    expect(copy.state).toBe('unplaced')
    expect(copy.type).toBe('flex')
    expect(copy.layers.map(l => l.id)).toContain('extra')
    expect(copy.props.kind).toBe('copy')
    expect(copy.dirty.size).toBe(0)

    // DEFECT #9: NAME-KEYED anchors (source/target/duplex/container/content/
    // component) SHARE the original per-name registry link; fresh links are
    // only for genuinely new connections (the family-child attach case)
    for (const a of copy.anchors) {
      if (['source', 'target', 'duplex', 'component', 'container', 'content'].includes(a.role)) {
        expect(src.anchors.find((x) => x.role === a.role && x.target === a.target)?.link).toBe(a.link)
      }
    }
    expect(copy.runtimeMinted).toBe(true)
    expect(copy.anchors.map(a => a.role)).toEqual(src.anchors.map(a => a.role))
    // provider values ride along: a cloned source anchor keeps its value
    // (a clone of a data-declared provider is itself a provider)
    const srcSource = src.anchors.find(a => a.role === 'source' && a.target === 'persona')!
    const copySource = copy.anchors.find(a => a.role === 'source' && a.target === 'persona')!
    expect(copySource).toBeDefined()
    expect(copySource.value).toEqual(srcSource.value)
  })

  it('M-7 clone supports an ignore list for layer deviations (S1.4)', () => {
    const src = makeNode({ type: 'a' })
    src.addLayer({ id: 'to-drop', type: 'b' })
    src.addLayer({ id: 'keep', props: { k: 1 } })

    const copy = src.clone('actor', { ignore: ['to-drop'] })
    expect(copy.layers.some(l => l.id === 'to-drop')).toBe(false)
    expect(copy.layers.some(l => l.id === 'keep')).toBe(true)
  })

  it('M-8 clone of a destroyed source is rejected', async () => {
    const root = makeRoot()
    const victim = childOf(root, makeNode())
    victim.destroyLinks()
    await drainSweep()
    expect(victim.state).toBe('destroyed')
    expect(() => victim.clone('actor')).toThrow()
  })

  it('M-9 markDirty is an idempotent set-add', () => {
    const n = makeNode()
    n.markDirty('remote')
    n.markDirty('remote')
    n.markDirty('anchor-populate')
    expect(n.dirty.size).toBe(2)
    expect(n.dirty.has('remote')).toBe(true)
    expect(n.dirty.has('anchor-populate')).toBe(true)
  })

  it('M-10 destroyLinks dissolves edges with no synchronous "destroyed"; sweep makes it terminal', async () => {
    const root = makeRoot()
    const orphan = childOf(root, makeNode())
    orphan.destroyLinks()

    expect(anchorsOf(orphan, 'child')).toHaveLength(0)
    expect(orphan.destroyed).toBe(false)
    expect(orphan.state).toBe('unplaced')
    expect(root.children).toHaveLength(0)

    await drainSweep()
    expect(orphan.destroyed).toBe(true)
    expect(orphan.state).toBe('destroyed')
    expect(orphan.type).toBe('div')
  })
})

describe('lifecycle state machine — §7.2 transition rows', () => {
  it('T1 create without a parent link ⇒ unplaced (content node)', () => {
    expect(makeNode({ type: 'content' }).state).toBe('unplaced')
  })

  it('T2 construct a component prototype → prototype', () => {
    expect(makePrototype().state).toBe('prototype')
  })

  it('T3 construction of the supervisor root → in-tree', () => {
    expect(makeRoot().state).toBe('in-tree')
  })

  it('T4 unplaced → in-tree via attach whose resolved chain reaches the root', () => {
    const root = makeRoot()
    const n = makeNode()
    expect(n.state).toBe('unplaced')
    childOf(root, n)
    expect(n.state).toBe('in-tree')
  })

  it('T5 unplaced → prototype via attach into a component family', () => {
    const proto = makePrototype()
    const n = childOf(proto, makeNode())
    expect(n.state).toBe('prototype')
  })

  it('T6 a prototype never goes directly in-tree: its family edge blocks a 2nd child anchor; instantiation clones', () => {
    const proto = makePrototype()
    const root = makeRoot()
    const before = nodeKey(proto)
    try {
      childOf(root, proto)
    } catch (e) {
      expect(e).toBeInstanceOf(SingleParentError)
    }
    expect(nodeKey(proto)).toBe(before) // SI-1 held: rejected, unchanged
    expect(proto.state).toBe('prototype')
    expect(proto.isInTree).toBe(false)

    const copy = proto.clone('actor')
    expect(copy).not.toBe(proto)
    expect(copy.state).toBe('unplaced')
  })

  it('T7 in-tree → unplaced on detach (child anchor removed)', () => {
    const root = makeRoot()
    const n = childOf(root, makeNode())
    expect(n.state).toBe('in-tree')
    n.destroyLinks()
    expect(n.state).toBe('unplaced')
  })

  it('T8 in-tree → unplaced on last-child removal → link.destroy() → parent side dissolved (SI-2)', () => {
    const root = makeRoot()
    const solo = childOf(root, makeNode())
    const family = anchorsOf(solo, 'child')[0]?.link
    expect(family).toBeDefined()
    family?.destroy()
    expect(solo.state).toBe('unplaced')
    expect(anchorsOf(root, 'parent')).toHaveLength(0)
  })

  it('T9 prototype → unplaced once its links dissolve', () => {
    const proto = makePrototype()
    expect(proto.state).toBe('prototype')
    proto.destroyLinks()
    expect(proto.state).toBe('unplaced')
  })

  it('T10 any non-destroyed → destroyed via the post-op sweep only (never written synchronously)', async () => {
    const root = makeRoot()
    const orphan = childOf(root, makeNode())
    orphan.destroyLinks()
    expect(orphan.state).toBe('unplaced')
    expect(orphan.state).not.toBe('destroyed')
    await drainSweep()
    expect(orphan.state).toBe('destroyed')
  })

  it('T11 destroyed is terminal: no outgoing transitions; mutations rejected', async () => {
    const root = makeRoot()
    const n = childOf(root, makeNode({ type: 'x' }))
    n.destroyLinks()
    await drainSweep()
    expect(n.state).toBe('destroyed')
    expect(() => n.addLayer({ id: 'late', type: 'y' })).toThrow()
    expect(n.type).toBe('x')
  })
})

describe('cascade-destroy — async sweep semantics (§7.3)', () => {
  it('CS-1 orphaned nodes are swept to destroyed asynchronously, not synchronously', async () => {
    const root = makeRoot()
    const a = childOf(root, makeNode())
    const b = childOf(a, makeNode())
    const family = anchorsOf(b, 'child')[0]?.link
    family?.destroy()

    expect(b.state).toBe('unplaced')
    expect(b.state).not.toBe('destroyed')

    await drainSweep()

    expect(b.state).toBe('destroyed')
    expect(a.state).toBe('in-tree')
    expect(root.state).toBe('in-tree')
  })

  it('CS-2 a synchronous pre-sweep attach blocks destruction (parent + child side)', async () => {
    const root = makeRoot()
    const orphan = childOf(root, makeNode())
    const family = anchorsOf(orphan, 'child')[0]?.link
    family?.destroy()

    childOf(root, orphan)

    await drainSweep()

    expect(orphan.destroyed).toBe(false)
    expect(orphan.state).toBe('in-tree')
    expect(orphan.parent).toBe(root)
    expect(root.children.map(c => c.id)).toContain(orphan.id)
  })

  it('CS-3 permanent owners survive the sweep: rootNode / component / contentNodes', async () => {
    const root = makeRoot()
    const kid = childOf(root, makeNode())

    const proto = makePrototype()
    const frag = childOf(proto, makeNode())

    const cn = makeNode({ type: 'content' })
    const cnLink = new Link({ name: 'parent-child' })
    cn.addAnchor('parent', 'contentNodes', {}, cnLink)
    const cnChild = makeNode()
    const cnFamily = new Link({ name: 'parent-child' })
    cnChild.addAnchor('child', cnChild, {}, cnFamily)
    cnFamily.addAnchor({ role: 'parent', target: cn, options: {}, link: cnFamily })

    const lone = makeNode()
    const tempParent = makeNode()
    childOf(tempParent, lone)
    anchorsOf(lone, 'child')[0]?.link.destroy()

    await drainSweep()

    expect(root.state).toBe('in-tree')
    expect(kid.state).toBe('in-tree')
    expect(proto.state).toBe('prototype')
    expect(frag.state).toBe('prototype')
    expect(cn.destroyed).toBe(false)
    expect(cnChild.state).toBe('unplaced')
    expect(anchorsOf(cn, 'parent')).toHaveLength(1)
    expect(lone.state).toBe('destroyed')
  })
})

describe('two-pass compile — §8.1–§8.4', () => {
  it('C1 pass-1 is local-only: a lone in-tree root compiles with no graph walk', () => {
    const root = makeRoot({ type: 'div', props: { id: 'hero' } })
    const res = root.compile([root])
    expect(res.actionable).toHaveLength(1)
    const cs = res.actionable[0]
    expect(cs).toBeDefined()
    expect(cs?.type).toBe('div')
    expect(cs?.nodeId).toBe(root.id)
    expect(MAX_COMPILE_DEPTH).toBe(8)
  })

  it('C2 whole-slice pass-1 completes before any pass-2 walk (no mid-op walk)', () => {
    const root = makeRoot()
    const a = childOf(root, makeNode({ type: 'a' }))
    childOf(root, makeNode({ type: 'b' }))
    a.addLayer({ id: 'fresh', type: 'afresh' })

    const res = root.compile([root, a])
    const ca = res.actionable.find(s => s.nodeId === a.id)
    expect(ca?.type).toBe('afresh')
  })

  it('C3 pass-2 resolves parent/children from the family Link', () => {
    const root = makeRoot()
    const first = childOf(root, makeNode({ type: 'f' }), 5)
    const second = childOf(root, makeNode({ type: 's' }), 1)

    const res = root.compile([root, first, second])
    const csRoot = res.actionable.find(s => s.nodeId === root.id)
    const csFirst = res.actionable.find(s => s.nodeId === first.id)
    expect(csRoot?.children).toEqual([second.id, first.id])
    expect(csFirst?.parent).toBe(root.id)
  })

  it('C4 depth-0 first: a node resolving its own duplex source never walks', () => {
    const root = makeRoot()
    const a = childOf(root, makeNode())
    addComponentSource(a, 'mod', { origin: 'self' }, 'duplex')
    addComponentSource(root, 'mod', { origin: 'ancestor' })

    const res = root.compile([root, a])
    const cs = res.actionable.find(s => s.nodeId === a.id)
    expect((cs?.bindings['mod'] as { origin?: string } | undefined)?.origin).toBe('self')
  })

  it('C5 borrow walk: nearest source shadows the far root source', () => {
    const root = makeRoot()
    const mid = childOf(root, makeNode())
    const t = childOf(mid, makeNode())
    targetAnchor(t, 'res')
    addComponentSource(mid, 'res', { from: 'mid' })
    addComponentSource(root, 'res', { from: 'root' })

    const res = root.compile([root, mid, t])
    const cs = res.actionable.find(s => s.nodeId === t.id)
    expect((cs?.bindings['res'] as { from?: string } | undefined)?.from).toBe('mid')
  })

  it('C6 unresolved-reference → warning logged + node still renders its own state (S-R4.3)', () => {
    const root = makeRoot()
    const t = childOf(root, makeNode({ type: 'probe' }))
    targetAnchor(t, 'ghost') // no source anywhere

    const res = root.compile([root, t])
    expect(res.warnings.some(w => w.code === 'unresolved-reference' && w.pathKey.includes(t.id))).toBe(true)
    const cs = res.actionable.find(s => s.nodeId === t.id)
    expect(cs).toBeDefined()
    expect(cs?.type).toBe('probe')
    expect(cs?.unresolved.some(r => r.referenceName === 'ghost')).toBe(true)
  })

  it('C7 fork-arm: prototype-terminated is dropped SILENTLY', () => {
    const root = makeRoot()
    const consumer = childOf(root, makeNode())
    targetAnchor(consumer, 'viz')
    const proto = makePrototype()
    const src = childOf(proto, makeNode())
    addComponentSource(src, 'viz', { from: 'proto' })

    const res = root.compile([root, consumer, proto, src])
    expect(res.dropped.some(d => d.reason === 'prototype-terminated')).toBe(true)
    expect(res.warnings.some(w => w.code === 'unresolved-reference')).toBe(false)
    expect(res.actionable.find(s => s.nodeId === consumer.id)).toBeUndefined()
  })

  it('C7b fork-arm: prototype-terminated found through the per-name component LINK (provider NOT in the slice)', () => {
    // shared hub: same-name anchors share one component Link — the link IS
    // the registry of nodes relevant for the target, so the provider never
    // needs to be swept into the compile slice (no full-graph universe)
    const h = hub()
    const root = new Node({ type: 'app' }, h)
    familyLink(root, 'rootNode')
    const consumer = new Node({ type: 'div' }, h)
    childOf(root, consumer)
    consumer.addAnchor('target', 'ghost', {}, h.linkFor('ghost', 'component'))
    const proto = new Node({ type: 'section' }, h)
    familyLink(proto, 'component')
    const src = proto.addAnchor('source', 'ghost', {}, h.linkFor('ghost', 'component'))!
    src.value = { from: 'proto' }

    // the slice deliberately EXCLUDES the provider (walk path only)
    const res = root.compile([root, consumer])
    expect(res.dropped.some(d => d.reason === 'prototype-terminated')).toBe(true)
    expect(res.warnings.some(w => w.code === 'unresolved-reference')).toBe(false)
    expect(res.actionable.find(s => s.nodeId === consumer.id)).toBeUndefined()
  })

  it('C8 fork-arm: contentNodes/owner-terminated is dropped SILENT', () => {
    const root = makeRoot()
    const consumer = childOf(root, makeNode())
    targetAnchor(consumer, 'feed')

    const owned = makeNode({ type: 'payload' })
    const ownedFamily = new Link({ name: 'parent-child' })
    owned.addAnchor('child', owned, {}, ownedFamily)
    ownedFamily.addAnchor({ role: 'parent', target: 'contentNodes', options: {}, link: ownedFamily })
    addComponentSource(owned, 'feed', { from: 'content' })

    const res = root.compile([root, consumer, owned])
    expect(res.dropped.some(d => d.reason === 'owner-terminated')).toBe(true)
  })

  it('C9(a) anchor circle (seed refs + reconcileParentTargets) drops as loop with circular-source', () => {
    // Both nodes seed a child anchor whose parent ref points at the OTHER node;
    // reconcileParentTargets resolves the string refs into a real anchor circle.
    const a = new Node(
      { type: 'a', anchors: [{ role: 'child', target: 'circle-b', parent: 'circle-b' }] } as unknown as NodeBaseData,
      hub(),
      'circle-a',
    )
    const b = new Node(
      { type: 'b', anchors: [{ role: 'child', target: 'circle-a', parent: 'circle-a' }] } as unknown as NodeBaseData,
      hub(),
      'circle-b',
    )
    reconcileParentTargets([a, b])
    expect(a.parent).toBe(b)
    expect(b.parent).toBe(a)

    const res = a.compile([a, b])
    expect(res.actionable).toHaveLength(0)
    expect(res.dropped.some(d => d.reason === 'loop')).toBe(true)
    expect(res.warnings.some(w => w.code === 'circular-source')).toBe(true)
    expect(a.state).toBe('unplaced')
  })

  it('C9(b) deep acyclic chain (9..20 links): deepest node actionable with correct pathKey, NO drop, NO warning', () => {
    for (let links = 9; links <= 20; links++) {
      const root = makeRoot()
      const chain: Node[] = [root]
      let parent = root
      for (let i = 0; i < links; i++) {
        const child = makeNode()
        childOf(parent, child)
        chain.push(child)
        parent = child
      }
      const deep = parent
      targetAnchor(deep, 'deep-borrow')
      addComponentSource(root, 'deep-borrow', { at: 'root' })

      const res = root.compile(chain)
      const cs = res.actionable.find(s => s.nodeId === deep.id)
      expect(cs, `deepest node of the ${links}-link chain must be actionable`).toBeDefined()
      expect(cs?.pathKey).toBe(['root', ...chain.slice(1).map(c => c.id)].join('/'))
      expect((cs?.bindings['deep-borrow'] as { at?: string } | undefined)?.at).toBe('root')
      expect(res.dropped.some(d => d.reason === 'loop' && d.arm[0] === deep.id)).toBe(false)
      expect(res.warnings.some(w => w.code === 'circular-source')).toBe(false)
    }
  })
})

describe('fail-states — §9 FS-1…FS-11', () => {
  it('FS-1 compile on not-in-tree nodes returns no usable actionable state (S1.1)', async () => {
    const unplaced = makeNode({ type: 'div' })
    const ures: CompileResult = unplaced.compile([unplaced])
    expect(ures.actionable).toHaveLength(0)
    expect(ures.dropped.some(d => d.reason === 'owner-terminated')).toBe(true)

    const proto = makePrototype()
    const pres: CompileResult = proto.compile([proto])
    expect(pres.actionable).toHaveLength(0)
    expect(pres.dropped.some(d => d.reason === 'prototype-terminated')).toBe(true)

    const root = makeRoot()
    const gone = childOf(root, makeNode())
    gone.destroyLinks()
    await drainSweep()
    expect(gone.state).toBe('destroyed')
    const dres = gone.compile([gone])
    expect(dres.actionable).toHaveLength(0)
    const deadState: NodeState = gone.state
    expect(deadState).toBe('destroyed')
  })

  it('FS-2 a second child-role anchor is rejected as single-parent at op validation (S-R4.2)', () => {
    const pa = makeNode()
    const pb = makeNode()
    const kid = makeNode()
    childOf(pa, kid)
    const before = nodeKey(kid)

    let err: unknown
    try {
      childOf(pb, kid)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(SingleParentError)
    expect((err as SingleParentError).nodeId).toBe(kid.id)
    expect(nodeKey(kid)).toBe(before)
    expect(kid.parent).toBe(pa)
  })

  it('FS-3 removing the lone parent anchor → count-underflow with the intended escalation', () => {
    const parent = makeNode()
    const kid = makeNode()
    childOf(parent, kid)
    const family = anchorsOf(kid, 'child')[0]?.link
    expect(family).toBeDefined()
    const parentAnchor = family?.anchorsOf('parent')[0]

    let err: unknown
    try {
      family?.removeAnchor(parentAnchor!)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(LinkConfigError)
    expect((err as LinkConfigError).code).toBe('count-underflow')
    // Escalation path: deliberate link destroy → children orphaned → unplaced.
    family?.destroy()
    expect(kid.state).toBe('unplaced')
    expect(anchorsOf(parent, 'parent')).toHaveLength(0)
  })

  it('FS-4 duplicate child priority → unique-order w/ conflicting+currentCell; retry at max+1 (S3.2)', () => {
    const root = makeNode()
    const held = makeNode()
    const blocked = makeNode()
    childOf(root, held, 5)
    const family = anchorsOf(held, 'child')[0]?.link
    expect(family).toBeDefined()

    let err: unknown
    try {
      childOf(root, blocked, 5)
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(LinkConfigError)
    const lerr = err as LinkConfigError
    expect(lerr.code).toBe('unique-order')
    expect(lerr.detail.conflicting.some(c => c.options.priority === 5)).toBe(true)
    expect(lerr.detail.currentCell.some(c => c.role === 'child')).toBe(true)

    const priorities = (family?.children() ?? []).map(c => c.options.priority ?? 0)
    const next = Math.max(...priorities) + 1
    childOf(root, blocked, next)
    expect(anchorsOf(blocked, 'child')[0]?.options.priority).toBe(next)
  })

  it('FS-5 attach/move creating a cycle → op-time loop guard rejects and rolls back (S3.4)', () => {
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    const c = makeNode({ type: 'c' })
    childOf(a, b) // b under a
    childOf(b, c) // c under b → a → b → c

    const before = `${nodeKey(a)}|${nodeKey(b)}|${nodeKey(c)}`
    let err: unknown
    try {
      childOf(c, a) // attach A under its own descendant C → cycle!
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(CycleError)
    expect(`${nodeKey(a)}|${nodeKey(b)}|${nodeKey(c)}`).toBe(before)
    expect(anchorsOf(a, 'child')).toHaveLength(0)
    expect(c.parent).toBe(b)
  })

  it('FS-6 mutating a destroyed node is rejected; no cache/graph change', async () => {
    const root = makeRoot()
    const keeper = childOf(root, makeNode())
    const victim = childOf(root, makeNode())
    victim.destroyLinks()
    await drainSweep()
    expect(victim.state).toBe('destroyed')
    void keeper

    const layerCount = victim.layers.length
    expect(() => victim.addLayer({ id: 'late', type: 'x' })).toThrow()
    expect(victim.layers.length).toBe(layerCount)
    expect(() => victim.destroyLinks()).toThrow()
    expect(() => victim.clone('actor')).toThrow()
  })

  it('FS-7 compile-time walk: a revisit drops as loop; a deep ACYCLIC chain compiles actionable (no depth-cap drop)', () => {
    const root = makeRoot()
    const chain: Node[] = [root]
    let parent = root
    for (let i = 0; i <= MAX_COMPILE_DEPTH + 1; i++) {
      const child = makeNode()
      childOf(parent, child)
      chain.push(child)
      parent = child
    }
    const deep = parent
    targetAnchor(deep, 'deep-borrow')
    addComponentSource(root, 'deep-borrow', { at: 'root' })

    const res = root.compile(chain)
    // 10-link acyclic chain: depth is NOT a loop signal for the parent chain —
    // only a genuine revisit is (compile-horizon §6.1.2/§6.1.4).
    expect(res.dropped.some(d => d.reason === 'loop')).toBe(false)
    expect(res.warnings.some(w => w.code === 'circular-source')).toBe(false)
    const cs = res.actionable.find(s => s.nodeId === deep.id && s.bindings['deep-borrow'] !== undefined)
    expect(cs).toBeDefined()
    expect((cs?.bindings['deep-borrow'] as { at?: string } | undefined)?.at).toBe('root')
  })

  it('FS-8 unresolved component target is a compile STATE — warning + still renders (not hidden)', () => {
    const root = makeRoot()
    const t = childOf(root, makeNode({ type: 'own' }))
    targetAnchor(t, 'ghost') // nothing provides it up to root

    const res = root.compile([root, t])
    expect(res.warnings.some(w => w.code === 'unresolved-reference')).toBe(true)
    const cs = res.actionable.find(s => s.nodeId === t.id)
    expect(cs).toBeDefined()
    expect(cs?.unresolved).toEqual([{ referenceName: 'ghost', code: 'unresolved-reference' }])
    expect(cs?.type).toBe('own')
  })

  it('FS-9 direct writes to parent/children/state/anchors are impossible (runtime, strict-mode)', () => {
    const n = makeNode()
    const setterFn: Array<() => unknown> = [
      // @ts-expect-error -- parent has no setter
      () => { (n as Node).parent = makeNode() },
      // @ts-expect-error -- children has no setter
      () => { (n as Node).children = [] },
      // @ts-expect-error -- state has no setter
      () => { (n as Node).state = 'in-tree' },
      // @ts-expect-error -- anchors is readonly
      () => { (n as Node).anchors = [] },
    ]
    for (const fn of setterFn) expect(fn).toThrow(TypeError)
  })

  it('FS-10 placement-target-blocked: state-slice mutations targeting a placement zone hard-block (S-R4.1)', () => {
    const root = makeRoot()
    const node = childOf(root, makeNode())
    const slice: LayerMutation[] = [{ targetProp: 'placement' as never, mode: 'replace', value: 'zone' }]
    expect(() => applyStateSlice(node, slice)).toThrow()
    expect(node.content).toBeUndefined()
    expect(() => applyStateSlice(node, [{ targetProp: 'content', mode: 'replace', value: 'ok' }])).not.toThrow()
    expect(node.content).toBe('ok')
  })

  it('FS-11 unlock-before-resolution is illegal until the last fork resolves (S2.3, pipeline cross-ref)', () => {
    const lock = new SliceLock('r')
    expect(lock.state).toBe('held')
    expectCode(() => lock.unlock(), 'unlock-before-resolution')

    lock.beginResolution()
    expectCode(() => lock.unlock(), 'unlock-before-resolution')
    lock.resolveFork('r/a', { kind: 'emitted', renderOps: [] })
    expect(lock.state).toBe('resolving')
    lock.resolveFork('r/b', { kind: 'emitted', renderOps: [] })
    expect(lock.state).toBe('resolved')
    lock.unlock()
    expect(lock.state).toBe('released')
  })
})

describe('memoized chainRoot classification — compile-horizon §6 parity + termination rules', () => {
  type RefKind = 'root' | 'proto' | 'other-token' | 'slice-root' | 'loop' | 'unplaced' | 'destroyed-owner'

  /** §6.2 reference walker: the per-node parent-chain walk the memoized
   *  three-phase classifier must equal (parity invariant, §6.2.3). Bounded by
   *  `seen` only — no depth cap (chains here stay ≤ 8 hops so both agree). */
  function refChainKind(node: Node, slice: ReadonlySet<string>): RefKind {
    const seen = new Set<string>()
    let cur: Node | null = node
    for (;;) {
      if (cur === null) return 'unplaced'
      if (cur.destroyed) return 'destroyed-owner'
      if (seen.has(cur.id)) return 'loop'
      seen.add(cur.id)
      const child = cur.childAnchor()
      if (child === null) return 'unplaced'
      const parentAnchor = (child.link as unknown as Link).anchorsOf('parent')[0]
      if (!parentAnchor) return slice.has(cur.id) ? 'slice-root' : 'unplaced'
      const target = parentAnchor.target
      if (typeof target === 'string') {
        if (target === 'rootNode') return 'root'
        if (target === 'component') return 'proto'
        return 'other-token'
      }
      const owner = target as Node
      if (owner.destroyed) return 'destroyed-owner' // destroyed wins over childless (node.ts:64)
      if (owner.childAnchor() === null) return slice.has(owner.id) ? 'slice-root' : 'unplaced'
      cur = owner
    }
  }

  /** Map a reference kind to its compile-observable outcome (drop reason /
   *  actionable + warning). 'destroyed-owner' and 'unplaced' both surface as
   *  owner-terminated; only the kind-vs-walk parity is asserted here. */
  function assertKindMatches(res: CompileResult, node: Node, kind: RefKind): void {
    const droppedAs = (reason: string): boolean => res.dropped.some(d => d.arm[0] === node.id && d.reason === reason)
    switch (kind) {
      case 'root':
      case 'slice-root':
        expect(res.actionable.some(s => s.nodeId === node.id), `${node.id} should be actionable`).toBe(true)
        break
      case 'loop':
        expect(droppedAs('loop'), `${node.id} should drop as loop`).toBe(true)
        expect(res.warnings.some(w => w.code === 'circular-source')).toBe(true)
        break
      case 'proto':
        expect(droppedAs('prototype-terminated'), `${node.id} should drop as prototype-terminated`).toBe(true)
        break
      case 'other-token':
      case 'unplaced':
      case 'destroyed-owner':
        expect(droppedAs('owner-terminated'), `${node.id} should drop as owner-terminated`).toBe(true)
        break
    }
  }

  /** A real A↔B anchor circle (each node is the other's parent). */
  function anchorCircleFixture(): { a: Node; b: Node } {
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

  it('parity: memoized classification equals the per-node walk for a full in-slice forest (root-first AND leaf-first orders)', () => {
    const root = makeRoot()
    const n1 = childOf(root, makeNode())
    const n2 = childOf(n1, makeNode())
    const n3 = childOf(n2, makeNode())

    const proto = makePrototype()
    const protoKid = childOf(proto, makeNode())

    const cc = new Node({ type: 'content' }, hub())
    const ccLink = new Link({ name: 'parent-child' })
    cc.addAnchor('child', cc, {}, ccLink)
    ccLink.addAnchor({ role: 'parent', target: 'contentNodes', options: {}, link: ccLink })

    const sharedA = childOf(root, makeNode())
    const sharedB = childOf(sharedA, makeNode())
    const x = childOf(sharedB, makeNode())
    const y = childOf(sharedB, makeNode())

    const stop = makeNode() // in-slice childless parent
    const stopKid = childOf(stop, makeNode())

    // child anchor whose family link has NO parent anchor (node.ts:54 — raw
    // `new Link()` + `addAnchor('child')`): walk termination with the slice rule
    const noParent = makeNode()
    const noParentLink = new Link({ name: 'parent-child' })
    noParent.addAnchor('child', noParent, {}, noParentLink)
    const noParentKid = makeNode()
    const noParentKidLink = new Link({ name: 'parent-child' })
    noParentKid.addAnchor('child', noParentKid, {}, noParentKidLink)
    noParentKidLink.addAnchor({ role: 'parent', target: noParent, options: {}, link: noParentKidLink })

    const d = childOf(root, makeNode())
    const dKid = childOf(d, makeNode())
    d.markDestroyed() // destroyed but still carries a child anchor

    const d2 = makeNode() // destroyed AND childless
    const d2Kid = childOf(d2, makeNode())
    d2.markDestroyed()

    const { a, b } = anchorCircleFixture()
    const u = makeNode()

    const slice = [root, n1, n2, n3, proto, protoKid, cc, x, y, stop, stopKid, noParent, noParentKid, d, dKid, d2, d2Kid, a, b, u]
    const sliceSet = new Set(slice.map(n => n.id))
    for (const order of [slice, [...slice].reverse()]) {
      const res = root.compile(order)
      for (const node of order) assertKindMatches(res, node, refChainKind(node, sliceSet))
    }
  })

  it('in-slice anchor cycle classifies as loop (round-2 F1)', () => {
    const { a, b } = anchorCircleFixture()
    const res = a.compile([a, b])
    expect(res.actionable).toHaveLength(0)
    expect(res.dropped.filter(d => d.reason === 'loop').map(d => d.arm[0]).sort()).toEqual([a.id, b.id].sort())
    expect(res.warnings.filter(w => w.code === 'circular-source').length).toBeGreaterThan(0)
  })

  it('two in-slice nodes sharing an out-of-slice ancestor do NOT false-positive loop (per-walk seen, round-2 F5)', () => {
    const root = makeRoot()
    const sharedA = childOf(root, makeNode())
    const sharedB = childOf(sharedA, makeNode())
    const x = childOf(sharedB, makeNode())
    const y = childOf(sharedB, makeNode())

    const res = root.compile([root, x, y])
    expect(res.dropped.some(d => d.reason === 'loop')).toBe(false)
    expect(res.warnings.some(w => w.code === 'circular-source')).toBe(false)
    expect(res.actionable.find(s => s.nodeId === x.id)).toBeDefined()
    expect(res.actionable.find(s => s.nodeId === y.id)).toBeDefined()
  })

  it('in-slice childless parent terminates the child chain as slice-root (round-2 F2)', () => {
    const stop = makeNode()
    const kid = childOf(stop, makeNode())
    const res = stop.compile([stop, kid])
    expect(res.actionable.find(s => s.nodeId === kid.id)).toBeDefined()
    expect(res.actionable.find(s => s.nodeId === stop.id)).toBeUndefined()
    expect(res.dropped.some(d => d.reason === 'owner-terminated' && d.arm[0] === stop.id)).toBe(true)
  })

  it('out-of-slice parent under a prototype drops prototype-terminated, NOT slice-root (round-1 F2)', () => {
    const proto = makePrototype()
    const outOfSlice = childOf(proto, makeNode())
    const consumer = childOf(outOfSlice, makeNode())
    const res = consumer.compile([consumer])
    expect(res.dropped.some(d => d.reason === 'prototype-terminated' && d.arm[0] === consumer.id)).toBe(true)
    expect(res.actionable.find(s => s.nodeId === consumer.id)).toBeUndefined()
  })

  it('destroyed-with-child-anchor parent ⇒ child destroyed-owner (round-6 F1)', () => {
    const root = makeRoot()
    const d = childOf(root, makeNode())
    const kid = childOf(d, makeNode())
    d.markDestroyed()
    expect(d.destroyed).toBe(true)
    expect(d.childAnchor()).not.toBeNull()

    const res = root.compile([root, d, kid])
    expect(res.actionable.find(s => s.nodeId === kid.id)).toBeUndefined()
    expect(res.dropped.some(dr => dr.reason === 'owner-terminated' && dr.arm[0] === kid.id)).toBe(true)
  })

  it('destroyed-before-childless precedence: destroyed childless parent ⇒ destroyed-owner, not slice-root (node.ts:64)', () => {
    const d2 = makeNode()
    const kid = childOf(d2, makeNode())
    d2.markDestroyed()
    expect(d2.childAnchor()).toBeNull() // destroyed AND childless

    const res = d2.compile([d2, kid])
    expect(res.actionable.find(s => s.nodeId === kid.id)).toBeUndefined()
    expect(res.dropped.some(dr => dr.reason === 'owner-terminated' && dr.arm[0] === kid.id)).toBe(true)
  })
})

describe('resolution recursion cap — resolveNames/continueArm (resolve.ts:100)', () => {
  it('provider chain ≥9 hops still drops as loop (resolution cap unchanged after the parent-chain flip)', () => {
    const root = makeRoot()
    targetAnchor(root, 'a0')
    const providers: Node[] = []
    let parent = root
    for (let i = 1; i <= 8; i++) {
      const p = childOf(parent, makeNode())
      providers.push(p)
      parent = p
    }
    // Nested provider chain: Pk provides a(k-1) and targets a(k). P7 ALSO
    // provides 'a8', so P8's target walks back up to P7 and pushes the
    // resolveNames recursion to depth 9 (> MAX_COMPILE_DEPTH) → loop drop.
    for (let k = 1; k <= 8; k++) {
      const p = providers[k - 1]!
      addComponentSource(p, `a${k - 1}`, { hop: k })
      targetAnchor(p, `a${k}`)
    }
    addComponentSource(providers[6]!, 'a8', { hop: 7 })

    const res = root.compile([root, ...providers])
    expect(res.dropped.some(d => d.reason === 'loop' && d.arm[0] === root.id)).toBe(true)
    expect(res.warnings.some(w => w.code === 'circular-source')).toBe(true)
    expect(res.actionable.find(s => s.nodeId === root.id)).toBeUndefined()
  })

  it('a 9+ link acyclic chain with a root-sourced target resolves via iterative fitReference — actionable', () => {
    const root = makeRoot()
    const chain: Node[] = [root]
    let parent = root
    for (let i = 0; i < 10; i++) {
      const n = childOf(parent, makeNode())
      chain.push(n)
      parent = n
    }
    const deep = parent
    targetAnchor(deep, 'deep-borrow')
    addComponentSource(root, 'deep-borrow', { at: 'root' })

    const res = root.compile(chain)
    const cs = res.actionable.find(s => s.nodeId === deep.id)
    expect(cs).toBeDefined()
    expect((cs?.bindings['deep-borrow'] as { at?: string } | undefined)?.at).toBe('root')
    expect(res.dropped.some(d => d.reason === 'loop')).toBe(false)
    expect(res.warnings.some(w => w.code === 'circular-source')).toBe(false)
  })
})

describe('serialization — §10', () => {
  it('S1 node → JSON round-trip keeps render-relevant state', () => {
    const root = makeRoot({ type: 'div', props: { title: 'x' } })
    const kid = childOf(root, makeNode({ type: 'span', content: 'hello' }))

    const doc = serializeNode(root)
    const roundTrip = JSON.parse(JSON.stringify(doc)) as ReturnType<typeof serializeNode>
    expect(roundTrip).toEqual(doc)
    expect(doc.state).toBe('in-tree')
    expect(doc.type).toBe('div')
    expect(typeof doc.props.title).toBe('string')
    expect(doc.children).toEqual([kid.id])
    expect(doc.content).toBeUndefined()
  })

  it('S2 anchors serialize as typed keys { role, target, options, link }', () => {
    const root = makeRoot()
    const kid = childOf(root, makeNode())

    const doc = serializeNode(root)
    expect(doc.anchors.length).toBeGreaterThan(0)
    for (const a of doc.anchors) {
      expect(['child', 'parent', 'source', 'target', 'duplex', 'container', 'content', 'component']).toContain(a.role)
      expect(typeof a.target).toBe('string')
      expect(typeof a.link).toBe('string')
      expect(
        a.target === 'rootNode' ||
          a.target === 'component' ||
          a.target === 'contentNodes' ||
          a.target === root.id ||
          a.target === kid.id,
      ).toBe(true)
    }
  })

  it('S3 fork states de-duplicate and key by nodeId + pathKey (no phantom coalescing)', () => {
    const root = makeRoot()
    const dock = childOf(root, makeNode())
    targetAnchor(dock, 'feed')
    const a = childOf(dock, makeNode())
    const b = childOf(dock, makeNode())
    addComponentSource(a, 'feed', { label: 'A' })
    addComponentSource(b, 'feed', { label: 'B' })

    const res = root.compile([root, dock, a, b])
    const arms = res.actionable.filter(s => s.nodeId === dock.id)
    expect(arms.length).toBe(2)
    expect(new Set(arms.map(s => s.nodeId)).size).toBe(1)
    expect(new Set(arms.map(s => s.pathKey)).size).toBe(2)
    for (const arm of arms) {
      expect(arm.pathKey.startsWith('root/')).toBe(true)
      expect(arm.pathKey.includes(dock.id)).toBe(true)
    }
  })

  it('S4 a container-role placement anchor round-trips through serialize → load → rehydrate (P3 §1.1 role rename)', () => {
    const root = makeRoot()
    const zone = childOf(root, makeNode())
    const plink = new Link({ name: 'placement' })
    zone.addAnchor('container', 'slot-alpha', {}, plink)

    const doc = serializeNode(zone)
    const container = doc.anchors.find((a) => a.role === 'container' && a.target === 'slot-alpha')!
    expect(container).toBeDefined()

    const seeded = new Node(JSON.parse(JSON.stringify(doc)) as NodeBaseData, hub())
    const rehydrated = seeded.anchors.find((a) => a.role === 'container' && a.target === 'slot-alpha')
    expect(rehydrated).toBeDefined()
    // the rehydrated anchor re-mints onto the placement-kind Link (the seed
    // path regenerates link ids; the KIND and the role must round-trip)
    expect(rehydrated!.link.config.name).toBe('placement')
    expect(seeded.anchors.find((a) => a.role === 'placement' as never)).toBeUndefined()
  })
})

describe('placement roles surface — container/content (P3 §1.1)', () => {
  it('Role union accepts container AND content anchors on the shared per-name placement Link', () => {
    const link = new Link({ name: 'placement' })
    const zone = makeNode()
    const consumer = makeNode()
    expect(() => zone.addAnchor('container', 'slot-a', {}, link)).not.toThrow()
    expect(() => consumer.addAnchor('content', 'slot-a', {}, link)).not.toThrow()
    expect(link.anchorsOf('container')).toHaveLength(1)
    expect(link.anchorsOf('content')).toHaveLength(1)
  })

  it("the legacy 'placement' role is gone from the union — rejected with role-mismatch at runtime", () => {
    const link = new Link({ name: 'placement' })
    let err: unknown
    try {
      // @ts-expect-error -- P3 §1.1: 'placement' is RENAMED to 'container'; not a Role
      link.addAnchor({ role: 'placement', target: 'slot-a', options: {}, link })
    } catch (e) {
      err = e
    }
    expect(err).toBeInstanceOf(LinkConfigError)
    expect((err as LinkConfigError).code).toBe('role-mismatch')
  })

  it('a content anchor stays a peripheral edge — never a child/parent anchor (SI-3)', () => {
    const root = makeRoot()
    const consumer = childOf(root, makeNode())
    const link = new Link({ name: 'placement' })
    consumer.addAnchor('content', 'slot-a', {}, link)
    expect(consumer.childAnchor()).not.toBeNull() // family edge untouched
    expect(consumer.parent).toBe(root)
    expect(root.children).toContain(consumer)
    expect(link.anchorsOf('content')).toHaveLength(1)
  })
})

describe('engine defect #1 — publishOwn bypass on mixed nodes (own-value seed into resolveArms bindings)', () => {
  // archive/findings/2026-08-15/2026-08-15-test-findings.md §"Stress-test review loop #2" DEFECT #1: a node
  // carrying ANY target (consumer) anchor routed through resolveArms never
  // published its own source/duplex values, so synthesized `{$:'bindings.B'}`
  // reads (K2 self-apply) and authored `bindings.*` reads evaluated null on a
  // LEGAL K7 mix (consume A + provide B + self-apply B). Spec: translate.md
  // §2.1 "at a self-provider the applied value IS its own `value`" (unqualified).
  //
  // The shipped showcase envelope: array-card = mixed node (consumes
  // arrConsumer + rootValue from root depth-0 providers, provides selfApply).
  const MIXED_ENVELOPE: Parameters<typeof translateLegacy>[0] = {
    template: {
      root: {
        type: 'app',
        props: { id: 'showcase-root' },
        children: [
          {
            type: 'div',
            props: { id: 'array-card' },
            component: [
              { reference: 'arrConsumer', target: 'props.apply-consumer' },
              { reference: 'rootValue' },
              { reference: 'selfApply', value: 'self-applied', target: 'props.self-apply' },
            ],
          },
        ],
      },
      component: [
        { reference: 'rootValue', value: 'root-provided' },
        { reference: 'arrConsumer', value: 'arr-consumed' },
      ],
    },
    clientConfig: { runInstantiation: false, runMonitoring: true },
  }

  it('T1 mixed node (consume A + provide B + self-apply B): bindings.B === ownValue, synthesized bake present, zero warnings', () => {
    const translated = translateLegacy(MIXED_ENVELOPE)
    expect(translated.warnings).toEqual([])
    const card = translated.nodes.find(n => n.props.id === 'array-card')!
    const res = card.compile(translated.nodes)
    const cs = res.actionable.find(s => s.nodeId === card.id)
    expect(cs).toBeDefined()
    expect(cs?.bindings['arrConsumer']).toBe('arr-consumed')
    expect(cs?.bindings['rootValue']).toBe('root-provided')
    expect(cs?.bindings['selfApply']).toBe('self-applied')
    expect(cs?.props['apply-consumer']).toBe('arr-consumed')
    expect(cs?.props['self-apply']).toBe('self-applied')
    expect(res.warnings).toEqual([])
    expect(res.dropped).toEqual([])
  })

  it('T2 authored bindings.B derived read on a mixed node returns the own value', () => {
    const root = makeRoot({ type: 'app' })
    const mixed = childOf(root, makeNode({
      type: 'div',
      derived: { props: { 'self-bake': { $: 'bindings.B' } } },
    }))
    targetAnchor(mixed, 'A')
    addComponentSource(mixed, 'B', 'bv')
    addComponentSource(root, 'A', 'av')

    const res = root.compile([root, mixed])
    const cs = res.actionable.find(s => s.nodeId === mixed.id)
    expect(cs).toBeDefined()
    expect(cs?.bindings['A']).toBe('av')
    expect(cs?.bindings['B']).toBe('bv')
    expect(cs?.props['self-bake']).toBe('bv')
    expect(res.warnings).toEqual([])
  })

  it('T3 fork: consumer of A with TWO providers + own B — EVERY arm carries B AND its arm-specific A', () => {
    const root = makeRoot()
    const mixed = childOf(root, makeNode())
    targetAnchor(mixed, 'A')
    addComponentSource(mixed, 'B', 'bv')
    const p1 = childOf(mixed, makeNode())
    const p2 = childOf(mixed, makeNode())
    addComponentSource(p1, 'A', 'a1')
    addComponentSource(p2, 'A', 'a2')

    const res = root.compile([root, mixed, p1, p2])
    const arms = res.actionable.filter(s => s.nodeId === mixed.id)
    expect(arms.length).toBe(2)
    expect(arms.map(a => a.bindings['A']).sort()).toEqual(['a1', 'a2'])
    for (const arm of arms) {
      expect(arm.bindings['B']).toBe('bv')
      expect(Object.keys(arm.bindings)).toEqual(['A', 'B'])
    }
  })

  it('T4 pure provider (no targets): bindings unchanged — spot-check-7 regression pin', () => {
    const root = makeRoot()
    const prov = childOf(root, makeNode())
    addComponentSource(prov, 'X', 'xv')

    const res = root.compile([root, prov])
    const cs = res.actionable.find(s => s.nodeId === prov.id)
    expect(cs).toBeDefined()
    expect(cs?.bindings).toEqual({ X: 'xv' })
  })

  it('T5 same-name runtime duplex (source + target for X, no applyPath): seeding must NOT overwrite the resolved value (skip-if-present pin)', () => {
    const root = makeRoot()
    const d = childOf(root, makeNode())
    targetAnchor(d, 'X')
    addComponentSource(d, 'X', 'dx', 'duplex')

    const res = root.compile([root, d])
    const cs = res.actionable.find(s => s.nodeId === d.id)
    expect(cs).toBeDefined()
    // the arm-resolved value (own provider hit wins depth-0) is the current
    // contract — the own-value seed must leave it untouched
    expect(cs?.bindings['X']).toBe('dx')
    expect(Object.keys(cs?.bindings ?? {})).toEqual(['X'])
  })

  it('T6 mixed-node emitted TEXT stays the first scalar (consumed value) — scalarBinding insertion order', () => {
    const root = makeRoot()
    const mixed = childOf(root, makeNode())
    targetAnchor(mixed, 'A')
    addComponentSource(mixed, 'B', 'bv')
    addComponentSource(root, 'A', 'av')

    const res = root.compile([root, mixed])
    const cs = res.actionable.find(s => s.nodeId === mixed.id)
    expect(cs).toBeDefined()
    expect(cs?.bindings['A']).toBe('av')
    expect(cs?.bindings['B']).toBe('bv')
    const els = emitElements([cs!])
    expect(els).toHaveLength(1)
    expect(els[0]!.props['text']).toBe('av')
  })

  it('T7 reverse round-trip on a fixed mixed node: applyPath preserved as target; re-translate warning-clean', () => {
    const translated = translateLegacy(MIXED_ENVELOPE)
    const reversed = reverseTranslate(translated.root)
    const rCard = reversed.template.root.children?.find(c => c.props?.id === 'array-card')
    expect(rCard).toBeDefined()
    const arr = rCard!.component as Array<{ reference: string; value?: unknown; target?: string }>
    expect(Array.isArray(arr)).toBe(true)
    // consumer apply path persists as `target`; provider keeps {reference, value, target}
    expect(arr.some(b => b.reference === 'arrConsumer' && b.target === 'props.apply-consumer' && !('value' in b))).toBe(true)
    expect(arr.some(b => b.reference === 'selfApply' && b.value === 'self-applied' && b.target === 'props.self-apply')).toBe(true)
    // the applyPath-less plain consumer is R-2-dropped next to the provider
    expect(arr.some(b => b.reference === 'rootValue')).toBe(false)

    const again = translateLegacy(reversed)
    expect(again.warnings.some(w => w.code === 'component-target-skipped')).toBe(false)
    expect(again.warnings.some(w => w.code === 'component-duplicate-reference' || w.code === 'component-duplicate-target')).toBe(false)
    expect(again.warnings).toEqual([])
  })
})

describe('component-source-duplicate guard (placement-path-spec §2.2/§10.ab/ae, Unit 8)', () => {
  /** Spy console.warn; returns the spy (restore in finally). */
  function spyWarn() {
    return vi.spyOn(console, 'warn').mockImplementation(() => {})
  }

  /** node.ts warn style is multi-arg ('circular-source at', pathKey) — the
   *  guard warns ('component-source-duplicate at', nodeId, role, target). */
  function warnedGuard(warn: ReturnType<typeof spyWarn>): boolean {
    return warn.mock.calls.some(c => String(c[0]).includes('component-source-duplicate'))
  }

  it('G1 (a) imperative: a second same-name source anchor via addAnchor warns component-source-duplicate, keeps the first, and is NOT added', () => {
    const warn = spyWarn()
    try {
      const node = makeNode()
      const l1 = new Link({ name: 'component' })
      const l2 = new Link({ name: 'component' })
      const first = node.addAnchor('source', 'refX', {}, l1)!
      first.value = 'A'
      const second = node.addAnchor('source', 'refX', {}, l2)
      expect(second).toBeNull()
      expect(anchorsOf(node, 'source')).toHaveLength(1)
      expect(anchorsOf(node, 'source')[0]).toBe(first)
      expect(anchorsOf(node, 'source')[0]!.value).toBe('A')
      expect(warnedGuard(warn)).toBe(true)
      // the skipped anchor must not exist on any link either (per-link NO
      // carve-out — §10.ac.2 #4: the guard matches across ALL anchors)
      expect(l2.anchors.some(a => a.role === 'source' && a.target === 'refX')).toBe(false)
    } finally {
      warn.mockRestore()
    }
  })

  it('G2 (b) constructor seed path: a serialized doc carrying the pattern loads with ONE source and a warn (keep-first)', () => {
    const warn = spyWarn()
    try {
      const n = new Node(
        {
          type: 'div',
          anchors: [
            { role: 'source', target: 'refX', value: 'A' },
            { role: 'source', target: 'refX', value: 'B' },
          ],
        } as unknown as NodeBaseData,
        hub(),
        'seeded-dup',
      )
      const sources = anchorsOf(n, 'source')
      expect(sources).toHaveLength(1)
      expect(sources[0]!.target).toBe('refX')
      expect(sources[0]!.value).toBe('A')
      expect(warnedGuard(warn)).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('G3 (c) duplex duplicates are covered by the same guard (keep-first)', () => {
    const warn = spyWarn()
    try {
      const node = makeNode()
      const l1 = new Link({ name: 'component' })
      const l2 = new Link({ name: 'component' })
      const first = node.addAnchor('duplex', 'session', {}, l1)!
      first.value = 'S'
      const second = node.addAnchor('duplex', 'session', {}, l2)
      expect(second).toBeNull()
      expect(anchorsOf(node, 'duplex')).toHaveLength(1)
      expect(anchorsOf(node, 'duplex')[0]).toBe(first)
      expect(warnedGuard(warn)).toBe(true)
    } finally {
      warn.mockRestore()
    }
  })

  it('G4 (d) same-name CONTAINER anchors are unaffected (placement multiplicity is legal); different-name sources are fine', () => {
    const warn = spyWarn()
    try {
      const zone = makeNode()
      const plink = hub().linkFor('slot-alpha', 'placement')
      const c1 = zone.addAnchor('container', 'slot-alpha', {}, plink)
      const c2 = zone.addAnchor('container', 'slot-alpha', {}, plink)
      expect(c1).not.toBeNull()
      expect(c2).not.toBeNull()
      expect(anchorsOf(zone, 'container')).toHaveLength(2)

      const node = makeNode()
      const l1 = new Link({ name: 'component' })
      const l2 = new Link({ name: 'component' })
      const s1 = node.addAnchor('source', 'a', {}, l1)
      const s2 = node.addAnchor('source', 'b', {}, l2)
      expect(s1).not.toBeNull()
      expect(s2).not.toBeNull()
      expect(anchorsOf(node, 'source')).toHaveLength(2)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('G5 (e) regression pin: the Unit-11 re-expressed fixtures (distinct names / single sources) never trip the guard', () => {
    const warn = spyWarn()
    try {
      // feature-matrix re-expression (§10.ac.2 #3): theme-dark / theme-light
      // are TWO DISTINCT names on the same node — the anti-pattern-compliant
      // shape Unit 11 shipped
      const root = makeRoot({ type: 'app' })
      addComponentSource(root, 'theme-dark', 'theme: dark')
      addComponentSource(root, 'theme-light', 'theme: light')
      const consumer = childOf(root, makeNode({ type: 'swatch' }))
      targetAnchor(consumer, 'theme-dark')
      targetAnchor(consumer, 'theme-light')

      const res = root.compile([root, consumer])
      expect(res.warnings).toEqual([])
      expect(warn).not.toHaveBeenCalled()
      // distinct names resolve side by side (the K7 multi-binding surface)
      const cs = res.actionable.find(s => s.nodeId === consumer.id)
      expect(cs?.bindings['theme-dark']).toBe('theme: dark')
      expect(cs?.bindings['theme-light']).toBe('theme: light')
    } finally {
      warn.mockRestore()
    }
  })

  it('G6 materializeAnchors interaction: the decl-path dedup is complementary, not the enforcement point', () => {
    const warn = spyWarn()
    try {
      // a layer decl carrying the pattern: materializeAnchors' role+target
      // dedup pre-filters (decl-path duplicates never reach the guard —
      // §10.ac.2 #4); reconcileAnchors stays idempotent
      const node = makeNode()
      node.addLayer({ id: 'l', anchors: [{ role: 'source', target: 'refX' }, { role: 'source', target: 'refX' }] })
      node.reconcileAnchors()
      expect(anchorsOf(node, 'source')).toHaveLength(1)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})