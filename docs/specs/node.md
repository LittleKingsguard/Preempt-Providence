# Spec — `Node`

Source of truth: `RENDER_PROCESS_NOTES.md` §8 (esp. §8.4), §10.1 (Pillar A),
§10.2 (Pillar B), §10.4 (Pillar D), §10.8 / §10.8.1–§10.8.4 (Pillar G),
and the decided ledgers §10.9 (S1.x, S-R2.x, S-R3.x, S-R4.x — all user-confirmed).

Neighbor specs: `graph.md` owns `Link`/`Anchor`/`LinkConfig`/`LinkConfigError`
internals; `ops.md` owns `StructuralOp` executors; `pipeline.md` owns slice
locking; `validation.md` owns tag-schema value validation; `api.md` owns
`ClientAPI.apply`. This file references their contracts but does not redefine
them.

Boundary rule (notes §10.5): `LinkConfig` enforces *structure* (counts, roles,
order uniqueness) and can never reject a *value*; schema validation checks
*values* and can never break a link invariant.

---

## 1. Core definitions

### 1.1 Absent fields (negative contract)

The following legacy fields **do not exist** on `Node`. Tests must assert
their absence/impossibility.

| Legacy field | Replacement |
| --- | --- |
| `parent` stored field / setter (notes §8.4 #1) | getter-only, derived from graph (S-R2.1) |
| `children` stored array | compiled from family-`Link` child-anchor priorities (notes §10.2); `'children'` is **never** a legal state-slice `targetProp` — children are graph-derived, never stored (api.md owns the union) |
| `_referencingNodes` | anchors; fully removed, nowhere persisted (S2.2) |
| stored `nodeState` / `isInTree` flag | `NodeState` derived per `compile(slice)`, never written (notes §10.1) |
| `undefined` vs `null` parentage probes (notes §8.4 #2) | single derived `NodeState` discriminator |

Assignment to `node.parent`, `node.children`, `node.anchors`, or `node.state`
is a compile-time type error; in strict-mode runtime builds the exposed
objects are frozen/readonly and such writes throw.

### 1.2 Single-parent invariant (S-R3.4, notes §10.8.4 trade-off #2 — DECIDED)

| ID | Rule |
| --- | --- |
| SI-1 | A node carries **≤ 1 `'child'`-role anchor** (its own in-tree edge). |
| SI-2 | A node carries **exactly one `'parent'`-role anchor iff it has ≥ 1 child** (the family side of its own `'parent-child'` Link; S-R2.1, S-R3.13). |
| SI-3 | `'component'`/`'container'`/`'content'`/`'source'`/`'target'`/`'duplex'` anchors are additional peripheral edges; they do not count toward SI-1/SI-2 (P3 §1.1: the placement roles, renamed from `'placement'`, are peripheral exactly as before). |
| SI-4 | A tree anchor's `target` is the resolved owner (`AnchorTarget` union), **never the `Link` itself** (C2). |
| SI-5 | A node's family edge is established/dissolved atomically on the Link — never two independent writes on two nodes (notes §10.8; kills notes §8.4 #1). |

Enforcement: all anchor mutations route through `StructuralOp`s →
`Link.addAnchor/removeAnchor/setOrder` → `LinkConfig` (graph.md). Per-link
violations surface as `LinkConfigError` and the op rejects atomically (no
partial application, notes §10.8.1). **SI-1 is enforced cross-link at op
validation**: offering a second `'child'` anchor to a node that already holds
one fails explicitly and verbosely with the dedicated op-level error
`'single-parent'` (S-R4.2) — NOT a per-link `count-exceeded`, never a silent
`move`; the caller must `detach`/`move` first.

### 1.3 Permanent owners (S-R2.2, S-R3.7 — DECIDED)

Exactly three: **the root node**, **a component prototype**, the
**`contentNodes` array** (template/content-payload unplaced nodes).
`AnchorTarget` includes the tokens `'rootNode' | 'component' | 'contentNodes'`
for chain termination.

---

## 2. Types

```ts
type NodeState = 'prototype' | 'unplaced' | 'in-tree' | 'destroyed'   // notes §10.1

// Owned by graph.md; re-declared here for signature reference only.
type Role = 'parent' | 'child' | 'source' | 'target' | 'duplex' | 'container' | 'content' | 'component'   // P3 §1.1: 'placement' renamed 'container', consumer role 'content' added
type AnchorTarget = Node | 'rootNode' | 'component' | 'contentNodes' | string /* referenceName token */
interface Anchor { role: Role; target: AnchorTarget; options: { priority?: number; order?: number }; link: Link }

type DirtyScope = 'remote'           // pass-2 values stale (parent/children/bindings)
                | 'anchor-populate'  // anchors injected by a compile effect, awaiting population (S-R3.12)
                | 'sweep-candidate'  // lost owner; cascade-destroy check pending (S-R2.3)

interface NodeBaseData {             // ingested from NodeSchema NodeData (notes §3.1)
  type: string
  content?: unknown
  props?: Record<string, unknown>
  css?: CssData
  handlers?: HandlerDef[]
  // placement/component/children in raw data are SEEDS only — they become
  // graph edges via ops, never stored fields (S3.6; notes §10.8).
}

interface CompiledState {
  nodeId: string                     // unique per node, minted at creation (S3.1)
  pathKey: string                    // state identity: the path back to root — family-only 'root/<id>/<id>'
                                     // for ordinary states; placement paths interleave the zone names that
                                     // routed each hop: 'root/<zone>/<ownerId>/…/<nodeId>' (P3 §2.2)
  state: NodeState                   // derived, compile-gated (notes §10.1)
  type: string
  props: Record<string, unknown>
  css: CssSnapshot
  content: unknown
  anchors: readonly Anchor[]         // reconciled view === node.anchors at compile time
  parent: NodeRef | null             // null only when the parent-anchor target is a system token
  children: NodeRef[]                // ordered by family-Link child-anchor priority; PATH-DERIVED for
                                     // path-states — a path-state's children are the descendant path-states
                                     // whose owner-path extends its path by one level, attached at mint time
                                     // (P3 §2.3)
  bindings: Record<string, unknown>  // resolved component values by referenceName (pass-2 borrow)
  unresolved: UnresolvedRef[]        // 'target' anchors with no source/duplex match (notes §10.8.2)
}

type ArmDropReason = 'prototype-terminated'   // silent (S-R2.5)
                   | 'owner-terminated'       // contentNodes / non-root owner; silent (S-R3.10)
                   | 'loop'                   // warns 'circular-source' (S-R2.5); depth-cap/visit-set trips count AS loop (notes §10.3)

interface CompileResult {
  actionable: CompiledState[]        // 0..n; n>1 only via fork (notes §10.8.2); keyed by pathKey
  dropped: Array<{ arm: NodeRef[]; reason: ArmDropReason }>
  warnings: Array<{ code: 'circular-source' | 'unresolved-reference'; pathKey: string }>  // S-R4.3: unresolved-reference logs a warning; the state still renders
}
```

---

## 3. Field inventory

| Field | Type | Writer (only) | Reader |
| --- | --- | --- | --- |
| `id` | `string` | constructor (unique, S3.1 — exact scope in §4.1) | anyone |
| `base` | `NodeBaseData` (readonly canon) | constructor | `compileLocal` |
| `layers` | `NodeLayer[]` — **the canon**, may include `AnchorLayer`s (S-R3.8) | `addLayer`/`removeLayer`/`removeLayersForSource`, only inside a `MutationOp` | `compileLocal` |
| `anchors` | `readonly Anchor[]` — **reconciled materialization** | `compileLocal` reconcile only — **no independent write path** (S1.3/S-R3.8) | pass-2 walks, getters |
| `compiled` | `CompiledState | null` (pass-1 cache + last pass-2) | `compileLocal` / `compileRemote` | getters |
| `dirty` | `ReadonlySet<DirtyScope>` | `markDirty` (ops/compile only) | post-op sweep |
| `state` | `NodeState` — **derived**, refreshed per `compile(slice)` | nobody (computed) | anyone |

No other structural fields exist. Value getters (`type`/`props`/`css`/
`content`/`handlers`) read the pass-1 cache; see §5 for freshness guarantee.

---

## 4. Constructor

```ts
new Node(data: NodeBaseData, actor: Actor)
```

| | |
| --- | --- |
| Pre | none (value validation is the validation phase's job, not the constructor's) |
| Post-1 | `id` minted, unique process-wide (S3.1); auto-IDs (`preempt-node-<hash>`) filled into `props.id`/`css.id` when absent (legacy notes §5.1 retained) |
| Post-2 | `base` frozen; seed `NodeLayer`s (incl. any seed `AnchorLayer`s) appended |
| Post-3 | `compileLocal` has run once: `anchors` materialized, pass-1 cache valid |
| Post-4 | `state` derives from seed anchors: chain→`'rootNode'` ⇒ `in-tree` (supervisor root only); chain→`'component'` ⇒ `prototype`; no chain ⇒ `unplaced` |
| Post-5 | `dirty` empty; no links shared with any other node |
| Fail | none at construction; malformed seed anchors surface at first `LinkConfig` enforcement (graph.md) |

There is **no** `parent`/`phase`/`isInTree` constructor argument (legacy
signature `new Node(item, parent, phase, inTree)` is dead — notes §8.4 #2).

### 4.1 `id` uniqueness (S3.1) — exact guarantee

`mintNodeId()` (node.ts) returns `node-${++nodeSeq}` from a **module-global
monotonic counter**. What this guarantees, and what it does not:

| Claim | Holds? | Detail |
| --- | --- | --- |
| Minted ids are unique **among themselves** | ✅ always | monotonic counter per module instance — two `mintNodeId()` calls never return the same string. |
| Minted ids are unique **against loaded (seeded) ids** | ⚠️ conditional | a seeded doc carries ids verbatim (`data.id`); the constructor uses `id ?? data.id ?? mintNodeId()` and does **not** advance `nodeSeq` for seeds. New minted ids therefore stay clear of the seeded range **only while `nodeSeq` has not reached the seeded numeric range**. |
| Cross-process uniqueness (SSR-shared / multi-doc-per-process smoke) | ❌ not free | in the headless smoke every demo module shares ONE module instance (one counter), so a later doc's seeded `node-N` range can be reached by earlier modules' mints — the runtime `rt-*` wire-id convention sidesteps it (feature-matrix `render()` comment; notes §10.10.10). |

**Verified empirically** (probe, same build): a fresh module instance minting
after loading the shipped feature-matrix doc (seeded `node-31..node-57`) yields
`node-1..node-5` with zero collisions. The failure mode reproduces only when
the counter is pre-advanced ~40+ mints into the seeded range (shared-process
smoke) — then minted ids collide with seeds (`node-46..node-50`). Enforcing
true uniqueness against arbitrary seed ids would need a full-tree scan or a
used-ids collection; **the framework does not do this** — it relies on the
monotonic counter + the loader never resetting it. Consequence for callers:
treat minted ids as unique **within a document's runtime** in a single-process
page; for runtime-created nodes in a multi-doc-per-process harness, pass an
explicit id.

---

## 5. Getters (all setter-less, all derived)

| Getter | Derivation | Notes |
| --- | --- | --- |
| `state: NodeState` | from the node's parent-link: ≤1 `'child'` anchor → its `Link` → the Link's `'parent'` anchor → its `target` (notes §10.1, S-R3.5): target `'component'` ⇒ `prototype`; target `'rootNode'` ⇒ `in-tree`; target a `Node` ⇒ recurse into that node's derivation; no `'child'` anchor or chain reaches no permanent owner ⇒ `unplaced`; post-cascade ⇒ `destroyed` | refreshed per compile; never stored |
| `isInTree(): boolean` | `state === 'in-tree'` | the only membership test legal in user code |
| `parent: Node \| null` | ≤1 `'child'` anchor → its `Link` → the Link's `'parent'` anchor → that anchor's node (S-R2.1); `null` when the target is a system token or no `'child'` anchor exists | O(1) (notes §10.8.4 trade-off 1); `state` disambiguates *why* null |
| `children: readonly Node[]` | the node's single `'parent'` anchor's family Link → its `'child'` anchors, sorted by `options.priority` (unique per S3.2) | `[]` iff no `'parent'` anchor (SI-2) |
| `type/props/css/content` | last pass-1 cache | always fresh: every mutation path runs `compileLocal` synchronously (S2.1) |
| `anchors` | reconciled array | readonly; writes are out-of-contract (§1.1) |

Getters never throw, including on a `destroyed` node (`state` reads
`'destroyed'`; value getters read the last pass-1 cache). **Usability** is
gated separately by S1.1 — see §7 FS-1.

---

## 6. Methods

All mutating methods run **only inside a `MutationOp` context** (ops.md;
journaled via `supervisor.apply`, S-R3.11). Calling them outside an op is a
contract violation (FS-7).

### 6.1 `addLayer(layer: NodeLayer | AnchorLayer, actor: Actor): void`

| | |
| --- | --- |
| Pre | op context active; `state !== 'destroyed'` |
| Post-1 | layer appended to the stack (the canon) |
| Post-2 | `compileLocal` re-run **synchronously**; pass-1 cache + `anchors` reconciled |
| Post-3 | remote dependents marked dirty (`'remote'`); pass-2 scheduled on the render microtask queue (notes §10.8.4) |
| Post-4 | if the layer is/carries anchors: node marked `'anchor-populate'`; the new anchors are **populated by the post-op sweep, never inside this call** (S-R2.9/S-R3.12) |
| Fail | FS-6 (destroyed node) |

### 6.2 `removeLayer(layerId: string, actor: Actor): void` / `removeLayersForSource(sourceName: string, actor: Actor): void`

Same contract as 6.1. `AnchorLayer` removal is **idempotent** and traceable:
the layer is removed together with its generating anchor; double-remove is a
no-op (S-R2.9).

### 6.3 `clone(actor: Actor, options?: { ignore?: string[] }): Node`  (S1.4, notes §10.4)

| | |
| --- | --- |
| Pre | `state !== 'destroyed'` |
| Post-1 | **copies by default: base + full layer stack + anchor profile** (roles/targets/options); options exist only for deviations |
| Post-2 | fresh unique `id` (S3.1); fresh `'parent-child'` priority anchor and component `referenceName` role links **auto-derived** — cloned `Anchor`/`Link` objects are recreated via the `CloneUtils` registry, never shared with the source (notes §10.4) |
| Post-3 | NOT copied: compiled cache, dirty flags, tree membership, `_referencingNodes` (S2.2 — field does not exist) |
| Post-4 | clone derives to `unplaced` unless created by a `clone-instance` op that attaches it in the same transaction (ops.md) |
| Fail | FS-6 (destroyed source) |

### 6.4 `destroy(actor: Actor): void` — only via `{ kind: 'destroy' }` op

| | |
| --- | --- |
| Pre | op context; `state !== 'destroyed'` |
| Post-1 | the node's links dissolved (`link.destroy()` per notes §10.8.1 erase semantics); its `'child'` anchors orphaned |
| Post-2 | every descendant that cannot resolve a path to a permanent owner is marked `'sweep-candidate'` (S1.2, S3.3) |
| Post-3 | **no synchronous state change to `'destroyed'`** — destruction is the sweep's terminal outcome (S1.2, S-R2.3) |
| Fail | FS-6 (already destroyed) |

### 6.5 `markDirty(scope: DirtyScope): void` (internal)

| | |
| --- | --- |
| Pre | called only from op executors or compile — never user code |
| Post | idempotent set-add; node enqueued in the current tick's post-op sweep (coalesced: one sweep per tick, notes §10.8.4) |

---

## 7. Lifecycle state machine

### 7.1 State enum and derivation (compile-gated, notes §10.1 + S1.1)

| State | Graph condition | Compile eligibility |
| --- | --- | --- |
| `prototype` | parent-link chain terminates at a `'component'` target | never render-actionable; usable only as clone/template spec source; fork arms ending here fail **silently** (S-R2.5) |
| `unplaced` | no `'child'`-anchor chain, or chain reaches no permanent owner | **no usable compiled state** (S1.1); transient — valid re-attach target until the sweep runs (S-R2.3) |
| `in-tree` | chain terminates at `'rootNode'` attached directly to the supervisor | fully actionable (the only render-eligible state). **P3 §2.4:** compiled viability is a property of the PATH — the contentNodes token labels its family in-tree (node.ts:213) but terminates the compile walk (family-'in-tree' ≠ compiled viability); a placement-routed node compiles via `compilePath` |
| `destroyed` | terminal outcome of the cascade sweep (S1.2); **not** a hand-written tombstone | compile is a no-op returning nothing; mutations rejected (FS-6) |

### 7.2 Transitions (side effects of graph ops — never direct writes, notes §10.1)

| From | To | Trigger |
| --- | --- | --- |
| — (create) | `unplaced` | construction without a parent-link (content node) |
| — (create) | `prototype` | construction whose seed parent-link targets `'component'` |
| — (create) | `in-tree` | supervisor root construction (parent-link target `'rootNode'`) |
| `unplaced` | `in-tree` | `attach` whose resolved chain reaches `'rootNode'` |
| `unplaced` | `prototype` | `attach` into a component-prototype family (chain reaches `'component'`) |
| `prototype` | `in-tree` | **never directly** — instantiation is `clone-instance` producing a *new* node; the prototype itself never transitions except via `destroy` |
| `in-tree` | `unplaced` | `detach` (child anchor removed; last-child removal escalates: `count-underflow` → `link.destroy()` → parent's `'parent'` anchor dissolved, SI-2 restored; notes §10.8.1, S3.3) |
| `prototype` | `unplaced` | `destroy` op dissolves its links (chain to `'component'` gone) |
| any non-`destroyed` | `destroyed` | **post-op sweep only**: node still resolves to no permanent owner at sweep time (S1.2, S-R2.2/2.3) |
| `destroyed` | — | terminal; no outgoing transitions |

### 7.3 Cascade-destroy (async, S-R2.3, S1.2, S3.3)

- A node that loses its parent-link is left `unplaced` — **transient**, still
  a valid `attach` target.
- Cascade destruction is scheduled **asynchronously** on the post-op
  microtask sweep and fires only for nodes that still resolve to **no
  permanent owner at sweep time** (root / component prototype /
  `contentNodes` survive; S-R3.7).
- A synchronous `attach` before the sweep resolves the chain and **blocks
  destruction**. Covers both parent-first and child-first underflow (S3.3).

---

## 8. Two-pass compile contract (notes §10.8.4 — DECIDED)

`compile(slice, opts?: { focusNodeId? })` is the only sanctioned entry point. Pass order is
described in §8.1; `opts.focusNodeId` scopes console warnings to one node.
Pass-2 (incremental updates) is BOUNDED: the slice is the changed node's walk
path (itself + ancestors + subtree) plus every source-bearing node — never a
whole-tree recompile (notes §10.8.4, §10.10.4).
invariant: **pass 1 completes for the whole slice before any pass 2 runs** —
a batch of local mutations lands before any walk reads them (no half-remote
views, no mid-op walk).

### 8.1 Pass 1 — `compileLocal(node)` — local only, no traversal

| In | Out |
| --- | --- |
| base + own layer stack (canon, S-R3.8) | `type`/`props`/`css`/`content` from `NodeLayer`s; **`anchors` materialized** from layers (incl. `AnchorLayer`s), each carrying role/target/options/link |

- All inputs local ⇒ cost scales with own layers + anchor count; **never
  walks** the graph.
- Reconciles behavior **including the anchor array** against the current
  stack — the on-node `Anchor[]` is the materialization, not a writer
  (S1.3/S-R3.8).
- Injected anchors (from `AnchorLayer`s or any anchor-adding effect) are
  **not populated here** — deferred to the post-op sweep (S-R3.12).
- Idempotent; runs synchronously inside the mutating op (S2.1).

### 8.2 Pass 2 — `compileRemote(node, ctx)` — walks

Runs only after pass 1 (the anchor arrays it reads are current).

| Value | Walk |
| --- | --- |
| `parent` | node's ≤1 `'child'` anchor → its `Link` → the Link's `'parent'` anchor → its node (S-R3.2: starts at the `'child'` anchor, not `anchorsOf('parent')`) |
| `children` order | node's `'parent'` anchor's family Link → child anchors sorted by `options.priority` (unique, S3.2) |
| component bindings | **depth-0 first**: populate the node's OWN `target`s; if the node already carries a `source`/`duplex` for that `referenceName` it resolves at itself before any walk (S-R2.6, S4.1); unresolved targets then walk **toward root**, first `source`/`duplex` match wins (nearest shadows far); no match ⇒ `unresolved` entry with a clear code (notes §10.8.2) — viable compile ⇒ **logged warning + the node still renders its own state** (S-R4.3) |
| placement | the **per-name placement Link IS the zone registry** (P3 §2.1): a node's `content` anchors request routing — the first-match preference loop reads the node's ordered `content` anchors + per-name Link membership, then fans out per `'container'`-role producer anchor (zone) of the chosen name (P3 §1.2; §2 enumeration contract; shares the borrow algorithm but not component role semantics — S-R2.8) |

### 8.3 Forking (notes §10.8.2, §10.8.4; P3 §2.1–§2.2)

- Multiple candidates sharing a `referenceName`/`placementName` ⇒ pass 2
  **forks**: each candidate is a separate `CompiledState` **keyed by its
  path back to the root** (`pathKey`), de-duplicated via unique node ids
  (S3.1).
- **Placement paths (P3 §2.2, implemented):** placement multiplicity is
  path-multiplicative — a consumer forks one path-state per zone of the
  chosen name, each zone a path hop; sibling prototypes sharing a parent set
  produce DISTINCT keys at their final segment (the prototype id). Every
  path-state's `forkKey = pathKey`, set **unconditionally** (node.ts:699-706)
  — there is no `#<i>` arm suffix anywhere in the path model (identity =
  pathKey alone, P3 §10.ab; the `component-source-duplicate` guard at
  `addAnchor` removes the arm-generating case entirely).
- Arm disposition: root-terminated ⇒ actionable; `prototype`-terminated ⇒
  dropped **silently**; other permanent-owner-terminated (`contentNodes`) ⇒
  dropped **silently** (S-R3.10); **loop**-terminated ⇒ dropped +
  `circular-source` warning (S-R2.5). A coerced pick is **never**
  synthesized.
- Loop trip: **per-walk visit set over placement AND family edges** (P3 §1.4)
  + max-depth cap (notes §10.3); same detector used by `attach`/`move` at op
  time (S3.4; `findCycle` walks placement edges too).

### 8.4 Compile scopes

| Scope | Pass 1 | Pass 2 | Use |
| --- | --- | --- | --- |
| node-local (`state-slice` from handler/`ClientAPI.apply`, S2.1) | the one node, synchronous | bounded: node + ancestor chain for parent/bindings, on the microtask queue | cheap minimal-element render diff (notes §10.6) |
| root-out deep | whole slice | one coherent walk | bootstrap / full reconcile |
| **path enumeration (`compilePath`, P3 §2.1 — implemented)** | 23-node graph → 4095 path-states | per-walk visit set (§8.3); walks BOTH edge kinds toward root: placement edges (content anchors → per-name placement Link → container owners — one branch per zone) and family edges (single branch) | the static fork-stress page bootstrap — one enumeration replaces the runtime page's 4094 per-node passes |

Compiled local state is **immutable within a compile** and impossible to
desynchronize (notes §10.8); the slice stays locked until fully resolved — every
fork emitted or dropped (S2.3; locking owned by pipeline.md).

### 8.5 Dirty / mark-dirty contract (notes §10.8.4 decided; S-R3.12; S-R2.3)

1. Pass 1 runs **synchronously** inside the op.
2. Dependents whose *remote* values changed (the parent's `children`, the
   child's `parent`/bindings) are `markDirty('remote')` — **synchronous
   propagation is out**.
3. The **post-op sweep** runs on the render microtask queue, **one sweep per
   tick**, coalescing everyone dirtied by the batch, **right before render
   emit**. Intra-sweep order: (a) `'anchor-populate'` — populate anchors
   injected by any anchor-adding effect incl. new layers (S-R3.12);
   (b) `'remote'` pass-2 compiles; (c) `'sweep-candidate'` cascade-destroy
   checks (§7.3) — all inside the sweep, **before** the render emit.
4. No whole-tree recompile; no mid-op walk; re-running an already-clean node
   in a sweep is a no-op (idempotency).

---

## 9. Fail-states (TestWriter checklist)

| ID | Trigger | Required behavior |
| --- | --- | --- |
| FS-1 | `compile` on a not-in-tree node (`unplaced`/`prototype`/`destroyed`) | returns **no usable/actionable compiled state — never a partial state** (S1.1); `CompileResult.actionable` empty; arm recorded in `dropped` with the correct `ArmDropReason`. **P3 §2.4 carve-out (implemented):** a node whose placement path enumerates to `'rootNode'` IS viable output — the `placementRouted` branch compiles actionable path-states for it (the `selfProviding` carve-out precedent, RENDER_PROCESS_NOTES.md §10.10.4; `node.state` stays family-derived — in-tree is a family fact, not compiled viability) |
| FS-2 | second `'child'`-role anchor offered to one node (SI-1) | op validation fails **explicitly and verbosely** with the dedicated op-level error `'single-parent'` (cross-link check — NOT a per-link `LinkConfigError`/`count-exceeded`, never a silent `move`; S-R4.2); op rejects atomically, graph unchanged (notes §10.8.1); caller must `detach`/`move` first |
| FS-3 | `'parent'`-anchor removal that would orphan the family / last-child removal | `LinkConfigError` `count-underflow`; intended escalation: `link.destroy()` → child anchors orphaned → nodes `unplaced` (notes §10.8.1 erase) |
| FS-4 | duplicate child `priority` on a family Link | `LinkConfigError` `unique-order` carrying `conflicting`/`currentCell`; caller retries at max+1 (S3.2); failed write leaves link untouched |
| FS-5 | `attach`/`move` that would create a cycle | op-time loop detector (compile-time detector run off the destination's parent-chain) → **test-and-rollback**: op rolls back, graph unchanged (S3.4) |
| FS-6 | any mutating method (`addLayer`/`removeLayer`/`clone`/`destroy`) on a `destroyed` node, or outside an op context | rejected; no layer/graph/cache change |
| FS-7 | compile-time walk revisits a node or exceeds the depth cap | arm dropped with reason `'loop'`; loop arms log `circular-source` (S-R2.5); depth-cap trips count AS loop. **P3 §1.4 (implemented):** the path-enumeration walk carries a **per-walk visit set** over placement AND family edges — revisiting a node on the same walk drops that arm with `'loop'` + `circular-source`; sibling walks are unaffected (never shared across walks). `findCycle` (op-time) walks placement edges as well as family edges |
| FS-8 | component `target` with no `source`/`duplex` up to root | node enters **unresolved-reference compile state with a clear code** (notes §10.8.2) — a compile state, not a throw; on a viable compile the node **logs a warning and still renders its own state** (S-R4.3) — not dropped, not hidden |
| FS-9 | direct write to `node.anchors` / `node.parent` / `node.state` / `node.children` | impossible: no setters, readonly/frozen exposures (§1.1); strict-mode runtime throws |
| FS-10 | `state-slice` mutation targeting a placement zone | hard-blocked — anti-looping safeguard retained (notes §8.3); synchronous `apply` rejection `'placement-target-blocked'` (S-R4.1); placement changes go through the dedicated **`placement-attach` op** only (P3 §3.3/§9-Q2 — never `attach`-with-zone; `attach` stays family-only) |
| FS-11 | unlock attempt before the slice fully resolves (forks still pending) | illegal (S2.3); owned by pipeline.md, listed here for cross-reference |

### Anti-loop guarantees (summary for probes, cf. Step-7 e2e)

- A→B→A anchor circles: FS-5 at op time, FS-7 at compile time.
- Component self-reference: resolves at depth 0 if self-providing (S4.1);
  otherwise FS-7/FS-8.
- Dangling source/target: FS-8.
- Placement re-entry through `state-slice`: FS-10.

---

## 10. Serialization (decided: notes §10.6, S3.1, S4.2)

- Compiled node state — including anchor/link form — round-trips to the
  existing `NodeSchema` JSON shape (`preempt-initial-data`, mock data, SSR
  brush); output is a first-class JSON document, never an in-object proxy.
- Anchors serialize as typed refs: `{ role, target: id|name|token, options }`.
- Fork states de-duplicate and serialize via unique node ids plus `pathKey`
  traces (S3.1); no phantom coalescing.
- After hydrate the client **re-resolves** from the serialized anchors
  (re-runs the same pipeline) rather than materializing shipped forks
  blindly (S4.2).

---

## 11. TestWriter derivation map (exhaustiveness gate)

States: `prototype`, `unplaced`, `in-tree`, `destroyed` — one happy-path
test per state confirming derivation (§7.1) and compile eligibility (FS-1).
Transitions: one test per row of §7.2, including the two `— (create)` rows
per birth case and the sweep-gated `→ destroyed` rows (assert *not*
destroyed synchronously; assert destroyed after the microtask sweep; assert
rescue via pre-sweep `attach`, §7.3).
Methods: constructor §4 (5 post-conditions), getters §5 (incl. null-parent
disambiguation via `state`), 6.1–6.5 pre/post.
Compile: pass-1 locality (no walk — assert with disconnected graph), pass
ordering (§8 intro), borrow walk (depth-0, nearest-shadows-far, unresolved),
fork keying + all three `ArmDropReason`s, dirty coalescing (one sweep/tick,
intra-sweep order §8.5).
Fail-states: one fail-safe test per FS-1…FS-11 row.
Clone: default copy (base+layers+anchors, fresh ids/links, no cache/dirty/
`_referencingNodes`), `ignore` deviation, destroyed-source rejection.
Invariants: SI-1…SI-5 each probed by one violation test (FS-2…FS-4 cover
SI-1/SI-2 enforcement; SI-4/SI-5 asserted via graph shape after ops).
