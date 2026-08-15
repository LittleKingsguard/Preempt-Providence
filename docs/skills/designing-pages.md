# Designing Webpages with Preempt-Providence

How to design pages using the framework — the mental model, the building
blocks, and every current test use case as documentation of intended
behavior. Keep this file current: after any feature change, update the
relevant section and the coverage matrix; after adding tests, run the suite
and confirm green (see AGENTS.md).

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
  form is canonical (D1, 2026-08-14 — SPEC-ENCODED, fix pass PENDING)**:
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
- **Anchor-layer seam (D7, 2026-08-14 — SPEC-ENCODED, fix pass PENDING)**:
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
   the def's element (def type + css; the type-target is the legacy form of
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
  by its path back to the root; never a coerced pick.
- **Walk order**: own → descendants → ancestors → non-viable fallback
  (prototype/contentNodes-owned providers terminate the arm silently).
- **Unresolved**: no provider ⇒ `unresolved-reference` status + logged
  warning; the node still renders its own state (S-R4.3).

| Scenario | Test evidence |
| --- | --- |
| placement anchor materialized + renders | `translate.test.ts` TR-H3, demo T3 (role `'container'`, P3 §1.1) |
| component binding → consumer target anchor / value-bearing SOURCE provider (+ `applyPath` when `target: 'props.<k>'` — K1/K2 self-apply); vacuous/duplicate bindings warn on the K4 channel, never throw | TR-H2, `translate.test.ts` K3/K4/K7/K8, `reverse.test.ts` K5/N1 |
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
- **Stylesheet rules (D4, 2026-08-14 — SPEC-ENCODED, fix pass PENDING)**:
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
  ancestorsOf/descendantsOf`). Throwing bodies are contained.
- **Reading values from a handler**: `ctx.tree.getNode(id)` returns the node;
  its value getters (`type`/`props`/`css`/`content`) read the **compiled
  pass-1 state** (always fresh, node.md §5). Read authored/layered values
  there; write only through `clientAPI.apply`. Pass-2 resolved values
  (component `bindings`, fork arms) are not exposed on `Node` — see
  handlers.md §2.1 (TODO(code) to add a read-only resolved-state surface).
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
- **Load**: `loadState` → `new Node(d, hub)` → `reconcileParentTargets`
  (family links).
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
  SPEC-ENCODED, fix pass PENDING):** an EMPTY PLACEMENT-OWNER container
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
| `tests/e2e/path-fork-e2e.test.ts` | **Unit 12** — the consolidated E2E constraint suite (placement-path-spec §0, the four FIXED user requirements; full-pipeline Node tests: legacy envelope → translate → register → ONE `compilePath` bootstrap → `emitElements`/`diffMinimal`/`applyOps`). **E2E-1** — the fork test has ONLY the 22 prototype nodes (+ root): 23 registered at every pipeline stage (global-registry count unchanged through compile/emit/diff/apply — zero node creations), 4095 distinct path-states (`forkKey = pathKey`, no `#`), 4095 elements on pathKey wires (per-level 2^k, create ops = 4095, zero removes), journal empty of `clone-instance` ops. **E2E-2** — a shallow props slice on a depth-2 node regenerates ONLY that node's path-states (compile-scope spies + pass-2 keys) and its element is REUSED (same wires, zero create/remove, set ops only on its wires). **E2E-3** — a component SOURCE change invalidates ONLY the per-name component Link's TARGET owners (the consumers — the §3.2 affected set): the all-consumers pressure case (every consumer's `compilePath` runs once; the non-consuming sibling runs zero passes) AND the half-tree precision case (provider consumed by the a-column only ⇒ affected = {provider, p3a, p4a}; the b-column runs ZERO compile passes; p4b's 8 max-depth states stay). **E2E-4** — a post-render third depth-4 node via `placement-attach` dirties EXACTLY {container, added node} (pass-2 keys, compile spies — d5a at depth 5 gets zero passes, no set ops on its wire) and the render diff is ONE create + appends under the container's path wire, every other element reused. Plus the consolidated guard pins: static census 23/4095/0/0, runtime re-pin arithmetic (4117 in-tree = 4095 + 22 prototypes, cloneOps 4094), the `component-source-duplicate` keep-first/skip-second/warn pin, and the §8-Q6 ratio-baseline TODO marker pin. Authoring note pinned by E2E-4: a node's OWN pathKey carries its CONSUMER hops only (its producer zone appears in its children's keys). |
| `tests/unit/node.test.ts` | node lifecycle, layers, two-pass compile, forks, serialization, fail-states; **Unit 8** — the `component-source-duplicate` guard (placement-path-spec §6.2 node.ts row, §10.ab/§10.ae): a SECOND same-name source/duplex anchor on ONE node warns `component-source-duplicate`, keeps the first, and is NOT added — UNCONDITIONAL (imperative `addAnchor` AND the constructor seed path: a serialized doc carrying the pattern loads with ONE source and a warn, keep-first VALUE preserved); source+duplex share one provider namespace (name-keyed, matching resolve's `providersOn`); same-name CONTAINER anchors are unaffected (placement multiplicity legal) and different-name sources are fine; the Unit-11 re-expressed fixture shapes never trip it (regression pin); materializeAnchors' decl-path dedup is complementary (idempotent layer re-application stays silent) — the guard is the single enforcement point for everything reaching addAnchor |
| `tests/unit/path-enum.test.ts` | the placement-path enumeration compile mode (placement-path-spec §2 — Units 4+5): `compilePath()` minting ONE compiled state per valid (node, owner-path) pair — pathKey = `root/<zone>/<ownerId>/…/<nodeId>` (§2.2), `forkKey` = `pathKey` on every path-state; the R2.2 sibling-shared owner-name topology census (depth 4 → 15 states; d12 → 4095, E2E-1 — both level-(k−1) prototypes own ONE name, consumers target it, §5.1); path-derived children at mint time (family children + placement consumers, loop arms excluded — §2.3); viability for contentNodes-owned family-'in-tree' nodes (honest family label, §2.4); the per-walk visit-set cycle guard (`circular-source` + `loop` drop, sibling walks unaffected — §1.4; a placement-requested loop branch below the chosen name is never consulted — §1.2); E2E-2 foundation (a props mutation on a placement-routed node regenerates ONLY its path-states via the supervisor pass-2 dispatch); derived `children.length` reads path-derived children; Unit-5 §1.2 first-match fan-out (ALL zones of the chosen name produce instances) + `activePlacement` = the chosen name on every placement-routed path-state (§2.5) |
| `tests/unit/path-emit.test.ts` | **Unit 7** — the path-state emit layer (placement-path-spec §4): pathKey wires — a two-zone chosen-name fan-out emits 2 elements with distinct pathKey wires, each with ITS path-derived childOrder (child states' pathKey wires; per-path appends carry pathKey owners; `treeFromOps` reconstructs the path tree); the fork-stress depth-4 probe (15 elements, path-nested binary shape, no `#<i>` wires anywhere; `applyOps` reaches every element via the (wire, forkKey) composites); the armIdx-gate re-expression (a multi-path node's states are NEVER arms — `on:*` attaches to every path-state of a handler-carrying node and def-retyping applies to every def-carrying path-state); family states unchanged (wire = nodeId, no forkKey) + `#f:` component forks unchanged (`nodeId#<i>` wires); the root path-state emits at the conventional wire `root`; `diffMinimal` prevMap reuse (same pathKey across a recompile ⇒ zero ops; a shallow props mutation ⇒ set-only on the changed path-states' wires); mixed family + path emission without wire collisions |
| `tests/unit/path-resolve.test.ts` | Unit 5 resolve-side first-match walk (placement-path-spec §1.2/§2.5/Q8, §6.2 resolve rows): preference-ordered pruning — only the CHOSEN name's paths enumerate, later names never consulted (silent: no drops, no warnings); names with no viable container skipped (non-fatal; whole-array miss ⇒ nothing forks); `activePlacement` = the chosen name even when NOT the first requested; the `placementChangeIrrelevant` relevance predicate (less-favored link change ⇒ silent abort decision; chosen/higher-ranked/unrequested/stale ⇒ relevant) + the Unit-6 seam (predicate gates `node.compilePath` — abort ⇒ no states, no events; `activePlacementOf` reads the chosen name from the node's last states, family-first states without one skipped); per-path component-target resolution (Q8 path-only: own → path ancestors, nearest-wins, ≤1 hit per name per path, provider above ONE path binds only there, unresolved per-path) |
| `tests/unit/derived.test.ts` | derived-state DSL (DV-H1..H13/F1..F4); **Unit 10** — the per-path `placement` root (placement-path-spec §2.3/§2.5, §6.2 derived.ts row): a path-state's `{ $: 'placement' }` reads its `cs.activePlacement` (the CHOSEN zone name — Unit 5 seam; per-path, differing per chosen name), a family-first path-state without `activePlacement` falls back to the node's `container` anchor target, and family states keep the legacy container-anchor read (the runtime pages' `data-placement` bakes — feature-showcase #placement-lab — are pinned identical); `children.length` on a path-state reads the path-derived children (Unit 4 seam, baked via `applyDerived`) |
| `tests/unit/graph.test.ts` | Link/Anchor matrix, LinkConfigError atomicity, cascade sweep |
| `tests/unit/ops.test.ts` | structural executors, state-slice reducer, slice lock; **Unit 6**: the `placement-attach` executor (P-A1 ordered `content`-anchor minting + `container`-anchor ensure on the shared per-name placement Link, preference order preserved; P-A2 idempotent re-attach, dedup keep-first; P-A3 the §1.3 ancestor-name veto — warn `placement-name-vetoed`, warn+skip; P-A4 `derivePlacementTrigger` — minted ⇒ `container-added`, ensured ⇒ `content-added`). **D7 pins (2026-08-14, §2.7 — SPEC-ENCODED, fix pass PENDING; matrix row pending):** the anchor-layer seam materializes the def's children (from the PRE-MINTED `'component'`-token prototypes, F16) + placement links onto the consumer (parent anchor ON the consumer, target = self, `options.seam = true`, F15/F19); the role-scoped addAnchor exemption admits layer-materialized `'child'` anchors carrying the seam flag — a def referenced twice gives children MULTIPLE LEGAL PARENTS (intended, G24) while family attach of an already-parented node STILL rejects `'single-parent'` (G25); `familyLinkFor` filters seam parent anchors (G26); seam links excluded from path-walk parent selection (G27, F18) |
| `tests/unit/pipeline.test.ts` | registry/workers, slice lock, microtask queue, V/F matrix |
| `tests/unit/validation.test.ts` | tag schemas, LinkConfigError catalog, timing, clone |
| `tests/unit/render.test.ts` | serialization round-trip, fork keys, drop dispositions, SSR/ORD — incl. the DEFECT #1 emit-layer `forkKey` forwarding suite (fork arms carry `cs.forkKey` on elements + create/set ops, non-fork states carry none, applyOps/treeFromOps `wireKey` composites — incl. DEFECT-1f: bare-wire append/remove ops resolve forkKey-keyed arm elements so fork arms reach the DOM — `treeSig` forkKey dimension). **D4/D8 pins (2026-08-14, §3.4 — SPEC-ENCODED, fix pass PENDING; matrix row pending):** cssDef → stylesheet rule strings (`{selector}{kebab-case styles}`, nested media-query serialization), rule-signature dedup (the same rule never emits twice across the render), ACTIONABLE-states-only (F10 — no rules from dropped/owner-terminated/token-owned/unplaced arms), zero-or-one `styles` op per sweep — a cssDef-less render emits NO styles op (F11, STL-H5); def-chain emit scoped to the 1:1 link method at offset 0 with link-method provenance (F22/F23) — a count mismatch, a seam-target def, or a non-zero offset emits NO def children (no synthetic wires, no host emission) |
| `tests/unit/adapters.test.ts` | concrete adapter layer: `DomAdapter`/`SSRFragmentAdapter`/render-helpers — §10 DOM/FRG/HLP/PARS matrices of `docs/specs/adapters.md` (fork-arm `wireKey` targeting, D4 undefined-drop, styles coalescing, hydrate seam, parity, compiled-fork `forkKey` ops, `on:*` `escapeAttr`, floating-fragment `toString`). **D3/D4 boundary pins (2026-08-14 — SPEC-ENCODED, fix pass PENDING; matrix row pending):** `styles()` payloads are RULE STRINGS (never raw cssDef objects — an object at the boundary is the `[object Object]` defect class); per-adapter-instance rule-signature dedup (DOM-H29/FRG-H27 — the same rule never appends twice); a zero-rule styles op never arrives (F11); `css:style` values are always strings (objects serialize at translate) |
| `tests/unit/handlers.test.ts` / `phases.test.ts` | handler ctx/dispatch; phase ordering. **D6 TODO marker (2026-08-14):** legacy handler defs stored as `template.component` values `{name, body}` are misparsed as source anchors and die silently (never HandlerDefs, no `handler-phase-unknown`) — parked as a TODO in handlers.md §6, no fix, no new warn code |
| `tests/unit/translate.test.ts` | legacy schema → graph (in); K5 apply-path persistence + K6 root flip (K5 emission contract: `tests/unit/reverse.test.ts`); P3 placement minting: `targetPlacement: string[]` → ordered `content` anchors (serialize round-trip preserves the order), `#`-validation (`placement-name-invalid`), string-coercion back-compat (`placement-string-coerced`), duplicate keep-first (`placement-duplicate-reference`), `activePlacement` never minted, contentNodes-ownership minting (content roots family-'in-tree' via the token; token terminates the compile walk), `component-target-placement` warn removed. **D1–D8 live-prod pins (2026-08-14 — SPEC-ENCODED, fix pass PENDING; matrix row pending):** `placement: [...]` ARRAY maps every entry through the single-entry logic (producer + consumer on one node; per-entry `#`/duplicate/coercion warns; never a silent no-op; `placement: []` legal empty list — no warn; non-object entries → `placement-entry-invalid` warn+skip; NO translate-time veto claimed, F3) while the single-object form maps once; reverse merges to one flat object (array only for multi-producer nodes, F2); `doc.content` ANY non-array warns `payload-shape-obsolete` + skips (F5, array-only); `css.style` OBJECT serializes to a kebab-case `k: v;` CSS string (grammar: first-`:` split, `url(...)` `;`-exception, vendor-prefix kebab-case, `{}` → `''`, F8) and reverse ALWAYS parses back to the object (F7); `nodeData.content` is text-only and a non-array `children` warns `children-shape-invalid` + skips (F14); `type`/`content`/`children` seam targets plan the D7 anchor layer (no `component-target-gap` warn) with `options.seam` persisted (F17) — `content` = text delivery only (F13); def children PRE-MINTED as `'component'`-token prototypes (F16) |
| `tests/unit/payload.test.ts` / `reverse.test.ts` | payload drop/refresh/append; reverse translation (out) — K5 target emission (consumer/provider/root `template.component`), runtime-duplex name-target drop, N1 synthesized-derived strip, K7 array-form reverse, no-warning re-translate round-trips; P3 reverse emission: `content` anchors → `targetPlacement: string[]` in MINT order + derived `activePlacement: string`, contentNodes anchor STRIPPED (re-translate re-mints cleanly, zero warnings). **D2/D3/D1/D7 reverse pins (2026-08-14 — SPEC-ENCODED, fix pass PENDING; matrix row pending):** reversed `content` is ALWAYS a `ContentPayload[]` array (never the obsolete object form); serialized `css.style` strings ALWAYS parse back to `Record<string,string>` objects — no provenance (F7); placement reverses as one flat merged object (array only for multi-producer nodes, F2/R-H7); seam-wired def children NOT emitted as the consumer's `data.children` (F20/R-H8); payload item `content` reverses text-only |
| `tests/integration/payload-flow.test.ts` | payload lifecycle through the managed channel; edits surviving refresh |
| `tests/e2e/payload-refresh.test.ts` | full lifecycle: edit + append + refresh → in-place re-render → reverse with live state |
| `tests/integration/api.test.ts` | ClientAPI T1–T25 (journal, events, forks, gates) |
| `tests/integration/supervisor.test.ts` | journal replay/undo-redo, coalesced sweep; **Unit 6** (placement-path-spec §3.3/§9-Q3, E2E-4): the `placement-attach` op through `supervisor.apply` — registers-if-new, dirty set = container + added node only (S-P1: a depth-4 add recalcs nothing at depth>4; the container's path-states pick up the added path-child), journal verbatim incl. trigger fields + idempotent replay (S-P2), ClientAPI wire carry-through (container ref resolved, trigger fields pass the spread — S-P3), the trigger-identity silent abort (S-P4: an attach into a less-favored zone ⇒ zero state regeneration, zero events; the chosen link's attach regenerates), per-path events with `fork: { forkKey: pathKey, nodeIds: trace }` and affected-set-only emission (S-P5), W2 path-unique (nodeId, forkKey) dedup — never a per-node collapse (S-P6) |
| `tests/integration/handlers-flow.test.ts` | handler→journal→events; phase hooks; focused warnings |
| `tests/e2e/ssr-render.test.ts` | SSR→client complete render, parity, hydrate |
| `tests/e2e/ssr-html-validity.test.ts` | emitted-SSR-HTML validity through the **real** `SSRFragmentAdapter` (well-formedness, escaping, root-first, styles prefix; fork arms with distinct `forkKey` + floating-fragment top-level serialization) |
| `tests/e2e/markdown-html-validity.test.ts` | markdown render through the real SSR adapter — structured `<strong>`/`<textarea>` serialization, escaping, well-formedness |
| `tests/e2e/loop-safety.test.ts` | infinite-circle probes |
| `tests/e2e/legacy-bootstrap.test.ts` | legacy JSON → full render. **Real-legacy-shape pin (2026-08-14, D1–D8 — SPEC-ENCODED, fix pass PENDING; matrix row pending):** the placeholderLanding-shaped envelope — `placement` ARRAY entries (producer `placementName` + consumer `targetPlacement` on the same page), `css.style` OBJECTS, `css.cssDef` StyleNodes emitting deduped stylesheet rules, `doc.content` as a `ContentPayload[]` array, the re-expressed `{target: 'children', reference}` wrappers (root navBar/header/footer + header-def p→articleSubtitle) materialized via the anchor-layer seam — each wrapper renders as its OWN shell element CONTAINING the def-root element (`div > nav.nav-bar > [logo, links, auth]`, def type + classes + cssDef rules on the def element, delivery-shape ruling) — the h1's `{target: 'content', reference: articleTitle}` delivering TEXT only (F13), def root + children staying out-of-tree pre-minted prototypes (no host emission, no count-mismatch clobber) |
| `tests/e2e/component-handler.test.ts` | component-provided after-compile handler |
| `tests/e2e/markdown-display.test.ts` | in-place render, focus retention, parent changes |
| `demo/feature-matrix.js` (smoke) | one page exercising every surface: placements, components, handlers, payload lifecycle (append/refresh/drop), managed updates, reverse translation, loop-safety, PAR-5 parity, SSR hydrate seam. The `session` provider is data-declared on the root via `template.component` (K6 — value-carrying root binding → SOURCE anchor); the root's runtime duplex consumer half of `session`, the TWO DISTINCT theme providers (`theme-dark`/`theme-light` — Unit 11 re-expression: the same-name `theme` ×2 fork claim is an anti-pattern, placement-path-spec §10.ad, so each consumer resolves its own provider, one arm each), and the loop providers are runtime-only additions (legacy-unexpressible — `target` is an apply path, never a second name, K1–K8) |
| `demo/mode-toggle.js` (smoke) | same feature-matrix document driven through the three adapter modes — `?mode=ssr|client|markdown` (every build embeds both payloads, so static serves work; `scripts/serve-demo.mjs` serves per-mode too). **Demo-page test case — NOT expected real-world behavior.** SSR asserts the full well-formed server HTML was received (root-first, presentation ids present, balanced tags — the `validateHtmlShape` scan mirrors the e2e stack validator); markdown asserts the raw editor source is embedded verbatim for inspection alongside the live parsed display; client runs the shared harness with no mode-specific payload |
| `demo/fork-stress.js` (smoke, depths 2–12) | layered stress test of the forking render system — a binary tree built layer by layer, each layer adding 2 children per node through one of the four runtime child-creation mechanisms (placement → component values → component link → idempotent handler → repeats with different placement/component names). Pages `fork-stress-d{2,4,6,8,9,10,11,12}.html` (2^depth − 1 nodes). Only core (`dist/core/*`) + handler code — no demo-side render machinery. Each level changes a different css property (L1 background-color, L2 border-style, L3 border-width, L4 text-decoration, cycling) with a value per sibling slot (demo-only helper `levelCss`, NOT a core API). Checks: per-layer node counts, rendered-count, css per-level property + slot pairs, placement anchors, values/link binding rendering, handler idempotency (no after-compile loops), ancestry labels, incremental-render scope. Spec: `docs/specs/fork-stress.md` |
| `demo/fork-stress-data.js` (smoke, depths 2–12) | the DATA-DRIVEN variant of fork-stress: the same binary stress tree assembled from a LEGACY envelope alone (root + two prototype nodes per layer — handlers declared by NAME in the data, bodies supplied by the page) via the `clone-instance` op (recursive after-compile expansion; self-contained `c.node` bodies fire ONCE per clone — the DERIVED `stress:expanded` (`children.length > 0`, declared on the prototypes, inherited by clones — derived-state.md §9.2) replaces the marker op, so no self-ops, no re-dirties: 4094 handler calls at d12, half the marker era). Pages `fork-stress-data-d{2,4,6,8,9,10,11,12}.html` (2^depth − 1 nodes) + the three SINGLE-METHOD d12 variants `fork-stress-data-{placement,values,link}-d12.html` (spec §4): placement-only (pure clone structure), values-only (every prototype declares its scalar VALUE as a legacy `component` source — translate.md §2 — and every clone renders it as text), link-only (every prototype declares its component DEF as the source value; every clone's emission re-types the next layer — the recursive def chain, which exercises the emitter's covered-consumer `defChildren` path). Only core (`dist/core/*`) + the shared data-derivation helpers (`levelCss`/`cssPropForLevel`/`LAYER_METHODS` — NOT core APIs) — no demo-fixtures, no demo-side render machinery. Checks: per-layer node counts + total (RE-PINNED per placement-path-spec §5.2 F-13: contentNodes-ownership minting makes the 22 prototype content roots family-in-tree too — in-tree = 2^depth − 1 + prototypes, unplaced = 0, cloneOps stays the journaled clone count; the prototypes never compile/render, the token terminates the walk), css per-level property + slot pairs, `stress:kind` per layer mechanism, values/link method checks (per-node element text vs resolved source value / def content), DOM nesting vs graph children (all sources live on the prototypes, so the root emits like every node — walk from the root element), `stress:layers` ancestry chains (parent-baked at creation), derived idempotency (resolved-state `stress:expanded` true for non-leaves / false for leaves), incremental-render contract (bootstrap the only full compile). Spec: `docs/specs/fork-stress-data.md` + `docs/specs/derived-state.md` §9.2 |
| `demo/feature-showcase.js` (smoke) | the FEATURE SHOWCASE — ONE legacy envelope demonstrating the framework's advertised features both isolated and combined via ONLY the documented core interfaces + JSON handler/derived/anchor data (markdown above in §12). Confirmations: depth-0 scalar resolution into two consumers with derived `bindings.*` bakes, same-name self-provider multiplicity, provide-and-self-apply (`{reference, value, target: 'props.<k>'}` — K1/K2: the synthesized `props.moodPanel = {$: 'bindings.mood'}` bake reads the node's own published value), scoped unresolved fail-state, `circular-source` A↔B borrow-walk loop pair authored via the K7 ARRAY form (provider + consumer bindings on ONE node — `component: [{reference, value}, {reference}]`; dropped at compile — never rendered — no hang), derived-DSL bakes, placement badge, on:input/on:click string-body handlers mutating a sibling preview, one-shot idempotent after-compile stamp via `runPhase`, throwing-handler containment, css id/classes/style, contentNodes-owned content payloads (family-in-tree via the permanent-owner token, never rendered — P3 §10.ad/F-13), clientConfig gates. The two-name duplex anchor shape is runtime-only — no legacy data expresses it (K1–K8). PAR-5: the expected-output page is the same envelope through the real `SSRFragmentAdapter`. Checks walk the #app subtree (shim-compatible). Banner: `feature-showcase`. Spec/companion: `docs/framework-feature-summary.md` |
| `demo/path-fork-data.js` (smoke) | **Unit 11** — the STATIC placement-path page (placement-path-spec §5, page `path-fork-data.html`): the fork-stress topology re-expressed WITHOUT clones — the legacy envelope carries the root + 22 prototypes (two per layer 1..11) declaring `placementName` (producer/'container') and, for layers ≥ 2, `targetPlacement: ['zone-<k-1>']` (consumer — the R2.2 sibling-shared owner-name topology); the pipeline is translate → register → ONE `compilePath` bootstrap → `emitElements`/`diffMinimal`/`applyOps` (DomAdapter) → render — NO clone-instance ops, NO after-compile expansion (E2E-1 by construction: 4095 path-states pinned to 23 nodes). Checks: the static census (registered=23, in-tree=23, unplaced=0, destroyed=0, cloneOps=0 — smoke-pinned via the profile), state census (4095 distinct pathKeys, `forkKey = pathKey` on every state, `activePlacement` = the chosen zone name, no `#` anywhere), element census (4095 elements, wires = pathKeys — the (wire, forkKey) composite keys at the adapter boundary), per-level counts (2^k elements at level k, 1..11), css per-level property + slot pairs, derived `stress:expanded` idempotency (non-leaf path-states true, leaves false — incl. the root state), `treeFromOps` binary-shape reconstruction (1 root → 2 → … → 2048 leaves at depth 11, 4095 total), PAR-5 structural parity with the builder's `SSRFragmentAdapter` output (wire- and forkKey-agnostic shape signature — an FNV-1a 64-bit digest over the recursive type/props/children fold — the full 4095-element SSR fragment is ~190MB and is NEVER embedded; the page embeds the digest as `serverTreeSig` plus a 300-op truncated SSR sample `expectedSsrSample` proving the builder's SSR pipeline ran), profile line `[path-fork:profile] … states=4095 passes=1 …` + `globalThis.__pathForkDone`. Smoke guards: `assertStaticPathCensus` (the §5.2 numbers, never silent drift) + residual coverage + the placement-baseline decision (§10.ad N-5: the static page is its OWN reference — its single total is the new placement baseline, TODO recorded per §8 Q6; the runtime pages keep their existing placement baseline; tripwire: the single enumeration must not exceed the runtime placement total) |
| `demo/translate-showcase.js` (smoke) | the TRANSLATE-KERNEL showcase (K1–K8): every guard code exercised with its intended result (legal array-form card with K1 synthesis + provide-and-self-apply; plain consumer; duplicate reference + duplicate target pre-anchor blocks; vacuous `{}` warn+skip; `component: []` valid; unresolved consumer key-omission; `props.name.` syntax edge; unknown-path gap; dotted-reference carve-out), the K4 warnings channel rendered into the page, and the K5/N1 reverse round-trip (apply path persists as `target`, synthesized derived stripped, authored derived stays, re-translate fires no warnings). PAR-5 expected-output page via `SSRFragmentAdapter`. Banner: `translate-showcase`. Wired into `npm run demo:build` (page 18) + `demo:smoke` (seeded, `__translateShowcaseDone`, banner assertion) |
| `demo/legacy-shape.js` (smoke) | **the REAL-LEGACY-SHAPE regression page (2026-08-14, fix-pass plan item 5 — D1–D8; SPEC-ENCODED — matrix row PENDING, page not yet built)**: a production-shaped legacy envelope in the placeholderLanding style — `placement` as canonical ARRAYS (producer `placementName` + consumer `targetPlacement` on one page; a `placement-entry-invalid` side card for a non-object entry), `css.style` as OBJECTS (serialized by translate to kebab-case `k: v;` strings), `css.cssDef` StyleNodes emitted as deduped stylesheet rules from ACTIONABLE states only (with a nested media-query rule), `doc.content` as a `ContentPayload[]` array, the re-expressed `{target: 'children', reference}` wrappers materialized through the D7 anchor-layer seam (root navBar/header/footer + header-def p→articleSubtitle) — each wrapper asserted as its OWN shell element containing the def-root element (`div > nav.nav-bar > [logo, links, auth]`, def type + classes + cssDef rules on the def element, delivery-shape ruling SED-2) — with the h1's `{target: 'content', reference: articleTitle}` delivering TEXT only (F13/SED-3), a `{target: 'type', reference}` def with real children demonstrating SHELL COLLAPSE (SED-1: the consumer's element becomes the def's element), def root + children staying out-of-tree pre-minted prototypes (never emitted by the host — no count-mismatch clobber), and the obsolete `{content, metadata}` object form rejected with `payload-shape-obsolete` on the K4 channel. PAR-5 expected-output page via `SSRFragmentAdapter`. Banner: `legacy-shape`. Wired into `npm run demo:build` + `demo:smoke` |

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
  `feature-matrix.js` uses. Session lessons: `docs/session-defect-review.md`.
