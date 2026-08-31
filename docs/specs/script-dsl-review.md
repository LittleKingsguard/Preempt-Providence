# Review — Script DSL / Guardrailed Code-as-Data + Cordis Composability

**Status**: WORKABLE WITH SCOPING — **V1 (R1) APPROVED-FOR-REVIEW; R2 NOT
FEASIBLE on this codebase; Cordis follow-up = separate workstreams.** (three-agent
gate, AGENTS.md item 9 — validity → critique → architecture → change-analysis;
this is the step-3 verdict, all gate agents read-only). **Date**: 2026-08-27.
**Source**: user proposal "pre-written set of tools for creating handlers,
defined/named variables, functions and classes … script in a Provident node …
written as data … without … eval() or new Function()", plus the Cordis
composability follow-up.

## What the proposal asks

The user asks for two things:

**Part A — a guardrailed script DSL.** A pre-written, configurable toolkit for
creating handlers, named variables, functions and classes *as data* living on a
Provident node (a "non-code" spec format, e.g. a GitHub-workflow-style schema),
authorable in the browser, that materializes behavior **without** the arbitrary
code execution of `eval()` / `new Function()`. The follow-up note anchors this
to the framework's existing *idempotent* behavior.

**Part B — Cordis composability.** Whether the *composeability features* of the
Cordis meta-framework (temporal + spatial composition, revertible effects) can
be layered onto that idempotent foundation, and what additional changes would be
required.

The architecture agent's scoping is adopted verbatim and is the spine of this
verdict — the intent splits cleanly into:

- **R1 — named reactive variables / data-transform functions.** Pure data:
  declarative reactive values and mapping/filter/reduction transforms. This is
  the *derived.ts family* pushed to "named, browser-authorable data".
- **R2 — imperative handlers / functions / classes.** A programming language in
  disguise: sequenced, side-effecting, stateful behavior. This is what the
  "handlers, functions and classes" phrasing reaches for.

The verdict is different for R1, R2, and the Cordis follow-up; they are **not
the same project**.

## Feasibility verdict

### (a) R1 — code-as-data DSL: FEASIBLE, CONSISTENT WITH ALL PINNED PARADIGMS

The in-tree proof exists. `src/core/derived.ts` is already a whitelist JSON-schema
total interpreter (`validateDerived` / `evaluateDerived` / `applyDerived`) with
**zero** `eval`/`new Function`: it validates then interprets a fixed op/arg
schema. R1 generalizes this from "one derived node" to "a named registry of
reactive variables + data-transform functions". Every pinned foundation already
supports it:

- **Managed channel** — derived transforms are already pure functions over the
  managed state; expanding the op set changes the whitelist, not the channel.
- **Two-scope compile + phase ordering** — a data transform's read of
  `nodeData` slots resolves in the same compile-time/run-time scoping as derived
  today; no new seam.
- **Read-only compiled states** — the interpreted transform output feeds
  read-only compiled state, preserving idempotency/replay guarantees (see R2 for
  why state mutability would break this).
- **Zero-dependency** — a whitelist interpreter adds no dependency; this is what
  keeps the no-`eval` guardrail *in-tree and auditable*.
- **Serialization/idempotency** — transform rules round-trip as data (rule-not-
  value), which is exactly the idempotent, re-answerable shape the follow-up
  asks about.

There is no new arbitrary-code-execution surface here **provided** the interpreter
stays a *total* whitelist validator (reject anything outside the schema before
dispatch) — see gap C1.

### (b) R2 — in-browser imperative handlers/functions/classes as runtime-written data: NOT FEASIBLE on this codebase

This is a hard no, and all three gate agents converge on it. The reasons are
structural, not stylistic:

- **The dispatch seam hard-requires native closures.** Dispatch demands
  `typeof handler.body === 'function'` (`handlers.md` H-H3). Only a compiled
  native function satisfies it. A runtime-interpreted "script handler" body would
  need a NEW dispatch seam — a second, interpreted path the engine does not have
  and that re-introduces exactly the arbitrary-execution risk the proposal wants
  to avoid (see gap C1).
