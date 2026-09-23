# Spec — NO-CLONE-INVARIANTS: the machine-enforced no-cloning invariant for placement + component paths, and the two harness defects that hid it

- **Status:** `LANDED 2026-09-22 — the enforcement unit's test pass + the harness/demo fixes are IN; reconciled by the gate-8 doc review 2026-09-22`. The original status line read `SPEC-WRITTEN 2026-09-22 — awaiting the enforcement unit's test pass` / "**Nothing in this file is built yet**"; **that is now SUPERSEDED** (annotated, not deleted). What landed, with the executing record: the two §8 suites — `tests/unit/no-clone-invariants.test.ts` (NC-1a…NC-1g + the six engine-side register rows) and `tests/unit/no-clone-guards.test.ts` (NC-2a…NC-2d + the P-SM-1 harness row + the offline control) — and the §3 I5 measurement + §4 guard-ordering fixes in `scripts/demo-smoke.mjs` + the three demo pages. **✎ SUPERSEDED-IN-PART 2026-09-23 (annotation, not a rewrite):** the §4 guard-ordering contract this status line reports is UNCHANGED (every guard still enters and reports; one aggregated exit), but the guard the pre-fix ordering hid behind is no longer `runtime-fork-tripwire` — the user's 2026-09-23 ruling RETIRED that cross-family assertion and replaced it with the runtime-vs-runtime **`runtime-fork-growth-guard`** (`docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD), so the smoke is now expected GREEN. Any id-level re-point this spec's §4 acceptance criteria imply for the retired id is filed (test-side) as `docs/defects.md` **FORK-STRESS-TRIPWIRE-STALE-SPEC**. **The seven §5 register rows all report `HELD`** (P-IM-1..4, P-TP-1, P-TP-2, P-SM-1; seed `20260922`, 362 attempts ≤ 400); the five cases this spec shipped as awaiting the harness pass (NC-2a, NC-2b, NC-2c, NC-2d and P-SM-1 — NC-2a/NC-2b landed RED against the pre-fix harness) are **GREEN** against the fixed harness; **measured by the supervisor 2026-09-22: `npm test` = 1362 passed / 0 failed (78 files)**, `npm run typecheck` and `npm run build` clean, `npm run demo:smoke` **RED at the runtime tripwire by the user's ruling** (**measured by the supervisor: 34 guard entries with exactly one failing guard — `runtime-fork-tripwire`, 10.44× vs the unraised 3× bound — so every other guard runs and reports**; the §4 guarantee holds). This is the **Step-4 contract** (AGENTS.md item 7) for the user-approved
  invariant-enforcement unit (approval 2026-09-22).
- **✎ ERRATUM 2026-09-23 (release pass, 0.5.1 — annotation, not a rewrite):** two
  readings in the status block above are **PRE-RETIREMENT** and are corrected
  here rather than silently dropped: **(a)** the smoke's *"exactly one failing
  guard"* was the `runtime-fork-tripwire` RED **by the 2026-09-22 ruling**, which
  the user **retired as an assertion** on 2026-09-23
  (`docs/decisions.md` `RUNTIME-FORK-GROWTH-GUARD`, superseding
  `RUNTIME-FORK-TRIPWIRE-BOUND`) — the smoke is now **GREEN** (measured by the
  supervisor 2026-09-23: **0 guard failures, exit 0**), and the retired id is no
  longer a guard entry (it survives only as the INFORMATIONAL
  `[runtime-fork:tripwire] …` print) — **and the entry COUNT that cell quotes
  (34) is now DISPUTED**: the tracker also carries a 35/1 pre-retirement reading,
  and the release pass's static count of the live harness is **≈31 entry lines**
  (`runGuard` 27 call sites incl. one mode-toggle template expanded ×3;
  `guardEnter` is called only from `runGuard`). **This file asserts no count** —
  resolution is one executed smoke run. **(b)** The test-count cell
  (**1362 / 78 files**, supervisor 2026-09-22) is the **pre-conversion** baseline;
  later recorded readings are 1387 / 79 files and **1430 / 0 failed (81 files) +
  phase B 12 passed** — **attributed, not re-measured by the release pass**, and
  never to be asserted as an executed count by a docs pass. **The §4 ordering
  contract, the I1..I5 enforcement, the §5 register rows and every bound
  described in this file STAND unchanged.** Full note:
  `docs/next-steps.md` §"✎ RELEASE PASS (0.5.1) — IN FLIGHT 2026-09-23" item 5.
- **The invariant HOLDS TODAY (state this first, because it changes what a red
  test means).** The RCA probe `archive/reviews/2026-09-22/2026-09-22-noclone-probe.md`
  (measured 2026-09-22) is **INTACT on every placement / component / def-fill /
  fork-arm / path-state / re-mint path** of the current tree
  (`2026-09-22-noclone-probe.md:22-31`, §1 table `:44-54`, §4 measurements
  `:202-209`). **This unit adds ENFORCEMENT; it fixes NO *engine* behaviour.** The only
  code-surface change in scope is (a) the harness `cloneOps` **measurement** fix
  (§3 I5) and (b) the harness **guard-ordering** fix (§4) — plus what the
  enforcement adversarial audit then forced into the same two harness/demo
  surfaces (F1..F8: the exit self-check, the real `try/catch/finally` `runGuard`,
  the effective fault seam, the margin removal, the independent-source census
  comparison, loud missing-baseline failures, `guardLeaveFailed` routing, and the
  failure demonstrations — see §8.6 and
  `archive/reviews/2026-09-22/2026-09-22-noclone-enforcement-adversarial.md`).
  **No `src/**` file changed in any of it.** A test written from
  §8 that finds a violation is a **DEFECT DISCOVERY** — to be filed in
  `docs/defects.md` — and **never** a licence to patch `src/**` to make it pass
  (§2 row 1; AGENTS.md item 8a: red is written before any implementation
  exists, and here the "implementation" is a *no-op* because the contract is
  already satisfied).
- **The invariant (user's verbatim statement, 2026-09-22):** *"A placed node is
  attached to its parent by link only, using the original node. The graph is
  walked such that each valid path to root produces a wire, and the wire
  determines the render state. Placements and components should not clone
  nodes. Ever."* — quoted at `2026-09-22-noclone-probe.md:9-12` and
  `2026-09-22-noclone-history.md:6-9`.
- **Target version:** **harness + test only — no engine version implication.**
  No `src/**` behaviour changes, no public surface changes, so no `VERSIONING-SCHEME`
  row (the `X.X.Y` patch / `X.Y.X` feature / `Y.X.X` breaking convention,
  `docs/decisions.md` **VERSIONING-SCHEME** by name; its row line read as `:19`
  this pass) is triggered by the enforcement half. The harness measurement fix
  changes what a *smoke guard reads*, not what the engine does; if it exposes a
  real census drift that is a `docs/defects.md` row, not a version bump decided
  here.
- **TestWriter contract:** every invariant, enforcement observable, property-row
  generator and falsification condition below is derivable from this file ALONE
  (no implementation reading required beyond the cited anchors). §8 carries the
  per-unit test contracts and the property-layer execution instructions.
- **Date:** 2026-09-22.
- **Citation convention (mirrors `docs/releases.md` §"Citation convention"):**
  `src/**`, `tests/**`, `scripts/**`, `demo/**` and `docs/specs/*.md` anchors carry
  line numbers read **this pass (2026-09-22)**; **tracker rows**
  (`docs/decisions.md`, `docs/defects.md`) are cited **by row NAME** wherever the
  citation is load-bearing, because those files are re-ordered every pass and
  their line numbers drift — a number is given only as a locating aid for the
  reading that produced this file.
  ✎ **DRIFT CONFIRMED 2026-09-22 (gate-8 doc review):** the tracker line numbers
  quoted in this file's §3/§9 (`docs/decisions.md:74` DEFECT #11,
  `:84` SEAM-RESOLVED CARRIERS, `docs/defects.md:126` DEFECT #24 — **all three
  aids have since moved on; re-locate by ROW NAME, see the 2026-09-23 correction
  immediately below**) are **locating
  aids read BEFORE the same pass's tracker edits**, and they have since moved
  (**now `:78`, `:88`, `:130` respectively** — verified this pass). **Every
  load-bearing tracker citation in this file is by ROW NAME and is unaffected**;
  `:14` (RUNTIME-FORK-TRIPWIRE-BOUND) and `:19` (JOURNAL-READ-API) still locate
  their rows. **Do not build on a tracker line number** — re-locate by name.
  ✎ **✎ RE-VERIFIED AND CORRECTED AGAIN 2026-09-23 (doc housekeeping —
  `STALE-RESOLVE-ANCHORS` + the `defects.md` OPEN-table row move):** the aid set
  above had drifted a THIRD time, and the two aids the previous correction
  declared sound were among the stale ones. Re-read in the tree 2026-09-23:
  `docs/decisions.md` DEFECT #11 is **`:85`** (not `:78`), SEAM-RESOLVED
  CARRIERS **`:95`** (not `:88`), RUNTIME-FORK-TRIPWIRE-BOUND **`:19`** (not
  `:14`), JOURNAL-READ-API **`:26`** (not `:15`/`:19`); `docs/defects.md`
  DEFECT #24 **`:145`** (not `:130`), SMOKE-TRIPWIRE-INERT **`:18`** (was
  `:15`), RUNTIME-FORK-PASS2-RATIO **`:19`** (was `:16`),
  SMOKE-NOCLONE-AUDIT-2026-09-22 **`:16`**. The `docs/defects.md` rows moved
  because the OPEN table's closed rows were re-homed under a labelled
  `## MOVED OUT OF OPEN 2026-09-23` block. **Every `docs/defects.md` citation in
  THIS file was re-pointed in the same pass — cite BY ROW NAME; a line number is
  a locating aid only, and no clause here relies on one.**
