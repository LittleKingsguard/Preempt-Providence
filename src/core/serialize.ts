// src/core/serialize.ts — JSON round-trip: serializeNode, serializeSlice,
// SerializedAnchor, RenderNodeState, loadState, reResolve (contract.md §src/core/serialize.ts).
// node → JSON → parse → recompile must round-trip equal render-relevant state (SER-R1).
// Anchors serialize as typed refs — never live objects (notes §10.6, D4).
import type { Node } from './node.js'
import type { AnchorTarget, DerivedDecl, LinkConfigNameHub, NodeBaseData, NodeRef, Role } from './types.js'
import { validateDerived } from './derived.js'
import { defPrototypeEntries, defRootPrototypeEntries, defNameForLink, registerDefPrototypes, registerDefRootPrototype, scopeOf, DEFAULT_SCOPE } from './registry.js'
import type { GraphScope } from './registry.js'

export type SerializedAnchor = {
  role: Role
  target: NodeRef | 'rootNode' | 'component' | 'contentNodes' | string
  options: { priority?: number; order?: number }
  link: string
  value?: unknown
  parent?: string
}

export interface RenderNodeState {
  id: NodeRef
  state: 'in-tree'
  type: string
  props: Record<string, unknown>
  css: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }
  content?: unknown
  children: NodeRef[]
  anchors: SerializedAnchor[]
  forkKey?: string
  /** the derived RULE (never the baked values) — re-derivation needs the
   *  rule in the data, not the value (derived-state.md §2/§8, SER-R1). */
  derived?: DerivedDecl
  /** HOOKS (hooks-map-review.md §7.2 pin 4) — the authored `hooks` field
   *  (the NAMES only; the VALUE rides the anchors' `value` — the mirror
   *  keeps ONE source, SER-R1). */
  hooks?: string[]
  /** HOOKS-ARRAY (§9.4 item 1) — the kind discriminator record ships
   *  alongside the names; loadState re-validates the closed union at the
   *  schema boundary (SER-R1). */
  hooksKind?: Record<string, string>
  /** HOOKS-ARRAY (OPTION C — §9.2 pin 5) — the batch PAYLOAD records keyed
   *  by hook name. Rows are DATA (ship once); the minted nodes are DERIVED.
   *  NOTE (2026-08-24 adversarial pass, S4a): there is NO origin-layer
   *  filter in serializeNode — minted rows ship if the CALLER includes them
   *  in the slice; the §3 recipe's slice (authored nodes only) is what keeps
   *  rows-are-data true. A post-mint full-node-list slice + re-mint DOUBLES
   *  the rows (open defect, defects.md ADVERSARIAL-S4). loadState re-seeds
   *  them so a re-mint can reproduce the batch. */
  batches?: Record<string, unknown>
}

export type SerializedRenderDoc = {
  template: unknown
  content: unknown[]
  clientConfig: { adapter: string; persistence: boolean }
  /** Feature 1a (handoffs-review-5.md — the CENSUS): the def-prototype
   *  registry, as a name + instance-id census. The prototype STATE rides
   *  `content` (status quo — prototypes already ship there); this section
   *  carries the ONE datum content cannot (the registration NAME — recovered
   *  from the registry Link's anchors at serialize; a name-less link is
   *  skipped). Entries ship ONLY for instances present in the serialized
   *  slice (instance-membership reachability — never another graph's
   *  prototypes). `isRoot` per entry (a node can be root of one name and
   *  child of another — nested defs). */
  defPrototypes?: { name: string; nodeId: string; isRoot: boolean }[]
}

function targetKey(target: AnchorTarget): SerializedAnchor['target'] {
  if (typeof target === 'string') return target
  const id = (target as Node).id
  if (typeof id !== 'string') throw new Error('serialization-error: live anchor target')
  return id
}

function assertJsonSafe(value: unknown, seen?: WeakSet<object>): void {
  if (value === null || value === undefined) return
  const type = typeof value
  if (type === 'string' || type === 'number' || type === 'boolean') return
  if (type === 'function' || type === 'symbol' || type === 'bigint') {
    throw new Error('serialization-error: non-JSON value')
  }
  const visited = seen ?? new WeakSet<object>()
  if (visited.has(value as object)) throw new Error('serialization-error: circular reference')
  visited.add(value as object)
  if (Array.isArray(value)) {
    for (const item of value) assertJsonSafe(item, visited)
    return
  }
  for (const key of Object.keys(value)) assertJsonSafe((value as Record<string, unknown>)[key], visited)
}

