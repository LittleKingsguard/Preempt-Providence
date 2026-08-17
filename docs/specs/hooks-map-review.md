# External-Names Map ("hooks") — Step-3 Change-Analysis Verdict

Status: **PARK-WITH-ELEMENTS** (three-agent gate, 2026-08-16) + **§7 CONTRACT
AMENDMENT B** (user directive 2026-08-16) + **IMPLEMENTED 2026-08-16** (the
§7 value-provider slot shipped as pinned — see §8 "IMPLEMENTED" note). The
feature as proposed is not worth landing now; page code already covers the
reachable value. The design CONTRACT for the viable residual kernel — opaque
handles, per-Supervisor derived lifetime, a `hooks` name (the React-parity
premise) + a seam-consumer landing rule — was ADOPTED as a recorded decision
for a future revisit (`docs/pending.md` PARKED row); the user then directed
the value-provider-slot amendment (§7): the park is AMENDED, the value-slot
contract is DECIDED (docs/decisions.md HOOKS row) and its §7.2 pin-6 TDD
list is IMPLEMENTED (tests/unit/hooks.test.ts + demo/hooks-scenarios.js).
No further engine, spec, or test code changed by this
review. Companion context: `docs/specs/api.md` §1 (the "only mutation surface"
letter), `docs/specs/handlers.md` (ctx.tree / HandlerContext), `src/core/
legacy-handlers.ts` (NodeView WeakMap + the AUTH-SEAM id-string rule),
`src/core/node.ts` (applySlice / adoptDefChildren), `src/core/translate.ts`
(props verbatim baseFrom + nodeToLegacy), `src/core/render-helpers.ts`
(treeSig / `prop:` emit), `src/core/supervisor.ts` (getNode/allNodes/
registerNode + the apply-path registration funnel), the demo name-addressing
patterns (`demo/components.js` byName, `demo/fork-stress.js` byName,
`demo/feature-matrix-fixture.js` byId, `demo/handlers-scenarios.js`
findNodeInGraph), and `docs/specs/placeholder-node-review.md` §3.2 (the K4
unknown-key candidate).

## 1. What the proposal asks

A name-keyed map attached to components deep in the graph so outside code can
reach those components directly — no tree walks, no findNode queries. The map
is externally exposed. Step-1's cheapest authoring was the props convention
(`props: {'hook:name': true}`); step-1's natural registry was a per-Supervisor
`Map<string, Node>` at the `registerNode` funnel; step-2 rejected as-stated on
the raw-Node write surface, registry lifetime, staleness, naming, and an
absent consumer-landing rule, ending in "reject; the viable residual kernel =
opaque handles, per-Supervisor lifetime + derived name index, consumer-landing
+ staleness rule, and the honest question: what does it add over a two-line
boot-time map?"

## 2. The two prior steps (synthesis)

### 2.1 Validity (step 1) — FEASIBLE as a small additive feature

Verified against the code:
- The props convention is genuinely zero-touch on forward/reverse/serialize:
  `baseFrom` copies props verbatim (`src/core/translate.ts:302`), `nodeToLegacy`
  re-emits them verbatim (`src/core/translate.ts:1044`), and the emit side
  namespaces every prop `prop:<k>` (`src/core/render-helpers.ts:130`,
  `:699`, `:816`, `:955`) with the adapters stripping the prefix
  (`src/core/adapters.ts:130`, `:299`) — colons in authored keys are safe.
- The `registerNode` funnel is real but thin: the supervisor's copy
  (`src/core/supervisor.ts:122-124`) is invoked by the apply path only —
  `placement-attach` (:458), `clone-instance` (:510), and the `layer-apply`
  minted set (:543-546); the SEEDED tree enters via the PAGE boot loop
  (`demo/components.js:43-46`). The clone-instance + layer-apply routes land
  there too — a funnel population covers runtime-minted nodes, with
  clone-instance making duplicate-registration warnings a routine event.
- Exposure of raw Nodes is NOT a new leak: `ctx.tree.getNode` hands raw Nodes
  to modern handler bodies (`src/core/handlers.ts:54`), `supervisor.getNode`/
  `allNodes` hand them to page code (`src/core/supervisor.ts:114-120`), and
  the "no node reference" discipline applies to LEGACY bodies only (the
  NodeView proxy is the only adapted member of the legacy context,
  `src/core/legacy-handlers.ts:349-365`).

