/**
 * Builds the demo pages from templates by embedding the framework's SSR data
 * document (`<script id="preempt-initial-data">`) — the SAME input data the
 * e2e tests render — plus a server-side reference so the pages can verify
 * parity / resolutions in-browser.
 *
 * Pages:
 *   demo/ssr-render.html    — nested pane (fork + placement), PAR-5 parity
 *   demo/components.html    — component-driven page (bonus): target refs for
 *                             type/children population, source refs for child
 *                             values, tests as content nodes
 *   demo/feature-matrix.html — one document exercising every advertised
 *                             surface (legacy translate → placements,
 *                             components/forks, handlers, payload lifecycle,
 *                             loop-safety, reverse translation, PAR-5)
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffMinimal } from '../dist/core/render.js'
import { serializeSlice } from '../dist/core/serialize.js'
import { buildNestedPane, nodeLabelsFor } from '../demo/pane-fixture.js'
import { buildComponentTree, componentLabelsFor, testGoals } from '../demo/component-fixture.js'
import { buildFeatureMatrix } from '../demo/feature-matrix-fixture.js'
import { emitElements } from '../demo/lib/feature-matrix-emit.js'
import { minimalFromState, treeFromOps, treeSig } from '../demo/lib/render-ops.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

async function emitPage(templateName, outName, doc, serverData) {
  const template = await readFile(join(ROOT, 'demo', templateName), 'utf8')
  const out = template
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(doc))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  await writeFile(join(ROOT, 'demo', outName), out)
  console.log(`built demo/${outName} (${JSON.stringify(doc).length} bytes of initial data)`)
}

// ---- page 1: SSR receive → complete render -------------------------------
{
  const pane = buildNestedPane()
  const { root, dock } = pane
  const slice = [root, dock, pane.inner, pane.zone]
  const serverCr = root.compile(slice)
  const serverOps = diffMinimal(null, serverCr.actionable.map(minimalFromState))
  const dockArms = serverCr.actionable.filter((s) => s.nodeId === dock.id)
  if (dockArms.length !== 2) throw new Error(`expected 2 fork arms, got ${dockArms.length}`)
  const doc = serializeSlice(root, slice)
  const serverData = {
    serverTreeSig: treeSig(treeFromOps(serverOps)),
    nodeLabels: nodeLabelsFor(pane),
    expectedTree: treeFromOps(serverOps),
    forkArms: dockArms.map((a) => ({
      pathKey: a.pathKey,
      feed: a.bindings['feed'],
      trace: a.trace ?? [],
    })),
  }
  await emitPage('ssr-render.template.html', 'ssr-render.html', doc, serverData)
}

// ---- page 2: component-driven rendering (bonus) ---------------------------
{
  const tree = buildComponentTree()
  const slice = [
    tree.root, tree.header, tree.intro, tree.panelC, tree.zone,
    tree.userPane, tree.username, tree.statusLine, tree.actions, tree.loginBtn, tree.logoutBtn,
    tree.editor, tree.display, tree.part0, tree.part1, tree.part2,
    tree.tests, ...tree.testNodes, tree.footer,
  ]
  const doc = serializeSlice(tree.root, slice)
  const cr = tree.root.compile(slice)
  const panelArms = cr.actionable.filter((s) => s.nodeId === tree.panelC.id)
  if (panelArms.length !== 2) throw new Error(`expected 2 component arms, got ${panelArms.length}`)
  const serverData = {
    nodeLabels: componentLabelsFor(tree),
    goals: testGoals,
    forkArms: panelArms.map((a) => ({ pathKey: a.pathKey })),
    placement: 'slot-alpha',
  }
  await emitPage('components.template.html', 'components.html', doc, serverData)
}

// ---- page 3: feature matrix (one document, every framework surface) ----------
{
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
  await emitPage('feature-matrix.template.html', 'feature-matrix.html', doc, serverData)
}
