# Feature 1a — Def-prototype round-trip (three-agent gate, steps 1-3)

Date: 2026-08-24. Source: `docs/next-feature-batch-0.2.0.md` §Feature 1a +
§User rulings 1-3 (2026-08-24), the un-park row (2026-08-21). Steps 2
(critique) and 3 (change-analysis) append their sections below the present
section; the step-3 verdict lands here in the compile-horizon-review format.
Companion context: `docs/specs/serialize.md` (§1, §3, §4),
`docs/specs/handoffs-review-2.md` §REQ-GAP-9 (the 4-step reseed recipe),
`docs/next-feature-batch-0.2.0.md` §Feature 1 (the rows-mint demo gate that
un-parked this feature).

## Step 1 — Validity agent

Verdict: **FEASIBLE-WITH-RESHAPE** — the section shape, the name-keyed
re-registration, the round-trip scope (ruling 2), and the caveat flip
(ruling 3) are all verified implementable against the current code, but
four scoped reshapes must land with it (R1-R4 below): the section's `node`
entries must carry the FULL serialized node state (not the minimal
`NodeBaseData` interface), a single-instance rule must coordinate the
section entries with the `content` array (prototype nodes ALREADY ride
`content` today), a reachability filter must scope ruling 2's "the graph
holds registered def prototypes" (the registry is process-wide), and the
`loadState`/recipe contract must carry the hub for the re-mint step.

### What the proposal asks

A `defPrototypes` section (`{ name, node, isRoot }[]`) on
`SerializedRenderDoc`; each def prototype serializes under the registration
name (the component Link name; name-less prototypes skipped); the section
ships only when the graph holds registered def prototypes at serialize time;
`loadState` re-mints + re-registers the prototypes on the loadState hub's
component Links (the same link-name space the seeds use), so
`defRootPrototypeFor` resolves and the seam + rows-mint machinery work on
round-tripped docs; serialize.md §4's `rows-prototype-unresolved` caveat
becomes doc-carriage-conditional.

### Feasibility verdict (code trace)

**Registration mechanics (verified).** `mintDefPrototypes` mints the def
prototypes at every translate site (root: `src/core/translate.ts:1099`;
per-node: `translate.ts:1021`) and registers them under
`hub.linkFor(plan.reference, 'component')` — the registration NAME is
`plan.reference` (`translate.ts:811`): the def-root via
`registerDefRootPrototype(link, defRoot)` (`translate.ts:825`), the
def-children via `registerDefPrototypes(link, minted)` in mint order
(`translate.ts:838`). The registry is module-level and therefore reachable
at serialize time: `defPrototypes = new Map<Link, Node[]>` +
`defRootPrototypes = new Map<Link, Node>` (`src/core/registry.ts:122, 138`).
(Citation note: the proposal cites "registry.ts:78-102" — that is the
cascade-flag block; the def maps are at `registry.ts:117-146`.)

**NodeBaseData recovery (verified, with a shape requirement — R1).** Each
registered prototype Node's `base` is a frozen `Readonly<NodeBaseData>`
(`node.ts:358, 417`), but the minimal `NodeBaseData` interface
(`src/core/types.ts:304` — id/type/content/props/css/handlers/derived/
hooks/hooksKind) does NOT carry children, anchors, or the family edges.
The re-mint needs the full serialized node state (the `serializeNode`/
`RenderNodeState`/`SeededNode` shape — which `loadState`'s own "NodeBaseData[]"
return already is, via the cast at `serialize.ts:343`): the def-root's
family children (the def-children prototypes), its `'component'`-token child
anchor (`translate.ts:201-205`; state derives to 'prototype' — `node.ts:525`),
its component source/duplex anchors (auth-seam `handlerEvent` options,
`applyPlans` `translate.ts:742-757`), the seam consumers' target anchors
(`options.seam`), and the def-children's container/content anchors (the
seam copy step `node.ts:1710-1714`). The existing `serializeNode`
(`serialize.ts:85-145`) already encodes all of it (children refs + anchor
`parent` refs + link ids + options), and the Node constructor seed path
(`node.ts:414, 440-480`) already re-materializes it — so the section's
`node` entries must be `serializeNode` output, not the minimal base.

**Re-mint + re-registration (verified, hub carrier missing — R4).** The
re-mint is the existing constructor seed path: `new Node(entry.node, hub)`
re-materializes the token child anchor (parent `'component'` stays a string
— `node.ts:452-461`), the component/placement role anchors via
`hub.linkFor(target, kind)` (`node.ts:470-472`), and the family edges via
child-anchor `parent` refs resolved by `resolveNodeRef` (`node.ts:455-458`).
The re-registration is the existing registrars:
`registerDefRootPrototype(hub.linkFor(name,'component'), root)` +
`registerDefPrototypes(hub.linkFor(name,'component'), children)`. The
family edges between the re-minted def-root and its def-children zip via
`reconcileParentTargets` over the re-minted set (`node.ts:1890-1923` —
creates the parent-side family anchor at `node.ts:1911`). The
def-root↔children distinction is two SEPARATE maps (root: `Map<Link, Node>`
single; children: `Map<Link, Node[]>` ordered) — `isRoot` discriminates
which registrar + which map; the def-children array ORDER is preserved
(emit zip `render-helpers.ts:851` + rowsMint's `protos[0]` shape read
`ops.ts:223`).

**`defRootPrototypeFor` + rowsMint resolve after re-registration (verified).**
Seam machinery: `defRootPrototypeFor(link)`/`defPrototypesFor(link)` reads
at `node.ts:1668-1669` (materializeSeam), `render-helpers.ts:884, 896, 915-916`
(nested seam emission) + `render-helpers.ts:1059-1060` (top-level seam fill)
are all per-Link registry reads — they resolve as soon as the re-registration
lands on the loadState hub's links. `rowsMint` resolves
`hub.linkFor(op.prototypeName, 'component')` → `defPrototypesFor(protoLink)`
and throws `rows-prototype-unresolved` on empty (`ops.ts:217-222`) — the
re-registration makes it non-empty. Note `rowsMint` never reads the
def-root — only the def-children (`ops.ts:223-224`).

**Caveat flip (verified).** Mechanically the flip holds: section present →
re-registered → `rowsMint` resolves (no throw); section absent (hub-only
reseed, or a pre-0.2.0 doc) → registry empty on the loadState hub's links →
the throw stays. The existing pin `BH-N.4`
(`tests/unit/blind-test-validation.test.ts:523-550`) uses a doc with NO
section and survives unchanged; the batch-record round-trip pin
(`tests/unit/hooks-array.test.ts:422-450`) survives and gains the re-mint
arm. `hooks-array.test.ts:423-425` is also the precedent for the
re-registration shape (manual `registerDefPrototypes(hub.linkFor('item',
'component'), [proto])`).

