# Feature 3 — Journal condensing (three-agent gate, step 3 — change-analysis)

Date: 2026-08-25. Source: `docs/next-feature-batch-0.2.0.md` §Feature 3 (§3.18-3.20)
+ §User rulings 17-22 (2026-08-24). Companion context:
`docs/specs/handoffs-review-5.md` (Feature 1a — the round-trip + def census,
the base's substrate), `docs/specs/handoffs-review-6.md` (Feature 1b — the
keyField carry + residual 9, the base composition), `docs/specs/handoffs-review-4.md`
§3/§5 (the no-journal replay mode + the host-class facts: the Electron/MCP
host never calls undo/replay), `docs/specs/serialize.md` §3/§4 (the reseed
recipe + the round-trip residuals SER-H8/S4/minted-id), `docs/specs/ops.md`
§6/G14 (the journal contract + the per-kind undo table), `docs/specs/contract.md`
(the journal pins), `src/core/{supervisor,serialize,ops,node,resolve,registry}.ts`.

Steps 1 (validity — VIABLE-WITH-RESHAPE) and 2 (critique — NEEDS-RESHAPE,
H1-H4 + paradigm/perf/safety/robustness) ran before this pass; the step-3
verdict lands here in the compile-horizon-review format. This agent is
READ-ONLY — no files edited except this verdict. The five user rulings
(17, 18, 19, 21, 22) are FIXED and not relitigated; D1-D10 pin the mechanics
the rulings left open. Verdict-only pass — the trio was not re-run here.

## Step 1 — Validity agent (summary)

Verdict: VIABLE-WITH-RESHAPE. The mechanics (auto-trigger on a configurable
`maxJournalLength`, journal rewrite, undo-stack truncation, the
replay-from-base branch, the base-boundary undo guard) are implementable
against the current supervisor. The base CAPTURE as stated is NOT viable: the
serializeSlice class has no layers field (hook reads key on layers,
resolve.ts:25-29; layer-apply/rows idempotency, ops.ts:168/287; the replay
gates, supervisor.ts:1068-1085), derived/minted nodes never serialize
(serialize.ts:181-182; layer-apply mints, ops.ts:180, and clone copies,
node.ts:826, have NO recovery record — silent loss; rows recover via the
batches records), plain def prototypes are not in `allNodes()`, a restore
needs graph-REPLACE semantics (eviction + tombstone clear + registry
eviction), `assertJsonSafe` throws inside apply, the doc has no root field,
the serialize is O(graph) and synchronous, post-restore compile/dirtiness is
undefined, `dispatchAndReport`'s dirtied read could undercount, and the
clone-instance replay gate needs an absent-id fix. Step-1 proposed fix: extend
serialization with a layers field (handler-layer exclusion).

## Step 2 — Critique agent (summary)

Verdict: NEEDS-RESHAPE. Four HIGH externalities + a structural challenge:
- **H1 (HIGH)** — handler loss is STRUCTURAL: `RenderNodeState` has no
  handlers field; journal op payloads carry function bodies (replay reproduces
  them today); a snapshot cannot carry functions (`assertJsonSafe` throws on
  functions). Post-condense replay == handler-less graph. The ONLY alternative
  to accept+document is a journal-native capture contradicting the
  serializeSlice framing.
