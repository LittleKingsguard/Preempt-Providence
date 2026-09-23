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
// The static derived-family page builder — imported HERE, before the smoke shim
// installs `document`: `scripts/path-fork-page.mjs` imports the page module
// (`demo/path-fork-data.js`) for its builder, and that page module runs its
// browser block whenever `document` exists (parsing the seeded page JSON at
// import time). Without a seeded envelope that import throws, so the builder is
// loaded while the process is still DOM-less; the `derived-fork-shallow-census`
// guard later imports the page module itself with a REAL seeded page.
import { buildPathForkPage } from './path-fork-page.mjs'

const { byId, seedPage, seedRawText, extractScript, collectBanners } = installSmokeShim()

// ============================================================================
// §4 GUARD REACHABILITY — ONE GUARD PER `process.exit`
// (docs/specs/no-clone-invariants.md §4; shape (a) + (b) combined)
//
// THE DEFECT THIS FIXES: the runtime 3× tripwire `process.exit(1)`s BELOW, and
// the legacy-shape census block sat AFTER it — so on any run where the tripwire
// fired (it then fired on EVERY run: the honest d12 runtime:derived ratio is
// ~8-11× vs the 3× bound, which is why the USER'S 2026-09-23 RULING retired that
// assertion — see the growth-guard block below), the harness's ONLY
// component-family clone census never ran at all. The guard's own "census not
// published" message was dead text.
//
// THE SHAPE IMPLEMENTED — (a) every census/assertion guard RUNS before the
// exit-capable assertion + (b) a SINGLE AGGREGATED EXIT at the end:
//   * every guard emits an ordered ENTRY line `[smoke-guard:enter] {"id",…}`
//     (the reachability suite's oracle), and one that fails also prints
//     `[smoke-guard:fail] <id>` and re-emits its entry with status `fail`;
//   * a guard failure does NOT abort the run: the guard's body reports the
//     failure and RETURNS (or, where a page worker failed, the loop records it
//     and continues), so every LATER guard still enters and still reports its
//     measurement;
//   * `runGuard` WRAPS the body in a real `try`/`catch`: a throwing body (a page
//     import that throws, a malformed profile, a worker that never came back)
//     records a guard failure and the run CONTINUES to the next guard — the
//     wrapper returns the HANDLED promise, never the raw one, so a body
//     rejection can never reject the top level and abort the aggregation;
//   * EVERY page block, banner check and assertion block is a guard body, so no
//     block can short-circuit the aggregate;
//   * `process.exit` appears EXACTLY ONCE, inside `guardAggregateExit` — the
//     `guard-exit-audit` guard below reads this file's own source and FAILS if a
//     second site is introduced (a raw exit bypasses the aggregation and is the
//     §4 defect class this unit exists to close);
//   * the run exits NON-ZERO at the very end when any guard failed
//     (`guardAggregateExit`) — an aggregation change, NEVER a suppression.
//   NO OTHER BOUND IS MOVED by any of this — the 2.5× derived pins, the
//   derived in-family totals pin, the residual/coverage guards and the census
//   guards (incl. the shallow-census and the no-clone pins) assert exactly what
//   they asserted before. The ONE guard that DID change (2026-09-23) is the
//   runtime scaling signal: the user replaced the failing 3× cross-family
//   tripwire with the runtime-vs-runtime growth guard (see its block below).
// ============================================================================

/** Ordered guard ids — the entry order is the reachability order. */
const guardIds = []
/** Every guard that entered, in entry order: { id, index, status }. */
const guardEntered = []
/** The guards that failed. */
const guardFailures = []
/** Banner lines produced by page runs that happen OUTSIDE this process's
 *  persistent mounted DOM (the `derived-fork-shallow-census` guard runs several
 *  static-family pages through the shim and restores the accumulated check list
 *  after each one, so their banners are carried here instead — the
 *  `demo-check-banner-census` guard appends these to the collected banners). */
const bannerCensusExtras = []

// ---- the OUTPUT LINE COUNTER (the entry `index` is a LINE index) ----------
// The reachability contract compares an entry's `index` against the LINE INDEX
// of the tripwire marker in the captured output (the test's `markerLineIndex`,
// which is the 0-based position of the marker line), so the index must be on
// that same OUTPUT-LINE scale — and it must be able to FAIL: a guard that really
// sits BEFORE the tripwire must NOT be able to declare an index above the
// marker's position.
//
// NO MARGIN (2026-09-22 audit finding 4 — the former `GUARD_INDEX_MARGIN = 1000`
// made the anti-vacuity clause unfalsifiable: every entry's declared index was
// ~1000 lines ABOVE the marker's position, so even the FIRST guard satisfied
// "positioned after the tripwire" and the clause could never fail). The margin
// existed to absorb worker output that bypassed this counter; the pipe-and-
// re-emit change below put EVERY line — including each worker's whole stdout —
// through this counter, so the drift it compensated for is gone (measured: the
// declared index tracked the real line number to within a line on the full run).
// The declared index is now `smokeLineCount + 1`: the 1-based number of the
// output line the entry is printed on, i.e. the marker's 0-based
// `markerLineIndex + 1` — the same scale, offset by the single documented
// 1-based/0-based difference, which cannot mask a real ordering violation (a
// pre-tripwire guard's index stays below the marker's position + 1, and the
// first post-tripwire guard's index is strictly greater than the marker's
// position — the property the contract reads).
let smokeLineCount = 0
/** Write one output line through the wrapped stdout (counted by the sink). */
function writeCountedLine(line) {
  process.stdout.write(`${line}\n`)
}
const _rawStdoutWrite = process.stdout.write.bind(process.stdout)
const _rawStderrWrite = process.stderr.write.bind(process.stderr)
/** Count the newlines a written chunk contributes, advancing the output-line
 *  counter (its unit is "output lines": a guard's index is a line number on the
 *  captured output's scale). */
const countLines = (chunk) => {
  const text = typeof chunk === 'string' ? chunk : Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk)
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) smokeLineCount += 1
  return smokeLineCount
}
process.stdout.write = (chunk, ...rest) => {
  countLines(chunk)
  _rawStdoutWrite(chunk, ...rest)
  return true
}
process.stderr.write = (chunk, ...rest) => {
  countLines(chunk)
  _rawStderrWrite(chunk, ...rest)
  return true
}

function guardEnter(id, status = 'pass') {
  guardIds.push(id)
  // The entry's `index` is on the OUTPUT-LINE scale: the counter is advanced by
  // exactly the single newline of this write, so it tracks the line the entry is
  // printed on. NO margin (finding 4) — see the counter block above: the ordering
  // property the reachability contract reads must be able to FAIL, and a uniform
  // +1000 offset made every entry look post-tripwire.
  const index = smokeLineCount + 1
  const entry = { id, index, status }
  guardEntered.push(entry)
  writeCountedLine(`[smoke-guard:enter] ${JSON.stringify(entry)}`)
  return { id, index }
}

/** Close an open guard. `status` is the guard's OUTCOME; when the guard failed
 *  (its handler recorded a failure) that recorded status wins, so a deferred
 *  failure can never be silently marked 'pass'. The entry line is re-emitted
 *  with the FINAL status, so a consumer reading the PRINTED log (the reachability
 *  suite parses the printed lines, not this process's memory) sees the outcome
 *  of every guard that entered — including one whose failure was injected or
 *  detected after its entry (the entry line itself is printed on entry, before
 *  the outcome can be known). */
function guardLeave(entry, status = 'pass') {
  if (entry === undefined) return
  const recorded = guardEntered[guardIds.lastIndexOf(entry.id)]
  if (recorded !== undefined) {
    recorded.status = guardFailures.includes(entry.id) ? 'fail' : status
    // The entry line is printed on ENTRY, before the outcome can be known, so a
    // guard that FAILED gets its entry re-emitted with the final status: a log
    // consumer (the reachability suite parses the printed lines) must be able to
    // see WHICH guard failed, not just that something did.
    if (recorded.status === 'fail') writeCountedLine(`[smoke-guard:enter] ${JSON.stringify(recorded)}`)
  }
}

/** Record an open guard's failure (idempotent, prints the fail marker). Called
 *  from the guard bodies themselves (in-guard guard clauses) and from
 *  `runGuard`'s `catch` — so a body that THREW also REPORTS its outcome and the
 *  run continues to the next guard instead of aborting the aggregation. */
function guardLeaveFailed(entry, reason) {
  if (entry !== undefined && !guardFailures.includes(entry.id)) {
    guardFailures.push(entry.id)
    console.error(`[smoke-guard:fail] ${entry.id}${reason ? ` — ${reason}` : ''}`)
  }
}

/** The §4 wrapper: enter `id`, run the guard body, leave it with the outcome.
 *  Every guard runs whether or not an earlier one failed; the exit code
 *  aggregates the failures at the end (`guardAggregateExit`). The body is
 *  awaited (so an async guard body's own `await`s run to completion — the page
 *  blocks MUST stay sequential: they share the shim's `server-data` element) and
 *  is run inside a REAL `try`/`catch`/`finally`, and the wrapper returns the
 *  HANDLED promise (never the raw one): an unhandled body rejection could never
 *  abort the run because `await runGuard(...)` at the top level awaits exactly
 *  this promise. */
async function runGuard(id, body) {
  const entry = guardEnter(id)
  try {
    await body(entry)
  } catch (e) {
    // a throwing body is THIS guard's failure — recorded and reported, never
    // fatal: the later guards still enter and report (§4), and the aggregate
    // exit still ends non-zero.
    guardLeaveFailed(entry, `the guard body threw: ${e && e.message ? e.message : e}`)
  } finally {
    guardLeave(entry)
  }
}

// ---- TEST SEAM (inert unless PP_SMOKE_FAULT names a guard) -----------------
// `PP_SMOKE_FAULT=<guard id>` forces THAT guard to take its own failure path on
// entry, so the reachability contract is drivable: the injected guard shows up
// FAILING in the same entry log while every later guard still enters.
//
// THE SEAM MUST BE PROVABLY EFFECTIVE (audit finding 3): the id is VALIDATED
// against the known guard ids at startup (a typo fails the RUN loudly instead of
// silently no-op'ing), the injection is SINGLE-SHOT (`guardFaultedInjected`, read
// by the second call for the same id), it prints a loud `TEST SEAM ACTIVE`
// banner, and its `[smoke-guard:fail]` line NAMES the injected id plus the
// `PP_SMOKE_FAULT` token — so an injected run is distinguishable from a
// non-injected one (the natural tripwire failure prints no such token).
// It is opt-in by construction: the var is set by the operator/CI, never by this
// script, and an UNKNOWN id is a hard error.
/** The guard id the fault seam injects ('' when unset — inert). */
let faultGuard = typeof process.env.PP_SMOKE_FAULT === 'string' ? process.env.PP_SMOKE_FAULT.trim() : ''
/** Set once the injected fault has FIRED (the seam is single-shot: a second call
 *  for the same id takes the natural path — read by `guardFaulted`). */
let guardFaultedInjected = false

/** Take the injected failure for `id`, if the seam names it — ONCE per run.
 *  Marks the guard FAILED (entry status + `[smoke-guard:fail]` + aggregate).
 *  A NATURALLY-PASSING guard is the meaningful target (a guard that fails on
 *  every run makes the injection unobservable) — the audit's demonstration uses
 *  `fork-stress-census`; the reachability suite's own arm uses
 *  `runtime-fork-growth-guard` (its 3× cross-family predecessor
 *  `runtime-fork-tripwire` was RETIRED by the 2026-09-23 ruling and is no longer
 *  a guard id at all — it survives only as the INFORMATIONAL
 *  `[runtime-fork:tripwire]` print). Both live ids are listed in
 *  `KNOWN_GUARD_IDS` below, and the
 *  injected failure is single-shot: after it fires once,
 *  `guardFaultedInjected` makes every later call (including a later iteration of
 *  the same guard id) take the natural path. */
function guardFaulted(id) {
  if (faultGuard === '' || guardFaultedInjected || id !== faultGuard) return false
  guardFaultedInjected = true
  const entry = guardEntered[guardIds.lastIndexOf(id)]
  if (entry !== undefined) entry.status = 'fail'
  guardFailures.push(id)
  console.log(`[smoke-guard:seam] TEST SEAM ACTIVE — PP_SMOKE_FAULT=${id} injected into guard "${id}" (single-shot; this failure is SYNTHETIC, the guard did not fail naturally). This run is an INJECTED run, not a natural one.`)
  console.error(`[smoke-guard:fail] ${id} (injected by PP_SMOKE_FAULT — the reachability seam; not a natural failure; single-shot)`)
  return true
}
/** The aggregate exit (§4): non-zero when any guard failed, 0 otherwise.
 *  THIS IS THE ONLY `process.exit` SITE IN THIS FILE — the guards' own
 *  immediate-exit paths are gone (each guard body is wrapped in `runGuard`,
 *  which reports the outcome before the aggregate decides the exit code), and
 *  `guard-exit-audit` below asserts this mechanically. */
function guardAggregateExit() {
  if (guardFailures.length > 0) {
    console.error(`smoke guard failures: ${guardFailures.length} (${guardFailures.join(', ')}) — every guard still ran and reported (docs/specs/no-clone-invariants.md §4)`)
    aggregateExitHardFail()
  }
  aggregateExitHardFail()
}

/** The ONE exit site: a non-zero/zero exit code decided by the aggregation. The
 *  `reason` is only for the pre-guard startup failures (an invalid fault id),
 *  which must fail loudly BEFORE any guard runs. */
function aggregateExitHardFail(reason) {
  if (reason) console.error(`[smoke-guard:fail] startup — ${reason}`)
  process.exit(guardFailures.length > 0 ? 1 : 0)
}

// ---- TOP-LEVEL ERROR BACKSTOP (§4 / audit findings 2 and 7) ----------------
// `runGuard` catches every guard body, so an ordinary failure cannot reach the
// top level. This backstop covers the paths that can still throw OUTSIDE a guard
// body (the pre-guard setup: the shim, the generated-page reads, an await of an
// imported module's own top-level work). Such an error must still be RECORDED
// (as the synthetic `harness-top-level` failure) and must NOT abort the run
// before the aggregate exit — so the handler records it, then lets the top-level
// flow finish; the aggregate exit runs at the end of the script as always.
const TOP_LEVEL_GUARD_ID = 'harness-top-level'
let harnessTopLevelArmed = false
const recordTopLevelFailure = (label) => (e) => {
  // armed only while the top-level flow can still continue; once the aggregate
  // exit has run this is inert (an error during exit is not aggregatable).
  if (!harnessTopLevelArmed) return
  const reason = `${label}: ${e && e.message ? e.message : e}`
  console.error(`[smoke-guard:fail] ${TOP_LEVEL_GUARD_ID} — ${reason}`)
  if (!guardFailures.includes(TOP_LEVEL_GUARD_ID)) guardFailures.push(TOP_LEVEL_GUARD_ID)
}
process.on('uncaughtException', recordTopLevelFailure('uncaught exception outside a guard'))
process.on('unhandledRejection', recordTopLevelFailure('unhandled rejection outside a guard'))

// ---- THE KNOWN GUARD IDS (the fault seam's validation set, audit finding 3) --
// `PP_SMOKE_FAULT` must name one of these: an unknown id (a typo, a stale name)
// is a HARD STARTUP ERROR, never a silent no-op that makes the fault-injection
// arm vacuous. Keep this list in step with the `runGuard` call sites (the
// `guard-exit-audit` guard cross-checks BOTH directions on every run: an id
// missing here, or an id here with no call site, fails).
const MODE_TOGGLE_MODES = ['client', 'ssr', 'markdown']
const KNOWN_GUARD_IDS = [
  'guard-exit-audit',
  'ssr-render-page',
  'components-page',
  'loop-safety-page',
  'feature-matrix-page',
  'mode-toggle-page-client',
  'mode-toggle-page-ssr',
  'mode-toggle-page-markdown',
  'runtime-fork-stress-census',
  'fork-stress-census',
  'fork-stress-variant-census',
  'static-path-census',
  'derived-fork-shallow-census',
  'runtime-fork-growth-guard',
  'feature-showcase-page',
  'translate-showcase-page',
  'legacy-shape-census',
  'handlers-scenarios-census',
  'session-features-census',
  'producing-host-census',
  'hooks-scenarios-census',
  'hooks-array-scenarios-census',
  'rows-scenarios-census',
  'journal-condensing-scenarios-page',
  'preserve-reversal-scenarios-page',
  'markdown-adapter-scenarios-page',
  'demo-check-banner-census',
]
harnessTopLevelArmed = true
if (faultGuard !== '' && !KNOWN_GUARD_IDS.includes(faultGuard)) {
  harnessTopLevelArmed = false
  console.error(`[smoke-guard:seam] PP_SMOKE_FAULT="${faultGuard}" is not a known guard id — the fault seam would silently no-op, so this run is FAILING instead. Known ids: ${KNOWN_GUARD_IDS.join(', ')}`)
  guardFailures.push('PP_SMOKE_FAULT-id-invalid')
  console.error(`[smoke-guard:fail] PP_SMOKE_FAULT-id-invalid — an unknown fault id must fail loudly, never silently no-op`)
  guardAggregateExit()
} else if (faultGuard !== '') {
  console.log(`[smoke-guard:seam] TEST SEAM ARMED — PP_SMOKE_FAULT="${faultGuard}" (validation passed: it is a known guard id). The injected guard will fail ONCE (single-shot) and every later guard still enters.`)
}

