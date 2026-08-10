import type { LayerMutationList, LinkConfigNameHub, MutationOp, NodeId, StateSliceOp } from './types.js'
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
    const existingParent = parentAnchor && typeof parentAnchor.target === 'object'
      ? parentAnchor.target
      : null
    if (existingParent !== to) {
      throw new SingleParentError(node.id)
    }
    return to.id
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