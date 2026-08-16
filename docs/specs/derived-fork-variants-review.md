# Derived-State Versions of the Three Fork Variants — Step-3 Change-Analysis Verdict

Status: **APPROVE-WITH-CHANGES** — three-agent gate, step 3 (change analysis) of
the 2026-08-16 user proposal "Derived-state versions of the three fork
variants". No code changed (read-only engine/tests). Companion inputs: step-1
validity analysis + step-2 critique (empirically probe-verified). The step-3
verdict below re-verified the load-bearing claims against the code before
writing; deviations from the agents' line cites are noted where they matter.

## 1. What the proposal asks

Derived-state (path-enumeration) versions of the three fork-stress-data
single-method d12 variants (placement / values / link): ONE `compilePath` over
the 23-node graph → 4095 derived path-states → elements, ZERO clone-instance
ops. The placement-derived page exists (`demo/path-fork-data.html` —
states=4095, passes=1, elements=4095, cloneOps=0). The VALUES- and LINK-derived
pages are NEW. The runtime clone pages stay as legacy-stress tests. The
user's intent: "the wiring state enlarged to act as a derived layer over the
graph."

## 2. Feasibility verdict

**Feasible, with one genuine engine defect uncovered (the blocker), two
structural re-baselines, and a doc-falsehood fix.** The proposal is the
intended design — the derived-layer framing (path-states as the wiring layer,
placement/values/link as data layers on top) is consistent with the
placement-path-spec §5 model and requires NO new engine feature for the
values variant and none for the link variant beyond the blocker fix below.

Verified per-variant feasibility:

| Variant | Verdict | Gate |
| --- | --- | --- |
| placement-derived | EXISTS (`demo/path-fork-data.html`) | already shipped |
| values-derived | FEASIBLE, no core change | `seedOwnBindings` (node.ts:272, called at compile — node.ts:1072/1133/1261) seeds the path-state bindings from the source values; `scalarBinding` (render-helpers.ts:436-443) emits the text; no def bindings exist in the envelope → no def-chain → 4095/4095 census holds |
| link-derived | FEASIBLE **after the blocker engine gate** (or with the documented-phantom fallback, §4.3) | covered-leaf def-fill (§4) + adapter-key asymmetry (§4.5) + derived-bake exemption (§4.6) |

## 3. Claim re-verification (step-3 independent pass)

The following were re-checked directly in the code — all hold, with exact
mechanics:

1. **The covered-leaf def-fill (BLOCKER) — CONFIRMED.** The emit path runs
   `emitOne` for EVERY group BEFORE consulting coverage
   (render-helpers.ts:387-388: `emitOne` unconditional, `covered` checked
   after). The def-fill branch (render-helpers.ts:805:
   `seam === 'children' || (allowed && childWires.length === 0)`) has NO
   covered gate, and `linkChainAllowed` (render-helpers.ts:491:
   `if (childWires.length === 0) return true`) makes EVERY childless
   def-carrying state `allowed` — so every covered leaf fires the fill
   (render-helpers.ts:851-867) and its `defChildren` (synthetic
   `` `${wire}:${bind}` `` wires) are pushed at render-helpers.ts:409-411
   (`if (!standaloneWires.has(c.wire)) els.push(c)` — synthetic wires are
   never in `standaloneWires`, which holds only real state wires, :374-377).
   Net: covered leaves double-emit their fill. The probe arithmetic holds:
   depth-5 → 31 states + 16 leaves × 2 = 63 elements, 32 phantoms;
   `treeFromOps` (render-helpers.ts:220-221) returns every created element
   not referenced as a child → 33 roots. **The spec-vs-code divergence is
   REAL:** render.md:185 says the carve-out applies to a childless state "NOT
   covered by a family parent's chain — the fork-stress leaves are covered
   and skipped, which is why the 4095 census holds" — the code never consults
   the covered condition in the fill branch. The divergence is also LIVE in
   the shipped runtime link page (8191 elements today, never asserted: the
   runtime page's link/nesting checks iterate graph nodes, not `els.length`
   — fork-stress-data.js:520-537/:539-560, and `assertForkStressCensus`
   (demo-smoke.mjs:200-229) checks no element count).
