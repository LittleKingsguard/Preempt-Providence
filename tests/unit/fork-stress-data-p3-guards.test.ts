/**
 * FORK-STRESS-DATA-P3 — THE HARNESS-HALF GUARDS (spec §8.2 + §5 `P-SM-2`).
 *
 * ── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 * The conversion changes NUMBERS the harness currently pins. `scripts/
 * demo-smoke.mjs`'s `assertForkStressCensus` still derives this family's
 * expectations from the CLONE model:
 *   · `expectedInTree  = 2 ** depth - 1 + prototypes`  (4117 at d12)
 *   · `topologyCloneOps = 2 ** depth - 2`               (4094 at d12)
 * and it treats a profile WITHOUT a published `journalCloneOps` token as an
 * acceptable fallback ("a PROFILE THAT OMITS it is NOT silently exempt" — it
 * then decides alone). After the conversion both expectations must be `2·depth
 * − 1` / `0`, and a missing measurement token must FAIL loudly (the "baseline
 * absent must FAIL" rule). This file drives the LIVE guard (sliced out of the
 * harness by source, the NC-2d extraction pattern) with FABRICATED profiles so
 * each of those clauses is checkable in isolation, and it checks the census-LINE
 * CONTENT the converted family must publish for the pin to be checkable at all
 * (§8.2 row 4).
 *
 * ── EXPECTED STATUS — `HELD` AFTER THE 2026-09-22 CONVERSION ───────────────
 * **historical note:** this file's row reported `EXPECTED-RED` before the
 * conversion, because the guard still encoded the clone model's expectations.
 * The conversion re-expresses the guard, and this file's row then reaches
 * `HELD` **by the conversion, never by weakening a clause** (§7 AC-10):
 *   · the CONVERTED profile (23/23/0/0/0, states/elements 4095, passes 1) is
 *     ACCEPTED — arm (i) goes green;
 *   · the OLD-MODEL profiles (`cloneOps = 4094`, `inTree = 4117`) are REJECTED
 *     with a message naming the drift — arms (ii)/(iii) go green, and these
 *     rejections ARE the row's constructed liveness (§5 `P-SM-2`: "the negative
 *     arms are the liveness proof; an all-accepting guard reports
 *     UNDETERMINED"). The liveness line therefore names the rejected
 *     fabrications, so a HELD row is never backed by nothing;
 *   · the MISSING-MEASUREMENT-TOKEN arm fails loudly (the fallback branch is
 *     re-expressed into a failure) — arm (iv) goes green;
 *   · the drift arms stay green (the anti-alias clause is unchanged), and the
 *     converted profile's own arms keep their non-emptiness/liveness clauses.
 * Every one of those is asserted BELOW as REQUIRED behaviour: a guard that
 * accepts an old-model profile, or rejects the converted one, FAILS this file.
 * **What the conversion must NOT move:** the two pre-conversion green arms
 * (the drift arm and the `registered = inTree + unplaced + destroyed` identity)
 * — they stay green (§5's "the conversion must not move what already holds").
 *
 * ── THE 10 MUST-CHANGE SITES (§8.2) — what this file covers ────────────────
 *   row 1  `assertForkStressCensus`'s re-derivation ......... P-SM-2 (this file)
 *   row 2  the `fork-stress-census` guard id/page set ....... NOT covered here:
 *          it needs a smoke run (its own guard id and depth sweep are the smoke's
 *          business; `tests/unit/no-clone-guards.test.ts` drives the live smoke)
 *   row 3  `fork-stress-variant-census` + the 2.5× totals pin  NOT covered here
 *          (smoke-run; the bound is untouched by this unit — §2.2 row 5)
 *   row 4  the profile-LINE content .......................... "the census line"
 *          case below (the tokens the guard must be able to read)
 *   rows 5-10 (the test-level fixtures/couplings in
 *          `no-clone-guards.test.ts`, `no-clone-invariants.test.ts` and
 *          `tests/e2e/path-fork-e2e.test.ts`) — THOSE FILES OWN THEM: they are
 *          existing suites whose assertions the landing pass re-points in the
 *          same pass it converts the page (spec §8.3 duty 4). A new file must
 *          not silently duplicate them (AGENTS.md item 6: one contract, one
 *          home); this file adds the cases that make the GUARD's own
 *          re-expression verifiable without a smoke run.
 *
 * ── NO SMOKE IS SPAWNED ────────────────────────────────────────────────────
 * This file reads the harness SOURCE and drives the extracted guard function
 * in-process — it never spawns `scripts/demo-smoke.mjs` nor a page worker.
 * **It therefore does NOT belong in `SMOKE_SPAWNING_TEST_FILES`** and runs in
 * the parallel unit phase (`vitest.config.ts`), exactly like the NC-2c/NC-2d
 * checkers in `tests/unit/no-clone-guards.test.ts` before the H8 split.
 *
 * ── FALSIFICATION EVIDENCE (one line per clause) ───────────────────────────
 *   arm (i)   a guard that still encodes the clone model ⇒ the converted profile
 *             is rejected (the pre-conversion behaviour). A re-expressed guard
 *             ACCEPTS it, and this case asserts that.
 *   arms (ii)/(iii)  an UNCONVERTED guard accepts a fabricated old-model profile
 *             (cloneOps = 4094 / inTree = 4117) ⇒ the pin cannot catch a
 *             regression. A re-expressed guard REJECTS both with a message
 *             naming the drift — and those rejections are the row's liveness.
 *   arm (iv)  a profile omitting `cloneOps`/`journalCloneOps` must FAIL: today
 *             the `journalCloneOps`-less profile is ACCEPTED through the
 *             fallback branch, so a page that stops publishing its measurement
 *             is silently pin-less; a re-expressed guard makes both omissions
 *             loud failures.
 *   arm (v)   a profile whose `cloneOps ≠ journalCloneOps` is rejected on both
 *             models (this arm is green today and must stay green — the
 *             conversion must not move what already holds).
 *   census line  a converted line that still carries `pass2=`/`handlers=`/
 *             `handlerMs=`/`flush=`/`work:` (the clone-model-only fields) fails
 *             the content clause; a line missing `cloneOpKinds`/`journal` fails
 *             the token clause.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')
const SMOKE_PATH = join(REPO, 'scripts', 'demo-smoke.mjs')

function readSmoke() {
  return readFileSync(SMOKE_PATH, 'utf8')
}

/** Extract `assertForkStressCensus` from the harness and bind it to stubs so it
 *  can be driven with a FABRICATED profile (the NC-2d pattern at
 *  `tests/unit/no-clone-guards.test.ts:485-513`). Returns the collected
 *  console.error / console.log messages and the function's return value, so a
 *  clause can assert BOTH the verdict and its MESSAGE. */