**Name recovery (verified, no existing API — G2).** `Link.id` is a minted
id (`link.ts:47`); `Link.config.name` is the KIND (`'component'`), not the
reference name; the hub is a closure over a name→Link map with no reverse
accessor (`translate.ts:185-198`). The registration name IS recoverable
from the registry Link's anchors: every per-name component Link carries
anchors whose string `target` is the reference name (provider source/duplex
anchors `translate.ts:751-752`, consumer target anchors, and the seed path's
re-materialization `node.ts:474`). Ruling 1's "name-less prototype is
skipped" is exactly the link-with-no-anchors case (the manual test
registration at `hooks-array.test.ts:425` registers on a link with no
anchors yet — such a registration would be skipped; translate-minted defs
always carry the provider's source anchor).

### Required reshapes (must land with the feature)

- **R1 — `node` entries carry the full serialized node state.** The
  section's `node` must be `serializeNode(prototype)` output (the
  `RenderNodeState`/`SeededNode` shape — children + anchors + parent refs +
  options), NOT the minimal `types.ts:304` `NodeBaseData`. The minimal base
  loses the family edges, the token child anchor, the seam/anchor options,
  and the def-children's container/content anchors — the seam
  children-target wiring (`node.ts:1688-1693`), the container/content copy
  (`node.ts:1710-1714`), the auth-seam re-derivation (`node.ts:1687-1704`),
  the nested seam consumers (`render-helpers.ts:867-907`), and the emit-time
  `proto.children` zip (`render-helpers.ts:851`) would all silently degrade.
  (The codebase already uses "NodeBaseData" loosely for this extended shape
  — `serialize.ts:343` — so this is a terminology pin, not new machinery.)
- **R2 — single-instance rule for prototype nodes.** The def prototypes
  ALREADY ride `doc.content` today: `translateNodeData` pushes every minted
  node into `TranslatedTree.nodes` (`translate.ts:926`), and the shipped
  builders serialize the full list (`scripts/fork-stress-page.mjs:21`,
  `scripts/build-demo.mjs:58/82`). A `loadState`-side re-mint that
  constructs NEW instances from the section would leave TWO nodes per
  prototype id in the reseeded graph (registered/byId/emit-index collisions
  — the shared-id guard family, `registry.ts:262`, `supervisor.ts:148`).
  The loadState side must either drop the section's ids from the content
  seeds, or exclude prototype-state nodes from `content` when the section
  ships, or re-register the already-seeded instances by id-match instead of
  re-minting. A rule is required; the proposal does not state one.
- **R3 — serialize-time reachability filter (ruling 2's "the graph holds").**
  `defPrototypes`/`defRootPrototypes` are process-wide with no graph
  ownership. serializeSlice must collect the slice's nodes' LIVE anchor
  Links and ship only the registry entries whose Link is among them —
  otherwise a plain doc serialized in a process that translated another
  graph ships that graph's prototypes (the smoke's isolated subprocesses —
  `scripts/smoke-page-worker.mjs` — mask this for the demo pages only).
- **R4 — hub carrier for the re-mint/registration.** `loadState(doc)` is
  pinned parse+validate ONLY with no hub (`serialize.ts:271-344`; serialize.md
  §3 "snapshot/restore ONLY"). The proposal's "loadState re-mints on the
  LOADSTATE hub" requires either an optional hub parameter or a
  recipe-companion registration entry point; either way the §3 recipe gains
  a step, and the registration must land BEFORE the reseeded graph's first
  compile (materializeSeam runs at compile — `node.ts:1219, 1313` — and
  rows-mint resolves at op apply — `ops.ts:217-218`).

### Gaps (things that do not exist yet)

- **G1 — no registry enumerator.** The def maps are module-private with
  per-Link accessors only (`registry.ts:124-146`); serialize needs a new
  export (e.g. `defPrototypeEntries()` returning `[link, Node[]]` and
  `[link, Node]` pairs) + the R3 filter.
- **G2 — no Link→name recovery API** (see above; anchor-target read or a
  hub-side name accessor must be added).
- **G3 — no section schema validation.** `parseNodeState`
  (`serialize.ts:181-260`) covers the entries; the section container, the
  `name`/`isRoot` shape, and the id-dedup-vs-content rule are new boundary
  checks.
- **G4 — no loadState hub threading / registration step** (R4).
- **G5 — handler bodies stay runtime-only** (existing caveat, serialize.md
  §4): the auth-seam structure re-derives from the def-root's serialized
  anchors, but phase-handler BODIES must be re-supplied by the host per the
  existing handlers.md §6 contract. Unchanged by this feature; worth an
  explicit note in the §4 rewrite.

### Edge cases

- **Name collisions:** none new — re-registration is per-name on ONE hub
  (Map.set overwrites per Link); a section name with no matching graph
  reference is a harmless registry entry on an unreferenced link.
- **Prototype staleness after re-translate:** the def maps are NEVER
  evicted (evictDestroyedNode clears registered/content/minted only —
  `registry.ts:259-268`). Same-hub re-translate overwrites per Link; a fresh
  hub leaves old-link entries resident (pre-existing memory growth, not
  introduced here). R3 keeps the DOC correct regardless.
- **isRoot discrimination:** two separate maps (root single,
  `registry.ts:138`; children ordered array, `registry.ts:122`); rowsMint
  reads children only, the seam reads both (`node.ts:1668-1669`).
- **Def-root-only names** (css-bearing def whose children are skipped by B2
  scoping — `translate.ts:800-810`): the section ships the root with no
  children entries; seam targets still work; rows-mint on that name still
  throws `rows-prototype-unresolved` (correct — children never existed).
- **Out-of-slice defs:** a slice whose consumers reference a def whose
  provider is outside the slice — R3 excludes it; the loadState registry
  stays empty for that name; the seam silently degrades and rows-mint
  throws (same behavior as today for partial slices).
- **4-step recipe interactions:** construction order (template first; per
  name the def-root BEFORE its def-children — the `resolveNodeRef` parent
  lookup `node.ts:455-458`); `reconcileParentTargets` must run over the
  re-minted prototypes (they must be in the nodes list); the re-minted
  prototypes must ride step 4 (`supervisor.registerNode`) so the emit
  index and pass-2 cover them.

### Existing pins that constrain the TDD

