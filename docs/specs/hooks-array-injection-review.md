# Hooks → Placement-Driven Array Data Injection — Step-3 Change-Analysis Verdict

Status: **PARK → AMENDED** (2026-08-19). The as-stated shape is REJECT
(step-2's reading holds); the adaptive elements are recorded as a parked
contract (§5) with precise revisit conditions (§3) — and then the user
directed **CONTRACT AMENDMENT C** (the kind-discriminated hook declaration +
prototype-as-reference + React-parity consumer + payload-batching
double-serialization prevention), which the two-step amendment review found
VIABLE-WITH-PINS and RECORDED (§9). The amended contract is the governing
design shape; implementation still awaits the user's go-ahead (the §9.4 TDD
list). The proposal
extends the §7 hooks value-provider slot (`docs/specs/hooks-map-review.md`
§7/§8a, `docs/pending.md` line 35 SPECULATIVE row) to ARRAY data updates via
placement logic. No engine, spec, or test code changed by this review —
the verdict document is the only artifact. Companion context:
`docs/specs/hooks-map-review.md` (the §7 six pins + §8a surface-exposure
note), `docs/specs/api.md` §1 (the only-mutation-surface letter),
`docs/specs/ops.md` §2.8 (OO rows, layer-apply), `docs/specs/payload.md`
(the reverse contract), `docs/specs/placement-path-spec.md` (container/
content roles, path multiplicity), `dist/core/ops.js`, `dist/core/supervisor.js`,
`dist/core/node.js` (applyHookSlice, removeLayer teardown, originLayer),
`dist/core/resolve.js` (providerValueFor / hookWriteGuard / isDefShapedValue),
`dist/core/registry.js` (mintedByLayer/mintedByOrigin, def prototypes).

## 1. What the proposal asks

Extend the §7 value-provider slot so a hook write can drive ARRAY-driven
minting: feed RAW DATA ROWS in → mint nodes using the component TYPE
reference to a PASSED PROTOTYPE → the raw row is added to the minted node
as COMPONENT SOURCES (source anchors with values) so downstream fields
populate via the component source→target cascade. PAYLOAD BATCHING tracks
the generated nodes (the layer-apply `result.minted` precedent). Recorded
open questions (hooks-map-review §8a / pending.md): the minted nodes'
lifetime/teardown (the OO pre-detach predicates), the reverse-exclusion of
the minted set (runtimeMinted), the batching op shape (one journal entry
per batch vs per row), and the hook-name ↔ minted-set relationship.

## 2. The two prior steps (synthesis)

### 2.1 Agreement (both agents verified against code)

- The capability gap is REAL: a runtime-minted node carrying VALUE-BEARING
  provider anchors is inexpressible today — OO-3 strips `anchors` from
  layer-apply minted NodeData (`dist/core/ops.js:163-166`,
  `layer-apply-anchors-rejected`), `AnchorDecl` has no value field
  (`src/core/types.ts:224`), and all anchor-with-value creation sites are
  translate-time or clone-copy only. No runtime anchor-planning path exists
  outside translate (`planBindings`/`mintDefPrototypes`,
  `dist/core/translate.js:480-492`/`:683-751`).
- The mechanism is ABSENT as stated: no prototype-reference slot exists in
  `LayerApplyOp` (`src/core/types.ts:150-157`) or the `LayerMutation` union
  (`src/core/types.ts:167`, api.md:39-45).
- The consumer is ASSUMED-NOT-PROVEN (§7.5) — no shipped demo or page
  expresses the need; hooks-scenarios is theme/session/counter, all scalar.
- Every named precedent is real: layer-apply mint + `result.minted` +
  originLayer + the minted-set registry (`dist/core/ops.js:153-178`,
  `dist/core/supervisor.js:549-572`, `dist/core/registry.js:72-86`,
  `dist/core/node.js:315-327`); array VALUES already pass the hook gate
  (`isDefShapedValue` carves arrays OUT of the seam guard,
  `dist/core/resolve.js:48-55`; `applyHookSlice` has no value-type gate,
  `dist/core/node.js:1296-1335`).

### 2.2 Disagreement (step-2's reading holds on all three top findings)

Step 1 ("FEASIBLE WITH CHANGES") reads the two missing pieces as buildable;
step 2 ("REJECT AS STATED") reads the §7-pin collisions as STRUCTURAL, not
cosmetic:

1. **Mint machinery absent at runtime** — the fix is not a surface tweak: it
   requires a new op-or-extension across ops/types/supervisor PLUS an
   `AnchorDecl` value field PLUS a runtime anchor-planning path extracted
   from translate.