/** A fabricated census profile (the shape `assertForkStressCensus` reads). */
interface GuardProfile {
  depth?: number
  registered?: number
  inTree?: number
  unplaced?: number
  destroyed?: number
  cloneOps?: number
  journalCloneOps?: number
  cloneOpKinds?: Record<string, number>
  journal?: number
  states?: number
  elements?: number
  passes?: number
}

interface GuardDrive {
  verdict: unknown
  errors: string[]
  logs: string[]
  messages: string
  threw: string | null
  /** True when the guard REJECTED the profile (a `false` verdict or a throw). */
  rejected: boolean
}

function driveCensusGuard(prof: GuardProfile, depth: number, label: string): GuardDrive {
  const src = readSmoke()
  const start = src.indexOf('function assertForkStressCensus(')
  expect(start, 'assertForkStressCensus is no longer defined in scripts/demo-smoke.mjs — the guard id/symbol this file drives was renamed or removed (§8.2 row 1 keeps the id; the SYMBOL may be renamed, in which case this file must be re-pointed in the same pass)').toBeGreaterThan(-1)
  const end = src.indexOf('\n}', start)
  const fnSrc = src.slice(start, end + 2)
  const errors: string[] = []
  const logs: string[] = []
  const stubConsole = {
    error: (m: unknown) => { errors.push(String(m)) },
    log: (m: unknown) => { logs.push(String(m)) },
    warn: () => {},
  }
  const stubProcess = { exit: () => { errors.push('__EXIT__') } }
  const fn = new Function('console', 'process', `${fnSrc}\nreturn assertForkStressCensus`)(stubConsole, stubProcess)
  let verdict: unknown
  let threw: string | null = null
  try {
    verdict = fn(prof, depth, label)
  } catch (e) {
    threw = `threw: ${(e as Error)?.message ?? e}`
  }
  return {
    verdict,
    errors,
    logs,
    messages: [...errors, ...logs].join(' | '),
    threw,
    rejected: verdict === false || threw !== null,
  }
}

