# Spec — Multi-Graph / Registry Isolation (hub-keyed graph scope)

**Status**: SPEC (gate PROCEED-AS-RESHAPED 2026-08-25 —
`docs/specs/multi-graph-isolation-review.md`; this spec is the D1-D8 contract).
**Target**: roll into the 0.2.0 test package (`@littlekingsguard/provident-ssr`
0.2.0-rc.2). **Date**: 2026-08-25.

## Purpose

Give a multi-graph host (the Provident-Electron shell) an OPT-IN way to render
an operator-only Security pane in its own provident graph, isolated from the
agent-visible app graph — no cross-graph addressability (an agent with access to
graph A can never see, dispatch, or read graph B). The DEFAULT (no opt-in) is
byte-identical to today: one module-level registry shared by all graphs.

## The D1-D8 contract

- **D1 — Scope = explicit graph-scope object, keyed on hub identity for
  isolation.** A `GraphScope` holds the per-graph registry sets. The DEFAULT
  scope IS the current module singleton (zero-change). An ISOLATED scope is
  created only on explicit host opt-in, and is keyed on the graph's hub so the
  guarantee is structural. **The opt-in, not hub presence, decides isolation.**
- **D2 — Per-scope handlerDefs resolution + compilation (the SECURITY-CRITICAL
  acceptance criterion).** An isolated graph resolves AND compiles handler-def
  bodies only from its OWN def registry. A graph-B security-pane handler body is
  NEVER resolved/compiled/executed in a graph-A consumer binding the same name.
  **Acceptance test:** an isolated graph must never resolve or compile a
  handler-def body registered in any other scope.
- **D3 — Per-scope `byId`/`resolveNodeRef`/`registered`.** Node constructor
  self-registration (node.ts:437) + serialized-parent resolution (node.ts:456)
  stay scope-local for an isolated graph.
- **D4 — Per-scope `translateUserData`.** An isolated graph carries its own
  userData slot (no single-slot clobber).
- **D5 — Guard the plain layer-apply teardown.** `teardownMinted` (node.ts:725)
  must use the same `parent === target`/scope guard the keyed rows path already
  has (ops.ts:377) — a graph-A `removeLayer` must never cross-destroy graph-B's
  minted set.
- **D6 — Hub-tagged single sweep coalescer.** ONE module timer; per-scope
  `pendingDestroy`/dirty partition/destroy sets. Preserves the coalesced-sweep
  efficiency; NOT a per-scope timer.
- **D7 — EventBridge-per-graph.** Graph A events never reach graph B (the host
  passes a distinct bridge per isolated graph; pinned as host responsibility).
- **D8 — Default `'shared'` = module singleton, non-breaking.** The default
  resolves to the CURRENT module-level registry. A default host calling
  `translateLegacy(doc)` (fresh hub per call) or `new Supervisor({ events })`
  (hub-less) never isolates. **Regression gate:** the full trio + the existing
  cross-graph tests (same-id re-seeded graphs sharing `byId`, ADV-C-S12
  def-census, ADV-KEYED-S15 parent guard) pass UNCHANGED with no opt-in.

## Surface (minimal, additive)

A `GraphScope` object with per-graph copies of the registry sets + sweep state.
The module-level functions in `registry.ts` operate on the DEFAULT scope when no
scope is supplied (back-compat — the ~15 accessor signatures stay unchanged for
the default path). The isolated path passes the scope explicitly.

Opt-in: an option threaded through `translateLegacy(doc, { graphScope })`,
`new Supervisor({ graphScope })`, `loadState`, and `renderProducingProcess` so
translate + supervisor + render agree on one scope.

## Non-goals (pinned)

- NO reset/prune/unregister surface (the REQ-GAP-11 shapes stay REJECTED).
- NO change to the single-graph default behavior or its tests.
- The two-package-instances fallback stays captured in the review but is NOT
  built here (a single instance is required).

## Validation

Red→green→verify (AGENTS.md item 8): TDD set encodes D1-D8 — the isolation
guarantee (D2 handlerDefs, D3 byId, D4 userData, D5 teardown, D6 sweep) + the
non-breaking default (D8 — all existing tests pass unchanged, no opt-in). Then
the full trio (`npm test`, `npm run typecheck`, `npm run demo:smoke`) + the
cross-graph regression watch (d12 pass2/compile multiples — the hub-tagged
coalescer must not blow up pass-2).
