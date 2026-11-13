# Releases — the version provenance index

**This file is INDEX-ONLY.** It answers exactly one question per version: *which
tag, which commit, which date, which contents, and which gate record owns it?*
It is **not** a third copy of any contract: **no behaviour rule, diagnostic
code, decision clause, or spec sentence may be restated here** — contents are
named **by reference** to the owning gate record / decision row / tracker row
(AGENTS.md item 6, one contract one home; `ur-2026-09-17-review.md` §2 row UR-5
"Home artifact (exact)" + §4 UR-5 (i), AC-17..AC-20).

Maintained by the AGENTS.md **item-12 landing duty**: whoever cuts a tag and
publishes appends/updates that version's row **in the same pass** (§"Landing
duty" below). Rows are never deleted; a superseded provenance claim is
corrected in place with the date of the correction.

## Verification status of this index

Two different things are recorded per cell, and they must not be confused:

- **(A) establishable in this working tree** — a fact re-derived from the
  repository itself (a tag ref, a `package.json` field, a tracker row).
- **(B) recorded provenance** — a fact this index **cannot** re-derive in the
  current clone and therefore records as `UNVERIFIED`, quoting the record it
  came from (`ur-2026-09-17-review.md` §4 UR-5 (ii)/(iii)).

**The honest status of the version lines below (recorded 2026-09-22; the 0.5.1
line added by the in-flight release pass 2026-09-23):**

| Version line | Tag object in this clone | Commit in this clone | Date |
| --- | --- | --- | --- |
| **0.5.2** — **`PENDING (filled at commit time)`** — prepared by the 2026-11-13 release pass (`package.json` bumped `0.5.1 → 0.5.2`); **contents BY REFERENCE only**: `docs/decisions.md` **`RELEASE-0.5.2`** (the index row) → `VALUE-PROVIDER-RENDER-DISPOSITION` + the spec **`docs/specs/value-provider-render-disposition.md`** (the owning gate record: C1–C5, FS-VPD-1…10, register VPD-1…12, AM-1…AM-9) | **`PENDING`** — no tag exists; the tag, the commit and the date are the commit-time edits of the AGENTS item-12 landing duty | **`PENDING`** — no commit exists yet; the full 40-char hash is recorded at commit time | **`PENDING`** — no date is asserted before the commit exists |
| **0.5.1** — **✅ PUBLISHED 2026-09-23** (registry `dist-tags.latest = 0.5.1`; tarball `provident-ssr-0.5.1.tgz` `200`, 276.3 kB, 103 files, shasum `edc8ad5749a183c05db51b428528fca2b64ab0e5`) | **`v0.5.1` — created** (annotated, on the release commit) | **`abd9a458fa26e11bb19c0c23420c2d89287e4b1c`** (full hash; release commit "release: provident-ssr@0.5.1 …") | **2026-09-22** (commit date; publish accepted `PUT … 202` then propagated 2026-09-23) |
| 0.2.0 | **recorded** (tag `v0.2.0`, `docs/next-steps.md` §"PUBLIC RELEASE CHECKLIST") | `UNVERIFIED` | **recorded** — published 2026-08-25 |
| 0.3.0 / 0.3.1 / 0.3.2 | **recorded** (tag names only; the commit is a **7-char prefix**) | `UNVERIFIED` (prefix only) | `UNVERIFIED` |
| 0.4.0 | **recorded** + independently re-derived (see the 0.4.0 row) | **`dd50082d290e9266d0acd659367525e6b7c4fb9a` — full hash, resolvable** | `UNVERIFIED` |
| 0.4.1 | **`UNTAGGED`** | `UNVERIFIED` | `UNVERIFIED` — **do not assert a date** |
| 0.5.0 | **`UNTAGGED`** | `UNVERIFIED` | `UNVERIFIED` — **do not assert a date** |

