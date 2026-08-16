# Next Steps — bookmarked findings (the circle-back list)

Maintained by the document-archival loop (AGENTS.md item 6). When a defect
arises with a CLEAR and DISTINCT fix shape (no user approval needed for a
design choice), the OTHER current findings are bookmarked HERE and the fix
proceeds immediately (design → implementation chain); this document is
circled back to on resolution. Parked/pending decisions and speculative
proposals live in `docs/pending.md` — this file is the work queue of what
to pick up next.

## PENDING (awaiting the user gate — bookmark, do NOT auto-proceed)

| Item | Gate |
| --- | --- |
| §8-Q6 path-fork ratio re-baseline | after runtime-page stability confirms no explosive time issues |
| RENDER_PROCESS_NOTES → decisions.md fold | a future archival pass |
| Preservation-by-reversal layer flag | future feature (pending.md) |

## RESOLVED (circle-back log)

| Item | Resolved (date) | Fix reference |
| --- | --- | --- |
| Translate-stress probe mismatches (the 8 MISMATCHes) | 2026-08-16 | archive/analysis/2026-08-16/2026-08-16-translate-stress-classification.md — NO genuine engine defects (stale probe expectations predating the mixed-node seed + S19 duplex; archived scenario-doc prediction errors; the plain-consumer reverse drop is payload.md R-2's broadened letter). Probe updated to the classified contracts — 15/15 PASS |
| DEFECT #12 — ops/supervisor detach/move whole-family-link wipe | 2026-08-15 | defects.md FIXED row + decisions.md |
| DEFECT #13 — multi `handlers.*` seam layers collapse | 2026-08-16 | defects.md FIXED row (accumulation landed — verified live by stress round 5 S43; residue = DEFECT #16) |
| DEFECT #14 — seam handler layers leak into reverse as a zombie inline | 2026-08-16 | defects.md FIXED row (handler-seam reverse exclusion verified live; the distinct seed-layer double-emit = DEFECT #17) |
| DEFECT #15 — def-root `component` bindings silently dropped (N5 bypass) | 2026-08-16 | defects.md FIXED row (defRootData.component propagation verified live by stress round 5 S45; the def-child inert-anchor surface + the def-grandchild emission scope are now PINNED STANDING SURPRISES — defects.md #15 row + handlers.md §6) |
| DEFECT #16 — seam handler layer REPLACES the authored base handlers | 2026-08-15 | defects.md FIXED row (append-with-override merge per (name, event); tests D16; bridge round S45) |
| DEFECT #17 — SEED-LAYER LEAK: authored inline handlers double per reverse, COMPOUND per round-trip | 2026-08-15 | defects.md FIXED row (seed-mirror exclusion `!l.id.startsWith('seed-')`; tests D17; S45/S46/S47) |
| DEFECT #18 — seam-def body compile UNCONTAINED: non-evaluating body aborts the WHOLE compile | 2026-08-15 | defects.md FIXED row (per-entry try/catch in rebuildHandlerSeamLayer — `handler-body-invalid` warn + skip; tests D18; S44) |
| DEFECT #20 — destroyed adopted def children still emit (the blocked-def/nodeById emit path ignores the destroyed flag) | 2026-08-16 | defects.md FIXED row (the `defChildPruned` emit-time prune at every def-fill site + the blocked-def reTyped/childOrder filters; tests N4/N5) |
| AUTH-SEAM consumer model — the afterAssembly N5 carve-out + def phase handler copies to the type-target consumer + def-children re-homing + retention destroy | 2026-08-16 | decisions.md AUTH-SEAM row + legacy-bridge AU1-AU3 |
| Legacy-handler reuse — the §7 review decisions (8) | 2026-08-15 | pending.md PENDING row (all 8 decisions adopted/superseded/landed with the bridge; decision 8's rejects stand) |
| Origin-owner element (layer-apply op) | 2026-08-15 | decisions.md ORIGIN-OWNER + HANDLER-SEAM rows; ops.md §2.8 (OO-1..OO-7 pins) |
