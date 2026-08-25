# Feature 4 — Layer preservation-by-reversal flag (three-agent gate, step 3 — change-analysis)

Date: 2026-08-25. Source: `docs/next-feature-batch-0.2.0.md` §Feature 4 (§4.25)
+ §User rulings 23/24/26 (2026-08-24). Companion context:
`docs/specs/handoffs-review-8.md` (Feature 3 — the journal-condensing base, the
serializeSlice/loadState round-trip recipe the flag's round-trip inherits),
`docs/specs/translate.md` §REVERSE-OF-CLEAR + the DEFECT #28 reverse block,
`docs/specs/serialize.md` §4 (SER-R1/SER-H8/minted-id residuals),
`docs/specs/ops.md` §6/G14, `docs/defects.md` (DEFECT #28, DEFECT #23 node-scoped
layerId), `src/core/{translate,serialize,ops,node}.ts`.

Steps 1 (validity — VIABLE-WITH-RESHAPE) and 2 (critique — FEASIBLE-BUT-FRAGILE)
ran before this pass; the step-3 verdict lands here in the compile-horizon-review
format. This agent is READ-ONLY — no files edited except this verdict. The three
user rulings (23, 24, 26) are FIXED and not relitigated; D1-D8 pin the mechanics
the rulings left open. Verdict-only pass — the trio was not re-run here.

## Step 1 — Validity agent (summary)

Verdict: VIABLE-WITH-RESHAPE. The reverse filter (translate.ts:1397) is a
one-line override. Re-mint on re-translate is FREE (reversed output is plain
authored data). Guards 1/2 (handlers-CLEAR, auto-mint-id) are free by reusing the
existing emission. **Crux**: the minted node carries only `originLayer: string`
(the layer ID); the layer OBJECT (where `preserveByReversal` lives) is on the
CREATOR/target, not the minted node. The reverse site has NO node→layer
resolution. Reshape options: (a) a per-node marker copied at mint time, or (b) a
`layerId → preserveByReversal` registry. **Serialize asymmetry**: the proposal
pins ONE override site = reverse only; `serialize.ts:119` applies the same
originLayer exclusion. Is preservation reverse-only or should serialize honor it
too?

## Step 2 — Critique agent (summary)

Verdict: FEASIBLE-BUT-FRAGILE. Four structural challenges:
- **Paradigm** — the flag asserts a node is BOTH origin-owned (runtime-derived)
  AND reverse-as-authored (deliberate edit) — a reverse-time projection, not a
  coherent state. `originLayer` is overloaded (ownership tag + reverse-exclusion
  marker); the flag splits the latter without touching the former.
- **Promotion already does this** — node.ts:742 clears `originLayer` → a promoted
  node reverses as authored PERMANENTLY. The flag buys only the ephemeral
  reverse-time version. **The critique's strongest point: is the flag redundant
  with promotion?**
- **Chicken-and-egg** — the layer with the flag is `addLayer`'d AFTER the nodes
  mint (ops.ts:179-185 mint, 190 addLayer; rowsMint 431 mint, 449 addLayer). A
  per-node marker copied at mint time CANNOT read the flag from the layer (it
  doesn't exist yet).
- **Re-mint flag loss** — rowsMint on a same hookName REPLACES the layer
  (ops.ts:449) with a flag-less object → the flag is silently dropped on the
  second mint. A per-node marker would also be stale on the reuse path.
- **Condense flag loss** — the condensed base is built by serializeSlice
  (supervisor.ts:658 → serialize.ts:182) which excludes origin-owned nodes; after
  restore rows re-mint with a flag-less layer → preservation is LOST on a
  condense round-trip.
- **Cross-graph registry risk** — a `layerId → preserveByReversal` module-level
  registry re-introduces the S12-style cross-graph leak for caller-supplied
  layer-apply ids (not node-scoped).
- **Serialize asymmetry is STRUCTURAL** — serializeNode emits children as IDs
  (serialize.ts:119), no schema slot for a preserved subtree's full data →
  serialize CANNOT honor the flag without a schema change. The ONE-site pin is
  forced, not a choice.
- **Re-translate id churn** — a minted-only node reverses without an id (DEFECT
  #28) and re-mints with a FRESH id each loop — identity lost across
  reverse→re-translate.
- **Costs vs benefits** — the benefit is a convenience (get minted content back as
  authored without re-authoring); promotion + host re-author already provides it
  with zero new machinery. The flag adds a carrier field + mint-ordering fix +
  re-mint loss + condense loss + serialize asymmetry.

## Step 3 — Change-analysis agent (verdict)

Status: **PROCEED-AS-RESHAPED** — the proposal and the three user rulings are
sound and implementable, but the executor must land the reshaped shape below. The
central adjudication that resolves the step-2 "chicken-and-egg" and the
"redundancy with promotion" challenges: **the flag is read at REVERSE time via
the parent→layer relationship, NOT copied at mint time and NOT a module-level
registry (D1); and the flag is a REVERSE-TIME PROJECTION, not a state change —
it is NOT redundant with promotion (D3).** The step-2 reshape options (a) per-node
marker and (b) registry are both REJECTED (D1); the reverse-time parent read is
the workable third shape. The re-mint + condense flag loss (D4) and the serialize
asymmetry (D5) are DOCUMENTED-AS-LOST residuals — the flag is a runtime layer
property, and "layers never serialized" (ruling 24) makes those losses the SAME
residual every layer property suffers across a round-trip, not new contract
breaks. The whole-subtree cascade (ruling 26) is a threaded context flag through
the recursion (D2) — still ONE override site (the reverse filter).

### What the proposal asks

A `preserveByReversal: true` LAYER FIELD (ruling 23) makes origin-owned nodes
(minted by layer-apply/rows-mint, marked `originLayer`) reverse as DELIBERATE
EDITS in `nodeToLegacy` (translate.ts:1397) instead of being reverse-excluded.
Whole-subtree cascade (ruling 26). The flagged layer COMPRESSES into normal
authored node data (current compiled state only, no layer machinery, no flag
residue — §4.25). Re-translate re-mints fresh (ruling 24). ONE override site =
the reverse filter. TDD: preserve-reversal.test.ts.

### Feasibility verdict — the executor shape (all 8 decisions)

**D1 — the flag is read at REVERSE time via the parent→layer relationship
(chicken-and-egg resolved; no registry).** The minted node's parent IS the
creator/target that holds the layer: layer-apply mints family children of the
target (ops.ts:183 `addAnchor('child', node)`), rowsMint mints family children
too. At reverse time the layer EXISTS (it was `addLayer`'d after the mint, and
reverse happens later on the live graph). The reverse filter resolves
`child.parent.layers.find(l => l.id === child.originLayer)?.preserveByReversal`.
This is NODE-SCOPED (the parent's own layers), NOT a module-level registry — no
cross-graph leak (the DEFECT #23 node-scoped layerId precedent). The step-2
reshape options are both REJECTED: **(a) the per-node marker copied at mint time
is UNWORKABLE** — the layer doesn't exist at mint (ops.ts:179-185 mint, 190
addLayer; rowsMint 431 mint, 449 addLayer), so the marker cannot read the flag;
**(b) the `layerId → preserveByReversal` registry is REJECTED** — a module-level
map re-introduces the S12-style cross-graph leak for caller-supplied layer-apply
ids (not node-scoped). The reverse-time parent read is the workable third shape.
**Edge case (documented):** a minted node MOVED off its creator (parent ≠
creator) — its layer lookup fails; it reverses per its own `originLayer`
(excluded) unless the new parent's layer is flagged. This is the teardown-
promotion case (moved minted nodes are promoted/doomed on teardown, node.ts:742),
so the live-moved edge is rare and documented.
**ADV-S17 (2026-08-25 adversarial pass):** the flag is FIRST-MINT-ONLY — a
same-layerId re-apply is an idempotent no-op (ops.ts:168), so a re-apply passing
a DIFFERENT flag is silently ignored. The flag does not change on a same-id
re-apply; a host that wants to toggle preservation must tear down + re-mint.

**D2 — the whole-subtree cascade is a threaded context flag (ruling 26).** The
reverse filter gains a `preserved` context threaded through the `nodeToLegacy`
recursion. A child ships if `!isContentRoot(c) && !c.runtimeMinted &&
(c.originLayer === undefined || preservedContext || layerFlagged(c))`. Once a
preserved node ships, its descendants (minted or authored) ship too (the cascade).
This is still ONE override site (the reverse filter) — the flag is consulted ONLY
there; the context is a parameter, not a second site. The "ONE override site"
claim (translate.ts:1397) holds: the only place the flag is read is the reverse
filter.
**ADV-S3/S15 (2026-08-25 adversarial pass):** the cascade is scoped to
ORIGIN-BUILT descendants only — the `!c.runtimeMinted` guard (translate.ts:1405)
runs BEFORE the `preserved` check, so a preserved subtree's runtime-minted
descendant (a clone-instance or seam-adopted def child) is still dropped. D2's
"whole subtree ships" is narrowed to "origin-built descendants only"; the
runtimeMinted exclusion is a separate documented DEFECT #11.
**ADV-S4 (2026-08-25):** the cascade is TEMPLATE-WALK-ONLY — the content-payload
path (reverseTranslate → nodeToLegacy(c, isContent) at translate.ts:1441) calls
with `preserved` unset, so a preserved subtree passed as a payload root loses
the flag for its minted descendants. A host that wants a preserved subtree in a
content payload must reverse it via the template walk.

**D3 — the flag is a REVERSE-TIME PROJECTION, NOT a state change (the promotion
distinction — the critique's strongest point answered).** Promotion (node.ts:742)
is DESTRUCTIVE: it clears `originLayer` + unregisters the node from
`mintedByOrigin` → the node becomes authored PERMANENTLY and the layer's
teardown/keyed-reuse machinery loses it. The flag is a READ-ONLY reverse-time
view: the node STAYS minted (origin-owned, teardown-able, re-mintable) but its
reverse output ships as authored. **The flag is NOT redundant with promotion** —
it serves the host that wants reverse-as-authored on a LIVE minted layer without
destroying the minted identity (e.g. a host that reverses a minted subtree for
one export but keeps the layer for continued keyed edits). Promotion covers the
destructive case (host tears down the layer → node reverses as authored
permanently); the flag covers the non-destructive case. They are complementary,
not redundant.

**D4 — the flag is a runtime layer property, never serialized (re-mint + condense
loss are DOCUMENTED, not blockers).** The flag lives on the layer object; layers
are runtime-only (ruling 24, serialize.md §4 untouched). Therefore: **(a) re-mint
flag loss** — a same-hookName rowsMint REPLACES the layer (ops.ts:449) with a
flag-less object → the flag is dropped on the second mint; the host RE-DECLARES
it in the re-mint op. Documented contract: the flag is per-op, not sticky. **(b)
condense flag loss** — the base excludes origin-owned nodes (serialize.ts:181-182);
after restore rows re-mint with a flag-less layer → preservation is lost across a
condense round-trip. This is the SAME "layers are runtime-only" residual every
layer property suffers across a round-trip (handoffs-review-8 D9 residual 2) —
NOT a new loss. **The batch record MUST NOT carry the flag** — that would violate
"layers never serialized" (ruling 24). Documented, not a blocker.
**ADV-S6 (2026-08-25 adversarial pass):** a KEYED UPDATE (reusing rows in place,
minting only new keys) ALSO wipes the layer flag — the UNTOUCHED preserved rows
lose preservation (the keyed addLayer re-runs flag-less). The D4 loss is not
limited to a full re-mint; a keyed update drops preservation on reused rows too.
**ADV-S5/S24 (2026-08-25 fix):** the KEYED rows-mint path (ops.ts:449) now
forwards `preserveByReversal` (mirroring the plain path at 346 + layer-apply at
190) — a keyed preserved mint lands the flag on the first mint AND on a keyed
update. Tests: preserve-reversal ADV-S5/ADV-S24.

**X-CROSS-FEATURE (2026-08-25 0.2 cross-feature adversarial pass — DEFECT 1,
DOC GAP, no code change):** two condense-interaction residuals are now
DOCUMENTED explicitly (the engine is D4-consistent — the restore re-mint drops
the flag exactly like a full re-mint):
- **X2/X11 — live-vs-restore keyed asymmetry.** A LIVE keyed update on a
  preserved keyed layer re-forwards the flag (ADV-P-S5/S24), but a
  condense → `replay()` graph-REPLACE restore re-mints via
  `_restoreBase` (`sourceName:'condense-restore'`) WITHOUT the flag (it is not
  recoverable — absent from the BatchRecord, and D4 forbids carrying it). After
  a replay-from-base a preserved keyed layer is flag-less (rows reverse-excluded)
  until the host re-declares `preserveByReversal:true` in a fresh mint.
- **X12 — non-rows preserved subtree is LOST across the base.** A preserved
  LAYER-APPLY subtree (origin-owned, non-rows) is excluded from the base by the
  pin-4 `isDerived` filter (serialize.ts:181-182) and has NO batch re-mint
  carrier (rows re-mint only) → a condense+replay drops it ENTIRELY. This is the
  ADV-C-S20 / handoffs-review-8 residual 3b "minted, no carrier" class applied
  to the preserve feature. A host that needs a preserved non-rows subtree to
  survive a condense round-trip must re-apply the layer after the replay (the
  flag + the nodes are re-declared together).
Both are documented D4 residuals, not ship-blockers. Tests: preserve-reversal
P8 + X8/X16 (the D8 undo flag forward) green.

**D5 — serialize asymmetry is reverse-only and STRUCTURAL (accepted,
documented).** serializeNode emits children as IDs (serialize.ts:119) with no
schema slot for a preserved subtree's full data; honoring the flag there requires
a schema change (a second override site) that contradicts the ONE-site pin and
the "layers never serialized" doctrine. A preserved node is still origin-owned
(runtime-derived); serialize correctly excludes it (SER-R1 round-trip ships
authored-only). The flag changes ONLY the reverse emission, never the runtime
status. Documented loss for serializing hosts: a preserved node does NOT
round-trip through serialize; the host re-mints after loadState (and re-declares
the flag if it wants preservation again).

**D6 — the leak guards are FREE by reusing the existing emission (Feature 4.25).**
(1) **handlers-CLEAR / slice-***: a preserved node ships the CURRENT compiled
state (the same source the non-preserved reverse uses) — the preservation changes
ONLY the exclusion (ship vs skip), never the reversed content shape; a cleared
handler reverses as `handlers: []` (the REVERSE-OF-CLEAR detector, translate.md).
(2) **auto-mint-exclude (DEFECT #28)**: the existing minted-props.id exclusion
(translate.ts) applies — a preserved node ships its authored props minus the mint
id; a preserved node whose only id is the mint reverses WITHOUT one and re-mints
on re-translate. (3) **re-translate re-mint (ruling 24)**: the compressed authored
node is plain authored data — re-translate builds it fresh, never re-attaches to
the preserved layer. (4) **round-trip**: the flag never enters the serialized doc.

**D7 — the scope boundary (what MUST vs documented-as-lost).** MUST: reverse a
preserved layer's origin-owned nodes as authored edits (D1 read + D2 cascade);
compress into normal authored data (no flag residue, no layer machinery — §4.25);
re-translate re-mints fresh (ruling 24); the leak guards (D6). DOCUMENTED-AS-LOST:
re-mint flag (host re-declares, D4), condense flag (layers runtime-only, D4),
serialize (reverse-only, structural, D5), a moved minted node's layer lookup (D1
edge), minted-id identity across reverse→re-translate (DEFECT #28 — fresh id each
loop, the serialize.md §4 residual).

**D8 — cost-benefit vs promotion.** The flag clears the bar ONLY as the
non-destructive reverse-time view. Promotion (zero new machinery) covers the
destructive case (host tears down the layer → node reverses as authored
permanently). The flag uniquely covers the LIVE-minted case (reverse-as-authored
without destroying the minted identity). Given the user already ruled the carrier
(23), reverse fidelity (24), and subtree scope (26), the shape is decided; the
mechanics are the D1-D7 pins. The cost is small (a layer field + a reverse-time
read + a threaded context + documented losses); the benefit is a narrow but real
convenience. The step-2 "promotion + host re-author already provides it" is
answered by D3: promotion is destructive and irreversible, the flag is a
toggleable view — they are not the same capability.

### Gaps + costs-benefits

**Is it a good idea? The honest comparison (task 1).** The host need: a host that
wants a minted subtree to reverse as authored edits.
- **(a) The flag (this reshaped shape):** buys reverse-as-authored on a LIVE
  minted layer without destroying the minted identity (D3). Costs: a layer field
  (ruling 23 — already decided), a reverse-time parent→layer read (D1), a threaded
  cascade context (D2), and the documented losses (D4 re-mint/condense, D5
  serialize). It is a narrow convenience, but it is the ONLY non-destructive
  reverse-time projection.
- **(b) Promotion (zero new machinery):** buys reverse-as-authored PERMANENTLY by
  destroying the minted identity (node.ts:742 clears originLayer + unregisters).
  Costs: the node becomes authored — the layer's teardown/keyed-reuse machinery
  loses it; the change is irreversible. It does NOT serve a host that wants to
  keep the minted layer live after a reverse.
- **(c) Middle (host re-author):** the host copies the minted content into an
  authored node by hand. Costs: manual, error-prone, no engine support. It is the
  fallback, not a shape.
- **Verdict:** (a) and (b) are complementary, not redundant (D3). The flag is
  low-value ONLY for a host that never needs a live minted layer after reverse;
  for a host that does, promotion is wrong. Given the user already ruled the
  shape, (a) is the landed shape with the D1-D7 mechanics.

**What the feature does NOT promise (the residual list, §Contract wording):**
1. Re-mint flag stickiness (D4 — the flag is per-op; a same-hookName re-mint
   drops it, the host re-declares).
2. Condense survival (D4 — the base excludes origin-owned nodes; a preserved
   layer's preservation is lost across a condense round-trip, the standard
   "layers are runtime-only" residual).
3. Serialize honor (D5 — reverse-only; a preserved node does NOT round-trip
   through serialize, the host re-mints after loadState).
4. A moved minted node's layer lookup (D1 edge — parent ≠ creator; reverses per
   its own originLayer unless the new parent's layer is flagged).
5. Minted-id identity across reverse→re-translate (DEFECT #28 — fresh id each
   loop, the serialize.md §4 residual).
6. No new public surface beyond the `preserveByReversal` layer field (REQ-GAP-11
   minimal-surface discipline); the reverse-time read + cascade context are
   internal to the reverse filter.

**Costs:** the layer field carrier (ruling 23), the reverse-filter override (D1
read + D2 cascade context), the spec amendments (translate.md reverse block +
ops.md §6 layer-apply/rows-mint rows + serialize.md §4 residual note), the TDD file
preserve-reversal.test.ts.

**Benefits:** a host can reverse a minted subtree as authored edits WITHOUT
destroying the minted layer (D3); the whole-subtree cascade (ruling 26); the
compression into normal authored data (no flag residue, §4.25); re-translate
re-mints fresh (ruling 24); every caveat a DOCUMENTED runtime-layer residual
rather than a new contract break.

### Contract (the implementation must satisfy)

1. `preserveByReversal: true` is a LAYER FIELD (ruling 23); absent defaults to no
   (the current exclusion behavior).
2. The reverse filter (translate.ts:1397) reads the flag at REVERSE time via
   `child.parent.layers.find(l => l.id === child.originLayer)?.preserveByReversal`
   (D1) — node-scoped, no module-level registry.
3. The whole-subtree cascade (ruling 26) is a threaded `preserved` context through
   the `nodeToLegacy` recursion (D2) — still ONE override site.
4. A preserved node reverses as ORDINARY authored data: current compiled state
   only (content/props/type/css), no layer machinery, no flag residue (§4.25).
5. The leak guards (D6): handlers-CLEAR ships the cleared state; auto-mint-exclude
   (DEFECT #28) applies; re-translate re-mints fresh (ruling 24); the flag never
   enters the serialized doc.
6. The flag is a runtime layer property, never serialized (D4/D5): re-mint drops
   it (host re-declares), condense loses it (layers runtime-only), serialize does
   not honor it (reverse-only, structural).
7. Pins that must stay green: DEFECT #28 reverse blocks, REVERSE-OF-CLEAR, the
   existing reverse.test.ts suite, rows-mint-guardrails, keyed-batch-reuse, the
   fork-stress/derived-fork profile watches (the flag adds no per-op work).

### TDD list (the red set — `tests/unit/preserve-reversal.test.ts`, a NEW file)

Red (all fail before implementation):
1. **Flag read (D1)** — a layer-apply with `preserveByReversal: true` → its
   origin-owned nodes reverse as authored edits (ship in nodeToLegacy output);
   absent flag → excluded (current behavior).
2. **Whole-subtree cascade (D2, ruling 26)** — a preserved node's minted
   descendants reverse too (the cascade), even if their own layer isn't flagged.
3. **Compression (Feature 4.25)** — a preserved node reverses as ORDINARY authored
   data: current compiled state only (content/props/type/css), no layer machinery,
   no flag residue.
4. **Re-translate re-mint (ruling 24)** — reverse a preserved subtree →
   re-translate the output → builds it as a normal authored node (fresh mint, no
   layer tie); the preserved layer is NOT re-attached.
5. **handlers-CLEAR guard (D6)** — a preserved node with a cleared handler
   reverses with the CLEARED state (`handlers: []`), never resurrects the cleared
   handler.
6. **auto-mint-exclude (D6, DEFECT #28)** — a preserved node whose only id is the
   mint reverses WITHOUT a props.id (re-mints on re-translate); an authored
   props.id ships.
7. **Re-mint flag loss (D4)** — a same-hookName rowsMint REPLACES the layer with
   a flag-less object → the flag is dropped; the host re-declares it in the re-mint
   op (documented, not a bug).
8. **Condense flag loss (D4)** — a preserved layer's preservation is LOST across a
   condense round-trip (the base excludes origin-owned nodes; restore re-mints
   flag-less); documented.
9. **Serialize asymmetry (D5)** — a preserved node is still excluded from
   serializeNode (round-trip ships authored-only); the flag does NOT change
   serialize.
10. **Promotion distinction (D3)** — promotion (teardown) still clears
    originLayer → the node reverses as authored permanently; the flag does NOT
    change the node's runtime status (still minted, teardown-able, re-mintable).
11. **Regression greens** — DEFECT #28 reverse blocks, REVERSE-OF-CLEAR, the
    existing reverse.test.ts suite, rows-mint-guardrails, keyed-batch-reuse.

Green: implement the reverse-filter override (D1 read + D2 cascade context) + the
layer field carrier; verify `npm test`, `npm run typecheck`, `npm run demo:smoke`
(incl. the profile watches + the `[derived-fork:baseline]`/`[derived-fork:pin]`
totals), `npm run build`.

### Notes for the implementer

- The flag is read at REVERSE time (D1) — do NOT copy it to a per-node marker at
  mint time (the layer doesn't exist yet) and do NOT build a module-level
  registry (cross-graph risk). The parent→layer read is node-scoped.
- The whole-subtree cascade (D2) is a threaded `preserved` context through the
  `nodeToLegacy` recursion — the flag is consulted ONLY in the reverse filter.
- The leak guards (D6) reuse the EXISTING emission (DEFECT #28 mint-exclude,
  REVERSE-OF-CLEAR) — the preservation changes ONLY the exclusion (ship vs skip),
  never the reversed content shape.
- The flag is a runtime layer property (D4/D5) — never serialize it, never carry
  it in the batch record, never honor it in serializeNode. The re-mint/condense/
  serialize losses are DOCUMENTED residuals, not bugs.
- The demo-page preservation arm goes through the AGENTS.md item-10 blind-test
  loop (Mimo-2.5) before completion.

### Trackers (same pass as the landing)

- `docs/specs/translate.md` — the reverse block gains the preservation override
  (D1 read + D2 cascade) + the documented losses (D4/D5).
- `docs/specs/ops.md` §6 — the layer-apply/rows-mint rows note the
  `preserveByReversal` field + the per-op (non-sticky) contract (D4).
- `docs/specs/serialize.md` §4 — the reverse-only residual note (D5).
- `docs/next-feature-batch-0.2.0.md` §Feature 4 — the gate verdict + the executor
  shape + D1-D8 pinned.
- `docs/decisions.md` — the preservation-flag decision row (D1-D8).
- `docs/defects.md` — none new; the review findings are verdict notes.
- `docs/pending.md` — the "Layer preservation-by-reversal flag" SPECULATIVE row
  flips to PLANNED/landed-shape (2026-08-25).
- `docs/next-steps.md` — the work-queue entry for the Feature-4 TDD pass.
- `docs/skills/designing-pages.md` §11 coverage matrix + §12 demo pages (the
  preservation demo arm) per AGENTS.md item 3.
