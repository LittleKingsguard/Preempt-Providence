# Feature Request — Rich-Text HTML → Provident Tree Converter (SUPERSEDED / IMPLEMENTED)

- **Status:** **SUPERSEDED / IMPLEMENTED 2026-08-28.** The feature this request
  describes has been built in the consumer (the adjacent `Astrographer`
  project) under a materially different design: the converter/diff landed as
  in-repo pure modules — `sanitizePastedHtml` (`src/main/paste-sanitize.ts`,
  normalized into the `RagNodeChild[]` shape), `decomposeRichHtml`
  (`src/main/rich-decompose.ts`), plus the `children` additive store format and
  the 6→9 edit-op census (`setProps`/`setSubtree`/`setType`/`setRichText`).
  See Astrographer `docs/pending.md`: the contenteditable row (2026-08-26,
  **FEASIBLE-WITH-CONSTRAINTS**) and the editing-mode row (2026-08-28
  **PROCEED-WITH-AMENDMENTS, LANDED/COMPLETE** — Units N/O/P/Q/R/S and U1-U5,
  contenteditable is now the DEFAULT). **This record is kept as the
  proposal-of-record / superseded-by note only.** Do NOT re-open it as a
  duplicate work item.
- **Date:** 2026-08-26 (superseded 2026-08-28)
- **Origin:** the contenteditable editing proposal (focused validity check
  2026-08-26 — Astrographer `docs/pending.md`). The textarea was kept for v1;
  this converter is the missing piece that would make rich-text contenteditable
  editing feasible later — and that is exactly what 2026-08-28 delivered.
- **Consumer contract (stale — the spec files live in the ADJACENT Astrographer
  project, not here):**
  - `Astrographer/docs/specs/unit-d-editing.md` §5.1-§5.6 (the editing write-back
    path), §5.3 (back-reference map — note the MANY-TO-ONE `Map<ragNodeId,
    nodeId[]>` of §10.1), §5.1.2-§5.1.7 (the edit ops — superseded by the 6→9
    census: `setProps`/`setSubtree`/`setType`).
  - `Astrographer/docs/specs/astrographer-review.md` — the RAG→engine mapping
    (RAG text → `content`; formatting → element `type`) is **resolution 9** under
    §9.2 (item 9, amended in §10.1). There is NO `§9.2.9`; the text↔content /
    formatting↔type mapping is resolution 9, amended in §10.1.

---

## 1. What the feature asks

A **pure, deterministic converter** that takes rich-text HTML (the output of a
`contenteditable` element) and produces a **provident tree** — the RAG store's
representation: a tree of nodes, each with a plain-text `content` and an
element `type`. The converter is the "conversion back" step of a
contenteditable editing flow: on blur, the edited HTML is converted to a
provident tree, diffed against the existing subtree, and the changes are issued
as RAG-store edits (content edits for changed nodes, structural edits for
added/removed nodes).

The converter is **packaged as a separate, importable package** (a library),
not built into the Astrographer host. It must be framework-agnostic (pure
functions over plain data), so it can be imported by any consumer that uses the
provident tree model.

## 2. The provident tree model (the output shape)

The RAG store represents a document as a **tree of RAG nodes**, each with:

- `id: string` — a stable RAG node id.
- `type: string` — the element type (the formatting). The closed set the
  consumer uses: `h1`-`h6`, `p`, `ul`, `ol`, `li`, `blockquote`, `pre`, `code`,
  `strong`, `em`, `a`, `img`, `div` (structural root).
- `content: string` — the node's PLAIN TEXT (no markup). For a leaf (`p`,
  `h1`-`h6`, `li`, `strong`, `em`, `code`), this is the text. For a container
  (`ul`, `ol`, `blockquote`, `pre`, `div`), this may be empty and the children
  carry the content.
- `ownedNodeIds: string[]` — the ids of the node's owned subtree (the
  `parent-child` edges). A container's children are its owned nodes.
- `props?: Record<string, unknown>` — optional attributes (e.g. `href` for
  `a`, `src`/`alt` for `img`).

