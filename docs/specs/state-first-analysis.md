# Design Analysis — State-First Instantiation (virtual instances vs `node.clone`)

> **IMPLEMENTATION LANDED (placement-path chain — read this first):** the
> §2.2.2 impossibility ("nothing arm-scoped is authored; per-slot identity
> comes from the two-sided placement Link") and the §5 landing path were
> carried into `docs/specs/placement-path-spec.md` (FINAL) and shipped
> (units 0–12): path enumeration over the 23-node graph → 4095 compiled
> states with NO node creation (E2E-1), the static fork-stress page
> (`demo/path-fork-data.*`, census registered=23/in-tree=23/path-viable=4095/
> unplaced=0/cloneOps=0). **The §4.1 census below (4117 registered = 4095
> in-tree + 22 unplaced; cloneOps 4094) remains the PRE-minting RUNTIME
> record (annotated per placement-path-spec §5.2 F-13):** with the
> translate-global contentNodes-ownership minting the RUNTIME page's census
> re-pins to in-tree=4117, unplaced=0 — the runtime page is kept alongside
> the static one (P3 §9-Q4). The §2.2.2 model verdict (the model is NOT
> state-first; the graph stays the truth) stands.

Status: DESIGN ANALYSIS (no code) — **revised after three-agent review**
(validity + critique + change-analysis; verdict and correction list in
`docs/specs/state-first-analysis-review.md`). Input: the observation chain
in session discussion — compiled states are path-keyed and map 1-1 (≈) to
rendered elements; the op stream already encodes the document tree
(`treeFromOps`); the compile already walks each node's ancestor path;
therefore per-wire states *could* be generated directly from a prototype
record + a slot, without materializing graph nodes (the current
`clone-instance` op). Context: overreliance on `node.clone` and its
state-management burden in the legacy codebase is a stated incentive of
this rebuild. This doc sketches the state-first model, its collisions with
the current pillars, and a bounded landing path. Companion:
`docs/specs/legacy-component-ref-only-review.md`,
`RENDER_PROCESS_NOTES.md` §10 (pillars), `docs/specs/api.md` §4 (fork).

---

## 1. Why this is worth taking seriously

The render layer is ALREADY state-first:

- `emitElements` consumes compiled states only; `diffMinimal`/`applyOps`/
  `treeFromOps` rebuild the document tree from the op stream — the renderer
  never touches the graph.
- **Fork arms** are per-wire states of ONE node (`nodeId#i`, distinct
  `forkKey`s) — no clone, multiple elements.
- **Def/type components** re-type children at EMIT (`emitOne` +
  `defChildren`), including covered consumers — no clone, no graph change.
- **Derived state** bakes per-arm without handlers or second passes.
- **`pathKey`** is carried on every state; the compile slice
  (`focusedSliceFor`) is the node's walk path; the borrow walk for
  component resolution is the same upward traversal.

The only remaining graph-materialization holdout for prototype-driven
assembly is the `clone-instance` structural op: it copies base + every layer
+ re-materializes every non-child anchor on a FRESH `Link`
(`node.ts:353-391`), then the supervisor registers/attaches/marks the copy
(`supervisor.ts:388-411`). The d12 fork-stress tree assembles **4094
instances from TWO prototypes per layer** (≈22 prototypes total at d12,
`fork-stress-data.md` §1.3) — i.e. 4094 layer-copy loops +
register/attach/reconcile ceremonies. The fresh-`Link` count is NOT ~8k:
the clone loop skips `seed-*` layers (`node.ts:358`) and the family
anchors (string-token children + `Node` parents, `node.ts:373-375`), so
the placement method allocates ~0 fresh Links and the values/link methods
at most ~4k (the per-instance component-link re-materialization) at d12.

The legacy incentives this addresses directly: the legacy pipeline's
clone/apply/restore cycles (legacy `Preempt/src/core/Node.ts:144-163`
layer-value clone, `Placement.ts:81/105` reference-node clone/`placeInto`;
`ComponentAssemblyWorker`/`SlotAssemblyWorker` deep-merge +
`reset to node.data`, `_instantiatedNodes` bookkeeping,
`targetComponents` duplicate Maps, `isAppliedInAncestors` loop guards) were
all state-management machinery bolted onto a clone-based document model. The
rebuild already removed most of it (no stored children, journaled ops,
read-only resolved states, render-time def re-typing).

**Truth model (corrected): the graph is the single truth.** The graph —
nodes + the component, placement, and child/parent links — is what the
compile uses to define node state. The states are an abstraction layer ON
TOP of the graph: derived, read-only, never feeding back (the resolved
mirror never re-enters the compile, `supervisor.ts:173-221`; derived
baking is copy-before-merge, `derived.ts:237-247`). If a flattened
"record" view is ever wanted (a per-instance document like `serializeSlice`
produces), the records are GENERATED FROM THE GRAPH — a derived artifact,
never an authored surface. "State-first" describes only where the
renderer's abstraction boundary sits (states/ops, never the graph); it is
not a claim that states or records are truth.

**Truth model — qualification (three-agent review): the engine paths never
feed back, but handlers are a deliberately state-READING surface.**
`getState` / `c.states` / `node.resolved` expose the resolved states to
handler bodies (`handlers.ts:75,93`), and a handler may GATE its ops on
those state reads (e.g. `if (c.states.length …)`). Those ops are still
authored op streams on the graph — journaled, node-scoped — so the claim
is: the ENGINE never writes from states; authoring code MAY read them and
gate ops on them.

## 2. The model (sketch) — graph truth, records generated, states on top

### 2.1 The layers

```
graph (nodes + component/placement/child-parent links)   ← THE TRUTH
   │  compile (borrow walks over the links, per-name resolution)
   ▼
compiled states (per-wire, path-keyed, bindings/derived) ← abstraction layer
   │  optional flattening (regenerated, never written)
   ▼
flat views (serializeSlice today; a per-instance record view is a
            page-side projection — provenance is NOT graph-derivable, §5)
```

The states are generated from the graph exactly as today (two-scope
compile, fork arms from component-link multiplicity, children from
child-parent edges — children come from child-parent anchors only,
`node.md` §1.1). The flat view, when wanted, is a pure flattening of the
graph — with the same status as `serializeSlice`: derived, read-only,
regenerated after every graph mutation, never a second truth to keep in
sync.

### 2.2 Generation

1. **Instances are graph facts.** A prototype-driven assembly materializes
   instances as graph nodes (`clone-instance`): each instance is a node
   with its own parent edge, ancestors, authored layers, and anchors — the
   component/placement/child-parent links then define its state exactly
   like any other node. This is why instances cannot be fork arms: arms
   are the graph's component-LINK multiplicity (one node, N resolutions —
   `resolve.ts:232-237`); instances differ in authored data, ancestry, and
   children, which only graph nodes carry.
