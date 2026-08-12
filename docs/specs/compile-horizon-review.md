# Compile-Horizon / Landmark Proposal — Feasibility Review

Status: design review of the proposed "compile horizon / landmark" pattern for
lifting `MAX_COMPILE_DEPTH`. No code changed. Companion context:
`docs/specs/fork-stress.md`, `docs/specs/contract.md`, `docs/specs/node.md`
(FS-7), `docs/specs/pipeline.md` (per-slice lock), `src/core/resolve.ts`,
`src/core/node.ts` (`chainRoot`/`compile`).

## 1. What the proposal asks

Goal: allow arbitrary tree depth from the root while keeping root-bound checks.

Mechanism sketch (paraphrased from the user):
1. A node whose compile walk hits the depth limit before reaching the root
   "links" the node(s) it stopped on — a landmark anchor.
2. Other nodes at similar depth, on encountering the landmark anchors, stop and
   join the link (its presence signals "too long to reach from here").
3. When the landmarked node eventually compiles to root, the linked nodes are
   alerted, compile to the landmark, and use its wire/fork information.
4. If no alert arrives before compiles resolve, the node is separated from
   root and is discarded.
5. Landmark anchors are discarded if the node moves (no false signals).

## 2. Feasibility verdict

**Partially feasible, with two fundamental gaps that change the scope of the
change.** The landmark idea is a sound *direction* — it is essentially a
memoized/trusted "this ancestor is root-bound" cache — but as specified it
solves only the *chainRoot* half of the problem and does not address the
*resolution* half, and its alert lifecycle conflicts with the current
compile-pipeline contract. Details below.

### 2.1 What the depth cap actually guards (grounding)

Two independent caps, both `MAX_COMPILE_DEPTH = 8`:

1. **`chainRoot` (node.ts:47-70)** — walks the parent-anchor chain upward.
   `depth > MAX_COMPILE_DEPTH` → `{kind:'loop'}`. This is what drops the
   fork-stress L8 nodes (9 links) and any node whose parent chain exceeds 8
   hops. Pinned by `tests/unit/node.test.ts` C9 (deep-borrow) and
   `docs/specs/node.md` FS-7.
2. **`resolveNames` (resolve.ts:100)** — counts *resolution recursion depth*
   (`continueArm` → `resolveNames(owner, ..., depth+1)`) while walking
   provider chains (self → descendants → ancestors → fallback). A node whose
   target resolves through a multi-hop provider chain (owner → owner's own
   targets → …) trips this at 8 steps.

The landmark proposal targets #1. It does **not** address #2. That is the
first gap.

### 2.2 Gap A — the landmark doesn't short-circuit resolution

A node that reaches a landmark still has `target` anchors. Resolution
(`resolveArms` → `fitReference` → `continueArm` → recursive `resolveNames`) is
a *separate* walk over providers, not the parent chain. The landmark tells the
node "your chain to root is trustworthy" — it says nothing about whether the
node's *components* resolve, and the proposal's "use its wire/fork information"
is underspecified:

- The landmark's compiled state carries *its own* bindings (resolved for the
  landmark node), not the deep node's. Fork arms on the deep node derive from
  its own provider fan-out, not the landmark's.
