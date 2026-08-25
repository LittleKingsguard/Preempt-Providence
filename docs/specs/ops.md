# Spec — Ops: `MutationOp` / `StructuralOp`, Reducers, Replay

Source: `RENDER_PROCESS_NOTES.md` §10.2, §10.8.1, §10.8.4, §10.9 (S1.x–S4.x, S-R2.x, S-R3.x, S-R4.x). Decisions referenced by ID throughout; no new design decisions are made here.

---

## 1. The op union

```ts
type MutationOp = StructuralOp | StateSliceOp

type StructuralOp =
  | { kind: 'attach';          node: Node; to: Node; zone?: string; priority?: number }  // zone: declared but SUPERSEDED by
                                                                                         // 'placement-attach' (P3 §9-Q2) — attach stays family-only
  | { kind: 'detach';          node: Node; from?: Link }
  | { kind: 'move';            node: Node; to: { parent: Node; priority?: number } }
  | { kind: 'clone-instance';  source: Prototype; slot: PlacePointer; priority?: number }
  | { kind: 'destroy';         node: Node }
  | { kind: 'placement-attach'; node: Node; container: Node; names: string[];
      trigger?: { kind: 'placement'; linkName: string; direction: 'container-added' | 'container-removed' | 'content-added' } }
      // P3 §3.3/§9-Q2 — the dedicated placement-attach op (F-4). `AttachOp.zone`
      // is superseded by this kind; `attach` stays family-only. The op payload
      // carries the trigger-identity fields (C-2/10.ac.2 #7); supervisor.apply
      // derives them when absent (container anchor newly minted ⇒
      // 'container-added', else 'content-added').

interface StateSliceOp {
  kind: 'state-slice'
  node: Node
  mutation: LayerMutationList   // targetProp union owned by api.md (§1: 'type' | 'content' | 'handlers' |
                                // `props.${string}` | `css.${string}` | `hooks.${string}` — HOOKS §1 note);
                                // 'children' is NEVER legal (graph-derived, never stored)
  actor: Actor
}

/** Actor/session identity — the principal an op is attributed to (journal, undo/redo, telemetry). */
type Actor = string
```

| Op | Ledger ref | Notes |
| --- | --- | --- |
| `state-slice` | S2.1 | Successor to `receiveNextState`. Synchronous `compileLocal` + queued pass-2. **Joins the same replayable journal** as structural ops. |
| structural kinds | notes §10.2 | Each kind = one executor writing anchors/links under `LinkConfig` enforcement. |
| `placement-attach` | P3 §3.3/§9-Q2 | Dedicated placement op: register-if-new, mint ordered `content` anchor(s) + `container` anchor (with the §1.3 ancestor-name veto), dirty = container + added node only (E2E-4). Trigger identity rides the payload into the pass-2 dispatch (silent abort). |

`NodeState` (`'prototype' | 'unplaced' | 'in-tree' | 'destroyed'`) is **derived from the anchor graph per `compile(slice)`** (notes §10.1) — ops never write state fields; state transitions are side effects of graph ops.

**Internal vs wire:** this file owns the **internal** op shape — ops carry live `Node` / `Link` / `Actor` values. The **wire** shape (owned by api.md §1) references the same entities by ID: `Node` ↔ `NodeRef`, `Link` ↔ `LinkId`, `Actor` ↔ `string`. `supervisor.apply` resolves wire IDs to live objects at the journal boundary.

---

## 2. Executor semantics (per kind)

### 2.1 `attach`

