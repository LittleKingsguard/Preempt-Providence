# Architectural Review — congealed state (Step 2 deliverable)

Input to the Step-3 reviewer. Consolidated from RENDER_PROCESS_NOTES.md §10
with the user-decided design calls marked `DECIDED`. This file is a summary,
not canonical — §10 remains the source of truth.

## Reading order per §10
Pillar G (§10.8) first (graph substrate), then A–F.

## Lifecycle (1 sentence each)
1. Template/Payload → Node construction; prototypes anchored to `'component'`.
2. Phases run over `compile(slice)` slices; workers are registry-owned.
3. Instantiation = graph ops (`attach`/`clone-instance`) making `'parent-child'`
   Links; ordering = child-anchor `priority`.
4. Assembly = nearest-source borrow (§10.8.2).
5. Render = two-scope compile (deep vs. node-local) → declarative render ops →
   one `RenderAdapter`.
6. Mutation = named replayable `StructuralOp`s; `LinkConfig` enforcement.
7. State serializes back to JSON schemas (SSR brush = client hydrate format).

## DECISIONS (user-confirmed)
- D1 · Single `'parent'` anchor per node; ≤1 in-tree `'child'` anchor.
- D2 · Locking Option B: per-slice re-entrant lock; nested emissions deferred
  to the existing microtask queue; recursion-depth cap is the loop tripwire.
- D3 · Compile dirty set: pass-1 synchronous inside op; pass-2 post-op via the
  render microtask queue, coalesced one sweep/tick before render.
- D4 · Compiled node + anchor state: JSON-schema serializable (round-trips
  `NodeSchema`); SSR and client consume same format.
- D5 · Borrow resolution = closest-first: compile from a node checks that
  node's `'target'` anchors, walks up toward root, uses the **first** source
  found. Root-level source only shadows when nothing closer exists.
- D6 · Multi-name overload = compile forks into compiled states keyed by path
  to root; arms that don't terminate at root (prototype/loop) warn + return no
  actionable state.
- D7 · `compile(slice)` two-pass split: compileLocal (values + `anchors[]`),
  compileRemote (parent/children/bindings via walks).

## Reviewer focus areas (from user)
- Contradictions between Pillars A–F and G (esp. where A/B still imply a local
  `parent` field or layer-written parentage).
- Drift vs §8/§8.1/§8.4 (legacy terms: `activeLockedPhases`, clone arity,
  falsy parentage, `parent` setter).
- Underspecified mechanics: `CompiledState` identity for forked arms, how
  `priority` tie-breaks interact with D6, SSR hydation of forks, protocol for
  `link.destroy()` orphan owner.
- Missing: back-ref/GC of `Anchor`↔`Link`, cycle-prevention at op time for
  `attach` (D2 cap is the compile-time guard; op-time needs consideration).