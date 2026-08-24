# Handoff Round 6 (DEFECT-JOURNAL-UNDO + DEFECT-JOURNAL-REPLAY-APPEND) — three-agent gate (steps 2-3)

Status: **PROCEED-WITH-CONDITIONS — the step-3 verdict is the gate result
(§Step 3 below); a scoped engine fix + a G14/§6 contract amendment land in
the next pass.** NOTE (file history): this file was created by the step-2
critique agent (which ran as a step-1-absent run — the step-1 validity
content summarized in the task brief is NOT in this file; the step-3 agent
independently verified every step-1/step-2 claim against the code, §Step 3
§1). This agent analyzed, never edited source or tests.

Status: **critique (adversarial) read-only pass** over the two
journal-reversibility defects filed in `docs/HANDOFF-5.md` Round 6 (2026-08-24,
from the journal reversibility battery). This agent analyzed, never edited
source or tests; this document is the only artifact. Every cited site was
re-read and line-verified against `src/core/supervisor.ts`, `src/core/node.ts`,
`src/core/ops.ts`, `src/core/registry.ts`, `docs/specs/ops.md` §6/§2.5-§2.8,
`docs/specs/api.md` §1.1, `tests/integration/supervisor.test.ts` (O13/O14),
`tests/unit/hooks-array.test.ts` (§9.4 pin 6). Companion context:
`docs/specs/handoffs-review.md` / `-2.md` (format template), `docs/specs/ops.md`
(journal contract + G-row exhaustiveness), `docs/pending.md` (destroy-terminal
pin, journal condensing), `docs/defects.md`.

---

## Step 2 — Critique agent

### 1. Verdicts

| Defect | Verdict | One-line rationale |
| --- | --- | --- |
| **DEFECT-JOURNAL-UNDO** | **NEEDS-RESHAPE** | "Inverse executor per journaled op kind" is the right architecture, but every non-trivial inverse needs journal-recorded facts that **do not exist today** (the layer id / the pre-op parent / the pre-clear record / the minted copy id), and undo must gain the apply-side bookkeeping (`markPass2`/`emitStructure`/inverse trigger) or it is render-stale. Some kinds are only partially invertible under pinned letters (clone-instance × retention slot-stability, layer-apply × promotion teardown, placement-attach × shared container anchor). |
| **DEFECT-JOURNAL-REPLAY-APPEND** | **NEEDS-RESHAPE** | Both proposed shapes are flawed: "re-base against the authored pre-op array" is wrong for any stream with >1 append on the same key (the authored base ≠ the value at op time), and "record the pre-op array" works but pays O(array-length) per entry. A **third shape — record the slice-layer ids and gate replay on them (the OO-2 idempotency pattern)** — fixes the defect at O(#mutations) per entry and unifies the undo + replay fixes under one journal-shape change. |

The destroy-undo NO-OP is **correct and pinned** (`supervisor.ts:949` comment,
`docs/HANDOFF-5.md` line 126, pending.md REQ-GAP-12) — not part of the defect.

### 2. Externalities of per-kind inverse executors

**2.1 `state-slice` — the inverse is *almost* free, but the layer cannot be found.**

The op lands ONE layer per mutation with id `slice-${nodeSeq}-${src}`
(`node.ts:1408`); `nodeSeq` is a **module-level counter** (`node.ts:39`) shared
across every node and **not recorded in the journal**. `src` is recoverable
(the mutation/op `sourceName`), the seq is not. The proposal's own framing —
"reconstruct pre-op by removing the slice layer the op added" — is correct **in
principle** because removing a layer is a **perfect inverse for every mode**
(replace/append/replaceAll/type/content/css/handlers): `compileLocal` re-merges
base + remaining layers (`node.ts:946-1000`) and the append layer already holds
the **full merged post-array** (`node.ts:1500`), so removal restores the pre-op
value exactly — **no pre-op value needs to be recorded**. The *only* missing
fact is the layer id.

A heuristic ("remove the last N `slice-*` layers on the node") is fragile:
a state-slice with several mutations creates several layers; a `layer-apply` /
`rows-mint` layer landing on the same node after the slice does not disturb the
`slice-*` tail, but a multi-mutation op and any future layer-adding kind make
the count-to-remove ambiguous. **Recommended:** journal `result.sliceLayers:
string[]` (the ids the op created) — an additive result field mirroring the A3
`minted` precedent (`ops.md` OO-1: "The journal result persists `minted`"),
O(#mutations) memory, no serializer impact (the journal is never serialized —
see §5).

**HOOKS exception (overlooked in the proposal):** a `hooks.<name>` mutation
lands a deterministic `hook-<name>` replace-in-place layer (`node.ts:1424-1431,
1474`) **and mutates the provider anchor** (`anchor.value = value`,
`node.ts:1490`). Removing the layer does **not** restore `anchor.value` — the
inverse must also restore `anchor.value = layer.hookFallback`. The id is
deterministic (`hook-<name>`), so no seq problem; the anchor side-channel is
the only missing piece.

**2.2 `detach` — the inverse is *not* recoverable from the verbatim op.**

`detach` = `detachNodeSafe` (`ops.ts:76-97`): the child anchor is spliced off
the shared family link, the node drops to `unplaced`, and the parent side
dissolves when the last child leaves. The op is `{kind:'detach', node, from?}`
(types.ts:114) — the **old parent and old priority are nowhere in the journal**.
Re-attach to the old parent with the old priority is impossible without
recording pre-op `{parent, priority}` (or the old link). Note the asymmetry:
attach-undo (a pure removal) needs no extra data and already works
(`detachNodeSafe`, `supervisor.ts:945-947`); detach-undo (a pure re-add) does.

**2.3 `clone-instance` — collides with the retention slot-stability letter.**

`clone()` marks the copy `runtimeMinted` (`node.ts:826`); the supervisor
registers + attaches it and journals only `dirtied: [copy.id]`
(`supervisor.ts:782-806`) — the copy id IS in the journal result but only
implicitly as `result.dirtied[0]` (rows-mint/layer-apply use a dedicated
`result.minted`). Undo = destroy the copy, but the copy is `runtimeMinted` →
**retention destroy** (`markDestroyed`, `supervisor.ts:684-691`; the family edge
and the walk slot stay — registry.ts:298-305). The `children` getter does not
filter destroyed nodes (`node.ts:575-584`), so the copy **remains a ghost in
the parent's walk** after undo. Redo re-applies `clone-instance` → mints a
**second** copy with a fresh id (`source.clone('actor')` + attach) → the walk
now holds the destroyed original **and** the new live copy: duplicated content
and slot drift. So clone undo+redo is not cleanly invertible under the
retention letter: undo leaves a tombstoned placeholder, and there is no
re-activation path for the tombstone. Either document "undo of clone = retention
destroy (slot placeholder)" or add a redo re-activation mechanism (both are
amendment work, not free).