function cssState(css: Record<string, unknown>): RenderNodeState['css'] {
  const out: RenderNodeState['css'] = {}
  if (typeof css.id === 'string') out.id = css.id
  if (Array.isArray(css.classes) && css.classes.every((c) => typeof c === 'string')) out.classes = css.classes as string[]
  if (typeof css.style === 'string') out.style = css.style
  if (css.cssDef !== undefined) out.cssDef = css.cssDef
  return out
}

export function serializeNode(node: Node): RenderNodeState {
  const props = node.props
  const content = node.content
  assertJsonSafe(props)
  assertJsonSafe(content)
  // the derived RULE ships in the data; the baked KEYS never ship as values
  // (the rule replaces them — a stale authored value must not round-trip)
  const shipped: Record<string, unknown> = { ...props }
  const derivedKeys = Object.keys(node.derived?.props ?? {})
  for (const k of derivedKeys) delete shipped[k]
  const state: RenderNodeState = {
    id: node.id,
    state: 'in-tree',
    type: node.type,
    props: shipped,
    css: cssState(node.css),
    // ADVERSARIAL-S4 — the children REFS never include derived (minted)
    // nodes either: the serialized doc is self-consistent (no dangling
    // refs to excluded row states).
    children: node.children.filter((c) => c.originLayer === undefined && !c.runtimeMinted).map((child) => child.id),
    anchors: node.anchors.map((a) => {
      // ADVERSARIAL-S16 — anchor values ride the JSON-safety boundary (a
      // function-valued anchor would silently drop on stringify otherwise)
      if (a.value !== undefined) assertJsonSafe(a.value)
      let parent: string | undefined
      // encode the parent side of a child anchor so the family edge round-trips,
      // while keeping the anchor's own target self-referencing (S3.1)
      if (a.role === 'child' && typeof a.target === 'object' && a.target !== null && (a.target as Node).id === node.id) {
        const parentAnchor = a.link.anchorsOf('parent')[0]
        if (parentAnchor) {
          if (typeof parentAnchor.target === 'string') {
            parent = parentAnchor.target
          } else if (typeof parentAnchor.target === 'object' && parentAnchor.target !== null) {
            parent = (parentAnchor.target as Node).id
          }
        }
      }
      return {
        role: a.role,
        target: targetKey(a.target),
        options: { ...a.options },
        link: a.link.id,
        value: a.value,
        ...(parent !== undefined ? { parent } : {}),
      }
    }),
  }
  if (content !== undefined) state.content = content
  if (node.derived !== undefined) state.derived = node.derived
  if (node.base.hooks !== undefined && node.base.hooks.length > 0) state.hooks = [...node.base.hooks]
  if (node.base.hooksKind !== undefined && Object.keys(node.base.hooksKind).length > 0) state.hooksKind = { ...node.base.hooksKind }
  if (node.batches && Object.keys(node.batches).length > 0) {
    // ADVERSARIAL-S16 — the batch RECORD (the rows payload) rides the
    // JSON-safety boundary: a function/circular row is a serialization-error,
    // never silent data loss on stringify.
    assertJsonSafe(node.batches)
    state.batches = { ...node.batches }
  }
  // deterministic anchor order for stable round-trips
  state.anchors.sort((x, y) => {
    const roleOrder: Record<string, number> = { child: 0, parent: 1, source: 2, duplex: 3, target: 4, container: 5, content: 6, component: 7 }
    const r = (roleOrder[x.role] ?? 9) - (roleOrder[y.role] ?? 9)
    if (r !== 0) return r
    // content anchors keep their MINT order — the targetPlacement preference
    // order (P3 §1.1/§6.2): never sort two content anchors by target string.
    // (Array.prototype.sort is stable, so returning 0 preserves insertion order.)
    if (x.role === 'content' && y.role === 'content') return 0
    const tx = typeof x.target === 'string' ? x.target : (x.target as { id: string }).id
    const ty = typeof y.target === 'string' ? y.target : (y.target as { id: string }).id
    return tx < ty ? -1 : tx > ty ? 1 : 0
  })
  return state
}

