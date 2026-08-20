# SSR Synthetic-Event Contract — Phase B Feasibility Review (2026-08-20)

Status: design review of the proposed Phase B "SSR synthetic-event contract"
(the user-gated follow-on to Phase A `Supervisor.dispatchEvent`, decisions.md
EVENT-DISPATCH-WIRING row §Phase B; event-dispatch-wiring-review.md §2.5/§4).
No code changed by this document. Companion context: `src/core/adapters.ts`
`SSRFragmentAdapter` (§4), `docs/specs/render.md` §7 (SSR flow) + §8 (parity),
`docs/specs/adapters.md` §4/§10.2 (FRG-*) + §3.2/§10.1 (DOM-F12 inert inline
attr), `docs/specs/handlers.md` §3 (`supervisor.dispatchEvent`), the
build-demo builders (`scripts/build-demo.mjs`, `feature-showcase-page.mjs` —
the existing "producing process keeps the graph" pattern), `tests/e2e/`
(server-side interaction tests), and the Phase A review disposition
(`docs/specs/event-dispatch-wiring-review.md` §2.5 Gap D).

## 1. What the proposal asks

Phase B = a FORMAL SSR synthetic-event contract. Framing (as recorded in
pending.md / the Phase A review):
- **Producing-process-keeps-graph** — the process that rendered the SSR
  fragment keeps the live graph (the `Supervisor` + compiled states) it used
  to emit the HTML, instead of discarding it after `toString()`.
- **Fragment-as-addressable-metadata** — the SSR HTML fragment is metadata
  for LOCATING a render target in the producing graph (vocabulary: `css.id`
  + process-side wire resolution), not a live surface.
- **Parity harness, no render change** — same input → same dispatch → same
  results whether the render went through `DomAdapter` or
  `SSRFragmentAdapter`; the render/emit machinery is unchanged.

The rejected framing (the category error §2.5 already recorded): "identical
to the DOM" — that an SSR page behaves like a live DOM page (a client
dispatches on the static HTML and the HTML "reacts"). SSR is a build-time
artifact with no event loop, no listener, and no live DOM to mutate.

## 2. Grounding — what actually exists

