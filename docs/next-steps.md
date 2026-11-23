# Next Steps — bookmarked findings (the circle-back list)

Maintained by the document-archival loop (AGENTS.md item 6). When a defect
arises with a CLEAR and DISTINCT fix shape (no user approval needed for a
design choice), the OTHER current findings are bookmarked HERE and the fix
proceeds immediately (design → implementation chain); this document is
circled back to on resolution. Parked/pending decisions and speculative
proposals live in `docs/pending.md` — this file is the work queue of what
to pick up next.

## ✎ INTAKE 2026-11-23 — the `modularity` handoff (`H-1`/`H-2`) — **THE GATE IS THE QUEUED ITEM**

> **QUEUED, AWAITING THE GATE, NO CODE-SIDE WORK.** Downstream `Provident-Electron`
> delivered `docs/handoff-modularity-2026-11-20.md` (committed 2026-11-23): `H-1` a
> post-compile structural change + a public node-keyed invalidation entry; `H-2` a
> `handlers[].ref` host resolver. Triage (evidence-anchored, **not a verdict**):
> **`docs/specs/handoffs-triage-modularity-2026-11-20.md`**. **The owner chose gate-first
> on 2026-11-23**: run the three-agent gate (AGENTS.md item 9 — validity + critique in
> parallel, then change-analysis on both outputs) over `H-1b` + `H-2`; the verdict lands
> as **`docs/specs/handoffs-review-11.md`**; nothing upstream changes before that verdict
> and a go-ahead.
> **Booked rows:** `docs/pending.md` `H-1b` + `H-2` (the two asks with their recorded
> constraints) and `docs/defects.md` **ATTACH-UNREGISTERED-SILENT-NOOP** — a genuine
> silent no-op found *inside* `H-1`'s evidence (`attach` never registers its node, against
> a flush that silently skips unregistered ids) but **independent of either ask**, queued
> behind the gate **by the owner's choice, not parked**; its fix shape needs a red-first
> probe first.
> **Two facts the next agent must not re-derive:** (1) `H-1`'s premise "the ancestor's
> re-emit cannot be forced" is **not established** — the composition already exists and is
> merely undocumented; (2) `H-2`'s premise "a handler body is only a function STRING" is
> **false at the API level** — function values are accepted, and the need is served
> in-process by `state-slice handlers` / `layer-apply` / `addLayer`.

## ✎ LANDED IN TREE (UNCOMMITTED) — VALUE-PROVIDER-RENDER-DISPOSITION (opened 2026-11-13 as a downstream finding; implemented + documented 2026-11-13; **release 0.5.2 pending the owner**)

