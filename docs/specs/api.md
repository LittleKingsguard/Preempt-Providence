# API Spec — `ClientAPI`, WS Events, Handler/Emission Contracts

Derived from `RENDER_PROCESS_NOTES.md` §10.2, §10.8.2, §10.8.4, §10.9 (S2.1, S-R2.x, S-R3.x, S-R4.x).
Normative refs are cited per rule (`S-x.y` = notes §10.9 ledger row). This file is the
behavior contract for the TestWriter; every state and fail-state is enumerated in §8.

---

## 1. `ClientAPI` public surface

`ClientAPI` is the **only** client/handler mutation surface. Its canonical entry is
`apply`, which journals every op through `supervisor.apply` (S-R3.11). No other write
path exists: direct field assignment on a node is structurally impossible (notes §8.1 #2),
`receiveNextState` is absorbed (S2.1), numeric phase invocation is removed (notes §8.1 #1).

```ts
type NodeId    = string            // unique per-node, generated at creation (S3.1)
type PathKey   = string            // 'root / a / b …' — path back to root (notes §10.8.2)
type NodeRef   = NodeId            // wire reference to a live node
type LinkId    = string            // wire reference to a live Link

type NodeState = 'prototype' | 'unplaced' | 'in-tree' | 'destroyed'   // derived (notes §10.1)

interface ClientAPI {
  apply(nodeRef: NodeRef, mutation: MutationInput): ApplyResult
  // read-only exposure of compiled state, incl. forks (§6 of this spec)
  getState(nodeRef: NodeRef): ExposedState[]
}

interface Supervisor {
  apply(op: MutationOp): ApplyResult   // journaling sink behind ClientAPI.apply
}

type MutationInput = LayerMutationList | StructuralOp   // apply signature owned HERE (ops.md defers);
                                                         // a LayerMutationList is wrapped INTERNALLY as
                                                         // { kind: 'state-slice' } — never accepted pre-formed

// state-slice (S2.1) — the receiveNextState successor
interface LayerMutation {
  targetProp: 'type' | 'content' | 'handlers'
            | `props.${string}` | `css.${string}`        // 'placement' is NOT legal (§3.3);
                                                         // 'children' is NEVER legal — graph-derived,
                                                         // never stored (notes §10.2)
  mode: 'replace' | 'append' | 'replaceAll'
  value: unknown
  sourceName?: string
}
type LayerMutationList = LayerMutation[]

// notes §10.2 — journaled, named, replayable (undo/redo for free)
type MutationOp =
  | StructuralOp
  | { kind: 'state-slice'; node: NodeRef; mutation: LayerMutationList; actor: string }

type StructuralOp =
  | { kind: 'attach';         node: NodeRef; to: NodeRef; zone?: string; priority?: number }
  | { kind: 'detach';         node: NodeRef; from?: LinkId }
  | { kind: 'move';           node: NodeRef; to: { parent: NodeRef; priority?: number } }
  | { kind: 'clone-instance'; source: NodeRef; slot: PlacePointer; priority?: number }
  | { kind: 'destroy';        node: NodeRef }

type ApplyResult =
  | { status: 'applied';         journalId: string; dirtied: NodeId[] } // pass-1 done, pass-2 scheduled
  | { status: 'no-usable-state'; nodeState: NodeState }                 // S1.1 gate
  | { status: 'rejected';        error: ApplyError }

interface ApplyError {
  code: 'unknown-node'                 // NodeRef resolves to no live node
      | 'placement-target-blocked'     // state-slice targeting placement (notes §8.3)
      | 'link-config'                  // wraps LinkConfigError (role-mismatch, unique-order, …)
      | 'cycle-detected'               // attach/move test-and-rollback (S3.4)
      | 'single-parent'                // attach on a node already holding a 'child' anchor (S-R4.2 —
                                       // op-level, NOT 'link-config'/count-exceeded, never silent move)
  detail?: unknown
}
```

**Wire vs internal shapes:** this file owns the **wire** shape — ops reference
entities by ID (`NodeRef` / `LinkId` / `string` actor). ops.md §1 owns the
**internal** shape, which carries live `Node` / `Link` / `Actor` values;
`supervisor.apply` resolves wire IDs to live objects at the journal boundary.

### 1.1 `apply` semantics (S2.1, S-R3.11)

| # | Rule | Ref |
| --- | --- | --- |
| 1 | Every client/handler mutation enters via `ClientAPI.apply(nodeRef, mutation: MutationInput)` (signature owned here); a `LayerMutationList` is wrapped **internally** as a `{ kind: 'state-slice' }` op (never accepted pre-formed) and every op is journaled through `supervisor.apply`. Ops are named + replayable. | S-R3.11, notes §10.2 |
| 2 | A `state-slice` op runs **pass-1 (`compileLocal`) synchronously** inside the op; dependents whose *remote* values changed are marked dirty; **pass-2 (`compileRemote`) is deferred** to the render microtask queue. | S2.1, notes §10.8.4 |
| 3 | Structural ops execute as ordered anchor/link mutations against the graph; rejected writes surface as structured errors, never partial state. | notes §10.2, notes §10.8.1 |
| 4 | `apply` is **gated on derived `NodeState`** before journal commit: a node that is not `in-tree` returns `{status:'no-usable-state'}` — never a partial state, no journal entry, no events. | S1.1, S2.1 |
| 5 | Injected content (`fetchContent`/`addContentNodes` successors) is expressed as structural ops over payload nodes owned by the `'contentNodes'` permanent owner, journaled through the same `supervisor.apply`. | S-R2.2, S3.6 |

### 1.2 In-tree gating (S1.1)

| Target `NodeState` | `apply` result | Events | Journal |
| --- | --- | --- | --- |
| `in-tree` | `applied` | normal emission (§7) | committed |
| `unplaced` | `no-usable-state` | none | not committed |
| `prototype` | `no-usable-state` | none | not committed |
| `destroyed` | `no-usable-state` | none | not committed |

A compile attempt on a not-in-tree node returns **no usable compiled state** — not a
partial state (S1.1). "Unplaced but chain reaches a permanent owner" is not "usable".

### 1.3 Legacy surface disposition

| Legacy (`src/core/ClientAPI.ts`, notes §7) | Rewrite disposition |
| --- | --- |
| `modifyNode(partial, target)` | absorbed → `apply(nodeRef, mutation)` state-slice (S2.1) |
| `Node.receiveNextState(partial)` | absorbed → `'state-slice'` MutationOp (S2.1) |
| `fetchContent` / `addContentNodes` | structural ops; nodes owned by `'contentNodes'` (S-R2.2) |
| `fetchHandlers` / `getHandler` / `compileHandler` | handler binding via layers; not re-specified here |

---

## 2. Handler / emission contract (S2.1)

Handlers receive `context.clientAPI` and mutate **only** through it. A handler never
touches node fields, never calls `receiveNextState` (absorbed), never names a phase
numerically. The context shape and dispatch contract are owned by
`docs/specs/handlers.md`; the implemented context is:

```ts
interface HandlerContext {
  clientAPI: ClientAPI     // sole mutation channel
  supervisor: Supervisor   // journal / phases / registration
  tree: { getNode; allNodes; ancestorsOf; descendantsOf }
}
type HandlerBody = (ctx: HandlerContext, ...args: unknown[]) => void
```

**Read access (handlers.md §2.1):** `ctx.tree.getNode(id)` returns the live
`Node`; its value getters (`type`/`props`/`css`/`content`/`handlers`) read the
node's **compiled pass-1 state** (always fresh — every mutation path runs
`compileLocal` synchronously, node.md §5). This is the sanctioned read channel;
writes still go exclusively through `clientAPI.apply`. Pass-2 **resolved**
values (component `bindings`/fork arms) are not exposed on `Node` today —
`clientAPI.getState` returns surface only (`nodeId`/`status`/`pathKey`/`state`);
see handlers.md §2.1 TODO(code) for exposing them read-only.

(`node` and `event` reach the body as dispatch args — `dispatchEvent(node, ctx,
event, ...args)`; event handlers are matched by `event`/`name`.)

| # | Contract rule | Ref |
| --- | --- | --- |
| H1 | Handlers emit **`state-slice` MutationOps only** (via `clientAPI.apply`). Structural change from a handler = not permitted through the state-slice path. | S2.1 |
| H2 | Handler applies are **synchronous in pass-1 only**: local values recompile immediately; remote-dependent values (parent/children/bindings) resolve in the deferred pass-2 sweep. | S2.1, notes §10.8.4 |
| H3 | A handler-caused re-render re-resolves **only the affected node/subtree** (node-local compile) and emits diffed minimal-element render ops — no full graph walk per update. | notes §10.6 |
| H4 | A nested emission on an already-active slice is **deferred to the microtask queue** (per-slice re-entrant lock, Option B); recursion-depth cap is the loop tripwire. | notes §10.3, D2 |
| H5 | Handler writes that violate `LinkConfig` reject with the structured error; nothing is partially applied. | notes §10.8.1 |

## 3. Emission pipeline (what an `apply` triggers)

```
ClientAPI.apply → supervisor.apply (journal)          [synchronous]
  → pass-1 compileLocal on the target node            [synchronous]
  → dirty-mark remote dependents                      [synchronous]
  → pass-2 compileRemote sweep on render µtask queue  [deferred, 1/tick]
  → event batch emit (§7) → render ops                [same sweep, in this order]
```

### 3.3 Placement hard-block (intentional, notes §8.3)

`state-slice` **cannot** mutate placement: `targetProp: 'placement'` (or any
`'placement'`-role anchor write through a layer mutation) rejects with
`code: 'placement-target-blocked'`. Placement change = a forward structural change
(`attach`/`detach`/`move` ops), never a state-slice. This is the anti-looping
safeguard carried over from legacy — do not remove.

**Two surfaces (S-R4.1):** the **synchronous `apply` rejection** above is the
canonical **actionable** surface — the caller reads the conflict and retries
(notes §10.8.1-style). If a placement-affecting op is **accepted** but a **later
compile pass** fails, the emission **also drops by default** (DropReason
`'placement-target-blocked'`, pipeline.md §2.1). Both surfaces exist; the
rejection is the actionable one.

---

## 4. Component model surface (notes §10.8.2)

Components bind by **`referenceName`**: all components sharing a `referenceName`
anchor on **one `Link`**, each with a directional role.

```ts
type ComponentRole = 'source' | 'target' | 'duplex'

interface ComponentAnchorDecl {
  referenceName: string
  role: ComponentRole
  value?: unknown    // source: provided value; duplex: carries BOTH target and value; target: none
}
```

| Role | Meaning | Ref |
| --- | --- | --- |
| `source` | **provides** its resolved value/content for `referenceName` | notes §10.8.2 |
| `target` | **consumes** a value for `referenceName`; waits until a source is present | notes §10.8.2 |
| `duplex` | **one anchor carrying BOTH a target and a value** — a self-providing consumer | S-R2.6 |

### 4.1 Resolution algorithm (compileRemote, per target anchor)

Ordered; first matching rule wins:

| Step | Rule | Ref |
| --- | --- | --- |
| R1 | Compiling a node = **populate the node's OWN target anchors first**. The search base is the node itself. | S-R2.6 |
| R2 | **Depth-0 self-resolution**: if the node already carries a `source` or `duplex` anchor for that `referenceName`, the target resolves **at itself — before any upward walk**. Ancestor sources are shadowed. | S-R2.6, S4.1 |
| R3 | Otherwise walk **toward root** (child anchor → Link → parent anchor → node, per hop). The **first** `source`/`duplex` match wins — closest-first; nearest shadows far. | D5, notes §10.8.2 |
| R4 | A **root-level source is fallback-of-last-resort**: used only if nothing closer exists. | D5, notes §10.8.2 |
| R5 | No match on the way up → **`unresolved-reference` compile state with a clear code**. Not an exception; a state. On a viable compile, a **warning is logged** and the node **still renders its own state** — not dropped, not hidden (S-R4.3). | notes §10.8.2, S-R4.3 |
| R6 | Two same-`referenceName` components splitting target/value on **different** nodes resolve closest-first; a same-node pair resolves at depth 0. | S4.1 |

### 4.2 Same-name multiplicity → fork (S-R2.5)

Multiple nodes may share a `referenceName`. The compiler **forks** rather than picks:

```ts
interface ForkRef {
  name: string          // referenceName
  forkKey: PathKey      // path back to the root node — the fork's identity
  nodeIds: NodeId[]     // unique per-node IDs (S3.1)
}
```

| Arm disposition | Outcome | Ref |
| --- | --- | --- |
| Path terminates at **root** | **actionable compiled state** — rendered, exposed to client (§6) | notes §10.8.2 |
| Path terminates at **component prototype** or **`contentNodes`** | **fails silently** — no actionable state, no warning, dropped, never rendered | S-R2.5, S-R3.3, S-R3.10 |
| Path **loops** | no actionable state + **`circular-source` warning** (diagnostic event, §7) | S-R2.5 |
| Ambiguous-but-terminating | surface as **multiple valid states**, never an arbitrary pick | notes §10.8.2, notes §10.8.4 |

A coerced pick is **never synthesized** (notes §10.8.4).

### 4.3 Component fail-states

| Code | Trigger | Surface |
| --- | --- | --- |
| `unresolved-reference` | target with no `source`/`duplex` match from self to root | compile status on the declaring node's exposed state + logged warning; node still renders its own state (S-R4.3) |
| `circular-source` | borrow walk loops | diagnostic warning event; arm dropped |
| (silent) | arm terminates at prototype/`contentNodes` | nothing — no state, no event |

---

## 5. Placement ≠ component (S-R2.8)

Two **distinct behaviors** sharing one borrow algorithm:

| | Component | Placement |
| --- | --- | --- |
| Expression | `source`/`target`/`duplex` anchors on a `referenceName` Link | a **`'placement'`-role anchor on the zone's family `Link`** |
| Applied by | compile (borrow resolution, §4.1) | **`attach` op + compile** |
| Role semantics | component roles only | `'placement'` role only — **not interchangeable** |
| Legacy | — | legacy `Placement`/`PlacementConfig` **not carried over** (S3.6) |

Contract rules:

| # | Rule | Ref |
| --- | --- | --- |
| P1 | A `'placement'`-role anchor **never satisfies** a component `target` borrow, and a component anchor never populates a placement zone. The walk algorithm is shared; the role semantics are not. | S-R2.8 |
| P2 | Adding a component-role anchor to a placement link (or vice versa) rejects with `LinkConfigError code: 'role-mismatch'` (`roles` whitelist). | notes §10.8.2, S-R3.9 |
| P3 | Placement multiplicity (shared `placementName`) forks exactly like components (§4.2). | notes §10.8.2 |
| P4 | Placement mutation via state-slice is hard-blocked (§3.3); placement changes go through `attach`/`detach` + compile. | notes §8.3, S3.6 |

---

## 6. Forked-state exposure to the client

The client sees compiled states **as they are** — named, path-keyed, never coerced:

```ts
type CompileStatus = 'ok' | 'unresolved-reference'

interface ExposedState {
  nodeId: NodeId
  status: CompileStatus
  fork?: ForkRef          // present iff this state is one arm of a fork
}
```

| # | Rule | Ref |
| --- | --- | --- |
| F1 | Only **actionable** (root-terminated) states are exposed. Dropped arms expose nothing. | notes §10.8.4 |
| F2 | Forked states are **named** (`referenceName`/`placementName`) and **keyed by `forkKey`** (path back to root) plus unique per-node IDs. | notes §10.8.2, S3.1 |
| F3 | Fork states **de-duplicate and serialize via unique node IDs** — no phantom coalescing of distinct arms into one state. | S3.1 |
| F4 | The engine **never picks one arm** for the client; ambiguous-but-terminating multiplicity arrives as multiple valid states. | notes §10.8.4 |
| F5 | Serialized state (incl. anchor form) round-trips to the JSON schemas; SSR brush and client hydrate consume the same format, and the client **re-resolves** from serialized anchors after hydrate rather than trusting shipped forks. | notes §10.6, S4.2 |

---

## 7. WS event contract

Events are the client-observable output of the mutation pipeline. (Legacy
`WebSocketClient` topic subscription + auto-reconnect carries over as transport.)

```ts
interface EventEnvelope {
  topic: string
  tick: number              // render-microtask tick this batch coalesced under
  seq: number               // monotonic within tick
  events: PreemptEvent[]    // one coalesced envelope per tick per topic
}

type PreemptEvent =
  | { type: 'state';      nodeId: NodeId; fork?: ForkRef; status: CompileStatus }
  | { type: 'structure';  op: StructuralOp['kind']; nodeId: NodeId }
  | { type: 'diagnostic'; code: 'circular-source'; trace: PathKey }
```

| # | Rule | Ref |
| --- | --- | --- |
| W1 | **Emission point**: events are emitted from the **render microtask queue**, inside the pass-2 dirty sweep, **right before the render emit** — pass-2 sweep → event batch → render ops, in that order within a tick. | notes §10.8.4 |
| W2 | **Coalescing per tick**: one microtask per tick; every node dirtied by a batch compiles remote in the same sweep; each dirtied node contributes **at most one `state` event per tick** (keyed by `nodeId` + `forkKey`). | notes §10.8.4 |
| W3 | Fork arms are **never coalesced into each other** — distinct `forkKey`/node IDs stay distinct events (F3). | S3.1 |
| W4 | **Ordering**: mutations applied in tick *N* are observable no earlier than tick *N*'s sweep; nested emissions during an active slice are deferred and land in a **later** tick (H4). | notes §10.3, D2 |
| W5 | **No partial-slice visibility**: a slice stays locked until it has fully resolved — all its forks emitted **or dropped** — so no event is observable for a half-resolved slice. | S2.3 |
| W6 | Inbound server/DB events are normalized and applied through the same canonical `supervisor.apply` journal — there is no side channel. | S-R3.11 |
| W7 | `unresolved-reference` is a **compile status** on the exposed state (§4.3), not a separate event channel (a warning is logged and the node renders its own state, S-R4.3); `circular-source` is a `diagnostic` event; silent drops emit nothing. | notes §10.8.2, S-R2.5, S-R4.3 |

---

## 8. Exhaustiveness matrix (TestWriter gate)

Every row = ≥1 test. "Events" col assumes a WS subscriber.

| # | Scenario | Setup | Action | Expected | Ref |
| --- | --- | --- | --- | --- | --- |
| T1 | Happy-path apply | in-tree node | `apply` state-slice | `applied`; journal entry; pass-1 sync; pass-2 + one `state` event next tick | S2.1, S-R3.11 |
| T2 | apply on `unplaced` node | node with no owner chain | `apply` | `no-usable-state` + `nodeState:'unplaced'`; no journal; no events | S1.1, S2.1 |
| T3 | apply on `prototype` node | component prototype | `apply` | `no-usable-state` + `'prototype'` | S1.1 |
| T4 | apply on `destroyed` node | destroyed node | `apply` | `no-usable-state` + `'destroyed'` | S1.1, S1.2 |
| T5 | apply with unknown NodeRef | — | `apply` | `rejected`, `code:'unknown-node'` | §1 |
| T6 | state-slice targeting placement | in-tree node | `apply {targetProp:'placement'}` | `rejected`, `code:'placement-target-blocked'` | notes §8.3 |
| T7 | Unresolved reference | `target` anchor, no source anywhere | compile | status `unresolved-reference` with clear code + **logged warning**; node still renders its own state (S-R4.3) | notes §10.8.2, S-R4.3 |
| T8 | Borrow with no matching source | target walks self→root, only non-matching roles met | compile | `unresolved-reference` (walk exhaustion, same state as T7) | notes §10.8.2 |
| T9 | Duplex self-resolution | node carries `duplex` for `referenceName`; nearer ancestor also has a source | compile | resolves **at depth 0 (itself)**; ancestor source ignored | S-R2.6, S4.1 |
| T10 | Closest-first borrow | source at depth 2 + source at root; target at depth 5 | compile | depth-2 source wins (nearest shadows far) | D5 |
| T11 | Root fallback | source only at root | compile | root source used | D5 |
| T12 | Same-name multiplicity | two valid root-terminated resolution paths | compile | two exposed states, distinct `forkKey`s; **no coerced pick** | notes §10.8.2, S-R2.5 |
| T13 | Loop-terminated arm | circular source chain | compile | no actionable state + one `circular-source` diagnostic event | S-R2.5 |
| T14 | Prototype/`contentNodes`-terminated arm | arm ends at prototype or content array | compile | silent drop: no state, **no event, no warning** | S-R3.3, S-R3.10 |
| T15 | Placement vs component mismatch | component `target` where only a `'placement'` anchor matches the name | compile/attach | borrow not satisfied (`unresolved-reference`); cross-role anchor write → `role-mismatch` | S-R2.8, S-R3.9 |
| T16 | Placement via state-slice vs attach | in-tree zone | (a) state-slice placement write; (b) `attach` | (a) `placement-target-blocked`; (b) applied + populated by compile | notes §8.3, S3.6 |
| T17 | Event coalescing | N applies dirtying overlapping nodes in one tick | apply × N | exactly one pass-2 sweep; ≤1 `state` event per node per tick; one envelope per topic | notes §10.8.4 |
| T18 | Event ordering / deferral | handler applies while its slice is active | nested `apply` | nested op deferred to a later tick; no interleaved mid-slice emission | notes §10.3, D2 |
| T19 | No partial-slice visibility | forking slice | observe during resolution | slice locked until all forks emitted/dropped; events only after final resolution | S2.3 |
| T20 | Fork de-duplication | forked states serialized | inspect payload | unique node IDs + path-key traces; arms never merged | S3.1 |
| T21 | Structural op cycle guard | `attach`/`move` that would create a cycle | `apply` op | `rejected`, `code:'cycle-detected'`; op rolled back | S3.4 |
| T22 | Handler mutation channel | handler body | direct node write / `receiveNextState` | impossible/absorbed — only `ctx.clientAPI.apply` exists | S2.1, notes §8.1 |
| T23 | Handler minimal re-render | handler applies to one node | `apply` | node-local compile only; diffed minimal-element render ops; no full graph walk | notes §10.6 |
| T24 | Inbound WS event | server pushes DB change | receive | normalized → `supervisor.apply` journal → normal pipeline (W6) | S-R3.11 |
| T25 | Hydrate re-resolve | SSR brush with serialized anchors | client hydrate | client re-resolves from anchors (same pipeline), does not trust shipped forks | S4.2 |

---

*Spec source: `RENDER_PROCESS_NOTES.md` §10.2, §10.6, §10.8.1–10.8.4, §10.9 (S1.1–S1.4, S2.1–S2.3, S3.x, S4.x, S-R2.x, S-R3.x). Ledger IDs are the trace of record.*
