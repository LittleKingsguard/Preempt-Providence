# Plan — Bare-Text Emit Path (`text` child node, no wrapper element)

- **Status:** PLAN (grounded in the code; NOT yet gated/built). Gate reference:
  the CONTENT-XOR-CHILDREN reconsideration (2026-08-31) accepts the XOR model —
  a node has `content` XOR `children`/placement — and text beside children is a
  child node at its position in ordered `children[]`. This plan covers the
  **bare-text** case (a child that renders literal text with NO wrapper element,
  unlike `<span>` which wraps). The `<span>` variant already works today
  (`docs/use-case-placement-native-interleave.md` §5b).
- **Date:** 2026-08-31.
- **Goal:** a `text`-type node that, as a child, emits its escaped text in place
  (no `<text>` wrapper) — so `[ {text:"A "}, span/strong, {text:" text"} ]`
  renders `A <strong>…</strong> text` with deterministic child ordering.

---

## 1. The goal in one render example

```
parent.children = [ {type:'text', content:'A '}, {type:'strong', content:'bold'}, {type:'text', content:' text'} ]

childOrder = [w0, w1, w2]      // each text child gets a wire like any element

SSR  parent → 'A <strong>bold</strong> text'   // text children splice, no <text> tag
DOM  parent → [textNode "A ", <strong>bold</strong>, textNode " text"]
```

The `text` child is a normal wire in `childOrder`, so ordering (hence interleaving)
is deterministic exactly as for any child — the "content always precedes children"
limitation vanishes because the parent has NO scalar `content` under XOR.

---

## 2. Why a bare `text` child is different (and needs a plan, not just "use `<span>`")

A `<span>` child wraps text in an element (`<span>A</span>`). That works today but
changes the output (an extra wrapper + any CSS/accessibility implications) and
adds one element per run. A **bare** `text` child renders the raw escaped text
at its position, with no element boundary — the semantically minimal interleave.

The engine currently has NO wire-less text emission:
- `FragmentDescriptor` always carries `openTag`/`closeTag` (`adapters.ts:6-11`);
  every `createEl` builds an element (`adapters.ts:362-376` SSR, `:95-108` DOM).
- `childHtml` renders `<open>content<close>` (`adapters.ts` ~527).
- DOM text nodes are NOT `HTMLElement`, so the `wires: Map<string, HTMLElement>`
  and `appendChild(HTMLElement)` seams don't accept them as-is.
- `VOID_TAGS` doesn't include `text` (`adapters.ts:13-28`); a `text` node would
  render `<text>` today unless special-cased.

## 3. Design decision — the two viable shapes

### Shape A: `text` node emits a fragment with empty open/close tags (SSR) + a text node (DOM)
- **SSR:** `createEl('text', …)` → `{ openTag:'', closeTag:'', isVoid:true, isText:true }`;
  `childHtml` renders `contentText` only for `isText`, not `open+content+close`;
  `contentHtml` interleaves normally (the text child is in `state.children`).
- **DOM:** the adapter needs a text-node path. Because `dom.textContent`-based
  approach and `HTMLElement` maps are element-only, this is the **hard seam**.

  Two DOM sub-options:
  - **A1 — textNode in the wires map as a `Text` node:** widen `wires` type and
    `appendChild` to accept `(HTMLElement | Text)`; `createEl('text')` returns
    `document.createTextNode('')`, `setProp('text')` sets its `data`.
  - **A2 — parent owns its text runs (no separate DOM node per text child):**
    when appending a `text` child, the engine sets a text run marker on the
    parent's `ordered` content and appends a real `Text` node. Closer to the
    existing `bodyRuns` DOM rebuild (`adapters.ts:113-133`) — which already
    interleaves `document.createTextNode` + child elements in order.

  **Recommendation: A1 for parity** (a text child is just another wire carrying a
  `Text` node), with `treeFromOps`/`applyOps` taught to handle a non-element child.
  A2 is a special-case that only helps the interleave case.

### Shape B: `text` renders as a `<span>` (wrapper)
- Already works today; no new engine machinery. But it is NOT bare text (a wrapper
  element + no-op `bodyRuns`-free interleave). Kept as the documented fallback.

## 4. The seams to change (Shape A)

