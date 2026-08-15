import { describe, it, expect } from 'vitest'
import {
  diffMinimal,
  MockAdapter,
  type RenderOp,
  type MinimalElement,
  type RenderAdapter,
} from '../../src/core/render.js'
import {
  emitElements,
  applyOps as applyOpsReal,
  treeFromOps as treeFromOpsReal,
  treeSig,
  wireKey,
} from '../../src/core/render-helpers.js'
import type { RenderTree } from '../../src/core/render-helpers.js'
import {
  serializeNode,
  serializeSlice,
  loadState,
  type RenderNodeState,
  type SerializedAnchor,
  type SerializedRenderDoc,
} from '../../src/core/serialize.js'
import { Node, mintNodeId, reconcileParentTargets } from '../../src/core/node.js'
import type { NodeRef } from '../../src/core/types.js'
import {
  makeRoot,
  makeNode,
  childOf,
  hub,
  addComponentSource,
  targetAnchor,
} from '../helpers/fixtures.js'

type CompiledState = ReturnType<Node['compile']>['actionable'][number]

/**
 * Declared contract pinned by these tests for the Renderer (src/core/render.ts,
 * src/core/serialize.ts). The implementation does not exist yet (TDD red state).
 * Tests follow render.md §10.1–§10.5 and contract.md. Where the notes leave seam
 * latitude, the intended deterministic behavior is recorded here:
 *
 *  diffMinimal(prev, next), in order:
 *    1. `remove` for every prev wire absent from `next` (D2; D5 "departed").
 *    2. per element in `next` array order:
 *        - new wire             -> `create` + one `set` per prop, object order (D1);
 *        - type changed         -> `remove` + `create` + `set`* (D3, no morphing);
 *        - otherwise            -> `set` only for prop names whose value changed
 *                                  versus prev (D4, removed props re-`set`,
 *                                  added props `set`, unchanged names silent).
 *    3. structure pass: for each element in `next` order, for each child in its
 *       `childOrder` whose wire is present in `next`, emit `append(owner, child)`
 *       ONLY when the child order changed (vs the previous render's `childOrder`,
 *       D5) or the child was created/re-created this pass — this doubles as D1's
 *       append and D5's re-append in compiled order. Re-appending an UNCHANGED
 *       order is deliberately skipped: in a real DOM, `appendChild` on an
 *       already-attached element detaches + re-inserts it, which would blur a
 *       focused form element (e.g. a markdown editor) on every keystroke.
 *    `styles` ops are never synthesized by the tree diff; the sweep coalescer
 *    owns them (R-ORD-6) and coalesces to one per batch.
 *
 *   MinimalElement.props use the namespaced `set` names verbatim
 *   (`prop:*`, `css:*`, `text`, `on:<event>`), kept by the compiled-state reducer
 *   `minimalFromState` below.
 */

function el(
  wire: string,
  type: string,
  props: Record<string, unknown> = {},
  childOrder: string[] = [],
): MinimalElement {
  return { wire, type, props, childOrder }
}

function elMap(els: MinimalElement[]): Map<string, MinimalElement> {
  return new Map(els.map((e) => [e.wire, e]))
}

function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

function compiledFor(res: ReturnType<Node['compile']>, nodeId: string): CompiledState | undefined {
  return res.actionable.find((s) => s.nodeId === nodeId)
}

function minimalFromState(cs: CompiledState): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) props[`css:${k}`] = v
  if (cs.content !== undefined) props['text'] = cs.content
  return { wire: cs.nodeId, type: cs.type, props, childOrder: [...cs.children] }
}

/** Root-out deep compile + diff → the op stream emitted by bootstrap/reconcile. */
function sliceOps(root: Node, slice: Node[]): RenderOp[] {
  const next = root.compile(slice).actionable.map(minimalFromState)
  return diffMinimal(null, next)
}

interface PEl {
  wire: string
  type: string
}

function applyOps(adapter: RenderAdapter<PEl>, ops: RenderOp[]): void {
  const els = new Map<string, PEl>()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        els.set(op.wire, adapter.createEl(op.type, op.wire))
        break
      case 'set':
        adapter.setProp(op.wire, op.name, op.value)
        break
      case 'append': {
        const owner = els.get(op.owner)
        const child = els.get(op.child)
        if (owner && child) adapter.appendChild(owner, child)
        break
      }
      case 'remove': {
        const w = els.get(op.wire)
        if (w && adapter.removeEl) adapter.removeEl(op.wire)
        els.delete(op.wire)
        break
      }
      case 'styles':
        break
    }
  }
}

function makeNodeAt(id: string, data: ConstructorParameters<typeof Node>[0] = { type: 'div' }): Node {
  return new Node(data, hub(), id)
}

/** A component-prototype chain built through the public graph API (token flip on the family link). */
function makeProto(id: string, data: ConstructorParameters<typeof Node>[0] = { type: 'section' }): Node {
  const host = makeNode()
  const proto = new Node(data, hub(), id)
  childOf(host, proto, 0)
  const fam = proto.anchors.find((a) => a.role === 'child')!.link
  const parentSide = fam.anchors.find((a) => a.role === 'parent')!
  parentSide.target = 'component'
  return proto
}

/** Drain the render microtask sweep: pass-2 → cascade-destroy → render-emit. */
async function drainSweep(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((resolve) => queueMicrotask(resolve))
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** Structural tree read back from a rendered op stream (adapter-neutral, PAR-5). */
type OpsTree = {
  wire: string
  type: string
  props: Record<string, unknown>
  children: OpsTree[]
}

function treeFromOps(ops: RenderOp[], opts?: { skip?: (name: string) => boolean }): OpsTree[] {
  const skip = opts?.skip
  const byWire = new Map<string, OpsTree>()
  const edges: Array<{ owner: string; child: string }> = []
  const propVals = new Map<string, Record<string, unknown>>()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        byWire.set(op.wire, { wire: op.wire, type: op.type, props: {}, children: [] })
        break
      case 'set':
        if (skip && skip(op.name)) break
        propVals.set(op.wire, { ...(propVals.get(op.wire) ?? {}), [op.name]: op.value })
        break
      case 'append':
        edges.push({ owner: op.owner, child: op.child })
        break
      default:
        break
    }
  }
  for (const [wire, tree] of byWire) tree.props = propVals.get(wire) ?? {}
  for (const e of edges) byWire.get(e.owner)?.children.push(byWire.get(e.child)!)
  return [...byWire.values()]
}