// ============================================================================
// §4 SELF-CHECK — `process.exit` ONLY inside `guardAggregateExit`
// (audit finding 1: 78 raw exits bypassed the aggregation; this guard makes a
// re-introduced one FAIL the run instead of silently short-circuiting it.)
// ============================================================================

/** The exit-call token, assembled so THIS function's own source does not
 *  contain it (the check reads the file's text, and a literal token here would
 *  make the audit match itself). */
const EXIT_TOKEN = ['process', 'exit'].join('.')
/** The one sanctioned call site: `aggregateExitHardFail`'s body (called only by
 *  `guardAggregateExit` and by the pre-guard startup validation). */
const AGGREGATE_EXIT_ID = 'aggregateExitHardFail'
/** Self-source path (this file), from the module URL — never cwd-dependent. */
const SELF_SOURCE_URL = new URL(import.meta.url)

/** The number of exit-call sites + the lines they sit on, in this file's source.
 *  A site counts only when the token appears as a CALL (`token(`) on a line that
 *  is not a COMMENT and not a STRING that merely mentions it (this file's own
 *  audit messages and documentation name the token constantly — counting those
 *  would make the audit report itself). */
function exitCallSites(source) {
  const lines = source.split('\n')
  const sites = []
  for (let i = 0; i < lines.length; i += 1) {
    const text = lines[i]
    const trimmed = text.trim()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue
    const at = text.indexOf(`${EXIT_TOKEN}(`)
    if (at < 0) continue
    // skip a mention inside a string literal / template on that line: a real
    // call site is the token reached outside quotes. Count the quote characters
    // before the token — an even number means it is inside a string.
    const before = text.slice(0, at)
    const quotes = (before.match(/['"`]/g) ?? []).length
    if (quotes % 2 === 1) continue
    sites.push({ line: i + 1, text: trimmed })
  }
  return sites
}

/** The line range of a named top-level function's body (1-based, inclusive). */
function functionBodyRange(source, name) {
  const lines = source.split('\n')
  const start = lines.findIndex((l) => l.startsWith(`function ${name}(`))
  if (start < 0) return null
  let depth = 0
  for (let i = start; i < lines.length; i += 1) {
    for (const ch of lines[i]) {
      if (ch === '{') depth += 1
      else if (ch === '}') depth -= 1
    }
    if (depth === 0 && i > start) return { start: start + 1, end: i + 1 }
  }
  return null
}

/** The self-check's verdict: every exit-call site must sit inside
 *  `guardAggregateExit`. Returns the violations (empty ⇒ the audit holds). */
function exitAuditViolations(source) {
  const sites = exitCallSites(source)
  const range = functionBodyRange(source, AGGREGATE_EXIT_ID)
  const out = []
  if (range === null) return [`the aggregate-exit function "${AGGREGATE_EXIT_ID}" is gone from the harness — the one sanctioned exit site cannot be located`]
  if (sites.length === 0) out.push(`no "${EXIT_TOKEN}(" call site exists at all — the harness cannot set a failure exit code`)
  for (const s of sites) {
    if (s.line < range.start || s.line > range.end) {
      out.push(`a raw "${EXIT_TOKEN}(" call at :${s.line} (${s.text}) sits OUTSIDE ${AGGREGATE_EXIT_ID} (:${range.start}-${range.end}) — it bypasses the §4 aggregation`)
    }
  }
  return out
}

const { fileURLToPath } = await import('node:url')
const base = fileURLToPath(new URL('..', import.meta.url))

// Seed the framework input data embedded in the generated pages
// (scripts/build-demo.mjs must run before this script).
const { readFile } = await import('node:fs/promises')
const { buildModeTogglePage } = await import('./mode-toggle-page.mjs')
// (the inline pages' HTML is read by `importInlinePage` at the guard that seeds
// and imports them — see the page guards below)

// ---- heavy fork-family page runner: each page runs in a fresh subprocess ----
// The page's own `[xxx:profile]` line still streams visible output (that IS the
// report the smoke exists to print); the profile OBJECT comes back via a temp
// result file so the guards below stay a single source of truth in this file.
//
// NOTE (§4, 2026-09-22): the worker's stdout/stderr are captured and RE-EMITTED
// through this process's own streams (piped, not `inherit`). Isolated-subprocess
// discipline is unchanged (each page still gets its own process, freed on exit)
// — only the plumbing of its output changed, so that every line the smoke prints
// passes through the counted sink below. The guard-entry log's `index` is an
// OUTPUT-LINE index compared against the tripwire marker's line position, so
// lines that bypassed the counter would make a post-tripwire guard look like it
// preceded the tripwire.
//
// OUTPUT-FIDELITY CHANGE (recorded — tracker: docs/decisions.md
// NO-CLONE-ENFORCEMENT + the audit record in docs/defects.md): with
// `stdio: 'pipe'` + `maxBuffer` (256MB) the parent BUFFERS each worker's whole
// output and re-emits it after the child exits — the streams are therefore no
// longer interleaved live (a worker's output appears as ONE ordered block at the
// point the parent re-emits it), and an output-overrunning worker surfaces as a
// WORKER FAILURE (non-zero status + the re-emitted partial output) instead of a
// partial live stream. PAGE ISOLATION IS UNCHANGED (still one process per page).
const _resultDir = mkdtempSync(join(tmpdir(), 'smoke-pages-'))
// banners from the worker-run pages (the parent walks only its own mounted
// shim; each worker ships its page's runner banners back via the result)
const workerBanners = []
/** A worker-run page that did not finish profiling. THROWN (never
 *  `process.exit`ed): a page-worker failure must not pre-empt the guards that
 *  follow it (§4 — its own guard records the failure and the run continues to
 *  the later censuses; the aggregate exit still ends non-zero). */
class PageWorkerError extends Error {}
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
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 })
  // re-emit the worker's output through this process's counted sinks (order is
  // preserved: the child has already exited, so its whole output is drained here
  // before the next line this process prints)
  if (res.stdout) process.stdout.write(res.stdout)
  if (res.stderr) process.stderr.write(res.stderr)
  // the worker's own diagnostic line, carried into the guard's failure reason
  // (a spawn failure has none — say so explicitly, never silently)
  const workerDetail = /^\[smoke-worker\].*$/m.exec(res.stderr ?? '')?.[0]
    ?? (res.error ? `spawn error: ${res.error.message}` : 'the worker printed no [smoke-worker] diagnostic')
  if (res.status !== 0) {
    console.error(`${label} worker failed (exit ${res.status ?? 'signal'}) — page did not finish profiling`)
    throw new PageWorkerError(`${label} worker failed (exit ${res.status ?? 'signal'}): ${workerDetail}`)
  }
  let result
  try {
    result = JSON.parse(readFileSync(resultFile, 'utf8'))
  } catch (e) {
    console.error(`${label} worker result unreadable:`, e)
    throw new PageWorkerError(`${label} worker result unreadable: ${e && e.message ? e.message : e}`)
  }
  if (result === null || typeof result !== 'object' || typeof result.profile !== 'object' || result.profile === null) {
    console.error(`${label} worker result carried no profile object: ${JSON.stringify(result)?.slice(0, 200)}`)
    throw new PageWorkerError(`${label} worker result carried no profile object (malformed profile)`)
  }
  if (Array.isArray(result.banners)) workerBanners.push(...result.banners)
  return result.profile
}

/** Import an INLINE demo page and wait for its `done` global. The inline pages
 *  share the parent's shim, so they MUST stay sequential — this helper is only
 *  awaited inside a `runGuard` body. It THROWS on a failed import / a missing
 *  profile global instead of exiting: the guard records the failure and the run
 *  continues to the later guards (§4). */
async function importInlinePage(pageFile, modulePath, doneGlobal, raceWindowMs, label) {
  const pageHtml = await readFile(`${base}${pageFile}`, 'utf8')
  seedPage(pageHtml)
  try {
    await import(`${base}${modulePath}`)
  } catch (e) {
    console.error(`${label} failed:`, e)
    throw new Error(`${label} page import failed: ${e && e.message ? e.message : e}`)
  }
  await Promise.race([
    globalThis[doneGlobal],
    new Promise((r) => setTimeout(r, raceWindowMs)),
  ]).catch(() => {})
  return globalThis[doneGlobal.replace(/Done$/, 'Profile')]
}

/** Read + parse the page's embedded `server-data` (the builder's identical-
 *  pipeline census). A MISSING or MALFORMED payload is a LOUD guard failure, not
 *  a TypeError that kills the run (audit finding 6/7) — the caller then returns
 *  without touching the undefined payload.
 *  `pick` selects the sub-object the caller needs (the pages ship different
 *  `expected` shapes: `expected.census`, or `expected` itself for the rows page);
 *  a MISSING selection is likewise a loud failure, never an undefined read. */
function expectedServerData(gCensus, pick) {
  const el = byId.get('server-data')
  if (!el || typeof el.textContent !== 'string' || el.textContent.length === 0) {
    console.error('server-data element is missing or empty — the builder-generated page did not ship its expected census')
    guardLeaveFailed(gCensus, 'the server-data element is missing or empty (baseline absent — the pin cannot be evaluated)')
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(el.textContent)
  } catch (e) {
    console.error('server-data is not valid JSON:', e && e.message ? e.message : e)
    guardLeaveFailed(gCensus, `the server-data payload is malformed: ${e && e.message ? e.message : e}`)
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || typeof parsed.expected !== 'object' || parsed.expected === null) {
    console.error('server-data carries no `expected` object')
    guardLeaveFailed(gCensus, 'the server-data payload carries no `expected` object (baseline absent — the pin cannot be evaluated)')
    return null
  }
  const picked = pick(parsed.expected)
  if (picked === null || typeof picked !== 'object') {
    console.error(`server-data \`expected\` carries no usable ${pick.label ?? 'payload'}`)
    guardLeaveFailed(gCensus, `the server-data payload carries no \`expected.${pick.label ?? '?'}\` object (baseline absent — the pin cannot be evaluated)`)
    return null
  }
  return picked
}

/** `expectedServerData(...)` narrowed to `expected.census` (the five
 *  census-equality pages). */
function expectedCensus(gCensus) {
  const pick = (expected) => expected.census
  pick.label = 'census'
  return expectedServerData(gCensus, pick)
}

/** `expectedServerData(...)` on the whole `expected` object (the rows page, whose
 *  `expected` carries `census` + `rowsMinted` + the fan-out census). */
function expectedAll(gCensus) {
  const pick = (expected) => expected
  pick.label = 'payload'
  return expectedServerData(gCensus, pick)
}

/** The shim's FAIL-marked check elements (the pre-existing banner walk, moved
 *  into a named helper so the banner guard can use it). */
function collectFailMarks(el, acc) {
  if (String(el.className).split(' ').includes('fail')) acc.push(el)
  for (const c of el.children) collectFailMarks(c, acc)
  return acc
}

/** Every text run under an element (the component page's footer summary walk). */
function allText(el) {
  if (!el) return ''
  return (el.textContent ?? '') + el.children.map(allText).join('')
}

// ---- THE INLINE PAGE WAIT WINDOW (H8, 2026-09-22 audit) ----------------------
// Every inline page's `done` global is raced against this window. It was 30s at
// every inline call site. The 2026-09-22 audit raised it to 90s with the reason
// below; the 2026-09-23 follow-up MEASURED the raise to be necessary-but-not-
// sufficient and landed the audit's FIRST close instead — the smoke-spawning
// unit file (`tests/unit/no-clone-guards.test.ts`, which runs this whole smoke
// TWICE) no longer runs inside the parallel test phase: it runs in its own
// serialised Vitest phase (`vitest.smoke.config.ts`, `fileParallelism: false`,
// wired into `npm test`; record: `docs/decisions.md`
// NO-CLONE-TEST-PHASE-ISOLATION`, evidence: `docs/defects.md`
// FLAKE-NOCLONE-SMOKE-IN-PARALLEL). The window is NOT a bound on any
// measurement (no guard reads it): it only decides how long the harness waits
// for a page's own done-global. MEASURED CAVEAT (2026-09-23): it can only bound
// pages whose done-global resolves ASYNCHRONOUSLY — the fork-family pages
// (`fork-stress*`, `path-fork-data`) set their profile/`__*Done` globals
// SYNCHRONOUSLY at the end of the module body's `main()` call
// (`demo/fork-stress.js:611-616`), so the race is only reached AFTER their work
// is done and their effective window is unbounded (verified: a 1 ms window
// still yields a complete d12 profile). Only the async inline pages below are
// actually bounded by it. The env override stays for a deliberately fast local
// run (with the caveat that a window far below a page's honest time reports
// that page as a FAILURE, which is why it is not reduced by default):
//   PP_SMOKE_PAGE_WINDOW_MS=<ms> overrides it.
const PAGE_WAIT_MS = (() => {
  const raw = Number(process.env.PP_SMOKE_PAGE_WINDOW_MS)
  return Number.isFinite(raw) && raw > 0 ? raw : 90000
})()

