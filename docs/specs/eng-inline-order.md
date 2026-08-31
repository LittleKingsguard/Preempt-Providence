# Spec — ENG-INLINE-ORDER: Text/Element Interleaving (`bodyRuns` segments)

- **Status:** SPEC (implementation contract, TDD red→green pending; NOT yet built).
  Gate reference: `docs/specs/eng-inline-order-review.md` (three-agent gate, 2026-08-29,
  **PROCEED-AS-RESHAPED**, trigger fired). Consumer: the adjacent Astrographer
  project's rich-text UI renders a formatted span that precedes plain text in the
  WRONG position (after the text); this capability fixes the render ordering.
- **Date:** 2026-08-29
- **TestWriter contract:** every data shape, emit rule, render ordering, and
  fail-state below is derivable from this spec ALONE. The TestWriter writes the
  red set for the `bodyRuns` segment rendering (adapters + `minimalFromState` +
  `diffMinimal` ordering + round-trip) BEFORE any implementation, per AGENTS.md
  item 8 (red → green → verify).

---

## 1. Problem

The engine renders a compiled node's body as `escapeText(content) + children` —
the node's own text ALWAYS precedes its child elements, with NO text/element
interleaving:

- **SSR:** `SSRFragmentAdapter.contentHtml` = `escapeText(state.text) + body`
  (`src/core/adapters.ts:459`).
- **DOM:** `setProp('text')` sets `textContent` (`src/core/adapters.ts:121`),
  clobbering child elements.
- **Model:** `LegacyNodeData.children` is element-only; `content` is a single
  escaped-text blob (`src/core/render-helpers.ts:153` collapses `content` →
  one `props['text']`).

A node whose body is `Some <strong>bold</strong> text` — a formatted span BEFORE
trailing plain text — cannot be rendered faithfully: the `strong` either lands
after the text (SSR) or clobbers/replaces it (DOM). Consumer symptom: Astrographer
markdown import of `**Proposal:** Astrographer…` renders the bold label after
the content text.

## 2. Design principle (from the gate)

**NEVER change `content`'s meaning.** `content` stays the concatenated plain
text — the scalar invariant relied on by `node.ts:613` (content getter),
`node.ts:968/976` (layer merge), `derived.ts:210` (whitelisted scalar root),
`validation.ts:18`, `resolve.ts:68`, `translate.ts:327/1181`. The new ordering
is an ADDITIVE, OPT-IN field that coexists with scalar `content` and degrades a
single-text (no-interleaving) body to EXACTLY today's render (byte-identical,
no behavior change).

## 3. Data model additions

### 3.1 `BodyRun` (renamed from the gate's `BodySegment` — naming collision)

```ts
// Named `BodyRun` to avoid the already-taken `body` on HandlerDef (the handler
// function body — translate.ts:59/405/675, types.ts:349, render-helpers.ts:336).
// The gate's §4 "`body` segment list" terminology maps 1:1 to `bodyRuns`.
export type BodyRun =
  | { text: string }     // a run of plain text (escaped at the boundary)
  | { child: NodeRef }   // a child element reference, by wire
```

> **AMENDMENT (review, 2026-08-30):** the field is `bodyRuns`, NOT `body`. `body`
> is already the handler-body field on `HandlerDef` across the translate/render
> seam; reusing it for text/element segments would overload adjacent node data
> with two unrelated meanings. The `{ body: BodySegment[] }` adapter-visible
> value (§5) and the round-trip field are likewise `bodyRuns` (see §7).
> `BodyRun` is the same union, renamed.

### 3.2 `MinimalElementSource.bodyRuns` and `MinimalElement.bodyRuns` (optional)

```ts
// On MinimalElementSource (render-helpers.ts:50) and MinimalElement (render.ts:42):
bodyRuns?: BodyRun[]
```

- ABSENT (default) = today's behavior: `content` → one `props['text']` value,
  `childOrder` in array order. Zero change.
