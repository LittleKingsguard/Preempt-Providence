import { defineConfig } from 'vitest/config'

/** THE SERIALISED "SMOKE-OPS" PHASE of `npm test` — the smoke-spawning unit
 *  files, run with `fileParallelism: false` (see `vitest.config.ts` for the
 *  flake root cause: H8, 2026-09-22).
 *
 *  ── WHAT THIS PHASE GUARANTEES ────────────────────────────────────────────
 *  `tests/unit/no-clone-guards.test.ts` spawns the whole demo smoke twice; the
 *  smoke's fork-stress page workers (d9-d12) are the heaviest work in the
 *  repository, and their measured totals — plus the harness's own load-sensitive
 *  guards (the profile-residual 15%/25ms guard, the derived per-region 2.5×
 *  pin) — inflate 2.2-2.5× when other test files run concurrently (measured
 *  2026-09-23: d12 runtime page total 1625.9ms idle-in-Vitest → 2954.6-3993.7ms
 *  with 24 CPU burners; the whole smoke phase 40,175ms loaded-parallel vs
 *  17.3-18.6s isolated; records: `docs/decisions.md`
 *  NO-CLONE-TEST-PHASE-ISOLATION`, `docs/defects.md`
 *  FLAKE-NOCLONE-SMOKE-IN-PARALLEL`). `fileParallelism: false` makes
 *  Vitest run this phase's files ONE AT A TIME and, with a single file, spawn a
 *  single worker: no other test file competes with the smoke, so the smoke's
 *  measurements are taken on a quiet machine phase and a load-induced page miss
 *  no longer surfaces as a spurious failure of a GUARD-REACHABILITY assertion.
 *
 *  ── WHAT THIS PHASE DOES *NOT* CHANGE ─────────────────────────────────────
 *  Every case still runs (no `describe.skip`, no env gate — CI's plain
 *  `npm test` executes this phase, so the enforcement is still IN CI); every
 *  assertion, bound and wait window is unchanged. `testTimeout` is raised here
 *  only because the default 5000ms is meaningless for a case that drives the
 *  whole smoke (the per-case timeouts in the file are 900s; the harness's own
 *  `PAGE_WAIT_MS` is the file's business, not this config's).
 *
 *  RUN IT ALONE:  npx vitest run --config vitest.smoke.config.ts */
export default defineConfig({
  test: {
    name: 'smoke-ops',
    include: [
      'tests/unit/no-clone-guards.test.ts',
      // FRS-B of PASS2-FIT-REFERENCE-SCOPE (docs/specs/pass2-fit-reference-scope.md
      // §7.2) — the second smoke-spawning file, registered in
      // `SMOKE_SPAWNING_TEST_FILES` (vitest.config.ts) per its own rule.
      'tests/unit/pass2-fit-reference-scope-measurement.test.ts',
    ],
    environment: 'node',
    globals: false,
    // the two smoke-driving cases declare 900_000ms themselves; this is the
    // phase default for anything else that lands here later.
    testTimeout: 900_000,
    // THE POINT OF THIS PHASE: no other test file runs while the smoke does.
    fileParallelism: false,
  },
})
