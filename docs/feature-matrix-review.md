# Feature-Matrix Demo — Implementation Review & Hand-off

Status of the feature-matrix work (`demo/feature-matrix*.js/html`,
`demo/lib/feature-matrix-emit.js`, `scripts/build-demo.mjs` §page 3,
`scripts/demo-smoke.mjs`): **complete**, all checks green.

## What was reviewed

The feature-matrix page exercises every advertised framework surface in one
document built from the real legacy boundary:

- legacy envelope → `translateLegacy` → serialize → ship (`preempt-initial-data`)
- in-browser re-resolve from serialized anchors (`S4.2`) and full framework
  render (compile → `diffMinimal` → `DomAdapter`)
- component resolution (session pane) + `after-compile` handler population
- markdown editor → display: `**bold**` parse, in-place render, focus retention
- placements (content/comments zones attached at build)
- payload lifecycle: append (websocket comment), refresh (article in place),
  drop; sibling payloads untouched
- theme forks: N providers ⇒ N actionable arms per consumer (FRK-H2)
- loop-safety: circular-source arm dropped, siblings survive
- reverse translation + round-trip (payload groups, live state preserved)
- PAR-5 server/client render-signature parity + SSR hydrate seam

## Failures found (all now fixed) and root causes

1. **`prefix wrong: ""` (markdown)** — the display's `after-compile` handler
   read only `editor.content`; the textarea's text lives in `props.value`
   (`content` is `undefined` until first input). Fix: read
   `content ?? props.value` (feature-matrix.js `render-markdown`).

2. **`append did not attach comment-2`** — `demo/lib/render-ops.js`
   `applyOps` built a **batch-local** `els` map, so `append`/`remove` ops
   whose owner was created in an *earlier* diff silently no-op'd. Fix:
   resolve owner/child (and removals) from the adapter's persistent `wires`
   map when not in the batch. The headless smoke `El` shim also needed
   real-DOM move semantics + parent detach on `remove()` (diffMinimal
   re-appends every child in order each render; dropped payload wires must
   leave the DOM).

3. **`fork-b: expected 2 arms, got 3` + fork arms not rendered under
   `fork-demo`** — two causes:
   - parent `childOrder` referenced the base forked node id (`node-48`), but
     arms are wired `<nodeId>#<i>`; nothing appended them. Fix: the shared
     emitter remaps forked children to their arm wires (arm order).
   - runtime ids: `mintNodeId()` is a **process-global** counter, and the
     headless smoke runs every demo module in one process, so the appended
     `comment-2`/`fresh` nodes collided with seeded serialized wires. Fix:
     explicit `rt-*` wire ids for runtime-created demo nodes.

4. **`article live state not preserved`** — a **cascade** of #2: the lifecycle
   check threw at the append before refresh/drop ran, so the article was
   never refreshed and reverse translation read stale roots. Fixing #2 fixed
   this.

5. **`comments not dropped`** — shim `remove()` only set a flag instead of
   detaching from the parent (real `Element.remove()` detaches). Fixed in
   `scripts/demo-smoke.mjs`.

6. **`template.component reference lost`** — the page checked
   `translateLegacy(out).template?.component`, but `translateLegacy` returns
   a `TranslatedTree` (no `.template`). The component reference survives as a
   `target` anchor on the re-translated root. Fix: assert
   `again.root.anchors` for a `target === 'session'`. Clarified in
   `translate.md` (boundary note: `template`/`content`/`clientConfig` exist
   only on the `LegacyInitialData` INPUT; the `TranslatedTree` OUTPUT has only
   `root`/`nodes`/`content`/`metadata`/`userData`/`clientConfig`).

7. **Smoke banner regex (`/failed: 0/` vs `0 failed`)** — an early smoke
   assertion matched a banner format the runner never produces. The runner
   banner contract is now documented in `demo/lib/runner.js`:
   `${title}: ${passed} passed, ${failed} failed`; the smoke scans
   `title && /0 failed/`. Any future headless check must read that contract,
   not invent a format.

## Correctness notes

- `components.js` implements the DECIDED incremental-render contract: bootstrap
  compiles once, every later render consumes `supervisor.takePass2States()`
  (no render-side compile). `feature-matrix.js` does **not** yet — it
  recompiles `rootNode.compile(renderNodes)` per update and asserts the result
  equals the focused-pass contract (see TODOs, Tier 1).
- `emitElements` is shared by builder and browser, so PAR-5 parity compares
  identical emission; `on:*` bindings are stripped (handler wiring is
  runtime-only, SER-F1).
- Editor/display and pane handlers are runtime-installed (handler bodies are
  not JSON-serializable); the shipped doc carries no handler code.

## TODOs — organized by implicit priority / prerequisite chain

Layers are ordered so that each depends only on layers above it; nothing below a
layer blocks anything above it.

### Tier 1 — align a documented DECIDED contract with code (small, self-contained)

| TODO | Gap vs docs | Prerequisites | Where |
| --- | --- | --- | --- |
| 1. `feature-matrix.js` incremental render via `takePass2States` | DECIDED (notes §10.10.10, designing-pages §5): re-render never compiles after bootstrap; `components.js:285` implements it, `feature-matrix.js` still calls `rootNode.compile(renderNodes)` per update. | port the `components.js` `prevStates` cache+merge (setStates/statesOf) into `feature-matrix.js`, then flip `render()`; re-validate the 12 feature-matrix checks + PAR-5 parity | `demo/feature-matrix.js` `render()` (TODO comment in place) |

