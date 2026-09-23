/**
 * NC-2 — the HARNESS GUARD-REACHABILITY suite (docs/specs/no-clone-invariants.md
 * §8.2 + §4's ONE-GUARD-PER-`process.exit` requirement) + the P-SM-1 register row.
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * `scripts/demo-smoke.mjs` contained a runtime scaling tripwire that `process.exit`ed
 * BEFORE the legacy-shape census block ran, so on any run where the tripwire
 * fired the harness's ONLY component-family clone census — the guard that would
 * have caught I3's regression class — never executed (§4 instance 1). The same
 * defect CLASS as the fixed `SMOKE-TRIPWIRE-INERT` row: a guard must be able to
 * both RUN and REPORT ITS MEASUREMENT.
 *
 * ✎ HISTORICAL NOTE (2026-09-23) — the tripwire named by that instance is GONE.
 * The cross-family 3× runtime:derived tripwire was **RETIRED as an assertion** by
 * the user's ruling of 2026-09-23 (its operands are page totals over different
 * CONSTRUCTION METHODS; its 3× bound had been calibrated on a derived-vs-derived
 * reading): the harness's failing scaling signal is now the runtime-vs-runtime
 * **growth guard**, id **`runtime-fork-growth-guard`** (d10 → d12 pass-2 ratio,
 * bound 10× — `docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD, which SUPERSEDES
 * RUNTIME-FORK-TRIPWIRE-BOUND), and the cross-family ratio survives only as the
 * INFORMATIONAL `[runtime-fork:tripwire]` print (never a guard entry, never an
 * assertion). This file's reachability contract is unchanged in SHAPE: the
 * ordered entry log must still contain the exit-capable scaling guard and a later
 * census must still enter and report. Defect record: `docs/defects.md`
 * FORK-STRESS-TRIPWIRE-STALE-SPEC.
 *
 * ── EXPECTED STATUS ON THE CURRENT CODE (the harness fix has LANDED) ───────
 *   NC-2a  GREEN — the legacy-shape census guard enters and prints its census
 *          line AFTER the scaling guard's entry (asserted from the ordered entry
 *          log, with the informational `[runtime-fork:tripwire]` print as the
 *          ordering reference that replaced the retired tripwire marker).
 *   NC-2b  GREEN — every required guard id is in the entered log, at least one
 *          entry follows the growth guard, and the `PP_SMOKE_FAULT` arm shows the
 *          injected guard FAILING while the later guards still enter.
 *   NC-2c  GREEN — every printed `cloneOps` census line agrees with the page's
 *          published measurement AND with the count derived independently from
 *          the line's own `depth=`/topology: `0` for the CONVERTED
 *          path-enumeration family (2·depth − 1 nodes — the node clause is what
 *          catches a per-path mint) and `0` for the static/legacy pages.
 *   NC-2d  GREEN — `assertForkStressCensus`, extracted and driven with fabricated
 *          profiles, REJECTS a census whose `cloneOps` disagrees with the
 *          journal-derived number, rejects a MISSING measurement token (§8.2
 *          row 1: no silent fallback) and rejects a per-path node mint, and its
 *          source no longer contains the arithmetic-identity comparison
 *          (`prof.cloneOps !== prof.inTree − 1 − prototypes`) that the page
 *          itself computed — the old tautology.
 *   P-SM-1 GREEN — the §5 state-machine register row executes HERE and reports
 *          its own §8.4 line (status/attempts/liveness/counterexample), with the
 *          fault-injection arm as its liveness proof (T1: the row is no longer
 *          excused as living "somewhere else" without a line).
 *
 * ── BUILD PRECONDITION AND SKIP SEMANTICS (T12) ────────────────────────────
 * This suite drives the REAL smoke, which needs the generated demo pages
 * (`npm run demo:build` + `node scripts/build-demo.mjs`). On a checkout where
 * those artifacts are absent the smoke-driven cases SKIP (`describe.skip`, the
 * repo's `legacy-bridge.test.ts` pattern) with the reason printed below — they
 * no longer FAIL while the header claimed they skip (T12). The offline control
 * case needs no artifacts and always runs; it is what keeps the contract
 * checkers themselves falsifiable on a clean checkout.
 *
 * ── THE AFFORDANCE THIS FILE EXPECTS FROM THE HARNESS ──────────────────────
 * §4's acceptance criterion 1 ("every guard that passes today must still run and
 * still pass") and P-SM-1's anti-vacuity clause ("the entered-guard log must be
 * asserted NON-EMPTY and must contain a guard positioned AFTER today's
 * exit-capable scaling guard" — at the pre-fix date, AFTER the tripwire) are only
 * checkable from a harness-recorded ENTRY LOG. The affordance asserted here is:
 *   1. each guard logs its entry as a single line containing the marker
 *      `[smoke-guard:enter]` followed by a JSON object
 *      `{ "id": <string>, "index": <number>, "status": "pass"|"fail" }`, where
 *      `index` is an OUTPUT-LINE index (the harness prints it on the same scale
 *      as the capture the test parses — so entries after the scaling guard read
 *      as after it; note the retired tripwire's informational print sits INSIDE
 *      that guard's body, i.e. AFTER its entry, which is why the ENTRY is the
 *      ordering reference — see SCALING_GUARD_ID below);
 *   2. a guard that PASSES also prints its measurement (its existing
 *      `[xxx:profile] … census(… cloneOps=<n> …)` line satisfies this);
 *   3. a fault-injection seam: `PP_SMOKE_FAULT=<guard id>` makes that guard FAIL
 *      while the run continues (and the later censuses still enter) — without a
 *      seam the fault-injection arm is not drivable at all.
 *
 * ── DOCUMENTED NON-ASSERTIONS (spec §6) ───────────────────────────────────
 *   · no `process.exit` COUNT or ordering is asserted (§6 row 9 — shape (a) and
 *     shape (b) legitimately produce different exit counts);
 *   · no BOUND is asserted (§6 row 6 — 10× / 2.5× / 15% / 25ms are the user's
 *     decisions), only reachability and reporting;
 *   · `assertLegacyShapeCensus`'s own field-completeness loop is not
 *     re-implemented (§6 row 8) — only that it RUNS;
 *   · WHICH guards pass is not asserted as a RULING: the growth guard passes
 *     naturally today, but the live arm's clauses are reachability + reporting
 *     (the entry exists, a later census enters), never "the growth bound holds"
 *     — that comparison belongs to the harness and to
 *     `tests/unit/pass2-fit-reference-scope-measurement.test.ts`.
 *
 * ── FALSIFICATION EVIDENCE (one line per case) ────────────────────────────
 *   NC-2a  a violating implementation shows `legacy-shape-census` absent from the
 *          entered log on a run whose scaling guard fired (the pre-fix state), or
 *          the census line printed BEFORE the scaling guard's entry.
 *   NC-2b  a log containing ONLY the guards that always ran (no post-growth entry)
 *          fails the anti-vacuity clause; an injected failure that suppresses
 *          every later entry fails the fault arm; an injected id that is no longer
 *          KNOWN (the retired `runtime-fork-tripwire` class) fails the run at the
 *          seam's startup validation instead of exercising the arm.
 *   NC-2c  a census line whose `cloneOps` is a literal/alias prints a number that
 *          disagrees with the depth-derived count and with its own published
 *          measurement token (with both printed in the failure); a per-path mint
 *          prints `registered = 2^depth − 1` against the derived `2·depth − 1`.
 *   NC-2d  a guard that cannot fail on a fabricated inconsistency stays silent
 *          with `cloneOps=1` while the journal-derived number is 0, or accepts a
 *          profile that publishes no measurement token at all.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SMOKE_PATH = join(REPO, 'scripts', 'demo-smoke.mjs')

/** The affordance the harness fix must provide (see the header). */
const GUARD_ENTER_MARKER = '[smoke-guard:enter]'