- `fork-stress-d{2,4,6,8,9,10,11,12}.html` — layered stress test of the
  forking render system. **Demo-page test case — NOT expected real-world
  behavior.** A binary tree built layer by layer; each layer adds exactly 2
  children per node through one of the four runtime child-creation
  mechanisms, cycling: placement → component values → component link →
  idempotent handler → repeats with different placement/component names.
  Depth d has layers 1..d−1 (layer k has 2^k nodes), total 2^d − 1. Every
  node renders its `stress:layers` chain (depth + tree-back-to-root) AND a
  different css property per level with a value per sibling slot (compile-
  lookup stressor; the `levelCss` helper is **demo-only** — see §14.3). The page uses ONLY core (`dist/core/*`) and
  handler code — the serializable part (L1 placement, L2 values, L3 link) is
  shipped in `preempt-initial-data`; the browser module drives the runtime
  layers (L4 handler, L5 placement, L6 values, L7 link, … up to L11) via the
  `attach` op, component sources/targets, and idempotent `after-compile`
  handlers (guarded by their layer marker — the default guard against
  after-assembly loops). Spec: `docs/specs/fork-stress.md`.
- `fork-stress-data-d{2,4,6,8,9,10,11,12}.html` — DATA-DRIVEN variant of the
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
  under it (recursive assembly — depth 12 = 4095 nodes). HandlerContext
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
- `fork-stress-data-{placement,values,link}-d12.html` — the SINGLE-METHOD
  d12 variants (spec §4): the whole tree relies on ONE mechanism.
  placement-only is pure clone structure; values-only adds `component`
  refs WITH the scalar VALUE to every prototype (a value-bearing binding is
  a legacy `component` SOURCE — translate.md §2 — and clone-instance
  inherits it with its value, so every clone renders its resolved value as
  text); link-only adds `component` refs whose VALUE is the component DEF
  (every clone's emission re-types the next layer — the recursive def
  chain). All sources are declared in the envelope — the page never
  attaches an anchor. The root carries no sources and emits like every
  node; nesting walks from the root, 2^depth − 1 elements. Banner:
  `Fork Stress (data: <method>) — depth 12`.