/** Structural parity check — throws when two adapters produce unequal render trees (PAR-5). */
class LegacyParityFailure extends Error {
  constructor(public readonly expectation: string) {
    super('parity failure: ' + expectation)
  }
}

function parityCheck(a: OpsTree[], b: OpsTree[], note: string): void {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    throw new LegacyParityFailure(note)
  }
}

/** A compiled-state-like view lifted straight from a serialized doc node entry. */
interface SerializableNode {
  id: string
  type: string
  props: Record<string, unknown>
  css?: Record<string, unknown>
  content?: unknown
  children: string[]
  forkKey?: string
}

function minimalFromSerialized(s: SerializableNode): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(s.css ?? {})) props[`css:${k}`] = v
  if (s.content !== undefined) props['text'] = s.content
  return { wire: s.id, type: s.type, props, childOrder: [...(s.children ?? [])] }
}

function serNodeOf(v: unknown): SerializableNode | undefined {
  if (typeof v === 'object' && v !== null && typeof (v as SerializableNode).id === 'string') {
    return v as SerializableNode
  }
  return undefined
}

function nodesFromDoc(doc: SerializedRenderDoc): SerializableNode[] {
  const out: SerializableNode[] = []
  const t = serNodeOf(doc.template)
  if (t) out.push(t)
  for (const c of doc.content) {
    const n = serNodeOf(c)
    if (n) out.push(n)
  }
  return out
}

/** Client-side re-render of a shipped snapshot: the same diffFn over the doc's nodes. */
function opsFromDoc(doc: SerializedRenderDoc): RenderOp[] {
  const nodes = nodesFromDoc(doc).map(minimalFromSerialized)
  return diffMinimal(null, nodes)
}

/** Adapter whose `hydrate` reuses `css.id`-keyed DOM elements and binds wires (notes §5.1). */
class HydrationAdapter implements RenderAdapter<PEl> {
  readonly created = new Set<string>()
  readonly reused = new Set<string>()
  readonly bound = new Map<string, string>()
  private els = new Map<string, PEl>()

  createEl(type: string, wire: string): PEl {
    this.created.add(wire)
    const e = { wire, type }
    this.els.set(wire, e)
    return e
  }

  setProp(wire: NodeRef, name: string, val: unknown): void {
    if (name === 'css:id') this.bound.set(String(val), wire)
  }

  appendChild(): void {
    return void 0
  }

