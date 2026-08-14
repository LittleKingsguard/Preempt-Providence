# Placement-Path Spec — legacy-faithful static placement/path model ("static P3") — FINAL

Status: **FINAL — approved design; implementation COMPLETE (units 0–12
shipped; Unit 13 = the final docs sweep).**
This is the deep core-spec revision for the legacy-faithful placement/path
model, driven by a confirmed legacy-fidelity audit. It encodes the four fixed
user requirements (E2E-1…E2E-4, §0) as behaviors and lists every surface
change (§6) with file:line anchors. The underlying proposal passed the
three-agent review gate (step-3 change-analysis verdict:
`path-fork-review.md` round-2 — "coherent, addressing-correct, DOMINATED —
but static P3 is a FEATURE worth specing separately", R2.8 ¶3; this document
is that separate spec), five user review rounds (§9, §10.x–§10.af), and the
final review returned **PROCEED-TO-IMPLEMENT** (§10.af.2) with no surviving
open design question. §1–§5 are the approved contract; §6 is the change
inventory the implementing units applied (the 126-row actionable set,
§10.af.3 — shipped across units 0–12 per the §10.af.3 plan); §8 is the
resolution ledger; §9 and §10.x–§10.af are the decision
record. Unit 0 (the core rewrite, applying F-1…F-13 of §10.af.1) was the
mandatory first deliverable of the implementation pass; the landed state is
verified by `tests/e2e/path-fork-e2e.test.ts` (E2E-1…4) and the static page
census (demo/path-fork-data.*, 23/4095/0/0).

Provenance:

- Proposal review record: `docs/specs/path-fork-review.md` — round-1 REJECT
  (§2.1–§2.5), round-2 refinement re-review (R2.2–R2.8; the four corrections
  close the round-1 blockers; the arithmetic bijection (prototype, path) →
  4095 states is recorded at R2.2).
- Legacy fidelity audit (confirmed): legacy placement is
  **path-multiplicative** — content nodes carry `targetPlacement: string[]`
  and route into every drop-zone sharing a matched name; one source clones
  into N zones (`Preempt/src/core/workers/PlacementWorker.ts:29-37`,
  `Preempt/src/core/Placement.ts:96-105`). The rebuild documents P3
  multiplicity (`docs/specs/api.md` §5, rule P3, line 267) but implements
  NO placement fork (compile forks only on component `target` anchors,
  `src/core/node.ts:660-663`; `src/core/resolve.ts` has zero placement
  references), drops `targetPlacement` at the boundary (translate.md §2
  "unknown fields … ignored"; TR-F2; NP13 — `src/core/translate.ts:440-444`,
  mis-typed as `string` vs legacy `string[]` —
  `Preempt/src/types/NodeSchema.ts:22`; `src/core/translate.ts:51`), and
  substitutes clone-instance + after-compile recursion for static
  multiplicity (the fork-stress-data assembly, `docs/specs/fork-stress-data.md`
  §Purpose; `src/core/supervisor.ts:388-411`).
- The fork-stress tree is expressible statically: ~22 prototypes with
  placement links (each level's prototypes targeted by both parents' zone
  names) → 2^12−1 path-keyed compiled states, one per valid (prototype,
  owner-path) pair back to root (path-fork-review.md R2.2), NO nodes created
  beyond the prototypes.

