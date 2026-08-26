# Undo/Redo/Replay Host-Report — Feasibility Review

Status: **PASS-WITH-CHANGES** (three-agent gate, 2026-08-26). The proposal is
approved to proceed to spec + TDD implementation, subject to the three
corrections in §4. No code changed by this review.

## 1. What the proposal asks

`Supervisor.undo()` / `redo()` / `replay()` return `void` and the
`undoStack`/`redoStack` are `private`, so a host cannot faithfully report
status / dirtied / stack-top-kind after these operations. The proposal: make
these methods return a report (status / dirtied node ids / stack-top-kind)
and/or expose read-only accessors for the undo/redo stacks.

## 2. Feasibility verdict

**Feasible, source-compatible, negligible cost.** The claim is confirmed:

- `undo(): void` — src/core/supervisor.ts:1346
- `redo(): void` — src/core/supervisor.ts:1503
- `replay(): void` — src/core/supervisor.ts:1234
- `private undoStack` / `private redoStack` — src/core/supervisor.ts:131-132

`apply()` already returns a rich report (supervisor.ts:763-775); redo (1515)
and replay (1272) call it and discard everything but `status`+`preRecord`;
undo's direct-inverse branches (`undoStateSlice` 1451, rows-mint teardown
1376-1433) never route through apply and never produce dirtied. `DispatchReport`
(92-95) is event-dispatch-shaped and not reusable. No caller uses the `void`
return (tests assert graph-state post-conditions; demo wraps in timing
accumulators), so changing `void` → a report is source-compatible.

## 3. Critique (ordered by severity)

### C1 — "stack-top-kind" is wrong at the condense base-boundary (blocking)
The base marker (supervisor.ts:674-686) is **never** in `undoStack` (filtered
at condense, :685). After a condense truncates to empty post-base,
`undoStack.at(-1)` is `undefined`, yet the op is at the base *boundary* — a
distinct, guarded state (warn at :1351-1354). A bare `stackTopKind: undefined`
misreports boundary as "empty stack". Must surface `baseBoundary` separately.

### C2 — "dirtied" is the scheduled set, not the re-rendered set (blocking)
undo/redo/replay never call `flush()`; they `markPass2`/`markDirty`
(:1490-1498) which *schedule* a microtask flush (:490-499). The truthful
synchronous set is `pass2Dirty` (:471, private) — the *scheduled* set, not
re-rendered states. Reporting it as unqualified `dirtied` is a render-honesty
violation. Must be labeled `scheduledDirtied` (pending-flush); hosts wanting
settled states use the existing `flush()`+`takePass2States()` channel.

### C3 — silent no-op branches need a real status (blocking)
The silent early-return branches are real and must be distinguishable: empty
stack w/ base marker (:1351), empty stack w/o base (:1351), `!node` (:1362),
unresolved id (:1369), terminal `destroy` no-op (:1374-1375). A blanket
`applied` would be false. Encode as `applied | no-op | base-boundary`.

### C4 — post-replay graph-REPLACE invalidates pre-replay stack state (major)
After `replay()` hits the base branch (:1243-1246) the graph is fully replaced
and `redoStack` is cleared (:1297). An accessor returning pre-replay stack
content as "what will undo next" is wrong unless it reflects this invalidation.

### C5 — never expose raw `JournalEntry[]` (major)
Entries hold live `Node` refs and `snapshot` payloads (:676). Expose depth +
top-kind only, as copies.

## 4. Necessary changes (the three corrections)

1. **Base-boundary as a separate signal** — `baseBoundary: boolean` (or a
   `'base-boundary'` status), distinct from an empty stack.
2. **`scheduledDirtied` labeled pending-flush** — from `pass2Dirty`, named to
   make the scheduled-vs-committed distinction explicit.
3. **Real `applied | no-op | base-boundary` status** — distinguish the silent
   no-op branches, not a blanket success.

## 5. Recommendation

Adopt the report-return AND thin read-only accessors, synchronous (mirroring
the sync `apply` precedent, not the async `dispatchAndReport`). Report
`scheduledDirtied` from `pass2Dirty` (O(dirty-set)) — do NOT copy
`dispatchAndReport`'s O(n) journal scan (:329-346). Never expose raw stacks.

```ts
export interface UndoRedoReport {
  status: 'applied' | 'no-op' | 'base-boundary'
  scheduledDirtied: NodeId[]   // markPass2-SCHEDULED (pending-flush), from pass2Dirty
  stackTopKind?: string        // post-op undoStack top (next undoable), if any
  redoTopKind?: string         // post-op redoStack top, if any (replay may clear it)
  baseBoundary: boolean        // undo cursor at the condensed base — further undo is a guarded no-op
}
undo(): UndoRedoReport
redo(): UndoRedoReport
replay(): UndoRedoReport
// read-only accessors (depths/top-kinds only — never raw JournalEntry[]):
get undoDepth(): number
get redoDepth(): number
get undoTopKind(): string | undefined
get redoTopKind(): string | undefined
get undoBaseBoundary(): boolean
```

## 6. DECIDED spec — undo/redo/replay host-report (adopted)

Status: **DECIDED** (user-approved direction; land via the subagents workflow
spec → red → green). See `docs/specs/undo-redo-report.md` for the full
behavior contract and test surface.
