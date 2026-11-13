/**
 * FRS-B — PASS2-FIT-REFERENCE-SCOPE: the MEASUREMENT RECORD suite
 * (`docs/specs/pass2-fit-reference-scope.md` §7.2 FRS-9, §3 S4/S5, §5 P-SM-1,
 * §7.1's honest-red doctrine).
 *
 * ── WHAT THIS SUITE IS (and is NOT) ───────────────────────────────────────
 * The unit is a PERF unit whose exit evidence is a MEASUREMENT SET, not a green
 * guard (§3 S4: this unit does not green the pass-2 residual). This suite
 * therefore asserts the SHAPE of that evidence set and its PARSING:
 *
 *   FRS-9a  the `[runtime-fork:growth]` ENVELOPE line is PRESENT and prints BOTH
 *           depths' operands (d10 = 1023 nodes, d12 = 4095 nodes), the pass-2 and
 *           total readings, the pass2-ratio, the total-ratio, the node multiple
 *           (×4), the bound and the margin — and the printed ratio EQUALS the
 *           ratio of the two printed operands (a literal or a stale printed
 *           number is caught here). The `SMOKE-TWIPWIRE-INERT` class (a guard
 *           that "ran" but reported the wrong quantity or never printed) is what
 *           a missing line means.
 *   FRS-9b  the GROWTH guard's contract is FALSIFIABLE both ways: the printed
 *           bound is the ruling's 10× (not silently raised/removed), the printed
 *           margin is the bound ÷ the printed ratio, the harness's
 *           `assertRuntimeForkGrowth` — extracted and driven OFFLINE with a
 *           fabricated breaching profile — REJECTS a ratio above the bound (and
 *           accepts a within-envelope one), and the harness's failure text still
 *           names the class a breach means (per-node pass-2 cost degrading
 *           super-linearly). A test that could only pass — no offline
 *           falsifier — would be the finding; this case carries one.
 *   FRS-9c  the guard is REACHABLE AND REPORTING: `runtime-fork-growth-guard`
 *           appears in the ordered `[smoke-guard:enter]` entry log with status
 *           `"pass"` on the live arm (the run is GREEN unless the bound trips),
 *           no `[smoke-guard:fail]` line names it, and the retired cross-family
 *           ratio is still PRINTED — explicitly labelled INFORMATIONAL /
 *           no-longer-asserted — which is what forbids a silent re-assertion.
 *   FRS-9d  the derived-family `[derived-fork:pin]` lines are PRESENT and every
 *           parsed region ratio is inside the asserted 2.5× bound.
 *   FRS-9e  the per-level Δpass-2 series is PRESENT (the runtime fork-stress
 *           pages' `[fork-stress:profile]` lines at d6..d12) with a `pass2=`
 *           reading per level, and the last-two-level SHARE is reported.
 *   FRS-9f  the `[compile]` pass/visit census lines are PRESENT in the same run
 *           (§3 S4-b) and the census numbers are REPORTED.
 *   FRS-9g  the printed-precision window (above) is itself FALSIFIABLE: the
 *           shipped comparison is lifted out of this file and driven OFFLINE with
 *           fabricated, stale, label-swapped and decorative values — each must be
 *           REJECTED, the live envelope's own values ACCEPTED, and a one-decimal
 *           print must derive a ±0.05 window (a fixed constant would not).
 *   FRS-9h  the printed-precision window is PROVABLY sufficient: the SHIPPED
 *           window is swept over the plausible true value of every derived form
 *           this file compares (margin, per-node, pass2-ratio) and must cover the
 *           worst honest rounding gap at EVERY step — the epsilon is MEASURED, not
 *           hand-tuned — while every FRS-9g fabricated arm's gap must stay ≥10× the
 *           window at its point (a window that grew toward a fabricated value
 *           fails here). This is the deterministic regression pin for the
 *           2026-09-23 operand-`weight` defect (see the header's ✎ note below).
 *
 * ── NO TIMING THRESHOLD IS ASSERTED (§5 omissions row 1) ──────────────────
 * The ORD-P1 flake lesson: a wall-clock assertion encodes machine state as a
 * contract. Every number this suite reads is REPORTED; the only numeric
 * assertions are on the SHAPE (positivity, the printed-ratio-vs-operand
 * identity, the printed margin vs the printed ratio, the 10× bound the harness
 * itself prints, the offline falsifier, the 2.5× derived bound the harness
 * already asserts) — never on a saving.
 *
 * ── ✎ THE COMPARISONS ARE MADE AT THE PRINTED PRECISION, NOT ABOVE IT ──────
 * (flake fix 2026-09-23 — it is a PRECISION-ROUNDING defect, NOT a timing
 * tolerance, and no assertion was deleted or loosened past what the harness
 * prints.) The harness prints the growth envelope's DERIVED quantities to TWO
 * decimals while the OPERANDS they are computed from are printed to ONE decimal
 * — measured, verbatim: `… pass2=109.4ms total=177.5ms → d12 … pass2=713.6ms
 * total=1348.4ms = pass2-ratio 6.53× / total-ratio 7.60× over 4× the nodes
 * (per-node 1.63×); bound 10×; margin 1.53×`. A derived quantity that sits ON a
 * rounding boundary (e.g. the true per-node quotient 5.82 / 4 = 1.455 vs the
 * printed `1.45`) therefore lands exactly one half-unit — 0.005 — from the
 * value re-derived from the printed operands, and `toBeCloseTo(…, 2)` rejects
 * AT its own boundary (`|diff| < 0.005`): the case flipped run to run because
 * the page totals/readings move slightly per run and the quotient crossed the
 * boundary. `assertPrintedDerivation` compares each printed derivation to the
 * quotient of ITS OWN printed operands inside the window the printed digits
 * justify — the printed value's own ±half-unit window PLUS the rounding the
 * printed operands contribute — so the identity is still asserted, just inside
 * the precision the harness actually prints rather than at a precision the
 * harness never emitted. Hard-coding an expected ratio remains forbidden (that
 * is the falsifiability this case exists for; see the FALSIFICATION note per
 * assertion).
 *
 * ✎ THE WINDOW'S OPERAND TERM IS THE EXACT PARTIAL DERIVATIVE (2026-09-23, the
 * follow-up defect — a TEST-side bug, not a harness one). `Math.abs(expected /
 * op.value)` IS `∂q/∂operand` for every quotient this file compares
 * (`a/b` w.r.t. `a` is `1/b`; w.r.t. `b` it is `a/b²` — both `|q / operand|`).
 * The margin and per-node call sites then ALSO passed `1 / divisor` as the
 * operand's `weight`, multiplying the correct term down: a margin window 6×
 * too small, a per-node window 4× too small — i.e. tighter than the printed
 * precision — so FRS-9b (and the matching FRS-9g arms) failed on ~1 run in 10,
 * when a true ratio such as 6.0449 rounded to `6.04` and its rounded margin
 * `1.65` sat 0.00563 from `10 / 6.04` inside a 0.00523 window. Every weight is
 * now `1`; the node multiple is a DERIVED constant, not a printed operand, so it
 * contributes no term at all. FRS-9h proves the corrected window is sufficient
 * (and not widened into a fudge factor) by sweeping each form's plausible band.
 *
 * ── EXPECTED STATUS ───────────────────────────────────────────────────────
 * GREEN-AS-REPORTED after the harness lands the envelope print (P-SM-1: "HELD" =
 * *reported*, with the pass-2 residual itself still OPEN —
 * `docs/defects.md` RUNTIME-FORK-PASS2-RATIO).
 *
 * ── ✎ HISTORICAL NOTE (2026-09-23) ────────────────────────────────────────
 * FRS-9a/9b/9c used to assert the **retired cross-family 3× tripwire**: the old
 * `[runtime-fork:tripwire] … = N× (3× asserted)` line format, the literal `3`
 * bound, the "ratio still > bound / the tripwire is honestly RED" clauses, and
 * the retired guard id `runtime-fork-tripwire` entering with `status:"fail"`.
 * The user's ruling of 2026-09-23 RETIRED that assertion — its two operands are
 * page totals over DIFFERENT CONSTRUCTION METHODS (23 real nodes / one bootstrap
 * enumeration pass vs 4095 real nodes built incrementally), so the ratio never
 * measured engine scaling, and the 3× bound had been calibrated on a
 * derived-vs-derived reading. The failing scaling signal is now the
 * **runtime-vs-runtime growth guard** (`runtime-fork-growth-guard`, statistic =
 * the pass-2 ratio d10 → d12, bound 10× = a 1.30× margin over the measured
 * 6.07-7.70× envelope; `docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD, which
 * SUPERSEDES RUNTIME-FORK-TRIPWIRE-BOUND). The cross-family measurement survives
 * as an INFORMATIONAL print ONLY. Defect record: `docs/defects.md`
 * FORK-STRESS-TRIPWIRE-STALE-SPEC.
 *
 * ── PHASE REGISTRATION (AGENTS.md item 4) ─────────────────────────────────
 * This file spawns the WHOLE demo smoke, so it MUST run only in the serialised
 * smoke-ops phase: it is listed in `SMOKE_SPAWNING_TEST_FILES` (`vitest.config.ts`)
 * and in the include pattern of `vitest.smoke.config.ts`. Never skipped, never
 * env-gated (`docs/decisions.md` NO-CLONE-TEST-PHASE-ISOLATION).
 */
import { describe, it, expect } from 'vitest'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SMOKE_PATH = join(REPO, 'scripts', 'demo-smoke.mjs')
/** This file's own path — FRS-9g lifts the shipped printed-precision window out
 *  of it (never a re-typed copy). */
const TEST_PATH = fileURLToPath(import.meta.url)

/** The harness's printed markers (identified by MARKER, never by source line —
 *  the harness is under active edit). */