/** A CONVERTED-family profile at `depth` (the target census, plus the published
 *  measurement tokens the converted line must carry — §8.2 rows 1 and 4). */
function convertedProfile(depth: number, extra: GuardProfile = {}): GuardProfile {
  return {
    depth,
    registered: 2 * depth - 1,
    inTree: 2 * depth - 1,
    unplaced: 0,
    destroyed: 0,
    cloneOps: 0,
    journalCloneOps: 0,
    cloneOpKinds: { 'clone-instance': 0 },
    journal: 0,
    states: 2 ** depth - 1,
    elements: 2 ** depth - 1,
    passes: 1,
    ...extra,
  }
}

/** The fabricated OLD-MODEL (clone) profile the harness pinned until this unit:
 *  `docs/specs/fork-stress-data-p3.md` §5 `P-SM-2` arms (ii)/(iii) and §8.2
 *  rows 1/6 — measured 2026-09-22 (`registered=4117 inTree=4117 cloneOps=4094`
 *  with `journalCloneOps=4094`). */
function oldModelProfile(depth: number, extra: GuardProfile = {}): GuardProfile {
  const prototypes = 2 * (depth - 1)
  const inTree = 2 ** depth - 1 + prototypes
  const clones = 2 ** depth - 2
  return {
    depth,
    registered: inTree,
    inTree,
    unplaced: 0,
    destroyed: 0,
    cloneOps: clones,
    journalCloneOps: clones,
    cloneOpKinds: { 'clone-instance': clones, 'state-slice': 2 ** depth - 1 },
    journal: clones + 2 ** depth - 1,
    // the drift arm overrides ONE field (the spread is last so an override wins)
    ...extra,
  }
}

// ===========================================================================
// P-SM-2 — THE REGISTER ROW (harness half)
// ===========================================================================
const P_SM_2_ID = 'P-SM-2'
const P_SM_2_STRATEGY = 'harness-pin:fabricated(converted MUST PASS; old-model MUST FAIL; missing-token MUST FAIL; drift MUST FAIL)'

/** The four-value report vocabulary; the line is emitted BEFORE the assertions. */
interface RegisterRowReport {
  seed: number
  id: string
  strategy: string
  status: 'HELD' | 'BROKEN' | 'EXPECTED-RED' | 'UNDETERMINED'
  attempts: number
  failures: number
  liveness: string
  counterexample: string
}
const rowReports: RegisterRowReport[] = []
function reportRow(row: RegisterRowReport) {
  process.stdout.write(`[fork-stress-data-p3:register] seed=${row.seed} row=${row.id} strategy=${row.strategy} status=${row.status} attempts=${row.attempts} failures=${row.failures} liveness=${row.liveness} counterexample=${row.counterexample}\n`)
  rowReports.push(row)
  return row
}

/** One driven arm of the `P-SM-2` case (its `expected` verdict and what the
 *  guard actually did). */
interface Sm2Arm {
  name: string
  expected: 'accept' | 'reject'
  actual: string
  ok: boolean
  message?: string
}

/** THE ROW's REPORT DERIVATION (§8.4 + the §5 `P-SM-2` liveness rule), lifted
 *  to module scope so the POST-conversion reporting discipline is verifiable on
 *  its own (the `P-SM-2 reporting` case below): a row may report `HELD` only
 *  when every arm landed (zero failures), and its liveness is CONSTRUCTED only
 *  when EVERY fabricated profile was REJECTED — the negative arms ARE the
 *  liveness proof, so ONE accepted negative means the guard still encodes that
 *  profile's model and the liveness reads UNCONSTRUCTED (the counterexample then
 *  names the accepted negative first). Post-conversion the line names the
 *  rejected fabrications, so a `HELD` row is never backed by nothing. */
