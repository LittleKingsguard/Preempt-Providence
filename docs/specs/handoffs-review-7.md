# Feature 2 — Simplified output document surface (a `MarkdownAdapter`) — three-agent gate, step 3 (change-analysis)

Date: 2026-08-24. Source: `docs/next-feature-batch-0.2.0.md` §Feature 2 +
§User rulings 12-16 (2026-08-24). Companion context: `docs/specs/adapters.md`
(the concrete-adapter family + §5 lib decision), `docs/specs/render.md` §2/§3
(the abstract `RenderAdapter` + op vocabulary), `docs/specs/contract.md` (the
export table + `renderProducingProcess`), `src/core/adapters.ts` (the
`DomAdapter`/`SSRFragmentAdapter` reference shapes), `src/core/render.ts`
(the abstract interface), `src/core/render-helpers.ts` (`applyOps` +
`renderProducingProcess`), `tests/e2e/markdown-html-validity.test.ts`,
`tests/unit/adapters.test.ts`, `demo/mode-toggle.*` +
`scripts/mode-toggle-page.mjs` + `scripts/demo-smoke.mjs`.

Steps 1 (validity — V1-V12) and 2 (critique — C1-C18) ran before this pass;
the step-3 verdict lands here in the compile-horizon-review format. This agent
is READ-ONLY — no files edited except this verdict. The six user rulings
(12-16) are FIXED and not relitigated; D1-D15 pin the mechanics the rulings
left open.

## Step 1 — Validity agent (summary)

Verdict: FEASIBLE-WITH-RESHAPE. F1 must-fix (`toString` is not on the abstract
`RenderAdapter` — it is a concrete-family method; `hydrate` is required on the
abstract interface and was omitted); F2 ok (a per-wire persistent
`fragments`/`wires` map is required for cross-batch ops — `applyOps` resolves
append/remove against it, render-helpers.ts:190); F3 ok (the `styles` op is
auto-skipped when the adapter exposes no `styles` — `fk.styles?.()`,
render-helpers.ts:222); F6 must-fix (the type→marker table — headings/lists/
emphasis/links — parent-based list markers, indentation must be pinned); F7
(link without href + title); F8 (createEl type authoritative over prop:type);
F9 (element-type emphasis over css.style parsing; classes dropped/enumerated);
F10 (`on:*` + `data:*` drop); F11 (markdown metacharacter escaping policy).

## Step 2 — Critique agent (summary)

Verdict: NEEDS-RESHAPE. C1/F1 (toString/hydrate spec wording); C2/F2 (persistent
map name `wires` vs `fragments`); C3/F6-F9 (type→marker table + unknown-type
fallback); C4/F7 (bare `a` without href, title tooltip); C5 (the markdown
adapter is a NEW parity family, NOT a PAR-5 extension — lossy output can't
satisfy cross-surface equality); C5b (drop BOTH `on:*` AND `data:*` incl.
`data:node-id` even when `renderOptions.nodeIdAttribute` was passed); C6
(css:classes/css:style — dropped or enumerated); C7 (appendChild move-semantics
for D5 reorders — must splice by identity, not blind-push); C8 (removeEl must
DETACH, not just drop the map — the DEFECT-SSR-REMOVE shape); C9 (re-render
accumulation — the retained per-wire map must be the sole toString source);
C10 must-fix (adapter switch on the same prevMap → empty output — must pin
prevMap ownership or instance-bind); C11 (text-that-is-markdown escaping trap);
C13 (ol numbering from sibling position + nested-block-in-list rendering); C14
(empty document / empty node output); C15 (hydrate no-op + §2 table row); C16
must-fix (barrel src/index.ts re-export + contract.md export table + a module
that compiles WITHOUT the "DOM" lib); C17 (demo + blind-test + smoke wiring;
the `?mode=markdown` fixture relationship); C18 (carrier-agnostic is a seam
property, not an adapter property).

## Step 3 — Change-analysis agent (verdict)

