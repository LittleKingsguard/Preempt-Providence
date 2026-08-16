# Legacy Handler Reuse — AMENDMENT Critique (three-agent gate, step 2)

Status: adversarial pass on the AMENDED `docs/specs/legacy-handler-reuse-proposal.md`
(§AMENDMENT lines 102-130 — the origin-owner element: `{kind: 'layer-apply', …}` +
the 5 user rulings) against the CURRENT engine, building on the step-1 validity
record (`docs/specs/legacy-handler-reuse-validity.md`). READ-ONLY on engine code —
no source file was modified. The ONLY file written is this one (the gate's
step-2 record). Two temporary probe scripts were run against `src/core` and
deleted after use (probe results quoted below).

Companions: `legacy-handler-reuse-review.md` §11 (step-3 verdict of the base
proposal + the amendment's park record), `docs/pending.md` (PARKED row +
speculative row), `docs/specs/ops.md` §2.2/§2.3 (the detach/move contract),
`docs/specs/payload.md` (P-7), `docs/specs/node.md` §6.2.

Validation trio at end of pass: `npm test` / `npm run typecheck` (reported at
the bottom).

---

## 0. Probe results — two empirical checks that change the ground truth

**PROBE-1 (detach semantics):** `execute({kind: 'detach'}, …)` on one child of
a 3-child family link produced: `parent.children = []`, BOTH siblings `state =
'unplaced'`, `kidA.state = 'unplaced'`, parent family `'parent'` anchor count 0.
**The ops-level detach DESTROYS the entire family link** — siblings lose their
child anchors and are cascade-destroyed by the sweep. `ops.ts:66-77`'s
`parentCount = link.anchorsOf('parent').length` counts PARENT anchors, which is
always `1` on a family link (`parent: {count: 1}`, link.ts:12/86-95) — the
`else`/`removeAnchor` branch is unreachable for family links. The supervisor's
`detach`/`move` branches (supervisor.ts:442, 452) do the same.
**The validity record's claim (validity 1c) that "the detach count logic
(ops.ts:66-77: removeAnchor when >1 child remains, link.destroy() only for the
last child) is the safe path" is a MISREADING.** The safe, sibling-preserving
detach EXISTS in the engine — but it is `payload.ts:29-52` `detachNode`
(module-private: splices the one child anchor, marks the node pending, dissolves
the parent side only when the last child leaves), pinned by payload.md P-7 and
payload.test.ts:36-38 ("sibling payload untouched"). The engine therefore has
TWO detach semantics, and ops.md §2.2 step 1 ("`removeAnchor(childAnchor)`") +
node.md §6.2 ("last-child removal escalates: count-underflow → link.destroy()")
pin the SAFE semantics that ops.ts does NOT implement — a pre-existing
implementation-vs-spec drift in the move/detach ops (its own defect-row
question, finding M4).

**PROBE-2 (ghost placement consumers):** fixture was incomplete (the root's
token child anchor is created at translate, not by `new Node()`), so the
`pathChildrenFor` destroyed-owner question (node.ts:236-254 has NO `destroyed`
check on content-anchor owners, while `enumPathWalks` node.ts:153 does) could
not be confirmed live. The asymmetry is real in code; the render consequence is
unverified (DOM adapter removes via the structure event). Spec must verify or
pin cleanup (finding A4).

---

## 1. The rollback contract — [blocker] B1, [a-big] A1, [a-big] A3

**[blocker] B1 — the rollback CANNOT reuse any existing detach machinery; the
"detach-style" teardown must be a NEW shared helper, and the amendment's
"ONE layer removal" is journal-atomic only, not execution-atomic.**
- Atomicity: the layer-apply EXECUTE is one synchronous op (mint + attach +
  layer + flags) — but it is the engine's FIRST multi-node journaled op, and
  `execute()` has no transaction wrapper. A failure at attach-k (a `unique-order`
  priority collision is reachable when NodeData carries explicit priorities,
  link.ts:96-108) leaves k-1 minted nodes attached and unjournaled — `apply`
  returns `rejected` with a mutated graph (supervisor.ts:490-502). The
  multi-mutation state-slice loop (node.ts:1172-1188) has the same
  non-transactionality precedent, so the engine would silently accept partial
  application unless the executor adds its own rollback.
