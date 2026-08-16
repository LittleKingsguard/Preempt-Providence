# Placeholder Node — Feasibility Review (step-3 change-analysis verdict)

Status: design review of the user proposal "Placeholder node" (2026-08-16).
No code changed. Companion context: `docs/specs/render.md` (EMPTY-OWNER-1..5,
NVS-2/3/6, R-ORD-3, SER-R1), `docs/specs/pipeline.md` (§5.1/§5.2 drain order),
`docs/specs/api.md` (W1/W4), `src/core/translate.ts` (`baseFrom`,
`nodeToLegacy`), `src/core/render-helpers.ts` (`emptyOwnerHide`/`emitOne`),
`src/core/render.ts` (`diffMinimal`), `src/core/supervisor.ts`
(`runPass2AndFlush`), `src/core/pipeline.ts` (`MicrotaskQueue`),
`src/core/serialize.ts` (`parseNodeState`/`loadState`), `tests/unit/legacy-shape-emit.test.ts` [16]-[22].
Inputs: step-1 (validity) + step-2 (critique) findings; every code claim below
re-verified against the current source before writing.

## 1. What the proposal asks

1. Add a `placeholder` property for a node (NodeData field; a placeholder
   node value like `{type: 'div', content: 'Loading…'}` or a def reference).
2. The placeholder is normally OUT-OF-TREE like a component (never a
   family-in-tree render target on its own).
3. When the host node is NOT rendering — (a) pending a large update
   (compiled state not yet fresh / mid pass-2), or (b) the current
   EMPTY-OWNER `display: none` case — the PLACEHOLDER renders instead.
4. When the compiler encounters the placeholder, it IMMEDIATELY sends it as
   a SEPARATE op batch so the browser updates it FIRST, before the real
   payload.

## 2. Feasibility verdict

**PARK-WITH-ELEMENTS. Reject the core mechanism (items 3a + 4); park the
field (items 1 + 2) unless the auto-clear data variant is wanted; adopt the
data-contract improvement (K4 warn for unknown NodeData keys) that is
valuable regardless.** The mechanism is falsified on two independent,
code-verified grounds:

### 2.1 Blocker 1 — there is no pre-paint window to fill (the "pending" state is invisible by construction)

The whole pipeline runs inside ONE `queueMicrotask`: `supervisor.ts:248`
(single `scheduleFlush` microtask → `runPass2AndFlush`) and `pipeline.ts:244`
(the `MicrotaskQueue` drain) — both drain the pass-2 sweep, cascade-destroy,
event batch and render emit back-to-back, `render-emit` LAST
(`DRAIN_ORDER`, pipeline.ts:214-220). The browser paints only between tasks
(pipeline.md §5.2 one-microtask-per-tick). Therefore:

- **The user can never observe "pending a large update"**: a dirty update
  completes within the same microtask; the frame shows the old DOM until the
  drain finishes, then the final state. There is no visible gap for a
  placeholder to occupy. The one genuinely long window (fork-stress depth-12,
  ≈1.35 s module work — AGENTS.md path-fork baseline) is also one microtask;
  the sanctioned answer is the incremental machinery (per-slice locks,
  pipeline.md; focused pass-2 slices, supervisor.ts:30; path-fork baselines,
  placement-path-spec §8 Q6), not a mid-tick placeholder.
- **Trigger (a) is unobservable to the engine too**: `pass2Dirty` /
  `pendingTriggers` are private and cleared at flush start
  (supervisor.ts:226-231, 254-277); renders strictly follow the completed
  sweep (R-ORD-3, render.md:127); a compiled state is a read-only snapshot
  (SER-R1, render.md:320). "Mid-pass-2" as a render trigger requires a brand
  new in-flight signal AND a pre-compile render pass — inverting the fixed
  drain order. It also invents a wall-clock-dependent compile state, breaking
  serialize determinism (a `serializeSlice` mid-update would vary by when it
  is called).

### 2.2 Blocker 2 — a "separate op batch" cannot precede the payload within the tick contract