1. **SSR output carries NO wire identity.** `SSRFragmentAdapter.createEl`
   produces `{ openTag, closeTag, contentText, isVoid }`; there is no
   `dataset.wire` (the DOM adapter's wire channel). The fragment's only
   identity-bearing attribute is `css.id` WHEN AUTHORED (FRG-H4) — optional
   and not guaranteed. `on:<event>` sets surface as the INERT inline attr
   (`onclick="true"` — emitElements merges `on:<event> = true`, FRG-H8; the
   DOM-F12 rule pins that a runtime inline `onclick="true"` is a no-op).
2. **The dispatch primitive already exists (Phase A).** `Supervisor.
   dispatchEvent(target, event, ...args)` resolves Node / nodeId / wire to a
   live graph node, dispatches the compiled handlers with the legacy event
   stub (`event.value = args[0]`, `event.type = event`), returns the contained
   `HandlerResult[]`, and is a trigger (never a journal entry, never drains/
   flushes/emits — the host awaits the flush). This is the exact primitive a
   producing process needs to drive an interaction against its own graph.
3. **The "producing process keeps the graph" is the existing builder/server
   pattern.** `build-demo.mjs` builders (feature-showcase, legacy-shape,
   handlers-scenarios, session-features) run the SAME core pipeline
   (translate → register → compile → recordResolved) server-side to compute
   the expected census / parity / the `.expected.html` via the real
   `SSRFragmentAdapter`. The process keeps the graph and the HTML together.
4. **Server-side interaction testing is the established e2e precedent.**
   `tests/e2e/legacy-bootstrap`, `ssr-render`, `markdown-display` translate →
   dispatch on the graph → assert — no browser involved. Phase B formalizes
   this into a contract + parity harness.

## 3. Feasibility verdict

**FEASIBLE — and it is overwhelmingly a CONTRACT + HARNESS deliverable, not a
new engine feature.** Phase A already supplies the dispatch primitive; the
producing-process-keeps-graph is the builder pattern; the parity oracle
(`treeFromOps`/`treeSig`) already reconstructs both sides. The work is: pin
the addressability + graph-canon semantics, and build a small harness +
tests that drive the same interaction through both adapters and assert
identical results. The as-framed "no render change" is HONORED (nothing in
the emit/diff/apply machinery changes); the "identical to the DOM" parity
framing is correctly rejected (confirmed: SSR has no wire identity and inert
inline attrs — there is nothing on the HTML to dispatch into).

## 4. Gaps / decisions the contract must pin

1. **Addressability is `css.id`-only in the fragment (and optional).** The
   fragment has no wire/dataset. The contract must pin BOTH targeting modes:
   (a) ERGONOMIC — an authored `css.id` on the fragment element resolves to
   the producing node(s) carrying that `css.id` (the producer knows its own
   nodes' `css.id`); (b) AUTHORITATIVE — the producing process targets its own
   `nodeId`/`wire` directly. The fragment is a VIEW for locating targets, not
   the only addressing surface. **NO new render attribute** (adding a
   `data-wire` to SSR output would violate the "no render change" pin and
   PAR-4/NVS-7 "no SSR-only render path").
2. **Graph-canon, fragment-is-a-view.** A synthetic event MUTATES the
   producing graph (a body's applies land on the flush). The contract must
   state: the HTML does not react; the producing process MAY re-emit a fresh
   fragment on demand through the SAME `SSRFragmentAdapter` (no renderer
   change), and a parity harness asserts the re-emitted view reflects the
   applied state.
3. **Inline `on<event>="true"` is inert — never the dispatch channel.** The
   contract must not claim the SSR inlined attrs drive anything (DOM-F12).
   The synthetic event targets the producing graph, resolved by `css.id`→node
   or by nodeId/wire.
4. **Consumers are non-DOM hosts**: server-side interaction tests (the e2e
   precedent), Electron/MCP main processes driving a server-rendered flow,
   and parity verification (DOM vs SSR produce identical dispatch results).
   NOT a browser — browsers get real DOM events + hydration (render.md §7).
5. **Payload + flush discipline.** The same legacy stub via Phase A
   (`event.value = args[0]`, `event.type = event`). Phase B is IN-PROCESS
   (the producing process keeps the graph), so raw args are fine — NO
   structured-clone requirement (that is Phase C's cross-process concern).
   The producing host awaits the flush before asserting results (Phase A's
   trigger-not-journal/never-drain pins).
6. **Parity harness shape.** Reuse `treeFromOps`/`treeSig` as the oracle:
   render the same envelope through `DomAdapter` AND `SSRFragmentAdapter`,
   dispatch the same synthetic event on each producing graph, await the
   flush, and assert (a) identical `HandlerResult[]` and (b) the post-apply
   re-emitted trees are structurally equal (PAR-5). No new adapter surface.

## 5. Cost / benefit

- **Cost:** a spec (`docs/specs/ssr-synthetic-event.md`) + one parity harness
  (reusing existing oracles) + a handful of tests. **No engine change, no
  adapter change, no render change.** Phase A's `dispatchEvent` is reused
  unchanged.
- **Benefit:** the SSR/non-DOM host gets a FORMAL dispatch seam with DOM parity
  (server-side interaction testing, Electron/MCP main-process flows,
  post-interaction re-emit verification); the Phase B gate closes with a
  documented contract instead of an informal "the e2e tests just do it".
- **Non-goals honored:** never "the HTML reacts" (no live surface on SSR);
  no renderer/adapter change; the `onEvent` DOM seam + Phase A engine entry
  stay the two DOM paths (unchanged).

## 6. Verdict

**PROCEED (user gate) — formalize Phase B as `docs/specs/ssr-synthetic-event.md`
+ a parity harness, with the six pins above.** It is a documentation +
harness contract layered on the already-landed Phase A primitive, NOT new
engine code. The "identical to the DOM" parity remains a category error and is
excluded. Phase C (the cross-process MCP/Electron endpoint — structured-clone
args, idempotent `requestId`, flush-before-response, `{results, dirtied}`)
stays parked spec-only and is unaffected by this review.

Record: this review feeds the EVENT-DISPATCH-WIRING decision row's Phase B
gate (`docs/decisions.md`), `docs/pending.md` (Phase B row), and
`docs/next-steps.md` (the pending Phase B gate).