- Rollback is N steps (enumerate minted set → per-node detach → remove layer),
  NOT one engine op: `supervisor.undo()` handles only `attach`/`destroy`
  (supervisor.ts:524-540) — a new undo branch is needed with its own
  partial-failure modes: (a) a minted node already moved — safe-detach works on
  its CURRENT child anchor regardless of current parent; (b) a minted node
  already destroyed (creator died first) — must skip, teardown must be
  idempotent; (c) the last-child case — `removeAnchor` throws `count-underflow`
  (link.ts:125-134), so the helper must branch: `>1 child → removeAnchor;
  1 child → link.destroy()` (destroy bypasses the min check and dissolves the
  parent's parent anchor — safe, PROBE-1), or adopt the payload.ts splice
  pattern (guard-bypassing, sibling-preserving, P-7).
- The minted-set record's home is NOT pinned: the three candidate homes have
  different lifetimes — (i) journal entry result (`{status, dirtied}` could gain
  `minted: [ids]` — replay/undo identity; `journalIfApplied` stores the op
  verbatim, supervisor.ts:328-336, so `nodes: [NodeData]` journals cleanly but
  the MINTED IDS do not); (ii) creator layer field (`originNodes: string[]` —
  NodeLayer is an open extension, types.ts:204-208 — dies with the creator);
  (iii) module-level registry `mintedId → origin` (survives creator death;
  needed anyway for the nodeToLegacy preservation-override read, finding B2/§3).
  The amendment names none of them.

**[a-big] A1 — the record dies with the creator, and the creator can be
destroyed without any rollback.**
A `destroy` op on the creator (or the sweep destroying a detached creator)
kills in-family minted nodes via the existing cascade (chain → destroyed owner →
'unplaced' → finalizeDestroyed, registry.ts:131-137), but a MOVED minted node
(in-tree via a live non-origin parent) SURVIVES — still origin-marked, with the
creator's layer record gone: permanently reverse-excluded (silent save-data
loss, translate.ts:1074) and unreachable for cleanup. Nothing re-evaluates it
(see §2 trigger). The per-node marker must carry the origin/layer reference and
the record must be queryable without the creator, or a destroy-side hook must
re-evaluate the minted set when the creator dies.

**[a-big] A3 — replay determinism needs more than deterministic ids.**
Validity 1a's `"${layerId}-n<i>"` fix resolves the double-mint (mintNodeId is a
global counter, node.ts:29-32), but replay resolves `op.node` by id
(supervisor.ts:505-522) and the journal entry does NOT carry the minted ids —
replay of a layer-apply whose nodes still exist would mint a SECOND copy onto
the same layer (addLayer replaces by id, node.ts:542-545 — a layerId collision
is plausible since the op is named). The journal entry must persist the minted
set (`result.minted`), and replay must resolve minted ids to existing nodes
before re-minting — same pattern as the `op.node` resolution.

## 2. Ruling 2 — the trigger and the exact predicate — [blocker] B2, [minor] M3

**[blocker] B2 — after a teardown detach the node's state is ALWAYS 'unplaced'
(no child anchor → 'unplaced', node.ts:419); the sweep gate (registry.ts:92)
can NEVER see a detached node as in-tree, so "survives if it has a traceable
permanent parent" is unimplementable as a gate-time check.** The survival
decision must be made BEFORE the detach, per minted node, walking the CURRENT
parent chain (never via `chainRoot`'s summary alone — the chain must ALSO not
pass through another origin-marked node; a minted node nested under another
minted node is doomed — the "whole subtree" reading):
- **Pinned predicate (proposal):** doomed iff the chain reaches a non-permanent
  terminal — `chainRoot(node, ∅) ∈ {unplaced, destroyed-owner, loop, slice-root,
  token 'other'}` (chainRoot kinds, node.ts:72-78/279-295); survives iff the
  chain reaches a permanent token — `{token rootNode, token contentNodes, token
  component}` (the 'component' token ⇒ prototype ⇒ the gate also skips it,
  registry.ts:92 — consistent; a minted node attached under a def prototype
  survives as a prototype — pin it). `token 'other'` (chainTokenKind node.ts:79-84)
  is NON-permanent — the exact set must be spelled out.
- Survivor promotion is itself an unpinned contract: the survivor keeps no
  detach (no markPending — nothing else runs), but its ORIGIN MARKER MUST BE
  CLEARED — an origin-marked in-tree node is forever reverse-excluded
  (translate.ts:1074), i.e., silent save-data loss. "Survives" = "becomes
  authored content." The amendment says nothing about promotion.