| Seam | Today | Change |
| --- | --- | --- |
| `FragmentDescriptor` (`adapters.ts:6-11`) | `{openTag, closeTag, contentText, isVoid}` | add `isText?: boolean` (openTag/closeTag empty when set) |
| `SSRFragmentAdapter.createEl` (`adapters.ts:362-376`) | element always | `type==='text'` → `{openTag:'', closeTag:'', isVoid:true, isText:true}` |
| `SSRFragmentAdapter.childHtml` (~`adapters.ts:527`) | `open+content+close` | `isText` → return `contentText` only; never a `<text>` tag |
| `SSRFragmentAdapter.contentHtml` (`adapters.ts:507-525`) | already interleaves children | unchanged (text child is a child) |
| `DomAdapter.createEl` (`adapters.ts:95-108`) | `document.createElement` | `type==='text'` → `document.createTextNode('')` (needs the wires type widened) |
| `DomAdapter.setProp('text')` / `appendChild` | `HTMLElement` maps + `appendChild` | accept/route `Text` nodes |
| `applyOps`/`treeFromOps` (`render-helpers.ts:260-300`) | treat child as element wire | resolve `text` child to a Text node; skip element-only ops (styles, handler) on it |
| `VOID_TAGS` | no `text` | keep `text` OUT of VOID_TAGS (it's not a void element; it's a text fragment — handled by `isText`) |
| Validation (`validation.ts`) | type allow-list | a `text` type is allowed; `content` required, `children`/`props`/`placement` rejected on it |
| Markdown adapter | `text` → inline (`adapters.ts:807`) | `text` child renders inline text, no marker (it's text) |
| Translate/reverse (`translate.ts`) | — | `text` NodeData round-trips like any child |

## 5. Ordering proof (why it's deterministic)

`pathChildrenFor` (`node.ts:249-267`) and the emit loop build `childOrder` as the
node's children. `diffMinimal` emits `append(owner, child)` per wire in
`childOrder` order; `orderSig` (`render.ts:99-105`) derives order from
`childOrder`. A `text` child is just another wire — its position in `childOrder`
fixes its render position. So `[text, strong, text]` renders text→strong→text
deterministically, in both SSR and DOM. **No interleaving mechanism (`bodyRuns`)
needed** — ordering comes from child order, matching the user's point.

## 6. What this replaces / retires

Under XOR + `text`-child, the `bodyRuns` interleaving capability
(0.3.0/0.3.1/0.3.2, `docs/specs/eng-inline-order.md`) becomes **redundant
for the interleave case** and is deprecated-but-present (it is published API; a
consumer using it needs a migration to `text`-children). This is a **breaking** /
**published-surface** change → versioning decision (0.4.0 non-breaking-removal vs
the 1.0.0 major already flagged; the user's "unintended for support" stance makes
the content+children combination unsupported going forward).

## 7. Open questions to settle before the gate

1. **DOM shape: A1 (Text node in the wires map) or A2 (parent-owned text runs)?**
   A1 is the parity/clean choice but touches the `wires`/`appendChild` types;
   A2 mirrors the existing `bodyRuns` DOM rebuild but is a special case.
2. **Does a `text` child accept props/handlers/css?** Under "literal text only",
   NO — `text` is content-only (`props`/`css`/`handlers`/`placement` rejected).
3. **Whitespace:** should `text` content be normalized like a node's `content`, or
   preserved verbatim (important for code/pre/whitespace)? Recommend preserved.
4. **`text` + placement:** under XOR a `text` node has no `placement` (it's
   content, not a zone). Only the PARENT carries placement.
5. **`bodyRuns` retirement cadence:** remove in the same breaking change, or
   deprecate-with-warning for one minor? (Given it ships 0.3.x and is published,
   recommend deprecate-now, remove at the next major.)
6. **Back-compat rule for content+children:** the gate said it's "unintended for
   support" — so a node with BOTH `content` and `children` becomes a validation
   WARN + the children win (content dropped with a `content-with-children-deprecated`
   warning), never a throw (warn-never-throw discipline).

## 8. Suggested TDD red-set shape (once gated)

- SSR: a `text` child renders escaped text with NO `<text>` wrapper, in childOrder
  position, between element children.
- DOM: the parent's `ordered` content shows a text run + element interleaved.
- Ordering: `[text, strong, text]` ≠ `[strong, text, text]` (distinguishable).
- Content-only: `text` with `props`/`hands`/`placement` → `text-content-only` warn.
- Whitespace: `text` content preserved verbatim.
- Round-trip: `text` child translate → emit → reverse stays faithful.
- XOR: `content` + `children` → `content-with-children-deprecated` warn (not throw).

---

This is the plan. Next (on your go-ahead): a three-agent gate on Shape A vs A1/A2
+ the XOR/back-compat/versioning decisions, then TDD implementation.
