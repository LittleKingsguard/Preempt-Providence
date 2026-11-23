# Modularity Handoff Gate (`handoffs-review-11`) — `H-1b` (node-keyed invalidation) and `H-2` (`handlers[].ref`)

**Status:** **`H-1b` — REJECT AS WRITTEN.** The ancestor-chain dirtying, and any new op kind that
performs it, are refused: the capability already composes, and the asked shape *is* the prohibited
whole-tree recompile. Replaced by an **ACCEPT-NOW** documentation+defect bundle (§4.3 R-1, R-2a) plus
**one additive member approved only after a named measurement** (§4.3 R-3).
**`H-2` — REJECT AS WRITTEN.** A dispatch-time `ref` resolver is refused. Replaced by an
**ACCEPT-NOW** containment defect row + host-recipe documentation (§4.3 R-4, R-5), with the only
defensible resolver home — **a live function in the existing scope-keyed def registry** — **PARKED**
behind one named probe (§4.3 R-6).
**`ATTACH-UNREGISTERED-SILENT-NOOP`** (decided before the gate, not under it) — confirmed **REAL** on
a static read; it is the **head work item** and lands before anything else here.

**Gate provenance.** Three-agent gate, AGENTS.md item 9: **step 1 validity** and **step 2 critique**
ran independently, read-only, neither reading the other's report; **step 3 change-analysis**
synthesised both and produced this record. All three are read-only — this file is the only artifact.
Sources: the two reports; the supervisor's triage `docs/specs/handoffs-triage-modularity-2026-11-20.md`;
the handoff `docs/handoff-modularity-2026-11-20.md`. Date: **2026-11-23**.

**Anchor discipline.** Every `file:line` below was re-read in the 0.5.2 tree by the gate. The
supervisor then re-verified the three anchors the new defect rows rest on and they hold **verbatim**:
`journalIfApplied` sets `this.redoStack = []` and schedules a condense past `maxJournalLength`
(`supervisor.ts:741-760`); emit publishes `props['on:'+h.event] = true` for **any** handler object
with a string `event`, with no body check (`render-helpers.ts:1522-1527`); the K8 NP11 admission guard
fires only when `h.body` is **present and wrong**, so a body-less `{name, event}` handler passes it
(`translate.ts:378-383`). Anything inherited unread is marked `UNVERIFIED:`.

---

## 1. What the handoff asks

Two findings from `Provident-Electron`'s modularity unit, at pin `provident-ssr ^0.5.2`. Neither is a
patch request; both are stated as upstream-owned gaps.

1. **`H-1b`** — a **public recompile/invalidate entry keyed by node id that dirties the ancestor chain
   to the root**, *or* an insert/replace op whose recompile does, **with a stated sentence of what a
   post-bootstrap structural change re-emits**. Motivation: *"A module can therefore not be activated
   or replaced after a boot without a fresh boot."*
2. **`H-2`** — **`handlers[].ref`**: a **KEY** the **HOST** resolves at dispatch through a
   host-supplied resolver, **unresolved key contained per handler**. Motivation: the downstream's
   UI-authority contract forbids a module's renderer code riding in graph text readable through
   `dispatch` / `get_rendered_html` / `get_markdown`.
3. **Not under gate, decided separately:** `docs/defects.md` **ATTACH-UNREGISTERED-SILENT-NOOP** (OPEN).

### 1.1 Corrected premises (this record must not carry the handoff's wording as fact)

