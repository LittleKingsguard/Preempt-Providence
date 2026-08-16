import type { ForkPathKey, MinimalElement, RenderAdapter, RenderOp } from './render.js'
import type { Anchor, NodeRef } from './types.js'
import { kebabKey } from './translate.js'
import { defPrototypesFor, defRootPrototypeFor } from './registry.js'

/** D4/STL-1 — serialize one css.cssDef value (a `StyleNode[]` or a single
 *  StyleNode `{selector, styles}`) into RULE STRINGS `{selector}{kebab-case
 *  k: v; styles}`. A NESTED `styles` value (the media-query form
 *  `{'.a': {...}}`) serializes recursively as nested `{selector}{…}` blocks
 *  inside the outer rule. Non-array/non-object cssDef values (a stray string
 *  like `'.x{}'`) contribute no rules. */
export function cssDefRules(cssDef: unknown): string[] {
  const entries = Array.isArray(cssDef)
    ? cssDef
    : cssDef !== null && typeof cssDef === 'object'
      ? [cssDef]
      : []
  const out: string[] = []
  for (const raw of entries) {
    if (raw === null || typeof raw !== 'object') continue
    const entry = raw as { selector?: unknown; styles?: unknown }
    const sel = typeof entry.selector === 'string' ? entry.selector : ''
    const styles = entry.styles
    if (styles === null || typeof styles !== 'object' || Array.isArray(styles)) continue
    out.push(`${sel}{${ruleBody(styles as Record<string, unknown>)}}`)
  }
  return out
}

/** STL-1 — the rule body: scalar entries serialize kebab-case `k: v;` (the
 *  outer rule's form); a NESTED value serializes recursively as
 *  `{selector}{k:v;…}` blocks (the media-query form, no outer spacing). */
function ruleBody(styles: Record<string, unknown>, top = true): string {
  let scalars = ''
  let nested = ''
  for (const [k, v] of Object.entries(styles)) {
    if (v !== null && typeof v === 'object') {
      nested += `${k}{${ruleBody(v as Record<string, unknown>, false)}}`
    } else {
      scalars += top ? `${kebabKey(k)}: ${String(v)};` : `${kebabKey(k)}:${String(v)};`
    }
  }
  return scalars + nested
}

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

/** Compiled-state reducer: props → `prop:*`, css → `css:*` EXCLUDING cssDef
 *  (cssDef → the element's `styles` RULE STRINGS, D4/STL-1), content → `text`. */