- `BH-N.4` (`blind-test-validation.test.ts:523-550`) — stays green as the
  section-absent branch of the flip.
- `hooks-array.test.ts:422-450` (batch record round-trip) — gains the
  "rows survive serialize → loadState → re-mint" arm (the Feature 1 gate).
- serialize.md §3 (the 4-step recipe) + §4 (the `rows-prototype-unresolved`
  caveat) — both update: the recipe gains the registration step (R4), the
  caveat becomes doc-carriage-conditional (ruling 3).

## Step 2 — Critique agent

Verdict: **NEEDS-RESHAPE** — the step-1 R1-R4 reshapes are verified and
retained, but the critique adds six further reshapes the proposal must absorb:
**C1** the R2 single-instance rule must be decided at the SERIALIZE side
(prototype nodes excluded from `content` when the section ships — the
re-mint is then the ONE instance and no loadState-side dedup exists), **C2**
the section's `node` data must STRIP seam child/parent anchors (the seed
path's one-child-anchor limit at `node.ts:447-451` makes their carriage
either useless or dangling-string-dangerous — the seam re-materializes from
the registry at the consumer's compile), **C3** the re-mint order must pin
def-root entries before def-children entries per name (the `resolveNodeRef`
parent lookup `node.ts:455-458` — an unresolved parent leaves the def child
'unplaced', not 'prototype', and 'unplaced' nodes are NOT sweep-exempt,
`registry.ts:215`), **C4** "loadState re-mints" must be re-expressed as a
host-driven re-mint step with the host hub (loadState itself CANNOT call
rowsMint — no op machinery; and a hub-less loadState-side re-mint registers
under fresh Links that `rowsMint`'s `hub.linkFor` can never hit — a silent
footgun), **C5** the section needs schema-boundary validation with the
existing error codes (G3 — a malformed section entry must throw
`NodeSchema-shape-mismatch`, never be ignored), **C6** the rows re-mint
operational call surface must be pinned in serialize.md §3 (post-loadState
host rows-mint per persisted batch record — §Point 7 below). R1 (full
serialized node state) and R3 (reachability filter) are correct as stated;
R4's "either optional hub parameter or recipe-companion entry point" must
choose the RECIPE-COMPANION shape (loadState stays pure — C4).

### 1. Externalities — the serialize contract

- **The schema boundary is additive-safe in both directions (verified).**
  `loadState` validates ONLY `template`/`content`/`clientConfig`
  (`serialize.ts:271-276`); there is no doc-level key whitelist, so a
  0.1.5-era `loadState` reading a 0.2.0 doc silently IGNORES `defPrototypes`
  (no `envelope-mismatch` — the rejection fires only on a missing/malformed
  REQUIRED key). The 0.1.5 consumer then gets a def-less reseed and a
  rows-mint throws `rows-prototype-unresolved` (the fail-with-warning
  containment, `ops.ts:219-222`) — which is exactly the doc-carriage
  conditional (ruling 3) expressed on an old engine. Backward direction
  (0.1.5 doc → 0.2.0 loadState): no section → no re-mint → status quo. The
  one NEW boundary surface is the section's OWN validation: `parseNodeState`
  (`serialize.ts:181-260`) already covers the `node` entries, but the
  container shape, `name` (non-empty string), `isRoot` (boolean), and the
  C1/C3 rules are new checks — they must throw the EXISTING codes
  (`NodeSchema-shape-mismatch`; `envelope-mismatch` for a non-array section)
  per the SER-R1 discipline (C5).
- **clientConfig-excess / fork-key-collision are untouched.** The section
  carries no forkKeys (prototypes never fork); `clientConfig` shape is
  unchanged. No existing rejection path is affected.
- **SER-R1 stability of the re-serialized doc:** the re-minted prototypes
  keep their ids (`data.id` seeds the constructor, `node.ts:416`), the
  registry census is state-independent (the maps, not node state), and a
  seam-wired def-root that re-resolves in-tree re-serializes identically
  (the section census = the maps). Round-trip-stable.

### 2. Paradigm — the REQ-GAP-9 caveat amendment

- The amendment does NOT contradict the user ruling — it IS the ruling.
  Ruling 2 (2026-08-21, handoffs-review-2 §5) parked the def-prototype
  round-trip with an explicit revisit condition ("a consumer that needs
  rows-mint/seam post-snapshot-restore"); the 2026-08-24 rulings 1-3
  (next-feature-batch-0.2.0 §User rulings + §Feature 1a.2/1a.3) un-park it
  with the section shape, scope, and caveat flip decided. The REQ-GAP-9
  sentence that survives is the AUTHORED-envelope half: component-bearing
  *authored* docs still go through `translateLegacy(doc, { hub })`; the
  section only extends the SNAPSHOT path.
- **What remains loadState-unexpressible after this feature** (the §4
  rewrite must state the residual list):
  1. **Handler def BODIES** — `registerHandlerDef` (registry.ts:28-36) is
     runtime-only (SER-H8). A reseeded graph's `handlers.<event>` seam
     resolves no def: `rebuildHandlerSeamLayer` finds `handlerDef(...)`
     undefined and produces an empty layer (`node.ts:1745-1770`) — the
     consumer renders handler-less. The AUTH-SEAM phase path degrades
     further: `adoptDefChildren`'s `phaseBound` check reads the def-root's
     serialized `handlerPhase` ANCHORS (which DO round-trip), so it adopts
     children with NO phase handlers and — because the re-minted def-root's
     family chain is only one child anchor deep — `defRoot.children` is
     empty (`node.ts:1826`) and even the adoption is vacuous. G5 noted the
     bodies; the critique adds that the ADOPTION STRUCTURE also does not
     survive. These are pre-existing runtime-only-by-letter gaps, unchanged
     in kind, but §4 must say "defs round-trip; handler bodies stay
     runtime-only" explicitly.
  2. **Layer stacks** — `slice-*`/hook layers never serialize (runtime-only
     letter); the compiled state ships, layer STRUCTURE (undo/teardown
     semantics) does not. Unchanged by this feature.
  3. **Minted row NODES** — rows are data; the minted nodes re-mint with
     FRESH ids (rowsMint passes no id, `ops.ts:244`). The (wire, forkKey)
     identity does NOT survive a round-trip; only the batch record does.
     Post-restore ops referencing pre-restore minted ids → `unknown-node`.
     Feature 1b's keyField reuse is the sanctioned follow-on; the §3/§4
     text should state the minted-id instability outright.
  4. **Link identity** — never round-trips (existing §4 caveat). The
     re-registration keys on the HOST hub's fresh links — which is the
     whole point (the registry must key on the same links rowsMint/seam
     resolve through).

### 3. The 4-step reseed recipe

- **loadState's return must stay `NodeBaseData[]`** (serialize.md §2;
  `reResolve` is the alias, `serialize.ts:346`). The re-mint CANNOT be
  inside loadState without a hub (C4): a hub-less re-mint registers under
  fresh per-node Links, and `rowsMint` resolves via
  `target.hubFor ?? ctx.hub` → `hub.linkFor(name,'component')` (`ops.ts:214-218`)
  — a DIFFERENT Link object → `defPrototypesFor` returns [] → the throw,
  silently defeating the feature. An optional-hub loadState is possible but
  makes the currently-pure parse function side-effecting in one of its two
  modes — worse than a recipe step. **Recommended shape:** a recipe
  step-1.5 "re-mint defs" (exported helper, e.g.
  `reMintDefPrototypes(doc, hub)` returning the minted `Node[]`), executed
  with the SAME hub as steps 2-4 (the ONE-hub rule stays — the host's
  `createLinkHub()` is threaded to the helper, the seeds, and the
  supervisor). The returned array joins the nodes list for step 3
  (`reconcileParentTargets` MUST cover the re-minted set — the def
  children's per-node fresh family links consolidate onto ONE family link
  per def-root only there, `node.ts:1905-1919`) and step 4 (the supervisor's
  `this.nodes` must cover the def-roots whose seam resolution makes them
  in-tree carriers — DEFECT #24 — or the emit index misses them; prototypes
  proper never appear in `supervisor.getNode`/`allNodes` today, and the
  recipe should pin that they stay out EXCEPT seam-resolved carriers).