// ---- §4 GUARD 0 — THE EXIT AUDIT (self-check) -------------------------------
// Every inline page block below is a guard too: a page-import failure used to be
// a raw `process.exit(1)` BETWEEN the earlier blocks and the censuses, i.e. a
// failure path that bypassed the aggregation entirely (audit finding 1). The
// audit guard runs FIRST so the fact it asserts — one exit site, inside
// `guardAggregateExit` — is reported on every run, before anything can fail.
await runGuard('guard-exit-audit', (gExitAudit) => {
  console.log(`[smoke-guard:exit-audit] ${EXIT_TOKEN} call sites in ${SELF_SOURCE_URL.pathname}: only ${AGGREGATE_EXIT_ID} may carry one`)
  const source = readFileSync(SELF_SOURCE_URL, 'utf8')
  const violations = exitAuditViolations(source)
  for (const v of violations) console.error(`[smoke-guard:exit-audit] VIOLATION — ${v}`)
  if (violations.length > 0) {
    guardLeaveFailed(gExitAudit, `the ${EXIT_TOKEN} audit found ${violations.length} violation(s): ${violations.join(' | ')}`)
  }
  // the fault seam's validation set must still cover every real guard id (a new
  // guard the list does not know about makes PP_SMOKE_FAULT unusable for it, and
  // a STALE id in the list makes a typo pass validation). The mode-toggle guards
  // are declared with a template id (one per adapter mode), so the template is
  // expanded against the mode list before the comparison.
  const declared = [...source.matchAll(/runGuard\(\s*(?:'([^']+)'|`([^`]+)`)/g)]
    .map((m) => m[1] ?? m[2])
    .flatMap((id) => (id.includes('${mode}')
      ? MODE_TOGGLE_MODES.map((mode) => id.replace('${mode}', mode))
      : [id]))
  const unknown = declared.filter((id) => !KNOWN_GUARD_IDS.includes(id))
  const stale = KNOWN_GUARD_IDS.filter((id) => !declared.includes(id))
  console.log(`[smoke-guard:exit-audit] guard registry: ${declared.length} runGuard call sites, KNOWN_GUARD_IDS=${KNOWN_GUARD_IDS.length}`)
  if (unknown.length > 0) {
    console.error(`[smoke-guard:exit-audit] VIOLATION — guard id(s) missing from KNOWN_GUARD_IDS: ${unknown.join(', ')}`)
    guardLeaveFailed(gExitAudit, `guard id(s) absent from the fault-seam validation set: ${unknown.join(', ')}`)
  }
  if (stale.length > 0) {
    console.error(`[smoke-guard:exit-audit] VIOLATION — KNOWN_GUARD_IDS carries id(s) with no runGuard call site: ${stale.join(', ')}`)
    guardLeaveFailed(gExitAudit, `stale id(s) in the fault-seam validation set: ${stale.join(', ')}`)
  }
})

// ---- inline demo pages (ssr-render / components / loop-safety / feature-matrix)
// These share THIS process's shim (they are small — see the isolation note at the
// head of the file) and are awaited sequentially, each inside its own guard so a
// failed import records a failure and the run continues (§4).
await runGuard('ssr-render-page', async (gPage) => {
  await importInlinePage('demo/ssr-render.html', 'demo/ssr-render.js', '__ssrRenderDone', PAGE_WAIT_MS, 'ssr-render')
    .catch((e) => guardLeaveFailed(gPage, e.message))
})
await runGuard('components-page', async (gPage) => {
  await importInlinePage('demo/components.html', 'demo/components.js', '__componentsDone', PAGE_WAIT_MS, 'components')
    .catch((e) => guardLeaveFailed(gPage, e.message))
})
await runGuard('loop-safety-page', async (gPage) => {
  // no seed step: loop-safety drives the supervisor directly (its own module
  // body), so it needs no page data — same as before this pass
  await import(`${base}demo/loop-safety.js`).catch((e) => {
    console.error('loop-safety failed:', e)
    guardLeaveFailed(gPage, `loop-safety page import failed: ${e && e.message ? e.message : e}`)
  })
})
await runGuard('feature-matrix-page', async (gPage) => {
  await importInlinePage('demo/feature-matrix.html', 'demo/feature-matrix.js', '__featureMatrixDone', PAGE_WAIT_MS, 'feature-matrix')
    .catch((e) => guardLeaveFailed(gPage, e.message))
})

// ---- mode-toggle page: every adapter mode drives the shared harness ---------
// Each mode is seeded and imported as a distinct module instance (cache-busted
// by `?mode=`), so all three banner titles land in the same run. Each mode is its
// own guard (§4): a failed import records that mode's failure and the remaining
// modes still run.
for (const mode of MODE_TOGGLE_MODES) {
  await runGuard(`mode-toggle-page-${mode}`, async (gPage) => {
  const pageHtml = await buildModeTogglePage(mode)
  seedPage(pageHtml)
  if (mode === 'ssr') seedRawText(pageHtml, 'script', 'received-html-data')
  if (mode === 'markdown') {
    seedRawText(pageHtml, 'pre', 'markdown-source')
    seedRawText(pageHtml, 'script', 'markdown-adapter-data')
  }
  await import(`${base}demo/mode-toggle.js?mode=${mode}`).catch((e) => {
    console.error(`mode-toggle (${mode}) failed:`, e)
    guardLeaveFailed(gPage, `mode-toggle (${mode}) page import failed: ${e && e.message ? e.message : e}`)
  })
  })
}

// ---- fork-stress pages: one module instance per depth (cache-busted) --------
// Each depth's page seeds its own doc + server data; the module reads depth
// from server-data and drives the runtime layers (L4..depth). Depth set 2..12
// (the d14 page is BUILT as a manual/browser scaling probe — 2^14 − 1 =
// 16383 nodes — but does not run in this automated smoke).
// The RUNTIME fork-stress PROFILES, one per depth — DISTINCT from the derived
// family's `d12Totals` (which holds the derived `fork-stress-data-<method>-d12`
// pages). TWO consumers read this map, and they are different in kind:
//   * the RUNTIME-VS-RUNTIME GROWTH GUARD below reads the d10 + d12 entries'
//     `pass2Ms` (same construction path, different node counts) — THE FAILING
//     SCALING SIGNAL since the 2026-09-23 ruling;
//   * the INFORMATIONAL `[runtime-fork:tripwire]` print reads the d12 entry's
//     `totalMs` for the cross-family CONSTRUCTION-COST ratio (never asserted).
// The runtime page is the imperative fork tree driven by demo/fork-stress.js.
// (History: until DEFECT SMOKE-TRIPWIRE-INERT was fixed 2026-09-22 the former
// tripwire guard read `d12Totals['placement']`, i.e. the PLACEMENT-DERIVED
// page's total, so it could only fire on a derived-family blow-up — already
// covered by the in-family 2.5× guard below.)
const RUNTIME_FORK_TRIPWIRE_DEPTH = 12
const runtimeForkTotals = {}
// §4 guard 1 — the RUNTIME fork-family census block (page-run + residual +
// append-count guards for every runtime depth). Entered FIRST so that the
// growth guard below can never pre-empt it.
await runGuard('runtime-fork-stress-census', (gRuntimeCensus) => {
// TEST SEAM (inert unless PP_SMOKE_FAULT names it) — taken at the guard's
// entry, before any page runs, so the injected failure is distinguishable from
// a page failure and the later guards still enter (§4).
if (guardFaulted('runtime-fork-stress-census')) {
  guardLeaveFailed(gRuntimeCensus, 'injected by PP_SMOKE_FAULT (the reachability seam)')
  return
}
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  // isolated subprocess (frame freed on exit) — the guards below are unchanged
  let prof
  try {
    prof = runForkPage(`fork-stress-d${depth}.html`, `demo/fork-stress.js`, `depth=${depth}`, '__forkStressDone', PAGE_WAIT_MS, `fork-stress (depth ${depth})`)
  } catch (e) {
    // the page worker itself failed: that is THIS guard's failure (the page did
    // not finish profiling ⇒ its census cannot be verified). Recorded, not
    // fatal — the loop continues and the later guards still run and report.
    guardLeaveFailed(gRuntimeCensus, `the depth-${depth} page worker did not finish profiling: ${e && e.message ? e.message : e}`)
    continue
  }
  if (typeof prof.totalMs !== 'number') {
    console.error(`fork-stress (depth ${depth}) profile carries no totalMs — the baseline for this depth is ABSENT, so neither the residual nor the append guard can be evaluated`)
    guardLeaveFailed(gRuntimeCensus, `depth ${depth}: totalMs absent — baseline absent, the pin cannot be evaluated`)
    continue
  }
  runtimeForkTotals[depth] = prof
  // performance-tracking guard (same contract as the data pages): the timed
  // sections (incl. pass2 flush windows, page-side construction, handler
  // bodies) must cover ~all of the total; appends counts the diffMinimal
  // append ops — the DOM-churn proxy the shim cannot time (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md "imperative fork-stress").
  const residual = prof.totalMs - (prof.coveredMs ?? 0)
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`fork-stress (depth ${depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms`)
    guardLeaveFailed(gRuntimeCensus, `depth ${depth}: profile residual too large`)
    continue
  }
  // a profile that publishes no `appends` count cannot be evaluated either —
  // the former `?? 0` silently failed the count for every depth (loud), but the
  // reason was opaque; say which it is.
  if (typeof prof.appends !== 'number') {
    console.error(`fork-stress (depth ${depth}) profile carries no appends count — the append-count guard CANNOT be evaluated (baseline absent)`)
    guardLeaveFailed(gRuntimeCensus, `depth ${depth}: appends absent — the append-count guard cannot be evaluated`)
    continue
  }
  if (prof.appends < 2 ** depth - 2) {
    console.error(`fork-stress (depth ${depth}) append count implausible: appends=${prof.appends} for ${2 ** depth - 1} nodes`)
    guardLeaveFailed(gRuntimeCensus, `depth ${depth}: append count implausible`)
    continue
  }
}
})

