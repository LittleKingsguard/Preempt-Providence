# Updating from the original `/Preempt` engine to Preempt-Providence

How to move an existing system that runs the original `/Preempt` core rendering
engine (the worker-phase stack in `src/core/*` — `Supervisor.process`,
`ClientAPI.modifyNode`, `Node.receiveNextState`, the `InstantiationWorker`-…
`SSRTreeAssemblyWorker` phase registry) onto the new Providence engine
(`src/core/*` in this repository: anchor graph, managed channel, two-pass
compile). **The legacy JSON data format does NOT change** — Providence
consumes the same `{ template, content, clientConfig }` documents at the
boundary (`docs/specs/translate.md`). What changes is the JS that boots,
renders, and mutates the page.

Authoritative contracts: `docs/specs/translate.md` (data boundary), `docs/specs/api.md`
(mutation surface), `docs/specs/contract.md` (module surface), `docs/specs/pipeline.md`
(phases), `docs/specs/handlers.md` (handlers/phases), `docs/specs/adapters.md` +
`docs/specs/render.md` (rendering), `docs/skills/designing-pages.md` (page authoring).
The demo pages are worked migration examples (see §7).

---

## 1. What stays the same

- **The JSON envelope.** `{ template: { root, children, component }, content?:
  ContentPayload[], clientConfig? }` is the Providence entry format
  (`translateLegacy`). Its fields — `type`, `placement` (array or object),
  `component` (single or array), `content`, `children`, `props`, `handlers`,
  `css`, `versions` — are the same schema the original `NodeSchema.ts`
  declared. Day-one: your data loads without rewrite — **with ONE trap** (see
  the boxed note below): `doc.content` is **`ContentPayload[]`-only** in
  Providence, while the original `Supervisor` also accepted the single-payload
  OBJECT form. If your backend emits `doc.content` as
  `{ content: [...], metadata }`, it **silently stops delivering the payload**
  after migration (`payload-shape-obsolete`, payload skipped).
- **`<script id="preempt-initial-data">` hydration.** `clientAPI.getInitialData()`
  read it in the original; the Providence demo pages read the same element.
- **The placement model** (`placementName` drop-zones + `targetPlacement`
  request lists) and **the component reference model** (`{reference, target,
  value}` bindings) carry over by the same names.
- **Handler bodies ship as function-STRING data** and are instantiated at the
  boundary — as before, but the default body convention changes (see
  `handler format`, §4).
- **The WS transport** carries over as the event path (`WebSocketClient`
  subscription in the original → `EventBridge` envelopes here).

> **MIGRATION TRAP — `doc.content` ARRAY-ONLY (D2/F5):** the original engine
> accepted **both** `ContentPayload[]` and the single-payload OBJECT
> (`old core/Supervisor.ts:428` did array-or-object). Providence is
> **array-only** — a single object `{ content: [...], metadata }` warns
> `payload-shape-obsolete` and the payload is **skipped** (never a throw,
> never half-translated). A page that rendered fine before migration because
> its payload was served as an object will render **empty/without its payload
> content** after migration, with only a console warning. **Fix before you
> boot:** normalize at the backend send path or the page bootstrap —
> `const content = Array.isArray(doc.content) ? doc.content : [doc.content]`
> when `doc.content` is a non-array object. The live Logged-inLanding envelope
> hit this EXACTLY (`Post-migration.json` ships the object form) — the §7
> `PostFix1` worked example normalizes it and shows the before/after.

> **MIGRATION TRAP — `target: 'content'` delivers TEXT-ONLY (SED-3, the
> `content`-target content slot, 2026-08-19 live-prod/Logged-inLanding):** a
> `content`-target seam injects **only the def's `content` text** into the
> consumer — it does NOT materialize a def subtree. A def WITHOUT a `content`
> field contributes **nothing** through that seam (empty slot, no warning).
> The live production envelope authored its whole nav/header/footer as
> `{ reference: 'navBar'|'header'|'footer', target: 'content' }`
> — the original SPA bootstrap rendered those as full components; through
> `translateLegacy` **unmodified, every one of those slots renders EMPTY**
> (the page body/article still renders). **Fix before you boot:** express the
> seam as `target: 'children'` when you want the def's subtree delivered as a
> child of the consumer (the renderer's `--adapted` swap — §7 — reproduces
> the original page exactly), or author a `content` field on the def when
> text-only is actually what you want. Data-shape audit: translate the raw
> envelope and compare element counts against the `--adapted` (children-
> target) render before wiring the boot — a shrunk element set means the
> `content`-target seams are swallowing whole subtrees. §7's `PostFix1` is the
> applied fix for the live Logged-inLanding envelope (seam swap + the §1
> content-array trap, both in the DATA — no engine change).

