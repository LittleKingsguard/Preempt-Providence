/**
 * Fork-stress fixture — the serializable part of the layered stress-test
 * tree. Layers cycle through the four runtime child-creation mechanisms:
 *   L1 placement  → L2 component values → L3 component link → L4 handler
 *   L5..L8 repeat with different placement/component names (built at runtime
 *   by demo/fork-stress.js — handler bodies are not serializable).
 *
 * This fixture builds root + L1 (placement into a zone) + L2 (component
 * providing values for 2 authored children) + L3 (component linking a
 * prototype as 2 children). The page module drives the remaining layers.
 *
 * Every node carries props['stress:layers'] — the chain of layer mechanisms
 * from the root to it ("L1:placement|L2:values-1|…"), rendered as a label so
 * each node documents its depth and tree back to root.
 */
import { Node, mintNodeId } from '../dist/core/node.js'
import { hub, makeRoot, makeNode, childOf, addComponentSource, targetAnchor } from './demo-fixtures.js'

/** The four mechanisms, in cycle order (index 0 = layer 1). */
export const LAYER_METHODS = ['placement', 'values', 'link', 'handler']

/** Layer name per depth (1-based): method + cycle instance. */
export function layerName(level) {
  const method = LAYER_METHODS[(level - 1) % 4]
  const cycle = Math.floor((level - 1) / 4) + 1
  return `${method}-${cycle}`
}

/** Placement zone names per placement cycle instance (L1 → stress-1, L5 → stress-5). */
export function placementName(cycle) {
  return `stress-${cycle * 4 - 3}`
}

/** Component reference name per values/link cycle instance (L2 → values-1, L6 → values-2, …). */
export function componentName(method, cycle) {
  return `${method}-${cycle}`
}

/** The two source values for a values layer (L2/L6). */
export function valuePair(cycle) {
  return {
    a: `value-A-${cycle}`,
    b: `value-B-${cycle}`,
  }
}

/** The two-child prototype definition for a link layer (L3/L7). The def
 *  declares two children; the EMITTER re-types the consumer's children
 *  starting at childOffset (the link layer's pair — appended after the
 *  values layer's pair) and carries the ancestry suffix. */
export function linkDef(cycle) {
  const suffix = `L${cycle * 4 - 1}:link-${cycle}`
  return {
    type: 'div',
    label: `component: link-${cycle} — prototype linked as children`,
    childLayersSuffix: suffix,
    childOffset: 0, // the consumer's children ARE the link pair
    children: [
      { bind: 'a', type: 'div', content: `link-${cycle}.a` },
      { bind: 'b', type: 'div', content: `link-${cycle}.b` },
    ],
  }
}

/** The handler marker: a child node created by a handler layer carries
 *  props['stress:handler'] === the layer name, and the handler only runs
 *  when no such child exists (idempotency — the default guard against
 *  after-assembly loops). */
export const HANDLER_MARKER = 'stress:handler'

function attachChild(parent, child, priority) {
  childOf(parent, child, priority)
}

/**
 * Build root + the serializable layers (L1..min(3, depth)).
 * depth d has layers 1..d-1 (layer k has 2^k nodes); total incl. root = 2^d − 1.
 * Layers 4+ are driven at runtime by demo/fork-stress.js.
 */
export function buildForkStressBase(depth = 8) {
  const h = hub()
  const root = makeRoot({ type: 'app', props: { id: 'stress-root' } }, 'fs-root')
  const nodes = [root]
  const byId = new Map([[root.id, root]])
  const add = (node) => {
    nodes.push(node)
    byId.set(node.id, node)
    return node
  }

  const lastLayer = Math.min(3, depth - 1)
  const layerCount = (k) => 2 ** k

  // ---- L1: PLACEMENT — a zone filled with 2 placed content nodes ----------
  const zone = add(makeNode({ type: 'section', props: { id: 'stress-zone' } }, 'fs-zone'))
  childOf(root, zone, 0)
  // placement anchor on the zone (the placement target 'stress-1')
  zone.addAnchor('placement', placementName(1), {}, h.linkFor(placementName(1), 'placement'))

  const l1 = []
  for (let i = 0; i < layerCount(1); i += 1) {
    const n = add(makeNode({ type: 'div', props: { id: `l1-${i}`, 'stress:layers': 'L1:placement' } }, `fs-l1-${i}`))
    attachChild(zone, n, i)
    // the placed node's own placement anchor back to the zone name
    n.addAnchor('placement', placementName(1), {}, h.linkFor(placementName(1), 'placement'))
    l1.push(n)
  }
  const layers = { 1: l1 }

  if (lastLayer >= 2) {
    // ---- L2: COMPONENT VALUES — each L1 node consumes 'values-1'; 2 authored
    // children whose text comes from the resolved bindings ------------------
    const pair = valuePair(1)
    addComponentSource(root, 'values-1.a', pair.a)
    addComponentSource(root, 'values-1.b', pair.b)
    const l2 = []
    for (const parent of l1) {
      for (const [k, wireName] of [['a', 'values-1.a'], ['b', 'values-1.b']]) {
        const child = add(makeNode({
          type: 'span',
          props: { id: `${parent.props.id}-v-${k}`, 'stress:layers': 'L1:placement|L2:values-1' },
        }, `fs-${parent.id}-v-${k}`))
        attachChild(parent, child, k === 'a' ? 0 : 1)
        targetAnchor(child, wireName)
        l2.push(child)
      }
    }
    layers[2] = l2
  }

  if (lastLayer >= 3) {
    // ---- L3: COMPONENT LINK — each L2 node consumes 'link-1'; the prototype
    // def is linked as a child-driver: it re-types the consumer's NEXT 2 real
    // children (the link pair appended after the values pair) ---------------
    const def = linkDef(1)
    addComponentSource(root, 'link-1', def)
    const l3 = []
    for (const parent of layers[2]) {
      targetAnchor(parent, 'link-1')
      for (const [k, tag] of [['a', 'div'], ['b', 'div']]) {
        const child = add(makeNode({
          type: tag,
          props: { id: `${parent.props.id}-l-${k}`, 'stress:layers': 'L1:placement|L2:values-1|L3:link-1' },
        }, `fs-${parent.id}-l-${k}`))
        attachChild(parent, child, 2 + (k === 'a' ? 0 : 1))
        l3.push(child)
      }
    }
    layers[3] = l3
  }

  return {
    h,
    root,
    zone,
    nodes,
    byId,
    layers,
    // reusable builder bits for the runtime layers
    makeNode,
    childOf: attachChild,
    addComponentSource,
    targetAnchor,
    mintNodeId: () => `fs-runtime-${mintNodeId()}`,
  }
}
