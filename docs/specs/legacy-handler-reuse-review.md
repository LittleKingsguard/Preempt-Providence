# Legacy Handler Reuse — Change-Analysis Verdict (three-agent gate, step 3)

Status: design review of `docs/specs/legacy-handler-reuse-proposal.md` through
the three-agent gate (AGENTS.md item 9). No code changed (read-only pass).
Companion context: `docs/specs/handlers.md` (§6 D6 TODO),
`docs/specs/translate.md` (§2/§2.1 target vocabulary, K1–K8, D7 seam),
`docs/specs/api.md` (§1/§3.3 state-slice + placement block), `src/core/handlers.ts`
(dispatch arg order), `src/core/node.ts` (`applySlice`:1169, parent getter:446,
family-children seam skip:456-469), `live-prod/placeholderLanding/FINDINGS.md`
(D6/D7), `docs/decisions.md` (D6 row), `docs/defects.md`,
`archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md`
(Appendix E.3 — the `handlers.<event>` "NO engine seam" verdict, N5 phase
DECIDED), `archive/reviews/2026-08-15/2026-08-15-compile-horizon-review.md`
(format model).

> **Pass provenance note:** the step-1 validity findings and step-2 critique
> documents for this proposal were not persisted as files before this pass; the
> critique's verdict, its named findings (finding 13 — QueryUtils placement;
> finding 15 — implementation surface), and its 8 predicted user decisions are
> reconstructed here from the gate directive's summary + direct verification
> against the codebase and specs (the "Grounding" section). This review is the
> record of the gate.

## 1. What the proposal asks

Given the core engine's handler logic (`dispatchEvent`/`dispatchPhase`,
`HandlerContext`) and node traversal (anchor graph, `tree.getNode`/
`ancestorsOf`/`descendantsOf`), can the LEGACY handlers — written against the
old query-utils + ClientAPI surface — be repurposed in the existing engine,
and if not, what changes to the engine, the API layer, or the handler logic
are needed? Four options: A (runtime bridge, bodies unchanged), B (D6 wiring
seam + hand re-authoring of bodies), C (translate-time source transform),
D (full compat surface: A + userData + compile-time wiring).

## 2. Feasibility verdict

**PROCEED-WITH-CHANGES.** The step-2 critique's core verdict is correct and is
adopted as the coherent contract: **the reuse is only coherent as Option A
minus children-injection**, with four mandatory components — (1) the
**wiring seam** for `handlers.<event>` targets + `{name, body}` defs (the D6
un-park, translate-time planning + D7-style materialization), (2) the
**arg-order body wrapper** (legacy `(event, context)` → new
`(ctx, ...args)`) with a provenance-derived **data-format marker**, (3) the
**reverse contract** (defs stay in `template.component`; seam-minted handler
layers never double-emit; K3 supersession), and (4) the **per-member context
passthrough** (real `supervisor`/`clientAPI`/`tree` pass through; only `node`
is proxied; `userData` read-only). **Cut candidates, all confirmed as cuts:**
children-injection (structured rejection), userData writability (read-only),
phase mapping (already DECIDED excluded — N5/K8 `handler-phase-unknown`),
the `children-replace` composite op (no new engine op), Option C (source
transform — fragile, bodies are trusted code, dominated by A), Option D
(full compat — engine pollution without proportional benefit).

**Per-option verdict:**

| Option | Verdict | Why |
| --- | --- | --- |
| A — runtime bridge | **ADOPT, scoped (A′):** A minus children-injection + the four mandatory components | The only option delivering the user's stated goal (verbatim reuse). Feasible with ZERO engine-dispatch changes: the wrapper installed at translate adapts the call, the context factory runs at dispatch, QueryUtils walks `ctx.tree`. Verified: every mapped member has a working seam (below) |
| B — wiring seam + re-authoring | **FALLBACK**, not the primary path | Cheaper ONLY for a ≤2-page corpus; the known corpus (placeholderLanding, 6 defs) splits 1 fully verbatim / 3 mostly-verbatim / 2 with unmappable calls — re-authoring those is a data task with zero engine surface, but it abandons the user's verbatim-reuse framing and every future legacy page pays again |
| C — translate-time source transform | **REJECT** | Regex/AST rewriting of trusted-developer JS is error-prone; A achieves the same bodies-unchanged outcome at the call boundary with a deterministic wrapper. No new machinery wins |
| D — full compat (compile-time wiring + formal session surface) | **REJECT** | Compile-time attachment per compiled state re-litigates the phase-mapping and pass-2 questions the engine already closed; `supervisor.userData` would require a new session-data channel that nothing else uses |

### The recommended coherent contract (A′)

1. **Translate** classifies handler-def-shaped bindings (shape: `value` is an
   object with a non-empty string `name` + a `body` that is a string or
   function; or a bare `{name, body}` with no `reference`) as **handler defs**
   — registered by `name` — and plans `target: 'handlers'` /
   `target: 'handlers.<event>'` bindings like the D7 seam targets (no
   `component-target-gap` warn; seam target persisted on the anchor options,
   F17-style). Genuinely vacuous bindings (`{}`, `{reference: ''}`, …) keep
   firing K3 `component-binding-empty` — **K3 is superseded only for the
   handler-def shape**.
2. **Assembly/compile** resolves the consumer's `handlers.<event>` binding by
   reference, and registers the resolved def's body on the consumer node as a
   **provenance-marked handlers LAYER** (`{name, event: '<suffix verbatim>',
   body: wrappedBody}` — the new HandlerDef contract; event name = the target
   suffix verbatim, no normalization: `handlers.click` → `'click'`,
   `handlers.onLoad` → `'onLoad'`). The D7 seam machinery (`addLayer`/
   `reconcileAnchors`) is the pattern; this is the D6 fix-shape from
   `live-prod/placeholderLanding/FINDINGS.md` minus the re-authoring carve-out.