Status: **PROCEED-AS-RESHAPED** — the proposal and the six user rulings are
sound and implementable, but the executor must land with the reshaped shape
below. Every must-fix and every open question resolves to a concrete decision
(§Feasibility verdict, decisions D1-D15). The two largest reshapes: **(D12) the
markdown adapter is a NEW parity family, NOT a PAR-5 extension** — its output
is lossy by design (ruling 15/16: non-interactive text, no element→node
mapping), so it can never satisfy cross-surface structural equality with
DOM/SSR; the only parity pin is a deterministic round-trip/identity pin on
the adapter itself. And **(D10) the adapter-switch prevMap rule** — the
prevMap is caller-owned per `renderProducingProcess`; a host switching adapters
must pass a fresh/null prevMap, never a prevMap built for a different adapter
(else silent empty output). All six user rulings stand unmodified as the fixed
contract; D1-D15 pin the mechanics the rulings left open.

### What the proposal asks

A new concrete render adapter, `MarkdownAdapter`, in the
DomAdapter/SSRFragmentAdapter family (ruling 13) that consumes the same
`RenderOp` stream and emits **markdown text** instead of HTML — delivered on
request via the existing `renderProducingProcess(…, adapter)` seam (ruling 14),
accepting actionable states from any carrier (ruling 12), dropping `on:*` and
`data:*` (rulings 15/16) so the output is non-interactive text-only with no
element→node mapping.

### Feasibility verdict — the MarkdownAdapter contract as decided (all 15 decisions)

**The interface shape (D1).** `toString` is NOT on the abstract `RenderAdapter`
(render.ts:138-144 — it has `createEl`/`setProp`/`appendChild`/`hydrate`/
`removeEl?` only). `toString` is a **concrete-family method** shared by the two
string-producing adapters (SSRFragmentAdapter has it, adapters.ts:423;
DomAdapter does not). `hydrate` IS required on the abstract interface, so
`MarkdownAdapter.hydrate` is a **required no-op** (mirroring
SSRFragmentAdapter.hydrate, adapters.ts:421). `styles` is NOT on the abstract
interface and is optional at the boundary (`applyOps` calls `fk.styles?.()`,
render-helpers.ts:222) — `MarkdownAdapter` does **not** implement `styles`
(markdown has no CSS), so the `styles` op is auto-skipped. The abstract
`RenderAdapter` is **untouched**. Signature:
`class MarkdownAdapter implements RenderAdapter<MarkdownNode, string>` with
`toString(): string`, `hydrate` no-op, no `styles`.

**The persistent map name + the sole-toString-source rule (D2).** The DOM
family names its persistent map `wires`; the SSR text family names it
`fragments`. `applyOps` reads `fk.wires ?? fk.fragments` (render-helpers.ts:190)
— either name works. Decision: name it **`fragments`** (the markdown adapter is
a string-producing sibling of SSRFragmentAdapter, so it shares the text-family
name). **Sole-toString-source rule (C9):** `toString()` reads ONLY the retained
per-wire `fragments` map — it never re-derives from a fresh op stream, never
accumulates across renders. The map is instance-bound (D10).

**The type→marker table + the fallback (D3).** A CLOSED set of marker types,
pinned:

| Element type | Markdown marker |
| --- | --- |
| `h1`..`h6` | `#`×n + space prefix |
| `ul` | list container (parent-based marker, D4) |
| `ol` | ordered list container (sibling-index numbering, D4) |
| `li` | list item (marker from the parent, D4) |
| `strong` / `b` | `**text**` |
| `em` / `i` | `*text*` |
| `a` | `[text](href)` (D6) |
| `blockquote` | `> ` prefix per line |
| `code` | inline backtick; `pre` → fenced block |
| `hr` | `---` |
| `br` | line break |
| `img` | `![alt](src)` |
| `p` | paragraph (blank-line separated) |

