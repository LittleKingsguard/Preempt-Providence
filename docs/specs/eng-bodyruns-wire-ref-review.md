# ENG-BODYRUNS-WIRE-REF — Change-Analysis Review

**Status:** **PROCEEDED-FROM-PARK + LANDED 2026-08-31.** The gate initially PARKED
(2026-08-31) the authored-id child-ref seam, recording the §3 emit-boundary shape
as the approved contract for a future need. The user UNPARKED it the same day as
a **0.3.1 DEFECT PATCH** ("this will be an issue for future projects beyond just
astrographer"): the engine capability shipped in 0.3.0 was correct but unusable
from the data-authoring side the feature was built for. The §3 shape was then
implemented via the TDD trio (tests/unit/bodyruns-wire-ref.test.ts, 5 tests) and
**LANDED — trio green 2026-08-31** (see §7). Gate provenance: three-agent gate
(AGENTS.md item 9): step 1 validity **YES-WITH-CONSTRAINTS**; step 2 critique
**REJECTED-AS-STATED**, third shape derived; step 3 change-analysis verdict
**PARK** (→ UNPARKED by the user).
Date: 2026-08-31.

---

## 1. What the proposal asks

The `bodyRuns` text/element interleaving capability shipped in 0.3.0 (field
`bodyRuns`, type `BodyRun = {text}|{child}`, run-encoded `props['text']` via
`encodeRuns`/`decodeRuns`). A legacy-envelope author can only reference a child
run `{ child: <wire> }` by its **minted wire** (`root/<zone>/<node-X>`), but that
wire is unpredictable at authoring time (`mintNodeId()` is a global monotonic
counter, node.ts:42-45; path-state wires are compile-time `pathKey`s via
`pathWireOf`, render-helpers.ts:138-140). The author knows only the child's
authored `props.id` (e.g. `inline-0`); a `{ child: 'inline-0' }` reference
DROPS the run (the adapter's `wires.get`/`fragments.get` miss).

Proposed remedy shapes evaluated:
1. **Translate-side rewrite** — `translateLegacy` rewrites `bodyRuns[].child`
   from authored id → minted wire.
2. **Adapter-side fallback** — DOM/SSR adapters resolve `{ child: <authored id> }`
   by a child element's `props.id` when the wire lookup misses.

## 2. Feasibility verdict

**Both proposed shapes are unsafe.**

- **Shape 1 (translate rewrite) — REJECTED.** `baseFrom` builds `base.bodyRuns`
  at translate.ts:334-344, *before* children translate at translate.ts:1048-1068 —
  a forward reference requiring a second pass. `nodeToLegacy` ships
  `base.bodyRuns` verbatim (translate.ts:1199), so a minted-wire rewrite leaks
  into the reverse JSON → `json-out ≠ json-in`, breaking idempotency. Path-state
  children are minted at compile time (`mintPathState`, node.ts:1376) — the wire
  is unknowable at translate. Shape 1 cannot serve path-states and violates the
  authored/minted boundary.
- **Shape 2 (adapter fallback) — REJECTED.** The DOM interleaving branch is a
  full rebuild (adapters.ts:120-138) and SSR `contentHtml` iterates runs
  (adapters.ts:507-525); a `props.id` fallback scans the wires map, which is
  keyed by WIRE not `props.id` (adapters.ts:135, 517) → O(n) per child run →
  O(n²) per rebuild — the exact class DEFECT #22/`findElScanCount` guards. The
  rendered id is `css.id > props.id > mint`, so there is no reliable authored-id
  source. Duplicate authored ids are explicitly permitted (RESULTS.md:182), so a
  fallback is non-deterministic → silent WRONG-child.

## 3. The reshaped contract (approved shape — recorded for the revisit)

**Emit-boundary translation over the node's own childOrder; `base` stays
authored.** The critique's third shape, verified consistent with the emit/diff
design:

1. Keep `bodyRuns[].child` as the **authored id** in `base` (authored truth;
   round-trips clean; idempotent).
2. At emit (`emitElements`, render-helpers.ts:420 — which already has `nodeById`
   :439 and the path-state context `pathChildIndex`/`pathStateChildren`/
   `pathNodeOf` :471-489, threaded into `emitOne` as `pathCtx` :547), build a
   per-node `authoredId → childWire` map from the node's OWN children/childOrder.
3. Rewrite each `{child: <authoredId>}` to `{child: <wire>}` in the **emitted**
   `props['text']` string ONLY (after `encodeRuns`), never mutating
   `base.bodyRuns`.
4. **Deterministic + contained (never a throw):**
   - absent id (not in the node's own child map) → warn-and-drop the run.
   - duplicate id → first-match-in-order, warn.
   - def-child (synthetic wire, no `nodeById` entry) → warn-and-drop.
   - path-state child → resolve `pathKey→nodeId→props.id` via `pathNodeOf`, then
     `nodeById`; on match rewrite to the pathKey wire.

**Properties:** O(1) per run (one map build per node); cannot reference a non-child
(scoped to the node's own childOrder — the H2/order-faithful set); diff-safe (the
rewrite lands in the emitted string before `diffMinimal`'s `===` compare, so an
unchanged interleaving still emits zero ops); round-trip idempotent; adapters
UNCHANGED (still resolve true wires).

**Cost:** one per-node map build + string rewrite in `emitElements`; the
path-state resolution hop; a new warn code; ~2-4 test seams.

## 4. Gaps + costs-benefits

| Requirement | Engine vs consumer | Cost | Benefit |
| --- | --- | --- | --- |
| Emit-boundary id→wire map (`emitElements`) | Engine | Medium — one seam + path-state hop | Legacy-envelope authors can reference child runs by authored `props.id` |
| Deterministic absent/duplicate/def-child drop | Engine | Low (a warn-code) | Contained, never wrong-child |
| `base.bodyRuns` authored (no mutation) | Engine | None (already the shape) | Round-trip idempotent |
| Consumer re-expression | Consumer | Deferred | n/a today |

**Net:** the capability is real and the approved shape is correct, but it serves
only a legacy-envelope author who cannot predict the minted wire. No such
consumer is named.

## 5. Why PARK, not PROCEED (the necessity check)

The only real consumer (Astrographer) builds its tree **programmatically**
(rich-text-html-to-provident-tree.md §2 — the converter assigns `ownedNodeIds`
itself; §5 — reconciliation keyed by the node's stable id). Its inline children
(`strong`/`em`/`code`/`a`) are plain nodes whose wire = nodeId (`pathWireOf`,
render-helpers.ts:138-140) — which the consumer KNOWS because it just minted
them. Its re-expression against the shipped `bodyRuns` (eng-inline-order.md §14)
can author `{child: <wire>}` directly. The authored-id seam is a solution to a
problem no current consumer has.

## 6. Trigger / revisit condition

**PARK (originally).** Revisit and implement the §3 shape when a consumer **authors
`bodyRuns` from a legacy envelope** (not programmatic construction) and needs to
reference a child run by authored `props.id` rather than the minted wire.

**TRIGGER FIRED + LANDED 2026-08-31.** The user unparked this as a general defect
patch (a-big/high — future projects beyond Astrographer will author bodyRuns from
a legacy envelope). Implemented via TDD (see §7). `docs/pending.md` row marked
LANDED/retired.

## 7. Implementation (LANDED 2026-08-31) — the §3 shape

- **Seam:** `src/core/render-helpers.ts` `resolveBodyRunsChildWires(el, nodeById, pathCtx)`
  — a POST-EMIT pass run in `emitElements` after each element's final `childOrder`
  is set (fork-arm remap included). It reads the emitted `props['text']` run string,
  and bails immediately unless it is body-encoded AND contains a `{ child }` run.
- **Resolution (scoped to the node's OWN `childOrder`):** for each `{ child }` run,
  `nodeById`'s authored `base.props.id` (+ the path-state `pathCtx.pathNodeOf`
  nodeId lookup) builds a per-node `<authoredId> → childWire` map, first-match-in-
  order. A run whose `child` is ALREADY a child wire passes through unchanged; an
  authored-id run rewrites to its wire; a dangling ref (absent id / def-child
  synthetic / foreign) is DROPPED — all deterministic, never a throw.
- **Round-trip:** `base.bodyRuns` is NEVER mutated — only the emitted `props['text']`
  string is rewritten, so `nodeToLegacy`/`serializeNode` keep authored ids and
  re-translate is idempotent.
- **Performance:** O(1) per reference (a per-node map build over the node's own
  children); the post-pass bails on non-encoded text, so the no-bodyRuns pages
  (fork-stress etc.) pay zero cost — the derived-fork pins stay within the 2.5×
  asserted guard.
- **Tests:** `tests/unit/bodyruns-wire-ref.test.ts` (5 — authored-id resolve,
  child-first interleaving, real-wire passthrough, dangling-drop, base-not-mutated).
  Trio green 2026-08-31 (1261 tests, typecheck, demo:smoke, build).

---

### Decision records

- **DECIDED:** the two proposed shapes (translate rewrite / adapter fallback) are
  REJECTED — shape 1 forward-reference + reverse-leak + path-state-unknowable;
  shape 2 the O(n²) regression class + duplicate-id non-determinism.
- **DECIDED (approved shape):** emit-time id→wire translation over the node's own
  childOrder; `base` authored; adapters unchanged — recorded for the revisit, not
  built now.