- `path-fork-data.html` — the STATIC placement-path page (placement-path-
  spec §5 — Unit 11), the runtime fork-stress page's static twin: the SAME
  22-prototype binary topology compiled by the path enumeration instead of
  clone-instance assembly. The legacy envelope carries the root + two
  prototypes per layer 1..11, each declaring `placementName` (producer —
  the 'container' role) and, for layers ≥ 2, `targetPlacement:
  ['zone-<k-1>']` (consumer — the R2.2 sibling-shared owner-name topology:
  both level-(k−1) prototypes own the shared zone name, so the chosen
  name's two containers fan out the path per hop). The page is translate →
  register → ONE `compilePath` bootstrap → emitElements/diffMinimal/
  applyOps (DomAdapter) → render: 4095 path-states from 23 graph nodes, no
  nodes created (E2E-1), every element a pathKey wire. Checks: the static
  census (23/23/0/0/0), state census (4095 distinct pathKeys, forkKey =
  pathKey), element census + per-level 2^k counts, css property/slot pairs,
  derived `stress:expanded` idempotency, `treeFromOps` binary-shape
  reconstruction, PAR-5 structural parity with the builder's
  `SSRFragmentAdapter` snapshot (wire- and forkKey-agnostic signature —
  the page re-translates the legacy envelope, so node ids are mint-time
  artifacts; authored prototype ids keep the props dimension stable).
  Profile `[path-fork:profile] … states=4095 passes=1 …`; the smoke pins
  the census + residual coverage + the placement baseline (the static page
  is its OWN reference — §10.ad; TODO to re-baseline the runtime pages per
  §8 Q6). CORE ONLY (`dist/core/*`) + the shared `levelCss`/
  `cssPropForLevel` helpers. Builder: `scripts/path-fork-page.mjs`.
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
  live-prod placeholderLanding dispositions D1–D8; **SPEC-ENCODED — page not
  yet built**): a production-shaped
  legacy envelope in the placeholderLanding style. Placement is authored as
  canonical `placement: [...]` ARRAYS (producer `placementName` — sidebar/
  article/modal zones — plus consumer `targetPlacement` lists — admin/
  contributor/nav links), each entry mapped through the single-entry logic
  (D1); `css.style` is authored as OBJECTS and translate serializes them to
  kebab-case `k: v;` strings — the rendered page carries no
  `style="[object Object]"` (D3); `css.cssDef` StyleNodes render as real,
  rule-signature-deduped stylesheet rules (a nested media-query rule
  included) from ACTIONABLE states only (D4/F10); `doc.content` is a
  `ContentPayload[]` array and the obsolete single-payload object form is
  exercised on a side card as the `payload-shape-obsolete` K4 warn (D2);
  the four subtree wrappers are authored as re-expressed
  `{target: 'children', reference}` bindings (root.children[0]/[1]/[3] →
  navBar/header/footer + the header-def p → articleSubtitle) and materialize
  the def subtree through the D7 anchor-layer seam — each wrapper renders as
  its OWN shell element containing the DEF-ROOT element (`div > nav.nav-bar >
  [logo, links, auth]`: def type + classes + cssDef rules on the def element
  — delivery-shape ruling SED-2, no empty shells, no def classes on the
  wrapper) with the def's root + children staying out-of-tree pre-minted
  prototypes — never emitted by the
  host, no count-mismatch clobber (D8/F16); the h1's `{target: 'content',
  reference: articleTitle}` delivers the def's TEXT only (F13/SED-3); a
  `{target: 'type', reference}` def with real children demonstrates the
  seam's multi-parent legal case AND SHELL COLLAPSE (SED-1: the consumer's
  element becomes the def's element — def type + css, no surviving wrapper).
  The expected-output page
  is generated from the SAME envelope through the real
  `SSRFragmentAdapter` (PAR-5 parity). Banner: `legacy-shape`. CORE ONLY
  (`dist/core/*`); builder `scripts/legacy-shape-page.mjs` (if needed) or
  the fixed expected page per the translate-showcase pattern. Wired into
  `npm run demo:build` + `demo:smoke`.

## 13. Running checks

```
npm test           # vitest — full suite
npm run typecheck  # tsc --noEmit
npm run demo:smoke # headless run of all demo checks
npm run build      # tsc emit
```

## 14. Authoring rules & browser realism (learned from session defects)

Full defect-by-defect analysis: `docs/session-defect-review.md`. The rules:

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

### 14.2 Browser realism (why the headless shim can mislead)

1. **Real DOM `children` is an HTMLCollection** — indexable + `.length` +
   `.item()`, NO `.map`/`.filter`. Harness code must always
   `Array.from(el.children ?? [])`. The smoke shim supports
   `REAL_DOM_CHILDREN=1` to emulate this and fail array-method misuse.
2. **Re-appending an attached element blurs it.** `diffMinimal` emits
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

From the post-implementation layered blind loop (`docs/test-findings.md`
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
   What never works: expecting the raw object to reach the DOM.
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
   2026-08-14; RCA: docs/session-defect-review.md "B1 children-target
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