The converter's output is a **provident tree**: a root node + its owned subtree,
matching this shape. The consumer maps it to RAG nodes/edges.

## 3. The input shape

The input is **rich-text HTML** — the `innerHTML` of a `contenteditable`
element. It may contain:

- Block elements: `h1`-`h6`, `p`, `ul`, `ol`, `li`, `blockquote`, `pre`,
  `div`.
- Inline elements: `strong`/`b`, `em`/`i`, `code`, `a`, `img`, `br`.
- Nested lists (`ul` inside `li`), nested blockquotes, code blocks.
- Text nodes (plain text, possibly with inline formatting).

The HTML is **untrusted** (user-edited). The converter must handle malformed or
unexpected HTML gracefully (never throw on well-formed-but-unexpected input;
skip or coerce unknown elements deterministically).

## 4. The HTML → provident-tree mapping

| HTML element | Provident `type` | Notes |
| --- | --- | --- |
| `h1`-`h6` | `h1`-`h6` | heading; `content` = its text |
| `p` | `p` | paragraph; `content` = its text |
| `ul` | `ul` | unordered list; children = `li` |
| `ol` | `ol` | ordered list; children = `li` |
| `li` | `li` | list item; `content` = its text; may contain a nested `ul`/`ol` |
| `blockquote` | `blockquote` | quote; children = block content |
| `pre` | `pre` | preformatted; `content` = its text (preserve whitespace) |
| `code` | `code` | inline code; `content` = its text |
| `strong`/`b` | `strong` | bold; `content` = its text |
| `em`/`i` | `em` | italic; `content` = its text |
| `a` | `a` | link; `content` = its text, `props.href` = the href |
| `img` | `img` | image; `props.src`/`props.alt` |
| `br` | (inline break) | a line break within a text run — represent as a newline in the parent's `content`, or a `br` node (consumer decision) |
| `div` | `div` | structural root / generic block |
| unknown | (skip or coerce) | deterministic: skip the element but keep its text, or coerce to `p` (consumer decision) |

**Inline formatting within a block:** a `p` containing `Some <strong>bold</strong>
text` must be decomposed into a `p` node whose subtree contains a `strong` node
(`content: 'bold'`) — i.e. inline formatting becomes child nodes, NOT markup
inside `content`. The `content` field is ALWAYS plain text.

> **[ENG-INLINE-ORDER] blocking engine gap — text/element ORDER.** The above
> decomposition is only correct if the renderer can interleave text and child
> elements in document order. The engine (this repo) renders a node as
> `escapeText(content) + children` and CANNOT interleave: `adapters.ts`
> `SSRFragmentAdapter.contentHtml` emits `escapeText(state.text) + body`
> (src/core/adapters.ts:459); the DOM adapter's `setProp('text')` sets
> `textContent` (clobbering children, src/core/adapters.ts:121); `children` is
> `[]` (element-only, no text segments). So `**Proposal:** Astrographer…`
> (decomposed to `content=' Astrographer…'` + `children:[{strong:'Proposal:'}]`)
> renders the bold label AFTER the plain text. This is the OPEN handoff item
> **ENG-INLINE-ORDER** (`Astrographer/docs/HANDOFF.md`; `Astrographer/docs/
> defects.md` ENG-INLINE-ORDER) — a genuine engine/foundation gap, NOT a
> project-specific
> cost, and therefore NOT solvable by the converter alone. Until a framework
> interleaving capability exists, the decomposition above cannot round-trip
> faithfully (the request's §8 "no engine gap" verdict is WRONG on this point).
> It is fixed upstream, never patched in Astrographer host code (HANDOFF.md
> "NEVER patch the engine"; the legacy Preempt `text`-node-type shape is
> superseded and NOT a required outcome). See the fix note below.

**Nested lists:** a `li` containing a nested `ul` produces a `li` node whose
owned subtree includes the nested `ul` (and its `li` children).

## 5. The diffing step (against an existing subtree)

The converter is used in an editing flow where the existing subtree is known.
The converter must produce a **diff** between the converted tree and the
existing subtree, expressed as RAG-store edits:

- **Content edits:** a node whose `content` changed → `edit.set_content`.
- **Structural edits:** a node added → `edit.create_node` (+ a `parent-child`
  edge); a node removed → `edit.delete_node` (+ cascade its edges); a node
  re-parented → `edit.set_edge` (retarget).

The diff must be **minimal** (only changed nodes) and **deterministic**. The
reconciliation key is the node's stable `id` (or, for a newly-created node, a
fresh id). The consumer decides whether the diff is applied as a batch or
incrementally.

