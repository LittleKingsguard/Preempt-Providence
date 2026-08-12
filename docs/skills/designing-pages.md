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
  data, or a `placement` anchor targeting the zone name. The anchor is a
  typed ref; content payload roots stay **unplaced** until attached into a
  zone.
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
| placement anchor materialized + renders | `translate.test.ts` TR-H3, demo T3 |
| component binding → target anchor (+ value) | TR-H2 |
| fork: N arms, distinct path keys | FRK-H2/F6, T12/T20, demo T6 |
| fork-arm adoption in `childOrder` | a forked node emits `<nodeId>#<i>` arms, never a base-id element; a parent referencing a forked child must list the arm wires (emitter expands them, arm order). All arms are direct children — no per-fork wrapper; `#<i>` single-arm adoption is unsupported (feature-matrix-review.md §4.1) |
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
  become unplaced content nodes; component/placement/handlers map to
  anchors/handlers; `run*` gates → adapter/persistence.
- **Reverse out** (`reverseTranslate`): live graph → backend NodeSchema.
  Reverses component/placement-induced tree state, keeps user edits.
  `opts.payloads` emits each payload as its own ContentPayload.
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
| `tests/unit/node.test.ts` | node lifecycle, layers, two-pass compile, forks, serialization, fail-states |
| `tests/unit/graph.test.ts` | Link/Anchor matrix, LinkConfigError atomicity, cascade sweep |
| `tests/unit/ops.test.ts` | structural executors, state-slice reducer, slice lock |
| `tests/unit/pipeline.test.ts` | registry/workers, slice lock, microtask queue, V/F matrix |
| `tests/unit/validation.test.ts` | tag schemas, LinkConfigError catalog, timing, clone |
| `tests/unit/render.test.ts` | serialization round-trip, fork keys, drop dispositions, SSR/ORD |
| `tests/unit/adapters.test.ts` | concrete adapter layer: `DomAdapter`/`SSRFragmentAdapter`/render-helpers — §10 DOM/FRG/HLP/PARS matrices of `docs/specs/adapters.md` (fork-arm `wireKey` targeting, D4 undefined-drop, styles coalescing, hydrate seam, parity, compiled-fork `forkKey` ops, `on:*` `escapeAttr`, floating-fragment `toString`) |
| `tests/unit/handlers.test.ts` / `phases.test.ts` | handler ctx/dispatch; phase ordering |
| `tests/unit/translate.test.ts` | legacy schema → graph (in) |
| `tests/unit/payload.test.ts` / `reverse.test.ts` | payload drop/refresh/append; reverse translation (out) |
| `tests/integration/payload-flow.test.ts` | payload lifecycle through the managed channel; edits surviving refresh |
| `tests/e2e/payload-refresh.test.ts` | full lifecycle: edit + append + refresh → in-place re-render → reverse with live state |
| `tests/integration/api.test.ts` | ClientAPI T1–T25 (journal, events, forks, gates) |
| `tests/integration/supervisor.test.ts` | journal replay/undo-redo, coalesced sweep |
| `tests/integration/handlers-flow.test.ts` | handler→journal→events; phase hooks; focused warnings |
| `tests/e2e/ssr-render.test.ts` | SSR→client complete render, parity, hydrate |
| `tests/e2e/ssr-html-validity.test.ts` | emitted-SSR-HTML validity through the **real** `SSRFragmentAdapter` (well-formedness, escaping, root-first, styles prefix; fork arms with distinct `forkKey` + floating-fragment top-level serialization) |
| `tests/e2e/markdown-html-validity.test.ts` | markdown render through the real SSR adapter — structured `<strong>`/`<textarea>` serialization, escaping, well-formedness |
| `tests/e2e/loop-safety.test.ts` | infinite-circle probes |
| `tests/e2e/legacy-bootstrap.test.ts` | legacy JSON → full render |
| `tests/e2e/component-handler.test.ts` | component-provided after-compile handler |
| `tests/e2e/markdown-display.test.ts` | in-place render, focus retention, parent changes |
| `demo/feature-matrix.js` (smoke) | one page exercising every surface: placements, components/forks, handlers, payload lifecycle (append/refresh/drop), managed updates, reverse translation, loop-safety, PAR-5 parity, SSR hydrate seam |
| `demo/mode-toggle.js` (smoke) | same feature-matrix document driven through the three adapter modes — `?mode=ssr|client|markdown` (every build embeds both payloads, so static serves work; `scripts/serve-demo.mjs` serves per-mode too). **Demo-page test case — NOT expected real-world behavior.** SSR asserts the full well-formed server HTML was received (root-first, presentation ids present, balanced tags — the `validateHtmlShape` scan mirrors the e2e stack validator); markdown asserts the raw editor source is embedded verbatim for inspection alongside the live parsed display; client runs the shared harness with no mode-specific payload |
| `demo/fork-stress.js` (smoke, depths 2–12) | layered stress test of the forking render system — a binary tree built layer by layer, each layer adding 2 children per node through one of the four runtime child-creation mechanisms (placement → component values → component link → idempotent handler → repeats with different placement/component names). Pages `fork-stress-d{2,4,6,8,9,10,11,12}.html` (2^depth − 1 nodes). Only core (`dist/core/*`) + handler code — no demo-side render machinery. Each level changes a different css property (L1 background-color, L2 border-style, L3 border-width, L4 text-decoration, cycling) with a value per sibling slot (demo-only helper `levelCss`, NOT a core API). Checks: per-layer node counts, rendered-count, css per-level property + slot pairs, placement anchors, values/link binding rendering, handler idempotency (no after-compile loops), ancestry labels, incremental-render scope. Spec: `docs/specs/fork-stress.md` |
| `demo/fork-stress-data.js` (smoke, depths 2–12) | the DATA-DRIVEN variant of fork-stress: the same binary stress tree assembled from a LEGACY envelope alone (root + two prototype nodes per layer — handlers declared by NAME in the data, bodies supplied by the page) via the `clone-instance` op (recursive after-compile expansion; page-side pending registry keeps re-runs O(1)). Pages `fork-stress-data-d{2,4,6,8,9,10,11,12}.html` (2^depth − 1 nodes) + the three SINGLE-METHOD d12 variants `fork-stress-data-{placement,values,link}-d12.html` (spec §4): placement-only (pure clone structure), values-only (every prototype declares its scalar VALUE as a legacy `component` source — translate.md §2 — and every clone renders it as text), link-only (every prototype declares its component DEF as the source value; every clone's emission re-types the next layer — the recursive def chain, which exercises the emitter's covered-consumer `defChildren` path). Only core (`dist/core/*`) + the shared data-derivation helpers (`levelCss`/`cssPropForLevel`/`LAYER_METHODS` — NOT core APIs) — no demo-fixtures, no demo-side render machinery. Checks: per-layer node counts + total, prototypes stay unplaced, css per-level property + slot pairs, `stress:kind` per layer mechanism, values/link method checks (per-node element text vs resolved source value / def content), DOM nesting vs graph children (all sources live on the prototypes, so the root emits like every node — walk from the root element), `stress:layers` ancestry chains, handler idempotency, incremental-render contract (bootstrap the only full compile). Spec: `docs/specs/fork-stress-data.md` |

