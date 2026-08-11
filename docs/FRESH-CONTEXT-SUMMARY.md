# Preempt-Providence — Fresh-Context Summary

Written from documentation only (no implementation code viewed): `RENDER_PROCESS_NOTES.md`, `docs/specs/*.md`, `docs/skills/designing-pages.md`, `docs/subagents.md`, `README.md`. Purpose: a hand-over summary of what the application does, its design patterns, and a pseudocode render process starting from client load — for review against the actual implementation.

---

## 1. What the application is

Preempt-Providence is a rewrite of the **Preempt** front-end rendering engine. It is a declarative, graph-based component/page renderer: it takes JSON "initial data" (template + content payloads), builds an **anchor graph of `Node`s**, compiles that graph into **compiled state** (with component-binding resolution that can *fork*), and emits **declarative render ops** that an adapter applies to a host (browser DOM, SSR HTML string, or a mock). The pipeline is reactive after first paint: handlers and the client API push *managed updates* through a journaled mutation path, and only the affected subtree re-compiles/re-diffs in place.

The north star of the whole design (notes §10) is **extensibility-first**: adding a node type, prop, or phase should be a one-commit change in one module.

## 2. Feature inventory

### 2.1 Core data model
- **`Node`** — a virtual DOM node holding `base` data (type/content/props/css/handlers) + a **layer stack** (the canon of mutations) + **reconciled anchors** (its graph edges). No `parent` field, no `children` array, no stored `nodeState` — all *derived from the graph* (notes §10.1, Pillar A).
- **`Link`** — the edge class: a collection of `Anchor`s with a `LinkConfig` it enforces (counts, role whitelist, unique order keys). Three canonical shapes: `parent-child` (1 parent + N children), `component` (per-`referenceName` source/target/duplex), `placement` (zone resolution).
- **`Anchor`** — `{ role, target, options, link }`; roles: `parent|child|source|target|duplex|placement|component`; targets: a `Node`, or tokens `'rootNode' | 'component' | 'contentNodes'`, or a referenceName string.
- **`NodeState`** — `prototype | unplaced | in-tree | destroyed`, *derived* per `compile(slice)`, never written. In-tree = chain terminates at `'rootNode'`.
- **Permanent owners** (exactly three, survive sweep): root node, component prototype, `contentNodes` array.

### 2.2 Compilation
- **Two-pass `compile(slice, { focusNodeId? })`**: pass 1 `compileLocal` (sync, node-local — layers → type/props/css/content + anchors), pass 2 `compileRemote` (walks: parent, children order, component/placement borrow). Pass 1 for the whole slice always precedes any pass 2 (no half-remote views).
- **Bounded pass-2**: an atomic update compiles only the changed node's walk path (itself + ancestors + subtree) plus source-bearing nodes — never a whole-tree recompile.
- **Resolution**: own targets first → **depth-0 self-resolution** for a self-providing node (`duplex`/`source`) → walk toward root taking the first `source`/`duplex` match (nearest shadows far) → root as fallback → `unresolved-reference` status (node still renders its own state + warning, S-R4.3) if nothing matches.
- **Forking**: N providers for one name ⇒ N compiled states keyed by `pathKey` (path back to root). Disposition: root-terminated = actionable (all render); prototype/`contentNodes`-terminated = **silent drop**; loop-terminated = drop + `circular-source` warning. A coerced pick is never synthesized.

### 2.3 Mutation & reactivity
- **`ClientAPI.apply(nodeRef, mutation)`** is the *only* mutation surface (S-R3.11). `MutationInput` = `LayerMutationList` (wrapped internally as a `state-slice` op) or a `StructuralOp` (`attach/detach/move/clone-instance/destroy`). Journals through `supervisor.apply`.
- **Journal**: every op is named + replayable (`replay/undo/redo`), event-sourcing style.
- **Gates**: in-tree gating (S1.1 — not-in-tree ⇒ `no-usable-state`, never partial); placement mutation via state-slice hard-blocked (`placement-target-blocked`); single-parent violation (2nd child anchor) ⇒ dedicated `single-parent` error; cycle ⇒ `cycle-detected` + rollback.
- **Dirty propagation**: pass-1 sync in-op; pass-2 deferred to a **render microtask queue** (one microtask per tick, coalesced). Drain order fixed: `deferred-emission → dirty-pass2 → cascade-destroy → event-batch → render-emit`.
- **Slice locking**: per-slice re-entrant lock (Option B), re-entry defers to microtask, recursion-depth cap trips loops, unlock only after final resolution.