- PRESENT = the node's body is the ordered segment run. The node's concatenated
  plain text is still available as `content` (unchanged) for every scalar
  consumer.

### 3.3 Normalization rule (HARD PIN — idempotency + byte-identical default)

A `bodyRuns` that is EXACTLY one `{ text }` run MUST normalize to the existing
scalar `content` → `props['text']` path (NO `bodyRuns` emitted). `bodyRuns` is
emitted ONLY when interleaving is actually needed (≥2 runs, or ≥1 `{ child }`
run). This keeps:

- single-text paragraphs byte-identical
- `serialize`/`loadState`/`reverse` round-trips byte-identical
- all existing tests, demos, and the PAR-5/no-render-change pin untouched

## 4. Emit (`minimalFromState` + `emitOne`)

`minimalFromState` (`src/core/render-helpers.ts:142-162`):

- If `bodyRuns` is absent → current path (line 153: `if (cs.content !== undefined)
  props['text'] = cs.content`).
- If `bodyRuns` is present and length > 1 OR any run is `{ child }`:
  - Do NOT write plain `props['text']` from `content`.
  - Emit the interleaving as an ordered structure on `props['text']` so the
    adapters can render it order-aware **with ONE `set` op** (op-count parity,
    pin §6.4 — see §5 for the value shape).
  - Emit `childOrder` for every `{ child: <wire> }` run in the SAME
    document order (the appends still ride the existing `childOrder` machinery;
    ordering fidelity is preserved because the `bodyRuns` array and `childOrder`
    are co-consistent).
- The six existing `props['text']` emit points (render-helpers.ts:680, 774, 847,
  888, 898, 1117-1118, 1137, 1172, 1211, 1224, 1241) must each consult `bodyRuns`
  first and fall through to the scalar `content` path otherwise.

## 5. The ordered `text` value shape (adapter-visible)

> **AMENDMENT (review, 2026-08-30) — resolves the §5-vs-§6 contradiction.** The
> pre-amendment draft wanted to (a) store a **stable order-key string** so the
> `===` compare at `render.ts:86` does not spuriously re-`set` on every pass
> (L2), yet (b) have the DOM/SSR adapters branch on a real `{ body: BodyRun[] }`
> **object**. `RenderOp.set` carries ONE immutable `name`+`value` with no
> side-channel for a separate compare token, so the spec cannot satisfy both at
> once. **RESOLUTION: the value IS the lossless, deterministic serialization** —
> the same string is both the compared value and the adapter-renderable payload.
> The adapters parse the string back to runs (a microstep; see §10.1). This is
> the only value shape consistent with `===` identity (M1), op-count parity (M2,
> still one `set`), and byte-identical round-trip (M1).

Because `RenderOp` is a closed union (`render.ts:35-40`, `set` carries a single
`name`+`value`) and op-count parity is required, the interleaving rides the
EXISTING `text` prop name with the following value:

```ts
// The `props['text']` value (the SAME string is the diff-comparison value AND
// the adapter-renderable payload — no separate compare token exists):
type BodyTextValue = string   // plain text run (no interleaving) — UNCHANGED
                     | string // interleaving present — a RUN-ENCODED serialization (NEW)
```

- **No interleaving** (`bodyRuns` absent) → `props['text']` is the plain
  escaped `content` string (unchanged); all existing consumers/tests unaffected.
- **Interleaving** (`bodyRuns` present) → `props['text']` is the **run-encoded
  serialization string** produced by `encodeRuns(bodyRuns)`. This string is
  STABLE for an unchanged interleaving (byte-deterministic), so
  `before.props[name] !== el.props[name]` at `render.ts:86` compares equal → no
  spurious `set` on re-render (L2 resolved). ONE `set` op (op-count parity — still
  one text write + the existing child appends).

### 5.1 `encodeRuns` / `decodeRuns`

```ts
function encodeRuns(runs: BodyRun[]): string // → run-encoded serialization
function decodeRuns(s: string): BodyRun[]    // → runs (used ONLY by the adapters)
```

