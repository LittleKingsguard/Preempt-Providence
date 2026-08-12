/**
 * Fork-stress page builder — emits one static page per depth (2, 4, 6, 8, 9, 10, 11, 12).
 * Serializes the base graph (root + L1..L3) and embeds the layer plan so the
 * browser module (demo/fork-stress.js) drives the runtime layers (L4..depth)
 * through the four mechanisms, with zero demo-side render machinery.
 */
import { diffMinimal } from '../dist/core/render.js'
import { serializeSlice } from '../dist/core/serialize.js'
import { emitElements, treeFromOps, treeSig, jsonClone } from '../dist/core/render-helpers.js'
import { buildForkStressBase, LAYER_METHODS, layerName, placementName } from '../demo/fork-stress-fixture.js'

/** Build the shipped doc + server reference for a fork-stress page. */
export function buildForkStressPage(depth) {
  if (!Number.isInteger(depth) || depth < 2) throw new Error(`unsupported fork-stress depth ${depth}`)
  const base = buildForkStressBase(depth)
  const { root, nodes } = base
  const cr = root.compile(nodes)
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const els = emitElements(cr.actionable, nodeById)
  const ops = diffMinimal(null, els)
  const doc = serializeSlice(root, nodes)
  const labels = {}
  for (const n of nodes) {
    if (typeof n.props?.id === 'string') labels[n.id] = { name: n.props.id, type: n.type }
  }
  const serverData = {
    depth,
    layerMethods: LAYER_METHODS,
    layerNames: Array.from({ length: depth - 1 }, (_, i) => layerName(i + 1)),
    placementNames: [placementName(1), placementName(2)],
    // expected tree shape: layer k has 2^k nodes; total = 2^depth - 1
    expected: {
      perLayer: Array.from({ length: depth - 1 }, (_, k) => 2 ** (k + 1)),
      total: 2 ** depth - 1,
    },
    serverTreeSig: treeSig(treeFromOps(ops)),
    nodeLabels: labels,
  }
  return { doc, serverData, base }
}

/** Stable snapshot for the headless smoke (shared with build-demo + smoke). */
export function forkStressServerData(depth) {
  return buildForkStressPage(depth).serverData
}

export { jsonClone }