- **Runtime-written data is forbidden from becoming handler closures.**
  `handlers.md` REQ-GAP-10 pins the **name→body seam as pre-mount-only**: bodies
  are captured from *authoring-time* data and sealed at translate; and
  `registerHandlerBody` is **REJECTED** (`handlers.md` line 199) — there is no
  runtime path to mint a handler from data. The only runtime-native-closure path
  is the pre-mount translate seam, which contradicts "created in browser as
  runtime-written data".
- **The trust seal is backend-gated, not interpreter-gated.** The honest
  answer to "no eval/new Function" is that the **backend write-gate already
  exists** (`translate.ts:489-492`): untrusted authors cannot reach the compile
  path. That gate is the guardrail. A browser-authored script that reaches the
  *post-mount* runtime cannot be materialized into a native closure at all, so
  R2 is not merely hard — it is architecturally blocked.

Conclusion: **the runtime-created, in-browser imperative handler/class is not
achievable in any architecture on this engine.** Any defensible R2-shaped feature
(native closures via the existing pre-mount seam) is not really "script-as-data" —
it is the existing handler-body data format with a friendlier authoring UI, which
is a UX project, not an engine feature.

### (c) Cordis composability: PARTIAL / SEPARATE — not the same machinery as R1

- **Temporal composability ≠ journal undo.** The framework's journal gives
  idempotent *replay*, not *revertible effects*. The parked undo no-ops
  (destroy-pinned, `ops.md` §6) and untracked external handler side effects mean
  a Cordis-style "revert this composed effect" cannot be reconstructed from the
  journal. Reversal needs per-effect *author-supplied inverses* +
  component-scoped full reversal — the journal's parked no-ops cannot provide it.
- **Spatial composability needs a declared coeffect.** The anchor-graph
  bindings + dirty-propagation machinery would be the carrier, but there is no
  declared *coeffect spec*, no satisfier, and no activate/deactivate
  classification over the anchor consumer-walk.
- **HMR is the achievable piece today — as whole-graph `_restoreBase`.** That
  already works. Component-scoped HMR is gated on the inverse/effect work above.
- **No shared machinery.** The script DSL (R1) and the Cordis agenda share
  almost nothing; they are two workstreams, not one.

## What must change / gaps + costs-benefits

### The concrete v1 spec surface (R1)

Adopt the architecture agent's "v1 = R1 only" shape and write it as its own spec
`docs/specs/script-state.md` (a downstream spec gate, not implementation):

- **`nodeData.script` (a `ScriptDecl`)** merged the way `derived` is merged today,
  per-`GraphScope`.
- **New `src/script/` pure module** — `validate` / `evaluate` / `apply`, whitelist
  `$map` / `$filter` / `$reduce` / `$match`-style ops (extend the derived family's
  op table), no `eval` / `new Function`.
- **Compile-side bake** reading read-only compiled state; transforms **pure +
  sync** so interpreter state never crosses the journal and replay idempotency is
  preserved.
- **New `provident-ssr/script` subpath** export.
- **Serialize as rule-not-value** so authored scripts round-trip (this is the
  "code written as data" deliverable), with reverse-translate supported.
- **Handlers stay on the pre-mount native-closure seam** — they are NOT runtime
  materialized, even in v1.

### Hard boundary (non-negotiable)

**Runtime-written data can NEVER become a native handler closure.** Any spec that
would mint a handler/class at post-mount runtime from browser-authored data
violates REQ-GAP-10 and the rejected `registerHandlerBody`. The guardrail is the
**backend write-gate** (`translate.ts:489-492`) — authors are blocked at
authoring/compile, not via a runtime interpreter gate.

### v2 deferrals

- **R2 (imperative script handlers / functions / classes as data)** — a separate
  late proposal, parked. If pursued at all it is a separate containment project
  (a distinct realm — worker iframe/wasm — which conflicts with the zero-dependency
  single-frame posture) and needs its own full gate. Not this review's approval.