/** The guard ids §4's acceptance criterion names (the census/assertion blocks a
 *  silently-unreachable guard would hide). `legacy-shape-census` is the one the
 *  pre-fix ordering hid behind the retired tripwire's `process.exit`; it must now
 *  appear in the entered log AFTER the harness's EXIT-CAPABLE scaling guard —
 *  `runtime-fork-growth-guard` (d10 → d12 pass-2 ratio, bound 10×; the
 *  cross-family 3× tripwire this array used to name was RETIRED 2026-09-23,
 *  `docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD).
 *
 *  ORDERING NOTE (why these census ids alone satisfy the anti-vacuity clause):
 *  every census guard enters BEFORE the growth guard, so the required
 *  post-scaling-guard entries are the LATER blocks — `legacy-shape-census`
 *  (measured 2026-09-23: growth entry index 8713, legacy-shape entry 8735). */
const REQUIRED_GUARD_IDS = [
  'legacy-shape-census',
  'fork-stress-census',
  'static-path-census',
  'runtime-fork-growth-guard',
] as const

/** The scaling guard whose ENTRY (not the informational marker below) is the
 *  ordering reference: the exit-capable guard a run must survive to reach the
 *  later censuses. */
const SCALING_GUARD_ID = 'runtime-fork-growth-guard'

/** The RETIRED cross-family 3× tripwire's marker: it is NO LONGER a guard and no
 *  longer an assertion (user ruling 2026-09-23) — it survives as an
 *  INFORMATIONAL `[runtime-fork:tripwire]` print, so it is still the marker the
 *  reachability suite uses to locate the scaling block, but never an expectation
 *  about WHETHER something passed or failed.
 *
 *  (Identified by GUARD ID / MARKER rather than by source line numbers: the
 *  harness file is under active edit, so a line citation here would rot.) */
const TRIPWIRE_MARKER = '[runtime-fork:tripwire]'

function readSmoke(): string {
  return readFileSync(SMOKE_PATH, 'utf8')
}

function smokeHasGuardEnterAffordance(): boolean {
  return readSmoke().includes(GUARD_ENTER_MARKER)
}

function smokeHasFaultInjectionSeam(): boolean {
  return /PP_SMOKE_FAULT/.test(readSmoke())
}

/** True once `npm run demo:build` + `scripts/build-demo.mjs` have produced the
 *  fork pages the smoke needs. On a clean checkout this is FALSE and the
 *  smoke-driven cases SKIP (T12 — the suite used to set a reason and then assert
 *  `run.ran === true`, so a checkout without the built pages FAILED while the
 *  header claimed it skipped). The offline control below needs no artifacts. */
function demoArtifactsPresent(): boolean {
  return existsSync(join(REPO, 'demo', 'fork-stress-data-d2.html'))
    && existsSync(join(REPO, 'demo', 'legacy-shape.html'))
}

/** Evaluated once, at collection time (the skip decision must be static).
 *  `PP_SMOKE_ARTIFACTS_ABSENT=1` forces the absent-artifacts path so the SKIP
 *  itself is verifiable (T12: `PP_SMOKE_ARTIFACTS_ABSENT=1 npx vitest run
 *  tests/unit/no-clone-guards.test.ts` must report the smoke-driven cases as
 *  SKIPPED, never as failed). */
const DEMO_ARTIFACTS_PRESENT = process.env.PP_SMOKE_ARTIFACTS_ABSENT === '1' ? false : demoArtifactsPresent()
const SKIP_REASON = `demo artifacts absent — run \`npm run demo:build\` + \`node scripts/build-demo.mjs\` first (${join('demo', 'fork-stress-data-d2.html')} / ${join('demo', 'legacy-shape.html')})`
if (!DEMO_ARTIFACTS_PRESENT) console.warn(`[no-clone-guards] SKIPPING the smoke-driven NC-2 / P-SM-1 cases: ${SKIP_REASON}`)

/** The seven-row register's per-row attempt budget (§8.4: ≤ 100 attempts/row and
 *  ≤ 400 total across the register; this file's allocation is asserted against
 *  the same 4 that tests/unit/no-clone-invariants.test.ts reserves for P-SM-1). */
const P_SM_1_ATTEMPTS_ALLOWANCE = 4

// ============================================================================
// The TWO smoke runs this suite may make: the live arm (shared by NC-2a/2b/2c
// and the P-SM-1 row) and the fault-injected arm (shared by NC-2b and P-SM-1)
// ============================================================================

interface SmokeRun {
  ran: boolean
  reason: string
  status: number | null
  stdout: string
}

const smokeRun: SmokeRun = { ran: false, reason: 'not started', status: null, stdout: '' }

/** Run the smoke ONCE for this suite. Guarded by the affordance check: without
 *  the entered-guard log there is nothing to parse, so the run is not spent
 *  (the cases then fail on the missing affordance with a precise message — the
 *  affordance is a §4 REQUIREMENT, not a build precondition, so its absence is a
 *  real violation rather than a skip). */
function runSmokeOnce(): SmokeRun {
  if (smokeRun.ran) return smokeRun
  if (!DEMO_ARTIFACTS_PRESENT) {
    smokeRun.reason = SKIP_REASON
    return smokeRun
  }
  if (!smokeHasGuardEnterAffordance()) {
    smokeRun.reason = `the harness provides no '${GUARD_ENTER_MARKER}' log (the §4 affordance is absent)`
    return smokeRun
  }
  if (process.env.PP_SKIP_SMOKE === '1') {
    smokeRun.reason = 'PP_SKIP_SMOKE=1'
    return smokeRun
  }
  const res = spawnSync(process.execPath, [SMOKE_PATH], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 256 * 1024 * 1024,
  })
  smokeRun.ran = true
  smokeRun.status = res.status
  smokeRun.stdout = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
  return smokeRun
}

/** The FAULT-INJECTED arm (`PP_SMOKE_FAULT`), run ONCE and shared by NC-2b and
 *  the P-SM-1 register row (the row's liveness proof needs the same log).
 *
 *  THE TARGET ID (re-pointed 2026-09-23): the injected id must be (a) a KNOWN
 *  guard id — `scripts/demo-smoke.mjs` validates `PP_SMOKE_FAULT` against
 *  `KNOWN_GUARD_IDS` at startup and FAILS THE RUN LOUDLY on an unknown id, so the
 *  retired `runtime-fork-tripwire` (no longer a guard at all) makes this arm
 *  undrivable — and (b) a NATURALLY-PASSING guard, per the seam's own documented
 *  rule (an id that fails on every run would make the injection unobservable).
 *  Both hold for `runtime-fork-growth-guard`, the harness's own named example
 *  (`guardFaulted`'s comment); its natural status was measured `pass` on
 *  2026-09-23. */
const faultRun: SmokeRun = { ran: false, reason: 'not started', status: null, stdout: '' }