3. **Body wrapping (the arg-order wrapper):** every body installed through a
   `handlers.<event>` seam target is wrapped at translate as
   `(ctx, ...args) => legacyBody(eventStub(ctx, args), legacyContext(ctx))`.
   The **data-format marker is provenance-derived**: seam-installed bodies are
   legacy `(event, context)` convention (the envelope's bodies prove it);
   inline `NodeData.handlers` bodies stay modern `(ctx, ...args)` convention
   (the demo surface's string bodies). An explicit per-def `format:
   'legacy' | 'modern'` field may override the default and is persisted by
   `nodeToLegacy` (K5-style) so re-translate reproduces the same wrapping.
   `eventStub` = `{ type: <event>, preventDefault(){}, stopPropagation(){},
   target: nodeView, isTrusted: false }` (+ `value: args[0]` when present) —
   legacy bodies call `preventDefault()` and read form values; the demo
   dispatch never forwards a real DOM event into `args` (`handleDomEvent`
   forwards the input VALUE, not the event).
4. **The per-member context passthrough:** `legacyContext(ctx)` returns a
   per-dispatch object whose members are individually decided:
   - `node` — the **NodeView** proxy (§5) — the ONLY adapted member.
   - `supervisor` — the real `Supervisor` (passthrough) plus a **read-only**
     `userData` member (captured by the wrapper's closure from
     `TranslatedTree.userData` at translate — the supervisor itself has no
     userData, verified); a legacy `supervisor.userData` WRITE is a contained
     no-op (strict-mode assignment failure surfaces in the dispatch results).
   - `clientAPI` — the real `ClientAPI` (passthrough); missing legacy-only
     members (`fetchContent`, `fetchHandlers`, `modifyNode`) surface as
     descriptive errors via a thin Proxy — never silent `undefined` calls.
   - `rootNode` — the root `Node` (read-only), used by `enterEditMode`.
   - `states`/`tree` — passthrough from the scoped context.
5. **Writes through the bridge:** `receiveNextState({type|content|props|css|
   handlers})` maps onto `clientAPI.apply(nodeRef, state-slice)` — verified
   mappable (`applySlice` handles `'type'` today, node.ts:1175). `css.style`
   is the one honest drift: legacy bodies read/spread `css.style` as an
   OBJECT while translate serializes it to a kebab string (D3). The NodeView
   **parses style strings back to objects on read (the F7 parse) and
   serializes on write (the D3 grammar)** — documented, provenance-free, same
   contract as reverse translate. **`receiveNextState({children})` is
   REJECTED with a descriptive structured error** (`legacy-children-write`
   class) — children are graph-derived, never a layer target (api.md §1); the
   composite op is NOT built. Direct array/map mutations on returned views
   (`node.children.pop()`, `targetComponents.delete`) are tolerated graph
   no-ops — they mutate the returned copy/getter result, never the graph;
   documented.
6. **Dispatch:** NO change to `dispatchEvent`/`dispatchPhase`. The seam-minted
   layer lands on the consumer's compiled `handlers` (the dispatch source,
   handlers.md §1) and the wrapper does the rest. The legacy phase names are
   NOT mapped (N5 DECIDED stands): `handlers.afterAssembly`-style targets and
   def `phase` values that are legacy lifecycle names warn `handler-phase-unknown`
   + skip as today. Event-only reuse is the decided scope.

## 3. Grounding (verified against code + the envelope)

| Claim | Verified |
| --- | --- |
| New dispatch calls bodies `(ctx, ...args)` | `handlers.ts:104` `handler.body(scoped, ...args)` — arg order is the REVERSE of legacy `(event, context)` ⇒ wrapper mandatory |
| Legacy bodies really are `(event, context)` and use the legacy API | placeholderLanding defs: `AuthInitHandler` (userData READ, `receiveNextState` ×1 incl. `type`, children-array mutation, component-map mutation), `LogoutHandler` (fetch/location ONLY), `ToggleUserDropdown` (`findNode({classes})`, parent walk, css read/write incl. style OBJECT spread), `enterEditMode` (`event.preventDefault()`, `fetchContent`/`fetchHandlers`/`rerun` — no new-system analog), `showComments` (css write + **`receiveNextState({children})` write**), `toggleCommentsButton` (`window.Preempt.contentData` read, css write) |
| Defs are reference-keyed sources whose value is `{name, body}` | envelope: `{"reference": "AuthInitHandler", "value": {"name": "AuthInitHandler", "body": "(event, context) => …"}}`; consumers bind `{reference, target: 'handlers.<event>'}` |
| `state-slice` covers type/content/props.*/css.*/handlers | `node.ts:1169-1190` `applySlice` — incl. `targetProp: 'type'` (proposal Q2 answered: no engine extension needed) |
| `children` is never a legal layer target; placement blocked | api.md §1 `LayerMutation` (`'children'` NEVER legal) + §3.3 (`placement-target-blocked`) |
| `handlers.<event>` has NO engine seam today; e2e wires manually | translate.md §2.1 row + Appendix E.3 of the legacy-component-ref-only review (`component-handler.test.ts:101`); D6 parked in handlers.md §6 |
| Legacy phase names already DECIDED unsupported | N5 DECIDED (legacy-component-ref-only review §E.3): `handler-phase-unknown` at translate, closed 3-set (translate.ts:177); proposal Q6 answered — phases stay EXCLUDED |
| `supervisor.userData` does not exist | `userData` lives only on `TranslatedTree`/payload (translate.ts:917); no Supervisor member |
| `css.style` object↔string drift is real | translate D3 serialize / F7 parse (translate.md §2); `node.css.style` at compile is the serialized STRING |
| NodeView parent chain already terminates at tokens | `node.ts:446-454` — string-token parents return `null`; the proxy delegates |
| Seam multi-parent semantics already pinned for children | `node.ts:456-469` — family children walk SKIPS seam parents (G26/F19); the proxy delegates |
| `applySlice` on a `{name, body}`-shaped def currently fires K3 at root | handlers.md §6 (defs without `reference`); `translate.ts:456` warn site; K3 tests pin the VACUOUS shapes only (`{}`/42/`''`), so the supersession is additive, not a test flip |

## 4. The reverse contract (round-trip, no double-emit)

1. **Defs stay in `template.component`** exactly as authored
   (`{reference, value: {name, body}}` — they already reverse as source
   anchors with their value; the handler-def classification is a
   translate-time recognition, not a new serialized shape).
2. **Consumers emit the binding, never an inline handler:** the seam-minted
   handlers LAYER on the consumer carries provenance (the def reference + the
   seam target, F17-style on the anchor options); `nodeToLegacy` emits the
   consumer's `component: [{reference, target: 'handlers.<event>'}]` (the
   DEFECT #6/K5 target-emission branch extended to seam targets) and STRIPS
   provenance-marked handler layers (F-13-style strip) — so `node.handlers`
   (authored inline handlers) emit as `nodeData.handlers` and seam handlers
   NEVER double-emit. Re-translate of the reversed doc reproduces the same
   plan (TR-H16's promise).
3. **K3 supersession:** the handler-def shape (`{name, body}` value, or bare
   `{name, body}` with no reference) stops firing `component-binding-empty`
   and registers by name instead; genuinely vacuous bindings keep the K3
   warn. Additive — no existing K3 test flips (verified: K3 pins use
   `{}`/42/`''`).
4. **Tracker rows:** `docs/decisions.md` — the D6 row ("handler defs parked")
   is **SUPERSEDED** by the new DECIDED (seam landed; the K3 dead-as-components
   note dies); handlers.md §6 TODO resolves; `docs/defects.md` gains the
   fixed-defect row (D6-class: dead handler defs now wire; the K3 misfire for
   the def shape retired); `RENDER_PROCESS_NOTES.md` §10.10 gains the DECIDED
   entry; designing-pages.md §11 matrix row (handlers.test.ts row + translate
   row) + §12 demo list update.
5. **Round-trip pin:** a round-tripped envelope (translate → reverse →
   re-translate) is ANCHOR-IDENTICAL: the consumer's seam anchor emits
   `{reference, target: 'handlers.<event>'}` (same event suffix), the def
   stays, no inline handlers materialize, no warnings fire.

## 5. The NodeView proxy contract (pinned)

1. **Identity:** one view per live node, cached in a module-level
   `WeakMap<Node, NodeView>` — `context.node` is the SAME view object across
   members of one dispatch, across dispatches, and across wrapper invocations
   (legacy bodies compare/attach to nodes); the WeakMap never leaks the live
   `Node` into page scope.
2. **Members:** `parent`, `children`, `css`, `data`, `findNode`, `findNodes`,
   `receiveNextState`, `targetComponents`, `sourceComponents`, `type`,
   `props`, `content`, `handlers`. Top-level value getters delegate to the
   node's compiled pass-1 getters (handlers.md §2.1); `data` = `{ type, props,
   css, content, handlers }` getter-backed (children NOT in `data` — D5:
   graph-derived, never stored); `targetComponents`/`sourceComponents` are
   READ-ONLY maps of the node's anchor reference names (legacy bodies read
   them; writes are graph no-ops).
3. **Token-parent termination:** `parent` delegates to the node's getter,
   which already returns `null` for string-token parents
   (`rootNode`/`contentNodes`/`component`) — a legacy parent walk terminates
   at the token, never observes a synthetic token node (pin: proxy must NOT
   fabricate a token node to walk through).
4. **Multi-parent (seam) semantics:** `children` delegates to the family
   children walk, which SKIPS seam-wired parents (node.ts:456-469) — seam
   def-children are NOT in `node.children`; they render through the compiled
   child-order (D7/SED-2) and are reachable via `tree.getState`/the render
   surface. Pinned so a legacy `node.children[0]` reliably addresses the
   AUTHORED child (what the envelope's bodies actually do).
5. **`css` style drift:** the `css` getter returns the F7-parsed style object
   (string → `Record<string,string>`); `receiveNextState({css: {style:
   {...}}})` re-serializes via the D3 grammar before the slice. Documented
   divergence-in-favor, same contract as reverse translate.
6. **Writes:** `receiveNextState` maps to `clientAPI.apply` state-slices
   (type/content/props.*/css.*/handlers); `children` in the payload rejects
   with a structured error; placement-affecting keys reject via the existing
   `placement-target-blocked`. Throw containment comes free (dispatch
   containment, handlers.md §3).

## 6. QueryUtils — decision: ADAPTER-INTERNAL, not an engine primitive

Adopt the critique's finding 13: **a helper inside the legacy-handler module
(adapter-internal), NOT an engine primitive.** The engine's canonical surface
stays id-keyed (`tree.getNode`); the legacy query vocabulary is a compat
concern. It walks `ctx.tree.allNodes()`/`descendantsOf` (subtree scope =
`findNode` on the view's node) matching **honest keys with honest semantics**:

| Key | Semantics | Status |
| --- | --- | --- |
| `type` / `id` / `classes` / `props` | direct compiled getter matches | FULL SUPPORT |
| `style` | F7-parsed style object, deep-equal match | SUPPORT (same drift handling as §5.5) |
| `handlers` | matches nodes whose compiled handler names include the query value | SUPPORT (name-level only — bodies are not comparable) |
| `components` | matches nodes whose anchor reference names include the query value | SUPPORT (reference-name-level — legacy `sourceComponents`/`targetComponents` maps have no other analog) |

A query that asks for a key outside this vocabulary (or a non-string value on
a string key) **warns** (`legacy-query-unsupported`) and returns an empty
result — never throws, never a silent broad match. Cost: ~60-80 lines walking
the tree; no engine change; the drift-prone keys are support-or-warn, exactly
as the critique demands.

## 7. The 8 user decisions — step-3 recommendations

| # | Decision | Step-3 recommendation (decisive) |
| --- | --- | --- |
| 1 | **Scope: event-only reuse?** (legacy phases excluded) | **YES — event-only, confirm only.** Phase mapping is already DECIDED excluded (N5/K8 `handler-phase-unknown`); the legacy lifecycle names have no semantic home in the 3-phase set. Seam-installed bodies dispatch as EVENT handlers only |
| 2 | **Children-injection: cut or composite op?** | **CUT.** `receiveNextState({children})` rejects with a structured error; no `children-replace` op is built. `showComments`-class bodies re-author that ONE call. Children-injection would drag in structural-op semantics (attach ordering, zone/priority, seam multi-parent) for one legacy call pattern. **SUPERSEDED by the user directive 2026-08-15 — LANDED differently:** the origin-owner element (amendment §11/§12) was unparked as the `layer-apply` engine primitive, and children-injection SHIPS as `receiveNextState({children})` → ONE `layer-apply` (ops.md §2.8 OO-7; decisions.md ORIGIN-OWNER + HANDLER-SEAM rows; tests/unit/legacy-bridge.test.ts B5). The "no `children-replace` op" half of the cut stands — the layer-apply op is not a replace op; the "rejects with a structured error" half is superseded (a non-array children value rejects with `{status:'rejected', error:{code:'children-shape-invalid'}}`) |
| 3 | **NodeView proxy vs native engine surface (Option D)?** | **PROXY.** Accept the WeakMap NodeView as the compat surface; Option D rejected (compile-time wiring + engine-native receiveNextState/findNode = permanent engine pollution for a compat-only feature) |
| 4 | **Arg-order wrapper + event stub + data-format marker?** | **MANDATORY — adopt.** Wrapper at translate; event stub `{type, preventDefault, stopPropagation, target, isTrusted}` (+`value` from `args[0]`); marker = provenance-derived (seam ⇒ legacy convention; inline ⇒ modern), explicit `format` field override persisted K5-style |
| 5 | **QueryUtils: engine primitive or adapter-internal?** | **ADAPTER-INTERNAL** (finding 13). Engine surface unchanged; honest keys supported, drift-prone keys (style/handlers/components) support-or-warn with `legacy-query-unsupported`. **LANDED 2026-08-15 — the warn-only half only:** the honest vocabulary is `type`/`id`/`classes`/`props` (exact-eq) + predicate functions; ANY key outside it (style/handlers/components/hasNonTypeTargetComponents, …) marks the query 'unsupported' — `legacy-query-unsupported` warns ONCE per dispatch and the query matches NOTHING (the "support" drift half did not land; warn-only is the contract — legacy-handlers.ts `matchQuery`/`unsupportedQueryWarn`; handlers.md §6) |
| 6 | **userData: passthrough or writable?** | **READ-ONLY passthrough**, captured from `TranslatedTree.userData` at translate. Writability cut — there is no session-data channel and building one for one legacy read is not justified |
| 7 | **Wiring seam scope + D6 un-park + K3 supersession + reverse?** | **ADOPT ALL:** translate-time planning (D7-style, F17 persistence), assembly-time materialization as provenance-marked handlers layers, K3 superseded for the handler-def shape only, reverse emits bindings + strips seam layers (no double-emit), D6 decision row flips to SUPERSEDED with tracker rows (§4.4) |
| 8 | **Option C (source transform) / the composite op?** | **REJECT BOTH.** C is dominated by A (wrapper vs fragile rewriting); the composite is the largest single piece of machinery for the smallest legacy use. The HALF bridge (read+query only, re-author writes — see §8) is also NOT the better solution: the write mapping is the CHEAPEST part (~30 lines, pure slice mapping) and is the entire purpose of the corpus bodies |

## 8. Costs vs benefits (and is there a better solution?)

**The known corpus is one envelope, six defs** (placeholderLanding). Real
disposition under A′: `LogoutHandler` verbatim (zero bridge surface);
`ToggleUserDropdown` verbatim (query + css write + parent walk);
`toggleCommentsButton` near-verbatim (one `window.Preempt.contentData` read
to re-author — no new-system analog exists); `AuthInitHandler` near-verbatim
(userData READ works; the direct `children.pop()`/`targetComponents.delete`
mutations become documented graph no-ops; the `receiveNextState({type, content,
props})` write maps); `showComments` one call re-authored (the children
write); `enterEditMode` fully re-authored (`fetchContent`/`fetchHandlers`/
`rerun` have no analog under any option).

**Costs of A′ (adopted):** one core module (`src/core/legacy-handlers.ts`:
wrapper + context factory + NodeView + QueryUtils ≈ 250-350 lines);
translate seam (classify + plan + wrap ≈ 100-150 lines); reverse branch
(seam-target emission + layer strip ≈ 30-50 lines); test matrix (~20-30
tests across translate/unit/integration/e2e); one demo page (the
placeholderLanding-shaped envelope with the six defs wired — the smoke gains
a `legacy-handlers` page); a permanent compat surface — every future engine
change must keep the bridge honest (the blind-test + stress-loop loops re-run,
AGENTS.md 10/11). Total ≈ 500+ lines, matching finding 15.

**Costs of B (seam + re-author):** the seam alone is ~half of A′'s translate
surface but is a prerequisite of ANY option (it is the D6 un-park — the dead
defs + the K3 misfire are defects either way, and the e2e's manual wiring
(`component-handler.test.ts:101`) exists because the seam doesn't); plus the
re-authoring task: ~4-6 bodies rewritten against `clientAPI.apply` + tree
walks — a one-time data-authoring pass, ZERO engine surface, ZERO compat tax.

**The honest arithmetic:** for the CURRENT corpus, B is marginally cheaper
in first-pass effort, and B is the defensible choice if the user values
zero-surface over verbatim. But: (a) the user's stated goal is verbatim
reuse — B abandons it; (b) the bridge's hard parts (wrapper, NodeView,
query) are ~60% of the cost and are reusable across every legacy page that
arrives later; (c) the write surface is NOT the expensive part, so the HALF
bridge saves ~10% of A′ while forfeiting the bodies' core behavior —
**not a better solution.** The step-3 verdict: A′ is the deliverable; B is
the documented fallback if the user drops the verbatim framing.

**Cost-benefit table (A′ vs B):**

| | A′ (bridge) | B (seam + re-author) |
| --- | --- | --- |
| Engine surface | 1 compat module + translate seam + reverse branch | translate seam + reverse branch only |
| Legacy bodies | verbatim (4/6 fully, 1 near, 1 re-authored) | all re-authored to the new ctx |
| Legacy pages later | land free | pay per page |
| Risk | compat drift (blind/stress loops re-run) | authoring mistakes in re-expressed bodies |
| Deliverable for the user | "legacy pages run verbatim" (the proposal's framing) | clean new-API bodies, zero compat tax |

## 9. Test-surface delta (red set for the TestWriter, TDD order)

- **translate.test.ts** (NEW): handler-def classification (`{reference,
  value: {name, body}}` AND bare `{name, body}` → def, no K3 warn; def
  registered by name); `handlers.<event>`/`handlers` targets plan with the
  seam option + NO `component-target-gap` warn (other targets unchanged);
  legacy-phase targets/defs still `handler-phase-unknown` + skip; explicit
  `format: 'legacy'`/`'modern'` respected + defaulted by provenance; wrapper
  installed for seam bodies (call-shape assertion); K3 still fires for
  `{}`/42/`''` (existing pins unchanged).
- **reverse.test.ts** (NEW): consumer emits `{reference, target:
  'handlers.<event>'}`; seam-minted handler layers stripped (no inline
  `handlers` double-emit); def round-trips unchanged; re-translate is
  anchor-identical + warning-free; `format` field persists.
- **unit (legacy-handlers)** (NEW): wrapper arg order + event stub
  (`preventDefault` no-op, `value` forwarding, `type` = event name); NodeView
  identity (WeakMap — same view across calls); token-parent termination;
  seam-children exclusion from `children`; `css` style parse-on-read /
  serialize-on-write; `data` facade (no `children`); receiveNextState slice
  mapping incl. `type`; `{children}` → structured rejection;
  placement-target keys → `placement-target-blocked`; direct children-array
  mutation = graph no-op; userData read-only (write contained); missing
  legacy clientAPI members → descriptive error, contained; QueryUtils honest
  keys + `legacy-query-unsupported` warn + empty result; throw containment
  through dispatch.
- **integration** (NEW): seam-wired handler dispatch → journaled slice
  updates → pass-2 → render (the placeholderLanding button flows: toggle,
  auth, comments with the children call re-expressed).
- **e2e** (NEW): the legacy-handler demo page (envelope + six defs + smoke
  banner + checks); `component-handler.test.ts:101` manual wiring may stay
  (it tests the runtime layer path) or gain the seam twin.
- **demo:smoke**: new `legacy-handlers` page in `scripts/demo-smoke.mjs`; the
  profile watch (AGENTS.md 4) — the bridge adds dispatch-time wrap cost only
  for seam handlers (6 bodies on one page; no fork-stress impact — its
  handlers are modern-convention, unwrapped).

## 10. Docs to update (with this change)

`handlers.md` (§6 TODO resolves; §3 dispatch note: seam layers are a legal
handler source), `translate.md` (§2 handlers row + §2.1 `handlers`/
`handlers.<event>` rows flip from "NOT implemented (gap)" to the seam; K3
supersession note; `format` marker row; reverse emission rows),
`api.md` (none — no engine API changes; note-only), `docs/decisions.md`
(D6 SUPERSEDED + new DECIDED row), `docs/defects.md` (fixed-defect row),
`docs/skills/designing-pages.md` (§11 matrix rows for translate/handlers +
new legacy-handlers row, §12 demo list, §14-style lessons from the blind
test), `RENDER_PROCESS_NOTES.md` (§10.10 DECIDED entry + ledger),
`docs/specs/legacy-handler-reuse-review.md` (this file), archive re-runs
(blind-test item 10 + stress-loop item 11 with legacy-envelope scenarios:
def-shape edge cases, `handlers.afterAssembly` targets, `handlers` bare
targets, inline `format` markers, reverse double-emit guards).

## 11. Recommended landing plan

1. **Spec first (subagents.md Step 4):** amend `docs/specs/handlers.md` +
   `translate.md` with the §2/§4/§5/§6 contracts above (the coherent A′).
2. **TDD red → green (AGENTS.md 7/8):** TestWriter writes the §9 red set,
   runs it (report failing set), then implements the least code:
   `src/core/legacy-handlers.ts` + translate seam + reverse branch. Engine
   dispatch untouched.
3. **Validation trio** (AGENTS.md 4): `npm test` + `npm run typecheck` +
   `npm run demo:smoke` green; profile watch on the fork-stress/placement
   totals (bridge must not move them — seam handlers are page-local).
4. **Doc flip + decision records** (§10) after user go-ahead.
5. **Re-run loops:** blind test (writer from docs only, legacy envelope with
   seam handlers) + stress loop (def edge shapes, round-trips); findings →
   archive; lessons → designing-pages.md §14.

---

## 11. AMENDMENT — the ORIGIN-OWNER element (user proposal + rulings, 2026-08-15)

Asked: could the children-injection atomicity violation (critique finding 3 —
the non-atomic 2N detach/attach composite) be resolved by an origin/owner link
type tying newly-created nodes to an anchor layer on a DIFFERENT node?

**Answer: YES — it is the generalization of machinery that already exists.**
Anchor layers already carry child-role decls admitted by the role-scoped
single-parent exemption (node.ts:648-672, the seam flag); DEFECT #10 made
layer removal symmetric (removeLayer removes the layer's generating anchors;
the sweep cascade destroys orphans); `runtimeMinted` (DEFECT #11) already
excludes created nodes from reverse. The composite dissolves:

- A new structural op `{kind: 'layer-apply', target, layerId, sourceName,
  decls, nodes: [NodeData]}` — ONE journaled op that mints the created nodes
  and applies the anchor layer to the creator. Atomic, named, replayable,
  undoable as a SINGLE layer removal.
- Rollback/undo = remove the layer (one op): the DEFECT #10 machinery unwinds
  the generated anchors; the cascade destroys the owned subtrees.
- Legacy `receiveNextState({children})` maps onto ONE atomic op — the
  critique's finding-3 blocker ceases to exist; the children-injection CUT
  can be re-opened under this contract.

**User rulings (2026-08-15):**
1. **Revisit after the other decisions are addressed** — the element is
   PARKED; it does not gate the rest of the review (§7).
2. **In-tree while extant** — origin-owned nodes stay family-in-tree via the
   layer links as long as they are extant; the ROLLBACK detects when an
   origin-owned node loses a TRACEABLE PERMANENT PARENT and deletes it (the
   not-traceable sweep — mirrors the permanent-owner discipline).
3. **Explicit marker; future preservation flag** — the origin is an EXPLICIT
   marker (the reverse-exclusion marker is the origin itself). A FUTURE
   FEATURE: flag a layer for PRESERVATION BY REVERSAL — origin-owned nodes
   created under a preserved layer reverse as deliberate edits.
4. **Scope (elaboration)** — the mechanism is engine-general IN FORM: it
   generalizes the anchor-layer + seam-link machinery (already engine-level)
   into an engine primitive — clone-instance and dynamic content injection
   could eventually ride it. But the legacy-handler bridge is the ONLY
   committed consumer today; the primitive lands with the legacy work, and
   the other consumers stay speculative (tracked in docs/pending.md).
5. **Whole-subtree cascade** — layer removal destroys the WHOLE origin-owned
   subtree, INCLUDING created nodes that have been placed elsewhere (moved
   out of the layer's direct family but still traceable to the origin).

Tracked in `docs/pending.md` (PARKED — revisit after the §7 gate; the
speculative row carries the constraints).

---

## 12. Gate RESTART (2026-08-15) — the AMENDED origin-owner element, re-verified

The three-agent gate re-opened (AGENTS.md item 9) for the AMENDED proposal
(the origin-owner element — `{kind: 'layer-apply', …}` + the 5 user rulings,
proposal §AMENDMENT). Step-1 validity: `docs/specs/legacy-handler-reuse-validity.md`;
step-2 critique: `docs/specs/legacy-handler-reuse-critique.md`. This §12 is the
step-3 re-verdict. Read-only on engine code; the step-1/2 records + this section
are the gate's persisted artifacts.

### 12.1 The element's status — PARKED STANDS; design intent, not contract

**CONFIRMED (no amendment):** the element remains DESIGN INTENT (parked). The
§7 children-injection CUT is the binding contract for the current
implementation; the amendment does not supersede it — it is the record of a
FUTURE re-opening. The amendment's own ruling 1 (PARKED — revisit after the §7
gate) and the `docs/pending.md` PARKED row hold unchanged.

### 12.2 Validation verdict (step 1) — FEASIBLE-IN-SHAPE, with three claims NOT true today

- **Feasible-in-shape:** one new journaled structural op kind; the
  vocabulary/`execute`/`supervisor.apply`/journal seams are mechanically
  extensible; `nodes: [NodeData]` journals cleanly (`NodeBaseData`, no live
  refs). Three new branches (execute, apply, undo) are required and mechanical.
- **Claim "rollback/undo = ONE layer removal via the DEFECT #10 machinery" is
  NOT true today:** `removeLayer`/`removeLayersForSource` only reach
  string-target decl'd anchors on the layer's OWN node (node.ts:570/592);
  the `materializeSeam` reversion only unwinds `seamTarget`-tagged links —
  origin-minted family edges are neither. NEEDS-X: a per-origin teardown that
  reaches the minted edges (never `link.destroy()` — the family link is SHARED;
  the detach-count path is the safe pattern; §12.3 B1).
- **Claim "the sweep detects the lost traceable permanent parent" is TRUE of
  the gate, but nothing TRIGGERS it for origin-owned nodes:** the gate
  (registry.ts:92 in-tree/prototype skip; chainRoot kinds; finalizeDestroyed)
  already implements ruling 2, but `markPending` fires only on the node's own
  child-anchor removal — the trigger must come from the teardown itself.
- **Claim "ruling 5's whole-subtree cascade reaches moved origin-owned nodes"
  is NOT true today:** nothing traces a minted node to its origin (no field, no
  anchor option, no registry); the down-walk (registry.ts:131-136) stops at
  family children. NEEDS-X: minted-set record + per-node origin marker.
- **NEEDS-X (replay id determinism):** `mintNodeId` is a global counter
  (node.ts:29-32) — replay would double-mint; the op needs deterministic ids or
  id-resolution of the prior mint (deepened by A3, §12.3).
- **The children-injection mapping HOLDS for the NodeData-subtree form**
  (legacy `receiveNextState({children})` was a clone-into-tree `addLayer`,
  replace-by-sourceName, phase-gated) with three deltas to pin: data-only
  payload (live-node reparenting out of scope), replace contract via `layerId` +
  prior-minted teardown, replay determinism.

### 12.3 Critique verdict (step 2) — TWO BLOCKERS (B1, B2) + FOUR A-BIGS (A1-A3, A5)

- **[B1] The rollback CANNOT reuse the ops detach path as "the safe path":**
  PROBE-1 (empirical) shows ops.ts:66-77 detach counts PARENT anchors
  (`link.anchorsOf('parent').length` — always 1 on a family link, link.ts:13
  `parent: {count: 1}`), so `link.destroy()` runs UNCONDITIONALLY: the whole
  family link dies, siblings orphan to 'unplaced' and are cascade-destroyed.
  The `removeAnchor` branch is unreachable dead code. The validity record's 1c
  prescription (ops.ts:66-77 as the safe path) was a MISREADING. The
  sibling-preserving detach exists but is `payload.ts:29-52` `detachNode`
  (module-private; splices one child anchor; dissolves the parent side only on
  the last child — P-7, payload.test.ts:36-38). The teardown needs a NEW SHARED
  helper (or the payload pattern promoted); `link.destroy()` is legal only for
  the last child.
- **[B2] "Survives with a traceable permanent parent" is unimplementable at
  gate time:** post-detach the node's state is ALWAYS 'unplaced' (no child
  anchor → node.ts:419), so the sweep gate can never see it as in-tree. The
  survival decision must be made PRE-detach, per minted node, walking the
  CURRENT parent chain: doomed iff `chainRoot(node, ∅)` ∈ {unplaced,
  destroyed-owner, loop, slice-root, token 'other'} (the 'other' token is
  NON-permanent); survives iff the chain reaches a permanent token
  {rootNode, contentNodes, component} ('component' ⇒ prototype ⇒ the gate skips
  it — consistent). Survivor promotion = the ORIGIN MARKER IS CLEARED (an
  origin-marked in-tree node is forever reverse-excluded — silent save-data
  loss): "survives" = "becomes authored content". The amendment says nothing
  about promotion.
- **[A1] The minted-set record dies with the creator:** a moved minted node
  survives a creator destroy (in-tree via a live non-origin parent), still
  marked, with the layer record gone — permanently reverse-excluded and
  unreachable for cleanup. The per-node marker must carry the origin reference;
  the record must be queryable without the creator.
- **[A2] The ENTIRE origin contract evaporates on serialize/loadState:**
  `serializeNode` ships no layers and no origin field; `loadState` re-seeds
  plain nodes — a minted subtree reloads as ordinary family children (marker +
  record gone; the reverse exclusion stops; the rollback handle is gone). User
  call: (a) runtime-only + documented promotion, or (b) serialize the marker.
- **[A3] Replay determinism needs more than deterministic ids:** the journal
  entry does not carry the minted ids — replay must resolve minted ids to
  existing nodes before re-minting (else a SECOND copy onto the same layer;
  `addLayer` replaces by id, node.ts:542-545). `result.minted` must be persisted.
- **[A4] A doomed minted node that is a PLACEMENT consumer leaves dangling
  `content` anchors:** `finalizeDestroyed` removes nothing; `pathChildrenFor`
  has no destroyed-owner check (node.ts:236-254) while `enumPathWalks` does
  (node.ts:153). Teardown must remove the minted node's non-child anchors or a
  test must prove the render path prunes destroyed path-children.
- **[A5] NodeData seed-anchor smuggling:** the constructor's seed-anchor channel
  (node.ts:380-409) would admit container/component anchors — EMPTY-OWNER
  hiding (legitimate but unclaimed), a translate-time-only ancestor-name veto
  bypass (node.ts:65-70), and the `component-source-duplicate` guard firing
  (node.ts:694-705). Pin: v1 layer-apply mints family children ONLY.
- Minors: M1 (preservation override = ONE site, translate.ts:1074, + one
  registry — a design decision, not machinery), M2 (mixed legacy payloads —
  `receiveNextState({children, css, …})` mixes state keys and children; the
  "ONE atomic op" mapping must define them), M3 (the validity record's leak
  framing is overstated — `registered` is never pruned for any node; the
  lingering case is A1's, not a new pollution class).
- **Exposed (pre-existing, INDEPENDENT of the element):** the ops-level
  detach/move spec-vs-implementation drift — ops.md §2.2/node.md §6.2 pin the
  safe per-node removal; the implementation wipes the whole family link
  (PROBE-1). See §12.5 + docs/defects.md (OPEN) + docs/pending.md (PENDING).

### 12.4 Design constraints now PINNED (the unpark gate's acceptance criteria)

1. **Teardown helper (new, shared):** sibling-preserving detach per minted node
   — splice the one child anchor (payload.ts:29-52 pattern), dissolve the
   parent side only when the LAST child leaves; `link.destroy()` only in the
   last-child case; idempotent (skip already-destroyed nodes); works on a moved
   node's CURRENT child anchor regardless of current parent.
2. **Pre-detach survival predicate:** decide per minted node BEFORE any detach —
   doomed iff the current chain reaches a non-permanent terminal (§12.3 B2's
   exact set); survives iff a permanent token (rootNode/contentNodes/component);
   survivor promotion = origin marker CLEARED (becomes authored content).
3. **Marker split:** per-node origin flag (the reverse-exclusion read at
   translate.ts:1074) + a layer/registry record of the minted set on the creator
   (the rollback handle + the future preservation-by-reversal override home).
4. **Minted-set lifetime:** the record must be queryable after creator death
   (A1) — a module-level mintedId→origin registry survives; the journal must
   persist the minted ids (`result.minted`) for replay/undo (A3).
5. **Seed-anchor veto:** layer-apply v1 mints family children ONLY; anchors in
   NodeData are rejected/warned (A5).
6. **Rulings 2-vs-5 interaction:** a minted node moved under a NON-origin
   permanent parent SURVIVES the rollback (promoted); only origin-traced
   descendants are torn down — the pre-detach predicate IS that statement.
7. **Open for the unpark gate (not resolved now):** the serialization fate
   (A2 — runtime-only+promotion vs serialized marker) and the non-child-anchor
   cleanup vs render-path prune (A4).

### 12.5 The pre-existing ops-detach spec drift — DEFECT, filed (D-6, DECISIVE)

**VERIFIED against the code:** ops.md §2.2 step 1 pins "`removeAnchor
(childAnchor)`" and node.md §6.2 pins "child anchor removed; last-child removal
escalates: `count-underflow` → `link.destroy()`" — but ops.ts:70 counts PARENT
anchors (`link.anchorsOf('parent').length` — always 1 on a family link,
link.ts:13), so `parentCount <= 1` is always true and `link.destroy()` runs
unconditionally; the spec'd per-node `removeAnchor` branch is unreachable dead
code. supervisor.ts repeats the whole-link wipe in detach (439-447), move
(448-461), and attach-undo (532-536). Consequence: an ops-level detach/move of
ONE child orphans the OTHER children to 'unplaced' (node.ts:419) → the sweep
cascade-destroys them (registry.ts:92). No test pins the wipe (ops.test.ts
move/detach cases are single-child or destroyed-parent), so the spec-true fix
flips nothing. The safe semantics already exist in payload.ts:29-52 (`detachNode`,
P-7 pinned, payload.test.ts:36-38 "sibling payload untouched"). **Warrants a
defect row: YES** — filed OPEN in docs/defects.md (DEFECT #12) + PENDING in
docs/pending.md (fix awaited at the user gate; independent of the element, it is
also the B1 teardown helper's raw material).

### 12.6 Step-3 recommendations for the critique's 8 predicted decisions

| # | Decision | Step-3 recommendation |
| --- | --- | --- |
| D-1 | The 2-vs-5 contract (pre-detach predicate; doomed vs promoted-survivor; authored children under minted nodes destroyed) | **DEFER-TO-§7** — §12.4-2/6 pin the predicate and interaction as acceptance criteria; no decision now |
| D-2 | Marker durability: runtime-only + documented promotion vs serialized marker (A2) | **DEFER-TO-§7** — both options recorded; the unpark gate decides |
| D-3 | Creator-destroyed trigger: destroy-side hook + registry vs accept the A1 leak | **DEFER-TO-§7** — the registry home is pinned (§12.4-4); the destroy-side hook stays a design decision |
| D-4 | NodeData scope: family children only in v1 vs seed-anchor acceptance (A5) | **DEFER-TO-§7** — §12.4-5 pins family-only for v1; widening is the future gate's call |
| D-5 | Mixed legacy payload: one op carrying state fields vs split slice+structural (M2) | **DEFER-TO-§7** — binds only the un-parked bridge extension; the §7 cut governs today |
| D-6 | The pre-existing ops.detach/move spec drift: defect + fix, or documented intent | **DECISIVE — defect.** Verified (§12.5): filed OPEN in docs/defects.md + PENDING in docs/pending.md; spec-true fix = the shared safe detach (payload.ts pattern); no existing test flips |
| D-7 | Teardown cleanup of non-child anchors vs a render-path destroyed-prune test (A4) | **DEFER-TO-§7** — recorded as A4 in the acceptance criteria |
| D-8 | Park confirmation: element stays PARKED; §7 lands with the cut; the validity + critique are the future gate's acceptance record | **CONFIRM-ONLY** — confirmed (§12.1, §12.7) |

### 12.7 The gate record

- **Validation verdict (step 1):** FEASIBLE-IN-SHAPE, **needs-X** — replay id
  determinism, a rollback teardown reaching the minted edges, and marker
  flag-setting on the minted subtree; three amendment claims not true today
  (rollback ≠ one layer removal via DEFECT #10; the ruling-2 trigger is missing;
  the ruling-5 cascade is infeasible without a minted-set record + per-node
  marker).
- **Critique verdict (step 2):** TWO BLOCKERS — B1 (the sibling-preserving
  detach does not exist at the ops level; the ops detach is a whole-link wipe,
  PROBE-1; the safe path is payload.ts's module-private `detachNode`; a NEW
  shared teardown helper is required) and B2 (post-detach a node is always
  'unplaced', so the survival predicate must be PRE-detach chainRoot-based, with
  survivor promotion = marker cleared) — plus FOUR a-bigs (A1 minted-set record
  lifetime, A2 serialize/loadState round-trips, A4 dangling content anchors, A5
  seed-anchor smuggling) and the pre-existing ops-detach drift (D-6).
- **Element status:** PARKED — design intent, not contract; the §7
  children-injection cut stands; the amendment does not gate the review.
- **Constraints pinned:** §12.4 (teardown helper, pre-detach survival predicate,
  marker split, minted-set lifetime, seed-anchor veto, 2-vs-5 interaction,
  A2/A4 open).
- **Tracker:** `docs/pending.md` — the PARKED row (origin-owner element, the
  acceptance record for the unpark gate) + a PENDING row (the DEFECT #12 fix);
  `docs/defects.md` — DEFECT #12 OPEN.
- **LANDED (2026-08-15):** the element's CORE shipped per the §12.4
  acceptance criteria — the `layer-apply` op (ops.md §2.8), the minted-set
  registry + per-node `originLayer` marker, the pre-detach teardown (doomed /
  promoted-survivor), and the reverse exclusion; pins O1–O9 in
  tests/unit/legacy-shape-ops.test.ts (Run B). The PARKED row is resolved
  (decisions.md ORIGIN-OWNER row); §12.4-7's OPEN items (A2/A4) and the
  preservation-by-reversal flag remain future gates; the children-injection
  bridge mapping LANDED with the runtime bridge (user directive 2026-08-15 —
  receiveNextState({children}) → ONE layer-apply; review §7 decision 2
  superseded; decisions.md HANDLER-SEAM + ORIGIN-OWNER rows; handlers.md §6;
  tests/unit/legacy-bridge.test.ts B5/B8d).
- **Trio:** `npm test` 779/779 green, `npm run typecheck` clean, `npm run
  demo:smoke` green (docs-only change; no engine source modified).
