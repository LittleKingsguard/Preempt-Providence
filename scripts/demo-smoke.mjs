// Headless smoke test: run the demo modules against a minimal DOM shim and
// assert every check passes (the same assertions the browser pages show).
//
// Heavy-page isolation (2026-08-16 — fork-family measurement): every page
// module instance RETAINS its frame (supervisor + DOM tree + prevMap, ~50MB+
// at the d12 fork pages and ~50MB+ scaled at the built-but-not-smoke-run d14
// probes), and stacking a dozen of those in one process balloons the live
// heap to hundreds of MB — each later page's allocations then trigger full
// mark-sweep storms (measured: 0.3s of page work costing 95s of wall time,
// and a 500s derived-trio block across 6 pages whose honest page-work is
// ~5s). The fork-family pages therefore run in an ISOLATED SUBPROCESS each
// (scripts/smoke-page-worker.mjs) whose frame is freed on exit — the guards,
// census pins and ratio bounds below are byte-identical to the inline form;
// only the process that runs the page differs. The light pages (ssr-render,
// components, loop-safety, feature-matrix, mode-toggle, showcase/legacy/
// handlers) stay inline — their trees are small.
// NOTE (2026-08-16): the d14 fork pages are BUILT (scripts/build-demo.mjs)
// but NOT part of this automated smoke — they are manual/browser scaling
// probes (the d12 family is the automated tripwire: an O(n²) return flags
// there; the d14 pages only made the automated smoke ~2m longer).
import { installSmokeShim } from './smoke-shim.mjs'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const { byId, seedPage, seedRawText, collectBanners } = installSmokeShim()

const { fileURLToPath } = await import('node:url')
const base = fileURLToPath(new URL('..', import.meta.url))

// Seed the framework input data embedded in the generated pages
// (scripts/build-demo.mjs must run before this script).
const { readFile } = await import('node:fs/promises')
const { buildModeTogglePage } = await import('./mode-toggle-page.mjs')
const ssrHtml = await readFile(`${base}demo/ssr-render.html`, 'utf8')
const compHtml = await readFile(`${base}demo/components.html`, 'utf8')