  hydrate(rootWire: string, vdom: unknown): void {
    for (const n of nodesFromDoc(vdom as SerializedRenderDoc)) {
      const cssId = (n.css ?? {}).id
      if (typeof cssId !== 'string') continue
      const wire = this.bound.get(cssId)
      void rootWire
      if (wire && this.els.has(wire)) {
        this.reused.add(cssId)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// SERIALIZATION HELPERS (SER gate)
// ---------------------------------------------------------------------------

/** A fork slice via TWO PROVIDER NODES — the legitimate multiplicity (§10.ab
 *  #4): leaf's two children provide `refX`. Same-node same-name sources are
 *  the component-source-duplicate anti-pattern (guarded, Unit 8). */
function forkSlice(): { root: Node; leaf: Node; pA: Node; pB: Node } {
  const root = makeRoot({ type: 'root', content: 'R' })
  const leaf = childOf(root, makeNode({ type: 'leaf', content: 'L', props: { k: 1 } }), 0)
  targetAnchor(leaf, 'refX')
  const pA = childOf(leaf, makeNode({ type: 'pA' }), 0)
  const pB = childOf(leaf, makeNode({ type: 'pB' }), 1)
  addComponentSource(pA, 'refX', { what: 'A' })
  addComponentSource(pB, 'refX', { what: 'B' })
  return { root, leaf, pA, pB }
}

/** Strip non-deterministic fields (link ids) for comparison. */
function stripLinkIds(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripLinkIds)
  if (typeof v === 'object' && v !== null) {
    const o: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'link') continue
      o[k] = stripLinkIds(val)
    }
    return o
  }
  return v
}

/** Serialize → seed → re-serialize; throws when the round trip is not stable. */
function roundTrip(root: Node, slice: Node[]): SerializedRenderDoc {
  const doc = serializeSlice(root, slice)
  const seeded = loadState(jsonClone(doc)).map((d) => new Node(d, hub()))
  reconcileParentTargets(seeded)
  const reDoc = serializeSlice(seeded[0]!, seeded)
  if (JSON.stringify(stripLinkIds(doc)) !== JSON.stringify(stripLinkIds(reDoc))) {
    throw new Error('round-trip-mismatch')
  }
  return reDoc
}

/** The preempt-initial-data envelope with minimal NodeSchema-shaped template/content. */
function validDoc(): SerializedRenderDoc {
  return {
    template: { type: 'root' },
    content: [],
    clientConfig: { adapter: 'dom', persistence: false },
  }
}

/** Guard: re-resolved output MUST equal the shipped document, else hard failure (SER-F2). */
function assertRecompilesAs(expected: SerializedRenderDoc, root: Node, slice: Node[]): void {
  const got = serializeSlice(root, slice)
  if (JSON.stringify(expected) !== JSON.stringify(got)) {
    throw new Error('round-trip-mismatch')
  }
}

function assertEnvelope(doc: SerializedRenderDoc): void {
  if (typeof doc.template !== 'object' || doc.template === null || Array.isArray(doc.template)) {
    throw new Error('envelope-mismatch')
  }
  if (!Array.isArray(doc.content)) throw new Error('envelope-mismatch')
}

function validateClientConfig(doc: SerializedRenderDoc): void {
  assertEnvelope(doc)
  const cfg = doc.clientConfig
  if (typeof cfg !== 'object' || cfg === null) throw new Error('clientConfig-mismatch')
  const keys = Object.keys(cfg)
  if (keys.length !== 2 || !('adapter' in cfg) || !('persistence' in cfg)) {
    throw new Error('clientConfig-excess')
  }
  if (typeof cfg.adapter !== 'string' || typeof cfg.persistence !== 'boolean') {
    throw new Error('clientConfig-excess')
  }
}

/** Searchable doc with a fake-live target buried in the template so F3 can assert rejection. */
function docWithLiveTarget(): SerializedRenderDoc {
  const live = makeNodeAt('live')
  return {
    template: { type: 'r' },
    content: [
      {
        id: 'live',
        type: 'span',
        props: {},
        state: 'in-tree',
        children: [],
        anchors: [{ role: 'target', target: live as unknown as string, options: {}, link: 'L' }],
      },
    ],
    clientConfig: { adapter: 'dom', persistence: false },
  }
}

// ---------------------------------------------------------------------------
// §10.1 Serialization round-trip (SER-H1..H2, SER-F1..F6)
// ---------------------------------------------------------------------------

describe('§10.1 Serialization round-trip (SER-H1..H2, SER-F1..F6)', () => {
  it('SER-H1 — anchors round-trip as typed refs for every target kind; state is first-class JSON', () => {
    const root = makeRoot({ type: 'root', content: 'r' })
    const leaf = makeNode({ type: 'span', props: { 'css:class': 'k' }, content: 'l' })
    childOf(root, leaf, 0)
    targetAnchor(leaf, 'slotRef')
    addComponentSource(leaf, 'prov', 'prov-value')

    const comp = hub().linkFor('tokens', 'component')
    leaf.addAnchor('source', 'rootNode', {}, comp)
    leaf.addAnchor('target', 'component', {}, comp)
    leaf.addAnchor('duplex', 'contentNodes', {}, comp)

    const state: RenderNodeState = serializeNode(leaf)
    expect(state.state).toBe('in-tree')
    expect(state.type).toBe('span')
    expect(state.id).toBe(leaf.id)
    expect(state.children).toEqual([])

    const anchorAt = (role: SerializedAnchor['role'], target: unknown): SerializedAnchor => {
      const hit = state.anchors.find((a) => a.role === role && a.target === target)
      expect(hit).toBeDefined()
      return hit!
    }
    // Node → NodeRef (child side points back at the node itself, S3.1)
    const nodeTarget = state.anchors.find((a) => a.role === 'child')!
    expect(nodeTarget.target).toBe(leaf.id)
    expect(typeof nodeTarget.link).toBe('string')
    // referenceName token anchors (notes §10.8.2)
    expect(anchorAt('target', 'slotRef').target).toBe('slotRef')
    expect(anchorAt('source', 'prov').target).toBe('prov')
    // permanent-owner tokens serialize as their exact string keys, never live objects
    expect(anchorAt('source', 'rootNode').target).toBe('rootNode')
    expect(anchorAt('target', 'component').target).toBe('component')
    expect(anchorAt('duplex', 'contentNodes').target).toBe('contentNodes')

    const noneLive = state.anchors.every((a) => typeof a.target !== 'object' || a.target === null)
    expect(noneLive).toBe(true)
    // first-class JSON: parse∘stringify round-trips exactly (ones, only after JSON reachability)
    expect(jsonClone(state)).toEqual(state)
  })

  it('SER-H2 — an actionable fork round-trips with its trace and de-dupes by node id', () => {
    const { root, leaf, pA, pB } = forkSlice()
    const res = root.compile([root, leaf, pA, pB])
    const arms = res.actionable.filter((s) => s.nodeId === leaf.id)
    expect(arms).toHaveLength(2)
    const keys = new Set(arms.map((a) => a.pathKey))
    expect(keys.size).toBe(2)

    const doc = roundTrip(root, [root, leaf, pA, pB])
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc)

    const seeded = loadState(jsonClone(doc)).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded)
    const recompile = seeded[0]!.compile(seeded)
    const reArms = recompile.actionable.filter((s) => s.nodeId === leaf.id)
    expect(new Set(reArms.map((a) => a.pathKey))).toEqual(keys)
    expect(new Set(seeded.map((n) => n.id))).toEqual(new Set([root.id, leaf.id, pA.id, pB.id]))
  })

  it('SER-F1 — non-JSON props/content (function, cycle, symbol) throws; nothing is shipped', () => {
    const fnNode = makeNodeAt('f', { type: 'x', props: { no: () => 1 } })
    expect(() => serializeNode(fnNode)).toThrow()

    const node = makeNodeAt('cyc', { type: 'x' })
    const inner: Record<string, unknown> = {}
    node.addLayer({ id: 'L', content: inner })
    inner.self = inner
    expect(() => serializeNode(node)).toThrow()

    const symNode = makeNodeAt('sym', { type: 'x', props: { k: Symbol('s') } })
    expect(() => serializeNode(symNode)).toThrow()

    const ok = makeNodeAt('ok', { type: 'x', content: 'safe' })
    expect(() => serializeNode(ok)).not.toThrow()
  })

  it('SER-F2 — a round-trip mismatch is a hard failure (contract violation)', () => {
    const root = makeRoot({ type: 'root', content: 'A' })
    const slice = [root]
    const doc = serializeSlice(root, slice)
    expect(() => assertRecompilesAs(doc, root, slice)).not.toThrow()

    const mutated = makeRoot({ type: 'root', content: 'B' })
    expect(() => assertRecompilesAs(doc, mutated, [mutated])).toThrow()
  })