### 2.4 Handlers & phases
- **`HandlerDef`** = `{ name, event?|phase?, body }`. Event handlers dispatched by `dispatchEvent(node, ctx, event, ...args)` (match `event` OR `name`); phase handlers by `dispatchPhase` on `before-compile | after-compile | after-render`.
- **`HandlerContext`** = `{ clientAPI, supervisor, tree }` — `clientAPI` is the ONLY mutation channel; throwing bodies are contained.
- **Phase ordering** per apply+flush cycle: `before-compile → op executes → [microtask] pass-2 → after-compile → state-events → after-render`.
- Components may provide a handler as their source value; consumer wires it onto its own handler list (component-provided behavior).

### 2.5 Rendering
- **`RenderAdapter`** — `createEl / setProp / appendChild / hydrate / removeEl`. Client = DOM, SSR = fragment strings; `MockAdapter` for tests.
- **Declarative ops** — `create / set / append / remove / styles`; namespaced `set` names (`prop:*`, `css:*`, `text`, `on:<event>`).
- **`diffMinimal(prev, next)`** — D1–D5 rules: create+set+append new, remove gone, no morphing on type change, **set only for changed names** (in-place updates ⇒ no focus loss), re-append on order change.
- **Two scopes**: root-out deep compile (bootstrap) + node-local minimal-element renders (updates — no full graph walk per update).
- **Bootstrap vs incremental**: one full-depth compile at bootstrap; every later render consumes supervisor's pass-2 states (`takePass2States`) — no render-side compile.

### 2.6 Serialization & SSR
- **New format** = `{ template, content, clientConfig: { adapter, persistence } }` (`preempt-initial-data`). Nodes serialize as `id` + `anchors[]` typed refs; children derived. Handlers are runtime-only (not serialized).
- **`serializeNode/serializeSlice/loadState/reResolve`** — JSON round-trip (`SER-R1`).
- **SSR**: same pipeline + same fork rules with SSR adapter → HTML into mount; client `hydrate` reuses SSR DOM via the `css.id` seam and **re-resolves from serialized anchors** (never trusts shipped forks).
- **Parity**: same input ⇒ structurally equal server/client output (PAR-5).

### 2.7 Legacy translation & payload lifecycle
- **`translateLegacy`**: original `/Preempt` NodeSchema → live graph at the boundary. Root's own children attach in-tree; `template.children` + payload items become **unplaced content nodes** (registered as payload-owned); component/placement/handlers/`run*` gates map to anchors/handlers/`{adapter,persistence}`.
- **`reverseTranslate`**: live graph → backend NodeSchema; reverses placement/component-induced tree state, preserves user edits; `opts.payloads` emits one ContentPayload per group.
- **Payload ops**: `dropPayload / refreshPayload / appendToPayload / nextPriority`. **Origin-aware drops**: payload-owned content persists while unplaced (registration `registerContentNode`); dropping a payload destroys even PLACED content; handler-created nodes discarded once they lose root visibility; explicit destroy unregisters too.

### 2.8 Validation & loop safety
- **Tag schemas** (Pillar E): `registerTagSchema` → content/value validation only. Structural invariants are `LinkConfig`'s job (`LinkConfigError` codes: `unique-order/count-exceeded/count-underflow/role-mismatch`). The two never overlap.
- **Loop safety**: single-parent enforcement, op-time cycle rollback, compile-time `circular-source` arm drop, depth caps (MAX_COMPILE_DEPTH=8), reentrancy guards.

