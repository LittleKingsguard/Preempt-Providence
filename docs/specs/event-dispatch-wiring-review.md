# Event-Dispatch Wiring — Engine Dispatch Entry Proposal — Feasibility Review

Status: design review of the proposed "event-dispatch engine wiring" —
adding a `Supervisor.dispatchEvent` engine entry as the sibling of
`runPhase`. No code changed by this document. Companion context:
`docs/specs/handlers.md` §3 (dispatch table + containment),
`docs/specs/adapters.md` §3.2 (`on:<event>` / `opts.onEvent` page-side
seam), `src/core/supervisor.ts` (`runPhase` / `runPhaseOnNode`),
`src/core/handlers.ts` (`dispatchEvent`, `scopedFor`, `makeHandlerContext`),
`src/core/render-helpers.ts` §4.1 (fork-arm wires `<nodeId>#<i>`),
the handler-scenarios / live-prod / stress-probes run-all harnesses
(page-side resolvers that hand-resolve wires then call `dispatchEvent`).

## 1. What the proposal asks

Goal: give hosts a single engine-level entry that resolves a dispatch target
(Node instance / nodeId / wire string) to a live node and runs the node's
event handlers through the managed channel — the EVENT sibling of
`runPhase` — so the hand-rolled "find node by wire → call `dispatchEvent`"
resolvers every demo/stress harness duplicates become one `supervisor.
dispatchEvent(target, event, ...args)` call.

Mechanism sketch (paraphrased from the proposal):
1. `Supervisor.dispatchEvent(target, event, ...args): HandlerResult[]`
   — resolves the target, dispatches via the existing `dispatchEvent(node,
   ctx, event, ...args)` (handlers.ts), reusing the existing containment
   (throwing bodies land in the results list) and the per-dispatch
   node/states enrichment (`scopedFor`).
2. Wire resolution: the FULL string as a nodeId first, then the first-`#`
   prefix (`<nodeId>#<i>` fork-arm wires, render-helpers §4.1) — a
   `#`-bearing node id wins via the full-string lookup.
3. A fork-arm target dispatches the NODE once, all arms visible in
   `ctx.states`.
4. Unknown / destroyed / unplaced targets return `[]` — mirror of
   `runPhase`'s unknown-id no-op, but events return their results.
5. Pins: TRIGGER, never a journal entry; never drains pass-2 states; never
   flushes applies (the microtask flush owns a body's `clientAPI.apply`
   effects); never emits EventBridge events; NO propagation (target handlers
   only); same-(node,event) reentrancy no-ops via a `dispatchingEvents`
   guard (key `event:<event>:<nodeId>`), a different event is not blocked.
6. `ClientAPI` stays the 2-method surface; the `DomAdapter.onEvent` seam
   stays the page-side path (decoupling pin).

## 2. Feasibility verdict

**Feasible as stated for Phase A; ADAPT-AND-PROCEED in phases.** The
proposal is a thin, well-scoped engine addition that reuses the entire
existing dispatch machinery (`dispatchEvent`, `scopedFor` enrichment,
containment, the managed mutation channel). The review identified one
motivating defect class worth fixing in the same pass, one category error
to avoid (SSR), and a clear phase split so the long tail (a cross-process
MCP/Electron endpoint) does not block the in-process engine entry.

### 2.1 What already exists (grounding)

- `dispatchEvent(node, ctx, event, ...args)` (handlers.ts) already runs
  every handler whose `event === event` or `name === event`, calls the body
  with `(ctx, ...args)`, and returns contained `HandlerResult[]`.
- `scopedFor` (handlers.ts:91-94) already enriches the per-dispatch context
  with `node` (the node being dispatched) and `states` (the node's
  last-known pass-2 resolved states).
- `runPhase` / `runPhaseOnNode` (supervisor.ts) already establish the
  pattern: resolve an id against the node map, run the dispatch inside a
  reentrancy guard, return contained results.
- Every demo/stress harness that interacts (handlers-scenarios, live-prod,
  feature-showcase, the stress-probes run-all family) re-implements the
  same "find the node by authored id / wire → `dispatchEvent(node, ctx,
  event, ...)`" resolver by hand — the duplication this entry removes.

### 2.2 Gap A — the `#`-in-nodeId resolution order