| # | Handoff premise | Verdict | Ground |
| --- | --- | --- | --- |
| P-1 | *"adding a child to an existing authored container leaves the container's markup unchanged"* | **FALSE AS GENERAL.** True only for `attach` of a node that was never registered. A **registered** child's flush compiles `focusedSliceFor(child)` = ancestors-to-root ∪ descendants, and `compile` pushes a state for **every** viable slice member, not just the focus node, so the container's `CompiledState` is regenerated and its `childOrder` diff emits the append. | `supervisor.ts:51-59`, `:695-703`; `node.ts:1125`, `:1185-1226`; `render-helpers.ts:325` |
| P-2 | *"the public surface has no node-keyed invalidation entry"* | **TRUE** — no `invalidate`/`recompile` in `src/` or the barrel. **But the capability composes** from public parts (`focusedSliceFor` and `renderProducingProcess` are barrel-exported; an empty `state-slice` reaches `markPass2`). The entry is *undocumented*, not *absent-by-necessity*. | `src/index.ts:27`, `:39`; `supervisor.ts:1021-1128` |
| P-3 | *"a module cannot be activated … after a boot without a fresh boot"* | **FALSE AS GENERAL.** `placement-attach`, `layer-apply`, `clone-instance` and `rows-mint` all register-if-new and re-emit. **`attach` alone omits registration** — that is the whole of P-1's symptom, and it is a defect, not a missing surface. | `supervisor.ts:1186`, `:1244`, `:1290-1293`, `:1327-1330` vs `:1198-1211` |
| P-4 | *"the graph admits no closure"* (H-2's reproduction) | **FALSE.** `body` may already be a **function value** — admitted at translate, copied into base, dispatched. What is string-only is the `new Function` compile and the JSON/persistence boundary. | `translate.ts:380`, `:429-434`; `handlers.ts:97-110` |
| P-5 | *"a handler body is only a function STRING"* | **FALSE at the API level; TRUE at the persistence boundary.** `serializeNode` emits no `handlers` key, and reverse re-stringifies live bodies. The blocker is *"a **persisted** graph cannot carry a closure"*. | `translate.ts:1349-1367` (`:1356-1358`); `serialize.ts:104-166` |
| P-6 | *"exactly as it already supplies adapter and transform hooks"* | **FALSE.** `translateLegacy(doc, opts?)` takes `{hub?, graphScope?}` only; the single adapter callback is `DomAdapterOptions.onEvent`; there are no transform hooks. | `translate.ts:1112`; `adapters.ts:34-36` |
| P-7 | *"an unresolved key [is] contained per handler"* | **NOT WHERE IT WOULD NEED TO BE.** The `typeof body !== 'function'` skip sits in the **loop head, outside the `try`**; only `handler.body(...)` is guarded. A resolver that throws there aborts the pass-2 tick. | `handlers.ts:100-108`, `:116-124` |
| P-8 | the threat model (*"graph text is readable through dispatch / get_rendered_html / get_markdown"*) | **Downstream contract, not this package's.** This package's seal is the trusted-backend write-gate; readability of a body as data is **accepted by design**. H-2 relocates the eval boundary; it does not close a leak here. | `translate.md:283`; `script-dsl-review.md:139-145` |
| P-9 | `H-1`'s third reading (*"the first post-bootstrap mint drops an authored bootstrap consumer"*) | Describes the class closed by **VALUE-PROVIDER-RENDER-DISPOSITION**, which shipped **in 0.5.2 — the version the downstream pins**. Must be re-tested at 0.5.2 before being carried as live. | `decisions.md:15`; triage §1.4 |

**Evidence class.** Both findings are a downstream *symptom* plus a **static** root-cause reading. No
failing test, probe or measured upstream run backs either. Every structural claim in the three passes
checked out; the two false claims are the handoff's own (P-4, P-6), and the decisive unknown for H-2
is downstream-side and out of tree (§9 Q3).

---

## 2. Step 1 — validity (summary)

**`H-1b` — MOOT.** The capability composes today: `apply({kind:'state-slice', node, mutation: []})`
clears the array guard, passes the state gate, `applySlice([])` creates zero layers, and
`markPass2(node.id)` fires; the flush's slice-wide compile then re-derives the ancestor chain to the
root. **No per-ancestor loop is needed** — the slice already contains it. What the composition does
**not** give: (i) the **placement-routed** branch compiles `compilePath()` node-local and does **not**
ascend; (ii) a journal entry with an inverse of zero layers (phantom undo) that also clears the redo
stack; (iii) no diagnostic for the no-op case; (iv) `no-usable-state` on out-of-tree/prototype nodes;
(v) no name and no doc anywhere; (vi) **it does not touch the actual observed failure** (attach
registration). Over-scope: ancestor-chain dirtying is redundant with the slice-wide pass-2 output and
multiplies compiles against the measured 12.4× redundancy and the d10→d12 growth guard (bound 10×).
Under-scope: the placement-routed branch, the unregistered-attach no-op, the **replace** half
(R-VPD-2 ghost-`childOrder`), unplaced/prototype nodes, journal hygiene, and the missing "stated
sentence".

**`H-2` — VIABLE-WITH-RESHAPE.** The seam is genuinely new but narrower than stated: the graph can
already **name** behaviour it does not carry (a body-less `{name, event}` handler is accepted today and
silently skipped). Four contained edits were proposed (admit+carry `ref`; resolve in the dispatch sites
via the single `HandlerContext` construction site; emit the key rather than `body.toString()` on
reverse; warn-with-dedup containment), with three reshape requirements: the blocker restated as
*persistence*, the resolver **scope-keyed not module-global**, and the reverse must stop re-stringifying
host closures. **Whether it is *needed* is unmeasured.**

**Evidence audit.** All structural claims verified. FALSE **in the handoff** (P-4/P-6).
FALSE-AS-GENERAL (P-1/P-3). **UNVERIFIED: every runtime claim** — no execution was available to any
of the three passes; all composition statements are static traces. Also UNVERIFIED and out of tree: the
downstream records and the decisive H-2 unknown.

---

## 3. Step 2 — critique (summary)

Blocking findings: (1) H-1b's own shape is the **named prohibition** — *"no whole-tree recompile"* — and
the affected set is already an **ACTIVE narrower pin** (E2E-4: immediate parent + added node,
*"Nothing deeper"*); (2) the flush is **one compile per dirty id, never one coalesced pass**, and those
compiles **overwrite each other** per node — an unpinned ordering dependency with two failure modes
(root-last = one whole-tree compile; leaf-last = the documented multi-provider arm loss); (3) phase
handlers **fan out** over unchanged ancestors; (4) **the ask does not satisfy its own blocker for
placement content** — a family-routed container receiving a placement-attach leaves the added path-state
**orphaned** and *"the widget does not render"*; (5) journal/undo has no stated shape, a new op kind
widens **three closed unions**, and the mirror case is already live (`attach`'s undo marks only the
detached node); (6) a `ref`-shaped handler is **already accepted and silently dead**, so H-2 as written
would *formalise* the silence, while emit already publishes a live-looking `on:<event>`; (7) the reverse
round-trip converts a working `ref` into a dead one; (8) `ref` cannot survive snapshot/condense; (9) the
resolver's containment site is **outside the `try`**; (10) a dispatch-time resolver **forks** the D2
scope-keyed registry into two name→body registries with different keys, scopes, precedence and warn codes.

Non-blocking: triage anchor drift; a mis-attributed quotation (`decisions.md:63`, not
`contract.md:494` — both since repaired); the empty-slice recipe's **costs** (journal entry,
`redoStack = []`, condense pressure) omitted from the cheap alternative; `handlerContext` memoised once
so a resolver cannot be swapped mid-session; `Node.base` frozen but reachable handler objects not
deep-frozen; `format:'legacy'`+`ref` unpinned; no target version stated; the adapter/transform analogy
false; no performance claim above d12 is automatically measurable.