- The 2-vs-5 interaction, precisely: ruling 5's "cascades the WHOLE origin-owned
  subtree — including … placed elsewhere (moved but still traceable to the
  origin)" vs ruling 2's "deletes when NO traceable permanent parent" remain
  two readings: (i) reach-every-minted-node, gate decides (a moved node under a
  non-origin permanent parent SURVIVES as promoted authored content) — under
  which "including placed elsewhere" adds nothing beyond the record's reach;
  (ii) destroy every minted node regardless of the new parent (the "still
  traceable to the origin" phrase). The single-parent reality (SI-1) makes the
  two collapse into one testable decision at each minted node, but the amendment
  must SAY which reading is the contract.
- Authored-children-under-a-minted-node: the existing cascade destroys authored
  content hanging under a doomed minted node (chain terminates at the destroyed
  owner → 'unplaced' → finalizeDestroyed, registry.ts:134) — there is NO
  engine-side way to distinguish authored from minted children once attached.
  The amendment's "WHOLE origin-owned subtree" reads as accepting this, but it
  must be pinned: rollback destroys authored content attached under a minted
  node.

**[minor] M3 — the validity record's leak framing is overstated:** "unplaced …
pollutes the coalesced remote-dirty pass (registry.ts:100)" — the `registered`
set is never pruned for ANY node (no `registered.delete` exists), destroyed
nodes already linger; the pass skips destroyed (registry.ts:100, 116-117). The
lingering case is a marker/record problem (A1), not a new pollution class.

## 3. Ruling 3 — the marker split and the reverse override — [a-big] A2, [minor] M1

**[a-big] A2 — the ENTIRE origin contract evaporates on a serialize/loadState
round-trip.** `serializeNode` ships no layers and no runtime-minted/origin field
(serialize.ts:72-129); `loadState` re-seeds plain nodes (constructor,
node.ts:357-410). A minted subtree survives a save/reload as ORDINARY family
children — marker gone, layer record gone: the reverse exclusion stops applying
(they emit as authored), the rollback handle is gone, preservation-by-reversal
is moot. The render doc IS `serializeSlice` output, so minted nodes are
serialized on EVERY render; any persistence client (clientConfig.persistence)
or SSR rehydrate promotes them. Two options, needing a user call: (a) accept and
pin "origin ownership is runtime-only; any serialize/load round-trip promotes
minted nodes to authored content" (cheap, honest), or (b) serialize the marker
(new NodeBaseData field + serializeNode/loadState + the SerializedAnchor
`{priority, order}`-only type, serialize.ts:9-16 — the drift the validity record
flagged). Option (a) also retroactively defines the promoted state's reverse
behavior.

**[minor] M1 — the preservation-by-reversal override site:** the future flag
reads at translate.ts:1074 — the filter becomes
`!c.runtimeMinted && !originMarked(c) || preservedByOrigin(c)`; `originMarked`
and `preservedByOrigin` need the §1 mintedId→origin registry (nodeToLegacy has
no creator/layer context — translate.ts:1074-1075 recursion passes only the
node + isContentRoot). One site, one registry — the override is a design
decision, not machinery, exactly as the validity record said.

## 4. Ruling 5 — cascade shape vs multi-parent and placement — [a-big] A4, [blocker] B2 (cross-ref)

**[a-big] A4 — a doomed minted node that is a PLACEMENT consumer leaves
dangling `content` anchors on the per-name placement Link** (finalizeDestroyed
removes nothing, registry.ts:127-137); the destroyed node's anchor stays a
path-children candidate for the container's next path compile — `pathChildrenFor`
has NO destroyed-owner check (node.ts:236-254) while `enumPathWalks` does
(node.ts:153). PROBE-2 could not confirm the render consequence (fixture
incomplete — the root's token edge is translate-minted), so the teardown spec
must either remove the minted node's non-child anchors (content/container) as
part of the teardown, or a test must prove the render path prunes destroyed
path-children. G24 (multi-parent) is NOT a conflict: minted nodes are family
single-parent (attach path); the seam exemption (node.ts:720-727) only admits
def-prototype children, which minted nodes never are.

## 5. Externalities — the op as an engine primitive — [a-big] A5, [minor] M2

**[a-big] A5 — NodeData payload scope is unpinned and the constructor's
seed-anchor channel (node.ts:380-409) would smuggle placement/component anchors
into the minting.** If layer-apply's `nodes: [NodeData]` accepts the anchors
seed shape: (a) a minted `container`-anchor node triggers EMPTY-OWNER hiding
(render-helpers.ts:912-928) — legitimately, but it is a render-behavior surface
the amendment never claims; (b) the ancestor-name veto (`ancestorConsumesZone`,
node.ts:65-70) applies at TRANSLATE only — a runtime-minted container presenting
a zone an ancestor consumes bypasses the loop-prevention veto entirely (the
placement-attach op has the same exposure — ops.ts:96-117 — so this is an
inherited, not new, class); (c) the `component-source-duplicate` guard
(node.ts:694-705) would fire on minted source anchors. Pin: v1 layer-apply mints
family children ONLY; anchors in NodeData are rejected/warned. This also keeps
the SED/chain-kind machinery untouched (no new chain kind; `token 'other'` is
unreachable from minted edges since attach targets are live Nodes).

**[minor] M2 — bridge routing surface:** `receiveNextState({children, …})` —
legacy payloads MIX state keys and children (the corpus' `showComments` does
css + children). The mapping "the WHOLE call becomes ONE layer-apply op" must
define the mixed payload: do the state keys ride the op as layer fields on the
creator (the op's `decls`/state carry), or is the call split (slice + structural
op — two journal entries, killing the "ONE atomic op" claim)? Pin the
mixed-payload contract. The events surface needs no change (`PreemptEvent`
structure op is `StructuralOp['kind']` — a new kind extends the union
mechanically, events.ts:13).

## 6. Scope discipline — the park holds; the cut stands

The amendment's own ruling 1 (PARKED — revisit after the §7 gate) + the
pending.md row are consistent with the review §11 record. Recommendation:
- The review §7 children-injection CUT is the BINDING contract for the current
  implementation; the amendment does not supersede it — it is the record of a
  FUTURE re-opening. The 8 decisions land with the cut intact.
- The §AMENDMENT text in the proposal is design intent, not contract; no spec
  section for the element should be written at this gate. The element's future
  gate's acceptance criteria are now: the validity needs-X (replay id
  determinism, teardown machinery, trigger) + findings B1/B2/A1-A5/M1/M2 +
  the pinned predicate set (§2).
- The base review's §11 was written before persisted step-1/2 records existed
  (its pass-provenance note says so); with the validity + this critique file now
  persisted, a step-3 re-verdict of the ELEMENT is properly deferred to the
  unpark gate — no re-litigation now.

## 7. New tests/surface (for the future gate)

- **unit:** layer-apply execute transactionality (failure at attach-k rolls
  back); journal shape incl. `result.minted`; replay id determinism (same ids,
  no double-mint, existing-node resolution); teardown idempotency matrix
  (moved / already-destroyed / already-reparented / last-child / only-child,
  sibling preservation via the child-count safe-detach or payload-style splice);
  creator-destroyed reachability (A1); marker loss on serialize/load (A2);
  chainRoot predicate table (rootNode/contentNodes/component/unplaced/
  destroyed-owner/loop/slice-root/'other' token); authored-child-under-minted-
  node cascade; ghost placement anchors (A4); undo/redo of layer-apply.
- **integration:** legacy `receiveNextState({children})` → ONE op; rollback via
  layer removal + undo; ruling-2/5 scenario pages (moved-under-root survives+
  promotes; nested minted doomed; placement-consumer minted).
- **blind/stress loops (AGENTS.md 10/11):** legacy envelope with children
  writes; replay×N idempotency; serialize/load round-trip promotion; fork-stress
  profile watch — the op touches no existing demo page (the static page has no
  handlers; the runtime pages' handlers are modern-convention), so pass-2
  profile totals should be untouched; the new legacy page adds dispatch-time
  cost only for seam handlers.

---

## Verdict summary

The amendment remains **feasible in shape but under-designed in contract**: the
step-1 validity verdict holds for the op vocabulary, the children-injection
mapping, and the marker-split direction — but its safety prescription for the
rollback (the ops.ts detach path) is wrong (PROBE-1), the ruling-2 "traceable
permanent parent" is unimplementable at gate time and must be a pre-detach
predicate with a survivor-promotion contract (B2), the minted-set record's
durability (A1) and its serialization fate (A2) are unpinned, and the op's
multi-node transactionality + replay identity (B1/A3) are new engine-first
problems. The parked status should hold; the §7 gate lands with the cut.

## Predicted user decisions (the step-3 gate will need)

- **D-1** — the 2-vs-5 contract: the pre-detach predicate (§2) — doomed vs
  promoted-survivor (marker cleared ⇒ authored); "WHOLE subtree" includes
  authored children under minted nodes.
- **D-2** — marker durability: accept runtime-only + documented promotion on
  serialize/load (a) vs serialize the marker (b).
- **D-3** — creator-destroyed trigger: destroy-side hook + registry record
  (engine change) vs accept rollback-only detection with the A1 leak.
- **D-4** — NodeData scope: family children only in v1 (recommended) vs
  seed-anchor acceptance.
- **D-5** — mixed legacy payload: one op carrying state fields vs split
  slice+structural.
- **D-6** — the pre-existing ops.detach/move spec drift (ops.md §2.2 / node.md
  §6.2 vs the whole-link-destroy implementation): a separate defect row + fix,
  or documented intent — needed independently of the element.
- **D-7** — teardown cleanup of non-child anchors (content/container) of doomed
  minted nodes, or a render-path destroyed-prune verification test.
- **D-8** — park confirmation: element stays PARKED; §7 lands with the cut;
  this critique + validity are the future gate's acceptance record.

---

## Verification

- `npm test` — 40 files, **779 passed** (expected; no source changed).
- `npm run typecheck` — **clean** (tsc --noEmit).
- No engine source was modified; the two probe scripts were deleted after use.
