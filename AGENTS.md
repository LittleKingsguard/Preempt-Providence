# Preempt-Providence — Agent Configuration

Context management guidelines for agents working in this repository:

1. **75% context threshold**: After passing 75% of available context, stop starting new work and switch to preparing handover documents and summaries so work can be continued by a fresh sub-agent call.

2. **50% task threshold**: If a given task is estimated to take over 50% of available context, do not attempt it inline. Instead, prepare per-step sub-agent instructions and delegate the steps, then wait for the sub-agents to continue.

## Documentation & validation requirements

3. **Keep the design skill current**: `docs/skills/designing-pages.md` is the
   canonical "how to design webpages with the framework" reference and the
   feature documentation index. After ANY feature or behavior change,
   update the relevant section AND the test-use-case coverage matrix
   (§11), and mention new demo pages in §12. Do not leave it stale.

4. **Validate after features/tests**: after any feature is added and/or new
   tests are written, run the suite and confirm green before finishing:

   ```
   npm test           # vitest — full suite
   npm run typecheck  # tsc --noEmit
   npm run demo:smoke # headless run of all demo checks
   ```

   Only report work as complete when all three pass (and `npm run build`
   emits cleanly for the full build).

   **Also watch the profile totals** the smoke prints
   (`[fork-stress-data:profile] … total=…ms`): the values/link-only d12
   totals must stay within ~1.5× of the placement d12 total. A blow-up (or
   `total − Σ(measured sections)` dominating the total) means the supervisor
   pass-2 pipeline is scaling badly — the page profiler does NOT time
   pass-2 (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md, fork-stress-data section).
   Flag any regression before reporting completion. (The smoke ASSERTS a
   looser 2.5× CI-safe bound, demo-smoke.mjs — the ~1.5× here is the human
   watch; the asserted guard is the tripwire that catches pipeline
   blow-ups.)
   **Path-fork family baseline (derived-fork-variants-review §5.2 — the
   §8-Q6 split):** the static fork-stress pages are a THREE-variant derived
   family (placement/values/link — placement-path-spec §8 Q6 / §10.ad,
   RE-SPLIT 2026-08-16): the placement-derived page's per-region totals
   (emit/diff/apply) are recorded by the smoke as `[derived-fork:baseline]`
   (the former `[path-fork:baseline]` single-total marker), and the
   values/link-derived pages pin each REGION within 2.5× of it
   (`[derived-fork:pin]`) — NOT totals, which are compile-enumeration-
   dominated (~2.8s baseline) and insensitive to EMIT-side blow-ups. The
   runtime fork-stress pages keep the ~1.5× method-ratio watch (totals,
   asserted 2.5×) + the 2× tripwire against the placement-derived total.

5. **Specs and decision records**: behavior contracts live in
   `docs/specs/*.md`; design decisions are recorded in
   `RENDER_PROCESS_NOTES.md` §10.10 as `DECIDED:` entries. Keep both in sync
   with implementation and with `docs/skills/designing-pages.md`.

6. **Document-archival loop**: the git-visible `docs/` tree is for ACTIVE
   development work and skill/feature documentation of the CURRENT engine
   state. After EACH significant feature change or test suite, run a cleanup
   pass: (a) merge the new/changed information into the core docs
   (`docs/specs/*.md`, `docs/skills/designing-pages.md`,
   `RENDER_PROCESS_NOTES.md` §10.10, and the condensed current-state
   trackers `docs/defects.md` + `docs/decisions.md`); (b) archive
   obsolete documentation, stale test data, findings reports, feedback
   reviews, and historical review records into the GITIGNORED `archive/`
   directory (`archive/<topic>/<date>-<name>.md` — see `archive/README.md`);
   (c) repoint or remove every reference to an archived file — never leave a
   citation pointing at a moved file; never archive a still-cited file
   without repointing it. The `archive/` dir is excluded from builds, tests,
   and the smoke.
   **Active trackers (maintained every pass):** `docs/defects.md` (the
   active defect list — open defects on top, fixed rows with their fix
   reference, superseded rows archived), `docs/decisions.md` (the active
   decisions summary — ACTIVE/SUPERSEDED status, pinned contracts with their
   sources), `docs/pending.md` (parked decisions with their revisit
   conditions, pending decisions awaiting the user gate, not-yet-implemented
   features, and speculative proposals with their recorded constraints), and
   `docs/next-steps.md` (the work queue: when a defect arises with a CLEAR
   and DISTINCT fix shape — no user approval needed for a design choice —
   bookmark the OTHER current findings in `docs/next-steps.md` and
   IMMEDIATELY proceed with the design → implementation chain for the fix;
   circle back to the document on resolution). A change that fixes a defect,
   lands a decision, parks an item, or launches a speculative proposal MUST
   update these trackers in the same pass.

## Process & TDD compliance for sub-agents

