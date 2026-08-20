# Retained Handler Map — Step-3 Change-Analysis Verdict

Status: **APPROVED-WITH-CONDITIONS** (three-agent gate, 2026-08-20), disposition
**ADAPT-AND-PROCEED** — implementation awaits the user go-ahead (AGENTS.md item
9: "a passing review plus the user's go-ahead"). No code changed. Companion
context: `docs/specs/adapters.md` (§3.2 `on:` row, R7 undefined-drop row,
§3.7 :316-318), `RENDER_PROCESS_NOTES.md:598` (S-R5.7 divergence park),
`src/core/adapters.ts` (:81-88 createEl, :122-128 `on:` branch, :149-159
removeEl), `src/core/render.ts` `diffMinimal` (:83-92 removed-prop re-set),
`src/core/render-helpers.ts` (:897/:1163 — `on:<evt>` = constant `true`;
:1159 — fork arms never emit `on:`), `docs/defects.md` DOM-F5 pins.
Inputs: step-1 (validity, FEASIBLE-WITH-CHANGES) + step-2 (critique,
APPROVE-WITH-CONDITIONS) findings; every code claim below re-verified against
the current source.

## What the proposal asks

Un-park the two `DomAdapter` parks (adapters.md §3.7 :316 additive `on:`
listener, :317 listener-removal; S-R5.7 RENDER_PROCESS_NOTES.md:598) via a
retained handler map: `Map<wireKey(wire, forkKey), Map<evtName, {el, fn}>>`.
Set = REPLACE (remove old exact fn + `addEventListener` new + store the fn);
set `undefined` = `removeEventListener(evt, retained.fn)` + delete; purge on
`removeEl` (:149-159) and duplicate `createEl` (:81-88 — the old element stays
mounted, DOM-F4); `SSRFragmentAdapter` untouched.

## Feasibility verdict

**Feasible.** The change is confined to the `DomAdapter` `on:` branch
(adapters.ts:122-128) plus the two cleanup sites; the abstract `RenderAdapter`
needs no new member (forkKey already forwards via the structural cast, S-R5.2);
per-instance view state is an existing pattern (`wires`/`stylesSeen`/
`batchEls`/`reused`). Both reviews converge. Step 1's blocking gaps confirmed:
both El shims lack `removeEventListener` (adapters.test.ts:26-81;
legacy-shape-emit.test.ts:250) and DOM-F5 (adapters.test.ts:464-469) directly
asserts the semantics being flipped — the new detach path would TypeError
without the shim additions.

## Gaps + costs-benefits

**Blocking (must fix in the landing pass):**
- (a) Add `removeEventListener(evt, fn)` — deleting the exact fn from the
  shim's `listeners[evt]` array — in `adapters.test.ts` El mock,
  `legacy-shape-emit.test.ts` (no-op addEventListener), and
  `scripts/smoke-shim.mjs:67`.
- (b) Supersede DOM-F5 (:464-469) with a replace-semantics pin (two sets →
  exactly ONE listener; last-fn dispatch wins).
- (c) Record the flip as DECIDED — do not silently reverse. adapters.md:316's
  "a listener-dedupe registry is state the pure consumer does not hold"
  rationale is already false (the adapter holds wires/stylesSeen/batchEls);
  declare the retained map DERIVED/REPLAYABLE state — a pure function of
  (op stream, `onEvent`) — so journal/replay/hydrate stay pinned.

**Correctness conditions:**
- Duplicate-createEl purge must call `removeEventListener` on the OLD
  still-mounted element, not just map-delete, else the orphaned listener
  fires forever (the proposal's strongest justification).
- `removeEl` purges retained entries BEFORE `el.remove()`.
- Honest framing: wins are (1) undefined actually detaches, (2) orphan
  cleanup on dup-create/removeEl, (3) DOM detach converges with the SSR
  attr-drop — NOT "differential handler dispatch". The constant-`true` emit
  (render-helpers.ts:897/:1163) makes same-`event`-name BODY swaps invisible
  to `diffMinimal` regardless.

**Discipline requirements:**
- Weatherstrip: never recreate wrappers per attach — exact-ref removal fails
  otherwise (store the exact closure passed to addEventListener).
- Per-event-name entries (multi-`on:` nodes must not collapse).
- Re-entrancy: self-removal during dispatch — the test El iterates the LIVE
  listener array (skip-siblings semantics); author tests accordingly.
- Memory: retained fn→el refs can leak only via OUT-OF-OP-STREAM innerHTML
  twiddling (the pipeline always removes through ops) — accept + document.
- `forkKey` is NOT forwarded to the closure today (dispatch passes the bare
  `wire`); harmless because fork arms never emit `on:` (render-helpers.ts:1159)
  — forward forkKey NOW as future-proofing, not a fix.
- Hydrate seam: SSR HTML carries a native `onclick="true"` attr coexisting with
  the addEventListener listener (double slot; the native one is a no-op) — add
  a regression test so nobody later inlines a real SSR handler; pin that an
  `on:` on a reused (css.id) element lands via `wires`.

**Perf:** negligible — O(1) `on:`-branch only; non-`on:` branches, compile,
pass-2 untouched; no d12 profile impact (`on:` props are constant-`true` and
never re-emit unchanged).

**Costs:** ~1 code region, 3 shim lines, ~5 new/inverted tests, ~8 doc rows
(adapters.md :211/:214/:316/:317, S-R5.7, trackers, designing-pages.md
§11/§14), one DECIDED entry. No speculative machinery.

**Alternatives weighed (step 3):** WeakMap<el, …> fails the dup-createEl path
(needs a parallel wireKey→oldEl map — defeats the point); a per-node array is
a wash; document-level delegation breaks per-node dispatch semantics
(no `currentTarget`, breaks per-node stopPropagation) and diverges from SSR;
parking leaves four real defect classes open. Keep the proposed map.

## Disposition

**ADAPT-AND-PROCEED** — one TDD pass when the user gives the go-ahead:
(a) **red** — shim updates + DOM-F5 replacement + new pins (undefined detach,
removeEl purge, dup-create purge on the old element, multi-event per node,
replace == 1 listener, SSR double-slot + reused-element `on:` bind);
(b) **green** — implement the map in `DomAdapter` only;
(c) validation trio (`npm test` / `npm run typecheck` / `npm run demo:smoke`,
watching the d12 profile totals per AGENTS.md item 4);
(d) docs + S-R5.7 amendment + DECIDED record + trackers in the same pass.
Residual with honest framing: same-`event`-name body swaps stay invisible;
out-of-stream DOM twiddling can still orphan — documented.
