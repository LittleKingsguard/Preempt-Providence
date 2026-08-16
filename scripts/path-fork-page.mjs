/**
 * Static derived-family page builder — emits the THREE derived pages
 * (demo/path-fork-data.html — placement, the family baseline — plus
 * demo/path-fork-data-values-d12.html and demo/path-fork-data-link-d12.html)
 * from the static re-expression envelope (placement-path-spec §5): root + 22
 * prototypes with placement links (placementName producers + targetPlacement
 * consumers — the R2.2 sibling-shared owner-name topology), compiled by the
 * §2 path enumeration (4095 path-states, ONE pass, no clone-instance). The
 * values/link variants add the per-method component fields on the prototypes
 * (derived-fork-variants-review §5.1 — the derived trio).
 *
 * Embeds the LEGACY envelope as `preempt-initial-data` and the server
 * reference (expected census + the PAR-5 shape signature) as `server-data`.
 * The full 4095-element SSR snapshot is NOT embedded (it is ~180MB — the
 * nested binary tree serializes O(n·depth)); parity is verified by the
 * wire-agnostic shape signature at runtime, and the expected section shows
 * a truncated sample of the builder's SSR fragment. The browser module
 * (demo/path-fork-data.js) is core-only + legacy data.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathForkLegacyData, pathForkServerData, pathForkSsrSample } from '../demo/path-fork-data.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

const METHOD_META = {
  placement: {
    title: 'Path Fork (static) — 22 prototypes, ONE path-enumeration pass',
    h1: 'Path Fork (static) — 23 nodes → <code>2<sup>12</sup> − 1 = 4095</code> path-states in ONE compile pass',
    goals: 'The fork-stress binary topology WITHOUT clones: two prototypes per layer, 1..11, each declaring its placement zone (<code>placementName</code>) and the level above\'s shared zone name (<code>targetPlacement</code>). The path enumeration (§2) mints one state per (prototype, owner-path) pair — 4095 states from 23 graph nodes, <code>forkKey = pathKey</code> on every state. The checks assert the static census (registered=23, in-tree=23, unplaced=0, cloneOps=0), per-level element counts (2^k at level k), the binary shape via <code>treeFromOps</code>, css per-level property + slot pairs, derived <code>stress:expanded</code> idempotency, and PAR-5 structural parity with the builder\'s SSRFragmentAdapter output (hashed shape signature + truncated sample — the full fragment is never embedded).',
    methodNote: '',
  },
  values: {
    title: 'Path Fork (values-derived) — 22 prototypes, ONE path-enumeration pass',
    h1: 'Path Fork (values-derived) — 23 nodes → <code>2<sup>12</sup> − 1 = 4095</code> path-states in ONE compile pass',
    goals: 'The values member of the DERIVED TRIO (placement / values / link — derived-fork-variants-review §5.1): the SAME 22-prototype binary topology, every prototype additionally carrying <code>component: {reference: \'values-&lt;k&gt;.&lt;slot&gt;\', value: \'value-&lt;SLOT&gt;-&lt;k&gt;\'}</code> (the fork-stress-data.js values shape). Every path-state provides its own scalar value and renders it as text — the values mechanism over the derived layer, ZERO clones, ZERO handlers. The checks add the text-vs-resolved-value assertion (every path-state element contains <code>value-&lt;SLOT&gt;-&lt;k&gt;</code>) to the placement page\'s census/shape/parity checks.',
    methodNote: 'Values-derived: every prototype provides a component VALUE; every path-state renders its own <code>value-&lt;SLOT&gt;-&lt;k&gt;</code> text.',
  },
  link: {
    title: 'Path Fork (link-derived) — 22 prototypes, ONE path-enumeration pass',
    h1: 'Path Fork (link-derived) — 23 nodes → <code>2<sup>12</sup> − 1 = 4095</code> path-states in ONE compile pass',
    goals: 'The link member of the DERIVED TRIO (placement / values / link — derived-fork-variants-review §5.1): the SAME 22-prototype binary topology, every prototype additionally carrying <code>component: {reference: \'link-&lt;k&gt;\', value: &lt;linkDefForLevel(k)&gt;}</code> — the component DEF (prototype-as-child link) as the source value (the fork-stress-data.js link shape). Every path-state is a def consumer whose OWN children are re-typed by the def at emit time — the recursive def chain over path-states (P-EMIT-3 carve-out). The 4095-element census holds via the covered-leaf def-fill gate (DEFECT #21 — render.md:185 letter). The checks add the def-chain re-type assertions (div type, def content for k &gt; 1, the child\'s OWN props on re-typed elements) + the re-typed-element count pin (4092 bare-wire elements, no forkKey — the adapter-key asymmetry).',
    methodNote: 'Link-derived: every prototype provides a component DEF; the def re-types the next layer at emit time (4095 elements post the covered-leaf gate).',
  },
}

/** Build the embedded data + server reference + SSR expected sample. */
export async function buildPathForkPage(method = 'placement') {
  const initialData = pathForkLegacyData(method)
  const serverData = pathForkServerData(method)
  // cheap sample: render only the FIRST ops (root element + early structure)
  // through the SSRFragmentAdapter — never the full ~190MB 4095-element
  // fragment (O(n·depth) serialization; parity is the hashed shape signature)
  const sample = pathForkSsrSample(method, 300)
  serverData.expectedSsrSample = sample
  const meta = METHOD_META[method] ?? METHOD_META.placement
  const template = await readFile(join(ROOT, 'demo', 'path-fork-data.template.html'), 'utf8')
  const html = template
    .replaceAll('__PAGE_TITLE__', () => meta.title)
    .replaceAll('__PAGE_H1__', () => meta.h1)
    .replaceAll('__PAGE_GOALS__', () => meta.goals)
    .replaceAll('__METHOD_NOTE__', () => meta.methodNote)
    .replaceAll('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(initialData))
    .replaceAll('__SERVER_DATA__', () => JSON.stringify(serverData))
    .replaceAll('__SR_EXPECTED__', () => sample
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
  return { html, initialData, serverData, ssrHtml: sample }
}