export function serializeSlice(node: Node, kids: Node[], clientConfig?: { adapter: string; persistence: boolean }): SerializedRenderDoc {
  // ADVERSARIAL-S4 (2026-08-24) — the pin-4 serialize-exclude: minted nodes
  // (originLayer / runtimeMinted) are DERIVED state, never authored — they
  // are excluded here regardless of what the CALLER passes (a post-mint full
  // node list no longer ships the rows; the round-trip re-mint per the
  // batches record reproduces them exactly, never doubling). The batch
  // RECORD (rows-as-data) still ships on its owner.
  const isDerived = (n: Node): boolean => n.originLayer !== undefined || n.runtimeMinted
  const contentKids = kids.filter((k) => !isDerived(k))
  const content = contentKids.map(serializeNode)
  // Feature 1a — the CENSUS emit + the C2 strip:
  // - iterate the registry (roots first — a def-root precedes its def-children
  //   per name; children in registry mint order), skip name-less links
  //   (ruling 1), ship ONLY instances present in THIS slice (R3' —
  //   instance-membership; graph B's prototypes are never in graph A's slice).
  // - the C2 strip: seam child anchors ({role:'child', options.seam}) on
  //   prototype-state content entries are dropped (the seed's one-child limit
  //   would drop them anyway; the strip removes the dangling parent refs).
  const sliceSet = new Set<Node>([node, ...contentKids])
  const census: { name: string; nodeId: string; isRoot: boolean }[] = []
  const prototypeInstances = new Set<Node>()
  // MULTI-GRAPH — the census enumerates the node's OWN scope (D3/D8).
  const myScope = scopeOf(node)
  for (const [link, root] of defRootPrototypeEntries(myScope)) {
    const name = defNameForLink(link)
    if (name === undefined) continue
    if (!sliceSet.has(root)) continue
    census.push({ name, nodeId: root.id, isRoot: true })
    prototypeInstances.add(root)
  }
  for (const [link, protos] of defPrototypeEntries(myScope)) {
    const name = defNameForLink(link)
    if (name === undefined) continue
    for (const p of protos) {
      if (!sliceSet.has(p)) continue
      census.push({ name, nodeId: p.id, isRoot: false })
      prototypeInstances.add(p)
    }
  }
  if (census.length > 0) {
    for (let i = 0; i < content.length; i += 1) {
      const kid = contentKids[i]!
      if (!prototypeInstances.has(kid)) continue
      const state = content[i]!
      state.anchors = state.anchors.filter((a) => !(a.role === 'child' && (a.options as { seam?: boolean } | undefined)?.seam))
    }
  }
  const doc: SerializedRenderDoc = {
    template: serializeNode(node),
    content,
    clientConfig: clientConfig ?? { adapter: 'dom', persistence: false },
  }
  if (census.length > 0) doc.defPrototypes = census
  return doc
}

interface SeededNode {
  id: string
  type?: string
  props?: Record<string, unknown>
  css?: Record<string, unknown>
  children?: string[]
  content?: unknown
  anchors?: SerializedAnchor[]
  forkKey?: string
  derived?: DerivedDecl
  hooks?: string[]
  hooksKind?: Record<string, string>
  batches?: Record<string, unknown>
}

function assertNoLiveTargets(v: unknown): void {
  if (typeof v !== 'object' || v === null) return
  const anchors = (v as Record<string, unknown>).anchors
  if (!Array.isArray(anchors)) return
  for (const a of anchors) {
    if (typeof a !== 'object' || a === null) throw new Error('schema-boundary: malformed anchor')
    const target = (a as Record<string, unknown>).target
    if (typeof target !== 'string') throw new Error('schema-boundary: live anchor target')
  }
}