function runFaultInjectedSmokeOnce(): SmokeRun {
  if (faultRun.ran) return faultRun
  if (!DEMO_ARTIFACTS_PRESENT) {
    faultRun.reason = SKIP_REASON
    return faultRun
  }
  if (!smokeHasFaultInjectionSeam()) {
    faultRun.reason = 'the harness exposes no fault-injection seam (PP_SMOKE_FAULT)'
    return faultRun
  }
  const res = spawnSync(process.execPath, [SMOKE_PATH], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 256 * 1024 * 1024,
    env: { ...process.env, PP_SMOKE_FAULT: SCALING_GUARD_ID },
  })
  faultRun.ran = true
  faultRun.status = res.status
  faultRun.stdout = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
  return faultRun
}

interface EnteredGuard {
  id: string
  index: number
  /** Present on the fault-injection arm: 'pass' | 'fail' (the harness records
   *  the guard's OUTCOME in the same entry). */
  status?: string
}

/** Parse the ordered entered-guard log (§4's affordance). */
function enteredGuards(stdout: string): EnteredGuard[] {
  const out: EnteredGuard[] = []
  for (const line of stdout.split('\n')) {
    const at = line.indexOf(GUARD_ENTER_MARKER)
    if (at < 0) continue
    const json = line.slice(at + GUARD_ENTER_MARKER.length).trim()
    try {
      const parsed = JSON.parse(json) as { id?: unknown; index?: unknown; status?: unknown }
      if (typeof parsed.id === 'string') {
        out.push({
          id: parsed.id,
          index: typeof parsed.index === 'number' ? parsed.index : out.length,
          ...(typeof parsed.status === 'string' ? { status: parsed.status } : {}),
        })
      }
    } catch {
      /* a malformed entry line is reported by the NC-2a contract check */
    }
  }
  return out
}

/** The captured-output line index (not "line number") of a marker — used to
 *  assert (a) that the informational `[runtime-fork:tripwire]` print is present
 *  and (b) that the later censuses REPORT after the scaling block. The
 *  reachability ORDERING itself is asserted on the entered-guard `index` values
 *  (see `guardLogViolations`: the scaling guard's ENTRY is the reference). */
function markerLineIndex(stdout: string, marker: string): number {
  const lines = stdout.split('\n')
  return lines.findIndex(l => l.includes(marker))
}

/** Census lines carrying a `cloneOps=<n>` measurement, with the page they came
 *  from and the independent tokens the line publishes (the `[<page>:profile] …`
 *  marker form the pages print). */
interface CensusLine {
  page: string
  /** The page's own `depth=` token (the fork-stress family prints it). */
  depth: number | null
  cloneOps: number
  /** The page's separately derived measurement token (`journalCloneOps=` /
   *  `measuredCloneOps=`), when it publishes one. */
  publishedMeasurement: number | null
  /** The page's journal TOTAL (`journal=`), when it publishes one. */
  journalTotal: number | null
  line: string
}

function cloneOpsCensusLines(stdout: string): CensusLine[] {
  const out: CensusLine[] = []
  for (const line of stdout.split('\n')) {
    const pageMatch = /^\[([a-z-]+):profile\]/.exec(line)
    if (!pageMatch) continue
    const cloneMatch = /cloneOps=(-?\d+(?:\.\d+)?)/.exec(line)
    if (!cloneMatch) continue
    const measurementMatch = /(?:journalCloneOps|measuredCloneOps)=(-?\d+(?:\.\d+)?)/.exec(line)
    const journalMatch = / journal=(-?\d+(?:\.\d+)?)/.exec(line)
    const depthMatch = / depth=(\d+)/.exec(line)
    out.push({
      page: pageMatch[1]!,
      depth: depthMatch ? Number(depthMatch[1]) : null,
      cloneOps: Number(cloneMatch[1]),
      publishedMeasurement: measurementMatch ? Number(measurementMatch[1]) : null,
      journalTotal: journalMatch ? Number(journalMatch[1]) : null,
      line,
    })
  }
  return out
}

// ============================================================================
// Pure contract checkers (shared by the live cases AND the offline control, so
// "this case goes green once the affordance exists" is itself verified)
// ============================================================================

/** §4 acceptance criterion 1 + P-SM-1's anti-vacuity clause, as a violation
 *  list (empty ⇒ the log satisfies the guard-reachability contract).
 *
 *  THE ORDERING REFERENCE (re-pointed 2026-09-23 for the growth-guard ruling): the
 *  anti-vacuity clause is anchored on the EXIT-CAPABLE scaling guard's ENTRY
 *  (`SCALING_GUARD_ID` — `runtime-fork-growth-guard`), because the retired
 *  tripwire's `[runtime-fork:tripwire]` line is now an INFORMATIONAL print
 *  emitted INSIDE that guard's body — i.e. it is printed AFTER the guard's own
 *  entry, so an entry-`index` comparison against it can never be true. The
 *  informational marker is still asserted to be PRESENT (the scaling block must
 *  still report its measurement). */
function guardLogViolations(
  stdout: string,
  entered: EnteredGuard[],
  opts: { requireFaultEvidence?: boolean } = {},
): string[] {
  const out: string[] = []
  if (entered.length === 0) out.push('the entered-guard log is EMPTY')
  // the informational print must still be emitted by the scaling block
  if (markerLineIndex(stdout, TRIPWIRE_MARKER) < 0) {
    out.push('the informational [runtime-fork:tripwire] print is absent — the scaling block did not report')
  }
  const scaling = entered.find(g => g.id === SCALING_GUARD_ID)
  if (scaling === undefined) {
    out.push(`the scaling guard "${SCALING_GUARD_ID}" never ENTERED — the exit-capable guard the later censuses must survive did not run`)
  }
  const afterScaling = scaling === undefined ? [] : entered.filter(g => g.index > scaling.index)
  if (scaling !== undefined && afterScaling.length === 0) {
    out.push(`no guard is positioned AFTER the scaling guard "${SCALING_GUARD_ID}" (entered=${JSON.stringify(entered)})`)
  }
  const ids = entered.map(g => g.id)
  for (const required of REQUIRED_GUARD_IDS) {
    if (!ids.includes(required)) out.push(`guard "${required}" is absent from the entered log`)
  }
  if (opts.requireFaultEvidence) {
    const faulted = entered.filter(g => g.status === 'fail').map(g => g.id)
    if (faulted.length === 0) out.push('the fault-injection arm shows no FAILING guard in the log')
    if (!/\[smoke-guard:fail\]/.test(stdout)) out.push('the injected failure left no fail-marker in the output')
  }
  return out
}

/** NC-2c's measurement contract (T7), RE-POINTED for the converted
 *  data-driven family (fork-stress-data-p3.md §8.2 rows 5-6, user ruling
 *  2026-09-22): every census line's `cloneOps` must agree with
 *  (a) the page's own separately published measurement token, (b) the count
 *  derived INDEPENDENTLY from the line's topology — `0` for the CONVERTED
 *  fork-stress-data family (path enumeration: 2·depth − 1 nodes, 2^depth − 1
 *  wires, NO clone-instance op anywhere in its construction) — and (c) the
 *  page family's expectation (0 for the static/legacy pages too). A literal or
 *  identity-derived census cannot satisfy (b); the node clause (`registered =
 *  inTree = 2·depth − 1`) is what catches the per-path mint that a clone-only
 *  clause cannot see. */