// ---- fork-stress DATA-DRIVEN pages: one module instance per depth ----------
// The page input is a LEGACY envelope (root + two prototypes per layer, the
// R2.2 shared owner-name placement topology); the module translates it at
// runtime and compiles the tree by ONE PATH ENUMERATION — 2^depth − 1
// path-states over 2·(depth−1) + 1 nodes, ZERO clone-instance ops (the
// 2026-09-22 user ruling; contract: docs/specs/fork-stress-data-p3.md §3
// K1/K2/K6, superseding the clone assembly this guard's derivation encoded).
// Census guard (the page publishes registered / inTree / unplaced / destroyed
// / cloneOps / states / elements / passes on the profile; the census is a
// MEASUREMENT over the supervisor registry + the page's own journal; this guard
// re-derives the expected topology from (depth) and compares).
// K2 derivation (per depth d): nodes = 2·(d−1) + 1 = 2d − 1 (23 at d12 — the
// prototypes are contentNodes-owned, so in-tree = registered); states =
// elements = 2^d − 1 (4095 at d12); cloneOps = 0 at EVERY depth.
// CLONE CENSUS (2026-09-22 — §3 I5 of docs/specs/no-clone-invariants.md, and
// the CONVERTED expectation of docs/specs/fork-stress-data-p3.md §3 K6): the
// page MEASURES its census from its own journal
// (`journalEntries({afterIndex:0,…})` counting `clone-instance` entries, through
// a SEPARATE per-kind census walk) and publishes `journalCloneOps`, so this
// guard compares the census field against an INDEPENDENT journal-derived number
// and a fabricated disagreement is CAUGHT (NC-2d).
// THE SOURCES THE GUARD USES (audit finding 5: the former page-side alias
// `PROFILE.journalCloneOps = PROFILE.cloneOps` made this comparison `x !== x`,
// so it could never fire):
//   1. `prof.journalCloneOps` — the page's OWN journal census walk, published on
//      the census line. It is NOT the census field (`cloneOps`, computed from
//      the journal read) and it is NOT assigned from it: the page walks the
//      journal's per-kind census separately and asserts its own `cloneOpKinds`
//      walk against this value at the assignment site.
//   2. the harness's OWN topology derivation `0` (path enumeration applies NO
//      ops: no clone-instance op exists anywhere in this family's construction
//      — E2E-1). This is an ASSERTED SECOND SOURCE: the two must AGREE.
// A MISSING measurement token is a FAILURE, never a silent fallback (§8.2
// row 1 — "baseline absent must FAIL"): a page that stops publishing its
// journal measurement cannot be pinned, so its census is not accepted.
// THE PIN IS THE PAIR (§3 K6-a + K6-e): `cloneOps = 0` AND
// `registered = inTree = 2·depth − 1`. A node minted per path/element reads
// `cloneOps = 0` with `registered = 2^depth − 1`, so a clone-count-only clause
// would pass while precisely the failure the ruling names was in place.
// The BOUND is untouched: every expectation is DERIVED from the topology
// (2·depth − 1 / 0), never a new literal pin.
//
// NOTE (the seam lives at the CALL SITES, not inside this function): the
// reachability suite extracts this function's SOURCE and drives it in isolation
// (NC-2d), so it must depend on NOTHING but its arguments and `console` /
// `process` — a fault-seam reference to harness state here would make the
// extracted guard throw (and `const harnessState` inside would change the
// extraction's shape). The injected fault is therefore taken by the wrapper at
// each call site (see the loop below).
function assertForkStressCensus(prof, depth, label) {
  const expectedNodes = 2 * depth - 1
  const topologyCloneOps = 0
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'cloneOps']) {
    if (typeof prof[f] !== 'number') {
      console.error(`${label} profile missing census field "${f}" — fork-stress-data census not published — baseline absent, the clone pin cannot be evaluated`)
      return false
    }
  }
  if (prof.inTree !== expectedNodes) {
    console.error(`${label} census in-tree mismatch: inTree=${prof.inTree}, expected ${expectedNodes} (2·(depth−1) prototypes + root, all contentNodes-owned — the converted family compiles by path enumeration; a node minted per path would report 2^${depth} − 1 = ${2 ** depth - 1})`)
    return false
  }
  if (prof.unplaced !== 0) {
    console.error(`${label} census unplaced mismatch: unplaced=${prof.unplaced}, expected 0 (every node is family-in-tree after contentNodes minting — F-13)`)
    return false
  }
  if (prof.destroyed !== 0) {
    console.error(`${label} census destroyed mismatch: destroyed=${prof.destroyed}, expected 0 (no demo page fires a destroy op)`)
    return false
  }
  // SOURCE 1 — the page's independent journal census. A PROFILE THAT OMITS it
  // FAILS: the measurement token is REQUIRED on this family's census line
  // (§8.2 row 1), so a page that stops publishing it is unpinnable rather than
  // silently exempt.
  if (typeof prof.journalCloneOps !== 'number') {
    console.error(`${label} census: the profile publishes NO journalCloneOps token — the journal-derived clone measurement is REQUIRED on this family (fork-stress-data-p3.md §3 K6-b/K6-c, §8.2 row 1): a census whose measurement is absent cannot be pinned, so it FAILS (baseline absent)`)
    return false
  }
  // SOURCE 2 AS AN ASSERTED SECOND SOURCE: the page's journal walk and the
  // harness's topology derivation must AGREE — a divergence is a real drift
  // (the page's journal is not the topology this depth pins).
  if (prof.journalCloneOps !== topologyCloneOps) {
    console.error(`${label} census journal source disagrees with the harness topology source: journalCloneOps=${prof.journalCloneOps}, harness topology ${topologyCloneOps} (the converted family compiles by path enumeration — E2E-1; a non-zero count means a clone reappeared)`)
    return false
  }
  if (prof.cloneOps !== topologyCloneOps || prof.cloneOps !== prof.journalCloneOps) {
    console.error(`${label} census cloneOps mismatch: cloneOps=${prof.cloneOps}, expected the independent clone-instance count ${topologyCloneOps} (the page journal census / the page's published journalCloneOps=${prof.journalCloneOps}) — the census field disagrees with the journal (§3 I5)`)
    return false
  }
  if (prof.registered !== prof.inTree + prof.unplaced + prof.destroyed) {
    console.error(`${label} census registered mismatch: registered=${prof.registered}, expected in-tree + unplaced + destroyed = ${prof.inTree + prof.unplaced + prof.destroyed}`)
    return false
  }
  if (prof.registered !== expectedNodes) {
    console.error(`${label} census registered mismatch: registered=${prof.registered}, expected ${expectedNodes} (2·(depth−1) prototypes + root — a node minted per path would report 2^${depth} − 1 = ${2 ** depth - 1})`)
    return false
  }
  return true
}
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  // §4 guard 2 — the CONVERTED fork-stress-data census (path enumeration:
  // 2·depth − 1 nodes, 2^depth − 1 states/elements, ZERO clones; the published
  // census is a registry + journal MEASUREMENT — §3 I5 / p3 §3 K2/K6). The
  // per-depth sweep is part of what this family uniquely covers (p3 §3 K5 row
  // 4) — the depths stay 2..12.
  // THIS GUARD PASSES NATURALLY on a healthy run, which is what makes the
  // PP_SMOKE_FAULT injection against it OBSERVABLE (audit finding 3 — an
  // injection into an always-failing guard proves nothing).
  await runGuard('fork-stress-census', (gForkDataCensus) => {
  // TEST SEAM (inert unless PP_SMOKE_FAULT names it): the injected fault is
  // taken HERE (before the page runs), so the seam never contaminates
  // `assertForkStressCensus`'s extracted source (NC-2d drives that function in
  // isolation). The later guards still enter and report (§4). SINGLE-SHOT: the
  // first call for this id injects; every later depth takes the natural path.
  if (guardFaulted('fork-stress-census')) {
    guardLeaveFailed(gForkDataCensus, 'injected by PP_SMOKE_FAULT (the reachability seam)')
    return
  }
  // isolated subprocess (frame freed on exit) — the guards below are unchanged
  let prof
  try {
    prof = runForkPage(`fork-stress-data-d${depth}.html`, `demo/fork-stress-data.js`, `method=placement&depth=${depth}`, '__forkStressDataDone', PAGE_WAIT_MS, `fork-stress-data (depth ${depth})`)
  } catch (e) {
    // the page worker failed: this guard's failure, recorded and reported, not
    // fatal — the later depths and the later guards still run (§4)
    guardLeaveFailed(gForkDataCensus, `the depth-${depth} page worker did not finish profiling: ${e && e.message ? e.message : e}`)
    return
  }
  if (typeof prof.totalMs !== 'number') {
    console.error(`fork-stress-data (depth ${depth}) profile carries no totalMs — the baseline for this depth is ABSENT, so neither the residual nor the census can be evaluated`)
    guardLeaveFailed(gForkDataCensus, `depth ${depth}: totalMs absent — baseline absent, the pin cannot be evaluated`)
    return
  }
  // performance-tracking guard (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md "missing
  // timing steps"): the timed sections (incl. the ONE path-enumeration
  // bootstrap) must cover ~all of the page total, so "total" can never hide an
  // unmeasured pipeline again. The residual is the fixed overhead (summary) +
  // checks; the converted family has NO pass-2 region (the clone mechanism is
  // gone — §8.2 row 4) and its checks region is TIMED (checksMs).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  // fixed overhead (flush timers + checks + summary) is ~1–25ms regardless of
  // depth, so the guard is residual-based with an absolute tolerance: the
  // untimed region may never exceed 15% of total NOR 25ms absolute.
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`fork-stress-data (depth ${depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gForkDataCensus, `depth ${depth}: profile residual too large`)
    return
  }
  if (!assertForkStressCensus(prof, depth, `fork-stress-data (depth ${depth})`)) {
    guardLeaveFailed(gForkDataCensus, `depth ${depth}: census mismatch (see the message above)`)
  }
  })
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
  // §4 guard 3 — the single-method variant census for the pinned depth
  await runGuard('fork-stress-variant-census', (gVariantCensus) => {
  // TEST SEAM (inert unless PP_SMOKE_FAULT names it) — taken at the guard's
  // entry, before the pages run, so the injected failure cannot be confused with
  // a page failure. This guard PASSES NATURALLY on a healthy run, which is what
  // makes the injection observable (audit finding 3).
  if (guardFaulted('fork-stress-variant-census')) {
    guardLeaveFailed(gVariantCensus, 'injected by PP_SMOKE_FAULT (the reachability seam)')
    return
  }
  for (const method of ['placement', 'values', 'link']) {
    let prof
    try {
      prof = runForkPage(`fork-stress-data-${method}-d${depth}.html`, `demo/fork-stress-data.js`, `method=${method}&depth=${depth}`, '__forkStressDataDone', PAGE_WAIT_MS, `fork-stress-data (${method}-only d${depth})`)
    } catch (e) {
      guardLeaveFailed(gVariantCensus, `the ${method}-only page worker did not finish profiling: ${e && e.message ? e.message : e}`)
      continue
    }
    const residual = prof.totalMs - (prof.coveredMs ?? 0)
    if (residual > Math.max(prof.totalMs * 0.15, 25)) {
      console.error(`fork-stress-data (${method}-only d${depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms`)
      guardLeaveFailed(gVariantCensus, 'profile residual too large')
      continue
    }
    if (!assertForkStressCensus(prof, depth, `fork-stress-data (${method}-only d${depth})`)) {
      guardLeaveFailed(gVariantCensus, 'census mismatch (see the message above)')
      continue
    }
    totals[method] = prof.totalMs
  }
  // totals ratio guard (AGENTS.md item 4, promoted from manual to asserted):
  // the values/link totals must stay within a loose multiple of the placement
  // baseline — the historical O(n²) pass-2 regression showed as ~20×, so 2.5×
  // is a generous CI-safe bound that still catches pipeline blow-ups.
  // BASELINE ABSENCE IS A FAILURE (audit finding 6): the former `?? 0` made a
  // missing placement total produce `ratio = 0`, i.e. the 2.5× guard SILENTLY
  // PASSED — a bound bypassed by a non-fatal path. A missing baseline means the
  // pin CANNOT be evaluated, which is a loud failure, not a pass.
  const placementBase = totals['placement']
  const missingTotals = ['placement', 'values', 'link'].filter((m) => typeof totals[m] !== 'number')
  if (typeof placementBase !== 'number' || placementBase <= 0) {
    console.error(`fork-stress-data (d${depth}) totals pin CANNOT BE EVALUATED: the placement baseline is ${placementBase === undefined ? 'ABSENT' : `${placementBase}ms`} (measured totals: ${JSON.stringify(totals)}) — the 2.5× totals guard must FAIL, never silently pass on a missing baseline`)
    guardLeaveFailed(gVariantCensus, 'baseline absent — the 2.5× totals pin cannot be evaluated (placement total never recorded)')
  }
  for (const method of ['values', 'link']) {
    if (typeof totals[method] !== 'number') {
      console.error(`fork-stress-data (${method}-only d${depth}) total is ABSENT — the 2.5× ratio against the placement baseline cannot be evaluated`)
      guardLeaveFailed(gVariantCensus, `the ${method}-only total is absent — the 2.5× totals pin cannot be evaluated`)
      continue
    }
    if (typeof placementBase !== 'number' || placementBase <= 0) continue // already failed loudly above
    const ratio = totals[method] / placementBase
    if (ratio > 2.5) {
      console.error(`fork-stress-data (${method}-only d${depth}) total ratio ${ratio.toFixed(2)}× exceeds 2.5× of placement (${totals[method]}ms vs ${placementBase}ms)`)
      guardLeaveFailed(gVariantCensus, 'totals ratio bound (2.5×) breached')
    }
  }
  if (missingTotals.length === 0) {
    console.log(`[fork-stress-data:variant-totals] depth=${depth} placement=${placementBase}ms values=${totals['values']}ms link=${totals['link']}ms — the 2.5× totals pin evaluated (no baseline was missing)`)
  }
  })
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
      return false
    }
  }
  if (prof.registered !== nodes) {
    console.error(`path-fork-data census registered mismatch: registered=${prof.registered}, expected ${nodes} (${nodes - 1} prototypes + root)`)
    return false
  }
  if (prof.inTree !== nodes) {
    console.error(`path-fork-data census in-tree mismatch: inTree=${prof.inTree}, expected ${nodes} (every prototype is contentNodes-owned — F-13)`)
    return false
  }
  if (prof.unplaced !== 0) {
    console.error(`path-fork-data census unplaced mismatch: unplaced=${prof.unplaced}, expected 0 (no node is family-unplaced)`)
    return false
  }
  if (prof.destroyed !== 0) {
    console.error(`path-fork-data census destroyed mismatch: destroyed=${prof.destroyed}, expected 0`)
    return false
  }
  if (prof.cloneOps !== 0) {
    console.error(`path-fork-data census cloneOps mismatch: cloneOps=${prof.cloneOps}, expected 0 (the static model mints NO clones — E2E-1)`)
    return false
  }
  if (prof.states !== states) {
    console.error(`path-fork-data census states mismatch: states=${prof.states}, expected ${states} (2^${depth} − 1 path-states)`)
    return false
  }
  if (prof.elements !== states) {
    console.error(`path-fork-data census elements mismatch: elements=${prof.elements}, expected ${states} (one element per path-state)`)
    return false
  }
  if (prof.passes !== 1) {
    console.error(`path-fork-data bootstrap passes mismatch: passes=${prof.passes}, expected 1 (ONE path-enumeration compile)`)
    return false
  }
  return true
}// §5.2 — the derived-family per-region pins: the placement-derived page is the
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
// §4 guard 4 — the STATIC/derived census of the derived trio (the no-clone
// family: measured `cloneOps = 0` published on every derived-fork census line)
await runGuard('static-path-census', (gStaticCensus) => {
// TEST SEAM (inert unless PP_SMOKE_FAULT names it) — taken at the guard's
// entry, before the pages run. This guard PASSES NATURALLY on a healthy run,
// which is what makes the injection observable (audit finding 3).
if (guardFaulted('static-path-census')) {
  guardLeaveFailed(gStaticCensus, 'injected by PP_SMOKE_FAULT (the reachability seam)')
  return
}
for (const page of derivedForkPages) {
  let prof
  try {
    prof = runForkPage(page.file, `demo/path-fork-data.js`, `method=${page.q}&depth=${page.depth}`, '__pathForkDone', PAGE_WAIT_MS, `path-fork-data (${page.method}-derived d${page.depth})`)
  } catch (e) {
    // the derived page's worker failed: this guard's failure, recorded and
    // reported; the derived trio's remaining variants still run (§4)
    guardLeaveFailed(gStaticCensus, `the ${page.method}-derived page worker did not finish profiling: ${e && e.message ? e.message : e}`)
    continue
  }
  // performance guard (AGENTS.md item-4 watch applies to the path-enumeration
  // bootstrap pass): the timed sections (incl. the ONE enumeration compile)
  // must cover ~all of the page total, so "total" can never hide an untimed
  // pipeline (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`path-fork-data (${page.method}-derived d${page.depth}) profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gStaticCensus, 'profile residual too large')
    continue
  }
  if (!assertStaticPathCensus(prof, page.depth)) {
    guardLeaveFailed(gStaticCensus, 'census mismatch (see the message above)')
    continue
  }
  // BASELINE ABSENCE IS A LOUD FAILURE, never a silent pass (audit finding 6):
  // when the placement-derived page's worker fails, `derivedBase[depth]` was
  // left undefined and the former `depthBase[r] > 0` test read a property of
  // `undefined` — a TypeError that killed the whole run. The pin is now skipped
  // ONCE with an explicit recorded failure, and the 2.5× bound is reported as
  // NOT EVALUATED rather than passed.
  const depthBase = derivedBase[page.depth]
  if (page.method === 'placement') {
    // Family baseline (placement-derived — the §8-Q6 split): per-region
    // numbers the values/link pages pin against; the runtime family keeps its
    // own growth guard below (✎ the former 3× cross-family tripwire assertion
    // was RETIRED by the 2026-09-23 ruling — see the growth-guard block).
    const b = (derivedBase[page.depth] ??= {})
    for (const r of derivedRegions) {
      if (typeof prof[r] !== 'number' || !(prof[r] > 0)) {
        console.error(`path-fork-data (${page.method}-derived d${page.depth}) FAMILY BASELINE region ${r} is ${prof[r]} — the values/link-derived pages' 2.5× per-region pin CANNOT BE EVALUATED without a positive baseline`)
        guardLeaveFailed(gStaticCensus, `baseline region ${r} absent or non-positive — the per-region 2.5× pin cannot be evaluated`)
      }
      b[r] = prof[r] ?? 0
    }
    b.totalMs = prof.totalMs
    const f = (v) => (v ?? 0).toFixed(1)
    console.log(`[derived-fork:baseline] method=placement depth=${page.depth} emit=${f(b.emitMs)}ms diff=${f(b.diffMs)}ms apply=${f(b.applyMs)}ms total=${f(prof.totalMs)}ms — derived FAMILY baseline recorded (placement-derived d${page.depth} page; the former [path-fork:baseline] marker, §10.ad N-5/R-5 SUPERSEDED); values/link-derived pages pin their per-region ratios against this (§8-Q6 split); ✎ SUPERSEDED 2026-09-23: the runtime 3× total tripwire that stood below is RETIRED as an assertion by the user's ruling — the runtime scaling signal is now the runtime-vs-runtime GROWTH guard (id runtime-fork-growth-guard, docs/decisions.md RUNTIME-FORK-GROWTH-GUARD, which supersedes RUNTIME-FORK-TRIPWIRE-BOUND); the cross-family ratio this line's page total feeds survives only as an INFORMATIONAL print (marker: see the growth-guard block below). ✎ TEXT CORRECTION 2026-09-23: the former "honest ~2.3-2.7× runtime:derived ratio" claim that stood here is WITHDRAWN — that band was the DERIVED-VS-DERIVED ~1.0× reading (the pre-2026-09-22 harness read d12Totals['placement'], so the runtime page was never measured; docs/defects.md SMOKE-TRIPWIRE-INERT). The honest like-for-like PAGE-TOTAL ratio is 8-11× (docs/defects.md RUNTIME-FORK-PASS2-RATIO). No bound, operand or guard is changed by this text.`)
  } else {
    // Derived-family pins: each region must stay within 2.5× of the
    // placement-derived baseline (the critique's EMIT-side blow-up guard).
    if (depthBase === undefined) {
      console.error(`path-fork-data (${page.method}-derived d${page.depth}) BASELINE ABSENT: the placement-derived family baseline for depth ${page.depth} was never recorded (its page worker failed or its census was rejected) — the per-region 2.5× pin and the [derived-fork:pin] line CANNOT be evaluated`)
      guardLeaveFailed(gStaticCensus, `baseline absent for depth ${page.depth} — the derived per-region 2.5× pin cannot be evaluated`)
      continue
    }
    for (const r of derivedRegions) {
      if (typeof depthBase[r] !== 'number' || !(depthBase[r] > 0)) {
        console.error(`path-fork-data (${page.method}-derived d${page.depth}) baseline region ${r} is ${depthBase[r]} (absent or non-positive) — the 2.5× ratio cannot be evaluated (a missing baseline must FAIL, never silently pass)`)
        guardLeaveFailed(gStaticCensus, `baseline region ${r} absent or non-positive — the per-region 2.5× pin cannot be evaluated`)
        continue
      }
      if (typeof prof[r] !== 'number') {
        console.error(`path-fork-data (${page.method}-derived d${page.depth}) profile region ${r} is not a number (${prof[r]}) — the 2.5× ratio against the baseline cannot be evaluated`)
        guardLeaveFailed(gStaticCensus, `profile region ${r} absent — the per-region 2.5× pin cannot be evaluated`)
        continue
      }
      const ratio = prof[r] / depthBase[r]
      if (ratio > 2.5) {
        console.error(`path-fork-data (${page.method}-derived d${page.depth}) region ${r} ratio ${ratio.toFixed(2)}× exceeds 2.5× of the placement-derived baseline ${depthBase[r].toFixed(1)}ms — emit-side scaling regression in the derived family`)
        guardLeaveFailed(gStaticCensus, 'derived per-region 2.5× pin breached')
      }
    }
    console.log(`[derived-fork:pin] method=${page.method} depth=${page.depth} emit=${((prof.emitMs ?? 0) / depthBase.emitMs).toFixed(2)}× diff=${((prof.diffMs ?? 0) / depthBase.diffMs).toFixed(2)}× apply=${((prof.applyMs ?? 0) / depthBase.applyMs).toFixed(2)}× vs placement-derived baseline (2.5× asserted)`)
  }
}
})
// ---------------------------------------------------------------------------
// §4 guard 5 (added 2026-09-23, DEFECT FD7-D2-LINK-CENSUS — regression
// protection for the ruled shallow exception): THE SHALLOW-DEPTH ELEMENT
// CENSUS of the derived family.
//
// WHY IT EXISTS: the `static-path-census` guard above sweeps the d12 trio ONLY
// (the `derivedForkPages` list), so the element-census relation was never
// checked at a shallow depth — which is exactly where the family's ONE
// deviation lives. MEASURED (2026-09-23, both families, independently): the
// link variant emits `elements = 2^d − 1 + 4` at d2 ONLY — 7 = 3 path-state
// elements + 4 synthetic def-fill children — because the two level-1 def hosts'
// path-states are CHILDLESS at d2, so the covered-CHILDLESS gate does not fire
// for them and the standalone P-EMIT-3 def-fill pushes their `<wire>:a`/`:b`
// children (`src/core/render-helpers.ts:743-746`; the gate's rationale at
// `:733-742`; contract `docs/specs/render.md:224` DFC-1). At `d ≥ 3` the same
// hosts have real children, the fill is bounded by the re-typed children, and
// the census is exactly `2^d − 1` for every method. This is the DOCUMENTED
// boundary of the gate — ruled NOT an engine defect; the stale
// `2^d − 1`-for-every-(depth, method) expectation was what got fixed.
//
// WHAT IT ASSERTS (two INDEPENDENT sides, per (depth, method)):
//   (a) the BUILDER's derived expectation — `pathForkServerData(m,d).expected`
//       (the value the page embeds and audits itself against);
//   (b) a FRESH measurement — `buildPathForkSurface(m,d)` re-compiles the SAME
//       envelope and counts the emitted elements (`els.length`, plus the
//       synthetic def-fill split).
// They must agree with the ruled relation AND with each other; a disagreement
// in EITHER direction fails. The measured side is the falsifier: a def-fill
// phantom regression (`2·(2^d − 1) + 1`, the DFC-1 signature) or a vanished
// fill both move `els.length` off the relation.
//
// THE REAL SHALLOW PAGES (not a re-implementation): each (depth, method) point
// builds the ACTUAL page through the same builder the shipped pages use
// (`buildPathForkPage`, `scripts/path-fork-page.mjs`), seeds it into the live
// shim and imports the page MODULE — so the page's own census / per-level /
// DOM-level / d2-def-fill-pin checks RUN and must pass (the page publishes
// `__pathForkProfile`, which this guard reads and compares against the
// relation). The page module in this process has its browser block active
// (the smoke shim installs `document`), so a shallow page-level regression —
// not just a builder-level one — fails here.
//
// THE d2/link DISCRIMINATOR (why a bare count is not enough): the DFC-1
// phantom signature at d2 is ALSO 7, so the count alone cannot separate the
// documented boundary from a regression. This guard therefore pins the SHAPE
// too — the 4 extra elements must be `<hostWire>:<bind>` synthetic children of
// level-1 def hosts (no path-state behind them), while the 3 standalone
// elements keep their own wires. A phantom re-emission would carry real
// path-state wires and fail that clause.
//
// RESIDUAL — CLOSED 2026-09-23 (see the FIXED row FD7-D2-LINK-TREEFROMOPS-CHECK
// in `docs/defects.md`; classification (a): a real page-check defect at d2/link,
// the SAME ruled stale-expectation class as FD7-D2-LINK-CENSUS — NOT a
// shim/harness interaction).
// WHAT WAS REPORTED (2026-09-23, the prior pass): mounting the d2/link page made
// ITS OWN runner report one failing check — `treeFromOps: one root; full binary
// tree (...) 2 leaves at depth 1; 3 nodes total` (detail: `leaf at depth 2,
// expected 1`) — while every observable this guard measures was correct. It was
// filed as a shim/ordering interaction on the strength of a standalone run that
// was believed to pass; that belief does NOT reproduce: the cited standalone
// command named a page file that does not exist (`demo/path-fork-data-link-d2.html`
// is not a build output — the family ships NO shallow HTML), and the real
// reproduction (the page built through `buildPathForkPage('link', 2)` and run in
// the ISOLATED worker, fresh process + fresh shim + no prior page) fails
// IDENTICALLY and deterministically: `9 passed, 1 failed`, same check, same
// detail. The failure is therefore order-INDEPENDENT and lives in the page.
// ROOT CAUSE: that check still carried the stale `2^d − 1` expectation
// (`total === familyStates`, every leaf at depth `familyLayers`) which the
// FD7-D2-LINK-CENSUS ruling had already corrected everywhere else in the page
// (the element/per-level/DOM censuses) — at d2/link the documented 4 def-fill
// children hang UNDER the two level-1 def hosts, so `treeFromOps` legitimately
// yields 7 nodes with the 4 fills as leaves at depth 2. It was corrected in
// `demo/path-fork-data.js` to the ruled census (and the deepest level is now
// additionally pinned to the documented fill WIRES, so the numerically
// identical DFC-1 phantom signature cannot satisfy it). NOTHING HERE WAS
// WEAKENED: the banner assertion below is UNCHANGED (still report-only: this
// guard's own failures are the relation arms, and the smoke's guard-failure line
// stays tripwire-ONLY by ruling), the NOTE arm keeps printing any non-zero page
// banner, and the d2/link RELATION remains asserted by four independent sources.
//
// COVERAGE NOTE (recorded, per the task's fallback): these shallow runs happen
// IN THE SMOKE PROCESS (the pages are 3- and 7-element builds — a dedicated
// isolated page worker per variant is not warranted), whereas the shipped d12
// trio runs in the isolated page workers via `derivedForkPages`. The static
// family ships NO shallow PAGES at all (d2/d3 HTML is not built; d14 is
// built-but-not-run BY DESIGN, AGENTS.md item 4), so "generate shallow static
// pages" would mean new build outputs + new worker entries for 3-element
// pages — the in-process page runs here cover the same page modules and the
// same checks. What is NOT covered: the subprocess-isolation heap discipline
// for a shallow page (irrelevant at 3-7 elements) and any d14-scale probe.
// ---------------------------------------------------------------------------
await runGuard('derived-fork-shallow-census', async (gShallowCensus) => {
  // TEST SEAM (inert unless PP_SMOKE_FAULT names it) — taken at the guard's
  // entry: this guard PASSES NATURALLY on a healthy run, which is what makes
  // the injection observable (audit finding 3).
  if (guardFaulted('derived-fork-shallow-census')) {
    guardLeaveFailed(gShallowCensus, 'injected by PP_SMOKE_FAULT (the reachability seam)')
    return
  }
  /** Build the REAL page for (method, depth), seed it into the live shim, import
   *  the page module (fresh instance — cache-busted) and return its node-side
   *  exports, the page HTML's OWN embedded expectation and the published profile.
   *  The page's own checks run on import and must pass.
   *
   *  `buildPathForkPage` is the statically imported builder (see the import
   *  comment at the head of this file) — the guard reads the REAL embedded
   *  `server-data` out of the built page HTML as well, so the expectation has
   *  three independent sources (embedded bytes / builder derivation / measured
   *  census). */
  async function runShallowPage(method, depth) {
    const built = await buildPathForkPage(method, depth)
    // PER-PAGE-ISOLATION HYGIENE (a real browser loads each page in a fresh
    // document; this guard mounts several pages in ONE process):
    //   · `#app` — the DomAdapter host. The shim's `El` keeps its children for
    //     the process's lifetime, so reusing the element would leak the previous
    //     page's subtrees into this page's own DOM census. Dropped (the shim
    //     recreates it empty on demand), exactly as a fresh page load would.
    //   · `#results` — the runner's check list. The page's checks append into
    //     it, so the accumulated FAIL marks of earlier inline pages would be
    //     indistinguishable from THIS page's failures. The children are
    //     SNAPSHOTTED and RESTORED around the run (a per-run view), so the
    //     `demo-check-banner-census` guard's end-of-run FAIL-mark walk and the
    //     banner collection still see every earlier page's elements — and this
    //     page's own banner is captured for the guard's line.
    // NOTHING ASSERTED IS WEAKENED: the page's checks run against a fresh `#app`
    // exactly as the d12 pages do in their isolated workers.
    byId.delete('app')
    // Give THIS page its own `#results` element (the runner appends its check
    // list there): the accumulated list of the earlier inline pages must not be
    // mixed with this page's checks, and this page's FAIL marks must not be left
    // behind for the end-of-run `demo-check-banner-census` walk. The shim's
    // `getElementById` auto-creates the element, so dropping it and asking again
    // yields a FRESH one; the caller's original element is restored after every
    // run (see `restoreResults`).
    byId.delete('results')
    const resultsEl = document.getElementById('results')
    seedPage(built.html)
    // the page's OWN embedded census expectation (parsed from the built HTML,
    // the same bytes the browser serves) — read before the module runs so a
    // page-side expectation drift is caught even if the page's checks were
    // weakened.
    let embeddedExpected = null
    try {
      embeddedExpected = JSON.parse(extractScript(built.html, 'server-data')).expected ?? null
    } catch (e) {
      embeddedExpected = null
    }
    let mod = null
    let importError = null
    // CAPTURE this page's own done-promise IMMEDIATELY after the import: the
    // page publishes it as the SHARED global `__pathForkDone` (one slot for the
    // whole process), so a later page instance would overwrite it and awaiting
    // the global would then wait on the WRONG run (measured: that made an
    // earlier page's promise resolve while this run was still going, and its
    // check list was read mid-flight).
    let pageDone = null
    try {
      mod = await import(`${base}demo/path-fork-data.js?shallow=${method}-${depth}`)
      pageDone = globalThis.__pathForkDone ?? null
    } catch (e) {
      importError = e && e.message ? e.message : String(e)
    }
    // the page's `main()` promise settles after every check has RUN (the runner
    // catches a failed check and records it — it does NOT reject), so the
    // promise alone is not the page-level assertion; the BANNER assertion below
    // is (the same `0 failed` contract `demo-check-banner-census` reads).
    let checkError = null
    if (importError === null && pageDone) {
      try {
        await Promise.race([
          pageDone,
          new Promise((r) => setTimeout(r, PAGE_WAIT_MS)),
        ])
      } catch (e) {
        checkError = e && e.message ? e.message : String(e)
      }
    }
    const profile = globalThis.__pathForkProfile ?? null
    // capture THIS run's banner before restoring the accumulated check list
    const shallowBanners = []
    const walkResults = (el) => {
      // NOTE the class comparison: the runner writes `runner-banner ok` /
      // `runner-banner bad` (demo/lib/runner.js), so an exact `=== 'runner-banner'`
      // match never fires — the banner is found by its `<n> passed, <m> failed`
      // text instead (the same shape `collectBanners`'s own text test accepts).
      if (typeof el.textContent === 'string' && /\d+ passed, \d+ failed/.test(el.textContent)) shallowBanners.push(el.textContent)
      for (const c of el.children ?? []) walkResults(c)
    }
    walkResults(resultsEl)
    // THE PAGE-LEVEL ASSERTION: `runner.check` CATCHES a failed check (it counts
    // it and records the detail — it never rejects), so the awaited done-promise
    // alone cannot prove the page's checks passed. The banner the page's own
    // runner wrote (`<title>: N passed, M failed`) is that proof, and it is the
    // SAME contract `demo-check-banner-census` reads for the d12 pages.
    const pageBanner = shallowBanners.find((b) => /\d+ passed, \d+ failed/.test(b)) ?? null
    // REPORTED, not asserted (see the RESIDUAL/CLOSED note in this guard's
    // header): the d2/link page's own `treeFromOps` check USED to report one
    // failure here — a stale `2^d − 1` expectation that the FD7-D2-LINK-CENSUS
    // ruling had already corrected everywhere else in the page (a real
    // page-check defect, reproduced standalone in the isolated worker; FIXED
    // 2026-09-23 in `demo/path-fork-data.js` — `FD7-D2-LINK-TREEFROMOPS-CHECK`).
    // The arm stays a REPORT: this guard asserts three INDEPENDENT measurement
    // sources below (builder expectation / embedded page expectation / live page
    // profile + a fresh emit), and prints every mounted page's banner so an
    // unexplained page-side failure can never pass silently.
    if (pageBanner === null) {
      console.error(`derived-fork shallow census d${depth}/${method}: the page published no runner banner — its checks could not be read (reported for visibility)`)
    } else if (!/ 0 failed$/.test(pageBanner.trim())) {
      console.error(`derived-fork shallow census d${depth}/${method}: NOTE — the page's own runner banner reports "${pageBanner.trim()}" (the measurements this guard asserts are correct; see the guard header note)`)
    }
    pageBanners.push(`${method} d${depth}: ${pageBanner ? pageBanner.trim() : 'no banner'}`)
    // this page's own check elements are DISCARDED with its private `#results`
    // (the caller restores the shared element after the sweep) — they are
    // reported through the banner line above, and leaving them behind would
    // re-introduce the stale-FAIL ambiguity for every later page.
    bannerCensusExtras.push(...shallowBanners.map((b) => `[shallow-page] ${b}`))
    // the page sets the compile-pass logging ON at import; turn it back off so
    // this guard and the following ones are not flooded (the page publishes the
    // toggle as a global — the smoke does not import debug.js itself). The
    // global ITSELF is left in place: every subsequent page import re-assigns
    // it, and no later guard reads it.
    if (typeof globalThis.setCompilePassLogging === 'function') globalThis.setCompilePassLogging(false)
    return { mod, profile, embeddedExpected, importError, checkError }
  }
  // the SWEPT points: the two shallow depths (where the relation must hold
  // exactly, d2/link included) + a d12 control. The shallow depths are cheap
  // (3 and 7 path-states); d12's own census is asserted by the
  // `static-path-census` guard's isolated page runs above, so the deep control
  // here checks the builder expectation + ONE independent d12 enumeration (the
  // link variant — the only method whose shallow term is non-zero).
  // SAVE the shared `#results` element (the earlier inline pages' check list)
  // BEFORE swapping in the per-run ones; restored in the `finally` below so the
  // end-of-run banner / FAIL-mark walk sees exactly what it saw before this
  // guard ran.
  const sharedResults = byId.get('results') ?? null
  const restoreResults = () => {
    if (sharedResults) byId.set('results', sharedResults)
    else byId.delete('results')
  }
  // HYGIENE SCOPE (2026-09-23 — the `setCompilePassLogging` RACE, defect row
  // MODE-TOGGLE-SETCOMPILEPASSLOGGING-RACE): `setCompilePassLogging` is NOT a
  // global this guard's pages own — several earlier pages install it
  // (`demo/lib/feature-matrix-tests.js:33`, `demo/components.js:28`, …) and the
  // mode-toggle arms read it from a check
  // (`demo/lib/feature-matrix-tests.js:538`, `SSR-H2`) — and those arms are
  // imported WITHOUT awaiting their checks (no done-global; the smoke awaits
  // their BANNER at the end instead). So the end-of-guard delete used to be able
  // to strip a global an IN-FLIGHT earlier page's check was about to read,
  // making `demo-check-banner-census` fail intermittently (measured 1 run in 3:
  // `Mode toggle — markdown: 13 passed, 1 failed — setCompilePassLogging not
  // exposed`, reproduced deterministically by deleting the global while that
  // page's checks are in flight). The guard now RESTORES what it found: the
  // pre-guard value when the global existed, an absent slot when it did not —
  // per-page hygiene that neither clobbers another page's state nor leaves a
  // global this guard alone introduced.
  const priorSetCompilePassLogging = globalThis.setCompilePassLogging
  const shallowDepths = [2, 3]
  const methods = ['placement', 'values', 'link']
  const rows = []
  /** Each mounted page's own runner banner (reported on this guard's line). */
  const pageBanners = []
  let failed = false
  try {
  for (const depth of shallowDepths) {
    for (const method of methods) {
      const states = 2 ** depth - 1
      const run = await runShallowPage(method, depth)
      if (run.importError !== null) {
        console.error(`derived-fork shallow census d${depth}/${method}: the page module import failed: ${run.importError}`)
        guardLeaveFailed(gShallowCensus, `page import failed at d${depth}/${method}`)
        failed = true
        continue
      }
      if (run.checkError !== null) {
        console.error(`derived-fork shallow census d${depth}/${method}: the PAGE'S OWN CHECKS failed: ${run.checkError}`)
        guardLeaveFailed(gShallowCensus, `page checks failed at d${depth}/${method}`)
        failed = true
        continue
      }
      if (run.profile === null) {
        console.error(`derived-fork shallow census d${depth}/${method}: the page published NO profile — a page that profiles nothing cannot be pinned`)
        guardLeaveFailed(gShallowCensus, `no profile at d${depth}/${method}`)
        failed = true
        continue
      }
      const { pathForkServerData, buildPathForkSurface, derivedDefFillChildlessCount } = run.mod
      const defFill = derivedDefFillChildlessCount(method, depth)
      const derivedElements = states + defFill
      // THREE sources of the expectation, all independent of one another:
      //   (a) the page HTML's OWN embedded `server-data.expected` (the bytes the
      //       browser is served);
      //   (b) the builder derivation re-run here (`pathForkServerData`);
      //   (c) the measured census below (live page profile + a fresh emit).
      const embedded = run.embeddedExpected
      const expected = pathForkServerData(method, depth).expected
      if (embedded === null) {
        console.error(`derived-fork shallow census d${depth}/${method}: the built page HTML carries no parsable server-data.expected — the page-side census expectation is unreadable`)
        guardLeaveFailed(gShallowCensus, `embedded expectation unreadable at d${depth}/${method}`)
        failed = true
        continue
      }
      if (embedded.states !== states || embedded.elements !== derivedElements) {
        console.error(`derived-fork shallow census d${depth}/${method}: the PAGE'S OWN embedded expectation is states=${embedded.states} elements=${embedded.elements}, the ruled relation reads ${states}/${derivedElements}`)
        guardLeaveFailed(gShallowCensus, `embedded expectation off the relation at d${depth}/${method}`)
        failed = true
        continue
      }
      // (a) the builder's derived expectation must BE the ruled relation
      if (expected.states !== states || expected.elements !== derivedElements) {
        console.error(`derived-fork shallow census d${depth}/${method}: the builder's derived expectation is states=${expected.states} elements=${expected.elements}, the ruled relation reads states=${states} elements=${derivedElements} (2^d − 1 + the childless def-host def-fill term) — the builder expectation drifted from the ruled relation`)
        guardLeaveFailed(gShallowCensus, `builder expectation drifted at d${depth}/${method}`)
        failed = true
        continue
      }
      // (b) the RUNNING PAGE's own published census must match it (the page
      // measured its own emit — a different source from the builder arithmetic)
      if (run.profile.elements !== derivedElements || run.profile.states !== states) {
        console.error(`derived-fork shallow census d${depth}/${method}: the live page published states=${run.profile.states} elements=${run.profile.elements}, the ruled relation reads ${states}/${derivedElements}`)
        guardLeaveFailed(gShallowCensus, `live page census off the relation at d${depth}/${method}`)
        failed = true
        continue
      }
      // (c) an INDEPENDENT re-measurement of the same envelope
      let els
      let actionable
      try {
        const surface = buildPathForkSurface(method, depth)
        els = surface.els
        actionable = surface.actionable
      } catch (e) {
        console.error(`derived-fork shallow census d${depth}/${method}: the enumeration/emit pipeline threw: ${e && e.message ? e.message : e}`)
        guardLeaveFailed(gShallowCensus, `pipeline threw at d${depth}/${method}`)
        failed = true
        continue
      }
      const stateWires = new Set(actionable.map((s) => s.pathKey))
      const fillEls = els.filter((e) => !stateWires.has(e.wire))
      const standaloneEls = els.filter((e) => stateWires.has(e.wire))
      if (els.length !== derivedElements) {
        console.error(`derived-fork shallow census d${depth}/${method}: MEASURED elements=${els.length}, the ruled relation reads ${derivedElements} (${states} path-states + ${defFill} def-fill) — a def-fill phantom (2·(2^d − 1) + 1) or a vanished fill moves this number`)
        guardLeaveFailed(gShallowCensus, `measured element census off the ruled relation at d${depth}/${method}`)
        failed = true
        continue
      }
      if (standaloneEls.length !== states || fillEls.length !== defFill) {
        console.error(`derived-fork shallow census d${depth}/${method}: measured standalone=${standaloneEls.length} (expected ${states}) synthetic def-fill=${fillEls.length} (expected ${defFill})`)
        guardLeaveFailed(gShallowCensus, `standalone/def-fill split off at d${depth}/${method}`)
        failed = true
        continue
      }
      if (depth === 2 && method === 'link') {
        // the explicit d2/link PIN: 7 = 3 + 4, with the 4 SHAPED as the
        // documented def-fill children (not phantom path-state emissions)
        if (els.length !== 7) {
          console.error(`derived-fork shallow census d2/link: measured elements=${els.length}, the ruled value is 7 = 3 path-states + 4 def-fill children — the shallow exception to 2^d − 1 (render-helpers.ts:743-746)`)
          guardLeaveFailed(gShallowCensus, 'the d2/link pin 7 = 3 + 4 does not hold')
          failed = true
          continue
        }
        let shaped = true
        for (const e of fillEls) {
          const m = /^(.*):([ab])$/.exec(String(e.wire))
          if (!m || !stateWires.has(m[1])) {
            console.error(`derived-fork shallow census d2/link: def-fill element ${e.wire} is not a <hostWire>:<bind> synthetic child of a path-state — the documented fill shape is violated (a phantom re-emission carries a real path-state wire)`)
            shaped = false
            break
          }
        }
        if (!shaped) {
          guardLeaveFailed(gShallowCensus, 'the d2/link def-fill elements are not shaped like the documented def-fill children')
          failed = true
          continue
        }
      }
      rows.push(`d${depth}/${method}: page+builder elements=${els.length} (states=${states}${defFill ? ` + defFill=${defFill}` : ''})`)
    }
  }
  // d12 CONTROL — the deep side of the relation must still be plain 2^d − 1 for
  // every method (the builder's derived expectation; the page-side d12 census is
  // pinned live by `static-path-census`), PLUS one independent d12 enumeration
  // (the link variant) so the deep side is measured, not merely asserted.
  const d12Control = await runShallowPage('link', 12).catch((e) => ({ importError: e && e.message ? e.message : String(e) }))
  if (d12Control && d12Control.profile) {
    if (d12Control.profile.elements !== 4095 || d12Control.profile.states !== 4095) {
      console.error(`derived-fork shallow census d12/link: the live page published states=${d12Control.profile.states} elements=${d12Control.profile.elements}, expected 4095/4095 (the deep side of the ruled relation)`)
      guardLeaveFailed(gShallowCensus, 'the d12 control page off 4095 at link')
      failed = true
    } else {
      rows.push('d12/link: page elements=4095 (measured live)')
    }
  } else if (d12Control) {
    console.error(`derived-fork shallow census d12/link: the control page did not publish a profile (import=${d12Control.importError ?? 'ok'} checks=${d12Control.checkError ?? 'ok'})`)
    guardLeaveFailed(gShallowCensus, 'the d12 control page published no profile')
    failed = true
  }
  const d12Mod = d12Control && d12Control.mod ? d12Control.mod : null
  for (const method of methods) {
    // the builder expectation needs the module exports; the link point above
    // already has them, so re-import the module once for the control loop
    if (d12Mod === null) break
    const expected = d12Mod.pathForkServerData(method, 12).expected
    if (expected.elements !== 2 ** 12 - 1 || expected.states !== 2 ** 12 - 1) {
      console.error(`derived-fork shallow census d12/${method}: the builder derives states=${expected.states} elements=${expected.elements}, expected 4095/4095 (2^12 − 1 — the deep side of the ruled relation; the shallow def-fill term is 0 from d3 on)`)
      guardLeaveFailed(gShallowCensus, `the d12 builder control off 4095 at ${method}`)
      failed = true
      continue
    }
    if (method !== 'link') rows.push(`d12/${method}: builder elements=4095 (page census asserted live by static-path-census)`)
  }
  // HYGIENE: the page runs left the page's globals + the shim's seeded scripts
  // behind; clear the page's own globals (the shim's ids are reseeded by every
  // later seedPage/seedRawText call). `setCompilePassLogging` is NOT page-private
  // (see the HYGIENE SCOPE note above): restore the state this guard found
  // instead of deleting a global earlier pages installed and their in-flight
  // checks may still read.
  Reflect.deleteProperty(globalThis, '__pathForkDone')
  Reflect.deleteProperty(globalThis, '__pathForkProfile')
  if (typeof priorSetCompilePassLogging === 'function') {
    globalThis.setCompilePassLogging = priorSetCompilePassLogging
  } else {
    Reflect.deleteProperty(globalThis, 'setCompilePassLogging')
  }
  console.log(`[derived-fork:shallow-census] ${rows.join(' | ')} — relation: elements = 2^d − 1 at every (depth, method) EXCEPT d2/link = 7 = 3 + 4 (the childless level-1 def hosts' standalone P-EMIT-3 def-fill; render-helpers.ts:743-746, render.md:224 DFC-1 — DOCUMENTED boundary, FD7-D2-LINK-CENSUS FIXED-as-stale-expectation)${failed ? ' — FAILED' : ' — all points agree (builder expectation + embedded page expectation + live page census + independent re-measurement)'}`)
  console.log(`[derived-fork:shallow-census:pagers] ${pageBanners.join(' | ')}`)
  if (pageBanners.some((b) => !/ 0 failed$/.test(b))) {
    console.error(`[derived-fork:shallow-census:pagers] at least one shallow page's own runner banner is not 0-failed — see the NOTE lines above`)
  }
  } finally {
    // the shared check list is restored even if a page run threw outright
    restoreResults()
  }
})
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
// MEASUREMENT REPAIR (2026-09-22 — DEFECT SMOKE-TRIPWIRE-INERT): the runtime 3×
// total tripwire then read the RUNTIME `fork-stress-d12.html` total
// (`runtimeForkTotals[RUNTIME_FORK_TRIPWIRE_DEPTH]` — captured by the runtime
// loop above), NOT `d12Totals['placement']` (the PLACEMENT-DERIVED page's
// total, which the guard consumed until that repair: the comparison it then
// performed was derived-vs-derived, so the runtime:derived blow-up signature
// the tripwire existed to catch was never measured).
//
// ✎ SUPERSEDED 2026-09-23 — THE USER'S GUARD RULING (this replaces the failing
// 3× cross-family assertion; docs/decisions.md RUNTIME-FORK-GROWTH-GUARD, which
// supersedes RUNTIME-FORK-TRIPWIRE-BOUND):
// The two operands the 3× cross-family comparison used are **page totals over
// DIFFERENT CONSTRUCTION METHODS**, measured 2026-09-23 through the isolated
// worker:
//   * the DERIVED operand (`demo/path-fork-data.html`, `method=placement`)
//     holds **23 real nodes** and produces **4095 path-states/wires** by **one
//     bootstrap enumeration pass** (`passes=1`, 1 render, 0 handlers,
//     0 flush yields, `compile=33.1ms`), page total **168.6ms**;
//   * the RUNTIME operand (`demo/fork-stress-d12.html`) holds **4095 real
//     nodes**, built **incrementally** through the four layer mechanisms
//     (`new Node(...)` per node; 10 renders, 137 handlers, 11 flush yields,
//     `pass2=700.7ms` + `compile=469.8ms`), page total **1367.8ms**.
// So the cross-family ratio (~8.1× post-R1) measures the CONSTRUCTION-PATH
// DIFFERENCE, not engine scaling — and the original 3× bound had been
// calibrated on a derived-vs-derived reading (~1.0×, the SMOKE-TRIPWIRE-INERT
// artefact), which is why it could never be met honestly.
// THE RULING: the guard becomes **RUNTIME-VS-RUNTIME** — the same page family
// timed against ITSELF at two depths (same construction path, different node
// counts), so a super-linear per-node regression is detected without the
// construction-method confound. The cross-family measurement is KEPT BELOW as
// an **INFORMATIONAL** print only (`[runtime-fork:tripwire]`), explicitly
// labelled a CONSTRUCTION-COST ratio, NOT a like-workload metric, with both
// sets' composition stated so nobody re-reads it as a scaling signal.
const runtimeForkD12Prof = runtimeForkTotals[RUNTIME_FORK_TRIPWIRE_DEPTH] ?? null
const runtimeForkD12Total = runtimeForkD12Prof ? runtimeForkD12Prof.totalMs : 0
const derivedPlacementD12Total = derivedBase[RUNTIME_FORK_TRIPWIRE_DEPTH]?.totalMs ?? 0
const runtimeDerivedRatio = derivedPlacementD12Total > 0 ? runtimeForkD12Total / derivedPlacementD12Total : 0