**Why 0.4.1 / 0.5.0 are `UNTAGGED` / `UNVERIFIED`** (`ur-2026-09-17-review.md`
§4 UR-5 (iii), AC-17): **zero tag objects exist for them in this clone** and the
local `main` branch is **ahead of `origin/main`** — the released commits are
therefore not resolvable from the repository alone. Their rows read
`UNTAGGED` / `UNVERIFIED (registry metadata + maintainer testimony)` and
**deliberately assert no date** rather than infer one.
**✎ REGISTRY CROSS-CHECK (2026-09-23 release pass, recorded by the supervisor —
this clone can re-derive no tag or date):** the registry carries published
versions `0.1.3 … 0.4.1, 0.5.0` with `latest = 0.5.0` and **`0.5.1` free**.
That **confirms the two releases EXIST and were published**; it **adds no tag,
commit or date**, so **both cells stay `UNTAGGED` / `UNVERIFIED` and no date is
asserted for either** (this cell is an annotation over the rows, never a
substitute for the missing provenance). **Note on the pre-0.2.0 line:** the
registry's published list also runs below this index's oldest row
(`0.1.3 …`); those pre-public-flip versions have **no row here at all** (the
0.2.0 flip retired the private `@littlekingsguard/provident-ssr` pre-release —
see the 0.2.0 row), and this pass **adds no rows** for them.
**Why this file cannot do better:** `.github/` is absent from the tree (removed
at the 0.2.0 public flip — `docs/next-steps.md` §"PUBLIC RELEASE CHECKLIST"
step 3 + STATUS; `docs/pending.md` PENDING row) and the git metadata needed for
the tags/dates is **not available to a docs-tooling pass in this clone**. Those
cells stay `UNVERIFIED` until a maintainer with the full clone fills them in
under the item-12 duty. **A date is never inferred from a document's own date
stamp.**

## The index

| Version | Tag | Commit | Date | Contents (by reference — never restated) | Owning gate record / source |
| --- | --- | --- | --- | --- | --- |
| **0.5.1** (patch, `X.X.Y` per the VERSIONING-SCHEME row; **release pass COMPLETE — ✅ PUBLISHED 2026-09-23**, `package.json` = `0.5.1`**) | `v0.5.1` — **CREATED** (annotated, on the release commit `abd9a458fa26e11bb19c0c23420c2d89287e4b1c`) | **`abd9a458fa26e11bb19c0c23420c2d89287e4b1c`** (full hash) | **2026-09-22** (commit date; published/propagated 2026-09-23) | **Verification (attributed — nothing in this pass was executed): `npm run demo:smoke` GREEN, measured by the supervisor 2026-09-23 (`0 guard failures`, exit 0; the entry COUNT is recorded as disputed — see `docs/decisions.md` RELEASE-0.5.1); the publish gate `npm test && npm run typecheck` is the supervisor's to re-run at `npm publish`.** Contents **by reference only** (each item names the record that owns it; see the decision row `RELEASE-0.5.1`): **BODYRUNS-DROP-DIAGNOSTICS (W4)** — `docs/decisions.md` BODYRUNS-DROP-DIAGNOSTICS row + `docs/specs/bodyruns-drop-diagnostics.md` §9; **NO-CLONE / NO-CLONE-ENFORCEMENT** — `docs/decisions.md` NO-CLONE-ENFORCEMENT + NO-CLONE-HARNESS-OPS + NO-CLONE-TEST-PHASE-ISOLATION rows, gate `docs/specs/no-clone-invariants.md`; **DATA-DRIVEN-FAMILY-PATH-ENUMERATION** + **DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION** — the two `docs/decisions.md` rows of those names; **PASS2-FIT-REFERENCE-SLICE-SCOPE (R1)** — the `docs/decisions.md` row of that name + `docs/specs/pass2-fit-reference-scope.md`; **RUNTIME-FORK-GROWTH-GUARD** — the `docs/decisions.md` row of that name (which **supersedes** RUNTIME-FORK-TRIPWIRE-BOUND). **NOT this release** (shipped earlier): ENG-BODYRUNS-WIRE-REF-FIX / ENG-BODYRUNS-WIRE-REF-PATHSTATE-FIX (0.3.1/0.3.2 rows) and BARE-TEXT-EMIT (0.4.0 row); **the 0.4.1/0.5.0 items are NOT claimed here** — those rows stay `UNTAGGED`/`UNVERIFIED`. | `docs/decisions.md` **RELEASE-0.5.1** row (the release-pass index row); per-item owning records as listed; landing duty `AGENTS.md` item 12 |
| **0.5.0** | `UNTAGGED` | `UNVERIFIED` | `UNVERIFIED` | **JOURNAL-READ-API** — the sanitized `Supervisor.journalEntries()` reader | `docs/decisions.md` JOURNAL-READ-API row (`:14`); `docs/defects.md` ENG-JOURNAL-ENTRY-READ-API FIXED row (`:53`, "Target 0.5.0" — the former `:42` citation was pre-pass drift); gate `docs/specs/journal-read-access-review.md` |
| **0.4.1** | `UNTAGGED` | `UNVERIFIED` | `UNVERIFIED` | **BOOLEAN-ATTRS** + **SUPERVISOR-DISPOSE** + **DESTROY-DISSOLVE-PLACEMENT-ANCHORS** — the three Astrographer handoff items | `docs/specs/handoffs-review-10.md:3`; `docs/decisions.md` BOOLEAN-ATTRS (`:15`) / SUPERVISOR-DISPOSE (`:16`) / DESTROY-DISSOLVE-PLACEMENT-ANCHORS (`:17`) rows |
| **0.4.0** | `v0.4.0` | `dd50082d290e9266d0acd659367525e6b7c4fb9a` | `UNVERIFIED` | **BARE-TEXT-EMIT** — the `text`-child bare-text emit path (Shape A1); the version at which the `>=0.4.0 <1.0.0` bare-text emit contract opens | the **`docs/decisions.md` BARE-TEXT-EMIT row** (resolved **by row name** — the former `:23` citation was drift, see the citation convention below; the row sits at `:24` as of 2026-09-22); `docs/specs/bare-text-emit-review.md` §7 (LANDED); `docs/specs/ur-2026-09-17-review.md` §4 UR-5 (ii) |
| **0.3.2** | `v0.3.2` | `23014082…` (`UNVERIFIED` full hash) | `UNVERIFIED` | **ENG-BODYRUNS-WIRE-REF-PATHSTATE-FIX** — the def-fill / component-prototype `bodyRuns` emit gap (global `authoredIdToWire` index + synthetic-wire registration) | `docs/decisions.md:21`; gate `docs/specs/eng-bodyruns-wire-ref-pathstate-review.md` §7 (LANDED) |
| **0.3.1** | `v0.3.1` | `0c7b731d…` (`UNVERIFIED` full hash) | `UNVERIFIED` | **ENG-BODYRUNS-WIRE-REF-FIX** — the `bodyRuns` authored-id child-ref emit-boundary resolve | `docs/decisions.md:20`; gate `docs/specs/eng-bodyruns-wire-ref-review.md` §7 (LANDED) |
| **0.3.0** | `v0.3.0` | `cb71c8ac…` (`UNVERIFIED` full hash) | `UNVERIFIED` | **ENG-INLINE-ORDER** — `bodyRuns` text/element interleaving via the run-encoded `props['text']` string | `docs/decisions.md:19`; gate `docs/specs/eng-inline-order.md` (+ `eng-inline-order-review.md`) |
| **0.2.0** | `v0.2.0` | `UNVERIFIED` | **2026-08-25** (published) | The 0.2.0 batch (Features 1 / 1a / 1b / 2 / 3 / 4) **and** the public-registry flip (unscoped `provident-ssr`; the private `@littlekingsguard/provident-ssr` pre-release retired). Per-feature gate records: `docs/specs/handoffs-review-5.md` (1a), `-6.md` (1b), `-7.md` (2), `-8.md` (3), `-9.md` (4) + `docs/next-feature-batch-0.2.0.md` | `docs/next-steps.md` §"PUBLIC RELEASE CHECKLIST — 0.2.0" (steps 1-5 DONE + STATUS, 2026-08-25); `docs/pending.md` PENDING row |