| Step | Action | Ledger ref |
| --- | --- | --- |
| 1 | Create or reuse the destination's family `'parent'` anchor on its `'parent-child'` `Link` (satisfies `LinkConfig.parent.count: 1` even before the addend has children) | S-R3.13 |
| 2 | Add the child's single `'child'` anchor with `priority` in `options` **on that same `Link`** | notes §10.2 |
| 3 | Loop guard: run the compile-time traversal detector off the **destination's parent-chain**; detected cycle → **roll the op back** (test-and-rollback) | S3.4 |
| 4 | Both anchor mutations land **atomically** — the family edge as a single object; never two independent field writes (kills notes §8.4 #1) | notes §10.8 |

- `priority` omitted → **append max+1** (no reindexing by default; collisions throw `unique-order`; explicit `setOrder` retries at max+1 — S3.2).
- Single-parent invariant: ≤1 non-seam `'child'`-role anchor per node; exactly one non-seam `'parent'`-role anchor only when the node has ≥1 child (S-R2.1, S-R3.4; the seam's `options.seam` anchors are scoped OUT of both counts — §2.7 ALS-4/ALS-5, F15/F19). A second `attach` on a node that already holds a family `'child'` anchor **fails explicitly and verbosely at op validation** with the dedicated op-level error `'single-parent'` (cross-link check — NOT a per-link `count-exceeded`, NEVER silently treated as `move`; S-R4.2). Caller must `detach`/`move` first. The seam's layer-materialized child anchors are NOT attach ops — they bypass the gate via the role-scoped addAnchor exemption (§2.7 ALS-4).

### 2.2 `detach`

| Step | Action | Ledger ref |
| --- | --- | --- |
| 1 | `removeAnchor(childAnchor)` (or the specified `from` link's anchor) | notes §10.2 |
| 2 | Removing the **parent** anchor instead → `count-underflow` `LinkConfigError`; caller may escalate to `link.destroy()` — a deliberate wipe disposing the whole link and **orphaning its child anchors** | notes §10.8.1 |
| 3 | Orphaned nodes drop to derived `'unplaced'` — **transient**, still valid attach targets | S-R2.3 |
| 4 | Cascade-destroy is **async** (post-op microtask sweep); fires only for nodes still resolving to **no permanent owner** (root node / component prototype / `contentNodes`) at sweep time | S-R2.2, S-R2.3, S1.2 |

Synchronous re-`attach` before the sweep resolves the tree and **blocks destruction** (S-R2.3).

### 2.3 `move`

- Reanchor: same `Link` (`setOrder` on the existing `'child'` anchor) or a new `'parent-child'` `Link` (detach + attach semantics).
- Same loop guard as `attach` (destination parent-chain detector; cycle → rollback, S3.4).
- `priority` collision → `unique-order` rejection; retry at max+1 (S3.2, notes §10.8.1).

### 2.4 `clone-instance`

- Clone subtree + its link family from a `Prototype` into a `PlacePointer` slot.
- Clone machinery per Pillar D (notes §10.4): default copy = base + layers + anchor profile (S1.4); `CloneUtils` registry includes `Link`/`Anchor` fns so a deep clone recreates the whole family; fresh `'parent-child'` priority anchors auto-derived; `_referencingNodes` does not exist (S2.2).
- **Not the placement mechanism** (P3 §9-Q2/F-4): placement goes through the dedicated `placement-attach` op (§2.6); clone-instance stays the component-instantiation / after-compile-expansion path only.
- **HANDLER-LOGIC ONLY (user clarification 2026-08-15):** clone-instance is NOT needed by the legacy translation system (translateLegacy never clones) and NOT needed by the base engine (compile/emit/render/resolution never clone — placements = path enumeration + seam anchor layers, components = resolution + seam; the graph redesign's whole point was removing literal node-cloning from placement/component logic). The op exists solely for HANDLER logic (the fork-stress `stress-expand` bodies — `clientAPI.apply` with `{kind: 'clone-instance'}`) and the wire vocabulary. Stress-loop defects #9/#11 (clone link reuse for name-keyed anchors; runtime-minted clones excluded from reverse) hardened clone() for that handler path.

### 2.5 `destroy`

- Dissolve the node's links (notes §10.8.1 erase semantics): link destroys itself and cascades to anchors; parent/child participants call link destruction (S3.3).
- **Async cascade** via post-op sweep (notes §10.8.1, S-R2.3): every descendant that cannot resolve a path to a permanent owner at sweep time cascade-destroys; `'destroyed'` is the terminal outcome of that cascade, not a stored tombstone (S1.2, S3.3).
- **REQ-GAP-12 — teardown-to-root in ONE destroy op (handoffs-review-2 §REQ-GAP-12, user ruling 1, 2026-08-21):** an EXPLICIT destroy marks the destroy as **cascade-capable** (internal state only — never an op payload, never journaled, replay-safe); the sweep's `finalizeDestroyed` then relaxes the payload-content exemption for the destroyed node's EXPLICIT (family parent-child) children:
  - **family trees** were already O(1) (the first destroy dissolves the shared family link — every sibling orphans at once); the flag makes **payload trees** O(1) too: the destroyed owner's `contentNodes`-owned children are unregistered from content ownership and destroyed in the same sweep — **teardown-to-root = one `destroy` op on the tree owner** (the per-child loop is no longer needed on flag-bearing hosts);
  - **SKIPPED by the cascade** (exemptions intact): **placement-owned** children (nodes carrying `content`-role anchors — the placement-may-return persistence letter stands: placement content survives an owner destroy) and **`'component'`-token prototype nodes** (def/seam prototypes never render and are untouched; a destroy of a prototype-rooted node — a def-root — leaves its whole family subtree alone);
  - **retention split preserved:** `runtimeMinted` children are `markDestroyed` (walk slots stable — the parent still lists them in the family walk), never dissolved;
  - every content child the cascade destroys is `unregisterContentNode`'d first (the destroy op unregisters only its direct target);
  - the relaxation applies to the EXPLICIT-destroy path ONLY: a detached/orphaned payload root still persists in the background (placement may return) — the content exemption is untouched for non-destroy paths.
  - **Per-child fallback (pre-flag hosts / placement-owned subtrees):** the documented recipe remains one `destroy` op per child (or per placement-owned subtree root).

### 2.6 `placement-attach` (P3 §3.3/§9-Q2 — E2E-4)

| Step | Action | Ledger ref |
| --- | --- | --- |
| 1 | **Register the node if new** (supervisor.registerNode — idempotent); the added node is a consumer that was not (or is no longer) part of the tree | P3 §3.3 |
| 2 | Mint the node's **`content` anchor(s)** on the shared per-name placement Link — one per requested container name in `names`, **preference order preserved** (dedup keep-first — re-attach is idempotent); `#`-containing names are skipped | P3 §1.1/§1.3 |
| 3 | **Mint/ensure the `container` anchor** on the target container node for the attach zone (`names[0]`) — under the **§1.3 ancestor-name veto** — LOOP-PREVENTION ONLY (user correction 2026-08-14): fires when an ancestor of the container node WOULD ATTEMPT TO PLACE INTO the zone (`content`-role anchor for it; a descendant presentation would create a placement-path loop) ⇒ warn `placement-name-vetoed`, warn+skip, never a throw; DUPLICATE PRESENTATION (an ancestor merely OFFERS the zone) is LEGAL (override) | P3 §1.3, F-4 |
| 4 | Mark pass-2 dirty **only the container node + the added node** — E2E-4's ideal affected set (nothing at depth>4 recalcs for a depth-4 add) | P3 §3.3, §9-Q2 |
| 5 | **Journal + replay**: node-scoped like the other structural ops (state-slice placement block unchanged — P4). The journal entry carries the op verbatim, trigger identity fields included | notes §10.2, 10.ac.2 #7 |

**Trigger identity (silent-abort carrier, C-2):** the op payload carries
`{ kind: 'placement', linkName, direction }` — which placement link the update
changed; `supervisor.apply` derives it when absent (container anchor newly
minted ⇒ `container-added`, else `content-added`) and passes it into the
pass-2 dispatch, where the compiler entry evaluates the relevance pre-check
(`placementChangeIrrelevant`, chosen name from the node's last states'
`activePlacement`) per affected node BEFORE any state regeneration —
irrelevant ⇒ silent abort: no states, no events (P3 §1.2/§3.3).

### 2.7 Anchor-layer seam (component-assembly materialization — D7, live-prod disposition 2026-08-14; Step-3 rulings F15/F16/F17/F19 + delivery-shape ruling applied — LANDED)

The D7 anchor-layer seam materializes a def's subtree onto a consumer node
when a component binding `{target: 'type' | 'content' | 'children',
reference: X}` resolves a value-carrying source anchor (translate.md §2 — the
seam is PLANNED at translate with `options.seam = 'type' | 'content' |
'children'` persisted on the consumer's target anchor, F17; the def's
children AND the DEF-ROOT are PRE-MINTED at translate as out-of-tree
`'component'`-token prototype nodes, F16 + delivery-shape ruling — this
section is the assembly-time materialization):

| Rule | Statement |
| --- | --- |
| ALS-1 | **DELIVERY SHAPES (user ruling 2026-08-14 — the split by seam target; B1 clarification 2026-08-14 — NEVER collapse, node data as-is):** `content` = TEXT delivery ONLY (ALS-7); `children` = ORIGINAL NODE DATA AS-IS + PROTOTYPE ADDED — the consumer NEVER collapses and NEVER drops its own authored text/children: it stays its own distinct element and the DEF-ROOT node materializes as an ADDITIONAL seam-wired child AFTER the authored children (`div(shell text) > [p(authored), nav.nav-bar > logo]`), carrying the def's type + css (classes + cssDef rules); `type` = SHELL COLLAPSE — the consumer's element BECOMES the def's element (the consumer's element takes the def's type AND the def's css (classes + cssDef rules); the current empty-host def-fill behavior is correct for type-targets). **FAMILY NOTE (the two component-rule families, clarification 2026-08-14):** the seam (this §2.7 — graph-time anchor-layer materialization) is a DIFFERENT mechanism from the emit-time def-chain (render.md §3.4.2 DFC/P-EMIT-3 — fork-stress link-method re-typing + the childless-host fill). They were conflated once — the SED-2 branch was nested inside the def-chain's empty-host branch, which silently narrowed the children-target contract to empty hosts and dropped the wrapper's own content (RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md). Discrimination: `options.seam`-planned bindings = seam family (never chain); seam-less bindings with RE-TYPING-SPEC defs = def-chain family; DELIVERABLE-spec defs (children carrying content/css/props/children/component) = seam material only, NEVER chain (B1) |
| ALS-1b | **DEF-ROOT minting (delivery-shape ruling, LANDED):** the def's ROOT element is pre-minted at translate as a `'component'`-token prototype node TOO (sibling of the def-children prototypes, F16 machinery: registered via `registerNode`, census-visible, `mintNodeId()` id, derived state `'prototype'`), carrying the def's type + css (classes + cssDef) and the child links to the pre-minted def-children prototypes. The def-root is the element-level carrier of the def's css: its cssDef rules are emitted once the def-root has a renderable compiled state (D4 interplay — the def-root's cssDef rules join the deduped styles block, render.md STL-3/SED-1/SED-2). For `type`-targets the def-root serves as the def-value carrier (its type/css merge into the consumer — no separate element); for `children`-targets the seam wires it as the consumer's seam child (SED-2) |
| ALS-2 | **Parent-anchor contract per shape (delivery-shape ruling):** `children`-target — the DEF-ROOT is "the resolved node": the def-root's CHILDREN links carry their parent anchors ON the def-root (`defRoot.addAnchor('parent', defRoot, { seam: true }, link)` — target = self, seam-flagged), and the CONSUMER's seam child link points at the def-root (the consumer mints its own `'parent'` anchor for the def-root's link — target = self, `options.seam = true`, on the consumer's anchors list, ALS-5 scoping applies). `type`-target — the consumer is "the resolved node": each passed child link's parent anchor sits ON the consumer (`consumer.addAnchor('parent', consumer, { seam: true }, link)`). Either way: never minted on the def/prototype side, never left pointing at the def's original host, never carried as layer data |
| ALS-3 | The consumer's OWN family parent edge is UNTOUCHED — same rule as `clone()` skipping family parent anchors. The seam's passed links are NOT family attach ops |
| ALS-4 | **Single-parent guard scoping — role-scoped addAnchor exemption (F15):** the `SingleParentError` throw for a second `'child'` anchor (node.ts:648-672) is exempted for LAYER-MATERIALIZED child anchors — a `'child'` anchor whose decl carries `options.seam = true` (or a matching seam marker on the layer's anchor decl) is added WITHOUT the single-parent gate; every other `'child'`-role `addAnchor` keeps the gate (family attach ops — G25 unchanged: a second family `attach`/`move` of an already-family-parented node still rejects `'single-parent'`). A def referenced more than once gives its child nodes (and, for `children`-targets, the def-root) MULTIPLE LEGAL PARENTS via the seam — INTENDED (live-prod disposition D7): the JSON format is inherently non-reference-based (def children are separate JSON subtrees), so the pre-component-processing tree cannot express multiple parents anyway |
| ALS-5 | **Parent-role scoping (F19):** the seam's `'parent'`-role anchors (one per adopted child link — on the consumer for `type`-targets, on the def-root for `children`-targets — all `options.seam = true`) are DISTINCT from the family parent anchor. The "exactly one parent-role anchor per node" invariant (S-R2.1/S-R3.4) is scoped to NON-SEAM anchors: a node may hold the family parent anchor PLUS any number of seam parent anchors. `familyLinkFor` (node.ts:687-698 — `anchors.find(a => a.role === 'parent')`) FILTERS OUT `options.seam` anchors and keeps returning the family link; a real `attachChild`/`attach` after a seam still grabs the family link. `children` (the family-child walk) is likewise unaffected by seam parent anchors |
| ALS-6 | The def's PLACEMENT links ride the layer unchanged (content anchors on the shared per-name placement Link — placement-path-spec §10.ag): the layer passing does not re-mint, re-order, or re-veto them. For `children`-targets the def-root node carries the def's placement links (they are the def-root's own anchors) |
| ALS-7 | **Content-target text mechanism (F13 mechanism, LANDED):** when the seam target is `'content'` (the binding's persisted `options.seam`), the anchor layer additionally carries a `content` VALUE — the def's own `content` field (when the def has one) — as a layer field. `compileLocal` merges layer fields like any layer (node.ts pass-1 merge: base seeded, layers override), so the CONSUMER's compiled content slot takes the def's `content` value. The layer contents are the testable unit (a TestWriter pins the layer's `content` field), not just the final text; a def WITHOUT a `content` field delivers no content (the consumer keeps its authored content) — the text mechanism never invents text from children, props, or bindings (`scalarBinding` is not involved). Seam targets `'children'`/`'type'` carry NO `content` value — they deliver structure only (ALS-1/ALS-1b/ALS-2) |

**D8 (def children out-of-tree, pre-minted):** def children are OUT-OF-TREE
`'component'`-token prototype nodes pre-minted at translate (F16) — they
render ONLY when wired in by component assembly through
this seam; the host node's own emission never includes them (the emit-time
def-chain is scoped to the fork-stress 1:1 link method — render.md §3.4.2
DFC-1..3). **Path enumeration (F18):** seam-wired def children enumerate via
their PRIMARY (family) path — the seam links are EXCLUDED from the
path-walk's parent selection (placement-path-spec §10.ag supplement); the
seam parent anchors never contribute a path hop. **AUTH-SEAM carve-out
(2026-08-16 — decisions.md AUTH-SEAM row):** when the def carries a
PHASE-handler binding (`handlerPhase` anchor option, afterAssembly →
after-compile), the TYPE-target consumer RE-HOMES the def-root's children:
the def child's PRIMARY family edge moves from the def-root's family link
(dissolved via `Link.destroy` — the S-R3.4 min-1-bypassing mechanism) to the
CONSUMER's family link (the adopted child anchor carries the seam flag —
G24 admission beside the seam-wired edge). The adopted def child is then
genuinely IN-TREE (its state walks to the consumer → root; the legacy write
surface `clientAPI.apply` state-slice/destroy lands on it) and marked
`runtimeMinted` (reverse-excluded like a clone-instance — the authored
truth is the def's children data). The seam parent anchors stay excluded
from the family walk (ALS-5 untouched); the adopted child's appearance in
`consumer.children` is via the NEW family edge — the carve-out to the
G27/F18 letter ("a seam-wired def child never appears in consumer.children"
stays true for the seam edge). Destroy of a runtime-minted node uses
RETENTION destroy (`markDestroyed` — the family edge stays, the walk keeps
the slot, the compile drops the node); authored in-tree nodes keep the
edge-dissolving destroy.

**Clone-seam contract (PINNED — stress-test review loop round 4, scenario
35; DEFECT #9):** `clone()` copies the anchor profile (node.md §6.3 Post-1),
so a clone of a seam consumer carries the seam target anchor — on a FRESH
per-copy Link (Post-2, never shared). The seam materialization contract is
binding-resolution-driven: a seam-planned binding whose def resolves
materializes (this section's opening sentence) — and the clone's binding
DOES resolve (the ancestor walk finds the provider), so the seam MUST
materialize on the clone: exactly ONE seam parent anchor on the clone and
the def-root gains the second seam child anchor (multiple legal parents,
G24/ALS-4). The provider/registry read is name-keyed through the hub — the
ORIGINAL per-name component Link (`defPrototypesFor`/`defRootPrototypeFor`
are per-link registries) — NEVER the anchor's own link: a link-local value
read on a fresh per-copy Link (no provider on it) silently no-ops the
graph-side seam wiring while the emit-side still renders the clone's def-root
copy (SED-2 via the ancestor-walk binding) — the graph census and the render
DIVERGE for clones. Engine gap: `materializeSeam` reads `linkOf(a)`
(node.ts:1211-1213) — see the finding.

---

### 2.8 `layer-apply` (the ORIGIN-OWNER op — archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review.md §12.4, LANDED 2026-08-15)

The origin-owner element's core, unparked: ONE atomic journaled structural op
that mints a set of created nodes under a creator and wires an anchor layer to
it. The legacy-bridge children-injection mapping (`receiveNextState({children})`
→ ONE layer-apply) is the LANDED consumer (user directive 2026-08-15 — the
review §7 decision-2 "cut" is superseded; the primitive is engine-level).

| Rule | Statement |
| --- | --- |
| OO-1 | **Op shape:** `{kind: 'layer-apply', target, layerId, sourceName, decls: AnchorDecl[], nodes: NodeData[]}`. Executor mints each NodeData as a FAMILY CHILD of `target` (fresh `Node`, appended after the current children on the target's family link), sets `node.originLayer = layerId`, registers `node.id` in the module-level minted-set registry (`registerMinted`/`unregisterMinted`/`mintedByOrigin` — survives creator death, A1), and applies `addLayer({id: layerId, sourceName, anchors: decls})` to the target. The journal result persists `minted: NodeId[]` (A3 — replay resolves the ids to the existing nodes; a replayed op hits the idempotency gate) |
| OO-2 | **Idempotency:** re-applying the SAME layerId is a NO-OP (the target already carries the layer; no second mint, census unchanged) |
| OO-3 | **Family-children-only veto (A5):** v1 mints family children ONLY. A NodeData carrying an `anchors` field warns `layer-apply-anchors-rejected` and the child data STILL mints; the smuggled seed anchors never materialize (stripped before construction) |
| OO-4 | **Origin-marked decl admission:** the layer's CHILD-role decls carry `options.origin = layerId` (injected at apply; the marker split's anchor side). `addAnchor`'s role-scoped single-parent exemption (ALS-4) admits origin-marked second `'child'` anchors exactly like seam-marked ones; a plain second family child anchor still rejects `'single-parent'` |
| OO-5 | **Teardown = the creator's removeLayer/removeLayersForSource** (the whole-subtree cascade, ruling 5): the layer's generating anchors are removed (DEFECT #10) AND each minted node of that layer is decided by the PRE-DETACH survival predicate (B2) — doomed iff its CURRENT family chain reaches a non-permanent terminal (`chainRoot ∈ {unplaced, destroyed-owner, loop, slice-root, token 'other'}`) OR the chain still passes through the creator; survives iff the chain reaches a permanent token (rootNode/contentNodes/component) under a NON-origin parent. Doomed → `detachNodeSafe` (the shared sibling-preserving detach — works on a moved node's current child anchor) → the sweep cascade destroys it and its subtree; survivor → PROMOTION: `originLayer` cleared + unregistered (becomes authored content, reverse-emitted). Every touched node is unregistered; double-remove is a no-op |
| OO-6 | **Reverse exclusion:** `nodeToLegacy` excludes children whose `originLayer` is set (like the runtimeMinted filter — the authored envelope is base truth); a promoted node reverses as authored |
| OO-7 | **Bridge mapping LANDED (user directive 2026-08-15):** `receiveNextState({children})` is ONE `layer-apply` — deterministic per-consumer layerId `legacy-kids-<nodeId>`, `sourceName: 'legacy-bridge'`, child decls in payload order (`priority` = index), NodeView entries in the payload coerced to their data shape (style re-serialized); re-injection with the same layerId is a no-op (OO-2); a MIXED payload (children + state keys) rides the atomic layer-apply + a SEPARATE state-slice. **Mint semantics pins (blind test #4):** a NodeData carrying `type: 'component'` (or any type string) mints as an ORDINARY family child — `type` is carried verbatim; the `'component'` token exists ONLY as a family-link parent-anchor target (node.ts `familyParentTokenOf`), never as a node's type string. A css slice's `cssDef` key is a PLAIN css key — the value lands in the merged pass-1 css unchanged (no special casing; the emit-side cssDef rules read the merged value like authored cssDef). **Mint semantics pins 2 (blind test #5, proofreader):** the mint is ONE LEVEL — a minted NodeData's NESTED `children` are silently DROPPED (the Node constructor never recurses; no warn — a payload must be leaf-shaped), and an `anchors` field warns `layer-apply-anchors-rejected` + is stripped (OO-3). **An EMPTY payload (`{children: []}`) is NOT a teardown:** on a layer-bearing target it is the OO-2 idempotent no-op; on a layer-less target it APPLIES an EMPTY layer that blocks every later mint (the layer exists → OO-2). The teardown (OO-5 removeLayer/removeLayersForSource) is engine-side only — no legacy body op kind invokes it (op kinds: state-slice/destroy/layer-apply/attach/detach/move/clone-instance/placement-attach); a body clears minted children by destroying them individually. Still open (review §12.4-7): serialization fate (A2 — runtime-only + promotion today), non-child-anchor cleanup vs render-path prune (A4), the preservation-by-reversal flag (a FUTURE feature — NOT-YET-IMPLEMENTED) |

Pins: tests/unit/legacy-shape-ops.test.ts Run B (O1–O9). Teardown helper
history: the pre-existing ops detach was a whole-family-link wipe (critique
PROBE-1); the safe per-node detach is DEFECT #12's `detachNodeSafe`.

---

## 3. Decomposition of legacy behaviors

| Legacy concept | Decomposes to | Ledger ref |
| --- | --- | --- |
| `Placement` | the **`placement-attach` op** (§2.6): `content` anchors minted per `targetPlacement` name (preference order) + `container` anchor ensured on the target container node, on the shared per-name placement Link; attach stays family-only | P3 §1.1/§3.3, §9-Q2 |
| Clone-into-zone | `clone-instance` + `attach` — component instantiation only; placement no longer decomposes through clone-instance | notes §10.2, P3 §9-Q2 |
| Component instantiation | `attach` + `clone-instance` on `'parent-child'` Links | notes §10.2 |
| `parent` setter side effects | **Deleted.** No `parent` field; `parent` is a getter only (≤1 `'child'` anchor → its `Link` → the Link's `'parent'` anchor → its node) | notes §10.2, S-R2.1 |

---

## 4. Reducers & batch bookkeeping

- Each op is an **ordered list of anchor/link mutations** executed against the graph; **batch bookkeeping = the op list** (notes §10.2).
- **No partial application**: every rejecting method leaves the link in its pre-call state; enforcement is atomic with validation (notes §10.8.1). Rejected writes surface as actionable `LinkConfigError`s, **never partial state** (notes §10.2).

```ts
class LinkConfigError extends Error {
  code: 'unique-order' | 'count-exceeded' | 'count-underflow' | 'role-mismatch' | …
  linkId: string
  config: LinkConfig  // serialized
  detail: {
    intendedAnchor?: { role: Role; target: AnchorTarget; options: AnchorOptions }
    conflicting: Anchor[]    // e.g. anchor(s) already holding the requested order
    currentCell: Anchor[]    // full current anchor set for caller inspection
  }
}
```

### Rejection → retry / erase matrix (notes §10.8.1)

| Trigger | `code` | Caller reaction |
| --- | --- | --- |
| Insert child with colliding `priority`/`order` | `unique-order` | Read `conflicting`, pick fresh order (max+1), retry. Failed write left link untouched. |
| Remove parent anchor (would drop count to 0) | `count-underflow` | Escalate to `link.destroy()` — one-step deliberate wipe; child anchors orphaned (→ `unplaced`). |
| Anchor with role the link doesn't admit | `role-mismatch` | Fix role/link pairing; `roles` whitelist per `LinkConfig` (S-R3.9). |
| Second `'child'` anchor on one node (`attach` without `detach`) | — op-level `'single-parent'` (NOT a `LinkConfigError`) | Cross-link op-validation failure, explicit + verbose (S-R4.2); caller `detach`/`move`s first, then retries. |
| Op-time cycle (`attach`/`move`) | — (rollback) | Loop detector off destination parent-chain; op rolled back atomically (S3.4). |

### `state-slice` reducer (S2.1)

1. **Synchronous pass 1**: `compileLocal(node)` — reconcile against the node's own layer stack (canon, S-R3.8): props/css/content/type + the anchor array (materialized from layers incl. `AnchorLayer`s).
2. **Queued pass 2**: remote-dependent values marked dirty → microtask sweep (§5 below).
3. **In-tree gating** (S1.1): compile attempt on a node not in-tree returns **no usable compiled state** (not partial). P3 §2.4 carve-out: a placement-ROUTED node (enumerated placement path to root) compiles actionable path-states via `compilePath` — the gate keys on the family-derived `NodeState`, which content roots clear through the contentNodes-ownership minting at translate (P3 §10.ad/F-13).
4. Journaled identically to structural ops for replay/undo.

**HOOKS branch (hooks-map-review.md §7 — the value-provider slot, IMPLEMENTED
2026-08-16):** a `hooks.<name>` mutation is 'replace'-only; the supervisor's
state-slice ENTRY gate rejects `hook-name-unresolved` (no source/duplex
anchor for the name on the node) and `hook-mode-blocked` (append/replaceAll),
and warns `hook-seam-exempt` + no-ops a seam/def-shaped provider (the
landmine guard — hooking a def would tear the seam; `isDefShapedValue`:
`type`-bearing node data, `content`-carrying objects, `{name, body}` handler
defs, `anchor.options.seam`). The write lands ONE deterministic
`hook-<name>` replace-in-place layer (`addLayer`'s findIndex→replace — never
the seq-based `slice-${seq}` layer-id scheme) carrying the value in the
layer's dedicated `value` slot (never a `props.*` key), mirrors the provider
anchor's value (`a.value = value` — the ONE source the serialize/loadState/
nodeToLegacy surfaces already ship), and the inherited E2E-3 consumer walk
dirties the per-name link's target owners (consumers + resolvedStates
refresh + emit). `value: undefined` clears the hook (layer removed; the
authored value, preserved as the layer's `hookFallback` at the first write,
restores to the anchor).

---

## 5. Dirty propagation contract (notes §10.8.4)

| Rule | Statement | Ref |
| --- | --- | --- |
| Pass 1 in-op | `compileLocal` runs **synchronously inside the op** (structural or `state-slice`). No traversal; cost scales with the node's own layers + anchor count. | notes §10.8.4 |
| Dirty marking | Dependents whose *remote* values changed (children, parent/bindings consumers) are **marked dirty**. | notes §10.8.4 |
| Pass 2 scheduled | Dirty nodes' `compileRemote` is scheduled on the **existing render microtask queue** — one sweep right before render emit. | decided, notes §10.8.4 |
| Coalescing | **One microtask per tick.** Everyone dirtied by a batch compiles remote in the same sweep. No synchronous propagation, no mid-op walk, **no whole-tree recompile**. | notes §10.8.4 |
| Bounded pass 2 (node-local) | Node-local update: pass 2 = ancestor chain only (parent + source/duplex borrow); cheap minimal-element render (notes §10.6). | notes §10.8.4 |
| Root-out deep compile | Pass 1 over the whole slice, then pass 2 as one coherent walk. Same `compile(slice)` primitive, different entry point. | notes §10.8 |
| **Anchor-adding effects force a new dirty sweep** | ANY effect that adds anchors — **including a new layer** (not just `AnchorLayer`s) — triggers a new post-op dirty sweep; injected anchors are populated by that sweep, never inside the compile pass that created them. | **S-R3.12**, S-R2.9 |

Two-pass shape:

```ts
compile(slice: Node[]) {
  slice.forEach(node => compileLocal(node))   // PASS 1 — local, sync, no traversal
  slice.forEach(node => compileRemote(node))  // PASS 2 — parent/children/bindings walks
}
```

Fork-arm disposition during pass 2 (notes §10.8.2, S-R2.5, S-R3.3, S-R3.10): multiple valid sources/placements → one compiled state per path-to-root key; prototype/`contentNodes`-terminated arms **fail silently**; loop-terminated arms log `circular-source`; a coerced pick is never synthesized.

---

## 6. Journal contract (replay / undo-redo)

- Ops **stay named and replayable** (event-sourcing style) → **undo/redo for free** (notes §10.2).
- **Canonical public entry**: `ClientAPI.apply(nodeRef, mutation)` (S2.1, S-R3.11).

```ts
// ClientAPI.apply signature is OWNED BY api.md §1 — reference only:
//   apply(nodeRef: NodeRef, mutation: MutationInput): ApplyResult
//   type MutationInput = LayerMutationList | StructuralOp
// A LayerMutationList is wrapped INTERNALLY into a { kind: 'state-slice' } op
// by ClientAPI.apply — callers never submit a pre-formed state-slice op.
interface Supervisor {
  apply(op: MutationOp): ApplyResult   // accepts the WIRE/journal shape (NodeRef/LinkId/string —
                                       // api.md §1); resolves IDs to live internal objects at the
                                       // journal boundary, then journals, executes, schedules sweep
}
```

| Contract point | Statement | Ref |
| --- | --- | --- |
| Journaling point | `supervisor.apply` journals every `MutationOp` (structural + `state-slice`); `ClientAPI.apply` is the public surface that journals **through** it. | S2.1, S-R3.11 |
| Journal contents | Ordered, named ops with their payloads — sufficient to replay or invert. Both op kinds share one journal. Additive result fields (2026-08-24): `state-slice` journals `result.sliceLayers` (the layer ids `applySlice` created — the undo handle + replay gate) + `result.hookUndo` (per hook mutation: pre-op `anchor.value` + created/replaced/cleared disposition); `clone-instance`/`rows-mint`/`layer-apply` journal `result.minted`; **a KEYED `rows-mint` ALSO journals `result.reused` (changed in-place ids) + `result.removed` (teardown rows) + `result.preRecord` (the pre-op BatchRecord / null — the D8 exact-inverse undo fact-set, handoffs-review-6.md)**. The journal is process-local and NEVER serialized. | notes §10.2, S2.1; handoffs-review-4.md §3, handoffs-review-6.md D10/D8 |
| Replay order | Journal order = execution order; replay re-runs op executors (with the same loop guards / rejections), not raw anchor writes. Replay is **no-journal** (2026-08-24): it re-applies WITHOUT growing the journal and refreshes the original entry's `result` in place; the idempotency gate skips already-applied entries (state-slice: all recorded sliceLayers exist; hooks: layer exists AND value-equality; clone-instance: the recorded minted copy is live). | notes §10.2 (event-sourcing); handoffs-review-4.md §3b/§3c |
| Undo | **Per-kind undo support table (2026-08-24 — the G14 amendment, handoffs-review-4.md §3a/§5 + Feature 1b D8):** supported — `state-slice` (EXACT via the journaled sliceLayers — removeLayer per id; hooks restore the pre-op `anchor.value` with created/replaced/cleared handling; dirties the node + its source/duplex consumers; no phases/handlers, no emitStructure), `attach` (EXACT — safe per-node detach), `destroy` (PINNED NO-OP — destroy is terminal, pending.md REQ-GAP-12), `rows-mint`-PLAIN (payload-controlled teardown via the batch record's layerId), **`rows-mint`-KEYED-REUSE (EXACT INVERSE — D8): re-apply the journaled `result.preRecord` through the SAME keyed executor (`journal:false`) — restores the record + every reused node's values, destroys the mint-new half (remove-missing), re-mints the removed half (FRESH ids — identity-across-undo is not a promise, D8); the preRecord is PRESERVED across the replay/redo result-refresh (D9 — a re-apply never clobbers the first-applied pre-op facts); an entry with `preRecord === null` (the op CREATED the batch) keeps the plain payload-teardown inverse**. Documented NO-OPs (not silent — recorded contract, each with its parked fact-set for a future user-gated pass): `detach`/`move` (need the pre-op `{parent, priority}` journaled), `clone-instance` (retention slot-stability collision — tombstone placeholder vs re-activation is a user gate), `layer-apply` (OO-5 teardown ≠ faithful inverse — the one-line `removeLayer(op.layerId)` shape is parked with its promotion-divergence note), `placement-attach` (needs `wasNodeNew`/`containerAnchorMinted` + inverse trigger; the shared container anchor must survive), `rows-clear` + the `rows: []` rows-mint clear variant (need the pre-clear record journaled — `preRecord` does NOT un-park them this pass; a clear is a separate op). Undo never throws: per-inverse try/catch; destroyed targets and missing layers are silent no-ops. | notes §10.2; handoffs-review-4.md §3a/§5, handoffs-review-6.md D8/D9 |
| Slice locking during processing | A consumed slice stays locked through render/processing; unlock only after final resolution (all forks emitted/dropped) — journal entries are complete only for resolved slices. | S2.3 |

---

## 7. Exhaustiveness gate — states & fail-states for TestWriter

| # | State / fail-state | Expected outcome | Ref |
| --- | --- | --- | --- |
| G1 | `attach` to valid parent | Parent `'parent'` anchor created/reused + child `'child'` anchor added on same Link, atomically | S-R3.13 |
| G2 | `attach`/`move` creating a cycle | Op rolls back (test-and-rollback); graph in pre-op state | S3.4 |
| G3 | `priority` collision on `attach`/`move`/`setOrder` | `LinkConfigError` `code:'unique-order'` with `conflicting`; retry at max+1 succeeds | S3.2, notes §10.8.1 |
| G4 | `detach` of parent anchor | `count-underflow`; escalate `link.destroy()` → child anchors orphaned → `unplaced` | notes §10.8.1 |
| G5 | Orphan re-attached synchronously before sweep | Tree resolved; cascade-destroy blocked | S-R2.3 |
| G6 | Orphan still ownerless at sweep time | Async cascade-destroy fires; descendants without permanent-owner path destroyed | S-R2.3, S1.2, S3.3 |
| G7 | Mid-op rejection | **Atomicity**: link in pre-call state; no partial application | notes §10.8.1 |
| G8 | `state-slice` on in-tree node | Sync `compileLocal`; dirty pass-2 queued; journaled | S2.1 |
| G9 | `state-slice` / compile on not-in-tree node | **No usable compiled state** (not partial). P3 §2.4 carve-out: placement-routed nodes compile actionable path-states via `compilePath` — viability is a property of the path, not the family label | S1.1, P3 §2.4 |
| G10 | Pass-2 fork with multiple same-name sources | Multiple compiled states keyed by path-to-root; ambiguous-terminating cases surface as multiple states, never a coerced pick | notes §10.8.4 |
| G11 | Fork arm terminating at prototype/`contentNodes` | Fails silently; contributes no actionable state | S-R2.5, S-R3.3, S-R3.10 |
| G12 | Fork arm looping | Logs `circular-source` warning; arm dropped | S-R2.5 |
| G13 | Journal replay | Ops re-executed in journal order; same rejection/rollback behavior as live execution; NO-JOURNAL re-apply (the journal never grows on replay) + the sliceLayers/minted idempotency gate (handoffs-review-4.md §3b/§4) | notes §10.2 |
| G14 | Undo / redo | Inverted/replayed named ops restore graph; undo/redo derived from journal alone — **per the per-kind support table (§6, 2026-08-24 amendment):** exact inverses for state-slice/attach/rows-mint; pinned no-op for destroy; documented no-ops (with parked fact-sets) for detach/move/clone-instance/layer-apply/placement-attach/rows-clear; no-journal redo with in-place result refresh (one journal entry per op) | notes §10.2; handoffs-review-4.md |
| G15 | Effect adding anchors (new layer incl.) | New dirty sweep forced; anchors populated post-op, never mid-compile | S-R3.12 |
| G16 | Second `attach` without `detach` | Op validation fails explicitly + verbosely with the dedicated op-level error `'single-parent'`; never two `'child'` anchors, never a silent `move`; caller `detach`/`move`s first | S-R4.2, S-R3.4 |
| G17 | Role not admitted by link's `roles` whitelist | `role-mismatch` rejection | S-R3.9 |
| G18 | Batch with multiple dirtied dependents | One microtask; one coalesced pass-2 sweep; no whole-tree recompile | notes §10.8.4 |
| G19 | `destroy` on node with descendants | Link dissolve + async cascade over descendants lacking permanent-owner path | notes §10.8.1, S3.3 |
| G20 | Slice unlock before final resolution | Not allowed; unlock only after every fork emitted/dropped | S2.3 |
| G21 | `placement-attach` (E2E-4) | Node registered if new; ordered `content` anchors minted (dedup keep-first); `container` anchor minted/ensured under the §1.3 ancestor-name veto (`placement-name-vetoed` warn+skip — loop-prevention only: an ancestor would attempt to place into the zone; duplicate presentation legal); pass-2 dirty = container + added node only — a depth-4 add recalcs nothing at depth>4; journaled verbatim (trigger fields included), replay idempotent | P3 §3.3/§9-Q2/F-4 |
| G22 | Trigger identity / silent abort | Placement-affecting ops pass `{ kind: 'placement', linkName, direction }` through `supervisor.apply` into the pass-2 dispatch; the compiler entry evaluates `placementChangeIrrelevant` (chosen name from the node's last states' `activePlacement`) before `compilePath` — an irrelevant (less-favored) update ⇒ zero state regeneration, zero events; a relevant (chosen-link) update regenerates | P3 §1.2/§3.3, C-2/10.ac.2 #7 |
| G23 | D7 seam: def resolved once (ALS-1/1b/2/3) | **children-target:** the DEF-ROOT (pre-minted `'component'`-token prototype carrying the def's type + css + the def-children links, ALS-1b) materializes as the consumer's seam-wired child; the def-root's child links carry their parent anchors ON the def-root (target = self, `options.seam = true`); the consumer's seam child link points at the def-root. **type-target:** the consumer is the resolved node — each passed child link's parent anchor sits ON the consumer (target = self, `options.seam = true`). Either way the consumer's own family parent anchor is untouched; seam anchors excluded from `familyLinkFor` and the exactly-one-parent invariant (ALS-5) | D7 (live-prod 2026-08-14; F15/F16/F19 + delivery-shape ruling) |
| G24 | D7 seam: def referenced MORE THAN ONCE (two consumers) | the def's child nodes (and, for `children`-targets, the def-root) may end up with MULTIPLE LEGAL PARENTS — LEGAL, intended; no `SingleParentError`, no `'single-parent'` op error: the role-scoped addAnchor exemption admits layer-materialized `'child'` anchors carrying `options.seam = true` (ALS-4); the exemption is the ONLY bypass — any other second `'child'` anchor still throws | D7 (live-prod 2026-08-14; F15 + delivery-shape ruling) |
| G25 | family `attach`/`move`/`clone-instance` of a node that already holds a family `'child'` anchor | STILL rejected with `'single-parent'` (G16) — the guard scoping is seam-side only (the `options.seam` role-scoped exemption, ALS-4), family attach enforcement is unchanged | D7 (live-prod 2026-08-14; F15) |
| G26 | seam parent anchors vs familyLinkFor (F19) | `familyLinkFor` filters `options.seam` parent anchors and returns the family link; a real `attachChild` after a seam still grabs the family link; the family `children` walk ignores seam parent anchors | D7 (live-prod 2026-08-14; F19) |
| G27 | seam-wired def children in path enumeration (F18) | enumerate via their PRIMARY (family) path only — the seam links are excluded from the path-walk's parent selection; seam parent anchors never contribute a path hop (placement-path-spec §10.ag supplement). **AUTH-SEAM carve-out (2026-08-16):** a PHASE-bound def's children are RE-HOMED onto the CONSUMER's family link (adoptDefChildren — primary family edge moved, `runtimeMinted` + seam-flag admission) — they enumerate as ordinary family children of the consumer; the "seam-wired child never appears in consumer.children" letter stays true for the SEAM edge only | D7 (live-prod 2026-08-14; F18) + AUTH-SEAM 2026-08-16 |
| G28 | content-target seam text delivery (ALS-7) | the anchor layer carries a `content` VALUE (the def's own `content` field, when present) merged by `compileLocal` into the consumer's content slot; a def without `content` delivers none (consumer keeps its authored content); `'children'`/`'type'` seam layers carry NO `content` value; `scalarBinding` not involved | D7 (live-prod 2026-08-14; F13 mechanism) |
| G29 | delivery shapes (ALS-1/1b — user ruling 2026-08-14) | `children`-target: the consumer keeps its OWN element (the wrapper shell) and the DEF-ROOT element materializes as its seam-wired child (def type + css incl. cssDef rules on the def-root); `type`-target: SHELL COLLAPSE — the consumer's element takes the def's type + css (classes + cssDef rules; empty-host def-fill is correct for type-targets) and no separate def-root element renders; `content`-target: text only (G28). The def-root's cssDef rules join the deduped styles block once it has a renderable compiled state (D4 interplay, render.md SED-1/2) | D7 (live-prod 2026-08-14; delivery-shape ruling) |
| G30 | `destroy` on a tree owner with payload-content children (REQ-GAP-12) | **Teardown-to-root = ONE destroy op.** The explicit destroy marks the destroy cascade-capable (internal flag); the sweep unregisters + destroys every EXPLICIT family child that is payload content — SKIPPING placement-owned children (`content` anchors — placement-may-return letter intact), `'component'`-token prototype children (def/seam prototypes untouched; a prototype-rooted destroy leaves its whole family subtree), and the retention split (`runtimeMinted` children → `markDestroyed`, walk slots stable). Journal shape unchanged (the flag is never an op payload); non-destroy paths (detach/orphan) keep the content exemption | handoffs-review-2 §REQ-GAP-12, user ruling 1 (2026-08-21) |

---

Spec: StructuralOp/MutationOp kinds, executors, reducers, journal/replay, and dirty-propagation contract — `/media/ryan/Shared Files1/Projects/Preempt-Providence/docs/specs/ops.md`