export function minimalFromState(cs: MinimalElementSource): MinimalElement {
  const props: Record<string, unknown> = {}
  const styles: string[] = []
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) {
    if (k === 'cssDef') {
      styles.push(...cssDefRules(v))
      continue
    }
    props[`css:${k}`] = v
  }
  if (cs.content !== undefined) props['text'] = cs.content
  // P3 §4.1: a path-state's wire is its pathKey; family/non-path states keep
  // the nodeId wire. childOrder reads the state as-is (§4.2 — the per-path
  // conversion to child pathKey wires is the emitElements seam, which has the
  // full actionable set; single-state callers have no sibling context).
  const me: MinimalElement = { wire: pathWireOf(cs), type: cs.type, props, childOrder: [...(cs.children ?? [])] }
  if (styles.length > 0) me.styles = styles
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
    anchors?: readonly Anchor[]
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
    const entry = Object.entries(base.bindings ?? {}).find(([, v]) => isLinkDef(v)) as [string, LinkDefSpec] | undefined
    if (!entry) continue
    const def = entry[1]
    if (!linkChainAllowed(base, def, entry[0])) continue
    const offset = def.childOffset ?? 0
    const children = convertedOf(base) ?? base.children ?? []
    for (let i = 0; i < def.children.length; i += 1) {
      const cw = children[offset + i]
      if (cw) defCovered.add(cw)
    }
  }
  // D8/DFC-1..3 — real children whose wire emits STANDALONE (a non-covered
  // group) must never also be pushed as def-branch defChildren: the blocked
  // def branch's covered real children (no standalone state available, or a
  // seam/mismatch block) join the element set only when nothing else emits
  // their wire.
  const standaloneWires = new Set<string>()
  for (const [wire, states] of groups) {
    if (!(states.length === 1 && defCovered.has(wire))) standaloneWires.add(wire)
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
    // vanishes from the element set. D8/DFC-1..3 — real children with a
    // standalone emission keep their OWN element (the blocked def branch
    // never double-emits a wire).
    for (const c of emitted.defChildren ?? []) {
      if (!standaloneWires.has(c.wire)) els.push(c)
    }
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
  /** the node's anchors (compiled states carry them) — D8/DFC-2: a seam
   *  target anchor's `options.seam` marks the binding as seam-planned, and a
   *  SEAM-TARGET def never drives an emit-time chain */
  anchors?: readonly Anchor[]
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

/** D8/DFC-2 (F23) — a SEAM-TARGET binding (the node carries a `target` anchor
 *  for the name with `options.seam` — translate.md TR-H15) NEVER drives an
 *  emit-time chain: seam materialization is the D7 anchor layer's job. */
function isSeamDefBinding(s: EmitState, name: string): boolean {
  return (s.anchors ?? []).some(
    (a) => a.role === 'target' && typeof a.target === 'string' && a.target === name
      && a.options.seam !== undefined,
  )
}

/** D8/DFC-1..3 (F22/F23) — the emit-time def-chain gate:
 *  - a CHILDLESS host is always filled by the def (the seam slot / def-
 *    provides-children case — path-emit P-EMIT-3, the [5]/[6] seam wrappers,
 *    the fork-stress leaf clones): the def's children become the host's
 *    emitted children;
 *  - a SEAM-TARGET def NEVER re-types/aliases REAL authored children (DFC-2,
 *    [14]) — the seam is the materialization path, the emit layer never
 *    clobbers the host's own children;
 *  - the chain runs ONLY for RE-TYPING-SPEC defs — every def child is a
 *    re-typing spec (a `bind`-keyed spec OR a TYPE-ONLY spec with no
 *    content/css/props/children/component beyond the type — the blind
 *    emit-layer pin) — at offset 0 with the def's children covering the real
 *    children from the first wire on (1:1 for bind-specs, >= for type-only
 *    specs — the blind 2-specs-vs-1-child case);
 *  - a DELIVERABLE-spec def (any def child carrying content/css/props/
 *    children/component — the live-prod navBar/header/footer defs) NEVER
 *    drives a chain: its subtree materializes through the seam (B1 ruling
 *    2026-08-14 — the root's own source binding must not re-type its
 *    children); no re-typing, no drops, no synthetic wires, real children
 *    keep their own types and order. */
function linkChainAllowed(s: EmitState, def: LinkDefSpec, name: string): boolean {
  const childWires = s.children ?? []
  if ((def.childOffset ?? 0) !== 0) return false
  if (childWires.length === 0) return true
  if (isSeamDefBinding(s, name)) return false
  const retypingSpecs = def.children.every((c) => {
    if (c === null || typeof c !== 'object') return false
    if (typeof (c as { bind?: unknown }).bind === 'string') return true
    return (c as { content?: unknown; css?: unknown; props?: unknown; children?: unknown; component?: unknown })
      .content === undefined
      && (c as { css?: unknown }).css === undefined
      && (c as { props?: unknown }).props === undefined
      && (c as { children?: unknown }).children === undefined
      && (c as { component?: unknown }).component === undefined
  })
  if (!retypingSpecs) return false
  const bindSpecs = def.children.every((c) => typeof (c as { bind?: unknown }).bind === 'string')
  if (bindSpecs) return def.children.length === childWires.length
  return def.children.length >= childWires.length
}

/** SED-2/B1 — seam-'children' SHELL element construction: the
 *  ALWAYS-PERFORMED per-node operations for a children-target consumer's
 *  OWN element, shared by the TOP-LEVEL branch (emitOne) and the NESTED
 *  branch (emitDefChildTree) so neither can drift (DEFECT #4 — the nested
 *  branch deleted the shell's authored text while the top-level preserved
 *  it):
 *  1. own-text preservation — the shell keeps its OWN authored content
 *     (B1: node data as-is — never deleted, never replaced by the def's);
 *  2. styles forwarding — the shell's cssDef rules ride its `styles` field;
 *  3. forkKey forwarding — path-states carry forkKey = pathKey.
 *  The def-root joins as an ADDITIONAL child (the caller appends its wire). */
function makeSeamShellEl(
  wire: string,
  type: string,
  props: Record<string, unknown>,
  ownText: unknown,
  childOrder: string[],
  styles: string[],
  forkKey: ForkPathKey | undefined,
): MinimalElement {
  if (ownText !== undefined) props['text'] = ownText
  const el: MinimalElement = { wire, type, props, childOrder }
  if (styles.length > 0) el.styles = styles
  if (forkKey !== undefined) el.forkKey = forkKey
  return el
}

/** One def-child spec tree node: the deliverable spec data (type/content/
 *  css/props/children — the authored def value) or a bind-spec re-type
 *  target. */
type DefChildSpec = LinkDefSpec['children'][number] & { children?: DefChildSpec[]; component?: unknown }

/** The resolved seam/def binding for a compiled state: the FIRST binding
 *  whose value is a def object — a SEAM-TARGETED def (a target anchor with
 *  `options.seam` for the name — including LEAF defs with no children
 *  array, SED-2/`[14]`) or a link-method/deliverable def (type + children
 *  array). `content`-targets are found too — the caller skips the def
 *  branch for them (SED-3 — text only). */
function findDefBinding(
  s: EmitState,
): { name: string; def: LinkDefSpec & { content?: unknown; css?: Record<string, unknown>; children?: Array<DefChildSpec> }; seam: 'type' | 'content' | 'children' | undefined } | undefined {
  for (const [name, v] of Object.entries(s.bindings ?? {})) {
    if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
    const d = v as { type?: unknown; children?: unknown }
    if (typeof d.type !== 'string') continue
    const seamAnchor = (s.anchors ?? []).find(
      (a) => (a.role === 'target' || a.role === 'duplex') && typeof a.target === 'string' && a.target === name && a.options.seam !== undefined,
    )
    const seam = seamAnchor ? (seamAnchor.options.seam as 'type' | 'content' | 'children') : undefined
    if (seam !== undefined || Array.isArray(d.children)) {
      return { name, def: v as never, seam: seam as 'type' | 'content' | 'children' | undefined }
    }
  }
  return undefined
}

/** DEFECT #20 (2026-08-16) — the def-fill prune: a DESTROYED adopted def
 *  child must not emit. The def-fill iterates the def DATA (specs zipped
 *  with the registry protos) — the destroyed flag on the proto is the only
 *  signal (the node's own states already dropped: destroyed ⇒ not
 *  actionable). Only adopted (runtime-minted, AUTH-SEAM retention-destroy)
 *  def children can ever carry the flag — the registry protos are
 *  otherwise inert — so the check is exactly the adoption prune. */
function defChildPruned(proto: unknown): boolean {
  return typeof proto === 'object' && proto !== null && (proto as { destroyed?: boolean }).destroyed === true
}

/** SED-2 — the DEF-ROOT element: the def's own root element (def type +
 *  css incl. cssDef rules + content) with the def's children nested under it
 *  in order. `rootProto` is the pre-minted def-root prototype when the def
 *  carries css (its serialized css enriches the element); `childProtos` zip
 *  the def-children prototypes for the nested recursion. The wire is
 *  synthetic — the prototype's id never surfaces in the element set. */
function emitDefRootElement(
  def: LinkDefSpec & { content?: unknown; css?: Record<string, unknown>; children?: Array<DefChildSpec> },
  rootWire: string,
  rootProto: (NodeLike & { anchors?: Anchor[] }) | undefined,
  childProtos: Array<(NodeLike & { anchors?: Anchor[]; children?: NodeLike[] }) | undefined>,
  layersSuffix: string | undefined,
  nodeById: Map<string, EmitNodeSource> | null | undefined,
  pathCtx: PathEmitContext | undefined,
): { el: MinimalElement; flat: MinimalElement[] } {
  const cprops: Record<string, unknown> = {}
  const styles: string[] = []
  if (def.content !== undefined) cprops['text'] = String(def.content)
  if (layersSuffix !== undefined) cprops['prop:stress:layers'] = layersSuffix
  const css = rootProto?.css ?? def.css ?? {}
  for (const [k, v] of Object.entries(css)) {
    if (k === 'cssDef') {
      styles.push(...cssDefRules(v))
      continue
    }
    cprops[`css:${k}`] = v
  }
  const flat: MinimalElement[] = []
  const children: MinimalElement[] = []
  const childSpecs = def.children ?? []
  for (let i = 0; i < childSpecs.length; i += 1) {
    // DEFECT #20 — the def-fill prune: a destroyed adopted def child skips
    // (its subtree never recurses either)
    if (defChildPruned(childProtos[i])) continue
    const child = emitDefChildTree(childSpecs[i]!, i, rootWire, childProtos[i], undefined, nodeById, pathCtx)
    flat.push(...child.flat)
    children.push(child.el)
  }
  const el: MinimalElement = { wire: rootWire, type: def.type, props: cprops, childOrder: children.map((c) => c.wire) }
  if (styles.length > 0) el.styles = styles
  flat.unshift(el)
  return { el, flat }
}

/** D7/D8 — recursive def-fills-host emission: build the element for one def
 *  child and its full nested subtree (the deliverable children ride the
 *  def's own spec tree). `proto` is the pre-minted `'component'`-token
 *  prototype node for this def child when available (the seam registry zip):
 *  its real css/props enrich the element, its family children zip with the
 *  nested specs, and its anchors resolve NESTED seam consumers (a def child
 *  carrying `component: {target, reference}` — the live-prod auth-div inside
 *  the nav-bar). The wire is synthetic (`<host>:<bind>` for bind-specs,
 *  `<host>:<i>` for deliverable specs) — the prototypes' ids never surface
 *  in the element set (the seam links the REAL nodes; emission renders the
 *  def's data). */
function emitDefChildTree(
  spec: DefChildSpec,
  index: number,
  parentWire: string,
  proto: (NodeLike & { anchors?: Anchor[]; children?: NodeLike[]; layers?: Array<{ sourceName?: string }>; content?: unknown; type?: string }) | undefined,
  layersSuffix: string | undefined,
  nodeById: Map<string, EmitNodeSource> | null | undefined,
  pathCtx: PathEmitContext | undefined,
): { el: MinimalElement; flat: MinimalElement[] } {
  const bind = (spec as { bind?: unknown }).bind
  const wire = typeof bind === 'string' ? `${parentWire}:${bind}` : `${parentWire}:${index}`
  const cprops: Record<string, unknown> = {}
  const styles: string[] = []
  // AUTH-SEAM (2026-08-16) — the mutated proto pass1 (state-slice content
  // replace) wins over the def spec data when the def carries the copied
  // phase-handler layer (seam-handlers-def / seam-handlers — sourceName
  // 'handler-seam'): the nested phase handler converted the authored def
  // child (button → sign-in link), and the CONVERTED element must render.
  const authSeamed = proto !== undefined && (proto.layers?.some((l) => l.sourceName === 'handler-seam') ?? false)
  let type = (authSeamed && typeof proto?.type === 'string') ? proto.type : spec.type
  if ((proto?.content !== undefined && authSeamed) || spec.content !== undefined) cprops['text'] = String(authSeamed ? proto?.content ?? spec.content : spec.content)
  if (layersSuffix !== undefined) cprops['prop:stress:layers'] = layersSuffix
  for (const [k, v] of Object.entries(proto?.css ?? spec.css ?? {})) cprops[`css:${k}`] = v
  for (const [k, v] of Object.entries(proto?.props ?? spec.props ?? {})) cprops[`prop:${k}`] = v
  const flat: MinimalElement[] = []
  const children: MinimalElement[] = []
  const childSpecs = spec.children ?? []
  const childProtos = proto ? (proto.children ?? []) : []
  for (let i = 0; i < childSpecs.length; i += 1) {
    // DEFECT #20 — the def-fill prune: a destroyed adopted def child skips
    // (its subtree never recurses either)
    if (defChildPruned(childProtos[i])) continue
    const child = emitDefChildTree(childSpecs[i]!, i, wire, childProtos[i], undefined, nodeById, pathCtx)
    flat.push(...child.flat)
    children.push(child.el)
  }
  // a nested SEAM consumer (a def child carrying component: {target, ...}
  // with no authored children): resolve its def off the prototype node's
  // target anchor link and deliver per the delivery-shape ruling (SED-1..3):
  // `'content'` = TEXT only (F13/ALS-7); `'type'` = SHELL COLLAPSE (the
  // element takes the nested def's type + css incl. cssDef rules + children);
  // `'children'` = the nested DEF-ROOT element becomes this element's child
  // (the element keeps its own shell).
  if (childSpecs.length === 0 && proto && Array.isArray(proto.anchors)) {
    const seamTarget = proto.anchors.find(
      (a) => (a.role === 'target' || a.role === 'duplex') && typeof a.target === 'string' && a.options.seam !== undefined,
    )
    if (seamTarget) {
      const value = seamTarget.link.anchorsOf('source').find((p) => p.value !== undefined)?.value
        ?? seamTarget.link.anchorsOf('duplex').find((p) => p.value !== undefined)?.value
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        const nested = value as { type?: string; content?: unknown; children?: unknown; css?: Record<string, unknown> }
        if (seamTarget.options.seam === 'content') {
          if (nested.content !== undefined) cprops['text'] = String(nested.content)
        } else if (seamTarget.options.seam === 'type') {
          // SED-1 — the element collapses into the nested def's element
          const nestedRoot = defRootPrototypeFor(seamTarget.link)
          const css = nestedRoot?.css ?? nested.css ?? {}
          for (const [k, v] of Object.entries(css)) {
            if (k === 'cssDef') styles.push(...cssDefRules(v))
            else cprops[`css:${k}`] = v
          }
          if (typeof nested.type === 'string') type = nested.type
          if (nested.content !== undefined) cprops['text'] = String(nested.content)
          if (Array.isArray(nested.children) && nested.children.length > 0) {
            const nestedProtos = defPrototypesFor(seamTarget.link)
            for (let i = 0; i < nested.children.length; i += 1) {
              // DEFECT #20 — the def-fill prune (nested branch)
              if (defChildPruned(nestedProtos[i])) continue
              const child = emitDefChildTree(nested.children[i] as DefChildSpec, i, wire, nestedProtos[i], undefined, nodeById, pathCtx)
              flat.push(...child.flat)
              children.push(child.el)
            }
          }
        } else {
          // SED-2 — the nested DEF-ROOT element becomes this element's
          // child (B1: the shell NEVER collapses and KEEPS its own authored
          // text — the def-root joins as an ADDITIONAL child). The shell
          // element goes through the SHARED finalizer (makeSeamShellEl,
          // also used by the top-level branch) — DEFECT #4 deleted the
          // shell's text here while the top-level branch preserved it.
          const nestedRoot = defRootPrototypeFor(seamTarget.link)
          const nestedProtos = defPrototypesFor(seamTarget.link)
          const rootTree = emitDefRootElement(
            nested as LinkDefSpec & { content?: unknown; css?: Record<string, unknown>; children?: Array<DefChildSpec> },
            `${wire}:0`,
            nestedRoot,
            nestedProtos,
            undefined,
            nodeById,
            pathCtx,
          )
          flat.push(...rootTree.flat)
          const shellEl = makeSeamShellEl(wire, type, cprops, spec.content, [rootTree.el.wire], styles, undefined)
          flat.unshift(shellEl)
          return { el: shellEl, flat }
        }
      }
    }
  }
  const el: MinimalElement = { wire, type, props: cprops, childOrder: children.map((c) => c.wire) }
  if (styles.length > 0) el.styles = styles
  flat.unshift(el)
  return { el, flat }
}