2. **No test pins the phantoms** — P-EMIT-3 (tests/unit/path-emit.test.ts:192-235)
   pins def re-typing and the consumer elements, never the covered-leaf fill
   count → the engine gate's red tests cannot break existing greens.
3. **Adapter-key asymmetry — CONFIRMED.** `domElOf(pathKey) =
   adapter.wires.get(wireKey(pathKey, pathKey))` (path-fork-data.js:297-299)
   assumes every path-state element carries `forkKey = pathKey`; re-typed
   def-chain children are built WITHOUT a forkKey (render-helpers.ts:916 —
   `reTyped.push({ wire, type, props, childOrder })`) → stored under the bare
   wire → composite lookups miss for covered children on a link-derived page.
   (The runtime link page is unaffected — its lookups use bare `n.id`,
   fork-stress-data.js:508/523.)
4. **Derived bakes absent on re-typed elements — CONFIRMED.** reTyped props
   source pass-1 node/spec props only (render-helpers.ts:909-910); derived
   bakes land on the compiled state. The runtime link page already exempts
   itself (fork-stress-data.js:594 `method !== 'link'`); a derived link page
   must scope its `stress:expanded`/`data-path` element assertions to
   standalone-emitted states (path-fork-data.js:399-411 pattern).
5. **Doc falsehoods — CONFIRMED.** fork-stress-data.md:187 ("expects
   2^depth − 1 elements for every variant") is false for the runtime link
   variant; placement-path-spec §5.2 (lines 626-632) / §6.3 (line 691)
   element-census rows state the placement-only census without the link
   qualification; §10.ad N-5 (line 1481) / R-5 (line 1747) / §8 Q6 (line 745)
   pin the "static page has no method variants, its single total is its own
   baseline" framing — superseded by a three-variant family.
6. **Reusability map — CONFIRMED.** fork-stress-data.js:125-132 (per-method
   component shapes), :147-158 (`linkDefForLevel`), pathForkLegacyData
   (path-fork-data.js:69-133), the builder surface (scripts/path-fork-page.mjs),
   the smoke pin structure (demo-smoke.mjs:303-399).

## 4. Blocker resolution — RECOMMENDED: option (a), the ENGINE GATE

The covered-leaf def-fill must not emit its defChildren. Weighing:

| Option | Cost | Benefit | Defect | Verdict |
| --- | --- | --- | --- | --- |
| **(a) ENGINE GATE** | One emit-side change + TDD (red tests below); runtime link page element output drops 8191→4095 (verified: no runtime check or smoke assert depends on the phantoms — §3.1); needs the §4.5 forkKey decision for the derived link page | Makes code match the render.md:185 spec letter (the spec is the CONTRACT — the code violates it); the 4095 census becomes true for every variant; the derived link page needs no phantom-documentation carve-out; the defect is fixed for the runtime page too | The divergence itself is a defect (defects.md row, §6) | **RECOMMENDED** |
| **(b) DATA FIX** (drop the component binding from the deepest-layer prototypes so leaves never re-type) | No engine change | Small | Leaves the code-vs-spec divergence standing; leaves the runtime link page's 8191 hidden phantoms; makes the derived page asymmetric with the runtime page; the "wiring state enlarged to act as a derived layer" framing breaks exactly at the layer the proposal wants to prove | REJECTED |
| **(c) PIN 8191 + document** | No change | None beyond honesty | Weakest — codifies a spec-violating behavior; the derived page's census story (4095) dies; treeFromOps single-root checks need phantom-root allowances | REJECTED |

### 4.1 Exact gate shape

In `emitElements` (render-helpers.ts:409-411), the defChildren push gains a
covered-childless suppression:

```ts
const coveredChildless = covered && (states[0].children ?? []).length === 0
for (const c of emitted.defChildren ?? []) {
  if (!coveredChildless && !standaloneWires.has(c.wire)) els.push(c)
}
```

Correctness argument: a covered state with children fires the RE-TYPING branch
(its defChildren are the re-typed real children — must keep pushing, else the
whole subtree below the covered node vanishes, the warning at
render-helpers.ts:402-408); a covered state with NO children fires ONLY the
fill (its defChildren are all synthetics — all suppressible). `covered`
requires `states.length === 1` (:388), so multi-arm groups are untouched.
Equivalently (semantically cleaner but touches `emitOne`'s signature/callers):
thread a `!covered` flag into `emitOne` and gate the fill branch at :805. The
spec writer picks one; the red test is identical.

### 4.2 Red set (TDD, before any engine change)

1. A covered childless path-state (leaf in a def chain, `allowed`) emits NO
   defChildren: `emitElements` output has exactly 2^depth − 1 elements, no
   `` `${leafWire}:${bind}` `` wires, `treeFromOps` sees exactly ONE root
   (mirror of the depth-5 probe: 31 states → 31 elements, 1 root).
2. The covered-chain invariant is preserved: a covered NON-childless state
   still pushes its re-typed defChildren (subtree below a covered node
   intact).
3. Existing P-EMIT-3/P-EMIT-4..6 pins stay green (verified: they never assert
   the covered-leaf fill).
4. Runtime link page re-verified after the drop: link-only check
   (fork-stress-data.js:520-537), nesting check (:539-560), derived data-path
   exemption (:594) all still pass on 8191→4095 elements.

### 4.3 (Decision record) the runtime page's hidden 8191 is a DEFECT, not a feature

The runtime link page has shipped 8191 elements (4096 never-attached
phantoms) with node-based checks masking it. After the gate, its element
output drops to 4095 — no check changes, the checks were correct; the census
becomes true.

### 4.4 (Deferred) adapter-key contract for re-typed path-state children

The derived link page needs a defined keying for re-typed children. Two
options for the spec phase:
- **Page-side (preferred, no engine change):** the derived link page's
  lookups use a bare-wire fallback (`domElOf` tries `wireKey(pathKey,
  pathKey)` then the bare `pathKey`); re-typed-child assertions iterate the
  emitted element set instead of `domElOf`. The tree ops already survive both
  keyings (`findEl` forkKey resolution, render-helpers.ts:216-218; the
  legacy-shape page's "match bare-or-`wire\x00forkKey`" note).
- **Engine-side (deferred):** reTyped elements carry `forkKey` ONLY when the
  resolved wire is a path-state wire (pathCtx present) — NEVER for runtime
  family nodes (would break the runtime link page's bare `adapter.wires.get`
  lookups). Own TDD cycle; only worth it if a derived link page needs
  composite-key uniformity for its own checks.

Recommendation: page-side first; the engine-side variant is parked with a
revisit condition (a second consumer needing composite keys).

### 4.5 (Pin) derived-bake exemption mirrors the runtime page

The derived link page scopes its `stress:expanded`/`data-path` ELEMENT
assertions to standalone-emitted path-states; re-typed children assert from
state data only (the runtime page's `method !== 'link'` pattern,
fork-stress-data.js:590-596).

## 5. The trio structure + pins

### 5.1 Census per derived method (smoke pins)

| Page | registered | states | elements | cloneOps | passes |
| --- | --- | --- | --- | --- | --- |
| `path-fork-data.html` (placement-derived) | 23 | 4095 | 4095 | 0 | 1 |
| `path-fork-data-values-d12.html` | 23 | 4095 | 4095 | 0 | 1 |
| `path-fork-data-link-d12.html` | 23 | 4095 | 4095 (after §4.1) | 0 | 1 |

### 5.2 Per-family guard semantics (the §8-Q6 split)

- **Runtime family (unchanged):** d12 total-ratio guard against the placement
  baseline (demo-smoke.mjs:290-301, 2.5× asserted; AGENTS ~1.5× human watch).
  The 4094 per-node passes make totals meaningful there.
- **Derived family (NEW):** the totals are compile-enumeration-dominated
  (~2.8s baseline) — total-ratio guards are insensitive to EMIT-side blow-ups.
  Pin **`emitMs`/`diffMs`/`applyMs` ratios vs the placement-derived page**
  (the page already times each region: path-fork-data.js:284-291), NOT
  totals. A `[derived-fork:baseline]` marker records the placement-derived
  page's per-region totals; values/link-derived pages must stay within a
  loose multiple of each region (2.5× asserted, ~1.5× human watch).
- **Baseline re-record:** the "[static page is its own reference, no method
  variants]" framing (placement-path-spec §10.ad N-5/R-5, §8 Q6,
  demo-smoke.mjs:377-398 `[path-fork:baseline]` marker) is SUPERSEDED by the
  three-variant family: the placement-derived page remains the FAMILY
  baseline (its single total keeps meaning as the enumeration cost); the
  values/link-derived pages pin against its per-region numbers. The
  `[path-fork:baseline]` marker line is re-recorded as the family baseline
  with the per-method note (keep the runtime 2× tripwire unchanged — it
  catches the runtime pass-2 pipeline, a different concern).

### 5.3 Doc corrections (all land in the same pass as the pages)

1. **render.md:185** — P-EMIT-3 carve-out: after §4.1, the sentence "the
   fork-stress leaves are covered and skipped, which is why the 4095 census
   holds" becomes TRUE (it was the spec letter all along; note the fix).
   Until the gate lands it stays a false claim — the pages must not ship
   before it.
2. **fork-stress-data.md:187** — "expects 2^depth − 1 elements for every
   variant" → qualify: holds for placement/values; for link it holds after
   the covered-leaf gate (the pre-gate runtime link page emitted 2 per leaf
   in addition — the phantoms, unasserted).
3. **placement-path-spec §5.2/§6.3** element-census rows — add the
   link-variant qualification + the derived-family census table (§5.1).
4. **placement-path-spec §10.ad N-5 / R-5 / §8 Q6** — supersession note: the
   single-baseline framing is replaced by the family structure (§5.2).
5. **designing-pages.md §11** (coverage matrix) + **§12** (demo pages) — add
   the two new pages and the trio framing: legacy clone stress (runtime
   family) vs derived layer (derived family).
6. **docs/specs/fork-stress-data.md** — the "static census holds for every
   variant" phrasing (lines ~13-16) gets the method qualification.

## 6. Costs and benefits

### 6.1 Values-derived page (`path-fork-data-values-d12.html`)

- **Benefit:** proves the "wiring state as derived layer" for the values
  mechanism with ZERO engine change; 4095/4095 census; the page module
  checks are near-copies of the placement page's + the runtime values check
  body (fork-stress-data.js:505-518, node-iterating — re-expressed as
  path-state assertions).
- **Cost:** new envelope generator branch (component value field on the
  path-fork prototypes), one builder parameterization, smoke seed + pins.
  Smallest of the three.

### 6.2 Link-derived page (`path-fork-data-link-d12.html`)

- **Benefit:** the hardest claim — the def-chain re-typing over derived
  path-states (4095 elements, 1 tree root, no phantoms) — and it exercises
  the P-EMIT-3 spec letter that the runtime page's node-based checks never
  did. This is the page that earns the "wiring state enlarged" framing.
- **Cost:** the engine gate (§4.1, TDD), the keying decision (§4.4), the
  derived-bake exemption (§4.5), and the census/doc corrections. This is
  where the proposal's real value and real cost sit.

### 6.3 Family re-baseline

- **Benefit:** the emit/diff/apply pins close the guard gap the critique
  found (totals can't see an EMIT-side blow-up); per-method censuses make
  the "one element per path-state" claim assertable per mechanism.
- **Cost:** smoke growth (~90 lines), tracker rows (§7).

## 7. Implementation plan sketch (for the spec/implementation units)

1. **Blocker fix (engine, TDD):** red set §4.2 → §4.1 gate → re-run the
   runtime link page checks + full trio.
2. **Envelope generator:** `pathForkLegacyData(method)` parameterization in
   `demo/path-fork-data.js` (or a small data module): values → add
   `component: { reference: 'values-<layer>.<slot>', value: 'value-<SLOT>-<layer>' }`
   (the fork-stress-data.js:127 shape); link → add
   `component: { reference: 'link-<layer>', value: linkDefForLevel(layer) }`
   (:131, :147-158). DROP the `stress:handler`/`handlers` residue the runtime
   envelope carries (fork-stress-data.js:101/:107 — the derived model has no
   after-compile expansion).
3. **Page modules:** per-method check bodies — placement checks unchanged;
   values adds text-vs-resolved-value assertions; link adds def-type/def-
   content assertions (runtime bodies re-expressed per path-state) + the
   §4.4/§4.5 scope rules.
4. **Builders:** parameterize `scripts/path-fork-page.mjs` (one page today) →
   three pages; `scripts/build-demo.mjs` + `demo/index.html` entries; smoke
   seeding/banner blocks in `scripts/demo-smoke.mjs` (per-page embedded
   expected census + §5.2 pins).
5. **Docs/trackers (same pass):** §5.3 corrections; defects.md (§8);
   decisions.md (§8); next-steps.md circle-back; designing-pages §11/§12.

## 8. Dispositions

| # | Proposal element | Disposition | Lands in |
| --- | --- | --- | --- |
| 1 | Values-derived page | **ADOPT** | spec → TDD → build/smoke; designing-pages §11/§12 |
| 2 | Link-derived page | **ADOPT** (after the blocker gate) | engine gate spec + red set §4.2; page/builder/smoke |
| 3 | Covered-leaf def-fill engine gate | **ADOPT** (blocker resolution, option a) | defects.md OPEN row: "covered childless states emit def-fill phantoms — the P-EMIT-3 carve-out ignores the covered condition (render.md:185 letter violated; runtime link page shipped 8191 unasserted elements)" → FIXED row on resolution |
| 4 | Runtime clone pages stay as legacy-stress tests | **ADOPT** | unchanged; runtime family guard semantics §5.2 |
| 5 | Trio re-baseline (family structure, per-region pins) | **ADOPT** | decisions.md row: "derived-family pins (emit/diff/apply vs placement-derived, not totals); [path-fork:baseline] → [derived-fork:baseline] family marker; §8-Q6 split runtime-family vs derived-family"; supersedes §10.ad N-5/R-5 |
| 6 | Doc corrections (render.md:185, fork-stress-data.md:187, placement-path-spec §5.2/§6.3/§8/§10.ad, designing-pages §11/§12) | **ADOPT** | the doc pass §5.3 |
| 7 | DATA FIX (drop deepest-layer component bindings) | **REJECTED** | — |
| 8 | PIN 8191 + document | **REJECTED** | — |
| 9 | Engine-side forkKey on reTyped path-state children | **PARKED** (page-side keying first) | pending.md row: revisit when a second consumer needs composite keys on re-typed children |
| 10 | Derived-bake exemption on re-typed elements | **ADOPT** (pin, mirrors runtime :594) | the link-derived page spec + render.md note |
| 11 | Dead css on covered re-types + linkDef header comment inaccuracy | **ADOPT** (doc-only + explicit child-prop assertions) | fork-stress-data.md + the derived link page checks |
| 12 | Trace-separator collision, scalarBinding theme precedence (nits) | **ADOPT** (document-only) | fork-stress-data.md lessons |
| 13 | Envelope generator + builder/smoke/index wiring (minor #7) | **ADOPT** | plan §7 |

Gate status: this verdict is step 3 of the three-agent gate; the proposal
now needs the user's go-ahead, then the item-6 step gates (specs first —
the engine-gate spec with its red set is the first unit; the page specs
follow).

---

*Compiled 2026-08-16, step-3 change-analysis agent. Companion inputs: step-1
validity + step-2 critique (their probe results are cited in §3 and were
re-verified here).*

---

## LANDED (2026-08-16 — implementation pass)

Status: **IMPLEMENTED per this verdict** (user go-ahead given; TDD + full
validation trio green). Summary:

- **Blocker fix (option a — the ENGINE GATE):** the covered-childless
  def-fill gate landed in `emitElements` (render-helpers.ts — the defChildren
  push skips a covered CHILDLESS state's fill orphans:
  `coveredChildless = covered && (states[0].children ?? []).length === 0`).
  TDD red first: the covered-childless gate test failed pre-change (7
  elements incl. 4 `` `:` ``-wires vs 3) — tests/unit/render.test.ts
  (covered-childless gate + the standalone-fill scope pin); the existing
  covered-NON-childless invariant test (subtree below a covered node) stayed
  green untouched. Post-gate the runtime link page emits exactly 4095
  elements (pre-gate 8191 — the phantoms, never asserted; its node-based
  checks were correct and unchanged). Emprical pre-gate probe verified all
  2048 depth-12 leaves were def-covered AND still emitted their fill — the
  8191 = 4095 (incl. the parents' re-typed leaf elements) + 4096 phantoms.
- **The derived trio:** `pathForkLegacyData(method)` (values/link component
  fields per §7.2, NO handlers/stress:handler residue), per-method checks
  in the page module (values: text-vs-resolved-value per path-state; link:
  div type + def content for k > 1 + the child's OWN props on re-typed
  elements + the 4092 re-typed-element pin + the §4.5 derived-bake
  exemption), `elOfWire` bare-then-composite lookups (§4.4 page-side
  keying), builder parameterization, pages
  `path-fork-data.html` / `path-fork-data-values-d12.html` /
  `path-fork-data-link-d12.html` (the §5.1 names), `demo/index.html`
  entries, smoke seeding + banners + the §5.2 family pins
  (`[derived-fork:baseline]` per-region + `[derived-fork:pin]` 2.5× per
  region; the §8-Q6 split; the runtime 2× tripwire unchanged; the former
  `[path-fork:baseline]` single-total marker superseded).
- **Doc/tracker corrections (§5.3/§8):** defects.md DEFECT #21 FIXED row;
  decisions.md DERIVED-TRIO row (supersedes the §8-Q6 single-baseline row);
  pending.md parked forkKey-on-retyped row (§4.4, page-side first);
  next-steps.md RESOLVED row; render.md DFC-1 (the covered-leaves-skipped
  letter now TRUE — pre-gate it was a false claim, now enforced);
  fork-stress-data.md §4 census qualification + lessons 8-11 (review items
  11/12); placement-path-spec §5.2 family census table, §6.3, §8 Q6,
  §10.ad N-5 / §10.af R-5 supersession notes; designing-pages §11/§12/§14.9;
  AGENTS.md item 4 (family baseline paragraph).
- **Trio results (headless smoke, one run):** placement-derived
  `[derived-fork:profile] method=placement states=4095 passes=1
  elements=4095 emit=24.1ms diff=11.5ms apply=1168.2ms checks=1226.1ms
  total=2471.8ms`; values-derived emit=21.3 diff=11.7 apply=1205.8
  total=2522.0ms (pins 0.88×/1.01×/1.03×); link-derived emit=34.6 diff=4.5
  apply=8.4 total=159.4ms (pins 1.43×/0.39×/0.01×). All three pages' checks
  green (8/9/9), census 23/4095/4095/0/1 per page, runtime family guards
  unchanged. 837 unit/e2e tests + typecheck + `npm run build` clean.
- **Deviations from this verdict (recorded):** (1) none behavioral — the
  §3.1 probe arithmetic ("depth-5 → 31 states + 16 leaves × 2 = 63
  elements, 33 roots") was re-verified and HOLDS: 3 standalone (root + L1)
  + 28 re-typed (L2..L4, covered) + 32 phantom fills = 63; the phantom
  fills are never referenced (the covered leaves' standalone elements are
  skipped) → 32 phantom roots + the root = 33. (2) §8 disposition #3's
  "runtime link page shipped 8191 unasserted elements" was confirmed
  empirically (an instrumented run measured 8191 pre-gate; all 2048
  depth-12 leaves are def-covered AND still fire their fill — 4095
  including the parents' re-typed leaf elements + 4096 phantoms). (3) No
  test pinned the standalone (non-covered) childless fill before the gate
  — the red set ADDED the scope pin (review §4.2's "verify an existing
  test pins this" resolved: none did). (4) The derived link page's apply/
  checks run ~100× faster in the headless shim than the placement page
  (bare-keyed re-typed elements make `findEl`/`treeFromOps` edge
  resolution EXACT instead of prefix-scanned) — a measured asymmetry, not
  a blow-up; both stay within the 2.5× per-region pins.
