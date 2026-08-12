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
import { minimalFromState, treeFromOps, treeSig } from '../dist/core/render-helpers.js'
import { buildFeatureMatrixPage } from './feature-matrix-server.mjs'
import { buildModeTogglePage } from './mode-toggle-page.mjs'
import { buildForkStressPage } from './fork-stress-page.mjs'
import { buildForkStressDataPage } from './fork-stress-data-page.mjs'

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
// The build + server reference are shared with serve-demo.mjs (mode-toggle
// page) via scripts/feature-matrix-server.mjs.
{
  const { doc, serverData } = buildFeatureMatrixPage()
  await emitPage('feature-matrix.template.html', 'feature-matrix.html', doc, serverData)
}

// ---- page 4: mode toggle (SSR / client / markdown) — static client default ---
// serve-demo.mjs re-serves this page dynamically per ?mode=; the emitted static
// client-mode page is what demo-smoke.mjs seeds and what visitors see when they
// open the file directly.
{
  const html = await buildModeTogglePage('client')
  await writeFile(join(ROOT, 'demo', 'mode-toggle.html'), html)
  console.log('built demo/mode-toggle.html (client mode default)')
}

// ---- pages 5-8: fork stress (layered runtime child-creation stress test) ----
// Depths 2..12 (even + 9..12) — each doubles the node count per layer (2^depth − 1).
// The four child-creation mechanisms cycle: placement → values → link →
// handler → repeats with different placement/component names.
{
  for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
    const { doc, serverData } = buildForkStressPage(depth)
    const template = await readFile(join(ROOT, 'demo', 'fork-stress.template.html'), 'utf8')
    const out = template
      .replaceAll('__DEPTH__', String(depth))
      .replaceAll('__TOTAL__', String(2 ** depth - 1))
      .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(doc))
      .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
    await writeFile(join(ROOT, 'demo', `fork-stress-d${depth}.html`), out)
    console.log(`built demo/fork-stress-d${depth}.html (${2 ** depth - 1} nodes)`)
  }
}

// ---- pages 9-16: fork stress, DATA-DRIVEN variant ---------------------------
// Same depths; the page input is a LEGACY envelope (root + two prototypes per
// layer, handlers declared by NAME in the data) — the browser module supplies
// the handler bodies and assembles the tree via the clone-instance op.
{
  for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
    const { html } = await buildForkStressDataPage(depth)
    await writeFile(join(ROOT, 'demo', `fork-stress-data-d${depth}.html`), html)
    console.log(`built demo/fork-stress-data-d${depth}.html (${2 ** depth - 1} nodes, legacy envelope)`)
  }
}