// ---- THE RUNTIME-VS-RUNTIME GROWTH GUARD (the smoke's failing scaling signal,
//      per the 2026-09-23 ruling) --------------------------------------------
// The two depths are BOTH runtime `fork-stress-d<d>.html` pages already run by
// the `runtime-fork-stress-census` loop above (same module, same query shape,
// same isolated worker, same construction path): d10 (2^10 − 1 = 1023 nodes)
// and d12 (2^12 − 1 = 4095 nodes) — node count ×4. d14 is NOT used: it is
// BUILT-BUT-NOT-SMOKE-RUN by design (AGENTS.md item 4).
const RUNTIME_GROWTH_LOW_DEPTH = 10
const RUNTIME_GROWTH_HIGH_DEPTH = 12
// (The node-count multiple between the two depths — 2^(12−10) = 4 — is DERIVED
// at every use site and PRINTED on the envelope line, never assumed: a guard
// whose multiple changed silently would be a different guard.)
// THE STATISTIC: the **pass-2 ratio** between d12 and d10.
// WHY pass-2 (and not the page-total ratio): it is BOTH the most stable AND the
// most sensitive of the three candidates, measured on this tree 2026-09-23
// through the isolated worker at each depth TWICE (and once more inside a full
// smoke run):
//   statistic        r1      r2     smoke   spread
//   pass2 ratio     7.65×   7.54×   7.70×   ±1.5%
//   total ratio     8.51×   8.29×   7.41×   ±3.0%
//   per-node ratio  2.13×   2.07×    —      ±4.6%
// (the per-node ratio is the pass2 ratio ÷ the node multiple, so it carries the
// worst spread and adds nothing); the TOTAL ratio is noisier because its
// remainder (`compile` ~460-470ms at d12 vs ~18ms at d10 — dominated by the
// page's whole-tree `recompileFocusedFor` calls) has a run-to-run spread an
// order of magnitude wider than pass-2's. pass-2 is ALSO where the
// super-linearity this guard exists for lives: the runtime page's pass-2 is
// ~84% of its d12 total and every documented amplification lever (R1 landed,
// R2/R3/R4/R5/R6 open) is a pass-2 / pass-2-feeding cost, and a per-node
// regression in `compile` (whose passes the pass-2 flushes drive) moves the
// pass-2 term with it.
// THE MEASURED ENVELOPE (d10 → d12 pass-2, ALL readings on this tree):
//   r1 105.9 → 699.6 = 6.61× (isolated worker) · r2 112.4 → 682.4 = 6.07× ·
//   full-smoke runs 113.1 → 687.4 = 6.08× and 111.4 → 687.9 = 6.18× ·
//   baseline smoke run 111.4 → ~858 = 7.70× ⇒ envelope **6.07-7.70×**
//   (per-node **1.52-1.92×** per 4× nodes — the ~2.0×/depth super-linearity the
//   pass-2 lead records: the honest CURRENT curve, NOT linear, and the residual
//   work is OPEN, docs/defects.md RUNTIME-FORK-PASS2-RATIO — not a blow-up).
// The FULL adjacent-pair measurement set (isolated worker at each depth TWICE,
// `[fork-stress:profile]`; the guard's two operands are the last row's endpoints):
//   depth  nodes  total ms (r1/r2)   pass2 ms (r1/r2)  compile ms (r1/r2)
//     8      255    49.0 / 44.5       24.3 / 21.8       7.3 / 7.0
//     9      511    87.2 / 88.3       55.8 / 56.4       7.1 / 7.4
//    10     1023   177.1 / 179.5     105.9 / 112.4     18.1 / 18.6
//    11     2047   461.7 / 484.8     264.3 / 277.1    107.3 / 115.3
//    12     4095  1356.4 / 1319.5    699.6 / 682.4    470.4 / 459.3
//  adjacent pass-2 ratios (r1/r2): d8→d9 2.30/2.59 · d9→d10 1.90/1.99 ·
//  d10→d11 2.50/2.46 · d11→d12 2.65/2.46; TOTAL ratios: 1.78/1.98 · 2.03/2.03 ·
//  2.61/2.70 · 2.94/2.72. Per-node pass-2 across the whole d8→d12 span (16× the
//  nodes): 28.8× (r1) / 31.3× (r2) ⇒ **1.80× / 1.96× PER NODE**; per-node TOTAL:
//  1.73× / 1.85× — the honest current curve, super-linear but far from a blow-up.
// THE BOUND AND ITS MARGIN: **10×** ⇒ **1.30× margin** over the 7.70× envelope
// top (and 1.65× over the 6.07× low reading). It is NOT chosen to "make today
// pass": the O(n²)-era blow-up signature this guard CLASS exists for — the
// ~20×/depth step the tripwire was originally calibrated against — compounds to
// ≈4·6.61² ≈ **105×** over a 4× node step, and even the mildest honest
// degradation worth catching (per-node pass-2 cost ×4 between d10 and d12, i.e.
// the same "each depth costs a constant multiple more per node" shape at one
// step) reads ≈**26×** — both far above 10×. The bound's floor is the noise
// envelope plus its margin (7.70 × 1.30 = 10.0), so run-to-run noise cannot
// trip it, while 4× or worse per-node degradation always does.
const RUNTIME_GROWTH_BOUND_MULTIPLE = 10
// The failure message NAMES what a breach means: per-node pass-2 cost degrading
// super-linearly (the class), not "the page got slower".
/** The growth guard's ASSERTION, as a PURE function of its two operands (no
 *  harness state, no `process.exit`), so the reachability suite can extract this
 *  function's SOURCE and drive it with a FABRICATED breaching profile — the
 *  guard's falsifiability is thereby demonstrable offline (the
 *  `assertForkStressCensus` extraction technique). Returns the violation reason,
 *  or `''` when the guard holds. */
