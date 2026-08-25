# Designing Webpages with Preempt-Providence

How to design pages using the framework — the mental model, the building
blocks, and every current test use case as documentation of intended
behavior. Keep this file current: after any feature change, update the
relevant section and the coverage matrix; after adding tests, run the suite
and confirm green (see AGENTS.md).

**Moving an existing system from the original `/Preempt` engine?** Read
`docs/migration-guide.md` first — it maps the old worker-phase surface
(`Supervisor.process`, `modifyNode`, `receiveNextState`, `injectContent`, …)
to the Providence API and lists the translate-time data-shape decisions
(D1–D8) to plan for. The demo pages in §12 are worked migration examples
(`demo/legacy-shape.js` is the production-shaped envelope port).

---

## 1. Mental model (5 minutes)

- **A page is a tree of `Node`s.** Each node holds **layers** (its authored
  state: type/content/props/css/handlers) and **anchors** (its graph edges).
- **Parentage is graph-derived, never stored.** A parent–child edge is a
  `Link` shared by two anchors: the child holds a `'child'` anchor, the
  parent holds a `'parent'` anchor on the same link. State (`in-tree`,
  `unplaced`, `prototype`, `destroyed`) is *derived* from walking these
  anchors — never written.
- **Resolution, not wiring.** A node consumes a component by declaring a
  `target` anchor for a reference name; providers declare `source`/`duplex`
  anchors with the same name. The compiler walks the graph
  (own → descendants → ancestors → non-viable fallback), forks when several
  providers match, and produces **compiled states** with `bindings`.
- **Render = compile → diff → ops.** `compile(slice)` yields
  `CompiledState[]`; `diffMinimal(prev, next)` yields declarative ops
  (`create/set/append/remove/styles`); an adapter applies them to a host.
  Updates re-diff: unchanged elements get `set` ops only — never replaced —
  so focus is retained while typing.

## 2. Building a tree

Construct nodes via the public graph API (see `tests/helpers/fixtures.ts`
for the canonical builders — they are the reference usage):

```ts
const root = makeRoot({ type: 'app' })          // chain ends at 'rootNode' ⇒ in-tree
const panel = childOf(root, makeNode({ type: 'section' }), 0)  // priority 0
const badge = childOf(panel, makeNode({ type: 'span', content: 'hi' }), 0)
```

| Pattern | How | Test evidence |
| --- | --- | --- |
| Root | permanent-owner family link to `'rootNode'` | `node.test.ts` P4/T3 |
| Children | `childOf(parent, child, priority)`; array order = priority | `graph.test.ts` G1/G2/G13 |
| Single parent | a second `'child'` anchor throws `SingleParentError` | G12, FS-2, O16 |
| Cycles | attach under a descendant → `CycleError` / `cycle-detected`; actual anchor circles compile to a dropped `loop` arm + `circular-source` warning | G14/G15, FS-5, O2, F18, `e2e/loop-safety` |
| Depth cap | borrow walks deeper than `MAX_COMPILE_DEPTH` (8) drop as `loop` | C9, FS-7, T13, probe 6 |

## 3. Placements & components

- **Placement**: a node declares `placement: { placementName }` in legacy
  data, which mints a **`'container'` anchor** (the producer/drop-zone role,
  P3 §1.1 — renamed from the legacy `'placement'` role) targeting the zone
  name on the shared per-name placement Link. The anchor is a typed ref;
  content payload roots are **contentNodes-owned at translate** (family-
  'in-tree' via the permanent-owner token — P3 §10.ad/F-13 — never "unplaced
  until attached"): the token terminates the compile walk, so they render
  only through a real parent edge or a placement path. The consumer side is
  the `'content'` role (minted per `targetPlacement: string[]` name, ordered
  — P3 §1.1/§1.2); both roles live on the same per-name placement Link
  (`DEFAULT_PLACEMENT.roles = ['container', 'content']`), and neither is
  interchangeable with the component roles. **The legacy `placement` ARRAY
  form is canonical (D1, 2026-08-14 — LANDED)**:
  `placement: [{placementName: 'sidebar'}, {targetPlacement:
  ['adminLinks']}]` maps EVERY entry through the single-entry logic
  (producer + consumer on ONE node, or several consumers, are only
  expressible via the array); the single-object form stays accepted as a
  convenience. An array never silently no-ops — every skipped entry (a
  `#`-name, a duplicate, a non-object entry → `placement-entry-invalid`)
  warns on the K4 channel; `placement: []` is a legal empty list (no warn).
  The §1.3 ancestor veto fires at BOTH phases since 2026-08-14 (DEFECT #3-1
  fixed — child-side family attach + the shared `ancestorConsumesZone`
  predicate, §14.6
  #11).
- **Anchor-layer seam (D7, 2026-08-14 — LANDED)**:
  a consumer carrying
  `component: [{target: 'type' | 'content' | 'children', reference: X}]`
  where X's def resolves (a value-carrying source anchor) materializes the
  def's CHILDREN links + PLACEMENT links onto itself as an **anchor layer**
  at assembly — the parent anchor of each passed child link sits ON THE
  RESOLVED NODE (target = self, marked `options.seam = true`), the consumer's own
  family parent anchor is untouched, and the seam bypasses the single-parent
  gate via a ROLE-SCOPED `addAnchor` exemption for layer-materialized child
   anchors (a def referenced twice gives its children MULTIPLE LEGAL PARENTS
   — intended; family attach ops keep the gate; ops.md §2.7 ALS-4/ALS-5).
   **Delivery shapes (user rulings 2026-08-14):** `target: 'content'` delivers
   the def's TEXT content ONLY (the def's `content` field → the consumer's
   content slot); `target: 'children'` = ORIGINAL NODE DATA AS-IS + PROTOTYPE
   ADDED (B1 clarification — NEVER collapse): the consumer keeps its OWN
   element, its OWN authored text and its OWN authored children UNTOUCHED, and
   the def's ROOT element materializes as an ADDITIONAL seam-wired child AFTER
   the authored children (`div(shell text) > [p(authored), nav.nav-bar >
   [logo, links, auth]]`) carrying the def's type + css (classes + cssDef
   rules); `target: 'type'` = SHELL COLLAPSE — the consumer's element BECOMES
   the def's element (def type + css + content + props — the DEF data is the
   element, DEFECT #25 2026-08-19: a def authored `content` and `props`
   surface on the collapsed element (`text` + the props as attributes, def
   wins over a same-named consumer prop), with the consumer's own scalar
   binding winning over the def content when both exist; the type-target is
   the legacy form of
   the fork-suite values method). The re-expressed placeholderLanding data
   authors subtree wrappers as `target: 'children'` (each wrapper renders as
   its own shell containing the def element). The seam target string persists
   on the anchor options (`options.seam = 'type' | 'content' | 'children'`)
   so assembly distinguishes seam candidates from plain consumers (F17). The
   def's ROOT
  and its children are
  **out-of-tree `'component'`-token prototypes pre-minted at translate**
  (F16 + delivery-shape ruling): they render only when wired in by component
  assembly, never emitted
  by the host node (D8 — the emit-time def-chain is scoped to the fork-stress
  1:1 link method; the seam `type`-target def-fill is the sanctioned
  element-level exception, render.md SED-1).
- **Placement multiplicity is path-multiplicative (P3 §1.2/§2)**: the
  `targetPlacement` array is a preference-ordered request list —
  first-match-with-known-container wins, every zone of the chosen name gets
  an instance, and the compile mints **one path-state per (node,
  path-to-root)** (`pathKey = root/<zone>/<ownerId>/…/<nodeId>`;
  `forkKey = pathKey` on every path-state; identity is pathKey alone — no
  `#<i>` arms). Post-render placement changes go through the dedicated
  **`placement-attach` op** (P3 §3.3) — never a state-slice (hard-blocked),
  never `attach`-with-zone (family-only).
- **Component consumption**: `target` anchor for a reference name.
- **Component provision**: `source`/`duplex` anchor carrying the value.
- **Depth-0 (S-R2.6)**: a node that self-provides a name (`duplex`) resolves
  at itself before any upward walk — never loops (component self-reference).
- **Fork**: N providers for one name ⇒ N compiled states (arms), each keyed
  by its path back to the root; never a coerced pick. **Fork-vs-nearest
  reconciliation (blind-test S3.2 lesson, 2026-08-20):** a fork happens ONLY
  for providers at the SAME nearest matching depth (the walk stops at the
  first provider-bearing depth — R3 nearest-shadows-far); nesting providers
  under each other collapses to ONE arm. Author 2-arm forks with EQUAL-DEPTH
  providers (both descendants of the consumer, or both same-level ancestors).
  api.md §4.2.
- **Walk order**: own → descendants → ancestors → non-viable fallback
  (prototype/contentNodes-owned providers terminate the arm silently).
- **Unresolved**: no provider ⇒ `unresolved-reference` status + logged
  warning; the node still renders its own state (S-R4.3).

| Scenario | Test evidence |
| --- | --- |
| placement anchor materialized + renders | `translate.test.ts` TR-H3, demo T3 (role `'container'`, P3 §1.1) |
| component binding → consumer target anchor / value-bearing SOURCE provider (+ `applyPath` when `target: 'props.<k>'` — K1/K2 self-apply; or `target: 'css.classes'` — the append seam, 2026-08-20); vacuous/duplicate bindings warn on the K4 channel, never throw | TR-H2, `translate.test.ts` K3/K4/K7/K8, `reverse.test.ts` K5/N1 |
| `component` array form: N bindings per node (K7) | TR-H10, `translate.test.ts` K7 |
| fork: N providers, distinct path keys | FRK-H2/F6, T12/T20, demo T6 |
| fork-arm adoption in `childOrder` | **P3 §4.2 (implemented):** path-states' children come from the path-derived `childOrder` — `emitElements` converts the minted node-id children to the CHILD STATES' pathKey wires (trace-indexed lookup); there is no `<nodeId>#<i>` arm convention left in shipped data — the `component-source-duplicate` guard (keep-first, skip-second, warn — P3 §10.ab/§10.ae) removes the arm-generating case, and `#f:` component forks survive only as a documented runtime-anchor carve-out, out of the legacy/path surface entirely |
| duplex self-resolution | FRK-H3, T9, probe 3 |
| prototype-only candidate drops silently | FRK-F1, T14, probe 5 |
| dangling target: unresolved + own state renders | C6/FS-8, T7/T8, probe 4 |

## 4. Two-pass compile

- **Pass 1** (`compileLocal`): synchronous, per-node (layers → type/props/
  css/content/handlers). Runs inside the op.
- **Pass 2** (`compileRemote` / fork resolution): parent/children/bindings
  walks; deferred to the render microtask queue.
- **Bounded pass-2**: an atomic update compiles only the changed node's walk
  path (itself + ancestors + subtree) plus every source-bearing node — the
  fallback universe. Unrelated nodes are neither recompiled nor re-flagged.
- `compile(slice, { focusNodeId })` scopes console warnings to one node.

| Test evidence | `node.test.ts` C1–C9; `pipeline.test.ts` V2/V4/F16; T18; the demo's `[compile]` pass log (dirty-node isolation) |

## 5. Rendering

- **Ops**: `create/set/append/remove/styles`. `set` names are namespaced:
  `prop:*`, `css:*`, `text`, `on:<event>`.
- **Stylesheet rules (D4, 2026-08-14 — LANDED)**:
  a node's `css.cssDef` (legacy
  `StyleNode[]` — `{selector, styles}`) is emitted as REAL stylesheet rules
  via the `styles` op: each def serializes to `{selector}{kebab-case k: v;
  styles}` (nested `styles` values — the media-query form — serialize
  recursively as nested blocks), **deduped by rule signature across the
  whole render** (the same rule never emits twice), and **only rules owned
  by nodes with an ACTIONABLE compiled state** emit (F10 — actionable
  root-terminated states + actionable placement path-states; dropped,
  owner-terminated (`contentNodes`/`'component'`-token), and unplaced arms
  contribute nothing — in-tree is a family fact, not compiled viability).
  **Zero-or-one `styles` op per sweep** (F11): a cssDef-less render emits NO
  styles op — no empty `<style>` block; only renders with ≥1 deduped rule
  produce the single `<style id="preempt-dynamic-styles">` block.
- **Diff rules**: new wire → create+set+append; gone → remove; type change →
  remove+create (no morphing); prop change → set only for changed names;
  childOrder change → re-append.
- **In-place updates / focus retention**: an update to an existing element
  never emits create/remove for it — only `set`. Form elements take `text`
  through `.value`. Identity across renders ⇒ no focus loss (markdown
  editor e2e/demo, T8).
- **No redundant re-appends (focus guard)**: `diffMinimal` re-appends a
  child ONLY when its order changed or it was created this pass. Re-appending
  an unchanged order would, in a real DOM, detach+re-insert the element —
  which blurs a focused editor on every keystroke even though the element
  object survives (ORD-H6).
- **Wires** (`create`/`set`/`append`/`remove`): family states key on the
  node id; **path-states key on their pathKey** (P3 §4.1) — stable across
  renders while the placement topology is unchanged, so element reuse falls
  out of the prevMap diff (steady-state renders are `set`-only) and per-path
  appends carry pathKey owners. The root path-state emits at the
  conventional wire `root`.
- **Bootstrap vs incremental**: one full-depth compile at bootstrap; every
  subsequent render consumes the supervisor's pass-2 compiled states
  (`takePass2States`) — no render-side compile. Direct payload mutations
  (append/refresh/drop) recompile only the changed zone's focused slice
  (`focusedSliceFor`).
- **Exported canonical re-emit loop (2026-08-21 — ssr-synthetic-event.md
  §2.4, user ruling B)**: `renderProducingProcess(actionable, nodeById,
  adapter, prevMap)` — the harness loop promoted to one shared
  implementation: filter actionable states whose nodeById node is destroyed
  or not-in-tree → `emitElements` (default options) → `diffMinimal` →
  `applyOps` → `{ els, ops, prevMap }`. The caller OWNS the per-tree prevMap
  (null on first render — no module-level render state), drains
  `takePass2States` itself, and calls it ON-DEMAND (never dispatches).
