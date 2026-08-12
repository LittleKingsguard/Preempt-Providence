/**
 * Fork-stress DATA-DRIVEN page builder — emits one static page per depth
 * (2, 4, 6, 8, 9, 10, 11, 12) plus single-method d12 variants (placement,
 * values, link). Embeds the LEGACY initial-data envelope
 * (forkStressLegacyData(depth, method): root + two prototypes per layer,
 * handlers declared by NAME — the browser module supplies the bodies) as
 * `preempt-initial-data` plus `server-data` (the checks' expectations).
 * The browser module (demo/fork-stress-data.js) translates the envelope,
 * installs the handler bodies, and drives the tree via the clone-instance op.
 *
 * `method` selects the single child-creation mechanism the whole tree relies
 * on (placement | values | link); undefined keeps the four-mechanism cycle
 * label per layer (spec: docs/specs/fork-stress-data.md §4).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { forkStressLegacyData } from '../demo/fork-stress-data.js'
import { LAYER_METHODS, layerName } from '../demo/fork-stress-fixture.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Layer-chain name: single-method pages use `L<k>:<method>` for every layer;
 *  the cycle pages keep the imperative naming (L1:placement, L2:values-1, …). */
function layerNameFor(method, k) {
  if (method) return `L${k}:${method}`
  return layerName(k)
}

/** Build the embedded data + server reference for a data-driven page. */
export async function buildForkStressDataPage(depth, method) {
  if (!Number.isInteger(depth) || depth < 2) throw new Error(`unsupported fork-stress-data depth ${depth}`)
  if (method !== undefined && !['placement', 'values', 'link'].includes(method)) {
    throw new Error(`unsupported fork-stress-data method ${method}`)
  }
  const initialData = forkStressLegacyData(depth, method)
  const serverData = {
    depth,
    method,
    layerMethods: LAYER_METHODS,
    layerNames: Array.from({ length: depth - 1 }, (_, i) => layerNameFor(method, i + 1)),
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