Its advisory: reject both as new surfaces; admit (a) documentation of the two compositions, (b) the
attach-registration defect, (c) a translate-time containment warn for the body-less/`ref` shape, and
(d) a written statement of what a post-bootstrap structural change re-emits.

---

## 4. Step 3 — change-analysis (the verdict)

### 4.1 Where the two reports actually conflict

| Point | Step 1 | Step 2 | Adjudication |
| --- | --- | --- | --- |
| H-1b disposition | **MOOT** (capability exists) | **REJECT the new surface** | **Compatible.** Both refuse the ask; step 1 adds the positive half, step 2 the negative. The verdict refuses the ask **and** takes step 2's cost accounting as the reason the positive half must be documented *with its price stated*, not blessed as THE entry. |
| The empty `state-slice` as host recipe | Acceptable | Cheap but **costly** | **Step 2 is right on the facts, step 1 that it composes.** Both under-rate the paradigm problem: a *mutation* op used to request a *render* is a category error the contract should not pin — see 4.2(i). |
| H-2 | **VIABLE-WITH-RESHAPE** | **REJECT, document instead** | **Genuinely conflicting; step 2 is right.** Step 1's reshape keeps the dispatch-time resolver as the seam; step 2 shows that seam is the *worst* available home. The verdict takes step 2's destination but not its framing — the need is real, the seam is wrong (4.2(ii)). |
| Reverse leak (`body.toString()`) | Under-scope | Blocking | **Step 2 is right that it must be in scope**, and **both** under-read it: it is a **pinned round-trip contract**, so an owner decision, not a bug fix (§9 Q4). |
| Phase fan-out / closed unions | Noted, not weighted | Blocking | **Step 2 wins.** `events.ts:13` types the structure op as `StructuralOp['kind']` — closed — so even a non-op invalidate that emitted `structure` would widen a union. Resolution: an invalidation **must not** emit `structure` (4.2(i)). |

**One thing both reports under-read.** The two asks are **not independent**: H-2's "activate a module
after boot" *is* H-1b's "post-bootstrap structural change". A resolver that installs a closure without
a re-emit leaves `pass1.handlers`/`resolvedStates` stale; a re-emit without a way to install the closure
re-emits a dead handler. **Neither ask is sufficient alone** — which is itself an argument for the
documentation bundle, since the two recipes together *are* sufficient.

### 4.2 The three questions the gate must decide

**(i) Is the empty-`state-slice` an acceptable host recipe or an abuse — and does that justify a small
dedicated entry?** **It is an abuse, and yes — but a different entry than either report imagined.**
Verified costs: `applySlice([])` creates no layers and marks the node remote-dirty (`node.ts:1532-1573`);
the supervisor journals an entry whose `sliceLayers` and `hookUndo` are `[]` (`supervisor.ts:1113-1128`);
`journalIfApplied` pushes it, **`this.redoStack = []`**, and schedules a condense past
`maxJournalLength` (`:741-760`); `markPass2` fires (`:1127`). So **a render request is recorded as a
graph edit** — the journal grows, the redo chain is destroyed, `undoDepth` grows with an entry whose
inverse is zero layers, and condense pressure rises. Worse, it is a **latent coupling**: nothing in the
contract says an empty mutation list must stay `applied`, so a future tightening silently breaks every
host that adopted it. The composition is a **documented escape hatch**, not the blessed entry — leaving
a genuine hole: **there is no way to request a re-emit without journaling a mutation.** That hole is
closable without touching any closed union:

> an additive, **non-journaled, render-plane** `Supervisor.invalidate(nodeRef)` that resolves the ref as
> `apply` does, rejects `unknown-node` / reports `no-usable-state` for out-of-tree and destroyed nodes,
> and does exactly `markPass2(id)` — **no journal entry, no redo destruction, no structure event** (the
> normal flush already pushes `state` events for the invalidated node at `:709-723`, so an event-driven
> host learns through the existing channel). It **must not ascend**: `focusedSliceFor` already supplies
> the ancestor chain, and ascending multiplies compiles and re-opens step 2's overwrite-ordering hazard.

Precedent class exists: `flush()`, `dispatchAndReport()`, `hasPendingWork()` are already **additive
Supervisor members on the render plane, not the journal plane** (`contract.md:235-249`). Cost: ~10-15
lines, one `contract.md` pin, one decisions row, tests. **Not approved now** — approved **after the
named measurement** in §8 P-5.

