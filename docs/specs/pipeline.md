# Pipeline Spec — `PhaseRegistry`, `PhaseWorker`, Workers, Locking

Derivative of `RENDER_PROCESS_NOTES.md` §10.3 (Pillar C), §8.1–§8.3, §10.8.4,
§10.9 (S1.1, S2.1, S2.3, S3.4, S-R2.2/2.3/2.5/2.6, S-R3.7–3.13, S-R4.1, S-R4.3). The notes
remain the source of truth; this file is the behavior contract for
implementation and for the TestWriter — every state and fail-state in §8 must
be derivable to a test.

---

## 1. `PhaseRegistry` — canon

The registry map is the **sole artifact** defining phase order, the
`name → worker` binding, locking order, and (auto-generated) docs (notes §10.3).

- **Canon rule (notes §8.2 / line-127 fix).** On any mismatch between the registry
  and worker-file JSDoc or older docs (`docs/skills/overview.md`), the
  **registry wins**; the stale comments are corrected to match the registry,
  never the code altered to match them.
- Numeric phase IDs are **derived from `order` at runtime** and exist only as
  internal data for lock-order comparisons (e.g.
  `componentAssembly (4) < validation (7)`). Callers never see or hard-code
  numbers (notes §8.1 #1). **`emitToPhaseName` is the only emission entry point.**
- Mini commentary ("preprocessing/validation/…") lives **only** in the
  registry entry's `summary`; worker docstrings must not mirror the map. Docs
  are generated from the registry, not hand-maintained.
- Adding a phase = registering one object. Inserting a worker mid-set
  renumbers nobody downstream: `order` is data, code never references it.

### 1.1 Interface

```ts
type PipelineStage =
  | 'instantiation'
  | 'targetPlacementResolution'   // alias: 'placement'
  | 'placementAssembly'
  | 'componentRouting'
  | 'componentAssembly'
  | 'slotAssembly'
  | 'preprocessing'
  | 'validation'
  | 'elementCreation'
  | 'treeAssembly'
  | 'postprocessing'

interface PhaseRegistryEntry {
  stage: PipelineStage
  worker: PhaseWorker
  order: number          // relative order only; locking order derives from it
  summary: string        // the ONLY place phase commentary lives; doc source
}

interface PhaseRegistry {
  register(entry: PhaseRegistryEntry): void      // rejects duplicate stage | duplicate order
  getWorker(stage: PipelineStage): PhaseWorker   // unknown → PipelineError('unknown-stage')
  getPhaseNumber(stage: PipelineStage): number   // derived; INTERNAL use (lock order) only
  stages(): readonly PipelineStage[]             // ascending order
  docs(): string                                 // auto-generated phase documentation
}
```

### 1.2 Registered phases (canon)

| order | stage (`PipelineStage`) | worker | contract summary |
| --- | --- | --- | --- |
| 0 | `instantiation` | `InstantiationWorker` | **Rebuild manager** (notes §8.3: role preserved): regenerates/restructures existing nodes via graph ops; owns the pipeline-internal mutations legacy routed through `receiveNextState` (notes §8.1 #3). First-pass construction is constructor-emission, not this phase. |
| 1 | `targetPlacementResolution` (alias `placement`) | `TargetPlacementResolverWorker` | Matches content `targetPlacement` requests to registered drop-zones; resolution expressed as `'placement'`-role anchors via `attach` + compile (S3.6, S-R2.8). |
| 2 | `placementAssembly` | `PlacementAssemblyWorker` | Populates zones: decomposes into `attach` + `clone-instance` on `'parent-child'` Links (notes §10.2/§10.7). No `_referencingNodes` (S2.2). |
| 3 | `componentRouting` | `ComponentRoutingWorker` | Routes component emissions by resolution kind (`type` → assembly; non-type → slot assembly); cascades source updates to dependents. |
| 4 | `componentAssembly` | `ComponentAssemblyWorker` | Resolves `'type'` components: structural sub-tree injection; may contribute `AnchorLayer`s (populated later by the dirty sweep, S-R2.9/S-R3.12 — never inside the creating compile pass). |
| 5 | `slotAssembly` | `SlotAssemblyWorker` | Applies every non-type binding (`content`/`handlers`/`props.*`/`css.*`) as layers — never `children` (graph-derived, never stored, never a layer target). |
| 6 | `preprocessing` | `PreprocessingWorker` | Lifecycle hooks (`before/afterPreprocess`). |
| 7 | `validation` | `ValidationWorker` | Compile gate: tag-schema validation (Pillar E). Success auto-forwards to `elementCreation`; **every in-tree node flows through here before rendering — nothing bypasses** (notes §6.7). Structural invariants are `LinkConfig`'s job, not this worker's (notes §10.5). |
| 8 | `elementCreation` | `ElementCreationWorker` | Emits **declarative render ops** through the configured `RenderAdapter` (Pillar F). One worker; SSR vs client differ only in adapter + persistence flag — the legacy `Client*`/`SSR*` dual files collapse. |
| 9 | `treeAssembly` | `TreeAssemblyWorker` | Mount/order ops through the same adapter; fires `afterRender`. |
| 10 | `postprocessing` | `PostprocessingWorker` | `before/afterPostprocess` hooks; ends the pipeline when monitoring is off. |

---

## 2. `PhaseWorker` — uniform contract

One interface replaces the ad-hoc worker/docstring drift (notes §2.2, notes §8.2):

```ts
interface PhaseWorker {
  readonly order: number
  emission(node: Node, ctx: PipelineContext): Promise<EmissionResult> | EmissionResult
  afterEach(node: Node, prev: Node, ctx: PipelineContext): void
}

interface PipelineContext {
  readonly slice: CompiledSlice            // graph-resolved slice bounding this run (§3)
  readonly lock: SliceLock                 // this slice's lock token, held by the run (§4)
  readonly supervisor: Supervisor
  readonly telemetry: PipelineObserver[]   // onStageStart / onStageComplete / onError / onLoopGuardTrip
}
```

Contract rules:

- Workers consume **graph-resolved** nodes from `ctx.slice`. A worker **never
  re-derives tree membership or child order from `parent`**; the compiled
  slice already carries both (notes §10.3, notes §10.8).
- **Per-node error containment** (preserved from legacy `BaseWorker`, notes §6): a
  throwing node/handler fails only that node's emission
  (`{ kind: 'dropped' }` + `onError` telemetry); the pipeline run continues.
- `afterEach` fires per processed node with the previously processed node;
  side-effect-only, no emission result.
- `forwarded` targets must name a registered stage; forwarding is by **name
  only**, never by number.

### 2.1 `EmissionResult`

```ts
type EmissionResult =
  | { kind: 'emitted'; renderOps: RenderOp[] }   // slice/fork produced render ops
  | { kind: 'dropped'; reason: DropReason }      // consumed; rendered nothing
  | { kind: 'forwarded'; to: PipelineStage }     // routed onward, by NAME
  | { kind: 'deferred' }                         // absorbed by the microtask queue (§5)

// Isomorphic with node.md's ArmDropReason for fork arms; 'not-in-tree' /
// 'validation-failed' / 'placement-target-blocked' are slice-level drops.
type DropReason =
  | 'not-in-tree'              // S1.1: no path to a permanent owner → no usable compiled state
  | 'validation-failed'        // Pillar E tag schema
  | 'prototype-terminated'     // S-R2.5: prototype-tailed fork arm, silent
  | 'owner-terminated'         // S-R3.10: contentNodes / non-root-owner-tailed arm, silent
  | 'loop'                     // S-R2.5: looped fork arm; loop-guard/depth-cap trips count AS loop — log 'circular-source'
  | 'placement-target-blocked' // S-R4.1: op accepted but a LATER compile pass failed → default drop;
                               // the primary ACTIONABLE surface is the synchronous apply rejection (api.md §3.3)
```

**Resolution rule (S2.3):** a slice is *resolved* ⟺ every fork arm has
terminated as `emitted` or `dropped`. A coerced pick among arms is never
synthesized (notes §10.8.4).

---

## 3. Supervisor slice scoping

Each phase run is bounded by the `compile(slice)` entry point that produced
it (notes §10.3, notes §10.6, notes §10.8):

```ts
type SliceScope =
  | { kind: 'root'; entry: 'rootNode' }       // bootstrap / full reconcile: deep, whole tree
  | { kind: 'node-local'; entry: NodeId }     // event emission: the node + bounded ancestors

interface CompiledSlice {
  readonly root: NodeId                                        // == lock key (§4)
  readonly scope: SliceScope
  readonly states: ReadonlyMap<NodeId, CompiledState>          // immutable within the run
  readonly forks: ReadonlyMap<string, CompiledState>           // pass-2 arms keyed by path-to-root ("root/a/b")
}
```

- Two scopes, one `compile(slice)` primitive: **root-out deep** on bootstrap,
  **node-local** on handler/ClientAPI emission (cheap minimal-element
  updates — no full graph walk per update).
- Compile is **two-pass** (notes §10.8.4): pass 1 `compileLocal` (values + anchors
  reconciled against the layer stack — the canon, S-R3.8) runs synchronously
  inside the op; pass 2 `compileRemote` (parent / children order /
  component+placement borrow walks) runs only after pass 1, and may fork.
- Fork arms are keyed by path back to the root node. Arm disposition
  (S-R2.5/S-R3.3/S-R3.10): root-terminated arms are actionable;
  prototype- or `contentNodes`-terminated arms **fail silently**; only
  **looped** arms log `circular-source`.

---

## 4. Locking — Option B (decided)

**Per-slice re-entrant lock with a recursion-depth cap; unlock only at final
resolution.** Roughly the reverse of the legacy global `activeLockedPhases`,
whose cross-node global state is removed (notes §8.2).

```ts
type LockState = 'held' | 'resolving' | 'resolved' | 'released'

interface SliceLock {
  readonly sliceRoot: NodeId
  readonly maxDepth: number                          // recursion-depth cap (loop tripwire)
  readonly visitSet: ReadonlySet<NodeId>             // nodes on the active emission chain
  readonly state: LockState
  recordVisit(id: NodeId): void                      // extends the chain; depth = chain length
  reenter(e: DeferredEmission): 'defer' | 'trip'
  beginResolution(): void                            // held → resolving (op done; render/processing starts)
  resolveFork(key: string, r: EmissionResult): void  // last outstanding fork → resolved
  unlock(): void                                     // resolved → released; otherwise THROWS
}

class PipelineLockError extends Error {
  code: 'unlock-before-resolution' | 'lock-order' | 'cross-slice-emission' | 'double-unlock'
}
```

### 4.1 Semantics

- **Acquire** one lock per slice-root when a slice is consumed. One active
  chain per slice at a time.
- **Re-entry, same slice (normal path):** a nested emission on the
  already-active chain never recurses synchronously — `reenter` returns
  `'defer'` and the emission goes to the render microtask queue carrying
  `chainDepth + 1`. **The microtask absorbs valid same-slice emissions**;
  deferral is not an error.
- **Trip:** if `chainDepth + 1 > maxDepth`, or the target re-enters the
  `visitSet` beyond its allowance, `reenter` returns `'trip'` → the emission
  is dropped with reason `loop` (a `circular-source` warning is logged —
  loop-guard/depth-cap trips count AS loop, §2.1) plus telemetry. Termination
  is guaranteed: every deferral strictly increases depth and the cap is finite.
- **Unlock (S2.3):** a consumed slice **stays locked through
  render/processing**. `unlock()` is legal only from `resolved` — every fork
  emitted or dropped. From `held`/`resolving` it throws
  `unlock-before-resolution`; from `released` it throws `double-unlock`.
- **Lock order:** when an op must hold multiple slice locks, acquire in
  ascending registry `order` of the entry phase; out-of-order acquisition
  throws `lock-order`. The numeric comparison is internal-only.
- **Cross-slice emission mid-op is FORBIDDEN:** while holding slice A's lock,
  nothing may synchronously emit into slice B; cross-slice emissions are
  enqueued to the microtask queue and run after A resolves. A synchronous
  attempt throws `cross-slice-emission`.

### 4.2 Lock state machine

| from | event | to | notes |
| --- | --- | --- | --- |
| — (none) | slice consumed | `held` | acquire; `visitSet = {sliceRoot}` |
| `held` | nested same-slice emission | `held` | defer to queue, `chainDepth + 1` |
| `held` | depth cap exceeded / visit-set overflow | `held` | trip: drop `loop` + `circular-source` warning/telemetry |
| `held` | sync cross-slice emission attempt | `held` | throw `cross-slice-emission` |
| `held` | op + pass-1 complete | `resolving` | `beginResolution()` |
| `resolving` | fork resolved, not last | `resolving` | |
| `resolving` | last fork emitted/dropped | `resolved` | S2.3 gate opens |
| `held`/`resolving` | `unlock()` | — (unchanged) | throw `unlock-before-resolution` |
| `resolved` | `unlock()` | `released` | the only legal unlock |
| `released` | `unlock()` | — | throw `double-unlock` |

---

## 5. Render microtask queue (decided — D3)

**One microtask per tick.** Dirty pass-2 sweeps, deferred emissions, injected-
anchor population, and cascade-destroy are all scheduled here; scheduling is
idempotent.

```ts
type QueueTask =
  | { kind: 'deferred-emission'; node: NodeId; stage: PipelineStage; chainDepth: number; origin: NodeId }
  | { kind: 'dirty-pass2'; dirty: Set<NodeId> }   // coalesced compileRemote sweep
  | { kind: 'cascade-destroy' }                    // orphan GC (S-R2.3) — drains BEFORE render
  | { kind: 'event-batch' }                        // coalesced WS events for the tick (api.md §7, W1)
  | { kind: 'render-emit' }                        // diffed render ops → RenderAdapter

interface RenderMicrotaskQueue {
  enqueue(t: QueueTask): void    // dirty-pass2 tasks COALESCE into one union set per tick
  schedule(): void               // idempotent: exactly one microtask per tick
  readonly scheduled: boolean
}
```

### 5.1 Drain order (fixed, inside the single microtask)

1. `deferred-emission` tasks (FIFO) — each re-enters the pipeline under its
   origin slice's lock, depth-checked (§4.1). The drain **snapshots** the
   deferred-emission set at drain start: emissions enqueued *during* the
   drain land in the **next** tick (consistent with api.md W4/T18 — nested
   emissions land in a later tick).
2. `dirty-pass2` sweep — populate injected/materialized anchors (S-R3.12:
   **any** anchor-adding effect, including a new layer, is populated here,
   never inside the compile pass that created it), then `compileRemote` over
   the whole dirty set in **one** sweep, immediately before render.
3. `cascade-destroy` sweep — destroy only nodes that **still** resolve to no
   permanent owner (root node / component prototype / `contentNodes`,
   S-R2.2/S-R3.7) at sweep time; a synchronous `attach` before this point
   blocks destruction (S-R2.3). Runs **before** render emit (node.md §8.5 is
   canon: the sweep — incl. cascade-destroy checks — completes before emit).
4. `event batch` — emit the tick's coalesced events (api.md §7 W1 mandates:
   pass-2 sweep → event batch → render ops, in that order within a tick).
5. `render-emit` — flush the diffed ops through the adapter.

### 5.2 Guarantees

- No whole-tree recompile; no mid-op walk; **no synchronous dirty
  propagation** — coalescing is the point: everyone dirtied by a batch request
  compiles remote in the same sweep, right before the render emit (notes §10.8.4).
- Exactly one microtask per tick: a second `schedule()` in the same tick is a
  no-op.
- Termination: deferred emissions carry strictly increasing `chainDepth`,
  bounded by `maxDepth` (§4.1), so the queue always drains.

---

## 6. Re-entry: handlers / ClientAPI → pipeline

Canonical entry (S-R3.11): handlers and the Client API call
**`ClientAPI.apply(nodeRef, mutation)`**, which journals through
`supervisor.apply`.

Sequence (S2.1 — the `receiveNextState` successor):

1. Journal a `state-slice` MutationOp
   `{ kind: 'state-slice', node, mutation, actor }` — named, replayable,
   undoable like the structural ops.
2. Gates: **in-tree** (S1.1) — not in-tree → no usable state, dropped
   `not-in-tree`. **Placement target-zone mutations are hard-blocked** (notes §8.3
   anti-looping safeguard — keep it): synchronous `apply` rejection
   `'placement-target-blocked'` — the canonical actionable surface (S-R4.1);
   placement changes go through a forward tree rebuild instead.
3. **Pass 1 `compileLocal` — synchronous**, inside the op, node-local.
4. Mark remote dependents dirty (its children; readers of its
   parent/bindings).
5. **Pass 2 `compileRemote` — deferred** to the render microtask queue,
   bounded to the node + its ancestor chain.
6. **Event batch** — the tick's coalesced events emit after the sweep (incl.
   cascade-destroy), before render ops (api.md §7 W1).
