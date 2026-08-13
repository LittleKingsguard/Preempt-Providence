# Test Findings — centralized log of blind-test & stress-test review loops

Status: LIVE document. Every major-feature blind test / subagent review loop
appends its findings here (same discipline as `docs/session-defect-review.md`,
but process-focused: what the review tool caught, what it missed, and the
rules it produced). The latest entries are on top.

---

## Blind test #1 — data-only feature showcase (subagent review loop)

### What the test was

The main agent wrote a data-only demo (`demo/feature-showcase.*`) **from the
documentation alone** — one legacy JSON envelope
(`LegacyInitialData`, `docs/specs/translate.md` §1) demonstrating as many
framework features as possible both isolated and combined, with **no page-side
feature logic** (handler bodies ship as function-STRING data instantiated by
`translateLegacy`; page module = core-only plumbing). No implementation
reading was allowed during authoring.

Two independent sub-agents then reviewed the artifacts:

- **Proofreader (docs)**: compared `docs/framework-feature-summary.md` and the
  `designing-pages.md` §11/§12 entries against code + specs; fixed doc
  inconsistencies.
- **Page reviewer**: tested the render, verified the expected output
  (`feature-showcase.expected.html` = SSR parity snapshot) against intended
  behavior, and fixed **data only** to produce the intended output — any use
  case needing an outside script/function was to be declared a data-authoring
  mistake.

### Findings (authoring errors + real behavior)

| # | What the data author assumed | What the pipeline actually does | Class |
| --- | --- | --- | --- |
| F1 | derived paths may name any component reference (`bindings.kpi.revenue`) | derived path KEYS are single segments; keys with dots are REJECTED at validation (`derived-invalid`, `docs/specs/derived-state.md` §3) — reference NAMES may contain dots, derived PATH KEYS may not | A (data) |
| F2 | an in-tree provider resolves for any descendant consumer | in-tree sources resolve only at **depth-0 (root)** or **self**; a sibling/ancestor-of-nonroot source is invisible to consumers (S-R2.6) | A (data) |
| F3 | a provider node renders its value as text wherever it sits | a value-bearing SOURCE node is actionable (renders its own value) ONLY when alone/self-scoped; the moment a same-name TARGET exists in its scope the provider is dropped (fork multiplicity, S-R2.5) | A (data, semi-surprising) |
| F4 | a duplex node self-renders its source value | a duplex node renders from its TARGET resolution only; its source half serves consumers, not its own text (probe: duplex-alone → no self binding) | A (data) |
| F5 | consumer-side fork arms are expressible from legacy data | the legacy format carries ONE component binding per node; a multi-provider fork (N arms) needs N sources on root → demonstrated imperatively in `demo/components.html`, not from a legacy envelope | A (format limit) |
| F6 | `css.id` coexists with the authored `id` prop | `css:id` **overwrites** `el.id` on render (adapters.md §3) — a node's DOM id becomes the css id | A (data) |
| F7 | two sibling targets referencing each other trigger `circular-source` | a sibling pair can never borrow-walk into each other — both are just `unresolved-reference`. A REAL borrow-walk loop needs a provider chain that revisits a walk-path node (duplex parent→child cycle) | B (reviewer-corrected: re-expressed in data) |
| F8 | `data-path`/`pathKey` in a static expected-output snapshot is stable | pathKeys bake minted node ids → ids differ per process; the SSR snapshot and a live browser never agree on `data-path` values (structure/content parity only) | B (inherent) |
| F9 | the smoke shim behaves like a browser DOM | shim `getElementById` returns only seeded elements, no `querySelectorAll`/`classList`/`Event` dispatch → DOM checks must walk the `#app` subtree and read attrs via `getAttribute` | B (test) |
| F10 | SSR renders handlers like the DOM binds them | SSR inlines `on:*` as attributes (`oninput="true"`); DOM binds real listeners via the `onEvent` seam (documented divergence, adapters.md §4.2) — smoke drives `dispatchEvent` directly, so the live listener path is browser-verified only | B (documented) |

