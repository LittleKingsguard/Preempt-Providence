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

## 6. Known gaps (PARKED / TODO)

- **TODO (D6 — live-prod disposition 2026-08-14, `live-prod/placeholderLanding/
  FINDINGS.md`):** legacy handler DEFS stored as `template.component` values
  (`{name, body}` — e.g. `AuthInitHandler`, `LogoutHandler`,
  `ToggleUserDropdown`, `enterEditMode`, `showComments`,
  `toggleCommentsButton` in the placeholderLanding envelope) are misparsed as
  component SOURCE anchors: the K7 source-anchor plan makes them value-carrying
  providers, nothing wires them to phases/events, and the `handler-phase-unknown`
  guard never fires (they never become HandlerDefs) — the defs die SILENTLY.
  The legacy system wired them through `handlers.afterAssembly`-style targets +
  HandlerDef phases (old `core/Handler.ts:13`). Handler implementation changed
  for understood reasons; the misparse gap is **accepted and parked as a TODO —
  no fix**. Bodies of such defs use the legacy context API
  (`receiveNextState`/`findNode`/`supervisor.userData`) and would need the
  documented re-authoring carve-out if a fix ever lands. No new warn code is
  introduced for this gap.