Fork-arm wires are `<nodeId>#<i>` (render-helpers §4.1), but a node id may
itself contain `#`. The naive "split on `#` and take the prefix" rule would
mis-route a legitimately `#`-bearing id. Resolution must be FULL-STRING
FIRST (`nodes.get(target)`), then the first-`#` prefix — so `a#b` (a real
node id) wins over `a` (the arm grammar of a different node). This is a
small, deterministic rule; the review pins it as a test case, not a design
question.

### 2.3 Gap B — the fork-arm target must fire ONCE, not once-per-arm

A fork-arm wire (`consumerId#0`) addresses a NODE, not a single arm. Naively
looping the arms would re-run the body once per arm — wrong. The entry must
resolve the wire to the NODE and dispatch that node once, with all arms
visible through `ctx.states` (the existing `scopedFor` enrichment already
groups them). Tested explicitly (fires === 1, seenArms === 2).

### 2.4 Gap C — the reentrancy guard is per (node, event)

A body that re-dispatches itself (mistakenly or by design) must not loop.
The guard key is `event:<event>:<nodeId>` — the same node + same event
no-ops; a different event on the same node is NOT blocked. This mirrors the
`runPhaseOnNode` guard (`${phase}:${node.id}`) and reuses the same
try/finally discipline.

### 2.5 Gap D — SSR is a category error (do not force parity onto it)

The as-framed "identical to the DOM" SSR contract is a category error: SSR
is a build-time artifact with no live graph and no host interaction — there
is no event loop, no listener, no `onEvent` seam to drive. The review
disposition: Phase B defines a SEPARATE formal SSR synthetic-event contract
(producing-process-keeps-graph + fragment-as-addressable-metadata; the
vocabulary is `css.id` + process-side wire resolution; parity harness; NO
render change) — it is NOT the same method, and it is NOT required for the
DOM/engine entry to land.

### 2.6 Gap E — the long tail is a different product (Phase C)

A cross-process MCP/Electron endpoint is a different surface: structured-
clone args (a raw DOM `Event` cannot cross a process boundary — the JSON
envelope `{type, value, target?, ...rest}` mirroring the legacy stub,
string-arg back-compat), an idempotent `requestId`, AWAIT THE MICROTASK
FLUSH BEFORE RESPONDING (a dispatch does NOT itself flush/emit — bodies'
`clientAPI.apply` effects land on the flush; the handler-scenarios
`interact()` pattern is the precedent), and a settled `{results, dirtied}`
response shape (results sanitized at the boundary — non-cloneable body
returns → `{kind, id}` descriptors). Parked spec-only — it must not block
the in-process engine entry.

## 3. Cost / benefit

- **Cost:** ~one method + one resolver + a guard set on the Supervisor class
  (~40 lines) + 10 tests. No render change, no adapter change, no op change,
  no serialization change. `ClientAPI` and `DomAdapter.onEvent` untouched.
- **Benefit:** the engine has ONE event entry that mirrors `runPhase`;
  every harness drops its hand-rolled resolver; the fork-arm dead-click
  class (nodeId-keyed `wireToNode` maps, components.js:171) is addressed by
  the deterministic wire-resolution rule; the reentrancy/containment/no-drain
  pins become host-testable in one place (phases.test.ts).
- **Non-goals honored:** never a journal entry (replay re-runs effects,
  never bodies); never drains/flushes/emits; no propagation; `onEvent` stays
  the independent page-side path.

## 4. Disposition

**ADAPT-AND-PROCEED in phases (user go-ahead 2026-08-20):**
- **Phase A (this pass, TDD red→green→verify):** `Supervisor.dispatchEvent`
  + `resolveDispatchTarget` + the `dispatchingEvents` guard in
  `src/core/supervisor.ts`; tests = the "Supervisor event dispatch" block
  in `tests/unit/phases.test.ts` (target kinds, fork-arm once-fire + states
  grouping, `#`-in-nodeId resolution order, unknown/destroyed → [],
  reentrancy same-event vs different-event, containment, no-drain).
- **Phase B (user-gated):** the formal SSR synthetic-event contract
  (producing-process-keeps-graph + fragment-as-addressable-metadata; parity
  harness; no render change) — parked spec-only in docs/pending.md.
- **Phase C (user-gated):** the MCP/Electron endpoint — parked spec-only in
  docs/pending.md (structured-clone args, idempotent `requestId`,
  flush-before-response, `{results, dirtied}`).

Recorded: `RENDER_PROCESS_NOTES.md` §10.10.9 (DECIDED), `docs/decisions.md`
EVENT-DISPATCH-WIRING row, `docs/specs/handlers.md` §3, `docs/next-steps.md`.