## 2. The architectural shift (what "moving engines" really means)

| Original `/Preempt` | Providence |
| --- | --- |
| Mutable tree: `Node` stores `parent`/`children`, state fields, a layer stack | **Pillar A**: `Node` stores NO parent/children/state — all derived from the anchor graph (`docs/specs/node.md`, `docs/specs/graph.md`) |
| Any code writes the tree (phases, handlers, `receiveNextState`) | **Pillar B**: ONE managed channel — `clientAPI.apply` → journaled `supervisor.apply` ops (`docs/specs/api.md` §1); direct field writes are structurally impossible |
| Phase pipeline re-walks the tree per update | Two-pass compile: sync `compileLocal` + deferred pass-2; only the affected slice re-resolves (`docs/specs/pipeline.md`) |
| State updates via `modifyNode`/`receiveNextState` pushing into `_nextStateQueue` | Named, journaled **ops** (`state-slice`, structural ops) — replay/undo/redo for free |
| Opaque single output (mount string | element tree) | `diffMinimal` → render ops → `applyOps` onto a `RenderAdapter` (DOM/SSR/mock) — PAR-5 parity |

The migration surface is therefore: **(1) boot code, (2) mutation calls,
(3) handler bodies, (4) placement/structure changes, (5) the server transport.**
Data is largely transported as-is — with the shape warnings of §3 as the only
required cleanup.

## 3. Data-shape decisions you must plan for (translate-time)

These are the live-prod legacy-shape dispositions (D1–D8, provenance
`live-prod/placeholderLanding/FINDINGS.md`; encoded in `docs/specs/translate.md`
§1–§2). Providence **warns, never throws** (K4 channel); each obsolete shape
translated the old way produces the warning below and the documented fallback.

| Legacy shape | Providence behavior | Warning code |
| --- | --- | --- |
| `NodeData.content` dual-parse (text OR `children`) | **`content` is TEXT-ONLY.** Children live ONLY in `children` (a `NodeData`/array in `content` is never dual-parsed) | `children-shape-invalid` (non-array `children` value only) |
| `doc.content` single-payload OBJECT `{ content, metadata }` | `doc.content` is **`ContentPayload[]`-only**; any other shape warns + the payload is SKIPPED (never half-translated) | `payload-shape-obsolete` |
| `css.style` as `Record<string,string>` OBJECT | serialized **to a kebab-case `k: v;` CSS string at translate**; reverse parses back to an object (no provenance tracking) | none — accepted |
| `placement` as single OBJECT (or `[]`) | single object = convenience; **ARRAY is canonical**; non-object entries warn + skip that entry only; `[]` legal | `placement-entry-invalid` |
| `targetPlacement` as a bare STRING | coerced to `[string]` | `placement-string-coerced` |
| `component.target` as a SECOND COMPONENT NAME (duplex) | `target` is the **local injection path** (`props.<key>`, `type`/`content`/`children` seam) — never a component name | `component-target-skipped` / `component-target-gap` |
| legacy lifecycle hook phases (`beforeAssembly`, `afterPreprocessing`, …) | **not supported** in the new 3-phase set — def skipped (ONE carve-out: `handlers.afterAssembly` maps to the `after-compile` phase, AUTH-SEAM) | `handler-phase-unknown` |
| duplicate references / duplicate targets in one node's `component` array | blocked + warned (K8) | `component-duplicate-reference` / `component-duplicate-target` |
| component array values targeting `type` | arrays at the seam are vacuous — they materialize nothing | (none) |