- **H2 (HIGH — challenges step-1's fix)** — a layers field is representational
  double-booking: `serializeNode` ships the pass-1 MERGED canon; restoring
  layers on top double-represents css.classes REPLACE (node.ts:960), handlers
  D16 append, derived merges. The clean answer: MERGED-STATE-ONLY restore
  (layer-absent gates naturally re-apply; hook values ride `anchor.value`;
  `providerValueFor`'s fallback is exactly this design).
- **H3 (HIGH)** — undo-after-replay-from-base silently no-ops: `undo()`
  resolves only live refs (supervisor.ts:1092-1099), no id-resolution fallback;
  a graph-REPLACE restore leaves every post-base `op.node` stale → every
  post-base undo silent. Needs re-pointing by id, in-place restore, or
  documented-unsupported.
- **H4 (HIGH)** — in-process registry eviction + async-sweep race: module-level
  `registered`/`byId`/`contentNodes`/`mintedByLayer`/`defPrototypes` are never
  cleared by loadState; stale objects stay in `registered` (sweep compiles
  them), `mintedByOrigin` returns OLD ids → `rowsTeardown` cross-destroys
  zombie state; the async sweep (setTimeout 0) can finalize mid-restore.
- **Paradigm** — splice-replace violates the documented "journal stays
  append-only for replay" pins (ssr-synthetic-event.md §3.2, contract.md:222,
  ops.md §6/G14 "sufficient to replay or invert") — needs same-pass spec
  amendments.
- **Performance** — O(graph) sync serialize inside apply() is a latency spike
  (d14 = 16383 nodes); memory win is data-shape-dependent (rows-heavy graphs
  duplicate batch records — can REGRESS); needs a size guard.
- **Safety** — `dispatchAndReport` throws on undefined marker result (must
  define a `result` shape); replay must branch on 'base' before apply();
  condense failure containment; `suppressJournal` gate for the check.
- **Robustness** — time-capsule across engine upgrades (a marker never
  re-validates on the current engine; schema drift → journal unreplayable);
  restore must be re-runnable (rows re-mint → id drift per replay).
- **Bottom line** — architecturally coherent as a CHECKPOINT, but repurposes a
  pristine-snapshot serializer (SER-R1) for live-runtime state it cannot
  represent; the simplest alternative — journal length cap + warn + host-prune
  API, no snapshot, no contract break, replay preserved for the capped window —
  deserves a fair comparison.

## Step 3 — Change-analysis agent (verdict)

Status: **PROCEED-AS-RESHAPED** — the proposal and the five user rulings are
sound and implementable, but the executor must land the reshaped shape below.
The central adjudication that resolves the H1 "structural challenge": **the
base is not a repurposing of the serializer — it IS the already-documented
round-trip recipe, run in-process.** The base marker's snapshot is a
`SerializedRenderDoc` built by the EXISTING `serializeSlice`, and the restore
is the EXISTING `serialize.md` §3 reseed recipe (loadState → seed with the
same hub → reconcileParentTargets → reRegisterDefPrototypes → re-mint rows).
Every caveat step-2 calls a "challenge" (handler loss, minted-id instability,
layers-merge, link-id instability) is ALREADY DOCUMENTED CONTRACT for the
round-trip (serialize.md §4, SER-H8, SER-R1) — the base simply inherits it. So
the confirmed ruling-18 shape does not need to be contradicted by a
journal-native capture (rejected, D2): it needs the round-trip caveats
applied to the base + the in-process mechanics that are genuinely NEW
(graph-REPLACE eviction — H4/D4, undo re-pointing — H3/D3, the deferred
condense + size guard — D5, the marker/replay branch — D6, and the same-pass
append-only contract amendments — D7). The two largest reshapes: **(D1) NO
layers field — merged-only restore wins H2** (the ruling-18 "layers" are
satisfied as layer-DERIVED state, which is exactly what SER-R1 proves the
round-trip reproduces), and **(D2) handler-faithful replay is bounded to the
post-base window, documented as SER-H8 inheritance** — not a contradiction of
the serializeSlice framing. The step-2 simplest alternative (cap + warn +
host-prune) is recorded (§Costs-benefits) and REJECTED as the landed shape:
it cannot serve the replay-for-assertion need of the long-lived agentic host
that the confirmed rulings target, and the host-facing prune API would re-open
the user-deferred `reset()`/`prune()` row (ruling 22).

### What the proposal asks

Auto-condense the Supervisor journal when a configurable `maxJournalLength` is
exceeded (absent = never — ruling 17): replace the pre-boundary entries with
ONE `base` marker entry (`op: {kind: 'base', snapshot}` — an inline
serialized-graph capture in the serializeSlice/loadState class: node states +
anchors + layers + batches + defPrototypes, NOT a re-execution — ruling 18).
`replay()` on a base marker = base restore + post-base no-journal re-apply
with the existing sliceLayers/minted gates. Undo crossing the base warns +
fails (ruling 19 — never a silent no-op); undoStack truncates to post-base;
redoStack clears. reset() deferred (ruling 22). requestId/takePass2
non-interference (ruling 21). TDD: journal-condensing.test.ts.

### Feasibility verdict — the executor shape (all 10 decisions)

**The base is the round-trip recipe (D1).** The base marker's `snapshot` is a
`SerializedRenderDoc` from the EXISTING `serializeSlice(root, authoredKids)`
(serialize.ts:174) — template + content (authored-only; derived/minted rows
excluded by the pin-4 filter, serialize.ts:181-182) + `batches` records (with
the 1b `keyField`) + the 1a `defPrototypes` census. The restore is the
`serialize.md` §3 recipe executed in-process: `loadState` → seed with the SAME
hub → `reconcileParentTargets` → `reRegisterDefPrototypes` → `registerNode`
per node → re-mint rows per batches record (step 4.5). NO new capture path, NO
new schema.

**D1 — NO layers field: merged-only restore (H2 adjudicated for step-2).**
The ruling-18 "layers" in the base shape are satisfied as layer-DERIVED state,
which is what the serializer already captures: `serializeNode` ships the
pass-1 MERGED canon (`type`/`props`/`css`/`content` — node.ts:946-1002), and
SER-R1 is precisely "compile yields equal render-relevant state" for that
canon. The layer effects that matter round-trip without a layers field:
- **Hook VALUES** are mirrored into `anchor.value` at write time
  (node.ts:1501, `applyHookSlice`) — serializeNode already ships `a.value`, and
  `providerValueFor` (resolve.ts:25-29) falls back to `anchor.value` when the
  `hook-<name>` layer is absent — the same value. Verified: merged-only
  restores live hook values.
- **`slice-*` layer value effects** (props/css/content/type/handlers-clear)
  are in the merged canon; a restored layer STACK would double-represent
  css.classes REPLACE (node.ts:960), handlers D16 append, derived merges
  (step-2's exact double-booking) and would fight the post-base replay gates.
- **Handler layers** carry compiled FUNCTIONS (HandlersDef.body,
  handlers.ts:102) — they cannot serialize at all (`assertJsonSafe` throws,
  serialize.ts:78-79), so step-1's "layers field with handler-layer exclusion"
  buys nothing for the only layer content that does not round-trip.
- **Batch layers** are re-created by the re-mint (fresh decls, step 4.5).
CONSEQUENCE (recorded): the literal layer-STACK structure is a documented-as-
lost residual (D9); the layers' VALUE effects survive via the merged canon.
The replay gates for POST-base entries reference post-base layers only (they
exist from the live apply) — the layer-absent restore re-applies idempotently
(a re-applied hook write with an equal value short-circuits, node.ts:1495).
**ADV-S22 (2026-08-25 adversarial pass):** the "merged-only, no layers" claim
holds for the BASE CAPTURE only — a POST-base hook write, when replayed after
a restore, re-creates its `hook-<name>` layer on the restored graph (the
re-apply goes through the normal apply path). The VALUE is correct; the
post-restore graph carries the layer (the D1 claim is scoped to the base's
serialized state, not the post-base re-apply's live layer stack).

**D2 — handler-faithful replay is bounded to the post-base window (H1
adjudicated: SER-H8 inheritance, not a contradiction).** The base is JSON-safe
by construction (the serializeNode boundary), so function bodies cannot ride
it. This is the SAME documented caveat as the round-trip (serialize.md §4
SER-H8; handlers.md §6 — hosts re-supply bodies by name via the seam). The
Feature 3.19 claim "reproduces the full stream exactly" is AMENDED to:
**"reproduces the post-stream RENDER-RELEVANT state exactly (SER-R1) via the
base restore + the post-base no-journal re-apply; handler BODIES stay in the
post-base window only (SER-H8) — pre-base handler-bearing graphs restore
handler-less and the host re-supplies bodies by name if dispatch is needed."**
Post-base handler ops replay fine (their payloads are still in the journal);
post-base dispatch is unaffected. A journal-native (function-carrying) base is
REJECTED: it contradicts the CONFIRMED serializeSlice framing (ruling 18), adds
a parallel capture path, and buys an ability (pre-base dispatch after restore)
no documented host currently exercises. The honest consequence is recorded, not
hidden.

**D3 — undo/redo re-point by id (H3 adjudicated).** A base restore destroys
the pre-base node OBJECTS and seeds fresh ones with the SAME ids
(serializeNode ships `node.id`). replay() already re-resolves a destroyed live
ref by id (supervisor.ts:1043-1045) — this is what makes the post-base half of
replay-from-base target the new graph. undo()/redo() resolve ONLY the live ref
and silently bail on a destroyed target (supervisor.ts:1098-1099) — the H3
silent no-op. Fix: undo/redo gain the SAME fallback (`this.nodes.get(id) ??
op.node`) applied ONLY when the live ref is destroyed, with the handoffs-
review-4 §5 wrong-node-hazard note (prefer the live ref; id-resolution is the
tombstone convenience; the instance-guarded byId eviction, registry.ts:290,
protects shared-id processes). Consequence: undo of a POST-base entry after
replay-from-base operates on the new graph (removeLayer of the post-base
sliceLayers / the rows-mint preRecord re-apply target the new node) — correct.
In-place restore REJECTED (no loadState reuse, every field/anchor mutation
in place, minted identity churn); documented-unsupported REJECTED (a silent
no-op on the supported post-base kinds violates the engine's never-silent
doctrine and ruling 19's spirit). The base marker itself stays never-undo-able
(ruling 19 — the undoStack truncates at condense; a stale reference to the
marker warns `base-boundary` + fails).

**D4 — the base restore is a SYNCHRONOUS graph-REPLACE critical section (H4
adjudicated).** New INTERNAL primitive (REQ-GAP-11 discipline — never
host-facing), `_restoreBase(snapshot)`, runs in ONE synchronous block:
1. drain `pendingDestroy` + synchronously finalize + `evictDestroyedNode`
   (registry.ts:284-293 — the existing eviction primitive clears
   `registered`/`byId`/`contentNodes`/`mintedByLayer`; instance-guarded byId)
   every pre-base node;
2. clear the supervisor's `this.nodes` + the batch/hook bookkeeping;
3. run the §3 recipe (D1) — seed + re-register + re-mint (FRESH row ids, the
   serialize.md §4 residual);
4. schedule a FULL pass-2 refresh (every restored node remote-dirty) — no
   stale compiled states, and the `dispatchAndReport` dirtied read
   (supervisor.ts:325-326) sees a consistent window.
The async sweep (setTimeout 0, registry.ts:225-232) cannot interleave: the
step-1 drain + the synchronous critical section guarantee the sweep never
finalizes a NEW seed. The shared-id protection is the instance-guarded eviction
precedent (registry.ts:290). Restore re-runnability (step-2 robustness): the
recipe is idempotent-per-call — a second restore drains the first restore's
nodes the same way; rows re-mint fresh ids each time (documented id drift).
**ADV-S6 (2026-08-25 adversarial pass):** after a replay-from-base (graph-
REPLACE), a HOST must issue subsequent ops against RE-RESOLVED node references
(`sup.getNode(id)`) — the old pre-restore node objects are evicted, and a
keyed update issued against a stale creator object degrades (fresh ids, the
old rows orphaned). The engine's keyed reuse is correct given a live target.
**ADV-S5 (2026-08-25):** the restore's internal re-mint is a QUIET apply
(`quiet:true`) — no `before-compile` phase handlers fire and no
`structure:rows-mint` event is emitted for the restore itself.

**D5 — the condense is deferred off apply()'s hot path + size-guarded +
contained.** The `maxJournalLength` check stays O(1) after each applied op
(ruling 17). The condense itself (O(journal) + O(graph) serialize) runs on a
microtask AFTER the triggering op returns — single-threaded JS gives a
consistent snapshot with no interleaving op, and the d14 = 16383-node sync
serialize never blocks apply (step-2's latency spike, resolved). Size guard
(the honest memory-win guard): if the built base's estimated size ≥ the
pre-base journal's estimated size, warn `condense-skipped-size` + skip (the
journal keeps growing; the host raises maxJournalLength). Failure containment:
the condense runs in try/catch — a serialize throw (a function/circular value
in a node's props/content hits `assertJsonSafe`) aborts with `condense-aborted`
warn and the journal is UNTOUCHED (never a partial rewrite). The
`suppressJournal` gate covers the length check: replay/redo no-journal
re-applies never trigger a condense (the journal is not growing).
**ADV-S10 (2026-08-25 adversarial pass):** a tiny `maxJournalLength` (0/1)
causes PER-OP deferred condensing — a full O(graph) serialize on a microtask
after every op. A host should set the threshold well above the steady-state
post-base entry count to avoid per-op condensing.
**ADV-S14 (2026-08-25):** a graph whose root is NOT `rootNode`-token-
terminated condenses SILENTLY (the `if (!root) return` is a no-op with no
warn). Condensing requires a `rootNode`-token root; a non-rooted graph never
condenses. A host that expects condensing should ensure its root carries the
token.

**D6 — the base marker shape + the replay branch + stack hygiene.** The marker
is `{ id: 'journal-<seq>', op: { kind: 'base', snapshot: SerializedRenderDoc },
result: { status: 'base' } }` — a DEFINED `result` shape (step-2 safety): the
`dispatchAndReport` window read (`entry.result.dirtied`, supervisor.ts:325-326)
tolerates the base entry (absent/empty dirtied adds nothing to the union — the
window's other entries still contribute — no undercount; a throw on undefined
marker result is impossible). replay() branches on `kind === 'base'` FIRST —
before the apply() dispatch and before the idempotency gates (the base is not a
state-slice/clone so the existing gates already skip it, but the branch runs
the D4 restore, never apply). The base marker is NEVER pushed to undoStack
(`journalIfApplied`'s push is bypassed for the base kind); redoStack CLEARS at
condense (a pre-base entry lingering in redoStack would re-apply an op already
represented in the base → double-apply); undoStack truncates to the post-base
entries (ruling 19's guard — post-base undo stays legal). The condense runs
with journaling suppressed and never creates a nested journal entry.

**D7 — the append-only contract amendments land SAME-PASS (step-2's paradigm
point).** The pins — ssr-synthetic-event.md §3.2 ("the journal stays
append-only for replay"), contract.md:222 ("replayable op stream, appended by
apply()"), ops.md §6/G14 ("journal contents sufficient to replay or invert") —
are amended in the same pass as the implementation to: **the journal is
append-only BETWEEN condensations; a condense rewrites the pre-base window into
ONE base marker (the boundary is recorded; the base is NOT entry-by-entry
replayable — recorded contract); replay-from-base = base restore + post-base
no-journal re-apply.** ops.md §6 gains a `base` row in the per-kind table
(kind `base`: never undo-able; replay restores; journal result `{status:
'base'}`). contract.md's `Supervisor` surface gains `maxJournalLength?` in the
constructor init (absent = never, ruling 17).

**D8 — rows-bearing and def-bearing bases compose (handoffs-review-6 residual
9 confirmed).** The base carries the batches records (with keyField, 1b) + the
defPrototypes census (1a); the restore re-mints rows per record (fresh ids —
the serialize.md §4 residual) and re-registers defs per census. No
base-specific change to the 1a/1b machinery; the base is one more consumer of
the round-trip recipe.

**D9 — the scope boundary (what the condense MUST include vs documented-as-
lost).** MUST include (the base): merged node states (pass-1 type/props/css/
content), anchors + values (incl. hook-mirrored live values), derived RULES
(never baked values), hooks/hooksKind names, batches records (row payloads +
keyField), the defPrototypes census. DOCUMENTED-AS-LOST (the residual list,
§Gaps): handler bodies (SER-H8), the literal layer STACK structure (value
effects preserved via the merged canon — D1), minted-row node ids (fresh on
re-mint), link ids, entry-by-entry replay granularity (the base is not
replayable entry-by-entry — recorded contract), undo-before-base (ruling 19).
The "reproduces the full stream exactly" claim becomes the SER-R1
render-relevant-state guarantee + post-base re-apply (D2).

**D10 — performance + ruling-21 integrity.** The condense is O(journal) +
O(graph) once per trigger on a microtask (D5); the length check is O(1). The
base REPLACES the pre-base entries: post-condense memory = O(graph) +
post-base entries, asymptotically ≤ the pre-condense O(M) journal when
M·avgEntry ≫ O(N) — the honest memory win; the D5 size guard protects the
regression case. The fork-stress/derived-fork tripwires are unaffected (the
condense adds no per-op work; the smoke's profile totals stay on-curve).
Ruling 21 holds: the condense touches ONLY the journal + the graph — never the
`dispatchDedup` LRU, never `takePass2States` (a microtask-deferred restore
cannot be observed mid-dispatch by a non-interleaving host).

### Gaps + costs-benefits

**Is it a good idea? The honest comparison (task 1).** Host facts
(handoffs-review-4 §5): the Electron/MCP host uses `dispatchAndReport` +
`renderProducingProcess` and NEVER calls undo/replay; the journal is
memory-only (no scan cost); the long-lived agentic/batch host is the only
caller that COULD replay for assertion.
- **(a) Full condensing (this reshaped shape):** buys bounded memory (O(M)
  journal → O(N) base) AND full-stream replay for the agentic host (base
  restore + post-base re-apply). Costs: the in-process graph-REPLACE machinery
  (D4), the undo re-point (D3), the documented handler-loss (D2), the same-pass
  contract amendments (D7), one O(graph) serialize per condense (D5). It is
  CONFIG-OPT-IN (absent = never) — a never-replay Electron host simply does not
  enable it, so the "overkill for Electron" concern is a non-issue.
- **(b) cap + warn + host-prune (step-2's simplest alternative):** buys bounded
  memory at near-zero engine cost, replay preserved for the capped window.
  Costs: full-stream replay is IMPOSSIBLE (pruned ops are gone — the agentic
  host loses deep-history assertion, the very need the confirmed shape targets);
  a host-facing prune API re-opens the user-DEFERRED `reset()`/`prune()` row
  (ruling 22); the condensing memory win is achieved but the replay value is
  not.
- **(c) middle (cap + host-prune + host-side checkpoint):** the host
  periodically runs the EXISTING round-trip and clears the journal — the same
  capability as (a) minus the auto-trigger. But ruling 17 CONFIRMED auto-trigger
  and ruling 18 CONFIRMED the base shape; (a) IS (c) with the engine doing the
  round-trip automatically. No distinct third shape survives the rulings.
- **Honest memory-win analysis:** condensing wins when M·avgEntry ≫ O(N)
  (long-lived host, many ops per graph node) — the asymptotic case condensing
  exists for; it can REGRESS for small M (many nodes, few ops), guarded by D5.
  For rows-heavy graphs the base's batches records duplicate the LATEST rows
  while REPLACING every prior row-bearing entry — a net win as M grows, never a
  steady-state regression once past the trigger point.

**What the feature does NOT promise (the residual list, §Contract wording):**
1. Handler bodies across the base (SER-H8 — D2; the same caveat as the
   round-trip; hosts re-supply by name).
2. The literal layer STACK across the base (value effects survive via the
   merged canon — D1; the layer IDs/structure are runtime-only).
 3. Minted-row node id identity across the base (fresh ids on re-mint —
    serialize.md §4).
 3b. **runtimeMinted CLONE-INSTANCE nodes are LOST across the base
    (2026-08-25 ADV-S20 — DOCUMENTED, not fixed):** the pin-4 serialize-exclude
    (serialize.ts:181-182) drops every `runtimeMinted`/`originLayer` node from
    the base, and a `clone-instance` has NO recovery record (rows re-mint via
    the batches records, clones do not). A pre-base clone therefore does NOT
    survive replay-from-base. This is an acknowledged scope limit (a clone is
    runtime-derivative, like a minted row — but with no re-mint carrier). A
    host that needs clone survival across a condense must re-clone after the
    restore (the clone-instance op is journaled post-base if issued after).
 4. Link id identity (never round-trips — serialize.md §4).
5. Entry-by-entry replayability of the base (recorded contract, ruling 18).
6. Undo across the base boundary (ruling 19 — warn + fail, never silent).
7. reset()/prune() (ruling 22 — the base is not reset-able by design).
8. No new public surface beyond `maxJournalLength` in the supervisor init + the
   internal `_restoreBase` primitive (REQ-GAP-11 minimal-surface discipline).
9. Schema-drift immunity: a base marker is a `SerializedRenderDoc` re-validated
   by `loadState` at restore time (the existing schema boundary) — a marker
   written by an OLDER engine fails `NodeSchema-shape-mismatch` contained at
   restore (step-2 robustness, addressed by reusing the existing boundary
   instead of a new marker schema).
10. The blind-test loop (AGENTS.md item 10, Mimo-2.5): the condensing demo arm
    goes through the writer/proofreader/page-reviewer loop like the 1a/1b demo
    work.

**Costs:** the supervisor gains the `maxJournalLength` init field + the
O(1) post-apply check + the microtask-deferred condense + the `base` replay
branch + the D3 undo/redo id-fallback + the internal `_restoreBase` (D4);
ops.md §6/G14 + contract.md + ssr-synthetic-event.md §3.2 + serialize.md §4
gain the amendments; the TDD file journal-condensing.test.ts.

**Benefits:** bounded journal for long-lived hosts (the trigger), full-stream
replay preserved for the assertion host (base + post-base), zero hot-path
cost, config-opt-in (absent = never), composed with the landed 1a/1b round-trip
machinery, every caveat a DOCUMENTED round-trip inheritance rather than a new
contract break.

### Contract (the implementation must satisfy)

1. `Supervisor` init gains `maxJournalLength?: number` (absent = never, ruling
   17). The O(1) check runs after each journaled apply; replay/redo re-applies
   never trigger it (D5).
2. Condense: defer to a microtask; build the base via `serializeSlice` (D1);
   size-guard (D5); failure-contained (D5); rewrite the journal to ONE
   `{kind: 'base', snapshot, result: {status: 'base'}}` marker (D6); undoStack
   truncates to post-base; redoStack clears; the marker is never pushed to
   undoStack.
3. `replay()` branches on `kind === 'base'` FIRST → `_restoreBase(snapshot)`
   (D4), then the post-base entries re-apply no-journal with the existing
   gates + id-resolution (D3).
4. `undo()`/`redo()` re-resolve a destroyed live ref by id (D3) — post-base
   undo after replay-from-base operates on the new graph; the base marker
   itself warns `base-boundary` + fails (ruling 19).
5. `_restoreBase` (internal, D4): synchronous drain + evict → clear `this.nodes`
   → §3 recipe (seed with the same hub → reconcileParentTargets →
   reRegisterDefPrototypes → registerNode → re-mint rows) → full pass-2
   refresh.
6. Same-pass spec amendments (D7): ops.md §6/G14 + contract.md:222 +
   ssr-synthetic-event.md §3.2 + serialize.md §4 + api.md §1.1.
7. Pins that must stay green: BH-N.4, hooks-array pins 3-8, journal-undo,
   keyed-batch-reuse, rows-mint-guardrails, def-roundtrip (10), the
   fork-stress/derived-fork profile watches (the smoke's `[derived-fork:baseline]`/
   `[derived-fork:pin]` totals — the condense adds no per-op work).

### TDD list (the red set — `tests/unit/journal-condensing.test.ts`, a NEW file)

Red (all fail before implementation):
1. **Trigger** — `maxJournalLength` set → a condense fires after the journal
   exceeds it (the pre-base entries become ONE base marker); absent → never
   condenses (ruling 17); the check never fires on replay/redo (no-journal).
2. **Base marker shape** — the marker is `{kind: 'base', snapshot}` with
   `result: {status: 'base'}`; the snapshot is a valid `SerializedRenderDoc`
   (template/content/batches/defPrototypes as present); undoStack truncates to
   post-base; redoStack clears; the marker is never undo-able.
3. **Replay-from-base (state)** — apply a state-slice sequence, condense, then
   replay(): the base restore + post-base re-apply reproduces the post-stream
   render-relevant state exactly (SER-R1) — props/css/content/type/anchor
   values equal.
4. **Replay-from-base (hook values)** — a pre-base hook write survives the
   restore via `anchor.value`; `providerValueFor` returns the live value after
   replay (D1 — merged-only restore preserves hook values).
5. **Replay-from-base (rows)** — a pre-base rows-mint re-mints per the batches
   record (fresh ids, row count + values equal); a keyed record re-mints with
   keyField intact (D8; compose with 1b).
6. **Replay-from-base (defs)** — a pre-base def-bearing graph re-registers per
   the census (D8; compose with 1a).
7. **Undo after replay-from-base (D3)** — condense, replay-from-base, then undo
   a POST-base op: the inverse operates on the restored graph (sliceLayers
   removed / rows preRecord re-applied) — never a silent no-op.
8. **Base-boundary undo guard (ruling 19)** — an undo that would cross the
   base warns `base-boundary` + fails (never a silent no-op, never a partial
   restore).
9. **Graph-REPLACE eviction (D4)** — after a restore the pre-base nodes are
   evicted from `registered`/`byId`/`contentNodes`/`mintedByLayer`; the sweep
   does not compile zombie state; `mintedByOrigin` returns only live rows; the
   async sweep never finalizes a NEW seed (no cross-destroy).
10. **Condense failure containment (D5)** — a node whose props/content carries
    a function → `condense-aborted` warn, the journal UNTOUCHED (no partial
    rewrite); a later clean condense succeeds.
11. **Size guard (D5)** — a base estimated ≥ the pre-base journal →
    `condense-skipped-size` warn, no rewrite.
12. **No hot-path latency** — the condense is deferred (a tight apply loop
    returns without an inline O(graph) block; the restore runs on the
    microtask).
13. **requestId/takePass2 non-interference (ruling 21)** — a condense between
    dispatches never drains `takePass2States`, never touches the `requestId`
    dedup LRU; the dispatch window's `dirtied` union is not undercounted by the
    base entry (D6).
14. **Replay-loop uniformity** — replay walks the base marker + post-base
    entries uniformly; the post-base entries re-apply with their existing
    gates (state-slice sliceLayers / hook value-equality / clone minted /
    rows-mint idempotency); the base never reaches apply().
15. **Regression greens** — BH-N.4, hooks-array pins 3-8, journal-undo,
    keyed-batch-reuse, rows-mint-guardrails, def-roundtrip, rows-fanout.

Green: implement the supervisor init field + the deferred condense + the base
replay branch + `_restoreBase` + the undo/redo id-fallback + the same-pass
spec amendments; verify `npm test`, `npm run typecheck`, `npm run demo:smoke`
(incl. the profile watches + the `[derived-fork:baseline]`/`[derived-fork:pin]`
totals), `npm run build`.

### Notes for the implementer

- The base is ONE more consumer of the existing `serializeSlice`/`loadState`
  recipe — reuse it verbatim; do NOT build a parallel capture path.
- The D3 undo/redo id-fallback mirrors the EXISTING replay resolution
  (supervisor.ts:1043-1045) — a three-line symmetric change; the wrong-node
  hazard note (handoffs-review-4 §5) applies (prefer the live ref, fall back by
  id only for a destroyed target).
- `_restoreBase` is internal and synchronous (REQ-GAP-11 discipline); the
  instance-guarded byId eviction (registry.ts:290) is the shared-id
  protection to reuse.
- The base marker's `result` is defined (`{status: 'base'}`) so the
  `dispatchAndReport` window read never dereferences an undefined shape.
- The demo-page condensing arm goes through the AGENTS.md item-10 blind-test
  loop (Mimo-2.5) before completion.

### Trackers (same pass as the landing)

- `docs/specs/ops.md` §6/G14 — the `base` row + the append-only-between-
  condensations amendment (D7).
- `docs/specs/contract.md` — the journal pins + the `maxJournalLength` init.
- `docs/specs/ssr-synthetic-event.md` §3.2 — the append-only amendment (D7).
- `docs/specs/serialize.md` §4 — the base inherits SER-H8/S4/minted-id
  residuals (D2/D9).
- `docs/next-feature-batch-0.2.0.md` §Feature 3 — the gate verdict + the
  executor shape + D1-D10 pinned.
- `docs/decisions.md` — the journal-condensing decision row (D1-D10).
- `docs/defects.md` — none new; the review findings are verdict notes.
- `docs/pending.md` — the "Journal condensing" SPECULATIVE row flips to
  PLANNED/landed-shape (2026-08-25).
- `docs/next-steps.md` — the work-queue entry for the Feature-3 TDD pass.
- `docs/skills/designing-pages.md` §11 coverage matrix + §12 demo pages (the
  condensing demo arm) per AGENTS.md item 3.
