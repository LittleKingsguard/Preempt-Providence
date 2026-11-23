# `ORPHAN-EMIT` gate (`orphan-emit-gate-review`) — should the engine emit a state no parent appends?

**Status: the emit side owns neither defect and cannot be made to see either.**
**(ii) the graft's token-walk state → ACCEPT `E5`** (do not mint the token walk for a `routed` node), with **three
binding conditions** (§5 D-2). **The whole emit-side family (`E1`/`E2`/`E3`) is REJECTED** — inert at best,
content-deleting at worst.
**(i) `placement-attach` into a non-placement-routed container → SPLIT BY MODE:** its **doc half is CLOSED**
(2026-11-23 ✎ CORRECTED), its **engine half is CLOSED for path-mode trees** by `PATH-DOMAIN-RE-MINT` (`PBED-10`), and
**OPEN only for family-mode trees**, where the remedy is **`E6`** — a documented limit plus a diagnostic **at the op
site** (`ops.ts:125-146`), never in emit. **`E4` is PARKED** (right target, not specifiable until the family-state
child WIRE is settled).
**A NEW DOC DEFECT is filed (D-6):** the `placement-path-spec` §3.3 scenario-40(c) pin is **MODE-BLIND** — as written
it contradicts the green `PBED-10`.
**Versions:** (ii) `X.Y.X` (element/state-count change); (i)'s diagnostic `X.X.Y` (`console.warn` keeps signatures
stable, the `BODYRUNS-DROP-DIAGNOSTICS` precedent).

**Gate provenance.** Three-agent gate (AGENTS.md item 9): step 1 validity and step 2 critique ran independently and
read-only, neither reading the other; step 3 change-analysis adjudicated both and re-read every decisive claim at
`19044fa`. **The supervisor then executed the decisive probe itself** (§4.3) — steps 1-3 had no execution surface.
Date: 2026-11-23.

---

## 1. The question and the two constructions

Should the engine emit a **state that no parent appends**? Two constructions:

- **(i)** `placement-attach` a node into a container that is **not placement-routed** — the added node's placement
  state gains no append (pinned: `placement-path-spec.md` §3.3 scenario 40(c)).
