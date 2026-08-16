// src/core/registry.ts — process-wide node registry + the post-op sweep
// (cascade-destroy + coalesced pass-2). Owns the module-level sets so the
// Node class stays free of global-state bookkeeping.
//
// Imports Node and Link only as TYPES (erased at runtime), so there is no
// import cycle with node.ts / link.ts.
import type { Node } from './node.js'
import type { Link } from './link.js'
import type { NodeId } from './types.js'

export const registered = new Set<Node>()

// HANDLER-SEAM (2026-08-15, D6 un-park) — the legacy handler-def registry:
// def-shaped bindings (`{reference, value: {name, body}}`) register by name at
// translate; the seam materialization resolves them when a consumer's
// `handlers.<event>` binding compiles. Lives here (not node.ts/translate.ts)
// to avoid the node↔translate cycle.
// FORMAT MARKER (decision 4, 2026-08-15) — each def records its data-format
// convention: 'legacy' (the (event, context) bodies — the seam default,
// wrapped by the bridge at materialization) or 'modern' (raw (ctx, ...args)
// bodies, installed unwrapped). The default is applied at registration.
export interface HandlerDefRecord {
  name: string
  body: string
  format: 'legacy' | 'modern'
}

const handlerDefs = new Map<string, HandlerDefRecord>()

export function registerHandlerDef(name: string, def: { name: string; body: string; format?: 'legacy' | 'modern' }): void {
  handlerDefs.set(name, { ...def, format: def.format ?? 'legacy' })
}

export function handlerDef(name: string): HandlerDefRecord | undefined {
  return handlerDefs.get(name)
}

// USERDATA passthrough (decision 6, 2026-08-15) — the legacy bridge's
// read-only `supervisor.userData` member is captured from
// `TranslatedTree.userData` (the first content payload's userData) at
// translate into this small module slot. Read at dispatch by the bridge
// context; writes are contained no-ops (no session channel exists).
let translateUserData: unknown

export function setTranslateUserData(value: unknown): void {
  translateUserData = value
}

export function getTranslateUserData(): unknown {
  return translateUserData
}

/** Shared legacy-body compiler (the translate-time `new Function` gate —
 *  admin/trusted-developer bodies only). The seam materialization compiles
 *  def bodies when it layers them onto a consumer. */
export function compileHandlerBody(src: string): (...args: unknown[]) => unknown {
  const fn = new Function(`return (${src})`)()
  if (typeof fn !== 'function') {
    throw new Error(`legacy-handler-body: "${src}" does not evaluate to a function`)
  }
  return fn
}
const pendingDestroy: Node[] = []
let sweepScheduled = false

// Origin tracking: content/component nodes owned by payload arrays are the
// source of truth for graph accessibility (besides the root + template).
// They PERSIST in the background while unplaced (placement may return);
// handler-created nodes (no basis in root/payload arrays) are discarded once
// they lose root visibility.
const contentNodes = new Set<Node>()

/** D8/F16 (B2) — the def-children prototype registry: per component LINK, the
 *  pre-minted out-of-tree `'component'`-token prototype nodes minted at
 *  translate for a value-carrying def binding (mint order = def.children
 *  order). The D7 seam materialization (ops.md §2.7 ALS-1) and the emit-side
 *  seam fill read it to wire the def's children onto the seam consumer. */
const defPrototypes = new Map<Link, Node[]>()

export function registerDefPrototypes(link: Link, protos: Node[]): void {
  defPrototypes.set(link, protos)
}

export function defPrototypesFor(link: Link): Node[] {
  return defPrototypes.get(link) ?? []
}

/** D8/ALS-1b (B3) — the def-ROOT prototype registry: per component LINK, the
 *  pre-minted `'component'`-token prototype carrying the def's own root
 *  element (type + css incl. cssDef) with family child links to the
 *  def-children prototypes. The element-level carrier of the def's css —
 *  wired as the seam consumer's child for `children`-targets (SED-2) and
 *  merged into the consumer's element for `type`-targets (SED-1). */
const defRootPrototypes = new Map<Link, Node>()

