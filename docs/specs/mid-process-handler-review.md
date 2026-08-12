# Mid-Process Handler Modes — Three-Agent Proposal Review

Status: design review of the user proposal "mid-process handlers can run in
one of two modes (split after-compile)". Processed through the three-agent
gate (AGENTS.md item 8): validity agent (step 1) → critique agent (step 2) →
change-analysis agent (step 3). **Verdict: reject-as-written; replace with A
plus D.** Variant A (handler visibility of the node: `ctx.node`/`ctx.states`
per-dispatch context enrichment, Mode A unchanged) is IMPLEMENTED and green
(tests/unit/handlers.test.ts + phases.test.ts; fork-stress stress pages
rewritten to self-contained `c.node` bodies). Variant D (data-declared
derivation for single-pass baking) is a separate proposal, not yet started.
Format precedent: `docs/specs/compile-horizon-review.md`.

## 1. What the proposal asks

"Mid-process handlers (in particular, after-compile) can run in one of two
modes, effectively splitting the phase. One mode runs outside of the compile
step, after the resolution and maintains current behavior. The other is
executed within the compiler itself, after other data has been processed.
This allows the handler visibility on the clone by adding it to context, and
allows it to make updates to the compiled data before it is saved in its
read-only state."

Two separable goals, stated as one mechanism:

- **(a) Handler visibility of the current node.** Phase bodies receive only
  `HandlerContext` — the node reaches `dispatchPhase` but is never forwarded
  to the body (handlers.ts:94-106). The fork-stress expander works around
  this with per-prototype closures + a page-side pending queue
  (RENDER_PROCESS_NOTES §10.10.5; demo/fork-stress-data.js:203-265).
- **(b) Pre-commit state mutation.** Let the handler mutate the in-flight
  `CompiledState` before it is published to the read-only resolved cache —
  "baking" values into the emitted state without a second recompile pass.

Proposed split: Mode A = today's dispatch (after compile, in the flush);
Mode B = a dispatch *inside the compiler*, after "other data has been
processed", with the node added to context.

## 2. Feasibility verdict (step 1 — validity agent)