function deriveSm2Report(arms: Sm2Arm[]): RegisterRowReport {
  const all = [...arms]
  const failures = all.filter((a) => !a.ok)
  const acceptedNegatives = failures.filter((a) => a.expected === 'reject')
  const rejectedNegatives = all.filter((a) => a.expected === 'reject' && a.ok)
  const negatives = all.filter((a) => a.expected === 'reject')
  const status: RegisterRowReport['status'] = failures.length === 0 ? 'HELD' : 'EXPECTED-RED'
  const first = acceptedNegatives[0] ?? failures[0]
  return {
    seed: 20260922,
    id: P_SM_2_ID,
    strategy: P_SM_2_STRATEGY,
    status,
    attempts: all.length,
    failures: failures.length,
    // CONSTRUCTED liveness: §5 `P-SM-2` states the negative arms ARE the
    // liveness proof, so the liveness is live only when EVERY negative arm was
    // REJECTED (`rejected === negatives`) — ONE accepted fabricated profile
    // means the guard still encodes that profile's model, i.e. the pin cannot
    // catch that regression, so the liveness is UNCONSTRUCTED and said so (the
    // row then cannot claim HELD). Post-conversion every fabricated
    // old-model / missing-token / drift profile is rejected, so the line names
    // the rejected negatives — a HELD row is backed by its live falsifiers,
    // never by nothing; pre-conversion the line names the ACCEPTED one(s).
    liveness: rejectedNegatives.length === negatives.length && negatives.length > 0
      ? `fabricated-old-model-rejected=${rejectedNegatives.length}/${negatives.length} (${rejectedNegatives.map((a) => `${a.name}=${a.actual}`).join(' ') || 'none'} — the guard no longer encodes the clone model; the negative arms are the live falsifiers)`
      : `none — the guard still ACCEPTS the fabricated old-model profile(s): ` +
        `${(acceptedNegatives.length > 0 ? acceptedNegatives : negatives).map((a) => `${a.name}=${a.actual}`).join(' ')} ` +
        `(fabricated profiles rejected: ${rejectedNegatives.length}/${negatives.length} — an unrejected fabrication leaves the liveness UNCONSTRUCTED, so the row can never report HELD)`,
    // the counterexample must name a COUNTEREXAMPLE: a wrongly ACCEPTED negative
    // (the liveness-breaking failure) is named before any other failure; a HELD
    // row reports `none`.
    counterexample: first ? `${first.name}: expected ${first.expected}, got ${first.actual}` : 'none',
  }
}

