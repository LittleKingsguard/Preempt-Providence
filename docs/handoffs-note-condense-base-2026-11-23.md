# Note — two HOST-VISIBLE behaviours landing in `0.6.0`

**To:** `Provident-Electron` (modularity unit) · **From:** `Preempt-Providence` (the `provident-ssr` package) ·
**Date:** 2026-11-23 · **Re:** unrequested — sent because both land in the release you are consuming, and one of
them is SILENT by design.

Neither item is a request. Nothing is owed on your side. They are sent so you meet them in a design review rather
than through a corrupted undo stack.

## 1 · The condensed base is a LIVE VIEW — holding a reference across a condense is unsupported

**What is true (`docs/decisions.md` `CONDENSE-BASE-IS-A-LIVE-VIEW`).** `condense()` stores the snapshot **without
cloning it**, so the base's `content` entries, nested `props`, anchor `value`, `derived` and `bodyRuns` are the
**same objects** your live graph holds.

**The consequence that matters to a host.** If you keep a reference to one of those objects across a condense and
write through it in place, you do not "change a value" — you **rewrite recorded history**: a later `undo()` or
`replay()` that crosses the base returns the mutated state.

**The owner's ruling, verbatim: "attempts to mutate history are unsupported behaviour."** So:

- the aliasing is **intended**, not a defect awaiting a fix — both candidate remedies (a `JSON` round-trip of the
  base, a targeted deep copy of the mutable carriers) are **declined and unqueued**;
- there is **no detection**: no checksum, no freeze, no warn, no status. The violation is silent. A snapshot
  checksum verified at restore is the one middle ground that would not pay the clone; it is **not** taken and is
  the subject of its own gate, so do not plan around it.

**The supported shape.** Change graph state through the managed channel (`apply` / `state-slice` / the ops), and
**re-read from the graph after a condense** instead of holding node objects across it. Author rule:
`docs/skills/designing-pages.md` §5.4.

**One secondary fact, so you do not test for the wrong thing:** an untouched restore hands back the **same**
objects. Object identity across a restore is expected — "a restore returns fresh objects" was never a promise and
is not one now.

## 2 · A restore that cannot complete now REFUSES loudly instead of silently emptying the graph

**What is true (`docs/decisions.md` `RESTORE-REFUSES-NOT-EMPTIES`).** Before this change, **any** failure inside a
condensed-base restore was **silent total graph loss**: `allNodes()` emptied, `replay().status === 'applied'`, and
zero diagnostics. Measured: 5 nodes in, 0 nodes out, no warn.

**What a host now sees**, and must handle:

- the restore is **pre-flighted before the eviction** (parse + node-id uniqueness + census membership), so an
  unrestorable snapshot is refused with the graph **kept exactly as it was**;
- **exactly one** diagnostic — `restore-refused-invalid-snapshot: …` (or `restore-failed: …` for a throw the
  preflight could not foresee);
- **`replay().status` is `'no-op'`**, never `'applied'`, for a restore that did not happen. `UndoRedoReport`'s
  vocabulary is unchanged; no new status value was invented;
- a refused replay **does not re-apply the post-base journal entries** — the graph is at its pre-base state, so
  re-applying them would double-apply a `rows-mint`. If your host relied on the old silent fall-through, it must
  now branch on `'no-op'`.

**The known trigger today, so you can recognise it rather than debug it:** a page whose def is **seam-wired**
(`component: [{ target: 'children', reference: <def> }]`) ships that node **twice** in the condensed base, so its
restore is refused until `CONDENSE-CENSUS-NO-DEDUPE` lands. The graph survives; the restore does not happen. That
is our defect, not your data.

## 2a · DELTA (same day, after our own gate) — §1's "no detection" is SUPERSEDED

The owner reviewed the gate and accepted detection, so the sentence in §1 ("there is **no detection**: no checksum, no
freeze, no warn, no status") is **no longer true** and is superseded by this section.

There is now **one** detection: `condense()` records a digest of the snapshot and the restore's pre-flight compares it
**before any eviction**. On a mismatch you get **exactly one** `restore-base-mutated: …` warn **per base marker**
(re-armed by the next condense, so it does not repeat on a replay loop), and then the recorded-but-rewritten state **IS
restored** — `replay().status` stays `'applied'`, the post-base entries are re-applied, and **history is not repaired**.
Nothing else in §1 changes: still no clone, still no prevention, the identity half still holds.

Two consequences for you:

- **Do not branch on `replay().status` for this.** A mutated base restores with `'applied'` and a warn — the warn is the
  only signal. (This is the opposite of §2, where a *refused* base reports `'no-op'`.)
- **Do not read a quiet restore as proof that history is intact.** Coverage is the doc's *alias-closure* — the objects the
  snapshot ships by reference (nested `props` values, `content`, anchor `value`, `derived`, `bodyRuns`, batch `rows`,
  `css.cssDef`). A base whose digest cannot be computed is silently unchecked; surfaces the serializer *copies* cannot
  rewrite the base and are correctly not covered.

The cheapest way to stay outside all of it is unchanged: **re-read from the graph after a condense** and never write
through a reference you held across it.

## 3 · If you hold no references across a condense and you read `replay().status`

then both items cost you nothing. If you do hold references, item 1 is the one to remove before you take `0.6.0`.
