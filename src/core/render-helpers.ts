import type { ForkPathKey, MinimalElement, RenderAdapter, RenderOp } from './render.js'
import type { NodeRef } from './types.js'

export interface MinimalElementSource {
  nodeId: string
  pathKey?: ForkPathKey
  type: string
  props?: Record<string, unknown>
  css?: Record<string, unknown>
  content?: unknown
  children?: string[]
  forkKey?: ForkPathKey
}

export interface RenderTree {
  wire: string
  type: string
  props: Record<string, unknown>
  children: RenderTree[]
  forkKey?: ForkPathKey
}

/** Composite (NodeRef, forkKey) table key: bare `wire`, or `wire + '\x00' + forkKey`. */
export function wireKey(wire: NodeRef, forkKey?: ForkPathKey): string {
  return forkKey === undefined ? wire : `${wire}\x00${forkKey}`
}

/** ForkKey-aware element lookup: exact (wire, forkKey) match first, then —
 *  for a BARE wire (append/remove ops carry the arm wire without its
 *  forkKey, render.ts:57/71) — any element stored under `wireKey(wire, …)`
 *  (DEFECT #1 completion: fork arms reach the adapter's wires map under
 *  composite keys, so bare-wire ops must resolve them by prefix). */
export function findEl<P>(
  stores: Array<Map<string, P> | undefined>,
  wire: NodeRef,
  forkKey?: ForkPathKey,
): P | undefined {
  const exact = wireKey(wire, forkKey)
  for (const store of stores) {
    const hit = store?.get(exact)
    if (hit !== undefined) return hit
  }
  if (forkKey !== undefined) return undefined
  const prefix = `${wire}\x00`
  for (const store of stores) {
    if (!store) continue
    for (const [k, v] of store) {
      if (k.startsWith(prefix)) return v
    }
  }
  return undefined
}

/** P3 §2.2 path-state test: identity = pathKey ALONE — `forkKey === pathKey`
 *  and the key carries NO arm-suffix grammar. The only other forkKey-bearing
 *  states are component fork arms, whose keys always contain `#f:`; placement
 *  pathKeys are `#`-free by the `placement-name-invalid`/`#`-check guards
 *  (§1.3). The root path-state ('root') and family-first path-states count. */
export function isPathState(s: { pathKey?: ForkPathKey; forkKey?: ForkPathKey }): boolean {
  return s.forkKey !== undefined && s.pathKey === s.forkKey && !s.pathKey.includes('#')
}

/** Wire scheme (§4.1): path-states emit on their pathKey wire (identity =
 *  pathKey alone); everything else emits on the nodeId wire (component fork
 *  arms get the `nodeId#<i>` suffix at emitOne). */
function pathWireOf(s: { nodeId: string; pathKey?: ForkPathKey; forkKey?: ForkPathKey }): string {
  return isPathState(s) ? s.pathKey! : s.nodeId
}

/** Compiled-state reducer: props → `prop:*`, css → `css:*` EXCLUDING cssDef, content → `text`. */
export function minimalFromState(cs: MinimalElementSource): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) {
    if (k === 'cssDef') continue
    props[`css:${k}`] = v
  }
  if (cs.content !== undefined) props['text'] = cs.content
  // P3 §4.1: a path-state's wire is its pathKey; family/non-path states keep
  // the nodeId wire. childOrder reads the state as-is (§4.2 — the per-path
  // conversion to child pathKey wires is the emitElements seam, which has the
  // full actionable set; single-state callers have no sibling context).
  const me: MinimalElement = { wire: pathWireOf(cs), type: cs.type, props, childOrder: [...(cs.children ?? [])] }
  if (cs.forkKey !== undefined) me.forkKey = cs.forkKey
  return me
}

type ForkAware<P, E> = RenderAdapter<P, E> & {
  createEl?(type: string, wire: NodeRef, forkKey?: ForkPathKey): P
  setProp?(wire: NodeRef, name: string, val: unknown, forkKey?: ForkPathKey): void
  removeEl?(wire: NodeRef, forkKey?: ForkPathKey): void
  styles?(cssDefs: unknown[]): void
  wires?: Map<string, P>
  fragments?: Map<string, P>
}

