# Spec — BODYRUNS-DROP-DIAGNOSTICS: the emit-boundary drop diagnostic + the `text`-node children silence clause

- **Status:** ✅ **W4 LANDED + W5 TEST-SIDE RE-POINT COMPLETE + GATE-8 DOC REVIEW
  CLOSED + BLIND-GREENS SET PASSED 2026-09-22/23 — see §9**
  (the diagnostic layer + the C2 containment clamp + the C5 `text`-node clause are
  BUILT in `src/core/render-helpers.ts`; the red set's five remaining failures —
  the four **oracle** defects (§9.5) and the contract-correct `A+7a` flip (§9.4) —
  are **FIXED test-side** by the W5 pass, §1.1 row **W5-1** + §9.5(a): **all 22 A+
  cases GREEN, all seven register rows `HELD`**, suite **1319 passing / 0
  failing**, `src/**` untouched). **Then the independently authored BLIND-GREENS set
  passed 21/21** (`tests/unit/bodyruns-drop-diagnostics-greens.test.ts` — authored
  from the docs only), taking the suite to **1340 passing / 0 failing**; and the
  **gate-8 doc review** closed the W4 landing audit's six findings (§1.1 row
  **G8-W4**; `archive/reviews/2026-09-22/2026-09-22-w4-doc-review.md`).
  **✎ SMOKE STATUS — RED BY RULING (2026-09-22 closeout, user ruling):** the
  validation trio's **third leg is NOT green**: `npm run demo:smoke` now **exits 1**
  at the repaired runtime tripwire (`[runtime-fork:tripwire] runtime fork-stress d12
  total=1540.6ms vs placement-derived baseline 146.7ms = 10.50× (3× asserted)`) — ✎✎ **SUPERSEDED 2026-09-23 (guard redefinition, user ruling `docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD): this paragraph is the PRE-RETIREMENT state and must NOT be read as live.** the cross-family 3× assertion was RETIRED (its operands are page totals over two different construction methods) and replaced by the **runtime-vs-runtime growth guard** (`runtime-fork-growth-guard`, d10 → d12 pass-2 ratio, bound **10×**, margin 1.30×); `npm run demo:smoke` is now **GREEN — exit 0, 34 guard entries, 0 failures**, with the cross-family ratio printed as an **INFORMATIONAL** line only. **The paragraph below is kept verbatim as the record of the 2026-09-22 ruling it made.** the tripwire's original text continues: a
  **deliberate, documented signal** left in place because the **3× bound is NOT
  re-baselined** (`docs/decisions.md` **RUNTIME-FORK-TRIPWIRE-BOUND**; the exposed
  condition is `docs/defects.md` **RUNTIME-FORK-PASS2-RATIO**, worked by the next
  unit — `docs/next-steps.md` `PASS-2-RUNTIME-FORK-SCALING`). `npm test` **1340 / 0**
  (76 files), `typecheck` and `build` remain clean. Any `SMOKE OK` line inside this
  spec is a **pre-repair / historical** reading — see the §9 header correction.
  **Superseded status lines (kept for provenance — do NOT read either as live):**
  (a) the original `PROPOSED / SPEC-WRITTEN (2026-09-22) — awaiting the W4 TDD gate`
  header **with its `Nothing in this file is built yet.` tail**, both made
  false by the W4 landing; (b) the interim `W4 / W5 complete, 1319 / 0` line, now
  superseded by the blind-greens reading.
  This is the Step-4 contract (AGENTS.md item 7) for the **UR-3(b)** reshaped ask
  adjudicated in `docs/specs/ur-2026-09-17-review.md` §2 (row UR-3) + §5 (N1/N2/N3)
  + §7 (AC-26..AC-29). The **red set lands in this pass (scope A+)**; the
  **implementation is the separately-gated W4** (`ur-2026-09-17-review.md:300-303`).
  ⛔ **STALE ORIGINAL TAIL — superseded by the W4 landing:**
  *"Nothing in this file is built yet."* (the diagnostic layer, the C2 clamp and the
  C5 clause are all BUILT — `src/core/render-helpers.ts`, §9).
- **Provenance (read-only, not re-litigated):** the approved gate record
  `docs/specs/ur-2026-09-17-review.md`; the landed ENG-BODYRUNS-WIRE-REF contracts
  `docs/specs/eng-bodyruns-wire-ref-review.md` §3/§7 and
  `docs/specs/eng-bodyruns-wire-ref-pathstate-review.md` §3/§7; the REJECTED
  widening `docs/specs/eng-bodyruns-wire-ref-pathstate-review.md:48-56` with its
  unmet revisit condition `:120-124`.
- **User rulings (2026-09-22, binding):** scope = **A+** (the docs/ruling pass
  W1/W2/W3/W5 + ONE red test proving the UR-3(b) silent drop, **no implementation
  change**); `bodyRuns` removability = **branch (b), removed at the 1.0.0 major**;
  the UR-3(b) diagnostic channel = **`console.warn` at the emit resolver**; the
  **1.0.0 XOR major is NOT in scope now** (confirmation + DRAFT stub + tracker rows
  only).
- **Target version:** **0.5.1** — a defect patch, `X.X.Y` per
  `docs/decisions.md:18` (VERSIONING-SCHEME). A `console.warn` channel keeps
  `emitElements`' signature stable, so no minor bump is required
  (`ur-2026-09-17-review.md:410-425` Q2).
- **TestWriter contract:** every state, fail-state, diagnostic code, message
  shape, resolution rule and register row below is derivable from this file ALONE
  (no implementation reading). §8 carries the per-unit test contracts and the
  property-layer execution instructions.
- **Date:** 2026-09-22.
- **AMENDED 2026-09-22 (§1.1 log rows AM-1/AM-2) — two TestWriter findings from
  executing this spec's red set. The amendment is a CORRECTION of two unreachable/
  vacuous statements, **not** a behaviour change:** no new requirement is added to
  W4, `src/**` is untouched, and no register row is added or removed (the register
  stays at six rows with `P-IM`/`P-SM`/`P-TP` ids, §5). **What changed:** (AM-1)
  §8.1 case A+7's stated observable was UNREACHABLE through the public seam — it is
  replaced by the two reachable observables A+7a/A+7b (A+7a's silence half is
  explicitly expected to **flip** at W4/C3, where the drop becomes a
  `bodyruns-child-unresolved` warn; A+7b is adapter-scoped and stays GREEN), and §3
  C1 now records the
  dead-guard fact (`render-helpers.ts:234`) as a **documented residual**; (AM-2)
  register row **P-IM-2** gains a first-class **non-vacuity clause (d)** so the row
  can no longer report HELD while the diagnostic layer is absent, plus the per-row
  vacuity audit for the other five rows and their controls (§5 "Vacuity audit").
  The superseded text is **not** silently rewritten: each correction names what it
  replaces (AM-1 in §8.1's A+7 row + §3 C1's bullet; AM-2 in §5's P-IM-2 row).
- **AMENDED 2026-09-22 (§1.1 log rows F2..F6) — the post-landing ADVERSARIAL/PBT
  audit corrections (`archive/reviews/2026-09-22/2026-09-22-ur-aplus-adversarial.md`
  §3 findings 2-6, §5).** These correct the **oracle**, not the contract semantics:
  no W4 behaviour requirement is added or removed, `src/**` is untouched, the
  register stays at six rows with `P-IM`/`P-SM`/`P-TP` ids, and **no assertion was
  weakened to force a green** (the red set stays RED for the same underlying
  reasons). **What changed:** (F2) §3 **C5.3** now states the **drop criterion**
  explicitly — warn exactly on authored `children` (non-empty) **or** a `{ child }`
  run; a `{ child }`-free run set of any length normalizes and is **silent** — and
  C5.1 records that `isInterleaving` is a **normalization** flag, not a loss flag
  (§3 C5.1/C5.3; landed A+4c + P-IM-4's silent arm); (F3) §5 **P-IM-2**(d)'s
  strategy/falsification cells require generator runs **tagged by resolution class**
  so only DROP-class runs count toward `fresh` (no false red at W4);
  (F4) §5 **P-TP-1**'s strategy cell requires the property's second half (the
  resolving run present in `decodeRuns(props['text'])` **plus** the snapshot
  equality on the same attempt) and the `foreign-<i>-<r>` absence case;
  (F5) §5 **P-IM-1**'s per-attempt liveness clause is ENFORCED (the generator must
  prove it) and the containment **positive half** is added;
  (F6) §8.3 now fixes the **report contract** — record-before-assert, the
  HELD/BROKEN/EXPECTED-RED/UNDETERMINED vocabulary, the minimized counterexample,
  `fresh.length` vs `perPass[0]`, and HELD-only-with-a-live-clause — and the §5
  status table records the outcomes the executed output actually contains.
  Two audit findings outside F1..F6 are corrected in the same pass: §3 C1's
  empty-map-bail paragraph is marked **UNREACHABLE** (finding 8), and the
  `bodyRuns` version scope is made uniform at **`>=0.4.0 <1.0.0`** across the W2/W3
  annotations (finding 9 — `eng-inline-order.md` §9b, `use-case-placement-native-interleave.md` §5b).
- **AMENDED 2026-09-22 (§1.1 log row F7) — the gate-8 DOC-REVIEW correction
  (`archive/reviews/2026-09-22/2026-09-22-ur-doc-review.md`; audit finding 7).**
  §5 **P-SM-1**'s strategy cell now requires the control input the row was
  supposed to have (`childOrder = [a(dup), b(dup), c(other)]` with a run naming
  only a **unique** id ⇒ **0 duplicate warns while a duplicate exists** — C3's
  reference gate) plus a **second emit of the same element wire** asserting the
  duplicate warn **does not repeat** (C4's cross-pass bound). A **STRENGTHENING
  only**: no assertion was weakened, `src/**` is untouched, the row keeps kind
  `P-SM` and stays **EXPECTED-RED today** for the same underlying reason (the C3
  warn does not exist), and the suite tally is unchanged (**1310 passing / 9
  failing**). Related audit findings corrected in the same gate-8 pass, each in
  its **owner** artifact: **finding 10** (`docs/specs/render.md` §3.4.3
  EMPTY-OWNER-1c gains the **binding-supplied** third shape, `render-helpers.ts`
  `:1388-1389` vs the raw-`s.content` gates `:1405`/`:1374`), **finding 11**
  (AC-30 near-duplication of the silence rule: `docs/specs/render.md` **BT-EMIT-5**
  is the OWNER and `docs/specs/adapters.md`'s silent-filter note is reduced to a
  pointer — no substance deleted), **finding 13** (`docs/releases.md`'s
  `docs/decisions.md:23` row citation → the **BARE-TEXT-EMIT row by NAME**; the
  frozen gate record's mis-classification of `render-helpers.ts:1374` as an
  EMPTY-OWNER test is corrected by an **errata line in the live surface**, never
  by editing the record).
- **Red-set evidence this amendment is derived from:** the landed
  `tests/unit/bodyruns-drop-diagnostics.test.ts` (the A+ red set + the six-row
  register harness) — its A+7 comment block, the A+7a/A+7b cases and the P-IM-2
  clause (d) — plus the seam facts re-verified at `render-helpers.ts:693-700` →
  `:755` (the index is always passed) and `:225` (the same call's `nodeById`
  parameter). **Line citations into that file are re-anchored in its header block**
  ("LANDED LINE ANCHORS", 2026-09-22) so a later pass can re-derive them; the
  F2..F6 correction shifted them (e.g. A+7a's silence assertion now sits in its
  case body, cited by case name A+7a in §8.1 rather than by a stale line number).
- **AMENDED 2026-09-22 (§1.1 log row G8-W4) — the gate-8 DOC-REVIEW pass closing the
  W4 landing audit (`archive/reviews/2026-09-22/2026-09-22-w4-doc-review.md`).**
  **Documentation only: `src/**` was NOT touched** (the one test edit is a
  **strengthening** of `tests/unit/bodyruns-wire-ref.test.ts` — defect **N4** — and
  the blind oracle `tests/unit/bodyruns-drop-diagnostics-greens.test.ts` was NOT
  edited). **What changed:** (finding 1) **every `render-helpers.ts` anchor in this
  file was RE-ANCHORED by reading the current file** — the W4 pass added the
  diagnostic layer and shifted the file by ~70-90 lines, so §7/§9.1's clause→code
  map (the one thing §9.1 exists to provide) was **unfollowable**; the §7 table now
  carries the pre-W4 → W4 map; (finding 2) §3 C3's duplicate trigger is restated as
  "≥ 2 **RESOLVABLE** `childOrder` wires" and §3 C2's synthetic-precedence exception
  is **scoped** (it fires only where the local map is structurally blind, and it is
  **not** a general defeat of the local-first pin) with A+6b's warn count pinned as a
  regression guard in §8.1 + the warn-on-the-synthetic-branch alternative recorded
  as an **open choice**; (finding 3) residual **R-W4-5** records the C4 dedup's
  **cross-document** effect (new §9.6b, the §3 C4 hazard block, the §9.8 row, the
  `docs/pending.md` park); (finding 4) defect **N4 closed**; (finding 5) §8.4 adds
  the harness invariants **H1/H2**; (finding 6) §9.4's A+7a→A+7b suppression
  sentence is marked as the **W4-revision rationale only**. **No clause semantics
  were changed by this pass** — findings 2/3/6 are clarification/recording, and
  finding 1 is citation repair.

### 1.1 Amendment log

| ID | Date | Amendment | Trigger (executed evidence) | Status |
| --- | --- | --- | --- | --- |
| **AM-1** | 2026-09-22 | §8.1 **A+7 SUPERSEDED** by A+7a/A+7b; §3 C1's empty-map-bail bullet gains the **dead-guard fact** (documented residual R-A1); §8.1's report-format note records the **expected W4 status flip** of A+7a's silence half | the TestWriter's execution: the `!authoredIdToWire` half of `render-helpers.ts:234` is unreachable — `emitElements` always constructs and passes a non-null index (`:693-700` → `:755`); an empty-but-non-null index DROPS via C1 step 4 (§8.1's A+7 deviation note) | **CORRECTED** — no W4 clause changes; the bail is recorded, not re-scoped. A+7a flips GREEN-with-warn at C3 (C3 row 1 warns on exactly that class); A+7b stays GREEN (adapter-scoped) |
| **AM-2** | 2026-09-22 | §5 **P-IM-2** gains clause **(d)** (non-vacuity guard) as a first-class falsification condition; the §5 "Omissions" global-total note is reconciled with it; the per-row vacuity audit table is added | the TestWriter's first register run: clauses (b)/(c) held vacuously with **no** diagnostic layer present, so the row reported HELD while retiring nothing; with (d) folded in the row reports **EXPECTED-RED — waiting on C3/C4** | **CORRECTED** — the row keeps kind `P-IM` and its pins (C1, C3, C4); the register stays ≤ 8 rows |
| **F2** | 2026-09-22 | §3 **C5.3** rewritten to state the **DROP CRITERION** explicitly (warn exactly when authored `children` (non-empty) **OR** a `{ child }` run; a `{ child }`-free run set of any length is SILENT); §3 **C5.1** gains the `isInterleaving`-vs-drop-criterion distinction; §5 **P-IM-4**'s property/strategy/falsification cells are restated on the drop criterion (warn arm = children-or-`{ child }`, silent arm = childless `{ child }`-free, exactly one expectation push per node) | the adversarial audit §1 (P-IM-4 over-strength): the landed generator (`tests/unit/bodyruns-drop-diagnostics.test.ts`, pre-correction) demanded **exactly 1** warn for a childless multi-`{ text }` `text` node — `{type:'text', content:'A ', children:[], bodyRuns:[{text:'A '},{text:'x'}]}` drops NOTHING, so a **correct** implementation would FAIL the row; the source predicate is `isInterleaving` (`render-helpers.ts:145-149`, `length > 1 ⇒ true`) | **CORRECTED** — the row keeps kind `P-IM`; the RED warn half is preserved (authored-children + `{ child }`-run arms), the silence arm is newly asserted (landed A+4c), and the duplicated `expectWarnFor` push is removed |
| **F3** | 2026-09-22 | §5 **P-IM-2**(d)'s strategy cell now requires every generated run to be **tagged by resolution class** (`own-wire` / `own-authored` / `foreign` / `junk-absent`) with `fresh` built **only** from the drop classes, and states the landed lower bound `perPass[0] >= fresh.length` **plus** the W4-grade tightening `perPass[0] === fresh.length` on pass 1; the falsification cell's over-strength check is restated on the class filter | the adversarial audit §1 (P-IM-2 over-strength) / §3 finding 3: the pre-correction clause (d) added **EVERY** `{ child }` run of the input as an expected dropped signature, while `genGraph(..., {pickFromOwnWires:true})` deliberately emits own wires (≈7/10 of the non-junk branch) that RESOLVE via C1 step 1 — a guaranteed **false red at W4** | **CORRECTED** — the row keeps kind `P-IM` and its pins (C1, C3, C4); the row stays EXPECTED-RED today for the REAL reason (the diagnostic layer is absent: `fresh.length=1`, `perPass[0]=0`) |
| **F4** | 2026-09-22 | §5 **P-TP-1**'s strategy cell now requires the property's **second half** on the same attempt (the resolving run present in `decodeRuns(el.props['text'])` **and** the authored `bodyRuns` deep-equal to its pre-emit snapshot) plus the `foreign-<i>-<r>` **absence** case (C2's "drop, never rewrite" half); the falsification cell gains both | the adversarial audit §1 (P-TP-1 missing its own second half) / §3 finding 4: the pre-correction harness computed `emitted` and discarded it (`void emitted`), so "the emitted rewrite lives only in `props['text']`" was never asserted | **CORRECTED** — the row keeps kind `P-TP` (transform/round-trip) and stays **HELD**; the added halves are live (22/50 attempts carry a foreign run, 29/50 an own-child run) |
| **F5** | 2026-09-22 | §5 **P-IM-1**'s mandatory per-attempt liveness clause is **ENFORCED** (the generator must positively construct a non-own-child run per attempt and the row must assert it produced one; a missing pair throws rather than hollowing the row) and the **positive half** is added (a run naming a foreign wire must be ABSENT from the emitted run set — not merely absent from `childOrder`); the falsification cell gains the liveness violation and the leaked-foreign-wire counterexamples | the adversarial audit §1 (P-IM-1 hollow-after-C2) / §3 finding 5: the pre-correction generator drew from `authoredPool ∪ wirePool ∪ junk` with **no** per-attempt assertion that ≥1 run was non-own-child (`wirePool` is the OWN pool), and the claim was asserted at graph level, not per element | **CORRECTED** — the row keeps kind `P-IM` and stays **BROKEN/EXPECTED-RED today** against the live counterexample (`render-helpers.ts:196-203` rewrites the foreign wire); a **correct** W4 now satisfies both halves |
| **F6** | 2026-09-22 | §8.3's report contract is made explicit and binding: **record BEFORE the assertion** (so a failing row still reports), the §8.3 status vocabulary (`HELD` / `BROKEN` / `EXPECTED-RED` / `UNDETERMINED`), the strategy id, attempts, failure count, the minimized counterexample for a broken row, **`fresh.length` vs `perPass[0]` for P-IM-2**, and the §8.3 rule that `HELD` requires at least one **live** falsification clause (else `UNDETERMINED`); the §5 status table is re-pointed at the executed outcomes and the register test names no longer contradict the reported status | the adversarial audit §1 (cross-row reporting) / §3 finding 6: the pre-correction harness printed only attempts/failures/first, omitted the status vocabulary and the P-IM-2 counts, and called `record()` **after** the failing `expect`, so a FAILING row emitted **no report line at all**; the spec's §5 status table asserted outcomes the executed output did not contain | **CORRECTED** — `src/**` untouched; every row now reports its status line (executed output quoted in §5 / §8.3) |
| **F7** | 2026-09-22 | §5 **P-SM-1**'s strategy cell now REQUIRES the two halves the row was missing: (a) the control input is `childOrder = [a(dup), b(dup), c(other)]` with a run naming **only a unique, non-duplicated id** ⇒ **0 `bodyruns-child-duplicate` warns while a duplicate EXISTS** (C3's reference gate), plus an anti-inert-control guard asserting the control was actually reached; (b) a **second emit of the SAME element wire** asserting the duplicate warn **does not repeat** — C4's cross-pass bound for `bodyruns-child-duplicate`. The duplicated positions are pinned to the **FIRST** `childOrder` positions so "earliest wins" is well defined | the adversarial audit §3 finding 7 / §1 (P-SM-1): the pre-correction generator's "unreferenced" control set `childOrder = [dup, dup, other]` in name only and then had the run name a **UNIQUE** id (`other-<j-1>`), so C3's "warns only when a run actually references the duplicated id" was **never exercised**; and the warn spy was created inside each single-emit attempt, so C4's cross-pass bound for that code was **untested** | **CORRECTED — a STRENGTHENING only (gate-8 doc-review pass, 2026-09-22):** no assertion weakened, `src/**` untouched, the row keeps kind `P-SM` and stays **EXPECTED-RED today** for the same reason (the warn does not exist — C3 unbuilt); the suite tally is unchanged (**1310 passing / 9 failing**, 9 in the red-set file) |
| **W4-1** | 2026-09-22 | §3 **C2**'s "Precedence pin" paragraph is **AMENDED**: its justification ("with unique ids the two maps cannot disagree") is FALSE — the landed GREEN control **A+6b** is the counterexample. The implemented rule (recorded in §9.3): the containment-clamped global resolution wins **only** when the indexed wire is a def-fill **synthetic** wire (no `nodeById` entry); C1's step order is otherwise exactly as written | the W4 implementation run (executed): local-first resolution turned **A+6b RED** — the def-fill element's `childOrder` carries both its synthetic def-child wire and the real child's path-state wire, and `nodeById` attributes the same authored id to the real wire, so local-first resolved the def-fill run to the wrong (duplicated) child | **CORRECTED — code reconciled to the landed regression guard (§6's N1-regression hazard); the divergence is filed as a defect row (`docs/defects.md` W4-SPEC-1) and the pin's duplicate-id observable is unchanged (A+2/A+2b/P-SM-1)** |
| **W5-1** | 2026-09-22 | §5 **P-IM-1** strategy cell: `k ∈ [1,6]` → **`k ∈ [2,6]` + ≥1 child per element** (the F5 liveness precondition); §5 **P-IM-2** strategy cell: clause (c)'s `expected` set rebuilt on the **C3 drop classes** (unresolved `junk-absent` **∪** `foreign`, **plus** `duplicate`) and clause (d) rebased on the **process-level** C4 suppression set with the row in its **own `pim2-<e>` element namespace** (the W4-grade `fresh.length <= perPass[0]` tightening is now asserted); §5 **P-SM-1** strategy cell: `d ∈ [1,3]` → **`d ∈ [2,3]`** for the WARN arm (the `d = 1` shape kept as the SILENT control); §5 **P-IM-4** strategy cell: the expectation is assigned **by C5.3's drop criterion** (shape 1 warns iff `cLen > 0`); §8.1 **A+7a** clause (iii) re-pointed from SILENCE to the **WARN** (code + `<id>` + wire asserted), **A+7b** given its own wire/id pair and its adapter-scope assertion made explicit; §5's vacuity-audit outcome cells + §9.5 re-pointed to the executed post-correction report (**§9.5(a)**, all seven rows `HELD`) | the W5 test-side pass (executed): the five red cases that remained after W4 — `A+7a` (contract-correct flip, §9.4) and the four ORACLE rows — are now GREEN with **no `src/**` change**: `P-IM-1` `attempts=100 failures=0` (pre: threw on 19/100), `P-IM-2` `HELD fresh.length=1 perPass[0]=1` (pre: `total = expected.size + 2`, `fresh.length=2 perPass[0]=1`), `P-SM-1` `HELD attempts=40` (pre: 9/40 demanded a warn with no duplicate), `P-IM-4` `HELD attempts=25` (pre: 3 nodes at `cLen=0` demanded a warn); suite **1319 passing / 0 failing** (W4: 1314/5), `npm test`/`typecheck`/`build`/`demo:smoke` all clean | **CORRECTED (test-side only)** — `src/**`, `package.json` and the frozen gate record untouched; **no assertion weakened** (every correction removes a demand the contract does not make, or supplies a precondition the row's own clause requires), and every clause stays falsifiable (the same-code PRE-correction readings — `total = expected.size + 2`, `fresh.length=2 perPass[0]=1`, 0 duplicate warns, 0 `text-node-children-ignored` warns — are exactly what a deleted diagnostic layer produces) |
| **W4-2** | 2026-09-22 | §3 C1's step table gains the **synthetic-precedence exception** to step 2, and §9.1 records the executed clause→code map; §5's register statuses are re-pointed at the **executed W4 report**; §8.1's A+7a row records the flip as **LANDED** | the W4 execution: 5 of the 9 red cases GREEN; `A+7a` GREEN→RED (expected, AM-1); **4 register rows RED for oracle reasons** — P-IM-1's generator throws at `k=1` (19/100 attempts), P-IM-2's (c) excludes the F5-injected `foreign` drops from `expected` while (d) filters `fresh` by a row-local set against a process-level C4 set (unsatisfiable in both directions), P-SM-1 draws `dupCount=1` (9/40 attempts — no duplicate exists), P-IM-4 pushes shape-1 nodes with `cLen=0` into `expectWarnFor` (3 nodes) | **RECORDED — oracle defects (defect rows `docs/defects.md` ORACLE-1..ORACLE-4); `src/**` was NOT adjusted to satisfy any of them (§9.5). Follow-up test-writer pass required** |
| **G8-W4** | 2026-09-22 | **the gate-8 doc review of the W4 landing** (`archive/reviews/2026-09-22/2026-09-22-w4-doc-review.md`): **(finding 1)** §7 + §9.1 + every in-spec `render-helpers.ts` anchor **RE-ANCHORED** to the W4 file (the pass shifted the file by ~70-90 lines — the clause→code map was unfollowable); **(finding 2)** §3 C3's duplicate trigger restated as "≥ 2 **RESOLVABLE** `childOrder` wires", §3 C2's synthetic-precedence exception scoped to the **structurally-blind** local map with its A+6b warn-count consequence pinned as a regression guard (§8.1 A+6b) + the warn-on-the-synthetic-branch alternative recorded as an open choice; **(finding 3)** residual **R-W4-5** added — the C4 dedup is **PROCESS-level, never per-document** (new §9.6b + §3 C4 hazard block + §9.8 row + a parked `docs/pending.md` row); **(finding 4)** defect **N4 CLOSED** — `tests/unit/bodyruns-wire-ref.test.ts:69`'s case renamed + strengthened with the missing warn assertion; **(finding 5)** §8.4 added — invariants **H1** (`PROCESS_LEVEL_SIGNATURES_FROM_EARLIER_CASES` is a hand-maintained mirror — the ORACLE-2 class) and **H2** (A+7b's exact count depends on suite-level wire uniqueness); **(finding 6)** §9.4's A+7a/A+7b-suppression sentence marked as the **W4-revision rationale only** (it does not hold under a shuffled order since W5 gave A+7b its own wire/id pair); **(R-W4-1)** the fork-arm workaround added to the author-facing `docs/skills/designing-pages.md` | the W4 landing audit — **verdict PASS-WITH-FINDINGS: 1 must-fix (stale clause→code citations, finding 1) + 1 must-record (the process-level dedup's cross-document effect, finding 3) + 4 low/INFO (findings 2, 4, 5, 6)**; the audit was re-derived from the code by the doc review (every citation verified by reading the CURRENT file — the spec's numbers and the audit's list were both treated as unverified) | **CLOSED in the same pass (DOCUMENTATION ONLY: `src/**` untouched; the one test edit is a strengthening of `tests/unit/bodyruns-wire-ref.test.ts`, not the blind oracle `tests/unit/bodyruns-drop-diagnostics-greens.test.ts`)** |

---

## 1. Status

| Item | Value |
| --- | --- |
| Concern | The observability contract for a `bodyRuns` `{ child }` run that fails to resolve at the **emit boundary**, plus the `text`-node `children`/`bodyRuns` silence clause |
| Owning ask | **UR-3(b)** — `ur-2026-09-17-review.md:42` (verdict row), `:156-162` (the consumer answer) |
| Gate state | Three-agent gate **PASSED**; user go-ahead given 2026-09-22. This is the Step-4 spec. |
| Red set | **lands in this pass (A+)** — `ur-2026-09-17-review.md:258-280` (recommendation), `:360-367` (AC-26..AC-29) |
| Implementation | **W4 — NOT in this pass.** `ur-2026-09-17-review.md:300-303`: spec section → A+'s red test extended to the real drop classes → implement → adversarial (AGENTS.md item 11) → blind-greens → trio |
| Closed defects | **N1** (the global-index containment divergence — `ur-2026-09-17-review.md:230`), **N2** (silent `text`-node children/`bodyRuns` loss — `:231`), **N3** (the approved-but-unbuilt warn-and-drop clause — `:232`) |
| Contract precedent being closed | `eng-bodyruns-wire-ref-review.md:73-75` (the warn-and-drop clause) + `:116-117` (the revisit restatement) + `eng-bodyruns-wire-ref-pathstate-review.md:72-75` |
| Byte-identical pin | no dropped/duplicate run + no `text`-node children ⇒ today's emit unchanged (C6) |

**One-line status:** the diagnostic contract exists on paper (`eng-bodyruns-wire-ref-review.md:73-75`),
was never built (`render-helpers.ts:208-212` drops silently, `changed = true`, no sink),
and is now specified here for a red-first (AGENTS.md item 8) W4 implementation.

---

## 2. Scope

### 2.1 IN

| # | In scope | Where the contract lives |
| --- | --- | --- |
| 1 | The **resolution order** at the emit boundary (own-`childOrder` local map first, then the global index) — C1 | §3 |
| 2 | The **containment rule** (the N1 fix) — a foreign authored id is DROPPED, never rewritten | §3 C2 |
| 3 | The **drop/warn catalogue** — every non-resolving class, its code, trigger, warning-or-silent disposition, channel, message shape, determinism requirement | §3 C3 |
| 4 | The **repetition bound** (P2) | §3 C4 |
| 5 | The **`text`-node children/`bodyRuns` clause** (N2) | §3 C5 |
| 6 | The **byte-identical + no-fresh-array guarantee** | §3 C6 |
| 7 | **`base.bodyRuns` immutability** | §3 C7 |
| 8 | The **typed property register** (PBT gate deliverable) | §5 |
| 9 | The **test contracts** for Unit A+ and Unit UR-4-confirmation | §8 |

### 2.2 EXPLICITLY OUT (with the recorded reason)

| # | Out of scope | Recorded reason |
| --- | --- | --- |
| 1 | **The placement-sibling widening = REJECTED option (a).** A `{ child }` run may never resolve to a non-own-child | `eng-bodyruns-wire-ref-pathstate-review.md:48-56` REJECTED "as-stated" on four grounds (the O(n²) class vs the fork-stress pins; the own-`childOrder` containment violation; duplicate-id non-determinism; the structural inability to resolve def-fill synthetic wires); the revisit condition `:120-124` is **UNMET**; `ur-2026-09-17-review.md:432-449` (Q3) keeps it rejected |
| 2 | **The adapter seam.** The adapters stay **pure silent consumers** — the diagnostic is NOT placed in `DomAdapter`/`SSRFragmentAdapter` | `docs/specs/adapters.md:561` (**NVA-3**: "Make a pipeline decision on missing wires — silent no-op, never throw, never synthesize ops"), `adapters.md:204` + `:358` (the missing-wire silent no-op is a **pinned DECIDED contract**), `ur-2026-09-17-review.md:42` MUST-NOT column |
| 3 | **Translate-side resolution** (rewriting `bodyRuns[].child` at translate) | REJECTED at the earlier gate — `eng-bodyruns-wire-ref-review.md:40-47` (forward reference; the `nodeToLegacy` reverse leak; path-state wires unknowable at translate); `docs/decisions.md:24` |
| 4 | **An adapter-side `props.id` fallback** | REJECTED — the DEFECT-#22 O(n²) class + non-deterministic on the legally-permitted duplicate authored id; `eng-bodyruns-wire-ref-review.md:48-55`, `decisions.md:24` |
| 5 | **A `RenderWarning[]` return / out-param on `emitElements`** | An own-gate **minor** (`X.Y.X`) public-surface widening; the user ruled the `console.warn` channel (Q2 option (i), `ur-2026-09-17-review.md:410-425`) |
| 6 | **A drop-list field on `MinimalElement`** | MUST NOT — it would participate in `diffMinimal`'s `===` compare / `orderSig` and break the zero-op diff contract (C6; `ur-2026-09-17-review.md:42`) |
| 7 | **The UR-1 bare-`text` behaviour-spec fold** (the `adapters.md`/`render.md`/`node.md` rows) | Owned by **W3** — this spec only **cross-references** §4 |
| 8 | **The 1.0.0 XOR major** (render enforcement, `bodyRuns` removal, the migration guide) | Q4 option A — `ur-2026-09-17-review.md:451-469`; not in scope now |
| 9 | **The `content:''` asymmetry (N7)** and the **`content-with-children-recommended`** warn | N7 is a decision-row/behaviour-spec note (`:236`); the warn is DEFERRED to 1.0.0 (`translate.ts:965-970`) |
| 10 | **The def-fill `bodyRuns` interleaving** (the pathstate third shape) | LANDED 0.3.2 — `eng-bodyruns-wire-ref-pathstate-review.md:126-148`; this spec only binds its resolution against C1/C2 |
| 11 | **`docs/decisions.md`/`defects.md`/`pending.md`/`next-steps.md` edits** | The W1/W2/W3/W5 doc pass owns the trackers (`ur-2026-09-17-review.md:287-306`) |

---

## 3. The contract

The authoritative rule set. Every clause is numbered, cited, and marked
**DECIDED** (settled by the gate record or the user ruling) or **REJECTED**.

Common terms used below, all with a `file:line` anchor:

- **emit boundary** = `emitElements` (`render-helpers.ts:482-669`), specifically the
  post-emit pass at `render-helpers.ts:661-668` which calls
  `resolveBodyRunsChildWires` **once per emitted element** with the global index.
- **resolver** = `resolveBodyRunsChildWires` (`render-helpers.ts:167-218`).
- **global index** = `authoredIdToWire: Map<string, string>` built **once** per
  `emitElements` over the actionable set (`render-helpers.ts:598-613`), extended by
  the def-fill synthetic registrations (`:995-1000` def-root, `:1048-1053` def-child).
- **element's own `childOrder`** = the element's final emitted `childOrder` — after
  the path-state child conversion (`:613-637`) and the **fork-arm remap**
  (`:723`: `el.childOrder = el.childOrder.flatMap((c) => armWires.get(c) ?? [c])`).
- **authored id** = a child node's authored `base.props.id`
  (read at `:226`, `:696`, `:996`, `:1049`).

### C1 — Resolution order at the emit boundary · **DECIDED** (`ur-2026-09-17-review.md:156-162`)

Per element, per `{ child }` run, in this exact order:

| Step | Test | Outcome |
| --- | --- | --- |
| **1** | the run's `child` value is **already an emitted child wire**: `childWires.has(r.child)` where `childWires = new Set(el.childOrder)` (`:216`) | **pass-through unchanged** — the run keeps its wire (`:239-245`) |
| **2** | the run's `child` equals the authored id of **this element's own child** — a per-element map `authoredId → childWire` built over `el.childOrder`, first-match-in-order (`:221-233`) | **rewrite to the own-child wire** (`:265-280`) |
| **3** | the run's `child` is an authored id in the **global index** whose indexed wire is a member of `el.childOrder` (see C2; the def-fill **synthetic** candidate takes precedence — §9.3) | **rewrite to that wire** (`:246-249` the candidate, `:259-264` the synthetic-precedence branch, `:281-285` the clamped fallback — containment-clamped by C2) |
| **4** | otherwise | **DROP the run** (C3) |

> **✎ AMENDED 2026-09-22 (W4) — the step order as IMPLEMENTED, with one recorded
> exception.** Steps 1/2/3/4 are implemented exactly as tabled (step 1
> `render-helpers.ts:239-245`, step 2 `:265-280`, step 3 `:281-285`, step 4
> `:286-299`), **except** that a **contained def-fill SYNTHETIC** global candidate
> (an indexed wire that has **no `nodeById` entry**) is resolved **before** step 2
> — see the §3 C2 precedence-pin amendment and §9.3. The exception is forced by
> the landed GREEN control A+6b: local-first resolution turned that regression
> guard RED. Every other observable is unchanged.

- **The local map is built from the element's own `childOrder` only**
  (`render-helpers.ts:221-233`); the per-element `nodeById` hop
  (`pathCtx?.pathNodeOf.get(w) ?? w`, `:224`) is part of the local lookup.
- **Steps 2 and 3 preserve own-`childOrder` containment**; step 4 removes the run
  from the emitted run list (`:286-299` — the `else` branch pushes nothing).
- **The `text` value is only rewritten at the end, once**: `el.props['text'] =
  encodeRuns(rewritten)` when anything changed (`:304`); an untouched run set
  produces no write to `props['text']` at all.
- **Empty-map bail — ⛔ UNREACHABLE through the public seam (AM-1, 2026-09-22; see the dead-guard bullet immediately below and §1.1).** The **superseded teaching is retained verbatim-but-annotated** so the contradiction cannot be re-introduced: *the bail is* the early `return` at `:234`
  (`if (authoredIdToWireLocal.size === 0 && !authoredIdToWire) return`) taken **before any run is examined**; in that (unreachable) case an unresolved authored id would **not** be dropped by the resolver — it would be emitted verbatim, and the **adapter** would then silent-no-op it
  (`adapters.ts:612-613` SSR `fragments.get(wireKey(run.child))` miss; the DOM branch
  `adapters.ts:210-213` `wires.get` miss). **No reachable input produces this outcome** (AM-1: the `!authoredIdToWire` half is dead — the single call site at `:755` always receives the non-null index built at `:693-700`), so the paragraph above describes **no live behaviour** and must not be cited as one; the reachable shapes are pinned by §8.1 A+7a (drop via C1 step 4) / A+7b (adapter silent no-op). The **only** reason the A+ containment case must supply a non-empty global index is that a non-empty index is what makes the foreign/containment class reachable at all (§8 Unit A+ case 1).
- **The bail's `!authoredIdToWire` half is DEAD CODE today — a documented residual
  (AM-1, 2026-09-22; `file:line`-verified, not inferred):** `resolveBodyRunsChildWires`
  has exactly ONE call site in `src/**` — `render-helpers.ts:755`
  (`for (const el of els) resolveBodyRunsChildWires(el, nb, pathCtx, authoredIdToWire)`)
  — and the map it passes is constructed unconditionally at `:693-700`
  (`const authoredIdToWire = new Map<string, string>()`), so the argument is **always
  a non-null Map** (empty iff no actionable state carries an authored `props.id`).
  There is no other caller and no seam that supplies `undefined`. Consequences the
  TestWriter and W4 must hold to:
  - The `authoredIdToWireLocal.size === 0 && !authoredIdToWire` conjunction can only
    ever be half-true through the public seam; the **`!authoredIdToWire` half cannot
    be exercised**, so the "verbatim run + adapter silent no-op" outcome §8.1's
    superseded A+7 asked for is **unreachable** (see §8.1 A+7a/A+7b).
  - The reachable empty-authored-id shape is an **empty-but-non-null** index: the
    bail does not fire, the run falls through to **C1 step 4 and is DROPPED**
    (§8.1 A+7a).
  - Supplying the index is inseparable from the resolver's other argument in this
    call: `nodeById` is `emitElements`' own parameter (`render-helpers.ts:569-590`,
    normalized at `:591`), and it is what feeds the element's own-child local map
    (`:225` `nodeById?.get(nodeId)`). Omitting it therefore suppresses the child
    elements' authored ids (local map empty) — it does **not** isolate the bail.
- **Disposition of the dead guard (AM-1) — DOCUMENTED RESIDUAL, not a W4
  requirement change.** It is recorded as residual **R-A1**: the guard is
  *conservative-but-unreachable*, i.e. it is a genuine defensive branch whose
  condition is currently unsupplied, and **no recorded contract requires W4 to
  change, remove, or exercise it.** Specifically:
  - C1 step 4 (`:286-299`, the drop) is the clause that governs the reachable
    shape; the bail is an *earlier* return that only the unreachable half would arm.
  - The approved shape (`eng-bodyruns-wire-ref-review.md:72-77`) and the gate record
    `ur-2026-09-17-review.md:42`/`:156-162` require warn-and-drop for the REAL drop
    classes — none of them names the `null`-index case, and no acceptance item
    (AC-26..AC-29, `ur-2026-09-17-review.md:362-367`) mentions it either. There is
    therefore **no contract that demands W4 touch it**, and inventing one here would
    add a behaviour requirement this pass is forbidden to add.
  - **It is NOT a W4 candidate clause.** Removing dead code or exercising the bail
    would need a caller that passes no index — i.e. a new seam or a signature change —
    which C6 (byte-identical emit) and C8 (patch-level, `emitElements` signature
    unchanged) both push outside this contract. If the W4 implementer judges the
    branch worth deleting, that is an **optional, non-contract cleanup** to be
    declared in the W4 pass and must not alter C1 step 4's observable; if it is
    deleted, the `:234` bail's remaining half (`size === 0` with an index present)
    does **not** survive as a bail at all, because the condition requires both halves.
  - The residual is pinned observably by §8.1 **A+7a** (drop via step 4, no
    diagnostic) + **A+7b** (the adapter silent no-op), so W4 cannot change the
    bail's (lack of) semantics silently.
- **DECIDED:** the resolution happens **at emit**, never at translate and never in
  the adapters (§2.2 rows 2-4).

### C2 — Containment: an authored id that is NOT the element's own child is DROPPED, never rewritten (the N1 fix) · **DECIDED** (`ur-2026-09-17-review.md:230`, closing `eng-bodyruns-wire-ref-review.md:79-80`)

**The rule that replaces the divergence.** A `{ child }` run may resolve ONLY to a
wire that is a member of the emitting element's own final `childOrder`. Any
candidate resolution whose wire is NOT in `el.childOrder` is **dropped** (C3), even
when the authored id exists elsewhere in the graph.

**The current divergence (cite it; do not change the code in this pass):**
`render-helpers.ts:281-285` (the clamp site `:249`; `:246-249` is the candidate) consults the global index **before** the own-child
local map and resolves **any** authored id present anywhere in the graph, without
consulting `el.childOrder`:

```ts
} else if (authoredIdToWire?.has(r.child)) {
  // the GLOBAL index first: a def-fill SYNTHETIC wire (or a real
  // actionable child's wire) …
  changed = true
  rewritten.push({ child: authoredIdToWire.get(r.child)! })
} else if (authoredIdToWireLocal.has(r.child)) {
```

Two consequences, both **REAL DEFECT N1** (`ur-2026-09-17-review.md:230`):

| Adapter | Foreign-wire consequence | Citation |
| --- | --- | --- |
| DOM | the run resolves to a foreign element already in `this.wires`; `appendChild` **MOVES** it into this parent (a wrong-child render) | `adapters.ts:210-213` (`elem.appendChild(childEl)`) + `:311-323` (`appendChild` moves by `o.appendChild(c)`) |
| SSR | the foreign fragment's HTML is **DUPLICATED** into the wrong parent's `contentHtml` | `adapters.ts:612-613` (`this.fragments.get(wireKey(run.child))` → `childHtml`) |

**The exact replacement rule (W4):** the global-index step becomes a
**containment-clamped fallback** —

- if the global index maps the run's authored id to a wire `w` **and** `w ∈ el.childOrder`
  → rewrite to `w` (this is the def-fill synthetic case: the def-fill element's own
  `childOrder` carries the synthetic wire, `:995-1000` / `:1048-1053`);
- if the global index maps the id to a wire **not** in `el.childOrder` → **DROP**
  (never rewrite);
- if the global index has no entry → the own-child local map decides (C1 step 2),
  then DROP.

**Precedence pin (DECIDED here, consistent with the landed comment):** wherever the
own-child local map and the global index disagree, **the own-child local map wins**.
The landed comment at `render-helpers.ts:690-692` asserts that intent ("The
per-element nodeById lookup in `resolveBodyRunsChildWires` still runs FIRST (the
element's own real children take precedence)") while the code checks the
global index first (`:281` after the `:259-264` synthetic branch; the local map sits between them at `:265-280`). C1's step order (local → global) is the
authoritative reading; W4 must make the code match it. Note the observable impact is
**only** on duplicate authored ids (a legal shape — `RESULTS.md:182`, cited at
`eng-bodyruns-wire-ref-review.md:54`), because with unique ids the two maps cannot
disagree.

> **✎ AMENDED 2026-09-22 (W4) — the pin's JUSTIFICATION is corrected; the pin's
> rule stands with one recorded exception.** The claim "*because with unique ids
> the two maps cannot disagree*" is **FALSE**, and the landed GREEN control
> **A+6b** is the counterexample: the def-fill element's final `childOrder`
> carries **both** its synthetic def-child wire (`<host>:<i>`, the def-fill
> registration at `:1048-1053`) **and** the same child's real path-state wire, and
> `nodeById` attributes the authored id (`bold`) to the **real** wire — so the
> local map and the global index DO disagree on a unique id. Implemented rule
> (`render-helpers.ts:246-264`, `:259-264` the synthetic branch, §9.3): the containment-clamped global candidate
> wins **only when the indexed wire is a def-fill synthetic wire** (it has no
> `nodeById` entry, so the per-element map can never attribute the id to it);
> **in every other case the own-child local map wins exactly as pinned here**,
> including the duplicate-id observable this pin exists for
> (`bodyruns-child-duplicate`, A+2/A+2b/P-SM-1). The divergence is filed as
> defect row **W4-SPEC-1** in `docs/defects.md`.
>
> **✎ SCOPE CLARIFIED 2026-09-22 (W4 audit finding 2) — the exception is NARROW, and
> it has one observable consequence the catalogue must state.** (a) **The exception
> fires ONLY where the local map is structurally BLIND:** the precedence branch
> requires the contained global candidate to have **NO `nodeById` entry**
> (`:259-264`), i.e. a def-fill **synthetic** wire the per-element map can never
> attribute an authored id to. It is therefore **NOT a general defeat of the
> local-first pin** — for any authored id carried by an ordinary `childOrder` wire,
> every wire has a `nodeById` entry, the branch cannot fire, and local-first
> duplicate resolution (earliest wire wins + one `bodyruns-child-duplicate`) holds
> exactly as pinned. (b) **Consequence — the synthetic branch returns BEFORE the
> duplicate check**, so a shape whose duplicated authored id resolves to a
> contained **synthetic** wire emits **no** `bodyruns-child-duplicate` even though
> more than one `childOrder` wire carries the id (only the synthetic one is
> counted-or-not-counted per §3 C3's corrected **resolvable** trigger). The landed
> GREEN control **A+6b** is exactly that shape, and its warn count is now **pinned
> as a regression guard in §8** (see §8.1's A+6b note + §8's invariants).
>
> **✎ RECORDED OPEN CHOICE 2026-09-22 (W4 audit finding 2 — alternative, not
> built).** The alternative is to **warn on the synthetic branch too** — i.e. run
> the duplicate count for the synthetic case and emit `bodyruns-child-duplicate`
> when the authored id is also carried by ≥ 2 resolvable wires. **Consequence of
> that choice, recorded so it is not adopted silently:** the def-fill regression
> guard A+6b would need its warn count **changed from 0 to 1** (or its input
> reshaped), the `bodyruns-child-duplicate` semantics would become "≥ 2 wires
> carry the id **including a synthetic one**", and the dedup signature for that
> case would then be keyed on the **synthetic** wire (changing what a host sees).
> It is **NOT** the implemented behaviour and must not be asserted; taking it
> requires a contract amendment + its own gate.

**The pin this closes:** `eng-bodyruns-wire-ref-review.md:79-80` — "cannot reference
a non-child (scoped to the node's own childOrder — the H2/order-faithful set)" —
restated at `eng-bodyruns-wire-ref-pathstate-review.md:81-87` ("Containment:
own-children only … placement-sibling references are foreign and dropped").

**REJECTED (do not build):** any resolution over placement siblings or any other
non-child scope (§2.2 row 1).

### C3 — The drop/warn catalogue · **DECIDED** (`eng-bodyruns-wire-ref-review.md:73-75`, `:116-117`; `ur-2026-09-17-review.md:42`)

Every class the resolver can meet, with its code, trigger, disposition, and the
observable the TestWriter asserts.

**Channel (user-ruled, DECIDED):** `console.warn` — `ur-2026-09-17-review.md:410-425`
(Q2 option (i)). Precedent: `src/core/ops.ts:401`
(`console.warn(\`duplicate-identifier at ${target.id}: …\`)`), the existing render/
ops-layer warn. The translate-layer precedent for the **message shape** is
`translate.ts:227-232` (`[legacy-translate] <code> at <path>: <detail>`).

**Code convention:** lowercase-kebab, matching the repo's existing code vocabulary
(`text-content-only` `translate.ts:957`, `bodyruns-deprecated` `:963`,
`body-runs-shape-invalid` `:353`, `children-shape-invalid`/`children-entry-invalid`
`docs/specs/translate.md:659`, `duplicate-identifier` `ops.ts:401`).

| Class | Trigger (input shape) | Code | Disposition | Warns? | Contract clause |
| --- | --- | --- | --- | --- | --- |
| **absent / dangling id** | the run's `child` is neither a child wire, nor an own-child authored id, nor a contained global-index entry | `bodyruns-child-unresolved` | the run is **DROPPED** from the emitted `props['text']` | **YES** | C1 step 4, C2 |
| **foreign id (the N1 case)** | the authored id exists in the graph but resolves to a wire **not** in `el.childOrder` (a placement sibling, another subtree, another element's child) | `bodyruns-child-unresolved` | **DROPPED** — no rewrite to the foreign wire | **YES** | C2 |
| **duplicate authored id** | **≥ 2 RESOLVABLE `childOrder` wires carry the same authored `props.id`** — "resolvable" = the wire's node (`pathCtx.pathNodeOf` hop + `nodeById`) actually carries a non-empty string authored id, so it is COUNTED by `authoredIdChildCount` (`:222-233`); a `childOrder` wire whose node is absent from `nodeById` (a def-fill **synthetic** wire, `:250-258`) is **NOT counted** (`:229` keeps the first; dupes are legal). **✎ TRIGGER CORRECTED 2026-09-22 (W4 audit finding 2):** the pre-correction words said "≥ 2 wires in `el.childOrder` carry the same authored `props.id`" — that over-states the trigger, because the count is built only over wires that RESOLVE through `nodeById` | `bodyruns-child-duplicate` | **first-match-in-order**: the EARLIEST wire in `el.childOrder` wins. Warns **only when a `{ child }` run actually references the duplicated id** (not merely because a duplicate exists — that would warn on every emit of a legal document). **✎ SCOPE OF THE PRECEDENCE EXCEPTION (W4 audit finding 2):** the §9.3 synthetic-precedence branch returns **BEFORE** this duplicate check (the branch order is `:259-264` → `:265-280`), so **when the run's id is attributed by the global index to a contained def-fill SYNTHETIC wire, the duplicate count is never consulted and no `bodyruns-child-duplicate` is emitted** — the run resolves to the synthetic wire instead. This is **NOT a general defeat of the C2 local-first pin**: the exception fires **only where the per-element local map is structurally BLIND** (the indexed wire has **no `nodeById` entry**, so the local map can never attribute the id to it — §9.3). On a duplicated **authored** id inside an ordinary element, every wire has a `nodeById` entry, the branch cannot fire, and the local-first duplicate observable is exactly as pinned (A+2/A+2b/P-SM-1) | **YES** | C1 step 2 ordering; `eng-bodyruns-wire-ref-review.md:74` ("duplicate id → first-match-in-order, warn") + `eng-bodyruns-wire-ref-pathstate-review.md:74` (`duplicate → warn-and-drop`) + `:116-117` (test (g)) |
| **def-child synthetic wire, resolved** | the run references an authored id whose global entry is a def-fill **synthetic** wire (`<host>:<bind>` / `<host>:<index>`, registered at `:1048-1053`) and that synthetic wire IS in `el.childOrder` | — | **REWRITTEN to the synthetic wire** (not a drop; the precedence branch `:259-264`) | **NO** | C1 step 3; `eng-bodyruns-wire-ref-pathstate-review.md:76-80` |
| **def-child synthetic wire, NOT in this element's `childOrder`** | the synthetic wire belongs to another def-fill element | `bodyruns-child-unresolved` | **DROPPED** | **YES** | C2 (the N1 clamp) |
| **path-state child with NO authored `props.id`** | the own child resolves through `pathCtx.pathNodeOf` (`:224`) to a node whose `base.props.id` is `undefined`/`''` → no local entry is created (`:227` gate: `typeof authored === 'string' && authored !== ''`) | `bodyruns-child-unresolved` | **DROPPED** when the element's local map is non-empty; if the local map is empty and a global index was supplied, the `:234` bail does not apply and the run still DROPS via C1 step 4 | **YES** | `:227`, `:234` |
| **fork-arm child wire** (the D2(i) class — a **specification gap** recorded at `ur-2026-09-17-review.md:246`) | the child is a component fork arm: the parent's post-remap `childOrder` carries `nodeId#<i>` (`:723`), while the global index holds the base wire (`pathWireOf(s)`, `:698`) | — | **DECIDED — passes through unchanged** by C1 step 1 (`childWires.has(r.child)` is true after the remap), so the run keeps the arm wire. An authored-id ref naming the arm's base node resolves through C1 step 3 **only** if the indexed wire is in `childOrder` (it is not — the arm wires are); otherwise `bodyruns-child-unresolved` + DROP | pass-through: **NO**; unresolved-ref: **YES** | `:723`, `:698`; the D2(i) gap `ur-2026-09-17-review.md:246` |
| **run already a real child wire** | `childWires.has(r.child)` | — | **pass-through**, byte-identical | **NO** | C1 step 1 |
| **no `{ child }` run at all** | the `props['text']` value is not body-encoded, or contains no `child` run | — | the resolver returns **before doing any work** | **NO** | `:213-215` (the zero-cost bail; `decisions.md:20` D4) |

**Message shape (DECIDED here — pinned so the TestWriter can assert substrings, not
exact whitespace).** One `console.warn` argument, a single string:

```
[bodyruns] <code> at <elementWire>: <detail>
```

| Code | `<detail>` template | Notes on the interpolated values |
| --- | --- | --- |
| `bodyruns-child-unresolved` | `the { child } run references authored id "<id>", which is not a child of this element; the run is dropped` | `<id>` = the run's `child` value verbatim (`JSON.stringify`-free; it is always a string per the `BodyRun` union, `eng-inline-order.md:62-65`) |
| `bodyruns-child-duplicate` | `authored id "<id>" resolves to <n> children of this element; the first in childOrder is used` | `<n>` = the count of `childOrder` wires carrying that authored id |
| `text-node-children-ignored` | `a "text" node carries authored <children|bodyRuns>; the bare-text emit ignores them; no element is created` | the literal is `children` when `s.children` is non-empty, `bodyRuns` when the interleaving form is present, `children+bodyRuns` when both |
| `bodyruns-child-foreign` | **NOT a separate code** — the foreign case reuses `bodyruns-child-unresolved` (one code per *cause* class the author can act on: "this id is not my child"). Recorded so no TestWriter invents a second code | — |

- **`<elementWire>`** = the emitted element's `wire` (`el.wire`, `MinimalElement.wire`,
  `render.ts:43`) — the pathKey for a path-state, `nodeId#<i>` for a fork arm, the
  nodeId otherwise (`:1146-1148`).
- **Never a throw (DECIDED):** every class above is contained — matching
  `eng-bodyruns-wire-ref-review.md:72-77` ("deterministic + contained (never a
  throw)"), `:134`, and the repo-wide `*-shape-invalid` warn-or-skip discipline
  (`eng-inline-order.md:246-247`, `translate.ts:350-353`).
- **Determinism requirement (DECIDED here):** the diagnostic is emitted **once per
  render, at the emit resolver** — `render-helpers.ts:748-755` (the post-emit pass; the resolver call is `:755`) — and **NEVER**
  per adapter call, per re-`setProp`, per re-`createEl`, per re-build, or inside
  `setProp`'s interleaving full-rebuild branch (`adapters.ts:189-214`). The adapters
  stay pure silent consumers (NVA-3, `adapters.md:561`); a diagnostic there would
  also fire once per DOM rebuild and once per SSR re-materialize
  (`adapters.ts:522` / `:599`).

### C4 — The repetition bound · **DECIDED** (the mechanism choice is recorded here; the gate record requires only that a bound exists — `ur-2026-09-17-review.md:42` "MUST NOT warn per-emit without a repetition guard (P2)")

**Hazard (P2):** `emitElements` is called by `renderProducingProcess` on every
render pass — in a live editor that is once per keystroke. An unguarded diagnostic
would print the same line on every pass.

**Chosen bound (the mechanism is a contract decision this spec settles; §8.3 of the
final report flags it as gate-unsettled):** a **module-level signature-dedup set** in
`render-helpers.ts`, keyed by a stable diagnostic signature

```
signature = `${code}\u0000${elementWire}\u0000${runChildValue}`
```

- The set holds **signatures only** (short strings) — never element, node, or run
  objects — so it retains no graph references (the module-state discipline of
  `findElScanCount`, `render-helpers.ts:93-97`, and `stylesSeen`,
  `adapters.ts:113`).
- A signature already present is **not** re-warned. The set is **never cleared on a
  render pass** — that is what makes the bound hold across keystrokes. It is not a
  leak in any bounded sense: its cardinality is bounded by the number of **distinct**
  (code, wire, id) triples the process has ever met, and each entry costs one short
  string. (W4 MAY instead clamp it to a documented maximum; if it does, the clamp
  size must be stated in the W4 pass and must not make the C4 assertion below
  false — a clamp that resets the set would.)
- **Consequence for the emission count (the assertion the TestWriter uses):** for
  `N` repeated `emitElements` calls over an unchanged input, the emission count is
  **1** for a signature and therefore `≤` the number of **distinct** dropped/
  duplicate signatures in the input. It is never a function of `N`, and never
  unbounded.
- **The rejected alternative:** an "once per `emitElements` call" set. It bounds the
  count *within* a pass but re-warns on every pass = per keystroke, which is exactly
  the P2 hazard. Recorded as REJECTED. (A per-call variant is acceptable ONLY with an
  additional cross-pass dedup, which collapses into the chosen mechanism.)

**✎ RECORDED HAZARD 2026-09-22 (W4 audit finding 3 — the process-level dedup's
CROSS-DOCUMENT effect; the semantics below are SPEC-PERMITTED, recorded as
observability/documentation debt, NOT a code bug):** the set is **PROCESS-level**
and it is keyed on `(code, elementWire, value)` — the **element wire is NOT
document-scoped** — so the guarantee the bound actually provides is:

> **one warn per `(code, wire, id)` per PROCESS — never per document.**

Two host-visible consequences, both a direct reading of the clauses above:

1. **Cross-document suppression (the sharp edge).** A host that renders several
   documents in ONE process can be **silently denied a diagnostic it never saw**:
   document B's `{ child }` drop is not warned if document A (an earlier render in
   the same process) already met the same `(code, wire, id)` triple. Wire
   collisions across documents are **reachable** whenever ids/wires come from a
   **loaded or serialized payload** (a `loadState`-seeded graph, a re-serialize,
   a doc-carried envelope — the nodeId/wire scheme is authored data, not a
   process-unique handle), which is exactly the SSR/producing-process host shape
   this layer was built for. The suppression is **not** an error state: the
   contract above deliberately makes the bound hold **across keystrokes and
   across documents**, and §9.2 records that no clamp was applied.
2. **The memory shape.** The set **grows for the life of the process** — one short
   string per distinct `(code, wire, id)` triple, retained forever, **no clamp**
   (permitted by this clause's "W4 MAY instead clamp it" wording; §9.2 records
   that none was applied). It holds no graph references (above), so the cost is
   bounded by the distinct-signature count — but that count is unbounded in a
   long-lived multi-document process.

**Host expectation (the mitigation, recorded so a host can act):** a host that
needs **per-document** diagnostics must either (i) **route/wrap `console.warn`
per document** around its own render call (install a per-render capture or tag the
emitted line with the document it is rendering), or (ii) **accept the
suppression** — the first occurrence in the process is always reported, and a
repeat across documents is by design. A host that requires per-document
completeness must NOT read the absence of a line as "nothing was dropped".
Tracked as residual **R-W4-5** (§9.6b/§9.8) with its parked revisit row in
`docs/pending.md`.

**Why it cannot break the smoke guard or a census:**

| Guard | Why a `console.warn` at the emit resolver cannot trip it |
| --- | --- |
| `demo-smoke.mjs:461-462` — `prof.warningsMain === 0` | `warningsMain` is NOT a console counter: it is `translated.warnings.length`, the **K4 translate channel** (`demo/legacy-shape.js:913`), asserted over `PROFILE` fields (`demo-smoke.mjs:419`, `:406`). A `console.warn` at emit does not enter `translated.warnings`; **by construction the diagnostic cannot change `warningsMain`**. A pass that instead added the diagnostic to the K4 channel WOULD break this guard (the gate's S1 hazard) |
| the census guards (`demo-smoke.mjs:419`, `:445-478`) | they assert `registered`/`inTree`/`unplaced`/`destroyed`/`cloneOps`/`prototypes`/`states`/`elements`/`passes`/`fanOut`/`stylesRules` — none of them counts warnings or elements created by a diagnostic. C6 (no new `MinimalElement` field, no fresh array) is what keeps `elements`/ops counts stable |
| the derived-fork pins (`demo-smoke.mjs:327-336`, `:359`; AGENTS.md item 4) | the diagnostic adds no per-element scan: C1's local map is already built per element (`:221-233`), C3's signature check is O(1) per met class, and the resolver still bails on non-body text (`:213`). The warn path is **not** on the hot path of a page with no drops |
| the smoke's demo corpus | no demo or `demo/*.js` module authors `bodyRuns` (grep: zero matches for `bodyRuns` across `demo/**.js`), so no demo page can emit a drop diagnostic — the smoke's console output is unchanged by construction |

### C5 — The `text`-node `children`/`bodyRuns` clause (N2) · **DECIDED** (adopted shape recorded here; the code is W4)

**The behaviour today (cite it — ✎ RE-ANCHORED 2026-09-22, W4 finding 1: this was
`:1155-1162` pre-W4):** `emitOne` returns early for a `text` node
(`render-helpers.ts:1242-1275`; the `props['text']` write is `:1271`, the hard-coded
`childOrder: []` is `:1272`), emitting `props['text']` from
`scalarBinding(s.bindings) ?? s.content` and hard-coding `childOrder: []`. It never
reads `s.children` or `s.bodyRuns`. A `text` node with authored `children` /
`bodyRuns` therefore loses that subtree **silently on every root class**.

**Adopted rule (DECIDED):** **WARN-AND-DROP** — the least change consistent with
`ur-2026-09-17-review.md:231` ("the warn/containment half rides W4") and with C6.

1. When a `text` node carries authored `children` (non-empty) and/or a `bodyRuns`
   in the **interleaving** form (`isInterleaving`, `:145-149` — ≥2 runs or any
   `{ child }` run), the emit resolver emits **one** `console.warn` with code
   **`text-node-children-ignored`** (C3 catalogue).
   **✎ C5.1 TRIGGER CORRECTION (AMENDED 2026-09-22, adversarial F2):** `isInterleaving`
   is a **NORMALIZATION flag**, not a loss flag — it decides whether the run set is
   ENCODED instead of the scalar content, and a `{ child }`-free run set of ANY
   length is *non-structural* (it names no element). The **trigger is therefore C5.3's
   drop criterion** (authored children **or** a `{ child }` run), never bare run
   count. `isInterleaving` remains the correct predicate only for the
   *normalization* question (`emitTextProp`, `:151-156`).
2. The element is emitted **exactly as today** — `childOrder: []`, `props['text']`
   from the existing `scalarBinding(s.bindings) ?? s.content` expression
   (`:1270-1271`). **No children, no `bodyRuns`, no wrapper text is synthesized.**
   (Note for precision: `emitOne`'s `text` early return never consults `bodyRuns` at
   all, so the runs are NOT encoded into `props['text']` on this path — the scalar
   content expression wins verbatim.)
3. **The DROP CRITERION (explicit — C5.3, AMENDED 2026-09-22 (adversarial F2)):**
   the `text-node-children-ignored` warn fires **exactly when the node carries
   authored `children` (non-empty) OR at least one `{ child }` run**. A
   **`{ child }`-free run set — of ANY length, i.e. any number of `{ text }` runs —
   NORMALIZES into the scalar `text` prop and is SILENT**: no element, no wire and
   no child is named by it, so nothing is lost and the clause must not warn.
   - **`isInterleaving`-vs-drop-criterion distinction (the F2 root cause).** The
     predicate at `render-helpers.ts:145-149` returns `true` for `runs.length > 1`
     as well as for any `{ child }` run, so a **childless** `text` node with
     `bodyRuns: [{ text: 'A ' }, { text: 'x' }]` is "interleaving" but loses
     **nothing** (both runs carry only text; the node emits its scalar content and
     `childOrder: []`). The predicate answers *"should this run set be encoded
     instead of the scalar content?"*; the drop criterion answers *"would authored
     content be dropped?"*. They coincide only on the `{ child }` case — deriving
     the warn from `isInterleaving` alone over-strengths the clause and makes a
     **correct** implementation FAIL the row (audit finding F2;
     `tests/unit/bodyruns-drop-diagnostics.test.ts` A+4c pins the silence, and
     P-IM-4's silent arm is `bodyRuns ∈ {absent, [{text}], [{text},{text}]}` with
     `children: []`).
   - Consequence for the pre-F2 landed row: the generator's
     `children.length === 0` arm demanded **exactly 1** warn for that class — an
     assertion no correct C5 implementation can satisfy. It is corrected to
     **silence**, and the RED warn half stays on the authored-children and
     `{ child }`-run arms (so P-IM-4 remains genuinely non-vacuous).
   - A **single** `{ text }` `bodyRuns` likewise normalizes to scalar `content`
     (`eng-inline-order.md:87-96`, `:145-149`) and is not a loss — this is
     unchanged and is the landed A+4-control / P-IM-4-control contract.
4. The diagnostic obeys C4 (same signature-dedup mechanism; signature
   `` `${code}\u0000${wire}\u0000children` ``).
5. **REJECTED alternative — "reject-and-warn" (a throw).** The DOM safety argument
   is a **throw hazard, not a licence to throw ourselves**: appending a child to a
   real `Text` owner reaches `o.appendChild(c)` (`adapters.ts:311-322`) where `o` is
   a genuine `Text` in a real DOM (`createEl` returns `document.createTextNode('')`
   when available, `adapters.ts:149-150`) → `Text` has no `childNodes` semantics and
   the call raises a `HierarchyRequestError`. The repo's containment discipline is
   warn-never-throw (`eng-bodyruns-wire-ref-review.md:72-77`;
   `eng-inline-order.md:246-247`); a throw in the emit path would also violate the
   adapter-silence pin (`adapters.md:561`) and the "never a throw" letter of the
   approved shape. Recorded REJECTED.
6. **Cross-reference only:** the bare-text render contract itself (Shape A1, the
   no-wrapper emit, the content-only rule, `childOrder` positioning) is **not**
   restated here — see §4.
7. **The translate-time warn is a DIFFERENT seam and stays as it is:**
   `text-content-only` fires at translate for a **legacy-JSON** doc and covers only
   `props|css|handlers|placement` (`translate.ts:956-958`). It does **not** cover
   `children`/`bodyRuns`, and a programmatically constructed `text` node warns
   **never** (N6, `ur-2026-09-17-review.md:235`). C5's code closes that gap at the
   emit boundary without touching the translate seam.

### C6 — The byte-identical guarantee (and the no-new-field rule) · **DECIDED** (the zero-op diff contract, `eng-inline-order.md:178-186`, `:227-232`; `ur-2026-09-17-review.md:42`)

1. An emit whose elements have **no dropped run, no duplicate-id reference, and no
   `text`-node children** is **byte-identical** to today's emit: the resolver returns
   untouched (C1 step 1 or the `:174-176` bail), and no diagnostic fires.
2. **No field is added to the returned `MinimalElement`** (`render.ts:42-54`). The
   diagnostic rides `console.warn` only. Reason (stated so it cannot be "helpfully"
   reversed): a drop-list field would enter the per-prop `===` compare
   (`render.ts:85-94`) and would need a **fresh array per emit**
   (cf. `eng-inline-order.md:178-186` §5.2 REJECTED exactly this shape), producing a
   spurious `set` op on every pass and breaking the zero-op diff contract.
3. **A resolving rewrite is diff-safe:** the rewrite lands in the emitted
   `props['text']` **string** before `diffMinimal`'s `===` compare, so an unchanged
   interleaving still emits zero `set` ops (`eng-bodyruns-wire-ref-review.md:81-83`;
   `eng-inline-order.md:144-149`).
4. **`orderSig` is linear and unchanged** (`render.ts:99-105`): no new per-element
   structure pass, no new `childOrder` write.
5. **The zero-cost bail stays:** a `props['text']` that is not body-encoded, or that
   carries no `{ child }` run, returns immediately (`:174-176`) — the no-`bodyRuns`
   pages pay nothing (`decisions.md:20` D4; the derived-fork pins stay within the
   2.5× asserted guard, `eng-bodyruns-wire-ref-review.md:138-141`).

### C7 — `base.bodyRuns` is never mutated · **DECIDED** (`eng-bodyruns-wire-ref-review.md:63-64`, `:135-137`; `decisions.md:20` D3, `decisions.md:24`)

1. Only the **emitted** `props['text']` string is rewritten; the authored
   `base.bodyRuns` array and its run objects are **never** written — not by the
   resolver (which builds a NEW `rewritten: BodyRun[]`, `:190`), not by any other
   emit site (all six def-fill sites read `proto.base.bodyRuns` read-only,
   `:881`, `:976`, `:1018`, `:1027`, and the pathstate gate §3.1 sites).
2. Consequence: `nodeToLegacy`/`serializeNode` keep the **authored** ids
   (`translate.ts:1230` — `if (node.base.bodyRuns !== undefined) data.bodyRuns =
   node.base.bodyRuns`; `serialize.ts:288`), so the reverse JSON equals the input
   JSON and a re-translate is idempotent (`eng-bodyruns-wire-ref-review.md:63-64`).
3. **The diagnostic must not become a mutation vector** (DECIDED): a W4
   implementation that "fixes" a dangling run by deleting it from `base.bodyRuns`
   would break this clause AND the round-trip. The drop is **emit-local**.

### C8 — Version framing

- **Type of change:** a **patch**, `X.X.Y` per VERSIONING-SCHEME
  (`docs/decisions.md:18`): the signature of `emitElements` is unchanged, no public
  type changes, no new `MinimalElement` field, no behaviour change on any
  well-formed document (C6). Target version **0.5.1**.
- **When it would be a minor:** only if the channel became a `RenderWarning[]`
  return/out-param (`ur-2026-09-17-review.md:410-425` option (ii), own gate). NOT
  chosen.
- **When it would be a major:** not here. `bodyRuns` **removal** is the 1.0.0 work
  (branch (b), user-ruled; §2.2 row 8); the N1 containment fix and the C5 clause are
  **behaviour-preserving for every well-formed document** — they change only
  malformed/foreign/duplicate shapes that today render wrong or silently.

---

## 4. The `text`-child emit contract (cross-reference only)

The **bare-text render contract itself is NOT restated here** (AGENTS.md item 6:
one contract, one home; AC-30 — `ur-2026-09-17-review.md:373`). The W3 fold creates
the behaviour-spec rows; this spec only points at them.

| Row the W3 fold creates | What it carries | This spec's relation |
| --- | --- | --- |
| `docs/specs/adapters.md` §3.1 step table — the `type === 'text'` step (AC-1) | `document.createTextNode('')`, the shim `span` fallback, the skipped `dataset.wire` write | citation only; C5 does not restate it |
| `docs/specs/adapters.md` §3.2 `:205-206`/`:215` Text-owner rows (AC-2) | on a `Text` owner, only `text` is honored; every other name returns without writing | C5 §5 cites it for the DOM safety rationale |
| `docs/specs/adapters.md` §4.1/§4.3 + §10.1/§10.2 Text rows (AC-3..AC-6) | the `isText` descriptor branch; the bare append; the `[text,strong,text]` content oracle; the `text`-as-root serialization | citation only |
| `docs/specs/render.md` — the emit rule (AC-7/AC-8) | the emit rule stated as **silent filtering**, version-scoped `>=0.4.0 <1.0.0`, with the 1.0.0 revisit | **this is where C5's "the element is emitted exactly as today" half belongs**; C5 adds only the diagnostic (a separate concern, separate file) |
| `docs/specs/node.md` §2 — the `text` type (AC-7) | the type definition | citation only |

**Version scope (DECIDED):** the bare-text emit contract applies to
**`>=0.4.0 <1.0.0`** (`ur-2026-09-17-review.md:40`, `:110-113`; AC-7 `:325`), with the
**1.0.0 revisit** (XOR render enforcement + `bodyRuns` removal +
`content-with-children-recommended`, `translate.ts:965-970`, `docs/decisions.md` BARE-TEXT-EMIT row — the `:23` citation in earlier drafts was line drift; the row is at `:24` as of 2026-09-22, so it is cited **by name**). The
C5 diagnostic in this file is scoped the same way: it describes the behaviour of the
bare-text emit as it exists in that window and is retired/rewritten at the major
alongside the emit rule it annotates.

---

## 5. THE TYPED PROPERTY REGISTER (PBT gate deliverable)

**Rules applied:** ≤ 8 rows; only `P-IM` (invariant), `P-SM` (state-machine /
transition), and `P-TP` (transform / round-trip) kinds; **no `F-` rows and no
`§6`/`FS-n` numbered items** in this register; each row carries an id, the property
statement, its kind, the strategy the TestWriter must implement, the falsification
condition (what a counterexample looks like), and the contract clause(s) it pins.

> **Format note (a contract decision this spec had to make):** the referenced
> `docs/specs/gate-preset-pbt-astral-pilot-log.md` **does not exist in this
> repository** (globbed `**/*pbt*`, `**/gate-preset*` — no matches), and no existing
> spec carries a `§5.x` register with `P-IM`/`P-SM`/`P-TP` ids (grep `P-IM|P-SM|P-TP`
> across `docs/` — no matches). The row shape below therefore follows the repo's
> established register style — a compact `| ID | property |` table with the
> supporting columns required by this pass (see `docs/specs/payload.md:47-54`
> `P-1..P-8`, `docs/specs/node.md:42-46` `SI-1..SI-5`, `docs/specs/serialize.md:172-176`
> `SER-*`, `docs/specs/adapters.md:538-544` `PAR-*`/`NVA-*`) — with the kind, strategy,
> falsification and clause columns added as this pass requires. The id prefixes are
> used exactly as specified (`P-IM`/`P-SM`/`P-TP`).

| ID | Kind | Property statement | Strategy / generator (TestWriter implements) | Falsification condition (a counterexample looks like) | Pins |
| --- | --- | --- | --- | --- | --- |
| **P-IM-1** | invariant | **Containment: no run ever resolves to a foreign wire.** For every emitted element `el` and every `{ child: w }` run in `decodeRuns(el.props['text'])`, `w ∈ el.childOrder` — unless the run was dropped, in which case it is absent from the decoded runs entirely. A run that names an authored id whose only resolution lies outside the element's own subtree never appears as a foreign wire | Seed a graph of **`k ∈ [2,6]`** elements **(✎ AMENDED 2026-09-22 — ORACLE-1 CORRECTION: the cell said `k ∈ [1,6]`, which contradicts this same row's F5 clause — at `k = 1` every child in the graph belongs to the single element, so the mandatory (host, foreign authored child) pair **cannot exist** and the generator's F5 throw fires BEFORE any emit — measured 19/100 attempts; the row was a generator crash, not a satisfiable property. `k ≥ 2` AND ≥ 1 child per element make the pair constructible for every seed, and the throw survives as the §8.3/F5 loud guard, now unreachable)**. For each: a random `childOrder` of `j ∈ [0,5]` children; assign authored ids from a small pool (`p ∈ [1,4]` ids incl. the empty string and `undefined`) so **foreign collisions are common**; assign a random `bodyRuns` of `m ∈ [0,4]` runs whose `child` values are drawn from authored-id pool ∪ child wires ∪ random junk strings ∪ **ids that exist only in ANOTHER element in the same graph**. Emit with a NON-EMPTY global index (a real `emitElements` call over the whole actionable set). **Per-attempt liveness requirement (AM-2 vacuity audit — mandatory; ✎ ENFORCEMENT AMENDED 2026-09-22 (adversarial F5)):** every attempt must contain **at least one `{ child }` run whose value is NOT a member of that element's own `childOrder`** (a wire or authored id that exists only in another element, or a junk string), so the containment assertion has a live candidate on every attempt and the row cannot be hollowed out by a generator that only emits own-child refs. **F5 makes this ENFORCED, not probabilistic:** the generator must *positively construct* at least one such run per attempt (the landed shape injects a run naming another element's authored child id whose value is provably outside the host's own children) and the row must **assert the generator actually produced it** — an attempt without it FAILS with a clear liveness message, and a graph from which the required pair cannot be built throws rather than silently shrinking to own-child refs. Assert per element **(a) the universal negative**: every surviving `{child}` wire is in `el.childOrder`; **and (b) the POSITIVE half (F5)**: for every input run whose value is a **foreign wire** (a wire belonging to another element in the same emit) or a foreign authored id mapping to no own child, the element's emitted run set must **not contain that wire at all** — the run must be DROPPED (a dropped-then-re-added, or rewritten-to-another-own-child, slip passes the universal negative yet fails (b)) | an emitted element whose `props['text']` decodes to `{ child: w }` with `w ∉ el.childOrder` — e.g. element A owns child `node-1`, element B owns child `node-2`, B's run `{ child: 'a1' }` (A's child's authored id) rewrites to `node-1` instead of dropping. **This is exactly N1 today.** Also: an emitted run set that still CONTAINS a foreign wire value (F5(b)); an attempt whose generator produced no non-own-child run (a liveness violation, reported as such — never a silent pass) | C1, C2 |
| **P-IM-2** | invariant | **Determinism + idempotency + NON-VACUITY: the same input emits the same output, the diagnostic count never grows with the number of passes, and the C3 diagnostic layer is actually present.** For `N ∈ [2,5]` successive `emitElements` calls over the SAME actionable array + the same `nodeById`: (a) every call returns structurally equal elements (wire/type/props/childOrder/styles) and byte-identical `props['text']`; (b) the number of diagnostic calls in pass `n>1` is **0** while the input is unchanged; (c) the total count over `N` passes is ≤ the number of distinct dropped/duplicate/`text`-children signatures in the input; **(d) — the NON-VACUITY clause, AM-2, folded in as a first-class falsification condition — the number of NEVER-SEEN dropped signatures derivable from the INPUT (compared against the diagnostic count emitted on pass 1, made dedup-aware for C4's process-level signature set) must NOT exceed that pass-1 count.** (b) and (c) are **bound** clauses: they are satisfiable by an implementation that emits nothing at all, so they cannot alone distinguish "the bound holds" from "nothing exists". (d) is the clause that closes that hole: it is the *lower* bound the C3/C4 clauses imply (each never-seen dropped signature must produce exactly one warn on its first pass), so (b)+(c)+(d) together are strictly stronger than (b)+(c) and cannot report HELD while the diagnostic layer is absent. **AMENDED 2026-09-22 (AM-2):** clause (d) is ADDED above; the row's kind (`P-IM`) and its pins (C1, C3, C4) are unchanged. | Generate one input per attempt (as P-IM-1); `vi.spyOn(console, 'warn')` once around `N` sequential emits; record per-pass output + per-pass call count; compare pass 1..N deep-equal (a canonical JSON of the element set). **For (d) the TestWriter MUST implement, in addition (AM-2 — the strategy the row now requires, landed shape the P-IM-2 case in `tests/unit/bodyruns-drop-diagnostics.test.ts`):** (i) a **process-level `seen` set maintained for the whole register file** (mirroring C4: the implementation's dedup set is module-level and never cleared, so a signature a previous attempt legitimately met is suppressed) — never a fresh set per attempt; (ii) a **`fresh` set derived from the INPUT, never from the emitted output** (the emitted `props['text']` cannot show a dropped run): one entry per `{ child }` run of every actionable element that is **NOT resolvable as a member of that element's own `childOrder`** — i.e. the set of `` `unresolved\u0000<elementWire>\u0000<runChildValue>` `` strings per C3's message-shape parts, restricted to runs that **genuinely fail to resolve by the spec's OWN rules** — the same `\u0000`-joined signature form C4 pins, with C3's code as the first field — the separator must be written as the `\u0000` escape, never as a raw control byte; then `fresh = { s ∈ expected : s ∉ seen }`, and add `fresh` to `seen` **before** the emits. **Over-strength guard (mandatory, so clause (d) can never fail on legitimate input) — ✎ AMENDED 2026-09-22 (adversarial F3): the guard is enforced by TAGGING every generated run with its resolution CLASS, and building `fresh` ONLY from the drop class.** The classification (deterministic, derived WITHOUT reading the emitted output) is exactly four values — `own-wire` (the value is a wire of the element's own `childOrder`: C1 step 1 RESOLVES), `own-authored` (the value is the authored `base.props.id` of one of that element's own children — consult the node map per `childOrder` wire, `render-helpers.ts:178-187`: C1 step 2 RESOLVES), `foreign` (a wire or authored id that exists in the graph but belongs to ANOTHER element: C1 step 2 fails and — even though the PRE-W4 code rewrites it through the global index (`:196-203`) — **C2/C1 step 4 mandates a DROP**, so this class IS a drop signature and counts toward `fresh`), and `junk-absent` (a value that is neither: a certain C1 step 4 drop). **A `foreign` run is a drop by contract and MUST count**; an `own-wire`/`own-authored` run RESOLVES and must NEVER count — counting it would demand a diagnostic for a run that legally resolves and produce a **false red at W4** (the pre-F3 landed generator did exactly that by counting EVERY `{ child }` run, ≈7/10 of them own wires). The simplest legal generator restriction that satisfies this by construction: draw the run values only from the element's own child wires ∪ guaranteed-unresolvable junk (never the authored-id pool), which makes the counted class unambiguous; (iii) a **guaranteed fresh signature per attempt**: give the first element one run with a **run-scoped unique unresolved id** (`ghost-<i>`, `i` = the attempt index — never `undefined`/`''`, never a value any other attempt generates), so `fresh.length ≥ 1` on every attempt and the attempt is intrinsically non-vacuous; (iv) read `perPass[0]` (the pass-1 diagnostic count — the `console.warn`-spy delta before the second emit) and fail the attempt when **`fresh.length > perPass[0]`**, reporting the counts (`fresh.length` vs `perPass[0]` MUST appear in the report line, §8.3) — **the landed row asserts `perPass[0] >= fresh.length`; W4 MUST tighten it to `perPass[0] === fresh.length` on pass 1** once the C3 emission and the C4 dedup set exist, and the equality is the W4-grade form of this clause; (v) when `fresh.length === 0` the clause is **silent** (no assertion) AND the row may not be reported HELD (no live clause ⇒ `UNDETERMINED`, §8.3) — that is the only legitimate vacuity, and it is unreachable when (iii) is implemented. **✎ AMENDED 2026-09-22 (adversarial F3)** — the class-tagging requirement above is binding on the landed test and this register cell; the row's kind (`P-IM`) and its pins (C1, C3, C4) are unchanged. **⛔ SUPERSEDED IN PART — ORACLE-2 CORRECTION 2026-09-22 (see §1.1 row `W5-1` and the executed post-correction report in §9.5(a)): clauses (c) and (d) were mutually UNSATISFIABLE as specified above, in two independent ways, and the test file is corrected — `src/**` untouched.** (1) **clause (c):** the F3 filter admitted only `junk-absent` into `expected`, while C3 row 2 MANDATES a `bodyruns-child-unresolved` warn for every `foreign` drop — including the row's own two F5 liveness injections — so `total = expected.size + 2` on the first attempts with no prior row in the process. **`expected` now carries EVERY drop class C3 mandates for the input: `unresolved` (`junk-absent` ∪ `foreign`) **and** `duplicate`** (a run referencing an authored id carried by ≥2 of the element's own `childOrder` wires — the C1 step 2 local-first warn, which the class filter above never counted); (c) is restated as the **per-signature** bound only (`total ≤ expected.size` over `N` passes, never a whole-graph absolute count — §5's own Omission note). (2) **clause (d):** the `seen` set was ROW-LOCAL while C4's set is PROCESS-LEVEL and is **never cleared** — so a signature an earlier row in the SAME file already fired stays in `fresh` although the contract FORBIDS pass 1 to warn it again (`fresh.length=2 perPass[0]=1`). The correction implements §8.3's own reporting rule ("account for a signature possibly already seen in this process"): `fresh` is filtered against a **process-level** suppression set = the file's earlier cases' signatures **plus** every signature this row's earlier attempts derive. **Namespace isolation is required for that to be exact:** the C3 signature embeds the ELEMENT WIRE, so two rows that both emit an element named `el-0` share each other's signatures — the 100 P-IM-1 attempts fire `bodyruns-child-unresolved at el-0` for the JUNK pool (`nope-1`/`nope-2`/`ghost`), which is exactly what P-IM-1's own injections and this row's `fresh` predictions draw from. **P-IM-2 therefore generates in its OWN `pim2-<e>` element namespace** (a generator parameter), so no cross-row signature collision can make (d) unsatisfiable. Suppression is one-directional: it can only stop the row from demanding a warn C4 forbids, never make (c)/(d) pass where the diagnostic layer is absent. (3) **the same `k ≥ 2` + ≥1-child-per-element precondition P-IM-1 required** is applied here, so the F5 injections the `expected` set must account for are always constructible rather than probabilistic. (4) **The W4-grade tightening is now asserted:** `fresh.length <= perPass[0]` on pass 1 — legitimate now because the suppression set is process-level rather than row-local. | (a) any two passes differ in output (a fresh array/object leaking into `props`, a counter folded into the value); (b) pass 2 warns again for the same signature (the per-keystroke P2 hazard); (c) `count(N) > distinct-signatures` — i.e. the count scales with `N`; **(d) — the vacuous-GREEN hole this clause closes — `fresh.length > perPass[0]`: the input carries `fresh.length ≥ 1` dropped signatures the process has never met (a run whose `child` resolves to nothing in its own `childOrder`, the per-attempt unique `ghost-<i>` run among them) while pass 1 emitted fewer than that many diagnostics. The minimized counterexample shape: one element with `childOrder: []` (or a childOrder containing no wire equal to the run's `child`), `bodyRuns: [{ child: 'ghost-<i-unique>' }]` — the signature `bodyruns-child-unresolved\u0000<wire>\u0000ghost-<i-unique>` is derivable from the INPUT, and today's code emits **0** diagnostics, so `1 > 0` and the row is RED. This is exactly the state the TestWriter's first run got wrong: with (d) absent, (b) and (c) both held and the row reported HELD although no diagnostic exists anywhere in `render-helpers.ts`. **Over-strength check (AM-2; ✎ tightened 2026-09-22 (adversarial F3)): (d) does NOT fail on legitimate input**, provided the `fresh` derivation applies the **class filter** in the strategy column — a run whose class is `own-wire` or `own-authored` legally RESOLVES (C1 step 1/2) and is excluded, so (d) demands a diagnostic only for the drop classes the contract itself requires to be warned. Without that filter (d) WOULD over-strength: a run resolving through C1 step 1/2 contributes no warn yet would be counted, producing a **guaranteed false red on a well-formed document** — hence the class filter is **mandatory**, not advisory. (Note the pre-F3 landed shape counted EVERY `{ child }` run, i.e. exactly this over-strength; the audit's F3.) The `foreign` class is NOT excluded: C2/C1 step 4 makes it a drop, so it legitimately owes a warn.** | C1, C3 (determinism requirement + the per-class warn), C4 |
| **P-SM-1** | state-machine / transition | **Duplicate authored id: the first match in `childOrder` wins, and a run that references the duplicated id warns.** For an element whose `childOrder` contains ≥ 2 wires carrying the same authored `props.id`, a run `{ child: <that id> }` resolves to the **earliest** such wire in `childOrder` order (never the latest, never the global index's choice when the local map holds the id), and exactly one `bodyruns-child-duplicate` warn is emitted for that signature. A duplicate that NO run references emits no warn | `j ∈ [3,6]` children; pick **`d ∈ [2,3]`** authored ids to duplicate **(✎ AMENDED 2026-09-22 — ORACLE-3 CORRECTION: the cell said `d ∈ [1,3]`, which contradicts this row's OWN property statement — "an element whose `childOrder` contains **≥ 2** wires carrying the same authored `props.id`". `d = 1` means **no duplicate exists at all**, so C3's trigger is not met and the run naming the (unique) id resolves through C1 step 2 with **0** warns; the pre-correction generator demanded exactly 1 (measured: 9 of 40 attempts). `d ≥ 2` for every WARN-arm attempt makes the row assert the property it states. The degenerate single-wire shape is retained as a **SILENT control** — the sharpest form of C3's reference gate: the run names an id that resolves to exactly one child, so a warn there would be a false positive)** (the duplicated positions are the FIRST `d` `childOrder` positions, so "earliest" is well defined; every other position carries a UNIQUE `other-<c>` id**); `bodyRuns` referencing the duplicated id for a random subset of attempts, and a **UNIQUE, non-duplicated id** for the control subset. Assert the resolved wire = the first `childOrder` position carrying that id; assert the warn count (**1** for the referencing subset — one per signature however many duplicates exist — and **0** for the control). **✎ F7 (ADVERSARIAL CORRECTION 2026-09-22 — audit finding 7; the control was previously NOT the described input and the cross-pass bound was untested):** (a) the **control** must be a shape in which **a duplicate EXISTS while the run references only a unique id** (`childOrder = [a(dup), b(dup), c(other)]`, run names `other`) — otherwise C3's reference gate ("warns only when a run actually references the duplicated id") is never exercised and the control is satisfied by an emit that warns about nothing; the row must also assert the control was actually reached (an anti-inert-control guard); (b) the row must additionally emit the **SAME element wire a second time** and assert the duplicate warn **does not repeat** — this is C4's cross-pass bound applied to `bodyruns-child-duplicate` (P-IM-2 applies it only to `bodyruns-child-unresolved`); a *second element* cannot prove it, because the C4 signature is `` `${code}\u0000${elementWire}\u0000${runChildValue}` `` and a different elementWire yields a different signature | the resolved wire is the LAST duplicate; the run resolves through the global index to a wire outside `childOrder`; the control subset warns (a warn merely because a duplicate exists — that would fire on legal documents); ≥ 2 warns for one signature; the duplicate warn **repeats across two emits of the same wire** (C4 violated) | C1 step 2, C3 (`bodyruns-child-duplicate`), C4 |
| **P-IM-3** | invariant | **Byte-identical passthrough on the clean input.** An emit whose elements have no `{ child }` run (no `bodyRuns`, or a scalar/normalized `bodyRuns`) and no `text` node with authored children produces: zero diagnostic calls, zero `RenderOp`s from `diffMinimal(prevMap, els)` where `prevMap` is the same element set keyed by wire, and elements structurally equal to the pre-change emit (no added field on `MinimalElement`) | Generate random trees with `bodyRuns ∈ {absent, [{text}], [{text},{text}]}` (never a `{child}` run) and no `type:'text'` element with children; emit twice; assert (a) `warn` spy not called, (b) `diffMinimal(prev, els)` is `[]`, (c) the element key set is exactly `{wire,type,props,childOrder}` (+`forkKey`/`styles` when present) — i.e. `Object.keys(el)` contains nothing new | any `set` op on the second diff; a warn on a clean emit; a new key on the returned element; a `childOrder` element that differs from `[...children]` | C6 (1,2,4,5) |
| **P-TP-1** | transform / round-trip | **`base.bodyRuns` immutability and reverse fidelity.** No emit path mutates the authored run array: after `emitElements`, every input `bodyRuns` array is deep-equal to a pre-recorded snapshot of itself, and the emitted rewrite lives only in `props['text']`. Consequence: reverse/serialize keeps authored ids (`translate.ts:1230`, `serialize.ts:288`) so `reverse(emit(input)) ≡ input` for the `bodyRuns` field | Snapshot `JSON.stringify(runs)` before the emit (deep clone); run the emit (with drops, duplicates and resolving runs all present); assert the source arrays are deep-equal to the snapshot AND that every dropped/duplicate id still appears in the source array verbatim; additionally run `translateLegacy → emitElements → nodeToLegacy` on a legacy doc whose child carries `bodyRuns` and assert the reversed `bodyRuns` equals the authored one. **✎ AMENDED 2026-09-22 (adversarial F4) — the property's SECOND half is asserted, not merely computed:** on the SAME attempt, assert BOTH (i) `decodeRuns(el.props['text'])` **contains the expected wire** for the resolving run (the run authored as `{ child: 'own-<i>' }` appears as the element's own child wire — and every emitted `{ child }` wire is a member of `el.childOrder`, C2), **and** (ii) the authored `bodyRuns` array still **deep-equals its pre-emit snapshot** after the emit (the rewrite is emit-local, C7 §1/§3). Additionally generate a `foreign-<i>-<r>` run (an id present in the global index but not in this element's `childOrder`) and assert it is **ABSENT from the emitted string** (`decodeRuns(props['text'])` contains no run with that value) — C2's "drop, never rewrite" half, which the pre-F4 landed row left unasserted (it computed `emitted` and discarded it). The landed shape must run both halves on every attempt that authors the relevant run class | the authored array lost a run (the "fix by deleting from `base`" mutation vector, C7 §3); a run object was replaced/renamed; the reversed JSON carries a minted/synthetic wire instead of the authored id; **the resolving run is absent from the emitted `props['text']` while the snapshot assertion alone still passes (the two halves coupled on one attempt); a `foreign-<i>-<r>` value reappearing in the emitted string — rewritten to a wire or re-added — instead of being dropped (F4)** | C7 (1,2,3), C3 (never a throw), C2 (the drop half) |
| **P-IM-4** | invariant | **The `text`-node clause never synthesizes structure.** For a `text` node with authored `children` and/or a `{ child }` run: the emitted element has `childOrder: []`, carries no `on:`/`css:`/`prop:`/`data:` prop (only `text`), and — when content would be dropped — exactly one `text-node-children-ignored` warn per signature. **The warn criterion is C5.3's DROP CRITERION (✎ AMENDED 2026-09-22 (adversarial F2)): warn exactly when the node carries authored `children` (non-empty) OR at least one `{ child }` run.** A `text` node with **neither** of those never warns — explicitly including a **childless, `{ child }`-free multi-`{ text }` node** (`bodyRuns: [{text},{text}]` with `children: []`), which is `isInterleaving === true` yet drops **nothing** (the runs normalize; no element/wire/child is named), so warning on it is a contract violation, not a stronger assertion | Generate `type:'text'` elements with random `children` lengths `[0,3]`, `bodyRuns ∈ {absent, [{text}], [{text},{text}], [{text},{child}]}`, and random stray `props`/`css`; emit; assert the element shape + the warn count. **✎ AMENDED 2026-09-22 (adversarial F2) — the warn expectation is assigned by the DROP CRITERION, never by `isInterleaving` or by run count:** (a) the **warn arm** is `children.length > 0` **OR** a `{ child }` run present, and asserts **exactly 1** `text-node-children-ignored`; (b) the **silent arm** is `children.length === 0` AND `bodyRuns ∈ {absent, [{text}], [{text},{text}]}` (any number of `{ text }` runs), and asserts **0**; (c) exactly one expectation is pushed per node (the pre-F2 landed generator pushed the same node id twice — one push was dead, audit finding 14); **(d) ✎ AMENDED 2026-09-22 — ORACLE-4 CORRECTION: the expectation is assigned BY THE CRITERION ITSELF, never by the shape id.** The pre-correction landed generator pushed every shape-1 node into the warn set REGARDLESS of `cLen`, so a shape-1 node with `cLen = 0` carried **`children: []` AND no `bodyRuns`** — nothing is dropped, C5.3 mandates SILENCE, yet the row demanded exactly 1 warn (measured: attempts 12/14/20, 3 nodes). This is the **same over-strength F2 corrected for shape 2** (the childless multi-`{text}` node), left in place for shape 1; no correct C5 implementation can satisfy it. The landed shape now computes `dropsContent = children.length > 0 || a { child } run is present` and pushes accordingly, so shape 1 warns **iff `cLen > 0`** and is asserted SILENT at `cLen = 0`, while the warn arm stays live (shape 1 with `cLen > 0`, and shape 3's `{ child }` run — guarded by the row's anti-inert assertion that ≥1 attempt carried a warn-arm node) **Row scope note:** the assertion is on the WARN + the un-synthesized element, never on "children are emitted" — the clause is warn-and-drop | a `text` element with `childOrder.length > 0`; a `text` element with an `on:`/`css:`/`prop:` key; a warn on a childless `{ child }`-free `text` node — the single-`{text}` normalization case **and the multi-`{text}` case** (both are silent by C5.3's drop criterion; the multi-`{text}` shape is the F2 counterexample, `{type:'text', content:'A ', children:[], bodyRuns:[{text:'A '},{text:'x'}]}`); a **missing** warn on a node that carries authored children or a `{ child }` run (the RED half — warn-and-drop is C5.1); a throw | C5 (1,2,3), C3 (`text-node-children-ignored`) |

**Omissions (required one-line note per row judged over-strength):**

- **No row asserts that a `text` node's authored children are RENDERED.** Would fail on legitimate input and contradicts the adopted C5 warn-and-drop shape (§3 C5.2). Omitted deliberately.
- **No row asserts an exact global warn total for a whole graph.** The dedup set is process-level (C4): a previous attempt in the same file can legitimately suppress a signature, so a whole-graph absolute count is not a property of the code — only the per-signature bound (P-IM-2(c)) is.
  **AM-2 reconciliation:** this omission is why P-IM-2(d) is expressed as a **never-seen-signature lower bound compared against pass 1 of the current attempt** (and never as `total == distinct signatures`): the input-derived `fresh` set is exactly the part of the signature space the process-level set cannot already have suppressed, so (d) is falsifiable without contradicting this omission. A row phrasing (d) as an absolute per-graph total WOULD contradict it and is therefore forbidden.
- **No row asserts that a foreign reference is rewritten to a *placement sibling*.** That is REJECTED option (a) (§2.2 row 1): such a row would encode the rejected semantics as a property.
- **No row asserts an upper bound on the dedup set's cardinality.** W4 may choose a clamp; asserting a size would pre-empt that implementation choice. (If a clamp is chosen, a follow-up row belongs to W4.)
- **No row covers the `:188` empty-map bail as a property** (AM-1 correction of this note's superseded form, which pointed at "§8 Unit A+ case 5"). The bail's stated observable (verbatim run + adapter silent no-op) is **unreachable** (C1's dead-guard bullet, residual R-A1), so no property row can be written over it; the reachable shape is pinned as the GREEN residual controls **A+7a/A+7b** in §8.1. With an empty global index the "resolution order" property would be vacuous, which is the pre-existing reason it is not a register row at all.

**Vacuity audit of the register (AM-2, 2026-09-22; ✎ statuses re-derived by the
F2..F6 correction pass) — per row: can the row pass while the clause it pins is
absent?** The audit covers all six rows plus the landed controls, and is the
evidence for the AM-2 disposition recorded in §1.1. **The statuses below are
exactly the ones the EXECUTED harness now reports** (§8.3 vocabulary, F6 —
`status=…` on every row's report line, recorded BEFORE the assertion so a failing
row still reports); they replaced the pre-F6 prose labels ("BROKEN", "HELD"), which
the executed output did not contain.

| Row | Bounding (upper) clauses | Vacuity hole? | Outcome (AM-2; statuses = the executed report) |
| --- | --- | --- | --- |
| **P-IM-1** | the containment assertion is a **universal negative** (`every surviving {child} wire ∈ el.childOrder`), so an attempt that drops everything satisfies it trivially; today the foreign rewrite (`:196-203`) supplies the counterexample, so the row is non-vacuous **in fact** | **Fragile, not currently vacuous — and closed by F5.** The hole: once C2 lands, an attempt in which nothing resolves **and nothing is dropped** (e.g. an element with `m = 0` runs) still "holds" — a shrinking generator could hollow the row out | **ALREADY NON-VACUOUS — and the gap is now ENFORCED (F5):** the generator must positively construct at least one run per attempt whose value is **not** in that element's own `childOrder`, the row asserts it produced one (a liveness violation fails the attempt loudly), AND the positive half is asserted (a run naming a foreign wire must not appear in the emitted run set). The row's status on today's code is **`EXPECTED-RED`** (`render-helpers.ts:196-203` rewrites the foreign wire — the counterexample is the foreign wire appearing in `childOrder`); it is never reported `HELD` while a live containment candidate exists and a foreign rewrite survives. **✎ ORACLE-1 CORRECTION (2026-09-22):** the `EXPECTED-RED` reading above is the PRE-W4 record (the clamp was unbuilt then); post-W4 the row reports **`HELD`** — but only after the generator was given the F5 precondition (`k ≥ 2` + ≥1 child per element) that makes the row satisfiable at all (`attempts=100 failures=0 positiveHalfLiveAttempts=100`); before that correction it reported `EXPECTED-RED` by THROWING, i.e. it could not distinguish a conformant implementation from any other |
| **P-IM-2** | (b) 0 diagnostics on passes > 1; (c) `total ≤ distinct signatures` — **both hold with zero diagnostics implemented** | **YES — the reported hole.** The TestWriter's first run reported the row HELD with no diagnostic layer anywhere in `render-helpers.ts`, retiring nothing | **FIXED by clause (d)** (folded into the row above, ✎ class filter per F3): the never-seen-signature lower bound derived from the INPUT, built **only** from the drop classes (a `foreign` run counts, an `own-wire`/`own-authored` run never does). The executed row reports **`EXPECTED-RED`** — waits on C3/C4 (C3 for the emission (d) requires; C4 for the dedup set that makes the bound dedup-aware) — with its counts printed: `fresh.length=1 perPass[0]=0`. **✎ ORACLE-2 CORRECTION (2026-09-22):** that reading is the PRE-W4 record. Post-W4 the row reports **`HELD`** (`attempts=100 failures=0 live=true`), after (c)'s `expected` set was rebuilt to carry every C3 drop class (unresolved `junk-absent` ∪ `foreign`, **plus** `duplicate`) and (d)'s `fresh` set was rebased on the **process-level** C4 semantics with the row in its own `pim2-<e>` element namespace — before that the two clauses were unsatisfiable in BOTH directions (`total = expected.size + 2`; `fresh.length=2 perPass[0]=1`) |
| **P-SM-1** | the warn-count clause is an **exact** count (`=== 1` for the referencing subset, `=== 0` for the control) plus an exact resolved-wire assertion; ✎ **F7** adds the C3 reference-gate control shape (a duplicate present while the run names a unique id) and the **C4 cross-pass** no-repeat assertion on the SAME element wire | **NO.** `0 ≠ 1` fails today, so the row cannot pass while `bodyruns-child-duplicate` is unbuilt; and the rewrite half (first-match-in-order) is a positive assertion that today's C1 step 2 satisfies. ✎ **F7:** the pre-correction control named a UNIQUE id, so it was satisfied by an input that did **not** carry the described duplication/reference split — the control now asserts the split it claims (plus it is guarded against going inert) | **ALREADY NON-VACUOUS** — the executed row reports **`EXPECTED-RED`** (the falsifying counterexample: zero warn calls for a referencing duplicate). ✎ **F7 (gate-8, 2026-09-22):** the row's control is now the described input and the C4 cross-pass bound for `bodyruns-child-duplicate` is asserted. **✎ ORACLE-3 CORRECTION (2026-09-22):** post-W4 the row reports **`HELD`** (`attempts=40 failures=0 live=true`) once the warn-arm shape really carries `d ≥ 2` wires with the id; the pre-correction `EXPECTED-RED` mixed a REAL contract failure with 9/40 attempts that demanded a warn where **no duplicate existed** |
| **P-IM-3** | three assertions: 0 diagnostics, `diffMinimal(prev, els) === []`, and the exact `Object.keys(el)`/`childOrder` shape | **NO — structurally immune:** the op-count (`=== 0`) and key-set assertions are **positive** assertions that a missing diagnostic cannot satisfy, so an absent diagnostic layer cannot make this row pass vacuously — it makes it pass *correctly* (C6 is a preservation clause). Its own "0 diagnostics" clause is a **negative** control over an input with no dropped run, so it is not a falsifier of the diagnostic layer by design | **ALREADY NON-VACUOUS** — the executed row reports **`HELD`** (`attempts=60 failures=0 live=true`, the intended outcome: C6 preserves today's clean emit). No clause added: (d)-style non-vacuity is meaningless here because the row's contract is "nothing changed", not "a diagnostic fired" |
| **P-TP-1** | negative (no mutation) + positive (reverse keeps the authored ids, the round-trip emit resolves the run to the own child wire, ✎ **and per F4 the emitted rewrite + the foreign-run absence on the same attempt**) | **NO — the positive halves are the protection:** the round-trip clause requires the emitted `{child}` to equal `rtP.childOrder[0]` (`translate.ts:1230`, `serialize.ts:288`), which no diagnostic layer can make true; the immutability clause (`JSON.stringify(authored) === snapshot`) is a regression guard whose failure mode is a mutation, not an absence | **ALREADY NON-VACUOUS** — the executed row reports **`HELD`** (`attempts=50 failures=0 live=true`); "deliberately vacuous" **not** applicable, and per F4 the property's second half is now asserted rather than computed-and-discarded |
| **P-IM-4** | the warn clause is an **exact** count (`=== 1` per authored-children / `{ child }`-run text node, `=== 0` for the childless `{ child }`-free class) + the un-synthesized-shape assertion | **NO.** `0 ≠ 1` fails today (C5 unbuilt), so the row cannot pass vacuously; the shape half (`childOrder === []`, only `text` props) is positive and holds today. ✎ **F2:** the pre-correction silent arm was mis-assigned (a childless multi-`{ text }` node was demanded to warn), which over-strengthened the row instead of hollowing it | **ALREADY NON-VACUOUS** — the executed row reports **`EXPECTED-RED`** (`attempts=6 failures=5 live=true`, the warn half; counterexample: a text node with authored children / a `{ child }` run fired 0 warns). The silent half is asserted separately and is GREEN (A+4c + `P-IM-4 (control)` `HELD`). **✎ ORACLE-4 CORRECTION (2026-09-22):** post-W4 the row reports **`HELD`** (`attempts=25 failures=0 live=true`) once the warn expectation is assigned by the drop criterion — before that, shape-1 nodes with `cLen = 0` were demanded to warn (attempts 12/14/20), an over-strength mirroring the F2 correction already applied to shape 2 |
| **(controls: A+2-control, A+4-control, **A+4c**, P-IM-4-control, A+5, A+6a, A+6b, A+7a, A+7b)** | each asserts **silence** (or passthrough) on an input where C3/C5 say nothing may be emitted — **except A+7a**, whose input IS a C3 drop class (see the note below) | **Deliberately silent-but-bounded:** these are the false-positive guards (a warn merely because a duplicate/text-node/drop exists would fail them **today** only after C3/C5 land — before that they pass trivially, which is the intended GREEN state of a control) | **DELIBERATELY VACUOUS (with reason):** a control's contract is "this input must NOT be diagnosed", so its passing while no diagnostic exists is not a falsification failure — it is the control's purpose. The paired positive rows (A+2, A+4, P-SM-1, P-IM-4, P-IM-2(d)) are what carry the non-vacuity for the same mechanism. **AM-1 exception:** A+7a is NOT a "must stay silent" control — it is a residual control whose silence half expires at C3 (the `ghost` drop is a `bodyruns-child-unresolved` + warn class per §3 C3 row 1); W4 re-points that half to the warn (A+7a/A+7b rows + §8.1's report note). **F2 addition:** `A+4c` (childless, `{ child }`-free multi-`{ text }`) joins this list as a **permanent** silence control — it is NOT a deferred-flip case: C5.3's drop criterion says such a node loses nothing, so a warn there is a contract violation at every version. The `A+2-control`/`A+4-control`/`P-IM-4-control` controls ARE "stay silent" by contract (C3 warns only when a run *references* the duplicate / only when content *would* be dropped) and are unaffected |

**EXECUTED register report (2026-09-22, post-F2..F6 correction; quoted verbatim
from the harness's `console.log` — the outcomes this section's table claims are
these and only these):**

```
[property-register] SEED=0x5eed0922 (1592592674)
[property-register] row=P-IM-1 strategy=P-IM-1/foreign-graph-gen status=EXPECTED-RED attempts=5 failures=5 live=true positiveHalfLiveAttempts=5 counterexample=attempt 0: element "el-0" (childOrder=["node-1","node-2","node-3","node-4"]) carries the FOREIGN run wire "node-8" (not in its own childOrder)
[property-register] row=P-IM-2 strategy=P-IM-2/repeat-emit-determinism status=EXPECTED-RED attempts=5 failures=5 live=true fresh.length=1 perPass[0]=0 counterexample=attempt 0: (d) NON-VACUITY: the input carries 1 never-seen dropped signature(s) (the fresh "ghost-0" among them) but pass 1 emitted 0 diagnostic(s) — C3/C4 are not implemented, so the (b)/(c) bounds hold vacuously (fresh=1 perPass[0]=0)
[property-register] row=P-SM-1 strategy=P-SM-1/duplicate-id-gen status=EXPECTED-RED attempts=8 failures=5 live=true counterexample=attempt 0: duplicate reference to "dup-2" produced 0 bodyruns-child-duplicate warnings (expected exactly 1)
[property-register] row=P-IM-3 strategy=P-IM-3/clean-tree-gen status=HELD attempts=60 failures=0 live=true counterexample=none
[property-register] row=P-TP-1 strategy=P-TP-1/roundtrip-gen status=HELD attempts=50 failures=0 live=true counterexample=none
[property-register] row=P-IM-4 strategy=P-IM-4/text-node-gen status=EXPECTED-RED attempts=6 failures=5 live=true counterexample=attempt 1: text node "txt-1-0" (authored children and/or a { child } run — content would be DROPPED) fired 0 text-node-children-ignored warn(s) (expected exactly 1)
[property-register] row=P-IM-4 (control) strategy=P-IM-4/text-node-gen status=HELD attempts=25 failures=0 live=true counterexample=none
[property-register] total attempts=159 (budget ceilings: 100/row, 400 total)
```

Note the shape F6 fixed: **every** row now reports, including the five whose
assertion fails (before F6 the failing rows emitted no line at all, because
`record()` ran after the `expect`); the statuses are the §8.3 vocabulary;
`live=true` on every row means each falsification clause had a live candidate
(the anti-vacuity rule of §8.3 is satisfied, not assumed); and P-IM-2's
`fresh.length` vs `perPass[0]` are printed as §8.3 demands.
**P-IM-1's `positiveHalfLiveAttempts=5`** is the F5 evidence that the containment
**positive half** had a live FOREIGN-WIRE candidate on every attempt (the row also
asserts it equals the attempt count, *after* the row's report so it can never mask
the row's own status) — without that injection the positive half would be a dead
clause after C2 lands, kept from running only by the universal negative.

> **✎ AMENDED 2026-09-22 (W4) — the register's EXECUTED statuses have CHANGED, and
> four rows are RED for ORACLE reasons.** The block quoted above is the **pre-W4**
> execution (all four rows `EXPECTED-RED` because the diagnostic layer did not
> exist). **Post-W4** (`docs/specs/bodyruns-drop-diagnostics.md` §9.5 carries the
> verbatim report): **P-IM-3 and P-TP-1 stay `HELD`; P-IM-1, P-IM-2, P-SM-1 and
> P-IM-4 remain `EXPECTED-RED` for GENERATOR/ORACLE reasons no C1..C7-conformant
> implementation can satisfy** — (P-IM-1) the generator **throws before any emit**
> on 19/100 attempts because `k = 1` makes the F5 foreign pair impossible;
> (P-IM-2) clause (c)'s `expected` excludes the F5-injected `foreign` drops that C3
> mandates a warn for (measured `total = expected + 2` with no prior row), while
> clause (d) filters `fresh` by a ROW-LOCAL set against C4's PROCESS-level set —
> the two clauses cannot both hold; (P-SM-1) `dupCount` can be `1` (9/40 attempts),
> i.e. **no duplicate exists**, while the row demands exactly 1
> `bodyruns-child-duplicate`; (P-IM-4) shape-1 nodes with `cLen = 0` are pushed
> into `expectWarnFor` although C5.3 mandates SILENCE (3 such nodes). `src/**` was
> **NOT** adjusted to satisfy any of them (it would require emitting a warn C3
> forbids or suppressing one C3 mandates). Filed as defect rows **ORACLE-1..4** in
> `docs/defects.md`; a test-writer pass owns the fix (§9.5). **The statuses in the
> register table above remain the honest PRE-W4 record and are not rewritten** —
> this note is the re-point.

> **✎ AMENDED 2026-09-22 (W5, TEST-SIDE ORACLE CORRECTION) — the four oracle
> defects are FIXED in the test file and ALL SIX register rows now report `HELD`.**
> `tests/unit/bodyruns-drop-diagnostics.test.ts` was re-pointed per the §5
> strategy-cell amendments (ORACLE-1..4 + the A+7a flip, §1.1 row `W5-1`);
> `src/**` was **not** touched, `package.json` was **not** touched, and **no
> assertion was weakened to force a green** — every correction removes a demand
> the contract does not make or a generator precondition the row's own clause
> requires. The vacuity-audit table's per-row outcome cells above are re-pointed
> individually (each carries its own ✎ ORACLE-n CORRECTION note, so the PRE-W4
> record stays readable); the executed POST-correction report is quoted verbatim
> in **§9.5(a)**. **The four rows' pre-W4 `EXPECTED-RED` readings were the honest
> record of the oracle defects, not of the contract**: P-IM-1 threw before any
> emit (`k = 1`), P-IM-2's (c)/(d) were mutually unsatisfiable, P-SM-1 demanded a
> duplicate warn where no duplicate existed (9/40), P-IM-4 demanded silence-
> violating warns for `cLen = 0` shape-1 nodes (3 nodes). Each row's clauses
> remain FALSIFIABLE after the correction — the falsifiability evidence is the
> same-code PRE-correction reading (`total = expected.size + 2`;
> `fresh.length=2 perPass[0]=1`; 0 duplicate warns for a real duplicate; 0
> `text-node-children-ignored` warns for a real drop), which is exactly what a
> deleted diagnostic layer produces.

---

## 6. Cost-benefit + risks

The three hazards the gate record names, each with the mitigation its clause or
register row provides.

| # | Hazard (gate-record citation) | Why it is real | Mitigation in this contract | Where it is asserted |
| --- | --- | --- | --- | --- |
| **P2** | **Warn repetition** — "MUST NOT warn per-emit without a repetition guard (P2)"; `emitElements` runs per render pass, and a live editor renders per keystroke | An unguarded diagnostic prints the same line on every pass; a 60-node tree with one dangling ref floods the console | **C4** — the module-level signature-dedup set keyed `` `${code}\u0000${wire}\u0000${id}` ``, never cleared per pass (the per-call alternative is REJECTED in C4) | **P-IM-2** (determinism + the count bound **+ the non-vacuity clause (d) — AM-2**), **P-SM-1** (exactly one warn per duplicate signature) |
| **S1** | **The `warningsMain === 0` smoke guard (+ the census guards)** — `demo-smoke.mjs:461-462`, `:419` | `warningsMain` is asserted 0 for the legacy-shape page; a diagnostic routed into the K4 translate channel would break it, and any element/op-count change would break a census | **C3** pins the channel to `console.warn` at the **emit resolver** (never the K4 `translated.warnings` array, `translate.ts:227-232`); **C4** documents that `warningsMain` is `translated.warnings.length` (`demo/legacy-shape.js:913`) and therefore structurally unaffected; **C6** forbids a new `MinimalElement` field / fresh array, keeping `elements` and op counts stable; and no demo module authors `bodyRuns`, so no demo page can warn at all | **P-IM-3** (no warn + zero ops on the clean input), **P-TP-1** (no mutation), C6 |
| **N1-regression** | **Containment regression risk** — the emit seam is "the most delicate seam in the engine" (`ur-2026-09-17-review.md:255`); the fix must not widen the resolution while closing the foreign-rewrite | The global index exists for the def-fill synthetic-wire case (`eng-bodyruns-wire-ref-pathstate-review.md:76-80`); a naive containment clamp could re-break def-fill resolution | **C2** states the clamp as a *membership test* (`w ∈ el.childOrder`), which keeps the def-fill case (its synthetic wire IS in the element's `childOrder`) working; **C1**'s step order (local → global) preserves own-child precedence on duplicate ids; the def-fill control is a named GREEN case in §8 Unit A+ | **P-IM-1** (no foreign wire ever appears), **P-SM-1** (first-match on duplicates), §8 Unit A+ cases A+5/A+6a/A+6b (the GREEN controls — note: the former "case 5/6" cross-reference is superseded, AM-1, because §8.1 now numbers the residual cases A+7a/A+7b after the superseded A+7) |

**Costs (W4):** one membership test on the existing global-index branch; one
signature set + one helper in `render-helpers.ts`; one warn site in the `text`
early-return; ~9 test seams (the A+ red set + the register harness). **No** adapter
change, **no** translate change, **no** serialize change, **no** signature change.

**Benefits:** closes two REAL defects (N1 wrong-child/duplicate output; N2 silent
subtree loss) and one approved-but-unbuilt clause (N3) — `ur-2026-09-17-review.md:255`
— and answers UR-3 without adopting the rejected widening.

---

## 7. Cross-references

| Reference | Rows / lines this spec depends on |
| --- | --- |
| `docs/specs/ur-2026-09-17-review.md` | §2 UR-3 row `:42`; §2.1 `:57-62`; §5 N1 `:230`, N2 `:231`, N3 `:232`, N4 `:233`, N6 `:235`, D2(i) `:246`; §6 scope B `:255`, A+ recommendation `:258-280`, dependency order `:300-303`; §7 AC-26..AC-29 `:360-367`, AC-30 `:373`; §9 Q2 `:410-425`, Q3 `:432-449`, Q4 `:451-469` |
| `docs/specs/eng-bodyruns-wire-ref-review.md` | §3 the approved shape `:57-86` (the warn-and-drop clause `:72-77`, the properties `:79-83`); §4 costs `:88-95`; §6 the revisit `:112-121`; §7 the landed implementation `:123-144` |
| `docs/specs/eng-bodyruns-wire-ref-pathstate-review.md` | §2 Proposal B REJECTED `:48-56`; §3 the third shape `:61-91` (containment `:81-87`); §6 verdict + revisit condition `:111-124`; §7 landed `:126-148` |
| `docs/specs/eng-inline-order.md` | §3.1 `BodyRun` `:56-72`; §3.3 normalization `:87-96`; §5 the encoded value `:117-149`; §5.1 `encodeRuns`/`decodeRuns` `:151-176`; §5.2 the REJECTED object shape `:178-186`; §6.4 op-count parity `:227-232`; §9 markdown exclusion `:257-267`; §9b `:269-279`; §11 fail-states `:309-322` |
| `docs/specs/bare-text-emit-review.md` | §3 the shape + the enforcement-point claim (N6) `:41-66`; §4 the 1.0.0 deferral `:68-81`; §6 the red set `:91-103`; §7 landed `:105-128` |
| `docs/specs/adapters.md` | DOM missing-wire no-op `:204`, `:314-315`; SSR missing-wire no-op `:358`; the `NVA-3` pure-consumer row `:561`; the Text-owner rows the W3 fold creates `:177`, `:205-206`, `:215`, `:334`, `:383`, `:390-392`, `:664` |
| `docs/specs/render.md` / `docs/specs/node.md` | the emit rule row + §2 the `text` type — created by the **W3** fold (cross-referenced, not written here, §4) |
| `docs/decisions.md` | rows cited **by name** where the citation is load-bearing (line numbers drift — `docs/releases.md` §"Citation convention"): `:18` VERSIONING-SCHEME (the patch letter this spec uses); `:19` ENG-INLINE-ORDER; `:20` ENG-BODYRUNS-WIRE-REF-FIX (D1-D5, incl. the global index); `:21` ENG-BODYRUNS-WIRE-REF-PATHSTATE-FIX (the synthetic registration); `:22` CONTENT-XOR-CHILDREN (the "no removal" / D3 half that W2 supersedes); `:23` BODYRUNS-REMOVABILITY (the versioned branch-(b) ruling, W2); **`:24` BARE-TEXT-EMIT** (the 1.0.0 deferral list + the ✎ ENFORCEMENT-SITE CORRECTION); `:25` CONTENT-XOR-FREE-PARENT-NO-OP (UR-4); `:26` **BODYRUNS-DROP-DIAGNOSTICS** (this spec's own row); `:27` ENG-BODYRUNS-WIRE-REF (the two REJECTED shapes — the 2026-09-22 row insertion moved it from `:24`); `:53` NPM-PACKAGING (moved from `:50` by the same insertion) |
| Source the contract describes (read-only) | `render-helpers.ts:206-305` (the resolver — **✎ RE-ANCHORED 2026-09-22 (W4 audit finding 1)**: was `:167-218`), `:502-504` (`EmitNodeSource`), `:569-590` (`emitElements` signature, normalized `:591`; was `:482-503`/`:504`), `:693-700` (the global index; was `:598-613`), `:705-755` (the per-element pass + the post-emit call at `:755`; was `:614-668`/`:668`), `:723` (the fork-arm remap; was `:635-636`), `:995-1000` / `:1048-1053` (the synthetic registrations; were `:905-913`/`:955-966`), `:1242-1275` (`emitOne` + the `text` early-return; was `:1145-1162`), `:145-156` (`isInterleaving` / `emitTextProp`), `:93-97` (`findElScanCount` — the module-diagnostic precedent); `ops.ts:394-406` (the `console.warn` precedent); `translate.ts:227-232` (the warn message shape), `:325-353` (`bodyRuns` validation), `:956-958` (`text-content-only`, translate-time), `:959-964` (`bodyruns-deprecated`), `:965-970` (the 1.0.0 deferral), `:1230` (`bodyRuns` reverse); `adapters.ts:139-172` (`createEl` Text branch), `:183-187` (`nodeType === 3` guard), `:189-214` (the DOM interleaving rebuild), `:210-213` (the child append), `:311-323` (`appendChild`), `:602-615` (SSR `contentHtml`); `render.ts:42-54` (`MinimalElement`), `:56-136` (`diffMinimal`, the `===` compare `:85-94`, `orderSig` `:99-105`) |
| **✎ RE-ANCHORED 2026-09-22 (W4 audit finding 1)** | **The W4 pass ADDED the diagnostic layer to `src/core/render-helpers.ts` (the C4 set + `warnBodyRunsDiagnostic` at `:158-190`, the C1/C2 clamp at `:246-285`, the C5 clause at `:1242-1275`) and therefore SHIFTED every later line in that file by up to ~90 lines.** Every `render-helpers.ts:N` citation in THIS file that predates W4 was stale; the W4 pass re-anchored §7 and §9.1 and swept the rest (§3 C1/C2/C5, §1.1, §8.1, §9.4, §9.6). **Rule for a future editor: re-derive any `render-helpers.ts:N` anchor by reading the file — never trust a number carried over from an earlier pass.** The pre-W4 → W4 map: resolver `:167-218` → `:206-305`; single resolver call site `:668` → `:755`; global index `:598-613` → `:693-700`; def-root/def-child synthetic registrations `:905-913`/`:955-966` → `:995-1000`/`:1048-1053`; `text` early-return `:1155-1162` → `:1242-1275`; drop `:208-212` → `:286-299`; clamp site `:196-203` → `:246-285` (`contained` at `:249`, `childWires` at `:216`); local map + duplicate count `:178-187`/`:184` → `:221-233`/`:228`; fork-arm remap `:635-636` → `:723`; `emitElements` signature `:482-503` → `:569-590` (normalized `:504` → `:591`). Anchors for OTHER files (`ops.ts`, `translate.ts`, `adapters.ts`, `render.ts`) are unchanged by W4. |
| Tests that will pin it | `tests/unit/bodyruns-drop-diagnostics.test.ts` (**new**, Unit A+ — §8.1); `tests/unit/xor-content-free-parent.test.ts` (**new**, UR-4 confirmation — §8.2); existing controls: `tests/unit/bodyruns-wire-ref.test.ts`, `tests/unit/bodyruns-def-fill.test.ts`, `tests/unit/bare-text-emit.test.ts`, `tests/unit/body-runs.test.ts` |
| The rejected record this spec preserves | `eng-bodyruns-wire-ref-pathstate-review.md:48-56` (option (a) REJECTED as-stated on four grounds) + `:120-124` (the revisit condition: a **real consumer** authoring a `bodyRuns` `{child}` across a placement sibling **plus** a determinism rule for duplicate authored ids) — quoted here so the rejection cannot be reopened by a later pass without meeting it |
| Process rules invoked | AGENTS.md item 3 (design skill current — **no page-design impact**, no `designing-pages.md` change), item 4 (validation trio), item 6 (one contract, one home), item 7 (Step-4 spec gate), item 8 (TDD red-first), item 9 (the gate), item 11 (the adversarial loop for W4) |

---

## 8. Test contracts

**No implementation change may be made in this pass.** The TestWriter owns the test
files; the Implementer owns `src/**`. Both units below are **test-writing only**.

### 8.1 Unit A+ — the red set (`tests/unit/bodyruns-drop-diagnostics.test.ts`, NEW)

Input shapes, expected observables and expected status. Harness: `emitElements`
(`render-helpers.ts:569`) driven directly with a compiled-state-shaped actionable
array + a `Map<string, {base:{props:{id?:string}}}>` node map (the existing pattern,
`tests/unit/bodyruns-wire-ref.test.ts:25-46`), and a `vi.spyOn(console, 'warn')`
around each case.

| Case | Input shape | Expected observable | Status today |
| --- | --- | --- | --- |
| **A+1 — foreign/containment** | Element `B` (`nodeId: 'parent-b'`) with `childOrder` `['node-2']` whose node carries authored id `b1`; **plus** a second actionable element `A` (`nodeId: 'parent-a'`) with child `node-1` whose node carries authored id `a1`. `B.bodyRuns = [{ child: 'a1' }, { text: ' x' }]`. Both elements in the SAME `emitElements` call (so the global index is non-empty — required, see C1's empty-map bail `:234`) | `B`'s emitted runs **contain no `{child}` run** — `decodeRuns(B.props['text'])` equals `[{ text: ' x' }]`; **no** `{ child: 'node-1' }` (the foreign wire) appears. Asserted **RED against the pre-W4 code** (`render-helpers.ts:196-203` then rewrote to `node-1`; the W4 clamp site is `:281-285`) | **RED** (AC-28, `ur-2026-09-17-review.md:366`) |
| **A+2 — duplicate + warn** | One element; `childOrder` `['node-1','node-2']`; **both** nodes carry authored id `dup`; `bodyRuns = [{ child: 'dup' }, { text: '!' }]` | (a) the emitted run resolves to the **first** wire in `childOrder` (`node-1`) — first-match-in-order; (b) `console.warn` was called, with a call whose string contains `bodyruns-child-duplicate` | **RED at W4** — no warn existed on any channel then (nothing spied a warning in `tests/unit/bodyruns-wire-ref.test.ts`; N4 `ur-2026-09-17-review.md:233`). **✎ POST-W5: GREEN.** **✎ N4 CLOSED 2026-09-22** — that file now DOES spy (`console.warn`) in its renamed "…DROPPED **and** warns" case (§8.4/`docs/defects.md` N4) |
| **A+3 — dangling/absent id + warn** | One element with `childOrder` `['node-9']` (authored id `present-inline`); `bodyRuns = [{ child: 'missing-inline' }, { text: ' only' }]` | (a) the run set decodes to `[{ text: ' only' }]` (the drop — already true, the control half); (b) `console.warn` was called with a string containing `bodyruns-child-unresolved` and the dropped id | **RED** on (b) — the drop half of this case is **GREEN today** (`tests/unit/bodyruns-wire-ref.test.ts:69-73`, which asserts the drop only). The case must assert the WARN to satisfy AC-27 (`:365`) |
| **A+4 — `text` node with authored children + warn** | A `type: 'text'` actionable carrying `content: 'A '` AND `children: ['node-1']` (a real child node in the map); optionally a second case with `bodyRuns: [{text:'A '},{child:'b1'}]` | (a) the emitted element is `type:'text'`, `childOrder: []` (the warn-and-drop shape — no synthesis); (b) `console.warn` was called with a string containing `text-node-children-ignored` | **RED** — `emitOne`'s early return (`render-helpers.ts:1242-1275`, pre-W4 `:1155-1162`) drops silently on every root class (N2 `:231`; AC-29 `:367`) |
| **A+4c — the childless `{ child }`-free multi-`{ text }` SILENCE control (NEW — ✎ added 2026-09-22 by the F2 correction)** | A `type: 'text'` actionable with `content: 'A '`, `children: []` and `bodyRuns: [{ text: 'A ' }, { text: 'x' }]` — `isInterleaving === true` (`render-helpers.ts:145-149`, `length > 1`) yet **no** `{ child }` run and **no** authored children | the emitted element is `type:'text'`, `childOrder: []`, **no** `{ child }` run in the emitted runs, and **NO** `text-node-children-ignored` warn (nothing is dropped — C5.3's drop criterion, ✎ F2) | **GREEN today** and a **permanent** silence control (unlike A+7a this never flips: the class is silent by contract in every version). Pre-F2 the register generator demanded a warn for exactly this class — a correct implementation would have FAILED the row |
| **A+5 — CONTROL: the resolving path is unchanged** | `childOrder` `['node-3']` (authored id `inline-0`); `bodyRuns = [{ child: 'inline-0' }, { text: ' text' }]` | the run is rewritten to `node-3`; `childOrder` unchanged; **no warn** | **GREEN today** — this is the landed contract (`tests/unit/bodyruns-wire-ref.test.ts:49-54`) and must stay green through W4 |
| **A+6 — CONTROL: real-wire passthrough + the def-fill synthetic case** | (a) `bodyRuns = [{ child: 'node-7' }]` with `node-7 ∈ childOrder` → passes through verbatim, no warn. (b) The def-fill shape: a def-consumer envelope (the pattern at `tests/unit/bodyruns-def-fill.test.ts:38-58`) whose def-child carries `bodyRuns [{text:'Some '},{child:'bold'},{text:' text'}]` → the run resolves to the **synthetic** wire (`childRun.child` contains the element's own wire, `:75`) and **no warn** | (a) verbatim; (b) the synthetic rewrite + no warn | **GREEN today** — both halves are landed (`bodyruns-wire-ref.test.ts:62-67`; `bodyruns-def-fill.test.ts:61-92`). This control is the N1-regression guard named in §6. **✎ REGRESSION GUARD PINNED 2026-09-22 (W4 audit finding 2):** A+6b's (b) half is the **only** landed shape in which the §9.3 synthetic-precedence branch fires, and its observable is therefore a **pinned warn count**: (i) the run resolves to the element's **synthetic** wire — `decodeRuns(props['text'])` equals the authored interleaving with the `{ child: 'bold' }` run rewritten to the **synthetic** wire (`childRun.child` contains the element's own wire, `bodyruns-def-fill.test.ts:75`), and **not** to the real path-state wire; (ii) `emitDiagnostics(spy.calls())` length **=== 0** — **no** `bodyruns-child-unresolved` **and no** `bodyruns-child-duplicate`, *even though more than one `childOrder` wire carries the authored id* (the synthetic branch returns before the duplicate check — §3 C2's scope clarification). **A future editor must not "fix" this to 1.** Changing that count is the recorded open choice in §3 C2 (warn-on-the-synthetic-branch) and requires a contract amendment + its own gate; if a pass ever demands the warn there, the requirement is the spec change (**+ a `docs/defects.md` row for the test edit** — the A+ test file belongs to the test-writer, so the doc pass must NOT edit the oracle), never a silent assertion flip |
| **A+7 — SUPERSEDED (AM-1, 2026-09-22).** The former row pinned the `:188` empty-map **bail** observable: "with an empty local map and no global index the run stays **verbatim** in `decodeRuns`, and the adapter silent-no-ops it". **That observable is UNREACHABLE through the public seam and the row is replaced by A+7a + A+7b below.** Reason, `file:line`-verified: `emitElements` always constructs and passes a **non-null** `authoredIdToWire` (`render-helpers.ts:693-700` → the single resolver call at `:755`), so the `!authoredIdToWire` half of the `:234` guard is **dead code** (C1's dead-guard bullet, residual **R-A1**); and `nodeById` is `emitElements`' own parameter (`:569-590`, normalized `:591`, consumed by the local map at `:225`), so *omitting it suppresses the child elements themselves* (the local map goes empty because no authored id resolves) **rather than** exercising the bail. An **empty-but-non-null** index — the closest reachable shape — does **not** bail: it falls through to **C1 step 4 and DROPS** the run (§8.1 A+7a). **No W4 requirement is created by this supersession** (R-A1 disposition: documented residual; no recorded contract — `eng-bodyruns-wire-ref-review.md:72-77`, `ur-2026-09-17-review.md:42`/`:156-162`, AC-26..AC-29 `:362-367` — names the `null`-index case) | (superseded — see A+7a/A+7b) | **N/A — superseded** |
| **A+7a — documented limitation, the reachable shape (AM-1)** | One element (`nodeId: 'parent'`), **no** element in the call carries an authored `props.id` (so the local map is empty and the global index is **empty but NON-NULL** — `render-helpers.ts:693-700` always builds it, `:755` always passes it); `childOrder: ['node-5']`; `bodyRuns = [{ child: 'ghost' }, { text: ' t' }]`. Emit through the normal public seam (`emitElements(actionable, nodeMap)` — **no** `nodeById`-omission trick). **Assert the BAIL half and the drop, not the diagnostic's absence:** (i) the run is **DROPPED** by C1 step 4 — `runsOf(el)` equals the text-only run `[{ text: ' t' }]`, and `{ child: 'ghost' }` appears nowhere in the emitted `props['text']` **and nowhere as a rewritten wire**; (ii) the emit neither throws nor mutates `bodyRuns`; (iii) **conditional** (see the status column): *while C3 is unbuilt* no `bodyruns-child-unresolved` line fires — asserted GREEN against today's code (§8.1 A+7a) | **GREEN today (and EXPECTED TO FLIP at W4/C3 — not a regression).** Pins residual **R-A1** (C1's dead-guard bullet): the bail is unreachable, so an unresolved authored id in an empty-authored-id space is a **C1 step 4 drop**, exactly like any other unresolved id. **The flip:** because C3 catalogues that same class as `bodyruns-child-unresolved` + **YES-warn** (§3 C3 row 1), a correct W4 MUST start emitting a warn for this input — so any "no diagnostic fires" assertion on this input becomes **false at W4 by contract**. **Recorded W4 conflict:** the landed A+7a also asserts `emitDiagnostics(spy.calls())` to be `[]` (the `emitDiagnostics(spy.calls())` assertion inside A+7a), i.e. exactly the half this clause now declares expired; that assertion is the reason the landed status is GREEN *today*, and it **must be re-pointed in W4's red set** to "the `ghost` signature warns" (equivalently: assert the same class/`<id>` substrings A+3 asserts — A+3 covers the same drop class through the resolver, so the two cases converge at W4). It must **never** be maintained as a silence assertion: silence here would forbid the C3 diagnostic this spec requires, and would make the W4 red set contradict §3 C3 row 1. **No source or test is changed in this pass** — the divergence is recorded, not repaired (§8.3's "this pass changes no implementation"). **✎ AMENDED 2026-09-22 (W4) — THE FLIP HAS LANDED:** with C3 built, `bodyruns-child-unresolved` **does** fire for this input, so A+7a's `emitDiagnostics(spy.calls()) === []` half is **FALSE and the case FAILS** — the contract-correct outcome recorded here (the test file was **NOT** edited and the warn was **NOT** suppressed; §9.4). `A+7b` stays **GREEN** (its resolver-side warn is suppressed by C4's process-level set after A+7a, and its assertion is the ADAPTER's silence, which is preserved). **✎ AMENDED 2026-09-22 (W5) — THE RE-POINT IS LANDED (clause (iii) is now unconditional in the opposite direction):** A+7a's expired silence half is replaced by the **WARN** assertion — the case asserts the specific **code** (`bodyruns-child-unresolved`) **and** the dropped `<id>` (`ghost`) **and** the element wire (`parent`), never merely "something warned" — while the DROP half (i) and the no-throw/no-synthesis half (ii) are kept verbatim and strengthened (`props['text']` must not contain `ghost` at all; `childOrder === ['node-5']`). The case is GREEN at W4 and is now the residual's positive pin. **Clause (iii) as written above is SUPERSEDED — a silence assertion on this input would forbid the C3 diagnostic this spec requires.** |
| **A+7b — documented limitation, the adapter half (AM-1)** | Same input **shape** as A+7a (**✎ W5: on its OWN wire/id pair** — `parent-b7` / `ghost-b7` — so the C4 process-level set cannot suppress the resolver's warn and the adapter's silence is observed on its own evidence rather than through A+7a's dedup); the emitted element is then materialized through `SSRFragmentAdapter` (the element + a `node-5` fragment containing the text `'child'`, appended via `appendChild(el.wire, 'node-5')`). **Assert the ADAPTER half** (not the resolver's diagnostic silence): the dropped run contributes **no HTML and no throw** — `ssr.fragments.get('parent-b7')!.contentText` is the **text-only** content (`' t'`), because the adapter **silent-no-ops the unresolved wire** (`adapters.ts:612-613`: `this.fragments.get(wireKey(run.child))` misses and nothing is appended; the DOM counterpart `adapters.ts:210-213` behaves the same). The adapter-side assertion is the **absence of an adapter-emitted diagnostic** — a warn whose call site is `adapters.ts` would be the NVA-3 violation (§2.2 row 2, `adapters.md:561`); a resolver-side warn for the same input is C3's job and is asserted by A+7a's (iii)/A+3, not here | **GREEN today, and stays GREEN at W4 — provided the assertion is scoped to the adapter.** The adapter is a **pure silent consumer** and must remain one under W4 (§2.2 row 2; NVA-3 `adapters.md:561`; the pre-existing missing-wire contract `adapters.md:204`/`:358`), so a W4 that "helpfully" adds an adapter-side warn fails here. Only the *resolver's* diagnostic state changes at W4 (A+7a's flip). **✎ W5 (LANDED):** the case asserts the resolver's **1** diagnostic is fired by the EMIT, then that `createEl`/`setProp`/`appendChild` on the adapter add **zero** further console calls — with the unique wire/id pair this half can no longer pass through A+7a's C4 suppression. **✎ HARDENED 2026-09-22 (gate-8 doc review — audit finding 5):** that exact count is INVARIANT **H2** of §8.4 — it holds only while no other case in the suite emits the same `(code, wire, id)` triple |

**Report format for A+** (AGENTS.md item 8b): the executed command, the per-case
pass/fail, and the count of failing cases, with the exact failing assertion text for
A+1..A+4. The GREEN controls and the residual cases (A+2-control, A+2b, A+5, A+6a,
A+6b, A+7a, A+7b) are reported as PASS and are **not** part of the red tally — A+7a/
A+7b in particular are EXPECTED-GREEN (AM-1: they pin what is reachable, not what
W4 must build). **Expected status flips at W4 (AM-1 — record them so they are not
mistaken for regressions):** A+7a's "no diagnostic" half is expected to become
**false** once C3 lands (the drop of the `ghost` id is a `bodyruns-child-unresolved`
+ warn class, §3 C3 row 1), so W4 re-points that half to the warn assertion; A+7b
stays GREEN because its assertion is scoped to the **adapter's** silence (NVA-3,
`adapters.md:561`). The W4 report must name both explicitly.

### 8.2 Unit UR-4-confirmation (AC-21) — `tests/unit/xor-content-free-parent.test.ts` (NEW)

**The encoded question:** "children-win XOR enforcement is a **NO-OP** for a
`content`-free parent with text children" (AC-21, `ur-2026-09-17-review.md:354`;
UR-4's consumer answer `:182-186`).

| Item | Contract |
| --- | --- |
| **Input shape** | A legacy envelope whose root `div` has **NO `content` key at all** and `children: [{type:'text',content:'A '},{type:'strong',content:'bold',props:{id:'b1'}},{type:'text',content:' text'}]` — the requester's own shape (`bare-text-emit-review.md:93-95`; the existing harness `tests/unit/bare-text-emit.test.ts:74-100`) |
| **Asserted render** | SSR: `A <strong id="b1">bold</strong> text` (bare text children, childOrder positions, no `<text>` wrapper) — i.e. identical to the case WITH a `content` key, because there is no content to win or lose |
| **Asserted silence** | The K4 translate channel is empty (`t.warnings` length 0) and no `console.warn` fires: `content-with-children-recommended` is **DEFERRED to 1.0.0** (`translate.ts:965-970`; `bare-text-emit-review.md:117-120`) and must not appear |
| **Status today** | **GREEN — encoding current intended behaviour**, not a red test. It is a *confirmation* (UR-4's adopted shape: "a test-encoded confirmation that a `content`-free parent with text children renders unchanged", `:182-183`). It is GREEN because the 0.4.0 bare-text emit already renders the shape correctly and the XOR enforcement is deferred, so there is nothing to fix; the test's value is that it **pins** the answer at the version a consumer can cite |
| **AC-21 naming convention** | The test **name and a header comment** must name the 1.0.0 question: e.g. `it('UR-4/AC-21 — XOR "children win" is a NO-OP for a content-free parent with text children (1.0.0 no-op question; decisions.md BARE-TEXT-EMIT)')`, with a file header comment stating: (i) this is the AC-21 confirmation; (ii) the XOR render enforcement + `bodyRuns` removal + the migration guide are the 1.0.0 batch (`decisions.md:23`, `ur-2026-09-17-review.md:451-469` Q4 option A); (iii) the case must be re-examined at the major |
| **Not asserted (deliberate)** | Anything about a parent that DOES carry `content` + children (that is the 1.0.0 XOR question, `bare-text-emit-review.md:70-81`) — asserting it would encode unpublished semantics, forbidden by AC-25 (`:358`) |

**Why a NEW file rather than a case in `tests/unit/bare-text-emit.test.ts`:**
one file = one concern (AGENTS.md item 6); `bare-text-emit.test.ts` is the landed
0.4.0 bare-text red/green set, while this file is the **1.0.0-question
confirmation** with a distinct lifecycle (it must be revisited at the major, not
whenever the bare-text emit changes). One line, per the brief: the separate path
keeps the AC-21 marker greppable and keeps the 1.0.0 revisit list from being buried
inside the 0.4.0 suite.

### 8.3 Property-layer execution instructions

**Execution (A+ red set):** the new test file(s) MUST be **executed** in this pass
and their failures reported (AGENTS.md item 8b). Run the repo's vitest through npm
(no shell-level test runner changes), reporting the executed command + the
pass/fail tally + the failing assertion text for A+1..A+4.

**Register rows executable NOW:** rows whose contract is **independent of the W4
implementation** may be run in this pass against today's code and reported with the
§8.3 status vocabulary (below) plus their strategy id:

| Row | Executable now? | Reason |
| --- | --- | --- |
| **P-IM-1** (containment) | **YES — reported `EXPECTED-RED`** | the strategy's foreign-id generator falsifies against `render-helpers.ts:196-203`; report the counterexample (the foreign wire that appears). ✎ F5: the per-attempt liveness clause is ENFORCED and the containment **positive half** is asserted in the same row |
| **P-IM-2** (determinism + count bound + non-vacuity) | **Partially** | the *emission* determinism half is assertable now (it holds — the rewrite is a pure function of the input); the *count bound* half (b)/(c) is RED until C4 exists **and, per AM-2, the row is RED for a second, independent reason**: clause (d) (the never-seen-signature lower bound) is RED until **C3** emits the diagnostic at all. Reported **`EXPECTED-RED` — waits on C3/C4** (C3 for the emission (d) requires; C4 for the dedup set that makes (d)'s count dedup-aware). **Report (d)'s counts explicitly** (`fresh.length` vs `perPass[0]`) so the row can never again be recorded HELD while the diagnostic layer is absent. ✎ F3: (d)'s `fresh` set is built **only from drop-class runs** (class-tagged by the generator), so no false red remains once C3/C4 land |
| **P-SM-1** (duplicate first-match + warn) | **YES — reported `EXPECTED-RED`** | first-match holds locally today, but the **warn** does not exist (no `console.warn` in `render-helpers.ts`). Report the falsifying counterexample (zero warn calls) |
| **P-IM-3** (clean-input passthrough) | **YES — reported `HELD`** | today's clean path is already byte-identical and zero-op (C6 is a preservation clause); its clauses are positive, so `live=true` |
| **P-TP-1** (`base` immutability / round-trip) | **YES — reported `HELD`** | landed behaviour (`decisions.md:20` D3); must stay held through W4. ✎ F4: the property's **second half** (the emitted rewrite in `props['text']` + the foreign-run absence) is asserted on the same attempt |
| **P-IM-4** (`text`-node clause) | **YES — reported `EXPECTED-RED`** | the un-synthesized element shape holds today, but the warn does not (C5 unbuilt). ✎ F2: the warn expectation follows the **drop criterion** (authored children **or** a `{ child }` run), so a childless `{ child }`-free node is asserted SILENT |

**Determinism rules for every register row (repo rules, mandatory):**
one **pinned seed** for the whole run, printed in the report; **≤ 100 attempts per
row** and **≤ 400 attempts total**; **stop after 5 failures** per row (report the
attempts actually run); every row reported with its **strategy id**, its **status**
and — for a broken/red row — the minimized counterexample. The generator
must be an inline seeded PRNG (no new dependency); there is **no existing PBT
harness** in this repo (checked: no `fast-check`/PBT helper anywhere in
`src/`, `tests/`, `scripts/`), so the TestWriter writes a small seeded generator in
the test file and documents the seed.

**✎ REPORT CONTRACT (F6, 2026-09-22 — binding on the landed harness; the pre-F6
shape violated it):**

1. **The status vocabulary is exactly four values:** `HELD` (no falsifier fired and
   at least one clause was live), `BROKEN` (a falsifier fired and the failure is a
   REGRESSION of a landed contract), `EXPECTED-RED` (a falsifier fired and the
   failure is a contract consequence of a clause W4 has not implemented yet — the
   W4-waiting rows), `UNDETERMINED` (no falsifier fired **and** no clause was live —
   the honest report for a row that could not have detected anything).
2. **The report row is recorded BEFORE the assertion runs**, so a FAILING row still
   emits its line. (`record()` after `expect(...)` is FORBIDDEN — it made exactly
   the rows that need a report silent; audit finding 6.)
3. Each line carries: the **row id**, its **strategy id**, the **status**, the
   **attempts actually run**, the **failure count**, whether at least one
   falsification clause was **live**, and the **minimized counterexample** for a
   broken/red row (`counterexample=none` for a held row).
4. **P-IM-2 additionally prints `fresh.length` and `perPass[0]`** (the non-vacuity
   counts this file requires be explicit).
5. A failing row's assertion message embeds the same minimized counterexample, so
   the failure text and the report line cannot diverge.
6. Register **test names state the reported status** (`reports EXPECTED-RED until
   …`) — a name saying "EXPECTED BROKEN on the X half" while the executed line says
   `EXPECTED-RED` is a contract contradiction and is forbidden.

> **✎ W5 (2026-09-22, test-side) — the names and statuses below are now the
> POST-correction ones.** Every register row's contract IS implemented (W4) and
> every oracle defect is fixed (W5), so the four rows the paragraph below pins to
> `EXPECTED-RED` report **`HELD`** instead, and their test names were re-pointed to
> `reports HELD` (rule 6: a name that claims a status the executed line does not
> contain is a contract contradiction). `statusOf` no longer consults an
> `EXPECTED_RED_ROWS` set — a failing row reports `BROKEN`, derived rather than
> hard-coded, so deleting the diagnostic layer cannot produce a comfortable label.
> The `EXPECTED-RED` vocabulary value stays defined for a future pass whose row
> pins a clause that pass has not implemented. Executed outcome: §9.5(a).

**Rows whose contract is not implemented are reported as EXPECTED-RED and name the
clause they wait on** — never as failures of the pass: P-IM-2's bound half (C4) **and
its non-vacuity clause (d) (C3)** — AM-2: report the row as **EXPECTED-RED — waits on
C3/C4**, never HELD; P-SM-1's warn half (C3), P-IM-4's warn half (C5), and the whole
of P-IM-1's containment clamp (C2) until W4.

**Non-vacuity is a reporting rule, not an optional guard (AM-2):** a row may be
reported **HELD** only when at least one of its falsification clauses was actually
**live** in the attempt (a bound clause whose upper limit is satisfied by emitting
nothing does not make a row HELD). Concretely: P-IM-2 is HELD only when (d)'s
`fresh.length ≤ perPass[0]` held on attempts that carried `fresh.length ≥ 1`; if no
attempt carried a fresh signature, the report must say so and the row is
**UNDETERMINED**, not HELD. **Liveness must be ENFORCED, not assumed (F5):** a
generator whose liveness is probabilistic (or asserted at graph level rather than
per element) does not satisfy this rule — the landed P-IM-1 generator **constructs**
a non-own-child run per attempt and the row asserts it did (an attempt that cannot
meet the clause fails loudly; a graph from which the required pair cannot be built
throws).

**This pass changes no implementation.** `src/**` is untouched; the red set is the
deliverable that the W4 gate consumes (`ur-2026-09-17-review.md:300-303`).

### 8.4 INVARIANTS OF THE LANDED HARNESS (✎ ADDED 2026-09-22 — W4 audit finding 5, hardening)

**Two properties of the landed test file are load-bearing and are INVARIANTS — a
future editor who breaks either one breaks a property row silently.** They are
stated here (the owning spec) so they are greppable and reviewable; the test file
also carries them as a header invariant comment.

1. **INVARIANT H1 — `PROCESS_LEVEL_SIGNATURES_FROM_EARLIER_CASES` is a
   HAND-MAINTAINED MIRROR of the A+ cases' warn signatures.** The P-IM-2 row must
   reason about C4's **process-level** set, so the harness keeps an explicit list of
   the `(code, wire, id)` signatures the A+ cases have already fired earlier in the
   file. **The list is not derived from the cases — it is typed by hand**, so any
   change to an A+ case's **element wire**, dropped **id**, or code (including
   adding a case that warns) can **silently desynchronise the mirror** and produce a
   **false HELD** on P-IM-2 — the non-vacuity row, i.e. **exactly the ORACLE-2
   defect class this spec already paid for once** (a row reporting HELD while the
   diagnostic layer was absent). **Duty:** an editor who adds, removes, or
   re-points an A+ case's wire/id/code MUST update the mirror in the same edit, and
   the P-IM-2 attempt must fail loudly rather than degrade to silence when the
   mirror and the executed signatures disagree. Any pass that changes the mirror
   must report the change explicitly (as ORACLE-2 did).
2. **INVARIANT H2 — A+7b's EXACT-COUNT assertion depends on SUITE-LEVEL WIRE
   UNIQUENESS.** A+7b asserts the resolver fires **exactly one** diagnostic for its
   own `parent-b7`/`ghost-b7` pair and that the adapter then adds **zero** further
   console calls (W5 gave the case its own wire/id pair precisely so A+7a's C4
   suppression cannot mask it — §9.4). That count is only sound while **no other
   case in the suite emits the same `(code, wire, id)` triple**: a new case that
   reuses `parent-b7`/`ghost-b7` (or a copy-pasted case) would pre-populate C4's
   process-level set and turn A+7b's `0 further calls` half into a **false pass**
   (or its resolver-count half into a false fail). **Duty:** every warn-asserting
   A+ case must use a **unique** element wire + dropped id; do not "tidy" wires to
   shared names. This is the same reason P-IM-2 was given its own `pim2-<e>`
   element namespace in W5.

**Neither invariant weakens an assertion:** both are **hardening** — they forbid
future edits that would make an existing row pass (or fail) for a reason unrelated
to the contract. No test edit is required by this note; if a pass elects to
**derive** the mirror instead of maintaining it (or to assert wire uniqueness
mechanically), that is a test-side improvement whose shape must be specified here
first (the oracle file belongs to the test-writer).

---

## 9. W4 IMPLEMENTATION — LANDED (2026-09-22)

**Status:** the emit-boundary diagnostic layer is **BUILT** — `src/core/render-helpers.ts`
**only**. No adapter, translate, serialize, supervisor or registry change; **`emitElements`'
signature is unchanged** (C8); **no field is added to `MinimalElement`** (C6.2);
`base.bodyRuns` is never written (C7). Every code anchor below is a **2026-09-22
W4** line number.

**Version target: 0.5.1** (§3 C8, a patch). **`package.json` is NOT bumped in this
pass:** it stands at **0.5.0**, which is itself still `UNTAGGED` in
`docs/releases.md`, so bumping now would stack two unreleased patch numbers. The
bump + the version's `docs/releases.md` row are the **release pass's** items
(AGENTS.md item 12 UR-5 landing duty).

**Executed outcome:** the full suite reads **1314 passing / 5 failing** (pre-pass
**1310 / 9**) — **5 of the 9 red cases are GREEN**, the remaining **4 register
rows are RED for ORACLE reasons, not implementation reasons** (§9.5), and
**A+7a flipped GREEN→RED exactly as this spec predicted** (§9.4). Validation:
`npm run typecheck` clean, `npm run build` clean, `npm run demo:smoke` **SMOKE OK**
> **✎ HISTORICAL READING — DO NOT READ AS LIVE (corrected 2026-09-22):** this
> `SMOKE OK` line was recorded while the runtime 3× tripwire was structurally
> INERT. The repaired guard now reads the honest runtime:derived ratio
> (**10.50× at d12**, four-run band **9.45-10.50×**, pass2 ≈84% of the runtime
> total) and `demo:smoke` **exits 1** — **left RED by the user's ruling**, bound
> **unchanged** (`docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND; `docs/defects.md`
> RUNTIME-FORK-PASS2-RATIO). What remains VALID from this line: `warningsMain=0` and
> the derived-fork per-region pins.

(`warningsMain=0`; the derived-fork per-region pins inside the asserted 2.5× —
**the runtime 3× tripwire reading quoted at this site was the pre-repair
derived-vs-derived quantity and is NOT usable**; see the ✎ correction above and
§9's header. **The valid halves of this outcome: `warningsMain=0` and the
derived-fork per-region pins** — the diagnostic is not on the hot path of a page
with no drops, C4/C6).

### 9.1 Clause → code site → the test that pins it

| Clause | Code site (W4, `src/core/render-helpers.ts`) — **✎ RE-ANCHORED 2026-09-22 (W4 audit finding 1): every row below was re-derived by reading the CURRENT file; the previous edition cited PRE-W4 numbers and was stale by ~70-90 lines** | Pinned by |
| --- | --- | --- |
| **C1** resolution order | the per-run loop `:237-303` — step 1 `:239-245` (pass-through), the C2 candidate `:246-249`, the synthetic-precedence branch `:259-264`, step 2 `:265-280` (own child first), step 3 `:281-285` (containment-clamped global), step 4 `:286-299` (drop); the per-element local map + duplicate count `:221-233`; the zero-cost bail `:213-215`; the (unchanged, unreachable-half) empty-map bail `:234` — residual **R-A1** | A+1, A+2b, A+3, A+5, A+6a, A+6b, P-IM-1 |
| **C2** containment clamp | `:249` — `const contained = globalWire !== undefined && childWires.has(globalWire)`, where `childWires = new Set(el.childOrder)` `:216`. A **`childOrder` membership** test, never a `nodeById` membership test; a non-contained global entry falls to step 4 (drop + warn), never a rewrite | A+1 (drop of the foreign `a1`), P-IM-1 (both halves), A+6b (the def-fill control) |
| **C3** the drop/warn catalogue | `warnBodyRunsDiagnostic` `:180-190` (the channel + the message shape `:189`); call sites: duplicate `:272-277`, unresolved/foreign `:292-297`, `text`-node `:1262-1267`. `<elementWire>` is `el.wire` (`:274`, `:294`) and `emitOne`'s `wire` (`:1264`) | A+1(c), A+2, A+2b, A+3, A+4, A+4b, P-SM-1, P-IM-4 |
| **C4** repetition bound | `:174` `const emitDiagnosticSignatures = new Set<string>()` (module-level, **never cleared per pass**) + `:186-188` (signature built, present ⇒ return, add). The per-`emitElements`-call set is REJECTED (C4) | A+2 (exactly 1), P-SM-1's second emit (0 added across passes), P-IM-2 (b) |
| **C5** `text`-node clause | `emitOne` `:1242-1275` — the **drop criterion** `:1254-1256` (`children.length > 0` **OR** a `{ child }` run), the detail literal `:1257-1262`, the warn `:1262-1267`; the emit is byte-unchanged `:1269-1274` (`childOrder: []` at `:1272`, only `text`) | A+4, A+4b, A+4-control, A+4c, P-IM-4 (+ its control) |
| **C6** byte-identical guarantee | no `MinimalElement` field (the diagnostic rides `console.warn` only); the resolver still returns before any work on non-body text `:213-215`; `el.props['text'] = encodeRuns(rewritten)` `:304` is the ONLY emitted-side write; `orderSig`/`diffMinimal` untouched | P-IM-3 (0 warns, 0 ops, exact key set), A+2-control/A+4-control/A+4c/A+5/A+6a/A+6b (silence controls) |
| **C7** `base.bodyRuns` immutability | the resolver builds a NEW `rewritten: BodyRun[]` `:236` and writes only the emitted string `:304`; no emit site writes a run array | P-TP-1 (snapshot equality + the reverse round-trip) |

### 9.2 The diagnostics as implemented — exact templates and the dedup key

Channel: `console.warn`, one string argument (the `ops.ts:401` precedent; the K4
`translated.warnings` array is a different seam and is untouched — that array *is*
`warningsMain` per C4's guard table).

```
[bodyruns] bodyruns-child-unresolved at <elementWire>: the { child } run references authored id "<id>", which is not a child of this element; the run is dropped
[bodyruns] bodyruns-child-duplicate at <elementWire>: authored id "<id>" resolves to <n> children of this element; the first in childOrder is used
[bodyruns] text-node-children-ignored at <elementWire>: a "text" node carries authored <children|bodyRuns|children+bodyRuns>; the bare-text emit ignores them; no element is created
```

- `<n>` = the number of `el.childOrder` wires whose node (through
  `pathCtx.pathNodeOf` + `nodeById`) carries that authored `props.id`
  (`authoredIdChildCount`, `:222-228`).
- The `text`-node detail literal is `children` when `s.children` is non-empty,
  `bodyRuns` when only a `{ child }` run is present, `children+bodyRuns` when both
  (`:1257-1262`; pre-W4 anchor `:1158`).
- **Dedup key (C4):** `` `${code}\u0000${elementWire}\u0000${value}` ``, `value` =
  the run's `child` value for the two resolver codes, the literal `children` for
  the `text` clause (`:183-188`, re-anchored W4: `:186-188`; the literal is `:1265`). One warn per signature **ever**; the set is
  never cleared per pass; it holds short strings only (no graph references).
- No clamp was applied: the set is unbounded (permitted by C4; cardinality is
  bounded by the number of distinct `(code, wire, id)` triples the process meets).

### 9.3 The one place the code had to CHOOSE (the spec's C2 precedence pin vs the def-fill synthetic case)

**AMENDED 2026-09-22 (W4) — §3 C2's "Precedence pin" paragraph is corrected.**
C2 states "wherever the own-child local map and the global index disagree, the
own-child local map wins … **because with unique ids the two maps cannot
disagree**". **That justification is FALSE**, and the landed GREEN control
**A+6b** is the counterexample: the def-fill element's `childOrder` carries **both**
its synthetic def-child wire (`<host>:<i>`, the def-fill registration) **and** the
real child's path-state wire, and `nodeById` attributes the same authored id
(`bold`) to the real wire. Local-first therefore resolved `{ child: 'bold' }` to
the **real** path-state wire — i.e. the same node materialized twice — and broke
the landed def-fill regression guard.

**The implemented rule (the choice, recorded as such):** the containment-clamped
global resolution wins **only when the indexed wire has no `nodeById` entry**, i.e.
when it is a def-fill **synthetic** wire the per-element map can never attribute the
id to (`:250-264`; the branch body is `:259-264`). In every other case C1's step order is exactly as written
(step 2 local-first, then the contained global fallback) — so the duplicate-id
observable C2's pin exists for (earliest `childOrder` wire wins, C3's
`bodyruns-child-duplicate`) is unchanged and pinned by A+2/A+2b/P-SM-1.

**Rationale:** the synthetic wire is the def-fill element's OWN child (the
def-fill site deliberately OVERWRITES the index entry, `:1035`), it has no
`nodeById` entry, and the local map is structurally unable to see it; without this
precedence the N1 clamp re-breaks the landed 0.3.2 def-fill resolution (§6's
N1-regression hazard) and A+6b turns RED.

### 9.4 The A+7a flip (GREEN → RED at W4, by contract — **RESOLVED GREEN by the W5 re-point**)

> **✎ POST-W5 STATUS (2026-09-22):** the flip recorded in this section was the
> **W4** state. `A+7a` is **GREEN** now — the W5 test-side pass re-pointed clause (iii)
> from SILENCE to the **WARN** (code + `<id>` + wire asserted; §8.1 A+7a, §9.5(a);
> `docs/defects.md` FIXED row BODYRUNS-DROP-ORACLE). The section is retained as the
> record of the expected flip and of the adapter-scope reasoning, not as a live
> status.

The landed `A+7a` asserted `emitDiagnostics(spy.calls())` is `[]` for a
`ghost`-id drop (§8.1 A+7a's conditional clause (iii)). **That assertion is FALSE
for a C3-conformant engine** — because C3 row 1 catalogues exactly that class as
`bodyruns-child-unresolved` **+ YES-warn**, which this pass implements. The
failure was the **contract-correct outcome** (the spec's own AM-1 note records the
re-point as an expected W4 consequence); the test file was **NOT** edited in the W4
pass and the warn was **NOT** suppressed. The W5 test-writer pass then re-pointed
that half to "the `ghost` signature warns" (A+3 covers the same drop class).

`A+7b` stays **GREEN**: its resolver-side warn is suppressed by C4's process-level
set (A+7a, running first in the same file, already fired the identical
`(code, wire, id)` signature) and its own assertion is the **adapter's** silence —
preserved, since no adapter-side diagnostic exists (NVA-3, `adapters.md:561`).

> **✎ MARKED 2026-09-22 (W4-revision rationale — gate-8 doc review, audit finding 6).**
> **The sentence above is the rationale of the W4 REVISION ONLY and no longer holds.**
> It depends on A+7a having **run first with the identical `(code, wire, id)`
> signature** — i.e. on suite execution ORDER. **W5 gave A+7b its own wire/id pair**
> (`parent-b7`/`ghost-b7`, §8.1 A+7b), so under a shuffled/isolated order (a
> `-t` filter, a random order, or the case running alone) A+7b's own resolver warn
> **does** fire and its `(code, wire, id)` is NOT in the C4 set — the suppression
> rationale is obsolete and must not be cited as the reason A+7b passes. What A+7b
> asserts now is the **adapter's** silence (exactly **one** resolver diagnostic from
> the EMIT, then **zero** further console calls from the adapter's
> `createEl`/`setProp`/`appendChild`) — a claim that is order-independent. The
> historical W4 text is retained verbatim so the revision is auditable; it is not a
> live reading.
>
> **✎ RE-ANCHORED 2026-09-22 (W4 audit finding 1).** The clause→code map for this
> section is §9.1 (re-derived from the current file).

### 9.5 The four register rows that remain RED — ORACLE defects, not implementation gaps

Executed register report (W4, verbatim):

```
[property-register] row=P-IM-1 … status=EXPECTED-RED attempts=16 failures=5 live=true positiveHalfLiveAttempts=11 counterexample=THREW: genGraph: no (element, foreign authored child) pair with an authored id outside the host's own children (k=1) — the mandatory F5 liveness clause cannot be met
[property-register] row=P-IM-2 … status=EXPECTED-RED attempts=8 failures=5 live=true fresh.length=2 perPass[0]=1 counterexample=attempt 1: (d) NON-VACUITY: …
[property-register] row=P-SM-1 … status=EXPECTED-RED attempts=16 failures=5 live=true counterexample=attempt 4: duplicate reference to "dup-2" produced 0 bodyruns-child-duplicate warnings (expected exactly 1 per signature, C3; 1 childOrder wires carry the id)
[property-register] row=P-IM-4 … status=EXPECTED-RED attempts=25 failures=3 live=true counterexample=attempt 12: text node "txt-12-1" … fired 0 text-node-children-ignored warn(s) (expected exactly 1)
```

Each row is red for a **generator/oracle** reason that no C1..C7-conformant
implementation can satisfy. **`src/**` was NOT adjusted to satisfy any of them**
(doing so would require emitting a warn the contract forbids, or suppressing one
the contract mandates). Filed as defect rows in `docs/defects.md` (ORACLE-1..4).

> **✎ RESOLVED 2026-09-22 (W5, test-side):** all four defects are FIXED in the
> test file — **§9.5(a)** carries the executed post-correction report (**all seven
> rows `HELD`**, 22/22 A+ cases, suite **1319 passing / 0 failing**). The table
> below is retained as the DEFECT RECORD (what was contradictory and why no
> conformant implementation could pass it); each row's "Required follow-up" column
> is what the W5 pass implemented, and the §5 strategy cells carry the matching
> `✎ AMENDED 2026-09-22 — ORACLE-n CORRECTION` markers. **Line citations into
> the test file in this table are PRE-W5 anchors** (the W5 corrections shifted
> them); the file's own "LANDED LINE ANCHORS" header block is the live map and was
> re-anchored in the W5 pass.

| Row | The oracle defect (executed evidence) | Why no conformant implementation can pass it |
| --- | --- | --- |
| **P-IM-1** | the row's generator **throws before any emit** on **19 of its 100 attempts**: with `k = g.int(1, 6)` = 1 every child belongs to the single element, so `findForeignChild` returns null and the **F5 mandatory-liveness clause throws** (`tests/unit/bodyruns-drop-diagnostics.test.ts` `:849-854`); `runRegisterRow` records the throw as a failure and stops after 5 | **§5's own strategy cell contradicts its own F5 clause**: the cell seeds `k ∈ [1, 6]` while F5 requires a foreign pair that *cannot exist* at `k = 1`, and demands a throw when it cannot be built. No `src/**` change can prevent the throw — it happens before `emitElements` is called |
| **P-IM-2** | (c) `total ≤ expected.size` **fails with no prior row in the process**: the F5-injected **foreign** runs (§5 F5 injection #1/#2) are drops that C3 mandates a warn for, but F3's class filter excludes `foreign` from `expected` ⇒ `total = expected.size + 2` on the first attempts (measured: attempts 0/1/2 = `total 3 > expected 1`, `4 > 2`, `5 > 3`). (d) then fails in the full-file run for the mirror reason: `fresh` is filtered only by the row's **row-local** `seenInFile` set, while C4's set is **process-level** (`fresh.length=2 perPass[0]=1`) | (c) and (d) pull in opposite directions and **no implementation can satisfy both**: suppressing the foreign warns to satisfy (c) contradicts C3/A+1 (A+1 explicitly asserts the foreign warn); letting every expected signature warn to satisfy (d) requires the process-level set NOT to hold a signature an earlier row fired, which is exactly what C4 mandates. (c) also contradicts §5's own Omission note ("**No row asserts an exact global warn total for a whole graph** … only the per-signature bound P-IM-2(c) is") — yet (c) *is* such a total, with an under-counted `expected` |
| **P-SM-1** | the generator draws `dupCount = Math.min(j, g.int(1, 3))`, which **can be 1** — i.e. **no duplicate exists at all** (one `childOrder` position carries the id) while the row still demands exactly **1** `bodyruns-child-duplicate` warn. Measured: **9 of 40** attempts (`[4, 12, 13, 14, 15, 19, 21, 23, 31]`) are `references && dupCount === 1` | §5 P-SM-1's property statement is scoped to "an element whose `childOrder` contains **≥ 2** wires carrying the same authored `props.id`", and C3's trigger is "≥ 2 wires"; the warn on a NON-duplicate is forbidden. Making it warn anyway would break A+5/A+2-control/A+4-control |
| **P-IM-4** | the generator pushes shape-1 nodes into `expectWarnFor` **regardless of `cLen`**: when `cLen = g.int(0, 3) = 0` the node has **no** authored children and **no** bodyRuns, so nothing is dropped and C5.3 mandates SILENCE, yet the row demands exactly 1 warn. Measured: **3 nodes** (`txt-12-1`, `txt-14-*`, `txt-20-*`) — attempts 12/14/20 | This is the **same F2 over-strength the amendment corrected for shape 2** (the childless multi-`{text}` node), left in place for shape 1: §5 P-IM-4's own strategy cell says "(a) the **warn arm** is `children.length > 0` **OR** a `{ child }` run present" |

**Required follow-up (test-writer pass — the file is NOT editable by W4):**
P-IM-1's generator must seed `k ≥ 2` (or construct the pair); P-IM-2's `expected`
must be built from the **drop classes** (`junk-absent` **∪** `foreign`) **or** (c)
must be restated on the per-signature bound only, and/or (d) must compare against a
process-level fresh set; P-SM-1's `dupCount` must be `≥ 2`; P-IM-4 must push
shape 1 into `expectWarnFor` only when `cLen > 0`.

#### 9.5(a) The follow-up LANDED — executed post-correction register report (W5, 2026-09-22)

All five follow-up items above (plus the `A+7a` flip, §9.4) are fixed **test-side
only** (`tests/unit/bodyruns-drop-diagnostics.test.ts`; `src/**` and
`package.json` untouched). Verbatim `console.log` from the harness:

```
[property-register] SEED=0x5eed0922 (1592592674)
[property-register] row=P-IM-1 strategy=P-IM-1/foreign-graph-gen status=HELD attempts=100 failures=0 live=true positiveHalfLiveAttempts=100 counterexample=none
[property-register] row=P-IM-2 strategy=P-IM-2/repeat-emit-determinism status=HELD attempts=100 failures=0 live=true fresh.length=1 perPass[0]=1 counterexample=none
[property-register] row=P-SM-1 strategy=P-SM-1/duplicate-id-gen status=HELD attempts=40 failures=0 live=true counterexample=none
[property-register] row=P-IM-3 strategy=P-IM-3/clean-tree-gen status=HELD attempts=60 failures=0 live=true counterexample=none
[property-register] row=P-TP-1 strategy=P-TP-1/roundtrip-gen status=HELD attempts=50 failures=0 live=true counterexample=none
[property-register] row=P-IM-4 strategy=P-IM-4/text-node-gen status=HELD attempts=25 failures=0 live=true counterexample=none
[property-register] row=P-IM-4 (control) strategy=P-IM-4/text-node-gen status=HELD attempts=25 failures=0 live=true counterexample=none
[property-register] total attempts=400 (budget ceilings: 100/row, 400 total)
```

**Every §8.3 status rule is satisfied without special-casing:** all seven report
lines are emitted (record-before-assert), `live=true` on every row means each row
had at least one live falsification clause (so no row is `UNDETERMINED`, and none
is `HELD` on a bound clause alone), P-IM-2 prints its `fresh.length` vs
`perPass[0]` counts, and the report contract's requirement that a row's status be
**derived** rather than hard-coded is honoured: `statusOf` no longer reads a
`EXPECTED_RED_ROWS` set (the four rows are satisfiable now) — a failing row reports
`BROKEN`. The suite reads **1319 passing / 0 failing** (W4: 1314/5; the A+ red
set's own file: **22/22**), `npm run typecheck` and `npm run build` clean,
`npm run demo:smoke` **SMOKE OK** (`warningsMain=0`; derived-fork per-region pins
values 1.24×/1.01×/1.26× and link 1.77×/1.08×/0.54× vs the 2.5× asserted bound;
runtime placement d12 **2.14×** the placement-derived baseline (340.2ms / 159.1ms)
vs the 3× tripwire; the runtime family's own totals guard reads values 1.02× /
link 1.06× vs placement).

> **✎ RUNTIME-RATIO CLAIM CORRECTED 2026-09-22 (gate-8 closeout pass — defect
> `SMOKE-TRIPWIRE-INERT` + row `RUNTIME-FORK-PASS2-RATIO`).** The `2.14×`
> runtime:d12 reading above is **NOT a runtime reading**: it was the tripwire's
> pre-repair **derived-vs-derived** quantity (the placement-derived page's total
> against the placement-derived baseline — the guard never read the runtime page).
> The **honest** runtime:derived reading at d12 is **9.45× / 9.88× / 10.44× / 10.50×**
> over four consecutive runs, with `pass2` ≈ **84%** of the runtime total, and
> `demo:smoke` now **exits 1 at the tripwire** — left RED **by the user's ruling**
> (`docs/decisions.md` **RUNTIME-FORK-TRIPWIRE-BOUND**; the bound is **NOT**
> re-baselined). **Everything else in this paragraph is unaffected and still valid:**
> the **derived-fork per-region pins** (values 1.24×/1.01×/1.26× and link
> 1.77×/1.08×/0.54× vs the asserted 2.5×) and **`warningsMain=0`**. The W5 suite
> reading **1319 passing / 0 failing** stands (superseded upward by the blind-greens
> **1340 / 0**, 76 files).

**Falsifiability (the other direction), from the same-code PRE-correction
reading:** every corrected clause WAS broken by the landed-but-oracle-defective
rows and reported a concrete counterexample — (c) `total = expected.size + 2`;
(d) `fresh.length=2 perPass[0]=1`; P-SM-1 `0` duplicate warns for a genuinely
referenced duplicate; P-IM-4 `0` `text-node-children-ignored` warns for a genuine
drop. Each of those four readings is exactly what a DELETED diagnostic layer
produces, so with the diagnostics removed the four rows go RED again (each clause
carries a live candidate and its expectation is input-derived); with them present
they are GREEN. **No `src/**` edit was made to obtain either direction**
(§9.5's own constraint).

### 9.6 Fork-arm / base-wire resolution (D2(i)) — disposition: **DOCUMENTED RESIDUAL**

**Implemented as C3 states it** (no seam change): a run naming a fork arm's
**explicit arm wire** (`<nodeId>#<i>`, present in the parent's post-remap
`childOrder`) **passes through unchanged** via C1 step 1 (`:239-245`). A run naming
the arm's **base node's authored id** cannot resolve — the global index holds the
**base** wire (`pathWireOf(s)`, `:698`) while `childOrder` holds the arm wires,
so the clamp finds no member — and is therefore **DROPPED + `bodyruns-child-unresolved`**
(C1 step 4, `:286-299`), exactly as C3's fork-arm row already specifies.

**Residual (recorded, not fixed):** an authored-id ref to a forked child's base
node therefore never resolves. It cannot be resolved without a seam change or a
semantic decision: **one** run can name only **one** wire while the parent adopts
**all** arms (`:716-720`: "one element per arm; the first arm carries the full el,
the rest are leaf dupes" — the parent adopts every arm, so a `#<i>`-specific run
cannot select one of them), and resolving to the base wire would be a
**foreign** wire (breaking C2). No register row and no A+ case covers this class
(the audit §5 records it as the class a W4 clause must state); the reachable
workaround for an author is to name the explicit arm wire.

### 9.6b The C4 dedup's CROSS-DOCUMENT effect — residual **R-W4-5**

**✎ ADDED 2026-09-22 (W4 audit finding 3 — MUST-RECORD; behaviour is
spec-permitted, so this is observability/documentation debt, NOT a code bug).**

**The semantics, stated precisely:** C4's dedup set is **process-level** and keyed
`(code, elementWire, value)` where the wire is **not document-scoped**, so the
guarantee is:

> **one warn per `(code, wire, id)` per PROCESS — never per document.** The
> SECOND document in the same process that meets a triple the first already met is
> **silently suppressed**, whether or not the second document's host ever saw the
> first line.

**Why it is reachable (not theoretical):** the wire/id values are **authored or
serialized data** — a `loadState`-seeded graph, a doc-carried envelope, a
re-serialize — not process-unique handles, so two documents rendering in one
process can carry identical `(code, wire, id)` triples. A host rendering several
documents in one process (the producing-process/SSR shape) can therefore be
**denied a diagnostic it never saw**.

**The memory shape:** the set is **unbounded and never cleared** — one short
string per distinct triple per process, no clamp applied (§9.2; permitted by C4's
"W4 MAY instead clamp it"). It retains no graph references, so the cost is a
string set whose cardinality is the number of distinct triples the process has
ever met.

**Host expectation (recorded so a host can act, and so an absence of a line is
never read as "nothing was dropped"):**
1. **Route `console.warn` per document** — wrap/capture the channel around the
   host's own render call (or tag the emitted line with the document being
   rendered) to get per-document completeness; **or**
2. **Accept the suppression** — the first occurrence of a triple in the process is
   always reported, and a repeat across documents is **by design** (that is what
   makes the P2 per-keystroke bound hold).

**Disposition:** DOCUMENTED RESIDUAL — **no W4 clause change, no `src/**` change,
no assertion change.** The behaviour matches C4 as written and as landed; what was
missing was this consequence being recorded for hosts. Parked with its revisit
condition in `docs/pending.md` (**R-W4-5**) and carried in §9.8.

### 9.7 Guarantees verified in this pass

- **C6 (byte-identical clean emit):** P-IM-3 `HELD` (`attempts=60 failures=0`,
  0 warns, `diffMinimal === []`, exact key set, `childOrder === [...children]`);
  the silence controls A+2-control/A+4-control/A+4c/A+5/A+6a/A+6b all GREEN.
- **C7 (no mutation):** P-TP-1 `HELD` (`attempts=50 failures=0`).
- **No smoke/census impact:** `warningsMain === 0` (it is the K4 translate array,
  not a console counter) and the census/derived-fork guards are unchanged; no demo
  module authors `bodyRuns`, and no demo `text` node carries children.
- **`emitElements`' signature, `MinimalElement`, `orderSig`:** unchanged;
  `npm run typecheck` + `npm run build` clean.

### 9.8 Residuals carried out of W4

| ID | Residual | Reason it is not fixed here |
| --- | --- | --- |
| **R-A1** | the `:234` empty-map bail's `!authoredIdToWire` half is still dead code (the bail itself is `:234`, unchanged by W4; pre-W4 anchor `:188`) | unchanged by contract (C1's dead-guard bullet): no recorded clause requires W4 to touch it, and removing it would need a caller that passes no index |
| **R-W4-1** | an authored-id ref naming a fork arm's **base** node drops + warns (§9.6) | needs a seam/semantics change; C3 already specifies the drop; no consumer authors the shape |
| **R-W4-2** | four §5 register rows are unsatisfiable as generated (§9.5) | **RESOLVED 2026-09-22 (W5, test-side)** — all four oracle defects fixed; the executed post-correction report is **§9.5(a)** (all seven rows `HELD`). The PRE-correction table in §9.5 is retained as the defect record |
| **R-W4-3** | `A+7a`'s silence half is now false (§9.4) | **RESOLVED 2026-09-22 (W5, test-side)** — the half is re-pointed to the WARN assertion (§8.1 A+7a, clause (iii) superseded); `A+7b` stays GREEN with its assertion scoped to the adapter |
| **R-W4-4** | `package.json` still reads 0.5.0 | the bump + the `docs/releases.md` row belong to the release pass (§9, header) |
| **R-W4-5** | **the C4 dedup is PROCESS-level and NOT document-scoped** — a second document in the same process can be **silently denied** a `(code, wire, id)` diagnostic the first document already met, and the set grows unbounded (no clamp) | **✎ ADDED 2026-09-22 (W4 audit finding 3 — MUST-RECORD).** The behaviour is exactly what §3 C4 specifies (the bound must hold **across keystrokes**, which is also what makes it hold across documents; §9.2 records the deliberate no-clamp). Changing it — a per-document key, a per-document reset, or a clamp — is a **contract decision with its own gate** (C4 pins the mechanism), so it is recorded rather than fixed. §9.6b carries the full semantics; the parked revisit condition is row **R-W4-5** in `docs/pending.md` |
