# Preempt — Current Rendering Process Notes

Analysis of the existing front-end in `Projects/Preempt` (`src/` for client code, `server/src/` for SSR), traced from browser load to final painted DOM. Intended as the baseline reference for the Preempt-Providence rewrite.

All paths below reference the **Preempt** repo unless noted.

---

## 1. End-to-end flow (bird's eye)

```
Browser request /content/:id
  -> Traefik -> Express SSR (server/src/routes/ssr.ts)
  -> Content.getWithTemplate() fetches template + payload from Postgres, populates
     components/handlers from DB (server/src/utils/templateUtils|contentUtils)
  -> sends dist/index.html with:
       * <script id="preempt-initial-data">  (template, content, clientConfig JSON)
       * optional SSR-generated HTML (only if server config runInstantiation=true)
  -> browser loads /src/main.ts (Vite module)
       * reads preempt-initial-data OR fetches /api/content/:id
       * new Template(data.template)
       * Supervisor.process(pipelineConfig, template, data.content)
  -> Supervisor runs the 0–10 worker pipeline until queues drain
  -> ClientElementCreationWorker creates/patches HTMLElements
  -> ClientTreeAssemblyWorker mounts+orders them into #app
  -> Supervisor.monitor() -> "monitoring" stage (reactive event loop)
```

---

## 2. Bootstrap — from browser load

### 2.1 `index.html`
- Empty `<div id="app"></div>` mount and `<script type="module" src="/src/main.ts">`.
- Markers injected by SSR (see 2.3): `<!-- HEADERS_INJECT -->`.

### 2.2 SSR (server) — `server/src/routes/ssr.ts`
- Auth via `authenticateToken` (Keycloak JWT), device/theme tags resolved.
- `Content.getWithTemplate()` (`server/src/models/content.ts`) loads the content row, resolves template (tag-aware: device/theme/editor), then:
  - `populateTemplate()` / `populateContent()` inject DB-stored **handler bodies** and **component values** into the JSON payloads as `{ reference, value }` entries (RBAC-level checks may replace bodies with stubs).
