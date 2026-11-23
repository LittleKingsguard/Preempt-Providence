# Gate record — restore-time base-mutation detection (`P-CBM-1`)

**Status:** `PROCEED-AS-RESHAPED` — **BOTH STEPS LANDED.** Step 1: `tests/unit/condense-base-invariance.test.ts`
(no `src/**`). Step 2: the reshaped warn — the owner reviewed this record and ruled **"detection is acceptable"**
(2026-11-23), so it landed as specified in §5, with the red set `tests/e2e/base-mutation-detection.test.ts`
(BMD-1..6) and the contract amendments in §6 item 2.
**Date:** 2026-11-23 · **Process:** AGENTS.md item 9 (validity → critique independent/read-only, then
change-analysis) · **Proposal source:** offered to the owner as the "one middle ground" in the commit that recorded
`CONDENSE-BASE-IS-A-LIVE-VIEW`, accepted here for a gate by the owner's "proceed".

## 1 · What the proposal asks

The condensed journal base aliases live graph objects by design (`docs/decisions.md`
**`CONDENSE-BASE-IS-A-LIVE-VIEW`**: `condense()` stores `serializeSlice(...)` uncloned, so `content`, nested
`props`, anchor `value`, `derived`, `bodyRuns`, `batches[*].rows` and `css.cssDef` are the same objects the live
graph holds). The owner's ruling closed that as **intended**, declining both clone candidates and recording **"no
detection either … the violation is silent"** as the accepted cost.

`P-CBM-1` proposed adding **detection only**: digests the snapshot at `condense()`, recompute in `_restoreBase`'s
pre-flight, and on a mismatch emit **exactly one** `console.warn('restore-base-mutated: …')` and **continue** the
restore — warn-only, no refusal, no status change, no new `UndoRedoReport` value, no clone.

## 2 · What the three steps found

**Step 1 — validity (read-only).** `VIABLE ONLY AS MODIFIED`. The site and the cost class are right; but as written
it *is* the clause the fresh ruling forbids, it needs a hash helper (nothing in `src/` hashes anything),
`Supervisor.estBytes` **cannot be reused** (an order-insensitive size sum that short-circuits revisited objects to
`4` and live nodes to `8`), the recompute needs failure containment (a throwing `JSON.stringify` would escape into
`replay()`'s catch and **refuse** the restore, contradicting the proposal's own "continue"), and its coverage is
set by `serializeNode`'s copy strategy rather than by the contract it polices. Decisive unknown: whether the
engine's own sanctioned traffic leaves the base byte-identical — "an absence-of-writes claim over the whole
engine", which it could not verify without a shell.