### 2.9 Other
- Dev compile-pass logger (`setCompilePassLogging`, `window.setCompilePassLogging` on the demo).
- `PhaseRegistry` (canon, 11 phases order 0–10: instantiation → targetPlacementResolution → placementAssembly → componentRouting → componentAssembly → slotAssembly → preprocessing → validation → elementCreation → treeAssembly → postprocessing).
- Server (`src/server.ts`): `/health`, `POST /api/apply`, `GET /api/state?node=`, WS `/ws` fanning `EventEnvelope`s.

## 3. Design patterns

| Pattern | Where |
| --- | --- |
| **Graph-derived state, not stored fields** (Pillar A/G) | Parentage, children order, and node state all come from the anchor graph; nothing structural is stored on nodes. |
| **Layer stack as canon** (S-R3.8) | All mutations become layers; anchors are a reconciled materialization of the layers; `compileLocal` reconciles against the stack. |
| **Ops as named, replayable transactions** (Pillar B) | Structural + state ops are journaled, atomic (rejection leaves state byte-identical), undoable. |
| **Two-pass compile with sync-local / deferred-remote** | Pass 1 in-op; pass 2 in a coalesced microtask sweep. Coalescing is the point — no synchronous dirty propagation, no mid-op walks. |
| **Fork-and-drop instead of coerce** | Ambiguous resolution surfaces as multiple valid states; non-actionable arms drop silently or with a warning; the engine never picks. |
| **Declarative ops + minimal diff** | Renderer emits ops; adapter applies them; updates re-diff so existing elements get `set`-only ops (focus retained). |
| **Boundary enforcement split** | `LinkConfig` (structure, throws) vs tag schemas (values, at compile) vs compile outcomes (statuses, not throws). |
| **Single mutation channel** | `ClientAPI.apply` only; handlers/WS/events all funnel through the same journaling supervisor. |
| **Containment of failures** | Per-node worker errors and throwing handler bodies are contained; the pipeline survives. |
| **Registry-owned extensibility** | `PhaseRegistry` is the sole artifact defining order/docs; `LinkConfig` roles whitelist is data; tag schemas are data. |
| **Async cascade destroy with rescue** | Orphans are transient `unplaced`; destruction only fires in the sweep for nodes still ownerless — synchronous re-attach rescues. |

## 4. Render process — pseudocode from client load