7. **Follow the `docs/subagents.md` workflow before delegating**: never jump
   straight from a §10/proposal to an implementation sub-agent. A code task is
   only delegable once its step gate has passed: spec(s) exist in
   `docs/specs/*.md` (Step 4) AND the Step 3 reviewer loop returned an empty
   list (or parked the remainder with a decision record). If the contract does
   not exist, delegate a SpecWriter unit — not an implementation unit.

8. **Test-first, always (TDD)**: every sub-agent prompt that requires writing
   or changing source code MUST be structured as red → green → verify, in this
   order:
   a. Write tests that encode every state/fail-state in the spec (red);
      no implementation changes in the same pass;
   b. Run the new tests and report the failing (red) set;
   c. Only then implement the least code that makes those tests green;
   d. Re-run the full validation trio (item 4) and the failing set and report.
   Prompts must never be phrased "implement X and add tests". Tests are
   written and executed before any implementation exists; a change that adds
   no test is itself a review finding. Reviewer sub-agents stay read-only and
   never edit files to "fix" findings.

9. **User proposal review — three-agent gate (before any spec or code work)**
   : every user/design proposal goes through three sequential sub-agent
   review steps first (pattern established by the compile max-depth change,
   `archive/reviews/2026-08-15/2026-08-15-compile-horizon-review.md`). Never jump from a proposal
   straight to a spec or implementation unit:
   a. **Validity agent (step 1)** — analyzes the proposal against the
      current codebase: can it be implemented as stated? Does it actually
      solve the stated problem (and only it)? What does it require that does
      not exist?
   b. **Critique agent (step 2)** — adversarial pass: does it create
      externalities? What is the performance impact? Does it violate design
      paradigms (managed channel, two-scope compile, phase ordering,
      read-only compiled states)? Is it robust against data/structure
      changes? Will it break safety checks (loop detection, containment,
      idempotency guards)? What design overlooks remain?
   c. **Change-analysis agent (step 3)** — reviews the prior two steps'
      outputs: is the proposal a good idea? What, if anything, needs to
      change? If it does not work as written, are there elements that can be
      adapted into a better solution? What are the costs and benefits? Does
      a better solution exist?
   Steps 1 and 2 are independent (may run in parallel); step 3 requires both
   outputs. All three are read-only — they analyze, never edit files. The
   step-3 verdict lands as `docs/specs/<proposal>-review.md` (compile-
   horizon-review.md format: status / what the proposal asks / feasibility
   verdict / gaps + costs-benefits). Only a passing review plus the user's
   go-ahead may proceed to the item 6 step gates.

10. **Blind-test → subagent review loop (documentation test + error checking/
   consistency tool — run after ANY major feature update)**: when a feature
   or behavior change ships, its documentation, demo, and test claims must be
   verified by agents who did NOT write them (the feature-showcase blind test,
   `archive/findings/2026-08-15/2026-08-15-test-findings.md` §"Blind test #1", is the pattern):
   a. A **writer** produces the artifact from the DOCUMENTATION ONLY
      (specs + skill docs; no implementation reading). For a demo page this
      means: legacy-JSON envelope input, handler bodies as function-STRING
      data, core-only page module. Any use case that ends up needing an
      outside script/function is a data-authoring mistake — re-express in
      data or drop the claim.
   b. A **proofreader agent** audits the docs against code+specs and fixes
      doc inconsistencies (spec refs, section numbers, claims vs behavior).
   c. A **page reviewer agent** tests the render (full validation trio,
      item 4), verifies intended-vs-actual output, and fixes **data only**
      to produce the intended output.
   Findings MERGE into the active trackers (`docs/defects.md` defect rows,
   `docs/decisions.md` decision records) and the full reports are written to
   `archive/<topic>/<date>-<name>.md` (append; latest on top), and
   new rules from the findings go back into `docs/skills/designing-pages.md`
   §14-style lessons + the relevant specs. The trio must be green before the
   loop is reported complete.

11. **Stress-test review loop (after major features — break the pipeline
    on purpose)**: run three sequential sub-agents to hunt compile/render
    breakage with VALID legacy-JSON data:
    a. **Scenario agent** — frames N specs for valid legacy envelope data
       that should break or surprise the compile/render pipeline; each
       scenario records the example situation, the expected output, and the
       suspected failure stage. Artifact: `archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md`.
    b. **Probe agent** — completes every scenario using ONLY core
       (`dist/core/*`) + legacy JSON (probe scripts, no page-side logic);
       records real vs expected output.
    c. **Review agent** — analyzes failure states; any real-vs-expected
       mismatch is either a doc/spec bug (fix the doc), a data-authoring bug
       (fix the scenario data), or a genuine engine defect (report —
       do not fix engine code in this loop). Findings MERGE into
       `docs/defects.md`/`docs/decisions.md` and the full reports are
       appended to `archive/<topic>/<date>-<name>.md` (§"Stress-test review loop").
    Each agent verifies the validation trio (item 4) after its work.