function censusViolations(censuses: CensusLine[]): string[] {
  const out: string[] = []
  if (censuses.length === 0) return ['no census line carrying cloneOps was printed at all']
  const legacy = censuses.filter(c => c.page === 'legacy-shape')
  if (legacy.length === 0) {
    out.push(`[legacy-shape:profile] printed no cloneOps census (pages seen: ${[...new Set(censuses.map(c => c.page))].join(',')})`)
  }
  for (const c of legacy) {
    if (c.cloneOps !== 0) out.push(`legacy-shape cloneOps=${c.cloneOps} ≠ 0 though the page proves an empty journal`)
    if (c.publishedMeasurement !== null && c.publishedMeasurement !== c.cloneOps) {
      out.push(`legacy-shape published measurement ${c.publishedMeasurement} ≠ its census field ${c.cloneOps}`)
    }
  }
  for (const c of censuses.filter(x => x.page === 'derived-fork')) {
    if (c.cloneOps !== 0) out.push(`derived-fork cloneOps=${c.cloneOps} ≠ 0 on a page with no applied ops`)
    if (c.publishedMeasurement !== null && c.publishedMeasurement !== c.cloneOps) {
      out.push(`derived-fork published measurement ${c.publishedMeasurement} ≠ its census field ${c.cloneOps}`)
    }
  }
  const convertedFamily = censuses.filter(c => c.page === 'fork-stress-data')
  if (convertedFamily.length === 0) {
    out.push('the converted (path-enumeration) fork-stress-data census printed no cloneOps line at all')
  }
  for (const c of convertedFamily) {
    if (c.cloneOps !== 0) {
      out.push(`the converted family's census printed cloneOps=${c.cloneOps} (must be 0 — path enumeration mints NO clones, E2E-1 / §3 K6-a)`)
    }
    // the page's own second source: it must exist (§3 I5 / §3 K6-b) and must
    // agree with the census field
    if (c.publishedMeasurement === null) {
      out.push(`census line carries no journal measurement token (§3 I5 / §3 K6-b; §8.2 row 4 REQUIRES it on this family's line): ${c.line.trim()}`)
    } else if (c.publishedMeasurement !== c.cloneOps) {
      out.push(`printed cloneOps=${c.cloneOps} ≠ printed published measurement=${c.publishedMeasurement}`)
    }
    if (c.depth === null) {
      out.push(`census line carries no depth token — the independent derivation is unavailable: ${c.line.trim()}`)
    } else {
      // T7's independent clause, re-derived: my count, derived from the
      // TOPOLOGY, not read from the page. The converted family's construction
      // contains no clone-instance op, so the topology's count is 0. A census
      // that regressed to a clone count (or to any expression that is not the
      // journal's own measurement) fails here.
      const expected = 0
      if (c.cloneOps !== expected) {
        out.push(`depth=${c.depth} census cloneOps=${c.cloneOps} ≠ the independently derived ${expected} (path enumeration applies NO ops — E2E-1)`)
      }
      // the node half of the pin (§3 K6-e): a node minted per path/element
      // reads cloneOps = 0 while registered = 2^depth − 1, so the node clause is
      // what makes the pin able to fail for the failure the ruling names.
      const registered = Number(/registered=(\d+)/.exec(c.line)?.[1] ?? NaN)
      const expectedNodes = 2 * c.depth - 1
      if (Number.isFinite(registered) && registered !== expectedNodes) {
        out.push(`depth=${c.depth} census registered=${registered} ≠ the independently derived 2·depth − 1 = ${expectedNodes} (2·(depth−1) prototypes + root; a node minted per path would report 2^depth − 1 = ${2 ** c.depth - 1})`)
      }
    }
    const inTree = Number(/inTree=(\d+)/.exec(c.line)?.[1] ?? NaN)
    if (Number.isFinite(inTree) && c.cloneOps > inTree) out.push(`cloneOps=${c.cloneOps} exceeds inTree=${inTree}`)
  }
  return out
}

// ============================================================================
// NC-2a — the legacy-shape census is REACHABLE
// ============================================================================

const smokeDescribe = DEMO_ARTIFACTS_PRESENT ? describe : describe.skip

smokeDescribe(`NC-2a — the legacy-shape census guard is REACHABLE (§8.2) [${DEMO_ARTIFACTS_PRESENT ? 'executed' : 'SKIPPED: no demo artifacts'}]`, () => {
  it('NC-2a: assertLegacyShapeCensus is ENTERED, and reports its census, AFTER the scaling guard (runtime-fork-growth-guard)', () => {
    // FALSIFICATION: the pre-fix ordering (the exit-capable scaling guard's
    // process.exit before the legacy-shape block) leaves `legacy-shape-census`
    // absent from the entered log and its `[legacy-shape:profile]` line out of
    // the output entirely.
    const run = runSmokeOnce()
    expect(run.ran, `smoke not run: ${run.reason}`).toBe(true)

    // the scaling block DID report: its informational cross-family print is
    // emitted on every run (the retired tripwire's measurement, kept as a
    // print — never an assertion, user ruling 2026-09-23)
    expect(run.stdout, 'the informational [runtime-fork:tripwire] print is absent — the scaling block did not report').toContain(TRIPWIRE_MARKER)

    // asserted from the ORDERED LOG, not from the absence of an error
    const entered = enteredGuards(run.stdout)
    expect(
      entered.map(g => g.id),
      `entered-guard log = ${JSON.stringify(entered)}`,
    ).toContain('legacy-shape-census')

    // the EXIT-CAPABLE scaling guard must have entered, and the census must have
    // REPORTED after that entry (a run that exits at the guard never reaches it)
    const scaling = entered.find(g => g.id === SCALING_GUARD_ID)
    expect(
      scaling,
      `'${SCALING_GUARD_ID}' is ABSENT from the ordered entry log — the scaling guard did not run (the SMOKE-GUARD-UNREACHABLE class); entered ids=[${entered.map(g => g.id).join(', ')}]`,
    ).toBeDefined()
    const censusLine = run.stdout.split('\n').findIndex(l => l.includes('legacy-shape:profile'))
    expect(censusLine, 'no [legacy-shape:profile] census line printed — the census did not REPORT').toBeGreaterThan(-1)
    const censusEntry = entered.find(g => g.id === 'legacy-shape-census')
    expect(
      censusEntry!.index,
      `the legacy-shape census entry (${censusEntry!.index}) must follow the scaling guard entry (${scaling!.index})`,
    ).toBeGreaterThan(scaling!.index)
    // the informational marker is printed INSIDE the scaling guard's body, so it
    // necessarily follows that guard's entry — asserted on the SAME scale (the
    // captured output's line positions), because the entry `index` is the
    // harness's INTERNAL stdout+stderr line counter while the capture interleaves
    // the two streams, so an index is never compared against a captured position
    // anywhere in this file.
    const scalingEntryAt = markerLineIndex(run.stdout, `${GUARD_ENTER_MARKER} ${JSON.stringify(scaling)}`)
    expect(scalingEntryAt, `the scaling guard's entry line for ${JSON.stringify(scaling)} is not in the capture`).toBeGreaterThan(-1)
    expect(
      markerLineIndex(run.stdout, TRIPWIRE_MARKER),
      "the informational print must follow the scaling guard's own entry line (it is printed inside that guard's body)",
    ).toBeGreaterThan(scalingEntryAt)
  })
})

// ============================================================================
// NC-2b — no guard is silently unreachable (ordered log + fault injection)
// ============================================================================