Run your existing documents through `translateLegacy` once and audit the
warnings channel before writing any new markup. A doc that translated "clean"
before may still carry several of the above — all are safe (warn + fallback),
none crash.

### The three seam targets (what your `{ reference, target, value }` bindings mean now)

- `target: 'content'` — **TEXT ONLY** (SED-3, F13/ALS-7): the def's `content`
  field replaces the consumer's text slot; a content-less def contributes
  nothing. **Not** a subtree injection (see the §1 trap box).
- `target: 'children'` — **SHELL + DEF-ROOT CHILD** (SED-2): the consumer
  keeps its OWN element, authored text and children UNTOUCHED; the def-root
  element (def type + css) joins as an ADDITIONAL child. This is the
  migration-safe replacement for a legacy `content`-target that was really
  injecting a whole component.
- `target: 'type'` — **SHELL COLLAPSE** (SED-1): the consumer's element
  BECOMES the def's element — def **type + css + content + props** (DEFECT #25,
  2026-08-19: def-authored `content`/`props` surface as `text` + element
  attributes; the consumer's own scalar binding wins over def content when
  both exist). This is the shape the live "crafted link" pattern relies on
  (`adminDashboardLink`/`editContentLink`/`createArticleLink` wrappers).

**Placed content INTO def-child drop-zones** (a `placement` container inside a
def-root's child subtree — the live navBar's `adminLinks`/
`authorLinks`/`contributorLinks`/`navAdditionalLinks`): supported since
DEFECT #24 (2026-08-19). A placed packet may target a def-internal container;
with a `children`-target seam under an in-tree consumer the def subtree
realizes for resolution, the packet compiles + emits NESTED under the zone
(the full root-down chain match — P-EMIT-8/10). Pre-DEFECT-#24 such packets
compiled 0 actionable path-states and silently dropped.

## 4. Surface migration maps

### 4.1 Boot / render

**Original:**
```ts
(window as any).Preempt = { Supervisor, WebSocketClient, clientAPI, Template }
const template = new Template(data.template)
await Supervisor.process(pipelineConfig, template, data.content)
// output: Supervisor renders into #app; WS events through WebSocketClient
```

**Providence** (the demo-page recipe — `demo/hooks-scenarios.js`,
`demo/hooks-array-scenarios.js`, `demo/fork-stress-data.js`):
```ts
import { translateLegacy } from '.../dist/core/translate.js'
import { Supervisor } from '.../dist/core/supervisor.js'
import { EventBridge } from '.../dist/core/events.js'
import { createClient } from '.../dist/core/client.js'
import { DomAdapter } from '.../dist/core/adapters.js'
import { emitElements, applyOps } from '.../dist/core/render-helpers.js'
import { diffMinimal } from '.../dist/core/render.js'

const hub = /* LinkConfigNameHub — a linkFor(name, kind) cache (demo pattern) */
const translated = translateLegacy(JSON.parse(
  document.getElementById('preempt-initial-data').textContent.trim()), { hub })
const events = new EventBridge()
const supervisor = new Supervisor({ hub, events })
for (const n of translated.nodes) supervisor.registerNode(n)
const clientAPI = createClient(supervisor)
const adapter = new DomAdapter(document.getElementById('mount'))

const cr = translated.root.compile(translated.nodes)   // bootstrap full compile
supervisor.recordResolved(cr.actionable)
const els = emitElements(cr.actionable, new Map(supervisor.allNodes().map(n => [n.id, n])))
applyOps(adapter, diffMinimal(prevMap, els))            // first diff from null
```

After first paint, updates never full-compile: run the op, flush the
supervisor's pass-2 microtask queue, `takePass2States()`, re-emit/diff/apply
(see §4.4 and `docs/skills/designing-pages.md` §5 "Bootstrap vs incremental").