**Version-line reading rule (why 0.3.0 can appear "later" than 0.2.0 in
contents):** the rows above are ordered by version, not by date; the 0.3.x
line continued the `bodyRuns` work while the 0.2.0 **public registry flip**
was a packaging event, not an engine feature. Read the Contents column, not the
ordering, when citing a capability floor.

## Landing duty (AGENTS.md item 12)

Every future release row is written by the person who cuts the tag:

1. **Tag.** Cut the annotated tag (`v<version>`) in the clone that holds the
   release commit.
2. **Row.** Append/replace the row above with: the tag, the **full 40-char
   commit**, the date (`git log -1 --format=%ci <tag>`, i.e. the commit date of
   the tagged commit), the contents **by reference** (the gate record /
   decision row that owns the feature — never a restatement), and the owning
   gate record path.
3. **Fill the `UNVERIFIED` cells** the row you are superseding left behind: a
   `UNTAGGED` / `UNVERIFIED` row is a **debt**, not a permanent state. Once the
   tag exists in a clone the row is corrected in place with the correction date
   noted (this file keeps no history rows).
4. **Cross-check the version scope.** If the release opens or closes a
   version-scoped contract (as `>=0.4.0 <1.0.0` does), the row names it and the
   owning spec carries the scope (the index still does not restate the rule).