Class A = data/authoring oversights (writer misread the model). Class B =
renderer/spec/browser divergences the test surfaced.

### What the review loop caught that the author missed

1. **F7 was a real doc-vs-behavior gap in the demo, not just a wording issue** —
   the author's "loop-safety" section never exercised `circular-source` at all.
   The reviewer re-expressed it in data (duplex parent→child chain) so the
   documented mechanism is actually probed.
2. The proofreader corrected 9 stale/incorrect spec references in the summary
   (`node.md §10/§8` not `§7/§5`, journal lives in `api.md §1–§3` + `ops.md §6`,
   `css:cssDef` is not a set-prop name — it flows only through the batch
   `styles` op, etc.).
3. Both agents independently re-verified the final gates:
   `npm test` (496), `npm run typecheck`, `npm run build`,
   `npm run demo:smoke` (`feature-showcase: 14 passed, 0 failed`; profile
   `compileCalls=1`, no pass-2 scaling blow-up).

### Process rules this blind test established

- After ANY feature/behavior change: run the **blind-test review loop** (§
  "Blind-test → subagent review" in AGENTS.md) as a documentation test and
  consistency check.
- A demo claim that cannot be satisfied from the data alone (needs a custom
  function/fixture) is a **data-authoring mistake** — re-express in data or
  drop the claim; never paper over it with page JS.
- Derived-path keys: single segments, no dots — even when reference names
  carry dots.
- Expected-output snapshots: assert structure/content, not minted ids or
  `data-path` values.
- DOM checks in pages must be smoke-shim compatible (subtree walk +
  `getAttribute`), or the smoke will lie to you.

---

## Stress-test review loop #1 — legacy-JSON compile/render breakage probes

Status: COMPLETE (review agent, step c of AGENTS.md item 10). Scenario specs:
`docs/specs/stress-test-scenarios.md` (corrected entries marked `[reviewed]`);
probe evidence: `scripts/stress-probes/RESULTS.md` + `run-all.mjs` (untouched,
kept as evidence). Each mismatch classified into exactly one of PASS /
DOC-FIX / DATA-FIX / ENGINE-DEFECT.

### Per-scenario verdicts