- **Cordis temporal (inverse effects, component reversal)** — separate workstream:
  per-op inverse facts for the five parked undo no-ops (detach/move/
  clone-instance/layer-apply/placement-attach, each user-gated), a per-component
  effect registry (author-supplied dispose/recover), and a user ruling on destroy
  reversal (re-mint-fresh vs terminal = not revertible).
- **Cordis spatial (coeffect)** — separate workstream: a declared coeffect spec +
  satisfier + activate/deactivate lifecycle over the anchor consumer-walk.

### Costs (honest)

- **New containment surface (C1).** A non-`eval` DSL is still a *new interpreter*;
  a new interpreter is a new, less-audited place for arbitrary-code-execution
  bugs to hide and escape the whitelist. A *total* validator is hard to keep
  total (every op/arg expansion must stay closed). This is the single biggest
  risk, and it is the reason the boundary (backend write-gate) is the real
  mitigation, not the interpreter itself.
- **Maintenance + tests.** New op-table schema, round-trip serialization, reverse-
  translate; every new whitelist op needs its own validation/denial tests.
- **No R2 delivery.** V1 does not deliver the "handlers and functions and
  classes" headline the proposal's first sentence reaches for — only the
  reactive-variable / data-transform core. Managing that expectation is a cost.

### Benefits

- **Named reactive variables as pure data** — browser-authorable, guardrailed,
  round-trippable, and *consistent with the engine's existing derived model*
  rather than a parallel mechanism.
- **No `eval` / `new Function` anywhere in the authored path** — the whitelist
  interpreter + backend write-gate together close arbitrary runtime execution for
  the data-transform surface.
- **Reuses the proven in-tree pattern** (`derived.ts`), so the guardrail audit
  surface is narrow and the idempotency/replay guarantees hold.

## Verdict / recommendation

**PROCEED on v1 R1, under its own spec — do not proceed on R2 or Cordis under
this proposal.**

The disposition to gate:

1. **GO (v1 R1 DSL).** Proceed to the AGENTS.md item 6 step gates with a fresh
   spec, `docs/specs/script-state.md`, scoped exactly as above (R1 only):
   `nodeData.script` / `src/script/` / subpath export / per-scope / rule-not-value
   serialize / pure+sync transforms. Handlers remain on the pre-mount seam. This
   delivers the legitimate core with full guardrail and idempotency.
2. **PARK (R2).** Imperative handlers/functions/classes as runtime-written
   data is NOT feasible on this codebase (REQ-GAP-10, rejected
   `registerHandlerBody`, hard `typeof body === 'function'` seam, backend-gated
   trust seal). A native-closure UX overlay on the existing pre-mount hander data
   is possible but is a separate UX proposal, not script-as-data.
3. **PARK (Cordis).** Temporal (inverse effects, per-component reversal) and
   spatial (coeffect spec + satisfier + lifecycle) composability are **separate
   workstreams** — HMR-as-`_restoreBase` already works today; component-scoped HMR
   is gated on the inverse work.
4. **DECISION THE USER MUST MAKE** — the proposal's headline asks for R2 (the
   "handlers, functions and classes" part) *as well as* R1. The user must accept
   that this codebase delivers only the R1 data-transform core as a guardrailed
   script DSL, and that R2 requires either (a) pre-mount authoring-time closures
   (not runtime data), or (b) a separate realm-based containment project that
   conflicts with the zero-dependency single-frame posture. If the user's actual
   need is the full R2 surface, the honest answer is this codebase is the wrong
   host and a plain module-level API / build-time step is the better solution.

## Gate record

- Step 1 validity — **VALID WITH CHANGES** (derived.ts is the in-tree proof; R2
  lacks any dispatch seam/registry; legacy `new Function` path must be gated;
  Cordis mapping partial).
- Step 2 critique — **NOT FEASIBLE AS WRITTEN** (new interpreter = new ACE surface;
  state must stay pure+sync for replay; runtime-write body letter + rejected
  `registerHandlerBody` forbid runtime materialization).
- Step 3 architecture — **WORKABLE WITH SCOPING** (R1 vs R2 split; v1 = R1 only;
  R2 not achievable in any architecture; Cordis = separate agenda).
