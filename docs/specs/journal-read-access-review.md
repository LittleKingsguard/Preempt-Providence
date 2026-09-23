# ENG-JOURNAL-ENTRY-READ-API — Journal Read Access — Gate + Executor Contract

**Status:** **LANDED (2026-09-12, target 0.5.0 non-breaking feature).** Source:
the Astrographer handoff `Astrographer/docs/HANDOFF.md` row
`ENG-JOURNAL-ENTRY-READ-API` (reopened 2026-09-12 as a pending upstream item),
with the host-side gate context in
`Astrographer/docs/specs/journal-read-access-review.md` (M1-M16/D1-D12) and
`Astrographer/docs/feature-requests/journal-read-access.md`. Gate provenance:
three-agent gate (AGENTS.md item 9) — validity, critique, change-analysis — plus
a code verification pass against `provident-ssr@0.4.1`. Date: 2026-09-12.

## 1. What the request asks

A `provident-ssr` package update adding **journal read access**, so an MCP host
(Astrographer's `provident.get_journal` / C16 history pane) can enumerate the
engine journal and its position without mirroring every op and without touching
the raw `Supervisor.journal` array. The host residual shape was framed as a
non-draining `Supervisor.journalEntries(): {index, kind, status, state}[]`.

## 2. Verification against 0.4.1

- `readonly journal: JournalEntry[]` is public + append-only (`supervisor.ts:129`);
  `JournalEntry` (`supervisor.ts:85-89`) is barrel-exported (`src/index.ts:28`).
- The position accessors exist: `undoDepth`/`redoDepth`/`undoTopKind`/
  `redoTopKind`/`undoBaseBoundary` (`supervisor.ts:230-247`).
- **The raw array is unsafe to ship.** `supervisor.ts:227` warns it holds live
  `Node` refs (`op.node`/`op.target`) + snapshot payloads (the `base` op's
  `op.snapshot`, `supervisor.ts:742-745`). A JSON/IPC host must sanitize.
- **Per-entry `applied`/`undone` state is NOT derivable** from the public
  stacks: `replay()` re-applies with `journal:false` and clears only `redoStack`
  (`supervisor.ts:1390`, `:1420`), and a **failed** `redo()` pops the entry
  without re-pushing (`supervisor.ts:1661`, `:1688`). A `state` field would be
  fabricated.

## 3. Verdict — PROCEED-AS-RESHAPED

The engine already exposes the data; the missing piece is a **safe, documented,
non-draining read surface**. Adopt the sanitized reader **without** a per-entry
`state` field (the M4 finding), with absolute-index pagination and exact depths.
Non-breaking additive method + types → **0.5.0** per the VERSIONING-SCHEME.

Rejected: (a) shipping `state` (not derivable without also changing
replay/redo stack bookkeeping — a separate semantic change); (b) requiring hosts
to sanitize the raw array themselves (no contract, easily misused); (c) making
the raw `journal` getter return copies (breaking).

## 4. Executor contract

### 4.1 Public types (`src/core/supervisor.ts`, re-exported `src/index.ts`)

```ts
export interface JournalEntryView {
  index: number   // absolute 0-based journal position (base marker included)
  kind: string    // entry.op.kind, coerced; 'unknown' if absent/non-string
  status: string  // entry.result.status, coerced; 'unknown' if absent/non-string (LAST-APPLY, not live)
}

export interface JournalViewOptions {
  afterIndex?: number  // absolute start override (else the cursor-relative window)
  limit?: number       // window size (default 500; clamped [1, 1000])
}

export interface JournalView {
  entries: JournalEntryView[]  // ascending absolute index
  fromIndex: number            // absolute index of entries[0]
  totalEntries: number         // this.journal.length
  truncated: boolean           // the window does not cover the whole journal
  undoDepth: number
  redoDepth: number
  basePresent: boolean         // a `base` marker exists anywhere in the journal
  undoBaseBoundary: boolean    // supervisor.undoBaseBoundary
  undoTopKind?: string         // omitted when the undo stack is empty
  redoTopKind?: string         // omitted when the redo stack is empty
  maxJournalLength?: number    // omitted when undefined (never condense)
}
```

### 4.2 `Supervisor.journalEntries(opts?): JournalView`

- **Non-draining, synchronous, side-effect-free** — reads only; never mutates the
  journal, never awaits, never calls `render()`/`flush()`/`settleGate()`.
- **Sanitized** — maps only `op.kind` and `result.status`; never exposes
  `op.node`/`op.target`/`op.snapshot`/`result.dirtied`/`entry.id`. The returned
  view is JSON-safe (`JSON.stringify` succeeds even when an entry holds live refs).
- **Pagination** — `limit` default `DEFAULT_JOURNAL_WINDOW = 500`, clamped
  `[1, MAX_JOURNAL_WINDOW = 1000]`; `afterIndex` overrides the start (clamped
  `[0, total]`); otherwise a cursor-relative window
  (`cursorIndex = (basePresent ? 1 : 0) + undoDepth`;
  `toIndex = min(total, cursorIndex + REDO_PEEK)`;
  `fromIndex = max(0, toIndex - limit)`), `REDO_PEEK = 50`.
- **`truncated`** = the window omits journal entries (a prefix omitted, or a
  suffix beyond `end`); an empty result at/after the tail is `truncated:false`.
- **`basePresent`** is independent of `undoBaseBoundary`: the `base` marker is
  index 0, `undoBaseBoundary` is true only when the undo stack is empty AND a
  base exists.
- **`cursorIndex` is deliberately NOT exposed** — it is a best-effort host
  projection (stale after replay-from-undone / a failed redo); hosts compute it
  from the exact depths.

### 4.3 Scope

No change to `journal` semantics, no seek/mutation, no resource, no
serialization of raw entries. The host's MCP group/security choice is host-side
and out of scope.

## 5. TDD red set (`tests/unit/journal-read.test.ts`)

1. Empty journal → `entries: []`, `totalEntries:0`, depths 0, `basePresent:false`,
   `undoBaseBoundary:false`, top kinds omitted, `fromIndex:0`, `truncated:false`,
   `maxJournalLength` omitted.
2. Applied ops → sanitized `{index,kind,status}` rows; **`JSON.stringify(view)`
   succeeds** even though `op.node` holds a live `Node`; no raw fields present.
3. Non-draining — `journal.length`/`undoDepth` unchanged before/after.
4. `{afterIndex, limit}` pagination + `fromIndex`/`totalEntries`/`truncated`.
5. `limit` clamping (0 → 1; >1000 → 1000) and `afterIndex >= total` → `[]`,
   `truncated:false`.
6. Cursor-relative default window (`REDO_PEEK`) around the cursor.
7. Condensed base → `basePresent:true`, index-0 row `kind:'base'`,
   `undoBaseBoundary` true at the floor.
8. `maxJournalLength` echoed when configured.
9. Malformed entry (`op`/`result` missing) → `kind/status === 'unknown'`, no throw.

Green: implement §4, then the trio (`npm test`, `npm run typecheck`,
`npm run demo:smoke`) + `npm run build`.

## 6. Tracker impact

- `docs/decisions.md` — `JOURNAL-READ-API` decision row.
- `docs/defects.md` — a FIXED row referencing this review.
- `docs/skills/designing-pages.md` §11 — the `journal-read.test.ts` coverage row.
- `docs/specs/api.md` — the `Supervisor` read-surface entry.
- `docs/HANDOFF.md` (this repo's consumer handoff) — not applicable; this is an
  upstream feature, tracked here.