- For a deep consumer whose target names resolve at the root (e.g.
  fork-stress values/link layers), resolution still walks the ancestor chain
  from the deep node to the root — which for depth ≥ 9 either hits the
  `resolveNames` cap (#2) or is O(depth) per arm.

So "compile to the landmark and use its wire/fork info" must be defined as one
of:
  (a) resolution may *borrow the landmark's resolved bindings* when the deep
      node's target names ⊆ the landmark's resolved names (a new resolution
      rule — changes resolve.ts semantics), or
  (b) resolution is allowed to walk *through* a landmark to the root without
      counting the landmark→root segment against the cap (a cap-scoping
      change), or
  (c) the depth cap is removed for acyclic chains and `resolveNames` relies on
      its existing `path` visit-set (the `seen`/cycle detector) as the *only*
      loop guard.

None of these are in the proposal; each is a distinct, sizeable change.

### 2.3 Gap B — the alert lifecycle conflicts with the compile contract

The proposal's step 3–4 implies a **deferred retry**: a deep node is compiled
in pass N, finds a landmark, and must be *recompiled* in a later pass when the
landmark's root-boundness is proven. The current pipeline:

- `compile(slice)` is **synchronous and single-pass** (node.ts:445-597):
  `chainRoot` over the slice → `viable` set → resolution. There is no
  "wait for the landmark then recompile" phase.
- The supervisor's pass-2 (supervisor.ts:213-262) compiles each dirty node
  **once** per flush with a bounded focused slice, and the DECIDED
  incremental-render contract is "each node compiled exactly once" per update.
- A landmark that is *not yet root-proven* cannot, in the same synchronous
  pass, both (i) be compiled and (ii) alert dependents that were compiled
  earlier in the same pass. The pass is root-first (`actionable` order,
  ORD-H5), so in practice ancestors *are* compiled before descendants — which
  is exactly the ordering that makes a landmark usable *without* an alert
  round-trip: **if chainRoot memoizes root-boundness per node as it walks
  root-first, a descendant can stop at an already-proven ancestor.** That is
  the feasible kernel of the proposal.

The "discard if never alerted" rule (step 4) is also dangerous as written:
"before compiles resolve" is undefined in a synchronous pipeline. A deep node
in a *valid* tree whose landmark is simply compiled later (same pass, later
position) would be wrongly discarded if it checks before the landmark
compiles. The alert model must be replaced by either (i) in-pass root-first
memoization (no alerts needed), or (ii) an explicit multi-pass fixpoint in the
supervisor's pass-2 (a `pendingOnLandmark` set, re-entered into the dirty set
when the landmark resolves — breaks "compiled exactly once").

### 2.4 What is genuinely feasible (the usable kernel)

1. **Root-first memoized chainRoot.** Compile already processes the slice in
   root-first actionable order. A `Map<NodeId, ChainKind>` cache lets
   `chainRoot(node)` return `kinds.get(parent.id)`-derived results instead of
   re-walking: `kind(node) = parent==null ? unplaced : kind(parent)`, with
   token/cycle handling at the top. This makes deep-tree chain classification
   O(n) and removes the *need* for a depth cap on the parent-chain walk —
   `seen` (the true cycle detector) remains the loop guard. This is the
   "landmark" idea, realized without link anchors or alerts.
2. **Distinguishing `loop` (cycle) from `depth-exceeded`.** Currently both
   return `{kind:'loop'}` and both log `circular-source`. The proposal needs
   the distinction (depth-exceeded is recoverable via a landmark; a true cycle
   is not). `ChainKind` gains a `'too-deep'` variant; compile keeps `loop` for
   real revisits only. Tests C9/FS-7/probe-6 must be re-audited: the *cycle*
   cases stay; the *pure-depth* cases change behavior.
3. **Landmark anchors on the Link system.** Doable: a new anchor role (e.g.
   `'landmark'`) on the stopped-on node, carried on a `Link`. The moving/discard
   rule (step 5) maps to the existing sweep/detach paths (link destruction on
   `move`/`detach`/`destroy`). But this is the *least* necessary part — the
   memoized chainRoot in (1) makes standalone landmark anchors unnecessary for
   the parent-chain problem.

## 3. Critique (ordered by severity)

### C1 — Solves the wrong half first (blocking)
The proposal addresses `chainRoot` (parent-chain depth) but the fork-stress
use case that motivated it (depths 9-12) also requires *resolution* past depth
8 for values/link consumers (`resolveNames` cap). Without a resolution-side
answer, depth 9+ still fails for any consumer deeper than 8 — the landmark only
rescues nodes with no targets. **The spec must define resolution past the
horizon before the landmark can claim "arbitrary depth".**