- **Ordering:** within the re-mint, all `isRoot: true` entries must process
  before their `isRoot: false` siblings (C3) — the def child's seed-time
  parent resolution (`node.ts:455-458`) needs the def-root live; an
  unresolved string parent leaves the child 'unplaced' (`node.ts:536`), a
  state the sweep is NOT exempt from (`registry.ts:215,302,314` exempt only
  in-tree/prototype). The def-root must also precede its def children in the
  serialized section (the re-mint order pins this, so the EMIT order must
  emit roots before children per name).
- **The seed path's one-child-anchor limit (node.ts:447-451) is a feature
  for this use.** The re-minted prototype comes out with exactly ONE child
  anchor. For the def-root, serialized anchor order (role-sorted, stable
  target-equal) preserves translate insertion order, where the 'component'
  token edge is first — so the seeded def-root is token-terminated →
  'prototype' ✓, and the seam re-wires at the consumer's materializeSeam
  (compile-time, `node.ts:1219,1313`). The def children seed their ONE
  family anchor (parent = def-root id) ✓. The def-root's `children` field is
  ignored at seed (anchors drive family reconstruction) — no conflict.

### 4. Robustness

- **Name collisions:** the K8 duplicate guard is per-NODE
  (`translate.ts:643-647`); two providers on different nodes sharing a
  `reference` both mint, and the registry is per-Link last-writer-wins
  (`Map.set`, `registry.ts:124-146`) — so the LIVE registry can never hold
  two defs per name, and the section (emitted from the registry) can't carry
  a duplicate name from a translate-built graph. Defensive: the re-mint
  should keep-first per name (a crafted section is possible; G3's boundary
  check can reject duplicate names outright — recommend reject).
- **Prototype staleness — base vs live:** `serializeNode` ships the
  compiled pass-1 state (`node.props/css/content` getters, `node.ts:586-606`),
  not `base`. For a pristine prototype live == base; layer additions
  (seam-handlers on a def-root, `node.ts:1687/1701`) don't serialize
  (runtime-only) and REBUILD at the consumer's materializeSeam — but the
  rebuild reads `handlerDef` (see §2.1). So: ship `serializeNode(proto)`
  (R1), accept that handler-bearing defs degrade by the existing runtime-only
  letter. The derived-rule strip (`serialize.ts:92-94`) applies cleanly.
- **Child links recoverable from base data alone?** The FAMILY child links
  are recoverable (serialized anchors carry `parent` refs; C3 ordering +
  step-3 reconcile rebuild the def-root↔def-children chain). The SEAM child
  links are NOT needed and should NOT be shipped (C2): a seam-wired
  def-root's serialized seam child anchor carries `parent: <consumer-id>`;
  re-minted before the consumers exist, it stays a dangling string
  (`resolveNodeRef` miss, `node.ts:455-458`) — harmless while the token
  edge is the seeded anchor, but if the token edge were ever NOT first in
  the serialized order (any future anchor-order change), the seeded anchor
  would be the seam link and the def-root would derive 'unplaced'
  (`node.ts:520-537`) — a sweep-vulnerable state. Strip seam child/parent
  anchors from the section's node data at EMIT; the seam re-materializes
  deterministically from the registry (the same pass that built them today).
- **`isRoot` discrimination:** correct as proposed — two separate maps
  (single root vs ordered array, `registry.ts:122,138`), and a node CAN be a
  def-root for one name and a def-child of another (nested defs mint their
  own roots at their own translate sites, `translate.ts:1021`), so the flag
  must be per-ENTRY, never per-node-global. rowsMint reads children only
  (`ops.ts:223`); the seam reads both (`node.ts:1668-1669`). Verified
  consistent with the proposal.
- **Destroyed/swept prototypes:** prototype-state nodes are exempt from
  finalization (`registry.ts:215,302,314`); seam-resolved def-roots become
  in-tree (also exempt). The maps are never evicted (`evictDestroyedNode`
  clears registered/content/minted only, `registry.ts:259-268`). So
  "registry non-empty at serialize time" is a STABLE census — exactly the
  right scope for ruling 2 (plus R3's reachability filter for process-wide
  leakage). One residual: repeated loadState of the same doc re-mints fresh
  instances whose OLD instances linger in `registered` (the existing
  byId-instance-guard pattern, `registry.ts:262-265`) — a host-behavior
  note (loadState once per graph), not a new defect.

### 5. Safety

- The re-mint runs ONLY the constructor (compileLocal + ensureAutoIds +
  registerNode) + the registrars — NO seam/materialize machinery
  (materializeSeam is compile-driven on the CONSUMERS, `node.ts:1219,1313`).
  Safe.