Encoding (deterministic, unambiguous, collision-free):
- Each run becomes an escaped token with a reserved prefix; `{ text }` and
  `{ child }` are distinguished by a stable discriminator so `[text, child]` and
  `[child, text]` (and every other ordering) serialize DIFFERENTLY.
- The `{ text }` run payload is `escapeText`-escaped BEFORE encoding; the
  `{ child }` payload is the child wire (an id — safe, M3).
- Every `text`/`child` boundary and the run type are reserved-char delimited so
  a raw text span containing the delimiter is escaped/encoded, never ambiguous.
- Ordering is fully preserved by concatenation — the signature distinguishes
  `[text, child, text]` from `[text, text, child]` (H2/PAR-5, §6.3).

Rules:
- Escape EVERY `{ text }` run through `bakeValue`/`escapeText`
  (`src/core/render-helpers.ts:80`, `adapters.ts:298-311`) — never a bare
  consumer string concatenated into `innerHTML`. Child wires carry no text (safe,
  M3).
- `decodeRuns` is the only adapter-facing decoder; it is a microstep used inside
  `setProp('text')`/`contentHtml` on the interleaving branch ONLY. The plain
  string branch never parses.

### 5.2 Why not a structure-carrying `{ bodyRuns }` object

Rejected explicitly: emitting `props['text'] = { bodyRuns: BodyRun[] }` breaks
`===` on every re-render (a fresh object each emit → spurious `set` each pass).
Caching a stable object identity across passes would require an extra cache key
inside `diffMinimal`, which `RenderOp.set` has no channel to carry — and it would
double the surface (a compared token AND a render payload). The run-encoded
string (§5.1) is the single lossless value that satisfies `===` identity, adapter
consumption, and byte-identical round-trip at once.

## 6. Render ordering

### 6.1 SSR adapter (`SSRFragmentAdapter`)

`setProp('text')` (`adapters.ts:347-348`) and `contentHtml` (`adapters.ts:457-464`):

- Plain string value → UNCHANGED (`escapeText(text) + children`).
- Run-encoded string value → `decodeRuns(val)` once into runs, then render each
  run IN ORDER: `{ text }` → `escapeText(run.text)` in position; `{ child: w }` →
  the child fragment's serialized HTML in position.

### 6.2 DOM adapter (`DomAdapter`)

`setProp('text')` (`adapters.ts:112-122`):

- Plain string value → UNCHANGED (`textContent`, includes the form-control
  branch).
- Run-encoded string value → render ORDER-AWARE: `decodeRuns(val)` into runs, then
  build the element's content as the ordered run of text (as `Text`/`textContent`
  fragments) and child elements. Each `{ child }` run corresponds to an appended
  child element (the `appendChild` op, `adapters.ts:198-204`).
- The run-encoded branch is recognized by a stable prefix / length check, so the
  plain-string branch is never misread as interleaving.

**Focus/caret pin (H3):** do NOT attempt in-place ordered text-node surgery
inside `setProp('text')` (it runs before/independent of `appendChild` in the op
stream, and `textContent` is the only text write currently). The interleaving
path is a FULL CONTENT REBUILD of the element — acceptable because interleaving
is a larger structured content change, NOT the caret-keystroke path the
`diffMinimal` unchanged-order guard protects (`render.ts:110-119`).

### 6.3 `treeFromOps`/`treeSig` order-faithfulness (H2)

- The child wires of the runs MUST also appear in `childOrder`, so
  `treeFromOps` (`render-helpers.ts:230`, edges from append ops at :255-256)
  and `treeSig` (`render-helpers.ts:275-286`) remain order-faithful.
- VERIFY (test): `[text, child, text]` and `[text, text, child]` produce
  DISTINGUISHABLE signatures (PAR-5 order pin).

### 6.4 Op-count parity (M2)

- Interleaving emits ONE `set` for text + the existing child `append`s — the SAME
  total op count as the equivalent today. No per-segment `set:0`,`set:1`…
  multiplication.
