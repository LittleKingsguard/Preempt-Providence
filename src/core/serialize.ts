// src/core/serialize.ts — JSON round-trip: serializeNode, serializeSlice,
// SerializedAnchor, RenderNodeState, loadState, reResolve (contract.md §src/core/serialize.ts).
// node → JSON → parse → recompile must round-trip equal render-relevant state (SER-R1).
// Anchors serialize as typed refs — never live objects (notes §10.6, D4).
import type { Node } from './node.js'
import type { AnchorTarget, DerivedDecl, NodeBaseData, NodeRef, Role } from './types.js'
import { validateDerived } from './derived.js'

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
}

export type SerializedRenderDoc = {
  template: unknown
  content: unknown[]
  clientConfig: { adapter: string; persistence: boolean }
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
    children: node.children.map((child) => child.id),
    anchors: node.anchors.map((a) => {
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
  return {
    template: serializeNode(node),
    content: kids.map(serializeNode),
    clientConfig: clientConfig ?? { adapter: 'dom', persistence: false },
  }
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
  assertNoLiveTargets(template)
  // the template's derived rule is validated at the same schema boundary as
  // every content entry (derived-state.md §7)
  validateDerived((template as { derived?: unknown }).derived)
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