## What this file deliberately does NOT contain

- **No contract text.** Not one rule, warn code, or decision clause is restated
  — each cell names the record that owns it (AGENTS.md item 6; AC-30).
- **No asserted provenance.** A cell this clone cannot establish reads
  `UNVERIFIED` (or `UNTAGGED`); it is never filled with a plausible date
  (AC-17, `ur-2026-09-17-review.md` §4 UR-5 (iii)).
- **No release workflow citation.** `.github/workflows/publish-prerelease.yml`
  **does not exist in this repository** — `.github/` was removed at the 0.2.0
  public flip. The publish surface today is `package.json`
  (`prepack` / `prepublishOnly`) on the default npm registry
  (`docs/decisions.md` NPM-PACKAGING row).

## Cross-references

- **The gate record this index lands:** `docs/specs/ur-2026-09-17-review.md` §2
  row UR-5, §4 UR-5, §7 AC-17..AC-20.
- **The landing duty:** `AGENTS.md` item 12.
- **The packaging decision row:** `docs/decisions.md` NPM-PACKAGING (resolved **by
  row name**; it sat at `:53` when this line was written and sits at **`:66`**
  after the 2026-09-23 release pass inserted the `RELEASE-0.5.1` row — see the
  drift note under the citation convention below).
- **Citation convention (added 2026-09-22):** `docs/decisions.md`/`docs/defects.md`
  line numbers move whenever a row is inserted (the 2026-09-22 UR pass inserted
  five rows above `NPM-PACKAGING`). A `:NN` citation in this file and in the
  other trackers is therefore **advisory** — resolve the ROW by its bold name,
  never by the number alone. The gate record's own `docs/decisions.md` line
  citations (`ur-2026-09-17-review.md` §10) are pre-pass numbers and have drifted
  the same way; that file is a frozen gate record and is deliberately not
  rewritten (`docs/specs/bodyruns-drop-diagnostics.md` §2.2 row 11 owns the
  tracker edits for the pass).
  **✎ ERRATA (2026-09-22, gate-8 doc review — adversarial audit finding 13):**
  (i) this file's own 0.4.0 row cited `docs/decisions.md:23` — the row is at
  **`:24`** (the BARE-TEXT-EMIT row); the cell now resolves the row **by name**.
  (ii) `docs/specs/ur-2026-09-17-review.md` §5's N7 row calls **both**
  `render-helpers.ts:1405` and `:1374` EMPTY-OWNER tests; only `:1405` is (the
  plain-path EMPTY-OWNER gate) — **`:1374` is the BLOCKED-DEF gate**, which tests
  the resolved `content = scalarBinding(s.bindings) ?? s.content` and only then
  `content === undefined`. The corrected classification lives in the LIVE surface
  (`docs/specs/render.md` §3.4.3 EMPTY-OWNER-1c, which states both gate sites and
  their predicate), never in the frozen record.
  **✎ DRIFT NOTE (2026-09-23, 0.5.1 release pass):** the `:NN` cells inside the
  0.5.0 and 0.4.1 rows (`docs/decisions.md` `:14` / `:15` / `:16` / `:17`) were
  already pre-pass numbers and have drifted **again** — the release pass inserted
  the `RELEASE-0.5.1` row at the head of the ACTIVE table, so `NPM-PACKAGING`
  (cited as `:53` above) now sits at `:66` and the 0.5.0/0.4.1 rows' targets
  moved by one. **Nothing was repointed by hand**: those cells resolve by ROW
  NAME (which is why the convention exists), and this note records the drift so
  a future pass need not re-derive it. **The numbers are advisory, the names are
  binding.**
- **The current version:** `package.json` `version` (`0.5.0` at the time of
  writing — **and still `0.5.0` in the in-flight 0.5.1 release pass**, since the
  version bump is the supervisor's edit; see the 0.5.1 row) — note that the
  VERSIONING-SCHEME decision row's "Current version is
  `0.3.0`" sentence is a **2026-08-31 snapshot**, superseded by the shipped
  0.4.x/0.5.0 line; the scheme itself (`X.X.Y` / `X.Y.X` / `Y.X.X`) is
  unaffected. **Registry facts for the in-flight release (recorded 2026-09-23,
  supervisor-authenticated as `rarasey`):** published versions run
  `0.1.3 … 0.4.1, 0.5.0`, `latest = 0.5.0`, and **`0.5.1` is free** — i.e. this
  index's top row claims a version the registry does not yet carry.