**Partially feasible as stated.** Mode A is trivially preservable (dispatch
lives in `runPass2AndFlush` after `storeResolved`, supervisor.ts:258-269).
Mode B is implementable only with prerequisites that do not exist:
(i) context injection into `compile()` — a `Node` method with no supervisor
backref, ~60-100 call sites compile directly (demos' bootstrap, tests);
(ii) a containment channel + reentrancy guard inside compile
(`dispatchPhase`'s throw-containment lives only outside);
(iii) an explicit dispatch-scope rule (per-dirty-node vs per-actionable-node
diverges at bootstrap); (iv) a props/css clone-before-bake convention —
`makeCs` assigns `node.pass1.props` by REFERENCE (node.ts:607-608), so an
in-place edit mutates the live pass-1 cache and is dropped by the next
`compileLocal`.

- Solves (a)? YES — but adding `node` to `HandlerContext` works identically
  in Mode A; the compiler split is not needed for it.
- Solves (b)? only in a weak per-pass ephemeral form; durability is eroded
  by `compileLocal`'s rebuild and by the supervisor's REPLACE-per-node
  semantics.
- The flagship motivation (fork-stress expander) is NOT convertible: its
  body performs graph mutation (`clone-instance` → anchors + `markPass2`),
  which mid-compile violates R-ORD-4/S-R3.12 and would mutate
  anchors/children while the actionable loop reads them. Every existing
  after-compile body is a graph mutator → **no Mode-B-eligible handler
  exists in the codebase today**.

## 3. Critique (step 2 — adversarial agent)

Genuinely broken as proposed:

- **Managed-channel bypass**: direct state writes with no journal/canon/
  events — breaks replay, serialization and SSR parity (SER-R1/PAR-5).
- **Aliasing**: editing the in-flight state IS an unjournaled write into
  `node.pass1.props` (shared reference); clone-shared nested props can
  corrupt the prototype's data.
- **Read-path side effects**: `clientAPI.getState` compiles `allNodes()` per
  call — reads would gain mutation reach.
- **Mid-compile structural mutation** directly contra R-ORD-1/R-ORD-4.
- **No loop protection** covers handler dispatch (existing guards bound only
  the resolution walk and the dispatch reentrancy key); a Mode-B body that
  re-dirties its node loops with no budget — "each node compiled exactly
  once" (§10.10.4) is gone.
- **Fork-arm ambiguity** (N states per node — which arm does the handler
  see/edit?) and **REPLACE-per-node** makes bakes last-pass-wins /
  tick-order-dependent.
- **Mode-selection mechanics** collide with the legacy data contract
  (`handlers: [{name, phase}]`); patch transport unspecified; manual
  `Supervisor.runPhase` dispatch diverges.

## 4. Change analysis (step 3 — verdict)

**Verdict: reject-as-written; replace with A (adopt now) plus D for the
baking goal; B only as a spec'd fallback.**

- **(A) Minimal fix — `node` (and optionally read-only `states`) in
  `HandlerContext`; Mode A unchanged.** `dispatchPhase` already holds the
  node; forwarding it into `ctx.node` is a read-only addition. It delivers
  the entire fork-stress motivation: the expander becomes self-contained
  (reads its own `stress:layer`/`stress:slot` from `node.props`, expands
  itself, O(1) per call — the 27.9s scan regression cannot recur), the
  `pendingByKey` registry and closure-over-prototype installation are
  deleted, and bodies become portable — shippable as legacy function-source
  strings (translate.md §2). Cost: ~2 core files + handler tests; zero risk
  to pinned invariants.
- **(B) "Post-compile, pre-publish" phase inside `runPass2AndFlush`**
  (supervisor-side, between `pass2States.set` and `storeResolved`, on the
  focused node only, patches applied to fresh clones, transport via return
  value): keeps `compile()` pure and `getState`/bootstrap clean, but the
  bake is per-pass ephemeral — silently lost when the node next recompiles
  as a walk-path participant — and SSR parity depends on a strict purity
  rule that is easy to violate. Only for runtime-computed bakes; park as
  documented fallback.
- **(C) Journaled patches**: dominated — buys nothing over A+D while adding
  replay ordering and stickiness questions.
- **(D) Declarative derivation — the better solution for the baking goal.**
  A data-carried rule (e.g. `derived: { props: { key: 'bindings.<name>' } }`)
  evaluated inside the existing compile path (`makeCs`/`compileLocal`). Pure
  extension of compile — no dispatch, no handler, no journal problem —
  durable (re-derived every pass), SER-R1-safe by construction (the rule
  ships in serialized data), R-ORD-4-untouched. The only variant that
  satisfies goal (b) as a durable, parity-safe, single-pass bake.

## 5. Costs and benefits

| Variant | Cost | Risk to pinned invariants | Benefit |
| --- | --- | --- | --- |
| A — `node` in context | handlers.ts + supervisor.ts + types; ~4-6 tests + demo rewrite + smoke | none (read-only) | self-contained expander (pending queue deleted), portable string-shippable bodies, closes no-current-node everywhere |
| B — `pre-commit` phase | supervisor + handlers + types; ~10-14 tests | moderate — per-pass ephemerality + SSR parity rules | single-flush bake, compile stays pure |
| C — journaled patches | ~3-4 files + replay tests | high | none over A+D |
| D — declarative derivation | types + node.ts + validation + serialize; ~8-12 tests | low (additive pure function) | durable, parity-safe single-pass bake, SSR + both scopes automatic |

## 6. Next step (pending user go-ahead)

Only a passing review + user go-ahead may proceed to the step gates
(AGENTS.md item 6/8). Recommended sequence if accepted: spec + TDD for A
(handler-context `node`/`states`, Mode A unchanged) first; D scoped
separately as its own proposal.
