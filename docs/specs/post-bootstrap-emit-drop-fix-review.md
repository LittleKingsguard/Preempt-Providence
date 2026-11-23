# `POST-BOOTSTRAP-EMIT-DROP` Fix Gate (`post-bootstrap-emit-drop-fix-review`) — stance (A) as the owner stated it, and what must actually land

**Status:** **THE OWNER'S STANCE (A) — REJECT AS A MECHANISM, ACCEPT AS THE INVARIANT.**
*"A family-mode compile must not re-key a node that already holds a path-state"* is **right as an invariant** and
**unimplementable as a ban**: refusing the family state closes the 0-char symptom only by freezing every
non-placement node's only refresh channel, and it leaves the document **silently wrong**
(`ORPHAN-EMIT-TOP-LEVEL-LEAK`, `docs/defects.md` **ORPHAN-EMIT-TOP-LEVEL-LEAK**) — the exact trade the owner
already refused for stance (C). It is replaced by its own mechanism: **a tree compile MODE, carried on the
`Supervisor`, honoured by every pass-2 slice member, entered at the existing bootstrap seam**. That shape closes
the row; (A)'s sentence survives as its contract wording.

**Step 2's "(B)-lite needs no new carrier" — REJECT.** Its carrier claim is false: a per-member *structural*
predicate path-compiles **every** tree (`tests/e2e/ssr-render.test.ts:266-283`), and its *history* reading needs
the carrier it denies. Its per-member **dispatch** half is accepted as part of the mechanism below.
**Step 1's per-`Node` minted-pathKey carrier — REJECT as strictly dominated.** It does not cover the new-node case,
is destroyed by `_restoreBase` (`supervisor.ts:866-916`), and makes `Node.compile` history-dependent for every
caller; a supervisor slot is cheaper and covers all three.
**The red test — KEEP, but INSUFFICIENT AS WRITTEN.** All four cases (`PBED-1..4`) **pass under (A)-refusal**, i.e.
the file cannot distinguish *closure* from *freeze*. It needs **five** additions before it can gate the fix (§8).
**Stance (B) as the RCA stated it — ACCEPT**, with the carrier and entry seam named here, five spec amendments,
one new ACTIVE decisions row, and three pinned tests **re-specified** (not re-pointed) (§4.4, §7).
**Target version: `0.6.0` (`X.Y.X`, `docs/decisions.md` VERSIONING-SCHEME).**

**Gate provenance.** Three-agent gate, AGENTS.md item 9: **step 1 validity** and **step 2 critique** ran
independently, read-only, neither reading the other; **step 3 change-analysis** (this record) adjudicated both and
re-read every decisive claim in the 0.5.2 tree. Sources: the two reports; the RCA
`archive/reviews/2026-11-23/2026-11-23-post-bootstrap-emit-drop-rca.md`; the row `docs/defects.md`
`POST-BOOTSTRAP-EMIT-DROP`; the arm `docs/probes/post-bootstrap-emit-drop.mjs`; the red file
`tests/e2e/post-bootstrap-emit.test.ts`. Date: **2026-11-23**.

**Evidence class, stated honestly.** No execution was available to the step-3 pass. Every runtime claim is static
and marked `UNVERIFIED-BY-EXECUTION` where a run is needed. The defect itself is reproduced by the consumer's arm
(and by the supervisor, who ran it in this checkout) and the arm is deterministic by construction; **the step-3 pass
did not re-run it**. No suite/smoke state is claimed by this record.

---

## 1. The defect and what the gate was asked

`POST-BOOTSTRAP-EMIT-DROP`: a tree bootstrapped in path-enumeration mode (`compilePath`) is re-compiled by pass-2
in **family** mode; the ancestors' states are replaced, their wires flip from `pathKey` to `nodeId`, and
`SSRFragmentAdapter` / `MarkdownAdapter` — whose `rootKey` is captured on the first `createEl` and **never reset**
(`adapters.ts:463`, `:548`; FRG-H24) — resolve no fragment and return the styles prefix only (`:572-574`, `:760-762`).
Whole-document loss.

