# Provident-Electron → Preempt-Providence Issue Handoff

This is the issue-handoff document (AGENTS.md item 7): the finished catalogue
of requirement gaps / defects discovered while consuming `provident-ssr` as an
Electron/MCP host. Each row is an issue candidate for the ORIGINAL project
(`Preempt-Providence`, adjacent folder). This repo does NOT fix the package —
the fix shapes below are upstream-owned.

Full catalogue: `docs/defects.md` (this file is the handoff assembly; defects.md
is the living tracker). Where relevant, "consumer workaround" = what
Provident-Electron does today so the gap is not blocking.

---

## Round 1 — REQ-GAP-1..7 (filed 2026-08-21): RESOLVED by provident-ssr 0.1.1

The upstream ran a three-agent change-analysis (`docs/specs/handoffs-review.md`)
and landed the accepted shapes in **provident-ssr 0.1.1**. Disposition per
issue:

| Issue | 0.1.1 landing | This repo's adoption |
| --- | --- | --- |
| REQ-GAP-1 (inline handlers default modern) | **PASS-AS-DOCUMENTED** — FORMAT MARKER + ssr-synthetic-event.md §2.3 sentence | Demo bodies stay modern `(ctx, value)` |
| REQ-GAP-2 (css.id not a runtime lookup key) | **PASS-WITH-RESHAPE** — host-side index documented (css.id is a set; exclude destroyed/unplaced/prototype); NO engine surface | Runtime target resolver maps css.id → nodeId |
| REQ-GAP-3 (id collision + auto-mint) | **PASS-WITH-RESHAPE** — DEFECT #28 (mint-excluded from reverse), precedence doc (`css.id > props.id > mint`), opt-in `renderOptions.nodeIdAttribute` → `data-node-id` | **ADOPTED** — `emitElements(…, { nodeIdAttribute: true })`; every element carries `data-node-id` |
| REQ-GAP-4 (dispatch returns no dirtied / no idempotency) | **PASS** — `Supervisor.dispatchAndReport` ({results, dirtied}, engine-derived) + opt-in bounded `requestId` dedup + public `flush()` | **ADOPTED** — Runtime uses `dispatchAndReport`; host dedup removed |
| REQ-GAP-5 (re-emit loop boilerplate) | **PASS** — `renderProducingProcess` exported + `flush()` | Partial — see REQ-GAP-8 |
| REQ-GAP-6 (DomAdapter needs a DOM) | **CLOSED-ALREADY-ADDRESSED** | Renderer-hosts the graph; IPC bridge |
| REQ-GAP-7 (CSP silently skips string bodies) | **PASS-WITH-RESHAPE** — distinct `handler-body-eval-blocked` warn code + docs | CSP `'unsafe-eval'` stays (environment constraint); the failure is now detectable |

## Round 2 — REQ-GAP-8 (filed 2026-08-21): RESOLVED by provident-ssr 0.1.2

- **Gap**: the exported canonical re-emit loop `renderProducingProcess` could
  not thread the opt-in `nodeIdAttribute` option (the handoffs-review Opening
  A/B planned the loop absorbing the A2 option in the same pass; the 0.1.1
  loop omitted it).
- **0.1.2 landing**: `renderProducingProcess(actionable, nodeById, adapter,
  prevMap, renderOptions?)` — the optional `renderOptions` threads to
  `emitElements`; `{ nodeIdAttribute: true }` stamps `data-node-id`, default
  undefined = byte-identical render. Ownership rules unchanged.
- **This repo's adoption**: the Runtime's re-emit now calls
  `renderProducingProcess(…, { nodeIdAttribute: true })` per adapter (DOM +
  SSR, each with its own caller-owned prevMap). The explicit emit-with-options
  loop is removed. Verified live in Electron (data-node-id DOM=SSR on all 12
  elements; engine dirtied; engine dedup echo; event.value echo).

## Round 3 — no new gaps

0.1.2 closes the catalogue. No new requirement gaps discovered during the
0.1.2 adoption pass. The sole remaining work is consumer-side debugging
niceties (next-steps items: surface `TranslatedTree.warnings` through MCP,
renderer debug panel).

