# Legacy Handler Reuse — AMENDMENT Validity Record (three-agent gate, step 1)

Status: validity analysis of the AMENDED `docs/specs/legacy-handler-reuse-proposal.md`
(the origin-owner element — `{kind: 'layer-apply', ...}` + the 5 user rulings,
§AMENDMENT lines 102-130) against the CURRENT engine (`src/core/*`).
Read-only pass on engine code; the ONLY file written is this one.
Companion: `docs/specs/legacy-handler-reuse-review.md` §11 (step-3 verdict of the
base proposal), `docs/pending.md` (PARKED rows), `archive/reviews/2026-08-15/*`
(DEFECT #10/11 context).

Validation trio at end of pass: `npm test` 779/779 green, `npm run typecheck` clean
(docs-only change).

## 1. The `layer-apply` op — ONE journaled op: FEASIBLE IN SHAPE, but three claims
about it are NOT true of the current code

### 1a. Op vocabulary / journal / replay — mechanically extensible, two needs
- `MutationOp = StructuralOp | StateSliceOp` (src/core/types.ts:140), wire union
  at types.ts:157, `ApplyErrorCode` at types.ts:164. Adding a kind is a plain
  union extension.
- `execute()` (src/core/ops.ts:128-172) has NO default branch; `supervisor.apply`
  falls through to `{status:'no-usable-state'}` for unknown kinds
  (src/core/supervisor.ts:489); `undo()` handles only `attach`/`destroy`
  (supervisor.ts:524-540). Three new branches (execute, apply, undo) are required
  and mechanical.
- Journal: `journalIfApplied` stores `{kind, ...rest}` verbatim
  (supervisor.ts:328-336). `nodes: [NodeData]` is JSON-safe (`NodeBaseData`,
  types.ts:209 — no functions/live refs). ✓
- **NEEDS-X — replay id determinism:** `replay()` re-applies journal entries,
  resolving `op.node` by id (supervisor.ts:505-522). The minted nodes get ids
  from a global counter (`mintNodeId`, src/core/node.ts:29-32) — a replay would
  re-mint FRESH nodes with NEW ids (double-mint; every replay leaks a minted
  generation). The op needs deterministic minted ids (e.g. `${layerId}-n<i>`)
  or id-resolution of the prior mint before re-minting.

### 1b. The anchor-layer machinery cannot carry the family wiring
- `addLayer` → `reconcileAnchors` → `materializeAnchors` (node.ts:538-555,
  759-765, 1224-1250) exists, BUT no src-core producer currently creates a layer
  with an `anchors` decl array (grep of all `addLayer(`/`layers.push(` sites —
  node.ts:368/1176-1202/1309 are value layers; the decl path is exercised only
  by `clone()`'s layer copies, node.ts:619). The layer-apply op would be the
  decl path's first real producer.
- **materializeAnchors CANNOT materialize family-role decls:** role `'child'`
  decls skip when the node already has a child anchor (node.ts:1228); more
  fundamentally, parent/child decls resolve to `'component'`-named links
  (node.ts:1235-1243) whose `roles: ['source','target','duplex']` config
  REJECTS parent/child anchors (link.ts:79-85) — the exception is swallowed by
  the try/catch (node.ts:1244-1248), silently skipping the decl.
  → The creator's layer CANNOT declare the created nodes' family edges. The
  minting + attach must be op-executor work (the `attach` pattern: familyLinkFor
  node.ts:746-757 + `addAnchor('child', node, opts, link)`, ops.ts:50-63; cycle
  guard `findCycle`, ops.ts:133). The layer on the creator is a RECORD, not the
  wiring.
- The role-scoped single-parent exemption (task cites node.ts:648-672; actual
  site node.ts:720-727 — the `addAnchor` child gate, seam-flag-only) is NOT
  needed for the minted nodes' single child anchors. It only matters if a minted
  node is ever re-attached without a prior detach (then the plain gate throws
  `SingleParentError`). The amendment's premise that the exemption "admits
  layer-decl'd child anchors" is true of the SEAM path only — and the seam path
  does not route through layer decls either (materializeSeam builds seam links
  imperatively, node.ts:1334-1363).

### 1c. "Rollback/undo = ONE layer removal (DEFECT #10 unwinds; sweep cascades)"
is currently FALSE for origin-minted edges
- DEFECT #10 removal: `removeLayer`/`removeLayersForSource` (node.ts:557-582,
  584-604) remove only STRING-target decl'd anchors **on the layer's OWN node**
  (`typeof decl.target !== 'string'` guard, node.ts:570/592). The minted nodes'
  child anchors sit on the MINTED nodes — unreachable by removeLayer.
- The `materializeSeam` reversion (node.ts:1261-1278) unwinds only seam links
  tagged `seamTarget` and driven by a still-missing target/duplex seam anchor
  (node.ts:1269-1278). Origin-minted family edges carry no seam anchor and no
  seamTarget → the reversion never fires for them.
- **NEEDS-X:** the rollback needs either (a) an origin tag on the minted child
  anchors + a reversion pass parallel to materializeSeam, or (b) removeLayer
  extended to detach the layer-recorded minted nodes, or (c) op-level undo
  doing the teardown. Today: nothing reaches them.
- **Teardown MUST use detach-style removal, never `link.destroy()`:** the family
  link is SHARED per parent (familyLinkFor, node.ts:746-757; attach ops.ts:50).
  `Link.destroy()` wipes the whole link (link.ts:159-177) → authored siblings
  sharing the creator's family link would lose their child anchors →
  `__onLinkDissolve` → markPending (node.ts:1213-1216) → the sweep gate
  (registry.ts:92) sees them 'unplaced' → **finalizeDestroyed would destroy the
  creator's AUTHORED children too**. The detach count logic (ops.ts:66-77:
  `removeAnchor` when >1 child remains, `link.destroy()` only for the last
  child — LinkConfig `min: 1`, link.ts:96-108/125-134) is the safe path.

