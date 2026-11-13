# Spec — VALUE-PROVIDER-RENDER-DISPOSITION: an authored provider IS an element; only runtime-minted value records are dropped as values (and the residual drop is warned)

- **Status:** **SPEC-WRITTEN 2026-11-13 — contract only.** Nothing in this file is built
  and no test in it exists yet: `src/**`, `tests/**` and every demo page are
  **unchanged by this unit**. The red set owed is §8 (register rows `VPD-1…VPD-12`,
  written red-first per `AGENTS.md` item 8); the implementation is the separately
  gated unit that follows. The three tracker rows this contract owes are named in the
  header block below and **do not exist yet**.
- **Owner / authority:** the **owner's ruling** (2026-11-13), quoted as its substance —
  **(1) PROVENANCE RULE:** *an AUTHORED provider IS an element and renders; only
  RUNTIME-MINTED value records are dropped as values.* **(2) RECORDED DROP:** *the
  drop must be recorded (a diagnostic) so this class is never silent again.* This
  file is the contract; the ruling is not re-litigable here.
- **The defect this contract closes (established by measurement, not open to debate):**
  `src/core/node.ts:1253` —
  `if (hasAnyTarget && isResolutionParticipant(node) && !isSeamProvider(node)) continue` —
  drops from render **any** target-less node that provides a component name (a
  `source` **or** `duplex` anchor) when another node in the **compile slice** consumes
  that name. It is a bare `continue`: nothing enters `CompiledResult.dropped`
  (`types.ts:298`), no `warnings` entry is pushed (`types.ts:299`), no `console.warn`
  fires. Measured consequences on the released package: an authored provider carrying
  children is dropped and its children are **orphaned** (flattened to the level above,
  while the parent keeps a `childOrder` entry — `[...(cs.children ?? [])]`,
  `render-helpers.ts:325` — for a wire that has no element), and
  `demo/feature-showcase.expected.html:22` ships the defect in a tracked artefact: the
  authored root (`demo/feature-showcase.js:74`, `props: { id: 'showcase-root' }`, with
  `children` at `:80`) appears **nowhere** in that expected output — grep for
  `showcase-root` in the artefact finds nothing, and its children sit directly under
  the page frame.
- **Root cause (why this is a contract unit at all):** the predicate shipped in the
  **initial commit `996ca7f` (2026-08-10) with no decision record**; the justification
  text in the code comment (`node.ts:1177-1183`, *"a value holder, never an element"*)
  was added later in **`6eb1cb4` (2026-08-15)**, after a blind test classified an
  author's surprise as a data error rather than an engine defect. **No spec clause ever
  stated the drop**, while `docs/specs/node.md:288` states its opposite —
  *"`in-tree` … fully actionable (the only render-eligible state)"*. The behaviour is
  also **slice-composition-dependent** (see §1), so the same graph classifies the same
  provider differently depending on what was compiled with what — and `compilePath()`
  (`node.ts:1325-1381`) never had the drop at all. **The engine has disagreed with
  itself about provider semantics since `996ca7f`; the absence of a decision row is the
  root cause of the drift, not a documentation gap.**
- **Decision-record pointer owed (three rows, none of which exists today):**
  1. `docs/decisions.md` — a new ACTIVE row for this disposition (target name
     **`VALUE-PROVIDER-RENDER-DISPOSITION`**), citing this spec's §3 and the ruling
     above. **No row with this or any similar name has ever existed** (verified by
     grep over `docs/decisions.md` for `VALUE-PROVIDER` / `value-provider` /
     `provider-render`), which is precisely the drift this unit exists to close.
  2. `RENDER_PROCESS_NOTES.md` — a `DECIDED:` entry **`### 10.10.13`** (the next free
     number in that section; `§10.10.12` is its current last entry,
     `RENDER_PROCESS_NOTES.md:1497`), recording (a) the provenance rule, (b) the
     dedicated `valueRecord` marker and the two rejected overloads (§3 C2 / AM-1),
     (c) the diagnostic channel + dedup (AM-4), (d) the A6 emit-gate-only constraint.
  3. `docs/defects.md` — a FIXED-shape row for the silent drop (with the
     `demo/feature-showcase.expected.html:22` artefact as its evidence) **plus** the
     three separately-recorded defects this unit does **not** fix (§7 R-VPD-1..3).
- **Target version:** the next **`X.X.Y` defect patch** — **`0.5.2`** against the
  current `0.5.1` — per `VERSIONING-SCHEME` (`docs/decisions.md:30`). The bump itself
  is the supervisor's edit, not this unit's. A `console.warn` channel keeps every
  public signature stable, so no minor (`X.Y.X`) bump is required (§3 C3, AM-4).
- **TestWriter contract:** every state, fail-state, diagnostic code, message shape and
  register row below is derivable from this file **alone** — no implementation reading
  is required to write the red set (§8).
- **Provenance (read-only, not re-litigated):** the two-step gate findings recorded as
  AM-1…AM-8 in §6; the `BODYRUNS-DROP-DIAGNOSTICS` precedent
  (`docs/decisions.md:38`, `docs/specs/bodyruns-drop-diagnostics.md` §3 C4 +
  §9.6b/§9.8 `R-W4-5`) and its dedup-scope row (`docs/decisions.md:41`); the
  `RUNTIME-FORK-GROWTH-GUARD` bound (`docs/decisions.md:18`).
- **Date:** 2026-11-13.

---

## 1. The predicate as implemented today (description, NOT a contract)

Recorded so the change is legible; **nothing in this section is a requirement**.

**1.1 Site and shape (the F3/D7 shape).** `compile(slice, opts)` classifies the slice
into `viable` / `dropped` (`node.ts:1119-1160`) — destroyed, loop, `component`-token,
non-root token, destroyed-owner and non-self-providing-unplaced nodes are dropped
**here**, each with an `ArmDropReason` (`node.ts:1122`, `:1129`, `:1133`, `:1137`,
`:1141`, `:1155`). Surviving nodes reach the two-branch emit gate at `:1252`:

| Branch | Condition | What it does |
| --- | --- | --- |
| arms branch | the node has ≥ 1 `target` anchor with a string target | `resolveArms(...)` then one `CompiledState` **per arm** (`node.ts:1262-1303`) |
| target-less branch | `!hasAnyTarget \|\| targetNames.length === 0` | `makeCs` + `publishOwn` + `applyDerivedBake` + one state (`node.ts:1252-1260`) — **unless the drop fires** |

The drop at `node.ts:1253` is the **first statement of the target-less branch**, so it
can only ever see a node that itself carries **no `target` anchors** — i.e. a *pure*
provider. A mixed provider+consumer node (targets **and** a `source`/`duplex`) never
reaches it; it emits per arm at `:1264-1303` and is unaffected by anything in this unit.

**1.2 The three slice-global inputs.** The predicate is not a property of the node
alone:

- `hasAnyTarget` (`node.ts:1162-1164`) — "does **any** node in the slice carry a
  string `target` anchor". With no target anywhere in the slice, the drop is inert and
  every provider emits (this is why the same provider renders in a single-node compile
  and vanishes in a sibling compile).
- `consumedNames` / `isResolutionParticipant` (`node.ts:1165-1176`) — the node's
  `source`/`duplex` name is in the slice's target-name set.
- `seamConsumedNames` / `isSeamProvider` (`node.ts:1184-1197`) — the name is consumed
  by a seam-target anchor (`options.seam !== undefined`). This is the **D7 exception**
  that keeps the `[6]` root-clobber pin green: the seam wrapper renders the def's
  children, so the def **host** must render its own real children
  (`tests/e2e/legacy-shape.test.ts:357-363` — `rootEl` defined, `type === 'app'`, its
  three wrappers as `childOrder`, and the auth def children appearing **only** inside
  the wrapper that seam-references them).

The slice itself is composed by `focusedSliceFor` (`supervisor.ts:51-89`): the ancestor
chain (`:53`) + the descendant closure (`:54-59`) +, on a target-bearing path with no
hub answer, **every provider in the universe** (`:77-88`). So `hasAnyTarget` and
`consumedNames` are functions of *who else was compiled in the same pass*.

**1.3 The silence.** The drop is a bare `continue`. It does **not** push to `dropped`
(whose `reason` union is closed at `types.ts:279`, pinned by `docs/specs/contract.md:92`
and `docs/specs/node.md:109-111`), does **not** push to `warnings` (closed union,
`types.ts:299`), and does **not** call `console.warn` — unlike the two drop classes
beside it, which do warn (`circular-source`, `node.ts:1128`, `:1268`). A host watching
the entire observable surface (`actionable`, `dropped`, `warnings`, `journal`,
`events`) sees a provider vanish with **no trace**. It violates `docs/specs/node.md:412`
(FS-1: a non-viable arm is *"recorded in `dropped` with the correct `ArmDropReason`"*)
without violating any test, because no clause ever stated the drop.