**(ii) Is a dispatch-time `ref` resolver the right seam, or should a resolver be admitted into the
existing scope-keyed def registry — and does that change the verdict?** **The def registry is the right
home if a resolver is ever admitted, and yes — it changes the verdict from "reshape" to "reject".**
`GraphScope.handlerDefs` is already **scope-keyed** (D2 enforced there), already resolved into a
provenance-marked layer at compile (`node.ts:1864-1909`), already **contained per entry**
(`:1888-1895`), already **excluded from reverse** (`translate.ts:1337`, `:1345`), and already
`format`-aware at install (`:1890-1892`). The widening is mechanical (`HandlerDefRecord.body` becomes
`string | Function`; the rebuilder uses the function directly). **No dispatch-path change, no second
registry, no new scope key, no new warn code, no re-entrancy surface inside phases.** The dispatch-time
resolver loses on every axis: it forks the registry, puts containment outside the `try` (a throw aborts
the flush microtask), lets the free `dispatchEvent`/`makeHandlerContext` exports be pointed at another
graph's context (the D7 shared-EventBridge trap class), makes a mid-session swap un-auditable, and
**formalises the silent-death class** instead of retiring it.
**But**: the def seam only materialises onto a consumer carrying a `handlers.<event>` **anchor** — it is
the auth/component-seam channel, not "this node's renderer". For that, the sanctioned paths are already
`state-slice targetProp:'handlers'` (live, journaled, exact-undo — the RUNTIME-WRITE BODY LETTER demands
function bodies) or `layer-apply` (a whole module subtree in **one** op, teardown by one `removeLayer`).
**So the downstream's stated blocker is already solvable today, in-process, with no text in the graph** —
which is why the resolver is rejected and the registry widening is only *parked*.

**(iii) Does the already-silently-dead `ref`-shaped handler change the priority order?** **Yes,
decisively, and it answers the "document instead" objection.** A `{name, event}` handler with no `body`
passes the admission guard, is spread verbatim into base, is **skipped silently** at dispatch — and
**emit still publishes `props['on:'+event] = true`**, because emit filters on a string `event`, never
on the body. So the package today manufactures a **live-looking listener that does nothing, with no
warning anywhere** — an ACTIVE silent-death defect that exists whether or not `ref` is ever admitted.
Therefore the order is: **(1) the registration defect; (2) the body-less-handler silence; (3) the docs;
(4) only then, if a probe demands it, a resolver.** Any `ref` field landing before (2) inherits the
silence and makes it a contract.
**And the obligation "document instead" owes the downstream is not discharged by words:** it is
discharged by the registration fix (module *activation* works), the stated re-emit sentence (*replace*
becomes predictable), the body-less-handler warn (a name that cannot resolve is *loud*, so a host can
safely author keys), and the host-owned-closure recipe (the renderer need is met with no text in the
graph).

### 4.3 Cost/benefit, and the reshaped items

| Ask / candidate | Benefit over the documented composition | Cost | Risk | Verdict |
| --- | --- | --- | --- | --- |
| **H-1b as written** (ancestor-chain dirtying / new or widened op) | **None.** The flush already re-derives the ancestor chain from one mark. | Widens 3 closed unions (`types.ts:234`, `:250`, `:267`; `events.ts:13`); new journal shape + undo semantics; phase fan-out; supersedes the E2E-4 pin; depth-many compiles per flush against 12.4× redundancy and the 10× growth guard. | Violates `ops.md:288`/G18 (`:356`); breaks E2E-4 (`placement-path-spec.md:434-442`); the overwrite-ordering hazard the code documents at `supervisor.ts:699-701`. | **REJECT** |
| **H-2 as written** (dispatch-time `ref` resolver) | Post-boot table swap is instantaneous; a persisted graph can name behaviour. | Second name→body registry; a throw site outside `try`; D2 exposure on free exports; four body-consumption sites to keep in sync; reverse must not degrade to dead; no snapshot survival. | Formalises a silent-death class; forks D2; `format:'legacy'` re-wrap ambiguity; un-auditable mid-session behaviour change. | **REJECT** |
| **R-1 docs bundle** (the stated sentence + the activation/replace recipe + the host-owned-behaviour recipe) | Answers both stated blockers. | Near-zero; docs + trio. | Staleness if not landed with the defect fix. | **ACCEPT NOW** |
| **R-2a `ATTACH-UNREGISTERED-SILENT-NOOP`** + **R-2b the body-less handler** | The *observed* failures stop being silent. | Small, local; a behaviour change for previously no-op input. | Two observable changes at once — keep them separate red sets. | **ACCEPT NOW** (R-2a, R-2b) |
| **R-3 `Supervisor.invalidate`** (non-journaled, one id, no ascent, no structure event) | A re-emit request that costs no journal entry, does not destroy redo, and has a name. | One additive member + contract pin + tests (`X.Y.X`). | Must not ascend; must not be read as a substitute for registration. | **APPROVE AFTER NAMED MEASUREMENT** (§8 P-5) |
| **R-6 def-registry live-function body** | The graph names behaviour the host owns, scope-keyed, compile-time, contained, reverse-exempt. | `registry.ts:80-84` type widening + `node.ts:1889` branch + a barrel/subpath contract decision. | Does not serve plain-node renderers (needs a `handlers.<event>` anchor); `registerHandlerDef` is not barrel-exported today. | **PARKED** behind §8 P-8 |

### 4.4 The reshaped items, exactly

