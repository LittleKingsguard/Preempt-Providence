# HANDOFF-6 — Provident-SSR 0.2.0 batch: post-Feature-2 pick-up

Agent handoff (2026-08-24). This is the authoritative queue for the NEXT agent
that picks up after the **Feature 2 demo page + Mimo-2.5 blind-test loop** runs.
Read `docs/next-feature-batch-0.2.0.md` FIRST (the single authoritative plan;
all 26 user rulings in §User rulings). The batch dependency spine: **1 → 1a**
(un-parked rows) → **1b** → **2/3/4** (independent, any order after 1).

## Batch status (2026-08-24, ALL trio green: `npm test`, `npm run typecheck`,
`npm run demo:smoke`)

| Feature | Gate | TDD | Status |
| --- | --- | --- | --- |
| 1 rows demo gate | ✅ | ✅ rows-fanout + rows-scenarios + rows-blind-test | **LANDED** — blind-test loop COMPLETE |
| 1a def-prototype round-trip | ✅ handoffs-review-5.md | ✅ def-roundtrip.test.ts (9) | **LANDED** |
| ⚠ ADVERSARIAL fix queue (1a+1) | ✅ | ✅ rows-mint-guardrails.test.ts (25) | **COMPLETE** (defects.md ADVERSARIAL-* FIXED) |
| 1b keyed batch-reuse | ✅ handoffs-review-6.md (D1-D14) | ✅ keyed-batch-reuse (22) + keyed-reuse-guardrails (6) | **LANDED** + ADVERSARIAL-1b fix round COMPLETE |
| 2 MarkdownAdapter | ✅ handoffs-review-7.md (D1-D15) | ✅ markdown-adapter (20) + markdown-adapter-guardrails (11) + G-PRE-ESCAPE/G-INLINE-FILTER (6) | **FULLY LANDED — trio green 1153.** ADVERSARIAL-MD fix round COMPLETE + DEMO + BLIND-TEST COMPLETE + **REVIEW RESOLUTIONS (2026-08-25): D14 mode-toggle MarkdownAdapter arm LANDED (mode-toggle markdown 14 checks — feature-matrix doc through the real adapter, `renderFeatureMatrixMarkdown()`); MD-PRE-ESCAPE FIXED (fence content literal); MD-INLINE-FILTER FIXED (inlineContent pulls true inline only)** |
| **2 demo page + blind-test** | — | — | **✅ COMPLETE (2026-08-24/25)** — review: archive/findings/2026-08-24/2026-08-24-markdown-blind-test-review.md |
| 3 journal condensing | ✅ gate — **PROCEED-AS-RESHAPED (handoffs-review-8.md, D1-D10)** | ✅ **TDD LANDED (2026-08-25 — journal-condensing.test.ts, 16 tests; trio green 1169)** | **LANDED (engine). D14 demo arm + blind-test loop PENDING (AGENTS.md item 10 — Mimo-2.5; the next action)** |
| 4 preservation-by-reversal flag | ⏳ gate | — | ready (rulings §4) |
| 0.2.0 publish | — | — | after 2/3/4 + trackers sweep |

## ⏳ FIRST: the Feature 2 demo page + blind-test loop (AGENTS.md item 10)

The MarkdownAdapter is ENGINE-LANDED but its **demo page is not built**, and
AGENTS.md item 10 requires the blind-test loop (writer → proofreader →
page-reviewer) on a **demo page** before completion. The `?mode=markdown`
fixture in `demo/mode-toggle.*` shows the RAW editor source (NOT the adapter
output) — do not conflate them; the new demo page wires the adapter through
`renderProducingProcess`.

**Blind-test model constraint (AGENTS.md item 10):** the writer / proofreader /
page-reviewer sub-agents run on the **Mimo-2.5 model**. If the delegation
mechanism exposes no model override, **PAUSE and wait for the user to switch
the model** — never run the loop with a different model. (This session's
earlier blind tests ran on the default model at the user's explicit
"Ignore model requirements" instruction — re-confirm before starting.)

The demo page must exercise, per the D14 contract (handoffs-review-7.md):
- a document with headings, lists (incl. nested), emphasis, links, a
  blockquote, a fenced `pre`, and a transparent-container-wrapped list (the
  S17 fix), driven through the adapter;
- assert the `toString()` output (the checks);
- the on-request delivery via `renderProducingProcess(…, adapter)`.

Blind-test output (per AGENTS.md item 10c): any real-vs-intended mismatch is a
**data-only** fix in the demo page (engine is FIXED and must NOT be touched in
this loop). Full reports → `archive/findings/<date>/…`; merge findings into the
trackers.

## THEN the remaining batch order (after the demo + blind-test)

