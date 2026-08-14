# State-First Analysis — Three-Agent Review (validity + critique + change-analysis)

Status: step-3 change-analysis verdict for `docs/specs/state-first-analysis.md`.
No code changed. Steps 1 and 2 ran independently (both verified against code);
this doc is the step-3 verdict + the applied correction list. Companion
context: `docs/specs/state-first-analysis.md`, `docs/specs/fork-stress-data.md`
(§1.3 two-prototypes-per-layer assembly), `docs/specs/api.md` (§4 fork, §5 P3
placement multiplicity), `docs/specs/node.md` (§1.1 children), `docs/test-findings.md`
(§"Stress-test review loop #1" — `emitElements` DEFECTs #1/#2),
`docs/session-defect-review.md` (fork-stress-data section — the pass-2
profile gap), legacy `Preempt/src/core/Node.ts:144-163` / `Placement.ts:81/105`.

## 1. What the analysis asks

`docs/specs/state-first-analysis.md` is a design analysis (no code):
it claims the rebuild's render layer is already "state-first" — compiled
states are derived, read-only abstractions over the graph; fork arms are
per-wire states of ONE node (no clone); def/type components re-type at
emit (no graph change); the only graph-materialization holdout for
prototype-driven assembly is the `clone-instance` structural op. It then
asks whether instances could be generated directly from a prototype record
+ a slot "without materializing graph nodes" (a virtual-instance /
state-first instantiation model), driven by the legacy incentive of
`node.clone` overuse.

## 2. Feasibility verdict

**Thesis sound; the proposed new model is NOT buildable; the analysis is
revised accordingly — and after revision it recommends NO code change and
NO new API.**

- **Graph truth is verified.** The graph (nodes + component/placement/
  child-parent links) is the single truth. `resolvedStates`/`getResolvedStates`
  are a non-draining mirror that never feeds back into the compile
  (supervisor.ts:173-221); derived baking is copy-before-merge
  (derived.ts:237-247); fork arms are N states of one node with distinct
  forkKeys (resolve.ts:232-237); children come from child-parent anchors
  only (node.md §1.1).
- **Instances cannot be fork arms, and cannot be records.** Instances
  differ in authored data, ancestry, and children — only graph nodes carry
  those. And a per-instance record view is *not* derivable from the graph
  either: provenance ("which prototype/link it came from") is not carried
  anywhere (`Node.clone` mints a fresh node from `base` with no source
  pointer, node.ts:355; `clone-instance` registers the copy with no
  prototype reference, supervisor.ts:392-393).
- **Numbers corrected.** §1's "4094 instances of 2 prototypes" and "~8k
  fresh Links" were wrong (two prototypes PER LAYER, ≈22 at d12; the clone
  loop skips seed-* layers and family anchors → placement ≈0 fresh links,
  values/link ≤ ~4k). §4's "~280ms pass-2" was unsupported and contradicted
  by the smoke totals (d12 pass2 = 1297–5888ms live range across
  machines/rounds; handler ceremony ≈35–70ms across machines of a
  ~3.3–6.0s total).
- **The `instanceRecords` recommendation is DROPPED** (provenance not
  graph-derivable; the remaining fidelity contract near-vacuous;
  `serializeSlice`/`minimalFromState` already flatten everything except
  provenance; the fork-stress proof was ceremony).

### 2.1 What survives the review (the corrected analysis)

1. The renderer consumes compiled states only; the graph is never the
   renderer's input.
2. Fork arms are derived per-wire states of one node; per-arm DERIVED
   props exist today (`applyDerived` per arm, DV-H3); per-arm AUTHORED
   data is impossible under graph truth.
3. `clone-instance` is the graph-truth EXPRESSION of an instance — the
   only one (impossibility argument, §2.2.2 of the analysis).
4. The clone ceremony is a rounding error next to pass-2 (sourced from the
   smoke profile totals).
5. A flat per-instance view, if ever wanted, is a page-side projection —
   not a core API.

## 3. Corrections applied to the analysis (change list)