7. Render emit: minimal diffed ops for that slice only (notes §10.6).

Pipeline-context prohibitions (notes §8.1): workers never invoke the state-slice
path from inside the pipeline — pipeline-internal regeneration is owned by
the rebuild manager (Phase 0); numeric phase invocation is impossible; raw
field writes on nodes are impossible (all mutation via layers/ops).

---

## 7. Deadlock / re-entrancy guarantees

| Guarantee | Mechanism |
| --- | --- |
| No global/cross-node lock state | per-slice locks replace `activeLockedPhases` (notes §8.2) |
| No interleaved mutation of a slice mid-op | one active chain per slice; nested same-slice emissions defer (§4.1) |
| No stack overflow from handler chains | microtask deferral + depth cap |
| Termination | `chainDepth` strictly increases per deferral; finite `maxDepth` trips |
| No half-resolved slice observable | S2.3 unlock gate (§4.1/§4.2) |
| No lock-cycle deadlock | multi-lock acquisition in ascending registry order; sync cross-slice emission forbidden |
| No stale-anchor remote reads | two-pass compile; pass 2 always after pass 1 (notes §10.8.4) |
| Atomic structural invariants | `LinkConfig` enforcement at the mutation boundary (graph spec) |

**Forbidden** (throw, or made unrepresentable):

