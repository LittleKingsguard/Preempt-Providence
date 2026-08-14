# Path-Fork Compile — Three-Agent Gate Review (decision record)

> **IMPLEMENTATION LANDED (placement-path chain, units 0–12 — read this
> first):** the round-2 §3 verdict pointed at the separately-specced FEATURE
> ("static P3 is a FEATURE worth specing separately", R2.8 ¶3). That feature
> shipped as `docs/specs/placement-path-spec.md` (FINAL — PROCEED-TO-
> IMPLEMENT, §10.af.2) and the units 0–12 implementation: two-sided
> `'container'`/`'content'` roles on the per-name placement Link (the
> proposal's `placement-user` role naming was superseded — §10.x res-5
> convention), path-enumeration compile (`compilePath` — one state per
> (node, path-to-root), 4095 states on 23 nodes, `forkKey = pathKey`, no
> `#<i>` arms), the `placement-attach` op, contentNodes-ownership minting,
> and the static fork-stress page (`demo/path-fork-data.*`, census
> 23/4095/0/0). **This file remains the historical decision record** — the
> round-1 REJECT (§2.1–§2.5) and the round-2 "REVISED-but-reject FOR THE
> STATED GOAL" verdicts are superseded AS CONTRACT by the spec above; their
> analysis (incl. the `placement-user` rows at §6) stays as evidence.