  it('SER-F3 — a serialized doc carrying a live object anchor target is rejected at the schema boundary', () => {
    expect(() => loadState(docWithLiveTarget())).toThrow()
  })

  it('SER-F4 — dropped-arm state contributes nothing to the serialized actionable set', () => {
    const root = makeRoot({ type: 'root' })
    const hold = childOf(root, makeNode({ type: 'hold' }), 0)
    const leaf = childOf(hold, makeNode({ type: 'span' }), 0)
    targetAnchor(leaf, 'slotP')
    const proto = makeProto('proto', { type: 'section' })
    addComponentSource(proto, 'slotP', { from: 'proto' })

    const res = root.compile([root, hold, leaf, proto])
    expect(res.dropped.some((d) => d.reason === 'prototype-terminated')).toBe(true)

    const doc = serializeSlice(root, [root, hold, leaf])
    const text = JSON.stringify(doc)
    expect(text).not.toContain('proto')
  })

  it('SER-F5 — a snapshot doc outside the preempt-initial-data envelope / NodeSchema shape is rejected', () => {
    expect(() => loadState({ hello: 1 } as unknown as SerializedRenderDoc)).toThrow()
    expect(() =>
      loadState({
        template: { type: 'r' },
        content: 5 as unknown as unknown[],
        clientConfig: { adapter: 'dom', persistence: false },
      }),
    ).toThrow()
    expect(() => assertEnvelope(validDoc())).not.toThrow()
  })

  it('SER-F6 — clientConfig carrying anything beyond adapter + persistence flags is rejected', () => {
    const bad: SerializedRenderDoc = {
      template: { type: 'r' },
      content: [],
      clientConfig: { adapter: 'dom', persistence: true, run: 'gamma' } as unknown as {
        adapter: string
        persistence: boolean
      },
    }
    expect(() => validateClientConfig(bad)).toThrow()
    expect(() => validateClientConfig(validDoc())).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// §10.2 Fork keys, collisions, non-actionable dropping
// ---------------------------------------------------------------------------

describe('§10.2 Fork keys & non-actionable dropping (FRK-H1..H3, FRK-F1..F6)', () => {
  it('FRK-H1 — a single source for a referenceName yields one actionable state, no fork', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf' }), 0)
    addComponentSource(root, 'slot', 'v')
    targetAnchor(leaf, 'slot')

    const res = root.compile([root, leaf])
    expect(res.actionable).toHaveLength(1)
    expect(res.dropped).toHaveLength(0)
    const st = compiledFor(res, leaf.id)
    expect(st?.bindings['slot']).toBe('v')
    expect(res.warnings.filter((w) => w.code === 'circular-source')).toHaveLength(0)
  })

  it('FRK-H2 — N root-terminated sources are N actionable states with distinct path keys; all render', () => {
    const { root, leaf, pA, pB } = forkSlice()
    const res = root.compile([root, leaf, pA, pB])
    const arms = res.actionable.filter((s) => s.nodeId === leaf.id)
    expect(arms).toHaveLength(2)

    const keys = arms.map((a) => a.pathKey)
    expect(new Set(keys).size).toBe(2)
    const pickA = arms.some((a) => (a.bindings['refX'] as { what: string }).what === 'A')
    const pickB = arms.some((a) => (a.bindings['refX'] as { what: string }).what === 'B')
    expect(pickA).toBe(true)
    expect(pickB).toBe(true)
  })

  it('FRK-H3 — duplex/self-source resolves at depth 0 before any upward walk (S4.1/S-R2.6)', () => {
    const root = makeRoot({ type: 'root' })
    const mid = childOf(root, makeNode({ type: 'mid' }), 0)
    const leaf = childOf(mid, makeNode({ type: 'leaf' }), 0)
    addComponentSource(root, 'slotD', 'FAR')
    addComponentSource(leaf, 'slotD', 'SELF', 'duplex')
    targetAnchor(leaf, 'slotD')

    const res = mid.compile([mid, leaf])
    const st = compiledFor(res, leaf.id)
    expect(st?.bindings['slotD']).toBe('SELF')
    expect(st?.unresolved ?? []).toHaveLength(0)
  })

  it('FRK-F1 — an arm terminating at a component prototype is silently dropped: zero ops, zero serialized state', () => {
    const root = makeRoot({ type: 'root' })
    const hold = childOf(root, makeNode({ type: 'hold' }), 0)
    const leaf = childOf(hold, makeNode({ type: 'span' }), 0)
    targetAnchor(leaf, 'slotP')
    const proto = makeProto('proto-arm', { type: 'section' })
    addComponentSource(proto, 'slotP', { from: 'proto' })

    const res = root.compile([root, hold, leaf, proto])
    expect(res.dropped.some((d) => d.reason === 'prototype-terminated')).toBe(true)
    expect(res.actionable.some((a) => a.nodeId === 'proto-arm')).toBe(false)

    const doc = serializeSlice(root, [root, hold, leaf])
    expect(JSON.stringify(doc)).not.toContain('proto-arm')
  })

  it('FRK-F2 — an arm terminating at contentNodes is silently dropped (owner-terminated)', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'span' }), 0)
    targetAnchor(leaf, 'slotC')

    const contentHost = makeNode()
    const payload = childOf(contentHost, makeNode({ type: 'payload', content: 'p' }), 0)
    const fam = payload.anchors.find((a) => a.role === 'child')!.link
    fam.anchors.find((a) => a.role === 'parent')!.target = 'contentNodes'
    addComponentSource(payload, 'slotC', 'CN')

    const res = root.compile([root, leaf, payload])
    expect(res.dropped.some((d) => d.reason === 'owner-terminated')).toBe(true)
    const doc = serializeSlice(root, [root, leaf])
    expect(JSON.stringify(doc)).not.toContain(payload.id)
  })

  it('FRK-F3 — a looped arm is dropped with a circular-source warning while sibling arms still render', () => {
    const root = makeRoot({ type: 'root' })
    const a = childOf(root, makeNode({ type: 'a' }), 0)
    const b = childOf(a, makeNode({ type: 'b' }), 0)
    const sib = childOf(root, makeNode({ type: 'sib', content: 'ok' }), 1)
    targetAnchor(a, 'x')
    addComponentSource(b, 'x', 'bx', 'duplex')
    targetAnchor(b, 'y')
    addComponentSource(a, 'y', 'ay', 'duplex')

    const res = root.compile([root, a, b, sib])
    expect(res.warnings.some((w) => w.code === 'circular-source')).toBe(true)
    expect(res.dropped.some((d) => d.reason === 'loop')).toBe(true)
    expect(compiledFor(res, sib.id)).toBeDefined()
  })

  it('FRK-F4 — fork-key collision with differing content is a hard error, never a phantom coalesce', () => {
    const doc: SerializedRenderDoc = {
      template: { type: 'root' },
      content: [
        { id: 'n1', state: 'in-tree', type: 'div', props: { code: 'A' }, css: {}, children: [], anchors: [], forkKey: 'root/n1' },
        { id: 'n2', state: 'in-tree', type: 'div', props: { code: 'B' }, css: {}, children: [], anchors: [], forkKey: 'root/n1' },
      ],
      clientConfig: { adapter: 'dom', persistence: false },
    }
    expect(() => loadState(doc)).toThrow()
  })

  it('FRK-F5 — identical re-derived forks de-dupe by node ids + key trace', () => {
    const doc: SerializedRenderDoc = {
      template: { type: 'root' },
      content: [
        { id: 'n1', state: 'in-tree', type: 'div', props: { v: 1 }, css: {}, children: [], anchors: [], forkKey: 'root/n1' },
        { id: 'n1', state: 'in-tree', type: 'div', props: { v: 1 }, css: {}, children: [], anchors: [], forkKey: 'root/n1' },
      ],
      clientConfig: { adapter: 'dom', persistence: false },
    }
    const seeded = loadState(doc)
    expect(seeded).toHaveLength(1)
    expect(mintNodeId()).not.toBe(mintNodeId())
  })

  it('FRK-F6 — an ambiguous-but-terminating set surfaces as multiple valid states, never an arbitrary pick', () => {
    const { root, leaf, pA, pB } = forkSlice()
    const res = root.compile([root, leaf, pA, pB])
    const arms = res.actionable.filter((s) => s.nodeId === leaf.id)
    expect(arms.length).toBe(2)
    expect(res.dropped).toHaveLength(0)

    const options = arms.map((a) => (a.bindings['refX'] as { what: string }).what).sort()
    expect(options).toEqual(['A', 'B'])
  })
})