**R-1 — the stated sentence + the two host recipes (documentation only; no `src/` change).**
*Clause surface:* `docs/skills/designing-pages.md` (a new recipe block + the §11 coverage row),
`docs/specs/ops.md` §5 (a sentence, not a rule change), `docs/specs/handlers.md` §4 (the
host-owned-body recipe), `docs/decisions.md` (one ACTIVE row — owner-gated, §9 Q6),
`docs/specs/contract.md` (a cross-reference only).
*The sentence, verbatim in substance:* **A post-bootstrap structural change re-emits the dirty node's
focused slice — the changed node, its ancestor chain to the root, and its subtree — as pass-2 states;
the renderer diffs those against its previous map, so an ancestor whose `childOrder` changed emits
append/remove ops and untouched branches emit nothing.** With both carve-outs stated in the same breath:
**(a)** a dirty node that is **placement-routed** compiles node-local path-states via `compilePath` and
does **not** re-derive its ancestors (`supervisor.ts:682`, `:695-696`); **(b)** a `placement-attach`
into a **family-routed** container leaves the added path-state **orphaned** — the widget does not render
(`placement-path-spec.md:485-495`). Plus the escape hatch (an empty `state-slice`) documented **with its
price**: one journal entry, `redoStack` cleared, a zero-layer undo entry, condense pressure.
*TDD:* none (docs) — but the sentence's claims are asserted by the §8 probes **first**.

