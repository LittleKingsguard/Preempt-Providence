# Handoff (REQ-GAP-1..7) — Change-Analysis Review (step 3 of the three-agent gate)

Status: **change-analysis review of the 7 upstream change requests** in `docs/HANDOFF.md`
(the `provident-ssr` consuming-host handoff). Synthesizes the step-1 validity and
step-2 critique outputs. No files changed. Companion context: `docs/specs/ssr-synthetic-event.md`
(Phase A/B pins), `docs/specs/handlers.md` §3 (FORMAT MARKER), `docs/specs/translate.md`,
`docs/specs/adapters.md` / `contract.md` (DOM constraint), `docs/specs/render.md` §8/§9
(PAR-4/NVS-7), `docs/specs/npm-packaging-review.md`, `docs/specs/event-dispatch-wiring-review.md`,
`docs/specs/derived-fork-variants-review.md`, `docs/defects.md` (DEFECT #14), the Phase A/B
decisions rows, `archive/reviews/2026-08-15/2026-08-15-compile-horizon-review.md` (format
template). Findings verified against `src/core/{supervisor,translate,node,render-helpers,adapters,types,client,legacy-handlers,handlers,derived}.ts`
and `tests/e2e/ssr-synthetic-event.test.ts`.

## 1. Status

Per-issue gate disposition (the step-1 validity verdict is retained except where the
step-2 critique and my own re-read correct it):

| Issue | Step-1 validity | Step-2 critique risk | **Gate** |
| --- | --- | --- | --- |
| REQ-GAP-1 inline bodies default MODERN | VALID-WITH-CHANGES | LOW | **PASS-AS-DOCUMENTED** (doc-only; optional introspection sugar deferred) |
| REQ-GAP-2 css.id runtime lookup | VALID-WITH-CHANGES | MEDIUM (engine variant) | **PASS-WITH-RESHAPE** (host-side one-time index at translate; NO engine surface) |
| REQ-GAP-3 id collision + auto-mint | VALID | HIGH (option b) | **PASS-WITH-RESHAPE** (a + c + precedence doc + reverse-leak ruling; option (b) **REJECT** pending user override) |
| REQ-GAP-4 dispatch returns no dirtied | VALID (Phase C parked) | LOW | **PARK** (deferred to Phase C; pin the Phase C derivation now, no engine change) |
| REQ-GAP-5 re-emit loop boilerplate | VALID-WITH-CHANGES | MEDIUM | **PASS-WITH-RESHAPE** (exported on-demand utility, per-tree prevMap; or park behind the companion-package decision) |
| REQ-GAP-6 DomAdapter requires DOM | ALREADY-ADDRESSED | LOW | **CLOSED-ALREADY-ADDRESSED** (no work) |
| REQ-GAP-7 strict CSP silently skips bodies | VALID | MEDIUM | **PASS-WITH-RESHAPE** (doc pins + distinct `handler-body-eval-blocked` warn code) |

**Overall disposition:** no issue is a REJECT as a whole; all work proceeds **only**
after the user's go-ahead (AGENTS.md item 9) and lands through the item-6 step gates
(specs first, TDD red→green, validation trio). Sequencing:
1. **Pass 1 (doc-only bundle, one pass + validation trio):** REQ-GAP-1, REQ-GAP-2
   (doc half), REQ-GAP-4 (Phase C derivation pin), REQ-GAP-7 (a) doc — all pure
   `docs/specs/*` + tracker updates, no engine/render change.
2. **Pass 2 (optional small code, TDD):** REQ-GAP-7 (b) distinct warn code;
   REQ-GAP-3 reverse-leak exclusion (if ruled a defect fix); REQ-GAP-2 host-side
   index helper (consumer-side precedent, low risk).
3. **User-gated decisions:** REQ-GAP-3 option (b) (`data-node-id` — needs a ruling to
   reverse the no-render-change pin; REJECT by default); REQ-GAP-3 reverse-leak
   (exclude vs accept+document — a decision, see §5); REQ-GAP-5 utility placement
   (core export vs future companion package — NPM-PACKAGING already points at the
   latter).

## 2. What the proposals ask

- **REQ-GAP-1** — document that inline `handlers` bodies default to `'modern'`
  (`(ctx, ...args)`), that the legacy `(event, context)` stub is the wrapped
  seam/`format:'legacy'` path only, and/or expose a handler introspection helper so a
  host can detect the convention before dispatching.
- **REQ-GAP-2** — a documented runtime lookup for authored `css.id` (engine
  `Supervisor.findByCssId` / `findNode(predicate)`) so handler bodies can reach a
  sibling by css.id, plus a pin that the css.id→node mapping is host-side.
- **REQ-GAP-3** — reconcile the two "id" vocabularies (`props.id` auto-mint vs authored
  `css.id`) that both emit to the same rendered `id` attribute: (a) document the
  auto-mint, (b) optionally a single DOM/SSR `data-node-id` attribute, (c) a host-side
  listing helper.
- **REQ-GAP-4** — when Phase C lands, pin the `{results, dirtied}` derivation
  (journal-snapshot vs `takePass2States`) and whether idempotency is engine or host
  concern.
- **REQ-GAP-5** — publish/extract the canonical "dispatch → flush → re-emit" producing-
  process render loop as a documented host utility (or future companion package); pin
  re-emit-on-demand in the synthetic-event contract.
- **REQ-GAP-6** — document that `DomAdapter` requires a DOM at construction and that
  non-DOM hosts use `SSRFragmentAdapter` + the producing-process graph.
- **REQ-GAP-7** — document that function-SOURCE bodies require eval / are
  CSP-incompatible without `'unsafe-eval'`, and pin that hosts must read
  `TranslatedTree.warnings` to detect silently skipped handlers.

## 3. Feasibility verdict per issue

### REQ-GAP-1 — PASS-AS-DOCUMENTED

Agree with both steps. The doc half is already LANDED (`handlers.md:253-258`,
`translate.md:76-81` — FORMAT MARKER: inline defaults `'modern'`, seam-installed defs
default `'legacy'`, explicit `format` overrides, `handler-format-invalid` warn). Two
remaining gaps confirmed by my re-read:

- `ssr-synthetic-event.md` §2.3 (P3) describes the engine stub
  (`event.value = args[0]`, `event.type = event`) without noting the inline-default-
  modern split — a host reading §2.3 alone is still misled. Add one sentence to §2.3:
  "the stub convention applies to seam/`format:'legacy'` wrapped bodies; inline bodies
  default to `'modern'` (`ctx, ...args`) — see handlers.md FORMAT MARKER."
- **No runtime-visible format marker on the compiled `HandlerDef`** (`types.ts:318` —
  `{ name, event?, phase?, body? }`; only `node.base.handlers` retains
  `format`/`sourceBody`). This is a *runtime introspection gap* only. The step-2
  "minimal" recommendation is right: **doc-first; introspection is optional sugar** and
  must be weighed against the NPM-PACKAGING "no new surface without a consumer"
  discipline. A handler body that needs to know its own convention should be authored
  with an explicit `format` — the data author controls the marker. I do **not** support
  adding a `format` field to `HandlerDef` this round (no runtime consumer of it exists;
  `getNodeView`/`receiveNextState` already surface `sourceBody` for reverse).

### REQ-GAP-2 — PASS-WITH-RESHAPE (host-side only)

Agree with the validity finding (css.id never enters the runtime lookup surface:
`Supervisor.getNode` = `nodes.get(id)` only, `clientAPI.apply` → `getNode`,
`dispatchEvent` → `resolveDispatchTarget` = nodeId or `#`-wire prefix; the Phase B
css.id→node ergonomic targeting is host-side by design, `ssr-synthetic-event.md` §2.2
P2 + the no-new-render-attribute pin at :52-53). **Agree with the critique's engine-
variant rejection** — an engine `Supervisor.findByCssId` is un-landed new surface,
explicitly out of Phase B's "no engine change" scope, and the critique's correctness
points are verified:

- **css.id is NOT unique** — `QueryUtils.findNodes` matches by equality on
  `node.css.id` (presence semantics, `legacy-handlers.ts:92-105`); `DomAdapter.hydrate`
  collects a *set* of css.ids (adapters.md §5.1).
- **`allNodes()` includes prototypes** (`supervisor.ts:118-120` — every registered
  node), and **`dispatchEvent` guards only destroyed/unplaced**
  (`supervisor.ts:185`) — so a prototype passes the guard and dispatches `[]`
  silently. An engine `findByCssId` without a prototype/destroyed filter would surface
  exactly this.

**Accepted shape (minimal, host-side):** a host-side **one-time index built from
`TranslatedTree.nodes` at translate** (map css.id → matching node(s); the consumer's
`list_targets` precedent, `tests/e2e/ssr-synthetic-event.test.ts` `cssIdToNode`), with
the docs pin in `ssr-synthetic-event.md` §2.2 that (i) css.id→node is host-side,
(ii) css.id is a set, not a key — a host must return/flag multiple matches, and
(iii) the index must exclude `destroyed`/`'unplaced'`/`'prototype'` nodes to match the
dispatch guard's semantics. **No `Supervisor.findByCssId` / `findNode(predicate)`
engine surface** without a new consumer need.

### REQ-GAP-3 — PASS-WITH-RESHAPE (a + c + precedence doc; option (b) REJECT)

The core observation is VALID and verified: `ensureAutoIds` mints `props.id` at
construction (`node.ts:439/:992/:1858-1861`); `emitOne` pushes `prop:id` then `css:id`
into the same attribute space, and the adapters apply `css:id` over `prop:id`
(`adapters.ts:130-131`), so both vocabularies converge on one rendered `id` attribute
with no canonical "the rendered id". But **the handoff's reproduction is factually
wrong**, as the critique states — verified against the code: with an authored `css.id`
and no authored `props.id`, the **rendered id is the css.id (css overwrites the mint)**,
not the auto-mint. This changes the symptom: the reader-side collision is real, but it
is *reversed* from the handoff — the rendered id may read as the css.id while
`node.props.id` reports the mint, so a host reading `props.id` off the rendered
attribute (or off the node view) can be lied to.

The critique's overlooked items are verified and must be folded in:
- **(i) REVERSE LEAK (confirmed)** — `nodeToLegacy` emits `data.props = { ...node.props }`
  (`translate.ts:1158`) and `node.props` is the `pass1.props` getter (`node.ts:581-582`),
  which `ensureAutoIds` seeded with the mint — so the auto-mint leaks into reversed
  legacy JSON (`json-out ≠ json-in`; same leak class as DEFECT #14's reverse shipping
  of what was never authored, `defects.md` #14).
- **(ii) `props.id` is already a reserved derived key** — `derived.ts:113`
  (`collides with the auto-id (ensureAutoIds)`) and `translate.ts:525-527`
  (`props.id collides with the reserved derived key; no apply`). The mint is a
  documented derived reservation; adding a third `data-node-id` attribute on top of it
  multiplies the vocabulary confusion rather than resolving it.
- **(iii) reader-facing collision** — rendered id = css.id while `node.props.id`
  reports the mint/authored value.

**Accepted shape (minimal):** (a) document the auto-mint in `translate.md`/`node.md`
(the constructor table at `node.md:149` already records the fill — needs the *precedence
rule* and the *reverse-leak consequence* added); (c) the host-side listing helper
(`list_targets` precedent) stays the minimum viable answer; **drop option (b)
(`data-node-id`)** — it collides directly with the Phase B no-render-change pin and
PAR-4/NVS-7 (`render.md:393/:408`), changes every emitted-HTML snapshot/diff baseline
and the derived-fork family profile pins, and cannot proceed without an explicit user
override. Plus two new doc pins: (iv) the **precedence rule** (`css.id > authored
`props.id` > mint` for the rendered `id` attribute) and (v) the **reverse-leak
decision** — either exclude the minted `props.id` in `nodeToLegacy` (round-trip
restoration; a defect-fix shape) or accept-and-document that reverse carries the mint
(a decision; needs a user ruling, §5).

### REQ-GAP-4 — PARK (deferred to Phase C) + pin the derivation now

The factual core is VALID and verified: `dispatchEvent` returns `HandlerResult[]` only
(`supervisor.ts:183-190`), the journal is an unbounded append-only array
(`supervisor.ts:90`) with no "since X" query, and cross-call `requestId` idempotency is
entirely host-side (the `dispatchingEvents` guard is per-(node,event) reentrancy only).
But the fix **is literally Phase C**, parked spec-only (`ssr-synthetic-event.md:100-102`,
`docs/pending.md` SPECULATIVE row) — no engine change is in scope for this handoff.
Verified: `Supervisor.apply` **already returns `dirtied`** (`supervisor.ts:514` et seq.
— `{ status: 'applied', journalId, dirtied }`), journal entries carry `result.dirtied`,
and `takePass2States()` exists (`supervisor.ts:226-230`).

**Accepted shape:** with Phase C, the only work now is a **doc pin** in
`ssr-synthetic-event.md` §3 recording the Phase C derivation the critique approves:
**`dirtied = apply().dirtied ∪ keys(takePass2States())` after the awaited flush —
bounded, non-draining** (read `takePass2States` results, not the journal). Explicit
**rejections** recorded now: (a) **journal-snapshot derivation is the WRONG axis** —
diffing the unbounded journal per dispatch is O(journal) and pins in the exact cost the
host complains about; (b) **`takePass2States` must never be called from handler
getters** — it is renderer-owned and *draining*; (c) idempotency stays **host-side** —
never an engine `requestId` store (the `requestId` dedup belongs to the Phase C
endpoint / the host Runtime, which already implements it).

### REQ-GAP-5 — PASS-WITH-RESHAPE (on-demand utility; placement behind packaging decision)

VALID-WITH-CHANGES. The P4 re-emit-on-demand pin is LANDED (`ssr-synthetic-event.md`
§2.4). The canonical loop exists **only as harness code**
(`tests/e2e/ssr-synthetic-event.test.ts:164-179`): every non-DOM host re-implements
`emitElements → diffMinimal → applyOps` on both adapters. Verified: **all pieces are
already exported** (`src/index.ts:37-39` — `emitElements`, `diffMinimal`, `applyOps`,
`DomAdapter`, `SSRFragmentAdapter`), so this is a *convenience*, not new capability —
which is exactly why NPM-PACKAGING (`docs/decisions.md`) directs host utilities to
**future separate packages** ("Electron/Express implementations are FUTURE SEPARATE
packages — no server entry in this package").

**Accepted shape:** if it ships, extract the harness `render()` **verbatim** as an
exported on-demand utility `renderProducingProcess(actionable, nodeById, adapter,
prevMap)` with the critique's mandatory ownership rules: (i) **must own per-tree
`prevMap`** — module-level state leaks across trees and corrupts `diffMinimal`
baselines (the harness's closure scoping is per-test; an exported module-level default
would not be); (ii) prune destroyed/not-in-tree nodes before emit (the harness's
`prevStates` prune); (iii) `takePass2States` consumed as the **caller's** drain, never
internally; (iv) **on-demand only — must not touch P4** (never auto-re-render). The
placement is a user-gated decision: into `provident-ssr` core (against the NPM-
PACKAGING direction) vs a documented host-side pattern now + the future companion
package. Given NPM-PACKAGING, my recommendation is: **document the canonical loop in
`ssr-synthetic-event.md` §2.4 with the verbatim harness body and its ownership rules
now, and defer the exported utility to the companion-package gate.**

### REQ-GAP-6 — CLOSED-ALREADY-ADDRESSED

Agree with both steps; **SAFE, accept as-is, no work**. Verified: `DomAdapter`
constructor throws a descriptive error without a global `document`
(`adapters.ts:76-79`; `contract.md:361` DECIDED row; `adapters.md:105/:314`); the
environment row is in `npm-packaging-review.md:34/:115`; `ssr-synthetic-event.md` §2.6
routes non-DOM hosts to `SSRFragmentAdapter` + the producing-process graph. Close it.

### REQ-GAP-7 — PASS-WITH-RESHAPE (doc pins + distinct warn code)

VALID. Verified: `instantiateHandlerBody` uses `new Function` at translate
(`translate.ts:457-463`), the failure is caught and skipped with
`handler-body-invalid` (`translate.ts:375-378`), and `TranslatedTree.warnings` exists
(`translate.ts:167-179`). The path is **trusted-backend-gated** (`translate.ts:452-455`
— the backend/DB layer must gate writes to admin/trusted-developer), so CSP blocking is
an *environment constraint* on an already-trusted path — but the **silence is real**
and verified: a CSP `EvalError` produces the **same** `handler-body-invalid` warn code
as a genuine syntax error (`translate.ts:377`), so a host cannot distinguish
"environment blocked" from "authoring error".

**Accepted shape:** (a) the doc pin in `translate.md`/`handlers.md` (function-SOURCE
bodies require `'unsafe-eval'` / are CSP-incompatible without it; the renderer performs
no authorization — the trusted-backend gate is the contract), AND (b) a **distinct
warn code `handler-body-eval-blocked`** branched off an `EvalError`/"Refused to
evaluate" signature before the generic `handler-body-invalid`, plus the host-must-read-
`warnings` pin in `ssr-synthetic-event.md`/`handlers.md`. This is the one small engine
touches — TDD (red→green) with a mocked-eval-block test. The generic
`handler-body-invalid` stays for genuine syntax errors.

## 4. Gaps + costs-benefits (per accepted item)

### REQ-GAP-1 (doc-only)
- **Work:** add one §2.3 sentence to `ssr-synthetic-event.md` (inline-default-modern vs
  seam-default-legacy). Optional: fold the introspection-note into `handlers.md`
  FORMAT MARKER (no code).
- **Cost:** near-zero (doc + trio re-run).
- **Benefit:** removes the exact misread that produced the handoff's REQ-GAP-1 symptom.
- **Must NOT do:** add a `format` field to compiled `HandlerDef` this round (no runtime
  consumer; new surface against NPM-PACKAGING discipline).

### REQ-GAP-2 (host-side index + docs)
- **Work:** `ssr-synthetic-event.md` §2.2 pins (css.id→node is host-side; css.id is a
  *set*; index excludes destroyed/unplaced/prototype). Optional consumer-side helper
  documented from the `list_targets`/`cssIdToNode` precedent — no engine change.
- **Cost:** doc-only (low); helper = consumer-side code outside this repo.
- **Benefit:** closes the silent-`[]`-dispatch trap for prototype matches and the
  non-uniqueness hazard before any host builds on css.id.
- **Must NOT do:** `Supervisor.findByCssId` / `findNode(predicate)` without filters;
  any engine lookup surface.

### REQ-GAP-3 (a + c + precedence + reverse-leak)
- **Work:** `translate.md`/`node.md` auto-mint documentation **including the precedence
  rule** (`css.id > authored props.id > mint`) and the corrected reproduction; the
  host-side listing helper stays consumer-side. Separate, user-gated: the reverse-leak
  exclusion in `nodeToLegacy` (mint-exclude, restoring lossless round-trip) vs
  accept-and-document.
- **Cost:** doc (low); reverse-leak exclusion = a small TDD code change if ruled a
  defect fix; the corrected reproduction is a doc correction, not engine behavior.
- **Benefit:** a reader/host can tell which id a dispatch target should use; restores
  the json-in/json-out invariant the mint currently breaks.
- **Must NOT do:** `data-node-id` (or any new rendered attribute) **without explicit
  user override** — it reverses the no-render-change pin, breaks PAR-4/NVS-7, and
  re-baselines every emitted-HTML snapshot + the derived-fork profile pins.

### REQ-GAP-4 (parked, Phase C)
- **Work:** `ssr-synthetic-event.md` §3 pin recording the Phase C derivation
  (`dirtied = apply().dirtied ∪ takePass2States() keys`, awaited-flush-bounded,
  non-draining) + the rejection notes.
- **Cost:** doc-only.
- **Benefit:** freezes the correct Phase C contract now so the Phase C gate doesn't
  re-litigate the wrong axis.
- **Must NOT do:** journal-snapshot derivation (O(journal) per dispatch);
  `takePass2States` from handler getters (renderer-owned, draining); engine
  `requestId` store (idempotency stays host-side).

### REQ-GAP-5 (document the canonical loop; defer the export)
- **Work:** `ssr-synthetic-event.md` §2.4 canonical-loop documentation (verbatim
  harness body + the four ownership rules: per-tree prevMap, destroy-prune, caller
  drain, on-demand/P4-untouched). Export deferred to the companion-package gate.
- **Cost:** doc-only (low); an exported utility later = a package-level decision.
- **Benefit:** every MCP host stops re-deriving the loop from scratch; P4 stays pinned.
- **Must NOT do:** auto-re-render on dispatch (P4 violation); a module-level shared
  `prevMap`; an internal drain of `takePass2States`.

### REQ-GAP-7 (doc + warn code)
- **Work:** (a) `translate.md`/`handlers.md` CSP/unsafe-eval + trusted-backend-gate
  docs; hosts-must-read-`warnings` pin; (b) `handler-body-eval-blocked` distinct warn
  code (EvalError branch) — **TDD red→green**, smallest possible change.
- **Cost:** docs (low) + one small code branch + one test.
- **Benefit:** a CSP-constrained host learns the page is dead *and why*; distinguishes
  environment-block from authoring error.
- **Must NOT do:** permissive fallbacks (no auto-disable of `new Function` — the
  trusted-backend gate is the contract); silence retention.

## 5. Sequencing recommendation

**Bundle the doc-only pins in one pass (REQ-GAP-1 §2.3; REQ-GAP-2 §2.2; REQ-GAP-4 §3;
REQ-GAP-7 (a); REQ-GAP-5 §2.4; REQ-GAP-3 (a)+precedence)** — a single
`docs/specs/ssr-synthetic-event.md` (+ `handlers.md`/`translate.md`/`node.md`) update,
then the validation trio (`npm test`, `npm run typecheck`, `npm run demo:smoke`) per
AGENTS.md item 4, watching the derived-fork profile totals (~1.5× watch / 2.5× assert;
these are doc-only so no profile shift is expected).

**TDD code bundle (second pass):** REQ-GAP-7 (b) `handler-body-eval-blocked` warn code
and — **only if the reverse-leak exclusion is ruled a defect fix** — the
`nodeToLegacy` mint-exclude. Both are red→green, small, and independently testable.

**User-gated decisions (no code until the user rules):**
1. **REQ-GAP-3 option (b)** — `data-node-id` requires a ruling to *reverse* the
   Phase B no-render-change pin (PAR-4/NVS-7) and re-baseline the snapshot/profile
   pins. **Default disposition: REJECT**; only the user's explicit override proceeds.
2. **REQ-GAP-3 reverse-leak** — is the `nodeToLegacy` mint-exclude a **defect fix**
   (like DEFECT #14 — restore `json-out = json-in`) or a **decision** (accept the
   mint in reverse + document)? DEFECT #14's precedent says defect fix — the mint is
   un-authored state shipping into reverse. But the mint *is* documented as a reserved
   derived fill, and excluding `props.id` from reverse changes the round-trip shape for
   any consumer that reads reverse props. This needs the user's call because it touches
   the lossless-round-trip invariant. My recommendation: **treat as a defect fix**
   (mint-exclude in `nodeToLegacy`, DEFECT #14-class), pending the user gate.
3. **REQ-GAP-5 utility placement** — core export vs future companion package
   (NPM-PACKAGING already directs host utilities to separate packages). Recommendation:
   document now, defer the export.

**Tracker updates (AGENTS.md item 6, in the same pass):**
- `docs/decisions.md` — the precedence rule (`css.id > authored props.id > mint`), the
  reverse-leak ruling, and the Phase C `dirtied`-derivation pin (or park each under the
  existing EVENT-DISPATCH-WIRING row); REQ-GAP-2's "css.id is a set, host-side index"
  contract note.
- `docs/pending.md` — REQ-GAP-4 Phase C derivation note under the existing Phase C
  SPECULATIVE row; REQ-GAP-3 option (b) as a PARKED row with the revisit condition
  (user override); REQ-GAP-5 utility as a NOT-YET-IMPLEMENTED row tied to the
  companion-package gate.
- `docs/next-steps.md` — bookmark the REQ-GAP-7 (b) warn-code + reverse-leak-exclusion
  work items; REQ-GAP-3's corrected reproduction (css.id wins) so the doc fix is not
  lost.
- `docs/defects.md` — the REQ-GAP-3 **reverse-leak is a new defect row** (DEFECT #14-
  class; reference this review) if the user confirms the defect-fix ruling; the
  corrected REQ-GAP-3 reproduction is a doc fix note, not a defect.
- **Archive:** the review lands at `docs/specs/handoffs-review.md` (this document).
  Reference it from the tracker rows; no existing citations are moved. REQ-GAP-6
  closes with no archive artifact beyond this review.
- `docs/skills/designing-pages.md` — per AGENTS.md item 3, if any pin changes
  host-facing behavior (REQ-GAP-2 css.id-set, REQ-GAP-3 precedence), update §11's
  coverage matrix + mention in §12 only if a demo page demonstrates it (none is
  required — these are host-facing, not page-facing).

## 6. Explicit closures

- **REQ-GAP-6 is CLOSED-ALREADY-ADDRESSED** — no work; remove from the live queue,
  close the issue.
- **REQ-GAP-4 is deferred to Phase C (PARKED)** — no engine change now; only the
  Phase C derivation doc pin lands in this round.
- **REQ-GAP-3 option (b) (`data-node-id`) requires a user ruling to reverse the
  no-render-change pin** — the default disposition is REJECT; it proceeds only on
  explicit user override, and then as its own three-agent gate + spec cycle.

**Verdict:** the handoff is **APPROVED-WITH-RESHAPE** — REQ-GAP-1, 6 close with
(mostly) no code; REQ-GAP-2/3/5/7 proceed in the reshaped minimal forms above; REQ-GAP-4
parks to Phase C with its derivation pinned; REQ-GAP-3's option (b) is REJECT-default
pending user override. Doc-first, minimal code (REQ-GAP-7 warn code + the reverse-leak
exclusion, both TDD), everything behind the user's go-ahead and the item-6 step gates,
validation trio green before completion.

---

# Addendum — user rulings + elaborations (2026-08-21)

User rulings received:
1. **REQ-GAP-3 reverse-leak = DEFECT FIX — LANDED 2026-08-21** (mint-exclude in
   `nodeToLegacy`; defects.md DEFECT #28 row; decisions.md AUTO-MINT-REVERSE row;
   translate.md + node.md doc letters; TDD red→green reverse.test.ts DEFECT #28 block;
   trio green — 941 tests, typecheck, demo:smoke SMOKE OK; derived pins values
   0.89/1.07/1.22×, link 1.65/0.90/0.64× — no profile shift, reverse-only change).
2. **REQ-GAP-3 option (b) `data-node-id` — elaboration requested** (§A below).
3. **REQ-GAP-5 utility placement — elaboration requested** (§B below).
4. **REQ-GAP-4 — plan the requested change as a SHARED multi-host surface**
   (Electron + future implementation projects) — §C below.

## §A — REQ-GAP-3 option (b): a single `data-node-id` attribute (elaboration)

**What it is:** every emitted element gains a SECOND identity attribute,
`data-node-id="<minted nodeId>"` (e.g. `node-3`), alongside the rendered `id`
attribute. The rendered `id` attribute stays exactly as today
(`css.id` > authored `props.id` > mint — the DEFECT #28 precedence letter); the
minted nodeId becomes independently addressable in rendered HTML. This is the
handoff's stated need verbatim: "an agent reading rendered HTML cannot tell which
id a dispatch target should use".

**Exactly what it touches (verified against the code):**
- **Emit** — `emitOne` (render-helpers.ts:940-951) builds `props` from `s.props` +
  `s.css`; a new `data:node-id` (or similar) op prop must be added at every element
  construction site: plain path-state emit, fork-arm emit, family emit, and the
  def-fill family (`emitDefRootElement` / `emitDefChildTree` / blocked-def /
  nodeById reTyped — ~6 sites). Every element, everywhere, all depths.
- **Adapters** — both `DomAdapter.setProp` and `SSRFragmentAdapter.setProp` need a
  routing rule for the new op key → `setAttribute('data-node-id', …)` (both already
  dispatch on the `prop:`/`css:` prefixes).
- **Diff** — `diffMinimal` carries it like any attribute (no logic change), but the
  op stream of every render grows by one attribute per element.
- **Pins broken (the cost):**
  1. The Phase B **"no render change / no new render attribute"** pin
     (ssr-synthetic-event.md §2.2 :52-53 — the Phase B hosts must not depend on
     rendered-HTML shape; PAR-4/NVS-7 render.md §8:393/:408 — no SSR-only render
     path). Reversing it is a DECISION, not a doc fix.
  2. Every emitted-HTML pin: ssr-render.test.ts, ssr-html-validity.test.ts,
     markdown-html-validity.test.ts, the treeSig digests (PAR-5), the demo checks
     asserting exact attribute sets — all re-baseline.
  3. The derived-fork family profile baselines: +1 attribute per element shifts the
     emit/apply region totals (the smoke pins are ratio-based within 2.5×, so small
     shifts are tolerated — but the recorded BASELINE totals re-baseline and the
     ~1.5× human watch is measured against them).
  4. HTML noise: +~15 bytes × 4095 elements ≈ 60 KB per fork-page render stream.
- **What it buys:** a DOM reader can dispatch to ANY element by engine nodeId from
  the HTML alone, with no authored-id knowledge and no side listing.
- **What already covers most of the need WITHOUT the render change:**
  - The `id` attribute IS the mint (`preempt-node-node-3`) whenever nothing is
    authored — the common case is already addressable by stripping the prefix.
  - The gap is only when `css.id`/`props.id` are authored: the mint is hidden. The
    DEFECT #28 precedence letter now documents exactly that ("a host reading
    `node.props.id` off the rendered attribute is lied to when only a css.id was
    authored").
  - Option (c) — the host-side listing (`list_targets` precedent — nodeId + cssId +
    propsId per node) already exists in the consumer and solves "which id should I
    dispatch to" without any HTML change.
- **Cheapest correct shape IF the user overrides:** do NOT add it to every element
  unconditionally — make it an OPT-IN render option (e.g. `renderOptions:
  {nodeIdAttribute: true}` at emit), so the default renders + all baselines stay
  pinned and only opting hosts pay. An unconditional default would re-baseline every
  snapshot/profile pin for a need only some hosts have. Even the opt-in needs a
  decision to lift the no-render-change pin.
- **Recommendation:** keep REJECT-default. The documented precedence + the listing
  helper cover the agent-addressing need; `data-node-id` pays a global render-change
  + re-baseline tax for a marginal gain. If the user still wants it, the opt-in
  flag shape is the one to put through its own three-agent gate.

## §B — REQ-GAP-5: the canonical render-loop utility placement (elaboration)

The loop (`emitElements → diffMinimal → applyOps` on one adapter, with
`takePass2States` as the caller's drain) exists today ONLY as harness code
(tests/e2e/ssr-synthetic-event.test.ts:164-179). All pieces are already exported
(src/index.ts barrel — `emitElements`, `diffMinimal`, `applyOps`, both adapters), so
the question is purely where the assembled loop lives.

**Option A — export from provident-ssr core** (`renderProducingProcess(actionable,
nodeById, adapter, prevMap)`):
- Pros: ONE source of truth for every host; loop semantics version with the engine
  (emit/diff/apply signature changes can't drift from the loop); the harness loop IS
  the test (already green); adapter-neutral (not a server entry — NPM-PACKAGING's
  "Electron/Express implementations are future separate packages" is about
  IMPLEMENTATIONS, not a pure helper; defensible).
- Cons: a new public surface with a maintenance contract (contract.md); the engine
  owns host-loop bugs; ~20 lines exported for convenience (judgment call).
- Mandatory ownership rules (all enforceable in a pure function): per-tree `prevMap`
  (never module-level — cross-tree leaks corrupt `diffMinimal` baselines), prune
  destroyed/not-in-tree nodes before emit, `takePass2States` consumed as the CALLER's
  drain only, **on-demand only — never auto-re-render (P4)**.

**Option B — companion package** (e.g. `provident-host` / host-utils):
- Pros: follows NPM-PACKAGING's letter; the loop can grow host conveniences
  (requestId dedup wrapper, journal helpers, MCP transport glue) without engine
  churn; engine stays minimal.
- Cons: a NEW package to publish, version, and keep in sync (the loop binds the
  engine's emit/diff/apply signatures — an engine change breaks the companion
  silently unless cross-tested); for a ~20-line loop this is heavy infrastructure;
  no such package exists yet, and the ONLY shared home that exists today is this
  repo.

**Option C — document-only** (the gate's original recommendation): pin the verbatim
loop + ownership rules in ssr-synthetic-event.md §2.4; every host copies it.
- Cons: copy-paste drift across hosts — exactly the problem the user's REQ-GAP-4
  framing ("shared use case between electron and other future implementation
  projects") is trying to avoid. Two hosts with subtly different loops = divergent
  dispatch/render semantics.

**Recommendation:** Option A-lite — export the loop from core as a pure,
adapter-neutral utility (it is not a server entry), documented + tested in-repo;
the future companion package then wraps it with transport glue (the companion is
the right home for MCP/HTTP/requestId plumbing, NOT for the loop itself). If strict
NPM-PACKAGING separation is preferred, Option C with a pinned verbatim copy in the
spec AND a consumer-side parity test against the engine's exported pieces is the
fallback (drift catches via test, not discipline).

## §C — REQ-GAP-4: shared multi-host dispatch surface plan

**Framing (user directive 2026-08-21):** the `{results, dirtied}` + idempotency
shape is a SHARED use case — Electron and future implementation projects must
consume ONE contract, not each re-derive host-side conventions. This lifts
REQ-GAP-4 out of "parked doc pin" into a planned engine+contract change. Phase C's
endpoint (MCP transport, structured-clone args) stays parked; the ENGINE surface the
endpoints sit on lands.

**Contract (what gets pinned):**
1. **Additive dispatch-report surface** — a NEW method
   `dispatchAndReport(target, event, options, ...args): Promise<DispatchReport>` with
   `DispatchReport = { results: HandlerResult[]; dirtied: NodeId[] }`. The existing
   `dispatchEvent` (Phase A pin — `HandlerResult[]`, sync, trigger-only) is
   UNCHANGED; hosts that need the report use the additive method. Non-breaking.
2. **dirtied derivation (the review's approved axis, now engine-owned):**
   `dirtied = apply().dirtied ∪ keys(takePass2States())` after the awaited flush —
   bounded, non-draining. `Supervisor.apply` already returns `dirtied`
   (supervisor.ts:408+); the method awaits the microtask flush, takes pass-2
   states, unions the apply-reported dirtied, and returns. **Journal-snapshot
   derivation is REJECTED** (O(journal) per dispatch, pins in the exact cost the
   host complained about); `takePass2States` stays forbidden in handler getters
   (renderer-owned drain).
3. **Public flush** — the method owns the flush internally
   (`await flush()` — a small public `flush(): Promise<void>` wrapping the existing
   scheduler settle, so hosts stop hand-rolling `setTimeout(0)` waits). The P4
   "dispatch never re-renders" pin is untouched: flush completes pass-2, the host
   still decides whether to re-emit (via the §B loop).
4. **Idempotency — OPT-IN bounded requestId dedup**: `options.requestId` dedups the
   (target, event) dispatch pair within a BOUNDED window (an LRU cache keyed
   `requestId → {target, event, argsDigest, timestamp}`, capped + TTL'd) — hosts
   share identical exactly-once-within-window semantics without re-implementing.
   Explicitly NOT the review's rejected unbounded engine store (bounded + opt-in +
   best-effort under pressure; hosts remain safe by construction). NOT journaled
   (trigger semantics — replay re-runs effects by design). If §B ships, the dedup
   window could alternatively ride the host utility — but a shared ENGINE default
   is the only way ALL hosts (incl. those that skip the utility) get the same
   semantics. Decision point at the spec gate.
5. **Parity** — the ssr-synthetic-event harness extends to the report surface:
   DOM and SSR producing-processes produce IDENTICAL `results`/`dirtied` for the
   same dispatch (the existing parity pattern; the harness is adapter-neutral).

**Sequencing (item-6 step gates after the user's go-ahead):**
- **Step 1 — spec**: rewrite ssr-synthetic-event.md §3 (Phase C section) into the
  shared-surface contract above: the method signature, the dirtied axis, the
  bounded-dedup window (with the decision point recorded), the flush contract, the
  additive/non-breaking shape, and the explicit non-goals (journal-snapshot,
  unbounded requestId store, takePass2States in getters, auto-re-render, changing
  the `dispatchEvent` return). Review loop per item 6/7.
- **Step 2 — TDD red→green**: red tests first (phases.test.ts + ssr-synthetic-event
  harness): dirtied correctness on a multi-node cascade (body applies to a sibling →
  sibling id present; fork-arm states → node id once), dedup window hit (same
  requestId re-fire → `[]`), window expiry/eviction (different requestId → fires),
  flush awaits pass-2 completion (report reflects post-flush states), DOM=SSR parity
  on results+dirtied, non-breaking pin (dispatchEvent return unchanged). Then the
  least code: `flush()`, `dispatchAndReport`, the bounded dedup window, the
  supervisor wiring. Then the full trio (npm test / typecheck / demo:smoke — watch
  the derived pins; the surface is dispatch-side, no emit change, no profile shift
  expected).
- **Step 3 — host adoption**: Provident-Electron's MCP tools (dispatch/apply/
  list_targets) re-point at the shared surface; future projects consume the same
  contract. Host-side work is in the consumer's repo; the CONTRACT lives here.
- **Trackers (same pass)**: decisions.md row (DISPATCH-REPORT) when landed;
  pending.md Phase C SPECULATIVE row updated (endpoint shape still parked; the
  engine surface lands); next-steps.md bookmarks resolved; defects.md only if a
  defect surfaces during TDD.

**Explicit non-goals:** changing the Phase A `dispatchEvent` return type; engine
requestId store without bounds; journal-snapshot derivation; `takePass2States` from
handler getters; auto-re-render on dispatch (P4); any rendered-HTML change (§A
applies if option (b) ever returns).

**Relationship to the other issues:** the report surface rides the §B loop decision
(the loop consumes `takePass2States`; the report consumes the same drain); REQ-GAP-2
(css.id host-side index) and REQ-GAP-1 (format docs) are unaffected; REQ-GAP-7's
warn-code work is independent (translate-side).

## §D — The openings, elaborated (2026-08-21)

The four open decision points, with the concrete paths and the decision criteria.
The user asked for elaboration before ruling.

### Opening A — REQ-GAP-3 option (b): `data-node-id`, three paths

**A1 — unconditional attribute (the handoff's original ask).** Every element emits
`data-node-id="<nodeId>"` always. Reader-facing benefit is maximal; cost is maximal:
the Phase B no-render-change pin + PAR-4/NVS-7 reversed by decision; every
emitted-HTML pin re-baselines (ssr-render, ssr-html-validity, markdown-html-validity,
the treeSig digests, demo attribute checks); the derived-fork profile baseline totals
re-record (~+15 bytes × 4095 elements ≈ 60 KB per fork-page render stream; small time
shifts in emit/apply, the ratio pins tolerate them but the BASELINE numbers move);
~6 emit sites + both adapters' `setProp` routing gain the key.

**A2 — opt-in render option (the middle path):** `renderOptions: {nodeIdAttribute:
true}` threaded through `emitElements` → the emit sites → both adapters. Default
renders and ALL baselines stay exactly as today (pins untouched); only opting hosts
pay the attribute. Cost: `emitElements` gains an options parameter (a signature
change — see Opening B: the §B loop binds this signature, so the two decisions
interact), both modes need tests (DOM+SSR, with/without), and the no-render-change
pin is lifted FOR THE FLAG ONLY (still a decision, but a scoped one). The wrinkle: a
reader can never rely on the attribute being present — hosts that need it must know
their renderer opted in.

**A3 — status quo (current state post-DEFECT-28):** rendered `id` precedence
documented (`css.id` > authored `props.id` > mint), the mint-prefix-strippable
`id` covers the un-authored case, and the host-side listing (`list_targets` —
nodeId + cssId + propsId per node) covers the addressed case. Zero cost; agents
address elements via MCP tools, not HTML parsing.

**Decision criteria:** is "agent reads RENDERED HTML and addresses elements from it"
a first-class consumer channel, or do agents go through the host API (listing +
dispatch)? If the former, A2 is the sane shape (opt-in, scoped pin lift); if the
latter, A3. A1 has no scenario where it beats A2 (its only advantage — readers can
always rely on presence — is exactly the reliance the no-render-change pin exists to
prevent). **Recommendation: A3 now; A2 only if a concrete HTML-reading consumer
appears.**

### Opening B — §B loop placement, the coupling fact that decides it

The harness loop (tests/e2e/ssr-synthetic-event.test.ts:164-179) binds FOUR engine
signatures: `emitElements`, `diffMinimal`, `applyOps`, plus `takePass2States` and
`Supervisor.dispatchEvent` in the dispatch half. The loop is the thinnest possible
layer over the public surface — which means its coupling to engine signature changes
is 1:1 and silent.

- **Core export (A):** the coupling is explicit and TESTED in-repo (the harness IS
  the test). An `emitElements` options parameter (Opening A2) updates the loop in
  the same commit — impossible to drift. Every host (Electron + future) upgrades to
  the same loop behavior by upgrading the engine. The cost is one documented
  function + contract.md surface entry.
- **Companion package (B):** the loop would bind the engine's signatures from
  OUTSIDE the engine's test suite. An engine signature change (A2, or any future
  emit/diff change) breaks the companion SILENTLY — the companion needs its own CI
  that installs the engine at a pinned version and cross-tests, infrastructure that
  does not exist and has no owner (who maintains the companion? this repo publishes
  one package; the consumer is one project). For a ~20-line loop this is the heaviest
  option.
- **Document-only (C):** every host copies the loop; drift is caught by discipline,
  not tests — the exact multi-host divergence the user's REQ-GAP-4 framing flags.

**Decision criteria:** how many hosts will consume the loop (2+ ⇒ A's tested
single-source wins), how often the loop's bound signatures change (they already
changed twice in the last month — A2 would change `emitElements` again), and who
maintains a companion (no owner exists). **Recommendation: A.** If A2 lands later,
A's loop absorbs it in the same pass — the two openings compose.

### Opening C — requestId dedup ownership (inside §C)

- **Engine opt-in bounded LRU (recommended in §C):** `options.requestId` registers
  the (target, event) pair in a capped + TTL'd window; a duplicate within the window
  returns `{results: [], dirtied: []}` (the already-observed response — the second
  caller gets the first caller's report, which is the idempotent-echo semantics an
  MCP host wants). ALL hosts get identical semantics whether or not they adopt the §B
  utility. Two implementation details that must be pinned in the spec:
  1. **Synchronous registration before the await:** `dispatchAndReport` is async
     (awaits the flush); the dedup claim must be registered at CALL ENTRY, before
     any await, so two concurrent calls with the same requestId collapse (the second
     awaits the first's in-flight promise). A register-after-await race would let
     duplicates through.
  2. **Not journaled, process-local:** the window dies on `loadState`/restart — the
     correct behavior (dedup windows never survive restarts in any scheme; hosts
     mint fresh requestIds per session anyway). Replay semantics untouched (the
     journal never records the dedup — triggers stay triggers).
  Cost: one bounded Map + TTL sweep in the supervisor; opt-in so zero-cost for
  hosts that never pass requestId.
- **Utility placement:** only hosts adopting the §B loop get it; a future project
  that skips the utility re-implements (drift — the exact problem). 
- **Host-side (status quo):** the consumer's Runtime already does requestId dedup;
  every FUTURE host re-implements it with slightly different semantics (window
  size, echo-vs-silent, race handling). For a "shared use case" that is the wrong
  answer.

**Decision criteria:** the user's own framing — shared across Electron AND future
projects ⇒ the semantics must be engine-owned (opt-in, bounded, echo semantics).
**Recommendation: engine opt-in LRU with synchronous registration + echo report.**

### Opening D — the flush: public surface vs internal wait

Facts: the harness flush is a hand-rolled **8× setTimeout(0)** (ssr-synthetic-event
.test.ts:133-134); other e2e files use 1-4 ticks; `hasPendingWork()` (supervisor.ts
:239-241) exists as a NON-draining settle probe. Every host re-implements the
magic-tick loop today.

- **D1 — internal only:** `dispatchAndReport` awaits an internal settle (loop on
  `hasPendingWork()` + one task boundary — deterministic, no magic tick count) and
  exposes nothing new. Hosts that flush WITHOUT dispatching keep hand-rolling.
- **D2 — public `flush(): Promise<void>`:** the same deterministic settle as a
  public method. Hosts stop hand-rolling everywhere (render loop drains, test
  harnesses, MCP tool handlers). One small method, zero pins touched (the P4
  never-flush-on-dispatch pin is about the ENGINE not flushing inside dispatchEvent;
  a public flush the HOST calls is exactly what the pins assume exists).
- **D3 — status quo:** hosts keep magic-tick loops; drift across hosts (tick counts
  already diverge: 8× here, 4× there).

The deterministic settle (D2's core) is: `while (hasPendingWork()) await taskBoundary`
— bounded by the microtask cascade, no arbitrary tick count. **Recommendation: D2**
with the deterministic settle; it is the smallest public surface that removes the
divergent-tick class across all hosts, and it composes with §C (dispatchAndReport
uses it internally).

### Opening E — what "proceed on the doc-only bundle" concretely means now

After the §B/§C rulings, the original pass-1 bundle shrinks — the §B and §C items
SUPERSEDE their doc pins (the §C spec step replaces the REQ-GAP-4 §3 doc pin; the §B
export carries its own docs; REQ-GAP-3(a) precedence is already DONE with DEFECT
#28). The remaining pure-doc work:
1. **REQ-GAP-1** — one sentence in ssr-synthetic-event.md §2.3 (inline bodies
   default `'modern'`; the engine stub's `(event, context)` convention is the
   seam/`format:'legacy'` wrapped path only — handlers.md FORMAT MARKER).
2. **REQ-GAP-2** — ssr-synthetic-event.md §2.2 pins: css.id→node is host-side
   (already P2 — sharpen with) (i) css.id is a SET (non-unique), a host index must
   return/flag multiple matches; (ii) the index excludes destroyed/unplaced/
   prototype nodes to match the dispatch guard's semantics (a prototype passes the
   guard → silent `[]`).
3. **REQ-GAP-7(a)** — translate.md/handlers.md: function-SOURCE bodies require
   `'unsafe-eval'` (CSP-incompatible without it); the trusted-backend gate is the
   contract (the renderer performs no authorization); hosts must read
   `TranslatedTree.warnings` to detect silently skipped handlers.
(REQ-GAP-7(b)'s `handler-body-eval-blocked` warn code stays its own small TDD item;
REQ-GAP-6 is closed.)