`RenderOp` has no batching concept; `diffMinimal` (render.ts:56) computes one
synchronous op array; `applyOps` (render-helpers.ts:152) is one synchronous
loop; every harness does one `applyOps` per render. "Browser updates it
first" requires a task/rAF yield between two op streams, which:

- **Inverts W1/W4** (api.md:342/345): events emit right BEFORE render ops
  within a tick; a placeholder applied one task earlier shows a DOM state the
  tick's events have already announced as stale — event/dom divergence.
- **Breaks journal replay determinism**: the journal records applied ops per
  tick; a two-task split makes the tick's atomicity (NVS-6 — partial batches
  / mid-op walk results, emits follow the completed sweep only; R-ORD-3)
  unenforceable.
- **Emits a partial batch**: the placeholder element is a mid-sweep artifact
  that must be removed when the real host lands — a full D3 remove+create
  identity swap per update (the exact focus/blur hazard D5 exists to prevent,
  render.ts:21-24/109-118).

No seam exists: any task yield is a new render point the tick contract does
not sanction. The agents' blockers 1+2 stand as verified.

### 2.3 The deterministic half (trigger b) is already expressible — verified

`emptyOwnerHide` (render-helpers.ts:963-968) hides an empty placement owner
ONLY when `s.content === undefined` and no authored `css.style`; authored
content renders visible (EMPTY-OWNER-1a, render.md:222; pinned by
EMPTY-H6, render.md:519, and legacy-shape-emit.test.ts [21]:597). A styled
skeleton host is expressible too (EMPTY-OWNER-1b, render.md:223, test [22],
the path-fork/fork-stress leaf pattern). So the proposal's only genuine
delta is trigger (a) — which cannot exist — plus an auto-clear convenience
(§3.1). Replacing `display:none` with a placeholder render would either break
the pinned [16]/[20] set-op assertions (legacy-shape-emit.test.ts:500-566)
or fork two divergent code paths.

## 3. Gaps and costs/benefits of the salvageable elements

### 3.1 (i) The deterministic data-only variant — auto-cleared placeholder content

What it would add over EMPTY-OWNER-1a: **one thing only** — authored
`content` persists beside children today (EMPTY-OWNER-3 only removes the
hide), while a `placeholder` field could auto-clear when children render.
Feasible shape: the placeholder is the host's OWN text slot (a conditional
`text` prop in `emitOne`), NEVER a separate wire — a separate element
enters `childOrder`, and child-order change on arrival triggers the D5
re-append of every sibling (blur of a focused editor per update,
render.ts:114-118). Host-text form costs one conditional `text` set op (D4,
cheap) and works per-arm for forked/path-state hosts with no identity
problem (each arm already carries the host's authored content).

Costs: NodeData field plumbing (baseFrom translate.ts:293-375,
nodeToLegacy translate.ts:1040+, parseNodeState serialize.ts:162-195 +
loadState, `NodeBaseData` types.ts:237 — the validity agent's 4 mechanical
touch points), an EMPTY-OWNER re-decision (the hide rule must treat the
placeholder as renderable information — EMPTY-OWNER-1 extension), emitOne
conditional, and test-pin churn ([16]/[20]/[21] + new pins). Net value:
small. **Park** with the revisit condition "a loading state that authored
content cannot express, decided by the user".

### 3.2 (ii) The data-contract improvement — K4 warn for unknown NodeData keys

Verified gap: `baseFrom` reads exactly `type`/`content`/`props`/`css`/
`handlers`/`derived` (translate.ts:300-374); the rest of the stack consumes
`children`/`placement`/`component` (translate.ts:725-896) and `id`
(node.ts:377). **Any other top-level key is silently dropped — zero
warnings.** The same holds for `parseNodeState` (serialize.ts:162-195) on
the serialized doc path. This is the last silent translate drop: the "never
silent" K4 family (`payload-shape-obsolete`, `children-shape-invalid`,
`children-entry-invalid`, `placement-entry-invalid`, `handler-phase-unknown`,
…, translate.md TR-F2) covers every other boundary, and DEFECT #15's fix
policy was exactly "no longer SILENT" (defects.md:24). Note the drop is
currently DOCUMENTED contract ("unknown fields … ignored", placement-path-
spec.md:38; TR-F2) — so the warn is a **contract amendment**, not a bug fix,
and needs the user gate.

