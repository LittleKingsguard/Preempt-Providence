# Serialization & host reseeding (`serializeSlice` → `loadState` → `Node(seed, hub)`)

Contract spec for the new-format JSON round-trip (`src/core/serialize.ts`) and
the host-side reseed flow. Companion: `contract.md` §`src/core/serialize.ts`,
`render.md` §5 (SER-R1..R5), `designing-pages.md` §8.

## 1. The document shape

`serializeSlice(node, kids, clientConfig?)` emits the SSR/client envelope:

```ts
export type SerializedRenderDoc = {
  template: RenderNodeState          // the root node state
  content: RenderNodeState[]         // every other node in the slice
  clientConfig: { adapter: string; persistence: boolean }
}
```

Every node state carries `id` + `anchors[]` (typed refs — string targets only;
`parent` refs ride child anchors; live object targets are rejected at the
schema boundary, SER-F3). Children are **derived, never stored** — the family
shape is reconstructed from anchor refs on load. Handler bodies (functions)
are runtime-only and never serialize (SER-H8).

## 2. Loading (`loadState`)

`loadState(doc): NodeBaseData[]` parses + validates the envelope
(envelope-mismatch / NodeSchema-shape-mismatch / fork-key-collision /
clientConfig-excess rejections) and returns **seed data** — plain objects,
never live nodes. `reResolve` is the same function.

## 3. REQ-GAP-9 — the corrected 4-step reseed recipe (pinned 2026-08-22)

A host that loads a serialized doc into a live graph **must** do all four
steps, with **ONE** `createLinkHub()` instance threaded everywhere
(`createLinkHub` is exported from `src/core/translate.js` + the `src/index.ts`
barrel; same-name component/placement anchors land on ONE shared `Link` —
DEFECT #9 semantics, `translateLegacy` uses the same factory internally):

1. **`loadState(doc)`** → `NodeBaseData[]` (parse + validate only).
2. **Construct the seeds** with the shared hub — `new Node(d, hub)` — the
   **template (root) FIRST, content after**: the constructor's seed path
   resolves child-anchor `parent` refs at construction time
   (`src/core/node.ts` seed-anchor loop), so a node's parents must already
   exist. The constructor routes placement/component ROLE anchors through the
   hub (`node.hubFor` / the constructor `hub` parameter), so same-name anchors
   across seeds share one `Link`; hub-less seeds mint per-node fresh links
   (status quo).
3. **`reconcileParentTargets(nodes)`** — child anchors are deliberately
   per-node FRESH links at seed time; this step reassigns them onto the
   shared family links (string refs → live node targets; also catches anchor
   circles → `circular-source` at compile, never a hang).
4. **`supervisor.registerNode(node)` per node** — the module-level
   `registerNode` fires inside the constructor, but the **supervisor's own
   `this.nodes` map does NOT**: skipping this step renders a graph whose
   nodes compile via the module registry but never appear in
   `supervisor.getNode` / `allNodes` / pass-2. When the supervisor was
   constructed with a hub (`new Supervisor({ hub, events })`), pass it the
   SAME `createLinkHub()` instance the seeds used — the supervisor-hub and
   the node-hub are ONE hub (the `focusedSliceFor` hub-aware shortcut falls
   back to an O(n) provider sweep when a node's hub cannot answer; a forgotten
   hub makes every pass-2 slice a universe sweep).

## 4. Caveats (what the recipe does NOT promise)

- **Link ids do not round-trip.** `serializeSlice` ships `a.link.id`
  (`src/core/serialize.ts`), but the seed path ignores the serialized id and
  mints fresh links — link IDENTITY never survives the round-trip; only the
  anchor ROLE/name sharing semantics do (and only with the hub threading of
  §3.2). Never key host state off a serialized link id.
- **`loadState` is snapshot/restore ONLY — def-less/rows-less by
  construction.** The def/rows-mint machinery is translate-bound:
  `defPrototypes`/`defRootPrototypes` are keyed by the translate-time `Link`
  instances (`src/core/registry.ts`) and `rowsMint` resolves prototypes
  through `hub.linkFor(name, 'component')` — a host-reseeded graph (its own
  hub, its own Links) cannot re-mint rows from def prototypes; a
  rows-mint on a reseeded graph throws `rows-prototype-unresolved` (pinned as
  **documented behavior**). A component-bearing doc that must keep its full
  authored behavior goes through `translateLegacy(doc, { hub })` instead —
  the translate path owns defs, rows, seam wiring, and the pre-minted
  prototypes.
- **Handlers stay runtime-only**: function bodies never serialize; a host
  re-supplies bodies by name (the layer seam — see handlers.md §6).

## 5. Round-trip guarantees

| ID | Guarantee | Source |
| --- | --- | --- |
| SER-R1 | `serialize(compile(node))` → JSON → parse → compile yields equal render-relevant state (props/css/content/type/children order/anchor roles+targets) | render.md §5, tests/unit/render.test.ts |
| SER-R2 | Live anchor targets serialize as NodeRefs (unique ids at creation) | tests/unit/render.test.ts |
| SER-R3 | Fork states de-duplicate + serialize via node ids plus path-key traces | api.md §4 |
| SER-R4 | Dropped fork arms contribute nothing to the serialized actionable set | render.md §5 |
| SER-F3 | A serialized doc carrying a live object/proxy is rejected at the schema boundary | tests/unit/render.test.ts |