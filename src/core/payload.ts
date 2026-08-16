// src/core/payload.ts — content-payload lifecycle: drop, refresh, append.
//
// Payloads group nodes received from one backend payload (main article,
// comments, …): they can be dropped (detached → cascade-destroyed),
// refreshed (replaced by a new set), or appended to (websocket comments)
// without touching other payloads or user-created edits.
import type { Node } from './node.js'
import { registerContentNode, unregisterContentNode } from './registry.js'
import { Link } from './link.js'
import { detachNodeSafe } from './ops.js'

export interface Payload {
  id: string
  roots: Node[]
  metadata?: unknown
  userData?: unknown
}

function familyLinkFor(parent: Node): Link {
  const existing = parent.anchors.find((a) => a.role === 'parent')
  if (existing) return existing.link as unknown as Link
  const link = new Link({ name: 'parent-child' })
  parent.addAnchor('parent', parent, {}, link)
  return link
}

/** Detach one node from its parent edge; the sweep cascade-destroys it
 *  unless it is re-attached before the sweep drains. Only THIS node's child
 *  anchor is removed — siblings on the shared family link are untouched. */
// DEFECT #12 — the safe per-node detach now lives in ops.ts (detachNodeSafe),
// shared with the ops executors + supervisor paths; see the ops.ts comment.

function attachNode(parent: Node, child: Node, priority: number): void {
  const link = familyLinkFor(parent)
  child.addAnchor('child', child, { priority }, link)
}

/** Detach every payload root from its parent and DROP it from the payload.
 *  Roots are first unregistered as content (the payload no longer owns them),
 *  so even PLACED content is destroyed by the sweep — the root and
 *  content/component arrays are the sources of truth for graph access. */
export function dropPayload(payload: Payload): void {
  for (const root of [...payload.roots]) {
    unregisterContentNode(root)
    detachNodeSafe(root)
  }
  payload.roots = []
}

/** Replace a payload's roots: old roots are dropped (unregistered + detached);
 *  new roots attach under `parent` (priorities continue after existing
 *  children), are registered as payload-owned content, and become the
 *  payload's roots. Same-tick re-attach blocks destruction of any overlap. */
export function refreshPayload(payload: Payload, newRoots: Node[], parent: Node): void {
  for (const root of [...payload.roots]) {
    unregisterContentNode(root)
    detachNodeSafe(root)
  }
  let priority = nextPriority(parent)
  for (const node of newRoots) {
    registerContentNode(node)
    if (!node.childAnchor()) attachNode(parent, node, priority)
    priority += 1
  }
  payload.roots = [...newRoots]
}

/** Attach new nodes to an existing payload under `parent` (websocket append);
 *  appended nodes become payload-owned content. */
export function appendToPayload(payload: Payload, nodes: Node[], parent: Node): void {
  let priority = nextPriority(parent)
  for (const node of nodes) {
    registerContentNode(node)
    if (!node.childAnchor()) attachNode(parent, node, priority)
    priority += 1
  }
  payload.roots.push(...nodes)
}

/** Next free priority on a parent's family link. */
export function nextPriority(parent: Node): number {
  const existing = parent.anchors.find((a) => a.role === 'parent')
  if (!existing) return 0
  const link = existing.link as unknown as Link
  const max = link.anchorsOf('child').reduce((m, a) => Math.max(m, a.options.priority ?? 0), -1)
  return max + 1
}
