# Handoff Round 4 (REQ-GAP-9..12) — Change-Analysis Review (step 3 of the three-agent gate)

Status: **change-analysis review of the four upstream change requests** in
`docs/handoff-3.md` (Round 4 — the consuming Electron project's E2E-battery
plan: host-facing conveniences, workarounds proven, none blocking).
Synthesizes the step-1 validity and step-2 critique outputs; my own re-read of
every cited source site confirms both steps' line references and claims. No
files changed (this document itself is the only artifact). Companion context:
`docs/specs/handoffs-review.md` (Rounds 1-3 gate — format template),
`archive/reviews/2026-08-15/2026-08-15-compile-horizon-review.md` (format
origin), `docs/specs/serialize.md` / `contract.md`, `docs/specs/handlers.md`
(FORMAT MARKER + RUNTIME-WRITE BODY LETTER), `docs/specs/hooks-map-review.md`
(§7.2 pins), `docs/specs/ops.md`, `docs/defects.md` (DEFECT #9/#23/#27),
`docs/decisions.md` (D16 append-with-override, REVERSE-OF-CLEAR). Findings
verified against `src/core/{translate,node,registry,supervisor,ops,serialize}.ts`,
`src/index.ts`, `tests/helpers/fixtures.ts`, and `demo/fork-stress-data.js`.

## 1. Status

Per-issue gate disposition (the step-1 validity verdict is retained except
where the step-2 critique and my own re-read correct it):

| Issue | Step-1 validity | Step-2 critique risk | **Gate** |
| --- | --- | --- | --- |
| REQ-GAP-9 createLinkHub + pin loadState→Node(seed,hub) | VALID-WITH-CHANGES | HIGH (docs half) | **PASS-WITH-RESHAPE** (factory + seed-path hub threading + corrected 4-step recipe; rows-mint-on-reseed is user-gated) |
| REQ-GAP-10 document addLayer as name→body seam | VALID (doc-only) | MEDIUM | **PASS-WITH-RESHAPE** (doc-only seam letter with delimiters + footguns; `registerHandlerBody` **REJECTED**) |
| REQ-GAP-11 Supervisor reset/prune/unregister | VALID-WITH-CHANGES | HIGH | **PASS-WITH-RESHAPE** (self-evicting sweep; reset()/prune()/unregisterNode **REJECTED** as new surface) |
| REQ-GAP-12 clear-children/reset-subtree op | VALID | MEDIUM-HIGH | **PASS-WITH-RESHAPE** (destroy-cascade trigger flag + documented recipe; the new op **REJECTED**) |

**Overall disposition:** no issue is a REJECT as a whole; all four are
conveniences, none blocking, and the step-2 critique's reshapes are smaller
than the proposed shapes (no new public op surface anywhere — one exported
factory, one internal hub-threading fix, one internal eviction, one internal
cascade flag, and doc pins). All work proceeds **only** after the user's
go-ahead (AGENTS.md item 9) and lands through the item-6 step gates (specs
first, TDD red→green, validation trio).

## 2. What the proposals ask

- **REQ-GAP-9** — a public `createLinkHub()` factory (the same-name shared-`Link`
  hub currently lives private in `translate.ts:181` `defaultHub()` and duplicated
  in `tests/helpers/fixtures.ts:13`), plus a documented pin of the
  `serializeSlice → loadState → Node(seed, hub)` flow so the battery's A1
  single-template/content-load scenario can seed component-bearing nodes
  without hand-rolling the hub (the vendored copy risks drift from engine
  link-sharing semantics, DEFECT #9-class).
- **REQ-GAP-10** — document `Node.addLayer` handler-layer injection as the
  sanctioned name→body seam for data-only envelopes that declare `{name, phase}`
  handlers (bodies cannot be JSON), or add a `registerHandlerBody` helper. The
  battery currently uses the undocumented `addLayer` path (the fork-stress page
  pattern, `demo/fork-stress-data.js:221`).
- **REQ-GAP-11** — a `Supervisor.reset()` / `prune()` (drop destroyed+unplaced)
  or a public `unregisterNode`, so a long-lived host does not see `registered`
  grow unboundedly and `allNodes()` scan cost rise with every render.
- **REQ-GAP-12** — a single "clear children / reset subtree" op
  (destroy+detach+payload-drop in one journaled op) or a documented recipe:
  teardown-to-root currently costs one `destroy` op per child (4095 for the
  fork-stress d12 payload tree).

## 3. Feasibility verdict per issue

### REQ-GAP-9 — PASS-WITH-RESHAPE (factory + hub threading + corrected recipe)

Agree with both steps' core findings, verified against the code:

- **No public factory exists.** `defaultHub()` is module-private
  (`translate.ts:181-194`); the test fixture `hub()` (`fixtures.ts:13-26`) is
  an identical same-name shared-`Link` map and is the de-facto shape; the
  `LinkConfigNameHub` **type** is not barrel-exported (`src/index.ts:64-86` —
  the type block stops at `DerivedDecl`).
- **The seed path ignores the hub** (`node.ts:440-470`): every non-child
  seed anchor mints a **fresh** `new Link(...)` at `node.ts:463` (the
  placement/component roles), never `hub.linkFor(...)`. A pinned flow written
  against today's seed path would therefore document **half-shared links** —
  same-name anchors on private links — which is exactly the DEFECT #9-shaped
  drift the handoff wants to prevent. The fix is the critique's ~5-line change
  at `node.ts:463`: route role anchors through `this.hub` (the node already
  carries it — `node.hubFor`, `node.ts:406`; constructor hub param
  `node.ts:414/426`). Child anchors are deliberately per-node fresh links and
  are reconciled later by `reconcileParentTargets` (`node.ts:1869-1887` —
  already exported, `index.ts:26`) — the recipe must keep that step.
- **The un-threaded-hub hazard is real and silent:** `focusedSliceFor`'s
  hub-aware shortcut (`supervisor.ts:61-78`) falls back to the universe sweep
  when the node's hub cannot answer — a pinned flow that forgets the hub makes
  every pass-2 slice an O(n) provider sweep (the exact pathology the
  fork-stress profile pins exist to catch). The recipe must state that the
  **supervisor-hub and the node-hub are ONE hub**: the same `createLinkHub()`
  instance must go to the seeds (`new Node(d, hub)`) AND the supervisor
  (`new Supervisor({hub})` — the constructor accepts it, `supervisor.ts:121-133`).
- **The def/rows-mint machinery is translate-bound (verified, and the step-2
  high-risk point):** `defPrototypes`/`defRootPrototypes` are keyed by the
  **translate-time `Link` instances** (`registry.ts:78-102`); `rowsMint`
  resolves prototypes through `hub.linkFor(name, 'component')` and throws
  `rows-prototype-unresolved` on an empty registry (`ops.ts:217-222`). A
  host-reseeded graph (its own hub, its own Links) therefore **cannot** re-mint
  rows from def prototypes — the registry holds links the host never sees. The
  recipe cannot claim "loadState restores the full authored behavior"; it must
  document this caveat (see the user-gated decision in §5).
- **Link-id round-trip is unstable (verified):** `serializeSlice` ships
  `link: a.link.id` (`serialize.ts:116-121`) but the seed path ignores the
  serialized id and mints fresh ids (`node.ts:450/463`) — link identity does
  not survive the round-trip; only the anchor ROLE/name sharing semantics do
  (and only once the hub threading lands). The recipe must not promise link-id
  stability.

**Accepted shape (minimal):**
1. Extract `defaultHub()` into an exported `createLinkHub(): LinkConfigNameHub`
   and barrel-export the `LinkConfigNameHub` type (translate uses the same
   factory internally — one implementation, no drift).
2. TDD code change: the seed path threads the node's hub for the
   placement/component role anchors (`node.ts:463` region, ~5 lines) — without
   it the pinned recipe documents half-shared links.
3. Doc pin in `serialize.md`/`contract.md`: the **corrected 4-step recipe**
   — (1) `loadState(doc)` → `NodeBaseData[]`; (2) construct each seed with
   **ONE** `createLinkHub()` instance (`new Node(d, hub)`, template first,
   content after — the seed's `resolveNodeRef` parent lookup
   `node.ts:456` needs parents constructed first); (3) `reconcileParentTargets(nodes)`
   (child anchors are per-node fresh links at seed and are reassigned to the
   shared family links here); (4) `supervisor.registerNode(node)` per node
   (module-level `registerNode` already fires in the constructor,
   `registry.ts:150`/`node.ts:437`; the supervisor's `this.nodes` map
   `supervisor.ts:113/144` does NOT — a host that skips step 4 gets a graph
   whose nodes render via the module registry but never appear in
   `supervisor.getNode`/`allNodes`/pass-2).
4. The recipe's caveats paragraph: link ids do not round-trip; def/rows-mint
   is unavailable on reseeded graphs pending the user ruling (§5).

### REQ-GAP-10 — PASS-WITH-RESHAPE (doc-only seam letter; helper REJECTED)

The critique's central correction is verified and adopted: **the handoff's
factual premise is wrong** — body-by-name injection paths already exist and
are journaled. `state-slice` with `targetProp: 'handlers'` writes handler
layers onto an existing node through the managed channel (the R-3 letter,
`translate.ts:1255-1256`; journaled + `markPass2`'ed — `supervisor.ts:851`
region) and — per the RUNTIME-WRITE BODY LETTER (`handlers.md:152`) — runtime
writes carry **real function bodies**, which a same-process mutation payload
can hold even though JSON cannot. `layer-apply` mints nodes **with** bodies
(journaled, `supervisor.ts:764-784`). So the need ("declare by name in data,
inject the body in code") is already served for **in-tree** targets by the
journaled path. What `addLayer` uniquely offers is the **pre-mount prototype
setup** the fork-stress pages use (`demo/fork-stress-data.js:221` — bodies
installed on out-of-tree prototypes before clones inherit them; clone layer
inheritance verified at `node.ts:773`). The step-2 footguns are all verified:

- **addLayer is un-journaled AND does not enter the supervisor pass-2.**
  `addLayer` (`node.ts:626-643`) runs `compileLocal` + `markRemote` +
  `scheduleSweep` — the sweep's coalesced `compileRemote`
  (`registry.ts:173-192`) recompiles, but the supervisor's `pass2States`/
  `resolvedStates`/structure-events pipeline (`supervisor.ts:358-364/447`)
  never sees the node and `takePass2States` never reflects it. On an **in-tree
  live** node that means: compile happens, resolved states do not refresh —
  a silent non-render footgun. The doc pin must bless addLayer **only for
  pre-mount prototype/out-of-tree setup** (the fork-stress pattern) and route
  in-tree live injection to the journaled `state-slice`/`layer-apply` paths.
- **Reserved-prefix collisions (verified):** a layer id starting `slice-`
  with an EMPTY handlers array trips the REVERSE-OF-CLEAR detector in reverse
  (`translate.ts:1267-1274` — the `slice-${seq}-${src}` scheme is the
  state-slice family's, `node.ts:332-342`); `handler-seam` `sourceName`
  layers are excluded from reverse entirely (`translate.ts:1279/1287`); the
  `hook-` prefix is reserved (`hooks-map-review.md` §7.2 pin 3). The pin must
  mandate a host prefix outside all three (e.g. `host-`/`battery-`).
- **Hooks delimiter (verified):** §7.2 pin-1 rejects direct `addLayer` writes
  for HOOK value slots (`hooks-map-review.md:281-285` — the managed channel
  is the only hook-write surface). The seam letter must state the delimiter
  explicitly: **value-provider slots (hooks) → managed channel only;
  handler bodies → the layer surface.** The two are disjoint write surfaces.
- **Precedence + inheritance (verified):** layers merge append-with-override
  (D16 — a later layer's same-name body wins, `node.ts:630-635`); clones
  inherit layers including injected bodies (`node.ts:773`) **without** any
  teardown cascade — a host that addLayer-injects on a prototype must know
  every clone carries the body and that `removeLayer` on the prototype does
  not touch clones (ORIGIN-OWNER teardown is the layer-apply/rows surface,
  `node.ts:666-668`).
- **`registerHandlerBody` stays REJECTED** (adopting step-2): a string-body
  registry drags the `new Function` eval gate (`registry.ts:56-62`) into the
  runtime write surface, contradicting the RUNTIME-WRITE BODY LETTER
  (function bodies required) and the trusted-backend gate.

**Accepted shape:** a doc-only letter in `handlers.md` (§4/§FORMAT MARKER
area) + `translate.md`: (a) the addLayer seam is sanctioned for pre-mount
prototype/out-of-tree body installation; (b) in-tree live injection uses the
journaled `state-slice handlers` / `layer-apply` paths (function bodies, per
the RUNTIME-WRITE BODY LETTER); (c) layer-id prefix rules (`slice-`/`hook-`
reserved, `handler-seam` sourceName excluded from reverse); (d) the
hooks delimiter; (e) append-with-override precedence + clone inheritance
without teardown. No code.

### REQ-GAP-11 — PASS-WITH-RESHAPE (self-evicting sweep; no reset surface)

Agree with the critique's rejection of every proposed shape, verified against
the code:

- **"Drop destroyed+unplaced" is the wrong predicate.** The sweep's
  permanent-owner gate keeps `in-tree`/`prototype` nodes out of finalization
  (`registry.ts:169`); content-owned nodes persist by letter
  (`registry.ts:170` — "payload-owned content persists (placement may
  return)"); retention-destroyed (`runtimeMinted`) nodes are marked destroyed
  **while staying in-tree** to keep legacy-view slots stable
  (`node.ts:836-839`, `supervisor.ts:663-670`). A host-facing prune that
  dropped "destroyed+unplaced" would evict exactly the retention class the
  render contract depends on.
- **The accumulation is real but internal.** Explicit `destroy` → sweep →
  `finalizeDestroyed` (`registry.ts:204-214`) sets `destroyed = true` yet
  **never removes the node** from the module-level `registered` set
  (`registry.ts:11`), the `byId` map (`registry.ts:143`), or the
  supervisor's `this.nodes` (`supervisor.ts:113`) — so `allNodes()` and every
  pass-2 dirty scan grow with every destroyed node. Verified.
- **Missed leak classes (adopted):** `contentNodes` (`registry.ts:71`) is
  unregistered only on the explicit-destroy op path
  (`supervisor.ts:661`), never in `finalizeDestroyed`; `mintedByLayer`
  (`registry.ts:112`) is **never** cleaned on finalize.
- **Process-wide vs per-supervisor (adopted):** `registered`/`byId` are
  module-level and shared by every supervisor in the process; a reset that
  cleared them would evict other graphs' nodes. Eviction must be: module-level
  deletion **at finalize** (terminal — a finalized node is destroyed and
  cannot revive) + per-supervisor `this.nodes.delete` for the same node.
- **requestId dedup survives a same-instance reseed (adopted):** the dedup
  window is per-supervisor (`supervisor.ts:335`), TTL'd but not cleared by any
  reset; `loadState` preserves ids, so a same-instance reseed with a
  requestId reuse can echo a stale report across scenarios. With reset()
  rejected this is a **host-side note** (mint fresh requestIds per scenario),
  not an engine change.

**Accepted shape (smallest, paradigm-consistent — no new public surface):**
1. `finalizeDestroyed` gains the eviction: `registered.delete(node)`,
   `byId.delete(node.id)`, `unregisterContentNode(node)`,
   `unregisterMinted(node.id)` — finalize is terminal, so deletion is safe and
   completes the lifecycle the sweep already owns.
2. Supervisor-side: a sweep hook (or the destroy path) evicts the finalized
   node from `this.nodes` — the per-supervisor map is the `allNodes()` scan
   the handoff complains about. Retention-destroyed and in-tree/prototype
   nodes are untouched (the permanent-owner gate is the contract).
3. Doc pin in `contract.md`/`supervisor.md`-class docs: destroyed-node
   lifecycle (destroy → sweep finalize → eviction), the retention class
   caveat, and the requestId-per-scenario note.
The `reset()`/`prune()`/`unregisterNode` shapes are REJECTED as new public
surface (nothing the consumer asked for is missing once eviction lands; the
external-reset need is genuinely solved by the internal eviction because the
battery asserts `inTree`/mount state, not `registered`).

**AMENDMENT (2026-08-21 — the battery-scenario check):** the finalize-only
eviction does NOT reach the battery's actual workload. The destroy op splits
by mint state (supervisor.ts:663-670): a `runtimeMinted` node (clone-instance
→ node.ts:817, AUTH-SEAM adopted) takes `markDestroyed()` — which sets
`destroyed` + sweep-candidate but NEVER calls `markPending` (node.ts:836-839)
— so it never enters the `pendingDestroy` batch, never reaches
`finalizeDestroyed`, and never hits the accepted eviction. The fork-stress d12
tree the battery tears down is clone-instance-built (cloneOps=4094), so every
teardown leaves 4095 destroyed clones permanently in `registered`/`byId`/
`this.nodes` — the "early tests pollute later tests" cost persists (every
sweep scans `[...registered]` registry.ts:177; `allNodes()` supervisor.ts:140;
the `focusedSliceFor` universe fallback supervisor.ts:352). **The retention
letter protects the WALK/anchors (slot stability), not the maps** — so the
eviction must ALSO fire on the markDestroyed path: the destroy op evicts the
destroyed node's `registered`/`byId`/`this.nodes` entries while KEEPING the
family edge (walk slots stay stable; compile drops destroyed nodes anyway;
reverse excludes runtimeMinted by letter). Teardown for content-owned
descendants additionally requires the REQ-GAP-12 cascade to
`unregisterContentNode` each content child it cascades into (the destroy op
unregisters only its direct target, supervisor.ts:661). TDD for this
amendment: destroy 4095 clone nodes → `registered`/`allNodes()` sizes return
to the live-tree baseline; retention-destroyed slots still walk-stable;
two-supervisor isolation holds.

### REQ-GAP-12 — PASS-WITH-RESHAPE (destroy-cascade trigger flag + recipe; the op REJECTED)

The critique's analysis is decisive and verified:

- **The motivating cost claim is TRUE only for payload trees.** For family
  trees the first `destroy` orphans every sibling at once — `destroyLinks`
  dissolves the shared family `Link` (`node.ts:825-834`), the sweep cascade
  (`registry.ts:204-214`) destroys the rest; remaining work is journal/event/
  pass-2 bloat, not destroy work. For **payload** trees the cascade's
  unconditional content exemption (`registry.ts:210` — "a payload-owned
  descendant survives its tree owner") makes teardown-to-root exactly the
  handoff's per-child destroy cost.
- **The root cause is that exemption, not a missing op.** The supervisor
  destroy path already unregisters content ownership pre-destroy
  (`supervisor.ts:661`); the exemption only blocks the CASCADE. The minimal
  fix: an **explicit-destroy cascade trigger flag** — the destroy op marks the
  destroy as cascade-capable so `finalizeDestroyed` recurses into content
  descendants. No new op kind, no new journal shape, no contract change.
- **The op, if it ever ships, must satisfy** (adopting the critique's full
  list): parent-scoped **single journal entry** `{kind:'clear-children',
  node}`; replay re-derives children (idempotent — re-run is a no-op); **no
  undo** (destroy is terminal); reject prototype-state targets
  (defPrototypes breakage); reject-or-clear origin-bearing children (the rows
  payload-control pin, `ops.ts:288-290` — recommend **reject with a new
  error code**, never silent payload-drop); inherit the retention split
  (`runtimeMinted` children → `markDestroyed`, `node.ts:836-839`); strip
  destroyed children's `content`/`container` anchors from the placement links
  (dead consumers accumulate otherwise); mark the parent pass-2 (the parent's
  `resolvedStates` keep ghosts otherwise); emit N structure events (a batch
  needs a contract change — not worth it); before-compile fires on the parent.
  Every one of these is satisfied by the cascade flag **plus** the existing
  op machinery — which is why the op is the worse shape.

**Accepted shape:** (1) TDD: the destroy-cascade trigger flag
(`supervisor.ts:658-677` destroy branch + `finalizeDestroyed` recursion into
content children when flagged), with the retention split + placement-anchor
strip + parent pass-2 pins from the critique; (2) doc recipe in `ops.md`/
`api.md`: teardown-to-root = one destroy op on the tree owner (family trees
are already O(1); payload trees become O(1) once the flag lands), plus the
per-child fallback recipe for hosts on pre-flag versions. The handoff's
`clear-children`/`reset-subtree` op is REJECTED as a new op surface.
**User-gated:** the flag changes destroy semantics for content children
(owner destroy currently leaves them; with the flag it cascades) — that
touches the content-persistence letter (`registry.ts:170`) and needs the
user's ruling (§5).

## 4. Gaps + costs-benefits (per accepted item)

### REQ-GAP-9 (factory + seed threading + recipe)
- **Work:** export `createLinkHub()` + barrel-export `LinkConfigNameHub`;
  ~5-line seed-path hub threading (`node.ts:463`); the corrected 4-step
  recipe + caveats in `serialize.md`/`contract.md`. TDD: hub-sharing test
  (reseeded same-name anchors land on ONE link, per-name resolution works),
  supervisor-slice test (hub-answered slice stays O(path) — no universe
  sweep).
- **Cost:** small (one factory extraction, one seed-path branch, one doc
  section). No behavior change for translate (same factory internally) or
  for hub-less graphs (hub stays optional; `hubFor` returns null and the
  status-quo sweep stays).
- **Benefit:** the battery's vendored hub dies; A1 seeding is a pinned
  contract; link-sharing semantics stop drifting (DEFECT #9-class closed).
- **Must NOT do:** claim rows-mint works on reseeded graphs (translate-bound
  registry — pending the §5 ruling); claim link-id round-trip stability;
  a hub-requiring `Node` (hub stays optional).

### REQ-GAP-10 (doc-only seam letter)
- **Work:** `handlers.md` + `translate.md` letter: sanctioned addLayer seam
  (pre-mount prototype setup only), journaled paths for in-tree live
  injection (function bodies per the RUNTIME-WRITE BODY LETTER), prefix
  rules (`slice-`/`hook-` reserved; `handler-seam` excluded from reverse),
  the hooks delimiter (§7.2 pin-1: value slots → managed channel only;
  bodies → layer surface), D16 precedence + clone-inheritance-without-
  teardown.
- **Cost:** near-zero (docs + trio re-run).
- **Benefit:** the battery's `addLayer` use stops being undocumented; future
  hosts stop inventing the `registerHandlerBody` idea (which would have
  dragged the eval gate into the runtime surface).
- **Must NOT do:** `registerHandlerBody`; blessing addLayer for in-tree
  live injection (silent non-render); any layer-id prefix that collides with
  the reserved families.

### REQ-GAP-11 (self-evicting sweep)
- **Work:** `finalizeDestroyed` eviction (registered/byId/content/minted —
  `registry.ts:204-214` +~4 lines) + supervisor `this.nodes` eviction on the
  finalized node. TDD: destroyed-node count stability across a
  destroy-heavy run; retention class untouched; per-supervisor isolation
  (two supervisors, one process — eviction of graph A's node never touches
  graph B).
- **Cost:** small, internal, paradigm-consistent (the sweep already owns
  finalization; this completes it). Zero public surface.
- **Benefit:** the long-lived host's `registered`/`allNodes()` growth is
  bounded by live-tree + retention class with NO host change and NO reset.
- **Must NOT do:** reset()/prune()/unregisterNode (new surface, wrong
  predicate, process-wide hazards); evicting retention-destroyed or
  in-tree/prototype nodes (the permanent-owner gate + slot-stability letter).

### REQ-GAP-12 (cascade flag + recipe)
- **Work:** destroy-cascade trigger flag (supervisor destroy branch +
  `finalizeDestroyed` content recursion when flagged) + the retention split,
  placement-anchor strip, and parent pass-2 pins; the recipe doc in
  `ops.md`/`api.md`. TDD: payload-tree teardown-to-root in one destroy;
  family-tree O(1) unchanged; retention children marked (not dissolved);
  placement links stripped; parent resolvedStates refreshed; replay-safe
  (journal entries unchanged).
- **Cost:** small; one behavior-change risk (see the user-gated decision in
  §5) and one event-burst risk (N structure events on a d12 payload tree —
  acceptable; a batch would be a contract change).
- **Benefit:** teardown-to-root becomes O(1) for the d12 payload tree; the
  battery's 4095-op loop dies; no new op surface.
- **Must NOT do:** the `clear-children`/`reset-subtree` op; silent payload
  drops of origin-bearing children (reject with a new error code); undo
  support (destroy is terminal); touching the content-persistence letter
  without the user's ruling.

## 5. Sequencing recommendation

**Pass 1 — doc-only bundle (one pass + validation trio):** REQ-GAP-10's
seam letter (complete). The REQ-GAP-9/11/12 doc halves land with their code
in pass 2 so the docs describe verified behavior. So pass 1 = REQ-GAP-10
only (pure docs, no profile shift expected).

**Pass 2 — small TDD code bundle (red→green first, then the trio):**
1. **REQ-GAP-9** — `createLinkHub()` export + type barrel-export + the
   `node.ts:463` seed-hub threading + the corrected 4-step recipe in
   `serialize.md`/`contract.md` (the recipe doc must land with the threading
   — writing it against the un-threaded seed would document half-shared
   links).
2. **REQ-GAP-11** — self-evicting `finalizeDestroyed` + supervisor `this.nodes`
   eviction + the lifecycle doc pin.
3. **REQ-GAP-12** — the destroy-cascade trigger flag + the teardown recipe
   doc (only after the §5 ruling below — the semantics change gates it).
Each is independently red→green-testable; the trio (`npm test`,
`npm run typecheck`, `npm run demo:smoke`) runs after each landing, watching
the derived-fork profile totals (~1.5× human watch / 2.5× assert) — the
`node.ts:463` threading and the cascade flag touch emit-adjacent paths, so
the d12 pins get an extra look; the REQ-GAP-11 eviction is registry-side and
should be profile-neutral.

**User-gated decisions (no code until the user rules):**
1. **REQ-GAP-12 semantics change (the flag) — RULED 2026-08-21 (user):** *"Cascade
   should apply to explicit children, skipping placements and component
   prototype."* The explicit-destroy cascade flag is APPROVED with this precise
   scope: the cascade recurses into the destroyed node's EXPLICIT (family
   parent-child) children, and SKIPS (a) placement-owned nodes — the
   placement-may-return persistence letter (`registry.ts:170/210`) stays
   intact for placement content, and (b) `'component'`-token prototype nodes
   (never render; def/seam prototypes are untouched). Encoding: the flag
   relaxes `finalizeDestroyed`'s content-exemption for EXPLICIT family children
   of an explicit-destroyed node ONLY — placement anchors and component-token
   prototypes keep their exemptions. The battery's payload-tree teardown
   becomes O(1) when the destroyed children are family children of the tree
   owner; placement-owned subtrees keep the documented per-child recipe.
2. **REQ-GAP-9 rows-mint on reseeded graphs — RULED 2026-08-21 (user):**
   *"Go with caveat."* Documented caveat: **component-bearing docs →
   `translateLegacy(doc, { hub })`** (the opts already exist, translate.ts:1056 —
   def/seam/rows machinery registers under the host's hub links and resolves);
   **`serializeSlice → loadState` is the snapshot/restore path only** —
   def-less, seam-less, rows-less by construction (`loadState` returns
   `NodeBaseData[]`; the def-prototype registry holds translate-minted Node
   objects that serialization never carries). `rows-mint` on a reseeded graph
   throws `rows-prototype-unresolved` (fail-with-warning, contained) — pinned
   as the documented behavior. The def-prototype round-trip (serialize +
   re-mint def prototypes through loadState) is PARKED (pending.md — revisit:
   a consumer that needs rows-mint/seam post-snapshot-restore).
3. **REQ-GAP-11 no-public-reset — RULED 2026-08-21 (user):** *"go with option
   A."* Confirmed: the amended self-evicting sweep satisfies the host need —
   `reset()`/`prune()`/`unregisterNode` stay PARKED (revisit: an explicit host
   request for hard-reload semantics); the journal's unbounded O(total-ops)
   memory growth is recorded as the one residual (SPECULATIVE feature:
   journal condensing — roll old entries into a new base after a configurable
   max length, pending.md).

**Tracker updates (AGENTS.md item 6, in the same pass):**
- `docs/decisions.md` — the REQ-GAP-10 seam letter (addLayer sanctioned for
  pre-mount setup; journaled paths for live; the hooks delimiter), the
  REQ-GAP-11 destroyed-lifecycle-eviction row, the REQ-GAP-12 cascade ruling,
  the REQ-GAP-9 hub recipe contract (one hub threaded everywhere).
- `docs/pending.md` — `registerHandlerBody` as a PARKED row (revisit
  condition: a consumer that cannot use the journaled paths); REQ-GAP-11
  reset/unregister as PARKED (revisit: explicit host request); REQ-GAP-9
  rows-mint re-key as a PENDING row tied to this review's ruling; REQ-GAP-12
  `clear-children` op as PARKED (revisit: a consumer needing the batch/
  event contract change).
- `docs/next-steps.md` — bookmark the three pass-2 TDD items.
- `docs/defects.md` — only if a defect surfaces during TDD (none are
  pre-declared; REQ-GAP-9's seed-path hub gap is a doc/code gap, not a
  shipped-behavior defect — the seed path predates the hub contract).
- **Archive:** this review is the artifact (`docs/specs/handoffs-review-2.md`,
  git-visible, cited from the tracker rows). No existing citations move.
- `docs/skills/designing-pages.md` — per AGENTS.md item 3: if the cascade
  flag or the seam letter changes host-facing behavior, update §11's
  coverage matrix + mention in §12 only if a demo page demonstrates it (the
  fork-stress pages already demonstrate the addLayer seam — one §12 sentence
  is warranted once the letter lands).

## 6. Explicit closures

- **REQ-GAP-9** — **APPROVED-WITH-RESHAPE**: `createLinkHub()` +
  `LinkConfigNameHub` type export, the `node.ts:463` seed-hub threading, the
  corrected 4-step recipe (one hub everywhere: seeds + supervisor), and the
  caveats paragraph. rows-mint-on-reseed **RULED 2026-08-21 (user): documented
  caveat** — component-bearing docs go through `translateLegacy(doc, { hub })`;
  loadState is the snapshot/restore path only (def-less); the def-prototype
  round-trip is parked.
- **REQ-GAP-10** — **APPROVED-WITH-RESHAPE** (doc-only): the addLayer seam
  letter with the pre-mount-only scope, the journaled-path alternative for
  live injection, the prefix rules, the hooks delimiter, D16 precedence +
  clone inheritance. `registerHandlerBody` is **REJECTED** (eval-gate
  contamination of the runtime surface).
- **REQ-GAP-11** — **APPROVED-WITH-RESHAPE**: self-evicting sweep
  (finalize + supervisor eviction). The `reset()`/`prune()`/`unregisterNode`
  shapes are **REJECTED** (wrong predicate — the permanent-owner gate and the
  retention letter — and process-wide hazards). User confirms the
  no-public-surface disposition (§5 ruling 3).
- **REQ-GAP-12** — **APPROVED-WITH-RESHAPE**: destroy-cascade trigger flag +
  documented teardown recipe. The `clear-children`/`reset-subtree` op is
  **REJECTED** (the exemption at `registry.ts:210` is the root cause, and the
  flag fixes it without a new op surface). **Cascade scope RULED 2026-08-21
  (user):** the cascade applies to explicit (family) children only, skipping
  placements (placement-may-return letter intact) and `'component'`-token
  prototypes. Until the flag lands, the battery's per-child loop remains the
  documented recipe.

**Verdict:** the Round-4 handoff is **APPROVED-WITH-RESHAPE** — all four
issues proceed in minimal reshaped forms that add **no new public op surface**
(one exported factory + type, two small internal fixes, one doc letter), all
TDD red→green, everything behind the user's go-ahead and the item-6 step
gates, the three user rulings above before REQ-GAP-12's flag and REQ-GAP-9's
recipe land, validation trio green (with the derived-fork profile watch)
before completion. The consumer's workarounds remain valid meanwhile (vendored
hub, pre-mount addLayer, accepted registry growth, per-child teardown) — none
of this work is blocking the battery.