describe('§10.5 tree diff contract (D1–D5, render.md §3.2)', () => {
  it('D1 — new wires get create + one set per prop, object order; children attach via append', () => {
    const root = el('root', 'div', { 'prop:id': 'root' }, ['kid'])
    const kid = el('kid', 'span', { text: 'x' })
    const ops = diffMinimal(null, [root, kid])
    const kinds = ops.map((o) => o.kind)
    expect(kinds).toEqual(['create', 'set', 'create', 'set', 'append'])
    expect(ops[0]).toMatchObject({ kind: 'create', wire: 'root', type: 'div' })
    expect(ops[4]).toMatchObject({ kind: 'append', owner: 'root', child: 'kid' })
  })

  it('D3 — a type change is remove + create, never a morph', () => {
    const prev = [el('w', 'span', { text: 'a' })]
    const next = [el('w', 'strong', { text: 'a' })]
    const ops = diffMinimal(elMap(prev), next)
    expect(ops.map((o) => o.kind)).toEqual(['remove', 'create', 'set'])
  })

  it('D4 — unchanged props are silent; changed props emit set only', () => {
    const prev = [el('w', 'div', { 'prop:id': 'x', text: 'a' })]
    const next = [el('w', 'div', { 'prop:id': 'x', text: 'b' })]
    const ops = diffMinimal(elMap(prev), next)
    expect(ops).toEqual([{ kind: 'set', wire: 'w', name: 'text', value: 'b' }])
  })

  it('D5 — unchanged child order re-emits NO append (focused-editor blur guard)', () => {
    const root = el('root', 'div', {}, ['kid'])
    const kid = el('kid', 'div', { text: 'a' })
    const first = diffMinimal(null, [root, kid])
    expect(first.filter((o) => o.kind === 'append')).toHaveLength(1)
    // same order, only the kid's text changes
    const next = [root, el('kid', 'div', { text: 'b' })]
    const ops = diffMinimal(elMap([root, kid]), next)
    expect(ops.filter((o) => o.kind === 'append')).toHaveLength(0)
    expect(ops).toEqual([{ kind: 'set', wire: 'kid', name: 'text', value: 'b' }])
  })

  it('D5 — a changed child order re-appends in compiled order', () => {
    const root = el('root', 'div', {}, ['a', 'b'])
    const a = el('a', 'div', {})
    const b = el('b', 'div', {})
    const prevMap = elMap([root, a, b])
    // b moved before a
    const next = [el('root', 'div', {}, ['b', 'a']), b, a]
    const ops = diffMinimal(prevMap, next)
    expect(ops.filter((o) => o.kind === 'append').map((o) => o.child)).toEqual(['b', 'a'])
  })

  it('D5 — a newly created child appends even when the order string is unchanged', () => {
    // root order is ['a'] before and after; 'b' is brand new and shares no slot
    const root = el('root', 'div', {}, ['a', 'b'])
    const a = el('a', 'div', {})
    const b = el('b', 'div', {})
    const ops = diffMinimal(elMap([root, a]), [root, a, b])
    expect(ops.filter((o) => o.kind === 'append').map((o) => o.child)).toEqual(['b'])
  })

  it('ORD-P1 — diff scales sub-quadratically (no per-wire next.some, no per-element map rebuild)', () => {
    // Guard against the O(N²) regressions: a 4× input must NOT cost ~16×
    // (quadratic). Threshold is deliberately loose (8×) to stay CI-safe while
    // still catching a quadratic implementation (which measured 17× at n=4095).
    // Sampling is best-of-N (min over 5, after a warmup call): a single
    // wall-clock sample at sub-ms magnitudes is load-flaky (one GC pause on
    // the large run reads ≥8× for a LINEAR implementation — see the
    // methodology test below); the min estimates the uncontended run.
    const tree = (depth: number): MinimalElement[] => {
      const els: MinimalElement[] = []
      let id = 0
      const add = (layer: number): string => {
        const wire = 'n' + ++id
        const e = el(wire, 'div', { 'prop:id': wire, text: 'x' + id })
        els.push(e)
        if (layer < depth) {
          const a = add(layer + 1)
          const b = add(layer + 1)
          e.childOrder = [a, b]
        }
        return wire
      }
      add(1)
      return els
    }
    const run = (n: MinimalElement[], now: () => number = () => performance.now()): number => {
      const prev = new Map(n.map((e) => [e.wire, { ...e, props: { ...e.props } }]))
      const next = n.map((e) => (e.wire === 'n1' ? { ...e, props: { ...e.props, text: 'changed' } } : { ...e, props: { ...e.props } }))
      const t0 = now()
      diffMinimal(prev, next)
      return now() - t0
    }
    /** Warmup + best-of-N (min): the least-biased wall-clock estimator under
     *  contention — approximates the uncontended run. */
    const bestOf = (fn: () => number, k: number): number => {
      fn() // warmup: JIT + map/cache warm
      let best = Number.POSITIVE_INFINITY
      for (let i = 0; i < k; i += 1) best = Math.min(best, fn())
      return best
    }
    const small = bestOf(() => run(tree(10)), 5) // 1023 wires
    const big = bestOf(() => run(tree(12)), 5) // 4095 wires
    // linear would be ~4×; quadratic was ~17×. Assert clearly sub-quadratic.
    expect(big).toBeLessThan(small * 8)
  })

  it('ORD-P1 methodology — best-of-N is robust to a one-off pause on the large sample (single-shot is not)', () => {
    // Deterministic simulation of the flake: both sizes measure linearly
    // (0.04ms small / 0.04ms big — 1×, not even the 4× of n=4095) EXCEPT one
    // single timer tick pauses the big run to 0.48ms (12×). With sub-ms
    // magnitudes that is a realistic GC/scheduler pause under parallel test
    // workers — the measured single-shot ratio reads ≥8× for a LINEAR diff.
    // A fixed cumulative clock makes the simulation fully deterministic.
    const clock = (seq: number[]): (() => number) => {
      let i = 0
      return () => {
        const v = (seq[i] ?? seq[seq.length - 1]) ?? 0
        i += 1
        return v
      }
    }
    const tree = (depth: number): MinimalElement[] => {
      const els: MinimalElement[] = []
      let id = 0
      const add = (layer: number): string => {
        const wire = 'n' + ++id
        const node = el(wire, 'div', {})
        els.push(node)
        if (layer < depth) {
          const a = add(layer + 1)
          const b = add(layer + 1)
          node.childOrder = [a, b]
        }
        return wire
      }
      add(1)
      return els
    }
    const run = (n: MinimalElement[], now: () => number): number => {
      const prev = new Map(n.map((e) => [e.wire, { ...e, props: { ...e.props } }]))
      const next = n.map((e) => (e.wire === 'n1' ? { ...e, props: { ...e.props, text: 'changed' } } : { ...e, props: { ...e.props } }))
      const t0 = now()
      diffMinimal(prev, next)
      return now() - t0
    }
    const smallEls = tree(10)
    const bigEls = tree(12)
    // single-shot: small clean (0.04), big paused (0.48) → ratio 12 ≥ 8 → the
    // pre-fix methodology FAILS on a linear implementation under one pause.
    const singleShot = run(smallEls, clock([0, 0.04]))
    const singleShotBig = run(bigEls, clock([0, 0.48]))
    expect(singleShotBig).toBeGreaterThanOrEqual(singleShot * 8)
    // best-of-N: big sampled 5× (4 clean + 1 paused) → min reads the
    // uncontended 0.04 → ratio 1, well under the threshold.
    const bestBig = Math.min(...[0.04, 0.04, 0.04, 0.48, 0.04].map((d) => run(bigEls, clock([0, d]))))
    const bestSmall = Math.min(...[0.04, 0.04, 0.04, 0.04, 0.04].map((d) => run(smallEls, clock([0, d]))))
    expect(bestBig).toBeLessThan(bestSmall * 8)
  })
})

