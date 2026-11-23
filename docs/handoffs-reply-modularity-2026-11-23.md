# Reply to `Provident-Electron`'s modularity handoff (`H-1`/`H-2`) — upstream response

**To:** `Provident-Electron` (modularity unit) · **From:** `Preempt-Providence` (the `provident-ssr`
package) · **Date:** 2026-11-23 · **Pin answered:** `provident-ssr@0.5.2`.
**Upstream gate record:** `docs/specs/handoffs-review-11.md` (three-agent gate, AGENTS.md item 9) ·
**triage:** `docs/specs/handoffs-triage-modularity-2026-11-20.md` · **source handoff:**
`docs/handoff-modularity-2026-11-20.md`.

**Framing.** This is a **redirect, not a closing**. Both findings are real observations about a real
engine, and neither of your stated blockers is dismissed. But neither can be answered by the surface it
requests, and two of the premises the handoff states as fact are false against 0.5.2 — which matters,
because a spec written on them would pin the wrong contract. Nothing here greens a downstream row
(`D-5`); your catalogue stays your unit records'.

---

## 1. `H-1` — post-compile structural change

### 1.1 What is true (and we are fixing it)

**The one reachable, reproducible case is a defect of ours: `attach` never registers its node.**
`attach` is the only add-op in `apply` that omits `registerNode` (compare `placement-attach`,
`clone-instance`, `layer-apply`, `rows-mint`, which all register-if-new), and the pass-2 flush silently
skips any dirty id that is not in the supervisor's node map. So a fresh node attached into an existing
container produces **no render and no diagnostic** — the op still returns
`{ status: 'applied', dirtied: [node.id] }`. Filed as **`ATTACH-UNREGISTERED-SILENT-NOOP`**, and it is
now the **head of our work queue**; the fix shape (register-if-new vs an explicit rejection) is being
decided on probe evidence.

**You are not blocked on it today.** Either of these works now:

- `supervisor.registerNode(node)` **before** `apply({kind:'attach', …})` — then the flush compiles the
  child's focused slice and the container's `childOrder` diff emits the append;
- or use `placement-attach` / `layer-apply`, which register-if-new and mark their target themselves.

### 1.2 What is false: "adding a child leaves the container's markup unchanged" (as a general rule)

For a **registered** family child the container **is** re-derived today. The flush compiles the child's
focused slice, and that slice is `focusedSliceFor(node)` = **ancestors-to-root ∪ descendants**; the
compile pushes a compiled state for **every viable slice member**, not just the focus node, so the
container's state is regenerated with the new child and its `childOrder` diff emits the append. The
property you are relying on already holds — which is also why "dirty the ancestor chain to the root"
buys nothing new.

### 1.3 The re-emit contract, stated — this is the sentence you asked for

> **A post-bootstrap structural change re-emits the dirty node's focused slice — the changed node, its
> ancestor chain to the root, and its subtree — as pass-2 states. The renderer diffs those against its
> previous map, so an ancestor whose `childOrder` changed emits append/remove ops and untouched branches
> emit nothing.**

Two carve-outs, both pinned in `placement-path-spec.md` §3.3, and both real:

- **(a) placement-routed nodes do not ascend.** A dirty node carrying `content` anchors is compiled in
  path-enumeration mode (`compilePath`) and produces its own path-states only. It does **not** re-derive
  its ancestors.
- **(b) a `placement-attach` into a container that is not placement-routed leaves the added node's
  path-state orphaned** — the widget does not render, by design, and no ancestor dirtying fixes it.
  (This is the shape behind your `D-182` reading.)

### 1.4 Forcing a re-emit today, and its price

A node-keyed forced re-emit **composes** from public parts, unjournaled, via the exported helpers
(`focusedSliceFor` + `Node.compile` + `Supervisor.recordResolved` + `renderProducingProcess`).

There is also a one-line escape hatch — `apply({ kind: 'state-slice', node, mutation: [] })` — but we are
**not** blessing it as the recipe, because of what it costs: it journals an entry whose inverse has zero
layers, it **clears your redo stack**, and it schedules a condense past `maxJournalLength`. A render
request is not a graph edit, and nothing in the contract currently promises an empty mutation list stays
`applied`, so relying on it is a latent coupling. What we will do instead: document the honest recipe,
and decide — on a cost measurement — whether to admit a dedicated **non-journaled** render-plane member
(`invalidate(nodeRef)`: one id, no journal, no redo clear, no structure event, **no ascent**), in the
same class as `flush()`/`dispatchAndReport()`/`hasPendingWork()`.

### 1.5 The replace half

Removal currently leaves a stale parent until the next ancestor compile — the known residual
**`R-VPD-2` (ghost `childOrder`)**, open, general across drop classes, and not something a new op kind
would close. Do not read any of this as closing it.

---

## 2. `H-2` — host-owned behaviour on a node

### 2.1 What is false: "a handler body is only a function STRING"

Function values **are** admitted. `translateLegacy` accepts `body` as a function (the admission guard
only rejects a body that is *present and wrong*, and the branch keeps a function verbatim), the node
stores it, and dispatch calls it. In-process, a closure rides the graph today.

