# Feature 1b — Keyed batch-reuse (three-agent gate, step 3 — change-analysis)

Date: 2026-08-24. Source: `docs/next-feature-batch-0.2.0.md` §Feature 1b +
§User rulings 6-11 (2026-08-24), the un-park row (2026-08-19, structural
un-park), the ADVERSARIAL-CENSUS fix pass (rows-mint-guardrails.test.ts).
Companion context: `docs/specs/handoffs-review-5.md` (Feature 1a — the
round-trip carry is 1b's precondition), `docs/specs/ops.md` §6 (the per-kind
undo table), `docs/specs/hooks-array-injection-review.md` §9.4 (the Option-C
batch record), `docs/specs/serialize.md` §3/§4 (the rows re-mint recipe + the
minted-id-instability residual).

Steps 1 (validity — 22 findings, V1-V22) and 2 (critique — 25 findings,
C1-C25) ran before this pass; the step-3 verdict lands here in the
compile-horizon-review format. This agent is READ-ONLY — no files edited
except this verdict. Baseline: the working tree carries the landed 1a+1 +
ADVERSARIAL-FIX-PASS (rows-mint-guardrails.test.ts, 25 tests; decisions.md
FIXED rows, 2026-08-24 trio green 1088). Not re-run here (verdict-only pass).

## Step 1 — Validity agent (summary)

Verdict: FEASIBLE-WITH-RESHAPE. The keyField carrier (ruling 1b.6), the
duplicate-warn keep-first (1b.7), the re-mint-with-reuse op shape (1b.8), the
per-row silent-abort (1b.9), the containment + round-trip carry (1b.10), and
the no-promotion pin (1b.11) are all implementable against the current
`rowsMint`/`rowsClear`/`rowsTeardown`/`batches` machinery. Must-fix
underspecifications: the exact-inverse halves (what undo restores for a
reuse op's add/remove halves), record rewrite vs undo (the current rows-mint
undo assumes the op CREATED the batch — a reuse op UPDATED it), the replay
result-refresh corruption (the in-place `entry.result = res` refresh would
clobber the pre-op facts), the identifier-less semantics contradiction
(whole-op vs per-row), the keyField namespace (reserved construction keys),
stale-field semantics (prune vs replace-set), the duplicate-key outcome
(within-input vs vs-existing), value identity (=== vs node identity), keyField
precedence (op vs record), the keyed `rows: []` contract, positional arm
identity (family order stability), the per-row silent-abort carrier, and
atomicity (a mixed batch must not partially reuse).

## Step 2 — Critique agent (summary)