- **Opt-in `data-node-id` (2026-08-21 — ssr-synthetic-event.md §4, user
  ruling A2)**: `emitElements(actionable, nodeById, { nodeIdAttribute: true
  })` adds the `data:node-id` op prop to EVERY emitted element (DOM
  `data-node-id` attribute / SSR attribute — element→graph traceability).
  DEFAULT OFF — default renders are byte-identical. Values: the state's
  nodeId for plain/fork-arm/family elements; the REAL node behind a
  def-fill synthetic element (def-root proto id / def-child proto id / the
  consumer's nodeId — the same id `mergeHandlerProps` uses). Both adapters
  route the new `data:<name>` op namespace → `setAttribute('data-<name>')`.
- **Hydrate**: `css.id` seam reuses SSR DOM (SSR-H2).
- **Parity**: same input ⇒ server and client render trees are structurally
  equal (PAR-5, SSR-H1).

| Test evidence | `render.test.ts` SER/FRK/ORD; `e2e/ssr-render`; `e2e/markdown-display`; demo |

## 6. Handlers & phases

- Handlers live on nodes (`handlers: HandlerDef[]`); a component may provide
  a handler as its source value.
- **Event handlers** (`event: 'input'`, `'click'`, …): dispatched by
  `dispatchEvent(node, ctx, event, ...args)`; a DOM binding maps
  `domEvent.type` to the name and `domEvent.target.value` to an arg.
- **Phase handlers** (`phase`): `before-compile` (apply start, pre-op
  state) → `after-compile` (pass-2, before render) → `after-render` (after
  the tick's events flush; destroyed nodes skip). Reentrancy-guarded.
- **HandlerContext**: `ctx.clientAPI` (the ONLY mutation channel — journaled,
  replayable), `ctx.supervisor`, `ctx.tree` (`getNode/allNodes/
  ancestorsOf/descendantsOf/getState`). Throwing bodies are contained.
- **Reading values from a handler**: `ctx.tree.getNode(id)` returns the node;
  its value getters (`type`/`props`/`css`/`content`) read the **compiled
  pass-1 state** (always fresh, node.md §5). Read authored/layered values
  there; write only through `clientAPI.apply`. Pass-2 resolved values
  (component `bindings`, fork arms, `pathKey`) are exposed READ-ONLY through
  `ctx.tree.getState(id)` (non-draining — `supervisor.getResolvedStates`,
  never consumes the renderer snapshot) and `node.resolved` (read-only
  getter populated by pass-2; `supervisor.recordResolved` seeds it after a
  direct bootstrap compile). Contract: handlers.md §2.1; tests:
  `tests/integration/resolved-exposure.test.ts` (Workstream B).
  Reference: `feature-matrix.js` `render-markdown` reads
  `getNode(md-editor).content ?? .props.value` then applies the parsed parts.
- The user pane (demo T7) is the reference: an after-compile handler
  populates descendants from session state; login/logout buttons push
  managed updates.

| Test evidence | `handlers.test.ts`, `phases.test.ts`, `handlers-flow.test.ts`, `e2e/component-handler`, demo T7 |

## 7. Managed updates

`ClientAPI.apply(nodeRef, mutation)` → `Supervisor.apply` → **journal**
(applied ops only, `journalId`), `replay/undo/redo`, pass-2 events
(state/structure/diagnostic, coalesced per tick), placement writes
hard-blocked (`placement-target-blocked`), structural ops return `dirtied`.

| Test evidence | `api.test.ts` T1–T25; `supervisor.test.ts` O13–O18 |

## 8. Data & serialization

- **New format** (`preempt-initial-data`): `{ template, content,
  clientConfig: { adapter, persistence } }`. Nodes serialize with
  `id` + `anchors[]` (typed refs, `parent` ref on child anchors); children
  are derived, never stored. Handlers (function bodies) are runtime-only.
- **Load** (REQ-GAP-9, 2026-08-22 — the corrected 4-step reseed recipe,
  `docs/specs/serialize.md` §3): `loadState(doc)` → `NodeBaseData[]` is
  **snapshot/restore ONLY**. A host reseeding a doc into a live graph uses
  ONE `createLinkHub()` instance (exported from `src/core/translate.js` + the
  `src/index.ts` barrel — same-name component/placement anchors share ONE
  Link): (1) `loadState(doc)`; (2) `new Node(d, hub)` per seed — the
  **template/root FIRST, content after** (the seed's child-anchor `parent`
  refs resolve at construction; the constructor routes placement/component
  role anchors through the hub); (3) `reconcileParentTargets(nodes)`
  (child anchors are per-node fresh links at seed — this reassigns them to
  the shared family links); (4) `supervisor.registerNode(node)` per node
  (the module registry fires in the constructor, the supervisor's `this.nodes`
  does NOT — skipping step 4 means nodes render but never appear in
  `supervisor.getNode`/`allNodes`/pass-2). The supervisor-hub and the
  node-hub are ONE hub: the same `createLinkHub()` instance must go to the
  seeds AND `new Supervisor({ hub, events })` — a forgotten hub makes every
  pass-2 slice an O(n) provider sweep. **Caveats:** link ids do NOT round-trip
  (the seed path mints fresh links — never key host state off a serialized
  link id); a **component-bearing doc goes through `translateLegacy(doc,
  { hub })`** — reseeded graphs are def-less/rows-less by construction
  (`rows-mint` on a reseeded graph throws `rows-prototype-unresolved`,
  documented behavior); handlers stay runtime-only (bodies re-supplied by
  name — the layer seam, §6).
- **Legacy in** (`translateLegacy`): original backend NodeSchema → live
  graph. Root's own children attach; `template.children` + content payloads
  become **contentNodes-owned content roots** (each receives the
  `contentNodes` permanent-owner parent anchor at translate — family-
  'in-tree', P3 §10.ad/F-13; the token terminates the compile walk);
  placement config maps to `container` anchors (`placementName`) + ordered
  `content` anchors (`targetPlacement: string[]`) — **the legacy `placement`
  ARRAY form is canonical: every entry maps through the single-entry logic
  (D1)**; component/handlers map to anchors/handlers; `run*` gates →
  adapter/persistence. **Live-prod legacy-shape rules (2026-08-14, D1–D8 —
  LANDED):** an EMPTY PLACEMENT-OWNER container
  (container-role anchor, zero children at render time) emits `display: none`
  (EMPTY-OWNER-1 — render.md §3.4.3; IMPLEMENTED 2026-08-14 — an empty
  drop-zone must not clutter the page, e.g. the modal overlay graying out the
  page while its zone is empty; REFINED the same day: hidden ONLY when the
  container has no renderable information — authored text or authored inline
  css.style — so styled empty containers like the path-fork/fork-stress tree
  leaves still render; an authored display wins, EMPTY-OWNER-2):
  `doc.content` is ARRAY-ONLY — ANY non-array shape (the obsolete
  single-payload object `{content, metadata}`, a string, null, number)
  warns `payload-shape-obsolete` and is skipped, never silently dropped
  (D2/F5); `css.style` OBJECTS are serialized at translate to kebab-case
  `k: v;` CSS strings (D3); `nodeData.content` is
  TEXT ONLY — the legacy dual-parse (content as NodeData ⇒ children) is
  discontinued and must not be reimplemented, and a non-array `children`
  warns `children-shape-invalid` + is skipped (D5/F14). K1–K8 kernel: legacy
  `component.target` is the LOCAL `props.<key>` apply path (never a second
  name) — the anchor keeps `options.applyPath` and the node gains a
  synthesized `bindings.*` derived read (self-provider ⇒ own value);
  `component` accepts a binding ARRAY (K7); vacuous/duplicate/gap bindings
  and unknown handler phases/bodies land on the additive `warnings` channel
  (`translate.md` §2.1 guard list) — warn+skip, never throw (TR-F2).
  `target: 'type' | 'content' | 'children'` bindings are planned as the D7
  anchor-layer seam (no gap warn; the seam target persists as
  `options.seam = 'type' | 'content' | 'children'`, F17): **`content`
  delivers the def's TEXT only, `children`/`type` deliver subtree links
  (F13)** — the re-expressed placeholderLanding data authors subtree
  wrappers as `target: 'children'`; def children are OUT-OF-TREE
  `'component'`-token prototypes PRE-MINTED at translate (F16), never
  emitted by the host (D8).
- **Reverse out** (`reverseTranslate`): live graph → backend NodeSchema.
  Reverses component/placement-induced tree state, keeps user edits.
  `opts.payloads` emits each payload as its own ContentPayload; the
  envelope ALWAYS emits `content` as an ARRAY (never the obsolete object
  form, D2); serialized `css.style` strings ALWAYS parse back to the
  `Record<string,string>` object — no provenance (F7: string-authored
  styles become objects on save; the legacy format is object-native,
  accepted); placement reverses as ONE flat object per node (merged;
  `targetPlacement: string[]` mint order; the array form only for
  multi-producer nodes, F2); seam-wired def children are NOT emitted as the
  consumer's `data.children` (they stay in the def's JSON home, F20).
  **Handlers (2026-08-21):** runtime `handlers` slice writes REQUIRE
  FUNCTION bodies (string bodies are stored verbatim and skipped at
  dispatch — H-H3; the translate boundary is the only string-instantiation
  site); a handlers-CLEAR (`value: []`) REVERSES as one — the base is
  suppressed and only the post-clear additions emit (`handlers: []` when
  none), so the DEFECT #27 self-detach pattern survives a reverse →
  re-translate round-trip (decisions.md REVERSE-OF-CLEAR row).
  K5/N1 (reverse
  unit): the legacy `target` field round-trips the anchor apply path
  (`{reference, target}` consumer / `{reference, value, target}` provider —
  emitted ONLY when `options.applyPath` exists); the translate-synthesized
  derived keys (`bindings.*` machinery) are stripped on reverse (authored
  derived stays); a runtime name-target next to a provider anchor is
  legacy-unexpressible and dropped (never a two-name duplex). **P3 §6.2
  (implemented):** `content` anchors reverse as `targetPlacement: string[]`
  in MINT order + the derived `activePlacement: string`; the minted
  `contentNodes` anchor is STRIPPED on reverse (round-trips re-mint
  cleanly).
- **Payload lifecycle** (`src/core/payload.ts`): content payloads can be
  dropped (`dropPayload`), refreshed (`refreshPayload`), and appended to
  (`appendToPayload` — websocket comments; priorities continue via
  `nextPriority`). **Drop semantics are origin-aware**: the root node and the
  content/component arrays are the SOURCES OF TRUTH for graph access.
  - **Runtime-created demo nodes use explicit `rt-*` wire ids**: `mintNodeId()`
    is a counter unique per module instance but it is not scanned against
    loaded (seeded) ids — in the headless smoke all demo modules share one
    process, so a runtime mint can collide with a seeded `node-N` wire. Scope
    verified: node.md §4.1.
  - Payload-owned content (registered via `registerContentNode`, done by
    `translateLegacy` and the payload ops) **persists in the background while
    unplaced** — placement may become available again; it survives even a
    placement removal that detaches it from the tree.
  - Dropping a payload **unregisters its roots and detaches them, so even
    PLACED content is destroyed** — the payload no longer owns it.
  - Handler-created nodes (no basis in root/payload arrays) are **discarded
    once they lose root visibility** (detach → sweep destroy).
  - An explicit `destroy` op also unregisters content, so it finalizes.
  - **Teardown-to-root is ONE `destroy` op on the tree owner (REQ-GAP-12,
    2026-08-22 — ops.md §2.5):** an explicit destroy is cascade-capable — the
    sweep destroys the owner's EXPLICIT family children, including
    payload-owned content children (unregistered per child). EXEMPTIONS stay
    intact: placement-owned children (`content`-role anchors — placement may
    return) and `'component'`-token prototype children (def/seam prototypes)
    survive an owner destroy; `runtimeMinted` children are retention-marked
    (walk slots stable). Pre-flag hosts / placement-owned subtrees keep the
    per-child `destroy` loop. Non-destroy paths are unchanged: detached
    payload content still persists (placement may return).
  - Edits on one payload survive refresh/append of another; `reverseTranslate`
    carries the live state back.

| Test evidence | `payload.test.ts`, `reverse.test.ts`, `payload-flow.test.ts`, `e2e/payload-refresh` |

## 9. Loop safety (what never hangs)

Single-parent enforcement, op-time cycle rejection with rollback, actual
anchor circles compile to dropped `loop` arms, borrow depth caps, and the
reentrancy guard on phase dispatch. See §2 table + `e2e/loop-safety`.

## 10. Validation

Tag schemas (`registerTagSchema`) validate content-scope only; structural
violations surface as `LinkConfigError` (unique-order/count-exceeded/
count-underflow/role-mismatch), never via schemas. Compile outcomes
(unresolved/circular) are statuses, not throws.

| Test evidence | `validation.test.ts` Pillar E + LinkConfigError catalog |

## 11. Test-use-case coverage matrix

| Test file | Documents |
| --- | --- |
| `tests/unit/multi-graph-isolation.test.ts` | **MULTI-GRAPH / REGISTRY ISOLATION (2026-08-25 — docs/specs/multi-graph-isolation-spec.md D1-D8 + -review.md; decisions.md MULTI-GRAPH-ISOLATION row, LANDED):** the OPT-IN per-graph scope. **D2 (security-critical):** a handler def registered in graph A's isolated scope is NEVER resolved from an isolated graph B (`handlerDef('ghost', scopeB) → undefined`), and never visible in the shared default — resolution + compilation are scope-local. **D3:** two isolated graphs with the SAME node id never address each other (`resolveNodeRef(id, scope)` returns only the scope's own node; an isolated node never leaks into another scope's `registered`/`byId`). **D4:** `setTranslateUserData`/`getTranslateUserData` are per-scope (graph A's userData invisible in graph B + the shared default). **D5:** a graph-A `removeLayer(layerId)` on a shared layerId/node-id never cross-destroys graph-B's minted set (the plain layer-apply teardown is scope-guarded). **D6:** a destroy in graph A never finalizes/evicts graph B's same-id node (ONE sweep timer, per-scope partition). **D8 (regression gate):** `DEFAULT_SCOPE` IS the module singleton (`DEFAULT_SCOPE.registered === registered`), an unopt host shares one `byId`/`registered` across graphs exactly as today — the non-breaking default |
| `tests/unit/destroy-cascade.test.ts` | **REQ-GAP-12 — the destroy-cascade trigger flag: teardown-to-root in ONE destroy op (2026-08-22 — handoffs-review-2 §REQ-GAP-12 + user ruling 1 (2026-08-21); decisions.md REQ-GAP-12 row):** the explicit destroy op marks the destroy cascade-capable (internal flag — never an op payload, journal shape unchanged/replay-safe); the sweep's `finalizeDestroyed` then relaxes the payload-content exemption for the destroyed node's EXPLICIT (family parent-child) children. Pins: (1) a payload tree (family children under a tree owner, `registerContentNode`'d — the appendToPayload pattern) tears down with ONE destroy op on the owner — every explicit content child destroyed, unregistered from `contentNodes`, whole subtree evicted (REQ-GAP-11 integration); (2) the cascade recurses through destroyed content children (grandchildren destroyed; placement-owned grandchildren skipped); (3) placement-owned children (`content`-role anchors) SURVIVE an owner destroy — still payload-owned, placement-may-return letter intact; (4) `'component'`-token prototype children survive an owner destroy — a destroy of a prototype-rooted node (the def-root pattern: `'component'`-token-terminated owner with family children) leaves its whole family subtree untouched (the token edge dissolves before the sweep, so the op captures the prototype-rooted status at op time); (5) the retention split: runtimeMinted children are `markDestroyed` by the cascade — walk slots stable (the destroyed owner still lists them in the family walk, `parent` edge kept), never dissolved; (6) the journal entry shape is UNCHANGED (no cascade marker in the op payload); (7) the relaxation is destroy-op-SCOPED — a DETACHED (orphaned) payload root's content children still persist (the content exemption is untouched on non-destroy paths) |
| `tests/unit/sweep-eviction.test.ts` | **REQ-GAP-11 — the self-evicting sweep (2026-08-22 — handoffs-review-2 §REQ-GAP-11 + the 2026-08-21 amendment; decisions.md REQ-GAP-11 row):** destroyed nodes stop accumulating in the module-level registry (`registered`/`byId`) and the per-supervisor maps (`this.nodes` → `allNodes()`), so long-lived hosts see the live-tree baseline after teardown. Pins: (1) destroy N plain family nodes → the op evicts each target synchronously + the sweep's `finalizeDestroyed` evicts cascade-finalized descendants — `registered`/`allNodes()` return to baseline, `resolveNodeRef` drops the ids; (2) destroy a parent with family descendants → the whole doomed subtree leaves `registered`/`this.nodes` (finalize-time eviction via the `onNodeFinalized` hook — NEVER op-time, so the F17 destroy→re-attach rescue race keeps the rescued child registered + resolvable through the managed channel); (3) destroy N runtimeMinted clone-instance nodes → evicted on the `markDestroyed` branch (no `markPending`, never reaches finalize) AND the retention half holds — the family walk keeps every `children[i]` position + `parent` edge, and `getNode(id)` still resolves the destroyed node (the private destroyed-ref tombstone — stale ids gate `no-usable-state`/`'destroyed'` per api.md T4, never `unknown-node`); (4) a content-owned node destroyed explicitly leaves `contentNodes`; (5) two supervisors in one process — A's eviction never touches B's nodes (B's ids stay resolvable, B's graph applies normally); (6) in-tree/prototype nodes are NEVER evicted (permanent-owner gate); (7) the T4 no-usable-state contract on destroyed ids survives the eviction |
| `tests/unit/keyed-batch-reuse.test.ts` | **FEATURE 1b — KEYED BATCH-REUSE (2026-08-24 — handoffs-review-6.md PROCEED-AS-RESHAPED, decisions.md KEYED-BATCH-REUSE row, LANDED):** the declared `keyField` carrier on `rows-mint` + `batches[name]` (R1 — op writes it to the record; serialize → loadState round-trips it; a post-restore keyed UPDATE reuses the re-minted nodes); the D13 schema boundary (a non-string/empty record keyField → NodeSchema-shape-mismatch); D1 reuse identity (R3 — same keys + updated values → SAME node ids, values updated, no accumulation); D2 whole-op degrade (R4 — a key-less row / op-keyField-prototype-zone mismatch → plain replace, record WITHOUT keyField); D3 reserved keyField (R5 — `batch-keyfield-invalid` warn + degrade); D1/D6 value identity + key change (R6 — changed key → remove-missing + mint-new, reused keys keep ids); D4 prune semantics (R7 — a dropped field removes the source anchor; shape-field difference warns `rows-reuse-shape-ignored`, shape frozen); D5 duplicate keys (R8 — `duplicate-identifier` warn + keep-first); D1/D11 deep-equality no-op (R9 — identical rows: no anchor rewrite, no consumer marks, replay converges); D10/D11 consumer walk / silent-abort (R10 — ONE changed row dirties only its field-name consumers; result reports minted/reused/removed); D8 keyed undo (R11 — pre-op record + reused values restored, mint-new destroyed, removed rows re-minted, redo re-applies); R12 first-mint keyed undo → payload teardown; D9 replay-then-undo (R13 — the preRecord survives the refresh); 1b.11 no-promotion (R14 — reused nodes stay origin-owned); D7 keyed `rows: []` CLEAR (R15); D1/D6 placement-kind reuse (R16 — same zone reuses, changed zone degrades); D14 linear-tripwire regression (R17 — the fan-out census holds after a keyed update) |
| `tests/unit/markdown-adapter.test.ts` | **FEATURE 2 — MARKDOWN ADAPTER (2026-08-24 — handoffs-review-7.md PROCEED-AS-RESHAPED, decisions.md MARKDOWN-ADAPTER row, LANDED):** the text-only render adapter in the SSR family (M1 headings h1-6→#; M2 emphasis strong/em→** /*, css:* DROPPED; M3 lists ul→'- ', ol→sibling '1. ', 2-space nesting; M4 links [text](href)/[text](href "title")/bare-without-href; M5 on:* + data:* dropped; M6 div/span/section transparent containers; M7 blockquote/code/pre/hr/br/img markers; M8 content-metacharacter escaping, markers unescaped; M9 removeEl detach + appendChild splice-by-identity reorder; M10 empty→''; M11 set-only re-render folds onto the retained tree; M12 hydrate no-op, no styles, fragments sole source). **D14 DEMO + BLIND-TEST COMPLETE** (markdown-adapter-scenarios 7 checks M1-M7; MD-BLIND-TEST-TEXT fix: `text` type→inline classification) |
| `tests/unit/journal-condensing.test.ts` | **FEATURE 3 — JOURNAL CONDENSING (2026-08-25 — handoffs-review-8.md PROCEED-AS-RESHAPED D1-D10, decisions.md JOURNAL-CONDENSING row, LANDED):** the bounded-journal shape for long-lived hosts. C1 trigger (ruling 17 — a `maxJournalLength?` init; absent = never; replay/redo never trigger); C2 base-marker shape (D6 — `{kind:'base', snapshot, result:{status:'base'}}`, undoStack truncates to post-base, redoStack clears, never undo-able); C3 replay-from-base (state — SER-R1 render-relevant equality); C4 hook values survive via `anchor.value` (D1 merged-only restore); C5 rows re-mint per the batches record (D8 — fresh ids, count+values equal); C6 defs re-register per the census (D8); C7 undo-after-replay-from-base (D3 — id-resolves the post-base inverse to the restored graph); C8 base-boundary undo guard (ruling 19 — `base-boundary` warn + fail, never silent/partial); C9 graph-REPLACE eviction (D4 — pre-base nodes evicted, the sweep does not compile zombie state); C10 condense failure containment (D5 — a function-bearing anchor → `condense-aborted`, journal untouched, later clean condense succeeds); C11 size guard (D5 — `condense-skipped-size`, no rewrite); C12 no hot-path latency (deferred microtask condense); C13 requestId/takePass2 non-interference (ruling 21); C14 replay-loop uniformity (the base never reaches apply(); post-base entries re-apply with their gates). **ADVERSARIAL fix round (2026-08-25):** ADV-S11/S19 (replay/redo id-resolve `op.target`), ADV-S4 (replay clears redoStack), ADV-S5 (quiet restore re-mint), ADV-S12 (graph-filtered condense protoSet), ADV-S20 (clone-instance loss documented). **D14 demo arm BUILT (journal-condensing-scenarios, 4 checks); blind-test loop COMPLETE (2026-08-25 — writer → proofreader → page-reviewer; 4/4 checks PASS, no engine defects)** |
| `tests/unit/preserve-reversal.test.ts` | **FEATURE 4 — PRESERVE-BY-REVERSAL (2026-08-25 — handoffs-review-9.md PROCEED-AS-RESHAPED D1-D8, decisions.md PRESERVE-BY-REVERSAL row, LANDED):** the reverse-time projection for origin-owned nodes. P1 flag read (D1 — a layer-apply with `preserveByReversal:true` → its origin-owned nodes reverse as authored edits; absent → excluded); P2 whole-subtree cascade (D2, ruling 26 — a preserved node's minted descendants reverse too); P3 compression (Feature 4.25 — ordinary authored data, no layer machinery, no flag residue); P4 re-translate re-mint (ruling 24 — fresh authored node, no layer tie); P5 handlers-CLEAR guard (D6 — the CLEARED state ships, never resurrects); P6 auto-mint-exclude (D6, DEFECT #28 — a minted-only id reverses without one); P7 re-mint flag loss (D4 — a same-hook rowsMint replaces the layer flag-less); P8 condense flag loss (D4 — preservation lost across a condense round-trip); P9 serialize asymmetry (D5 — a preserved node is still excluded from serializeNode); P10 promotion distinction (D3 — promotion still clears originLayer; the flag does NOT change runtime status). **D14 demo arm BUILT (preserve-reversal-scenarios, 4 checks); blind-test loop COMPLETE (2026-08-25 — writer → proofreader → page-reviewer; D4 data fixed to a genuine rows-mint re-mint, no engine defects)** |
| `tests/unit/rows-mint-guardrails.test.ts` | **ADVERSARIAL FIX PASS — the rows-mint guardrails (2026-08-24, defects.md ADVERSARIAL-* FIXED rows; archive/findings/2026-08-24/2026-08-24-adversarial-findings.md):** G1 — rows-op `target` type-check (a string target → contained `unknown-node`; the clientAPI wire path resolves string targets); G2 — destroyed target → contained `no-usable-state`; G3 — row-shape validation (`rows-shape-invalid`, atomic — no orphan/record/layer on a bad row; `rows: []` stays the clear; a null row MEMBER in a serialized doc → NodeSchema-shape-mismatch at the boundary); G4 — the origin serialize-exclude (a post-mint full-node-list doc ships NO minted rows; seed + re-mint reproduces exactly N — never doubles); G5 — the teardown consumer walk (rows-clear + undo(rows-mint) refresh the field-name consumers to their own no-provider state); G6 — census boundary (two same-name roots → NodeSchema-shape-mismatch; children-only census legal); G7 — the def-root fallback shape (a single-element def mints); G8 — the no-promotion pin on the replace + `rows: []` clear paths (a moved row is doomed, never promoted); G9 — row `id` never hijacks the minted node id (fresh mint ids; the id stays a provider value); G10 — smuggled row `anchors` stripped + `rows-mint-anchors-rejected` warn; G11 — JSON-safety over batches/anchor values (`serialization-error`); G12 — placement-kind without `placementName` → `rows-placement-name-missing` |
| `tests/unit/def-roundtrip.test.ts` | **FEATURE 1a — DEF-PROTOTYPE ROUND-TRIP (2026-08-24 — handoffs-review-5.md PROCEED-AS-RESHAPED; serialize.md §1/§3/§4 + decisions.md DEF-PROTOTYPE-CENSUS row, LANDED):** the CENSUS section `defPrototypes?: {name, nodeId, isRoot}[]` — emit rules (roots first, children in mint order, instance-membership reachability — a second hub's registrations never leak into another graph's slice, never-registered seeds ship none, name-less links skipped), the C2 seam-anchor strip on prototype-state content entries, the re-registration helper `reRegisterDefPrototypes(doc, hub, seeded)` (seeded instances by identity — zero construction; the post-seed `state === 'prototype'` tripwire throws `NodeSchema-shape-mismatch` when the def-root is absent), the schema-boundary codes (non-array section → envelope-mismatch; malformed/duplicate-nodeId/absent-nodeId → NodeSchema-shape-mismatch; duplicate NAMES legal), the seam re-materialization post-restore (def-root wires under the consumer — state flips prototype→in-tree, def-children re-home), and the CAVEAT FLIP (a section-absent reseed keeps `rows-prototype-unresolved` — BH-N.4 unchanged; the re-registered doc rows-mints + replaces in place via the round-tripping layerId) |
| `tests/unit/link-hub.test.ts` | **REQ-GAP-9 (2026-08-22 — handoffs-review-2 §3, user go-ahead; docs/specs/serialize.md §3):** the public `createLinkHub()` factory + seed-path hub threading. `createLinkHub()` returns a `LinkConfigNameHub` whose `linkFor(name, kind)` shares ONE Link per (kind, name); the factory is barrel-exported from `src/index.ts` with the same function identity as the `src/core/translate.js` export (one implementation, no drift) + the `LinkConfigNameHub` TYPE is barrel-exported (compile-time check). Seed-path threading: loadState-shaped `NodeBaseData` seeds with component (`source`/`target`) + placement (`container`/`content`) anchors + one hub instance → same-name anchors across seeds land on the SAME Link (hub-link identity asserted); hub-LESS seeds keep per-node FRESH links for same names (status quo); seed values still land on the shared link (`a.value` preserved). Seed-path safety preserved: a duplicate same-name component-source seed on ONE node still warns `component-source-duplicate` + keeps ONE anchor on the shared link; a bad seed anchor (a role the shaped link cannot admit) never throws out of the constructor (the `catch {}` containment). `translateLegacy(doc)` WITHOUT opts still works — it defaults to an internal `createLinkHub()`, so same-name anchors across nodes share one link |
| `tests/e2e/path-fork-e2e.test.ts` | **Unit 12** — the consolidated E2E constraint suite (placement-path-spec §0, the four FIXED user requirements; full-pipeline Node tests: legacy envelope → translate → register → ONE `compilePath` bootstrap → `emitElements`/`diffMinimal`/`applyOps`). **E2E-1** — the fork test has ONLY the 22 prototype nodes (+ root): 23 registered at every pipeline stage (global-registry count unchanged through compile/emit/diff/apply — zero node creations), 4095 distinct path-states (`forkKey = pathKey`, no `#`), 4095 elements on pathKey wires (per-level 2^k, create ops = 4095, zero removes), journal empty of `clone-instance` ops. **E2E-2** — a shallow props slice on a depth-2 node regenerates ONLY that node's path-states (compile-scope spies + pass-2 keys) and its element is REUSED (same wires, zero create/remove, set ops only on its wires). **E2E-3** — a component SOURCE change invalidates ONLY the per-name component Link's TARGET owners (the consumers — the §3.2 affected set): the all-consumers pressure case (every consumer's `compilePath` runs once; the non-consuming sibling runs zero passes) AND the half-tree precision case (provider consumed by the a-column only ⇒ affected = {provider, p3a, p4a}; the b-column runs ZERO compile passes; p4b's 8 max-depth states stay). **E2E-4** — a post-render third depth-4 node via `placement-attach` dirties EXACTLY {container, added node} (pass-2 keys, compile spies — d5a at depth 5 gets zero passes, no set ops on its wire) and the render diff is ONE create + appends under the container's path wire, every other element reused. Plus the consolidated guard pins: static census 23/4095/0/0, runtime re-pin arithmetic (4117 in-tree = 4095 + 22 prototypes, cloneOps 4094), the `component-source-duplicate` keep-first/skip-second/warn pin, and the §8-Q6 ratio-baseline pin (the DERIVED-TRIO family baseline + per-region pins + the runtime 3× tripwire). Authoring note pinned by E2E-4: a node's OWN pathKey carries its CONSUMER hops only (its producer zone appears in its children's keys). |
| `tests/unit/hooks.test.ts` | **HOOKS — the value-provider slot (2026-08-16, hooks-map-review.md §7 contract amendment B; decisions.md HOOKS row — the §7.2 pin-6 TDD list, red→green):** the `hooks: string[]` field round-trips translate → reverse → re-translate (zero warnings) + the `hooks-shape-invalid` containment (non-array field / non-string member warn + skip); (a) the READ SITES — the duplex provide-and-self-apply self-seed, the consumer arm bindings (continueArm), the path-state bindings (resolvePathTargets, compilePath), and the seam read (the SED-1 type-target collapse asserted at the EMIT level — a def-named hook is exempt, the def value stays, the element takes the def type + css); (b) the E2E-3 CASCADE — the state-slice walk dirties the consumers, the pass-2 refresh carries the hook value, the state events fire; (c) the ONE-source ROUND-TRIP TRIPLE — serialize → loadState reproduces the anchor value + the field, reverse → re-translate ships the binding value + the field, and the SSR emit (emitElements) renders the hook value; (d) the SEAM GUARD — the supervisor rejects `hook-name-unresolved`/`hook-mode-blocked`, the def-named write warns `hook-seam-exempt` + no-ops (both the supervisor path and the defensive applySlice path — never a throw); (e) the CLONE-SHADOWING pin — a hook-bearing node's clone carries the field + its OWN local `hook-<name>` layer + the mirrored anchor value; independent layers; (f) the layer-stack-stays-O(1) property (25 writes → ONE replace-in-place layer; the same-value short-circuit; the clear path — `value: undefined` removes the layer + restores the authored value) |
| `tests/unit/node.test.ts` | node lifecycle, layers, two-pass compile, forks, serialization, fail-states; **Unit 8** — the `component-source-duplicate` guard (placement-path-spec §6.2 node.ts row, §10.ab/§10.ae): a SECOND same-name source/duplex anchor on ONE node warns `component-source-duplicate`, keeps the first, and is NOT added — UNCONDITIONAL (imperative `addAnchor` AND the constructor seed path: a serialized doc carrying the pattern loads with ONE source and a warn, keep-first VALUE preserved); source+duplex share one provider namespace (name-keyed, matching resolve's `providersOn`); same-name CONTAINER anchors are unaffected (placement multiplicity legal) and different-name sources are fine; the Unit-11 re-expressed fixture shapes never trip it (regression pin); materializeAnchors' decl-path dedup is complementary (idempotent layer re-application stays silent) — the guard is the single enforcement point for everything reaching addAnchor |
| `tests/unit/path-enum.test.ts` | the placement-path enumeration compile mode (placement-path-spec §2 — Units 4+5): `compilePath()` minting ONE compiled state per valid (node, owner-path) pair — pathKey = `root/<zone>/<ownerId>/…/<nodeId>` (§2.2), `forkKey` = `pathKey` on every path-state; the R2.2 sibling-shared owner-name topology census (depth 4 → 15 states; d12 → 4095, E2E-1 — both level-(k−1) prototypes own ONE name, consumers target it, §5.1); path-derived children at mint time (family children + placement consumers, loop arms excluded — §2.3); viability for contentNodes-owned family-'in-tree' nodes (honest family label, §2.4); the per-walk visit-set cycle guard (`circular-source` + `loop` drop, sibling walks unaffected — §1.4; a placement-requested loop branch below the chosen name is never consulted — §1.2); E2E-2 foundation (a props mutation on a placement-routed node regenerates ONLY its path-states via the supervisor pass-2 dispatch); derived `children.length` reads path-derived children; Unit-5 §1.2 first-match fan-out (ALL zones of the chosen name produce instances) + `activePlacement` = the chosen name on every placement-routed path-state (§2.5) |
| `tests/unit/path-emit.test.ts` | **Unit 7** — the path-state emit layer (placement-path-spec §4): pathKey wires — a two-zone chosen-name fan-out emits 2 elements with distinct pathKey wires, each with ITS path-derived childOrder (child states' pathKey wires; per-path appends carry pathKey owners; `treeFromOps` reconstructs the path tree); the fork-stress depth-4 probe (15 elements, path-nested binary shape, no `#<i>` wires anywhere; `applyOps` reaches every element via the (wire, forkKey) composites); the armIdx-gate re-expression (a multi-path node's states are NEVER arms — `on:*` attaches to every path-state of a handler-carrying node and def-retyping applies to every def-carrying path-state); family states unchanged (wire = nodeId, no forkKey) + `#f:` component forks unchanged (`nodeId#<i>` wires); the root path-state emits at the conventional wire `root`; `diffMinimal` prevMap reuse (same pathKey across a recompile ⇒ zero ops; a shallow props mutation ⇒ set-only on the changed path-states' wires); mixed family + path emission without wire collisions. **P-EMIT-8/10/11/12/13 (2026-08-19 — DEFECT #24/#25/#26, their own matrix rows below)** |
| `tests/unit/path-resolve.test.ts` | Unit 5 resolve-side first-match walk (placement-path-spec §1.2/§2.5/Q8, §6.2 resolve rows): preference-ordered pruning — only the CHOSEN name's paths enumerate, later names never consulted (silent: no drops, no warnings); names with no viable container skipped (non-fatal; whole-array miss ⇒ nothing forks); `activePlacement` = the chosen name even when NOT the first requested; the `placementChangeIrrelevant` relevance predicate (less-favored link change ⇒ silent abort decision; chosen/higher-ranked/unrequested/stale ⇒ relevant) + the Unit-6 seam (predicate gates `node.compilePath` — abort ⇒ no states, no events; `activePlacementOf` reads the chosen name from the node's last states, family-first states without one skipped); per-path component-target resolution (Q8 path-only: own → path ancestors, nearest-wins, ≤1 hit per name per path, provider above ONE path binds only there, unresolved per-path) |
| `tests/unit/derived.test.ts` | derived-state DSL (DV-H1..H13/F1..F4); **Unit 10** — the per-path `placement` root (placement-path-spec §2.3/§2.5, §6.2 derived.ts row): a path-state's `{ $: 'placement' }` reads its `cs.activePlacement` (the CHOSEN zone name — Unit 5 seam; per-path, differing per chosen name), a family-first path-state without `activePlacement` falls back to the node's `container` anchor target, and family states keep the legacy container-anchor read (the runtime pages' `data-placement` bakes — feature-showcase #placement-lab — are pinned identical); `children.length` on a path-state reads the path-derived children (Unit 4 seam, baked via `applyDerived`). **DV-C1 — the css derived root (2026-08-20):** `css.<field>` paths are legal reads (bare `css`/`css.`/deep paths reject); `DerivedDecl` gains `css`; `validateDerived` validates css exprs; an authored `css.classes` root round-trips the legacy envelope; the `css.classes` read APPLIES as an APPEND onto the host class list (host first, injected after — scalar string → one class), and a missing binding keeps the authored list (omit, never wipes) |
| `tests/unit/graph.test.ts` | Link/Anchor matrix, LinkConfigError atomicity, cascade sweep |
| `tests/unit/ops.test.ts` | structural executors, state-slice reducer, slice lock; **Unit 6**: the `placement-attach` executor (P-A1 ordered `content`-anchor minting + `container`-anchor ensure on the shared per-name placement Link, preference order preserved; P-A2 idempotent re-attach, dedup keep-first; P-A3 the §1.3 ancestor-name veto — warn `placement-name-vetoed`, warn+skip; P-A4 `derivePlacementTrigger` — minted ⇒ `container-added`, ensured ⇒ `content-added`). **D7 pins (2026-08-14, §2.7 — LANDED; matrix row LANDED):** the anchor-layer seam materializes the def's children (from the PRE-MINTED `'component'`-token prototypes, F16) + placement links onto the consumer (parent anchor ON the consumer, target = self, `options.seam = true`, F15/F19); the role-scoped addAnchor exemption admits layer-materialized `'child'` anchors carrying the seam flag — a def referenced twice gives children MULTIPLE LEGAL PARENTS (intended, G24) while family attach of an already-parented node STILL rejects `'single-parent'` (G25); `familyLinkFor` filters seam parent anchors (G26); seam links excluded from path-walk parent selection (G27, F18). **ORIGIN-OWNER pins (2026-08-15, archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review.md §12.4 — LANDED; tests/unit/legacy-shape-ops.test.ts Run B O1–O9):** the `layer-apply` executor mints each NodeData as a family child (family-only — a NodeData `anchors` field warns `layer-apply-anchors-rejected`), sets `node.originLayer` + the module-level minted-set registry, applies the anchor layer with child decls carrying `options.origin` (the exemption's origin side, O4), and is idempotent (same layerId = no-op); teardown = removeLayer/removeLayersForSource on the creator under the PRE-DETACH survival predicate — doomed (sibling-preserving `detachNodeSafe` → sweep) vs promoted-survivor (permanent token under a NON-origin parent → marker cleared + unregistered, reverse-emitted) |
| `tests/unit/pipeline.test.ts` | registry/workers, slice lock, microtask queue, V/F matrix |
| `tests/unit/validation.test.ts` | tag schemas, LinkConfigError catalog, timing, clone |
| `tests/unit/render.test.ts` | serialization round-trip, fork keys, drop dispositions, SSR/ORD — incl. the DEFECT #1 emit-layer `forkKey` forwarding suite (fork arms carry `cs.forkKey` on elements + create/set ops, non-fork states carry none, applyOps/treeFromOps `wireKey` composites — incl. DEFECT-1f: bare-wire append/remove ops resolve forkKey-keyed arm elements so fork arms reach the DOM — `treeSig` forkKey dimension). **D4/D8 pins (2026-08-14, §3.4 — LANDED; matrix row LANDED):** cssDef → stylesheet rule strings (`{selector}{kebab-case styles}`, nested media-query serialization), rule-signature dedup (the same rule never emits twice across the render), ACTIONABLE-states-only (F10 — no rules from dropped/owner-terminated/token-owned/unplaced arms), zero-or-one `styles` op per sweep — a cssDef-less render emits NO styles op (F11, STL-H5); def-chain emit scoped to the 1:1 link method at offset 0 with link-method provenance (F22/F23) — a count mismatch, a seam-target def, or a non-zero offset emits NO def children (no synthetic wires, no host emission). **OPT-IN `data:node-id` (2026-08-21 — ssr-synthetic-event.md §4, user ruling A2; the ONE scoped lift of the no-render-change pin):** the default-OFF pin (no options ⇒ NO `data:`-prefixed op key anywhere in the element set or op stream); ON ⇒ every element of a small tree carries `data:node-id` = its state's nodeId (fork arms share the state's id; every value is a key of nodeById); the def-fill/seam case (the legacy-shape-translate [29] children-seam envelope) ⇒ every element carries the prop and the def-root/def-child SYNTHETIC elements carry the REAL minted proto ids (the same id `mergeHandlerProps` uses), the SED-2 shell the consumer's nodeId; ON is ADDITIVE (the same tree with/without differs ONLY by the `data:` prop) |
| `tests/unit/adapters.test.ts` | concrete adapter layer: `DomAdapter`/`SSRFragmentAdapter`/render-helpers — §10 DOM/FRG/HLP/PARS matrices of `docs/specs/adapters.md` (fork-arm `wireKey` targeting, D4 undefined-drop, styles coalescing, hydrate seam, parity, compiled-fork `forkKey` ops, `on:*` `escapeAttr`, floating-fragment `toString`). **D3/D4 boundary pins (2026-08-14 — LANDED; matrix row LANDED):** `styles()` payloads are RULE STRINGS (never raw cssDef objects — an object at the boundary is the `[object Object]` defect class); per-adapter-instance rule-signature dedup (DOM-H29/FRG-H27 — the same rule never appends twice); a zero-rule styles op never arrives (F11); `css:style` values are always strings (objects serialize at translate). **OTGE/NULL-PASSTHROUGH — OBJECT EMISSION SEAM + N3 NULL PASSTHROUGH (2026-08-19 — LANDED; decisions.md OTGE/NULL-PASSTHROUGH row, RENDER_PROCESS_NOTES §10.10.7):** a plain-OBJECT value at any string bake serializes as `JSON.stringify` via `bakeValue` (not `[object Object]`) — DOM-NP5 ×2 (text branch + bare-prop/attr) + FRG-NP5 ×2 (contentText + escaped-attribute JSON in the openTag, the embedded-quote backslash + `&quot;`/`&amp;` encoding pinned). An AUTHORED-PRESENT null survives the derived seam as `key: null` and bakes as the JSON string `"null"` (OTGE-consistent) — DV-N3 ×5 (`tests/unit/derived.test.ts`: present-null binding survives, missing source still omits, literal-null declaration carries, computed `$if`-null omits, `minimalFromState` emits `prop:flag: null`) + DOM-N3/FRG-N3 attr pins. **DETACHED INITIAL-BUILD BATCH (2026-08-16 — adapters.md §3.5b, decisions.md row):** DOM-B1..B4 — created elements are held back from the mount during a batch; appends re-parent them; `endBatch` mounts only the unparented roots in creation order; the batch is one-shot + non-leaky; a full op stream inside the pair builds the tree detached and mounts it whole. **DATA-* — the opt-in `data:` op namespace (2026-08-21 — ssr-synthetic-event.md §4, user ruling A2):** `data:<name>` op props route to `setAttribute('data-<name>')` on the DomAdapter (set + undefined-drop) and the `data-<name>="…"` attribute in the SSR string (set + undefined-drop); bare non-colon `data-x` names are untouched (only the colon namespace routes); the default-OFF pin (a DEFAULT emitElements stream leaves NO data-node-id in the DOM or the SSR string); the ON stream end-to-end (DOM attribute + SSR string carry `data-node-id="<nodeId>"`). **RETAINED HANDLER MAP (2026-08-20 — the listener-removal un-park, docs/specs/retained-handler-map-review.md + decisions.md RETAINED-HANDLER-MAP):** the DOM adapter keeps the EXACT listener functions it bound (keyed `wireKey(wire, forkKey)` × event name) — `set('on:<evt>', undefined)` now detaches (`DOM-F6`), re-setting the same slot REPLACES rather than accumulates (DOM-F5-flip), and `removeEl`/duplicate-`createEl` purge the slot (`DOM-F7`/`F8`) so orphaned (still-mounted) elements stop firing; the DOM/SSR divergence (S-R5.7) is closed — SSR already dropped its inline attr. Tests: `adapters.test.ts` DOM-F5-flip + F6..F12 (+ shims' `removeEventListener`); the remaining same-`event`-name body-swap invisibility is a `diffMinimal` residual (constant-`true` `on:` values), recorded in the review. **DEFECT-SSR-REMOVE — SSR removeEl DETACH (2026-08-23 — docs/specs/handoffs-review-3.md + decisions.md DEFECT-SSR-REMOVE row, LANDED):** `SSRFragmentAdapter.removeEl` mirrors the DomAdapter detach — a removed element LEAVES the serialized subtree (PAR-5/SSR-F4 parity for destroy op streams); pins: plain-remove detach, remove→re-create non-resurrection (the created-purge trap — the dead descriptor never floats top-level), fork-arm remove (identity splice, sibling arm + parent survive), cascade order independence (parent-first and child-first both collapse to root-only), unknown-key silent no-op, repeated remove→re-create bounded (`created` does not accumulate). Tests: `adapters.test.ts` DEFECT-SSR-REMOVE block (6); matrix: adapters.md §10.2 FRG-H18-remove widened + FRG-REM1..5 |
| `tests/unit/producing-loop.test.ts` | **the EXPORTED canonical re-emit loop (2026-08-21 — ssr-synthetic-event.md §2.4, handoffs-review REQ-GAP-5, user ruling B):** `renderProducingProcess(actionable, nodeById, adapter, prevMap, renderOptions?)` (src/core/render-helpers.ts + the src/index.ts barrel) — the harness loop promoted verbatim: filter states whose nodeById node is destroyed/not-in-tree → emit (DEFAULT options) → diff → apply → `{ els, ops, prevMap }`. Pins: barrel export identity; first render with prevMap null CREATES the whole tree and returns a NEW caller-owned prevMap that feeds a silent (zero-op) re-render; re-render after a state-slice mutation (translateLegacy → register → bootstrap compile → recordResolved → `dispatchEvent` → host-awaited setTimeout(0) task boundary — `flush()` is the supervisor's own surface; caller drains `takePass2States` and merges) is INCREMENTAL — set-only, no re-create, only the button's `text` set; destroyed and DETACHED (not-in-tree) nodes' states are pruned — their wires get `remove`, never re-create; the loop is on-demand + adapter-neutral (the returned op stream equals the MockAdapter call log). **REQ-GAP-8 (2026-08-21 — the handoffs-review §B "A2 absorbs in the same pass" plan):** the OPT-IN `renderOptions` threads to `emitElements` — `{ nodeIdAttribute: true }` stamps `data:node-id` (always a REAL nodeById key) on every emitted element, OPT-IN only (the default loop render stays byte-identical), and the stamping survives the prevMap chain (incremental re-renders keep it) |
| `tests/unit/handlers.test.ts` / `phases.test.ts` | handler ctx/dispatch; phase ordering. **D6 TODO marker (2026-08-14) SUPERSEDED — the HANDLER-SEAM LANDED (2026-08-15, handlers.md §6):** legacy handler defs stored as `template.component` values `{name, body}` are NOT dead-as-components anymore — they register by name and wire via `handlers.<event>` targets (the K3 vacuous-binding misfire is superseded for the def shape only; a genuinely vacuous binding still fires `component-binding-empty`); the runtime bridge landed too (see the legacy-bridge.test.ts row below). **PHASE A — EVENT-DISPATCH ENGINE ENTRY (2026-08-20, docs/specs/event-dispatch-wiring-review.md, handlers.md §3, LANDED):** **PHASE A — EVENT-DISPATCH ENGINE ENTRY (2026-08-20, docs/specs/event-dispatch-wiring-review.md, handlers.md §3, LANDED):** `Supervisor.dispatchEvent(target, event, ...args)` — resolves Node/nodeId/wire (full string then first-`#` fork-arm prefix) to a live node, dispatches once per node with all fork arms in `ctx.states`, returns the contained `HandlerResult[]` (`[]` for unknown/destroyed/unplaced and for the same-(node,event) reentrancy guard) — pins: trigger-not-journal, never drains/flushes/emits, no propagation. The `phases.test.ts` "Supervisor event dispatch" block is the coverage (target kinds, fork-arm once-fire + states grouping, `#`-in-nodeId resolution order, destroyed/unknown → [], reentrancy same-event vs different-event, containment, no-drain); the `onEvent` DOM seam survives as an independent parallel path. **PHASE B — SSR SYNTHETIC-EVENT CONTRACT (2026-08-20, docs/specs/ssr-synthetic-event.md + ssr-synthetic-event-review.md, LANDED as a contract+harness — NO engine/adapter/render change):** producing-process-keeps-graph + fragment-as-addressable-metadata (css.id + process-side wire/nodeId targeting; NO new render attr), inert inline `on<event>="true"` never the dispatch channel (DOM-F12), graph-canon/fragment-is-a-view (dispatch never re-renders; host re-emits on demand), DOM vs SSR identical `HandlerResult[]` + post-apply treeSig parity (PAR-5) — encoded by tests/e2e/ssr-synthetic-event.test.ts. **SHARED-HOST DISPATCH SURFACE (2026-08-21 — ssr-synthetic-event.md §2.6/§3, handoffs-review REQ-GAP-4/5, user rulings B/D2; decisions.md DISPATCH-REPORT row — LANDED):** `Supervisor.flush(): Promise<void>` — the PUBLIC deterministic settle (`while (hasPendingWork()) await oneTaskBoundary`, replaces host hand-rolled tick loops); `Supervisor.dispatchAndReport(target, event, options, ...args): Promise<{results, dirtied}>` — the ADDITIVE async sibling of `dispatchEvent` (unchanged): identical resolution/guards (destroyed/unplaced/unknown → `{results: [], dirtied: []}`; the same `dispatchingEvents` reentrancy key — a nested same-(node,event) no-ops), same dispatch, internal `await flush()`, then `dirtied = ∪(result.dirtied of journal entries appended DURING this dispatch — the bounded new-entry span) ∪ keys(takePass2States())` (journal-snapshot derivation REJECTED); `options.requestId` = OPT-IN bounded LRU dedup (cap 128 / TTL 10s), registered SYNCHRONOUSLY at call entry — a duplicate returns the FIRST caller's report (idempotent echo, in-flight or settled), a requestId reused with a different (target,event) warns + is a miss, NOT journaled / process-local / best-effort / zero cost when absent. The `phases.test.ts` "shared dispatch-report" block is the coverage (report shape + applied-sibling dirtied, pass-2-state-key dirtied via the walk-path recompile, empty reports, sequential + concurrent dedup echo with once-dispatch pins, different-(target,event) miss, no-requestId no-dedup, reentrancy interplay, `flush()` settle + non-draining probe); the ssr-synthetic-event harness dispatches through the report surface (P4/P6 uses the host-callable `flush()`; P5 + §3.4 pins identical `results` + STRUCTURALLY identical `dirtied` across the DOM/SSR producing processes — each process mints its own node ids, so the parity claim is the relative-node-position set; the harness re-emits from the non-draining `getResolvedStates` since the report consumed the drain) |
| `docs/specs/landed-features-scenarios.md` | **2026-08-20 SESSION-FEATURES scenario spec (EXECUTED — the blind-test/stress loop ran 2026-08-20; DEFECT #27 FIXED the same day; report archive/findings/2026-08-20/2026-08-20-session-features-blind-test.md):** end-to-end scenarios for the three session features — css.classes seam (scalar/array append, missing-source keep-authored, blocked `css.*` targets warn+skip, reverse `target:` round-trip), retained-handler-map listener lifecycle (self-removing handler → diff-driven detach; element-removal purge), `Supervisor.dispatchEvent` engine entry (engine-driven control, fork-arm wire once-fire + all arms in `ctx.states`, unknown/destroyed → `[]`, read-only dispatch re-renders nothing, no propagation, same-(node,event) reentrancy vs different-event). Suite pins: translate K8/DV-C1/N1, adapters DOM-F5-flip + F6..F12, phases.test.ts "Supervisor event dispatch". Findings: S2.1's self-removal was NOT pipeline-reachable until **DEFECT #27 FIXED (2026-08-20 — a `handlers` state-slice `value: []` now CLEARS durably, handlers.md §4)** — the full S2.1 output is now asserted; S2.2 `destroy` dissolves the shared family link (the destroyed node must be the sole child of its container — designing-pages §14.1 rule 11); S3.2 a fork needs EQUAL-DEPTH providers (nearest-shadows-far collapses nested providers to one arm — api.md §4.2). The scenario PAGE (`session-features.html`, §12) is built, wired, and green (28 checks). **Group 4 (2026-08-21 — REQ-GAP-8 blind test, report archive/findings/2026-08-21/2026-08-21-producing-host-blind-test.md):** the exported canonical re-emit loop `renderProducingProcess` threading the opt-in `renderOptions` parameter — 4 scenarios (OPT-IN threading, DEFAULT OFF, prevMap chain, destroy-prune) + controls; the scenario PAGE (`producing-host.html`, §12 page 24) is built, wired, and green (15 checks). Findings: all page-reviewer data fixes (mount-key mismatch, applyOp options passthrough, destroy-check timing) — no engine defects. |
| `tests/unit/legacy-shape-translate.test.ts` (H1–H6 + F1–F8) | **HANDLER-SEAM + FORMAT MARKER (D6 un-park; decisions.md HANDLER-SEAM row — LANDED 2026-08-15):** def-shaped `{reference, value: {name, body}}` bindings register as handler defs by name; `handlers.<event>` targets plan with `options.handlerEvent` persisted (suffix verbatim, no `component-target-gap` warn); legacy lifecycle names as the suffix warn `handler-phase-unknown` + skip (N5); compile materializes ONE provenance-marked handlers layer on the consumer (idempotent replace-in-place; a def that disappears clears the stale layer); reverse emits `target: 'handlers.<event>'` with no double-emit. **Format-marker block (F1–F8, decision 4):** seam defs default to 'legacy' (WRAPPED — the body receives `(event, context)`), inline `NodeData.handlers` bodies default to 'modern' (raw `(ctx, ...args)`); an explicit `format` field overrides (F2 legacy / F3 modern / F5 inline-legacy); a non-'legacy'-non-'modern' value warns `handler-format-invalid` + falls back to the provenance default (F6); reverse persists the EXPLICIT format only (provenance defaults do not persist) and an inline legacy-wrapped handler re-emits its ORIGINAL body source (`sourceBody`, never the wrapper source — F7/F8). **AUTH-SEAM (2026-08-16 — decisions.md AUTH-SEAM row):** [H4] updated to use `handlers.beforeAssembly` — the one lifecycle name that still warns + skips — since `afterAssembly` is now the N5 carve-out (maps to the after-compile phase, AU1) |
| `tests/unit/legacy-bridge.test.ts` (B1–B8) | **the LEGACY-HANDLER RUNTIME BRIDGE (decisions.md HANDLER-SEAM row; archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review.md §5/§6 — LANDED 2026-08-15):** B1 the arg-order wrapper + event stub (`{type, preventDefault, stopPropagation, target: NodeView, isTrusted}` + `value: args[0]` when present — absent otherwise); B2 NodeView identity (ONE WeakMap-cached view per live node, the same object across dispatches); B3 members (token-terminated parent walk, family-only children — seam children excluded, css style STRING parsed to OBJECT on read, F7); B4 `receiveNextState` state keys → ONE state-slice (css.style OBJECT writes serialize back, D3); B5 `receiveNextState({children})` → ONE `layer-apply` (deterministic `legacy-kids-<nodeId>` layerId, minted family children origin-marked + registered, idempotent re-injection, teardown on layer removal); B6 QueryUtils — honest keys (`type`/`id`/`classes`/`props` exact-eq + predicate) match, unsupported keys (style/handlers/components/hasNonTypeTargetComponents) warn `legacy-query-unsupported` ONCE per dispatch + match NOTHING; B7 userData read-only passthrough (captured from `TranslatedTree.userData` at translate; writes contained no-ops); B8 the 6 corpus defs (AuthInitHandler, ToggleUserDropdown, LogoutHandler, showComments, toggleCommentsButton, enterEditMode) compile + dispatch through the bridge, incl. the direct-mutation graph no-ops and the window-guard/fetch paths. Probe: `scripts/stress-probes/blind4-bridge-probe.mjs` (proofreader) + `scripts/stress-probes/blind4-page-review-probe.mjs` (page-reviewer runtime audit — 32/35 asserts; the 3 fails were DEFECTS #13–#15, all FIXED 2026-08-16 — defects.md FIXED rows, verified live by stress round 5 S43/S45). **AUTH-SEAM (2026-08-16 — decisions.md AUTH-SEAM row; AU1-AU3):** the consumer model for the auth pattern — `handlers.afterAssembly` (AuthInitHandler) plans a PHASE (`handlerPhase: 'after-compile'`), AU1 pins NO `handler-phase-unknown` warn for afterAssembly while the OTHER lifecycle names still warn+skip; AU2 the compiled phase entry COPIES to the TYPE-target consumer (`seam-handlers-def` layer — `dispatchPhase(consumer, 'after-compile')` fires with `ctx.node = consumer` and the def children in-tree under it: without userData the button converts to a Sign-In link (`clientAPI.apply` state-slice via the NodeView `id`) and the dropdown is destroyed-but-retained — retention destroy, the walk slot stays); AU3 with userData the profile label lands and the dropdown survives. LegacyNodeView gains `id` (the live node's id string — the honest `clientAPI.apply(id, …)` reference, never a Node). **NESTED (N1-N5, 2026-08-16 — the def-in-def case):** a PROTOTYPE-CHAIN seam consumer (the auth div nested inside the nav def's children) installs the same way — the seam install runs for every SEAM-BEARING node regardless of viability: N1 the copied `after-compile` phase entry lands on the nested consumer and its children are the family-adopted def children (button + dropdown), and the dispatch converts the button to the Sign-In link (children[0] type 'a', content 'Sign In', href /api/oauth/login) with the dropdown retention-destroyed; N2 with userData the profile label lands ('Profile ▼', button stays, dropdown survives); N3 the render reflection — dispatch → recompile → emitElements — emits the CONVERTED button element (type 'a', text 'Sign In') because the def-fill emit sources type/content from the mutated proto pass1 when the proto carries the copied phase-handler layer (falling back to the def spec data otherwise); N4/N5 (2026-08-16 — DEFECT #20, defects.md FIXED row) the destroyed-child prune pin: a retention-destroyed adopted def child's element is PRUNED from the emitted set — `defChildPruned` (render-helpers.ts) skips it at every def-fill zip site (emitDefRootElement, the emitDefChildTree recursion + nested seam branches, the SED-1 type-seam + P-EMIT-3 fills) and the blocked-def/nodeById reTyped loop skips synthesized real-child elements whose childNode is destroyed + filters the destroyed wires out of the consumer's childOrder (no ghost wires for diffMinimal) |
| `tests/unit/translate.test.ts` | legacy schema → graph (in); K5 apply-path persistence + K6 root flip (K5 emission contract: `tests/unit/reverse.test.ts`); P3 placement minting: `targetPlacement: string[]` → ordered `content` anchors (serialize round-trip preserves the order), `#`-validation (`placement-name-invalid`), string-coercion back-compat (`placement-string-coerced`), duplicate keep-first (`placement-duplicate-reference`), `activePlacement` never minted, contentNodes-ownership minting (content roots family-'in-tree' via the token; token terminates the compile walk), `component-target-placement` warn removed. **D1–D8 live-prod pins (2026-08-14 — LANDED; matrix row LANDED):** `placement: [...]` ARRAY maps every entry through the single-entry logic (producer + consumer on one node; per-entry `#`/duplicate/coercion warns; never a silent no-op; `placement: []` legal empty list — no warn; non-object entries → `placement-entry-invalid` warn+skip; the translate-time ancestor veto fires too — `placement-name-vetoed`, shared `ancestorConsumesZone` predicate, child-side family attach, F3) while the single-object form maps once; reverse merges to one flat object (array only for multi-producer nodes, F2); `doc.content` ANY non-array warns `payload-shape-obsolete` + skips (F5, array-only); `css.style` OBJECT serializes to a kebab-case `k: v;` CSS string (grammar: first-`:` split, `url(...)` `;`-exception, vendor-prefix kebab-case, `{}` → `''`, F8) and reverse ALWAYS parses back to the object (F7); `nodeData.content` is text-only and a non-array `children` warns `children-shape-invalid` + skips (F14); `type`/`content`/`children` seam targets plan the D7 anchor layer (no `component-target-gap` warn) with `options.seam` persisted (F17) — `content` = text delivery only (F13); def children PRE-MINTED as `'component'`-token prototypes (F16). **CSS-CLASSES TARGET DISPOSITION (2026-08-20 — LANDED; decisions.md CSS-CLASSES row, RENDER_PROCESS_NOTES §10.10.8):** `css.classes` is the ONE css-family deep-injection seam — flat-only `applyPath: 'css.classes'` + synthesized `derived.css.classes = { $: 'bindings.<ref>' }` (self-provider and value-less root forms), carve-outs mirror `props.<key>` (dotted reference + authored-derived-wins → `component-target-skipped`), and the compiled bake APPENDS host-then-injected (scalar → one class; array in order). The css family block: `css`/`css.id`/`css.style`/`css.style.<member>` → `component-target-skipped` (batch css rides `target:'type'` → prototype; `css.id` never set by component); `handlers`/`component` bare forms → not-known gap warn; `css.`/`css.id.`/`css.classes.`/`css.style.` trailing-dot forms → `component-target-skipped` syntax edges. **K8 handler guards (2026-08-21 — REQ-GAP-7b, LANDED):** `handler-phase-unknown` / `handler-body-invalid` warn+skip (never throw, TR-F2) PLUS the DISTINCT **`handler-body-eval-blocked`** code for the CSP/eval-blocked signature (`new Function` throwing an `EvalError` or a "refused to evaluate"/`unsafe-eval`/Content-Security-Policy message — branched BEFORE the generic code, which stays for genuine syntax errors): the node translates with zero handlers and `dispatchEvent` returns `[]` (the silent-skip shape); tested with a stubbed global Function constructor (translate.test.ts K8 block) |
| `tests/unit/payload.test.ts` / `reverse.test.ts` | payload drop/refresh/append; reverse translation (out) — K5 target emission (consumer/provider/root `template.component`), runtime-duplex name-target drop, N1 synthesized-derived strip, K7 array-form reverse, no-warning re-translate round-trips; P3 reverse emission: `content` anchors → `targetPlacement: string[]` in MINT order + derived `activePlacement: string`, contentNodes anchor STRIPPED (re-translate re-mints cleanly, zero warnings). **D2/D3/D1/D7 reverse pins (2026-08-14 — LANDED; matrix row LANDED):** reversed `content` is ALWAYS a `ContentPayload[]` array (never the obsolete object form); serialized `css.style` strings ALWAYS parse back to `Record<string,string>` objects — no provenance (F7); placement reverses as one flat merged object (array only for multi-producer nodes, F2/R-H7); seam-wired def children NOT emitted as the consumer's `data.children` (F20/R-H8); payload item `content` reverses text-only. **css.classes reverse (2026-08-20):** the synthesized `derived.css.classes` key is stripped (N1 extension — only the anchor's `css.classes` applyPath + `bindings.<ref>` shape), `target: 'css.classes'` emits from the applyPath, and re-translate re-synthesizes cleanly (zero warnings); authored `css` derived keys re-emit alongside authored `props`. **REVERSE-OF-CLEAR (2026-08-21 — reverse.test.ts block; decisions.md row):** a handlers-CLEAR layer reverses as `handlers: []` (base + pre-clear layers suppressed; post-clear additions only) — re-translate reproduces the LIVE cleared state (the DEFECT #27 self-detach survives the round-trip); uncleared nodes keep the base + additions emission (no regression) |
| `tests/integration/payload-flow.test.ts` | payload lifecycle through the managed channel; edits surviving refresh |
| `tests/e2e/payload-refresh.test.ts` | full lifecycle: edit + append + refresh → in-place re-render → reverse with live state |
| `tests/integration/api.test.ts` | ClientAPI T1–T25 (journal, events, forks, gates) |
| `tests/integration/supervisor.test.ts` | journal replay/undo-redo, coalesced sweep; **Unit 6** (placement-path-spec §3.3/§9-Q3, E2E-4): the `placement-attach` op through `supervisor.apply` — registers-if-new, dirty set = container + added node only (S-P1: a depth-4 add recalcs nothing at depth>4; the container's path-states pick up the added path-child), journal verbatim incl. trigger fields + idempotent replay (S-P2), ClientAPI wire carry-through (container ref resolved, trigger fields pass the spread — S-P3), the trigger-identity silent abort (S-P4: an attach into a less-favored zone ⇒ zero state regeneration, zero events; the chosen link's attach regenerates), per-path events with `fork: { forkKey: pathKey, nodeIds: trace }` and affected-set-only emission (S-P5), W2 path-unique (nodeId, forkKey) dedup — never a per-node collapse (S-P6). **JOURNAL-REVERSIBILITY (2026-08-24 — handoffs-review-4.md + decisions.md JOURNAL-REVERSIBILITY row, LANDED):** `state-slice` journals `result.sliceLayers` + `result.hookUndo` (pre-op anchor.value + created/replaced/cleared) — the undo handle + replay gate; `undo()` inverts state-slice EXACTLY (removeLayer per id; hooks restore anchor.value with created/replaced/cleared handling; markPass2 + the E2E-3 source/duplex consumer walk; no phases/handlers/emitStructure; per-inverse try/catch; destroyed targets + missing layers silent); `replay()`/`redo()` re-apply NO-JOURNAL with in-place result refresh (the journal never grows; redo pushes the SAME entry — one entry per op, no double-undo, redo-chains possible); the idempotency gates (state-slice: all sliceLayers exist → skip, hooks: layer exists AND value-equality; clone-instance: recorded `result.minted` copy live → skip); undo/redo/replay resolve the entry's own live node reference first (id-resolution only as a fallback). Per-kind undo table: supported state-slice/attach/rows-mint (+ destroy pinned no-op); documented no-ops detach/move/clone-instance/layer-apply/placement-attach/rows-clear (ops.md §6). Tests: `tests/unit/journal-undo.test.ts` (14 — the DEFECT-JOURNAL-UNDO/REPLAY-APPEND/CLONE-REPLAY block) + O13/O14 + hooks-array pin 4/5/6 re-pinned |
| `tests/integration/handlers-flow.test.ts` | handler→journal→events; phase hooks; focused warnings |
| `tests/e2e/ssr-render.test.ts` | SSR→client complete render, parity, hydrate |
| `tests/e2e/ssr-html-validity.test.ts` | emitted-SSR-HTML validity through the **real** `SSRFragmentAdapter` (well-formedness, escaping, root-first, styles prefix; fork arms with distinct `forkKey` + floating-fragment top-level serialization) |
| `tests/e2e/markdown-html-validity.test.ts` | markdown render through the real SSR adapter — structured `<strong>`/`<textarea>` serialization, escaping, well-formedness |
| `tests/e2e/loop-safety.test.ts` | infinite-circle probes |
| `tests/e2e/legacy-bootstrap.test.ts` | legacy JSON → full render. **Real-legacy-shape pin (2026-08-14, D1–D8 — LANDED; matrix row LANDED):** the placeholderLanding-shaped envelope — `placement` ARRAY entries (producer `placementName` + consumer `targetPlacement` on the same page), `css.style` OBJECTS, `css.cssDef` StyleNodes emitting deduped stylesheet rules, `doc.content` as a `ContentPayload[]` array, the re-expressed `{target: 'children', reference}` wrappers (root navBar/header/footer + header-def p→articleSubtitle) materialized via the anchor-layer seam — each wrapper renders as its OWN shell element CONTAINING the def-root element (`div > nav.nav-bar > [logo, links, auth]`, def type + classes + cssDef rules on the def element, delivery-shape ruling) — the h1's `{target: 'content', reference: articleTitle}` delivering TEXT only (F13), def root + children staying out-of-tree pre-minted prototypes (no host emission, no count-mismatch clobber) |
| `tests/e2e/component-handler.test.ts` | component-provided after-compile handler |
| `tests/e2e/markdown-display.test.ts` | in-place render, focus retention, parent changes |
| `demo/feature-matrix.js` (smoke) | one page exercising every surface: placements, components, handlers, payload lifecycle (append/refresh/drop), managed updates, reverse translation, loop-safety, PAR-5 parity, SSR hydrate seam. The `session` provider is data-declared on the root via `template.component` (K6 — value-carrying root binding → SOURCE anchor); the root's runtime duplex consumer half of `session`, the TWO DISTINCT theme providers (`theme-dark`/`theme-light` — Unit 11 re-expression: the same-name `theme` ×2 fork claim is an anti-pattern, placement-path-spec §10.ad, so each consumer resolves its own provider, one arm each), and the loop providers are runtime-only additions (legacy-unexpressible — `target` is an apply path, never a second name, K1–K8) |
| `demo/mode-toggle.js` (smoke) | same feature-matrix document driven through the three adapter modes — `?mode=ssr|client|markdown` (every build embeds both payloads, so static serves work; `scripts/serve-demo.mjs` serves per-mode too). **Demo-page test case — NOT expected real-world behavior.** SSR asserts the full well-formed server HTML was received (root-first, presentation ids present, balanced tags — the `validateHtmlShape` scan mirrors the e2e stack validator); markdown asserts the raw editor source is embedded verbatim for inspection alongside the live parsed display **AND the SAME document rendered through the REAL MarkdownAdapter (D14 arm, 2026-08-25 — `renderFeatureMatrixMarkdown()` server-side, key doc content present, no HTML surface leaked; mode-toggle markdown: 14 checks)**; client runs the shared harness with no mode-specific payload |
| `demo/fork-stress.js` (smoke, depths 2–12; the **d14 page is BUILT-BUT-NOT-SMOKE-RUN** — manual/browser scaling probe) | layered stress test of the forking render system — a binary tree built layer by layer, each layer adding 2 children per node through one of the four runtime child-creation mechanisms (placement → component values → component link → idempotent handler → repeats with different placement/component names). Pages `fork-stress-d{2,4,6,8,9,10,11,12,14}.html` (2^depth − 1 nodes; d14 = 16383 — ADDED 2026-08-16 as the scaling probe: the d12 totals (~150-800ms post the timer-drain + findEl fixes) are too fast to expose pass-2 scaling, so depth 14 joins the family; RE-SCOPED 2026-08-16: the d14 page is BUILT for manual/browser probing only — the automated smoke runs depths 2..12, an O(n²) return flags there; the handler-marked census extends to the depth≥13 L12 handler layer, `16 + 256 + 4096 = 4368` marked). Only core (`dist/core/*`) + handler code — no demo-side render machinery. Each level changes a different css property (L1 background-color, L2 border-style, L3 border-width, L4 text-decoration, cycling) with a value per sibling slot (demo-only helper `levelCss`, NOT a core API). Checks: per-layer node counts, rendered-count, css per-level property + slot pairs, placement anchors, values/link binding rendering, handler idempotency (no after-compile loops), ancestry labels, incremental-render scope. Spec: `docs/specs/fork-stress.md` |
| `demo/fork-stress-data.js` (smoke, depths 2–12; the d14 page + the d14 single-method variants are BUILT-BUT-NOT-SMOKE-RUN — manual/browser scaling probes) | the DATA-DRIVEN variant of fork-stress: the same binary stress tree assembled from a LEGACY envelope alone (root + two prototype nodes per layer — handlers declared by NAME in the data, bodies supplied by the page) via the `clone-instance` op (recursive after-compile expansion; self-contained `c.node` bodies fire ONCE per clone — the DERIVED `stress:expanded` (`children.length > 0`, declared on the prototypes, inherited by clones — derived-state.md §9.2) replaces the marker op, so no self-ops, no re-dirties: 4094 handler calls at d12, half the marker era). Pages `fork-stress-data-d{2,4,6,8,9,10,11,12,14}.html` (2^depth − 1 nodes; d14 = 16383) + the SINGLE-METHOD variants at BOTH depths `fork-stress-data-{placement,values,link}-d{12,14}.html` (spec §4 — the d14 variants are the SCALING PROBES added 2026-08-16, RE-SCOPED 2026-08-16: BUILT but NOT part of the automated smoke — the smoke keeps the d12 single-method placement baseline + 2.5× totals guard, depths 2..12): placement-only (pure clone structure), values-only (every prototype declares its scalar VALUE as a legacy `component` source — translate.md §2 — and every clone renders it as text), link-only (every prototype declares its component DEF as the source value; every clone's emission re-types the next layer — the recursive def chain, which exercises the emitter's covered-consumer `defChildren` path). Only core (`dist/core/*`) + the shared data-derivation helpers (`levelCss`/`cssPropForLevel`/`LAYER_METHODS` — NOT core APIs) — no demo-fixtures, no demo-side render machinery. Checks: per-layer node counts + total (RE-PINNED per placement-path-spec §5.2 F-13: contentNodes-ownership minting makes the 2·(depth−1) prototype content roots family-in-tree too — in-tree = 2^depth − 1 + prototypes, unplaced = 0, cloneOps stays the journaled clone count; the prototypes never compile/render, the token terminates the walk), css per-level property + slot pairs, `stress:kind` per layer mechanism, values/link method checks (per-node element text vs resolved source value / def content), DOM nesting vs graph children (all sources live on the prototypes, so the root emits like every node — walk from the root element), `stress:layers` ancestry chains (parent-baked at creation), derived idempotency (resolved-state `stress:expanded` true for non-leaves / false for leaves), incremental-render contract (bootstrap the only full compile). Spec: `docs/specs/fork-stress-data.md` + `docs/specs/derived-state.md` §9.2 |
| `demo/feature-showcase.js` (smoke) | the FEATURE SHOWCASE — ONE legacy envelope demonstrating the framework's advertised features both isolated and combined via ONLY the documented core interfaces + JSON handler/derived/anchor data (markdown above in §12). Confirmations: depth-0 scalar resolution into two consumers with derived `bindings.*` bakes, same-name self-provider multiplicity, provide-and-self-apply (`{reference, value, target: 'props.<k>'}` — K1/K2: the synthesized `props.moodPanel = {$: 'bindings.mood'}` bake reads the node's own published value), scoped unresolved fail-state, `circular-source` A↔B borrow-walk loop pair authored via the K7 ARRAY form (provider + consumer bindings on ONE node — `component: [{reference, value}, {reference}]`; dropped at compile — never rendered — no hang), derived-DSL bakes, placement badge, on:input/on:click string-body handlers mutating a sibling preview, one-shot idempotent after-compile stamp via `runPhase`, throwing-handler containment, css id/classes/style, contentNodes-owned content payloads (family-in-tree via the permanent-owner token, never rendered — P3 §10.ad/F-13), clientConfig gates. The two-name duplex anchor shape is runtime-only — no legacy data expresses it (K1–K8). PAR-5: the expected-output page is the same envelope through the real `SSRFragmentAdapter`. Checks walk the #app subtree (shim-compatible). Banner: `feature-showcase`. Spec/companion: `docs/framework-feature-summary.md` |
| `demo/path-fork-data.js` (smoke; depth-parameterized — the d12 trio; the d14 SCALING-PROBE trio is BUILT but NOT smoke-run) | **Unit 11** — the STATIC placement-path page (placement-path-spec §5, pages `path-fork-data.html` (placement d12) + `path-fork-data-values-d12.html` + `path-fork-data-link-d12.html` — the DERIVED TRIO, derived-fork-variants-review §5.1 — PLUS the d14 trio `path-fork-data-{placement,values,link}-d14.html` (27 nodes/16383 path-states, added 2026-08-16 as the SCALING PROBES: the d12 enumeration dominates the d12 totals and hides EMIT-side scaling, so d14 re-exposes it with the same per-region pins — RE-SCOPED 2026-08-16: the d14 trio is BUILT as manual/browser scaling probes only, NOT run in the automated smoke): the fork-stress topology re-expressed WITHOUT clones — the legacy envelope carries the root + 22 prototypes (two per layer 1..11) declaring `placementName` (producer/'container') and, for layers ≥ 2, `targetPlacement: ['zone-<k-1>']` (consumer — the R2.2 sibling-shared owner-name topology); the pipeline is translate → register → ONE `compilePath` bootstrap → `emitElements`/`diffMinimal`/`applyOps` (DomAdapter) → render — NO clone-instance ops, NO after-compile expansion (E2E-1 by construction: 4095 path-states pinned to 23 nodes). The values/link variants add the per-method component fields on the prototypes (values: scalar VALUE per prototype — every path-state renders `value-<SLOT>-<k>` as text; link: the component DEF per prototype — the recursive def chain over path-states; its 4095 element census holds via the covered-childless def-fill gate, DEFECT #21). Checks (all methods): the static census (registered=23, in-tree=23, unplaced=0, destroyed=0, cloneOps=0 — smoke-pinned via the profile), state census (4095 distinct pathKeys, `forkKey = pathKey` on every state, `activePlacement` = the chosen zone name, no `#` anywhere), element census (4095 elements, wires = pathKeys — the (wire, forkKey) composite keys at the adapter boundary; the LINK page's re-typed def-chain children are bare-keyed with NO forkKey — the adapter-key asymmetry, review §3.3/§4.4), per-level counts (2^k elements at level k, 1..11), css per-level property + slot pairs, derived `stress:expanded` idempotency (state-level for every method; the ELEMENT-level bake assertion is scoped to standalone-emitted path-states — re-typed children source pass-1 node props only, the `method !== 'link'` exemption, review §4.5), `treeFromOps` binary-shape reconstruction (1 root → 2 → … → 2048 leaves at depth 11, 4095 total), PAR-5 structural parity with the builder's `SSRFragmentAdapter` output (wire- and forkKey-agnostic shape signature — an FNV-1a 64-bit digest over the recursive type/props/children fold — the full 4095-element SSR fragment is ~190MB and is NEVER embedded; the page embeds the digest as `serverTreeSig` plus a 300-op truncated SSR sample `expectedSsrSample` proving the builder's SSR pipeline ran), the per-method mechanism checks (values: text-vs-resolved-value per path-state; link: div type + def content for k > 1 + the child's OWN props on re-typed elements + the 4092 re-typed-element count pin), profile line `[derived-fork:profile] method=<m> … states=4095 passes=1 …` + `globalThis.__pathForkDone`. Smoke guards: `assertStaticPathCensus` (the §5.2 numbers per page — IDENTICAL for all three methods, never silent drift) + residual coverage + the FAMILY baseline (§8-Q6 split — review §5.2): the placement-derived page records its per-region totals as `[derived-fork:baseline]` (the former `[path-fork:baseline]` single-total marker, §10.ad N-5/R-5 SUPERSEDED); the values/link pages pin each region within 2.5× (`[derived-fork:pin]`) — NOT totals (compile-enumeration-dominated, EMIT-insensitive); the runtime pages keep their total-ratio guard + the 3× tripwire against the placement-derived total (re-baselined 2026-08-16 — the isolated-subprocess smoke exposes the honest ~2.1-2.7× runtime:derived ratio). Element lookups use `elOfWire` (bare-then-composite) — never the composite-only `domElOf` (the review's adapter-key rule). Builder: `scripts/path-fork-page.mjs` (parameterized per method) |
| `demo/translate-showcase.js` (smoke) | the TRANSLATE-KERNEL showcase (K1–K8): every guard code exercised with its intended result (legal array-form card with K1 synthesis + provide-and-self-apply; plain consumer; duplicate reference + duplicate target pre-anchor blocks; vacuous `{}` warn+skip; `component: []` valid; unresolved consumer key-omission; `props.name.` syntax edge; unknown-path gap; dotted-reference carve-out), the K4 warnings channel rendered into the page, and the K5/N1 reverse round-trip (apply path persists as `target`, synthesized derived stripped, authored derived stays, re-translate fires no warnings). PAR-5 expected-output page via `SSRFragmentAdapter`. Banner: `translate-showcase`. Wired into `npm run demo:build` (page 18) + `demo:smoke` (seeded, `__translateShowcaseDone`, banner assertion) |
| `demo/legacy-shape.js` (smoke) | **the REAL-LEGACY-SHAPE regression page (2026-08-14, fix-pass plan item 5 — D1–D8; LANDED 2026-08-15 — matrix row LANDED)**: a production-shaped legacy envelope in the placeholderLanding style — the blind-test translate-stack fixture (tests/blind/translate-stack-fixture.json) adapted with authored `props.id` (deterministic PAR-5 signature) + a nested media-query cssDef rule — with `placement` as canonical ARRAYS (producer `placementName` + consumer `targetPlacement` on one page; a `placement-entry-invalid` side card for a non-object entry — `placement: [42]` warned + skipped, node still renders), `css.style` as OBJECTS (serialized by translate to kebab-case `k: v;` strings), `css.cssDef` StyleNodes emitted as deduped stylesheet rules from ACTIONABLE states only (class selector `.blind-card`, element/tag selector `nav`, and the nested media-query rule `nav{@media (max-width: 600px){flex-direction:column;}}` — 6 unique rules in ONE styles op), `doc.content` as a `ContentPayload[]` array, the three seam delivery shapes through the D7 anchor-layer seam — `{target: 'content', reference: titleDef}` delivering TEXT only (F13/SED-3), `{target: 'type', reference: badgeDef}` SHELL COLLAPSE (SED-1: the consumer's element becomes the def button — def type + css + def child strong, no def content text, no surviving wrapper), `{target: 'children', reference: menuDef}` keeping its OWN shell element + text + authored children and GAINING the def-root nav.blind-menu as an ADDITIONAL seam-wired child (SED-2 delivery-shape ruling) — def roots + children staying out-of-tree pre-minted `'component'`-token prototypes (6 prototypes, never emitted by the host — no count-mismatch clobber, no stray span.blind-title), with DEFECT #24 (2026-08-19): the seam-resolved menu subtree REALIZES in-tree (census in-tree=14, prototypes=3 — the children-target seam cascade; unresolved defs still stay out-of-tree while their carriers never emit standalone — standalone path-states are suppressed, the def-fill ships the authored truth), multi-zone placement with the FIRST targetPlacement choice missing (`['no-such-zone', 'side-zone']` → activePlacement='side-zone' fan-out into BOTH asides, §1.2/§2.5, `forkKey = pathKey`), EMPTY-OWNER visibility of the styled asides, zero K4 warnings on the main envelope, and a `payload-shape-obsolete` rejection card (the obsolete `{content, metadata}` object form warned + skipped, envelope root children still render). Pipeline: translate → register → ONE per-node compilePath bootstrap → emitElements → diffMinimal → applyOps(DomAdapter). 66 page checks: the probe's 45 claim set (probe §1–§7 incl. the root.compile seam-native comparison) + D8 prototype census (registered=17, in-tree=14, prototypes=3, unplaced=0, cloneOps=0, states=12, elements=16), DOM-mirror checks scoped to the adapter's wires, the K4 side-card checks, and PAR-5 (serverTreeSig = wire-agnostic `shapeSigOfTrees` digest + embedded SSRFragmentAdapter fragments incl. the side cards). PAR-5 expected-output page via `SSRFragmentAdapter` (`demo/legacy-shape.expected.html`). Banner: `legacy-shape`; profile `[legacy-shape:profile]` + `__legacyShapeProfile` (smoke-pinned census incl. the 6 deduped-style-rules set). Wired into `npm run demo:build` (page 19) + `demo:smoke` (seeded, `__legacyShapeDone`, banner assertion) |

| `demo/handlers-scenarios.js` (smoke) | **BLIND TEST #5 — the MOCKED REAL-WORLD HANDLER page (2026-08-16, docs/specs/handlers-scenarios.md):** ten use-case cards (S1 rendered TWICE — anon/alice — for the two userData variants) driven ONLY by legacy envelopes (function-STRING bodies) + `dist/core/*`; the harness mirrors the supervisor (compile → recordResolved → after-compile dispatch on phase-bound nodes → recompile → emit → apply). Confirmations: the AUTH-SEAM phase copy + def-children adoption + retention destroy (destroyed flag + kept walk slot; the destroyed def child's ELEMENT is pruned from the emitted set — DEFECT #20 FIXED 2026-08-16, tests N4/N5 — the checks assert the retention half). **REQ-GAP-11 (2026-08-22 — the self-evicting sweep):** `allNodes()` = the live-tree scan, so the destroyed-retention lookups were re-expressed to the FAMILY WALK (the retention letter's assertable half) — S1a/S1b find the destroyed dropdown via the chip's `children`, S9 finds the destroyed toast via the stack's `children`; `getNode(id)` still resolves destroyed nodes (the private destroyed-ref tombstone — no-usable-state/[] semantics intact); the read-only userData passthrough (captured at translate — no manual wiring); `receiveNextState({children})` → ONE layer-apply (minted family children; re-injection OO-2 no-op; `{children: []}` is NOT a teardown; mint is one level — nested children/anchors dropped); clientAPI destroy as the clear path; event args (`event.value`); honest QueryUtils walks (findNode by the consumer's OWN authored class — the def's classes are not findable, render.md SED-1 read-side pin); parent-walk + sibling mutation; css state-slices; throwing-handler containment; append-with-override multi-handler nodes; the shim-DAG counting discipline (§14.2 rule 6 — count emitted els). Profile `[handlers-scenarios:profile] … census(registered/inTree/unplaced/destroyed/prototypes/cloneOps) …` vs the builder-embedded expected census (equality guard) + residual coverage; banner `handlers-scenarios: 25 passed`. Builder: `scripts/handlers-scenarios-page.mjs` (page 20) |
| `demo/hooks-scenarios.js` (smoke) | **THE VALUE-PROVIDER SLOT SPA page (2026-08-16, docs/specs/hooks-map-review.md §7 — contract amendment B, IMPLEMENTED; decisions.md HOOKS row):** ONE legacy envelope whose root carries the THREE scalar value providers (`theme`/`user`/`counter` component value bindings) + the authored `hooks: ['theme','user','counter']` field (the root is a PURE provider — F3-dropped from render, "a value holder, never an element" — its family children, the three scenario CARDS, render). The cards' consumer readouts (component target bindings + derived `bindings.*` bakes) show the hook values as text + baked props; the CONTROL buttons' click bodies (function-STRING data, the seam's `(event, context)` format) write `hooks.<name>` through the MANAGED CHANNEL — `context.clientAPI.apply(providerId, [{targetProp: 'hooks.<name>', mode: 'replace', value}])`, the provider found by a FAMILY walk to the top (`while (provider.parent)`) — never direct node access (api.md §1 letter; §7.2 pin 1). Confirmations: the S1 theme-switcher + S2 login/logout writes cascade into the readouts (text + the derived bakes) through the inherited E2E-3 consumer walk; S3's live counter treats the control as the EXTERNAL-source boundary (the event arg carries the incoming absolute count — the body never reads a value back); S4 pins the USER CONTRACT — N hook writes land ONE deterministic `hook-<name>` replace-in-place layer (the page publishes `maxHookLayers` on the profile; the smoke asserts == 1) + the cascade actually re-renders + the `hook-name-unresolved` / `hook-mode-blocked` rejections + the `hook-seam-exempt` no-op on a def-shaped provider (`SetTheme`'s `{name, body}`). Profile `[hooks-scenarios:profile] … hookWrites/maxHookLayers … census(registered/inTree/unplaced/destroyed/prototypes/cloneOps) …` vs the builder-embedded expected census (equality guard) + residual coverage; banner `hooks-scenarios: 16 passed`. Builder: `scripts/hooks-scenarios-page.mjs` (page 21) |
| `demo/rows-scenarios.js` (smoke) | **FEATURE 1/1.5 — THE ROWS-MINT DEMO GATE + the FEATURE 1a ROUND-TRIP arm (2026-08-24, next-feature-batch-0.2.0.md §Feature 1.5/§1a; decisions.md DEF-PROTOTYPE-CENSUS row):** ONE legacy envelope (a root + a NESTED consumers section — the consumers must be ANCESTORS of the minted rows, since the compile fan-out's hit order is own → viable DESCENDANTS → ancestors, resolve.ts fitReference §2.5) whose `#rows-list` carries the `hooksKind` declaration (`product-list: 'component'`), the REGISTERED def prototype (a def-shaped `template.component` value resolved by rows-mint BY NAME — protos[0] supplies the minted rows' type/css defaults, so the rows ship as pure field data), the CROSS-ROW consumers (targets on the row field names — one bare `reference: 'name'` + authored derived, two K2 `target: 'props.<field>'` synthesized bakes), and the MINT CONTROL (a button whose function-STRING body walks to the `.rows-list` view, resolves the LIVE node via the context's real-supervisor passthrough — the DATA-FIX: `clientAPI.apply` resolves string refs only for `to`/`source`/`container`, and the rows-mint branch reads `op.target` as a LIVE Node — and applies rows-mint with the 8 product rows embedded). Confirmations: 8 rows minted into the family tree (the F3 letter — minted rows are PURE providers, "value holders, never an element"; their DOM materialization IS the consumers' per-row arms, hooks-array-injection-review §3); per-row value-bearing source anchors; the fan-out census (states-per-consumer = 8 = rows, ratio 1.0) + the Feature 1.4 LINEARITY pin (fanoutStates ≤ 2 × fanoutRows; the `fan-out-blowup` tripwire silent during the mint flush); the per-row values in the DOM (8 consumer arms each carrying its field value); the node-scoped layer (DEFECT #23) + the Option-C batches record; re-mint no-accumulation (same-layerId replace); and the 1a ROUND TRIP (serialize → loadState → seed on a FRESH createLinkHub → reconcile → reRegisterDefPrototypes → the HOST re-mint per `batches[hookName]` — steps 1.5/4.5 — the rows-are-data pin: the minted rows never ship as nodes, the record round-trips, the re-mint replaces in place via the round-tripping layerId, twice = still 8). Profile `[rows:profile] … rowsMinted/fanoutStates/fanoutRows … census(registered/inTree/unplaced/destroyed/prototypes/cloneOps) …` vs the builder-embedded expected (equality guard, incl. the click-driven mint through the real handler seam) + residual coverage; banner `rows-scenarios: 10 passed`. Builder: `scripts/rows-scenarios-page.mjs` (page 25) |
| `tests/unit/path-emit.test.ts` — P-EMIT-8 (LANDED 2026-08-19) | **DEFECT #24 FIXED — the def-internal drop-zone case:** placed content resolving into a def-CHILD drop-zone (a placement container inside a def-root's child subtree — the live-prod/Logged-inLanding navBar's adminLinks/authorLinks/contributorLinks/navAdditionalLinks). RED→GREEN: the placed packet targeting a def-child container previously compiled 0 actionable states (container minted out-of-tree as `prototype`) and emitted nothing. FIX: the SEAM RESOLUTION CASCADE (`stateChildAnchor`) — a children-target seam under an in-tree consumer realizes the def subtree in-tree for resolution (the placement cascade reaches the def-internal containers), while seam-delivered def nodes stay carrier-silent (their standalone compilePath is suppressed — the def-fill ships the authored truth, no double-element) and the children-target seam no longer copies the def child's container anchors onto the def-root (a redundant zone host). **P-EMIT-10 (2026-08-19)** extends the emit pin to NON-ROOT seam consumers: the def-fill adoption chain is the consumer's FULL root-down state trace + def-root (not `[consumer, defRoot]`) — the live nav slot is a 3rd-level element, and its placed links nested under the def-fill zone only after the full-chain fix (pre-fix RED: Admin stayed an unreferenced forest root). **P-EMIT-11 (2026-08-19, DEFECT #25)** pins the SED-1 type-collapse carrying the def's authored data: a placed wrapper div collapsing into a def with `content` + `props` emits `<a>` with text + href (pre-fix: element took type + css only — def content/props were dropped). Canonical spec line now lives in placement-path-spec.md §10.ag. Tests: path-emit P-EMIT-8 (red→green) + P-EMIT-10 (red→green) + P-EMIT-11 (red→green) + legacy-shape-ops [5] (re-pinned carrier) + the legacy-shape census (in-tree 11→14, prototypes 6→3). Record: docs/defects.md DEFECT #24 (FIXED + FOLLOW-UP) + DEFECT #25 (FIXED); archive/defects/2026-08-19/2026-08-19-defect-24-def-internal-dropzone.md |
| `tests/unit/path-emit.test.ts` — P-EMIT-12/13 (LANDED 2026-08-19) | **DEFECT #26 FIXED — the def-fill family surfaces a node's COMPILED handlers as `on:<event>` props.** RED→GREEN: the plain path-state branch (render-helpers.ts:1114-1119) was the ONLY handler→`on:*` conversion site, so a handler-bearing element materializing through a seam rendered DEAD — the seam compiled `seam-handlers` layers onto IN-TREE def-realized nodes (the live-prod/Logged-inLanding auth controls: Sign In / Profile `ToggleUserDropdown:click`, Logout `LogoutHandler:click`, and the Edit Mode SED-1 collapsed link `enterEditMode:click`), but `emitDefChildTree`/`emitDefRootElement`/the SED-1 collapse built props from def spec + prototype css/props and never consulted `node.handlers`. Show Comments (NOT behind a def seam → plain path-state emit) was the wired control. FIX: `mergeHandlerProps` (render-helpers.ts) at every def-fill site — the real node behind the synthetic element (def-child proto.id / def-root proto.id / the consumer `s.nodeId`) contributes `on:<event>` for each compiled handler, mirroring the plain branch; `diffMinimal` carries the listeners, `DomAdapter` attaches them. Tests (TDD): path-emit P-EMIT-12 (children-seam def child red→green) + P-EMIT-13 (SED-1 collapse red→green). Record: docs/defects.md DEFECT #26 (FIXED); handlers.md §6 S45 split (seam-delivered def-child bindings WORK; pure out-of-tree remain inert) |
## 12. Demo pages (`npm run demo` → http://localhost:4173/demo/)

- `ssr-render.html` — SSR doc → client re-render, parity, resolved
  providers (Unit 11 re-expression: the dock consumes `feed-a` + `feed-b` —
  two DISTINCT provider names, one state carrying both bindings; the
  same-name `feed` ×2 fork claim is an anti-pattern, placement-path-spec
  §10.ad).
- `loop-safety.html` — each probe with expected behavior + structure.
- `components.html` — everything framework-rendered; placements,
  components, user pane (login/logout), markdown editor → display
  (in-place, focus-safe), tests as content nodes.
- `feature-matrix.html` — the single "every surface" document: a legacy
  envelope re-resolved from its serialized anchors (S4.2), session pane +
  markdown editor via after-compile/input handlers (the `session` provider
  is data-declared on the root — `template.component` value binding → SOURCE
  anchor, K6; the root's runtime duplex consumer half of `session` and the
  theme-fork/loop providers are runtime-only additions, since `target` is a
  local apply path and never a second component name), content/comments payload
  lifecycle (append websocket comment, refresh article in place, drop
  comments — sibling payload untouched), the two DISTINCT theme providers
  (`theme-dark`/`theme-light` — one resolved state per consumer, never a
  same-name fork arm, placement-path-spec §10.ad),
  loop-safety drops, reverse translation round-trip, and PAR-5 parity
  against the server-embedded render signature + SSR hydrate seam check.
  Its smoke mirrors the vitest surface in the browser (`runner` list).
  The concrete DOM adapter exercised here is `src/core/adapters.ts`
  `DomAdapter` (canonicalized by `docs/specs/adapters.md` §3) imported from
  `dist/core/*` — the demos carry NO render machinery of their own; only
  handlers, fixtures, and the shared harness live in `demo/`. The SSR
  fragment adapter's `toString()` parity is checked by
  `tests/e2e/ssr-render.test.ts`.
- `mode-toggle.html` — the same feature-matrix document, rendered through
  three adapter modes chosen by a toggle bar. **Demo-page test case — NOT
  expected real-world behavior**: no production app switches one document
  between SSR/client/markdown adapters on a single URL; the page is a
  comparative test fixture for the three adapter surfaces and their harness
  checks. Every build embeds BOTH mode payloads (the SSR html string + the
  raw markdown source), so `?mode=` switching works under any static serve;
  `data-mode` + section `hidden` state control which is revealed:
  - **SSR adapter** (`?mode=ssr`) — the page embeds the FULL HTML the
    server rendered through the real `SSRFragmentAdapter` (raw string in
    `received-html-data` + a parsed mount). Open devtools → Network → the
    mode-toggle request → Response to see the whole `<app>…</app>`
    document. The harness asserts the received HTML begins with the app
    root, contains every key presentation id, and is well-formed (balanced
    non-void tags).
  - **Client render** (`?mode=client`) — the browser re-resolves
    `preempt-initial-data` and renders directly; the SSR/markdown payloads
    stay embedded but hidden.
  - **Markdown mode** (`?mode=markdown`) — the RAW markdown editor source is
    embedded verbatim for manual inspection, alongside the live parsed
    display (`#markdown-live`) the harness restores from the shipped source;
    the harness asserts the raw source is embedded and the live display
    re-parsed it.
  `scripts/serve-demo.mjs` still serves the page per-`?mode=` (and
  `scripts/build-demo.mjs` emits the static default); every mode drives the
  same shared harness (`demo/lib/feature-matrix-tests.js`) that
  `feature-matrix.js` uses. Session lessons: `archive/reviews/2026-08-15/2026-08-15-session-defect-review.md`.
- `fork-stress-d{2,4,6,8,9,10,11,12,14}.html` — layered stress test of the
  forking render system. **Demo-page test case — NOT expected real-world
  behavior.** A binary tree built layer by layer; each layer adds exactly 2
  children per node through one of the four runtime child-creation
  mechanisms, cycling: placement → component values → component link →
  idempotent handler → repeats with different placement/component names.
Depth d has layers 1..d−1 (layer k has 2^k nodes), total 2^d − 1. **d14
   (2^14 − 1 = 16383 nodes) is the SCALING PROBE (added 2026-08-16):** the d12
   totals (~150-800ms post the timer-drain + findEl fixes) are too fast to
   expose pipeline scaling, so depth 14 joins the family (RE-SCOPED 2026-08-16:
   the d14 page is BUILT-BUT-NOT-SMOKE-RUN — a manual/browser scaling probe;
   the automated smoke runs depths 2..12 only); its handler-marked
   census includes the depth≥13 L12 handler layer (4368 marked). Every
  node renders its `stress:layers` chain (depth + tree-back-to-root) AND a
  different css property per level with a value per sibling slot (compile-
  lookup stressor; the `levelCss` helper is **demo-only** — see §14.3). The page uses ONLY core (`dist/core/*`) and
  handler code — the serializable part (L1 placement, L2 values, L3 link) is
  shipped in `preempt-initial-data`; the browser module drives the runtime
  layers (L4 handler, L5 placement, L6 values, L7 link, … up to L11) via the
  `attach` op, component sources/targets, and idempotent `after-compile`
  handlers (guarded by their layer marker — the default guard against
  after-assembly loops). Spec: `docs/specs/fork-stress.md`.
- `fork-stress-data-d{2,4,6,8,9,10,11,12,14}.html` — DATA-DRIVEN variant of the
  fork-stress page. **Demo-page test case — NOT expected real-world
  behavior.** The page input is a LEGACY envelope (`forkStressLegacyData(depth)`:
  root + two prototype nodes per layer, one per sibling slot), NOT a
  serialized anchor document — `translateLegacy` parses it. Handlers are
  declared BY NAME in the data (`handlers: [{ name, phase }]`); the page
  supplies the body per name and installs it on each prototype (`addLayer`),
  so the clone inherits it. The page kicks off layer 1 by cloning the
  prototypes onto the root (`clone-instance` op — the supervisor registers +
  attaches + marks the copy pass-2 dirty); each clone's inherited
  `after-compile` expands the next layer by cloning the layer+1 prototypes
under it (recursive assembly — depth 12 = 4095 nodes, depth 14 = 16383;
   the d14 page is BUILT-BUT-NOT-SMOKE-RUN — a manual/browser scaling probe;
   the automated smoke runs depths 2..12).
   HandlerContext
  identifies the clone it runs on via `c.node` (variant A — per-dispatch
  context enrichment), reads its own layer from props, and expands ITSELF
  exactly once (O(1) per firing — no page-side queue, no graph scans). No
  self-ops at all: `stress:expanded` is DERIVED on the prototypes
  (`children.length > 0` — derived-state.md §9.2), so each clone's body
  fires exactly once per flush and is never re-dirtied (handlerCalls 4094 at
  d12, half the marker-op era's 8188); the parent bakes the CHILDREN's
  `stress:layers` chain onto the fresh copy at creation. The page uses ONLY
  core (`dist/core/*`) + the shared data-derivation helpers (`levelCss`/
  `cssPropForLevel`/`LAYER_METHODS` — demo-only, see §14.3) — no
   demo-fixtures, no demo-side render machinery. Its runner checks mirror the
   imperative page's: per-layer counts + total (re-pinned per
   placement-path-spec §5.2 F-13: the prototypes are contentNodes-owned
   family-in-tree — in-tree = 2^depth − 1 + prototypes, unplaced = 0 —
   but never compile/render), css property/slot pairs,
   `stress:kind` per mechanism, DOM nesting vs graph children, ancestry
   chains, derived idempotency (resolved-state `stress:expanded`), and the
   incremental-render contract (bootstrap the only full compile). Spec:
   `docs/specs/fork-stress-data.md` + `docs/specs/placement-path-spec.md` §5.2.
- `fork-stress-data-{placement,values,link}-d{12,14}.html` — the SINGLE-METHOD
  variants at BOTH depths (spec §4): the whole tree relies on ONE mechanism.
  d12 = the original variants (smoke-pinned with the d12 placement baseline +
  2.5× totals ratio guard); d14 = the SCALING PROBES (added 2026-08-16 — the
  d12 pass-2 totals are too fast to expose the scaling shape; RE-SCOPED
  2026-08-16: the d14 variants are BUILT-BUT-NOT-SMOKE-RUN — manual/browser
  probes, the smoke runs d12 only).
  placement-only is pure clone structure; values-only adds `component`
  refs WITH the scalar VALUE to every prototype (a value-bearing binding is
  a legacy `component` SOURCE — translate.md §2 — and clone-instance
  inherits it with its value, so every clone renders its resolved value as
  text); link-only adds `component` refs whose VALUE is the component DEF
  (every clone's emission re-types the next layer — the recursive def
  chain). All sources are declared in the envelope — the page never
  attaches an anchor. The root carries no sources and emits like every
  node; nesting walks from the root, 2^depth − 1 elements. Banner:
  `Fork Stress (data: <method>) — depth <dN>`.
- `path-fork-data.html`, `path-fork-data-values-d12.html`,
  `path-fork-data-link-d12.html`, `path-fork-data-{placement,values,link}-d14.html`
  — the DERIVED TRIO (placement / values /
  link — derived-fork-variants-review §5.1): the runtime fork-stress page's
  static twin, the SAME 2·(depth−1)-prototype binary topology compiled by the
  path enumeration instead of clone-instance assembly — the trio framing: the
  runtime clone pages stay as LEGACY STRESS (clone-instance + after-compile
  expansion); the derived pages are the INTENT (the wiring state enlarged to
  act as a derived layer over the graph — one element per path-state, ZERO
  clones). The d12 pages (the original trio; `path-fork-data.html` is the
  placement FAMILY BASELINE) carry the root + two prototypes per layer
  1..11, each declaring `placementName` (producer — the 'container' role)
  and, for layers ≥ 2, `targetPlacement: ['zone-<k-1>']` (consumer — the
  R2.2 sibling-shared owner-name topology: both level-(k−1) prototypes own
  the shared zone name, so the chosen name's two containers fan out the
path per hop). The **d14 trio (`path-fork-data-{placement,values,link}-d14.html`,
   27 nodes / 16383 path-states — added 2026-08-16 as the SCALING PROBES)** is
   the same topology parameterized by depth (the d14 placement page is the d14
   family baseline; RE-SCOPED 2026-08-16: the d14 trio is BUILT-BUT-NOT-
   SMOKE-RUN — manual/browser scaling probes; the smoke pins the d12 FAMILY
   baseline + the values/link per-region 2.5× pins only). The values/link variants
  add the per-method component
  fields on the prototypes (values: `{reference: 'values-<k>.<slot>',
  value: 'value-<SLOT>-<k>'}`; link: `{reference: 'link-<k>', value:
  linkDefForLevel(k)}`) — NO handlers, NO stress:handler residue (the
  derived model has no after-compile expansion). The page is translate →
  register → ONE `compilePath` bootstrap → emitElements/diffMinimal/
  applyOps (DomAdapter) → render: 2^depth − 1 path-states from 2·depth−1
  graph nodes, no
  nodes created (E2E-1), every element a pathKey wire. Checks (per method):
  the static census (2·depth−1/2·depth−1/0/0/0), state census (2^depth − 1
  distinct pathKeys,
  forkKey = pathKey), element census + per-level 2^k counts (the LINK page:
  2^depth − 1 post the covered-leaf def-fill gate, DEFECT #21; its re-typed
  def-chain children are BARE-keyed with no forkKey — the adapter-key
  asymmetry), css property/slot pairs, derived `stress:expanded`
  idempotency (element assertions scoped to standalone-emitted states on
  the link page — the `method !== 'link'` exemption), `treeFromOps`
  binary-shape
  reconstruction, PAR-5 structural parity with the builder's
  `SSRFragmentAdapter` snapshot (wire- and forkKey-agnostic signature —
  the page re-translates the legacy envelope, so node ids are mint-time
  artifacts; authored prototype ids keep the props dimension stable),
  plus the per-method mechanism checks (values: text-vs-resolved-value per
  path-state; link: div type + def content for k > 1 + the child's OWN
  props on re-typed elements + the 4092 re-typed-element pin). Profile
  `[derived-fork:profile] method=<m> … states=4095 passes=1 …`; the smoke
  pins the census + residual coverage + the FAMILY baseline (per-region,
  placement-derived — `[derived-fork:baseline]`; values/link pin each
  region within 2.5× — `[derived-fork:pin]`; §8-Q6 split; the runtime 2×
  tripwire unchanged). CORE ONLY (`dist/core/*`) + the shared `levelCss`/
  `cssPropForLevel`/`linkDefForLevel` helpers. Builder:
  `scripts/path-fork-page.mjs`.
- `feature-showcase.html` + `feature-showcase.expected.html` — the FEATURE
  SHOWCASE: ONE legacy envelope demonstrating the framework's advertised
  features BOTH isolated (feature-lab cards) and combined (ops dashboard),
  driven ENTIRELY from the JSON + the documented core interfaces
  (`translateLegacy → Supervisor → createClient → DomAdapter →
  emitElements/diffMinimal/applyOps → dispatchEvent`/`runPhase`). Handler
  bodies ship as function-STRING data (translate.md §2), so there is NO
  page-side feature logic — anything that would need an outside script is
  a data-authoring mistake. Features: root tree/`children` (translate.md
  TR-H1), depth-0 scalar source consumed by two descendants (S-R2.6),
  same-name self-providers rendering their own values (multiplicity,
  S-R2.5 — no coerced pick), provide-and-self-apply (K1/K2: the `mood` node
  carries `{reference, value, target: 'props.moodPanel'}` — its own published
  value bakes into its compiled props via the synthesized `bindings.*`
  derived read; the two-name duplex anchor shape is runtime-only and never
  appears in legacy data), the scoped
  cross-scope unresolved fail-state (api.md §4.3), `unresolved-reference`
  + `circular-source` A↔B borrow-walk loop pair authored via the K7 ARRAY
  form — loop-a declares `component: [{reference: 'loop.x', value: 'A'},
  {reference: 'loop.y'}]` (provider + consumer on ONE node) and its child
  loop-b mirrors the flip (both arms dropped at
  compile — never rendered — while the page still renders, no hang), derived DSL bakes (`bindings.*`,
  `children.length`, `pathKey`, `$concat`/`$if`/`$eq`/`$gt`, `placement`,
  `unresolved.length`), on:input/on:click string-body handlers
  (state-slice to a sibling preview), one-shot idempotent after-compile
  phase handler (`runPhase`), throwing-handler containment, placement
  anchor badge, css id/classes/style, contentNodes-owned content payloads
  (family-in-tree via the permanent-owner token, never rendered — P3
  §10.ad/F-13), clientConfig adapter/persistence gates. The expected
  output page is generated from the SAME envelope through the real
  `SSRFragmentAdapter` (PAR-5 parity). Banner: `feature-showcase`. The
  page module mirrors the fork-stress-data discipline (core-only, checks
  walk the #app subtree so they run under the smoke shim too). Companion
  summary: `docs/framework-feature-summary.md`.
- `translate-showcase.html` + `translate-showcase.expected.html` — the
  TRANSLATE-KERNEL showcase: one legacy envelope exercising every K1–K8
  behavior with its intended result, driven only through core
  (`translateLegacy → reverseTranslate` + the render plumbing) with the
  K4 warnings channel rendered into the page. Cards: legal K7 array form
  (distinct reference + distinct target; K1 synthesis; provide-and-self-apply),
  plain consumer of the root's K6 provider, duplicate reference + duplicate
  target pre-anchor blocks, vacuous `{}` warn+skip (K3), `component: []`
  valid empty multi-binding form, unresolved consumer with derived
  key-omission (S-R4.3), `props.name.` syntax-edge skip (D7), unknown-path
  gap warn (NP1), dotted-reference carve-out (K2), and the K5/N1 reverse
  round-trip (apply path persists as `target`; synthesized derived stripped,
  authored derived kept; re-translate fires no warnings). Built by
  `scripts/translate-showcase-page.mjs` (PAR-5 expected page through the
  real `SSRFragmentAdapter`). Banner: `translate-showcase`. Wired into
  `npm run demo:build` (page 18) + `demo:smoke` (seeded,
  `__translateShowcaseDone` awaited, banner assertion).
- `legacy-shape.html` + `legacy-shape.expected.html` — the REAL-LEGACY-SHAPE
  regression page (2026-08-14 — the fix-pass plan item 5 pin for the
  live-prod placeholderLanding dispositions D1–D8; **LANDED 2026-08-15**):
  a production-shaped
  legacy envelope in the placeholderLanding style — the blind-test
  translate-stack fixture (tests/blind/translate-stack-fixture.json) adapted
  with authored `props.id` (deterministic PAR-5 signature) + one nested
  media-query cssDef rule. Placement is authored as
  canonical `placement: [...]` ARRAYS (producer `placementName` — the
  side-zone asides — plus consumer `targetPlacement` — the placed item's
  `['no-such-zone', 'side-zone']` first-match fan-out), each entry mapped
  through the single-entry logic
  (D1); `css.style` is authored as OBJECTS and translate serializes them to
  kebab-case `k: v;` strings — the rendered page carries no
  `style="[object Object]"` (D3); `css.cssDef` StyleNodes render as real,
  rule-signature-deduped stylesheet rules (a nested media-query rule
  included) from ACTIONABLE states only (D4/F10 — 6 unique rules in ONE
  styles op); `doc.content` is a
  `ContentPayload[]` array and the obsolete single-payload object form is
  exercised on a side card as the `payload-shape-obsolete` K4 warn (D2);
  the three seam targets materialize through the D7 anchor-layer seam — the
  h1's `{target: 'content', reference: titleDef}` delivers the def's TEXT
  only (F13/SED-3); the span's `{target: 'type', reference: badgeDef}`
  SHELL-COLLAPSES into the def button (SED-1: def type + css + def child
  strong, NO def content text, no surviving wrapper); the div.blind-shell's
  `{target: 'children', reference: menuDef}` renders as its
  OWN shell element containing the DEF-ROOT element (`div.blind-shell >
  [p, nav.blind-menu > [logo, links]]`: def type + classes + cssDef rules on
  the def element — delivery-shape ruling SED-2, no empty shells, no def
  classes on the wrapper) with the def's root + children staying out-of-tree
  pre-minted `'component'`-token prototypes (6 prototypes —
  never emitted by the
  host, no count-mismatch clobber, no stray span.blind-title — D8/F16);
  multi-zone placement fans the item into BOTH side-zone asides with the
  FIRST targetPlacement choice missing (activePlacement = 'side-zone',
  pathKey = forkKey, §1.2/§2.5) and the styled asides stay VISIBLE
  (EMPTY-OWNER authored-text/style exemption).
  The expected-output page
  is generated from the SAME envelope through the real
  `SSRFragmentAdapter` (PAR-5 parity — the shape-signature digest
  `serverTreeSig` + embedded fragments for the main envelope AND the two
  side cards). Banner: `legacy-shape`. CORE ONLY
  (`dist/core/*`); builder `scripts/legacy-shape-page.mjs`. Wired into
  `npm run demo:build` (page 19) + `demo:smoke` (seeded, `__legacyShapeDone`
  awaited, `[legacy-shape:profile]` census pinned).
- `legacy-handlers.html` — **PENDING-page (the legacy-handlers demo page does
  NOT exist yet — 2026-08-15)**. The runtime-bridge showcase the review §8
  promised (archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review.md):
  the placeholderLanding-shaped envelope with the six defs wired
  via `handlers.<event>` targets, the bridge's runtime surfaces exercised in
  the browser): the seam-installed `(event, context)` bodies dispatching
  through the wrapper + event stub, NodeView reads (parent walk, css style
  OBJECT on read, component maps), QueryUtils honest/unsupported queries
  (`legacy-query-unsupported` warn), the userData read-only passthrough, the
  `receiveNextState` state-slice + `{children}` ONE-layer-apply writes
  (origin-owned minted children; teardown is engine-side only — a body
  clears minted children by destroying them, handlers.md §6), and the
  window-guarded enterEditMode fetch path. Build rules per the bridge's own discipline:
  core-only (`dist/core/*`), handler bodies as function-STRING data with
  explicit `format` markers, no demo-side render machinery. The unit
  surface is fully pinned meanwhile by `tests/unit/legacy-bridge.test.ts`
  (B1–B8) + `scripts/stress-probes/blind4-bridge-probe.mjs`. Builder
  (future): `scripts/legacy-handlers-page.mjs`.
- `handlers-scenarios.html` — **blind test #5 (2026-08-16): the MOCKED
  REAL-WORLD HANDLER page** (`docs/specs/handlers-scenarios.md`): ten
  mocked use-case cards driven by LEGACY envelopes alone (function-STRING
  bodies) through ONLY `dist/core/*` — the AUTH-SEAM auth dropdown
  rendered TWICE (no-userData anon → Sign-In LINK + retention-destroyed
  dropdown; `{username:'alice'}` → Profile ▼ + alive dropdown; an AUTHORED
  header logout control — def-child bindings are inert, handlers.md §6),
  comments load/refresh/clear (layer-apply children injection, OO-2
  idempotent re-injection, per-child destroy as the clear path),
  weather card (event.value arg → content/props/css writes), cart badge
  (parent walk + honest classes query), search filter (first-dispatch
  injection; re-dispatch never accumulates), tabs (css state-slices
  across family children), form submit (preventDefault + validation),
  throwing-handler containment with a pre-throw write, toast (leaf minted
  child + AUTHORED dismiss — the mint drops nested children/anchors),
  multi-handler node (append-with-override). Banner `handlers-scenarios`;
  the smoke seeds the page, awaits `__handlersScenariosDone`, asserts the
  profile residual + the census equality vs the builder-embedded expected,
  and the banner (25 passed). Builder: `scripts/handlers-scenarios-page.mjs`
  (page 20). The smoke checks count EMITTED els (the shim DOM is a DAG —
  §14.2 rule 6). **REQ-GAP-11 (2026-08-22):** the destroyed-retention checks
  (S1a/S1b/S9) locate the destroyed nodes via the FAMILY WALK (`chip.children` /
  `stack.children` — the retention letter's assertable half) since `allNodes()`
  is now the live-tree scan; `getNode(id)` still resolves them (destroyed-ref
  tombstone). Spec: `docs/specs/handlers-scenarios.md`.
- `hooks-scenarios.html` — **the VALUE-PROVIDER SLOT SPA page (2026-08-16;
  `docs/specs/hooks-map-review.md` §7 contract amendment B, IMPLEMENTED —
  decisions.md HOOKS row)**: one SPA envelope, three real-world scenarios.
  The root carries the scalar value providers (`theme`/`user`/`counter` +
  the authored `hooks: [...]` field) and is a PURE PROVIDER — F3-dropped
  from render, "a value holder, never an element" — while its family
  children, the scenario CARDS, render: a THEME SWITCHER (light/dark
  writes cascade into the readout text + the derived `themeName` bake), a
  USER/SESSION panel (login/logout writes repopulate the session readout),
  and a LIVE COUNTER/BADGE (the control is the EXTERNAL-source boundary —
  the event arg carries the incoming count; the badge follows every push).
  Every control is an authored button whose function-STRING click body
  writes `hooks.<name>` through the MANAGED CHANNEL
  (`context.clientAPI.apply(id, [{targetProp: 'hooks.<name>', mode:
  'replace', value}])`), finding the provider by a family walk to the top
  of the chain — never direct node access. The page checks pin the USER
  CONTRACT: N hook writes land ONE deterministic `hook-<name>`
  replace-in-place layer (the profile publishes `maxHookLayers`; the smoke
  asserts == 1) + the cascade actually re-renders the consumers + the
  `hook-name-unresolved` / `hook-mode-blocked` rejections + the
  `hook-seam-exempt` no-op on a def-shaped provider. Banner
  `hooks-scenarios` (16 passed); the smoke asserts the profile residual +
  the census equality vs the builder-embedded expected. Builder:
  `scripts/hooks-scenarios-page.mjs` (page 21). Hooks authoring rules:
  §14.10.
- **AUTH-SEAM (2026-08-16) — covered by unit tests AND the handlers-
  scenarios demo page:** the auth pattern (`handlers.afterAssembly` → the
  after-compile phase on the type-target consumer, incl. the NESTED
  def-in-def consumer) is pinned by `tests/unit/legacy-bridge.test.ts`
  AUTH-SEAM (AU1–AU3 + N1–N3) + the legacy-shape-translate [H4] update,
  and exercised in the browser by `handlers-scenarios.html` (S1 — the
  earlier "NO new demo page" note is SUPERSEDED); the
  placeholderLanding corpus pages and the other existing demo pages are
  unchanged (decisions.md AUTH-SEAM row).
- `session-features.html` — **the SESSION-FEATURES blind-test scenario page
  (2026-08-20, `docs/specs/landed-features-scenarios.md` — EXECUTED)**: three
  card groups covering the three landed session features through ONE legacy
  envelope per scenario (13 mounts). (Group 1) the `css.classes` injection
  seam — provider-colored badge (scalar append), array-form multi-class
  injection, missing-source keeps authored, blocked `css.*` targets warn+skip,
  the `target: 'css.classes'` round-trip;   (Group 2) retained-handler-map
  listener lifecycle — a self-removing handler detaches (a `handlers`
  state-slice `value: []` CLEARS durably — DEFECT #27 FIXED 2026-08-20 — the
  diff emits `set('on:click', undefined)` → retained-map detach) and element
  removal purges the listener (removeEl → DOM-F7); (Group 3) `Supervisor.dispatchEvent`
  engine entry — drive a control through the ENGINE entry (not onEvent),
  fork-arm wire once-fire with all arms in `ctx.states`, unknown/destroyed → `[]`,
  read-only dispatch re-renders nothing, no propagation, same-(node,event)
  reentrancy vs different-event. Every interaction dispatches via
  `Supervisor.dispatchEvent` (Group 3 is the seam the other groups'
  interactions already use — cross-coverage is intended). Banner
  `session-features` (28 checks); the smoke seeds the page, awaits
  `__sessionFeaturesDone`, asserts the profile residual + the census equality
  vs the builder-embedded expected, and the banner. Builder:
  `scripts/session-features-page.mjs` (page 23). Spec:
  `docs/specs/landed-features-scenarios.md`; findings:
  `archive/findings/2026-08-20/2026-08-20-session-features-blind-test.md`
  (S2.1 self-removal → DEFECT #27 FIXED; S2.2 destroy dissolves the shared
  family link — data re-express; S3.2 fork needs equal-depth providers).
- `producing-host.html` — **the REQ-GAP-8 blind-test scenario page
  (2026-08-21, `docs/specs/landed-features-scenarios.md` Group 4 —
  EXECUTED)**: the exported canonical re-emit loop `renderProducingProcess`
  threading the opt-in `renderOptions` parameter through to `emitElements`.
  Four card groups + controls (5 mounts, 15 checks). (Group 4.1) OPT-IN
  threading — every emitted element carries `data:node-id` = a real
  nodeById key; ops stream carries the `data:` prop; DOM adapter sets the
  attribute. (Group 4.2) DEFAULT OFF — no `data:node-id` anywhere;
  byte-identical render. (Group 4.3) prevMap chain — re-render after
  mutation keeps stamping; incremental (set-only, no re-creates); third
  no-change render yields zero ops. (Group 4.4) destroy-prune — destroyed
  wire removed never re-created; survivors keep stamp. Controls: barrel
  export identity; op stream well-formedness. Banner `producing-host` (15
  checks); the smoke seeds the page, awaits `__producingHostDone`, asserts
  the profile residual + the census equality vs the builder-embedded
  expected, and the banner. Builder: `scripts/producing-host-page.mjs`
  (page 24). Spec: `docs/specs/landed-features-scenarios.md` Group 4;
  findings: `archive/findings/2026-08-21/2026-08-21-producing-host-blind-test.md`
  (page-reviewer data fixes: mount-key mismatch, applyOp options passthrough,
  destroy-check timing — all data-only, no engine defects).
- `rows-scenarios.html` — **the rows demo gate (2026-08-24,
  `docs/next-feature-batch-0.2.0.md` §Feature 1.5) + the Feature 1a
  round-trip arm**: ONE legacy envelope (root + a NESTED consumers section —
  the cross-row consumers must be ANCESTORS of the minted rows, resolve.ts
  fitReference §2.5 — with the `hooksKind` declaration, the registered def
  prototype `product-row` (a def-shaped `template.component` value; rows-mint
  resolves it BY NAME and protos[0] supplies the rows' type/css defaults, so
  the rows ship as pure field data), and the mint control whose function-
  STRING body drives rows-mint through `clientAPI.apply` (rows embedded).
  The checks pin: 8 minted rows in the family tree (the F3 letter — minted
  rows are pure providers, "value holders, never an element"; their DOM
  materialization IS the consumers' per-row arms), the per-row source
  anchors, the fan-out census (8 states per consumer ≤ 2×8 — the Feature
  1.4 linearity pin, `fan-out-blowup` silent), the per-row values in the DOM
  (8 consumer arms each), the node-scoped layer + Option-C record (DEFECT
  #23), the re-mint no-accumulation, and the round trip (serialize →
  loadState → seed → reconcile → reRegisterDefPrototypes → host re-mint per
  the batches record → row count unchanged, replace-in-place via the
  round-tripping layerId). Banner `rows-scenarios` (10 passed); the smoke
  seeds the page, awaits `__rowsScenariosDone`, asserts the profile residual,
  the census equality vs the builder-embedded expected (the builder drives
  the mint through the REAL handler seam too), the fan-out linearity guard,
  and the banner. Builder: `scripts/rows-scenarios-page.mjs` (page 25).

- `markdown-adapter-scenarios.html` + `.js` — **FEATURE 2 — MARKDOWN ADAPTER
  DEMO + BLIND-TEST PAGE (2026-08-24, handoffs-review-7.md D14 landing,
  decisions.md MARKDOWN-ADAPTER row).** ONE legacy envelope exercising a D3
  SUBSET: h1/h2 headings, a paragraph with strong/em/link-with-title, a
  blockquote containing a paragraph, a div wrapping a ul>li with a nested ol
  inside one li (the S17 transparent-container-wrapped list fix), a fenced
  pre, an hr, and an img. The page module translates the envelope, compiles,
  renders through `renderProducingProcess(…, new MarkdownAdapter(), null)` +
  `applyOps`, and asserts the `toString()` output via 7 runner checks (M1
  headings, M2 inline content, M3 blockquote, M4 list nesting/S17, M5 fenced
  pre, M6 hr, M7 img). NOT exercised here (unit-tested instead): h3-h6, b/i
  aliases, br, inline code, the on:*/data:* drop (D7), D9 escaping,
  span/section/article, D11 empty, D12 re-render. The blind-test loop
  (writer→proofreader→page-reviewer) verified the page; 1 engine defect was
  found PRE-loop during the authoring smoke (MD-BLIND-TEST-TEXT: `text` type
  classified as 'block' instead of 'inline' — fixed in adapters.ts `classify`).
  **Review resolutions (2026-08-25):** MD-PRE-ESCAPE FIXED (fence content is
  LITERAL — the 'pre' branch emits `node.text` verbatim); MD-INLINE-FILTER
  FIXED (`inlineContent` pulls ONLY true inline children — found by the
  mode-toggle arm integration test). **D14 mode-toggle arm LANDED 2026-08-25:**
  `?mode=markdown` embeds the SAME feature-matrix document rendered through the
  REAL MarkdownAdapter server-side (`renderFeatureMatrixMarkdown()` in
  scripts/feature-matrix-server.mjs → `#markdown-adapter-data` text/plain
  script → shown in `#markdown-adapter-raw`); the harness asserts it
  (mode-toggle markdown: 14 checks); the smoke's mode loop seeds + verifies
  it. Banner `markdown-adapter-scenarios` (7 passed); the smoke seeds the page,
  awaits `__markdownAdapterScenariosDone`, asserts the profile residual, and
  the banner. The `?mode=markdown` raw-editor-source fixture in `mode-toggle.*`
  stays a demo; the adapter output is the production shape.

- `journal-condensing-scenarios.html` + `.js` — **FEATURE 3 — JOURNAL
  CONDENSING DEMO (2026-08-25, handoffs-review-8.md D1-D10, decisions.md
  JOURNAL-CONDENSING row).** A supervisor with `maxJournalLength: 3`; a
  state-slice stream (6 ops) exceeds the threshold → the deferred microtask
  condense rewrites the pre-base entries into ONE `base` marker. The page
  module (core-only) asserts: the journal collapsed to a base marker + the
  post-base entries, the base marker's `{kind:'base', snapshot}` shape with
  `result:{status:'base'}`, a `replay()` graph-REPLACE (restore + post-base
  re-apply) reproducing the post-stream state, and a post-base `undo()` (D3
  id-resolution) operating on the restored graph. Banner
  `journal-condensing-scenarios` (4 passed); the smoke seeds the page, awaits
  `__journalCondensingScenariosDone`, asserts the profile residual + the
  `baseMarkers === 1` guard, and the banner. **D14 blind-test loop COMPLETE
  (2026-08-25 — writer → proofreader → page-reviewer; 4/4 checks PASS, no
  engine defects).**

- `preserve-reversal-scenarios.html` + `.js` — **FEATURE 4 — PRESERVE-BY-
  REVERSAL DEMO (2026-08-25, handoffs-review-9.md D1-D8, decisions.md
  PRESERVE-BY-REVERSAL row).** A layerApply mint with `preserveByReversal:true`
  makes the minted node's reverse output ship as authored (not excluded). The
  page module (core-only) builds a graph programmatically, mints via layerApply
  with the flag, calls reverseTranslate, and asserts: D1 the preserved node
  ships as authored in the reverse output (no layer machinery, no flag residue),
  D2 the whole-subtree cascade (an unpreserved inner descendant ships under the
  preserved parent), D3 not-promotion (the node stays minted — `originLayer`
  still set), and D4 flag loss on a same-hookName rows-mint re-mint (the layer
  is replaced flag-less → the re-minted rows are excluded). Banner
  `preserve-reversal-scenarios` (4 passed); the smoke seeds the page, awaits
  `__preserveReversalScenariosDone`, asserts the profile residual + the
  `preservedShipped`/`descendantsShipped`/`flagStillSet`/`reMintDroppedFlag`
  guards, and the banner. **D14 blind-test loop COMPLETE (2026-08-25:
  writer → proofreader → page-reviewer on Mimo-2.5; the page reviewer fixed the
  D4 data to a genuine same-hookName rows-mint re-mint — the initial D4 wrongly
  used `removeLayer` (the D3/promotion case) to simulate the replacement;
  no engine defects).**

## 13. Running checks

```
npm test           # vitest — full suite
npm run typecheck  # tsc --noEmit
npm run demo:smoke # headless run of all demo checks
npm run build      # tsc emit
```

## 14. Authoring rules & browser realism (learned from session defects)

Full defect-by-defect analysis: `archive/reviews/2026-08-15/2026-08-15-session-defect-review.md`. The rules:

### 14.1 Authoring data (fixtures / copy / expected strings)

1. **Node refs ≠ presentation ids.** `byName[x]` gives the *node ref*
   (`node-85`); rendered HTML/DOM carry `props.id` (`user-pane`). Assert on
   `props.id` when matching HTML/DOM; use node refs only for graph access.
2. **`css.classes` are data — styling is never inferred.** A node only gets
   its demo.css look if the fixture declares `css: { classes: [...] }`
   naming the selectors. Check demo.css first, then the fixture. (Hit twice:
   user-pane buttons, fork arms.)
3. **`content` + children both render** (no shadowing). A node with parsed
   children must NOT also carry base `content` — the concatenated result is
   the bug. Parsed-display containers have children only.
4. **Copy must match the DOM the fixture+harness produce.** If a section's
   text promises surviving siblings / a live display / N comments, the
   fixture must contain them and the harness must assert them. DOM-first,
   copy second.
5. **End-of-run checks assert the LIVE end-state**, not the shipped initial
   value — earlier checks mutate the graph (e.g. the markdown typing test).
   Order-dependent assertions must state their ordering in the harness.
6. **Pages advertising `?mode=` switching must embed every mode's payload in
   every build**, so any static serve works; `data-mode`/`hidden` only control
   reveal state. A "falling back to client" path means server-coupling.
7. **Restore steps restore the narrative state** (the data the copy
   describes), never a throwaway node.
 8. **A retention-destroyed ADOPTED DEF CHILD is pruned from the emitted
    element set** (blind test #5 lesson + DEFECT #20 FIXED 2026-08-16,
    tests N4/N5): the destroyed flag IS a render-removal for the def child's
    OWN element — the def-fill sites (`defChildPruned` — emitDefRootElement,
    emitDefChildTree recursion, the nested seam branches, the SED-1/P-EMIT-3
    fills) AND the blocked-def/nodeById reTyped loop (synthesized real-child
    elements + the consumer's childOrder) skip a proto/child-node whose
    `destroyed` flag is set, so neither the element nor its data-subtree
    surfaces. The GRAPH side still retains: walk slot kept, `destroyed`
    flag set, NodeView positions stable — the assertable retention half.
9. **`receiveNextState({children: []})` is not a teardown** (blind test #5
   lesson): on a layer-bearing node it is an idempotent no-op (OO-2); on a
   layer-less node it APPLIES an empty layer that blocks every later mint.
   The teardown (`removeLayer`) is engine-side only — no body op kind invokes
   it. A Clear-style flow destroys each minted child via
   `clientAPI.apply(id, {kind: 'destroy'})` (retention); "re-dispatch
   replaces" / "'' restores all items" are not expressible (re-injection is
   an OO-2 no-op).
10. **Def-child `handlers.*` bindings are planned-but-inert (S45 standing
    surprise) — never claim def-child dispatch** (blind test #5 lesson): a
    binding authored on a def child plans on the out-of-tree def-child
    prototype — never compiles, never dispatches (dispatch returns `[]`);
    only def-ROOT bindings wire (the AUTH-SEAM phase copy). Author event
    bindings on in-tree nodes only; express def children as leaf/text data.
11. **`destroy` dissolves the SHARED family link — a destroyed node's siblings
    are orphaned with it** (blind-test S2.2 lesson, 2026-08-20; node.md §6.4 —
    `destroy` → `link.destroy()` on the child anchor; the link is shared by
    every sibling of that parent). This is the DIFFERENCE from `detach`
    (DEFECT #12 — safe per-node, siblings keep their edges). To destroy ONE
    control and keep its neighbor rendering, the destroyed node must be the
    SOLE child of its container (or a runtime-minted retention-destroyed
    adopted child — markDestroyed keeps the slot); never put the destroy
    target and a survivor on one family link. The DOM-side `removeEl` +
    retained-listener purge still fire for the destroyed element.
12. **Destroyed nodes leave `allNodes()` — locate destroyed retention nodes
    via the FAMILY WALK, never an `allNodes()` scan** (REQ-GAP-11, 2026-08-22;
    contract.md destroyed-node lifecycle): the self-evicting sweep + destroy-op
    eviction drop destroyed nodes from `registered`/`byId`/`this.nodes` on both
    destroy branches, so `allNodes()` = the live-tree scan (long-lived hosts
    return to the baseline after teardown). The retention half survives: the
    destroyed node KEEPS its `children[i]` slot (its live parent still lists it
    via `children`), and `getNode(id)` still resolves it (the destroyed-ref
    tombstone — stale ids gate `no-usable-state`/dispatch `[]`, never
    `unknown-node`). A check that must assert a destroyed-but-retained node's
    state reads it off its live parent's `children` (e.g.
    `chip.children.find(c => c.props?.id === id)`); a check that must apply or
    dispatch to it uses `getNode(id)`.
13. **Rows-mint data authoring rules** (2026-08-24 adversarial fix pass,
    defects.md ADVERSARIAL-* FIXED rows): (a) the rows-mint/rows-clear
    `target` is a LIVE NODE — pass the node from `supervisor.getNode(id)`; a
    string id is a contained `unknown-node` rejection, never a crash (the
    clientAPI wire path DOES resolve a string `target` since the fix pass);
    (b) rows are plain data objects — a non-object row or a non-array `rows`
    rejects the whole mint atomically (`rows-shape-invalid`, nothing
    half-mints); (c) a row's `id` is a natural FIELD (consumers can read it
    via an `id` source anchor), never the minted node's id — minted nodes
    always carry FRESH mint-generated ids (Feature 1b's keyField rides the
    same hygiene); (d) a row must NOT carry an `anchors` array — it is
    stripped with a `rows-mint-anchors-rejected` warn (the OO-3 veto mirror);
    (e) a placement-kind mint REQUIRES `placementName` (`rows-placement-name-
    missing` otherwise); (f) a minted row that MOVES under a permanent parent
    is still DOOMED by a re-mint/clear (the no-promotion pin — rows never
    reverse-ship as authored content); (g) minted rows never serialize as
    content states (the origin exclude) — the batch RECORD round-trips and
    the host re-mints per it; (h) rows that legitimately carry an `id` can be
    re-minted with the same ids — the re-mint always replaces in place.
14. **Keyed batch-reuse authoring** (2026-08-24, handoffs-review-6.md D1-D14):
    declare `keyField` on the rows-mint op to enable element identity across
    updates — a reused row's minted id (and its (wire, forkKey) element)
    survives; an identical row re-applied is a NO-OP (no consumer churn). The
    keyField is ALL-OR-NOTHING: ANY key-less row in the batch, a reserved-key
    keyField (type/css/props/content/children/handlers/anchors), or a record
    mismatch (keyField/prototypeName/placementName) DEGRADES the WHOLE op to
    the plain replace (`batch-keyfield-invalid` warn) — the identity space is
    lost for that update, so pass a key for EVERY row or none. Keys are value-
    identity (strict `===`; primitive string/number/boolean only — an
    object/array key value counts as absent → degrade). On a keyed update the
    reused node's SHAPE is frozen (a row changing type/css/props warns
    `rows-reuse-shape-ignored` and keeps the shape — drop keyField for a
    whole-op replace to change shape); its dropped fields PRUNE their source
    anchors (consumers stop resolving them). Reuse undo is EXACT (restores
    the pre-op record + values) via the journaled `preRecord`; the removed
    half re-mints with FRESH ids (identity-across-undo is not a promise).

### 14.2 Browser realism (why the headless shim can mislead)

1. **Real DOM `children` is an HTMLCollection** — indexable + `.length` +
   `.item()`, NO `.map`/`.filter`. Harness code must always
   `Array.from(el.children ?? [])`. The smoke shim supports
   `REAL_DOM_CHILDREN=1` to emulate this and fail array-method misuse.
2. **The shim's `setAttribute` writes `attrs`, NEVER `el.id`.** A `props.id`
   element carries its id only in `getAttribute('id')` (`css:id` is the
   channel that sets `el.id` directly). findEl-style lookups MUST read
   `el.getAttribute?.('id')` FIRST (works in both shim and browser), then
   fall back to `el.id` — reading `el.id` first is a silent all-lookups-fail
   bug in the shim (blind-test S-group lesson, 2026-08-20). Likewise the
   smoke's `byId` map is keyed by the authored `props.id` attribute.
3. **Re-appending an attached element blurs it.** `diffMinimal` emits
   `append` only when the child order changed or the child was created this
   pass (ORD-H6). Focus-safety assertions must target the *mechanism* — no
   `append`/`remove` op on the focused wire — not just object identity
   (object survives while the DOM relocates it).
3. **Assert compile scope, not just output.** A harness for a focused-pass
   framework must verify updates stay bounded (3–8-node focused passes via
   `supervisor.takePass2States()`), or a whole-graph recompile slips through
   green. Bootstrap = the only full compile.
4. **Scope assertion inputs to the system under test.** In-process demos
   share `console.warn` / global counters — count diagnostics on the system's
   OWN `EventBridge`, never a process-global sink. Visible diagnostics (e.g.
   loop warnings) must be re-emitted through `console.warn`, and the smoke
   should grep for them.
5. **`REAL_DOM_CHILDREN=1` is the browser-realism gate** — run the smoke
   with it to catch HTMLCollection misuse before opening a browser.
6. **The shim DOM is a DAG — count emitted els, never raw DOM walks.** The
   shim's re-append/relocate semantics (rule 2) can leave an element object
   reachable through several parents' `children` arrays, so a raw child
   walk from the mount double-counts (blind test #5 lesson — the
   handlers-scenarios page). Assert on: the EMITTED element set (one
   element per wire — destroyed nodes pruned) and/or each OWNER element's
   OWN `children` array (append order). Never count a subtree by summing
   raw walks.

### 14.3 Demo-only helpers — keep them OUT of core docs

Demo pages may carry small test-only helpers (e.g. `levelCss` in
`demo/fork-stress-fixture.js` — the per-node unique hue/padding generator for
the CSS stress check). These are **NOT core APIs**:

- They must NOT be documented in core specs (`docs/specs/*.md`), the design
  skill §1–§9, or the core header comments in `src/`.
- They SHOULD be called out as demo-only wherever referenced (§12 demo-page
  entries, the demo's own spec, `RENDER_PROCESS_NOTES` DECIDED entries).
- Their implementation notes (how uniqueness is guaranteed, what the
  serialization schema does) belong in the demo's spec or a review doc, not
  in core docs.

### 14.4 CSS-stress lessons (from the fork-stress per-level css work)

1. **Key per-(level, slot) pairs, not hashes.** An early `nodeSeed(id) % N`
   collided (two L3 siblings shared a hue). The final design keys the css
   value by (level, sibling slot) and the property by level, so the css
   string is unique per (level, slot) by construction — each level changes a
   DIFFERENT property (L1 background-color, L2 border-style, L3
   border-width, L4 text-decoration, cycling) and the two sibling slots get
   different values.
2. **`css` is a closed serialization schema.** `serializeSlice` ships only
   `id`/`classes`/`style`/`cssDef` (`serialize.ts` `cssState`). A demo-side
   css key (e.g. `data-layer`) is silently dropped from
   `preempt-initial-data`; emit per-level properties through the `style`
   string (`property: value;`), and put markers in `props` (emitted as
   attributes).
3. **Def-retyped children keep their OWN authored css/props.** The
   component-link emitter re-types real children (their standalone emission
   is skipped via `defCovered`), so it must preserve each real child's own
   css/props — the def's css/props are a fallback for synthetic
   `${wire}:${bind}` children only.
4. **Runtime nodes must be registered in the page's own `wireToNode` map**
   for emitter lookups to find them — `supervisor.registerNode` alone is not
   enough.

### 14.5 Data-driven / prototype-driven assembly lessons (fork-stress-data)

From the legacy-envelope completion test (`docs/specs/fork-stress-data.md`):

1. **`clientAPI.apply` is two-arg.** `apply(id, { kind, ... })` — never a
   single op object. `clone-instance` mints the copy's id and registers +
   attaches + marks it pass-2 dirty, so the copy compiles and its inherited
   after-compile fires automatically.
2. **HandlerContext carries `c.node` (variant A) — bodies can be
   self-contained.** `dispatchPhase`/`dispatchEvent` enrich the per-dispatch
   context with the node being dispatched (+ its last-known states). An
   after-compile body can read its own layer from `c.node.props` and expand
   itself — no prototype closure, no pending registry.
3. **Self-expansion is O(1) per firing — but never scan the graph.** Each
   node's body fires exactly once per flush (no self-ops: the
   `stress:expanded` marker op is replaced by a DERIVED declaration on the
   prototypes, derived-state.md §9.2 — nothing re-dirties a node after its
   children exist, so handlerCalls halves from 2×N to N; 4094 at d12).
   Scanning `supervisor.allNodes()` per after-compile call was the original
   27.9s regression — never scan the whole graph inside a handler body.
4. **Self-providing trees must not turn pass-2 into O(n²).** Every clone of
   a value/link-only prototype carries a `source` anchor; the pass-2
   focused slice used to sweep ALL source-bearing nodes into every dirty
   node's compile (the arm-termination fallback universe) — 4094 dirty
   nodes × 4095-node slices ≈ 16.7M compiles, ~137s in-browser. The
   per-name component Link is the provider registry (anchors carry an
   `owner` backref), so arm-termination reads providers off the Link and
   the pass-2 slice is the walk path only; the universe sweep survives
   only for hub-less trees, target-gated (supervisor `focusedSliceFor` +
   resolve.ts). Link d12 now ~5.6s shim.
5. **A clone inherits the prototype's LAYERS (handlers ride along) but NOT
   its parent's chain.** The PARENT bakes the child's `stress:layers`
   chain onto the fresh copy at creation (right after `clone-instance` —
   the copy is in-tree, the slice applies, and both pass-2 marks coalesce
   into one flush); the kickoff sets the L1 chains the same way. The
   child's own body never sets its chain.
6. **Derived props are read from the RESOLVED state, never pass-1
   `n.props`.** A derived bake lands in `CompiledState.props`
   (`node.resolved` / `getResolvedStates(id)[0].props`), NOT in
   `node.props` — page checks that read `stress:expanded` must use the
   supervisor's resolved store (non-leaves bake `true`, leaves `false`).
7. **Legacy envelope css is the flat legacy shape** (`{ style, classes }`),
   never nested under an extra key — nesting stringifies into `cssText` and
   css checks fail. Markers go in `props`.
8. **Self-verifying demos: the banner is the gate.** The smoke asserts the
   exact banner string; keep checks merged to that count and the banner
   text verbatim.

### 14.6 Placement-path API surface lessons (blind test #3)

From the post-implementation layered blind loop (`archive/findings/2026-08-15/2026-08-15-test-findings.md`
§"Blind test #3" — 24 writer readings adjudicated, 53 tests green):

1. **`compilePath` is a per-node METHOD, never a whole-graph function.**
   The census is the per-node aggregate (one pass per node in one
   bootstrap sweep); the supervisor compiles ONE dirty node through it.
   Spy `Node.prototype.compilePath` + `mock.instances`, never a module
   export.
2. **pathKey grammar: the hop landing on the ROOT contributes nothing.**
   `root/<zone>/<owner>/…/<nodeId>` — a zone-0 consumer of the root's own
   container keys `root/<id>`; a node's own consumer hop (`zone/owner`)
   lands directly BEFORE its own id. Level-1 keys therefore carry no
   `zone-0` segment.
3. **`forkKey = pathKey` is UNCONDITIONAL on every compilePath-minted
   state** — family-first states included; they emit on the family pathKey
   wire (`root/<id>`), never the nodeId wire.
4. **`diffMinimal`'s first argument is a prevMap (or null)**, never an
   array — `new Map(elements.map(e => [e.wire, e]))`.
5. **`clientAPI.getState` is surface-only** (`nodeId/status/pathKey/
   state`); per-path `fork: {forkKey, nodeIds}` exposure lives in the
   supervisor's resolved store and the events channel.
6. **placement-attach dirties ONLY {container, added}** (E2E-4) — the
   trigger's relevance pre-check gates THOSE nodes, never the changed
   link's consumers; a consumer's fan-out onto a new container waits for
   the consumer's own next compile.
7. **A non-placement-routed provider (e.g. the root) compiles through the
   focused slice**, not `compilePath` — E2E-3 compile-scope spies see the
   consumers only.
8. **Def re-typing is a covered-consumer chain**: a def-covered consumer
   is re-typed by the PARENT's def; its own def re-types its children
   only; the provider's own state re-types itself. Def values are
   `{ type, children: [...] }` (`isLinkDef`).
9. **`on:<event>` attachment needs the live-node handler source** —
   `emitElements(states, nodeById)` with `EmitNodeSource.handlers`.
10. **`takePass2States()` returns a per-node Map** — flatten the values to
    read pathKeys; it DRAINS (capture once).
11. **The translate-time §1.3 ancestor veto IS implemented (2026-08-14,
    DEFECT #3-1 fixed)** — family attach is CHILD-SIDE in translate (the
    child attaches itself to its family parent before its own placement
    minting), so the shared `ancestorConsumesZone` predicate (node.ts, used
    by both the op-time and translate-time halves) walks a live parent chain
    at translate. A producer whose family ancestor WOULD ATTEMPT TO PLACE
    INTO the zone (a `content`-role anchor for it) is NOT minted and warns
    `placement-name-vetoed` (K4) — LOOP-PREVENTION ONLY (the ancestor's
    content anchor → the per-name Link → the descendant's container → family
    up → the ancestor → path-walk revisit). Authoring note: DUPLICATE
    PRESENTATION is LEGAL — a descendant may present a zone its ancestor
    also OFFERS — placement resolution never shadows (nearest-shadows-far
    is component resolution): a consumer fans into ALL zones of its
    best-fit targetPlacement, so a duplicate presentation is just another
    zone of the multiplicity; the veto fires only when an
    ancestor CONSUMES the zone.

### 14.7 Live-prod legacy-shape lessons (placeholderLanding loop, 2026-08-14; Step-3 rulings F13 applied)

From `live-prod/placeholderLanding/FINDINGS.md` (defects + dispositions
D1–D8; specs updated in translate.md/render.md/adapters.md/ops.md/
handlers.md/payload.md/placement-path-spec §10.ag):

1. **Author placement as ARRAYS** — `placement: [{placementName: 'x'},
   {targetPlacement: ['y']}]` — the legacy canonical form (D1). The
   single-object convenience still translates, but producer + consumer on
   one node (and several consumers) are only expressible in the array.
   `placement: []` is a legal empty list; a non-object entry warns
   `placement-entry-invalid` + is skipped.
2. **`doc.content` is a `ContentPayload[]` ARRAY** — never the
   `{content, metadata}` single-object form (D2): ANY non-array shape is
   obsolete and warns `payload-shape-obsolete` (payload skipped). If you
   are porting legacy envelopes, re-express the top-level `content` to the
   array form as a data fix.
3. **`css.style` may be authored as an OBJECT** — `{backgroundColor:
   '#fff'}` — translate serializes it to a kebab-case `k: v;` string
   (D3). Authoring pre-serialized strings also works AT TRANSLATE, but
   reverse ALWAYS parses back to the object (F7: string-authored styles
   become objects on save — the legacy format is object-native, accepted).
   What never works: expecting the raw object to reach the DOM (an OBJECT
   emission seam now JSON-serializes it — `bakeValue`, OTGE 2026-08-19 —
   but the heredoc strings above are the CSS-text contract).
4. **`css.cssDef` is real CSS now** — `{selector, styles}` emits as a
   stylesheet rule, deduped by rule signature, only from ACTIONABLE states
   (D4/F10). If a def never materializes (out-of-tree prototype, unplaced
   arm, token-owned node), its rules don't render — don't assert on them.
5. **`nodeData.content` is text-only** (D5) — children go in `children`;
   a non-array `children` warns `children-shape-invalid` + is skipped.
   Never author content as NodeData.
6. **The def's ROOT and its children are out-of-tree `'component'`-token
   prototypes, pre-minted at translate** (D8/F16 + delivery-shape ruling) —
   they render only
   when component assembly wires them in. Pages must NOT rely on the host
   node emitting def children (the old count-mismatch clobber is a defect).
7. **Subtree wrappers use `{target: 'children', reference}` — NOT
   `target: 'content'`** (F13 + delivery-shape ruling 2026-08-14 + B1
   clarification): `target: 'content'` delivers the def's
   TEXT content ONLY (the def's `content` field → the consumer's content
   slot); `target: 'children'` = ORIGINAL NODE DATA AS-IS + PROTOTYPE ADDED
   — the consumer NEVER collapses: it keeps its OWN element, its OWN authored
   text and its OWN authored children, and the def's ROOT element joins as an
   ADDITIONAL seam-wired child AFTER the authored children
   (`div(shell text) > [p(authored), nav.nav-bar > [logo, links, auth]]`),
   carrying the def's type + css (classes + cssDef rules);
   `target: 'type'` = SHELL COLLAPSE — the consumer's element BECOMES the
   def's element (def type + css, no separate wrapper element). The
   placeholderLanding envelope
   was re-expressed accordingly (the four subtree-delivering bindings —
   root navBar/header/footer wrappers + the header-def p→articleSubtitle —
   are now `target: 'children'`, so each renders as its OWN shell containing
   the def element; the h1's `target: 'content'` articleTitle
   tag stays content as a text-delivery test feature with no def). A
   `{target: 'content', reference}` wrapper with no def text renders an
   EMPTY shell by design — subtree content never arrives through the
   content target. Assert the def element appears INSIDE the wrapper (as
   the wrapper's child), never at root level — and never assert the def's
   classes on the wrapper itself.
8. **Two component-rule families — never conflate them** (clarification
   2026-08-14; RCA: archive/reviews/2026-08-15/2026-08-15-session-defect-review.md "B1 children-target
   collapse miscommunication"):
   - **FAMILY A — the SEAM (ops.md §2.7 ALS, render.md §3.4.2 SED):**
     graph-time anchor-layer materialization for `type`/`content`/
     `children` targets. Node data AS-IS + prototype added (children);
     collapse (type); text only (content).
   - **FAMILY B — the DEF-CHAIN (render.md §3.4.2 DFC, P-EMIT-3):**
     emit-time re-typing for the fork-stress link-method (bind-keyed or
     type-only re-typing specs) + the childless-host fill (synthetic
     `` `${wire}:${bind}` `` wires).
   Discrimination: `options.seam`-planned bindings are ALWAYS Family A
   (never chain); seam-less bindings chain only with RE-TYPING-SPEC defs;
   DELIVERABLE-spec defs (children carrying content/css/props/children/
   component — the live navBar/header/footer defs) are Family A material
   and NEVER chain, even when the counts fit (the B1 root-clobber was
   exactly this: the host's own source binding re-typed its real children
   because the count happened to fit).
9. **Data-authoring pins (stress-test review loop #3, 2026-08-15):**
   - `css.cssDef` at the TOP level is always the `StyleNode[]` ARRAY
     `{selector, styles}` — the selector-key object form `{'.a': {…}}` is
     legal ONLY NESTED inside a `styles` value (the media-query form,
     render.md STL-1). A top-level selector-key object yields ZERO rules.
   - A nested seam consumer INSIDE a seam-less def's value (a def child
     carrying `component: {target, reference}` inside a def whose binding
     has no seam target) does NOT materialize — B2 scoping mints no
     prototype for it (translate.md D8/F16). To deliver a nested def
     subtree, make the OUTER binding a D7 seam target (`{reference,
     target: 'children'}`); do not expect nested bindings inside def
     values to resolve.
   - `css.style` reverse round-trip (F7) is kebab-normalized
     VALUE-equivalent, never verbatim key-case: parse-back keys are the
     camelKey forms (`-webkit-transform` → `WebkitTransform`,
     `-ms-transition` → `MsTransition`); never assert authored key-case
     after a save/load cycle.
   - ENGINE GAP (do not rely on it): seam targets do NOT currently
     round-trip on reverse (`nodeToLegacy` emits `target` for
     `options.applyPath` only — translate.md K5 vs TR-H16; reported in
     archive/findings/2026-08-15/2026-08-15-test-findings §"Stress-test review loop #3" DEFECT #6). A save/load
     cycle silently degrades a seam consumer to a plain consumer until the
     defect is fixed.

### 14.8 First-render DOM costs (the 2026-08-16 fork-profile analysis; DETACHED INITIAL-BUILD BATCH)

1. **A first render is create-then-MOVE churn unless batched** — the
   DomAdapter's `createEl` appended every element to the live mount at
   creation; the subsequent `append` ops MOVED each element under its owner
   (4095 mount attachments + 4094 re-parents on a 4095-element tree, every
   live attachment triggering the browser's incremental style machinery —
   real-Firefox apply ≈ 468ms on the path-fork page).
2. **The initial build wraps its ONE `applyOps` in
   `adapter.beginBatch()` / `endBatch()`** (adapters.md §3.5b): created
   elements stay detached, the append ops nest the tree, `endBatch` mounts
   only the roots. Incremental update applies stay UNBATCHED (their diffs
   attach live). The RenderOp stream is unchanged — the win comes from the
   attachment pattern, not the op shape.
3. **Per-op lookup costs are noise on first render** — ~18µs/op real-browser
   on the fork pages is style-machinery + attachment cost; the per-set
   element lookup (Map.get) is ~0.5% of it. Never shape the op stream for
   lookup savings (the op stream is a pinned contract — render.test/e2e/
   treeFromOps/journal-replay pins).
4. **Measure in the BROWSER, not the shim** (§14.2): the headless shim's
   element machinery has different cost ratios — the batch's win is a
   browser-side style/attachment win; the shim profile shows it only as a
   structural no-op.
5. **Drain the pass-2 cascade with MICROTASK checkpoints — NEVER timer
   yields** (2026-08-16): the flush cascade is microtask-bound (scheduleFlush
   → queueMicrotask; handler applies chain in microtasks), so checkpoints of
   `await Promise.resolve()` (checked against the non-draining
   `supervisor.hasPendingWork()`) drain it. The fork pages' old
   `flushMicrotasks` yielded `setTimeout(0)` — and 0ms timers are
   CLAMPED/THROTTLED in real environments (≈0.5s per yield in Node here,
   seconds in browsers): the d12 pages measured pass2 ≈ 5s (shim) / 18-54s
   (browser) of mostly scheduler idle while the engine's real work was
   ~300ms and the page had already populated visually (the tree renders in
   round one; the profile only prints after the timer-stalled flush — the
   "times show up much later" symptom). The fix collapsed all four d12
   methods to pass2 ≈ 265-320ms (flush window ≈ engine work — the profile
   now splits wall vs `work:` via `supervisor.pass2WorkMs()`). The §8-Q6
    runtime guard was re-baselined to match (runtime ≤ 2× the static
    baseline — the old comparison inverted once the runtime totals became
    honest).
6. **Composite-keyed stores need O(1) bare-wire indexes — never prefix-scan
   per op** (DEFECT #22, 2026-08-16): the derived pages store path-states
   under `wireKey(wire, forkKey)` while the append/remove ops carry BARE
   wires — `findEl`'s prefix fallback made the initial renders O(n²) (the
   Firefox-profiler hotspot; placement-derived apply ≈ 1.17s in the shim).
   `applyOps`/`treeFromOps` now maintain per-call O(1) bare indexes
   (`createdBare` / `byWireBare`) with the persistent fallback for
   cross-call elements; `findElScanCount()` pins the regression class
   deterministically. Result: placement-derived apply 1170→43ms, checks
   1243→126ms, total 2488→247ms.

### 14.9 The covered-childless def-fill gate (DEFECT #21 — the 2026-08-16 derived-trio pass)

1. **A def-carrying CHILDLESS state fires the P-EMIT-3 fill (synthetic
   `` `${wire}:${bind}` `` children) — but ONLY when it is NOT covered by a
   family parent's chain.** A covered leaf (its standalone element is
   skipped as covered; its visible element is the PARENT's re-typed
   child) must NOT also emit the fill: the fill's synthetics are
   never-attached phantoms. The emit-side gate (`coveredChildless` in
   `emitElements`, render-helpers.ts) suppresses the covered-leaf fill;
   the covered-NON-childless case keeps pushing (the re-typed real
   children — the subtree-below-a-covered-node invariant), and the
   NON-covered childless host keeps the standalone fill. Authoring
   lesson: an element census (`els.length`) is the ONLY honest check for
   this — node-based checks (per-node `adapter.wires.get(id)`) mask the
   phantoms (the runtime link page shipped 8191 elements for years of
   green node checks).
2. **The derived-family census (4095 elements for placement/values/link)
   is per-method asserted** — the smoke pins `states=elements=4095` per
   derived page (identical for all three methods) via
   `assertStaticPathCensus`; the link page additionally pins the
   re-typed-element count (4092 bare-keyed elements, no forkKey).
3. **Element lookups on a page with re-typed def-chain children must try
   bare-then-composite (`elOfWire`)** — never the composite-only
   `domElOf`; the re-typed elements live in the adapter under BARE keys.
   Side effect: bare keys make `findEl`/`treeFromOps` edge resolution
   EXACT instead of prefix-scanned — the link-derived page's treeFromOps
   and apply run ~100× faster in the headless shim than the
   composite-keyed placement page (a measured asymmetry, not a defect;
   both stay within the derived-family per-region pins).
4. **The re-typed element carries the CHILD's OWN css/props, not the
   def's** — the def spec's css/props are a fallback for synthetic fill
   children only; assert re-typed elements by the child's own props
   (`data-depth`/`stress:layer` = the child's level). Re-typed elements
   also carry NO derived bake (pass-1 node props only) — scope element-
   level derived assertions to standalone-emitted states (the
   `method !== 'link'` exemption pattern).

### 14.10 The hooks value-provider slot (2026-08-16 — hooks-map-review §7, IMPLEMENTED)

1. **A pure provider is F3-dropped from render — "a value holder, never an
   element".** The hooks demo root carries the providers + the `hooks`
   field and is a PURE provider (its names are consumed elsewhere) → its
   OWN element never emits; its family children (the scenario cards) render
   at the mount. Author the hookable providers on a non-rendering node
   (the root or a dedicated provider node) and the consumers in the
   renderable cards — never assert a provider's element.
2. **Controls write through the MANAGED CHANNEL only** — `context.clientAPI.
   apply(providerId, [{targetProp: 'hooks.<name>', mode: 'replace', value}])`
   in function-STRING bodies (or `clientAPI.apply` on the page harness);
   direct `addLayer`/`a.value` writes are the rejected bypass. The provider
   id is reachable from a control body by a FAMILY walk to the top
   (`while (provider.parent) provider = provider.parent` — the token
   parent terminates the walk).
3. **Hookable values must be SCALARS or plain data objects** — a
   def-shaped provider value (`type`-bearing node data, a `content`-
   carrying object, a `{name, body}` handler def) is `hook-seam-exempt`:
   the hook mutation is skipped (warn + no-op on the specific mutation;
   the op itself is applied — `status: 'applied'` on the managed channel;
   `hook-seam-exempt` is a K4 console warn, NOT an `ApplyErrorCode`).
   Author the hooked providers as scalars/strings/numbers/plain objects;
   keep defs unhookable by design.
4. **Repeated writes never grow the layer stack** — the write lands ONE
   deterministic `hook-<name>` replace-in-place layer; a same-value write
   short-circuits. The page's O(1) proof must count the node's LAYERS
   (`provider.layers.filter(l => l.id === 'hook-<name>')`), never the
   render count (the supervisor pipeline still runs its pass-2 flush for
   every write — the layer short-circuit is the single-source guarantee,
   not a render skip).
5. **The derived bake lives on the COMPILED STATE, not the node's pass-1
   props** — `readout.props.count` (a NodeView read) never sees the
   `bindings.*` bake; element-level bake assertions must read the emitted
   element's `prop:<key>` attribute. A control body that needs the current
   value should re-express the flow instead (e.g. the external-source
   boundary pattern: the incoming event carries the ABSOLUTE value — the
   body never reads a value back).
6. **The ONE-source round-trip** — the hook write mirrors the provider
   anchor's value (`a.value`), so serialize → loadState → nodeToLegacy ship
   the hook value through the anchor with ZERO changes to those surfaces;
   the `hooks` FIELD (the names) rides the base data. A reverse-then-re-
   translate of a hooked page yields the hook VALUE as the authored binding
   value (the layer is runtime-only — the value survives, the hook layer
   does not; that IS the contract).

### 14.11 Hooks stress-test review lessons (2026-08-16)

1. **`hook-seam-exempt` is a K4 warn, NOT an `ApplyErrorCode`.** The
   supervisor gate for a def-shaped provider warns + continues (the mutation
   is skipped, but the op itself is applied — `status: 'applied'`). The
   node-level defensive path also warns + returns. Neither path produces a
   rejected result. The hooks-map-review §7.2 pin 5 and §7.3 guard rails
   were corrected to reflect this (proofreader finding P1/P2). Tests that
   assert `status: 'applied'` for hook-seam-exempt are correct.
2. **Cloned nodes may lack the `hooks` field and source anchors.** `clone()`
   copies layers and anchors but the `hooks` base-data field is not cloned
   (the base represents the authored truth — clones inherit layer values,
   not authored metadata). A clone's anchor profile may differ from the
   original's (the clone inherits prototype anchors, not compiled in-tree
   anchors). Hook writes on cloned nodes that lack source/duplex anchors
   are correctly rejected with `hook-name-unresolved`. The clone-shadowing
   test in hooks.test.ts (pin e of §7.2 pin-6) uses a specific setup where
   the cloned node already carries a hook layer — it does NOT test cloning
   a provider-bearing root and writing hooks on the clone.
3. **The stress-test probe revealed no engine defects.** All 8 scenarios
   behaved correctly: rejections (hook-name-unresolved, hook-mode-blocked)
   work, hook-seam-exempt warn-and-skip works, the clear path (value:
   undefined) works, multiple hooks maintain O(1), duplex self-provider
   hooks work. The 3 probe failures were probe-data bugs (incorrect clone
   setup, incorrect consumer lookup), not engine issues.

### 14.12 Cross-feature integration lessons (the 0.2.0 adversarial pass, 2026-08-25)

1. **Per-feature adversarial passes miss the undo/redo *symmetry* seam.** The
   Feature 4 pass fixed the forward keyed-path flag omission (ADV-P-S5/S24),
   but the cross-feature pass found that the D8 keyed-UNDO path re-applied the
   `preRecord` without the flag while REDO re-applied the forward op — undo and
   redo converged on different preserve states. Lesson: a feature's "forward"
   path being correct does not imply its inverse is; undo/redo must be tested
   as a PAIR for per-op fields (a flag that the forward op declares must survive
   the D8 preRecord re-apply, not just the keyed mint).
2. **A documented "loss" is still a host-visible seam when one code path keeps
   it and another drops it.** D4 documents the condense flag loss, but the live
   keyed-update path re-forwards the flag while the condense-replay restore does
   not — an asymmetry a host hits only across a condense round-trip. And a
   preserved NON-ROWS layer-apply subtree has no batch re-mint carrier, so a
   condense+replay drops it entirely (the clone-loss "no carrier" class).
   Lesson: when a documented residual has a sibling path that preserves the
   value, the residual becomes a user-visible surprise — call the asymmetry out
   explicitly (handoffs-review-9.md §D4).
3. **Cross-feature composition is where the real defects hide after N isolated
   passes.** The 18-PASS results pinned keyField-across-base, def-census
   ordering, parent-guard-across-restore, and clear-in-base — all interactions a
   single-feature suite could not exercise. The 2 root causes (undo flag
   symmetry + condense restore drop) both sit on the 3×4 seam.