- `renderAndSendHtml()`:
  - Serves `dist/index.html`;
  - injects `<script id="preempt-initial-data" type="application/json">` containing `{ template, content, clientConfig }` (this is the client's primary data source — good hydration seam);
  - if DB `server_config` has `runInstantiation=true`, runs the **same Supervisor pipeline** server-side and puts the resulting HTML string inside `<div id="app">` before sending (SSR path);
  - `clientConfig` flips the flags back on for the client (e.g. `runAssembly: !server.runAssembly`) so the client re-runs what SSR skipped.

### 2.3 Client entry — `src/main.ts`
1. `clientAPI.getInitialData()` (`ClientAPI.getInitialData`) parses `#preempt-initial-data`.
   - **If present**: merges `data.clientConfig` into default `PipelineConfig`.
   - **If absent** (dev / static serving): shows a placeholder and fetches `/api/content/1` (+`?tags=dark-mode` if OS prefers dark), expecting `{ template, content }`.
2. Copies globals: `window.Preempt.templateData/contentData/pipelineConfig`, `window.Preempt.Supervisor/WebSocketClient/clientAPI/Template`.
3. `new Template(data.template)` then `await Supervisor.process(config, template, data.content)`.

> Legacy note: `main.ts` passes the raw `template` payload straight to `Template`, while `ssr.ts` wraps it with `{ root: ... }` when absent. Library templates are stored already wrapped in `root`; older `src/mockData.json` uses a bare-node shape. The rewrite must normalize one template envelope.

## 3. Data model

### 3.1 Raw JSON types — `src/types/NodeSchema.ts`
- `NodeData`: fundamental node schema — `type`, `placement`, `component`, `content`, `children`, `props`, `handlers`, `css` (`id/classes/style/cssDef`), `versions`.
- `TemplateData` = `{ root: NodeData, children?, component? }`.
- `ContentPayload` = `{ metadata?, userData?, component?, content: NodeData[] }`.
- `ComponentBinding` = `{ reference, target?, value? }` — the reusable-bindings vocabulary.
- `PlacementConfig` = `{ placementName?, targetPlacement?, activePlacement? }`.
- `HandlerDef` = `{ name, event?|phase?, body }`.

### 3.2 OOP classes (per-node value objects)
- **Node** — virtual DOM node (see §5).
- **Props / Css / StyleNode / Handler / Placement / Component** — small domain objects attached to a Node, each with `clone()/delete()/merge()`.
- **Payload / Template** — containers for ContentPayload and TemplateData; both construct child Nodes.
- **NodeLayer / CompiledState** — layer stack + cached compile result (see §5.2).

### 3.3 Stage vocabulary — `src/types/Pipeline.ts`
`PipelineConfig` gates the whole pipeline: `runInstantiation, runAssembly, runPreprocessing, runValidation, runRendering, runPostprocessing, runMonitoring` (+ `isValidationRun`).

`PipelineStage` strings are the canonical identifiers (see `PhaseRegistry`).

## 4. Orchestrator — `src/core/Supervisor.ts`

### 4.1 Construction (per-process singleton)
- Chooses Client vs SSR rendering pair based on `typeof window === 'undefined' || process.env.IS_SSR_TEST`:
  - SSR → `SSRElementCreationWorker` + `SSRTreeAssemblyWorker`;
  - Client → `ClientElementCreationWorker` + `ClientTreeAssemblyWorker`.
- Holds all workers; sets mount ID, looks up `#app` DOM; attaches it to the root Node.

### 4.2 `Supervisor.process(config, template, content, serverApi?)`
- Creates/updates singleton, `contentData = Set<Payload>` (from `ContentPayload[]`), copies `userData` from first payload.
- Sets `root.css.id = root.props.id = mountElementId` and `rootNode.element = #app`.
- Runs `runPipeline()`; if config says monitoring → `monitor()`, else `close()`.

### 4.3 `runPipeline()` — priority queue drain
- Runs "instantiation" once (nominal — the real Node construction happens in `new Template()`/`new Payload()`, see §6), then fires `afterInstantiate` handlers.
- Loops: scans phases 0→10, picks the **lowest** phase with queued events, locks all lower phases (`Supervisor.lockPhase`), processes its whole queue, restarts scan. Repeats until no worker `hasEvents()`.
- Phase locking (static `activeLockedPhases`) — special rules lock validation/rendering during their own passes, plus "backward chaining" where locking slot assembly (5) also locks componentRouting (3) + componentAssembly (4).

### 4.4 `emitToPhase(caller,node,phase)` / `emitToPhaseName`
- Routes node into a worker's queue; `schedulePipeline()` batches via microtask. If Supervisor doesn't exist yet, emissions buffer in `pendingEmits` and flush after construction (`flushPendingEmits`).
- Nodes are individually queued (decentralized, "atomic message passing") — no monolithic top-down tree walk.

### 4.5 Lifecycle telemetry
- `PipelineObserver`s get `onStageStart/onStageComplete/onError` events.
- `executeHandlers(phase, context)` fires node lifecycle handlers (`before/after*` hooks) on root + content nodes.

## 5. Node internals — `src/core/Node.ts`

### 5.1 Construction / hydration
- Raw `NodeData` → a `Node` with `_data` (immutable) + `_baseCanon`; auto-generates `props.id`/`css.id` (`preempt-node-<hash>`) unless explicit IDs given.
- **Strong hydration seam**: on the client, constructor looks up the DOM element by `css.id` (`document.getElementById`) and reuses it (`node.element`). This is what makes SSR→client hydration cheap — see §9.
- Nodes created with `isInTree=true` and `phase<=validation` emit themselves to Validation early (auto-emit).
- `children`, `handlers`, `component`, `placement` are recursively constructed on birth (when `phase` is 0/99/EMIT_NONE).

### 5.2 Layer stack & lazy compilation
- Every mutation (base schema, placement, components, handlers, `receiveNextState`) becomes a `NodeLayer(targetProp, sourceName, mode('replace'|'append'|'replaceAll'), value, phase)`.
- `addLayer/removeLayer/removeLayersForSource` maintain a per-property map; `compile()` merges layers into a `CompiledState` (used by all getters: `node.type/props/css/content/children/handlers/placement/component`). Cache is invalidated by `invalidateCompileCache()`.
- This is the "idempotent layering" mechanism; the rewrite should generalize it beyond props/css (goal #2).

### 5.3 `receiveNextState(partial)` — atomic updates (the reactivity path)
- Validates against phase/property locks (`Supervisor.isPropertyLocked`), rejects `placement` mutation through this route.
- Merges `props`/`css` via `Props.merge`/`Css.merge`; binds `component`/`handlers` via merge; otherwise sets `data[key]`, computes min target phase via `propertyToPhaseMap`, emits to the computed phase AND always re-emits to validation.
- Locks: props/css are locked after validation; type locked after element creation; used by ClientAPI/WebSockets/handlers.

### 5.4 Cloning / deletion
- `clone()` deep-clones layers + children (cycle-safe), maintaining tree membership rules; used by placements, component injection, snapshots, `Template.clone`.
- `delete()` unregisters placements, deletes children / style / components / handlers, removes DOM.

## 6. Pipeline workers (Phases 0–10)

Phase numbers are resolved via `PhaseRegistry` (`src/core/PhaseRegistry.ts`) — **the registry map is canon**. The JSDoc in the worker files and older docs (e.g. `docs/skills/overview.md`) are stale and should be fixed to match, not the other way around:

| Phase | Stage name (`PipelineStage`) | Worker file |
| ---- | ---- | ---- |
| 0 | `instantiation` | `InstantiationWorker` |
| 1 | `targetPlacementResolution` (alias `placement`) | `TargetPlacementResolverWorker` |
| 2 | `placementAssembly` | `PlacementAssemblyWorker` |
| 3 | `componentRouting` | `ComponentRoutingWorker` |
| 4 | `componentAssembly` | `ComponentAssemblyWorker` |
| 5 | `slotAssembly` | `SlotAssemblyWorker` |
| 6 | `preprocessing` | `PreprocessingWorker` |
| 7 | `validation` | `ValidationWorker` |
| 8 | `elementCreation` | `ClientElementCreationWorker` / `SSRElementCreationWorker` |
| 9 | `treeAssembly` | `ClientTreeAssemblyWorker` / `SSRTreeAssemblyWorker` |
| 10 | `postprocessing` | `PostprocessingWorker` |

Notes:
- **Numeric phase invocation is an anti-pattern.** Phase **names** are the public/API surface (`PipelineStage`, `emitToPhaseName`, `PhaseRegistry.getPhaseNumber`). Numeric IDs are retained only as an internal data implementation to simplify lock-order comparisons (e.g. `componentAssembly (4) < validation (7)`) — callers must never hardcode numbers.
- **Stale docs**: most worker JSDoc / top-level docs describe a phase numbering that does not match `PhaseRegistry`; the registry is canon and those comments should be corrected in the rewrite.
- Workers use `hasEvents()` + `processQueue()`; the queue is a `Set<Node>`. BaseWorker catches per-node errors so a bad handler doesn't kill the pipeline.

### 6.1 Phase 0 — Instantiation (rebuild manager)
The original "construct nodes from JSON" purpose is **obsolete**: constructor event emission (`new Node` → auto-emit) already handles first-pass construction. Phase 0's current intended role is a **rebuild manager** — re-instantiating/regenerating existing nodes when structure changes (e.g. `InstantiationWorker.regenerateNode()` = export JSON → `new Node` → delete old; `Component.delete()` → `receiveNextState({}, 0)`), updating `lastCompletedPhase`. On first load the work happens eagerly in `new Template()`/`new Payload()` which is why it looks vestigial.

### 6.2 Phases 1–2 — Placement (layout composition)
- `Placement` (src/core/Placement.ts) is the dual registry:
  - `Placement.placementMap` — drop-zone providers (`placementName`) → Placements
  - `sourcePlacements` — content requests (`targetPlacement`) → Placements
- `append()` fires: `placementName` → emit host to phase 2; `targetPlacement` → emit host to phase 1.
- Phase 1 (`TargetPlacementResolverWorker`): match content `targetPlacement` against registered drop-zones → set `activePlacement`.
- Phase 2 (`PlacementAssemblyWorker`): for each host placement with a name, look up source placements that matched, then `placement.placeInto(sourceNode)` — **clones** the source content node into the host container, records the clone in `placement._referencingNodes`, stored as a `children` layer under `placement:<slot>`.
- Deletion: `placement.delete()` unregisters from maps and deletes all placed clones.

### 6.3 Phases 3–5 — Components (binding resolution)
- `Component` (src/core/Component.ts) = `{ reference, value, target? }`; instantiation caches prototype nodes in `Component.nodeCache` (singleton host → ref → prototypeNodes).
- `Handler` (src/core/Handler.ts) wraps `{name, event|phase, body}` and compiles `new Function` on body setter.
- Phase 3 (`ComponentRoutingWorker`): reads per-node `WorkerMessage` instructions; routes `createdNew`→ phase 4 if targeting `type`, else phase 5; cascades `updatedSource` to children.
- Phase 4 (`ComponentAssemblyWorker`): resolves `type` components via `resolveValue()+buildLayerMap(phase, 'type')` (structural sub-tree injection); applies layers to host via `addLayer(map)`; emits `updatedSource` events to referencing nodes; guarded against ancestor loops by `Component.isAppliedInAncestors`.
- Phase 5 (`SlotAssemblyWorker`): applies every non-type binding → `buildLayerMap` for `content`/`children`/`handlers`/`props.*`/`css.*`; `afterAssembly` handler fixture.
- **`value` semantics**: if `Component.value` is set, it IS its own source provider; else it searches `sourceComponents` up through the tree to find a definition (`resolveBinding`).

### 6.6 Phase 6 — Preprocessing
Runs lifecycle hooks: `beforePreprocess`/`afterPreprocess` on matching nodes.

### 6.7 Phase 7 — Validation (compiled state + schema)
- `node.compile()` → `CompiledState`; `ValidationWorker.validateNode`:
  - requires `node.type`; checks `Node.REQUIRED_PROPS_MAP` per-tag map (e.g. `<img>` must have `src`/`alt`);
  - validates each `StyleNode` (selector + styles).
- On success: `lastCompletedPhase = 7` and **auto-emits to phase 8** — all in-tree nodes must flow through validation before rendering (nothing bypasses it).
- `isInTree` is recomputed from the parent here.

### 6.8 Phase 8 – Element creation (CLIENT vs SSR)
- **Client `ClientElementCreationWorker`**: creates/reuses the native `HTMLElement` (matches tag name for reuse), applies props via `setAttribute`, css id/classes/style, binds event handlers via `addEventListener` (for `on*`/raw event names), hides empty placement containers (`display:none`), sets text content, and special-cases input value/`Node.globalMetadata`. After the queue drains, `renderStyles()` injects `StyleNode.cssDefs` into `<style id="preempt-dynamic-styles">`.
- **SSR `SSRElementCreationWorker`**: produces an HTML fragment descriptor `{ openTag, closeTag, contentText, isVoid }` from props/css/handlers (event handlers inlined as `on…="…"`), stored on `(node as any).ssrElement`.

### 6.9 Phase 9 – Tree assembly (CLIENT vs SSR)
- **Client `ClientTreeAssemblyWorker`**: `assembleTree(node)` appends/reorders its children into its own `el`, removes stale DOM children, then mounts the node into the parent's element at the correct index (or into `#app` when it's the tree root).
- **SSR `SSRTreeAssemblyWorker`**: final `renderToString(root)` recursion concatenates fragments plus a prefixed `<style>preempt-dynamic-styles</style>`; writes the result into `supervisor.ssrResult`.
- Fires `afterRender` handlers.

### 6.10 Phase 10 – Postprocessing
Runs `before/afterPostprocess` handlers; ends the pipeline when monitoring is off.

## 7. Client reactivity (after first paint)

- `Supervisor.monitor()` → state `'monitoring'`, fires `beforeMonitor`.
- `ClientAPI` (`src/core/ClientAPI.ts`) — exposed to handlers as `context.clientAPI`:
  - **`modifyNode(partial, targetNode)`** → `targetNode.receiveNextState()` → queue → relevant worker → re-render just that subtree (atomic reactivity; no full rerun).
  - **`fetchContent({url,batchLabel,query,placements})`** → fetch → normalize → `Supervisor.injectContent()`.
  - **`addContentNodes(nodes, batchId)`** → payload wrapper → inject.
  - **`fetchHandlers(...)`** → fetches handler bodies from `/api/handlers`, binds to node, re-runs pipeline.
  - **`getHandler(key, node)`** — upward tree search or compiled-handler cache; **`compileHandler(name, body)`** runtime compilation.

- `Supervisor.injectContent(payload)` merges payloads (dedup via `batchLabel`) into `contentData`, then `schedulePipeline()` microtask re-run; existing node placements/replacements are preserved.
- `Supervisor.rerun(config)` — full re-instantiation of the pipeline (Reset flags, `StyleNode.clear()`, `Placement.restoreAll()`, then re-pipeline). Kept as fallback; anti-pattern for standard updates per docs.
- `WebSocketClient` (`src/core/WebSocketClient.ts`) — subscribes topics, auto-reconnect; wire for real-time DB events (not wired up in the demo client folder by the basic app at this point).

## 8. Observations & rewrite-relevant gaps

### 8.1 Specific legacy code instances (anti-patterns to eliminate)

1. **Invoking phases by number** — unsupported and should not remain possible. Only phase *names* (`PipelineStage`) may be used by callers (`emitToPhaseName`, `PhaseRegistry.getPhaseNumber`). Numeric IDs survive only as internal data for lock-order comparisons (e.g. `componentAssembly (4) < validation (7)`). Numeric-phase call sites to audit: `Supervisor.emitToPhase(caller, node, phaseId)` and any literal numeric IDs baked into workers/builders (e.g. `receiveNextState({}, 0)`).

2. **Direct assignment of values onto a Node** — should not be possible, yet JS permits it. Instances to harden:
   - `Object.assign(refNode, nextStatePayload)` in `ComponentAssemblyWorker.processNode` (source-component cascade);
   - `(this as any)[key] = nextState[key]` / `node.data[key] = ...` in `Node.receiveNextState` (immutable `data` getter can be bypassed);
   - `(node as any).ssrElement = ...` in `SSRElementCreationWorker`;
   - `rootNode.css = ...` / `rootNode.props = ...` in `Supervisor.process`.
   All mutations must route through `addLayer()`/`merge()`/`setter` APIs, never raw field writes.

3. **`receiveNextState` inside the pipeline** — primary use case is triggering updates **from handlers and the Client API** (post-pipeline reactivity), not pipeline internals. Instances that currently call it from pipeline/worker contexts: `Component.delete()` → `receiveNextState({}, 0)`, `Placement.delete()` → `receiveNextState({}, 1)`, plus the `Object.assign` cascade above. The rebuild-manager phase (Phase 0) should own these instead.

### 8.2 Confirmed observations (correct as written)

- **Phase model drift** (line 127 fix): the `PhaseRegistry` map is canon; stale docstrings in worker files and `docs/skills/overview.md` must be corrected to match, not the code altered to match them.
- **Template envelope shapes diverge**: library templates use `{root}`, `mockData.json` uses a bare Node shape; unify the Template data contract (this matches the legacy note in §2.3, line 54).
- **Cross-cutting global registries**: `Node.REQUIRED_PROPS_MAP` and `ValidationWorker.validateNode` hardcode per-tag required props; validators are scattered across `Node`, `StyleNode`, and `Component`. Data-driven validation could be abstracted (goal #2).
- **`activeLockedPhases` is global/cross-node state**; a reset or a heavy rerun can interact in surprising ways. Consider per-node or per-cycle locking.
- **SSR vs client parity is config-dependent**: SSR only renders when the DB `server_config.runInstantiation` is set; the client always self-paints from `preempt-initial-data`. For the fresh-env rewrite (goal #1), drop legacy server-only fragments and standardize on one client pipeline with a single renderer interface.

### 8.3 Intentional behaviors (do NOT remove)

- **Phase 0's original purpose is obsolete** (constructor emission replaces it); its *current intended role* is the **rebuild manager** for regenerating/restructuring nodes — preserve this role, don't delete the phase.
- **`receiveNextState` and component layers hard-block `placement` target-zone mutation** as an **anti-looping feature** — placement changes must go through a forward tree rebuild. Keep this safeguard.

### 8.4 Specific implementation pain points (candidates for the architecture rewrite)

1. **Parent-setter auto-update fights layer batching.** `Node.parent` *setter* (`src/core/Node.ts`) performs `newParent.addLayer(new NodeLayer('children', childKey, 'append', [this]))` as a hidden side effect. So a **structural operation** (clone, placement, deep merge) that reparents nodes injects independent `children` layers into the parent's layer stack *outside the batch/operation context*, interleaving with the operation's own layering. This breaks batching assumptions (batches that expect to own their parent-link updates) and makes rolls/merges order-sensitive. Fix direction: parentage via a structured operation/transaction that also updates the parent's children layer in the same batch, never as a setter side effect.

2. **Parentage falsy-signal ambiguity.** Three distinct states share two falsy values:
   - **Component prototype nodes**: `new Node(item, undefined, EMIT_NONE, false)` — `parent === undefined`, not in tree;
   - **Unplaced prototype content nodes**: `new Node(item, undefined, 0)` — `parent === undefined`, not in tree;
   - **Root node**: `new Node(rootData, null, 0, true)` — `parent === null`, **in tree**.
   The code toggles between `if (node.parent)` truthiness, `parent === undefined`, `parent === null`, and `isInTree()` logic (Node.ts constructor + tree-membership detection, Validation "pre-launch"/"launch" checks, Placement processing). Since both falsy values carry distinct meaning (`undefined` = detached/prototype, `null` = in-tree root), truthiness checks produce ambiguous signals and `undefined` is overloaded between "component prototype" and "unplaced content". Fix: a single explicit `nodeState` discriminator (e.g. `'component-prototype' | 'unplaced' | 'in-tree'`) instead of testing `parent` truthiness or comparing to `undefined`.

3. **Clone functions invoked with inconsistent control-argument arities.** Clone signatures have drifted across types and callers:
   - `Node.clone(ignorePropsWildcard, shallowCopyProps, newParent, phase, isComponent, actor)` — full signature;
   - `Component.clone(ignoreProps, newParent, phase, actor)`, `Handler.clone(newParent, phase, actor)`, `Props.clone(ignoreProps, newParent, actor)`, `Css.clone(ignoreProps, node, actor)`, `Payload.clone(ignoreProps, actor)`;
   - `CloneUtils.cloneDomainObject` dispatches by `constructor.name`/arity and calls through with *its own* positional assumptions (e.g. `handler.clone(newParent || undefined, phase)` drops `actor`; `node.clone(ignoreProps, [], newParent, phase, false, actor)` hard-codes the `false`).
   
   Callers and the dispatcher must agree on each type's signature; today outer code frequently omits optional args (e.g. `Component.cloneNode` → `node.clone([], ['element','_referencingNodes'], referencingNode, targetPhase)`), so the same semantic argument lands in different positions depending on call site, and sparse-arg clones produce subtly wrong structures. Fix: a single per-type clone signature (`clone(actor, options)`), with `CloneUtils` built on named options instead of positional arity.

## 9. File reference index (Preempt repo)

| Concern | File |
| --- | --- |
| Browser entry | `src/index.html`, `src/main.ts` |
| SSR server route | `server/src/routes/ssr.ts` |
| Supervisor | `src/core/Supervisor.ts` |
| Workers | `src/core/workers/*.ts` |
| Phase map | `src/core/PhaseRegistry.ts` |
| Node | `src/core/Node.ts`, `NodeLayer.ts`, `CompiledState.ts` |
| Domain objects | `Props.ts`, `Css.ts`, `StyleNode.ts`, `Placement.ts`, `Component.ts`, `Handler.ts`, `Payload.ts`, `Template.ts` |
| Client API | `src/core/ClientAPI.ts` |
| WS | `src/core/WebSocketClient.ts` |
| Types | `src/types/NodeSchema.ts`, `src/types/Pipeline.ts` |
| DB population | `server/src/models/content.ts`, `utils/contentUtils.ts`, `utils/templateUtils.ts` |
| Architecture docs | `docs/rendering_architecture_spec.md`, `docs/skills/overview.md` |
| Test suites | `tests/*` and `server/tests/*` (Vitest) |

## 10. Rewrite architecture proposal (extensibility-first)

North star: **adding a new node type, prop, or phase should be a one-commit change, and adding a new story in the engine must not force edits outside its own module.** The pillars below are each aimed to delete a class of cross-cutting edits from §8/§8.4.

**Reading order** — Pillar G (§10.8) is the bottom substrate: the graph/`Link`/`Anchor` model supersedes the local `parent` field, so read it first; A–F are phrased against it.

### 10.1 Pillar A — Node lifecycle state (derived from the graph, not a stored field)

§8.4 #2's falsy `parent` probes die **twice**: not only is `parent` unambiguous, it is no longer a stored field at all. `NodeState` becomes a *derived* fact of the anchor graph (§10.8), refreshed per `compile(slice)` — never written by hand, never set by ops:

```ts
type NodeState = 'prototype' | 'unplaced' | 'in-tree' | 'destroyed'
```

- `prototype` — the node's `'parent'` anchor terminates (directly or through its chain) at a `'component'` anchor → canonical template spec;
- `unplaced` — no `'parent'`-role anchor chain at all → instantiated but not yet placed;
- `in-tree` — `'parent'`-anchor chain terminates at a `'rootNode'` anchor attached **directly to the supervisor** (root node) → no `parent === null` corner case exists;
- `destroyed` — all its links dissolved (`link.destroy()` / dissolve op); a teardown tombstone.

State **transitions are side effects of graph ops** (§10.2, §10.8), not direct field writes: the "transition map" *is* the set of legal `Link`/`Anchor` mutations, enforced through `LinkConfig`. Validity, placement-eligibility, and "launchable" checks read the single derived state — no value ever requires comparing `parent` truthiness in user code.

### 10.2 Pillar B — Structural operations as graph transactions (replaces setter side effects)

Kill the `parent`-setter's hidden `addLayer('children', …, 'append')` (§8.4 #1) at the root: there is no `parent` setter because there is no `parent` field. All reparenting/placement recursion flows through one graph-op type, executed over `Link`+`Anchor` with `LinkConfig` enforcement (§10.8):

```ts
type StructuralOp =
  | { kind: 'attach'; node; to: Node; zone?: string; priority?: number }    // make/reuse 'parent-child' Link, add child anchor
  | { kind: 'detach'; node; from?: Link }                                    // removeAnchor; a LinkConfigError may escalate to destroy()
  | { kind: 'move'; node; to: { parent: Node; priority?: number } }          // reanchor: same Link or new 'parent-child' Link
  | { kind: 'clone-instance'; source: Prototype; slot: PlacePointer; priority?: number }  // clone subtree + its link family
  | { kind: 'destroy'; node }                                                // dissolve the node's links (§10.8.1 erase semantics)

type MutationOp = StructuralOp | { kind: 'state-slice'; node; mutation: LayerMutationList; actor }
// 'state-slice' (S2.1): the successor to receiveNextState — runs synchronously
// (compileLocal) + queued pass-2, and joins the same replayable journal.
```

- Each op is an ordered list of anchor/link mutations executed against the graph — attaching a child means creating/reusing the parent's side anchor (the family `'parent'` anchor) and adding the child's `'child'` anchor with its `priority` on that same `'parent-child'` `Link` (S-R3.13). Batch bookkeeping = the op list; rejected writes surface as actionable `LinkConfigError`s (§10.8.1), never partial state.
- `Node.parent` is only a **getter** (S-R2.1): reads the ≤1 `'child'` anchor → its `Link` → the Link's `'parent'` anchor → that anchor's node. `children` likewise compiles from the node's own `'parent'` anchor's family Link child priorities, never read from a stored array.
- Ops stay named and replayable (event-sourcing style) → undo/redo for free.

Extensibility win: `Placement`, clone-into-zone, and component instantiation all decompose into `attach`+`clone-instance` on `'parent-child'` Links, and adding a new structure op is a new `kind` + one executor writing anchors.

### 10.3 Pillar C — Uniform worker contract + registry-owned phases

Replace ad-hoc worker/docstring drift (§2.2, §8.2) with a single interface:

```ts
interface PhaseWorker {
  order: number
  emission(node: Node, ctx: PipelineContext): Promise<EmissionResult> | EmissionResult
  afterEach(node: Node, prev: Node, ctx): void
}
```

- `PhaseRegistry` becomes the sole artifact defining order, `name→worker` binding, locking order, and (auto-generated) docs.
- Numerical phase IDs are derived from `order` at runtime, never hard-coded in callers; `emitToPhaseName` is the only entry point.
- Restrict mini commentary ("preprocessing/validation/…") to the registry entry; docstrings in workers no longer need to mirror the map.
- Workers consume **graph-resolved** nodes: each phase run is bounded by the `compile(slice)` entry point that produced it — root-out deep on bootstrap, node-local on event emission (§10.6, §10.8 compile). A worker never re-derives tree membership or order from `parent`; it reads the compiled slice passed in `ctx`.
- **Locking — decided (Option B, per-slice re-entrant, unlock-at-final-resolution)**: roughly the reverse of today's global `activeLockedPhases`. A lock is acquired per slice-root; a nested emission on the already-active chain is **deferred to the microtask queue**; a **recursion-depth cap** (visit set + max depth) is the loop-safety trip that §7's e2e loop probes exercise. **Unlock (S2.3)** is allowed only once the slice has fully resolved — every render emitted (or dropped); nothing mid-processing.

Extensibility win: adding a phase = registering one object. The "map vs docstring" drift class (§8.2) is gone at the root cause.

### 10.4 Pillar D — Options-object clone (kills positional arity)

Replace the disjoint clone signatures (§8.4 #3) with one call shape across all builders — and **copy-by-default**:

```ts
node.clone(actor)                          // copies base state + layers + anchors by default
node.clone(actor, { ignore: ['x'] })       // options are for deviations, not the norm
```

- **Default clone = base + layers + anchor profile (S1.4)**; no options required for the normal path.
- `CloneUtils` keeps a `Map<ConstructorName | RefKind, CloneFn>` (explicit registry, no `constructor.name`/arity probing). `Link`/`Anchor` get their own registered fns, so a deep clone recreates the whole family.
- Cloning derives a fresh `'parent-child'` priority anchor, component `referenceName` role links (source/target/duplex), etc. — **options auto-derive where possible**.
- **`_referencingNodes` removed (S2.2)** — references are anchors; nothing persists the legacy injection registry in clone or elsewhere.

### 10.5 Pillar E — Data-driven validation (replaces hard-coded validator chains)

`Node.REQUIRED_PROPS_MAP` + per-tag `validateNode` chains become *schema data*, resolved by tag at runtime:

```ts
const QRCODE_SCHEMA = {
  required: ['content', 'handlers'],
  validate: { content: v => typeof v === 'string', … },
}
```

- Validators are registered by `Tag` (or `Prop`) in one file; `Node`/`StyleNode`/`Component` no longer hold bespoke validation branches.
- **Structural invariants are *not* validation-Pillar E's job anymore**: parent-child counts, unique `priority`, and role whitelists live under `LinkConfig` enforcement (§10.8.1) at the mutation boundary; Pillar E validates node *content/props/values* against tag schemas. The two never step on each other — E cannot break a link invariant, `LinkConfig` cannot reject a value.
- Adding a new tag type = one schema row (+ optional validator fn). No edits in `Node.ts`, `ValidationWorker`, or the domain classes.

### 10.6 Pillar F — One renderer, declarative render ops

Bridge over the SSR/client divergence (§8.2) with a single `RenderAdapter` interface:

```ts
interface RenderAdapter<P, E> {
  createEl(type: string, wire: NodeRef): P
  setProp(wire, name, val): void
  appendChild(owner, child): void
  hydrate(rootWire, vdom): void
}
```

- Pipeline emits **declarative render ops** (tree diff), and adapters map them to DOM / snapshot / canvas.
- SSR/client use the same pipeline; the only config difference is *which* adapter and whether persistence runs — dropping server-only fragments permanently.
- **Ops are emitted at two scopes**: a **root-out deep compile** (bootstrap/reconcile full tree) and **node-local compiles** for the event-emission path. A handler-caused re-render should re-resolve only the affected node/subtree and emit only the diffed minimal-element ops — no full graph walk per update.
- **State round-trips to the existing JSON schemas (decided)**: compiled node state — including its anchor/link form — serializes back to the current `NodeSchema` shape (`preempt-initial-data`, mock data, SSR brush). The pipeline output is a first-class JSON document, never an in-object proxy; anchors serialize as typed refs (`role` + `target` id/name + `options`), so SSR/full-snapshot and client hydrate consume the same format.

### 10.7 Extensibility "headline" test

A self-serving metric demonstrating success: after the rewrite, each task should be one commit of one file without touching shared modules:

| You want to… | Currently touches | After rewrite |
| --- | --- | --- |
| Add a new phase | PhaseRegistry + a worker + any numeric callers + docstrings | One `PhaseWorker` entry |
| Insert a new worker **in the middle** of a phase set | PhaseRegistry + renumber all downstream workers + numeric callers + docstrings | register the worker in the map between `PreprocessingWorker` and `ValidationWorker` — nobody downstream renumbers |
| Add a new required-prop rule | `REQUIRED_PROPS_MAP` + validators in `Node`/`StyleNode`/`Component` | one schema file |
| Add a new domain object w/ clone | `CloneUtils` arity dispatch + every object's signature | register `clone` in one map |
| Enable a new tree op / reparent | `parent` setter + batch/nodes | one graph-op `kind` + its `LinkConfig` (no local-parent writes anywhere) |
| Rename/document phases | edit docs + code | registry generates docs |

### 10.8 Pillar G — Graph-derived parentage (Link + Anchor, replaces local `parent`)

Strongest form of Pillar B: **store no structural relationship on the node at all**. Parentage is inferred from the graph the node participates in, rather than re-written into every node's local fields.

- `Link` = the edge class (pairs with `Node` and its helper classes), owning a relationship. A `Link` is a **collection of anchors** (not necessarily binary) with **query helpers** and a **`config`** it enforces. Two canonical shapes:
  - `'parent-child'` — **exactly one `parent` anchor + one-to-many `child` anchors** with unique `priority`/`order`;
  - `'component'` / `'placement'` — **source/target tracking maps** (see §10.8.2).
  ```ts
  interface LinkConfig {
    name: 'parent-child' | 'component' | 'placement' | …  // prototype/assembly compose from these
    parent: { count: 1 }            // parent-child only
    children: { min: 1; max: Infinity; orderKey: 'unique' }
    roles: Array<'parent' | 'child' | 'source' | 'target' | 'duplex' | 'placement' | 'component'> // roles this link admits (S-R3.9)
  }
  interface Link {
    id: string
    config: LinkConfig
    anchors: Anchor[]
    anchorsOf(role: Role, target?: AnchorTarget): Anchor[] // find by type / target / options
    parents(): Anchor[]; children(): Anchor[]; sources(): Anchor[]; targets(): Anchor[]
    addAnchor(a: Anchor): void   /* rejects with LinkConfigError if it violates config */
    removeAnchor(a: Anchor): void
    setOrder(a: Anchor, priority: number): void     // rejects on duplicate/range-out
    destroy(): void              /* dispose the link; see retry/erase semantics §10.8.1 */
  }
  class LinkConfigError extends Error {
    code: 'unique-order' | 'count-exceeded' | 'count-underflow' | 'role-mismatch' | …
    linkId: string; config: LinkConfig {Serializer}
    detail: {
      intendedAnchor?: { role; target; options }
      conflicting: Array<Anchor>   // e.g. the anchor(s) already holding the requested order
      currentCell: Array<Anchor>   // full current state for caller inspection
    }
  }
  ```
- `Anchor` = the helper value on a node describing "this node at one end of a `Link`". Anchors **live on-node** as `node.anchors: Anchor[]`, but the **canon is the layer stack** (which may carry `AnchorLayer`s): `compileLocal` reconciles the node's behavior *including its anchors* against the current layer stack, and those reconciled anchors are what any walk reads. No independent write path besides the layers (S-R3.8 confirmed). Each `Anchor` back-references its `Link`. **Role holders (S-R2.1):** `anchorsOf('parent')` returns the anchor that defines *this node AS A PARENT* — a parent holds the single `'parent'` anchor on its family `Link`; each child holds its single `'child'` anchor on that same `Link`. The `node.parent` getter reads the ≤1 `'child'` anchor → its `link` → the link's `parent` anchor → its node. A tree anchor sits on its family `'parent-child'` `Link` (the edge lives on the `Link`, reached via `anchor.link`); its `target` is the resolved owner from the union below — never the `Link` itself (C2):
  ```ts
  type AnchorTarget = Node | 'rootNode' | 'component' | 'contentNodes' | string /* referenceName token (§10.8.2) */
  type Role = 'parent' | 'child' | 'source' | 'target' | 'duplex' | 'placement' | 'component'
  interface AnchorOptions { /* child anchors carry priority/order */ priority?: number; order?: number }
  interface Anchor { role: Role; target: AnchorTarget; options: AnchorOptions; link: Link }
  ```
  **Anchors added by compilation (S-R2.9, S-R3.12 confirmed):** an `AnchorLayer` (a `NodeLayer` carrying anchors) lets a resolving component (e.g. a `'type'` component) add anchors/component-maps to the node. The rule generalizes to **any effect that adds anchors — including a new layer**: added anchors are populated by a **new post-processing step** (the dirty-queued post-op sweep, §10.8.4), never inside the compile pass that created them. The layer is **traceable back to the generating anchor** and removed with it (idempotent).
  **Writes that violate `config` throw the specific `LinkConfigError`** — carrying the failing `code`, the offending `intendedAnchor`, and the `conflicting`/`currentCell` anchors — so callers can react (see §10.8.1).
- A node is a child of `P` iff the graph resolves to: an anchor directly attached to `P` with role `'parent'`, anchoring a `Link` whose `children` includes an anchor with role `'child'` held by that node. The family edge as a single object is established/disestablished atomically (including adding/removing one child anchor) — never two independent field writes on both nodes (this is exactly the §8.4 #1 double-consistency bug, now structurally impossible).
- Ordering of a parent's children is carried by each **child anchor's `priority`/`order` key in `options`** — `config.children.order='unique'` enforces uniqueness; compile sorts by that key across one or more `Link`s to synthesize the `children` layer; never a stored array.
- The three special parentage cases from §8.4 #2 stop smuggling through falsy values:
  - a **prototype's** parent-**link** (its ≤1 `'child'` anchor → its `Link` → the `'parent'` anchor) has the family `'parent'` anchor target `'component'` (attached to the component prototype) → `prototype`;
  - the **root's** parent-**link** has its `'parent'` anchor target `'rootNode'` (**not** a node) → unambiguous `root`;
  - everything with **no `'child'` anchor, or whose parent-link chain terminates at no permanent owner** (the root's chain is fine because it legitimately ends at `'rootNode'` — C1) and not inside a prototype → `unplaced`. No `parent === null` vs `parent === undefined` ambiguity anywhere.
- Components and placements resolve in the same manner — resolution = presence/absence of their anchors/links (`placement` anchor reflects the zone being populated; `component` anchor reflects the aggregation target), as a plain graph query (§10.8.2).
- `Supervisor.compile()` becomes strictly a graph resolution: walk from the supervisor's root anchor outward through links; local state (`in-tree`/`unplaced`/`prototype`, parenting, order) is *derived*, immutable-within-compile, and impossible to desynchronize.
- **Root-out deep compile is one option, not the only one.** A **node-local compile** stays in the model for the event-emission system's cheap minimal-element updates: resolve only the affected node/subtree's slice of the graph (its anchors, links, and the ancestors needed for source/duplex borrow) and emit diffed render ops just for that slice (§10.6) — no full supervisor walk per update. The graph model keeps both viable: the same `compile(slice)` primitive, parameterized by an entry point (root anchor vs. a node's anchors).

### 10.8.1 Rejection → retry / erase semantics

Rejections are **structured and actionable**, never silent:

- **`LinkConfigError` carries verbose data**: `code`, `linkId`, serialized `config`, plus `detail.intendedAnchor`, `detail.conflicting` (the anchors blocking the operation), and `detail.currentCell` (full current anchor set of the link). The caller can read the conflicting order/state and retry without guessing.
- **Retry (e.g. insert child)**: `addAnchor`/`setOrder` throws `code: 'unique-order'` with `conflicting` — caller reads the existing `priority`/`order`, picks a fresh one (e.g. max+1), and retries. Loop-safe and graceful; the failed write left the link untouched.
- **Erase (e.g. remove parent)**: `removeAnchor(parentAnchor)` would drop the parent count to zero → throws `code: 'count-underflow'`. The caller can then call **`link.destroy()`** — a *deliberate* wipe that disposes the whole link and **orphans its child anchors** (their nodes drop to `state: 'unplaced'`). This is the intended "remove parent → destroy link → children orphaned" flow, done in one clean step rather than a sequence of partially-rejected writes.
- **No partial application**: every rejecting method leaves the link in its pre-call state (enforcement is atomic with validation).
- **Orphans are transient; cascade-destroy is async (S-R2.3).** A node that lost its parent-link (its `'child'` anchor dissolved) is left **`unplaced`** — transient, still a valid attach target. Cascade destruction is scheduled **asynchronously** (the post-op microtask sweep) and fires only for nodes that still resolve to **no permanent owner** at sweep time — root node, component prototype, or the `contentNodes` array (S-R2.2). Re-`attach`ing synchronously resolves the tree before the sweep runs and blocks destruction.

### 10.8.2 Component & placement source/target maps

`Link` tracks **component** (and placement) resolution maps via directional anchor roles:

- Roles `'source'`, `'target'`, `'duplex'` joined to anchor targets by `referenceName`: **all components with the same `referenceName` share one `Link`**, each anchoring as either `source`, `target`, or `duplex`.
  - `source` — a component *provides* its resolved value/content;
  - `target` — a component *consumes* a value with that `referenceName` (waits until a source is present);
  - `duplex` — **one anchor carrying BOTH a target and a value** (self-providing consumer; mirrors legacy `Component.isAppliedInAncestors`).
- **Compile-time resolve = populate the node's OWN targets first (S-R2.6).** Compiling a node means: "populate our declared target anchors, using source component providers, using the **value of the first source** we can find." The search base is the node itself — **if the node already carries a source/value anchor for that `referenceName`, it resolves at itself (depth 0), before any walk.** Only unresolved targets then walk **toward the root**, taking the **first** `source`/`duplex` match — nearest shadows far; a root-level component is only used if nothing closer exists. A `target` with no match on the way up → unresolved-reference compile state with a clear code.
- **Placement ≠ component (S-R2.8).** Two distinct behaviors: component resolution = the `source`/`target`/`duplex` maps above; **placement** = a `'placement'`-role anchor on the zone's family `Link`, applied by `attach` and populated by compile — it shares the borrow algorithm but NOT the component role semantics. Legacy `Placement*` is not carried over (S3.6).
- Same invariants apply through `LinkConfig` (`roles` whitelist, `count`); the unresolved-target state above is part of that `config`, not a validation-layer catch.
- **Multiple nodes may share a `referenceName`/`placementName` — the compiler forks.** Every candidate resolution is a separate **compiled state, identified by its path back to the root node**. If a fork-arm's path **does not terminate at the root**, the arm returns **no actionable compiled state** and is dropped, never rendered: **loop-terminated arms log a `circular-source` warning (S-R2.5)**, prototype-terminated arms fail compile silently. Actionable forks render; ambiguous-but-terminating cases therefore surface as *multiple valid states* rather than an arbitrary pick (§10.8.4).

### 10.8.3 Anchor/edge storage summary

| Concept | Living location | Owned by |
| --- | --- | --- |
| `Anchor` | `node.anchors: Anchor[]` (decided) | the node, back-ref to `Link` |
| `Link.anchors` | the link's anchor set | `Link` |
| parent–child | 1 link = 1 parent anchor + ≥1 child | `LinkConfig 'parent-child'` |
| component refs | 1 link per `referenceName` | `LinkConfig 'component'`, roles source/target/duplex |
| placement | resolution link at the zone | `LinkConfig` |

### 10.8.4 Two-phase compile: local state first, remote walks second

`compile()` splits into two strictly-ordered passes so a batch of local mutations lands **before** any walk reads them (no half-remote views):

```ts
compile(slice) {
  // PASS 1 — locally-dependent values, no traversal
  slice.forEach(node => compileLocal(node))   // props/css/content/type from layers +
                                               // node.anchors[] (the anchor array is this
                                               // node's OWN local data, maintained here)
  // PASS 2 — remote-dependent values via walks
  slice.forEach(node => compileRemote(node))  // parent (≤1 'child' anchor → its Link →
                                               // the 'parent' anchor → its node), children
                                               // order (parent's family Link child-anchor
                                               // priorities), component bindings (referenceName
                                               // source/duplex borrow up the chain)
}
```

- **Pass 1 `compileLocal`** reconciles the node against its **own layer stack** (the canon, S-R3.8): prop/css/content/type derived from `NodeLayer`s, and the **anchor array** — anchors are materialized from the layers (which may include `AnchorLayer`s), each anchor carrying role/target/options/link. All inputs are local, so `compileLocal` needs no walk; cost scales with the node's own layers + anchor count.
- **Pass 2 `compileRemote`** performs the walks for values that *depend on other nodes' state*: `parent` (via the parent-role anchor's Link), `children` (aggregate the parent Link's child anchors, ordered by `priority`), and component/placement bindings (walk toward root, borrow encountered `source`/`duplex` `referenceName` values — §10.8.2). It only runs after pass 1 so the anchor arrays it reads are current.
- **Why separate**: a node-local update (`state-slice` from a handler or `ClientAPI.apply`, the `receiveNextState` successor) runs pass 1 on just that node + a *bounded* pass 2 (its ancestor chain for parent/bindings), producing the cheap minimal-element render (§10.6, §10.8 compile bullet). A root-out deep compile runs pass 1 on the whole slice, then pass 2 as one coherent walk. Interleaving would force every node-local update to re-derive remote values on stale anchors.
- **Dirty propagation — post-op, microtask-backed (decided)**: pass 1 runs synchronously inside the structural op; the dependents whose *remote* values changed (A's children, C's parent/bindings) are marked dirty and their **pass 2 is scheduled on the existing render microtask queue**. Synchronous propagation is out — we coalesce: everyone dirtied by a batch request compiles remote in the same sweep, right before the render emit. One microtask per tick; no whole-tree recompile, no mid-op walk.
- **Forked compiled states (§10.8.2)**: pass 2 may branch into multiple compiled states when several sources/placements share a name — each fork is **keyed by its path back to the root node** (`root / a / b …`). Arm disposition: an arm that terminates at a permanent owner other than the root (component prototype, `contentNodes`) or is prototype-tailed **fails silently and contributes no actionable state** (S-R2.5); only a **looped** arm logs a `circular-source` warning. A coerced pick is never synthesized.

Trade-offs to lock down before adoption:
1. **O(1) `parent` access** — **decided**: anchors materialize on the node (`node.anchors: Anchor[]`, one local write per node only when *its own* reconciled anchors change); add a per-parent link index only if hot-path reads need it.
2. **Single-parent invariant — decided**: a tree-participating node carries **≤1 `'child'`-role anchor** (its own in-tree edge, one per node, user-confirmed) and **exactly one `'parent'`-role anchor only when it has ≥1 child** (the family side of its own `'parent-child'` link, S-R2.1); `'component'`/`'placement'` anchors are additional peripheral edges (mirrors today's `_referencingNodes`, `Component.isAppliedInAncestors`).
3. **Migration**: snapshots/mock data and the `parent` getter stay (derived from anchors) while ops migrate to graph ops; the setter is removed so nothing can write contradictory state.
4. `Link` + `Anchor` should participate in the clone/options machinery (§10.4) and schema validation (§10.5) so the graph objects aren't second-class citizens.

| Layer | Renders as `Link/Anchor` | Maps to |
| --- | --- | --- |
| Supervisor | root `'parent'` anchor → `'rootNode'` system target | `rootNode` |
| Component | prototype `parent` anchor → `'component'` | component resolution |
| Node | child/parent link | `children[]` (compiled), `parent` getter |

## 10.9 Reviewer resolutions ledger (Step-3 pass 1)

Per-finding decisions from the reviewer audit; IDs match the emitted list. All
fold INTO the pillars above on the next consistency pass.

| ID | Decision (user-confirmed) |
| --- | --- |
| S1.1 | **Anchor-derived tree is canon.** A compile attempt on a node that is **not in-tree returns no usable compiled state** (not a partial state). `NodeState` = derived, compile-gated; a parentless/node whose chain doesn't reach a permanent owner is not "usable" even if tagged `unplaced`. |
| S1.2 | **Cascade destruction.** A node whose links dissolve **cascade-destroys** every descendant that cannot resolve a path to a permanent owner (the root node, a component prototype, or the `contentNodes` array — S-R2.2). `destroyed` is the terminal outcome of that cascade, not a stored tombstone. |
| S1.3 | **Anchors are on-node, layer-derived (S-R3.8 confirmed).** `node.anchors: Anchor[]` is a reconciled materialization on the node; the **canon is the layer stack** (which may carry `AnchorLayer`s), and `compileLocal` reconciles the node's behavior *including its anchors* against the current layer stack — no independent write path. Anchors are *graph structure*, not an independent state writer; the node's *values* come from its layers. |
| S1.4 | **Clone defaults: copy base, layers, anchors.** `node.clone(actor)` copies base state + layers + anchor profile by default; **options are not needed** for the normal path (auto-derived). |
| S2.1 | **Decided (a)**: `receiveNextState` is absorbed as a **`state-slice` MutationOp** — synchronous compileLocal + deferred pass-2, journaled with the structural ops for replay/undo; handlers/ClientAPI call **`ClientAPI.apply(nodeRef, mutation)`** (the public surface, which journals through `supervisor.apply`, S-R3.11). In-tree gating (S1.1) applies: not-in-tree → no usable state. |
| S2.2 | **`_referencingNodes` removed** — anchors replace it entirely; nothing in Pillar D or §10.8 keeps a shallow-copy naming of the legacy registry. |
| S2.3 | **Unlock only after final resolution.** A consumed slice stays locked through render/processing; `unlock` is only allowed once the slice has fully resolved (all forks emitted/dropped). |
| S3.1 | **Unique per-node IDs** are generated at creation; fork states de-duplicate and serialise via them (no phantom coalescing), plus path-key traces. |
| S3.2 | **priority re-sort = append max+1.** No reindexing by default; collisions throw `unique-order`; explicit `setOrder` retries at max+1. |
| S3.3 | **Link destroys itself and cascades to anchors**; parent/child participants call link destruction. Nodes **cascade-delete** when they can't resolve a path to a permanent owner — the root node, a component prototype, or the `contentNodes` array (S-R2.2; "persistence" removed, S-R3.7). Covers both parent-first and child-first underflow cases. |
| S3.4 | **Compile-time tree traversal loop detection** doubles as op-time guard: `attach`/`move` run the same detector off the destination's parent-chain; a detected cycle rolls the op back (test-and-rollback). |
| S3.5 | **Prototype and loop both fail compile** — both are non-actionable, same outcome; no per-cause warning channel required. **SUPERSEDED by S-R2.5** (S-R3.6): prototype-terminated arms fail silently; loop-terminated arms log `circular-source` — a per-cause channel was added. |
| S3.6 | **Placement is attachment/compile only — no legacy `Placement`.** Legacy placement (parse/config) is not carried over; placement is expressed as `'parent-child'`/`'placement'`-role anchors via attach + compile. `Placement`/`PlacementConfig`/`placement` schema legacy footnotes are removed references for the rewrite. |
| S4.1 | **Depth-0 self-resolution, not a failure.** A node with a `duplex` anchor (both `target` and `value` for the same `referenceName`) resolves **at itself — the search base at its own node — before any upward walk (S-R2.6).** Two same-`referenceName` components splitting target/value resolve by closest-first; same-node pairs resolve at depth 0. |
| S4.2 | **Client re-resolves.** After hydrate the client **re-resolves** from the serialized anchors (re-runs same pipeline) rather than materializing shipped forks blindly. SSR and client run the same resolve-on-anchors pipeline; SSR emits HTML, client re-resolves. |
| S4.3 | **PARKED** — whether the legacy `run*` config gates survive/re-exported is deferred; Pillar F currently says "adapter + persistence flags" only. |

### §10.9 addendum — reviewer round-2 resolutions (S-R2.x)

| ID | Decision (user-confirmed) |
| --- | --- |
| S-R2.1 | **Role-holder convention**: `anchorsOf('parent')` returns "this node **as a parent**" — the single `'parent'` anchor on its family `Link`. `node.parent` getter = ≤1 `'child'` anchor → its `Link` → the Link's `parent` anchor → its node. |
| S-R2.2 | **Permanent owners**: surviving nodes = the root node, a component prototype, or the **`contentNodes`** content array (stores template/content-payload unplaced nodes) — `'contentNodes'` added to `AnchorTarget`. |
| S-R2.3 | **`unplaced` is transient; cascade-destroy is async** (outstanding post-op microtask sweep). Synchronous `attach` before the sweep resolves the tree and prevents destruction. |
| S-R2.5 | **Loop-terminated fork-arms warn** (`circular-source`); prototype-terminated arms fail compile silently. |
| S-R2.6 | **Duplex = one anchor carrying BOTH target and value.** Resolve = populate the node's OWN targets; if the node already has a source for the `referenceName` it resolves at depth 0 (itself) before any upward walk. |
| S-R2.8 | **Placement ≠ component** (distinct behaviors): component = `source`/`target`/`duplex` maps; placement = `'placement'`-role anchor on the zone's family Link via `attach` + compile — sharing the borrow algorithm, not the role semantics. |
| S-R2.9 | **Anchor layers**: an `AnchorLayer` (`NodeLayer` carrying anchors) lets a resolving component (e.g. `'type'`) inject additional anchors/component-maps so a second compile pass populates them — **idempotent** (traceable back to the generating anchor, removed with it). |

### §10.9 addendum — reviewer round-3 resolutions (S-R3.x)

Round-3 found drift from earlier decisions rather than new design gaps. All rows folded into the pillars above on this pass; the three flags originally marked *(interpretive)* (S-R3.8/10/12) are now **user-confirmed** at the next gate.

| ID | Resolution (applied) |
| --- | --- |
| S-R3.1 | §10.2 `node.parent` getter now reads the ≤1 `'child'` anchor → its `Link` → the `'parent'` anchor → its node (S-R2.1). |
| S-R3.2 | `compileRemote` parent derivation starts at the `'child'` anchor, not `anchorsOf('parent')`. |
| S-R3.3 | Fork-arm disposition consolidated (§10.8.4): prototype/`contentNodes`-terminated arms **fail silently**; only looped arms log `circular-source`. |
| S-R3.4 | Single-parent invariant corrected: ≤1 `'child'` anchor per node; exactly one `'parent'` anchor **only when the node has ≥1 child**. |
| S-R3.5 | Special-parentage bullets (§10.8, §10.8.1) reworded to "parent-link / `'child'` anchor" terminology so a leaf node isn't misclassified `unplaced`. |
| S-R3.6 | S3.5 formally **superseded** by S-R2.5. |
| S-R3.7 | Permanent owners collapse to **root node / component prototype / `contentNodes` array**; "persistence" dropped, singular "contentNode" fixed. |
| S-R3.8 | **Confirmed (user): canon is the layer stack.** Anchors live on the node, but the source of truth is the **layer stack** (which can include `AnchorLayer`s). `compileLocal` **reconciles the node's behavior — including its anchors — against the current layer stack**; the on-node `Anchor[]` is reconciled materialization, not an independent write path. |
| S-R3.9 | `LinkConfig.roles` union widened to include `'placement'` / `'component'`. |
| S-R3.10 | **Confirmed (user): correct.** Non-root owner-terminated arms drop silently (`contentNodes` → not-in-tree per S1.1, no actionable state); fork path-keys are only material for actionable, root-terminated forks. |
| S-R3.11 | Canonical entry is `ClientAPI.apply(nodeRef, mutation)`, journaling through `supervisor.apply`. |
| S-R3.12 | **Confirmed (user): correct, and broadened.** Injected/materialized anchors are populated by a **new dirty sweep** — and this holds for **any effect that adds anchors, including a new layer**, not just `AnchorLayer`s. |
| S-R3.13 | `attach` also creates/reuses the addend's family `'parent'` anchor when it has no children yet (satisfies `count: 1`). |

### §10.9 addendum — cross-spec review resolutions (S-R4.x)

Round-4 reviewer compared the 7 parallel-written `docs/specs/*.md` against canon. 5 must-fix + 7 clarify; the mechanical alignments (X.1, X.2, X.3, X.6, X.7, X.9, X.10, X.11, X.12) were folded into the specs directly. The three design calls below are **user-decided**.

| ID | Decision (user-confirmed) |
| --- | --- |
| S-R4.1 | **Placement-target-blocked surface**: synchronous `apply` rejection (`'placement-target-blocked'`) is the canonical **actionable** path — caller reads the conflict and retries (matches §10.8.1 retry/erase). If the op is accepted but a **later compile pass** fails, the emission **also drops** as a default result. Both surfaces exist; the rejection is the actionable one. |
| S-R4.2 | **Single-parent violation**: attaching a node that already holds a `'child'` anchor **fails explicitly and verbosely** — a dedicated error (e.g. `'single-parent'`) at op validation, cross-link; NOT silently treated as `move`, NOT a per-link `count-exceeded`. Caller must `move`/`detach` first. |
| S-R4.3 | **Unresolved-reference disposition**: if the compile still produces a **viable state**, **log a warning and render the node's own state anyway** — the node is not dropped and not hidden; the unresolved binding is simply absent and flagged. |

(TODO: fold Pillar A–G back into docs/skills/overview.md and rendering_architecture_spec.md once the design congeals.)

### §10.9 addendum — adapter-layer review resolutions (S-R5.x)

Round-5 reviewer audited the concrete render-adapter spec (`docs/specs/adapters.md`,
created as the Step-4 gate for `src/core/adapters.ts` / `render-helpers.ts`). 18 findings;
all 18 resolutions below are **user-confirmed**. Folds into Pillar F on the next
consistency pass.

| ID | Decision (user-confirmed) |
| --- | --- |
| S-R5.1 | **Cross-batch set contract**: `set` ops target wires created in this **or a prior** batch; the adapter's persistent `wires`/`fragments` map is the resolution contract (node-local in-place updates never re-create, §10.10.4). |
| S-R5.2 | **forkKey on render ops**: `RenderOp` create/set/remove and `MinimalElement` gain optional `forkKey`; adapters key entries by `wireKey(wire, forkKey)` composite so actionable fork arms stay mounted and addressable (both arms render; no clobber; e2e two-creates assertion kept). `applyOps` forwards the op's forkKey via a structural cast (abstract `RenderAdapter` methods stay forkKey-less; concrete signatures are the authorized superset). |
| S-R5.3 | **Functional hydrate seam**: `css.id` reuse is functional — hydrate validates ids against `mount.querySelector`, marks them reused, and the matched element is targeted (never re-created); legacy §6.8 tag-match reuse is PARKED. |
| S-R5.4 | **`treeSig` sorted keys**: canonical PAR-5 signature stringifies with sorted object keys (stable under set-op arrival order) and includes `forkKey`. |
| S-R5.5 | **`styles` op supersedes demo skip**: `applyOps` invokes `adapter.styles?.(cssDefs)` when exposed; the demo's skip is superseded. |
| S-R5.6 | **cssDef channel**: cssDefs flow through the `styles` op ONLY; `minimalFromState` excludes `css.cssDef` (never a `css:cssDef` set-prop) — no double emission into the single `<style id="preempt-dynamic-styles">` element. |
| S-R5.7 | **undefined-valued set drops**: DOM `removeAttribute`/reset per key; SSR omits the attribute (and removes it from the ordered attr map); `text` undefined → empty. Identical across adapters (parity); `on:<event>` listener-removal is a documented DOM/SSR divergence (PARKED). |
| S-R5.8 | **`FragmentDescriptor` private side-state**: ordered attr map + childrenHtml are private (`SSRFragmentState`); public shape stays `{ openTag, closeTag, contentText, isVoid }`. |
| S-R5.9 | **Root-first emit (R-ORD-8)**: within one emit batch the actionable `next` array is root-first (every node's `create` precedes its descendants'), so the SSR root = first-created wire; root-removed → `toString()` = styles prefix only. |
| S-R5.10 | **applyOps cross-batch probe**: `'wires' in adapter` runtime probe over the `wireKey`-keyed map; adapters without a map skip (same as unknown-wire). |
| S-R5.11 | **TYP-F1 not a vitest unit**: the lib gate is a one-time build/CI check (compile `adapters.ts` under both libs); `CSSStyleSheet` not required. |
| S-R5.12 | **Repo-global `lib: ["ES2022","DOM"]` accepted**; tsconfig change lands with the `adapters.ts` commit. |
| S-R5.13 | **Test env**: replicate + extend the demo-smoke `El` shim (document.head + manual listener dispatch); DOM-F2 (no-document throw) split into a stubbed-global `describe`; devDependency only with Architect gate. |
| S-R5.14 | **NVA-3 scoped to missing wires**; the documented constructor throw (DOM-F2) is not forbidden. |

## 10.10 Feature-completeness decisions (S5 phase) — DECIDED

Feature-gap work closing the original-project parity holes found in the
sanity checks: legacy data schemas, event handlers, phase handlers. Each
carries a `DECIDED:` record; reviewers verify against these + the specs.

### 10.10.1 Legacy schema translation layer (DECIDED)

- **DECIDED:** the rebuild keeps its own anchors-first serialized node shape
  (`id` + `anchors[]` typed refs; children derived, never stored). Original
  `/Preempt` NodeSchema JSON is therefore translated AT THE BOUNDARY, not
  parsed directly: `src/core/translate.ts` maps
  `TemplateData/ContentPayload/NodeData/ComponentBinding/PlacementConfig/
  HandlerDef/run* gates` onto live nodes (component binding → `target`
  anchor, placement config → `placement` anchor, children arrays → parent-
  child anchors in array order, handlers carried on the node, `run*` gates →
  `{adapter,persistence}`).
- **DECIDED:** the root node stores its OWN default children
  (`template.root.children`, attached in-tree via parent-child anchors).
  `template.children` and content-payload items are the **UNPLACED content
  nodes** — translated with NO parent anchor (awaiting placement), returned
  in `TranslatedTree.content`; payload `metadata`/`userData` surface on the
  translated result (first payload wins), not on nodes. Content nodes stay
  dropped from compile (S1.1) until attached into a placement zone.
- **DECIDED:** the translated tree is a normal graph — it compiles, forks,
  and serializes through the existing pipeline; no legacy code path survives
  past translation (PAR-4).

### 10.10.2 Event handlers (DECIDED)

- **DECIDED:** `HandlerDef` gains `event?` and `phase?`; a node's compiled
  `handlers` are dispatched by `dispatchEvent(node, ctx, event, ...args)`
  (event OR name match) and `dispatchPhase(node, ctx, phase)`.
- **DECIDED:** the handler context (`makeHandlerContext(supervisor,
  clientAPI)`) exposes exactly the managed channel `ctx.clientAPI` (apply/
  getState), the supervisor, and tree search: `getNode`, `allNodes`,
  `ancestorsOf`, `descendantsOf`.
- **DECIDED:** handler bodies that throw are CONTAINED — the error is
  returned in the result list, never propagated into compile/render (same
  containment policy as PhaseWorker per-node errors).
- **DECIDED:** a component may provide a phase/event handler as its source
  value; the consumer wires the component-provided handler onto its own
  handler list (component defs carry behavior), and the after-compile phase
  dispatches it once the consumer compiles — e.g. a user-info panel whose
  provider resolves a handler that populates its descendants (welcome text /
  login button) from session state.

### 10.10.3 Phase-based handlers (DECIDED)

- **DECIDED:** three pipeline phases, minimum:
  - `before-compile` — dispatched in `Supervisor.apply` on the op node
    BEFORE the op executes (observes the pre-op state);
  - `after-compile` — dispatched in the pass-2 flush immediately after
    `compile(slice)`, BEFORE any state/diagnostic events are pushed
    ("after compile / before render");
  - `after-render` — dispatched after the tick's events have flushed
    (destroyed nodes skip).
- **DECIDED:** ordering within one apply+flush cycle is strictly
  `before-compile → after-compile → state-event(s) → after-render`;
  `Supervisor.runPhase(phase, nodeId?)` also allows manual dispatch (single
  node or all registered).
- **DECIDED:** the pass-2 (compile + `after-compile` + `after-render`) runs
  regardless of whether an EventBridge is attached — only the event
  push/flush is gated on `events`.

### 10.10.4 S1.1 carve-out — self-providing unplaced nodes (DECIDED)

- **DECIDED:** S1.1 (not-in-tree ⇒ no usable state) is carved out ONLY for
  nodes that self-provide a resolved referenceName (`source`/`duplex`
  anchor): such unplaced content nodes resolve depth-0 (S-R2.6) and yield a
  compiled state. Pure consumers (target-only) stay dropped until placed.
- **DECIDED:** `CompiledState.state` reflects the node's DERIVED state
  (`node.state`), never a hardcoded `'in-tree'` — a self-providing unplaced
  node compiles with `state: 'unplaced'`, keeping the label honest.
- **DECIDED:** pass-2 is BOUNDED (render.md §4): for an atomic update the
  compile slice is the changed node's walk path — itself, its ancestor
  chain, its subtree — plus every source/duplex-bearing node (the fallback
  universe for prototype/owner-terminated arms). Resolution walks are
  graph-based (own → descendants → ancestors), so unrelated nodes are
  neither recompiled nor re-flagged; `compile(slice, { focusNodeId })`
  additionally scopes console warnings to the changed node, so a dangling
  reference elsewhere in the tree is never re-logged by unrelated updates.
- **DECIDED (payload drop semantics, origin-aware):** the root node and the
  content/component arrays are the SOURCES OF TRUTH for graph access.
  Payload-owned nodes are registered (`registerContentNode` in registry.ts);
  while owned, an unplaced or placement-detached content node PERSISTS in the
  background (placement may return) — the sweep skips content nodes. Dropping
  a payload unregisters its roots, so even PLACED content is destroyed with
  it. Handler-created nodes (no payload basis) are discarded once they lose
  root visibility (detach → sweep destroy). An explicit `destroy` op
  unregisters content too, so it finalizes.
- **DECIDED (dev aid):** `src/core/debug.ts` provides a gated
  compile-pass logger (`setCompilePassLogging(true)`, off by default). Each
  `compile(slice)` pass prints one `[compile]` info line with the processed
  node ids + derived states (+ `focus=` when focused), so dirty-node
  isolation is verifiable in the browser console — the demo page enables it
  and exposes `window.setCompilePassLogging` for toggling.
- **DECIDED (incremental render):** the demo's re-render never compiles
  after bootstrap. `Supervisor.takePass2States()` hands the renderer the
  `CompiledState`s pass-2 already produced (grouped per node, fork arms
  preserved; a later dirty node's compile REPLACES the walk-path copy an
  ancestor's pass produced). With the flush awaited, every dirty node's
  compile has resolved — the renderer merges the fresh states into a
  per-node cache and diffs the element set, without a single render-side
  compile. The only full-depth compile is the bootstrap pass; every update
  is a 3–7-node focused pass, each node compiled exactly once. Direct
  payload mutations (append/refresh/drop attach anchors outside the
  supervisor's dirty set) recompile only the changed zone's focused slice
  (`focusedSliceFor`) and prune departed states. (The feature-matrix page
  previously deviated by recompiling the whole graph per update — its TODO
  is now resolved to this contract.)
- **DECIDED (no redundant re-appends, focus guard, ORD-H6):** `diffMinimal`
  emits `append(owner, child)` only when the child's order changed versus the
  previous render (D5) or the child was created/re-created this pass. The old
  "re-append every child in order" behavior made a real DOM detach+re-insert
  every already-attached child on every keystroke — the focused markdown
  editor was physically relocated and blurred even though the element object
  survived (the headless shim's wire-identity check never saw it). Reorders
  still re-append in compiled order; unchanged orders emit no appends.
- **DECIDED (in-place render, focus retention):** updates to a rendered
  element never destroy/replace it — `diffMinimal` emits only `set` ops for
  changed props on existing wires (D4), never `create`/`remove`. The
  markdown editor → display e2e/demo pins this: typing updates the editor
  source and the display's after-compile handler re-parses `**bold**` into
  structured nodes, asserting element-object identity across renders (a
  replaced element would lose focus). Form elements take `text` through
  `.value` (focus-safe), and `on:<event>` bindings forward the real DOM
  event object — the demo maps `domEvent.type` to the `HandlerDef.event`
  name and `domEvent.target.value` to the handler arg (earlier bug: the
  event OBJECT was passed as the event name, so real typing/clicks never
  matched a handler).
- **DECIDED (feature-matrix emission, PAR-5 shared emit):** the feature-matrix
  page and the server builder share ONE emitter (`src/core/render-helpers.ts`
  `emitElements` — canonical home, imported from `dist/core/*`)
  so in-browser render data ≡ server render data. Fork arms are wired
  `<nodeId>#<i>`; a parent whose `childOrder` references a forked node id
  adopts the arm wires (in arm order) so `diffMinimal` attaches every arm.
  Elaboration (feature-matrix-review.md §4.1): a forked node NEVER emits an
  element for its base id `node-X` — only the `<nodeId>#<i>` arms, all leaves.
  The emitter MUST expand a forked-child reference in a parent's `childOrder`
  into the arm wires in arm order; leaving the base id would make `diffMinimal`
  look for a wire that no element creates and silently attach no arm (the
  original "fork arms not rendered" bug). The parent adopts ALL arms as direct
  children (no per-fork wrapper element); adopting exactly ONE arm via a
  `#<i>`-specific reference is NOT supported by the emit layer.
  Parity compares emission minus `on:*` bindings (handler wiring is
  runtime-only, SER-F1). Runtime-created demo nodes (websocket append,
  refreshed article) use explicit wire ids (`rt-*`) — `mintNodeId()` is a
  process-global counter, so in the headless smoke (all demo modules in one
  process) it could collide with seeded serialized wires (uniqueness scope
  verified + documented in node.md §4.1).
- **DECIDED (core applyOps is cross-batch):** `src/core/render-helpers.ts`
  `applyOps` resolves an append's owner/child (and removes) from the
  adapter's persistent `wires` map when not created in the current op batch —
  incremental diffs re-append to elements created in earlier renders, and the
  headless `El` shim mirrors real-DOM move semantics + parent detach on
  `remove()` so dropped payload wires leave the DOM.
- **DECIDED (SSR floating fragments + forkKey, adapters.md §4.6):** actionable
  fork-arm `CompiledState`s carry a distinct `forkKey` (= the arm's materialized
  `pathKey`, S-R3.10) forwarded by `minimalFromState`/`diffMinimal` onto
  `create`/`set`/`remove` ops, so fork arms stay distinct `(wire, forkKey)`
  entries at both adapters (PAR-6) — no last-write-wins clobber, no duplicated
  children. `SSRFragmentAdapter.toString()` additionally serializes created-but-
  never-appended fragments (creation order) after the root subtree, matching
  `DomAdapter`'s mount-top-level surface for the SAME op stream (PAR-5, SSR-F4
  class) — e.g. actionable descendants of consumed providers, or fork arms whose
  parent wire is not actionable. Fully-connected streams are unchanged (FRG-H26).
- **DECIDED (mode-toggle demo page, adapter modes):** `demo/mode-toggle.html`
  serves the SAME feature-matrix document through three adapter modes selected
  by a toggle bar (`?mode=ssr|client|markdown`). **This is a demo-page TEST
  CASE, NOT expected real-world behavior** — no production app switches one
  document between adapters on a single URL; the page is a comparative test
  fixture for the three adapter surfaces. `scripts/mode-toggle-page.mjs`
  (shared by build-demo.mjs static default + serve-demo.mjs per-mode) embeds
  BOTH mode payloads in EVERY build — the FULL html from the real
  `SSRFragmentAdapter` (raw string in a `text/plain` script for inspection +
  a parsed mount) and the RAW markdown editor source — so `?mode=` switching
  works under any static serve; `data-mode` + section `hidden` state control
  which is revealed. All three modes drive the identical shared harness
  `demo/lib/feature-matrix-tests.js` (the feature-matrix page's checks), plus
  mode-specific assertions: SSR verifies root-first full html + every key
  PRESENTATION id (props.id — not node refs) + well-formedness via a
  stack-based `validateHtmlShape` scan mirroring the e2e validator
  (tests/e2e/ssr-html-validity-helpers.ts); markdown verifies the raw source
  is embedded AND the live display re-parsed the (by-then-edited) content,
  then restores the editor to the shipped source so the section's live
  display matches its raw source. Headless coverage: `scripts/demo-smoke.mjs`
  imports `demo/mode-toggle.js?mode=…` as three cache-busted module instances,
  asserting a zero-failure banner per mode. Session defect review + the
  authoring/browser-realism rules derived from it: `docs/session-defect-review.md`,
  folded into `docs/skills/designing-pages.md` §14.
- **DECIDED (fork-stress demo, runtime child-creation stress test):**
  `demo/fork-stress-d{2,4,6,8}.html` stress-tests the forking render system by
  building a binary tree layer by layer, each layer adding exactly 2 children
  per node through one of the four runtime child-creation mechanisms, cycling:
  placement → component values → component link → idempotent handler → repeats
  with different placement/component names. Depth d has layers 1..d−1 (layer k
  has 2^k nodes, total 2^d − 1). The page uses ONLY core (`dist/core/*`) and
  handler code — the serializable part (L1 placement, L2 values, L3 link) is
  shipped in `preempt-initial-data`; the browser module drives runtime layers
  (L4 handler, L5 placement, L6 values, L7 link) via the `attach` op,
  component sources/targets, and idempotent `after-compile` handlers. The
  handler layer is guarded by its layer marker (`stress:handler`): it only
  adds children when no child with that marker exists — the default guard
  against after-assembly loops. Core `emitElements` gained the two component
  binding interpretations this needs: scalar resolved bindings render as
  element content (values layer) and a definition-object binding
  (`{type, children:[{bind,type}]}`) re-types a slice of the consumer's real
  children (prototype-as-child link layer, `childOffset`). Every node renders
  its `stress:layers` chain (depth + tree-back-to-root). Spec:
  `docs/specs/fork-stress.md`; harness checks in `demo/fork-stress.js`.

(TODO: fold Pillar A–G back into docs/skills/overview.md and rendering_architecture_spec.md once the design congeals.)