- Step 4 change-analysis — **THIS VERDICT: WORKABLE WITH SCOPING — V1 (R1)
  APPROVED-FOR-REVIEW**. All gate agents read-only; no source or other docs
  modified. This proposal is not itself a spec; it clears the gate for the R1 spec
  (`docs/specs/script-state.md`) to enter the AGENTS.md item 6 gates, pending the
  user's go-ahead on the scope decision in item 4.

---

# ADDENDUM — R2 blocker anatomy: decisions vs deeper architectural gaps (2026-08-31)

Recorded on the user's request: for R2 (imperative handlers/functions/classes as
runtime-written data), are the blockers *just* the pre-existing decisions, or is
there a deeper code break? **Answer: the surface blockers are the decisions, but
those decisions are the codified form of genuine architectural gaps underneath —
not a policy wall standing in front of a working path. Lifting the decisions
would NOT make R2 start working; it would expose that no machinery exists to run
a guardrailed script body at dispatch.**

## What the code actually shows (grounded)

- **The data model already tolerates a script-handler.** `NodeBaseData.handlers`
  is `unknown[]` (`types.ts:337`) and a runtime `state-slice` `handlers` write
  stores its value **verbatim** via `addLayer` (`node.ts:1437`). Nothing in the
  data model rejects a non-function body — it is simply *carried*, not run.
- **The single dispatch wall is `src/core/handlers.ts:102` and `:118`:**
  `if (typeof handler.body !== 'function') continue`. Every event/phase dispatch
  funnels through these two lines; non-function bodies are silently dropped.
  There is NO interpreter anywhere in `src/` — only native-closure bodies are
  ever *called* (`handler.body(scoped, ...args)`).
- **Serialization actually favors R2-as-data, not blocks it.** `serialize.md`
  SER-H8 (`serialize.md:157`) drops handler bodies only *because they are
  functions* ("runtime-only, never serialize"). A script-handler carried as pure
  data would round-trip via serialize/loadState fine. Serialization is **not** a
  blocker; the blocker is confined to the dispatch seam + the absence of anything
  to route a script body *to*.

## Layer 1 — the surface blockers (the decisions)

- `RUNTIME-WRITE BODY LETTER` (handlers.md §4) — runtime `handlers` writes accept
  function bodies only; non-function bodies are skipped at dispatch.
- `registerHandlerBody` **REJECTED** (handlers.md REQ-GAP-10, pending.md) —
  a string-body registry would drag the `new Function` eval gate into the runtime
  write surface.
- The name→body seam is **pre-mount-ONLY** — the only runtime-native-closure path,
  and it is unjournaled + pre-mount.
- The hard `typeof handler.body === 'function'` dispatch gate.

## Layer 2 — the deeper architectural gaps (independent of the decisions)

Even with every letter above rescinded, three facts remain and are why R2 is a
separate, larger project rather than a flag-flip:

1. **The engine dispatches JS closures, not programs.** There is no "script body"
   concept anywhere in `src/`. Guardrailed R2 requires (a) a **new interpreted
   dispatch seam** — a discriminated `body | script` union at
   handlers.ts:102/118 — plus (b) a **whole imperative interpreter**
   (statement/control-flow/variable/class execution), far beyond `derived.ts`
   (an *expression-only* whitelist). That is new engine machinery, not a toggle.
2. **Replay / idempotency purity.** `supervisor.apply` journals ops and replays
   them. An interpreter holding its own mutable registers/session/RNG introduces
   state **outside the journal** → a replay that is not idempotent. R2 must be a
   pure, synchronous function of (journal + snapshot + op payload). An
   architectural invariant, not a letter.
3. **Confinement.** The interpreter would run in the same realm as
   `ctx.clientAPI`; any interpreter bug is a full-realm compromise. The only
   honest containment is a separate realm (worker/iframe/wasm), which conflicts
   with the zero-dependency, single-frame, 50MB+ smoke-isolation posture. This is
   why the current model's real guardrail is the **backend write-gate**
   (`translate.ts:489`) — a policy decision that is *backed by* the architecture.