/**
 * Op-stream decoder: dispatches every RenderOp to the adapter, forwarding each op's
 * forkKey onto createEl/setProp/removeEl (contract.md adapters.md §2). append/remove
 * resolve owner/child from this batch's created map first, then from the adapter's
 * persistent `wires`/`fragments` map when it exposes one; a wire in neither is skipped.
 * `styles` ops invoke adapter.styles?.() when exposed (R5 supersedes the demo's skip).
 */
export function applyOps<P, E>(adapter: RenderAdapter<P, E>, ops: RenderOp[]): void {
  const fk = adapter as unknown as ForkAware<P, E>
  const created = new Map<string, P>()
  const persistent = (fk.wires ?? fk.fragments)
  const has = (w: NodeRef, forkKey?: ForkPathKey): P | undefined => findEl([created, persistent], w, forkKey)
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        created.set(wireKey(op.wire, op.forkKey), fk.createEl!(op.type, op.wire, op.forkKey))
        break
      case 'set':
        fk.setProp!(op.wire, op.name, op.value, op.forkKey)
        break
      case 'append': {
        const owner = has(op.owner)
        const child = has(op.child)
        if (owner && child) adapter.appendChild(owner, child)
        break
      }
      case 'remove': {
        const w = has(op.wire, op.forkKey)
        if (w && fk.removeEl) fk.removeEl(op.wire, op.forkKey)
        created.delete(wireKey(op.wire, op.forkKey))
        break
      }
      case 'styles':
        fk.styles?.(op.cssDefs)
        break
    }
  }
}

/** Structural tree read back from an op stream; keyed by wireKey so fork arms stay distinct. */
export function treeFromOps(ops: RenderOp[], opts?: { skip?: (name: string) => boolean }): RenderTree[] {
  const skip = opts?.skip
  const byWire = new Map<string, RenderTree>()
  const edges: Array<{ owner: string; child: string }> = []
  const propVals = new Map<string, Record<string, unknown>>()
  for (const op of ops) {
    switch (op.kind) {
      case 'create': {
        const tree: RenderTree = { wire: op.wire, type: op.type, props: {}, children: [] }
        if (op.forkKey !== undefined) tree.forkKey = op.forkKey
        byWire.set(wireKey(op.wire, op.forkKey), tree)
        break
      }
      case 'set':
        if (skip && skip(op.name)) break
        propVals.set(wireKey(op.wire, op.forkKey), {
          ...(propVals.get(wireKey(op.wire, op.forkKey)) ?? {}),
          [op.name]: op.value,
        })
        break
      case 'append':
        edges.push({ owner: op.owner, child: op.child })
        break
      default:
        break
    }
  }
  for (const [key, tree] of byWire) tree.props = propVals.get(key) ?? {}
  for (const e of edges) {
    // forkKey-aware resolution: append edges carry the bare arm wire while
    // create entries live under wireKey(wire, forkKey) (DEFECT #1 completion)
    const owner = findEl([byWire], e.owner)
    const child = findEl([byWire], e.child)
    if (owner && child) owner.children.push(child)
  }
  const childWires = new Set(edges.map((e) => e.child))
  return [...byWire.values()].filter((tree) => !childWires.has(tree.wire))
}

/** Canonical wire-agnostic PAR-5 signature; sorted object keys → stable under set-op order. */
export function treeSig(trees: RenderTree[]): string {
  const sig = trees.map((n) => {
    const node: Record<string, unknown> = {
      type: n.type,
      props: n.props,
      children: treeSig(n.children),
    }
    if (n.forkKey !== undefined) node.forkKey = n.forkKey
    return node
  })
  return JSON.stringify(sortKeys(sig))
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v !== null && typeof v === 'object') {
    const o: Record<string, unknown> = {}
    for (const k of Object.keys(v as Record<string, unknown>).sort()) {
      o[k] = sortKeys((v as Record<string, unknown>)[k])
    }
    return o
  }
  return v
}

/** JSON deep clone. */
export function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

