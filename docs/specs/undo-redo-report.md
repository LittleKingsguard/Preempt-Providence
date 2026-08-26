# Undo/Redo/Replay Host-Report — Spec

Status: **DECIDED** (2026-08-26, three-agent review gate PASS-WITH-CHANGES —
`docs/specs/undo-redo-report-review.md`). Companion: `docs/specs/ops.md` §6
(Journal contract), `src/core/supervisor.ts`.

## 1. Problem

`Supervisor.undo()` / `redo()` / `replay()` return `void` and the
`undoStack`/`redoStack` are `private` (supervisor.ts:131-132). A host cannot
faithfully report status / dirtied / stack-top-kind after these operations —
it cannot distinguish "work done + which nodes were touched" from "silent
no-op", nor know the next undoable/redoable op or whether it sits at the
condensed base boundary.

## 2. Behavior contract

### 2.1 Report type

```ts
export interface UndoRedoReport {
  /** 'applied' | 'no-op' (empty/destroyed/unresolved/terminal-destroy) | 'base-boundary' */
  status: 'applied' | 'no-op' | 'base-boundary'
  /** The markPass2-SCHEDULED (pending-flush) set from pass2Dirty — NOT
      re-rendered states. Hosts awaiting settled states must
      `await flush()` + `takePass2States()`. */
  scheduledDirtied: NodeId[]
  /** kind of the POST-op undoStack top (next undoable), if any. */
  stackTopKind?: string
  /** kind of the post-op redoStack top, if any (replay may clear it). */
  redoTopKind?: string
  /** true when the undo cursor sits at the condensed base — further undo is a
      guarded no-op (base-boundary warn). */
  baseBoundary: boolean
}
```

### 2.2 Method signatures (source-compatible: `void` → report)

```ts
undo(): UndoRedoReport
redo(): UndoRedoReport
replay(): UndoRedoReport
```

### 2.3 Read-only stack accessors (copies/depths only — never raw `JournalEntry[]`)

```ts
get undoDepth(): number
get redoDepth(): number
get undoTopKind(): string | undefined
get redoTopKind(): string | undefined
get undoBaseBoundary(): boolean
```

### 2.4 Status semantics

- **`applied`** — the op performed real work (an inverse ran / a re-apply
  applied). `scheduledDirtied` is the union of the ids marked dirty during the
  operation.
- **`no-op`** — the op did nothing: empty stack with no base marker, `!node`,
  unresolved/destroyed target, or a terminal `destroy` undo (destroy is
  terminal — pinned no-op, ops.md §6). `scheduledDirtied` is empty.
- **`base-boundary`** — the undoStack is empty BECAUSE it was truncated at the
  condensed base (supervisor.ts:1351-1354). Distinct from `no-op` (empty stack
  with no base). `scheduledDirtied` is empty.

### 2.5 `scheduledDirtied` derivation

- **redo / replay**: the union of `apply().dirtied` from each applied re-apply
  (currently discarded at :1515/:1272) plus any ids marked by the op's own
  `markPass2`/`markDirty` calls.
- **undo**: the ids marked by the direct-inverse branches — the rows-mint
  teardown consumer walk (:1415-1429) and `undoStateSlice`'s node + consumer
  walk (:1489-1498) — plus `apply().dirtied` on the keyed-rows-mint inverse
  path (:1388).
- The report reads `this.pass2Dirty` (the synchronous scheduled set) — NOT a
  journal scan (the `dispatchAndReport` O(n) pattern at :329-346 is rejected;
  this is O(dirty-set)).
- **Scheduled, not committed**: undo/redo/replay never call `flush()`. The
  report's `scheduledDirtied` is the pending-flush set. A host that needs
  settled pass-2 states must `await flush()` + `takePass2States()` (the
  `dispatchAndReport` precedent, :338-339).

### 2.6 `stackTopKind` / `redoTopKind` / `baseBoundary`

- `stackTopKind` = `undoStack.at(-1)?.op.kind` after the op (undefined when
  empty). `redoTopKind` = `redoStack.at(-1)?.op.kind` after the op (undefined
  when empty; replay may clear the redoStack at :1297).
- `baseBoundary` = `undoStack.length === 0 && journal.some(e => e.op.kind === 'base')`
  — the base marker is never in `undoStack` (filtered at condense, :685), so an
  empty stack with a base present is the boundary, NOT "nothing to undo".
- The accessors are read-only snapshots (depths + top-kinds as copies). Raw
  `JournalEntry[]` are NEVER exposed (they hold live `Node` refs + `snapshot`
  payloads, :676).

## 3. Exhaustiveness gate — states & fail-states for TestWriter