## Conclusion

The blockers for R2 are **primarily the pre-existing decisions**, and those
decisions are correct and load-bearing. But they are not arbitrary — they are
the codified response to the three architectural facts above. There is **no
hidden code-level break** (existing code would not fail, and no data/type wall
prevents *carrying* a script-handler); rather, the engine has **no interpreter
slot**, **no replay-safe interpreted-body discipline**, and **no contained realm**
to host one. R2 therefore requires new, substantial containment machinery before
it can exist at all, and rescinding the letters does not change that. This is the
reasoning behind the gate's verdict that R2 is a "separate, larger containment
project" rather than a follow-on to R1.

---

# ADDENDUM — clarified intent: the DSL is a CAPABILITY / ACCESS-SCOPING model (2026-08-31)

The user clarified the DSL's actual purpose. It is **not primarily a
code-as-data execution model** — it is a **guardrail on state access**: a
capability/scope layer that confines code to one branch of the tree for
isolation. This reframes the proposal and materially changes its feasibility
profile.

## The clarified access contract (verbatim intent)

For a script/DSL operating on a node:

- **Full CRUD** on the owning node and its **descendants** (the branch it owns).
- **Read access** on **direct ancestors**.
- **Declarable update access** on **specified variables on direct ancestors**
  (opt-in, declared — not blanket).
- **Listen access** to the above (subscribe to changes within the granted
  domain).

**Objective:** code operates only within the domain of one branch of the tree.
Example: a DSL operating a pane in a UI can only affect a *different* pane if the
root/supervisor **exposes something they can both read** — cross-branch mutation
is denied unless explicitly shared.

## Grounding against the current access surfaces

- **Mutation is already a single choke point.** `clientAPI.apply(nodeRef,
  mutation)` (`src/core/client.ts:25`) resolves the nodeRef via
  `supervisor.getNode` and funnels every write through `supervisor.apply(op)`.
  Today a handler with `ctx.clientAPI` can mutate **ANY** node in the graph (the
  op's `node` plus the `to`/`source`/`container`/`target` refs resolve to any
  node). A **capability filter** inserted at this boundary (in `createClient` or
  `supervisor.apply`) can reject any op whose target falls outside the granted
  domain — own subtree for CRUD, declared ancestor variables for update. This is
  the natural, feasible insertion point.
- **Read is a scoped-able surface.** `HandlerContext.tree`
  (`getNode`/`allNodes`/`ancestorsOf`/`descendantsOf`/`getState`, handlers.ts:30)
  currently exposes the WHOLE tree. A scoped view wraps these to expose only the
  granted domain (own subtree + direct ancestors + declared ancestor variables).
- **Listen is a NEW surface.** The engine has `EventBridge` (events) and
  dispatch, but no per-domain change-subscription. "Listen access to the above"
  requires a scoped subscription surface (subscribe to changes within the
  granted domain) — a gap to design, not an existing seam.

## The key reframe: access model is ORTHOGONAL to the execution model

The clarified intent is about **what code can touch**, not **how code is
represented/run**. This is the decisive point:

- The **capability/access-scoping is feasible and valuable INDEPENDENT of the
  interpreter question.** It can be applied to **existing native-closure
  handlers** (function bodies) by giving them a capability-attenuated context —
  no interpreter, no `new Function`, no script-as-data needed for the access
  guarantee itself.
- This **de-scopes the hardest part** of the original proposal. The earlier
  verdict's R2 blocker (no interpreter slot / replay-purity / realm-confinement)
  applies to the *execution* of script-as-data. The *access* half — a scoped
  `clientAPI` + scoped `tree` + scoped listen — is a capability layer that does
  not require an interpreter at all.
- The "no eval / new Function" constraint then becomes a property of the
  *authoring/execution* choice (native closures via the pre-mount seam, or a
  later interpreted body), while the *isolation* objective is delivered by the
  capability filter regardless.

## Feasibility re-assessment (access model)