| # | Finding (step-1 validity / step-2 critique, code-verified) | Applied to `state-first-analysis.md` |
| --- | --- | --- |
| 1 | §1 numbers wrong: not "4094 instances of 2 prototypes" (two prototypes PER LAYER, ≈22 at d12); "~8k fresh Links" overstated (clone loop skips seed-* layers node.ts:358 and family anchors node.ts:373-375; placement ≈0, values/link ≤ ~4k) | §1 rewritten with the per-layer prototype count, the seed/family skip citations, and the corrected Link ceilings |
| 2 | §4 "~280ms pass-2 slice compiles" unsupported (contradicted by smoke totals: d12 placement ≈3.9s total, pass-2 dominating; live pass2=1297-5888ms); "~16k-op handler work" wrong (handlers=4094, ≈8188-16k ops measured ≈35-70ms across machines) | §4 rewritten with the actual `[fork-stress-data:profile]` d12 table (cycle/placement/values/link rows); direction kept — clone ceremony NOT dominant, pass-2 dominates |
| 3 | Missing impossibility argument (the stated incentive: "build instances without cloning?") | §2.2.2 added: per-arm authored data requires either arm-scoped authored truth (breaks single-authored-node truth) or per-arm graph nodes (= clone-instance); under graph truth instances REQUIRE graph nodes |
| 4 | Truth-model claim needed qualification: handlers are a deliberately state-READING surface (getState / c.states / node.resolved, handlers.ts:75,93) and may gate ops on state reads | §1 "Truth model — qualification" added: engine never writes from states; authoring code MAY read them and gate ops (still authored op streams) |
| 5 | Arms-vs-instances boundary imprecise | §2.2.3 added: per-arm derived props exist (DV-H3); per-arm authored data impossible; fork+children/fork+def/fork+handlers DROPPED at emit (leaves-by-fiat: render-helpers.ts:237-240/308-336/341-347); placement forks (api.md §5 P3) unverified dynamically (static compile forks on target anchors only, node.ts:660-663) |
| 6 | Provenance NOT derivable from the graph (Node.clone carries no source pointer; clone-instance registers no prototype ref); instanceRecords recommendation dropped | §5 rewritten: no new surface, no new API; serializeSlice/minimalFromState already flatten except provenance; flat view = page-side projection. §3 table row "Records fidelity" → DROPPED; §2.1 diagram layer renamed "flat views" |
| 7 | Missing cross-reference: arms-distinctness claims depend on open emitElements DEFECTs (#1 forkKey drop, #2 cssDef leak) | §2.2.3 + §5.2 cross-reference test-findings.md §"Stress-test review loop #1" |
| 8 | Legacy-incentive citation: components.md documents apply/reset, not "clone" | §1 legacy paragraph now cites the legacy src itself for the clone element: `Preempt/src/core/Node.ts:144-163` (layer-value clone), `Placement.ts:81/105` (reference-node clone/`placeInto`) |

## 4. Gaps and costs-benefits

### 4.1 Gaps the review leaves open (recorded, not fixed here)

- **emitElements DEFECTs #1/#2 are still open engine defects** (test-findings
  §"Stress-test review loop #1"). They do not block the analysis (mounting
  stays correct via the arm-wire convention), but every future
  arms-distinctness claim — including the boundary declared in §2.2.3 —
  leans on them.
- **Placement forks (P3) are dynamically unverified.** Static compile
  forks fire only on `target` anchors; a static legacy envelope cannot
  express a placement fork. The P3 contract stays spec-level until a
  dynamic probe exercises it.
- **The smoke profile still does not time pass-2 itself** in every page
  (session-defect-review: the "remaining blind spot"). The analysis now
  cites `pass2` where the fork-stress-data profile exposes it; the
  unmeasured-gap guard (AGENTS.md item 4) remains a manual habit.
- **"~280ms" stale numbers** may live in other docs; this review only
  corrects the analysis doc. (No other doc was found asserting it.)

### 4.2 Costs and benefits

- **Cost of adopting the corrected analysis:** none — it is a
  documentation revision; it explicitly recommends no code change and no
  new API. The dropped `instanceRecords` saves a fidelity contract that
  could not be met (provenance unexpressible), its regeneration cost, and
  a test surface.
- **Benefit:** the "state-first" question is settled with a code-verified
  argument: the rebuild already IS the graph-truth model; instances
  necessarily materialize as graph nodes; fork arms are a derived,
  per-arm-props-only view with a declared emit boundary. Future work can
  skip re-litigating virtual instances.
- **Trade-off retained:** the clone ceremony stays (it is the graph-truth
  expression of an instance). Its cost is measured (≈35-70ms across
  machines at d12) and is not the bottleneck; pass-2 is.