### C2 — "Use its wire/fork information" is underspecified (blocking)
Fork arms and bindings are node-local. A landmark's `CompiledState` does not
contain the deep node's bindings. The proposal must specify how a deep node
obtains *its own* fork arms / resolved values when the provider walk would
exceed the horizon (options in §2.2 a–c). Without this, step 3 cannot be
implemented.

### C3 — Alert lifecycle vs single-pass compile (blocking)
The pipeline has no cross-pass alert channel. Implementing "alert when
landmark resolves" requires either the root-first memoization replacement
(recommended — no alerts) or a new supervisor pass-2 dependency phase (breaks
"compiled exactly once", adds a `pending` set, re-entrancy, and ordering
contracts). The "discard if never alerted" rule is unsafe as stated (see
§2.3).

### C4 — Landmark staleness is under-specified (major)
Step 5 only covers "node moved". Landmark validity also breaks on:
- landmark node **destroyed** (payload drop, explicit `destroy`),
- landmark **detached** (moved out of a root-bound chain),
- landmark's own parent chain becoming non-root-bound (its ancestor moved),
- **sibling subtrees** sharing a landmark that later diverges.
Every one must invalidate dependents, and the proposal must say whether
invalidation is eager (sweep walks dependents) or lazy (dependents re-verify
on next compile). The existing sweep (`registry.ts runSweep`, `markPending`)
is the natural home but currently has no dependent tracking.

### C5 — Landmark anchors in serialization (major)
If landmark anchors live on `Node.anchors`, they will serialize into
`preempt-initial-data` / reverse-translation output unless explicitly
excluded. `serializeSlice`/`translate` walk `anchors` wholesale. A compile-time
cache must be either (i) a separate side-table keyed by node id (not real
anchors), or (ii) explicitly stripped in serialization. The proposal's "link
system" phrasing risks polluting the shipped document and PAR-5 parity.

