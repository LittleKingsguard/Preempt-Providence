/**
 * Step 7 e2e — SSR → client complete render (docs/subagents.md Step 7, render.md §5/§7/§8).
 *
 * Proves the end-to-end contract on the public surface only:
 *   tree → compile(slice) → serializeSlice (SSR JSON doc) → loadState (client parse)
 *   → Node re-construction → recompile → diffMinimal → adapter ops (client render),
 * with placements + components + nesting, and asserts SSR/client structural parity (PAR-5).
 */
import { describe, it, expect } from 'vitest'
import { Node, reconcileParentTargets } from '../../src/core/node.js'
import { diffMinimal, MockAdapter, type RenderOp, type MinimalElement, type RenderAdapter } from '../../src/core/render.js'
import { serializeSlice, loadState, type SerializedRenderDoc } from '../../src/core/serialize.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import type { NodeId } from '../../src/core/types.js'

type CompiledState = ReturnType<Node['compile']>['actionable'][number]

interface PEl {
  wire: string
  type: string
}

function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/** Compiled state → MinimalElement (render.md §3.2): props namespaced, text for content. */
function minimalFromState(cs: CompiledState): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) props[`css:${k}`] = v
  if (cs.content !== undefined) props['text'] = cs.content
  return { wire: cs.nodeId, type: cs.type, props, childOrder: [...cs.children] }
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

/** Structural tree read back from an op stream (adapter-neutral, PAR-5). */
interface OpsTree {
  wire: string
  type: string
  props: Record<string, unknown>
  children: OpsTree[]
}

