/**
 * Shared test fixtures — built against the public contract in docs/specs/contract.md.
 * Consumes ONLY the exported surface of src/core (via ../src/core/*.js). The
 * implementation does not exist yet (TDD red state); these construct trees through
 * nothing but the public API so every test file uses one canonical builder set.
 */
import { Node, findCycle } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { SingleParentError, CycleError } from '../../src/core/errors.js'
import type { Anchor, LinkConfigNameHub, NodeBaseData, Role } from '../../src/core/types.js'

/** A hub that hands out one shared Link per (kind, name) — same-name anchors share a link. */
export function hub(): LinkConfigNameHub {
  const m = new Map<string, Link>()
  return {
    linkFor(name: string, kind: 'component' | 'placement'): Link {
      const key = `${kind}:${name}`
      let l = m.get(key)
      if (!l) {
        l = new Link({ name: kind })
        m.set(key, l)
      }
      return l
    },
  }
}

function familyLinkTo(node: Node, target: 'rootNode' | 'component'): Link {
  const link = new Link({ name: 'parent-child' })
  node.addAnchor('child', node, { priority: 0 }, link)
  const parentAnchor: Anchor = { role: 'parent', target, options: {}, link }
  link.addAnchor(parentAnchor)
  return link
}

/** Permanent-owner root: chain → 'rootNode' ⇒ in-tree (S1.1). */
export function makeRoot(data: NodeBaseData = { type: 'div' }, overrideId?: string): Node {
  const root = new Node(data, hub(), overrideId)
  familyLinkTo(root, 'rootNode')
  return root
}

/** Component prototype: chain → 'component' ⇒ prototype (prototype-term fork arms). */
export function makePrototype(data: NodeBaseData = { type: 'section' }, overrideId?: string): Node {
  const p = new Node(data, hub(), overrideId)
  familyLinkTo(p, 'component')
  return p
}

/** Unattached (no parent-link) ⇒ unplaced (S1.1). */
export function makeNode(data: NodeBaseData = { type: 'div' }, overrideId?: string): Node {
  return new Node(data, hub(), overrideId)
}

/** Attach `child` under `parent` on the parent's family Link (S-R3.13 path).
 *  If `child` already has a child anchor, throws SingleParentError.
 *  Detects and throws `CycleError` when the attach would form a cycle.
 */
export function childOf(parent: Node, child: Node, priority?: number): Node {
  if (child.childAnchor()) throw new SingleParentError(child.id)
  if (findCycle(child, parent)) throw new CycleError(child.id)
  let link = parent.anchors.find(a => a.role === 'parent')?.link as unknown as Link | undefined
  if (!link) {
    link = new Link({ name: 'parent-child' })
    parent.addAnchor('parent', parent, {}, link) // S-R3.13: parent side created on first child
  }
  const options: { priority?: number } = {}
  if (priority !== undefined) options.priority = priority
  child.addAnchor('child', child, options, link)
  return child
}

export function anchorsOf(node: Node, role: Role): Anchor[] {
  return node.anchors.filter(a => a.role === role)
}

/** Component source/duplex anchor on a shared per-name link (api.md §4.1).
 *  The `component-source-duplicate` guard (placement-path-spec §10.ab/ae)
 *  rejects a second same-name provider anchor on one node with a warn; the
 *  fixture treats that as a test-authoring error (the anti-pattern — never
 *  construct it), since no re-expressed fixture does. */
export function addComponentSource(
  owner: Node,
  name: string,
  value: unknown,
  role: 'source' | 'duplex' = 'source',
): Anchor {
  const link = new Link({ name: 'component' })
  const anchor = owner.addAnchor(role, name, {}, link)
  if (anchor === null) {
    throw new Error(`component-source-duplicate: ${owner.id} already carries ${role} "${name}"`)
  }
  anchor.value = value
  return anchor
}

/** Component target anchor on a shared per-name link. */
export function targetAnchor(owner: Node, name: string): Anchor {
  const link = new Link({ name: 'component' })
  const a = owner.addAnchor('target', name, {}, link)
  if (a === null) throw new Error(`component-source-duplicate: ${owner.id} already carries target "${name}"`)
  return a
}

export { familyLinkTo as familyLink }