### C6 — Depth cap is a documented, tested loop-safety contract (major)
`MAX_COMPILE_DEPTH` is pinned in `contract.md:173`, `tests/unit/node.test.ts`
(C9 + `expect(MAX_COMPILE_DEPTH).toBe(8)`), `docs/specs/node.md` FS-7,
`docs/specs/pipeline.md` (per-slice lock), and `docs/skills/designing-pages.md`
(C9/FS-7/probe-6). Any change is a **spec change** (the user's intent) but the
proposal as written keeps a depth cap as the landmark trigger — so the spec
still has a cap, just with an escape hatch. The cleanest contract change: the
cap becomes "the *resolution recursion* cap" (unchanged) and the *parent-chain*
walk becomes memoized + cycle-only (no cap), with tests updated accordingly.

### C7 — The "join the link" fan-in (minor/moderate)
"Other nodes at similar depth can stop and join" implies a shared landmark with
multiple dependents. That is fine with a side-table (map landmark → dependents)
but is another registry the sweep must maintain. Memoized chainRoot needs none
of it.

## 4. Necessary changes list (if pursued)

### 4.1 The recommended path (memoized root-bound chains, no alerts)

1. **`src/core/node.ts`** — `chainRoot` becomes iterative + memoized over the
   compile slice: classify each node from its parent's classification
   (root-first). Keep `seen`/cycle detection. Replace `depth > MAX_COMPILE_DEPTH
   → loop` with a cycle-only rule for the *parent-chain* walk. Add
   `ChainKind` variant `'too-deep'` OR remove the parent-chain cap entirely
   (decide: cap removed vs. landmark escape hatch).
2. **`src/core/resolve.ts`** — keep the `resolveNames` recursion cap as the
   loop-safety boundary for *provider chains*, but allow the ancestor walk in
   `fitReference` to treat an already-viable ancestor's *resolved bindings* as
   candidates (borrow-through-horizon), or scope the cap to exclude the
   root-bound segment. This is the resolution-side answer C1/C2 require.
3. **`src/core/constants.ts`** — if the parent-chain cap is removed, keep
   `MAX_COMPILE_DEPTH` as the resolution-recursion cap only; update its doc
   comment; keep the value 8 (or rename to `MAX_RESOLVE_DEPTH` — a rename is a
   breaking API change; weigh against docs).
4. **Tests** — `tests/unit/node.test.ts` C9: split the deep-borrow test into
   (a) *cycle* (unchanged: dropped as loop) and (b) *deep acyclic chain*
   (now compiles, `MAX_COMPILE_DEPTH` no longer trips the parent walk). Add a
   deep-tree compile test (fork-stress depths 9-12). Re-audit probe 6 /
   FS-7 / SSR-V8 depth-cap scenarios.
5. **Docs** — `contract.md` (constants table), `node.md` FS-7, `pipeline.md`
   per-slice lock text, `designing-pages.md` C9 row, `RENDER_PROCESS_NOTES.md`
   DECIDED entry. Update the loop-safety story: "cycles drop; *depth* is not a
   loop signal for acyclic parent chains."
6. **`docs/specs/fork-stress.md`** — un-cap the demo to depths 9-12 once the
   resolution answer lands (the memoized chainRoot IS that answer for this
   tree — see §6.3); update the "pages at depth 2, 4, 6, 8" text to the full
   series; there is no remaining negative depth-cap assertion to keep.

### 4.2 The full landmark-anchor path (only if alerts are wanted)

If the user insists on the link-anchor + alert design rather than memoization:

7. **`src/core/types.ts`** — new anchor role `'landmark'` (and its validation
   in `src/core/validation.ts` / tag schemas).
8. **`src/core/supervisor.ts`** — pass-2 dependency phase: when a landmark
   node resolves root-bound, re-enter its dependents into `pass2Dirty`;
   add a `landmarkDependents` side-table (NOT serialized anchors). Amend the
   "compiled exactly once" DECIDED note.
9. **`src/core/registry.ts` / sweep** — dependent invalidation on move,
   detach, destroy, or ancestor reparent (C4); lazy re-verify as the default.
10. **`src/core/serialize.ts` / `translate.ts`** — exclude landmark anchors
    from `serializeSlice` and reverse translation (C5).
11. **Determinism** — define the pass boundary for "never alerted ⇒
    discard": recommend a bounded fixpoint (max `MAX_COMPILE_DEPTH` rounds)
    rather than the ambiguous "before compiles resolve".

## 5. Recommendation

Adopt the **memoized root-first chainRoot** (§4.1) as the implementation of
the "landmark" idea: it delivers the user's goal (arbitrary parent-chain
depth, root-bound checks preserved) without link anchors, alerts, or a new
pass-2 dependency phase, and it keeps the true cycle detector as the only loop
guard. Then solve the *resolution* cap separately (borrow-through-horizon or
cap scoping) — that is the change that actually unblocks fork-stress depths
9-12. The link-anchor + alert mechanism (§4.2) is only warranted if
cross-pass recompilation is desired for its own sake; as specified it is
over-engineered relative to the memoization that achieves the same outcome in
one synchronous pass.

---

## 6. DECIDED spec — memoized root-first chainRoot (adopted)

Status: **DECIDED** (user-approved direction; land via the subagents workflow
spec → red → green). Supersedes the "landmark link anchors + alert" mechanism
(§4.2) which is **PARKED** unless cross-pass recompilation is later wanted.

### 6.1 Behavior contract

1. **Parent-chain classification is memoized per compile.** `compile(slice)`
   classifies every node's chain kind **root-first**: a node's kind derives
   from its parent's already-classified kind, plus its own anchor facts. The
   whole parent chain is walked at most once per compile (O(n) total, not
   O(n·depth)).