### 2.2 Critique (step 2) — REJECT as stated

Verified against the code:
- (1) The raw-Node WRITE surface is real and public on the Node type:
  `applySlice` (`src/core/node.ts:1267`), `addLayer`/`removeLayer`/
  `addAnchor`/`destroy`/`compileLocal`/`compile` (`src/core/types.ts:28-46`).
  api.md §1's letter — "`ClientAPI` is the **only** client/handler mutation
  surface… No other write path exists" (`docs/specs/api.md:11-14`) — is
  factually false against the runnable surface: any code holding a supervisor
  can `supervisor.getNode(id).applySlice([…])` TODAY, bypassing the journal,
  `emitStructure`, and `markPass2` (applySlice's own `scheduleSweep(true)`
  recompiles via the sweep, but the side-carries diverge).
- (4) Registry lifetime: `mintNodeId` is a module-level counter
  (`src/core/node.ts:38-42`) — mint ids are identical across envelopes, and
  `src/core/registry.ts:150` is a module-level id→node map. A module-level
  name registry leaks across translations/queues; per-Supervisor degenerates
  toward today's `getNode` + a boot pass.
- (5) Staleness: `markDestroyed` RETENTION keeps destroyed/runtime-minted
  nodes registered (`src/core/supervisor.ts:431-437`) with last-known state —
  a name→node index keyed at registration serves stale handles with no
  dead-handle signal beyond the node's own `state`.
- (9) Replay/undo: a STORED map goes stale across `replay()`/`undo()`; the
  index must be DERIVED, never persisted.

### 2.3 The disagreement this verdict must resolve (raw-Node exposure)

Both agents are right, and the resolution is a contract ruling, not a
capability finding:

- **Validity's observation is factually correct**: the write bypass is
  reachable with or without the proposal — page code constructs the
  supervisor (`demo/components.js:45`) and `applySlice` is public. The map
  adds no new reachable capability.
- **Critique's objection is architecturally correct**: a map whose VALUES are
  raw Nodes makes the bypass the *default path* — `refs.get('name')
  .applySlice([…])` is instantly easier than the sanctioned
  `clientAPI.apply(id, […])`, normalizing a mutation route with no journal, no
  `emitStructure`, no pass-2 grouping, and no event bridge. api.md §1's letter
  is a *discipline contract for the authoring/handler surface*, not a true
  statement about the runnable Node type — and a feature that ships the
  bypass as its headline ergonomic would be the gate endorsing the wrong
  default.

**Exposure contract (decided):** any approved kernel returns **opaque
handles** — the node's `id` string + read-only resolved state
(`clientAPI.getState(id)`) — and routes every write through
`clientAPI.apply(id, …)`. Never a raw Node value. This is not a novel rule;
it is the codebase's own standing discipline: the AUTH-SEAM id-string "the
honest reference for `clientAPI.apply(id, …)`; a string, never a Node
reference" (`src/core/legacy-handlers.ts:47`), and the NodeView whose mutation
paths route back through `this.svc.clientAPI.apply` (`src/core/legacy-handlers.ts:287-303`).
Raw-Node values on the map are REJECTED.

## 3. The honest question — value over a two-line boot-time map

The critique's baseline (`Map(props.id → id)` + `getNode` + `clientAPI`) is
demonstrably what every page does today:
- `demo/components.js:34-35` — `byName` built from server labels; `wireToNode`
  (:43) id→node; page harnesses reach nodes directly.
- `demo/fork-stress.js:48-49,343` — same byName pattern, phase bodies resolve
  `wireToNode.get(byName[name])`.
- `demo/feature-matrix-fixture.js:205-206` — `byId` built over `n.props?.id`.
- `demo/handlers-scenarios.js:934-939` — `findNodeInGraph` / `findNodeAny`
  O(n) `allNodes()` scans with an explicitly page-chosen destroyed filter.

Weighing the four candidate value-adds:

- **(a) Formalization of the demo pattern** — small real value (removes four
  hand-rolled variations of the same index + label wiring), but trivially
  representable in page code and already shipped in every page. Not
  engine-load-bearing.
- **(b) Built-in staleness filter** — real, but page code ALREADY does it and
  the engine's signal (`node.destroyed` / `state`) exists; the two variants in
  `handlers-scenarios.js` exist precisely because the filter is a page
  decision today. Not engine-load-bearing on its own.