```
BROWSER LOAD
  index.html: <div id="app"></div> + <script type="module" src=main>
  + <script id="preempt-initial-data" type="application/json">
      { template: TemplateData, content: ContentPayload[],
        clientConfig: { adapter, persistence } }

main.ts:
  doc  = parse #preempt-initial-data        (or fetch /api/content/:id if absent)
  tree = translateLegacy(doc)               ── if legacy NodeSchema; else loadState(doc)

translateLegacy(doc) → TranslatedTree:
  root   = Node(rootData); root attaches to permanent owner 'rootNode'  → in-tree
  attach root's OWN children (NodeData.children) in array order          → in-tree
  template.children + content payload items → UNPLACED content nodes,
      registered (registerContentNode) → live in TranslatedTree.content   → unplaced
  component binding → target anchor; placement config → placement anchor
  handlers → carried on nodes (runtime-only); run* gates → {adapter,persistence}
  first payload's metadata/userData surfaced on the result

BOOTSTRAP COMPILE  (the one full-depth compile)
  slice = whole tree (root-out deep)
  PASS 1  for node in slice:  compileLocal(node)
            - merge base + layers → type/props/css/content/handlers
            - materialize node.anchors from layers (incl. AnchorLayers)
  PASS 2  for node in slice:  compileRemote(node)
            - parent  = child-anchor → link → parent-anchor → its node
            - children= family-link child anchors sorted by priority
            - bindings= resolve referenceName targets:
                          own source/duplex? → depth-0 self-resolution
                          else walk toward root; first source/duplex wins
                          else unresolved-reference status (render own state + warn)
            - forks   = N candidates for one name → N CompiledState keyed by pathKey
                          root-terminated → actionable (all kept)
                          prototype/contentNodes-terminated → silent drop
                          loop-terminated → drop + circular-source warning
  states  = takePass2States()   (grouped per node, fork arms preserved)

RENDER EMIT  (bootstrap = full op stream)
  minimal = build MinimalElement[] from actionable in-tree states
  ops     = diffMinimal(null, minimal)   → create/set/append(/styles)
  adapter = config.adapter === 'ssr' ? SSRFragmentAdapter : DomAdapter
  adapter.apply(ops):
    createEl(type, wire) → element/fragment
    setProp(wire, name, value) → setAttribute / text / value / addEventListener
    appendChild(owner, child) in compiled order
  DOM case: mount into #app
  SSR  case: string result; client later hydrate(rootWire, vdom)
             + re-resolve from serialized anchors (S4.2)

HYDRATE (client, when SSR HTML shipped)
  hydrate(rootWire, vdom): reuse existing DOM via getElementById(css.id)
                           bind wires/listeners
  client re-runs the SAME pipeline from the serialized anchors — shipped
  fork traces are de-dup hints only; client resolution is canon.

MONITOR  (reactive loop starts)
  state → 'monitoring'

HANDLER / USER UPDATE (after first paint)
  handler → ctx.clientAPI.apply(nodeRef, { targetProp:'props.x', ... })
  ClientAPI.apply:
    validate in-tree (else no-usable-state) + placement-blocked gate
    journal op through supervisor.apply
    PASS 1  compileLocal(node)  sync
    mark remote dependents dirty (children, binding readers)
    schedule one render-microtask (coalesced, 1/tick)
  MICROTASK (drain in fixed order):
    1 deferred-emissions (FIFO, depth-checked, later-tick snapshot)
    2 dirty-pass2   → populate injected anchors, compileRemote over union
    3 cascade-destroy → destroy still-ownerless nodes (rescue by sync attach)
    4 event-batch   → coalesced EventEnvelope (≤1 state event/node/tick)
    5 render-emit   → diffMinimal(prev, next) → set-only ops for existing wires
                     (element identity preserved ⇒ focus retained)
  phase handlers run: before-compile (pre-op) → after-compile (post-pass2,
    pre-events) → after-render (post-flush; destroyed nodes skip)

STRUCTURAL CHANGE (e.g. websocket append / payload refresh)
  appendToPayload(payload, nodes, parent) → register + attach (priorities continue)
  refreshPayload(payload, newRoots, parent) → drop old roots + attach new
  dropPayload(payload) → unregister roots + detach → sweep destroys even PLACED
  same canonical apply/journal/dirty-sweep path

REVERSE (save back to backend)
  reverseTranslate(root, opts):
    template.root + authored in-tree children (excl. content roots) → template
    content roots → ContentPayload items (one per payload group)
    component/placement anchors → component.reference / placement.placementName
    user edits read from LIVE node state
```

## 5. Correctness anchors to verify against code

1. `compile(slice)` two-pass with pass-1-whole-slice-before-pass-2 ordering.
2. Bounded pass-2: node-local updates compile only walk-path + source-bearing nodes.
3. Bootstrap is the *only* full-depth compile; incremental renders consume `takePass2States`, never render-side compile.
4. `diffMinimal` emits set-only ops for changed names on existing wires (no create/remove for live elements).
5. In-tree gating (S1.1) returns `no-usable-state` for non-in-tree applies.
6. Placement via state-slice hard-blocked (`placement-target-blocked`).
7. Single-parent violation → dedicated `single-parent` error (not a LinkConfigError).
8. Fork disposition: prototype/owner-terminated silent, loop `circular-source`, all root-terminated arms render.
9. Unresolved reference → status + warning; node still renders own state (S-R4.3).
10. Handler phase order: before-compile → after-compile → events → after-render.
11. Origin-aware drops: registered content persists while unplaced; dropped payload destroys even placed roots; handler-created nodes discarded.
12. Serialization round-trip equal render-relevant state; handlers never serialized.
13. Client re-resolves after hydrate (S4.2); `css.id` seam reuses SSR DOM.
14. One microtask/tick; fixed drain order; slice locked until final resolution.