/** EMPTY-OWNER (user rule 2026-08-14) — append `display: none` to the style
 *  of an empty placement-owner container UNLESS an authored display
 *  declaration exists (author intent wins). */
function hideEmptyContainer(props: Record<string, unknown>): void {
  const style = String(props['css:style'] ?? '')
  if (/display\s*:/.test(style)) return
  props['css:style'] = style ? `${style}; display: none;` : 'display: none;'
}

/** The minimal node surface the def-tree emission reads (the live harness
 *  passes the real Node objects; unit states may pass nothing). */
type NodeLike = { css?: Record<string, unknown>; props?: Record<string, unknown>; children?: Array<{ id: string }> }

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
  const styles: string[] = []
  for (const [k, v] of Object.entries(s.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(s.css ?? {})) {
    // R6 — css.cssDef is never a `css:cssDef` set prop (D4): the rules ride
    // the element's `styles` field for the sweep coalescer (STL-1)
    if (k === 'cssDef') {
      styles.push(...cssDefRules(v))
      continue
    }
    props[`css:${k}`] = v
  }

  // component-link layer: a resolved def object supplies the consumer's
  // children (prototype-as-child: the def links the children, deciding their
  // element type + ancestry suffix). The consumer keeps its OWN type unless it
  // is a pure link consumer (no scalar binding) — a node that is ALSO a values
  // child keeps its authored type so the diff never re-creates it (type
  // changes would replace the element and break element identity). D8/DFC-1..3:
  // the chain is scoped to the allowed gate (linkChainAllowed); a BLOCKED def
  // (seam-target, count mismatch, non-zero offset) never re-types the host or
  // invents def children — the real children keep their own wires, types and
  // order (blocked defChildren carry the child's OWN type when knowable, else
  // the host's authored type — never the def's re-type spec). SED-1..3 (the
  // delivery-shape ruling): a seam `children`-target keeps its OWN shell with
  // the DEF-ROOT element as its child; a seam `type`-target collapses into
  // the def's element (def type + css); a seam `content`-target delivers text
  // only (the def branch never fires — SED-3).
    const defEntry = findDefBinding(s)
    const def = defEntry?.def
    const seam = defEntry?.seam
    if (def && armIdx === undefined && seam !== 'content') {
      const parentLayers = s.props?.['stress:layers'] ?? ''
      const offset = def.childOffset ?? 0
      const childWires = s.children ?? []
      const allowed = linkChainAllowed(s, def, defEntry!.name)
      if (seam === 'children' || (allowed && childWires.length === 0)) {
        const layersSuffix =
          def.childLayersSuffix && parentLayers ? `${parentLayers}|${def.childLayersSuffix}` : undefined
        const seamTarget = (s.anchors ?? []).find(
          (a) => (a.role === 'target' || a.role === 'duplex') && typeof a.target === 'string' && a.target === defEntry!.name,
        )
        const protos = seamTarget ? defPrototypesFor(seamTarget.link) : []
        const defRootProto = seamTarget ? defRootPrototypeFor(seamTarget.link) : undefined
        if (seam === 'children') {
          // SED-2 — SHELL + DEF-ROOT CHILD (B1 clarification 2026-08-14):
          // the consumer NEVER collapses — it keeps its OWN element, its OWN
          // authored text and its OWN authored children UNTOUCHED; the
          // anchor layer's DEF-ROOT element (def type + css incl. cssDef
          // rules) joins as an ADDITIONAL child. `div(shell text) >
          // [p(authored), nav.nav-bar > logo]` — the component rule for a
          // children-target: original node data as-is, prototype node added.
          // The shell element goes through the SHARED finalizer
          // (makeSeamShellEl — also used by the nested branch) so the
          // always-performed operations cannot drift (DEFECT #4).
          const rootWire = `${wire}:0`
          const rootTree = emitDefRootElement(def, rootWire, defRootProto, protos, layersSuffix, nodeById, pathCtx)
          const el = makeSeamShellEl(wire, s.type, props, s.content, [...childWires, rootWire], styles, s.forkKey)
          return { el, defChildren: rootTree.flat }
        }
      if (seam === 'type') {
        // SED-1 — SHELL COLLAPSE: the consumer element IS the def's element
        // (def type + css incl. cssDef rules); the def's children emit as its
        // seam-wired children; NO separate def-root element renders.
        const defCss = defRootProto?.css ?? (def as { css?: Record<string, unknown> }).css
        if (defCss) {
          for (const [k, v] of Object.entries(defCss)) {
            if (k === 'cssDef') styles.push(...cssDefRules(v))
            else props[`css:${k}`] = v
          }
        }
        // DEFECT #20 — the SED-1 def-fill prune: a destroyed adopted def
        // child's element never surfaces (flatMap skips the pair)
        const trees = (def.children ?? []).flatMap((spec, i) =>
          defChildPruned(protos[i]) ? [] : [emitDefChildTree(spec, i, wire, protos[i], layersSuffix, nodeById, pathCtx)])
        const bound = scalarBinding(s.bindings)
        if (bound !== undefined) props['text'] = bound
        const el: MinimalElement = { wire, type: def.type, props, childOrder: trees.map((t) => t.el.wire) }
        if (styles.length > 0) el.styles = styles
        if (s.forkKey !== undefined) el.forkKey = s.forkKey
        return { el, defChildren: trees.flatMap((t) => t.flat) }
      }
      // non-seam empty-host def-fill (P-EMIT-3, the fork-stress leaf clones):
      // the def's children — recursed through the def's spec tree (deliverable
      // children) or the bind-specs — become the host's emitted children. The
      // pre-minted prototypes (the seam registry, in def-children order)
      // enrich the elements with the real css/props and resolve NESTED seam
      // consumers. Wires are synthetic — never the prototypes' ids.
      // DEFECT #20 — the P-EMIT-3 def-fill prune (same rule).
      const trees = def.children.flatMap((spec, i) =>
        defChildPruned(protos[i]) ? [] : [emitDefChildTree(spec, i, wire, protos[i], layersSuffix, nodeById, pathCtx)])
      const bound = scalarBinding(s.bindings)
      if (bound !== undefined) props['text'] = bound
      const type = bound !== undefined ? s.type : def.type
      const el: MinimalElement = { wire, type, props, childOrder: trees.map((t) => t.el.wire) }
      if (styles.length > 0) el.styles = styles
      if (s.forkKey !== undefined) el.forkKey = s.forkKey
      return { el, defChildren: trees.flatMap((t) => t.flat) }
    }
    const reTyped: MinimalElement[] = []
    // D8/DFC-1..3 — a BLOCKED def still lets every REAL child join the set as
    // its own element (no drops, no re-typing, no synthetic wires): the real
    // children carry their OWN type when knowable (else the host's authored
    // type) and their own css/props — never the def's re-type spec.
    const specs: Array<{ bind: string; type: string; content?: unknown; css?: Record<string, unknown>; props?: Record<string, unknown> }> =
      allowed
        ? def.children
        : childWires.map((_, i) => ({ bind: String(i), type: s.type }))
    // DEFECT #20 (2026-08-16) — the blocked-def/nodeById path: a DESTROYED
    // adopted def child must not synthesize an element (its node data is
    // still in nodeById — the destroyed flag is the signal; its own states
    // already dropped: not actionable). The wire also leaves the consumer's
    // childOrder (filtered below) so diffMinimal never looks for a ghost.
    const destroyedWires = new Set<string>()
    for (let i = 0; i < specs.length; i += 1) {
      const spec = specs[i]!
      const cw = childWires[offset + i]
      // DFC-1/F22 — no synthetic `${wire}:${bind}` wires EXCEPT where the
      // allowed chain fills a CHILDLESS host (the def provides children — the
      // path-emit P-EMIT-3 pin) and the legacy non-link def chain; a BLOCKED
      // def never synthesizes (def children beyond the real children are
      // simply not emitted — no id-less orphans, no dropped wires).
      const resolvedWire = cw ?? (allowed ? `${wire}:${spec.bind}` : undefined)
      if (resolvedWire === undefined) continue
      const cprops: Record<string, unknown> = {}
      if (allowed) cprops['text'] = String(spec.content ?? '')
      if (def.childLayersSuffix && parentLayers) cprops['prop:stress:layers'] = `${parentLayers}|${def.childLayersSuffix}`
      // a REAL child (covered by the def, standalone emission skipped) keeps
      // its OWN authored css/props — the def's css/props are a fallback only
      // for synthetic children with no graph node behind them. It ALSO keeps
      // its OWN children: a real child may itself have a child subtree (the
      // next layer), which the emitted element must adopt so diffMinimal
      // nests them (the "boxes must nest" contract). For a path-state child
      // the wire is its pathKey — the node id comes from the emit context.
      const childNodeId = pathCtx?.pathNodeOf.get(resolvedWire) ?? resolvedWire
      const childNode = nodeById?.get(childNodeId) as unknown as { type?: string; css?: Record<string, unknown>; props?: Record<string, unknown>; children?: Array<{ id: string }>; destroyed?: boolean } | undefined
      if (childNode?.destroyed === true) {
        destroyedWires.add(resolvedWire)
        continue
      }
      for (const [k, v] of Object.entries(childNode?.css ?? spec.css ?? {})) cprops[`css:${k}`] = v
      for (const [k, v] of Object.entries(childNode?.props ?? spec.props ?? {})) cprops[`prop:${k}`] = v
      const childOrder = pathCtx?.pathStateChildren.get(resolvedWire)
        ?? (childNode ? (childNode.children ?? []).map((c) => c.id) : [])
      // D8 — a blocked def never re-types: the covered real child keeps its
      // OWN type (when knowable) — never the def spec's re-type target
      const type = allowed ? spec.type : (childNode?.type as string | undefined) ?? s.type
      reTyped.push({ wire: resolvedWire, type, props: cprops, childOrder })
    }
    if (allowed) {
      // the def decides the consumer's type + child order (1:1 re-typing)
      const order = [...childWires.slice(0, offset).filter((w) => !destroyedWires.has(w)), ...reTyped.map((c) => c.wire)]
      const bound = scalarBinding(s.bindings)
      if (bound !== undefined) props['text'] = bound
      const type = bound !== undefined ? s.type : def.type
      const el: MinimalElement = { wire, type, props, childOrder: order }
      if (styles.length > 0) el.styles = styles
      if (s.forkKey !== undefined) el.forkKey = s.forkKey
      return { el, defChildren: reTyped }
    }
    // DFC-1..3 — blocked: the host emits its OWN type + authored children in
    // their own order; no drops, no re-typing, no synthetic wires. The real
    // children (no standalone state in this set) join as their own elements.
    const bound = scalarBinding(s.bindings)
    const content = bound !== undefined ? bound : s.content
    if (content !== undefined) props['text'] = content
    if (
      (s.anchors ?? []).some((a) => a.role === 'container')
      && (s.children ?? []).length === 0
      && content === undefined
      && (s.css?.style === undefined || s.css.style === '')
    ) {
      hideEmptyContainer(props)
    }
    const el: MinimalElement = { wire, type: s.type, props, childOrder: [...childWires].filter((w) => !destroyedWires.has(w)) }
    if (styles.length > 0) el.styles = styles
    if (s.forkKey !== undefined) el.forkKey = s.forkKey
    return { el, defChildren: reTyped }
  }

  const bound = scalarBinding(s.bindings)
  const content = bound !== undefined ? bound : s.content
  if (content !== undefined) props['text'] = content
  // EMPTY-OWNER (user rules 2026-08-14) — a placement-owner container with
  // NO children at render time emits `display: none` UNLESS it carries
  // renderable information of its own: an authored TEXT content or an
  // authored inline `css.style` (an empty drop-zone must not clutter the
  // page — the modal overlay / empty sidebar case — but a container that
  // renders something — the path-fork/fork-stress tree leaves with their
  // levelCss styling and badge pseudo-elements — is content, not chrome).
  // An AUTHORED display declaration also wins (author intent overrides
  // emptiness). Applies to the container's own element wherever it emits
  // (plain, blocked-def and fork arms — a container with a def is non-empty
  // by construction).
  const emptyOwnerHide =
    (s.anchors ?? []).some((a) => a.role === 'container')
    && (s.children ?? []).length === 0
    && s.content === undefined
    && (s.css?.style === undefined || s.css.style === '')
  if (emptyOwnerHide) hideEmptyContainer(props)
  if (armIdx === undefined) {
    const node = nodeById?.get(s.nodeId)
    const handlers = node ? (node.handlers ?? []) : []
    for (const h of handlers) {
      if (h && typeof h === 'object' && typeof h.event === 'string') props[`on:${h.event}`] = true
    }
    const el: MinimalElement = { wire, type: s.type, props, childOrder: [...(s.children ?? [])] }
    if (styles.length > 0) el.styles = styles
    if (s.forkKey !== undefined) el.forkKey = s.forkKey
    return { el }
  }
  // fork arms are leaves in this page (no children on the themed divs)
  const el: MinimalElement = { wire, type: s.type, props, childOrder: [] }
  if (styles.length > 0) el.styles = styles
  if (s.forkKey !== undefined) el.forkKey = s.forkKey
  return { el }
}