- **(c) `ctx.tree.getRef` for handler bodies** — the strongest ergonomic
  element, and a genuine gap in the AUTHORING model, not just ergonomics:
  data-authored handler bodies are function-STRING data with `ctx` + args
  only (the core-only/`no-outside-script` rule, AGENTS.md item 10) — a body
  CANNOT capture a page-scope `byName` map. `ctx.tree` today offers
  `getNode(id)`/`allNodes()`/`ancestorsOf`/`descendantsOf`/`getState`
  (`src/core/handlers.ts:30-36,49-78`) — no named one-hop lookup. A name-keyed
  `getRef` is the missing modern-handler surface. Engine-load-bearing for
  authoring ergonomics only.
- **(d) Seam-consumer landing rule** — the ONLY element page code cannot do.
  The AUTH-SEAM delivery (`adoptDefChildren`, `src/core/node.ts:1580-1604`,
  phase-bound gate :1581-1585; decisions.md AUTH-SEAM row; handlers.md
  §6/SED-1) re-homes def-root children OUT-of-tree-prototype → IN-tree consumer
  **only when** the def carries a phase-handler binding. A name authored on a
  def child (template.component) therefore has no determinate landing: pre-mint
  registration resolves to a never-rendering prototype (`src/core/translate.ts:629-644`;
  prototypes are not in the shipped document, so a per-Supervisor index has
  no entry at all unless explicitly populated); post-adoption the same
  instance re-homes only under the phase-bound seam shape. A page-side
  `props.id` map cannot see any of this.

**Verdict on the value question:** (b)+(c)+(d) with the props-declared
surface + per-Supervisor lifetime is a coherent, small kernel, and (d) is
genuinely engine-only. But its reachable value today is concentrated in (c),
which no current authored handler needs (the shipped harnesses achieve named
access via payload-captured ids and parent walks), and (d) has no authored
data case. The kernel is the right design, its time is not now.

### 3.1 The authoring-surface cost — the coin-flipper

The "zero forward/reverse changes" (props convention) is only true of the
TRANSLATE pipeline. Every `hook:`/`ref:` prop ALSO:
1. emits as a real DOM attribute (`prop:` prefix strips to `ref:name` on the
   element — `src/core/render-helpers.ts:130` → `src/core/adapters.ts:130`),
2. flows into `treeSig`'s `props` (`src/core/render-helpers.ts:260-271`) —
   **re-baselining every PAR-5 pin** for every page/snapshot carrying a ref,
3. ships in the serialized document verbatim (props round-trip, `src/core/translate.ts:1044`).