**R-2a — `ATTACH-UNREGISTERED-SILENT-NOOP`** (already OPEN; confirmed real).
*Clause surface:* `src/core/supervisor.ts:1198-1211` (the `attach` branch); `docs/specs/ops.md` §2.1
(state the registration requirement) + §7 G1.
*Fix shape (owner choice, §9 Q5):* register-if-new like every other add-op, **or** reject with a new
`ApplyErrorCode` member. **Register-if-new is preferred** — consistent with the four other add-ops, no
union change.
*TDD red set:* attach an unregistered fresh node into a registered container → (i) the node appears in
`getNode`/`allNodes`; (ii) the flush produces a container state whose `children` contains the new child;
(iii) exactly one append op; (iv) exactly one journal entry; (v) a registered attach is unchanged
(E2E-4's `placement-attach` dirty set untouched); (vi) two-supervisor isolation. *Version:* `X.X.Y`.

**R-2b — NEW ROW `HANDLER-BODYLESS-SILENT-DEAD`.**
*Clause surface:* `src/core/translate.ts:366-437` (admission) + `docs/specs/handlers.md` §5 (a new H-row)
+ `docs/specs/translate.md:283` (the warn family).
*Fix shape:* a **translate-time containment warn** for a handler with `event`/`phase` but **no body and
no resolvable def** — a new code in the `handler-body-invalid` family (e.g. `handler-body-missing`),
warn + keep (never reject: the shape is currently *tolerated* and rejecting it is breaking).
*TDD red set:* (i) `{name, event}` body-less → one warn, node still compiles; (ii) `{name, event, ref:'x'}`
(the H-2 shape) → the **same** warn today, proving the seam must diagnose the shape before it can carry
a key; (iii) `{name, body:'…'}` and `{name, body:fn}` → **no** warn; (iv) a def-shaped
`handlers.<event>` binding → **no** warn (the seam resolves it); (v) a `format`-only handler → a
documented disposition. *Version:* `X.X.Y` (additive warn; precedent `handler-body-invalid` /
`handler-body-eval-blocked`).

**R-3 — `Supervisor.invalidate(nodeRef)` (approved only on P-5's evidence).**
*Clause surface:* `contract.md:219-233` (the pinned Supervisor surface) + `:235-249` (the render-plane
surface it joins); `docs/specs/ops.md` §5 (a pointer: an invalidation is not an op);
`docs/specs/api.md` (the result shape); `docs/decisions.md` row.
*Exact shape:* `invalidate(ref: NodeRef): { status: 'applied' | 'no-usable-state' | 'rejected'; dirtied:
NodeId[]; nodeState?: NodeState }`; resolves like `apply`; gates destroyed/absent; does `markPass2(id)`;
**no journal, no redo clear, no `emitStructure`; never ascends.**
*TDD red set:* (i) `invalidate(child)` → the container's state regenerated with the new child, one
append, **zero** journal delta, `redoStack` unchanged; (ii) `undoDepth`/`undoTopKind` unchanged;
(iii) destroyed/absent id → `no-usable-state`/`rejected`, no throw; (iv) placement-routed node →
`compilePath` only, **no** ancestor state; (v) `state` events emitted, **zero** `structure` events;
(vi) pass-2 cost on a d12-shaped tree within the growth guard. *Version:* `X.Y.X`.

### 4.5 What the gate is NOT approving

No new or widened **op kind**; **ancestor-chain dirtying** by any spelling; a change to `attach`'s or
`placement-attach`'s dirty set; a **dispatch-time resolver**, a `handlers[].ref` field, or any second
name→body registry; widening `handlerDefs` **now**; any change to the reverse's live-body-as-source
contract; emitting `structure` for an invalidation; any change to the E2E-4 pin, the 10× growth bound,
or the journal shape. It is also **not approving a downstream green** — a handoff delivery greens no
downstream row (`D-5`).

---

## 5. Dispositions

| # | Ask / candidate | Verdict | What replaces it | Tracker row(s) | Owner decision owed |
| --- | --- | --- | --- | --- | --- |
| 1 | **`H-1b`** invalidation that dirties the ancestor chain to the root, or an insert/replace op that does | **REJECT** | R-1 (the stated sentence + both carve-outs) + R-2a | `docs/defects.md` ATTACH-UNREGISTERED-SILENT-NOOP (head of queue); `docs/next-steps.md`; a decisions row **only if** Q6 says so | Q6 |
| 2 | **`H-1b`'s "stated sentence"** | **ACCEPT NOW** (as R-1) | — | as row 1 | — |
| 3 | **`H-1b`'s re-emit capability for a journal-free request** | **APPROVE AFTER NAMED MEASUREMENT** (R-3, on §8 P-5) | `Supervisor.invalidate` | `docs/pending.md` `Supervisor.invalidate` (owner gate) | Q1, Q2, Q8 |
| 4 | **`H-1b`'s replace half** | **REJECT AS SURFACED; carried by the existing residual** | R-2a + the documented sentence; the ghost-`childOrder` half stays `R-VPD-2` | `docs/defects.md` R-VPD-2 (OPEN, unchanged) | — |
| 5 | **`H-2` `handlers[].ref` dispatch-time resolver** | **REJECT** | R-2b (the containment warn) + R-1's host-owned-body recipe | `docs/defects.md` HANDLER-BODYLESS-SILENT-DEAD (NEW OPEN); `docs/pending.md` `handlers[].ref` (PARKED, constraints recorded) | Q7 |
| 6 | **`H-2`'s underlying need** (host-owned renderer, no text in graph) | **ACCEPT NOW** (documented recipe) | R-1: key→body table + `state-slice handlers` (live) / `layer-apply` (one op per subtree) / `addLayer` (pre-mount prototypes only) | `docs/specs/handlers.md` §4; `docs/skills/designing-pages.md` | — |
| 7 | **A resolver in the existing scope-keyed def registry** | **PARKED** behind §8 P-8 | `HandlerDefRecord.body: string \| Function` + the `node.ts:1889` branch | `docs/pending.md` `def-registry live-function body` | Q3 |
| 8 | **Reverse re-stringifies a host closure** (`translate.ts:1356-1358`) | **NOT A DEFECT — a pinned contract with an open conflict** | owner decision | `docs/pending.md` `reverse emission for a host-owned closure` | **Q4** |
| 9 | **`ATTACH-UNREGISTERED-SILENT-NOOP`** | **CONFIRMED REAL — ACCEPT NOW** (head of the queue) | R-2a | stays OPEN → FIXED after red→green | Q5 |
| 10 | **`H-1`'s third reading** | **NOT LIVE AT THE PINNED VERSION** | re-test at 0.5.2 (§8 P-10) | `docs/next-steps.md` note | — |
| 11 | **This gate record** | — | — | `docs/specs/handoffs-review-11.md` (this file) | — |

---

## 6. INVARIANTS THIS CHANGE'S CODE PATH TOUCHES

Required by the repo's pending rule R1. Ids are the owning spec's register; the code site is the site
the change would edit.

| Invariant (id, owner) | Code site | Why it can be touched |
| --- | --- | --- |
| **`ops.md` §5 Coalescing — "one microtask per tick … no whole-tree recompile"** (`ops.md:288`) | `supervisor.ts:637`, `:650-665`, `:667-739` | Any invalidation adds ids to this set; an ascent adds depth-many compiles per flush. |
| **`ops.md` G18** (`ops.md:356`) | as above | Same rule, exhaustiveness gate. |
| **`ops.md` §5 Bounded pass 2 (ancestor chain only)** (`ops.md:289`) | `supervisor.ts:51-90` (`focusedSliceFor`) | Bounded becomes unbounded if the slice composition changes. |
| **E2E-4 affected set — parent + added node, "Nothing deeper"** (`placement-path-spec.md:434-442`; G21 `ops.md:359`; `tests/e2e/path-fork-e2e.test.ts`) | `supervisor.ts:1173-1196` | Any change to a placement op's dirty set moves an ACTIVE pin. |
| **`placement-path-spec` §3.3 scope pins** (`:471-484`, `:485-495`) | `supervisor.ts:682`, `:695-697`; `node.ts:1426` | The re-emit sentence must state both carve-outs or it is false. |
| **`node.md` §8.5 dirty/mark-dirty contract** (`node.md:391-404`) | `node.ts:1534`, `:1571` | The empty-slice escape hatch uses this path; an invalidate must too. |
| **`handlers.md` H-H3 — non-function body silently skipped** (`:210`) | `handlers.ts:102`, `:118` | The body-less/`ref` shape and any resolver change land on this row. |
| **`handlers.md` H-H4 — throwing body contained** (`:211`) | `handlers.ts:103-107`, `:119-123` | The resolver's containment site is *outside* this try. |
| **`handlers.md` H-H10 — phase ordering in one apply+flush cycle** (`:217`) | `supervisor.ts:708`, `:735-738` | An invalidation replays `after-compile`/`after-render`; multi-node fan-out has no pin. |
| **`handlers.md` §4 REQ-GAP-10 letter — pre-mount only** (`:164-202`) | `node.ts:703-720`, `:1864-1909` | Any new resolver must be reconciled with this letter. |
| **`handlers.md` §4 RUNTIME-WRITE BODY LETTER — runtime writes REQUIRE function bodies** (`:152-162`) | `node.ts:1546-1547`; `handlers.ts:102` | The host-owned-body recipe depends on it; a string-body registry is REJECTED. |
| **`handlers.md` §4 HANDLERS CLEAR + REVERSE-OF-CLEAR** (`:137-150`; `decisions.md:64`) | `node.ts:1870-1874`; `translate.ts:1333-1347` | The reverse changes must not disturb the clear-emission branch. |
| **`contract.md` §public API surface — the pinned `Supervisor` surface** (`:219-233`) + the render-plane surface (`:235-249`) | the `Supervisor` class | R-3 is additive; it must join the render-plane precedent, not the op surface. |
| **`translate.md` §`NodeData.handlers` — eval gate backend-gated; reverse ships source** (`translate.md:283`) | `translate.ts:393-427`, `:1349-1367` | Admission and reverse are both in scope for R-2b. |
| **`translate.md` — unknown extra fields ignored, never rejected** (`:289`) | `translate.ts:429-434` | A `ref` key is tolerated today; R-2b must warn without rejecting. |
| **MULTI-GRAPH-ISOLATION D2 — handler-def resolution+compilation scope-local** (`decisions.md:47`) | `registry.ts:86-92`; `node.ts:1882` | The only defensible resolver home is scope-keyed. |
| **MULTI-GRAPH-ISOLATION D3/D5/D6** (`decisions.md:47`) | `registry.ts:23-49`; `supervisor.ts:1744-1750` (`UNVERIFIED:`) | Any new walk touching ids must be scope-filtered (ISO-1 precedent). |
| **`script-dsl-review.md` Hard boundary — runtime-written data can NEVER become a native handler closure** (`:139-145`) | `translate.ts:393-427`; `registry.ts:113-119` | A `ref`/def-registry function is *named host code*; the distinction must be written down. |
| **VERSIONING-SCHEME** (`decisions.md:32`) | `package.json` | Every approved item states its class: `X.X.Y` (R-2a/R-2b), `X.Y.X` (R-3/R-6). |
| **PASS2-FIT-REFERENCE-SLICE-SCOPE** (descendant-closed slice invariant) (`decisions.md:17`) | `resolve.ts:229-238` (`UNVERIFIED:`) | The slice composition is load-bearing for `invalidate`. |
| **RUNTIME-FORK-GROWTH-GUARD — d10→d12 pass-2 ratio, bound 10×** (`decisions.md:20`) | `scripts/demo-smoke.mjs` (`UNVERIFIED:`) | The one automated guard that catches pass-2 amplification from a dirty-set change. |
| **R-VPD-2 ghost-`childOrder`** (`defects.md:16`) | `render-helpers.ts:325`; `render.ts:99-105` | The replace half's residual; must not be cited as closed by anything here. |
| **JOURNAL-READ-API D1/D5 — sanitized, read-only, never a raw entry** (`decisions.md:28`) | the journal surface | R-3 must not journal. |

---

## 7. MUST NOT BREAK

Each line names the **enforcement** that would catch a breach, so a later unit knows what to run.

1. **The E2E-4 affected set stays `{container, added}` for `placement-attach`** — `tests/e2e/path-fork-e2e.test.ts` E2E-4 (compile-scope spies + pass-2 keys).
2. **Pass-2 must not amplify** — `[runtime-fork:growth] … bound 10×` every smoke run, plus the 2.5× derived per-region pins.
3. **`focusedSliceFor`'s composition stays ancestor-chain ∪ descendant-closed subtree (∪ the target-gated provider universe)** — the FRS suite incl. `FROZEN_GOLDEN`.
4. **An invalidation must not write the journal and must not clear the redo chain** — `tests/unit/journal-read.test.ts`, `undo-redo-report.test.ts` + `-adversarial` (`undoDepth`/`redoDepth`/`undoTopKind`, `scheduledDirtied`).
5. **Dispatch keeps H-H3 (non-function → silent skip), H-H4 (throw contained), H-H10 (phase order)** — `tests/unit/handlers.test.ts` / `phases.test.ts`.
6. **No new code path puts a throw outside a dispatch `try`** — H-H4 cases + the pass-2 tick tests (a throw at `supervisor.ts:656-665` kills the whole flush).
7. **A new warn code must not collide with the warn vocabulary or the `warnings).toEqual([])` pins** — `reverse.test.ts`, `bare-text-warns.test.ts`, the legacy-shape F1-F8, the K8/DV assertions.
8. **The reverse keeps REVERSE-OF-CLEAR and the handler whitelist's round-trip** — `tests/unit/reverse.test.ts` + `translate.ts:1333-1347`.
9. **D2 holds: no handler def, body or resolver crosses a `GraphScope`** — `tests/unit/multi-graph-isolation.test.ts` (X10/X12/X13/X19 + the D2 code-carriage case).
10. **Emit keeps publishing `on:<event>` for a string-event handler** — the adapter/DOM-F rows. This is precisely *why* R-2b must warn rather than re-filter: filtering at emit is a behaviour change, the warn makes the existing behaviour honest.
11. **The journal keeps one entry per op with the recorded result fields** — `tests/integration/supervisor.test.ts` + `ops.md` §6.
12. **Persistence round-trips neither gain nor lose handler data silently** — `def-roundtrip.test.ts` + the serialize/loadState suites, and the recorded residual that handler bodies stay runtime-only (which is why no `ref` field may be sold as a persistence fix).
13. **`npm test`'s two phases stay intact** — any new smoke-spawning file joins `SMOKE_SPAWNING_TEST_FILES`, never skips (AGENTS.md item 4).
14. **No doc may claim a seam that does not exist** (the N6/N8 class) — the re-emit sentence ships **with** the probes that assert it, not before.

---

## 8. The red-first work the next unit owes (ordered)

**Phase 0 — confirmation:**
- **P-1 attach-unregistered red probe** — authored container + fresh unregistered node + `apply({kind:'attach'})` → the container's markup unchanged, the op reports `{status:'applied', dirtied:[node.id]}`, and **no** diagnostic. Confirms the OPEN row and fixes the vocabulary (register vs reject).
- **P-2 registration counter-probe** (the control that makes P-1 meaningful) — same graph with `registerNode(child)` first → `takePass2States()` keys contain **container + root**, the container's `children` contains the new child, exactly **one** append, exactly **one** journal entry. If P-2 does not behave this way, the H-1b adjudication reopens.

**Phase 1 — the two containment defects (independent red sets, no shared code):**
- **P-3 invalidate-vs-unregistered hypothesis probe** — with the P-1 graph, mark the **container** dirty (the documented escape hatch) and assert whether the unregistered child surfaces through the anchor-derived slice. Determines whether an invalidation *masks* the registration defect in the render dimension. Gates R-1's documentation wording, not its code.
- **P-4 placement-routed branch probe** — mark a placement-routed node dirty → **no ancestor state**, `compilePath` ran; re-confirm the family-routed-container orphan pin so carve-out (b) is asserted, not quoted.
- **P-5 forced-re-emit cost probe (the measurement R-3 waits on)** — for one activation of K nodes: (a) journal delta; (b) `redoDepth` before/after (**must show the destruction**); (c) `undoDepth`/`undoTopKind` after; (d) what `undo()` of that entry actually does (the zero-layer state-slice undo executor is `UNVERIFIED:` and must be measured); (e) pass-2 ms delta on a d12-shaped tree as a growth-guard-interpretable ratio. **R-3 is approved iff K is large enough that the journal/redo cost is unacceptable, or (d) proves the escape hatch unsafe.**
- **P-6 replace-half probe** — destroy a child of a registered container → the parent's `childOrder` still names the dead wire for at least one flush. Decides whether a *replace* capability is missing or merely an R-VPD-2 residual.
- **P-7 H-2 premise + silence probe** — (i) a live **function** body → dispatch runs, no source text in any observable data path; (ii) a **body-less** `{name, event}` handler → dispatch returns `[]`, emit **still** publishes `on:<event>`, **no warn anywhere** (spy `console.warn`, assert exactly zero — the red half); (iii) the same shape with `ref:'x'` → identical behaviour. This is R-2b's red set.

**Phase 2 — the need probes (may invalidate Phase 3 entirely):**
- **P-8 H-2 persistence need probe (DOWNSTREAM-SIDE, out of tree)** — is the module graph a **persisted JSON** document or an **in-process composed envelope**? If in-process, R-6 is **DEAD**.
- **P-9 (conditional on P-8 = persisted) def-registry live-function probe** — `registerHandlerDef(name, {body: fn, format})` → the seam materialises → dispatch runs → `reverseTranslate` contains **no** function source for the seam layer → an isolated scope cannot resolve it (D2). Red until `registry.ts:80-84` widens and `node.ts:1889` branches.
- **P-10 value-provider re-test at 0.5.2** — `H-1`'s third reading re-run at the pinned version, where VALUE-PROVIDER-RENDER-DISPOSITION shipped. Cheap; retires a claim otherwise carried on faith.

**Phase 3 — implementation order:** R-2a → R-2b → R-1 (docs land **with** their assertions) → R-3 (only if P-5 says so) → R-6 (only if P-8 says so). Red set first, no implementation in the same pass (AGENTS.md item 8), trio after each landing, watching the growth guard.

---

## 9. Open questions for the owner

1. **Is a re-emit request a journal event at all?** The empty-`state-slice` escape hatch records a render request as a graph edit. If the answer is *no — the journal logs graph edits only*, then `invalidate` is not a convenience but a **correctness** member, and Q2 collapses.
2. **Does activation's journal cost matter?** What is the real K (nodes per module activation), and does the host rely on its redo chain surviving an activation? This number decides R-3.
3. **Is the downstream's module graph persisted JSON or an in-process composed envelope?** The decisive unknown for all resolver work (P-8). Until it is answered, no name→body surface should be designed.
4. **May a host-injected closure reverse as its source text?** Today's reverse ships live bodies as source and `translate.md:283` pins it for round-trip fidelity — but the downstream's contract forbids exactly that. Choose: keep (round-trip wins), emit a key/placeholder for host-injected layers, or emit nothing.
5. **`attach` on an unregistered node: register it, or reject it?** Register-if-new is consistent and needs no union change; rejecting needs a new `ApplyErrorCode` member and breaks any host relying on the current no-op.
6. **Does the re-emit sentence get pinned as an ACTIVE decision row + spec table, or only as a `designing-pages` recipe?** A decision row makes it enforceable; a recipe alone leaves it advisory.
7. **A body-less handler: warn (additive, patch) or reject at translate (breaking)?**
8. **Target version for the additive members** — `0.6.0` (`X.Y.X`) for R-3/R-6; the defects (R-2a/R-2b) are `X.X.Y` and can ride the next patch. One release or split?
9. **How is the refusal communicated downstream — as closing the finding, or as a redirect?** The honest answer upstream owes is: *activation is a register-then-attach; re-emit is one focused slice; replace is bounded by the documented carve-outs; the renderer need is met without graph text.* That answer should travel with the handoff reply, not stay in this record.

---

**Verdict, one line.** `H-1b` is **REJECT as written** (the capability exists, and the asked shape is the
prohibition) → replaced by **ACCEPT-NOW** `ATTACH-UNREGISTERED-SILENT-NOOP` + the stated re-emit
sentence, with `Supervisor.invalidate` **approved only on P-5's measurement**; `H-2` is **REJECT as
written** (the seam is in the wrong place and would formalise a live silence) → replaced by
**ACCEPT-NOW** `HANDLER-BODYLESS-SILENT-DEAD` + the host-owned-body recipe, with a def-registry
live-function body **parked behind P-8**. Neither ask proceeds to a spec until the two containment
defects land and the two need-probes answer.
