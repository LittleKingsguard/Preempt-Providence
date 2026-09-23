/**
 * Fork-stress DATA-DRIVEN page builder — emits one static page per depth
 * (2, 4, 6, 8, 9, 10, 11, 12) plus single-method d12 variants (placement,
 * values, link). Embeds the LEGACY initial-data envelope
 * (forkStressLegacyData(depth, method): root + two prototypes per layer, the
 * R2.2 shared-owner-name placement topology) as `preempt-initial-data` plus
 * `server-data` (the depth/method tokens + the label lists).
 *
 * NO COMPILED CENSUS EXPECTATION IS EMBEDDED (fork-stress-data-p3.md §3 K5 /
 * FD-8): the converted family's whole point is that the builder does not
 * measure the page — the page TRANSLATES the legacy envelope at runtime, runs
 * ONE path-enumeration bootstrap (demo/fork-stress-data.js), and publishes a
 * MEASURED census (registry + its own journal). `depth`/`method` + the label
 * lists are all the page needs to DERIVE its expectations; the static family's
 * `expected`/`serverTreeSig` have no counterpart here (embedding them would
 * make this family a duplicate of the static trio — the FD-8 falsifier).
 *
 * `method` selects the single mechanism the whole tree relies on
 * (placement | values | link), declared as pure DATA on the prototypes;
 * undefined keeps the four-mechanism cycle label per layer.
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
  // depth + method (+ the label lists the page renders): the page DERIVES its
  // census from these alone. NO `expected`, NO shape signature, NO SSR sample.
  const serverData = {
    depth,
    method,
    layerMethods: LAYER_METHODS,
    layerNames: Array.from({ length: depth - 1 }, (_, i) => layerNameFor(method, i + 1)),
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
