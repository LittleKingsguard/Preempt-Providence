# Next Feature Batch — provident-ssr 0.2.0 (minor)

Plan for the four-feature minor batch (2026-08-24). Process per feature:
AGENTS.md item 9 (three-agent gate) → item 8 (TDD red→green) → item 4 (full
trio + profile watch) → item 6 (trackers) → item 10 (blind-test loop,
Mimo-2.5 — for the demo pages) → publish 0.2.0.

Dependency spine: **rows demo gate (1) UNPARKS Def-prototype round-trip (1a)**
— that is the batch's only hard dependency; 2/3/4 are independent and can run
in any order after 1.

---

## User rulings (2026-08-24 — the open design decisions)

| # | Decision | Ruling |
| --- | --- | --- |
| 1 | 1a serialization shape | **Registration name if available** — the def prototype serializes under the name it registers under (the component Link name); a name-less prototype is skipped (never serialized) |
| 2 | 1a round-trip scope | **b ADOPTED (2026-08-24 confirm)** — the defPrototypes section ships only when the graph holds registered def prototypes at serialize time; plain content-only docs never pay the section |
| 3 | 1a caveat flip | **CONFIRMED** — doc-carriage-conditional (§Feature 1a.3) |
| 4 | rows fan-out pricing bound | **a ADOPTED (2026-08-24 confirm)** — the LINEARITY tripwire (states-per-consumer ≤ k·N, k from the census + 2× headroom; `fan-out-blowup` warn code) |
| 5 | rows demo scenario data | **ELABORATED** (§Feature 1.5) |
| 6 | 1b identifier location | **a ADOPTED (2026-08-24 confirm)** — the declared `keyField` column on the rows-mint op + `batches[name].keyField` persisted; rows without the keyField value fall to the identifier-less whole-batch path |
| 7 | 1b collision handling | **duplicate-warn** — a duplicate identifier in one batch warns + keep-first (the placement-duplicate-reference precedent); never silent |
| 8 | 1b op shape | **re-mint-with-reuse** — the reuse update stays a rows-mint-family op (NOT a per-row state-slice); whole-batch-replace is the fallback for identifier-less rows |
| 9 | 1b per-row silent-abort | **yes** — trigger/relevance semantics apply per reused row (an irrelevant row's in-place update regenerates nothing) |
| 10 | 1b schema validation | **CLARIFIED** (§Feature 1b.10) |
| 11 | 1b no-promotion | **CLARIFIED** (§Feature 1b.11) |
| 12 | 2 simplified-doc carrier | **all valid input forms** — the surface accepts every valid carrier (raw source / legacy envelope / translated graph / serialized doc) and emits the simplified document from any of them |
| 13 | 2 surface | **a NEW RENDER ADAPTER — `MarkdownAdapter`** — converts the render surface to text-only markdown (the DomAdapter/SSRFragmentAdapter family; new § in adapters.md) |
| 14 | 2 delivery | **on request** — per-request option (host chooses the markdown adapter at emit), never embed-everything |
| 15 | 2 handler representation | **output is non-interactive text only** — no `on:*`/handler surface in the markdown output; handlers are dropped (text content only) |
| 16 | 2 traceability | **output is non-interactive** — no element→node mapping in the markdown document (data-node-id does not apply to the text-only output; the graph-canon host-side tracing stays the DOM/SSR surface) |
| 17 | 3 condensing trigger | **auto-trigger on config (default none)** — condensing fires automatically when a configurable `maxJournalLength` is set; absent (default) = never condenses |
| 18 | 3 base shape | **CONFIRMED (2026-08-24)** — the condensed base is a CAPTURE of the graph state after all prior ops (serialized-graph snapshot: node states + anchors + layers + batches + defPrototypes; NOT a re-execution) |
| 19 | 3 replay-from-base | **AMENDED (2026-08-24)** — undo not crossing the base is an IMPLICIT CONSTRAINT of the condense effect: an undo that would cross the base boundary WARNS + FAILS (never a silent no-op) |
| 20 | 3 journal rewrite mechanics | **see 3.19** — the base marker entry is the boundary; the warn+fail undo guard applies |
| 21 | 3 requestId/takePass2 | **CONFIRMED** — condensing never drains `takePass2States`; the requestId dedup TTL is untouched (dedup is process-local + bounded, independent of the journal) |
| 22 | 3 reset() companion | **defer** — "the condensed base is not reset-able by design" documented; the PARKED REQ-GAP-11 reset()/prune() row stays parked |
| 23 | 4 flag carrier | **layer field** — `preserveByReversal: true` on the layer; absent (none) defaults to no (the current exclusion behavior) |
| 24 | 4 reverse fidelity | **re-mint if loaded again from translated output** — a preserved node reverses as authored data; re-translate of that output builds it as a normal authored node (fresh mint, no layer tie) |
| 25 | 4 leak guards | **AMENDED (2026-08-24)** — the flagged layer COMPRESSES into normal node/graph data on reverse: the preserved subtree ships as ordinary authored nodes (no preserved form, no layer machinery, no flag residue) |
| 26 | 4 subtree scope | **CONFIRMED** — whole-subtree cascade (the 2026-08-15 ruling 5): every origin-owned node under a preserved layer reverses as deliberate edits |

---

## Feature 1 — Hooks array injection: the demo-page gate (+ its round-trip prerequisite)

**Status**: rows-mint machinery LANDED (2026-08-19, §9.4 TDD list — 24 tests,
hooks-array.test.ts): `hooksKind`, `rows-mint` op, prototype-by-name, Option-C
`batches` record, node-scoped `hook-${nodeId}-${name}-rows` layerId (DEFECT
#23), payload-controlled teardown (`rows-clear`), one journal entry per batch
with `result.minted`. **REMAINING pre-ship work** (hooks-array-injection-review
§9.2 pin 6 + §9.8): the compile fan-out measurement + a data-authored demo
page.

**Scope (this batch)**:
1. **Fan-out census pin** — measure the multi-provider compile fan-out
   (resolve.js:330-344) against a fixed N: per-consumer states-per-provider
   census + profile pins (the feature's pricing; unbounded N is the DEFECT
   #22-class shape). Test: hooks-array.test.ts fan-out block.
2. **Demo page** — data-authored page exercising BOTH sides of the cascade
   (rows + cross-row consumers) with census + profile pins; smoke-wired per
   designing-pages §12 (core-only page module, legacy-JSON envelope, function-
   STRING handler bodies — the blind-test writer rules).
3. **Round-trip completion** — "loadState re-mints the batch from the
   persisted value" (the ROWS-ARE-DATA pin) requires the def prototypes to
   exist at loadState time → **Feature 1a below is the prerequisite**.

**Feature 1.4 — fan-out pricing bound (ADOPTED: a)**: the census pins a
consumer resolving a row field — the compile fan-out is per-row provider
anchors on ONE link name (N anchors → up to N states per consumer at
compile). The bound is the LINEARITY tripwire: states-per-consumer ≤ k·N for
a small k (e.g. k=1.5×N + the identical-row arms), asserted by the demo page
smoke + a unit pin; the exact k is fixed by the census run (measure first,
pin the measured shape + a 2× safety headroom). A blow-up →
`fan-out-blowup` warn code (new) at compile, flagging the pricing breach
(mirrors the warn-code precedents) — the DEFECT #22-class exponential
signature trips it.

**Feature 1.5 — demo scenario data (elaboration)**: the demo page data shape
per the blind-test writer rules: a legacy envelope whose root declares a
`hooksKind` row hook (`'component'` kind — prototype-by-name), N rows (each
with an `id`-less natural field set — e.g. product rows with `name`/`price`),
the registered prototype (a def-shaped `template.component` value), and
CROSS-ROW consumers: nodes whose `component` bindings reference the row
field names (e.g. `name`) so the compile fan-out exercises all N provider
anchors; a values-style consumer; and a `placement`-kind variant page OR a
second hook on the same page (the battery pattern). Checks: census
(states-per-consumer ≈ N), rendered row count, per-row source values in the
DOM/SSR parity string, and the profile pins. The scenario doc feeds the
blind-test writer (docs-only authoring).

**Feature 1a — Def-prototype round-trip (UNPARKED by this batch)**:
- Parked row (2026-08-21): `defPrototypes`/`defRootPrototypes` keyed by
  translate-time Links; serialization carries only `NodeBaseData[]` → re-keying
  alone cannot work.
- Shape (already recorded): a `defPrototypes` section in `SerializedRenderDoc`
  + re-mint + registry registration at `loadState` (the seam machinery reads
  `defRootPrototypeFor`/`materializeSeam`).
- Gate: its own three-agent review (the reshape question: serialize the
  prototype NodeBaseData under the name they register under, vs re-register
  from the doc's component Links).
- TDD: serialize.test.ts + link-hub.test.ts round-trip block (rows survive
  serialize → loadState → re-mint; the `rows-prototype-unresolved` caveat in
  serialize.md §4 flips for round-tripped docs).

**Feature 1a.2 — round-trip scope (ADOPTED: b)**: the defPrototypes section
ships ONLY when the graph holds registered def prototypes at serialize time
(the `defPrototypes`/`defRootPrototypes` registry non-empty — which is
exactly "translate built defs", since the registry only fills at translate).
A plain content-only doc never pays the section. Seam-wired docs (a def-root
under a consumer) re-materialize after loadState because the re-minted
prototypes register on the LOADSTATE hub's component Links — the same
link-name space the seeds use — so `defRootPrototypeFor` resolves. The
section is: `{ name, node: NodeBaseData, isRoot: boolean }[]` (name = the
registration name per ruling 1; `isRoot` distinguishes def-root prototypes
from def children for the seam walk).

**Feature 1a.3 — caveat flip (CONFIRMED)**: serialize.md §4 currently pins
"rows-mint on a reseeded graph throws `rows-prototype-unresolved`". The flip
is DOC-CARRIAGE-CONDITIONAL: a doc whose defPrototypes section round-tripped
re-mints rows successfully (the prototypes exist on the loadState hub);
a graph re-seeded WITHOUT the section (hub-only reseed, or a doc serialized
before 0.2.0) keeps the throw. The §4 caveat text updates to state the
conditional (section present → re-mint works; absent → `rows-prototype-
unresolved`, documented behavior). The hub-threading rules (REQ-GAP-9 —
component-bearing docs go through `translateLegacy(doc, { hub })`) stay for
AUTHORED envelopes; the round-trip path is the SNAPSHOT path — the
defPrototypes section makes loadState a complete snapshot (graph + defs +
batches).

**Un-park effects**: after 1+1a land, **Keyed batch-reuse** (speculative row,
2026-08-19) becomes structurally ready (rides the same `batches[name]` +
`mintedByOrigin` machinery).

**Feature 1b — Keyed batch-reuse (INCLUDED in 0.2.0 — user ruling 2026-08-24)**:
- During payload updates, rows with an OPTIONAL identifier reuse the matched
  minted node in place (source values re-applied → the E2E-2 node-local
  cascade) instead of whole-batch teardown + re-mint; unmatched/absent rows
  mint-new / remove-missing; identifier-less rows keep the whole-batch-replace
  default; identical rows to the same reused node = deep-equality no-op (a
  REPLAY-CORRECTNESS requirement, not an optimization — replay re-runs
  rowsMint against the already-reused set).
- Element identity survives ((wire, forkKey) owner.id-stable) → the D5
  focus/blur + scroll-preservation closure.
- **USER RULING — reuse undo = restore the PRIOR state values** (not a no-op):
  the reuse-update journal entry records the PRE-OP row values per reused node
  (read off the existing minted source anchors at apply time, like the
  sliceLayers/hookUndo pre-op recording in 0.1.5); undo restores them in place
  (anchor.value = pre-op value + pass-2 dirtied). The ops.md §6 per-kind table
  gains: `rows-mint`-with-reuse → **EXACT inverse (restores the prior row
  values)**; plain rows-mint keeps the payload-controlled teardown row.
- **GATE COMPLETE (2026-08-24 — docs/specs/handoffs-review-6.md, PROCEED-AS-RESHAPED, LANDED):** the executor shape + the keyField carry are pinned by decisions D1-D14: D1 the O(N) reuse-match inside rowsMint (key = the minted node's `keyField` source-anchor VALUE, strict ===; per-id no-promotion teardown for remove-missing; layer decls REWRITTEN via addLayer — never removeLayer; reused nodes keep priority slots); D2 the identifier-less rule = WHOLE-OP DEGRADE (all-or-nothing, atomic, replay-correct); D3 keyField namespace validation (reserved construction keys → `batch-keyfield-invalid` warn + degrade); D4 stale-field PRUNE + shape-fields frozen on reuse (`rows-reuse-shape-ignored` warn); D5 within-input duplicates `duplicate-identifier` warn + keep-first; D6 op.keyField authoritative + a prototype/zone change degrades; D7 keyed `rows: []` = CLEAR; D8 keyed-reuse undo = re-apply `result.preRecord` (EXACT inverse; fresh ids for the removed half — identity-across-undo not a promise) + the per-kind table splits into plain vs keyed rows; D9 the preRecord is PRESERVED across the replay/redo result-refresh (undo-after-replay restores the PRE-op values); D10 result = minted (new-only) + reused + removed; D11 the per-row silent-abort carrier = the executor deep-equality no-op + the changed-set consumer walk; D12 the identity claim re-scoped to stable (wire, forkKey) ELEMENT identity (render.md D5 = the diff op, not the guarantee); D13 the serialize boundary rejects a non-string/empty record keyField (NodeSchema-shape-mismatch); D14 performance O(N) + one journal entry (+O(rows) preRecord on keyed entries). TDD LANDED: tests/unit/keyed-batch-reuse.test.ts (22 tests — R1..R17, red 17/5 then green 22/22); trio green 1110.
- Gate questions (from the speculative row): identifier location (declared column in the batch record vs a row-shape `id`/`key` convention), collision/duplicate-row handling (keep-first), the per-row silent-abort trigger semantics, the no-promotion teardown interplay (a reused node is never promoted — origin marker stays), and the round-trip identity carry (Feature 1a must persist the identifier column so a post-restore update reuses the re-minted node).

**Feature 1b.6 — identifier location (ADOPTED: a — the declared `keyField`)**: the
optional per-row identifier is a DECLARED COLUMN NAME on the batch record
(`batches[name].keyField: string` — the rows-mint op accepts an optional
`keyField`; every row's `keyField` value is its identifier). Rationale: avoids
colliding with a data field a host already named `id`/`key` (a product catalog
legitimately has an `id`), lets hosts use any natural key (`sku`, `slug`), and
is explicit in the op shape + the journal entry. Rows without the keyField
value (absent/undefined) fall to the identifier-less whole-batch path (ruling
8). The row-shape `id`/`key` convention (b) is rejected — it steals the field
names and can misidentify rows whose data includes an `id`.

**Feature 1b.10 — schema validation (clarified)**: the question was whether
the identifier mechanism needs a `hooksKind`-style validation/containment
surface. Clarified scope: the `keyField` (carrier (a)) is a NEW schema-known
field on the rows-mint op + BatchRecord — its containment mirrors the
`hooksKind` precedent: a non-string/empty `keyField` → `batch-keyfield-
invalid` warn + the op degrades to the identifier-less whole-batch path
(never a throw, never a partial reuse); a row whose keyField VALUE is
absent/undefined → identifier-less (whole-batch path for that row's
membership); duplicate identifiers within ONE batch → `duplicate-identifier`
warn + keep-first (ruling 7). The round-trip carries `keyField` in the
BatchRecord (serialize §4 + the 1a defPrototypes section coexist).

**Feature 1b.11 — no-promotion (clarified)**: the pin says a reused node is
NEVER promoted — its originLayer marker stays, so it remains
reverse-excluded and teardown-controlled by the batch record. Clarified
scope: (i) a node reused across MANY updates never becomes authored —
promotion stays out of scope (no opt-in flag this batch; a future
promotion feature is a separate gate); (ii) remove-missing (a row absent
from the input) DESTROYS the reused node via the batch teardown machinery
(rowsTeardown — the node's minted set entry dies with it); (iii) the reuse
of a node does NOT reset its minted key (the (wire, forkKey) identity is
the D5 guarantee — the minted id is never re-minted, only its source values
change).

---

## Feature 2 — Simplified output document surface for agentic consumers

**Status**: speculative (recorded 2026-08-23, user note — the mode-toggle
"markdown mode" production rationale). **SHAPED by the 2026-08-24 rulings**:
- **Carrier (ruling 12)**: ALL valid input forms — the surface accepts the
  legacy envelope, a translated graph, and a serialized doc alike; the
  adapter converts the render surface to text-only markdown regardless of
  which input produced it.
- **Surface (ruling 13)**: a NEW RENDER ADAPTER — `MarkdownAdapter` — in the
  DomAdapter/SSRFragmentAdapter family (adapters.md gains its § section: the
  adapter contract, ops mapping, the PAR-5 parity letter extension). It
  implements the RenderAdapter interface (createEl/setProp/appendChild/
  removeEl/toString) and emits **markdown text**, not HTML.
- **Delivery (ruling 14)**: on request — the host chooses the adapter at emit
  (the `renderProducingProcess(…, adapter)` seam already exists); never the
  embed-everything pattern.
- **Handlers (ruling 15)**: the output is NON-INTERACTIVE text only — `on:*`
  handler props are dropped (the markdown text carries the content, never
  event surfaces); text/structure map to markdown constructs (headings,
  lists, emphasis, links from `href` props).
- **Traceability (ruling 16)**: the output is non-interactive — NO
  element→node mapping in the markdown document; `data-node-id` stays a
  DOM/SSR-only concern (the agent's element→node tracing uses the host-side
  index on those surfaces).

**Landing (post-gate)**: `MarkdownAdapter` + adapters.md § + a demo page
(blind-test loop) + smoke wiring; the `?mode=markdown` demo fixture stays a
demo (the adapter is the production shape).
**GATE COMPLETE (2026-08-24 — docs/specs/handoffs-review-7.md, PROCEED-AS-
RESHAPED, LANDED):** decisions D1-D15 pin the adapter contract: D1 toString is
a concrete-family method (the markdown + SSR text family) + hydrate is a
required no-op + no styles; D2 `fragments` is the sole toString source;
D3 the type→marker table (h1-6/ul/ol/li/strong/em/a/blockquote/code/pre/hr/
br/img; div/span/section/article/unknown = transparent containers; createEl
type authoritative over prop:type); D4 parent-based list markers (ul→'- ',
ol→sibling-index '1. ', 2-space nesting); D5 emphasis from element TYPE only
(css:classes/css:style dropped, never parsed); D6 links ([text](href),
[text](href "title"), bare text without href); D7 on:* + data:* dropped (incl.
the opt-in data:node-id); D8 appendChild splice-by-identity + removeEl DETACH
(the DEFECT-SSR-REMOVE shape); D9 content metacharacter escaping (markers
unescaped); D10 instance-bound prevMap (adapter switch = fresh/null prevMap,
never silent empty); D11 empty doc → ''; D12 the markdown adapter is a NEW
parity family, NOT a PAR-5 extension (round-trip/identity pin only); D13 the
src/index.ts barrel export + contract.md row (module compiles without the
"DOM" lib); D14 the demo page + smoke wiring + the Mimo-2.5 blind-test loop;
D15 the carrier-agnostic clause re-framed as a renderer/seam property (the
adapter is a pure op-stream consumer). TDD LANDED: tests/unit/
markdown-adapter.test.ts (20 tests, red 20 → green); trio green 1136.

---

## Feature 3 — Journal condensing (bounded journal for long-lived hosts)

**Status**: speculative (2026-08-21). The replay/redo growth half is already
CLOSED (no-journal mode, 0.1.5); the LIVE-apply growth (the host's own op
stream, O(total-ops) append-only) remains the trigger. **Shaped by the
2026-08-24 rulings**: trigger = auto on a configurable `maxJournalLength`
(absent/default = never — ruling 17); requestId/takePass2 non-interference
CONFIRMED (ruling 21); reset() companion DEFERRED ("the condensed base is
not reset-able by design", ruling 22).

**Feature 3.18 — base shape (CONFIRMED: a graph-state capture)**: the
condensed base — the "everything before" snapshot — is a CAPTURE OF THE GRAPH
STATE AFTER ALL PRIOR OPS, in the serializeSlice/loadState class: node states
+ anchors + layers + the `batches` records + the defPrototypes section
(Feature 1a — the base composes with the round-trip work; a base that covers
rows-bearing graphs needs the defs too). It is a capture of the RESULTING
state, NOT a re-execution of the ops (the ops were already applied; the
snapshot records what the graph looks like after them). The re-executed-op-
summary alternative is rejected: ops re-run against a live graph cannot
capture handler bodies, layer stacks, or the batch records cleanly, and the
summary shape does not compose with the 1a round-trip. The base is NOT
replayable entry-by-entry (recorded contract).

**Feature 3.19 — replay-from-base + the base-boundary undo guard (AMENDED)**:
`replay()` with a condensed journal: the base marker triggers a BASE RESTORE
(the snapshot re-applied to the live graph: the serialized node states +
anchors + layers + batches + defs re-registered on the supervisor — the
loadState machinery plus the supervisor registration steps) and then the
POST-BASE entries re-apply no-journal with their existing sliceLayers/minted
gates (0.1.5 machinery, unchanged). The stale-base question: replay's
contract is to reproduce the journaled stream state — the base snapshot IS
the stream prefix, so the restore + post-base re-apply reproduces the full
stream exactly; the host's post-condense live mutations are by definition
stream replay (they are the post-base entries). **Undo cannot cross the base
— an IMPLICIT CONSTRAINT of the condense effect: an undo that would cross
the base boundary WARNS + FAILS (a `base-boundary` warn; the undo attempt is
rejected, never a silent no-op, never a partial restore).** The undoStack
truncates to post-base entries at condense time, so the crossing attempt is
only reachable through a stale/external reference — the guard makes the
boundary explicit rather than silently dropping the request.

**Feature 3.20 — journal rewrite mechanics (see 3.19)**: on condense the
journal array rewrites: the pre-base entries are REPLACED by ONE base marker
entry (id continues the `journal-<seq>` scheme; `op: {kind: 'base',
snapshot: <the serialized snapshot>}` — the snapshot is carried INLINE in
the entry since the journal is process-local and never serialized, keeping
one self-contained structure; the alternative — a sidecar field — is
rejected at the baseline: it splits the journal's state across two places
and breaks the replay loop's uniform entry walk). The `undoStack` truncates
to the post-base entries (3.19); `redoStack` clears. Replay sees the base
marker and restores. **The base marker is the boundary: any undo crossing it
warns + fails (3.19 — the guard applies to the marker entry itself and to
any stale reference before it).** `maxJournalLength` is checked after each
applied op (O(1) length compare); the condense itself is O(journal length)
once — a single synchronous pass (acceptable: condensing is rare and
host-triggered by config, never in the hot path).

**TDD**: journal-condensing.test.ts (base creation, undo-crossing rejection,
replay-from-base, threshold trigger, requestId-dedup non-interference,
takePass2States non-drain, base-marker replay uniformity, rows-bearing base
round-trip).

---

## Feature 4 — Layer preservation-by-reversal flag

**Status**: NOT-YET (user ruling 2026-08-15, legacy-handler-reuse-review §11).
Origin-owned nodes created under a PRESERVED layer reverse as deliberate
edits (not excluded) — the reverse-exclusion marker (originLayer/runtimeMinted)
is the current behavior; the flag is its opt-in override. **Shaped by the
2026-08-24 rulings**: carrier = a LAYER FIELD (`preserveByReversal: true`,
absent defaults to no — ruling 23); reverse fidelity = the preserved node
reverses as authored data and RE-MINTS when the translated output is loaded
again (re-translate builds it as a normal authored node, fresh mint, no
layer tie — ruling 24); subtree scope = WHOLE-SUBTREE cascade CONFIRMED
(ruling 26 — every origin-owned node under a preserved layer reverses as
deliberate edits).

**Shape (recorded)**: ONE override site — the reverse filter in
`nodeToLegacy` (translate.ts:1074, the M1 "preservation override = ONE site"
note); the flag lives on the layer (a preserved layer's origin-owned nodes
ship in reverse as authored edits, re-translate reproduces them).

**Feature 4.25 — leak guards (AMENDED: the flagged layer COMPRESSES into
normal node/graph data)**: the preserved layer's subtree reverses as ORDINARY
AUTHORED NODES — the flagged layer is COMPRESSED into normal node/graph data
in the reversed document: the current compiled state only (content/props/
type/css), no preserved form, no layer machinery, no flag residue. The
guards:
1. **handlers-CLEAR / slice-* rules**: a preserved node must NOT resurrect a
   cleared handler or a slice-* layer — its reversed `handlers`/props reflect
   the CURRENT compiled state (the same source the non-preserved reverse
   uses); the preservation changes ONLY the exclusion (ship vs skip), never
   the reversed content shape.
2. **auto-mint-exclude (DEFECT #28)**: a preserved node must not ship a
   minted `props.id` — the authored-id rules apply (an authored id ships, the
   mint pattern stays excluded; a preserved node whose only id is the mint
   reverses without one and re-mints on re-translate).
3. **re-translate re-mint**: the compressed authored node is plain authored
   data — re-translate builds it fresh (ruling 24); it must NOT re-attach to
   the preserved layer (the flag is a runtime layer property, never
   serialized, never shipped — layers stay runtime-only).
4. **round-trip**: the flag never enters the serialized doc (layers are
   runtime-only; serialize.md §4 untouched by this feature).

**Gate questions (residual)**: the flag's interaction with the
reverse-of-clear + REVERSE-OF-CLEAR letters (the preserved node ships the
CLEARED state — content-current only — verified by the gate), and whether
`removeLayer` on a preserved layer tears down normally (it does — the flag
only affects REVERSE, never teardown; the whole-subtree cascade ruling 5 of
2026-08-15 stands).

**No un-park effects** (self-contained; does not touch the parked undo
fact-sets — reverse is translate-side, undo is journal-side).

---

## Un-park review (parked items touched by previous or planned changes)

| Parked item | Un-parked by | Action in this batch |
| --- | --- | --- |
| **Def-prototype round-trip** (serialize + re-mint def prototypes through loadState) | **Feature 1** — the rows round-trip pin ("loadState re-mints the batch") requires def prototypes to exist at loadState time | JOINS THE BATCH as Feature 1a (its own gate + TDD) |
| **Keyed batch-reuse** (speculative) | **Feature 1 structurally** — rides the same `batches`/`mintedByOrigin` machinery | JOINS THE BATCH as Feature 1b (user ruling 2026-08-24: reuse undo = restore prior state values; its own gate + TDD after 1a+1) |
| **`Supervisor.reset()`/`prune()`** (REJECTED shapes) | **Feature 3 conditional** — condensing's "base teardown companion" question | DEFER with a documented "the condensed base is not reset-able by design" note (does not create the explicit host request the revisit condition needs) |
| Event-dispatch Phase C (MCP ENDPOINT) | NOT unparked (consumer-hosted) | Feature 2 shares the agentic-consumer narrative; Phase C stays outside the package |
| Externally-exposed hooks SESSION half (seam-landing rule) | NOT unparked | stays parked |
| forkKey-on-retyped / Placeholder / Set-op batching / RENDER_PROCESS_NOTES fold / Pillar A–G fold | NOT unparked | stays parked |

---

## Batch order + gates

The 2026-08-24 user rulings (§User rulings above) resolve ALL the shaped
questions (1a.2=b, 1a.3 flip, 1.4=a, 1b.6=a, 3.18 capture, 3.19/3.20
base-boundary warn+fail, 4.25 compression). The remaining gate decisions are
the residual Feature 4 reverse-of-clear verification + the per-feature
implementation shapes.

**Feature 1a GATE COMPLETE (2026-08-24 — docs/specs/handoffs-review-5.md,
PROCEED-AS-RESHAPED):** the full-state section is superseded by a CENSUS
section — `defPrototypes?: { name, nodeId, isRoot }[]` — whose prototype
STATE rides `content` (the status quo transport; prototypes already ship
there today), and the loadState-side "re-mint" becomes a RE-REGISTRATION of
the already-seeded instances (`reRegisterDefPrototypes(doc, hub)` — zero
construction → the single-instance rule is structural). Reshapes verified:
names recovered from the registry Link anchors at serialize (G2); instance-
membership reachability (R3'); seam-anchor strip on prototype-state content
entries (C2); roots-before-children + the post-seed 'prototype' tripwire
(C3/C5); the C1 operational answer — loadState stays pure, the HOST drives
one rows-mint per `batches[hookName]` record after registration (records
seed, layerId round-trips, replace-in-place); N1 corrected — the AUTH-SEAM
adoption structure survives the round-trip, only the phase-handler BODIES
stay runtime-only. TDD: 10 red tests in a NEW `tests/unit/def-roundtrip.test.ts`
(no serialize.test.ts exists). Contract + notes: review §Contract/§TDD/§Notes.

1. **Feature 1a (Def-prototype round-trip)** — gate ✅ → TDD (def-roundtrip.test.ts, 10 red) → trio (prerequisite; unblocks Feature 1's round-trip checks).
2. **Feature 1 (rows demo gate)** — fan-out census ✅ (measured ratio 1.0, bound ≤ 2N; `isFanOutBlowup` tripwire + `fan-out-blowup` warn landed — tests/unit/rows-fanout.test.ts) → demo page ✅ (rows-scenarios.* — 8 rows, cross-row consumers, the round-trip re-mint arm, `[rows:profile]` linearity pins; smoke wired; 10 checks green) → trio ✅ (1055 tests, typecheck, build, SMOKE OK). **BLIND-TEST LOOP PENDING (AGENTS.md item 10 — Mimo-2.5 model required for the writer/proofreader/page-reviewer pass)**.
3. **Feature 1b (keyed batch-reuse)** — gate ✅ (handoffs-review-6.md PROCEED-AS-RESHAPED, D1-D14) → TDD ✅ (keyed-batch-reuse.test.ts, 22 tests) → trio ✅ (1110 tests, typecheck, build, SMOKE OK) — **LANDED (the executor shape + keyField carry + the split undo table)**.
4. **Feature 2 (MarkdownAdapter)** — gate ✅ (handoffs-review-7.md PROCEED-AS-RESHAPED, D1-D15) → TDD ✅ (markdown-adapter.test.ts 20 + markdown-adapter-guardrails.test.ts 11, trio green 1147) + **ADVERSARIAL-MD fix round COMPLETE (S17/S1/S2/S3/S4/S5/S6/S8)** → **DEMO PAGE + BLIND-TEST COMPLETE (2026-08-24: markdown-adapter-scenarios 7 checks M1-M7; MD-BLIND-TEST-TEXT fixed pre-loop)** → **REVIEW RESOLUTIONS (2026-08-25): D14 mode-toggle MarkdownAdapter arm LANDED (feature-matrix doc through the real adapter — `renderFeatureMatrixMarkdown()`; mode-toggle markdown 14 checks) + MD-PRE-ESCAPE FIXED (fence content literal) + MD-INLINE-FILTER FIXED (inlineContent pulls true inline only) — trio green 1153** — **Feature 2 FULLY LANDED.**
5. **Feature 3 (journal condensing)** — gate ✅ (**PROCEED-AS-RESHAPED, handoffs-review-8.md D1-D10, 2026-08-25**) → **TDD ✅ (journal-condensing.test.ts, 16 tests; trio green 1169)** → **ADVERSARIAL pass + fix round COMPLETE (2026-08-25: 5 engine defects — S11/S19 CRITICAL replay/redo op.target id-resolve, S4 replay clears redoStack, S5 quiet restore re-mint, S12 graph-filtered condense protoSet, S20 clone-instance loss documented; ADV-S11/S19/S4/S5/S12 tests; trio green 1174)** — **LANDED (engine + guardrails); the D14 demo arm + blind-test loop PENDING (AGENTS.md item 10)**.
 6. **Feature 4 (preservation flag)** — gate ✅ (**PROCEED-AS-RESHAPED, handoffs-review-9.md D1-D8, 2026-08-25**) → **TDD ✅ (preserve-reversal.test.ts, 11 tests; trio green 1185)** — **LANDED (engine); the D14 demo arm + blind-test loop PENDING (AGENTS.md item 10)**.
7. **Publish 0.2.0** + trackers sweep (decisions.md rows ×5, pending.md
   LANDED moves, next-steps.md RESOLVED, designing-pages §11/§12,
   adapters.md §MarkdownAdapter, ops.md §6 base-boundary row) + HANDOFF-6
   note if the consumer battery surfaces follow-ons.