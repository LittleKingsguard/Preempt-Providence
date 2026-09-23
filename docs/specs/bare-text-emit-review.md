# Bare-Text Emit Path (`text` child node) — Change-Analysis Review

**Status:** **PROCEED-AS-RESHAPED (0.4.0 non-breaking).** Add a `text` child node that
renders escaped text with NO wrapper element (bare-text emit, Shape A1), so
interleaving is deterministic via `childOrder`. `bodyRuns` is **deprecated-but-present**
(removed at the next major); content+children gets a **warn-only** diagnostic (no render
change, round-trip preserved); XOR render enforcement + `bodyRuns` removal are deferred
to 1.0.0. Gate provenance: three-agent gate (AGENTS.md item 9); step 1 validity **A1
feasible + preferred (A2 recreates bodyRuns cross-node coupling)**; step 2 critique
**A1 minimum-safe only with the DOM cascade contained; bodyRuns is NOT redundant; XOR
drop is breaking**; step 3 verdict **PROCEED-AS-RESHAPED**.
Date: 2026-08-31.

---

## 1. What the proposal asks

Under a content-XOR-children model, text beside children is a child node. A **bare
`text` child** renders its escaped text with NO wrapper element — `[{text:'A '}, strong,
{text:' text'}]` renders `A <strong>bold</strong> text`, ordered deterministically by
`childOrder`. The user proposes this to replace the `bodyRuns` interleaving mechanism
(0.3.0/0.3.1/0.3.2), calling content+children coexistence unsupported.

## 2. The central finding — `bodyRuns` is NOT redundant (resolved honestly)

`bodyRuns` expresses a producer whose **own scalar `content`** is interleaved around a
child (the `Some <strong>bold</strong> text` case, eng-inline-order §1; the default
render `escapeText(content)+children`, adapters.ts:523-524). Under XOR a parent owns NO
content. Expressing the same line via text-children requires flattening ALL text into
children (`[{text:'Some '}, strong, {text:' text'}]`) — which **cannot be mechanically
migrated from a bodyRuns producer with scalar content without dropping that content**
(and breaking the scalar-content invariants: node.ts:613 content getter, validation
`required:['content']`, component binding content reads).

So `bodyRuns` is the **sole carrier of the parent-content-interleave shape**. The user's
fragility point (3 fix rounds) is valid — but its CAPABILITY is a superset of
text-children alone. XOR makes parent-content-interleave unsupported — a legitimate
support-contract decision, coherent only at the MAJOR (new data authored as text-children;
old producers migrated or out of scope). **This pass: bodyRuns kept-deprecated, not removed.**

## 3. Shape verdict — A1 (bare `text` child = a real Text node), NOT A2

**A1 is the only shape that retires the interleave special-case.** A2 (parent-owned text
runs) recreates the cross-node coupling that made bodyRuns fragile — rejected.

A1's DOM cascade (understated in the plan) — the precise seams:

| Seam | Why it breaks | Required change |
| --- | --- | --- |
| `DomAdapter.createEl` :95-108 | `el.dataset.wire = wire` :97 throws on Text (no `dataset`) | special-case `type==='text'` → `document.createTextNode('')` BEFORE the `dataset` write |
| `DomAdapter.setProp` non-text branches :149-221 (`css:`, `on:`, `data:`, default) | throw on Text for any stray prop | **content-only enforcement at EMIT** (filter ops) + a defensive `if (el instanceof Text) return` guard at the top of setProp (safe degrade, never throw) |
| `DomAdapter.setProp('text')` :113 | `el.textContent=` clobbers the Text's data; `FORM_CONTROLS.has(el.tagName)` | text-node branch sets `el.data = bakeValue(val)` |
| `stampNodeId` render-helpers.ts:471 (→ `data:node-id` :211) | routes to `setAttribute` → throws on Text | **skip stampNodeId on `text` wires** in emitOne |
| `wires: Map<string, HTMLElement>` :38 | type lie | widen to `HTMLElement | Text` |
| `batchEls: HTMLElement[]` :65 | type lie | widen |
| `appendChild` :224 | `child: HTMLElement | string` | accept Text; `o.appendChild(c)` already valid |
| SSR `FragmentDescriptor` :6-11 / `childHtml` :527 | `<text>` wrapper | add `isText`; render contentText only |
| `treeFromOps`/`applyOps` :260 | — | element-agnostic (findEl resolves a Text wire via the map), no change |
| Markdown adapter :807 | — | `text` already classified `inline`, renders bare text — free |