Unblocks: full doc↔code parity for the §5 incremental-render contract, so no
page contradicts the skill doc.

### Tier 2 — new capability (docs already written this session; one small design decision first)

| TODO | Gap vs docs | Prerequisites | Where |
| --- | --- | --- | --- |
| 2. Handler read-only access to **pass-2 resolved state** (`bindings`, fork arms, `pathKey`) | `tree.getNode(id)` exposes only pass-1 compiled values (node.md §5). Resolved values are undocumented/absent for handlers. | **design decision**: pick the surface — e.g. `tree.getState(id): CompiledState[]` backed by a non-draining supervisor getter, or a read-only `Node.resolved`. NB `takePass2States()` **drains** its map (supervisor.ts:140), so a handler getter must not consume the renderer's snapshot. | `src/core/handlers.ts` (TODO comment); `handlers.md` §2.1, `api.md` §2, `designing-pages.md` §6 |

Unblocks: handlers that read resolved component bindings without re-resolving
from anchors (the markdown handler today reads only authored `content`/`props`).

### Tier 3 — documented-but-absent module

| TODO | Gap vs docs | Prerequisites | Where |
| --- | --- | --- | --- |
| 3. Skeleton server entry (`src/server.ts` + `src/index.ts`) | `contract.md` §Server and `FRESH-CONTEXT-SUMMARY.md` §2.9 document `/health`, `POST /api/apply`, `GET /api/state?node=`, WS `/ws` — **no file exists**; `package.json` `start`/`dev` point at missing `dist/index.js`/`src/index.ts`. | none for implementation (`clientAPI.apply`/`getState` already exist); else **decision**: park it explicitly in `contract.md` like S4.3 instead of implementing | `src/server.ts`, `src/index.ts`, `package.json` |

### Tier 4 — documentation maintenance (no code)

| TODO | Gap | Prereq | Where |
| --- | --- | --- | --- |
| 4. Fold Pillar A–G back into `docs/skills/overview.md` and `rendering_architecture_spec.md` | two adjacent `(TODO: fold …)` notes (notes :581, :726) | none | `RENDER_PROCESS_NOTES.md` |
| 5. Re-assess parked S4.3 (`run*` gates) | `translate.ts` maps only `runInstantiation`/`runMonitoring`; the rest of the legacy gates are `rejected` by `clientConfig` validation (S4.3 PARKED) | un-park decision only when a legacy config surface is actually required | `RENDER_PROCESS_NOTES.md` :537, translate.md §1, SER-F6 |

## Documentation gaps filled (Section 4)

### 4.1 Fork-arm adoption — the assumption, in full (FRK-H2)

**The assumption (now documented in `feature-matrix-emit.js` header + notes):**
a forked node (N > 1 compiled states) never emits an element for its base id
`node-X`; it emits N leaves wired `node-X#0 … node-X#(N-1)`. Consequently a
*parent* whose `childOrder` references a forked node id **must** have that
reference expanded into the arm wires **in arm order**. The page's original
builder assumed the base id reference would match ("base-id childOrder fits"),
which was false: `diffMinimal` looks up `node-X` among the emitted wires, finds
none (only `node-X#0/#1` exist), and silently attaches nothing — so no arm ever
appeared under `fork-demo`. The shared emitter now does the expansion
(`armWires` flatMap), the parent adopts **all** arms as direct children, and
adopting exactly one arm (`#<i>` reference) is explicitly not supported.

| Fork-arm claim | Status |
| --- | --- |
| Base wire `node-X` is never emitted for a fork | emitter contract |
| Parent references forked children as arm wires, arm order | emitter expansion |
| Parent adopts ALL arms (no per-fork wrapper element) | documented |
| Single-arm adoption via `#<i>` reference | not supported (documented as out of scope) |

### 4.2 `mintNodeId()` uniqueness (S3.1) — verified scope

Documented in `node.md` §4.1. Verified by probe against the shipped
feature-matrix doc (seeded `node-31..node-57`):

- Fresh module instance (single-process page): mints `node-1..node-5`, **no**
  collisions with seeds — monotonic counter is clear of the seeded range.
- Shared-process smoke (all demo modules, one counter): after ~40 prior mints
  the counter re-enters the seeded range and minted ids collide with seeds
  (`node-46..node-50`). This is the documented reason runtime-created demo
  nodes use explicit `rt-*` ids.
- **Guarantee:** minted ids are unique among themselves (monotonic) and stay
  clear of loaded seeds only while the counter is below the seeded numeric
  range. Enforcing true cross-namespace uniqueness would need a full-tree scan
  or a used-ids collection; the framework does not do that. Callers in a
  multi-doc-per-process harness must pass explicit ids.

## Validation

```
npm test           # 21 files, 318 tests — pass
npm run typecheck  # clean
npm run build      # clean emit
npm run demo:smoke # SSR 9/9, Loop-safety 7/7, Feature Matrix 12/12, Summary 8/8
```

All green at time of writing (see commands above for the exact run).