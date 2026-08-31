# Scope — Cordis Spatiotemporal Composability on Provident-ssr (separate workstream)

**Status**: SCOPED AS A SEPARATE PARKED WORKSTREAM (user directive 2026-08-31;
proposal-gate decision from `docs/specs/script-dsl-review.md`). Nothing here
ships; this is the recorded scope + constraints for a future, independent
proposal. The script-DSL proposal (R1/R2) is a DIFFERENT workstream and is
parked separately — these two share almost no machinery.

**Source**: user follow-up to the script-DSL proposal — "Given the existing
idempotent behavior of the Provident framework, would it be possible to
implement the composeability features defined in the Cordis meta-framework and
what additional changes/features beyond the above would be required".

**Cordis reference**: *A Programming Paradigm for Spatiotemporal Composability*
(Yifan Shi, Wei Zhang, Tianyi Cui — 92 pp, `/home/ryanr/Downloads/Cordis.pdf`,
text at `/tmp/cordis_full.txt`). Two dimensions: TEMPORAL composability
(revertible effects — every context transformation carries an inverse the
runtime holds) and SPATIAL composability (reactive coeffects — every context
change is classified against a component's coeffect spec to drive its
activation/deactivation), unified through a context paradigm with observational
equivalence; a calculus of dynamic composition (components/fibers,
orchestration, lifecycle, confinement); implemented as a core library (effect
tracking + coeffect resolution) + a declarative component loader with config
reconciliation + hot module replacement.

## What the proposal asks

Determine whether Provident's existing **idempotent** behavior is a sufficient
basis for the Cordis composeability features, and what ADDITIONAL changes or
features beyond the script-DSL proposal would be required.

## Feasibility verdict (three-agent-gate-derived)

**PARTIAL — the idempotent foundation is NECESSARY but NOT SUFFICIENT.** The
journaled managed channel (`supervisor.apply(op)`, journal/replay/undo) is a
genuine runtime-held recovery mechanism for graph-state effects and is the
right starting point for temporal composability; the anchor-graph bindings,
def/seam prototypes, derived states, and the dirty-propagation cascade are the
right substrate for reactive dependency resolution. But neither maps to the
Cordis contract without material additional machinery, and the guarantees are
**strictly weaker** than Cordis's:

1. **Temporal composability ≠ journal undo.** Cordis reverts a *component's
   entire* context (all effects, composed LIFO into a single recover). The
   journal reverts *named ops*, and only partially:
   - Undo is EXACT only for `state-slice` / `attach` / `rows-mint`.
   - `destroy` undo is a **PINNED NO-OP** (terminal) — a destroyed component
     cannot be temporally reverted, only re-minted fresh (identity not
     promised).
   - `detach` / `move` / `clone-instance` / `layer-apply` / `placement-attach`
     are documented undo no-ops with **parked fact-sets** (ops.md §6 G14).
   - Handler-side EXTERNAL side effects (DOM outside the adapter, event
     registration, subscriptions, network) are outside the channel and
     unrevertible — Cordis reverts the whole context.
2. **Spatial composability ≠ anchor-graph resolution.** The graph reacts (push
   bindings, dirty-propagation), but there is NO declared coeffect spec (a
   node does not declare the dependency keys it *requires*), NO satisfier /
   satisfaction classification (`σ ⊧ d`), and NO driving activate/deactivate
   lifecycle over a component's effect sequence. Provident's dependencies are
   IMPLICIT and translate-planned; Cordis's coeffects are DECLARED and
   dynamically re-resolved on provision/unprovision.
3. **HMR.** Whole-graph reseed via `_restoreBase` (the base-marker replay —
   graph-REPLACE + post-base re-apply) is the cheap, already-available form.
   Component-scoped reverse + reinstall is only possible once temporal
   invertibility (item 1) exists — it is DOWNSTREAM of, and gated on, the
   temporal work.

## Gaps + the required changes/features (the independent agenda)

The "what additional changes/features beyond the above would be required" list:

1. **Per-op inverse facts for the five parked undo no-ops** (journal-contract
   work, each already user-gated with recorded fact-sets in ops.md §6 / the
   pending.md "Undo inverses" row):
   - `detach` / `move` — journal the pre-op `{parent, priority}`; re-attach /
     move-restore on undo.
   - `clone-instance` — the retention SLOT-STABILITY collision (the destroyed
     copy stays in the parent's children): decide tombstone-placeholder vs
     re-activation.
   - `layer-apply` — `removeLayer(op.layerId)` is close but OO-5 teardown
     PROMOTES survivors (promotion-divergence note): not a faithful inverse
     without a ruling.
   - `placement-attach` — record `wasNodeNew` / `containerAnchorMinted` +
     an inverse trigger; the shared container anchor must survive.
2. **A per-component effect registry** (author-supplied `dispose`/`recover`
   inverses), layered on — but distinct from — the journal. This is what turns
   "linear op undo" into "component-scoped full reversal."
3. **A `destroy` reversal decision** — a user ruling: either adopt a
   re-mint-fresh "destruction is reversible by recreation" contract (replacing
   the pinned no-op), or explicitly classify `destroy` as terminal = NOT
   revertible (the honest Cordis gap).
4. **A declared coeffect model over the anchor consumer-walk**: a `coeffect`
   spec per component naming its dependency slots; a satisfier classifying each
   dependency change as satisfied / unsatisfied / partial (riding the existing
   pass-2 consumer/dirty machinery, read-only + sync + journal-neutral); and
   `activate`/`deactivate` lifecycle hooks driven by the classification.
5. **HMR staged**: whole-graph `_restoreBase` first (works today, no new
   machinery); component-scoped reverse+reinstall gated on items 1–3.

These five are INDEPENDENT of the script-DSL proposal and should be planned and
estimated as their own workstream(s). Each parked no-op's user gate must be
honored before any "full component reversal" claim is made.

## Constraints recorded (do not violate)

- **1.0.0 MAJOR-RELEASE / NO-FULL-BC (USER CONSTRAINT + VERSIONING-SCHEME DECISION,
  2026-08-31):** per the VERSIONING-SCHEME convention (`X.X.Y` defect patch /
  `X.Y.X` non-breaking / `Y.X.X` breaking) this whole workstream ships as a
  **1.0.0 major** — the first real major bump from 0.3.0, NOT 0.4.0 — and does
  **NOT assert full backwards compatibility with existing handler code**. A
  future gate must state the explicit BC scope (which existing handler code is
  retained vs re-expressed) at proposal time — the op + journal contracts and
  the handler dispatch surface are in-scope for change.
- Managed channel: every mutation stays mediated through `supervisor.apply`
  (context-mediated) — but the channel must become **inverse-complete** for the
  component-scoped reversal claim; it is not today.
- Phase ordering, two-scope compile, read-only compiled states, zero-dependency
  ESM, backend-gated trust: all preserved.
- No new dependency or separate execution realm is implied by this scope; the
  coeffect satisfier runs in-core, sync, journal-neutral.
- The "existing idempotent behavior" is necessary but not sufficient — do not
  advertise Cordis-grade temporal composability until items 1–3 land.

## Revisit condition

A host/consumer that requires component-scoped full reversal, declared
reactive dependencies, or per-component hot replacement (the MCP/Electron
consumers are the likely first candidates), OR the user opening the parked undo
no-op gates. When reopened: run the three-agent proposal gate fresh, respecting
each parked fact-set's user gate.

## Cross-references

- `docs/specs/script-dsl-review.md` — the source verdict (this is the Cordis
  §Part B, scoped out).
- `ops.md` §6 — the undo support table + parked no-op fact-sets.
- `docs/pending.md` — the "Undo inverses for the documented no-op kinds"
  speculative row (the per-op inverse source).
- `docs/decisions.md` — JOURNAL-CONDENSING, REQ-GAP-11/12, KEYED-BATCH-REUSE,
  MULTI-GRAPH-ISOLATION (D1–D8), ORIGIN-OWNER rows (the idempotency/journal +
  scope substrate).
