# archive/ — obsolete documentation & review records (NOT tracked)

The git-visible `docs/` tree is for ACTIVE development work and skill/feature
documentation describing the CURRENT engine state. This directory holds what
the cleanup passes retire: obsolete documentation, stale test data, findings
reports, feedback reviews, and superseded decision records. **Nothing here is
ever deleted — the archive holds the originals; archiving is not destruction.**

## The aggressive condensation policy (user directive 2026-08-15)

`docs/` is reserved for **current-state documentation** plus the two condensed
REFERENCE trackers:

- `docs/defects.md` — the active defect list (open on top; fixed rows with fix
  references; superseded rows archived).
- `docs/decisions.md` — the active decisions summary (ACTIVE/SUPERSEDED
  status; pinned contracts with their sources).

Everything else historical — review/analysis records, findings reports, stale
test data, handover snapshots — lives HERE (`archive/<topic>/<date>-<name>.md`).
The 2026-08-15 pass moved: `docs/FRESH-CONTEXT-SUMMARY.md`,
`docs/arch_review.md`, `docs/session-defect-review.md`, `docs/test-findings.md`,
and `docs/specs/` `compile-horizon-review.md`, `legacy-component-ref-only-review.md`,
`mid-process-handler-review.md`, `path-fork-review.md`, `state-first-analysis.md`,
`state-first-analysis-review.md`, `stress-test-scenarios.md`,
`translate-stress-scenarios.md`. The 2026-08-16 pass moved the closed §7-gate
legacy-handler-reuse review quartet: `docs/specs/` `legacy-handler-reuse-proposal.md`,
`legacy-handler-reuse-review.md`, `legacy-handler-reuse-critique.md`,
`legacy-handler-reuse-validity.md` → `archive/reviews/2026-08-16/`
(all 8 review decisions adopted/superseded/landed — decisions.md rows).

**`RENDER_PROCESS_NOTES.md` stays in-tree** (2026-08-15 decision): the specs
cite its §10.x decision provenance pervasively (dozens+ citations), so it
remains the design-history reference rather than breaking the citation chains.
A future pass may fold it into `docs/decisions.md`.

The stress PROBE scripts (`scripts/stress-probes/run-all-round{2,3,4}.mjs`,
`scripts/translate-stress-probes/run-all.mjs`) reference the scenario docs by
path in comments and embed the scenario data verbatim — they read the archived
scenario documents from `archive/test-data/2026-08-15/` after the repoint.

## The archival loop (AGENTS.md item 6)

After EACH significant feature change or test suite:

1. **Merge first** — fold the new/changed information into the core docs
   (`docs/specs/*.md`, `docs/skills/designing-pages.md`,
   `RENDER_PROCESS_NOTES.md` §10.10, and the condensed trackers
   `docs/defects.md` + `docs/decisions.md`). The git-visible docs must
   describe the CURRENT engine state. Findings from the blind-test and
   stress-test loops MERGE into the trackers; the full reports are written
   here.
2. **Archive second** — move the superseded/obsolete material here:
   obsolete documentation, stale test data, findings reports, feedback
   reviews, historical review records. Repoint or remove any references to
   the archived files (a citation pointing at a moved file is a broken link).
3. **Never archive** a file that is still cited by the active docs without
   repointing the citation. Files whose citations are pure decision
   provenance may be retained in-tree until a later pass repoints them.

## Layout

`archive/<topic>/<date>-<name>.md` — one directory per topic, ISO date prefix.
Topic dirs in use: `reviews/` (review/analysis-loop records),
`findings/` (blind-test + stress-loop findings reports), `test-data/`
(stale scenario data — the active probes read from here),
`analysis/` (design analyses / handover snapshots).

## Rules

- **NEVER commit anything in this directory.** `.gitignore` keeps the whole
  dir out except this README.
- Nothing here participates in builds, tests, or the smoke.
- A file is a candidate when: its content is fully superseded by the current
  docs, AND it is no longer needed as a live reference. If in doubt, keep it
  in-tree — archiving is one-way for citation chains.
- Every archived file must remain reachable: in-tree citations are repointed
  to `archive/<topic>/<date>-<name>.md` in the same pass, and citations INSIDE
  the archived files are rewritten to the archive paths too (the archive is
  internally consistent).
