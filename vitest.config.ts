import { defineConfig } from 'vitest/config'

/** THE PARALLEL (unit) PHASE of `npm test` — see `vitest.smoke.config.ts` for
 *  the SERIALISED second phase.
 *
 *  ── WHY THE SUITE IS SPLIT IN TWO PHASES (H8, closed 2026-09-23) ───────────
 *  `tests/unit/no-clone-guards.test.ts` spawns the ENTIRE demo smoke
 *  (`scripts/demo-smoke.mjs`) TWICE (the live arm + the `PP_SMOKE_FAULT` arm),
 *  and the smoke runs the heaviest work in the repository — the fork-stress page
 *  workers (d9-d12). While that file ran inside THIS parallel phase it competed
 *  with the other 77 test files for CPU, and its assertions are load-coupled:
 *  the pages' measured totals inflate **2.2-2.5×** under contention (measured
 *  on a 24-CPU host: the runtime d12 page's `total` **1625.9ms** idle-in-Vitest
 *  → **2954.6-3993.7ms** with 24 CPU burners; fork-stress-data d12
 *  **334-377ms** → the same band; **40,175ms** for the whole smoke phase in one
 *  loaded parallel run vs **17.3-18.6s** isolated), and at that inflation the
 *  harness's own profile-residual guard (15%/25ms) and its derived-region 2.5×
 *  pin are breached and surfaced through the smoke's aggregate exit — so
 *  `npm test` could fail in a file whose assertions are about GUARD
 *  REACHABILITY (NC-2a..NC-2d / P-SM-1) for reasons that have nothing to do
 *  with the invariant. The flake is a property of this unit's TEST DESIGN (the
 *  smoke was spawned from the parallel phase), not of the environment. The fix:
 *  the smoke-spawning file runs in its OWN phase that is SERIALISED
 *  (`vitest.smoke.config.ts` sets `fileParallelism: false`), so no other test
 *  file executes while it drives the smoke. `npm test` runs both phases in
 *  sequence — every assertion still runs and still fails the command (NO case
 *  is skipped, NO env gate, NO bound moved, NO window changed, and the
 *  enforcement therefore stays in CI, which runs plain `npm test`).
 *
 *  This phase EXCLUDES the smoke-spawning file; that file is included by
 *  `vitest.smoke.config.ts`. Both patterns are anchored on the ONE path so a
 *  future file that spawns the smoke must be added to the smoke phase as well
 *  (rule recorded in `docs/decisions.md` row `NO-CLONE-TEST-PHASE-ISOLATION`;
 *  evidence: `docs/defects.md` row `FLAKE-NOCLONE-SMOKE-IN-PARALLEL`). */
export const SMOKE_SPAWNING_TEST_FILES = [
  'tests/unit/no-clone-guards.test.ts',
  // FRS-B of the pass-2 fit-reference-scope unit (docs/specs/pass2-fit-reference-scope.md
  // §7.2) spawns the WHOLE demo smoke to read the §3 S4 measurement set:
  // registered here per this file's own rule so it runs only in the serialised
  // smoke-ops phase, never inside the parallel phase.
  'tests/unit/pass2-fit-reference-scope-measurement.test.ts',
]

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [...SMOKE_SPAWNING_TEST_FILES],
    environment: 'node',
    globals: false,
    testTimeout: 5000,
  },
})