/**
 * Emission layer — maps compiled states to renderable MinimalElements.
 * Canonical home of the fork-arm adoption rules (FRK-H2) and the component
 * binding interpretations (values-as-content, prototype-linked children);
 * the browser demos and the server builder share this so PAR-5 parity
 * compares identical emission.
 *
 * Conventions:
 *  - A node with ONE compiled state renders as its own wire.
 *  - A FORK (N > 1 states for one node) renders one element per arm, wired
 *    `<nodeId>#<i>` — fork arms are never coerced into one element.
 *  - Fork-arm adoption: a forked node NEVER emits an element for its base id
 *    `node-X` — only the `<nodeId>#<i>` arms, all leaves. So when a parent's
 *    `childOrder` references a forked node id, the emitter MUST expand that
 *    reference into the arm wires IN ARM ORDER (see `armWires` below). If the
 *    base id were left in `childOrder`, diffMinimal would look for a wire
 *    `node-X` that no element creates and silently attach no arm.
 *  - The parent adopts ALL arms as direct children (no per-fork wrapper
 *    element). Adopting exactly ONE arm via a `#<i>`-specific reference is
 *    NOT supported by this emit layer.
 *  - Content comes from a resolved component binding when present (the
 *    `theme` fork convention, or any `target`-resolved scalar binding — the
 *    "component provides values" layer), else the node's own `content`.
 *  - A binding that is a DEFINITION object (`{ type, children: [{bind,type}] }`)
 *    links the prototype as children: the consumer's element takes the def's
 *    type and expands `def.children` into child wires `${wire}:${bind}` whose
 *    text comes from the child's own resolved bindings (the "component links
 *    prototype as a child" layer).
 *  - Event handlers surface as `on:<event>` props (the adapter binds them).
 */
export interface EmitNodeSource {
  handlers?: Array<{ event?: string; name?: string; body?: unknown }>
}

export function emitElements(
  actionable: Array<{
    nodeId: string
    pathKey?: ForkPathKey
    trace?: string[]
    type: string
    props?: Record<string, unknown>
    css?: Record<string, unknown>
    content?: unknown
    children?: string[]
    bindings?: Record<string, unknown>
    forkKey?: ForkPathKey
  }>,
  nodeById?: Map<string, EmitNodeSource> | null,
): MinimalElement[] {
  // P3 §4.1 — group by WIRE, not nodeId: a path-state's wire is its pathKey
  // (identity = pathKey alone, §2.2), so every path-state forms its OWN
  // single-state group — it can never be armIdx'd. Only genuine component
  // forks (several `#f:`-keyed states of one node) stay multi-state groups
  // and emit the `nodeId#<i>` arms.
  const groups = new Map<string, EmitState[]>()
  for (const s of actionable) {
    const wire = pathWireOf(s)
    const arr = groups.get(wire)
    if (arr) arr.push(s)
    else groups.set(wire, [s])
  }
  // fork arms are wired `<nodeId>#<i>`; a parent referencing a forked node id
  // must adopt the arm wires so `diffMinimal` can attach them (FRK-H2).
  const armWires = new Map<string, string[]>()
  for (const [wire, states] of groups) {
    if (states.length > 1) armWires.set(wire, states.map((_, i) => `${wire}#${i}`))
  }
  const els: MinimalElement[] = []
  // P3 §2.3/§4.2 — per-path child conversion: a path-state's compiled
  // `children` are the child NODES' ids (path-derived at mint time); the
  // emitted childOrder must reference the CHILD STATES' pathKey wires. The
  // child state that extends a parent path-state's path is the one whose
  // trace = the parent's trace + the child's own id (mintPathState sets
  // `trace = [...hop owners root-down, nodeId]`), so the index buckets child
  // states by their parent's trace.
  const pathChildIndex = new Map<string, Map<string, string>>()
  const pathStateChildren = new Map<string, string[]>()
  const pathNodeOf = new Map<string, string>()
  for (const s of actionable) {
    if (!isPathState(s) || !s.pathKey || !s.trace) continue
    pathNodeOf.set(s.pathKey, s.nodeId)
    const parentTrace = s.trace.slice(0, -1).join('\u0000')
    let m = pathChildIndex.get(parentTrace)
    if (!m) {
      m = new Map()
      pathChildIndex.set(parentTrace, m)
    }
    m.set(s.nodeId, s.pathKey)
  }
  for (const s of actionable) {
    if (!isPathState(s) || !s.pathKey || !s.trace) continue
    const m = pathChildIndex.get(s.trace.join('\u0000'))
    if (m) pathStateChildren.set(s.pathKey, (s.children ?? []).map((c) => m.get(c) ?? c))
  }
  const convertedOf = (s: EmitState): string[] | undefined =>
    s.pathKey ? pathStateChildren.get(s.pathKey) : undefined
  // component-link layers: wires the def re-types are emitted ONLY through the
  // def (prototype-as-child) — their standalone states must not double-emit.
  // The covered set holds child WIRES (pathKey for path-state children).
  const defCovered = new Set<string>()
  for (const [wire, states] of groups) {
    const base = states[0]!
    const def = Object.values(base.bindings ?? {}).find(isLinkDef)
    if (!def) continue
    const offset = def.childOffset ?? 0
    const children = convertedOf(base) ?? base.children ?? []
    for (let i = 0; i < def.children.length; i += 1) {
      const cw = children[offset + i]
      if (cw) defCovered.add(cw)
    }
  }
  for (const [wire, states] of groups) {
    const multi = states.length > 1
    const base = states[0]!
    // P3 §4.2: the path-state emits with its converted child wires (read-only
    // states: a copy, never mutating the compiled state)
    const converted = convertedOf(base)
    const emitBase = converted ? { ...base, children: converted } : base
    const pathCtx: PathEmitContext | undefined =
      pathNodeOf.size > 0 || pathStateChildren.size > 0 ? { pathNodeOf, pathStateChildren } : undefined
    const emitted = emitOne(emitBase, multi ? 0 : undefined, nodeById, pathCtx)
    const covered = states.length === 1 && defCovered.has(wire)
    if (!covered) {
      const el = emitted.el
      if (multi) {
        el.childOrder = []
        // one element per arm; the first arm carries the full el, the rest are leaf dupes
        els.push(el)
        for (let i = 1; i < states.length; i += 1) els.push(emitOne(states[i]!, i, nodeById, pathCtx).el)
      } else {
        // remap any forked child references to their arm wires in arm order
        el.childOrder = el.childOrder.flatMap((c) => armWires.get(c) ?? [c])
        els.push(el)
      }
    }
    // component-link: the def re-typed child elements join the emitted set —
    // even for def-covered consumers: a covered consumer that is ITSELF a def
    // consumer (link-only chains — every level re-types the next) must still
    // emit its own defChildren, else the whole subtree below the covered node
    // vanishes from the element set.
    for (const c of emitted.defChildren ?? []) els.push(c)
  }
  return els
}

