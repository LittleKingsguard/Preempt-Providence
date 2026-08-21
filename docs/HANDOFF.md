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

## Issue 1 — REQ-GAP-1: inline handler bodies default to MODERN; the legacy `(event, context)` stub is not the synthetic-event default

- **Observed symptom**: A handler authored as an inline `handlers: [...]` body
  in the legacy `(event, context)` convention ran with WRONG argument order on
  `Supervisor.dispatchEvent` — the body received the HandlerContext as its
  `event` param, so `context.clientAPI` was undefined and the body threw
  (contained). The Phase B contract (ssr-synthetic-event.md §2.3) says the
  synthetic event runs "the engine stub (`event.value = args[0]`, `event.type =
  event`)" — an MCP/Electron host cannot rely on that for inline-authored
  handlers.
- **Reproduction**: `translateLegacy({template:{root:{type:'div',handlers:[
  {name:'x', event:'click', body:'function(event,context){…}'}]}}})` → dispatch
  with args. The body's `event` is the scoped HandlerContext, `context` is
  undefined unless `format:'legacy'` is authored.
- **Suspected root cause**: translate.ts FORMAT MARKER — inline `handlers`
  bodies default to `'modern'` (unwrapped, `(ctx, ...args)`); the legacy
  `(event, context)` wrapper is installed ONLY for the seam/component-binding
  form (`target:'handlers.<event>` + `{name, body}` value, seam default legacy)
  or an explicit `format: 'legacy'`.
- **Proposed fix shape (upstream)**: (a) document the split explicitly in
  ssr-synthetic-event.md + handlers.md (inline default = modern; the legacy
  stub is the wrapped-handler path only); (b) OR expose a handler introspection
  helper (`handler.format` / `sourceBody` already exist) so a host can detect
  the convention before dispatching.
- **Consumer workaround**: demo bodies authored in the modern `(ctx, value)`
  convention (the upstream feature-showcase precedent).

## Issue 2 — REQ-GAP-2: runtime lookup is nodeId/wire-scoped; css.id is a render attribute only

- **Observed symptom**: `context.tree.getNode('counter')` returned undefined and
  `clientAPI.apply('counter', …)` rejected (`unknown-node`) — 'counter' is an
  authored css.id, not the minted nodeId. The Phase B "ergonomic css.id → node"
  targeting (ssr-synthetic-event.md §2.2) is therefore HOST-side today; a
  handler body cannot reach a sibling by css.id.
- **Reproduction**: any handler body doing `ctx.tree.getNode(<cssId>)` /
  `clientAPI.apply(<cssId>, …)`.
- **Suspected root cause**: `Supervisor.getNode` / `ClientAPI.apply` /
  `dispatchEvent` resolve the minted nodeId/wire only; css.id never enters the
  runtime lookup surface.
- **Proposed fix shape (upstream)**: add a documented lookup on the public
  surface (`Supervisor.findByCssId(id)` or a generic `findNode(predicate)`) +
  pin in ssr-synthetic-event.md that the css.id→node mapping is host-side.
- **Consumer workaround**: the renderer Runtime's target resolver maps css.id →
  nodeId (both vocabularies accepted by `provident.dispatch`).

## Issue 3 — REQ-GAP-3: two "id" vocabularies + an auto-mint collide in emitted HTML

- **Observed symptom**: `node.props.id` is auto-minted to `preempt-node-<id>`
  when absent (node.ts `ensureAutoIds`); both `props.id` and an authored
  `css.id` emit as the same rendered `id` attribute. An agent reading rendered
  HTML cannot tell which id a dispatch target should use; `props.id` (demo
  targeting) and `css.id` (Phase B ergonomic vocabulary) are different
  concepts with no canonical "the rendered id".
- **Reproduction**: render any node with an authored css.id and no props.id;
  the emitted `id` attribute is the auto-mint, and an authored props.id on
  another node collides with a css.id-only reader's expectation.
- **Suspected root cause**: two independent id systems + an auto-mint fill.
- **Proposed fix shape (upstream)**: (a) document the auto-mint in
  translate.md/node.md; (b) consider a single DOM/SSR `data-node-id` attribute
  (would need a decision — the "no render change" Phase B pin applies);
  (c) a host-side listing helper is the minimum viable answer.
- **Consumer workaround**: `provident.list_targets` reports nodeId + cssId +
  propsId per node.

## Issue 4 — REQ-GAP-4: `Supervisor.dispatchEvent` returns no apply/dirtied info; the host derives it from the journal

- **Observed symptom**: For the Phase C `{results, dirtied}` shape, the host
  must diff the unbounded `journal` (no "since X" query) to learn what a
  dispatch mutated. `requestId` idempotency is entirely host-side (the
  `dispatchingEvents` guard is per-dispatch reentrancy only).
