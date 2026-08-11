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
- **Bootstrap vs incremental**: one full-depth compile at bootstrap; every
  subsequent render consumes the supervisor's pass-2 compiled states
  (`takePass2States`) — no render-side compile.
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
| `tests/unit/handlers.test.ts` / `phases.test.ts` | handler ctx/dispatch; phase ordering |
| `tests/unit/translate.test.ts` | legacy schema → graph (in) |
| `tests/unit/payload.test.ts` / `reverse.test.ts` | payload drop/refresh/append; reverse translation (out) |
| `tests/integration/payload-flow.test.ts` | payload lifecycle through the managed channel; edits surviving refresh |
| `tests/e2e/payload-refresh.test.ts` | full lifecycle: edit + append + refresh → in-place re-render → reverse with live state |
| `tests/integration/api.test.ts` | ClientAPI T1–T25 (journal, events, forks, gates) |
| `tests/integration/supervisor.test.ts` | journal replay/undo-redo, coalesced sweep |
| `tests/integration/handlers-flow.test.ts` | handler→journal→events; phase hooks; focused warnings |
| `tests/e2e/ssr-render.test.ts` | SSR→client complete render, parity, hydrate |
| `tests/e2e/loop-safety.test.ts` | infinite-circle probes |
| `tests/e2e/legacy-bootstrap.test.ts` | legacy JSON → full render |
| `tests/e2e/component-handler.test.ts` | component-provided after-compile handler |
| `tests/e2e/markdown-display.test.ts` | in-place render, focus retention, parent changes |
| `demo/feature-matrix.js` (smoke) | one page exercising every surface: placements, components/forks, handlers, payload lifecycle (append/refresh/drop), managed updates, reverse translation, loop-safety, PAR-5 parity, SSR hydrate seam |

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

## 13. Running checks

```
npm test           # vitest — full suite
npm run typecheck  # tsc --noEmit
npm run demo:smoke # headless run of all demo checks
npm run build      # tsc emit
```