**Old pipeline phases → new:** `InstantiationWorker`→ translate + `compile` /
`compilePath`; `PlacementWorker`/`TargetPlacementResolverWorker`→ placement
anchors at translate + path enumeration; `ComponentRoutingWorker`/
`ComponentAssemblyWorker`/`SlotAssemblyWorker`→ pass-2 resolve + the D7 seam
(`target: type|content|children` materialization); `PreprocessingWorker`→ the
`before-compile`/`after-compile` phase set; `ValidationWorker`→
`TAG_SCHEMAS`/`validateNode` (`docs/specs/validation.md`); Client/SSR element
+ tree assembly workers→ `DomAdapter`/`SSRFragmentAdapter` + `applyOps`.
There is no 1:1 worker migration — the pipeline is unified, not re-wired.

### 4.2 Mutation (the heart of the port)

| Original call | Providence replacement |
| --- | --- |
| `clientAPI.modifyNode(partial, targetNode)` | `clientAPI.apply(nodeId, [{ targetProp: 'props.<k>' | 'style' | 'content' | 'type' | …, mode: 'replace', value }])` — a `state-slice` |
| `node.receiveNextState(partial)` (any code path) | a `state-slice` via the channel — `receiveNextState` does not exist |
| `clientAPI.fetchContent(opts)` / `addContentNodes(nodes, batchId)` | structural ops over nodes owned by the `'contentNodes'` permanent owner (payload lifecycle — `docs/specs/payload.md`, `src/core/payload.ts`) |
| `Supervisor.injectContent(payload)` | content-node attach through the payload lifecycle (`appendToPayload`/`dropPayload`/`refreshPayload` — `src/core/payload.ts`) |
| `clientAPI.fetchHandlers` / `getHandler` / `compileHandler` | handler binding via layers + the handler-seam (`docs/specs/handlers.md` §6); bodies still ship as strings |
| mutate `placement` via a state write | **hard-blocked** (`placement-target-blocked`) — placement change = the dedicated `placement-attach` structural op (`docs/specs/api.md` §3.3) |
| mutate/attach `children` | never a field — graph-derived; attach via `attach`/`move`/`clone-instance` ops |
| phase-driven reruns (`Supervisor.rerun()`, `emitToPhase`) | `supervisor.runPhase(phase, nodeId?)` for the new phase set — or just apply the op |

**Placement is a forward structural change, never a slice.** Port any handler
that previously wrote `placement` through `receiveNextState` (the original
blocked this too, with a console error) into a `placement-attach` op.

### 4.3 Handlers & phases

- **Body convention (`format`)**: the original compiled string bodies as
  `(event, context)`. Providence inline bodies default to **`(ctx, ...args)`**.
  A handler def can pin `format: 'legacy'` to keep the original
  `(event, context)` order (wrapped by the bridge) or `format: 'modern'` for
  the raw `(ctx, ...args)` body. Explicit `format` persists on reverse.
- **The 3-phase set** is closed: `before-compile`, `after-compile`,
  `after-render` (phase ordering per `docs/specs/handlers.md` §4). Legacy
  lifecycle names (`beforeAssembly`, `afterRender`, `beforePreprocessing`, …)
  are **skipped** with `handler-phase-unknown`; event bindings (`handlers.*`,
  `onEvent`) work as before. The only carve-out: `handlers.afterAssembly`
  maps to `after-compile` (AUTH-SEAM, `docs/decisions.md`).
- **Context**: handlers receive `context.clientAPI` (the only write channel),
  `context.supervisor`, and `context.tree`. Writes are journaled — a handler
  throw cannot corrupt the render.
- **Nested emissions during an active slice are deferred** (microtask queue),
  not interleaved — a ported handler that previously sequenced two mutations
  now observes both upstream and downstream in the deferred pass-2 sweep, not
  mid-slice.

### 4.4 Scribble / incremental-update loop (the render side of §4.1)

Every demo page uses the same pattern after an op:

1. `supervisor.apply(op)` (or `clientAPI.apply(id, sliceList)`) — pass-1 sync.
2. Flush the microtask queue (`await` a few macrotask turns) so the deferred
   pass-2 sweep runs.
3. `supervisor.takePass2States()` → merge into your per-node state map.
4. `emitElements(actionable, byNode)` → `diffMinimal(prevMap, els)` →
   `applyOps(adapter, ops)` — minimal diff, not a re-render of the page.
5. Keep `prevMap` for the next diff.

### 4.5 Server / transport