1. **Feature 3 — journal condensing** (gate ✅ → TDD ✅ → **demo arm + blind-test loop ⏳**). Gate verdict:
   `docs/specs/handoffs-review-8.md` (PROCEED-AS-RESHAPED, D1-D10 — merged-only
   restore, handler-faithful replay bounded to post-base, undo/redo/replay id-
   resolve evicted refs to the restored graph, graph-REPLACE critical section,
   deferred+size-guarded condense, marker result shape, append-only pins
   amended, rows/defs composition, shipped-vs-lost scope, memory-win honesty).
   Rulings §3.18-3.20. Composes with Feature 1a's serialize/defPrototypes.
   **TDD LANDED 2026-08-25** (journal-condensing.test.ts, 16 tests; trio green
   1169). **NEXT: the D14 condensing demo arm + AGENTS.md item-10 blind-test
   loop (Mimo-2.5).**
2. **Feature 4 — preservation-by-reversal flag** (gate → TDD → trio). Rulings
   §4 (layer field `preserveByReversal`, whole-subtree cascade, re-mint on
   re-translate, compression into normal authored nodes on reverse). The ONE
   reverse site: `nodeToLegacy` (translate.ts, the M1 note).
3. **Publish 0.2.0** + trackers sweep (decisions.md ×5 new rows,
   pending.md LANDED moves, next-steps.md RESOLVED, designing-pages §11/§12,
   adapters.md §MarkdownAdapter already in, ops.md §6 base-boundary row,
   HANDOFF-6 note if the consumer battery surfaces follow-ons).

## Key engine state the next agent needs (already landed + guardrailed)

- **rows-mint/rows-clear**: atomic (S3), contained targets (S1/S2), the
  no-promotion replace + clear (S8b/S9), fresh minted ids (S13), anchors veto
  (S14), JSON-safe batches (S16), def-root fallback (S7).
- **keyed batch-reuse**: the D1 O(N) reuse-match (keyField source-anchor
  VALUE), D2 whole-op degrade, D4 prune + frozen shape, D5 keep-first, D6
  op-keyField-authoritative + re-arm, D7 clear, D8 preRecord exact-inverse
  undo, D9 preRecord-preserved replay, D10 minted/reused/removed, D11
  silent-abort walk, D12 identity = stable (wire, forkKey), D13 boundary,
  D14 O(N). Guardrails: S15 cross-graph parent guard, S22 undo skipKindGate,
  S16/S5-S10 re-arm reshape, S17 mint-path hub, S18 decls filter.
- **MarkdownAdapter**: the type→marker table, parent-based lists, element-type
  emphasis, escaping, on:*/data:/css:* dropped, splice-identity append + DETACH
  removeEl, empty→'', the new parity family (NOT PAR-5). Guardrails: S17 block
  recurses lists, S1/S2 block-child recursion, S3 pre fencing, S4 title escape,
  S5 empty-li, S6 li block-child indent.

## Defect/decision provenance (all FIXED — nothing open blocks the batch)

- `docs/defects.md`: OPEN holds only documented dispositions (S10 hooksKind
  authoritative, S11 unreachable, S12b rescue zombie, S6b children-only census);
  ALL engine defects are in FIXED with fix references.
- `docs/decisions.md`: ADVERSARIAL-CENSUS / ADVERSARIAL-FIX-PASS /
  KEYED-BATCH-REUSE / MARKDOWN-ADAPTER rows (the landed contract).
- `docs/pending.md`: the speculative rows flipped to LANDED / PLANNED for the
  remaining features.

## Trackers to touch as work proceeds (AGENTS.md item 6)

- `docs/next-steps.md` (the work queue + RESOLVED log),
- `docs/pending.md` (parked/pending rows + revisit conditions),
- `docs/defects.md` + `docs/decisions.md` (active/fixed rows),
- `docs/skills/designing-pages.md` §11 coverage matrix + §12 demo list (after
  each feature + the demo page),
- `docs/specs/*` (the per-feature contract; the verdict files are the gate
  record).

## Suggested pick-up prompts (delegate per AGENTS.md item 8/9)

1. **Blind-test loop** (after the demo page exists): writer (docs-only, Mimo-2.5)
   → proofreader → page-reviewer; data-only fixes.
2. **Feature 3 gate**: DONE 2026-08-25 → handoffs-review-8.md (D1-D10).
3. **Feature 3 TDD** (the next delegation): red set in journal-condensing.test.ts
   (15) → implement D1-D10 → trio → trackers (decisions.md journal-condensing
   row, ops.md §6 base row, contract.md:222 amendment).
4. **Feature 4 gate**: validity + critique (parallel) → change-analysis →
   `handoffs-review-9.md`.
4. Each gate → TDD (red→green→verify) → trio → trackers.
