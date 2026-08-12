import type { ForkPathKey, MinimalElement, RenderAdapter, RenderOp } from './render.js'
import type { NodeRef } from './types.js'

export interface MinimalElementSource {
  nodeId: string
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

/** Compiled-state reducer: props → `prop:*`, css → `css:*` EXCLUDING cssDef, content → `text`. */
export function minimalFromState(cs: MinimalElementSource): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) {
    if (k === 'cssDef') continue
    props[`css:${k}`] = v
  }
  if (cs.content !== undefined) props['text'] = cs.content
  const me: MinimalElement = { wire: cs.nodeId, type: cs.type, props, childOrder: [...(cs.children ?? [])] }
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
  const has = (w: NodeRef): P | undefined => created.get(w) ?? (fk.wires ?? fk.fragments)?.get(w)
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
        const w = has(op.wire)
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
    const owner = byWire.get(e.owner)
    const child = byWire.get(e.child)
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
    type: string
    props?: Record<string, unknown>
    css?: Record<string, unknown>
    content?: unknown
    children?: string[]
    bindings?: Record<string, unknown>
  }>,
  nodeById?: Map<string, EmitNodeSource> | null,
): MinimalElement[] {
  const groups = new Map<string, EmitState[]>()
  for (const s of actionable) {
    const arr = groups.get(s.nodeId)
    if (arr) arr.push(s)
    else groups.set(s.nodeId, [s])
  }
  const els: MinimalElement[] = []
  // fork arms are wired `<nodeId>#<i>`; a parent referencing a forked node id
  // must adopt the arm wires so `diffMinimal` can attach them (FRK-H2).
  const armWires = new Map<string, string[]>()
  for (const [nodeId, states] of groups) {
    if (states.length > 1) armWires.set(nodeId, states.map((_, i) => `${nodeId}#${i}`))
  }
  // component-link layers: wires the def re-types are emitted ONLY through the
  // def (prototype-as-child) — their standalone states must not double-emit.
  const defCovered = new Set<string>()
  for (const [nodeId, states] of groups) {
    const base = states[0]!
    const def = Object.values(base.bindings ?? {}).find(isLinkDef)
    if (!def) continue
    const offset = def.childOffset ?? 0
    for (let i = 0; i < def.children.length; i += 1) {
      const cw = (base.children ?? [])[offset + i]
      if (cw) defCovered.add(cw)
    }
  }
  for (const [, states] of groups) {
    if (states.length === 1 && defCovered.has(states[0]!.nodeId)) continue
    const multi = states.length > 1
    const base = states[0]!
    const emitted = emitOne(base, multi ? 0 : undefined, nodeById)
    const el = emitted.el
    if (multi) {
      el.childOrder = []
      // one element per arm; the first arm carries the full el, the rest are leaf dupes
      els.push(el)
      for (let i = 1; i < states.length; i += 1) els.push(emitOne(states[i]!, i, nodeById).el)
    } else {
      // remap any forked child references to their arm wires in arm order
      el.childOrder = el.childOrder.flatMap((c) => armWires.get(c) ?? [c])
      els.push(el)
    }
    // component-link: the def re-typed child elements join the emitted set
    for (const c of emitted.defChildren ?? []) els.push(c)
  }
  return els
}

type EmitState = {
  nodeId: string
  type: string
  props?: Record<string, unknown>
  css?: Record<string, unknown>
  content?: unknown
  children?: string[]
  bindings?: Record<string, unknown>
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
  children: Array<{ bind: string; type: string; content?: unknown }>
}
function isLinkDef(v: unknown): v is LinkDefSpec {
  return typeof v === 'object' && v !== null && typeof (v as { type?: unknown }).type === 'string' &&
    Array.isArray((v as { children?: unknown }).children)
}

function emitOne(
  s: EmitState,
  armIdx: number | undefined,
  nodeById?: Map<string, EmitNodeSource> | null,
): { el: MinimalElement; defChildren?: MinimalElement[] } {
  const wire = armIdx !== undefined ? `${s.nodeId}#${armIdx}` : s.nodeId
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
      return { wire: cw, type: spec.type, props: cprops, childOrder: [] }
    })
    // full child order: untouched children (before the def slice) + def-typed
    const order = [...childWires.slice(0, offset), ...reTyped.map((c) => c.wire)]
    const bound = scalarBinding(s.bindings)
    if (bound !== undefined) props['text'] = bound
    const type = bound !== undefined ? s.type : def.type
    return { el: { wire, type, props, childOrder: order }, defChildren: reTyped }
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
    return { el: { wire, type: s.type, props, childOrder: [...(s.children ?? [])] } }
  }
  // fork arms are leaves in this page (no children on the themed divs)
  return { el: { wire, type: s.type, props, childOrder: [] } }
}