| # | State / fail-state | Expected outcome | Ref |
| --- | --- | --- | --- |
| U1 | `undo()` with a non-empty undoStack | `status:'applied'`; `scheduledDirtied` = the marked ids; `stackTopKind` = the new top's kind (or undefined if now empty); `baseBoundary` false | §2.4/2.5/2.6 |
| U2 | `undo()` with empty undoStack, no base marker | `status:'no-op'`; `scheduledDirtied` empty; `baseBoundary` false | §2.4 |
| U3 | `undo()` with empty undoStack, base marker present (post-condense) | `status:'base-boundary'`; `scheduledDirtied` empty; `baseBoundary` true; base-boundary warn emitted | §2.4/2.6, supervisor.ts:1351 |
| U4 | `undo()` of a `destroy` (terminal) | `status:'no-op'` (pinned no-op); `scheduledDirtied` empty | §2.4, ops.md §6 |
| U5 | `undo()` of a `state-slice` | `status:'applied'`; `scheduledDirtied` includes the node + its source/duplex consumers | §2.5, supervisor.ts:1489-1498 |
| U6 | `undo()` of a keyed `rows-mint` (preRecord inverse) | `status:'applied'`; `scheduledDirtied` includes the reused/minted/removed ids | §2.5, supervisor.ts:1388 |
| U7 | `redo()` with a non-empty redoStack | `status:'applied'`; `scheduledDirtied` = the re-applied ids; `redoTopKind` = the new top's kind (or undefined if now empty) | §2.4/2.5/2.6 |
| U8 | `redo()` with empty redoStack | `status:'no-op'`; `scheduledDirtied` empty | §2.4 |
| U9 | `replay()` of a journal with no base marker | `status:'applied'`; `scheduledDirtied` = the re-applied ids; `redoTopKind` reflects the post-replay redoStack | §2.4/2.5/2.6 |
| U10 | `replay()` hitting a base marker (graph-REPLACE) | `status:'applied'`; `redoStack` cleared → `redoTopKind` undefined; `baseBoundary` reflects the post-replay state | §2.6, supervisor.ts:1297 |
| U11 | Accessors after a condense | `undoDepth`/`redoDepth` reflect the truncated/cleared stacks; `undoBaseBoundary` true when truncated to empty | §2.3/2.6 |
| U12 | Accessors are read-only | Reading `undoDepth`/`undoTopKind`/`undoBaseBoundary` never mutates the stacks; no raw `JournalEntry[]` exposed | §2.3/2.6 |
| U13 | `scheduledDirtied` is the scheduled (pending-flush) set | After `undo()`/`redo()`/`replay()`, `scheduledDirtied` ⊆ `pass2Dirty`; a subsequent `await flush()` + `takePass2States()` yields the settled states | §2.5 |
| U14 | Source-compatibility | Existing callers that ignore the return still compile/run unchanged (tests, demo timing accumulators) | §2.2 |
| U15 | `redo()` of a FAILED re-apply (rejected / no-usable-state) | `status:'no-op'`; `scheduledDirtied` empty; the entry is NOT re-pushed onto the undoStack (a redoable that cannot re-apply never corrupts the stack) | §2.4, supervisor.ts:1599 (2026-08-26 UNDO-REDO-ADV-UR6) |
| U16 | `replay()` clears the redoStack (base OR non-base) | `redoTopKind` undefined after any replay; a subsequent `redo()` is `no-op` (a pre-replay undone entry is re-applied by the replay → redoing it would double-apply) | §2.6, supervisor.ts:1358 (2026-08-26 UNDO-REDO-ADV-UR7) |
| U17 | `undo()`/`redo()`/`replay()` on an ISOLATED supervisor never leaks a cross-graph id | `scheduledDirtied` contains only THIS graph's ids (the undo consumer walk is scope-filtered) | §2.5, supervisor.ts:1565 (2026-08-26 UNDO-REDO-ADV-ISO-1) |
| U18 | Malformed ops are CONTAINED | A malformed `state-slice` (missing/non-array `mutation`), `layer-apply` (non-array `nodes`), `attach` (no `to`), or `destroy` (plain-object `node`) → `status:'rejected'`, `error.code:'malformed-op'` — never an uncaught throw | §2.4, supervisor.ts (2026-08-26 UNDO-REDO-ADV-MAL-1..5) |
| U19 | `replay()` with a corrupted base snapshot is contained | A malformed base `snapshot` degrades to a no-op graph-restore (warn) — never an uncaught throw out of `replay()` | §2.4, supervisor.ts:1302 (2026-08-26 UNDO-REDO-ADV-MAL-6) |

## 4. Docs to update (with this change)

- `docs/specs/ops.md` §6 — add the report/accessor contract to the Journal
  contract table (a new row or an amendment to the Undo row).
- `docs/skills/designing-pages.md` — §11 test-use-case coverage matrix + §12
  demo pages (if a demo page is added) + §14-style lessons.
- `RENDER_PROCESS_NOTES.md` §10.10 — a `DECIDED:` entry.
- `docs/decisions.md` — the active decision record.
- `docs/defects.md` — the defect row (open → fixed with this reference).
