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
  /** Feature 1a (2026-08-24, handoffs-review-5.md) — the def-prototype
   *  CENSUS: the registration name + instance id per registered def
   *  prototype present in THIS slice. The prototype STATE rides `content`
   *  (status quo); this section carries the ONE datum content cannot — the
   *  registration name (recovered from the registry Link's anchors at
   *  serialize; a name-less link is skipped, ruling 1). Entries ship ONLY
   *  for instances ∈ the slice set (instance-membership reachability — never
   *  another graph's prototypes). Roots precede their children; children in
   *  registry mint order. Absent = no def prototypes in the slice. */
  defPrototypes?: { name: string; nodeId: string; isRoot: boolean }[]
}
```

Every node state carries `id` + `anchors[]` (typed refs — string targets only;
`parent` refs ride child anchors; live object targets are rejected at the
schema boundary, SER-F3). Children are **derived, never stored** — the family
shape is reconstructed from anchor refs on load. Handler bodies (functions)
are runtime-only and never serialize (SER-H8). **Seam child anchors
(`role: 'child'` + `options.seam`) on PROTOTYPE-state content entries are
stripped at emit (C2)** — the seed's one-child limit would drop them anyway,
and the strip removes the dangling `parent: <consumer-id>` refs. **A
def-bearing doc ships the FULL `TranslatedTree.nodes` list (prototypes
included) — the census's builder contract: a census `nodeId` absent from the
doc is a crafted doc (rejected at the schema boundary).**

## 2. Loading (`loadState`)

`loadState(doc): NodeBaseData[]` parses + validates the envelope
(envelope-mismatch / NodeSchema-shape-mismatch / fork-key-collision /
clientConfig-excess rejections) and returns **seed data** — plain objects,
never live nodes. `reResolve` is the same function. The `defPrototypes`
section rides the same schema boundary: a non-array section → `envelope-
mismatch`; a malformed entry (name/nodeId non-string, isRoot non-boolean), a
duplicate entry nodeId, or a nodeId absent from the doc → `NodeSchema-shape-
mismatch` (duplicate NAMES are legal — a def-root and its def-children share
the registration name). `loadState` stays PURE parse+validate: it never
re-mints, never registers, never touches rows.

## 3. REQ-GAP-9 — the corrected reseed recipe (pinned 2026-08-22; Feature 1a steps 2026-08-24)

A host that loads a serialized doc into a live graph **must** do these steps,
with **ONE** `createLinkHub()` instance threaded everywhere
(`createLinkHub` is exported from `src/core/translate.js` + the `src/index.ts`
barrel; same-name component/placement anchors land on ONE shared `Link` —
DEFECT #9 semantics, `translateLegacy` uses the same factory internally):

1. **`loadState(doc)`** → `NodeBaseData[]` (parse + validate only).
2. **Construct the seeds** with the shared hub — `new Node(d, hub)` — the
   **template (root) FIRST, content after** (PROTOTYPES INCLUDED — a
   def-bearing doc's content carries the prototype states; a def-root must
   precede its def-children, which the translate-built content order
   guarantees): the constructor's seed path
   resolves child-anchor `parent` refs at construction time
   (`src/core/node.ts` seed-anchor loop), so a node's parents must already
   exist. The constructor routes placement/component ROLE anchors through the
   hub (`node.hubFor` / the constructor `hub` parameter), so same-name anchors
   across seeds share one `Link`; hub-less seeds mint per-node fresh links
   (status quo).
3. **`reconcileParentTargets(nodes)`** — child anchors are deliberately
   per-node FRESH links at seed time; this step reassigns them onto the
   shared family links (string refs → live node targets; also catches anchor
   circles → `circular-source` at compile, never a hang). **Prototypes
   included** — their fresh family links consolidate onto one family link per
   def-root (which populates `defRoot.children` for the seam + the AUTH-SEAM
   adoption).
4. **`reRegisterDefPrototypes(doc, hub, seeded)`** (Feature 1a — NEW, step
   1.5) — RE-REGISTERS the already-seeded prototype INSTANCES under
   `hub.linkFor(name, 'component')` per the doc's census (roots + children in
   census order). Zero construction — the single-instance rule is structural.
   Validates every entry's post-seed `state === 'prototype'` (a def-child
   whose def-root is absent derives 'unplaced' — sweep-vulnerable — a
   violation is a crafted/ill-ordered doc → `NodeSchema-shape-mismatch`).
   Only for a doc WITH a census; a def-less doc skips it.
5. **`supervisor.registerNode(node)` per node** — the module-level
   `registerNode` fires inside the constructor, but the **supervisor's own
   `this.nodes` map does NOT**: skipping this step renders a graph whose
   nodes compile via the module registry but never appear in
   `supervisor.getNode` / `allNodes` / pass-2. When the supervisor was
   constructed with a hub (`new Supervisor({ hub, events })`), pass it the
   SAME `createLinkHub()` instance the seeds used — the supervisor-hub and
   the node-hub are ONE hub (the `focusedSliceFor` hub-aware shortcut falls
   back to an O(n) provider sweep when a node's hub cannot answer; a forgotten
   hub makes every pass-2 slice a universe sweep). **Seam-RESOLVED carriers
   (def-root/def-children wired under a consumer) register too; plain
   prototypes stay out of `this.nodes`.**
6. **Re-mint the rows (step 4.5, rows-bearing docs only)** — ONE `rows-mint`
   op per `batches[hookName]` record (the records seed with the nodes; the
   layerId round-trips → the re-mint REPLACES in place, replay-safe, with
   FRESH minted ids — the ROWS-ARE-DATA pin). The host drives this; the def
   re-registration of step 4 is what makes the `prototypeName` resolve.
   **Keyed records (Feature 1b): the host passes the record's `keyField`
   through to the re-mint op** — a post-restore KEYED update then REUSES the
   re-minted nodes (matching by the keyField VALUE, not id — so the fresh
   round-trip ids do not break reuse identity across updates).

## 4. Caveats (what the recipe does NOT promise)

- **Link ids do not round-trip.** `serializeSlice` ships `a.link.id`
  (`src/core/serialize.ts`), but the seed path ignores the serialized id and
  mints fresh links — link IDENTITY never survives the round-trip; only the
  anchor ROLE/name sharing semantics do (and only with the hub threading of
  §3.2). Never key host state off a serialized link id.
- **`rows-prototype-unresolved` is now DOC-CARRIAGE-CONDITIONAL (the Feature
  1a caveat flip, 2026-08-24):** a doc whose `defPrototypes` census round-
  tripped + re-registered (recipe §3 step 4) re-mints rows successfully (the
  prototypes exist on the loadState hub); a graph re-seeded WITHOUT the
  section (hub-only reseed, or a pre-0.2.0 doc) keeps the throw — the
  documented behavior stands for section-absent docs. A component-bearing
  AUTHORED envelope that must keep its full authored behavior still goes
  through `translateLegacy(doc, { hub })` — the translate path owns defs,
  rows, seam wiring, and the pre-minted prototypes; the round-trip path is
  the SNAPSHOT path.
- **Defs round-trip; handler bodies stay runtime-only** (the corrected
  AUTH-SEAM formulation, handoffs-review-5.md N1): the adoption STRUCTURE
  survives the round-trip (def-children re-home, seam-flagged,
  `runtimeMinted`), but the def-root's phase-handler bodies do not (the
  `handlerDef` registry is runtime-only) — a post-restore AUTH-SEAM consumer
  renders its def children handler-less until the host re-supplies bodies
  (handlers.md §6). A doc serialized AFTER a runtime adoption seeds its
  adopted def-children 'unplaced' unless the consumer precedes them in the
  content array — hosts serialize pristine graphs, not post-adoption runtime
  states.
- **Minted-node id instability**: rows re-mint with FRESH ids — the
  `(wire, forkKey)` element identity never survives the round-trip itself.
  **Feature 1b (2026-08-24) restores identity for KEYED updates WITHIN a
  graph (incl. post-restore updates — the keyField VALUE round-trips, so a
  post-restore keyed update reuses the re-minted nodes); it does NOT make the
  minted node id survive the round-trip itself** (the re-minted set is empty
  → the host's step-4.5 keyed re-mint mints-new). Element identity across a
  keyed update = stable minted-node id → stable (wire, forkKey) (E2E-2/T30);
  render.md D5 is the DIFF op that consumes the stable childOrder, not the
  guarantee. A placement-zone re-route changes the pathKey → new forkKey →
  element re-created (the guarantee is the family-path / stable-zone case).
- **Minted rows ship ONLY when the caller includes them in the slice
  (2026-08-24 adversarial pass, S4a)**: `serializeNode` has NO origin-layer
  filter — the §3 recipe's slice (the authored `TranslatedTree.nodes` list)
  is what keeps rows-are-data true. A host that serializes a post-mint FULL
  node list (e.g. `supervisor.allNodes()`) ships the minted rows as content
  states, and a subsequent re-mint per the batches record then DOUBLES the
  rows (the replace-in-place layer is runtime-only — it never round-trips).
  Tracked: defects.md ADVERSARIAL-S4.
- **Handlers stay runtime-only**: function bodies never serialize; a host
  re-supplies bodies by name (the layer seam — see handlers.md §6).
- **Feature 3 base (2026-08-25, handoffs-review-8.md D2/D9):** the condensed
  journal base is a `SerializedRenderDoc` — it INHERITS every residual above
  (handler bodies stay post-base; minted-row/link ids are fresh on re-mint;
  the literal layer-stack structure is lost while its value effects survive
  via the merged canon). "Reproduces the full stream exactly" is scoped to
  SER-R1 render-relevant state + the post-base no-journal re-apply. A base
  marker written by an older engine fails `NodeSchema-shape-mismatch` at the
  restore's `loadState` (the existing schema boundary — contained).

## 5. Round-trip guarantees

| ID | Guarantee | Source |
| --- | --- | --- |
| SER-R1 | `serialize(compile(node))` → JSON → parse → compile yields equal render-relevant state (props/css/content/type/children order/anchor roles+targets) | render.md §5, tests/unit/render.test.ts |
| SER-R2 | Live anchor targets serialize as NodeRefs (unique ids at creation) | tests/unit/render.test.ts |
| SER-R3 | Fork states de-duplicate + serialize via node ids plus path-key traces | api.md §4 |
| SER-R4 | Dropped fork arms contribute nothing to the serialized actionable set | render.md §5 |
| SER-F3 | A serialized doc carrying a live object/proxy is rejected at the schema boundary | tests/unit/render.test.ts |
| SER-R6 (Feature 1a) | A def-bearing doc round-trips its def-prototype registry: census emit (roots first, children in mint order, slice-membership only, name-less skipped) → re-registration (seeded instances by identity, post-seed 'prototype' tripwire) → seam + rows re-materialization | tests/unit/def-roundtrip.test.ts |