Verdict: NEEDS-RESHAPE. Must-fix: the replay refresh clobber, the add/remove
halves, positional arm identity vs the D5 claim, non-anchor field divergence
(the reused node's OWN compiled state — source anchors alone are not the row
node's self-state), the keyed `rows: []` dual contract, the silent-abort
carrier, and the destroyed fact-sets (remove-missing destroys — undo needs the
fact-set). A-big: key collision, value identity, keyField precedence, the
O(N²) match + journal-growth risk, prototype change on re-mint, the
identifier-less contradiction, record restore, keyField reserved names, the
per-row teardown primitive, and `result.minted` semantics. Questions: the D5
mis-citation (path-state vs fork-arm identity), replay gating, degraded
observability (what the result exposes), the serialize-boundary keyField, the
reused self-state, the Feature-3 base interaction, mixed undo contracts, and
the blind-test process gap.

## Step 3 — Change-analysis agent (verdict)

Status: **PROCEED-AS-RESHAPED** — the proposal and the six user rulings are
sound and implementable, but the executor must land with the reshaped shape
below. Every must-fix and every open question resolves to a concrete decision
(§Feasibility verdict, decisions D1-D14). The two largest reshapes: **(D2) the
identifier-less rule is WHOLE-OP DEGRADE** (the keyed path is all-or-nothing;
a single key-less row or any keyField/record inconsistency downgrades the WHOLE
op to the status-quo plain replace — this is what makes the op atomic and
replay-correct), and **(D8) the keyed-reuse undo is a re-APPLY of the pre-op
record through the same keyed executor** (journaled as `result.preRecord`;
restores the record + every reused node's values + destroys the mint-new half
+ re-mints the removed half), with **(D9) the preRecord preserved across the
replay result-refresh** (the in-place `entry.result = res` must not clobber
it). All six user rulings stand unmodified as the fixed contract; D1-D14
pin the mechanics the rulings left open.

### What the proposal asks

During payload updates, rows carrying an optional declared identifier
(`keyField` — a column on the rows-mint op + the `batches[name]` record,
ruling 1b.6) reuse the matched minted node in place — source values re-applied
(the E2E-2 node-local cascade) — instead of whole-batch teardown + re-mint;
unmatched keys mint-new, absent keys are removed (teardown), identical rows are
a deep-equality no-op (replay-correctness), and the minted node id stays stable
so the (wire, forkKey) element identity survives the update (the D5 focus/blur
+ scroll-preservation closure). Reuse undo = restore the PRIOR state values
(not a no-op) — ops.md §6 gains `rows-mint`-with-reuse → EXACT inverse; plain
`rows-mint` keeps the payload-controlled teardown row.

### Feasibility verdict — the executor shape + the keyField carry (all 14 decisions)

**The keyField carry (as decided by ruling 1b.6/1b.10, verified against the
code).** `RowsMintOp` gains `keyField?: string` (types.ts:168-180); `BatchRecord`
gains `keyField?: string` (types.ts:202-208). The record rides `serializeNode`
via the existing `state.batches = {...node.batches}` + `assertJsonSafe`
(serialize.ts:151-157) — the carry is free once the field is on the record. The
round-trip precondition is Feature 1a's re-registration + the host's step-4.5
rows-mint per record (serialize.md §3); the host passes the record's `keyField`
through to the re-mint op. The row's keyField VALUE is read from the row data
(an absent/undefined value → the row is identifier-less, D2). The keyField is
NOT allowed to collide with the reserved construction keys (D3).

**D1 — the reuse-match algorithm.** Lives INSIDE `rowsMint` (ops.ts:211), in
the replace branch, after the existing S3 rows-shape validation and the
`rows: []` clear branch. Keyed path:
1. Capture `preRecord = batches[hookName]` (the undo fact-set, D8).
2. Build `existing: Map<keyValue, Node>` in **O(N)** from `mintedByOrigin(layerId)`
   (ops.ts:342 precedent — the same source rowsClear reads), reading each node's
   `source` anchor named `keyField` (`a.role === 'source' && a.target === keyField`
   → `a.value`). A minted node lacking that anchor is unmatchable → remove-missing.
3. **remove-missing** = existing keys ∉ the input key set → per-id teardown
   (a small internal helper mirroring the `rowsTeardown` body (node.ts:764-773)
   for a SUBSET: `detachNodeSafe(node)` + `node.originLayer = undefined` +
   `unregisterMinted(id)`; the sweep cascade-destroys — the 1b.11(ii) letter;
   the C-big "per-row teardown primitive"). NEVER the whole-layer
   `rowsTeardown`/`removeLayer` — `removeLayer` triggers the PROMOTING
   `teardownMinted` (node.ts:677), which would promote the reused rows
   (1b.11(i) violation).
4. Per input row in order, duplicate keys keep-first (D5): key in `existing`
   → **REUSE** (D4 reconcile); else → **MINT-NEW** (the existing per-row mint
   path — fresh id, child anchor appended at max+1, source anchors, originLayer,
   registerMinted).
5. The batch layer decls are REWRITTEN via `target.addLayer({id: layerId, ...})`
   (addLayer REPLACES same-id in place, node.ts:639-641 — never `removeLayer`).
   Reused nodes keep their existing priority slots; mint-new append at max+1
   (positional arm identity, below).
6. Rewrite the record: `batches[hookName] = { prototypeName, rows: op.rows,
   layerId, mintKind, placementName?, keyField }` (keyField written ONLY when
   the keyed path ran — D2).
7. Return `{ minted: mintNewIds, reused: reusedIds, removed: removedKeys,
   layerId, preRecord }`.

**The equality predicate** (both for the key match and the update no-op):
- KEY match: strict equality on the keyField VALUE (`===`; JSON-safe values by
  the `assertJsonSafe` S16 boundary, so no NaN/function edge) — **value
  identity, never node identity** (V/C "value identity"). A key VALUE change =
  a new key → old node remove-missing, new node minted (honest).
- UPDATE no-op (replay-correctness, 1b.142-144): the row's flat field set is
  compared to the node's current source-anchor values by deep JSON equality
  (stable, safe — the S16 boundary) — identical ⇒ skip the anchor rewrite, the
  node is NOT in the changed set, its consumers are not marked (the D11
  silent-abort). **Value-type rule:** a valid key is a primitive
  (string|number|boolean); an object/array key value is treated as absent
  (identifier-less → D2). No O(N²): the match is one map build + one map
  lookup per row.

**Positional arm identity** (V/C must-fix): reused nodes keep their family
priority slots; the childOrder of the reused rows is untouched across updates
(no re-append churn — the render.md D5 diff sees a stable childOrder); mint-new
rows append at the end; remove-missing slots vanish. PIN.

**D2 — the mixed-keyed/key-less batch rule: WHOLE-OP DEGRADE (pinned).** The
keyed path runs IFF — checked UP FRONT before any mutation (atomicity, S3
precedent) — ALL of: (a) `op.keyField` is a non-empty string NOT in the
reserved construction-key set (D3); (b) EVERY row in `op.rows` has a primitive
keyField value; (c) the existing record (if any) carries `keyField === op.keyField`
AND `prototypeName === op.prototypeName` AND `placementName === op.placementName`
(D6); (d) the batch is non-empty (empty = the D7 clear). ANY failure → the
status-quo PLAIN path (whole-batch `rowsTeardown` + `removeLayer` + fresh mint;
the record is written WITHOUT keyField — the identity space is gone, so the
record reflects the plain path). Rationale: (i) atomicity — a mixed batch that
partially reuses/partially tears down is a non-atomic write (the S3 letter); a
mixed batch is a DATA-AUTHORING error the op rejects by degrading, never by
half-applying; (ii) replay-correctness — per-row mint-fresh for key-less rows
would mint a FRESH node on every replay (rows-mint has no replay gate; the
no-accumulation pin, hooks-array.test.ts:394-403, would break); whole-op
degrade is idempotent-by-replace exactly like today; (iii) ruling 8's wording
("whole-batch-replace is the fallback for identifier-less rows"). The per-row
alternative (REJECTED) needs a new replay gate and a per-row teardown contract
for zero benefit — the host controls the data and supplies a key per row when
it wants identity.

**D3 — keyField namespace validation.** Reserved = the exact construction-key
skip set at ops.ts:296 (`anchors`, `type`, `css`, `children`, `props`,
`content`, `handlers`) — these are stripped from the row's source anchors, so a
keyField naming one of them could never be read back off a minted node. A
keyField in the reserved set, or non-string/empty, or object-valued rows → the
1b.10 `batch-keyfield-invalid` warn + whole-op degrade (D2). `id`/`sku`/`slug`
and any other natural key are LEGAL (1b.6's whole point — a row's `id` stays a
provider value per S13 and MAY be the key).

**D4 — stale-field semantics on reuse: PRUNE (pinned).** A reused node's
`source`-anchor set is RECONCILED to the new row's flat fields exactly: anchors
for fields absent from the row are removed (a consumer resolving that field
name stops seeing the stale provider — same as a clear), shared fields' values
are set, missing fields' anchors are added. **Shape fields are FROZEN on reuse**
(V/C "non-anchor field divergence" + C "reused self-state"): the reused node's
own compiled state (type/css/props/content from its frozen `base`, node.ts:418)
is NOT re-derived from the row — the row's flat fields are PROVIDER data
(consumers read them via the source anchors), the node's own element is the
SHAPE-STABLE row slot; a row whose `type`/`css`/`props`/`content` would differ
from the reused node's current compiled shape warns `rows-reuse-shape-ignored`
and the shape stays. (Mint-vs-reuse asymmetry, documented: at MINT the row may
override the shape via `fields.type ?? shape.type` (ops.ts:285, existing
letter); at REUSE the shape is frozen — a shape change requires dropping
keyField for a whole-op replace.) This is the honest resolution: rewriting
`base` is impossible (frozen), and layer-surgery per update would grow the
layer stack unboundedly (the no-layer-growth constraint).

**D5 — duplicate-key outcome.** Within-input: two rows with the same keyField
VALUE in ONE op → `duplicate-identifier` warn + keep-FIRST (the first
occurrence wins; the duplicate is dropped — ruling 1b.7, the
placement-duplicate-reference precedent). vs-existing-set: a key matching an
existing minted node → REUSE (intended — that IS the feature; no warn).

**D6 — op.keyField vs record.keyField precedence.** `op.keyField` is
authoritative (the current declared column). A keyed path additionally requires
`record.keyField === op.keyField` AND `record.prototypeName === op.prototypeName`
AND `record.placementName === op.placementName` (a prototype or zone change =
the identity space / shape authority changed → whole-op degrade, D2 — the C-big
"prototype change on re-mint"). A keyed op on a record with NO keyField (first
mint) → all rows mint-new, record gains keyField. A plain op (no keyField) on a
keyed record → whole-op replace, record loses keyField.

**D7 — keyed `rows: []` contract: CLEAR (unchanged).** The `rows: []` branch
(ops.ts:265-269) runs BEFORE the keyed predicate and is untouched: an empty
batch deletes the record + tears down the minted set — a keyField NEVER turns a
clear into a sticky empty record. (A keyed update that removes ALL rows by key
is a different op: keys present in the input, none in the existing set → all
remove-missing + the record keeps the empty... no — an empty `rows` IS the
clear; a non-empty keyed batch that happens to match zero existing keys is the
"all mint-new" case, legal.) PIN: `rows: []` ⇒ clear, keyed or not.

**D8 — the undo shape: EXACT-inverse via `result.preRecord` re-apply (pinned;
the per-kind table splits into TWO rows).** The journal entry for a KEYED
rows-mint records `result.preRecord` (the pre-op `BatchRecord`, or a null
marker when the op CREATED the batch) + the existing `result.minted`
(newly-minted ids only) + additive `result.reused`/`result.removed` (D10).
Undo:
- `preRecord === null` (the op created the batch) → the EXISTING
  payload-controlled teardown (supervisor.ts:1072-1102) — exact, unchanged.
- `preRecord` set (the op UPDATED a batch) → **re-apply the pre-op rows through
  the SAME keyed executor** (`this.apply({kind:'rows-mint', target, hookName,
  mintKind, prototypeName, placementName, keyField: preRecord.keyField,
  rows: preRecord.rows}, {journal:false})`): the executor reconciles the
  CURRENT set (reused + mint-new) back to the pre-op key set — reused nodes get
  their pre-op values restored, the mint-new nodes become remove-missing
  (destroyed — they did not exist pre-op), the removed rows re-mint (fresh ids),
  the record rewrites to the pre-op rows (which IS the pre-op record). This
  resolves every half with ONE code path (no separate inverse logic), restores
  the record exactly, and meets the user ruling's scope (the reused nodes'
  prior values) exactly.
