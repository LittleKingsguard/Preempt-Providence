# Preempt-Providence — Framework & Feature Summary

Authoritative detail lives in the docs linked throughout. This file is the
orientation / proofread surface: what the framework IS, its architecture, and
every advertised feature with a real-world use case. Inconsistencies found
here should be fixed against the code and the linked specs.

---

## 1. What the framework is

Preempt-Providence is a **declarative, graph-based page renderer**. A page is
described as *data* (a template root + content payloads, or a serialized
anchor document), which the engine translates into an **anchor graph** of
`Node`s with no stored parent/children/state (Pillar A: everything is
derived). A pipeline then compiles that graph into **compiled states** —
resolved component bindings, fork arms, derived values, validation — and a
render adapter turns a minimal diff of states into DOM/SSR/headless output.

After first paint, reactivity is **mutation-based**: a single managed channel
(`Supervisor`/`ClientAPI`, Pillar B) applies journaled ops (`state-slice`,
structural ops), and only the affected subtree re-compiles (`compileLocal` +
pass-2), re-renders (`diffMinimal` → `applyOps`), and re-dispatches phase
handlers. Nothing outside the channel writes the graph.

Two input directions meet at the boundary (`docs/specs/translate.md`):
native anchor documents (new format, `createClient`/`loadState`) and the
**legacy JSON envelope** (`LegacyInitialData` = `{ template, content,
clientConfig }`) translated by `translateLegacy`. The demo pages use the
legacy envelope through **only** the documented interfaces + core
(`dist/core/*`) — no page-side feature logic (the reviewer surface for
"did the writer invent JS?").

--- 

## 2. Architecture (pillars & pipeline)

| Pillar | Meaning | Home |
| --- | --- | --- |
| A — Node | no stored parent/children/state; these are decoded from the anchor graph | `RENDER_PROCESS_NOTES.md` §10.8, `docs/specs/node.md` |
| B — Supervisor / ClientAPI | the **only** mutation surface; journaled ops (`journalId`, replay/undo/redo) | `docs/specs/api.md` §1-§3, `docs/specs/ops.md` §6 |
| C — Pipeline | ordered phases: instantiation → targetPlacementResolution → placementAssembly → componentRouting → componentAssembly → slotAssembly → preprocessing → validation → elementCreation → treeAssembly → postprocessing | `docs/specs/pipeline.md` §1.2 |
| D — Node layers | mutate via layers; `compileLocal` merges base+layers; `cleanup` on destroy | `docs/specs/node.md` §6 |
| E — Validation | `TAG_SCHEMAS` / `TagSchema` per tag; `LinkConfig` guards link roles (structural only) | `docs/specs/validation.md` (schema) |
| F — Render | `RenderAdapter` (DOM/SSR) + `diffMinimal` / `applyOps` / `emitElements`; PAR-5 parity | `docs/specs/adapters.md`, `docs/specs/render.md`, `RENDER_PROCESS_NOTES.md` §6.8 |
| G — Graph | `Link`/`Anchor`/`AnchorLayer`; derived parentage; single-parent invariant | `docs/specs/graph.md`, `docs/specs/node.md` §1.2 |

A page lifecycle in one line: **data → translate/link → two-pass compile
(pass-1 `compileLocal`, pass-2 resolved `compile(slice)`) → render ops →
adapter → journaled mutations for updates.**

---

## 3. Feature inventory with real-world use cases

Each row: the feature, the use case (who benefits / what it powers), and the
canonical doc. "Isolated vs combined" demos for the data-driven subset live
in `demo/feature-showcase.html` (see §5).

### 3.1 Data model & graph

| # | Feature | Real-world use case | Doc |
| --- | --- | --- | --- |
| F1 | **Anchor graph, derived parentage** (no stored parent/children/state) | A CMS tree edited live by many authors: you never fight stale parent pointers; the tree is always a decode of the anchors | `node.md` §1-§2 |
| F2 | **Legacy JSON envelope** (`template.root` + `content` payloads + `clientConfig`) | A backend that already emits `{ template, content }` keeps its format; the frontend translates at the boundary | `translate.md` §1-§2 |
| F3 | **Serialized anchor documents** (`serializeSlice`/`parseNodeState`, `loadState`+`reconcileParentTargets`) | Save/resume a page, server-side snapshot, round-tripping through the DB | `node.md` §10, `render.md` §5 |
| F4 | **Stable ids** (`mintNodeId`/`mintLinkId`) | Deterministic, debuggable DOM; safe diffing across renders | `node.md`, `api.md` |
| F5 | **`Node.clone`** base+layer inheritance | Prototype-driven page assembly: one prototype spawns many near-identical cards | `node.md` §6, `fork-stress-data.md` |

### 3.2 Compile & component resolution

| # | Feature | Real-world use case | Doc |
| --- | --- | --- | --- |
| C1 | **Two-pass compile** (sync pass-1 + async pass-2, `focusedSliceFor`/slices, walk-path-only) | Fast first paint + cheap focused updates; only the affected slice re-resolves | `node.md` §8, `compile-horizon-review.md` |
| C2 | **Component `target`/`source`/`duplex` anchors** | Shared look/behavior: a "product card" consumer resolves a themed source; value-bearing sources feed text; duplex = provide-and-consume (runtime anchors only — legacy `component.target` is the LOCAL apply path `props.<key>`, never a second component name; the two-name duplex anchor shape is legacy-unexpressible, K1–K8, `translate.md` §2.1) | `translate.md` §2, `api.md` §4 |
| C3 | **Forking (same-name multiplicity → N actionable arms)** | "Who's on shift" feeds: two duty rosters provide the same reference; the panel shows both | `api.md` §4.2, `derived-state.md` |
| C4 | **Placement: two-sided roles on the per-name zone-registry Link + static path multiplicity** (`placementName` → `container` anchor; `targetPlacement: string[]` → ordered `content` anchors; `placement-attach` op for post-render placement) | Register regions by name (header/sidebar/comments) and mount payload content into them — legacy-faithful static placement: one source fans out to every zone of the first-matched name, one path-state per (node, path-to-root) (`forkKey = pathKey`, no `#<i>`), or post-render via the dedicated op | `pipeline.md` §1.2/§3, `api.md` §5, `placement-path-spec.md` §1-§3 |
| C5 | **Fail-states: `unresolved-reference` + `circular-source`** | A missing provider never hangs the page; the node renders its own state; loop warnings are diagnostics | `api.md` §4.3 |
| C6 | **Loop safety (borrow walk, circular drop)** | A provider chain that loops back on itself (a partner site referencing back) can't infinitely recurse | `api.md` §4.2, loop-safety demo, showcase loop pair (§5) |

