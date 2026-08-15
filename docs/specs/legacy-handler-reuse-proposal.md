# Legacy Handler Reuse — Proposal (2026-08-15)

Proposal for the three-agent review gate (AGENTS.md item 9). Question: given
the core engine's handler logic (dispatchEvent/dispatchPhase, HandlerContext)
and node traversal (anchor graph, tree.getNode/ancestorsOf/descendantsOf),
can the LEGACY handlers — written against the old query-utils + ClientAPI
surface — be repurposed in the existing engine, and if not, what changes to
the engine, the API layer, or the handler logic are needed?

## The legacy handler surface (old /Preempt)

Handler bodies are function strings `(event, context) => …` bound via
`component: [{target: 'handlers.<event>', reference}]` (defs in
`template.component` as `{name, body}`) or node `handlers`. The bodies use:

| Legacy API | Shape |
| --- | --- |
| `context.node` | the LIVE node — `parent`, `children`, `css`, `data`, `state` |
| `node.findNode(query)` / `findNodes(query)` | NodeQueryUtils over the subtree — `{type, id, classes, props, handlers, style, components}` |
| `node.receiveNextState({type?, content?, props?, css?, children?, handlers?})` | atomic state update (layer push, phase-gated; PLACEMENT changes rejected) |
| `node.targetComponents` / `sourceComponents` | component-binding maps |
| `supervisor.userData` | session payload |
| `fetch` / `window.location` | plain page JS (runtime-only) |

## The current engine's surface

| New API | Shape | Legacy equivalent |
| --- | --- | --- |
| `HandlerContext` | `{clientAPI, supervisor, node?, states?, tree}` | `context` + `context.node` (variant A exists) |
| `clientAPI.apply(nodeRef, {kind: 'state-slice', mutation})` | LayerMutationList: `targetProp: 'type'\|'content'\|'handlers'\|'props.*'\|'css.*'`, mode, value | `receiveNextState({type/content/props/css/handlers})` — **mappable** |
| `tree.getNode / allNodes / ancestorsOf / descendantsOf / getState` | graph traversal | `node.parent`/`children` reads — **mappable** |
| `clientAPI.apply(…structural ops: attach/detach/move/destroy/clone-instance/placement-attach)` | structural mutations | `receiveNextState({children})` — needs a composite (detach+attach per child) |
| — | — | `node.findNode(query)` — **NO query util in the engine** (only id-keyed tree access) |
| — | — | `supervisor.userData` — surfaced at translate (TranslatedTree.userData), NOT on the Supervisor |
| `component-target-gap` for `handlers.*` targets; defs in template.component → K3 `component-binding-empty` (dead) | — | the legacy WIRING (handlers.<event> targets + {name, body} defs) is currently unwired (D6 parked) |

## Options

### Option A — Legacy context adapter (runtime bridge, bodies unchanged)
The dispatch builds a `LegacyHandlerContext` wrapping the new context:
`context.node` → a NodeView proxy exposing `parent/children/css/data/findNode/
findNodes/receiveNextState/targetComponents/sourceComponents` mapped onto
tree + clientAPI; `context.supervisor.userData` passthrough. Engine/API
additions:
1. **QueryUtils** — a `findNode`/`findNodes` equivalent over the anchor graph
   (query keys: type, id, classes, props, style, components — the new node
   surface exposes all of them).
2. **receiveNextState → state-slice mapping** for type/content/props/css/
   handlers (targetProp vocabulary already covers type) — mostly a pure
   mapping in the adapter.
3. **children replacement** — a composite (detach removed + attach added),
   or a new `children-replace` op.
4. **Placement writes** — remain hard-blocked (placement-target-blocked;
   matches the legacy rejection — consistent).
5. The **wiring seam**: `handlers.*` targets plan like the D7 seam targets
   (no gap warn) and the `{name, body}` defs register as handler defs on the
   consumer for the named event.
Cost: adapter (~150-250 lines) + QueryUtils + the wiring seam; zero body
changes; legacy pages keep their handler data verbatim.

### Option B — Wiring seam + data-authoring re-expression (bodies rewritten)
Complete only the D6 wiring seam (handlers.* targets + defs register), then
RE-EXPRESS every legacy body into the new ctx API by hand
(receiveNextState → clientAPI.apply state-slices, findNode → a tree walk or
a new query helper, etc.). Cost: no engine mutation beyond the seam, but
every legacy page's handler logic is a data-authoring task; the bodies' old
API names disappear.

### Option C — Translate-time source transform
A legacy-body → new-API body compiler at translate (receiveNextState(x) →
clientAPI.apply(nodeRef, {kind:'state-slice', mutation:[…]}); findNode(q) →
tree query; context.node.parent → tree lookup). Automates B but is fragile
(arbitrary JS bodies — regex/AST rewriting is error-prone; bodies are
trusted-developer code).

### Option D — Full compat surface (A + userData + runtime wiring)
Option A plus: `supervisor.userData` passthrough (payload metadata/userData
surfaced on the supervisor), and the `handlers.*` target wiring resolved at
COMPILE (not just translate) so event/phase defs attach per compiled state.
Most complete; largest surface.

## Recommendation to review
Option A as the core (bodies repurpose verbatim — the user's framing) with
the D6 wiring seam; treat the QueryUtils as the enabling primitive (it is
independently useful for the engine); decide children-replacement and
userData as scoped follow-ups. Options B/C/D exist as fallbacks/refinements.

## Open questions for the reviewers
1. Is the NodeView proxy acceptable as a compat surface, or should the
   engine expose receiveNextState/findNode natively (Option D)?
2. Type changes via state-slice (targetProp 'type') — verify applySlice
   handles 'type' today; if not, the adapter needs a type-slice extension.
3. children-replacement: composite vs new op — which is the coherent
   contract?
4. The wiring seam's scope: translate-time (D7-style planning) vs
   compile-time resolution — and does it supersede D6's parked status?
5. userData: passthrough vs a formal session-data surface?
6. Do the legacy phase names (afterAssembly/beforeAssembly) need a mapping
   to the new phase set (before-compile/after-compile/after-render), or are
   phase handlers excluded from the reuse (event handlers only)?
