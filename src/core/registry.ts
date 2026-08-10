// src/core/registry.ts — process-wide node registry + the post-op sweep
// (cascade-destroy + coalesced pass-2). Owns the module-level sets so the
// Node class stays free of global-state bookkeeping.
//
// Imports Node only as a TYPE (erased at runtime), so there is no import
// cycle with node.ts.
import type { Node } from './node.js'
import type { NodeId } from './types.js'

export const registered = new Set<Node>()
const pendingDestroy: Node[] = []
let sweepScheduled = false

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