- **(ii)** an unparented **graft** (a translated-tree-root placed into someone else's container) holds a **token walk**
  (`hops.length === 0`) whose state **nothing** appends.

**The decisive structural fact** (which both reports under-read): the residuals are **not two shapes but two shapes per
compile mode**, and in the live tree **every** unappended state of both is **root-shaped** — `cs.parent === null`
(`node.ts:1567` for a token walk; `node.ts:1331` for a `makeCs` root). **Therefore `E1`'s "except a root" clause
exempts exactly the states the defects are about.**

---

## 2. Step 1 — validity (summary)

**FIXABLE ONLY UPSTREAM, split per construction.** (ii) → compile: do not mint the token walk for a `routed` node
("identity is placement-only"); an emit-side claim-resolution predicate is a viable second-best **for (ii) alone**.
(i) → compile: the container's state must claim its placed children (`makeCs`'s `node.children.map(c => c.id)` vs the
path domain's `pathChildrenFor` container-zone scan); **emit cannot fix (i) at all** — no claim exists to detect, and
the shape is contractually indistinguishable from a legitimate class (`value-provider-render-disposition` §2 C5
exclusion 2 keeps "children under a minted parent still flatten" out of scope permanently).

**Four coexisting root notions** today: adapter root = first `createEl` (`adapters.ts:463`, never reset); op-stream root
= "no append names my wire" (`treeFromOps`); graph root = the `'rootNode'` family-parent token (**ambiguous** — the
graft carries it too, which is why `pathKeyFor` needed the `!routed` term); compile-derived root = parentless in-tree
node ⇒ `pathKey 'root'`.

**Load-bearing legitimate unappended classes:** the document root; **multi-root is real and asserted**
(`tests/unit/adapters.test.ts:1044` `toHaveLength(2)`, `:1101` DOM-B2 mounts both); **subset/literal batches** (≥6 call
sites pass literals with no `parent` at all); fork arms whose parent wire is absent; an actionable descendant of a
consumed provider; **def-fill synthetic wires** (real `childOrder` members with no `nodeById` entry — the **A+6b**
control).

**Cost:** SSR adapters need no change (FRG-H24 untouched); the **DOM adapter floats too** (`endBatch` mounts every
never-re-parented element) so an adapter-side fix would break PAR-5; `treeFromOps` needs no change; **no demo emits
several independent trees in one call** — the smoke is a coverage hole.

---

## 3. Step 2 — critique (summary)

**`E1` as specified — a trap.** Over-drops literal/subset batches, multi-root, fork arms with an absent parent wire,
actionable descendants of a consumed provider (**and it cascades** — dropping an unclaimed child makes *its* children
unclaimed ⇒ silent subtree deletion), and the covered-group arm (`render-helpers.ts:713-746` pushes
`emitted.defChildren` while **not** pushing the claimer `el`). Caught by the **literal censuses**; **not caught** by
any self-consistent page-vs-builder census, nor by `legacy-shape`'s expected HTML (same pipeline), nor by the
ssr-render PAR-5 oracle (both sides use `minimalFromState`); multi-root/literal hosts have no guard at all.
**`E2` — the worst:** it is the corpus's **explicitly rejected stance (C)** moved into emit (`adapters.md:526-531`),
and it makes semantics depend on host array order the drain-only host demonstrably scrambles.
**`E3` — not a fix:** DEFAULT-OFF leaks in every host, DEFAULT-ON re-renders the world, and the root set is knowledge
the caller cannot derive.
**`E4` — a trap:** in a mixed tree it yields a **ghost `childOrder` entry** (`R-VPD-2`, not an append), breaks the
`children.length` derived contract (`derived.ts:220-221`), breaks the "`makeCs` reads only its own surface"
justification, and grows **pass-2** — the one thing the growth guard polices.
**`E5` — the only survivable shape**, needing three conditions.
**"Loud diagnostic + documented limit" is defensible for (i) only** — escapable via the documented mode channel and
avoidable by an author, *provided* the escape's cost is stated and a real diagnostic channel exists (none does;
`R-VPD-4` records that a warn is not a record). **Not defensible for (ii):** rendering a translated component payload
into a zone **is** the placement model — no host can decline it.
**Both rows' reproductions were still owed inside this tree.** They are now measured (§4.3).

---

## 4. Step 3 — change-analysis

### 4.1 Adjudication (contested points)

| Point | Adjudication |
| --- | --- |
| Is `E1` savable as a *diagnostic*? | **No in emit.** It would fire on **seven correct test inputs** by construction (the literal batches carry no `parent` key at all) — noise with none of `R-W4-5`'s justification. Savable only by moving it **upstream to the op**, where the knowledge lives — where it *becomes* `E6`. |
| Does the token walk satisfy `parent === null`? | **YES** (`node.ts:1567`). Step 2's "no root predicate exists in emit's *data*" is **over-stated** — `CompiledState.parent` is public (`types.ts:285`); only a local emit type omits it (a one-line widening). The **substance survives**: a parent-based test cannot separate a graft from a document root, **and cannot see (i) either**. |
| Is `E4` really smoke-invisible? | **Half right, dangerous half.** The element-census pages bootstrap by path enumeration, so E4's *emit* consequence is invisible there — **but the growth guard's measured pages bootstrap `family`**, which is exactly where E4's added `makeCs` scan is paid, and `derived.ts:221` (`children.length`) is author-visible on family pages (`demo/feature-showcase.js:105`). |
| How bad is the `routed` coupling for `E5`? | **Benign by construction.** `routed` is computed **from the walk set before any mint** (`node.ts:1493-1501`) and passed to every `mintPathState` (`:1522`); suppressing a walk does not touch the walk set, so `pathKeyFor`'s `!routed` term keeps behaving identically and **`GRAFT-ROOT-PATHKEY-COLLISION` cannot reopen by that route**. **The real hole is one line earlier and neither report cited it: `chosen`-pruning (`:1503-1506`) `continue`s with NO `dropped` entry and NO warning** — step 2's condition (ii) was right in substance, wrong in location (the `terminal:'token'` arm *does* record `owner-terminated`). |
| Which guard catches an over-drop? | **The suite literals, not the smoke** — 4 cases in `render.test.ts` plus 3 more files go red by inspection; the demo censuses catch only counts, never identity. |