| # | Verdict | Notes |
| --- | --- | --- |
| 1 | PASS | 1000-level acyclic chain compiles actionable root-first (compile-horizon §6.1 — uncapped, cycle-only); leaf pathKey 1001 segments; SSR nests 1000 deep; serializeSlice round-trips |
| 2 | PASS | 10,000 children all attach in order (10,001 actionable, 10,000 appends); **perf note (not a defect):** `SSRFragmentAdapter.appendChild` rematerializes the owner's contentHtml per append (adapters.md §4.3, FRG-H22 — documented mechanism, no complexity contract) → ~O(n²) SSR apply (10k ≈ 3.5–4s); DOM adapter unaffected |
| 3 | PASS (doc claim fixed) | void-tag DOM/SSR divergence CONFIRMED as documented (adapters.md §4.3/FRG-F1/FRG-H20 void = openTag-only vs §3.4 DOM move semantics — the scenario's "SSR-F4 class" guess was wrong; both sides follow their own table); `type: 42`/missing-type doc claim fixed: `baseFrom` copies string types only → silent `'div'` fallback (translate.js/node.js), no `<42>/<undefined>` ever emitted |
| 4 | DATA-FIX | primary envelope could not translate — array literal `[1,2]` is not a legal `$eq` operand (DSL adjudication below); re-expressed with `$`-path operands (`data-eq` self-compare → `"true"`, `data-eq-null` vs missing binding → `"false"`); all other assertions (falsy bakes, null omission, `$concat` object stringify, F3 provider drops, sibling invisibility) verified green on the corrected envelope |
| 5 | DATA-FIX | scenario text claimed `x-consumer` is a descendant of `du2`; authored JSON placed it as a root SIBLING → moved under `du2` in the envelope; corrected expectation verified green (`data-resolved="duplexval"`); everything else (root duplex self-bind, du2 unresolved `y`, y-source dropped) already matched |
| 6 | DOC-FIX | (a) "one circular-source warning" → the warnings array is per-dropping-node: 6 total (triangle 4 + linear 2), matching node.md warnings shape + api.md T13; (b) "consumer still renders its own state" → a loop-dropped arm exposes NO actionable state (api.md T13, S-R3.10) so tri/lin-consumers render NOTHING; only the unresolved-reference class renders (S-R4.3 — lin-p2..p10 do). Depth-cap-counts-as-loop is DOCUMENTED (pipeline.md §2.1, node.md FS-7, compile-horizon §6.4) — not a defect |
| 7 | ENGINE-DEFECT #1 + DOC-FIX | 5 fork arms compile with distinct `cs.forkKey`s but `emitOne` never forwards them → ops carry NO forkKey; scenario's "5 creates for ONE wire" premise corrected to the documented per-arm wire scheme `<nodeId>#<0..4>` (fork-stress.md); arm order is LIFO (m5→m1), all values present |
| 8 | PASS (prose fixed) | outcome matches (one actionable arm, `rootval`, no warnings); mechanism differs from scenario prose — the unplaced provider is never enumerated (D5 root fallback wins the ancestor walk first); the "arm terminates unplaced → silent drop" branch never fires; prose corrected |
| 9 | PASS | nearest-shadows-far: deep-consumer binds `"near"`, one arm, no fork; root duplex self-binds `"far"`; near-provider dropped (F3) |
| 10 | DATA-FIX (premise) | "placement multiplicity forks like components (P3)" is NOT expressible from a static legacy envelope — placement resolution is `attach` op + compile (api.md §4); P3 forks materialize only dynamically. Corrected expectation (each slot = one state, own wire; both render; unicode/dot/space names minted verbatim; dual-slot no role-mismatch, provides `dual`) verified green |
| 11 | PASS | translate throws a RAW SyntaxError (code=none — undocumented crash surface confirmed, not a structured guard); containment, observation-only returns, duplicate-handler double fire, event/phase cross-fire all confirmed |
| 12 | DATA-FIX + DOC-FIX | array-literal `$eq` re-expressed (see #4); "serialized authored state keeps authored-value untouched" corrected — `serializeNode` omits ALL derived-declared keys from shipped props (derived-state.md §2), probe: shipped keys = `["id"]`; pass-1 canon keeps it (DV-H5). Corrected envelope verified green incl. `data-eq=true`, root F3-dropped |
| 13 | ENGINE-DEFECT #2/#3 | expected output was SPEC-consistent (R6/HLP-H1/H13, DOM-H12/H13, FRG-H17); the canonical emit path leaks `css.cssDef` as a `css:cssDef` set op and never emits a `styles` op → DOM: cssDef attribute, NO style element; SSR: stylesBuffer block with `[object Object]`; two surfaces diverge for one op stream (SSR-F4 class) |
| 14 | PASS | escapeText/escapeAttr tables exact (`&` `<` `>` text; `&` `"` `<` `>` attrs); unicode verbatim; newline/tab preserved; PAR-5 structural parity holds (on:* skipped); handler body with escaped quotes dispatches unmangled |
| 15 | PASS | payload items unplaced/inert (no render, no warnings, no eager compile); pc1/pc2/pc3 anchors minted; duplicate literals mint two distinct nodes (TR-3/TR-4) |
| 16 | PASS | clientConfig mapping exact for all four envelopes; unmapped gates inert (TR-F2); serializeSlice preserves the 2-field shape |

### Engine defects (do NOT fix in this loop — report only)

**DEFECT #1 — `emitElements` drops `cs.forkKey` (fork-arm ops carry no forkKey)**
- Spec: render.md §3.1 (MinimalElement contract: "forkKey present on
  actionable fork arms (S-R3.10); forwarded onto emitted create/set/remove
  ops"; op table: "forkKey present only on actionable fork-arm emits");
  contract.md §render ("diffMinimal … forwards an element's forkKey (when
  present) onto the create/set/remove ops it emits"); adapters.md §10.3
  HLP-H16 ("a compiled fork … ops carry distinct forkKeys per arm (S-R3.10):
  one create per arm with a distinct forkKey, and each arm's set ops forward
  the same forkKey as its create"); S-R3.10.
- Observed vs required: `emitOne` (dist/core/render-helpers.js:212-273)
  returns MinimalElements `{ wire, type, props, childOrder }` without
  `forkKey`, so `diffMinimal` emits create/set ops with NO forkKey (probe
  scenario 7: creates have forkKeys=false, set-ops-with-forkKey=0). Required:
  each fork arm's element forwards `cs.forkKey` (exactly what
  `minimalFromState` does at render-helpers.js:18-19).
- Repro: scenario 7 — one consumer, 5 descendant providers; 5 actionable
  states with distinct `cs.forkKey`s; op stream has none; arms stay distinct
  only via the `<nodeId>#<i>` wire suffixes.
- Severity: MEDIUM. Mounting stays correct (documented emitElements arm-wire
  convention, fork-stress.md, masks the gap), but the op contract, the
  adapters' forkKey-keyed addressing (DOM-H27 "a set carrying a forkKey
  targets only that arm"; wireKey composites), `treeSig`'s forkKey dimension,
  and applyOps cross-batch fork identity are all unexercised by the canonical
  path.
- Fix shape (future TDD pass): in `emitOne`, forward
  `s.forkKey` onto the element in every return branch (mirror
  `minimalFromState`); red test: `Node.compile` → `emitElements` →
  `diffMinimal` on a 2+-arm fork asserts each arm's create AND its set ops
  carry distinct forkKeys equal to `cs.forkKey`.

**DEFECT #2 — `emitElements` leaks `css.cssDef` as a `css:cssDef` set op (R6/HLP-H1/H13 violation)**
- Spec: adapters.md §3.2/§4.2 + §10.3 HLP-H1/H13 (`css` → `css:*`
  EXCLUDING `cssDef` — "cssDefs flow via the styles op, R6");
  render.md §3.1 ("cssDef flows via the styles op, not here"); R-ORD-6
  (≤1 `styles` op per batch).
- Observed vs required: `emitOne` (render-helpers.js:217-218) maps `s.css`
  verbatim — including `cssDef` — into a `css:cssDef` set op; the R6
  exclusion exists only in `minimalFromState` (render-helpers.js:10-12), and
  NO `kind:'styles'` producer exists anywhere in dist/core, so legacy
  cssDef data never reaches a `styles` op. Required: `cssDef` must not
  appear as a set op; it flows via the (R-ORD-6 coalesced) `styles` op.
- Repro: scenario 13 — DOM renders `cssDef="[object Object]"` attribute and
  NO style element (DOM-H12/H13 unmet); SSR renders a
  `<style id="preempt-dynamic-styles">` block containing `[object Object]`.
  Same op stream, two different surfaces — the exact SSR-F4 class the
  spec forbids.
- Severity: MEDIUM. Deterministic (no crash), but PAR-5 parity is broken for
  the css surface on the canonical legacy path.
- Fix shape (future TDD pass): exclude `cssDef` in `emitOne` exactly as
  `minimalFromState` does, AND decide the R6 producer leg — either
  diffMinimal D5 emits one coalesced `styles` op per batch for
  cssDef-carrying elements (per R-ORD-6), or the payload is dropped at emit
  (spec decision required); red test: legacy envelope with `css.cssDef` →
  ops contain NO `css:cssDef` set; the cssDef payload arrives via exactly
  one `styles` op; DOM has exactly one style element (DOM-H12/H13) and SSR
  the same block.

**DEFECT #3 — `SSRFragmentAdapter` routes arriving `css:cssDef` sets into the styles buffer, contradicting its own §4.2/§4.5 fallback**
- Spec: adapters.md §4.2 ("if a `css:cssDef` set still arrives it is treated
  as a `css:<other>` attribute `cssDef="…"` (legacy-unsupported,
  deterministic)" — mirrors §3.2) and §4.5 ("`css:cssDef` sets do not feed
  this buffer (R6 — removed)").
- Observed vs required: adapters.js:207-208 — `if (key === 'cssDef')
  this.stylesBuffer.push(String(val))`; required: `cssDef="…"` attribute on
  the fragment, nothing in the buffer.
- Repro: scenario 13 (only reachable through defect #2's invalid op).
- Severity: LOW–MEDIUM (invalid-emit fallback only, but the two adapters'
  documented fallbacks for the same op are then diverging: §3.2 attribute vs
  §4.2 attribute-required).
- Fix shape (future TDD pass): mirror the §3.2 branch (escapeAttr attribute
  `cssDef="…"`), drop the stylesBuffer push; or amend §4.2/§4.5 if the
  buffer routing is the wanted behavior — review recommends the attribute
  fallback so both adapters agree.

### DSL-conflict adjudication (scenarios 4/12 — array-literal `$eq`/`$gt` operands)

**The validator (and the spec) give; the scenario docs were wrong.** The
`DerivedExpr` grammar in derived-state.md §3 lists literals as
`string` / `number` / `boolean` / `null` ONLY — an array is not a literal,
so an array operand makes the expression malformed. `validateExpr`
(src/core/derived.ts:56-58) rejects arrays as operands at every declaration
boundary (`derived-invalid: malformed derived expression: [1,2]`), matching
§7's fail-fast list; tests/unit/derived.test.ts:396-443 pins the gate (valid
`$eq` operands are scalar literals or `$`-paths; no array-literal operand
exists in the valid set; deep equality is tested via two `$`-paths, line
129). Deep-ARRAY `$eq` remains expressible through `$`-paths (`deepEquals`
handles arrays, derived.ts:133-139) — both scenarios are re-expressed that
way and verify green. The DSL's "JSON-deep equality" meaning row describes
the EVALUATION of valid operands, not a license for array literals. Classed
DATA-FIX (scenario data), not a spec or engine change.

### Adjunct assessments requested by the review brief

- **Scenario 6 semantic conflation (depth-cap trips reported as
  `circular-source`)**: DOCUMENTED behavior, not a defect — pipeline.md §2.1
  ArmDropReason `'loop'` ("loop-guard/depth-cap trips count AS loop — log
  'circular-source'"), node.md §2 + FS-7, compile-horizon-review.md §6.4
  ("provider chain ≥ 9 hops → drop"). The scenario doc's "semantically
  false" note stands as a DECIDED label quirk (a depth drop and a true cycle
  share the `loop` reason); it is pinned in the docs, so no code change was
  implied and none is proposed.
- **Scenario 2 SSR O(n²) append**: documented mechanism (adapters.md §4.3
  rematerialize-per-append, FRG-H22), no complexity contract exists, output
  correct, pre-existing — perf note only, not an engine defect.
- **Scenario 3 void-tag DOM/SSR divergence**: documented on both sides
  (FRG-F1/FRG-H20 vs §3.4) — inherent DOM-vs-string semantics, not an
  engine defect; the scenario doc's "exactly the class SSR-F4 forbids" guess
  was corrected.

### Validation trio (after the review edits)

- `npm test`: ALL PASSED (27 files, 496 tests)
- `npm run typecheck`: tsc --noEmit clean (exit 0)
- `npm run build`: tsc -p tsconfig.json clean (exit 0)
- `npm run demo:smoke`: all demo checks green (no engine/demo/test files
  touched by this review; probe artifacts unchanged)

Corrected-envelope re-verification (scenarios 4/5/12) run against
`dist/core/*` via a standalone core-only script: 27/27 checks pass — see
the `[reviewed]` entries in `docs/specs/stress-test-scenarios.md`.
