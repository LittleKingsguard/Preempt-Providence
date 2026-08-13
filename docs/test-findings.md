# Test Findings — centralized log of blind-test & stress-test review loops

Status: LIVE document. Every major-feature blind test / subagent review loop
appends its findings here (same discipline as `docs/session-defect-review.md`,
but process-focused: what the review tool caught, what it missed, and the
rules it produced). The latest entries are on top.

---

## Stress-test review loop #2 — translate-layer kernel (subagent review loop)

Status: COMPLETE (review agent, step c of AGENTS.md item 10). Scenario
specs: `docs/specs/translate-stress-scenarios.md` (corrected expectations
marked `[reviewed]`); probe evidence: `scripts/translate-stress-probes/
RESULTS.md` + `run-all.mjs` (untouched, kept as evidence). Probe
methodology verified before adjudication: dist matches src at probe time
(`dist/core/translate.js` built after the last `src/core/translate.ts`
edit), the envelopes in `run-all.mjs` are byte-identical to the scenario
doc, and the one surprising result I re-derived from source (S2-E3's
cross-surface anchor order — `template.root.component` binds before
`template.component`) matches the probe's output. Each mismatch is
classified into exactly one of PASS / DOC-FIX / DATA-FIX / ENGINE-DEFECT.

### Per-scenario verdicts

| # | Verdict | Notes |
| --- | --- | --- |
| 1 | ENGINE-DEFECT #1 (self-apply half); PASS (trap + reverse halves) | cross-namespace caption/CAP trap CONFIRMED (binding NAME `caption` vs apply-path KEY `caption` are different namespaces); reverse + N1 + re-translate PASS (exact 4-binding array, anchors identical, warnings `[]`) — but "slotKey bakes self-val" FAILS: the node also carries a consumer anchor (`label`) → `resolveArms` path, `publishOwn` never runs (`node.ts:655-664`, requires `targetNames.length === 0`) → all three own-name synthesized reads null → `slotKey`/`caption` omitted on BOTH adapters. Violates translate.md §2.1's unqualified "self-provider ⇒ own value" |
| 2 | DOC-FIX (E2 order/numbering); E1+E3 PASS | E1 exactly one dup-reference warn, one anchor — PASS. E3 per-surface guard bypass confirmed (separate `seenReferences`/`seenTargets`), two `source:a` anchors + both syntheses, first-source-wins compile (bindings.a=2; w=2 z=2 bake), reverse keeps the first anchor only (K5 seenReferences — documented) — PASS. E2: mechanism right, ORDER wrong — strict array order makes the earlier binding's `component-duplicate-target` precede the later binding's `component-duplicate-reference`; the doc's 1-based "index 3/index 2" numbering was also wrong (3-element array). Guard order pinned in translate.md §2.1 |
| 3 | PASS | identical single warn, opposite kept halves, order-sensitive first-wins exactly as framed |
| 4 | PASS (doc sub-claim corrected) | RAW-string guard timing confirmed (`props.x` vs `props.x.` never dup-warns; edge binding skipped, no applyPath; control fires dup-target); the "warn array ORDER differs between the envelopes" prediction corrected — both produce the IDENTICAL single-element array; only anchor creation order differs |
| 5 | DOC-FIX | 13-path vocabulary partition, bare-`props` skip, `slash/ref` carve-out miss (literal `includes('.')` check), t14/u4 synthesis, both bakes, target-less reverse — all CONFIRMED. The "warns re-emitted on re-translate" claim was internally inconsistent with the doc's own reverse expectation (gap/skip bindings reverse WITHOUT target per K5 ⇒ nothing to re-warn); actual re-translate warnings `[]` — R-5 holds |
| 6 | PASS | object bakes `[object Object]` on both adapters while the compiled state carries the object (NP5); null provider publishes null but the bake omits the key (N3); both round-trip exactly; re-translate anchor-identical |
| 7 | DOC-FIX | exact 8-code order + 8 focused `console.warn`s + anchors + placement + zero live handlers CONFIRMED; "re-translate is NOT warning-clean" claim wrong — FULLY clean (vacuous `{}` produced no anchor; skipped/gap bindings reversed target-less; handler defs and `targetPlacement` gone; duplicate guards cannot re-fire — that half was right) |
| 8 | PASS | phase-first guard ordering confirmed; invalid body never handed to `new Function` (NP11 downgrade holds); reverse drops the def; re-translate clean |
| 9 | DOC-FIX | authored-wins silent skip + no applyPath + no reverse `target` CONFIRMED (loss real + permanent); "not anchor-identical" claim WRONG — round-trip IS anchor-identical (the loss happens on pass 1; pass 2 reproduces the same shape). Authored-collision data-loss chain now documented in translate.md §2.1 reverse-emission note |
| 10 | DOC-FIX (payload.md R-2) | drop CONFIRMED mechanically for the plain consumer `{reference:'y'}` AND the gap-warned variant `{y,target:'y'}`; R-2's letter ("a name-target (no apply path)") was narrower than the code's shape-based branch (`translate.ts:626`). Code is the sane behavior — a legacy plain consumer's graph shape is indistinguishable from the runtime two-name duplex (no provenance) — so R-2 broadened to "any applyPath-less non-provider (consumer) anchor coexisting with a provider anchor" |
| 11 | PASS | 3-provider K7 array: anchor order preserved through reverse, idempotent, self-scoped render, depth-0 publication |
| 12 | PASS | K6 nearest-shadows-far with root fallback: deep-consumer `"near"`, sib-consumer `"far"`, one arm each, NO fork; F3 drops both providers; reverse exact; re-translate clean |
| 13 | PASS | K7 multi-source root: one source per name, no fork (FRK-H1); F3 root drop vs self-apply bake; variant (consumers removed) bakes `prop:rt="RV"` |
| 14 | ENGINE-DEFECT #1 (compile half); PASS (three surfaces) | placement + component + handlers coexist and round-trip without interference — PASS as framed; but `props.x` does NOT bake ("self-provider ⇒ own value" fails — the node also carries consumer `b` → publishOwn bypass) |
| 15 | ENGINE-DEFECT #1 + DOC-FIX (R-2) | unicode/root-keyword references, `bindings.bindings`-style reads, silent-absent `target:''`/`target:42` all CONFIRMED harmless at translate (zero warns, 7 syntheses, 1 plain consumer); the bake half FAILS (`empty`'s consumer anchor → publishOwn bypass → all seven reads null); the reverse half drops `{reference:'empty'}` (same shape-based R-2 drop — DOC fix; `numb` survives) |