## Round 4 — REQ-GAP-9..12 (filed 2026-08-21, from the E2E-battery plan)

The end-to-end test battery (`docs/specs/e2e-test-battery.md`) needs four
interfaces the package does not provide. All are host-facing conveniences /
documentation gaps (no behavior defects — the battery works around each).

| Issue | Gap | Consumer workaround (this repo) | Proposed fix shape (upstream) |
| --- | --- | --- | --- |
| **REQ-GAP-9** | No public `LinkConfigNameHub` factory; the `loadState`→graph construction is test-only. A1 (single template/content load) can't seed component-bearing nodes without hand-rolling the hub. | The battery host vendors a `hub()`-equivalent (same-name shared-`Link` map) as internal code — risking drift from engine link-sharing semantics (DEFECT #9). | Export a `createLinkHub()` factory; pin the `serializeSlice → loadState → Node(seed, hub)` flow in serialize.md/contract.md. |
| **REQ-GAP-10** | No documented/sanctioned handler-BODY-by-name injection. The fork-stress envelope declares `{name, phase}` handlers (bodies can't be JSON); the host must inject bodies — only the undocumented `Node.addLayer` path exists, ambiguous vs the hooks managed-channel rejections. | The battery host uses `Node.addLayer({ id, handlers:[{name, phase, body}] })` (the upstream fork-stress page pattern) to install `stress-expand` bodies. | Document `addLayer` handler-layer injection as the sanctioned name→body seam for data-only envelopes in handlers.md/translate.md (or add a `registerHandlerBody` helper). |
| **REQ-GAP-11** | No `Supervisor` reset/unregister; destroyed nodes accumulate in the registry. A long-lived host (the battery's no-external-reset requirement) sees `registered` grow unboundedly and every render's `allNodes()` scan cost rise. | The battery accepts registry growth within the run (asserts `inTree`/mount state, not `registered`); a host could rebuild the Supervisor per scenario — an external reset, which the battery must avoid. | Add `Supervisor.reset()` / `prune()` (drop destroyed+unplaced) or a public `unregisterNode`; pin teardown guidance. |
| **REQ-GAP-12** | No single "clear children / reset subtree" op. Teardown-to-root = one `destroy` op per child (4095 for fork-stress d12). | The battery's `provident.teardown` loops destroy ops through the managed channel (one `provident.teardown` MCP call). | A `clear-children`/`reset-subtree` op (destroy+detach+payload-drop in one journaled op) or a documented recipe. |

## Handoff mechanics

- The upstream project receives these as issues (symptom / reproduction / root
  cause / proposed fix shape above). File them against
  `github.com/LittleKingsguard/Preempt-Providence` (or the project's chosen
  tracker). Round 1 issues are closed by 0.1.1; REQ-GAP-8 is the open follow-up.
- None of these require a behavior change in THIS repo to unblock; the consumer
  workarounds are in place.
- Environment-only findings (Node 18 vs Electron 43 tooling, ESM-main CJS
  requirement, MCP SDK stateless-HTTP wiring) are NOT package defects — they are
  recorded in `docs/decisions.md` / `docs/pending.md` for this repo's own
  maintenance.

## Verified state (the workarounds ARE proven)

- Unit: `tests/runtime.test.ts` (9) + `tests/engine-surfaces.test.ts` (5) —
  green (14 total).
- MCP e2e (both transports, standalone server): `tests/mcp-stdio-e2e.test.mjs`
  — green (all four tools over stdio AND Streamable HTTP).
- Real-Electron e2e (0.1.2): MCP client → HTTP → IPC → renderer graph —
  `data-node-id` on all 12 elements (DOM = SSR, via the canonical
  `renderProducingProcess` loop), `provident.dispatch` on `inc` mutates the
  graph + re-renders both views with engine-derived `dirtied`
  (`["node-5","node-3","node-1"]`), engine `requestId` dedup echoes the first
  report (no re-fire), `event.value` echo works, node state works.
- Trio (this repo's gate): `npm test` green, `npm run typecheck` clean,
  `npm run build` clean.