| Original | Providence |
| --- | --- |
| `WebSocketClient` topic subscription + auto-reconnect | `EventBridge` per-tick coalesced `EventEnvelope`s (`docs/specs/api.md` §7); `src/server.ts` exposes `POST /ws` fan-out and `POST /api/apply` + `GET /api/state` |
| server API `ssr.ts` / DB routes | same legacy envelope is accepted; the server module is a thin `ClientAPI` over the supervisor |
| `Supervisor.process(pipelineConfig, …)` server-side SSR | `clientConfig.runInstantiation/Rendering` → `adapter: 'ssr' | 'dom'` at translate; render via `SSRFragmentAdapter` (`docs/specs/adapters.md` §4) |

---

## 5. Behavioral invariants to port your expectations to

- **Read-only compiled states.** `getState`/`node.resolved` never drain a
  renderer snapshot; only `supervisor.takePass2States()` drains.
- **Fail-state visibility.** An unresolved reference is a **compile status**
  (`unresolved-reference`) + a logged warning; the node still renders its own
  state — never a silent drop, never a crash. Loop-terminated arms drop with a
  `circular-source` **diagnostic event**. Prototype- or contentNodes-terminated
  arms drop **silently**.
- **Forking, never picking.** Same-name multiplicity (multiple providers for
  one reference, or multiple zones of one placement) surfaces as **multiple
  valid states** keyed by `forkKey = pathKey`; the engine never coerces a pick.
- **Single mutation channel.** Nothing else writes the graph; ported server
  paths (DB push → WS) must land as ops through `supervisor.apply`, never as
  direct tree edits.
- **One full compile at bootstrap only.** The fork-stress incremental contract:
  after first paint, no full-graph compile on the render path.

## 6. Step-by-step migration checklist

1. **Inventory.** Grep your system for the legacy surface: `Supervisor.process`,
   `modifyNode`, `receiveNextState`, `injectContent`, `fetchContent`,
   `addContentNodes`, `fetchHandlers`, `getHandler`, `compileHandler`,
   `new Template(`, `Supervisor.rerun`, `emitToPhase`. These are the port
   points (§4.2).
2. **Audit the data.** Run every template/content fixture through
   `translateLegacy` and record the warnings (§3). Fix the non-array
   `doc.content` (***the most likely silent regression*** — see the §1 trap
   box: normalize single-object `{ content, metadata }` to
   `[{ content, metadata }]` at the send path), non-array `children`, object
   `css.style` (harmless — accepted), obsolete `placement` shapes, **and the
   full-component `content`-target seams** (see the §1 trap box: swap them to
   `target: 'children'` — the §7 `PostFix1` generator is the worked pattern)
   so the warnings channel is clean **and** the element census matches the
   pre-migration page before you move.
3. **Swap the boot.** Replace `Template` + `Supervisor.process` with the §4.1
   recipe. Keep the `#preempt-initial-data` script tag. Verify first paint in
   the DOM adapter.
4. **Port mutations.** Convert `modifyNode`/`receiveNextState` call sites into
   `state-slice` calls (§4.2). Convert placement writes into `placement-attach`
   ops. Convert content injection into payload ops.
5. **Port handlers.** Set `format: 'legacy'` on defs that need the old
   `(event, context)` order; re-map legacy lifecycle phases to the 3-phase set
   (or the `after-compile` carve-out); make sure every body mutates through
   `context.clientAPI`.