**Step 2 — critique (read-only, adversarial).** `UNSOUND as specified`. Six arguments, in its order: (1) it fires
after the damage and then declines the only action detection enables — the pre-flight's five sibling checks
**refuse** while this one would warn and then re-seed from the base it just proved corrupt; (2) a `JSON.stringify`
digest can **silently disable the memory guard it is bolted to** — `css.cssDef` and `derived` are never
`assertJsonSafe`d, so a cyclic `cssDef` condenses fine today and would make every future condense
`condense-aborted` (unbounded journal growth); (3) it is blind to minted rows, the highest-mutation-rate objects;
(4) the false positives the proposal fears do not exist on *engine* traffic — the FP surface is host-side aliasing
(`batches[k].rows` **is** the host's `op.rows` array), so the first firing will read to a host as "the engine is
broken"; (5) "exactly one warn" is undefined and unbounded, because a mismatched base is never repaired; (6)
governance — it contradicts a ruling made minutes earlier and a **downstream notice already sent**. Its constructive
alternative: a **dev/test-only deep freeze**, which fires at the write site with a stack trace.

## 3 · The supervisor's measurements (both agents lacked a shell)

1. **A probe error I nearly reported as a finding.** On a rich page with `maxJournalLength: 3`, the base marker's
   bytes read `1883 → 2200` after sanctioned traffic — which looks like the engine retro-mutating the base. **It is
   not.** `maxJournalLength: 3` means a **later condense replaces the base marker** with a fresh, larger snapshot;
   the probe compared against the stale captured object. Recorded here because it is exactly the class of mistake
   the corpus keeps documenting: a measurement that reads as a defect and is an artefact of the measurement.
2. **Per-op bisect, plain page:** capturing the *same* base object and comparing `JSON.stringify` before/after each
   of `state-slice props.theme.mode` (dotted nested), `props.theme.depth.n` (deep), `props.theme` merge, top-level
   `props.tick`, nested `props.meta.tags`, `content`, `css.style` — **byte-identical after every one** (1347 each
   time).
3. **Per-op bisect, rich page** (the one with the aliasing: zone container + `children`-seam consumer): the same
   four `state-slice` variants, `clone-instance`, `undo`, `redo`, a rejected `placement-attach`, a rejected
   `attach`, and `replay()` — **byte-identical after every step** (1883 throughout).
4. **Aliasing is real; in-place mutation is not.** `#a.props.meta === baseContentEntry.props.meta` is **TRUE** (the
   base does share the nested props object with the live node), while `root.props.theme ===
   base.template.props.theme` is **FALSE** after a props write (the write replaced the live object rather than
   mutating the shared one).
5. **Consequence:** on the canonical recipes the digest's false-positive rate on **engine** traffic is **0** in the
   pre-restore window. Step 1's "replace-not-mutate is an unpinned invariant" is confirmed as the remaining
   exposure; step 2's kill shot 4 is confirmed; step 2's kill shot 1 (disposition) is rejected below; kill shot 2
   (containment) is accepted and dictates the implementation shape.
6. **A window nobody measured:** after a restore the live graph holds the base's carrier objects
   (`parseState` keeps them by reference), so the FP surface for a **second** restore extends across post-restore
   traffic. That case is added to the invariance test, and the 0-FP reading is evidence for the pre-restore window
   only.

## 4 · Verdict

**`PROCEED-AS-RESHAPED`.** The proposal is worth having **because it is the ruling's own reserved option** (the
decision row names it and says it "is a separate proposal, not a silent part of this ruling" — this is that
proposal's gate), and because it is the only instrument that observes traffic no fixture drives: a production host
writing through a reference it held across a condense. It gets the site right, the cost class right, and it stays
out of every worst option (no clone, no Proxy, no new status).

**The disposition ruling — WARN, not refuse** (step 2's headline objection, rejected on four grounds):
1. **Different question, different answer.** The five sibling refusals answer *"can this doc be re-seeded?"* — a
   mismatch answers *"is it the doc the channel recorded?"*. A mutated base is **internally coherent and
   re-seedable**; the ruling's own honest statement is "a restore returns the state the channel recorded, **or
   whatever you rewrote it into**".
2. **Refusing escalates beyond the ruling.** It converts a declared *unsupported* act into a *prohibited and
   enforced* one — and would force the `UndoRedoReport` vocabulary change this repo has declined twice by name.
3. **The asymmetry is unrecoverable in the wrong direction.** A `base` marker is only ever replaced by a later
   condense that passes the size guard; there is no repair path, so a refusal strands the host at
   `replay() !== 'applied'` forever, with clause (4) aborting the post-base re-applies — history permanently
   unreachable. A warn is ignorable; a refusal is not, and not reversible.
4. **Severity ordering cuts the other way:** corruption still yields a graph; invalidity yields none.

## 5 · The reshape (what step 2 would build, if the owner takes it)

1. **The digest is NOT seated on the journal entry.** `result` is pinned exactly
   (`tests/unit/journal-condensing.test.ts:152`) and `docs/specs/ops.md:331` pins the marker literally — both prior
   steps priced an amendment. **Unnecessary:** the journal is process-local and never serialized, so the digest
   belongs in a supervisor-private field keyed by marker id, written in `condense()` after the splice and read in
   the pre-flight. One document and one test re-pin drop out of the amendment set.
2. **`safeDigest` can never throw** (step 2's kill shot 2): computed outside `condense()`'s abort path; a throw or
   `undefined` ⇒ **no check runs**; at restore, a throw ⇒ **skip**, never refuse, never warn. A base that cannot be
   digested is silently unchecked rather than un-condensable.
3. **One warn per base marker**, re-armed by the next condense (`private baseMutatedWarnedFor: string | null`,
   compared to `marker.id`) — not a module-level never-cleared set (the `R-W4-5` starvation hazard).
4. **Attribution-honest message**, naming the shared carrier and saying the state is being restored: the engine
   itself captures host-owned objects, so this is not vandalism and must not read as an engine failure.
5. **Coverage is documented as the doc's alias-closure**, not as "the snapshot": the by-reference carriers ARE the
   retro-mutation boundary, and the surfaces the serializer **copies** (top-level `props` keys, `css.id/classes/style`,
   `children`, `hooks`, `anchor.options` top level) cannot rewrite the base — so their silence is correct, not a
   gap. A scalar written in place on a minted row's node is likewise correct-by-construction (the restore re-mints
   rows from the payload record).
6. **A pinned non-refusal clause** on `RESTORE-REFUSES-NOT-EMPTIES`, or the next reader "fixes" the asymmetry.

**Rejected permanently:** **refusal** (above); **deep `Object.freeze`** — freezing the base without the declined
clone freezes objects **the host owns** (`batches[k].rows` IS the host's `op.rows` array), so it would either throw
on a sanctioned host shape (a dev-only divergence, the worst class of guard) or require the clone; **any clone**
(both candidates stay declined).

## 6 · What lands, and in what order

1. **LANDED 2026-11-23 — `tests/unit/condense-base-invariance.test.ts`** (no `src/**`, no contract change). Pins
   the engine-side invariant *sanctioned writers replace, never mutate a captured carrier* — the fact both steps
   called unpinned, and the one that can become a real engine defect (a future `applyPropSlice` that mutates
   `props[key]` in place). Green on today's tree by measurement; red only when an engine path starts writing
   through a captured object. It promotes probes 2–4 and adds the post-restore window (probe 6). **Framing
   constraint:** it pins an **engine property**, not a host-mutation outcome, so it does **not** revive the
   "Red-first" requirement the ruling withdrew.
2. **LANDED 2026-11-23 — the reshaped warn** (the owner's "detection is acceptable"). It amends `CONDENSE-BASE-IS-A-LIVE-VIEW` clause (2) ("no detection")
   and requires a **delta notice downstream** (`docs/handoffs-note-condense-base-2026-11-23.md` §1 currently
   promises "no warn, no status"). Amendment set if taken: that decision row's clause (2) + its "not taken" tail,
   `docs/specs/serialize.md`'s base bullet, `docs/skills/designing-pages.md` §5.4, the defect row's evidence cell,
   `docs/next-steps.md` §1, and the handoff note's §4. Landing class: `X.X.Y` (a diagnostic, no public signature
   change) — it rides `0.6.x` and must **not** be folded into the `0.6.0` row as a contract change.
3. **Never:** refusal, freeze, clone.

## 7 · What a future reader must not re-litigate

The condensed base aliases the live graph **by design** and neither clone will be added — that is settled
(`CONDENSE-BASE-IS-A-LIVE-VIEW`). Mutating a captured object in place is **unsupported, not prevented**; whether it
is *silent* is the only open question, and this gate's answer is one **bounded, non-refusing** warn. Do not close
the "inconsistency" by refusing (a mutated base is re-seedable; the five pre-flight refusals answer a different
question; a refusal makes recorded history permanently unreachable over a state the contract calls correct). Do not
propose a deep freeze (it would freeze objects the host owns). Do not widen detection to "the whole graph" —
coverage is the doc's alias-closure, which **is** the complete retro-mutation boundary. The engine invariant is
pinned by `tests/unit/condense-base-invariance.test.ts`, so a future in-place write fails CI instead of a host's
undo stack. Everything above is measured; re-opening it requires new measurement, not a new argument.