### Engine defects (do NOT fix in this loop — report only)

**DEFECT #1 — publishOwn bypass: a node carrying ANY consumer (target)
anchor never publishes its own provider values (S1/S14/S15)**

- Spec: translate.md §2.1 ("at a self-provider the applied value IS its own
  `value`"; row `props.<propertyName>`: "the node gains the synthesized
  derived read (apply of the RESOLVED value; at a self-provider that is its
  own value)"), §1 source-attachment note (provide-and-self-apply), TR-H2;
  review doc §2.2 K1 + §5-C ("the synthesized read is the resolved, per-arm
  value — which for a self-provider equals its own `value` (publishOwn
  `node.ts:640-647` runs before the derived bake)"). All unqualified.
- Observed vs required: `node.ts:655-664` routes ANY node with a target
  anchor through `resolveArms`, whose arm bindings carry only the CONSUMED
  names (`resolve.ts:167-255`); `publishOwn` runs only in the
  `targetNames.length === 0` branch. On a LEGAL K7 mix (distinct references
  + distinct targets — the §2.1 legality matrix says LEGAL, zero translate
  warnings) of "consume A + provide B (self-apply B)", the synthesized
  `{$:'bindings.B'}` read evaluates null (missing-key → null,
  `derived.ts:184-187`; omit-on-null `applyDerived`) and the self-apply is
  silently omitted from the compiled state and from both adapters'
  emission. No warning anywhere. Required per spec: the own-name read
  resolves to the node's own `value`.
- Repro: scenario 1 (`mix`: 3 providers + 1 consumer — `slotKey`/`caption`
  omitted), scenario 14 (`tri`: `props.x` never bakes), scenario 15
  (`names`: all seven bakes null because of the `empty` plain consumer).
  Pure-provider nodes are unaffected — spot-check-7's evidence holds (its
  node was target-less).
- Severity: MEDIUM — silent data loss in a legal, zero-warning
  configuration; the affected pattern (mixing a consumer and a self-apply
  on ONE node, different names) is legal legacy data whose legacy semantics
  (per-binding assembly) apply both halves. The showcase/demo surface uses
  pure providers/consumers, so real-world frequency is low — but the loss
  is completely invisible (no warn, key simply absent).
- Fix shape (future TDD pass, red → green): in the `resolveArms` path,
  seed each arm's bindings with the node's OWN source/duplex values
  (publishOwn semantics: `cs.bindings[ownName] = value` when undefined)
  alongside the consumed-name resolution. Red tests: S1/S14/S15 pins —
  mixed-node self-apply bakes; descendants' depth-0 reads and pure-provider
  behavior unchanged; no fork regression.

### Adjudication of the probe's five findings

1. **S1/S14/S15 — publishOwn bypass: GENUINE ENGINE DEFECT (above), NOT
   spec-scope.** Scope check: translate.md §2.1's "self-provider ⇒ own
   value" is not limited to pure-provider nodes by any wording; TR-H2 and
   the review doc's §5-C cite publishOwn as the MECHANISM, and the mixed
   node bypasses exactly that branch. The gate's spot-check-7 evidence
   still holds for pure providers (target-less nodes keep the promise) —
   the defect is scoped to consumer-bearing nodes. K8's duplicate rules
   constrain same-NAME mixes only; the failing config is the DIFFERENT-name
   mix (consume A, provide B, self-apply B), which the K7 legality matrix
   explicitly declares LEGAL. A spec carve-out ("self-apply requires a
   consumer-free node") would criminalize legal legacy data silently and
   contradict the legacy per-binding apply semantics; the engine-side fix
   is small and localized.
2. **S2 — warning order: DOC-FIX + pinned.** The actual order
   `[component-duplicate-target, component-duplicate-reference]` is the
   sane behavior: strict binding-array order with per-binding
   reference-then-target checks; element order dominates the per-binding
   sequence. Pinning in translate.md §2.1: YES — the warning stream is a
   consumer-facing contract and was previously order-unspecified; added.
3. **S5/S7 — re-translate warning-clean: DOC-FIX (scenario expectations),
   behavior is CORRECT and desirable.** Reverse is applyPath-only (K5): a
   gap/skipped target never carries an applyPath ⇒ its binding reverses
   target-less ⇒ nothing left to re-warn; re-translate is clean by design,
   and payload.md R-5 already promises "warnings never fire from the
   round-trip". S5's claim was internally inconsistent with its own reverse
   expectation; both scenario expectations corrected to the clean outcome.
4. **S10/S15 — nodeToLegacy drop broader than R-2's letter: DOC-FIX
   (payload.md R-2 broadened).** Code branch confirmed
   (`translate.ts:626`: `!isProvider && applyPath === undefined &&
   hasProvider`); the DECIDED plain consumer `{reference}` IS affected when
   it coexists with a provider anchor. The legacy plain consumer's graph
   shape is INDISTINGUISHABLE from the runtime two-name duplex the drop was
   designed for (anchors carry no provenance) — the code's drop is
   shape-forced, the sane behavior. R-2 now reads "any applyPath-less
   non-provider (consumer) anchor coexisting with a provider anchor".
   **Plain-consumer-twin guard decision: RECOMMEND a K8-style translate-time
   warn (candidate code `component-consumer-loss-on-reverse`) as a follow-up
   DECIDED** — the loss is silent and the config is legal under the current
   matrix, so a translate-time advisory (precedent:
   `component-target-placement`) is worth a future TDD pass. NOT implemented
   in this loop. The full alternative (a translate-set provenance flag that
   lets `nodeToLegacy` keep plain consumers) is a larger engine change;
   noted, not the recommended first step.
5. **S9 — idempotent round-trip: DOC-FIX + one line in translate.md §2.1.**
   The "not anchor-identical" claim was wrong: the authored-collision loss
   happens on pass 1 and pass 2 reproduces the same shape — the round-trip
   IS anchor-identical. The permanent loss is intended (K2 authored-derived-
   wins, no warn) but translate.md documented the K2 carve-out without its
   data-loss consequence; the chain (authored-wins ⇒ no synthesis ⇒ no
   applyPath ⇒ no reverse `target`) is now documented in the reverse-
   emission note.

### Doc/data fixes applied

- `docs/specs/translate-stress-scenarios.md` — corrected expectations marked
  `[reviewed]`: S1 (self-apply half re-recorded as defect #1; trap + reverse
  PASS), S2 (E2 warn order + numbering), S4 (warning-array-identical
  sub-claim), S5 (re-translate clean), S7 (re-translate clean), S9
  (anchor-identical), S10 (drop adjudicated; R-2 broadened), S14 (compile
  half re-recorded as defect #1), S15 (bake half → defect #1; reverse half →
  R-2 doc fix). No envelope data changed — no DATA-FIXes this pass.
- `docs/specs/translate.md` — §1 boundary note: reported-defect block for
  the publishOwn bypass ("self-provider ⇒ own value" currently holds only
  on consumer-free nodes; spec'd fix shape); §2.1: guard-order pin
  (finding 2); mapping-table row 7 + reverse-emission blockquote: R-2 drop
  broadened (finding 4) + authored-collision chain line (finding 5).
- `docs/specs/payload.md` — R-2 drop clause broadened to "any applyPath-less
  non-provider (consumer) anchor coexisting with a provider anchor"
  (finding 4).
- No changes to `src/`, `dist/`, `demo/`, or `scripts/translate-stress-
  probes/` (probe artifacts untouched as evidence).

### Validation trio (after the review edits)

- `npm test`: ALL PASSED (27 files, 539 tests)
- `npm run typecheck`: tsc --noEmit clean (exit 0)
- `npm run build`: tsc -p tsconfig.json clean (exit 0)
- `npm run demo:smoke`: all demo checks green; fork-stress-data d12 totals:
  placement 3943.7ms, values 4927.2ms (1.25×), link 5773.7ms (1.46×) —
  within ~1.5×, no pass-2 regression (docs-only review; no engine touched).

---

## Blind test #2 — translate-layer kernel showcase (subagent review loop)

### What the test was

A documentation-only writer produced `demo/translate-showcase.js` (+
`translateShowcaseServerData()`), `demo/translate-showcase.template.html`, and
`scripts/translate-showcase-page.mjs` — one legacy envelope exercising the
translate kernel K1–K8: the legal K7 array form (K1 synthesis +
provide-and-self-apply), a plain consumer of the root's K6 depth-0 provider,
duplicate-reference/duplicate-target pre-anchor blocks, vacuous `{}` vs valid
`[]`, unresolved-consumer key omission, the `props.name.` syntax edge, the
unknown-path gap warn, the dotted-reference carve-out, the K4 warnings
channel, and the K5/N1 reverse round-trip (PAR-5 expected page via
`SSRFragmentAdapter`).

The page reviewer wired the page into the build/smoke, verified intended-vs-
actual per card against `docs/specs/translate.md` §2.1/§5,
`docs/specs/legacy-component-ref-only-review.md`, `src/core/translate.ts`, and
`tests/unit/translate.test.ts`, and fixed data only.

### Findings (page reviewer)

1. **server-data script tag must carry `type="application/json"`.** The
   template's `<script id="server-data">` (no type) failed
   `extractScript` in `scripts/demo-smoke.mjs` (`missing <script
   id="server-data">`); every other demo template annotates BOTH embedded
   scripts with `type="application/json"`. Fixed the template annotation —
   this is the shared seed contract, not a smoke-script quirk.
2. **The page module compiled the tree twice; the first result was
   discarded.** `translated.root.compile(...)` ran at line ~170 with the
   result thrown away, then again at line ~173. The builder pipeline (and
   the `compileCalls=1` profile guard) contracts exactly one compile for
   the single bootstrap render. Removed the redundant call and made the
   profile line emit `compileCalls=1` (matches `feature-showcase`).
3. **No data-authoring fixes were needed.** All 9 cards, the warnings
   channel, and the reverse round-trip matched the pinned contract on the
   first pass (see per-card verdicts below).
4. **Doc drift from the writer's own claims**: `designing-pages.md` §11/§12
   claimed the page was "NOT yet wired into `npm run build`/`demo:smoke`
   (follow-up)" — stale the moment the reviewer wired it. Fixed; rule: the
   §11/§12 entries must state the wiring truth at the time the review loop
   reports complete.

### Per-card intended-vs-actual verdicts (independent probe, not page checks)

| Card | Intended (contract) | Actual (probe) | Verdict |
| --- | --- | --- | --- |
| #array-card | 3 legal bindings: K1 consumer apply, plain consumer, provider+self-apply; no warns | anchors `target:arrConsumer→props.apply-consumer`, `target:rootValue`, `source:selfApply→props.self-apply`; bakes `apply-consumer="arr-consumed"`; text `arr-consumed` (scalar first-wins) | MATCH |
| #consumer-card | plain consumer resolves root depth-0 provider (K6); authored derived bakes | text `root-provided`; `authored-bake="authored-literal"` baked (constant string is a legal DerivedExpr) | MATCH |
| #dup-card | dup ref + dup target blocked pre-anchor, first wins | anchors only `dupRef→props.keep1` + `dupTgt→props.shared`; keep2/other absent; warns ×1 each | MATCH |
| #vacuous-card | `{}` → `component-binding-empty`, no anchors, content renders | warn @ root.children[3]; no anchors; `vacuous-card-content` renders | MATCH |
| #empty-array-card | `[]` valid (K3 Array.isArray carve-out), no warn | no warn; content renders | MATCH |
| #unresolved-card | key omitted on null, content renders, no translate warn | `ghostRef→props.ghost` anchor kept; compile unresolved-reference; no ghost attr; content renders | MATCH |
| #syntax-card | `props.name.` → `component-target-skipped`, no apply, anchor kept | skipped @ root.children[6]; anchor `target:syntaxRef` w/o applyPath; no bake | MATCH |
| #gap-card | unknown path → `component-target-gap`, no apply | gap @ root.children[7]; anchor kept w/o applyPath; content renders | MATCH |
| #dotted-card | dotted ref → skip synthesis, anchor kept, resolves | skipped @ root.children[8]; `target:dotted.ref.name` w/o applyPath; text `dotted-value` | MATCH |
| Warnings channel | 6 warns, 5 codes (binding-empty 1, skipped 2, gap 1, dup-ref 1, dup-target 1) | exact set + paths as claimed | MATCH |
| Root | non-actionable (S-R2.5/F3 — providers consumed in-scope) | root NOT in SSR fragment; actionable = 9 cards only | MATCH |
| Reverse (R-2/R-5/N1) | apply path persists as `target`; name-target beside provider dropped; synthesized derived stripped; authored kept; re-translate clean | reversed bindings exact; re-translate warnings `[]`; **round-trip SSR fragment identical to the original** | MATCH |
| PAR-5 | SSR expected == live DOM modulo pathKey/ids | fragment embedded in server-data; page asserts baked attrs + content markers in both | MATCH |

### Validation

`npm test` (539 passed), `npm run typecheck`, `npm run build`, and
`npm run demo:smoke` all green; `translate-showcase: 28 passed, 0 failed`;
profile `translate=0.0ms compile=0.3ms render=0.3ms compileCalls=1 total=0.6ms`
(no pass-2 blowup — tiny page); fork-stress d12 guard: placement 3921.8ms,
values 4915.8ms (1.25×), link 5774.4ms (1.47×) — within ~1.5×, no regression.

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

> **Kernel landing note (translate-layer K1–K8 — supersedes several findings
> below):** the legacy translate kernel landed AFTER this blind test —
> `component.target` is now the LOCAL `props.<key>` apply path (K1/K2, with
> synthesized `bindings.*` derived reads; never a second component name),
> `component` accepts the K7 ARRAY form (multiple bindings per node — the
> "one component binding per node" format limit F5 identified is GONE),
> duplicate reference/target within a node's array are blocked pre-anchor with
> warns (K8), the additive K4 warnings channel ships on `TranslatedTree`,
> the root `template.component` mirrors the node mapping (K6), and reverse
> persists the apply path + strips synthesized derived (K5/N1,
> `tests/unit/reverse.test.ts`). Suite: 539 green (`tests/unit/translate.test.ts`
> 52 tests + the 8-test K5/N1 reverse unit). Findings F4/F5/F7 are annotated
> below; F2/F3/F6/F8/F9/F10 are unaffected by the kernel.

### Findings (authoring errors + real behavior)

| # | What the data author assumed | What the pipeline actually does | Class |
| --- | --- | --- | --- |
| F1 | derived paths may name any component reference (`bindings.kpi.revenue`) | derived path KEYS are single segments; keys with dots are REJECTED at validation (`derived-invalid`, `docs/specs/derived-state.md` §3) — reference NAMES may contain dots, derived PATH KEYS may not | A (data) |
| F2 | an in-tree provider resolves for any descendant consumer | in-tree sources resolve only at **depth-0 (root)** or **self**; a sibling/ancestor-of-nonroot source is invisible to consumers (S-R2.6) | A (data) |
| F3 | a provider node renders its value as text wherever it sits | a value-bearing SOURCE node is actionable (renders its own value) ONLY when alone/self-scoped; the moment a same-name TARGET exists in its scope the provider is dropped (fork multiplicity, S-R2.5) | A (data, semi-surprising) |
| F4 | a duplex node self-renders its source value | a duplex node renders from its TARGET resolution only; its source half serves consumers, not its own text (probe: duplex-alone → no self binding). **Kernel landing (partial supersession):** the runtime rendering claim STANDS, but the two-name duplex anchor shape is now legacy-unexpressible — `target` is a local apply path, never a second name (K1–K8). The showcase's duplex demonstration moved to provide-and-self-apply (`{reference, value, target: 'props.<k>'}` — K1/K2 synthesized derived), so the data-level "duplex from legacy" premise is superseded | A (data) |
| F5 | consumer-side fork arms are expressible from legacy data | the legacy format carries ONE component binding per node; a multi-provider fork (N arms) needs N sources on root → demonstrated imperatively in `demo/components.html`, not from a legacy envelope. **SUPERSEDED by K7 (kernel landed):** the legacy `component` ARRAY form now expresses N bindings per node — verified mechanically, a root expresses TWO sources via `template.component: [{reference: 'a', value: 1}, {reference: 'b', value: 2}]` (and any node via its `component` array), anchoring every binding (`tests/unit/translate.test.ts` K7: "array of N bindings anchors EVERY binding"; "template.component accepts the array form too"). CAVEAT: same-name repeats within ONE node's array are K8-blocked (`component-duplicate-reference`), so an N-arm fork for a SINGLE name still needs N provider NODES — expressible from a legacy envelope as N sibling children, each carrying its own binding | A (format limit) — SUPERSEDED by K7 |
| F7 | two sibling targets referencing each other trigger `circular-source` | a sibling pair can never borrow-walk into each other — both are just `unresolved-reference`. A REAL borrow-walk loop needs a provider chain that revisits a walk-path node (duplex parent→child cycle). **Kernel landing (mechanism updated, substance stands):** the parent→child cycle is now authored via the K7 ARRAY form — `loop-a` declares `component: [{reference: 'loop.x', value: 'A'}, {reference: 'loop.y'}]` (provider + consumer on one node) with its child `loop-b` mirrored — no duplex anchors needed (duplex is legacy-unexpressible); the walk revisits a path node and the arm drops as `loop` + `circular-source`, never rendered (the showcase's loop pair does exactly this) | B (reviewer-corrected: re-expressed in data) |
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
