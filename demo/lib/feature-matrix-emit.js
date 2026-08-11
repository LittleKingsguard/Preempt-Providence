/**
 * Feature-matrix emission layer — maps compiled states to renderable
 * MinimalElements, shared by the server builder (scripts/build-demo.mjs) and
 * the browser page (demo/feature-matrix.js) so PAR-5 parity compares identical
 * emission.
 *
 * Conventions:
 *  - A node with ONE compiled state renders as its own wire.
 *  - A FORK (N > 1 states for one node) renders one element per arm, wired
 *    `<nodeId>#<i>` (the demo's emission convention — fork arms are never
 *    coerced into one element; see the components demo).
 *  - Fork-arm adoption (FRK-H2): a forked node NEVER emits an element for its
 *    base id `node-X` — only the `<nodeId>#<i>` arms, all leaves. So when a
 *    parent's `childOrder` references a forked node id, the emitter MUST
 *    expand that reference into the arm wires IN ARM ORDER (see `armWires`
 *    below). If the base id were left in `childOrder`, diffMinimal would look
 *    for a wire `node-X` that no element creates and silently attach no arm —
 *    this was the real cause of the original "fork arms not rendered" bug.
 *  - The parent adopts ALL arms as direct children (no per-fork wrapper
 *    element). Adopting exactly ONE arm via a `#<i>`-specific reference is
 *    NOT supported by this emit layer.
 *  - Content comes from the 'theme' fork binding when present, else the node's
 *    own `content`.
 *  - Event handlers surface as `on:<event>` props (the adapter binds them).
 */
export function emitElements(actionable, nodeById) {
  const groups = new Map()
  for (const s of actionable) {
    const arr = groups.get(s.nodeId)
    if (arr) arr.push(s)
    else groups.set(s.nodeId, [s])
  }
  const els = []
  // fork arms are wired `<nodeId>#<i>`; a parent referencing a forked node id
  // must adopt the arm wires so `diffMinimal` can attach them (FRK-H2).
  const armWires = new Map()
  for (const [nodeId, states] of groups) {
    if (states.length > 1) armWires.set(nodeId, states.map((_, i) => `${nodeId}#${i}`))
  }
  for (const [, states] of groups) {
    const multi = states.length > 1
    const base = states[0]
    const el = emitOne(base, multi ? 0 : undefined, nodeById)
    if (multi) {
      el.childOrder = []
      // one element per arm; the first arm carries the full el, the rest are leaf dupes
      els.push(el)
      for (let i = 1; i < states.length; i += 1) els.push(emitOne(states[i], i, nodeById))
    } else {
      // remap any forked child references to their arm wires in arm order
      el.childOrder = el.childOrder.flatMap((c) => armWires.get(c) ?? [c])
      els.push(el)
    }
  }
  return els
}

function emitOne(s, armIdx, nodeById) {
  const wire = armIdx !== undefined ? `${s.nodeId}#${armIdx}` : s.nodeId
  const props = {}
  for (const [k, v] of Object.entries(s.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(s.css ?? {})) props[`css:${k}`] = v
  const theme = s.bindings?.['theme']
  const content = theme !== undefined ? theme : s.content
  if (content !== undefined) props['text'] = content
  if (armIdx === undefined) {
    const node = nodeById?.get(s.nodeId)
    const handlers = node ? (node.handlers ?? []) : []
    for (const h of handlers) {
      if (h && typeof h === 'object' && typeof h.event === 'string') props[`on:${h.event}`] = true
    }
    return { wire, type: s.type, props, childOrder: [...s.children] }
  }
  // fork arms are leaves in this page (no children on the themed divs)
  return { wire, type: s.type, props, childOrder: [] }
}