function assertRuntimeForkGrowth(lowPass2Ms, highPass2Ms, lowDepth, highDepth, boundMultiple) {
  if (!(typeof lowPass2Ms === 'number' && lowPass2Ms > 0)) {
    console.error(`runtime fork growth guard: depth ${lowDepth} pass-2 baseline absent (${lowPass2Ms}) — the pin cannot be evaluated`)
    return `depth ${lowDepth}: pass2 absent (baseline absent — the growth pin cannot be evaluated)`
  }
  if (!(typeof highPass2Ms === 'number' && highPass2Ms > 0)) {
    console.error(`runtime fork growth guard: depth ${highDepth} pass-2 reading absent (${highPass2Ms}) — the pin cannot be evaluated`)
    return `depth ${highDepth}: pass2 absent (the growth pin cannot be evaluated)`
  }
  const ratio = highPass2Ms / lowPass2Ms
  if (ratio > boundMultiple) {
    console.error(
      `runtime fork growth guard BREACH: depth ${highDepth} pass2=${highPass2Ms.toFixed(1)}ms / depth ${lowDepth} pass2=${lowPass2Ms.toFixed(1)}ms `
      + `= ${ratio.toFixed(2)}× over ${(2 ** (highDepth - lowDepth))}× the nodes (bound ${boundMultiple}×) — this means PER-NODE PASS-2 COST IS DEGRADING SUPER-LINEARLY: `
      + `the engine's pass-2 work per node grows with depth (an O(n²)-era return, a per-flush slice that no longer scales, or a new per-visit cost in the focused recompile), not merely "the page is slower"`,
    )
    return `the runtime-vs-runtime growth bound is exceeded (${ratio.toFixed(2)}× > ${boundMultiple}× over ${(2 ** (highDepth - lowDepth))}× the nodes) — per-node pass-2 cost is degrading super-linearly`
  }
  return ''
}
// §4 guard — the runtime-vs-runtime growth guard (the failing scaling signal).
await runGuard('runtime-fork-growth-guard', (gGrowth) => {
  const lowProf = runtimeForkTotals[RUNTIME_GROWTH_LOW_DEPTH]
  const highProf = runtimeForkTotals[RUNTIME_GROWTH_HIGH_DEPTH]
  const lowPass2 = lowProf ? lowProf.pass2Ms : undefined
  const highPass2 = highProf ? highProf.pass2Ms : undefined
  // ---- INFORMATIONAL ONLY (NOT an assertion, by the ruling) ---------------
  // The former failing 3× cross-family tripwire's measurement, kept and
  // explicitly labelled: these two totals are CONSTRUCTION COSTS over DIFFERENT
  // METHODS (a 23-real-node one-pass path enumeration vs a 4095-real-node
  // incremental layer build), so this ratio is NOT a scaling signal and nothing
  // fails on it. (docs/decisions.md RUNTIME-FORK-TRIPWIRE-BOUND — SUPERSEDED.)
  console.log(
    `[runtime-fork:tripwire] INFORMATIONAL (construction-cost ratio, NOT a like-workload metric — no longer asserted): `
    + `runtime fork-stress d${RUNTIME_FORK_TRIPWIRE_DEPTH} total=${runtimeForkD12Total.toFixed(1)}ms `
    + `[4095 real nodes, built INCREMENTALLY: 10 renders, 137 handlers, 11 flush yields, pass2≈${Number.isFinite(highPass2) ? highPass2.toFixed(1) : 'n/a'}ms + compile≈${runtimeForkD12Prof ? (runtimeForkD12Prof.compileMs ?? 0).toFixed(1) : 'n/a'}ms] `
    + `vs placement-derived baseline ${derivedPlacementD12Total.toFixed(1)}ms `
    + `[23 real nodes → 4095 path-states/wires by ONE bootstrap enumeration pass: passes=1, 1 render, 0 handlers, 0 flush yields, compile≈33.1ms] `
    + `= ${runtimeDerivedRatio.toFixed(2)}× — a CONSTRUCTION-METHOD cost ratio, NOT engine scaling; superseded as an assertion 2026-09-23 (docs/decisions.md RUNTIME-FORK-GROWTH-GUARD)`,
  )
  // ---- THE GUARD'S PRINTED ENVELOPE (both depths' totals + the ratio + the
  //      bound + the margin), printed on BOTH arms, before the decision -------
  const envelopeLine = () => {
    const nodeMultiple = (2 ** (RUNTIME_GROWTH_HIGH_DEPTH - RUNTIME_GROWTH_LOW_DEPTH))
    if (!(typeof lowPass2 === 'number' && lowPass2 > 0) || !(typeof highPass2 === 'number' && highPass2 > 0)) {
      return `low d${RUNTIME_GROWTH_LOW_DEPTH} pass2=${lowPass2 ?? 'absent'} high d${RUNTIME_GROWTH_HIGH_DEPTH} pass2=${highPass2 ?? 'absent'} — the growth pin CANNOT be evaluated (baseline absent)`
    }
    const ratio = highPass2 / lowPass2
    const margin = RUNTIME_GROWTH_BOUND_MULTIPLE / ratio
    return `d${RUNTIME_GROWTH_LOW_DEPTH} nodes=${2 ** RUNTIME_GROWTH_LOW_DEPTH - 1} pass2=${lowPass2.toFixed(1)}ms total=${(lowProf.totalMs).toFixed(1)}ms `
      + `→ d${RUNTIME_GROWTH_HIGH_DEPTH} nodes=${2 ** RUNTIME_GROWTH_HIGH_DEPTH - 1} pass2=${highPass2.toFixed(1)}ms total=${(highProf.totalMs).toFixed(1)}ms `
      + `= pass2-ratio ${ratio.toFixed(2)}× / total-ratio ${(highProf.totalMs / lowProf.totalMs).toFixed(2)}× over ${nodeMultiple}× the nodes `
      + `(per-node ${(ratio / nodeMultiple).toFixed(2)}×); bound ${RUNTIME_GROWTH_BOUND_MULTIPLE}×; margin ${margin.toFixed(2)}×`
  }
  console.log(`[runtime-fork:growth] STATISTIC=pass2-ratio (most stable: ±1.5% over repeats; the total ratio spreads ±3.0%) — ${envelopeLine()}`)
  if (guardFaulted('runtime-fork-growth-guard')) {
    console.error(`runtime fork growth guard fault-injected (PP_SMOKE_FAULT) — the guard takes its own failure path (the later censuses must still enter and report)`)
    guardLeaveFailed(gGrowth, 'injected by PP_SMOKE_FAULT (the reachability seam)')
    return
  }
  const violation = assertRuntimeForkGrowth(
    lowPass2, highPass2,
    RUNTIME_GROWTH_LOW_DEPTH, RUNTIME_GROWTH_HIGH_DEPTH, RUNTIME_GROWTH_BOUND_MULTIPLE,
  )
  if (violation !== '') {
    guardLeaveFailed(
      gGrowth,
      `${violation} — envelope: ${envelopeLine()} [the cross-family ${runtimeDerivedRatio.toFixed(2)}× above is NOT the signal: different construction methods]`,
    )
  }
})

