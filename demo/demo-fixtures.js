/**
 * Demo fixtures — the browser twin of tests/helpers/fixtures.ts, importing
 * the browser build (dist/core) so the demos exercise the exact same graph
 * API as the e2e suites.
 */
import { Node, findCycle } from '../dist/core/node.js'
import { Link } from '../dist/core/link.js'
import { SingleParentError, CycleError } from '../dist/core/errors.js'

export function hub() {
  const m = new Map()
  return {
    linkFor(name, kind) {
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

function familyLinkTo(node, target) {
  const link = new Link({ name: 'parent-child' })
  node.addAnchor('child', node, { priority: 0 }, link)
  const parentAnchor = { role: 'parent', target, options: {}, link }
  link.addAnchor(parentAnchor)
  return link
}

export function makeRoot(data = { type: 'div' }, overrideId) {
  const root = new Node(data, hub(), overrideId)
  familyLinkTo(root, 'rootNode')
  return root
}

export function makePrototype(data = { type: 'section' }, overrideId) {
  const p = new Node(data, hub(), overrideId)
  familyLinkTo(p, 'component')
  return p
}

export function makeNode(data = { type: 'div' }, overrideId) {
  return new Node(data, hub(), overrideId)
}

export function childOf(parent, child, priority) {
  if (child.childAnchor()) throw new SingleParentError(child.id)
  if (findCycle(child, parent)) throw new CycleError(child.id)
  let link = parent.anchors.find((a) => a.role === 'parent')?.link
  if (!link) {
    link = new Link({ name: 'parent-child' })
    parent.addAnchor('parent', parent, {}, link)
  }
  const options = {}
  if (priority !== undefined) options.priority = priority
  child.addAnchor('child', child, options, link)
  return child
}

export function anchorsOf(node, role) {
  return node.anchors.filter((a) => a.role === role)
}

export function addComponentSource(owner, name, value, role = 'source') {
  const link = new Link({ name: 'component' })
  const anchor = owner.addAnchor(role, name, {}, link)
  if (anchor === null) {
    // the component-source-duplicate guard fired — the second same-name
    // provider anchor is skipped (warn + keep-first); callers see null
    return anchor
  }
  anchor.value = value
  return anchor
}

export function targetAnchor(owner, name) {
  const link = new Link({ name: 'component' })
  return owner.addAnchor('target', name, {}, link)
}
