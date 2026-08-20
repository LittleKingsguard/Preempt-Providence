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
            | `hooks.${string}`                          // HOOKS (hooks-map-review.md §7 — the
                                                         // value-provider slot): `hooks.<name>`
                                                         // targets a SAME-NODE value-provider hook.
                                                         // 'replace' mode ONLY (append/replaceAll →
                                                         // `hook-mode-blocked`); a name with no
                                                         // source/duplex anchor on the node →
                                                         // `hook-name-unresolved` (rejected); a
                                                         // seam/def-shaped provider → `hook-seam-exempt`
                                                         // (warn + the mutation is an inert no-op);
                                                         // `value: undefined` CLEARS the hook (the
                                                         // authored anchor value restores)
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
  | { kind: 'attach';         node: NodeRef; to: NodeRef; zone?: string; priority?: number }  // zone: superseded by 'placement-attach' (P3 §9-Q2) — attach stays family-only
  | { kind: 'detach';         node: NodeRef; from?: LinkId }
  | { kind: 'move';           node: NodeRef; to: { parent: NodeRef; priority?: number } }
  | { kind: 'clone-instance'; source: NodeRef; slot: PlacePointer; priority?: number }
  | { kind: 'destroy';        node: NodeRef }
  | { kind: 'placement-attach'; node: NodeRef; container: NodeRef; names: string[];
      trigger?: { kind: 'placement'; linkName: string; direction: 'container-added' | 'container-removed' | 'content-added' } }  // P3 §3.3

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
**internal** shape, which carries live `Node` / `Link` / `Actor` values.
**The wire→internal resolution happens in `ClientAPI.apply` (client.ts — it
resolves `nodeRef` to the live Node and spreads it into `op.node`, plus
resolves the `to`/`source`/`container` string refs), NOT in
`Supervisor.apply`:** the supervisor's `apply(op)` is the internal journaling
sink and REQUIRES `op.node` to be the live `Node` (a string id there is a
caller bug — `state` reads `undefined` → `no-usable-state`, or a
non-function `destroy`/`applySlice`). Page/harness code driving the engine
directly MUST pass the live Node in `op.node` (find it via
`supervisor.getNode(id)` / `tree.getNode(id)` first).

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

