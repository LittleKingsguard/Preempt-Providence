# Serializer census — gate (`serializer-census-gate-review`)

**STATUS: PASSED WITH RESHAPE — the proposed snapshot census is REJECTED as an instrument. Two smaller items are
accepted (one needs no document change at all), plus a third item the gate found on the way: a spec sentence that is
FALSE.**
Three-agent gate (AGENTS.md item 9): validity and critique ran independently and read-only; change-analysis
adjudicated both and re-checked the decisive anchors at `bada452`. Date: 2026-11-23.

**The ask (owner's pick, 2026-11-23):** should the serialized snapshot carry a **census** so a restore can
(a) detach the previous generation of def-prototypes and (b) know which restored nodes are content roots?

---

## 1. Verdict per fact

### (a) The def-prototype generation — **NO CENSUS. The fact exists; an id list cannot encode it.**

The destroy set at restore time is exactly `scope.defPrototypes` / `scope.defRootPrototypes`, readable with the
existing enumerators (`registry.ts:206-213`) and hub-filtered precisely as `condense` already does
(`supervisor.ts:957-960`). **A node-id census cannot name a generation:** doc ids are re-seeded verbatim
(`serialize.ts:115` → `new Node(d)`), so after re-registration an id names **both** generations — and the leaked
first generation is the one **absent from `this.nodes`**, so neither the landed `this.nodes`-only eviction loop
(`supervisor.ts:1021-1038`) nor an id census reaches it. The only generation-distinct handle is **object identity
in the live registry**.

**The real gap is a missing detach primitive, not a missing datum.** `destroy()` → `destroyLinks` detaches only
`child` / `content` / `container` (`node.ts:956-973`); `source` / `target` / `duplex` are in `NAME_KEYED_ROLES`
(`node.ts:59`) and are **never removed**. Those are exactly the anchors the def registry recovers a name from
(`registry.ts:215-226`) and that a provider read consults (`providersOn`, `providerValueFromLink`, `resolve.ts:36-47`).
**So the leak is not merely memory:** `providerValueFromLink` can return a **dead provider's value**, the same
order-dependence already filed as OPEN `R-VPD-1`. A census would not have closed that by itself.

### (b) A placed content root's membership — **NOT DERIVABLE. One optional per-node BOOLEAN, not an id list.**

Derivation fails on every route the critique hoped for: a `content` anchor is a **zone request** on the consumer
(`translate.ts:1063-1079`, `ops.ts:125-143`), never a marker of payload ownership; the `contentNodes` token edge is
**destroyed** when a real family parent supersedes it (`node.ts:1022-1023`); and `RenderNodeState.state` is a hardcoded
`'in-tree'` at emit (`serialize.ts:116`), so provenance never ships.

**The minimal legal form is `isContentRoot?: true`, emitted only when true, advisory on restore.** Not an id list:
an id list collides with the fresh row ids (`serialize.md:138-139`) and with the slice-membership rule
(`serialize.ts:401-410`), and it can name a node that is not in the doc; a boolean rides the node it describes.
**Absence must be silent-but-recorded**, not silent-and-hidden: an older snapshot restores with today's behaviour,
and the row says so.

### (c) Found on the way — **`serialize.md:99-100` is FALSE.**

> *"plain prototypes stay out of `this.nodes`"* (`serialize.md:99-100`, echoed in the `supervisor.ts:951-952` comment)

`_restoreBase` seeds every `loadState` entry (`supervisor.ts:1047`) and registers **all** seeds (`:1050`), plain
prototypes included. The pin is true of the **translate** path only. Item 3 below.

## 2. What the gate rejected and why

- **A destructive census member inverts the schema boundary.** `loadState` is pinned *pure parse+validate*
  (`serialize.md:51-52`); a field that instructs a restore to **destroy** turns the document into an instruction
  stream. `defPrototypes` only *registers* — the precedent does not generalise.
- **The containment precedent is shape-only.** Today's census validates `nodeId ∈ docIds` and a post-seed
  `state === 'prototype'` tripwire (`serialize.ts:402-410`, `:535-540`) — no authenticity, and the name is
  unvalidated while the seam resolves def roots **by name** (`R-VPD-1`). Adding destruction or sweep-exemption
  privileges to such a surface is a remote-kill / immortality hazard, not a feature.
- **The failure mode lands where failures are swallowed.** The base branch runs inside `try/catch {}`
  (`supervisor.ts:1672-1685`) and base markers are never pushed to the undo stack (`:975-982`) — a malformed census
  would leave the graph evicted, un-re-seeded, unrecoverable.
- **The stated cost input was wrong:** no fork page serializes or condenses; the real cost of a bigger doc is the
  condense size guard (`estBytes` vs the pre-base journal ⇒ a host near the threshold flips to
  `condense-skipped-size`).

## 3. Dispositions

| # | Item | Fix shape | Gate? | Version |
| --- | --- | --- | --- | --- |
| **1** | **`DESTROY-SHARED-LINK-RESIDUE`** — a restore never detaches the previous def-prototype generation's `source`/`duplex`/`target` anchors from the hub-shared component Link | In `_restoreBase` step 1, additionally iterate the **hub-filtered registry enumerators** (the `supervisor.ts:957-960` pattern) and `removeAnchor` each instance's `source`/`duplex`/`target` anchors, then evict — **before** `reRegisterDefPrototypes` (`:1049`), **never** `link.destroy()`, **never** by id. Do **not** widen `Node.destroy()` (the destroy→re-attach rescue pin) | **No** — ordinary defect, clear fix shape, red-first | patch |
| **2** | **`RESTORE-PLACED-CONTENT-MEMBERSHIP`** — a restored *placed* content root loses the sweep exemption | `isContentRoot?: true` in `RenderNodeState` (emit only when true; advisory on restore; sliced like the def census) + seed passthrough + `registerContentNode` in `_restoreBase` alongside the existing token test, replacing it | **This record is the gate**; needs the `serialize.md` contract sentence and red tests before code | minor — absorbed by the unreleased `0.6.0`, else `0.7.0` |
| **3** | **`RESTORE-REGISTERS-PROTOTYPES`** — the restored graph contains prototypes in `this.nodes`, contradicting the pin | Either skip prototypes at `supervisor.ts:1050` so the restored shape matches the pin, **or** amend `serialize.md:99-100` to admit them post-restore (red set decides which; a pass-2 divergence decides against skipping) | **No** — red set first, then the smaller of the two | patch |

**Document amendments owed:** `serialize.md:99-100` and the step-5 sentence at `:93-97` (they must say *all* seeds, or
the recipe must stop registering prototypes); the `supervisor.ts:951-952` comment gains a "translate-path only"
qualifier. **`loadState` stays pure parse+validate** — that pin is why (a) can never be an instruction here.

**Decision row:** `NO-SNAPSHOT-CENSUS` (ACTIVE) — a node-id census in the snapshot is REJECTED; detach is by object
identity from the registry; the only document-carried placement fact is a per-node content-root boolean.
**Residuals recorded, not hidden:** a name-less-Link prototype is census-invisible to a cold host (it is also invisible
to the existing census by design); a row re-mint gets a fresh id, so a minted content root cannot carry the boolean
(excluded at emit today); `state` still never round-trips.

## 4. What the owner gets out of this

**No census, no public document shape for the destruction path, and one boolean for the membership path.** The
architecture question dissolves into two ordinary fixes (one gate-free) plus one spec correction — and it surfaced a
**correctness** hazard (a dead provider's value via stale shared-Link anchors) that the "leak" framing had hidden.