**1.4 What the release ships.** Measured on the released package:
`demo/feature-showcase.expected.html:22` carries the flattened result (no
`<app id="showcase-root">`), so a tracked, diffable artefact *encodes the defect as
expected behaviour*. `demo/fork-stress.js:456-459` and `:477-478` do the same for the
runtime family (walk from the placement zone, *"the app root is a consumed PROVIDER, so
it is not emitted"*, count `2**depth - 1` = "zone + layers"), and
`docs/skills/designing-pages.md:1593-1599` (§14.10 item 1) is the only **normative
author-facing statement** of the behaviour — it teaches the defect.

---

## 2. The contract

Every clause is numbered and marked **DECIDED** (settled by the owner's ruling or the
gate) or **REJECTED**. `file:line` anchors are locating aids: the implementer must
re-read each before acting on it.

### C1 — Disposition rule · **DECIDED** (the owner's provenance ruling)

**The rule:** *a provider node that is a **resolution participant** in the compile slice
is emitted as an element **unless** it is a runtime-minted value record and is not
seam-consumed.*

The emit gate at `node.ts:1252` becomes, **in this exact order** (order is normative —
see the A2 amendment, §6 AM-2):

> `hasAnyTarget` **and** `isResolutionParticipant(node)` **and** `!isSeamProvider(node)`
> — with the seam test **hoisted into a local and evaluated before any provenance
> test** — **and** `node.valueRecord === true` ⇒ drop; otherwise emit as the ordinary
> target-less branch does today.

Written as the contract's normal form, the fourth conjunct is the **only** new test and
it is the **last** one:

- **MUST:** `const seamExempt = isSeamProvider(node)` is evaluated **before**
  `node.valueRecord` is read. A minted seam host exists (`adoptDefChildren` sets
  `runtimeMinted` on children that are elements, `node.ts:1869-1870`) and the `[6]`
  pin depends on the exemption — a conjunction that reads the marker first is a
  **contract violation even if the outputs coincide**, because it makes the exemption
  conditional on provenance.
- **MUST:** emit a now-released provider through the **unchanged** target-less branch
  body (`makeCs` → `publishOwn` → `applyDerivedBake` → `actionable.push`, `:1254-1259`)
  — its own `pathKey`, no `forkKey`, `children` = its real child ids. Nothing else about
  the state is special-cased.
- **MUST NOT:** touch the arms branch, `resolveArms`, or the per-arm seed/bake sequence
  (`:1262`, `:1283-1293`) — see C4 and §3 FS-VPD-7.
- **MUST NOT:** introduce a second, standalone state for a node that already reaches
  the arms branch (a mixed node's state count is fixed by its arm count).

Disposition table (the complete matrix this clause pins):

| Node class | Target-less? | Provides a slice-consumed name? | Disposition |
| --- | --- | --- | --- |
| **authored** provider (no `valueRecord`) | yes | yes | **EMIT** — the change |
| runtime-minted **value record** | yes | yes | **DROP** + diagnostic (C3) — the residual |
| value record, **seam**-consumed | yes | yes (via a seam target) | **EMIT** (A2 exemption) |
| mixed provider + consumer | **no** (has targets) | irrelevant | per-arm emit, **unchanged** (C4) |
| `unplaced` / `prototype` / `destroyed` / loop | — | — | dropped **earlier** (`:1119-1157`), unchanged |

### C2 — The `valueRecord` marker · **DECIDED** (§6 AM-1)

**The marker is a dedicated `Node` field, `valueRecord: boolean`, default `false`,
declared beside `runtimeMinted` (`node.ts:367`), set by the value-record mint sites and
by nothing else.** It is **not** serialized, **not** compiled into a `CompiledState`,
and **not** derivable from any document.

- **Mint sites (exhaustive):** `mintRowNode` (`ops.ts:499-501`, immediately beside
  `node.originLayer = layerId` and `registerMinted(node.id, layerId, scope)`). Both
  rows-mint paths funnel through it — the batch path (`ops.ts:350`) and the keyed path
  (`ops.ts:440`) — so **one write covers both**.
- **The keyed-reuse path MUST preserve the marker:** a reused keyed row is reconciled
  in place by `reconcileRowFields` (`ops.ts:428-443`) and is **not** re-minted, so the
  flag set at its original mint stands. Reconcile must not clear, re-derive or
  conditionally re-set it.
- **`layerApply` is NOT a value-record mint site** (`ops.ts:186-188`): its A5 veto
  rejects seeded `anchors` (`ops.ts:180-185`), so a layer-apply-minted node can carry
  **no** provider anchors and can never be a resolution participant. Stated so that a
  future "set it everywhere a node is minted" reflex is a contract violation, not an
  interpretation.
- **Survivor promotion KEEPS the marker.** `teardownMinted`'s promotion branch clears
  `originLayer` (`node.ts:753-756`) so the moved row becomes authored content for
  *reverse* purposes; it must **not** clear `valueRecord`. A promoted raw data row is
  still a runtime-minted value record and still does not materialise as an element —
  which is exactly the outcome `rowsTeardown`'s no-promotion override exists to
  guarantee for the rows namespace (`node.ts:768-788`, especially the rationale at
  `:770-773`: promoting would ship raw rows the author never wrote).
- **`clone()` copies the marker** (`copy.valueRecord = this.valueRecord`, beside
  `copy.runtimeMinted = true`, `node.ts:844`). A clone of a value record is a
  runtime-minted value record; a clone of an authored provider is **not** (and its
  clone-time `runtimeMinted` continues to govern **reverse exclusion only** —
  `translate.ts:1459` — never render disposition, per A1). Cloning the marker without
  copying it is a REJECTED alternative: a cloned row would materialise as a duplicate
  data element.
- **Survives re-mint, not serialization.** The marker is re-established by the mint
  site on every re-mint (rejection/replay/reconcile all re-enter `mintRowNode`). It is
  **never written to a document**: `serializeNode` excludes minted nodes anyway
  (`serialize.ts:123`, `:190`), and `parseNodeState` (`serialize.ts:266-366`) is an
  explicit key whitelist — `id`, `type`, `props`, `css`, `children`, `content`,
  `bodyRuns`, `anchors`, `forkKey`, `derived`, `hooks`, `hooksKind`, `batches` — so a
  crafted document **cannot** set `valueRecord`, `originLayer` or `runtimeMinted`.
  A `loadState`-seeded provider is therefore **authored** and renders: that is the
  provenance rule working as intended, not a gap.
- **REJECTED overload 1 — `originLayer` as "is a value record".** `originLayer` already
  means **teardown ownership** (`node.ts:734-766`) and promotion **clears** it
  (`:753-756`) precisely so a moved minted row becomes authored content; an
  `originLayer`-keyed rule would therefore materialise a promoted raw data row as an
  element — the exact outcome `rowsTeardown`'s override forbids (`:768-777`).
- **REJECTED overload 2 — `runtimeMinted` as the discriminator.** `adoptDefChildren`
  sets it on children that **are** elements (`node.ts:1869-1870`), and it already
  carries reverse exclusion (`translate.ts:1459`), serialize exclusion
  (`serialize.ts:123`, `:190`) and destroy-retention semantics
  (`registry.ts:418-429`). Keying render disposition on it would make seam adopter
  children vanish and would entangle four unrelated contracts.
- **REJECTED minimal alternative — `runtimeMinted && !adoptedDefChild`.** It is
  *minimal in code* but not in cost: no `adoptedDefChild` discriminator exists, and the
  seam child anchor at `node.ts:1870` (`kid.addAnchor('child', kid, { priority: i,
  seam: true }, fam)`) is currently its **only** trace; inferring it would mean
  scanning family links at every emit-gate evaluation, and it cannot distinguish an
  adopted def child from a clone (which also sets `runtimeMinted`, `node.ts:844`).
  Recorded as the fallback only if a later gate rules against the dedicated field.

### C3 — The residual drop and its diagnostic · **DECIDED** (§6 AM-4, AM-5)

**The diagnostic's subject is the RESIDUAL class only.** Under C1 the authored-provider
drop **ceases to exist**; what remains silent is the **runtime-minted value-record
drop**. The diagnostic covers that one node class and nothing else.

- **Channel:** **`console.warn` ONLY** — one string argument, at the compile emit gate.
  Precedent: `BODYRUNS-DROP-DIAGNOSTICS` (`docs/decisions.md:38`), which chose
  `console.warn` and **explicitly REJECTED** widening the return surface as an own-gate
  `X.Y.X` public-surface change (`docs/specs/bodyruns-drop-diagnostics.md:214`).
- **MUST NOT add an `ArmDropReason` member.** The union is closed (`types.ts:279`) and
  pinned by `docs/specs/contract.md:92` + `docs/specs/node.md:109-111`.
- **MUST NOT add a `CompileResult.warnings` code.** That union is closed (`types.ts:299`)
  and there are ~20 `res.warnings).toEqual([])` assertions across the suite.
- **MUST NOT push the residual into `dropped`.** That is FS-1's `dropped`-completeness
  half (`docs/specs/node.md:412`) — **not discharged by this unit** and a separate
  `X.Y.X` decision (C5). The residual drop remains outside `dropped`; the diagnostic is
  its only record.
- **Code string:** `value-record-drop`. **Message shape** (matching the compile gate's
  two existing warns, `node.ts:1128` / `:1268`, which are `code at pathKey` with no
  bracket prefix): one string argument —
  `value-record-drop at <node.pathKey>: runtime-minted value record "<name>" is consumed in this compile slice — not rendered as an element`.
  `<name>` is the **first** consumed `source`/`duplex` name in anchor order
  (deterministic; the node may publish several).
- **Dedup:** a **module-level, never-cleared** set keyed
  `` `${code}\u0000${nodeId}\u0000${name}` `` — exactly C4 of
  `docs/specs/bodyruns-drop-diagnostics.md` §3 (`:484-518`) as recorded in
  `docs/decisions.md:41`. The second component is the node's `id` (**the wire the emit
  side would have used**); the third is the consumed provider name (the value identity,
  the slot C4's third component carries). Short strings only, no graph references, no
  clamp — the no-clamp reading is `decisions.md:41`'s recorded state.
- **`shouldWarn` gating:** the emit is wrapped in the **existing** focus gate
  `if (shouldWarn(node)) console.warn(...)` (`node.ts:1048-1049`), so a pass-2 compile
  whose `focusNodeId` is a descendant stays quiet about an ancestor value record —
  identical to how `circular-source` and `unresolved-reference` are gated today.
- **R-W4-5 is INHERITED VERBATIM** (`docs/specs/bodyruns-drop-diagnostics.md` §9.6b /
  §9.8; `docs/decisions.md:41`). Stated in full because it is a host-visible limit of
  *this* diagnostic too:
  1. The guarantee is **one warn per `(code, nodeId, name)` per PROCESS, never per
     document** — the ids are authored/serialized data (`loadState`-seeded graphs,
     doc-carried envelopes), not process-unique handles.
  2. A **second document in one process can be silently denied** a diagnostic it never
     saw, because document A already met the identical triple.
  3. The set is **unbounded — no clamp**.
  4. An **absent** line must **never** be read as "nothing was dropped". A host needing
     per-document completeness must route/wrap `console.warn` per document, or accept
     the suppression. Changing the mechanism (per-document key, per-document reset, a
     clamp) is a **contract decision with its own gate**.
- **Visibility limit (recorded, not fixed):** `demo/fork-stress.js:239` does
  `console.warn = () => {}` for the page's whole bootstrap render window, restoring it
  after; the diagnostic is therefore **not observable** in that window on that page. No
  demo may be altered to work around it, and no test may assert warn counts through
  that window.

### C4 — What does NOT change · **DECIDED** (§6 AM-6, AM-8)

- **The mixed provider+consumer node** (target-bearing **and** providing) keeps emitting
  **per arm** (`node.ts:1262`, `:1283-1293`): one state per resolved arm, own values
  seeded per arm, `forkKey` per arm. It MUST NOT be given a second standalone state and
  its state count is unchanged by this unit (§3 FS-VPD-7).
- **`compilePath()`** (`node.ts:1325-1381`) is **unchanged**: it never had the drop, it
  already emits path-states for providers whose placement path enumerates to `rootNode`,
  and this unit does not touch it. The pre-existing divergence between the two compile
  modes for provider semantics is exactly why C1 is written **at the `compile()`
  emit gate** and not as a generalised graph rule.
- **Reverse and serialize are untouched — a hard constraint, not a preference.** The
  change is **emit-gate only, never translate time, never graph mutation**. Rationale:
  the drop exists only at the emit gate today, which is *why* `reverseTranslate` /
  `serializeNode` output is unaffected; the reverse exclusions key on
  `originLayer` / `runtimeMinted` (`translate.ts:1447-1466` — the `originLayer`
  comment block, the `preserved` cascade, and the `kids` filter at `:1458`), and
  `serializeNode`/`serializeSlice` key on the same pair (`serialize.ts:123`, `:190`). A
  **graph-level** "fix" (minting, re-parenting, or flagging nodes at compile time) would
  change reversed envelopes and break `demo/translate-showcase`'s reverse checks
  (`demo/translate-showcase.js:396` K5/N1 round-trip) and
  `tests/unit/reverse.test.ts:180`.
- **The `dropped` array is unchanged** — same members, same `ArmDropReason`s, same
  ordering (`node.ts:1122`…`:1155`, `:1270`, `compilePath` `:1330`/`:1372`/`:1376`). The
  authored-provider drop never entered it and the residual still does not (C3).
  Consequence for re-pins: an existing `expect(res.dropped).toHaveLength(0)` stays
  **valid** while `actionable` grows — e.g. `tests/unit/render.test.ts:537` holds while
  `:536` moves 1 → 2 (§4).
- **`CompileResult`, `CompiledState`, `ArmDropReason`, the `warnings` union, and every
  public signature are unchanged.** No new exported type, no new field on a
  `CompiledState`, no new op kind.

### C5 — Scope and non-goals · **DECIDED** (§6 AM-3, AM-5)

**In scope:** in-tree **family-tree** providers authored through the legacy envelope or
the programmatic API (target-less, slice-consumed, not seam-consumed) are released: they
emit their own element, their children stop being orphaned, and the parent's `childOrder`
entry stops referring to a wire with no element.

**Out of scope — the three exclusions, stated plainly so no downstream unit reads this
contract as broader than it is:**

1. **Content-root providers are NOT released.** A provider whose chain terminates at a
   `contentNodes` token is dropped **earlier** as `owner-terminated`
   (`node.ts:1136-1139`) — before the emit gate at `:1252` is ever reached. C1 cannot
   reach it and this unit does not change that branch.
2. **Children under a minted parent still flatten.** When the dropped node is a value
   record (C3), or when the parent is minted/out-of-tree, the flattening-and-orphaning
   mechanism is unchanged. C1 releases exactly one class.
3. **No position index is supplied.** The released provider emits an element, but the
   engine supplies **no ordinal/position channel** for it (no new `CompiledState` field,
   no `#f:`-grammar dependence, nothing the emit side can hand a consumer). A downstream
   consumer needing a provider's **position** for styling remains **unmet**, and meeting
   it is a separate contract with its own gate.

**Also out of scope (explicit):** **FS-1's `dropped`-completeness half**
(`docs/specs/node.md:412`) is **NOT discharged by this unit**. The residual value-record
drop still leaves no `dropped` entry. Closing that is a separate `X.Y.X`
public-surface/contract decision (it would either add an `ArmDropReason` member or
redefine FS-1's requirement), and C3's `console.warn` must not be read as a substitute
for it.

---

## 3. Fail-states (TestWriter checklist)

`FS-VPD-n` are this contract's fail-states; each maps 1:1 to a register row in §8. Every
"observable" column is reachable through the public surface (`compile()` result,
`emitElements`, the adapters, `console.warn` capture). None requires implementation
reading.

| ID | Input shape | Observable | Mandated behaviour |
| --- | --- | --- | --- |
| **FS-VPD-1** | **Authored provider with children.** A root (or family child) with `component: {reference:'x', value:'v'}` and ≥ 1 real `children`; a **descendant** carries a `target` on `x`. The provider is target-less, `valueRecord` false. | `res.actionable` (the provider's own state is present); the emitted element set (a parent element exists); the parent's `childOrder`; `console.warn` calls. | **EMIT.** The provider has **one** actionable state at its own `pathKey` with its own published `bindings.x`; `emitElements` produces an element for its wire; its children are children of that element (not flattened to the grandparent); the parent's `childOrder` entry resolves to a real wire; **no** `value-record-drop` warn. |
| **FS-VPD-2** | **Authored provider with NO children** (a leaf provider) consumed elsewhere in the slice. | `res.actionable`; emitted element set; warn capture. | **EMIT** — one state, one (childless) element. The rule is provenance-based, **not** child-count-based: a provider is an element whether or not it carries children. **No** warn. |
| **FS-VPD-3** | **Runtime-minted value record** (rows-mint / keyed rows-mint), its field name consumed by another node in the slice. | `res.actionable` (no state for the row); `res.dropped` (still **empty** of it); `console.warn` capture. | **DROP + WARN ONCE.** No actionable state and no emitted element for the row; `dropped` gains **no** entry (C4); exactly one `console.warn` whose string contains `value-record-drop`, the row's `pathKey` and the consumed name; a **second identical compile in the same process emits ZERO further warns** (C3 dedup). |
| **FS-VPD-4** | **Minted value record promoted by a move** — a keyed row matched and moved out of the origin subtree, then `teardownMinted` runs its survivor-promotion branch (`originLayer` cleared). | `res.actionable` for that row; reverse/serialize output. | **STILL DROPPED as a value** — promotion clears `originLayer` only; `valueRecord` survives (C2). The row gains no actionable state and no element. Reverse exclusion is governed by the existing `originLayer` clear (unchanged behaviour, C4): the promoted row reverses as authored content. |
| **FS-VPD-5** | **Adopted def child that is a seam host** — a node with `runtimeMinted` set by `adoptDefChildren` and a seam child anchor, whose name is seam-consumed. | `res.actionable`; emitted element set; the `[6]` seam pin shape (`tests/e2e/legacy-shape.test.ts:357-363`). | **EMIT.** The seam exemption is evaluated **before** any provenance test (C1/A2), so a minted seam host renders exactly as today: the def children appear **only** inside the wrapper that seam-references them, the root element exists with `type` intact, and no def-prototype wire is emitted. **No** warn. |
| **FS-VPD-6** | **Content-root provider** — a provider whose chain terminates at a `contentNodes` token. | `res.actionable`; `res.dropped`. | **UNCHANGED: dropped with `reason: 'owner-terminated'`** at the earlier gate (`node.ts:1136-1139`), an entry in `dropped`, and **no** `value-record-drop` warn (C5 exclusion 1 — the emit-gate diagnostic must not fire for a node that never reached the gate). |
| **FS-VPD-7** | **Mixed provider + consumer node** — carries a `target` on one name **and** a `source`/`duplex` for another name that the slice consumes, plus authored derived/self-apply reads. | `res.actionable` filtered to that node (count + per-arm `bindings`/`forkKey`). | **UNCHANGED per-arm emit.** Exactly **one state per resolved arm**, each with its own arm `bindings`, its own seeded own values and its own `forkKey`; **no** additional standalone state; the count matches the pre-change count (C4, AM-8-iv). |
| **FS-VPD-8** | **Provider whose value is an array** — `component: [{reference:'x', value:[…]}]` (array-form binding), target-less, name consumed in the slice. | `res.actionable`; the emitted element's props (via a derived/self-apply read); op count across two flushes. | **EMIT**, with the array value published as-is (arity changes nothing: the disposition is per node, not per value). **Re-bake churn is ACCEPTED, not guarded** (AM-8-ii): `applyDerivedBake` runs per state (`node.ts:1258`, `:1301`) and `diffMinimal` compares with `!==` (`render.ts:86`), so a **fresh object/array bake emits a `set` per flush**. Accepted because the canon is never mutated (the bake lands on the freshly built state) and because guarding it would require a new compare path or bake cache — a separate contract. **Falsifier:** the derived per-region smoke pins (2.5×) must hold (§4); if they trip, this clause's acceptance is refuted. |
| **FS-VPD-9** | **Slice with NO targets at all** — an authored provider plus consumers whose anchors never carry a string `target` (so `hasAnyTarget` is false). | `res.actionable`; warn capture. | **EMIT, and no warn** — the control for `hasAnyTarget`. The drop (residual or otherwise) is inert in a target-free slice; behaviour is byte-identical to today. |
| **FS-VPD-10** | **Value record nobody consumes** — a minted row whose field names are **not** consumed anywhere in the slice. | `res.actionable`; warn capture. | **EMIT** (it is not a *resolution participant*; C1's second conjunct is false) **and no warn**. The value-record marker alone is **not** sufficient for a drop — the record must be consumed by name. |

> **Diagnostic-shape notes for all rows above.** `value-record-drop` is the **only** new
> code string; it never appears in `CompileResult.warnings`, never in `dropped`, and
> never in `Supervisor` events. Warn assertions must be **scoped to
> `console.warn`** and must not assert a global count across a whole file (the dedup set
> is process-level, C3 / R-W4-5 item 1) — assert **per-signature** behaviour (first pass
> warns, second identical pass in the same process does not) and use unique node ids per
> case.

---

## 4. Verification obligations

**4.1 Contract-mandated re-pins (not optional cleanups).** The change **flips** these
existing expectations; each must be re-derived from a fresh run, and the diff must be
attributable **entirely** to C1 (one new element/state per released provider):

| Artefact | Before → after | Note |
| --- | --- | --- |
| `tests/unit/render.test.ts:529-541` (**FRK-H1**) | `expect(res.actionable).toHaveLength(1)` → **2** | The slice is `[root, leaf]`, `root` provides `slot` and `leaf` targets it (`:532-533`), so `root` is a released authored provider. `expect(res.dropped).toHaveLength(0)` (`:537`) and the `circular-source` count (`:540`) **stay**. The case name ("a single source … yields one actionable state, no fork") must be re-worded: the **fork** clause still holds (one state **for the consumer**); the state **total** legitimately grows. |
| `tests/unit/pass2-fit-reference-scope.test.ts:591-607` (**`FROZEN_GOLDEN`**) | gains **4 `slot` provider states** | The golden's hit owners are `['h3','y2','g','x2']` (`:621`), each a target-less `slot` provider, so each now emits its own state with its own published `slot` binding. **Re-freeze empirically, then freeze** — the file's own instruction (`:582-590`). **Re-verify the `#f:<owner>#<i>` numbering** (`h3#0`, `y2#1`, `g#2`, `x2#3`): resolution is untouched (C4), so the numbering *should* be unchanged, but that argument is not a substitute for the re-verification. **FRS-1a** (`:610-616`) is the deep-equal that must be updated with the golden; **FRS-1c** (`:627-652`) asserts order/parity per attempt and needs its `sliceIds`-order expectation re-read (a provider state appears at its slice position, not at the arm position). `dropped: []` (`:605`) and `warnings: []` (`:606`) **stay**. |
| `demo/feature-showcase.expected.html` (**`:22`**) | regenerated, **gaining** `<app id="showcase-root">` around the flattened children | Produced by `npm run demo:build`; must **not** be hand-edited. Until it is regenerated it is a tracked artefact asserting the defect. |
| every `demo/*.html` regenerated by `npm run demo:build` | regenerated in the same pass | Includes the translate-showcase expected-output page (page 18) and any page whose root is a consumed provider. Regeneration is the deliverable; hand edits are a review finding. |

**4.2 Guards and bounds that MUST NOT move.** The change is behavioural, not budgetary;
these stay byte-identical:

- **`RUNTIME-FORK-GROWTH-GUARD`** — `scripts/demo-smoke.mjs`, d10 → d12 **pass-2 ratio,
  bound 10×** (`docs/decisions.md:18`). It is the smoke's only asserted scaling signal;
  a released provider adds **one** element per page, not a per-node cost.
- **The derived `2.5×` per-REGION pins** (`[derived-fork:pin]`) and the derived
  in-family totals pin — unchanged; FS-VPD-8's accepted re-bake churn is on the
  **runtime** side, and if it moves a *derived* pin, C1/FS-VPD-8 must be re-examined
  rather than the pin.
- **The rows census / fan-out guards** — and this is the smoke's **C2 falsifier**:
  minted rows remain **value records**, so `demo/rows-scenarios.js`'s "8 minted rows in
  the family tree + 8 consumer arms per consumer" and the `fanoutStates ≤ 2 ×
  fanoutRows` linearity pin (`demo/rows-scenarios.js:23-25`, `:328-336`) must hold
  **exactly**. If the rows census or the fan-out moves, the marker is on the wrong node
  class and the contract is violated — do **not** re-pin the census to match.
- **`warningsMain === 0`** (legacy-shape) and the K4 translate channel: structurally
  unaffected — the diagnostic is `console.warn` at the compile gate and `warningsMain`
  is `translated.warnings.length`, a different channel. A change that routes
  `value-record-drop` into the K4 channel breaks this guard.
- **The legacy-shape census fields and the clone censuses** — re-measure; if a field
  moves, the movement must be **attributable to C1** and recorded as a re-pin under
  4.1. The **derivation rules** and the `cloneOps = 0` measurement shape must not change.

**4.3 The validation trio (all three, per `AGENTS.md` item 4):**

```
npm test            # both phases (parallel unit phase + serialised smoke-ops phase)
npm run typecheck   # tsc --noEmit
npm run demo:smoke  # headless; growth guard, 2.5× pins and censuses in the output
```

plus `npm run build` emitting cleanly. Report `[runtime-fork:growth]` and the
`[derived-fork:pin]` lines in the completion report, not just the exit code.

**4.4 Red-first ordering.** The red set (§8) lands **before** any `src/**` change and
must be reported failing, with each row's failing observable. No implementation change
in the same pass (`AGENTS.md` item 8).

---

## 5. Required doc/demo rewrite list

These currently **assert the defect as behaviour**. Each is owed a rewrite in the same
pass as the implementation; the two citations marked **phantom** point at a rule that
exists **nowhere** in the specs and must be replaced with this file's clause ids.

| File | Lines | What it says now | Owed |
| --- | --- | --- | --- |
| `docs/skills/designing-pages.md` | **`:1593-1599`** (§14.10 item 1) | *"A pure provider is F3-dropped from render — 'a value holder, never an element' … never assert a provider's element."* — **the only normative author statement of the defect** | Rewrite to C1: an **authored** provider renders (assert its element and its children's nesting); only runtime-minted value records are dropped, and that drop is warned (`value-record-drop`) but not in `dropped`. |
| `docs/skills/designing-pages.md` | `:583` (hooks-scenarios matrix row) | *"the root is a PURE provider — F3-dropped from render, 'a value holder, never an element'"* | Rewrite to C1 + note the page's new root element. |
| `docs/skills/designing-pages.md` | `:916-931` (`hooks-scenarios.html` page description) | Same claim (*"is a PURE PROVIDER — F3-dropped from render"*) | Rewrite: the root now emits; the cards remain its children. |
| `docs/skills/designing-pages.md` | `:1004-1005` (rows-scenarios) | *"the F3 letter — minted rows are pure providers, 'value holders, never an element'"* | Rewrite to C2/C3: rows **are** the residual class (value records) and stay dropped — cite **`valueRecord`**, not "F3". |
| `docs/skills/designing-pages.md` | §11 coverage matrix | No row for the provenance rule | Add a row for this spec + the `VPD-*` register; note the artefact re-pin. |
| `docs/specs/node.md` | `:288` (§7.1 `in-tree` row) | *"fully actionable (the only render-eligible state)"* — **currently contradicted by the code** | After C1 this is **true again for authored nodes**; add the **residual exception** in the same cell: a runtime-minted **value record** that is slice-consumed is not actionable, and its drop is warned but absent from `dropped` (C3/C5). |
| `docs/specs/node.md` | `:109-111` / `:412` (FS-1) | Closed `ArmDropReason` union; FS-1's `dropped` requirement | **Unchanged** by this unit — but FS-1 owes an explicit "not discharged" note pointing at C5, so no future unit reads the new warn as a discharge. |
| `docs/specs/contract.md` | `:92` | Closed `ArmDropReason` union | **No change owed** — record it as pinned-unchanged (C3). |
| `demo/hooks-scenarios.js` | `:23-27` | *"The root is a PURE provider — F3-dropped from render ('a value holder, never an element', **node.md**)"* | Rewrite: the root emits under C1. **Remove the phantom `node.md` citation at `:24`** — no `node.md` clause ever said this (verified: `node.md` has no such clause; **cite C1 instead**). Re-derive the page's element-level expectations; the census (node counts) is unchanged. |
| `demo/rows-scenarios.js` | `:26-27` | *"the F3 letter: minted rows are pure providers, 'value holders, never elements'"* | Rewrite to C2/C3 (`valueRecord`, residual class, warned). |
| `demo/rows-scenarios.js` | `:329-336` | *"the compile's F3 discipline drops source-only nodes consumed by name from render (**node.ts compile** — 'a value holder, never an element')"* | Rewrite; **remove the phantom citation at `:331`** — the quoted text is a code comment, not a clause, and the rule as stated is **superseded** by C1. The check's *result* (rows are not emitted as elements) **stays true** — only the reason and the citation change. |
| `demo/translate-showcase.js` | `:396` | check **name**: `'all 9 cards render under the mount (root non-actionable per S-R2.5/F3)'` | Rename: the root **is** actionable now; the check's assertion (9 cards render) is unchanged, its **name** is a normative claim and must stop asserting the defect. |
| `demo/translate-showcase.template.html` | `:104-106` | *"NOTE: the root itself is NOT actionable (S-R2.5/F3 — … the provider serves its consumers and emits no standalone element)"* | Rewrite to C1 (the root emits one element); regenerate the expected-output HTML (4.1). |
| `demo/fork-stress.js` | `:456-459` | *"the app root is a consumed PROVIDER …, so it is not emitted — walk from the placement zone"* | Rewrite: the root emits; the nesting walk may start at the root. Re-derive the walk's start and the checked count **without moving the growth bound** (4.2). |
| `demo/fork-stress.js` | `:477-478` | `if (checked !== 2 ** depth - 1)` — *"zone + all layer nodes (root is a non-emitted provider)"* | Re-derive the expected count (the root joins the walk). A silent renumber of this literal is a review finding: state the new derivation in the comment. |
| `tests/unit/hooks.test.ts` | `:57-61` | *"a pure provider is F3-dropped from render when its name is consumed elsewhere — the self-seed read is observed through the duplex"* | Rewrite the **comment**; the fixture itself (a duplex provider) still works, and the test's assertion should now also admit the emitted element. |
| `src/core/node.ts` | `:1177-1183` | The F3/D7 comment block: *"a PURE provider (a source-only node) consumed by name is dropped from render — it is a value holder, never an element"* | Replace with the C1/C2 rule + the C3 diagnostic clause (the comment is the only in-code statement of the rule and must not survive the contract). Keep the D7 seam rationale — it is still true and A2 depends on it. |

---

## 6. Amendment log

| Row | Date | Source | Amendment |
| --- | --- | --- | --- |
| **AM-1** | 2026-11-13 | gate finding A1 | **The marker is a dedicated `valueRecord` flag set at the value-record mint sites** (`ops.ts:499-501`, beside `originLayer`/`registerMinted`, one site covering both rows-mint paths via `mintRowNode` at `:350`/`:440`; the keyed-reuse path preserves it). **`originLayer` is REJECTED as the discriminator** — it means teardown ownership (`node.ts:734-766`) and survivor promotion clears it (`:753-756`), so an `originLayer`-keyed rule would materialise a promoted raw data row as an element, the exact outcome `rowsTeardown`'s no-promotion override forbids (`:768-777`). **`runtimeMinted` is REJECTED** — `adoptDefChildren` sets it on children that **are** elements (`:1869`) and it already carries reverse (`translate.ts:1459`), serialize (`serialize.ts:123`, `:190`) and retention (`registry.ts:418-429`) semantics. **The minimal alternative `runtimeMinted && !adoptedDefChild` is recorded with its cost** (§3 C2): it needs a new discriminator, because the seam child anchor at `node.ts:1870` is currently its only trace, and it cannot separate an adopted def child from a clone (`node.ts:844`). |
| **AM-2** | 2026-11-13 | gate finding A2 | **Seam-exemption ordering is normative.** `isSeamProvider` (`node.ts:1184-1197`) is evaluated **before any provenance test** — hoisted into a local, not merely ANDed to the left of the marker read — or it is **deleted together with the whole predicate**. A minted seam host exists (adopted def children carry `runtimeMinted`) and the `[6]` root-clobber pin (`tests/e2e/legacy-shape.test.ts:357-363`) depends on the exemption (§2 C1, §3 FS-VPD-5). |
| **AM-3** | 2026-11-13 | gate finding A3 | **Honest scope.** The rule releases in-tree **family-tree** providers only. It does **not** release content-root providers (dropped earlier as `owner-terminated`, `node.ts:1136-1139`), does **not** stop children flattening under a minted parent, and supplies **no position index** — so a downstream consumer's position-based styling need stays **unmet**. All three stated in §2 C5 and pinned as FS-VPD-6. |
| **AM-4** | 2026-11-13 | gate finding A4 | **Diagnostic channel is `console.warn` ONLY** — precedent `BODYRUNS-DROP-DIAGNOSTICS` (`docs/decisions.md:38`), which rejected widening the return surface as an own-gate `X.Y.X` change; keeps this an `X.X.Y` patch per `VERSIONING-SCHEME` (`docs/decisions.md:30`). **No `ArmDropReason` member** (`types.ts:279`, closed; pinned `docs/specs/contract.md:92` + `node.md:109-111`); **no `CompileResult.warnings` code** (`types.ts:299`, closed; ~20 `res.warnings).toEqual([])` assertions). Dedup = module-level, never-cleared `(code, nodeId, name)` set (exactly C4 of `docs/specs/bodyruns-drop-diagnostics.md` §3, as recorded in `docs/decisions.md:41`), `shouldWarn(node)` (`node.ts:1048-1049`) reused to keep pass-2 quiet, and **R-W4-5 inherited verbatim** (process-level, never per-document; a second document can be silently denied; the set is unbounded; an absent line never means "nothing was dropped"). **Visibility limit recorded:** `demo/fork-stress.js:239` silences `console.warn` for its bootstrap render window, so the diagnostic is not visible there (§3 C3). |
| **AM-5** | 2026-11-13 | gate finding A5 | **The diagnostic's subject is the RESIDUAL class.** Under C1 the authored-provider drop ceases to exist; what remains silent is the runtime-minted value-record drop, and the diagnostic covers that one. **FS-1's `dropped`-completeness half (`docs/specs/node.md:412`) is NOT discharged by this unit** and is a separate `X.Y.X` decision (§2 C3/C5). |
| **AM-6** | 2026-11-13 | gate finding A6 | **Implementation site = the `compile()` emit gate only. Never translate time; never graph mutation.** The drop is emit-gate-only today, which is why `reverseTranslate`/`serializeNode` output is unaffected (reverse exclusions key on `originLayer`/`runtimeMinted`, `translate.ts:1447-1466`). Written as a **hard constraint with its rationale**: a graph-level fix would change reversed envelopes and break `demo/translate-showcase`'s reverse checks and `tests/unit/reverse.test.ts:180` (§2 C4). |
| **AM-7** | 2026-11-13 | gate finding A7 | **Re-pin obligations are contract-mandated, not optional cleanups:** `tests/unit/render.test.ts:529-541` (FRK-H1, `actionable` 1 → 2), `tests/unit/pass2-fit-reference-scope.test.ts:591-607` (FROZEN_GOLDEN gains 4 `slot` provider states — re-freeze and re-verify the `#f:` numbering, with FRS-1a/1c at `:610-652`), and the generated demo artefacts (`demo/feature-showcase.expected.html` + every `demo/*.html` produced by `npm run demo:build`) (§4.1). |
| **AM-8** | 2026-11-13 | gate finding A8 | **Four hazards named and handled.** **(i) `dirtied` widening — ACCEPTED as correct-and-observable:** `focusedSliceFor` seeds the ancestor chain (`supervisor.ts:53`) and `dispatchAndReport` folds every `takePass2States()` key into `dirtied` (`:505-512`), so a now-actionable ancestor provider appears in every descendant dispatch; this is correct behaviour, and the **exact-set** assertions must be re-read and re-pinned explicitly (never loosened to a subset/`toContain`): `tests/integration/supervisor.test.ts:167`, `:258`, `tests/e2e/path-fork-e2e.test.ts:303`, `:384`, `:414`, `:536`, `tests/unit/keyed-batch-reuse.test.ts:373`, `tests/blind/ops-layer.test.ts:152`. **(ii) Object-valued derived re-bake churn — ACCEPTED, not guarded:** `applyDerivedBake` runs per state (`node.ts:1258`, `:1301`) and `diffMinimal` compares with `!==` (`render.ts:86`), so a fresh object/array bake emits a `set` per flush; guarding it needs a new compare path or bake cache (a separate contract) and the canon is never mutated, so it is accepted **conditional on the 2.5× derived pins holding** (§3 FS-VPD-8, §4.2). **(iii) A provider's own phase handlers become dispatchable for the first time** (`supervisor.ts:707-738` — `runPhaseOnNode('after-compile')` at `:708`, `after-render` at `:737`), where journals are counted exactly (`tests/e2e/component-handler.test.ts:143`, `:167`): such a node can now be pass-2 dirty, so its phase handlers run; the journal-count assertions must be re-derived with the new entry attributable to that handler, never relaxed. **(iv) The mixed provider+consumer node keeps emitting per arm** (`node.ts:1262`, `:1283-1293`) and **must NOT be given a second standalone state** (§2 C1/C4, §3 FS-VPD-7). |
| **AM-9** | 2026-11-13 | implementation deviation, recorded by the supervisor at landing | **The marker is declared WITHOUT an initializer, so an authored/seeded node reads `undefined`, not `false`.** C2 says "default `false`"; the landed field is `valueRecord: boolean \| undefined` (`src/core/node.ts`, beside `runtimeMinted`) with **no** `= false`. **Semantics are identical** — the gate reads `node.valueRecord === true`, so `undefined` and `false` are indistinguishable at the predicate — and the absence is *preferable* for VPD-11: an own `false` property cannot be told apart from a forged one on a `loadState`-seeded node, whereas absence is exactly "this node was not minted by the value-record site" (and `parseNodeState`'s whitelist cannot produce it). The red set asserts `toBeUndefined()`; a later unit that wants a literal `false` default must re-point VPD-11 and say why. **No other deviation from C1–C5 was found** in the landing review (`git diff src/core/node.ts src/core/ops.ts` read against §2 clause by clause: seam exemption hoisted and evaluated first, marker last, warn gated by `shouldWarn` BEFORE the dedup signature is consumed, the target-less branch body untouched, `mintRowNode` the only set site, `clone()` copies, promotion does not clear). |

---

## 7. Residuals and parked items

- **R-VPD-1 — the seam's name-keyed def-root resolution is order-dependent (NOT fixed
  here).** The seam resolves a def root **by name**, so the emitted classes can
  contradict the compiled bindings, and the outcome depends on resolution order —
  **measured**, filed as its own defect. C2's provenance rule does not touch resolution
  (C4), so this residual is untouched by the disposition change and must not be cited as
  closed by it.
- **R-VPD-2 — the general ghost-`childOrder` mechanism (NOT fixed here).** The parent's
  `childOrder` is built unconditionally from the compiled state's children
  (`render-helpers.ts:325`, `[...(cs.children ?? [])]`; the order signature filters by
  `present`, `render.ts:99-105`) so **any** drop class can leave a `childOrder` entry for
  a wire with no element. C1 removes the mechanism for **one** class (authored
  providers). The general mechanism stays for every other drop class and for the
  residual value records.
- **R-VPD-3 — slice-dependence survives for every residual class.** `hasAnyTarget` and
  `consumedNames` are slice-global (§1.2), and `focusedSliceFor` composes slices from the
  ancestor chain, the descendant closure and the provider universe
  (`supervisor.ts:51-89`). After C1 the slice-dependence is confined to the value-record
  class, but it is **not** eliminated: the same value record can still be dropped in one
  compile and emitted in another. Fixing it is a slice-composition contract, not this
  unit's.
- **R-W4-5 (inherited, verbatim).** The dedup set is process-level, never per-document;
  a second document in one process can be silently denied a diagnostic; the set is
  unbounded; an absent line must never be read as "nothing was dropped". Changing the
  mechanism is its own gate (§3 C3; `docs/specs/bodyruns-drop-diagnostics.md` §9.6b,
  `docs/decisions.md:41`). Parked as the same pending item, now covering two diagnostic
  families.
- **R-VPD-4 — FS-1 `dropped`-completeness debt (parked).** The residual value-record drop
  still leaves no `dropped` entry, so `docs/specs/node.md:412` remains unsatisfied for
  this class. Closing it requires either a new `ArmDropReason` member (a closed-union
  change) or a redefinition of FS-1 — a separate `X.Y.X` decision (§2 C5, AM-5).
- **R-VPD-5 — diagnostic invisibility window.** `demo/fork-stress.js:239` silences
  `console.warn` for the page's bootstrap render, so `value-record-drop` is unobservable
  there. Recorded, not worked around; no demo edit and no warn-count assertion may cross
  that window (§3 C3).
- **Parked (no action this unit):** the position-index need (C5 exclusion 3) has **no**
  gate record and must not be designed here; the two REJECTED marker overloads
  (`originLayer`, `runtimeMinted`) and the minimal alternative
  (`runtimeMinted && !adoptedDefChild`) stay on record in §3 C2 so a later unit cannot
  re-open them by accident.

---

## 8. Register

The red set the next unit must implement — **one row per fail-state in §3**, written
red-first (`AGENTS.md` item 8), `src/**` untouched in the red pass. Every row states the
input shape → the expected observable; none requires implementation reading. Rows
`VPD-11`/`VPD-12` are the two contract rows (C2 non-forgeability, C3 dedup/gating) that
have no separate fail-state.

| Row | §3 | Input shape | Expected observable |
| --- | --- | --- | --- |
| **VPD-1** | FS-VPD-1 | Authored provider with children; a descendant consumes the name | Provider has **one** actionable state at its own `pathKey` with its published `bindings`; an element exists for its wire; its children are that element's children **in order**; the parent's `childOrder` entry resolves to a real wire; **zero** `value-record-drop` warns |
| **VPD-2** | FS-VPD-2 | Authored leaf provider (no children), name consumed | **One** actionable state; **one** childless element; **zero** warns (disposition is provenance-based, not child-count-based) |
| **VPD-3** | FS-VPD-3 | Minted value record (rows-mint), field consumed in the slice | **No** actionable state, **no** element for the row, **no** `dropped` entry; **exactly one** `console.warn` containing `value-record-drop` + the row's `pathKey` + the consumed name; a **second identical compile in the same process warns zero more times** |
| **VPD-4** | FS-VPD-4 | Value record promoted by a move; `originLayer` cleared by the promotion branch | Still **no** actionable state and **no** element (the marker survives promotion); reverse output shows the promoted row as authored content (existing `originLayer` semantics, unchanged) |
| **VPD-5** | FS-VPD-5 | Adopted def child (seam host) with `runtimeMinted` set and a seam child anchor | **Emits**, identically to the `[6]` pin: def children only inside the seam-referencing wrapper, root element present with its `type`, no def-prototype wire emitted; **zero** warns |
| **VPD-6** | FS-VPD-6 | Content-root provider | Dropped with `reason: 'owner-terminated'` **in `dropped`** (the earlier gate); **no** actionable state; **no** `value-record-drop` warn (the diagnostic cannot fire for a node that never reached the emit gate) |
| **VPD-7** | FS-VPD-7 | Mixed provider + consumer node (targets on A, provides B, self-applies B) | States for that node == its **arm count** (own `bindings` + `forkKey` per arm, own values seeded per arm); **no** standalone provider state; count equal to the pre-change count |
| **VPD-8** | FS-VPD-8 | Array-valued provider binding, name consumed | **Emits** with the array value published as-is; two flushes over an object-valued derived bake produce **one `set` per flush** (the accepted churn, asserted as the documented shape — not as a bug); the derived 2.5× pins hold (§4.2) |
| **VPD-9** | FS-VPD-9 | Target-free slice (no string `target` anchor anywhere) | Provider **emits**; **zero** warns — the `hasAnyTarget` control |
| **VPD-10** | FS-VPD-10 | Minted value record whose field names are consumed by **nobody** in the slice | **Emits** and **zero** warns — the marker alone is insufficient; consumption by name is required |
| **VPD-11** | C2 (no fail-state) | A serialized document crafted to carry `valueRecord` / `originLayer` / `runtimeMinted` on a seeded node, then `loadState` | The key is **not admitted** (`parseNodeState` whitelist): the seeded node renders as **authored** (emits, no warn). Asserts non-forgeability across `serializeNode` → `parseNodeState` → `loadState` |
| **VPD-12** | C3 (no fail-state) | The same residual drop compiled twice under `focusNodeId` (a) equal to the record's id and (b) pointing at a descendant | (a) **one** warn; (b) **zero** warns — the `shouldWarn(node)` focus gate keeps pass-2 quiet; and the code `value-record-drop` appears in **neither** `CompileResult.warnings` nor `dropped` in any case |

---

*End of contract. Nothing here is implemented; §8 is the red set owed, §5 is the rewrite
set owed, and the three tracker rows named in the header do not yet exist.*