Companions: `docs/specs/state-first-analysis.md` (§2.2.2 impossibility,
§4 census — the model is NOT state-first; §7 Unchanged), `docs/specs/api.md`
§4/§5, `docs/specs/node.md`, `docs/specs/pipeline.md`, `docs/specs/render.md`,
`docs/specs/derived-state.md`, `docs/specs/ops.md`, `docs/specs/translate.md`,
`docs/test-findings.md` ("Stress-test review loop #1" — DEFECT #1).

---

## 0. Fixed user requirements (E2E constraints — NOT subject to review)

These are binding; the spec encodes them as behaviors, and every §6 test
surface derives from them.

| ID | Constraint | Encoded in |
| --- | --- | --- |
| E2E-1 | The fork test has ONLY the 22 prototype nodes (+ root). Generating the HTML elements, the compiled states, and the passes that produce the render-adapter data must NOT require creating new nodes. | §2 (path enumeration over the 23-node graph), §5 (page re-expression), §6 T (static fork census) |
| E2E-2 | Updating a NON-component/placement/parent-child property (props/text/css) on a node at shallow depth must NOT cause recalculation of any other nodes — only that node's compiled state regenerates and its rendered element is reused. | §3.1 (node-local invalidation), §4.1 (element reuse by stable wires) |
| E2E-3 | Updating a component recalculates ONLY the specific descendants that consume it (current test: all descendants consume it, as a pressure test; a component affecting only half the max-depth nodes may be added to test precision). | §3.2 (per-name component-Link affected set) |
| E2E-4 | Adding a new node as a placement AFTER render must not cause full-tree updates (e.g. add a third depth-4 node with no children/placement after render; must not require depth>4 recalculations; ideally only the immediate parent and the added node recalculate). | §3.3 (placement-add affected set), §6 T (incremental cases) |

---

## 1. The placement model (core behavior)

### 1.1 Two-sided role on the shared per-name placement Link

Placement is expressed on the SAME shared per-name `Link` as today, with a
**second role** completing the polarity that the audit proves missing:

| Side | Legacy field | Role on the per-name placement Link | Meaning |
| --- | --- | --- | --- |
| Producer / owner (drop-zone) | `placementName: string` | `'container'` (RENAMED from `'placement'`; anchor `target` = the name) | this node OFFERS the drop-zone `name`; zones sharing a name share one Link (TR-2) |
| Consumer / user (content request) | `targetPlacement: string[]` — minted per name, ordered | `'content'` (role; one anchor per requested name, in preference order) | this node REQUESTS routing into every zone named in the array |

Concretely:

- `Role` union gains `'content'` and the legacy `'placement'` member is
  renamed `'container'`
  (`src/core/types.ts:8`; spec mirror `docs/specs/contract.md:39`).
- `DEFAULT_PLACEMENT.roles` becomes `['container', 'content']`
  (`src/core/link.ts:23-26`); the hub default-config link
  (`src/core/link.ts:28-32` `baseFor`, and the default-hub `linkFor`
  `src/core/translate.ts:133-146`) keeps one shared `placement`-named Link
  per name, now admitting both roles.
- The `content` anchors minted from `targetPlacement` stay **ordered per
  node**: minting preserves the array order (the per-node anchor set is an
  insertion-ordered `Anchor[]`, `node.ts:113`), so first-match-with-known-
  container is determinable from the node's own ordered list + the per-name
  Link membership (§1.2, §2.2; the serialize round-trip keeps the order —
  §6.2 serialize row).
- `LinkConfig` enforcement is unchanged: a `'container'`-role anchor still
  never satisfies a component `target` borrow and vice versa (api.md §5 P1,
  line 265); `role-mismatch` still rejects cross-role writes
  (`src/core/link.ts:79-85`). The two placement roles are
  `placement`-role-semantics — never interchangeable with component roles
  (api.md §5, lines 256-258).
- SI-1…SI-5 are untouched: `'container'`/`'content'` anchors are
  peripheral edges exactly like `'placement'` was
  (`docs/specs/node.md` §1.2 SI-3, line 44). A `content` anchor is
  NOT a `'child'` anchor — the family single-parent invariant is not
  involved (the round-1 "one child anchor" blocker,
  `src/core/node.ts:416-419`, does not apply to this role).
- Wording convention (decided): role tokens are always quoted and
  backticked (`'content'` role) and are distinct from the `content` node
  field, the `content[]` envelope array, the `'contentNodes'` permanent-
  owner token, and the legacy `content` target path (§10.5; designing-pages
  §1 glossary convention).

### 1.2 Multiplicity semantics (legacy-faithful, preference-ordered)

A user node's `content` anchors are a **preference-ordered request list**
(`targetPlacement: string[]`, minted in array order — §1.1). Semantics
(legacy basis: `PlacementWorker.ts:29-37` +
`TargetPlacementResolverWorker.ts:28-35`; Q5 resolved — §8 ledger):

- **First-match-with-known-container wins**: the compile walks the array in
  order and stops at the MOST PREFERRED name that has at least one known
  container (a `container` anchor on the per-name Link with a path to
  root). Names before it that have NO container are skipped (not fatal);
  names after the chosen one are NEVER consulted. A whole-array miss (no
  name has any container) ⇒ nothing forks — the node's request is simply
  unsatisfied.
- **Every zone of the chosen name gets an instance**: if
  `SubmitButtonContainer` is a placement in a top pane, a bottom pane, a
  file menu, and a details modal, a matching button produces FOUR elements
  (legacy fan-out — `Placement.placeInto` per zone, `Placement.ts:96-105`).
  The legacy nuance that one placement RECORD only ever USES the first
  matched target name (the `break` in `PlacementWorker.ts:35-37` — that is
  why legacy separated source detection from population, so population
  could not run until all placement names were known) is preserved: the
  array is a preference list, and the four zones are all under the SINGLE
  chosen name.
- **Silent abort on irrelevant updates**: because the preference
  resolution is per-node, the compile can stop at the most preferred link
  with a known source. If a node receives an update alert and finds that
  the reason is a LESS favored placement (a container appeared/disappeared
  at a position that does not change the chosen name) and therefore
  results in no change, the compile aborts silently. Mechanism (C-2
  resolved): the update **trigger identity** — which placement link
  changed, `{ kind: 'placement', linkName, direction: 'container-added' |
  … }` — is passed INTO the compiler with the dirty mark
  (`supervisor.apply`, §3.3), and the compiler runs a **relevance
  pre-check** per affected node before any state regeneration: "can the
  changed link alter this node's first-match choice?" If not, the compile
  aborts — no state regeneration, no events.
- Multi-owner zone names (the fork-stress topology — two owners of one
  name) multiply the fork: each zone (container anchor) is a separate path
  hop, so a user under two owners of one name gets one state per
  owner-path (path-fork-review.md R2.2's "(prototype, path) keying").
- `activePlacement` — the legacy resolution record
  (`Preempt/src/types/NodeSchema.ts:24`) — is **derived**: the FIRST link
  in the `targetPlacement` array that has any containers. Never authored
  (§2.5).

### 1.3 Ancestor-name veto (legacy loop safeguard)

Legacy nulls out a `placementName` when an ancestor already offers the same
name — the anti-loop guard (`Preempt/src/core/Placement.ts:44-57`). The
rebuild carries the guard as a **translate-time veto**:

- When translating a producer (`placementName`) whose ancestor chain
  already carries a `'container'` anchor with the same name, the anchor is
  NOT minted and a K4 warning (`placement-name-vetoed`, new code) fires —
  warn+skip, never a throw (TR-F2; `src/core/translate.ts:169-173` warn
  channel).
- Runtime minting (a `placement-attach` op, §3.3) applies the same veto
  against the attach target's ancestor chain before committing the op.
- **Name validation (`#`-freedom)**: placement names are minted verbatim
  into anchor targets (`translate.ts:435-438`) and authored ids pass
  through unvalidated (`node.ts:143`). Under the path model the pathKey is
  the wire and the arm-suffix machinery is gone (§2.2), but a `#` in a
  name or id would still forge key-grammar segments; a K4 warn
  `placement-name-invalid` fires at the minting site when a
  `placementName`/`targetPlacement` name contains `#` (translate, the K4
  `warn` channel at `translate.ts:168-173`), and a `#`-check for authored
  ids rides the same site (`node.ts:143` or `baseFrom`). Warn+skip, never
  a throw (C-5/R2-Q2 resolved).

### 1.4 Placement-path cycle guard

Placement links participate in NO cycle guard today (chain classification
walks family anchors only, `src/core/node.ts:512-562`; `findCycle`
`node.ts:861-871`; the round-1 blocker, path-fork-review.md §2.5 "Loop
safety"). The path enumeration (§2) carries a **per-walk visit set**:

- During enumeration, every hop (placement edge or family edge) records the
  owner node in a per-walk `seen` set; revisiting a node on the SAME walk is
  a placement cycle → that path arm drops with reason `'loop'` + a
  `circular-source` diagnostic (`src/core/node.ts:571-575` warn shape;
  api.md §7 `diagnostic` events, line 312).
- The visit set is per-walk (never shared across walks), mirroring
  `chainRoot`'s per-walk `seen` (`node.ts:69-85`) and resolve's per-arm
  `path` set (`resolve.ts:179-198`).
- The ancestor-name veto (§1.3) is the translate-time half; the visit set is
  the compile-time half; op-time attach/move keep their `findCycle`
  test-and-rollback (S3.4, `node.ts:861-871`) — which is extended to walk
  placement edges as well as family edges (§6 CODE node.ts).

---

## 2. The path-multiplicative compile (core behavior)

### 2.1 A new compile mode: placement-path enumeration

Alongside the existing per-node focused compile (pipeline.md §3, line 139
"Two scopes"; `supervisor.ts:246-258`) and the root-out deep compile, the
compile gains a third mode — **path enumeration**:

```
compilePath(node /* a content node or the root */):
  enumerate(node):  per-walk visit set (§1.4); walk BOTH edge kinds toward root:
    - placement edges:  node's 'content' anchors → the per-name
                        placement Link → each 'container'-role producer anchor
                        → its owner node (one branch per zone)
    - family edges:     node's 'child' anchor → family Link → 'parent' anchor
                        → owner node (single branch; the SI-1 single parent)
  termination: reach 'rootNode' ⇒ viable path; 'component' token /
    'contentNodes' token / no edge ⇒ non-viable — the TOKENS terminate the
    walk (no path past them); a token-terminated walk is not compiled even
    though the node may carry the family 'in-tree' label (§2.4);
    revisit ⇒ loop (§1.4)
  one state per (node, path-to-root); the enumeration KNOWS the parent, so
  path-derived children attach at mint time (§2.3)
```

- The per-name placement Link IS the zone registry, exactly as the per-name
  component Link is the provider registry (`resolve.ts:96-120` — anchors
  carry their `owner` backref, `src/core/types.ts:69-73`): enumeration reads
  producers straight off the Link, never sweeping the graph. Hub-less trees
  fall back to the status-quo slice scan (same rule as today,
  `supervisor.ts:59-77`).
- This is a third mode, not a replacement: the per-node focused compile
  (bounded O(depth) incremental, render.md §4) and root-out deep stay for
  the non-placement world. §6 surfaces the supervisor slice/compile-mode
  switch (`supervisor.ts:246-258` gains the branch).

### 2.2 Per-path keys — pathKey is the state identity, unconditionally

- A path-state's identity IS its path: `pathKey =
  'root/<zone>/<ownerId>/…/<nodeId>'` — the family path back to root
  interleaved with the zone names that routed each hop, terminating at the
  node's own id. Sibling prototypes sharing a parent set produce DISTINCT
  keys at their final segment (the prototype id), which is the R2.2
  (prototype, path) keying in key form.
- The pathKey is the **wire**: elements key on it; `forkKey` on compiled
  states and ops = the state's pathKey (extended semantics of api.md §4.2
  F2, line 289 — forkKey stays "path back to root" but now names placement
  paths too). `CompiledState.forkKey` (`src/core/types.ts:132`) is present
  on EVERY path-state and is set unconditionally (node.ts:699-706:
  `cs.forkKey = cs.pathKey`, not only when `arm.keys.length > 0`).
- **State identity is pathKey ALONE, unconditionally** — there is no `#<i>`
  arm suffix anywhere in the path model (F-2; §10.ab). Component resolution
  is bound to the ancestor path, and the walk own→descendants→ancestors is
  a pure function of the tree (`resolve.ts:140-160`): two states with
  IDENTICAL ancestor trees resolve identically, so a positional arm
  discriminator adds nothing (R2-Q4 verified). The only case that ever
  produced arms — multiple same-name source anchors on ONE node — is an
  unsupported anti-pattern in BOTH legacy and current: K8 blocks it for
  legacy data at translate, and the runtime `addAnchor` path enforces an
  UNCONDITIONAL `component-source-duplicate` warn (keep-first,
  skip-second; §6.2 node.ts row). With the forks
  gone, identity = pathKey alone. The remaining legitimate multiplicity is
  multiple provider NODES, which resolves deterministically per path — no
  arms, no suffixes.
- `pathKey` construction extends `node.ts:300-316` (`pathKeyFrom` — family
  walk today) to placement edges; placement hops emit pathKey segments,
  NEVER `#f:`-style keys (C-3 constraint — §10.z/§10.ac). Derived `pathKey`
  reads (`derived.ts:32` BARE_ROOTS, `:163-191`) keep working because the
  state carries the key.

### 2.3 Path-derived children (the derived `children.length` contract)

- A path-state's `children` are its **descendant path-states** — the level-k
  state's children are the level-(k+1) states whose owner-path extends its
  path by one level. `CompiledState.children` (`src/core/types.ts:129`) is
  therefore PATH-derived, not family-derived, for path-states.
- Attach-at-mint-time: the enumeration knows the parent (it reached the
  child THROUGH the parent), so children attach to the parent state's
  `childOrder` at mint time — free, no second pass (the R2.7 resolution:
  "attached during the top-down enumeration, where the parent is already
  known and attaching is free", path-fork-review.md R2.7). This is the
  **chosen** option (over a new tree-assembly pass in emitElements) —
  justification: no second enumeration, no re-derivation, and the
  `children.length` derived contract (`docs/specs/derived-state.md` §9.2 —
  `stress:expanded` = `{ $gt: [{$:'children.length'}, 0] }`) reads the
  compiled state directly, which is exactly its input contract
  (`derived.ts:176-177`).
- The derived `placement` path root (`derived.ts:172-175` — reads the
  node's FIRST `placement` anchor) becomes per-path: a path-state's
  `placement` root reads the ZONE NAME of the state's final placement hop,
  not `anchors.find(role==='container')`.

### 2.4 Viability rule (supersedes S1.1 for placement-routed nodes)

- **A placement path to root ⇒ viable** — supersedes S1.1
  (api.md §1.2, lines 93-103) for placement-routed nodes: a content/
  prototype node carrying `content` anchors whose enumerated path
  terminates at `'rootNode'` compiles actionable states, exactly as the
  S1.1 carve-out already does for self-providing unplaced nodes
  (RENDER_PROCESS_NOTES.md §10.10.4; `src/core/node.ts:589-603` — the
  `selfProviding` branch grows a `placementRouted` sibling branch).
- **Unplaced definition**: `unplaced` = **no valid path to root via parent
  OR placement links**. A node with a valid placement path that can be
  followed to root is NOT unplaced by definition (R2-Q1 option (b)
  accepted — §10.aa). This is a **compile predicate**: the state machine is
  untouched — `node.state`/`stateFrom` stays family-derived
  (`node.ts:200-224`), and compiled viability is the operative property
  for compile/render gating.
- **In-tree is a family fact, not compiled viability**: nodes owned by the
  `'contentNodes'` permanent owner are labeled `'in-tree'` regardless of
  placement (node.ts:213), and a `'contentNodes'`-token walk is
  non-viable — the token terminates the path (§2.1). A node can be
  family-'in-tree' AND path-viable (placement-routed), or
  family-'in-tree' with no placement path (see the anti-pattern). The two
  notions are never conflated.
- **Anti-pattern (documented, not guarded)**: a contentNode gaining root
  visibility WITHOUT a placement — family-attached via unconventional
  handler logic. It is not a plausible state given how components operate
  (C-7 resolved — §10.aa); documented, never aggressively guarded
  (component-attached content-root children are de-facto dropped by the
  owner-terminated disposition anyway, node.ts:581-584).
- The state's `CompiledState.state` stays honest: the NODE's derived state
  is untouched; viability is a property of the PATH (§10.10.4 precedent:
  "the label stays honest").
- Arm disposition stays the three-reason shape (node.md §2
  `ArmDropReason`): prototype/owner/token-terminated paths drop silently;
  loop-terminated paths drop + `circular-source`.

### 2.5 `activePlacement` (derived, never authored)

`activePlacement` is the legacy resolution record
(`Preempt/src/types/NodeSchema.ts:24`). In the rebuild it is a
**derived, compile-side read**: the FIRST link in the `targetPlacement`
array that has any containers (per-path: for a path-state, the chosen
name — the zone name of the state's final placement hop). It is never a
stored field and never authored — it must not join the layer/state-slice
canon (api.md §3.3: placement writes are hard-blocked, lines 162-168).
`nodeToLegacy` emits the derived read on reverse emission as
`activePlacement: string` (the legacy type is `string`, §6.2 translate
row).

---

## 3. The incremental model (core behavior — encodes E2E-2/3/4)

The affected-set derivation rule: **every dirty set is graph-topology-derived
from the op's target — never state-enumerated.** Ops stay node-scoped and
journaled (Pillar B, §7); the set of path-states that REGENERATE is derived
from the graph, so the incremental contract stays bounded (O(depth), not
O(half-document) — the round-1 blocker 2.5 resolution, path-fork-review.md
R2.3).

### 3.1 Node-local invalidation (E2E-2)

- A state-slice mutating `props`/`text`/`css`/`content` (any
  non-component, non-placement, non-parent-child targetProp; the
  `LayerMutation.targetProp` union, `src/core/types.ts:95-100`) on a node X
  regenerates **only X's path-states**.
- Justification (code-verified): `makeCs` reads only the node's own pass-1
  surface (`src/core/node.ts:623-638`); derived path reads are own-state
  whitelisted (`derived.ts:163-191`); a descendant path-state's content is
  a function of ITS node's pass-1 surface, never of an ancestor's props.
  Hence no other node — and no other path-state — changes.
- The rendered element is **reused**: wires are pathKey-stable (§2.2), so
  `diffMinimal`'s prevMap (render.ts:50-90) emits set-only ops for that
  wire (D4, render.md §3.2 line 94). E2E-2 asserts BOTH: no other node
  compiles (compile-scope assertion, session-defect-review B-3 rule) AND
  the element object survives (wire-identity assertion).
- **Apply-gate prerequisite (resolved)**: the fixture node is a
  contentNodes-owned content root — family-'in-tree' (node.ts:213) once
  the translate-global contentNodes-ownership minting lands (§6.2
  translate row) — so the state-slice apply gate
  (`supervisor.ts:332-335`, `nodeState !== 'in-tree'` → `no-usable-state`)
  passes without re-keying; the gate itself is unchanged (10.ac.2 #1).

### 3.2 Component changes — consumers only (E2E-3)

- A state-slice/structural change to a component SOURCE node invalidates
  **only the specific descendants that consume it**: the affected set =
  the per-name component Link's `anchorsOf('target')` owners
  (`src/core/link.ts:51-53`) reachable from the change — resolved through
  the graph, never by enumerating states. (Today the dirty-marking is the
  family walk `markRemote`, `node.ts:809-813`; the component-affected set
  comes from the Link.)
- E2E-3's current pressure test has ALL descendants consuming the changed
  component; the "half the max-depth nodes" precision case is a permitted
  additional fixture (§6 T) asserting the OTHER half re-renders with zero
  compile passes.

### 3.3 Placement additions/removals (E2E-4)

- A post-render placement addition (a new node placed into an existing
  zone) invalidates: **the immediate parent** (its path-states' childOrder
  changes) **+ the added node** (its new path-states). Nothing deeper —
  the added node has no children/placement (E2E-4's fixture), and no
  ancestor path-state's content depends on a descendant's props (§3.1
  argument). E2E-4: a third depth-4 node added after render must NOT
  require any depth>4 recalculation; asserted by compile-scope log.
- A placement REMOVAL invalidates the same set (+ the removed node's
  path-states die — their wires leave `diffMinimal`'s next set → `remove`
  ops, D2).
- A MOVE (re-zone) invalidates: the immediate parent + the moved node +
  the moved subtree's path-states (their pathKeys change → wires change →
  re-create). **Relocation is an accepted drain** (Q7 resolved — §8
  ledger): anything that changes an existing node's path re-compiles
  downstream (subtree re-key ⇒ element re-create); documented as a known
  performance cost, optimizable later. The incremental guarantees apply to
  non-placement mutations (E2E-2/3) and to additions (E2E-4).
- The mutation surface is the **`placement-attach` op** (DECIDED — §9 Q2;
  F-4): a dedicated structural op kind that registers the node if new,
  mints its `content` anchor(s), mints/ensures the `container` anchor on
  the target container node, and marks pass-2 dirty ONLY the container
  node + the added node (E2E-4's ideal affected set). Node-scoped,
  journaled, replayable; `attach` stays family-only; `state-slice`
  placement writes stay hard-blocked (`supervisor.ts:327-331`,
  `ops.ts:21-27`; api.md §3.3 lines 162-175; node.md FS-10). Minting runs
  under the §1.3 veto; the DECLARED-but-unused `AttachOp.zone`
  (`src/core/types.ts:88`) is superseded by the dedicated kind
  (10.ac.2 #7).
- **Trigger identity (silent-abort carrier)**: placement-affecting ops
  pass the update trigger `{ kind: 'placement', linkName, direction:
  'container-added' | … }` through `supervisor.apply` into the dirty-mark;
  `runPass2AndFlush` runs the relevance pre-check BEFORE `node.compile`
  (§1.2 silent abort). The client op-spread (`client.ts:28-53`) carries
  the trigger fields through untouched (verified in the ref-resolution
  loop, :39-49).

---

## 4. The render contract (core behavior)

### 4.1 Renderer consumes states; element reuse by stable path-based wires

- `emitElements`/`minimalFromState`/`diffMinimal` keep their shapes
  (render-helpers.ts:28-39, render.ts:50-90); the change is the WIRE KEY:
  path-state wires are their pathKeys (§2.2) — there is no positional arm
  convention left to fall back to (identity = pathKey alone).
  Because pathKeys are stable across renders as long as the placement
  topology is unchanged, element reuse falls out of the existing
  prevMap diff — steady-state renders are set-only (D4), and the D9/ORD-H6
  focus-safety rules (no re-append on unchanged order) are untouched.
- `minimalFromState`'s existing forkKey forwarding
  (render-helpers.ts:36-38) becomes the canonical path (see 4.3).

### 4.2 Per-path append ops with path-derived owners (chosen: parent-attached children)

- `append` ops are emitted by the parent path-state's `childOrder` — which
  is path-derived and attached at mint time (§2.3). No new tree-assembly
  step in `emitElements`; `emitOne`'s `childOrder` copy
  (render-helpers.ts:347) and `minimalFromState`'s `childOrder` slice
  (render-helpers.ts:36) read the state as-is.
- **IMPL-DECISION (Unit 7, shipped): the per-path child conversion.** The
  minted `cs.children` are the child NODES' ids (§2.3); the emitted
  `childOrder` must reference the CHILD STATES' pathKey wires. The
  conversion happens in `emitElements` — the only place with the full
  actionable set — via a trace-indexed map: `mintPathState` sets
  `trace = [...hop owners root-down, nodeId]`, so the child state that
  extends a parent path-state's path is exactly the state whose
  `trace = parentTrace + [childNodeId]`. `emitElements` buckets child
  states by their parent's trace and rewrites each path-state's childOrder
  to the child pathKey wires (a shallow copy — compiled states stay
  read-only). `minimalFromState` (single-state, no sibling context)
  emits the pathKey WIRE but keeps `childOrder` as-is; path-trees flow
  through `emitElements`. The def branch additionally resolves a
  def-covered path child's node via `pathKey → nodeId` and adopts the
  child state's own converted childOrder.
- The R2.6 emit regressions (path-fork-review.md R2.6) are resolved by
  re-expressing the two `armIdx === undefined` gates — under the path model
  EVERY state is a path-state, so:
  - **IMPL-DECISION (Unit 7, shipped): the gate re-expression.** The gates
    are re-expressed structurally: `emitElements` groups by WIRE, not
    nodeId (`isPathState` = `forkKey === pathKey` and the key carries no
    `#` — the `#f:`-keyed component arms are the only other forkKey-bearing
    states; placement keys are `#`-free by the §1.3 guards). Every
    path-state therefore forms its own single-state group and can never be
    armIdx'd; the `multi`/armIdx machinery now applies ONLY to genuine
    `#f:` component forks (`nodeId#<i>` wires, unchanged).
  - def-retyping (`render-helpers.ts:309` `if (def && armIdx === undefined)`)
    applies to every path-state carrying a def binding (the gate becomes
    path-based: def + path-state);
  - `on:*` handler attachment (`render-helpers.ts:341-347`) applies to every
    path-state of a handler-carrying node;
  - leaves-by-fiat (`render-helpers.ts:236-240`, `:349-350`) is REMOVED for
    path-states — their children come from the path-derived childOrder
    (§2.3), which is exactly what FRK-H2's "all arms, no per-arm children"
    forbids today.
- There is no `#<i>` survival: every state is a path-state and identity is
  pathKey ALONE, unconditionally (§2.2; F-2). With the
  `component-source-duplicate` guard (§6.2 node.ts row) the
  arm-generating case is gone entirely — `armWires`/`nodeId#armIdx`
  (render-helpers.ts:210-215, :292-297) are re-expressed as pure pathKey
  wires.

### 4.3 Render-side derivations from wires; DEFECT #1 fixed first (prerequisite)

- Render-side derivations the compile does not need stay available from
  wires: children counts (`derived.ts:176-177` reads `cs.children` —
  path-derived per §2.3), handler attachment (emit-side, §4.2), and
  `stress:expanded`-class derived props — all read the compiled state, not
  the graph.
- **Prerequisite (blocking): DEFECT #1 — `emitOne` drops `cs.forkKey`**
  (docs/test-findings.md §"Engine defects", lines 432-460): fork-arm ops
  carry no forkKey, so fork arms stay distinct only via positional wires.
  The path model makes forkKey the WIRE, so the defect is load-bearing:
  the fix shape is already recorded (test-findings.md:456-460 — forward
  `s.forkKey` in every `emitOne` return branch, mirroring
  `minimalFromState` at render-helpers.ts:36-38; red test: compile →
  emitElements → diffMinimal asserts every create AND set op carries
  `forkKey = cs.forkKey`). This ships as a separate red→green unit BEFORE
  the path model lands.
- `treeSig`'s forkKey dimension (render-helpers.ts:127-138) and
  applyOps' `wireKey` composite (render-helpers.ts:22-25, `:57-86`) then
  exercise the canonical path for the first time (the DEFECT #1
  "unexercised contract" note, test-findings.md:449-455).

---

## 5. The static fork test (core behavior — encodes E2E-1)

### 5.1 Page re-expression

The fork-stress-data page (`demo/fork-stress-data.js`; spec
`docs/specs/fork-stress-data.md`) is re-expressed from clone-instance
assembly to the static model:

- The legacy envelope carries the root + **22 prototype nodes** (two per
  layer × 11 layers — the existing prototype shape, fork-stress-data.md
  §1.3/§"Data envelope"), each prototype carrying:
  - producer side: `placement: { placementName: '<zone-<k>>' }` — the R2.2
    sibling-shared owner-name topology: BOTH level-(k−1) prototypes own the
    SAME zone name (`'zone-<k-1>'`, two owners of one name — §1.2, the
    "one zone name per prototype" phrasing of the draft is superseded by
    the R2.2 arithmetic: the 4095 bijection requires the shared name, since
    §1.2 first-match keeps only the chosen name's zones, and the fan-out
    over the two sibling containers is what multiplies the paths per hop);
  - consumer side: `placement: { targetPlacement: ['<zone-(k−1)>'] }` for
    level k ≥ 2 (a single request name per node — the chosen name; the
    level-1 prototypes and root are producers only).
- **No handler bodies, no `clone-instance`, no after-compile expansion.**
  The tree is compiled by the §2 path enumeration: 4095 path-states
  (Σ 2^k for k=1..11 + root = 2^12 − 1; R2.2 bijection) pinned to 23 graph
  nodes. E2E-1 holds by construction: no node creation beyond the
  prototypes at any pipeline stage — the contentNodes-ownership minting
  (§6.2 translate row) adds ANCHORS, never nodes (10.af.1(b)).
- The runtime fork-stress page (`docs/specs/fork-stress.md`) is KEPT as-is
  alongside (path-fork-review.md R2.8 ¶4: "add a static page alongside
  rather than converting the runtime one"); both ship (Q4 resolved — §8
  ledger). The runtime page stays in the smoke set with its census asserts
  KEPT and re-pinned per the F-13 reading (§5.2).

### 5.2 Rewritten checks

The page's checks become the STATIC census (the RUNTIME page's checks at
fork-stress-data.js:407-418 layer counts and the census at :592-618 are
KEPT for the runtime pages, re-pinned per the F-13 reading below):

| Check | Static expectation |
| --- | --- |
| node census | registered = **23**; in-tree = **23** (22 prototypes + root, all contentNodes-owned — §10.aa); path-viable = **4095**; unplaced = **0** (prototypes are never 'unplaced' — family-wise they live under contentNodes); destroyed = 0; **cloneOps = 0** (F-1; replaces the round-1 `unplaced = 22` / `in-tree = 1` rows) |
| state census | compiled path-states = **2^depth − 1** (4095), one per path; every path-state's `forkKey` = its pathKey |
| element census | rendered elements = 2^depth − 1, wires = pathKeys |
| css stress / `stress:kind` / ancestry | unchanged in intent, now read from path-states (per-level property + slot pairs, fork-stress.md §Per-node CSS stress) |
| derived idempotency | `stress:expanded` (derived `children.length`, §2.3) true for non-leaf path-states, false for leaves |
| incremental contract | bootstrap = one path-enumeration compile; post-render ops (E2E-2/3/4 cases) = bounded slices only |
| profile | census fields published to the profile line (fork-stress-data.js:592-618 pattern) + smoke ratio guard (demo-smoke.mjs:284-295 — placement baseline + TODO, §8 Q6/§10.ad) |

**Runtime re-pin (F-13 chosen reading — §10.af.1):** with the
translate-global contentNodes-ownership minting (§6.2 translate row), the
RUNTIME page's 22 prototypes are in-tree too, so its census asserts re-pin
to `in-tree = 2^depth − 1 + prototypes` (4117), `unplaced = 0`; `cloneOps`
(4094) is unchanged. `nodeToLegacy` strips the minted contentNodes anchor
on reverse (§6.2 translate row). `state-first-analysis.md` §4.1 stands as
the PRE-minting runtime record (annotated).

---

## 6. Surface changes

### 6.1 SPECS

| Document | Change |
| --- | --- |
| `docs/specs/api.md` | §5 P1–P4 rewrite (lines 250-268): P3 changes from "forks exactly like components" (line 267, unimplemented) to the §1 two-sided-role + §2 path-fork contract; P1/P2 unchanged (role separation); P4 unchanged (state-slice hard-block) + placement-attach op added. §1.2 viability (lines 93-103) + T2/T3 rows: placement-path-to-root viable carve-out (supersedes S1.1 for placement-routed nodes — §2.4). §3.3 (lines 162-175) gains the placement-attach-op note. §4.2 F2 (line 289): forkKey = pathKey on every path-state. §7 W2/W3 (lines 317-320): per-path events for the affected set — the "≤1 `state` event per node per tick" letter dies (per-path keys fall out of forkKey = pathKey; events.ts needs no code change). §8 matrix: T6/T16 updated, new rows for content minting, path fork, veto, cycle, E2E-2/3/4. |
| `docs/specs/translate.md` | §1 `LegacyPlacementConfig` type fix (lines 46-50): `targetPlacement?: string[]` (was `string`, line 48), `activePlacement?: string` (was `boolean`, line 49). §2 placement rows (line 148): `targetPlacement` gains a mapping row (→ N `content` anchors, preference order preserved); "Unknown extra fields … `targetPlacement` … ignored" (lines 158-159) reversed for placement; the NP13/AP5 `component-target-placement` warn (lines 253-254, 440-444) is REMOVED (the feed is implemented); §2.1 "Placement inside component sub-trees … `targetPlacement` … anti-patterns" (lines 262-264) revised; TR-H3 (line 403) gains the content case; TR-F2 (line 412) drops `targetPlacement` from the ignored list; content-root handling (lines 430, 507-521): each `content` payload root (and `template.children` root) receives the `contentNodes` parent anchor at translate — translate-global minting (§10.ad, F-13); reverse emission (`nodeToLegacy`) gains `content` anchors → `targetPlacement: string[]` round-trip (the §2 reverse row, lines 354-377 pattern) + derived `activePlacement: string`, and STRIPS the minted contentNodes anchor. |
| `docs/specs/pipeline.md` | Stage 1 `targetPlacementResolution` (line 67) becomes IMPLEMENTED (was "resolution expressed as 'placement'-role anchors via attach + compile" — a dead promise; `pipeline.ts:78` registry row exists but translate never feeds it, legacy-component-ref-only-review.md:531); stage 2 `placementAssembly` (line 68) re-expressed without clone-instance decomposition (the placement fork no longer decomposes into `attach` + `clone-instance`, notes §10.2/§10.7 reference removed). §2.1 DropReason (lines 121-131) gains nothing (the three arm reasons suffice) but F10 (line 380) gains the placement-path viability carve-out. §3 slice scoping (lines 139-167): the path-enumeration compile mode added to the two scopes. |
| `docs/specs/node.md` | §2 (lines 90-103): `CompiledState` — `children` path-derived for path-states, `pathKey` multi-path (placement paths), `forkKey` on every path-state. §8.2 placement row (line 323): the borrow-algorithm note replaced by the §2 enumeration contract. §8.3 (lines 325-337): forking extended to placement paths (per-path keys replace "each candidate is a separate CompiledState keyed by its path" wording — now literal). §8.4 (lines 339-348): third compile scope (path enumeration). FS-7 (line 377): placement-path cycle guard; FS-10 (line 380): unchanged block + placement-attach op. `chainRoot` (lines 512-562) and `findCycle` (861-871): placement-edge walk extension. |
| `docs/specs/render.md` | §3.1/§3.2 (lines 64-99): pathKey-based wires for path-states; MinimalElement.forkKey now canonical (DEFECT #1). §4 (lines 116-141): third scope + the slice note (per-name placement Link is the zone registry, mirroring the component-Link note at lines 131-140). §6 (lines 197-220): path-states (all arms) replace the fork table's component-only framing; leaves-by-fiat lifted. §10.2 FRK matrix (lines 288-298): path-fork rows. |
| `docs/specs/derived-state.md` | §3 path roots (lines 89-107): `placement` root reads the path-state's final zone name (per-path, §2.3); `children.length` source = path-derived children (§2.3). §9.2 (lines 220-261): the `stress:expanded` adoption note now reads path-states. DV-H rows: per-path-state evaluation. |
| `docs/specs/ops.md` | §1 (lines 9-37): placement-attach op (dedicated structural kind — the `attach.zone` alternative is REJECTED, §9 Q2) with the trigger-identity payload `{ kind: 'placement', linkName, direction }` (10.ac.2 #7). §2.1 attach (lines 43-53): stays family-only; the placement-attach executor mints the `content` anchor(s) + §1.3 veto + the `container` anchor. §2.4 clone-instance (lines 72-76): no longer the placement mechanism. §7 G-rows (lines 186-210): placement-attach + E2E-4 rows. State-slice placement block (lines 19-27) UNCHANGED. |
| `docs/specs/contract.md` | §types (line 39): Role union + `'content'`; line 148 `DEFAULT_PLACEMENT` roles = `['container','content']`. |
| `RENDER_PROCESS_NOTES.md` | DECIDED revisions: S3.6 (line 534) — placement is attachment/compile-only REVISED: the legacy `Placement`/`PlacementConfig` consumer feed (`targetPlacement`) is carried over as the two-sided role + path compile (superseding the "not carried over" line); §10.8.2 (lines 455-466) — the placement paragraph (line 464) rewritten for the two-sided role + static multiplicity; §10.10.1 (lines 613-633) — the translate-mapping bullet gains the `targetPlacement` minting row; NP13 disposition (legacy-component-ref-only-review.md:433, :494, :531) — RESOLVED, the interim keep-unplaced + warn is replaced by the implemented feed. |
| `docs/specs/fork-stress-data.md` | Purpose (lines 7-36) rewritten: the page becomes the STATIC re-expression (§5) — two prototypes per layer with placement links, no handler/clone expansion; §"Data envelope" gains the `targetPlacement` arrays; §"Page module" loses the handler-body installation; §"Checks" gains the §5.2 census. |
| `docs/specs/fork-stress.md` | §"Data-driven variant" (lines 163-188) gains the static sibling page reference; the four-mechanism cycle doc stays for the RUNTIME page (kept). |
| `docs/skills/designing-pages.md` | §11 matrix (lines 248-249 rows) + §12 demo list (lines 321-348) updated for the re-expressed page and the new static-vs-runtime distinction (AGENTS.md item 3). |

### 6.2 CODE

| Surface | Change |
| --- | --- |
| `src/core/translate.ts` | Mint `content` anchors from `targetPlacement: string[]` (per name, in preference order, on the shared per-name placement Link — lines 433-438); `'container'`-role minting from `placementName` (role rename) + §1.3 ancestor-name veto (K4 `placement-name-vetoed`); `#`-validation warn `placement-name-invalid` at the minting site (§1.3) + `#`-check for authored ids (node.ts:143 site); **contentNodes-ownership minting**: each `content` payload root (and `template.children` root) receives the `contentNodes` parent anchor at translate — translate-global (lines 430, 507-521; §10.ad, F-13); `LegacyPlacementConfig` type fix (lines 49-53: `string[]`/`string`); NP13/AP5 warn removal (lines 440-444, 488-491); reverse: `content` anchors → `targetPlacement: string[]` in mint order (nodeToLegacy, lines 557-641 pattern), the minted contentNodes anchor STRIPPED, derived `activePlacement: string` read emission. |
| `src/core/types.ts` | Role union: + `'content'`, `'placement'` → `'container'` (line 8); `CompiledState.forkKey` present on every path-state = pathKey (lines 126-133); placement-attach op kind + trigger fields `{ kind: 'placement', linkName, direction }` in the op union + wire forms (lines 88, 93, 103, 111 — `AttachOp.zone` superseded by the dedicated kind, §9 Q2/10.ac.2 #7); `LegacyPlacementConfig` lives in translate.ts (fix there). |
| `src/core/link.ts` | `DEFAULT_PLACEMENT.roles = ['container', 'content']` (lines 23-26). |
| `src/core/node.ts` | Path-enumeration compile mode (per-node focused + root-out stay; lines 658-663 gain the placement branch); `makeCs` path-derived children attach at mint time (lines 623-638); per-path `pathKey` over placement edges (lines 300-316); `cs.forkKey = cs.pathKey` set UNCONDITIONALLY (lines 699-706); viability rule for placement-routed nodes (lines 564-605, the `selfProviding` branch at 589-603 grows `placementRouted`); chain classification + `findCycle` walk placement edges (lines 512-562, 861-871); per-walk visit set (§1.4); **`component-source-duplicate` guard at `addAnchor` (line 413)**: UNCONDITIONAL warn, keep-first, skip-second — no seed-path opt-out (§10.ab/ad/ae; K8 covers the legacy boundary; seed/hydration is covered by the same guard); `#`-check on authored ids (line 143). |
| `src/core/resolve.ts` | Placement walk: first-match preference loop over the node's ORDERED `content` anchors + per-name Link membership (lines 205-244; C-3); per-zone fan-out of the chosen name off the Link's `container` anchors; placement hops emit pathKey segments, NEVER `#f:` keys (lines 152-156; the `#f:` arm machinery dies with the forks); `container`/`content` enumeration off the per-name Link (lines 31-40 pattern); hub fallback (lines 96-132) covers placement names. |
| `src/core/supervisor.ts` | Slice/compile-mode switch for path enumeration (lines 246-258); **relevance pre-check** before `node.compile` (silent abort — §1.2) and **trigger identity through `supervisor.apply`** (lines 307-313; 10.ac.2 #7); affected-set derivation for E2E-2/3/4 (§3 — `markRemote` at node.ts:809-813 + per-name-Link dirty sets); event filter lifted to the affected set (lines 271-278) and the `#f` gate re-expressed to "path-state ⇒ emit `{ forkKey: pathKey, nodeIds: trace }`" (line 275; R2-Q6); placement-attach op executor (lines 351-364 gains the dedicated kind — not attach-with-zone). |
| `src/core/render-helpers.ts` | Path-state emit (**Unit 7 shipped**): pathKey wires (§2.2/§4.1 — `isPathState` discriminator `forkKey === pathKey` + `#`-free key; `emitElements` groups by WIRE, so every path-state emits at wire = pathKey and can never be armIdx'd; family states keep wire = nodeId; `#f:` component forks keep `nodeId#<i>`); per-path child conversion (§4.2 — trace-indexed child-state lookup rewrites path-state childOrder to the child pathKey wires; leaves-by-fiat removed for path-states, lines 236-240/349-350); def-retyping + `on:*` gates re-expressed as path-state gates (lines 309, 341-347 — path-states are single-wire groups, so the branches flow; the def branch resolves def-covered path children via `pathKey → nodeId`); `minimalFromState` emits the pathKey wire (childOrder as-is — single-state callers); root emits at the conventional wire `root`; **DEFECT #1 fix first** (EmitState/emitElements gain `forkKey`; every `emitOne` branch forwards it — test-findings.md:456-460, §6.5). |
| `src/core/ops.ts` | placement-attach executor (dedicated kind in the `execute` switch, lines 71-108) + veto; `attach` stays family-only (lines 29-56); state-slice block unchanged (lines 21-27). |
| `src/core/serialize.ts` | `roleOrder` gains `container`/`content` (line 117); **content anchors EXCLUDED from the target-string sort** — `targetPlacement` preference order survives round-trip (lines 115-123; 10.ac.2 #8); contentNodes-anchor round-trip (stripped on reverse at translate). |
| `src/core/derived.ts` | Per-path `placement` root: reads the path-state's final zone name (lines 172-175 — the first-anchor `'placement'` read is replaced; role rename); BARE_ROOTS update (line 32). |
| `src/core/events.ts` | **No code change** — per-path event keys fall out of `forkKey = pathKey` (W2 key `nodeId + forkKey` becomes per-path automatically; api.md §7 wording covers it). |
| `src/core/client.ts` | Verify the op spread (lines 28-33) + ref-resolution loop (lines 39-49) carry the placement-attach trigger fields through (10.ac.2 #7). |

### 6.3 TESTS

| Suite | Cases |
| --- | --- |
| `tests/unit/translate.test.ts` (+ reverse) | `targetPlacement: string[]` → N ordered `content` anchors on the shared per-name Link; `container`-role rename; veto warn; contentNodes-ownership minting (content roots + template roots; reverse STRIPS the anchor); `activePlacement` typing (string); reverse round-trip of the array in mint order; the old `component-target-placement` warn gone. |
| `tests/unit/node.test.ts` / compile | Path enumeration: per-path keys (sibling prototypes distinct keys at the final segment); path-derived children; viability for placement-routed unplaced nodes; per-walk visit-set cycle guard (`circular-source`, sibling walks unaffected); 4095-states census on the 23-node graph (E2E-1); `component-source-duplicate` guard (imperative + seed-path: keep-first, skip-second, warn) with the seeded fork-construction tests re-expressed (node.test.ts:475/615/957 pattern, §10.ab). |
| `tests/unit/render.test.ts` | pathKey wires + prevMap reuse; append ops from path-derived childOrder; DEFECT #1 red→green (forkKey on create/set, §6.5); `treeSig` forkKey dimension. |
| `tests/unit/ops.test.ts` / supervisor | placement-attach op (mint + veto + affected set = container + added node only); trigger-identity/silent-abort (less-favored container change ⇒ no state, no events); state-slice block regression (unchanged). |
| serialize / derived order tests | `targetPlacement` preference order survives the serialize round-trip (content anchors excluded from the target sort); per-path `placement` root reads the final zone name. |
| validation tests | `placement-name-invalid` `#` warn at the minting site; `#`-check on authored ids. |
| incremental E2E cases | E2E-2 (shallow props/text/css update: one node compiles — compile-scope assertion — element object reused; fixture proceeds via contentNodes minting, §3.1); E2E-3 (all-consumers + half-consumers precision case); E2E-4 (post-render third depth-4 placement add via placement-attach: no depth>4 recalc; container + node only). |
| static fork census (unit or e2e) | registered=23, in-tree=23, path-viable=4095, unplaced=0, states=2^12−1, elements=2^12−1, cloneOps=0, per-path `forkKey` = pathKey (F-7). |

### 6.4 DEMOS / SMOKE

| Surface | Change |
| --- | --- |
| `demo/fork-stress-data.js` | Re-expression to the static model (§5.1): 22 prototypes + placement links, no handler/clone assembly; STATIC checks added per §5.2; the RUNTIME page's existing checks (lines 407-418) and profile census (lines 592-618) are KEPT for the runtime pages. |
| `scripts/demo-smoke.mjs` | RUNTIME census asserts (lines 192-223) KEPT, re-pinned per the F-13 reading (in-tree = 2^depth − 1 + prototypes, unplaced = 0); a NEW static assert block added for the §5.2 static census; ratio guard (lines 284-295): the static page starts with **placement as the d12 baseline** + a TODO to update the baseline after testing confirms no explosive time issues (§10.ad; AGENTS.md item-4 watch applies to the path-enumeration bootstrap pass). |
| builder | `scripts/fork-stress-data-page.mjs` embeds the new envelope (placement links + `targetPlacement` arrays + contentNodes-ownership attachment instead of handler-declared prototypes); NEW static `fork-stress-data-*.html` pages. |
| demo fork-claim drops | `component-fixture.js:82-83`/`components.js:353-406`, `feature-matrix-fixture.js:206-207`/`feature-matrix-tests.js:470-483`, `pane-fixture.js:13-14`: same-name multi-source fixtures rebuilt to single-source (the fork claims are anti-patterned — §10.ab/ad/ae); `build-demo.mjs:76-81` `panelArms` throw re-expressed; role-rename-only updates: `components.js:220-233/251/374-375`, `ssr-render.*`, `feature-showcase.js:251-257/579-582`, `fork-stress-fixture.js:160-176` + `fork-stress.js:144-163/501-508`, `index.html:44/76-96`. |

### 6.5 EMIT PREREQUISITE (ships before the model)

- DEFECT #1 — `emitElements`/`emitOne` dropping `cs.forkKey`
  (test-findings.md:432-460): fixed as its own red→green unit (§4.3) with
  the recorded fix shape; without it the pathKey-wire scheme has no
  forwarding path.

---

## 7. Explicitly UNCHANGED

| Item | Basis |
| --- | --- |
| Graph is the truth; no per-arm authored data | state-first-analysis.md §2.2.2 impossibility — the path model adds NO arm-scoped authored state (path-fork-review.md R2.2: "nothing arm-scoped is authored; per-slot identity comes from the two-sided placement Link") |
| Pillar B — node-scoped, journaled ops | ops.md §6; journal identity/replay/undo-redo/payload/containment stay node-keyed (path-fork-review.md R2.3; the round-1 addressing impasse resolution) |
| Journal contract | ops.md §6 unchanged: ops named + replayable; `ClientAPI.apply` the sole public entry |
| Two-scope compile shape | pipeline.md §3 (root-out deep + node-local focused) stays; path enumeration is a THIRD mode, not a replacement |
| Read-only compiled states | node.md §3/§8: states immutable within a compile; slice locked until resolution (S2.3) |
| Single-parent invariant for family edges | node.md §1.2 SI-1…SI-5; the `content` role is peripheral (SI-3), never a family edge |
| Component source/target/duplex semantics | api.md §4 unchanged: depth-0, nearest-shadows-far, root fallback, unresolved status, three arm dispositions, coerced pick never synthesized |
| Def re-typing for NON-path consumers | render-helpers.ts `isLinkDef`/def→re-type seam unchanged for ordinary (non-path) consumers; only the `armIdx === undefined` GATE is re-expressed (§4.2) |
| State-slice placement hard-block | api.md §3.3 / node.md FS-10 / ops.ts:21-27 — placement writes stay blocked; placement changes go through the placement-attach op |
| The runtime fork-stress page | fork-stress.md + fork-stress-data (runtime variants) kept as the after-compile expansion proof (path-fork-review.md R2.8 ¶4); the static page is ADDED alongside |
| The per-name component Link as provider registry | resolve.ts:96-132 stays; the placement Link gains the same role for zones (§2.1) |

---

## 8. Resolution ledger (all design questions closed)

This section was the open-questions table through the review rounds; every
question is now RESOLVED and the verdicts are recorded here. The full
decision layers are §9 (round-1 decisions) and §10.x–§10.af (user review
rounds 1–5 + the final review). No design question survives to
implementation: the final review returned **PROCEED-TO-IMPLEMENT**
(§10.af.2), with F-13's reading pinned in §10.af.1.

| # | Question | Resolution | Decided in |
| --- | --- | --- | --- |
| Q1 | **`content` role naming.** | `'container'` (producer — the legacy `placement` role renamed) + `'content'` (consumer, minted per `targetPlacement` name); quoted+backticked role-token convention + the §10.5 disambiguation list. | §9 Q1, §10.x res-5 |
| Q2 | **E2E-4 mutation surface: new op vs attach-with-zone.** | dedicated `placement-attach` op (register-if-new, mint `content` anchor(s), ensure `container` anchor, dirty = container + added node only); `attach` stays family-only; `AttachOp.zone` superseded by the dedicated kind. | §9 Q2, §10.ac.2 #7 |
| Q3 | **Per-path event emission.** | per-path events for the affected set; the focused-node filter lifts to the affected set; the "≤1 `state` event per node per tick" letter dies — per-path keys fall out of `forkKey = pathKey` (events.ts needs no code change). | §9 Q3, §10.ac.4 |
| Q4 | **The runtime fork-stress page's fate.** | both ship: the runtime page is kept (census asserts kept, re-pinned per F-13) and the static page is added alongside. | §9 Q4, §10.af.1 F-13 |
| Q5 | **Legacy first-match-break nuance.** | preference-ordered first-match-with-known-container wins; every zone of the chosen name gets an instance; silent abort on less-favored update alerts (trigger identity + relevance pre-check). | §9 Q5, §10.z C-2/C-3 |
| Q6 | **Bootstrap cost shape.** | DEFERRED at round 1; decided at round 4: the static page's d12 ratio guard starts with **placement as the baseline** + a TODO to update the baseline after testing confirms the absence of explosive time issues. | §9 Q6, §10.ad |
| Q7 | **Path-key stability under moves.** | relocation cost accepted: any re-zone/move re-compiles downstream (subtree re-key ⇒ element re-create); documented as a known performance drain, optimizable later; the incremental guarantees apply to non-placement mutations (E2E-2/3) and additions (E2E-4). | §9 Q7 |
| Q8 | **Component resolution inside path-states.** | path-only resolution (the state's own single-parent chain to root); verified: identical ancestor trees ⇒ identical bindings ⇒ identity = pathKey alone (§2.2). | §9 Q8, §10.aa R2-Q4, §10.ab |

The process drafting note is superseded: the three-agent gate and the five
user-review rounds are complete (§9, §10.x–§10.af). The §6 inventory is the
input for the implementing units; every surface item carries its file:line
anchor for the TDD red→green→verify loop (AGENTS.md item 7); the unit
ordering and dependency plan is §10.af.3.

---

## 9. Design-review decisions (round 1) — RESOLVED by the user, recorded

These amendments feed the final review document and bind the consistency
pass.

- **Q1 RESOLVED — role naming**: producer/source side is the **`container`**
  role (the legacy `placement` role is RENAMED to `container`; anchor
  `target` = the placement name); consumer/content-request side is the
  **`content`** role (minted from `targetPlacement: string[]`, one anchor
  per requested name). `Role` union + `DEFAULT_PLACEMENT.roles =
  ['container', 'content']`. Naming note: the `content` ROLE shares a word
  with the node `content` field and the legacy `content` target path — the
  role lives in its own namespace (`'content'` as a role is unambiguous in
  anchor context); the consistency pass must sweep for wording collisions.
- **Q2 RESOLVED — dedicated `placement-attach` op**: a structural op that
  registers the node if new, mints its `content` anchor(s), mints/ensures
  the `container` anchor on the target container node, and marks pass-2
  dirty ONLY the container node + the added node (E2E-4's ideal affected
  set). Node-scoped, journaled, replayable; `attach` stays family-only;
  state-slice placement block unchanged (P4).
- **Q3 RESOLVED — per-path events for the affected set**: the existing
  per-state event shape (events.ts `fork: {forkKey, nodeIds}`) is kept,
  emitted only for the paths the incremental model marks affected —
  volume bounded by the change, not by state count. The focused-node
  filter (supervisor.ts:271-278) is lifted to the affected set. Coalescing
  is a possible follow-up, not part of this spec.
- **Q4 RESOLVED — both tree versions kept**: the runtime clone-based
  fork-stress page (legacy-format, after-compile expansion) AND the new
  static placement-path page (22 prototypes, container/content links) both
  ship; the static page is an addition, not a replacement.
- **Q5 RESOLVED — preference-ordered first-match** (§1.2 above): the
  `targetPlacement` array is a preference list; compile stops at the most
  preferred name with a known container; every zone of the chosen name
  gets an instance; less-favored update alerts that do not change the
  chosen name abort the compile silently.
- **Q6 DEFERRED**: bootstrap single-pass cost vs the d12 ratio-guard
  baseline — decided during the consistency passes (new baseline for the
  static page).
- **Q7 RESOLVED — relocation cost accepted**: anything that causes
  relocation (re-zoning, placement moves) re-compiles downstream
  (subtree re-key ⇒ element re-create). Documented as a known performance
  drain, optimizable later; the incremental guarantees apply to
  non-placement mutations (E2E-2/3) and to additions (E2E-4).
- **Q8 RESOLVED — path-only resolution**: component resolution inside a
  path-state walks the state's OWN single-parent chain to root (the path),
  never the graph node's family anchors beyond it — a multi-path
  prototype's family anchors would lead to a DIFFERENT parent than the
  path being compiled (cross-path resolution). The family walk remains
  only for states whose path IS the family chain (non-placement states).

---

## 10. Consistency-pass findings (round 1)

Consistency-pass agent output (READ-ONLY sweep of the whole repo against
§1–§9, plus §0 E2E encoding and §6 inventory completeness checks). One
review-document edit only: this section. Line numbers are as of this pass.
Spec citations use section numbers (§1.1, §2.4, §3.x, §5.x, §6.x, §9).

### 10.1 Conflict table — DOCS

| file:line | Current text / claim | Spec conflict | Needed update |
| --- | --- | --- | --- |
| `docs/specs/api.md:98,103` | §1.2: `unplaced` → `no-usable-state`; "Unplaced but chain reaches a permanent owner" is not "usable" | §2.4: a placement path to root ⇒ viable — unplaced nodes with enumerated root-terminated paths compile actionable states | Add the placement-path viability carve-out to §1.2 + the T2/T3 rows (§6.1 lists §1.2 but not the table rows) |
| `docs/specs/api.md:256-259` | §5: placement = `'placement'`-role anchor on the zone's family Link, applied by `attach`; "legacy `Placement`/`PlacementConfig` **not carried over** (S3.6)" | §1.1/§9-Q1: roles RENAMED to `container`/`content` on the shared per-name Link; the legacy consumer feed IS carried over | Rewrite §5 expression/applied-by/legacy rows; S3.6 revision |
| `docs/specs/api.md:267` | P3: "Placement multiplicity (shared `placementName`) forks exactly like components" | §1.2 + §2: preference-ordered first-match + per-path fork (path-multiplicative) | P3 rewrite per §6.1 |
| `docs/specs/api.md:268` | P4: placement changes go through `attach`/`detach` + compile | §3.3/§9-Q2: dedicated `placement-attach` op (attach stays family-only) | P4 wording + T16 row |
| `docs/specs/api.md:289` | F2: forkKey = "path back to root" (component-fork framing) | §2.2: forkKey extended to placement paths; present on EVERY path-state | F2 extension (listed in §6.1) |
| `docs/specs/api.md:318-319` | W2/W3: ≤1 `state` event per node per tick keyed `nodeId + forkKey` | §9-Q3: per-path events for the affected set; volume bounded by the change, not state count | Update §7 W2/W3 (the Q3 text cites api.md §7 lines 317-320) — **§6.1 api.md row omits §7** |
| `docs/specs/translate.md:48-49` | `LegacyPlacementConfig.targetPlacement?: string`, `activePlacement?: boolean` | §6.1: `targetPlacement?: string[]`, `activePlacement?: string` | Type fix (listed) |
| `docs/specs/translate.md:148` | `placementName` → `placement` anchor (role `'placement'`) | §1.1: producer role RENAMED `container` | Row update + a `targetPlacement` minting row (§6.1 lists) |
| `docs/specs/translate.md:158-159` | "Unknown extra fields (`versions`, `targetPlacement`, `activePlacement`, …) are ignored" | §1.2: `targetPlacement` is a real feed (preference-ordered); `activePlacement` is derived | Reverse the placement entries; keep the rest ignored |
| `docs/specs/translate.md:161-163` | "Content nodes are unplaced ⇒ dropped from compile (S1.1) until attached into a placement zone" | §2.4: placement-routed nodes compile via path enumeration; §2.5 `activePlacement` derived read | Carve-out sentence (S1.1 superseded for placement-routed nodes) |
| `docs/specs/translate.md:253-254` | `component-target-placement` guard (AP5/NP13 block+warn) | §6.1: warn REMOVED — the feed is implemented | Delete from the guard list (§6.1 lists) |
| `docs/specs/translate.md:262-264` | "`targetPlacement` on a component node … anti-patterns" | §1.2/§6.1: minting implemented | Revise bullet |
| `docs/specs/translate.md:395` | TR-6: "Content nodes stay unplaced until attached into a placement zone" | §1.2: `content` anchors mint AT TRANSLATE from `targetPlacement` | Re-word TR-6 (attachment ≠ minting) |
| `docs/specs/translate.md:403` | TR-H3: placement config → `placement` anchor | §6.1: TR-H3 gains the `content` case | Add TR-H3 content row |
| `docs/specs/translate.md:409` | TR-H9: unplaced dropped from compile (S1.1); self-providers resolve depth-0 | §2.4: + placement-routed viability | TR-H9 extension |
| `docs/specs/translate.md:412` | TR-F2: `targetPlacement` in the ignored list | §6.1: drops `targetPlacement` from the ignored list | TR-F2 rewrite |
| `docs/specs/translate.md:354-377` | Reverse emission blockquote: component-anchor → binding mapping only; no placement round-trip beyond `placementName` | §6.1: reverse emits `content` anchors → `targetPlacement: string[]` + derived `activePlacement` | Add the placement round-trip rows |
| `docs/specs/node.md:44` | SI-3: `'placement'` anchors peripheral | §1.1: peripheral edges now `'container'`/`'content'` | SI-3 role rename |
| `docs/specs/node.md:72` | Role union: `'placement'` | §1.1: + `'content'`, `'placement'` → `'container'` | Union update |
| `docs/specs/node.md:92` | pathKey "path back to root, e.g. `'root/<id>/<id>'`" (family-only) | §2.2: pathKey = family path interleaved with zone names; placement paths | pathKey wording (§6.1 lists) |
| `docs/specs/node.md:100` | children "ordered by family-Link child-anchor priority" | §2.3: path-states' children are path-derived (descendant path-states) | Add the path-state children clause |
| `docs/specs/node.md:323` | §8.2 placement row: borrow-algorithm on zone's family Link | §2.1/§2.4: per-name placement Link IS the zone registry; enumeration contract | Replace row (§6.1 lists) |
| `docs/specs/node.md:327-337` | §8.3 forking: "each candidate is a separate `CompiledState` keyed by its path" | §2.2: now literal for placement paths; sibling prototypes distinct at final segment | Extend to placement paths (§6.1 lists) |
| `docs/specs/node.md:339-344` | §8.4: two compile scopes | §2.1: THIRD scope — path enumeration | Add scope row (§6.1 lists) |
| `docs/specs/node.md:371` | FS-1: compile on not-in-tree → no usable state (S1.1) | §2.4: placement-path-to-root viability carve-out | FS-1 exception clause |
| `docs/specs/node.md:377` | FS-7: compile-time walk revisit/depth cap | §1.4: per-walk visit set over placement + family edges | FS-7 extension (§6.1 lists) |
| `docs/specs/node.md:380` | FS-10: "placement changes go through forward `attach` ops only" | §3.3/§9-Q2: placement-attach op | FS-10 wording (§6.1 lists) |
| `docs/specs/pipeline.md:67` | Stage 1 `targetPlacementResolution`: "resolution expressed as `'placement'`-role anchors via `attach` + compile (S3.6, S-R2.8)" — dead promise | §6.1: stage becomes IMPLEMENTED (translate feeds content anchors) | Stage-1 summary rewrite |
| `docs/specs/pipeline.md:68` | Stage 2 `placementAssembly`: "decomposes into `attach` + `clone-instance`" | §6.1: re-expressed without clone-instance decomposition | Stage-2 summary rewrite |
| `docs/specs/pipeline.md:124` | DropReason `'not-in-tree'`: "S1.1: no path to a permanent owner → no usable compiled state" | §2.4: placement path to root ⇒ viable | DropReason note (F10 row listed in §6.1; §2.1 block is not) |
| `docs/specs/pipeline.md:145-147,157-163` | §3 SliceScope: two scopes, one `compile(slice)` primitive | §2.1: path-enumeration compile mode added | Third scope (§6.1 lists) |
| `docs/specs/pipeline.md:308` | "placement changes go through a forward tree rebuild instead" | §3.3: placement-attach op | Sentence update |
| `docs/specs/pipeline.md:380` | F10: not-in-tree compile → drop `not-in-tree`, no usable state | §2.4: placement-path viability carve-out | F10 gains the carve-out (§6.1 lists) |
| `docs/specs/pipeline.md:384` | F14: hard-blocked; accepted-op late-fail drop | stays (§3.3) — but gains the placement-attach op row | Add placement-attach row to §8.2 |
| `docs/specs/render.md:68-71,83,173` | RenderOp/MinimalElement forkKey "present only on actionable fork-arm emits (S-R3.10)"; serialized forkKey "solely on actionable root-terminated forks" | §2.2/§4.1: forkKey on EVERY path-state; wires = pathKeys | §3.1/§3.2/§5 forkKey wording (§6.1 lists §3.1/§3.2) |
| `docs/specs/render.md:97-99` | "Every emitted op forwards the element's forkKey when present" (minimalFromState-only today) | §4.3: DEFECT #1 fix makes this canonical for emitElements | Note the prerequisite (§6.1 lists) |
| `docs/specs/render.md:116-140` | §4: Two-scope model + per-name component Link registry note | §2.1/§6.1: third scope + the placement Link as zone registry | §4 extension |
| `docs/specs/render.md:166` | `RenderNodeState.state: 'in-tree'` — "only in-tree states are renderable/serializable as actionable (S1.1)" | §2.4: unplaced nodes with placement paths produce ACTIONABLE path-states (label stays honest) | Add the placement-routed exception to §5/RenderNodeState |
| `docs/specs/render.md:197-209` | §6 fork table framed for component sources/placements (attach-driven) | §2.4/§4.2: path-states (all arms) replace the table's framing; leaves-by-fiat lifted | §6 rewrite (§6.1 lists) |
| `docs/specs/render.md:260` | NVS-3: prototype/unplaced/destroyed never render targets (S1.1) | §2.4: placement-routed unplaced nodes render | NVS-3 carve-out |
| `docs/specs/render.md:288-298` | §10.2 FRK matrix (component-only framing) | §4.2/§6.1: path-fork rows | FRK rows (§6.1 lists) |
| `docs/specs/derived-state.md:97-100` | `pathKey` root "fork arms carry their path"; `placement` root = "the node's `placement` anchor target (string) or `null`" | §2.3/§2.2: per-path `placement` root reads the FINAL ZONE NAME of the path; path-states carry pathKey | §3 table rows (§6.1 lists §3) |
| `docs/specs/derived-state.md:98,225-261` | `children.length` source = family children; §9.2 fork-stress `stress:expanded` adoption note (clones) | §2.3: children length = path-derived children for path-states; §9.2 reads path-states | §9.2 rewrite (§6.1 lists) |
| `docs/specs/ops.md:13` | `attach` carries `zone?: string` (declared, unused by every executor) | §3.3/§9-Q2: dedicated placement-attach op (attach stays family-only) | §1 union + §2.1 (§6.1 lists) |
| `docs/specs/ops.md:72-76` | §2.4 clone-instance: "Placement expressed via the cloned subtree's anchors … **no legacy `Placement*` types** (S3.6, S-R2.8)" | §1.1/§6.1: legacy feed IS carried; clone-instance is no longer the placement mechanism | §2.4 rewrite |
| `docs/specs/ops.md:89-90` | §3 decomposition: `Placement` → attach + `'placement'`-role anchor; Clone-into-zone → clone-instance + attach (with zone) | §1.1/§3.3: two-sided roles + placement-attach op | §3 decomposition rows |
| `docs/specs/ops.md:128` | §4 state-slice reducer: "In-tree gating (S1.1) … no usable compiled state" | §2.4: placement-routed viability carve-out (see 10.2 supervisor.ts:332-335) | Gate note |
| `docs/specs/ops.md:154` | Fork-arm disposition during pass 2 (sources/placements, attach-driven) | §2.4: placement-path arms disposition | Extend |
| `docs/specs/ops.md:198` | G9: state-slice/compile on not-in-tree → no usable state | §2.4: carve-out | G9 exception |
| `docs/specs/contract.md:39` | Role union without `'content'` | §1.1/§9-Q1 | + `'content'` (listed) |
| `docs/specs/contract.md:148` | `DEFAULT_PLACEMENT: roles: ['placement']` | §1.1: `['container', 'content']` | (listed) |
| `docs/specs/graph.md:29-32,40` | Role union; referenceName token "component/placement maps" | §1.1: role rename + `'content'` | Union + token comment — **§6.1 omits graph.md entirely** |
| `docs/specs/graph.md:105` | placement shape row: "`'placement'`-role anchor on the zone's family link; applied by `attach`, populated by compile" | §1.1/§2.1: per-name placement Link = the ZONE REGISTRY (both roles); placement-attach op | §3 canonical-shape row rewrite |
| `docs/specs/validation.md:56,50,132` | Role union; placement anchor in unresolved-reference trigger | §1.1: role rename | Union + prose — **§6.1 omits validation.md** |
| `docs/specs/payload.md:64` | R-2: "placement anchors → `placement.placementName`" (reverse) | §6.1 translate reverse: content anchors → `targetPlacement: string[]` | R-2 extension — **§6.1 omits payload.md** |
| `docs/specs/payload.md:16-18,75` | Placement-detach persistence semantics ("placement may return") | §3.3: placement removal also kills the removed node's path-states (wires leave the next set) | P-table note |
| `RENDER_PROCESS_NOTES.md:534` | S3.6 DECIDED: "Placement is attachment/compile only — no legacy `Placement`" | §1.1/§6.1: REVISED — two-sided roles + consumer feed carried | S3.6 revision (listed) |
| `RENDER_PROCESS_NOTES.md:548` | S-R2.8: placement = `'placement'`-role anchor via attach + compile | §1.1: role rename + zone-registry Link | S-R2.8 revision |
| `RENDER_PROCESS_NOTES.md:565` | S-R3.9: roles union + `'placement'`/`'component'` | §1.1: + `'content'` | Union revision |
| `RENDER_PROCESS_NOTES.md:464` | §10.8.2 placement paragraph: legacy `Placement*` not carried over | §6.1: rewritten for the two-sided role + static multiplicity | (listed) |
| `RENDER_PROCESS_NOTES.md:466,501` | §10.8.2/§10.8.4 fork paragraphs: "several sources/placements share a name — the compiler forks" (attach-driven framing) | §2.1: static path-enumeration forks | Extend with the static mode |
| `RENDER_PROCESS_NOTES.md:476` | §10.8.3 storage table: "placement = resolution link at the zone" | §1.1/§2.1: two-sided per-name placement Link | Row update — **§6.1 omits §10.8.3** |
| `RENDER_PROCESS_NOTES.md:619-630` | §10.10.1: "placement config → `placement` anchor"; "Content nodes stay dropped from compile (S1.1) until attached into a placement zone" | §6.1: minting row + §2.4 viability | §10.10.1 bullets |
| `RENDER_PROCESS_NOTES.md:694-702` | §10.10.4: S1.1 carve-out for self-providing unplaced nodes only | §2.4: `placementRouted` sibling branch grows the carve-out | DECIDED revision — **§6.1 lists §10.10.4 only by reference** |
| `docs/skills/designing-pages.md:52-55` | §3: "a node declares `placement: { placementName }` … a `placement` anchor targeting the zone name. Content payload roots stay **unplaced** until attached into a zone." | §1.1/§1.2: two-sided roles; `targetPlacement` content minting; path compile | §3 rewrite — **§6.1 lists only §11/§12; §3/§5/§8 are missed** |
| `docs/skills/designing-pages.md:60-61,73` | §3: "Fork: N providers … each keyed by its path back to the root"; "fork-arm adoption in `childOrder` … `<nodeId>#<i>` arms" | §2.2/§4.2: pathKey wires for path-states; `#<i>` survives only for component forks | §3 fork rows |
| `docs/skills/designing-pages.md:91-114` | §5 rendering: diff rules, `#<i>`-free but no pathKey wire language; bootstrap-vs-incremental | §4.1: pathKey-stable wires; per-path append owners | §5 wording |
| `docs/skills/designing-pages.md:162-180` | §8: "component/placement/handlers map to anchors/handlers"; reverse "reverses placement/component-induced tree state" | §1.2/§6.1: `targetPlacement` minting + reverse `targetPlacement` emission | §8 legacy-in/out rows |
| `docs/skills/designing-pages.md:246-249` | §11 matrix: `fork-stress-data.js` = "the DATA-DRIVEN variant … via the `clone-instance` op" | §5.1/§6.1: re-expressed as the STATIC page (22 prototypes, container/content); runtime kept | §11 rows (listed) |
| `docs/skills/designing-pages.md:309-317,349-351` | §12 demo list: fork-stress-data pages (clone-based; single-method variants) | §5.1: static-vs-runtime distinction; new static page | §12 updates (listed) |
| `docs/specs/fork-stress.md:163-188` | "Data-driven variant" sections describe clone-instance assembly as THE variant | §5.1/§6.1: static sibling page reference added; four-mechanism cycle doc stays for the runtime page | (listed) |
| `docs/specs/fork-stress-data.md:7-36` | Purpose: "Two prototypes per layer, everything else dynamically assembled" (clone-instance, handler bodies) | §5.1/§6.1: page becomes the STATIC re-expression (no handler/clone expansion) | Purpose + envelope + page-module + checks rewrites (listed) |
| `docs/test-findings.md:422` | Stress loop #1, scenario 10 verdict: DATA-FIX (premise) "placement multiplicity forks like components (P3) is NOT expressible from a static legacy envelope … P3 forks materialize only dynamically" | §1.2/§2: P3 IS now statically expressible (path model) | Supersession note: verdict re-recorded as the model the new spec implements |
| `docs/test-findings.md:432-460` | DEFECT #1 — `emitOne` drops `cs.forkKey` (severity MEDIUM, "masked by the arm-wire convention") | §4.3/§6.5: becomes the blocking PREREQUISITE (pathKey wires need forkKey forwarding) | Severity/status update; fix shape already recorded there |
| `docs/test-findings.md:34` | Blind test #2 scenario 7: "handler defs and `targetPlacement` gone" (reverse round-trip claim) | §6.1: `targetPlacement` now ROUND-TRIPS (content anchors → array) | Supersession note on the claim |
| `docs/test-findings.md:41-42` | Blind test #2 scenarios 14/15: placement co-existence records | §1.2: content minting changes the translate surface | Marginal — re-check on the translate re-record |
| `docs/test-findings.md:209-211,299-311` | Validation runs: fork-stress d12 ratio numbers (placement 3.9s baseline) | §5.2/§9-Q6: ratio baseline re-pinned to the static page's placement d12 | Re-baseline note on future runs |
| `docs/session-defect-review.md:440-444` | Profile table: placement d12 = 4727.7ms, 99.1% unmeasured gap | §5.2/§9-Q6: static page's ONE path-enumeration bootstrap replaces 4094 per-node passes; the profiler gap RCA applies to the RUNTIME page | Section note: numbers describe the runtime page; static page re-baselines |
| `docs/session-defect-review.md:486-495` | "the Rule" (total − Σ(measured) guard) promoted from manual to asserted | AGENTS.md item-4 wording change (§10.1 below) | Wording re-point |
| `docs/specs/legacy-component-ref-only-review.md:433` | NP13: "targetPlacement translation gap: legacy content routing dead" | §1.2/§6.1: RESOLVED — feed implemented | NP13 disposition (listed via §6.1 RENDER_PROCESS_NOTES row) |
| `docs/specs/legacy-component-ref-only-review.md:494-495` | Standing decision #7: "targetPlacement routing (NP13) — interim keep-unplaced + warn is DECIDED; feed wiring TODO" | §1.2: the interim is replaced by the implemented feed | Supersede #7 |
| `docs/specs/legacy-component-ref-only-review.md:531` | (registry row context: pipeline stage 1 dead-promise record) | §6.1 pipeline row cites this anchor | Annotate resolved |
| `docs/specs/path-fork-review.md:222-228,272-277` | Round-1 REJECT + round-2 "REVISED-but-reject FOR THE STATED GOAL" verdict text | The approved spec is that round-2 ¶3 separately-specced FEATURE (R2.8 ¶3) — verdicts are the decision RECORD, not the current contract | Add a supersession banner: §2.1-§2.5 round-1 blockers and R2.3/R2.4/R2.6/R2.7 verdict text are superseded as CONTRACT by placement-path-spec.md (they remain the historical record) |
| `docs/specs/state-first-analysis.md:134-138` | "Placement forks (`api.md` §5 P3 …) are UNVERIFIED dynamically — … a static legacy envelope cannot express a placement fork" | §1.2/§2: now expressible (the §2.2.2 impossibility does not apply — R2.2) | Supersede the P3 note |
| `docs/specs/state-first-analysis.md:177-197` | §4.1 census: 4117 registered = 4095 in-tree + 22 unplaced; cloneOps 4094 | §5.2: this remains the RUNTIME page census; the static page census is registered=23, states/elements=2^12−1, cloneOps=0 | Keep as runtime census; add the static census reference |
| `docs/specs/state-first-analysis.md:266,280,303` | P3-as-holes cross-references; "static P3 (placement forks authorable in legacy data)" as a landing path | §9: static P3 approved as a feature | Mark resolved |
| `docs/FRESH-CONTEXT-SUMMARY.md:17-18,23,31,55-56,65,102,148,173,184` | Role lists without `'content'`; two-pass compile "component/placement borrow"; S1.1 in-tree gating; translate/reverse placement mapping | §1.1/§2.1/§2.4 | Refresh the summary (role rename, path mode, viability carve-out, content minting) — **§6.1 omits this file** |
| `AGENTS.md:29-35` | Item 4: "the values/link-only d12 totals must stay within ~1.5× of the placement d12 total … the page profiler does NOT time pass-2" | §5.2/§9-Q6: the guard now applies to the static page's path-enumeration bootstrap (a NEW baseline); pass-2 IS the enumeration on the static page | Re-point the guard wording (demo-smoke.mjs enforces 2.5× at :288-295 vs AGENTS' ~1.5× — reconcile) |
| `docs/framework-feature-summary.md:42` | Pipeline stage list (names unchanged) | none for the stage names; check placement feature text when the static page ships | Verify after the page lands |

### 10.2 Conflict table — CODE

| file:line | Current behavior | Spec conflict | Needed update |
| --- | --- | --- | --- |
| `src/core/types.ts:8` | `Role = … 'placement' …` | §1.1/§9-Q1: + `'content'`; `'placement'` → `'container'` | Union change (listed) |
| `src/core/types.ts:88,106` | `AttachOp.zone?: string` declared, unused | §3.3/§9-Q2: dedicated `placement-attach` kind decided | Add the op kind (or explicitly retire `zone`) |
| `src/core/types.ts:126-133` | `CompiledState.forkKey?` optional; `children: NodeRef[]` | §2.2/§2.3: forkKey present on every path-state; children path-derived for path-states | Type notes (listed) |
| `src/core/link.ts:23-26` | `DEFAULT_PLACEMENT.roles = ['placement']` | §1.1: `['container', 'content']` | (listed) |
| `src/core/link.ts:28-32` | `baseFor` returns DEFAULT_PLACEMENT for name 'placement' | §1.1: unchanged shape; roles widen | (listed) |
| `src/core/link.ts:79-85` | `role-mismatch` whitelist enforcement | §1.1: unchanged, roles widen — cross-role writes still reject | No change |
| `src/core/translate.ts:49-53` | `LegacyPlacementConfig.targetPlacement?: string; activePlacement?: boolean` | §6.2: `string[]` / `string` | Type fix (listed) |
| `src/core/translate.ts:133-146` | default hub `linkFor(name, kind: 'component'|'placement')` | §1.1: placement Link admits both roles | No change to the hub; roles live on DEFAULT_PLACEMENT |
| `src/core/translate.ts:433-438` | `placementName` → `addAnchor('placement', name, …)` | §1.1/§1.3: role `'container'` + ancestor-name veto (K4 warn `placement-name-vetoed`) | Minting rewrite (listed) |
| `src/core/translate.ts:440-444,488-491` | AP5/NP13 `component-target-placement` warn, field ignored | §1.2/§6.2: mint N `content` anchors per `targetPlacement` name (preference order); warn REMOVED | Feed implementation (listed) |
| `src/core/translate.ts:557-641` | `nodeToLegacy`: placement anchor → `placementName` only; no `targetPlacement` emission | §6.2: reverse `content` anchors → `targetPlacement: string[]`; derived `activePlacement` read emission | Reverse rows (listed) |
| `src/core/node.ts:186,788-793` | Link-kind mapping `role === 'placement' ? 'placement'` | §1.1: `'container'`/`'content'` anchors must still resolve to the `placement` Link kind | Mapping update (both anchors → placement kind) |
| `src/core/node.ts:300-316` | `pathKeyFrom`: family walk only | §2.2: placement edges interleave zone names | Extension (listed) |
| `src/core/node.ts:512-562` | chain classification walks family anchors only | §1.4/§2.1: placement-edge walk + per-walk visit set | Extension (listed) |
| `src/core/node.ts:564-605` | viability: `unplaced` → selfProviding only | §2.4: `selfProviding` branch grows `placementRouted` | Extension (listed) |
| `src/core/node.ts:623-638` | `makeCs`: `children: node.children.map(id)` (family) | §2.3: path-derived children attach at mint time | Extension (listed) |
| `src/core/node.ts:658-663` | static fork fires ONLY on `target` anchors | §2.1: path-enumeration compile mode (content anchors → per-name placement Link → container owners) | New mode (listed) |
| `src/core/node.ts:861-871` | `findCycle` walks `parent` chain (family only) | §1.4: extended to placement edges at op time | Extension (listed) |
| `src/core/resolve.ts:31-40,55-84,152-156,205-244` | `providersOn` (source/duplex only); `chainKindOf` family-only; `#f:<ownerId>#<i>` arm keys | §2.1/§2.2/§6.2: content-consumer enumeration off the per-name placement Link; placement-path ancestor resolution; pathKey-based keys replace `#f:` | Extension (listed) |
| `src/core/supervisor.ts:246-258` | per-dirty-node `node.compile(focusedSlice(node))` — no path-enumeration mode | §2.1: slice/compile-mode switch gains the branch | (listed) |
| `src/core/supervisor.ts:271-278` | focused-node event filter `if (cs.nodeId !== nodeId) continue` | §9-Q3: lifted to the AFFECTED SET (per-path events) | Filter re-expression — §6.2 supervisor row does not name this line |
| `src/core/supervisor.ts:275` | fork event gate `cs.pathKey.includes('#f') && cs.trace` | §2.2/§9-Q3: pathKey-based; every path-state emits for its path | Gate replacement — not listed in §6.2 |
| `src/core/supervisor.ts:326-331` | state-slice placement hard-block | §3.3: UNCHANGED (P4) | No change |
| `src/core/supervisor.ts:332-335` | state-slice gated `nodeState !== 'in-tree'` → `no-usable-state` | §3.1 E2E-2: a props/text/css update on a path-routed node (unplaced prototype in the static tree) must regenerate ONLY its path-states — the in-tree gate rejects exactly that fixture | Apply gate re-keyed to path-viability (or the E2E-2 fixture defined on an in-tree node) — **the spec's §3.1 does not address this; the draft §6 misses the line** |
| `src/core/supervisor.ts:351-364` | `attach` executor: family-only; `zone` ignored | §3.3/§9-Q2: placement-attach executor (register if new, mint content anchor, ensure container anchor, mark pass-2 dirty only container + added node) | (listed) |
| `src/core/ops.ts:21-27` | state-slice placement block | §3.3: UNCHANGED | No change |
| `src/core/ops.ts:29-56` | `attach`: family-only executor | §3.3/§9-Q2: placement-attach executor + §1.3 veto | New executor (listed) |
| `src/core/ops.ts:71-108` | `execute` switch — no placement-attach kind | §3.3/§9-Q2: new kind | (listed) |
| `src/core/render-helpers.ts:210-215` | `armWires`: fork arms wired `<nodeId>#<i>` | §2.2/§4.1: path-state wires = pathKeys | (listed) |
| `src/core/render-helpers.ts:236-243,349-350` | leaves-by-fiat: multi-arm → `childOrder = []`; arms are leaf dupes | §4.2: REMOVED for path-states (path-derived childOrder) | (listed) |
| `src/core/render-helpers.ts:292-297` | `emitOne` wire = `nodeId#armIdx` | §2.2: pathKey wire | (listed) |
| `src/core/render-helpers.ts:309` | `if (def && armIdx === undefined)` — def-retyping gate | §4.2: path-based gate (def + path-state) | (listed) |
| `src/core/render-helpers.ts:341-347` | `if (armIdx === undefined)` — `on:*` handler attachment gate | §4.2: every path-state of a handler-carrying node | (listed) |
| `src/core/render-helpers.ts:36-38` | `minimalFromState` forwards `cs.forkKey` (canonical path; emitOne does NOT — DEFECT #1) | §4.3/§6.5: DEFECT #1 fixed first (forkKey in every `emitOne` branch) | (listed) |
| `src/core/render-helpers.ts:127-138` | `treeSig` forkKey dimension | §4.3: exercised for the first time | (listed) |
| `src/core/serialize.ts:117` | `roleOrder` includes `placement: 5` | §1.1: + `container`/`content` ordering | roleOrder update — **§6.2 serialize.ts row does not name it** |
| `src/core/derived.ts:32,172-175` | `placement` root = `anchors.find(a => a.role === 'placement')` target; BARE_ROOTS includes 'placement' | §2.3: per-path — reads the path-state's FINAL ZONE NAME; role renamed | derived.ts update — **§6.2 CODE table omits derived.ts** (mentioned only in §2.3 prose) |
| `src/core/derived.ts:163-191` | `pathValue` own-state whitelist | §3.1 justification — unchanged | No change |
| `src/core/events.ts:68-74` | W2 coalescing keyed `nodeId + forkKey`; last-write-wins per key | §9-Q3: per-path events for the affected set; coalescing is a follow-up, not in this spec | Re-key/re-scope note — **§6.2 omits events.ts** |
| `src/core/pipeline.ts:78-79` | registry summaries: stage 1 "resolution expressed as placement-role anchors"; stage 2 "decomposes into attach + clone-instance" | §6.1 pipeline.md rows: stage 1 IMPLEMENTED; stage 2 re-expressed | Registry text — **§6.2 omits pipeline.ts** |
| `src/core/adapters.ts:51-60,201-258` | adapters already forkKey-keyed | §4.3: unchanged — DEFECT #1 fix makes the contract exercised | No change |

### 10.3 Conflict table — TESTS

| file:line | Current assertion | Spec conflict | Needed update |
| --- | --- | --- | --- |
| `tests/unit/translate.test.ts:505-525` | K8: `component-target-placement` warn fires; `targetPlacement` ignored | §1.2/§6.3: warn REMOVED; `targetPlacement: string[]` mints N `content` anchors | Rewrite the describe as minting + veto tests |
| `tests/unit/translate.test.ts:658-663` | placement config → anchor with `role === 'placement'` | §1.1: role `'container'` | Assertion update |
| `tests/unit/translate.test.ts:765-771` | shared hub: `slotLink.anchorsOf('placement')` length 1 | §1.1: `anchorsOf('container')` (+ content anchors for `targetPlacement`) | Assertion update |
| `tests/unit/node.test.ts:1132` | role union contains `'placement'` (and not `'content'`) | §1.1: `'content'` added | Union assertion |
| `tests/unit/node.test.ts:850-853` | FS-10 block | §3.3: unchanged | No change |
| `tests/unit/derived.test.ts:65-98` | `{ $: 'placement' }` reads the `'placement'` anchor target | §2.3: per-path final zone name; role rename | Update |
| `tests/unit/graph.test.ts:281-297` | placement-link role-mismatch via `role: 'placement'` | §1.1: roles rename | Update |
| `tests/unit/ops.test.ts:253-260` | role-mismatch with `role: 'placement'` | §1.1: rename | Update |
| `tests/unit/validation.test.ts:412-414` | placement link admits `role: 'placement'` | §1.1: rename | Update |
| `tests/unit/reverse.test.ts:42-72` | placement round-trips as `placementName` only | §6.1: `content` anchors → `targetPlacement: string[]` | Add reverse case |
| `tests/unit/payload.test.ts:58-76` | placement-detach persistence ("placement may return") | §3.3: removal also kills the removed node's path-states | Re-verify semantics; add removal-case |
| `tests/unit/pipeline.test.ts:12-13,172` | stage names + DropReason list (names unchanged) | none for names; F10/F14 carve-out rows | Extend F10; keep F14 |
| `tests/unit/pipeline.test.ts:557-560` | F14 block | §3.3: unchanged | No change |
| `tests/integration/api.test.ts:228-239,402-433` | T6 (block) / T15 (mismatch) / T16 (state-slice vs attach) | T6/T15 unchanged; T16(b) `attach` → placement-attach op | T16 update |
| `tests/integration/supervisor.test.ts:73-79` | `ofRole(node, 'placement')` anchor minting | §1.1: role rename | Update |
| `tests/e2e/legacy-bootstrap.test.ts:90,120-124` | attach-into-zone makes unplaced content render; anchor role `'placement'` | §1.1/§1.2: content anchors mint at translate; role rename | Update |
| `tests/e2e/ssr-render.test.ts:135-136,263-275` | zone carries a `'placement'` anchor; serialization | §1.1: rename (+ per-path serialized forkKey) | Update |
| `tests/e2e/ssr-html-validity.test.ts:46-47,112` | placement anchor minting | §1.1: rename | Update |
| `scripts/stress-probes/RESULTS.md:118-125` | scenario 10: "placement anchors are inert at static compile; P3 materializes via attach+compile" | §1.2/§2: superseded — P3 is statically expressible | Supersession record (probe evidence kept) |
| `scripts/stress-probes/RESULTS.md:84-96` | DEFECT #1 record (forkKey dropped) | §4.3/§6.5: becomes the prerequisite red→green | Status annotation |
| `tests/unit/fork-stress-data.test.ts:6-46` | runtime page data (methods/labels) | §5.1: runtime page KEPT — no change; a static-page data test is NEW | Add static-envelope test |
| `tests/unit/render.test.ts:608-621` | forkKey-forwarding round-trips | §4.1: gains pathKey-wire rows | Extend |
| `tests/unit/adapters.test.ts:283-304` | HLP-H16 forkKey red-test shape (compile → minimalFromState → diffMinimal) | §4.3: DEFECT #1 red test uses the same shape on emitElements | Extend per §6.3 render.test.ts row |

### 10.4 Conflict table — DEMOS / SMOKE

| file:line | Current fixture/check | Spec conflict | Needed update |
| --- | --- | --- | --- |
| `demo/fork-stress-data.js:407-425` | checks: in-tree = 2^depth − 1; prototypes stay unplaced | §5.2: static census (registered=23, unplaced=22, states=2^12−1, cloneOps=0) | Rewrite checks (listed) |
| `demo/fork-stress-data.js:592-618` | profile census fields (registered/inTree/unplaced/destroyed/cloneOps) | §5.2/§6.4: → states/elements/placementOps | Rewrite (listed) |
| `scripts/demo-smoke.mjs:192-223` | `assertForkStressCensus`: `inTree = 2^depth − 1`, `cloneOps = inTree − 1`, `unplaced = 2(depth−1)` | §5.2/§6.4: §5.2 expectations replace these | Re-pin (listed) |
| `scripts/demo-smoke.mjs:284-295` | d12 ratio guard 2.5× (placement baseline) | §9-Q6/§5.2: baseline re-pinned to the static page's placement d12; AGENTS item-4 wording says ~1.5× — reconcile the two numbers | Re-baseline + reconcile |
| `scripts/fork-stress-data-page.mjs` | builder embeds the clone-assembly envelope (handler-declared prototypes) | §5.1/§6.4: embeds placement links + `targetPlacement` arrays | (listed) |
| `demo/components.js:220-233,251,374-375` | placement resolution label via `a.role === 'placement'` | §1.1: role rename to `'container'` | Update — **§6.4 omits components.js** |
| `demo/feature-matrix-fixture.js:167-184,217-225` | content roots `placementName 'content'/'comments'`; explicit `attach` step into zones | §1.1/§3.3: container-role rename; attach → placement-attach op semantics | Update — **§6.4 omits feature-matrix-fixture.js** |
| `demo/ssr-render.template.html:40,52` + `demo/ssr-render.html:21-22` | zone renders "with its placement anchor" (serialized `role:"placement"`) | §1.1: role rename in serialized anchors | Regenerate fixture — **§6.4 omits ssr-render.*** |
| `demo/feature-showcase.js:251-257,579-582` | placement badge via derived `{ $: 'placement' }` reading the `'placement'` anchor | §2.3: per-path read; role rename | Update — **§6.4 omits feature-showcase.js** |
| `demo/fork-stress-fixture.js:160-176` + `demo/fork-stress.js:144-163,501-508` | RUNTIME page placement anchors (`role === 'placement'`) | §1.1: rename (page itself KEPT per §9-Q4) | Role rename only |
| `demo/index.html:44,76-96` | demo index describes the data-driven variants as clone-based | §5.1: static page added alongside | Index update — **§6.4 omits index.html** |
| `demo/fork-stress-data-*.html` (12 pages) | embedded envelopes: handler-declared prototypes, `stress:kind` labels | §5.1: runtime pages kept; NEW static page(s) added | Add static pages (listed via builder) |

### 10.5 Wording-collision list — the `content` ROLE vs existing uses

Q1's naming note (line 561) is confirmed as a real collision surface. The
`'content'` role (anchor context) collides with at least five existing
meanings; the consistency pass found NO case where the anchor-context role
is genuinely ambiguous (role values appear only in `role:` positions), but
every reader-facing document must be checked for wording drift:

1. **The node `content` field** — `NodeBaseData.content`, compiled
   `cs.content`, `LegacyNodeData.content`, render text (`emitOne`/`scalarBinding`
   read `s.content`; render-helpers.ts:338-340), handlers.md §2.1 getters
   (`getNode(id).content`), derived-state.md `content` root (derived.ts:166-167).
2. **The legacy `content` TARGET PATH** — translate.md §2.1 vocabulary table
   (`content` slot target — scalar string or `NodeData`; the "slot" injection
   family), and `css.content`-style derived-key patterns in demos
   (translate-stress-scenarios.md:988 — "`content` … is just a key").
3. **The legacy envelope `content` array** — `LegacyInitialData.content:
   ContentPayload[]`, and `TranslatedTree.content` (the UNPLACED content node
   array — translate.ts:125; payload.md lifecycle; FRESH-CONTEXT-SUMMARY.md:55).
4. **The `'contentNodes'` permanent-owner token** — one word away from the
   role name; `AnchorTarget.'contentNodes'` (node.ts:61, serialize.ts:11,
   registry.ts:61). Docs MUST write `'content'`-role anchor vs the
   `'contentNodes'` token explicitly when both appear (e.g. §1.1 SI-3 rewrite).
5. **Placement names literally named "content"** — `demo/feature-matrix-fixture.js:167`
   (`placement: { placementName: 'content' }`): a zone NAMED 'content' produces
   anchors `{ role: 'content', target: 'content' }` and
   `{ role: 'container', target: 'content' }` — readable but confusing in
   dumps; document the disambiguation (role namespace vs name namespace, per
   the Q1 note).
6. **Legacy PlacementWorker terminology** — RENDER_PROCESS_NOTES.md:152-157
   calls the consumer side "content requests" (`sourcePlacements` vs content
   `targetPlacement`) — the legacy pairing of the word "content" with the
   consumer side is the AUDIT basis of the role name; the DECIDED ledger and
   §10.8.2 rewrites must note that `'content'`-role == legacy consumer side.

No `css.content`-style literal usages were found beyond the derived-key
pattern in (2); the risk is prose-level, so the docs sweep must grep for the
bare word "content" near "anchor"/"role" in every rewritten section.

### 10.6 E2E-encoding check (spec §0 vs the sections)

| E2E | Encoded where | Verdict |
| --- | --- | --- |
| E2E-1 | §2 (path enumeration over 23 nodes), §5 (page re-expression + §5.2 census), §6.3 T (static fork census: registered=23, states=2^12−1, cloneOps=0) | **Encoded.** Note: §5.1's 4095 bijection relies on R2.2's sibling-shared owner-name topology — §5.1 states it. |
| E2E-2 | §3.1 (node-local invalidation; compile-scope + wire-identity assertions), §4.1 (element reuse by stable wires), §6.3 T | **Encoded, ONE GAP:** the fixture node is an UNPLACED prototype in the static tree, and the state-slice in-tree gate (`supervisor.ts:332-335`, ops.md §4 step 3, api.md §1 rule 4) rejects any mutation on it with `no-usable-state`. The spec never states the gate's fate under path-viability (re-key to path-viability, or fixture on an in-tree node). Must be resolved before the E2E-2 case can be written (TDD block). |
| E2E-3 | §3.2 (per-name component-Link affected set; all-consumers pressure fixture + half-consumers precision case), §6.3 T | **Encoded.** Note §9-Q8 (path-only resolution) interacts: the E2E-3 fixture must be re-verified against path-only visibility — the spec flags this itself (Q8 row). |
| E2E-4 | §3.3 (placement-add affected set: immediate parent + added node), §9-Q2 (placement-attach op, dirty set = container + added node), §6.3 T | **Encoded.** |

Verdict: the §0 table's "Encoded in" column is accurate; the only
encoding-level gap is E2E-2's interaction with the S1.1 apply gate (10.2
supervisor.ts:332-335 row), which the draft must close before the E2E unit
can be delegated (AGENTS.md item 7).

### 10.7 Draft §6 inventory completeness verdict

The §6 inventory (specs/code/tests/demos/emit-prerequisite) is a good
first pass but **INCOMPLETE**. Missing surfaces found by this sweep:

- **Specs:** `api.md` §7 W2/W3 (per-path events — Q3 is decided but its §7
  surface is unlisted); `api.md` §1.2 T2/T3 rows (viability carve-out);
  `graph.md` (whole doc — role union, canonical-shape table row at :105);
  `validation.md` (Role union); `payload.md` (R-2 reverse emission + removal
  semantics); `designing-pages.md` §3/§5/§8 (only §11/§12 listed);
  `RENDER_PROCESS_NOTES.md` §10.8.3 + the §10.10.4 DECIDED revision;
  `FRESH-CONTEXT-SUMMARY.md` (entire file); `AGENTS.md` item-4 wording;
  `docs/test-findings.md` specific supersession records (scenario-10 P3
  verdict, blind-test #2 scenario-7 `targetPlacement` round-trip claim);
  `docs/session-defect-review.md` runtime-vs-static re-baseline note;
  `docs/specs/state-first-analysis.md` P3 note + §4 census;
  `docs/specs/path-fork-review.md` supersession banner;
  `scripts/stress-probes/RESULTS.md` + `scripts/translate-stress-probes/
  RESULTS.md` supersession records.
- **Code:** `src/core/events.ts` (W2 coalescing re-key); `src/core/derived.ts`
  (per-path `placement` root — in §2.3 prose but NOT the §6.2 table);
  `src/core/supervisor.ts:271-278` (event-filter lift) + `:275` (`#f` gate) +
  `:332-335` (S1.1 apply gate vs E2E-2); `src/core/pipeline.ts:78-79`
  (registry summaries); `src/core/serialize.ts:117` (roleOrder);
  `src/core/node.ts:186,788-793` (link-kind mapping).
- **Tests:** `graph.test.ts`, `derived.test.ts`, `reverse.test.ts`,
  `validation.test.ts`, integration `api.test.ts`/`supervisor.test.ts`,
  e2e `legacy-bootstrap`/`ssr-render`/`ssr-html-validity`, `payload.test.ts`,
  `stress-probes/RESULTS.md`.
- **Demos/smoke:** `demo/components.js`, `demo/feature-matrix-fixture.js`,
  `demo/ssr-render.*`, `demo/feature-showcase.js` (role rename), the runtime
  `fork-stress.js`/`fork-stress-fixture.js` (role rename only), `demo/index.html`.

Also unlisted as an inventory item: the E2E-2 apply-gate question (10.6) —
it is a spec-content gap, not a surface inventory gap.

**Count by category:** Docs 58, Code 35, Tests 22, Demos/smoke 14 (plus
this §10.5/§10.6/§10.7 checks). These counts count table rows, not
distinct files; many rows are annotations on already-listed surfaces.

### 10.x Resolutions (user review round 1) — decided fixes to §10 conflicts

- **api.md:98,103 — viability rule (RESOLVED):** a node is viable output iff
  it can reach root through PARENT or PLACEMENT links only. An unplaced
  node in `contentNodes` is not reachable — UNLESS a component has added it
  as a child, which is technically possible but an ANTI-PATTERN (should not
  be a plausible state given how components operate; documented, not
  aggressively guarded). The spec's viability text states both halves.
- **translate.md:161-163 — activePlacement (RESOLVED):** `activePlacement`
  is DERIVED from the `targetPlacement` list and the available placement
  containers: the first link in the array that has any containers. Content
  nodes require placement by default — they have no inherent visibility of
  root (consistent with §1.2 preference-order and §2.4 viability).
- **render.md:166 — unplaced definition (RESOLVED):** if a node has a
  valid placement path that can be followed to root, it is NOT unplaced by
  definition. `unplaced` = no valid path to root via parent OR placement
  links.
- **designing-pages.md:60-61,73 — `#<i>` survives for COMPONENT forks
  (RESOLVED):** yes. Component resolution is bound to the ANCESTOR PATH —
  component arms occur at the same graph position (same path), so their
  discriminator stays the positional `#<i>` within the path; PLACEMENT
  multiplicity is path-keyed (pathKey wires). Combined identity =
  `pathKey` + `#<i>` (arm suffix within the path). The FRK-H2 tension is
  pinned: `#<i>` survives for component forks; placement paths are
  path-keyed.
- **§10.5 wording collisions (DECISION PROPOSED — user requested name
  changes):** the `content` role vs the content value/array/owner/target-
  path uses. Recommended: keep `'container'` / `'content'` (legacy
  vocabulary; the role is a quoted union token in its own namespace) and
  add a DISAMBIGUATION CONVENTION: role tokens always quoted+backticked
  (`'content'` role); prose distinguishes "the content role" from "the
  content value / the content[] array / the contentNodes owner / the
  legacy content target path"; the six collision sites get a shared
  terminology note (designing-pages.md §1 glossary + each affected spec's
  terminology line). ALTERNATIVE (if a hard rename is preferred): the
  consumer role becomes `'placement-content'` (unambiguous, loses the
  clean Q1 pairing). The recommended convention is applied below pending
  user confirmation.

### 10.y Re-analysis (round 2)

Re-analysis agent output (READ-ONLY; READ-ONLY sweep re-verified the five
§10.x user resolutions against the repo, re-swept the unresolved §10 rows,
and swept the resolution/new-spec language for new conflicts). Line numbers
as of this pass. This section is the only edit.

#### 10.y.1 Five-resolution verification table (task A)

| # | Resolution | Verdict | Evidence (file:line) | Remaining conflict surface |
| --- | --- | --- | --- | --- |
| 1 | Viability: reachable to root via parent/placement links = viable; component-attached contentNodes child = anti-pattern, documented, not guarded | **CONSISTENT with compile behavior; two labeling tensions** | `node.ts:589-603` (selfProviding branch — `placementRouted` sibling is additive, no conflict); `node.ts:581-584` (token≠rootNode ⇒ dropped owner-terminated — a component/contentNodes-terminated chain is ALREADY non-viable, the anti-pattern is de-facto dropped, no guard to add — matches "not guarded"); attach executors have no contentNodes guard (`ops.ts:29-56`, `supervisor.ts:351-364` — only findCycle + single-parent); tests construct the anti-pattern state directly (`tests/unit/node.test.ts:475,615,957`; `tests/unit/graph.test.ts:433`; `tests/unit/render.test.ts:579`) | (i) `node.ts:213` classifies a parent target of the `'contentNodes'` TOKEN as `'in-tree'` while compile drops the same node owner-terminated (`node.ts:581-584`) — "reachable" must be pinned as COMPILE viability, not `node.state`; (ii) the "contentNodes owner" is `registry.ts:19-30` (the prompt's `node.ts:120-125` cite is the pass-1 field block, not the owner — cite correction); (iii) §2.4 states the path half; the anti-pattern half appears only in §2.1's termination pseudo-code — resolution's "the spec's viability text states both halves" is true only implicitly |
| 2 | activePlacement: derived — first link in the targetPlacement array with any containers; content nodes require placement by default | **CONSISTENT** | `translate.ts:49-53` `LegacyPlacementConfig { targetPlacement?: string; activePlacement?: boolean }` — the `string[]`/`string` fix is the resolution's premise (code confirms the current mis-types); `translate.ts:440-444,488-491` (warn treats targetPlacement as string — the feed is dead today); derived-never-authored is consistent with the state-slice block (`supervisor.ts:327-331`, `ops.ts:21-27`) and api.md §3.3; legacy phase-1 record cited at RENDER_PROCESS_NOTES.md:156 (`TargetPlacementResolverWorker` sets activePlacement) | Legacy cites (`PlacementWorker.ts:29-37`, `TargetPlacementResolverWorker.ts:28-35`, `Placement.ts:44-57,96-105`, `NodeSchema.ts:22-24`) are NOT in this repo (no `Preempt/` dir) — provenance-level only, not re-verifiable here |
| 3 | unplaced = no valid path to root via parent OR placement links; placement path to root ⇒ NOT unplaced | **CONFLICTS** (see C-1) | `node.ts:200-224` `state`/`stateFrom`: family-only walk, ZERO placement awareness; `types.ts:74` `NodeState = 'prototype'\|'unplaced'\|'in-tree'\|'destroyed'` — no member for "placement-routed-not-unplaced"; §2.4's own text ("the NODE's derived state (unplaced) is untouched; viability is a property of the PATH") contradicts the resolution verbatim; §5.2 census `unplaced = 22` (all 22 prototypes) is unreconcilable with the new definition (level≥2 prototypes have placement paths ⇒ non-unplaced); `supervisor.ts:332-335` gate (`nodeState !== 'in-tree'`) — the E2E-2 fixture question (§10.6) is NOT answered by this resolution | Needs a user decision: (a) stateFrom/chainRoot walk placement edges ⇒ node.state becomes placement-aware (new §6 inventory: node.ts:207-224 + gate re-key) and §2.4's "label stays honest" text dies; or (b) keep node.state family-derived and reword the resolution to "path-viable, not node-state-unplaced" |
| 4 | `#<i>` survives for COMPONENT forks (same path, positional within the path); placement multiplicity path-keyed; combined identity = pathKey + `#<i>` | **COHERENT only under an unstated constraint** | `render-helpers.ts:210-215` armWires `<nodeId>#<i>` + `:297` wire `nodeId#armIdx` (today's positional scheme — the resolution's premise is accurate); `resolve.ts:232-237` emits `#f:<ownerId>#<i>`; `node.ts:699-706` `cs.pathKey = node.pathKey + arm.keys.join('')`, `cs.forkKey = cs.pathKey` — the REAL combined identity is `pathKey + '#f:<ownerId>#<i>'`, not bare `pathKey + #<i>` (spec §4.2's `#<i>` shorthand should be corrected) | (i) placement hops routed through `resolveArms`/`continueArm` inherit `#f:<ownerId>#<i>` keys — a placement fork with owner O and a component fork with owner O on the SAME node produce IDENTICAL keys (`pathKey+'#f:o#0'`) for different arms ⇒ collision; placement hops MUST emit pathKey segments, never `#f:` keys (constraint absent from §2.2/§6.2 resolve row); (ii) the cross-path collision question ("placement path vs component arm of a DIFFERENT path") is safe ONLY because arm suffixes start with `#` and pathKey segments (minted ids `node-<n>`, `node.ts:27-31`) never contain it — but USER-authored zone names (`translate.ts:435-437`, verbatim) and authored ids (`node.ts:143` `data.id`) are unvalidated; a zone named `x#f:o#0` forges the suffix (see C-5) |
| 5 | Wording convention: quoted+backticked role tokens, prose disambiguation, glossary note; hard rename `placement-content` pending | **ALL SIX COLLISION SITES CONFIRMED; convention has no code conflict** | (1) node content field: `translate.ts:79`, `node.ts:150/156` pass1, `render-helpers.ts:338-340`; (2) translate.md §2.1 `content` slot target path: translate.md:178; (3) envelope `content` array: `translate.ts:116` `LegacyInitialData.content`, `:125` `TranslatedTree.content`; (4) `contentNodes` token+owner: `types.ts:9`, `serialize.ts:11`, `registry.ts:19-30`, `node.ts:52,178,213`; (5) zone literally named 'content': `demo/feature-matrix-fixture.js:167,173`; (6) legacy "content requests": RENDER_PROCESS_NOTES.md:154-157 | The convention is prose-level only — no code surface conflicts; the only code-adjacent wrinkle is `serialize.ts:117` `roleOrder` (placement:5) which must add `container`/`content` ordering under either option; the hard-rename alternative stays pending user confirmation |

#### 10.y.2 Delta list — every §10 row re-classified (task B)

Verdicts: **SUPERSEDED** (a §10.x resolution supplies the fix), **PARTIALLY-
RESOLVED** (resolution informs/decides part; the row's surface work remains),
**STILL-OPEN**, **NO CHANGE** (row already concluded). Row counts corrected
vs §10.7: the actual tables hold **89 doc / 41 code / 23 test / 12 demo**
rows (the §10.7 "58/35/22/14" counts are wrong — see C-9).

**10.1 DOCS (89 rows):**

| Rows (10.1) | Verdict | Note |
| --- | --- | --- |
| api.md:98,103 | PARTIALLY-RESOLVED | Resolution 1 supplies the carve-out semantics; the §1.2 T2/T3 table rows + the "reachable vs node.ts:213 in-tree label" note remain |
| api.md:256-259, 267, 268 | STILL-OPEN | Role rename / P3 / P4 rewrite (Q1/Q2 decided in §9, not among the five) |
| api.md:289 (F2) | PARTIALLY-RESOLVED | Resolution 4 pins forkKey-on-every-path-state + combined identity; F2 wording rewrite remains |
| api.md:318-319 (W2/W3) | STILL-OPEN | Q3 decided in §9; now ALSO blocked by the C-6 `#f`-gate finding |
| translate.md:48-49 | SUPERSEDED | Resolution 2: `targetPlacement: string[]`, `activePlacement: string` (derived) — the type fix |
| translate.md:148, 253-254, 262-264, 395, 403, 412, 354-377 | STILL-OPEN | (262-264 anti-patterns bullet: resolution 2's "require placement by default" is adjacent but does not rewrite it) |
| translate.md:158-159 | PARTIALLY-RESOLVED | Resolution 2 fixes activePlacement's fate (derived read, never authored → stays out of the ignore list, emitted on reverse); the ignore-list wording remains |
| translate.md:161-163 | SUPERSEDED | Resolution 2's text ("content nodes require placement by default…") is the row's fix verbatim — CAVEAT: re-check against resolution 3 (C-1) before finalizing |
| translate.md:409 (TR-H9) | SUPERSEDED | Resolution 1's placement-path viability |
| node.md:44 (SI-3) | PARTIALLY-RESOLVED | Resolution 5's convention decided (quoted+backticked role vs `contentNodes` token); the SI-3 rewrite remains |
| node.md:72, 92, 100, 323, 339-344, 377, 380 | STILL-OPEN | Union / pathKey / children / §8.2 / scope / FS-7 / FS-10 |
| node.md:327-337 (§8.3) | PARTIALLY-RESOLVED | Resolution 4 decides the #<i>-vs-pathKey split; the §8.3 wording remains |
| node.md:371 (FS-1) | SUPERSEDED | Resolution 1 (placement-path-to-root ⇒ viable) |
| pipeline.md:67, 68, 145-147/157-163, 308, 384 | STILL-OPEN | Stage rewrites / third scope / rebuild sentence / F14 row |
| pipeline.md:124, 380 | SUPERSEDED | Resolution 1 (DropReason note + F10 carve-out) |
| render.md:68-71,83,173 | PARTIALLY-RESOLVED | Resolution 4: forkKey canonical on every path-state |
| render.md:97-99, 116-140 | STILL-OPEN | DEFECT #1 prerequisite / third-scope §4 |
| render.md:166 | PARTIALLY-RESOLVED | Resolution 3 addresses it — but resolution 3 CONFLICTS with §2.4/node.state (§10.y.1 #3, C-1); the exception sentence cannot be written until the user picks (a) or (b) |
| render.md:197-209 | PARTIALLY-RESOLVED | Resolution 4 decides the leaves-by-fiat / #<i> framing; §6 rewrite remains |
| render.md:260 (NVS-3) | SUPERSEDED | Resolution 1 (placement-routed unplaced nodes render) |
| render.md:288-298 (FRK matrix) | PARTIALLY-RESOLVED | Resolution 4 pins the FRK-H2 tension; matrix rows remain |
| derived-state.md:97-100, 98/225-261 | STILL-OPEN | Per-path placement root / children.length |
| ops.md:13, 72-76, 89-90, 154 | STILL-OPEN | Q2 decided in §9 but surfaces remain |
| ops.md:128, 198 (G9) | SUPERSEDED | Resolution 1 — caveat: the apply-gate/E2E-2 interplay (§10.6) stays open (C-7) |
| contract.md:39, 148 | STILL-OPEN | Role union + DEFAULT_PLACEMENT |
| graph.md:29-32,40; 105 | STILL-OPEN | Union + canonical-shape row (still unlisted in §6.1) |
| validation.md:56,50,132 | STILL-OPEN | Union + prose (unlisted in §6.1) |
| payload.md:64, 16-18,75 | STILL-OPEN | R-2 reverse + removal semantics (unlisted) |
| RENDER_PROCESS_NOTES.md:534, 548, 565, 464, 466/501, 476, 619-630 | STILL-OPEN | S3.6/S-R2.8/S-R3.9/§10.8.2/§10.8.2-fork/§10.8.3/§10.10.1 |
| RENDER_PROCESS_NOTES.md:694-702 (§10.10.4) | PARTIALLY-RESOLVED | Resolution 1 grows the `placementRouted` branch; the DECIDED revision remains + must absorb the resolution-3 decision (C-1) |
| designing-pages.md:52-55 (§3) | PARTIALLY-RESOLVED | Resolutions 1+2 supply the viability + default-placement halves; §3 rewrite remains |
| designing-pages.md:60-61,73 | SUPERSEDED | Resolution 4 verbatim (the FRK-H2 pin) |
| designing-pages.md:91-114, 162-180, 246-249, 309-317/349-351 | STILL-OPEN | §5 / §8 / §11 / §12 |
| fork-stress.md:163-188; fork-stress-data.md:7-36 | STILL-OPEN | Static-vs-runtime rewrites |
| test-findings.md:422, 432-460, 34, 41-42, 209-211/299-311 | STILL-OPEN | Supersession records / DEFECT #1 / round-trip claims / re-baseline |
| session-defect-review.md:440-444, 486-495 | STILL-OPEN | Runtime-vs-static numbers / "the Rule" wording |
| legacy-component-ref-only-review.md:433 | PARTIALLY-RESOLVED | Resolution 2 = the feed semantics; NP13 disposition annotation remains |
| legacy-component-ref-only-review.md:494-495 | SUPERSEDED | Resolution 2 replaces the interim keep-unplaced+warn |
| legacy-component-ref-only-review.md:531 | STILL-OPEN | Registry-row annotation |
| path-fork-review.md:222-228,272-277 | STILL-OPEN | Supersession banner |
| state-first-analysis.md:134-138, 177-197, 266/280/303 | STILL-OPEN | P3 note / census / resolved marks |
| FRESH-CONTEXT-SUMMARY.md; AGENTS.md:29-35; framework-feature-summary.md:42 | STILL-OPEN | Refresh / ratio reconciliation (2.5× demo-smoke.mjs:291 vs ~1.5× AGENTS; stress-probes/RESULTS.md:217-218) / verify-after-land |

**10.2 CODE (41 rows):**

| Rows (10.2) | Verdict | Note |
| --- | --- | --- |
| types.ts:8, 88/106; link.ts:23-26, 28-32; translate.ts:133-146; node.ts:186/788-793, 300-316, 512-562, 623-638, 658-663, 861-871; supervisor.ts:246-258, 271-278, 351-364; ops.ts:29-56, 71-108; render-helpers.ts:236-243/349-350, 292-297, 309, 341-347, 36-38, 127-138; serialize.ts:117; derived.ts:32/172-175; events.ts:68-74; pipeline.ts:78-79; supervisor.ts:326-331, ops.ts:21-27, derived.ts:163-191, adapters.ts:51-60/201-258 | STILL-OPEN / NO CHANGE | Unaffected by the five; NO CHANGE rows: link.ts:79-85, supervisor.ts:326-331, ops.ts:21-27, derived.ts:163-191, adapters.ts (5 rows) |
| types.ts:126-133 (forkKey/children) | PARTIALLY-RESOLVED | Resolution 4: forkKey on every path-state + combined identity decided; type-note rewrite remains |
| translate.ts:49-53 | SUPERSEDED | Resolution 2 (the type fix) |
| translate.ts:440-444/488-491 | PARTIALLY-RESOLVED | Resolution 2 supplies the derived-record semantics; minting implementation + warn removal remain |
| translate.ts:557-641 (reverse) | PARTIALLY-RESOLVED | Resolution 2: derived `activePlacement` read emission decided; reverse rows remain |
| node.ts:564-605 (viability) | PARTIALLY-RESOLVED | Resolution 1 decides the `placementRouted` branch; implementation + the node.ts:213 in-tree-vs-drop labeling tension remain |
| resolve.ts:31-40/55-84/152-156/205-244 | PARTIALLY-RESOLVED | Resolution 4 pins path-keyed placement multiplicity ⇒ placement hops must NOT emit `#f:` keys (new constraint, C-3); enumeration/preference-loop work remains |
| supervisor.ts:275 (`#f` gate) | STILL-OPEN + NEW conflict | PathKeys lack `#f` ⇒ fork payload suppressed ⇒ Q3's per-path events collapse (C-6) |
| supervisor.ts:332-335 (S1.1 apply gate) | STILL-OPEN + NEW conflict | Resolution 3's "not unplaced" has no NodeState home; gate + E2E-2 question sharpened (C-1/C-7) |
| render-helpers.ts:210-215 (armWires) | PARTIALLY-RESOLVED | Resolution 4 pins #<i> scope; armWires re-expression for path-states remains |

**10.3 TESTS (23 rows):**

| Rows (10.3) | Verdict | Note |
| --- | --- | --- |
| translate.test.ts:505-525, 658-663, 765-771; node.test.ts:1132, 850-853; derived.test.ts:65-98; graph.test.ts:281-297; ops.test.ts:253-260; validation.test.ts:412-414; payload.test.ts:58-76; pipeline.test.ts:12-13/172, 557-560; api.test.ts:228-239/402-433; supervisor.test.ts:73-79; legacy-bootstrap.test.ts:90/120-124; ssr-render.test.ts:135-136/263-275; ssr-html-validity.test.ts:46-47/112; stress-probes/RESULTS.md:118-125, 84-96; fork-stress-data.test.ts:6-46; adapters.test.ts:283-304 | STILL-OPEN / NO CHANGE | Unaffected by the five; NO CHANGE rows: node.test.ts:850-853, pipeline.test.ts:557-560 (2 rows) |
| reverse.test.ts:42-72 | PARTIALLY-RESOLVED | Resolution 2: derived activePlacement + `content`-anchor→array round-trip decided; test case remains |
| render.test.ts:608-621 | PARTIALLY-RESOLVED | Resolution 4: pathKey-wire rows + #<i>-survives-for-components decided; extension remains |

**10.4 DEMOS / SMOKE (12 rows):**

| Rows (10.4) | Verdict | Note |
| --- | --- | --- |
| fork-stress-data.js:407-425 | STILL-OPEN + NEW interaction | Resolution 3 changes the `unplaced = 22` census meaning (C-1) |
| fork-stress-data.js:592-618; demo-smoke.mjs:192-223, 284-295; fork-stress-data-page.mjs; components.js:220-233/251/374-375; ssr-render.template.html:40/52 + ssr-render.html:21-22; feature-showcase.js:251-257/579-582; fork-stress-fixture.js:160-176 + fork-stress.js:144-163/501-508; index.html:44/76-96; fork-stress-data-*.html | STILL-OPEN | Unaffected |
| feature-matrix-fixture.js:167-184/217-225 | PARTIALLY-RESOLVED | Resolution 5's collision #5 verbatim (zone named 'content'); the container-role rename + placement-attach semantics remain |

**10.5/10.6/10.7:** §10.5 wording-collision list — SUPERSEDED by resolution 5
(convention recommended; `placement-content` rename still pending user
confirmation). §10.6 E2E-encoding — E2E-1/3/4 unchanged; the **E2E-2 apply-
gate gap STILL OPEN** and sharpened by resolution 3 (C-1/C-7). §10.7
inventory-gap list — STILL OPEN, plus the count correction (C-9).

#### 10.y.3 New-conflict list (task C)

| # | New conflict | Evidence | Severity |
| --- | --- | --- | --- |
| C-1 | **Resolution 3 ("placement path to root ⇒ NOT unplaced") contradicts the spec's own §2.4** ("the NODE's derived state (unplaced) is untouched; viability is a property of the PATH"), the code's family-only `state`/`stateFrom` (`node.ts:200-224`), the `NodeState` union (`types.ts:74` — no placement-aware member), and the §5.2 census (`unplaced = 22`). It also fails to resolve the §10.6 E2E-2 question (`supervisor.ts:332-335` gate). | spec §2.4 vs §10.x#3; node.ts:200-224; types.ts:74; §5.2 | **BLOCKING** — needs a user decision (stateFrom placement-walk + union/gate change, or reword to "path-viable") |
| C-2 | **Silent-abort (§1.2) has no code home**: supervisor recompiles every dirty node unconditionally and re-emits per tick (`supervisor.ts:246-295`); events dedupe is within-tick only (`events.ts:68-74`); render-side element reuse (`diffMinimal`) is not a compile abort. The §6 inventory lists no mechanism (affected-set-empty vs compile-side no-op). | supervisor.ts:246-295; events.ts:68-74; §6.2 supervisor row | HIGH — new mechanism or explicit §3.3 affected-set rule |
| C-3 | **"Every zone of the chosen name" fan-out vs `resolveArms` machinery**: `continueArm` forks per owner with `#f:<ownerId>#<i>` keys (`resolve.ts:220-237`) — reuse for placement hops would (i) leak `#f:` into pathKeys (violates §2.2's zone-name interleave + resolution 4), and (ii) COLLIDE with a component-arm suffix of the same node+owner (`pathKey+'#f:o#0'` twice). Also `providersOn` matches source/duplex only (`resolve.ts:31-40`) — container anchors need a parallel enumeration; and the first-match skip/never-consult semantics have no home in `resolveNames` (`resolve.ts:172-199` binds ALL names; a no-match name becomes unresolved at `resolve.ts:213-215`). | resolve.ts:31-40, 172-255; §1.2/§2.2/§6.2 | HIGH — constraint must be stated ("placement hops emit pathKey segments, never `#f:` keys") |
| C-4 | **§1.2 self-contradiction (stale audit bullet)**: "a name that matches NO zone … unresolved for that name — the node's OTHER names still fork" contradicts the first-match rule (no-match names are skipped; names after the chosen are never consulted; a whole-array miss ⇒ nothing forks). Remnant of the rejected every-matched-zone reading (Q5). | spec §1.2 lines 128-133 | MEDIUM — delete/rewrite the bullet |
| C-5 | **PathKey+`#<i>` identity vs unvalidated `#` in authored names**: minted ids are safe (`node.ts:27-31` `node-<n>`), but zone names (`translate.ts:435-437` verbatim `placementName`) and authored ids (`node.ts:143` `data.id`) can contain `#` — a zone named `x#f:o#0` forges an arm suffix (cross-path key collision) and trips the supervisor `#f` gate (`supervisor.ts:275`). Needs a stated '#'-free constraint + translate-time K4 validation, or a different separator. | node.ts:143, 27-31; translate.ts:433-438; supervisor.ts:275 | MEDIUM |
| C-6 | **Q3 per-path events collapse at the emit site**: pathKey-based wires contain no `#f`, so `supervisor.ts:275` yields `fork: undefined` for every path-state ⇒ the events.ts W2 key (`nodeId + ''`) coalesces ALL path-states of one node to one event (last-write-wins) — the per-path stream Q3 promises never materializes. Gate must be re-expressed ("path-state ⇒ fork payload"). | supervisor.ts:271-278; events.ts:69-72; §9-Q3 | MEDIUM — Q3 text presupposes it; round-1 row 10.2 `:275` flagged it, the resolution text still doesn't state it |
| C-7 | **Anti-pattern viability vs the state-slice gate**: consistent for component-attached children (state prototype/unplaced ⇒ gate rejects, `supervisor.ts:332-335`) — but the `'contentNodes'`-TOKEN parent is `'in-tree'` per `node.ts:213` (state-slice PASSES) while compile drops the node owner-terminated (`node.ts:581-584`). Resolution 1's "not reachable" wording must acknowledge state-in-tree ≠ compile viability. | node.ts:213 vs node.ts:581-584; supervisor.ts:332-335 | LOW-MEDIUM |
| C-8 | **Legacy citations unverifiable**: `Preempt/` source is absent from the repo; `PlacementWorker.ts:29-37`, `TargetPlacementResolverWorker.ts:28-35`, `Placement.ts:44-57/96-105`, `NodeSchema.ts:22-24` remain provenance-level. | repo layout | LOW — record-keeping |
| C-9 | **§10.7 counts wrong**: actual tables hold 89 doc / 41 code / 23 test / 12 demo rows, not "58/35/22/14". | §10.1-§10.4 row counts | LOW — fix the count line |

#### 10.y.4 Round-2 open questions for user review

| # | Question | Options / notes |
| --- | --- | --- |
| R2-Q1 | **Resolution 3 vs §2.4/node.state** (C-1, blocking): redefine `unplaced` for real (stateFrom/chainRoot walk placement edges; `NodeState` + the apply gate follow; §5.2 census becomes ~2) or keep node.state family-derived and reword the resolution to "path-viable" (label stays honest; E2E-2 fixture then needs the §10.6 gate answer anyway)? |
| R2-Q2 | **Silent-abort mechanism** (C-2): affected-set-empty derivation (§3.3 gains the container-appear/disappear row) or a compile-side no-op detection? The §6 supervisor row must list it. |
| R2-Q3 | **Placement arm keys** (C-3): confirm "placement hops emit pathKey segments, never `#f:` keys" as an explicit §2.2/§6.2 constraint; where does the preference-ordered resolution loop live (new resolveNames variant)? |
| R2-Q4 | **`#`-freedom** (C-5): ban `#` in `placementName`/authored ids at translate (K4 warn) or document the separator constraint? |
| R2-Q5 | **Supervisor `#f` gate** (C-6): confirm re-expression to "every path-state emits fork payload {forkKey: pathKey, nodeIds: trace}" so Q3's per-path events actually emit. |
| R2-Q6 | **node.ts:213 `'contentNodes'`-token 'in-tree' classification** (C-7): keep (document as the anti-pattern half) or align `state` with the compile drop? |
| R2-Q7 | **§1.2 stale bullet** (lines 128-133, C-4): delete or rewrite under first-match semantics? |
| R2-Q8 | **§10.7 counts** (C-9): confirm the corrected 89/41/23/12 and re-state the inventory verdict. |

### 10.z User review (round 2) — resolutions + elaborations

- **C-2 RESOLVED — silent abort homes in the compiler entry:** the update
  trigger identity (which placement link changed) is passed INTO the
  compiler with the dirty mark. The compiler checks relevance per affected
  node — can the changed link alter that node's first-match preference
  choice? If the changed link is less-favored and cannot change the chosen
  name, the compile aborts silently (no state regeneration, no events).
  The supervisor's unconditional recompile (supervisor.ts:246-295) gains
  the relevance pre-check; `supervisor.apply` passes the trigger identity
  (`{ kind: 'placement', linkName, direction: 'container-added' | ... }`)
  on placement-affecting ops.
- **C-3 RESOLVED — fan-out is the targetPlacement TRANSLATION ordering:
  placement anchors stay ORDERED per node.** A node stores its anchors;
  the `content` anchors minted from `targetPlacement: string[]` are kept
  in an ORDERED structure (an array in preference order — the anchor set
  is not order-preserving today). First-match-with-known-container is then
  determinable from the node's own ordered list + the per-name Link
  membership; the per-name Link stays the shared registry. The fan-out
  (every zone of the chosen name) reads the Link's container anchors for
  that name.
- **C-8 RESOLVED — legacy citations are reference-only:** the legacy
  codebase has KNOWN BUGS — that is the cause of the rebuild. Legacy
  behavior is intent-with-known-bugs, never ground truth; the spec does
  not defer to legacy quirks (e.g., the worker `break` is preference
  semantics, not a bug to replicate blindly; the audit's every-zone fan-out
  stands per Q5).
- **C-9 RESOLVED — count corrections:** the round-1 totals are corrected
  to **89 docs / 41 code / 23 tests / 12 demos rows** (§10.y C-9/R2-Q8);
  the corrected numbers are canonical.
- **R2-Q4 answered — what `#<i>` adds to the ancestor tree:** nothing in
  the tree itself. Component arms occur at the SAME ancestor position
  (same path); the `#<i>` suffix is the provider-arm discriminator
  ORTHOGONAL to the ancestor tree. Placement multiplicity is expressed IN
  the tree (different paths). Combined identity = pathKey +
  `#f:<ownerId>#<i>` (arm within the path). Remaining open: `#`
  validation in authored zone names/ids (R2-Q2).
- **R2-Q1 PENDING — the unplaced/node.state decision** (explanation in
  the review thread; the decision itself awaits user confirmation):
  see R2-Q1 below.

### 10.aa User review (round 3) — resolutions with code verification

- **R2-Q1 RESOLVED — option (b) accepted + contentNodes clarification:**
  the spec rewrites the unplaced/viability wording to a COMPILE
  predicate ("path-viable ⇒ compiles/renders") without touching the state
  machine. AND: placement-dependent nodes produced from server data are
  family-'in-tree' anyway under the current `stateFrom` classification —
  the `'contentNodes'` owner token is labeled in-tree (node.ts:213).
  Consequence for the census: the static fork's 23 nodes (22 prototypes +
  root) are ALL in-tree (contentNodes-owned); the census counts
  `in-tree = 23`, `path-viable states = 4095`, and the round-1
  `unplaced = 22` item is superseded (the prototypes are never 'unplaced'
  — family-wise they live under contentNodes). The §2.4/§5.2 texts are
  updated accordingly in the next pass.
- **R2-Q4/#<i> RESOLVED — the ancestor tree fully determines resolution:**
  verified in `resolve.ts:140-160`: per name, the walk is
  `own → descendants → ancestors`, each phase returning on the first that
  finds providers (nearest-wins), with the node itself as phase 1 (duplex
  self-resolution). Two states with IDENTICAL ancestor trees (same node ⇒
  same own/descendants/ancestors) therefore resolve IDENTICALLY ⇒
  identical bindings ⇒ identical states. `#<i>` arms add nothing in the
  path model; the combined identity is **pathKey ALONE**. Arms exist only
  when MULTIPLE same-name source anchors sit on ONE node (`providersOn`
  returns >1) — blocked from legacy data by the K8 duplicate-reference
  guard, reachable only via imperative `addAnchor` (the feature-matrix
  panel case). `#<i>` survives as a documented RUNTIME-ANCHOR carve-out
  (FRK-H2), out of the legacy/path surface entirely.
- **R2-Q6 PARKED — event-gate re-expression returns once #<i> is
  resolved:** with identity = pathKey alone, the supervisor's `#f`-grammar
  gate (supervisor.ts:275) simplifies to "path-state ⇒ emit"; the detailed
  re-expression is deferred to the next pass (trigger: this resolution).
- **C-7 RESOLVED — anti-pattern re-stated:** the anti-pattern is giving a
  contentNode root visibility WITHOUT a placement (family-attached via
  unconventional handler logic). Since `stateFrom` labels contentNodes-
  owned nodes in-tree anyway (node.ts:213), no label tension remains: the
  node is in-tree (family fact) AND placement-routed (path-viable), or
  anomalously family-attached (the anti-pattern — documented, not
  guarded). Doc-level only, no code change.

### 10.ab User review (round 3, follow-up) — same-name multi-source anti-pattern

- **DECIDED: multiple same-name source anchors on ONE node is an
  unsupported anti-pattern in BOTH legacy and current.** Consequences:
  1. The `#<i>` runtime-anchor carve-out (§10.aa) is WITHDRAWN — the case
     it served (feature-matrix `panel`: two `addComponentSource(root,
     'panel', …)` anchors) is itself anti-patterned. In the path model the
     state identity is **pathKey alone**, unconditionally.
  2. K8 already blocks the case for legacy data (duplicate-reference
     guard on the binding array). The RUNTIME `addAnchor` path has no
     guard — the consistency pass adds one: a `component-source-duplicate`
     warn (or block) when a second same-name source anchor is added to a
     node that already carries one (imperative path; materializeAnchors
     dedup is not relied on).
  3. The feature-matrix `panel` fork demo is anti-patterned — the
     consistency pass must re-express it (two provider NODES in scope
     instead of two anchors on one node) or drop the fork claim; the
     round-trip check asserting `panelArms === 2` moves accordingly.
  4. Remaining legitimate multiplicity = multiple provider NODES (the
     documented "multiple nodes may share a referenceName" case — e.g.
     descendants at different depths). Under the R2-Q4 resolution these
     still resolve deterministically per path (the walk is a pure function
     of the tree) — pathKey identity unaffected.

### 10.ac Consistency sweep (round 3)

Consistency-pass agent output (round 3; READ-ONLY except this section).
Re-swept the repo against the FINAL accumulated spec (§1–§10.ab), verified
the eight §10.y open items against code, re-classified every §10.y row,
and swept the §10.z/aa/ab decision language for new conflicts. Line numbers
as of this pass (git HEAD b693dd5).

#### 10.ac.1 Delta table — round-2 §10.y rows re-classified

Verdicts: **STILL-OPEN** (surface work remains, no decision changed it),
**PARTIALLY-RESOLVED** (round-2/3 decision supplies the semantics; the
surface work remains), **SUPERSEDED** (decision is the fix verbatim),
**NO CHANGE** (already concluded).

**10.1 DOCS (42 §10.y rows):**

| §10.y row | Round-2 | Round-3 | Why |
| --- | --- | --- | --- |
| api.md:98,103 (viability + T2/T3 rows) | PARTIALLY | PARTIALLY | R2-Q1(b) + §10.aa fix the label question; rows remain |
| api.md:256-259, 267, 268 (§5 P1–P4) | STILL-OPEN | STILL-OPEN | unchanged |
| api.md:289 (F2) | PARTIALLY | PARTIALLY | pathKey-alone (§10.aa/ab) pins the wording; rewrite remains |
| api.md:318-319 (W2/W3 §7) | STILL-OPEN | **PARTIALLY** | R2-Q6 direction fixed ("path-state ⇒ emit"); §7 rewrite remains |
| translate.md:48-49 | SUPERSEDED | SUPERSEDED | type fix decided (R2-res2) |
| translate.md:148, 253-254, 262-264, 395, 403, 412, 354-377 | STILL-OPEN | STILL-OPEN | minting/reverse rows; C-3 ordered-array detail added |
| translate.md:158-159 | PARTIALLY | PARTIALLY | ignore-list wording remains |
| translate.md:161-163 | SUPERSEDED | SUPERSEDED | R2-res2 text; C-1 gone (R2-Q1(b)) |
| translate.md:409 (TR-H9) | SUPERSEDED | SUPERSEDED | resolution 1 |
| node.md:44 (SI-3) | PARTIALLY | PARTIALLY | convention decided; rewrite remains |
| node.md:72, 92, 100, 323, 339-344, 377, 380 | STILL-OPEN | STILL-OPEN | unchanged |
| node.md:327-337 (§8.3) | PARTIALLY | PARTIALLY | pathKey-alone wording |
| node.md:371 (FS-1) | SUPERSEDED | SUPERSEDED | resolution 1 |
| pipeline.md:67, 68, 145-147/157-163, 308, 384 | STILL-OPEN | STILL-OPEN | unchanged |
| pipeline.md:124, 380 | SUPERSEDED | SUPERSEDED | resolution 1 |
| render.md:68-71,83,173 (forkKey wording) | PARTIALLY | PARTIALLY | forkKey-always (10.ac.2 #2) — the "fork-arm only" wording is dead |
| render.md:97-99, 116-140 | STILL-OPEN | STILL-OPEN | DEFECT #1 prereq + third scope |
| render.md:166 | PARTIALLY | PARTIALLY | R2-Q1(b) resolves the tension; exception sentence remains |
| render.md:197-209 | PARTIALLY | PARTIALLY | pathKey-alone framing |
| render.md:260 (NVS-3) | SUPERSEDED | SUPERSEDED | resolution 1 |
| render.md:288-298 (FRK) | PARTIALLY | PARTIALLY | FRK-H2 tension re-pinned by §10.ab (carve-out withdrawn) |
| derived-state.md:97-100, 98/225-261 | STILL-OPEN | STILL-OPEN | per-path root / children.length |
| ops.md:13, 72-76, 89-90, 154 | STILL-OPEN | STILL-OPEN | + trigger-identity detail (10.ac.2 #7) |
| ops.md:128, 198 (G9) | SUPERSEDED | SUPERSEDED | resolution 1 |
| contract.md:39, 148 | STILL-OPEN | STILL-OPEN | unchanged |
| graph.md:29-32,40; 105 | STILL-OPEN | STILL-OPEN | unchanged |
| validation.md:56,50,132 | STILL-OPEN | STILL-OPEN | unchanged |
| payload.md:64, 16-18,75 | STILL-OPEN | STILL-OPEN | unchanged |
| RENDER_PROCESS_NOTES.md:534, 548, 565, 464, 466/501, 476, 619-630 | STILL-OPEN | STILL-OPEN | unchanged |
| RENDER_PROCESS_NOTES.md:694-702 | PARTIALLY | PARTIALLY | placementRouted branch; absorb R2-Q1(b) |
| designing-pages.md:52-55 (§3) | PARTIALLY | PARTIALLY | rewrite remains |
| designing-pages.md:60-61,73 | SUPERSEDED | SUPERSEDED | now by §10.aa/ab (pathKey-alone, not "pathKey+#<i>") |
| designing-pages.md:91-114, 162-180, 246-249, 309-317/349-351 | STILL-OPEN | STILL-OPEN | unchanged |
| fork-stress.md:163-188; fork-stress-data.md:7-36 | STILL-OPEN | STILL-OPEN | §10.aa census decides the numbers; rewrite remains |
| test-findings.md:422, 432-460, 34, 41-42, 209-211/299-311 | STILL-OPEN | STILL-OPEN | DEFECT #1 fix shape CONFIRMED live (10.ac.2 #2) |
| session-defect-review.md:440-444, 486-495 | STILL-OPEN | STILL-OPEN | unchanged |
| legacy-component-ref-only-review.md:433 | PARTIALLY | PARTIALLY | NP13 disposition annotation |
| legacy-component-ref-only-review.md:494-495 | SUPERSEDED | SUPERSEDED | res2 |
| legacy-component-ref-only-review.md:531 | STILL-OPEN | STILL-OPEN | unchanged |
| path-fork-review.md:222-228,272-277 | STILL-OPEN | STILL-OPEN | banner |
| state-first-analysis.md:134-138, 177-197, 266/280/303 | STILL-OPEN | STILL-OPEN | §10.aa census keeps the runtime census claim valid |
| FRESH-CONTEXT-SUMMARY / AGENTS.md:29-35 / framework-feature-summary.md:42 | STILL-OPEN | STILL-OPEN | ratio reconcile + refresh |

**10.2 CODE (10 §10.y rows):**

| §10.y row | Round-2 | Round-3 | Why |
| --- | --- | --- | --- |
| types.ts:8, 88/106; link.ts:23-26, 28-32; translate.ts:133-146; node.ts:186/788-793, 300-316, 512-562, 623-638, 658-663, 861-871; supervisor.ts:246-258, 271-278, 351-364; ops.ts:29-56, 71-108; render-helpers.ts:236-243/349-350, 292-297, 309, 341-347, 36-38, 127-138; serialize.ts:117; derived.ts:32/172-175; events.ts:68-74; pipeline.ts:78-79 | STILL-OPEN (35) / NO CHANGE (5) | STILL-OPEN (33) / NO CHANGE (5) | two rows move out (275, 332-335 below); serialize.ts:117 row EXPANDED (order-preservation, 10.ac.2 #8) |
| types.ts:126-133 | PARTIALLY | PARTIALLY | forkKey-always type note (10.ac.2 #2) |
| translate.ts:49-53 | SUPERSEDED | SUPERSEDED | res2 |
| translate.ts:440-444/488-491 | PARTIALLY | PARTIALLY | minting implementation remains |
| translate.ts:557-641 (reverse) | PARTIALLY | PARTIALLY | ordered `content`→array emission |
| node.ts:564-605 | PARTIALLY | PARTIALLY | placementRouted branch |
| resolve.ts:31-40/55-84/152-156/205-244 | PARTIALLY | PARTIALLY | first-match loop reads the node's ORDERED content anchors + per-name Link membership (C-3); placement hops emit pathKey segments, never `#f:` |
| supervisor.ts:275 (`#f` gate) | STILL-OPEN | **PARTIALLY** | R2-Q6 direction decided (10.ac.2 #7) |
| supervisor.ts:332-335 (apply gate) | STILL-OPEN | **PARTIALLY** | gate UNCHANGED; cleared by the missing contentNodes-ownership minting (10.ac.2 #1) |
| render-helpers.ts:210-215 (armWires) | PARTIALLY | PARTIALLY | `#<i>` machinery dies for path-states; with the §10.ab guard, forks are gone entirely — re-expression remains |

**10.3 TESTS (3 §10.y rows):** translate.test.ts:505-525/658-663/765-771, node.test.ts:1132/850-853, derived.test.ts:65-98, graph.test.ts:281-297, ops.test.ts:253-260, validation.test.ts:412-414, payload.test.ts:58-76, pipeline.test.ts:12-13/172/557-560, api.test.ts:228-239/402-433, supervisor.test.ts:73-79, legacy-bootstrap.test.ts:90/120-124, ssr-render.test.ts:135-136/263-275, ssr-html-validity.test.ts:46-47/112, stress-probes/RESULTS.md:118-125/84-96, fork-stress-data.test.ts:6-46, adapters.test.ts:283-304 — STILL-OPEN (21) / NO CHANGE (2) — **unchanged**; reverse.test.ts:42-72 and render.test.ts:608-621 — PARTIALLY — **unchanged**.

**10.4 DEMOS / SMOKE (12 rows):**

| §10.y row | Round-2 | Round-3 | Why |
| --- | --- | --- | --- |
| fork-stress-data.js:407-425 | STILL-OPEN | **PARTIALLY** | lines are the RUNTIME page's checks — KEPT; the STATIC page needs a NEW check block (§10.aa census) |
| fork-stress-data.js:592-618; demo-smoke.mjs:192-223, 284-295; fork-stress-data-page.mjs; components.js:220-233/251/374-375; ssr-render.*; feature-showcase.js:251-257/579-582; fork-stress-fixture.js:160-176 + fork-stress.js:144-163/501-508; index.html; fork-stress-data-*.html | STILL-OPEN | STILL-OPEN | unchanged (runtime census asserts at demo-smoke.mjs:196-223 remain valid for the runtime pages) |
| feature-matrix-fixture.js:167-184/217-225 | PARTIALLY | **STILL-OPEN** | §10.ab re-expresses the fork — and the actual anti-pattern sites are `theme` ×2 (fixture:206-207) and `panel` ×2 (component-fixture:82-83), NOT :167-184; scope grew (10.ac.2 #3) |

**10.y.3 conflict rows:** C-1 RESOLVED (§10.aa, R2-Q1(b)); C-2 RESOLVED (§10.z — trigger identity, surface now enumerated, 10.ac.2 #7); C-3 RESOLVED (§10.z — ordered anchors); C-4 STILL-OPEN (R2-Q7 unanswered — the §1.2 stale bullet at lines 128-133 survives); C-5 STILL-OPEN (R2-Q2 unanswered — `#` validation placement verified, 10.ac.2 #6); C-6 PARTIALLY (R2-Q6 parked with direction); C-7 RESOLVED (§10.aa); C-8 RESOLVED (§10.z); C-9 RESOLVED (§10.z).

#### 10.ac.2 The eight verifications

1. **E2E-2 S1.1 apply gate (supervisor.ts:332-335) — CLEARS, with a new prerequisite.** The gate is exactly `nodeState !== 'in-tree' → no-usable-state` (supervisor.ts:332-335), and family-in-tree via a `'contentNodes'`-token parent DOES clear it (node.ts:213 `if (target === 'contentNodes') return 'in-tree'`). So the gate itself needs NO change (contra round-1 §10.6/10.2-:332-335 and the round-2 "re-key to path-viability" option). **BUT**: no code anywhere mints a `'contentNodes'` parent anchor — the token is classification/serialize-only (node.ts:52,178,213; resolve.ts:47,80; serialize.ts:11; registry.ts:19-30 is a node SET, not the token). Translated content roots are created with `asContentRoot = noSeed` only (translate.ts:430, 507, 520-521) — no child anchor ⇒ `state === 'unplaced'` (node.ts:200-204) ⇒ the gate REJECTS a static-envelope prototype today. §10.aa's "23 nodes are all in-tree (contentNodes-owned)" therefore requires a NEW minting/assembly surface (translate content-root handling or the static builder attaches the 22 prototypes under a contentNodes-owned node) — unlisted in §6 until now. The remaining E2E-2 blocker is that minting surface, not the gate.
2. **DEFECT #1 — NOT moot; fix is simpler, still required.** `minimalFromState` forwards `cs.forkKey` (render-helpers.ts:37); `emitOne` drops it in all three return branches (:335, :347, :350) and the types don't declare it at all (`emitElements` actionable param render-helpers.ts:192-201; `EmitState` :257-265). The `#<i>`-masking reason for the defect disappears under pathKey wires, but the FORWARDING hole remains: with identity = pathKey alone (§10.aa/ab), every path-state needs `cs.forkKey = cs.pathKey` — today only set when `arm.keys.length > 0` (node.ts:699-706) — forwarded onto every create/set/remove op (treeSig dimension render-helpers.ts:127-138, wireKey composite :22-25, adapters forkKey-keyed maps). So the fix shape (test-findings.md:456-460) stands, now UNCONDITIONAL: EmitState/emitElements gain `forkKey`, `emitOne` forwards in every branch, node.ts:699-706 sets forkKey always. The red→green unit stays the §6.5 prerequisite.
3. **Feature-matrix `panel` fork — anti-pattern confirmed at FOUR sites; the "two provider NODES" re-expression is mechanically impossible.** Current state: two same-name source anchors on ONE node via `addComponentSource` — `'theme'` ×2 (feature-matrix-fixture.js:206-207, round-trip feature-matrix-tests.js:471-483: every theme consumer asserts 2 arms, distinct pathKeys, both values in DOM) and `'panel'` ×2 (component-fixture.js:82-83, round-trips components.js:353-367 + 404-406 `panelArms === 2`, wires `${panelId}#0/#1`, and the BUILDER scripts/build-demo.mjs:76-81 `panelArms.length !== 2` throw). Also pane-fixture.js:13-14 (`'feed'` ×2 — unmentioned by §10.ab). The runtime fork-stress pages are NOT affected (fork-stress.js:174-175 and fork-stress-fixture.js:185-186 add `.a`/`.b` — DISTINCT names — no duplicate). The "two provider NODES" option cannot produce a fork: the walk is own→descendants→ancestors, first-with-providers wins (resolve.ts:140-160, §10.aa verification) and a consumer has ONE ancestor chain — two provider NODES ⇒ one nearest binding ⇒ one arm. The only coherent re-expression is **DROP the fork claim**: fixtures single-source, the four round-trips re-asserted as single-resolution, DOM text asserts trimmed. Touches: component-fixture.js:82-83, components.js:353-367/404-406, feature-matrix-fixture.js:206-207, feature-matrix-tests.js:470-483, feature-matrix.js DOM assert, build-demo.mjs:76-81, and the smoke run of all of them (demo-smoke.mjs:123, :133, :146 mode-toggle).
4. **`component-source-duplicate` guard — placement verified; one wrinkle.** The imperative choke point is `Node.addAnchor` (node.ts:413) — `demo-fixtures.addComponentSource` (demo-fixtures.js:67-72) calls it directly (a NEW per-call Link, so the guard must match role+target across ALL of the node's anchors, not per-link). materializeAnchors dedup (node.ts:783-786: same role+target ⇒ skip, BEFORE addAnchor) is confirmed correct and NOT relied on — decl-path duplicates never reach the guard. **Wrinkle**: the constructor seed path (node.ts:164-192, serialize round-trip) also calls `addAnchor` directly with no dedup — serialized multi-source anchors (tests construct forks this way: node.test.ts:475/615/957, graph.test.ts:433, render.test.ts:579, cited in §10.y.1) would trip a warn/block on re-seed; the guard needs an explicit seed-path policy (dedup at seed like materializeAnchors, or warn-only) and the warn must be checked against warn-count assertions in those tests.
5. **Census/profile — runtime asserts stay; the static page needs new ones; the ratio guard has a baseline gap.** The round-1 census asserts (fork-stress-data.js:407-425 `in-tree = 2^depth − 1` / `unplaced = prototypes.length`; demo-smoke.mjs:196-223 `inTree/unplaced/cloneOps` arithmetic, run over the RUNTIME depth loop :224-256 and the method loop :260-282) are all RUNTIME-page checks on RUNTIME pages — KEEP unchanged. The STATIC page needs NEW fields: in-tree=23, path-viable=4095, unplaced=0 (prototypes never 'unplaced' once contentNodes-owned), destroyed=0, cloneOps=0, states=elements=4095 — new profile census fields (fork-stress-data.js:610-619 pattern) and a new smoke assert block. **Gap**: the d12 ratio guard (demo-smoke.mjs:284-295) compares placement/values/link TOTALS of the three runtime method-variants; the static page is a single page with no method variants — "re-baseline the ratio against the static page's placement d12" (AGENTS item 4) needs a defined baseline (static-page variant set, or a documented single-total baseline), and the AGENTS ~1.5× vs demo-smoke 2.5× reconciliation (10.1 row) remains.
6. **`#` validation — no validation exists anywhere today; placement confirmed.** Zone names: translate.ts:436 mints `placementName` verbatim into the anchor target (no checks); `linkFor` (translate.ts:136-144) builds `kind:name` keys with no validation; authored ids: node.ts:143 `data.id ?? mintNodeId()` passes through unvalidated; component names flow through planBindings (K8 duplicate-reference guard is the only name-side check). C-5's threat (a zone named `x#f:o#0` forging the arm suffix and tripping the supervisor gate, supervisor.ts:275) is live. The `placement-name-invalid` warn belongs at the minting site (translate.ts:435-438, the K4 `warn` channel at :168-173) — a `#`-check for authored ids rides the same site (node.ts:143 or baseFrom), and both are new.
7. **Silent-abort trigger identity (C-2) — exact touch points.** (a) Op payload: the new placement-attach kind joins the `MutationOp` union (types.ts:93/103) + wire form (:111); the trigger `{ kind: 'placement', linkName, direction }` rides the op (AttachOp.zone at types.ts:88 is declared but unused — the §9-Q2 dedicated kind supersedes it); (b) `client.ts:28-53` — the op spread `{ ...m, node }` (:33) passes new fields through automatically (verify the ref-resolution loop :39-49 doesn't strip them); (c) `supervisor.apply` signature (supervisor.ts:307-313) dispatches placement-affecting ops (attach :351-364; the new executor) which pass the trigger into the dirty-mark; (d) `runPass2AndFlush` (supervisor.ts:246-258) gains the relevance pre-check BEFORE `node.compile` (:258) — "can the changed link alter this node's first-match choice?" — the §3.3 affected-set rule; (e) abort emits nothing (events.ts untouched); (f) journal replay rides for free (journalIfApplied :297-305 stores the op verbatim).
8. **Ordered content anchors (C-3) — storage is already ordered; the ORDER-KILLER is serialize.** `Node._anchors` is an insertion-ordered `Anchor[]` (node.ts:113, 147) and `makeCs` copies it into `cs.anchors` (:633), so first-match-at-compile can read the mint order as-is — minting in `targetPlacement` array order (new code at translate.ts:433-438) is trivially ordered. Two surfaces break order: (a) `serialize.ts:115-123` SORTS anchors by roleOrder (:117 — which also lacks the new roles) then by target STRING — content anchors come back alphabetically sorted, preference order destroyed on round-trip; roleOrder gains `container`/`content` AND content anchors must be excluded from the target sort (or carry a sequence); (b) `derived.ts:172-175` reads `cs.anchors.find(a => a.role === 'placement')` — the per-path `placement` root (§2.3) replaces this first-anchor read and the role renames to `'container'`.

#### 10.ac.3 New-conflict list (round-3 decision language vs repo)

| # | New conflict | Evidence | Severity |
| --- | --- | --- | --- |
| N-1 | **§10.aa's "23 nodes all in-tree (contentNodes-owned)" has no minting path in the engine.** The `'contentNodes'` token is classification-only (node.ts:52,213; resolve.ts:47,80; serialize.ts:11); content roots get `asContentRoot` (noSeed) with NO child anchor (translate.ts:430,507,520-521) ⇒ `'unplaced'` (node.ts:200-204) ⇒ the apply gate (supervisor.ts:332-335) rejects static-envelope prototypes today. Census in-tree=23 and the E2E-2 fixture both depend on the missing minting surface. | translate.ts:430/507/520-521 vs node.ts:213, 200-204 | **BLOCKING** for E2E-2 + census — new §6 item (translate/builder content-root attachment) |
| N-2 | **§10.ab "re-express as two provider NODES" cannot fork.** Nearest-wins walk (own→descendants→ancestors, first-with-providers; resolve.ts:140-160) + single parent chain ⇒ two provider NODES yield ONE binding. Only "drop the fork claim" is coherent — the theme/panel/feed forks are four DEMO-ROUND-TRIP sites (feature-matrix-fixture.js:206-207, component-fixture.js:82-83, pane-fixture.js:13-14; asserts at feature-matrix-tests.js:470-483, components.js:353-367/404-406, build-demo.mjs:76-81), not one. | resolve.ts:140-160; fixtures above | HIGH — re-expression scope correction |
| N-3 | **`component-source-duplicate` guard vs the four demo sites + seeded tests.** The guard (node.ts:413) fires on the theme/panel/feed demos (their fork claims are being dropped — OK) AND on the constructor seed path (node.ts:164-192 — no dedup) where tests construct forks from serialized anchors (node.test.ts:475/615/957, graph.test.ts:433, render.test.ts:579) — warn-count assertions in those suites are at risk; the guard needs a seed-path policy + warn-only-vs-block decision. | node.ts:413, 164-192, 783-786 | MEDIUM |
| N-4 | **Spec-internal contradiction: §5.2 census row still says `unplaced = 22`** (line 436) vs §10.aa (in-tree=23, prototypes never unplaced). Also §6.4 demo-smoke row frames the round-1 census guard as "replaced" — it is KEPT for the runtime pages; a NEW assert block is added. | spec §5.2 vs §10.aa; demo-smoke.mjs:196-223 | HIGH (spec text) |
| N-5 | **Ratio guard baseline gap.** AGENTS item-4/demo-smoke.mjs:284-295 compares runtime placement/values/link d12 totals; the static page has no method variants — the "re-baseline" has no defined baseline. Plus the still-unreconciled 2.5× (demo-smoke.mjs:291) vs ~1.5× (AGENTS.md:29-35) bound. | demo-smoke.mjs:284-295; AGENTS.md:29-35 | MEDIUM |
| N-6 | **`#`-freedom remains unvalidated (C-5/R2-Q2).** No name/id validation exists (translate.ts:436, 136-144; node.ts:143); `placement-name-invalid` warn placement now verified (§10.ac.2 #6) — decision still pending. | translate.ts:433-438; node.ts:143 | MEDIUM |
| N-7 | **DEFECT #1 cite drift.** test-findings.md:441-442 cites `dist/core/render-helpers.js:212-273`; current source is render-helpers.ts:292-351 (line drift only — no behavioral conflict; the fix shape is confirmed correct). | test-findings.md:441 vs render-helpers.ts:292-351 | LOW (record-keeping) |
| N-8 | **C-4 stale bullet still live (R2-Q7 unanswered).** §1.2 lines 128-133 ("a name that matches NO zone … the node's OTHER names still fork") still contradicts first-match (no-match names skipped; whole-array miss ⇒ nothing forks). | spec §1.2 lines 128-133 | LOW-MEDIUM |

#### 10.ac.4 FINAL still-open update list (actionable set for the implementation pass)

**SPEC REWRITES — 46 rows** (20 STILL-OPEN, 13 PARTIALLY-RESOLVED, 9 SUPERSEDED-fix-decided, 4 new):

- api.md:98,103 (viability + T2/T3 rows); :256-259/267/268 (§5 P1–P4 + placement-attach); :289 (F2 — forkKey=pathKey on every path-state); :318-319 (§7 W2/W3 per-path events; "≤1 per node per tick" letter dies — per-path keys fall out of forkKey=pathKey, events.ts:68-74 needs no code change).
- translate.md:48-49 (type fix, decided); :148/253-254/262-264/395/403/412/354-377 (minting + reverse rows, ordered); :158-159; :161-163; :409; :161-163.
- node.md:44, 72, 92, 100, 323, 327-337, 339-344, 371, 377, 380.
- pipeline.md:67, 68, 124, 145-147/157-163, 308, 380, 384.
- render.md:68-71/83/173 (forkKey-always), 97-99 (DEFECT #1 prereq), 116-140, 166, 197-209, 260, 288-298.
- derived-state.md:97-100, 98/225-261. ops.md:13/72-76/89-90/154 (+ trigger identity), 128/198. contract.md:39/148. graph.md:29-32/40, 105. validation.md:56/50/132. payload.md:64, 16-18/75.
- RENDER_PROCESS_NOTES.md:534, 548, 565, 464, 466/501, 476, 619-630, 694-702.
- designing-pages.md:52-55, 91-114, 162-180, 246-249, 309-317/349-351. fork-stress.md:163-188. fork-stress-data.md:7-36.
- test-findings.md:422, 432-460 (severity/status bump — now the blocking prerequisite), 34, 41-42, 209-211/299-311. session-defect-review.md:440-444, 486-495. legacy-component-ref-only-review.md:433, 494-495, 531. path-fork-review.md:222-228/272-277 (banner). state-first-analysis.md:134-138, 177-197, 266/280/303. FRESH-CONTEXT-SUMMARY.md; AGENTS.md:29-35 (2.5× vs ~1.5×); framework-feature-summary.md:42.
- NEW: §5.2 census row (unplaced=22 → in-tree=23/unplaced=0/path-viable=4095/states=elements=4095/cloneOps=0); §6.4 demo-smoke framing (runtime asserts KEPT, static block added); §1.2 lines 128-133 stale bullet (C-4/R2-Q7); §10.aa contentNodes-ownership mechanism pin + §10.z R2-Q4 "pathKey + `#f:…#i`" text superseded by §10.ab pathKey-alone.

**CODE — 39 rows** (28 STILL-OPEN, 7 PARTIALLY-RESOLVED, 1 SUPERSEDED, 3 new):

- types.ts:8 (Role union); :88/106 (AttachOp.zone → dedicated placement-attach kind + trigger fields); :93/103/111 (op union + wire forms + trigger payload) — **new**; :126-133 (forkKey always present = pathKey).
- link.ts:23-26 (DEFAULT_PLACEMENT roles). translate.ts:49-53 (type fix — decided); :433-438 (container role + ordered `content` minting + §1.3 veto + `placement-name-invalid` `#` warn); :440-444/488-491 (warn removal); :507-521 (contentNodes-ownership minting for static content roots) — **new**; :557-641 (reverse, ordered).
- node.ts:143 (`#` check on authored ids); :186/788-793 (link-kind mapping); :300-316 (pathKeyFrom placement edges); :413 (component-source-duplicate guard + seed-path policy) — **new**; :512-562 (chain walk placement edges + visit set); :564-605 (placementRouted); :623-638 (path-derived children); :658-663 (path-enumeration mode); :699-706 (forkKey = pathKey unconditional); :783-786 (dedup kept, not relied on); :861-871 (findCycle placement edges).
- resolve.ts:31-40/55-84 (container/content enumeration off the per-name Link); :152-156 (placement-hop pathKey segments — never `#f:`); :205-244 (first-match loop over the node's ordered content anchors + Link membership; `#f:` arm machinery dies with the forks).
- supervisor.ts:246-258 (compile-mode switch + relevance pre-check); :271-278 (event filter → affected set); :275 ("path-state ⇒ emit {forkKey: pathKey, nodeIds: trace}" — R2-Q6); :307-313 (apply — trigger identity) — **new**; :351-364 (placement-attach executor).
- ops.ts:29-56/71-108 (placement-attach executor + veto). render-helpers.ts:210-215/292-297 (pathKey wires); :236-243/349-350 (leaves-by-fiat removed); :309/341-347 (gates re-expressed); :36-38 + EmitState/emitElements + all three `emitOne` branches (DEFECT #1 fix — the §6.5 prerequisite); :127-138 (treeSig exercised).
- serialize.ts:115-123 (roleOrder + `container`/`content`; content anchors EXCLUDED from the target sort — preference order preserved). derived.ts:32/172-175 (per-path placement root, role rename). events.ts:68-74 (no change — key becomes per-path via forkKey=pathKey; api.md §7 wording covers it). pipeline.ts:78-79. client.ts:28-53 (verify op spread + ref-resolution carry the trigger fields).

**TESTS — 26 rows** (19 STILL-OPEN, 2 PARTIALLY-RESOLVED, 5 new):

- translate.test.ts:505-525/658-663/765-771 (minting + veto + role rename); node.test.ts:1132 (union); derived.test.ts:65-98; graph.test.ts:281-297; ops.test.ts:253-260; validation.test.ts:412-414; payload.test.ts:58-76 (removal kills path-states); pipeline.test.ts:12-13/172; api.test.ts:228-239/402-433 (T16 → placement-attach); supervisor.test.ts:73-79; legacy-bootstrap.test.ts:90/120-124; ssr-render.test.ts:135-136/263-275 (serialized forkKey per-path); ssr-html-validity.test.ts:46-47/112; reverse.test.ts:42-72; render.test.ts:608-621 (pathKey-wire rows); adapters.test.ts:283-304; stress-probes/RESULTS.md:118-125/84-96 (supersession annotations); fork-stress-data.test.ts:6-46 (add static-envelope test).
- NEW: DEFECT #1 red→green (compile → emitElements → diffMinimal; every create/set op carries forkKey = cs.pathKey — §6.5, before the model); `component-source-duplicate` guard tests (imperative + seed-path policy); static fork census (registered=23, in-tree=23, path-viable=4095, cloneOps=0, per-path forkKey=pathKey); `placement-name-invalid`/`#` warn tests; content-anchor order preservation (serialize round-trip keeps `targetPlacement` preference order); trigger-identity/silent-abort (less-favored container change ⇒ no state, no events); E2E-2 fixture (proceedable once the contentNodes minting lands); E2E-3/E2E-4 cases.

**DEMOS / SMOKE — 15 rows** (all actionable):

- fork-stress-data.js:407-425 + :592-618 — RUNTIME checks KEPT; STATIC page adds in-tree=23/path-viable=4095/unplaced=0/cloneOps=0/states/elements census + new profile fields (:610-619 pattern).
- demo-smoke.mjs:196-223 — runtime asserts KEPT; NEW static assert block; :284-295 — ratio baseline decision (N-5).
- fork-stress-data-page.mjs — new static envelope + contentNodes-ownership attachment; fork-stress-data-*.html — static pages.
- component-fixture.js:82-83 + components.js:353-367/404-406 — panel fork DROPPED (single source; single-resolution checks).
- feature-matrix-fixture.js:206-207 + feature-matrix-tests.js:470-483 + feature-matrix.js DOM assert — theme fork DROPPED.
- pane-fixture.js:13-14 — `'feed'` ×2 — guard scope decision (re-express or guard-carve-out).
- build-demo.mjs:76-81 — `panelArms` throw re-asserted/replaced.
- components.js:220-233/251/374-375, ssr-render.*, feature-showcase.js:251-257/579-582, fork-stress-fixture.js:160-176 + fork-stress.js:144-163/501-508 (role rename only), index.html:44/76-96.

**Counts:** round-3 status moves = 6 (docs 1, code 2, demos 2, tests 0, §10.y.3 C-rows 4 resolved). Final actionable update set: **SPECS 46 / CODE 39 / TESTS 26 / DEMOS 15 = 126 rows** (NO-CHANGE rows excluded: 5 code + 2 test).

### 10.ad User review (round 4) — minting, demos, guard, ratio baseline

- **contentNodes minting surface (CONFIRMED — N-1):** the translate layer
  gains the minting surface for content roots: each `content` payload root
  (and `template.children` root) receives the `contentNodes` parent anchor
  (permanent-owner token, registry.ts:19-30) at translate. This makes
  content roots family-'in-tree' (node.ts:213) — the E2E-2 apply-gate
  prerequisite (supervisor.ts:333 `state !== 'in-tree'`) and the census
  basis (`in-tree = 23` for the static fork). New spec + code item (§6
  additions: translate.ts content-root seeding; census texts).
- **Demos rebuilt for feature completeness (CONFIRMED — N-2):** the
  feature-matrix `theme` ×2, component `panel` ×2, and pane `feed` ×2
  same-node multi-source fixtures are ANTI-PATTERNED and cannot be
  re-expressed as two provider nodes (nearest-wins yields one hit per
  phase). The demos are REBUILT to drop the fork claims and re-express the
  covered features via legitimate multiplicity (distinct names /
  placement multiplicity), with the round-trip asserts
  (feature-matrix-tests.js:470-483, components.js:353-406,
  build-demo.mjs:76-81) re-expressed accordingly. Documented
  anti-patterns are respected, not worked around.
- **component-source-duplicate guard (CONFIRMED, with placement —
  elaboration in the review thread):** guard at `Node.addAnchor`
  (node.ts:413), warn `component-source-duplicate`, keep-first,
  skip-second (consistent with K8). The constructor SEED path (node.ts:
  174, 188) also calls `addAnchor` — it gets an explicit opt-out
  (`skipDuplicateGuard` option, seed-only): hydration is faithful to the
  loaded document (authoring-time enforcement lives at the two authoring
  surfaces — translate K8 for legacy data, addAnchor for runtime
  imperative); loaded docs are trusted artifacts, documented.
- **Ratio guard (CONFIRMED — N-5):** the static page's d12 ratio guard
  starts with **placement as the baseline** (the static page is its own
  reference); a TODO is recorded to update the baseline after testing
  confirms the absence of explosive time issues.

### 10.ae User review (round 5) — guard tolerance removed

- **AMENDED (§10.ad): the `component-source-duplicate` guard is
  UNCONDITIONAL — no seed-path opt-out.** Old/third-party documents are
  legacy-format by definition and enter through translate, where K8
  already blocks the anti-pattern at the boundary; new-format serialized
  docs are produced by THIS system, which enforces the guard at authoring
  (addAnchor) — so a new-format doc containing the pattern cannot exist
  post-rebuild. The constructor seed path (node.ts:174, 188) is covered by
  the same unconditional guard (warn `component-source-duplicate`,
  keep-first, skip-second). Tolerance is unneeded; hydration is faithful
  because guarded authoring makes the pattern unreachable in shipped data.
  Prerequisite: the demos' rebuild (decision §10.ad-2) lands in the same
  implementation pass, so no shipped new-format doc trips the guard.

### 10.af Final review (pre-implementation)

FINAL-REVIEW agent output (READ-ONLY audit of the whole accumulated spec
§1–§10.ae; the only edit is this section). Verdict: **PROCEED-TO-IMPLEMENT**
with the core-spec rewrite as Unit 0 — every contradiction found below is a
mechanical reconciliation of ALREADY-DECIDED text, no new design question
survives. One scope-pin (finding F-13) is the only item requiring a choice
between two already-endorsed readings; the chosen reading is stated below.

#### 10.af.1 Coherence audit — core text vs the decision layers

Verified against source (git HEAD b693dd5): `supervisor.ts:275` (`#f` gate),
`:332-335` (in-tree gate), `node.ts:213` (contentNodes → `'in-tree'`),
`node.ts:699-706` (forkKey only when `arm.keys.length > 0`), `translate.ts:
433-444/507-521` (placement minting; content roots `asContentRoot` noSeed),
`render-helpers.ts:36-38` (minimalFromState forwards forkKey) vs `:335/:347/
:350` (emitOne branches drop it), `serialize.ts:115-123` (roleOrder + target
string sort), `resolve.ts:140-160` (nearest-wins walk), `demo-smoke.mjs:284-
296` (2.5× placement-baseline guard), `fork-stress-data.js:407-425` (runtime
census asserts). All §10.y/§10.ac citations re-confirmed.

**(a) Core text that still contradicts a later decision — the rewrite list:**

| # | Core site (this doc) | Contradicts | Required rewrite (final text) |
| --- | --- | --- | --- |
| F-1 | §5.2 census row (line 436): `unplaced = 22; in-tree = 1 (root)` | §10.aa (in-tree=23, prototypes never unplaced) + §10.ad minting (N-4) | census = registered **23**, in-tree **23**, path-viable **4095**, unplaced **0**, destroyed **0**, cloneOps **0**; states=elements=4095 |
| F-2 | §4.2 last bullet (line 373-375): "`<nodeId>#<i>` survives ONLY for component-fork arms" | §10.ab (pathKey alone, UNCONDITIONALLY; `#<i>` carve-out withdrawn) + §10.aa R2-Q4 | delete the survival bullet; with the duplicate-source guard, forks are gone entirely — identity = pathKey alone (10.ac.2 #2/#3) |
| F-3 | §6.4 demo-smoke row (line 495): "Census guard re-pinned … replaced by the §5.2 expectations" | §10.ac.2 #5 + §10.ac.4 (runtime asserts KEPT; a NEW static assert block is added) | rewrite: runtime asserts kept (with the F-13 re-pin); static block added |
| F-4 | §3.3 (line 330-336) + §8 Q2 row: open question "new op vs attach-with-zone; draft leans attach-with-zone" | §9-Q2 (dedicated `placement-attach` op decided; attach stays family-only) + §10.ac.2 #7 (`AttachOp.zone` superseded by the dedicated kind) | §3.3 states the dedicated op as decided; §8 Q2 marked resolved |
| F-5 | §8 Q1–Q8 whole table + the §8 drafting note (lines 540-545) + status header (lines 1-11 "DRAFT — awaiting design review") | §9 resolves Q1-Q5/Q7/Q8; Q6 deferred; §10.ad decides Q6 (placement-baseline + TODO); five user-review rounds completed | §8 becomes a resolution ledger (or supersession note); header/status updated |
| F-6 | §1.2 stale bullet (lines 128-133): "a name that matches NO zone … unresolved for that name — the node's OTHER names still fork" | first-match rule (same §1.2; §10.z C-3) — no-match names are skipped; whole-array miss ⇒ nothing forks (C-4/N-8) | delete/rewrite under first-match semantics |
| F-7 | §6.3 static-census test row: "unplaced=22" | §10.aa census | in-tree=23, path-viable=4095, unplaced=0, cloneOps=0, per-path forkKey=pathKey |
| F-8 | §6.2 types.ts row: "`AttachOp.zone` activation decision (§8 Q2)" | §9-Q2/§10.ac.2 #7 (dedicated kind; zone superseded) | drop the zone-activation note; add the placement-attach kind + trigger fields (types.ts:88/93/103/111) |
| F-9 | §6.2 ops.ts row: "(attach-with-zone, lines 29-56)" | §9-Q2 | placement-attach executor (new kind, not attach-with-zone) |
| F-10 | §6.2 node.ts row: no duplicate-source guard entry | §10.ab/ad/ae (guard at addAnchor, UNCONDITIONAL) | add the node.ts:413 row (warn `component-source-duplicate`, keep-first, skip-second) + seed-path policy (§10.ae) |
| F-11 | §6 tables omit the surfaces §10.ac.4 marks NEW | §10.ac.4 / §10.ad | add: translate.ts contentNodes-ownership minting; supervisor apply trigger identity; client.ts trigger carry; `#` validation (`placement-name-invalid`); serialize roleOrder + content-anchor order preservation; events.ts "no code change" note |
| F-12 | §2.4 cross-reference "(§10.10.4 precedent…)" — consistent, but §2.4/§2.1 non-viable-termination wording ("'contentNodes' / no edge ⇒ non-viable") must be re-expressed once content roots carry a contentNodes edge | §10.ad minting (F-13) | state that the contentNodes TOKEN terminates the walk as non-viable (no path past it) — in-tree label ≠ compiled viability (10.y.1 #1, C-7) |
| F-13 | **(NEW — found by this review)** §10.ad minting is translate-global ("each content payload root (and template.children root)") but §10.ac.2 #5/§10.ac.4 declare the RUNTIME page's census asserts KEPT (`fork-stress-data.js:407-425`: inTree = 2^depth − 1, unplaced = prototypes.length) — the runtime page's 22 prototypes ARE content payload roots, so global minting flips them in-tree and breaks those asserts (plus `state-first-analysis.md:177-197` §4.1 record, the legacy-bootstrap attach-into-zone e2e semantics, and reverse round-trip: `nodeToLegacy` must strip the minted contentNodes anchor) | §10.aa's "the prototypes are never 'unplaced' — family-wise they live under contentNodes" is stated GLOBALLY | **Chosen reading:** minting is translate-global per §10.ad's letter; runtime census asserts re-pinned (inTree = 2^depth − 1 + prototypes, unplaced = 0); state-first-analysis §4.1 annotated as the pre-minting runtime record; e2e legacy-bootstrap "attach makes unplaced content render" re-verified as "attach adds a placement path to an already-in-tree content root"; nodeToLegacy strips the minted anchor |

**(b) E2E-encoding check — each constraint encoded once, unambiguously:**

| E2E | Final encoding | Verdict |
| --- | --- | --- |
| E2E-1 | §2 enumeration + §5.1 (23-node re-expression, 4095 = Σ 2^k, k=1..11, + root = 2^12 − 1) + §6.3 census | Encoded. One clarification to state in the rewrite: contentNodes minting adds ANCHORS, never nodes — E2E-1's "no node creation" holds at every stage |
| E2E-2 | §3.1 (node-local invalidation; compile-scope + wire-identity assertions) + §4.1 (stable-wire reuse) | Encoded. Fixture unambiguous once minting lands (gate passes on in-tree content roots — §10.ac.2 #1); F-13 must not re-open it |
| E2E-3 | §3.2 (per-name component-Link affected set; all-consumers + half-consumers) | Encoded. Path-only resolution (§9-Q8, verified §10.aa R2-Q4) makes the fixture deterministic |
| E2E-4 | §3.3 (affected set = immediate parent + added node) + §9-Q2 (placement-attach dirty set) | Encoded. |

**(c) Census semantics — consistent once the rewrite lands:** the coherent
final numbers are registered=23 / in-tree=23 / path-viable=4095 states /
states=elements=4095 / unplaced=0 / destroyed=0 / cloneOps=0, with
`forkKey = pathKey` per state. Stale `unplaced = 22` / `in-tree = 1` text
survives at §5.2, §6.3, and (indirectly) §6.4 — all three are in the F-list
(F-1, F-7, F-3). No other census site conflicts.

**(d) Guard decisions — coherent, one leftover-opt-out trace:** K8 at
translate (legacy boundary) + addAnchor guard UNCONDITIONAL (warn
`component-source-duplicate`, keep-first, skip-second — §10.ae amends §10.ad's
`skipDuplicateGuard` seed opt-out) + no tolerance. The §10.ad opt-out sentence
remains in the doc as the AMENDED record — §10.ae must be marked the operative
rule in the rewrite (F-10). No other opt-out language found. The §10.ae
prerequisite ("demos rebuild in the same pass") is a hard ordering dependency
(Unit 8 ← Unit 11 below).

**(e) Role naming — consistent:** `container`/`content` applied throughout
§1–§5; the only `'placement'`-role occurrences are deliberate rename/provenance
annotations (§1.1 row 1, §6.1 doc-update columns, §6.2 translate row) — no
`placement-user` or live `'placement'`-role wording survives. Code side:
`serialize.ts:117` roleOrder still lacks the two roles (unit item); the §10.x
quoted+backticked role-token convention applies to all rewritten prose.

#### 10.af.2 Readiness verdict

**PROCEED-TO-IMPLEMENT** — all decision gates are closed (C-1…C-9, N-1…N-8
resolved or itemized in the §10.ac.4 actionable set), and every core-vs-
decision contradiction in 10.af.1 is a mechanical rewrite of decided text.
**Unit 0 (the core rewrite below) is the mandatory first deliverable of the
implementation pass**; F-13 is the only item needing an explicit choice, and
the chosen reading is recorded above so the implementer does not re-open it.
Not REVISE-CORE-FIRST: no finding requires a new user decision.

#### 10.af.3 Unit-ordered implementation plan (the 126-row set consolidated)

Dependency notation: → = requires.

- **Unit 0 — CORE-SPEC REWRITE (no code).** Apply F-1…F-13: §5.2 census;
  §4.2 fork-identity bullet; §6.3/§6.4 rows; §3.3 + §8 ledger + status
  header; §1.2 stale bullet; §6.2 additions (guard, placement-attach kind,
  minting, trigger identity, `#` validation, serialize order); §2.1/§2.4
  token-termination wording; runtime census re-pin + state-first-analysis
  §4.1 annotation; nodeToLegacy strip note.
- **Unit 1 — DEFECT #1 red→green** (§6.5 prerequisite): red test
  compile → emitElements → diffMinimal (create AND set ops carry forkKey);
  fix = EmitState/emitElements gain `forkKey`, every `emitOne` branch
  forwards it, `node.ts:699-706` sets forkKey = pathKey unconditionally.
  → Units 4, 7, 9 (all forkKey-forwarding consumers).
- **Unit 2 — translate minting + feed:** contentNodes-ownership minting
  (translate-global, F-13 chosen reading); ordered `content` anchors from
  `targetPlacement: string[]` (preference order preserved); container-role
  minting + §1.3 ancestor-name veto (K4 `placement-name-vetoed`); `#`
  validation (`placement-name-invalid`, K4); NP13/AP5 warn removal;
  `LegacyPlacementConfig` type fix; reverse emission (`content` anchors →
  ordered array, minted contentNodes anchor stripped, derived
  `activePlacement` read). → Units 5, 9, 11, 12 (census/E2E-2 basis).
- **Unit 3 — roles surface:** types.ts Role union (`'content'` +,
  `'placement'` → `'container'`); link.ts DEFAULT_PLACEMENT roles; node.ts
  :186/788-793 kind mapping; serialize.ts:117 roleOrder; derived.ts:32
  BARE_ROOTS; test/demo role-rename sweep (the 15-20 rename-only rows).
  → Unit 4; parallel with 1, 2.
- **Unit 4 — compile placement-path mode:** node.ts path enumeration
  (content anchors → per-name placement Link → container owners; family
  edges; per-walk visit set §1.4); `pathKeyFrom` placement-edge interleave;
  `placementRouted` viability branch; path-derived children attach at mint;
  chain classification + `findCycle` walk placement edges. 4095-state
  census on the 23-node graph. Requires 1, 3. → Units 5, 6, 7, 10.
- **Unit 5 — resolve placement walk:** first-match preference loop over the
  node's ORDERED content anchors + per-name Link membership; per-zone
  fan-out of the chosen name; placement hops emit pathKey segments, NEVER
  `#f:` (10.ac.2 #8, C-3); hub fallback for placement names; `#f:` arm
  machinery removal. Requires 2, 3, 4. → Unit 6.
- **Unit 6 — supervisor + ops + client:** compile-mode switch (three
  scopes); relevance pre-check (silent abort — trigger identity
  `{kind:'placement', linkName, direction}` through apply + client.ts
  spread); event filter → affected set; `#f` gate → "path-state ⇒ emit
  {forkKey: pathKey, nodeIds: trace}"; placement-attach executor (new kind,
  types + wire form + ops.ts switch); state-slice block unchanged. Requires
  4, 5. → Unit 12 (E2E-4).
- **Unit 7 — render-helpers:** pathKey wires (armWires/emitOne); leaves-by-
  fiat removal; def-retyping + `on:*` gates re-expressed; treeSig forkKey
  dimension exercised. Requires 1, 4.
- **Unit 8 — duplicate-source guard:** `Node.addAnchor` (node.ts:413) warn
  `component-source-duplicate`, keep-first, skip-second, UNCONDITIONAL
  (§10.ae). **Requires Unit 11** (demos rebuilt first — no shipped doc
  trips it). → Unit 12 (guard tests + seeded-test re-expression).
- **Unit 9 — serialize:** roleOrder + `container`/`content`; content anchors
  EXCLUDED from the target string sort (preference order survives
  round-trip); contentNodes-anchor round-trip. Requires 2, 3.
- **Unit 10 — derived:** per-path `placement` root (final zone name, not
  first-anchor read); `children.length` = path-derived children. Requires 4.
- **Unit 11 — demos + smoke rebuild:** static page (22 prototypes +
  contentNodes attachment + `targetPlacement` arrays, no handlers/clones);
  runtime page + census asserts KEPT (re-pinned per F-13); fork-claim drops
  (theme/panel/feed single-source; round-trips re-asserted; build-demo.mjs
  `panelArms` throw replaced); static census block; profile fields; ratio
  guard: placement-as-baseline for the static page + TODO (§10.ad), 2.5× vs
  ~1.5× reconciliation note (N-5); index.html; builder script. Requires 2.
  → Unit 8, Unit 12 (smoke).
- **Unit 12 — tests (E2E-1…4 + guard + census + unit renames):** E2E-1
  (23-node/4095 census); E2E-2 (minting-enabled fixture; compile-scope +
  wire-identity); E2E-3 (all + half consumers); E2E-4 (placement-attach,
  no depth>4 recalc); guard tests (imperative + seeded re-expression of
  node.test.ts:475/615/957, graph.test.ts:433, render.test.ts:579 — see
  Risk R-2); trigger-identity/silent-abort; order preservation; `#` warn;
  the 26-row §10.3 updates. Requires 2, 4, 5, 6, 8, 11.
- **Unit 13 — docs sweep (46 spec rows):** all §10.ac.4 SPEC rows +
  F-13 annotations + FRESH-CONTEXT-SUMMARY + AGENTS.md item-4 wording +
  designing-pages.md §3/§5/§8/§11/§12 + §14 lessons. Parallel; final.

Critical path: 0 → 1 → 4 → 5 → 6 → 12; 2 → 11 → 8 → 12. Units 1/2/3
independent in parallel.

#### 10.af.4 Final risk list (implementation time)

| # | Risk | Mitigation / owner |
| --- | --- | --- |
| R-1 | **F-13 ripple** (translate-global minting): runtime census re-pin, state-first-analysis §4.1 annotation, legacy-bootstrap attach semantics, reverse strip — if any is missed, e2e/smoke go red in a way the 126-row set does not name explicitly | Unit 0 pins the chosen reading; Unit 2 includes the strip; Unit 12 includes the re-pinned runtime asserts |
| R-2 | **Unconditional guard vs seeded fork-construction tests** (N-3): node.test.ts:475/615/957, graph.test.ts:433, render.test.ts:579 build forks via constructor seed — keep-first now drops the second anchor; warn-count assertions at risk; re-expression is not itemized in the 126 rows | Unit 8 includes the seed-path policy test; Unit 12 re-expresses the five sites |
| R-3 | **forkKey = pathKey on EVERY state** changes wire keys / serialized output / prevMap reuse for all existing pages and ssr fixtures (not just path-states) | Unit 1's red test asserts forwarding; ssr-render fixtures regenerated in Unit 3/12 |
| R-4 | **Preference-order preservation** — serialize sort is the known order-killer; other order-breaking paths (ops-time anchor insertion, materializeAnchors dedup, `makeCs` copy) are unverified | Unit 9 includes the round-trip order test; Unit 4 asserts mint-order first-match |
| R-5 | **Ratio-guard baseline**: static page has no method variants (single total); AGENTS ~1.5× vs demo-smoke 2.5× unreconciled; page profiler does not time pass-2 — the exact blow-up mode AGENTS item 4 warns about | §10.ad placement-baseline + TODO; Unit 11 adds the baseline decision + re-baseline note |
| R-6 | **4095-state single-pass enumeration perf unknown** (Q6): the R2.2 bijection is arithmetic; the profile-ratio watch is the tripwire, not a guarantee | Unit 4 census test + Unit 11 ratio guard; flag any `total − Σ(measured)` dominance |
| R-7 | **`#`-freedom validation is new code**: shipped demo zone names/ids must be audited for `#` before the warn lands (feature-matrix 'content' zone is safe; sweep others) | Unit 2 `#` warn + repo grep in Unit 13 |
| R-8 | **Role-token wording collisions** (content role vs content value/array/contentNodes/legacy target path): prose-only but doc-wide; quoted+backticked convention is the mitigation | Unit 13 sweep per §10.x res-5 |
| R-9 | **Legacy citations unverifiable** (`Preempt/` absent): placement semantics rest on provenance-level records (C-8) — intent-with-known-bugs, not ground truth | recorded; no action beyond §10.z discipline |

Verdict (restated): **PROCEED-TO-IMPLEMENT** — Unit 0 core rewrite first,
then Units 1-13 in the ordered plan; the only open reading (F-13) is pinned
above. The validation trio (npm test / typecheck / demo:smoke + profile
ratio watch) gates each unit per AGENTS.md item 4/7.