So the props surface leaks authoring markers into shipped DOM + PAR-5; the
alternative surfaces each cost more: a top-level NodeData field is **silently
dropped today** (translateNodeData consumes only the known keys,
`src/core/translate.ts:776-792`; no unknown-key warn exists — the same K4 gap
the placeholder review surfaced, `docs/specs/placeholder-node-review.md:121-138`,
disposition `:184`), and an engine-stripped prefix collides with legal authored
props (step-2 #6). An approved kernel must therefore either accept the
treeSig/DOM re-baseline (goods on demo pages only) or ride the placeholder
review's `node-data-key-unknown` candidate when the user approves it. Both
are real costs a parked feature does not yet owe.

## 4. Dispositions

| # | Proposal element | Disposition | Notes |
| --- | --- | --- | --- |
| 1 | Name-keyed map, externally exposed, deep in the graph | **PARK** (feature) | Reachable value is page-side today (the four demo pattern variants); revisit per §6 conditions |
| 2 | Store raw `Node` values in the map | **REJECT** | Exposure contract: opaque handles only (id string + read-only state). Bytes of `applySlice`/`addLayer` etc. are public on the type today (`src/core/types.ts:28-46`) but a map must not ship the bypass as its default path — api.md §1 letter + `legacy-handlers.ts:47` discipline |
| 3 | `props: {'hook:name': true}` authoring surface | **ADOPT (as surface, for the parked design)** | Zero forward/reverse/serialize; accepts the treeSig re-baseline + DOM-attribute leak (`render-helpers.ts:260-271,130`); record that the `node-data-key-unknown` K4 field is the no-DOM alternative once user-approved (placeholder review §3.2) |
| 4 | Per-Supervisor registry at the `registerNode` funnel | **ADOPT (as lifetime contract)** | Only honest lifetime (module-level mint ids rotate per envelope, `node.ts:38-42`); populated at `supervisor.ts:458/510/543-546` + the page seeding loop (`demo/components.js:46`); **derived, never stored** (replay/undo staleness, step-2 #9) |
| 5 | K4 `hook-name-shadowed` / `ref-name-shadowed` warn, keep-first | **ADOPT (as contract)** | Distinct code from the generic duplicate warns; clone-instance makes duplicates routine (`supervisor.ts:510`) |
| 6 | `ctx.tree.getHook` / `ctx.tree.getRef` one-hop named lookup | **ADOPT (as contract, feature parked)** | The only genuine modern-handler gap (data-authored bodies cannot close over page maps); new surface alongside `getNode` (`handlers.ts:30-36`) |
| 7 | Seam-consumer landing rule (def-value children → delivered in-tree node per seam shape) | **ADOPT (as contract, feature parked)** | The engine-only element; resolves the phantom-hook on def-root prototypes (`node.ts:1580-1604`, `translate.ts:629-644`); re-resolves at access time against the delivered tree, mirroring emit-time def-fill sourcing (`render-helpers.ts:689`) |
| 8 | Naming: **"hooks"** (user directive 2026-08-16 — the step-3 `refs` ruling SUPERSEDED) | **ADOPT** | The step-3 agent proposed `refs` because "hooks" collides with React — the user ruled the React overlap is NOT a concern: the framework's premise is DEVELOPER-VISIBLE FEATURE-PARITY WITH REACT (the familiar hooks semantics are the developer-facing surface) and the framework is NOT used alongside React. The other collisions are non-fatal: `LEGACY_LIFECYCLE_EVENTS` (translate.ts:205-211) and the pipeline "Lifecycle hooks" vocabulary (pipeline.ts:83,87) are internal names in different domains — a developer-facing `hooks` map is unambiguous in the parity framing. `refs`/`handles` remain the recorded internal-alternatives if a later collision emerges |
| 9 | Authoring surface: **dedicated `hooks` NodeData field** (user design exploration 2026-08-16 — the props convention SUPERSEDED) | **ADOPT (as contract, parked)** | A first-class field (like `derived`/`handlers` — the baseFrom/nodeToLegacy/serialize precedent, ~4 mechanical sites + round-trip pins + the translate.md §1 schema row + the K4 malformed-shape containment) instead of the `props: {'hook:name': true}` prefix convention. The dedicated field is NOT in props → NO `prop:` DOM-attribute leak → NO treeSig/PAR-5 digest churn → the props surface's standing per-page re-baseline cost (the old row 9) is GONE; the remaining parking reason is the missing consumer only. The K4 unknown-key gap is fixed properly (the schema gains the key) rather than sidestepped; the seam-landing + staleness + clone-shadowing contracts are unchanged |
| 10 | Per-state/per-tick hook resolution pass | **REJECT** | Registration/translation-time population only; access-time resolution = cache/derived reads, never a tick pass — a per-tick pass would read as an EMIT-side blow-up in the fork-stress pins (AGENTS.md item 4) |
| 11 | Stale/destroyed handles | **RESOLUTION-TIME RULE** | Each access re-checks the live node's state (destroyed ⇒ ref resolves undefined/absent, matching the `!n.destroyed` filter the demos already choose, `handlers-scenarios.js:934-939`); never a stored snapshot |

## 5. The recorded design contract (parked kernel)

If a real consumer appears, the contract to land is:

1. **`hooks` — a per-Supervisor derived name index**, authored as a DEDICATED
   `hooks` NodeData field (the `derived`/`handlers` precedent — baseFrom/
   nodeToLegacy/serialize, ~4 mechanical sites; NOT props — no DOM leak, no
   treeSig/PAR-5 churn); registration-time populate only, at the
   `registerNode` funnel; access-time destroy filter + seam re-resolution.
   **SUPERSEDED by the value-provider-slot amendment — hooks-map-review §7**
   (pin 5's node-local de-scoping: NO global name→node index, no funnel
   population; the hook is a node-local value slot with a closed 5-site read
   set — §7.2 pin 2 / §7.4).
2. **Opaque handles only** — resolution returns `id` + `getState(id)`; writes
   via `clientAPI.apply(id, …)`; optionally `ctx.tree.getHook(name)` for
   data-authored handler bodies. NO value-slot-update-cascade semantics in
   the recorded contract (a hook write is a NODE-directed managed write; the
   user's value-provider-cascade reading is a contract AMENDMENT under
   discussion — hooks-map-review §5.3 pending). **§5.2's no-cascade clause
   SUPERSEDED by the value-provider-slot amendment — hooks-map-review §7**
   (the cascade IS the amendment: a hook write updates the provider VALUE and
   cascades source→target via the E2E-3 walk — §7.2 pins 1/3, §7.3; the
   "§5.3 pending" pointer is RESOLVED by §7).
3. **Seam-consumer landing rule** — a ref authored on a def value (children/
   root) resolves to the DELIVERED in-tree node for the consumer's seam shape
   (AUTH-SEAM adopted instance when the def is phase-bound; emit-sourced
   family child otherwise), never to the out-of-tree prototype.
4. **Duplicates** — `ref-name-shadowed` K4 warn + keep-first.
5. **Naming** — `hooks` (the React-parity premise, user directive 2026-08-16 — the step-3 `refs` ruling superseded).

## 6. Cost-benefit summary

- **Full proposal as stated** — benefits (formalization, ergonomics, seam
  delivery) decided NOT to outweigh: the raw-Node write surface shipped as the
  default path (api.md §1 letter breach), the registry-lifetime + staleness
  hazards, the treeSig/PAR-5 re-baseline + DOM leaks, and the naming
  collision. Rejected.
- **Approved kernel (parked)** — costs: treeSig/PAR-5 re-baselines on
  ref-bearing pages, `ref-name-shadowed` K4 code, funnel population at
  `registerNode` (+ the page seeding loop), `ctx.tree.getRef` + docs.
  Benefits: removes four hand-rolled demo index variants, one-hop named access
  for data-authored handlers (the one true gap), and the seam-consumer landing
  rule (the one engine-only capability). Benefits are real but not yet needed;
  the costs are owed today.
- **Parking** — zero cost; the two-line boot-time map + `node.destroyed`
  check remains the shipped answer; the contract (§5) is recorded so a future
  revisit skips the re-litigation of the exposure contract, the seam trap, and
  the naming.

## 7. CONTRACT AMENDMENT B — the value-provider slot (user directive 2026-08-16)

**User directive (2026-08-16):** amend the parked hooks kernel into a
VALUE-PROVIDER SLOT. The hook is a node-local `hooks` field naming a
SAME-NODE value-provider component binding; a hook WRITE updates the
provider's VALUE; the update CASCADES through the component
source→target resolution. Constraint (user directive): hook updates go
through the CONVENTIONAL LAYER INTERFACE, SINGLE-SOURCE — repeated
hook-based changes must NOT grow the layer stack (one deterministic
replace-in-place layer per hook).

### 7.1 Gate outcome (the two-step amendment review, 2026-08-16)

- **Validity (step 1): FEASIBLE.** The value-slot composes from existing
  pieces: the anchor's `value` cell — the source/duplex provider value
  (`types.ts:94-96`, "Resolvers read `anchor.value`") — the state-slice
  mutation path (`hooks.<name>` as a NEW `targetProp` alongside
  `'type'|'content'|'handlers'|'props.*'|'css.*'`, `types.ts:161`), a
  deterministic replace-in-place layer, and a `providerValueFor` helper
  patched at the five anchor-value read sites. The consumer cascade reuses
  the E2E-3 walk already in the state-slice apply branch
  (`supervisor.ts:412-420`).
- **Critique (step 2): VIABLE-WITH-CHANGES.** Six contract pins; all six are
  adopted below (§7.2) — the amendment ships only as the pinned shape.

### 7.2 The six contract pins (all adopted)

1. **ENTRY** — hook writes are `state-slice` mutations targeting
   `hooks.<name>` (the managed channel — gate/journal/events); direct
   `addLayer`/`a.value` writes from page/handler code are the REJECTED
   bypass (the api.md §1 letter's discipline; the amendment's answer to the
   §3/§2.2 raw-Node write-surface concern).
2. **PRECEDENCE** — one `providerValueFor(owner, anchor, name)` — hook layer
   first, authored `a.value` fallback — at resolve.ts:307/314,
   resolve.ts:189, node.ts:276, node.ts:1401-1402, and the emit-time def-fill
   read render-helpers.ts:724-725. Hook wins; the authored value is the
   cleared-hook fallback (clearing the hook restores the authored value).
3. **CASCADE** — the state-slice branch reuses the E2E-3 consumer walk
   (`supervisor.ts:412-420`) — consumers + resolvedStates refresh + emit
   (W2/W4/W6). The layer id `hook-<name>` is deterministic + replace-in-place
   (`addLayer` node.ts:560-565 — NEVER the seq-based `slice-${seq}` scheme
   node.ts:1272; the reserved `hook-` prefix avoids collision with arbitrary
   layer-apply ids). The layer carries NO anchors (removeLayer safety —
   DEFECT #10) and a DEDICATED pass-1 slot (never a `props.*` key — no
   authored-prop collision).
4. **ROUND-TRIP** — the runtime hook value survives as ONE source:
   serializeNode → loadState → nodeToLegacy must reproduce the same value
   (either the anchor mirrors the layer, or all three surfaces gain a hooks
   branch fed by the layer) — the SSR/hydrate divergence class must be
   closed. The authored `hooks` FIELD round-trips (the derived/handlers
   precedent, ~4 sites: types.ts `NodeBaseData` + `baseFrom` + `nodeToLegacy`
   + serialize) + the K4 unknown-key gap fixed for this field +
   `hooks-shape-invalid` containment.
5. **DISCRIMINATION** — seam/def-named hooks are EXEMPT-with-K4-warn
   (hooking a def name would tear down the seam — the landmine); the
   mutation is skipped (the hook is not written), but the op itself is
   applied (not rejected — `status: 'applied'` on the managed channel;
   `hook-seam-exempt` is a K4 console warn, NOT an `ApplyErrorCode`).
   K4 `hook-name-unresolved` (a hook naming a name with no source/duplex
   anchor on the node → rejected on the managed channel; warn + skip at
   the node-level defensive path); hooks are DE-SCOPED to node-local
   value slots (NO global name→node index — no 4095-registration clone
   storm); `mode: replace` only (`append`/`replaceAll` →
   `hook-mode-blocked`, rejected on the managed channel).
6. **TESTS** (TDD, red-first when implemented) — the read sites (self-seed,
   arm resolution, path-state, seam read), the consumer event set after a
   hook write, the round-trip triple, the seam-name guard, the
   clone-shadowing pin.

### 7.3 Resolved design shape

- **Field:** node-local `hooks` NodeData field naming same-node provider
  component names (`hooks: Record<string, string>`).
- **Write:** state-slice mutation `{ targetProp: 'hooks.<name>', mode:
  'replace', value }` → ONE deterministic `hook-<name>` replace-in-place
  layer (`addLayer` node.ts:560-565; repeat writes REPLACE, never grow the
  stack — the user's single-source constraint) → compileLocal → the E2E-3
  consumer cascade (`supervisor.ts:412-420`) + resolvedStates refresh + emit
  (W2/W4/W6).
- **Read:** `providerValueFor(owner, anchor, name)` — hook layer value first,
  authored `a.value` fallback — at the five pinned read sites (§7.2 pin 2).
- **Round-trip:** ONE value source; the three surfaces reproduce the same
  value (anchor-mirror or layer-fed hooks branch), closing the SSR/hydrate
  divergence class; the authored `hooks` field round-trips via the
  derived/handlers precedent sites.
- **Guard rails:** seam/def-name exemption (K4 warn + mutation skipped, op
  applied — `hook-seam-exempt` is NOT an `ApplyErrorCode`), `hook-name-unresolved`
  (rejected on managed channel; warn + skip at node-level), `hooks-shape-invalid`
  containment, `mode: replace`
  only (`hook-mode-blocked`, rejected on managed channel), layer carries no anchors
  (DEFECT #10-safe), no props-key collision (dedicated pass-1 slot).

### 7.4 De-scoped index (the §5 kernel supersession)

Pin 5's node-local de-scoping SUPERSEDES the §5 name-index kernel: the
per-Supervisor derived name INDEX (the §5.1 contract row — pooled
registration at the registerNode funnel, the 4095-registration clone-storm
hazard) is NOT the amended shape — the hook is a node-local slot with a
closed 5-site read set, so no pooled index, no funnel population, no
stale-handle-of-a-name class. §5.2's "NO value-slot-update-cascade semantics
in the recorded contract" clause is likewise SUPERSEDED — the cascade IS the
amendment (its "hooks-map-review §5.3 pending" pointer is RESOLVED by this
§7). The surviving §5 rows stand: §5.3 seam-consumer landing rule (still
parked for the non-AUTH-SEAM seam shapes — children-target/non-phase-bound
def case), §5.4 duplicate warns (recast as the seam-name guard +
`hook-name-unresolved`), §5.5 naming (`hooks`).

### 7.5 Cost-benefit delta (amended contract vs the parked §5 index)

- The value-slot is CHEAPER than the parked name index: the read is a closed
  5-site set (`providerValueFor` at the pinned anchors), the write rides the
  EXISTING state-slice path (gate/journal/events for free), and the ONE
  deterministic replace-in-place layer per hook never grows the stack (the
  single-source constraint). No new index lifecycle, no funnel population, no
  stale-handle semantics.
- New costs vs the park: the `hooks.<name>` targetProp branch + the reserved
  `hook-` prefix layer id + the `providerValueFor` helper + the hooks
  branches on the THREE round-trip surfaces + the four K4s
  (`hook-name-unresolved`, seam-name warn, `hooks-shape-invalid`,
  `hook-mode-blocked`) + the §7.2 pin-6 TDD list.
- The consumer is still assumed, not proven — this review's park is AMENDED,
  not lifted; the implementation is no longer pending (IMPLEMENTED
  2026-08-16 — §8), and what remains parked is the seam-landing rule for the
  non-AUTH-SEAM seam shapes + the exact consumer question (pending.md row).

## 8. Tracker landings

- **`docs/pending.md`** (PARKED-deferred table) — row: **External names map
  (named `hooks` — the React-parity premise)** parked 2026-08-16; the
  value-provider-slot contract (the CONTRACT AMENDMENT B of §7) is DECIDED
  (decisions.md HOOKS row); what remains parked is the IMPLEMENTATION
  (awaiting the user's go-ahead — the §7.2 pin-6 TDD list) + the
  seam-landing rule for the non-AUTH-SEAM seam shapes (unchanged from the
  base review; the revisit conditions (a) data-authored one-hop lookup and
  (b) seam-delivered def-child ref stand).
- **`docs/next-steps.md`** (RESOLVED circle-back log) — row: hooks/refs
  three-agent gate resolved 2026-08-16 → PARK-WITH-ELEMENTS + the §7 value-
  provider-slot amendment; reference `docs/specs/hooks-map-review.md`.
- **IMPLEMENTED (2026-08-16 — the §7.2 pin-6 TDD list, user's go-ahead):**
  the §7 value-provider slot landed as pinned. Engine: `hooks: string[]` on
  `LegacyNodeData`/`NodeBaseData` (translate.md §1 schema row — the
  first-class field with `hooks-shape-invalid` containment; baseFrom/
  nodeToLegacy/serialize round-trip), the `hooks.<name>` `LayerMutation`
  targetProp (types.ts; api.md §1 + ops.md §1 unions), the node.ts
  `applyHookSlice` branch (ONE deterministic `hook-<name>` replace-in-place
  layer carrying the value in the layer's dedicated `value` slot; the
  anchor mirror `a.value = value` = the ONE source serialize/loadState/
  nodeToLegacy ship; `value: undefined` clears + restores the authored
  value via the layer's `hookFallback`), the resolve.ts helper set
  (`providerValueFor` / `providerValueFromLink` / `hookWriteGuard` /
  `hookAnchorFor` / `isDefShapedValue`) wired at the five read sites
  (resolve.ts:307/314 + resolve.ts:189, node.ts seedOwnBindings +
  materializeSeam, render-helpers.ts:724-725), the supervisor state-slice
  ENTRY gate (`hook-name-unresolved` / `hook-mode-blocked` rejections on
  `ApplyErrorCode`; `hook-seam-exempt` warn + no-op), and the E2E-3
  consumer cascade (supervisor.ts:412-420 — inherited, verified). Tests:
  `tests/unit/hooks.test.ts` (20, red→green — the pin-6 list: read sites
  incl. the duplex self-seed + the emit-level SED-1 seam read, the consumer
  event set after a hook write, the round-trip triple incl. the SSR emit,
  the seam-name guard on both the supervisor rejection + the applySlice
  defensive path, clone-shadowing, the O(1) layer stack + mode/name
  rejections + the clear path). Demo: `demo/hooks-scenarios.{html,js}` (the
  SPA scenarios — theme switcher / session panel / live counter; controls'
  function-STRING bodies write through `clientAPI.apply`; the checks pin
  `maxHookLayers == 1` after N writes + the cascade re-renders) +
  `scripts/hooks-scenarios-page.mjs` (build-demo page 21 + demo-smoke
  banner/census/maxHookLayers assert). The still-parked §5.3 seam-landing
  rule for the non-AUTH-SEAM seam shapes is unchanged (pending.md row).

## 8a. Future surface-exposure note (user, 2026-08-16 — circle-back)

The external hook logic will be extended to use PLACEMENT logic for ARRAY
data updates (recorded in `docs/pending.md` SPECULATIVE): feed RAW DATA ROWS
in → mint nodes using the component type reference to a PASSED PROTOTYPE →
the raw row is added to the minted node as COMPONENT SOURCES (source anchors
with values) so downstream fields populate via the source→target cascade;
PAYLOAD BATCHING tracks the nodes generated in the process (the layer-apply
`result.minted` precedent). Relationship to this contract: the §7 value-slot
is the write entry; the array-injection extends it from scalar value updates
to prototype-driven batch minting — the minted-set lifetime/teardown, the
reverse-exclusion, the batching op shape, and the hook-name ↔ minted-set
relationship are the recorded open questions for the future gate.
- **`docs/decisions.md`** — NEW row: **HOOKS — the value-provider slot**
  (contract amendment B, 2026-08-16) — the pins of §7.2/§7.3 (entry through
  the state-slice `hooks.<name>` managed channel, the `hook-<name>`
  deterministic replace-in-place single-source layer, `providerValueFor`
  hook-wins precedence at the 5 read sites, the inherited E2E-3 consumer
  cascade, the ONE-source round-trip, the seam/def-name exemption + the
  `hook-name-unresolved`/`hooks-shape-invalid`/`hook-mode-blocked` K4s, the
  de-scoped node-local slots). The base-review §5.1 index + §5.2 no-cascade
  clauses are SUPERSEDED (§7.4); the exposure contract
  (`legacy-handlers.ts:47`, opaque handles, writes via the managed channel)
  is CONFIRMED as the discipline the amendment's ENTRY pin rides on.
- **`docs/defects.md`** — deliberately NO row: the K4 unknown-key silent-drop
  gap (a top-level NodeData field such as `refs`/`hooks` is dropped with no
  warning — `translate.ts:776-792`) is the SAME candidate the placeholder
  review surfaced and disposed (`placeholder-node-review.md §3.2`, ADOPT-
  candidate pending user approval). Per §7.2 pin 4 the `hooks` FIELD lands as
  a schema-known key (+ `hooks-shape-invalid` containment) at implementation
  time, closed through the round-trip contract rather than a defect row.
  Noted here; not re-opened as a defect.

## 9. Verification notes (load-bearing claims checked against code)

supervisor getNode/allNodes/registerNode + funnel (`supervisor.ts:114-124`,
apply-path `:458/:510/:543-546`); handlers ctx.tree (`handlers.ts:30-36,
49-78`); NodeView WeakMap + id-string rule (`legacy-handlers.ts:71,308-315,
287-303,47`); Node public write surface (`node.ts:1267`, `types.ts:28-46`);
api.md §1 letter (`api.md:11-14`); props verbatim baseFrom/re-emit
(`translate.ts:302,1044`); treeSig props hashing + `prop:` emit +
adapter strip (`render-helpers.ts:260-271,130`, `adapters.ts:130,299`);
demo patterns (`components.js:34-35,43-46`, `fork-stress.js:48-49,343`,
`feature-matrix-fixture.js:205-206`, `handlers-scenarios.js:934-939`);
AUTH-SEAM adoption (`node.ts:1580-1604`, decisions.md AUTH-SEAM row,
handlers.md §6/SED-1); prototype minting out-of-tree (`translate.ts:629-644`);
mint-id rotation (`node.ts:38-42`); K4 channel + no unknown-key detection
(`translate.ts:83-90,196-200,776-792`); placeholder K4 candidate
(`placeholder-node-review.md:121-138,184`).

