/**
 * Shared render helpers for the demos — mirror the e2e helpers
 * (minimalFromState / applyOps / treeFromOps) against the browser build.
 */
export function minimalFromState(cs) {
  const props = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) props[`css:${k}`] = v
  if (cs.content !== undefined) props['text'] = cs.content
  return { wire: cs.nodeId, type: cs.type, props, childOrder: [...cs.children] }
}

export function applyOps(adapter, ops) {
  const els = new Map()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        els.set(op.wire, adapter.createEl(op.type, op.wire))
        break
      case 'set':
        adapter.setProp(op.wire, op.name, op.value)
        break
      case 'append': {
        const owner = els.get(op.owner)
        const child = els.get(op.child)
        if (owner && child) adapter.appendChild(owner, child)
        break
      }
      case 'remove': {
        const w = els.get(op.wire)
        if (w && adapter.removeEl) adapter.removeEl(op.wire)
        els.delete(op.wire)
        break
      }
      case 'styles':
        break
    }
  }
}

/** Structural tree read back from an op stream (adapter-neutral, PAR-5). */
export function treeFromOps(ops) {
  const byWire = new Map()
  const edges = []
  const propVals = new Map()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        byWire.set(op.wire, { wire: op.wire, type: op.type, props: {}, children: [] })
        break
      case 'set':
        propVals.set(op.wire, { ...(propVals.get(op.wire) ?? {}), [op.name]: op.value })
        break
      case 'append':
        edges.push({ owner: op.owner, child: op.child })
        break
      default:
        break
    }
  }
  for (const [wire, tree] of byWire) tree.props = propVals.get(wire) ?? {}
  for (const e of edges) byWire.get(e.owner)?.children.push(byWire.get(e.child))
  return [...byWire.values()]
}

/** Wire equality of two render trees — structural parity ignoring op order (PAR-5). */
export function treeSig(trees) {
  return JSON.stringify(
    trees.map((n) => ({
      type: n.type,
      props: n.props,
      children: treeSig(n.children),
    })),
  )
}

export function jsonClone(v) {
  return JSON.parse(JSON.stringify(v))
}