function parseNodeState(v: unknown): SeededNode {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('NodeSchema-shape-mismatch')
  const o = v as Record<string, unknown>
  if (typeof o.id !== 'string') throw new Error('NodeSchema-shape-mismatch')
  assertNoLiveTargets(o)
  const seed: SeededNode = { id: o.id }
  if (typeof o.type === 'string') seed.type = o.type
  if (o.props !== undefined) {
    if (typeof o.props !== 'object' || o.props === null || Array.isArray(o.props)) throw new Error('NodeSchema-shape-mismatch')
    seed.props = o.props as Record<string, unknown>
  }
  if (o.css !== undefined) {
    if (typeof o.css !== 'object' || o.css === null || Array.isArray(o.css)) throw new Error('NodeSchema-shape-mismatch')
    seed.css = o.css as Record<string, unknown>
  }
  if (o.children !== undefined) {
    if (!Array.isArray(o.children)) throw new Error('NodeSchema-shape-mismatch')
    for (const c of o.children) if (typeof c !== 'string') throw new Error('NodeSchema-shape-mismatch')
    seed.children = o.children as string[]
  }
  if (o.content !== undefined) seed.content = o.content
  if (o.anchors !== undefined) {
    if (!Array.isArray(o.anchors)) throw new Error('NodeSchema-shape-mismatch')
    seed.anchors = o.anchors as SerializedAnchor[]
  }
  if (typeof o.forkKey === 'string') seed.forkKey = o.forkKey
  if (o.derived !== undefined) {
    // schema-boundary guard (derived-state.md §7): a malformed serialized
    // `derived` never reaches a compile pass
    validateDerived(o.derived)
    seed.derived = o.derived as DerivedDecl
  }
  if (o.hooks !== undefined) {
    // HOOKS §7.2 pin 4 — the field rides the schema boundary: a malformed
    // serialized `hooks` (non-array / non-string member) is rejected like
    // any other malformed schema member (SER-R1)
    if (!Array.isArray(o.hooks) || o.hooks.some((h) => typeof h !== 'string')) {
      throw new Error('NodeSchema-shape-mismatch')
    }
    seed.hooks = o.hooks as string[]
  }
  if (o.hooksKind !== undefined) {
    // HOOKS-ARRAY §9.4 item 1 — the kind record rides the schema boundary
    // (SER-R1): a non-object value, a non-string key, or a kind outside the
    // closed union (value/component/placement) is rejected here.
    if (typeof o.hooksKind !== 'object' || o.hooksKind === null || Array.isArray(o.hooksKind) || Object.keys(o.hooksKind).length === 0) {
      throw new Error('NodeSchema-shape-mismatch')
    }
    for (const [name, kind] of Object.entries(o.hooksKind)) {
      if (name.length === 0 || typeof kind !== 'string' || (kind !== 'value' && kind !== 'component' && kind !== 'placement')) {
        throw new Error('NodeSchema-shape-mismatch')
      }
    }
    seed.hooksKind = o.hooksKind as Record<string, string>
  }
  if (o.batches !== undefined) {
    // HOOKS-ARRAY (OPTION C) — the batch record rides the schema boundary
    // (SER-R1): a non-object value is rejected; the record shape is
    // re-validated (prototypeName string, rows array, layerId string,
    // mintKind in the closed union).
    if (typeof o.batches !== 'object' || o.batches === null || Array.isArray(o.batches) || Object.keys(o.batches).length === 0) {
      throw new Error('NodeSchema-shape-mismatch')
    }
    for (const [name, rec] of Object.entries(o.batches)) {
      if (name.length === 0 || typeof rec !== 'object' || rec === null) throw new Error('NodeSchema-shape-mismatch')
      const r = rec as Record<string, unknown>
      if (typeof r.prototypeName !== 'string' || !Array.isArray(r.rows) || typeof r.layerId !== 'string') {
        throw new Error('NodeSchema-shape-mismatch')
      }
      if (r.mintKind !== undefined && r.mintKind !== 'component' && r.mintKind !== 'placement') {
        throw new Error('NodeSchema-shape-mismatch')
      }
      if (r.placementName !== undefined && typeof r.placementName !== 'string') {
        throw new Error('NodeSchema-shape-mismatch')
      }
      // Feature 1b (D13) — the record's optional `keyField` (when present) must
      // be a non-empty string; the executor only ever writes a valid string,
      // so a non-string/empty keyField in a doc is a crafted/malformed record
      // → NodeSchema-shape-mismatch (SER-R1).
      if (r.keyField !== undefined && (typeof r.keyField !== 'string' || r.keyField.length === 0)) {
        throw new Error('NodeSchema-shape-mismatch')
      }
      // ADVERSARIAL-S3e (2026-08-24) — row MEMBERS ride the schema boundary:
      // a crafted doc's `rows` with non-object members would crash the host's
      // re-mint otherwise (rows-mint now rejects them contained too — this is
      // the boundary defense-in-depth).
      for (const row of r.rows) {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('NodeSchema-shape-mismatch')
      }
    }
    seed.batches = o.batches as Record<string, unknown>
  }
  return seed
}

