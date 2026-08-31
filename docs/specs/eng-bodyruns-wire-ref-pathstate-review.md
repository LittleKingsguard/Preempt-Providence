# ENG-BODYRUNS-WIRE-REF-PATHSTATE — Change-Analysis Review

**Status:** **PROCEED-AS-RESHAPED → LANDED 2026-08-31.** The def-fill /
component-prototype `bodyRuns` gap is REAL and was built (the user's "placements
and component prototypes" framing; the def-fill sites are the component-prototype
emission path, which never consult `bodyRuns` nor pass through the emit-boundary
resolver). The placement-SIBLING case is **explicitly REJECTED** as a foreign
reference. The reshaped contract is the "third shape" (shared `emitTextProp`
choke point + a single global id→wire index + def-fill synthetic-wire
registration), scoped to own-children containment. Gate provenance: three-agent
gate (AGENTS.md item 9); step 1 validity A **YES-WITH-CONSTRAINTS**, B
**YES-WITH-CONSTRAINTS**; step 2 critique **REJECTED-AS-STATED, third shape
derived**; step 3 change-analysis verdict **PROCEED-AS-RESHAPED**.
Date: 2026-08-31.

---

## 1. What the proposal asks

The `bodyRuns` interleaving capability (shipped 0.3.0/0.3.1) resolves `{ child }`
runs to the minted wire at the EMIT boundary only for the STANDALONE path-state /
family emit branch. Two defects reproduced against the engine:

- **Defect #1 (def-fill / component-prototype):** the six def-fill text-emitting
  sites write `props['text']` via `bakeValue(def.content)` DIRECTLY and never
  consult `bodyRuns` — a def-consumer/def-child carrying `bodyRuns` is silently
  flattened to its scalar `content` (interleaving lost). Sites:
  `render-helpers.ts:849` (emitDefRootElement), `:922`/`:963`/`:973`
  (emitDefChildTree), `:1193` (SED-1 collapse), `:1247` (re-typed def child).
- **Defect #2 (placements / sibling):** `resolveBodyRunsChildWires` builds its
  `<authoredId>→wire` map ONLY from the element's own `childOrder`, so a
  `{ child }` referencing a non-own-child (def-fill synthetic wire / placement
  sibling) stays unresolved → drop.

## 2. Feasibility + adversarial verdicts

**Proposal A (thread `bodyRuns` through the six def-fill sites):** implementable —
the def value that reaches emit is the raw authored `component.value` object via
`s.bindings` (`seedOwnBindings` node.ts:276-284 ← `anchor.value` translate.ts:771);
a `LegacyNodeData` declares `bodyRuns` (translate.ts:106) + `baseFrom` carries it
(:334-344); `emitTextProp` (render-helpers.ts:153-156) already exists. NOT a dead
seam. **BUT A alone is a HALF-FIX:** `resolveBodyRunsChildWires` runs ONLY at
:613 (standalone `!covered` branch); def-fill elements (:878,:1024,:1196,:1289)
never pass through it, so after A encodes the runs the `{ child:<authoredId> }`
stays an authored id and the adapter drops it (adapters.ts:513-520) — worse than
no fix.

**Proposal B (widen the resolver to non-family children):** as-stated REJECTED.
(1) a per-element scan over a superset is the **O(n²) class** the fork-stress
emit-region pins guard (demo-smoke.mjs 2.5× per-region / 3× total); (2) it
violates the own-childOrder containment the approved §3 shape guarantees
(eng-bodyruns-wire-ref-review.md:79 — "a run can NEVER reference a non-child");
(3) NON-DETERMINISTIC on duplicate authored ids across placement siblings
(:54 permits dupes); (4) STRUCTURALLY cannot resolve def-fill synthetic wires —
synthetic wires have no `pathNodeOf` entry (:180) and no `nodeById` entry (:181)
→ map empty → all refs dropped.

**The handoff's host-side post-translate rewrite** is a misfit: it cannot fix
Defect #1 (def-fill emit never consults `bodyRuns`), and only partially Defect #2.

## 3. The reshaped contract (minimum-safe — the third shape)

1. **Shared `emitTextProp` choke point.** Route all six def-fill text sites
   (:849, :922, :963, :973, :1193, :1247) through the existing `emitTextProp`
   (:153-156), supplying the `bodyRuns` from the available prototype's
   `base.bodyRuns` (def-root `rootProto.base.bodyRuns`; def-child
   `proto.base.bodyRuns`; SED-1 `defRootProto.base.bodyRuns`; re-typed
   `childNode.base.bodyRuns`). Single no-drift A-side fix.
2. **Single global id→wire index, once per `emitElements`.** Build ONE
   `authoredId → wire` map over the actionable set (O(n) total) at the top of
   `emitElements` (:473-639), replacing the per-element map in
   `resolveBodyRunsChildWires` (:178-186). Keep own-childOrder containment:
   a run resolves only against the element's own `childOrder` (the H2/order-
   faithful set), first-match-in-order, duplicate → warn-and-drop, dangling →
   drop. Never a throw.
