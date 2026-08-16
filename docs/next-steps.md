# Next Steps — bookmarked findings (the circle-back list)

Maintained by the document-archival loop (AGENTS.md item 6). When a defect
arises with a CLEAR and DISTINCT fix shape (no user approval needed for a
design choice), the OTHER current findings are bookmarked HERE and the fix
proceeds immediately (design → implementation chain); this document is
circled back to on resolution. Parked/pending decisions and speculative
proposals live in `docs/pending.md` — this file is the work queue of what
to pick up next.

## ACTIVE (in progress now)

| Item | Status | Notes |
| --- | --- | --- |
| **DEFECTS #16/#17/#18 — the bridge round (authored-handler death, seed-layer leak, seam-install containment)** | RESOLVED (2026-08-15) | append-with-override merge; seed-mirror exclusion; per-entry containment. Bridge round 5: 6/6 PASS |
| **DEFECT #12 — ops/supervisor detach/move whole-family-link wipe** | RESOLVED (2026-08-15) | `ops.ts detach` + supervisor `detach`/`move` call `link.destroy()` unconditionally (`parentCount` counts parent anchors — always 1 on a family link), destroying siblings' family edges (they die in the sweep). Safe pattern exists: `payload.ts detachNode`. Fix: shared helper + red tests. Resolve → mark below. |

## QUEUED (clear fix shapes — proceed without a user gate when picked up)

| Item | Fix shape | Source |
| --- | --- | --- |
| **DEFECT #16 — seam handler layer REPLACES the authored base handlers (S45)** | RED: node with base.handlers + a handler-seam layer → BOTH dispatch on their events; compileLocal's handlers merge becomes APPEND-with-override (`[...handlers, ...layer.handlers]`, later layers override same event/phase-name entries), keeping the seam idempotency guards; `run-all-round5.mjs` S45 flips | Stress-test review loop #6 (2026-08-16) |
| **DEFECT #17 — SEED-LAYER LEAK: authored inline handlers double per reverse, COMPOUND per round-trip (S45/S46/S47)** | RED: reverse of a node with an authored inline handler ships EXACTLY ONE entry; second reverse cycle anchor-identical (no seesaw); re-dispatch fires each body ONCE. Implementation: exclude the seed mirror from rawHandlers (filter `sourceName === undefined && id.startsWith('seed-')`) or stop minting the `handlers` copy into the seed layer (node.js:353-359); keep the #14 handler-seam + R-3 exclusions | Stress-test review loop #6 (2026-08-16) |
| **DEFECT #18 — seam-def body compile UNCONTAINED: non-evaluating body aborts the WHOLE compile (S44)** | RED: seam consumer with a non-evaluating def body (`"not-a-function"` / `"42"`) → compile completes, the failing body warns `handler-body-invalid` (seam variant) + is skipped, the node still compiles + renders (the round-3 NP11 discipline extended to the seam path); wrap `compileHandlerBody` (node.ts:1468) in try/catch, skip THAT entry | Stress-test review loop #6 (2026-08-16) |

## PENDING (awaiting the user gate — bookmark, do NOT auto-proceed)

| Item | Gate |
| --- | --- |
| Legacy-handler reuse — the §7 review decisions (8) | legacy-handler-reuse-review.md §7 (PROCEED-WITH-CHANGES) |
| Origin-owner element (layer-apply op) | PARKED — revisit after the §7 gate (review §11/§12 + pending.md PARKED row) |
| Translate-stress probe mismatches (archived red-by-design) | classification + TDD passes (archive/test-data/2026-08-15/) |
| §8-Q6 path-fork ratio re-baseline | after runtime-page stability confirms no explosive time issues |
| RENDER_PROCESS_NOTES → decisions.md fold | a future archival pass |
| Preservation-by-reversal layer flag | future feature (pending.md) |

## RESOLVED (circle-back log)

| Item | Resolved (date) | Fix reference |
| --- | --- | --- |
| DEFECT #12 — ops/supervisor detach/move whole-family-link wipe | 2026-08-15 | defects.md FIXED row + decisions.md |
| DEFECT #13 — multi `handlers.*` seam layers collapse | 2026-08-16 | defects.md FIXED row (accumulation landed — verified live by stress round 5 S43; residue = DEFECT #16) |
| DEFECT #14 — seam handler layers leak into reverse as a zombie inline | 2026-08-16 | defects.md FIXED row (handler-seam reverse exclusion verified live; the distinct seed-layer double-emit = DEFECT #17) |
| DEFECT #15 — def-root `component` bindings silently dropped (N5 bypass) | 2026-08-16 | defects.md FIXED row (defRootData.component propagation verified live by stress round 5 S45; the def-child inert-anchor surface stays a confirmed standing surprise) |