- **FEASIBLE and consistent with the pinned paradigms.** A capability filter at
  the `clientAPI.apply` choke point + a scoped `tree` view + a scoped listen
  surface preserves the managed channel (all writes still flow through
  `supervisor.apply`), two-scope compile, phase ordering, and read-only compiled
  states. It is a **finer-grained capability layer within a single graph** —
  distinct from the per-SUPERVISOR graph-scope isolation (multi-graph-isolation),
  which partitions whole graphs; this partitions branches within one graph.
- **Gaps to design:** (1) the capability filter's placement + the op-target
  allowlist (own-subtree CRUD, declared-ancestor-variable update); (2) the
  scoped `tree` view; (3) the scoped listen/subscription surface; (4) the
  "declarable update on specified ancestor variables" declaration format (a
  declared capability spec, close to the Cordis coeffect-spec idea); (5) how the
  root/supervisor "exposes something both can read" (a shared read-only value
  seam). None of these require an interpreter.

## Implication for the parked verdict

The clarified intent does **not** reopen the proposal (still parked), but it
**re-frames the feasibility split**: the **access-scoping half is feasible and
valuable on its own**, independent of the script-as-data execution half. A future
gate should treat the proposal as TWO axes — (A) the capability/access-scoping
layer (feasible, no interpreter required, applies to existing native-closure
handlers) and (B) the script-as-data execution model (the R2 interpreter
question, still blocked as analyzed). Axis A is the more feasible and more
valuable deliverable and should be evaluated first.

---

# ADDENDUM — the managed channel is a CONVENTION, not an enforcement (2026-08-31)

Recorded on the user's question: *"Can state-changing operations be coerced to
only use the exposed clientAPI functions without the DSL changes?"* **Answer:
NO.** The managed channel is a documented convention, not a hard guarantee, and
the current `HandlerContext` exposes more than `clientAPI`. This finding
**strengthens the case for axis A** — the capability layer is what would turn the
convention into an enforcement.

## What a handler body can actually reach today

The `HandlerContext` gives a handler three things; only one is `clientAPI`:

1. **`ctx.clientAPI`** — the intended channel (`apply`/`getState`), which funnels
   to `supervisor.apply`.
2. **`ctx.supervisor`** — the FULL `Supervisor`, exposing `apply` (same channel,
   but bypasses the `clientAPI` wrapper), `dispatchEvent`/`dispatchPhase`/
   `runPhase` (trigger OTHER mutating handlers), and `undo`/`redo`/`replay`
   (mutate the graph).
3. **`ctx.node`** — the dispatched `Node`, and **`Node.addLayer`/`removeLayer`
   are PUBLIC methods** (`node.ts:644/663`, no `private` modifier). A handler can
   call `ctx.node.addLayer(...)` directly — a mutation that **bypasses the
   channel and the journal entirely**.

## The concrete bypasses (the gaps axis A must close)

- **`ctx.supervisor.apply(op)`** — same channel, but not through the `clientAPI`
  wrapper; a handler can reach it directly.
- **`ctx.node.addLayer(...)` / `removeLayer(...)`** — direct, **not journaled,
  not gated, not through the channel at all**.
- **`ctx.supervisor.dispatchEvent` / `dispatchPhase` / `runPhase`** — indirect
  mutation by triggering other handlers.
- **`ctx.supervisor.undo` / `redo` / `replay`** — mutate the graph.

The managed-channel letter says handlers *should* use `clientAPI`, but nothing
*forces* it. The surface leaks.

## And even `clientAPI` alone is not scoped

Even if every mutation were coerced to `clientAPI.apply`, it can target **any**
node in the graph (`client.ts:26` resolves any `nodeRef`). So "only clientAPI"
≠ "only my branch." Branch-scoping requires a capability filter on `apply` —
the axis-A change.

## What axis A must therefore deliver (to make the convention an enforcement)

To coerce state changes to (a) only flow through `clientAPI` AND (b) only touch
the granted branch, axis A needs a **scoped handler context** that:

- **hides `ctx.supervisor`** (or replaces it with a capability-attenuated view —
  no raw `apply`/`dispatch`/`undo`/`redo`/`replay` reachable from handler code),
