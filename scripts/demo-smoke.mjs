// Headless smoke test: run the demo modules against a minimal DOM shim and
// assert every check passes (the same assertions the browser pages show).

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.attrs = {}
    this.dataset = {}
    this.style = {}
    this.listeners = {}
    this.textContent = ''
    this.className = ''
    this.id = ''
    this.value = ''
    this._innerHTML = ''
  }

  /** Real-DOM `children` is an HTMLCollection: indexable + .length + .item(),
   *  but NO .map/.filter — the harness must always Array.from() it. The shim
   *  mirrors that when globalThis.REAL_DOM_CHILDREN is set (regression guard:
   *  demo/lib/feature-matrix-tests.js and demo components must not rely on
   *  array methods on .children). */
  get htmlCollectionChildren() {
    const arr = this.children
    const col = []
    for (let i = 0; i < arr.length; i++) col[i] = arr[i]
    col.length = arr.length
    col.item = (i) => arr[i] ?? null
    return col
  }
  set innerHTML(v) {
    this._innerHTML = String(v)
  }
  get innerHTML() {
    return this._innerHTML
  }
  appendChild(c) {
    // real-DOM move semantics: re-appending an already-present child relocates
    // it (diffMinimal re-appends every child in order on each render)
    const i = this.children.indexOf(c)
    if (i !== -1) this.children.splice(i, 1)
    this.children.push(c)
    c.parent = this
    return c
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v)
  }
  getAttribute(k) {
    return this.attrs[k] ?? null
  }
  addEventListener(evt, fn) {
    ;(this.listeners[evt] ??= []).push(fn)
  }
  remove() {
    this.removed = true
    if (this.parent) {
      const i = this.parent.children.indexOf(this)
      if (i !== -1) this.parent.children.splice(i, 1)
      this.parent = null
    }
  }
}

// Wrap: when REAL_DOM_CHILDREN is set, document.getElementById/createElement
// return proxies whose `.children` is an HTMLCollection-like (no array methods).
function wrapEl(el) {
  return new Proxy(el, {
    get(t, k) {
      if (k === 'children' && globalThis.REAL_DOM_CHILDREN) return t.htmlCollectionChildren
      return t[k]
    },
  })
}

const byId = new Map()
const document = {
  createElement: (tag) => wrapEl(new El(tag)),
  getElementById: (id) => {
    if (!byId.has(id)) byId.set(id, new El('div'))
    return wrapEl(byId.get(id))
  },
  head: { appendChild: () => {} },
}

const g = globalThis
g.document = document
g.window = g

const { fileURLToPath } = await import('node:url')
const base = fileURLToPath(new URL('..', import.meta.url))