- **Honest framing (the exact-inverse halves, V/C must-fix):** EXACT as to
  record + reused-node values + set membership; the REMOVED half re-mints with
  FRESH ids (their elements were destroyed forward; identity-across-undo is not
  a promise — the D5 closure is identity across UPDATES, not across undo).
  Documented.
- The undo re-apply runs through the kind gate (same mintKind → passes), the
  prototype resolution (same hub → resolves), the consumer walk, and
  `emitStructure` — all present in `apply`.
- `rows-clear` and the `rows: []` clear-variant remain documented no-ops with
  their parked fact-set (handoffs-review-4 §5) — `preRecord` does NOT silently
  un-park them this pass (a clear is a separate op; its inverse needs the
  pre-clear record journaled as a distinct decision).
- ops.md §6 table: split the `rows-mint` row into (a) `rows-mint` (plain) →
  payload-controlled teardown (unchanged) and (b) `rows-mint`-keyed-reuse →
  EXACT inverse (re-apply the pre-op record; value-restore per the ruling).

**D9 — the replay/result-refresh interaction (V/C must-fix "replay refresh
clobber").** Replay re-runs the keyed op no-journal; the op is self-idempotent
by D1 (reuse + deep-equality no-op + remove-missing already-gone), so no new
replay gate is needed. BUT the in-place `entry.result = res` refresh
(supervisor.ts:1026) must PRESERVE the ORIGINAL `result.preRecord` (refreshing
it to the post-op record would make a subsequent undo re-apply the POST-op rows
→ broken). The refresh merges: `entry.result = { ...res, preRecord:
entry.result.preRecord ?? res.preRecord }` (the supervisor's rows-mint
journal/refresh preserves the first-applied preRecord). TDD R15 pins
replay-then-undo → pre-op values. The pre-op facts survive because the record's
rows ARE the pre-op values (the executor reads the live minted set at apply
time; the record carries the pre-op row data for undo).

**D10 — result shape + the consumer-walk input set.** `result.minted` =
NEWLY-minted ids only (the plain path keeps today's all-minted meaning); the
A3/replay + registerNode machinery is unchanged. Additive observability:
`result.reused: NodeId[]` (in-place-updated ids), `result.removed: Array<{key,
row}>` (destroyed rows — the C-question "degraded observability"). The
supervisor's MINT-SIDE consumer walk (supervisor.ts:913-926) iterates the union
of nodes with CHANGED source values (reused-with-changes ∪ mint-new) ∪ the
remove-missing set captured BEFORE teardown (the rowsClear S5 precedent,
ops.ts:342) — this is the ruling's "E2E-2 node-local cascade" + the
"no-stale-fan-out-arms" letter. Reused rows are NOT independently pass-2'd (the
pin-6 note, supervisor.ts:929-935, unchanged — consumers compile last and win;
the fan-out census must survive).

**D11 — the per-row silent-abort carrier (V/C must-fix).** Ruling 1b.9
(trigger/relevance per reused row) needs NO new trigger machinery. The carrier
is (a) the D1 executor-level deep-equality no-op — an unchanged row skips the
anchor rewrite and is NOT in the changed set, so its consumers are never marked
("regenerates nothing" at the source); and (b) the existing E2E-3 consumer walk
over the changed set only + the existing pass-2 deep-equality diff (an
unchanged resolved value produces no new compiled state, no set op, no state
event — the D4 set-only-changed-names letter). An irrelevant row's in-place
update therefore regenerates nothing — exactly ruling 1b.9. The placement
trigger path (placementChangeIrrelevant, ops.md §2.6 G22) is NOT involved (rows
are not placement ops; the value-relevance is the mechanism).

**D12 — the D5 claim re-scoped (C-question).** The proposal's "D5 focus/blur +
scroll-preservation closure" is a MIS-CITATION: render.md D5 (line 101) is the
DIFF op "childOrder changed → re-append in next order + remove departed". The
identity the feature actually guarantees is the **(wire, forkKey) ELEMENT
identity** — the reused minted node's id is stable → its pathKey (and thus
`forkKey = pathKey`, node.ts:1117-1122) is stable → the adapter's
`wireKey(wire, forkKey)` table key is stable → the SAME DOM element object is
reused across updates (E2E-2/T30 wire-identity, api.md T30; contract.md
399-405). The focus/blur + scroll preservation is the CONSEQUENCE of that
stable wire (placeholder-node-review.md:78), and the stable childOrder (D1,
positional arm identity) additionally avoids the D5 re-append churn. The
contract + serialize.md §4 wording must say: **"element identity across a
keyed update = stable minted-node id → stable (wire, forkKey); render.md D5 is
the diff op that consumes the stable childOrder"** — not "D5 guarantees the
closure". Path-state caveat: a PLACEMENT-kind row whose zone re-routes changes
its pathKey → new forkKey → element re-created (documented; the guarantee is
the family-path / stable-zone case).