6. **Port the transport.** Point the server at `src/server.ts`'s `POST
   /api/apply` / `GET /api/state` / WS `/ws`, and translate server pushes into
   ops (W6 — no side channel).
7. **Verify.** Run the validation trio (`npm test`, `npm run typecheck`,
   `npm run demo:smoke`) plus your system's own E2E. Use the fork/path-stress
   pages to confirm your expected fork counts, and `treeFromOps`/`treeSig`
   (R4) to compare server vs client render exactly.
8. **Retire.** Remove the imported original `src/core/*` from your bundle once
   the port is green — the original worker stack has no role in Providence.

## 7. Worked examples (read these before you write code)

- `demo/hooks-scenarios.*` — the value-provider slot + hook writes; the full
  §4.1/§4.4 recipe. `demo/hooks-array-scenarios.*` — the `rows-mint`/`rows-clear`
  op family (hook-array cascade).
- `demo/legacy-shape.js` (smoke) — **the production-shaped legacy envelope**:
  array `placement`, object `css.style`, `ContentPayload[]`, the three D7 seam
  delivery shapes (`type` / `content` / `children` targets). This is the
  closest readout of what a real migrated page looks like.
- **The live-prod mock + the PostFix1 migration** (UNTRAKED — the renderer and
  the fix generator live in gitignored `live-prod/`; run them on the machine
  holding the private payloads). The real Logged-inLanding envelope
  (`Post-migration.json`) ships with **BOTH §1 traps at once**: the three
  shell seams target `content` (text-only delivery → empty slots) **and**
  `doc.content` is the single-payload OBJECT form (`payload-shape-obsolete` →
  the article is skipped). Each step of the fix, quantified by the renderer:
    - `node live-prod/render-mock.mjs Logged-inLanding` — the shipped envelope
      as-is: `Post-migration.rendered.html` = 10 states/10 elements, empty
      nav/header/footer, no article, warning `payload-shape-obsolete`.
    - `… --adapted` — the seam swap ALONE (`content → children` on the three
      root-level shell seams): `Post-migration.adapted.rendered.html` = 13
      states/37 elements — **all links render** (nav with logo, Home,
      Directory, the crafted links nested in their zones, Logout), the article
      is still gone (the object-form payload is still skipped).
    - `node live-prod/fix-post-migration.mjs` — writes **`PostFix1.json`**, the
      MIGRATED envelope with both fixes baked into the DATA (seam targets
      `content → children` + `doc.content` normalized to
      `[{ content, metadata, userData }]` — `template.root.component`, the
      defs/handlers container, is left untouched as-is). `PostFix1.rendered.html`
      = 20 states/44 elements, **ZERO warnings**, full nav (crafted links
      nested AND text/href-bearing — DEFECT #24+25 FIXED 2026-08-19) AND the
      article. This is the data-side migration for the "links don't render"
      failure, complete.
    - Browser check (live, not a snapshot): the demo server serves
      `live-view.html?name=PostFix1` — the browser fetches `PostFix1.json`
      and executes the real engine (`translateLegacy` → Supervisor →
      `DomAdapter` apply) client-side. `?name=` also renders the other
      envelopes (default `Post-migration`; `?adapted=1` applies the swap
      on the fly).
  Command reference: `node live-prod/render-mock.mjs Logged-inLanding [--adapted]`,
  `node live-prod/fix-post-migration.mjs`.
- `demo/fork-stress-data.*` / `demo/path-fork-data.*` — data-driven +
  static path-fork pages: the fork/placement multiplicity invariants (§5) in
  action.
- `docs/skills/designing-pages.md` §11 (test-use-case matrix) is a one-page
  map of engine behavior pinned by tests; §12 list the demo pages.
- `docs/framework-feature-summary.md` §3 is the behavior inventory with the
  real-world use cases and the canonical doc per feature.

## 8. Known gaps to accept on port (documented, not defects)

- `css.style` object identities are **not** provenance-tracked (F7): a
  pre-serialized string-authored style round-trips as an object on save.
- Object values bake `[object Object]` via `String()` in both adapters (no
  object emission seam); null keys are omitted on the derived seam (N3).
  **RESOLVED 2026-08-19** — object emission seam (`bakeValue`, JSON string
  encoding) + null passthrough (authored-present nulls carry as `key: null`;
  computed/missing nulls still omit) — decisions.md OTGE/NULL-PASSTHROUGH
  row, RENDER_PROCESS_NOTES §10.10.7.
- `css.*` family, `props` whole-dict, and nested-binding injection paths are
  **legacy gaps** — declared but not implemented as seams
  (`docs/specs/translate.md` §2.1 table "Not implemented (gap)" rows).
- Placeholder consumers whose provider arrives via SSR payload injection have
  no translate-time analog for unplaced payload providers (S-R4.3) — the
  placeholder stays unresolved until its provider is actually in the family.