Costs: ~5 lines in baseFrom (iterate `Object.keys(nodeData)`, warn + skip
the key, never throw), a new K4 code (e.g. `node-data-key-unknown`), TR-F2 /
translate.md / designing-pages TR-F2-row updates, and a sweep of existing
fixtures for stray keys (the additive channel stays green otherwise; SER-R1
round-trips emit only known keys, so reverse re-translate fires no new
warnings). Benefits: authors see typos and future-field attempts instantly;
a future `placeholder` field would have shipped with its own warn had this
existed. **Adopt** (recommendation below).

The placeholder field plumbing ITSELF (independent of any render role) is
dead weight — plumb only together with §3.1.

### 3.3 (iii) "Separate batch" re-expression — none exists

Op-stream ORDERING is available inside the single drain (the `RenderOp[]`
array is ordered; `applyOps` applies in order) but the deterministic case
(§3.1) needs no ordering trick — the placeholder is the host's own props. The
async pre-paint case conflicts with the tick contract on all three axes in
§2.2; no seam found beyond what steps 1 and 2 identified. The drain order
(deferred-emission → dirty-pass2 → cascade-destroy → event-batch →
render-emit, pipeline.ts:214-220) is fixed and pinned by
`MicrotaskQueue.drainOrder` tests.

### 3.4 Better solutions for the underlying UX goal

| UX goal | Existing mechanism | Pin |
|---|---|---|
| "Show something while this zone is empty" | authored `content` on the empty owner (EMPTY-OWNER-1a) | render.md:222, test [21] |
| Styled skeleton / spinner zone | authored `css.style` / cssDef keeps an empty host visible (EMPTY-OWNER-1b) | render.md:223, test [22] |
| Data-driven loading text | content-target seam / `scalarBinding` values (`component` provides content) | render.md SED-3, render-helpers.ts:436-443 |
| Long-compile jank (depth-12) | per-slice locks, focused pass-2 slices, path-fork baseline | pipeline.md §5, supervisor.ts:30, placement-path-spec §8 Q6 |

## 4. Recommendation

**Reject items 3a + 4 (falsified). Park items 1 + 2 (no render role without
3a; the §3.1 auto-clear variant only if the user asks for it). Adopt the K4
unknown-key warn (§3.2) as the one change that is valuable regardless.** The
review doc pattern's "usable kernel" is the data contract, not the render
feature.

| # | Proposal element | Disposition | Tracker landing |
|---|---|---|---|
| 1 | `placeholder` NodeData field | PARK | pending.md — PARKED row (revisit: auto-clear variant requested; plumb together with 3b) |
| 2 | Out-of-tree like a component | PARK | pending.md — same row (trivially satisfied; meaningless without 1) |
| 3a | Render placeholder while pending (mid pass-2) | REJECT | pending.md — PARKED-with-revisit-condition row: only if a task-yield render point is ever sanctioned (contradicts pipeline.md §5.2 today) |
| 3b | Render placeholder for EMPTY-OWNER `display:none` | PARK | pending.md — PARKED row (expressible today via EMPTY-OWNER-1a/1b; field adds auto-clear only; adopting forks EMPTY-OWNER + test pins [16]/[20]/[21]) |
| 4 | Separate op batch sent first | REJECT | pending.md — PARKED row (needs a pre-paint task yield; inverts W1/W4, breaks journal determinism + NVS-6) |
| — | **NEW: K4 warn `node-data-key-unknown`** (unknown top-level NodeData keys, baseFrom) | **ADOPT (candidate)** | docs/defects.md — improvement/defect-candidate row; on user approval: decisions.md ADOPTED row + translate.md TR-F2 amendment + designing-pages TR-F2 row; implementation via the subagents spec → red → green chain |

No tracker rows were added by this review; the above is the recommendation
list for the next pass. Pending-item revisit conditions: (3a/4) a sanctioned
render point between tasks; (1/3b) a loading state authored content cannot
express.