2. **§7 pins contradict the payload** — the passed prototype is a def-shaped
   value (`type`-bearing → `isDefShapedValue` → `hookWriteGuard` rejects
   `hook-seam-exempt`, `dist/core/resolve.js:48-69`). The very provider the
   proposal wants to hook is EXEMPT from hooking. And arrays are ALREADY
   legal hook data today — the extension needs an undefined discriminator
   (every array mints? a magic value shape?) that silently reclassifies
   currently-legal data into structure. The §7 ENTRY pin ("hook writes are
   value writes through the managed channel") is contradicted by "hook
   writes mint structure".
3. **Round-trip ONE-source breaks structurally** — `serializeNode` ships
   children AND anchor values (`dist/core/serialize.js:54-107`); a serialized
   batch would ship rows TWICE (anchor mirror + minted family children);
   `loadState`→`new Node` never re-mints (`dist/core/node.js:368-402`);
   reverse-exclusion keys on the runtime-only `originLayer`
   (`dist/core/translate.js:1066-1070`) → reload loses the markers → SSR/
   hydrate divergence + duplicates + rows reversing as authored.

Step-1's per-piece feasibility is not wrong — each piece is buildable — but
the CHANGES are contract-level: they amend §7 pins 1/5 (ENTRY/
DISCRIMINATION), pin 4 (ROUND-TRIP), and the layer-apply A5 family-only pin.
That is an amendment-of-the-amendment, not a surface-exposure note, and the
consumer that would justify paying it is still assumed twice over.

## 3. Verdict on the value question

**PARK.** The value question fails on both horns:

- **The gap is real but NARROW.** Only "runtime-minted nodes carrying
  value-bearing provider anchors + per-row live cascade" is missing.
  Everything a list demo would show is already shipped:
  `receiveNextState({children})` → ONE layer-apply with pre-baked row
  NodeData is the committed children-injection consumer (handlers.md §6,
  ops.md §2.8 OO-7), and the handlers-scenarios S1/S5 search-filter lists
  demo exactly the "array of rows → minted list" need with ZERO new engine
  surface. Baked rows cannot be providers/consumers today (the A5 veto + no
  runtime planning), but no demo or authored page uses rows-as-bindings.
- **The §7-pin collisions are structural, and the pins are user-ratified
  contracts.** Amending them for a speculative shape whose consumer is
  assumed-not-proven (twice: §7.5 and §8a's own framing) is paying contract
  debt for a design no consumer has requested.
- **The demo-need test fails.** A hooks-array demo page would show "a list
  whose rows are minted from raw data and populated via source→target" —
  which is a LAYER-APPLY BAKED-ROWS page today (S1/S5 prove it); the only
  difference is per-row live bindings, which is invisible to a demo's
  rendered output unless the demo ALSO builds cross-row consumers — and
  nothing does.
- **Cost proportionality fails.** The minimal adapted shape (§5) is ~1.5-2×
  the §7 implementation (itself ~20 tests + engine changes across 7 modules
  + a demo + smoke pins). Against zero consumers.

### Revisit conditions (update the pending.md SPECULATIVE row)

1. **A real consumer appears** — a data-authored page or committed bridge
   surface that needs minted rows to BE component bindings (rows as
   providers for other nodes' references, or rows as consumers) — the
   expressible test: the baked-row layer-apply workaround cannot render it.
2. **The user gate opens the §7 pins** — a directive to amend the
   ENTRY/DISCRIMINATION/ROUND-TRIP pins (or the layer-apply A5 family-only
   pin). The pins are user-ratified; only the user can reopen them.
3. **A data-authored array-injection demo need** with an actual output
   claim the baked-row workaround can't meet.

## 4. Dispositions

| # | Element / finding | Disposition | Notes |
| --- | --- | --- | --- |
| 1 | Raw data rows fed through the **hook write** (the §7 value-slot as the array entry) | **REJECT** | Contradicts §7 ENTRY pin (hook writes = scalar value writes) + DISCRIMINATION pin (the passed prototype is def-shaped → `hook-seam-exempt` kills the write, `resolve.js:48-69`); arrays are already legal hook data — the extension needs a discriminator that silently reclassifies data → structure. The op surface, not the value slot, is the honest entry |
| 2 | Mint via the component TYPE reference to a passed prototype | **AMEND** (recorded) | The component **Link IS name-keyed** — `linkFor(name, 'component')` → `defPrototypesFor(link)` (`registry.js:44-63`). "Passed prototype" = the per-name def prototypes; resolution at the supervisor. What a prototype IS: the translate-minted `'component'`-token prototype nodes (a runtime-declared prototype is a further step — not needed) |
| 3 | Row added to the minted node as component SOURCES (value-bearing anchors) | **AMEND** (recorded) | The real gap, confirmed: `AnchorDecl` gains `value`; the mint path plans per-row source/duplex anchors from the row data (the translate-time `planBindings` extraction); the OO-3/A5 veto (`ops.js:163-166`) is scoped to layer-apply family-only minting, so the NEW op carries its own mint-with-anchors contract rather than amending A5 |
| 4 | Downstream fields populate via the source→target cascade | **REJECT as stated / AMEND** | Structural break, confirmed: the E2E-3 walk iterates the HOST's anchors only (`supervisor.js:412-422`) — consumers of the rows' own per-name links are never dirtied; the cascade is the feature's mechanism and it does not exist. An adapted shape needs a MINT-SIDE consumer walk (each row's source/duplex anchors' links → markPass2) |
| 5 | PAYLOAD BATCHING tracks generated nodes (the `result.minted` precedent) | **ADOPT** | Verified precedent (`ops.js:153-178`, `supervisor.js:549-572`); one journal entry per BATCH (the per-row flush is the DEFECT #22-class O(n²) shape — per-batch = linear, layer-apply precedent; AGENTS.md item-4 watch) |
| 6 | Minted-set lifetime/teardown | **AMEND** | Teardown = `removeLayer`/`removeLayersForSource` on the creator via the pre-detach survival predicate — BUT with a hooks-rows policy override: rows must NOT PROMOTE (promotion clears `originLayer` and reverse-ships the row as authored `node.js:637-641` — for transient data rows that is data corruption, payload.md R-1 letter) |
| 7 | Reverse-exclusion (runtimeMinted) | **AMEND** | `originLayer` exclusion already covers minted rows (`translate.js:1066-1070`); the no-promotion override (row 6) keeps it airtight |
| 8 | Batching op shape: one entry per batch vs per row | **ADOPT: per batch** | `result.minted` journal entry (replay resolves to existing nodes); re-write = replace the batch (removeLayer + re-mint or in-place replace), idempotent on layerId |
| 9 | Hook-name ↔ minted-set relationship | **AMEND** | The minted set keys to a DETERMINISTIC NODE-SCOPED `hook-${nodeId}-${name}-rows` layer id (DEFECT #23 — see this REVIEW §9.2 pin 5/§9.7, DEFECT #23 row) — a SEPARATE namespace from the scalar `hook-<name>` value layer (verified hazard: the scalar layer carries NO anchors for removeLayer/DEFECT #10 safety `node.js:1294-1335`; a batch layer carrying origin decls under the same id = two shapes under one id — the removeLayer anchor-removal loop would chew on the scalar hook's layer) |
| 10 | Step-1 #1: no runtime value-bearing anchor attach on minted nodes | **ADOPT as the core work item** (parked) | `AnchorDecl` value + mint-side anchor planning + the anchor-mirror ONE-source discipline |
| 11 | Step-1: no atomic mint+value-attach+zone-target op shape | **AMEND: NEW OP** (`kind: 'rows-mint'`), no placement | The api.md §1 union gains the member — the letter cost is honest and contained (api.md §1/ops.md §1/serialize/journal ripples); the alternative (mint inside `applyHookSlice`) is the raw-Node bypass the ENTRY pin exists to prevent + breaks census/visibility (the state-slice branch never registers minted nodes — `supervisor.js:348-426` vs `:549-573`). **No placement involvement**: zones ride the EXISTING placement-attach/content-anchor surface — the placement-path machinery (F3 ancestor veto, stale container anchors, DEFECT #10 class) is where the O(n²)/census complexity lives |
| 12 | Step-2: mint machinery absent at runtime | **Confirmed + AMEND** | New op + `AnchorDecl` value + runtime planning extraction (translate.js:480-492, 683-751) |
| 13 | Step-2: §7 pins contradict the payload | **Confirmed + REJECT as stated** | The discriminator question is the coffin nail: a magic value shape on the hooks surface reclassifies currently-legal data. The dedicated op IS the discriminator — hooks stays scalar, the rows op is structural |
| 14 | Step-2: round-trip triple breaks | **Confirmed + AMEND** | ONE-source ruling (§5 row 8): **rows are DATA, minted nodes are DERIVED** — the raw rows serialize once as the provider value; the minted children serialize-excluded via an originLayer-aware branch; loadState re-mints the batch from the persisted value |
| 15 | Step-2: no mutation-surface slot for a prototype reference | **Confirmed** | The op payload carries `prototypeName` (never the `hooks` field — it is `string[]` names only) |
| 16 | Step-2: teardown promotion reverse-ships rows | **Confirmed + AMEND** | No-promotion pin for the `hook-${nodeId}-${name}-rows` namespace (§5 row 9) |
| 17 | Step-2: per-row shape = O(n²) class | **Confirmed + per-batch** | (row 5) |
| 18 | Step-2: `hook-<name>` two-shapes-under-one-id | **Confirmed + separate namespace** | (row 9) |
| 19 | Step-2: replay/undo go stale | **Confirmed + AMEND** | `undo()` implements ONLY attach/destroy (`supervisor.js:590-642`); the batch undo branch = a PAYLOAD-CONTROL op (pushes the `batches[name]` record → the node-scoped `removeLayer('hook-${nodeId}-${name}-rows')` teardown), redo = re-apply; replay idempotency via the layerId |
| 20 | Step-2: multi-mount collision (module-level mint ids) | **AMEND** | The layer-apply precedent already ships module-level mint ids at runtime — accepted contract; deterministic per-batch ids optional |
| 21 | Step-2: reference-equality short-circuit / empty-array≠undefined / seam-shaped rows | **MOOT under the new-op design** (no hook-write reclassification); recorded as pins IF a value-channel variant is ever pursued | `node.js:1326` (fresh arrays never short-circuit), `node.js:1318-1324` (clear fires only on `undefined`), `resolve.js:48-55` (row-level def shapes never inspected) |
| 22 | Step-2: event dispatch for minted rows' handlers | **PARK** | No runtime handler-compile path for runtime-minted nodes (handler-defs are translate-registered); the adapted shape carries no handler claims — rows are data, handlers stay authored |
| 23 | Step-2: element identity churn per batch | **PARK/ACCEPT** | Data rows have no stable identity; nodes mint with UNIQUE KEYS AS NORMAL and the PAYLOAD (`batches[name]` + `mintedByOrigin`) is the association/control mechanism — whole-batch replace per write is the honest semantic (matches the `receiveNextState` children-injection precedent); same-rows re-write = deep-equality no-op (pin 6 ruling) |
| 24 | Step-2: treeSig/PAR-5 re-baseline + profile pins | **NOTE** | Not applicable to the §7 field (already shipped); applicable when a demo page ships (census + profile pins + the AGENTS.md item-4 watch) |
| 25 | Step-2: coveredChildless / def-fill emit interplay | **PARK as a demo/emit-side gate** | The emit side's def-covered machinery applies if rows are def re-types; not load-bearing for the op contract |
| 26 | Step-1: array-vs-scalar discrimination undefined | **RESOLVED by the new-op design** | No value-shape discrimination anywhere; hook writes stay scalar (row 13) |
| 27 | Step-1: teardown keyed on origin-layer, no hook batch layerId | **RESOLVED** | Node-scoped `hook-${nodeId}-${name}-rows` (row 9) |

## 5. The recorded contract (the shape a future revisit lands)

1. **Surface: a NEW structural op** (`kind: 'rows-mint'`) added to the
   api.md §1 / ops.md §1 unions — NOT a `hooks.<name>` extension. Hook
   writes stay scalar value writes (§7 ENTRY/DISCRIMINATION pins survive
   untouched).
2. **Payload:** `{kind: 'rows-mint', target, layerId, prototypeName, rows,
   decls?}`. `prototypeName` resolves at the supervisor via
   `linkFor(name, 'component')` → `defPrototypesFor(link)` (the
   translate-minted per-name def prototypes). Rows = raw JSON data.
3. **Mint:** per row — a node from the prototype's shape with the row's
   fields attached as VALUE-BEARING source/duplex anchors (`AnchorDecl`
   gains `value`; a mint-side planning path extracted from translate's
   `planBindings`/`mintDefPrototypes`). The OO-3/A5 veto stays scoped to
   layer-apply (family-only, `layer-apply-anchors-rejected`).
4. **Zone/placement: NONE** — family minting only; zones ride the existing
   placement-attach/content-anchor surface (no placement-path machinery, no
   F3 veto interplay, no stale-container class).
5. **Layer id:** deterministic NODE-SCOPED `hook-${nodeId}-${name}-rows`
   (DEFECT #23 — the orig `hook-<name>-rows` was hook-name-only and
   crossedtears down other nodes' batches through the module-level
   mintedByOrigin scan) — separate from the scalar `hook-<name>` value
   layer (no two-shapes-under-one-id; the removeLayer/DEFECT #10 loop stays
   safe).
6. **Journaling:** ONE entry per batch with `result.minted` (the layer-apply
   A3 precedent); idempotent on layerId; a re-write replaces the batch.
7. **Cascade:** a MINT-SIDE consumer walk — each minted row's source/duplex
   anchors' links → consumers markPass2 (the §7 E2E-3 walk stays host-scoped
   for scalar writes).
8. **Round-trip ruling — ROWS ARE DATA:** the raw rows serialize ONCE as
   the provider value; the minted children are serialize-excluded via an
   originLayer-aware branch; loadState re-mints the batch from the persisted
   value (the layer + minted set rebuilt). nodeToLegacy ships the authored
   envelope only. Closes the two-shapes divergence.
9. **Teardown — PAYLOAD-CONTROLLED (user ruling 2026-08-19):** for the
   raw-data-array → placement/component hook method, the CONTROL MECHANISM
   for deleting/tearing down a minted batch is **the PAYLOAD** — operating
   on the `batches[name]` record (a payload clear/remove/update on the
   declared hook name) — NOT the minting apparatus directly (external code
   never calls `removeLayer('hook-${nodeId}-${name}-rows')` /
   `teardownMinted` by hand). The supervisor routes a payload-control op
   through the node-scoped layer teardown internally: the record's
   `layerId = hook-${nodeId}-${name}-rows` → the pre-detach survival
   predicate with a NO-PROMOTION override for this namespace (promoted rows
   reverse-shipping = data corruption; overrides the ORIGIN-OWNER promotion
   for the rows namespace). The payload is the single handle: write it →
   mint/replace; clear/remove it → teardown; read it → the batch + minted
   set + round-trip source.
10. **Census/registration/undo:** the supervisor branch registers every
    minted node (layer-apply precedent `supervisor.js:549-573`); undo
    branch = a payload-control op (clears/restores the `batches[name]`
    record → the node-scoped `removeLayer('hook-${nodeId}-${name}-rows')`
    teardown), redo = re-apply.
11. **Tests (TDD red→green when unparked):** prototype-by-name resolution;
    per-row value-bearing anchor mint; the mint-side cascade; per-batch
    journal + replay; no-promotion teardown; round-trip re-mint; census;
    undo/redo; the def-shaped protection (prototype names never ride
    `hooks.<name>`); the §7 scalar pins regression-suite (array hook writes
    still behave as VALUES — the discrimination pin).
12. **§7 pins disposition:** ENTRY (survives), PRECEDENCE (survives),
    CASCADE (survives host-scoped; the rows cascade is op-side), ROUND-TRIP
    (survives with the rows-as-data ruling), DISCRIMINATION (survives),
    layer-apply A5 (survives — the new op is a separate mint contract).

## 6. Cost-benefit summary

- **As stated (REJECT):** the §7-pin collisions are structural (ENTRY/
  DISCRIMINATION make the write surface a dead end for def-shaped
  prototypes; the round-trip TWO-shape divergence breaks the ONE-source
  pin; the E2E-3 walk cannot reach rows' consumers — the cascade claim is
  the feature's mechanism and it is absent). Zero consumer would notice the
  reject — no shipped page or demo expresses the need.
- **The workaround (baked rows via layer-apply):** ZERO cost, shipped and
  demoed (handlers-scenarios S1/S5 input-driven lists;
  `receiveNextState({children})`). Loses only per-row live bindings —
  unused today.
- **The adapted shape (if a revisit condition hits):** real cost — a new op
  union member (api.md §1/ops.md §1/serialize/journal ripples),
  `AnchorDecl.value`, runtime planning extraction, the mint-side cascade,
  the serialize-exclude + loadState re-mint round-trip, the no-promotion
  teardown, the undo branch, a red→green TDD set, a demo page + census/
  profile pins + the AGENTS.md item-4 profile watch, and tracker/spec/doc
  updates (items 3-8). Roughly 1.5-2× the §7 implementation — payable only
  by a real consumer.
- **Parking:** zero cost; the §3 revisit conditions + the §4/§5 amended
  shape are recorded so the future gate skips the re-litigation (the
  hooks-map-review §5→§7 precedent — this is exactly how the value-slot
  amendment was made cheap to land when the user directed it).

## 7. Tracker landings

- **`docs/pending.md`** (SPECULATIVE row — UPDATED): the hooks→array
  injection row's constraints are replaced by this review's §3 revisit
  conditions + §5 contract pointer.
- **`docs/next-steps.md`** (RESOLVED circle-back log — NEW row):
  hooks-array-injection three-agent gate resolved 2026-08-19 → PARK with
  the amended contract; reference `docs/specs/hooks-array-injection-review.md`.
- **`docs/decisions.md`** — deliberately NO row: nothing was decided; the
  §7 HOOKS row is untouched (its pins all survive).
- **`docs/defects.md`** — deliberately NO row: no defect found; the
  findings are structural-design facts, not defects.

## 8. Verification notes (load-bearing claims checked against code)

layer-apply mint + anchors veto (`dist/core/ops.js:153-178`); `AnchorDecl`
shape (`src/core/types.ts:224`); `LayerApplyOp` / `LayerMutation` unions
(`src/core/types.ts:150-167`); minted-set registry (`dist/core/registry.js:40-86`);
originLayer/runtimeMinted + promotion (`dist/core/node.js:315-327,637-641`);
applyHookSlice + reference-equality + clear path (`dist/core/node.js:1294-1335`);
removeLayer anchor removal (`dist/core/node.js:558-580`); E2E-3 consumer
walk host-scoped (`dist/core/supervisor.js:412-422`); state-slice branch
never registers minted nodes (`dist/core/supervisor.js:348-426` vs
`:549-573`); undo attach-only (`dist/core/supervisor.js:590-642`);
serialize ships children + anchor values (`dist/core/serialize.js:43-108`);
reverse exclusion keys on originLayer (`dist/core/translate.js:1066-1070`);
translate-time planning (`dist/core/translate.js:480-492,683-751`);
def prototypes per component Link (`dist/core/registry.js:44-63`);
`isDefShapedValue` arrays carve-out (`dist/core/resolve.js:48-55`); baked-row
children injection precedent (handlers.md §6, ops.md §2.8 OO-7);
hooks field shape pins (`translate.js:251-269,896-897`,
`serialize.js:173-180`, `hooks.test.ts`); `linkFor` name-keyed resolution
(`src/core/types.ts:258`, `translate.js:170-183`); prototype runtime
resolution precedents (`node.js:1518-1519`, `render-helpers.js:737-861`);
`hooks` never read at runtime (`supervisor.js:365-387`, `node.js:1268-1335`,
`resolve.js:48-69`); consumer-arm fan-out (`resolve.js:330-344`); loadState
no re-mint hook (`node.js:368-402`); serialize children+values
(`serialize.js:43-108`); batch-storage mirror collision (`node.js:1334`);
prototype-vs-authored provider competition (`resolve.js:70-79`).

## 9. CONTRACT AMENDMENT C — the kind-discriminated hook declaration (user directive 2026-08-19)

**User directive (2026-08-19):** the four rulings below amend the parked
§5/§6 contract. They are recorded as the governing design shape for the
array-injection extension; the implementation still awaits the user's
go-ahead (the §9.4 TDD list).

1. **Kind discriminator on the hook declaration** — the `hooks`
   declaration gains a property specifying whether a given hook is a
   `'placement'`, `'component'`, or some future option.
2. **Prototype-as-reference** — the component def node is NOT set as the
   hook target or data itself; it is a REFERENCE the external code using
   the hook passes INTO the mint.
3. **Consumer = React feature parity** — the consumers are not yet written;
   the feature is for feature parity with React (external-data-driven list
   rendering).
4. **Payload batching prevents double-serialization** — the minted set
   tracked by the batch (the layer-apply `result.minted` precedent) is the
   delimiter that ensures the rows serialize once, not twice.

### 9.1 Gate outcome (the two-step amendment review, 2026-08-19)

- **Validity (step 1): FEASIBLE WITH FURTHER CHANGES.** The four rulings
  collectively clear the two structural §7-pin collisions they target
  (ENTRY/DISCRIMINATION via rulings 1+2 — the write surface stays scalar,
  the prototype rides the op payload, never the value channel; ROUND-TRIP's
  in-process half via ruling 4 — the minted children serialize-exclude, the
  rows ship once). Ruling 3 answers the consumer objection as a directed
  mandate. What remains is the §5 contract's own change list (mint-side
  walk, no-promotion teardown, census/undo, the new op + `AnchorDecl.value`
  + runtime planning) PLUS one genuine new gap the rulings do not address —
  the round-trip re-mint's cross-process dependency on translate-time def
  prototypes (registry.js:78-86 keys prototypes by Link object identity,
  minted only at translate) — making it buildable only with the further §5
  changes, not as-stated.
- **Critique (step 2): VIABLE WITH CHANGES.** The rulings directionally
  answer the park verdict; three NEW underspecified holes must be pinned
  (the kind carrier shape, the batch storage cell, the consumer-arm compile
  multiplication) plus the surviving §5 items. All adopted below (§9.2).

### 9.2 The amendment pins (all adopted)

1. **KIND CARRIER — a NEW schema-known field, never a mutation of the
   shipped `string[]` contract.** `hooks: string[]` is pinned with
   THROW-level validation (serialize.js:173-180 — non-string member →
   `NodeSchema-shape-mismatch`), translate containment (translate.js:251-269),
   reverse (translate.js:896-897), tests (hooks.test.ts:84,99,107-110), and the
   demo envelope (demo/hooks-scenarios.js:244). The kind therefore lands as a
   SECOND schema-known field (`hooksKind: Record<string, HookKind>` — the
   `derived`/`handlers` precedent) with a NEW `hooks-kind-shape-invalid`
   containment, NOT as a change to the array members. **Explicit default
   ruling:** `hooks: ['theme']` with no `hooksKind` entry = implicit
   `'value'` (documented default, NOT a silent reclassification — a K4 note
   on the declaration with kinds present is optional, never required).
2. **KIND GATES OPS, NOT THE WRITE SURFACE.** The ENTRY gate keys off
   anchors + seam only (supervisor.js:365-387; applyHookSlice node.js:
   1268-1335; hookWriteGuard resolve.js:48-69 — none read `base.hooks`).
   The kind's load-bearing role is a near-zero-cost consult: a DECLARED
   non-value kind rejects a scalar `hooks.<name>` write with a new
   `hook-kind-mismatch` code; a value-kind (or undeclared) name keeps the
    shipped state-slice behavior; the rows-mint op validates its
    layerId against a DECLARED rows/component-kind entry
    (undefined / wrong kind → op rejected). Kind values: closed union
    `'value' | 'component' | 'placement'`; unknown → `hooks-kind-unknown`
    warn + skip (the shape-invalid discipline). **`'placement'` KIND
    SEMANTICS (user ruling 2026-08-19):** the `placement` kind IS DEFINED —
    it is the hook option that causes the mint to mint nodes with the
    SPECIFIED TARGET PLACEMENT + the components — i.e. the placement-kind
    hook mints family nodes (like component-kind) AND attaches them into a
    named target placement zone (the placement-attach/content-anchor
    surface), carrying their components; it is no longer declared-but-
    rejected. The component-kind = mint with components, no placement
    routing; the placement-kind = mint with components + routed to the
    specified target placement. (The op-shape, zone-target field, and veto
    interplay for the placement-kind are implementation-time pins —
    scenario-testing scope, see §9.7.)
3. **PROTOTYPE-AS-REFERENCE — the def node never rides the hook value
   channel.** The rows-mint op payload carries `prototypeName` (a NAME
   string, never def-shaped NodeData); the supervisor resolves
   `linkFor(name, 'component')` → `defPrototypesFor(link)`
   (registry.js:78-86; runtime precedent: materializeSeam node.js:1518-1519 +
   the emit-time def-fill render-helpers.js:737-861). This is what kills the
   `hook-seam-exempt` collision — the value slot stays scalar, so the
   DISCRIMINATION pin survives. **Prototype staleness pin (user ruling
   2026-08-19):** a `prototypeName` whose Link has no prototypes resolves
   `[]` → the rows-mint op FAILS WITH A WARNING (the named def cannot be a
   mint prototype → `rows-prototype-unresolved` warn + the batch is
   rejected; NEVER a silent zero-row mint, never a crash). **Provider-
   conflict ruling (user ruling 2026-08-19 — the recorded
   `rows-provider-conflict` is NOT a real failure mode):** components
   resolve to ONE value per consumer (nearest-wins single-value resolution,
   resolve.js:180-205 — the multi-hit fan-out at :330-344 is the pin-6
   COUNT cost, not a value conflict); placement zones are SHARABLE by
   placements of multiple payloads (that is the placement model's normal
   multi-payload zone sharing). The distinguishing invariant is PAYLOAD
   IDENTIFIER UNIQUENESS — each payload/batch must be uniquely identifiable
   so its minted set, teardown, and zone attachment are attributable.
   VERIFIED 2026-08-19: as recorded the batch layerId `hook-<name>-rows`
   is NOT node-scoped → **DEFECT #23** (mintedByLayer is module-level,
   mintedByOrigin scans by origin string, teardownMinted resolves through
   the global scan — two nodes minting under the same hook name collide on
   teardown). The row-wins/provider-wins precedence question is therefore
   RESOLVED: no precedence gate is needed; the conflicting-shape hazard is
   closed by unique payload identifiers (node-scoped layer id, DEFECT #23
   fix) + the single-value component resolution, and placement sharing is
   legal by design.
4. **BATCH-AS-DATA (payload batching) — the round-trip delimiter.** The
   minted children serialize-EXCLUDE (a serialize.ts page-92-class branch
   filtering origin-owned children in the `hook-${nodeId}-${name}-rows`
   namespace);
   the raw rows serialize ONCE as the batch record value; loadState
   RE-MINTS the batch from that value (loadState today has NO re-mint hook —
   node.js:368-402 materializes anchors only — the new branch is a §5 item).
   **Legacy-envelope save path ruling:** nodeToLegacy excludes origin-owned
   children (translate.js:1066-1070) and would ship the batch AS AN ARRAY
   BINDING VALUE with NO mint stage (translate never mints). RULED:
   envelope round-trips are rows-as-data (the mint is lost BY DESIGN —
   "rows are data, minted nodes are derived", §5 row 8); the serialized doc
   (which re-mints) is the fidelity path. The SSR-divergence class is closed
   by declaring this, not by guaranteeing envelope re-mint.
5. **BATCH STORAGE CELL — a first-class `batches` field, structurally
   mirror-exempt (OPTION C — user ruling 2026-08-19).** Every anchor-value
   cell is a hook-write mirror today (applyHookSlice mirrors `a.value =
   value` node.js:1334) — a scalar write to the batch's own name would
   REPLACE the rows if the record lived on an anchor. The batch record
   `{prototypeName, rows, layerId: 'hook-${nodeId}-${name}-rows'}` therefore
   lives as a new first-class `batches` field on `NodeBaseData` (`batches:
   Record<string, {prototypeName, rows}[]>` keyed by the hook name) — the
   `derived`/`handlers`/`hooks` precedent (~4 mechanical sites: baseFrom +
   `batches-shape-invalid` containment translate.js:251-269 mirror;
   serialize state.batches + loadState parse serialize.js:90-91/173-180
   mirror; nodeToLegacy re-emit translate.js:896-897 mirror). There is NO
   anchor for the record, so `applyHookSlice` has nothing to mirror onto and
   the collision is closed STRUCTURALLY, not by guard extension; the record
   never enters the provider walk (`providersOn` resolve.js:70-79 iterates
   `source`/`duplex` anchors only). The rows-mint op is the ONLY writer of
   the `batches[name]` entry (the kind gate §9.2 pin 2 rejects scalar
   writes to a declared component/placement kind). This is the ENTRY-pin
   collision in its final costume and is resolved here, not at
   implementation time.
6. **MULTI-PROVIDER COMPILE FAN-OUT — the feature's own scaling signature
   (the DEFECT #22-class shape, compile-side).** A name with N per-row
   providers yields N keyed arms per consumer (`#f:${owner.id}#${i}`,
   resolve.js:330-344), each recursively walking the row's own nested names
   (:354). N rows × consumers of a shared name = N compiled states per
   consumer. This is the demo page's raison d'être and it MUST be bounded,
   measured, and pinned BEFORE any demo ships — a new region/pass-2 baseline
   + the AGENTS.md item-4 watch (the per-batch journaling the review's §5
   row 6 pinned fixes only the WRITE side, not this compile side).
   **Mechanism (verified against code):** (a) `fitReference`
   (resolve.js:180-205) gathers ALL hits — page-scope resolution: node-own
   → descendant walk (`node.children` BFS) → ancestor walk, each via
   `providersOn` (resolve.js:70-79) collecting every `source`/`duplex`
   anchor of that name — so N rows minted under one shared name all land in
   the SAME `hits` array; (b) `continueArm` (resolve.js:328-344) then emits
   ONE branch per hit when `hits.length > 1` — each with a distinct key
   `#f:${owner.id}#${i}` (resolve.js:343) and its OWN bindings copy — and
   for each stepped owner resolves THAT owner's own `target`-role names
   recursively (`resolveNames(..., depth+1)` :354), so a row whose source
   chains to nested names multiplies AGAIN; (c) each arm's `keys` append to
   the node's pathKey (node.js:1117) → `cs.forkKey = cs.pathKey`
   (node.js:1122) → distinct `(wire, forkKey)` elements at the adapter
   boundary (render-helpers.js:46 `wireKey`, adapters.js:65/73). Cost
   surfaces: (1) COMPILE — N provider arms × per-arm nested-name recursion,
   and for a PLACEMENT-routed consumer this multiplies ACROSS path-states
   (compilePath node.js:1154; each `(node, owner-path)` pair × N arms — the
   d12/d14 fork-family shape is exactly this product);    (2) EMIT/DIFF — N
   distinct `(wire, forkKey)` create entries per batch, each diffed and
    emitted (render-helpers.js:123/157); (3) TEARDOWN/RE-MINT — the key
    embeds `owner.id` (module-level rotating id, node.js:20-24), so element
    identity is NOT stable across a re-mint. **CONTROL MECHANISM RULING**
    (user 2026-08-19): the minted nodes carry UNIQUE KEYS AS NORMAL (the
    standard module-level mint-id scheme node.js:20-24 — NO deterministic
    batch ids); the PAYLOAD is the association/control mechanism — the
    `batches[name]` record (Option C, the SINGLE handle — write/clear/read,
    §9.2 pin 8) + the minted-set registry
    (`mintedByOrigin(originLayerId)` registry.js:72-86, keyed by the batch's
    node-scoped `layerId = hook-${nodeId}-${name}-rows` — DEFECT #23)
    resolve the WHOLE minted set for teardown (a PAYLOAD-CONTROL op →
    `removeLayer('hook-${nodeId}-${name}-rows')` → the pre-detach
    predicates — the minting apparatus is INTERNAL, never addressed
    directly),
    rollback, replay idempotency (A3), and reverse-exclusion (`originLayer`,
    node.js:315-327) — the same OO machinery layer-apply already uses
    (ops.js:153-178). Element-identity churn across a re-mint is the ACCEPTED
    whole-batch-replace semantic (the receiveNextState children-injection
   precedent, pin 7); the deep-equality short-circuit (node.js:1326 fix)
   makes a same-rows re-write a true no-op (no re-mint at all — the payload
   check runs before any mint). **Bound-and-pin ruling:**
   (i) minted rows run the NORMAL mint-id scheme — unique keys, no
   deterministic ids; same-rows re-write = deep-equality no-op on the
   `batches[name]` record, changed-rows = whole-batch replace (fresh unique
   keys, the control payload re-pointed at the new minted set);
   (ii) a demo page MUST pin its own compile/emit/diff region totals + a
   fan-out census (states-per-consumer) against a fixed N — walk the
   `[derived-fork:pin]`-style region pins (AGENTS.md item 4) — because the
   fan-out is the feature's pricing and an unbounded N is the DEFECT #22/
   fork-stress blow-up signature in new clothes; (iii) the batch op applies
   ONE flush (target + minted + their consumers dirty once, the layer-apply
   precedent supervisor.js:569-571) — the fan-out is a COMPILE-count cost,
   not a write-amplification cost, and the pin's job is to keep it honest.
7. **Surviving §5 items (unchanged — the rulings do not touch them):**
   mint-side consumer walk (E2E-3 stays host-scoped for scalar writes,
   supervisor.js:412-422); no-promotion teardown override for the
   `hook-${nodeId}-${name}-rows` namespace (node.js:637-641 promotion would
   reverse-ship transient rows); census registration (layer-apply precedent
   supervisor.js:549-573); undo = a PAYLOAD-CONTROL op (clears/restores the
   `batches[name]` record → the node-scoped layer teardown) / redo =
   re-apply (undo implements only attach — supervisor.js:590-642);
   the `rows: []` clear contract (distinct from the B5 `{children: []}` no-op
   — an empty batch is a CLEAR, not sticky); re-write-on-same-layerId
   REPLACE semantics (distinct from layer-apply's same-layerId no-op —
   ops.js:155); reference-equality short-circuit fixed via deep equality
   (node.js:1326); empty-array ≠ undefined (node.js:1318-1324); element
   identity churn = whole-batch replace (the receiveNextState precedent);
   treeSig/PAR-5 re-baseline + census/profile pins when the demo ships;
   event dispatch for minted rows' handlers stays PARKED (rows are data,
   handlers stay authored).
8. **PAYLOAD-CONTROLLED TEARDOWN (user ruling 2026-08-19 — the control
   surface).** For the raw-data-array → placement/component hook method,
   deleting/teardown is controlled through the PAYLOAD, NOT the minting
   apparatus directly: external code operates on the `batches[name]` record
   (payload write → mint/replace; payload clear/remove → teardown; payload
   read → batch + minted set + round-trip source). `removeLayer` /
   `teardownMinted` / the minted-set registry are INTERNAL — the supervisor
   routes a payload-control op through them; no page/handler code addresses
   the layer id or the minted-set registry by hand. This keeps the payload
   as the SINGLE handle (write/clear/read) and preserves the ENTITY
   invariant of DEFECT #23 (node-scoped layer id under the payload API).

### 9.3 What the amendment resolves vs leaves open

- **Resolved:** ENTRY/DISCRIMINATION (rulings 1+2 — the op is the
  discriminator, the value channel stays scalar, the def node never rides
  it); the consumer objection (ruling 3 — mandated, motivation not shape);
  the in-process round-trip half (ruling 4 — serialize-exclude + loadState
  re-mint); the seam-teardown landmine (ruling 2 kills the def-shaped write).
   **User rulings 2026-08-19:** prototype staleness = FAIL WITH WARNING
   (`rows-prototype-unresolved`, never silent) on def resolution failure;
   rows-provider-conflict = NOT a real failure mode (components resolve one
   value; placement zones are shared by multiple payloads; the invariant is
   PAYLOAD IDENTIFIER UNIQUENESS — verified NOT unique as recorded →
   DEFECT #23, node-scoped layer id fix); the `'placement'` kind = the hook
   option that mints nodes with the SPECIFIED TARGET PLACEMENT + components;
   teardown/deletion = PAYLOAD-CONTROLLED (the `batches[name]` record is the
   single handle; the minting apparatus — removeLayer/teardownMinted/the
   minted-set registry — is internal, §9.2 pin 8).
- **Left open (recorded, not blocked):** the cross-process re-mint
  dependency on translate-time prototypes — **REVISIT IN SCENARIO TESTING**
  (user ruling 2026-08-19 — the serialized-doc fidelity path + enforcement
  of the fossilized cross-process behavior belong to the stress-test review
  loop (AGENTS.md item 11), not a design pin); the compile-side fan-out
  measurement (§9.2 pin 6 — the demo gate); the `'placement'`-kind
  op-shape/zone-target/veto details (implementation-time pins, scenario-
  testing scope — §9.7). The batch storage cell is RESOLVED — Option C, the
  first-class `batches` field (§9.2 pin 5, user ruling 2026-08-19).

### 9.4 TDD list (red → green when the go-ahead lands)

**IMPLEMENTED 2026-08-19 (the §9.4 list, user's go-ahead)** — see §9.8
for the landed shape, tests, and the demo-page item still open.

`hooksKind` field round-trip (baseFrom/nodeToLegacy/serialize/loadState) +
`hooks-kind-shape-invalid` + `hooks-kind-unknown` containment; the
`hook-kind-mismatch` write rejection; the rows-mint op (prototype-by-name
resolution, per-row value-bearing anchor mint via `AnchorDecl.value`, the
mint-side consumer walk, batch registration); per-batch journaling + replay
idempotency; the round-trip re-mint (serialized-doc path); the no-promotion
teardown; undo/redo (both via the PAYLOAD-CONTROL surface — the
`batches[name]` record is the single handle; never direct layer ops); the
`rows: []` clear + same-layerId replace pins; the
`rows-prototype-unresolved` FAIL-WITH-WARNING pin; the node-scoped batch
layerId (DEFECT #23 fix — `hook-${nodeId}-${name}-rows`); the `'placement'`-
kind mint-with-target-placement + components pin; the §7 scalar regression
suite (hook writes stay values); a demo page exercising BOTH sides of the
cascade (rows + cross-row consumers) with census + compile-fan-out profile
pins.

### 9.7 Scenario-testing scope (user ruling 2026-08-19)

The cross-process re-mint dependency on translate-time prototypes and the
`'placement'`-kind op-shape/zone-target/veto details are NOT design pins to
settle now — they belong to the stress-test review loop (AGENTS.md item 11):
frame scenarios for valid legacy-JSON data that exercise (a) a persisted
serialized doc whose batch must re-mint on load with a translate-time
prototype in a DIFFERENT translate pass, and (b) a placement-kind hook
minting rows into a named zone with components + the veto/loop interplay,
recording real-vs-expected output at each failure stage. The scenario/
probe/review agents verify against core + legacy JSON when the feature
ships.

### 9.5 §7-pins disposition (amended contract)

ENTRY (survives — writes stay via the managed channel; the kind consult is
additive), PRECEDENCE (survives — providerValueFor hook-first unchanged),
CASCADE (survives host-scoped; the rows cascade is op-side), ROUND-TRIP
(survives with the BATCH-AS-DATA + envelope-rows-as-data rulings, §9.2
pins 4-5), DISCRIMINATION (survives — ruling 2 keeps the value channel
scalar), the `hooks: string[]` field contract (survives — the kind rides
the NEW `hooksKind` field).

### 9.6 Tracker landings for the amendment

- **`docs/pending.md`** (SPECULATIVE row — UPDATED): the row's constraints
  now point at this §9 amendment (the kind discriminator, prototype-
  as-reference, parity consumer, batching delimiter + the §9.2 pins) +
  the §3 revisit conditions; the review status is PARK → AMENDED.
- **`docs/next-steps.md`** (RESOLVED row — UPDATED): gate resolved
  2026-08-19 → PARK with the amended contract + CONTRACT AMENDMENT C the
  same day; reference this document §9.
- **`docs/decisions.md`** — NO new row: the pins are recorded contract
  shape, not decided-and-shipped; the §7 HOOKS row + its pins all survive
  undeclared-amended (the consequential decisions land when implementation
  is directed).
- **`docs/defects.md`** — deliberately NO row: the amendment's findings are
  design facts, not defects.

### 9.8 IMPLEMENTED 2026-08-19 (the §9.4 TDD list, user's go-ahead)

The array-injection extension landed as pinned, red → green throughout
(tests/unit/hooks-array.test.ts, 24 tests, plus the §7 scalar regression
suite in tests/unit/hooks.test.ts — all unchanged and green):

- **Item 1 — the `hooksKind` field:** `HookKind` type +
  `hooksKind: Record<string, HookKind>` on `NodeBaseData`/`LegacyNodeData`
  (src/core/types.ts); baseFrom containment + `hooks-kind-shape-invalid` /
  `hooks-kind-unknown` (translate.ts); the reverse emission (nodeToLegacy);
  serialize/loadState/parseNodeState + template validation (serialize.ts);
  the implicit-`'value'` default pinned. 7 tests.
- **Item 2 — the `hook-kind-mismatch` gate:** the supervisor state-slice
  ENTRY gate rejects a scalar `hooks.<name>` write to a DECLARED
  `'component'`/`'placement'` name (`hook-kind-mismatch` on `ApplyErrorCode`
  + the node.applySlice defensive warn); `'value'`/undeclared writes are
  unchanged. 3 tests.
- **Items 3/4/5 — the `rows-mint` op:** `RowsMintOp` (types + StructuralOp
  union), the `rowsMint` executor (ops.ts): prototype-by-name resolution
  via `defPrototypesFor` (FAIL-WITH-WARNING `rows-prototype-unresolved`),
  per-row family mint with the row's fields as VALUE-BEARING source
  anchors, the NODE-SCOPED layerId `hook-${target.id}-${hookName}-rows`
  (DEFECT #23 — the collision is closed), PAYLOAD-CONTROLLED replace
  (same layerId = replace, never accumulation), the OPTION-C `batches`
  record on `node.batches[hookName]` (mutable runtime slot; serialize/
  loadState round-trip + schema validation), one journal entry per batch
  with `result.minted` (A3), replay idempotency via the replace pin, and
  the MINT-SIDE consumer walk (consumers of a row's field names dirty/
  pass2 — the cascade; the per-row multi-provider arm fan-out survives the
  flush). 8 tests.
- **Item 6 — payload-controlled teardown:** `RowsClearOp` +
  `rowsClear` (ops.ts) + `node.rowsTeardown` (the NO-PROMOTION override —
  rows never reverse-ship as authored; suppressed the survivor-promotion
  branch), delete-the-record teardown via the record's layerId, undo of a
  `rows-mint` = the payload-controlled teardown. 3 tests.
- **Item 7 — the `rows: []` CLEAR contract:** an empty rows batch clears
  the prior minted set + the record (distinct from B5). 1 test.
- **Item 8 — the `'placement'` kind:** a placement-kind rows-mint attaches
  a `content` anchor per row for the specified `placementName` (the
  consumer side of the shared per-name placement Link; the container side
  rides the existing `container`-anchor surface — no placement-path
  machinery added). 1 test.

**Validation trio GREEN:** 882 tests (43 files), typecheck clean,
demo:smoke OK (all demo checks pass; the fork-stress d12 totals within
bounds — no supervisor pass-2 pipeline blow-up from the new mint-side walk).
**Deferred to the demo-page gate:** the §9.2 pin-6 compile-fan-out
measurement + a data-authored demo page exercising BOTH sides of the
cascade (rows + cross-row consumers) with census + profile pins — the
pending.md SPECULATIVE row's remaining pre-ship work.
