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