- **Reproduction**: two separate `dispatchEvent` calls with the same logical
  request re-fire (no cross-call idempotency); `dirtied` is not returned.
- **Suspected root cause**: Phase A pins dispatch as a trigger with no apply
  reporting.
- **Proposed fix shape (upstream)**: when Phase C lands, pin the `{results,
  dirtied}` derivation (journal-snapshot vs `takePass2States`) and whether
  idempotency is engine or host concern; document the recommended host pattern
  in ssr-synthetic-event.md §3.
- **Consumer workaround**: the renderer Runtime implements requestId dedup +
  journal-derived dirtied.

## Issue 5 — REQ-GAP-5: dispatch never re-renders; the re-emit loop is host-built boilerplate

- **Observed symptom**: Documented (Phase A: never flush/emit) but there is no
  one-call convenience for a non-DOM host wanting "dispatch → flush →
  re-render → observe". Every MCP host re-implements the render() loop
  (emitElements → diffMinimal → applyOps on both adapters).
- **Reproduction**: any non-DOM host calling `dispatchEvent` then expecting the
  HTML to reflect the mutation (it does not until the host re-emits).
- **Suspected root cause**: no host-facing runtime helper exists.
- **Proposed fix shape (upstream)**: extract/publish the canonical
  "producing-process render loop" as a documented host utility (or a future
  companion package); pin the re-emit-on-demand contract in ssr-synthetic-event.md
  §2.4.
- **Consumer workaround**: the renderer Runtime's `render()` after each flush.

## Issue 6 — REQ-GAP-6: `DomAdapter` requires a DOM at construction

- **Observed symptom**: `new DomAdapter(mount)` throws when `document` is
  undefined (adapters.ts). The Electron MAIN process is not a DOM, so the full
  synthetic-event + rendered-HTML MCP surface must live in the renderer; the
  IPC bridge is mandatory.
- **Reproduction**: construct `DomAdapter` in a Node/Electron-main context.
- **Suspected root cause**: designed browser-only (correct).
- **Proposed fix shape (upstream)**: document the constraint in
  adapters.md/serialize.md ("non-DOM hosts must use SSRFragmentAdapter +
  producing-process graph").
- **Consumer workaround**: graph + DomAdapter in the renderer; MCP server in
  main; IPC bridge (this repo's architecture).

## Issue 7 — REQ-GAP-7: strict CSP silently skips function-STRING handler bodies

- **Observed symptom**: Under a strict `script-src 'self'` CSP, every
  function-STRING handler body is SILENTLY SKIPPED at translate — the node
  compiles with `handlers: []`, `dispatchEvent` returns `[]`, the page renders
  dead. No error surfaces to the host (the translate warning is contained).
- **Reproduction**: load a provident-ssr page (data-only envelope with string
  bodies) in a CSP-enforced document without `'unsafe-eval'`; dispatch any
  event.
- **Suspected root cause**: `instantiateHandlerBody` uses `new Function` at
  translate (translate.ts); CSP blocks eval and the error is caught + skipped
  (`handler-body-invalid` warn).
- **Proposed fix shape (upstream)**: (a) document in translate.md/handlers.md
  that function-SOURCE bodies require eval / are CSP-incompatible without
  `'unsafe-eval'`; (b) surface skipped handlers programmatically (the
  `TranslatedTree.warnings` exists — pin that hosts must read it to detect
  silently skipped handlers).
- **Consumer workaround**: the renderer CSP allows `'unsafe-eval'` (trusted app
  data). The app's Runtime could also read `translateLegacy` warnings and
  surface them through MCP — a future nicety (next-steps item).

---

## Handoff mechanics

- The upstream project receives these as issues (symptom / reproduction / root
  cause / proposed fix shape above). File them against
  `github.com/LittleKingsguard/Preempt-Providence` (or the project's chosen
  tracker).
- None of these require a behavior change in THIS repo to unblock; the consumer
  workarounds are in place.
- Environment-only findings (Node 18 vs Electron 43 tooling, ESM-main CJS
  requirement, MCP SDK stateless-HTTP wiring) are NOT package defects — they are
  recorded in `docs/decisions.md` / `docs/pending.md` for this repo's own
  maintenance.

## Verified state (the workarounds ARE proven)

- Unit: `tests/runtime.test.ts` (7) — green.
- MCP e2e (both transports, standalone server): `tests/mcp-stdio-e2e.test.mjs`
  — green (all four tools over stdio AND Streamable HTTP).
- Real-Electron e2e: MCP client → HTTP → IPC → renderer graph — dispatch on
  `inc` mutates the graph + re-renders (live DOM + SSR), `dirtied` reported,
  `requestId` dedup works, `event.value` echo works.
- Trio (this repo's gate): `npm test` green, `npm run typecheck` clean,
  `npm run build` clean.