### 4.2 The two things both reports missed

1. **The residual (i) is a family-mode phenomenon**, so the §3.3 pin and the green `PBED-10` describe **two different
   trees**, and the pin's mechanism sentence is **mode-blind** (§5 D-6). As written, spec and test **contradict each
   other** — the largest documentation risk in the item.
2. **The diagnostic's only sound home is the op** (`ops.ts:125-146`), which already owns an identical `console.warn`
   channel (`placement-name-vetoed`, `ops.ts:139`) **and** the two facts the predicate needs (the container's routing
   + the supervisor's compile mode). Emit has neither.

### 4.3 THE DECISIVE PROBE — EXECUTED (supervisor, 2026-11-23)

The three gate passes had no execution surface, so the supervisor ran the construction itself against the rebuilt
`dist` (a separately translated tree root `placement-attach`ed into an authored page, rendered through
`SSRFragmentAdapter` with `nodeIdAttribute`), counting elements per `data:node-id`, appends to the graft, unclaimed
elements, and `treeFromOps` roots:

| mode | graft elements | graft wires | appends to graft | unclaimed | `treeFromOps` roots |
| --- | --- | --- | --- | --- | --- |
| **family** | **3** | `root/node-4`, `root/zone/node-2/node-4`, `root/zone/node-3/node-4` | **0** | **4** | **4** |
| **path** | **3** | same shape | **1** | **3** | **3** |

**The reading is worse than either report predicted, and it settles `E5`'s premise:**
- the graft emits **three** elements (one token walk + one placement walk **per offering container**), so the duplicate
  is **not 2 but N** — and in family mode **nothing** appends any of them;
- **`treeFromOps` returns 4 (family) / 3 (path) roots** — i.e. the rendered document **is a forest**, and the count
  equals the unclaimed count exactly, which is the probe's own self-check (unclaimed ⇔ forest root, by
  `diffMinimal`'s `childOrder ∩ present` rule);
- **path mode appends exactly one** of the three — confirming that `PATH-DOMAIN-RE-MINT` closes only the placement walk,
  and that the token walk plus the extra offering-container walks survive.
- `PBED-10` cannot see any of this: it keys a `data-node-id` **Map** (last-wins), so three elements for one node id
  collapse to one.

**Consequence for the disposition:** `E5` (suppress the token walk for a routed node) is **necessary but not
sufficient** — the N-way duplication includes one placement walk **per offering container**, which is a *separate*
question (should a node placed by name into two zones mint two states? today yes, and that may be correct). So `E5`
removes **one** of the N+1 unappended states; the remainder needs the documented limit / `E4` track.

---

## 5. Dispositions

| # | Item | Verdict | Remedy + binding conditions | Tracker |
| --- | --- | --- | --- | --- |
| **D-1** | (i) doc half — the pin's "the widget does not render" | **CLOSED 2026-11-23** | none; do not reopen | `docs/defects.md:40` |
| **D-2** | (ii) the graft's token-walk state | **ACCEPT `E5`** | **(1)** keep `routed` derived from the **walk set** and keep `pathKeyFor`'s `!routed` term (deleting it as "dead code" reopens `GRAFT-ROOT-PATHKEY-COLLISION`); **(2) never suppress a node's LAST surviving walk** — the silent hole is the **`chosen` prune** (`node.ts:1503-1506`), which records nothing; a `chosen`-killed node must keep its token walk or the container's `childOrder` names a wire nothing emits (a new `R-VPD-2` ghost) and the graft vanishes with no `dropped` entry; **(3)** it lands with its red set first (§8 P-1/P-2) — **no smoke page carries a graft**, so the test file is the only witness. Changelog must name: one fewer `state` event per graft per flush, `resolvedStates` −1 for that node, one fewer `$pathKey`/`$placement` bake. **NOT sufficient alone** — see §4.3 | `docs/defects.md:42` (b) → FIXED on red→green; `placement-path-spec` §2.4/§3.3 amendments |
| **D-3** | (i) engine half — **family-mode** trees | **ACCEPT `E6`** | **(a)** site the diagnostic at the **op**: in `placementAttach` warn when the target container is **not placement-routed** **and** the supervisor's `compileMode === 'family'` — the exact leak condition, both facts in hand there and nowhere in emit; **(b)** document the escape **and its price** (switching to path mode re-keys the whole document from nodeId wires to pathKey wires); **(c)** record the limit in `placement-path-spec` §3.3 + `designing-pages.md`; **(d)** do **not** claim the warn discharges `R-VPD-4` — a warn is not a record | `docs/defects.md:40` engine half; `ops.ts`; specs; guide |
| **D-4** | `E4` — family `makeCs` claims placed children | **PARK** (not rejected) | Cannot be specified: family-state `children` are **node ids** while the emit conversion is **path-keyed**, so a placed child has no defined wire ⇒ ghost `childOrder` (`R-VPD-2`); it also changes `children.length`-derived values and lands in the growth guard's measured pages. **Revisit:** the family-state child wire is settled by its own contract **and** a re-baselined growth guard shows the added scan is affordable | `docs/pending.md` |
| **D-5** | `E1` (emit filter) | **REJECT** | Fixes neither live construction (both root-shaped), drops all seven literal-batch inputs by inspection, needs a new silent-drop class closed under cascade. Its only salvageable idea — *observe* the unclaimed set — belongs upstream (D-3) or in a census | — |
| **D-6** | **The §3.3 pin is MODE-BLIND** (new doc defect) | **DOC FIX OWED — `X.X.Y`** | The pin's mechanism sentence is true **only in family mode**; post-`PATH-DOMAIN-RE-MINT` the container re-mints and the append **exists** (`PBED-10` green). Amend with a **mode qualifier** and cross-cite `PBED-10`; **do not delete** the pin — the family-mode reading is the live residual | `placement-path-spec` §3.3 |
| **D-7** | `E2` (first element is the root) | **REJECT** | Stance (C) in emit; order-dependent; deletes every second root | — |
| **D-8** | `E3` (caller-declared roots) | **REJECT** | Closes the row by redefinition; the caller cannot derive the set | — |
| **D-9** | The N-way placement duplication (§4.3) | **NEW, OPEN** | A node placed by name into **two** zones mints **two** placement states, both unappended in family mode. Whether that is correct (two presentations) or a second duplication class is **unruled** — and `E5` does not touch it | this record §4.3 |

---

## 6. INVARIANTS TOUCHED

`placement-path-spec` §2.2 (path identity; the one-per-document root token) · §2.3 (`pathChildrenFor` is the **only**
container-zone claim scan) · **§2.4 arm disposition — a dropped arm is recorded with a reason** (the `chosen` prune
does not record: `E5`'s condition 2) · §3.3 scenario 40(c) (mode-blind, D-6) · §4.1 wire stability across renders
(an emit-side filter would make a wire vanish **without** a topology change — its exact inverse) · §4.2 `childOrder`
frozen at mint · `render.md` R-ORD-8 + corollary, §3.3 (`append` only for `childOrder ∩ present` — the floating
mechanism) · `adapters.md` §4.6 floating rule + FRG-H24/25/26 · PAR-5 DOM/SSR parity · `R-VPD-2`'s A+6b constraint ·
FS-1 / the closed unions (no new silent outcome) · `PATH-DOMAIN-RE-MINT` (D-3's escape route) ·
`RUNTIME-FORK-GROWTH-GUARD` (`E5` is pass-2-neutral; `E4` is not) · `VERSIONING-SCHEME`.

## 7. MUST NOT BREAK

1 `routed` stays an aggregate over the **walk set** and `pathKeyFor`'s `!routed` term survives (`PBED-10` wire ≠
`root`) · 2 a node's **last** surviving state is never suppressed (new P-2) · 3 no wire disappears without a topology
change (`tests/blind/e2e-layer.test.ts:396-399`, `PBED-3`) · 4 the document root keeps wire `root` and emits first
(`PBED-2`, `render.test.ts:895-900`, FRG-H24) · 5 floating fragments still serialize after the root (FRG-H25/26) ·
6 PAR-5 parity · 7 **multi-root stays legal** (`adapters.test.ts:1044`, `:1101`) · 8 literal/subset batches keep
emitting every element (`render.test.ts:835-912` ×4, `body-runs.test.ts:256`, `node.test.ts:1356`,
`path-emit.test.ts:326`) · 9 def-fill synthetic wires stay claimed by their def-root element (A+6b) · 10 no new silent
drop class / no closed-union change · 11 **family path byte-identical** (E5 must not touch `makeCs`) · 12 pass-2 does
not amplify (`[runtime-fork:growth]` bound 10×) · 13 element censuses stay put · 14 neither defect is closed by
citation · 15 no doc claims a seam that does not exist (D-6 ships with its mode qualifier).

---

## 8. The red-first work the next unit owes

**Phase 1 — the `E5` red set (compile-side, public surface only):**
- **P-1** `tests/unit/path-emit.test.ts` — *"a ROUTED graft mints ONLY its placement walks"*: exactly 1 state for the
  token identity; **no** state whose `pathKey === \`root/${graft.id}\``; `forkKey === pathKey` on the survivor. **Red
  today** (the probe measured the token state present).
- **P-2** — *"a routed node whose placement walks are all pruned keeps its token walk (last-state guard)"*: the
  observable is that the node still emits exactly one state and no `childOrder` names a wire with no element. **This
  is the case that makes `E5` safe**; without it `E5` can turn a leak into a disappearance.

**Phase 2 — the witnessed guard (PBED-10 cannot see the duplicate — it keys a last-wins `Map`):**
- **P-3a `PBED-11` — the duplicate census**: over `post.els` **as an array**, elements with the graft's
  `data:node-id` = **1**; `create` ops for it = **1**; `treeFromOps(post.ops).length` = **1**; the id appears in the
  html exactly once. **Red today (3 / 3 / 3 — measured).**
- **P-3b `PBED-12` — the family-mode limit PINNED as documented behaviour + its diagnostic** (D-3): assert the current
  shape deliberately (1 appended + N floating), plus the new op-site warn — **green on purpose**, so a future "fix"
  must change this file rather than silently re-render.
- **P-3c** keep `PBED-10` **unchanged**; if any of its assertions must move, `E5` is wrong, not the pin.

**Phase 3 — the systemic guard:** publish `PROFILE.forestRoots = treeFromOps(ops).length` in the three census pages
and assert it in `demo-smoke.mjs` (1 per page) — converts the probe into a standing guard for the whole
unclaimed-state class at zero render cost. **Recommended**, since no demo page carries a graft today.

---

## 9. Open questions for the owner

1. **Ratify scenario 40(c) as a documented limit for family mode** (with D-3's diagnostic + the stated escape cost), or
   require family-mode trees to claim placed children (`E4` — which needs a new family-state child-**wire** contract, is
   author-visible via `children.length`, and lands in the growth-guard pages)?
2. **`E5`'s author-visible cost** (one fewer `state` event per graft per flush, `resolvedStates` −1, one fewer derived
   bake) — accept, and name in the changelog + `ops.md` §5?
3. **The diagnostic's channel** — `console.warn` at the op site (acknowledging `R-VPD-4`: a warn is not a record), or a
   closed-union member with its own gate?
4. **`E4`** — park with its revisit condition, or reject outright so nobody reopens it?
5. **D-6** — approve the mode-blind pin amendment as a doc-only `X.X.Y` in the same pass as `E5`?
6. **The guard** — P-3a/P-3b as the only witness, or also fund the `forestRoots` census?
7. **The N-way placement duplication (§4.3, D-9)** — is "one placement state per offering container" intended? `E5`
   does not touch it, and it is now the **largest** remaining unappended-state source.
8. **Packaging** — does `E5` ride the release that carries `PATH-DOMAIN-RE-MINT`, and does the D-3 diagnostic ship
   separately (`X.X.Y`)?

---

**Verdict, one line.** Both live residuals are **root-shaped**, so emit can see neither — `E1`/`E2`/`E3` are inert at
best and content-deleting at worst; **(ii) is fixed upstream in one function** (`E5`, `node.ts:1502-1522`) with three
conditions (keep `routed`, never suppress the last surviving walk, land the red set first), **(i) is closed for path
mode and is a documented limit + op-site diagnostic for family mode**, **`E4` is parked behind the family-state
child-wire contract**, and **the pin that started this must be amended in the same pass because it contradicts a green
test**. The supervisor's probe puts a number on it: a graft renders as **three elements and a four-root forest** in
family mode, and `PBED-10`'s last-wins `Map` cannot see it.
