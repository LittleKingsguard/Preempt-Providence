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
4. **Single-method variants (§4)** — the whole tree can rely on ONE
   child-creation mechanism instead of the four-mechanism cycle label:
   placement-only (pure clone structure), values-only (every prototype
   declares its component VALUE as a legacy `component` source — translate.md
   §2), or link-only (every clone consumes a component DEF whose emission
   re-types the next layer — the recursive def chain).

## Data envelope shape (`demo/fork-stress-data.js`, a data-only module)

```js
// demo/fork-stress-data.js — pure data, no imports from demo-fixtures
export function forkStressLegacyData(depth, method) {
  const prototypes = []
  for (let layer = 1; layer <= depth - 1; layer += 1) {
    for (const slot of ['a', 'b']) {
      prototypes.push({
        type: slot === 'a' ? 'div' : 'span',
        props: {
          'stress:layer': layer,
          'stress:slot': slot,
          'stress:kind': method ?? layerKind(layer), // placement|values|link|handler (per cycle)
          'stress:handler': 'stress-expand', // data-declared handler name
        },
        css: { style: levelCss(layer, slot) }, // per-level property + slot value (see fork-stress.md)
        handlers: [{ name: 'stress-expand', phase: 'after-compile' }],
        // method 'values': component: { reference: `values-<layer>.<slot>`, value: `value-<SLOT>-<layer>` }
        // method 'link':   component: { reference: `link-<layer>`, value: <linkDefForLevel(layer)> }
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
      nodes (by their props). `c.clientAPI.apply(id, { kind:
      'clone-instance', source: protoA, slot: node, priority })` for each —
      clone-instance mints its own id, so pass the id you minted (or let the
      op mint it); the supervisor registers the copy, attaches it, and marks
      it pass-2 dirty — so the copy compiles, its after-compile fires, and
      IT expands the next layer. Recursion builds the whole tree. NOTE: the
      single-arg `apply({ kind, ... })` form is NOT supported — use
      `apply(nodeRef, mutation)` (lesson 1 below).
5. **Render**: bootstrap `root.compile(all nodes)` once; then consume
   `takePass2States()` + `diffMinimal` + core `applyOps` (incremental
   contract). The DomAdapter is core `dist/core/adapters.js`.
6. **Checks** (same expectations as the imperative page, adapted): per-layer
   node counts (2^k), total 2^depth − 1, css property/slot pairs,
   `stress:kind`/`stress:layers`-equivalent (the clones inherit props), the
   nesting check (DOM children == graph children), and the incremental
   render contract. A `stress:layers` chain can be assembled by the handler
   (the clone inherits the parent's chain + `|L<layer>:<kind>`).

## Single-method variants (replaces the per-layer mechanism cycle)

`method` (`'placement' | 'values' | 'link'`, default: the four-mechanism
cycle label) selects the ONE mechanism the whole tree relies on. The builder
(`scripts/fork-stress-data-page.mjs`) passes it through to
`forkStressLegacyData(depth, method)` and embeds it in `server-data.method`;
`demo/build-demo.mjs` emits three d12 pages:
`fork-stress-data-{placement,values,link}-d12.html`; `demo-smoke.mjs` seeds
+ imports each and asserts the `Fork Stress (data: <method>) — depth 12`
banner.

- **placement** — the tree is pure `clone-instance` structure. No component
  refs, no sources, no defs. Every node's `stress:kind` is `placement`;
  chains are `L<k>:placement`.
- **values** — every prototype carries `component: { reference:
  'values-<layer>.<slot>', value: 'value-<SLOT>-<layer>' }` (e.g. `value-A-3`).
  A value-bearing binding translates to a SOURCE anchor (translate.md §2 —
  legacy source attachment); the clone-instance op inherits the anchor WITH
  its value (Node.clone), so every clone resolves its OWN provider depth-0
  (S-R2.6) and the emitter renders the resolved value as the element text.
- **link** — every prototype carries `component: { reference:
  'link-<layer>', value: <linkDefForLevel(layer)> }` — the component DEF
  (prototype-as-child link) as the source value. Every clone is a def
  consumer whose OWN children (the next layer's clones) are re-typed by the
  def at emit time — the recursive def chain: **the emitter must emit a
  covered consumer's `defChildren` even when its standalone element is
  skipped** (emitElements in `src/core/render-helpers.ts`, covered-skip
  branch) or the whole subtree below layer 2 vanishes from the element set.

ALL sources are DECLARED IN THE DATA — the envelope carries the values and
defs (pure JSON) on the prototypes' `component.value`; the page module never
attaches an anchor and stays core-only + legacy data.

Page-side behavior per method: chain segments are `L<k>:<method>` for
single-method pages (`L1:placement`-style naming for the cycle pages);
the layer-plan column and the `stress:kind` check use the method; the
values/link pages add method-specific checks (per-node element text vs the
resolved source value / def content). The root carries NO sources, so it is
emitted like every other node — the nesting check walks from the root and
expects 2^depth − 1 elements for every variant.

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
  (`fork-stress-data-d{2,4,6,8,9,10,11,12}.html` + the three
  `fork-stress-data-{placement,values,link}-d12.html` variants): a builder
  (`scripts/fork-stress-data-page.mjs`) embeds the LEGACY envelope as
  `preempt-initial-data` + `server-data` (expectations); `demo-smoke.mjs`
  seeds + imports each depth; `demo/index.html` lists the page.
- The page's runner checks are the red/green gate (self-verifying demo).

## Lessons learned (implementation)

1. **`clientAPI.apply` is two-arg, not a single op object.** The spec's
   `apply({ kind: 'clone-instance', ... })` form is REJECTED by the current
   core — `apply` requires `(nodeRef, mutation)`. Use
   `apply(id, { kind: 'clone-instance', source, slot, priority })` (the same
   two-arg form the imperative page uses). The clone mints its own id and is
   registered + attached + marked pass-2 dirty by the supervisor.

2. **HandlerContext carries NO "current node".** An `after-compile` body
   receives `(c)` but no `this`/node argument. The body must be closed over
   its prototype and learn the clone from context: read the clone's
   `stress:layer`/`stress:slot` from `c.tree.getState(id)` or the node's own
   props. The cleanest pattern: the body is installed per-prototype
   (capturing `layer`/`slot`), and expands a PENDING registry of clones for
   that (layer, slot).

3. **`clone-instance` recursion needs a page-side pending queue, not a
   per-call graph scan.** The first implementation re-scanned
   `supervisor.allNodes()` + `isInTree` per after-compile call — depth 12
   took 27.9s. Feeding a `pendingByKey` registry from the clone-instance
   `dirtied` ids (kickoff seeds layer 1; each expansion appends the fresh
   copies to the next layer's list; re-runs pop an empty list and return
   O(1)) dropped depth 12 to 6.5s. Idempotency = pop-until-empty, not a
   per-node marker scan.

4. **The clone inherits the prototype's LAYERS, so the handler body rides
   along automatically** — installing the body on the prototype once means
   every clone has it. `stress:layers` chains are NOT inherited (the clone
   copies the prototype's props, not the parent's chain) — the handler must
   assemble the chain from `c.tree.ancestorsOf(node)` and set it on the
   clone, or the check for per-node chains fails.

5. **Legacy envelope is the serialization boundary.** `translateLegacy`
   parses the data; css must be the flat legacy shape (`{ style: string,
   classes: string[] }`), NOT nested under an extra `style` key — nesting
   stringifies the object into `cssText` and the css checks fail. Props
   carry the markers (`stress:layer` etc.).

6. **Self-verifying demo = the checks are the red/green gate.** There is no
   external red state; the page module either produces the expected banners
   or not. Keep the banner EXACTLY as the smoke asserts (`Fork Stress
   (data) — depth N: 8 passed, 0 failed`) and merge checks to that count.

7. **Shared data-derivation helpers stay shared + demo-only.** `levelCss` /
   `cssPropForLevel` are reused verbatim from the imperative page — they are
   pure (layer, slot) → css functions, not graph construction, so importing
   them from the fixture module is not a "helper function" violation. They
   remain demo-only (design skill §14.3).

## Docs to update

`docs/specs/fork-stress.md` (add a "data-driven variant" section),
`docs/skills/designing-pages.md` §11/§12 (new page row/entry),
`demo/index.html`, `RENDER_PROCESS_NOTES.md` (DECIDED entry), the
session-defect-review "Where the rules live now".
