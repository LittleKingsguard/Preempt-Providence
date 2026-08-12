/**
 * Fork-stress DATA-DRIVEN page builder — emits one static page per depth
 * (2, 4, 6, 8, 9, 10, 11, 12). Embeds the LEGACY initial-data envelope
 * (forkStressLegacyData(depth): root + two prototypes per layer, handlers
 * declared by NAME — the browser module supplies the bodies) as
 * `preempt-initial-data` plus `server-data` (the checks' expectations).
 * The browser module (demo/fork-stress-data.js) translates the envelope,
 * installs the handler bodies, and drives the tree via the clone-instance op.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forkStressLegacyData } from '../demo/fork-stress-data.js'
import { LAYER_METHODS, layerName } from '../demo/fork-stress-fixture.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Build the embedded data + server reference for a data-driven page. */
export async function buildForkStressDataPage(depth) {
  if (!Number.isInteger(depth) || depth < 2) throw new Error(`unsupported fork-stress-data depth ${depth}`)
  const initialData = forkStressLegacyData(depth)
  const serverData = {
    depth,
    layerMethods: LAYER_METHODS,
    layerNames: Array.from({ length: depth - 1 }, (_, i) => layerName(i + 1)),
    // expected tree shape: layer k has 2^k nodes; total = 2^depth - 1
    expected: {
      perLayer: Array.from({ length: depth - 1 }, (_, k) => 2 ** (k + 1)),
      total: 2 ** depth - 1,
    },
  }
  const template = await readFile(join(ROOT, 'demo', 'fork-stress-data.template.html'), 'utf8')
  const html = template
    .replaceAll('__DEPTH__', String(depth))
    .replaceAll('__TOTAL__', String(2 ** depth - 1))
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(initialData))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  return { html, initialData, serverData }
}

/** Stable expectations snapshot for the headless smoke (shared with build-demo). */
export async function forkStressDataServerData(depth) {
  return (await buildForkStressDataPage(depth)).serverData
}