| Forbidden act | Replacement |
| --- | --- |
| Cross-slice emission mid-op | enqueue to microtask queue; runs after origin slice resolves |
| `unlock()` before final resolution / double unlock | wait for `resolved` |
| Numeric phase IDs in callers | `PipelineStage` names via `emitToPhaseName` |
| Synchronous dirty propagation / mid-op walks | dirty-marking + microtask pass-2 sweep |
| Placement mutation via state-slice | forward tree rebuild (notes §8.3) |
| Worker reading `parent` for membership/order | read `ctx.slice` (compiled, graph-derived) |
| `receiveNextState` from inside pipeline/workers | rebuild-manager Phase 0 owns regeneration (notes §8.1 #3) |

---

## 8. State & fail-state matrix (TestWriter exhaustiveness gate)

### 8.1 Valid-path states to cover

| # | Scenario | Expected |
| --- | --- | --- |
| V1 | Bootstrap: root-out deep compile, phases drain in registry order | full render; locks acquired/released per slice |
| V2 | Handler event: `state-slice` → sync pass-1 → deferred pass-2 → minimal render ops | node-local slice only; one microtask |
| V3 | Nested same-slice emission mid-op | deferred (`'defer'`), processed next drain, lock stays `held` |
| V4 | N ops in one tick dirty overlapping sets | single coalesced pass-2 sweep over the union |
| V5 | Multi-source `referenceName` fork | multiple compiled states keyed by path-to-root; all actionable arms emitted |
| V6 | SSR vs client | identical pipeline; only adapter + persistence flag differ |
| V7 | Orphan re-`attach`ed before the sweep | cascade-destroy skips it; node survives (S-R2.3) |
| V8 | Registry doc generation | `docs()` reflects the map; worker JSDoc need not |

### 8.2 Fail-states (each = ≥1 test)

| # | Fail-state | Trigger | Required behavior |
| --- | --- | --- | --- |
| F1 | Unknown stage | `getWorker`/emit with unregistered name | throw `PipelineError('unknown-stage')` |
| F2 | Duplicate registration | same `stage` or same `order` twice | rejected at `register()` |
| F3 | Numeric phase invocation | literal numeric ID at any call site | unrepresentable in the API; runtime guard rejects (notes §8.1 #1) |
| F4 | Phase-ordering violation | multi-lock acquisition out of ascending registry order | throw `PipelineLockError('lock-order')` |
| F5 | Lock re-entry depth overflow | `chainDepth + 1 > maxDepth` | loop-guard trip: drop `loop` (`circular-source` warning logged), telemetry, no stack growth |
| F6 | Visit-set re-entry | node re-enters the active chain beyond allowance | loop-guard trip: drop `loop`, `circular-source` warning logged, telemetry |
| F7 | Unlock-before-resolution | `unlock()` from `held`/`resolving` | throw `unlock-before-resolution`; lock stays; slice continues |
| F8 | Double unlock | `unlock()` from `released` | throw `double-unlock` |
| F9 | Cross-slice emission mid-op | sync emit into a foreign slice while locked | throw `cross-slice-emission` |
| F10 | Not-in-tree compile (S1.1) | no path to a permanent owner | drop `not-in-tree`; **no usable compiled state** (not partial) |
| F11 | Looped fork arm (S-R2.5) | cycle in the source/borrow walk | arm dropped with reason `loop`; `circular-source` warning logged; sibling arms unaffected |
| F12 | Prototype/`contentNodes`-terminated arm (S-R3.10) | arm ends at non-root permanent owner | **silent** drop (`prototype-terminated` / `owner-terminated`); no actionable state; no warning channel |
| F13 | Unresolved target (notes §10.8.2) | no `source`/`duplex` on the walk toward root | `unresolved-reference` compile status with a clear code + logged warning; node still renders its own state — NOT dropped (S-R4.3) |
| F14 | Placement mutation via state-slice (notes §8.3) | placement target-zone mutation in `apply()` | hard-blocked: synchronous apply rejection `'placement-target-blocked'` (S-R4.1); an accepted op whose later compile pass fails drops by default under the same code |
| F15 | Queue double-schedule | two `schedule()` calls in one tick | exactly one microtask; second is a no-op |
| F16 | Dirty coalescing | overlapping dirty sets in one tick | one pass-2 sweep covering the union, before one render emit |
| F17 | Cascade-destroy race (S-R2.3) | re-`attach` between op and sweep | sweep re-checks owner resolution at sweep time; node survives |
| F18 | Op-time cycle (S3.4) | `attach`/`move` creating a cycle | test-and-rollback: op reverted, detector shared with compile-time |
| F19 | Worker per-node error | throwing handler/node inside `emission` | node dropped + `onError`; pipeline run continues |
| F20 | Registry/doc drift (notes §8.2, process) | worker JSDoc ≠ registry map | registry is canon; docs corrected to match — enforce via lint/CI check |

### 8.3 E2e loop probes (Step 7)

Scenarios that intentionally build A→B→A anchors, component self-reference,
and dangling source/target pairs must trip the guards above: **F5/F6**
(pipeline loop-guard), **F11** (compile-time `circular-source`), **F13**
(dangling reference), **F18** (op-time rollback). The e2e asserts the trip
fires and the pipeline survives.
