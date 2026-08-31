# ENG-INLINE-ORDER — Text/Element Interleaving — Change-Analysis Review

**Status:** **PROCEED-AS-RESHAPED — the trigger FIRED 2026-08-29.** The
`body` segment-list capability is needed NOW: the Astrographer consumer's UI is
broken by this exact ordering gap (a formatted span preceding plain text renders
after it). Concrete consumer need confirmed (user, 2026-08-29) + this passing
gate record + user go-ahead. Implementation proceeds via the TDD trio.
**IMPL BUILT 2026-08-30 — the TDD trio returned GREEN** (`tests/unit/body-runs.test.ts`
red set → green; implementation contract `docs/specs/eng-inline-order.md`,
AMENDED 2026-08-30: field `bodyRuns`/type `BodyRun`, run-encoded string value).
**The implementation contract is `docs/specs/eng-inline-order.md`** (written
2026-08-29; TDD red→green completed 2026-08-30, full trio green: 1256 tests +
typecheck + demo:smoke, no fork-stress scaling regression).
Date: 2026-08-29.
Gate provenance: three-agent gate (AGENTS.md item 9). Step 1 validity verdict
**YES-WITH-CONSTRAINTS**; step 2 critique verdict **REJECTED-AS-SHAPED, adapted
additive body**. This step-3 change-analysis weighs both and lands the verdict.

---

## 1. Status

**PROCEED-AS-RESHAPED (trigger fired 2026-08-29).** The capability is a genuine
engine gap and is architecturally the correct home for interleaving. The
as-stated shape ("replace `content`/`children` with an ordered run") is REJECTED
as too invasive — the viable shape is a narrow additive `body` segment list
coexisting with scalar `content`. The revisit trigger has now FIRED: the
Astrographer consumer's UI is broken by this exact ordering gap (user, 2026-08-29)
— a formatted span that precedes plain text renders AFTER the text, so the
consumer has a real, non-workaround-able need. Implementation proceeds via the
TDD trio (AGENTS.md item 4).

---

## 2. What the proposal asks

The engine renders a compiled node's body as `escapeText(content) + children` —
own-text ALWAYS precedes child elements, with no text/element interleaving
(`SSRFragmentAdapter.contentHtml` = `escapeText(state.text) + body`,
`src/core/adapters.ts:459`; DOM `setProp('text')` sets `textContent`,
clobbering children, `src/core/adapters.ts:121`). `LegacyNodeData.children` is
element-only and `content` is a single escaped-text blob, so a node cannot
render text before/between/after child elements. The proposed capability is to
represent a node's body as an ORDERED RUN of segments, each a plain-text span or
a child-element reference (by wire). The consumer use case is Astrographer
markdown-import rendering `**Proposal:** Astrographer…` (a bold child element
before plain text). The legacy Preempt "text node type = raw inner text of
parent" is NOT a required outcome (user correction 2026-08-29). Recorded in
`docs/rich-text-html-to-provident-tree.md` §10 and `docs/pending.md`
ENG-INLINE-ORDER row.

---

## 3. Feasibility verdict

**YES-WITH-CONSTRAINTS** (synthesizing both agents). The root cause is accurate
and the capability is real: the seam is broad (every `props['text']` emit site
+ both adapters + diff + treeFromOps + serialize/loadState + translate
round-trip), but a NARROW ADDITIVE shape is feasible. The full "replace
`content`/`children` with an ordered run" is NOT feasible without breaching the
scalar-`content` invariant (H1), the PAR-5/treeSig order-faithfulness pin (H2),
the round-trip multi-seam scalar assumption (M1), and the fork-stress op-count
parity (M2). The viable adaptation is a first-class additive `body` segment
list that coexists with scalar `content` and degrades a single-text body to
today's render.

---

## 4. The reshaped/adapted shape

The recommended mechanism is a **narrow additive `body` segment list**, NOT a
replacement of `content`/`children` and NOT the L1 `before:`/`after:` text-slot
special case. Rationale: the segment list is one general mechanism that handles
arbitrary interleaving (not just one child before trailing text), composes for
nested interleaving, and rides the existing append-edge machinery; the
`before:`/`after:` slots are a special case that would need generalizing anyway
and do not compose. The hard pins:

1. **Additive `body` field coexisting with scalar `content` — never change
   `content`'s meaning.**
   > **AMENDMENT 1 (2026-08-30):** the field is **`bodyRuns`** (type `BodyRun`),
   > NOT `body` — `body` is already the handler-body field on `HandlerDef`
   > (translate/types/render seam). This pin's `body` wording maps 1:1 to
   > `bodyRuns` in the implementation spec. `content` stays the concatenated plain text (the
   scalar invariant consumers rely on: `node.ts:613` content getter,
   `node.ts:968/976` layer merge, `derived.ts:210`, `validation.ts:18`,
   `resolve.ts:68`, `translate.ts:327/1181`). A new optional
   `body?: Array<{ text: string } | { child: <wire> }>` carries position. A
   node with no `body` renders identically today.