export function registerDefRootPrototype(link: Link, root: Node): void {
  defRootPrototypes.set(link, root)
}

export function defRootPrototypeFor(link: Link): Node | undefined {
  return defRootPrototypes.get(link)
}

// Origin tracking (the ORIGIN-OWNER element, legacy-handler-reuse-review
// §12.4.3/4 — A1): the module-level minted-set record — minted node id →
// origin layer id. It SURVIVES creator death (a moved minted node under a
// non-origin permanent parent is promoted by the teardown, never left
// permanently reverse-excluded) and is the rollback handle (one layer id →
// its whole minted set). Per-node marker split: Node.originLayer carries the
// same id (the reverse-exclusion read).
const mintedByLayer = new Map<NodeId, string>()

export function registerMinted(nodeId: NodeId, origin: string): void {
  mintedByLayer.set(nodeId, origin)
}

export function unregisterMinted(nodeId: NodeId): void {
  mintedByLayer.delete(nodeId)
}

export function mintedByOrigin(origin: string): NodeId[] {
  const out: NodeId[] = []
  for (const [id, o] of mintedByLayer) {
    if (o === origin) out.push(id)
  }
  return out
}

export function registerContentNode(node: Node): void {
  contentNodes.add(node)
}

export function unregisterContentNode(node: Node): void {
  contentNodes.delete(node)
}

export function isContentNode(node: Node): boolean {
  return contentNodes.has(node)
}

// id -> most recently constructed node; used to resolve serialized parent refs
const byId = new Map<NodeId, Node>()

export function resolveNodeRef(id: string): Node | undefined {
  return byId.get(id)
}

/** Register a constructed node for sweep participation and id resolution. */
export function registerNode(node: Node): void {
  registered.add(node)
  byId.set(node.id, node)
}

/** Schedule a sweep run. Pass force=true to guarantee a run even if already scheduled. */
export function scheduleSweep(force = false): void {
  if (sweepScheduled && !force) return
  sweepScheduled = true
  setTimeout(() => {
    sweepScheduled = false
    runSweep()
  }, 0)
}

function runSweep(): void {
  const batch = pendingDestroy.splice(0)
  for (const node of batch) {
    if (node.destroyed) continue
    if (node.state === 'in-tree' || node.state === 'prototype') continue
    if (isContentNode(node)) continue // payload-owned content persists (placement may return)
    finalizeDestroyed(node)
  }
  // pass-2: coalesced compileRemote over the union of 'remote'-dirty nodes.
  // Topmost ancestors first, sharing one visited set so recursion covers
  // descendants and no node is compiled twice (no whole-tree recompile).
  const visited = new Set<NodeId>()
  const dirty = [...registered].filter(n => !n.destroyed && n.dirty.has('remote'))
  const depthOf = (n: Node): number => {
    let d = 0
    let cur = n.parent
    while (cur) {
      d++
      cur = cur.parent
    }
    return d
  }
  dirty.sort((x, y) => depthOf(x) - depthOf(y))
  for (const node of dirty) {
    if (visited.has(node.id)) continue
    node.compileRemote(visited)
    node.dirty.delete('remote')
  }
  for (const node of registered) {
    if (node.destroyed) continue
    if (node.dirty.has('anchor-populate')) {
      node.reconcileAnchors()
      node.dirty.delete('anchor-populate')
    }
    if (node.dirty.has('remote')) node.dirty.delete('remote')
    if (node.dirty.has('sweep-candidate')) node.dirty.delete('sweep-candidate')
  }
}

function finalizeDestroyed(node: Node): void {
  if (node.destroyed) return
  node.destroyed = true
  node.dirty.add('sweep-candidate')
  for (const kid of node.children) {
    if (kid.destroyed) continue
    if (isContentNode(kid)) continue // a payload-owned descendant survives its tree owner
    if (kid.state === 'in-tree' || kid.state === 'prototype') continue
    finalizeDestroyed(kid)
  }
}

/** Queue a node for the async cascade-destroy sweep. */
export function markPending(node: Node): void {
  if (!pendingDestroy.includes(node)) {
    pendingDestroy.push(node)
    scheduleSweep()
  }
}