/** The GROWTH guard's envelope line — the smoke's failing scaling signal
 *  (runtime-vs-runtime d10 → d12 pass-2 ratio, bound 10×). */
const GROWTH_MARKER = '[runtime-fork:growth]'
/** The RETIRED cross-family 3× tripwire's print — now INFORMATIONAL ONLY (user
 *  ruling 2026-09-23; `docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD). */
const INFORMATIONAL_MARKER = '[runtime-fork:tripwire]'
const DERIVED_PIN_MARKER = '[derived-fork:pin]'
const DERIVED_BASELINE_MARKER = '[derived-fork:baseline]'
const RUNTIME_PROFILE_MARKER = '[fork-stress:profile]'
const COMPILE_MARKER = '[compile] pass over'
const GUARD_ENTER_MARKER = '[smoke-guard:enter]'
const GUARD_FAIL_MARKER = '[smoke-guard:fail]'

/** The GROWTH guard's id — the harness's exit-capable scaling guard (the retired
 *  `runtime-fork-tripwire` is no longer a guard id at all). The bound and the
 *  margin are READ from the printed line, never re-declared as contract values
 *  here (the ONLY bound literal in this file is the identity check that the line
 *  still prints the ruling's 10× — `docs/decisions.md`
 *  RUNTIME-FORK-GROWTH-GUARD`). */
const GROWTH_GUARD_ID = 'runtime-fork-growth-guard'
const RUNTIME_GROWTH_BOUND_MULTIPLE = 10
/** A guard that must ENTER AFTER the growth guard if the run did not exit early
 *  (`docs/specs/no-clone-invariants.md` §4; the SMOKE-GUARD-UNREACHABLE fix).
 *  Every census guard enters BEFORE the growth guard (measured 2026-09-23:
 *  growth entry index 8713, legacy-shape-census 8735), so the post-growth
 *  entries are these LATER blocks. */
const POST_GROWTH_GUARD_IDS = ['legacy-shape-census', 'fork-stress-census', 'static-path-census'] as const

/** The demo artifacts the smoke drives. Absent on a clean checkout
 *  (`npm run demo:build` + `node scripts/build-demo.mjs` produce them) — the
 *  repo's documented skip-when-absent pattern (T12,
 *  `tests/unit/no-clone-guards.test.ts`). This is a BUILD precondition, not a
 *  weakening: a present artifact set that fails to print a line is a FAILURE. */
function demoArtifactsPresent(): boolean {
  return existsSync(join(REPO, 'demo', 'fork-stress-d12.html'))
    && existsSync(join(REPO, 'demo', 'fork-stress-data-d2.html'))
}
const DEMO_ARTIFACTS_PRESENT = demoArtifactsPresent()
const SKIP_REASON = `demo artifacts absent — run \`npm run demo:build\` + \`node scripts/build-demo.mjs\` first (${join('demo', 'fork-stress-d12.html')})`

interface SmokeRun { ran: boolean; reason: string; status: number | null; stdout: string }

/** The smoke is spawned ONCE and shared by every case. */
const smokeRun: SmokeRun = { ran: false, reason: 'not started', status: null, stdout: '' }

function runSmokeOnce(): SmokeRun {
  if (smokeRun.ran) return smokeRun
  if (!DEMO_ARTIFACTS_PRESENT) { smokeRun.reason = SKIP_REASON; return smokeRun }
  const res = spawnSync(process.execPath, [SMOKE_PATH], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 900_000,
    maxBuffer: 512 * 1024 * 1024,
  })
  smokeRun.ran = true
  smokeRun.status = res.status
  smokeRun.stdout = `${res.stdout ?? ''}\n${res.stderr ?? ''}`
  return smokeRun
}

const smoke = runSmokeOnce()
const SKIP = !smoke.ran
if (SKIP) console.warn(`[pass2-fit-reference-scope-measurement] SKIPPING the FRS-9 cases: ${smoke.reason}`)

const lines = (): string[] => smoke.stdout.split('\n')
const linesWith = (marker: string): string[] => lines().filter(l => l.includes(marker))

/** Parse a `key=<number>ms` field out of a formatted line. */
function numField(line: string, key: string): number | null {
  const m = new RegExp(`${key}=(-?\\d+(?:\\.\\d+)?)`).exec(line)
  return m ? Number(m[1]) : null
}

// ═══ FRS9-EXTRACT:BEGIN ═══════════════════════════════════════════════════════
// The block between these markers is lifted by this file's own OFFLINE FALSIFIER
// (FRS-9g, below), so the printed-precision window the LIVE assertions use is the
// SAME code that is driven with FABRICATED values — the
// `assertRuntimeForkGrowth` / `assertForkStressCensus` extraction technique. Keep
// the markers, and keep this block free of suite state (it must be loadable and
// drivable on its own; the extractor removes the leading typedef block and the
// signature annotations with the same `new Function` lift the sibling suite uses).
interface GrowthEnvelope {
  lowDepth: number
  lowNodes: number
  lowPass2: number
  lowTotal: number
  highDepth: number
  highNodes: number
  highPass2: number
  highTotal: number
  pass2Ratio: number
  totalRatio: number
  nodeMultiple: number
  perNode: number
  bound: number
  margin: number
  /** The printed TEXT of every field the derived-value assertions divide by, so
   *  each comparison can be made at the precision the harness actually PRINTED
   *  instead of at a higher one (the flake fix — see the header). */
  text: {
    lowPass2: string
    lowTotal: string
    highPass2: string
    highTotal: string
    pass2Ratio: string
    totalRatio: string
    perNode: string
    nodeMultiple: string
    margin: string
  }
}

/** The number of decimals a printed number literal carries (`6.53` → 2,
 *  `109.4` → 1, `4` → 0). This is the precision the harness actually PRINTED,
 *  and therefore the precision a comparison is entitled to assume — never more. */
function printedDecimals(text: string): number {
  const dot = text.indexOf('.')
  return dot < 0 ? 0 : text.length - dot - 1
}

/** Half a unit in the last printed decimal place — the largest amount by which a
 *  correctly rounded printed value may differ from the true value it printed. */
function printHalfUnit(text: string): number {
  return 0.5 * 10 ** -printedDecimals(text)
}

/** The minimal shape of Vitest's `expect` this block needs, passed IN rather than
 *  closed over: the block must be liftable and drivable on its own (the FRS-9g
 *  offline falsifier), where a plain throw-on-violation check stands in — the
 *  SAME violation condition (`diff > window`), so a fabricated value the live
 *  suite rejects is rejected by the driver too. */
type ExpectWithin = (actual: number, message: string) => { toBeLessThanOrEqual(bound: number): void }

/** THE PRINTED-PRECISION COMPARISON (the flake fix; used by every derived-value
 *  assertion in this file).
 *
 *  `printed` is a value the harness formatted (`toFixed`), so it may legitimately
 *  differ from the true value by up to half its last printed unit. That half unit
 *  is added SEPARATELY (`printHalfUnit(printedText)`) and is never folded into a
 *  weight.
 *
 *  `expected` is the quotient of values that were THEMSELVES printed, so it
 *  carries their rounding too: an operand printed with half-unit error `e` moves
 *  the quotient by `e × |∂q / ∂operand|`. For EVERY quotient this file compares —
 *  `highPass2 / lowPass2`, `10 / pass2Ratio`, `pass2Ratio / nodeMultiple` — that
 *  partial derivative is EXACTLY `|expected / op.value|`, already evaluated at
 *  the printed operands (`∂(a/b)/∂a = 1/b` and `∂(a/b)/∂b = a/b²` both collapse
 *  to `|q / operand|`). So the operand term is
 *  `Σ printHalfUnit(op.text) × |expected / op.value|`, with NO extra factor.
 *
 *  `weight` stays in the signature — it is the public shape of the lifted
 *  FRS9-EXTRACT block, and the offline falsifier drives it — for the one case it
 *  can ever be needed: an operand that is NOT independent of the others, where
 *  its rounding propagates differently from the local derivative. Every call site
 *  in this file passes `1`. A constant divisor is NOT a derived operand and must
 *  not be passed at all: the node multiple is the DERIVED `2^(highDepth −
 *  lowDepth)`, not a printed reading, so it contributes no rounding term (it is
 *  excluded rather than weighted — `printHalfUnit('4')` would be 0.5, i.e. a
 *  wholly invented term).
 *
 *  ✎ DEFECT NOTE (2026-09-23 — this paragraph replaces the sentence that CAUSED
 *  the flake): passing the divisor as a weight on top of the already-exact
 *  derivative (`1 / nodeMultiple`, `1 / pass2Ratio`) multiplied the operand term
 *  DOWN — 4× too small for a per-node quotient, 6× too small for a margin — so
 *  the window came out TIGHTER than the printed precision it exists to model.
 *  FRS-9b's margin arm and FRS-9g's margin/per-node arms then failed
 *  intermittently (~1 run in 10) exactly when the true ratio's third decimal
 *  pushed the correctly rounded print just past that too-small window. FRS-9h
 *  below now PROVES the corrected window covers the worst honest rounding gap
 *  over each form's plausible band (measured, not hand-tuned).
 *
 *  Returns the window AND asserts the comparison, so every call site states the
 *  window in its failure message. The window is derived from the printed digits —
 *  tighten the harness's print and the window tightens with it; widen it and the
 *  window widens, but never past what is printed. */
