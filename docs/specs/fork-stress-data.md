# Fork-Stress Data-Driven Page — spec (core-only, legacy envelope, prototype-driven assembly)

Status: spec for a REWRITE of the fork-stress demo page. Companion:
`docs/specs/fork-stress.md` (the imperative build), `docs/subagents.md`
(workflow: spec → red → green).

## Purpose

Prove the same deep binary stress tree can be assembled with:

1. **NO outside helper functions** — the page module imports ONLY
   `dist/core/*` (translateLegacy, Supervisor, createClient, EventBridge,
   Node, DomAdapter, emitElements, diffMinimal, applyOps, loadState? NO —
   legacy only). No `demo-fixtures.js` (`makeRoot`/`makeNode`/`childOf`/
   `addComponentSource`/`targetAnchor`), no fixture helpers.
2. **Legacy data format** — the page input is a `LegacyInitialData`
   envelope (`{ template: { root }, content: [...], clientConfig }`),
   translated by `translateLegacy`. NOT `serializeSlice` output.
3. **Two prototypes per layer, everything else dynamically assembled** —
   the envelope's `content` payload carries exactly TWO prototype nodes per
   layer (one per sibling slot). Each prototype declares an `after-compile`
   handler by NAME in the data (`handlers: [{ name: 'stress-expand',
   phase: 'after-compile' }]`); the page supplies the BODY for that name.
   The handler clones the next layer's prototypes (`clone-instance` op) and
   attaches them, so the 2^k-per-layer tree grows from the data alone.

## Data envelope shape (`demo/fork-stress-data.js`, a data-only module)

```js
// demo/fork-stress-data.js — pure data, no imports from demo-fixtures
export function forkStressLegacyData(depth) {
  const prototypes = []
  for (let layer = 1; layer <= depth - 1; layer += 1) {
    for (const slot of ['a', 'b']) {
      prototypes.push({
        type: slot === 'a' ? 'div' : 'span',
        props: {
          'stress:layer': layer,
          'stress:slot': slot,
          'stress:kind': layerKind(layer),   // placement|values|link|handler (per cycle)
          'stress:handler': 'stress-expand', // data-declared handler name
        },
        css: { style: levelCss(layer, slot) }, // per-level property + slot value (see fork-stress.md)
        handlers: [{ name: 'stress-expand', phase: 'after-compile' }],
      })
    }
  }
  return {
    template: { root: { type: 'app', props: { id: 'stress-root' } } },
    content: [{ metadata: { title: 'fork-stress prototypes' }, content: prototypes }],
    clientConfig: { runInstantiation: false, runMonitoring: true },
  }
}
```

- `layerKind(layer)` and `levelCss(layer, slot)` are the SAME helpers as the
  imperative page (`demo/fork-stress-fixture.js` exports) — they are
  data-derivation helpers (pure functions of (layer, slot)), NOT graph
  construction helpers. Keeping them shared is fine; they stay demo-only.
- The ROOT is the only in-tree node in the data. The prototypes are content
  payload items (unplaced). The tree assembles at runtime.

## Page module (`demo/fork-stress-data.js`) — core-only

1. Read `preempt-initial-data` (the LEGACY envelope, JSON) and
   `server-data` (the same checks' expectations).
2. `translateLegacy(envelope)` → `{ root, nodes, content }`. `content` are
   the prototype nodes (unplaced content roots).
3. `Supervisor` + `createClient`; register the translated nodes.
4. **Install the handler body for the data-declared name `stress-expand`**:
   - A registry `const HANDLER_BODIES = { 'stress-expand': body }`.
   - For every prototype node, attach the body to its `after-compile`
     handler (the data declared the name+phase; the page supplies the body):
     `proto.handlers = proto.handlers.map(h => ({ ...h, body: HANDLER_BODIES[h.name] }))`.
   - The `body` (runs on the CLONE, after-compile): given `c` (HandlerContext)
     and the cloned node `n = c.tree.getNode(<this>?)` — the handler runs on
     a node; the body receives `c` and can read the node via the layer's
     captured prototype reference or via `c`'s event/phase arg. Simplest:
     the handler is installed on the PROTOTYPE layer; the CLONE inherits the
     layer with the body. The body needs the clone's layer+slot: read from
     `c.tree.getState(nodeId)` or from the node's own `props` (the clone
     inherits `props['stress:layer']`, `['stress:slot']`).
   - Idempotency: only expand when the clone has no children yet (the
     marker `stress:expanded` prop, or `children.length === 0`).
   - Expansion: `const protoA = prototypeFor(layer+1, 'a')`, `protoB =
     prototypeFor(layer+1, 'b')` — looked up from the registered prototype
     nodes (by their props). `c.clientAPI.apply(newId?, { kind:
     'clone-instance', source: protoA, slot: node })` for each — but
     clone-instance mints its own id; the handler can call
     `c.clientAPI.apply({ kind: 'clone-instance', source: protoA, slot: n })`
     (node form) or with a pre-minted id. The supervisor registers the copy,
     attaches it, and marks it pass-2 dirty — so the copy compiles, its
     after-compile fires, and IT expands the next layer. Recursion builds
     the whole tree.
5. **Render**: bootstrap `root.compile(all nodes)` once; then consume
   `takePass2States()` + `diffMinimal` + core `applyOps` (incremental
   contract). The DomAdapter is core `dist/core/adapters.js`.
6. **Checks** (same expectations as the imperative page, adapted): per-layer
   node counts (2^k), total 2^depth − 1, css property/slot pairs,
   `stress:kind`/`stress:layers`-equivalent (the clones inherit props), the
   nesting check (DOM children == graph children), and the incremental
   render contract. A `stress:layers` chain can be assembled by the handler
   (the clone inherits the parent's chain + `|L<layer>:<kind>`).

## Constraints

- The page module imports ONLY `dist/core/*` + `demo/fork-stress-data.js`
  (data) + the shared `levelCss`/`layerKind` helpers (data-derivation). NO
  `demo-fixtures.js`.
- The envelope is LEGACY format (translateLegacy input), not the serialized
  anchor doc.
- The handler body is NOT in the data (functions don't JSON-serialize) —
  the data declares name+phase; the page maps name → body. That is the
  "handlers fed in through data" contract (declaration in data, body by
  name).
- Build + smoke wiring mirror the existing fork-stress pages
  (`fork-stress-data-d{2,4,6,8,9,10,11,12}.html`): a builder
  (`scripts/fork-stress-data-page.mjs`) embeds the LEGACY envelope as
  `preempt-initial-data` + `server-data` (expectations); `demo-smoke.mjs`
  seeds + imports each depth; `demo/index.html` lists the page.
- The page's runner checks are the red/green gate (self-verifying demo).

## Docs to update

`docs/specs/fork-stress.md` (add a "data-driven variant" section),
`docs/skills/designing-pages.md` §11/§12 (new page row/entry),
`demo/index.html`, `RENDER_PROCESS_NOTES.md` (DECIDED entry), the
session-defect-review "Where the rules live now".