### 1d. runtimeMinted (reverse exclusion) — the flag exists, the op must set it
- `runtimeMinted` is per-node, set ONLY by `clone()` (node.ts:327, 652); the
  reverse exclusion is the single filter `!c.runtimeMinted` in `nodeToLegacy`'s
  children walk (src/core/translate.ts:1074, recursing at :1075). The op's
  minted nodes (whole subtree) need the flag — the exclusion mechanism needs
  ZERO changes, only the flag-setting (or a sibling origin flag the filter is
  extended with — see finding 3).

**Finding 1 verdict: feasible-as-designed-in-shape; needs-X on replay id
determinism, a rollback teardown that reaches the minted edges (1c), and
flag-setting on minted nodes (1d). The claim "rollback/undo = ONE layer removal
via the DEFECT #10 machinery" is not true of today's engine.**

## 2. Ruling 2 — the "traceable permanent parent" detection EXISTS; the TRIGGER is missing

- The sweep gate already implements the ruling: `runSweep` skips pending nodes
  whose `state` is `'in-tree'` or `'prototype'` (registry.ts:92); the state walk
  terminates on the permanent-owner tokens — `rootNode` → in-tree (node.ts:427),
  `contentNodes` → in-tree (node.ts:429), `component` → prototype (node.ts:428);
  destroyed owner → unplaced (node.ts:432) → finalizable. `chainRoot`
  (node.ts:279-295) classifies the same kinds. A node with NO chain to a
  permanent token is deleted by `finalizeDestroyed` (registry.ts:127-137). The
  permanent-owner chain kinds from the task (rootNode/component/contentNodes
  tokens, chainRoot, markPending) are all live.
- **What's missing for the origin-owned case is the TRIGGER:** a node enters the
  sweep only via `markPending` (registry.ts:140-145), fired when its OWN child
  anchor is removed (node.ts:668, 743, 1213-1216). An origin-owned node whose
  parent edge is removed but whose child anchor stays on an empty link is never
  marked pending — it lingers registered-but-'unplaced' forever (leak; also
  pollutes the coalesced remote-dirty pass, registry.ts:100). The origin
  teardown (finding 1c) must detach the minted nodes' child anchors → markPending
  → the EXISTING gate then decides.