smokeDescribe(`NC-2b — no guard is silently unreachable (§8.2) [${DEMO_ARTIFACTS_PRESENT ? 'executed' : 'SKIPPED: no demo artifacts'}]`, () => {
  it('NC-2b: the ordered entry log is non-empty, contains a post-scaling-guard entry, and survives an injected early failure', () => {
    // FALSIFICATION EVIDENCE: a log holding only the guards that entered at or
    // before the scaling guard (the derived/runtime censuses) fails the
    // post-scaling-guard anti-vacuity clause with the observed entry list
    // printed; an injected failure that suppresses every later entry leaves the
    // post-injection log without the later guards; an injected id the seam does
    // not know (the retired `runtime-fork-tripwire`) fails at startup instead of
    // exercising the arm.
    const run = runSmokeOnce()
    expect(run.ran, `smoke not run: ${run.reason}`).toBe(true)

    const entered = enteredGuards(run.stdout)
    expect(
      guardLogViolations(run.stdout, entered),
      `the live arm violates the guard contract: entered=${JSON.stringify(entered)}`,
    ).toEqual([])

    // ---- fault-injection arm -------------------------------------------------
    expect(
      smokeHasFaultInjectionSeam(),
      'the harness exposes no fault-injection seam (PP_SMOKE_FAULT) — §8.2/P-SM-1\'s "force an early exit-capable guard to fail" arm is not drivable',
    ).toBe(true)

    const injectRun = runFaultInjectedSmokeOnce()
    expect(injectRun.ran, `the fault-injected smoke did not run: ${injectRun.reason}`).toBe(true)
    const injectedEntries = enteredGuards(injectRun.stdout)
    // the injected guard must be visible FAILING in the same log (a control that
    // does not fail proves no injection happened), and the later census guards
    // must still enter
    expect(
      guardLogViolations(injectRun.stdout, injectedEntries, { requireFaultEvidence: true }),
      `the fault-injected arm violates the guard contract: entered=${JSON.stringify(injectedEntries)}`,
    ).toEqual([])
    // the aggregate still exits non-zero when a guard failed (§4's shape (b))
    expect(injectRun.status, 'the fault-injected run exited 0 — a failing guard was swallowed').not.toBe(0)
  }, 900_000)
})

// ============================================================================
// NC-2c — a passing guard REPORTS its measurement
// ============================================================================

smokeDescribe(`NC-2c — a passing guard prints an independently verifiable measurement (§8.2) [${DEMO_ARTIFACTS_PRESENT ? 'executed' : 'SKIPPED: no demo artifacts'}]`, () => {
  it('NC-2c: every cloneOps census line matches its published measurement AND the depth-derived count; the converted family prints 0 with the node half live', () => {
    // FALSIFICATION EVIDENCE: a census line whose cloneOps is a literal or an
    // alias of its published measurement prints a number that disagrees with the
    // independently derived count (both numbers appear in the failure); a
    // per-path mint prints registered = 2^depth − 1 against the derived
    // 2·depth − 1; the legacy-shape census line's ABSENCE is the unreachability
    // half.
    const run = runSmokeOnce()
    expect(run.ran, `smoke not run: ${run.reason}`).toBe(true)

    const censuses = cloneOpsCensusLines(run.stdout)
    expect(
      censusViolations(censuses),
      `census contract violated (${censuses.length} lines)`,
    ).toEqual([])
  })
})

// ============================================================================
// NC-2d — the fork-stress cloneOps guard is NOT a tautology
// ============================================================================

/** Slice the live `assertForkStressCensus` out of the harness and bind it to
 *  stubs, so the guard can be driven with a fabricated profile (the spec's
 *  "driving the guard directly with a fabricated profile"). */
let builtFn: ((c: unknown, p: unknown) => unknown) | null = null

function buildForkStressGuard(): (prof: Record<string, unknown>, depth: number, label: string) => { exits: string[] } {
  const src = readSmoke()
  const start = src.indexOf('function assertForkStressCensus(')
  expect(start, 'assertForkStressCensus is no longer defined in scripts/demo-smoke.mjs').toBeGreaterThan(-1)
  const end = src.indexOf('\n}', start)
  const fnSrc = src.slice(start, end + 2)
  const errors: string[] = []
  const stubConsole = { error: (m: unknown) => { errors.push(String(m)) }, log: () => {}, warn: () => {} }
  const stubProcess = { exit: (_code?: number) => { errors.push('__EXIT__') } }
  builtFn = new Function('console', 'process', `${fnSrc}\nreturn assertForkStressCensus`) as
    (c: unknown, p: unknown) => unknown
  return (prof, depth, label) => {
    errors.length = 0
    try {
      const fn = builtFn!(stubConsole, stubProcess) as (p: Record<string, unknown>, d: number, l: string) => void
      fn(prof, depth, label)
    } catch (e) {
      errors.push(`threw: ${(e as Error).message}`)
    }
    return { exits: errors.slice() }
  }
}

describe('NC-2d — the fork-stress cloneOps guard is NOT a tautology (§8.2)', () => {
  it('NC-2d: the guard fails a profile whose cloneOps ≠ the journal-derived count, and no longer compares an arithmetic identity with itself', () => {
    // FALSIFICATION: the pre-fix guard compared `prof.cloneOps !== prof.inTree − 1
    // − prototypes` while the PAGE computed exactly that expression, so a
    // fabricated off-by-one profile was ACCEPTED — the tautology this case exists
    // to catch (it can only fail on a typo-level mistake). RE-POINTED for the
    // converted family (§8.2 rows 5-6): the topology's count is 0 and the node
    // half (2·depth − 1) is asserted beside the clone half (§3 K6-a + K6-e).
    const drive = buildForkStressGuard()
    const depth = 12
    // §8.2 rows 5-6 RE-POINT (user ruling 2026-09-22): the CONVERTED family's
    // topology is 2·depth − 1 nodes / 2^depth − 1 wires, and its construction
    // contains NO clone-instance op ⇒ the independently derived clone count is 0.
    const inTree = 2 * depth - 1 // 23
    const measured = 0 // the independently derived count (path enumeration — E2E-1)

    // (1) a LEGITIMATE profile passes (the control: the guard is not broken)
    const legit = drive({ inTree, unplaced: 0, destroyed: 0, cloneOps: measured, registered: inTree, journalCloneOps: measured }, depth, 'fabricated-legit')
    expect(legit.exits, `a legitimate profile was rejected: ${JSON.stringify(legit.exits)}`).toEqual([])

    // (2) the FALSIFIER (a): cloneOps off by one against the page's PUBLISHED
    // journal-derived measurement — the comparison §8.3's criterion (i) requires.
    const offAgainstPublished = drive(
      { inTree, unplaced: 0, destroyed: 0, cloneOps: measured + 1, registered: inTree, journalCloneOps: measured },
      depth,
      'fabricated-off-by-one-vs-published',
    )
    // (3) the FALSIFIER (b): a census reading non-zero while the published
    // measurement agrees with it — the topology clause (0) still rejects it.
    const offAgainstTopology = drive({ inTree, unplaced: 0, destroyed: 0, cloneOps: measured + 1, registered: inTree, journalCloneOps: measured + 1 }, depth, 'fabricated-off-by-one-vs-topology')
    // (4) the FALSIFIER (c): a MISSING published measurement on a census that
    // reads the expected value — the "baseline absent must FAIL" clause (§8.2
    // row 1: the token is REQUIRED, never a silent fallback).
    const missingMeasurement = drive(
      { inTree, unplaced: 0, destroyed: 0, cloneOps: measured, registered: inTree },
      depth,
      'fabricated-missing-measurement',
    )
    // (4b) the NODE half (§3 K6-e): cloneOps = 0 but a node minted per path
    // (registered = 2^depth − 1 = 4095) — the exact failure the ruling names,
    // which a clone-count-only clause cannot see. `registered` also breaks the
    // inTree+unplaced+destroyed identity, so the clause is doubly live.
    const perPathMint = drive(
      { inTree, unplaced: 0, destroyed: 0, cloneOps: measured, registered: 2 ** depth - 1, journalCloneOps: measured },
      depth,
      'fabricated-per-path-mint',
    )

    // (5) the tautology itself, asserted on the guard's SOURCE: the comparison
    // must not be `prof.cloneOps !== prof.inTree − 1 − prototypes`
    const src = readSmoke()
    const guardStart = src.indexOf('function assertForkStressCensus(')
    const guardSrc = src.slice(guardStart, src.indexOf('\n}', guardStart))
    const tautologyPresent = /prof\.cloneOps\s*!==\s*prof\.inTree\s*-\s*1\s*-\s*prototypes/.test(guardSrc)
    // and the guard must read an INDEPENDENT quantity (the page's published
    // measurement or the topology derivation) — never the census field itself
    const readsIndependent = /journalCloneOps|journalEntries|2\s*\*\s*depth|Math\.pow/.test(guardSrc)

    expect(
      offAgainstPublished.exits.length > 0,
      `the guard ACCEPTED cloneOps=${measured + 1} against the published journal measurement ${measured} (census/output=${JSON.stringify(offAgainstPublished.exits)})`,
    ).toBe(true)
    expect(
      offAgainstTopology.exits.length > 0,
      `the guard ACCEPTED cloneOps=${measured + 1} against the topology-derived ${measured}`,
    ).toBe(true)
    expect(missingMeasurement.exits.length > 0, 'the guard ACCEPTED a census that published no journal measurement token (the fallback branch is back)').toBe(true)
    expect(perPathMint.exits.length > 0, 'the guard ACCEPTED a per-path node mint (registered = 2^depth − 1 with cloneOps = 0) — the node half of the pin is dead').toBe(true)
    expect(tautologyPresent, 'the arithmetic-identity comparison is still present in assertForkStressCensus').toBe(false)
    expect(readsIndependent, 'assertForkStressCensus reads no independent journal-derived quantity — its comparison cannot be falsified').toBe(true)
  })
})

