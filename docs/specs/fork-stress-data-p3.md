# Spec — FORK-STRESS-DATA-P3: the data-driven fork-stress family's migration from clone-assembly to path enumeration (23 nodes, 4095 wires/elements, `cloneOps = 0`)

- **Status:** `SPEC-WRITTEN 2026-09-22 (user ruling) — awaiting the TDD gate`.
  **This is the Step-4 contract (AGENTS.md item 7) for a PAGE re-expression
  unit.** Nothing in this file is built yet: the current data-driven family
  still assembles by `clone-instance` (measured `cloneOps = 4094` at d12), and
  the conversion is this unit's implementation pass. **The ruling supersedes
  the CURRENT behaviour; it does not declare it a defect** (§4).
- **The user's ruling (2026-09-22, binding — quoted verbatim):**
  > "The fork-stress tests are now showing per-element clones when they should
  > be containing only 23 nodes with 4095 wires/elements."

  **Ruling 1 (construction model):** *convert the data-driven family to path
  enumeration — 23 nodes, 4095 wires/elements, `cloneOps = 0`.* **Ruling 2
  (the pin):** *pin the sanctioned clone count as an explicit assertion*, so
  any drift in that family's construction is caught rather than silently
  accepted — in this unit's terms the migration makes the target **`0`**, and
  the assertion must **fail** if a node is minted per path/element or a clone
  reappears (§3 **K6**).
- **Supersession of `docs/specs/fork-stress-data.md`'s RUNTIME-variant scope
  note:** **ANNOTATED, not deleted** — the historical record stays, with a
  pointer to this file (§4). The superseded scope note's two load-bearing
  sentences are: *"this spec describes the RUNTIME fork-stress-data page (the
  after-compile `clone-instance` expansion), which is KEPT as-is alongside the
  new STATIC page"* (`docs/specs/fork-stress-data.md:8-10`) and *"`cloneOps`
  stays the journaled clone count"* (`docs/specs/fork-stress-data.md:22`).
