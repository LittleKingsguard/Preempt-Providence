# Sub-Agent Orchestration Plan — Preempt-Providence rebuild

Source of truth for splitting RENDER_PROCESS_NOTES.md (esp. §8 and §10) into
dedicated sub-agent work. Every step below is a sub-agent unit; steps with a
user gate stop and prompt for input before the next handover. Artifacts,
hand-off prompts, acceptance checks, and storage paths are listed per step.

Workflow topology:

```
 S1 (inline+reviewer) ─▶ S2 arch review ─▶ S3 reviewer loop ─▶ S4 specs ─▶ S5/6/7 units: TESTS FIRST ─▶ implement ─▶ verify
     §10 consistency        (user gate)     (user gate per turn)  (user gate)     (red: failing)   (green)   (full trio)
```

Every S5/S6/S7 code unit is TDD: the TestWriter writes FAILING tests from the
spec first (red), the Implementer then makes them green, and only then is the
final result verified. Tested-before-implementation is the only acceptable
order; a delegated prompt that says "implement X and add tests" is out of
process.

## Roles

| Role | Tool set | Guardrails |
| --- | --- | --- |
| Architect (me / user) | read/edit/notes | owns §10; makes design calls; inserts into notes |
| Reviewer | explore/general, read-only by default | never edits; returns inconsistency list + questions; a code change with no test is itself a finding |
| SpecDoc | write | writes class/API specs derived from congealed §10 |
| TestWriter | write/bash | writes tests FIRST (red) from `docs/specs/*.md`; runs them to confirm they fail; never implements alongside |
| Implementer | read/edit/bash | may run only after TestWriter reports red; edits the least code to go green; re-runs the test trio and reports |

Inputs always read from `RENDER_PROCESS_NOTES.md` sections §8–§10 unless stated.
All artifacts get committed in the repo alongside the notes.

---

## Step 1 — §10 consistency pass (me, inline)

- Goal: single pass over §10.1–§10.8.4; fix stale cross-refs, dead type
  names, duplicate pillar letters, and terminology drift against §8.1/§8.4.
- Verify: type names `Anchor/ LinkConfig / LinkConfigError`, role union
  (parent/child/source/target/duplex/placement/component), `compile(slice)`
  two-pass split (§10.8.4) referenced from §10.6 and the §10.8 compile bullet.

(This step is done inline; reviewer may double-check in Step 3.)

## Step 2 — Top-level architectural review (Architect, user gate)

- Prompt to Architect: read all eight §10; produce a hand-off **review** that
  covers, in this order:
  1. Sign-off — pipeliness/lifecycle story (Supervisor → template/payload →
     prototype → unplaced → in-tree → render) is described end-to-end;
  2. The object inventory: Node, Layer stack → graph (Link/Anchor), domain
     helpers (Props/Css/StyleNode/Placement/Component/Handler/Payload/
     Template), registry, workers, ClientApi, SSR adapter;
  3. Consistency check table: pillar → pain point it kills → hoops;
  4. Loose ends / unresolved questions list (blocking vs non-blocking).
- **User gate:** present items 1–4 to the user conversationally. Do NOT
  advance to Step 3 until the user answers the blocking questions.

Store: `docs/arch_review.md`.

## Step 3 — Reviewer loop (Reviewer sub-agent)

Hand-off prompt (copied verbatim into each Task call):

