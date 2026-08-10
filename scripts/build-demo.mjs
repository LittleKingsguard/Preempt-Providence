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
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { diffMinimal } from '../dist/core/render.js'
import { serializeSlice } from '../dist/core/serialize.js'
import { buildNestedPane, nodeLabelsFor } from '../demo/pane-fixture.js'
import { buildComponentTree, componentLabelsFor, testGoals } from '../demo/component-fixture.js'
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
  const slice = [tree.root, tree.header, tree.intro, tree.panelC, tree.zone, tree.tests, ...tree.testNodes, tree.footer]
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