type EmitState = {
  nodeId: string
  pathKey?: ForkPathKey
  trace?: string[]
  type: string
  props?: Record<string, unknown>
  css?: Record<string, unknown>
  content?: unknown
  children?: string[]
  bindings?: Record<string, unknown>
  forkKey?: ForkPathKey
}

/** First resolved binding whose value is a scalar (string/number) — the
 *  "component provides values" convention. Falls back to the `theme` name
 *  first for fork-content parity with the feature-matrix demo. */
function scalarBinding(bindings?: Record<string, unknown>): unknown {
  if (!bindings) return undefined
  if (bindings['theme'] !== undefined) return bindings['theme']
  for (const v of Object.values(bindings)) {
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
  }
  return undefined
}

/** A definition object (prototype-as-child link) vs a scalar value. */
interface LinkDefSpec {
  type: string
  label?: string
  childLayersSuffix?: string
  childOffset?: number
  children: Array<{ bind: string; type: string; content?: unknown; css?: Record<string, unknown>; props?: Record<string, unknown> }>
}
function isLinkDef(v: unknown): v is LinkDefSpec {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string' &&
    Array.isArray((v as { children?: unknown }).children)
}

/** Per-path emit context passed down from emitElements (the full actionable
 *  set is the only place the child-state wires are knowable — §4.2). */
interface PathEmitContext {
  /** pathKey → the child state's node id (for the def branch's node lookup). */
  pathNodeOf: Map<string, string>
  /** pathKey → the path-state's converted child wires (def re-typed children
   *  adopt the child state's own path-derived childOrder). */
  pathStateChildren: Map<string, string[]>
}