// ============================================================================
// P-SM-1 — THE REGISTER ROW (T1): the harness state machine, EXECUTED and
// REPORTED here in the §8.4 vocabulary. It is no longer excused as "living in
// another file without a line": this case drives the guard sequence twice (the
// live arm and the fault-injection arm) and reports id / strategy / status /
// attempts / failures / liveness / counterexample BEFORE its assertions.
// ============================================================================

const P_SM_1_ID = 'P-SM-1'
const P_SM_1_STRATEGY = 'guard-sequence:entered-log(live+fault-injected)'

/** The pinned seed of the register (the property rows in
 *  tests/unit/no-clone-invariants.test.ts use the same number; this row is a
 *  two-arm harness drive, so the seed pins its arm order and nothing else). */
const PINNED_SEED = 20260922

interface SmokeRowReport {
  id: string
  strategy: string
  status: 'HELD' | 'BROKEN' | 'EXPECTED-RED' | 'UNDETERMINED'
  attempts: number
  failures: number
  liveness: string
  counterexample: string
}

const smokeRowReports: SmokeRowReport[] = []

function reportSmokeRow(row: SmokeRowReport): string {
  const line = `[no-clone:register] seed=${PINNED_SEED} row=${row.id} strategy=${row.strategy} status=${row.status} attempts=${row.attempts} failures=${row.failures} liveness=${row.liveness} counterexample=${row.counterexample}`
  console.log(line)
  smokeRowReports.push(row)
  return line
}

smokeDescribe(`P-SM-1 guard reachability + measurement reporting (strategy ${P_SM_1_STRATEGY}) [${DEMO_ARTIFACTS_PRESENT ? 'executed' : 'SKIPPED: no demo artifacts'}]`, () => {
  it('P-SM-1 reports HELD: every required guard ENTERS on both arms, a post-scaling-guard census reports, and the injected fault is visible', () => {
    // FALSIFICATION EVIDENCE (the four-value vocabulary's live clause):
    //   · a guard missing from the entered log → `guardLogViolations` names it;
    //   · the legacy-shape census absent (the pre-fix unreachability) → the log
    //     fails the post-scaling-guard anti-vacuity clause;
    //   · the fault arm not showing a FAILING injected guard → the liveness
    //     clause fails (a control that does not fail proves no injection);
    //   · the fault-injected run exiting 0 → a failing guard was swallowed;
    //   · an injected id the seam does not KNOW (the retired
    //     `runtime-fork-tripwire`, or a renamed guard) → the harness fails the
    //     run at startup and the arm records no failing guard at all.
    // Attempts = the two guard-sequence arms actually driven (≤ the register's
    // per-row budget and ≤ the 4 that the engine suite reserves for this row).
    let attempts = 0
    let failures = 0
    let counterexample = 'none'
    const arms: string[] = []
    let status: SmokeRowReport['status'] = 'UNDETERMINED'

    const affordanceMissing = !smokeHasGuardEnterAffordance()
    if (affordanceMissing) {
      counterexample = `the harness provides no '${GUARD_ENTER_MARKER}' entry log (§4's affordance) — the row is UNDETERMINED`
      status = 'UNDETERMINED'
    } else {
      // ---- arm 1: the live run (the scaling guard passes naturally) ----------
      attempts += 1
      const live = runSmokeOnce()
      if (!live.ran) {
        failures += 1
        counterexample = `live arm did not run: ${live.reason}`
        status = 'EXPECTED-RED'
      } else {
        const entered = enteredGuards(live.stdout)
        const violations = guardLogViolations(live.stdout, entered)
        // the ordering reference is the EXIT-CAPABLE scaling guard's entry (the
        // retired tripwire's [runtime-fork:tripwire] print now sits INSIDE that
        // guard's body, so the entry — not the marker line — is what a later
        // guard must survive). Entry `index` values are compared to each other
        // (same scale); captured POSITIONS are compared to captured positions.
        const scaling = entered.find(g => g.id === SCALING_GUARD_ID)
        const scalingAt = scaling === undefined ? -1 : scaling.index
        const scalingEntryAt = scaling === undefined ? -1 : markerLineIndex(live.stdout, `${GUARD_ENTER_MARKER} ${JSON.stringify(scaling)}`)
        const legacyLineAt = live.stdout.split('\n').findIndex(l => l.includes('legacy-shape:profile'))
        arms.push(`live:entered=${entered.length}:post-scaling-guards=${entered.filter(g => g.index > scalingAt).length}:legacy-shape-line-after-scaling-entry=${legacyLineAt > scalingEntryAt}`)
        if (violations.length > 0) {
          failures += 1
          if (counterexample === 'none') counterexample = `live arm: ${violations.join(' | ')}`
        }
        // the entry log must contain a guard positioned AFTER the scaling guard
        // (the anti-vacuity clause) and the legacy-shape census must have REPORTED
        const censusEntry = entered.find(g => g.id === 'legacy-shape-census')
        const censusAt = censusEntry === undefined ? -1 : censusEntry.index
        if (scaling === undefined || censusAt <= scalingAt) {
          failures += 1
          if (counterexample === 'none') counterexample = `the legacy-shape census did not ENTER after the scaling guard (censusEntry=${censusAt}, ${SCALING_GUARD_ID}=${scalingAt})`
        } else if (legacyLineAt <= scalingEntryAt) {
          failures += 1
          if (counterexample === 'none') counterexample = `the legacy-shape census did not REPORT after the scaling guard's entry (legacyLine=${legacyLineAt}, scalingEntryLine=${scalingEntryAt})`
        }
      }

      // ---- arm 2: the FAULT-INJECTION arm (the liveness proof) --------------
      attempts += 1
      const injected = runFaultInjectedSmokeOnce()
      if (!injected.ran) {
        failures += 1
        status = 'EXPECTED-RED'
        counterexample = `fault arm not drivable: ${injected.reason}`
      } else {
        const entries = enteredGuards(injected.stdout)
        const violations = guardLogViolations(injected.stdout, entries, { requireFaultEvidence: true })
        const faulted = entries.filter(g => g.status === 'fail').map(g => g.id)
        arms.push(`fault:entered=${entries.length}:faulted=${faulted.join('+') || 'none'}`)
        if (violations.length > 0) {
          failures += 1
          if (counterexample === 'none') counterexample = `fault arm: ${violations.join(' | ')}`
        }
        if (injected.status === 0) {
          failures += 1
          if (counterexample === 'none') counterexample = 'the fault-injected run exited 0 — a failing guard was swallowed'
        }
      }
      status = failures > 0 ? 'BROKEN' : 'HELD'
    }

    const liveness = `${arms.length > 0 ? arms.join(' ') : 'no arm entered a guard'} pinned-seed=${PINNED_SEED}`
    reportSmokeRow({
      id: P_SM_1_ID,
      strategy: P_SM_1_STRATEGY,
      status,
      attempts,
      failures,
      liveness,
      counterexample,
    })

    // ---- the row's assertions (after the report, §8.4 rule 2) -------------
    expect(attempts, 'P-SM-1 drove no arm at all').toBeGreaterThan(0)
    expect(attempts, 'P-SM-1 exceeded its reserved attempts allowance in the register total').toBeLessThanOrEqual(P_SM_1_ATTEMPTS_ALLOWANCE)
    expect(smokeRowReports.map(r => r.id), 'P-SM-1 did not report its §8.4 line').toContain(P_SM_1_ID)
    expect(status, `P-SM-1 reported ${status} with counterexample=${counterexample}`).toBe('HELD')
    expect(failures, `P-SM-1 reported ${failures} failure(s): ${counterexample}`).toBe(0)
    // the four-value vocabulary + the liveness clause ("HELD requires at least
    // one live falsification clause"): the fault arm is that clause
    const last = smokeRowReports[smokeRowReports.length - 1]!
    expect(['HELD', 'BROKEN', 'EXPECTED-RED', 'UNDETERMINED']).toContain(last.status)
    expect(last.liveness, 'the row reported no liveness evidence').toContain('fault:')
    expect(last.liveness).toMatch(/faulted=/)
    expect(last.counterexample).toBe('none')
  }, 900_000)
})