2. **Acyclic parent chains have NO depth cap.** `chainRoot`'s
   `depth > MAX_COMPILE_DEPTH → loop` rule is **removed** for the parent-chain
   walk. The only loop signal on the parent chain is a **revisit** (the
   `seen` set / `path` guard). A 9+-link acyclic chain compiles to an
   actionable state (its deepest nodes are root-bound and render).
3. **`MAX_COMPILE_DEPTH` remains, re-scoped to resolution recursion.** The
   constant (value 8, unchanged) still caps `resolveNames`/`continueArm`
   recursion depth (resolve.ts:100) — the provider-chain loop guard. Its doc
   comment changes: "resolution recursion cap; parent-chain classification is
   memoized and cycle-only."
4. **Cycle detection is unchanged.** Real anchor cycles (A→B→A) still drop as
   `loop` with `circular-source`, at op time (FS-5) and compile time (FS-7).
5. **Drop reasons stay distinct.** `'loop'` = a genuine revisit. A node that
   is merely deep but acyclic is **actionable**, never dropped. (No new
   `'too-deep'` variant is needed because the parent chain no longer has a
   depth cap.)

### 6.2 Compile ordering invariant (REVISED per reviewer F1/F2 + round-2 F1/F2/F5)

**Memoization is ORDER-INDEPENDENT — it is a cache, not a substitute for the
walk.** The slice is NOT guaranteed parent-before-child: `focusedSliceFor`
(supervisor.ts:30) builds the ancestor chain **leaf-first** (`for (cur = node;
cur; cur = cur.parent)`), so the focused (deepest) node precedes its parents in
pass-2 slices. Therefore:

1. The memoized classifier runs in **three phases**:
   - Phase A — classify **unconditional kinds** from local anchor facts only:
     `destroyed`; no child anchor → `unplaced`; child anchor present but the
     parent-anchor **link has no parent anchor** (node.ts:54/70 — constructible
     via raw `new Link()` + `addAnchor('child', …)`) → `slice-root` if in-slice
     else `unplaced` (round-5 F8); parent-anchor target is a string token
     (`rootNode`/`component`/`contentNodes`/`other`); parent-anchor target is
     a destroyed owner. These are order-free.
   - Phase B — for any node whose parent-anchor target is an object whose
     kind is **not yet known** (in OR out of slice), **walk the chain** from
     that parent with a **per-walk `seen` revisit set** (NOT a shared set —
     a shared set would false-positive `loop` when two in-slice nodes share
     an out-of-slice ancestor). The walk is bounded by `seen` only — no depth
     cap. **Walk termination rules (explicit, round-5 F9 + round-6 F1 +
     round-7 F2):** a revisit ⇒ `loop`; a string token ⇒ that token's kind; a
     **destroyed node terminates the walk ⇒ `destroyed-owner`** — destroyed
     wins over the childless rule and is EXEMPT from the pass-through rule (a
     destroyed node can retain child anchors; node.ts:64 precedes the
     childless check, round-6 F1); a **childless node terminates the walk**
     with the **slice rule** (`slice-root` if in-slice, `unplaced` if not) —
     the childless rule WINS over the known-kind rule (every in-slice
     childless node is Phase-A `unplaced`, i.e. already known-kind; the walk
     must still terminate with `slice-root` for a re-entering chain, matching
     node.ts:66); an **absent parent anchor terminates the walk** with the
     **     slice rule** (`slice-root` if in-slice, `unplaced` if not — node.ts:54,
     round-7 F2: the walk terminates AT a parentless node, whether it starts
     there or reaches it via an out-of-slice parent); a **known-kind node
     WITH a child anchor (and not destroyed) is never a walk stop** — only
     Phase C inherits from it. This makes cycles classifiable (a parent cycle
     has no Phase-A base; Phase B walks it and `seen` returns `loop`).
   - Phase C — memoized propagation over the now-complete parent map: any
     node whose parent's kind is known inherits it, EXCEPT when the in-slice
     parent has no child anchor **and is not destroyed** — then the child's
     chain **terminates at that parent** ⇒ `slice-root` (round-2 F2; mirrors
     node.ts:66; the destroyed-before-childless precedence of node.ts:64 is
     preserved — a destroyed childless parent ⇒ `destroyed-owner`, round-7
     F1). Propagation is a pure cache over Phase-A/B results.