## 6. Edge cases (must be specified)

1. **Nested lists** — `ul`/`ol` inside `li`; arbitrary depth.
2. **Code blocks** — `pre`/`code` with preserved whitespace and no inline
   decomposition.
3. **Inline formatting** — `strong`/`em`/`code`/`a` inside a block; adjacent
   inline runs; inline formatting spanning multiple text nodes.
4. **Images** — `img` with `src`/`alt`; an image as a block vs. inline.
5. **Links** — `a` with `href`; a link wrapping inline formatting.
6. **Empty elements** — an empty `p`/`li` (keep or drop — consumer decision).
7. **Malformed HTML** — unclosed tags, unknown elements, stray text — must be
   handled deterministically (never throw).
8. **Whitespace** — leading/trailing whitespace, multiple spaces, `&nbsp;`,
   newlines — normalized deterministically.
9. **Round-trip stability** — converting a provident tree to HTML and back must
   be stable (idempotent) for well-formed input.

## 7. Packaging requirements

- A **separate, importable package** (npm package), framework-agnostic (pure
  functions over plain data; no Electron, no DOM dependency in the core — the
  HTML parsing may use a DOM parser, but the core conversion is pure).
- **TypeScript** with published types.
- **Deterministic and testable** — the conversion + diff must be pure functions
  with exhaustive tests (the consumer's TestWriter contract).
- **No network egress** — local-first, no external calls.
- The consumer (Astrographer) imports it and wires it into the editing
  write-back path (`docs/specs/unit-d-editing.md` §5.1).

> **SHIPPED SHAPE (differs):** the converter/diff was NOT packaged as a
> separate importable npm package. It landed as **in-repo pure modules** in the
> consumer (`Astrographer/src/main/paste-sanitize.ts`,
> `src/main/rich-decompose.ts`), consumed by the host's traversal/edit path
> directly. The "framework-agnostic, pure functions over plain data, no DOM in
> the core" constraint was honored; the separate-package constraint was not
> followed (revisited and dropped 2026-08-28 in favor of in-repo modules).

## 8. Feasibility verdict

> **SUPERSEDED — the verdict was PARTIALLY WRONG.** The converter/diff is
> feasible and WAS built (host-side DOM parsing + the RAG store + the `edit.*`
> ops — now expanded to the 6→9 op census). BUT the claim "no engine gap" is
> wrong for the **inline-interleaving** requirement: **ENG-INLINE-ORDER** is a
> genuine engine/foundation gap (text always precedes children; no interleaving;
> `children` is element-only). The converter cannot produce faithful inline
> output until the framework gains a text/element interleaving capability.

## 9. Revisit condition

> **SUPERSEDED / LANDED 2026-08-28** — the revisit condition FIRED. Rich-text
> contenteditable editing WAS pursued (Astrographer `docs/pending.md` editing
> mode row): the textarea-only v1 shipped first (Unit L), then the rich-text
> machinery (Units N/O/P/Q/R/S + U1-U5; contenteditable flipped to DEFAULT in
> commit `1af5000`). The converter (this request) is the component that made
> it feasible. **Open residual — ENG-INLINE-ORDER:** if/when a consumer needs
> a formatted span to precede plain text in document order (the `**Proposal:**`
> shape), return to the engine fix (§10). The legacy Preempt `text`-node-type
> shape is superseded and NOT a required outcome.

---

## 10. Fix note — the ENG-INLINE-ORDER engine capability

This section records the shape the engine fix will take. **Three-agent gate
COMPLETE 2026-08-29 → PROCEED-AS-RESHAPED** (`docs/specs/eng-inline-order-review.md`):
the trigger fired because the Astrographer consumer's UI renders this exact
ordering incorrectly (a formatted span preceding plain text renders after it).
ENG-INLINE-ORDER is the item blocking this request's §4 decomposition.

### 10.0 Approved shape (from the gate)

An **additive `body ?: Array<{text}|{child}>`** segment-list field coexisting
with scalar `content`; single-text normalizes to today's `props['text']`;
interleaved child positions emitted as `append` edges; a stable order-key
before the diff compare; escape-through-bakeValue; hideEmptyContainer treats
`body`-present as non-empty; op-count parity; explicit markdown coverage
decision; round-trip scope. Full contract + pins: `docs/specs/eng-inline-order-review.md` §4.
Implementation proceeds via the TDD trio (AGENTS.md item 4). **AMENDED
2026-08-30 (review): the implementation spec names the segment field `bodyRuns`
(type `BodyRun`) and the adapter-visible value is a run-encoded string (§5.1).
`body`/"`body` segment" here maps 1:1 to `bodyRuns`/"`BodyRun` run".**

### 10.1 Grounded root cause (engine source)

- **SSR:** `contentHtml` = `escapeText(state.text) + body` —
  `src/core/adapters.ts:459`. The node's own text ALWAYS precedes its child
  elements, no interleaving.
- **DOM:** `setProp(wire,'text')` sets `textContent`
  (`src/core/adapters.ts:121`), which replaces the element's child nodes — so an
  element that has BOTH an authored `text` prop and child elements cannot
  express text-before-children at all (the text clobbers the children).
- **Data model:** a `MinimalElement` carries `text` (via `props.text`) +
  `childOrder: string[]` (`src/core/render-helpers.ts:158`) — element-order only,
  no text-segment positions. `LegacyNodeData.children` is `[]` (elements only).
- The emit side (`emitElements` → `render-helpers.ts`) and `treeFromOps`/SSR
  both assume one text blob per node + N children.

### 10.2 Required capability — text/element interleaving

The model must represent, for a node, a single ordered run of segments where a
segment is EITHER plain text OR a child element (by wire). Concretely, the
`content`/`children` split must carry position, e.g.:

- **Data:** a node's body = an ordered list of `{ text }` and `{ child: <wire> }`
  entries (text segments + child-element references in document order), replacing
  the "one `content` string that always precedes `children`" assumption.
- **Emit:** `emitOne` (render-helpers) and the `diffMinimal`/append ordering
  (render.ts) must honor that interleaved order instead of `text` + ordered
  children.
- **Adapters:** DOM `setProp('text')` must not `textContent`-clobber children
  (append text in place / order-aware); SSR `contentHtml` must render segments
  in order, not `escapeText` + children.

### 10.3 The legacy `text` node-type is the DEAD path

The original Preempt build's "`text` node type that could not contain child
links and rendered to plain inner text of the parent" is **superseded and not a
required outcome** (user correction 2026-08-29). It is NOT this proposal. The
interleaving capability must be a general framework feature, not a special-cased
`text` element whose raw text is spliced into the parent's inner HTML by the host.

### 10.4 Gate

Per AGENTS.md item 9, any pursuit of this fix goes through the three-agent gate
(validity → critique → change-analysis) before any spec/code work, and follows
the TDD trio (spec red → implement → spec green + full validation trio in item
4). **The gate is COMPLETE (2026-08-29, PROCEED-AS-RESHAPED — see §10.0), and
the capability is BUILT (2026-08-30 — TDD trio green: `tests/unit/body-runs.test.ts`
25 tests; `npm test` 1256 + typecheck + demo:smoke; field `bodyRuns`/type `BodyRun`,
run-encoded string value).**
Implementation landed via the TDD trio (2026-08-30), shipping the `bodyRuns`
segment-list capability. The consumer side (Astrographer) will then re-express its
traversal/`RagNodeChild` model against the shipped capability to fix its inline
ordering.