- **Id collisions:** a crafted doc can place a section id in `content` or
  duplicate ids across section entries → silent `byId` overwrite
  (last-wins). The C1 serialize-side exclusion makes translate-built docs
  collision-free by construction; G3 must add the loadState-side check
  (section id ∩ content ids → `NodeSchema-shape-mismatch`; duplicate
  section ids → same). Re-minted prototypes can NEVER collide with seed
  nodes built by the host (fresh `mintNodeId()` only when `data.id` is
  absent — `node.ts:416`; the section always carries ids).
- The re-minted def-root's component/placement anchors route through the
  host hub (`node.ts:470-472`) — same Link objects the registry keys on.
  The `component-source-duplicate` guard still fires on duplicate same-name
  source seeds (`node.ts:474` + link-hub.test.ts:107-122) — no double
  anchor on the shared link.

### 6. Performance

- Section size = O(total registered def prototypes) × full RenderNodeState.
  A seam-targeted d12-scale def (4095 children) costs ~1-2 MB of doc and
  ~4096 constructor calls at re-mint (each compileLocal — the same cost
  translate already pays once). Acceptable and one-time; the rows demo's
  defs are small. The `name`+`isRoot` per-entry redundancy is ~30 bytes —
  negligible, and `name` is REQUIRED per entry (the re-mint needs it; the
  Link itself carries no name — `link.ts:43-49`, config.name is the KIND —
  so the name must be either carried in the section or recovered from the
  link's surviving anchors, which is exactly ruling 1's "name-less
  prototype is skipped" case — the step-1 G2 analysis is confirmed). The
  doc-carriage-conditional (ruling 2) keeps content-only docs at zero cost ✓.

### 7. The rows re-mint operational answer (the most important question)

**`loadState` does NOT and CANNOT re-mint rows.** Trace of the actual call
surface:

1. `rowsMint` is an OP — it needs `target` (a live node), a hub, the
   layer/journal machinery of the supervisor (`supervisor.ts:886`), and it
   WRITES the batch record back (`ops.ts:272-280`). `loadState` has none of
   that; its contract is parse+validate (`serialize.ts:271-344`). So the
   plan's phrase "loadState re-mints the batch" (next-feature-batch-0.2.0.md
   §Feature 1.3) is loose shorthand for: **the def prototypes exist at
   loadState/re-mint time, so a POST-loadState rows-mint op per persisted
   batch record succeeds.**
2. The persisted records already ride the reseeded graph: the constructor
   seeds `node.batches` from the serialized data (`node.ts:421-422`), and
   the template's `batches` field is schema-validated at the boundary
   (`serialize.ts:298-313`). Each `BatchRecord` (`types.ts:202-208`) carries
   `prototypeName` + `rows` + `layerId` + `mintKind` (+`placementName`).
3. **WHO calls rowsMint after loadState:** the HOST — either directly (the
   Feature-1 demo page + the TDD round-trip block: after step 1.5's def
   re-mint, issue one rows-mint op per `batches[hookName]` record with the
   SAME `prototypeName`/`rows`) or, eventually, the Feature-3 base-restore
   helper ("the loadState machinery plus the supervisor registration steps",
   next-feature-batch-0.2.0.md §Feature 3.19) — which is the same sequence
   wrapped for replay. The re-mint is idempotent-by-replace: the layerId
   (`hook-${target.id}-${hookName}-rows`, `ops.ts:213`) round-trips
   (target.id is stable), so the re-mint REPLACES the batch in place
   (`ops.ts:227-230`) — replay-safe, and the minted nodes get FRESH ids
   (rows are data; minted nodes are derived — the ROWS-ARE-DATA pin).