2. **The impossibility argument (answers the incentive "build instances
   without cloning?").** Per-arm authored data is IMPOSSIBLE without either
   (a) an arm-scoped authored truth (a per-arm data store — breaks the
   single-authored-node truth: one node, several authored variants), or
   (b) per-arm graph nodes (which IS `clone-instance`). Under the
   graph-truth model, instances REQUIRE graph nodes; `clone-instance` is
   the graph-truth EXPRESSION of an instance, not a workaround.
3. **Arms vs instances — the precise boundary.** Per-arm DERIVED props
   exist today: `applyDerived` runs per compiled state, so each arm bakes
   its own derived values (DV-H3) with no handlers or second passes. Per-arm
   AUTHORED data is impossible (§2.2.2). Moreover fork arms are
   **leaves-by-fiat at emit**: arms get no children (`childOrder` cleared,
   `render-helpers.ts:237-240`), no def/type re-typing (the def path runs
   only for `armIdx === undefined`, `render-helpers.ts:308-336`), and no
   handlers (`emitOne` attaches handlers only for `armIdx === undefined`,
   `render-helpers.ts:341-347`) — so `fork + children`, `fork + def`, and
   `fork + handlers` are DROPPED at emit. This convention must be declared
   explicitly, and it marks the hole any arms-distinctness claim depends
   on: the still-open `emitElements` DEFECTs (#1 — `cs.forkKey` dropped,
   arms distinct only via the `<nodeId>#<i>` wire suffix; #2 — `cssDef`
   leaked as a `css:cssDef` set op; `docs/test-findings.md` §"Stress-test
   review loop #1"). Placement forks (`api.md` §5 P3: shared
   `placementName` forks exactly like components) are UNVERIFIED
   dynamically — static compile forks fire only on `target` anchors
   (`node.ts:660-663`), and a static legacy envelope cannot express a
   placement fork (stress scenario 10, `stress-test-scenarios.md`).
   **SUPERSEDED (placement-path-spec §1.2/§2 — implementation landed):**
   the §2.2.2 impossibility does not apply — static P3 is now expressible
   (the two-sided placement Link + path enumeration, R2.2 bijection) and is
   the shipped contract; the DEFECT #1 emit hole was fixed as the P3 §6.5
   prerequisite.
4. **Records stay generated-from-graph, with a caveat (see §5).** When a
   flattened per-instance view is wanted, it derives from the graph like
   `serializeSlice` — except provenance, which the graph does NOT carry
   (§5).

### 2.3 What this means for `node.clone`

`Node.clone` stays the graph-truth expression of an instance: the graph
defines node state, so an instance IS a node. The clone ceremony (layer
copy, fresh Links, register/attach) is the cost of keeping the graph true.
The flat view does NOT replace it — it is a derived read-side projection
only (e.g., compact serialization, virtualized diffing), never an authored
or mutable surface.

### 2.4 Mutation & lifecycle (unchanged)

- Ops remain graph ops on node ids, journaled as today; replay/undo/redo
  semantics unchanged.
- After each op, any derived view (states via pass-2, flat views via
  regeneration) is recomputed from the graph — derived, never written.
- Payload ownership, containment, and loop safety are graph-level and
  unchanged (`circular-source` is already path-based).

## 3. Collisions with the current pillars (the honest cost)

| Pillar / contract | Collision | Verdict |
| --- | --- | --- |
| **A — Node: no stored parent/children/state; anchors are truth** | None. The graph IS the truth; states are the abstraction layer on top; records (when used) are generated from the graph. Nothing authored moves | No conflict |
| **B — Supervisor/ClientAPI: journaled ops on nodes** | None. Ops stay node-scoped; the managed channel, journal identity, and replay semantics are unchanged | No conflict |
| **D — layers/compileLocal (pass-1 per node)** | None. Instances are graph nodes (clone-instance) with pass-1 exactly as today; the record view adds no compile scope | No conflict |
| **E — validation/LinkConfig** | None. Anchor materialization remains the enforcement point | No conflict |
| **F — read-only compiled states** | Aligns: states and records are both derived read-only views | No conflict |
| **G — graph invariants (single-parent, cycle guards)** | None. Single-parent stays a graph invariant; cycle guards stay path-based | No conflict |
| **Records fidelity** | DROPPED as a core API (three-agent review): provenance is not graph-derivable (§5), and a fidelity contract for the remainder is near-vacuous — `serializeSlice` already covers flattening | No new surface |
| **Tooling** | Unchanged — graph stays the tooling boundary; the flat view is optional | No conflict |

## 4. Performance reality check

### 4.1 Current-state census (measured, d12 placement)

`node.clone` is not a niche path — it is THE instance mechanism of the
current engine, used at scale in every stress page. Measured census at end
of render (d12 placement, supervisor `allNodes()`):

```
registrations (registerNode): 4117
  ├─ in-tree:              4095   = 2^12 − 1
  ├─ unplaced prototypes:     22   (2 per layer × 11 layers)
  └─ destroyed:               0
clone-instance ops fired:   4094   (= in-tree − 1)
```

Only two rows are ASSERTED by the page's own checks: in-tree = 2^depth − 1
(`fork-stress-data.js:407-418`) and unplaced = the envelope's prototype
count, two per layer (`fork-stress-data.js:420-425`). `registered` (4117
= in-tree + unplaced + destroyed), `clone-instance fired` (4094 = in-tree
− 1) and `destroyed` (0) are DERIVED arithmetic on top of them — nothing
asserts them (`destroy` is first-class, `supervisor.ts:342-349`, but no
demo page fires it, and destroyed nodes stay in `allNodes()` forever).

Clone CONSTRUCTION is cheap, and it is not where the seconds go: the 4094
handler bodies (2 `clone-instance` + 2 state-slice applies each, ≈8–16k
ops total) measure ≈35–70ms across machines in the shim — and `handlerMs`
is an UPPER BOUND on construction, since it times the FULL body (guards +
both state-slice applies included), not just the clones. The EXPENSIVE
part is the incremental pass-2 pipeline those creations drive: each clone
is pass-2 compiled EXACTLY ONCE, at creation — `supervisor.ts:411` marks
only `markPass2(copy.id)` (the copy's chain-slice mark coalesces into the
same flush), and the children-length guard means the page never re-dirties
a clone (`fork-stress-data.js:249-264`). One compile per created node is
the price: 4094 separate per-dirty-node compiles, each `focusedSliceFor` +
slice build + `groupByNode` + `storeResolved` + events + phase dispatch —
the per-call overhead dominates.

### 4.2 The honest numbers

The d12 `pass2` (1297–5888ms live range across machines/rounds) dominates
every total; the entire handler work — 4094 bodies, each ~2 `clone-instance`
ops + 2 state-slice chain writes (≈8188–16k ops) — measures ≈35–70ms across
machines. So the direction stands and the magnitude is now sourced: the
`clone` CONSTRUCTION is NOT the dominant cost — **the incremental
per-dirty-node pass-2 pipeline is** (4094 separate compiles, each
`focusedSliceFor` + slice build + `groupByNode` + `storeResolved` + events
+ phase dispatch — the per-call overhead dominates). This pipeline is paid
by ANY op-driven assembly — attach, destroy, and state-slice pay it per
node too — NOT by clone construction, NOT by clone existence (an idle
node costs nothing between passes), and NOT by cloning as such: an
authored 4095-node document bootstraps once and pays ≈0 pass-2
(`session-defect-review.md:513-514`). Corrected framing: **handler-
expansion assembly pays one pass-2 compile per created node; the cost is
the incremental-compile pipeline the assembly pattern drives.**

**The clone story, assembled.** Clone is the workhorse: 4094 of 4117
registered nodes at d12 (4095 in-tree − root) are clones. What the rebuild
removed is the CEREMONY and the STATE MANAGEMENT around cloning, not the
clone count: the placement clone allocates ~0 fresh Links (the anchor-less
prototypes exercise only the seed-* layer skip, `node.ts:358`, and the
family-anchor skip, `node.ts:373-375`) against the legacy deep-merge/
restore cycles (`_instantiatedNodes` bookkeeping, `targetComponents`
duplicate Maps, apply/reset loops); and the remaining cost is
architectural — instances ARE graph nodes (impossibility argument,
§2.2.2), so a clone-driven assembly multiplies the per-node compile
pipeline 4094×, and that pipeline, not the materialization, is where the
seconds live. The census (§4.1) still reframes the incentive: clone is
HEAVILY used in the current state (4094/4117 nodes at d12 are clones;
zero destruction on the stress pages), so any future instance work must
treat clone as the hot path — not because construction or existence is
expensive, but because a clone-driven assembly pays the
incremental-compile pipeline once per created node. Keeping the graph as
truth means the clone mechanism stays; the record view is not a clone
replacement. It pays for itself only where a flattened read-side document
is wanted (compact serialization, virtualized diffing) — its cost is
regeneration on each mutation, which is small relative to pass-2. Any
claim that "pass-2 slice compiles are ~280ms" would be wrong by an order
of magnitude and is NOT asserted here.

## 5. Bounded landing path (recommendation)

1. **No new authored surface, and NO new API.** The graph remains the
   single truth; `clone-instance` remains the instance-expression
   mechanism (impossibility argument, §2.2.2). A state-first "virtual
   instance" store is not buildable under graph truth.
2. **Declare the arms/instances boundary in the docs** (§2.2.3): per-arm
   derived props are today's limit; per-arm authored data is impossible;
   fork arms are leaves-by-fiat at emit (`fork + children`/`fork + def`/
   `fork + handlers` dropped) — with the emitElements DEFECTs #1/#2
   cross-referenced as the open holes that any arms-distinctness claim
   depends on; placement forks (P3) noted as dynamically unverified.
3. **Provenance is NOT graph-derivable — the `instanceRecords` field
   "which prototype/link it came from" is dropped from any record
   recommendation.** `Node.clone` carries no source pointer (`node.ts:355`
   — `new Node({ ...this.base })`, minted id) and `clone-instance`
   registers the copy without a prototype reference
   (`supervisor.ts:392-393`). `serializeSlice`/`minimalFromState` already
   flatten everything except provenance; the fidelity contract for
   records was near-vacuous and the fork-stress proof was ceremony. If a
   flat per-instance view is ever wanted, it is a PAGE-SIDE PROJECTION
   from the graph — not a core API.
4. **Fidelity contract + tests** (only for what exists): states ==
   graph-derived after each op family (clone-instance, state-slice,
   attach/detach, destroy); regeneration is idempotent; the fork-stress
   placement page keeps one check consuming the state view as the proof.
5. **Gate**: the three-agent review + TDD red→green→trio.

**Verdict**: the graph is the truth; states are the abstraction layer on
top; instances ARE graph nodes (clone-instance is the graph-truth
expression — the only one, by the impossibility argument); fork arms are a
derived, per-arm-props-only view with a documented emit boundary. There is
no state-first document model to build — the rebuild's state-management win
(no stored parent/children/state, journaled ops, read-only resolved states,
render-time def re-typing) is already the graph-truth model. The only
open question is whether a derived flat view earns its keep for specific
consumers (serialization, virtualization) — and if so it is a page-side
projection, since the graph cannot even supply provenance.

---

**Review pointer (three-agent gate):** the later "path-fork compile"
proposal (per-path compiled states pinned to 22 prototypes + root, no
clones) re-asked the state-first question: **REJECTED as stated** in round
1, then **re-evaluated in round 2 after the author's four corrections —
FEASIBLE-WITH-CHANGES as a model (graph stays truth; the §2.2.2
impossibility argument does not apply to the refined proposal), but
DOMINATED for the stated performance goal by coalesced/batched compiles
(§4 lesson)**, with static P3 (placement forks authorable in legacy data)
parked as a separate product-feature candidate — decision record:
`docs/specs/path-fork-review.md` (Round 2 section).