describe(`P-SM-2 the harness pins the CONVERTED family (strategy ${P_SM_2_STRATEGY})`, () => {
  it('P-SM-2 reports HELD after the conversion: the guard REJECTS the fabricated old-model profiles (its live negative arms) and ACCEPTS the converted profile', () => {
    // ── THIS CASE'S OWN PRECONDITION (stated explicitly so it cannot be read as
    // a contradiction — the pre-conversion form of this expectation WAS one):
    // the guard re-expressed for the CONVERTED family must (a) ACCEPT the
    // converted profile (arm (i)) and (b) REJECT every fabricated old-model /
    // missing-token / drifting profile. (b) is not decoration — it is the row's
    // LIVENESS: §5 `P-SM-2` states the negative arms are the liveness proof, so
    // a row may report `HELD` only when at least one fabricated profile was
    // REJECTED with its message recorded, and an all-accepting guard reports
    // UNDETERMINED. Before the 2026-09-22 conversion the guard still encoded the
    // clone model, so arms (ii)/(iii) were *accepted* and the row reported
    // EXPECTED-RED with liveness `none — the guard still ACCEPTS …`; the
    // conversion makes all seven arms land, `failures === 0` ⇒ HELD backed by
    // the REJECTED negatives (never by nothing).
    // FALSIFICATION (what a violation produces):
    //  · a guard that still ACCEPTS the old-model profile (cloneOps=4094 at d12)
    //    — the clone pin cannot catch a regression (then liveness reads `none`);
    //  · a guard that REJECTS the converted profile (23/4095/0/0) — the
    //    conversion would be reported as a failure;
    //  · a guard that ACCEPTS a profile with no measurement token — the
    //    fallback branch: a page that stops publishing cannot be pinned.
    const depth = 12
    interface ArmResult {
      name: string
      expected: 'accept' | 'reject'
      actual: string
      ok: boolean
      message?: string
    }
    const arms = new Map<string, ArmResult>()
    const push = (name: string, expected: 'accept' | 'reject', drive: GuardDrive) => {
      const accepted = drive.verdict === true && drive.threw === null
      arms.set(name, {
        name,
        expected,
        actual: accepted ? 'accept' : `reject${drive.messages ? ` (${drive.messages})` : ''}`,
        ok: expected === 'accept' ? accepted : !accepted,
        message: drive.messages,
      })
    }

    // the reference profiles (explicitly typed so the arms' arithmetic is checked)
    const conv: GuardProfile = convertedProfile(depth)
    const old: GuardProfile = oldModelProfile(depth)

    // ---- arm (i): the CONVERTED profile MUST PASS --------------------------
    push('converted-must-pass', 'accept', driveCensusGuard(conv, depth, 'fabricated-converted-d12'))

    // ---- arm (ii): cloneOps = 4094 (the old clone model) MUST FAIL ---------
    push('old-model-cloneOps-4094-must-fail', 'reject', driveCensusGuard(old, depth, 'fabricated-old-model-d12'))

    // ---- arm (iii): registered = inTree = 4117 (the old in-tree expression)
    // MUST FAIL --------------------------------------------------------------
    const oldInTreeValue = 2 ** depth - 1 + 2 * (depth - 1)
    push(
      'old-model-inTree-4117-must-fail',
      'reject',
      driveCensusGuard(convertedProfile(depth, { registered: oldInTreeValue, inTree: oldInTreeValue }), depth, 'fabricated-old-in-tree-d12'),
    )

    // ---- arm (iv): a MISSING measurement token MUST FAIL -------------------
    // (built by explicit omission, not `delete` — the profile keys are typed)
    const { journalCloneOps: _droppedJournal, ...noJournal } = conv
    void _droppedJournal
    const { cloneOps: _droppedCloneOps, ...noCloneOps } = conv
    void _droppedCloneOps
    push('missing-journalCloneOps-must-fail', 'reject', driveCensusGuard(noJournal, depth, 'fabricated-missing-journalCloneOps'))
    push('missing-cloneOps-must-fail', 'reject', driveCensusGuard(noCloneOps, depth, 'fabricated-missing-cloneOps'))

    // ---- arm (v): a census whose two published sources DISAGREE MUST FAIL --
    // (green before AND after the conversion — it must STAY green: this is the
    // anti-alias clause)
    push('drift-must-fail', 'reject', driveCensusGuard(convertedProfile(depth, { cloneOps: 0, journalCloneOps: 3 }), depth, 'fabricated-drift'))
    push('old-model-drift-must-fail', 'reject', driveCensusGuard(oldModelProfile(depth, { cloneOps: 4093 }), depth, 'fabricated-old-drift'))

    // ---- the row's status + report (BEFORE the assertions) ----------------
    reportRow(deriveSm2Report([...arms.values()]))

    // ---- ASSERTIONS (after the report) ------------------------------------
    // (1) the converted profile MUST be accepted
    const armConverted = arms.get('converted-must-pass')!
    expect(
      armConverted.ok,
      `P-SM-2 arm (i): the guard REJECTED the converted profile (registered=${conv.registered} inTree=${conv.inTree} cloneOps=0) — the guard still derives the CLONE model's expectations (${armConverted.actual})`,
    ).toBe(true)
    // (2)/(3) the fabricated OLD-MODEL profiles MUST be rejected, WITH a message
    for (const name of ['old-model-cloneOps-4094-must-fail', 'old-model-inTree-4117-must-fail']) {
      const arm = arms.get(name)!
      expect(arm.ok, `P-SM-2 ${name}: the guard ACCEPTED a fabricated old-model profile (${arm.actual}) — the clone pin cannot catch a regression (§8.2 row 1)`).toBe(true)
      expect(arm.message, `P-SM-2 ${name}: the rejection carried no message`).toBeTruthy()
    }
    // (4) a MISSING measurement token MUST fail loudly
    const armMissingToken = arms.get('missing-journalCloneOps-must-fail')!
    expect(armMissingToken.ok, `P-SM-2 missing-journalCloneOps: a profile omitting the token was ACCEPTED (${armMissingToken.actual}) — a page that stops publishing its measurement would be pin-less`).toBe(true)
    const armMissingField = arms.get('missing-cloneOps-must-fail')!
    expect(armMissingField.ok, 'P-SM-2 missing-cloneOps: a profile omitting the census field was ACCEPTED').toBe(true)
    // (5) the drift arms were GREEN before the conversion and must STAY green
    // (the conversion must not move what already holds — §5)
    const armDrift = arms.get('drift-must-fail')!
    expect(armDrift.ok, 'P-SM-2 drift arm: a census whose two published sources disagree was ACCEPTED — the anti-alias clause is dead').toBe(true)
    const armOldDrift = arms.get('old-model-drift-must-fail')!
    expect(armOldDrift.ok, 'P-SM-2 old-model drift arm').toBe(true)
    // (6) the row reported, and after the conversion it reports HELD — backed by
    // the negative arms (liveness), with no counterexample and no failure.
    expect(rowReports.length, 'P-SM-2 did not report its §8.4 line').toBe(1)
    const reported = rowReports[0]!
    expect(['HELD', 'BROKEN', 'EXPECTED-RED', 'UNDETERMINED']).toContain(reported.status)
    expect(reported.status, 'P-SM-2: the guard rejects the fabricated old-model profiles AND accepts the converted one, so all seven arms land and the row derives HELD (liveness comes from the live negative arms — an accepted negative or a rejected converted profile must move it off HELD)').toBe('HELD')
    expect(reported.failures, 'P-SM-2: a HELD row reports zero failures (§8.4)').toBe(0)
    expect(reported.liveness, 'P-SM-2 must report its liveness (row-scoped) — and post-conversion that liveness must be CONSTRUCTED from the rejected negative arms, not "none"').toBeTruthy()
    expect(reported.liveness, 'P-SM-2 post-conversion liveness must name the rejected fabricated profiles (a HELD row backed by nothing is the pre-conversion reporting defect)').toContain('fabricated-old-model-rejected=')
    expect(reported.liveness, 'P-SM-2 post-conversion liveness must not report the UNCONSTRUCTED form').not.toContain('none — the guard still ACCEPTS')
    expect(reported.counterexample, 'P-SM-2 must report a counterexample (none is the correct value on a HELD row; the field must be reported)').toBeTruthy()
  })

  it('P-SM-2 reporting (post-conversion, guard-independent): HELD is derived with the REJECTED negative arms as its liveness, a HELD row never carries an accepted negative, and a failing row names a counterexample', () => {
    // WHY THIS CASE EXISTS: the case above is coupled to the guard's ACTUAL
    // behaviour, so pre-conversion (guard still clone-model-encoded) its FIRST
    // failing assertion is arm (i) and the reporting clauses behind it never
    // execute. This case drives the SAME derivation function with synthetic arm
    // sets, so the §8.4 reporting discipline is green NOW and stays green after
    // the conversion — the post-conversion form of the P-SM-2 contract is
    // verifiable independently of when the guard lands.
    const arm = (name: string, expected: 'accept' | 'reject', ok: boolean): Sm2Arm =>
      ({ name, expected, ok, actual: ok ? (expected === 'accept' ? 'accept' : 'reject (the fabrication was refused)') : (expected === 'accept' ? 'reject (the guard still derives the clone model)' : 'accept') })

    // (a) THE POST-CONVERSION SET: every arm lands ⇒ HELD, liveness = ALL SIX
    // REJECTED negative arms (the two old-model profiles, the two missing-token
    // profiles, the two drift profiles — the converted profile is the only
    // accepting arm, and it is not a negative).
    const post = deriveSm2Report([
      arm('converted-must-pass', 'accept', true),
      arm('old-model-cloneOps-4094-must-fail', 'reject', true),
      arm('old-model-inTree-4117-must-fail', 'reject', true),
      arm('missing-journalCloneOps-must-fail', 'reject', true),
      arm('missing-cloneOps-must-fail', 'reject', true),
      arm('drift-must-fail', 'reject', true),
      arm('old-model-drift-must-fail', 'reject', true),
    ])
    expect(post.status, 'a row whose arms all landed derives HELD').toBe('HELD')
    expect(post.failures).toBe(0)
    expect(post.liveness, 'the liveness names the rejected fabrications — a HELD row is backed by live negative arms, never by nothing').toContain('fabricated-old-model-rejected=6/6')
    expect(post.liveness, 'the liveness must not report the UNCONSTRUCTED form').not.toContain('the guard still ACCEPTS')
    expect(post.counterexample, 'a HELD row carries no counterexample').toBe('none')
    expect(post.attempts, 'every arm is reported as an attempt').toBe(7)
    // the §8.4 vocabulary: HELD rows report zero failures (the register-budget
    // case in the sibling file asserts the same rule for the other four rows)
    expect(post.failures).toBe(0)

    // (b) THE PRE-CONVERSION SET (an accepted negative): the row CANNOT claim
    // HELD — it reports the failures, an UNCONSTRUCTED liveness naming the
    // accepted fabricated profile, and a counterexample that names it (this is
    // exactly what the executed report line shows today).
    const pre = deriveSm2Report([
      arm('converted-must-pass', 'accept', false),
      arm('old-model-cloneOps-4094-must-fail', 'reject', false),
      arm('old-model-inTree-4117-must-fail', 'reject', true),
      arm('missing-journalCloneOps-must-fail', 'reject', true),
      arm('missing-cloneOps-must-fail', 'reject', true),
      arm('drift-must-fail', 'reject', true),
      arm('old-model-drift-must-fail', 'reject', true),
    ])
    expect(pre.status, 'a row with a failed arm reports EXPECTED-RED, never HELD').toBe('EXPECTED-RED')
    expect(pre.failures, 'both failures are counted').toBe(2)
    expect(pre.liveness, 'an ACCEPTED negative leaves the liveness UNCONSTRUCTED — reported as such').toContain('none — the guard still ACCEPTS')
    expect(pre.liveness, 'the accepted negative is NAMED in the liveness line').toContain('old-model-cloneOps-4094-must-fail')
    expect(pre.counterexample, 'the counterexample names the liveness-breaking accepted negative, not any other failure').toContain('old-model-cloneOps-4094-must-fail')

    // (c) the anti-vacuity rule as an assertion: a HELD derivation whose liveness
    // is empty is impossible — if every negative arm were accepted there would be
    // failures (case (b) shape), so `HELD` + an UNCONSTRUCTED liveness cannot
    // coexist. A guard that rejected nothing reports EXPECTED-RED with liveness
    // `none — …`, never HELD.
    const allAccepted = deriveSm2Report([
      arm('converted-must-pass', 'accept', true),
      arm('old-model-cloneOps-4094-must-fail', 'reject', false),
      arm('old-model-inTree-4117-must-fail', 'reject', false),
    ])
    expect(allAccepted.status).toBe('EXPECTED-RED')
    expect(allAccepted.liveness).toContain('none — the guard still ACCEPTS')
    expect(allAccepted.counterexample, 'a failing row always names a counterexample').not.toBe('none')
  })

  it('P-SM-2 per-depth: the converted profile is accepted at EVERY swept depth and the fabricated old-model profile rejected', () => {
    // The smoke sweeps depths 2..12 (8,9,10,11 included) — a guard re-expressed
    // for d12 only would pass at one depth and fail the sweep. FALSIFICATION: an
    // off-by-one derivation (2^depth − 2 vs 2·depth − 1) is caught at each depth.
    const results = []
    for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
      const conv = driveCensusGuard(convertedProfile(depth), depth, `fabricated-converted-d${depth}`)
      const old = driveCensusGuard(oldModelProfile(depth), depth, `fabricated-old-d${depth}`)
      results.push({ depth, convertedAccepted: conv.verdict === true && conv.threw === null, oldAccepted: old.verdict === true && old.threw === null })
    }
    for (const r of results) {
      expect(r.convertedAccepted, `d${r.depth}: the CONVERTED fabrication was rejected — the guard's derivation does not match the converted topology`).toBe(true)
      expect(r.oldAccepted, `d${r.depth}: the OLD-MODEL fabrication was ACCEPTED — the guard still encodes the clone model at this depth`).toBe(false)
    }
  })
})

