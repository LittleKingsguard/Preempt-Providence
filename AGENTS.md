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

5. **Specs and decision records**: behavior contracts live in
   `docs/specs/*.md`; design decisions are recorded in
   `RENDER_PROCESS_NOTES.md` §10.10 as `DECIDED:` entries. Keep both in sync
   with implementation and with `docs/skills/designing-pages.md`.

## Process & TDD compliance for sub-agents

6. **Follow the `docs/subagents.md` workflow before delegating**: never jump
   straight from a §10/proposal to an implementation sub-agent. A code task is
   only delegable once its step gate has passed: spec(s) exist in
   `docs/specs/*.md` (Step 4) AND the Step 3 reviewer loop returned an empty
   list (or parked the remainder with a decision record). If the contract does
   not exist, delegate a SpecWriter unit — not an implementation unit.

7. **Test-first, always (TDD)**: every sub-agent prompt that requires writing
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
