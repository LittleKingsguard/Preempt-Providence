/**
 * Shared server-side feature-matrix page builder — used by
 *   - scripts/build-demo.mjs  (static demo/feature-matrix.html)
 *   - scripts/serve-demo.mjs  (dynamic demo/mode-toggle.html in each mode)
 *
 * Exposes:
 *   buildFeatureMatrixPage()        → { doc, serverData }  (the shipped
 *                                     preempt-initial-data document + the
 *                                     server reference the pages verify)
 *   renderFeatureMatrixSsrHtml()    → full HTML string for the same document
 *                                     rendered server-side through the REAL
 *                                     SSRFragmentAdapter (the "SSR adapter"
 *                                     mode: the full HTML is what the server
 *                                     sends in the response body).
 */
import { diffMinimal } from '../dist/core/render.js'
import { serializeSlice } from '../dist/core/serialize.js'
import { SSRFragmentAdapter } from '../dist/core/adapters.js'
import { applyOps } from '../dist/core/render-helpers.js'
import { emitElements } from '../dist/core/render-helpers.js'
import { treeFromOps, treeSig } from '../dist/core/render-helpers.js'
import { buildFeatureMatrix } from '../demo/feature-matrix-fixture.js'

/** Build the feature-matrix graph once and return everything the demos need:
 *  the compiled surface, the shipped document, and the server reference. */
function buildFeatureMatrixSurface() {
  const fm = buildFeatureMatrix()
  const { root, nodes } = fm
  const slice = nodes
  const nodeById = new Map(nodes.map((n) => [n.id, n]))
  const cr = root.compile(slice)

  // fork arms: each 'theme' consumer resolves 2 arms (FRK-H2)
  const forkArms = ['fork-a', 'fork-b'].map((name) => {
    const id = fm.byId.get(name).id
    const arms = cr.actionable.filter((s) => s.nodeId === id)
    if (arms.length !== 2) throw new Error(`${name}: expected 2 theme arms, got ${arms.length}`)
    return { name, arms: arms.map((a) => ({ pathKey: a.pathKey, theme: a.bindings['theme'], trace: a.trace ?? [] })) }
  })

  // loop-safety: the ancestry resolution cycle drops as 'loop' + circular-source
  const loopWires = ['loop-cycle', 'loop-nest', 'loop-a', 'loop-b'].map((n) => fm.byId.get(n).id)
  const loopDrops = cr.dropped.filter((d) => loopWires.includes(d.arm[0]))
  if (loopDrops.length !== 4) throw new Error(`expected 4 loop drops, got ${loopDrops.length}`)
  if (!loopDrops.every((d) => d.reason === 'loop')) throw new Error(`loop drops not reason 'loop': ${JSON.stringify(cr.dropped)}`)
  if (!cr.warnings.some((w) => w.code === 'circular-source')) throw new Error('expected a circular-source warning')

  // session component resolution + placement attachment server-side contract
  const paneStates = cr.actionable.filter((s) => s.nodeId === fm.byId.get('user-pane').id)
  if (!paneStates[0]?.bindings['session']) throw new Error('session must resolve on the user pane')
  if (fm.byId.get('content-zone').children.length !== 2) throw new Error('content zone should carry 2 attached roots')
  if (fm.byId.get('comments-zone').children.length !== 1) throw new Error('comments zone should carry 1 attached root')
  if (loopDrops.some((d) => cr.actionable.some((s) => s.nodeId === d.arm[0]))) throw new Error('dropped loop arms must not be actionable')

  // PAR-5 parity reference (runtime on:* handler bindings excluded — compare render data)
  const parityEls = emitElements(cr.actionable, nodeById).map((e) => {
    const props = {}
    for (const [k, v] of Object.entries(e.props)) if (!k.startsWith('on:')) props[k] = v
    return { ...e, props }
  })
  const serverOps = diffMinimal(null, parityEls)

  const expected = {
    nodeCount: nodes.length,
    forkCount: forkArms.length,
    armsPerConsumer: 2,
    loopDropped: true,
    contentAttached: 2,
    commentsAttached: 1,
    paneHasSession: true,
  }
  const doc = serializeSlice(root, nodes, fm.clientConfig)
  const serverData = {
    serverTreeSig: treeSig(treeFromOps(serverOps)),
    nodeLabels: fm.labels,
    expected,
    forkArms,
    loopDroppedWires: loopWires,
    payloadGroups: {
      article: fm.payloadGroups.article.map((n) => n.id),
      comments: fm.payloadGroups.comments.map((n) => n.id),
    },
  }
  return { fm, cr, nodeById, parityEls, serverOps, doc, serverData }
}

/** { doc, serverData } — the shipped document + server reference. */
export function buildFeatureMatrixPage() {
  const { doc, serverData } = buildFeatureMatrixSurface()
  return { doc, serverData }
}

/** Full server-rendered HTML for the feature-matrix document, through the real
 *  SSRFragmentAdapter (src/core/adapters.ts). The on:* handler bindings are
 *  runtime-only (SER-F1); this renders the emitted surface (minus those props),
 *  exactly the parity reference the client compares against. */
export function renderFeatureMatrixSsrHtml() {
  const { parityEls, serverOps, serverData } = buildFeatureMatrixSurface()
  const adapter = new SSRFragmentAdapter()
  applyOps(adapter, serverOps)
  const html = adapter.toString()
  if (treeSig(treeFromOps(diffMinimal(null, parityEls))) !== serverData.serverTreeSig) {
    throw new Error('server-rendered SSR HTML diverges from the parity reference')
  }
  return html
}