**Placement-path viability carve-out (P3 §2.4 — supersedes S1.1 for placement-routed
nodes):** a node whose enumerated placement path terminates at `'rootNode'` is
**viable output** — it compiles actionable path-states even though `node.state` stays
`unplaced`/`in-tree` (family-derived, untouched — `state` is a family fact, compiled
viability is the operative property for compile/render gating). `unplaced` = no valid
path to root via parent **OR** placement links (P3 §2.4; the "self-providing unplaced
node" carve-out precedent is RENDER_PROCESS_NOTES.md §10.10.4). The `apply` gate
(S1.1 rule 4 above) is unchanged: it keys on the family-derived `NodeState`
(`in-tree` via the contentNodes permanent owner), which content roots receive at
translate (P3 §10.ad F-13 contentNodes-ownership minting).

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
  tree: { getNode; allNodes; ancestorsOf; descendantsOf; getState }
}
type HandlerBody = (ctx: HandlerContext, ...args: unknown[]) => void
```

**Read access (handlers.md §2.1):** `ctx.tree.getNode(id)` returns the live
`Node`; its value getters (`type`/`props`/`css`/`content`/`handlers`) read the
node's **compiled pass-1 state** (always fresh — every mutation path runs
`compileLocal` synchronously, node.md §5). This is the sanctioned read channel;
writes still go exclusively through `clientAPI.apply`. Pass-2 **resolved**
values (component `bindings`, fork arms, `pathKey`) are exposed READ-ONLY:
`ctx.tree.getState(id): CompiledState[]` (non-draining —
`supervisor.getResolvedStates`, never consumes the renderer's snapshot) and
`node.resolved: CompiledState[]` (read-only getter populated by pass-2;
`supervisor.recordResolved` seeds it after a direct bootstrap full compile).
`clientAPI.getState` returns surface only
(`nodeId`/`status`/`pathKey`/`state`); `supervisor.takePass2States()` remains
renderer-owned and draining — a handler getter must never call it.
Contract: handlers.md §2.1; tests: resolved-exposure.test.ts (Workstream B).

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

**Placement-attach op (P3 §3.3, §9-Q2):** placement change = the dedicated
`placement-attach` structural op (never a state-slice, never `attach`-with-zone
— `attach` stays family-only). It registers the node if new, mints its
`content` anchor(s) per `names` (preference order, on the shared per-name
placement Link), mints/ensures the `container` anchor on the target container
node (with the §1.3 ancestor-name veto), and marks pass-2 dirty **only the
container node + the added node** (E2E-4's ideal affected set). The op payload
carries the **trigger identity** `{ kind: 'placement', linkName, direction }` —
which placement link the update changed — which `supervisor.apply` passes into
the pass-2 dispatch; the compiler entry evaluates the silent-abort relevance
pre-check per affected node before any state regeneration (§1.2 C-2).

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

The shared per-name `Link` is the provider registry: anchors carry an
`owner` backref (set by `Node.addAnchor`), so resolution enumerates the
provider NODES for a referenceName directly off the Link — arm-termination
and the pass-2 slice never sweep the graph for providers (render.md §4;
hub-less graphs fall back to slice scans).

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

> **Fork vs nearest-shadows-far (the reconciliation a data author needs):** the
> §4.1 walk is own → descendants → ancestors and STOPS at the first DEPTH that
> yields a provider (R3 "nearest shadows far"). A fork (N arms) happens ONLY
> when MULTIPLE providers sit at that SAME nearest matching depth (e.g. two
> provider descendants of the consumer — the phases.test.ts pRed/pBlue
> pattern). Providers at DIFFERENT depths do NOT fork: the nearer one wins and
> the farther is shadowed (one arm). To author a 2-arm fork, place the
> providers at EQUAL depth in the consumer's walk (both descendants, or both
> same-level ancestors); nesting providers under each other collapses to one
> arm.

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
| Expression | `source`/`target`/`duplex` anchors on a `referenceName` Link | `'container'`/`'content'` anchors on the shared per-name **placement Link** — the zone registry (P3 §1.1, §2.1) |
| Applied by | compile (borrow resolution, §4.1) | **`placement-attach` op + path-enumeration compile** (P3 §2.1, §3.3) |
| Role semantics | component roles only | `'container'`/`'content'` roles only — **not interchangeable** |
| Legacy | — | legacy `Placement`/`PlacementConfig` **carried over**: `placementName` → `'container'` anchor; `targetPlacement: string[]` → ordered `'content'` anchors (P3 §1.1, §1.2 — supersedes S3.6) |

Contract rules:

| # | Rule | Ref |
| --- | --- | --- |
| P1 | A placement-role anchor (`'container'`/`'content'`) **never satisfies** a component `target` borrow, and a component anchor never populates a placement zone. The walk algorithm is shared; the role semantics are not. | S-R2.8, P3 §1.1 |
| P2 | Adding a component-role anchor to a placement link (or vice versa) rejects with `LinkConfigError code: 'role-mismatch'` (`roles` whitelist). | notes §10.8.2, S-R3.9 |
| P3 | Placement multiplicity is **path-multiplicative** (P3 §1.2, §2): the consumer's `content` anchors are a preference-ordered request list (`targetPlacement: string[]` minted in array order); the compile stops at the **first-match-with-known-container** name and forks one path-state per zone (container anchor) of the chosen name — each zone a path hop, one state per `(prototype, path-to-root)` pair, `forkKey = pathKey` on every path-state (P3 §2.2). No `#<i>` arms: identity is pathKey alone (P3 §10.ab). | notes §10.8.2, P3 §1.2, §2, §10.aa/ab |
| P4 | Placement mutation via state-slice is hard-blocked (§3.3); placement changes go through the dedicated **`placement-attach` op** (§3.3, P3 §9-Q2) — never `attach`-with-zone (attach stays family-only; `AttachOp.zone` superseded). | notes §8.3, S3.6, P3 §3.3 |

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
| F2 | Forked states are **named** (`referenceName`/`placementName`) and **keyed by `forkKey`** (path back to root) plus unique per-node IDs. **P3 §2.2 extension (implemented):** `forkKey = pathKey` is present on **every** path-state, unconditionally — for placement paths the pathKey interleaves the zone names that routed each hop (`root/<zone>/<ownerId>/…/<nodeId>`), so F2's "path back to root" now names placement paths too (api.md §5 P3; placement hops never emit `#f:` keys). | notes §10.8.2, S3.1, P3 §2.2 |
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
| W2 | **Per-path coalescing per tick**: one microtask per tick; every node dirtied by a batch compiles remote in the same sweep; **each path-state of a node in the affected set emits its own `state` event** (keyed `nodeId` + `forkKey` — with `forkKey = pathKey` on every path-state (P3 §2.2) the keys are **path-unique**; last-write-wins applies per key, never across paths). The "≤1 `state` event per node per tick" letter is superseded: per-path keys fall out of `forkKey = pathKey` (events.ts needs no code change). | notes §10.8.4, P3 §9-Q3 |
| W3 | Path-states are **never coalesced into each other** — distinct `forkKey`s (pathKeys) stay distinct events; the affected set = the dirty nodes' compiled states (path-states included); every path-state emits `fork: { forkKey: pathKey, nodeIds: trace }` — no `#f`-grammar dependency (P3 C-6 re-expression). | S3.1, P3 §9-Q3 |
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
| T2 | apply on `unplaced` node | node with no owner chain | `apply` | `no-usable-state` + `nodeState:'unplaced'`; no journal; no events. **P3 §2.4 carve-out:** the gate keys on family-derived `NodeState` — a placement-routed node compiles actionable path-states through `compilePath` (path enumeration) even when its `state` label reads `unplaced` | S1.1, S2.1, P3 §2.4 |
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
| T16 | Placement via state-slice vs placement-attach | in-tree zone | (a) state-slice placement write; (b) `placement-attach` op | (a) `placement-target-blocked`; (b) applied — `content` anchor(s) minted per `names` (preference order), `container` anchor ensured on the container node (§1.3 veto), pass-2 dirty = container + added node only (E2E-4 affected set) | notes §8.3, S3.6, P3 §3.3 |
| T17 | Event coalescing | N applies dirtying overlapping nodes in one tick | apply × N | exactly one pass-2 sweep; ≤1 `state` event per node per tick; one envelope per topic | notes §10.8.4 |
| T18 | Event ordering / deferral | handler applies while its slice is active | nested `apply` | nested op deferred to a later tick; no interleaved mid-slice emission | notes §10.3, D2 |
| T19 | No partial-slice visibility | forking slice | observe during resolution | slice locked until all forks emitted/dropped; events only after final resolution | S2.3 |
| T20 | Fork de-duplication | forked states serialized | inspect payload | unique node IDs + path-key traces; arms never merged | S3.1 |
| T21 | Structural op cycle guard | `attach`/`move` that would create a cycle | `apply` op | `rejected`, `code:'cycle-detected'`; op rolled back | S3.4 |
| T22 | Handler mutation channel | handler body | direct node write / `receiveNextState` | impossible/absorbed — only `ctx.clientAPI.apply` exists | S2.1, notes §8.1 |
| T23 | Handler minimal re-render | handler applies to one node | `apply` | node-local compile only; diffed minimal-element render ops; no full graph walk | notes §10.6 |
| T24 | Inbound WS event | server pushes DB change | receive | normalized → `supervisor.apply` journal → normal pipeline (W6) | S-R3.11 |
| T25 | Hydrate re-resolve | SSR brush with serialized anchors | client hydrate | client re-resolves from anchors (same pipeline), does not trust shipped forks | S4.2 |
| T26 | `targetPlacement` content minting | legacy envelope with `placement.targetPlacement: string[]` | translate | one `'content'` anchor per name, minted in array order on the shared per-name placement Link; reverse emission round-trips `content` anchors → `targetPlacement: string[]` (P3 §6.2); the old NP13/AP5 `component-target-placement` warn is gone | P3 §1.2, §6.2 |
| T27 | Placement-path fork | prototype with `content` anchors; two containers share the chosen zone name | `compilePath` | one path-state per (node, path-to-root) — per-zone fan-out of the chosen name; sibling prototypes distinct at the final pathKey segment; `forkKey = pathKey` everywhere; no `#<i>` arms | P3 §2.1, §2.2 |
| T28 | Ancestor-name veto | producer whose ancestor already offers the same zone name | translate / placement-attach | anchor NOT minted; K4 warn `placement-name-vetoed`; never a throw | P3 §1.3 |
| T29 | Placement-path cycle | placement edges that revisit a node on the same walk | `compilePath` | that path arm drops with reason `'loop'` + one `circular-source` diagnostic; sibling walks unaffected (per-walk visit set) | P3 §1.4 |
| T30 | E2E-2 node-local invalidation | path-state of a shallow node | `props`/`text`/`css` state-slice | ONLY that node's path-states regenerate (compile-scope assertion); its element object is reused (wire-identity assertion) | P3 §3.1, E2E-2 |
| T31 | E2E-3 component consumers only | component SOURCE change | state-slice on the provider | affected set = the per-name component Link's `target`-anchor owners only; non-consumers run zero compile passes (half-tree precision case) | P3 §3.2, E2E-3 |
| T32 | E2E-4 placement add after render | third depth-4 node | `placement-attach` | dirty = {container, added node} only; no depth>4 recalc; render diff = one create + appends under the container's path wire | P3 §3.3, E2E-4 |

---

*Spec source: `RENDER_PROCESS_NOTES.md` §10.2, §10.6, §10.8.1–10.8.4, §10.9 (S1.1–S1.4, S2.1–S2.3, S3.x, S4.x, S-R2.x, S-R3.x). Ledger IDs are the trace of record.*