**D13 — the serialize-boundary keyField validation (C-question).** STRICT at
loadState: a `BatchRecord` whose `keyField` is present but non-string or empty →
`NodeSchema-shape-mismatch` (mirrors the hooksKind boundary check,
serialize.ts:295-307; SER-R1 discipline). Rationale: the executor only ever
writes a valid string keyField to the record (invalid keyFields degrade BEFORE
the write, D2), so a non-string keyField in a doc is a crafted/malformed doc →
throw, consistent with the ADVERSARIAL-S3e row-member boundary. The OP-side
1b.10 `batch-keyfield-invalid` warn+degrade stays the LIVE-op containment
(D2/D3). NO cross-field rejection: a keyed record whose rows happen to lack the
key value is legal data (the re-mint's keyed executor whole-op degrades — D2
self-heals).

**D14 — performance (C-big "O(N²) match + journal growth").** The keyed path is
O(existing minted) for the map build + O(rows) for the match + reconcile — the
SAME order as today's teardown+re-mint, no O(N²). Journal growth: ONE entry per
op (no-journal replay unchanged); `result.preRecord` adds O(rows) to a KEYED
entry (bounded by the batch size, same order as the op's own rows payload) and
zero to a plain entry. The consumer walk is the existing E2E-3 walk over the
changed subset only. The Feature-1.4 linearity tripwire (`fan-out-blowup`,
rows-fanout.test.ts) applies unchanged — a reused row's update is a value
change on the same N providers → the ≤ k·N states-per-consumer bound still
holds (TDD keeps the census pin after a keyed update). No minted-set growth
across keyed updates (reuse in place; mint-new only for genuinely new keys).

### Gaps + costs-benefits

**What the feature does NOT promise (the residual list, §4/§Contract wording):**
1. **Identity across a snapshot boundary.** The Feature 1a residual stands: a
   serialize → loadState → re-mint mints FRESH ids (the re-minted set is empty,
   so the host's step-4.5 keyed re-mint mints-new). 1b restores identity for
   keyed updates WITHIN a graph (including post-restore updates — the keyField
   round-trips so a post-restore keyed update reuses the re-minted nodes); it
   does NOT make the minted node id survive the round-trip itself.
2. **Identity across a whole-op degrade** (a key-less row, a keyField/prototype/
   zone change → plain replace → fresh ids for every row).
3. **Identity across a placement-zone re-route** (pathKey → forkKey changes →
   element re-created — D12).
4. **Undo node-identity for the removed half** (fresh ids on restore — D8).
5. **Promotion** (1b.11(i): a reused node is origin-owned FOREVER; no opt-in).
6. **Keyed shape changes** (type/css/props/content on a reused row are ignored
   with a warn — D4).
7. **Cross-batch / cross-target key uniqueness** (keys are per (target, hook,
   batch); two batches may reuse disjoint key spaces — a host concern).
8. **No new public surface** beyond the op's `keyField` + the record's
   `keyField` (REQ-GAP-11 minimal-surface discipline; the per-row teardown
   helper is internal).
9. **Feature-3 base interaction (C-question):** the condensed base (3.18)
   carries the `batches` records including `keyField`; a base restore re-mints
   rows per record (mint-new — fresh ids by the round-trip letter), and the
   post-base re-apply uses the keyed executor as usual. Compose cleanly; no
   base-specific change.
10. **Blind-test loop (C-question):** the rows demo page gains a keyed-update
    arm — it MUST go through the AGENTS.md item-10 blind-test loop with the
    Mimo-2.5 model (writer/proofreader/page-reviewer), like the 1a demo work.

**Costs:** the executor grows the keyed branch (map build + reconcile +
preRecord capture); the schema boundary + serialize.md §3/§4 + api.md §1/ops.md
§6 gain the keyField + the split undo rows; the supervisor's rows-mint branch
and replay refresh gain the merged preRecord + the changed-set walk. The
journal preRecord payload for keyed ops.

**Benefits:** element identity (D5 closure) for keyed updates with NO
whole-batch teardown churn; in-place value cascade (E2E-2) bounded by the
existing linearity tripwire; replay-correct (deep-equality no-op, no
accumulation, no new gate); EXACT value-restore undo per the user ruling; the
round-trip carry composes with Feature 1a/3; containment mirrors the
hooksKind/S3 precedents (warn+degrade, never partial reuse, never a throw on a
live op).

### Contract (the implementation must satisfy)

1. `RowsMintOp` + `BatchRecord` gain optional `keyField?: string` (types.ts);
   `parseNodeState` validates a present record `keyField` as a non-empty string
   → else `NodeSchema-shape-mismatch` (D13).
2. `rowsMint` (ops.ts): after the S3 validation + the `rows: []` clear, the D2
   keyed-path predicate decides KEYED vs PLAIN; the keyed path implements D1/D4
   (O(N) map, prune reconcile, deep-equality no-op, per-id teardown helper,
   `addLayer`-replace of the layer decls — never `removeLayer`, stable priority
   slots, mint-new append), writes the record with `keyField` only on the keyed
   path, and returns `{ minted, reused, removed, layerId, preRecord }`.
3. `supervisor.ts` rows-mint branch: consumer walk over the changed-set union
   (D10); journal `result: { minted, reused, removed, preRecord, dirtied }`.
   Replay refresh preserves the original `preRecord` (D9).
4. `supervisor.ts` undo: `preRecord === null` → existing payload-controlled
   teardown; `preRecord` set → re-apply the pre-op rows via the keyed executor,
   journal:false (D8). ops.md §6 splits the `rows-mint` row into plain + keyed.
5. `serialize.md` §3/§4 + `api.md` §1: the keyField carry (step-4.5 re-mint
   passes the record's keyField), the residual list (Gaps 1-5), the D12 wording
   (element identity via stable (wire, forkKey), render.md D5 = the diff op).
6. Pins that must stay green: BH-N.4, hooks-array pins 3-8 (the replace/no-
   accumulation + clear + round-trip arms survive — the keyed arms are ADDITIVE),
   rows-mint-guardrails (25), journal-undo, def-roundtrip (10), rows-fanout
   (the linearity census after a keyed update).

### TDD list (the red set — `tests/unit/keyed-batch-reuse.test.ts`, a NEW file)

Red (all fail before implementation):
1. **keyField carrier** — a rows-mint op carrying `keyField` writes it to the
   record; a keyed record round-trips serialize → loadState with the field
   intact; the host's post-restore keyed re-mint + keyed update reuses the
   re-minted nodes (the 1a gate-arm extension).
2. **Schema boundary (D13)** — a serialized record with non-string/empty
   keyField → `NodeSchema-shape-mismatch`; a string keyField passes.
3. **Keyed reuse identity (D1)** — mint 2 rows with keyField, re-mint with
   updated values + same keys → the SAME node ids survive, values updated,
   minted set stays 2, no accumulation (children.length + mintedByOrigin).
4. **Whole-op degrade (D2)** — one key-less row in an otherwise-keyed update →
   plain replace (fresh ids, old nodes destroyed), record written WITHOUT
   keyField; `op.keyField ≠ record.keyField` / `prototypeName` mismatch /
   `placementName` mismatch → degrade.
5. **Reserved keyField (D3)** — keyField ∈ {type,css,children,props,content,
   handlers,anchors} or non-string/empty → `batch-keyfield-invalid` warn +
   degrade (never a throw, never a partial reuse).
6. **Value identity + key change (D1/D6)** — a changed key → old node
   remove-missing, new node minted; reused keys keep ids.
7. **Prune semantics (D4)** — a keyed update dropping a field removes the
   reused node's source anchor (consumers stop resolving it); a shape-field
   difference warns `rows-reuse-shape-ignored` and keeps the node's shape.
8. **Duplicate keys (D5)** — within-input duplicates → `duplicate-identifier`
   warn + keep-first.
9. **Deep-equality no-op (D1/D11)** — re-applying identical rows → no anchor
   rewrite, consumers not marked; replay() leaves the set + values unchanged.
10. **Consumer walk / silent-abort (D10/D11)** — changing ONE row's value dirties
    ONLY the changed field-name consumers (the unchanged rows' consumers are not
    marked); the result reports `minted` (new ids only) / `reused` / `removed`.
11. **Keyed undo (D8)** — keyed update then undo() → pre-op record restored,
    reused values restored, mint-new destroyed, removed rows re-minted (row
    count restored); redo re-applies.
12. **First-mint keyed undo (D8)** — a keyed op that CREATED the batch undoes
    via the existing payload-controlled teardown.
13. **Replay-then-undo (D9)** — replay() then undo() restores the PRE-op values
    (the preRecord survives the result refresh — never the post-op rows).
14. **No-promotion (1b.11)** — a reused node stays origin-owned across MANY
    updates (never authored, reverse-excluded); remove-missing destroys via the
    batch teardown.
15. **Keyed `rows: []` (D7)** — an empty keyed batch CLEARS (record deleted,
    set torn down), never a sticky empty record.
16. **Placement-kind keyed reuse (D1/D6)** — same placementName reuses (content
    anchors kept); a changed placementName degrades.
17. **Linear tripwire regression** — the fan-out census (≤ k·N) still holds
    after a keyed update; the `fan-out-blowup` tripwire is not tripped.
18. **Regression greens** — BH-N.4, hooks-array pins 3-8, rows-mint-guardrails,
    journal-undo, def-roundtrip, rows-fanout.

Green: implement the keyed executor + the supervisor/journal/undo/refresh
merges + the boundary/ops.md/serialize.md/api.md edits; verify `npm test`,
`npm run typecheck`, `npm run demo:smoke` (incl. the profile watches + the
`[derived-fork:baseline]`/`[derived-fork:pin]` totals), `npm run build`.

### Notes for the implementer

- The keyed branch lives INSIDE `rowsMint` and shares the plain path's
  S3-atomicity (up-front predicate before any mutation).
- The per-id teardown helper mirrors `rowsTeardown`'s body (node.ts:764-773)
  for a subset; it is INTERNAL (ops.ts) — no new public surface.
- The undo re-apply must run with the SAME hub (the executor's
  `target.hubFor ?? ctx.hub` resolves it) and must NOT re-journal (journal:false
  — the supervisor's undo path has no journal sink).
- A degraded op's record loses `keyField` (D2) — a subsequent plain update of
  that batch is status-quo replace; the host re-declares keyField to re-arm
  reuse.
- The demo-page keyed-update arm + the round-trip arm go through the AGENTS.md
  item-10 blind-test loop (Mimo-2.5) before completion.

### Trackers (same pass as the landing)

- `docs/specs/ops.md` §1 (RowsMintOp.keyField), §6 (the split undo rows +
  result.preRecord/reused/removed).
- `docs/specs/api.md` §1 (the wire keyField + the LIVE-NODE-TARGET note
  unchanged).
- `docs/specs/serialize.md` §3 (step-4.5 passes keyField) + §4 (the D12 wording
  + the residual list).
- `docs/next-feature-batch-0.2.0.md` §Feature 1b (gate verdict + the executor
  shape + D2/D8/D9 pinned).
- `docs/decisions.md` — the keyed-batch-reuse decision row (D1-D14).
- `docs/defects.md` — none new; the review findings are verdict notes.
- `docs/pending.md` — the 2026-08-19 speculative "Keyed batch-reuse" row flips
  to PLANNED/landed-shape.
- `docs/next-steps.md` — the work-queue entry for the 1b TDD pass.
- `docs/skills/designing-pages.md` §11 coverage matrix + §12 demo pages (the
  rows demo's keyed-update arm) per AGENTS.md item 3.