4. The TDD block (Feature 1a.1's "rows survive serialize → loadState →
   re-mint") must therefore encode: translate (or build) a def-bearing
   graph → rows-mint → serialize → loadState + re-mint defs (step 1.5) →
   seed → host rows-mint per record → assert row count + per-row source
   values. The plan's cited `serialize.test.ts` does not exist
   (tests/unit has no such file — round-trip pins live in render/translate/
   derived/hooks-array/link-hub tests); the block lands in a new file or
   link-hub.test.ts.

### 8. Alternative shapes

| Shape | Cost | Safety | Verdict |
| --- | --- | --- | --- |
| **(a) `defPrototypes` section + re-mint + registry fill (proposal)** | section emit + re-mint step; C1-C5 pins | registry is the census; re-registration on the host hub is exactly what seam/rows read | **RECOMMENDED** with C1-C5 |
| (b) Re-derive defs at loadState from the doc's component Links + provider anchor VALUES (the def data rides `a.value` — `serialize.ts:121` — so re-running `mintDefPrototypes` from the envelope is possible) | re-implements B2 scoping (seamRefs pre-scan `translate.ts:847-893` + mint logic) — duplicated machinery, drift risk; fails when the provider node was destroyed (its anchor — and the value — is gone), while the registry-based section survives provider death | translate-logic duplication is the DEFECT-drift pattern the hub factory existed to kill | REJECTED — strictly more code + a new failure mode |
| (c) Hub-side def-registry API (`hub.registerDefPrototypes`-style) | trivial | new PUBLIC surface; hosts can register arbitrary prototype nodes → the "registry is translate-bound" invariant dies; REQ-GAP-11 discipline (minimal surface) | REJECTED |

The section (a) is cheaper AND safer: it carries the name (ruling 1), the
isRoot discrimination, and the minted RESULT — the re-mint is pure
replay of constructor+registrars, no translate logic re-executed.

### Overlooked elements + suggested amendments

1. **C1 — decide the single-instance rule at the SERIALIZE side.** R2's
   three options are not equal: re-register-by-id-match forces name recovery
   from the seeded anchors (fragile — ruling 1's skip case); loadState-side
   content-dedup complicates the pure parse. Cleanest: when the section
   ships, `serializeSlice` excludes prototype-state nodes from `content`
   (the section is the single carrier); 0.1.5-era docs (prototypes in
   content, no section) keep the inert status quo; G3 validates no
   id-overlap in crafted docs.
2. **C2 — strip seam anchors from the section's node data** (see §4).
3. **C3 — emit + re-mint order: roots before children per name; document
   the 'unplaced'-not-sweep-exempt consequence of a violated order.**
4. **C4 — the re-mint is a recipe step with the host hub, never inside
   pure loadState; the helper returns the minted nodes so steps 3-4 cover
   them.**
5. **C5 — the section rides the schema boundary with existing error codes.**
6. **C6 — pin the post-loadState rows-mint sequence in serialize.md §3/§4
   (who calls what — §7 above), plus the minted-id-instability note.**
7. **G5 refinement — §4 must state the handler-body + AUTH-SEAM adoption
   residual explicitly** (bodies runtime-only AND `adoptDefChildren`
   vacuous post-round-trip).
8. **The step-1 "prototypes already ride content" claim is correct only
   for builders that pass the full `TranslatedTree.nodes` list**
   (translate.ts:926 pushes every minted node — verified for
   `fork-stress-page.mjs:21`; `build-demo.mjs:58/82` pass hand-picked
   slices). The §Feature 1 demo builder + the TDD round-trip block must
   explicitly pass the full list or the section (C1) — the Feature-1 gate
   test would otherwise silently exercise neither path.
9. The re-minted def-roots that become seam-resolved carriers need step-4
   supervisor registration (emit index/pass-2); plain prototypes stay out
   of `this.nodes` — pin the split in the §3 rewrite.

## Step 3 — Change-analysis agent (verdict)

Date: 2026-08-24. Read-only verification pass over steps 1-2 against
`src/core/registry.ts`, `translate.ts`, `serialize.ts`, `node.ts`, `ops.ts`,
`link.ts`, `tests/unit/{link-hub,hooks-array,blind-test-validation}.test.ts`,
`docs/specs/serialize.md`, and the 0.2.0 batch doc §Feature 1a/1a.2/1a.3.
Baseline re-verified: `npm test` 1042/1042 green, `npm run typecheck` clean
(no demo:smoke run — verdict-only pass).

Status: **PROCEED-AS-RESHAPED** — with ONE further reshape (S1 below): the
step-2 C1 decision (emit-side content exclusion + full-state section) is
superseded by a CENSUS section whose states ride `content` (the status quo
transport), and the loadState-side "re-mint" becomes a re-REGISTRATION of the
already-seeded instances (no construction). Steps 1-2's R1-R4 and C2-C6 are
verified correct; R1 dissolves into the census shape, R2/R3 sharpen, C1 is
superseded. One internal inconsistency in step 2 is corrected (N1). The
reshaped contract, TDD plan, and tracker updates follow.

### S1 — the census section supersedes the full-state section (the R2 question)

The review asked whether the content-riding makes the section redundant. The
verified answer: **the content-riding is the transport the section should
USE — the section must NOT duplicate what `serializeSlice` already ships.**
`translateNodeData` pushes every minted prototype into the nodes list
(`translate.ts:926`), `serializeNode` emits its FULL `RenderNodeState` (family
child anchors with `parent` refs, token edge, container/content anchors,
options, derived) for every content entry with no prototype special-casing
(`serialize.ts:85-145`), and the shipped builders already serialize the full
list (`fork-stress-page.mjs:21` — 0.1.5-era docs carry the prototypes in
`content` TODAY). The loadState-side re-mint therefore needs NO second copy of
the states and NO construction:

- **Section shape:** `defPrototypes?: { name: string; nodeId: string; isRoot: boolean }[]`
  (the ruling-2 recorded `{name, node, isRoot}` with `node` renamed `nodeId`).
  The section is a CENSUS + name carrier only: `name` is the ONE datum the
  content entries cannot carry (prototypes bear no anchor on the def Link in
  the general case — the token edge and family links are per-node fresh links,
  and `def.component` is not guaranteed on the def-root), and the only
  loadState-side source of the name that survives every failure mode (provider
  death, anchor loss) is the registry Link's anchors read at SERIALIZE time
  (G2 — verified: every node-side anchor registers on its link, `node.ts:912`,
  so the per-name component Link carries the provider's source/duplex anchors
  with `target` = the reference name, `translate.ts:751`). The name is carried
  IN the section; nothing is recovered at loadState.
- **The re-mint becomes a re-registration** (recipe step 1.5, C4's
  recipe-companion shape — `loadState` stays pure): `reRegisterDefPrototypes(doc, hub)`
  looks up each census entry's node in the ALREADY-SEEDED instance set by
  `nodeId` and registers the instance — `registerDefRootPrototype(hub.linkFor(name,'component'), node)`
  for `isRoot` entries, `registerDefPrototypes(hub.linkFor(name,'component'), childrenInCensusOrder)`
  for children entries (array order = registry mint order — the `protos[0]`
  shape read `ops.ts:223` and the seam zip depend on it). Zero `new Node`
  calls: **the single-instance rule (R2/C1) becomes STRUCTURAL** — one seeded
  instance per prototype, re-registered by identity, so the shared-id guard
  family (`registry.ts:262`, `supervisor.ts:148`) can never fire and no
  emit-side content exclusion exists to get wrong.
- **Why this dominates C1's three options:** re-register-by-id-match was
  rejected by step 2 only because it "forces name recovery from the seeded
  anchors" — the census carries the names, killing that objection;
  loadState-side content-dedup is unnecessary (no second instance exists);
  the emit-side exclusion is unnecessary (nothing to exclude). It also
  dissolves R1 (the section has no node data, so the minimal-`NodeBaseData`
  loss cannot occur — the content entries are full states by construction),
  and it keeps the 0.1.5↔0.2.0 doc asymmetry minimal (the only new doc member
  is the tiny census; `content` is byte-identical in shape to today).
- **Size/cost:** the census is ~30 bytes/entry vs the full-state section's
  O(entries × full RenderNodeState) — the d12-scale 1-2 MB estimate (step 2 §6)
  drops to ~100 KB; construction cost is unchanged (the host's step-2 loop
  constructs the content nodes either way — the full-state shape merely moved
  the same constructor calls into a helper).
- **Emit-side rules (the census's counterpart pins):** (a) a census entry
  ships ONLY when the prototype instance ∈ {template, ...kids} — the
  instance-membership reachability (R3' below); (b) seam child/parent anchors
  are STRIPPED from prototype entries' serialized anchors (C2 — now a content-
  entry strip: drop `role: 'child'` anchors with `options.seam` on
  prototype-state entries; the seed's one-child limit would drop them anyway,
  and the strip removes the dangling-`parent: <consumer-id>` string + the
  future anchor-order hazard); (c) within the content array, every def-root
  precedes its def-children (C3 — see S3); (d) the census children entries
  ship in registry array order.
- **R3 becomes instance-membership (R3').** The step-1/2 anchor-scan
  (collect the slice's nodes' anchor Links) is NOT needed for the census: the
  registry is process-wide, but the census emits only instances present in the
  slice's own set — graph B's prototypes are never in graph A's slice, so the
  cross-graph leakage the smoke's isolated subprocesses mask cannot occur. The
  anchor-read survives only inside G2 (name recovery off the registry Link).
  A 0.1.5 doc re-serialized without re-registration stays inert (seeded
  prototypes are not in the maps → no census entries) — the registry census ∩
  slice set is exactly ruling 2's "the graph holds registered def prototypes".
  This also preserves SER-R1 round-trip stability: a re-registered doc
  re-serializes its census from the maps (the same instances).
- **The full-state section's only residual advantage** (self-contained-ness
  for hand-picked slices that omit the prototypes) is a builder-contract pin,
  not a code hazard: §3 gains "a def-bearing doc ships the full
  `TranslatedTree.nodes` list (prototypes included)" — the step-2 §7.8 pin,
  now a HARD requirement of the census shape (a census entry whose `nodeId` is
  absent from the doc is a crafted doc → `NodeSchema-shape-mismatch`, C5).

### S2 — the R3/C1 answers at loadState + the C6 operational surface (confirmed)

- **C1 operational (verified against `ops.ts:211-282`):** `loadState` cannot
  and must not re-mint rows (no op machinery, no hub — `serialize.ts:271-344`;
  a hub-less re-mint would register under fresh Links `rowsMint`'s
  `target.hubFor ?? ctx.hub` → `hub.linkFor` (`ops.ts:214-218`) could never
  hit). The records seed with the nodes (`node.ts:421-422`), `layerId =
  hook-${target.id}-${hookName}-rows` (`ops.ts:213`) round-trips, and the
  host-driven re-mint REPLACES in place (`ops.ts:227-230`), replay-safe, with
  FRESH minted ids (rows are data — the ROWS-ARE-DATA pin).
- **No loadState return-shape change.** The host reads the pending-batch list
  off the seeded `NodeBaseData[]` (the `batches` payload rides the seed data —
  `serialize.ts:130,236-258`). One additive TYPE fix: `NodeBaseData` gains
  `batches?: Record<string, BatchRecord>` (`types.ts:304`) so the host (and
  the TDD block) stops casting — the "loose NodeBaseData" R1 terminology pin
  applies.
- **Post-loadState sequence (the §3 rewrite):** step 1.5 `reRegisterDefPrototypes(doc, hub)`
  (ONE hub — the REQ-GAP-9 rule) → step 3 `reconcileParentTargets` over the
  FULL seeded set (prototypes included — their fresh family links consolidate
  onto one family link per def-root at `node.ts:1905-1919`, which is what
  populates `defRoot.children` for the seam + the AUTH-SEAM adoption) → step 4
  supervisor registration for seam-RESOLVED carriers only (plain prototypes
  stay out of `this.nodes` — step-2 §3 recommendation 9) → step 4.5 ONE
  `rows-mint` op per `batches[hookName]` record with the record's
  `prototypeName`/`rows` (the host, same hub — the Feature-3 base-restore
  helper is the same sequence wrapped for replay).

### S3 — C2/C3 mechanics (verified + relocated)

- **C2 strip:** seam child anchors (`role: 'child'`, `options.seam`) on
  prototype-state content entries are dropped at EMIT. The seed's one-child
  limit (`node.ts:447-451`) seeds only the FIRST child anchor; translate
  insertion order puts the family edge first (def-root: `attachToPermanentOwner`
  right after construction, `translate.ts:824`; def-children: child-side
  attach `translate.ts:939`/token `833`), and the serialized role-sorted
  anchor order preserves it (`serialize.ts:132-143` — `child` role order 0,
  stable target-equal) — so the seeded prototype derives 'prototype'
  (`node.ts:525`) today, and the strip removes the dangling
  `parent: <consumer-id>` strings + the future anchor-order hazard for free.
- **C3 ordering:** relocated from the re-mint to the CONTENT ARRAY ORDER
  (the seed-time `resolveNodeRef` parent lookup, `node.ts:455-458`): translate
  order already emits roots before children per name (the def-root is minted
  at `translate.ts:823`, its children at `832`; nested defs order naturally —
  B's root, X, then A's children at X's own site `translate.ts:1021`), and the
  re-REGISTRATION is order-free (Map.set per link; the family edges were
  built at seed). The tripwire: the re-registration helper validates every
  entry's post-seed state === 'prototype' (a def-child whose parent failed to
  resolve derives 'unplaced' — `node.ts:536` — sweep-vulnerable, exempt only
  in-tree/prototype `registry.ts:215`); a violation → `NodeSchema-shape-mismatch`
  (C5 — a crafted/ill-ordered doc, impossible from a translate-built full-list
  doc).

### N1 — step-2 §2.1 internal inconsistency (corrected)

Step 2 §2.1 claims the AUTH-SEAM adoption is "vacuous" because "the re-minted
def-root's family chain is only one child anchor deep — `defRoot.children` is
empty (`node.ts:1826`)". This contradicts step 2's OWN §3 (reconcile MUST
cover the re-minted set — `node.ts:1911` creates the def-root's parent-side
family anchor, and `familyChildAnchors` (`node.ts:553-559`) censuses the
children through it): post-reconcile, `defRoot.children` IS the def-children,
and `adoptDefChildren` (`node.ts:1819-1843`) re-homes them. The correct
residual: **the adoption STRUCTURE survives the round-trip (children re-home,
seam-flagged, `runtimeMinted`); the PHASE-HANDLER BODIES do not** (the def-root
rebuilds an empty handler-seam layer — `handlerDef` is runtime-only,
`registry.ts:28-36` — so `copyDefPhaseHandlers` copies nothing,
`node.ts:1792-1806`). The §4 rewrite must say: "defs round-trip; handler
bodies stay runtime-only; a post-restore AUTH-SEAM consumer renders its def
children handler-less until the host re-supplies bodies (handlers.md §6)".
Related host note (out of engine scope): a doc serialized AFTER a runtime
adoption seeds its adopted def-children 'unplaced' unless the consumer
precedes them in the content array — hosts serialize pristine graphs, not
post-adoption runtime states.

### Contract (the implementation must satisfy)

1. `SerializedRenderDoc` gains an OPTIONAL `defPrototypes?: { name: string; nodeId: string; isRoot: boolean }[]` — the CENSUS: names from the registry Link's anchors (G2; a name-less link → entry SKIPPED, ruling 1), entries ONLY for instances ∈ the slice set (R3'), `isRoot` per ENTRY (a node can be root of one name and child of another — nested defs), children entries in registry mint order, roots emitted before their children per name.
2. Prototype STATE rides `content` (status quo — full `RenderNodeState` per entry, `serializeNode` unchanged); no content exclusion; the strip (C2) drops seam child anchors from prototype-state entries' anchors at emit.
3. `registry.ts` gains a read-only enumerator (G1) — e.g. `defPrototypeEntries()` → `[link, Node[]][]` + `defRootPrototypeEntries()` → `[link, Node][]` — plus a Link→name recovery helper (G2, anchor-target read; NO new hub/public surface — the REQ-GAP-11 discipline).
4. `loadState` stays pure parse+validate (signature + return unchanged); the section rides the schema boundary: non-array section → `envelope-mismatch`; malformed entry (name/nodeId non-string, isRoot non-boolean, missing keys), duplicate entry ids, duplicate names, or a `nodeId` absent from `template`/`content` → `NodeSchema-shape-mismatch` (C5, SER-R1 codes). `NodeBaseData` gains `batches?: Record<string, BatchRecord>` (type-only, additive).
5. New exported recipe helper (C4): `reRegisterDefPrototypes(doc, hub)` (or equivalent) — looks up census entries in the seeded set, registers the SAME instances under `hub.linkFor(name, 'component')`, validates post-seed `state === 'prototype'` per entry (violation → `NodeSchema-shape-mismatch`), never constructs, never touches rows.
6. The §3 recipe gains: step 1.5 (re-registration, ONE hub), the step-3 "prototypes included" note (reconcile covers them), the step-4 split (seam-resolved carriers only), step 4.5 (host rows-mint per `batches[hookName]` record), and the builder contract (def-bearing docs ship the full `TranslatedTree.nodes` list).
7. serialize.md §4 caveat FLIP (ruling 3): `rows-prototype-unresolved` becomes doc-carriage-conditional (section round-tripped + re-registered → rows-mint succeeds; absent → the throw stays — BH-N.4's doc has no section and survives unchanged); §4 also states the residual list: handler bodies runtime-only (incl. the corrected AUTH-SEAM wording), layer stacks, minted-node id instability (`ops.ts:244` — rows re-mint with FRESH ids; the (wire, forkKey) identity never survives; Feature 1b is the sanctioned follow-on), link identity (re-registration keys on the HOST hub's fresh links — the point).
8. Pins that must stay green unchanged: BH-N.4 (`blind-test-validation.test.ts:523-550` — the section-absent arm), `hooks-array.test.ts:422-450` (gains the re-mint arm), the REQ-GAP-9 recipe + `link-hub.test.ts` seed-path guards (`component-source-duplicate`, catch containment), the seam + rowsMint resolution paths (`node.ts:1668-1669`, `render-helpers.ts:851/884/896/915-916/1059-1060`, `ops.ts:217-223`).

### TDD plan (red → green → verify; no `serialize.test.ts` exists — the block lands in a NEW file `tests/unit/def-roundtrip.test.ts`)

Red (all fail before implementation):
1. Census emit — translate a seam-targeted def-bearing legacy doc (css + children → def-root + def-children minted) → `serializeSlice(root, nodes)` gains `defPrototypes` with `{name: plan.reference, nodeId, isRoot}` per entry, children in mint order, root first; a def-less doc has NO section key.
2. R3' — a process with TWO hubs' registrations → serializing one slice ships only its own entries; a re-serialized 0.1.5-style doc (seeded, never re-registered) ships none.
3. Ruling-1 skip — `registerDefPrototypes(hub.linkFor('x','component'), [proto])` on a name-less link → no entry.
4. Re-registration — doc from (1) → loadState → seed (full list, template first) → reconcile → helper → `defPrototypesFor`/`defRootPrototypeFor` resolve on the host hub, INSTANCE IDENTITY = the seeded nodes (no second instances, `byId` holds one per id), def-root state 'prototype'.
5. The Feature-1 gate arm (extends `hooks-array.test.ts:422-450`'s scenario): translate → rows-mint → serialize → loadState → seed+reconcile+re-register → host rows-mint per record → row count + per-row source values; re-mint twice = no accumulation (replace-in-place, same layerId).
6. Seam re-materialization — a children-target consumer compiles post-restore and re-materializes the def-root wiring (SED-2 census/emit shape).
7. C2 strip — a seam-wired doc serialized post-compile: prototype entries' anchors carry no seam child anchors.
8. Ordering — def-children before their def-root in `content` → helper throws `NodeSchema-shape-mismatch` (post-seed 'unplaced' tripwire); children census order preserved.
9. Schema boundary — non-array section / malformed entry / duplicate id / duplicate name / `nodeId` ∉ doc → the pinned codes.
10. Caveat flip — BH-N.4 stays green (absent arm) + the section-present arm resolves (covered by 5).

Green: implement the census emit + strip + enumerator/name-recovery + helper + §3/§4 doc edits; verify `npm test`, `npm run typecheck`, `npm run demo:smoke` (incl. the profile watches), `npm run build`.

### Notes for the implementer

- The §Feature 1 demo builder MUST pass the full `TranslatedTree.nodes` list (step-2 §7.8 pin — now a census hard requirement) and exercise the rows round-trip arm on the page.
- Keep-first per name is replaced by REJECT (duplicate names → `NodeSchema-shape-mismatch`, step-2 §4).
- Repeated `loadState` of the same doc leaves the OLD instances in `registered` (the byId-instance-guard pattern, `registry.ts:262-265`) — host note: loadState once per graph; re-registration is per-hub Map.set overwrite, no new defect.
- The seam-anchor strip touches content entries ONLY for prototype-state nodes (identified by token-terminated family edge or membership in the census); non-prototype entries are untouched.
- The AUTH-SEAM wording in serialize.md §4 must use the N1-corrected formulation, not step-2 §2.1's "vacuous".

### Trackers (same pass as the landing)

- `docs/specs/serialize.md` §1 (census shape + emit rules), §3 (steps 1.5/4.5 + builder contract + ordering), §4 (the flip + corrected residual list).
- `docs/next-feature-batch-0.2.0.md` §Feature 1a.2/1a.3 (census shape supersedes `{name, node}`; the gate's "serialize.test.ts" citation → `tests/unit/def-roundtrip.test.ts`).
- `docs/decisions.md` — the census-section decision row (S1, superseding C1) + the caveat flip (ruling 3).
- `docs/defects.md` — none new; the step-2 §2.1 correction (N1) is a review-findings note, not a defect row.
- `docs/pending.md` — the 2026-08-21 def-prototype round-trip parked row flips to PLANNED/landed-shape (the un-park row).
- `docs/next-steps.md` — the work queue entry for the TDD pass (Feature 1a).
- `docs/skills/designing-pages.md` §11 coverage matrix + §12 demo pages (the §Feature 1 demo + the round-trip block) per AGENTS.md item 3.