# Spec — Handlers & Phases: `handlers.ts` + Supervisor hooks

Derivative of `RENDER_PROCESS_NOTES.md` §3.1 (`HandlerDef`), §10.10.2
(event handlers), §10.10.3 (phase-based handlers). Behavior contract for the
TestWriter; every state and fail-state below is testable.

---

## 1. Handler shapes

```ts
type HandlerPhase = 'before-compile' | 'after-compile' | 'after-render'

interface HandlerDef {
  name: string
  event?: string     // event handlers: dispatchEvent matches `event` OR `name`
  phase?: string     // phase handlers: dispatchPhase matches `phase`
  body?: (ctx: HandlerContext, ...args: unknown[]) => unknown
}
```

A node's compiled `handlers` (pass-1 cache) are the dispatch source. Handlers
arrive via `NodeBaseData.handlers` (incl. legacy translation) or layers.

## 2. HandlerContext

```ts
interface HandlerContext {
  clientAPI: ClientAPI                       // the ONLY mutation channel
  supervisor: Supervisor
  node?: Node                                // the node being dispatched — per-dispatch
                                             // enrichment (variant A); undefined on the
                                             // shared base context
  states?: CompiledState[]                   // the dispatched node's last-known pass-2
                                             // resolved states (read-only); at after-compile
                                             // this is THIS pass's states
  tree: {
    getNode(id: NodeId): Node | undefined
    allNodes(): Node[]
    ancestorsOf(node: Node): Node[]          // parent chain → root
    descendantsOf(node: Node): Node[]        // full subtree, depth-first
    getState(id: NodeId): CompiledState[]    // pass-2 RESOLVED states (read-only)
  }
}
```

Built by `makeHandlerContext(supervisor, clientAPI)`. Mutations from handlers
flow through `ctx.clientAPI.apply` → `supervisor.apply` → journal (identified
by `journalId`, replayable via `replay/undo/redo`) — never direct field
writes.