The gate was asked to adjudicate two independent reports that **agree on the mechanism and disagree on the verdict**,
and to say whether the owner's chosen stance, implemented, does what the owner wants.

---

## 2. Step 1 — validity (summary)

**VIABLE-WITH-RESHAPE.** The three ranked "sites" are one mechanism. `makeCs` (`node.ts:1281-1297`) cannot mint (no
`PathWalk`; `mintPathState` is the only mint, `:1485-1529`); the pass-2 dispatch (`supervisor.ts:682-703`) decides
mode per **dirty node** while the slice it overwrites (`:702-703`) holds the ancestors; `isPathState`
(`render-helpers.ts:131-133`) can only read identity off the state. Carrier: **does not exist** — `Node`'s markers
are `destroyed`/`runtimeMinted`/`valueRecord`/`originLayer`/`batches`/`graphScope`/`_resolved` (`node.ts:398-453`),
`CompiledState` has no identity field, and `resolvedStates` is a host-dependent replaceable cache. Reshape:
(A) = "a node with a minted path identity is compiled in path mode, always" — a dispatch rule, refusal at most a
fallback — plus the re-specification of E2E-3's pin and the resolution-universe delta (`resolvePathTargets`
self → path ancestors, `resolve.ts:279-302`, vs `fitReference` self → descendants → ancestors, `:229-248`).
Version `0.6.0`.

