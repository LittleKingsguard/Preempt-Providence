# Misunderstandings Review — the placement-model divergences behind the placement-path revision

Status: SUMMARY DOC. Drawn entirely from the documented record. It answers
one question: **what did the rebuild misunderstand about legacy placement,
how did the misreadings compound, and what does the revision restore?** It
is the narrative companion to `docs/specs/placement-path-spec.md` (the FINAL
contract) and `archive/reviews/2026-08-15/2026-08-15-path-fork-review.md` (the gate record); it adds no
new decisions.

Provenance: `docs/specs/placement-path-spec.md` (§0 E2E constraints;
§1.1/§1.2 two-sided role + multiplicity; §2 path compile; §8–§10.af decision
history; Provenance at :23-54); `archive/reviews/2026-08-15/2026-08-15-path-fork-review.md` (round-1
REJECT §2.1–§2.5, round-2 re-review R2.1–R2.8); `docs/specs/
archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md` (AP5/NP13/Appendix D/E — the "no
consumer seam" rationale and interim decisions); `docs/specs/
archive/analysis/2026-08-15/2026-08-15-state-first-analysis.md` (§2.2.2 impossibility, §4 census); `docs/
archive/findings/2026-08-15/2026-08-15-test-findings.md` (stress loop #1 scenario 10, DEFECT #1, blind tests #1/#2);
`archive/reviews/2026-08-15/2026-08-15-session-defect-review.md` (fork-stress-data pass-2 RCA); and the
legacy sources the audit finally read — `/media/ryan/Shared Files1/Projects/
Preempt/docs/skills/placements.md` + `components.md` (the placement
owner/zone model, `targetPlacement` routing, multiplicity, first-match,
ancestor-name veto).

---

## 1. The misunderstanding chain (chronological)

Each link below is a documented divergence; the citations are the record of
that divergence and its later correction.

### (a) P3 was documented but never implemented

The rebuild spec claimed placement multiplicity: "Placement multiplicity
(shared `placementName`) forks exactly like components" (`docs/specs/api.md`
§5 rule P3, line 267 — cited at placement-path-spec.md:33-35 and conflict
row :764). The engine never implemented it: static compile forks fire only
on component `target` anchors (`src/core/node.ts:660-663`),
`src/core/resolve.ts` has zero placement references
(placement-path-spec.md:35-37); probes confirmed the claim "inert at static
compile" (archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md:655-688; archive/findings/2026-08-15/2026-08-15-test-findings.md:553). The
pipeline stage was likewise a "dead promise" (pipeline.md:67; the registry
row at `src/core/pipeline.ts:78` "exists but translate never feeds it" —
archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md:531). **The spec described a legacy
behavior the engine lacked.**

### (b) The consumer half of the placement pair was dropped at the boundary

Legacy placement is a **pair**: producers (`placementName` on a template
node) and consumers (`targetPlacement: string[]` on content payload roots,
routed to the first matching drop-zone — placements.md:7-19, 31-36). The
rebuild kept only the producer half (`placementName` → one `'placement'`-role
anchor, translate.ts:434-437) and dropped `targetPlacement` at the translate
boundary: "Unknown extra fields … are ignored" (translate.md §2; TR-F2),
warn `component-target-placement` + ignore (translate.ts:440-444), NP13 —
"targetPlacement translation gap: legacy content routing dead"
(archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md:433). The recorded rationale was
**"placement pipeline is placementName-keyed — targetPlacement has no
consumer seam"** (AP5 row, archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md:403) — a
statement about the rebuild's own design, not about legacy, where the
consumer seam is the entire point (placements.md:18-19, 31-36;
overview.md:23-24). The repair was recorded as a follow-up ("feed wiring
TODO", archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md:494-495, 538) that **never
landed** — the interim "keep-unplaced + warn" decision stood throughout
(standing decision #7, archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md:494-495).

### (c) Runtime clone-instance + after-compile recursion substituted for static fan-out

Because the consumer feed was dead, legacy's **static** multi-parent
fan-out (one source routing into every drop-zone sharing the matched name —
placements.md:19, 33-36; `Placement.placeInto` per zone,
`Preempt/src/core/Placement.ts:96-105`) had no static expression in the
rebuild. The fork-stress page re-expressed it as clone ceremony: 22
prototypes + handler bodies that `clone-instance` 4094 graph nodes and
attach them at runtime (`fork-stress-data.md` §Purpose / §1.3;
`supervisor.ts:388-411`; census 4117 registered = 4095 in-tree + 22 unplaced,
archive/analysis/2026-08-15/2026-08-15-state-first-analysis.md:203-209) — what legacy stated in data became a
runtime construction ritual, though the 4095-state tree IS expressible
statically (placement-path-spec.md:44-48).

### (d) The legacy placement config was mis-typed at the boundary

`LegacyPlacementConfig` was declared `targetPlacement?: string` and
`activePlacement?: boolean` (translate.ts:49-53) against the legacy schema
`targetPlacement: string[]` (placements.md:19, 24-26) and `activePlacement:
string` (the resolution record, `Preempt/src/types/NodeSchema.ts:22-24`).
The mis-typing is the boundary's own record of the misreading: a preference
**array** read as a scalar, a **string** resolution record read as a
boolean. Fixed in the revision (`targetPlacement?: string[]`,
`activePlacement?: string` — placement-path-spec.md:768, 862, 1108;
archive/findings/2026-08-15/2026-08-15-test-findings.md:137).

### (e) The review-loop phase: the gate validated the misreading

When the path-fork proposal arrived, the three-agent gate rejected it as
stated, and the rejection is instructive twice over:

1. **"Multi-parent placement inexpressible"** (archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:97-118,
   blocker 2) — true of the rebuild's own data model (single-anchor minting
   translate.ts:434-437; one child anchor per node node.ts:416-419; the
   `'placement'` role "carries no parent semantics at all",
   archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:116-118), **false of legacy**: multiplicity lives on
   the **shared name** (one name, N zone-owners, one source fans out into
   all of them — R2.2, archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:311-316; audit,
   placement-path-spec.md:29-33). The gate was reading the rebuild
   correctly and the legacy it was supposed to be faithful to incorrectly.
2. **The arithmetic error**: round 1 computed "path-only keying gives
   Σ 2^(k−1) + 1 = **2048** states — 2047 short of 4095"
   (archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:78-79) and called both fix-ups fatal. R2.2 records
   the truth: it was a **keying-model error, not an arithmetic error** — the
   (prototype, path) keying with the sibling-shared owner-name topology
   yields exactly Σ 2^k + root = 4095 (archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:304-325). The
   error briefly reinforced the rejection; the corrected bijection is what
   made the model load-bearing.

Round 2 re-review closed the round-1 blockers on the model level but still
rejected "FOR THE STATED GOAL" as DOMINATED by coalesced compiles — while
identifying the proposal's unique remainder: **static P3, a FEATURE worth
specing separately** (R2.8 ¶3, archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:455-466).

### (f) The legacy-fidelity audit confirmed all three suspicions

The audit read the legacy sources (`Preempt/src/core/workers/
PlacementWorker.ts:29-37`, `TargetPlacementResolverWorker.ts:28-35`,
`Placement.ts:44-57,96-105`, `NodeSchema.ts:22-24` — provenance-level
citations, C-8 resolved at placement-path-spec.md:1195, 1232-1237) and
confirmed, as one finding, every suspicion the review loop had accumulated:
legacy placement is **path-multiplicative** (:29-33); P3 was documented but
unimplemented (:33-35); `targetPlacement` was dropped + mis-typed at the
boundary (:37-40); clone-instance + after-compile recursion stood in for
static multiplicity (:41-43).

---

## 2. Root cause

**A partial reading of the legacy placement model at rebuild time.** The
legacy placement system was treated as a **producer-only, attach-driven zone
mechanism**: the rebuild kept the drop-zone half (`placementName`) and
carried it as a passive `'placement'`-role anchor populated by `attach` +
compile, while its **consumer half (`targetPlacement` — load-bearing legacy
routing) was dropped at the boundary** under a rationale ("no consumer seam")
that described the rebuild's own design rather than the legacy it replaced,
with a follow-up that never landed; and its **path-multiplicative fan-out
semantics** (multiplicity on the shared name, one source into N zones) were
lost entirely, replaced by runtime clone-instance + after-compile recursion.
The documented-but-unimplemented P3 ("forks exactly like components") kept
the spec claiming behavior the engine lacked. The divergence was **recorded**
in the DECIDED ledger (S3.6 "Placement is attachment/compile only — no
legacy `Placement`", RENDER_PROCESS_NOTES.md:534; §10.8.2 "not carried
over", :464; NP13 interim keep-unplaced + warn,
archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md:494-495) — but **the records themselves
encoded the misreading**: recording a decision is not validating it against
the legacy ground truth. The audit (placement-path-spec.md:29-43) and the
gate's own self-correction (R2.2 keying-model admission,
archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:304-325) are what finally exposed it.

---

## 3. What the revision restored

Per the landed contract (placement-path-spec.md §1-§2, §5; verification:
tests/e2e/path-fork-e2e.test.ts, static census 23/4095/0/0):

1. **The two-sided container/content placement model** — producers
   (`'container'`, from `placementName`) and consumers (`'content'`, minted
   per `targetPlacement` name) on the SAME shared per-name placement Link,
   which is the zone registry (§1.1; the legacy pair restored verbatim).
2. **Preference-ordered first-match** — the `targetPlacement` array is an
   ordered preference list; the compile stops at the most preferred name
   with a known container, every zone of the chosen name gets an instance,
   and less-favored updates abort silently via trigger identity (§1.2; the
   legacy worker `break` at PlacementWorker.ts:35-37 preserved).
3. **Path-multiplicative compile** — a third compile mode enumerating one
   state per (node, path-to-root); pathKey is the unconditional state
   identity, no `#<i>` arms (§2.1-§2.2).
4. **Static fork topology** — 23 nodes (22 prototypes + root) → 4095
   path-states in ONE enumeration pass, zero node creation, cloneOps = 0
   (E2E-1; §5, §5.2 census; the R2.2 bijection).
5. **The four fixed E2E constraints** — E2E-1 no-node-creation, E2E-2
   node-local invalidation, E2E-3 component consumers only, E2E-4
   placement-add affected set (§0; all four pinned in archive/findings/2026-08-15/2026-08-15-test-findings.md:35-37).
6. Ancillary restorations: `activePlacement` as the derived first-match
   read (§2.5), the ancestor-name veto (§1.3), the placement-path cycle
   guard (§1.4), the `placement-attach` op (§3.3), and the corrected
   `targetPlacement: string[]`/`activePlacement: string` typing (§6.1/§6.2).

---

## 4. The process lessons

1. **The three-agent gate validates proposals against the current spec —
   and when the spec itself encodes a misreading, the gate validates the
   misreading.** The round-1 "multi-parent placement inexpressible" blocker
   (archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:97-118) was code-verified and true of the rebuild's
   data model; it was false of legacy, whose model the rebuild had silently
   discarded. A gate that checks proposals against `translate.ts:434-437`
   cannot see a legacy field the boundary already dropped. The gate's
   saving grace was the same one that made the revision possible: it
   *recorded its own errors* (the R2.2 keying-model admission) and it
   correctly isolated static P3 as a separately speccable feature (R2.8 ¶3).
2. **The legacy-fidelity audit (spec provenance) is the corrective step.**
   Nothing in the internal record could prove or disprove the P3 claim —
   the audit's reading of the legacy sources (placement-path-spec.md:29-43;
   C-8's provenance discipline, §10.z) was the first check against the
   actual legacy contract, and it confirmed all three suspicions in one
   pass. Spec provenance — where a claim about legacy behavior comes from —
   belongs in the spec header; its absence is a warning sign.
3. **User-specified constraints are review-exempt anchors.** E2E-1…E2E-4
   are "binding; NOT subject to review" (placement-path-spec.md:58-68) —
   the review loop could argue about costs and mechanics but not about the
   fixed requirements (no node creation, bounded affected sets, element
   reuse). Those anchors are what kept the proposal's core contract stable
   through five user-review rounds (§10.x–§10.ae).
4. **The consistency-pass feedback loop reconciles a deep revision with
   the stale record.** The conflict tables (§10.1-§10.4: 89 docs / 41 code /
   23 tests / 12 demo rows — corrected counts, §10.z C-9), the
   re-classification rounds (§10.y, §10.ac), and the F-1…F-13 final-review
   rewrite list (§10.af.1) retired the old framing everywhere it survived —
   including supersession banners on the earlier records themselves
   (archive/reviews/2026-08-15/2026-08-15-path-fork-review.md:3-17; archive/analysis/2026-08-15/2026-08-15-state-first-analysis.md:3-16;
   archive/findings/2026-08-15/2026-08-15-test-findings.md:553). A decision record is kept as history, never as
   current contract.
5. **"Recorded" ≠ "validated."** The DECIDED ledger faithfully recorded the
   divergence (S3.6, NP13) — recording made it deliberate, not correct.
   The fix for a recorded-but-wrong decision is a REVISED entry with the
   corrective audit cited (RENDER_PROCESS_NOTES.md:464, 534 now carry the
   P3 supersession annotations), not silence or deletion.

---

## 5. Documentation-fix decision

**The root cause is unambiguous and this is NOT a docs-ahead-of-code
issue.** The divergence was code-first: the engine lacked the consumer feed
and the static fork while the P3 doc line claimed them; the revision's docs
were rewritten in **Units 0 and 13 — Unit 0 as the mandatory first
deliverable of the implementation pass, Unit 13 as the final docs sweep
after the code landed** (placement-path-spec.md:3-4, 1605-1610, 1674-1676;
surface inventory §6). The docs now match the implemented code; the landed
state is verified by `tests/e2e/path-fork-e2e.test.ts` and the static page
census (placement-path-spec.md:19-21).

**Residual one-line code item (documented, not a doc fix):** the
`PhaseRegistry` summary strings at `src/core/pipeline.ts:78-79` still carry
the pre-revision framing — stage `targetPlacementResolution` "resolution
expressed as placement-role anchors" and stage `placementAssembly`
"decomposes into attach + clone-instance on parent-child Links". This was
flagged **STILL-OPEN** in the spec's code conflict table
(placement-path-spec.md:895) and carried into the final actionable set
(placement-path-spec.md:1451); it is a registry-text/`docs()` output item,
not a behavioral one. Closing it is a one-line follow-up outside this
summary.