function emitOne(
  s: EmitState,
  armIdx: number | undefined,
  nodeById?: Map<string, EmitNodeSource> | null,
  pathCtx?: PathEmitContext,
): { el: MinimalElement; defChildren?: MinimalElement[] } {
  // P3 §4.1 wire scheme: a path-state emits on its pathKey wire; a component
  // fork arm on `nodeId#<i>`; a family/non-path state on its nodeId.
  const wire = isPathState(s) ? s.pathKey! : armIdx !== undefined ? `${s.nodeId}#${armIdx}` : s.nodeId
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(s.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(s.css ?? {})) props[`css:${k}`] = v

  // component-link layer: a resolved def object supplies the consumer's
  // children (prototype-as-child: the def links the children, deciding their
  // element type + ancestry suffix). The consumer keeps its OWN type unless it
  // is a pure link consumer (no scalar binding) — a node that is ALSO a values
  // child keeps its authored type so the diff never re-creates it (type
  // changes would replace the element and break element identity).
  const def = Object.values(s.bindings ?? {}).find(isLinkDef)
  if (def && armIdx === undefined) {
    const parentLayers = s.props?.['stress:layers'] ?? ''
    const offset = def.childOffset ?? 0
    const childWires = s.children ?? []
    const reTyped = def.children.map((spec, i) => {
      const cw = childWires[offset + i] ?? `${wire}:${spec.bind}`
      const cprops: Record<string, unknown> = { text: String(spec.content ?? '') }
      if (def.childLayersSuffix && parentLayers) cprops['prop:stress:layers'] = `${parentLayers}|${def.childLayersSuffix}`
      // a REAL child (covered by the def, standalone emission skipped) keeps
      // its OWN authored css/props — the def's css/props are a fallback only
      // for synthetic `${wire}:${bind}` children with no graph node behind
      // them. (Per-node unique stress css is authored on the child node.)
      // It ALSO keeps its OWN children: a real child may itself have a child
      // subtree (the next layer), which the emitted element must adopt so
      // diffMinimal nests them (the "boxes must nest" contract). For a
      // path-state child the wire is its pathKey — the node id comes from the
      // emit context, and its own children are its path-derived child wires.
      const childNodeId = pathCtx?.pathNodeOf.get(cw) ?? cw
      const childNode = nodeById?.get(childNodeId) as unknown as { css?: Record<string, unknown>; props?: Record<string, unknown>; children?: Array<{ id: string }> } | undefined
      for (const [k, v] of Object.entries(childNode?.css ?? spec.css ?? {})) cprops[`css:${k}`] = v
      for (const [k, v] of Object.entries(childNode?.props ?? spec.props ?? {})) cprops[`prop:${k}`] = v
      const childOrder = pathCtx?.pathStateChildren.get(cw)
        ?? (childNode ? (childNode.children ?? []).map((c) => c.id) : [])
      return { wire: cw, type: spec.type, props: cprops, childOrder }
    })
    // full child order: untouched children (before the def slice) + def-typed
    const order = [...childWires.slice(0, offset), ...reTyped.map((c) => c.wire)]
    const bound = scalarBinding(s.bindings)
    if (bound !== undefined) props['text'] = bound
    const type = bound !== undefined ? s.type : def.type
    const el: MinimalElement = { wire, type, props, childOrder: order }
    if (s.forkKey !== undefined) el.forkKey = s.forkKey
    return { el, defChildren: reTyped }
  }

  const bound = scalarBinding(s.bindings)
  const content = bound !== undefined ? bound : s.content
  if (content !== undefined) props['text'] = content
  if (armIdx === undefined) {
    const node = nodeById?.get(s.nodeId)
    const handlers = node ? (node.handlers ?? []) : []
    for (const h of handlers) {
      if (h && typeof h === 'object' && typeof h.event === 'string') props[`on:${h.event}`] = true
    }
    const el: MinimalElement = { wire, type: s.type, props, childOrder: [...(s.children ?? [])] }
    if (s.forkKey !== undefined) el.forkKey = s.forkKey
    return { el }
  }
  // fork arms are leaves in this page (no children on the themed divs)
  const el: MinimalElement = { wire, type: s.type, props, childOrder: [] }
  if (s.forkKey !== undefined) el.forkKey = s.forkKey
  return { el }
}
