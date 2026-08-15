# Active Defect List

Maintained by the document-archival loop (AGENTS.md item 6). Open defects on
top; fixed defects listed with their fix reference; superseded records are
archived (`archive/`) when a cleanup pass retires them. This file is the
active defect list + status tracker; the detailed findings reports (blind-test
and stress-loop write-ups) live in the GITIGNORED `archive/findings/`
directory.

## OPEN

| ID | Defect | Found by | Class | Fix shape | Record |
| --- | --- | --- | --- | --- | --- |
*(none open — all stress-loop defects fixed)*

## FIXED

| ID | Defect | Fixed (date) | Fix |
| --- | --- | --- | --- |
| **DEFECT #3-1** | Translate-time ancestor-name veto missing (op-time only) | 2026-08-14 | Child-side family attach in translate + the shared `ancestorConsumesZone` predicate; T28 un-skipped; veto is LOOP-PREVENTION only (ancestor would attempt to place into the zone; duplicate presentation legal) |
| **DEFECT #4** | Nested seam shell text dropped (nested SED-2 branch deleted it) | 2026-08-15 | Shared `makeSeamShellEl` finalizer (own-text/styles/forkKey) used by BOTH the top-level and nested branches |
| **DEFECT #5** | Self-provider seams never materialized (value+target planned as source; seam detection keyed on target only) | 2026-08-15 | value+target ⇒ DUPLEX anchor (user ruling); seam detection reads target AND duplex; serialize roleOrder moved duplex beside providers |
| **DEFECT #6** | Reverse dropped seam targets (K5 emitted applyPath only) — seam plan lost on save/load | 2026-08-15 | `nodeToLegacy` emits `target: <seam>` alongside the applyPath branch (target = apply path OR seam target) |
| **DEFECT #7** | `children: [null]` crashed translate (uncaught TypeError, whole-doc abort) | 2026-08-15 | Per-entry guard in the children loop — `children-entry-invalid` warn + skip (incl. the `[42]` silent-mint family) |
| **DEFECT #8** | Truthy non-object `template.root` (42/array) silently minted a default div, zero warns | 2026-08-15 | `legacy-envelope-mismatch` extended to non-object roots |
| **DEFECT #9** | Clone seam materialization orphaned (fresh per-copy Links had no provider) | 2026-08-15 | clone() REUSES the shared per-name registry Link for name-keyed roles (source/target/duplex/component/container/content); fresh links only for genuinely new connections (family-child attach) |
| **DEFECT #10** | `removeLayer`/`removeLayersForSource` had NO anchor-removal step — seam target/parent anchors persisted after removal (def-root kept rendering, reverse shipped phantom bindings); layer-minted placement containers never shrank the fan-out | 2026-08-15 | removeLayer removes the layer's GENERATING anchors (decl role+target match) + `scheduleSweep`; materializeSeam gained a REVERSION pass (seam links tagged `seamTarget`, unwound when the driving anchor is gone); materializeSeam runs for ALL viable nodes (not just target-bearing) so the reversion always fires; stress probe round 4 **8/8 PASS** |
| **DEFECT #11** | Runtime clone-instance nodes reversed as authored children (base truth lost on save) | 2026-08-15 | `clone()` marks `runtimeMinted`; `nodeToLegacy` excludes them (clone-instance is handler-logic only) |

## ARCHIVED / SUPERSEDED (inherited-era records)

| ID | Defect | Resolution |
| --- | --- | --- |
| DEFECT #1 (inherited-era) | `applyOps`/`treeFromOps` fork-arm wire-key miss; self-provider `publishOwn` bypass | Fixed in the rebuild era (findEl bare-wire prefix scan; the bake half resolved by the P3 two-sided-role supersession). Full records: `archive/findings/2026-08-15/2026-08-15-test-findings.md` (stress-loop sections) |
| DEFECT #2/#3 (inherited-era) | `emitElements` leaked `css.cssDef` as a set op; no `styles` op (two surfaces diverge) | Fixed by D4 (styles-op generation + rule-string payloads) |

Detail records: `archive/findings/2026-08-15/2026-08-15-test-findings.md` (blind-test + stress-loop sections).