`dispatchPhase`/`dispatchEvent` enrich the context per dispatch with
`node` (the node being dispatched — so an after-compile body can identify
itself) and `states` (the node's last-known resolved states). The shared
base context is never mutated; each dispatch receives a fresh scoped copy
(no reentrancy clobbering across nested dispatches).

### 2.1 Read access: handlers read the node's COMPILED state

A handler has **read access to a node's compiled state through
`tree.getNode(id)`** — the returned `Node` value getters (`type`/`props`/
`css`/`content`/`handlers`) read the current pass-1 compile cache, which is
always fresh (every mutation path runs `compileLocal` synchronously; node.md
§5). This is how a handler reads a value before (or after) writing through
`clientAPI` — e.g. the markdown demo reads the editor's text via
`getNode(editorId).content ?? getNode(editorId).props.value`, then writes the
parsed parts through `clientAPI.apply`.

Reads are always of the **pass-1 (authored/layered) compiled values**. Pass-2
**resolved** values (component `bindings`, fork arms, `pathKey`) are exposed
through a separate **read-only** surface:

- `ctx.tree.getState(id): CompiledState[]` — the node's last-known pass-2
  `CompiledState[]` (grouped per node, fork arms preserved), backed by the
  supervisor's **non-draining** `getResolvedStates(id)` store. Returns a
  shallow copy; calling it never consumes anything, and it *does not* touch
  the renderer's snapshot.
- `node.resolved: CompiledState[]` — read-only getter on `Node` returning a
  fresh shallow copy. Populated by the supervisor during pass-2
  (`{ focusNodeId }` compiles). Has no setter; assignment is a TS error.
- `supervisor.recordResolved(actionable)` — seeds the same non-draining store
  after a **bootstrap full compile** (demos compile the root directly,
  bypassing the supervisor). Never touches the draining store.

`supervisor.takePass2States()` remains **renderer-owned and draining** — a
handler getter must never call it. `clientAPI.getState` returns only
`{ nodeId, status, pathKey, state }` (surface, not values); the resolved
value surface above is the way a handler reads bindings / fork arms without
re-resolving from anchors.

## 3. Dispatch

| Function | Semantics |
| --- | --- |
| `dispatchEvent(node, ctx, event, ...args)` | runs every handler whose `event === event` or `name === event`; body called with `(ctx, ...args)` |
| `dispatchPhase(node, ctx, phase)` | runs every handler whose `phase === phase`; body called with `(ctx)` |
| `dispatchPhaseForNodes(nodes, ctx, phase)` | `dispatchPhase` over a node set (results concatenated in order) |

`Supervisor` exposes `clientAPI`, `handlerContext`, and
`runPhase(phase, nodeId?)` (single node, or all registered nodes when the id
is omitted; unknown id = safe no-op).

### Containment

Throwing bodies are contained: the error is returned in the result list,
never propagated into compile/render. Handlers without a `body` are skipped.

## 4. Phase ordering in the pipeline (DECIDED)

One apply+flush cycle, strictly:

```
before-compile ──▶ op executes (compileLocal / structural op)
                ──▶ [microtask] pass-2: compile(slice)
after-compile  ──▶ state/diagnostic events pushed + flushed
after-render
```

| Hook | Where | Notes |
| --- | --- | --- |
| `before-compile` | `Supervisor.apply` start, on the op node | observes the PRE-op state; runs even when the op is later rejected/no-usable-state |
| `after-compile` | pass-2 flush, right after `compile(slice)`, before events pushed | "after compile / before render" |
| `after-render` | after the tick's events flush | last; destroyed nodes skip |

The pass-2 (compile + `after-compile` + `after-render`) runs **regardless of
whether an EventBridge is attached** — only the event push/flush is gated on
`events`. Rejected / no-usable-state ops run `before-compile` (the hook fires
before the gate) but never reach `after-compile`/`after-render` (no pass-2 is
scheduled).

`state-slice` mutations may target `handlers` (`targetProp: 'handlers'`) —
applied as a layer like any other value.

## 5. Exhaustiveness gate

| ID | State | Expected |
| --- | --- | --- |
| H-H1 | matching event handler | body runs with `(ctx, ...args)`; result returned |
| H-H2 | handler without `event` but `name === event` | runs (name fallback) |
| H-H3 | non-matching event / missing body | skipped |
| H-H4 | throwing body | contained: error in results, no propagation |
| H-H5 | handler pushes via `ctx.clientAPI.apply` | journaled (identifiable `journalId`), node updated |
| H-H6 | tree search: `getNode/allNodes/ancestorsOf/descendantsOf` | correct walks (ancestors root-ward; descendants subtree) |
| H-H7 | phase handler dispatch (`dispatchPhase`) | only matching `phase` runs |
| H-H8 | `dispatchPhaseForNodes` over a set | per-node results in order, errors contained |
| H-H9 | `Supervisor.runPhase(phase, nodeId)` / `(phase)` | single node / all registered; unknown id no-op |
| H-H10 | ordering in one apply+flush cycle | `before-compile → after-compile → state-event → after-render` |
| H-H11 | before-compile observes pre-op state | handler sees the value BEFORE the op |
| H-H12 | rejected op | before-compile ran; no after-compile/after-render |

## 6. Legacy handler defs (D6 — SUPERSEDED 2026-08-15, the handler-seam LANDED)

The D6 "accepted and parked as a TODO — no fix" disposition is SUPERSEDED by
the handler-seam (review decision 7, landed 2026-08-15):

- **Def registration:** def-shaped `template.component` values
  (`{reference, value: {name, body}}` — e.g. the placeholderLanding defs)
  register as HANDLER DEFS by name at translate (K3 superseded for THAT shape
  only; a genuinely vacuous binding still fires `component-binding-empty`).
- **Seam planning:** `target: 'handlers.<event>'` plans WITHOUT the
  `component-target-gap` warn; the event suffix persists verbatim as
  `options.handlerEvent` (F17-style). Legacy lifecycle names as the suffix
  (afterAssembly, beforeRender, …) warn `handler-phase-unknown` + skip (N5 —
  event-only reuse; the 3-phase set stays closed).
- **Materialization:** compile layers ONE provenance-marked handlers layer on
  the consumer — `{name, event: <suffix verbatim>, body: compiled}` — via the
  origin/layer pattern (idempotent replace-in-place; a def that disappears
  clears the stale layer).
- **Reverse:** the consumer's binding emits `target: 'handlers.<event>'`
  (S26-style); the defs stay in `template.component`; re-translate is
  warning-free with no double-emit.
- **FORMAT MARKER (decision 4, LANDED):** the def body's data-format
  convention rides the marker — `format: 'legacy'` bodies are
  `(event, context)` and are installed WRAPPED by the bridge
  (`wrapLegacyHandler` — the arg order restored); `format: 'modern'` bodies
  are raw `(ctx, ...args)` and install unwrapped. The provenance default is
  'legacy' for seam-installed defs, 'modern' for inline `NodeData.handlers`
  bodies. An explicit per-def `format` overrides the default, persists on
  reverse (K5-style), and re-translate reproduces the same wrap; any other
  format value warns `handler-format-invalid` + falls back to the provenance
  default (translate.ts — never a throw). An inline legacy-wrapped handler
  re-emits its ORIGINAL body source (`sourceBody` — never the wrapper
  source) on reverse.
- **The runtime bridge is LANDED** (decisions.md HANDLER-SEAM row; review
  decisions 3/4/5/6 + the user directive 2026-08-15):
  - **The arg-order wrapper + event stub (decision 4):** `wrapLegacyHandler`
    installs the legacy body behind the engine's `(ctx, ...args)` dispatch —
    the body receives `(eventStub, legacyContext)`. The stub is
    `{type, preventDefault(){}, stopPropagation(){}, target: <NodeView>,
    isTrusted: false}` with `value: args[0]` when the dispatch carried an
    argument.
  - **The NodeView proxy (decision 3, review §5):** one WeakMap-cached view
    per live node — the SAME object across dispatches (bodies compare/
    attach to nodes). `parent` walks the family chain, token-terminated
    (rootNode/contentNodes/component — never a synthetic token node);
    `children` = FAMILY children only (seam-wired def children excluded);
    `css` reads parse a serialized style STRING back to the
    `Record<string,string>` OBJECT (F7 — the D3 reverse contract); `data` is
    the base facade (children NOT included — graph-derived, never stored);
    `state`/`type`/`props`/`content`/`handlers` delegate to the compiled
    node; `targetComponents`/`sourceComponents` are READ-ONLY fresh-copy
    maps of the anchor reference names (`.delete()` etc. are graph no-ops);
    `findNode`/`findNodes` walk the subtree in DOCUMENT order.
  - **QueryUtils — adapter-internal (decision 5, review §6):** the honest
    query vocabulary is `type` (exact), `id` (css.id), `classes` (every
    requested class present), `props` (exact equality per key), or a
    predicate function. ANY key outside that vocabulary — `style`,
    `handlers`, `components`, `hasNonTypeTargetComponents`, … — marks the
    query 'unsupported': `legacy-query-unsupported` warns ONCE per dispatch
    and the query matches NOTHING (never a silent broad match; the
    "support-or-warn" drift half did NOT land — warn-only is the contract).
  - **userData (decision 6):** read-only passthrough — the real supervisor
    with a `userData` member captured from `TranslatedTree.userData` at
    translate; a WRITE is a contained no-op (strict-mode assignment failure
    surfaces in the dispatch results — no session channel).
  - **receiveNextState — the write surface:** `type`/`content`/`props.*`/
    `css.*`/`handlers` map to ONE state-slice (`props.<k>`/`css.<k>`
    replaceAll per key); `css.style` OBJECT writes serialize back to the
    kebab-case string (D3); **`cssDef` is a plain css key — no special
    handling**: the value lands in the merged pass-1 css and the emit-side
    cssDef rules read the merged value like any authored cssDef. A
    **`{children}` payload is ONE `layer-apply`** (the user directive
    2026-08-15 — the origin-owner op; `legacy-kids-<nodeId>` deterministic
    layerId, minted family children origin-marked + registered, idempotent
    re-injection, teardown = one layer removal; a NodeView entry in the
    payload serializes to its data shape with the style re-serialized). A
    MIXED payload (children + state keys) rides the atomic layer-apply + a
    SEPARATE state-slice. A **`type: 'component'` NodeData in the children
    payload mints as an ORDINARY family child** — `type` is carried verbatim;
    the `'component'` token exists ONLY as a family-link parent-anchor target
    (node.ts `familyParentTokenOf`), never as a node's type string. A
    non-array children value rejects with
    `{status: 'rejected', error: {code: 'children-shape-invalid', …}}`.
  - **Remaining no-analog (REAL):** `enterEditMode`'s `window.Preempt`
    mutations (`fetchContent`/`fetchHandlers`/`rerun`) have no new-system
    analog — the body is data-fixed to the fetch path and its window guard
    contains the no-Preempt case (blind test #4 finding; review §8 listed
    enterEditMode as fully re-authored).
- Tests: `tests/unit/legacy-shape-translate.test.ts` H1-H6 + F1-F8 (the
  format-marker block), `tests/unit/legacy-bridge.test.ts` B1-B8 (the 6
  corpus defs through the bridge), `scripts/stress-probes/
  blind4-bridge-probe.mjs` (blind test #4 probe).
