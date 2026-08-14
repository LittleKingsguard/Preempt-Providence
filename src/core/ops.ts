import type { LayerMutationList, LinkConfigNameHub, MutationOp, NodeId, PlacementAttachOp, PlacementTrigger, StateSliceOp } from './types.js'
import { SingleParentError, CycleError, ApplyError } from './errors.js'
import { Node, findCycle } from './node.js'
import { Link } from './link.js'

export interface OpContext {
  hub: LinkConfigNameHub
  nodes: Map<NodeId, Node>
}

function toNode(value: unknown): Node {
  return value as unknown as Node
}

function toLink(a: { link: unknown }): Link {
  return a.link as unknown as Link
}

export function applyStateSlice(node: Node, mutation: LayerMutationList): void {
  for (const m of mutation) {
    // placement/children targeting is hard-blocked at the state-slice boundary (FS-10)
    if ((m.targetProp as string).startsWith('placement') || (m.targetProp as string) === 'children') {
      throw new ApplyError('placement-target-blocked', m)
    }
  }
  node.applySlice(mutation)
}

function attach(node: Node, to: Node, priority: number | undefined): NodeId {
  const existing = node.anchors.find(a => a.role === 'child')
  if (existing) {
    const link = toLink(existing)
    const parentAnchor = link.anchorsOf('parent')[0]
    // the contentNodes permanent-owner token (translate-minted, P3 §10.ad/
    // F-13) is a placeholder family edge — a real parent edge supersedes it
    // ("attach adds a placement path to an already-in-tree content root");
    // destroy() bypasses the parent-child link's min-1 child count
    if (parentAnchor && parentAnchor.target === 'contentNodes') {
      link.destroy()
    } else {
      const existingParent = parentAnchor && typeof parentAnchor.target === 'object'
        ? parentAnchor.target
        : null
      if (existingParent !== to) {
        throw new SingleParentError(node.id)
      }
      return to.id
    }
  }
  const link = to.familyLinkFor()
  if (!link) {
    throw new SingleParentError(node.id)
  }
  const options: { priority?: number } = {}
  if (priority !== undefined) {
    options.priority = priority
  } else {
    const siblings = link.anchorsOf('child')
    const max = siblings.reduce((m, a) => Math.max(m, a.options.priority ?? 0), -1)
    options.priority = max + 1
  }
  node.addAnchor('child', node, options, link)
  return to.id
}

function detach(node: Node): NodeId {
  const childAnchor = node.anchors.find(a => a.role === 'child')
  if (!childAnchor) return node.id
  const link = toLink(childAnchor)
  const parentCount = link.anchorsOf('parent').length
  if (parentCount <= 1) {
    link.destroy()
  } else {
    node.removeAnchor(childAnchor)
  }
  return node.id
}

export interface PlacementAttachResult {
  containerAnchorMinted: boolean
  attachZone: string
}

/** P3 §1.3 — the ancestor-name veto: legacy nulls out a `placementName` when
 *  an ancestor already offers the same name (the anti-loop guard). Runtime
 *  minting applies the same veto against the ATTACH TARGET's (the container
 *  node's) ancestor chain: an ancestor offering the zone → the container
 *  anchor is NOT minted (warn `placement-name-vetoed`, warn+skip, never a
 *  throw). Content anchors (the consumer side) are never vetoed. */
function ancestorServesZone(node: Node, zone: string): boolean {
  for (let cur: Node | null = node.parent; cur; cur = cur.parent) {
    if (cur.anchors.some(a => a.role === 'container' && typeof a.target === 'string' && a.target === zone)) return true
  }
  return false
}

/** P3 §3.3/§9-Q2 — the placement-attach executor: mints the node's `content`
 *  anchor(s) per the requested container names (preference order, dedup
 *  keep-first — re-attach is idempotent) and mints/ensures the `container`
 *  anchor on the target container node for the attach zone (names[0]), under
 *  the §1.3 ancestor-name veto. Both roles land on the SHARED per-name
 *  placement Link (the zone registry). */
export function placementAttach(node: Node, container: Node, names: string[], hub: LinkConfigNameHub): PlacementAttachResult {
  const attachZone = names[0]
  if (typeof attachZone !== 'string' || attachZone.length === 0) {
    throw new ApplyError('placement-target-blocked', { detail: 'placement-attach requires at least one requested container name' })
  }
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) continue
    if (node.anchors.some(a => a.role === 'content' && a.target === name)) continue
    node.addAnchor('content', name, {}, hub.linkFor(name, 'placement'))
  }
  let containerAnchorMinted = false
  const existing = container.anchors.find(a => a.role === 'container' && a.target === attachZone)
  if (!existing) {
    if (ancestorServesZone(container, attachZone)) {
      console.warn(`[placement-attach] placement-name-vetoed: an ancestor of ${container.id} already offers zone "${attachZone}"; container anchor skipped (P3 §1.3)`)
    } else {
      container.addAnchor('container', attachZone, {}, hub.linkFor(attachZone, 'placement'))
      containerAnchorMinted = true
    }
  }
  return { containerAnchorMinted, attachZone }
}

/** P3 §1.2/10.ac.2 #7 — the trigger-identity derivation: a freshly minted
 *  container anchor is a `container-added`; an ensured (already-present)
 *  container with only new content anchors is a `content-added`. (`container-
 *  removed` arrives with removal ops in later units — the direction union
 *  already admits it.) */
export function derivePlacementTrigger(linkName: string, containerAnchorMinted: boolean): PlacementTrigger {
  return { kind: 'placement', linkName, direction: containerAnchorMinted ? 'container-added' : 'content-added' }
}

export function execute(op: MutationOp, ctx: OpContext): { doorways: NodeId[] } {
  switch (op.kind) {
    case 'attach': {
      const node = toNode(op.node)
      const to = toNode(op.to)
      if (findCycle(node, to)) throw new CycleError(node.id)
      attach(node, to, op.priority)
      return { doorways: [op.to.id] }
    }
    case 'detach': {
      detach(toNode(op.node))
      return { doorways: [op.node.id] }
    }
    case 'move': {
      const node = toNode(op.node)
      if (findCycle(node, toNode(op.to.parent))) {
        throw new CycleError(node.id)
      }
      detach(node)
      attach(node, toNode(op.to.parent), op.to.priority)
      return { doorways: [node.id] }
    }
    case 'destroy': {
      toNode(op.node).destroy()
      return { doorways: [op.node.id] }
    }
    case 'placement-attach': {
      const pa = op as PlacementAttachOp
      const node = toNode(pa.node)
      const container = toNode(pa.container)
      placementAttach(node, container, pa.names, ctx.hub)
      return { doorways: [container.id, node.id] }
    }
    case 'clone-instance': {
      const source = toNode(op.source)
      const copy = source.clone('actor')
      attach(copy, source.parent ?? source, op.priority)
      return { doorways: [copy.id] }
    }
    case 'state-slice': {
      const s = op as StateSliceOp
      applyStateSlice(toNode(s.node), s.mutation)
      return { doorways: [s.node.id] }
    }
  }
}