**Enforcement point: EMIT, not translate.** validation.ts is an opt-in registry
(registerTagSchema + explicit validateNode), not in the render pipeline; a consumer never
calling it bypasses any translate rule. So emitElements/emitOne filters a `text` child to
the `text` prop only (skip stampNodeId/css/handlers), and the DomAdapter `instanceof Text`
guard is the defensive backstop.

> **ERRATUM (2026-09-22 — N6, `docs/specs/ur-2026-09-17-review.md:235`; gate records are append-only-with-annotations).**
> **This passage overstated the warn site. As LANDED, the enforcement point and the
> warn site are DIFFERENT SEAMS — this is a correction of an unreachable claim, not a
> behaviour change (no W4 clause moves):**
>
> | Claim as written here | The truth (re-derived from the code) |
> | --- | --- |
> | *"emitElements/emitOne filters a `text` child to the `text` prop only (skip stampNodeId/css/handlers)"* | **CORRECT** — `emitOne`'s `if (s.type === 'text')` early return (`src/core/render-helpers.ts:1155-1162`) emits only `props['text']` (from `scalarBinding(s.bindings) ?? s.content`) and performs no `prop:`/`css:`/`on:`/`data:` mapping, no `stampNodeId`, and `childOrder: []`. The filter is **SILENT** |
> | *"emits a deterministic `text-content-only` warn for rejected props"* | **FALSE — there is NO emit-time warn site.** The only `text-content-only` warn is **TRANSLATE-time and legacy-JSON-only** (`src/core/translate.ts:956-958`, gated on authored `data.props`/`data.css`/`data.handlers`/`data.placement`). A **programmatically constructed** `text` node warns **NEVER** |
> | *"the DomAdapter `instanceof Text` guard is the defensive backstop"* | **CORRECT IN SUBSTANCE, DIFFERENT TEST** — the landed guard is `el.nodeType === 3` (`src/core/adapters.ts:183-187`), chosen so it also works in shimmed DOM environments where the `Text` global is absent |
>
> **What this means for the contract (AC-8 + AC-9):** the owning behaviour specs state
> the emit rule as **silent filtering** and claim **no** emit-time warn —
> `docs/specs/render.md` §3.2b (BT-EMIT-5) and `docs/specs/adapters.md` §3.2's
> silent-filter note. Whether an emit-time warn should be **BUILT** is a
> W4-adjacent decision (it would be a code change with its own red set), NOT a doc
> fix; the diagnostic contract that would host it is
> `docs/specs/bodyruns-drop-diagnostics.md` (§3 C5 covers only the `text`-node
> children/`bodyRuns` silence, and its §2.2 row 9 explicitly leaves
> `content-with-children-recommended` out of scope). Tracked as defect **N6**
> (`docs/defects.md`) and corrected in the `docs/decisions.md` BARE-TEXT-EMIT row
> (✎ ENFORCEMENT-SITE CORRECTION).

## 4. Versioning + migration

**content+children drop is a MAJOR, not a 0.4.0 warning.** shipped data relies on it
(demo/feature-showcase.js:217-230, demo/legacy-shape.js:130-163 blind-shell content
'shell text' + child + children-seam, rich-text-html-to-provident-tree.md:105-124,
use-case doc); nodeToLegacy:1198 round-trips content; DOM render is
`escapeText(content)+children`. A "children win, content dropped" rule changes every such
render + breaks the smoke → 1.0.0.

Recommendation: **0.4.0 non-breaking now** — additive `text`-child (A1); `bodyRuns`
deprecated-but-present (`bodyruns-deprecated` warn, behavior unchanged); content+children
`content-with-children-recommended` warn with NO render change. **1.0.0 major deferred** —
XOR render enforcement (children win), `bodyRuns` removal, authored-producer migration
guide (parent scalar content → text-children).

## 5. Reshaped contract vs the user's three points

1. **"bodyRuns doesn't solve this"** — agreed it's fragile; but it is NOT redundant (sole
   carrier of parent-content-interleave). Action: deprecated-now, removed-at-major.
2. **"spans/children order deterministically"** — agreed (A1); ordering via childOrder.
3. **"breaking only if unintended for support"** — agreed as a support-contract decision,
   but enforced at the MAJOR (shipped demos/docs + round-trip make a 0.4.0 drop breaking).

## 6. First TDD increment (0.4.0)

Red set (AGENTS.md item 8):
- SSR: `[{text:'A '}, strong, {text:' text'}]` → `A <strong>bold</strong> text`, no `<text>`
  wrapper, childOrder position.