**Fallback for `div`/`span`/`section`/`article`/`p`-as-container (C3):** a
block container with no marker is a **transparent container** — its children
are emitted inline (joined), no marker prefix, no wrapping. This is the
unknown-type fallback too: any element type not in the table renders as a
transparent container (children inline). `createEl`'s `type` is authoritative
over any `prop:type` (F8) — the marker is chosen from the element type alone.

**Parent-based list markers + nesting + nested-block-in-list (D4).** `ul` →
each `li` prefixed `- `; `ol` → each `li` prefixed by its **sibling position**
(`1. `, `2. `, … — the index is the li's position among its siblings in the
parent's childOrder, C13). Nesting: a nested list indents **2 spaces per
level**. **Nested-block-in-list (C13):** a block element (`p`, `div`, another
list) inside an `li` renders its content **inline within the list item** — no
blank-line break that would split the list into separate lists. The `li`'s
content is the concatenation of its children's inline text.

**Emphasis source (D5).** Emphasis is derived from the **element type**
(`strong`/`b` → bold, `em`/`i` → italic), **never** from parsing `css.style`
(F9). `css:classes` and `css:style` are **dropped** (not enumerated, not
parsed) — the markdown output carries no class/style information (C6). Only
`css:id` is ignored too (no element→node mapping, ruling 16).

**Link rendering (D6).** `a` with a non-empty `href` → `[text](href)`; with a
`title` prop → `[text](href "title")`. `a` **without** an `href`, or with an
**empty** `href` → render the text only (bare text, no link syntax — C4/F7).
`href` escaping: escape `)` and `\` in the URL (markdown link-destination
escaping); the title escapes `"` and `\`.

**`on:*` + `data:*` drop (D7).** Both namespaces are **dropped entirely** (C5b,
rulings 15/16). `on:*` handler props are never emitted. `data:*` props are never
emitted — **including `data:node-id` even when `renderOptions.nodeIdAttribute`
was passed** to `emitElements` (the opt-in traceability attribute stays
DOM/SSR-only; the markdown adapter ignores it). The adapter's `setProp` treats
any `on:*`/`data:*` name as a no-op.

**appendChild move-semantics + removeEl DETACH (D8).** `appendChild` must
**splice by identity** (C7): if the child is already in the owner's children
list, remove it first, then push — so a D5 reorder relocates the child to its
new position (mirroring DomAdapter.appendChild, adapters.ts:198-204). `removeEl`
must **DETACH** (C8): resolve the node, splice it out of its parent's children
by identity, purge it from the append-only created list, drop it from the
`fragments` map, and rematerialize the parent — the DEFECT-SSR-REMOVE shape
(adapters.ts:395-419). A removed element leaves the markdown output entirely.

**The escaping policy (D9).** The exact rule (C11/F11): **adapter-emitted
markers are never escaped**; **content metacharacters are escaped only where
they would be interpreted as markdown**. Concretely:
- At a **line-leading** position (first non-whitespace char of a line), escape
  `#`, `>`, `-`, `*`, `+`, and a digit-run followed by `.` (would start a
  heading/blockquote/list/ordered-list).
- **Inline**, escape `*`, `_`, `` ` ``, `[`, `]`, `\` when they would pair into
  emphasis/link/code syntax adjacent to the emitted markers.
- The adapter's own emitted `- `, `# `, `**`, `[text](href)` markers are emitted
  verbatim, never escaped.
This is the "text-that-is-markdown stays text" rule: a content string that
happens to look like markdown is escaped so it renders as literal text.

**Adapter-switch prevMap ownership (D10).** The prevMap is **caller-owned** per
`renderProducingProcess` (render-helpers.ts:363-378 — the caller passes `null`
on first render; the loop keeps no module-level render state). The rule: a
`MarkdownAdapter` instance is **bound to its own persistent `fragments` map**;
a host switching adapters must pass a **fresh/null prevMap** (or a fresh
instance) — **never** a prevMap built for a different adapter, which would
diff against a foreign baseline and produce silent empty output (C10). "Switch
= null prevMap" is the pinned contract; the adapter never silently empties on
a foreign prevMap — the host owns the baseline.

**Empty document / empty node output (D11).** An empty document (no `createEl`
ever ran) → `toString()` returns `''` (empty string). An empty node (a
container with no children and no text) → renders as **nothing** (no marker, no
blank line). A node with only whitespace text → renders the text.

**The parity family (D12).** The markdown adapter is a **NEW parity family**,
NOT a PAR-5 extension (C5). Its output is lossy by design (rulings 15/16:
non-interactive, no element→node mapping, no classes/styles), so it can never
satisfy cross-surface structural equality with DOM/SSR. The parity pin is a
**round-trip/identity pin**: the same op stream through the same
`MarkdownAdapter` instance produces **identical markdown** (deterministic,
stable under re-render). No PAR-5 structural equality with DOM/SSR is claimed
or tested.

**The barrel/contract/tsconfig landing (D13).** Add `MarkdownAdapter` to the
`src/index.ts` barrel (line 41, alongside `DomAdapter`/`SSRFragmentAdapter`);
add a `contract.md` export-table row (line 24) for the new export. The
`MarkdownAdapter` module must compile **without the "DOM" lib** (C16): it
touches no DOM globals — it is a pure string producer. The repo tsconfig is
repo-global `["ES2022", "DOM"]` (tsconfig.json:6), so this is a **portability
guarantee**: the markdown adapter's own code references no DOM types and would
compile under a non-DOM lib. It lives in `adapters.ts` (the concrete-adapter
family) but is DOM-free.

**The demo + smoke + blind-test landing (D14).** The `?mode=markdown` fixture
relationship (C17): the current mode-toggle "markdown mode" embeds the **raw
markdown editor source** + a live DOM display (mode-toggle.template.html:87-100,
mode-toggle-page.mjs:59-66) — it does NOT render through a MarkdownAdapter. The
demo must gain a **MarkdownAdapter arm** that actually renders the
feature-matrix document through the adapter and displays the emitted markdown
text. The raw-source fixture stays a demo; the adapter is the production shape.
Smoke wiring: add a mode-toggle markdown-adapter check to
`scripts/demo-smoke.mjs` (the mode loop at :97-103). The demo page + the
blind-test loop run on the **Mimo-2.5 model** per AGENTS.md item 10.

**The carrier-agnostic clause (D15).** Re-framed as a **renderer/seam
property**, not an adapter property (C18). The `MarkdownAdapter` is a pure
consumer of the op stream (adapters.md §1 — it holds no compiled-state
knowledge, never runs compile, never reads anchors). Carrier-agnosticism is a
property of the `renderProducingProcess` seam, which accepts actionable states
from any carrier (legacy envelope / translated graph / serialized doc) and
feeds the same op stream to any adapter. The adapter is carrier-agnostic **by
construction** (pure consumer); the claim is documented at the seam, not on the
adapter.

### Gaps + costs-benefits

**What the feature does NOT promise (the residual list, §Contract wording):**
1. **Cross-surface parity with DOM/SSR** (D12) — the markdown output is lossy;
   no PAR-5 structural equality, no element→node mapping, no classes/styles.
2. **Interactivity** (ruling 15) — `on:*` handlers are dropped; the output is
   non-interactive text only.
3. **Traceability** (ruling 16) — no `data:node-id` in the markdown output; the
   host-side element→node index stays on the DOM/SSR surfaces.
4. **CSS fidelity** (D5/C6) — classes and styles are dropped; emphasis comes
   from element type only, never from `css.style` parsing.
5. **Full markdown coverage** — the type→marker table is a CLOSED set (D3);
   element types outside it render as transparent containers. No tables, no
   task lists, no footnotes.
6. **Carrier-agnosticism as an adapter property** (D15) — it is a seam property;
   the adapter is a pure consumer.
7. **A `styles` channel** — the markdown adapter implements no `styles`; the
   `styles` op is auto-skipped (D1).
8. **prevMap reuse across adapters** (D10) — a host switching adapters must pass
   a fresh/null prevMap; reusing a foreign prevMap is a host error (silent
   empty output).

**Costs:** a new concrete adapter (~the SSRFragmentAdapter shape) + the
type→marker table + the escaping policy + the D4 list/nesting logic; the
barrel + contract.md + adapters.md § additions; the demo arm + smoke wiring +
the Mimo-2.5 blind-test loop.

**Benefits:** a text-only, agentic-consumer-friendly document surface produced
by the SAME op stream and the SAME `renderProducingProcess` seam as DOM/SSR —
no new pipeline, no new carrier handling, no embed-everything pattern (ruling
14); deterministic, round-trip-stable output (D12); the adapter is a pure
consumer (D15) so it composes with every existing host.

### Contract (the implementation must satisfy)

1. `MarkdownAdapter implements RenderAdapter<MarkdownNode, string>` in
   `src/core/adapters.ts` (D1): `createEl`/`setProp`/`appendChild`/`removeEl`/
   `hydrate` (no-op)/`toString`; no `styles`; persistent `fragments` map (D2).
2. The type→marker table (D3) + the transparent-container fallback; `createEl`
   type authoritative over `prop:type` (F8).
3. Parent-based list markers + 2-space nesting + nested-block-in-list inline
   rendering (D4); `ol` numbering from sibling position (C13).
4. Emphasis from element type only; classes/styles dropped (D5/C6).
5. Link rendering: `[text](href)`, `[text](href "title")`, bare-text for
   missing/empty href, href/title escaping (D6).
6. `on:*` + `data:*` (incl. `data:node-id`) dropped (D7).
7. `appendChild` splice-by-identity move semantics + `removeEl` DETACH (the
   DEFECT-SSR-REMOVE shape) (D8).
8. The escaping policy: adapter markers unescaped; content metacharacters
   escaped at line-leading + inline-pairing positions (D9).
9. prevMap ownership: instance-bound map; host passes fresh/null prevMap on
   adapter switch (D10).
10. Empty document → `''`; empty node → nothing (D11).
11. Round-trip/identity pin: same op stream → same markdown; NO PAR-5
    cross-surface equality (D12).
12. Barrel `src/index.ts` + `contract.md` export-table row; the adapter module
    compiles without the "DOM" lib (D13).
13. Demo MarkdownAdapter arm + smoke wiring + Mimo-2.5 blind-test loop (D14).
14. Carrier-agnosticism documented as a seam property (D15).

### TDD list (the red set — `tests/unit/markdown-adapter.test.ts`, a NEW file)

Red (all fail before implementation):
1. **Interface shape (D1)** — `MarkdownAdapter` implements `RenderAdapter`;
   `hydrate` is a no-op; `toString` returns markdown; no `styles` method (a
   `styles` op through `applyOps` is skipped, no throw).
2. **Persistent map (D2)** — cross-batch `setProp`/`append`/`remove` resolve
   against the retained `fragments` map; `toString` reads ONLY the map (a
   re-render with no new ops returns the same output — no accumulation, C9).
3. **Type→marker table (D3)** — h1..h6 → `#`×n; strong/b → `**…**`; em/i →
   `*…*`; blockquote → `> `; code → backtick; pre → fenced; hr → `---`; br →
   line break; img → `![alt](src)`.
4. **Transparent-container fallback (D3)** — div/span/section/article and any
   unknown type render children inline, no marker, no wrapping.
5. **createEl type authoritative (F8)** — a `prop:type` set does not change the
   marker chosen from the element type.
6. **Parent-based list markers (D4)** — ul → `- ` per li; ol → `1. `, `2. `…
   from sibling position (C13).
7. **Nesting + nested-block-in-list (D4/C13)** — a nested list indents 2 spaces
   per level; a block element inside an li renders inline (no list split).
8. **Emphasis from element type (D5/C6)** — strong/em from type; `css:style`
   and `css:classes` are dropped (never parsed, never enumerated).
9. **Link rendering (D6)** — `[text](href)`; `[text](href "title")`; bare text
   for missing/empty href; href escapes `)`/`\`; title escapes `"`/`\`.
10. **`on:*` + `data:*` drop (D7)** — `on:click` and `data:node-id` (even when
    `renderOptions.nodeIdAttribute` was passed) produce no markdown.
11. **appendChild move-semantics (D8/C7)** — a D5 reorder relocates the child
    by identity (splice, not blind-push).
12. **removeEl DETACH (D8/C8)** — a removed element leaves the output entirely
    (spliced from parent, purged from created, dropped from the map).
13. **Escaping policy (D9/C11)** — content metacharacters escaped at
    line-leading + inline-pairing positions; adapter-emitted markers unescaped;
    text-that-is-markdown stays text.
14. **Empty document / empty node (D11/C14)** — no createEl → `''`; empty
    container → nothing; whitespace-only text renders.
15. **Round-trip/identity (D12/C5)** — the same op stream through the same
    instance produces identical markdown; NO PAR-5 structural equality with
    DOM/SSR is asserted.
16. **prevMap ownership (D10/C10)** — a fresh instance + null prevMap renders
    correctly; a foreign prevMap is a host error (never silent empty on a
    correct host).
17. **Barrel + contract (D13/C16)** — `MarkdownAdapter` is exported from
    `src/index.ts`; the module compiles without the "DOM" lib (no DOM globals
    referenced).
18. **Regression greens** — the existing adapters.test.ts DOM-*/FRG-* blocks,
    markdown-html-validity.test.ts, ssr-render.test.ts, the trio.

Green: implement `MarkdownAdapter` + the barrel/contract/adapters.md § edits +
the demo arm + smoke wiring; verify `npm test`, `npm run typecheck`,
`npm run demo:smoke` (incl. the profile watches + the
`[derived-fork:baseline]`/`[derived-fork:pin]` totals), `npm run build`.

### Notes for the implementer

- The markdown adapter is a pure consumer (adapters.md §1) — it holds no
  compiled-state knowledge, never runs compile, never reads anchors. Its
  `fragments` map is derived/replayable state, a pure function of the op
  stream (like `wires`/`stylesSeen`/`batchEls`).
- The `ol` numbering reads the li's sibling position in the parent's
  childOrder — the adapter must track child order in its own state (the
  `appendChild` splice keeps it current).
- The escaping policy is the trickiest part — pin it with the C11
  "text-that-is-markdown stays text" tests before the marker table.
- The demo MarkdownAdapter arm + the blind-test loop go through the AGENTS.md
  item-10 loop on the **Mimo-2.5 model** (writer / proofreader / page-reviewer)
  before completion.

### Trackers (same pass as the landing)

- `docs/specs/adapters.md` — the new §MarkdownAdapter (contract, ops mapping,
  the type→marker table, the escaping policy, the D12 parity-family letter).
- `docs/specs/contract.md` — the export-table row (line 24) + the
  `## src/core/adapters.ts` signature block.
- `docs/specs/render.md` §2 — the method-semantics table gains the markdown
  adapter row (toString concrete-family, hydrate no-op, styles n/a).
- `docs/next-feature-batch-0.2.0.md` §Feature 2 (gate verdict + the executor
  shape + D1-D15 pinned).
- `docs/decisions.md` — the MarkdownAdapter decision row (D1-D15).
- `docs/defects.md` — none new; the review findings are verdict notes.
- `docs/pending.md` — the Feature 2 speculative row flips to PLANNED/landed-shape.
- `docs/next-steps.md` — the work-queue entry for the Feature 2 TDD pass.
- `docs/skills/designing-pages.md` §11 coverage matrix + §12 demo pages (the
  mode-toggle MarkdownAdapter arm) per AGENTS.md item 3.
