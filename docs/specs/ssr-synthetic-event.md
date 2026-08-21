# Spec — SSR Synthetic-Event Contract (Phase B, 2026-08-20; shared-surface + host-utility extensions 2026-08-21)

Status: LANDED (reviewed `docs/specs/ssr-synthetic-event-review.md` — verdict
PROCEED, user go-ahead 2026-08-20). The Phase B follow-on to the Phase A
`Supervisor.dispatchEvent` engine entry (decisions.md EVENT-DISPATCH-WIRING
row; handlers.md §3). THIS IS A CONTRACT + HARNESS LAYER — **no engine, no
adapter, no render change** (Phase A's `dispatchEvent` and the
`SSRFragmentAdapter` are reused unchanged).

**Extensions landed 2026-08-21 (handoffs-review §C/§D + the doc bundle):** the
shared multi-host dispatch surface (`dispatchAndReport` + `flush` + opt-in
bounded `requestId` dedup — §3 below), the exported canonical re-emit loop
`renderProducingProcess` (§2.4), the opt-in `data-node-id` render option
(§2.2 + §4 — the ONE scoped lift of the no-render-change pin), the css.id
host-index pins (§2.2), the format-convention note (§2.3), and the flush
discipline upgrade (P6). All per the user rulings 2026-08-21 (A2 / B / C / D2;
docs/specs/handoffs-review.md §D).

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