2. **Single-text normalization.** A `body` of exactly one `{ text }` segment
   MUST normalize to the existing `props['text']` scalar (no `body` emitted) —
   for idempotency and byte-identical default output (M1). `minimalFromState`
   (`render-helpers.ts:153`) and the emit sites (`render-helpers.ts:680, 774,
   847, 888, 898, 1117-1118, 1137, 1172, 1211, 1224, 1242`) emit `body` only
   when interleaving is present.
3. **Append-edge emission — order-faithful PAR-5/treeSig.** Interleaved child
   positions MUST be emitted as explicit `append` edges (a text-only node
   contributes zero edges, unchanged), so `treeFromOps` (`render-helpers.ts:230`,
   edges from append ops at :255-256) and `treeSig` (`render-helpers.ts:275-286`)
   stay order-faithful. Verify `[text, child, text]` produces a distinguishable
   signature from `[text, text, child]` (H2).
4. **Stable order-key before the equality compare.** `diffMinimal` prop-equality
   is `===` (`render.ts:86`); an array/segment value fails identity on re-render
   → spurious set every pass (L2). Serialize the segment list to a stable
   order-key string before the compare.
5. **Escape-through-bakeValue.** Raw text spans MUST each run through
   `escapeText`/`bakeValue` (`adapters.ts:298-311`, `render-helpers.ts:80`).
   Segment-aware emit routes def/spec content through `bakeValue` (the existing
   emit sites at `render-helpers.ts:774/847/898/1172` already do). Child wires
   are safe (M3).
6. **hideEmptyContainer interaction.** The EMPTY-OWNER logic keys on
   `content === undefined` (`render-helpers.ts:1224-1231, 1254-1259`). A node
   with a `body` but no scalar `content` must be treated as non-empty (it
   renders something) — the emptiness predicate must consider `body` presence
   (M4).
7. **Op-count parity.** Pure text + child-in-between must collapse to the SAME
   total op count as today (still one set for the text run + appends for
   children, re-ordered); keep `orderSig` linear (`render.ts:99-105`). No
   per-segment op multiplication (M2).
8. **Markdown scope decision.** `MarkdownAdapter` has FOUR text-first ordering
   sites (`adapters.ts:685-697` inlineContent, :667 renderListItem, :623
   heading, :632 quote). Either fully support interleaving there or explicitly
   document segments-not-covered-for-markdown (L3). MD D12 parity is a separate
   pin from PAR-5.
9. **Round-trip scope.** serialize/loadState (`serialize.ts:101, 148, 277`),
   reverseTranslate/nodeToLegacy/baseFrom (`translate.ts:1178, 1429`) must
   carry `body` or the capability is one-way (render-only, non-persistable).
   A one-segment body normalizes to `props.text` scalar (no `body` emitted) for
   byte-identical round-trip (M1).

---

## 5. Gaps + costs-benefits

| Requirement | Project-specific vs engine-handoff | Cost | Benefit |
| --- | --- | --- | --- |
| Additive `body` field across LegacyNodeData / Node / MinimalElementSource / MinimalElement | Engine (framework feature, per user correction) | ~6 type sites + shape validation | General interleaving; no scalar-`content` breach |
| Emit changes at 6+ `props['text']` sites + diff/append + both adapters | Engine | Medium — the broad seam | Order-faithful render |
| Append-edge emission + order-key stability | Engine | Low — rides existing machinery | PAR-5/treeSig order-faithfulness preserved |
| serialize/loadState + translate round-trip carry | Engine | Medium — 6-site schema addition | Persistable, byte-identical default |
| hideEmptyContainer predicate update | Engine | Low | Empty-owner correctness |
| Markdown coverage (4 sites) or documented exclusion | Engine | Low-to-medium | MD D12 parity or explicit scope |
| fork-stress op-count parity | Engine | Low (must not multiply ops) | No scaling regression |
| Consumer re-expression (Astrographer traversal/RagNodeChild) | Engine-handoff | Consumer-side, deferred | Faithful `**Proposal:**` rendering |

Net: the capability is a genuine engine/foundation gap (not project-specific),
but it is a **medium-to-large engine change** touching the render seam, both
adapters, diff, round-trip, and validation — with no current consumer to pay
for it.

---

## 6. Trigger / revisit condition

**TRIGGER HAS FIRED — implementation is authorized.** A concrete consumer need
now exists: the Astrographer consumer's UI is rendered broken by this exact
ordering gap (user, 2026-08-29) — a formatted span that precedes plain text
renders AFTER it, so the consumer genuinely needs the capability and cannot
work around it host-side. Combined with this passing three-agent gate record and
the user's explicit go-ahead, the implementation proceeds as the reshaped
additive `body` segment list (§4), via the TDD trio (spec red → implement →
spec green + full validation trio, AGENTS.md item 4). This review is the
decision record and the §4 shape is the contract. The `docs/pending.md`
ENG-INLINE-ORDER row and `docs/rich-text-html-to-provident-tree.md` §10 remain
the tracking home, now marked PROCEED.

---

*Verdict is honest per the engineering-records style: the capability is real
and architecturally correct, the as-stated shape is rejected, the reshaped
shape is viable, and there is no current consumer need to justify building it.*