- `orderSig` (render.ts:99-105) stays linear.

## 7. Round-trip (render-only vs persistable)

`bodyRuns` must survive serialize/loadState and reverse, or the capability is
one-way. Hard pins:

- **serialize.ts:101, 148, 277** — `serializeNode`/`parseNodeState` gain the
  additive `bodyRuns` field (optional; absent = no interleaving).
- **translate.ts:1178, 1429** — `nodeToLegacy`/`baseFrom`/`reverseTranslate`
  carry `bodyRuns`.
- **A one-run or absent `bodyRuns`** normalizes to scalar `content` (no `bodyRuns`
  emitted) → byte-identical round-trip for all existing documents (M1).
- Shape validation for `bodyRuns` (`*-shape-invalid` discipline, per
  translate.ts:101-103): each entry is `{ text: string }` OR `{ child: string }`;
  a malformed entry is a deterministic warn-or-skip, never a throw.

## 8. `hideEmptyContainer` interaction (M4)

The EMPTY-OWNER logic keys on `content === undefined`
(`render-helpers.ts:1224-1231, 1254-1259`). A node with a `bodyRuns` but no scalar
`content` renders something, so the emptiness predicate MUST treat a
`bodyRuns`-present element as NON-empty. (A `bodyRuns` whose only runs are empty
text / zero children STILL renders nothing → empty.)

## 9. Markdown coverage decision (L3)

`MarkdownAdapter` has FOUR text-first ordering sites (`adapters.ts:685-697`
inlineContent, :667 renderListItem, :623 heading, :632 quote). **This spec takes
the documented-exclusion option**: the markdown adapter DOES NOT consume the
`bodyRuns` interleaving capability in this change; it continues to render
`escapeText(content) + inline children`. The MD D12 parity family (markdown
identity) is a SEPARATE pin from PAR-5 and is UNCHANGED. The exclusion is
recorded so a future markdown-interleaving need can extend the four sites
explicitly. (Astrographer's consumer need is HTML/DOM rendering, not the
markdown export adapter.)

## 10. Happy-path states (TestWriter red set — valid paths)

1. **No interleaving, no `bodyRuns`** → byte-identical to today (`props['text']` =
   string, `escapeText(text) + children`). Assert existing baselines unchanged.
2. **Single `{ text }` run** → NORMALIZES to scalar `content`; no interleaving
   emitted; render identical to a plain `content` node.
3. **`[text, child, text]`** (e.g. `Some <strong>bold</strong> text`) → SSR emits
   `Some <strong>bold</strong> text` in order; DOM renders text, bold, text in
   order.
4. **child-first `[child, text]`** (the `**Proposal:** Astrographer…` shape) →
   the bold child renders BEFORE the text, in both DOM and SSR.
5. **`[text, child]`** (trailing element) → text then element, in order.
6. **Nested interleaving** — a `{ child }` whose own child has a `bodyRuns` →
   recursion renders correctly at each level.
7. **Interleaving stable serialization (L2)** — re-emitting an unchanged
   interleaving produces the IDENTICAL `props['text']` string, so `diffMinimal`
   emits ZERO diff `set` ops (no spurious re-set).
8. **Round-trip** — a `bodyRuns` node serializes → loadState → reverse → re-emit,
   preserving the interleaved order AND the scalar `content`.
9. **`hideEmptyContainer`** — a node with `bodyRuns` (renders something) is NOT
   hidden; a truly empty body stays hidden.
10. **Empty / text-only / child-only degenerates** — `[child]` equals today's
    child-only; empty body renders nothing.
11. **`encodeRuns`/`decodeRuns` round-trip** — for every run sequence,
    `decodeRuns(encodeRuns(runs))` equals `runs` EXACTLY (order + escaped text
    preserved); ordering distinguishes `[text, child, text]` from
    `[text, text, child]` (H2).

## 11. Fail-states (TestWriter red set — documented fail-states)