- **Provenance (read-only, not re-litigated):** the **two** persisted 2026-09-22
  RCA reports —
  `archive/reviews/2026-09-22/2026-09-22-noclone-probe.md` (the behaviour
  probe, the per-path verdict table, the §7 uncaught-regression list) and
  `archive/reviews/2026-09-22/2026-09-22-noclone-history.md` (the rule's four
  textual homes + the linking-semantics change history) — plus the
  **received-in-context, NOT-PERSISTED** approval-trail audit (the third RCA
  report: *no file exists at the path this block formerly cited* — see
  **RESOLVED 1 (CORRECTED below)**, which is the **authoritative** statement of
  its status); the owning records
  `docs/specs/ops.md` §2.4 + `docs/decisions.md` DEFECT #11.
  *(This block **is** the file's amendment record: the two `✓ RESOLVED` items
  below are its amendment-log entries, the table log is §8.6, and the block's
  two sub-sections are cited as **§0.2** (executed git evidence) and **§0.3**
  (the `ops.md` §2.4 nuance + RECOMMENDATION).)*
  ✎ **RESOLVED 1 (2026-09-22, supervisor) — SUPERSEDED IN PART / CORRECTED
  2026-09-22 (gate-8 doc review): the third RCA report was NEVER PERSISTED, and
  the path this file cited DOES NOT EXIST.** The earlier "RESOLVED 1" text
  recorded `archive/reviews/2026-09-22/2026-09-22-noclone-approval-audit.md` as
  a **live artifact** "present per the supervisor's executed directory listing,
  18 544 bytes". **That is false and is withdrawn**: the directory holds the eight
  other RCA/review reports of 2026-09-22 (`ur-validity`, `ur-critique`,
  `ur-architecture-review`, `ur-aplus-adversarial`, `ur-doc-review`,
  `w4-doc-review`, `noclone-history`, `noclone-probe`) and **no approval-audit
  report** — verified by the supervisor
  with an executed `ls` this pass, and independently reproduced by the gate-8
  doc reviewer's own `glob` over `archive/reviews/2026-09-22/**` (which returned
  the eight other 2026-09-22 reports and — before this review persisted its own
  files — **no approval-audit report**; the directory now also holds this pass's
  `2026-09-22-noclone-enforcement-adversarial.md` and `2026-09-22-noclone-doc-review.md`,
  which are this review's own additions and are labelled as such). The **"18 544
  bytes" figure is struck**: it described nothing on
  disk. No file was deleted in any pass — **the report was received as an
  in-context agent report and was never written to disk** (the audit session had
  no write tool).

  **Where the approval-trail content actually survives (the honest citation
  set):**
  1. the **supervisor's synthesized RCA** (the in-context synthesis that this
     unit's spec, the `docs/decisions.md` NO-CLONE-ENFORCEMENT /
     NO-CLONE-HARNESS-OPS rows and `docs/defects.md`
     SMOKE-NOCLONE-AUDIT-2026-09-22 carry — the findings are **received, not
     persisted as a standalone artifact**);
  2. **`2026-09-22-noclone-history.md:331-353` §5 "the approval trail"** — the
     **git-provenance half**, i.e. the per-change table of which gate record
     authorized which linking-semantics change, with its headline *"NO
     authorizing artifact anywhere in the tree mentions the no-clone invariant
     except the artifacts that ARE the rule"* (`:333-338`). This is the
     **citable** record; it always was (`2026-09-22-noclone-history.md:86-91`
     is the rule's four-home census).

  **The four findings the approval audit returned, and their current homes (no
  line inside any unpersisted report is load-bearing):** (i) *no gate record
  lists the invariant* → `2026-09-22-noclone-history.md:333-353` + §1/§4 of this
  spec (the reason the unit exists); (ii) *no test measures placement/component
  node identity* → **CLOSED** by the landed §8.1 NC-1 suite (I1/I2/I3 rows);
  (iii) *the only component census is unreachable* → `docs/defects.md`
  **SMOKE-GUARD-UNREACHABLE** (FIXED 2026-09-22); (iv) *the adversarial dimension
  is a positive-invariant template* → the §5 register's per-row anti-vacuity
  clause (§5/§8.4) and the fault-injection arm of P-SM-1. **No contract clause
  and no §8 case depends on the unpersisted report.**

  **Consequence for this spec (unchanged in substance, now honestly sourced):**
  the "resolve the path or make the substitution permanent" question is
  **closed by the substitution, not by a found file** — the approval trail is
  cited to `2026-09-22-noclone-history.md:331-353`, and the audit's own report
  is recorded as **received-in-context / not persisted** everywhere it is
  mentioned (§9). **No citation to the non-existent path remains in this file or
  anywhere in `docs/`** — see
  `archive/reviews/2026-09-22/2026-09-22-noclone-doc-review.md` §"citation
  audit" for the full sweep.

  ✔ **RESIDUE KEPT (it is the evidence, and it was right the first time):** the
  SpecWriter's own verification pass — four read/search calls
  (`archive/reviews/2026-09-22/*noclone*`, `archive/reviews/*/*.md`,
  `**/*approval*`, and a content search for `noclone-approval` /
  `approval-audit`) — **every one returned no such file**. That "failed
  confirmation" was **a correct observation of the tree**, not a tool-wall
  artifact: read/search was sufficient to establish absence, and the
  supervisor's later `ls` agrees. The SpecWriter's "file is absent" flag is
  therefore **REINSTATED as correct**; the withdrawal was the error. (The
  original "no shell → cannot confirm existence" reservation is moot: existence
  is decidable without a shell, and it was decided wrongly.)
  ✓ **RESOLVED 2 (2026-09-22, supervisor, EXECUTED) — the git history facts are
  MEASURED, not supplied.** The history report's own stated blocker was that it
  could not run git and that `grep '5e8be50'` over the tree returned **no
  matches** (`2026-09-22-noclone-history.md:50-78`, §6.A `:361-382`, §6.C
  search 1 `:389`; its "Unverified / open (needs shell)" list and verification
  kit are at **`:447-476`**, read this pass) — that gap is now **CLOSED**.
  Every git-derived claim in this spec is **MEASURED**, by the supervisor's
  executed commands **2026-09-22** (this session), and is stated below **once**,
  as the normative evidence block **§0.2** every other git sentence in this file
  refers back to. **The "SUPPLIED-BUT-UNVERIFIED" labelling is withdrawn**: in
  particular *whether the rule's text was ever reworded in a commit* (history
  report `:449`) is now answered **NO** — see F2 below.
  `5e8be50`'s identity is likewise **MEASURED** (its 107-file / +11526 / −658
  stat), so the probe report's `**Origin fix:** commit 5e8be50` header line
  (`2026-09-22-noclone-probe.md:15-16`, read this pass) is now a
  hash-verified claim, not a supplied one.
  **What the git archaeology does NOT settle** (kept as risk, §7 risk 3): the
  per-commit *dates* other than the two named, and the working-tree `git diff`
  for the files uncommitted at the time of the history pass
  (`2026-09-22-noclone-history.md:451-452`) — neither is load-bearing here.

  #### §0.2 THE EXECUTED GIT EVIDENCE (all "executed by the supervisor 2026-09-22")

  *(section §0.2 — the normative git-evidence block every git sentence in this file refers back to.)*

  Every git fact in this spec is measured by exactly one of these commands;
  **the SpecWriter did not run them** (no shell under this tool wall) and cites
  them **as executed by the supervisor 2026-09-22**. Nothing here is
  `[reasoned, unmeasured]`.

  | # | Finding (MEASURED) | Command / source |
  | --- | --- | --- |
  | **F1** | The rule text in `docs/specs/ops.md` has **exactly ONE revision**. `git log -S'never clone' -- docs/specs/ops.md` → exactly one commit: **`6d0a2ec`** (*"Document cleanup and anchor defect fix"*). `git show 6d0a2ec:docs/specs/ops.md` contains the rule text **byte-identically to the current tree**. `git log 6d0a2ec..HEAD -- docs/specs/ops.md` → **nine** commits, **none** of which touches the rule clause | executed by the supervisor 2026-09-22 |
  | **F2** | **The rule's text was never reworded after it was established** — the history report's open question (`2026-09-22-noclone-history.md:449`) is answered: the only `-S` hit for the rule's phrasing is the strike commit, and the following nine `ops.md` commits leave the clause untouched | F1, executed by the supervisor 2026-09-22 |
  | **F3** | `git log -S'node-cloning'` and `git log -S'path enumeration'` → the **same single commit** `6d0a2ec`; `path enumeration` **also** appears in `6eb1cb4` (a second, non-rule-bearing hit) | executed by the supervisor 2026-09-22 |
  | **F4** | **`5e8be50`** — *"Fix for a spec mistake in the graph processing layer that resulted in node-cloning instead of virtual linking."*, **2026-08-14**, **107 files, +11526 / −658** — is the commit that **removed the clone-based placement path** | executed by the supervisor 2026-09-22 |
  | **F5** | `git log -S'decomposes into attach + clone-instance'` → **`996ca7f` (initial), `5e8be50`, `6d0a2ec`**: the decomposition **existed from the initial commit** and was **struck at `6d0a2ec`** — the *code* change and the doc cleanup both landed at `5e8be50` (2026-08-14), with the **doc-side strike completed in `6d0a2ec`** (the commit the brief dated 2026-08-15) | executed by the supervisor 2026-09-22 |
  | **F6** | The **pre-fix design was documented verbatim**: `git show 996ca7f:RENDER_PROCESS_NOTES.md` **line 157** — *"`placement.placeInto(sourceNode)` — **clones** the source content node into the host container, records the clone in `placement._referencingNodes`"*; `git show 5e8be50:RENDER_PROCESS_NOTES.md` **still carried that paragraph** — **the docs lagged the code by a day**. (This is the pre-fix design the user's no-clone statement rejects; it is the *history*, not the current contract.) | executed by the supervisor 2026-09-22 |
  | **F7** | `git log --oneline -S'component-instantiation' -- docs/specs/ops.md` → **`5e8be50` only** — the `component-instantiation` clause has **exactly one revision** | executed by the supervisor 2026-09-22 |
  | **F8** | **`translate.ts` has contained ZERO `clone-instance` mentions in every revision checked** — `996ca7f`, `7d9d77e`, `5e8be50`, `6d0a2ec`, `691320b`, **HEAD** — i.e. **the engine never translated a placement into a clone**. This is the git-side confirmation of the working-tree census this pass read (`translate.ts` mint sites, §3 I1/I3) | executed by the supervisor 2026-09-22 |
  | **F9** | `git show --stat` over the **nine** post-rule `ops.md` commits (**`610c053`, `1ca97f0`, `6685cd6`, `790c313`, `e552587`, `691320b`, `4a2adc7`, `be11b2e`, `4b…`**) touches `src/core/` **only** in `supervisor.ts` / `node.ts` / `registry.ts` / `types.ts` / `adapters.ts` — **none introduces a `clone()` call site reachable from placement/component** | executed by the supervisor 2026-09-22 |

  **How these facts are used (and how they are NOT).** F1-F9 are **provenance
  and non-regression evidence**, not enforcement oracles: they say the invariant
  was (i) established at `5e8be50`, (ii) never reworded since `6d0a2ec`, and
  (iii) never contradicted by the nine commits that followed. They do **not**
  substitute for any §8 case. The enforcement oracles remain the working-tree
  `file:line` anchors in §3 and the §5 generators — i.e. **current-code**
  facts, so the F-row evidence can never be the reason a §8 case passes. Where
  a git hash appears elsewhere in this file, it refers to this block.

  #### §0.3 THE `ops.md` §2.4 NUANCE (recorded, with a RECOMMENDATION requiring the gate)

  *(section §0.3 — read with `docs/specs/ops.md:87` and `:88` side by side; the
  RECOMMENDATION at its end requires a user/gate decision and changes no file
  in this pass.)*

  **The two neighbouring sentences must be read together.** `docs/specs/ops.md:87`
  (bullet 3 of §2.4, **one revision, `5e8be50` — F7**) reads: *"**Not the
  placement mechanism** (P3 §9-Q2/F-4): placement goes through the dedicated
  `placement-attach` op (§2.6); **clone-instance stays the component-instantiation /
  after-compile-expansion path only**."* Its neighbour `docs/specs/ops.md:88`
  (bullet 4) reads: *"**HANDLER-LOGIC ONLY (user clarification 2026-08-15):** …
  NOT needed by the base engine (compile/emit/render/resolution never clone —
  placements = path enumeration + seam anchor layers, **components = resolution +
  seam** …)"* — and **I3 of this spec is exactly that second sentence**.

  Read **alone**, bullet 3's "component-instantiation" can be misread as
  sanctioning an engine-side component instantiation path **through
  `clone-instance`** — which would contradict I3 (components are resolution +
  seam, one identity set per authored def value, `registered` unchanged). Read
  **together**, the two sentences are consistent and precise:

  - **"component instantiation" (bullet 3) = AUTHORED-component instantiation
    via a DECLARED HANDLER OP** — a handler body applying `{kind:'clone-instance'}`
    and thereby *authoring* a new node (the sanctioned use, `docs/specs/ops.md:88`
    tail; `docs/specs/ops.md:220` op-kind list); its "after-compile-expansion"
    qualifier is the **slot in the wire vocabulary** the op fills.
  - **"components = resolution + seam" (bullet 4) = ENGINE-SIDE component
    resolution** — translate mints one prototype set per authored def value,
    `materializeSeam` installs seam links onto those **same** objects, and every
    consumer reads them: **no mint, no copy** (§3 I3's code sites).

  **No engine path exercises the former**: the engine's component route is
  resolution + seam only, and the git archaeology agrees — **`translate.ts`
  contained zero `clone-instance` mentions in every revision checked** (F8) and
  **no post-rule commit introduces a `clone()` call site reachable from
  placement/component** (F9). So bullet 3's "component-instantiation" is
  **never** an engine mechanism in the current design; today it can only mean
  the handler-authored op.

  ⇒ **RECOMMENDATION (requires a USER/GATE decision — this spec does NOT change
  `docs/specs/ops.md`).** If the gate judges the wording needs narrowing against
  a future misreading, the proposed replacement for the `docs/specs/ops.md:87`
  clause (one sentence, semantics-preserving, no new contract) is:

  > **Not the placement mechanism** (P3 §9-Q2/F-4): placement goes through the
  > dedicated `placement-attach` op (§2.6); clone-instance stays the
  > **authored**-component instantiation path **via a DECLARED HANDLER OP** and
  > the after-compile-expansion slot in the wire vocabulary **only — an
  > engine-side component "instantiation" path does not exist: components are
  > resolution + seam (bullet 4)**.

  **Why this is a recommendation and not an edit:** `ops.md:87`'s wording has
  **exactly one revision** (F7) and is not contradicted by any of the nine
  commits that followed (F1/F9); narrowing it is a *documentation* choice on a
  landed, gated clause, so it belongs to the user/gate, not to this spec pass
  (AGENTS.md item 6: one contract, one home — and this pass holds **no**
  `ops.md` write scope). **Until that decision lands, the two sentences are
  read together as above**, and nothing in §8's contracts depends on the
  reword.

---

## 1. Status

| Item | Value |
| --- | --- |
| Concern | Machine enforcement of the no-cloning invariant on placement + component paths, plus the two harness defects that made it unenforceable |
| Owning ask | the user's 2026-09-22 approval of the invariant-enforcement unit (the verbatim statement above) |
| Gate state | user-approved 2026-09-22; **this is the Step-4 spec** (AGENTS.md item 7) |
| Does the invariant hold? | **YES — on every path, measured 2026-09-22** (`2026-09-22-noclone-probe.md:22-31`, §1 `:44-54`) |
| Behaviour change | **NONE.** `src/**` is not a target of this unit (only the harness `cloneOps` measurement + the guard ordering) |
| Test-side deliverable | the two new enforcement suites of §8 (**all cases expected GREEN**) + the §5 typed property register |
| Harness deliverable | the `cloneOps` measurement fix (§3 I5, §8.3) and the guard-ordering requirement (§4, §8.4) |
| Trackers the landing pass owns | `docs/decisions.md` + `docs/defects.md` rows (§9) |
| Byte-identity pin | the enforcement pass must leave every existing green case green — it adds guards, it does not re-point oracles |

**One-line status:** the invariant is intact in code and documented in exactly
**one spec bullet** (`docs/specs/ops.md:88`), but it appears on **no gate's
must-not-break list**, **no test measures placement/component node identity**
for the component family, and the **only component census that could catch a
regression is unreachable** behind a `process.exit` — so this unit writes the
enforcement the missing gate should have written.

---

## 2. Scope

### 2.1 IN

| # | In scope | Where the contract lives |
| --- | --- | --- |
| 1 | Invariants **I1..I5** — statement, owning record, constrained code sites, violation signature, status | §3 |
| 2 | The **guard-ordering requirement** for `scripts/demo-smoke.mjs` (one guard per `process.exit`; no census may be silently unreachable) | §4 |
| 3 | The **typed property register** (PBT gate deliverable, `P-IM`/`P-SM`/`P-TP`, ≤ 8 rows) | §5 |
| 4 | The **documented non-assertions** (over-strength candidates deliberately omitted, with reasons) | §6 |
| 5 | **Risks / cost**, incl. the weak-generator risk and the guard-ordering discovery rule | §7 |
| 6 | The **test contracts** — two new suites, their case ids, exact observables, expected status (all GREEN), plus the two harness files the measurement fix touches | §8 |
| 7 | **Cross-references** to the five owning records and the decision rows the landing pass adds (✎ LANDED 2026-09-22 — recorded in §9) | §9 |

### 2.2 EXPLICITLY OUT (with the recorded reason)

| # | Out of scope | Recorded reason |
| --- | --- | --- |
| 1 | **Any change to engine behaviour.** A test that finds a violation is a **DEFECT discovery**, never a licence to patch `src/**` to make the test pass | The invariant is **measured intact** (`2026-09-22-noclone-probe.md:22-31`); a red enforcement row therefore documents a *regression somewhere in the tree*, and "fixing" it by editing the engine would (i) violate AGENTS.md item 8's red-first ordering, (ii) risk re-breaking a landed contract (the N1-regression class, `bodyruns-drop-diagnostics.md:860`). File a `docs/defects.md` row; the fix gets its own gate |
| 2 | **The fork-stress fixture family's handler-driven cloning.** `demo/fork-stress-data.js:251-254` applies `{kind:'clone-instance'}` twice per expand body; the page header documents the tree as a **pure clone-instance structure** and the method variants differ only in what each clone carries. The measured census is `cloneOps = 2/14/62/254/510/1022/2046/4094` for depth 2..12 (`2026-09-22-noclone-probe.md:53`) | **SANCTIONED** — this IS the handler use `ops.md:88` reserves the op for (`2026-09-22-noclone-probe.md:53`, `:191-193`). Asserting `cloneOps === 0` there would forbid the sanctioned mechanism; asserting a *literal* there would forbid legitimate fixture change (see §5's omission note 1) |
| 3 | **The pass-2 performance unit** (`RUNTIME-FORK-PASS2-RATIO` — the runtime fork page's ~9.4-10.5× vs the 3× bound; `docs/defects.md` **RUNTIME-FORK-PASS2-RATIO** ✎ 2026-09-23 re-pointed BY NAME — now `:19`, the former `:16`; `docs/pending.md` `:45`) | **A separate unit** with its own gate; it shares this unit's *file* (`scripts/demo-smoke.mjs`) but not its contract. **The guard-ordering fix of §4 must not re-baseline, weaken, or remove that tripwire** — it relocates *when guards run*, never what a bound is |
| 4 | **Re-pinning any existing oracle or census value** | The enforcement unit adds guards; changing an existing expected value is a separate, evidenced change (and in the smoke's case a supervisor/user decision, per the `SMOKE-TRIPWIRE-INERT` precedent `docs/defects.md` **SMOKE-TRIPWIRE-INERT** ✎ 2026-09-23 re-pointed BY NAME — now `:18`, the former `:15`) |
| 5 | **The `docs/decisions.md`/`defects.md`/`pending.md`/`next-steps.md` edits**, and the `docs/skills/designing-pages.md` §11 matrix row for the new suites | the landing pass owns the trackers (this file only cross-references, §9); the skill-doc row is listed in §8.5 for the landing pass |
| 6 | **Exercising or deleting any dead/unreachable guard in `src/**`** | Same class as `bodyruns-drop-diagnostics.md`'s residual **R-A1** (`:296-320`): a conservative-but-unreachable *engine* guard is a documented residual, not an enforcement-row target. **The harness unreachability of §4 IS in scope** — that one hides a guard whose whole purpose is this invariant |
| 7 | **A `clone()`-internals contract** (what `clone()` copies, layer/ignore semantics, `runtimeMinted` marking) | Owned elsewhere and already pinned: `tests/unit/node.test.ts:269-318` (M-6/M-7/M-8), `tests/unit/validation.test.ts:528-560`, `tests/unit/hooks.test.ts:388-410`. §6 row 3 |

---

## 3. The invariants — I1..I5

Each invariant states its rule, the record that owns it, the code sites it
constrains (every one a `file:line` this pass read), what a violation looks
like, and its DECIDED status + source.

### I1 — a placement attaches the ORIGINAL node, by link · **DECIDED**

**Statement.** A placed node is attached to its parent **by a link only**: the
shared per-name placement Link's `container` (producer/zone) and `content`
(consumer) anchor roles carry the edge, and the node sitting on that edge is the
**original object**. Consequently **a `placement-attach` op registers ZERO new
nodes** — `registered` is unchanged by an attach, and re-attach is idempotent.

**Owning record.** `docs/specs/ops.md:87` (the "**Not the placement mechanism**"
clause: *"placement goes through the dedicated `placement-attach` op (§2.6);
clone-instance stays the component-instantiation / after-compile-expansion path
only"* — **read together with `:88`, and via the wording RECOMMENDATION of §0.3
(MEASURED single revision, F7)**) + `docs/specs/ops.md:88` (the "**HANDLER-LOGIC ONLY (user clarification
2026-08-15)**" clause, which is the rule's single spec home —
`2026-09-22-noclone-history.md:86-91` census of the rule's textual homes) +
`docs/specs/ops.md:102-109` (§2.6 the op's step table: step 1 *"Register the node
if new (supervisor.registerNode — idempotent)"*, step 2 the `content` anchors on
**the shared per-name placement Link**, step 3 the `container` anchor, step 4
dirty-only-two-nodes) + `docs/decisions.md:74` (DEFECT #11:
*"clone-instance is HANDLER-LOGIC ONLY … runtime-minted clones reverse as
NOTHING"*). Anchoring vocabulary: `docs/specs/node.md:42-46` (SI-1..SI-5, incl.
**SI-3**: `'component'`/`'container'`/`'content'`/`'source'`/`'target'`/
`'duplex'` anchors are **peripheral** — they do not count toward the single-parent
invariant).

**Code sites it constrains.**

| Site | What it must keep doing |
| --- | --- |
| `src/core/translate.ts:1002-1044` | the authored placement mint: `container` on `hub.linkFor(placement.placementName, 'placement')` (`:1026-1027`) and ordered `content` anchors (`:1030-1044`) — **anchors only, no node** |
| `src/core/translate.ts:977` | the single authored-node construction site (`new Node(baseFrom(...)))`) — one node per authored data node; the placement mint runs *after* it and constructs nothing |
| `src/core/ops.ts:125-145` | `placementAttach`: `node.addAnchor('content', name, {}, hub.linkFor(name,'placement'))` (`:133`), the `container` ensure (`:136-139`) — **anchors only** |
| `src/core/supervisor.ts:1173-1196` | the `placement-attach` handler: `this.registerNode(node)` (`:1186` — idempotent by id), then `placementAttach`, then dirty exactly `[container.id, node.id]` (`:1192-1195`) |
| `src/core/node.ts:906` | anchor construction — `const anchor: Anchor = { role, target, options, link, owner: this }`: an anchor **references** the owner, it does not construct or copy a node |
| `src/core/node.ts:552-560` | `get parent()` — the parent is a **derived getter** over the family anchor (`linkOf(child).anchorsOf('parent')[0].target`) — a reference, never a stored copy (SI-1/SI-2, `node.md:42-43`) |

**What a violation would look like.** A placement path that constructs a second
node identity for the authored placed node — i.e. any of: `registered` rising
across a `placement-attach`; a `placement-attach` (or the translate mint)
appearing in the `new Node` census; the `content`/`container` anchors of one
zone landing on *different* `Link` objects; or an anchor `owner` that is not
(`===`) the authored node. The mechanical counter-measurement is the probe's
M1/M1d: 4 authored nodes → `nodes[]=4`, `registered=4`; both `container` anchors
share **ONE** Link object; `placement-attach` → `registered 4 → 4`
(`2026-09-22-noclone-probe.md:46-47`, `:203`).

**Status + source.** **DECIDED** — user clarification 2026-08-15
(`docs/specs/ops.md:88`), reaffirmed by the 2026-09-22 probe as measured-intact
(`2026-09-22-noclone-probe.md:22`). **Enforcement: LANDED 2026-09-22.** (The
pre-landing state, retained for the record: *partial* — the placement family was
guarded by assertion on the *static* path
(`tests/e2e/path-fork-e2e.test.ts:182-201`) but **nothing asserted that a
`placement-attach` op adds zero nodes** — probe §7 finding 4
(`2026-09-22-noclone-probe.md:306-310`).) The gap is closed by **§8.1 NC-1a**
(zero growth + shared-Link identity + ordered `content` anchors + idempotent
re-attach) and the **P-IM-1** register row (`HELD`, seed `20260922`).

### I2 — one node, many paths: the wire carries the multiplicity, never the node · **DECIDED**

**Statement.** Each valid path to root produces a **wire** (`pathKey`, or a
`forkKey`-bearing arm wire) over **one** node identity; the **wire determines
render state**. The distinct-`nodeId` count never grows with the number of
paths.

**Owning record.** `docs/specs/placement-path-spec.md:65` (**E2E-1**: *"The fork
test has ONLY the 22 prototype nodes (+ root). Generating the HTML elements, the
compiled states, and the passes that produce the render-adapter data must NOT
require creating new nodes"*) + `:47` (*"one state per (prototype, owner-path)
pair back to root … NO nodes created"*) + `:639` (the census row: *"registered =
23; in-tree = 23 … path-viable = 4095 … `cloneOps = 0`"*) + `:1658`
(*"contentNodes minting adds ANCHORS, never nodes — E2E-1's 'no node creation'
holds at every stage"*). Supporting record: `docs/specs/node.md:69-70`
(`NodeState`), `docs/specs/pipeline.md:67-68` (stage 1 resolves the path, stage 2
populates zones **without** clone-instance decomposition).

**Code sites it constrains.**

| Site | What it must keep doing |
| --- | --- |
| `src/core/node.ts:133` (`enumPathWalks`) | returns hop records whose `owner` is a **`Node` reference** (`{zone, owner: Node}`) — a walk, not a copy |
| `src/core/node.ts:232` (`pathKeyFor`) / `:249` (`pathChildrenFor`) | the key and the children are **derived** (`children: pathChildrenFor(...)` = child **node ids**, `node.ts:1415`) |
| `src/core/node.ts:1384-1418` (`mintPathState`) | builds a plain `CompiledState` with `nodeId: this.id` (`:1388`) and **`forkKey = pathKey` unconditionally** (`:1390-1391`), sharing the node's own objects — `props: this.props` (`:1406`), `css: this.css` (`:1407`), `content: this.content` (`:1408`), `anchors: this.anchors` (`:1410`). **Neither `registerNode` nor `registerMinted` nor `new Node` appears here** |
| `src/core/node.ts:1199` (`makeCs`, the family-state maker) | same shape for non-path states |
| `src/core/render-helpers.ts:138-140` (`pathWireOf`) | `isPathState(s) ? s.pathKey! : s.nodeId` — the wire is derived from the state, never from a new identity |
| `src/core/render-helpers.ts:1235` (the per-element wire) | `isPathState(s) ? s.pathKey! : armIdx !== undefined ? \`${s.nodeId}#${armIdx}\` : s.nodeId` — **the fork arm is a WIRE suffix (`nodeId#<i>`), not a node** |
| `src/core/render-helpers.ts:608-610` (`armWires`) + `:723` (the remap) | `armWires.set(wire, states.map((_, i) => \`${wire}#${i}\`))`; the parent's `childOrder` is re-pointed at those **wires** |
| `src/core/node.ts:1287-1292` (the arm state) | the arm changes only `cs.pathKey`/`cs.forkKey`, over the same `nodeId` |

**What a violation would look like.** `distinct nodeId` growing with path count
(a node minted per path); a path-state whose `nodeId` is not a translated node id;
a fork arm registered as its own node id; or `registered` rising between
`compilePath` and `emitElements`. The counter-measurement: depth 2/4/6/8/10/12 →
translated nodes 3/7/11/15/19/23 (authored `2d−1`) while path-states are
3/15/63/255/1023/**4095** — a nodeRatio up to **178×** with **zero** node growth
(`2026-09-22-noclone-probe.md:48`, `:206`); fork arms: 2 arms → **1** distinct arm
`nodeId`, `registered 4 → 4` (`:52`, `:205`).

**Existing pins (placement-side only) — and the GAP this unit closes.**

- `tests/blind/e2e-layer.test.ts:232-235` — *"zero node creation: every state is
  pinned to one of the 23 translated nodes"*: `new Set(states.map(s => s.nodeId)).size === 23`
  and `translatedIds.has(s.nodeId)` for every one of the 4095 states
  (read this pass, `:226-235`).
- `tests/e2e/path-fork-e2e.test.ts:182-201` — `allRegistered.size` unchanged
  (`before + 23`) re-asserted after translate, **compile, emit, diff, apply**
  while `adapter.wires.size === 4095`; `:203-229` adds the census
  23/23/0/0 + *"journal stays empty of `clone-instance` ops"* (`:228-229`).
- `tests/unit/path-enum.test.ts:166-175` — 23 nodes **and** 4095 states in one
  test (cited at `2026-09-22-noclone-probe.md:259`).
- ⛔ **The COMPONENT / fork-arm family has NO equivalent pin.** No test asserts
  the **prototype census** for a def referenced by 2+ consumers, and none asserts
  cross-consumer prototype **identity** (`2026-09-22-noclone-probe.md:263-292`,
  the §7 gap list `:285-299`). Fork-arm *node* identity is asserted
  (`tests/unit/path-emit.test.ts:238-261`, `tests/unit/render.test.ts:435-437`)
  but **not** that the arm wire `nodeId#<i>` is absent from `byId`
  (`2026-09-22-noclone-probe.md:316-321`). **Closing the component half is the
  core of this unit.**
- Note the one **strong-looking but vacuous** placement pin:
  `tests/blind/e2e-layer.test.ts:286-287` carries `// E5: cloneOps = 0 — the
  E2E-1 flow performs zero ClientAPI.apply calls` as a **comment only** — there is
  no assertion on that line (read this pass). That is I5's gap in miniature.

**Status + source.** **DECIDED** — the P3 requirement E2E-1
(`placement-path-spec.md:65`), user-confirmed; the 2026-09-22 probe re-verified
it as measured (`2026-09-22-noclone-probe.md:138-154`).

### I3 — a component is resolution + seam, never a copy · **DECIDED**

**Statement.** One node identity per **authored def value**. A def referenced by
N consumers yields **ONE** prototype instance set **shared by N seam edges** —
and multi-parent legality (G24) *rests on that sharing*: a def referenced twice
gives its children **multiple legal parents, one node**
(`docs/specs/ops.md:362`; `2026-09-22-noclone-history.md:135-136`). A full
resolution + emit pass leaves `registered` **and the def-prototype identity set
unchanged** — *not* the prototype-**state** count. See the ✎ CORRECTED
2026-09-22 (`NC-1d`) note at the end of this section: the `'prototype'`-state
count is EXPECTED to change on seam materialization (measured **3 → 0**).

**Owning record.** `docs/specs/ops.md:88` (*"components = resolution + seam"*);
`docs/specs/ops.md:362` (row **G24**: *"the def's child nodes (and, for
`children`-targets, the def-root) may end up with MULTIPLE LEGAL PARENTS — LEGAL,
intended"*); `docs/specs/ops.md:135` (ALS-1b, the def-root pre-mint), `:143-144`
(D8, def children pre-minted as out-of-tree `'component'`-token prototypes);
`docs/specs/ops.md:121-166` (§2.7, the D7 anchor-layer seam); `docs/decisions.md:74`
(DEFECT #11). Vocabulary: `docs/specs/node.md:57-62` (§1.3 permanent owners —
exactly three: **the root node**, **a component prototype**, the
**`contentNodes` array**).

**Code sites it constrains.**

| Site | What it must keep doing |
| --- | --- |
| `src/core/translate.ts:815-872` (`mintDefPrototypes`) | the **one** component construction site: it runs inside `translateNodeData` (the **authored def provider's own** translate site — reached from `translate.ts:1073`/`:1152`, `2026-09-22-noclone-history.md:115-118`), mints the def-root (`:854`) + one node per `def.children[i]` (`:863`) — **once per authored def value**, then registers them per component **Link** (`:856`, `:869`) |
| `src/core/registry.ts:181-183` (`registerDefPrototypes`) + `:185-187` (`defPrototypesFor`) | the registry is keyed on the **component Link** (`scope.defPrototypes.set(link, protos)`), so a second consumer reads the **same array of the same node objects**; `:189-194` is the def-root sibling |
| `src/core/node.ts:1697-1698` (`materializeSeam` reading `defPrototypesFor`/`defRootPrototypeFor`) + `:1699-1744` | the seam installs **`new Link({name:'parent-child'})` seam edges** onto the *pre-minted prototype objects* (`:1701-1705`, `:1719-1721`, `:1736-1738`) and copies **anchors** (not nodes) onto the consumer (`:1739-1743`). **No mint** |
| `src/core/node.ts:1690-1694` | DEFECT #24's anchor-copy removal — the def child's `container`/`content` anchors are **not** copied onto the def-root (a copy would announce one zone twice on the shared Link) |
| `src/core/node.ts:1732` / `:1850` (`adoptDefChildren`) | AUTH-SEAM: the def children are **MOVED** (the def-root's family link dissolves via `Link.destroy`) onto the consumer's family link — movement, not copying (`2026-09-22-noclone-history.md:177-181`) |
| `src/core/render-helpers.ts:1012-1080` (`emitDefChildTree`) + `:1372-1392` (the SED-1/SED-2 def-fill sites) | the **fill** is element-level: `MinimalElement` objects on **synthetic wires** (`<host>:<bind>` / `<host>:<index>`), never node ids (`:1045-1046`, `:1386-1388`) |

**What a violation would look like.** A per-consumer mint — i.e. the same def
referenced twice yielding **two** prototype instances with different ids; two
consumers' seam edges targeting *different* def-root objects; `registered` (or
the `prototype`-state count) rising across a compile/emit pass — **✎ CORRECTED
2026-09-22 (executed by the TestWriter — NC-1d): a *FALLING* `'prototype'`-state
count is NOT a violation** (it is the expected `DEFECT #24` seam-materialization
realization, measured 3 → 0); what the row falsifies is `registered` rising, or a
`'prototype'`-state count **rising**, or a def-prototype OBJECT IDENTITY changing
across the pass — see the ✎ CORRECTED block at the end of this section — or a
def-fill synthetic wire appearing in `registered`/`byId`. The counter-measurement: 1
authored def value + 3 consumers → `nodes[] = 7` (= root + 3 consumers + 1
def-root + 2 def-children), `defRootPrototypes = 1`, `registered = 7`, with **all
three consumers' seam edges targeting the SAME def-root object** (`distinct
seam-target identities = 1 over 3 edges`); `registered` **7→7→7→7** across
compile → emit (12 elements) → diff (41 ops) → apply
(`2026-09-22-noclone-probe.md:49-51`, `:204`, `:208`).

> ### ✎ CORRECTED 2026-09-22 (executed by the TestWriter — NC-1d)
>
> **The `'prototype'`-STATE count is NOT invariant across the pass, and this is
> the ASSERTED contract — do not re-assert the counting form.**
>
> **Measured by the TestWriter 2026-09-22 (executed):** on seam materialization
> the count of nodes whose derived `NodeState` is `'prototype'` goes **3 → 0**,
> while `registered` stays at **7** and **no node is created**. (The token that
> seeds the count is the family parent anchor's `'component'` string target;
> under it the derived state is `'prototype'` — `src/core/node.ts:534`
> (`if (target === 'component') return 'prototype'`), the state vocabulary of
> `docs/specs/node.md:69`.)
>
> **Mechanism (code-confirmed).** A `'children'`-target seam makes the def-root
> the consumer's seam-wired child: `src/core/node.ts:1699-1706` mints
> `new Link({name:'parent-child'})` plus `this.addAnchor('parent', …, {seam:true,
> seamTarget}, seamLink)` on the **consumer** and `defRoot.addAnchor('child', …,
> {seam:true}, seamLink)` on the **pre-minted def-root object**, and
> `:1719-1721` repeats it for each def-child prototype. That seam edge then
> becomes the resolution edge: `node.ts:508-520` (`stateChildAnchor`) — when the
> family edge's parent anchor is a **token-terminated** prototype
> (`'component'`) *and* a seam child anchor exists, the derived state resolves
> **through the seam**; `stateFrom` (`:529-546`) walks to the in-tree consumer
> and returns `'in-tree'` (`:533`). **Only anchors and Links are minted — no
> node**: `materializeSeam` spans `src/core/node.ts:1602-1747` and contains
> **neither `new Node` nor `registerNode`** (verified by search this pass — the
> file's only `new Node` is `:795`, inside `clone()`, and its only
> `registerNode` is `:443`, in the constructor), so `registered` is untouched;
> the seam install itself (`:1701`, `:1705`, `:1719-1721`) is the whole state
> change.
>
> **This is a recorded DECISION, not a defect.** It is the `DEFECT #24`
> realization — `docs/decisions.md` **SEAM-RESOLVED CARRIERS** row (read at
> `:84` this pass): *"A `'children'`-target seam under an IN-TREE consumer makes
> the def-root/def-children REALIZE in-tree for RESOLUTION via
> `Node.stateChildAnchor()` … unresolved defs stay `'prototype'`"*, with the
> census re-shape recorded as *"legacy-shape in-tree 11→14, prototypes 6→3"*;
> the G-series contract is `docs/specs/ops.md:361-365` (**G23** the
> `children`-target seam, **G24** multi-parent legality, **G26** the
> family-link filter, **G27** path enumeration) and the code comment is
> `src/core/node.ts:1689-1694`. The resolution-layer complement to AUTH-SEAM
> (`ops.md:365`), **not** a violation of I3.
>
> **What I3 therefore asserts (phase-INDEPENDENT observables only):**
> (1) **registry size** (`allNodes().length`) — identical before/after the pass;
> (2) the **def-prototype identity set** — the def-root and def-children
> **object identities** (`===`) unchanged across the pass, with all N consumers'
> seam edges on the SAME def-root object; (3) **"no synthetic def-fill wire
> registered as a node"**. **The `'prototype'`-state count is NOT an asserted
> observable** — a future reader must not re-assert the invariance form.

**Enforcement today: INCIDENTAL.** The landed guards assert *existence/shape*,
never a count and never cross-consumer identity: `tests/e2e/legacy-shape.test.ts:486-505`
(ALS-1b — existence/shape; its fixture has **one** consumer), `tests/unit/def-roundtrip.test.ts:44-58`
(`census.length === 3` for **one** registration), `scripts/demo-smoke.mjs:456-478`
(legacy-shape census: `registered=17`, `prototypes=3` — one consumer per def),
`tests/unit/legacy-shape-ops.test.ts:73`/`:259` (ALS-4/G24 asserts **anchors**,
not the prototype node count). This list is the probe's §6 table, read this pass
and reproduced from `2026-09-22-noclone-probe.md:265-271`.

**Status + source.** **DECIDED** — the D7/F16 mechanism
(`2026-09-22-noclone-history.md:272-273`, `ops.md:135`/`:143-144`), user-confirmed;
the probe measured it intact and named the enforcement gap
(`2026-09-22-noclone-probe.md:33-38`, finding **F-2**).

### I4 — `clone()` is reachable ONLY from the handler `clone-instance` route · **DECIDED**

**Statement.** The two and only two call sites of `Node.prototype.clone` in
`src/**` are `src/core/ops.ts:649` and `src/core/supervisor.ts:1243`, **both on
the `clone-instance` op route**. No translate / placement / resolution / emit /
diff / apply path may call it.

**Owning record.** `docs/specs/ops.md:88` (the HANDLER-LOGIC ONLY clause — *"The
op exists solely for HANDLER logic … and the wire vocabulary"*) +
`docs/specs/ops.md:87` ("Not the placement mechanism") + `src/core/pipeline.ts:79`
("placementAssembly … Populates zones **WITHOUT clone-instance decomposition**
(P3 §6.1) … The clone-instance op remains for RUNTIME/HANDLER-logic instantiation
only … **never the placement mechanism**, never required by translate or the base
engine") + `docs/specs/pipeline.md:68` (the same clause in the spec table) +
`docs/decisions.md:74` (DEFECT #11).

**Code sites it constrains.**

| Site | Exact shape (read 2026-09-22) |
| --- | --- |
| `src/core/ops.ts:647-652` | `case 'clone-instance': const source = toNode(op.source); const copy = source.clone('actor'); attach(copy, source.parent ?? source, op.priority)` — call site **1 of 2** |
| `src/core/supervisor.ts:1233-1269` | `if (op.kind === 'clone-instance') { … const copy = source.clone('actor', {}, this.graphScope ?? undefined)` (`:1243`) + `registerNode(copy)` (`:1244`) + the X12 cross-scope guard (`:1240-1242`) + the journal `minted: [copy.id]` (`:1268`) — call site **2 of 2** |
| `src/core/node.ts:790-846` | the declaration: `clone(actor?, opts, graphScope?): Node` — throws `new Error('cannot clone a destroyed node')` on a destroyed source (`:791`); `new Node({...this.base}, …)` (`:795`); `copy.runtimeMinted = true` (`:844`) |
| `src/core/node.ts:362-367` | the DEFECT #11 field comment on `runtimeMinted`: *"reverseTranslate EXCLUDES them (the authored envelope is base truth …)"* |
| `src/core/node.ts:818-830` | the DEFECT #9/#11 comment on the name-keyed anchor reuse + the runtime-minted marking |

**The two comments are the rule's code-side homes and both say the same thing:**
`node.ts:362-365` ("the graph redesign removed the need for literal cloning in
placement/component logic — clone-instance is a legacy artifact guard") and
`node.ts:827-830` (same sentence). Together with `ops.md:88` and
`decisions.md:74` these are **the rule's complete textual census — four homes,
no others** (`2026-09-22-noclone-history.md:86-91`, `§6.C` searches 4/5/12/25
`:392-413`).

**What a violation would look like.** A third `clone(` call site; `clone()`
reached from `translateNodeData`/`placementAttach`/`materializeSeam`/`emitOne`/
`compilePath`/`diffMinimal`/`applyOps`; or any clone that leaves a
placement/component pipeline without an explicitly-applied `clone-instance` op.
Mechanically: a spy on `Node.prototype.clone` **fires** on a placement-only or
component-only pipeline.

**Status + source.** **DECIDED** — user clarification 2026-08-15 (`ops.md:88`);
exhaustively grep-verified twice (`2026-09-22-noclone-history.md:138-152` §2.2;
`2026-09-22-noclone-probe.md:26-27`, `:69-74`). **Enforcement: LANDED 2026-09-22.**
(The pre-landing state, retained for the record: **none at the call-containment
level** — no test asserted *zero* clone calls on a non-handler pipeline;
`tests/unit/node.test.ts:269-318` and `tests/unit/legacy-shape-ops.test.ts:254-330`
pinned `clone()`'s *semantics*, never its *reachability*. That was the gap.) The
gap is closed by **§8.1 NC-1e** and the **P-IM-4** register row — `HELD`, with
ZERO calls on all three non-handler pipelines and **exactly `ops`** calls on
**both** handler call sites (`ops.ts` + `supervisor.ts`), a zero control
reporting `UNDETERMINED` rather than `HELD`.

**Enforcement shape this unit required (specified, and now LANDED 2026-09-22).** A spy
(`vi.spyOn(Node.prototype, 'clone')`) proving **ZERO calls** across three
pipelines — (a) a placement pipeline (translate mint + `placement-attach`), (b) a
component-resolution pipeline (def prototypes + seam fan-out), (c) a def-fill
pipeline (emit) — **plus a positive control** that applies an explicit
`clone-instance` handler op and asserts the spy's call count is **exactly** the
number of applied ops. **The positive control is mandatory**: without it the spy
row is vacuous (a never-installed/never-matching spy also reports zero). This is
§5's `P-IM-4` row, with its anti-vacuity clause.

### I5 — the clone census is a MEASUREMENT, not a constant · **DECIDED**

**Statement.** `PROFILE.cloneOps` must be **derived from the journal** — by
counting `clone-instance` entries — and never assigned a literal, and never
derived by an arithmetic identity. `cloneOps` is the census field whose whole
purpose is to be *evidence that no clone happened*; a hard-coded or
identity-derived value carries **no evidence** and cannot fail for the reason it
exists.

**Owning record.** `docs/specs/ops.md:88` (the rule the census is supposed to
measure); `docs/specs/placement-path-spec.md:639` (the census row: *"`cloneOps =
0` (F-1 …)"*); `docs/specs/ops.md` §2.6 step 4 (`placement-attach` dirties two
nodes — the op-stream basis for a measurement); the journal-read surface
**`Supervisor.journalEntries`** (`src/core/supervisor.ts:298-346`, DECIDED
ENG-JOURNAL-ENTRY-READ-API, `docs/specs/journal-read-access-review.md`,
`docs/decisions.md` JOURNAL-READ-API row) — the read accessor that makes a
journal-derived measurement possible **without** touching `sup.journal`
directly.

**The read accessor's exact shape (read this pass — cite it, do not guess).**

```ts
// src/core/supervisor.ts:124-131
export interface JournalViewOptions {
  afterIndex?: number   // absolute start override, clamped to [0, total]
  limit?: number        // window size, default 500, clamped [1, 1000]
}
// src/core/supervisor.ts:118-122  JournalEntryView = { index: number; kind: string; status: string }
// src/core/supervisor.ts:133-151  JournalView = { entries, fromIndex, totalEntries,
//   truncated, undoDepth, redoDepth, basePresent, undoBaseBoundary,
//   undoTopKind?, redoTopKind?, maxJournalLength? }
journalEntries(opts?: JournalViewOptions): JournalView   // :304
```

Two properties make it the right measurement instrument: it is **non-draining**
and read-only (*"never mutates, drains, awaits, or re-renders"*, `:301`), and it
**exposes `totalEntries` + `truncated`** (`:333`, `:329`) so a census can prove
its window covered the whole journal. `kind` is *"the coerced op-kind"*
(`:325` — `typeof e.op?.kind === 'string' ? e.op.kind : 'unknown'`), so a
`clone-instance` entry is counted as `kind === 'clone-instance'` exactly.

**The measurement rule (the contract the fix must satisfy).**

```
cloneOps = journalEntries({ afterIndex: 0, limit: MAX }).entries
             .filter(e => e.kind === 'clone-instance').length
```

with the guard that the window was complete: `view.truncated === false` **or**
`view.fromIndex === 0 && view.entries.length === view.totalEntries` — a truncated
window must **fail loudly**, never silently under-count (a silently truncated
census is the same defect class as a hard-coded one: it reports a number that is
not the journal's). `limit` is clamped to `[1, 1000]` (`:129-130`, `:310`), so a
page with more than 1000 entries must page (`afterIndex`) or assert the total is
within one window.

**Pre/post per page (the exact literals that must go).**

| Page | Today | Required |
| --- | --- | --- |
| `demo/path-fork-data.js` | `cloneOps: 0` **literal** in the server-data expectation (`:251`), a `cloneOps: 0` initialiser (`:303`), and the assertion block's closing assignment **`PROFILE.cloneOps = 0`** (`:382`) — the check at `:370` asserts the *census* pieces (registered/in-tree/unplaced/destroyed) and then **assigns the clone census as a constant** | derive from the journal; expected measured value **0** (no ops are applied at all on this page — the same check asserts `supervisor.journal.length === 0`, `:379`) |
| `demo/legacy-shape.js` | a `cloneOps: 0` initialiser (`:382`) and the closing assignment **`PROFILE.cloneOps = 0`** (`:777`), inside a check (`:765`) that separately asserts `supervisor.journal.length === 0` (`:776`) | derive from the journal; expected measured value **0** |
| `demo/fork-stress-data.js` | **arithmetic identity**: `PROFILE.cloneOps = PROFILE.registered - PROFILE.unplaced - 1 - prototypes.length` (`:620`, with the comment at `:608-614` claiming it *is* "the journaled clone-instance count") | derive from the journal; expected measured value = the page's **handler-driven** count (measured `2/14/62/254/510/1022/2046/4094` for depth 2..12, `2026-09-22-noclone-probe.md:53`), i.e. **the number legitimately reports non-zero** |

**Why the fork-stress case is the sharpest.** `scripts/demo-smoke.mjs:181-184`
asserts `prof.cloneOps !== prof.inTree - 1 - prototypes` — and the page computes
exactly that expression, so the guard is a **tautology**: it compares an
arithmetic identity against itself and can only fail on a floating-point or
typo-level mistake. The measurement fix turns that guard into a real comparison
(measured journal count vs the census field) while leaving the *bound* untouched.
**The point is not that the number is 0 — the point is that the number is
EVIDENCE either way**: 0 on the static/derived pages, 4094 on the runtime page,
and a *measured* 4094 is exactly as informative as a measured 0.

**Enforcement: LANDED 2026-09-22** (pre-landing state, retained for the record:
**none** — `tests/e2e/path-fork-e2e.test.ts:588-589`
(`const cloneOps = inTree - 1 - prototypes; expect(cloneOps).toBe(4094)`) repeated
the identity at test level and asserted nothing about the engine's op stream, and
`tests/blind/e2e-layer.test.ts:286-287`'s `cloneOps = 0` was a **comment**; no
test or page measured the op stream for this field). Closed by **§8.1 NC-1f /
NC-1f-prod / NC-1g** (empty-journal, `k > 0` positive and decoy arms; the
production page's published value against an independently derived count), the
page-side **P-TP-1p** independence case (every demo module derives `cloneOps`
from its journal **and** publishes a separately derived `measurement` with a
drift guard), and the **P-TP-1** / **P-TP-2** register rows (both `HELD`).

**Status + source.** **DECIDED** here, on the owning records above + the
harness-defect evidence (`docs/defects.md` **SMOKE-TRIPWIRE-INERT** — ✎ 2026-09-23 re-pointed BY NAME, now `:18`, the former `:15`; is the
same defect class: **a guard whose measurement was not the measurement it
claimed**). The fix is harness/demo-side and does **not** touch the engine.

---

## 4. The guard-ordering requirement (harness)

**The requirement.** *One guard per `process.exit`: no census or assertion may be
silently unreachable because an earlier guard exits.* Concretely: for every guard
`G` in `scripts/demo-smoke.mjs`, the reachability of `G` must not depend on an
earlier guard's **failure** — a census block that runs only when a *later-numbered*
check passes, in a script whose earlier check can exit, is a guard that **cannot
report**.

**The two instances.**

> **✎ SUPERSEDED-IN-PART 2026-09-23 (annotation only — the §4 CONTRACT below is
> unchanged; no requirement is edited):** the passages in this section that treat
> the **runtime 3× tripwire** as the guard that exits before the censuses, or as
> the user's outstanding bound decision, are **historical**. The user's
> 2026-09-23 guard ruling **RETIRED that cross-family assertion** (its operands
> are page totals over **different construction methods** — 23 real nodes / one
> bootstrap enumeration pass vs 4095 real nodes built incrementally) and replaced
> it with the runtime-vs-runtime **`runtime-fork-growth-guard**
> (`docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD, which supersedes
> RUNTIME-FORK-TRIPWIRE-BOUND)**; the cross-family ratio is now printed
> **INFORMATIONAL** only and `npm run demo:smoke` exits **0**. The §4 requirement
> this section establishes — **every guard must ENTER and REPORT, there is ONE
> aggregated exit, and deleting/weakening a guard or re-baselining a bound is NOT
> acceptable** — is **unchanged and still binding**. Where this section names
> `runtime-fork-tripwire`'s id, read the live id `runtime-fork-growth-guard`; the
> test-side re-point owed is filed as `docs/defects.md`
> **FORK-STRESS-TRIPWIRE-STALE-SPEC**.

1. **`assertLegacyShapeCensus` is unreachable on the current code.**
   The function is defined at `scripts/demo-smoke.mjs:449-510` and called at
   **`scripts/demo-smoke.mjs:537`** — but the **runtime 3× tripwire exits at
   `scripts/demo-smoke.mjs:395-397`** (`if (… runtimeDerivedRatio > 3) {
   console.error(…); process.exit(1) }`), which is **before** the legacy-shape
   page's block (`:511-538`) runs at all. With the tripwire RED by ruling
   (`docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND; the honest ratio is
   **9.45-10.50×** at d12, `docs/defects.md` **RUNTIME-FORK-PASS2-RATIO** (✎ 2026-09-23 re-pointed BY NAME — now `:19`, was `:16`), `2026-09-22-noclone-probe.md:183`),
   the legacy-shape census — `registered=17`, `inTree=14`, `prototypes=3`,
   `unplaced=0`, `destroyed=0`, **`cloneOps=0`**, `states=12`, `elements=16`,
   `passes=1`, `warningsMain=0`, `fanOut=2`, `stylesRules` — **never executes**.
   The census function's own first loop is the field-presence guard
   (`:450-455`), whose message (*"legacy-shape profile missing census field …
   D1–D8 census not published"*) is itself dead text: the failure it names
   cannot be reported.
2. **The already-fixed precedent: `SMOKE-TRIPWIRE-INERT`** (✎ 2026-09-23 re-pointed BY NAME — `docs/defects.md` **SMOKE-TRIPWIRE-INERT**, now `:18`, the former `:15`;
   FIXED 2026-09-22) — the same **class** of defect, one layer over: there the
   *guard ran* but its **measurement** read the wrong quantity
   (`d12Totals['placement']`, the placement-derived page's own total, i.e. a
   derived-vs-derived comparison ≈1.0× by construction). The repair reads the
   runtime page's total and **prints it every run**
   (`scripts/demo-smoke.mjs:377-398`). **The precedent's transferable lesson is
   the one this section generalises:** *a guard must be able both to RUN and to
   REPORT ITS MEASUREMENT.* A silently unreachable census fails the first half;
   a tautological assertion (I5, `:181-184`) fails the second.

**Acceptable fix shapes (the implementer chooses; the constraint is the point).**

| Shape | What it does | Note |
| --- | --- | --- |
| (a) **Run census blocks before tripwires** | reorder so every census/assertion block executes before any exit-capable tripwire | keeps "one guard per `process.exit`": an exit still ends the script, but no guard is *behind* it |
| (b) **Accumulate guard failures, report at the end** | replace immediate exits with failure accumulation + a single final report/exit code | changes the exit *aggregation*, not the bounds; must still exit non-zero if any guard failed |

**NOT acceptable:** deleting or weakening a guard to dodge unreachability;
suppressing a newly reachable failure; converting a failing guard into a warning;
re-baselining a bound (the 3× tripwire's bound is the **user's**,
`docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND).

**Acceptance criterion (binding, both halves).**

1. **Every guard that passes today must still run and still pass.** In the
   current RED-at-the-tripwire state that means: the census blocks of
   `legacy-shape` (including `assertLegacyShapeCensus`, `:449-510`/`:537`) and
   every other post-tripwire census must **execute** and report their outcome on
   each smoke run, whether or not the tripwire fires.
2. **A newly reachable FAILING guard is a FINDING, not a reason to reorder
   around it.** If running the census reveals that a pinned value
   (`registered=17`, `cloneOps=0`, …) no longer holds, that is a **real census
   drift** — file a `docs/defects.md` row and report it; do **not** move the
   guard, relax the expected value, or reorder to make it unreachable again.
   *(This is the §7 risk 2 stated as a criterion.)*

**Why this is in the no-clone unit at all.** Because the unreachable census
contains **the only component-family clone-census assertion in the harness**
(`cloneOps=0` over the legacy-shape page's 3 unresolved def prototypes +
seam-resolved subtree), i.e. the guard that would have caught I3's regression
class is the guard that cannot run. I3/I5's enforcement is incomplete while it
stays unreachable.

---

## 5. THE TYPED PROPERTY REGISTER (PBT gate deliverable)

**Rules applied** (identical to the sibling register at
`docs/specs/bodyruns-drop-diagnostics.md:722-740`, so the two are read the same
way): **≤ 8 rows**; kinds restricted to **`P-IM`** (invariant), **`P-SM`**
(state-machine / transition) and **`P-TP`** (transform / round-trip);
**no `F-` rows and no `§6`/`FS-n` numbered items** in the register; each row
carries an id, its kind, the property statement, the **strategy/generator the
TestWriter implements**, the **falsification condition** (what a counterexample
looks like), the **anti-vacuity clause** (how the row proves it was live — a
seventh column this register adds and §8.3 makes a reporting rule), and the
**contract clause(s) it pins**.

**Anti-vacuity is per-row and mandatory** (the discipline of
`docs/specs/bodyruns-drop-diagnostics.md` §8.3 `:1025-1036`): a row may be
reported `HELD` only when at least one of its falsification clauses was **live**
on the run, and **liveness must be CONSTRUCTED by the generator, never assumed**
(the F5 lesson: *"a generator whose liveness is probabilistic … does not satisfy
this rule"*). A row whose control cannot be built **throws**; it does not
degrade to silence.

| ID | Kind | Property statement | Strategy / generator (TestWriter implements) | Falsification condition (a counterexample looks like) | Anti-vacuity (how the row proves it was LIVE) | Pins |
| --- | --- | --- | --- | --- | --- | --- |
| **P-IM-1** | invariant | **A placement attaches the ORIGINAL node by link: zero node growth.** For every placement pipeline, `registered` (and the distinct node-identity count) is **unchanged** by the translate-side placement mint, by `placement-attach`, and by an **idempotent re-attach** (`placement-attach` applied twice with the same target/names); the placed node's `content` anchors and the container's `container` anchor for one zone share **ONE** `Link` object; every anchor `owner` is `===` the authored node. Includes the **two-zones case**: one placed node with two container names yields two `content` anchors (ordered), still growing the registry by **0** | Seeded generator: build an authored envelope whose tree is `n ∈ [2,6]` nodes, of which `p ∈ [1,n−1]` carry `placement: { targetPlacement: [z₁, …, z_k] }` with `k ∈ [1,3]` distinct zone names and `m ∈ [1,p]` carry `placementName: zᵢ` (so every requested zone has ≥ 1 producer for at least one attempt); translate once, then: record `registered` (via `allNodes().length`) and the per-zone `Link` object identity **before**; apply `{kind:'placement-attach', node, container, names:[…]}`; record **after**; apply the **same op again**; record again. Assert (i) `registered` identical at all three points; (ii) for each zone the `container` anchors of all producers are the **same** Link object (`===`) and the consumer's `content` anchor is that same object; (iii) re-attach is a no-op on `registered` **and** on the anchor multiplicity (`node.anchors.filter(a => a.role==='content').length` unchanged — the dedup keep-first). **Two-zones requirement:** at least one attempt must carry `k = 3`, and the row asserts `content` anchors are in **preference order** (`names` order) | a placement path constructs a node (any `registered` increase); two anchors of one zone on different Links; an anchor `owner` not `===` the authored node; a re-attach that adds a second `content` anchor for the same name (dedup broken); a `content` anchor order differing from `names` order | **the generator CONSTRUCTS the live candidate, never hopes for one:** every attempt must include (i) a node whose placement is applied at runtime (`placement-attach`) — so the op under test actually runs — and (ii) at least one attempt with `k = 3` and ≥ 2 producers sharing a zone, so the `Link`-identity comparison has ≥ 2 anchors to compare; the row asserts (ii) happened before reporting (`twoZoneAttempts ≥ 1`, `multiProducerAttempts ≥ 1`), and an attempt that cannot build the pair **throws** rather than passing hollow | **I1**; `ops.md:87-88`, `:102-109` (steps 1-3); `node.md:42-46` (SI-3); `translate.ts:1002-1044`; `ops.ts:125-145`; `supervisor.ts:1173-1196` |
| **P-IM-2** | invariant | **Distinct-`nodeId` invariance under path multiplicity — on the COMPONENT and FORK-ARM families, where no pin exists today.** For any input, the number of **distinct `nodeId`s** among compiled states is invariant under the number of valid paths to root, and every state's `nodeId` is the id of a node that exists in the registry; a component fork arm's element wire is `nodeId#<i>` over **one** node id (never a node per arm); a def-fill synthetic wire is an **element** wire, never a registry node id | Seeded generator, three arms, each measured twice: **(a) placement arm** — the static fork topology at **`d ∈ [3,6]`** (**✎ CORRECTED 2026-09-22: the floor was `d = 2`, where the row is VACUOUS** — at d=2 the static topology is 3 states / 3 distinct nodeIds ⇒ nodeRatio **1**, so "states strictly exceeds distinct nodeIds" cannot hold and the axis-separation liveness proof is unavailable; **d ≥ 3 is required for axis separation**, giving ratio 7/5 = 1.4 at d=3 and growing — **this anti-vacuity requirement is the reason for the floor, not a scope reduction**: the two axes are independent only where `2^d−1 > 2d−1`, i.e. exactly d ≥ 3) (the `2d−1` prototypes + root), asserting `distinct nodeId`s `=== 2d−1` while path-states `=== 2^d−1` — the **live control for the axis separation** (nodeRatio grows, node count does not); **(b) component arm** — one authored def value with `N ∈ [2,4]` consumers, asserting the def-root + def-children **registry ids are fixed** and that `distinct nodeId`s of the consumer states do not multiply with `N`; **(c) fork-arm arm** — one consumer with `k ∈ [2,4]` resolved component arms, asserting `distinct arm nodeId === 1`, the emitted wires are exactly `{nodeId + '#' + i | i < k}` and **no** arm wire is a member of `byId`. Also assert every state's `nodeId ∈ {registry ids}` after `compileAll` for each arm | a `nodeId` in a state that is not a registry id; `distinct nodeId`s growing with `d` or with `N` or with `k`; more than one distinct nodeId across one consumer's arms; an arm wire present in `byId`; `registered` rising across `compilePath` → `emitElements` | **the axis-separation control IS the liveness proof:** arm (a) asserts on every attempt that `states.length` **strictly exceeds** `distinct nodeId`s (the nodeRatio > 1 — measured up to **178×**, `2026-09-22-noclone-probe.md:48`) — **and on every attempt `d ≥ 3` (the ✎ CORRECTED 2026-09-22 floor: at d=2 the ratio is 1 and the control is vacuous; this floor is the ASSERTED form)** and arm (c) that `k ≥ 2` arms resolved (fewer than 2 arms makes "1 distinct nodeId" tautological and must **throw**); the row reports the observed ratio and arm counts, so a generator that degenerates to a single path/arm/consumer is visible and fails loudly | **I2**; `placement-path-spec.md:47`, `:65`, `:639`, `:1658`; `node.ts:133`, `:232-270`, `:1199`, `:1384-1418`; `render-helpers.ts:138-140`, `:608-610`, `:723`, `:1235` |
| **P-IM-3** | invariant | **A component is resolution + seam, never a copy: ONE prototype identity set per authored def value, shared across N consumers; and registry invariance across a full pass.** For one authored def value referenced by `N ∈ [2,4]` consumers: the def-root prototype is minted **once**, and **all N consumers' seam edges target the SAME def-root object** (`===`, not merely equal ids); a **full** resolution + emit pass (compile all consumers → `emitElements` → `diffMinimal` → `applyOps`) leaves **`registered` (registry size) and the def-prototype IDENTITY SET (the def-root/def-children object identities, `===`) unchanged — ✎ CORRECTED 2026-09-22 (executed by the TestWriter — NC-1d): the `'prototype'`-STATE count is NOT an asserted observable and is EXPECTED to change (measured 3 → 0, registry stays 7, no node created — the DEFECT #24 SEAM-RESOLVED CARRIERS realization, `docs/decisions.md:84`); see §3 I3's ✎ CORRECTED block**; each emitted def-fill synthetic wire is **not** a registry node id | Seeded generator: one envelope with one def value (`type` + css + 1-3 `children`) and `N ∈ [2,4]` consumers binding `{target: 'type'|'children', reference: defName}`. Snapshot `registered` (and the def-root/def-children **object identities**) after translate; compile every consumer; emit; diff; apply through a counting adapter. Assert (i) the def-root prototype count `=== 1` and def-children `=== def.children.length`; (ii) `Set(consumers.map(c => defRootTargetOf(c))).size === 1` — the seam targets are **object-identical**; (iii) `registered` **and the def-prototype identity set** identical before/after the full pass — a `'prototype'`-state-count clause is NOT asserted and must not be restored (the count legitimately moves on seam materialization); (iv) every def-fill synthetic wire (`<host>:<bind>` / `<host>:<index>`) is **absent** from the registry's id set, asserted only on attempts that actually emitted a def-fill (the generator must confirm a non-zero def-fill element count, or the check scans nothing) | a per-consumer mint (two distinct def-root ids across consumers); seam edges targeting different def-root objects with equal ids; either **`registered` rising across the pass** (a node minted) **or a def-prototype object identity changing** (a copy/re-mint); a synthetic def-fill wire appearing in `byId`; `N` collapsing to 1 (vacuity). **NOT a falsifier:** the `'prototype'`-state count moving 3 → 0 (measured, expected, contract-recorded) | **`N ≥ 2` and the seam edge count are asserted ON EVERY ATTEMPT before the identity clause is evaluated** (with `N = 1` the "shared by N consumers" clause is a tautology); the generator must **construct** the multi-consumer graph, not sample toward it — an attempt that cannot reach `N ≥ 2` **throws**; the row reports the observed `N` and the seam-edge count, and the synthetic-wire half is asserted only on attempts that actually emitted a def-fill (asserting the def-fill actually fired, so clause (iv) is not a vacuous scan of zero wires) | **I3**; `ops.md:88`, `:135`, `:143-144`, `:362` (G24); `translate.ts:815-872`; `registry.ts:181-194`; `node.ts:1690-1744`; `render-helpers.ts:1012-1080`, `:1372-1392` |
| **P-IM-4** | invariant | **`clone()` reachability containment: ZERO clone calls on every non-handler pipeline, and exactly the expected count on the handler route.** A spy on `Node.prototype.clone` records **0** calls across (a) a placement pipeline (translate mint + `placement-attach`), (b) a component-resolution pipeline (def prototypes + seam fan-out over `N ≥ 2` consumers), and (c) a def-fill pipeline (compile + emit); and records **exactly** `ops` calls for `ops ∈ [1,3]` explicitly applied `{kind:'clone-instance'}` handler ops | Install the spy (`vi.spyOn(Node.prototype, 'clone')`) **before** the first pipeline, restore after. Run each of the three pipelines on a fresh seeded graph and assert `spy.mock.calls.length === 0` **at each stage boundary** (not only at the end, so a pipeline that calls `clone` and then discards the copy is still caught). Then, **in the same test, on a fresh graph**, apply `ops` explicit `clone-instance` ops through `supervisor.apply` (source + slot) and assert `spy.mock.calls.length === ops`, and that each returned copy has `runtimeMinted === true` (the control lives in the SAME test body, per the Anti-vacuity column) | any `clone` call on pipeline (a)/(b)/(c); the control's count ≠ `ops` (an over- or under-firing spy, or a `clone-instance` that silently no-ops); `runtimeMinted` false on a copy; a control count of 0 (the spy never matched — the row must report `UNDETERMINED`, never `HELD`, per §8.3 `bodyruns-drop-diagnostics.md:989-991`) | **the positive control is the liveness proof and is MANDATORY IN THE SAME TEST BODY, asserted BEFORE the row's status is reported:** `spy.mock.calls.length === ops` on the handler arm, each copy `runtimeMinted === true`, and `spy.mock.calls.every(c => c[0] instanceof Node)`. **A control count of 0 proves the spy never matched and the row MUST report `UNDETERMINED`** — a zero-only row (no control) is forbidden, because "no clone happened" and "the spy is broken" are indistinguishable without it | **I4**; `ops.md:87-88`; `pipeline.ts:79`; `pipeline.md:68`; `ops.ts:647-652`; `supervisor.ts:1233-1269`; `node.ts:790-846` |
| **P-TP-1** | transform / round-trip | **The clone census is JOURNAL-DERIVED and matches the observed op stream.** For any op stream, the census value is **equal to** the count of `clone-instance` entries in `Supervisor.journalEntries()` — i.e. it is re-derivable from the journal and falsifiable by an input that emits a `clone-instance`: an op stream with `k` handler `clone-instance` ops reports `cloneOps === k` (**including `k > 0`**), and an op stream with none reports `0` even when the graph grew by other minting routes (`layer-apply`, `rows-mint`) | Two arms. **(a) zero arm:** build a graph via translate + a static path compile (no ops applied), assert `journalEntries(...).entries.filter(kind==='clone-instance').length === 0` **and** that the census function under test returns `0` — with the **journal proven empty** (`totalEntries === 0`). **(b) positive arm (the falsifier):** apply `k ∈ [1,3]` explicit `clone-instance` ops, then assert the measured census `=== k`, `=== ` the journal count, and `!== 0`. **(c) decoy arm:** apply a `layer-apply` and a `rows-mint` (both legitimate node-minting routes that are **not** clone-instance) and assert the measured census is still `0` — the count must not be derived from node growth of any kind. Assert `view.truncated === false && view.fromIndex === 0 && view.entries.length === view.totalEntries` on every measurement (the window-completeness guard, §3 I5) | a census that reports `0` while the journal holds a `clone-instance` entry; a census that reports `k` for the **decoy** arm (arithmetic-identity derivation: `registered − unplaced − 1 − prototypes` counts *any* mint); a truncated window silently under-counting; a census that cannot be computed from `journalEntries` at all (**it is a constant** — the arm that must go red) | **the POSITIVE arm is the liveness proof and is mandatory** (`k ≥ 1` applied `clone-instance` ops ⇒ a `0` reading fails); the zero arm alone is satisfiable by a constant and therefore **may not be reported as `HELD` on its own**; the decoy arm is asserted to have **actually grown the registry** (so "0 despite node growth" is a live statement, not a scan of nothing); and every measurement asserts the window-completeness fields, so a truncated read cannot pass silently | **I5**; `ops.md:88`; `placement-path-spec.md:639`; `supervisor.ts:118-151`, `:298-346`; `demo/path-fork-data.js:251/303/382`; `demo/legacy-shape.js:382/777`; `demo/fork-stress-data.js:612-620`; `demo-smoke.mjs:181-184` |
| **P-SM-1** | state-machine / transition | **Guard reachability: every census guard RUNS, and a passing guard's measurement is REPORTED, regardless of an earlier exit-capable guard's outcome.** For the smoke's guard set, the reachable-execution sequence is: each census/assertion guard executes **and** prints its measurement **before** the run ends — i.e. no guard's execution depends on a *later* check passing, and the exit code aggregates failures rather than pre-empting unreached guards | A **harness-level** row (not a `src/` row): drive the guard sequence in a controlled way — (i) a **registry test** asserting each guard id is entered (an ordered "entered-guards" log the harness records, or an equivalent injection seam), including the legacy-shape census guard; (ii) a **fault-injection control**: force an early exit-capable guard to fail (e.g. a synthetic tripwire input) and assert the later census guards **still enter**; (iii) for the `cloneOps` guards, assert the *printed* measurement matches the journal-derived count (§3 I5); the ordered entry log and the injected failure are both asserted per the Anti-vacuity column | a guard absent from the entered-log; the census guard's entry conditional on the tripwire's outcome; a guard that runs but prints no measurement (the `SMOKE-TRIPWIRE-INERT` half: it ran, its number was not the number it claimed); a "run" whose only evidence is the absence of an error | **the entered-guard log must be asserted NON-EMPTY and must contain a guard positioned AFTER today's tripwire** (`demo-smoke.mjs:395-397`) — otherwise "all guards ran" is satisfied by a log that records only the guards that always ran; the fault-injection arm must show the injected guard **failing** in the same log (a control that does not fail proves no injection happened) | **§4**; `demo-smoke.mjs:377-398` (the tripwire), `:449-510`/`:537` (the unreachable census), `:160-189` (the tautological cloneOps guard); `docs/defects.md` **SMOKE-TRIPWIRE-INERT** (✎ 2026-09-23 re-pointed BY NAME — now `:18`, the former `:15`), the precedent) |
| **P-TP-2** | transform / round-trip | **Placement multiplicity is expressed as WIRE multiplicity, not node multiplicity: the static (placement-derived) and runtime (handler-driven) expressions agree on `states`/`elements` and differ by the sanctioned clone count PLUS the structural `(2d − 2)` term — ✎ CORRECTED 2026-09-22 (executed by the TestWriter — P-TP-2); this corrected form is the ASSERTED one.** For the same fork topology, the static expression reports `registered = 2d−1`, `states = elements = 2^d−1`, `cloneOps = 0`, and the runtime handler-driven expression reports `registered = 2^d−1 + 2(d−1) prototypes + cloneOps` with `cloneOps` **measured from the journal** — both derivable from the same topology. **The cross-expression relation is: `runtimeRegistered − staticRegistered = clones + prototypes − (2d − 2)`.** (The previously spec'd form — `runtimeRegistered − staticRegistered === clones + prototypes` — is **FALSE as literally written** for every d ≥ 2 (✎ CORRECTED 2026-09-22 — the earlier "every d ≥ 3" and "except at d ≥ 12" wordings were BOTH wrong; the old form is true only at the degenerate d = 1; see the calibration amendment row in §8.6): measured d=2 → `2 = 2 + 2 − 2`; d=3 → `6 = 6 + 4 − 4`; d=4 → `14 = 14 + 6 − 6`; the probe's d=12 → `4094 = 4094 + 22 − 22` (false there too).) **The `(2d − 2)` term is a STRUCTURAL term, mechanism CONFIRMED from code+docs:** the runtime family's `2(d−1)` prototypes **are** `2d − 2` — they are the same quantity, so the corrected relation is the arithmetic identity `runtimeRegistered = 1 + prototypes + clones` that the runtime family satisfies by construction. **Mechanism:** the runtime envelope mints **two contentNodes-owned prototype nodes per layer 1..depth−1** (`demo/fork-stress-data.js:90-135`, the `for layer … for slot of ['a','b']` loop; `depth−1` layers × 2 slots = `2(d−1)` = `2d − 2` prototypes, registered at `demo/fork-stress-data.js:188` + `:193`) and then builds the tree by **`clone-instance` only** — one expand body issuing two ops per non-leaf (`demo/fork-stress-data.js:251-254`, `source: protoByKey.get('<layer+1>:<slot>')`), so at depth d exactly **`2^d − 2` clones** are applied and `registered = 1 + (2d − 2) + (2^d − 2)`. Rearranged: `registered = (2d−2) + clones + prototypes` (since `clones = 2^d − 2`). The static expression instead **IS** its own node population — `registered = 2d−1`, 1 root + `2(d−1)` per-layer nodes, no prototype population (`demo/path-fork-data.js:19` *"2·(depth−1) prototypes, 2·depth−1 graph nodes — the R2.2"*, re-asserted at `:80-82`, `:247`, `:290`; the family pins `docs/specs/derived-fork-variants-review.md:182` `registered=23 / cloneOps=0` at d12 = `2·12−1`, and `scripts/demo-smoke.mjs:161` computes the runtime's prototype count as exactly `2 * (depth - 1)`). **So the two expressions differ by the handler-applied clones AND by the runtime's prototype population — the prototype term is carried on BOTH sides and cancels algebraically, leaving the difference `clones + prototypes − (2d − 2)`; the "`(2d − 1)` shape" in the old statement was the STATIC page's own node count, not a term of the runtime expression.** The relation is **CORRECTED and CONFIRMED**; if a future reader finds the mechanism diverging from this construction, the relation stands as MEASURED and the mechanism is to be re-derived, never guessed | Compute both arms from one topology descriptor at `d ∈ [2,4]`: the static arm from a `compileAll` over the placement topology (no ops), the runtime arm by translating the prototype set (registering it, as `demo/fork-stress-data.js:186-198` does) and applying the handler expansion (`clone-instance` per expand, `demo/fork-stress-data.js:251-254`) — core-only, no page code. Assert for each arm: `states === elements === 2^d−1`; the static arm's `cloneOps === 0` from a **proven-empty journal**; the runtime arm's `cloneOps === ` its journal's `clone-instance` count (and `> 0`); and that the two arms' `states`/`elements` are **equal** while `registered` differs by **exactly** `measured clones + prototype count − (2d − 2)`. **Anti-vacuity:** assert the runtime arm's measured count is `> 0` (a zero would make the difference clause vacuous) **and** the static arm's journal is empty | the two arms disagreeing on `states`/`elements` (placement multiplicity leaked into node multiplicity); the runtime arm's difference from the static census not equal to `measured clones + prototypes − (2d − 2)`; a runtime arm reporting `0` clones while the journal holds `clone-instance` entries; a static arm whose journal is non-empty | **the runtime arm's measured count must be `> 0`** (a zero makes the "differ exactly by measured clones" clause vacuous — the generator must construct an expansion that actually clones, and **throw** if it cannot) **and** the static arm's journal must be **proven empty**; additionally the decoy-free claim requires the two arms to be built from the **same topology descriptor** (asserted: identical per-level prototype counts), so an accidental topology mismatch cannot be read as an invariant violation | **I2**, **I5** (cross-expression); `placement-path-spec.md:639`; `2026-09-22-noclone-probe.md:48`, `:53`, `:188-193`; `demo/fork-stress-data.js:240-255`, `:608-620`; `demo-smoke.mjs:160-189` |

**Omissions (required one-line note per candidate row judged over-strength or
already covered):**

1. **No row asserts an exact `cloneOps` literal for the fork-stress fixture
   family.** The measured count (`2/14/…/4094`) is the **sanctioned handler use**
   (§2.2 row 2); a literal would forbid a legitimate fixture change and a `0`
   would forbid the mechanism the rule reserves. **Covered instead by P-TP-2**,
   which asserts the *relationship* (runtime count = measured journal count;
   runtime − static = measured clones + prototypes − (2d − 2), the ✎ CORRECTED
   2026-09-22 relation — the `(2d − 2)` term is the runtime family's prototype
   population), never a fixed number.
2. **No row asserts that an "N consumers of def A **while def B is also
   referenced**" graph keeps one identity set per consumer.** Would be
   over-strength as a *generator shape* (it makes the per-attempt identity
   comparison ambiguous across two defs whose sharing must be tracked
   separately) and adds no falsification power for the per-consumer-mint class.
   The second def belongs in **P-IM-3's decoy-style extension** (assert it is
   tracked *separately*), not as a co-referenced second def inside the same
   attempt. **Omitted as a row.**
3. **No row asserts `clone()`'s internals** (what it copies, layer/ignore
   semantics, the name-keyed Link reuse, the `runtimeMinted` marking beyond
   P-IM-4's single flag assertion). Already owned and pinned elsewhere
   (`tests/unit/node.test.ts:269-318` M-6/M-7/M-8; `tests/unit/validation.test.ts:528-560`;
   `tests/unit/hooks.test.ts:388-410`) — a second home would be a contract
   duplicate (AGENTS.md item 6). **Omitted as a row.**
4. **No row asserts that an arm wire `nodeId#<i>` is absent from `byId`
   *as a standalone contract*** — **unless** the contract that requires it is
   cited: the arm wire is an **element identity** by construction
   (`render-helpers.ts:1235`; `node.ts:1287-1292` pins *"fork arms stay distinct
   (wire, forkKey) entries at the adapter boundary"*, `2026-09-22-noclone-history.md:214-218`),
   and the emit-side synthetic-wire rule is explicit (`render.md:224` DFC-1:
   *"emit-time only, the graph children stay empty"*). **P-IM-2(c) therefore
   asserts it only for the arm wires it actually emits and observes** — not as a
   general contract over every `#`-bearing string (a `#`-bearing **node id** is a
   legal host-supplied id: `docs/decisions.md` EVENT-DISPATCH-WIRING's wire
   resolution requires a full-string `nodes.get` lookup *first* precisely because
   a `#`-bearing nodeId exists). **Omitted as a general row.**
5. **No row asserts a global "no clone anywhere" negative over the whole suite**
   (e.g. spying on `clone` for the entire test file). A process-level spy would
   be satisfied by *any* later legitimate handler clone in the same file, and
   such a row cannot distinguish the sanctioned route from a leak — the exact
   failure mode `bodyruns-drop-diagnostics.md`'s H1/H2 invariants warn about
   (`:1048-1073`). Containment is asserted **per pipeline** in P-IM-4.
6. **No row covers a guard's *bound decisions*** (whether 3× is the right
   tripwire bound, whether `registered=17` is the right legacy-shape census). A
   bound is a **user/supervisor decision** (`docs/decisions.md`
   RUNTIME-FORK-TRIPWIRE-BOUND), not a property of the code — asserting it would
   encode a ruling as an invariant. §4 asserts **reachability and reporting**,
   never the bound.
7. **No separate row for the def-fill synthetic-wire round-trip.** The check
   ("a synthetic wire is an element wire, never a registry node id") is asserted
   **inside P-IM-3(iv)** rather than as its own row: it is the same
   construction-path family (the fill is element-level, per emitting host —
   `2026-09-22-noclone-probe.md:50-51`), and a separate row would state the same
   falsifier against the same code site at the cost of a register slot. **Merged,
   not omitted** — a TestWriter who splits it into its own `P-TP` row weakens the
   ≤ 8-row budget rule for no gain.

**Register count and expected statuses (report them explicitly).** The register
holds **seven rows** (one `P-SM`, two `P-TP`, four `P-IM`) — inside the ≤ 8-row
budget. **✎ LANDED 2026-09-22 — the pre-landing expectation was: `P-IM-1`,
`P-IM-2`, `P-IM-3`, `P-IM-4` and `P-TP-2` expected `HELD`, with `P-TP-1` and
`P-SM-1` `EXPECTED-RED` until the harness pass landed (`P-TP-1`'s page-side half:
three demo modules published a literal/identity-derived `cloneOps`; `P-SM-1`: the
legacy-shape census guard was unreachable behind the tripwire's `process.exit`).
**The executed result is all SEVEN `HELD`** — as required by the unit's own
contract, `HELD` is claimed only where the row's falsification clause was live
(the §8.4 rule), and no row reports `UNDETERMINED`. Attributions: the register
report (seed `20260922`, **362 attempts ≤ the 400 budget** — the six engine-side
rows at ≤ 60 attempts each plus P-SM-1's 4-arm allowance) is **measured by the
supervisor 2026-09-22** and asserted case-by-case in the two landed files
(`tests/unit/no-clone-invariants.test.ts`'s register-report case + the P-SM-1
case in `tests/unit/no-clone-guards.test.ts`), which this doc-review pass read.
Both rows' statuses are recorded with the clause they waited on — **`P-SM-1`
waited on §4, `P-TP-1` waited on §3 I5** — never folded into the held set
silently. `P-TP-1`'s **engine-side** half was assertable from the start (a
journal-derived count is computable from `journalEntries`); its red was always
specifically the **page/census** half.

---

## 6. Fail-states and what is NOT asserted

The assertions **deliberately omitted**, each with the contract that would be
required to add it.

| # | Not asserted | Why not (and what would be required) |
| --- | --- | --- |
| 1 | That an arm wire `nodeId#<i>` is absent from `byId` **in general** | No contract requires it as a general rule: the arm wire is an **element** identity (`render-helpers.ts:1235`) and a `#`-bearing **node id** is legal host data (EVENT-DISPATCH-WIRING's full-string `nodes.get`-first rule exists for exactly that). Only the wires an attempt actually emits are asserted (P-IM-2(c)); adding the general form needs a contract that forbids `#` in node ids — **none exists** |
| 2 | `clone()`'s internals (layer copy set, `ignore` semantics, name-keyed Link reuse, provider-value carry, the `runtimeMinted` marking beyond one flag) | Owned and already pinned: `tests/unit/node.test.ts:269-318`, `tests/unit/validation.test.ts:528-560`, `tests/unit/hooks.test.ts:388-410`, `tests/unit/legacy-shape-ops.test.ts:254-330`. A second home duplicates a contract (AGENTS.md item 6) |
| 3 | `clone()` **throws** on a destroyed source (`node.ts:791`) | Already pinned (`tests/unit/node.test.ts:312-318`, `:802`) — and it is `clone()`-semantics, not reachability |
| 4 | An **exact** `cloneOps` value for any runtime/fork-stress page | The count is the sanctioned handler use and is legitimately a function of fixture depth (`2026-09-22-noclone-probe.md:53`); a literal forbids fixture change. Asserted **relationally** (P-TP-2) |
| 5 | That a def referenced by N consumers is **rendered** N times (element/wire multiplicity) | Element multiplicity is owned by the emit contract (`render.md` DFC-1, `placement-path-spec.md:639` `elements=4095`); this unit's concern is that the *node* identity is one. Asserting the element count here would re-home another contract |
| 6 | That `registered` is **globally** unchanged across an entire test **file** | The registry is module-level and the suites share a process; a file-level absolute count is not a property of the code (the same reasoning as `bodyruns-drop-diagnostics.md:754`'s omitted whole-graph absolute warn total). Every row measures a **delta** or a **distinct-set size** on its own graph |
| 7 | That a `placement-attach` op that **rejects** (e.g. `unknown-node`, `link-config`) leaves the registry unchanged | It does, but the rejection shape is owned by `api.md`/`ops.md` §2.6's op-rejection contract, and asserting it here would couple this unit to the rejection catalogue. The **success** path is what I1 constrains; a rejection is not an attach |
| 8 | That the harness's `PROFILE` census fields are **complete** (all 12 published) | That is `assertLegacyShapeCensus`'s own first loop (`demo-smoke.mjs:450-455`) — §4's unit asserts only that the loop **runs** (P-SM-1); the field list itself is the legacy-shape page's contract |
| 9 | Any **`process.exit` count or ordering** as a literal | §4 constrains *reachability and reporting*, not the exit mechanism: shape (a) and shape (b) produce different exit counts, both acceptable. Asserting a count would pick the implementer's design (forbidden by the brief) |
| 10 | That the no-clone invariant holds for the **handler** routes (`layer-apply`, `rows-mint`, `clone-instance`) | Those **are** handler logic and *do* mint nodes by design (`ops.md:88`; `2026-09-22-noclone-probe.md:53` `new Node` census sites 3-6). The invariant's scope is placement/component; asserting it handler-wide would encode a rule that does not exist |

---

## 7. Risks / cost

| # | Risk | Why it is real | Mitigation in this contract |
| --- | --- | --- | --- |
| 1 | **The enforcement test's generator is too weak to catch the regression class it exists for** — the row goes GREEN forever because its inputs never produce the counterexample | This is the **documented failure mode of this repo's registers**: `bodyruns-drop-diagnostics.md` paid for it **four times** (ORACLE-1's generator threw before any emit; ORACLE-2's clauses held vacuously with no diagnostic layer present; ORACLE-3 demanded a warn where no duplicate existed; ORACLE-4 demanded a warn the contract forbids — `docs/specs/bodyruns-drop-diagnostics.md:807-826`, `:1223-1242`), and its AM-2/F5 corrections exist solely because a row reported `HELD` while retiring nothing (`:157`, `:161`, `:1031-1036`) | **Every §5 row carries an Anti-vacuity clause naming the positive control its generator must CONSTRUCT and assert**, and §8.3 makes liveness a **reporting rule** (`HELD` requires ≥1 live clause, else `UNDETERMINED`). **Per-row counterexamples the generator must be able to produce:** **P-IM-1** — an input where the same zone's anchors land on two Links, or a re-attach doubles the `content` anchor; **P-IM-2** — an input at the largest `d`/`N`/`k` the generator reaches where a per-path/per-consumer/per-arm mint would show (the arm's own `distinct nodeId` must be asserted `=== 1`, and the nodeRatio grows while the node count does not); **P-IM-3** — an input with `N ≥ 2` where a per-consumer mint would produce two def-root ids (the `distinct seam-target identity === 1` assertion is the falsifier), plus the **synthetic-wire-in-`byId`** check (a regression that registers a def-fill wire); **P-IM-4** — the **same test body** must show the spy firing (`=== ops`) on the handler control, because a spy that cannot fire cannot fail; **P-TP-1** — the **positive arm** (`k ∈ [1,3]`) is the falsifier, and it must be present, since the zero arm alone is satisfiable by a constant; **P-TP-2** — the runtime arm must report `> 0` measured clones, else the "differ only by measured clones" clause is vacuous. **A row that cannot produce its counterexample fails loudly (throws) instead of reporting `HELD`** |
| 2 | **The guard-ordering change exposes a legitimately-failing guard** — running the previously unreachable census reveals drift that nobody had to see before | The census it hides is over a *moving* page (the legacy-shape fixture and the def-prototype mechanism have both changed since the census was pinned: `registered=17`/`prototypes=3`/`inTree=14` carry DEFECT #24 dependencies, `demo-smoke.mjs:460-467`) | **§4's acceptance criterion 2, stated as a rule: a newly reachable failing guard is a FINDING to FILE (a `docs/defects.md` row + a report), NOT a reason to reorder around it, relax it, or suppress it.** The unit's deliverable on that outcome is the row + the report, never a green |
| 3 | **The git-level provenance is VERIFIED; what remains unverified is narrower** (the §0.2 block) | **MEASURED 2026-09-22 by the supervisor** (§0.2 F1-F9): the rule has one revision (`6d0a2ec`), the nine following `ops.md` commits touch no rule clause, the clone-based placement path was removed at `5e8be50` (107 files, +11526/−658), `translate.ts` never mentioned `clone-instance` in any revision checked, and no post-rule commit introduces a placement/component-reachable `clone()` site. **Not settled:** per-commit *dates* other than the two named (`5e8be50` 2026-08-14, `6d0a2ec` the strike), and the working-tree `git diff` for the files uncommitted at the time of the history pass (`2026-09-22-noclone-history.md:451-452`) | Neither residue is load-bearing: **every mechanical claim in §3 is a working-tree `file:line` this pass read**, every enforcement oracle is a **current-code** fact, and §0.2's F-rows are **provenance / non-regression evidence only** — they are never the reason a §8 case passes (§0.2 "How these facts are used"). The history report's unrun git kit (`:447-476`) is superseded, not pending |
| 4 | **The measurement fix's own correctness** — a journal-derived `cloneOps` could under-count on a page whose journal exceeds one window or whose entries were condensed | `journalEntries`' `limit` clamps to `[1,1000]` (`supervisor.ts:129-130`) and a condensed journal carries a `base` marker (which is **not** a `clone-instance` entry) | The measurement rule (§3 I5) **requires the window-completeness guard** (`truncated === false` or `fromIndex === 0 && entries.length === totalEntries`) and a **loud failure**, never a silent under-count; P-TP-1 asserts the guard on every measurement |
| 5 | **Cost** | Two new test files, 7 register rows with generators, one guard-ordering change in one harness file + a measurement change in three demo modules | Bounded and test-side/harness-side only: **no `src/**` change, no adapter change, no public-surface change, no version bump** (§2.2 row 1, §1). The only files touched outside `tests/`: `scripts/demo-smoke.mjs`, `demo/path-fork-data.js`, `demo/legacy-shape.js`, `demo/fork-stress-data.js` — and **no guard bound is altered in any of them** |
| 6 | **Reordering the smoke's exits could mask a genuine tripwire failure in CI** | A reorder that runs censuses first, then exits, changes *when* a failure is reported, and an implementation that swallows exit codes would let a RED smoke read as GREEN | §4's **acceptance criterion 1** (every guard that passes today still runs and still passes) + the explicit NOT-acceptable list (no weakening, no suppression, no re-baselining) + the requirement that the aggregate still exits non-zero if any guard failed |

### 7.1 Open questions (exactly these TWO remain open — both open BY DESIGN)

| # | Open question | Why it is still open (and what closes it) |
| --- | --- | --- |
| **Q-1** | **Which §4 fix SHAPE the harness pass lands — shape (a) *run census blocks before tripwires*, or shape (b) *accumulate guard failures and report at the end*** | The brief explicitly leaves the implementer the choice; §4 states the binding constraint (one guard per `process.exit` / no guard behind an exit) and both shapes satisfy it. §6 row 9 forbids asserting an exit count or ordering precisely because the shape is undecided. **Closed by:** the harness-fix pass choosing a shape, the §4 acceptance criteria holding either way, and the landing pass recording the choice in its `docs/decisions.md` row (§9) |
| **Q-2** | **Whether the clone-census MEASUREMENT lives in the demo PAGES or in the harness** — i.e. each page derives `PROFILE.cloneOps` from its own supervisor's `journalEntries()`, or `scripts/demo-smoke.mjs` derives it from the page's published journal/profile | §3 I5 fixes the *rule* (journal-derived, never a literal, never an arithmetic identity) and §8.3 fixes the *acceptance criterion* (the published value equals the journal count), but not **where** the derivation executes: a page-side derivation needs each page to expose the read accessor's input, a harness-side one needs a published op-stream/provenance field. §8.3's acceptance criterion is written to hold **either way**, which is why the question is still open. **Closed by:** the harness/demo pass choosing the home and the landing pass recording it; either home must satisfy §3 I5's window-completeness guard (loud failure on a truncated window) and P-TP-1's decoy arm |

**Recorded as CLOSED by the 2026-09-22 supervisor resolutions (not open):** the
approval-audit report's path (**RESOLVED 1 — ✎ CORRECTED 2026-09-22: the report
was received in context and NEVER PERSISTED; the trail is cited to
`2026-09-22-noclone-history.md:331-353`, so the "resolve the path" question is
closed by SUBSTITUTION, not by a found file** — the earlier "RESOLVED 1" text
that called the path a live artifact is **withdrawn**; see the provenance block
and §9), and the git-level provenance of the `6d0a2ec` / `5e8be50` facts
(the provenance block's **"RESOLVED 2"** + §0.2 F1-F9) — which is unaffected by
the correction (it rests on executed commands, not on the unpersisted report).
The **`ops.md` §2.4
wording narrowing** is **not** an open question but a **RECOMMENDATION requiring
a user/gate decision** (§0.3) — it changes no contract either way.

---

## 8. Test contracts

**No implementation change may be made in this pass** (AGENTS.md item 8a: red
first, and here the "implementation" is intentionally a **no-op** — see §1/§2.2
row 1). The TestWriter owns the test files; the harness/demo owner owns
`scripts/demo-smoke.mjs` + the three demo modules. **All cases below were
expected GREEN on the current code**: they are **regression guards encoding a
holding invariant**, not a red set — **plus five harness/demo-coupled cases whose
expected status awaited the harness pass** (NC-2a, NC-2b, NC-2c, NC-2d and the
P-SM-1 row; the spec labels NC-2a/NC-2b explicitly "RED today" — and the
TestWriter **did** land them RED against the pre-fix harness — while NC-2c/NC-2d
are labelled "GREEN after the §3 I5 fix": the unit's 5-case pending set). **✎ LANDED
2026-09-22: all of them are GREEN now** — the harness/demo fixes (§4 guard
ordering, §3 I5 measurement) have landed, and the "RED today / GREEN after …
lands" wording on those rows below is retained as the **historical pre-fix
state** (annotated per row, nothing deleted). **Measured by the supervisor
2026-09-22: `npm test` = 1362 passed / 0 failed (78 files).**

**✎ CORRECTED 2026-09-22 (executed by the TestWriter — NC-1d & P-TP-2): the
corrected forms below are the ASSERTED ones.** (1) **NC-1d(iii)** — the
`'prototype'`-STATE count is **never** asserted invariant (it is expected to move,
measured **3 → 0**, on seam materialization); assert **registry size**
(`allNodes().length`) and the **def-prototype object identity set** instead (the
mechanism is in §3 I3's ✎ CORRECTED block; `docs/decisions.md:84`
SEAM-RESOLVED CARRIERS + `docs/specs/ops.md:361-365` G23-G27). (2) **NC-1g(iv)** —
the cross-expression relation is
`runtimeRegistered − staticRegistered = clones + prototypes − (2d − 2)`, never
the `clones + prototypes` form (§5 P-TP-2). Two further amendments from the same
executed pass: **NC-1a**'s generator must **guarantee ≥ 1 producer and ≥ 1
consumer** (so the two-zone clause is always live), and **P-IM-2**'s placement
arm starts at **`d ≥ 3`** (d = 2 is vacuous — nodeRatio 1). The four log rows
are in §8.6. **Note the two counts the register names are not the same
quantity:** `registered`/registry size = **nodes** in the registry
(`allNodes().length`); the `'prototype'`-state count = **derived `NodeState`s**.
Only the former is invariant.

### 8.1 Unit NC-1 — the invariant suite (`tests/unit/no-clone-invariants.test.ts`, NEW)

Harness: the core barrel (`dist/core/*` under vitest, the repo's existing test
import pattern), `translateLegacy`, `Supervisor`/`createClient`, `emitElements`,
`diffMinimal`, `applyOps`, `allNodes()`, `journalEntries()`, a counting adapter,
and `vi.spyOn` for the clone spy.

| Case | Input shape | Exact observable | Expected status |
| --- | --- | --- | --- |
| **NC-1a — I1 placement attaches by link, zero growth** | 4 authored nodes (`root` + 2 zone producers + 1 consumer with `targetPlacement: ['zone-a','zone-b']`) | (i) translate → `allNodes()` has the authored count, `nodes[]` length equals the authored count; (ii) the two producers' `container` anchors for `zone-a` are the **same Link object**; the consumer's `content` anchor for `zone-a` is that same object; (iii) `apply({kind:'placement-attach', node, container, names:['zone-a','zone-b']})` → `status:'applied'` and `allNodes().length` **unchanged**; (iv) the `content` anchors are in `names` order; (v) a **second identical** `placement-attach` leaves both the count and the `content` anchor multiplicity unchanged (idempotent re-attach). **Generator REQUIREMENT (row requirement, implemented by the TestWriter 2026-09-22):** the generator must **guarantee ≥ 1 producer and ≥ 1 consumer** carrying the zone names on every attempt, so the two-zone clause is **always live** — a zone with no producer, or a consumer naming no zone, makes the shared-Link clause vacuous (it would compare nothing) and the attempt must **throw**, never pass silently | **GREEN** |
| **NC-1b — I2 one node, many paths** | the static fork topology at `d = 6` (11 prototypes + root) | (i) `distinct nodeId` over compiled states `=== 11`; (ii) `states.length === 63`; (iii) every `state.nodeId` is a member of the translated id set; (iv) `allNodes().length` identical after `compilePath`, after `emitElements`, after `diffMinimal` | **GREEN** |
| **NC-1c — I2 fork arm is a wire, not a node** | one consumer with 2 resolved component arms | (i) `distinct nodeId` across the arm states `=== 1`; (ii) the emitted element wires are exactly `cons#0`, `cons#1`; (iii) neither arm wire is a member of the registry's id set; (iv) `allNodes().length` unchanged | **GREEN** |
| **NC-1d — I3 components share one identity set** | one def value (`type` + css + 2 children) with **3** consumers | (i) def-root prototypes `=== 1`, def-child prototypes `=== 2`; (ii) **all three** consumers' seam edges target the **same** def-root object (`===`, `distinct === 1` over 3 edges); (iii) **the ASSERTED invariants across `compileAll` → `emitElements` → `diffMinimal` → `applyOps` — ✎ CORRECTED 2026-09-22 (executed by the TestWriter — NC-1d) — are the phase-INDEPENDENT ones: `allNodes().length` (registry size) is identical, and the def-prototype **identity set** (the def-root/def-children **object identities**, `===`) is identical.** The `'prototype'`-state count is **NOT** asserted invariant: on seam materialization it is **EXPECTED to change — measured 3 → 0** (registry stays **7**, **no node created**) because the def-root's family parent edge becomes a **seam** edge (`node.ts:1699-1706`, `:508-520`) — the `DEFECT #24` **SEAM-RESOLVED CARRIERS** realization (`docs/decisions.md:84`; `docs/specs/ops.md` §7 **G23-G27**, `:361-365`), the resolution-layer complement to AUTH-SEAM. A test that pins the count either way is WRONG (see §3 I3's ✎ CORRECTED block); (iv) no emitted def-fill synthetic wire (`<host>:<bind>`/`<host>:<index>`) is registered as a node (not a member of the registry id set) | **GREEN** |
| **NC-1e — I4 clone reachability containment (the spy)** | three fresh graphs, one per pipeline: (a) placement (translate + `placement-attach`), (b) component (def + 3 consumers + seam), (c) def-fill (emit) | `spyOn(Node.prototype,'clone').mock.calls.length === 0` asserted **after each stage** of each pipeline. **Positive control in the same test:** on a fresh graph apply **2** explicit `clone-instance` ops → spy count `=== 2`, each copy `runtimeMinted === true` (the control MUST be asserted before the row reports `HELD`; a control count of `0` reports `UNDETERMINED`) | **GREEN** |
| **NC-1f — I5 the census is journal-derived** | (a) a no-op graph (empty journal); (b) `k = 2` explicit `clone-instance` ops; (c) a `layer-apply` + a `rows-mint` (decoys) | (a) journal `totalEntries === 0` and the measured count `=== 0`; (b) measured count `=== 2 ===` the journal's `clone-instance` count; (c) measured count `=== 0` **despite** node growth (the decoy arm — the falsifier for an arithmetic-identity derivation); every measurement asserts `truncated === false`/complete window | **GREEN** |
| **NC-1g — P-TP-2 cross-expression agreement** | one topology descriptor at `d = 4`, two arms: static (`compileAll`, no ops) and runtime (handler expansion via explicit `clone-instance`) | (i) both arms: `states === elements === 2^4−1 = 15`; (ii) static arm's measured `cloneOps === 0` with a proven-empty journal; (iii) runtime arm's measured count `> 0` and `===` its journal's `clone-instance` count; (iv) **✎ CORRECTED 2026-09-22 (executed by the TestWriter — P-TP-2) — this corrected form is the ASSERTED one:** runtime `registered` − static `registered` `===` measured clones + prototype count **− (2d − 2)** (= `14 = 14 + 6 − 6` at d=4; the uncorrected `=== clones + prototypes` form is FALSE for every d ≥ 2 (✎ CORRECTED 2026-09-22 — previously mis-stated as "d ≥ 3"; true only at the degenerate d = 1) and must not be re-asserted) | **GREEN** |

### 8.2 Unit NC-2 — the harness guard-reachability suite (`tests/unit/no-clone-guards.test.ts`, NEW)

**Why a separate file:** one file = one concern (AGENTS.md item 6). NC-1 is the
engine invariant; NC-2 is the **harness** contract (§3 I5 measurement + §4
guard ordering) and has a different lifecycle — it must be revisited whenever the
smoke's guard set changes, whereas NC-1 must not.

| Case | Input shape | Exact observable | Expected status |
| --- | --- | --- | --- |
| **NC-2a — the legacy-shape census is REACHABLE** | the guard sequence / ordered entry log (see NC-2b) | the legacy-shape census guard (`assertLegacyShapeCensus`, `demo-smoke.mjs:449`/called `:537`) is **entered** on a smoke run whose earlier tripwire fires — asserted from the ordered entered-guard log, not from the absence of an error | **GREEN** — ✎ LANDED 2026-09-22 (pre-fix state, retained for the record: **RED** — the tripwire at `:395-397` exited first; this was the red half of the guard-ordering fix, and it became green when the harness pass landed) |
| **NC-2b — no guard is silently unreachable** | the same ordered log, with a **fault-injection** arm that forces an early exit-capable guard to fail | every guard id appears in the entered log on **both** arms; the log is asserted **non-empty and contains at least one guard positioned after today's tripwire** (the anti-vacuity clause) | **GREEN** — ✎ LANDED 2026-09-22 (pre-fix state: **RED**, same reason) |
| **NC-2c — a passing guard REPORTS its measurement** | the smoke's printed output (or the recorded measurement sink) | the `cloneOps`-bearing census lines print a number that **equals** the journal-derived count for that page; the runtime-arm line prints a number `> 0` (the `SMOKE-TRIPWIRE-INERT` half: a guard that runs but reports the wrong quantity) | **GREEN** — ✎ LANDED 2026-09-22 with the §3 I5 fix (`demo-smoke.mjs` + the three demo modules); pre-fix this case was RED |
| **NC-2d — the fork-stress `cloneOps` guard is not a tautology** | the guard's inputs | the guard compares a **journal-derived** value against the census field, and its failure path is reachable with a crafted input (e.g. a stubbed page profile whose `cloneOps` is off by one) — asserted by driving the guard directly with a fabricated profile | **GREEN** — ✎ LANDED 2026-09-22 with the §3 I5 fix (pre-fix this case was RED: `demo-smoke.mjs:181-184` compared an arithmetic identity against itself) |

### 8.3 The two harness/demo files the measurement fix touches, with acceptance criteria

| File | Change class | Acceptance criterion |
| --- | --- | --- |
| `scripts/demo-smoke.mjs` | (i) the `cloneOps` guards become **journal-derived comparisons** (`:181-184` — replace the `inTree − 1 − prototypes` identity comparison with a comparison against the page's **measured** value, or assert the page's value equals the journal count the harness can read); (ii) the **guard ordering** fix of §4 (`:395-397` vs `:511-538`) | (i) the guard still fails on a genuine drift and **prints the measured number** on every run (the `[runtime-fork:tripwire]` reporting precedent, `:393-394`); (ii) **no bound is changed** (3×, 2.5×, residual 15%/25ms all untouched); (iii) every guard that passes today still runs and still passes; (iv) a newly reachable failing guard is reported and filed, never suppressed |
| `demo/path-fork-data.js` + `demo/legacy-shape.js` + `demo/fork-stress-data.js` | the `cloneOps` **measurement**: replace the literals/identity with a journal-derived count (§3 I5's rule), keeping the published `PROFILE` field name and the pages' other census semantics unchanged | each page's published `cloneOps` **equals** its supervisor's `journalEntries()` `clone-instance` count; the measurement **fails loudly** on an incomplete window; page checks that today assert `journal.length === 0` (`path-fork-data.js:379`, `legacy-shape.js:776`) stay consistent with the derived value (0 there — and the same check already proves it) |

> **The engine is not touched by any of this.** No file under `src/**` is in
> scope for either unit (§2.2 row 1); if an enforcement row goes red, the
> deliverable is a `docs/defects.md` row — the engine patch (if any) is a
> separate, gated unit.

### 8.4 Property-layer execution instructions (register)

**Determinism rules inherited verbatim** from the sibling register
(`docs/specs/bodyruns-drop-diagnostics.md` §8.3 `:974-982`): one **pinned seed** for
the whole run, printed in the report; **≤ 100 attempts per row** and **≤ 400
attempts total**; **stop after 5 failures** per row (report the attempts actually
run); an **inline seeded PRNG** in the test file (**no new dependency** — the repo
has no PBT harness, verified in the sibling pass); every row reported with its
**strategy id** and its **status**.

**Report contract (the four-value vocabulary + record-before-assert), inherited
from `bodyruns-drop-diagnostics.md` §8.3 `:984-1007` — binding here too:**

1. statuses are exactly `HELD` / `BROKEN` / `EXPECTED-RED` / `UNDETERMINED`;
2. the report line is emitted **BEFORE** the assertion, so a failing row still
   reports;
3. each line carries the row id, strategy id, status, attempts, failure count,
   liveness, and the minimized counterexample (`counterexample=none` when held);
4. `HELD` requires **at least one live falsification clause** — otherwise
   `UNDETERMINED` (this is the rule §7 risk 1 depends on);
5. each register **test name states the status the executed line reports**
   (a name claiming a status the line does not contain is a contract
   contradiction).

**Expected statuses on the CURRENT code (✎ LANDED 2026-09-22 — the pre-landing
expectation is retained, annotated).** *Pre-landing:* every row `HELD` **except**
the two rows whose clause was harness-side — `P-SM-1` was `EXPECTED-RED` until §4
landed (the census guard was unreachable) and `P-TP-1` was `EXPECTED-RED` until
the §3 I5 measurement landed on the three demo modules (`P-TP-1`'s engine-side
half — a journal-derived count computable from `journalEntries` — was assertable
from the start; the *page* half landed with the harness fix). The TestWriter was
required to report both explicitly and to **not** weaken either row's clauses to
reach `HELD`. *Executed (measured by the supervisor 2026-09-22; the rows assert
these lines in the landed files):* **all seven rows `HELD`**, 362 attempts ≤ 400
— both harness-side rows reached `HELD` **by the harness fix, not by weakening**,
which is exactly what the rule above was written to police.

**Per-row falsification evidence (the TestWriter must record it).** For every
row, record **why the row would go RED under a violating implementation** —
the same discipline W5 used to prove its four oracle corrections stayed
falsifiable (`bodyruns-drop-diagnostics.md:828-847`). The form: for each row, the
**same-code counter-readings** that a removed/regressed mechanism would produce
(e.g. for `P-IM-3`, a per-consumer mint that yields two def-root ids makes the
`distinct seam-target identity === 1` clause fail with the concrete ids printed;
for `P-TP-1`, deleting the measurement and restoring the literal makes the
positive arm read `0 ≠ k`). A row whose falsification evidence cannot be stated
is `UNDETERMINED` and must be fixed, not reported.

### 8.5 Landing-pass documentation duty (✎ EXECUTED 2026-09-22 — status recorded)

The landing pass (harness fix + tests) additionally:

1. adds the `docs/skills/designing-pages.md` **§11 coverage-matrix rows** for
   `tests/unit/no-clone-invariants.test.ts` and `tests/unit/no-clone-guards.test.ts`
   (AGENTS.md item 3), and any **§12** demo-page note if the demo modules' census
   output changes shape (it does not — the field name and the pages' semantics
   are unchanged, §8.3); — **✔ DONE 2026-09-22, WITH A GAP FOUND AND CLOSED BY THE
   GATE-8 DOC REVIEW:** the `no-clone-guards` row landed (with the landed marker),
   but the **`no-clone-invariants.test.ts` row was MISSING** from the matrix until
   `archive/reviews/2026-09-22/2026-09-22-noclone-doc-review.md` added it
   (`docs/skills/designing-pages.md` §11, immediately after the `no-clone-guards`
   row). **Both rows are now in place** — the duty is satisfied by two passes, not
   one, and the gap is recorded rather than smoothed — ✎ and a **§2 author-facing rule** (the NO-CLONING
   block, `docs/skills/designing-pages.md:206-227`) was added on top of the
   spec's duty, which the audit's census finding made necessary;
2. adds the two §9 tracker rows (a `docs/decisions.md` row for the enforcement
   contract, a `docs/defects.md` row for the guard-ordering defect — and a
   **finding row** if criterion 2 of §4 fires); — **✔ DONE 2026-09-22**, and it
   landed **more** than the two: `docs/decisions.md` **NO-CLONE-ENFORCEMENT**
   (the §4 shape + the §3 I5 measurement home) and **NO-CLONE-HARNESS-OPS** (the
   wait window + worker plumbing, audit H8/H11); `docs/defects.md`
   **SMOKE-GUARD-UNREACHABLE** + **CLONE-CENSUS-NON-MEASUREMENT** (both FIXED) +
   the audit row **SMOKE-NOCLONE-AUDIT-2026-09-22** (FAIL, 8 must-fix, all
   closed) + the re-filed **PRODUCING-HOST-CENSUS**;
3. keeps the validation trio green **except** the known
   `demo:smoke` RED at the runtime tripwire, which is a **documented user
   ruling** (`docs/decisions.md` RUNTIME-FORK-TRIPWIRE-BOUND;
   `docs/defects.md` **RUNTIME-FORK-PASS2-RATIO** (✎ 2026-09-23 re-pointed BY NAME — now `:19`, was `:16`) and **not** this unit's to
   re-baseline (§2.2 row 3). — **✔ HOLDS 2026-09-22** (measured by the
   supervisor: test/typecheck/build green; the smoke RED at the tripwire is the
   ruling, **and all 34 guards run and report** — the §4 guarantee this unit
   exists to provide).
   ✎✎ **SUPERSEDED 2026-09-23 (guard redefinition, user ruling `docs/decisions.md`
   RUNTIME-FORK-GROWTH-GUARD): the "smoke RED at the tripwire" clause above is the
   PRE-RETIREMENT state.** The cross-family 3× assertion was RETIRED (its operands
   are page totals over two different construction methods) and replaced by the
   runtime-vs-runtime growth guard (`runtime-fork-growth-guard`, d10 → d12 pass-2
   ratio, bound 10×), so `npm run demo:smoke` now exits **0** with **34 guard
   entries, 0 failures**. **The §4 guarantee this clause is ABOUT is unaffected and
   still holds: every guard runs and reports.**

### 8.6 Amendment log

| Amendment | Date | By | What changed | Evidence |
| --- | --- | --- | --- | --- |
| ✎ RESOLVED 2026-09-22 (supervisor, executed) — **PART (1) CORRECTED 2026-09-22 (gate-8 doc review; see the two ✎ CORRECTED rows on this table's tail)** | 2026-09-22 | supervisor (correction pass on a Supervisor resolution; SpecWriter applied it) | **(1)** the named approval-audit report `archive/reviews/2026-09-22/2026-09-22-noclone-approval-audit.md` is recorded as a **LIVE artifact** (18 544 bytes at the time of writing) and the approval-trail claim is cited to it, withdrawing this file's earlier "file is absent" flag as a **tool-wall artifact** — the same listing confirms `-noclone-history.md` / `-noclone-probe.md`; the "resolve the path or make the substitution permanent" question is **dropped from the open list** — ⛔ **PART (1) IS FALSE AND IS CORRECTED BY THE NEXT ROW: the path does not exist; the report was received in context and never persisted; the "18 544 bytes" figure is struck; the history report's §5 IS the record**; **(2)** the git-derived facts are recorded as **MEASURED** in §0.2 (F1-F9, commands listed) and the "SUPPLIED-BUT-UNVERIFIED" labelling is **withdrawn**; §7 risk 3 rewritten to the narrower residue; the `ops.md` §2.4 bullet-3 nuance recorded in §0.3 with a wording RECOMMENDATION that **requires a user/gate decision** (no `ops.md` edit made). Open questions after this pass: **exactly the two of §7.1** — **Q-1** the §4 fix shape (a)-vs-(b), and **Q-2** whether the census measurement lives in the demo pages or the harness | Resolutions 1-2 as **executed by the supervisor 2026-09-22** (§0.2 F1-F9); the SpecWriter's own confirmation of Resolution 1 is **recorded as failed, not as confirmed** (§"RESOLVED 1" residue: four read/search calls returned no such file — no shell under this tool wall). **✎ The "failed confirmation" was in fact CORRECT** (see the two rows below): read/search sufficed to establish absence |
| ⚠ Correction-pass honesty note (2026-09-22) | 2026-09-22 | SpecDoc (this pass) | Records that Resolution 1 could **not be independently confirmed** by the SpecWriter's read-only wall, while Resolution 2 stands entirely on the supervisor's executed commands and a §0.3 RECOMMENDATION is left for the gate | The four read/search calls of §"RESOLVED 1" residue; the §8.6 row above |
| ✎ CORRECTED 2026-09-22 (executed by the TestWriter — NC-1d) | 2026-09-22 | SpecWriter (correction pass on the TestWriter's executed finding, 2026-09-22) | **§8.1 NC-1d(iii) + §5 P-IM-3 + §3 I3's statement** asserted `registered` **and the `'prototype'`-state count** identical before/after a full resolution+emit pass. **FALSE as literally written:** on seam materialization the def-root's family parent edge becomes a **seam** edge, so its derived state moves `'prototype' → 'in-tree'` — **measured by the TestWriter 2026-09-22: the `'prototype'`-state count goes 3 → 0, the registry stays 7, and NO node is created**. Corrected to the phase-INDEPENDENT observables I3 actually constrains — **registry size** (`allNodes().length`), **the def-prototype identity set** (def-root/def-children **object identity**, `===`, unchanged across the pass) and **"no synthetic def-fill wire registered as a node"** — with the token-state count recorded as **EXPECTED to change** so the invariance form is not re-asserted. **A resolution-layer complement to AUTH-SEAM, not a violation (DEFECT #24 realization).** No invariant was weakened: the corrected form is **the ASSERTED one**, and the §5 falsification column now names the count's movement as **NOT a falsifier** | **Measured by the TestWriter 2026-09-22** (3 → 0, registry 7, no mint). Mechanism read this pass: `src/core/node.ts:1699-1706` (+ `:1719-1721`) — `materializeSeam` mints `new Link({name:'parent-child'})` + seam `'parent'`/`'child'` anchors on the **pre-minted prototype objects** (no `new Node`, no `registerNode`); `src/core/node.ts:508-520` `stateChildAnchor()` resolves through the seam when the family parent anchor is token-terminated (`'component'`); `src/core/node.ts:529-546` `stateFrom` → `'in-tree'` (`:533`) / `'prototype'` (`:534`); state vocabulary `docs/specs/node.md:69`. Decision row: `docs/decisions.md` **SEAM-RESOLVED CARRIERS** (read at `:84` this pass — *"unresolved defs stay `'prototype'`"*, census reshape *"prototypes 6→3"*). G-series: `docs/specs/ops.md:361-365` (G23/G24/G26/G27) + `docs/specs/ops.md:135` (ALS-1b) + `:143-144` (D8); code comment `src/core/node.ts:1689-1694` |
| ✎ CORRECTED 2026-09-22 (executed by the TestWriter — P-TP-2) | 2026-09-22 | SpecWriter (correction pass on the TestWriter's executed finding, 2026-09-22) | **§8.1 NC-1g(iv) + §5 P-TP-2 (+ §5 omission note 1)** asserted `runtimeRegistered − staticRegistered === measuredClones + prototypeCount`. **FALSE as literally written except at d ≥ 12 (⛔ WRONG — see the ✎ CORRECTED calibration row at the end of this table: the form is false for ALL d ≥ 2 and true only at the degenerate d = 1):** the measured relation is **`runtimeRegistered − staticRegistered = clones + prototypes − (2d − 2)`**. Measured by the TestWriter 2026-09-22: d=2 → `2 = 2 + 2 − 2`; d=3 → `6 = 6 + 4 − 4`; d=4 → `14 = 14 + 6 − 6`; the probe's d=12 → `4094 = 4094 + 22 − 22`. The `(2d − 2)` term is the **structural difference between the two expressions** (the runtime family's prototype population — the same `2(d−1)` quantity as its `prototypes` term, hence the algebra `runtimeRegistered = 1 + prototypes + clones`); the old statement's "`2d − 1` shape" was the STATIC page's own node count, not a runtime term. Corrected to the ASSERTED form; the relation is **CORRECTED and CONFIRMED**, not weakened | **Measured by the TestWriter 2026-09-22** (four data points above; the probe's d=12 reading `4094 = 4094 + 22 − 22`, `archive/reviews/2026-09-22/2026-09-22-noclone-probe.md:53`). Mechanism **CONFIRMED from code+docs, read this pass:** `demo/fork-stress-data.js:90-135` (two prototypes per layer 1..depth−1 = `2(d−1)` = `2d − 2`, `registerNode` at `:188`/`:193`), `:251-254` (two `clone-instance` ops per non-leaf ⇒ `2^d − 2` clones), `:620` (the identity `cloneOps = registered − unplaced − 1 − prototypes` ⇒ `registered = 1 + prototypes + clones`), `scripts/demo-smoke.mjs:161-162` (`prototypes = 2 * (depth - 1)`); static side `demo/path-fork-data.js:19` / `:80-82` / `:247` / `:290` (`2·depth−1` nodes, no prototypes) + `docs/specs/derived-fork-variants-review.md:182` (`registered=23 / cloneOps=0`, d12 = `2·12−1`) |
| ✎ CORRECTED 2026-09-22 (recorded by the SpecWriter from the TestWriter's executed pass — P-IM-2 floor) | 2026-09-22 | SpecWriter (recorded from the TestWriter's 2026-09-22 implementation) | **§5 P-IM-2's strategy cell started the placement arm at `d ∈ [2,6]`; at `d = 2` the row is VACUOUS** — the static topology at d=2 is **3 states / 3 distinct nodeIds ⇒ nodeRatio 1**, so the "states strictly exceeds distinct nodeIds" liveness proof cannot hold. **Amended to `d ∈ [3,6]` with the AXIS-SEPARATION reason**: the two axes are independent only where `2^d − 1 > 2d − 1`, i.e. **exactly `d ≥ 3`**. The floor is an **anti-vacuity requirement (§5's per-row rule, §8.4's `HELD`-requires-a-live-clause rule), not a scope reduction**, and the arm's anti-vacuity clause now asserts the floor (**corrected form = the ASSERTED one**) | P-IM-2's strategy + anti-vacuity columns and §8.4's rule; the nodeRatio evidence for d ≥ 3 is `archive/reviews/2026-09-22/2026-09-22-noclone-probe.md:48` (3/15/63/255/1023/4095 states vs 3/7/11/15/19/23 nodes — ratio 1 at d=2, 1.4 at d=3, up to 178×) |
| ✎ CORRECTED 2026-09-22 (recorded by the SpecWriter from the TestWriter's executed pass — NC-1a producer/consumer requirement) | 2026-09-22 | SpecWriter (recorded from the TestWriter's 2026-09-22 implementation) | **§8.1 NC-1a** now states the row's generator REQUIREMENT as a contract: the generator must guarantee **≥ 1 producer and ≥ 1 consumer** carrying each zone name on every attempt, so the **two-zone clause is always live** — a zone with no producer, or a consumer naming no zone, makes the shared-Link clause vacuous, and the attempt must **throw** rather than pass silently. (The TestWriter implemented this in the executed pass; the spec records it as the row's requirement so the two cannot diverge) | §5 **P-IM-1**'s strategy cell already constructs producers/consumers (`m ∈ [1,p] carry placementName: zᵢ`, *"so every requested zone has ≥ 1 producer for at least one attempt"*) — NC-1a had no equivalent clause; §8.4's `HELD`/live-clause reporting rule |
| **✎ CORRECTED 2026-09-22 (supervisor) — the FALSE CITATION to the approval-audit report** | 2026-09-22 | gate-8 doc review (this pass) | **The provenance block's "RESOLVED 1", §7.1's "recorded as CLOSED" paragraph and §9's approval-audit row all cited `archive/reviews/2026-09-22/2026-09-22-noclone-approval-audit.md` as a LIVE artifact on disk ("18 544 bytes at the time of writing"). It IS NOT ON DISK and never was** — the directory holds the eight other 2026-09-22 reports (plus this review's own two additions, labelled in their headers) and **none** is an approval-audit report. Recorded honestly in place: the report was **received as an in-context agent report but NEVER PERSISTED** (that audit session had no write tool); its content survives **only** in (a) the supervisor's synthesized RCA — i.e. the landed tracker rows, received-not-persisted — and (b) `2026-09-22-noclone-history.md:331-353` §5, which is the **git-provenance half** and the citable record. **Every "live artifact" / "18 544 bytes" claim is struck**; the four findings the audit returned and their current homes are enumerated in §"RESOLVED 1". **No contract clause and no §8 case depends on it.** The SpecWriter's earlier "file is absent" flag — which RESOLVED 1 had withdrawn as a "tool-wall artifact" — is **REINSTATED as correct** | An executed `ls` of `archive/reviews/2026-09-22/` (supervisor, 2026-09-22: **eight other 2026-09-22 reports, no approval-audit report**) + a `glob` over `archive/reviews/2026-09-22/**` run by this doc-review pass (the same eight paths) + the SpecWriter's four read/search calls recorded in §"RESOLVED 1" (all returned no such file) + `2026-09-22-noclone-history.md:333-338` (its `grep '5e8be50'`-over-the-workspace negative is the same phenomenon). Full sweep: `archive/reviews/2026-09-22/2026-09-22-noclone-doc-review.md` §"citation audit" |
| **✎ CORRECTED 2026-09-22 (supervisor) — the CALIBRATION claim "FALSE … except at d ≥ 12"** | 2026-09-22 | gate-8 doc review (this pass), on the enforcement adversarial audit's register-level finding | **§5 P-TP-2's parenthetical, §8.1 NC-1g(iv) and the P-TP-2 amendment row below all said the uncorrected `clones + prototypes` form is "FALSE as literally written except at d ≥ 12" — and §5's own P-TP-2 cell simultaneously said "false for every d ≥ 3". Both are WRONG, and they contradicted each other.** **The correct statement: the uncorrected form is FALSE for ALL d ≥ 2 — including d = 12 — and TRUE ONLY at the degenerate d = 1.** Substituting d = 12 into the two sides gives `4094 ≠ 4094 + 22` (false, like every d ≥ 2); at d = 1 both sides are the SAME quantity (`2^1 − 1 = 1` static node, 1 runtime node, 0 clones, `2d − 2 = 0` prototypes ⇒ `0 = 0`), which is why the old form's only true case is the degenerate depth — not the probe's measured d = 12. **The corrected ASSERTED form is unchanged and unaffected** (`runtimeRegistered − staticRegistered = clones + prototypes − (2d − 2)`, §5 P-TP-2 / §8.1 NC-1g(iv)); what this row fixes is the *falsity claim attached to the old form*, whose wording was carried over from the stale test comment the TestWriter has already corrected (`tests/unit/no-clone-invariants.test.ts:1053-1068` — verified this pass: the comment now states the corrected relation and the `2(d−1)` cancellation, with no "except at d ≥ 12" text anywhere in the file) | Arithmetic re-derived this pass from the spec's own four measured data points: d = 2 → `2 = 2 + 2 − 2`; d = 3 → `6 = 6 + 4 − 4`; d = 4 → `14 = 14 + 6 − 6`; d = 12 → `4094 = 4094 + 22 − 22` — every one of them FALSE against the uncorrected form. The `d ≥ 12` wording is the same class of error the audit found in the register (finding 5's sibling): a claim about which depths falsify a clause, asserted without re-substituting. **The stale test comment** (`tests/unit/no-clone-invariants.test.ts`) is confirmed FIXED (read this pass, `:1053-1068`) — the TestWriter's pass, not this one |

---

## 9. Cross-references

| Reference | Rows / lines this spec depends on |
| --- | --- |
| `docs/specs/ops.md` | §2.4 `:83-88` — **the rule's single spec home**: `:87` ("Not the placement mechanism"), `:88` (HANDLER-LOGIC ONLY, user clarification 2026-08-15); §2.6 `:102-109` (`placement-attach` steps 1-4); §2.7 `:121-166` (the D7 anchor-layer seam); `:135` (ALS-1b def-root mint), `:143-144` (D8 def-child prototypes); **`:362`** (row **G24** — multi-parent legality; the sharing I3 rests on); `:365` (the G27 AUTH-SEAM carve-out); `:220` (the op-kind list) |
| `docs/decisions.md` | **the DEFECT #11 row (read at `:74` this pass)** — *"clone-instance is HANDLER-LOGIC ONLY … runtime-minted clones reverse as NOTHING (authored envelope = base truth)"* — one of the rule's four homes (`2026-09-22-noclone-history.md:91`); then, **by row name** (line numbers are locating aids at most, per the citation convention above): **VERSIONING-SCHEME** (read at `:19` — not triggered, §1), **RUNTIME-FORK-TRIPWIRE-BOUND** (read at `:14` — **the bound §4 must not touch**), **JOURNAL-READ-API** (read at `:15` — the `journalEntries` decision row, cited by name per `docs/releases.md`'s citation convention), **SEAM-RESOLVED CARRIERS** (DEFECT #24, read at `:84` — the `node.ts:1690-1694` anchor-copy removal), **AUTH-SEAM** (the `adoptDefChildren` re-homing), **EVENT-DISPATCH-WIRING** (the `#`-bearing-nodeId resolution rule §6 row 4 leans on) |
| `docs/specs/pipeline.md` + `src/core/pipeline.ts` | `pipeline.md:67-68` and `pipeline.ts:79` — stage 1 `targetPlacementResolution` ("the path-enumeration compile resolves first-match-with-known-container + per-zone fan-out, P3 §2.1") and stage 2 `placementAssembly` (*"**Populates zones WITHOUT clone-instance decomposition** (P3 §6.1) … the `clone-instance` op remains for RUNTIME/HANDLER-logic instantiation only … **never the placement mechanism**, never required by translate or the base engine"*) |
| `docs/specs/placement-path-spec.md` | `:47` (*"…NO nodes created"*), **`:65`** (**E2E-1** — the no-node-creation user requirement), `:639` (the census row: `registered=23`, `path-viable=4095`, **`cloneOps=0`**, F-1), `:1658` (contentNodes minting *"adds ANCHORS, never nodes — E2E-1's 'no node creation' holds at every stage"*), `:1826` (DEFECT #24 §10.ag) |
| `docs/specs/node.md` | `:21-36` (§1.1 the absent-field negative contract — `children` is graph-derived, `_referencingNodes` gone), `:38-56` (§1.2 **SI-1..SI-5**, incl. SI-3's peripheral-anchor rule and SI-4's `AnchorTarget` rule), `:57-62` (§1.3 the three permanent owners), `:69-70` (`NodeState`) |
| `docs/specs/render.md` | `:224` (**DFC-1** — def-fill/SED-2 synthetic wires are *"emit-time only, the graph children stay empty"* — the contract that makes P-IM-3's synthetic-wire check legal) |
| `docs/specs/journal-read-access-review.md` | the `journalEntries` gate record (the read accessor §3 I5's measurement uses) |
| **RCA reports (2026-09-22)** | `archive/reviews/2026-09-22/2026-09-22-noclone-probe.md` — `:22-31` (verdict + F-1/F-2), `:44-54` (§1 per-path verdict table), **`:15-16` (the `**Origin fix:** commit 5e8be50` header — now hash-verified, §0.2 F4)**, `:69-79` (the 6+2 construction census), `:97-171` (§3 the mechanical answers), `:180-209` (§4 measurements), `:250-279` (§6 what a test WOULD catch), **`:285-328` (§7 the exact paths a regression would NOT be caught — the unit's reason to exist)**; `archive/reviews/2026-09-22/2026-09-22-noclone-history.md` — `:14-48` (verdict), `:86-91` (the rule's four homes), `:104-218` (§2 Q1 (a)-(d)), `:227-256` (§2.5 the `new Node` census + the placement-verdict), `:260-282` (§3 the linking-semantics change history), **`:331-353` (§5 the approval trail — the **citable** record; ✎ CORRECTED 2026-09-22: there is no unpersisted "live audit report" beside it — see the provenance block's RESOLVED 1)**, `:419-433` (§7 no reword), `:447-476` (the git kit + "Unverified / open (needs shell)" list — **the gap §0.2 F1-F9 CLOSED**) |
| **Approval-trail audit — RECEIVED IN CONTEXT, NOT PERSISTED (✎ CORRECTED 2026-09-22; see the provenance block's RESOLVED 1)** | **THERE IS NO FILE.** `archive/reviews/2026-09-22/2026-09-22-noclone-approval-audit.md` **does not exist** (the directory holds eight files, none of them this report — §"RESOLVED 1"). The report reached the supervisor **as an in-context agent report** and was never written to disk (the audit session had no write tool), so the earlier citations to it as a **live artifact** — including the "18 544 bytes" listing — are **WITHDRAWN**. **The citable records for the same content are:** `2026-09-22-noclone-history.md:331-353` (§5 the approval trail — the git-provenance half) + `:333-338` (its headline) + `:86-91` (the rule's four textual homes); the four findings' current homes are listed in §"RESOLVED 1" and are the enforcement's own landed rows. **No contract clause and no §8 case depends on the unpersisted report**; the enforcement adversarial audit, which WAS persisted this pass, is `archive/reviews/2026-09-22/2026-09-22-noclone-enforcement-adversarial.md` (a **post-hoc reconstruction**, headed as such) |
| **Executed git evidence (RESOLVED 2)** | §0.2 F1-F9 — all **executed by the supervisor 2026-09-22** (the SpecWriter holds no shell): `git log -S'never clone' -- docs/specs/ops.md` → `6d0a2ec` only + `git show 6d0a2ec:docs/specs/ops.md` byte-identical rule text + `git log 6d0a2ec..HEAD -- docs/specs/ops.md` → nine commits touching no rule clause; `-S'node-cloning'` / `-S'path enumeration'` → same commit (`path enumeration` also `6eb1cb4`); `5e8be50` = the fix that removed the clone-based placement path (2026-08-14, 107 files, +11526/−658); `-S'decomposes into attach + clone-instance'` → `996ca7f` / `5e8be50` / `6d0a2ec`; `git show 996ca7f:RENDER_PROCESS_NOTES.md:157` (the pre-fix clone design, still carried at `5e8be50` — docs lagged a day); `-S'component-instantiation' -- docs/specs/ops.md` → `5e8be50` only; `translate.ts` zero `clone-instance` mentions at `996ca7f`/`7d9d77e`/`5e8be50`/`6d0a2ec`/`691320b`/HEAD; `git show --stat` over the nine post-rule commits (`610c053`, `1ca97f0`, `6685cd6`, `790c313`, `e552587`, `691320b`, `4a2adc7`, `be11b2e`, `4b…`) → `src/core/` touched only in `supervisor.ts`/`node.ts`/`registry.ts`/`types.ts`/`adapters.ts`, none adding a placement/component-reachable `clone()` |
| **`ops.md` §2.4 nuance + RECOMMENDATION** | §0.3 — `docs/specs/ops.md:87` (bullet 3, "component-instantiation", **one revision: `5e8be50`**, §0.2 F7) read together with `docs/specs/ops.md:88` (bullet 4, "components = resolution + seam"); the narrowing recommendation **requires a user/gate decision** and is **not applied** in this pass |
| `docs/defects.md` (✎ 2026-09-23 citation repair — cite BY ROW NAME) | `:18` **SMOKE-TRIPWIRE-INERT** (FIXED 2026-09-22 — the guard-measurement precedent §4 generalises; was `:15`), `:19` **RUNTIME-FORK-PASS2-RATIO** (OPEN — the separate unit, §2.2 row 3; was `:16`), `:145` (DEFECT #24 row; was `:126`), `:16` (SMOKE-NOCLONE-AUDIT-2026-09-22) |
| Tests that pin parts of this contract today | `tests/e2e/path-fork-e2e.test.ts:182-201`, `:203-229` (the strong placement pin), `:588-589` (the arithmetic identity I5 replaces); `tests/blind/e2e-layer.test.ts:226-235` (4095 states / 23 distinct `nodeId`s), `:286-287` (the `cloneOps = 0` **comment** — the gap in miniature); `tests/unit/path-enum.test.ts:166-175`; `tests/unit/path-emit.test.ts:238-261` + `tests/unit/render.test.ts:435-437` (arm node identity); `tests/unit/legacy-shape-ops.test.ts:73`/`:259` (ALS-4/G24 — anchors, not counts); `tests/e2e/legacy-shape.test.ts:486-505` (ALS-1b — shape, not count); `tests/unit/node.test.ts:269-318` (clone semantics); `tests/unit/hooks.test.ts:388-410` (clone-shadowing) |
| Tests this spec creates | `tests/unit/no-clone-invariants.test.ts` (**NEW** — §8.1), `tests/unit/no-clone-guards.test.ts` (**NEW** — §8.2) |
| Harness / demo files the measurement + ordering fixes touch | `scripts/demo-smoke.mjs` (`:160-189` the tautological `cloneOps` guard, `:377-398` the repaired tripwire, `:395-397` the exit, `:449-510`/`:537` the unreachable census), `demo/path-fork-data.js` (`:251`, `:303`, `:370-383`), `demo/legacy-shape.js` (`:382`, `:765-779`), `demo/fork-stress-data.js` (`:240-255`, `:608-620`) |
| Decision rows the landing pass adds (✎ LANDED 2026-09-22 — this spec pass did not edit trackers; listed here as the cross-reference record) | (i) a `docs/decisions.md` row — **NO-CLONE-ENFORCEMENT**, DECIDED: the invariant's owning record set + the enforcement shape (spy containment I4; journal-derived census I5; component identity I3) + the §4 guard-reachability requirement — **✔ landed, plus a second row NO-CLONE-HARNESS-OPS** (the audit's H8/H11 operational choices); (ii) a `docs/defects.md` row for the **guard-ordering defect** (census unreachable behind the tripwire exit — the `SMOKE-TRIPWIRE-INERT` sibling) — **✔ landed as SMOKE-GUARD-UNREACHABLE, FIXED**, with its I5 sibling **CLONE-CENSUS-NON-MEASUREMENT, FIXED**, and the audit outcome row **SMOKE-NOCLONE-AUDIT-2026-09-22** (FAIL → all 8 must-fix closed); (iii) a `docs/defects.md` row for any **finding** a newly reachable census produces (§4 criterion 2) — **✔ filed as PRODUCING-HOST-CENSUS** (RE-FILED with the correct per-supervisor `allNodes()` mechanism; OPEN, design/coverage item, NOT a census drift in the pinned values — the legacy-shape census's pinned values all HOLD) |
| Process rules invoked | AGENTS.md item 3 (design skill current — **no page-design impact**: §8.5 defers the §11 matrix rows to the landing pass), item 4 (validation trio; the known smoke RED is a ruling, not a regression), item 6 (one contract, one home — §6 rows 2/3 omit duplicate homes), item 7 (Step-4 spec gate), item 8 (TDD red-first — here the "implementation" is a no-op, §1), item 9 (the gate), item 11 (**construction-path exhaustion**, `:11a` — the RCA's ISO-ADV-D lesson that a threading invariant diverges at ONE recursion site: I3 enumerates the component construction sites explicitly, `translate.ts:854` vs `:863`) |
