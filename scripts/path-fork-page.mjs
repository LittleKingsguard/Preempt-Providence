/**
 * Static derived-family page builder — emits the derived-family pages
 * (path-fork-data.html — placement d12, the family baseline — plus the d12
 * values/link variants and the d14 family: path-fork-data-{placement,values,
 * link}-d14.html — the d14 pages are the SCALING PROBES: the d12 family
 * totals (~2.8s enumeration) are too fast to expose EMIT-side scaling, so the
 * d14 trio (2^14 − 1 = 16383 path-states) joins the family with the same
 * per-region pins, 2026-08-16) from the static re-expression envelope
 * (placement-path-spec §5): root + 2·(depth−1) prototypes with placement
 * links (placementName producers + targetPlacement consumers — the R2.2
 * sibling-shared owner-name topology), compiled by the §2 path enumeration
 * (2^depth − 1 path-states, ONE pass, no clone-instance). The values/link
 * variants add the per-method component fields on the prototypes
 * (derived-fork-variants-review §5.1 — the derived trio).
 *
 * Embeds the LEGACY envelope as `preempt-initial-data` and the server
 * reference (expected census + the PAR-5 shape signature) as `server-data`.
 * The full SSR snapshot is NOT embedded (the nested binary tree serializes
 * O(n·depth) — ~180MB at d12, ~840MB at d14); parity is verified by the
 * wire-agnostic shape signature at runtime, and the expected section shows
 * a truncated sample of the builder's SSR fragment. The browser module
 * (demo/path-fork-data.js) is core-only + legacy data.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathForkLegacyData, pathForkServerData, pathForkSsrSample } from '../demo/path-fork-data.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Family numbers for a depth: 2·(depth−1) prototypes, 2·depth−1 graph nodes,
 *  2^depth − 1 path-states/elements, states − 3 re-typed link elements. */
function familyFor(depth) {
  const states = 2 ** depth - 1
  return {
    depth,
    nodes: 2 * depth - 1,
    prototypes: 2 * (depth - 1),
    layers: depth - 1,
    states,
    retyped: states - 3,
  }
}

function methodMetaFor(method, f) {
  const { depth, nodes, prototypes, layers, states, retyped } = f
  const h1 = (label) =>
    `Path Fork (${label}) — ${nodes} nodes → <code>2<sup>${depth}</sup> − 1 = ${states}</code> path-states in ONE compile pass`
  if (method === 'values') {
    return {
      title: `Path Fork (values-derived) — ${prototypes} prototypes, ONE path-enumeration pass`,
      h1: h1('values-derived'),
      goals: `The values member of the DERIVED TRIO (placement / values / link — derived-fork-variants-review §5.1): the SAME ${prototypes}-prototype binary topology, every prototype additionally carrying <code>component: {reference: 'values-&lt;k&gt;.&lt;slot&gt;', value: 'value-&lt;SLOT&gt;-&lt;k&gt;'}</code> (the fork-stress-data.js values shape). Every path-state provides its own scalar value and renders it as text — the values mechanism over the derived layer, ZERO clones, ZERO handlers. The checks add the text-vs-resolved-value assertion (every path-state element contains <code>value-&lt;SLOT&gt;-&lt;k&gt;</code>) to the placement page's census/shape/parity checks.`,
      methodNote: 'Values-derived: every prototype provides a component VALUE; every path-state renders its own <code>value-&lt;SLOT&gt;-&lt;k&gt;</code> text.',
    }
  }
  if (method === 'link') {
    return {
      title: `Path Fork (link-derived) — ${prototypes} prototypes, ONE path-enumeration pass`,
      h1: h1('link-derived'),
      goals: `The link member of the DERIVED TRIO (placement / values / link — derived-fork-variants-review §5.1): the SAME ${prototypes}-prototype binary topology, every prototype additionally carrying <code>component: {reference: 'link-&lt;k&gt;', value: &lt;linkDefForLevel(k)&gt;}</code> — the component DEF (prototype-as-child link) as the source value (the fork-stress-data.js link shape). Every path-state is a def consumer whose OWN children are re-typed by the def at emit time — the recursive def chain over path-states (P-EMIT-3 carve-out). The ${states}-element census holds via the covered-leaf def-fill gate (DEFECT #21 — render.md:185 letter). The checks add the def-chain re-type assertions (div type, def content for k &gt; 1, the child's OWN props on re-typed elements) + the re-typed-element count pin (${retyped} bare-wire elements, no forkKey — the adapter-key asymmetry).`,
      methodNote: `Link-derived: every prototype provides a component DEF; the def re-types the next layer at emit time (${states} elements post the covered-leaf gate).`,
    }
  }
  return {
    title: `Path Fork (static) — ${prototypes} prototypes, ONE path-enumeration pass`,
    h1: h1('static'),
    goals: `The fork-stress binary topology WITHOUT clones: two prototypes per layer, 1..${layers}, each declaring its placement zone (<code>placementName</code>) and the level above's shared zone name (<code>targetPlacement</code>). The path enumeration (§2) mints one state per (prototype, owner-path) pair — ${states} states from ${nodes} graph nodes, <code>forkKey = pathKey</code> on every state. The checks assert the static census (registered=${nodes}, in-tree=${nodes}, unplaced=0, cloneOps=0), per-level element counts (2^k at level k), the binary shape via <code>treeFromOps</code>, css per-level property + slot pairs, derived <code>stress:expanded</code> idempotency, and PAR-5 structural parity with the builder's SSRFragmentAdapter output (hashed shape signature + truncated sample — the full fragment is never embedded).`,
    methodNote: '',
  }
}

/** Build the embedded data + server reference + SSR expected sample. */
export async function buildPathForkPage(method = 'placement', depth = 12) {
  if (!Number.isInteger(depth) || depth < 2) throw new Error(`unsupported path-fork depth ${depth}`)
  const f = familyFor(depth)
  const initialData = pathForkLegacyData(method, depth)
  const serverData = pathForkServerData(method, depth)
  // cheap sample: render only the FIRST ops (root element + early structure)
  // through the SSRFragmentAdapter — never the full ~180MB (d12) / ~840MB
  // (d14) 2^depth−1-element fragment (O(n·depth) serialization; parity is
  // the hashed shape signature)
  const sample = pathForkSsrSample(method, 300, depth)
  serverData.expectedSsrSample = sample
  const meta = methodMetaFor(method, f)
  const srSizeMb = Math.round(180 * f.states / 4095 * f.depth / 12)
  const template = await readFile(join(ROOT, 'demo', 'path-fork-data.template.html'), 'utf8')
  const html = template
    .replaceAll('__PAGE_TITLE__', () => meta.title)
    .replaceAll('__PAGE_H1__', () => meta.h1)
    .replaceAll('__PAGE_GOALS__', () => meta.goals)
    .replaceAll('__METHOD_NOTE__', () => meta.methodNote)
    .replaceAll('__PROTOTYPES__', () => String(f.prototypes))
    .replaceAll('__LAYERS__', () => String(f.layers))
    .replaceAll('__NODES__', () => String(f.nodes))
    .replaceAll('__STATES__', () => String(f.states))
    .replaceAll('__SR_SIZE__', () => `~${srSizeMb}MB`)
    .replaceAll('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(initialData))
    .replaceAll('__SERVER_DATA__', () => JSON.stringify(serverData))
    .replaceAll('__SR_EXPECTED__', () => sample
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
  return { html, initialData, serverData, ssrHtml: sample }
}