Status: **round-2: refined proposal evaluated — see Round 2 section**.
(Round-1 verdict — REJECT as stated — remains the historical record; the
round-2 outcome supersedes it as the current decision.) Verified by the
two-agent gate (validity step 1 + critique step 2, both code-checked) and
the round-2 re-review of the author's four corrections; this doc is the
step-3 change-analysis verdict and the decision record. No code changed
(docs-only). Companion
context: `docs/specs/state-first-analysis.md` (§2.2.2 impossibility, §4
census, §5 bounded landing path), `docs/specs/state-first-analysis-review.md`
(addendum — clone census), `docs/specs/fork-stress-data.md` (§1.3
two-prototypes-per-layer assembly), `docs/specs/api.md` (§4 fork, §5 P3
placement multiplicity, §10.8.2/§10.8.4), `docs/specs/stress-test-scenarios.md`
(scenario 10 — placement forks "inert"), `docs/test-findings.md` (§"Stress-test
review loop #1" — emitElements DEFECTs #1/#2), `docs/session-defect-review.md`
(fork-stress-data section — pass-2 profile gap).

## 1. What the proposal asks

Verbatim (as gated): **"replace clone-based instance assembly with per-path
compiled states — prototypes carry placement links to multiple parents; the
compile enumerates one state per valid path back to root (4095 states pinned
to 22 prototypes + root); no clones."**

Mechanism sketch (paraphrased from the framing): the 22 unplaced prototypes
(two per layer × 11 layers — the fork-stress-data assembly) plus the root
node carry placement links to *multiple parents*; instead of the
`clone-instance` op materializing 4094 graph nodes (`node.ts:353-391`,
register/attach/mark at `supervisor.ts:388-411`), compile enumerates one
compiled state per valid path back to root; states are pinned to the
prototype set + root, so the 4095 rendered elements arise from 23 graph
nodes.

Claimed gain: eliminate the clone-instance construction ceremony and its
per-instance register/attach/mark choreography, replacing 4094 node
materializations with per-path states — faster assembly, no clone
bookkeeping.

## 2. Feasibility verdict

**The conceptual mapping is real: `forkKey` IS path-to-root** (api.md §4 F2:
"forkKey: PathKey — path back to the root node — the fork's identity"), and
"one state per valid path" is exactly what fork arms already are
(`resolve.ts:232-237`; api.md §4.2/§5 P3 — shared-name multiplicity →
distinct forkKeys, never a coerced pick). The census numbers the proposal
cites are correct (22 unplaced prototypes, 4095 in-tree states,
`fork-stress-data.md` §1.3). But the proposal is **not implementable as
stated**: three hard blockers (arithmetic; inexpressible multi-parent data;
no placement compile/emit support), plus a cost analysis that shows nothing
of the dominant cost is actually saved, plus a mutation-addressing impasse
that no variant escapes. Each is independent; any one sinks it.

### 2.1 Hard blocker 1 — the arithmetic does not close

22 prototypes + root = 23 nodes cannot yield "4095 states pinned to …
22 prototypes + root" under the stated rule "one state per **valid path**
back to root":

- The two sibling prototypes at a layer share the same parent set (both
  placement-linked to both parents at the layer above), so their **paths
  coincide**. Keying states by path only gives Σ 2^(k−1) + 1 = **2048**
  states — 2047 short of the claim.
- The proposal's own worked example is self-inconsistent: "L3 = 8" with
  "2 parents × 2 L2 states = 4" per prototype. The example implies
  per-prototype keying (8 = 2 × 4); the total (4095) implies per-path keying
  (2048 + 1). Both consistent fix-ups are fatal:
  - **2048 states** breaks the rendered-count contract — the page's own
    checks require 4095 mounted elements (`fork-stress-data.js:407-418`).
  - **4095 states** means per-prototype-origin state keying, i.e. the
    status-quo node-per-state model by another name — and the proposal has
    no mechanism (no clones, no authored per-wire data) to produce 4095
    distinct wires from 23 nodes: the impossibility argument applies
    (state-first-analysis §2.2.2 — per-arm authored data requires either an
    arm-scoped authored truth or per-arm graph nodes; both are the model
    being replaced).
- Either way the enumeration is **O(document-size)** — 2048 or 4095 units,
  not 23 — which is precisely the count that pays the per-call pass-2
  pipeline today (§2.5).

### 2.2 Hard blocker 2 — multi-parent placement is inexpressible in any data form

- **Legacy envelope + translate:** placement is a single-object,
  name-targeted field — `translate.ts:434-437` mints ONE `placement` anchor
  per node from `placement.placementName`. There is no list form.
- **Serialization:** `serialize.ts:39-44` rejects any anchor target that is
  not a string (a live/object anchor target throws
  `serialization-error`). No placement shape can round-trip a parent list.
- **The Link system:** a `placement`-role link cannot carry parent anchors —
  role whitelist, `link.ts:79-85` (`role-mismatch` for any role outside the
  config, and a `Link` as target is rejected outright); and a node under two
  parents needs **two child anchors**, which `addAnchor` forbids —
  `node.ts:416-419` (`SingleParentError`).
- **Every consumer is a coerced pick:** `anchorsOf('parent')[0]` is the
  universal single-parent read (resolve.ts:62, node.ts:74/208/233/522/543/
  555/835, ops.ts:33, payload.ts:44, serialize.ts:94). Multi-parent links
  make all of these arbitrary picks — api.md §4.2/§10.8.4: *"a coerced pick
  is never synthesized."*
- The single-parent invariant (SI-3) is NOT itself violated (it excludes the
  placement role) — the blocker is worse: the placement role carries **no
  parent semantics at all**, so the proposal's load-bearing structure does
  not exist anywhere in the data model.

### 2.3 Hard blocker 3 — compile and emit have no placement-fork path

- **Compile:** static forks fire ONLY on `target` anchors —
  `node.ts:660-663` filters `role === 'target' && typeof target === 'string'`.
  Placement anchors are inert at static compile — verified dynamically:
  stress-test-scenarios.md:655-688 — *"placement anchors are seeds, inert
  until attach"*; P3's multiplicity fork is attach+compile-driven and *"a
  static legacy envelope cannot express a placement fork"*.
- **Resolution:** `resolve.ts` has zero placement references.
- **Supervisor:** pass-2 is a per-dirty-node single-chain compile
  (`supervisor.ts:246-258` — `node.compile(this.focusedSlice(node))` per
  dirty node) — there is no top-down path-enumeration mode anywhere.
- **Emit:** fork arms are leaves-by-fiat — `render-helpers.ts:236-240`
  (multi-arm → `el.childOrder = []`) and `:349-350` ("fork arms are leaves …
  no children"); FRK-H2 adopts ALL arms flatly, with no per-arm children. A
  path-state's children are its 2^(k−1) descendant path-states — exactly the
  per-arm children emit refuses to produce.
- So "one state per path" compiles nowhere and emits to nothing: it requires
  a new compile mode (pass-2, resolve, viability, events, op-addressing) plus
  a new emit mode — the entire two-scope pipeline rewritten, none of which
  the proposal costs.
- NP13 `targetPlacement` — the only placement-adjacent compile input — is a
  **dead feed**: `translate.ts:440-444` warns `component-target-placement`
  and ignores the field.

### 2.4 Cost analysis — what is actually saved vs kept

The dominant d12 cost is the **per-call pass-2 pipeline** (1297–5888ms live
range), NOT clone construction (≈35–70ms, upper-bounded by handlerMs). Today
each created node pays EXACTLY ONE pass-2 compile (`supervisor.ts:411`;
`fork-stress-data.js:249-264` children-length guard → no re-dirties).

- **Literal reading** (2048–4095 per-path states): every state is a compiled
  thing paying the same per-state compile/emit/event pipeline the nodes pay
  today. The proposal replaces 4094 node-materializations with 2048–4095
  state-enumerations — the number of expensive units is unchanged to halved —
  and deletes the only cheap part (construction). Net: **~1–5%**.
- **23-pass reading** (one compile per prototype): saves the dominant term
  ONLY by eliminating per-path/state passes entirely — which requires the
  §2.3 rewrite (compile/emit/viability/events/op-addressing) plus answers to
  mixed-method resolution (§3.4), handler dispatch (§3.5), emit (§3.6) and
  addressing (§3.7). None of that is in the proposal's cost.
- Both readings keep the thing the proposal attacks (per-call pipeline ×
  document-scale units) and delete the thing it blames (clone construction —
  already ~1% of the total).

### 2.5 The mutation-addressing impasse (deepest problem)

Ops are node-scoped — journal, undo/redo, payload ownership, containment
(ops.md; payload.ts:44 walks the single parent anchor) — while the document
would be state-per-path:

- **Node addressing + path-keyed states:** one mutation to a mid-level
  prototype re-derives every path through it — 2^(d−1) = **2048 paths** at
  d12 — an O(half-document) edit that destroys the bounded O(depth)
  incremental contract (bounded pass-2, render.md §4 / pipeline.md per-slice
  lock).
- **Per-path addressing:** every op must name the path, not the node — the
  journal's identity, replay/undo/redo semantics, and payload/containment
  ownership are all node-keyed (Pillar B). This is the state-first re-ask
  already rejected (state-first-analysis §2.2.2 impossibility; §3 table row
  B — "journaled ops on nodes").
- **Loop safety:** placement links participate in NO cycle guard — chain
  classification (`chainRoot`, node.ts:47-70) and the resolve visit-set walk
  child anchors only. A placement cycle (A placed into B placed into A) is
  unguarded by construction.

## 3. Critique (step-2 findings, consolidated)

| # | Finding (code-verified) | Severity |
| --- | --- | --- |
| 1 | **Cost**: dominant term is per-call pass-2 (1297–5888ms), not clones (≈35–70ms); literal reading saves ~1–5%; the 23-pass reading saves the dominant term only by rewriting a pipeline the proposal does not cost | blocking |
| 2 | **Incremental**: one mid-level mutation → 2^(d−1) = 2048 re-derivations — O(half-document); destroys the bounded O(depth) contract | blocking |
| 3 | **Graph inexpressibility**: role-mismatch (link.ts:79-85); one child anchor (node.ts:416-419); `anchorsOf('parent')[0]` coerced picks (api.md §4.2 forbids); no legacy JSON can author multi-parent placement | blocking |
| 4 | **Mixed methods**: self-providers survive (`seedOwnBindings` is node-static) but consumed-name resolution walks real ancestors only; per-path resolution would need recursive per-path bindings across parents; S1.1 unplaced-drop must be rewritten | major |
| 5 | **Handler/phase regression**: per-node dispatch (23 prototypes) on static data; the after-compile expansion pattern — the page's runtime-assembly proof (fork-stress-data.md purpose §1–3) — is eliminated | major |
| 6 | **Emit**: per-arm children contradict leaves-by-fiat (render-helpers.ts:237-240/349-350); emitElements DEFECT #1 (`forkKey` dropped by `emitOne`, test-findings §"Stress-test review loop #1") becomes load-bearing | major |
| 7 | **Mutation-addressing**: node-scoped ops vs state-per-path document — every edit touches 2048 states; per-path addressing breaks Pillar B/replay | blocking |
| 8 | **Loop safety**: placement links are in no cycle guard (chain classification + resolve visit-set walk child anchors only) | blocking |
| 9 | **Re-proposal**: re-asks the rejected state-first model (state-first-analysis §5.1; impossibility argument §2.2.2) | context |

## 4. Salvageable lesson (actionable takeaway)

The census is not evidence against clones; it is evidence against
**per-unit compile**. The d12 profile (pass-2 1297–5888ms vs handler
ceremony ≈35–70ms) shows the seconds live in the per-call pass-2 pipeline —
4094 separate compiles, each `focusedSliceFor` + slice build + `groupByNode`
+ `storeResolved` + events + phase dispatch, with per-call overhead
dominating — a pipeline paid by ANY op-driven assembly (attach, destroy,
state-slice pay it per node too; an authored 4095-node document bootstraps
once and pays ≈0 pass-2, session-defect-review.md:513-514). **The real
optimization direction is COALESCING/BATCHING compiles — fewer, larger
passes (one sweep compiling many nodes, sharing slice/group/event work) —
not eliminating clones or materialized nodes.**

## 5. Conditions for any future revisit

(a) **New LinkConfig/role semantics for multi-parent** — a role that can
    carry parent anchors, plus a compile that never picks
    `anchorsOf('parent')[0]` (coerced-pick ban, api.md §4.2);
(b) **static-compile placement-fork (P3 implementation)** — compile forks
    extended to placement anchors (node.ts:660-663), superseding the
    stress-test scenario 10 "inert" verdict;
(c) **a per-path op-addressing model** with the journal/replay/payload/
    containment impact specified (Pillar B);
(d) **a placement-graph cycle guard** — chain classification + resolve
    visit-set extended to placement links;
(e) **emit forwarding `forkKey`** (fix DEFECT #1 first) **plus per-arm
    children** (leaves-by-fiat lifted, render-helpers.ts:237-240/349-350);
(f) **a legacy-JSON authoring path** for multi-parent placement (translate
    + serialize round-trip);
(g) **an incremental contract that is not O(half-document)** per mutation;
(h) **item-6 step gates**: spec first (docs/specs/*.md), then TDD
    red→green, trio validation — plus the d12 profile-ratio watch
    (AGENTS.md item 4: values/link-only totals within ~1.5× of placement).

## 6. Recommendation

**REJECT as stated** — record the decision here; park the three hard
blockers (§2.1–2.3) and the addressing impasse (§2.5) as the entry ticket
for any revisit (§5). Keep the state-first rejection stable — do not
re-litigate without (c) + (h). Adopt the §4 salvageable lesson
(coalescing/batching compiles) as the actionable optimization direction;
it is the only element of the proposal's motivation that the census
supports.

---

## Appendix A — cost distribution (critique step 2, from the census)

| Component | d12 measurement | Share / effect |
| --- | --- | --- |
| pass-2 pipeline — 4094 per-dirty-node compiles (focusedSliceFor + slice build + groupByNode + storeResolved + events + phase dispatch) | **1297–5888ms** live range | dominant (~⅔+ of the 3.3–6.0s totals) |
| handler ceremony — 4094 bodies, ≈8188–16k ops (2 `clone-instance` + 2 state-slice each) | **≈35–70ms** across machines | ~1% |
| clone construction (subset of handlerMs; handlerMs is an UPPER bound — it times the full body incl. guards) | < handlerMs | <1% |
| authored 4095-node bootstrap (no assembly) | ≈0 pass-2 (session-defect-review.md:513-514) | n/a |
| per-path proposal, literal reading | 2048–4095 states × same per-state pipeline; construction deleted | **~1–5% saved** |
| per-path proposal, 23-pass reading | saves the dominant term only via the §2.3 rewrite (compile/emit/viability/events/op-addressing) | uncosted |

Census: 4117 registered = 4095 in-tree (2^12 − 1) + 22 unplaced prototypes +
0 destroyed; 4094 clone-instance ops fired (= in-tree − 1)
(state-first-analysis §4.1; fork-stress-data.js:407-425).

## Appendix B — verification anchors (both prior steps, code-checked)

| Finding | Anchor |
| --- | --- |
| placement is single-object, name-targeted | translate.ts:434-437 |
| serialization rejects non-string / live anchor targets | serialize.ts:39-44 |
| static fork fires on `target` anchors only | node.ts:660-663 |
| emit hard-leaves every fork arm | render-helpers.ts:236-240, 349-350 |
| single-parent invariant excludes placement (SI-3); getters single-chain | node.ts:47-70 (`chainRoot`); `anchorsOf('parent')[0]` at resolve.ts:62, node.ts:74/208/233/522/543/555/835, ops.ts:33, payload.ts:44, serialize.ts:94 |
| NP13 `targetPlacement` feed is dead | translate.ts:440-444 |
| no top-down path-enumeration compile mode | supervisor.ts:246-258 |
| role-mismatch — placement role cannot carry parent anchors | link.ts:79-85 |
| one child anchor per node | node.ts:416-419 |
| coerced pick never synthesized | api.md §4.2 / §10.8.4; pipeline.md:134; validation.md:126 |
| P3 placement forks inert at static compile | stress-test-scenarios.md:655-688 |
| two prototypes per layer, ≈22 at d12 | fork-stress-data.md §1.3; state-first-analysis §4.1 |
| pass-2 dominance (1297–5888ms) vs ceremony (35–70ms) | state-first-analysis §4.2; state-first-analysis-review.md addendum |
| DEFECT #1 — `emitElements` drops `cs.forkKey` | test-findings.md §"Stress-test review loop #1" |
| state-first model rejected; impossibility argument | state-first-analysis §2.2.2, §5.1; state-first-analysis-review §5.1 |
| arithmetic: Σ 2^(k−1)+1 = 2048 from 22+root; L3 example self-inconsistent (2×2=4) | this doc §2.1 (validity step 1, verified) |

---

## Round 2 — refinement re-review (author corrections)

Status (round 2): **evaluated — REVISED-but-reject FOR THE STATED GOAL**.
After the round-1 REJECT, the proposal's author refined it with four
corrections; the two-agent gate re-ran (validity step 1 + critique step 2,
both code-checked) and this section is the round-2 step-3 change-analysis
verdict. The round-1 sections above remain the historical record; this
section supersedes them as the current decision.

### R2.1 The four corrections (as re-gated)

| # | Correction | What it fixes in round 1 | Code-verified status |
| --- | --- | --- | --- |
| 1 | **Arithmetic: 4095 = Σ_{k=1..11} 2^k + root.** | §2.1 blocker 1 (2048 vs 4095) | Closed — bijection with the tree verified (R2.2) |
| 2 | **Placement owner/user polarity on a shared per-name placement Link treated as a compile path edge.** | §2.2 blocker 2 (multi-parent inexpressible) | Closed in principle — the per-name shared Link IS the path edge; a two-sided role is the required new mechanism (R2.3) |
| 3 | **Node-scoped incremental with graph-derivable affected sets.** | §2.5 impasse (node-scoped ops vs state-per-path document) | Closed — Pillar B intact; affected sets are graph-derived, no per-path addressing (R2.3) |
| 4 | **Key-stable states + wire-keyed element reuse + graph-signaled downstream invalidation.** | §2.4 cost reading (per-state ceremony); DEFECT #1 exposure | Closed in principle — key-stable wires + `diffMinimal` prevMap reuse verified (render.ts:50-90) |

### R2.2 The arithmetic correction — RECORD

The round-1 "2048" was a **keying-model error, not an arithmetic error**:
path-only keying drops per-slot identity — the two sibling prototypes at a
layer share the same parent set, so their paths coincide and path-only
keying yields 2^(k−1) states per layer (Σ_{k=1..11} 2^(k−1) + 1 = 2048).
The round-1 sum was correct FOR THAT KEYING MODEL; the model was the error.
The refined **(prototype, path) keying** — one state per (prototype,
owner-path) pair, REQUIRING the sibling-shared owner-name topology (both
level-(k−1) prototypes own ONE placement name; both level-k prototypes
target it) — gives each level-k prototype one state per owner-path: 2
prototypes × 2^(k−1) paths = 2^k states per layer, Σ_{k=1..11} 2^k + root =
4095, in bijection with the tree's nodes (2^12 − 1). The round-1 §2.1
"both consistent fix-ups are fatal" dichotomy dissolves: 4095 states is NOT
the status-quo node-per-state model — every state is pinned to a
(prototype, path) pair on 23 graph nodes, with no per-arm authored data and
no per-arm graph nodes. The §2.2.2 impossibility argument does not apply to
the refined proposal: nothing arm-scoped is authored; per-slot identity
comes from the two-sided placement Link (correction 2), not from per-arm
data. The enumeration is still O(document-size) in STATES (4095) — but the
refined reading compiles them in ~23 prototype passes, with the per-state
work on the emit side, not the compile side.

### R2.3 Validity verdict — FEASIBLE-WITH-CHANGES (remaining blockers, costed)

The refinement closes the round-1 hard blockers and the addressing impasse:

- **Correction 3 verifies against the incremental contract.** Descendant
  states never read ancestor pass-1 props — `makeCs` reads only the node's
  own pass-1 surface (node.ts:623-638) and derived path reads are
  own-state whitelisted (`pathValue`, derived.ts:163-191) — so a
  node-scoped mutation's affected set is exactly its descendant subtree
  (family anchors) plus the per-name component Link's `anchorsOf` set
  (link.ts:51-53): all graph-derivable. Bounded O(depth) incremental holds;
  journal/replay/payload/containment stay node-keyed (Pillar B).
- **Correction 4 verifies against the emit layer.** Wires stay key-stable
  (`nodeId`, `nodeId#i`, render-helpers.ts:297); `diffMinimal` reuses
  unchanged wires via the prevMap (render.ts:50-90), so steady-state
  renders are set-only ops; downstream invalidation is graph-signaled
  (descendants recompile off the graph), never state-enumerated.
- **Corrections 1+2 make the model load-bearing** — the shared per-name
  placement Link with two-sided polarity carries the multi-parent topology
  the round-1 data model could not express.

What remains — new engine surface, each costed:

| Blocker | Required mechanism | Anchor |
| --- | --- | --- |
| Polarity role | a second placement role (`placement-user`; today `DEFAULT_PLACEMENT.roles = ['placement']` only) | Role union types.ts:8; DEFAULT_PLACEMENT link.ts:23-26; hub `linkFor` kind union translate.ts:133-146 |
| Authoring path | translate mints a `placement-user` anchor from `placement.targetPlacement` — today a dead feed (warn + ignore) | translate.ts:440-444 |
| Placement-path compile mode | chain classification, slice building (`focusedSliceFor` family walk), viability, resolve ancestor walk, and pathKey all extended to placement edges | node.ts:512-562; supervisor.ts:40-79; node.ts:564-605; resolve.ts:152-156; node.ts:300-316 |
| Per-arm children emit | leaves-by-fiat lifted and flat arm adoption replaced by per-arm childOrder | render-helpers.ts:236-240/349-350; :210-215 |
| Placement mutation ops | a placement-attach op — state-slice hard-blocks placement writes and no op mints placement anchors | supervisor.ts:327-331 |
| Placement cycle guard | `findCycle`/chain classification extended to placement edges (family-only walk today) | node.ts:861-871 |

### R2.4 Critique verdict — REVISED-but-reject FOR THE STATED GOAL

1. **The refinement closes the round-1 blockers.** Arithmetic (bijection
   verified, R2.2), addressing (node-scoped ops + graph-derived affected
   sets — Pillar B intact, R2.3), and the state-first re-ask (graph stays
   truth; no per-arm authored data — the §2.2.2 impossibility argument does
   not apply to the refined proposal). The round-1 REJECT is fully answered
   on its own terms.
2. **It correctly targets the DOMINANT term** — the per-call pass-2
   ceremony (1297–5888ms live; state-first-analysis §4.2). The round-1
   "~1–5% saved" figure applied to the literal per-state reading and is
   SUPERSEDED: under the ~23-prototype-compile reading the proposal attacks
   the term that actually dominates.
3. **But it is DOMINATED by the prior gate's salvageable lesson** (§4):
   coalesced/batched compiles — fewer, larger passes sharing slice/group/
   event work — deliver the same dominant-term saving at ~zero spec
   rewrite, with the stress suite, the four mechanisms, and the emit layer
   untouched. The path model buys its (real) saving with a full pipeline
   rewrite the coalescing direction does not need.
4. **The path model's unique remainder is STATIC P3** — placement forks
   authorable in legacy JSON data (`targetPlacement`) with no handler
   expansion. That is a FEATURE (new authoring surface), not an
   optimization; the runtime fork-stress page already proves the dynamic
   path.
5. **Hidden demo regressions (code-verified):** every path state is a fork
   arm, and the def-retyping branch (render-helpers.ts:309 —
   `if (def && armIdx === undefined)`) and the on:* handler emission
   (render-helpers.ts:341-347) both gate on `armIdx === undefined` → the
   link method's re-typed children and the handler method's events die at
   emit under the path model (R2.6).
6. **"States don't need children" is a false economy.** The
   `children.length` derived contract (fork-stress-data.js:115-122;
   derived-state.md §9.2) needs path-derived children — a state's
   childOrder is its descendant path-states — and the top-down enumeration
   KNOWS the parent, so attaching children at enumeration is free (R2.7).
7. **The emit-parentage crux:** per-path append owners come from
   path-prefix-derived childOrder computed in a NEW tree-assembly pass (or
   attached at enumeration), not from the current `emitOne` — `emitOne`
   reads `cs.children` and arms get none (R2.7).

### R2.5 Cost table — round 2 (what is saved vs kept vs new)

| Term | Path model (refined) | Coalescing/batching (§4) |
| --- | --- | --- |
| **SAVED — dominant term: per-call pass-2 ceremony** (1297–5888ms: 4094 per-dirty-node compiles, each focusedSliceFor + slice build + groupByNode + storeResolved + events + phase dispatch) | SAVED: 4094 passes → ~23 prototype compiles with per-path enumeration | SAVED: fewer, larger sweeps sharing slice/group/event work — same term, same magnitude |
| **SAVED — clone construction + handler ceremony** (≈35–70ms, ~1%) | SAVED (no node materialization) | KEPT (ceremony still runs — ~1%, uninteresting) |
| **KEPT — incremental contract, journal, Pillar B** | KEPT (node-scoped ops + graph-derived affected sets) | KEPT, untouched |
| **KEPT — emit layer** (leaves-by-fiat, def-retyping, on:* handlers, wire scheme) | NEW surface instead: per-arm children, def/handlers for arms, path-based wire/key scheme — with DEFECT #1 (`cs.forkKey` dropped) fixed first | KEPT, untouched |
| **NEW — spec/engine surface** | polarity role, translate `targetPlacement` minting, placement-path compile mode, placement-attach op, placement cycle guard, tree-assembly pass | ~zero spec rewrite; stress suite + four mechanisms + emit layer untouched |
| **Net** | coherent, addressing-correct, **DOMINATED** | same dominant-term saving at a fraction of the risk/surface |

### R2.6 Demo-regression finding — link/handler methods die at emit

All path states are fork arms (wire `nodeId#i`, `armIdx` defined). At emit:

- the def-retyping branch runs ONLY for `armIdx === undefined`
  (render-helpers.ts:309) → the fork-stress **link** method's re-typed
  children (the `link-<layer>` component defs) never emit;
- on:* handler props attach ONLY for `armIdx === undefined`
  (render-helpers.ts:341-347) → the fork-stress **handler** method's events
  never attach;
- leaves-by-fiat clears every multi-arm `childOrder` (render-helpers.ts:
  236-240) and emits arms as childless dupes (:349-350) → no per-arm
  children under any reading of the current emit.

So the runtime fork-stress page's own data — its link and handler methods —
regresses under the path model unless the emit layer is rebuilt, which is
precisely the part of the pipeline the proposal does not cost and the
coalescing direction does not touch.

### R2.7 Emit-parentage resolution

The page's `stress:expanded` flag is derived from `children.length`
(fork-stress-data.js:115-122; derived-state.md §9.2 — the "no marker op, no
re-dirty" contract: a node bakes `true` once its children exist, from the
COMPILED state's child list). Path states therefore MUST carry their
descendant childOrder — the count is the derived contract's input, not a
free drop. Resolution: per-path append owners come from path-prefix-derived
childOrder computed in a NEW tree-assembly pass over the enumerated states
(a level-k state's children are the two level-(k+1) states whose owner-path
extends its path by one level) — or attached during the top-down
enumeration, where the parent is already known and attaching is free.
Either way it is NOT derivable from the current `emitOne`, which reads
`cs.children` (render-helpers.ts:347) and grants arms none — the
emit-parentage machinery is new surface in any path-model implementation.

### R2.8 Final recommendation

1. **Adopt the coalescing/batching direction** (round-1 §4 salvageable
   lesson) as THE actionable takeaway: same dominant-term saving, ~zero
   spec rewrite, stress suite + four mechanisms + emit layer untouched.
   This is the round-2 decision.
2. **Park the refinement** as "coherent, addressing-correct, dominated" —
   its blockers are closed on the model level, but it buys its one real
   saving through the same door coalescing opens for free, and it pays with
   a full pipeline rewrite plus the R2.6 demo regressions.
3. **If static P3 (placement forks authorable in legacy data) is wanted as
   a product FEATURE, spec it separately** — it is the path model's only
   unique remainder. Full condition list for that spec: api.md §5/§1.2
   rewrite (P3 from inert/unverified to a data-authorable placement fork);
   translate.md §2 `targetPlacement` revival + a TR-H3 rule
   (targetPlacement → placement-user anchor); pipeline stages for the
   placement-path compile mode (chain classification, slice, viability,
   resolve ancestor walk, pathKey); S1.1 viability for placement-users; a
   placement-attach op; the two-sided placement role; a placement-cycle
   guard; a path-based wire/key scheme replacing `#<i>`; and the DEFECT #1
   fix (`emitElements`/`emitOne` dropping `cs.forkKey`) FIRST. Round-1 §5
   (a)–(h) remains the general revisit ticket.
4. **Keep the runtime fork-stress page as-is** — its handler-expansion
   assembly is the engine's proof of the after-compile expansion pattern;
   if static P3 ships, add a static page alongside rather than converting
   the runtime one.