- The cascade's recursive step already gates in-tree descendants
  (registry.ts:134) — consistent with the ruling: a node with an independent
  permanent chain survives.

**Finding 2 verdict: feasible — the detection is the existing state-gate; the
missing piece is a teardown that actually reaches the origin-owned edges so the
gate runs.**

## 3. Ruling 3 — the explicit origin marker has NO declared home; the only
reverse-exclusion channel today is the per-node runtimeMinted filter

- The reverse-exclusion marker today is exactly `runtimeMinted`, read at the
  single nodeToLegacy filter site (translate.ts:1074; layers have no legacy home
  at all — translate.ts:959-961, so a layer-carried marker on the creator can
  NEVER exclude the minted children by itself).
- Candidate homes and their coverage:
  - **Per-node flag (runtimeMinted or a new `originOwned`):** needed for the
    exclusion (finding 1d) and for the moved-node trace (finding 4). The filter
    is one site — extending it is trivial; setting the flag on the minted
    subtree is trivial.
  - **Layer field on the creator (e.g. `originNodes: string[]`, `preserveOnReverse?`
    — NodeLayer is `{id, sourceName, type, props, css, content, handlers, anchors,
    derived}`, types.ts:204-208, a new field is an open extension):** the natural
    rollback handle (enumerates the minted set for finding 1c) and the natural
    home for the FUTURE preservation-by-reversal flag ("flags a LAYER") — the
    future feature must then OVERRIDE the per-node exclusion at reverse time
    (nodeToLegacy consults the creator's layer → includes preserved minted
    children). Feasible; entirely undesigned.
  - **Anchor options (types.ts:64-82 — seam/applyPath/seamTarget precedent):**
    an origin tag on the minted child anchors would give the cascade its trace
    (finding 4) and serialize fine (serialize.ts:106 spreads options; though the
    SerializedAnchor type only admits `{priority, order}`, serialize.ts:12 — a
    type drift to fix if anchor-carried).
- **Interaction with nodeToLegacy:** today = the runtimeMinted filter only
  (translate.ts:1074); the origin marker must be readable at that site (per-node)
  with the layer-level preservation flag consulted as an override. The amendment
  does not pin the home — a spec decision, not a blocker.

**Finding 3 verdict: feasible; the marker's home is undecided (per-node flag +
layer record is the coherent split), and the preservation-by-reversal override
needs a nodeToLegacy design decision at the single exclusion site.**

## 4. Ruling 5 — the whole-subtree cascade CANNOT reach a moved origin-owned node today

- `finalizeDestroyed` walks family children only (`node.children`,
  registry.ts:131-136; children = familyChildAnchors, node.ts:456-487). A moved
  origin-owned node is NOT in the origin's children (its child anchor sits on
  the new parent's family link) — the walk stops there. The compile-time walks
  (chainRoot node.ts:279, enumPathWalks node.ts:120) walk UP from a node; the
  sweep cascades DOWN. **Nothing in the engine tracks "which origin minted this
  node"** — no Node field, no anchor option, no layer registry keyed by minted
  node. There is no trace to the origin.
- The in-tree gate (registry.ts:134, 92) would also skip the moved node if a
  down-walk reached it.