## 12. Demo pages (`npm run demo` → http://localhost:4173/demo/)

- `ssr-render.html` — SSR doc → client re-render, parity, fork arms.
- `loop-safety.html` — each probe with expected behavior + structure.
- `components.html` — everything framework-rendered; placements,
  components, user pane (login/logout), markdown editor → display
  (in-place, focus-safe), tests as content nodes.
- `feature-matrix.html` — the single "every surface" document: a legacy
  envelope re-resolved from its serialized anchors (S4.2), session pane +
  markdown editor via after-compile/input handlers, content/comments payload
  lifecycle (append websocket comment, refresh article in place, drop
  comments — sibling payload untouched), theme forks rendering 2 arms each,
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
  exactly once (marker-guarded, O(1) per firing — no page-side queue, no
  graph scans). The page uses ONLY core
  (`dist/core/*`) + the shared data-derivation helpers (`levelCss`/
  `cssPropForLevel`/`LAYER_METHODS` — demo-only, see §14.3) — no
  demo-fixtures, no demo-side render machinery. Its runner checks mirror the
  imperative page's: per-layer counts + total, css property/slot pairs,
  `stress:kind` per mechanism, DOM nesting vs graph children, ancestry
  chains, idempotency, and the incremental-render contract (bootstrap the
  only full compile). Spec: `docs/specs/fork-stress-data.md`.
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
3. **Self-expansion is O(1) per firing — but never scan the graph.** The
   marker-prop apply re-fires the body on the node's next pass; the marker
   guard no-ops it, so each node expands exactly once with no queue.
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
   resolve.ts). Link d12 now ~8.7s shim.
5. **A clone inherits the prototype's LAYERS (handlers ride along) but NOT
   its parent's chain.** Build `stress:layers` from
   `c.tree.ancestorsOf(node)` and set it on the clone, or per-node-chain
   checks fail.
6. **Legacy envelope css is the flat legacy shape** (`{ style, classes }`),
   never nested under an extra key — nesting stringifies into `cssText` and
   css checks fail. Markers go in `props`.
7. **Self-verifying demos: the banner is the gate.** The smoke asserts the
   exact banner string; keep checks merged to that count and the banner
   text verbatim.