function treeFromOps(ops: RenderOp[]): OpsTree[] {
  const byWire = new Map<string, OpsTree>()
  const edges: Array<{ owner: string; child: string }> = []
  const propVals = new Map<string, Record<string, unknown>>()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        byWire.set(op.wire, { wire: op.wire, type: op.type, props: {}, children: [] })
        break
      case 'set':
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

/** Serialize → client parse → re-construct → recompile → render ops. The client half of SSR-H1. */
function clientRender(doc: SerializedRenderDoc): { ops: RenderOp[]; roots: OpsTree[] } {
  const seeded = loadState(jsonClone(doc)).map((d) => new Node(d, hub()))
  reconcileParentTargets(seeded)
  const cr = seeded[0]!.compile(seeded)
  const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
  const adapter = new MockAdapter()
  applyOps(adapter, ops)
  return { ops, roots: treeFromOps(ops) }
}

/** Wire equality of two render trees — structural parity ignoring set-op ordering (PAR-5). */
function assertTreesEqual(a: OpsTree[], b: OpsTree[]): void {
  const norm = (t: OpsTree[]): string =>
    JSON.stringify(
      t.map((n) => ({
        type: n.type,
        props: n.props,
        children: norm(n.children),
      })),
    )
  expect(norm(a)).toBe(norm(b))
}

/**
 * A nested pane: dock (child of root) consumes 'feed' and nests a leaf; the
 * two 'feed' providers live on TWO PROVIDER NODES under dock (the legitimate
 * multiplicity — §10.ab #4; same-node same-name sources are the guarded
 * anti-pattern); zone (child of root) carries a placement anchor. Renderable
 * set: dock fork arms, nested leaf, zone; the consumed providers are fork
 * candidates, not standalone states (FRK contract).
 */
function buildNestedPane() {
  const root = makeRoot({ type: 'app', content: 'shell', css: { id: 'css-app' } })
  const dock = childOf(root, makeNode({ type: 'dock', props: { role: 'main' }, css: { id: 'css-dock' } }), 0)
  const inner = childOf(dock, makeNode({ type: 'badge', content: 'inner', css: { id: 'css-inner' } }), 0)
  const fA = childOf(dock, makeNode({ type: 'feedA' }), 1)
  const fB = childOf(dock, makeNode({ type: 'feedB' }), 2)
  addComponentSource(fA, 'feed', { label: 'A' })
  addComponentSource(fB, 'feed', { label: 'B' })
  targetAnchor(dock, 'feed')
  const zone = childOf(root, makeNode({ type: 'zone', content: 'slot', css: { id: 'css-zone' } }), 1)
  const plink = hub().linkFor('slot-alpha', 'placement')
  zone.addAnchor('container', 'slot-alpha', {}, plink)
  return { root, dock, inner, zone, fA, fB }
}

describe('e2e — SSR receive → complete render (Step 7)', () => {
  it('SSR-H1: server doc + client re-render produce structurally equal trees (PAR-5)', () => {
    const { root, dock, inner, zone, fA, fB } = buildNestedPane()
    const slice = [root, dock, inner, zone, fA, fB]

    // server: compile → serialized JSON doc
    const serverCr = root.compile(slice)
    const dockArms = serverCr.actionable.filter((s) => s.nodeId === dock.id)
    expect(dockArms).toHaveLength(2) // both providers actionable, never a coerced pick
    const serverOps = diffMinimal(null, serverCr.actionable.map(minimalFromState))
    const serverAdapter = new MockAdapter()
    applyOps(serverAdapter, serverOps)
    const serverTree = treeFromOps(serverOps)

    const doc = serializeSlice(root, slice)
    expect(JSON.parse(JSON.stringify(doc))).toEqual(doc) // first-class JSON (NVS-5)

    // client: parse → re-construct → recompile → render
    const { ops: clientOps, roots: clientTree } = clientRender(doc)

    // complete valid render: consumers + nested leaves + zone render;
    // consumed providers are fork candidates, not standalone wires
    const wires = (t: OpsTree[]): string[] => t.flatMap((n) => [n.wire, ...wires(n.children)])
    expect(wires(clientTree)).toContain(dock.id)
    expect(wires(clientTree)).toContain(inner.id)
    expect(wires(clientTree)).toContain(zone.id)
    // both fork arms emit a create for the same wire (fork-keyed arms, §6)
    expect(clientOps.filter((o) => o.kind === 'create' && o.wire === dock.id)).toHaveLength(2)

    // fork candidate values surface through the consumer's bindings, never as phantom wires
    const clientCr = (() => {
      const seeded = loadState(jsonClone(doc)).map((d) => new Node(d, hub()))
      reconcileParentTargets(seeded)
      return seeded[0]!.compile(seeded)
    })()
    const bindings = clientCr.actionable
      .filter((s) => s.nodeId === dock.id)
      .map((s) => s.bindings['feed'])
    expect(bindings).toContainEqual({ label: 'A' })
    expect(bindings).toContainEqual({ label: 'B' })

    assertTreesEqual(serverTree, clientTree)
  })

  it('SSR-H3: client re-resolves from anchors — shipped forks are not materialized, recompile equals own compile', () => {
    const { root, dock, inner, zone, fA, fB } = buildNestedPane()
    const slice = [root, dock, inner, zone, fA, fB]

    const doc = serializeSlice(root, slice)
    const seeded = loadState(jsonClone(doc)).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded)

    // the client re-runs the SAME pipeline from serialized anchors (S4.2)
    const cr = seeded[0]!.compile(seeded)
    const arms = cr.actionable.filter((s) => s.nodeId === dock.id)
    expect(arms).toHaveLength(2)
    expect(new Set(arms.map((a) => a.pathKey)).size).toBe(2)

    // fork arms trace THIS graph's live node ids (the provider nodes)
    const traces = arms.map((a) => a.trace ?? [])
    expect(traces.every((t) => t.includes(fA.id) || t.includes(fB.id))).toBe(true)
  })

  it('SSR-H2: hydrate reuses SSR DOM via the css.id seam, then binds wires', () => {
    const { root, dock, inner, zone, fA, fB } = buildNestedPane()
    const slice = [root, dock, inner, zone, fA, fB]
    const doc = serializeSlice(root, slice)

    const seeded = loadState(jsonClone(doc)).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded)
    const cr = seeded[0]!.compile(seeded)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))

    // a hydration adapter reuses css.id-keyed elements (render.md §5.1 seam)
    const reused = new Set<string>()
    class HydrationAdapter implements RenderAdapter<PEl> {
      readonly els = new Map<string, PEl>()
      createEl(type: string, wire: NodeId): PEl {
        const e = { wire, type }
        this.els.set(wire, e)
        return e
      }
      setProp(): void {}
      appendChild(): void {}
      removeEl(): void {}
      hydrate(rootWire: NodeId, vdom: unknown): void {
        for (const n of (vdom as SerializedRenderDoc).content as Array<{ css?: { id?: string } }>) {
          const cssId = n.css?.id
          if (cssId) reused.add(cssId)
        }
        void rootWire
      }
    }
    const adapter = new HydrationAdapter()
    applyOps(adapter, ops)
    adapter.hydrate(seeded[0]!.id, doc)
    expect(reused.size).toBeGreaterThan(0)
    // every unique wire (fork arms share a wire) got a create
    const uniqueWires = new Set(ops.filter((o) => o.kind === 'create').map((o) => o.wire))
    expect([...adapter.els.keys()].length).toBe(uniqueWires.size)
  })

  it('SSR-F1: a shipped fork id is never trusted — client resolution produces its own fork surface', () => {
    const { root, dock, fA, fB } = buildNestedPane()
    const slice = [root, dock, fA, fB]
    const doc = serializeSlice(root, slice)

    // tamper: plant a stale fork trace that does NOT exist in the client graph
    const tampered = jsonClone(doc)
    const target = (tampered.content as Array<Record<string, unknown>>).find((n) => n.id === dock.id)
    target!.forkKey = 'root/stale-node/arm'

    const seeded = loadState(tampered).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded)
    const cr = seeded[0]!.compile(seeded)
    const arms = cr.actionable.filter((s) => s.nodeId === dock.id)
    // re-resolution is canon: same live surface, not the tampered trace
    expect(arms).toHaveLength(2)
    for (const a of arms) {
      expect(a.pathKey).not.toContain('stale-node')
    }
  })

  it('placements + components + nested: placement anchors render alongside forked component slots', () => {
    const { root, zone, dock, fA, fB } = buildNestedPane()
    const slice = [root, zone, dock, fA, fB]
    const cr = root.compile(slice)
    const zoneState = cr.actionable.find((s) => s.nodeId === zone.id)
    expect(zoneState).toBeDefined()
    // placement anchor survives compile and serialization as a typed ref
    const doc = serializeSlice(root, slice)
    const serializedZone = (doc.content as Array<Record<string, unknown>>).find((n) => n.id === zone.id)
    const anchors = serializedZone!.anchors as Array<{ role: string; target: string }>
    expect(anchors.some((a) => a.role === 'container' && a.target === 'slot-alpha')).toBe(true)

    // client render includes the placement zone node
    const { roots } = clientRender(doc)
    const wires = (t: OpsTree[]): string[] => t.flatMap((n) => [n.wire, ...wires(n.children)])
    expect(wires(roots)).toContain(zone.id)
    expect(wires(roots)).toContain(dock.id)
  })
})