2. `slice-root` retains its exact current meaning: a chain that **terminates**
   at an in-slice node whose parent-anchor is absent (node.ts:54 — the
   parentless case), or at a childless in-slice node (node.ts:66 — including
   the Phase C exception, round-3 F4 / round-9 F2 shorthand). The cache never
   fabricates it outside those cases. A walk may leave the slice and re-enter
   at an in-slice childless or parentless node; that termination is
   `slice-root` (round-2 F2, round-8 F4).
3. **Parity invariant (test, round-8 F1):** for any slice, the memoized
   classification equals the per-node `chainRoot` walk for every **non-
   destroyed** node whose full chain is in the slice, and for every node
   whose walk leaves the slice it equals the walk's TRUE termination kind
   (token/destroyed-owner/unplaced/`slice-root` when it re-enters at a
   childless or parentless in-slice node). **Destroyed nodes are dropped at
   node.ts:468 BEFORE kinds are consulted** — their kinds map entry (if
   stored) is `destroyed-owner` (Phase A), and the parity claim covers only
   non-destroyed nodes; a child of a destroyed-with-child-anchor parent
   inherits `destroyed-owner` via Phase C (round-6 F1 / round-8 F1). Covers
   leaf-first pass-2 slices (round-1 F1) and cycles (round-2 F1);
   `slice-root` terminations arise when the walk re-enters the slice at a
   childless or parentless in-slice node (round-8 F4).

### 6.3 Resolution past the horizon (CORRECTED per reviewer round-3 F1)

**Reviewer-verified: fork-stress resolution is entirely `chainRoot`-gated —
there is no resolution-side block for its tree.** `fitReference` is fully
iterative (self → descendants stack → ancestors `for` loop → fallback,
resolve.ts:52-77) with no depth accounting; the only cap is `resolveNames`
provider-chain **recursion** (resolve.ts:100), tripped only via
`continueArm` → `resolveNames` on a provider's OWN targets (resolve.ts:160-167).
Fork-stress providers sit at the root with no targets, so no recursion ever
happens — every values/link consumer resolves in one iterative pass regardless
of depth.

Consequently the memoized chainRoot flip **alone** unblocks fork-stress depths
9-12. Post-flip state: depths 9-11 turn green (L8 handler children now
actionable); depth 12's rendered-count checks turn green and its compile
accelerates — the remaining risk is the smoke's 250ms settle for a 4095-node
tree (its banner may not land), which §6.4 covers (round-4 parked-2, round-6
F2). Pre-flip, depth 12 fails BOTH the rendered-count checks AND the settle.

A FUTURE tree whose deep consumers resolve through *multi-hop provider
chains* (a provider that itself targets another name) would still trip the
`resolveNames` recursion cap at 8 — that remains the deferred resolution
change. The correct contract to carry forward (and the only formulation a
TestWriter should derive from): **"`resolveNames` recursion cap still trips
(provider chain ≥ 9 hops → drop)"** — NOT "root-sourced targets deeper than 8
remain capped" (which is false and a TestWriter trap).

### 6.3a `compileRemote` and the registry sweep (REVISED per reviewer F3 + round-2 F4)

`compileRemote` (node.ts:431) and the registry's pass-2 remote coalescing
(registry.ts:81) also gate on `MAX_COMPILE_DEPTH`. **Reviewer-verified: the
gate there is OBSERVATIONALLY INERT for dirty nodes** — every dirty node is
re-entered at depth 0 by the sweep loop (registry.ts:79-82), `markRemote`
dirties the parent (topmost dirty ancestor ≤1 level above any edited node),
and `visited` is additive before recursion — so a deep node edited via pass-2
recompiles through today's sweep regardless of the gate. Therefore:

- §6.3a makes NO behavioral claim about pass-2 deep edits; the
  `compileRemote` gate removal is **consistency cleanup only** (the two
  passes should agree that acyclic parent chains are not depth-limited).
- The genuinely behavior-changing fix for deep chains is the `chainRoot`
  cap removal (§6.2) — all new tests are scoped to that flip.
- Docs the re-scope touches (ADDED to §6.5): `node.md` §8.2 (remote compile
  row), `contract.md`'s `compileRemote` row.

### 6.3b Fallback interaction with `slice-root` prevalence (reviewer F4)

`fitReference`'s fallback (resolve.ts:66-75) terminates arms as
`owner-terminated` when it reaches a non-viable slice node that provides a
name. Under the revised §6.2, `slice-root` is no more prevalent than today
(the cache never fabricates it), so F4's concern is resolved by the F2 fix;
a note is kept that `slice-root` prevalence must not increase.

### 6.4 Test-surface delta (red set for the TestWriter)

- `tests/unit/node.test.ts` **C9** splits (round-7 F4: the current C9 at
  node.test.ts:591 is pure-depth — there is NO cycle case inside it, so the
  cycle arm is NEWLY WRITTEN, not "unchanged"): (a) *cycle* — NEW test,
  anchor circle drops as `loop` + `circular-source` (carried from e2e probe
  2); (b) *deep acyclic chain* (9+ links) — now compiles to actionable, NO
  drop, NO warning.
- `tests/unit/node.test.ts` **FS-7 test** (line ~737, 10-link chain): flips
  identically to C9(b) — deep acyclic chain now actionable (round-2 F3).
- `tests/integration/api.test.ts` **T13** (lines ~353-376, 12-link chain +
  pass-2 edit): flips — deep node now compiles actionable with no
  `circular-source` diagnostic; assertions updated (round-2 F3).
- New: deep-chain memoization correctness (chain of 9..20 links → deepest
  node actionable with correct `pathKey`); memoized kind equals per-node
  walk result (parity, §6.2.3 — including leaf-first pass-2 slices, round-1
  F1, and **in-slice cycles** — round-2 F1); in-slice childless parent ⇒
  child `slice-root` (round-2 F2); out-of-slice parent under a prototype
  still drops as `prototype-terminated`, NOT `slice-root` (round-1 F2);
  two in-slice nodes sharing an out-of-slice ancestor do NOT false-positive
  `loop` (per-walk `seen`, round-2 F5); `MAX_COMPILE_DEPTH` value still 8;
  `resolveNames` recursion cap still trips (provider chain ≥ 9 hops → drop).
- `tests/e2e/ssr-html-validity.test.ts` **SSR-V8** (line ~270): deep arm
  flips from absent to present — update the expectation to "deep acyclic arm
  renders well-formed".
- `tests/integration/supervisor.test.ts` (line ~90): `compileRemote` spy —
  no behavioral change (round-2 F4); leave as-is.
- e2e `loop-safety` **depth-cap surface, ALL copies** (round-4 F1 / round-5
  F1-F3):
  - `tests/e2e/loop-safety.test.ts:165` ("depth-cap trip") — a 10-hop acyclic
    chain asserting `loop`-drop; flips to actionable.
  - `demo/loop-safety.js` probe 6 (~line 206, the demo-page mirror, smoke-
    visible via scripts/demo-smoke.mjs) — identical 10-hop chain; flips to
    actionable; the demo banner gate must be updated.
  - `demo/loop-safety.html:69-73` — the static HTML mirror hardcodes "Probe 6
    — depth-cap trip … dropped as `loop` with a `circular-source` warning";
    the expected-behavior text flips to "deep acyclic chain compiles
    actionable".
  - `tests/e2e/README.md:13` — lists "depth-cap trip" as a loop-safety probe;
    update to reflect the flip.
  A NEW cycle probe still trips (unchanged).