- **Feasible fix (implied by the amendment, not built):** the origin record
  enumerates the minted node ids (finding 3's layer field); the rollback
  enumerates that set and detaches EACH minted node's child anchor regardless of
  current parent (the detach machinery, ops.ts:66-77), then the EXISTING in-tree
  gate decides survival per ruling 2 (independent permanent chain → survives;
  origin-traced-only → finalized). This is the only coherent reading that
  reconciles rulings 2 and 5 — and that reconciliation is a **contract ambiguity
  the amendment leaves open** (2: "deletes when NO traceable permanent parent";
  5: "cascades ... including placed elsewhere"): the pinned contract must state
  that a minted node moved under a NON-origin permanent parent survives the
  rollback, and only origin-traced descendants are torn down. The review doc
  (legacy-handler-reuse-review.md §11) states both rulings without resolving the
  interaction.

**Finding 4 verdict: not-feasible-as-stated today (the trace does not exist);
feasible with the layer-record enumeration + detach + existing gate, plus a
pinned 2-vs-5 interaction contract.**

## 5. The re-opened children-injection — the legacy-to-layer-apply mapping HOLDS
for the NodeData-subtree form, with three documented deltas

- Legacy semantics (old /Preempt): `receiveNextState({children|nativeChildren})`
  → `addLayer(new NodeLayer('children', 'receiveNextState', 'replace', childrenVal,
  minTargetPhase))` (Preempt/src/core/Node.ts:784-786). The payload type is
  `NextState = Partial<Node> | Record<string, any>` (Preempt/src/types/NodeSchema.ts:174) —
  LIVE Node instances; `addLayer` CLONES Node values into the new parent
  (Preempt/src/core/Node.ts:142-167 — the source keeps its own parent; the
  injection is a clone-into-tree, never a move). The layer is REPLACE-mode,
  sourceName-keyed (`receiveNextState`), phase-gated (Node.ts:763-770).
- The op's `nodes: [NodeData]` maps the DATA form faithfully: `NodeData` ⊇
  `NodeBaseData` (types.ts:209) and the legacy dual-parse (content-as-children)
  is already discontinued engine-wide (translate.md D5/F14) — the op mints
  recursively from the NodeData subtree, and the created nodes attach as family
  children of the creator → identical visible outcome (creator's children
  replaced by the minted subtree). ✓
- **Deltas to pin:**
  1. **Data-only payload:** legacy accepts live nodes (cloned); the op payload is
     NodeData — live-node reparenting is out of scope (matches the bridge's
     data-driven surface; must be stated so the mapping claim is honest).
  2. **Replace semantics:** legacy is replace-by-sourceName. The op's natural
     replace contract is re-apply with the same `layerId` (addLayer replaces by
     id, node.ts:542-545) — which REQUIRES the finding-1c teardown of the prior
     minted set before re-mint (the teardown is the same machinery as rollback).
  3. **Replay id determinism** (finding 1a).
- The `'children'` hard block is NOT violated: the block lives in the
  state-slice path (`applyStateSlice` ops.ts:22-24, supervisor.ts:358-361) and
  api.md §1's "children never a LayerMutation target"; a structural op with its
  own kind bypasses it by construction — the spec must label layer-apply a
  STRUCTURAL op, never a slice.

**Finding 5 verdict: feasible — the mapping holds for the NodeData-subtree form
of the legacy children write; three deltas to pin (data-only payload, replace
contract via layerId + teardown, replay determinism).**

## Single most accurate statement of the engine deltas

The amended element is feasible IN SHAPE — one new journaled structural op kind
(vocabulary + execute + supervisor.apply + journal are all mechanically
extensible; NodeData payloads journal cleanly) — but THREE of its claims are not
true of today's engine: (1) rollback is NOT "one layer removal via the DEFECT
#10 machinery" — removeLayer/materializeSeam-reversion only reach string-target
decl'd anchors on the layer's own node and seam-tagged links, and origin-minted
family edges are neither (a per-origin teardown — detach-style, never
link.destroy — must be built); (2) the sweep's "no traceable permanent parent"
gate exists and is correct for ruling 2, but nothing ever TRIGGERS it for
origin-owned nodes, and (3) nothing traces a moved origin-owned node to its
origin, so ruling 5's whole-subtree cascade is impossible without a minted-set
record + per-node origin marker (which also serves the reverse exclusion at the
existing runtimeMinted filter site, translate.ts:1074, and the future
preservation-by-reversal override). The children-injection mapping holds for the
NodeData-subtree form with three pinned deltas; the marker's home (per-node flag
+ layer record) and the rulings 2-vs-5 interaction contract are open design
decisions the spec must pin before implementation.

## Verification

- `npm test` — 40 files, **779 passed** (expected; docs-only change).
- `npm run typecheck` — **clean** (tsc --noEmit).
- No engine source was modified (read-only pass).