**2.4 `layer-apply` — teardown ≠ inverse (promotion divergence).**

`layerId` IS in the op (OO-1, `ops.ts:166`) — the only missing-facts problem
does not apply. But the documented teardown (`removeLayer(layerId)`, OO-5) runs
the pre-detach survival predicate (`node.ts:742-769`): doomed → detach →
cascade-destroy, **survivor → PROMOTION** (originLayer cleared + unregistered →
becomes authored content, reverse-emitted). Promotion is **not a faithful
inverse**: a promoted child exists as authored content that did not exist
pre-op. Undo of layer-apply is therefore the *documented teardown*, not a
restore of the pre-op graph. Either document teardown-as-undo for layer-apply,
or implement a full-dissolve inverse. Redo: re-applying the op after the layer
was removed **passes the OO-2 idempotency gate** (`target.layers.some(l =>
l.id === op.layerId)`, `ops.ts:168`) and re-mints **fresh nodes with fresh ids**
(`new Node(data, hub)`, `ops.ts:179`) — the recorded `result.minted` goes
stale. Shape restored, identity not. Acceptable for redo semantics, must be
documented.

**2.5 `placement-attach` — only a partial inverse is safe.**

Executor: mints the node's `content` anchors (dedup keep-first) + *ensures* the
container anchor on the container (`ops.ts:121-142`); the supervisor registers
the node (`supervisor.ts:735`). The **container anchor is per-zone SHARED** on
the container (one anchor serves every consumer of the zone) — removing it
would orphan **other** consumers' placement paths. Safe inverse: remove only
the node's `content` anchors and leave the shared container anchor; unregister
the node only if the op newly registered it (not recorded). The op cannot
distinguish content anchors it added from pre-existing ones (dedup keep-first)
without recording. The pass-2 trigger must be the **inverse** direction
(`container-removed`) — the op records the *forward* trigger. Partial inverse
with documented asymmetry; needs `result` facts (`wasNodeNew`,
`containerAnchorMinted`, added-name list).

**2.6 `rows-clear` — the inverse has no recoverable source.**

`rowsClear` **deletes the `batches[hookName]` record** and tears the minted set
down via the record's layerId (`ops.ts:291-300`). The record is the single
mint/undo handle (rows-mint undo uses it, `supervisor.ts:950-965`). After a
clear, the record, the layer, and the minted set are **gone** — a re-mint
inverse has no prototype/rows/layerId to re-run. Asymmetry: rows-mint has an
undo, rows-clear does not. Needs the pre-clear record journaled
(`result.record`).

**2.7 `move` (unlisted in the DEFECT) is also a silent no-op** — `move` =
detach+attach (`ops.ts:315-322`); the undo dispatcher has no `move` branch
(`supervisor.ts:945-965`). Its inverse = the reverse move; the old parent is
not recorded (same data gap as detach).

### 3. The dirty / pass-2 / event side — the largest externality

`apply()` performs per-op side effects: `markPass2(nodeId[, trigger])` +
`emitStructure(opKind, nodeId)` + `scheduleFlush` for **every** kind
(`supervisor.ts:719, 742-744, 758, 765, 779, 805, 825-827, 873-874, 894-895`).
`undo()` does **none of it** (`supervisor.ts:936-966`) — even the *working*
attach-undo leaves the graph changed with no pass-2 dirty, no structure event,
no flush, and no `pendingTriggers`. Consequences:

- The host re-render path (`renderProducingProcess` / `dispatchAndReport`)
  consumes compiled states + the renderer's `takePass2States()` — all **stale**
  after a real undo. The ssr-synthetic-event contract
  (producing-process-keeps-graph + fragment-as-view) does **not** exempt undo:
  the producing process re-renders per *dispatch*, and undo is not a dispatch —
  nothing today hands the caller an undo dirtied-set. So a real undo **must**
  `markPass2` + `emitStructure` + `scheduleFlush` per inverse, and placement
  inverses must carry the **inverse trigger** (`container-removed`) through the
  silent-abort relevance pre-check (`supervisor.ts:509-512`).
- **RUNTIME-WRITE BODY letter:** undo must be pure graph mutation + pass-2
  marking — it must **never** run phases/handlers (apply runs `before-compile`
  on the forward op only, `supervisor.ts:582-585`). Pin this when implementing.

### 4. Replay-append shape comparison

**Replay semantics today:** `replay()` re-runs every journaled op through
`apply()` **against the current live graph** (`supervisor.ts:917-934`) — it is
an idempotency/assertion re-run (O13, S-P2), not a replay-from-clean-baseline.

**(a) Re-base against "recorded authored pre-op array" — REJECT.** If
"authored" means the node's **base** array, it is wrong for any stream with >1
append on the same key: the re-base target must be the **value at op time**
(base + every earlier journal append), and re-basing a *second* append against
the base drops the first append's contribution. A node whose base has no array
("append created it") works only for the **first** append. Append-after-replace
re-based against the base loses the replace. "Authored pre-op" equals "pre-op"
only for the first mutation of a fresh key — the DEFECT's phrasing conflates
the two.

**(b) Record the pre-op array in the journal — VIABLE but over-priced.** The
pre-op-at-op-time is the correct re-base target: re-applying the append against
the same pre-op yields the same merged post → deterministic and idempotent.
Entry-shape impact: **none of the pins break** — the journal is **never
serialized** (grep confirms no serialize/export of the journal; entries carry
live `Node` references, so it is process-local runtime-only; `pending.md`
"Journal condensing" is the only journal-memory concern), `dispatchAndReport`'s
dirtied derivation reads only `result.dirtied` over the bounded j0→length span
(`supervisor.ts:325-328`), and `requestId` dedup is journal-independent
(`supervisor.ts:290-300`). Memory: O(array-length) per append entry, O(n²)
worst-case over a long append stream — real on the fork-stress data pages if
appends are used, and it is *redundant* because the append layer already stores
the merged post-array.

**(c) THIRD shape — record the slice-layer ids + OO-2-style replay gate —
RECOMMENDED.** Journal `result.sliceLayers: string[]` and:
- **undo**: `removeLayer(id)` per recorded id — exact inverse for every mode
  (compileLocal re-merge, `node.ts:946-1000`); no pre-op value needed.
- **replay**: if every recorded layer still exists, the op is already reflected
  → **skip** (the layer-apply OO-2 gate, `ops.ts:168`); if absent (post-undo) →
  re-apply. This makes a replayed append a **no-op**, killing the
  `["x"]→["x","x"]` growth without storing pre-op arrays.
- Soundness of "exists ⇒ already applied": each state-slice mutation adds its
  own layer, and **no stream path removes `slice-*` layers except an undo**
  (removeLayer callers: rows teardown / hook-clear / origin teardown / undo —
  verified `node.ts:654-707`, `ops.ts:229,298`, `supervisor.ts:962`).
