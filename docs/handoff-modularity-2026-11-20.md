# Handoff — two findings from `Provident-Electron`'s modularity unit, at `provident-ssr@0.5.2`

**From:** `Provident-Electron` — the downstream implementation test of this package, pin `provident-ssr ^0.5.2` ·
**Date:** 2026-11-20 · **Class:** findings, not patches — the downstream never touches the package.

Both findings came out of building a module system on this package (`docs/L1/modularity.md` in the downstream's corpus); each is recorded there as a handoff with the four fields below and is upstream-owned.

---

## H-1 — a post-compile structural change does not re-emit, and the public surface has no node-keyed invalidation entry

**Symptom.** After the first compile, adding a child to an existing authored container leaves the container's markup unchanged. A module can therefore not be activated or replaced after a boot without a fresh boot. Two further readings of the same class: path-compiling double-emits, and the first post-bootstrap mint drops an authored bootstrap consumer.

**Measured in the downstream** (its corpus, cited by row, never restated here): `D-182` — a minted row renders wherever its target lives, and post-bootstrap placement routing does not work; `D-252` — the move half resolves and applies, so a node can be relocated, while the structural re-emit of an ancestor cannot be forced.

**Reproduction.** Construct the producing process over an envelope and let it bootstrap; add a child to an existing authored container; re-render. The container's markup is unchanged — the child may render at its own target while the container's emitted subtree is never re-derived.

**Suspected root cause.** The render path applies a per-node diff of compiled states (`src/core/render-helpers.ts`'s `renderProducingProcess` and `applyOps`; `src/core/supervisor.ts`'s `apply`), and the public surface carries no entry keyed by node id that dirties the ancestor chain — `src/index.ts` exports `Node`, `Supervisor`, the translate/render helpers and the dispatch functions, and no `invalidate`/`recompile` member exists on any of them. So an added node's parent is never dirtied, and the container's markup is never re-emitted.

**Proposed fix shape.** A public recompile/invalidate entry keyed by node id that dirties the ancestor chain to the root — or an insert/replace op whose recompile does — with a stated sentence of what a post-bootstrap structural change re-emits. Either shape keeps the current bootstrap path untouched.

**What the downstream does not need from this fix.** Its module design's ordered graph point is **envelope composition before `translateLegacy`** — no package change is needed for the ordering must-have — and its post-bootstrap phase is an ordinary command that claims no placement routing. The finding blocks only *activating or replacing a module after a boot without a fresh boot*.

---

## H-2 — a handler body is only a function STRING, and the dispatch path has no resolver indirection

**Symptom.** Behaviour on a graph node can only be a function-STRING body evaluated at translate. A module's renderer code must therefore be re-materialised as source text in the graph — which the downstream's UI-authority contract forbids, because a module's logic would ride in graph text where `dispatch`, `get_rendered_html` and `get_markdown` can read it as data.

**Reproduction.** Author a node whose `handlers[].body` is a function value: the graph admits no closure. The handler is compiled from its string form (`src/core/node.ts`'s handler layer at `:1729` and its two construction sites at `:1891-1892`; `src/core/translate.ts:404` keeps `sourceBody`), and dispatch evaluates `body` only.

**Suspected root cause.** The handler contract is `{name, event, body: compiled-from-a-string}` and the dispatch path has no resolver indirection, so a host-owned function has no representation in graph data.

**Proposed fix shape.** Admit `handlers[].ref` whose value is a KEY the HOST resolves at dispatch through a resolver the host supplies — exactly as it already supplies adapter and transform hooks — with an unresolved key contained per handler. A graph authored as data can then name behaviour the host owns without carrying its text.

**What the downstream does with it.** Its `C-10` names a module's renderer code by key in a foundation-owned table and resolves it at dispatch; `H-2` is the first-class form of that, and only the binding-in-graph would be this package's. No downstream row may green on a handoff (`D-5`).

---

**Status in the downstream.** Both are recorded as `H-1`/`H-2` in `Provident-Electron/strata/records/modularity-unit.md` with all four fields, upstream-owned and never patched there. The downstream's own defects catalogue for this package stays its unit records' (`D-5`/`D-52`), and this handoff is the delivery, not a second catalogue.