function assertPrintedDerivation(
  expectWithin: ExpectWithin,
  printed: number,
  printedText: string,
  expected: number,
  expectedText: string,
  derivedFrom: ReadonlyArray<{ text: string; value: number; weight: number }>,
  message: string,
): number {
  const operandTerm = derivedFrom.reduce(
    (sum, op) => sum + printHalfUnit(op.text) * Math.abs(expected / op.value) * op.weight,
    0,
  )
  const window = printHalfUnit(printedText) + operandTerm
  expectWithin(
    Math.abs(printed - expected),
    `${message}; expected ${expected.toFixed(6)} (${expectedText}), printed window ±${window.toFixed(6)} = `
    + `±${printHalfUnit(printedText).toFixed(6)} (the ${printedDecimals(printedText)} printed decimal(s) of ${printedText}) `
    + `+ ±${operandTerm.toFixed(6)} (rounding of the printed operands ${derivedFrom.map(op => op.text).join(', ')})`,
  ).toBeLessThanOrEqual(window)
  return window
}
/** Parse the GROWTH guard's envelope line, verbatim shape (measured 2026-09-23):
 *  `[runtime-fork:growth] STATISTIC=pass2-ratio (most stable: ±1.5% over repeats;
 *   the total ratio spreads ±3.0%) — d10 nodes=1023 pass2=118.2ms total=184.6ms
 *   → d12 nodes=4095 pass2=687.7ms total=1348.8ms = pass2-ratio 5.82× /
 *   total-ratio 7.31× over 4× the nodes (per-node 1.45×); bound 10×;
 *   margin 1.72×`
 *
 *  Returns null unless EVERY field of the envelope parses — a partially printed
 *  envelope (the "guard stopped printing its envelope" falsifier) is a miss. */
function parseGrowthEnvelope(line: string): GrowthEnvelope | null {
  // NB the leading \b on the LOW arm: without it `d(\d+)` anchors onto the
  // `d12` that follows the arrow and the envelope parses as "d12 → d12".
  const low = /\bd(\d+)\s+nodes=(\d+)\s+pass2=(-?\d+(?:\.\d+)?)ms\s+total=(-?\d+(?:\.\d+)?)ms/.exec(line)
  const high = /→\s*d(\d+)\s+nodes=(\d+)\s+pass2=(-?\d+(?:\.\d+)?)ms\s+total=(-?\d+(?:\.\d+)?)ms/.exec(line)
  const ratios = /pass2-ratio\s+(-?\d+(?:\.\d+)?)×\s*\/\s*total-ratio\s+(-?\d+(?:\.\d+)?)×\s+over\s+(\d+)×\s+the nodes\s*\(per-node\s+(-?\d+(?:\.\d+)?)×\)/.exec(line)
  const bound = /bound\s+(-?\d+(?:\.\d+)?)×\s*;\s*margin\s+(-?\d+(?:\.\d+)?)×/.exec(line)
  if (!low || !high || !ratios || !bound) return null
  return {
    lowDepth: Number(low[1]), lowNodes: Number(low[2]), lowPass2: Number(low[3]), lowTotal: Number(low[4]),
    highDepth: Number(high[1]), highNodes: Number(high[2]), highPass2: Number(high[3]), highTotal: Number(high[4]),
    pass2Ratio: Number(ratios[1]), totalRatio: Number(ratios[2]), nodeMultiple: Number(ratios[3]), perNode: Number(ratios[4]),
    bound: Number(bound[1]), margin: Number(bound[2]),
    text: {
      lowPass2: low[3], lowTotal: low[4], highPass2: high[3], highTotal: high[4],
      pass2Ratio: ratios[1], totalRatio: ratios[2], perNode: ratios[4],
      nodeMultiple: ratios[3], margin: bound[2],
    },
  } as GrowthEnvelope
}

// ═══ FRS9-EXTRACT:END ═════════════════════════════════════════════════════════

/** Extract the harness's PURE growth assertion (`assertRuntimeForkGrowth`) and
 *  bind it to stubs, so the guard's falsifiability is demonstrable OFFLINE — the
 *  `assertForkStressCensus` extraction technique
 *  (`tests/unit/no-clone-guards.test.ts` NC-2d). */
function buildGrowthAssertion(): (low: unknown, high: unknown, ld: number, hd: number, bound: number) => string {
  const src = readSmoke()
  const start = src.indexOf('function assertRuntimeForkGrowth(')
  expect(start, 'assertRuntimeForkGrowth is no longer defined in scripts/demo-smoke.mjs — the growth guard lost its pure, drivable assertion').toBeGreaterThan(-1)
  const end = src.indexOf('\n}', start)
  const fnSrc = src.slice(start, end + 2)
  const stubConsole = { error: () => {}, log: () => {}, warn: () => {} }
  const fn = new Function('console', `${fnSrc}\nreturn assertRuntimeForkGrowth`)(stubConsole) as
    (low: unknown, high: unknown, ld: number, hd: number, bound: number) => string
  return fn
}

/** Read the harness source (the offline, falsifiability half of FRS-9b). */
function readSmoke(): string {
  return readFileSync(SMOKE_PATH, 'utf8')
}

/** Read THIS file's own source — the offline, falsifiability half of FRS-9g: the
 *  printed-precision window is lifted out of the shipped file rather than
 *  re-typed here, so the driven code IS the asserting code. */
function readThisFile(): string {
  return readFileSync(TEST_PATH, 'utf8')
}

/** Lift the FRS9-EXTRACT block (the printed-precision window + the envelope
 *  parser) out of this file and bind it for direct driving — the same technique
 *  `buildGrowthAssertion` uses on the harness. Type annotations are removed the
 *  way `new Function` requires; everything else is the shipped source verbatim. */