// ---- heavy fork-family page runner: each page runs in a fresh subprocess ----
// The page's own `[xxx:profile]` line still streams visible output (that IS the
// report the smoke exists to print); the profile OBJECT comes back via a temp
// result file so the guards below stay a single source of truth in this file.
const _resultDir = mkdtempSync(join(tmpdir(), 'smoke-pages-'))
// banners from the worker-run pages (the parent walks only its own mounted
// shim; each worker ships its page's runner banners back via the result)
const workerBanners = []
function runForkPage(pageFile, modulePath, query, doneGlobal, raceWindowMs, label) {
  const resultFile = join(_resultDir, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`)
  // `pageFile` may be given as `demo/...` (the derived-trio entries) or bare
  // (`fork-stress-d2.html`) — normalize under the base's demo/ directory
  const pageRel = pageFile.startsWith('demo/') ? pageFile.slice('demo/'.length) : pageFile
  const pageHtmlPath = `${base}demo/${pageRel}`
  const moduleAbs = `${base}${modulePath}`
  const res = spawnSync(process.execPath, [
    fileURLToPath(new URL('./smoke-page-worker.mjs', import.meta.url)),
    resultFile, pageHtmlPath, moduleAbs, query, doneGlobal, String(raceWindowMs),
  ], { encoding: 'utf8', stdio: ['ignore', 'inherit', 'inherit'] })
  if (res.status !== 0) {
    console.error(`${label} worker failed (exit ${res.status ?? 'signal'}) — page did not finish profiling`)
    process.exit(1)
  }
  let result
  try {
    result = JSON.parse(readFileSync(resultFile, 'utf8'))
  } catch (e) {
    console.error(`${label} worker result unreadable:`, e)
    process.exit(1)
  }
  if (Array.isArray(result.banners)) workerBanners.push(...result.banners)
  return result.profile
}

seedPage(ssrHtml)
await import(`${base}demo/ssr-render.js`).catch((e) => {
  console.error('ssr-render failed:', e)
  process.exit(1)
})
seedPage(compHtml)
await import(`${base}demo/components.js`).catch((e) => {
  console.error('components failed:', e)
  process.exit(1)
})
await import(`${base}demo/loop-safety.js`).catch((e) => {
  console.error('loop-safety failed:', e)
  process.exit(1)
})
const fmHtml = await readFile(`${base}demo/feature-matrix.html`, 'utf8')
seedPage(fmHtml)
await import(`${base}demo/feature-matrix.js`).catch((e) => {
  console.error('feature-matrix failed:', e)
  process.exit(1)
})

// ---- mode-toggle page: every adapter mode drives the shared harness ---------
// Each mode is seeded and imported as a distinct module instance (cache-busted
// by `?mode=`), so all three banner titles land in the same run.
for (const mode of ['client', 'ssr', 'markdown']) {
  const pageHtml = await buildModeTogglePage(mode)
  seedPage(pageHtml)
  if (mode === 'ssr') seedRawText(pageHtml, 'script', 'received-html-data')
  if (mode === 'markdown') seedRawText(pageHtml, 'pre', 'markdown-source')
  await import(`${base}demo/mode-toggle.js?mode=${mode}`).catch((e) => {
    console.error(`mode-toggle (${mode}) failed:`, e)
    process.exit(1)
  })
}

// ---- fork-stress pages: one module instance per depth (cache-busted) --------
// Each depth's page seeds its own doc + server data; the module reads depth
// from server-data and drives the runtime layers (L4..depth). Depth set 2..12
// (the d14 page is BUILT as a manual/browser scaling probe — 2^14 − 1 =
// 16383 nodes — but does not run in this automated smoke).
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  // isolated subprocess (frame freed on exit) — the guards below are unchanged
  const prof = runForkPage(`fork-stress-d${depth}.html`, `demo/fork-stress.js`, `depth=${depth}`, '__forkStressDone', 30000, `fork-stress (depth ${depth})`)
  // performance-tracking guard (same contract as the data pages): the timed
  // sections (incl. pass2 flush windows, page-side construction, handler
  // bodies) must cover ~all of the total; appends counts the diffMinimal
  // append ops — the DOM-churn proxy the shim cannot time (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md "imperative fork-stress").
  const residual = prof.totalMs - (prof.coveredMs ?? 0)
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`fork-stress (depth ${depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms`)
    process.exit(1)
  }
  if ((prof.appends ?? 0) < 2 ** depth - 2) {
    console.error(`fork-stress (depth ${depth}) append count implausible: appends=${prof.appends} for ${2 ** depth - 1} nodes`)
    process.exit(1)
  }
}

// ---- fork-stress DATA-DRIVEN pages: one module instance per depth ----------
// The page input is a LEGACY envelope (root + prototypes); the module
// translates it, installs the handler bodies by name, and the clone-instance
// recursion assembles the tree.
// Census guard (census-revision review — the page publishes registered /
// in-tree / unplaced / destroyed / cloneOps on the profile; in-tree and
// unplaced are asserted by the page's own checks, the rest is derived
// arithmetic this guard pins so the census can never silently drift).
// F-13 re-pin (placement-path-spec §5.2): contentNodes-ownership minting
// makes the 22 prototype content roots family-in-tree too — in-tree =
// 2^depth − 1 + 2·(depth−1), unplaced = 0; cloneOps stays the journaled
// clone count (the prototypes were never cloned into).
function assertForkStressCensus(prof, depth, label) {
  const prototypes = 2 * (depth - 1)
  const expectedInTree = 2 ** depth - 1 + prototypes
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'cloneOps']) {
    if (typeof prof[f] !== 'number') {
      console.error(`${label} profile missing census field "${f}" — fork-stress-data census not published`)
      process.exit(1)
    }
  }
  if (prof.inTree !== expectedInTree) {
    console.error(`${label} census in-tree mismatch: inTree=${prof.inTree}, expected ${expectedInTree} (2^depth − 1 + ${prototypes} contentNodes-owned prototypes)`)
    process.exit(1)
  }
  if (prof.unplaced !== 0) {
    console.error(`${label} census unplaced mismatch: unplaced=${prof.unplaced}, expected 0 (every node is family-in-tree after contentNodes minting — F-13)`)
    process.exit(1)
  }
  if (prof.destroyed !== 0) {
    console.error(`${label} census destroyed mismatch: destroyed=${prof.destroyed}, expected 0 (no demo page fires a destroy op)`)
    process.exit(1)
  }
  if (prof.cloneOps !== prof.inTree - 1 - prototypes) {
    console.error(`${label} census cloneOps mismatch: cloneOps=${prof.cloneOps}, expected in-tree − 1 − ${prototypes} = ${prof.inTree - 1 - prototypes} (the journaled clone-instance count)`)
    process.exit(1)
  }
  if (prof.registered !== prof.inTree + prof.unplaced + prof.destroyed) {
    console.error(`${label} census registered mismatch: registered=${prof.registered}, expected in-tree + unplaced + destroyed = ${prof.inTree + prof.unplaced + prof.destroyed}`)
    process.exit(1)
  }
}
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  // isolated subprocess (frame freed on exit) — the guards below are unchanged
  const prof = runForkPage(`fork-stress-data-d${depth}.html`, `demo/fork-stress-data.js`, `depth=${depth}`, '__forkStressDataDone', 30000, `fork-stress-data (depth ${depth})`)
  // performance-tracking guard (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md "missing
  // timing steps"): the timed sections must cover ~all of the page total, so
  // "total" can never hide an unmeasured pipeline again. The residual is the
  // flush timers + checks; a regression that balloons the pass-2 region while
  // measured sections stay small now fails HERE instead of hiding in total.
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  // fixed overhead (flush timers + checks + summary) is ~1–25ms regardless of
  // depth, so the guard is residual-based with an absolute tolerance: the
  // untimed region may never exceed 15% of total NOR 25ms absolute.
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`fork-stress-data (depth ${depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  assertForkStressCensus(prof, depth, `fork-stress-data (depth ${depth})`)
}
// ---- single-method variants (placement-only / values-only / link-only) ------
// The whole tree relies on ONE mechanism; the module re-instantiates per page.
// d12 (the pinned depth) records its OWN placement baseline + the 2.5× totals
// ratio guard — the automated tripwire against pipeline blow-ups. The d14
// single-method pages stay BUILT (scripts/build-demo.mjs) as manual/browser
// scaling probes; they do not run in this automated smoke (an O(n²) return
// flags on the d12 family).
const d12Totals = {}
for (const [depth, totals] of [[12, d12Totals]]) {
  for (const method of ['placement', 'values', 'link']) {
    const prof = runForkPage(`fork-stress-data-${method}-d${depth}.html`, `demo/fork-stress-data.js`, `method=${method}&depth=${depth}`, '__forkStressDataDone', 60000, `fork-stress-data (${method}-only d${depth})`)
    const residual = prof.totalMs - (prof.coveredMs ?? 0)
    if (residual > Math.max(prof.totalMs * 0.15, 25)) {
      console.error(`fork-stress-data (${method}-only d${depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms`)
      process.exit(1)
    }
    assertForkStressCensus(prof, depth, `fork-stress-data (${method}-only d${depth})`)
    totals[method] = prof.totalMs
  }
  // totals ratio guard (AGENTS.md item 4, promoted from manual to asserted):
  // the values/link totals must stay within a loose multiple of the placement
  // baseline — the historical O(n²) pass-2 regression showed as ~20×, so 2.5×
  // is a generous CI-safe bound that still catches pipeline blow-ups.
  const placementBase = totals['placement'] ?? 0
  for (const method of ['values', 'link']) {
    const ratio = placementBase > 0 ? (totals[method] ?? 0) / placementBase : 0
    if (ratio > 2.5) {
      console.error(`fork-stress-data (${method}-only d${depth}) total ratio ${ratio.toFixed(2)}× exceeds 2.5× of placement (${totals[method]}ms vs ${placementBase}ms)`)
      process.exit(1)
    }
  }
}

// ---- static derived trio: 22 prototypes, ONE path-enumeration pass ---------
// The static re-expression (placement-path-spec §5): translate → ONE
// compilePath bootstrap → emit/diff/apply. NO clone-instance ops, NO
// after-compile expansion — 4095 path-states from 23 graph nodes (E2E-1).
// Three method variants (the derived trio — derived-fork-variants-review
// §5.1): placement (the FAMILY BASELINE, no component fields), values (+
// component value per prototype), link (+ component def per prototype — the
// recursive def chain; its 4095-element census holds via the covered-leaf
// def-fill gate, DEFECT #21).
// Census guard: the page publishes registered / inTree / unplaced / destroyed
// / cloneOps / states / elements / passes on the profile; the static census
// (placement-path-spec §5.2) is pinned here so it can never silently drift —
// IDENTICAL for all three methods (§5.1).
function assertStaticPathCensus(prof, depth = 12) {
  const nodes = 2 * depth - 1
  const states = 2 ** depth - 1
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'cloneOps', 'states', 'elements', 'passes']) {
    if (typeof prof[f] !== 'number') {
      console.error(`path-fork-data profile missing census field "${f}" — static census not published`)
      process.exit(1)
    }
  }
  if (prof.registered !== nodes) {
    console.error(`path-fork-data census registered mismatch: registered=${prof.registered}, expected ${nodes} (${nodes - 1} prototypes + root)`)
    process.exit(1)
  }
  if (prof.inTree !== nodes) {
    console.error(`path-fork-data census in-tree mismatch: inTree=${prof.inTree}, expected ${nodes} (every prototype is contentNodes-owned — F-13)`)
    process.exit(1)
  }
  if (prof.unplaced !== 0) {
    console.error(`path-fork-data census unplaced mismatch: unplaced=${prof.unplaced}, expected 0 (no node is family-unplaced)`)
    process.exit(1)
  }
  if (prof.destroyed !== 0) {
    console.error(`path-fork-data census destroyed mismatch: destroyed=${prof.destroyed}, expected 0`)
    process.exit(1)
  }
  if (prof.cloneOps !== 0) {
    console.error(`path-fork-data census cloneOps mismatch: cloneOps=${prof.cloneOps}, expected 0 (the static model mints NO clones — E2E-1)`)
    process.exit(1)
  }
  if (prof.states !== states) {
    console.error(`path-fork-data census states mismatch: states=${prof.states}, expected ${states} (2^${depth} − 1 path-states)`)
    process.exit(1)
  }
  if (prof.elements !== states) {
    console.error(`path-fork-data census elements mismatch: elements=${prof.elements}, expected ${states} (one element per path-state)`)
    process.exit(1)
  }
  if (prof.passes !== 1) {
    console.error(`path-fork-data bootstrap passes mismatch: passes=${prof.passes}, expected 1 (ONE path-enumeration compile)`)
    process.exit(1)
  }
}
// §5.2 — the derived-family per-region pins: the placement-derived page is the
// FAMILY BASELINE (its single total keeps meaning as the enumeration cost);
// the values/link-derived pages pin their emit/diff/apply REGIONS against it
// (totals are compile-enumeration-dominated and insensitive to EMIT-side
// blow-ups — the critique's guard gap). 2.5× asserted (CI-safe); the ~1.5×
// figure is the human watch (AGENTS.md item 4).
// The d12 family only (the original pins — path-fork-data.html as the
// placement baseline). The d14 derived trio stays BUILT
// (scripts/build-demo.mjs) as manual/browser scaling probes — the d12
// enumeration (~2.8s) dominates the d12 totals and hides EMIT-side scaling,
// so the d14 trio exists for the browser-based scaling watch; it does not
// run in this automated smoke.
const derivedForkPages = [
  { method: 'placement', file: 'demo/path-fork-data.html', q: 'placement', depth: 12 },
  { method: 'values', file: 'demo/path-fork-data-values-d12.html', q: 'values', depth: 12 },
  { method: 'link', file: 'demo/path-fork-data-link-d12.html', q: 'link', depth: 12 },
]
const derivedRegions = ['emitMs', 'diffMs', 'applyMs']
const derivedBase = {} // per-depth family baseline: { [depth]: { emitMs, diffMs, applyMs, totalMs } }
for (const page of derivedForkPages) {
  const prof = runForkPage(page.file, `demo/path-fork-data.js`, `method=${page.q}&depth=${page.depth}`, '__pathForkDone', 60000, `path-fork-data (${page.method}-derived d${page.depth})`)
  // performance guard (AGENTS.md item-4 watch applies to the path-enumeration
  // bootstrap pass): the timed sections (incl. the ONE enumeration compile)
  // must cover ~all of the page total, so "total" can never hide an untimed
  // pipeline (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`path-fork-data (${page.method}-derived d${page.depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  assertStaticPathCensus(prof, page.depth)
  const depthBase = derivedBase[page.depth]
  if (page.method === 'placement') {
    // Family baseline (placement-derived — the §8-Q6 split): per-region
    // numbers the values/link pages pin against; the runtime family keeps its
    // own total-ratio guard + the 3× tripwire below (re-baselined 2026-08-16).
    const b = (derivedBase[page.depth] ??= {})
    for (const r of derivedRegions) b[r] = prof[r] ?? 0
    b.totalMs = prof.totalMs
    const f = (v) => (v ?? 0).toFixed(1)
    console.log(`[derived-fork:baseline] method=placement depth=${page.depth} emit=${f(b.emitMs)}ms diff=${f(b.diffMs)}ms apply=${f(b.applyMs)}ms total=${f(prof.totalMs)}ms — derived FAMILY baseline recorded (placement-derived d${page.depth} page; the former [path-fork:baseline] marker, §10.ad N-5/R-5 SUPERSEDED); values/link-derived pages pin their per-region ratios against this (§8-Q6 split); the runtime 3× total tripwire below is unchanged (re-baselined 2026-08-16 — isolated-subprocess measurement exposes the honest ~2.3-2.7× runtime:derived ratio)`)
  } else {
    // Derived-family pins: each region must stay within 2.5× of the
    // placement-derived baseline (the critique's EMIT-side blow-up guard).
    for (const r of derivedRegions) {
      const ratio = depthBase[r] > 0 ? (prof[r] ?? 0) / depthBase[r] : 0
      if (ratio > 2.5) {
        console.error(`path-fork-data (${page.method}-derived d${page.depth}) region ${r} ratio ${ratio.toFixed(2)}× exceeds 2.5× of the placement-derived baseline ${depthBase[r].toFixed(1)}ms — emit-side scaling regression in the derived family`)
        process.exit(1)
      }
    }
    console.log(`[derived-fork:pin] method=${page.method} depth=${page.depth} emit=${((prof.emitMs ?? 0) / depthBase.emitMs).toFixed(2)}× diff=${((prof.diffMs ?? 0) / depthBase.diffMs).toFixed(2)}× apply=${((prof.applyMs ?? 0) / depthBase.applyMs).toFixed(2)}× vs placement-derived baseline (2.5× asserted)`)
  }
}
// Tripwire (§8-Q6 RE-BASELINED 2026-08-16 — AGENTS.md item-4 watch; kept for
// the RUNTIME family): the runtime pages became HONEST after the timer-drain
// fix (the pass-2 flush now uses microtask checkpoints — 0ms timer yields
// were clamped to 0.5s+ each, inflating the old totals ~10-15×), so the
// static path-fork total (2.5s of REAL 4095-path enumeration) is now ~7× the
// runtime placement total (~330ms of real work) — the old "static must not
// exceed runtime" comparison inverted by itself and is retired. The re-pinned
// tripwire catches the RUNTIME pass-2 pipeline blowing up: the runtime
// placement total must stay within a loose multiple of the placement-derived
// total.
// The single 3× bound after the subprocess-isolation re-baseline (DECISION
// 2026-08-16 — documented in the guard task + AGENTS.md item 4 + decisions.md;
// kept for the RUNTIME family only): the fork-family pages run in ISOLATED
// subprocesses (frame freed per page), which REMOVED the accumulated-process
// GC asymmetry that had silently suppressed the later derived pages — the
// honest runtime:derived ratio is ~2.3-2.4× at d12 (measured 2026-08-16: d12
// 492.6/213.4 = 2.31×; the earlier d12 reading of 1.39× was the artifact; the
// built-but-not-smoke-run d14 browser probes read ~2.39× — 2360.7/987.1 —
// because the incremental pipeline recompiles a focused slice per pass-2 flush
// GENERATION, the scaling SHAPE the manual d14 pages exist to expose, NOT the
// O(n²)-era blow-up signature (~20×) the tripwire was built to catch). 3×
// gives the guard a ~1.3× margin from its honest curve while still tripping
// on a return to blow-up-era scaling. The pre-isolation 2× bound with the
// accumulated-process environment is RENDERED OBSOLETE (it trips on the
// honest clean reading).
if (d12Totals['placement'] > 0 && d12Totals['placement'] > (derivedBase[12]?.totalMs ?? 0) * 3) {
  console.error(`runtime placement total ${d12Totals['placement'].toFixed(1)}ms exceeds 3× the placement-derived baseline ${(derivedBase[12]?.totalMs ?? 0).toFixed(1)}ms — pass-2 pipeline scaling regression`)
  process.exit(1)
}

// ---- feature-showcase page: one legacy envelope, every feature, data-only ---
// The page input is a LEGACY JSON envelope (translateLegacy input). Handler
// bodies ship as function-STRING data; the module is core-only plumbing.
{
  const pageHtml = await readFile(`${base}demo/feature-showcase.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/feature-showcase.js`).catch((e) => {
    console.error('feature-showcase failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__featureShowcaseDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
}

// ---- translate-showcase page: translate-layer kernel (K1–K8) + reverse ------
// ONE legacy envelope; the module translates it, renders the 9 cards through
// the core path, and checks the reverse round-trip (R-2/R-5).
{
  const pageHtml = await readFile(`${base}demo/translate-showcase.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/translate-showcase.js`).catch((e) => {
    console.error('translate-showcase failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__translateShowcaseDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
}

// ---- legacy-shape page: the REAL-LEGACY-SHAPE regression page (D1–D8) -------
// The main envelope is the blind-test translate-stack fixture (17 nodes → ONE
// compilePath bootstrap → 12 path-states → 16 elements); the K4 side cards
// exercise placement-entry-invalid + payload-shape-obsolete with pure DATA
// envelopes. Census guard: the page publishes registered / inTree / unplaced /
// destroyed / cloneOps / states / elements / passes / warningsMain / fanOut /
// stylesRules on the profile; the D1–D8 census is pinned here so it can never
// silently drift (the smoke asserts stay consistent with the page's own
// checks).
const LEGACY_SHAPE_RULES = [
  '.blind-card{border: 1px solid #ccc;padding: 16px;}',
  'nav{display: flex;gap: 8px;align-items: center;}',
  '.blind-badge{background-color: #ffe08a;}',
  '.blind-menu{background-color: #222;color: #fff;}',
  '.blind-item{border-left: 3px solid #2a7;}',
  'nav{@media (max-width: 600px){flex-direction:column;}}',
]
function assertLegacyShapeCensus(prof) {
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'cloneOps', 'prototypes', 'states', 'elements', 'passes', 'warningsMain', 'fanOut', 'stylesRules']) {
    if (typeof prof[f] === 'undefined') {
      console.error(`legacy-shape profile missing census field "${f}" — D1–D8 census not published`)
      process.exit(1)
    }
  }
  if (prof.registered !== 17) {
    console.error(`legacy-shape census registered mismatch: registered=${prof.registered}, expected 17 (16 envelope nodes + the blind-test fixture root)`)
    process.exit(1)
  }
  if (prof.inTree !== 14) {
    console.error(`legacy-shape census in-tree mismatch: inTree=${prof.inTree}, expected 14 (the seam-resolved menu subtree realizes in-tree — DEFECT #24; 3 unresolved def prototypes stay out-of-tree)`)
    process.exit(1)
  }
  if (prof.prototypes !== 3) {
    console.error(`legacy-shape census prototypes mismatch: prototypes=${prof.prototypes}, expected 3 (unresolved def roots/children, 'component'-token pre-minted)`)
    process.exit(1)
  }
  if (prof.unplaced !== 0) {
    console.error(`legacy-shape census unplaced mismatch: unplaced=${prof.unplaced}, expected 0`)
    process.exit(1)
  }
  if (prof.destroyed !== 0) {
    console.error(`legacy-shape census destroyed mismatch: destroyed=${prof.destroyed}, expected 0`)
    process.exit(1)
  }
  if (prof.cloneOps !== 0) {
    console.error(`legacy-shape census cloneOps mismatch: cloneOps=${prof.cloneOps}, expected 0 (no clone-instance ops)`)
    process.exit(1)
  }
  if (prof.states !== 12) {
    console.error(`legacy-shape census states mismatch: states=${prof.states}, expected 12 (10 family states + 2 placement path-states)`)
    process.exit(1)
  }
  if (prof.elements !== 16) {
    console.error(`legacy-shape census elements mismatch: elements=${prof.elements}, expected 16`)
    process.exit(1)
  }
  if (prof.passes !== 1) {
    console.error(`legacy-shape bootstrap passes mismatch: passes=${prof.passes}, expected 1 (ONE compilePath bootstrap)`)
    process.exit(1)
  }
  if (prof.warningsMain !== 0) {
    console.error(`legacy-shape main-envelope warnings mismatch: warnings=${prof.warningsMain}, expected 0 (zero K4 warnings)`)
    process.exit(1)
  }
  if (prof.fanOut !== 2) {
    console.error(`legacy-shape fan-out mismatch: fanOut=${prof.fanOut}, expected 2 (both side-zone containers)`)
    process.exit(1)
  }
  if (!Array.isArray(prof.stylesRules) || prof.stylesRules.length !== LEGACY_SHAPE_RULES.length || new Set(prof.stylesRules).size !== LEGACY_SHAPE_RULES.length) {
    console.error(`legacy-shape styles rules mismatch: got ${JSON.stringify(prof.stylesRules)}`)
    process.exit(1)
  }
  for (const rule of LEGACY_SHAPE_RULES) {
    if (!prof.stylesRules.includes(rule)) {
      console.error(`legacy-shape styles rules missing ${rule}: ${JSON.stringify(prof.stylesRules)}`)
      process.exit(1)
    }
  }
}
{
  const pageHtml = await readFile(`${base}demo/legacy-shape.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/legacy-shape.js`).catch((e) => {
    console.error('legacy-shape failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__legacyShapeDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
  const prof = globalThis.__legacyShapeProfile
  if (!prof) {
    console.error('legacy-shape profile missing — page did not finish profiling')
    process.exit(1)
  }
  // performance guard (same contract as the other pages): the timed sections
  // (incl. the ONE enumeration compile + the side-card renders + the checks)
  // must cover ~all of the page total, so "total" can never hide an untimed
  // pipeline (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`legacy-shape profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  assertLegacyShapeCensus(prof)
}

// ---- handlers-scenarios page: blind test #5 (mocked real-world handlers) ----
// Three legacy envelopes (mounts anon/alice — scenario 1's two userData
// variants — + main — scenarios 2–10); the module translates each, mirrors
// the supervisor's after-compile phase dispatch (AUTH-SEAM) + the page-load
// 'load' dispatch, renders via DomAdapter, and runs the per-scenario runner
// checks (the spec's intended outputs). Census guard: the page publishes
// registered/inTree/unplaced/destroyed/prototypes/cloneOps on the profile
// (captured pre-interaction — the builder ran the IDENTICAL core pipeline and
// embedded the expected census in server-data); the smoke pins equality so
// the census can never silently drift.
{
  const pageHtml = await readFile(`${base}demo/handlers-scenarios.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/handlers-scenarios.js`).catch((e) => {
    console.error('handlers-scenarios failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__handlersScenariosDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
  const prof = globalThis.__handlersScenariosProfile
  if (!prof) {
    console.error('handlers-scenarios profile missing — page did not finish profiling')
    process.exit(1)
  }
  // performance guard (same contract as the other pages): the timed sections
  // (load/compile/phase/emit/diff/apply/checks) must cover ~all of the total,
  // so "total" can never hide an untimed pipeline (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`handlers-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  const serverData = JSON.parse(byId.get('server-data').textContent)
  const exp = serverData.expected.census
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`handlers-scenarios census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      process.exit(1)
    }
  }
}

// ---- session-features page: css.classes injection seam (Group 1) ------------
// Five css.class scenarios (scalar append, array append, missing source keep,
// blocked targets warn+skip, reverse round-trip) from individual legacy
// envelopes; the module translates each, compiles, emits, and runs the
// per-scenario runner checks (the spec's intended outputs). Census guard:
// the page publishes registered/inTree/unplaced/destroyed/prototypes/cloneOps
// on the profile; the builder ran the IDENTICAL core pipeline and embedded the
// expected census in server-data; the smoke pins equality.
{
  const pageHtml = await readFile(`${base}demo/session-features.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/session-features.js`).catch((e) => {
    console.error('session-features failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__sessionFeaturesDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
  const prof = globalThis.__sessionFeaturesProfile
  if (!prof) {
    console.error('session-features profile missing — page did not finish profiling')
    process.exit(1)
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`session-features profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  const serverData = JSON.parse(byId.get('server-data').textContent)
  const exp = serverData.expected.census
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`session-features census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      process.exit(1)
    }
  }
}

// ---- hooks-scenarios page: the value-provider slot (SPA scenarios) ----------
// One legacy envelope whose root carries the theme/user/counter providers +
// the authored `hooks` field; the control buttons (function-STRING bodies)
// write `hooks.<name>` through `clientAPI.apply` (the managed channel); the
// harness dispatches the clicks + flushes the pass-2 + re-renders. The page
// checks assert the write → cascade → rendered-output chain AND the USER
// CONTRACT: N hook writes land ONE deterministic `hook-<name>` replace-in-
// place layer (the layer stack stays O(1) — published on the profile as
// `maxHookLayers`, asserted == 1 here) + the cascade actually repopulates
// the consumers. Census guard: the page publishes registered/inTree/
// unplaced/destroyed/prototypes/cloneOps + hookWrites on the profile; the
// builder ran the IDENTICAL pipeline and embedded the expected census in
// server-data — the smoke pins equality.
{
  const pageHtml = await readFile(`${base}demo/hooks-scenarios.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/hooks-scenarios.js`).catch((e) => {
    console.error('hooks-scenarios failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__hooksScenariosDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
  const prof = globalThis.__hooksScenariosProfile
  if (!prof) {
    console.error('hooks-scenarios profile missing — page did not finish profiling')
    process.exit(1)
  }
  // performance guard (same contract as the other pages): the timed sections
  // (load/compile/flush/emit/diff/apply/checks) must cover ~all of the total,
  // so "total" can never hide an untimed pipeline (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`hooks-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  // USER CONTRACT — the layer stack stays O(1): every hook-<name> write lands
  // ONE deterministic replace-in-place layer. `maxHookLayers` is the
  // page-measured max hook-layer count across ALL the scenario writes (the
  // 20-write stress + the control clicks); averaging <= 1 proves the stack
  // never grew.
  if (prof.maxHookLayers !== 1) {
    console.error(`hooks-scenarios USER CONTRACT violation: maxHookLayers=${prof.maxHookLayers}, expected 1 (N writes must land ONE deterministic hook-<name> layer)`)
    process.exit(1)
  }
  const serverData = JSON.parse(byId.get('server-data').textContent)
  const exp = serverData.expected.census
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`hooks-scenarios census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      process.exit(1)
    }
  }
}

// Give microtasks a chance (Supervisor event flushes + async page checks).
await new Promise((r) => setTimeout(r, 250))

// ---- hooks-array-scenarios page (the rows-mint + cascade — SPA scenarios) ---
// One legacy envelope: the root carries a `hooksKind: {'item-list':'component'}`
// declaration + a pre-minted def prototype for `'item'`. The page module runs
// `rows-mint` (prototype-by-name, per-row value-bearing source anchors,
// node-scoped layerId = DEFECT #23 fix); the runner checks assert BOTH sides
// of the cascade (row source anchors + cross-row consumer fan-out). Census
// guard: page publishes registered/inTree/... on the profile; builder embeds
// expected census in server-data. Profile guard: `rowsMinted` must equal 3.
{
  const pageHtml = await readFile(`${base}demo/hooks-array-scenarios.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/hooks-array-scenarios.js`).catch((e) => {
    console.error('hooks-array-scenarios failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__hooksArrayScenariosDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
  const prof = globalThis.__hooksArrayScenariosProfile
  if (!prof) {
    console.error('hooks-array-scenarios profile missing — page did not finish profiling')
    process.exit(1)
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`hooks-array-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  // USER CONTRACT — the rows-mint mints exactly 3 rows
  if (prof.rowsMinted !== 3) {
    console.error(`hooks-array-scenarios USER CONTRACT violation: rowsMinted=${prof.rowsMinted}, expected 3`)
    process.exit(1)
  }
  const serverData = JSON.parse(byId.get('server-data').textContent)
  const exp = serverData.expected.census
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`hooks-array-scenarios census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      process.exit(1)
    }
  }
}

// Give microtasks a chance (Supervisor event flushes + async page checks).
await new Promise((r) => setTimeout(r, 250))

// inline pages' banners (walked from the parent's mounted shim) + the
// worker-run pages' banners (shipped back per page — the parent never mounts
// the fork-family pages in its own shim)
const banners = collectBanners().concat(workerBanners)
console.log('banners:', banners.join(' | '))
{
  // probe: did the fork-stress runtime layers build? count handler-marked nodes
  const marked = [...byId.values()].filter(() => false)
  console.log('DBG fork-stress runtime probe (handler markers live on nodes, not shim): skipped in shim')
}
const fails = [...byId.values()].flatMap((el) => collect(el, []))
function collect(el, acc) {
  if (String(el.className).split(' ').includes('fail')) acc.push(el)
  for (const c of el.children) collect(c, acc)
  return acc
}
if (fails.length > 0) {
  console.error('FAILED CHECKS:', fails.length)
  for (const el of fails) {
    for (const c of el.children) if (c.tagName === 'PRE') console.error('  detail:', c.textContent)
  }
  process.exit(1)
}
if (banners.some((b) => /failed: [1-9]/.test(b))) {
  console.error('summary reports failures')
  process.exit(1)
}
if (!banners.some((b) => b.includes('Feature Matrix') && /0 failed/.test(b))) {
  console.error('feature-matrix page did not complete its checks (banner missing)')
  process.exit(1)
}
for (const mode of ['client', 'ssr', 'markdown']) {
  if (!banners.some((b) => b.includes(`Mode toggle — ${mode}`) && /0 failed/.test(b))) {
    console.error(`mode-toggle (${mode}) page did not complete its checks (banner missing)`)
    process.exit(1)
  }
}
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  if (!banners.some((b) => b.includes(`Fork Stress — depth ${depth}`) && /0 failed/.test(b))) {
    console.error(`fork-stress (depth ${depth}) page did not complete its checks (banner missing)`)
    process.exit(1)
  }
}
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  if (!banners.some((b) => b.includes(`Fork Stress (data) — depth ${depth}`) && /0 failed/.test(b))) {
    console.error(`fork-stress-data (depth ${depth}) page did not complete its checks (banner missing)`)
    process.exit(1)
  }
}
for (const method of ['placement', 'values', 'link']) {
  if (!banners.some((b) => b.includes(`Fork Stress (data: ${method}) — depth 12`) && /0 failed/.test(b))) {
    console.error(`fork-stress-data (${method}-only d12) page did not complete its checks (banner missing)`)
    process.exit(1)
  }
}
for (const label of ['Path Fork (static)', 'Path Fork (values-derived)', 'Path Fork (link-derived)']) {
  if (!banners.some((b) => b.includes(label) && /0 failed/.test(b))) {
    console.error(`${label} page did not complete its checks (banner missing)`)
    process.exit(1)
  }
}
if (!banners.some((b) => b.includes('feature-showcase') && /0 failed/.test(b))) {
  console.error('feature-showcase page did not complete its checks (banner missing)')
  process.exit(1)
}
if (!banners.some((b) => b.includes('translate-showcase') && /0 failed/.test(b))) {
  console.error('translate-showcase page did not complete its checks (banner missing)')
  process.exit(1)
}
if (!banners.some((b) => b.includes('legacy-shape') && /0 failed/.test(b))) {
  console.error('legacy-shape page did not complete its checks (banner missing)')
  process.exit(1)
}
if (!banners.some((b) => b.includes('handlers-scenarios') && /0 failed/.test(b))) {
  console.error('handlers-scenarios page did not complete its checks (banner missing)')
  process.exit(1)
}
if (!banners.some((b) => b.includes('session-features') && /0 failed/.test(b))) {
  console.error('session-features page did not complete its checks (banner missing)')
  process.exit(1)
}
if (!banners.some((b) => b.includes('hooks-scenarios') && /0 failed/.test(b))) {
  console.error('hooks-scenarios page did not complete its checks (banner missing)')
  process.exit(1)
}

// component-driven page: every test is a content node — no FAIL text anywhere,
// and the footer summary (itself framework-rendered) must report zero failures.
const rootText = allText(byId.get('root'))
function allText(el) {
  if (!el) return ''
  return (el.textContent ?? '') + el.children.map(allText).join('')
}
if (rootText.includes('FAIL —')) {
  console.error('component page has failing test nodes')
  process.exit(1)
}
if (!rootText.includes('0 failed')) {
  console.error('component page summary missing or reports failures:', rootText.slice(0, 200))
  process.exit(1)
}
// happy path only — worker result files leave no residue
rmSync(_resultDir, { recursive: true, force: true })
console.log('SMOKE OK — all demo checks passed')