// ===========================================================================
// THE CENSUS-LINE CONTENT (§8.2 row 4)
// ===========================================================================
describe('the converted census line publishes the tokens the pin needs (§8.2 row 4)', () => {
  /** The `[fork-stress-data:profile] … census(…)` lines the converted family
   *  must print. Parsed from the family's page source so the requirement is
   *  checked against the LINE SHAPE the harness reads. */
  const PAGE_PATH = join(REPO, 'demo', 'fork-stress-data.js')

  it('the family\'s profile line carries registered/inTree/unplaced/destroyed/cloneOps + journalCloneOps + cloneOpKinds + journal + depth + method, and NO clone-model-only token', () => {
    // FALSIFICATION: a converted line that dropped `cloneOpKinds`/`journal`
    // (the two tokens §7 AC-7 requires) leaves the per-kind evidence unreadable;
    // a line that still prints `pass2=`/`handlerMs=`/`handlers=`/`flush=`/`work:`
    // is the UNCONVERTED mechanism's residue (spec §8.2 row 4: those five tokens
    // "disappear with the mechanism"), so a conversion that only re-pinned the
    // NUMBERS fails here.
    const src = readFileSync(PAGE_PATH, 'utf8')
    // the profile line is the template literal beginning `[fork-stress-data:profile]`
    const at = src.indexOf('[fork-stress-data:profile]')
    expect(at, 'the family publishes no [fork-stress-data:profile] line').toBeGreaterThan(-1)
    const lineSrc = src.slice(at, at + 2000)
    const requiredTokens = [
      'registered=', 'inTree=', 'unplaced=', 'destroyed=', 'cloneOps=',
      'journalCloneOps=', 'cloneOpKinds=', 'journal=', 'depth=', 'method=',
    ]
    const missing = requiredTokens.filter((t) => !lineSrc.includes(t))
    expect(missing, `the census line is missing the token(s) the pin reads: ${missing.join(', ')}`).toEqual([])
    const removedTokens = ['pass2=', 'handlerMs=', 'handlers=', 'flush=', 'work:']
    const surviving = removedTokens.filter((t) => lineSrc.includes(t))
    expect(
      surviving,
      `the census line still prints the clone-model-only token(s) ${surviving.join(', ')} — §8.2 row 4 requires them to disappear WITH the mechanism (the guard must be able to read the converted census without them)`,
    ).toEqual([])
  })

  it('the harness reads no clone-model-only token: the guard\'s source references none of pass2/handlerMs/handlers/flush/work', () => {
    const src = readSmoke()
    const start = src.indexOf('function assertForkStressCensus(')
    const guardSrc = src.slice(start, src.indexOf('\n}', start))
    for (const token of ['pass2', 'handlerMs', 'handlers', 'flush', 'work:']) {
      expect(guardSrc.includes(token), `assertForkStressCensus still reads "${token}" — a clone-model-only measurement token`).toBe(false)
    }
  })

  it('the guard still requires the topology identity registered === inTree + unplaced + destroyed (true on both models — it must survive the conversion)', () => {
    // §8.2 row 1: "the `registered === inTree + unplaced + destroyed` identity
    // KEPT (it is true either way)". FALSIFICATION: a guard that dropped it
    // would accept a census whose node bookkeeping does not add up.
    const src = readSmoke()
    const start = src.indexOf('function assertForkStressCensus(')
    const guardSrc = src.slice(start, src.indexOf('\n}', start))
    expect(
      /registered\s*!==\s*prof\.inTree\s*\+\s*prof\.unplaced\s*\+\s*prof\.destroyed/.test(guardSrc) ||
      /prof\.registered\s*!==\s*prof\.inTree\s*\+\s*prof\.unplaced\s*\+\s*prof\.destroyed/.test(guardSrc),
      'the registered = inTree + unplaced + destroyed identity is no longer asserted by the guard',
    ).toBe(true)
    // and it is a REAL clause: a fabricated profile that breaks the identity is
    // rejected (green before AND after the conversion — §8.2 row 1 requires the
    // identity to survive)
    const depth = 12
    const broken = driveCensusGuard(convertedProfile(depth, { registered: 2 * depth - 1 + 5 }), depth, 'fabricated-broken-identity')
    expect(broken.verdict === false || broken.threw !== null, 'a profile whose registered ≠ inTree + unplaced + destroyed was ACCEPTED').toBe(true)
  })
})