- **`demo:smoke` gate (round-3 F1):** fork-stress depths 9-11 flip from red
  to green (L8 handler children now actionable), and depth 12's compile
  accelerates — pre-flip depth 12 fails the rendered-count checks AND the
  250ms settle (module work ≈1.35s, banner never lands); post-flip only the
  settle remains, so it must be verified/lengthened for the depth-12 banner
  to land (round-4 parked-2 / round-6 F2 / round-7 F3).
- **`demo/fork-stress.js` + `docs/specs/fork-stress.md` (round-3 F2 / round-4
  parked-3):** the rendered-count checks now include layers 9+ (no
  depth-cap drop remains anywhere in the demo surface; §4.1(6) already
  reflects this); `docs/specs/fork-stress.md:13,42-43`,
  `docs/skills/designing-pages.md:235,285`, and **`demo/index.html:64-68`**
  (round-5 F2) already say "pages 2,4,6,8" / "×4 depths" / `d{2,4,6,8}` —
  all stale vs the smoke's 8 depths and must be updated to the full series;
  `demo/index.html:33` ("depth-cap trip" loop-safety probe description) also
  flips.

### 6.5 Docs to update (with this change)

`contract.md` (constants table + MAX_COMPILE_DEPTH comment + `compileRemote`
row — fold in the pre-existing signature staleness at :199:
`visited?: Set<Node>` / `: CompiledState` → `visited?: Set<string>` / `: void`
— round-9 F3 / round-10 F1), `node.md` §8.2 (remote compile row), §8.3 (loop trip = revisit only for
parent chain), §2 **ArmDropReason** (line ~107: "depth-cap/visit-set trips
count AS loop" — narrow to "resolution-recursion trips count AS loop";
parent-chain depth no longer a drop reason), §9 FS-7 (revisit → loop; deep
acyclic → actionable), `designing-pages.md` (C9/FS-7 row line ~48 AND §9
loop-safety prose line ~195 "borrow depth caps" — both narrow to
resolution-recursion; fork-stress `d{2,4,6,8}` → full 2-12 series; line ~295
"drives the runtime layers (L4 handler … L7 link)" — stale, demo now runs to
L11 — round-8 F2),
`pipeline.md` **§2.1 DropReason `'loop'` row** (line ~128: "loop-guard/depth-
cap trips count AS loop" — narrow to resolution recursion; the per-slice
emission lock's `maxDepth` at pipeline.ts:156 is UNCHANGED — it guards
emission recursion, not compile), `docs/specs/fork-stress.md` (un-cap to
depths 9-12; page-series text at :13/:42-43 AND the §Tree-shape heading at
:28 "depth 8 = 255 nodes" → depth 12 = 4095 — round-9 F1), `demo/index.html` (page-series + probe
description), `demo/loop-safety.html` (probe-6 copy), `tests/e2e/README.md`
(probe list), `src/core/constants.ts` (doc comment, per §6.1.3),
`FRESH-CONTEXT-SUMMARY.md` (line ~61: "depth caps (MAX_COMPILE_DEPTH=8)"),
`demo/feature-matrix.html` + `.template.html` (line ~52, F3 note: "trips on
the borrow-walk/ancestry cycles and depth caps" — narrow to
"resolution-recursion depth caps"; stays substantively true, no live depth
assertion — round-7 F5),
`RENDER_PROCESS_NOTES.md` — BOTH the new DECIDED entry AND the **existing**
fork-stress DECIDED entry (~line 798: stale "`fork-stress-d{2,4,6,8}.html`"
and "drives the runtime layers (L4 handler … L7 link)" text — the demo now
goes to depth 12 / L11).