1. **Malformed `bodyRuns`** — a non-array, a non-`{text}|{child}` entry, or a
   `{ child }` with a wire that does not emit → deterministic
   `bodyRuns-shape-invalid` warn-or-skip, NEVER a throw.
2. **Child wire in `bodyRuns` absent from `childOrder`** → the render must still
   be deterministic (the fragment is dropped from interleave on that pass,
   matching the existing `present`-filter in `diffMinimal`, render.ts:116).
3. **`bodyRuns` on a node that is not render-actionable** → no op, no change
   (consistent with the existing not-in-tree disposition).
4. **Undecodable interleaving value at the adapter** (a corruption that fails
   `decodeRuns`) → the adapter falls back to rendering the raw string as
   escaped text (deterministic, never a throw) — consistent with the
   `*-shape-invalid` warn-or-skip discipline.

## 12. Census / numeric claims

- New data types: 1 (`BodyRun`), plus `bodyRuns?: BodyRun[]` on 2 structs
  (`MinimalElementSource`, `MinimalElement`) + `encodeRuns`/`decodeRuns` (1 helper
  pair; decode used only by the adapters).
- New/updated emit points: `minimalFromState` (1) + the six existing
  `props['text']` sites (each `bodyRuns`-aware, scalar fall-through).
- Adapter changes: DOM `setProp('text')`, SSR `setProp('text')` +
  `contentHtml` (2 adapters).
- Round-trip sites: 2 modules (serialize.ts, translate.ts), additive field.
- Emptiness predicate: 1 (`hideEmptyContainer` / empty-owner logic).
- Op-count: interleaving emits 1 text `set` + child `append`s (no multiplication).
- Tests: new red set (happy §10 + fail §11) + the PAR-5/treeSig order-faithful
  and interleaving-stable-serialization pins. Existing suites MUST pass unchanged
  (byte-identical default).

## 13. Cross-references

- Decision record: `docs/specs/eng-inline-order-review.md` §4 (the pins this spec
  implements 1:1). Three-agent gate provenance: step-1 validity YES-WITH-
  CONSTRAINTS, step-2 critique REJECTED-AS-SHAPED→adapted, step-3 PROCEED-AS-
  RESHAPED (trigger fired 2026-08-29).
- **AMENDMENT 1 (2026-08-30):** the segment field is `bodyRuns` (`BodyRun`), NOT
  `body` — `body` is the handler-body field (`HandlerDef`). Gate §4 wording maps
  1:1 (`body` segment → `bodyRuns` run).
- **AMENDMENT 2 (2026-08-30):** the adapter-visible interleaving value is the
  run-encoded serialization STRING (§5.1), not a `{ bodyRuns }` object — a string
  alone survives the `===` compare (L2), feeds the adapters via `decodeRuns`, and
  stays byte-identical through round-trip (M1).
- Tracking: `docs/pending.md` ENG-INLINE-ORDER row (PROCEED);
  `docs/rich-text-html-to-provident-tree.md` §4/§10 (the consumer request record).
- Engine invariants relied on: scalar-`content` (node.ts:613, derived.ts:210,
  validation.ts:18), PAR-5/no-render-change default, `diffMinimal` unchanged-order
  focus guard (render.ts:110-119), EMPTY-OWNER (render-helpers.ts:1224-1259).

## 14. Gate

Per AGENTS.md item 9 the three-agent gate is COMPLETE (PROCEED-AS-RESHAPED).
**This spec is the implementation contract, written and approved (user, 2026-08-29)
for a LATER implementation pass** — it is NOT built yet. The consumer-side
Astrographer re-expression (its `RagNodeChild` model against the shipped
`bodyRuns`) is a SEPARATE change executed after this engine capability lands.
**The §5-vs-§6 design contradiction and the naming collision flagged by the 2026-08-30
Review have been resolved by AMENDMENT 1 + AMENDMENT 2; the TestWriter red set
(§10/§11) is encoded against this amended contract (run-encoded string value +
`bodyRuns` field).**