describe('emitElements — component-link (prototype-as-child) def chains', () => {
  const def = (n: string) => ({
    type: 'div',
    label: `link-${n}`,
    childOffset: 0,
    children: [
      { bind: 'a', type: 'div', content: `${n}.a` },
      { bind: 'b', type: 'div', content: `${n}.b` },
    ],
  })

  it('single link layer: def-covered children emit ONLY through the def (no standalone double-emit)', () => {
    const els = emitElements([
      { nodeId: 'a', type: 'span', children: ['b1', 'b2'], bindings: { 'link-1': def('1') } },
      { nodeId: 'b1', type: 'div' },
      { nodeId: 'b2', type: 'div' },
    ])
    const wires = els.map((e) => e.wire).sort()
    expect(wires).toEqual(['a', 'b1', 'b2'])
    const a = els.find((e) => e.wire === 'a')!
    expect(a.type).toBe('div') // pure link consumer takes the def type
    expect(a.childOrder).toEqual(['b1', 'b2'])
    expect(els.find((e) => e.wire === 'b1')!.props['text']).toBe('1.a')
    expect(els.find((e) => e.wire === 'b2')!.props['text']).toBe('1.b')
  })

  it('recursive link-only chain: every def consumer emits its OWN defChildren even when covered (no subtree loss below layer 2)', () => {
    const nodeById = new Map([
      ['b1', { children: [{ id: 'c1' }, { id: 'c2' }] }],
      ['b2', { children: [{ id: 'c3' }, { id: 'c4' }] }],
    ]) as unknown as Map<string, { handlers?: Array<{ event?: string; name?: string; body?: unknown }> }>
    const els = emitElements(
      [
        { nodeId: 'a', type: 'span', children: ['b1', 'b2'], bindings: { 'link-1': def('1') } },
        { nodeId: 'b1', type: 'span', children: ['c1', 'c2'], bindings: { 'link-2': def('2') } },
        { nodeId: 'b2', type: 'span', children: ['c3', 'c4'], bindings: { 'link-2': def('2') } },
        { nodeId: 'c1', type: 'div' },
        { nodeId: 'c2', type: 'div' },
        { nodeId: 'c3', type: 'div' },
        { nodeId: 'c4', type: 'div' },
      ],
      nodeById,
    )
    const wires = els.map((e) => e.wire).sort()
    expect(wires).toEqual(['a', 'b1', 'b2', 'c1', 'c2', 'c3', 'c4'])
    // b1 is covered (re-typed by a's def) but is ITSELF a def consumer: its
    // re-typed children (c1/c2) must still join the emitted set exactly once.
    const b1 = els.filter((e) => e.wire === 'b1')
    expect(b1).toHaveLength(1)
    expect(b1[0]!.props['text']).toBe('1.a')
    expect(b1[0]!.childOrder).toEqual(['c1', 'c2'])
    expect(els.find((e) => e.wire === 'c1')!.props['text']).toBe('2.a')
    expect(els.find((e) => e.wire === 'c1')!.childOrder).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// DEFECT #1 — emitElements/emitOne drop cs.forkKey (placement-path-spec §4.3,
// archive/findings/2026-08-15/2026-08-15-test-findings §"Stress-test review loop #1" DEFECT #1; fix shape: forward
// s.forkKey in every emitOne return branch, mirror minimalFromState)
// ---------------------------------------------------------------------------

describe('DEFECT #1 — emitOne forwards forkKey onto emitted elements and ops', () => {
  it('DEFECT-1a — fork arms emitted via emitElements carry cs.forkKey on elements and on create/set ops (distinct per arm)', () => {
    const { root, leaf, pA, pB } = forkSlice()
    const res = root.compile([root, leaf, pA, pB])
    const arms = res.actionable.filter((s) => s.nodeId === leaf.id)
    expect(arms).toHaveLength(2)
    const csKeys = arms.map((a) => a.forkKey)
    expect(csKeys.every((k) => typeof k === 'string')).toBe(true)
    expect(new Set(csKeys).size).toBe(2)

    const els = emitElements(res.actionable)
    const armEls = els.filter((e) => e.wire.startsWith(`${leaf.id}#`))
    expect(armEls).toHaveLength(2)
    for (const [i, el] of armEls.entries()) {
      expect(el.forkKey).toBe(csKeys[i])
    }

    const ops = diffMinimal(null, els)
    const armCreates = ops.filter(
      (o): o is Extract<RenderOp, { kind: 'create' }> => o.kind === 'create' && o.wire.startsWith(`${leaf.id}#`),
    )
    expect(armCreates).toHaveLength(2)
    for (const [i, op] of armCreates.entries()) {
      expect(op.forkKey).toBe(csKeys[i])
    }
    // each arm's set ops forward the same forkKey as its create (HLP-H16)
    const armSets = ops.filter(
      (o): o is Extract<RenderOp, { kind: 'set' }> => o.kind === 'set' && o.wire.startsWith(`${leaf.id}#`),
    )
    expect(armSets.length).toBeGreaterThan(0)
    for (const op of armSets) {
      expect(op.forkKey).toBe(csKeys[Number((op.wire as string).split('#')[1])])
    }
  })

  it('DEFECT-1b — a non-fork state emits with NO forkKey (unchanged)', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf', content: 'L' }), 0)
    addComponentSource(root, 'slot', 'v')
    targetAnchor(leaf, 'slot')
    const res = root.compile([root, leaf])
    const cs = compiledFor(res, leaf.id)
    expect(cs?.forkKey).toBeUndefined()

    const els = emitElements(res.actionable)
    const el = els.find((e) => e.wire === leaf.id)!
    expect('forkKey' in el).toBe(false)
    expect(el.forkKey).toBeUndefined()
    for (const op of diffMinimal(null, els)) {
      if (op.kind !== 'append' && op.kind !== 'styles') expect(op.forkKey).toBeUndefined()
    }
  })

  it('DEFECT-1c — applyOps/treeFromOps round-trip preserves forkKey per wire (wireKey distinctness)', () => {
    const { root, leaf, pA, pB } = forkSlice()
    const res = root.compile([root, leaf, pA, pB])
    const csKeys = res.actionable.filter((s) => s.nodeId === leaf.id).map((a) => a.forkKey)
    const els = emitElements(res.actionable)
    const ops = diffMinimal(null, els)

    // treeFromOps: arms stay distinct (wire, forkKey) entries
    const armEls = emitElements(res.actionable.filter((s) => s.nodeId === leaf.id))
    const armTrees = treeFromOpsReal(diffMinimal(null, armEls))
    expect(armTrees).toHaveLength(2)
    const treeKeys = new Set(armTrees.map((t) => t.forkKey))
    expect(treeKeys.size).toBe(2)
    expect(treeKeys.has(undefined)).toBe(false)
    const wireKeys = armTrees.map((t) => wireKey(t.wire, t.forkKey!))
    expect(new Set(wireKeys).size).toBe(2)

    // applyOps: a fork-aware adapter addresses arms through (wire, forkKey) composites
    const seen = new Set<string>()
    const adapter = {
      wires: new Map<string, { wire: string; type: string }>(),
      createEl(type: string, wire: NodeRef, forkKey?: string): { wire: string; type: string } {
        const e = { wire, type }
        const k = wireKey(wire, forkKey)
        this.wires.set(k, e)
        seen.add(k)
        return e
      },
      setProp(): void {},
      appendChild(): void {},
      hydrate(): void {},
      removeEl(): void {},
    }
    applyOpsReal(adapter as RenderAdapter<{ wire: string; type: string }>, ops)
    // every create arrives as a (wire, forkKey) composite — the root emits at
    // its plain wire; the two arm creates at their (leaf#i, forkKey) composites
    const creates = ops.filter((o) => o.kind === 'create')
    expect(seen.size).toBe(creates.length)
    for (const [i, csKey] of csKeys.entries()) {
      expect(seen.has(wireKey(`${leaf.id}#${i}`, csKey!))).toBe(true)
    }
  })

  it('DEFECT-1d — treeSig over forkKey-carrying ops is stable and exercises the forkKey dimension', () => {
    const { root, leaf, pA, pB } = forkSlice()
    const res = root.compile([root, leaf, pA, pB])
    const els = emitElements(res.actionable)
    const ops = diffMinimal(null, els)
    const trees = treeFromOpsReal(ops)
    const sig = treeSig(trees)
    expect(sig).toBe(treeSig(jsonClone(trees)))
    expect(sig).toBe(treeSig(treeFromOpsReal(diffMinimal(null, emitElements(res.actionable)))))
    // the forkKey dimension is live: stripping forkKey from the same op stream
    // changes the signature (before the fix, ops carried no forkKey and the
    // stripped stream was indistinguishable from the real one)
    const stripped: RenderOp[] = ops.map((o) => {
      if ('forkKey' in o) {
        const { forkKey: _k, ...rest } = o as { forkKey?: string } & RenderOp
        void _k
        return rest as RenderOp
      }
      return o
    })
    expect(treeSig(treeFromOpsReal(stripped))).not.toBe(sig)
  })

  it('DEFECT-1e — a fork carrying a def binding forwards forkKey through the def/type branch', () => {
    const defVal = { type: 'div', label: 'lk', childOffset: 0, children: [] }
    const els = emitElements([
      { nodeId: 'a', type: 'span', forkKey: 'path/a', bindings: { 'link-1': defVal } },
    ])
    expect(els).toHaveLength(1)
    expect(els[0]!.forkKey).toBe('path/a')
  })

  it('DEFECT-1f — applyOps/treeFromOps resolve bare-wire append/remove against forkKey-keyed elements (fork arms reach the DOM)', () => {
    // a plain emitting parent (pane) with a forked leaf child; the two
    // same-name providers live on TWO PROVIDER NODES under the leaf (the
    // legitimate multiplicity — §10.ab #4; same-node duplicates are the
    // component-source-duplicate anti-pattern)
    const root = makeRoot({ type: 'root', content: 'R' })
    const pane = childOf(root, makeNode({ type: 'pane' }), 0)
    const leaf = childOf(pane, makeNode({ type: 'leaf', content: 'L' }), 0)
    targetAnchor(leaf, 'refX')
    const pA = childOf(leaf, makeNode({ type: 'pA' }), 0)
    const pB = childOf(leaf, makeNode({ type: 'pB' }), 1)
    addComponentSource(pA, 'refX', { what: 'A' })
    addComponentSource(pB, 'refX', { what: 'B' })
    const res = root.compile([root, pane, leaf, pA, pB])
    const els = emitElements(res.actionable)
    const ops = diffMinimal(null, els)

    // the parent's childOrder adopts the arm wires in order (FRK-H2)
    const parentEl = els.find((e) => e.wire === pane.id)!
    expect(parentEl.childOrder).toEqual([`${leaf.id}#0`, `${leaf.id}#1`])

    // a fork-aware adapter stores elements under (wire, forkKey) composites —
    // exactly how DomAdapter/SSRFragmentAdapter address arms; the append ops
    // carry the BARE arm wire and must still resolve the element
    const appended = new Map<string, string[]>()
    const wires = new Map<string, { wire: string; type: string }>()
    const adapter = {
      wires,
      createEl(type: string, wire: NodeRef, forkKey?: string): { wire: string; type: string } {
        const e = { wire, type }
        this.wires.set(wireKey(wire, forkKey), e)
        return e
      },
      setProp(): void {},
      appendChild(owner: { wire: string }, child: { wire: string }): void {
        const arr = appended.get(owner.wire) ?? []
        arr.push(child.wire)
        appended.set(owner.wire, arr)
      },
      hydrate(): void {},
      removeEl(): void {},
    }
    applyOpsReal(adapter as RenderAdapter<{ wire: string; type: string }>, ops)

    // every fork-arm append op actually reaches its child element — before
    // the fix the arm elements lived under `wireKey(wire, forkKey)` and the
    // bare-wire appends silently skipped (feature-matrix "fork arms not
    // rendered into the DOM")
    const armAppends = ops.filter(
      (o): o is Extract<RenderOp, { kind: 'append' }> => o.kind === 'append' && o.child.startsWith(`${leaf.id}#`),
    )
    expect(armAppends).toHaveLength(2)
    for (const op of armAppends) {
      expect(appended.get(op.owner) ?? []).toContain(op.child)
    }
    expect(appended.get(pane.id)).toEqual([`${leaf.id}#0`, `${leaf.id}#1`])

    // treeFromOps nests the arm trees under the parent (same resolution)
    const trees = treeFromOpsReal(ops)
    const flat = (ts: RenderTree[]): RenderTree[] => ts.flatMap((t) => [t, ...flat(t.children)])
    const parent = flat(trees).find((t) => t.wire === pane.id)
    expect(parent).toBeDefined()
    expect(parent!.children.map((c) => c.wire)).toEqual([`${leaf.id}#0`, `${leaf.id}#1`])
    expect(parent!.children.every((c) => c.forkKey !== undefined)).toBe(true)
  })
})