- Cost: O(#mutations) per entry (vs O(array) for (b)); mirrors the A3 `minted`
  precedent exactly; unifies the undo + replay fixes under **one** journal-shape
  change.

The proposed "replay-time computation without journal-shape change" (re-base
against base + earlier journal appends) is **not feasible for current replay
semantics**: `replay()` is incremental over the live graph, so computing the
value-at-op-time requires a full from-scratch rebuild (re-mint, id reuse) — a
much heavier change than (b) or (c). It collapses into (b)/(c).

**redo() interaction (pre-existing, must be fixed with the rest):** `redo()`
re-applies via `apply()`, which **journals a NEW entry**
(`supervisor.ts:968-981` → `journalIfApplied`) and pushes the original entry
back onto `undoStack` (`supervisor.ts:971`) → after a redo the undoStack holds
**two** entries for one op → the next `undo()` fires twice (double-undo). For
append *today* (undo no-op) redo-after-undo double-appends because the layer was
never removed; the layer-removal undo fixes the value but not the double-entry
bug. `redo()` (and `replay()`) should re-apply **without journaling** or
re-journal the **same** entry id. Also: `replay()` already **grows the journal
on every run** (apply journals re-applied ops; the snapshot at
`supervisor.ts:923` only prevents *infinite* growth, not growth) — a latent
issue adjacent to pending.md "Journal condensing".

### 5. Paradigm / robustness

- **Destroy-is-terminal:** destroy-undo no-op is correct + pinned
  (`supervisor.ts:949`, HANDOFF-5 line 126, pending.md REQ-GAP-12). No change.
- **Retention slot-stability letter** (registry.ts:298-305, ops.md §2.5):
  clone-instance undo collides with it — the destroyed copy stays in the walk
  (ghost slot), redo duplicates it. See 2.3. The letter protects *destroy*; an
  *undo* that must fully restore topology needs the tombstone re-activatable —
  a new mechanism, not a free inverse.
- **Placement-may-return / content-persistence:** placement-attach inverse must
  not remove the shared container anchor; partial inverse only. See 2.5.
- **RUNTIME-WRITE BODY letter:** undo must be handler-free (pure graph +
  pass-2). See §3.
- **Journal-shape pins:** ops.md §6 (306-330) + G14 (351) and api.md §1.1
  assert "ops named + replayable → undo/redo **for free**" and "journal
  contents sufficient to replay **or invert**". The as-built journal does not
  carry the inverse facts — so the DEFECT is a genuine **spec-vs-code contract
  gap** (G14 is the violated letter), not an implementation accident. The fix
  **must amend the journal contract** (additive `result` fields: `sliceLayers`,
  `minted` for clone, pre-op `parent`/`priority` for detach/move, pre-clear
  `record` for rows-clear, `wasNodeNew`/`containerAnchorMinted` for
  placement-attach) and re-pin §6/G14 to state exactly which kinds are
  invertible and what the journal records.
- **Reachability / scope framing:** undo/redo/replay are referenced **only** in
  `supervisor.ts` and two test sites (`tests/integration/supervisor.test.ts:63,67`,
  `tests/unit/hooks-array.test.ts:500`). The Electron host uses
  `dispatchAndReport` + `renderProducingProcess` and **never calls undo** (grep
  over src/ + demo/). So DEFECT-JOURNAL-UNDO is **purely a contract-honesty
  gap** (G14 over-promises), not a host-blocking defect — the fix can be scoped
  minimal (document the partial contract + land the cheap inverses) or complete
  (all inverses + render side). The user gate should choose the scope; the
  battery asserts G14 as written.

### 6. Safety

- **Undo across destroy:** `undo()` resolves `this.nodes.get(node.id) ?? node`
  (`supervisor.ts:944`). After a destroy the node is evicted from `this.nodes`
  into `destroyedRefs` (`supervisor.ts:713-717`; `getNode` checks both, but
  undo/redo/replay use `this.nodes.get` directly and fall to the raw journal
  reference — the live destroyed node, since the journal holds live refs). A
  state-slice undo on a destroyed node → `removeLayer` → `ensureWritable`
  **throws** `'destroyed node writes are rejected'` (`node.ts:1857-1859`) and
  `undo()` has **no try/catch** (unlike `apply()`) → uncaught throw.
  attach-undo (`detachNodeSafe`) doesn't call `ensureWritable`, so it is
  "safe" but mutates a tombstone. Fix: guard destroyed targets (skip, like the
  destroy-undo no-op) and wrap each inverse in try/catch like `apply`.
- **Wrong-node hazard under id reuse:** the smoke runs multiple
  loadState-re-seeded graphs with **shared node ids** in one process
  (`supervisor.ts:146-148`, registry.ts:261-265 instance-guarded eviction).
  undo/redo/replay re-resolve by id against `this.nodes` (`supervisor.ts:926,
  944, 974`) — if a *different* graph's node with the same id is in
  `this.nodes`, undo operates on the **wrong node**. Prefer the journal's own
  live reference; fall back to id resolution only as a tombstone convenience.
- **Undo ordering:** LIFO via `undoStack` is the pinned shape (§6) and is fine;
  the redo double-entry bug (§4) is what breaks LIFO hygiene.
- **Undo of a slice a handler depends on:** undo reverses the whole journal
  LIFO, including handler-driven applies. Since undo does not re-run pass-2,
  dependent compiled states (binding consumers, parents) go stale — the render
  side is the exposure, not the graph (same §3 finding).
- **Double-undo after redo:** structural (see §4 redo()).

### 7. Overlooked design elements + suggested amendments

1. **Undo must carry the apply-side bookkeeping** (`markPass2` +
   `emitStructure` + `scheduleFlush` + inverse placement trigger) or be
   documented as graph-only with a host full-recompile contract — the proposal
   does not mention the render side at all.
2. **redo() double-journals** (structural): redo should re-apply without
   journaling or re-journal the same id; `replay()`'s journal growth on re-run
   is latent (related to pending.md "Journal condensing").
3. **Unified fix:** record `result.sliceLayers` (the A3 `minted` precedent)
   for every state-slice — gives exact undo for all modes AND the OO-2 replay
   gate that fixes the append defect, at O(#mutations) memory. This is the
   single recommended amendment carrying both defects.
4. **Hooks undo needs the anchor side-channel:** restore
   `anchor.value = layer.hookFallback` + `removeLayer` (id `hook-<name>` is
   deterministic).
5. **clone-instance undo:** journal `result.minted: [copy.id]` (consistency
   with rows-mint/layer-apply) and decide retention-placeholder vs
   re-activation for redo — document whichever is chosen.
6. **layer-apply undo:** document teardown-as-undo (OO-5 promotion divergence)
   vs full-restore; note redo re-mints fresh ids.
7. **placement-attach undo:** partial inverse (content anchors only, leave the
   shared container anchor) + record `wasNodeNew`/`containerAnchorMinted` +
   inverse trigger.
8. **rows-clear undo:** journal the pre-clear record (`result.record`) so the
   re-mint inverse is possible (fixes the rows-mint-has-undo/rows-clear-doesn't
   asymmetry).
9. **detach/move undo:** record pre-op `{parent, priority}`.
10. **Undo safety:** guard destroyed targets + per-inverse try/catch; prefer
    the journal's live node reference over id re-resolution (id-reuse hazard).
11. **Docs/spec sync (AGENTS.md item 6):** amend ops.md §6/G14 + api.md §1.1 to
    state the actual invertibility per kind and the recorded inverse facts; the
    design skill's feature index + test-use-case coverage matrix
    (designing-pages.md §11) and the active trackers (`docs/defects.md`,
    `docs/decisions.md`) must be updated in the same pass as any landing. The
    validation trio (item 4) gates completion; the journal reversibility
    battery's tests must be the red-first TDD harness.

---

## Step 3 — Change-analysis agent (verdict)

Status: **PROCEED-WITH-CONDITIONS** — the two filed defects and the unfiled
clone-instance replay defect land as a **SCOPED engine fix** (the critique's
sliceLayers shape, amended per the two new findings below), and the remaining
undo kinds land as a **G14 / ops.md §6 contract amendment** (documented
no-ops with per-kind rationale) in the SAME pass. The full-engine alternative
is rejected; a pure doc amendment cannot land DEFECT-JOURNAL-REPLAY-APPEND at
all (replay is a live, asserted path — O13, hooks-array pins 4/5 — and the
append defect is data corruption on it, not a spec over-promise).

### 1. Independent verification (read-only, this agent)

Every critical claim in steps 1-2 was re-read and line-verified. Confirmed:

- **DEFECT-JOURNAL-UNDO is real.** `undo()` (supervisor.ts:936-966) branches
  ONLY `attach`/`destroy`/`rows-mint`; the other seven journaled kinds
  (state-slice, detach, move, clone-instance, layer-apply, placement-attach,
  rows-clear) fall through to a silent no-op. destroy-undo no-op is the pinned
  contract (supervisor.ts:949), not the defect. G14 (ops.md:351) — "Inverted/
  replayed named ops restore graph; undo/redo derived from journal alone" —
  and §6 "Journal contents … sufficient to replay or invert" (ops.md:327) are
  the violated letters: genuine spec-vs-code contract gap, not an accident.
- **DEFECT-JOURNAL-REPLAY-APPEND is real.** `replay()` (supervisor.ts:917-934)
  re-runs every entry through `apply()` against the live graph, and `apply()`
  re-journals (journalIfApplied, :559-567). A replayed append re-merges onto
  the already-appended array (the append layer holds the full merged post —
  node.ts:1500) → `["x"] → ["x","x"] → …`. The snapshot at :923 only blocks
  infinite growth, not growth.
- **The journal is NEVER serialized.** serialize.ts/loadState/reverseTranslate
  have zero journal references; entries carry live `Node` refs (process-local
  runtime only). Additive `result` fields (`sliceLayers`, `minted`, hook
  pre-op values) have **no serializer impact** — only the `JournalEntry`
  result type (supervisor.ts:83) widens. Critique §5 claim confirmed.
- **sliceLayers soundness ("no stream path removes `slice-*` layers except an
  undo") holds.** removeLayer callers: ops.ts:229 (rows-mint replace — its own
  `hook-*` layerId), ops.ts:298 (rows-clear — the record's layerId),
  supervisor.ts:962 (rows-mint undo — the record's layerId), node.ts:1480
  (hook clear — `hook-<name>`). `removeLayersForSource` has ZERO callers in
  `src/`. `nodeSeq` is module-level (node.ts:39) and not recoverable from the
  op — the layer ids cannot be reconstructed at undo time without recording
  them. removeLayer (node.ts:654-682) + compileLocal re-merge (node.ts:946-1000)
  = exact inverse for every non-hook mode; the append layer's full-post array
  makes `props.append` exact with no pre-op value. Critique §2.1/§4(c) endorsed.
- **redo() double-journaling confirmed, and one step worse than described:**
  redo() pushes the entry to undoStack (:971) then apply() journals a NEW
  entry (:977) — which also CLEARS redoStack (journalIfApplied :565). So after
  a redo the undoStack holds two entries for one op (next undo fires twice —
  with the sliceLayers inverse the second pop degrades to a harmless
  removeLayer-on-missing no-op, but the journal/stack hygiene is broken and
  redo-chains are impossible). Additionally: a no-journal redo that leaves the
  entry untouched would break the sliceLayers undo handle — re-apply mints NEW
  layer ids, so the recorded ids go stale. **redo/replay must re-apply without
  journaling AND refresh the entry's `result` in place** (new finding, §3).
- **Unfiled clone-instance replay defect confirmed.** Replay re-runs
  `clone-instance` → `source.clone('actor')` mints a FRESH copy with a fresh
  id (supervisor.ts:782-806); the copy id is only implicit in
  `result.dirtied[0]` (:804). sliceLayers does NOT cover it (clone creates no
  slice layers); the A3 `minted` precedent DOES (layer-apply/rows-mint replay
  resolve `result.minted` to existing nodes). Needs its own small gate row (§4).
- **Hooks exception confirmed — and it is WIDER than the critique states**
  (new finding, §3): the deterministic `hook-<name>` id means (a) undo must
  restore `anchor.value` (node.ts:1490) — critique §2.1 correct — AND (b) a
  SECOND write to the same hook name REPLACES the pre-existing layer in place
  (node.ts:1485-1486 + addLayer replace node.ts:640-644): a naive
  removeLayer-on-undo would delete a layer that pre-dates the op and restore
  `anchor.value = hookFallback` (the authored value) instead of the prior
  write's value. And (c) the deterministic id breaks the "exists ⇒ applied"
  replay gate — the layer exists even before this entry ever ran. The gate
  needs **value-equality** for hook entries, and undo needs the recorded
  pre-op `anchor.value` (one scalar per hook mutation — readable at apply time
  from the same anchor `hookWriteGuard` already resolves).
- **Undo-safety hazards confirmed:** destroy evicts from `this.nodes`
  (supervisor.ts:714-717) so the id-resolve falls to the journal's raw ref =
  the live destroyed node; `removeLayer` → `ensureWritable` THROWS
  (node.ts:1857-1859) and undo() has no try/catch (:936-966) → uncaught
  throw. Replay/redo re-resolve by id (`this.nodes.get`, :926/:974) — the
  wrong-node hazard under shared-id loadState-re-seeded graphs is real.
- **Test sites:** undo/redo/replay live ONLY in supervisor.ts + two test files
  — tests/integration/supervisor.test.ts (O13 replay :44/:205, O14
  undo/redo :63/:67) and tests/unit/hooks-array.test.ts (:389 replay, :498-500
  rows-mint undo). NOTE: the task brief's "tests/unit/ops.test.ts" attribution
  is wrong — ops.test.ts covers executors, not undo/redo. The consumer's repro
  battery (`tests/journal-reversibility.test.ts`, HANDOFF-5 line 112) does not
  exist in THIS repo (consumer-side, same doc-hygiene class as the
  handoffs-review-3 finding) — the red TDD set below replaces it here.
- **Baseline trio (run only):** `npm run typecheck` clean; `npm test`
  1028/1028 green (49 files). No source or test file modified by this review.

### 2. Scope decision — why this shape, and why the alternatives fail

| Option | Verdict | Why |
| --- | --- | --- |
| DOC-AMENDMENT-ONLY (amend G14, document no-ops) | **REJECTED** | Cannot land DEFECT-JOURNAL-REPLAY-APPEND — replay is an asserted, used path (O13, hooks-array pins 4/5) and the append growth is live corruption, not an over-promise. The amendment lands as a COMPANION, not a substitute. |
| FULL engine fix (all inverses + render side) | **REJECTED** | The letter-colliding inverses (clone × retention slot-stability, layer-apply × promotion, placement-attach × shared container anchor) each require a user-gated decision (tombstone re-activation, teardown-as-undo, partial-inverse facts) — not a one-pass landing. The host never calls undo (verified: no caller in src/ or demo/), so the render-side machinery is not host-blocking. |
| **SCOPED engine fix + G14 amendment** | **PROCEED** | Lands the two filed defects + the unfiled clone replay defect (all three are cheap, facts-free or one-scalar additions), makes undo **not-silent** (supported kinds work exactly; unsupported kinds become explicitly documented no-ops with recorded rationale — satisfying the handoff's "silent no-op" complaint), and parks the letter-colliding inverses with their exact fact-sets for a future user-gated pass. |

The G14 amendment is defensible as a landing: the spec currently promises
"undo/redo for free" for every named op (§6, api.md §1.1); the amendment
narrows that promise to a per-kind table that states EXACTLY which kinds are
invertible, what the journal records for each, and why the rest are no-ops —
recording the actual contract instead of the aspirational one. The parked
rows carry ready-to-go shapes so the gap is closed on a later pass without
re-analysis.

### 3. The sliceLayers shape — validated, with two amendments

The critique's recommended shape is correct and is endorsed as the core:

- **(a) state-slice undo, every mode:** one layer per mutation, id
  `slice-${nodeSeq}-${src}` (node.ts:1408); recording the ids in the journal
  result (`result.sliceLayers: string[]`) is the undo handle. removeLayer per
  id is exact for replace/append/replaceAll on content/type/css/props/handlers
  (append is exact because the layer holds the full merged post-array,
  node.ts:1500). O(#mutations) memory. **AMENDMENT 1 (hooks):** record the
  pre-op `anchor.value` per hook mutation (`result.hookUndo: {name, preValue}[]`
  or a parallel list) — the deterministic `hook-<name>` id and the
  replace-in-place semantics make hookFallback-only restore inexact on a
  second write. Exact undo = restore `anchor.value = preValue`; remove the
  layer iff the op created it (else restore the layer's value to preValue).
- **(b) replay-append idempotency:** gate = all recorded sliceLayers exist →
  skip; any missing → re-apply. Soundness verified (§1). **Partial existence
  is unreachable today** (one undo removes all of an entry's layers
  atomically; no other path touches `slice-*` ids) — pin the "all-or-nothing"
  semantics with a comment, not a code branch. **AMENDMENT 2 (hooks + gate
  soundness):** for hook entries the gate is "layer exists AND
  `layer.value === op's value`" (the deterministic id is not
  entry-distinguishing). This ALSO fixes the post-undo-hook-replay case that
  a plain existence gate would mis-skip.
- **(c) redo double-journaling:** fixed structurally, not by sliceLayers —
  `redo()` and `replay()` re-apply via an internal `apply(op, {journal:false})`
  mode and refresh the entry's `result` (sliceLayers, minted, dirtied) in
  place; redo pushes the SAME entry to undoStack and never clears redoStack.
  This keeps one journal entry per op, keeps the sliceLayers handle current
  (re-apply mints fresh ids), and stops replay's journal growth (adjacent to
  pending.md "Journal condensing" — fold the note in).

### 4. The unfiled clone-instance replay defect — its own gate row

sliceLayers does NOT cover clone-instance (no slice layers involved). The
A3-minted precedent DOES: journal `result.minted: [copy.id]` (consistency
with rows-mint/layer-apply; today the copy id rides only `dirtied[0]`,
supervisor.ts:804) and gate replay: the recorded copy id resolves to a live
(non-destroyed) node in `this.nodes` → skip; else re-apply (journal:false) +
refresh. This closes the 3→4-node doubling and the journal doubling with two
small changes. It is a **separate spec row** (its own red tests), folded into
the same implementation pass — it does not need its own user gate (no letter
collision; it only makes replay idempotent like every other kind).

### 5. What ships in this pass vs documented no-ops (the minimal set)

**IN THE PASS (engine):**
1. `result.sliceLayers` (+ hook pre-op values) recorded by the state-slice
   branch — the undo handle and the replay gate.
2. state-slice undo executor: removeLayer per recorded id (+ hooks anchor
   restore + created-vs-replaced handling) + the apply-side bookkeeping
   (`markPass2` on the node + the E2E-3 source/duplex consumer walk —
   supervisor.ts:666-674 mirror — which schedules the flush, :468-471) +
   destroyed-target guard + per-inverse try/catch + RUNTIME-WRITE BODY letter
   (no phases/handlers; pin).
3. replay gate (sliceLayers + hook value-equality + clone minted-liveness) +
   `apply(op, {journal:false})` redo/replay mode with in-place result refresh.
4. `result.minted: [copy.id]` for clone-instance (A3 consistency; the replay
   gate's handle).
5. Safety: undo/redo/replay prefer the entry's own live `Node` reference;
   id-resolution is only a fallback; destroyed targets skip silently.

**DOCUMENTED NO-OP (G14/§6 amendment, same pass, doc-only):** detach, move
(need pre-op `{parent, priority}`), clone-instance undo (retention
slot-stability collision — tombstone placeholder vs re-activation is a USER
GATE), layer-apply undo (OO-5 teardown ≠ faithful inverse — the one-line
`removeLayer(op.layerId)` shape is parked with its promotion-divergence note),
placement-attach undo (needs `wasNodeNew`/`containerAnchorMinted` + inverse
trigger; shared container anchor must survive), rows-clear + the `rows: []`
rows-mint clear variant (need the pre-clear record journaled). Each gets a
one-line "current behavior + parked fact-set" row — the no-op is no longer
silent.

### 6. Exact contract the implementation must satisfy

1. `apply` of a state-slice journals `result.sliceLayers: string[]` — the ids
   `node.applySlice` created (applySlice must return them; signature change
   internal to the supervisor call) — plus, per hook mutation, the pre-op
   `anchor.value`. No other `result` change. The journal remains never-serialized.
2. `undo()` of a state-slice: for each recorded id, `removeLayer(id)`; for
   each hook mutation, restore `anchor.value` (and the layer value when the
   op replaced a pre-existing hook layer; remove the layer iff the op created
   it). Then markPass2 the node + its source/duplex consumers (apply's E2E-3
   walk) — the flush is scheduled by markPass2. No `emitStructure` (state-slice
   has none in apply either). Never runs phases/handlers. Per-inverse
   try/catch; destroyed targets and missing layers are silent no-ops.
3. `replay()`: per entry — state-slice: skip iff every recorded sliceLayers id
   exists (hooks: layer exists AND `layer.value === op value`; clone-instance:
   recorded minted id resolves live in `this.nodes`); otherwise re-apply with
   `{journal:false}` and refresh the entry's `result` in place. Non-gated
   kinds keep today's re-apply behavior (same rejections, silent). Replay must
   NOT grow the journal.
4. `redo()`: pop the entry, re-apply with `{journal:false}`, refresh
   `entry.result`, push the SAME entry to undoStack; never clears redoStack
   beyond the pop. After apply→undo→redo→undo the value is the pre-op value
   and the journal holds exactly one entry for the op.
5. `undo()`/`redo()`/`replay()` resolve the op's node from the entry's own
   live reference first; `this.nodes.get(id)` only as a fallback. Undo on a
   destroyed node is a silent no-op (never throws `destroyed node writes are
   rejected`).
6. ops.md §6 gains a per-kind undo/redo-support table (supported: state-slice
   — exact via sliceLayers; attach — exact; destroy — pinned no-op; rows-mint
   — payload teardown; documented no-ops with rationale: detach, move,
   clone-instance, layer-apply, placement-attach, rows-clear, rows-mint
   `rows:[]` clear) and G14 is re-pinned to it. api.md §1.1's "undo/redo for
   free" line re-points to the table. The §6 "Journal contents" row records
   the additive result fields (`sliceLayers`, `minted`, hook pre-op values).
7. The existing contract pins survive: O13 (replay order + rejection
   reproduction), O14 (attach undo/redo), hooks-array pin 6 (rows-mint undo),
   hook-clear semantics, layer-apply OO-2/5.

### 7. TDD plan — red tests first (new file `tests/unit/journal-undo.test.ts`)

Write and RUN these against the current code first (all red today, except the
regression pins); then implement the least code that greens them:

1. **state-slice replace undo** — content `A0→A1`, `undo()` → `A0` (today: stays `A1`).
2. **state-slice append undo** — `['a']` + append `x`, `undo()` → `['a']`.
3. **multi-mutation single-op undo** — one op with content + props.append →
   both reverted by one undo.
4. **replaceAll / css / type / handlers undo** — one test per mode.
5. **hooks undo exactness** — first write: layer removed + anchor.value =
   authored fallback; SECOND write to the same name: undo restores the prior
   write's value and the layer survives (the amendment-1 pin).
6. **replay-append idempotency** — `['a']` + append x + append y, `replay()` →
   still `['a','x','y']`, journal length unchanged.
7. **replay-after-undo restores the stream** — append x, append y, undo,
   replay → `['a','x','y']` (only the undone entry re-applies).
8. **redo hygiene** — apply, undo, redo → post-op value; undo → pre-op value;
   journal length 1; no double-undo (the second pop must not exist).
9. **clone-instance replay** — apply clone (N nodes), replay → N nodes, no
   fresh copy, journal length unchanged.
10. **undo on destroyed node** — apply slice, destroy, undo → no throw, no-op.
11. **undo render honesty** — apply slice, undo, flush → compiled states
    reflect the undone value (pass-2 marking pin).
12. **gate soundness pin** — a layer-apply/rows-mint/hook-clear on the same
    node leaves earlier `slice-*` layers intact so replay skips correctly.
13. **Regression greens** — O13, O14, rows-mint undo (hooks-array pin 6).

### 8. Conditions / notes for the implementer

- `node.applySlice` must RETURN the created layer ids (and the supervisor
  captures them per mutation); the hook pre-op value is read from the anchor
  `hookWriteGuard` already resolves (one property read at apply time — no
  second resolution pass).
- `apply(op, {journal:false})` is internal-only (private or underscored);
  the public `apply` signature is unchanged.
- The partial-exists replay case is unreachable — pin with a comment, do not
  branch on it.
- Do NOT touch: clone-instance undo, layer-apply undo, detach/move/placement-
  attach/rows-clear inverses (documented no-ops this pass); `JournalEntry`
  result typing widens but no serializer changes exist to make.
- User-gated (parked with ready shapes, pending.md): clone-undo retention
  decision (tombstone placeholder vs re-activation), layer-apply teardown-as-
  undo one-liner, detach/move/placement-attach/rows-clear fact-sets.
- Doc hygiene (HANDOFF-5 line 112 cites `tests/journal-reversibility.test.ts`
  as repo-local; it is consumer-side — repoint or note, same class as the
  handoffs-review-3 finding).

### 9. Trackers (same pass)

- **docs/defects.md:** DEFECT-JOURNAL-UNDO row → fixed (sliceLayers landing,
  ref this review); DEFECT-JOURNAL-REPLAY-APPEND row → fixed (gate landing);
  NEW row DEFECT-CLONE-REPLAY-NONIDEMPOTENT (unfiled, fixed); the documented
  no-op kinds get a "documented contract (G14 amendment)" disposition row.
- **docs/decisions.md:** DECIDED — scoped undo contract: per-kind support
  table + recorded inverse facts + no-journal redo/replay with in-place
  refresh (source: this review §3-§6).
- **docs/pending.md:** park the clone-undo retention decision (user gate),
  the layer-apply teardown-as-undo shape, the detach/move/placement-attach/
  rows-clear fact-sets; note replay-growth as closed by the no-journal mode
  (adjacent to the existing "Journal condensing" row).
- **ops.md §6 + G14 + api.md §1.1:** the amendment per contract item 6.
- **designing-pages.md §11/§12:** update the test-use-case coverage matrix
  rows for undo/replay (no demo page changes; §12 unchanged beyond a
  journal-undo note if a page gains undo buttons — none planned).
- Validation trio gates completion (item 4, AGENTS.md): `npm test`, `npm run
  typecheck`, `npm run demo:smoke` — smoke profile totals must stay on-curve
  (the journal changes add O(#mutations) strings per state-slice entry; the
  fork-stress pages are state-slice-heavy, so watch the d12 totals stay within
  ~1.5× of the placement baseline and flag any blow-up).