> **✔ LANDED 2026-11-13 — the steps 1–4 of the plan below are DONE and VERIFIED (supervisor runs, this pass):** red set `tests/unit/value-provider-render-disposition.test.ts` went **6 red → 12/12 green**; the implementation is `src/core/node.ts` (dedicated `valueRecord` marker + the hoisted-seam emit gate + the `value-record-drop` warn) and `src/core/ops.ts` (`mintRowNode` sets the marker); §4.1 re-pins are `tests/unit/render.test.ts` (FRK-H1 `actionable` **1 → 2**) and `tests/unit/pass2-fit-reference-scope.test.ts` (`FROZEN_GOLDEN` **11 → 15** states, `#f:` numbering re-verified unchanged); `npm run typecheck` **clean**, `npm test` **82 files / 1442 tests + 2 files / 13 tests, all green**, `npm run demo:smoke` **exit 0** with **48 banners `0 failed`**, `[runtime-fork:growth]` **5.40×/5.75×** against the 10× bound, derived pins **0.99/0.91/1.06** and **1.50/0.79/0.40** against 2.5×, and the rows census **`fanoutStates=8 fanoutRows=8` exactly** (the marker's falsifier). Step 5 (docs) is also done: `docs/skills/designing-pages.md` (incl. §14.10 item 1 — the only normative author statement — and a new §11 matrix row), `docs/specs/node.md:288`/`:412`, `RENDER_PROCESS_NOTES.md` **§10.10.13**, a FIXED row + `R-VPD-1/2/4` rows in `docs/defects.md`, the four demo sources, and the 13 regenerated `demo/*.html` artefacts (which had **shipped the defect**: `showcase-root` occurred zero times in `feature-showcase.expected.html`). **ONE DEVIATION RECORDED:** the marker is declared without an initializer (`undefined`, not `false`) — semantics identical, better for VPD-11's non-forgeability assert; spec §6 `AM-9`. **REMAINING: nothing in code — only the owner's commit/tag/publish.** The release records are WRITTEN in this pass: `package.json` **0.5.2**, the `docs/releases.md` **0.5.2 index row** and the `docs/decisions.md` **`RELEASE-0.5.2`** index row (both with `PENDING (filled at commit time)` tag/commit/date cells — no hash or date is asserted, AGENTS item 12). The two flagged stragglers are **ANNOTATED, not rewritten** (frozen round-4 probe output): `scripts/stress-probes/RESULTS-round4.md:137` + `run-all-round4.mjs:772` now carry a dated note that the "F3-dropped" LABEL is retired while the measurement and its reverse-emission substance stand (reverse is emit-gate-independent, spec §2 C4/AM-6). **✔ ONE RED CAUGHT AND CLOSED IN THE SAME PASS:** verification then reproduced the phase-B failure (`FRS-9b` + `FRS-9g`) **with its assertion text attached**, and the diagnosis **RETRACTED the load-spike hypothesis first filed for it** — the cause was arithmetic, not timing: the test's printed-precision window multiplied the exact derivative by an extra `1/divisor`, so the margin arm's window was **6×** too tight (per-node **4×**, latent) and a correctly rounded margin fell outside its own window for **2 789 of 80 001** swept true ratios (~3.5% of the band — which is exactly what made it look intermittent, since the live pass2-ratio differs run to run). **Fixed test-side** (weights → the literal `1`) and **proved** by a new swept case **`FRS-9h`**: margin max gap `0.007656` vs window `0.007862`, per-node `0.005` vs `0.00625`, pass2-ratio `0.009268` vs `0.009736` over 1 203 401 points, fabricated arms still ≥ **71×** the window (floor 10×), and re-injecting the old weights turns it RED. Phase B is now **14/14** across 1 + 6 runs; `npm test` exit 0; `npm run typecheck` exit 0. Recorded as **FIXED** row `FRS9-PRINTED-WINDOW-UNDERCOUNT` (the original row kept as a retraction pointer), with one residual filed: the per-node fabricated arm stops being distinguishable once the true pass2-ratio reaches ≈ **8.00** — that needs the *fabrication* re-picked, never the window widened. **No engine behaviour changed**, and the smoke's growth guard passed on every run.

> Downstream `Provident-Electron` filed **`AL-F1`** (`strata/records/app-layout-unit.md`): a provider that is also an element is dropped from render, orphaning its children. **The owner ruled it a DEFECT** — not the "F3 discipline" the in-code comment claims — and chose the replacement: *an AUTHORED provider IS an element and renders; only RUNTIME-MINTED value records are dropped as values*, **and the residual drop must be recorded (a diagnostic)**.
> **RCA (blamed + measured):** the predicate shipped in the initial commit **`996ca7f` (2026-08-10)** with **no decision record**; the "value holder, never an element" justification was written into the code five days later in **`6eb1cb4` (2026-08-15)** after Blind test #1 classified an author's surprise as a data error (`archive/findings/2026-08-15/2026-08-15-test-findings.md`, row **F3**, class *"A (data, semi-surprising)"*). No spec clause has ever stated the drop and `docs/specs/node.md:288` states its opposite. It is also **slice-composition-dependent**, and `compilePath()` never had it — the engine has disagreed with itself about provider semantics since `996ca7f`. **The repo ships the defect in a tracked artefact:** `demo/feature-showcase.expected.html` contains **zero** occurrences of `showcase-root`.
> **CONTRACT LANDED:** `docs/specs/value-provider-render-disposition.md` (clauses C1–C5, fail-states `FS-VPD-1…10`, register `VPD-1…12`, amendments AM-1…AM-8). Gate verdict **`ACCEPT-WITH-AMENDMENTS`**, all binding: the marker is a **dedicated `valueRecord` flag** (NOT `originLayer` — survivor promotion *clears* it, so a promoted raw row would materialise; NOT `runtimeMinted` — it covers adopted def children, which ARE elements); the **seam exemption is evaluated FIRST**; the diagnostic is **`console.warn` only** (`value-record-drop`, C4-style process-level `(code, nodeId, name)` dedup, `shouldWarn` gating, **R-W4-5 inherited verbatim**, invisible inside `demo/fork-stress.js:239`'s silenced window).
> **⚠ OPEN INTERPRETIVE CALL — overturn BEFORE the red set if it is wrong:** "recorded diagnostic" was written as a **warn**, not as a `dropped` entry, because `ArmDropReason` and `CompileResult.warnings` are **closed unions** (`types.ts:279`, `:299`) and widening them is an `X.Y.X` public-surface change this repo already rejected once for the identical problem class (`docs/decisions.md:38`). FS-1's `dropped`-completeness half (`docs/specs/node.md:412`) stays **OWED** as `R-VPD-4`.
> **NEXT, in order, each its own gated unit:** (1) the **red set** from spec §8 (`VPD-1…12`), reported failing, `src/**` untouched; (2) the **implementation** at the `compile()` emit gate **ONLY** (§2 C4 / AM-6 — never translate time, never graph mutation, or `reverseTranslate`/`serializeNode` output changes); (3) the §4.1 **re-pins** (FRK-H1 `actionable` 1 → 2; `FROZEN_GOLDEN` gains 4 `slot` provider states + `#f:` renumbering re-verified; regenerate `demo/*.html` via `npm run demo:build`); (4) the **validation trio** with the growth guard (10×) and the derived 2.5× pins UNMOVED, and the rows census as the marker falsifier; (5) the §5 **doc/demo rewrite list** + the three tracker rows owed — `docs/decisions.md` `VALUE-PROVIDER-RENDER-DISPOSITION`, `RENDER_PROCESS_NOTES.md` **§10.10.13**, and a `docs/defects.md` row — **none of which exists yet**; (6) **`0.5.2`** (`X.X.Y`; no public signature changes).
> **NOT fixed by this unit (do not cite this unit as closing them):** the seam's name-keyed def-root resolution (`R-VPD-1` — emitted classes contradict compiled bindings, order-dependent, **measured**), the general ghost-`childOrder` mechanism for other drop classes (`R-VPD-2`), slice-dependence for the residual class (`R-VPD-3`), and any **position index** for a downstream consumer (`C5` exclusion 3 — the downstream's position-based styling need stays UNMET).

## ✎ RELEASE PASS (0.5.1) — IN FLIGHT 2026-09-23

> **RELEASE SCRIBE PASS (docs only — no `src/**`, no tests, no `scripts/**`, no
> `demo/**`, no `package.json`; the version bump, the commit, the tag and the
> publish are the supervisor's).** The release row is written
> (`docs/releases.md` top row) and the release index row is recorded
> (`docs/decisions.md` `RELEASE-0.5.1`). **PROVENANCE HONESTY:** the release
> commit does not exist yet — nothing has been committed (85 changed/untracked
> files) — so the tag, commit and date cells carry an explicit
> **`PENDING (filled at commit time)`** marker and **no hash or date is
> asserted**; `package.json` still reads **`0.5.0`** (the supervisor edits it).

**1. WHAT SHIPS AS 0.5.1** (patch, `X.X.Y` per the VERSIONING-SCHEME row; every
item by reference to its owning record — no restated contract). **Verified
against the trackers, item by item:**
`BODYRUNS-DROP-DIAGNOSTICS` (W4 — `docs/decisions.md` row of that name +
`docs/specs/bodyruns-drop-diagnostics.md` §9; defects **N1** (containment clamp),
**N2** (`text`-children clause), **N3** (the warn half) **FIXED** in
`docs/defects.md`); the **W4 residual** `R-W4-5` (**OPEN by design** —
observability debt, not a code bug) and `BODYRUNS-DIAGNOSTIC-DEDUP-SCOPE` ride
with it as documented residuals, not as fixes;
`NO-CLONE-ENFORCEMENT` + `NO-CLONE-HARNESS-OPS` + `NO-CLONE-TEST-PHASE-ISOLATION`
(gate `docs/specs/no-clone-invariants.md` I1..I5 + the 7-row §5 register; the two
suites `tests/unit/no-clone-invariants.test.ts` /
`tests/unit/no-clone-guards.test.ts`; the harness guard-reachability rework
`guard-exit-audit` + the `PP_SMOKE_FAULT` seam + the §3-I5 `cloneOps` journal
measurement); `DATA-DRIVEN-FAMILY-PATH-ENUMERATION` + its closeouts
`DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION` and the d2/link
`treeFromOps`/shallow-expectation corrections; `PASS2-FIT-REFERENCE-SLICE-SCOPE`
(the R1 fix in `src/core/resolve.ts`); `RUNTIME-FORK-GROWTH-GUARD` (which
**supersedes** `RUNTIME-FORK-TRIPWIRE-BOUND` — the cross-family 3× assertion is
retired, the runtime-vs-runtime guard is the asserted scaling signal).
**NOT in this release:** `ENG-BODYRUNS-WIRE-REF-FIX` /
`ENG-BODYRUNS-WIRE-REF-PATHSTATE-FIX` (0.3.1 / 0.3.2 rows) and `BARE-TEXT-EMIT`
(0.4.0 row) **shipped earlier**; the 0.4.1 / 0.5.0 items
(`BOOLEAN-ATTRS` + `SUPERVISOR-DISPOSE` +
`DESTROY-DISSOLVE-PLACEMENT-ANCHORS` ; `JOURNAL-READ-API`) are **not claimed by
the 0.5.1 row** — those rows stay `UNTAGGED` / `UNVERIFIED` provenance debt; and
the session's doc/tracker passes are **not shippable artifacts** (they change no
`dist/` output).

**2. THE PUBLISH SURFACE (verified in `package.json` this pass — not restated as
a contract, read as the recipe):** `prepublishOnly` = **`npm test && npm run
typecheck`**; `prepack` = **clean `dist` + `npm run build`**; `files:
["dist"]`; registry = the default npm registry (no `.npmrc`, no
`publishConfig.registry` — `.github/` is absent since the 0.2.0 flip). **The
demo smoke is NOT in the publish gate.**

**3. REGISTRY FACTS (recorded 2026-09-23, supervisor-authenticated as
`rarasey`; this pass cannot re-derive them):** published versions run
**`0.1.3 … 0.4.1, 0.5.0`**, **`latest = 0.5.0`**, **`0.5.1` is FREE**.

**4. THE SEQUENCE THE SUPERVISOR WILL RUN:** bump `package.json` to `0.5.1` →
**commit** (the full 40-char hash + the commit date are what the
`PENDING (filled at commit time)` cells are waiting for) → **annotated tag
`v0.5.1`** → **`npm publish`** (the gate re-runs `npm test` + `typecheck`;
`prepack` cleans + builds) → **push** (`git push && git push origin v0.5.1`) →
**fill the three `PENDING` cells in `docs/releases.md`** in the SAME pass
(AGENTS.md item 12).

**5. GATE / EVIDENCE STATUS — verified vs attributed (the scribe executed NOTHING
of the trio: no `npm test`, `typecheck`, `build` or smoke run is claimed by this
pass; this is a docs review, and an unexecuted count is never asserted):**
- **Static verification performed this pass** (source read): `package.json`
  (`0.5.0`, the three publish scripts, `files: ["dist"]`);
  `scripts/demo-smoke.mjs` — `runtime-fork-growth-guard` **is** in
  `KNOWN_GUARD_IDS` (`:316`) and has a `runGuard` call site (`:1741`); the retired
  `runtime-fork-tripwire` is **no longer a guard id** — it survives only as the
  `[runtime-fork:tripwire] INFORMATIONAL …` print (`:1752-1759`), exactly as ruling
  `RUNTIME-FORK-GROWTH-GUARD` records; the tripwire-stale-spec test re-point
  **HAS LANDED** in the tree (`tests/e2e/path-fork-e2e.test.ts` asserts the new
  guard and `not.toContain('(3× asserted)')`; `tests/unit/no-clone-guards.test.ts`
  and `tests/unit/pass2-fit-reference-scope-measurement.test.ts` carry the growth
  guard id and the INFORMATIONAL line).
- **Attributed (measured by the supervisor 2026-09-23, not re-run here):** the
  smoke is GREEN — **34 guard entries, 0 failures, exit 0** — and the growth
  guard's measured envelope is 6.07-7.70× against its **10×** bound.
- **⚠ ENTRY-COUNT DISCREPANCY (recorded, not silently resolved — THREE readings
  now exist, and this pass does not pick a winner):** the guard-redefinition
  record and the release prompt read **34 entries / 0 failures**; the later
  R1-landing, shallow-census and `pass2-fit-reference-scope.md` records read
  **35 entries / exactly ONE failing guard (`runtime-fork-tripwire`)**; and this
  pass's **static count of the live harness is lower still**: `runGuard` has
  **27 call sites** of which one is the `mode-toggle-page-${mode}` template
  (expanded ×3 by `MODE_TOGGLE_MODES`), `guardEnter` has **exactly one call
  site** (inside `runGuard`, `scripts/demo-smoke.mjs:197`), and the failure-only
  `harness-top-level` adds no entry line — i.e. **≈31 entry lines, not 34**.
  **What is certain and source-verified:** the **asserted** scaling signal is
  `runtime-fork-growth-guard` (registered at `KNOWN_GUARD_IDS`, called at
  `:1741`) and the retired `runtime-fork-tripwire` is **not a guard id**
  (it survives only as the INFORMATIONAL print `:1752-1759`; an unknown
  `PP_SMOKE_FAULT` id now hard-fails at `:332-337`). **The right resolution is a
  single executed smoke run by the supervisor** (the count is a runtime output
  line), and the **pre-retirement 35/1 claims are annotated, not deleted**
  (`docs/specs/pass2-fit-reference-scope.md` §8 validation table + §11 AC-14
  [after]; `docs/specs/no-clone-invariants.md` status block;
  `docs/next-steps.md` §"LANDED 2026-09-23 — the FD7-D2-LINK-TREEFROMOPS-CHECK
  pass" — each now carries a 2026-09-23 release-pass ERRATUM). **The release row
  and the decision row therefore record the supervisor's 34/0 reading as
  ATTRIBUTED, with this discrepancy named beside it, and assert no entry count
  of their own.**
- **⚠ TEST-COUNT DRIFT (annotated, not asserted):** the recorded `npm test`
  readings differ across passes (phase A 1362 / **78** files → 1387 / 79 files →
  **1430 / 81 files, phase B 12**; and the post-ruling 1429+1 / 7+5 STALE-SPEC
  split). The **1430 / 81 + phase B 12** reading is the one recorded *after* the
  stale-spec re-point landed, and it is **attributed**, never re-measured here.
- **⚠ TRACKER ROW STALE — `docs/defects.md` `FORK-STRESS-TRIPWIRE-STALE-SPEC`**
  still reads "now FAIL (… requires a TestWriter re-point)" while the re-point
  **has landed in the tree**. **Not a shippability blocker** (the row describes a
  debt that is already discharged; the gate `npm test` is the arbiter), but it
  **must not be re-actioned by the release pass** — it is a tracker-hygiene item
  for the supervisor, not a test to fix.
- **Still OPEN by design (not blockers):** `RUNTIME-FORK-PASS2-RATIO` (the pass-2
  residual ≈8.1× cross-family informational ratio — no bound moved; R2 ungated),
  `R-W4-5`, `PRODUCING-HOST-CENSUS`, `PASS-2-BOUND-CHOICE` (the user's).

**6. CARRIED DEBT (separate item, NOT resolved by this release):** the
**0.4.1 / 0.5.0 provenance debt** — both rows in `docs/releases.md` remain
`UNTAGGED` / `UNVERIFIED` (no tag object, no resolvable commit, no date asserted).
The 2026-09-23 registry cross-check confirms the releases exist on the registry
but **adds no tag, commit or date**; the debt is discharged only by a maintainer
with the full clone (AGENTS.md item 12 landing duty), and the 0.5.1 row must not
be used to infer their contents. Also still carried: the 0.4.1-era items'
contents are `UNVERIFIED` in their own rows (they are not restated here).

## ✎ CURRENT STATE — READ THIS FIRST (doc housekeeping refresh, 2026-09-23)

> **Handover state for a fresh supervisor. Everything below this block is the
> historical record and stays valid except where it says otherwise.**
>
> **THE VALIDATION TRIO IS GREEN — AND IT IS TWO-PHASE.** `npm test` runs **TWO
> sequential Vitest phases** (`FLAKE-NOCLONE-SMOKE-IN-PARALLEL`,
> `docs/decisions.md` `NO-CLONE-TEST-PHASE-ISOLATION`): **(A)** the parallel unit
> phase (`vitest.config.ts` — every file except the smoke-spawning ones) then
> **(B)** the serialised smoke-ops phase (`vitest.smoke.config.ts`,
> `fileParallelism: false`). The verified reading is **phase A = 1430 passed / 0
> failed (81 files); phase B = 13 passed (2 files)**, exit 0. `npm run typecheck`
> and `npm run build` are clean. `npm run demo:smoke` is **GREEN: exit 0, 34
> guard entries, 0 failures**. **RULE:** a unit file that spawns the full smoke
> (`scripts/demo-smoke.mjs`) must be listed in `SMOKE_SPAWNING_TEST_FILES`
> (`vitest.config.ts`) and must NEVER be fixed by skipping it or gating it behind
> a default-off env flag — CI runs plain `npm test` (AGENTS.md item 4).
>
> **THE SCALING GUARD IS NOW RUNTIME-VS-RUNTIME — THE SMOKE HAS NO FAILING GUARD
> BY DESIGN.** `runtime-fork-growth-guard` (`scripts/demo-smoke.mjs`; decision row
> `docs/decisions.md` **RUNTIME-FORK-GROWTH-GUARD**) times the **same runtime page
> family against itself**: runtime `fork-stress-d10.html` (**1023 nodes**) →
> `fork-stress-d12.html` (**4095 nodes, ×4**). **Statistic = the pass-2 ratio**
> (the most stable candidate: ±1.5% across repeats vs ±3.0% for the page total,
> ±4.6% per-node). **Bound = 10×**, a **1.30× margin** over the measured envelope
> (**6.07-7.70×** over three runs; the supervisor's 2026-09-23 run reports
> **5.9-6.6×**). An O(n²)-era return (~20×/depth) reads ≈105× and a ×4 per-node
> degradation reads ≈26×, so a breach still means **per-node pass-2 cost is
> degrading super-linearly**. It prints its own envelope every run
> (`[runtime-fork:growth] STATISTIC=pass2-ratio … bound 10×; margin C×`). The
> retired cross-family measurement survives as the **INFORMATIONAL** line
> `[runtime-fork:tripwire] INFORMATIONAL (construction-cost ratio, NOT a
> like-workload metric — no longer asserted)` — both sets' composition is stated
> in that line. **No bound was raised, weakened or removed; the cross-family 3×
> tripwire was RETIRED as an assertion because its operands are page totals over
> two DIFFERENT construction methods** (derived: 23 real nodes / one bootstrap
> enumeration pass; runtime: 4095 real nodes built incrementally).
>
> **FAMILY CONSTRUCTION (the ruled shapes — do not restate these backwards):**
> the **data-driven / derived** family (`demo/fork-stress-data.js` +
> `demo/path-fork-data.js`) is **PATH ENUMERATION — 23 real nodes / 4095
> path-states / 4095 elements at d12, `cloneOps = 0`, `passes = 1`** (d14 = 27 /
> 16383). The **imperative runtime** family (`demo/fork-stress.js`,
> `fork-stress-{d2..d12}.html`) **never cloned and still builds ~4095 REAL NODES
> incrementally** through the four layer mechanisms (`new Node(...)` per node; 10
> renders, 137 handlers, 11 flush yields) — that is the sanctioned handler-driven
> construction, NOT a defect and NOT a conversion candidate.
>
> **THE RELEASE PASS (0.5.1) IS IN FLIGHT.** `package.json` still reads `0.5.0`;
> the bump + the `docs/releases.md` row per the AGENTS.md item-12 landing duty are
> the supervisor's edits (the in-flight target is `0.5.1`, `X.X.Y` = defect
> patch). The outstanding **0.4.1 / 0.5.0 `UNTAGGED` / `UNVERIFIED` provenance
> debt** is carried, not discharged — it needs a maintainer with the full clone.
> **`docs/releases.md` is owned by the release pass: no other pass edits it.**
>
> **GENUINELY OPEN (keep visible — none of these blocks the release):**
> 1. **`PRODUCING-HOST-CENSUS`** (`docs/defects.md` OPEN) — latent; the per-mount
>    census is structurally blind to what the producing-host page's 5 mounts
>    SHARE (the hub + the Link-keyed def-prototype registry). Design/coverage
>    item with a two-mount test proposal as its closure shape.
> 2. **The PASS-2 RESIDUALS — ORDINARY EFFICIENCY WORK, NOT A BLOCKED GATE**
>    (`docs/defects.md` `RUNTIME-FORK-PASS2-RATIO`, `docs/pending.md`
>    `PASS-2-BOUND-CHOICE`): the amplified super-linearity (one focused compile
>    per dirty node over its **ancestor chain**, **12.4× redundancy** at d12) and
>    the remaining levers **R2** (gated-high-risk: per-generation dirty-set
>    coalescing — needs its own spec + the AGENTS.md item-9 three-agent gate) /
>    **R3** / **R4** / **R5** / **R6**. R1 is LANDED (slice-scoped descent,
>    `src/core/resolve.ts:229-238`; **≈258 ms / 15.9%** saved). **The smoke is no
>    longer RED, so nothing here is gated by a failing signal — the live question
>    is only whether to pay the residue down now or park it.**
> 3. **`R-W4-1` / `R-W4-5` / `R-A1`** — parked residuals with revisit conditions
>    (`docs/pending.md`; `docs/specs/bodyruns-drop-diagnostics.md` §9.8).
> 4. **The NC-2b fault-arm item** — ✅ **CLOSED 2026-09-23; see open item 7
>    below**, which now carries the verifying evidence.
>
> **RECENTLY CLOSED (do not re-file):** `STALE-RESOLVE-ANCHORS` (all `resolve.ts`
> citations repaired BY SYMBOL, 2026-09-23); the `docs/defects.md` OPEN-table
> housekeeping (9 closed/superseded rows re-homed); `FORK-STRESS-DATA-P3-*`,
> `FD7-D2-LINK-*`, `FLAKE-NOCLONE-SMOKE-IN-PARALLEL`, `MODE-TOGGLE-
> SETCOMPILEPASSLOGGING-RACE`, `SMOKE-TRIPWIRE-INERT`, `RUNTIME-FORK-PASS2-RATIO`
> (closed by the guard redefinition).

## CURRENT WORK — the UR-2026-09-17 workstream (W1/W2/W3/A+/W4/W5) + its adversarial audits + the two gate-8 doc reviews + the **BLIND-GREENS set (gate 5)** **ALL CLOSED 2026-09-22 / 2026-09-23**; **the NO-CLONE-ENFORCEMENT unit is CLOSED 2026-09-22 (✅ DONE-with-open-smoke — see the block below)**; **the `FD7-D2-LINK-TREEFROMOPS-CHECK` + `FORK-STRESS-DATA-SHALLOW-LINK-STALE-EXPECTATIONS` row corrections are BOTH LANDED 2026-09-23 (the runtime data-driven shallow `link` family now derives its census + carries its own shallow coverage — see the LANDED blocks below)**; **NEXT QUEUED: the PASS-2 PERF UNIT (the runtime fork d12 pass-2 / tripwire work) — ✎ ✎ DIAGNOSED 2026-09-23 (the amplification is attributed: one focused compile per dirty node over its ANCESTOR CHAIN, 12.4× redundant; the cost is resolution + slice construction; the exit is a bound choice — see the `✎ DIAGNOSED 2026-09-23` block in the unit row below)**, **✎ R1 LANDED 2026-09-23 — the recommended first lever is IMPLEMENTED (`src/core/resolve.ts:229-238`, slice-scoped descent; decision row `docs/decisions.md` `PASS2-FIT-REFERENCE-SLICE-SCOPE`): measured saving ≈258 ms / 15.9% (d12 total 1622.2 → 1363.9 ms), residual ≈8.1× — NO bound moved, R2 ungated — see the unit row's `✎ LANDED 2026-09-23` block)**, **✎ ✎ GUARD REDEFINED + SMOKE GREEN 2026-09-23 (user ruling `docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD): the cross-family 3× tripwire is RETIRED as an assertion (its operands are page totals over DIFFERENT construction methods — 23 real nodes / one bootstrap enumeration pass vs 4095 real nodes built incrementally) and replaced by the RUNTIME-VS-RUNTIME GROWTH GUARD (d10 → d12 pass-2 ratio, bound 10×, margin 1.30×); `npm run demo:smoke` now exits 0 with 34 guard entries and 0 failures — see the `✅ LANDED 2026-09-23 — THE GUARD REDEFINITION` block below. THE LIVE DECISION is now only whether to PURSUE the remaining pass-2 work (R2/R3 + the page levers R4/R5/R6) now that RED is not the signal (`docs/pending.md` PASS-2-BOUND-CHOICE — option B is MOOT)**, with the **RELEASE PASS (0.5.1)** queued behind it — **neither blocked by anything**; **W4's smoke AND the no-clone unit's smoke are RED by ruling (see the W4 DONE-with-open-smoke block and the NO-CLONE DONE block below)**

### ✅ LANDED 2026-09-23 — THE GUARD REDEFINITION (user ruling): the smoke's failing scaling signal is now RUNTIME-VS-RUNTIME, and the smoke is GREEN

> **✎ LANDED 2026-09-23 — `RUNTIME-FORK-GROWTH-GUARD`: the cross-family 3× tripwire is RETIRED as an assertion and replaced by a runtime-vs-runtime growth guard; `npm run demo:smoke` is now GREEN (34 guard entries, 0 failures, exit 0).** **WHAT THE USER RULED (the question they asked and the answer they ruled on):** the 3× tripwire compared two **page totals over different CONSTRUCTION METHODS** — measured 2026-09-23 through the isolated page worker: the **derived** operand (`demo/path-fork-data.html`, `method=placement`) holds **23 REAL NODES** and produces **4095 path-states/wires** by **ONE bootstrap enumeration pass** (`passes=1`, 1 render, 0 handlers, 0 flush yields, `compile=33.1ms`), page total **168.6ms**; the **runtime** operand (`demo/fork-stress-d12.html`) holds **4095 REAL NODES** built **INCREMENTALLY** through the four layer mechanisms (`new Node(...)` per node; 10 renders, 137 handlers, 11 flush yields, `pass2=700.7ms` + `compile=469.8ms`), page total **1367.8ms**. So the cross-family ratio (~8.1× post-R1) measured the **construction-path difference, not engine scaling**, and the 3× bound — calibrated on a **derived-vs-derived** ~1.0× reading (`SMOKE-TRIPWIRE-INERT`) — could never be met honestly. **THE RULING:** the guard becomes **runtime-vs-runtime** (the same page family timed against itself at two depths), so a super-linear per-node regression is caught without the construction-method confound. **WHAT LANDED (one file + the trackers; NO `src/**`, NO test file, NO demo page, NO other bound):** `scripts/demo-smoke.mjs` — (1) the new **`runtime-fork-growth-guard`** (in `KNOWN_GUARD_IDS`; the `guard-exit-audit` registry check passes at 27 call sites / 27 ids): the runtime **`fork-stress-d10.html` (1023 nodes) → `fork-stress-d12.html` (4095 nodes, ×4)**, both ALREADY smoke-run by `runtime-fork-stress-census` (no new page, no new depth; **d14 stays built-but-not-smoke-run**); **statistic = the PASS-2 ratio** (the most stable AND most sensitive candidate — **±1.5%** across repeats vs **±3.0%** for the page total and **±4.6%** per-node); **bound = 10×**, **margin 1.30×** over the measured envelope **6.07-7.70×**; a breach NAMES the meaning (*per-node pass-2 cost is degrading super-linearly* — the O(n²)-era ~20×/depth signature reads **≈105×** and a ×4 per-node degradation **≈26×**, both far above the bound, so the teeth are intact); (2) its printed envelope every run — `[runtime-fork:growth] STATISTIC=pass2-ratio (most stable: ±1.5% over repeats; the total ratio spreads ±3.0%) — d10 nodes=1023 pass2=111.4ms total=179.8ms → d12 nodes=4095 pass2=687.9ms total=1316.1ms = pass2-ratio 6.18× / total-ratio 7.32× over 4× the nodes (per-node 1.54×); bound 10×; margin 1.62×`; (3) the retired cross-family measurement KEPT as an **INFORMATIONAL print only**, with both sets' composition IN the line: `[runtime-fork:tripwire] INFORMATIONAL (construction-cost ratio, NOT a like-workload metric — no longer asserted): … 4095 real nodes, built INCREMENTALLY: 10 renders, 137 handlers, 11 flush yields, pass2≈687.9ms + compile≈455.9ms … vs placement-derived baseline 153.6ms [23 real nodes → 4095 path-states/wires by ONE bootstrap enumeration pass: passes=1, 1 render, 0 handlers, 0 flush yields, compile≈33.1ms] = 8.57× …`. **FALSIFIABILITY DEMONSTRATED (both arms):** the guard's assertion is a PURE function (`assertRuntimeForkGrowth`) sliced out of the harness and driven in isolation — the honest curve PASSES (6.18× / 6.61×), a **×4-per-node breach reads 16.00× and FAILS**, the **O(n²)-era breach reads 105.16× and FAILS**, and **an absent baseline on EITHER side FAILS loudly** (no silent pass); additionally `PP_SMOKE_FAULT=runtime-fork-growth-guard` drives the real harness to **exit 1 with every later guard still entering** (the §4 guarantee holds). **THE MEASUREMENT TABLE (isolated worker, each depth TWICE — `[fork-stress:profile]`):** d8 49.0/44.5ms · d9 87.2/88.3ms · d10 177.1/179.5ms · d11 461.7/484.8ms · d12 1356.4/1319.5ms totals (pass2 24.3/21.8 · 55.8/56.4 · 105.9/112.4 · 264.3/277.1 · 699.6/682.4ms) ⇒ adjacent-pair pass-2 ratios 2.30/2.59 · 1.90/1.96 · 2.50/2.46 · **6.61/6.07** (d10 → d12), per-node 1.64× at d10 → d12. **TRACKERS UPDATED IN THE SAME PASS:** `docs/decisions.md` — NEW ACTIVE row **RUNTIME-FORK-GROWTH-GUARD** (the ruling, the operand-composition facts, the measured envelope, the statistic + bound + margin, and the explicit consequence that the smoke's only failing guard is retired ⇒ `npm run demo:smoke` is expected GREEN) and the old **RUNTIME-FORK-TRIPWIRE-BOUND** row marked **⚠ SUPERSEDED 2026-09-23 by it** (KEPT, annotated, never deleted); `docs/defects.md` — **RUNTIME-FORK-PASS2-RATIO CLOSED as a MIS-SCOPED COMPARISON** (the "defect" was the comparison, R1's ≈258ms / 15.9% saving recorded as the real improvement; the KEPT row carries the still-open pass-2 residual + the R2/R3/R4/R5/R6 levers), **SMOKE-TRIPWIRE-INERT** annotated SUPERSEDED (its fix STANDS — it is what exposed the honest reading), and the NEW FIXED rows **RUNTIME-FORK-PASS2-RATIO-CLOSED** + **FORK-STRESS-TRIPWIRE-STALE-SPEC** (below); `docs/pending.md` — **PASS-2-BOUND-CHOICE**: **option B is MOOT** by the ruling, the live decision is now whether to pursue the remaining pass-2 work at all (R2/R3 + page levers R4/R5/R6) now that RED is not the signal; `AGENTS.md` item 4 — the tripwire paragraph rewritten around the **new** guard with the old `~2.1-2.7×` / re-baselining text marked **superseded history** (annotated, not silently rewritten). **TRIO:** `npm run typecheck` clean · `npm run build` clean · `npm run demo:smoke` **GREEN** (exit 0; 34 guard entries; the ONLY zero-failure run of the smoke since the 2026-09-22 repair) · `npm test` — phase A **1429 passed / 1 failed (81 files)**, phase B **7 passed / 5 failed (2 files)**, i.e. **6 STALE-CONTRACT test failures** (all of them assertions that encode the RETIRED tripwire contract: `tests/e2e/path-fork-e2e.test.ts:633`'s literal `'exceeds 3× the placement-derived baseline'`, `tests/unit/no-clone-guards.test.ts`'s `REQUIRED_GUARD_IDS` + `PP_SMOKE_FAULT` target naming the retired guard id, and `tests/unit/pass2-fit-reference-scope-measurement.test.ts`'s FRS-9a/9b/9c which parse the old line and require the guard to enter with `status:"fail"`), filed as **`docs/defects.md` FORK-STRESS-TRIPWIRE-STALE-SPEC** with the exact TestWriter re-point owed (the implementer holds the test wall and did NOT edit them; the harness/guard behaviour is CORRECT and the smoke is GREEN). **NO OTHER GUARD OR BOUND MOVED:** the derived per-region 2.5× pins, the derived in-family totals pin, the residual/coverage guards and the census guards (incl. shallow-census and the no-clone pins) are byte-unchanged; the isolated-subprocess discipline and the guard-entry log contract are unchanged; **the pass-2 residual work remains OPEN** (R2 gated-high-risk / R3 / R4 / R5 / R6).

> **✎ LANDED 2026-09-23 — `FD7-D2-LINK-TREEFROMOPS-CHECK` CLOSED (the `FD7-D2-LINK-CENSUS` closure's ONE REPORTED RESIDUAL) — the fork-stress path-enumeration conversion now has NO open item.** The d2/link page's OWN runner banner read **`9 passed, 1 failed`** inside the smoke while the guard's `[derived-fork:shallow-census:pagers]` line reported it; the prior pass had filed it as a SHIM/HARNESS INTERACTION on the strength of a standalone run believed to pass. **That filing was wrong, and the standalone evidence did not exist:** the cited command names `demo/path-fork-data-link-d2.html`, which is NOT a build output (the family ships no shallow HTML — the guard builds the shallow pages in memory), so it cannot have run as written. **Reproduced order-independently this pass:** the page built through `buildPathForkPage('link', 2)` and run in the ISOLATED worker (fresh process, fresh shim, no prior page) reads the SAME `9 passed, 1 failed`, same check — `treeFromOps: one root; full binary tree (2 children per non-leaf); 2 leaves at depth 1; 3 nodes total`, detail `leaf at depth 2, expected 1`. **CLASSIFICATION (a): a real page-check defect at d2/link — the SAME ruled stale-expectation class as the census** (the `element census` / per-level / DOM-level checks and the re-typed-count pin had been corrected; this one had not). **Root cause:** at d2/link the 4 DOCUMENTED def-fill children are children of the two level-1 def hosts (`src/core/render-helpers.ts:743-746`; contract `docs/specs/render.md:224` DFC-1), so `treeFromOps` yields ONE tree of **7 nodes = root → 2 hosts → 2 fills each, 4 leaves at depth 2**, while the check still demanded 3 nodes with every leaf at depth `familyLayers` (= 1). **Fix (`demo/path-fork-data.js`, expectation correction only — `src/**` UNTOUCHED):** the check derives its expectation from the RULED census (`familyElements = familyStates + the def-fill term`), and the def-fill arm additionally pins the deepest level to the DOCUMENTED fill WIRES — so it is **stronger** at the corrected point (the numerically identical DFC-1 phantom signature `2·(2^d − 1) + 1` = 7 cannot satisfy it) and **unchanged in substance** at every point where the term is 0. Falsifiability measured (perturbed fill-wire set in a scratch copy → the check FAILS with its new message). Decision row `docs/decisions.md` **DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION** is cross-referenced, not duplicated; defect row `docs/defects.md` **FD7-D2-LINK-TREEFROMOPS-CHECK** (FIXED).
> **Verified:** smoke `[derived-fork:shallow-census:pagers]` reads **0 failed for EVERY shallow page** (`link d2: … 10 passed, 0 failed` in place of `9 passed, 1 failed`; d2/d3 × three methods + link d12 all 0-failed), the `[derived-fork:shallow-census]` relation line still reads all-points-agree, the standalone worker reads `10 passed, 0 failed`, and the smoke's guard-failure line stays **`1 (runtime-fork-tripwire)`** with **35 guard entries** (the 3× tripwire is RED by ruling — no bound moved). `npm test` phase A **1387 passed / 0 failed (79 files)**, phase B **6 passed**, exit 0; `npm run typecheck` clean; `npm run build` clean; `git diff --stat src/` byte-identical (`6 files changed, 328 insertions(+), 26 deletions(-)`). **⚠ ERRATUM 2026-09-23 (release pass, 0.5.1): the smoke half of this reading is PRE-RETIREMENT** — the tripwire is retired as an assertion, so the smoke now reports **0 guard failures / exit 0** and the retired id is no longer a guard entry (it survives only as the INFORMATIONAL print); see the RELEASE PASS block at the head of this file. The `npm test` counts here are a **PRE-conversion** reading (later: 1430 / 0 failed, 81 files + phase B 12, attributed).
> **SECOND FINDING FIXED IN THE SAME PASS (harness race, classification (b)) — `MODE-TOGGLE-SETCOMPILEPASSLOGGING-RACE`:** one smoke run in three showed `smoke guard failures: 2 (runtime-fork-tripwire, demo-check-banner-census)` with `Mode toggle — markdown: 13 passed, 1 failed — setCompilePassLogging not exposed`. Mechanism (proven with a 9-line repro): the mode-toggle arms are imported WITHOUT awaiting their checks, and `derived-fork-shallow-census`'s end-of-guard hygiene deleted the **shared** `setCompilePassLogging` global (`demo/lib/feature-matrix-tests.js:33` installs it; `:538`'s `SSR-H2` reads it) — so a late-resuming markdown-arm check read an absent global. Fixed by restoring the pre-guard state instead of deleting another page's global (no assertion weakened; the shallow page's logging toggle is still turned back off). **RESIDUAL (open):** the mode-toggle arms are still not awaited to completion — the general hazard class (an un-awaited inline page's checks racing a later guard) remains, recorded here.
> **✎ LANDED 2026-09-23 — `FORK-STRESS-DATA-SHALLOW-LINK-STALE-EXPECTATIONS` CLOSED (FIXED): the RUNTIME data-driven family's three stale shallow expectations are corrected WITH the coverage that was missing.** The latent condition filed by the `FD7-D2-LINK-TREEFROMOPS-CHECK` pass is now fixed and OBSERVABLE: `demo/fork-stress-data.js` derives its element census as `2^depth − 1 + derivedDefFillChildlessCount(actionable)` — the term read off the SAME compiled path states the page emits (def host / CHILDLESS / UNCOVERED → its def's child count; helper at `:188`, use at `:394`), never a literal `7` — and the three sites follow it: the element census (`:494`), the re-typed pin (`:720`, `expectedElements − 3`) and `treeFromOps` (`:745-746`, leaf depth `familyLayers + 1` where the term is non-zero, with the deepest level pinned to the DOCUMENTED fill WIRES so the numerically identical DFC-1 phantom `2·(2^d − 1) + 1` = 7 cannot satisfy it). **MEASURED BEFORE → AFTER (d2/link, built through `buildForkStressDataPage(2, 'link')` and run through the shim): `7 passed, 3 failed` → `10 passed, 0 failed`** (the d3/link control was and stays `10 passed, 0 failed`; derived term 0 from d3 — the level-1 hosts own real children). **THE NEW COVERAGE (the whole point — the defect was latent because nothing ran the path):** NEW `tests/unit/fork-stress-data-shallow-link.test.ts` (3 cases) builds d2/d3 `link` pages with the REAL builder, runs the REAL page module through the shared smoke shim, and asserts the page's OWN banner (`0 failed`) + published census (`states`/`elements`/`registered`) + check TITLES against a relation re-derived INDEPENDENTLY from the page's own envelope. **COVERAGE CHOICE (recorded):** in-process page mounts in a parallel-phase unit file, NOT shallow pages added to the smoke — the pages are 3/7-element builds (the smoke's isolated subprocess-per-page discipline exists for the 4095-element d12 pages) and the smoke is therefore NOT touched; the new file spawns no smoke, so it is deliberately NOT in `SMOKE_SPAWNING_TEST_FILES` (that list is for files spawning `scripts/demo-smoke.mjs` or an equivalently heavy worker harness). **FALSIFIABILITY (demonstrated, scratch copies deleted):** reverting the three page sites to the stale forms in a scratch copy reproduces `7 passed, 3 failed` with the same three details; perturbing the test's OWN derivation (every def host treated as covered) fails the new file 3/3 (`element census: 3 elements` vs the received `element census: 7 elements (3 path-states + 4 def-fill)`; `defFill` 0 vs 4). **Verified:** `npm test` phase A **1390 passed / 0 failed (80 files)**, phase B **6 passed**, exit 0; `npm run typecheck` clean; `npm run build` clean; `git diff --stat src/` byte-identical (`6 files changed, 328 insertions(+), 26 deletions(-)`); the smoke below is unchanged (guard-failure line tripwire-only). `src/**` UNTOUCHED, no bound moved, **NO engine question arises** (the engine stays CLOSED by the ruling).

> **✎ LANDED 2026-09-23 — `FD7-D2-LINK-CENSUS` CLOSED as a CORRECTED STALE EXPECTATION (the ruling: the d2/link extra 4 elements are the **documented behaviour** of the standalone P-EMIT-3 def-fill branch, **NOT an engine defect**) — the last open condition of the DATA-DRIVEN-FAMILY conversion.** The relation is now stated AND pinned where the census is derived: **`elements = 2^depth − 1` for every (depth, method) EXCEPT `d2/link = 7 = 3 path-states + 4 synthetic def-fill children`**, measured on BOTH families (static + data-driven, independently) at d2/d3/d4/d6/d12 x placement/values/link — the ONLY deviation at any swept point is the d2/link term.
> **Mechanism (cited):** the level-1 def hosts' path-states are CHILDLESS at d2, so the covered-CHILDLESS gate does not fire for them and the standalone P-EMIT-3 def-fill pushes their `<wire>:a`/`:b` children — `src/core/render-helpers.ts:743-746` (gate rationale `:733-742`; contract `docs/specs/render.md:224` DFC-1 / DEFECT #21; *"a NON-covered childless host keeps the standalone fill"*). From `d >= 3` those hosts have real children (the re-typed def-chain elements), the fill is bounded, and the census is exactly `2^depth − 1`.
> **What changed (expectations only — `src/**` UNTOUCHED, `git diff --stat src/` byte-identical to the pass start):** `demo/path-fork-data.js` (module-header relation + the new exported `derivedDefFillChildlessCount(method, depth)` helper derived from the family's OWN envelope, never a magic 4; `pathForkServerData(...).expected.elements`/`.defFill`; the page's element/per-level/DOM-level census checks; a NEW in-page **d2/link def-fill shape pin** that distinguishes the documented boundary from the numerically IDENTICAL DFC-1 phantom signature `2x(2^d − 1) + 1` = 7 at d2), `scripts/path-fork-page.mjs`, `demo/path-fork-data.template.html`, and a NEW smoke guard **`derived-fork-shallow-census`** (registered in `KNOWN_GUARD_IDS`) which sweeps d2/d3 x three methods + a d12 builder control against the relation and pins the d2/link shape — the regression protection that closes the "the d12-only `static-path-census` never checked a shallow depth" blind spot.
> **Coverage note (recorded):** the shallow arm runs against the same envelope+builder pipeline the static pages embed, NOT a browser page — the static family ships NO shallow pages (the smoke's `derivedForkPages` is the d12 trio and d14 is built-but-not-run by design, AGENTS.md item 4), so generating d2/d3 pages would mean a new isolated page worker per variant for a 3-element page. What is left uncovered: a DomAdapter-level shallow run; the in-page d2/link pin covers the page-side shape claim.
  **✎ CORRECTION 2026-09-23 (`FD7-D2-LINK-TREEFROMOPS-CHECK` pass):** the guard NOW MOUNTS THE REAL SHALLOW PAGES — `runShallowPage` builds each (depth, method) page with `buildPathForkPage`, seeds it into the live shim and imports the page MODULE, whose own checks run and are read from its runner banner (that is how the d2/link page-side defect this pass fixed was visible at all). So the coverage claim above is stale in both directions: the shallow arm is NOT limited to the builder pipeline, and the DomAdapter-level shallow run IS covered (in-process, not in an isolated worker — the remaining gap is the subprocess heap discipline, irrelevant at 3-7 elements, and any d14-scale probe).
> **Verified:** `npm test` phase A **1387 passed / 0 failed (79 files)**, phase B **6 passed**, exit 0; the p3 red set **24/24 GREEN** (the test-writer pass re-pointed FD-7's static arm in parallel — it hard-coded `2 ** depth - 1` on BOTH sides, which is why the builder correction alone could not flip it) and the guards suite **6/6 GREEN**; `assertStaticPathCensus` / `assertForkStressCensus` / every bound untouched (the 3x tripwire stays RED by ruling). Decision row: `docs/decisions.md` **DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION**; defect row moved to FIXED. **The engine question is CLOSED by ruling — do not reopen.**

> **✎ LANDED 2026-09-23 — the DATA-DRIVEN-FAMILY PATH-ENUMERATION conversion (user ruling 2026-09-22; contract `docs/specs/fork-stress-data-p3.md`; decision row `docs/decisions.md` `DATA-DRIVEN-FAMILY-PATH-ENUMERATION`).** The data-driven fork-stress family no longer clones: **`demo/fork-stress-data.js` now enumerates paths** over the R2.2 sibling-shared owner-name topology — **d12 = 23 nodes / 4095 path-states / 4095 elements / `cloneOps = 0` / `passes = 1`** for all three methods (d14 = 27 / 16383), **MEASURED** from the registry + the page's own journal (never a literal), with the node half of the pin (`registered = inTree = 2·depth − 1`) asserted beside the clone half. The `handlers` declaration, the `stress:handler` prop, the handler-body installation, the kick-off `clone-instance` ops, the pass-2 drain and the `createClient` import are DELETED; `scripts/fork-stress-data-page.mjs` no longer embeds any compiled census expectation; `scripts/demo-smoke.mjs`'s `assertForkStressCensus` derives `2·depth − 1` / `0`, REQUIRES the published `journalCloneOps` (no silent fallback) and KEEPS the `registered = inTree + unplaced + destroyed` identity; every §8.2 site is re-pointed and **no bound moved**. **Full smoke: every `fork-stress-data` page reports 9-10 passed / 0 failed at every depth (2..12) and for all three methods; `fork-stress-census`, `fork-stress-variant-census`, `static-path-census`, `legacy-shape-census` and `demo-check-banner-census` all PASS; the ONLY failure is the pre-existing user-ruled `runtime-fork-tripwire` (10.53-10.72× vs the unraised 3×).** The converted family's own d12 totals fell from 334-377ms to **94.5-142.4ms** (its pass-2 region and all 4094 handler executions are gone) — the conversion's contribution to the `PASS-2-RUNTIME-FORK-SCALING` unit: **one contributor retired; the runtime page itself is untouched and still 10.5-10.7×**. Tests: `fork-stress-data-p3-guards` 6/6 GREEN, `fork-stress-data` 5/5 GREEN, `no-clone-invariants` 16/16 GREEN, `no-clone-guards` 6/6 GREEN (smoke-ops phase), `path-fork-e2e` 14/14 GREEN. **TWO CONDITIONS THE CONVERSION DISCOVERED ARE OPEN and filed in `docs/defects.md`: `FD7-D2-LINK-CENSUS`** (the `link` element census is `2^d − 1` only for `d ≥ 3` — BOTH families read 7 at d2, so FD-7's `d2/link` equality needs a gate ruling; options: engine gate change / spec+builder expectation correction / narrowing the FD-7 depth set) **and `INJECTED-CLONE-PRIORITY`** (the mandatory injected-clone falsifier's attach priority encodes a clone-era empty-root invariant — a one-line test-side re-point, reported not edited). No `src/**` change, no bound change, no version bump.

> **✎ LANDED 2026-09-22 (no-clone-enforcement pass) — the NO-CLONE-ENFORCEMENT unit's harness/demo half: the smoke's census guards are now REACHABLE and MEASURED.** What changed (3 files + 2 trackers; **no `src/**`, no test file, no bound**): **(1) §4 guard ordering** — `scripts/demo-smoke.mjs` now wraps every guard in `runGuard(id, body)`, printing an ordered entry line `[smoke-guard:enter] {"id","index","status"}` (the `index` is on the OUTPUT-LINE scale — the entry's own position in the counted output stream plus a documented uniform margin that absorbs the harness's own un-counted worker lines, measured at ≤ 15 on this pass — so the reachability suite can compare it against the tripwire marker's line index) and a `[smoke-guard:fail] <id>` marker on failure; **the shape is (a) run every census/assertion guard before the exit-capable tripwire + (b) one aggregated exit at the end** (`guardAggregateExit()` — non-zero iff any guard failed). The page-worker loops record a failure and CONTINUE rather than exiting; the worker's stdout/stderr are piped and re-emitted through the counted sink (worker `maxBuffer` raised), so every printed line is on the same line scale as the marker. **The legacy-shape census — the harness's ONLY component-family clone census, previously unreachable on any tripwire-firing run — now RUNS AND REPORTS every run**: `[legacy-shape:profile] … warningsMain=0 fanOut=2 stylesRules=6 census(registered=17 inTree=14 unplaced=0 destroyed=0 prototypes=3 cloneOps=0 journalCloneOps=0 journal=0) …` (every pinned value HOLDS). **(2) §3 I5 census measurement** — `demo/path-fork-data.js` + `demo/legacy-shape.js` + `demo/fork-stress-data.js` now MEASURE `PROFILE.cloneOps` from their own supervisor's journal (`journalEntries`, counting `clone-instance` entries) instead of assigning a literal or computing the arithmetic identity, with the window-completeness guard failing loudly on a truncated window and PAGING where the journal exceeds the accessor's `[1, 1000]` clamp (fork-stress-data d9+: 1021 entries; d12: 4094 clone ops / 8189 journal entries — a single window would have under-counted). The pages publish `cloneOps=… journalCloneOps=… measuredCloneOps=… journal=…` on their census lines, and the harness guard `assertForkStressCensus` compares the census field against a journal-derived count (published measurement, else the harness's own `2^depth − 2` topology derivation), replacing the former tautology. Measured: d12 → `cloneOps=4094 journalCloneOps=4094 measuredCloneOps=4094 journal=8189`; derived-fork (3 methods) + legacy-shape → `cloneOps=0 journalCloneOps=0 journal=0`. **(3) THE NEW RUN SHAPE** — `npm run demo:smoke` runs all 19 guards to completion and then exits **1 at the runtime tripwire (10.1-10.7× vs the UNCHANGED 3× bound; RED BY RULING** — `docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND), printing `smoke guard failures: 1 (runtime-fork-tripwire) — every guard still ran and reported`. **The pass-2 unit above is therefore unchanged and still the next queued item**; what this pass adds is that a tripwire failure no longer hides the later censuses. Tests: `tests/unit/no-clone-guards.test.ts` (NC-2a..NC-2d GREEN) + `tests/unit/no-clone-invariants.test.ts` (P-TP-1p GREEN); full suite **1360 passing / 0 failing**; typecheck + build clean. Records: `docs/decisions.md` **NO-CLONE-ENFORCEMENT**, `docs/defects.md` **SMOKE-GUARD-UNREACHABLE** + **CLONE-CENSUS-NON-MEASUREMENT** (both FIXED).

> **✎ CORRECTION 2026-09-22 (SMOKE-NOCLONE-AUDIT-2026-09-22, finding 5) — "the fork-stress `cloneOps` guard becomes a real comparison" is FALSE as written.** The page published `PROFILE.journalCloneOps = PROFILE.cloneOps` (an ALIAS), so the harness's `prof.cloneOps !== journalCloneOps` comparison was **`x !== x`** on a real page and could NEVER fire; the harness's topology derivation (`2^depth − 2`) was dead code behind a `typeof` guard the page always satisfied. The note above reports the pass as complete on the strength of that comparison. The comparison is now genuine: `PROFILE.cloneOps` comes from the paged whole-journal READ, `PROFILE.journalCloneOps` from a **separate per-kind journal walk** (`journalKindCensus`, published with its full `cloneOpKinds` tally), the page ASSERTS the two sources agree, and the harness additionally asserts the harness-side topology `2^depth − 2` against them as a second source (demonstrated FAILING on fabricated disagreements — see the audit row). The fork-stress clone count remains DERIVED, never a literal pin, so NO bound moved.

### ✅ DONE 2026-09-22 — the NO-CLONE-ENFORCEMENT unit (user-approved 2026-09-22): machine enforcement of the no-cloning invariant + the two harness defects that hid it

| Work unit | What LANDED | Where |
| --- | --- | --- |
| **NO-CLONE-ENFORCEMENT — the invariant-enforcement unit: I1..I5 machine-enforced on the placement/component/fork-arm families, the §3-I5 census MEASUREMENT, the §4 guard ordering, the enforcement adversarial audit (FAIL → all 8 must-fix closed) and the gate-8 doc review — ✅ **DONE-with-open-smoke** (the code/test/harness work is COMPLETE and every gate through doc-review is closed; the validation trio is NOT uniformly green **because the smoke is RED at the tripwire BY THE USER'S RULING**, `docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND — and the enforcement's own guarantee holds: **all guards run and report**) | **THE INVARIANT TABLE (what is now machine-enforced; owner `docs/specs/no-clone-invariants.md` §3, rule text `docs/specs/ops.md:87-88`).** **I1 — a placement attaches the ORIGINAL node by link (DECIDED)** → enforced by `tests/unit/no-clone-invariants.test.ts` **NC-1a** + register row **P-IM-1** (`HELD`): zero registry growth across the translate mint / `placement-attach` / an idempotent re-attach, ONE shared Link object per zone name over ≥2 producers, ordered `content` anchors, anchor `owner === ` the authored node. **I2 — one node, many paths: the WIRE carries the multiplicity (DECIDED)** → **NC-1b** (d=6: 11 distinct `nodeId`s over 63 path-states; registry flat after `compilePath`/`emitElements`/`diffMinimal`) + **NC-1c** (a fork arm is `nodeId#<i>` over ONE node; no arm wire in the registry) + **P-IM-2** (`HELD`; placement arm `d ∈ [3,6]` after the vacuity correction). **I3 — a component is resolution + seam, never a copy (DECIDED)** → **NC-1d** (3 consumers of one def: 1 def-root object, 2 def-children, seam edges on the SAME def-root object, registry + prototype OBJECT identities flat across compile→emit→diff→apply) + **P-IM-3** (`HELD`); the `'prototype'`-STATE count is explicitly NOT asserted (measured 3 → 0 — the DEFECT #24 SEAM-RESOLVED CARRIERS realization). **I4 — `clone()` is reachable ONLY from the handler `clone-instance` route (DECIDED)** → **NC-1e** + **P-IM-4** (`HELD`): a `vi.spyOn(Node.prototype,'clone')` records ZERO calls across the placement / component / def-fill pipelines and **exactly `ops`** calls on BOTH handler call sites, with the positive control MANDATORY in the same test body (a zero control reports `UNDETERMINED`, never `HELD`). **I5 — the clone census is a MEASUREMENT, not a constant (DECIDED)** → **NC-1f / NC-1f-prod / NC-1g** + page-side **P-TP-1p** + register rows **P-TP-1**/**P-TP-2** (`HELD`): `PROFILE.cloneOps` is derived from the page's OWN journal, and a SECOND, independent per-kind walk must agree. **THE TEST COUNTS (red → green):** RED = the five harness/page-coupled cases the spec shipped expected-red (**NC-2a, NC-2b, NC-2c, NC-2d, P-SM-1** — landed RED against the pre-fix harness: the unreachable census, the tautological guard, the alias, the missing P-SM-1 report line); GREEN = **all five**, with the engine-side NC-1 suite designed GREEN (a regression guard on a measured-intact invariant — a red there is a DEFECT discovery, never a licence to patch `src/**`). **Suite arithmetic: 1340 → 1362 passing / 0 failing; 76 → 78 files** (+2 new suite files: `no-clone-invariants.test.ts` 17 cases, `no-clone-guards.test.ts` 5 cases) — **measured by the supervisor 2026-09-22.** **THE REGISTER RESULT:** **all SEVEN rows `HELD`** — `P-IM-1`..`P-IM-4`, `P-TP-1`, `P-TP-2` (engine-side, in `no-clone-invariants.test.ts`) + `P-SM-1` (harness-side, in `no-clone-guards.test.ts`) — pinned seed **20260922**, **362 attempts ≤ the 400 budget** (6×60 + P-SM-1's 4-arm allowance), no row `UNDETERMINED`, every row's liveness note **row-scoped** (the pooling defect closed). **THE ADVERSARIAL PASS/FAIL HISTORY:** the enforcement harness/demo pass returned **FAIL with 8 must-fix findings (F1..F8)** + the operational set **H8/H10/H11/H15** — F1 (78 raw `process.exit` sites survived the "aggregated exit" claim), F2 (`runGuard` returned an unhandled promise), F3 (the fault-injection control was vacuous — it injected the guard that fails naturally), F4 (`GUARD_INDEX_MARGIN = 1000` made the anti-vacuity clause unfalsifiable), F5 (**the journal "second source" was an ALIAS**), F6 (a missing baseline yielded `ratio = 0` — the 2.5× guard silently PASSED), F7 (bypassable throw paths), F8 (no guard demonstrated able to fail) — **ALL CLOSED 2026-09-22 in the same pass** (F3 closed-by-demonstration with one test-design follow-up reported): one `process.exit` call site left (`:247`, inside `aggregateExitHardFail`) plus the new `guard-exit-audit` self-check that reads the harness's own source every run; a real `try/catch/finally` `runGuard`; a validated single-shot fault seam targeting a **naturally-passing** guard; the margin REMOVED; the alias replaced by a genuine independent-source comparison; missing baselines failing LOUDLY; throw paths routed through `guardLeaveFailed`; demonstrations for every guard. Verdicts: **"no bound moved" CONFIRMED**; **"no guard weakened" REFORMULATED** — true only after the F5 repair, which made the clause *stronger* than the spec demanded (see the new archive record below). **THE TWO AUDIT-DRIVEN SPEC CORRECTIONS + THE FOUR §8.6 AMENDMENTS:** the spec's §3 I3 NC-1d form (the `'prototype'`-STATE count is EXPECTED to move — registry size + prototype OBJECT identity are the asserted observables), the P-TP-2 cross-expression relation (`− (2d − 2)`), the P-IM-2 `d ≥ 3` floor (d=2 is vacuous) and NC-1a's producer/consumer requirement — **four §8.6 log rows**; plus the two gate-8 corrections (the **false approval-audit citation** and the **`except at d ≥ 12` calibration wording**, see below). **THE TRIO:** `npm test` **1362 passed / 0 failed (78 files)**, `npm run typecheck` **clean**, `npm run build` **clean**, `npm run demo:smoke` **RED at the tripwire by the ruling** (exit 1; **34 guard entries, exactly ONE failing — `runtime-fork-tripwire`, 10.44× vs the unraised 3× bound**; `guard-exit-audit` passes) — **with the enforcement's own guarantee stated: all 34 guards RUN and REPORT their measurements, including the legacy-shape census that was previously unreachable** (§4 acceptance criterion 1 satisfied; a red smoke is the ruling, an unrun guard is not). **THE RCA SUMMARY:** the rule was **never overwritten** — its text is intact since **`6d0a2ec`** (exactly ONE `-S` revision), the clone-based placement path was removed at **`5e8be50`** (2026-08-14, 107 files, +11526/−658), and the invariant is **machine-enforced now**; the **perceived "cloning during placement"** is NOT placement cloning — it is the **fork-stress-data page's HANDLER-driven `clone-instance` expansion** (`demo/fork-stress-data.js:251-254`, two ops per non-leaf ⇒ `2^d − 2` clones at depth d), which is the SANCTIONED use `docs/specs/ops.md:88` reserves the op for, and it is exactly why `cloneOps` legitimately reports 4094 at d12 while the static/derived pages report 0. | `docs/specs/no-clone-invariants.md` (the contract + §8.6 amendment log), `tests/unit/no-clone-invariants.test.ts` + `tests/unit/no-clone-guards.test.ts` (NEW), `scripts/demo-smoke.mjs` + `demo/{path-fork-data,legacy-shape,fork-stress-data}.js`, `docs/decisions.md` (NO-CLONE-ENFORCEMENT + NO-CLONE-HARNESS-OPS), `docs/defects.md` (SMOKE-GUARD-UNREACHABLE + CLONE-CENSUS-NON-MEASUREMENT FIXED; SMOKE-NOCLONE-AUDIT-2026-09-22; PRODUCING-HOST-CENSUS), `docs/skills/designing-pages.md` §11 + §2 (the author-facing NO-CLONING rule); archive: `archive/reviews/2026-09-22/2026-09-22-noclone-enforcement-adversarial.md` (**post-hoc persisted reconstruction** of the in-context audit) + `2026-09-22-noclone-doc-review.md` |

**OPEN ITEMS CARRIED OUT OF THIS UNIT (the circle-back list; nothing below blocks the next unit):**

1. **The PASS-2 PERF UNIT — the next queued work item** (`docs/next-steps.md` §"PASS-2-RUNTIME-FORK-SCALING", `docs/defects.md` RUNTIME-FORK-PASS2-RATIO): attribute and remove (or justify) the runtime d12 pass-2 super-linearity (~84 % of a total that is 9.45-10.50× the derived baseline against the **unraised 3×**). **The tripwire's RED is this unit's evidence, not its blocker.** **✎ DIAGNOSED 2026-09-23 (the unit's starting evidence; probe report `archive/reviews/2026-09-23/2026-09-23-pass2-amplification-diagnosis.md`):** the attribution is DONE — one focused compile per dirty node over its **ancestor chain** (5-13 nodes at d12; `focusedSliceFor`), **12.4× redundancy** at d12, and the cost sits in **resolution** (`fitReference`'s unbounded descendant scan: 411.0ms of the 426.5ms `get children`) + **slice construction** (325.6ms) — NOT the per-node compile (~28ms). **No single contract-clean fix greens the tripwire** (the clean set lands ~4.3-6×), so the exit is a **BOUND CHOICE**: the HIGH-risk gated R2 (three-agent gate) **or** a measurement-justified re-baseline (a user ruling) — `docs/pending.md` **PASS-2-BOUND-CHOICE**; full block in the unit row's `✎ DIAGNOSED 2026-09-23` section. **✎ LANDED 2026-09-23: R1 IS IMPLEMENTED** — `fitReference`'s descendant scan is slice-scoped (`src/core/resolve.ts:229-238`; decision row `docs/decisions.md` `PASS2-FIT-REFERENCE-SLICE-SCOPE`, contract `docs/specs/pass2-fit-reference-scope.md` §1 ✎ LANDED), measured saving **≈258 ms = 15.9%** (d12 total **1622.2 → 1363.9 ms**; printed tripwire **9.65× → 8.11× / 8.05×**; [supervisor 2026-09-23] confirming run 8.11× = 1367.8/168.6 ms) — **materially below the report's 420-480 ms upper bound** (profile attribution only). The residual is **≈8.1×** and the tripwire **stays RED by ruling** (3× unraised; **no bound moved**); **R2 remains ungated**; **the next action is the USER'S bound decision** (`docs/pending.md` PASS-2-BOUND-CHOICE, options A/B/C). Full block below.
2. **`R-W4-1`** (a `bodyRuns` `{ child }` ref cannot name a component fork arm's base node — documented limitation, workaround in `docs/skills/designing-pages.md` §2) and **`R-W4-5`** (the C4 diagnostic dedup is PROCESS-level, so a second document can be silently denied a diagnostic) — both parked with revisit conditions in `docs/pending.md`; **`R-A1`** (a conservative-but-unreachable engine guard, `docs/specs/bodyruns-drop-diagnostics.md` residual).
3. **The `ops.md` §2.4 wording RECOMMENDATION** (spec §0.3): narrowing bullet 3's "component-instantiation" against a future misreading — **semantics-preserving, one sentence, NO contract change**; it **requires a user/gate decision** and was deliberately NOT applied (`ops.md:87` is a landed, gated clause with exactly one revision). Read the two bullets together (§0.3) until then.
4. **The RELEASE PASS (0.5.1) — ✎ IN FLIGHT 2026-09-23 (the scribe pass is DONE; the supervisor's bump/commit/tag/publish remains): see the `✎ RELEASE PASS (0.5.1) — IN FLIGHT` block at the head of this file.** The `docs/releases.md` 0.5.1 row + the `docs/decisions.md` `RELEASE-0.5.1` row are WRITTEN (contents **by reference**; tag/commit/date **`PENDING (filled at commit time)`**); the version bump + `package.json` + the commit/tag/publish per the AGENTS.md item-12 landing duty (`package.json` still reads `0.5.0`), plus the outstanding 0.4.1/0.5.0 `UNTAGGED`/`UNVERIFIED` provenance debt (**carried as its own item**, not resolved by 0.5.1). **NOT blocked by the smoke**: `prepublishOnly` is `npm test && npm run typecheck`; the smoke is not in the publish gate and there is no CI config in the repo — **and the smoke is now GREEN anyway** (the RED clause was retired by the 2026-09-23 guard ruling, `docs/decisions.md` `RUNTIME-FORK-GROWTH-GUARD`).
5. **`PRODUCING-HOST-CENSUS` (RE-FILED 2026-09-22 with its correct mechanism; OPEN)**: `Supervisor.allNodes()` is **per-supervisor** and each of the producing-host page's 5 mounts builds its own — so a per-mount census pin is structurally blind to what the mounts share (the shared **hub** + the **Link-keyed def-prototype registry**, which makes a second mount REUSE the first's prototype nodes). **The re-filed row carries a two-mount test proposal** as its closure shape (two mounts of one envelope asserting the shared prototype identity while each supervisor's own `allNodes()` counts only its own registration). **Design/coverage item, NOT an engine defect.**
6. **The PROCESS-HARDENING rows (the RCA's remediation, R1/R3/R4/R5)** — **PARKED-BUT-READY in `docs/pending.md`**, recorded by the gate-8 pass because **the user approved only the enforcement-test half of the RCA remediation**; each row carries its revisit condition. **R2 is not parked: it is the `guard-exit-audit` harness rule, which is IMPLEMENTED** (see the parked table in `docs/pending.md`).
7. **One reported test-design follow-up from the enforcement audit (F3) that the unit did NOT close:** NC-2b's own fault arm injected `runtime-fork-tripwire` (a guard that failed naturally on every run, so the injection was not provably effective) — the harness note says as much at `scripts/demo-smoke.mjs:210-215`. **✎ CLOSED 2026-09-23 (release pass, by source read): the arm now injects the naturally-PASSING `runtime-fork-growth-guard`** — evidence read in the tree by the 2026-09-23 doc housekeeping pass: `tests/unit/no-clone-guards.test.ts:146` (`const SCALING_GUARD_ID = 'runtime-fork-growth-guard'`), consumed at `:268` (`env: { ...process.env, PP_SMOKE_FAULT: SCALING_GUARD_ID }`) and `:922` (`[smoke-guard:seam] TEST SEAM ACTIVE — PP_SMOKE_FAULT=runtime-fork-growth-guard injected into guard "runtime-fork-growth-guard"`), with the entry-log requirement at `:382-388` and `:503-506`; the retired `runtime-fork-tripwire` is **no longer a guard id at all** (an unknown id is a hard startup failure — `scripts/demo-smoke.mjs:332-337`), so the old arm could not even run as written. **The audit's requirement — "the seam's demonstration target must be a naturally-PASSING guard" — is now SATISFIED: the growth guard passes naturally (smoke exit 0, 0 failures). The item is discharged; no test work is outstanding here.**
8. **The audit's H8 FLAKE — ✅ CLOSED 2026-09-23 (test-phase isolation).** The smoke-spawning unit file no longer runs inside the parallel test phase: `npm test` is now two sequential Vitest phases (`vitest.config.ts` = the parallel unit phase, excluding `SMOKE_SPAWNING_TEST_FILES`; `vitest.smoke.config.ts` = the serialised smoke-ops phase, `fileParallelism: false`). **No case skipped, no env gate, no assertion/bound/window changed** — the same 6 cases still run and still fail `npm test`, so the enforcement stays in CI. **Diagnosis (measured, not inherited):** the smoke's page-level guards are load-coupled (fork-family d9-d12 page totals inflate 2.2-2.5× under CPU contention; the harness's profile-residual guard then fails and surfaces as a GUARD-REACHABILITY assertion failure), and `npm test` ran the smoke alongside 23-26 node processes while the serialised phase runs it with 3-4. **Pre/post:** post-fix plain `npm test` 5/5 green + 3/3 green on the final re-run; under induced load (24 burners + a concurrent full unit phase) pre-fix 3/5 runs exited 1 and post-fix 2/5 — in BOTH designs the failing case is the same **non-smoke** timing test (`tests/unit/render.test.ts` ORD-P1), with every smoke-spawning case passing in every post-fix run. Records: `docs/defects.md` `FLAKE-NOCLONE-SMOKE-IN-PARALLEL` (FIXED), `docs/decisions.md` `NO-CLONE-TEST-PHASE-ISOLATION` + the amended `NO-CLONE-HARNESS-OPS`. **RESIDUAL (bookmarked, NOT fixed here):** (a) the smoke's `PAGE_WAIT_MS` cannot bound the fork-family pages at all (their `done` globals resolve synchronously — measured: a 1 ms window still yields a complete d12 profile), and (b) the load-sensitive timing assertion in `render.test.ts` ORD-P1 is outside this unit's scope and remains reachable by **external** machine load — both filed for whoever owns the perf work.
>
> **✎ OPENED 2026-09-22 (this pass) — THE NEXT UNIT: `PASS-2-RUNTIME-FORK-SCALING`
> (the runtime d12 pass-2 cost the repaired tripwire exposed), and the RELEASE PASS
> (0.5.1) queued as its own item.**
>
> **1. THE PASS-2 PERF UNIT — the next queued work item.**
> - **OBJECTIVE:** attribute and remove (or justify) the runtime `fork-stress-d12.html`
>   pass-2 super-linearity — i.e. the ≈84% pass-2 share of a runtime total that sits
>   **9.45-10.50×** the placement-derived baseline against an **unraised 3×** bound —
>   so that the repaired tripwire either passes honestly or its bound is re-baselined
>   **BY MEASUREMENT** (a separate user decision).
> - **EVIDENCE (all measured, 2026-09-22; defect row `docs/defects.md`
>   RUNTIME-FORK-PASS2-RATIO` carries the full derivation):** four consecutive
>   repair-pass readings **9.45× / 9.88× / 10.44× / 10.50×** (runtime
>   1525.7-1589.9ms vs derived 146.2-163.5ms — **stable, never near 3× ⇒ not flaky**);
>   the **runtime d12 decomposition** `load=1.0 compile=83-88 emit=37-39 diff=12-13
>   apply=9-11 pass2=1295-1326` ⇒ **pass2 ≈84% of the runtime total**, with
>   `warningsMain=0` and every derived-fork per-region pin **inside** the 2.5× (values
>   1.08/1.11/1.12×, link 1.75/0.96/0.46×); and the **per-depth growth** d8 → d12
>   **23.0 → 64.3 → 144.6 → 390.1 → 1332.0ms ≈ 2.2-3.4×/depth** (super-linear). The
>   owning lead — `docs/pending.md`'s 2026-08-20 **RUNTIME FORK-STAGE-12 pass2 SCALING
>   LEAD** (runtime d12 1772.6ms, pass2 1424.2ms ≈80%, derived baseline 225.3ms,
>   `~7.9×`) — was **confirmed by the repaired tripwire** and is **owned by this unit**.
> - **FIRST STEP (SHARPENED 2026-09-22 by the node-count measurement pass — the
>   hypothesis below is FALSIFIABLE and is the actual starting point; the ORIGINAL
>   "characterize the super-linearity from scratch" framing is SUPERSEDED).**
>   **HYPOTHESIS TO FALSIFY:** the dominant cost is **per-visit WORK inside the
>   focused recompile** — each minted parent's flush cascade appears to **recompile
>   large slabs of the cumulative graph** — and **NOT** graph node count, duplicate
>   nodes, leaked nodes, or visits-count growth. **Test per-visit COST vs visits
>   count.** The measured support for it (full tables in the defect row
>   `docs/defects.md` RUNTIME-FORK-PASS2-RATIO §"✎ MEASURED 2026-09-22"):
>   **(i) the graph is EXACT** — d12 = **4 095** graph nodes (`2^12 − 1`) = **4 096**
>   registered/live nodes at the last level boundary, **4 094** appends, the page's own
>   layer assertion (`layer k has exactly 2^k nodes`; `all.length === 4095`) plus the
>   rendered-element-count and DOM-nesting checks all **pass**, and `appends = nodes − 1`
>   at every depth ⇒ **the node count is NOT the cause**; **(ii) `work/node` rises
>   ~3.3× from d8 to d12 while `visits/node` rises only ~1.4×** (compile-pass census
>   visits/node **9.9 → 12.7 → 14.3** at d8/d10/d12, passes **253 (252 focused) / 1 150
>   (1 149) / 4 224 (4 223)**, node-visits **2 523 / 12 987 / 58 427**, max single pass
>   **256 / 1 024 / 4 096**; **no single-node pass exists**, a pass focused on one deep
>   leaf lists **515** nodes, the largest covers **all 4096**); **(iii)** the per-level
>   cumulative `supervisor.pass2WorkMs()` boundary series (live nodes → cumulative →
>   delta) `32 → 3.2 → 3.2 · 64 → 5.9 → 2.7 · 128 → 13.9 → 8.0 · 256 → 25.2 → 11.3 ·
>   512 → 69.7 → 44.5 · 1 024 → 166.8 → 97.1 · 2 048 → 420.6 → 253.8 · 4 096 → 1 371.7
>   → **951.1**` puts **≈1.37s of the 1.63s total (≈84%) in the last two levels**, with
>   `pass2` growing ≈1.5-1.6× per level against a **2×** node growth at the last level
>   (super-linear per node, linear-ish per level-transition).
> - **MEASUREMENT METHOD (the measured protocol — reuse it, and REVERT the
>   instrumentation after use).** Run the runtime page **`demo/fork-stress-d12.html`
>   ALONE through `scripts/smoke-page-worker.mjs`** at **several depths (8/10/12 as
>   measured)** with **`setCompilePassLogging(true)`** on (the engine prints one
>   `[compile] pass over N node(s)` line per compile pass — `src/core/debug.ts`, exported
>   from `src/index.ts`), plus the **TEMPORARY per-level `supervisor.pass2WorkMs()`
>   boundary instrumentation** (`src/core/supervisor.ts:594`) that reads the cumulative
>   pass-2 time at each level boundary. **THE INSTRUMENTATION MUST BE REVERTED AFTER USE
>   — as it was on 2026-09-22: `demo/fork-stress.js` was temporarily instrumented and
>   reverted byte-identical, and no demo change remains.** The engine-side census
>   (`setCompilePassLogging`) is a SUPPORTED public debug switch — no reversion needed
>   for that half. Keep the isolated-subprocess discipline (`scripts/smoke-page-worker.mjs`)
>   so the page's ~50MB+ frame does not stack frames into a GC storm. **The page profiler
>   does NOT time pass-2** (`archive/reviews/2026-08-15/2026-08-15-session-defect-review.md`,
>   fork-stress-data section) — hence the `pass2WorkMs()` boundary probe. Compare the
>   per-generation recompiled-node SET (which nodes each focused pass lists) and the
>   per-generation flush count between this page and the derived page at the same depth,
>   and at d14 (the manual browser probes); the 2026-08-20 lead's revisit questions 1-3
>   (`docs/pending.md`) remain the checklist, incl. the engine-work-vs-scheduler split
>   (`work:1428.2` vs `flush:1428.9` ⇒ the wall is ENGINE work, not scheduler idle).
> - **EXIT CRITERION:** a **clean runtime:derived reading** that either **sits under a
>   defensible bound** (the pass-2 cost attributed and removed/contained — the tripwire
>   then passes with the bound UNCHANGED) **or justifies a re-baselined one BY
>   MEASUREMENT** (the honest curve + its per-depth shape, with the re-baseline taken as
>   an explicit user decision per `docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND). No
>   third exit: a silent edit to the bound or to the guard is **forbidden**.
> - **NOT IN SCOPE:** raising the 3× bound, re-baselining it inside this unit, or
>   weakening/annotating-away the tripwire. The red smoke is a **deliberate signal**.
>
> **✎ MEASURED 2026-09-22 (node-count / pass-census pass — the unit's STARTING EVIDENCE;
> full tables in the defect row `docs/defects.md` RUNTIME-FORK-PASS2-RATIO, appended
> section "✎ MEASURED 2026-09-22").** So the next unit starts from **node counts**
> instead of the aggregate ratio: **(1) the GRAPH IS EXACT — the node count is NOT the
> cause** (d8/d10/d12 → graph nodes **255 / 1 023 / 4 095** = `2^depth − 1`; live
> REGISTERED at the last level boundary **256 / 1 024 / 4 096**; appends — the emitted
> elements — **254 / 1 022 / 4 094**; `appends = nodes − 1`; the page's own layer
> assertion (`layer k has exactly 2^k nodes`; total incl. root = `2^depth − 1`,
> `all.length === 4095` at d12), the rendered-element-count check and the DOM-nesting
> check all **pass** ⇒ **no duplicate, leaked or inflated node growth**; registered/live
> nodes and emitted elements are recorded distinctly — they are **not** the same number);
> **(2) pass-2 per level** (the d12 cumulative `supervisor.pass2WorkMs()` boundary
> series, live → cumulative → delta): `32 → 3.2 → 3.2 · 64 → 5.9 → 2.7 · 128 → 13.9 →
> 8.0 · 256 → 25.2 → 11.3 · 512 → 69.7 → 44.5 · 1 024 → 166.8 → 97.1 · 2 048 → 420.6 →
> 253.8 · 4 096 → 1 371.7 → **951.1**` ⇒ **≈1.37s of the 1.63s total (≈84%) is engine
> pass-2, concentrated in the LAST TWO levels (2048 parents at the final level)**;
> **(3) the compile-pass census** (the engine `[compile] pass over N node(s)` lines;
> passes (focused) / node-visits / max single pass / visits per node): d8 `253 (252) /
> 2 523 / 256 / 9.9`, d10 `1 150 (1 149) / 12 987 / 1 024 / 12.7`, d12 `4 224 (4 223) /
> 58 427 / 4 096 / 14.3` — **no single-node pass exists**; a pass focused on one deep
> leaf lists **515** nodes; the largest covers **all 4096**; **(4) the falsifiable
> hypothesis this unit now owns:** the dominant term is **per-visit work inside the
> focused recompile** — each minted parent's flush cascade appears to recompile large
> slabs of the cumulative graph (`work/node` rises ~**3.3×** from d8 to d12 while
> `visits/node` rises only ~**1.4×**; `pass2` grows ~1.5-1.6× per level against a **2×**
> node growth at the last level). **Test per-visit COST vs visits count — NOT "the graph
> is too big".**
>
> **✎ NODE-COUNT FRAMING CORRECTED + FIRST STEP RE-SHARPENED (2026-09-22, pass-2
> evidence correction — this block and the §"✎ PASS-2 EVIDENCE CORRECTION (2026-09-22)"
> section of `archive/reviews/2026-09-22/2026-09-22-w4-doc-review.md` SUPERSEDE-IN-PART
> any reading of this unit's evidence as "the comparison side is a tiny graph").**
> **THE CORRECTED FACT — the two pages at d12 are the SAME-SIZED graph:** runtime
> `fork-stress-d12.html` **4 095 nodes** (`2^12 − 1`) / **4 096 registered** / 4 094
> appends; derived `fork-stress-data-placement-d12.html` (the tripwire's baseline page —
> ⛔ **CORRECTED 2026-09-23: this page label is FALSE. That page is the `d12Totals` family,
> never the tripwire's baseline; the baseline is `demo/path-fork-data.html` with
> `method=placement` — `scripts/demo-smoke.mjs:1049-1050` — whose census is
> `registered=23 inTree=23 cloneOps=0` over `states=4095 elements=4095`. See the
> ✎ CORRECTED 2026-09-23 block below.**)
> **4 095 nodes** / **registered = 4 117** (`2^d − 1 + prototypes.length` = 4 095 + 22 —
> the documented **F-13 re-pin**, `demo/fork-stress-data.js:417-421`, `:620`), i.e. the
> derived page's graph is the slightly LARGER one. The `registered=23` figure that had
> been read as "the comparison side" belongs to a **DIFFERENT page family** (the
> static/legacy-shape family's pinned 23-node d12 census `registered=23 inTree=23
> unplaced=0 cloneOps=0`, `scripts/demo-smoke.mjs:265`; the separate
> `demo/legacy-shape.html` page reads `registered=17 inTree=14 states=12 elements=16`,
> `scripts/demo-smoke.mjs:456-485`) — **not** to the derived fork page. ⛔ **CORRECTED
> 2026-09-23 — this attribution half is FALSE too:** the `registered=23` page **IS** the
> tripwire's baseline page (`demo/path-fork-data.html`, `method=placement`,
> `scripts/demo-smoke.mjs:1049-1050`); the `registered=4 117` page
> (`fork-stress-data-placement-d12.html`) is the one that is **not** the baseline (it is the
> `d12Totals` family — what the PRE-repair tripwire read). See the ✎ CORRECTED 2026-09-23
> block below.** **⇒ THE
> SHARPENED FIRST STEP (the now-STRONGER question this comparison raises):** **⛔ WITHDRAWN
> 2026-09-23 — the "region-sum baseline / ≈4.8×" reading in the paragraph below (and its
> "~1/5 the page time / ~1/6 the pass-2 time" restatement): the prior text is KEPT for the
> record and must NOT be read as evidence; the verified numbers are in the **✎ CORRECTED
> 2026-09-23** block immediately after it, and the unit's actual starting evidence is the
> **✎ DIAGNOSED 2026-09-23** block below.** **the
> derived page builds an equivalent-or-larger graph in ~1/5 the page time (335.2ms vs
> 1 614.9ms) and ~1/6 the pass-2 time (233.6ms vs 1 352.9ms) — so WHY does the runtime
> page's INCREMENTAL construction do ~58 000 node-visits (4 224 compile passes at d12)
> of recompile WORK for the SAME graph?** **⚠ A RUNTIME-VS-DERIVED RATIO IS A WEAK
> SIGNAL because it MIXES TWO CONSTRUCTION METHODS:** the derived page builds the graph
> in **ONE construction pass** (2 renders, `takePass2States()` over 12 flush levels); the
> runtime page builds it **incrementally, level by level** (`clientApply` per parent), so
> every level's flush cascade triggers focused recompiles (`compile` **1.4ms vs 87.4ms**;
> `renders` **2 vs 10**; `flush yields` **12 vs 11**; `handlers` **4 094** clone ops vs
> **137**). **SECOND INDEPENDENT REASON THE RATIO IS NOT A SCALING SIGNAL (recorded as
> measured; the unit settles it as its first measurement task):** the tripwire's
> **~10.5×** compares the **runtime PAGE TOTAL** against the smoke's recorded
> `[derived-fork:baseline]` value (146.7ms in the printing run), a baseline that is the
> derived page's **emit+diff+apply REGION-side quantity** — **not** its 335.2ms page
> total (which includes `load` + `compile` + `pass2` + `handlerMs`); **LIKE-FOR-LIKE
> PAGE-TOTAL at d12 is 1 614.9 / 335.2 ≈ 4.8×.** What the reviewer could verify
> statically: the guard's operands are `runtimeForkTotals[12]` (the runtime page's
> `PROFILE.totalMs`, from its own `tStart` — `demo/fork-stress.js:68`/`:595`) and
> `derivedBase[12].totalMs`, assigned `b.totalMs = prof.totalMs` and printed as
> `total=${prof.totalMs}` for the placement-derived page (`scripts/demo-smoke.mjs:336`,
> `:338`, `:390-394`; that page's `totalMs` also runs from its own `tStart` —
> `demo/fork-stress-data.js:176`/`:622`, with `coveredMs` summing all seven timed
> sections, `:624-626`) ⇒ **whether the recorded 146-149ms baseline is the derived page's
> TOTAL or only its region sum is the unit's FIRST MEASUREMENT QUESTION — recorded here
> as open, not as settled.** ⛔ **SETTLED 2026-09-23 — BOTH HALVES OF THE PARAGRAPH ABOVE
> (AND THE TWO PARAGRAPHS BEFORE IT) ARE WRONG; the corrected reading follows.**
>
> **✎ CORRECTED 2026-09-23 (measurement-claim correction — the "region-sum baseline / ≈4.8×
> / 335.2ms page" reading is WITHDRAWN; the supervisor's 2026-09-23 executed measurements,
> with the code anchors statically re-verified in the tree by this doc pass):**
> **(1) BOTH TRIPWIRE OPERANDS ARE PAGE TOTALS ⇒ the ~10.5× IS a LIKE-FOR-LIKE comparison.**
> `scripts/demo-smoke.mjs`'s `derivedForkPages` (`:1049-1051`) runs `demo/path-fork-data.html`
> with `method=placement` (d12), and the recorded baseline is that page's **`prof.totalMs`**:
> `b.totalMs = prof.totalMs` (`:1110`), printed on the `[derived-fork:baseline]` line as
> `total=${f(prof.totalMs)}ms` (`:1112`), and read back as `derivedBase[12].totalMs`
> (`:1612`) against `runtimeForkTotals[12]` (`:1611`). That page's `totalMs` is its own
> **page total** — `demo/path-fork-data.js:881` `PROFILE.totalMs = now() - tStart`, printed
> with `covered`/`total`/`unmeasured` at `:886-892` — **not a region sum and not an
> emit+diff+apply quantity.** Direct measurement through the isolated worker reads
> `[derived-fork:profile] method=placement states=4095 passes=1 elements=4095 …
> covered=161.7ms total=163.0ms unmeasured=1.3ms` — inside the smoke's printed
> **146.2-168.6ms** band. ⇒ **The sentence above that calls the baseline "the derived page's
> emit+diff+apply REGION-side quantity — NOT its 335.2ms page total" is FALSE and is
> WITHDRAWN, and with it the derived "LIKE-FOR-LIKE PAGE-TOTAL at d12 is 1 614.9 / 335.2 ≈
> 4.8×".** The ~10.5× reading *is* page-total-vs-page-total (e.g. 1594.9 / 168.4 = 9.47×,
> 1644.4 / 153.6 = 10.70×; the recorded band over four+ runs is 9.45-10.72×).
> **(2) THE 335.2ms FIGURE DESCRIBES A DIFFERENT PAGE.** It is the d12 total of
> `demo/fork-stress-data-placement-d12.html` — the **then-unconverted CLONE-ASSEMBLY**
> family (`registered=4117` = `2^d − 1 + prototypes.length` = 4 095 + 22, `cloneOps=4094`),
> i.e. the **`d12Totals`** family — which is **not** the tripwire's baseline: the smoke's
> `derivedForkPages` baseline entry is the **`path-fork-data`** page, whose own `server-data`
> pins `nodes=23, states=4095, elements=4095, cloneOps=0` (`demo/path-fork-data.html:53`;
> module `path-fork-data.js`, `:84`). `scripts/demo-smoke.mjs` contains **no reference to any
> `fork-stress-data-*-d12` page in the derived trio / baseline path** (`d12Totals` is a
> SEPARATE family — `:689-690`, `:877`, `:932` — and it is what the PRE-repair tripwire read,
> `:695-697`, which is how the wrong page's number entered this record). That family was
> converted to path enumeration on 2026-09-23 (`cloneOps = 0`), and its d12 totals are now
> **~95-142ms** (was 334-377ms) ⇒ neither the 335.2ms total nor the `registered=4117` census
> describes the tripwire's baseline side. **The baseline page publishes `passes=1`** (ONE
> bootstrap enumeration; `PROFILE.passes = PROFILE.compileCalls`, `demo/path-fork-data.js:879`)
> — the probe records **23 passes / 0 flushes / `pass2 = 0`** for it.
> **(3) WHAT REMAINS TRUE (and must not be lost):** both sides at d12 build the **SAME-SIZE
> graph** — **4095 nodes / 4095 elements** — by **DIFFERENT CONSTRUCTION METHODS** (the
> runtime page incrementally, level by level, `clientApply` per parent; the derived side by
> ONE bootstrap enumeration). So the ratio **is** a construction-method comparison — but the
> honest framing is **"same graph, same page-total metric, ~10.5× apart"**, NOT "a page total
> compared against a region sum".
> **(4) The "≈1/5 the page time / ≈1/6 the pass-2 time" claim is WITHDRAWN and RE-STATED on
> the correct operands:** the derived baseline page's **page total is ~150-165ms** and it
> performs **23 passes / 0 flushes** versus the runtime page's **4,224 compile passes**
> (4,217 pass-2 + 7 page-side) with `pass2 ≈ 84%` of a **~1.5-1.7s** total (measured runs
> 1,526-1,590ms). The honest statement is **"roughly an order of magnitude apart on the SAME
> metric, because the runtime page recompiles an ancestor chain once per dirty node while the
> derived page enumerates once"** — not "a fifth of the time".
> **(5) The derived-side counters quoted above (`compile 1.4ms`, `renders 2`, `handlers
> 4 094` clone ops, `takePass2States()` over 12 flush levels, `demo/fork-stress-data.js:176`/
> `:622`/`:624-626`, `demo-smoke.mjs:336`/`:338`/`:390-394`) are the WRONG PAGE FAMILY for the
> derived side** (they are the pre-conversion `fork-stress-data` family and/or stale line
> anchors — the live anchors are the `:1049-1112`/`:1611-1612` set above). Use the
> **✎ DIAGNOSED 2026-09-23** block below for the derived/runtime comparison. **Nothing is
> deleted: every prior figure above stays on the record, marked withdrawn.**
>
> **CANDIDATE DIRECTIONS:** **(a)** characterize the
> incremental construction path's **per-level recompile amplification** — what each
> focused pass actually recompiles, per level, in the runtime family (the direct route
> to the ~58 000 node-visits; in scope); **(b)** consider a **RUNTIME-VS-RUNTIME growth
> guard** — the SAME page family across depths, e.g. **time-per-node growth** — as the
> honest tripwire shape, **a PROPOSAL for the user's decision**: changing the guard's
> SHAPE is **NOT in this unit's scope** (the same rule that forbids editing the bound
> silently), so it is presented as a proposal with this measurement as its evidence,
> alongside the re-baseline decision (`docs/decisions.md`
> RUNTIME-FORK-TRIPWIRE-BOUND). **Method:** the runtime page alone through
> `scripts/smoke-page-worker.mjs` at depths 8/10/12 with `setCompilePassLogging(true)`,
> plus TEMPORARY per-level `pass2WorkMs()` boundary instrumentation in
> `demo/fork-stress.js` — **reverted byte-identical; no demo change remains**.
>
> **✎ DIAGNOSED 2026-09-23 — THE UNIT'S STARTING EVIDENCE (replaces the falsifiable-hypothesis
> framing above; the unit no longer starts from "characterize the super-linearity").**
> **Source:** the read-only probe report
> `archive/reviews/2026-09-23/2026-09-23-pass2-amplification-diagnosis.md` (probe agent,
> 2026-09-23; artifacts outside the repo, `dist/core` hash-identical before/after, no fix made)
> + the supervisor's 2026-09-23 executed measurements. **Attribution:** every number below is
> the report's/supervisor's **measurement**; this doc pass re-verified only the **code anchors**
> by reading the tree (no test, smoke or page run is claimed here).
> **(a) THE MECHANISM.** Passes = **one focused compile per dirty node**
> (`src/core/supervisor.ts:667-739`, the compile call at `:697`; an `attach` dirties the
> attached node only, so d12 issues **4,217 pass-2 compiles** — 4,224 passes including 7
> page-side, matching the recorded census exactly). Each pass's slice is the focused node's
> **whole ANCESTOR CHAIN** (`focusedSliceFor`, `src/core/supervisor.ts:51-90`): measured
> `sliceLen = ancestors + 1`, `descendants = 0` ⇒ **5-13 nodes at d12**. The shared prefix is
> therefore recompiled once per dirty node — `fs-root` and `fs-zone` appear in **all 4,217**
> passes.
> **(b) PER-LEVEL AT d12 (mechanism → parents → live nodes → Δpass-2 ms; probe §1):**
> `L4 handler 16 / 32 / 4.6 · L5 placement 32 / 64 / 4.2 · L6 values 64 / 128 / 7.9 ·
> L7 link 128 / 256 / 17.0 · L8 handler 256 / 512 / 59.1 · L9 placement 512 / 1,024 / 98.7 ·
> L10 values 1,024 / 2,048 / 311.2 · L11 link 2,048 / 4,096 / 1,087.7` (+3.5ms tail) —
> total **1,590.4ms** pass-2 (page `pass2Ms` 1,590.6; `work:` 1,816.2). **The last two levels
> carry 1,398.9ms = 88% of pass-2**, and per-pass cost grows with the tree standing at that
> moment (L11 link passes cost **40.8µs/visit** vs L7 link's 14.8µs/visit at a 256-node tree).
> **(c) PASS SIZES — MANY MEDIUM PASSES, NO LARGE SLABS** (probe §2, the d12 pass-2 histogram):
> `5:8 · 6:16 · 7:32 · 8:64 · 9:256 · 10:256 · 11:512 · 12:1024 · 13:2048 · 515:1` —
> **4,096 of 4,217 passes are 9-16 nodes** (2,048 of them the L11 chain). **Both previously
> censused "huge" passes are NOT flush passes, and the earlier characterisations are
> WITHDRAWN:** the **4,096** pass is the PAGE's own `recompileFocusedFor(rootNode)`
> (`demo/fork-stress.js:269-280`, page-side, counted in `PROFILE.compileMs`, not pass-2) and
> the **515** pass is the page's tail idempotency check re-dirtying **one SHALLOW handler
> parent** (its slice = 4 ancestors + itself + 510 descendants) — **not "a pass focused on one
> deep leaf"** (wrong twice: the focus is shallow, and 515 is a DESCENDANT count, not a chain).
> Page-side passes: `16 · 64 · 128 · 256 · 1024 · 2048 · 4096` (the L1-L3 seed + six whole-tree
> recompiles).
> **(d) REDUNDANCY 12.4× AT d12** (8.0 at d8, 11.2 at d10): **50,795** pass-2 visits over
> **4,096** distinct ids; **91.7% of visits are to non-focus nodes**; **54,203** state
> emissions, **48,339 (89.2%) repeating that node's previous signature byte-for-byte**;
> **2,327 of the 4,095 nodes never change state** after their first compile. Within ONE
> `runPass2AndFlush` the same 4,096 nodes are compiled **6.5×** over, with **2,047 of the
> 2,048 L11 passes re-walking the identical shared chain prefix**. Most of it is **redundant
> work, not inherent** — with the report's honest caveat: an identical output signature does
> not by itself prove a compile could be skipped (`compileLocal` rebuilds `pass1`,
> `materializeSeam` maintains seam links — both stateful side-effects).
> **(e) WHERE THE COST IS** (clean CPU profile, 1,760.7ms sampled; probe §4): `get children`
> **426.5ms (24.2%)** — **411.0ms of it called FROM `fitReference`** (`src/core/resolve.ts:205-229`,
> the **unbounded descendant scan** at `:214-220`, which walks each visited node's whole graph
> subtree although `viable ⊆ slice` by construction — `src/core/node.ts:1119-1160`) ⇒ with its
> share of `familyChildAnchors` (`src/core/node.ts:562`) + the sort, the resolution group is
> **~605ms ≈ 34%**; `focusedSliceFor` **325.6ms (18.5%, `src/core/supervisor.ts:51-90`)**;
> `fitReference` own body **144.9ms**; `familyChildAnchors` **114.8ms**; the W2 per-state dedup
> scan **87.4ms** (`src/core/events.ts`); `stateFrom` 74.4; `pathKeyFrom` 30.5.
> **`compileLocal` + `materializeSeam` together are only ~28ms** ⇒ **the per-node COMPILE is
> cheap; reference RESOLUTION and SLICE CONSTRUCTION are not.** Accessor counts at d12:
> `children` **6,487,419** · `parent` **1,057,566** (≈111 `children` + 18 `parent` calls per
> visit).
> **(f) PER-MECHANISM (probe §5):** **link 1,104.7ms (69%)**, values 319.1 (20%), placement
> 102.9 (6%), handler 63.7 (4%). The mechanism that "owns" a level matters less than two
> structural facts: pass count = the new-node count (2^k, doubling per level), and the
> **values/link levels install the `target` anchors that trigger the descendant scan**, so the
> levels AFTER them pay for it.
> **(g) RANKED CANDIDATES (probe §6; savings stated against the smoke's own runtime d12 total
> of ~1,526-1,590ms).** **R1** scope `fitReference`'s descendant scan to the compile slice
> (`src/core/resolve.ts:214-220`): **~420-480ms (27-31%)**, residual **~7.3×**, engine,
> LOW-MEDIUM risk — provably output-identical if the hit SEQUENCE is preserved (the slice is
> downward path-closed, `viable ⊆ slice`), needs a multi-provider ORDER pin + a resolve-scope
> spec note. **R2** per-generation dirty-set coalescing (compile the UNION of the dirty nodes'
> slices once per flush; `src/core/supervisor.ts:667-739`): oracle **948.4 → 105.7ms = 8.97×**
> (~45%, residual **~6×**), engine — **HIGH risk: a CONTRACT-SHAPE CHANGE** (it alters the
> documented pass-2 slice isolation, the `focusNodeId` warning scoping, per-node `state`
> emission, the supersession contract at `:699-703` and the handler-in-flush interplay at
> `:708`) ⇒ **spec + three-agent gate (AGENTS.md item 9) + TDD; do NOT land it silently.**
> **R3** cheapen slice construction (`src/core/supervisor.ts:51-90`; walk the chain through
> link anchors, skip the `pathHasTarget` build): ~150-270ms (10-17%). **R4** drop the page's
> never-subscribed `EventBridge` (`demo/fork-stress.js:84-85`): ~85-100ms (PAGE side; loses
> the page's event-stream coverage). **R5** gate the page's compile-pass logging
> (`demo/fork-stress.js:39` `setCompilePassLogging(true)` — 4,224 lines / 1.5MB per run):
> ~75-100ms (PAGE side; deletes the `[compile]` census from the smoke output unless re-enabled
> by a URL param). **R6** scope the page's whole-tree recompiles
> (`demo/fork-stress.js:269-280`): ≤90ms (PAGE side; partly re-fragments what R2 would
> coalesce). **R7** remove the handler double-cascade: ~20-25ms, **NOT recommended** (the
> `stressTick` apply IS the mechanism's trigger). **R8** re-baseline the bound BY MEASUREMENT
> (~12× greens it today; 11× is already too tight): the **teeth** cost, and a **USER RULING**
> (`docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND). **R9** accept: ~10.5×, smoke RED forever.
> **(h) THE CRITICAL STRATEGIC FINDING (recorded plainly): NO SINGLE CONTRACT-CLEAN FIX GREENS
> THE TRIPWIRE.** The measured ceiling of the contract-clean set is **R1+R3+R4+R5 ≈ 0.73-0.91s
> ≈ 5-6×** (still RED); adding R6 gives **≈4.3-5.5×** (still RED, and R6 partly undoes itself).
> Reaching the tripwire's `< 3 × ~150ms ≈ 450ms` **honestly** therefore requires the **gated
> R2** **or** a **re-baselined bound (a user ruling)** — i.e. the open choice is
> **`docs/pending.md` PASS-2-BOUND-CHOICE** (R2 needs a three-agent gate; re-baselining is the
> user's). The pipeline can plausibly be made **~2-3× cheaper without touching a contract**;
> the remaining ~2× is the incremental construction method itself, which is what the page
> exists to measure.
> **(i) THE RECOMMENDED PATH (probe §7): land R1 FIRST, then re-measure, then take the bound
> decision with the printed number in hand.** R1 is the only large lever that is provably
> output-preserving and needs no contract, bound or page-semantics change. Its landing needs:
> (1) the resolve-scope spec note ("resolution's descendant scan is scoped to the compile's
> viable set; semantics unchanged"); (2) a TDD red set — a multi-provider **hit-ORDER** pin, a
> case with a same-name provider in a DEEP NON-SLICE subtree proving it is not consulted, and a
> before/after `CompileResult` parity case; (3) the trio + a smoke re-run (still RED at the
> tripwire by ruling — the printed `[runtime-fork:tripwire]` runtime total is the measurement
> that matters: expect ~1.05-1.15s ≈ **7×**).
> **(j) WHAT THE PROBE DID NOT MEASURE (honest residuals, probe §8):** R1's saving is an
> **upper bound** from the profile (the change was not implemented — `fitReference` is
> module-local, unmonkey-patchable); R2's saving is an **oracle model** (one `compile(union)`
> per generation, without the real per-node state replacement / events / handler interplay),
> and its admissibility is a **contract question**, not a measurable one; accessor memoization
> was tried and measured **2.8× SLOWER** (an invalid A/B — the cache implementation dominated);
> the **d14 shape is unmeasured** (no browser in the probe session).
> **(k) ANCHOR VERIFICATION BY THIS PASS (read-only):** the report's code anchors resolve,
> with two drifts to use when citing: the page's tail idempotency check is now
> **`demo/fork-stress.js:559-576`** (the report cites `:583-590`; the mechanism is unchanged —
> `handlerParents[0]` re-dirtied via `clientAPI.apply(p.id, [{props.stressTick…}])`), and
> `get pathKey` is now **`src/core/node.ts:626`** (the report cites `:627`). `focusedSliceFor`
> (`supervisor.ts:51-90`), `runPass2AndFlush` (`:667-739`, compile at `:697`), `pass2WorkMs()`
> (`:594`), `fitReference` (`resolve.ts:205-229`, scan at `:214-220`), `familyChildAnchors`
> (`node.ts:562`), `get children` (`node.ts:584`), `recompileFocusedFor`
> (`demo/fork-stress.js:269-280`) and `setCompilePassLogging(true)` (`:39`) all resolve where
> cited.
>
> **✎ LANDED 2026-09-23 — R1 IS IMPLEMENTED (the recommended first lever); THE UNIT'S NEXT ACTION IS THE USER'S BOUND DECISION.**
> **WHAT LANDED.** `src/core/resolve.ts` ONLY — `fitReference`'s descendant arm is slice-scoped: a
> `sliceSet` built from the `slice` parameter (`:229-230`), the seed level bounded
> (`for (const c of node.children) if (sliceSet.has(c.id)) stack.push(c)`, `:233`) and the descent
> loop bounded the same way (`:237`); `children` is still read LIVE at walk time (`:236`). **No
> threading was owed** (the slice was already a parameter); **no new export, no memo, no
> `CompileResult` change, no cached child list.** **THE INVARIANT BASIS:** `viable ⊆ slice` holds
> unconditionally (it is what makes the ancestor arm safe) and the slice is **DESCENDANT-CLOSED
> under the `get children` relation the scan traverses** — **explicitly NOT "path-closed"** (it is
> not closed upward under `parent`; the provider sweep adds providers without their ancestors) —
> so `D_S(n) = D(n)` for `n ∈ S`, giving the **identical hit set AND hit ORDER** (the parity
> guarantee; a naive slice-array rewrite remains forbidden because it reorders hits). Contract +
> the landed record + the anchor corrections: `docs/specs/pass2-fit-reference-scope.md` §1 ✎ LANDED;
> decision row `docs/decisions.md` `PASS2-FIT-REFERENCE-SLICE-SCOPE`.
> **THE MEASURED TABLE (in → out; attributed — [supervisor 2026-09-23] runs + the implementer's
> like-for-like before/after re-measured on the SAME tree).**
>
> | Reading | before | after |
> | --- | --- | --- |
> | runtime fork-stress d12 page total | **1622.2 ms** | **1363.9 ms** (second run **1347.6 ms**) |
> | printed `[runtime-fork:tripwire]` ratio | **9.65×** | **8.11× / 8.05×** ([supervisor] confirming run **8.11×** = `1367.8 ms / 168.6 ms`) |
> | pass-2 saving | — | **≈258 ms = 15.9%** |
> | validation | — | `npm test` exit 0 (phase A **1430 passed / 0 failed, 81 files**; phase B **12 passed**), `typecheck` + `build` clean, smoke exit 1 with **exactly ONE** failing guard (the tripwire) and **all 35 guard entries running** — ✎ **2026-09-23 doc housekeeping: this cell is the PRE-RETIREMENT reading.** The live reading (supervisor-verified 2026-09-23) is phase A **1430 / 0 (81 files)** + phase B **13 passed**, and the smoke is **GREEN — exit 0, 34 guard entries, 0 failures** (the retired id is no longer a guard entry; the tripwire line survives as the INFORMATIONAL print). The phase-B count differs from this cell's **12** → use **13**; both readings are retained. |
>
> **⛔ THE RESIDUAL IS ≈8.1× AND THE TRIPWIRE STAYS RED BY RULING** (the 3× bound is **UNRAISED**;
> this unit does not resolve it and does not touch it). **R1's realised saving is MATERIALLY BELOW
> the diagnosis' 420-480 ms upper bound** — that bound was **profile attribution on the unfixed
> tree** (the report could not implement the change; `fitReference` is module-local), so R1 realised
> ~62% of it and the predicted ≈7.3× residual reads **≈8.1×**. **Treat every remaining report figure
> quoted below as an UPPER BOUND, not a measurement.**
> **THE REMAINING RANKED LEVERS (report §6; savings/risk quoted; ALL still OPEN).** **R2 —
> per-generation dirty-set coalescing** (compile the UNION of the dirty nodes' slices once per
> flush; `src/core/supervisor.ts:667-739`): oracle **948.4 → 105.7 ms = 8.97×** (~45% of the runtime
> total; residual **~6×** alone) — **HIGHEST RISK: a CONTRACT-SHAPE CHANGE** (the documented pass-2
> slice isolation, the `focusNodeId` warning scoping, per-node `state` emission, the supersession
> contract `:699-703`, the handler-in-flush interplay `:708`) ⇒ **spec + THREE-AGENT GATE (AGENTS.md
> item 9) + TDD; it must NOT land silently.** **R3 — cheapen slice construction**
> (`src/core/supervisor.ts:51-90`): ~150-270 ms (10-17%), engine. **R4 — drop the page's
> never-subscribed `EventBridge`** (`demo/fork-stress.js:84-85`): ~85-100 ms, PAGE side (loses the
> page's event-stream coverage). **R5 — gate the page's compile-pass logging** (`demo/fork-stress.js:39`
> `setCompilePassLogging(true)` — 4,224 lines / ~1.5 MB per run): ~90-100 ms, PAGE side (deletes the
> `[compile]` census from the smoke output unless re-enabled by a URL param). **R6 — scope the page's
> whole-tree recompiles** (`demo/fork-stress.js:269-280`): ≤90 ms, PAGE side (partly re-fragments what
> R2 would coalesce). **R7** (~20-25 ms, NOT recommended — the `stressTick` apply IS the mechanism's
> trigger) and **R9** (accept ~10.5× forever) stand as recorded; **R8** is the bound re-baseline
> (~12× greens it today, 11× is already too tight) — a **USER RULING**, not a unit action.
> **⛔ THE NEXT ACTION IS THE USER'S, NOT THE UNIT'S: `docs/pending.md` PASS-2-BOUND-CHOICE.**
> Option **A** = gate R2 (spec + three-agent gate); option **B** = re-baseline the 3× bound **BY
> MEASUREMENT** (~12× greens it; the guard loses its teeth); option **C** = accept RED with the
> guard's teeth intact — and the **contract-clean page-side levers R4/R5/R6 (~85-100 / ~90-100 / ≤90 ms)
> can be landed before the decision is taken**. **No third exit:** a silent edit to the bound or to
> the guard stays forbidden (`docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND).
>
> **2. THE RELEASE PASS (queued as its own item).** The **0.5.1** version bump +
> `package.json` + the **`docs/releases.md` row** for that version, per the AGENTS.md
> **item-12 release-provenance landing duty** (tag, full 40-char commit, commit date,
> contents **by reference**, owning gate-record path). **It is NOT blocked by the smoke
> red:** the publish gate is **`prepublishOnly: npm test && npm run typecheck`** — the
> smoke is **not in the publish gate**, there is **no `.github/` and no CI config in the
> repo**, and `npm test` reads **1340 / 0** with typecheck clean. The pass also owns the
> outstanding `docs/releases.md` provenance debt (0.4.1 / 0.5.0 `UNTAGGED`/`UNVERIFIED`)
> and the **0.5.1-vs-fold-into-0.5.0** decision (0.5.0 is itself still `UNTAGGED`).


**Handover state (2026-09-22, end of the A+ pass + its adversarial audit + its
gate-8 documentation review).** The approved scope was **A + A+**
(`docs/specs/ur-2026-09-17-review.md` §6 — "RECOMMENDATION — scope A, plus item
A+"; the user's go-ahead is recorded in that gate record and in
`docs/specs/bodyruns-drop-diagnostics.md` §"User rulings"). The exact dependency
order the gate record prescribes (`:287-306`) is **W1 → W2 → W3 → A+ → W4 → W5**;
what follows records what that order produced. **Everything up to and including
A+ is DONE; only W4 (implementation) remains in this workstream.** The complete
record of the A+ unit's findings + dispositions is the **DONE row in the table
below**, and the full gate-8 reconciliation is
`archive/reviews/2026-09-22/2026-09-22-ur-doc-review.md`.

| Work unit | What LANDED | Where |
| --- | --- | --- |
| **W4 — the UR-3(b) IMPLEMENTATION GATE: the emit-boundary drop diagnostic + the N1 containment clamp + the N2 `text`-children clause + the W5 test-side re-point + the BLIND-GREENS set + the W4 landing audit + the GATE-8 DOC REVIEW — ✅ **DONE-with-open-smoke** (recorded 2026-09-22 by the gate-8 closeout pass under the user's ruling; the earlier `DONE / LANDED` wording is **SUPERSEDED** — the code work is complete and all gates through doc-review are closed, **but the validation trio is NOT uniformly green**)** | **Red → green, in order.** **RED (pre-W4):** `npm test` = **1310 passing / 9 failing**, all 9 in `tests/unit/bodyruns-drop-diagnostics.test.ts` (A+1, A+2, A+2b, A+3, A+4, A+4b, P-IM-1, P-IM-2, P-SM-1, P-IM-4). **W4 (the implementation)** landed `src/core/render-helpers.ts` ONLY — the C3 `console.warn` catalogue (`bodyruns-child-unresolved` / `bodyruns-child-duplicate` / `text-node-children-ignored`), the C4 module-level signature dedup, the C2 `childOrder` containment clamp, the C1 step order with the recorded def-fill-synthetic exception, the C5 drop criterion — suite **1314 / 5** (5 of 9 red cases GREEN; A+7a flipped GREEN→RED **by contract**; 4 register rows RED for ORACLE reasons, `docs/defects.md` ORACLE-1..4). **W5 (the test-side oracle re-point)** fixed those five failures **without touching `src/**`** (spec §1.1 row **W5-1** + §9.5(a)): suite **1319 passing / 0 failing**, the red-set file **22/22 GREEN**, all seven register rows **`HELD`**. **BLIND GREENS +21 → 1340 passing / 0 failing** (`tests/unit/bodyruns-drop-diagnostics-greens.test.ts`). **REGISTER OUTCOME: all seven rows `HELD`, 400 attempts** (`P-IM-1 attempts=100 failures=0 positiveHalfLiveAttempts=100`; `P-IM-2 HELD fresh.length=1 perPass[0]=1`; `P-SM-1 attempts=40`; `P-IM-3 attempts=60`; `P-TP-1 attempts=50`; `P-IM-4 attempts=25` + its control 25 — §9.5(a) quotes the executed report verbatim). **ADVERSARIAL (AGENTS.md item 11):** `archive/reviews/2026-09-22/2026-09-22-w4-adversarial.md` — verdict **PASS-WITH-FINDINGS: 1 must-fix + 1 must-record + 4 low/INFO**. **CLOSURE (all six, this gate-8 pass):** **1** (MUST-FIX — the stale §7/§9.1 clause→code citations): **CLOSED** — every `render-helpers.ts` anchor in the spec was **re-derived by reading the CURRENT file** (the W4 pass shifted the file ~70-90 lines: resolver `:167-218`→**`:206-305`**, single call site `:668`→**`:755`**, index `:598-613`→**`:693-700`**, def registrations `:905-913`/`:955-966`→**`:995-1000`/`:1048-1053`**, `text` branch `:1155-1162`→**`:1242-1275`**, drop `:208-212`→**`:286-299`**, clamp `:196-203`→**`:246-285`** with `contained` `:249` + `childWires` `:216`, local map + dup count `:178-187`/`:184`→**`:221-233`/`:228`**) and §7 now carries the pre-W4 → W4 map plus a `✎ RE-ANCHORED 2026-09-22 (W4 audit finding 1)` note; the rest-of-spec / `RENDER_PROCESS_NOTES.md` sweep is done (see the doc-review record's re-anchoring table); **2** (the synthetic-precedence branch's duplicate-diagnostic exception): **CLOSED** — §3 C3's trigger restated as "≥ 2 **RESOLVABLE** `childOrder` wires", §3 C2's exception **scoped** (fires only where the local map is structurally blind; **NOT** a general defeat of the local-first pin), A+6b's **warn count pinned as a regression guard in §8.1** (0 diagnostics — the spec owns the requirement, and **no oracle edit was made**), and the warn-on-the-synthetic-branch alternative **recorded as an open choice** with its consequence; **3** (MUST-RECORD — the C4 dedup's cross-document effect): **CLOSED** — residual **R-W4-5** ("one warn per `(code, wire, id)` per PROCESS, never per document" + the memory shape + the host expectation) added to **§9.6b**, the **§3 C4 hazard block**, the **§9.8** row, the new **`docs/decisions.md` BODYRUNS-DIAGNOSTIC-DEDUP-SCOPE** row, the **`docs/defects.md` R-W4-5** row, the **`docs/pending.md`** park with its revisit condition, and the author-facing trap in `docs/skills/designing-pages.md` §2 — **behaviour is spec-permitted: observability/documentation debt, NOT a code bug**; **4** (defect **N4**): **CLOSED** — `tests/unit/bodyruns-wire-ref.test.ts`'s `:69` case renamed to "…is DROPPED **and** warns" and **strengthened** with the missing `bodyruns-child-unresolved` warning assertion (spy + `afterEach` restore; the drop expectation unchanged; no other case touched); **5** (hardening): **CLOSED** — **§8.4** states invariants **H1** (`PROCESS_LEVEL_SIGNATURES_FROM_EARLIER_CASES` is a hand-maintained mirror — the ORACLE-2 class) and **H2** (A+7b's exact count depends on suite-level wire uniqueness), and the oracle file carries the matching header invariant comment; **6**: **CLOSED** — §9.4's A+7a/A+7b-suppression rationale is marked **W4-REVISION ONLY** (obsolete under a shuffled order since W5 gave A+7b its own wire/id pair); **R-W4-1** (audit recommendation): **CLOSED** — the explicit-arm-wire workaround is now in `docs/skills/designing-pages.md` §2 (trap (1)). **BLIND-GREENS RESULT (gate 5) — ✅ PASS: 21/21 cases authored from the DOCS ONLY, independently confirmed** (`tests/unit/bodyruns-drop-diagnostics-greens.test.ts`, authored 2026-09-23 by an agent that read neither `src/**` nor the two landed oracle files; each case cites its `doc:` line and uses its **own** element wire/id so the C4 process-level set cannot couple it). **A genuinely INDEPENDENT greens set now exists, so GATE 5 IS SATISFIED BY IT — no justification is needed any more** (the A+ unit's "satisfied by construction" note is **SUPERSEDED** and kept only for provenance). **DOC-REVIEW:** this pass — `archive/reviews/2026-09-22/2026-09-22-w4-doc-review.md` (the re-anchoring table, the per-finding dispositions, the re-derivable counts). **TRIO:** `npm test` **1340 passing / 0 failing** (76 files; W5 1319 + 21 blind greens), `npm run typecheck` clean, `npm run build` clean; `npm run demo:smoke` — **`warningsMain=0`** and the derived-fork per-region pins inside the asserted **2.5×**, **BUT see the harness caveat in the row above** (the runtime 3× tripwire was structurally inert until the parallel repair and now reads **9.4-10.4×**, i.e. it FAILS; the 3× bound is a supervisor/user decision, deliberately NOT re-baselined — the **derived-fork pins and `warningsMain` are unaffected, and this landing is not implicated**). **OPEN after this pass:** **(a) the RELEASE pass** — the **0.5.1** bump + the `docs/releases.md` row (0.5.0 is still `UNTAGGED`, so the release pass decides whether W4/W5 ship as 0.5.1 on top of it or fold in) — §9's header + residual `R-W4-4`; **(b) R-W4-1** (the fork-arm base-node ref; parked, author workaround documented), **R-W4-5** (the process-level dedup; parked, host expectation documented) and **R-A1** (the `:234` empty-map bail's dead half); **(c) defect `SMOKE-TRIPWIRE-INERT`** (row above) — **cross-referenced, NOT fixed by this unit**; **(d)** the four parallel-repair items **ORACLE-1..4 / W4-A+7A-REPOINT / N4** are already FIXED (their rows are retained as the defect record) | `docs/specs/bodyruns-drop-diagnostics.md` §1.1 (rows **W4-1/W4-2/W5-1/G8-W4**) + §9 (§9.1 clause→code map, §9.2 templates, §9.3 the choice, §9.4 the flip, §9.5/§9.5(a) the oracle record, **§9.6b R-W4-5**, §9.8 residuals) + §8.4 invariants; `archive/reviews/2026-09-22/2026-09-22-w4-adversarial.md`; `archive/reviews/2026-09-22/2026-09-22-w4-doc-review.md`; `docs/defects.md` FIXED BODYRUNS-DROP-DIAGNOSTICS (N1/N2/N3) + FIXED BODYRUNS-DROP-ORACLE (W5: ORACLE-1..4 + W4-A+7A-REPOINT) + **N4 CLOSED** + OPEN SMOKE-TRIPWIRE-INERT / **R-W4-5** / W4-SPEC-1; `docs/decisions.md` BODYRUNS-DROP-DIAGNOSTICS + **BODYRUNS-DIAGNOSTIC-DEDUP-SCOPE**; `docs/pending.md` **R-W4-1**, **R-W4-5**; `docs/skills/designing-pages.md` §2 + §11; `RENDER_PROCESS_NOTES.md` §10.10 (the W4 DECIDED entries + the residual list + the smoke-harness correction) |
| **SMOKE-TRIPWIRE-INERT — AGENTS.md item-4 runtime 3× tripwire repaired (harness measurement fix; 2026-09-22, this pass)** | The tripwire read `d12Totals['placement']` — the **derived** `fork-stress-data-placement-d12` page's total, the runtime page's profile being discarded (`demo-smoke.mjs:116-119`), so it compared derived-vs-derived (~1.0×) while claiming runtime-vs-derived, and the runtime blow-up signature it exists to catch was unguarded. **FIX:** `runtimeForkTotals[RUNTIME_FORK_TRIPWIRE_DEPTH = 12]` captured from the runtime loop (distinct variable; `d12Totals` left to the derived family and its unchanged 2.5× guard) + an unconditional `[runtime-fork:tripwire]` print of runtime total / derived baseline / ratio + a failure message carrying both totals and the ratio. `scripts/demo-smoke.mjs` only (+33/−2); `src/**`, every test file, `scripts/build-demo.mjs` and `scripts/smoke-page-worker.mjs` untouched; isolated-subprocess discipline preserved; no guard weakened or removed. **READING (3 runs): 9.45× (1544.6/163.5), 9.88× (1589.9/161.0), 10.44× (1525.7/146.2)** — against the 3× bound, so `demo:smoke` now **exits 1 at the tripwire** by design (pre-fix, the same honest reading printed `total=1590.4ms` vs `160.0ms` = 9.94× with **no** tripwire firing). The bound was **not** raised; the derived pins still pass (values 1.05-1.16/1.00-1.58/1.10-1.24×, link 1.61-2.03/0.89-1.13/0.41-0.49× vs 2.5× across the captured runs), `warningsMain=0`, all pages/banners green (verified via a report-only copy), `npm test` **1340 passing / 0 failing** (76 files), `typecheck` + `build` clean. **⚠ OPEN DECISION (supervisor):** the 3× bound's calibration evidence (`~2.1-2.7×`) was a derived-vs-derived number and does not reproduce; the honest runtime:derived curve is 9.4-10.4× at d12 with pass2 at ~84% of the runtime total scaling ≈2.2-3.4×/depth (the 2026-08-20 lead, `docs/pending.md:45`). Re-baselining the bound — or treating the pass-2 cost as the defect to fix — is a supervisor/user call with this measurement as the evidence; the smoke stays red until it is made. | `scripts/demo-smoke.mjs:116-131` + `:390-397`; `docs/defects.md` OPEN row **SMOKE-TRIPWIRE-INERT** |
| **W1 — UR-5 provenance** | **`docs/releases.md` (NEW, INDEX-ONLY)** — one row per version 0.2.0 / 0.3.0 / 0.3.1 / 0.3.2 / 0.4.0 / 0.4.1 / 0.5.0 with tag (or `UNTAGGED`), commit (or `UNVERIFIED`), date, contents **by reference**, owning gate record; the **verification-status block** states why `v0.4.1`/`v0.5.0` are `UNTAGGED`/`UNVERIFIED` (zero tag objects in this clone; local `main` ahead of `origin`) and asserts **no date** for them. `AGENTS.md` **item 12** corrected (**N8** — the cited `.github/workflows/publish-prerelease.yml` does not exist; `.github/` removed at the 0.2.0 flip) **and** gained the **release-provenance landing duty**. `docs/decisions.md` NPM-PACKAGING row gained the cross-ref. | `docs/releases.md`, `AGENTS.md` item 12, `docs/decisions.md` (NPM-PACKAGING) |
| **W2 — UR-2 the versioned ruling** | **`docs/decisions.md` gained the `BODYRUNS-REMOVABILITY` row** — branch **(b)**: deprecated-but-present through `0.3.x`/`0.4.x`/`0.5.x`, **REMOVED at the 1.0.0 major** (`Y.X.X` per VERSIONING-SCHEME); the CONTENT-XOR-CHILDREN row is marked **⚠ SUPERSEDED-IN-PART** (its "no removal" PROCEED clause, its D3 removal tail and its D2 "no wire-less bare-text node" tail) — **annotated, nothing deleted**. `docs/specs/content-xor-children-review.md` amended **IN PREMISE ONLY** (§2 premise + its PARK row annotated; §3 and §6 untouched). `docs/specs/eng-inline-order.md` §9b status text updated. The shipped `bodyruns-deprecated` warn (`src/core/translate.ts:962-964`) **STANDS — `src/**` untouched** (AC-15). | `docs/decisions.md`, `docs/specs/content-xor-children-review.md`, `docs/specs/eng-inline-order.md` §9b |
| **W3 — UR-1 the fold + denial retirement** | The 0.4.0 BARE-TEXT-EMIT contract folded into the BEHAVIOUR specs: **`docs/specs/adapters.md`** (§3.1 step 0 for `type === 'text'`; §3.2 Text-owner rows; §3.2's silent-filter note; §4.1 `isText`/`isVoid`; §4.3 `childHtml` `isText` branch; §4.4 the `isText`-excluded void rule + the `text`-root consequence; §6 new **SSR-F5** divergence row; §10.1 **DOM-H31**, §10.2 **FRG-H14** revised + **FRG-H28**/**FRG-H29**), **`docs/specs/render.md`** (§3.2b — the `text` node-type register entry + `BT-REG-1`/`BT-EMIT-1..7` + `BT-H*`/`BT-F1`; §3.4.3 `EMPTY-OWNER-1c` + `EMPTY-H8`), **`docs/specs/node.md`** (§2.1 — the `text` type in the node-TYPE register). Scope stated **`>=0.4.0 <1.0.0`** with the 1.0.0 revisit (AC-7); the emit rule stated as **silent filtering** with **no** emit-time warn claim (AC-8); `adapters.md`'s `text`-PROP rows left UNCHANGED in substance (AC-12). **Denial retirement (five artifacts, SUPERSEDED annotations + pointers):** `content-xor-children-review.md` §2 + PARK; `eng-inline-order.md` §9b; `use-case-placement-native-interleave.md` §5b (**+ its version header corrected** — it read 0.3.2; the package is 0.5.0); the `docs/decisions.md` CONTENT-XOR-CHILDREN row; `docs/pending.md`. **N6** erratum placed in `docs/specs/bare-text-emit-review.md` §3 **and** the `docs/decisions.md` BARE-TEXT-EMIT row; **N7** `content:''` asymmetry documented as a pinned behaviour (render §3.4.3 EMPTY-OWNER-1c + the decisions EMPTY-OWNER note); **N5** test-header correction; **AC-11** `docs/skills/designing-pages.md` §11 rows + §12 note. | `docs/specs/adapters.md`, `docs/specs/render.md`, `docs/specs/node.md`, `docs/specs/bare-text-emit-review.md` §3, `docs/skills/designing-pages.md` §11/§12, + the five denial sites |
| **A+ — the UR-3(b) red set** | Landed by the TestWriter **before** this pass: `tests/unit/bodyruns-drop-diagnostics.test.ts` (the A+ red set + the six-row property register; its spec gained the **AM-1/AM-2** amendments). | `docs/specs/bodyruns-drop-diagnostics.md` §1.1, `tests/unit/bodyruns-drop-diagnostics.test.ts` |
| **W5 — UR-4 confirmation + guide stub** | `docs/decisions.md` gained **`CONTENT-XOR-FREE-PARENT-NO-OP`** ("children win is a NO-OP for a `content`-free parent", with the version it takes effect in); `docs/migration-guide.md` §3.1 gained the **`DRAFT — PENDING 1.0.0 GATE`** stub section (§3-style data-shape row + §1-style trap box + §6 checklist step + §8 residual, all **`[PLACEHOLDER]`** except the one settled no-op assertion — **no new guide file**); the **1.0.0-XOR batch row** added to `docs/pending.md` **and** the table below. The test-encoded half (**AC-21**) was already landed by the TestWriter (`tests/unit/xor-content-free-parent.test.ts`, GREEN by design — **do not edit**). | `docs/decisions.md`, `docs/migration-guide.md` §3.1, `docs/pending.md` |
| **A+ / W1-W3/W5 — ADVERSARIAL AUDIT + CORRECTION + GATE-8 DOC REVIEW — ✅ DONE 2026-09-22 (this pass is CLOSED; the unit's next action is W4, below)** | **Red set:** `tests/unit/bodyruns-drop-diagnostics.test.ts` (15 A+ cases A+1..A+7b + the six-row §5 property register + the register-report case = **24 tests**, 15 passing / 9 failing) + `tests/unit/xor-content-free-parent.test.ts` (2, GREEN by design). **Counts:** `npm test` = **1310 passing / 9 failing** (75 files; all 9 in the red-set file and all EXPECTED — the C2 clamp, the C3/C4 diagnostic layer and the C5 clause are unbuilt, W4's scope); the A+ pass added **15 passing tests** over a **1295 / 0** pre-pass baseline and landed **9 intended failures**; `typecheck` + `build` clean; `demo:smoke` → **SMOKE OK**, derived-fork pins inside the asserted **2.5×** bound, **`warningsMain=0`**. **Red case ids:** A+1, A+2, A+2b, A+3, A+4, A+4b, P-IM-1, P-IM-2, P-SM-1, P-IM-4 (the register rows report **EXPECTED-RED**; P-IM-3/P-TP-1/P-IM-4-control report **HELD**). **Adversarial audit:** `archive/reviews/2026-09-22/2026-09-22-ur-aplus-adversarial.md` — verdict **PASS-WITH-FINDINGS** (6 must-fix, all HOST). **Disposition of ALL findings:** **F1..F6** CORRECTED in the correction pass (F2 C5.3 drop criterion; F3 P-IM-2(d) class-tagged `fresh`; F4 P-TP-1 second half; F5 P-IM-1 enforced liveness + positive half; F6 §8.3 report contract / record-before-assert); **audit findings 8/9** CORRECTED in the same pass (C1's unreachable bail marked; the `bodyRuns` version scope made uniform at `>=0.4.0 <1.0.0`); **audit finding 1** (AC-21 over-claim) corrected as tracker wording; **audit findings 2-6** = the same F2..F6 set; **audit findings 7, 10, 11, 13 CORRECTED IN THIS GATE-8 PASS** (7: P-SM-1's generator + strategy cell — the unreferenced-duplicate control that actually carries a duplicate with a run naming a unique id, plus a second emit of the SAME wire asserting the `bodyruns-child-duplicate` warn does not repeat, C4 cross-pass — a STRENGTHENING that leaves the tally unchanged; 10: `render.md` EMPTY-OWNER-1c gains the **binding-supplied** third shape, `render-helpers.ts:1388-1389`/`:1368-1369` vs the raw-`s.content` gates `:1405`/`:1374`; 11: **BT-EMIT-5 is the OWNER** of the silent-filter/translate-time claim and `adapters.md`'s note is a pointer — no substance deleted; 13: `docs/releases.md` now resolves the 0.4.0 row's BARE-TEXT-EMIT reference **by row name** (`:23`→`:24` drift fixed) and the frozen gate record's mis-classification of `render-helpers.ts:1374` as an EMPTY-OWNER test is corrected by an **errata line in the live surface**, never by editing the record); **audit finding 12** (the gate record's non-existent `bodyruns-warn-drop.test.ts` path) carried as the ERRATA item below; **audit findings 3/14** (P-IM-2(d) over-count, the duplicated `expectWarnFor` push) corrected with F3/F2. **BLIND-GREENS (gate 5): STATUS = PASSING (justified, not skipped)** — see the "Blind-greens status" note below (the A+ unit's artifact under test is the SPEC + its red set; the diagnostic layer does not exist in `src/**`, so "no implementation reading" is satisfied by construction: the TestWriter derived every case from `docs/specs/bodyruns-drop-diagnostics.md` alone, and the spec's `file:line` anchors are citations OF the unimplemented seam, not of an implementation to copy). **Gate-8 DOC REVIEW: PASSED** — `archive/reviews/2026-09-22/2026-09-22-ur-doc-review.md` (spec↔code, trackers↔build, cross-refs + citation hygiene all reconciled; every stale entry fixed in-pass; **no file archived, therefore no repointing**). **TRIO after the doc-review pass:** `npm test` **1310 / 9**, `typecheck` clean, `build` clean, `demo:smoke` **SMOKE OK** (`warningsMain=0`, derived-fork pins inside 2.5×) — **no `src/**` change in the unit** (verify: `git status --porcelain src/` empty for the whole UR-2026-09-17 pass; every edit is in `docs/**`, `tests/**`, `AGENTS.md` or `RENDER_PROCESS_NOTES.md`). **⚠ VERIFICATION NOTE (honest scope):** the A+ pass and the adversarial audit **ran the trio with a shell**; the **gate-8 doc-review agent had no shell in its session**, so it could not re-execute `npm test`/`typecheck`/`build`/`demo:smoke` — it **re-derived** the reading statically instead (the per-file test-case census: 24 in the red-set file with exactly the 9 listed cases failing + 2 in the XOR file; and the pass arithmetic `1295 + 15 = 1310`), which agrees with the measured **1310 / 9**. A supervisor **with a shell must re-run the trio** and treat any deviation from **1310 / 9** as a regression, not as a number to edit. | `docs/specs/bodyruns-drop-diagnostics.md` (§1.1 AM-1/AM-2 + F2..F7, §5 register, §8 contracts), `tests/unit/bodyruns-drop-diagnostics.test.ts`, `archive/reviews/2026-09-22/2026-09-22-ur-aplus-adversarial.md`, `archive/reviews/2026-09-22/2026-09-22-ur-doc-review.md` |

**✎ W4 DONE-with-open-smoke — THE RULING + THE GATE STATE, stated plainly (2026-09-22,
gate-8 closeout pass; user rulings recorded verbatim in `docs/decisions.md`
RUNTIME-FORK-TRIPWIRE-BOUND and in the archive closeout record):**

- **THE STATUS WORDING IS `DONE-with-open-smoke`.** The code work (the C3 diagnostic
  catalogue + the C4 dedup + the N1 containment clamp + the N2/C5 `text`-children
  clause), **all gates through doc-review**, and the **blind-greens** are COMPLETE; the
  W5 test-side re-point and the 21-case independent greens set are landed. The trio is
  **broken out honestly instead of being summarised as "green"**:
  - `npm test` → **1340 passed / 0 failed (76 files)** ✅
  - `npm run typecheck` → **clean** ✅
  - `npm run build` → **clean** ✅
  - `npm run demo:smoke` → **RED — exit 1 at the repaired tripwire**
    (`[runtime-fork:tripwire] runtime fork-stress d12 total=1540.6ms vs
    placement-derived baseline 146.7ms = 10.50× (3× asserted)`), **by design and by the
    user's ruling** — NOT a broken harness, NOT a W4 regression (defect row
    **RUNTIME-FORK-PASS2-RATIO**, the next unit's scope).
- **THE HONEST CONSEQUENCE, ON RECORD (not papered over):** `AGENTS.md` **item 4**'s
  rule *"Only report work as complete when all three pass"* — and its smoke component
  in particular — is therefore **UNSATISFIED and openly recorded** for W4. This row does
  **not** claim the trio is green and does **not** weaken item 4; it records that the
  unit shipped with **one deliberate, documented red**, whose cause is filed, owned, and
  queued as the next unit.
- **WHAT THE RED DOES AND DOES NOT AFFECT:** the derived-fork per-region pins are all
  **inside** the asserted 2.5× (values emit 1.08× / diff 1.11× / apply 1.12×; link emit
  1.75× / diff 0.96× / apply 0.46×) and **`warningsMain=0`**, so the unit's own evidence
  stands. **Publish impact: NONE** — `prepublishOnly` is `npm test && npm run typecheck`
  and there is **no `.github/` and no CI config in the repository** (verified 2026-09-22:
  a glob of `.github/**` returns nothing), so **no automated gate fails on this red** and
  **the release pass is not blocked**. Nobody should read this red as a release blocker.

**The RED SET (the A+ code tally is unchanged by the docs pass; the CORRECTION pass
of 2026-09-22 re-derived it, the gate-8 DOC-REVIEW pass re-derived it again after
the F7 test strengthening, and the W4+W5 passes then CLOSED it — see the W4 DONE
row above for the red→green chain: 9 failing → 1314/5 → **1319/0** → +21 blind
greens = **1340/0**. The 9-failing record below is the HISTORICAL baseline, kept so
the red set's ids/controls remain legible.)**
`tests/unit/bodyruns-drop-diagnostics.test.ts` is the A+ red set (line anchors
for every case live in its file header, "LANDED LINE ANCHORS"): its **9 failing
case ids** are **A+1** (foreign/containment — N1), **A+2**, **A+2b**
(duplicate-id warn + own-child precedence), **A+3** (dangling-id warn half),
**A+4**, **A+4b** (`text`-node children warn — N2/C5), and the register rows
that wait on C2/C3/C4/C5 — **P-IM-1** (the C2 containment clamp), **P-IM-2**
(the count bound + non-vacuity clause (d)), **P-SM-1** (the duplicate warn half)
and **P-IM-4** (the `text`-children warn half) — **9 failing in all**, every
one of them a CONTRACT CONSEQUENCE of a clause W4 has not implemented yet (the
frozen gate record's AC-26..AC-29 + the spec's §5/§8). Green as labelled
controls: **A+2-control**, **A+4-control**, **A+4c**, **A+5**, **A+6a**,
**A+6b**, **A+7a**, **A+7b**, **P-IM-3** (`HELD`), **P-TP-1** (`HELD`) and
**P-IM-4-control** (`HELD`). **Register-report statuses (post-F6 vocabulary, as
executed):** `P-IM-1` / `P-IM-2` / `P-SM-1` / `P-IM-4` report **EXPECTED-RED**
(each with its minimized counterexample and, for P-IM-2,
`fresh.length=1 perPass[0]=0`); `P-IM-3` / `P-TP-1` / `P-IM-4 (control)` report
**HELD**; no row reports `UNDETERMINED` (every row had a live falsification
clause).

**The measured suite reading (re-derived by the gate-8 doc review, 2026-09-22):**
**1310 passing / 9 failing**, 75 files; **all 9 failures are in
`tests/unit/bodyruns-drop-diagnostics.test.ts`**; `npm run typecheck` and
`npm run build` clean; `npm run demo:smoke` → `SMOKE OK` with
`warningsMain=0` and the derived-fork pins inside the asserted 2.5× bound.
**✎ SMOKE PART SUPERSEDED (2026-09-22, closeout):** this `SMOKE OK` was read while the
runtime 3× tripwire was structurally inert; the repaired tripwire now reads the honest
runtime:derived ratio (**10.50×** at d12) and `demo:smoke` **exits 1 — RED by the
user's ruling** (bound **NOT** re-baselined: `docs/decisions.md`
RUNTIME-FORK-TRIPWIRE-BOUND; the exposed condition is `docs/defects.md`
RUNTIME-FORK-PASS2-RATIO, worked by the next unit). The count/typecheck/build halves
of this line stand; the smoke half does not. See the **✎ W4 DONE-with-open-smoke**
block above.

> **✎ POST-W4 READING (2026-09-22 — this is the NEW measured baseline, not a
> regression): **1314 passing / 5 failing**, 75 files.** W4 landed the contract
> (`docs/specs/bodyruns-drop-diagnostics.md` §9; `docs/defects.md` FIXED row
> BODYRUNS-DROP-DIAGNOSTICS): **5 of the 9 red cases are GREEN** (A+1, A+2, A+3,
> A+4, A+4b), **A+7a flipped GREEN→RED by contract** (its silence half expires at
> C3 — row **W4-A+7A-REPOINT**), and the **4 register rows (P-IM-1, P-IM-2,
> P-SM-1, P-IM-4) remain RED for ORACLE/generator reasons** no conformant
> implementation can satisfy (row **ORACLE-1..4**, §9.5 — a **test-writer pass**
> owns the fix). Everything else is unchanged and GREEN (all controls, P-IM-3
> `HELD`, P-TP-1 `HELD`, typecheck, build, `SMOKE OK`, `warningsMain=0`,
> derived-fork pins emit 1.07×/1.76×, diff 0.94×/0.91×, apply 1.24×/0.50× vs the
> asserted 2.5×; runtime placement d12 = 1.96× the derived baseline vs the 3×
> tripwire). **✎ SUPERSEDED BY THE W5 READING (2026-09-22):** after the test-side
> oracle re-point (spec §1.1 **W5-1** / §9.5(a); `docs/defects.md` FIXED row
> **BODYRUNS-DROP-ORACLE (W5)**) the suite reads **1319 passing / 0 failing** —
> the red-set file is **22/22 GREEN** and every register row reports **`HELD`**
> (`P-IM-1 attempts=100 failures=0 positiveHalfLiveAttempts=100`; `P-IM-2 HELD
> fresh.length=1 perPass[0]=1`; `P-SM-1 HELD attempts=40`; `P-IM-4 HELD
> attempts=25`). `typecheck`/`build` clean; `SMOKE OK`, `warningsMain=0`,
> derived-fork pins values 1.24×/1.01×/1.26× and link 1.77×/1.08×/0.54× vs the
> asserted 2.5×; runtime placement d12 **2.14×** the derived baseline (340.2ms /
> 159.1ms) vs the 3× tripwire. **Do NOT "fix" the suite by weakening the red set** — the four oracle
> rows are a TEST defect, filed with the required follow-up.
>
> **✎ SMOKE READINGS IN THIS BLOCK ARE NOT USABLE (2026-09-22 closeout):** the
> `SMOKE OK` lines and the runtime-ratio readings above (`1.96×`, `2.14×`) were taken
> while the runtime 3× tripwire was **structurally inert** (it read the
> placement-derived total, i.e. derived-vs-derived). The repaired tripwire reads the
> runtime page and the honest ratio is **10.50×** at d12 — `demo:smoke` now **exits 1,
> RED by the user's ruling**, bound **NOT** re-baselined (`docs/decisions.md`
> RUNTIME-FORK-TRIPWIRE-BOUND; `docs/defects.md` RUNTIME-FORK-PASS2-RATIO). The
> **count/typecheck/build** halves of these readings stand; the **derived-fork
> per-region pins** and **`warningsMain=0`** stand. See the **✎ W4 DONE-with-open-smoke**
> block above for the authoritative final state.
**Pre-pass baseline vs this pass:** the A+ pass added **15 new tests, all
passing additions**, to two NEW files — **13** in
`tests/unit/bodyruns-drop-diagnostics.test.ts` (its non-red cases/register rows:
A+2-control, A+4-control, A+4c, A+5, A+6a, A+6b, A+7a, A+7b, P-IM-3, P-TP-1,
P-IM-4-control and the register-report case) + the **2**
`xor-content-free-parent.test.ts` confirmations — and that same new file carries
the **9 intended failures** (24 tests in total: **15 passing / 9 failing**). The
pre-pass baseline was **1295 passing / 0 failing**; `1295 + 15 = 1310` — the
arithmetic closes, and the earlier "1309 passing" figure in this file and in
`docs/defects.md` was a stale reading, corrected here and there. **A docs-only
pass must not perturb any count** — a post-pass reading that differs from
**1310 / 9** is a regression to investigate, not a number to update in the
docs.

**ERRATA + CARRY (2026-09-22 — recorded by the adversarial-audit correction pass;
`archive/reviews/2026-09-22/2026-09-22-ur-aplus-adversarial.md` §3 findings 1-6, §5):**

1. **RED-SET PATH — errata against a frozen citation.** The frozen gate record
   `docs/specs/ur-2026-09-17-review.md:261` names the landed red set as
   `tests/unit/bodyruns-warn-drop.test.ts`. **That file does not exist.** The red
   set that actually landed — and the one this pass corrected — is
   **`tests/unit/bodyruns-drop-diagnostics.test.ts`** (the A+ cases A+1..A+7b + the
   six-row §5 property register). The gate record is the record of record and is
   **NOT rewritten**; the correction lives here and in the `docs/decisions.md`
   BODYRUNS-DROP-DIAGNOSTICS row (AC-31).
2. **AC-21 / UR-4 confirmation — what it actually pins.** `tests/unit/
   xor-content-free-parent.test.ts` is a legitimate GREEN confirmation, but it pins
   the **bare-text emit output** (`>=0.4.0 <1.0.0`), **NOT** the 1.0.0 "children
   win" no-op: XOR enforcement only touches a node carrying BOTH `content` and
   `children`, and that node carries no `content` at all, so no future enforcement
   can change its output. The tracker wording was corrected accordingly
   (`docs/decisions.md` CONTENT-XOR-FREE-PARENT-NO-OP row).
3. **⛔ W5/W6 CARRY — the `content`-bearing sibling case (MUST NOT be added now).**
   The case that would genuinely encode the 1.0.0 XOR question is a **sibling** input
   to the AC-21 one: a parent carrying **`content` AND children**, asserted today as
   **both-rendered** (the current `escapeText(content) + children` behaviour), named
   explicitly as the case the **1.0.0 "children win" flip** would change. It is
   **deferred to the W5/W6 pass** and **must not be added to the test suite in this
   cycle**: asserting today's both-rendered semantics there would encode
   **un-fixed** post-1.0.0 semantics, which **AC-25 explicitly forbids**
   (`docs/specs/ur-2026-09-17-review.md:358`). It becomes writable only when the XOR
   gate is adjudicated (the 1.0.0-XOR batch rows in `docs/pending.md` + the table
   above).

4. **✎ GATE-8 CORRECTION (2026-09-22 — audit finding 7, a STRENGTHENING).**
   **P-SM-1's "unreferenced duplicate" control was not the described input.** The
   pre-correction generator set `childOrder = [a(dup), b(dup), c(other)]` but then
   had the run name a **UNIQUE** id (`other-<j-1>`), so C3's "warns only when a run
   actually references the duplicated id" was **never exercised**; and because the
   warn spy lived inside each single-emit attempt, C4's **cross-pass bound for
   `bodyruns-child-duplicate`** was untested (P-IM-2 applies the bound only to
   `bodyruns-child-unresolved`). Both halves are now asserted **inside P-SM-1**
   (control = a duplicate present while the run names a unique, non-duplicated id;
   plus a second emit of the **SAME element wire** — required, because the C4
   signature is `code\0elementWire\0runChildValue`, so a second *element* would
   carry a different signature and could not test the bound), with an
   anti-inert-control guard. The requirement is also stated in **P-SM-1's strategy
   cell** (`docs/specs/bodyruns-drop-diagnostics.md` §5) and logged as **F7** in
   its §1.1 amendment log. **No assertion was weakened, `src/**` untouched, and the
   row stays EXPECTED-RED today for the same reason (C3 unbuilt) — the suite tally
   is unchanged (1310 / 9).**
5. **✎ GATE-8 CORRECTIONS to the other audit findings (2026-09-22 — findings 10,
   11, 13; each in its OWNER artifact).** **(10)** `docs/specs/render.md` §3.4.3
   `EMPTY-OWNER-1c` now names the **binding-supplied** third shape: the emit path
   uses the **RESOLVED** `content = scalarBinding(s.bindings) ?? s.content`
   (`render-helpers.ts:1388-1389` plain, `:1368-1369` blocked-def, `:1157` `text`)
   while the gates test the **RAW `s.content`** (`:1405` plain path, `:1374`
   blocked-def path — the latter is a **blocked-def gate, not an EMPTY-OWNER
   test**), so a binding-supplied `''` is likewise **emitted-and-gated-empty**.
   **(11)** AC-30 near-duplication of the silence rule: **`docs/specs/render.md`
   §3.2b `BT-EMIT-5` is the OWNER** (silent filtering + the
   translate-time/legacy-JSON-only `text-content-only` warn) and
   `docs/specs/adapters.md`'s silent-filter note is **reduced to a pointer** — the
   adapter's boundary fact (the adapter observes no warn) is kept, no substance is
   deleted. **(13)** citation drift: `docs/releases.md`'s 0.4.0 row cited the
   BARE-TEXT-EMIT row at `docs/decisions.md:23` (it is at **`:24`**) — the cell now
   resolves the row **by name** per this repo's own citation convention; and the
   frozen gate record's mis-classification of `render-helpers.ts:1374` as an
   EMPTY-OWNER test is corrected in the **live surface** (`render.md` §3.4.3 +
   `docs/releases.md`'s errata block), never by editing the record.

**BLIND-GREENS (gate 5) — ✅ SATISFIED BY AN INDEPENDENT GREENS SET (2026-09-23); the
"JUSTIFIED BY CONSTRUCTION" text below is **SUPERSEDED** and kept for provenance only.**
**THE RESULT:** `tests/unit/bodyruns-drop-diagnostics-greens.test.ts` — **21 cases,
21/21 PASS**, authored **from the DOCUMENTATION ONLY** (its own BLIND-RULE
DECLARATION: the author read neither `src/**` nor the two landed oracle files
`tests/unit/bodyruns-drop-diagnostics.test.ts` / `tests/unit/xor-content-free-parent.test.ts`;
every expectation carries a `doc:` line quoting the clause it came from; other tests
were consulted only for harness/import conventions). It covers the C3 catalogue +
message shape, the C4 repetition bound across passes, the C2 containment pin, five
SILENT controls (including C3's reference gate and the childless multi-`{ text }`
control), the C6 byte-identical/diff guarantees, C7 immutability, the bare-text emit
shape, and the documented residuals (§9.6/§9.8: R-A1's reachable shape and **R-W4-1**
— the fork-arm base-node DROP). Each case uses its **own** element wire + id, so C4's
process-level dedup cannot couple the cases (spec §8.4 invariant H2). **Therefore gate 5
is satisfied BY that independently authored set — no justification or caveat is
required any more**, and the A+ unit's earlier "satisfied by construction because no
implementation existed" reading is retired: at the time it was written the diagnostic
layer did not exist, which is exactly why a real greens pass against the SHIPPED
behaviour was the outstanding item (it has now run). Counts: the set adds **+21** over
the W5 baseline (**1319 → 1340 passing / 0 failing**, 76 files).

**SUPERSEDED (provenance only) — the pre-W4 "PASSING, JUSTIFIED" note:**
The requirement is that the artifact under test is produced from the
DOCUMENTATION ONLY, with no implementation reading. For **this unit** that was
satisfied **by construction**, and for a reason that was stronger than usual: the
thing under test was a contract for behaviour that **did not exist** in `src/**`
then (no diagnostic site, no C2 clamp, no C5 clause), so there was no
implementation to read — the A+ cases could only be derived from
`docs/specs/bodyruns-drop-diagnostics.md` (§3 C1..C8, §5 register, §8.1 test
contracts), and the spec's `file:line` anchors cited the **existing seam the
diagnostic must attach to** (the resolver, the emitted element's `childOrder`,
the `text` early return), not the diagnostic's own code. The gate topology was
also honoured: the **TestWriter** wrote and executed the red set in the gate that
precedes the implementation gate, the **adversarial audit** then reviewed it
read-only (a different agent/model), and the **corrections** (F2..F7) were landed
as spec+test edits with `src/**` untouched. **Residual caveat (now DISCHARGED):**
blind-greens in the AGENTS.md item-10 sense — an independent writer producing an
artifact from the docs alone — was **not** re-run as a separate agent loop for the
A+ unit, because the A+ deliverable is a red set (not a demo page) and its cases
were authored from the spec by the test-writer role; **the real blind-greens gate
for this workstream was W4's**, and W4's loop has since **run and PASSED** (above).

**W4 CARRY LIST (the audit's §5, `archive/reviews/2026-09-22/2026-09-22-ur-aplus-adversarial.md`
§5 — quoted, not restated):** the diagnostic (`console.warn`, C3 codes/message
shape) + the **C4 process-level signature dedup** + the **N1 containment clamp**
(`w ∈ el.childOrder`, a *membership* test — never `nodeById` membership) + the
**N2** `text`-children warn + the **N3** warn clause; **P2** (per-keystroke
repetition) — the bound proven by P-IM-2(b)/(c) AFTER its (d) filter is fixed;
**S1** — `warningsMain === 0` and the census guards (safe only while the channel
stays `console.warn` and C6's no-new-field rule holds); **N1-regression** —
**A+6b's def-fill synthetic resolution must stay green; the **A+7a re-point**
(silence → warn — the audit's `:373` anchor is PRE-F4 numbering; cite the case by
NAME, `A+7a`, per the spec's §1.1 note) and the **N4 rename** of
`tests/unit/bodyruns-wire-ref.test.ts:69`; `bodyruns-child-duplicate` does not
exist in code today — it also needs a resolver-side duplicate count (C3's `<n>`
detail) and a **C4-dedup assertion** (now landed in P-SM-1, gate-8 F7); the
**fork-arm / base-wire resolution (D2(i))** — the spec records it as a class, but
a W4 clause must state the resolution for an authored-id ref naming a fork arm's
base node (no register row and no A+ case covers it); the **AM-1 residual R-A1**
declaration, and the documented `content:''` asymmetry (N7, now with its
binding-supplied third shape) must not be altered without its own gate; target
**0.5.1** (`X.X.Y`), `emitElements`' signature unchanged, plus the AGENTS.md item
11 adversarial pass with the construction-path-exhaustion dimension.

**NEXT: W4 — the UR-3(b) FULL CODE GATE (blocked on nothing; the next unit a
supervisor picks up).** Per `docs/specs/ur-2026-09-17-review.md:300-303` +
`docs/specs/bodyruns-drop-diagnostics.md` §6/§8: **spec section (already written:
`bodyruns-drop-diagnostics.md`) → extend the red set to the real drop classes
(D2(i) fork-arm included) → implement** the emit-boundary `console.warn`
diagnostic + the **N1** containment clamp + the **N2** `text`-children clause +
the **N3** warn → **adversarial pass** (AGENTS.md item 11, HEAVIER model, with
the construction-path-exhaustion dimension) → **blind-greens** → **trio**
(`npm test` + `typecheck` + `build` + `demo:smoke`). Target version **0.5.1**
(patch, `X.X.Y` — the `console.warn` channel keeps `emitElements`' signature
stable). The three hazards the gate must handle on record: **P2** (warn repetition
per keystroke → C4's signature dedup), **S1** (`warningsMain === 0` — structurally
safe because `warningsMain` is `translated.warnings.length`, the K4 channel, not a
console counter; the census guards via C6's no-new-field rule), and
**N1-regression** (the containment clamp must not re-break the def-fill synthetic
resolution — §8.1 A+6b is the GREEN control that guards it). `src/**` must stay
untouched until that gate opens (`docs/specs/bodyruns-drop-diagnostics.md` §8:
"no implementation change may be made in this pass").

**What a fresh supervisor picks up next, in order:**

0. ✅ **W4 — LANDED 2026-09-22 + W5 TEST-SIDE RE-POINT LANDED 2026-09-22.** The
   diagnostic layer + the N1 clamp + the C5 clause are built
   (`docs/specs/bodyruns-drop-diagnostics.md` **§9** is the implementation record;
   `docs/defects.md` FIXED row BODYRUNS-DROP-DIAGNOSTICS closes N1/N2/N3), and the
   five failures the W4 run left are resolved **test-side** by the W5 pass (FIXED
   row **BODYRUNS-DROP-ORACLE (W5)**; spec §1.1 row **W5-1** + §9.5(a)): the four
   ORACLE rows (P-IM-1/P-IM-2/P-SM-1/P-IM-4) and the A+7a re-point. **Measured:
   `tests/unit/bodyruns-drop-diagnostics.test.ts` 22/22 GREEN, all seven register
   rows `HELD`, suite 1319 passing / 0 failing**, `src/**` untouched, no assertion
   weakened. **Outstanding from these passes, in priority order:** **(a)** the
   AGENTS.md item-10 **blind-greens loop** for the shipped behaviour (it was
   satisfied by construction only while the diagnostic layer did not exist — now
   it does, so the loop must run against the spec); **(b)** the AGENTS.md item-11
   **adversarial pass** including the construction-path-exhaustion dimension;
   **(c)** the **release pass** — the 0.5.1 bump + the `docs/releases.md` row
   (0.5.0 is still `UNTAGGED`, so the release pass decides whether W4/W5 ship as
   0.5.1 on top of it or fold in).

1. **The W4 carry list (consumed — kept for provenance).** **Carry the audit's §5 list verbatim-quoted above**
   (`archive/reviews/2026-09-22/2026-09-22-ur-aplus-adversarial.md` §5): the
   diagnostic + C4 dedup + the N1 **membership** clamp + the N2/N3 warns, the
   P2/S1/N1-regression hazards, the **A+7a re-point** (its silence half expires at
   C3 by contract — that is a re-point, NOT a regression) and the **N4 rename**,
   the `bodyruns-child-duplicate` count + its C4-dedup assertion (landed in P-SM-1
   by gate-8 F7), the **fork-arm / base-wire resolution (D2(i))** clause, the
   **AM-1 residual R-A1** declaration, the untouched N7 asymmetry, target
   **0.5.1**, and the AGENTS.md item-11 adversarial pass **with the
   construction-path-exhaustion dimension**. **W4 also owns the blind-greens
   gate for the shipped behaviour** (see the blind-greens note above: the A+ unit
   satisfied it by construction because the diagnostic layer does not exist; once
   it does, the item-10 loop must run against the spec).
2. **Trackers filed by this pass that W4 consumes:** `docs/defects.md` **N1**,
   **N2**, **N3** (REAL defects, OPEN — fix rides W4) and the **N4**/**N5**/**N6**/**N7**/**N8**
   doc/spec-error rows; `docs/decisions.md` BODYRUNS-DROP-DIAGNOSTICS (the
   W4 contract row) + BODYRUNS-REMOVABILITY + CONTENT-XOR-FREE-PARENT-NO-OP +
   the EMPTY-OWNER `content:''` note.
3. **The 1.0.0-XOR batch** (below) — **do NOT start**; it needs a user semantics
   ruling first (Q4 option A).
4. **`docs/releases.md` provenance debt** — the `UNTAGGED`/`UNVERIFIED` cells for
   **0.4.1** and **0.5.0** (and the 0.3.x commit/date cells) can only be filled
   by someone in a clone that has the tag objects; the item-12 duty says fill them
   in the next release pass.

## CURRENT WORK — the 0.2.0 batch (HANDOVER STATE, 2026-08-24)

**Published**: provident-ssr 0.1.5 (journal reversibility). **In progress**:
the 0.2.0 minor batch (docs/next-feature-batch-0.2.0.md — the single
authoritative plan; all 26 user rulings recorded there).

| Feature | Gate | TDD | Status |
| --- | --- | --- | --- |
| 1a Def-prototype round-trip | ✅ PROCEED-AS-RESHAPED (handoffs-review-5.md) | ✅ def-roundtrip.test.ts (9) | **LANDED** |
| 1 rows demo gate | ✅ (census measured + tripwire) | ✅ rows-fanout.test.ts (4) + rows-scenarios page + rows-blind-test vitest (8) | **LANDED — BLIND-TEST LOOP COMPLETE (2026-08-24: writer → proofreader → page-reviewer; zero engine defects; 1 data-only fix in check assertion)** |
| **⚠ ADVERSARIAL FIX QUEUE (Features 1a+1 guardrail gaps — 2026-08-24)** | ✅ (scenario→probe→review census complete) | ✅ **TDD LANDED (2026-08-24 fix pass — tests/unit/rows-mint-guardrails.test.ts, 25 tests: red 20 → green; trio green 1088)** | **COMPLETE — 12 engine defects fixed (S1-S5, S6a, S7, S8b/S9, S13-S16), 3 documented dispositions (S6b children-only legal, S10 hooksKind-authoritative, S11/S12b unreachable/documented) — defects.md ADVERSARIAL-* FIXED rows; Feature 1b's gate is UNBLOCKED** |
| 1b keyed batch-reuse | ✅ gate (handoffs-review-6.md PROCEED-AS-RESHAPED, D1-D14) | ✅ keyed-batch-reuse.test.ts (22) + keyed-reuse-guardrails.test.ts (6) | **LANDED — trio green 1116 (tests, typecheck, build, smoke). ADVERSARIAL-1b FIX ROUND COMPLETE (S15 parent guard, S22 skipKindGate, S16/S5/S10 re-arm reshape, S17/S18 minor — defects.md FIXED)** |
| 2 MarkdownAdapter | ✅ gate (handoffs-review-7.md PROCEED-AS-RESHAPED, D1-D15) | ✅ markdown-adapter.test.ts (20) + markdown-adapter-guardrails.test.ts (11) + G-PRE-ESCAPE/G-INLINE-FILTER (6) | **FULLY LANDED — trio green 1153. ADVERSARIAL-MD fix round COMPLETE. DEMO PAGE + BLIND-TEST LOOP COMPLETE (markdown-adapter-scenarios 7 checks M1-M7). REVIEW RESOLUTIONS (2026-08-25): D14 mode-toggle MarkdownAdapter arm LANDED (mode-toggle markdown 14 checks); MD-PRE-ESCAPE FIXED (fence content literal); MD-INLINE-FILTER FIXED (inlineContent pulls true inline only).** |
| 3 journal condensing | ✅ gate — **PROCEED-AS-RESHAPED (handoffs-review-8.md, 2026-08-25, D1-D10)** | ✅ **TDD LANDED (2026-08-25 — journal-condensing.test.ts, 16 tests; trio green 1169) + ADVERSARIAL fix round (ADV-S11/S19/S4/S5/S12, trio green 1174)** | **LANDED.** D1-D10: D1 merged-only restore (no layers field — step-2 H2 win), D2 handler-faithful replay bounded to post-base, D3 undo/redo/replay id-resolve evicted refs to the restored graph, D4 sync graph-REPLACE `_restoreBase` (drain + evict + §3 recipe + re-mint rows), D5 deferred microtask condense + circular-safe size guard (`condense-skipped-size`) + failure containment (`condense-aborted`), D6 base marker `{kind:'base', snapshot, result:{status:'base'}}` + replay branches first + marker never in undoStack, D7 append-only pins amended same-pass, D8 rows/defs composition (capture unions the def-prototype registry), D9 shipped-vs-lost scope, D10 memory win + ruling-21 integrity. **ADVERSARIAL (2026-08-25):** S11/S19 CRITICAL (replay/redo id-resolve `op.target`), S4 (replay clears redoStack), S5 (quiet restore re-mint), S12 (graph-filtered condense protoSet), S20 (clone-instance loss documented). **D14 demo arm BUILT (journal-condensing-scenarios, 4 checks, smoke OK); blind-test loop COMPLETE (2026-08-25 — writer → proofreader → page-reviewer; 4/4 checks PASS, no engine defects)** |
| 4 preservation-by-reversal flag | ✅ gate — **PROCEED-AS-RESHAPED (handoffs-review-9.md, 2026-08-25, D1-D8)** | ✅ **TDD LANDED (2026-08-25 — preserve-reversal.test.ts, 11 tests; trio green 1185)** | **LANDED.** D1 flag read at reverse time via parent→layer (no registry, no per-node marker), D2 whole-subtree cascade (threaded context), D3 reverse-time projection (NOT redundant with promotion), D4 re-mint/condense flag loss documented, D5 serialize asymmetry structural (reverse-only), D6 leak guards free, D7 scope boundary, D8 cost-benefit (non-destructive view). **D14 demo arm BUILT + blind-test loop COMPLETE (2026-08-25 — preserve-reversal-scenarios, 4 checks, smoke OK; writer → proofreader → page-reviewer; the page reviewer fixed the D4 data to a genuine same-hookName rows-mint re-mint — the initial D4 wrongly used removeLayer/the D3 promotion case; no engine defects)** |

**Next action (the pick-up queue is in `docs/HANDOFF-6.md`)**: publish 0.2.0.
The Feature 3 (journal condensing) + Feature 4 (preserve-by-reversal) blind-test
loops are now COMPLETE (2026-08-25 — writer → proofreader → page-reviewer on
Mimo-2.5 for both demo arms: journal-condensing-scenarios 4/4 PASS, no engine
defects; preserve-reversal-scenarios 4/4 PASS after the page reviewer fixed the
D4 data to a genuine same-hookName rows-mint re-mint — the initial D4 wrongly
used removeLayer/the D3 promotion case). Features 1/1a/1b/2/3/4 are all LANDED
(trio green 1187, 2026-08-25). **The 0.2.0 cross-feature adversarial pass is
COMPLETE (2026-08-25 — 23 scenarios X1-X23, 18 PASS, 2 root causes: X8/X16 D8
keyed-undo flag asymmetry FIXED, X2/X11/X12 condense-replay preserve loss
DOCUMENTED; trio green 1189).** **A private pre-release path is set up
(2026-08-25 — `@littlekingsguard/provident-ssr` on GitHub Packages, tag-triggered
workflow) so the engine can be tested in the Electron project before the public
release.** The remaining work is the public 0.2.0 release (see the checklist
below).

## PUBLIC RELEASE CHECKLIST — 0.2.0 (the private pre-release → public flip)

The private pre-release (`@littlekingsguard/provident-ssr@0.2.0-rc.1` on GitHub
Packages) is for Electron-project testing only. Before the PUBLIC release, the
following must be done (in order):

1. **Electron-project validation** — the Electron consumer installs
   `@littlekingsguard/provident-ssr@0.2.0-rc.1` and runs its battery against the
   pre-release dist; any new defects filed go through the normal
   handoff → gate → TDD loop before the public flip.
2. **Flip the package name back to public** — `package.json` `name`:
   `@littlekingsguard/provident-ssr` → `provident-ssr`; bump `version` to
   `0.2.0` (drop the `-rc.1` prerelease suffix).
3. **Remove the GitHub-Packages publish config** — delete the
   `publishConfig.registry` block from `package.json`, the `.npmrc`, and the
   `.github/workflows/publish-prerelease.yml` workflow (or gate it to a
   non-public tag). The public publish uses the default npm registry.
4. **Restore the public README install/import** — the README's
   "Private pre-release" section is removed; the `npm install provident-ssr`
   + `provident-ssr/core/*` import examples are the canonical public surface.
5. **Public publish** — `npm publish` (as `rarasey`) to the public npm registry;
   `prepublishOnly` runs `npm test && npm run typecheck`; `prepack` rebuilds
   `dist`. Tag `v0.2.0`.
6. **Post-publish verification** — the Electron project re-installs the public
   `provident-ssr@0.2.0` and re-runs its battery; the private
   `@littlekingsguard/provident-ssr` pre-release is retired (unpublished or
   left as a historical rc).

**Note:** the scoped name is ONLY for the private pre-release. The public
release must ship as `provident-ssr` (the name the Electron consumer and the
published 0.1.x line already use).

**STATUS (2026-08-25):** steps 1-4 are DONE — Electron validated rc.4 green; the
package `name` flipped to `provident-ssr`, version bumped to `0.2.0`, the GitHub
Packages `publishConfig`/`.npmrc`/`.github/workflows/publish-prerelease.yml` are
removed, and the README public install/import restored. **Step 5 DONE —**
`provident-ssr@0.2.0` PUBLISHED to the public npm registry (2026-08-25, as
`rarasey`) + tag `v0.2.0`. **Step 6 (post-publish verification):** the Electron
project re-installs public `provident-ssr@0.2.0` and re-runs its battery; the
private `@littlekingsguard/provident-ssr` pre-release is retired.

**CI constraints (2026-08-25, pinned in AGENTS.md item 12):** a publish runs in
a CLEAN checkout — `dist/` is gitignored (build before `npm test`), `live-prod/`
is gitignored (the corpus-dependent suites `describe.skip` when absent), and npm
auth uses `${NODE_AUTH_TOKEN}` (not `${NPM_TOKEN}`). Any future CI failure
referencing a gitignored path is fixed by skip-when-absent or build-first, never
by committing the gitignored file.

## PENDING (awaiting the user gate — bookmark, do NOT auto-proceed)

| Item | Gate |
| --- | --- |
| **THE 1.0.0-XOR BATCH — the three coupled deliverables + the EMPTY-OWNER-collision open question (2026-09-22, UR-4 batch row)** | **PARKED — do NOT auto-proceed; needs a user semantics ruling + its own three-agent gate (AGENTS.md items 6/7/9).** The batch is **`(1)` XOR render enforcement ("children win") + `(2)` `bodyRuns` removal (branch (b), `docs/decisions.md` BODYRUNS-REMOVABILITY row) + `(3)` the authored producer-migration guide** (a real section of the EXISTING `docs/migration-guide.md` — a `DRAFT — PENDING 1.0.0 GATE` stub is in place; **no new guide file**) — **coupled: they ship together or not at all.** **THE BLOCKING OPEN QUESTION (X6):** the **EMPTY-OWNER / content+placement COLLISION** — EMPTY-OWNER's escape hatch needs authored content + a placement zone (`render-helpers.ts:1371-1408`), so "children win" (which drops content) collides with it; the ruling must decide whether a content-dropped placement owner becomes empty (→ `display: none`) or keeps its authored non-emptiness. Also blocking: the `nodeToLegacy` round-trip for a content+children node and the shipped demo census/smoke expected strings. **Not in scope now** — `docs/specs/ur-2026-09-17-review.md` §9 **Q4 option A** (`:451-469`), §6 scope C recorded as PREMATURE (no semantics ruling; entangled with the PARKED Script-DSL/Cordis 1.0.0 framing). Full row: `docs/pending.md` 1.0.0-XOR BATCH. The one half already contracted: the **`content`-FREE-parent no-op** (UR-4 confirmation, `tests/unit/xor-content-free-parent.test.ts`) |
| RENDER_PROCESS_NOTES → decisions.md fold | a future archival pass |
| Runtime fork pass2-scaling lead (d12 pass2 = 1424ms of 1772ms total on the runtime loop page — flagged 2026-08-20) | future browser profile on the d14 runtime pages — pending.md PARKED row (compile-RESOLUTION of runtime-minted nodes, NOT handler bodies). **✎ POST-R1 2026-09-23 — THE LEAD IS NOW DIAGNOSED AND THE RECOMMENDED LEVER LANDED:** the amplification is attributed (ancestor-chain slices + 12.4× redundancy + the unscoped `fitReference` scan; report `archive/reviews/2026-09-23/2026-09-23-pass2-amplification-diagnosis.md`) and **R1 landed** (slice-scoped descent, `src/core/resolve.ts:229-238`; measured **≈258 ms / 15.9%** saved — d12 total **1622.2 → 1363.9 ms**, printed tripwire **9.65× → 8.11× / 8.05×**, [supervisor 2026-09-23] confirming run **8.11×**). **The residual is ≈8.1× and the tripwire stays RED by ruling (the 3× bound is UNRAISED — no bound moved); R2 remains ungated. The item now AWAITING THE USER GATE is the BOUND DECISION** — option A gate R2 / option B re-baseline by measurement / option C accept RED-with-teeth, with the contract-clean page levers R4/R5/R6 landable beforehand (`docs/pending.md` `PASS-2-BOUND-CHOICE`; `docs/decisions.md` `PASS2-FIT-REFERENCE-SLICE-SCOPE`). |
| Preservation-by-reversal layer flag | future feature (pending.md) — **NOTE: the 0.2.0 batch's Feature 4 is the same item, gated in the batch** |
| Script DSL / guardrailed code-as-data proposal + the Cordis spatiotemporal-composability follow-up (2026-08-27) | **REVIEWED — WORKABLE WITH SCOPING (three-agent gate, `docs/specs/script-dsl-review.md`).** **USER RULING 2026-08-31: PARK THE WHOLE PROPOSAL — do NOT advance R1 to the spec gate.** The script-DSL (R1/R2) is parked in pending.md. The Cordis follow-up is SCOPED AS A SEPARATE WORKSTREAM (`docs/specs/cordis-composability-scope.md` + a pending.md row) — parked, not in progress. Do NOT auto-proceed on either. **USER CONSTRAINT + VERSIONING-SCHEME DECISION (2026-08-31): both are 1.0.0 MAJOR-RELEASE changes that do NOT assert full backwards compatibility with existing handler code** (`X.X.Y` patch / `X.Y.X` non-breaking / `Y.X.X` breaking — decisions.md VERSIONING-SCHEME row) — a future gate must state the explicit BC scope (retained vs re-expressed handler code) at proposal time. |

## RESOLVED (circle-back log)

| Item | Resolved (date) | Fix reference |
| --- | --- | --- |
| Multi-graph / registry isolation (per-Supervisor registries) — the security/isolation use case for the multi-graph host | 2026-08-25 | **LANDED (D1-D8, three-agent gate PROCEED-AS-RESHAPED — `docs/specs/multi-graph-isolation-spec.md` + -review.md; decisions.md MULTI-GRAPH-ISOLATION row).** A `GraphScope` holds the per-graph registry sets; the DEFAULT scope IS the module singleton (D8 — no opt-in = byte-identical today); `createIsolatedScope()` is the explicit opt-in threaded through translate/Supervisor/render. Per-scope handlerDefs resolution+compilation (D2, security-critical), byId/resolveNodeRef/registered (D3), translateUserData (D4), the plain layer-apply teardown guard (D5), the ONE-timer per-scope-partition sweep (D6), EventBridge-per-graph host pin (D7). TDD: tests/unit/multi-graph-isolation.test.ts (9 tests, red 8 → green); trio green 1198, typecheck, demo:smoke OK (derived-fork pins within 2.5×; the coalescer did not blow up pass-2). **BLIND-TEST / STRESS-TEST LOOPS PENDING — the isolation blind-test scenarios are drafted (`archive/test-data/2026-08-25/2026-08-25-isolation-blind-test-scenarios.md`). Model split (CLARIFIED 2026-08-25): the blind-test loop (item 10) runs on MiMo-2.5 (the LIGHTER model — appropriate for doc-fidelity checks); the stress-test/adversarial loop (item 11) runs on the HEAVIER model, NOT MiMo — a lighter model cannot reason about the isolation seams / failure stages, so the stress-test must NOT run on MiMo.** |
| Feature 1 — rows demo gate: the fan-out census pin + tripwire + the demo page (the 0.2.0 batch) | 2026-08-24 | LANDED — the census pin (tests/unit/rows-fanout.test.ts): the measured shape is states-per-consumer = N exactly (ratio 1.0 for N=2..32 — verified empirically against resolve.js's per-hit fork), bounded ≤ 2N; the LINEARITY tripwire = `isFanOutBlowup(next, hits, prevArms)` (next > 2×arms×hits — the DEFECT #22-class regression guard; structurally unreachable today: each hit forks exactly one arm, so the designed product is always within the bound — fork-stress's 2-per-level doubling is silent, verified) + the `fan-out-blowup` warn at the resolution site (resolve.ts resolveNames). DEMO PAGE (Feature 1.5): demo/rows-scenarios.{data,js,html,template.html} + scripts/rows-scenarios-page.mjs — a legacy envelope with 8 product rows (name/price/stock, no id/key), a `'component'`-kind hooksKind, cross-row consumers, the MintRows function-STRING body driving the real rows-mint, the 10 checks (row count, per-row values, fan-out census 8≤16, the round-trip re-mint arm via the Feature 1a recipe — no accumulation), `[rows:profile]` (rowsMinted=8 fanoutStates=8 fanoutRows=8, census consistent, covered 8.1/8.2ms) + the smoke block (residual/census/fanout/banner guards). Data-fix notes: consumers must NEST as ancestors of the rows container (the resolve hit order own→descendants→ancestors), the mint body's `target` must be the live Node (clientAPI string refs don't cover rows-mint's target), the row count pins the family-tree minted set + the consumers' per-row arms (minted rows are providers, not elements — F3), the round-trip slice is the full TranslatedTree.nodes (rows-are-data; the batches record is the carrier). Trio green: 1055 tests, typecheck, build, demo:smoke SMOKE OK (rows-scenarios: 10 passed; derived pins on-curve). **BLIND-TEST LOOP COMPLETE (2026-08-24):** writer → proofreader → page-reviewer on demo/rows-blind-test.* + tests/blind/rows-blind-test.test.ts (8 tests). Zero engine defects; one data-only fix (isRoot assertion polarity). Trio green: 1063 tests, typecheck, demo:smoke SMOKE OK |
| Feature 1a — Def-prototype round-trip (the 0.2.0 batch; un-parked 2026-08-24) | 2026-08-24 | LANDED — three-agent gate PROCEED-AS-RESHAPED (docs/specs/handoffs-review-5.md: the CENSUS section supersedes the full-state section — `defPrototypes?: {name, nodeId, isRoot}[]`; the prototype STATE rides `content` (status quo); the loadState-side "re-mint" is a RE-REGISTRATION of the already-seeded instances — `reRegisterDefPrototypes(doc, hub, seeded)`, zero construction → the single-instance rule structural). Engine: census emit in serializeSlice (roots first, children in mint order, instance-membership reachability, name-less links skipped via the registry Link anchor read) + the C2 seam-anchor strip on prototype-state content entries; registry read-only enumerators `defPrototypeEntries`/`defRootPrototypeEntries` + `defNameForLink`; loadState section validation (non-array → envelope-mismatch; malformed/duplicate-nodeId/absent-nodeId → NodeSchema-shape-mismatch; duplicate NAMES legal — root+children share); `NodeBaseData.batches` typed; the §3 recipe gains steps 1.5/4.5 + the builder contract; serialize.md §4 caveat flip (doc-carriage-conditional `rows-prototype-unresolved`; the BH-N.4 absent arm unchanged) + the N1-corrected AUTH-SEAM wording + minted-id instability note. TDD tests/unit/def-roundtrip.test.ts (9 tests — red 9/9 then green; authoring fixes: the reconcile-resolves-reverse-order correction [the tripwire needs the def-root ABSENT, not reordered], the seam makes the def-root in-tree with CARRIER suppression [asserted wiring + re-homed children], the proto needs the token edge for the state tripwire, the slice must include the proto for the census). Trio green: 1051 tests, typecheck, build, demo:smoke SMOKE OK (pins on-curve) |
| DEFECT-JOURNAL-UNDO + DEFECT-JOURNAL-REPLAY-APPEND + DEFECT-CLONE-REPLAY-NONIDEMPOTENT (docs/HANDOFF-5.md Round 6) | 2026-08-24 | LANDED — three-agent gate PROCEED-WITH-CONDITIONS (docs/specs/handoffs-review-4.md: validity FEASIBLE-WITH-RESHAPE ×2, critique NEEDS-RESHAPE — the sliceLayers shape, change-analysis confirmed + the hooks value-equality + no-journal refresh amendments). Fix: state-slice journals result.sliceLayers + result.hookUndo (pre-op anchor.value + created/replaced/cleared); undo() inverts state-slice exactly (removeLayer per id, hooks anchor restore, markPass2 + E2E-3 consumer walk, per-inverse try/catch, destroyed/missing silent); replay()/redo() no-journal re-apply + in-place result refresh (journal never grows; redo pushes the SAME entry — no double-undo); idempotency gates (sliceLayers existence; hooks value-equality; clone-instance result.minted liveness); entry-own node-reference resolution first. Documented no-ops + parked fact-sets (detach/move/clone-undo/layer-apply/placement-attach/rows-clear) in ops.md §6 per-kind table; G13/G14 + api.md §1.1 amended. TDD tests/unit/journal-undo.test.ts (14 tests — red 13/14 then green; authoring fixes: actionable.content shape, the inverted replay gate found by the failing set; hooks-array pin 4/5 entry-count updated to the no-journal contract). Trio green: 1042 tests, typecheck, build, demo:smoke SMOKE OK (pins on-curve) |
| DEFECT-SSR-REMOVE (docs/HANDOFF-4.md Round 5 — SSRFragmentAdapter retains removed elements) | 2026-08-23 | LANDED — three-agent gate PROCEED-AS-RESHAPED (docs/specs/handoffs-review-3.md: validity FEASIBLE-WITH-RESHAPE, critique NEEDS-RESHAPE — the created-purge trap, change-analysis confirmed 20/20 monkey-patch assertions). Fix: SSRFragmentAdapter.removeEl detach semantics (splice-by-identity from parent children, parent=null, created purge, fragments.delete kept, rematerialize null-guarded, silent no-op, no rootKey reset). TDD tests/unit/adapters.test.ts DEFECT-SSR-REMOVE block (6 tests — red 5/6 then green; one authoring fix — cascade test split into two adapters for the single-valued rootKey). Trio green: 1028 tests, typecheck, build, demo:smoke SMOKE OK (pins on-curve). Docs: adapters.md §4.6 + §10.2 FRG-H18-remove widened + FRG-REM1..5; decisions.md DEFECT-SSR-REMOVE row |
| REQ-GAP-9 createLinkHub + seed-path hub threading (pass 2 TDD) | 2026-08-22 | LANDED — decisions.md REQ-GAP-9 row: `createLinkHub()` exported from src/core/translate.ts (the former private `defaultHub`) + barrel-exported (value + `LinkConfigNameHub` TYPE) from src/index.ts; the Node seed path routes placement/component role anchors through `this.hub` (same-name seeds share ONE Link; hub-less stays fresh; child anchors + the duplicate guard + the `catch {}` containment preserved); the corrected 4-step reseed recipe + caveats pinned in docs/specs/serialize.md (NEW) + contract.md + designing-pages §8; TDD tests/unit/link-hub.test.ts (9 tests); trio green (984 tests, typecheck, demo:smoke SMOKE OK — derived-fork pins on-curve) |
| REQ-GAP-10 addLayer seam letter (doc-only — pass 1) | 2026-08-22 | LANDED — the NAME→BODY SEAM letter in handlers.md §4 + translate.md TR-H4 (pre-mount prototype setup only; journaled paths for in-tree live injection; layer-id prefix rules; hooks delimiter; D16 precedence + clone inheritance without teardown; `registerHandlerBody` REJECTED — eval gate). Doc-only, no code |
| REQ-GAP-11 self-evicting sweep (pass 2 TDD) | 2026-08-22 | LANDED — decisions.md REQ-GAP-11 row: `finalizeDestroyed` evicts from registered/byId (+content/minted) at finalize; the destroy op evicts on BOTH branches (the markDestroyed/runtimeMinted amendment); supervisor `this.nodes` eviction via the `onNodeFinalized` hook at finalize time + the private destroyedRefs getNode tombstone (no-usable-state intact, never unknown-node); retention family edge kept; contract.md lifecycle pin + requestId-per-scenario note. **Instance-guard fix (2026-08-22):** the eviction + the supervisor hook are INSTANCE-guarded (`byId.get(id) === node`, `this.nodes.get(id) === node`) — the smoke runs several loadState-re-seeded graphs sharing one process + the SAME node ids, and an id-keyed delete would evict another page's live entry (observed mode-toggle client flake, 2/12 checks). Regression test: sweep-eviction.test.ts same-id two-graph case. TDD tests/unit/sweep-eviction.test.ts (10 tests); trio green (1001 tests, typecheck, build, demo:smoke SMOKE OK ×4 — pins on-curve) |
| REQ-GAP-12 destroy-cascade trigger flag (pass 2 TDD) | 2026-08-22 | LANDED — decisions.md REQ-GAP-12 row: the destroy op marks explicit destroys cascade-capable (internal flag, never an op payload — replay-safe); `finalizeDestroyed` recurses into explicit family children — payload content destroyed with its tree owner (unregistered per child), placement-owned + 'component'-token prototypes skipped (user ruling 1; prototype-rooted status captured at op time — the token edge dissolves before the sweep), retention split (runtimeMinted → markDestroyed, walk slots stable); destroy-op-scoped only (detach paths keep the content exemption). Teardown recipe: ops.md §2.5 (teardown-to-root = one destroy op; per-child fallback for pre-flag hosts). TDD tests/unit/destroy-cascade.test.ts (7 tests); trio green (1000 tests, typecheck, demo:smoke) |
| Handoff doc bundle + shared-surface code items — REQ-GAP-1/2 doc pins, REQ-GAP-3(a) precedence (DEFECT #28) + option (b) `data-node-id` (ruling A2, OPT-IN), REQ-GAP-4 `{results, dirtied}` + idempotency (the SHARED multi-host surface), REQ-GAP-5 canonical loop export (ruling B), REQ-GAP-7 (a) CSP docs + (b) `handler-body-eval-blocked` warn code, P6 `flush()` (ruling D2) | 2026-08-21 | LANDED — the ssr-synthetic-event.md extensions (2026-08-21) + the TDD implementation pass: `Supervisor.flush()` + `Supervisor.dispatchAndReport` + the opt-in bounded requestId LRU (decisions.md DISPATCH-REPORT row; tests/unit/phases.test.ts "shared dispatch-report" block (9); e2e report-surface parity §3.4), `renderProducingProcess` (producing-loop.test.ts), the opt-in `data-node-id` render option (adapters.test.ts DATA-* block), the `handler-body-eval-blocked` warn code (translate.test.ts REQ-GAP-7b block), DEFECT #28 auto-mint reverse exclusion (reverse.test.ts). Phase C (MCP/Electron ENDPOINT — transport, structured-clone args) stays parked spec-only (pending.md) — the ENGINE surface endpoints sit on landed |
| npm import-module packaging | 2026-08-20 | LANDED — decisions.md NPM-PACKAGING row (AGPL-3.0 intended, zero-dependency, ESM-only; Electron/Express = future separate packages). src/index.ts barrel (contract.md surface) + tsconfig.build.json (rootDir src, declarations → dist/core + dist/index) + package.json delta (exports `.` + `./core/*.js` + `./core/*` with types, files:["dist"], sideEffects:false, engines >=16, prepack clean+build, dropped the unused `ws`). Consumer type fix: emitElements accepts `Map<string, Node>`. README consumer section. Verified: npm pack (dist-only ~205 kB), consumer install imports barrel + subpaths (runtime + strict tsc types), trio green (938 tests). Review: docs/specs/npm-packaging-review.md |
| SSR synthetic-event contract (event-dispatch Phase B — producing-process-keeps-graph + fragment-as-addressable-metadata; vocabulary css.id + process-side wire resolution; parity harness; no render change) | 2026-08-20 | **LANDED as a CONTRACT + HARNESS** — docs/specs/ssr-synthetic-event.md (6 pins) + tests/e2e/ssr-synthetic-event.test.ts (4 tests encoding P1-P6; no engine/adapter/render change — Phase A covers dispatch). Review: docs/specs/ssr-synthetic-event-review.md (verdict PROCEED). Trio green: 938 tests, typecheck, demo:smoke SMOKE OK. Docs: decisions.md EVENT-DISPATCH-WIRING row (Phase B LANDED), pending.md Phase B row, designing-pages §11 |
| DEFECT #27 — no subtractive handlers surface (a `handlers` state-slice `replace []` could not clear compiled handlers) | 2026-08-20 | defects.md DEFECT #27 FIXED row — the handlers-CLEAR semantics (empty-array state-slice → merge reset + seam suppression, durable across compiles; non-empty writes keep D16 append). TDD: legacy-bridge.test.ts "DEFECT #27" block (3 tests). Trio green: 934 tests, typecheck, demo:smoke SMOKE OK (`session-features: 28 passed` — the full S2.1 self-removal is now asserted end-to-end). Docs: handlers.md §6, landed-features-scenarios.md execution note (the Group-2 NOTE's "self-removal not pipeline-reachable" is superseded by the fix), designing-pages §11/§12, findings/RCA append |
| SESSION-FEATURES scenario EXECUTION — `session-features.html` per `docs/specs/landed-features-scenarios.md` (css.classes Group 1, retained-handler-map Group 2, `Supervisor.dispatchEvent` Group 3) | 2026-08-20 | EXECUTED as the combined scenario/blind-test loop (blind writer → proofreader/page-reviewer). Page: demo/session-features.{data,js,html,template.html} + scripts/session-features-page.mjs (13 mounts, every interaction via `Supervisor.dispatchEvent`). Trio green: 931 tests, typecheck, demo:smoke SMOKE OK (`session-features: 25 passed`). Findings recorded: archive/findings/2026-08-20/2026-08-20-session-features-blind-test.md — S2.1 self-removal NOT pipeline-reachable (the `handlers` state-slice `replace []` cannot clear seam handlers — matches the spec's Group-2 NOTE); S2.2 destroy dissolves the shared family link (data re-express: destroyed node sole child of its container); S3.2 fork needs equal-depth providers (nearest-shadows-far). Docs: designing-pages §11/§12 execution-complete |
| Event-dispatch ENGINE WIRING — Phase A (`Supervisor.dispatchEvent`) | 2026-08-20 | decisions.md EVENT-DISPATCH-WIRING row (three-agent gate ADAPT-AND-PROCEED, docs/specs/event-dispatch-wiring-review.md; user go-ahead). TDD landed: red = `tests/unit/phases.test.ts` "Supervisor event dispatch" block (10 tests — target kinds, fork-arm once-fire + states grouping, unknown/destroyed → [], `#`-in-nodeId full-string-first resolution, same-(node,event) reentrancy guard vs different-event fires, containment, no-drain/no-propagation pins); green = `Supervisor.dispatchEvent` + `resolveDispatchTarget` in `src/core/supervisor.ts` (guard key `event:<event>:<nodeId>`). Trio green: 931 tests, typecheck, build, demo:smoke SMOKE OK (derived pins on-curve, 3× runtime tripwire passed). Docs: handlers.md §3, adapters.md §3.2 note, designing-pages §11, feature-summary §3.5, RENDER_PROCESS_NOTES §10.10.9. Phase B (SSR contract) stays user-gated; Phase C (MCP endpoint) parked spec-only |
| Retained-handler-map un-park (listener-removal + additive `on:` → replace semantics) | 2026-08-20 | decisions.md RETAINED-HANDLER-MAP row (three-agent gate APPROVED-WITH-CONDITIONS, docs/specs/retained-handler-map-review.md; user go-ahead). TDD landed: red = adapter.test.ts DOM-F5-flip + F6..F12b + `removeEventListener` on the adapters/legacy-shape-emit El shims + smoke-shim; green = `listeners` retained map in `src/core/adapters.ts` (DomAdapter only — replace attach, undefined detach, removeEl/dup-create purge). Trio green: 921 tests, typecheck, demo:smoke SMOKE OK (runtime:derived 2.44× < 3× tripwire; derived pins values 1.15/1.32/1.02× + link 1.96/1.03/0.43× vs 2.5× asserted — no pipeline regression). Docs: adapters.md §3.2/§3.7/§10 + S-R5.7 plus designing-pages §11 row |
| DEFECT #25 — SED-1 `type`-target collapse dropped the def's content + props (the live crafted nav links rendered text-less, href-less) | 2026-08-19 | defects.md DEFECT #25 FIXED row + designing-pages §2 letter extension + §11 (P-EMIT-11); both SED-1 collapse branches merge def content + props; TDD path-emit P-EMIT-11 red→green; adapted live render confirms all three crafted links emit nested with text + href |
| DEFECT #24 follow-up — the def-fill adoption chain only matched ROOT seam consumers (`[consumer, defRootProto]`); non-root consumers (the live nav slot) left placed links as top-level forest orphans | 2026-08-19 | defects.md DEFECT #24 FOLLOW-UP + designing-pages §11 (P-EMIT-10); the three def-fill chain sites build `[...(s.trace ?? [s.nodeId]), defRootProto.id?]` — full root-down minus the packet — verified on the adapted live envelope (all ten nav links nest); TDD path-emit P-EMIT-10 red→green |
| d14 scaling probes — depth 14 joins every fork-family depth set (the d12 totals are too fast to expose pipeline scaling) | 2026-08-16 | RE-SCOPED 2026-08-16 (user directive): the d14 pages are BUILT-BUT-NOT-SMOKE-RUN — built for every fork-family set (fork-stress-d14 / fork-stress-data-d14 / fork-stress-data-{placement,values,link}-d14 / path-fork-data-{placement,values,link}-d14; demo/path-fork-data.js + scripts/path-fork-page.mjs depth-parameterized, 2·depth−1 nodes, 2^depth−1 states) as manual/browser scaling probes, but the automated smoke (demo-smoke.mjs) runs the d12 family ONLY — depth lists 2..12, no d14 derived trio / single-method / banner / tripwire blocks (an O(n²) return flags on the d12 family; the d14 pages only made the smoke ~2m longer); the smoke harness ISOLATION (scripts/smoke-page-worker.mjs + smoke-shim.mjs) stays — it is the honest-measurement infrastructure for the d12 family too (the 3× tripwire was re-pinned on it; frames ~50MB+ at d14; stacked frames balloon the heap into GC storms, 15-min smoke with 95s-per-0.3s-page walls → ~2 min deterministic); fork-stress.js handler-marked census depth≥13; decisions.md D14-SCALING-PROBES row; fork-stress.md / fork-stress-data.md / placement-path-spec §5.1+§5.2 / designing-pages §11+§12 / AGENTS.md item-4 watch |
| Derived trio — the covered-leaf def-fill gate (DEFECT #21) + the values/link-derived pages + the family re-baseline (§8-Q6 split) | 2026-08-16 | render-helpers.ts `coveredChildless` gate (TDD: render.test.ts red→green); demo/path-fork-data.js method parameterization (values/link component fields, per-method checks, `[derived-fork:profile]`); scripts/path-fork-page.mjs + build-demo.mjs emit the three pages; demo-smoke.mjs `[derived-fork:baseline]` (per-region) + `[derived-fork:pin]` (2.5× per region) + unchanged runtime 2× tripwire; defects.md DEFECT #21 row; decisions.md DERIVED-TRIO row (supersedes the §8-Q6 single-baseline); pending.md parked forkKey-on-retyped row; placement-path-spec §5.2/§6.3/§8/§10.ad N-5/R-5; render.md DFC-1; fork-stress-data.md §4 + lessons 8-11; designing-pages §11/§12/§14.9; review LANDED note |
| Translate-stress probe mismatches (the 8 MISMATCHes) | 2026-08-16 | archive/analysis/2026-08-16/2026-08-16-translate-stress-classification.md — NO genuine engine defects (stale probe expectations predating the mixed-node seed + S19 duplex; archived scenario-doc prediction errors; the plain-consumer reverse drop is payload.md R-2's broadened letter). Probe updated to the classified contracts — 15/15 PASS |
| DEFECT #12 — ops/supervisor detach/move whole-family-link wipe | 2026-08-15 | defects.md FIXED row + decisions.md |
| DEFECT #13 — multi `handlers.*` seam layers collapse | 2026-08-16 | defects.md FIXED row (accumulation landed — verified live by stress round 5 S43; residue = DEFECT #16) |
| DEFECT #14 — seam handler layers leak into reverse as a zombie inline | 2026-08-16 | defects.md FIXED row (handler-seam reverse exclusion verified live; the distinct seed-layer double-emit = DEFECT #17) |
| DEFECT #15 — def-root `component` bindings silently dropped (N5 bypass) | 2026-08-16 | defects.md FIXED row (defRootData.component propagation verified live by stress round 5 S45; the def-child inert-anchor surface + the def-grandchild emission scope are now PINNED STANDING SURPRISES — defects.md #15 row + handlers.md §6) |
| DEFECT #16 — seam handler layer REPLACES the authored base handlers | 2026-08-15 | defects.md FIXED row (append-with-override merge per (name, event); tests D16; bridge round S45) |
| DEFECT #17 — SEED-LAYER LEAK: authored inline handlers double per reverse, COMPOUND per round-trip | 2026-08-15 | defects.md FIXED row (seed-mirror exclusion `!l.id.startsWith('seed-')`; tests D17; S45/S46/S47) |
| DEFECT #18 — seam-def body compile UNCONTAINED: non-evaluating body aborts the WHOLE compile | 2026-08-15 | defects.md FIXED row (per-entry try/catch in rebuildHandlerSeamLayer — `handler-body-invalid` warn + skip; tests D18; S44) |
| Externally-exposed named component access (the "hooks map" proposal) — three-agent gate + the CONTRACT AMENDMENT B value-slot landing | 2026-08-16 | **IMPLEMENTED 2026-08-16** — the §7.2 pin-6 TDD list landed red→green (tests/unit/hooks.test.ts, 20 tests): the `hooks: string[]` field on `LegacyNodeData`/`NodeBaseData` (baseFrom/nodeToLegacy/serialize round-trip + `hooks-shape-invalid` containment), the `hooks.<name>` state-slice branch (node.ts `applyHookSlice` — one deterministic `hook-<name>` replace-in-place layer, the anchor mirror `a.value = value` = the ONE source, `value: undefined` clears + restores the authored value via the layer's `hookFallback`), `providerValueFor`/`providerValueFromLink`/`hookWriteGuard`/`hookAnchorFor`/`isDefShapedValue` (resolve.ts) wired at the five read sites, the supervisor state-slice ENTRY gate (`hook-name-unresolved`/`hook-mode-blocked` rejections + `hook-seam-exempt` warn + no-op — the def/landmine guard), the SPA demo (demo/hooks-scenarios.{html,js} + scripts/hooks-scenarios-page.mjs — theme switcher / session panel / live counter; the controls' function-STRING bodies write through `clientAPI.apply`; the page checks pin the USER CONTRACT: `maxHookLayers==1` after N writes + the cascade re-renders). The seam-landing rule for the non-AUTH-SEAM def case stays parked (pending.md row) |
| Hooks → placement-driven ARRAY data injection (the §8a surface-exposure extension) — three-agent gate | 2026-08-19 | **PARKED 2026-08-19 → AMENDED BY CONTRACT AMENDMENT C the same day** — the gate verdict lands as `docs/specs/hooks-array-injection-review.md`: the as-stated shape is REJECT (structural §7-pin collisions — ENTRY/DISCRIMINATION: a passed prototype is def-shaped → `hook-seam-exempt`; arrays are already legal hook data; ROUND-TRIP: rows would ship twice; the E2E-3 cascade cannot reach the rows' consumers), the adapted contract is recorded (§5: a NEW `rows-mint` op, `AnchorDecl.value`, prototype-by-name via the component Link's def prototypes, no placement, the NODE-SCOPED `hook-${nodeId}-${name}-rows` namespace (DEFECT #23), per-batch journaling, mint-side cascade, rows-as-data round-trip, no-promotion teardown, PAYLOAD-CONTROLLED teardown). **AMENDMENT C (user directive 2026-08-19)** — four rulings validated VIABLE-WITH-PINS by the two-step amendment review (§9): (1) `hooksKind` kind discriminator on the hook declaration (`'value'|'component'|'placement'` + future — a NEW schema-known field, not a mutation of the shipped `string[]` contract; kind gates ops, write surface untouched; `hook-kind-mismatch`/`hooks-kind-shape-invalid`/`hooks-kind-unknown`/`hook-kind-unsupported`); (2) prototype-as-reference — the def node is never the hook target/data, external code passes a `prototypeName` into the rows-mint op (kills the `hook-seam-exempt` collision); (3) consumer = React feature parity (directed); (4) payload batching delimits the round-trip (minted children serialize-exclude, rows once, loadState re-mints, envelope = rows-as-data). Pins adopted: the batch storage cell RESOLVED as **Option C — a first-class `batches` NodeBaseData field** (user ruling 2026-08-19 — no anchor, so the `applyHookSlice` mirror has nothing to overwrite; rows-mint op is the only writer; `derived`/`handlers`/`hooks` ~4-site precedent), the multi-provider compile fan-out (resolve.js:330-344) MUST be bounded/measured/pinned before any demo ships. **FURTHER RULINGS 2026-08-19:** prototype staleness = FAIL-WITH-WARNING (`rows-prototype-unresolved`); rows-provider-conflict = NOT a failure mode (components resolve one value, placement zones shared by multiple payloads — the invariant is PAYLOAD IDENTIFIER UNIQUENESS → **DEFECT #23**, node-scoped layer id `hook-${nodeId}-${name}-rows`); `'placement'` kind = mint nodes with the SPECIFIED TARGET PLACEMENT + components; teardown/deletion = **PAYLOAD-CONTROLLED** (the `batches[name]` record is the single handle; removeLayer/teardownMinted/minted-set registry are INTERNAL); surviving §5 items (mint-side walk, no-promotion teardown, census, undo via payload-control, empty-batch-clear, same-layerId replace); cross-process re-mint + placement-kind op details = scenario-testing scope (§9.7). **§9.4 TDD list IMPLEMENTED 2026-08-19 (user's go-ahead, red→green — review §9.8):** `hooksKind` round-trip + containment; `hook-kind-mismatch`; the `rows-mint` op (prototype-by-name, per-row value-bearing source anchors, node-scoped layerId — DEFECT #23 FIXED, Option-C `batches` record round-trip, one journal entry per batch + mint-side consumer walk); payload-controlled teardown (`rows-clear` + no-promotion + undo); `rows: []` clear; `'placement'`-kind content-anchor mint. tests/unit/hooks-array.test.ts (24) — 882 tests green, typecheck clean, demo:smoke OK. **Remaining:** the pin-6 compile-fan-out measurement + the data-authored cascade demo page (both sides, census + profile pins). The §7 HOOKS row + all its pins survive untouched |
| §8-Q6 path-fork ratio re-baseline | 2026-08-16 | RE-BASELINED: the runtime guard now trips when the runtime placement total exceeds 2× the static path-fork baseline (the timer-drain fix made the runtime totals honest — old totals were 10-15× scheduler idle; the old 'static must not exceed runtime' comparison inverted and was retired). demo-smoke.mjs guard + [path-fork:baseline] marker updated; pending.md row retired |
| DEFECT #20 — destroyed adopted def children still emit (the blocked-def/nodeById emit path ignores the destroyed flag) | 2026-08-16 | defects.md FIXED row (the `defChildPruned` emit-time prune at every def-fill site + the blocked-def reTyped/childOrder filters; tests N4/N5) |
| AUTH-SEAM consumer model — the afterAssembly N5 carve-out + def phase handler copies to the type-target consumer + def-children re-homing + retention destroy | 2026-08-16 | decisions.md AUTH-SEAM row + legacy-bridge AU1-AU3 |
| Legacy-handler reuse — the §7 review decisions (8) | 2026-08-15 | pending.md PENDING row (all 8 decisions adopted/superseded/landed with the bridge; decision 8's rejects stand) |
| Origin-owner element (layer-apply op) | 2026-08-15 | decisions.md ORIGIN-OWNER + HANDLER-SEAM rows; ops.md §2.8 (OO-1..OO-7 pins) |
