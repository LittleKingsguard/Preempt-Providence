# Spec — SSR Synthetic-Event Contract (Phase B, 2026-08-20)

Status: LANDED (reviewed `docs/specs/ssr-synthetic-event-review.md` — verdict
PROCEED, user go-ahead 2026-08-20). The Phase B follow-on to the Phase A
`Supervisor.dispatchEvent` engine entry (decisions.md EVENT-DISPATCH-WIRING
row; handlers.md §3). THIS IS A CONTRACT + HARNESS LAYER — **no engine, no
adapter, no render change** (Phase A's `dispatchEvent` and the
`SSRFragmentAdapter` are reused unchanged).

The page input is a LEGACY envelope + the producing process (the same
translate → register → compile → recordResolved → emit pipeline the DOM
pages use). The deliverable is: this contract + the parity harness
(`tests/e2e/ssr-synthetic-event.test.ts`) that encodes the six pins below.

## 1. Problem — why SSR needs its own contract

SSR is a BUILD-TIME ARTIFACT: `SSRFragmentAdapter` emits an HTML string; the
fragment has **no wire identity** (no `dataset.wire` — only `css.id` when
authored) and its handler surface is the **inert** inline attr
`on<event>="true"` (emitElements merges `on:<event> = true`; DOM-F12 pins
that a runtime inline `onclick="true"` is a no-op). There is no event loop,
no listener, and no live DOM to mutate on the HTML itself.

The "identical to the DOM" framing — that an SSR page behaves like a live DOM
page (dispatch on the HTML, the HTML "reacts") — is therefore a CATEGORY
ERROR and is excluded (review §2.5).

The legitimate need: a NON-DOM host (server process, Electron/MCP main, a
test harness) that rendered an SSR fragment must still be able to DRIVE the
interaction — against the graph that PRODUCED the fragment.

## 2. The contract

### 2.1 Producing-process-keeps-graph (P1)

The process that rendered the SSR fragment KEEPS the live graph it used:
`translateLegacy(env)` → `Supervisor` + `EventBridge` → register all nodes →
ONE bootstrap `compile` → `recordResolved`. The HTML string and the graph
co-exist; `toString()` does NOT end the process's ability to dispatch.

### 2.2 Fragment-as-addressable-metadata (P2)

The fragment is metadata for LOCATING a render target in the producing graph,
not a live surface. Two targeting modes:

- **Ergonomic** — an AUTHORED `css.id` on a fragment element resolves to the
  producing node(s) carrying that `css.id` (the producer knows its own nodes'
  `css.id`).
- **Authoritative** — the producing process targets its own `nodeId`/`wire`
  directly (the exact Phase A vocabulary).

NO new render attribute is added (adding `data-wire` to SSR output would
violate the no-render-change pin and PAR-4/NVS-7 "no SSR-only render path").

### 2.3 Inert inline attr — never the dispatch channel (P3)

The fragment's `on<event>="true"` is inert (DOM-F12). It does NOT carry the
handler body and is NEVER the dispatch channel. The synthetic event targets
the producing graph (resolved by `css.id`→node or by nodeId/wire) and runs
the graph's compiled handlers through the Phase A engine stub
(`event.value = args[0]`, `event.type = event`).

### 2.4 Graph-canon, fragment-is-a-view (P4)

A synthetic event MUTATES the producing graph (a body's `clientAPI.apply`
lands on the microtask flush). The HTML does NOT react: dispatching never
re-renders (Phase A trigger-not-journal / never-flush / never-emit pins). The
producing HOST may RE-EMIT a fresh fragment on demand through the SAME
`SSRFragmentAdapter` (no renderer change); the re-emitted view reflects the
applied state.

### 2.5 Parity harness (P5)

The same envelope rendered through `DomAdapter` AND `SSRFragmentAdapter`; the
same synthetic event dispatched on each producing graph:
- **Identical `HandlerResult[]`** (the dispatch is on the graph — adapter-
  independent).
- **Post-apply re-emit structural parity** (PAR-5) via the adapter-neutral
  oracle `treeFromOps`/`treeSig` — the canonical op-stream trees are equal.
- The harness encodes all six pins as tests so the contract cannot silently
  drift.

### 2.6 Consumers + flush discipline (P6)

Consumers are NON-DOM hosts: server-side interaction tests (the
`tests/e2e/*` precedent), Electron/MCP main processes driving a server-
rendered flow, and parity verification. NOT a browser (browsers get real DOM
events + hydration, render.md §7). Payload is IN-PROCESS (the producing
process keeps the graph) so raw args are fine — no structured-clone (that is
Phase C's cross-process concern). The host AWAITS the flush before asserting
(Phase A discipline). Reentrancy/containment/no-propagation pins carry over
unchanged (handlers.md §3).

## 3. Non-goals (unchanged)

- No engine change (Phase A `dispatchEvent` is the primitive).
- No adapter change (`SSRFragmentAdapter` unchanged; no `data-wire`).
- No render/emit/diff change.
- No "the HTML reacts" surface (SSR has no live DOM).
- Phase C (cross-process MCP/Electron endpoint — structured-clone args,
  idempotent `requestId`, flush-before-response, `{results, dirtied}`)
  stays parked spec-only.

## 4. Execution

The parity harness `tests/e2e/ssr-synthetic-event.test.ts` encodes the six
pins (P1 producing-process-keeps-graph + inert inline attr, P2 css.id→node
addressability, P4 dispatch-never-renders + re-emit-on-demand, P5 DOM/SSR
identical results + treeSig parity). It is the verification that the contract
holds on the current engine. Trio: green.

Encoding: `docs/decisions.md` EVENT-DISPATCH-WIRING row (Phase B LANDED),
`docs/pending.md` Phase B row, `docs/next-steps.md`.