What is genuinely string-only is (i) the `new Function` compile of a body authored **as source** and
(ii) the **persistence boundary**: `serializeNode` emits no `handlers` key at all, and reverse emits a
live body's source text. **So if your module graph is a persisted JSON document, your blocker is real —
and it is a *persistence* blocker, not an API one.** That distinction decides everything that follows.

### 2.2 What is also false: "exactly as it already supplies adapter and transform hooks"

`translateLegacy(doc, opts)` takes `{hub?, graphScope?}` only; there are no transform hooks anywhere in
the package; the single adapter callback is `DomAdapterOptions.onEvent`, a host event sink. The analogy
does not hold, and a spec must not repeat it.

### 2.3 The need you stated is met today, in-process, with no text in the graph

Three sanctioned paths, all carrying **live function bodies** (never source):

| Path | Use when | Properties |
| --- | --- | --- |
| `state-slice` with `targetProp: 'handlers'` | one live in-tree node | journaled, undo-exact, pass-2'd, real closures |
| `layer-apply` with `data.handlers` | a module-owned subtree | mints family children carrying closures; teardown = one `removeLayer` |
| `addLayer` | pre-mount prototypes only | the approved name→body seam letter; **not** for live in-tree nodes |

The smallest recipe for "a module names renderer code the host owns": keep a host-side
**name → function** table, author each node with a handler whose `name` (or `event`) is the key, and
install the closures with one `state-slice` per node (or one `layer-apply` per subtree). No source text
enters graph data.

### 2.4 Why not `handlers[].ref` + a dispatch-time resolver

- **It would formalise a live silence.** A handler with an `event` and **no body** is already accepted at
  translate, silently skipped at dispatch, and **still emitted as a live-looking `on:<event>` listener**.
  A `ref` field would inherit exactly that silence. We are fixing the silence first — a translate-time
  `handler-body-missing` warn in the `handler-body-invalid` family, so a key that cannot resolve is
  **loud** — and only then is a key-based seam even safe to consider. Filed as
  **`HANDLER-BODYLESS-SILENT-DEAD`**.
- **It forks the scope-keyed registry.** The package already resolves a name→body per graph scope, at
  compile, with per-entry containment, `format`-awareness and reverse exclusion (`GraphScope.handlerDefs`
  / the handler-seam). A second, dispatch-time name→closure map is two registries with different keys,
  scopes, precedence and warn codes — and cross-scope resolution is the one thing our multi-graph
  isolation contract forbids outright.
- **Its containment would sit outside the try.** The `typeof body !== 'function'` skip is in the loop
  head; only the body call is guarded. A resolver that throws there aborts the whole pass-2 tick.

**If a persisted-graph resolver is ever admitted, the right home is that existing scope-keyed registry
widened to accept a live function — not a new dispatch-time lookup.** We have parked that behind one
question to you.

### 2.5 One pinned conflict you should know about (ours to decide, but it affects you)

Reverse re-emits a live body **as its source text** (pinned for round-trip fidelity). If a host injects a
closure it does not want in graph text, that pin is in tension with your UI-authority contract. We have
recorded it as an open owner decision with three candidate resolutions (keep / emit a key for
host-injected layers / emit nothing for that class) rather than silently changing it.

---

## 3. Two corrections you should apply on your side

1. **Re-test `H-1`'s third reading at 0.5.2.** "The first post-bootstrap mint drops an authored bootstrap
   consumer" describes the class closed by **VALUE-PROVIDER-RENDER-DISPOSITION** — which shipped **in
   0.5.2, the version you pin**. It may already be gone; it must not be carried as live without a re-run.
2. **Your `H-1` reproduction step as written cannot produce the symptom** for a registered node. Please
   re-derive it against the register-then-attach path in §1.1 and tell us whether anything survives that
   we have not named above (the two carve-outs, the replace residual, and the silent-`attach` defect).

---

## 4. What upstream is doing, in order

1. **`ATTACH-UNREGISTERED-SILENT-NOOP`** — attach registers (or rejects explicitly); either way the op
   stops reporting `applied` when its mark cannot reach pass-2.
2. **`HANDLER-BODYLESS-SILENT-DEAD`** — the translate-time warn, so an unresolvable key is never silent.
3. **The re-emit sentence and the host-owned-behaviour recipe**, documented with both carve-outs and with
   the escape hatch's price stated.
4. **`Supervisor.invalidate`** — only if a cost measurement shows the honest recipe is insufficient.
5. **A scope-keyed def-registry live-function body** — parked on the question in §5.

---

## 5. What we need from you (one question, and it decides item 5)

**Is your module graph a `persisted JSON` document, or an in-process composed envelope?** If in-process,
the resolver surface is moot — §2.3 already meets your need and we owe you only documentation. If
persisted, say so and we will take the scope-keyed registry widening off the shelf against your case.

Please also send, if you have one, a **minimal probe against 0.5.2** for any case you believe no
combination of §1.1/§2.3 reaches. A red probe is the one thing that reopens either verdict.