**Verified by step 3:** the mint/dispatch/emit mechanics; the carrier's absence; **the root always holds a
path-state after a path bootstrap** (`pathKeyFor` → `'root'`, `node.ts:232-233`; `compilePath` enumerates the root,
`:1412-1414`, `:1455-1481`; the root's *family* `pathKey` is **also** `'root'`, `node.ts:699`); the resolution
asymmetry; the E2E-3 pin values.
**Corrected by step 3:** step 1's E2E-3 claim is **half wrong** — under a *mode* rule the **key-count pin holds**
(13: the root's family `pathKey` is already `'root'`), so only the `compilePath` **spy** assertions move.
**Over-priced by step 1:** the per-`Node` carrier (§4.2/§4.4).

---

## 3. Step 2 — critique (summary)

**"(A) NEEDS A COMPANION."** **B1 sufficiency:** a family state's `childOrder` is the live `node.children`
(`node.ts:1294` → `render-helpers.ts:325`), a path state's is `pathChildrenFor` **at mint** (`node.ts:1516`,
`:249-267`) and frozen; `diffMinimal` appends only `childOrder` members that are `present` (`render.ts:59`,
`:115-117`); unappended created fragments serialize **after the root** (`adapters.ts:579-583`) ⇒ (A)-refusal yields a
*non-empty but wrong* document. **B2 freeze:** refusing removes the only refresh channel for every non-placement
node incl. the root (`supervisor.ts:682`, `:695-697`) ⇒ props/css/content writes, family `attach`/`detach`/`move`,
`layer-*`, `rows-*` become **silent** no-ops with no diagnostic available (`node.ts:1407`). **B3 zeroing left open:**
Z1 (condense → undo-to-base → `_restoreBase` re-family-compiles ⇒ root wire ≠ captured `rootKey`), Z2 (a drain-only
host loses the root's state; `renderProducingProcess` owns no merge, `render-helpers.ts:525-526`, `:534-549`).
**B4 the predicate is undefined:** `pass2States` is drained by `takePass2States` (`:569-573`), `resolvedStates` only
if the host called `recordResolved`, `node.resolved` copies per read (`node.ts:691-693`); plus pruned-since,
two-path-states-per-node legality (`tests/integration/supervisor.test.ts:285-308`), `_restoreBase`'s node rebuild
(`:872-886`), hub-shared prototype reuse. **B5 counter-pin:** `tests/blind/e2e-layer.test.ts:399` 13→12 under the
refuse variant. **B6 the arm bypasses the supervisor** (probe `:161-174`). **Paradigm:** (A) adds a hidden
**history** term to the compile function, breaking S2 parity as written and making a graph render differently in
process vs after `loadState`; a refusal is a third **silent** outcome (the class twice ruled a defect).

**Corrected / over-strong (step 3):** B4's *"which identity is sticky"* objection dissolves under a **mode** rule
(a node's N path states are all re-minted by `compilePath`); its *"no new carrier needed"* claim is **false**;
its E2E-3 "13 → 12" reading is a *refusal* artefact — a mode rule holds 13.

---

## 4. Step 3 — change-analysis (the verdict)

### 4.1 Adjudication

| Point | Step 1 | Step 2 | Adjudication |
| --- | --- | --- | --- |
| Does (A) fix the reproduction? | Partly — closes the zeroing, does not render | No — non-empty but incorrect | **Step 2 wins** (step 1 says so in its own body): the root's path-state survives, the new child is never appended, the created fragment serializes top-level = `ORPHAN-EMIT-TOP-LEVEL-LEAK`. |
| Does (A) solve only this? | Under-scope: unfixes the update half | Data-loss class, worse than the symptom | **Step 2's framing is correct** — a frozen subtree with no diagnostic is a silent-value-loss class. |
| Z1 / Z2 | Not raised | Decisive | **Step 2 wins.** `_restoreBase` rebuilds `Node` objects, so a per-`Node` flag is lost; a `Supervisor` field survives. |
| Carrier needed? | Yes — per-`Node` minted `pathKey` | No — structural derivation | **Both wrong; a third answer.** A per-`Node` field cannot cover a new node or survive `_restoreBase`; a structural predicate is true for every node of every root-anchored tree (it would path-compile all trees and break `tests/e2e/ssr-render.test.ts:281-282`). The cheapest sufficient carrier is **the `Supervisor` itself**. |
| Purity / S2 parity | Not weighted | Blocking (a history term) | **Step 2 is right about `Node.compile`, wrong about the landing site.** A supervisor-level mode leaves `Node.compile(node, slice)` pure ⇒ S2 is **not** amended; the supervisor is *already* history-dependent by contract (`supervisor.ts:691-693`). |
| E2E-3's pin | "Breaks either way" | "13→12" | **Both over-price it** — 13→12 is a refusal artefact; under a mode rule `pass2Keys` is unchanged and only the spy assertions move. |
| Bypass (B6) | Not raised | A supervisor fix is inert on the arm | **Steps 2's fact is right; it changes only the doc half.** The red test does **not** bypass (`sup.flush()`), so the engine fix greens the test and the §1.4 recipe is corrected in place. |
| `ssr-render:281-282` | Cited as the widening's counter-pin | Cannot observe (A) | **Step 2 wins** — it becomes a MUST-NOT-BREAK line, not a discriminator. |
| Version class | `0.6.0` | not stated | **`0.6.0` (`X.Y.X`)** — additive `Supervisor` surface + an emitted-wire change named in the changelog. Not `Y.X.X`. |

**Both reports under-read one thing.** The row is **two mechanisms**: (i) *wire-identity flip*, and (ii) *stale
mint-time `childOrder`* (a parent not re-minted cannot name a new child). (A) as stated addresses (i) by freezing
and therefore makes (ii) permanent; step 2's (B)-lite addresses (i) per member but leaves the **new node** on a
`nodeId` wire, violating its own "no silent mixed domain" standard. **Only a tree-wide mode closes both at once.**

### 4.2 Answering the owner's actual intent

**The owner's goal was to stop the re-key. (A) as literarily stated does not deliver that goal — it delivers the
*absence* of a re-key by removing the compile that would have re-keyed.** One keeps the document correct; the other
keeps it merely *unchanged*. The price is the entire update path of a path-bootstrapped tree, silently.

**What the owner should be told, plainly:** *your sentence is the right invariant and the wrong implementation.* An
engine that neither re-keys a minted node **nor** re-derives it stops updating. The invariant is preserved in full by
**re-minting in the node's own identity domain** — `pathKey` is a pure function of the current graph (`node.ts:232-241`,
deterministic across modes for family-parented nodes and for placed nodes) — so a re-mint of an unchanged path yields
the **same wire**, which *is* "identity is sticky". **Sticky identity is delivered by re-minting, not by refusing.**

### 4.3 Cost / benefit

| Stance | Closes the 11 triggers? | Closes Z1/Z2? | Contract surface | Performance | Pinned tests moved | Verdict |
| --- | --- | --- | --- | --- | --- | --- |
| **(A) refusal / non-emitting family state** | **No** — replaces the flip with a frozen `childOrder` ⇒ `ORPHAN-EMIT-TOP-LEVEL-LEAK`; `state-slice`, `move`, `layer-*`, `rows-*` silent | No | no new field, but a new **silent** outcome | cheaper | E2E-3 13→12 **red** | **REJECT** |
| **(A) + per-`Node` carrier** | Ancestors only; **not** the new node | No (flag dies at `_restoreBase`) | new `Node` field | one dict read per member | E2E-3 spy red; S2 parity must be re-stated | **REJECT as dominated** |
| **(B) tree compile mode on the `Supervisor`, entered at `recordResolved`, honoured per slice member** | **Yes for the engine half** (10 of 11); the 11th is a **doc correction** | **Yes** | additive: one `Supervisor` member + one ACTIVE decisions row + five spec amendments | **zero** on every measured page (d10/d12 runtime pages bootstrap family; path demos apply no post-bootstrap ops) | E2E-4a/b ancestor spies, S-P1, E2E-3 spies — **one statable rule: ancestors re-mint, descendants do not** | **ACCEPT** |
| **(C) adapter root re-capture** | No | No | — | — | FRG-H24 | stays **REJECTED**; only a safety net |

**Why the mode must cover the whole slice, not just dirty nodes.** `supervisor.ts:702-703` writes `pass2States` for
every grouped node, and in family mode that result covers the whole slice — so a rule limited to dirty nodes leaves
the ancestors overwritten by someone else's family compile. The family-mode analogue already re-derives the
ancestors; the path-mode rule is its symmetric statement. **This is why the three pin moves are unavoidable and are
not regressions** — E2E-4a's *substance* ("nothing at depth > 4 recalculates") survives; only the ancestor assertions move.

### 4.4 The landing shape

**R-1 — the mode (the engine fix). `src/core/supervisor.ts` only; no `node.ts` change.**

1. **Field:** `private compileMode: 'family' | 'path' = 'family'`.
2. **Entry seam (no new public surface required):** `recordResolved(actionable)` (`:619-626`) sets
   `compileMode = 'path'` when the recorded states are path states (`isPathState`), else leaves it. `recordResolved`
   **is** the documented bootstrap channel and every in-tree path host already calls it. Precedent for the supervisor
   deriving a dispatch decision from recorded bootstrap states already exists (`:691-693`).
3. **Override:** an explicit `new Supervisor({ compileMode })` and/or `setCompileMode()` — owner's choice (Q2).
   Without it, a host that bootstraps by a route the supervisor never hears about has no way in.
4. **Dispatch (`:695-703`):** `family` → today's `node.compile(focusedSlice)` **byte-identical**. `path` → for each
   member `m` of the slice, merge `m.compilePath().actionable`; keep the per-node overwrite semantics, the relevance
   pre-check (`:691-693`), `storeResolved` (`:706`) and the event shape (`:709-729`).
5. **`_restoreBase`:** no change — the field survives the node rebuild.
6. **Not in scope:** any `CompiledState` field, any closed-union widening, any new warn code, any `Node` marker, any
   emit-side change (`render-helpers.ts` untouched), any adapter change.

**R-2 — the resolution-universe delta must be MEASURED.** Path-compiling an **ancestor** replaces `fitReference`'s
slice-bounded descendant scan with `resolvePathTargets`' self → path-ancestors walk. `FRS-3(ii)` pins the descendant
hit for a **family** compile and stays green (it calls `Node.compile`), so this delta would land **silent** unless a
supervisor-level case is added. Either accept path-only resolution for path-mode members (Q4) or extend the path
resolver — decided **on a red case**, never in prose.

**R-3 — the §1.4 host recipe is corrected in place now** (doc only): a direct `Node.compile` on a path-mode tree is
unsupported until a Node-side rule exists.

---

## 5. Dispositions

| # | Ask / candidate | Verdict | What replaces it | Tracker row(s) | Owner decision owed |
| --- | --- | --- | --- | --- | --- |
| 1 | **Stance (A) as stated** (refusal / non-emission) | **REJECT as mechanism / ACCEPT as invariant** | R-1: sticky identity delivered by **re-minting under a tree mode** | defect row stays OPEN until R-1 lands; new ACTIVE decisions row owed (**none pins the P3 wire scheme today**) | **Q3** |
| 2 | **Step 1's per-`Node` carrier** | **REJECT as dominated** | R-1 (1)-(2) | — | Q1 |
| 3 | **Step 2's "(B)-lite, no new carrier"** | REJECT the carrier claim; ACCEPT the per-member dispatch | R-1 (4) | — | — |
| 4 | **Stance (B) — the tree compile mode** | **ACCEPT** | R-1 + R-2 + R-3 | defect row → FIXED on red→green; new decisions row; five spec amendments; queue head | Q1, Q2, Q5 |
| 5 | **The resolution-universe delta** | **OPEN — measured before the spec** | supervisor-level red case (P-7) | `docs/pending.md` | **Q4** |
| 6 | **The E2E-4 / S-P1 / E2E-3 pin moves** | **ACCEPT as re-specification, not re-pointing** | one statable rule: *ancestors re-mint, descendants do not*; E2E-3's key count stays 13 | three test files + `ops.md` §5 + `placement-path-spec` §3.3/§4.1 | **Q5** |
| 7 | **The §1.4 forced-re-emit host recipe** | **ACCEPT NOW — documentation only** | R-3 | reply §1.4; `designing-pages.md` | Q6 |
| 8 | **`ORPHAN-EMIT-TOP-LEVEL-LEAK`** | **NOT closed by citation — a candidate side-effect of R-1** | red case P-6 decides; its row closes only on its own evidence | that row | — |
| 9 | **`R-VPD-2` ghost-`childOrder`** | **UNCHANGED — must not be cited as closed** | — | that row | — |
| 10 | **The red file `tests/e2e/post-bootstrap-emit.test.ts`** | **KEEP — insufficient as written** | extend 4 → 9 cases (§8); no existing clause weakened | the file | — |
| 11 | **This gate record** | — | — | `docs/specs/post-bootstrap-emit-drop-fix-review.md` | — |

---

## 6. INVARIANTS THIS CHANGE'S CODE PATH TOUCHES

| Invariant (owner) | Code site | Why |
| --- | --- | --- |
| **`placement-path-spec` §2.1 — the enumeration compile is a THIRD mode; the focused compile stays for "the non-placement world"** (`:274-277`) | `supervisor.ts:682`, `:695-697` | The mode stops being derivable from the dirty node's anchors; it becomes a tree property. §2.1 must be amended, not silently inverted. |
| **§2.2 — `pathKey` is state identity; `forkKey = pathKey` on every path-state** (`:279-308`) | `node.ts:1491-1502` | Unchanged — and it is *why* a re-mint is wire-stable. |
| **§4.1 — wire identity is stable across renders while the topology is unchanged** (`:501-512`) | `render-helpers.ts:131-140` | **The invariant the defect breaks**; it becomes the fix's acceptance criterion. |
| **§4.2 — `childOrder` is path-derived and attached AT MINT TIME** (`:514-530`) | `node.ts:1516`, `:249-267` | Why (A)-refusal cannot work: the spec itself requires a **re-mint** for a structural change. |
| **§3.3 — `placement-attach` into a family-routed container leaves the added path-state orphaned** (`:485-495`) | `supervisor.ts:1173-1196` | Under path mode the container re-mints, so the orphan may gain its append — a pin that could flip (disposition 8). |
| **`render.md` — path-states emit on `pathKey`, else `nodeId`; append only for `childOrder ∩ present`** | `render-helpers.ts:325`, `:138-140`; `render.ts:59`, `:115-117` | The wire scheme and append rule are the whole observable surface. |
| **FRG-H24 — `rootKey` captured on first `createEl`, NEVER reset** (`adapters.md FRG-H24`) | `adapters.ts:463`, `:548` | The fix must **not** touch it; the document must return into the captured domain. |
| **`ops.md` §5 — one coalesced pass-2 tick, bounded slice, no whole-tree recompile; G18** | `supervisor.ts:637`, `:650-665`, `:667-731`, `:51-90` | The mode adds compiles per member — must stay inside the same tick and bounded slice. |
| **PASS2-FIT-REFERENCE-SLICE-SCOPE — S2 parity** | `resolve.ts:229-248` | **Not amended by R-1** (the mode lives on the supervisor) — but **would be** by a Node-side rule. The decisive argument for the landing site. |
| **E2E-4 affected set — container + added node, "nothing deeper"** | `supervisor.ts:1194-1196` | Ancestors gain states under path mode; the **descendant** half holds. |
| **RUNTIME-FORK-GROWTH-GUARD — d10→d12 pass-2 ratio, bound 10×** | `scripts/demo-smoke.mjs` | The measured pages bootstrap **family** ⇒ no change expected; a perturbation is a regression. |
| **VERSIONING-SCHEME** | `package.json` | The landing is `X.Y.X` (`0.6.0`). |
| **Node marker discipline — runtime-only, never serialized, unfakeable** | — | **R-1 adds no `Node` field**, which keeps this discipline untouched. |
| **FS-1 / closed unions — a non-viable arm is recorded in `dropped`** | `node.ts:1407` | A refusal would create a **third** silent outcome; R-1 creates none. |

---

## 7. MUST NOT BREAK

1. **A family-bootstrapped tree emits byte-identically on `nodeId` wires** — `tests/e2e/ssr-render.test.ts:266-283` (`:281-282`), the FRK-H1 cases, the `demo/*.expected.html` census.
2. **Path-mode re-mints reproduce the bootstrap wires when topology is unchanged** — `tests/blind/e2e-layer.test.ts:396-399` (the 13 key strings, unchanged) + the new PBED cases.
3. **`placement-attach`'s affected set keeps its descendant half** — `tests/e2e/path-fork-e2e.test.ts:542-547` (`spyD4a`/`spyD4b`/`spyD5a` uncalled).
4. **A node may hold SEVERAL path states, one per path** — `tests/integration/supervisor.test.ts:285-308`.
5. **`rootKey` is never recomputed** — `tests/unit/adapters.test.ts:913-918` + the FRG block.
6. **`Node.compile` stays pure** — `tests/unit/pass2-fit-reference-scope.test.ts` (`FROZEN_GOLDEN`, S2 parity). A Node-side mode rule fails this line.
7. **Pass-2 must not amplify** — `[runtime-fork:growth]` bound 10×, the 2.5× derived pins, the human ~1.5× watch.
8. **The placement silent-abort keeps reading the recorded bootstrap states** — `supervisor.ts:691-693` + its suite.
9. **`takePass2States` stays the caller's drain; `resolvedStates` stays non-draining** — `tests/integration/resolved-exposure.test.ts:119-140`.
10. **No new closed-union member and no new silent outcome** — `contract.md`, `node.md:109-111`, the `warnings).toEqual([])` population.
11. **The journal keeps one entry per op with the recorded result fields** — `tests/integration/supervisor.test.ts` + `ops.md` §6.
12. **`R-VPD-2` and `ORPHAN-EMIT-TOP-LEVEL-LEAK` are not silently claimed closed** — their rows stay until their own probes land.
13. **`npm test`'s two phases stay intact** — new heavy files join `SMOKE_SPAWNING_TEST_FILES`, never skip.
14. **No doc may claim a seam that does not exist** — the amended §2.1/§4.1 wording ships **with** the probes that assert it.

---

## 8. The red-first work the next unit owes (ordered)

**Phase 0 — the existing red file is the baseline, not yet a gate.** **P-0** run `tests/e2e/post-bootstrap-emit.test.ts` and record the true red text of each case.

**Phase 1 — the five additions that let the file select the variant** (observable-only):
- **P-1 PBED-5 — the append half.** After the sanctioned change, the new node is **appended into its host**: exactly one `append` whose `owner` is `#filler`'s wire and `child` is the new node's wire, and the html shows it **inside** `#filler`. *Fails under (A)-refusal; passes under R-1.* This clause selects the stance.
- **P-2 PBED-6 — the refresh channel (B2's freeze).** A post-bootstrap `state-slice` `props`/`content` write on a **non-placement** node (the root) still renders. *Passes today, fails under refusal* — the control against overshooting.
- **P-3 PBED-7 — the domain rule, strong form.** Every R2 wire lies in the R1 wire set **or** the new-domain wire is accompanied by a diagnostic; applied to **new** nodes too.
- **P-4 PBED-8 — Z1.** Bootstrap(path) → op → condense past `maxJournalLength` → `undo()` to base → render: the root still emits on `"root"`, document non-empty. *Only a supervisor-carried mode passes.*
- **P-5 PBED-9 — Z2.** A host whose map is **replaced** by each `takePass2States()` drain still emits the root. *Only a supervisor-carried mode passes.*
- **P-6 PBED-10 — the ORPHAN row's own scenario** (`placement-attach` into a family-routed container in a path-mode tree) → the added node gains its append. Its own case, never a by-product.

**Phase 2 — measurements before the spec:** **P-7** the resolution-universe probe (an ancestor consuming a name provided by a DESCENDANT) → decides Q4; **P-8** re-derive the exact new expectations for E2E-4a/b, S-P1 and E2E-3, confirming **13 stays 13** (if not, the mode is wrong, not the pin); **P-9** growth-guard confirmation (`demo:smoke` before/after, no `expected.html` regenerated).

**Phase 3 — implementation order:** red set first (P-1..P-6 failing, plus the existing four), then R-1's `supervisor.ts` change, then the three pin re-specifications, then the docs (five amendments + the new ACTIVE decisions row + R-3), then the trio.

**Pricing note, verified:** PBED-3 as written iterates only nodes present in **both** renders and its wire list names only `root`/`holder`/`card` — so under (A)-refusal **PBED-1, -2 and -3 all pass while the row stays open.** That is the single most important pricing fact of this gate: the file must be extended before it can gate a fix.

---

## 9. Open questions for the owner

1. **The carrier.** Supervisor field inferred at `recordResolved` (recommended — the red file passes as written, every in-tree path host already calls it), **or** an explicit option/setter only (then the fixture must pass it — meaning "the engine is right and the host must declare it", which is not what the consumer's arm does)?
2. **Public surface.** A documented `Supervisor` option + a decisions row (`X.Y.X`), or strictly internal inference with no name a host can hold?
3. **The invariant's wording.** Do you accept **(A) restated as** *"a node that has been minted in the path domain is always re-derived in the path domain"* — the same guarantee, delivered by re-minting instead of refusing? **This is the decision the whole record rests on; the gate's answer is that the refusal reading cannot be shipped.**
4. **The resolution universe.** Does a path-mode ancestor keep `fitReference`'s descendant scan or accept path-only resolution? Decided on P-7's measurement, with the red case written first.
5. **Three pinned tests move.** Approve re-specification under one rule — *ancestors re-mint, descendants do not* — with E2E-3's key count unchanged at 13? A silent re-point of any is forbidden.
6. **The §1.4 host recipe.** Correct it in place now (doc, no code), or also add a Node-side safety net later — knowing that a Node-side rule breaks S2 parity and makes `Node.compile` history-dependent?
7. **Scope.** Does the row close on R-1 alone, or split into (i) the mode fix and (ii) a public tree-mode API for hosts that bootstrap by a route the supervisor never hears about?
8. **Does R-1 also close `ORPHAN-EMIT-TOP-LEVEL-LEAK`'s (b) half?** The mechanism says yes; the row must close on P-6's evidence with its wording amended, never by citation.
9. **Version.** One `0.6.0` release, or the mode in a patch-adjacent release with the spec amendments following? The emitted-wire change must be named in the changelog either way.

---

## 9b. ANCHOR DEBT (recorded, not repaired)

The 2026-11-23 documentation pass inserted text into `placement-path-spec.md` (§2.1/§2.2/§3.3/§4.1/§6.2), `render.md` (§3.3, R-ORD-8), `adapters.md` (§4.6) and `ops.md` (§5), so **line numbers inside those documents moved** (§2.2 279→298, §3.3 436→461, §4.1 503→544, R-ORD-8 171→185, FRG-H24 747→769). Section-level citations all still resolve and were repointed where they were explicit; **bare `:NNN` parenthetical ranges written before the pass now land early** — the repo's own `STALE-RESOLVE-ANCHORS` class. This is a bookkeeping debt for the next housekeeping pass (repoint by symbol). No contract is affected: every one of those citations sits beside a correct §-reference.

---

## 10. OWNER RULINGS (2026-11-23) — the gate record is BINDING

| Q | Ruling | Effect |
| --- | --- | --- |
| **Q3** — the invariant's wording | **ACCEPTED as restated: *"a node that has been minted in the path domain is always re-derived in the path domain."*** The owner does **not** hold the refusal reading; the guarantee is delivered by re-minting under a tree compile mode. | R-1 is the sanctioned mechanism. §4.2's answer stands as the record's premise. |
| **Q1/Q2** — the carrier | **Infer at `recordResolved` AND expose an explicit `Supervisor` override.** The mode is derived from the documented bootstrap seam (so the consumer's arm and every in-tree path host work unchanged) and a host bootstrapping by an unseen route can declare it. | R-1 §4.4(1)-(3) as written; a documented `Supervisor` option + a new ACTIVE decisions row (`X.Y.Y`-class change is `X.Y.X` = `0.6.0`). |
| **Next** | **Extend the red set FIRST (the six §8 Phase-1 cases), then implement R-1.** | Phase 1 of §8 proceeds before any `src/**` edit. |

**Still owed, and NOT ruled by this pass:** **Q4** (the resolution universe — decided on probe P-7, red case written
first), **Q5** (the three re-specifications under *ancestors re-mint, descendants do not*, with E2E-3's key count
unchanged at 13), **Q6** (whether a Node-side safety net is ever added, knowing it would break S2 parity), **Q7**
(scope: R-1 alone vs also a public tree-mode API), **Q8** (whether R-1 also closes `ORPHAN-EMIT-TOP-LEVEL-LEAK`'s (b)
half — on P-6's evidence, never by citation), **Q9** (release packaging).

---

**Verdict, one line.** (A) is **right as an invariant and wrong as a mechanism**: refusing the family state delivers
"no re-key" by freezing every non-placement node's only refresh channel, keeps the stale mint-time `childOrder`, and
therefore ships `ORPHAN-EMIT-TOP-LEVEL-LEAK` — the loud-to-silent trade already refused for (C). It is replaced by
its own guarantee: **a tree compile mode carried on the `Supervisor`, entered at `recordResolved`, honoured by every
pass-2 slice member** — with the resolution-universe delta measured first, three pinned tests re-specified under one
statable rule, and the §1.4 recipe corrected in place. The existing red file is **kept and extended**: as written it
passes under the very stance it should reject.