### 3.3 Handlers & reactivity

| # | Feature | Real-world use case | Doc |
| --- | --- | --- | --- |
| H1 | **Event handlers (`dispatchEvent`, `on:*` bindings)** | Inputs, toggles, save buttons: DOM events → journaled mutations | `handlers.md` §3, `adapters.md` §3 |
| H2 | **Phase handlers (`before-compile`/`after-compile`/`after-render`)** | Hydration population after the pane resolves; one-shot stamps; audit counters | `handlers.md` §4 |
| H3 | **String handler bodies instantiated at translate** | Fully database-driven pages: the JSON ships the logic (admin-gated!) | `translate.md` §2 |
| H4 | **`HandlerContext` (clientAPI, node, tree, states)** | A handler reads siblings/parents and writes through the only channel | `handlers.md` §2 |
| H5 | **Containment + journal (replay/undo/redo)** | Throwing handler can't crash the render; every change is undoable | `handlers.md` §3, `ops.md` |
| H6 | **Derived state (variant D, JSON DSL)** | Bake resolved binding values / path / children counts into the state without a second pass — SSR/client agree by construction | `derived-state.md` §2-§4 |
| H7 | **`state-slice` mutations (props/css/handlers layered)** | Live edits: rename a card title, re-skin, swap a handler | `ops.md` |

### 3.4 Render & serialization

| # | Feature | Real-world use case | Doc |
| --- | --- | --- | --- |
| R1 | **`diffMinimal` + `applyOps` + `emitElements`** | Update only what changed since last render — cheap after first paint | `render.md` §3, `adapters.md` §2 |
| R2 | **DOM / SSR / mock adapters (PAR-5 parity)** | SSR first paint, client hydration, headless tests all from the same ops | `adapters.md` |
| R3 | **`css:<id|classes|style>` sets + `cssDef` via the batch `styles` op** | Layout/rules shipped with the node instead of a stylesheet hunt | `adapters.md` §3-§4 |
| R4 | **Tree round-trips (`treeFromOps`/`treeSig`/`reverseTranslate`)** | Compare server vs client render exactly; rebuild legacy docs | `adapters.md` §2/§10.3, `translate.md` (reverse) |

### 3.5 Data-driven page pattern (demo pages)

The fork-stress-data pages and the feature showcase prove a page can be
driven **entirely from the legacy envelope + core interfaces**: handlers
declared by name/event/phase in the data, bodies supplied or JSON-stringed;
all anchors/sources/forks/derived rules in the envelope; page module uses
only `translateLegacy` → `Supervisor`/`createClient` →
`DomAdapter`/`emitElements`/`diffMinimal`/`applyOps` → `dispatchEvent` on
the adapter's `onEvent` seam. `docs/specs/fork-stress-data.md` is the
pattern contract; `demo/feature-showcase.*` is the showcase contract; the
translate-layer kernel has its own data-only showcase —
`demo/translate-showcase.*` (K1–K8: `props.<key>` apply paths + synthesized
derived, array form, vacuous/duplicate/gap guards on the K4 warnings
channel, K5/N1 reverse round-trips).

---

## 4. Behavioral invariants to preserve

- Single mutation channel; **no direct field writes** anywhere else
  (handlers.md §2).
- Three-scope compile (root-out deep / node-local / path enumeration);
  phase ordering `before-compile → op → pass-2 →
  after-compile → events → after-render` (handlers.md §4).
- Read-only compiled states: `getState`/`node.resolved` never drain the
  renderer snapshot; only `supervisor.takePass2States()` drains (handlers.md §2.1).
- Derived rules ship in the data (parity), props keys with dots rejected,
  null → key omitted (derived-state.md §3-§4).
- Legacy extra fields are ignored, never rejected (translate.md §2).
- Renderer never compiles on the render path after bootstrap (the
  fork-stress incremental contract; `RENDER_PROCESS_NOTES.md` §10.10.4).

---

## 5. The feature showcase

- `demo/feature-showcase.html` (built from `demo/feature-showcase.template.html`)
  — legacy JSON envelope + comments paired with the docs above + intended
  result per section, live DOM, and the expected-output reference.
- `demo/feature-showcase.expected.html` — the SSR-rendered expected output
  (PAR-5 parity snapshot, generated by `scripts/feature-showcase-page.mjs`).
- `demo/feature-showcase.js` — core-only page module + runner checks.
- `demo/translate-showcase.html` (built from `demo/translate-showcase.template.html`
  by `scripts/translate-showcase-page.mjs`) — the translate-layer kernel
  showcase (K1–K8): every guard code exercised with its intended result, the
  K4 warnings channel rendered into the page, and K5/N1 reverse round-trip
  checks; `demo/translate-showcase.expected.html` is its SSR parity snapshot.
  Built separately — not yet wired into `npm run build`/`demo:smoke` (follow-up).