**css.id host-index pins (2026-08-21 — handoffs-review REQ-GAP-2):** the
css.id→node mapping is HOST-SIDE (the producer builds its own one-time index
from its translated nodes — the consumer's `list_targets` precedent). Three
pins: (i) **css.id is a SET, not a key** — multiple nodes may carry the same
authored css.id; a host index must return/flag MULTIPLE matches, never pick
one silently; (ii) the index must **EXCLUDE `destroyed` / `unplaced` /
`prototype` nodes** — the dispatch guard (`dispatchEvent`) rejects only
destroyed/unplaced, so a prototype passes the guard and dispatches `[]`
silently; a host index that returns prototypes produces the silent-`[]` trap;
(iii) `node.props.id` is NOT a css.id source — the rendered `id` precedence
(`css.id` > authored `props.id` > the `preempt-node-<id>` mint, node.md §4)
means a host reading `node.props.id` off a rendered attribute is lied to when
only a css.id was authored (DEFECT #28 letter).

**No new render attribute by default (2026-08-21 — the ONE scoped lift):** the
no-render-change pin + PAR-4/NVS-7 "no SSR-only render path" stay — with the
single scoped exception of the OPT-IN `renderOptions.nodeIdAttribute` option
(§4 below), default OFF. Phase B hosts must not depend on rendered-HTML shape;
the opt-in flag exists only for hosts that explicitly ask for element→graph
traceability.

### 2.3 Inert inline attr — never the dispatch channel (P3)

The fragment's `on<event>="true"` is inert (DOM-F12). It does NOT carry the
handler body and is NEVER the dispatch channel. The synthetic event targets
the producing graph (resolved by `css.id`→node or by nodeId/wire) and runs
the graph's compiled handlers through the Phase A engine stub
(`event.value = args[0]`, `event.type = event`).

**Handler-format note (2026-08-21 — handoffs-review REQ-GAP-1):** the stub's
`(event, context)` arg convention applies to the SEAM/`format:'legacy'`
WRAPPED path only (handlers.md FORMAT MARKER). INLINE `NodeData.handlers`
bodies default to `'modern'` — the body's first param receives the scoped
HandlerContext (`(ctx, ...args)`), NOT the event stub. A host that authored an
inline body must not expect legacy arg order unless `format: 'legacy'` was
explicit (the compiled `HandlerDef` carries no runtime format marker — the
data surface is the authoring truth).

### 2.4 Graph-canon, fragment-is-a-view (P4)

A synthetic event MUTATES the producing graph (a body's `clientAPI.apply`
lands on the microtask flush). The HTML does NOT react: dispatching never
re-renders (Phase A trigger-not-journal / never-flush / never-emit pins). The
producing HOST may RE-EMIT a fresh fragment on demand through the SAME
`SSRFragmentAdapter` (no renderer change); the re-emitted view reflects the
applied state.

**The canonical re-emit loop is EXPORTED (2026-08-21 — handoffs-review REQ-
GAP-5, user ruling B):** `renderProducingProcess(actionable, nodeById,
adapter, prevMap)` (src/index.ts) — the harness loop promoted verbatim
(`emitElements → diffMinimal → applyOps`; `takePass2States` is the CALLER's
drain). Ownership rules (pinned): (i) the caller OWNS the per-tree `prevMap`
(the function never keeps module-level render state — cross-tree state leaks
corrupt `diffMinimal` baselines); (ii) destroyed / not-in-tree nodes are
pruned before emit (the harness's `prevStates` delete); (iii)
`takePass2States` is consumed by the caller — the function never drains it;
(iv) ON-DEMAND ONLY — calling it never implies dispatch (P4: dispatch never
re-renders; the loop is the host's explicit re-emit). All hosts (Electron +
future) consume ONE loop implementation — no copy-paste drift.

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

**Flush discipline — PUBLIC `flush()` (2026-08-21 — user ruling D2):**
`Supervisor.flush(): Promise<void>` awaits a DETERMINISTIC settle —
`while (hasPendingWork()) await oneTaskBoundary` — replacing the divergent
hand-rolled `setTimeout(0)` tick loops (the harness used 8 ticks; other
harnesses used 1-4). The microtask flush cascade is bounded, so the settle is
deterministic without magic tick counts. Pins untouched: the never-flush-on-
dispatch pin is about the ENGINE (dispatchEvent never flushes internally);
a host-called `flush()` is exactly what the pins assume exists. The §3
`dispatchAndReport` uses it internally; hosts use it for their own drains and
re-emit timing.

## 3. Shared multi-host dispatch surface (REQ-GAP-4 — LANDED-AS-SPEC 2026-08-21)

The `{results, dirtied}` + idempotency shape is a SHARED use case (Electron +
future implementation projects — user directive 2026-08-21): ONE contract,
engine-owned, not per-host derivation.

### 3.1 `dispatchAndReport(target, event, options, ...args): Promise<DispatchReport>`

`DispatchReport = { results: HandlerResult[]; dirtied: NodeId[] }`.

- **ADDITIVE** — the Phase A `dispatchEvent` (sync, `HandlerResult[]`,
  trigger-only) is UNCHANGED; hosts needing the report use the new method.
- **Resolution + containment identical** to `dispatchEvent` (wire/nodeId
  resolution, destroyed/unplaced → empty report, reentrancy guard, throwing
  bodies contained in `results`).
- **Flush-before-response:** the method awaits `flush()` (P6) internally, then
  takes pass-2 states, then returns. The caller's graph is settled when the
  promise resolves — no host-side tick loops.

### 3.2 `dirtied` — the pinned derivation

`dirtied = apply().dirtied ∪ keys(takePass2States())` — **bounded, non-draining**
(`apply` already returns its `dirtied: NodeId[]`; `takePass2States` is the
renderer's own drain — the method takes it as the CALLER of the report, never
from inside a handler getter). Explicit rejections (pinned): **journal-
snapshot derivation** (O(journal) per dispatch — pins in the exact cost the
host complained about; the journal stays append-only for replay), and
**`takePass2States` from handler getters** (renderer-owned drain).

### 3.3 Idempotency — OPT-IN bounded `requestId` dedup

`options.requestId` registers the (target, event) pair in a **bounded LRU
window** (cap + TTL — never the rejected unbounded store):

- **Registered SYNCHRONOUSLY at call entry** (before any await) — two
  concurrent calls with the same requestId collapse: the duplicate awaits the
  first call's in-flight promise and returns the FIRST caller's report
  (idempotent ECHO — the shape an MCP host wants).
- **NOT journaled, process-local:** the window dies on `loadState`/restart —
  correct (dedup windows never survive restarts in any scheme; hosts mint
  fresh requestIds per session). Trigger/replay semantics untouched.
- **Best-effort under pressure:** LRU eviction/TTL expiry may drop an entry —
  hosts remain safe by construction (a dropped entry re-fires; the contract is
  exactly-once-within-window, not at-least-once-free).
- Zero cost for hosts that never pass `requestId`.

### 3.4 Parity

The parity harness extends to the report surface: DOM and SSR producing
processes produce IDENTICAL `results` and `dirtied` for the same dispatch
(dispatch is on the graph — adapter-independent; §2.5).

## 4. Opt-in `data-node-id` render option (REQ-GAP-3 option (b) — user ruling A2)

The ONE scoped lift of the no-render-change pin: an OPT-IN render option
`renderOptions: { nodeIdAttribute: true }` threaded through
`emitElements(actionable, nodeById, renderOptions)` → the element
construction sites → both adapters.

- **Default OFF.** Every existing pin, snapshot, and profile baseline is
  untouched; only opting hosts pay.
- **When ON:** every emitted element gains `data-node-id="<minted nodeId>"`
  (e.g. `node-3`) — DOM `setAttribute` + SSR attribute. The rendered `id`
  attribute is unchanged (css.id > authored props.id > mint precedence,
  DEFECT #28).
- **Purpose (the user's requirement):** an agent viewing the HTML an Electron
  render produced can TRACE every element back to its producing graph node
  (nodeId) to confirm validity — element → `data-node-id` → `Supervisor`
  node → compiled state. The `id` attribute alone cannot serve this (it is
  css.id/props.id/mint dependent).
- **Presence is NOT guaranteed:** readers must know their renderer opted in
  (the option is a renderer decision, never a reader assumption).
- The pin lift is scoped to the flag: no other render change rides it, and the
  flag is the only sanctioned new attribute (no `data-wire`, no re-typing of
  the `id` attribute).

## 5. Non-goals (updated)

- Phase A `dispatchEvent` is UNCHANGED (the §3 method is additive).
- No adapter change OUTSIDE the opt-in flag's attribute routing; no `data-wire`.
- No render/emit/diff change OUTSIDE the opt-in flag (default renders identical).
- No "the HTML reacts" surface (SSR has no live DOM).
- Phase C (cross-process MCP/Electron ENDPOINT — transport, structured-clone
  args) stays parked spec-only: the ENGINE surface endpoints sit on (§3) lands;
  the transport/endpoint layer itself does not.

## 4. Execution

The parity harness `tests/e2e/ssr-synthetic-event.test.ts` encodes the six
pins (P1 producing-process-keeps-graph + inert inline attr, P2 css.id→node
addressability, P4 dispatch-never-renders + re-emit-on-demand, P5 DOM/SSR
identical results + treeSig parity). It is the verification that the contract
holds on the current engine. Trio: green.

Encoding: `docs/decisions.md` EVENT-DISPATCH-WIRING row (Phase B LANDED),
`docs/pending.md` Phase B row, `docs/next-steps.md`.