// ============================================================================
// OFFLINE CONTROL — the guard-log + census contracts are verified against a
// SYNTHETIC log shaped exactly as the harness emits it, so the checkers
// themselves stay falsifiable without a smoke run (and on a clean checkout,
// where the smoke-driven cases skip)
// ============================================================================

/** The census lines the REAL smoke prints, verbatim in shape: every family
 *  reports cloneOps=0, and the CONVERTED data-driven family reports the
 *  path-enumeration topology (2·depth − 1 nodes / 2^depth − 1 states) with its
 *  own journal measurement published beside the census field. (The pre-
 *  conversion line — `registered=4117 … cloneOps=4094` with no measurement
 *  token — is kept below as the PRE-fix shape the checker must reject.) */
const BASELINE_CENSUS_LINES = [
  '[derived-fork:profile] method=placement states=4095 passes=1 elements=4095 census(registered=23 inTree=23 unplaced=0 destroyed=0 cloneOps=0)',
  '[fork-stress-data:profile] depth=12 method=cycle nodes=4095 census(registered=4117 inTree=4117 unplaced=0 destroyed=0 cloneOps=4094)',
]
const CONVERTED_CENSUS_LINES = [
  '[legacy-shape:profile] census(registered=17 inTree=14 unplaced=0 destroyed=0 prototype=3 cloneOps=0 journalCloneOps=0 journal=0)',
  '[derived-fork:profile] method=placement states=4095 passes=1 elements=4095 census(registered=23 inTree=23 unplaced=0 destroyed=0 cloneOps=0 journalCloneOps=0 journal=0)',
  '[fork-stress-data:profile] depth=12 method=placement states=4095 elements=4095 passes=1 census(registered=23 inTree=23 unplaced=0 destroyed=0 cloneOps=0 journalCloneOps=0 cloneOpKinds={} journal=0)',
]