- **hides the node's mutation methods** (`addLayer`/`removeLayer` not reachable
  from handler code — the dispatched `ctx.node` must not expose them),
- and adds the **capability filter** on `clientAPI.apply` (own-subtree CRUD,
  declared-ancestor-variable update).

This is precisely the axis-A (capability/access-scoping) work — it is **not
avoidable** by "just using clientAPI." The managed channel is currently a
convention; the capability layer is what turns it into a hard guarantee.

---

# ADDENDUM — the whitelist DSL IS the confinement mechanism (2026-08-31)

Recorded on the user's question: *"Can this be addressed by the strict
whitelisting policy of a DSL preventing arbitrary JS code write?"* **Answer:
YES — and it is the correct mechanism.** A strict whitelist DSL that *prevents
arbitrary JS from being written* closes the "direct name calling" hole, because
the author can never express `window.evil()` or `someGlobal = 5` in the first
place; the interpreter only ever executes whitelisted operations. This is the
**R1 / `derived.ts` pattern** already proven in this codebase.

## Why it works

The earlier "nothing prevents it" answer was about **arbitrary JS bodies**
(compiled via `new Function`). A whitelist DSL is a different animal:

- The DSL is a **distinct grammar** with a **fixed vocabulary** — there is no
  `window`, no `globalThis`, no `fetch`, no arbitrary name to call. The author
  can only write whitelisted constructs (e.g. `clientAPI.apply`,
  `tree.getNode`, arithmetic, `$if`/`$eq`/`$concat`).
- The **interpreter** executes only those whitelisted ops. It never runs
  arbitrary JS. So "direct name calling" is **impossible by construction** —
  the names do not exist in the language.
- In-tree proof: `src/core/derived.ts` is a whitelist JSON-schema interpreter
  (`validateDerived`/`evaluateDerived`) with a fixed op set and **zero**
  `eval`/`new Function`. It cannot reach arbitrary JS because it has no
  construct that does.

## The two conditions that make it actually safe

1. **It must be a real constrained language, not JS text.** If the "DSL" is
   authored as JS source and compiled via `new Function`, the whitelist is
   **cosmetic** — the body is still arbitrary JS and the hole is wide open. The
   whitelist only bites when the DSL is a distinct grammar that is **parsed and
   interpreted** by a whitelist interpreter. This is the R1/derived.ts shape,
   NOT the R2 `new Function` shape.
2. **The interpreter must be escape-proof.** A whitelist interpreter is only as
   safe as its totality and its inability to reach arbitrary JS. Escape vectors
   to guard: no `eval`/`Function` constructor reachable from any whitelisted op;
   no dynamic property access that could reach a global (`get(obj, path)` that
   could hit `window`); no prototype-pollution via a merge/assign op; every
   whitelisted op is itself audited JS. This is the "a total interpreter is hard
   to keep total" concern — the real engineering cost, not a blocker.

## This reconciles the earlier "realm" conclusion

The earlier "only a separate realm confines code" was about **arbitrary JS**.
For a **whitelist DSL**, the interpreter *is* the containment — it can live
**in-realm** with no realm conflict, because the language cannot reach arbitrary
JS. So the whitelist DSL is the path that **avoids** the zero-dependency /
single-frame conflict the realm approach hits. This makes it more attractive
than the earlier framing suggested.

## Orthogonal to axis A — you want both

- The **whitelist DSL** confines the *language* (no arbitrary JS write) — the
  execution-model axis (R1-family).
- **Axis A** scopes the *tree access* (what the DSL can touch — own-branch CRUD,
  ancestor read, declared ancestor update, listen).

They compose: the DSL guarantees the code cannot do arbitrary things; axis A
guarantees the code can only reach its granted branch. Neither subsumes the
other. The honest conclusion: a strict whitelist DSL is the right and sufficient
mechanism for the arbitrary-JS problem — provided it is a real interpreted
language (not `new Function` of JS text) and its interpreter is escape-proof.
That is the R1/derived.ts-family approach, and it is the feasible axis, not the
blocked R2 imperative interpreter.
