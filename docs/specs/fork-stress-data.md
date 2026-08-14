# Fork-Stress Data-Driven Page — spec (core-only, legacy envelope, prototype-driven assembly)

Status: spec for a REWRITE of the fork-stress demo page. Companion:
`docs/specs/fork-stress.md` (the imperative build), `docs/subagents.md`
(workflow: spec → red → green).

> **RUNTIME-variant scope note (placement-path-spec §9-Q4/§5 — read this
> first):** this spec describes the RUNTIME fork-stress-data page (the
> after-compile `clone-instance` expansion), which is KEPT as-is alongside
> the new STATIC page. The static re-expression — the SAME 22-prototype
> topology compiled by path enumeration instead of clone assembly — is the
> placement-path model: see `docs/specs/placement-path-spec.md` §5 (page
> re-expression + the §5.2 static census 23/4095/0/0) and the shipped page
> `demo/path-fork-data.*` (designing-pages.md §11/§12). With the
> translate-global contentNodes-ownership minting (P3 §10.ad/F-13), THIS
> runtime page's census asserts are re-pinned: in-tree = 2^depth − 1 +
> prototypes, unplaced = 0 (the prototypes never compile/render — the token
> terminates the walk); `cloneOps` stays the journaled clone count.

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
   (Legacy bodies CAN ship as function-source STRINGS — translate.ts
   instantiates them; this page keeps body-by-name because the body must
   reach the page-side `protoByKey` registry — see §10.10.2/translate.md
   §2. The body itself is otherwise fully self-contained: `c.node`
   identifies the clone it runs on.) The handler clones the next layer's
   prototypes (`clone-instance` op) and attaches them, so the 2^k-per-layer
   tree grows from the data alone.
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
   - Idempotency: only expand when the clone has no children yet
     (`children.length === 0` — children.length-only guard, derived-state.md
     §9.2). The body applies NO op to itself: `stress:expanded` is DERIVED
     on the prototypes (`{ $if: { cond: { $gt: [{ $: 'children.length' },
     0] }, then: true, else: false } }` — inherited by every clone, baked
     into the compiled state on every pass, never a pass-1 prop), so a node
     is never re-dirtied by its own body. A leaf (layer ≥ depth − 1) hits
     the deepest-layer return BEFORE any op/child work — leaves never touch
     an op.
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
    - **The parent sets the CHILDREN's chains at creation**: after each
      `clone-instance` op succeeds, apply the `props.stress:layers = ownChain
      + '|' + chainSegment(layer + 1)` state-slice on the FRESH COPY (from
      the op's `dirtied[0]`); the kickoff sets the L1 chains to
      `chainSegment(1)` the same way. The copy is in-tree right after attach
      and both pass-2 marks coalesce into ONE flush — the copy's body never
      sets its own chain (derived-state.md §9.2a).
5. **Render**: bootstrap `root.compile(all nodes)` once; then consume
   `takePass2States()` + `diffMinimal` + core `applyOps` (incremental
   contract). The DomAdapter is core `dist/core/adapters.js`.
6. **Checks** (same expectations as the imperative page, adapted): per-layer
   node counts (2^k), total 2^depth − 1, css property/slot pairs,
   `stress:kind`/`stress:layers`-equivalent (the clones inherit props), the
   nesting check (DOM children == graph children), and the incremental
   render contract. The `stress:layers` chain is op-set (the parent bakes it
   onto each child at creation — §9.2a — so the chain check reads pass-1
   props as before); the idempotency check reads `stress:expanded` from the
   RESOLVED state (`supervisor.getResolvedStates(id)[0].props` — the derived
   bake is NOT a pass-1 prop): non-leaves must show `true`, leaves `false`.

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

2. **HandlerContext carries the dispatched node (variant A).** Since the
   variant-A change, `dispatchPhase`/`dispatchEvent` enrich the per-dispatch
   context with `c.node` (the node the handler runs on) and `c.states` (its
   last-known resolved states). The `stress-expand` body is now fully
   SELF-CONTAINED: it reads `stress:layer` from `c.node.props`, expands
   THAT node, and the `children.length` guard makes re-fires no-op. No
   closure over the prototype's (layer, slot).

3. **Self-expansion needs no page-side queue — but never scan the graph.**
   Each clone expands itself exactly once, and its after-compile fires ONCE
   per flush: the body applies NO op to itself (no self-ops at all — the
   derived-state adoption, `docs/specs/derived-state.md` §9.2). The
   `stress:expanded` marker op is GONE — the prop is DERIVED
   (`{ $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true,
   else: false } }` declared on the prototypes, inherited by every clone),
   so nothing re-dirties a node after its children exist: handlerCalls = the
   clone count (4094 at d12, half the marker-op era's 8188). Every firing is
   O(1) — no `pendingByKey` registry, no per-call graph scan. The earlier
   design (a pending queue fed from clone-instance `dirtied` ids) was a
   workaround for the missing `c.node`; the 27.9s regression it replaced
   (scanning `supervisor.allNodes()` per after-compile call) is still the
   cautionary tale: never scan the whole graph inside a handler body.

4. **The clone inherits the prototype's LAYERS, so the handler body rides
   along automatically** — installing the body on the prototype once means
   every clone has it. `stress:layers` chains are NOT inherited (the clone
   copies the prototype's props, not the parent's chain) — the PARENT sets
   the CHILD's chain at creation (after each `clone-instance` op the
   expander applies the `props.stress:layers = ownChain + '|' +
   chainSegment(layer + 1)` state-slice on the fresh copy; the kickoff sets
   the L1 chains the same way). The copy is in-tree right after attach
   (`slot.familyLinkFor()` → root-bound chain), so the slice's in-tree guard
   passes, and both pass-2 marks (clone-instance + chain slice) land in the
   SAME flush — one compile, one after-compile fire.

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