describe('OFFLINE CONTROL — the NC-2 contract checkers accept the §4-shaped log and reject a vacuous one', () => {
  it('a synthetic entered-guard log satisfies every NC-2a/2b clause; a log without post-scaling-guard entries is rejected', () => {
    // The informational print the scaling guard emits (verbatim shape, measured
    // 2026-09-23 — NOTE it is no longer `(3× asserted)`: the cross-family bound
    // was RETIRED as an assertion by the ruling, so the line carries the
    // INFORMATIONAL label and both sets' composition instead).
    const INFORMATIONAL_LINE = '[runtime-fork:tripwire] INFORMATIONAL (construction-cost ratio, NOT a like-workload metric — no longer asserted): '
      + 'runtime fork-stress d12 total=1348.8ms [4095 real nodes, built INCREMENTALLY: 10 renders, 137 handlers, 11 flush yields, pass2≈687.7ms + compile≈476.4ms] '
      + 'vs placement-derived baseline 168.1ms [23 real nodes → 4095 path-states/wires by ONE bootstrap enumeration pass: passes=1, 1 render, 0 handlers, 0 flush yields, compile≈33.1ms] '
      + '= 8.02× — a CONSTRUCTION-METHOD cost ratio, NOT engine scaling; superseded as an assertion 2026-09-23 (docs/decisions.md RUNTIME-FORK-GROWTH-GUARD)'
    const base = [
      // the scaling guard enters FIRST (line index 1), then the informational
      // print (line index 2 — inside its body), then the later census entries
      `${GUARD_ENTER_MARKER} ${JSON.stringify({ id: SCALING_GUARD_ID, index: 1 })}`,
      INFORMATIONAL_LINE,
      `${GUARD_ENTER_MARKER} ${JSON.stringify({ id: 'legacy-shape-census', index: 40 })}`,
      `${GUARD_ENTER_MARKER} ${JSON.stringify({ id: 'fork-stress-census', index: 41 })}`,
      `${GUARD_ENTER_MARKER} ${JSON.stringify({ id: 'static-path-census', index: 42 })}`,
      '[legacy-shape:profile] census(registered=17 inTree=14 unplaced=0 destroyed=0 prototype=3 cloneOps=0)',
    ].join('\n')
    expect(guardLogViolations(base, enteredGuards(base))).toEqual([])

    // anti-vacuity: a log recording ONLY guards that entered BEFORE (or at) the
    // scaling guard — no entry after it — must be rejected
    const vacuous = [
      // every required guard IS present — so the ONLY thing that can reject this
      // log is the anti-vacuity clause (no entry AFTER the scaling guard)
      ...[...REQUIRED_GUARD_IDS].map((id, i) => `${GUARD_ENTER_MARKER} ${JSON.stringify({ id, index: i + 1 })}`),
      INFORMATIONAL_LINE,
    ].join('\n')
    const vacuousViolations = guardLogViolations(vacuous, enteredGuards(vacuous))
    expect(vacuousViolations.length, 'the anti-vacuity clause did not reject a log whose only entries precede/equal the scaling guard').toBeGreaterThan(0)
    expect(vacuousViolations.join(' ')).toMatch(/positioned AFTER the scaling guard/)

    // and a log whose scaling guard never ENTERED at all (the retired-id shape:
    // the id is required but no such guard ran) is rejected for that reason
    const missingScaling = [
      // every OTHER required id present, the informational line printed (so the
      // only violation can be the missing scaling entry)
      ...[...REQUIRED_GUARD_IDS].filter(id => id !== SCALING_GUARD_ID)
        .map((id, i) => `${GUARD_ENTER_MARKER} ${JSON.stringify({ id, index: i + 1 })}`),
      INFORMATIONAL_LINE,
    ].join('\n')
    const missingViolations = guardLogViolations(missingScaling, enteredGuards(missingScaling))
    expect(missingViolations.join(' '), 'a log with no scaling-guard entry was accepted').toMatch(/runtime-fork-growth-guard/)

    // the fault arm: the INJECTED guard visible FAILING in the log (its entry is
    // re-emitted with status "fail") plus the later census entries
    const faulted = [
      `${GUARD_ENTER_MARKER} ${JSON.stringify({ id: SCALING_GUARD_ID, index: 1, status: 'pass' })}`,
      '[smoke-guard:seam] TEST SEAM ACTIVE — PP_SMOKE_FAULT=runtime-fork-growth-guard injected into guard "runtime-fork-growth-guard"',
      `${GUARD_ENTER_MARKER} ${JSON.stringify({ id: SCALING_GUARD_ID, index: 3, status: 'fail' })}`,
      `[smoke-guard:fail] ${SCALING_GUARD_ID}`,
      INFORMATIONAL_LINE,
      ...REQUIRED_GUARD_IDS.filter(id => id !== SCALING_GUARD_ID)
        .map((id, i) => `${GUARD_ENTER_MARKER} ${JSON.stringify({ id, index: 40 + i, status: 'pass' })}`),
      '[legacy-shape:profile] census(cloneOps=0)',
    ].join('\n')
    expect(guardLogViolations(faulted, enteredGuards(faulted), { requireFaultEvidence: true })).toEqual([])

    // NC-2c's measurement contract: the PRE-fix census shape (no published
    // journal token, no depth token) is rejected; the CONVERTED shape is
    // accepted; and the independently derived clauses (clone count 0, node count
    // 2·depth − 1) reject a literal/alias census and a per-path mint.
    // (i) the PRE-fix shape is rejected for the right reasons
    const preFixCensus = cloneOpsCensusLines(BASELINE_CENSUS_LINES.join('\n'))
    const preFixViolations = censusViolations(preFixCensus)
    expect(preFixViolations.length, 'the pre-fix census shape was accepted — the measurement clause is vacuous').toBeGreaterThan(0)
    expect(preFixViolations.join(' ')).toMatch(/journal measurement token/)

    // (ii) the CONVERTED shape (both published sources + the depth token, the
    // path-enumeration topology) is accepted — this is the shape the landed
    // harness prints for this family
    const okCensus = cloneOpsCensusLines(CONVERTED_CENSUS_LINES.join('\n'))
    expect(censusViolations(okCensus)).toEqual([])

    // (iii) a census whose field disagrees with its PUBLISHED measurement
    const mismatched = cloneOpsCensusLines([
      '[legacy-shape:profile] census(registered=17 inTree=14 cloneOps=0 journalCloneOps=0)',
      '[fork-stress-data:profile] depth=12 method=placement census(registered=23 inTree=23 cloneOps=2 journalCloneOps=0 journal=0)',
    ].join('\n'))
    const mismatchedViolations = censusViolations(mismatched)
    expect(mismatchedViolations.length).toBeGreaterThan(0)
    expect(mismatchedViolations.join(' ')).toMatch(/≠ printed published measurement/)

    // (iv) the node half of the pin (§3 K6-e): the clone count is 0 and both
    // published tokens agree, but `registered` is the PER-PATH count — the exact
    // failure the user's ruling names, invisible to a clone-count-only clause.
    const perPathMint = cloneOpsCensusLines([
      '[legacy-shape:profile] census(registered=17 inTree=14 cloneOps=0 journalCloneOps=0)',
      '[fork-stress-data:profile] depth=12 method=placement census(registered=4095 inTree=4095 cloneOps=0 journalCloneOps=0 journal=0)',
    ].join('\n'))
    const perPathViolations = censusViolations(perPathMint)
    expect(perPathViolations.length, 'a per-path node mint (registered = 2^depth − 1 with cloneOps = 0) was ACCEPTED — the node clause is dead').toBeGreaterThan(0)
    expect(perPathViolations.join(' ')).toMatch(/independently derived 2·depth − 1 = 23/)

    // (iv-b) the clone half, in the other direction: a census that still reports
    // a non-zero clone count (the old model) is rejected by the derived 0
    const cloneRegression = cloneOpsCensusLines([
      '[legacy-shape:profile] census(registered=17 inTree=14 cloneOps=0 journalCloneOps=0)',
      '[fork-stress-data:profile] depth=12 method=placement census(registered=23 inTree=23 cloneOps=4094 journalCloneOps=4094 journal=4094)',
    ].join('\n'))
    expect(censusViolations(cloneRegression).length, 'a census still reporting the clone model was ACCEPTED').toBeGreaterThan(0)

    // (v) the derived clauses are not vacuous for the other depths the smoke runs
    // (4, 6, 8, 9, 10, 11, 12 — the pinned family). **d2 is EXCLUDED from the
    // PER-PATH arm on purpose:** at d2 the two expressions coincide
    // (2·2 − 1 = 3 = 2^2 − 1), so a "per-path mint" is indistinguishable from
    // the correct census there — the node clause is genuinely live only where
    // `2^depth − 1 > 2·depth − 1`, i.e. `depth ≥ 3` (the same axis-separation
    // floor the §5 register rows use). d2 IS still swept for the accepted
    // converted census and the clone-count clause.
    const legacyLine = '[legacy-shape:profile] census(registered=17 inTree=14 cloneOps=0 journalCloneOps=0 journal=0)'
    for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
      const nodes = 2 * depth - 1
      const rowLine = (registered: number, cloneOps: number) =>
        `[fork-stress-data:profile] depth=${depth} method=placement census(registered=${registered} inTree=${registered} cloneOps=${cloneOps} journalCloneOps=${cloneOps} journal=0)`
      const line = cloneOpsCensusLines([legacyLine, rowLine(nodes, 0)].join('\n'))
      expect(censusViolations(line), `depth=${depth}: a legitimate converted census was rejected`).toEqual([])
      if (depth >= 3) {
        const perPath = cloneOpsCensusLines([legacyLine, rowLine(2 ** depth - 1, 0)].join('\n'))
        expect(censusViolations(perPath).length, `depth=${depth}: a per-path mint was accepted`).toBeGreaterThan(0)
      }
      const cloney = cloneOpsCensusLines([legacyLine, rowLine(nodes, 1)].join('\n'))
      expect(censusViolations(cloney).length, `depth=${depth}: a non-zero clone count was accepted`).toBeGreaterThan(0)
    }
  })
})

afterAll(() => {
  builtFn = null
})