function liftPrintedPrecisionBlock(): {
  printedDecimals: (text: string) => number
  printHalfUnit: (text: string) => number
  assertPrintedDerivation: (
    expectWithin: ExpectWithin, printed: number, printedText: string, expected: number,
    expectedText: string, derivedFrom: ReadonlyArray<{ text: string; value: number; weight: number }>,
    message: string,
  ) => number
  parseGrowthEnvelope: (line: string) => GrowthEnvelope | null
} {
  const src = readThisFile()
  const beginAt = src.indexOf('FRS9-EXTRACT:BEGIN')
  const endAt = src.indexOf('FRS9-EXTRACT:END')
  expect(beginAt, 'the FRS9-EXTRACT:BEGIN marker is gone — the offline falsifier can no longer lift the shipped window').toBeGreaterThan(-1)
  expect(endAt, 'the FRS9-EXTRACT:END marker is gone').toBeGreaterThan(beginAt)
  // Slice WHOLE lines (the markers are mid-comment-line), so the lifted text is
  // valid source rather than a truncated comment.
  const block = `// ${src.slice(src.lastIndexOf('\n', beginAt) + 1, src.lastIndexOf('\n', endAt))}`
    .replace(/interface GrowthEnvelope \{[\s\S]*?\n\}/, '')
    .replace(/type ExpectWithin = [^\n]*\n/, '')
    .replace(/function printedDecimals\(text: string\): number \{/, 'function printedDecimals(text) {')
    .replace(/function printHalfUnit\(text: string\): number \{/, 'function printHalfUnit(text) {')
    .replace(/function parseGrowthEnvelope\(line: string\): GrowthEnvelope \| null \{/, 'function parseGrowthEnvelope(line) {')
    .replace(
      /function assertPrintedDerivation\([\s\S]*?\): number \{/,
      'function assertPrintedDerivation(expectWithin, printed, printedText, expected, expectedText, derivedFrom, message) {',
    )
    .replace(/ as GrowthEnvelope\b/, '')
  // The lift must have left NO TypeScript syntax behind — a leftover annotation
  // would otherwise surface as an opaque SyntaxError at the drive site.
  expect(
    block,
    'the lifted block still carries a TS-only construct (a new annotation/assertion was added inside the FRS9-EXTRACT block without teaching the extractor to strip it)',
  ).not.toMatch(/\binterface\s+\w+\s*\{|\btype\s+\w+\s*=|\w+:\s*(number|string|boolean|GrowthEnvelope|ExpectWithin)\b|\bas\s+GrowthEnvelope\b|\w+![.,)\]]/)
  return new Function(`${block}\nreturn { printedDecimals, printHalfUnit, assertPrintedDerivation, parseGrowthEnvelope }`)() as
    ReturnType<typeof liftPrintedPrecisionBlock>
}

/** THE FABRICATED ARMS the printed-precision window must reject (FRS-9g), kept in
 *  ONE place and shared with FRS-9h's teeth check, so "every fabricated arm" is
 *  enumerated BY CONSTRUCTION rather than by a second, drift-prone copy. Each arm
 *  is a real failure mode: a fabricated literal, a stale number from another
 *  run/level, the wrong labelled quantity, and a decorative margin that does not
 *  track its inputs.
 *
 *  Every operand's `weight` is `1` — `|expected / op.value|` is ALREADY the exact
 *  partial derivative of each quotient (see `assertPrintedDerivation`), so passing
 *  the divisor again (`1 / nodeMultiple`, `1 / pass2Ratio`) multiplied the window
 *  down below the printed precision; that was the 2026-09-23 FRS-9b/9g flake.
 *  The node multiple is deliberately NOT a derived operand here for the same
 *  reason: it is derived (`2^(high − low)`), not printed, so it carries no
 *  rounding. */
interface FabricatedArm {
  arm: string
  fabricated: number
  label: string
  text: string
  q: number
  deriv: ReadonlyArray<{ text: string; value: number; weight: number }>
}

function fabricatedArms(e: GrowthEnvelope): FabricatedArm[] {
  const pass2Deriv = [
    { text: e.text.highPass2, value: e.highPass2, weight: 1 },
    { text: e.text.lowPass2, value: e.lowPass2, weight: 1 },
  ]
  const totalDeriv = [
    { text: e.text.highTotal, value: e.highTotal, weight: 1 },
    { text: e.text.lowTotal, value: e.lowTotal, weight: 1 },
  ]
  const ratioDeriv = [{ text: e.text.pass2Ratio, value: e.pass2Ratio, weight: 1 }]
  return [
    {
      arm: 'pass2-ratio', fabricated: 10, label: 'a fabricated literal (10.00)', text: e.text.pass2Ratio,
      q: e.highPass2 / e.lowPass2, deriv: pass2Deriv,
    },
    {
      arm: 'pass2-ratio', fabricated: 3, label: 'a stale ratio from another run (3.00)', text: e.text.pass2Ratio,
      q: e.highPass2 / e.lowPass2, deriv: pass2Deriv,
    },
    {
      arm: 'total-ratio', fabricated: e.pass2Ratio, label: 'the PASS2 ratio re-printed under the total-ratio label', text: e.text.totalRatio,
      q: e.highTotal / e.lowTotal, deriv: totalDeriv,
    },
    {
      arm: 'per-node', fabricated: 2, label: 'a per-node ratio not derived from pass2-ratio ÷ the node multiple (2.00)', text: e.text.perNode,
      q: e.pass2Ratio / e.nodeMultiple, deriv: ratioDeriv,
    },
    {
      arm: 'margin', fabricated: 9.99, label: 'a decorative margin that is not bound ÷ the printed ratio (9.99)', text: e.text.margin,
      q: e.bound / e.pass2Ratio, deriv: ratioDeriv,
    },
    {
      arm: 'margin', fabricated: 1, label: 'a stale margin left over from a 10× ratio (1.00)', text: e.text.margin,
      q: e.bound / e.pass2Ratio, deriv: ratioDeriv,
    },
  ]
}

/** A RECORDING (never throwing) drive of the shipped printed-precision window —
 *  the FRS-9h sweep harness. The window itself is computed by the SHIPPED code
 *  (lifted out of this file by `liftPrintedPrecisionBlock`, never re-typed), and
 *  each comparison is collected rather than thrown so a sweep can report the WORST
 *  honest gap and where it occurred: the point of the proof is that maximum, not
 *  the first violation. A violation is never swallowed — the case fails on a
 *  non-empty `violations`. */
interface WindowSweepStat {
  label: string
  comparisons: number
  violations: string[]
  maxGap: number
  maxGapAt: string
  windowAtMaxGap: number
  maxGapOverWindow: number
  maxGapOverWindowAt: string
}

function makeWindowSweep(label: string): {
  stat: WindowSweepStat
  /** Describe the CURRENT sweep point. A thunk, so a million-point sweep does not
   *  allocate a million description strings — it is only called when a violation
   *  or a new worst gap is recorded. */
  where: (point: () => string) => void
  expectWithin: ExpectWithin
} {
  const stat: WindowSweepStat = {
    label, comparisons: 0, violations: [], maxGap: 0, maxGapAt: '', windowAtMaxGap: 0,
    maxGapOverWindow: 0, maxGapOverWindowAt: '',
  }
  let at: () => string = () => '(unset)'
  return {
    stat,
    where: (point: () => string) => { at = point },
    expectWithin: (actual, message) => ({
      toBeLessThanOrEqual: (bound: number) => {
        stat.comparisons += 1
        if (!Number.isFinite(actual) || !Number.isFinite(bound)) {
          stat.violations.push(`[${at()}] NON-FINITE comparison — ${message}`)
        } else if (actual > bound) {
          stat.violations.push(`[${at()}] ${message}`)
        }
        if (actual > stat.maxGap) { stat.maxGap = actual; stat.maxGapAt = at(); stat.windowAtMaxGap = bound }
        const fraction = actual / bound
        if (fraction > stat.maxGapOverWindow) { stat.maxGapOverWindow = fraction; stat.maxGapOverWindowAt = at() }
      },
    }),
  }
}

interface GuardEntry { id: string; index: number; status?: string }

function enteredGuards(): GuardEntry[] {
  const out: GuardEntry[] = []
  for (const line of lines()) {
    const at = line.indexOf(GUARD_ENTER_MARKER)
    if (at < 0) continue
    const json = line.slice(at + GUARD_ENTER_MARKER.length).trim()
    try {
      const o = JSON.parse(json) as GuardEntry
      if (typeof o.id === 'string' && typeof o.index === 'number') out.push(o)
    } catch { /* a malformed entry line is not silently tolerated by the assertions below */ }
  }
  return out
}

// ============================================================================
// FRS-9a/9b/9c — the GROWTH guard's envelope is PRINTED, PARSED and FALSIFIABLE
// (✎ re-pointed 2026-09-23: the retired cross-family 3× tripwire's line format,
// its literal `3` bound and its "honestly RED / status fail" clauses are GONE —
// see the header's HISTORICAL NOTE)
// ============================================================================

describe('FRS-9 — the S4 measurement set is produced and reported (§3 S4/S5, §5 P-SM-1)', () => {
  it('FRS-9a the [runtime-fork:growth] envelope is present and prints BOTH depths with the ratio derived from its own operands', () => {
    // FALSIFICATION: a guard that stops printing its envelope (or one of the two
    // depths' readings), or prints a ratio that is NOT its own operands' quotient
    // (a literal / a stale number), fails here.
    if (SKIP) { expect(smoke.reason).toBe(SKIP_REASON); return }
    const growthLines = linesWith(GROWTH_MARKER)
    expect(
      growthLines.length,
      `the harness printed NO '${GROWTH_MARKER}' line — the growth guard ran but reported no envelope (the SMOKE-TWIPWIRE-INERT class: a guard must report its measurement). smoke status=${smoke.status}`,
    ).toBeGreaterThan(0)
    expect(growthLines[0], 'the envelope must still declare the STATISTIC it reports (the pass-2 ratio)').toContain('STATISTIC=pass2-ratio')
    const e = parseGrowthEnvelope(growthLines[0]!)
    expect(e, `the growth envelope did not parse (one of its fields is missing): "${growthLines[0]}"`).not.toBeNull()
    // both depths' readings, at the ruled depths and node counts
    expect([e!.lowDepth, e!.highDepth], 'the envelope must report the two runtime depths the ruling names (d10 and d12)').toEqual([10, 12])
    expect([e!.lowNodes, e!.highNodes], 'the envelope must report the node counts of those depths (2^10 − 1 = 1023, 2^12 − 1 = 4095)').toEqual([1023, 4095])
    expect(e!.nodeMultiple, 'the node multiple between the two depths must be the DERIVED 2^(12−10) = 4').toBe(4)
    // the per-depth node counts are the fork family's own formula (2^d − 1 —
    // the same DERIVATION the harness prints, checked against the depth it
    // prints). NB the printed `over 4× the nodes` multiple is the DEPTH multiple
    // 2^(high−low); it is NOT `lowNodes × 4` (1023 × 4 = 4092 ≠ 2^12 − 1 = 4095),
    // so the node census is pinned by the formula, not by that product.
    expect(e!.lowNodes, `d${e!.lowDepth}: the printed node count must be 2^${e!.lowDepth} − 1`).toBe(2 ** e!.lowDepth - 1)
    expect(e!.highNodes, `d${e!.highDepth}: the printed node count must be 2^${e!.highDepth} − 1`).toBe(2 ** e!.highDepth - 1)
    // positive readings (the §5 omissions-row-1 shape rule: never a timing bound)
    for (const [label, v] of [['d10 pass2', e!.lowPass2], ['d12 pass2', e!.highPass2], ['d10 total', e!.lowTotal], ['d12 total', e!.highTotal]] as const) {
      expect(v, `the ${label} reading must be a POSITIVE number`).toBeGreaterThan(0)
    }
    // the printed ratio IS the quotient of the printed operands — compared
    // inside the window the PRINTED digits justify (the flake fix: the harness
    // prints the ratio to 2 decimals and the operands to 1, so an on-boundary
    // quotient lands exactly one half-unit from this re-derivation). FALSIFIES:
    // a ratio that is a fabricated literal, a stale number from a previous
    // level/page, or otherwise not its own operands' quotient.
    assertPrintedDerivation(
      expect,
      e!.pass2Ratio, e!.text.pass2Ratio, e!.highPass2 / e!.lowPass2,
      `${e!.highPass2} / ${e!.lowPass2}`, [
        { text: e!.text.highPass2, value: e!.highPass2, weight: 1 },
        { text: e!.text.lowPass2, value: e!.lowPass2, weight: 1 },
      ],
      `the printed pass2-ratio (${e!.pass2Ratio}×) must equal d12 pass2 / d10 pass2 = ${e!.highPass2} / ${e!.lowPass2}`,
    )
    // FALSIFIES: a total-ratio that is not the two printed page totals' quotient
    // (a literal, or the pass2 ratio re-printed under the total label).
    assertPrintedDerivation(
      expect,
      e!.totalRatio, e!.text.totalRatio, e!.highTotal / e!.lowTotal,
      `${e!.highTotal} / ${e!.lowTotal}`, [
        { text: e!.text.highTotal, value: e!.highTotal, weight: 1 },
        { text: e!.text.lowTotal, value: e!.lowTotal, weight: 1 },
      ],
      `the printed total-ratio (${e!.totalRatio}×) must equal d12 total / d10 total = ${e!.highTotal} / ${e!.lowTotal}`,
    )
    // FALSIFIES: a per-node ratio that is not the printed pass2-ratio over the
    // printed node multiple (the value the guard exists to report per node).
    // NB the weight is `1`: `∂(ratio / 4)/∂ratio = 1/4 = |expected / ratio|`
    // already — the node multiple is a DERIVED constant, not a printed operand,
    // so it contributes no rounding term (passing `1 / nodeMultiple` here was the
    // 2026-09-23 defect: a 4×-too-small window).
    assertPrintedDerivation(
      expect,
      e!.perNode, e!.text.perNode, e!.pass2Ratio / e!.nodeMultiple,
      `${e!.pass2Ratio} / ${e!.nodeMultiple}`, [
        { text: e!.text.pass2Ratio, value: e!.pass2Ratio, weight: 1 },
      ],
      `the printed per-node ratio (${e!.perNode}×) must be the printed pass2-ratio ÷ the node multiple = ${e!.pass2Ratio} / ${e!.nodeMultiple}`,
    )

    console.log(
      `[frs-9a:growth] d${e!.lowDepth}(${e!.lowNodes} nodes) pass2=${e!.lowPass2}ms total=${e!.lowTotal}ms → d${e!.highDepth}(${e!.highNodes} nodes) pass2=${e!.highPass2}ms total=${e!.highTotal}ms | pass2-ratio=${e!.pass2Ratio}× total-ratio=${e!.totalRatio}× per-node=${e!.perNode}× bound=${e!.bound}× margin=${e!.margin}×`,
    )
  })

  it('FRS-9b the bound is the ruling\'s 10× with the printed margin, and the growth guard is FALSIFIABLE offline (a fabricated breach is rejected)', () => {
    // FALSIFICATION: a bound silently RAISED (or removed) fails the identity
    // check; a margin that is not the bound ÷ the printed ratio fails its own
    // check; and the extracted `assertRuntimeForkGrowth` driven with a fabricated
    // BREACHING profile must return a violation (a guard that cannot fail — the
    // "case that can only pass" finding — is caught by that driver).
    if (SKIP) { expect(smoke.reason).toBe(SKIP_REASON); return }
    const line = linesWith(GROWTH_MARKER)[0]!
    const e = parseGrowthEnvelope(line)
    expect(e, 'the growth envelope must parse (FRS-9a)').not.toBeNull()
    // THE BOUND: read from the line, asserted against the ruling's 10× (the ONE
    // bound literal in this file — `docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD)
    expect(
      e!.bound,
      `the printed bound must be the ruling's ${RUNTIME_GROWTH_BOUND_MULTIPLE}× — a silently raised or removed bound is a contract break (docs/decisions.md RUNTIME-FORK-GROWTH-GUARD)`,
    ).toBe(RUNTIME_GROWTH_BOUND_MULTIPLE)
    // THE MARGIN: bound ÷ the printed ratio, inside the window the PRINTED digits
    // justify (the same precision re-point as FRS-9a: the margin is printed to 2
    // decimals and the ratio it divides by is printed to 2, so the re-derivation
    // from the printed ratio carries that rounding too). FALSIFIES: a margin that
    // is not derived from its inputs — a literal, a stale margin from a previous
    // bound, or a headline number that does not move when the ratio moves (i.e.
    // a silently re-baselined bound reported with a decorative margin).
    // NB the weight is `1`: `∂(bound / ratio)/∂ratio = bound / ratio²` is exactly
    // `|expected / ratio|` — passing `1 / pass2Ratio` as well was the 2026-09-23
    // defect (a 6×-too-small window, and the intermittent FRS-9b failure).
    assertPrintedDerivation(
      expect,
      e!.margin, e!.text.margin, e!.bound / e!.pass2Ratio,
      `${e!.bound} / ${e!.pass2Ratio}`, [
        { text: e!.text.pass2Ratio, value: e!.pass2Ratio, weight: 1 },
      ],
      `the printed margin (${e!.margin}×) must be the bound ÷ the printed ratio = ${e!.bound} / ${e!.pass2Ratio}`,
    )

    // ---- THE OFFLINE FALSIFIER (the guard's own assertion, driven directly) ---
    const assertGrowth = buildGrowthAssertion()
    const breach = assertGrowth(100, 4000, 10, 12, RUNTIME_GROWTH_BOUND_MULTIPLE)
    const withinEnvelope = assertGrowth(100, 700, 10, 12, RUNTIME_GROWTH_BOUND_MULTIPLE)
    expect(
      breach,
      'assertRuntimeForkGrowth ACCEPTED a fabricated 40× breach of the 10× bound — the guard cannot fail (the growth pin is dead)',
    ).not.toBe('')
    expect(breach).toMatch(/per-node pass-2 cost is degrading super-linearly/)
    expect(
      withinEnvelope,
      `assertRuntimeForkGrowth REJECTED a within-envelope 7.00× profile: ${withinEnvelope}`,
    ).toBe('')
    // the absent-operand half (the "baseline absent must FAIL" clause): a missing
    // d10 reading cannot be evaluated and must be reported, never skipped
    expect(assertGrowth(undefined, 700, 10, 12, RUNTIME_GROWTH_BOUND_MULTIPLE), 'a MISSING d10 pass-2 baseline was accepted').not.toBe('')
    expect(assertGrowth(100, undefined, 10, 12, RUNTIME_GROWTH_BOUND_MULTIPLE), 'a MISSING d12 pass-2 reading was accepted').not.toBe('')
    // the failure text still names WHAT a breach means (the class, not "slower")
    const src = readSmoke()
    expect(
      src,
      'the harness no longer states what a growth breach MEANS — the failure class must stay named',
    ).toContain('PER-NODE PASS-2 COST IS DEGRADING SUPER-LINEARLY')
    expect(src, 'the harness no longer declares the growth bound constant the guard reads').toContain('const RUNTIME_GROWTH_BOUND_MULTIPLE = ')
    console.log(
      `[frs-9b:bound] printed bound=${e!.bound}× margin=${e!.margin}× ratio=${e!.pass2Ratio}× | offline falsifier: 40× breach → "${breach.slice(0, 96)}…"; 7.00× within-envelope → accepted; absent operand → rejected`,
    )
  })

  it('FRS-9c the growth guard is REACHABLE AND PASSING in the live log, and the retired cross-family ratio is printed but NOT asserted', () => {
    // FALSIFICATION: the growth guard absent from the ordered entry log (the
    // SMOKE-GUARD-UNREACHABLE class), a `[smoke-guard:fail]` line naming it (a
    // FAILED growth guard is the guard WORKING, but the live arm is the GREEN
    // arm — a natural failure here means the bound or the operands moved), the
    // INFORMATIONAL print deleted, or the print re-labelled as asserted (a silent
    // re-assertion of the retired cross-family ratio is exactly what the ruling
    // forbids).
    if (SKIP) { expect(smoke.reason).toBe(SKIP_REASON); return }
    const guards = enteredGuards()
    expect(guards.length, `the ordered '[smoke-guard:enter]' entry log is empty or unparsable (guards=${JSON.stringify(guards.slice(0, 3))})`).toBeGreaterThan(0)
    const growth = guards.find(g => g.id === GROWTH_GUARD_ID)
    expect(
      growth,
      `'${GROWTH_GUARD_ID}' is ABSENT from the ordered entry log — the guard did not run (the SMOKE-GUARD-UNREACHABLE class); entered ids=[${guards.map(g => g.id).join(', ')}]`,
    ).toBeDefined()
    // "the guard RAN" is evidenced by an entry, never by the absence of an error
    const later = guards.filter(g => g.index > growth!.index)
    expect(later.length, 'a guard AFTER the growth guard must still enter (a run that exits early is the SMOKE-GUARD-UNREACHABLE class)').toBeGreaterThan(0)
    expect(
      POST_GROWTH_GUARD_IDS.some(id => later.some(g => g.id === id)),
      `at least one census guard (${POST_GROWTH_GUARD_IDS.join(' / ')}) must enter AFTER the growth guard; later entries=[${later.map(g => `${g.id}@${g.index}`).join(', ')}]`,
    ).toBe(true)
    // the guard's own outcome: it PASSES in the live run (the ruling's own
    // statement: the smoke is GREEN unless the growth bound trips)
    expect(
      guards.some(g => g.id === GROWTH_GUARD_ID && g.status === 'pass'),
      `the growth guard entry must record status:"pass" in the live log (recorded=${JSON.stringify(guards.filter(g => g.id === GROWTH_GUARD_ID))})`,
    ).toBe(true)
    expect(
      linesWith(GUARD_FAIL_MARKER).some(l => l.includes(GROWTH_GUARD_ID)),
      'the live run recorded the growth guard as FAILED — the bound or the operands moved (the live arm is the GREEN arm)',
    ).toBe(false)

    // ---- the INFORMATIONAL, non-asserted survivor of the retired tripwire -----
    const informational = linesWith(INFORMATIONAL_MARKER)
    expect(
      informational.length,
      `the harness printed NO '${INFORMATIONAL_MARKER}' line — the retired cross-family measurement must still be REPORTED (it is what documents the construction-method confound)`,
    ).toBeGreaterThan(0)
    expect(
      informational[0],
      'the cross-family print must be labelled INFORMATIONAL and explicitly non-asserted — a silently re-asserted (or re-labelled) ratio is the failure this clause catches',
    ).toContain('INFORMATIONAL (construction-cost ratio, NOT a like-workload metric — no longer asserted)')
    // both sets' composition is stated (so nobody re-reads the ratio as scaling)
    expect(informational[0], 'the informational line must state the runtime operand\'s composition').toContain('4095 real nodes, built INCREMENTALLY')
    expect(informational[0], 'the informational line must state the derived operand\'s composition').toContain('23 real nodes → 4095 path-states/wires by ONE bootstrap enumeration pass')
    // the retired bound's assertion text must NOT be back (the line may say "no
    // longer asserted"; what it must never carry is the old printed BOUND FORM
    // `<N>× asserted`, which is how the retired guard's failure text read)
    expect(
      informational[0],
      'the informational line carries the retired "(N× asserted)" bound form — the cross-family assertion was restored',
    ).not.toMatch(/\(\s*\d+(?:\.\d+)?×\s*asserted\)/)
    console.log(`[frs-9c:guards] entered=${guards.length} growth@{${growth!.index}} status=${growth!.status} post-growth entries=${later.length} informational=${informational.length}`)
  })

  // ==========================================================================
  // FRS-9d — the derived-family pins
  // ==========================================================================

  it('FRS-9d the [derived-fork:pin] lines are present and every region ratio is inside 2.5×', () => {
    if (SKIP) { expect(smoke.reason).toBe(SKIP_REASON); return }
    const pins = linesWith(DERIVED_PIN_MARKER)
    expect(
      pins.length,
      `the harness printed NO '${DERIVED_PIN_MARKER}' line — the derived-family 2.5× pin cannot be evaluated`,
    ).toBeGreaterThan(0)
    expect(linesWith(DERIVED_BASELINE_MARKER).length, 'the placement-derived baseline line must be present too').toBeGreaterThan(0)
    const reported: string[] = []
    for (const line of pins) {
      const regions = ['emit', 'diff', 'apply'].map(k => ({ k, v: numField(line, k) }))
      for (const r of regions) {
        expect(r.v, `the ${r.k} region of "${line}" did not parse`).not.toBeNull()
        expect(r.v!, `the ${r.k} region ratio (${r.v}) must be inside the asserted 2.5× bound: "${line}"`).toBeLessThanOrEqual(2.5)
      }
      reported.push(regions.map(r => `${r.k}=${r.v}×`).join('/'))
    }
    console.log(`[frs-9d:pins] ${pins.length} pin line(s): ${reported.join(' | ')}`)
  })

  // ==========================================================================
  // FRS-9e — the per-level Δpass-2 series
  // ==========================================================================

  it('FRS-9e the per-level Δpass-2 series is present (runtime fork-stress d6..d12) and its last-two-level share is reported', () => {
    if (SKIP) { expect(smoke.reason).toBe(SKIP_REASON); return }
    const profiles = linesWith(RUNTIME_PROFILE_MARKER)
      .map(l => ({ line: l, depth: numField(l, 'depth'), pass2: numField(l, 'pass2'), nodes: numField(l, 'nodes') }))
      .filter(p => p.depth !== null && p.pass2 !== null)
    expect(
      profiles.length,
      `the runtime fork-stress per-level profile lines ('${RUNTIME_PROFILE_MARKER}') with a pass2= reading are ABSENT — the Δpass-2 table (§3 S4-a) cannot be produced`,
    ).toBeGreaterThan(0)
    const byDepth = [...profiles].sort((a, b) => a.depth! - b.depth!)
    for (const p of byDepth) {
      expect(p.pass2, `depth ${p.depth}: pass2 must parse to a finite number`).not.toBeNull()
      expect(p.pass2!, `depth ${p.depth}: pass2 must be ≥ 0`).toBeGreaterThanOrEqual(0)
      expect(p.nodes!, `depth ${p.depth}: the node census must be present`).toBeGreaterThan(0)
    }
    const lastTwo = byDepth.slice(-2)
    expect(lastTwo.length, 'at least two levels are needed for the last-two-level share').toBeGreaterThanOrEqual(2)
    const share = lastTwo.reduce((a, p) => a + p.pass2!, 0) / byDepth.reduce((a, p) => a + p.pass2!, 0)
    console.log(
      `[frs-9e:pass2-series] ${byDepth.map(p => `d${p.depth}=${p.pass2}ms`).join(' ')} | last-two-level share=${(share * 100).toFixed(1)}% (${lastTwo.map(p => `d${p.depth}`).join('/')}) — REPORTED, never asserted as a saving (§5 omissions row 1)`,
    )
  })

  // ==========================================================================
  // FRS-9f — the [compile] pass/visit census
  // ==========================================================================

  it('FRS-9f the [compile] pass census lines are present in the same run and are reported', () => {
    if (SKIP) { expect(smoke.reason).toBe(SKIP_REASON); return }
    const compileLines = linesWith(COMPILE_MARKER)
    expect(
      compileLines.length,
      `no '${COMPILE_MARKER}' line was printed — the §3 S4-b pass/visit census cannot be produced from this run`,
    ).toBeGreaterThan(0)
    const passSizes = compileLines.map(l => Number(/pass over (\d+) node\(s\)/.exec(l)?.[1] ?? NaN))
    expect(passSizes.every(n => Number.isFinite(n) && n > 0), 'every census line must carry a positive node count').toBe(true)
    const nodes = passSizes.reduce((a, n) => a + n, 0)
    console.log(
      `[frs-9f:compile-census] passes=${compileLines.length} node-visits=${nodes} (min pass=${Math.min(...passSizes)} max pass=${Math.max(...passSizes)}) — REPORTED, and expected ~UNCHANGED by this unit (§3 S4-b: the scan scoping removes work INSIDE the passes, not passes)`,
    )
  })

  // ==========================================================================
  // FRS-9g — the printed-precision comparison is FALSIFIABLE (offline)
  // ==========================================================================

  it('FRS-9g the printed-precision window ACCEPTS an honest envelope and REJECTS a fabricated, stale or relabelled ratio (offline, driven directly)', () => {
    // WHY THIS CASE EXISTS: re-pointing FRS-9a/9b's derived-value comparisons to
    // the printed precision (the flake fix) must not have turned them into
    // comparisons that can only pass. This case lifts the SHIPPED window code out
    // of this very file and drives it with FABRICATED values, so the re-point's
    // retained falsification is demonstrated, not asserted in prose — the
    // `assertRuntimeForkGrowth` / `assertForkStressCensus` extraction technique
    // used elsewhere in this suite and in `tests/unit/no-clone-guards.test.ts`.
    // FALSIFICATION: a window widened past the printed digits (a fabricated ratio
    // is then accepted), a window so tight it rejects the honest envelope (the
    // control arm), and a re-pointed comparison that lost its operand quotient
    // entirely (all three derived arms are driven, not just one).
    if (SKIP) { expect(smoke.reason).toBe(SKIP_REASON); return }
    const { assertPrintedDerivation: shippedAssert, parseGrowthEnvelope: shippedParse } = liftPrintedPrecisionBlock()
    const expectWithin: ExpectWithin = (actual, message) => ({
      toBeLessThanOrEqual: (bound) => { expect(actual, message).toBeLessThanOrEqual(bound) },
    })
    const drive = (
      printed: number, printedText: string, expected: number, expectedText: string,
      derivedFrom: ReadonlyArray<{ text: string; value: number; weight: number }>, message: string,
    ): number => shippedAssert(expectWithin, printed, printedText, expected, expectedText, derivedFrom, message)

    // (1) THE WINDOW IS DERIVED FROM THE PRINTED DIGITS (never a fixed constant):
    // a one-decimal print justifies ±0.05, a two-decimal print ±0.005 — which is
    // exactly why the pre-fix fixed ±0.005 comparison flipped on an on-boundary
    // quotient, and why the re-point cannot be satisfied by widening to 1.
    const line = linesWith(GROWTH_MARKER)[0]!
    const e = shippedParse(line)
    expect(e, 'the growth envelope must parse (FRS-9a)').not.toBeNull()
    const oneDpWindow = drive(6.2, '6.2', 6.193725490196079, 'the same line at one printed decimal', [], 'window derivation')
    expect(oneDpWindow, 'a one-decimal printed value must get a ±0.05 window (half a unit in its last printed place)').toBe(0.05)
    expect(oneDpWindow, 'the one-decimal window must ACCEPT an honest on-boundary quotient (the pre-fix fixed ±0.005 rejected exactly this pairing)').toBeGreaterThanOrEqual(0.05)
    const twoDp = { printed: e!.pass2Ratio, text: e!.text.pass2Ratio, q: e!.highPass2 / e!.lowPass2 }
    const twoDpWindow = drive(twoDp.printed, twoDp.text, twoDp.q, 'the live operands', [
      { text: e!.text.highPass2, value: e!.highPass2, weight: 1 },
      { text: e!.text.lowPass2, value: e!.lowPass2, weight: 1 },
    ], 'window derivation')
    expect(
      twoDpWindow,
      `the pass2-ratio's window must be the printed 2-decimal half-unit (±0.005) plus the operands' rounding, NOT a ±0.05 fudge — got ±${twoDpWindow}`,
    ).toBeLessThan(0.05)
    expect(twoDpWindow, 'the window must still be tight enough to falsify a fabricated ratio (far below the printed half-decade)').toBeLessThan(0.01)

    // (2) EVERY RE-POINTED ARM IS FALSIFIABLE. Each fabricated value is a real
    // failure mode: a literal, a stale number from another run/level, the wrong
    // labelled quantity, and a decorative margin that does not track its inputs.
    // The arms live in the module-level `fabricatedArms` helper so FRS-9h's teeth
    // check enumerates EXACTLY this list (no second copy to drift).
    const arms = fabricatedArms(e!)
    for (const a of arms) {
      expect(
        () => drive(a.fabricated, a.text, a.q, 'the printed operands', a.deriv, `FRS-9g ${a.arm}`),
        `the re-pointed ${a.arm} comparison ACCEPTED ${a.label} — the printed-precision window is too wide (the derivation property was gutted)`,
      ).toThrow()
    }
    // ... and the CONTROL arm: the same code ACCEPTS the live envelope's own
    // values, so the falsifier above is not "rejects everything".
    const controlArms: Array<[string, number, string, number, ReadonlyArray<{ text: string; value: number; weight: number }>]> = [
      ['pass2-ratio', e!.pass2Ratio, e!.text.pass2Ratio, twoDp.q, arms[0]!.deriv],
      ['total-ratio', e!.totalRatio, e!.text.totalRatio, e!.highTotal / e!.lowTotal, arms[2]!.deriv],
      ['per-node', e!.perNode, e!.text.perNode, e!.pass2Ratio / e!.nodeMultiple, arms[3]!.deriv],
      ['margin', e!.margin, e!.text.margin, e!.bound / e!.pass2Ratio, arms[4]!.deriv],
    ]
    for (const [arm, printed, text, q, deriv] of controlArms) {
      expect(
        () => drive(printed, text, q, 'the printed operands', deriv, `FRS-9g control ${arm}`),
        `the re-pointed ${arm} comparison REJECTED the live envelope's own values — the window is tighter than the printed precision (the flake would come back)`,
      ).not.toThrow()
    }

    // (3) AN ENVELOPE MISSING AN OPERAND IS A MISS (the same "never silently
    // tolerated" rule FRS-9a applies): the parser returns null, so no derived
    // comparison can be made on it at all — a partially printed envelope fails
    // FRS-9a rather than being compared against a fabricated quotient. NB every
    // `pass2=` occurrence is stripped: leaving one behind would let the low arm
    // anchor onto it (the reason the parser's own `\b` anchor is asserted below).
    expect(
      shippedParse(line.replace(/pass2=(-?\d+(?:\.\d+)?)ms/g, 'pass2=n/a')),
      'an envelope MISSING an operand still parsed — a partial envelope must be a miss, never silently tolerated',
    ).toBeNull()
    // ... and the DERIVED fields cannot silently substitute for that operand: an
    // envelope whose low arm is dropped still parses as its own single depth.
    const lowArmDropped = shippedParse(line.slice(0, line.indexOf('→')))
    expect(
      lowArmDropped,
      'an envelope with no HIGH arm parsed — a half envelope must be a miss',
    ).toBeNull()
    console.log(
      `[frs-9g:printed-precision] window 1dp=±${oneDpWindow} (accepts an on-boundary honest print) · live ${twoDp.text}→±${twoDpWindow.toFixed(6)} | fabricated/stale/relabelled/label-swapped rejected: ${arms.length} | live control accepted: 4 | partial envelope → null`,
    )
  })

  // ==========================================================================
  // FRS-9h — the printed-precision window is PROVABLY sufficient (swept)
  // ==========================================================================

  it('FRS-9h — the printed-precision window is PROVABLY sufficient (swept, offline)', () => {
    // WHY THIS CASE EXISTS — THE REGRESSION PIN FOR THE 2026-09-23 WEIGHT DEFECT.
    // FRS-9b's margin arm and FRS-9g's margin/per-node arms used to pass
    // `1 / divisor` as an operand `weight` ON TOP OF `|expected / op.value|`,
    // which is already the exact partial derivative of every quotient this file
    // compares. The result was a window 6× too small (margin) and 4× too small
    // (per-node) — TIGHTER THAN THE PRINTED PRECISION it exists to model — so
    // FRS-9b failed on roughly one run in ten, exactly when the true ratio's third
    // decimal pushed a correctly rounded print just past that too-small window.
    //
    // This case converts the epsilon from a HAND-TUNED CONSTANT into a MEASURED
    // BOUND: the SHIPPED window (lifted out of this file by the same FRS9-EXTRACT
    // lifter FRS-9g uses — never re-typed here) is swept over the plausible true
    // value of EVERY derived form this file compares, and the worst HONEST
    // rounding gap must fit inside it at EVERY step. Tighten the window back (the
    // defect) and this goes RED deterministically instead of intermittently in
    // FRS-9b; widen it into a fudge factor and the tightness assertions below go
    // RED (a window that no honest gap approaches is not a proof of anything).
    //
    // Forms A–C need NO smoke run — they are pure arithmetic on the shipped code,
    // so the pin runs even on a checkout without the demo artifacts. Only the
    // TEETH half (the last block) needs the live envelope, and it is skipped with
    // the same documented reason FRS-9a/9g are (a partial envelope already fails
    // FRS-9a, so that skip is never a hole in this case).
    const { assertPrintedDerivation: shippedAssert, printHalfUnit: shippedHalfUnit } = liftPrintedPrecisionBlock()
    const BOUND = RUNTIME_GROWTH_BOUND_MULTIPLE
    const liveEnvelope = SKIP ? null : parseGrowthEnvelope(linesWith(GROWTH_MARKER)[0] ?? '')
    /** The harness's node multiple, `2^(highDepth − lowDepth)` (FRS-9a pins the live
     *  value at 4). Taken from the live envelope when there is one, else derived. */
    const nodeMultiple = liveEnvelope?.nodeMultiple ?? 2 ** (12 - 10)
    /** A drive that computes (and returns) the shipped window WITHOUT throwing:
     *  used wherever this case needs the window's VALUE rather than a pass/fail —
     *  the sweep's own recording harness, the factor-free identity check, and the
     *  teeth magnitudes (a fabricated value legitimately throws in FRS-9g, which is
     *  why the teeth check weighs magnitudes instead of re-asserting rejection). */
    const silentExpectWithin: ExpectWithin = () => ({ toBeLessThanOrEqual: () => { /* window only */ } })

    // ---- form A: `margin = bound / pass2Ratio` (FRS-9b's arm and both margin arms
    //      of FRS-9g). The harness prints `margin = round2(bound / trueRatio)` and
    //      `pass2-ratio = round2(trueRatio)`, so the honest gap is
    //      `|round2(10/r) − 10/round2(r)|` — the form that was failing. -------------
    const marginSweep = makeWindowSweep('A margin = bound / ratio')
    for (let step = 40_000; step <= 120_000; step += 1) {
      const trueRatio = step / 10_000
      const ratioText = trueRatio.toFixed(2)
      const printedRatio = Number(ratioText)
      const marginText = (BOUND / trueRatio).toFixed(2)
      marginSweep.where(() => `true ratio ${trueRatio.toFixed(4)} (printed ${ratioText} → margin ${marginText})`)
      shippedAssert(
        marginSweep.expectWithin, Number(marginText), marginText, BOUND / printedRatio,
        `${BOUND} / ${ratioText}`, [{ text: ratioText, value: printedRatio, weight: 1 }],
        'FRS-9h form A: the printed margin must be the bound ÷ the printed ratio',
      )
    }

    // ---- form B: `per-node = pass2Ratio / nodeMultiple` (FRS-9a's third arm and
    //      FRS-9g's per-node arm): `round2(r / 4)` vs `round2(r) / 4`. -------------
    const perNodeSweep = makeWindowSweep('B per-node = ratio / nodeMultiple')
    for (let step = 40_000; step <= 120_000; step += 1) {
      const trueRatio = step / 10_000
      const ratioText = trueRatio.toFixed(2)
      const printedRatio = Number(ratioText)
      const perNodeText = (trueRatio / nodeMultiple).toFixed(2)
      perNodeSweep.where(() => `true ratio ${trueRatio.toFixed(4)} (printed ${ratioText} → per-node ${perNodeText})`)
      shippedAssert(
        perNodeSweep.expectWithin, Number(perNodeText), perNodeText, printedRatio / nodeMultiple,
        `${ratioText} / ${nodeMultiple}`, [{ text: ratioText, value: printedRatio, weight: 1 }],
        'FRS-9h form B: the printed per-node ratio must be the printed pass2-ratio ÷ the node multiple',
      )
    }

    // ---- form C: `pass2-ratio = highPass2 / lowPass2` (FRS-9a's first two arms and
    //      FRS-9g's two pass2-ratio arms): the operands are printed to ONE decimal
    //      and the ratio to two, so both operands contribute a half-unit term. The
    //      band is the runtime readings' plausible range (d10 pass2 ≈ 100-140ms,
    //      d12 pass2 ≈ 600-900ms); the base grid is 0.1ms, PLUS a sub-tenth phase
    //      per grid row so each operand carries a rounding residue — an
    //      aligned-tenths grid would make `toFixed(1)` exact, leaving this form's
    //      whole operand term untested and the sweep vacuous. -----------------------
    const ratioSweep = makeWindowSweep('C pass2-ratio = high / low')
    for (let hStep = 6_000; hStep <= 9_000; hStep += 1) {
      const high = hStep / 10 + (hStep % 10) * 0.00973
      const highText = high.toFixed(1)
      const printedHigh = Number(highText)
      for (let lStep = 1_000; lStep <= 1_400; lStep += 1) {
        const low = lStep / 10 + (lStep % 10) * 0.00931
        const lowText = low.toFixed(1)
        const printedLow = Number(lowText)
        const ratioText = (high / low).toFixed(2)
        ratioSweep.where(() => `high ${high.toFixed(4)} / low ${low.toFixed(4)} (printed ${highText} / ${lowText} → ${ratioText})`)
        shippedAssert(
          ratioSweep.expectWithin, Number(ratioText), ratioText, printedHigh / printedLow,
          `${highText} / ${lowText}`, [
            { text: highText, value: printedHigh, weight: 1 },
            { text: lowText, value: printedLow, weight: 1 },
          ],
          'FRS-9h form C: the printed pass2-ratio must be the quotient of the printed operands',
        )
      }
    }

    // ---- THE PROOF: no honest, correctly rounded print falls outside the window ---
    for (const stat of [marginSweep.stat, perNodeSweep.stat, ratioSweep.stat]) {
      expect(
        stat.violations.length,
        `${stat.label}: the shipped printed-precision window is INSUFFICIENT at ${stat.violations.length} of ${stat.comparisons} swept points — an HONEST, correctly rounded print falls outside it (this is the FRS-9b/FRS-9g flake, now deterministic). First violation: ${stat.violations[0]}`,
      ).toBe(0)
      expect(stat.comparisons, `${stat.label}: the sweep made no comparisons`).toBeGreaterThan(1_000)
      expect(stat.windowAtMaxGap, `${stat.label}: the window at the worst point must be a positive bound`).toBeGreaterThan(0)
    }

    // ---- ... AND NOT VACUOUS (the anti-widen half of the pin): at its worst point
    //      each form's honest gap comes CLOSE to the window, so the window can be
    //      neither tightened below the printed precision (that is the defect) nor
    //      widened into a fudge factor (these fractions would collapse). The values
    //      are pure arithmetic — they do not move run to run. --------------------
    const tightness: Array<[string, number, number]> = [
      [marginSweep.stat.label, marginSweep.stat.maxGapOverWindow, 0.9],
      [perNodeSweep.stat.label, perNodeSweep.stat.maxGapOverWindow, 0.7],
      [ratioSweep.stat.label, ratioSweep.stat.maxGapOverWindow, 0.5],
    ]
    for (const [label, fraction, floor] of tightness) {
      expect(
        fraction,
        `${label}: the worst honest gap reaches only ${(fraction * 100).toFixed(1)}% of the window — the window is at least ${(1 / fraction).toFixed(2)}× wider than the printed precision requires, i.e. a fudge factor rather than a derivation (the sweep would accept ANY printed value)`,
      ).toBeGreaterThan(floor)
      expect(fraction, `${label}: the gap can never exceed the window (asserted above); a fraction ≥ 1 is a measurement error`).toBeLessThan(1)
    }

    // ---- THE WINDOW IS THE EXACT-DERIVATIVE SUM, FACTOR-FREE. Sufficiency alone
    //      cannot see a weight factor that SHRINKS the operand term but still stays
    //      above the worst honest gap (the per-node `1 / nodeMultiple` error was
    //      exactly that: 4× too small, yet still wider than the printed half-unit,
    //      so it never actually failed a live run) — so the window is also checked
    //      against an INDEPENDENT recomputation of the claim it models: the printed
    //      value's own half-unit PLUS, per printed operand, that operand's half-unit
    //      times the absolute partial derivative `|expected / op.value|`, with NO
    //      factor. A reintroduced `weight` divisor disagrees by exactly that factor
    //      here, deterministically. The sampled points are the sweeps' own
    //      worst-case ratios (any point would do — the identity is algebraic, not
    //      data-dependent, so these do not re-tune anything). --------------------
    const exactWindow = (
      printedText: string, expected: number, ops: ReadonlyArray<{ text: string; value: number }>,
    ): number => ops.reduce(
      (sum, op) => sum + shippedHalfUnit(op.text) * Math.abs(expected / op.value),
      shippedHalfUnit(printedText),
    )
    const identityChecks: Array<{
      form: string
      printedText: string
      expected: number
      ops: ReadonlyArray<{ text: string; value: number }>
      deriv: ReadonlyArray<{ text: string; value: number; weight: number }>
    }> = [
      {
        form: 'A margin (true ratio 4.1751 → printed 4.18 / margin 2.40)',
        printedText: (BOUND / 4.1751).toFixed(2), expected: BOUND / 4.18,
        ops: [{ text: (4.1751).toFixed(2), value: Number((4.1751).toFixed(2)) }],
        deriv: [{ text: (4.1751).toFixed(2), value: Number((4.1751).toFixed(2)), weight: 1 }],
      },
      {
        form: 'B per-node (true ratio 8.0551 → printed 8.06 / per-node 2.01)',
        printedText: (8.0551 / nodeMultiple).toFixed(2), expected: Number((8.0551).toFixed(2)) / nodeMultiple,
        ops: [{ text: (8.0551).toFixed(2), value: Number((8.0551).toFixed(2)) }],
        deriv: [{ text: (8.0551).toFixed(2), value: Number((8.0551).toFixed(2)), weight: 1 }],
      },
      {
        form: 'C pass2-ratio (892.6584ms / 102.5465ms → printed 892.7 / 102.5)',
        printedText: (892.6584 / 102.5465).toFixed(2), expected: 892.7 / 102.5,
        ops: [{ text: '892.7', value: 892.7 }, { text: '102.5', value: 102.5 }],
        deriv: [{ text: '892.7', value: 892.7, weight: 1 }, { text: '102.5', value: 102.5, weight: 1 }],
      },
    ]
    for (const check of identityChecks) {
      const window = shippedAssert(
        silentExpectWithin, Number(check.printedText), check.printedText, check.expected,
        'the identity sample', check.deriv, `FRS-9h identity ${check.form}`,
      )
      const independent = exactWindow(check.printedText, check.expected, check.ops)
      expect(
        window,
        `form ${check.form}: the shipped window (${window.toFixed(6)}) is NOT the printed half-unit plus the exact-derivative sum (${independent.toFixed(6)}) — the ratio is ${(window / independent).toFixed(4)}, i.e. an extra factor on the operand term (the 2026-09-23 \`weight\` defect: \`1 / divisor\` shrinks that term by the divisor)`,
      ).toBeCloseTo(independent, 12)
    }

    // ---- ... AND NO CALL SITE REINTRODUCES A FACTOR. The sweeps and the identity
    //      check above pass the unit weight explicitly, i.e. they pin the SHIPPED
    //      FORMULA — not the call sites that feed it, and the defect was a
    //      CALL-SITE edit (the divisor passed as the operand weight). So every
    //      numeric weight expression in this file is read back and must be exactly
    //      `1`: the type annotations (`weight` of type number) carry no digit and
    //      are therefore not in scope, which is the point of anchoring the scan on
    //      a digit. This is the leg that goes RED on a re-introduced divisor even
    //      where the printed half-unit term masks it (per-node was masked). ------
    const weightExpressions = [...readThisFile().matchAll(/weight:\s*(\d[^,}\n]*)/g)].map(m => m[1]!.trim())
    expect(
      weightExpressions.length,
      `the weight scan found ${weightExpressions.length} numeric \`weight\` expression(s) — it has lost its target (a refactor renamed the field?), so the call-site half of this pin is blind`,
    ).toBeGreaterThan(10)
    const nonUnitWeights = weightExpressions.filter(w => Number(w) !== 1)
    expect(
      nonUnitWeights,
      `every operand weight must be the literal 1 — \`|expected / op.value|\` is ALREADY the exact partial derivative, so a divisor factor here shrinks the window below the printed precision (the 2026-09-23 flake). Found: [${nonUnitWeights.join(', ')}]`,
    ).toEqual([])
    console.log(
      `[frs-9h:weights] ${weightExpressions.length} call-site weight expression(s) scanned, all 1 (no divisor factor)`,
    )

    console.log(
      `[frs-9h:window] margin max gap ${marginSweep.stat.maxGap.toFixed(6)} at ${marginSweep.stat.maxGapAt} | window there ${marginSweep.stat.windowAtMaxGap.toFixed(6)} | worst gap/window ${marginSweep.stat.maxGapOverWindow.toFixed(4)} over ${marginSweep.stat.comparisons} steps`,
    )
    console.log(
      `[frs-9h:window] per-node max gap ${perNodeSweep.stat.maxGap.toFixed(6)} at ${perNodeSweep.stat.maxGapAt} | window there ${perNodeSweep.stat.windowAtMaxGap.toFixed(6)} | worst gap/window ${perNodeSweep.stat.maxGapOverWindow.toFixed(4)} over ${perNodeSweep.stat.comparisons} steps`,
    )
    console.log(
      `[frs-9h:window] pass2-ratio max gap ${ratioSweep.stat.maxGap.toFixed(6)} at ${ratioSweep.stat.maxGapAt} | window there ${ratioSweep.stat.windowAtMaxGap.toFixed(6)} | worst gap/window ${ratioSweep.stat.maxGapOverWindow.toFixed(4)} over ${ratioSweep.stat.comparisons} steps`,
    )

    // ---- THE FALSIFIABILITY WAS NOT WEAKENED. The corrected window IS wider than
    //      the broken one, so this case must show it did not grow anywhere NEAR a
    //      fabricated value's distance from the honest value. EVERY FRS-9g arm is
    //      enumerated through the shared `fabricatedArms` helper (so this list
    //      cannot drift from that case's), and each gap must exceed the window at
    //      that point by at least 10×. A window that ever grows to within 10× of a
    //      fabricated gap fails HERE instead of silently passing FRS-9g. ---------
    const TEETH_MULTIPLE = 10
    if (SKIP) {
      console.warn(`[frs-9h:teeth] SKIPPED with the live arm — ${smoke.reason} (FRS-9g is skipped for the same reason, so there is no fabricated-arm list to weigh; forms A–C above still ran)`);
      return
    }
    expect(
      liveEnvelope,
      'the live growth envelope must parse for the teeth check — without it there is no arm list to weigh (a partial envelope is FRS-9a\'s miss, never silently tolerated)',
    ).not.toBeNull()
    const teeth: Array<{ arm: string; gap: number; window: number; ratio: number }> = []
    for (const a of fabricatedArms(liveEnvelope!)) {
      // The window at THIS arm's point, from the shipped code (the silent drive
      // returns the window without throwing — a fabricated value legitimately
      // throws in FRS-9g, which is why the teeth check weighs magnitudes instead).
      const window = shippedAssert(
        silentExpectWithin, a.fabricated, a.text, a.q, 'the printed operands', a.deriv,
        `FRS-9h teeth ${a.arm}`,
      )
      const gap = Math.abs(a.fabricated - a.q)
      const ratio = gap / window
      teeth.push({ arm: a.arm, gap, window, ratio })
      expect(
        ratio,
        `the printed-precision window is no longer falsifiable against ${a.label}: its distance from the honest value (${gap.toFixed(6)}) is only ${ratio.toFixed(2)}× the window at that point (${window.toFixed(6)}) — the window grew toward a FABRICATED value and must stay ≥ ${TEETH_MULTIPLE}× below it`,
      ).toBeGreaterThanOrEqual(TEETH_MULTIPLE)
    }
    console.log(
      `[frs-9h:teeth] ${teeth.map(t => `arm=${t.arm} gap=${t.gap.toFixed(6)} window=${t.window.toFixed(6)} gap/window=${t.ratio.toFixed(1)}`).join(' | ')}`,
    )
    const weakest = teeth.reduce((a, b) => (b.ratio < a.ratio ? b : a))
    console.log(
      `[frs-9h:teeth] weakest arm ${weakest.arm} at ${weakest.ratio.toFixed(1)}× the window (floor ${TEETH_MULTIPLE}×, so ${(weakest.ratio / TEETH_MULTIPLE).toFixed(1)}× headroom)`,
    )
  })
})