function validateClientConfig(doc: SerializedRenderDoc): void {
  const cfg = doc.clientConfig
  if (typeof cfg !== 'object' || cfg === null) throw new Error('clientConfig-excess')
  const keys = Object.keys(cfg)
  if (keys.length !== 2) throw new Error('clientConfig-excess')
  if (typeof cfg.adapter !== 'string') throw new Error('clientConfig-excess')
  if (typeof cfg.persistence !== 'boolean') throw new Error('clientConfig-excess')
}

export function loadState(doc: SerializedRenderDoc): NodeBaseData[] {
  if (typeof doc !== 'object' || doc === null) throw new Error('envelope-mismatch')
  const template = (doc as { template?: unknown }).template
  if (typeof template !== 'object' || template === null || Array.isArray(template)) throw new Error('envelope-mismatch')
  if (!Array.isArray(doc.content)) throw new Error('envelope-mismatch')
  validateClientConfig(doc)
  // Feature 1a — the defPrototypes census rides the schema boundary (SER-R1):
  // a non-array section is an envelope mismatch; a malformed entry (name/
  // nodeId non-string, isRoot non-boolean), a duplicate entry id, a duplicate
  // name, or a nodeId absent from the doc is a NodeSchema-shape-mismatch.
  const census = (doc as { defPrototypes?: unknown }).defPrototypes
  if (census !== undefined) {
    if (!Array.isArray(census)) throw new Error('envelope-mismatch')
    const ids = new Set<string>()
    const rootNames = new Set<string>()
    const docIds = new Set<string>([(template as { id?: string }).id ?? '', ...(doc.content as { id?: string }[]).map((c) => c.id ?? '')])
    for (const entry of census) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) throw new Error('NodeSchema-shape-mismatch')
      const e = entry as Record<string, unknown>
      if (typeof e.name !== 'string' || e.name.length === 0) throw new Error('NodeSchema-shape-mismatch')
      if (typeof e.nodeId !== 'string' || e.nodeId.length === 0) throw new Error('NodeSchema-shape-mismatch')
      if (typeof e.isRoot !== 'boolean') throw new Error('NodeSchema-shape-mismatch')
      // an instance ships ONCE (duplicate entry ids reject). Duplicate NAMES
      // are LEGAL — a def-root and its def-children share the registration
      // name by construction (census entries are keyed by nodeId, not name).
      if (ids.has(e.nodeId)) throw new Error('NodeSchema-shape-mismatch')
      if (!docIds.has(e.nodeId)) throw new Error('NodeSchema-shape-mismatch')
      if (e.isRoot) {
        // ADVERSARIAL-S6a: TWO ROOTS of ONE name are a crafted doc (the
        // re-registration would silently last-wins) — rejected here.
        if (rootNames.has(e.name)) throw new Error('NodeSchema-shape-mismatch')
        rootNames.add(e.name)
      }
      ids.add(e.nodeId)
    }
    // NOTE (2026-08-24 adversarial pass, S6b DISPOSITION): a def-child
    // entry whose name has NO root entry is LEGAL — translate mints
    // def-ROOTS only for css-carrying defs (translate.ts mintDefPrototypes:
    // the root prototype is the element-level carrier of the def's css), so
    // a css-less multi-child def ships a children-only census by
    // construction. Children-only registration is the intended shape for
    // such defs (rows-mint resolves protos[0] from the children registry).
  }
  assertNoLiveTargets(template)
  // the template's derived rule is validated at the same schema boundary as
  // every content entry (derived-state.md §7)
  validateDerived((template as { derived?: unknown }).derived)
  // HOOKS-ARRAY §9.4 item 1 (SER-R1) — the template's kind record is
  // validated at the same boundary: a malformed `hooksKind` (non-object,
  // empty, or a kind outside the closed union) is rejected like any other
  // malformed schema member.
  const templateHooksKind = (template as { hooksKind?: unknown }).hooksKind
  if (templateHooksKind !== undefined) {
    if (typeof templateHooksKind !== 'object' || templateHooksKind === null || Array.isArray(templateHooksKind) || Object.keys(templateHooksKind).length === 0) {
      throw new Error('NodeSchema-shape-mismatch')
    }
    for (const [name, kind] of Object.entries(templateHooksKind)) {
      if (name.length === 0 || typeof kind !== 'string' || (kind !== 'value' && kind !== 'component' && kind !== 'placement')) {
        throw new Error('NodeSchema-shape-mismatch')
      }
    }
  }
  // HOOKS-ARRAY (OPTION C, SER-R1) — the template's batch records are
  // validated at the same boundary (shape + the closed mintKind union).
  const templateBatches = (template as { batches?: unknown }).batches
  if (templateBatches !== undefined) {
    if (typeof templateBatches !== 'object' || templateBatches === null || Array.isArray(templateBatches) || Object.keys(templateBatches).length === 0) {
      throw new Error('NodeSchema-shape-mismatch')
    }
    for (const rec of Object.values(templateBatches)) {
      if (typeof rec !== 'object' || rec === null) throw new Error('NodeSchema-shape-mismatch')
      const r = rec as Record<string, unknown>
      if (typeof r.prototypeName !== 'string' || !Array.isArray(r.rows) || typeof r.layerId !== 'string') {
        throw new Error('NodeSchema-shape-mismatch')
      }
      if (r.mintKind !== undefined && r.mintKind !== 'component' && r.mintKind !== 'placement') {
        throw new Error('NodeSchema-shape-mismatch')
      }
      // Feature 1b (D13) — the template record's optional keyField (string)
      if (r.keyField !== undefined && (typeof r.keyField !== 'string' || r.keyField.length === 0)) {
        throw new Error('NodeSchema-shape-mismatch')
      }
      // ADVERSARIAL-S3e — row-member validation at the template boundary too
      for (const row of r.rows) {
        if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new Error('NodeSchema-shape-mismatch')
      }
    }
  }
  const groups = new Map<string, Array<{ seed: SeededNode; idx: number }>>()
  const seeds: SeededNode[] = []
  for (const item of doc.content) {
    const seed = parseNodeState(item)
    const idx = seeds.push(seed) - 1
    if (seed.forkKey !== undefined) {
      let group = groups.get(seed.forkKey)
      if (!group) {
        group = []
        groups.set(seed.forkKey, group)
      }
      group.push({ seed, idx })
    }
  }
  const drop = new Set<number>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const first = group[0]!
    const sig = JSON.stringify(first.seed)
    for (let i = 1; i < group.length; i += 1) {
      const entry = group[i]!
      if (JSON.stringify(entry.seed) !== sig) throw new Error('fork-key-collision')
      drop.add(entry.idx)
    }
  }
  const out: SeededNode[] = []
  seeds.forEach((s, i) => {
    if (!drop.has(i)) out.push(s)
  })
  return out as unknown as NodeBaseData[]
}