// Seed the framework input data embedded in the generated pages
// (scripts/build-demo.mjs must run before this script).
const { readFile } = await import('node:fs/promises')
const { buildModeTogglePage } = await import('./mode-toggle-page.mjs')
const ssrHtml = await readFile(`${base}demo/ssr-render.html`, 'utf8')
const compHtml = await readFile(`${base}demo/components.html`, 'utf8')
function extractScript(html, id) {
  const m = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`))
  if (!m) throw new Error(`missing <script id="${id}"> in the generated demo HTML — run npm run demo:build && node scripts/build-demo.mjs first`)
  return m[1].trim()
}
function seedPage(html) {
  byId.set('preempt-initial-data', Object.assign(new El('script'), { textContent: extractScript(html, 'preempt-initial-data') }))
  byId.set('server-data', Object.assign(new El('script'), { textContent: extractScript(html, 'server-data') }))
}
/** Seed a raw text element (script[type=text/plain] / pre) by id — used by the
 *  mode-toggle page for its SSR-received HTML and raw markdown source. */
function seedRawText(html, tag, id) {
  const m = html.match(new RegExp(`<${tag} id="${id}"[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  if (!m) throw new Error(`missing <${tag} id="${id}"> in the generated demo HTML`)
  byId.set(id, Object.assign(new El(tag), { textContent: m[1].trim() }))
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
// from server-data and drives the runtime layers (L4..depth).
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  const pageHtml = await readFile(`${base}demo/fork-stress-d${depth}.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/fork-stress.js?depth=${depth}`).catch((e) => {
    console.error(`fork-stress (depth ${depth}) failed:`, e)
    process.exit(1)
  })
  // each page finishes asynchronously (deep pages exceed the generic settle)
  await Promise.race([
    globalThis.__forkStressDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
  // performance-tracking guard (same contract as the data pages): the timed
  // sections (incl. pass2 flush windows, page-side construction, handler
  // bodies) must cover ~all of the total; appends counts the diffMinimal
  // append ops — the DOM-churn proxy the shim cannot time (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md "imperative fork-stress").
  const prof = globalThis.__forkStressProfile
  if (!prof) {
    console.error(`fork-stress (depth ${depth}) profile missing — page did not finish profiling`)
    process.exit(1)
  }
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
  const pageHtml = await readFile(`${base}demo/fork-stress-data-d${depth}.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/fork-stress-data.js?depth=${depth}`).catch((e) => {
    console.error(`fork-stress-data (depth ${depth}) failed:`, e)
    process.exit(1)
  })
  // each page finishes asynchronously (deep pages exceed the generic settle)
  await Promise.race([
    globalThis.__forkStressDataDone,
    new Promise((r) => setTimeout(r, 30000)),
  ]).catch(() => {})
  // performance-tracking guard (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md "missing
  // timing steps"): the timed sections must cover ~all of the page total, so
  // "total" can never hide an unmeasured pipeline again. The residual is the
  // flush timers + checks; a regression that balloons the pass-2 region while
  // measured sections stay small now fails HERE instead of hiding in total.
  const prof = globalThis.__forkStressDataProfile
  if (!prof) {
    console.error(`fork-stress-data (depth ${depth}) profile missing — page did not finish profiling`)
    process.exit(1)
  }
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
// ---- single-method d12 variants (placement-only / values-only / link-only) --
// The whole tree relies on ONE mechanism; the module re-instantiates per page.
const d12Totals = {}
for (const method of ['placement', 'values', 'link']) {
  const pageHtml = await readFile(`${base}demo/fork-stress-data-${method}-d12.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/fork-stress-data.js?method=${method}`).catch((e) => {
    console.error(`fork-stress-data (${method}-only d12) failed:`, e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__forkStressDataDone,
    new Promise((r) => setTimeout(r, 60000)),
  ]).catch(() => {})
  const prof = globalThis.__forkStressDataProfile
  if (!prof) {
    console.error(`fork-stress-data (${method}-only d12) profile missing`)
    process.exit(1)
  }
  const residual = prof.totalMs - (prof.coveredMs ?? 0)
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`fork-stress-data (${method}-only d12) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms`)
    process.exit(1)
  }
  assertForkStressCensus(prof, 12, `fork-stress-data (${method}-only d12)`)
  d12Totals[method] = prof.totalMs
}
// d12 ratio guard (AGENTS.md item 4, promoted from manual to asserted): the
// values/link totals must stay within a loose multiple of the placement
// baseline — the historical O(n²) pass-2 regression showed as ~20×, so 2.5×
// is a generous CI-safe bound that still catches pipeline blow-ups.
const d12Base = d12Totals['placement'] ?? 0
for (const method of ['values', 'link']) {
  const ratio = d12Base > 0 ? (d12Totals[method] ?? 0) / d12Base : 0
  if (ratio > 2.5) {
    console.error(`fork-stress-data (${method}-only d12) total ratio ${ratio.toFixed(2)}× exceeds 2.5× of placement (${d12Totals[method]}ms vs ${d12Base}ms)`)
    process.exit(1)
  }
}

// ---- static placement-path page: 22 prototypes, ONE path-enumeration pass ----
// The static re-expression (placement-path-spec §5): translate → ONE
// compilePath bootstrap → emit/diff/apply. NO clone-instance ops, NO
// after-compile expansion — 4095 path-states from 23 graph nodes (E2E-1).
// Census guard: the page publishes registered / inTree / unplaced / destroyed
// / cloneOps / states / elements / passes on the profile; the static census
// (placement-path-spec §5.2) is pinned here so it can never silently drift.
function assertStaticPathCensus(prof) {
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'cloneOps', 'states', 'elements', 'passes']) {
    if (typeof prof[f] !== 'number') {
      console.error(`path-fork-data profile missing census field "${f}" — static census not published`)
      process.exit(1)
    }
  }
  if (prof.registered !== 23) {
    console.error(`path-fork-data census registered mismatch: registered=${prof.registered}, expected 23 (22 prototypes + root)`)
    process.exit(1)
  }
  if (prof.inTree !== 23) {
    console.error(`path-fork-data census in-tree mismatch: inTree=${prof.inTree}, expected 23 (every prototype is contentNodes-owned — F-13)`)
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
  if (prof.states !== 4095) {
    console.error(`path-fork-data census states mismatch: states=${prof.states}, expected 4095 (2^12 − 1 path-states)`)
    process.exit(1)
  }
  if (prof.elements !== 4095) {
    console.error(`path-fork-data census elements mismatch: elements=${prof.elements}, expected 4095 (one element per path-state)`)
    process.exit(1)
  }
  if (prof.passes !== 1) {
    console.error(`path-fork-data bootstrap passes mismatch: passes=${prof.passes}, expected 1 (ONE path-enumeration compile)`)
    process.exit(1)
  }
}
{
  const pageHtml = await readFile(`${base}demo/path-fork-data.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/path-fork-data.js`).catch((e) => {
    console.error('path-fork-data failed:', e)
    process.exit(1)
  })
  await Promise.race([
    globalThis.__pathForkDone,
    new Promise((r) => setTimeout(r, 60000)),
  ]).catch(() => {})
  const prof = globalThis.__pathForkProfile
  if (!prof) {
    console.error('path-fork-data profile missing — page did not finish profiling')
    process.exit(1)
  }
  // performance guard (AGENTS.md item-4 watch applies to the path-enumeration
  // bootstrap pass): the timed sections (incl. the ONE enumeration compile)
  // must cover ~all of the page total, so "total" can never hide an untimed
  // pipeline (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`path-fork-data profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    process.exit(1)
  }
  assertStaticPathCensus(prof)
  // Ratio guard — placement-baseline decision (placement-path-spec §10.ad N-5
  // + §8 Q6): the static page is its OWN reference — its single total is the
  // new placement baseline for the static model. TODO: after testing confirms
  // the absence of explosive time issues, re-baseline the runtime pages'
  // ratio guard against this total (§10.af Q6). The runtime pages KEEP their
  // existing placement baseline above.
  const pathForkTotal = prof.totalMs
  console.log(`[path-fork:baseline] total=${pathForkTotal.toFixed(1)}ms — static placement baseline recorded (§10.ad); TODO: re-baseline the runtime ratio guard against it after testing confirms no explosive time issues (§10.af Q6)`)
  // Tripwire (spec §10.af.4 R-6): the single-pass enumeration must not be
  // SLOWER than the runtime page's full clone assembly — a blow-up here means
  // the path-enumeration bootstrap is scaling badly (AGENTS.md item-4 watch).
  if (d12Totals['placement'] > 0 && pathForkTotal > d12Totals['placement']) {
    console.error(`path-fork-data total ${pathForkTotal.toFixed(1)}ms exceeds the runtime placement baseline ${d12Totals['placement'].toFixed(1)}ms — path-enumeration bootstrap scaling regression`)
    process.exit(1)
  }
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
  if (prof.inTree !== 11) {
    console.error(`legacy-shape census in-tree mismatch: inTree=${prof.inTree}, expected 11 (the 6 def prototypes stay OUT-OF-TREE — D8/F16)`)
    process.exit(1)
  }
  if (prof.prototypes !== 6) {
    console.error(`legacy-shape census prototypes mismatch: prototypes=${prof.prototypes}, expected 6 (def roots + children, 'component'-token pre-minted)`)
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

// Give microtasks a chance (Supervisor event flushes + async page checks).
await new Promise((r) => setTimeout(r, 250))

const banners = [...byId.values()].flatMap((el) => walk(el, []))
function walk(el, acc) {
  if (el.className === 'runner-banner' || (el.textContent && el.textContent.includes('passed'))) {
    acc.push(el.textContent)
  }
  for (const c of el.children) walk(c, acc)
  return acc
}
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
if (!banners.some((b) => b.includes('Path Fork (static)') && /0 failed/.test(b))) {
  console.error('path-fork-data page did not complete its checks (banner missing)')
  process.exit(1)
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
console.log('SMOKE OK — all demo checks passed')
