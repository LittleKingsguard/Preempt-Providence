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
the `text` prop only (skip stampNodeId/css/handlers), emits a deterministic
`text-content-only` warn for rejected props, and the DomAdapter `instanceof Text` guard is
the defensive backstop.

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
- Whitespace: text content preserved verbatim.
- Round-trip: text-child translate → emit → reverse faithful.
- bodyRuns deprecation: emitting bodyRuns → `bodyruns-deprecated` warn, render unchanged.
- content+children: `content-with-children-recommended` warn, render unchanged.

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
- **DECIDED:** 0.4.0 additive now (text-child + `text-content-only` + `bodyruns-deprecated`
  warns); `content-with-children-recommended` + XOR render enforcement + bodyRuns removal +
  migration at 1.0.0 major.