export const reResolve = loadState

/** Feature 1a (handoffs-review-5.md §S1/C4 — the recipe helper): RE-REGISTER
 *  the already-seeded def-prototype instances under the host hub's component
 *  Links, per the doc's census. Zero construction — the single-instance rule
 *  is structural (the seeded nodes ARE the instances; no second copies).
 *  Called AFTER seeding (template first) + `reconcileParentTargets` (the
 *  family edges populate defRoot.children). Validates every entry's post-seed
 *  state === 'prototype' (a def-child seeded before its def-root derives
 *  'unplaced' — sweep-vulnerable; a violation is a crafted/ill-ordered doc →
 *  NodeSchema-shape-mismatch). Never touches rows (the host drives the
 *  post-restore rows-mint per batches record itself). */
export function reRegisterDefPrototypes(doc: SerializedRenderDoc, hub: LinkConfigNameHub, nodes: Node[], scope: GraphScope = DEFAULT_SCOPE): void {
  const census = doc.defPrototypes
  if (census === undefined || census.length === 0) return
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const roots = new Map<string, Node>()
  const children = new Map<string, Node[]>()
  for (const entry of census) {
    const node = byId.get(entry.nodeId)
    if (node === undefined) throw new Error('NodeSchema-shape-mismatch')
    if (entry.isRoot) {
      roots.set(entry.name, node)
    } else {
      let list = children.get(entry.name)
      if (!list) {
        list = []
        children.set(entry.name, list)
      }
      list.push(node)
    }
  }
  for (const [name, root] of roots) {
    registerDefRootPrototype(hub.linkFor(name, 'component'), root, scope)
  }
  for (const [name, protos] of children) {
    registerDefPrototypes(hub.linkFor(name, 'component'), protos, scope)
  }
  for (const entry of census) {
    const node = byId.get(entry.nodeId)!
    // the post-seed state tripwire: token-terminated → 'prototype'; an
    // ill-ordered doc leaves a def-child 'unplaced' (sweep-vulnerable).
    if (node.state !== 'prototype') throw new Error('NodeSchema-shape-mismatch')
  }
}