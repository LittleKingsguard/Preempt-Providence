# Spec — Ops: `MutationOp` / `StructuralOp`, Reducers, Replay

Source: `RENDER_PROCESS_NOTES.md` §10.2, §10.8.1, §10.8.4, §10.9 (S1.x–S4.x, S-R2.x, S-R3.x, S-R4.x). Decisions referenced by ID throughout; no new design decisions are made here.

---

## 1. The op union

```ts
type MutationOp = StructuralOp | StateSliceOp

type StructuralOp =
  | { kind: 'attach';          node: Node; to: Node; zone?: string; priority?: number }
  | { kind: 'detach';          node: Node; from?: Link }
  | { kind: 'move';            node: Node; to: { parent: Node; priority?: number } }
  | { kind: 'clone-instance';  source: Prototype; slot: PlacePointer; priority?: number }
  | { kind: 'destroy';         node: Node }

interface StateSliceOp {
  kind: 'state-slice'
  node: Node
  mutation: LayerMutationList   // targetProp union owned by api.md; 'children' is NEVER legal (graph-derived, never stored)
  actor: Actor
}

/** Actor/session identity — the principal an op is attributed to (journal, undo/redo, telemetry). */
type Actor = string
```

| Op | Ledger ref | Notes |
| --- | --- | --- |
| `state-slice` | S2.1 | Successor to `receiveNextState`. Synchronous `compileLocal` + queued pass-2. **Joins the same replayable journal** as structural ops. |
| structural kinds | notes §10.2 | Each kind = one executor writing anchors/links under `LinkConfig` enforcement. |

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
- Single-parent invariant: ≤1 `'child'`-role anchor per node; exactly one `'parent'`-role anchor only when the node has ≥1 child (S-R2.1, S-R3.4). A second `attach` on a node that already holds a `'child'` anchor **fails explicitly and verbosely at op validation** with the dedicated op-level error `'single-parent'` (cross-link check — NOT a per-link `count-exceeded`, NEVER silently treated as `move`; S-R4.2). Caller must `detach`/`move` first.

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
- Placement expressed via the cloned subtree's anchors (`'placement'`-role anchor on the zone's family Link, populated by compile) — **no legacy `Placement*` types** (S3.6, S-R2.8).

### 2.5 `destroy`

- Dissolve the node's links (notes §10.8.1 erase semantics): link destroys itself and cascades to anchors; parent/child participants call link destruction (S3.3).
- **Async cascade** via post-op sweep (notes §10.8.1, S-R2.3): every descendant that cannot resolve a path to a permanent owner at sweep time cascade-destroys; `'destroyed'` is the terminal outcome of that cascade, not a stored tombstone (S1.2, S3.3).

---

## 3. Decomposition of legacy behaviors

| Legacy concept | Decomposes to | Ledger ref |
| --- | --- | --- |
| `Placement` | `attach` + `'placement'`-role anchor on the zone's family `Link` (populated by compile; shares the borrow algorithm, not component role semantics) | S-R2.8, S3.6 |
| Clone-into-zone | `clone-instance` + `attach` (with `zone`) | notes §10.2 |
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
3. **In-tree gating** (S1.1): compile attempt on a node not in-tree returns **no usable compiled state** (not partial).
4. Journaled identically to structural ops for replay/undo.

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
| Journal contents | Ordered, named ops with their payloads — sufficient to replay or invert. Both op kinds share one journal. | notes §10.2, S2.1 |
| Replay order | Journal order = execution order; replay re-runs op executors (with the same loop guards / rejections), not raw anchor writes. | notes §10.2 (event-sourcing) |
| Undo | Invert the journaled op stream (named ops are invertible); undo/redo fall out of the journal. | notes §10.2 |
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
| G9 | `state-slice` / compile on not-in-tree node | **No usable compiled state** (not partial) | S1.1 |
| G10 | Pass-2 fork with multiple same-name sources | Multiple compiled states keyed by path-to-root; ambiguous-terminating cases surface as multiple states, never a coerced pick | notes §10.8.4 |
| G11 | Fork arm terminating at prototype/`contentNodes` | Fails silently; contributes no actionable state | S-R2.5, S-R3.3, S-R3.10 |
| G12 | Fork arm looping | Logs `circular-source` warning; arm dropped | S-R2.5 |
| G13 | Journal replay | Ops re-executed in journal order; same rejection/rollback behavior as live execution | notes §10.2 |
| G14 | Undo / redo | Inverted/replayed named ops restore graph; undo/redo derived from journal alone | notes §10.2 |
| G15 | Effect adding anchors (new layer incl.) | New dirty sweep forced; anchors populated post-op, never mid-compile | S-R3.12 |
| G16 | Second `attach` without `detach` | Op validation fails explicitly + verbosely with the dedicated op-level error `'single-parent'`; never two `'child'` anchors, never a silent `move`; caller `detach`/`move`s first | S-R4.2, S-R3.4 |
| G17 | Role not admitted by link's `roles` whitelist | `role-mismatch` rejection | S-R3.9 |
| G18 | Batch with multiple dirtied dependents | One microtask; one coalesced pass-2 sweep; no whole-tree recompile | notes §10.8.4 |
| G19 | `destroy` on node with descendants | Link dissolve + async cascade over descendants lacking permanent-owner path | notes §10.8.1, S3.3 |
| G20 | Slice unlock before final resolution | Not allowed; unlock only after every fork emitted/dropped | S2.3 |

---

Spec: StructuralOp/MutationOp kinds, executors, reducers, journal/replay, and dirty-propagation contract — `/media/ryan/Shared Files1/Projects/Preempt-Providence/docs/specs/ops.md`