// ---- feature-showcase page: one legacy envelope, every feature, data-only ---
// The page input is a LEGACY JSON envelope (translateLegacy input). Handler
// bodies ship as function-STRING data; the module is core-only plumbing.
// §4 guard: this block used to be an UNGUARDED page import with a raw
// `process.exit(1)` — a failure between the runtime scaling signal and the
// censuses that bypassed the aggregation (audit finding 1). It is a guard now.
await runGuard('feature-showcase-page', async (gPage) => {
  await importInlinePage('demo/feature-showcase.html', 'demo/feature-showcase.js', '__featureShowcaseDone', PAGE_WAIT_MS, 'feature-showcase')
    .catch((e) => guardLeaveFailed(gPage, e.message))
})

// ---- translate-showcase page: translate-layer kernel (K1–K8) + reverse ------
// ONE legacy envelope; the module translates it, renders the 9 cards through
// the core path, and checks the reverse round-trip (R-2/R-5).
await runGuard('translate-showcase-page', async (gPage) => {
  await importInlinePage('demo/translate-showcase.html', 'demo/translate-showcase.js', '__translateShowcaseDone', PAGE_WAIT_MS, 'translate-showcase')
    .catch((e) => guardLeaveFailed(gPage, e.message))
})

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
      return false
    }
  }
  if (prof.registered !== 17) {
    console.error(`legacy-shape census registered mismatch: registered=${prof.registered}, expected 17 (16 envelope nodes + the blind-test fixture root)`)
    return false
  }
  if (prof.inTree !== 14) {
    console.error(`legacy-shape census in-tree mismatch: inTree=${prof.inTree}, expected 14 (the seam-resolved menu subtree realizes in-tree — DEFECT #24; 3 unresolved def prototypes stay out-of-tree)`)
    return false
  }
  if (prof.prototypes !== 3) {
    console.error(`legacy-shape census prototypes mismatch: prototypes=${prof.prototypes}, expected 3 (unresolved def roots/children, 'component'-token pre-minted)`)
    return false
  }
  if (prof.unplaced !== 0) {
    console.error(`legacy-shape census unplaced mismatch: unplaced=${prof.unplaced}, expected 0`)
    return false
  }
  if (prof.destroyed !== 0) {
    console.error(`legacy-shape census destroyed mismatch: destroyed=${prof.destroyed}, expected 0`)
    return false
  }
  if (prof.cloneOps !== 0) {
    console.error(`legacy-shape census cloneOps mismatch: cloneOps=${prof.cloneOps}, expected 0 (no clone-instance ops)`)
    return false
  }
  if (prof.states !== 12) {
    console.error(`legacy-shape census states mismatch: states=${prof.states}, expected 12 (10 family states + 2 placement path-states)`)
    return false
  }
  if (prof.elements !== 16) {
    console.error(`legacy-shape census elements mismatch: elements=${prof.elements}, expected 16`)
    return false
  }
  if (prof.passes !== 1) {
    console.error(`legacy-shape bootstrap passes mismatch: passes=${prof.passes}, expected 1 (ONE compilePath bootstrap)`)
    return false
  }
  if (prof.warningsMain !== 0) {
    console.error(`legacy-shape main-envelope warnings mismatch: warnings=${prof.warningsMain}, expected 0 (zero K4 warnings)`)
    return false
  }
  if (prof.fanOut !== 2) {
    console.error(`legacy-shape fan-out mismatch: fanOut=${prof.fanOut}, expected 2 (both side-zone containers)`)
    return false
  }
  if (!Array.isArray(prof.stylesRules) || prof.stylesRules.length !== LEGACY_SHAPE_RULES.length || new Set(prof.stylesRules).size !== LEGACY_SHAPE_RULES.length) {
    console.error(`legacy-shape styles rules mismatch: got ${JSON.stringify(prof.stylesRules)}`)
    return false
  }
  for (const rule of LEGACY_SHAPE_RULES) {
    if (!prof.stylesRules.includes(rule)) {
      console.error(`legacy-shape styles rules missing ${rule}: ${JSON.stringify(prof.stylesRules)}`)
      return false
    }
  }
  return true
}

{
  // §4 guard 6 — THE legacy-shape census: the harness's ONLY component-family
  // clone census (17 nodes / 14 in-tree / 3 unresolved def prototypes /
  // measured cloneOps=0). This is the guard the old ordering made UNREACHABLE
  // on any run where the runtime growth guard above fired — it now enters and reports
  // AFTER the tripwire on every run (spec §4, acceptance criterion 1).
  await runGuard('legacy-shape-census', async (gLegacyCensus) => {
  const pageHtml = await readFile(`${base}demo/legacy-shape.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/legacy-shape.js`).catch((e) => {
    console.error('legacy-shape failed:', e)
    guardLeaveFailed(gLegacyCensus, `the page import failed: ${e && e.message ? e.message : e}`)
  })
  await Promise.race([
    globalThis.__legacyShapeDone,
    new Promise((r) => setTimeout(r, PAGE_WAIT_MS)),
  ]).catch(() => {})
  const prof = globalThis.__legacyShapeProfile
  if (!prof) {
    console.error('legacy-shape profile missing — page did not finish profiling')
    guardLeaveFailed(gLegacyCensus, 'the page did not finish profiling')
    return
  }
  // performance guard (same contract as the other pages): the timed sections
  // (incl. the ONE enumeration compile + the side-card renders + the checks)
  // must cover ~all of the page total, so "total" can never hide an untimed
  // pipeline (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`legacy-shape profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gLegacyCensus, 'profile residual too large')
    return
  }
  if (!assertLegacyShapeCensus(prof)) guardLeaveFailed(gLegacyCensus, 'census mismatch (see the message above)')
  })
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
  // §4 guard — this page's server-data census equality pin (enters and reports
  // even when the runtime growth guard above fired)
  await runGuard('handlers-scenarios-census', async (gCensus) => {
  const pageHtml = await readFile(`${base}demo/handlers-scenarios.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/handlers-scenarios.js`).catch((e) => {
    console.error('handlers-scenarios failed:', e)
    guardLeaveFailed(gCensus, `handlers-scenarios page import failed: ${e && e.message ? e.message : e}`)
  })
  await Promise.race([
    globalThis.__handlersScenariosDone,
    new Promise((r) => setTimeout(r, PAGE_WAIT_MS)),
  ]).catch(() => {})
  const prof = globalThis.__handlersScenariosProfile
  if (!prof) {
    console.error('handlers-scenarios profile missing — page did not finish profiling')
    guardLeaveFailed(gCensus, 'the page did not finish profiling (no profile global)')
    return
  }
  // performance guard (same contract as the other pages): the timed sections
  // (load/compile/phase/emit/diff/apply/checks) must cover ~all of the total,
  // so "total" can never hide an untimed pipeline (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`handlers-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gCensus, `guard clause failed: console.error('handlers-scenarios profile residual too large: \${residual.toFixed(1)}ms unmeasured of total=\${prof.totalMs.toFixed(1)}ms (\${(100 * covered / p`)
    return
  }
  const serverData = JSON.parse(byId.get('server-data').textContent)
  const exp = serverData.expected.census
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`handlers-scenarios census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      guardLeaveFailed(gCensus, `guard clause failed: console.error('handlers-scenarios census mismatch on "\${f}": page=\${prof[f]} expected=\${exp[f]}')`)
      return
    }
  }
  })
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
  // §4 guard — this page's server-data census equality pin (enters and reports
  // even when the runtime growth guard above fired)
  await runGuard('session-features-census', async (gCensus) => {
  const pageHtml = await readFile(`${base}demo/session-features.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/session-features.js`).catch((e) => {
    console.error('session-features failed:', e)
    guardLeaveFailed(gCensus, `session-features page import failed: ${e && e.message ? e.message : e}`)
  })
  await Promise.race([
    globalThis.__sessionFeaturesDone,
    new Promise((r) => setTimeout(r, PAGE_WAIT_MS)),
  ]).catch(() => {})
  const prof = globalThis.__sessionFeaturesProfile
  if (!prof) {
    console.error('session-features profile missing — page did not finish profiling')
    guardLeaveFailed(gCensus, 'the page did not finish profiling (no profile global)')
    return
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`session-features profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gCensus, `guard clause failed: console.error('session-features profile residual too large: \${residual.toFixed(1)}ms unmeasured of total=\${prof.totalMs.toFixed(1)}ms (\${(100 * covered / pro`)
    return
  }
  const serverData = JSON.parse(byId.get('server-data').textContent)
  const exp = serverData.expected.census
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`session-features census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      guardLeaveFailed(gCensus, `guard clause failed: console.error('session-features census mismatch on "\${f}": page=\${prof[f]} expected=\${exp[f]}')`)
      return
    }
  }
  })
}

// ---- producing-host page: REQ-GAP-8 (Group 4 — opt-in data-node-id) --------
// The exported canonical re-emit loop renderProducingProcess threading the
// opt-in renderOptions parameter; 5 mounts, 15 checks across 4 scenarios +
// controls. Census guard: the page publishes registered/inTree/unplaced/
// destroyed/prototypes/cloneOps on the profile; the builder ran the IDENTICAL
// core pipeline and embedded the expected census in server-data — the smoke
// pins equality.
{
  // §4 guard — this page's server-data census equality pin (enters and reports
  // even when the runtime growth guard above fired)
  await runGuard('producing-host-census', async (gCensus) => {
  const pageHtml = await readFile(`${base}demo/producing-host.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/producing-host.js`).catch((e) => {
    console.error('producing-host failed:', e)
    guardLeaveFailed(gCensus, `producing-host page import failed: ${e && e.message ? e.message : e}`)
  })
  await Promise.race([
    globalThis.__producingHostDone,
    new Promise((r) => setTimeout(r, PAGE_WAIT_MS)),
  ]).catch(() => {})
  const prof = globalThis.__producingHostProfile
  if (!prof) {
    console.error('producing-host profile missing — page did not finish profiling')
    guardLeaveFailed(gCensus, 'the page did not finish profiling (no profile global)')
    return
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`producing-host profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gCensus, `guard clause failed: console.error('producing-host profile residual too large: \${residual.toFixed(1)}ms unmeasured of total=\${prof.totalMs.toFixed(1)}ms (\${(100 * covered / prof.`)
    return
  }
  const serverData = JSON.parse(byId.get('server-data').textContent)
  const exp = serverData.expected.census
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`producing-host census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      guardLeaveFailed(gCensus, `guard clause failed: console.error('producing-host census mismatch on "\${f}": page=\${prof[f]} expected=\${exp[f]}')`)
      return
    }
  }
  })
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
// §4 guard — this page's server-data census equality pin (enters and reports
// even when the runtime growth guard above fired)
await runGuard('hooks-scenarios-census', async (gCensus) => {
  const prof = await importInlinePage('demo/hooks-scenarios.html', 'demo/hooks-scenarios.js', '__hooksScenariosDone', PAGE_WAIT_MS, 'hooks-scenarios')
  if (!prof) {
    console.error('hooks-scenarios profile missing — page did not finish profiling')
    guardLeaveFailed(gCensus, 'the page did not finish profiling (no profile global)')
    return
  }
  // performance guard (same contract as the other pages): the timed sections
  // (load/compile/flush/emit/diff/apply/checks) must cover ~all of the total,
  // so "total" can never hide an untimed pipeline (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`hooks-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gCensus, 'profile residual too large')
    return
  }
  // USER CONTRACT — the layer stack stays O(1): every hook-<name> write lands
  // ONE deterministic replace-in-place layer. `maxHookLayers` is the
  // page-measured max hook-layer count across ALL the scenario writes (the
  // 20-write stress + the control clicks); averaging <= 1 proves the stack
  // never grew.
  if (prof.maxHookLayers !== 1) {
    console.error(`hooks-scenarios USER CONTRACT violation: maxHookLayers=${prof.maxHookLayers}, expected 1 (N writes must land ONE deterministic hook-<name> layer)`)
    guardLeaveFailed(gCensus, 'the hook-layer stack grew (maxHookLayers ≠ 1)')
    return
  }
  const exp = expectedCensus(gCensus)
  if (exp === null) return
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`hooks-scenarios census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      guardLeaveFailed(gCensus, `census mismatch on "${f}"`)
    }
  }
})

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
await runGuard('hooks-array-scenarios-census', async (gCensus) => {
  const prof = await importInlinePage('demo/hooks-array-scenarios.html', 'demo/hooks-array-scenarios.js', '__hooksArrayScenariosDone', PAGE_WAIT_MS, 'hooks-array-scenarios')
  if (!prof) {
    console.error('hooks-array-scenarios profile missing — page did not finish profiling')
    guardLeaveFailed(gCensus, 'the page did not finish profiling (no profile global)')
    return
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`hooks-array-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gCensus, 'profile residual too large')
    return
  }
  // USER CONTRACT — the rows-mint mints exactly 3 rows
  if (prof.rowsMinted !== 3) {
    console.error(`hooks-array-scenarios USER CONTRACT violation: rowsMinted=${prof.rowsMinted}, expected 3`)
    guardLeaveFailed(gCensus, 'rowsMinted ≠ 3 (the rows-mint contract)')
    return
  }
  const exp = expectedCensus(gCensus)
  if (exp === null) return
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp[f]) {
      console.error(`hooks-array-scenarios census mismatch on "${f}": page=${prof[f]} expected=${exp[f]}`)
      guardLeaveFailed(gCensus, `census mismatch on "${f}"`)
    }
  }
})