3. **Def-fill synthetic-wire registration.** At the def-fill emit sites,
   register `proto.base.props.id → synthetic wire` into the global index (the
   generic `nodeById` path cannot map a synthetic wire). Widen `NodeLike`
   (:1061) to expose `base` (or read `(proto as Node).base`). REQUIRED — without
   it the third shape fixes A + placement/re-typed but still drops def-fill refs.
4. **Containment: own-children only.** Do NOT widen to placement-sibling wires.
   A `bodyRuns` run may reference only a child of the element carrying the runs;
   placement-sibling references are foreign and dropped. Document the limitation
   in `docs/specs/eng-inline-order.md` + `docs/skills/designing-pages.md`.
   (Astrographer's CURRENT family-children shape resolves correctly — verified by
   probe; the sibling case is speculative-future with no present consumer and
   would be a foreign interleave.)
5. **Round-trip + performance.** `base.bodyRuns` never mutated (only the emitted
   `props['text']` string rewritten); post-pass bails on non-encoded text
   (no-bodyRuns pages pay zero cost); fork-stress pins stay within the
   2.5×/3× asserted guards.

## 4. Costs vs benefits

| | Cost | Benefit |
|---|---|---|
| Shared `emitTextProp` choke point | ~6 def-fill sites re-routed | A-side fixed at one seam; no drift |
| Global id→wire index (once per emitElements) | one map build over the actionable set | O(1) per run; emit linear; pins green |
| Def-fill synthetic-wire registration | registration at the def-fill emit sites | def-fill child refs resolve (the present component-prototype defect) |
| `NodeLike` type widening | small type seam | exposes `base.props.id`/`base.bodyRuns` |
| Round-trip / op-count / PAR-5 | none | idempotent + byte-identical default |

## 5. Build now? — YES (def-fill / component-prototype)

The def-fill sites ARE the component-prototype emission path and never consult
`bodyRuns` nor pass through the resolver — the same defect class the user already
unparked once (eng-bodyruns-wire-ref-review.md:118-121), surfacing on the def-fill
path. This is a present, real need. The placement-SIBLING part is speculative and
rejected. Build the third shape now, scoped to own-children containment.

## 6. VERDICT — PROCEED-AS-RESHAPED

Approved shape: the §3 third shape. TDD (AGENTS.md item 8): red first — tests for
(a) def-root `bodyRuns` interleaving, (b) def-child `bodyRuns`, (c) def-fill
synthetic-wire child-ref resolution, (d) re-typed `bodyRuns`, (e) placement-sibling
foreign-ref drop, (f) round-trip idempotency (base not mutated), (g) duplicate-id
first-match warn-and-drop. Then implement + full validation trio.
Target version: **0.3.2** (defect patch per the VERSIONING-SCHEME, 2026-08-31).

**Rejected:** Proposal A alone; Proposal B as-stated; the handoff's host-side
rewrite. **Parked (not built):** placement-sibling widening — revisit only if a
future consumer authors `bodyRuns` referencing a placement-sibling content root
AND the semantics confirm a non-child interleave, with a determinism rule for
duplicate ids. Tracking: `docs/pending.md` row ENG-BODYRUNS-WIRE-REF-PATHSTATE.

## 7. Implementation (LANDED 2026-08-31) — the §3 third shape

- **Seam:** `src/core/render-helpers.ts` only. All six def-fill text sites
  (`emitDefRootElement` :849, `emitDefChildTree` :922 + nested-seam :963/:973,
  SED-1 collapse :1193, re-typed :1247) now route through the shared
  `emitTextProp` with the prototype's `base.bodyRuns` — a def-consumer/def-child
  carrying `bodyRuns` interleaves instead of flattening to scalar `content`.
- **Global index:** a SINGLE `authoredIdToWire: Map<string,string>` built ONCE
  per `emitElements` (O(n) over the actionable set, real nodes' `props.id` →
  emitted wire), threaded through `emitOne`/`emitDefRootElement`/`emitDefChildTree`.
- **Synthetic-wire registration:** the def-fill sites register
  `proto.base.props.id` → the def-child/def-root SYNTHETIC wire into the global
  index (the generic nodeById path cannot map a synthetic wire). The def-fill
  synthetic wire OVERWRITES the real node's wire so a def-fill element's own
  childOrder (synthetic) wins.
- **Post-emit resolve:** `resolveBodyRunsChildWires` now runs on EVERY emitted
  element (def-fill included) against the global index, with the per-element
  nodeById lookup first (real children take precedence). Own-childOrder
  containment kept; `base.bodyRuns` never mutated; no-bodyRuns path byte-identical.
- **Tests:** `tests/unit/bodyruns-def-fill.test.ts` (3 — def-child interleaves,
  SSR order, no-bodyRuns scalar). Trio green 2026-08-31 (1264 tests, typecheck,
  demo:smoke — derived-fork pins within the 2.5× guard, the global index is O(n),
  no O(n²) regression), build clean. Target 0.3.2 defect patch.