- DOM: parent `ordered` shows text run + element interleaved in order.
- Ordering: `[text,strong,text]` ≠ `[strong,text,text]` (orderSig).
- Content-only: `text` with props/css/handlers/placement → `text-content-only` warn, op
  filtered, DOM guard degrades safe (no throw).
  **[ERRATUM 2026-09-22 — N5: the op filter is SILENT at emit and this `text-content-only`
  warn is the TRANSLATE-time one, legacy-JSON only (see the §3 ERRATUM); a programmatic
  `text` node warns never.]**
- Whitespace: text content preserved verbatim.
- Round-trip: text-child translate → emit → reverse faithful.
- bodyRuns deprecation: emitting bodyRuns → `bodyruns-deprecated` warn, render unchanged.
- content+children: `content-with-children-recommended` warn, render unchanged.
  **[ERRATUM 2026-09-22 — N5: this warn was NOT built at 0.4.0. It is DEFERRED to
  the 1.0.0 major and the string exists nowhere in `src/` — see §4/§7 below and
  the `docs/decisions.md` BARE-TEXT-EMIT row's ✎ N5 CORRECTION.]**

## 7. Verdict

**PROCEED-AS-RESHAPED (0.4.0 non-breaking).** First increment: A1 `text`-child, content-only
enforced at emit + DomAdapter Text guard, stampNodeId skipped on text wires, SSR `isText`,
DOM wires/batchEls/appendChild widened. Deferred to 1.0.0: XOR render enforcement, bodyRuns
removal, authored producer-migration guide. Tracking: docs/pending.md row
BARE-TEXT-EMIT (PROCEED 0.4.0); plan docs/plan-bare-text-emit.md.

**LANDED (partial) 2026-08-31.** A1 `text`-child emit built (SSR `isText` + empty tags;
DOM `createEl` Text node in shim-guarded mode + `wires`/`batchEls`/`appendChild` widened to
`HTMLElement | Text`; `emitOne` content-only early-return for `type==='text'` — no
prop:/css:/on:, no stampNodeId, auto-minted props.id dropped). `text-content-only` +
`bodyruns-deprecated` translate-time warns built. **`content-with-children-recommended`
DEFERRED to 1.0.0** — firing it warns every legitimate content+children node in the shipped
demos/fixtures and forces the census-changing re-expression (a 1.0.0-major migration); kept
out of the additive 0.4.0 pass so it stays non-breaking. Trio green: 1275 tests, typecheck,
build, demo:smoke (handlers 25/0, rows 10/0, fork-stress pins within 2.5×).

### Decision records
- **DECIDED:** A1 over A2 (A2 recreates the bodyRuns coupling).
- **DECIDED:** content-only enforced at EMIT (+ DomAdapter Text guard), not translate.
  **(✎ 2026-09-22 — N6: the ENFORCEMENT is at emit and it is SILENT; the
  `text-content-only` WARN is translate-time/legacy-JSON-only. See §3's ERRATUM.)**
- **DECIDED:** 0.4.0 additive now (text-child + `text-content-only` + `bodyruns-deprecated`
  warns); `content-with-children-recommended` + XOR render enforcement + bodyRuns removal +
  migration at 1.0.0 major.
  **(✎ 2026-09-22 — N5: the `content-with-children-recommended` warn is DEFERRED, not
  shipped at 0.4.0.)**
- **DECIDED (2026-09-22 — W3 fold, `docs/specs/ur-2026-09-17-review.md` §4 UR-1 / §7 AC-1..AC-12):**
  this gate record is a **HISTORICAL** record; the bare-`text` emit contract now lives in
  the BEHAVIOUR specs — `docs/specs/render.md` §3.2b (the register entry + emit rule,
  `>=0.4.0 <1.0.0`), `docs/specs/adapters.md` §3.1 step 0 / §3.2 Text-owner rows / §4.1 /
  §4.3 / §4.4 / §6, `docs/specs/node.md` §2.1. Cite those for behaviour; cite this record
  for provenance only.
- **DECIDED (2026-09-22 — UR-2, `docs/decisions.md` BODYRUNS-REMOVABILITY row):** the
  "removed at the major" phrasing in §2/§5/§7 above is now a **versioned ruling** —
  branch (b), **removed at the 1.0.0 major**. §2's "This pass: bodyRuns kept-deprecated,
  not removed" stays correct *for 0.4.0* and is not a claim about removability.