- **Better alternative checked:** a per-arm authored store was the only
  other route to "instances without cloning"; it breaks the
  single-authored-node truth and was rejected in the analysis's
  impossibility argument.

## 5. Recommendation

**Accept the revised analysis; take no code action.** Concretely:

1. No new authored surface and NO new API — the `instanceRecords`
   recommendation is dropped; `serializeSlice`/`minimalFromState` already
   cover flattening; a flat per-instance view, if ever wanted, is a
   page-side projection from the graph.
2. The analysis's explicit impossibility argument (§2.2.2) is the
   permanent answer to the "instances without cloning?" incentive.
3. The arms/instances boundary (§2.2.3) and the emit-time drops
   (`fork + children`/`fork + def`/`fork + handlers`) are declared
   conventions; the open `emitElements` DEFECTs #1/#2 and the unverified
   P3 placement forks are cross-referenced as the holes any
   arms-distinctness claim depends on.
4. Provenance is documented as NOT graph-derivable — removing it from the
   fidelity story.
5. Performance claims now cite the actual smoke profiles (§4 table), and
   the §4 direction (clone ceremony ≈35-70ms vs pass-2 ≈1.3-5.9s at d12,
   live range) is sourced.
6. The doc header marks the revision: "revised after three-agent review —
   see this review doc".

---

## Addendum (post-review revision — clone-usage census, re-reviewed)

New measured information (see analysis §4.1): `node.clone` is the engine's
workhorse instance mechanism, not a niche path — d12 placement ends with
**4117 registered nodes of which 4094 are clones** (22 unplaced
prototypes, 4095 in-tree, 0 destroyed; in-tree and unplaced are asserted
by the page's own checks, the rest is derived arithmetic). Construction is
cheap (handlerMs ≈35–70ms across machines for all 4094 bodies — an UPPER
BOUND on construction, since it times the full body incl. guards + both
state-slice applies); the dominant cost is pass-2 (1297–5888ms live
range).

**Re-review verdict (clone-census revision re-gated)**: the census
revision was re-run through the three-agent gate — validity: the census
replicates (the numbers match the page's own checks + derived arithmetic,
now guarded in the smoke); critique: the attribution was corrected — the
seconds are the INCREMENTAL PER-DIRTY-NODE PASS-2 PIPELINE (4094 separate
compiles: each `focusedSliceFor` + slice build + `groupByNode` +
`storeResolved` + events + phase dispatch, per-call overhead dominating),
paid by ANY op-driven assembly (attach/destroy/state-slice per node pay it
too), NOT by clone construction, NOT by clone existence, and NOT by
cloning at all (an authored 4095-node doc bootstraps once and pays ≈0
pass-2, session-defect-review.md:513-514). Corrected attribution: **the
seconds are the incremental-compile pipeline that op-driven assembly pays
per created node — handler-expansion assembly pays one pass-2 compile per
created node; the cost is the pipeline the assembly pattern drives.**

Effect on the previous verdicts:

1. **Problem-fit (the earlier problem-fit concern)** — now answered with
   data: the rebuild did not reduce clone COUNT (clone is used at maximum
   scale); it removed the legacy state-management machinery AROUND clone
   (apply/restore, `_instantiatedNodes`, `targetComponents` maps). The
   impossibility argument stands: instances require graph nodes, and
   graph nodes at scale are clones.
2. **§4 numbers** — the earlier "clone ceremony is not the dominant cost"
   stands but is now precisely scoped: construction ≈ rounding error
   (≈35–70ms across machines, handlerMs as an upper bound); the ~1.3–5.9s
   at d12 is the per-dirty-node pass-2 pipeline, not "existence" and not
   per-generation recompiles (each clone is pass-2 compiled EXACTLY ONCE,
   at creation — supervisor.ts:411; the page never re-dirties,
   fork-stress-data.js:249-264).
3. **The optimization target** — any future instance optimization must
   target the per-dirty-node pass-2 pipeline (the per-call compile
   overhead of ANY incremental assembly — attach/destroy/state-slice
   drive it too), not clone construction and not instances specifically.
4. **Recommendation unchanged**: no new authored surface, no new API;
   clone remains the instance-expression mechanism; flat views are
   page-side projections.

Verdicts from the original review remain valid; the census strengthens the
"clone stays" conclusion and sharpens where real cost lives.