> You are the Reviewer for the Preempt-Providence rewrite. Input:
> `RENDER_PROCESS_NOTES.md` (§10 proposal + §8 observations) and
> `docs/arch_review.md`. DO NOT EDIT ANY FILE. Re-read the whole §10 pair
> paragraph by paragraph. Find and enumerate:
> 1. Contradictions internal to §10 (pillar A–F vs Pillar G, APIs, lifecycle
>    state table, compile two-pass);
> 2. Drift against §8/§8.1/§8.4 (legacy terms still referenced, falsy-parent,
>    clone arity, sourc-forward);
> 3. Missing definitions or underspecified mechanics (naming tuples, parts
>    that lack a defined owner).
> Return a numbered list of findings, each tagged
> `[must-fix | a-big]`, with a **one-line question or missing-code-gloss** for
> each, and predict which user decisions need to be made. Do not propose
> fixes in prose; only precise questions.
```

- **Loop:** run Reviewer → I respond to each finding → Reviewer re-reads only
  the changed sections → hand back. Between every Reviewer → Architect /
  author round-trip, PAUSE and ask the user for input (design calls only the
  user can make).
- Exit criteria: Reviewer returns an empty list, or every remaining item is
  tagged future/blocker and parked in the notes with a decision record.

### Decision-record convention
Append `DECIDED:` / `PARKED:` notes to §10 in `RENDER_PROCESS_NOTES.md` so
every reviewer turn has a paper trail.

## Step 4 — Class/method specs (Specs sub-agent, REMOVE user gate)

Launch only after the user confirms readiness (per Workflow). Output
`docs/specs/*.md`, one file per concern:

| File | Content |
| --- | --- |
| `docs/specs/node.md` | `Node` fields, anchor array contract, two-pass compile |
| `docs/specs/graph.md` | `Link`, `Anchor`, `LinkConfig`, `LinkConfigError`, retry/erase |
| `docs/specs/ops.md` | `StructuralOp` kinds + executors, reducers, replay |
| `docs/specs/pipeline.md` | `PhaseRegistry`, `PhaseWorker`, workers, locking |
| `docs/specs/render.md` | `RenderAdapter`, render ops, client/SSR mapping |
| `docs/specs/adapters.md` | concrete adapters (`DomAdapter`, `SSRFragmentAdapter`, fragment descriptor) in `src/core/adapters.ts`, render-helper utilities (`minimalFromState`/`applyOps`/`treeFromOps`/`treeSig`/`jsonClone`) in `src/core/render-helpers.ts`, `tsconfig` `lib: ["ES2022","DOM"]` decision |
| `docs/specs/validation.md` | tag schemas, `LinkConfig` vs schema boundary |
| `docs/specs/api.md` | `ClientAPI`, WS events, handler/emission contracts |
| `docs/specs/translate.md` | legacy `/Preempt` NodeSchema → anchor graph (`translateLegacy`) |
| `docs/specs/handlers.md` | `HandlerContext`, event/phase dispatch, pipeline phase ordering |
| `docs/specs/payload.md` | payload lifecycle (drop/refresh/append) + reverse translation |

Specs must be exhaustive enough that a TestWriter can derive every state and
fail-state from them (Step 4 prerequisite).

## Step 4/5/6/7 — Tests (TDD: red → green → verify)

Every code step splits into TWO separate sub-agent runs: a TestWriter run
(red) and an Implementer run (green). They are never merged into a single
"implement and add tests" prompt.

**Run A — TestWriter (red).** Prompt boilerplate (insert target scope, reuse
per phase):

> You are the TestWriter for the Preempt-Providence rewrite. Use
> `docs/specs/*.md` as the behavior contract. Do not modify specFs. Write ONLY
> tests in the repo's existing runner (check package.json; Vitest today). For
> every method/API:
>   - one valid/happy-path test per reasonable data state (enumerate the
>     states in a comment block first);
>   - one fail-safe test per documented fail-state.
> Do NOT touch `src/`. Run the new tests and report the failing (red) set,
> the state-machine (which states are covered), fail-states covered, skip
> reasons.

**Run B — Implementer (green).** Boilerplate:

> You are the Implementer for the Preempt-Providence rewrite. The TestWriter
> has already committed failing (red) tests derived from `docs/specs/*.md`
> (see the paths in `docs/specs/`). Write the least `src/` code that makes
> exactly those tests pass. Do not add tests, do not change the spec. After
> implementation, run `npm test`, `npm run typecheck`, `npm run demo:smoke`
> and report green/failing counts against the red set from Run A.

Exit gate: green set matches the red set from Run A, plus the trio passes.

Scopes:
- **Step 4** — specs sub-agent only (user gate).
- **Step 5** — unit tests: `Node` (layers/compile/two-pass), `Link/Anchor`
  (all `LinkConfig` shapes + `LinkConfigError` retry/erase), `StructuralOp`
  executors/replay, `PhaseRegistry/workers`, `Placement`, `Component`,
  `EventLoop/handlers`, `Layers` ops, `ClientApi`/SSR adapter emit.
- **Step 6** — integration tests: Supervisor → template/content;
  node parentage tree walking; component/placement resolution & borrow; event
  emission pipeline; node layer management. Both happy + failing paths
  (invalid parentage, ordering conflicts, unresolved component refs, deadlock
  guards).
- **Step 7** — e2e: data client/SSR receive → valid complete render;
  scenarios with placements + components + nested; loop-safety probes that
  intentionally try to create infinite circles (A→B→A anchors, component
  self-reference, dangling source/target) and assert the safety guard trips.

---

## Interaction protocol

1. Every handover to a sub-agent includes: the input artifact path(s), the
   exact prompt text from this file, and the expected output artifact path.
2. Any sub-agent that would write outside `docs/` (later: `src/`, `tests/`)
   stops and returns a diff proposal instead — respects repo boundaries.
3. Between sub-agent runs that share a boundary (esp. Reviewer → Architect,
   Specs → TestWriter), **Pause at the user gate**; the user resolves
   ambiguous design calls before the next run starts.
4. **Delegation gate:** an Implementer unit is only launched after (a) its
   `docs/specs/*.md` contract exists and passed the Step 3 reviewer loop and
   (b) a TestWriter unit has run and reported the red set. Never skip Run A:
   no-tests tickets are rejected by the Reviewer.
5. A caller spurring a sub-agent MUST check that the hand-off is in spec →
   red → green order, and MUST NOT pass a prompt that mixes test-writing and
   implementation into one unit.