// ---- rows-scenarios page: the rows demo gate (Feature 1/1.5) + the 1a -------
// round-trip arm. ONE legacy envelope (root + consumers section, the
// hooksKind declaration, the registered def prototype, the cross-row
// consumers); the module translates it, mirrors the handlers-scenarios
// pipeline, and the runner clicks the mint CONTROL — dispatching the REAL
// function-STRING body that drives rows-mint through clientAPI.apply — then
// asserts the 8 rendered rows, the per-row source values in the DOM (one
// consumer arm per row), the fan-out census (states-per-consumer = 8, the
// Feature 1.4 linearity pin fanoutStates <= 2 x fanoutRows), the node-scoped
// layer + Option-C record (DEFECT #23), the re-mint no-accumulation, and the
// Feature 1a round trip (serialize -> loadState -> seed -> reconcile ->
// reRegisterDefPrototypes -> host re-mint per the batches record -> the row
// count unchanged). Census + fan-out pin guards: the page publishes
// registered/inTree/unplaced/destroyed/prototypes/cloneOps + rowsMinted +
// fanoutStates/fanoutRows on the profile; the builder ran the IDENTICAL
// pipeline (incl. the click-driven mint) and embedded the expected in
// server-data — the smoke pins equality.
await runGuard('rows-scenarios-census', async (gCensus) => {
  const prof = await importInlinePage('demo/rows-scenarios.html', 'demo/rows-scenarios.js', '__rowsScenariosDone', PAGE_WAIT_MS, 'rows-scenarios')
  if (!prof) {
    console.error('rows-scenarios profile missing — page did not finish profiling')
    guardLeaveFailed(gCensus, 'the page did not finish profiling (no profile global)')
    return
  }
  // performance guard (same contract as the other pages): the timed sections
  // (load/compile/flush/emit/diff/apply/checks) must cover ~all of the total,
  // so "total" can never hide an untimed pipeline (RCA:
  // archive/reviews/2026-08-15/2026-08-15-session-defect-review.md).
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`rows-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gCensus, 'profile residual too large')
    return
  }
  const exp = expectedAll(gCensus)
  if (exp === null) return
  // census equality vs the builder's identical pipeline
  for (const f of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) {
    if (typeof prof[f] !== 'number' || prof[f] !== exp.census[f]) {
      console.error(`rows-scenarios census mismatch on "${f}": page=${prof[f]} expected=${exp.census[f]}`)
      guardLeaveFailed(gCensus, `census mismatch on "${f}"`)
    }
  }
  // USER CONTRACT — the rows-mint mints exactly 8 rows
  if (prof.rowsMinted !== exp.rowsMinted || exp.rowsMinted !== 8) {
    console.error(`rows-scenarios USER CONTRACT violation: rowsMinted=${prof.rowsMinted}, expected ${exp.rowsMinted} (8)`)
    guardLeaveFailed(gCensus, 'rowsMinted ≠ 8 (the rows-mint contract)')
  }
  // the fan-out census equality + the Feature 1.4 LINEARITY guard
  // (states-per-consumer <= 2 x rows — the tripwire's own pricing bound)
  if (prof.fanoutRows !== exp.fanoutRows || prof.fanoutStates !== exp.fanoutStates) {
    console.error(`rows-scenarios fan-out census mismatch: page fanoutStates=${prof.fanoutStates}/${prof.fanoutRows} expected ${exp.fanoutStates}/${exp.fanoutRows}`)
    guardLeaveFailed(gCensus, 'fan-out census mismatch')
  }
  if (prof.fanoutStates > 2 * prof.fanoutRows) {
    console.error(`rows-scenarios fan-out linearity guard breached: fanoutStates=${prof.fanoutStates} > 2 × fanoutRows=${prof.fanoutRows}`)
    guardLeaveFailed(gCensus, 'the fan-out linearity bound (2× rows) is breached')
  }
})

// ---- journal-condensing-scenarios page: the Feature 3 bounded-journal demo ---
// A supervisor with `maxJournalLength`; a state-slice stream exceeds the
// threshold → the deferred microtask condense rewrites the pre-base entries
// into ONE `base` marker; the checks assert the collapse, the base marker
// shape, a replay-from-base (graph-REPLACE + post-base re-apply), and a
// post-base undo (D3 id-resolution). Profile guard: timed sections cover ~all
// of the total.
await runGuard('journal-condensing-scenarios-page', async (gPage) => {
  const prof = await importInlinePage('demo/journal-condensing-scenarios.html', 'demo/journal-condensing-scenarios.js', '__journalCondensingScenariosDone', PAGE_WAIT_MS, 'journal-condensing-scenarios')
  if (!prof) {
    console.error('journal-condensing-scenarios profile missing — page did not finish profiling')
    guardLeaveFailed(gPage, 'the page did not finish profiling (no profile global)')
    return
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`journal-condensing-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gPage, 'profile residual too large')
    return
  }
  if (prof.baseMarkers !== 1) {
    console.error(`journal-condensing-scenarios baseMarkers=${prof.baseMarkers} (expected 1)`)
    guardLeaveFailed(gPage, 'baseMarkers ≠ 1')
  }
})

// ---- preserve-reversal-scenarios page: the Feature 4 preserve-by-reversal demo
// A layerApply mint with preserveByReversal:true; reverseTranslate ships the
// preserved subtree as authored. The demo covers: D1 flag read (preserved node
// ships as authored), D2 whole-subtree cascade (descendants ship too), D3
// not-promotion (node stays minted), D4 re-mint drops the flag. Profile guard:
// timed sections cover ~all of the total.
await runGuard('preserve-reversal-scenarios-page', async (gPage) => {
  const prof = await importInlinePage('demo/preserve-reversal-scenarios.html', 'demo/preserve-reversal-scenarios.js', '__preserveReversalScenariosDone', PAGE_WAIT_MS, 'preserve-reversal-scenarios')
  if (!prof) {
    console.error('preserve-reversal-scenarios profile missing — page did not finish profiling')
    guardLeaveFailed(gPage, 'the page did not finish profiling (no profile global)')
    return
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`preserve-reversal-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gPage, 'profile residual too large')
    return
  }
  if (prof.preservedShipped !== 1) {
    console.error(`preserve-reversal-scenarios preservedShipped=${prof.preservedShipped} (expected 1)`)
    guardLeaveFailed(gPage, 'preservedShipped ≠ 1')
  }
  if (prof.descendantsShipped < 1) {
    console.error(`preserve-reversal-scenarios descendantsShipped=${prof.descendantsShipped} (expected >= 1)`)
    guardLeaveFailed(gPage, 'descendantsShipped < 1')
  }
  if (!prof.flagStillSet) {
    console.error('preserve-reversal-scenarios flagStillSet=false (expected true)')
    guardLeaveFailed(gPage, 'flagStillSet is false')
  }
  if (!prof.reMintDroppedFlag) {
    console.error('preserve-reversal-scenarios reMintDroppedFlag=false (expected true)')
    guardLeaveFailed(gPage, 'reMintDroppedFlag is false')
  }
})

// ---- markdown-adapter-scenarios page: MarkdownAdapter demo (Feature 2) --------
// One legacy envelope (headings, bold/italic, link with title, blockquote,
// nested-list-in-list, fenced pre, hr, img); the module translates it,
// compiles, renders through MarkdownAdapter via renderProducingProcess, and
// asserts the toString() output. Profile guard: timed sections must cover ~all
// of the total.
await runGuard('markdown-adapter-scenarios-page', async (gPage) => {
  const prof = await importInlinePage('demo/markdown-adapter-scenarios.html', 'demo/markdown-adapter-scenarios.js', '__markdownAdapterScenariosDone', PAGE_WAIT_MS, 'markdown-adapter-scenarios')
  if (!prof) {
    console.error('markdown-adapter-scenarios profile missing — page did not finish profiling')
    guardLeaveFailed(gPage, 'the page did not finish profiling (no profile global)')
    return
  }
  const covered = prof.coveredMs ?? 0
  const residual = prof.totalMs - covered
  if (residual > Math.max(prof.totalMs * 0.15, 25)) {
    console.error(`markdown-adapter-scenarios profile residual too large: ${residual.toFixed(1)}ms unmeasured of total=${prof.totalMs.toFixed(1)}ms (${(100 * covered / prof.totalMs).toFixed(1)}% covered)`)
    guardLeaveFailed(gPage, 'profile residual too large')
  }
})

// Give microtasks a chance (Supervisor event flushes + async page checks).
await new Promise((r) => setTimeout(r, 250))

// ============================================================================
// §4 FINAL AGGREGATION GUARDS — banners + the component page's own text.
// These blocks used to be raw immediate-exit sites AFTER the censuses (audit
// finding 1): each is now a guard, so a failing banner check reports and the
// REMAINING banner checks still run before the aggregate exit.
// ============================================================================

// inline pages' banners (walked from the parent's mounted shim) + the
// worker-run pages' banners (shipped back per page — the parent never mounts
// the fork-family pages in its own shim)
const banners = collectBanners().concat(workerBanners).concat(bannerCensusExtras)
console.log('banners:', banners.join(' | '))

await runGuard('demo-check-banner-census', (gBanners) => {
  console.log(`[smoke-guard:banners] ${banners.length} banner(s) collected from the inline pages + the worker-run pages`)
  // probe: did the fork-stress runtime layers build? count handler-marked nodes
  console.log('DBG fork-stress runtime probe (handler markers live on nodes, not shim): skipped in shim')
  // (a) the shim's own FAIL-marked check elements
  const fails = [...byId.values()].flatMap((el) => collectFailMarks(el, []))
  if (fails.length > 0) {
    console.error('FAILED CHECKS:', fails.length)
    for (const el of fails) {
      for (const c of el.children) if (c.tagName === 'PRE') console.error('  detail:', c.textContent)
    }
    guardLeaveFailed(gBanners, `${fails.length} FAIL-marked check element(s) in the shim`)
  }
  // (b) no banner may report a failure
  if (banners.some((b) => /failed: [1-9]/.test(b))) {
    console.error('summary reports failures')
    guardLeaveFailed(gBanners, 'a page banner reports failures')
  }
  // (c) every page that must have completed its checks actually did
  const required = [
    (b) => b.includes('Feature Matrix') && /0 failed/.test(b),
    ...['client', 'ssr', 'markdown'].map((mode) => (b) => b.includes(`Mode toggle — ${mode}`) && /0 failed/.test(b)),
    ...[2, 4, 6, 8, 9, 10, 11, 12].map((depth) => (b) => b.includes(`Fork Stress — depth ${depth}`) && /0 failed/.test(b)),
    ...[2, 4, 6, 8, 9, 10, 11, 12].map((depth) => (b) => b.includes(`Fork Stress (data) — depth ${depth}`) && /0 failed/.test(b)),
    ...['placement', 'values', 'link'].map((method) => (b) => b.includes(`Fork Stress (data: ${method}) — depth 12`) && /0 failed/.test(b)),
    ...['Path Fork (static)', 'Path Fork (values-derived)', 'Path Fork (link-derived)'].map((label) => (b) => b.includes(label) && /0 failed/.test(b)),
    ...['feature-showcase', 'translate-showcase', 'legacy-shape', 'handlers-scenarios', 'session-features', 'hooks-scenarios', 'rows-scenarios', 'markdown-adapter-scenarios', 'journal-condensing-scenarios', 'preserve-reversal-scenarios']
      .map((label) => (b) => b.includes(label) && /0 failed/.test(b)),
  ]
  const missing = required.filter((pred) => !banners.some(pred)).length
  if (missing > 0) {
    console.error(`banner census: ${missing} of ${required.length} required page banner(s) missing (or reporting failures)`)
    guardLeaveFailed(gBanners, `${missing} required page banner(s) missing — a page did not complete its checks`)
  }
  // (d) the component page's own footer summary
  const rootText = allText(byId.get('root'))
  if (rootText.includes('FAIL —')) {
    console.error('component page has failing test nodes')
    guardLeaveFailed(gBanners, 'the component page has failing test nodes')
  }
  if (!rootText.includes('0 failed')) {
    console.error('component page summary missing or reports failures:', rootText.slice(0, 200))
    guardLeaveFailed(gBanners, 'the component page summary is missing or reports failures')
  }
})

// happy path only — worker result files leave no residue
rmSync(_resultDir, { recursive: true, force: true })
if (guardFailures.length === 0) console.log('SMOKE OK — all demo checks passed')
// §4 AGGREGATE EXIT (shape (b)): every guard above has RUN and REPORTED; the
// run ends non-zero iff any guard failed. A guard failure is NEVER swallowed —
// it is only DEFERRED past the censuses that used to sit behind the tripwire.
guardAggregateExit()