- **Why the current behaviour existed (recorded, NOT a defect):** the
  data-driven family **predates P3** and the static re-expression. It was
  written when `clone-instance` + after-compile recursion was the only
  prototype-driven assembly route, and it was then **deliberately retained**
  (`docs/specs/placement-path-spec.md:625-629` — *"The runtime fork-stress page
  is KEPT as-is alongside (R2.8 ¶4: 'add a static page alongside rather than
  converting the runtime one'); both ship (Q4 resolved)"*; the retention is
  also recorded in `docs/specs/derived-fork-variants-review.md:289` —
  *"Runtime clone pages stay as legacy-stress tests | **ADOPT**"*) to keep
  exercising **prototype-driven `after-compile` expansion** — the ONE
  sanctioned `clone-instance` route (`docs/specs/ops.md:88`, the
  **HANDLER-LOGIC ONLY** clause). Its census was never wrong: it reported its
  own journal faithfully — `[fork-stress-data:profile] depth=12
  method=placement nodes=4095 … handlers=4094
  census(registered=4117 … cloneOps=4094 journalCloneOps=4094
  cloneOpKinds={"clone-instance":4094,…})`, **measured 2026-09-22 in the
  enforcement/RCA session**. The user's ruling retires the retention.
- **Measured starting point (measured 2026-09-22 in the enforcement/RCA
  session — cite, do not re-derive; the three-families table):**

  | family | page(s) | graph nodes (d12) | states/elements | clones | construction |
  | --- | --- | --- | --- | --- | --- |
  | **static / derived** | `demo/path-fork-data*.html` — the d12 trio (`path-fork-data.html`, `-values-d12.html`, `-link-d12.html`) + the d14 probes | **23** (22 prototypes + root) | **4095** | **0** | path enumeration (P3) |
  | **imperative runtime** | `demo/fork-stress-d12.html` (`demo/fork-stress.js`) | 4096 | 4095 | **0** (zero `clone-instance` in that module) | real nodes via the 4 layer mechanisms |
  | **data-driven runtime (THE TARGET)** | `demo/fork-stress-data-{placement,values,link}-d12.html` (`demo/fork-stress-data.js`) | 22 prototypes + root, **4117 registered** | 4095 | **4094** (journal-measured) | `{kind:'clone-instance'}` per level, driven by an `after-compile` handler named `stress-expand` |

  *(Precision note on the brief's table, recorded rather than silently copied:
  the `{placement,values,link}`-suffixed d12/d14 pages are the **data-driven
  runtime** family — the target, row 3 — NOT derived variants; the
  **derived** trio is `demo/path-fork-data{,-values-d12,-link-d12}.html`
  (`demo/path-fork-page.mjs:1-14` builds the latter; `demo/build-demo.mjs`
  emits both sets). Naming the target's own files as "derived" would put the
  target inside the family it is being converted to match.)*

  The two readings that anchor the above: `[derived-fork:profile]
  method=placement states=4095 elements=4095 … census(registered=23 inTree=23
  unplaced=0 destroyed=0 cloneOps=0 …)` and the runtime line quoted in the
  bullet above. The d12 static census is also pinned in
  `docs/specs/placement-path-spec.md:639` (*"registered = **23**; in-tree =
  **23** … path-viable = **4095**; unplaced = **0** … destroyed = 0;
  **cloneOps = 0**"*) and in the per-page census table at `:655-657`.
- **Target model (the reference implementation to describe, read this pass):**
  `docs/specs/placement-path-spec.md` §2 (path enumeration over the 23-node
  graph), §5.1 (the page re-expression) and §5.2 (the static census);
  the shipped static pages `demo/path-fork-data.js` (+ its HTML family and
  `demo/path-fork-data.html`); the engine surfaces `translateLegacy`, the
  placement `container`/`content` anchor roles + the shared per-name Link,
  `compilePath`/`mintPathState`/`pathWireOf`, `emitElements`, and the
  def-fill/covered-leaf gate (`docs/specs/render.md:224` **DFC-1**; DEFECT #21).
- **TestWriter contract:** every state, census expectation, per-variant
  expression, register row, generator and falsification condition below is
  derivable from this file ALONE (no implementation reading beyond the cited
  anchors). §8 carries the per-unit test contracts and the expected RED/GREEN
  statuses.
- **Citation convention (mirrors `docs/specs/no-clone-invariants.md:44-58`):**
  `src/**`, `tests/**`, `scripts/**`, `demo/**` and `docs/specs/*.md` anchors
  carry line numbers **read this pass (2026-09-22)**; **tracker rows**
  (`docs/decisions.md`, `docs/defects.md`, `docs/pending.md`) are cited **by row
  NAME** wherever the citation is load-bearing, because those files are
  re-ordered every pass and their line numbers drift.
  ✎ **ONE KNOWN DRIFT, created by this pass — read every
  `docs/specs/fork-stress-data.md:N` anchor as the PRE-ANNOTATION line N:** the
  §4 annotation was inserted **into** that file at `:24-50`, so every line at or
  below it has moved **+28** (verified this pass: the section headers now sit at
  Purpose `:52`, Data envelope `:83`, Page module `:121`, Single-method variants
  `:180`, Constraints `:232`, Lessons learned `:253`, Docs to update `:357` —
  each **+28** from the pre-annotation position quoted above). **No claim in
  this file depends on a post-annotation number**, and the affected sections are
  named wherever they are cited, so the citations are unambiguous; the landing
  pass re-points them to the post-annotation lines in the same pass it rewrites
  that file's body (§8.3 duty 1).
- **Date:** 2026-09-22.

---

## 1. Status

| Item | Value |
| --- | --- |
| Concern | The **data-driven fork-stress family's construction model** — migrate it from `clone-instance` assembly to path enumeration |
| Owning ask | the user's 2026-09-22 ruling (both halves — the conversion and the clone-count pin; §0 above) |
| Gate state | **user ruling recorded; this is the Step-4 spec** (AGENTS.md item 7) — the TDD gate has not run |
| Behaviour change | **PAGE-LAYER ONLY.** `demo/fork-stress-data.js` (+ its template/builder/smoke wiring). **No `src/**` change is in scope** (§2.2) |
| Current behaviour | clone assembly: `registered = 4117`, `cloneOps = 4094` at d12 (journal-measured) — **SUPERSEDED, not defective** |
| Target behaviour | path enumeration: `registered = inTree = 23`, `cloneOps = 0`, `states = elements = 4095` at d12 (the static family's expression) |
| Test-side deliverable | the §8 case set (**expected RED today / GREEN after the conversion**) + the §5 typed property register |
| Harness deliverable | the `fork-stress-census` / `fork-stress-variant-census` expectation re-derivation + the `assertForkStressCensus` re-expression (§8.2) |
| Trackers the landing pass owns | `docs/decisions.md` + `docs/defects.md` + `docs/pending.md` / `docs/next-steps.md` rows (§9) |
| Docs the landing pass owns | `docs/specs/fork-stress-data.md` (the §4 annotation is made **here**; the body rewrite is the landing pass's), `docs/skills/designing-pages.md` §11/§12, `docs/specs/fork-stress-data-p3.md` (this file's status line) |

**One-line status:** the data-driven family is the **only** fork-stress family
that still clones, because it was deliberately retained as the sanctioned
`after-compile` expansion proof — the user's ruling converts it to the static
family's construction (path enumeration over 23 nodes / 4095 wires) and pins
`cloneOps = 0` as an **assertion**, so the retention's cost (4094 mints and the
whole pass-2 cascade behind them) is retired and any drift back to cloning
fails loudly instead of being silently accepted.

---

## 2. Scope

### 2.1 IN

| # | In scope | Where the contract lives |
| --- | --- | --- |
| 1 | The family's **construction model** (path enumeration; no per-path/per-element node) | §3 **K1** |
| 2 | The family's **census** and its per-depth generalisation | §3 **K2** |
| 3 | The **three method variants** re-expressed in envelope data + the path model | §3 **K3** |
| 4 | The **envelope** shape, the core-only import rule, and the data-declares-everything rule | §3 **K4** |
| 5 | What the family **uniquely covers** after conversion, and what coverage is LOST | §3 **K5** |
| 6 | The **clone-count pin** (the user's second ruling) | §3 **K6** |
| 7 | The **no-clone invariants** (I1..I5) applied to the converted family + the **re-derived** register relations | §3 **K7** |
| 8 | The **handler-coverage replacement** | §3 **K8** |
| 9 | The **supersession annotation** of `docs/specs/fork-stress-data.md` | §4 |
| 10 | The **typed property register** (PBT gate deliverable, `P-IM`/`P-SM`/`P-TP`, ≤ 8 rows) | §5 |
| 11 | **Risks / costs** | §6 |
| 12 | The **falsifiable acceptance checklist** | §7 |
| 13 | The **test contracts** — case ids, observables, expected RED/GREEN, and every smoke/page assertion that must change | §8 |
| 14 | **Cross-references** | §9 |

### 2.2 EXPLICITLY OUT (with the recorded reason)

| # | Out of scope | Recorded reason |
| --- | --- | --- |
| 1 | **Any engine (`src/**`) behaviour change.** If the conversion turns out to require an engine change, that is a **GATE FINDING to escalate** — **not** licence to edit `src/**` in this unit | This is a PAGE re-expression unit: the static family already proves the same topology compiles by path enumeration with **zero** `src/**` change (`demo/path-fork-data.js:245-258`, `docs/specs/placement-path-spec.md:615-624` — *"No handler bodies, no `clone-instance`, no after-compile expansion. The tree is compiled by the §2 path enumeration … E2E-1 holds by construction"*). A red case here is a **discovery**, and the engine patch (if any) is a separate, gated unit (the `no-clone-invariants.md` §2.2 row 1 precedent) |
| 2 | **The static family** (`demo/path-fork-data.*`) | **Already conformant — no change.** It is the reference the converted family must match: 23/4095/0/0 (`docs/specs/placement-path-spec.md:639`, `:655-657`) |
| 3 | **The imperative runtime family** (`demo/fork-stress-d12.html`, `demo/fork-stress.js`) | **Already conformant** — a real-node build with zero `clone-instance` in the module (measured 2026-09-22 in the enforcement/RCA session; its guard is `runtime-fork-stress-census`, `scripts/demo-smoke.mjs:688-739`) |
| 4 | **The engine's `clone-instance` op** | **Unchanged, still sanctioned for handler logic** — `docs/specs/ops.md:88` (**HANDLER-LOGIC ONLY**) + `docs/specs/no-clone-invariants.md` §3 **I4** (`src/core/ops.ts:647-652`, `src/core/supervisor.ts:1233-1269`). This unit removes a PAGE's use of the op; it does not touch the op |
| 5 | **The pass-2 performance unit** (`RUNTIME-FORK-PASS2-RATIO`; `docs/defects.md` row of that name, `docs/pending.md` row of that name) | **A separate unit with its own gate.** The conversion *removes* one contributor to that lead (the converted family has no pass-2), which is **evidence for** that unit, not a substitute for it. **Do not re-baseline the 3× tripwire here** (`docs/decisions.md` **RUNTIME-FORK-TRIPWIRE-BOUND** — the bound is the user's) |
| 6 | **Re-pinning any other existing oracle or census value** | The only pins this unit moves are the ones that **encode the clone model for THIS family** (§8.2 names every one). Every other pinned value is untouched; a re-pin outside that list is a separate, evidenced change |
| 7 | **The trackers** (`docs/decisions.md` / `defects.md` / `pending.md` / `next-steps.md`) and the `docs/skills/designing-pages.md` §11/§12 rows | The **landing pass** owns those (this file cross-references them, §9). The §4 annotation to `docs/specs/fork-stress-data.md` is made **here** because it is required to keep the two specs from contradicting each other |
| 8 | **Deleting the `handlers`/`stress:handler`/`stress:layers` data keys from every other fork family**, or re-expressing the multi-method (cycle) pages | Only the data-driven family's envelope is in scope (§3 K4); the cycle pages' labels are the imperative page's documentation device (`docs/specs/fork-stress-data.md:152-155`) |

---

## 3. The contract — clauses K1..K8

Each clause states its **owning record**, the **code/page sites it constrains**
(every one a `file:line` this pass read), **what a violation looks like**, and
its **DECIDED status + source**.

### K1 — the construction model: path enumeration over the prototype topology; no node per path, no node per element · **DECIDED (user ruling 2026-09-22)**

**Statement.** The data-driven family assembles its tree **by path enumeration
over the prototype topology**. The prototypes are **authored content nodes**
(contentNodes-owned, `translate-global` minting) plus the root; **no node is
created per path and none per element**, and **no render/compile pass mints a
node**. The compiled artefacts are **states/wires**: `2^depth − 1` path-states,
one per valid `(prototype, owner-path)` pair back to root, each carrying
`forkKey = pathKey`, and **one emitted element per path-state**.

**Owning record.** `docs/specs/placement-path-spec.md:65` (**E2E-1**: *"The fork
test has ONLY the 22 prototype nodes (+ root). Generating the HTML elements, the
compiled states, and the passes that produce the render-adapter data must NOT
require creating new nodes"*) + `:615-624` (§5.1: *"No handler bodies, no
`clone-instance`, no after-compile expansion. The tree is compiled by the §2
path enumeration: 2^depth − 1 path-states … E2E-1 holds by construction: no node
creation beyond the prototypes at any pipeline stage"*) + `:1658` (*"contentNodes
minting adds ANCHORS, never nodes"*); `docs/specs/no-clone-invariants.md` §3
**I2** (one node, many paths — the wire carries the multiplicity); the user's
ruling (2026-09-22).

**Sites it constrains.**

| Site | What it must do |
| --- | --- |
| `demo/fork-stress-data.js:181-232` (the DATA export) | the envelope keeps the **root + two prototypes per layer** (`:183-184`); the `clone-instance` mechanism is **removed** — the `handlers` declaration (`:198`) and the `stress:handler` prop (`:192`) go, and the file's header description of clone assembly (`:48-53`) is rewritten |
| `demo/fork-stress-data.js:311-361` (`installStressExpandBody`) | **DELETED** — no `addLayer` handler installation, no `protoByKey` expansion registry (`:288-289`), no `chainSegment` writes |
| `demo/fork-stress-data.js:479-503` (the kick-off + pass-2 drain) | **DELETED** — no kick-off `clone-instance` ops, no `takePass2States()` loop. The replacement is the **ONE path-enumeration bootstrap**: the static model is `for (const n of translated.nodes) out.push(...n.compilePath().actionable)` then `recordResolved` (`demo/path-fork-data.js:395-401`) |
| `demo/fork-stress-data.js:372-417` (`mergeStates`/`render`) | the incremental pass-2 render loop is replaced by a **single bootstrap render**; `PROFILE.compileCalls = 1` |
| `demo/path-fork-data.js:188-202` | the **reference envelope**: per prototype `placement: { placementName: 'zone-<k>', ...(k >= 2 ? { targetPlacement: ['zone-<k-1>'] } : {}) }` — the R2.2 sibling-shared owner-name topology (both level-(k−1) prototypes own the SAME zone name; first-match chooses it and the two sibling containers fan the path per hop) |
| `src/core/render-helpers.ts:138-140` (`pathWireOf`) + `demo/path-fork-data.js:472-480` (the page's state census) | every state's wire is derived from the state, never from a new identity; `forkKey === pathKey`; no `#` arm suffix leaks into a `pathKey` |

**The R2.2 multiplicity requirement (do not weaken it).** The 4095 bijection
requires the **two sibling containers of one chosen name** — if each level's
prototypes owned *different* zone names, first-match would pick one container per
hop and the tree would be a single chain, not `2^depth − 1`
(`docs/specs/placement-path-spec.md:604-614`, `:609-611` — *"the 'one zone name
per prototype' phrasing of the draft is superseded by the R2.2 arithmetic"*).

**What a violation looks like.** A node minted per path (distinct `nodeId`
growing with the path count) or per element; `registered` rising between
`translateLegacy` and `emitElements`; a path-state whose `nodeId` is not a
translated node id; a handler or kick-off `clone-instance` op reappearing; a
`stress:layers` chain-slice op reappearing; or an envelope whose prototypes own
**distinct** zone names per level (a single-chain topology).

**Status + source.** **DECIDED** — user ruling 2026-09-22; the mechanism is
already shipped and measured on the static family
(`docs/specs/placement-path-spec.md:639`, `:655-657`), and the no-clone RCA
re-verified it on the current tree (measured 2026-09-22 in the
enforcement/RCA session: *"probe M4 — depth 2/4/6/8/10/12 → translated nodes
3/7/11/15/19/23 … while path-states 3/15/63/255/1023/**4095** … nodeRatio up to
178× with zero node growth"*).

### K2 — the census · **DECIDED (user ruling 2026-09-22)**

**Statement.** At depth 12 the converted family's census is
**`registered = 23`**, **`inTree = 23`**, **`unplaced = 0`**,
**`destroyed = 0`**, **`cloneOps = 0`**, **`states = 4095`**,
**`elements = 4095`** — and it holds **per method** (placement / values / link).
The generalisation over depth (verified below, and required to hold) is:
**`states = elements = 2^depth − 1`**, **`nodes = 2·(depth − 1) + 1 = 2·depth − 1`**
(so at d12: 22 prototypes + root = **23**; at d14: 26 + 1 = **27**), and
**`cloneOps = 0` at every depth**.

**Owning record.** `docs/specs/placement-path-spec.md:639` (the census row:
*"registered = **23**; in-tree = **23** (22 prototypes + root, all
contentNodes-owned — §10.aa); path-viable = **4095**; unplaced = **0** …
destroyed = 0; **cloneOps = 0** (F-1 …)"*) + `:640-641` (state census
`2^depth − 1`, one per path, `forkKey` = `pathKey`; element census
`2^depth − 1`, wires = pathKeys) + `:655-657` (the per-page census table —
23/4095/4095/0/1 for all three d12 variants) + `:671-677` (the **F-13 re-pin**
context: the contentNodes-ownership minting is what makes the prototypes
family-in-tree, which is *why* `inTree` equals `registered` here) +
`demo/path-fork-data.js:148-150` (*"Census (placement-path-spec §5.2): 2·depth−1
nodes → 2^depth − 1 path-states … d12: 23 nodes / 4095; d14: 27 nodes /
16383"*) + `scripts/path-fork-page.mjs:33-43` (`familyFor`: `nodes: 2 * depth -
1`, `prototypes: 2 * (depth - 1)`, `layers: depth - 1`, `states: 2 ** depth - 1`).

**The arithmetic, VERIFIED (this is the clause the brief asked to check).**

| Quantity | Expression | d2 | d4 | d12 | d14 | Source |
| --- | --- | --- | --- | --- | --- | --- |
| states & elements | `2^depth − 1` | 3 | 15 | **4095** | 16383 | `placement-path-spec.md:640-641`, `:658-660` |
| prototypes | `2·(depth − 1)` | 2 | 6 | **22** | 26 | `demo/path-fork-data.js:166-167` (`for k = 1..depth−1`, slots `['a','b']`) |
| **nodes** (prototypes + root) | `2·(depth − 1) + 1 = 2·depth − 1` | 3 | 7 | **23** | **27** | `demo/path-fork-data.js:148-150`, `scripts/path-fork-page.mjs:37` |
| clones | `0` | 0 | 0 | **0** | 0 | `placement-path-spec.md:639` |

> **✎ AMENDED 2026-09-23 — the `states & elements` row holds for the `link`
> variant only at `d ≥ 3` (user ruling, `FD7-D2-LINK-CENSUS`).** The corrected
> relation, measured on BOTH families at d2/d3/d4/d6/d12 × placement/values/
> link: **`states = 2^depth − 1` at every (depth, method)**, and **`elements =
> 2^depth − 1` at every (depth, method) EXCEPT `d2/link = 7 = 3 + 4`** — the 4
> being the **documented** behaviour of the standalone P-EMIT-3 def-fill branch,
> **NOT an engine defect**: the level-1 def hosts' path-states are CHILDLESS at
> d2, so the covered-CHILDLESS gate does not fire for them and their synthetic
> def children (`<wire>:a` / `<wire>:b`) join the element set
> (`src/core/render-helpers.ts:743-746`; the gate's rationale at `:733-742`;
> contract `docs/specs/render.md:224` **DFC-1**, DEFECT #21 — *"a NON-covered
> childless host keeps the standalone fill"*). From `d ≥ 3` those hosts have
> real children (the re-typed def-chain elements), the fill is bounded, and the
> census is exactly `2^depth − 1`. The builder now derives the term from the
> family's own envelope (`derivedDefFillChildlessCount`, `demo/path-fork-data.js`)
> rather than asserting the stale formula, and the page carries an explicit
> d2/link shape pin; the regression protection is the smoke guard
> **`derived-fork-shallow-census`** (`scripts/demo-smoke.mjs`: d2/d3 × three
> methods + a d12 control, measured against the relation, with the d2/link shape
> pinned). Ruling + full measured table + disposition:
> `docs/defects.md` row `FD7-D2-LINK-CENSUS` (FIXED-as-stale-expectation) and
> `docs/decisions.md` row `DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION`. **The
> engine question is CLOSED by this ruling — a future reader must NOT reopen it
> as a defect.**
>
> **✎ ADDENDUM 2026-09-23 (the RUNTIME data-driven family — the static guard
> does NOT cover it):** this file's own family (`demo/fork-stress-data.js`) was
> the LAST holder of the stale relation (defect row
> `FORK-STRESS-DATA-SHALLOW-LINK-STALE-EXPECTATIONS`, FIXED) —
> `derived-fork-shallow-census` mounts the STATIC pages only, and
> `scripts/build-demo.mjs` builds this family's single-method variants at
> d12/d14 alone, so nothing ran its shallow `link` checks. It now applies the
> SAME ruled derivation (its own exported
> `derivedDefFillChildlessCount(states, depth)`, read off the compiled path
> states and used in the census / re-typed / `treeFromOps` checks) and its
> shallow coverage is
> **`tests/unit/fork-stress-data-shallow-link.test.ts`** (d2/d3 `link` pages
> built by the real builder and mounted through the shared shim in-process; the
> page's own banner + published census asserted against a relation re-derived
> independently from the page's envelope). `src/**` untouched; the engine
> question below stays CLOSED.

⇒ **the node count is NOT depth-invariant: it is `2·depth − 1`** (23 at d12,
because 12 is the depth the user named). Stated the long way, as the brief
asked: **for the depth-12 family the node count is the literal `23`; the
depth-general form is `2·(depth − 1) + 1`, which is the same number only when
`depth = 12`.** The alternative reading — *"the node count is depth-invariant at
23"* — **does NOT hold** and must not be asserted: the static family's own d14
row reports **27** nodes (`docs/specs/placement-path-spec.md:658`), which is
exactly `2·14 − 1`.

**The `inTree` clause (the F-13 dependency).** Every prototype is
**contentNodes-owned**, so it resolves family-`in-tree` and is neither
`unplaced` nor destroyed — hence `inTree = registered = 2·depth − 1`, not the
pre-F-13 shape. The runtime family's *current* `inTree` (4117) is the same
quantity computed the old way: `2^depth − 1 + prototypes`
(`scripts/demo-smoke.mjs:748-750`, `:786`; `demo/fork-stress-data.js:506-508`) —
the conversion replaces it with `2·depth − 1`.

**Sites it constrains.**

| Site | Required census |
| --- | --- |
| `demo/fork-stress-data.js:731-746` (the published profile) | `PROFILE.registered/inTree/unplaced/destroyed` over `supervisor.allNodes()`; `PROFILE.cloneOps` **measured from the journal** (§3 K6); `PROFILE.states`/`elements` = `2^depth − 1`; `PROFILE.passes = 1` |
| `demo/fork-stress-data.js:509-532` (the two layer/prototype checks) | replaced by the static family's census check shape: `all.length === familyNodes`, `inTree === familyNodes`, `unplaced === 0`, `destroyed === 0`, **journal empty** (`demo/path-fork-data.js:442-469`) |
| the profile line (`demo/fork-stress-data.js:753-763`) | must publish the census fields the smoke guard reads: `registered`, `inTree`, `unplaced`, `destroyed`, `cloneOps`, plus the measurement tokens `journalCloneOps` / `cloneOpKinds` / `journal` (§3 K6) and `depth` |

**What a violation looks like.** `registered ≠ 2·depth − 1`; `inTree ≠
registered`; a non-zero `unplaced`/`destroyed`; `states ≠ elements ≠
2^depth − 1`; `passes ≠ 1`; a per-depth node count that tracks the *path* count
(e.g. `registered` = 4095 at d12, the "node per path-state" failure the user's
ruling names).

**Status + source.** **DECIDED** — user ruling 2026-09-22; every value is the
static family's landed, smoke-pinned census (`scripts/demo-smoke.mjs:972-1013`
`assertStaticPathCensus`: `registered === 2·depth−1`, `inTree === 2·depth−1`,
`unplaced === 0`, `destroyed === 0`, `cloneOps === 0`, `states === elements ===
2^depth−1`, `passes === 1`).

### K3 — the three method variants, re-expressed in DATA + the path model · **DECIDED (user ruling 2026-09-22)**

**Statement.** `method ∈ {placement, values, link}` still selects the ONE
mechanism the whole tree relies on — but each variant's per-level behaviour is
now expressed **entirely in the envelope data and realised by the path model**,
never by clone-inheritance. The mechanism name rides in `server-data.method`
(`demo/fork-stress-data-placement-d12.html:57` = `{"depth":12,
"method":"placement", …}`) and the page's per-method checks are re-expressed as
**path-state assertions** (`demo/path-fork-data.js:565-620`, exactly the shapes
`docs/specs/derived-fork-variants-review.md:35-36` predicts and `:313` records
as LANDED).

**Owning record.** `docs/specs/derived-fork-variants-review.md` §2 row 1
(*"placement-derived | EXISTS (`demo/path-fork-data.html`)"*) and row 2
(*"values-derived | FEASIBLE, no core change"* — with the mechanism named:
*"`seedOwnBindings` … seeds the path-state bindings from the source values;
`scalarBinding` … emits the text; no def bindings exist in the envelope → no
def-chain → 4095/4095 census holds"*) and row 3 (*"link-derived | FEASIBLE after
the blocker engine gate … covered-leaf def-fill (§4) + adapter-key asymmetry
(§4.5) + derived-bake exemption (§4.6)"* — blocker **RESOLVED**, `:102` option
(a) **ENGINE GATE**, LANDED per `:313`); `docs/specs/placement-path-spec.md:666-669`
(*"the values/link variants add their mechanism checks (fork-stress-data.md §4
bodies re-expressed as path-state assertions …)"*).

**Per-variant expression (this is the clause that needed the most care).**

| Variant | What it expressed BEFORE (clone model) | What it expresses AFTER (path model) — the exact data + realisation | Falsifier |
| --- | --- | --- | --- |
| **placement** | pure clone structure: no component refs, no sources, no defs; chains were `L<k>:placement` (`docs/specs/fork-stress-data.md:166-168`) | **The tree-shape proof alone.** Each prototype carries ONLY its placement declaration — producer `placement.placementName = 'zone-<k>'`, and for `k ≥ 2` consumer `placement.targetPlacement = ['zone-<k-1>']` (`demo/path-fork-data.js:182-191`). No `component` field on any prototype (`demo/path-fork-data.js:203-211` are `method`-guarded). The path enumeration multiplies the two sibling containers of the chosen name per hop, giving 4095 states; `cloneOps = 0` | any `component` field on a placement prototype; a per-level name that differs between the two siblings (which collapses the tree to a single chain) |
| **values** | every **clone** carried `component: { reference: 'values-<layer>.<slot>', value: 'value-<SLOT>-<layer>' }`, inherited by clone-inheritance, and each clone resolved **its own** provider depth-0 (S-R2.6) and rendered it as text (`docs/specs/fork-stress-data.md:169-174`; `demo/fork-stress-data.js:216-219`) | **The same `component` binding, on the prototype, realised per path-state.** Every prototype carries `component: { reference: 'values-<k>.<slot>', value: 'value-<SLOT>-<k>' }` (`demo/path-fork-data.js:203-206`). Each **path-state** of that prototype IS the provider for its own scalar source: `seedOwnBindings` seeds the state's bindings from the source value (translate-time, per authored value — one authored value per prototype), `scalarBinding` emits the text, and the emitted element's text **contains `value-<SLOT>-<k>`** (`demo/path-fork-data.js:565-579`). The identity is the prototype's; the multiplicity is the wire count (4095), so the SAME provider value legitimately appears on all `2^k`-ish path-states of its prototype — **not** on 4094 clones | a path-state element whose text lacks `value-<SLOT>-<k>`; a value keyed per PATH rather than per (prototype, layer, slot) — i.e. `value-A-3` differing between two path-states of the same prototype; a `theme` binding on a prototype (it would win the scalar pick and change the text source — `docs/specs/fork-stress-data.md:319-323` nit (a)) |
| **link** | every **clone** carried `component: { reference: 'link-<layer>', value: linkDefForLevel(layer) }` — the component DEF as the source value; each clone's OWN children (the next layer's clones) were re-typed by the def at emit time, and the **recursive def chain** required the emitter to emit a covered consumer's `defChildren` even when its standalone element is skipped (`docs/specs/fork-stress-data.md:175-182`; `demo/fork-stress-data.js:220-223`) | **The same DEF, on the prototype, realised over path-states.** Every prototype carries `component: { reference: 'link-<k>', value: linkDefForLevel(k) }` (`demo/path-fork-data.js:207-211`). Every path-state is a def **consumer** whose OWN (path-derived) children are re-typed by the def at emit time — the recursive def chain now runs over **path-states** instead of clones. Assertions: the element is a **`div`** (the def's type) for every level-`k ≥ 1` path-state; for `k > 1` its text **contains `link-<k−1>.<slot>`** (the PARENT def's content); the re-typed element carries the **CHILD's OWN** `data-depth`/`stress:layer`, never the def's (`demo/path-fork-data.js:581-620`; the dead-def-css lesson is `docs/specs/fork-stress-data.md:286-297` item 8) | an element whose tag is not `div`; missing def content for `k > 1`; a re-typed element carrying the DEF's layer/depth instead of its own; **the 4095 element census failing because the covered leaves' def-fill phantoms reappear** (pre-gate the runtime link page emitted 8191 = 4095 + 4096 phantoms — `docs/specs/fork-stress-data.md:194-202`, `docs/specs/render.md:224` DFC-1, DEFECT #21) |

**The two mechanism gates the variants depend on (both already landed — do not
re-open them).**

1. **The covered-childless def-fill gate** (`render-helpers.ts`
   `coveredChildless`; `docs/specs/render.md:224` **DFC-1** *covered-CHILDLESS
   gate*): a COVERED childless def-carrying state emits **no** def-fill
   `defChildren`; pre-gate the link variant shipped 4096 never-attached
   phantoms on the runtime page and 8191 elements (`docs/specs/fork-stress-data.md:196-202`).
   The 4095 element census **holds for the link variant ONLY after** this gate —
   so the converted family's K2 element census is a *derived consequence* of a
   landed engine gate, not a page-side convenience.
2. **The adapter-key asymmetry + the derived-bake exemption** (link only): a
   covered re-typed child is stored under the **BARE** pathKey with **no**
   `forkKey`, while standalone path-states use `wireKey(pathKey, pathKey)` — so
   the page's element lookup is **bare-first-then-composite** (`elOfWire`,
   `demo/path-fork-data.js:417-424`), and the element-level derived bake
   assertion is **scoped to standalone-emitted states** (`method === 'link'`
   exemption, `demo/path-fork-data.js:551-559`; the runtime family's twin is
   `demo/fork-stress-data.js:664-670`). The derived page also pins the re-typed
   count: `elements.filter(e => e.forkKey === undefined).length === 2^depth − 1 − 3`
   (`demo/path-fork-data.js:612-618`; 4092 at d12) — the root + all level-1
   states (3) are standalone.

**The per-variant verdict the brief asked for (no hedging).**

| Variant | Data-expressible without an imperative anchor attach? | Evidence |
| --- | --- | --- |
| **placement** | **YES** — and it already is: the shipped static placement page is the reference (`demo/path-fork-data.html`) | the whole `demo/path-fork-data.js:188-191` envelope + the census pin `placement-path-spec.md:655` |
| **values** | **YES** | the values-derived page ships and passes (`docs/specs/derived-fork-variants-review.md:35`, LANDED `:313`; the assertion shape is `demo/path-fork-data.js:565-579`) — *"no core change"* |
| **link** | **YES** | the link-derived page ships and passes **after the landed engine gate** (`docs/specs/derived-fork-variants-review.md:36`, `:102` option (a), LANDED `:313`; the assertion shape is `demo/path-fork-data.js:581-620`). **The gate is already IN** — no further engine change is owed |

⇒ **No engine change is required for any of the three variants**, and **no
imperative anchor attach is required for any of them**: every source/def value
is declared on the prototypes' `component.value` in the envelope (pure JSON),
exactly as `docs/specs/fork-stress-data.md:184-186` already requires (*"ALL
sources are DECLARED IN THE DATA … the page module never attaches an anchor and
stays core-only + legacy data"*). **Therefore this unit carries no gate finding
against §2.2 row 1.** If the implementer's pass discovers otherwise, §2.2 row 1
governs: escalate, do not edit `src/**`.

**Status + source.** **DECIDED** — user ruling 2026-09-22 for the migration;
the three per-variant realisations are landed and smoke-pinned contracts
(`docs/specs/derived-fork-variants-review.md` §5 dispositions 1-3 + `:313`;
`docs/specs/placement-path-spec.md:647-669`).

### K4 — the envelope · **DECIDED (user ruling 2026-09-22; data-authoring rule inherited)**

**Statement.** The family keeps a **legacy envelope** — a `LegacyInitialData`
value carrying the **prototype topology** and the **method selector** — parsed
by `translateLegacy` at runtime. The page module imports **core only**
(`dist/core/*`) **plus the legacy JSON envelope** (embedded as
`preempt-initial-data`) **plus the pure data-derivation helpers** — **no fixture
imports** (`demo-fixtures.js`, `makeRoot`/`makeNode`/`childOf`/
`addComponentSource`/`targetAnchor`). **The DATA must declare every wiring
fact**: the page itself attaches nothing imperatively — no `placement-attach`,
no source/target anchor, no `clone-instance`, no `addLayer` handler body.

**Owning record.** `docs/specs/fork-stress-data.md:27-54` (the envelope
contract: *"NO outside helper functions — the page module imports ONLY
`dist/core/*`"*, *"Legacy data format — the page input is a `LegacyInitialData`
envelope … translated by `translateLegacy`. NOT `serializeSlice` output"*,
*"Two prototypes per layer"*) + `:184-186` (*"ALL sources are DECLARED IN THE
DATA — the envelope carries the values and defs (pure JSON) on the prototypes'
`component.value`; the page module never attaches an anchor and stays core-only
+ legacy data"*) + `:204-214` (the Constraints block) +
`docs/specs/translate.md` §2 (the legacy envelope → graph mapping: legacy input
is `{ template: { root }, content: [...], clientConfig }`); the reference
envelope shape is `demo/path-fork-data.js:163-236`, and the embedded instance is
`demo/fork-stress-data-placement-d12.html:56`.

**The data-authoring rule (AGENTS.md item 10a — stated because §6 risk 2 depends on it).**
> **Any use case that ends up needing an outside script/function is a
> data-authoring mistake — re-express it in data or drop the claim.**

Applied here: if a variant cannot be expressed by the envelope's declared
fields, the **envelope is wrong**, not the page. A page-side anchor attach, a
page-side `addLayer` body, or a page-side computed source value to make a
variant "work" is a **data-authoring failure** and must be reported as such, not
absorbed into the page module.

**Required envelope shape (the contract, per-field).**

| Field | Required content |
| --- | --- |
| `template.root` | the root node (`type: 'app'`, an authored id — the static reference uses `path-root`, `demo/path-fork-data.js:218-221`; the runtime page's is `stress-root`, `demo/fork-stress-data-placement-d12.html:56`) |
| level-1 prototypes | `template.root.children` — TWO nodes (slot `a` = `div`, slot `b` = `span`), **producers only** (`placementName: 'zone-1'`), no consumer side (`demo/path-fork-data.js:166-167`, `:188-191`, `:212-213`) |
| level `k ≥ 2` prototypes | `content[0].content` payload — TWO nodes per layer, **contentNodes-owned**, each carrying `placementName: 'zone-<k>'` (producer) **and** `targetPlacement: ['zone-<k-1>']` (consumer — the level above's SHARED zone name) (`demo/path-fork-data.js:190`, `:212-214`) |
| per-prototype props | `id` (AUTHORED — stable across the builder's and the page's translations, which is what keeps the PAR-5 shape signature comparable, `demo/path-fork-data.js:171-174`), `stress:layer` (the depth), `stress:slot` (`'a'`/`'b'`), `data-depth` (the rendered badge) |
| per-prototype `css` | the flat legacy shape `{ classes, style }` from `levelCss(k, slot)` — **NOT** nested under an extra `style` key (`docs/specs/fork-stress-data.md:269-273` lesson 5) |
| per-prototype `derived` | `stress:expanded` = `{ $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true, else: false } }` — declared on the prototypes AND the root, read from the RESOLVED path-state (`demo/path-fork-data.js:192-202`, `:221-229`; `docs/specs/derived-state.md` §9.2) |
| `component` (values) | `{ reference: 'values-<k>.<slot>', value: 'value-<SLOT>-<k>' }` on every prototype (`demo/path-fork-data.js:203-206`) |
| `component` (link) | `{ reference: 'link-<k>', value: linkDefForLevel(k) }` on every prototype (`demo/path-fork-data.js:207-211`; the def source is `demo/fork-stress-fixture.js:79-90`) |
| `clientConfig` | `{ runInstantiation: false, runMonitoring: true }` (`demo/path-fork-data.js:234`) |
| **MUST NOT appear** | `handlers` (the `stress-expand` declaration), `props['stress:handler']`, any `stress:kind` mechanism label, any `stress:layers` chain expectation, and any handler-body registry on the page (`demo/path-fork-data.js:31-33` — *"the fork-stress-data.js:125-132 shapes, minus the `handlers`/`stress:handler` residue (the derived model has no after-compile expansion)"*) |

**Allowed imports (the exact rule).**

```js
// core-only
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor }      from '../dist/core/supervisor.js'
import { EventBridge }     from '../dist/core/events.js'
import { DomAdapter }      from '../dist/core/adapters.js'
import { emitElements, applyOps, treeFromOps, wireKey } from '../dist/core/render-helpers.js'
import { diffMinimal }     from '../dist/core/render.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner }      from './lib/runner.js'              // page harness, not graph construction
// data-derivation helpers — DEMO-ONLY, pure (layer, slot) → value functions, NOT graph construction
import { levelCss, cssPropForLevel, linkDefForLevel } from './fork-stress-fixture.js'
```
(`demo/path-fork-data.js:55-63` is the reference import block. `createClient`
is **no longer needed** — `demo/fork-stress-data.js:59` imports it only for the
clone kick-off and the handler ops, both of which K1 deletes.)

**What a violation looks like.** A `demo-fixtures.js` import; a page-side
`addAnchor`/`targetAnchor`/`addComponentSource`; a page-side
`clientAPI.apply({kind:'clone-instance'})`; a page-side `addLayer`; a
`component.value`/`placement` field **computed by the page** rather than read
from the envelope; a `handlers` key surviving in the envelope; `createClient`
still imported.

**Status + source.** **DECIDED** — the envelope contract is the landed
`docs/specs/fork-stress-data.md` §Purpose/Constraints (unchanged by this ruling);
what the ruling adds is the **removal** of the handler declaration and the
clone kick-off from the required shape, and the elevation of the static
family's envelope (`demo/path-fork-data.js:163-236`) to the reference.

### K5 — what the family uniquely covers after conversion (and what is LOST) · **DECIDED (user ruling 2026-09-22)**

**Statement.** After conversion the family is **NOT** a duplicate of the static
family. It stays the family whose envelope is **translated at RUNTIME by the
page** and whose census is **asserted at runtime**, whereas the static family's
expectations are computed at BUILD time by its builder. The conversion is
therefore a **mechanism swap, not a deletion** — and the coverage it loses
(handler-driven clone expansion) must be named, not glossed.

**Owning record.** The static family's build-time expectation path:
`demo/path-fork-data.js:308-325` (`pathForkServerData` calls
`buildPathForkSurface` and embeds `expected` + `serverTreeSig`) and
`scripts/path-fork-page.mjs:74-102` (the builder that computes the SSR sample +
the shape signature). The data-driven family's runtime expectation path:
`demo/fork-stress-data.js:246-249` (the page reads `preempt-initial-data` +
`server-data` and TRANSLATES the envelope in the browser) +
`demo/fork-stress-data-page.mjs:36-53` (the builder embeds only the envelope +
depth/method — **no** compiled surface). The retention rationale being retired:
`docs/specs/fork-stress-data.md:3-22` (§"RUNTIME-variant scope note") and
`docs/specs/placement-path-spec.md:625-629` (Q4 — both ship).

**What the converted family uniquely covers (keep these — they are the reason
the family survives).**

| # | Unique coverage | Why the static family does not provide it |
| --- | --- | --- |
| 1 | **Runtime translation of a LEGACY envelope through `translateLegacy`** in the page itself, with the checks run against the translated graph in the browser/shim | the static page also translates at runtime — **but its EXPECTATIONS are pre-computed by its builder and embedded** (`server-data` carries `expected.nodes/states/elements/cloneOps` and `serverTreeSig`). The data-driven family's expectations come from `depth`+`method` alone (`demo/fork-stress-data-page.mjs:37-47`) and are DERIVED in the page (`demo/path-fork-data.js:358-360` is the static twin of the same derivation) |
| 2 | **Per-method data expression asserted at runtime** — the `values`/`link` mechanism checks over the translated graph | the static family asserts the same mechanisms, but as the *derived trio* whose framing is the wire-multiplicity proof. Both stay: the converted family is where the **envelope-data** claim (`component.value` declares the mechanism) is exercised against a page that never pre-computed it |
| 3 | **Runtime census assertions on a page the builder did not measure** — `registered/inTree/unplaced/destroyed/cloneOps/states/elements/passes` read from the live supervisor, plus the **journal-derived clone census** (§3 K6) | the static page also publishes these, and its `server-data` carries a *builder-side* cloneOps expectation. The converted family's value is that its census is a **pure runtime measurement**, which is exactly what the user's second ruling asks to be pinned |
| 4 | **The `fork-stress-census` smoke guard's per-depth sweep** (depths 2..12, `scripts/demo-smoke.mjs:836-886`) — the family that proves the topology at many depths cheaply | the static guard (`static-path-census`, `:1035-1118`) runs the d12 trio only; the derived d14 trio is BUILT-BUT-NOT-SMOKE-RUN (`docs/specs/placement-path-spec.md:649-651`) |

**Coverage LOST, and where it moves (state this honestly — §6 risk 1 depends on it).**

| Lost coverage | Where it goes |
| --- | --- |
| **Handler-driven clone expansion as a PAGE pattern** — the sanctioned `after-compile` `clone-instance` recursion (`demo/fork-stress-data.js:300-361`, `:479-503`), i.e. the "how does a page build a tree from a prototype via the handler op" demonstration | **`docs/specs/ops.md:88` still sanctions it**, and the **engine-side** proof is unchanged and still enforced: `tests/unit/no-clone-invariants.test.ts` **NC-1e** (+ the `P-IM-4` register row) drives **both** handler routes as positive controls — `Supervisor.apply` and `clientAPI.apply` — asserting the spy fires exactly the op count, that each copy is `runtimeMinted === true`, and that `ops.ts`'s dispatcher site is live (`tests/unit/no-clone-invariants.test.ts:747-822`, `:1615-1717`). See §3 **K8** for the sufficiency verdict |
| **The handler body's `children.length`-only idempotency guard** (`demo/fork-stress-data.js:324-331`) | a **handler-body** contract, owned by `docs/specs/derived-state.md` §9.2 + `docs/specs/handlers.md`; the pattern survives in the imperative family and in every handler suite. Not re-homed here |
| **The pass-2 incremental render loop as the family's render contract** (`bootstrap once, then consume takePass2States()`, `demo/fork-stress-data.js:363-417`; the check `PROFILE.renderCount >= 2`) | the incremental contract is owned by the imperative runtime family (`runtime-fork-stress-census`) and by the E2E-2/3/4 cases. The converted family adopts the static family's contract: **ONE bootstrap compile, `passes === 1`** (`scripts/demo-smoke.mjs:1009-1012`) |
| **The `stress:layers` chain + `data-path` display assertions** (`demo/fork-stress-data.js:636-672`) | **⚠ GATE DECISION REQUIRED — see §5 omission 5 + §9 Q-2.** `data-path` is a **derived** prop per path-state (`{ $: 'pathKey' }`) and CAN be carried forward as pure data with no new mechanism; `stress:layers` is build-time derivable but degenerates to a depth marker on a single-method page (every segment is `L<k>:<method>`). **Neither may be silently dropped** — the gate rules, and the ruling is recorded |

**Status + source.** **DECIDED** — user ruling 2026-09-22 (the family survives
as a migration, not a deletion); the coverage census above is read from the
landed pages/pages' builders this pass (`demo/path-fork-data.js:308-325`,
`demo/fork-stress-data-page.mjs:30-55`, `scripts/demo-smoke.mjs:836-886`,
`:1035-1118`).

### K6 — the clone-count pin (the user's second ruling) · **DECIDED (user ruling 2026-09-22)**

**Statement.** The converted family's `cloneOps` is **pinned as an explicit
assertion with the expected value `0`**, and the assertion must **FAIL** if a
**node is minted per path/element** or a **clone reappears** anywhere in the
family's construction. The pinned value must be a **JOURNAL-DERIVED
MEASUREMENT**, never a literal and never an arithmetic identity — otherwise the
pin is unfalsifiable (§6 risk 3 / the enforcement unit's own lesson).

**Owning record.** the user's ruling 2026-09-22 (second half);
`docs/specs/no-clone-invariants.md` §3 **I5** (the measurement rule:
`cloneOps = journalEntries({afterIndex: 0, limit: MAX}).entries.filter(e => e.kind === 'clone-instance').length`,
with the window-completeness guard) + §3 **I1** (a placement attach registers
ZERO nodes) + `docs/specs/placement-path-spec.md:639` (`cloneOps = 0`) +
`docs/decisions.md` **DEFECT #11** (by row name) + `docs/specs/ops.md:88`.

**The assertion shape (name it, state the expected value and the failure message).**

| # | Assertion | Expected value | Where it lives | Failure message (must name the drift) |
| --- | --- | --- | --- | --- |
| **K6-a (the target pin)** | `PROFILE.cloneOps === 0` **at every depth and every method** | `0` | the page's census check (`demo/path-fork-data.js:442-469` is the reference shape: the journal-emptiness check `supervisor.journal.length !== 0` + the measured value) | `clone census: expected 0 (path enumeration mints NO clones — E2E-1), got <n>` |
| **K6-b (the measurement pin)** | `PROFILE.cloneOps === PROFILE.journalCloneOps` — **two independent sources must agree** (the paged whole-journal read vs the separate per-kind walk) | equal | `demo/path-fork-data.js:455-468` (reference; `demo/fork-stress-data.js:736-746` already has the same two-source shape) | `clone census drift: the whole-journal read counted <a> clone-instance ops but the per-kind walk counted <b> — two independent sources must agree (kinds=<kinds>)` |
| **K6-c (the window pin)** | the measurement must **fail loudly** on an incomplete window (`truncated === false` OR `fromIndex === 0 && entries.length === totalEntries`) | complete window | `demo/path-fork-data.js:88-94` (`measuredCloneOps` THROWS) | `clone census: journal window incomplete (fromIndex=… entries=… totalEntries=… truncated=…) — refusing to publish a silently under-counted cloneOps` |
| **K6-d (the harness pin)** | the smoke's per-depth and per-method guards re-derive the expected clone count **from the converted topology** and compare — `0` | `0` | `scripts/demo-smoke.mjs:784-835` (`assertForkStressCensus` — **re-expressed**, §8.2) | `<label> census cloneOps mismatch: cloneOps=<n>, expected 0 (the converted family compiles by path enumeration — E2E-1; a non-zero count means a clone reappeared or a node was minted per path)` |
| **K6-e (the node-growth companion)** | `PROFILE.registered === PROFILE.inTree === 2·depth − 1` and `unplaced === 0` — **the "node minted per path/element" failure mode K6-a cannot see** (a per-path node is not a *clone*) | `2·depth − 1` (23 at d12) | same sites as K6-a/K6-d | `<label> census registered mismatch: registered=<n>, expected <2·depth − 1> (2·(depth−1) prototypes + root — a node minted per path would report 2^depth − 1)` |

**Why K6-e is part of the pin (not an extra).** A per-path node mint is
**precisely** the failure the user's ruling describes ("showing per-element
clones when they should be containing only 23 nodes"), and it produces
`cloneOps = 0` with `registered = 4095` — so a `cloneOps`-only pin would pass
while the ruling was violated. **The pin is the PAIR** (K6-a + K6-e).

**Falsifiability requirement (mandatory).** The pin must be **provably able to
fail**. The TestWriter must construct the counterexample (the §5 `P-IM-3`
anti-vacuity clause): an input/route that **does** mint a clone and must make
K6-a read non-zero. **The sanctioned route exists and is drivable**: apply two
explicit `{kind:'clone-instance'}` ops via `clientAPI.apply` on a translated
envelope (`tests/unit/no-clone-invariants.test.ts:782-795` is the landed,
working shape) and assert the measured census reads **2**, not 0.

**What a violation looks like.** A `cloneOps` literal (`cloneOps: 0` assigned
rather than measured — the pre-fix defect fixed for the derived family by
`docs/specs/no-clone-invariants.md` §3 I5); an arithmetic identity
(`registered − unplaced − 1 − prototypes`, the old tautology at
`docs/specs/no-clone-invariants.md:679`); a truncated window silently
under-counting; an `assertForkStressCensus` still deriving `2^depth − 2`
(`scripts/demo-smoke.mjs:787`) or `2^depth − 1 + prototypes` (`:786`) for this
family; `registered` growing toward `2^depth − 1`.

**Status + source.** **DECIDED** — user ruling 2026-09-22; the measurement rule
and its anti-tautology rationale are the LANDED `docs/specs/no-clone-invariants.md`
§3 I5 (`docs/decisions.md` **NO-CLONE-ENFORCEMENT**, **CLONE-CENSUS-NON-MEASUREMENT**).

### K7 — the no-clone invariants (I1..I5) applied to the converted family, and the RE-DERIVED register relations · **DECIDED (user ruling 2026-09-22)**

**Statement.** The converted family is a **new positive instance** of I1..I5, and
the two register relations in `docs/specs/no-clone-invariants.md` that assert a
**runtime-vs-static DIFFERENCE** must be **re-derived**, because the converted
family is no longer the runtime/clone expression.

**Owning record.** `docs/specs/no-clone-invariants.md` §3 I1..I5, §5
**P-IM-2** / **P-TP-2** (the two rows whose relation depends on the clone count),
§3 I5's "Pre/post per page" table (`:675-679`, whose `demo/fork-stress-data.js`
row reads *"arithmetic identity … expected measured value = the page's
**handler-driven** count (measured `2/14/62/254/510/1022/2046/4094` for depth
2..12) — i.e. **the number legitimately reports non-zero**"*), and
`docs/specs/no-clone-invariants.md` §2.2 row 2 (*"The fork-stress fixture
family's handler-driven cloning … **SANCTIONED** — this IS the handler use
`ops.md:88` reserves the op for"*).

**Per-invariant application.**

| Invariant | How it applies to the converted family | The enforcement that already exists | What changes |
| --- | --- | --- | --- |
| **I1** — a placement attaches the ORIGINAL node, by link; `placement-attach` registers ZERO nodes | **Fully in scope, and now the family's PRIMARY mechanism**: the family's whole tree is placement routing (producer `container` + consumer `content` anchors on the shared per-name Link) | `tests/e2e/path-fork-e2e.test.ts:182-201` (zero node creation across translate→compile→emit→diff→apply) + NC-1a + `P-IM-1` | **nothing** — the family becomes an additional instance |
| **I2** — one node, many paths; the wire carries the multiplicity | **In scope and asserted at the converted census**: 23 nodes → 4095 path-states | `tests/unit/path-enum.test.ts:166-175` (23 nodes + 4095 states), NC-1b, `P-IM-2` | the converted family adds the **per-depth, per-method** instance (§5 `P-IM-2`) |
| **I3** — a component is resolution + seam, never a copy | **In scope for `values`/`link`**: one authored `component.value` per prototype → **one** prototype identity set shared by all path-state consumers | `tests/unit/no-clone-invariants.test.ts` NC-1d(iii) (registry size + def-prototype OBJECT identity set unchanged), `P-IM-3` | the converted `link` variant is a **path-state** def-chain consumer (not a clone consumer) — a NEW construction path for the same invariant (§5 `P-SM-1` covers the smoke pin; the identity assertion itself is NC-1d's, extended by the `link` variant case in §8.1 **FD-7**) |
| **I4** — `clone()` is reachable ONLY from the handler `clone-instance` route | **The converted family must call it ZERO times.** A spy on `Node.prototype.clone` must not fire anywhere in the family's pipeline | NC-1e + `P-IM-4` (ZERO on three non-handler pipelines; exactly `ops` on BOTH handler controls; a zero control reports `UNDETERMINED`) | **the family moves from the "sanctioned user" column to the "must be zero" column** — which is exactly what the user's ruling does |
| **I5** — the clone census is a MEASUREMENT, not a constant | **In scope**: K6 above | NC-1f (`k > 0` positive arm, decoy arm, empty-journal arm), `P-TP-1`, and the production coupling `tests/unit/no-clone-invariants.test.ts:222-293` | **the production-coupling case must be re-pointed**: it currently drives `demo/fork-stress-data-d2.html` and expects `cloneOps === 2^d − 2` (`= 2` at d2) — after conversion the SAME artifact must read `0` (§8.2) |

**The RE-DERIVED register relations (the K7 deliverable).**

**(a) The relation that must be replaced.** `docs/specs/no-clone-invariants.md`
§5 **P-TP-2** (and §8.1 **NC-1g(iv)**) assert:

```
runtimeRegistered − staticRegistered = clones + prototypes − (2d − 2)      ← SUPERSEDED for this family
```

Its terms were all properties of the clone model: `runtimeRegistered =
1 + prototypes + clones` (the runtime family's prototypes were *registered
content nodes* plus one node per clone), `staticRegistered = 2d − 1`, and
`clones = 2^d − 2`. After the conversion the *data-driven* family is a **second
static expression**, so this relation no longer has two sides to compare — it
becomes an identity and therefore **vacuous for the converted family**.

**(b) The replacement relation (ASSERTED form — this is the one the TestWriter implements).**

Define, for a given depth `d`:

```
N(d)   = 2·(d − 1) + 1 = 2d − 1          the structural node count (23 at d12)
S(d)   = 2^d − 1                          the path-state / element count (4095 at d12)
```

Then the converted family and the static (derived) family satisfy, **per depth
`d` and per each of the three methods**:

```
(1)  dataDriven.registered  =  static.registered  =  N(d)          # 23 both sides at d12
(2)  dataDriven.inTree      =  static.inTree      =  N(d)
(3)  dataDriven.states      =  static.states      =  S(d)          # 4095
(4)  dataDriven.elements    =  static.elements    =  S(d)
(5)  dataDriven.cloneOps    =  static.cloneOps    =  0  =  measured journal clone-instance count
(6)  dataDriven.unplaced    =  static.unplaced    =  0
(7)  dataDriven.destroyed   =  static.destroyed   =  0
```

**i.e. the two expressions are EQUAL in every censused field; the
runtime-vs-static DIFFERENCE is `0` in each, and the "relation" degenerates to
the two families agreeing on the topology-derived values.** The
`clones + prototypes − (2d − 2)` correction term is **struck with its left-hand
side** — there is no longer a runtime/clone expression in this comparison.

**(c) What the relation still FALSIFIES (it must not become vacuous).** The
replacement is a genuine assertion, not `x = x`, because its two sides are
**independently derived**: the static side is the **builder-computed** surface
(`demo/path-fork-data.js:308-325` — `pathForkServerData` computes `expected` from
`2 * depth - 1` / `2 ** depth - 1` and embeds it), while the converted family's
side is the **runtime measurement** (`demo/fork-stress-data.js:731-746` reads
`supervisor.allNodes()` and the journal). A per-path node mint moves ONLY the
runtime side (`N(d) → S(d)`), and a reappearing clone moves only `cloneOps`.
**That asymmetry is the whole reason the relation is worth asserting** — and §5
`P-TP-1` / `P-IM-3` make both halves live.

**(d) The residual relation that IS still legitimately a difference — recorded,
NOT asserted here.** `docs/specs/no-clone-invariants.md` §5 **P-TP-2**'s
*runtime* arm still describes the **imperative** runtime family
(`demo/fork-stress.js`) and the **legacy-shape** family; those relations are
untouched by this unit (§2.2 rows 2-3) and are cited as **precedent** for the
re-derivation technique (the `✎ CORRECTED 2026-09-22` calibration row at
`docs/specs/no-clone-invariants.md:1120` — *"the uncorrected form is FALSE for
ALL d ≥ 2"*), not as contracts this unit re-opens.

**Status + source.** **DECIDED** — user ruling 2026-09-22; I1..I5 are the
LANDED `docs/specs/no-clone-invariants.md` §3 (status `LANDED 2026-09-22`,
all seven register rows `HELD`, measured `npm test` 1362/0), and the
re-derivation is required by that spec's own citation rule
(`docs/specs/no-clone-invariants.md:44-58` — a re-ordered/renamed relation is
**re-derived in place**, with the superseded form **annotated, not deleted**).

### K8 — the handler coverage replacement · **DECIDED (user ruling 2026-09-22)**

**Statement.** Removing the family's handler-driven clone expansion costs the
**page-level** demonstration of the sanctioned `clone-instance` route. What
compensates is the **engine-side** control that already exists and is already
green; a **new focused case is owed for the PAGE-level route only in one
respect** (the converted family must be shown to call `clone()` **zero** times,
while the sanctioned route stays drivable from a page-shaped caller).

**Owning record.** `docs/specs/ops.md:88` (**HANDLER-LOGIC ONLY** — the clause
that keeps the op alive for handler logic *and* the clause that forbids the
placement path from using it); `docs/specs/no-clone-invariants.md` §3 **I4**
(*"`clone()` is reachable ONLY from the handler `clone-instance` route"*) and
§8.1 **NC-1e** + §5 **P-IM-4**.

**What the removal costs (the honest census).**

| Lost | Not lost (still covered, with the case that covers it) |
| --- | --- |
| the page-level `clientAPI.apply({kind:'clone-instance'})` **recursion pattern** (`demo/fork-stress-data.js:342-352`, `:479-489`) and its `children.length` guard, chain writes and pass-2 drain | the **`clientAPI.apply` handler route itself**: **NC-1e POSITIVE CONTROL 2** drives exactly that surface — `cClient.apply(cSource.id, {kind:'clone-instance', source: cSource.id, slot: ct2.root, …})`, asserts `status === 'applied'`, the spy fired **exactly 1**, and it is the guard against *"a regression that stops routing a client clone-instance op through the supervisor"* (`tests/unit/no-clone-invariants.test.ts:776-795`) |
| the runtime page's per-depth `appends` count (`demo/fork-stress-data.js` renders 4094 appends; the runtime census guard checks `appends >= 2^depth − 2`, `scripts/demo-smoke.mjs:733-737`) | the **`Supervisor.apply`** route: **NC-1e POSITIVE CONTROL 1** (2 ops, `runtimeMinted === true`, receiver `instanceof Node`) at `tests/unit/no-clone-invariants.test.ts:747-774`; the **`ops.ts` dispatcher** route: **CONTROL 3** at `:797-812` (site 1 of 2 must be live, or the row reports `UNDETERMINED`) |
| the handler-body execution cost measurement (`handlers=4094`, `handlerMs=…`, `pass2Ms=…` on the profile — `demo/fork-stress-data.js:753-763`) | the **`P-IM-4` register row** (its generator drives both handler routes and asserts the control count is `> 0`; a zero control ⇒ `UNDETERMINED`, never `HELD`) — `tests/unit/no-clone-invariants.test.ts:1615-1717` |

**Sufficiency verdict (the brief asks for it explicitly).**

| Question | Verdict |
| --- | --- |
| Is the existing isolated handler-driven `clone-instance` control **sufficient** to cover the removal? | **YES for the route's liveness** — NC-1e's controls + the `P-IM-4` row already assert (i) `clientAPI.apply` reaches a `clone()` call site, (ii) the copy is `runtimeMinted`, (iii) both `src/**` call sites are live, with a **mandatory** positive control so a dead spy reports `UNDETERMINED`. **No coverage of the sanctioned mechanism is lost by this unit.** |
| Is a **new focused case owed**? | **YES — one, and only one: the ZERO-side case for the converted family.** No existing case asserts that a **page-family pipeline that performs path enumeration calls `clone()` zero times**; NC-1e's three non-handler pipelines are (a) placement translate+attach, (b) def-resolution, (c) def-fill emit — they do **not** include a 4095-path enumeration page. That case is §8.1 **FD-5** (`cloneOps`/`clone()`-spy zero over the converted family's own compile), and it is the case the user's ruling is actually about |
| Does the removal need a NEW home for "how a page builds a tree from a prototype"? | **NO new artifact is owed here.** `docs/specs/ops.md:88` remains the owning record, and the imperative runtime family (`demo/fork-stress.js`) remains a shipped page that builds real nodes. **If the gate wants a page-side clone demonstration kept, that is a §9 Q-3 decision — do not invent one in this pass** |

**Status + source.** **DECIDED** — user ruling 2026-09-22; the compensating
coverage is the LANDED `docs/specs/no-clone-invariants.md` NC-1e / `P-IM-4`
(measured `HELD`, seed `20260922`).

---

## 4. The supersession of `docs/specs/fork-stress-data.md`'s scope note

**What is superseded (quoted verbatim — the historical record STAYS).** *The
line ranges below are the PRE-ANNOTATION positions in the annotated file; the
§4 annotation shifted them **+28** (see the citation-convention note above), and
the sections are named so the quotes are locatable either way.*

> `docs/specs/fork-stress-data.md:7-22` — the **"RUNTIME-variant scope note (read
> this first)"** block. Its two load-bearing sentences:
>
> 1. *"this spec describes the RUNTIME fork-stress-data page (the
>    after-compile `clone-instance` expansion), which is **KEPT as-is alongside
>    the new STATIC page**."*
> 2. *"With the translate-global contentNodes-ownership minting (P3 §10.ad/F-13),
>    THIS runtime page's census asserts are re-pinned: in-tree = 2^depth − 1 +
>    prototypes, unplaced = 0 …; **`cloneOps` stays the journaled clone count**."*
>
> Also superseded in substance (not deleted): the Purpose bullets' clone
> description (`:36-47` — *"the handler clones the next layer's prototypes
> (`clone-instance` op) … so the 2^k-per-layer tree grows from the data alone"*),
> the `handlers` declaration in the envelope sample (`:72`), the handler-body
> installation step (`:100-138`), the page's pass-2 render step (`:139-141`), the
> per-method clone descriptions (`:166-182` — *"the clone-instance op inherits
> the anchor WITH its value (Node.clone)"*), and the module header's clone
> design statement (`demo/fork-stress-data.js:48-53`).

**The replacement text (what the landing pass writes into the scope note — the
annotation added by THIS pass is already in place at
`docs/specs/fork-stress-data.md:24-50`; the block below is the fuller replacement
the landing pass folds into the note's own body):**

> **RUNTIME-variant scope note — SUPERSEDED 2026-09-22 (user ruling):** the
> data-driven family is **no longer a runtime clone-assembly variant**. By the
> user's ruling of 2026-09-22 it is **converted to path enumeration** — 23 nodes,
> 4095 wires/elements, `cloneOps = 0` — and `cloneOps = 0` is **pinned as an
> assertion**. The contract now lives in **`docs/specs/fork-stress-data-p3.md`**
> (K1..K8 + the property register). The sentences below that describe the
> family as KEPT alongside the static page, and that re-pin its census to
> `in-tree = 2^depth − 1 + prototypes` with a non-zero journaled `cloneOps`,
> are **SUPERSEDED — they are the record of why the family existed, not its
> contract.** The static re-expression remains the placement-path model:
> `docs/specs/placement-path-spec.md` §5 + `demo/path-fork-data.*`.

**The amendment rule (binding on every later pass).**

1. **ANNOTATION ONLY, nothing deleted.** The superseded sentences stay in place,
   in the historical record, with an explicit supersession marker and a pointer
   to this file — the repo's convention (AGENTS.md item 6; the
   `no-clone-invariants.md` header's *"**that is now SUPERSEDED** (annotated,
   not deleted)"* pattern at `docs/specs/no-clone-invariants.md:3-4`, and the
   `bodyruns-drop-diagnostics.md:25-36` `⛔ STALE ORIGINAL TAIL — superseded …
   kept for provenance — do NOT read either as live` pattern).
2. **One contract, one home.** After the annotation, the **contract** for this
   family's construction model is **this file**. `docs/specs/fork-stress-data.md`
   keeps the historical/mechanism record and may keep the parts the conversion
   does not touch (the lessons list `:225-327`, the builder/smoke wiring notes
   `:215-223`), which the landing pass updates **by annotation**, not by
   silent rewrite.
3. **The `cloneOps` sentence gets no literal.** Neither file may state
   `cloneOps = 4094` as a live expectation again; the value is a **measurement**
   (§3 K6) and the only live expected value for this family is **0**.
4. **A superseded sentence that a test still asserts is a FINDING.** Every
   assertion that encodes the clone model is enumerated in §8.2; the landing
   pass re-points each one in the same pass it converts the page, and a
   surviving assertion is reported, never relaxed.

---

## 5. THE TYPED PROPERTY REGISTER (mandatory — PBT gate deliverable)

**Rules applied** (identical to the sibling registers at
`docs/specs/no-clone-invariants.md:782-802` and
`docs/specs/bodyruns-drop-diagnostics.md:722-740`, so all three are read the
same way): **≤ 8 rows**; kinds restricted to **`P-IM`** (invariant), **`P-SM`**
(state-machine / transition) and **`P-TP`** (transform / round-trip); **no `F-`
rows and no `§6`/`FS-n` numbered items** in the register; each row carries an
id, its kind, the property statement, the **strategy/generator the TestWriter
implements**, the **falsification condition**, the **anti-vacuity clause**, and
the **contract clause(s) it pins**.

**This register is the PBT gate deliverable of THIS spec.** It is distinct from
`docs/specs/no-clone-invariants.md`'s seven-row register: that register owns the
**engine** invariants I1..I5 and the harness's guard reachability; this one owns
the **family-specific** construction/census/cross-expression properties. Where a
row here overlaps an engine row it says so and cross-references it, and the
engine row keeps its own home (AGENTS.md item 6).

**Anti-vacuity is per-row and mandatory** (inherited rule,
`docs/specs/no-clone-invariants.md:794-802`): a row may be reported `HELD` only
when at least one of its falsification clauses was **live** on the run, and
**liveness must be CONSTRUCTED by the generator, never assumed**. A row whose
control cannot be built **throws**; it does not degrade to silence.

| ID | Kind | Property statement | Strategy / generator (TestWriter implements) | Falsification condition (a counterexample looks like) | Anti-vacuity (how the row proves it was LIVE) | Pins |
| --- | --- | --- | --- | --- | --- | --- |
| **P-IM-1** | invariant | **Census invariance: no node growth across `translate → compilePath → emitElements → diffMinimal → applyOps`.** For the converted family's envelope at every generated depth, the registry's **size** and its **object-identity set** are identical at all five stage boundaries, and no node is minted by a compile/emit/diff/apply pass | Seeded generator: build the DATA envelope via the family's own data function for **`d ∈ [3,6]`** (`d ≥ 3` is the nodeRatio-liveness floor — asserted in the anti-vacuity column, never assumed; cheap, because the property is structural, not scale-dependent, and §2.2 row 6 forbids re-pinning other oracles, not generating small inputs), then `translateLegacy` → register → snapshot `allNodes()` (size **and** the object array) → `compilePath` each node (collect `actionable`) → `recordResolved` → `emitElements(actionable, nodeById)` → `diffMinimal(null, els)` → `applyOps` through a counting adapter. Assert at every boundary: `allNodes().length` unchanged **and** `allNodes()[i] === snapshot[i]` for every i (a size-only check misses a same-id re-mint) | `registered` rising at any boundary; an entry replaced by an equal-but-distinct object (the object-identity assertion); a per-path or per-element node appearing as the depth grows (the nodeRatio axis: at d ≥ 3, `states = 2^d − 1` strictly exceeds `nodes = 2d − 1`, so the row is live only where the two axes are separable — **same floor as `no-clone-invariants.md` `P-IM-2`: `d ≥ 3`**); a def-fill synthetic wire (`<host>:<bind>`) registered as a node id | **Constructed liveness:** every attempt must show the nodeRatio **> 1** (assert `states > nodes` on the generated input) — at `d = 2` the ratio is exactly 1 and the row would be vacuous, so the generator **throws** at `d < 3` (the `P-IM-2` floor precedent, `docs/specs/no-clone-invariants.md:806` + `:1117`). Second live clause: emit `els.length > 0` and assert at least one element exists at every depth, so "no growth" cannot be satisfied by "nothing happened" | **K1**, **K2**; `placement-path-spec.md:65` (E2E-1), `:1658` |
| **P-IM-2** | invariant | **One node, many paths — over the CONVERTED family: every path-state's `nodeId` is a translated node id, the distinct-`nodeId` count is `2d − 1`, and the state count is `2^d − 1` with `forkKey === pathKey` on every state and no `#` arm suffix in any `pathKey`** | Seeded generator over `d ∈ [3,6]` (the `d ≥ 3` axis-separation floor, as `P-IM-1`): for each depth, count `new Set(actionable.map(s => s.nodeId)).size === 2 * d - 1`, `actionable.length === 2 ** d - 1`, every `s.nodeId ∈ {translated ids}`, every `s.forkKey === s.pathKey`, no `s.pathKey.includes('#')`, and every path-state's `pathKey` is `'root'` or starts with `'root/'`. **Also assert the multiplicity is on the WIRE (not the node) by pairing the two counts in one assertion** so the two axes cannot collapse to one number | a `nodeId` in a state that is not a registry id; `distinct nodeId` growing with the state count; a state whose `forkKey ≠ pathKey`; an arm suffix leaking into a `pathKey` (the pre-P3 `nodeId#<i>` identity form, `placement-path-spec.md:561-566`) | **Constructed liveness:** the generator asserts `2^d − 1 > 2d − 1` (strict) on every attempt — the exact condition that makes "wires exceed nodes" meaningful (7 > 5 at d=3, growing); at `d = 3` the ratio is 1.4, which the row **prints** in its report line. A second live clause: at least one attempt per row must carry a **link-method** envelope, so the path-state def-chain consumer shape (K3) is exercised on the same node set | **K1**, **K2**, **K3**; `placement-path-spec.md:47`, `:639`, `:640`; `no-clone-invariants.md` §3 I2 (the engine twin — this row is the family instance) |
| **P-IM-3** | invariant | **The clone-count ZERO pin, and it is FALSIFIABLE: the converted family's `cloneOps` is `0` measured from its own journal, AND a clone introduced anywhere in the pipeline makes it non-zero.** Equivalently: the family's clone census equals the count of `clone-instance` entries in `journalEntries()` exactly — `0` on the converted pipeline, `k` on an injected one | Two arms on the SAME generated envelopes: **(a) converted arm** — run the path-enumeration pipeline (as `P-IM-1`), read the journal through `journalEntries({afterIndex:0, limit:1000})`, assert the `clone-instance` count is `0`, the published census reads `0`, the two published sources agree (`cloneOps === journalCloneOps`), and the window was complete (`truncated === false` OR `fromIndex === 0 && entries.length === totalEntries`); **(b) injected-clone arm (the falsifier, MANDATORY)** — on a FRESH translation of the same envelope, apply `k ∈ [1,3]` explicit `{kind:'clone-instance'}` ops via `clientAPI.apply(source, {kind:'clone-instance', source, slot, priority})` and assert the measured census is **exactly `k`**, `===` the journal count, and `!== 0`; **(c) per-path-node arm** — assert `registered === 2d − 1` on the converted arm, which is the failure mode a clone-only pin cannot see (K6-e) | a census reporting `0` while the journal holds a `clone-instance` entry; a **constant** census (the injected arm reads `0` — the falsifier that proves the measurement is real); a truncated window silently under-counting; `registered` reaching `2^d − 1` (a node per path-state) while `cloneOps` stays `0` (the arm-(c) clause — **the exact failure the user's ruling describes**); the two published sources disagreeing | **The injected-clone arm is the liveness proof and is MANDATORY in the same test body, asserted BEFORE the row reports** (the `P-IM-4` rule, `docs/specs/no-clone-invariants.md:808`): a `k ≥ 1` reading is required, and a `0` reading there means the measurement never matched — the row **must report `UNDETERMINED`, never `HELD`**. Second live clause: arm-(c) prints `registered` and `2d − 1` on every attempt | **K6** (a-e); `no-clone-invariants.md` §3 I5 + §5 `P-TP-1` (the engine twin) |
| **P-TP-1** | transform / round-trip | **Static-vs-data-driven CROSS-EXPRESSION equality (the K7 re-derivation, as an executable property): for the same depth and the same method, the converted family's runtime census equals the static derived family's census in EVERY field — `registered = inTree = 2d − 1`, `states = elements = 2^d − 1`, `unplaced = destroyed = cloneOps = 0` — with the two sides INDEPENDENTLY derived** | Two-arm generator over `d ∈ [2,6]` × `method ∈ {placement, values, link}`: **(a) static arm** — the builder-computed expression `pathForkServerData(method, depth).expected` (`demo/path-fork-data.js:308-325`; the values are computed from `2 * depth - 1` / `2 ** depth - 1`, never read from a page) plus the builder's own `buildPathForkSurface` counts; **(b) converted arm** — run the data-driven envelope through the converted runtime pipeline and read the published census object (the supervisor-derived fields + the journal-derived `cloneOps`). Assert field-by-field equality, and assert both sides **separately** derived (the row must not accept a single source published twice — the `x !== x` alias lesson, `docs/specs/no-clone-invariants.md:679`) | the two families disagreeing in any field (the falsified direction: a per-path mint moves ONLY the runtime side to `2^d − 1`); a `cloneOps ≠ 0` on either side; a method whose value/link expression changes the census (a per-path provider or a re-typed-element count leaking into `registered`); a **missing** field on the runtime profile (the row must fail, never skip) | **Constructed liveness:** for every attempt at least one field must be **capable of moving** — the row asserts the two sides come from different derivations (the static `expected` object is constructed from the depth arithmetic, the runtime census from `allNodes()`/`journalEntries()`), and it prints both sides per attempt. Second live clause: the generator must include at least one **values** and one **link** attempt per depth (the link arm is where a def-fill phantom regression would show as `elements ≠ states`, `render.md:224` DFC-1) | **K2**, **K3**, **K7(b)**; `placement-path-spec.md:647-669`; `derived-fork-variants-review.md:35-36` |
| **P-SM-1** | state-machine / transition | **Per-method-variant census equality: at a fixed depth, the three method variants produce IDENTICAL censuses, and each variant's own mechanism assertion is live (so equality is not achieved by all three being empty or degenerate)** | Generator: for `method ∈ {placement, values, link}` at `d ∈ [3,12]` (d12 for the real pages; small depths for the generator), run the SAME pipeline and assert the census objects are **deep-equal** (registered/inTree/unplaced/destroyed/cloneOps/states/elements/passes) **and** that each variant's mechanism observable is live: **placement** — no `component` field on any authored prototype and the R2.2 sibling-shared owner-name topology holds (both level-(k−1) prototypes own the SAME `zone-<k−1>` name; assert `distinct container names per layer === 1`); **values** — every path-state element's text contains `value-<SLOT>-<k>` (so the scalar source is really consumed, not merely declared); **link** — every level-`k ≥ 1` path-state element is a `div`, `k > 1` elements carry `link-<k−1>.<slot>`, and the re-typed (bare-keyed, no-`forkKey`) element count is `2^d − 1 − 3` | one variant's census differing (e.g. the link variant's `elements = 8191` — the pre-gate phantom regression); a variant whose mechanism observable is empty (a placement envelope that silently acquired `component` fields; a values page whose elements carry no value text; a link page whose elements are not `div`); a per-level topology where the two siblings own **different** zone names (the single-chain collapse, K1) | **Constructed liveness:** each variant's mechanism clause is asserted **non-trivially on the same run** — the values arm must find `> 0` elements carrying the expected text, the link arm must find `> 0` re-typed elements (the `2^d − 1 − 3` count is `> 0` only for `d ≥ 3`), the placement arm must find `> 0` prototypes and exactly 1 shared name per layer. A variant that produced nothing cannot satisfy its clause, and the equality assertion alone would not catch it — **that is why the mechanism clauses are part of the row** | **K3**, **K2**; `derived-fork-variants-review.md:180-184` (the equality table), `render.md:224` (DFC-1) |
| **P-SM-2** | state-machine / transition | **The harness pins the CONVERTED family: the per-depth and per-method census guards derive their expectation from the converted topology and go RED on any reappearance of the clone model.** For each depth the guard is driven with (i) a genuinely converted profile and (ii) fabricated profiles carrying the old census values | Harness-level row: extract/drive the guard function the way the reachability suite does (`tests/unit/no-clone-guards.test.ts:336-385` `censusViolations` / the NC-2d extraction of `assertForkStressCensus`) and feed it: **(i)** a profile with `registered = inTree = 2d − 1`, `cloneOps = 0`, `journalCloneOps = 0`, `unplaced = destroyed = 0`, `depth = d` — must **PASS**; **(ii)** `cloneOps = 4094` / `journalCloneOps = 4094` at d12 — must **FAIL**; **(iii)** `registered = inTree = 4117` (the old in-tree expression) — must **FAIL**; **(iv)** a profile **omitting** `cloneOps` or `journalCloneOps` — must **FAIL loudly** (never silently pass on a missing field); **(v)** the runtime-family profile (a legitimate `cloneOps = 4094`) fed to the CONVERTED family's expectation — must **FAIL** (the two families' expectations are not interchangeable) | a fabricated old-model profile the guard **accepts** (the guard still encodes `2^depth − 2` / `2^depth − 1 + prototypes`); a profile with a missing field silently passing (the "baseline absent ⇒ pass" defect class, `scripts/demo-smoke.mjs:936-939` precedent); a guard that cannot be driven in isolation (its source depends on harness state — the NC-2d extraction constraint, `scripts/demo-smoke.mjs:777-783`) | **Constructed liveness:** the row is `HELD` only if at least one FABRICATED profile is **rejected with its message recorded** in the same run — the negative arms are the liveness proof, and an all-accepting guard reports `UNDETERMINED`. Second live clause: the passing arm (i) must carry a **non-empty** census object and a `depth` token, so "pass" is not achieved by an empty profile | **K2**, **K6d**; `no-clone-invariants.md` §4 (the guard-reachability contract) + §8.2 NC-2d `:1012` |

**Register count:** **six rows** (three `P-IM`, three `P-SM`) — inside the
≤ 8-row budget. **Expected statuses on the CURRENT (pre-conversion) code:**

| Row | Expected status today | Why |
| --- | --- | --- |
| `P-IM-1` | **EXPECTED-RED** — **except** its STATIC-envelope arm, which is expected **GREEN** today | the converted family's pipeline does not exist yet, so the row's data-driven arm fails (today the family's registry grows by 4094 clones and holds 4117 nodes). The TestWriter must run **both arms** (static envelope + data-driven envelope) and report **both** statuses, never fold them into one — the static arm is the row's built-in control, and reporting only the red would hide that the property is already satisfiable |
| `P-IM-2` | **EXPECTED-RED** — **except** its STATIC-envelope arm, expected **GREEN** today | same reason (the pre-conversion data-driven family's `distinct nodeId` is 4095, not 23) |
| `P-IM-3` | **EXPECTED-RED** | the arm-(a) clause (census `0`) fails today: the family's journal holds 4094 `clone-instance` entries and `registered` is 4117. **Arm (b) (the injected clone) is GREEN today and must STAY green** — it is the row's liveness proof and is the half that already works |
| `P-TP-1` | **EXPECTED-RED** | the two arms disagree in every censused field today (data-driven 4117 / `cloneOps` 4094 vs static 23 / 0) |
| `P-SM-1` | **EXPECTED-RED** | the three method variants agree *with each other* today (all cloned), but their **mechanism clauses are evaluated over path-states, which do not exist pre-conversion** — so the row cannot be reported `HELD` (its liveness clauses cannot be built) even though the census-equality half happens to hold. **A row that cannot construct its liveness clause reports `UNDETERMINED`, never `HELD`** |
| `P-SM-2` | **EXPECTED-RED** | the guard still encodes `2^depth − 2` (`scripts/demo-smoke.mjs:787`) and `2^depth − 1 + prototypes` (`:786`), so the fabricated old-model profiles of arms **(ii)/(iii) are ACCEPTED today** — the row's negative arms cannot be built until the guard is re-expressed |

**This is the intended red set — do NOT weaken a row to reach `HELD`.** The
conversion turns **all six** rows `HELD` **by changing the page**, which is the
TDD direction this unit's gate requires. Two rows carry an arm that is green
*before* the conversion (`P-IM-1`/`P-IM-2`'s static arms; `P-IM-3`'s injected-clone
arm) and **those arms must still be green after it** — the conversion must not
move what already holds.

**Omissions (required one-line note per candidate row judged over-strength or
already owned):**

1. **No row asserts the exact d12 literals `23` / `4095` as constants.** The
   register asserts them **through `2d − 1` / `2^d − 1`** so the same rows hold
   for the d14 probes; a literal-`23` row would forbid a depth-parameterized
   family (the same reasoning as `docs/specs/no-clone-invariants.md`'s omission
   note 1 `:816-823`). The literals **are** pinned — as the acceptance
   checklist's oracles (§7) and the smoke guards (§8.2).
2. **No row asserts the `stress:expanded` derived bake.** Already owned by
   `docs/specs/derived-state.md` §9.2 + the derived family's page check; a second
   home duplicates a contract (AGENTS.md item 6). Covered incidentally: `P-SM-1`'s
   values/link mechanism clauses read the same emitted elements.
3. **No row asserts the def-fill synthetic-wire round-trip as its own property.**
   Owned by `docs/specs/no-clone-invariants.md` §5 `P-IM-3(iv)` and
   `render.md:224` DFC-1; `P-TP-1` and `P-SM-1` assert only the **element count**
   consequence (`elements = 2^d − 1`, the 4092 re-typed count) that the phantom
   regression would break. **Merged, not omitted.**
4. **No row asserts the page's PAR-5 shape-signature parity or the SSR sample.**
   That is the static family's `parity` contract (`demo/path-fork-data.js:642-655`)
   and `docs/specs/adapters.md` §PAR-*; this unit's concern is the construction
   model and its census. If the converted page keeps PAR-5, it is asserted by the
   **page's own runner check** (§7 checklist), not by a register row.
5. **No row asserts `data-path` / `stress:layers` display coverage.** These are
   the two **gate-decision** items of §3 K5 / §9 **Q-2**: their carry-forward is
   undecided, and a register row would pre-empt the ruling. **Omitted deliberately** —
   the gate decides, then (if carried) the assertion is a page check per §7.

---

## 6. Risks / costs

| # | Risk | Why it is real | Mitigation in this contract |
| --- | --- | --- | --- |
| 1 | **The conversion silently drops a covered mechanism** — the family becomes a second static page and the pattern it uniquely demonstrated is gone without anyone noticing | This is the **documented failure mode** of this repo's migrations: the `no-clone` rule survived six weeks in *one spec bullet + two code comments + one decision row* and appeared on **no gate's must-not-break list** (`docs/pending.md` row **R1**; `archive/reviews/2026-09-22/2026-09-22-noclone-history.md:333-338`). A "convert the page" unit is exactly the shape where a mechanism disappears quietly | **§3 K5 enumerates the lost coverage and its new home, as a contract** — four lost items, each with a named compensation; **§3 K8 gives the sufficiency verdict** and names the ONE new case owed; **§8.2 enumerates every assertion encoding the clone model**, so an assertion cannot be "forgotten" without failing a named guard. **§9 Q-2/Q-3** put the two undecided carry-forward items in front of the gate instead of letting them evaporate |
| 2 | **The `values`/`link` variants cannot be expressed in data without imperatively attaching anchors** — the page grows an anchor attach to make a variant "work" | This is the **AGENTS.md item 10a** failure class: *"Any use case that ends up needing an outside script/function is a data-authoring mistake — re-express in data or drop the claim."* The temptation is concrete: the link variant's def chain needs the def as a SOURCE value, and the easiest wrong fix is a page-side `addComponentSource` | **The rule is stated in §3 K4** (data declares everything; the page attaches nothing), with the forbidden-import list and the allowed-import block. **§3 K3 records the per-variant verdict: all three ARE data-expressible** (the values and link derived pages ship and pass — `derived-fork-variants-review.md:35-36`, LANDED `:313`), so no exemption is needed. **A page-side anchor attach is a SPEC VIOLATION (K4), not a workaround** — the implementer must report it as a data-authoring failure |
| 3 | **The census assertions become TAUTOLOGICAL** — `cloneOps: 0` pasted as a literal, or derived from an arithmetic identity, reports a number that carries no evidence | This is the enforcement unit's **own audit finding**, twice over: the identity `PROFILE.cloneOps = PROFILE.registered - PROFILE.unplaced - 1 - prototypes.length` (`docs/specs/no-clone-invariants.md:679`) and the harness guard comparing that expression against itself (`:683-686` — *"the guard is a **tautology** … can only fail on a floating-point or typo-level mistake"*); and the page-side alias `PROFILE.journalCloneOps = PROFILE.cloneOps` which made the smoke's comparison `x !== x` (`demo/fork-stress-data.js:708-710`). A converted family that pins `0` by assignment would reproduce the defect the enforcement unit just removed | **§3 K6 is written as a measurement contract**: the count must come from the **JOURNAL/registry** (`journalEntries`), never from an arithmetic identity; **two independent sources must agree** (K6-b); the window must be proven complete (K6-c); **the falsifiability requirement is mandatory** (an injected clone must read `k`, not `0`). **§5 `P-IM-3`'s injected-clone arm and `P-TP-1`'s independent-derivation clause are the register-level enforcement**, and `P-SM-2`'s fabricated old-model profiles are the harness-level one. **§8.2 lists the tautology sites to remove** |
| 4 | **The re-pinned guards are mistaken for a weakening of the enforcement** (a reviewer sees `4094 → 0` and `4117 → 23` and reads it as relaxed) | The conversion **moves** the pin; the `fork-stress-census` guard's bound was never the count itself but the family's **own topology derivation** (`scripts/demo-smoke.mjs:767-775` explicitly: *"The BOUND is untouched: the count is still derived, never a new literal pin"*) | **§8.2 states, per guard, that the re-derivation is the topology's, not the bound's**, and that **no bound anywhere else moves**. **§2.2 rows 5-6 forbid** re-baselining the 3× tripwire / the 2.5× family pins and forbid re-pinning any other oracle. The reachability contract (`no-clone-invariants.md` §4) still applies: a newly failing guard is a **finding**, never a reason to relax |
| 5 | **Cost** | One page module + its template + its builder + the smoke guard re-expression + the unit-test re-points + the new cases | Bounded and page/test-side only: **no `src/**` change, no adapter change, no public-surface change, no version bump** (§2.2 row 1 — the `no-clone-invariants.md` §1 precedent: a harness/page measurement change changes what a guard *reads*, not what the engine does). Files touched: `demo/fork-stress-data.js`, `demo/fork-stress-data.template.html`, `scripts/fork-stress-data-page.mjs`, `scripts/demo-smoke.mjs`, `tests/unit/fork-stress-data.test.ts`, `tests/unit/no-clone-guards.test.ts`, `tests/unit/no-clone-invariants.test.ts`, `tests/e2e/path-fork-e2e.test.ts` + the new suite. **The profile totals should IMPROVE** (no pass-2, no 4094 handler executions) — a regression in the converted family's totals is itself a finding |
| 6 | **A silent behaviour change in the family's checks** (assertions dropped while the census is re-pinned) | The family's 12 runner checks include several that only make sense in the clone model (`stress:kind` per mechanism, the `stress:layers` chain, the derived `data-path`, the handler idempotency, the incremental-render contract) — dropping them without a record is the same class as risk 1 | **§7's acceptance checklist names every check's disposition** (kept as-is / re-expressed / dropped-with-record / gate-decision), and **§9 Q-2** isolates the two gate decisions. A check dropped without a recorded decision is a **finding against this spec** |

---

## 7. Falsifiable acceptance checklist

A **blind agent** can verify every row below **without reading the implementation**
(the oracle is a file:line, a row name, or a page/profile token).

| # | Check | Oracle (file:line / row id / token) | Pass condition |
| --- | --- | --- | --- |
| AC-1 | The user's ruling is recorded verbatim and the supersession is annotated (not deleted) | this file §0; `docs/specs/fork-stress-data.md` §"RUNTIME-variant scope note" **contains a supersession marker naming this file** | both present; the old note's text still present |
| AC-2 | The family's envelope contains no handler declaration and no `stress:handler`/`stress:kind` residue | the built page's `preempt-initial-data` script (`demo/fork-stress-data-placement-d12.html:56`) | `grep handlers` → **0** matches; `grep stress:handler` → **0** |
| AC-3 | The page module attaches nothing imperatively | `demo/fork-stress-data.js` imports | no `demo-fixtures` import; no `addAnchor`/`targetAnchor`/`addComponentSource` call; no `addLayer` call; no `clone-instance` string in the module |
| AC-4 | The d12 census is the static family's expression | `[fork-stress-data:profile]` line on a smoke run: `registered=23 inTree=23 unplaced=0 destroyed=0 cloneOps=0` | all five tokens exact |
| AC-5 | States/elements are wire multiplicity over 23 nodes | the page's census + state/element checks; `2^12 − 1 = 4095` on the profile (`states=4095 elements=4095`) | exact |
| AC-6 | `passes = 1` (ONE enumeration bootstrap) and no pass-2 region | the converted profile line carries no `pass2Ms`/`handlerMs`/`handlers=` fields; `PROFILE.passes === 1` (`scripts/demo-smoke.mjs:1009-1012` is the static family's pin) | exact |
| AC-7 | The clone census is a MEASUREMENT with two independent sources | the converted page publishes `cloneOps`, `journalCloneOps`, `cloneOpKinds`, `journal` (the `demo/path-fork-data.js:681-689` line shape) | all four tokens present; `cloneOps === journalCloneOps` |
| AC-8 | The harness guard is re-expressed, not relaxed | `scripts/demo-smoke.mjs` `assertForkStressCensus` | its topology derivation for THIS family is `2·depth − 1` / `0` — **no `2 ** depth - 2` and no `+ prototypes` remains as this family's expectation**; the 3×/2.5×/residual bounds are byte-unchanged |
| AC-9 | Every clone-model assertion is re-pointed | the §8.2 list (8 rows) | each named site shows the converted expectation; **none silently deleted** |
| AC-10 | The six EXPECTED-RED register rows reach `HELD` **by the conversion**, not by weakening | the §5 status table + the executed row reports | all six rows `HELD` after the pass; each row's report line carries `attempts`/`liveness`; no falsification clause removed; the arms already green before the conversion (the static arms of `P-IM-1`/`P-IM-2`, the injected-clone arm of `P-IM-3`) are **still** green |
| AC-11 | The family is not a duplicate of the static family | §3 K5's four unique-coverage rows exist as live checks (runtime translation of the envelope **without a builder-computed expected surface**; per-method runtime assertions; runtime census; the per-depth sweep) | the converted page's `server-data` carries **no** `serverTreeSig`-equivalent compiled expectation for the census — only `depth`/`method`(+labels), so the census expectations are derived in the page |
| AC-12 | The per-method variants are data-declared | the three built pages' `preempt-initial-data` for `method ∈ {values, link}` | each prototype carries the method's `component` field with a `reference` + `value`; **no page-side anchor attach** |
| AC-13 | The validation trio is green (or RED only at the pre-existing user-ruled tripwire) | `npm test` / `npm run typecheck` / `npm run build` / `npm run demo:smoke` | test/typecheck/build green; the smoke RED **only** at `runtime-fork-tripwire` (`docs/decisions.md` **RUNTIME-FORK-TRIPWIRE-BOUND**) — the converted family's own guards must PASS · **⚠ SUPERSEDED-IN-PART 2026-09-23 (annotation, not a rewrite): the tripwire RED clause is MOOT — the user's guard ruling RETIRED that assertion and replaced it with the runtime-vs-runtime GROWTH GUARD (`docs/decisions.md` RUNTIME-FORK-GROWTH-GUARD), so the smoke is expected GREEN; the FAMILY's own guards must still PASS (they do — the converted family's pins are unchanged). The test-side re-point owed is filed as `docs/defects.md` FORK-STRESS-TRIPWIRE-STALE-SPEC** |
| AC-14 | No `src/**` file changed | the landing pass's diff | **zero** `src/**` paths. A `src/**` change is a **gate finding** (§2.2 row 1) |
| AC-15 | The lost coverage is recorded, not glossed | §3 K5's lost-coverage table + K8's sufficiency verdict | present and consistent with the landed NC-1e/`P-IM-4` controls |

**Page-runner check dispositions (AC-6's detail — every one of the family's
current checks, with its target state).**

| Current check (`demo/fork-stress-data.js`) | Disposition |
| --- | --- |
| `:509-520` layer counts (`2^k clones + 2 prototypes`; total `2^depth − 1 + prototypes`) | **RE-EXPRESSED** → the static census check (`demo/path-fork-data.js:442-469`): `registered = inTree = 2·depth − 1`, `unplaced = 0`, `destroyed = 0`, journal empty + measured `cloneOps` |
| `:522-532` prototypes contentNodes-owned + `unplaced = 0` | **KEPT** (the `contentNodes` parent-anchor assertion is topology-specific and still true; the `unplaced` half moves into the census check with the rest) |
| `:534-559` css property/slot pairs | **KEPT verbatim** (`demo/path-fork-data.js:515-540` is the same check; the static family's version reads the DOM the same way) |
| `:561-577` `stress:kind` per mechanism | **DROPPED-WITH-RECORD** — the mechanism label is a clone-era per-node prop; the mechanism is now identified by `server-data.method` + the per-variant checks. (*This drop is recorded here; it is not a §9 gate question because the label has no path-model meaning: every path-state of a single-method page has the same mechanism.*) |
| `:579-592` values-only text | **RE-EXPRESSED** over path-states (`demo/path-fork-data.js:565-579`) |
| `:594-611` link-only div + def content | **RE-EXPRESSED** over path-states (`demo/path-fork-data.js:581-620`), **plus** the re-typed-count pin (`elements.filter(forkKey === undefined) === 2^depth − 1 − 3`) and the bare-keyed lookup (`elOfWire`) |
| `:613-634` DOM nesting vs graph children | **RE-EXPRESSED** — the static family's twin is `treeFromOps` binary-shape reconstruction (`demo/path-fork-data.js:623-640`); the clone page's DOM-vs-graph walk assumed clone children. *A converted variant of the DOM walk is permitted if it is asserted over path-state wires; it is not required* |
| `:636-649` `stress:layers` chain | **DROPPED-WITH-RECORD** on a single-method page (every segment is `L<k>:<method>`; the chain degenerates to a depth marker) — **the gate may rule to keep it** (§9 **Q-2**); either way the decision is recorded |
| `:651-672` derived `data-path` (state bake + DOM attr) | **GATE DECISION (recommended carry-forward)** — `data-path = { $: 'pathKey' }` is pure derived data with no new mechanism and per-path-state meaning. §9 **Q-2** |
| `:674-690` idempotent expansion (`2 children per non-leaf`, resolved `stress:expanded`) | **SPLIT**: the `stress:expanded` half is **KEPT** (re-expressed over path-states, `demo/path-fork-data.js:543-561`); the `children.length === 2` clone-structure half is **covered by** `treeFromOps`' binary-shape check |
| `:692-695` incremental render contract (`compileCalls === 1`, `renderCount >= 2`) | **RE-EXPRESSED** → the static contract: `passes === 1`, ONE bootstrap render (`scripts/demo-smoke.mjs:1009-1012`) |
| `:699-746` the census publication + the two-source agreement | **KEPT** (the shape is already the §3 I5 shape) with the values now `23/23/0/0/0` |

---

## 8. Test contracts

**No implementation change may be made in this pass** (AGENTS.md item 8a: red
first). The TestWriter owns the test files; the page/builder/harness owner owns
`demo/**` + `scripts/**`. **The expected statuses are RED-today / GREEN-after**
unless a row says otherwise — the conversion is the implementation that turns
them green.

### 8.1 Unit **FD** — the converted family's contract suite (`tests/unit/fork-stress-data-p3.test.ts`, NEW)

Harness: the core barrel (`dist/core/*`, the repo's existing test import
pattern), `translateLegacy`, `Supervisor`/`createClient`, `emitElements`,
`diffMinimal`, `applyOps`, `allNodes()`, `journalEntries()`, a counting adapter,
`vi.spyOn`, plus the family's data function and the static family's builder-side
export (`pathForkServerData`) for the cross-expression rows.

| Case | Input shape | Exact observable | Expected status today |
| --- | --- | --- | --- |
| **FD-1 — K1/K2 census at d12** | the family's data envelope for `depth = 12`, each method | `registered === 23`, `inTree === 23`, `unplaced === 0`, `destroyed === 0`, `states === 4095`, `elements === 4095`, `passes === 1`; the registry's object-identity set identical across `translate → compilePath → emitElements → diffMinimal → applyOps` | **RED** (today: `registered = 4117`, `states = elements = 4095`, `passes > 1`, pass-2 renders) |
| **FD-2 — K2 generalisation** | `d ∈ {2,4,6,12}` per method | `states = elements = 2^d − 1`; `registered = inTree = 2d − 1` (3/7/11/23) | **RED** (today `registered = 2^d − 1 + 2(d−1) + clones`) |
| **FD-3 — K2/K1 R2.2 topology** | the envelope at `d = 4` | for every layer `k ∈ [1, 3]`: exactly **two** prototypes own the name `zone-<k>` (one shared name, two containers); level-`k ≥ 2` prototypes request exactly `['zone-<k−1>']` in `targetPlacement`; level-1 prototypes carry **no** `targetPlacement` | **RED** (today's envelope has no `placement` field at all) |
| **FD-4 — K3 values, path-state expression** | the `values` method at `d = 4` | every non-root path-state element's text contains `value-<SLOT>-<layer>` with `layer = byNode.get(s.nodeId).props['stress:layer']` and `slot = byNode.get(s.nodeId).props['stress:slot']` (so the expectation is read from the PROTOTYPE the state points at); **the same `value-A-<layer>` text appears on every path-state of that prototype** (one provider, N wires) — the per-path-instead-of-per-prototype falsifier | **RED** (today the checks are per-NODE, not per path-state) |
| **FD-5 — K3 link, path-state def chain + ZERO clones (the K8 owed case)** | the `link` method at `d = 4`, **plus** a `vi.spyOn(Node.prototype, 'clone')` installed over the whole pipeline | (i) every level-`k ≥ 1` path-state element is a `div`; (ii) `k > 1` elements carry def content `link-<k−1>.<slot>`; (iii) re-typed elements (no `forkKey`, bare-wire key) carry the **CHILD's** `data-depth`/`stress:layer`; (iv) the re-typed count `=== 2^d − 1 − 3`; (v) `elements === 2^d − 1` (the DFC-1 covered-childless gate holds — a phantom regression reads `8191` at d12); (vi) **the clone spy fired ZERO times across the whole pipeline**, with the mandatory positive control in the SAME test body (2 explicit `clientAPI.apply({kind:'clone-instance'})` ops → spy fires exactly 2, each copy `runtimeMinted === true`; a control count of **0 ⇒ `UNDETERMINED`, never `HELD`** — the NC-1e rule, `tests/unit/no-clone-invariants.test.ts:817-822`) | **RED** (today the family clones 4094 times; the def chain runs over clones) |
| **FD-6 — K6 the pin + falsifiability** | (a) the converted pipeline (each method, `d ∈ {2,4,12}`); (b) the same envelope **plus** `k = 2` injected `clone-instance` ops; (c) the two-source agreement + window completeness | (a) measured `cloneOps === 0`, `journalCloneOps === 0`, journal's `clone-instance` count `=== 0`, `cloneOpKinds` published, window complete; (b) measured `cloneOps === 2 ===` journal count, `!== 0`; (c) `cloneOps === journalCloneOps` on every measurement, and an incomplete window **throws** rather than publishing | **RED** (today (a) reads 4094/4094/8189 journal entries) |
| **FD-7 — K7(a) re-derived cross-expression equality** | `d ∈ {2,4,6,12}` × `method ∈ {placement, values, link}`, two arms (static builder-derived `expected`; converted runtime census) | the seven field equalities of K7(b) hold, with both sides independently derived; plus the **link-variant I3 instance**: one authored def value per prototype → the def-prototype **object-identity set** is unchanged across the pass and all path-state consumers' seam edges target the **same** def-root object (`===`) | **RED** (today the sides differ by 4094 + 4094) |
| **FD-8 — K5 the family is not a duplicate** | the converted page's `server-data` for each method/depth | the embedded `server-data` carries **no** compiled census expectation (`expected.nodes/states/elements/cloneOps` / `serverTreeSig` must NOT be present as builder-computed values for this family — the page derives them); it carries `depth`, `method` and the label lists only | **RED** if the conversion simply embeds the static family's `server-data`; **GREEN** once the page derives its own expectations. *(An implementer who converts by copying `demo/path-fork-data.js` wholesale must fail this case — the family would then be redundant, §3 K5.)* |

**Register-row report cases (the §5 execution contract, inherited verbatim from
`docs/specs/no-clone-invariants.md` §8.4 `:1026-1048`):** one pinned seed printed
in the report; **≤ 100 attempts per row, ≤ 400 total**; stop after 5 failures per
row; inline seeded PRNG (no new dependency); statuses exactly `HELD` / `BROKEN` /
`EXPECTED-RED` / `UNDETERMINED`; the report line emitted **before** the
assertion; `HELD` **requires at least one live falsification clause**; each test
name states the status its line reports.

### 8.2 The smoke and page assertions that encode the clone model (must change)

**Every guard id named here is in `KNOWN_GUARD_IDS`** (`scripts/demo-smoke.mjs:278-305`).
`tests/unit/no-clone-guards.test.ts` has `REQUIRED_GUARD_IDS` (used at `:318-320`)
and the audit's `PP_SMOKE_FAULT` demonstration targets `fork-stress-census`
(`:214-215`, `:842-851`) — **the guard id must therefore keep working with the
same id**; only its expectations change. **No bound listed here is a guard bound**
— they are the family's own topology expectations.

| # | Site | What it encodes today | Required after the conversion |
| --- | --- | --- | --- |
| 1 | `scripts/demo-smoke.mjs:784-835` **`assertForkStressCensus`** | `prototypes = 2 * (depth - 1)` (`:785`); `expectedInTree = 2 ** depth - 1 + prototypes` (`:786`, asserted at `:794-797`); `topologyCloneOps = 2 ** depth - 2` (`:787`, asserted at `:814-817` as the journal-source agreement and at `:826-829` as the pin); `registered === inTree + unplaced + destroyed` (`:830-833`) | for the **converted** family: `expectedInTree = expectedRegistered = 2·depth − 1`; `topologyCloneOps = 0`; the `registered === inTree + unplaced + destroyed` identity **kept** (it is true either way); the `journalCloneOps` **required** (not optional) with its "absent ⇒ fall back to the harness topology" branch (`:818-824`) re-expressed so a **missing** measurement token is a **failure**, not a printed fallback (the "baseline absent must FAIL" rule, `:936-939`) |
| 2 | `scripts/demo-smoke.mjs:836-886` guard **`fork-stress-census`** | runs `fork-stress-data-d{2,4,6,8,9,10,11,12}.html` through `assertForkStressCensus` per depth (`:855`, `:882`) | **same guard id, same page set, re-derived expectations** (via row 1). **Depths must stay 2..12** — the per-depth sweep is part of what the family uniquely covers (§3 K5 row 4) |
| 3 | `scripts/demo-smoke.mjs:894-957` guard **`fork-stress-variant-census`** | the d12 `d12Totals` map + `assertForkStressCensus` per method (`:909`, `:920`) + the **2.5× totals ratio pin** (`:926-955`) | expectations re-derived (row 1). **The 2.5× totals bound is NOT a clone-model quantity and must not move** (it is the family's own pipeline-blow-up guard; §6 risk 4). The `[fork-stress-data:variant-totals]` line (`:954`) stays |
| 4 | `scripts/demo-smoke.mjs:753-763` profile-line **content** | the *guard* reads only the five census fields (`:788`) plus the optional `journalCloneOps` token (`:809`) — but the **line** also carries the clone-model-only fields `pass2=`, `handlerMs=`, `handlers=`, `flush=`, `work:` (`demo/fork-stress-data.js:753-763`; the static family's line has none of them, `demo/path-fork-data.js:681-689`) | the converted line must publish `registered/inTree/unplaced/destroyed/cloneOps/journalCloneOps/cloneOpKinds/journal` + `depth` + `method`; `pass2=`/`handlerMs=`/`handlers=`/`flush=`/`work:` **disappear with the mechanism**, and **no consumer may still require them** (§9 **Q-5** is the sweep that proves that) |
| 5 | `tests/unit/no-clone-guards.test.ts:329-385` **`censusViolations`** (NC-2c/T7) | `runtimeFamily = censuses.filter(c => c.page === 'fork-stress-data')` → requires `cloneOps > 0` (`:359-362`), requires a published measurement token (`:365-369`), and derives `expected = 2 ** c.depth - 2` (`:376-379`) | the `fork-stress-data` family moves to the **`cloneOps === 0`** expectation (**the K6 pin as a test-level assertion**); `expected = 0` for the converted family; the depth-token and measurement-token requirements **stay** (they are the anti-tautology clauses); the `inTree` sanity clause `cloneOps <= inTree` (`:381-382`) stays |
| 6 | `tests/unit/no-clone-guards.test.ts:714-800` the fabricated-profile fixtures | `'[fork-stress-data:profile] depth=12 method=cycle nodes=4095 census(registered=4117 inTree=4117 unplaced=0 destroyed=0 cloneOps=4094)'` (`:718`) and the `cloneOps=4094/4093/0` arms (`:767-785`), plus the synthetic line builder `registered=${n + 3} … cloneOps=${n}` (`:797`) | the fixtures become the **converted** shape (`registered=23 inTree=23 … cloneOps=0 journalCloneOps=0 journal=…`); the **drift arms stay** (a `cloneOps ≠ journalCloneOps` profile must still fail), and the `expected = 2^depth − 2` derivation is replaced by `0` |
| 7 | `tests/unit/no-clone-invariants.test.ts:222-293` **the production-census coupling** (T7) | `PROD_PAGE = 'demo/fork-stress-data-d2.html'` (`:224`); `expectedCloneOps(depth) = 2 ** depth - 2` (`:239-241`, used at `:285-292`) → at d2 expects **2** | **the SAME production artifact** must now read `cloneOps === 0` at every depth (the coupling's *point* — the real page's published field against an independently derived count — is preserved; only the derived count changes). **Keep the d2 page** (the coupling is about the census FIELD, not scale, `:222-223`) |
| 8 | `tests/e2e/path-fork-e2e.test.ts:578-592` the **runtime re-pin** | `prototypes === 22`, `inTree = states + prototypes` (= 4117), `cloneOps = inTree - 1 - prototypes` (`:588`) `expect(cloneOps).toBe(4094)` (`:589`) — **the arithmetic identity at test level** | re-expressed to the converted family's expectation (`2·depth − 1` / `0`), **without** re-introducing an identity in place of a measurement. *(This case is the one the no-clone RCA named as repeating the identity at test level — `docs/specs/no-clone-invariants.md:692-695`; the conversion gives the chance to assert the real census instead)* |
| 9 | `tests/unit/fork-stress-data.test.ts` (the envelope suite, 4 cases) | asserts `handlers: [{name:'stress-expand', phase:'after-compile'}]` (`:13`), the per-prototype `stress:kind` labels (`:11`, `:22`, `:31`), the `values`/`link` `component` shapes (`:23`, `:32-38`), and the four-mechanism cycle default (`:42-47`) | the `handlers` assertion **inverts**: the envelope must carry **no** `handlers`; the `stress:kind` label assertions **invert** into **placement-topology** assertions (FD-3); the `component` shape assertions **stay** (they are the K3/K4 payload contract); the cycle-labels case is **dropped-with-record** (§7 dispositions) |
| 10 | `demo/fork-stress-data.js` **page checks** | the 12 checks enumerated in §7's disposition table | re-expressed / kept / dropped-with-record per that table — **no check silently deleted**, and the gate owns the two §9 Q-2 items |

### 8.3 Landing-pass documentation duty

The landing pass additionally:
1. rewrites `docs/specs/fork-stress-data.md`'s body to the **annotated**
   post-conversion state (§4), leaving every superseded sentence in place with
   its marker;
2. updates `docs/skills/designing-pages.md` **§11** (the family's coverage-matrix
   row — the row currently says *"cloneOps stays non-zero"*-era content, read at
   `:568`) and **§12** (the demo-page entry, read at `:659-709`), per AGENTS.md
   item 3 — **this is a page-design-visible change**, so both rows are mandatory;
3. adds the tracker rows of §9;
4. lands the validation trio green except the pre-existing user-ruled tripwire
   (§6 risk 5 / AC-13).

---

## 9. Cross-references

| Reference | What this spec depends on / changes |
| --- | --- |
| `docs/specs/fork-stress-data.md` | **SUPERSEDED IN PART, AND ALREADY ANNOTATED THIS PASS:** the annotation is live at `:24-50` (a `⛔ ANNOTATION 2026-09-22` block that quotes the ruling, records the supersession of the two scope-note sentences and of the `in-tree = 2^depth − 1 + prototypes` / journaled-`cloneOps` re-pin, keeps the clone assembly recorded as **NOT a defect**, and points at this file). Its remaining body is still pre-conversion: the Purpose bullets (`:36-47` pre-annotation), envelope sample's `handlers` (`:72`), handler-install step (`:100-138`), pass-2 render step (`:139-141`), per-method clone descriptions (`:150-202`). **All of that is annotated, not deleted** — the body rewrite is the landing pass's (§8.3 duty 1). Its **lessons list** (`:225-327`) and builder/smoke wiring (`:215-223`) survive, updated by annotation. Lessons 5/8/9/10 (css flat shape; dead def css on covered re-types; bare-vs-composite adapter keys; the covered-gated def-fill) are **carried forward as-is** — they are the K3 mechanism's own contract |
| `docs/specs/placement-path-spec.md` | the target model: §0 **E2E-1** (`:65`), §2 (path enumeration), §5.1 (the page re-expression, `:594-629`), §5.2 (the static census + the per-page table, `:631-677`), §6.1's `docs/specs/fork-stress-data.md` row (`:696` — which itself promises the rewrite this unit performs), the census row (`:639`), the per-page census table (`:655-657`), and `:1658` (*"contentNodes minting adds ANCHORS, never nodes — E2E-1's 'no node creation' holds at every stage"*) |
| `docs/specs/derived-fork-variants-review.md` | the three-variant feasibility verdicts (§2 rows 1-3, `:32-38`), the blocker resolution (option (a) ENGINE GATE, `:102`, LANDED `:313`), the per-method census table (§5.1, `:180-184`), the adapter-key/derived-bake pins (§4.4/§4.5/§4.6), the dispositions (§8, `:284-298`) — including disposition 4 (*"Runtime clone pages stay as legacy-stress tests | ADOPT"*) which the user's ruling **supersedes** |
| `docs/specs/no-clone-invariants.md` | §3 **I1..I5** (the invariants the converted family must satisfy), §5 **P-IM-2** / **P-TP-2** (the rows whose relations §3 **K7** re-derives), §3 **I5**'s "Pre/post per page" table (`:675-679` — the `demo/fork-stress-data.js` row's *"the number legitimately reports non-zero"* is **superseded** by this unit), §2.2 row 2 (the sanctioned-handler-cloning carve-out, **still in force for other families**), §4 (guard reachability), §8.1 **NC-1e** / §5 **P-IM-4** (the handler-coverage compensation, §3 K8), §8.2 **NC-2c/NC-2d** (the guard cases §8.2 rows 5-6 re-point) |
| `docs/specs/ops.md` §2.4 | the owning record for `clone-instance`: `:87` (*"**Not the placement mechanism** … clone-instance stays the component-instantiation / after-compile-expansion path only"*) and `:88` (*"**HANDLER-LOGIC ONLY (user clarification 2026-08-15)** … placements = path enumeration + seam anchor layers, components = resolution + seam … The op exists solely for HANDLER logic (the fork-stress `stress-expand` bodies …) and the wire vocabulary"*). **§2.4 is unchanged by this unit** — it is the clause that made the OLD family legitimate and that the new family no longer needs. §2.6 (`:102-119`) is the `placement-attach` contract the converted family's static route does not use (path enumeration needs no op) |
| `docs/specs/render.md` **DFC-1** (`:224`) | the def-chain emit contract the `link` variant depends on: 1:1 re-typing of covered real children; the **P-EMIT-3 carve-out** (the childless-host def-fill with synthetic `` `${wire}:${bind}` `` wires); the **covered-CHILDLESS gate** (DEFECT #21 — *"Pre-gate the runtime link page shipped 8191 elements (4096 phantoms, unasserted…); post-gate every variant emits exactly 2^depth − 1 = 4095"*). Also DFC-H1 (`:569`) and DFC-F2 (`:571`) |
| `docs/skills/designing-pages.md` **§11 / §12** | the coverage matrix (§11, the family's row at `:568`; the static family's at `:570`) and the demo-page index (§12, `:659-709`) — **both must be updated by the landing pass** (AGENTS.md item 3). Also relevant: §2's NO-CLONING block (`:206-227`) — it currently cites `demo/fork-stress-data.js:251-254` as *"the sanctioned fork-stress pattern"* and *"the ONLY legitimate source of a non-zero `cloneOps` census"*: the landing pass must re-point that example (the sanctioned pattern still exists, but this family is no longer its demonstration), and §14.5 (the data-driven assembly lessons, `:1284`+) |
| the no-clone RCA archive reports | `archive/reviews/2026-09-22/2026-09-22-noclone-probe.md` (the per-path verdict table `:55-65`, the measured clone census **`:64`** — `cloneOps=2/14/62/254/510/1022/2046/4094` with `registered = 2^d − 1 + 2(d−1) + cloneOps`, depth 12: `4117/4094` — and §7's gap list) and `archive/reviews/2026-09-22/2026-09-22-noclone-history.md` (the rule's four textual homes `:86-91`, the approval trail `:331-353`); plus the enforcement adversarial audit `archive/reviews/2026-09-22/2026-09-22-noclone-enforcement-adversarial.md` and the doc review `archive/reviews/2026-09-22/2026-09-22-noclone-doc-review.md` |
| **Tracker rows the landing pass adds (by NAME — never by line number)** | `docs/decisions.md`: a row recording the **data-driven-family conversion** (path enumeration + the `cloneOps = 0` pin) with this spec as its source; an amendment note on the **NO-CLONE-ENFORCEMENT** row if the measurement home changes. `docs/defects.md`: a **FIXED/landed** row if the conversion closes a filed item (it is NOT a defect fix — the current behaviour was sanctioned — so this is expected to be a decision row, not a defect row). `docs/pending.md` / `docs/next-steps.md`: the **RUNTIME-FORK-PASS2-RATIO** row gains this conversion as **evidence** (one contributor retired), and is **not** closed by it |
| **Open questions for the gate (do NOT decide unilaterally — §6 risks 1, 2, 6)** | **Q-1:** do the family's **per-depth pages** (d2..d12) stay as separate built pages after the conversion, or does the family consolidate to a smaller set? *(The per-depth sweep is §3 K5's unique coverage row 4 and §8.2 row 2 requires it; a page-set reduction is a gate decision.)* **Q-2:** do `data-path` (recommended: **carry**, it is a per-path-state derived prop with no new mechanism) and `stress:layers` (recommended: **drop-with-record** — it degenerates to a depth marker on a single-method page) stay as assertions? **Q-3:** does the **page-level sanctioned-`clone-instance` demonstration** need a new home (a separate small page/suite), or is §3 K8's verdict (NC-1e + `P-IM-4` are sufficient) accepted? **Q-4:** does the **`stress:kind` per-node mechanism label** stay in any family after the conversion, or is it retired everywhere (`docs/specs/fork-stress-data.md` §4's per-method labels are documented as the cycle pages' device)? **Q-5:** the **profile-shape change** — the `[fork-stress-data:profile]` line loses `pass2`/`handlerMs`/`handlers`: is any external consumer (a doc, a dashboard, a report script) reading those tokens? *(A consumer found = a documentation re-point in the same pass.)* |

**Recorded as CLOSED (not open):**
- **The per-variant expressibility question** — all three variants are
  data-expressible with **no** engine change and **no** imperative anchor attach
  (§3 K3's verdict table; the values/link derived pages ship and pass,
  `docs/specs/derived-fork-variants-review.md:35-36`, LANDED `:313`).
- **The engine-change question** — this is a page re-expression unit; a required
  engine change is a **gate finding** (§2.2 row 1), not a licence.
- **The handler-coverage sufficiency question** — NC-1e + `P-IM-4` cover the
  sanitised route's liveness; one new ZERO-side case (**FD-5**) is owed (§3 K8).
