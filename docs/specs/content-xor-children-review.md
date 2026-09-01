# Content-XOR-Children Constraint — Change-Analysis Review

**Status:** **PROCEED-AS-RESHAPED (documentation + no new constraint).** The
content-XOR-children **constraint is REJECTED** — it is a breaking change that
damages the shipped 0.3.x surface and is based on a misdiagnosis. The salvageable
element is a documentation note recommending `<span>` for the trivial after-content
case, with `bodyRuns` kept (deprecated-but-present). No engine code changes.
Gate provenance: three-agent gate (AGENTS.md item 9); step 1 validity **NO**
(breaking, bodyRuns not redundant); step 2 critique **REJECT-AS-STATEMENT, minimum-
safe shape derived**; step 3 change-analysis verdict **REJECT constraint, PROCEED
on the doc note**.
Date: 2026-08-31.

---

## 1. What the proposal asks

A node cannot carry `content` (literal text) AND `children`/placement zones
concurrently. To embed text beside child nodes, place a `<span>` (or a new `text`
node type rendering only literal text) in the parent's `children[]` at the desired
position, so interleaving happens through the normal `childOrder` render. Claim:
this is an "unintended edge case" (non-breaking) and makes the `bodyRuns`
interleaving mechanism unnecessary.

## 2. The decisive technical finding — the constraint rests on a false premise

**A `<span>`/`text`-node in `children[]` cannot express mid-line interleaving.**
The default render is `escapeText(state.text) + body` (`adapters.ts:524`) — a
node's own `content` ALWAYS precedes its children. A `<span>` child can only
express text **after** the parent's content, never **between** children, and never
text-before-a-child-AND-after-it. The `Some <strong>bold</strong> text` case
(text before AND after the child — the ENG-INLINE-ORDER motivating case) is
**unexpressible via children alone**. Only `bodyRuns` fills this gap.

- Every element gets a wrapper (`adapters.ts:362-376` createEl); there is **no
  wire-less bare-text node** — a `text` type renders `<text>…</text>`, not bare text.
- A `text` node with no element boundary is exactly what `bodyRuns` provides and a
  `<span>`/`text` element structurally cannot.

## 3. The constraint is breaking, not non-breaking

Content+children and content+placement-zone coexistence is legitimate, common, and
relied on:

- `demo/feature-showcase.js:217-230` — `div` with `content` + `children`.
- `demo/legacy-shape.js:130-163` — `blind-shell` content + children; asides with
  `content` **and** `placementName`.
- `docs/rich-text-html-to-provident-tree.md:105-124` — the documented inline-
  formatting decomposition is a `p` with `content` **plus** a `strong` child.
  XOR makes this documented decomposition illegal.
- `docs/use-case-placement-native-interleave.md` — content + children + placement
  + `bodyRuns` on one node.
- EMPTY-OWNER (`render-helpers.ts` ~1388) — authored content is the non-empty
  escape hatch that keeps a placement-owner container visible; XOR forbids it.

The default render `escapeText(content) + children` is the canonical inline-
formatting contract. Enforcing XOR is a behavior change for every doc carrying both
and requires a new throw/skip path violating the warn-never-throw discipline.

## 4. bodyRuns is SHIPPED + PUBLISHED and not redundant

`bodyRuns` shipped in 0.3.0/0.3.1/0.3.2 and is published API. It cannot be removed
without a semver-major break. It expresses:
- text with **no element boundary** (not representable by a `<span>`/`text` element);
- **arbitrary interleave order** (text before AND after a child — unexpressible via
  children alone).

## 5. The misdiagnosis

The "breaking issue" the proposal targets is **not** content+children coexistence
(legal, relied-on) — it is the **complexity of `bodyRuns`** (the length-prefixed,
percent-escaped wire encoding threaded through translate/serialize/render/adapters).
The proposal conflates two distinct needs:
- **"Text beside children"** — trivial, expressible via a `<span>` in `children[]`
  (but only *after* the parent's content);
- **"Text interleaved between children"** — the ENG-INLINE-ORDER gap, only `bodyRuns`
  solves it.

## 6. Verdict — REJECT the constraint; PROCEED on the documentation note

- **REJECT** the content-XOR-children constraint (breaking; wrong diagnosis).
- **PROCEED (documentation only, no engine change):**
  1. Keep content+children legal for the default render (status quo; no change).
  2. Keep `bodyRuns` deprecated-but-present (do NOT remove; it is published API and
     the only solution to mid-line interleaving).
  3. Add a documented `<span>` recommendation for the trivial after-content case:
     "to place literal text beside child nodes, put a `<span>` in `children[]` at
     the desired position; this renders text *after* the parent's own content. For
     text *between* children (e.g. `Some <strong>bold</strong> text`), use `bodyRuns`."
  4. At most a soft warn-never-throw when `content` + `bodyRuns` both appear — but
     this is already handled (bodyRuns coexists with scalar content by design), so
     it is optional and low-value; do not add unless a real authoring-confusion
     defect is observed.
- **PARK:** a new wire-less `text` node type — requires new engine machinery (a bare-
  text render branch in `contentHtml`, a no-element `createEl` path, validation
  allow-list, treeSig/treeFromOps support) for marginal benefit over the documented
  `<span>` pattern. Revisit only if a concrete need for wire-less text (no wrapper
  element, no `bodyRuns`) emerges.

**Salvageable element:** the `<span>` best-practice documentation note. No engine
code changes.
