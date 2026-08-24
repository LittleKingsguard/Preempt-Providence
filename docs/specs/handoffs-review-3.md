# Handoff Round 5 (DEFECT-SSR-REMOVE) — three-agent gate (steps 1-2)

Status: **RESOLVED — PROCEED-AS-RESHAPED, LANDED 2026-08-23.** The step-3
verdict section below is the gate result; the TDD implementation + the full
validation trio (1028 tests, typecheck, build, demo:smoke SMOKE OK — derived-
fork pins on-curve) landed the same day (defects.md DEFECT-SSR-REMOVE row).
Step 3 (change-analysis) appends its section below the two present sections.
Companion context: `docs/HANDOFF-4.md` (Round 5 row), `docs/specs/adapters.md`
§4.6 / §10.2 / §3.7, `docs/specs/render.md` §2-3 / §8 (PAR-5), `docs/specs/handoffs-review.md`
and `docs/specs/handoffs-review-2.md` (format template). NOTE: the consumer
battery provenance (`docs/specs/adapter-parity-battery.md` /
`tests/adapter-parity-battery.test.mjs` / `adapter-parity-greens.md`) lives in
the CONSUMER repo (adjacent folder, per HANDOFF-4's framing) — not this repo's
files.
Findings verified against `src/core/adapters.ts` (full `SSRFragmentAdapter` + `DomAdapter`),
`src/core/render-helpers.ts` (`applyOps`/`wireKey`/`findEl`), and
`tests/unit/adapters.test.ts` (FRG-* block).

NOTE (file history): this file was created by the step-2 critique agent (which
ran as a step-1-absent run — the NOTE below was its original header). The
step-1 validity section was appended afterwards (2026-08-23) and is READ-ONLY
analysis — no `src/` or `tests/` file was modified (verification used a
monkey-patch of `dist/core/adapters.js` in `/tmp/opencode/repro/`). The
critique's key finding (remove→re-create resurrection) is independently
CONFIRMED below; its amendments are endorsed.

## Step 1 — Validity agent

Verdict: **FEASIBLE-WITH-RESHAPE** — the proposed detach shape is correct,
implementable exactly as described, and closes the filed divergence on the
plain-remove path (verified empirically). It must, however, be amended with a
`this.created` purge: the D3-legal remove→re-create path otherwise resurfaces
the dead descriptor as a top-level floating fragment (reproduced independently
below). That amendment is exactly what the step-2 critique identified; the
core shape itself needs no rework.

### What the proposal asks (paraphrase)

`SSRFragmentAdapter.removeEl(wire, forkKey?)` should stop being a bare
`this.fragments.delete(wireKey(...))` (adapters.ts:395-397) and instead mirror
`DomAdapter.removeEl`'s detach (adapters.ts:206-221): resolve the fragment,
splice it out of its parent state's `children`, set its `parent` to null, and
`rematerialize(parent)` — so a removed/destroyed element no longer contributes
to the serialized `toString()` output.

### The defect reproduces as stated

Confirmed. The HANDOFF-4 repro path (`/tmp/opencode/repro/repro-ssr-remove.mjs`)
emits `before: <div><div></div><div></div></div>` and `after removeEl('doomed'):`
**byte-identical** — the removed element survives in the parent's `children`
array (materialized at `appendChild` time, adapters.ts:390-392, never recomputed
because `removeEl` does not touch the parent). NOTE on that script: its final
assertion prints "OK: removed element dropped", which is a **false negative** —
it checks `html.includes('doomed')`, but wire names never appear in the
serialized HTML (no `data-node-id`/id attribute is emitted for them), so the
string is absent both before and after. The defect is proven by the output being
unchanged, not by that check.

### Feasibility — the proposed shape is implementable as stated

Walking the actual code, every element the fix touches exists:

- **`appendChild`** (adapters.ts:386-393) pushes the child **`FragmentDescriptor`
  object** into `ownerState.children` and sets `childState.parent = owner`. So
  the parent linkage is a descriptor reference, not a key.
- **`states`** is a `WeakMap<FragmentDescriptor, SSRFragmentState>`
  (adapters.ts:319) and `SSRFragmentState` declares `children:
  FragmentDescriptor[]` + `parent: FragmentDescriptor | null` (adapters.ts:264-272).
- **The parent is reachable from the wire alone** — no new state is required:
  `fragments.get(wireKey(wire, forkKey))` → fd → `states.get(fd).parent` → the
  parent fd → `states.get(parent).children`. `states.get(parent)` is the right
  lookup: `parent` is a FragmentDescriptor and `states` is keyed by descriptor.
- **`rematerialize(parent)`** (adapters.ts:428-433) walks the ancestor chain
  rebuilding each `contentText` = `escapeText(text) + children.map(childHtml)`
  (adapters.ts:435-442); with `parent === null` it is a safe no-op
  (`states.get(null)` → undefined, adapters.ts:429-430).

Empirically verified by monkey-patching `dist/core/adapters.js` with the exact
proposed shape (`/tmp/opencode/repro/validate-fix-shape.mjs`):

| Case | Result |
| --- | --- |
| remove a child → `toString` | `<div><div></div><div></div></div>` → `<div><div></div></div>` ✓ |
| remove a parent with descendants | collapses to root-only ✓ |
| remove ONE fork arm of a wire whose two arms share one parent | only that arm disappears; sibling arm + parent intact ✓ |
| `removeEl(root)` (FRG-H24) | `toString()` = `''` (styles-only when styles present) — unchanged ✓ |
| double-remove / parent-first-then-child / child-then-parent ordering | no throw; correct collapse ✓ |
| remove a never-appended (floating) fragment | dropped from the floating set (already worked pre-fix — the `fragments.has` filter, adapters.ts:413) ✓ |

### forkKey / multiple-descriptors-per-wire (explicit answer)

- **A parent CAN hold multiple descriptors for the same wire.** Fork arms
  (FRG-H23) are distinct descriptors minted by separate `createEl` calls
  (adapters.ts:327-341), each keyed `wireKey(wire, forkKey)`; nothing stops two
  arms from being appended to the same parent (adapters.ts:386-393), which puts
  **two distinct FragmentDescriptor objects for one wire** in that parent's
  `children`.
- **The splice is by descriptor identity, so the right arm is unambiguous.**
  `appendChild` receives the actual FragmentDescriptor objects; the proposed
  `parentState.children.indexOf(fd)` finds the exact object, because
  `fragments.get(wireKey(wire, forkKey))` resolves the **specific arm's**
  descriptor (composite key, render-helpers.ts:69-71). Two arms of the same wire
  never collide — verified: removing arm `fk1` leaves `fk2` serialized.
- **`forkKey` is forwarded to `removeEl`.** `applyOps` passes `op.forkKey`
  through (render-helpers.ts:214-220), and the emit side stamps a remove op with
  the element's forkKey when present (render.ts:63,77). So arm-specific removes
  arrive with the composite key the fix needs.
- **Pre-existing, parity-safe caveat (NOT this defect, do not fix here):** a
  **bare-wire** remove (`removeEl(w)`, no forkKey) that `applyOps` resolves to a
  composite arm via `findEl`'s prefix scan (render-helpers.ts:101-121, 191-196)
  then no-ops inside `removeEl` (`fragments.get('w')` undefined). `DomAdapter`
  behaves identically (`wires.get('w')` undefined). Correct pipelines never emit
  this (fork-arm removes always carry the forkKey); "fixing" it would require
  forwarding the resolved composite — a separate change.

### Gaps found (things the proposal requires that do not exist / edge cases not covered)

1. **REQUIRED — purge `this.created` in `removeEl` (the step-2 trap, confirmed).**
   `created` is append-only (adapters.ts:320, 338) and the floating filter
   (adapters.ts:412-414) is a **key-based** membership test
   (`fragments.has(states.get(fd).key)`) that cannot distinguish a dead
   descriptor from a re-created one. With the proposed shape (splice +
   `parent = null`, additive to `fragments.delete`), the D3-legal
   remove→re-create path (R-ORD-6) resurrects the dead fd as a floating
   top-level fragment: verified
   (`/tmp/opencode/repro/verify-resurrection.mjs`) — remove `w`, re-`create` `w`
   under the root ⇒ `toString()` = `<div><div></div></div><div></div>` (the
   trailing `<div></div>` is the dead fd1; expected `<div><div></div></div>`).
   Splice the dead fd out of `this.created` by identity in `removeEl` and it
   never enters the filter's iteration. (Today, without any fix, the same path
   double-serializes inside the root — the filed defect's manifestation; the
   fix must not trade one wrong shape for another.)
2. **PIN — keep `fragments.delete`.** The proposal is additive, never
   "instead of": dropping the delete (with `parent = null`) turns EVERY removed
   element into a floating fragment (key present, parent null, fd ≠ root).
3. **PIN — keep the silent no-op** for an unknown composite key (guard
   `const fd = this.fragments.get(key); if (!fd) return` before any state work)
   — the DECIDED silent-no-op contract (§3.7 / FRG-F2 / DOM-F3 analog) must
   survive.
4. **No rootKey reset needed** — `removeEl(root)` + re-create re-resolves via
   `fragments.get(rootKey)` (adapters.ts:406); FRG-H24 is unchanged.
5. **Out of scope (flag only):** the bare-wire→composite-arm forwarding no-op
   (item above) — pre-existing, DOM-identical, parity-preserving.

## Step 2 — Critique agent

Verdict: **NEEDS-RESHAPE** (the core detach shape is correct and safe on the
plain remove path; it must be amended with a `this.created` purge and pinned
against a remove→re-create resurrection — the key trap — plus test rows for the
new fail-state).

### The KEY TRAP — floating-fragment resurrection (the most important finding)

`toString()`'s floating filter (src/core/adapters.ts:412-414):

```ts
const floating = this.created
  .filter((fd) => fd !== root && this.fragments.has(this.states.get(fd)!.key) && this.states.get(fd)!.parent === null)
  .map((fd) => this.rootHtml(fd))
  .join('')
```

It is a **KEY-based membership test** (`fragments.has(key)`) against an
**append-only `created` array** (createEl pushes every descriptor at
adapters.ts:338, never removed). Trace the proposal (splice + `parent = null` +
`rematerialize(parent)`, **additive to the existing `fragments.delete`**):

1. **Plain remove path — NO resurrection.** removeEl keeps `fragments.delete`
   (adapters.ts:396) and additionally splices the fd out of the parent's
   `children` + sets `parent = null`. The filter's `fragments.has(key)` is now
   FALSE for the removed fd → excluded. The trap premise ("sets parent=null
   without deleting from created/fragments") only fires if an implementer DROPS
   the `fragments.delete`. **The review PIN:** the fix must keep `fragments.delete`
   — reading the proposal as *instead-of* delete turns EVERY removed element into
   a top-level floating fragment (`fragments.has` true, `parent` null, `fd !== root`).
2. **Remove → re-create (D3-legal, R-ORD-6: "`remove` precedes any re-`create` of
   the same wire") — RESURRECTION CONFIRMED even with `fragments.delete` retained.**
   Trace: `removeEl('w')` sets fd1.parent = null and deletes 'w'; a later
   `createEl('div','w')` mints a NEW fd2 and `fragments.set('w', fd2)` (adapters.ts:337)
   while fd1 stays in `this.created` (adapters.ts:338, append-only). On `toString()`:
   fd1 !== root ✓, `fragments.has('w')` → **TRUE** (now maps to fd2) ✓,
   `states.get(fd1).parent === null` ✓ → **fd1 serializes top-level after the root
   subtree**. The dead descriptor resurrects as floating because the key-based
   `has()` cannot distinguish fd1 from fd2. This is reachable in a live host: a
   conditional/arm flip removes a wire in render N and re-creates it in render N+1.
3. **Required amendment:** `removeEl` must also **purge the descriptor from
   `this.created`** (splice by identity). After the purge the dead fd never
   enters the filter's iteration. The alternative — changing the filter to an
   identity test (`fragments.get(key) === fd`) — is **rejected**: it breaks the
   FRG-F3/DOM-F4 dup-create parity, where TODAY the clobbered (never-appended)
   descriptor floats because the DOM keeps the prior element mounted (the old el
   stays in `mount`/`batchEls` under DOM-F4) — the key-based filter is what
   mirrors that surface. Purging `created` on removeEl only affects genuinely
   removed descriptors, so it preserves dup-create parity.
4. **Root case double-check:** after `removeEl(rootKey)` + re-create, the old root
   fd1 also floats today under the same mechanism; the created-purge fixes it, and
   FRG-H24 (removeEl(root) → styles prefix only) is unchanged (`fragments.get(rootKey)`
   undefined → early return at adapters.ts:406-407; the filter never runs).

### Externalities

- **Existing FRG tests stay green:** FRG-H18-remove (`toString()` → `''`), FRG-H24
  (root removal → styles prefix only), FRG-H25 (never-appended float) and FRG-H26
  (fully-connected stream) all survive — verified by trace against the current
  bodies. The removeEl root path needs no rootKey reset: `fragments.get(rootKey)`
  undefined already short-circuits, and `rematerialize(parent)` with `parent === null`
  is a safe no-op (`states.get(null)` → undefined, adapters.ts:429-430).
- **applyOps interaction is clean:** the per-call `created` map in
  `applyOps` (render-helpers.ts:181-226) is separate from the adapter's `this.created`;
  `remove` deletes from the per-call map AFTER `removeEl` — no interference. Sets-before-
  removes ordering (R-ORD-6) means a later setProp on the parent re-rematerializes to
  the same final state — idempotent.
- **Destroy-cascade order independence:** if the sweep removes a parent before its
  child, the child's removeEl still resolves (the child fd is in `fragments`; its
  `state.parent` keeps the parent fd reachable in the `states` WeakMap) and the
  redundant `rematerialize(parentFd)` rebuilds a dead descriptor that never
  serializes — harmless. Both orders are safe.

### Performance

- `rematerialize` walks the ancestor chain, rebuilding each ancestor's
  `contentText` = `escapeText(text) + children.map(childHtml).join('')`
  (adapters.ts:435-442) — **O(depth × remaining-children-html)** per removeEl.
- The re-emit loop calls removeEl per removed element, and the destroy-cascade /
  self-evicting sweep (REQ-GAP-11/12) removes many at once: for k siblings under
  one wide parent the total is **O(k² × ℓ)** (each splice via `indexOf` is O(k),
  each parent rebuild shrinks). At d12 (4095) this is ~megabytes of string churn,
  one-time per sweep — acceptable; at d14 (16383, browser-only scaling probe) it
  compounds and the remove-heavy sweep could show a few-seconds string cost.
- **Verdict: acceptable, consistent with the existing model** — `setProp` already
  calls `rematerialize` on every set (adapters.ts:382-383), so per-op
  rematerialization is the established cost contract; the DOM side does a real
  removal per element (equivalent per-element work). Optional (not required) future
  optimization: a batch/dirty-flag materialization; do not hold this up.

### Design paradigm

- No violation of the pure-consumer / parity letter (PAR-5, SSR-F4): the fix adds
  **state mutation of the same parent/children structure `appendChild` already
  mutates** (adapters.ts:386-393) — it does not add pipeline knowledge, mint wires,
  or read compiled state. The floating-fragment DECIDED (§4.6) is the
  create-without-append parity surface; it is untouched for never-appended
  fragments. The removed-element case converges DOM (detach, adapters.ts:206-221)
  and SSR (splice + delete) — closing the exact divergence filed.
- **fork-arm caveat (parity-preserving, pre-existing):** `applyOps` resolves the
  fd by prefix (`has` → `findEl`) but forwards the ORIGINAL bare wire to `removeEl`
  (render-helpers.ts:214-220). A bare-wire remove that resolves to a
  `wireKey(wire, forkKey)` arm then no-ops in `removeEl` (`fragments.get('w')`
  undefined) — identical in `DomAdapter` (`wires.get('w')` undefined). Parity
  holds; this is NOT part of this defect and should not be "fixed" here (a fix
  would need the resolved composite forwarded, a separate change).

### Robustness

- **forkKey'd removes:** `removeEl(wire, forkKey)` splices by descriptor
  identity (`parentState.children.indexOf(fd)`), so removing one arm of a wire
  leaves the other arm's fd in the parent's `children` and re-materializes it —
  correct multi-fragment handling. The parent IS reachable: `fragments.get(wireKey)`
  → fd → `states.get(fd).parent` (the parent FragmentDescriptor) → `states.get(parent).children`.
  Verified against adapters.ts:319, 336, 386-392.
- **Missing descriptor (no-op today, DECIDED §3.7 analog / FRG-F2 class):** the
  fix MUST guard `const fd = this.fragments.get(key); if (!fd) return` before any
  state work — the silent-no-op contract is retained (DOM-F3 mirrors it).
- **Multiple fragments per wire:** answered above — splices are identity-based, so
  two arms of one wire are independent; a remove while a fork arm survives only
  removes the targeted arm. What "should happen" if a bare `remove` targets a
  composite arm is the pre-existing applyOps forwarding limitation (parity-safe).

### Safety checks

- Destroy-cascade + self-evicting sweep remove many elements in one pass; per-parent
  `rematerialize` cascades cleanly (each removal shrinks the parent's string; parent-
  then-child order is safe — see Externalities). Multiple siblings removed in one
  sweep: correct output, O(k² × ℓ) string cost (see Performance). No loop/containment
  concern — the mutation is a plain array splice + WeakMap reads; no recursion beyond
  the existing ancestor walk, which terminates because `parent` chains are acyclic
  (appendChild never re-roots).

### Design overlooks + suggested amendments (for the step-3 agent / spec writer)

1. **REQUIRED — purge `this.created` in `removeEl`** (splice by identity), else the
   D3 remove→re-create path resurrects the dead descriptor as floating (finding 2 above).
2. **PIN — keep `fragments.delete`**; the proposal is additive, never "instead of".
3. **PIN — keep the silent no-op** for unknown composite keys (guard before state work).
4. **Guard — `rematerialize(parent)` with null parent is already safe** (no extra guard
   needed); note it in the spec so the implementer does not add a throw.
5. **Spec updates (adapters.md):** §4.6 `removeEl` row (detach semantics), the §4.6
   floating paragraph (note that a removed descriptor never floats even after a
   same-wire re-create), §10.2 matrix (FRG-H18-remove row widened; NEW fail-state row:
   remove→re-create→toString must NOT float the old descriptor). New unit tests: the
   remove→re-create non-resurrection pin, a fork-arm remove (one arm removed, sibling
   arm + parent intact), a parent-then-child cascade order, and the unknown-key no-op.
6. **No rootKey reset needed** — removeEl(root) + re-create already renders the new
   root (rootKey stays the first wire's key, `fragments.get(rootKey)` re-resolves).
7. **Out of scope (flag, don't fix here):** the applyOps bare-wire→composite-arm
   forwarding no-op (parity-safe, DOM-identical, pre-existing).

## Step 3 — Change-analysis agent (verdict)

Status: **PROCEED-AS-RESHAPED**

The defect is real and worth fixing: `SSRFragmentAdapter.removeEl` (adapters.ts:395-397)
leaves the removed element byte-identical in `toString()` while `DomAdapter.removeEl`
(adapters.ts:206-221) collapses the DOM — a direct PAR-5 / SSR-F4 divergence that the
consumer battery pins as a defect (HANDOFF-4 Round 5). Without the fix the SSR fragment
retains every destroyed element and its prior subtree (verified against the current
dist: `before` and `after removeEl('doomed')` are byte-identical). The reshaped fix —
the step-1 shape amended with the step-2 `created` purge — is correct, complete, and
independently verified here (20/20 true assertions against a monkey-patched dist,
including the remove→re-create resurrection trap, fork-arm remove, cascade order
independence, and every existing FRG contract it must preserve). No better solution
exists within the design paradigm (see the alternatives analysis below).

### Independent verification (read-only, this agent)

- **Defect reproduces** — `/tmp/opencode/repro/repro-ssr-remove.mjs`: `before` and
  `after removeEl('doomed')` both print `<div><div></div><div></div></div>`. The
  script's "OK: removed element dropped" line is a false negative (wire names never
  appear in serialized HTML — step 1 §"The defect reproduces as stated" is correct).
- **Resurrection trap confirmed** — `/tmp/opencode/repro/verify-resurrection.mjs`
  (patch WITHOUT the created-purge): remove `w`, re-create `w` under the root ⇒
  `toString()` = `<div><div></div></div><div></div>` — the dead fd1 floats top-level
  after the root subtree. Exactly the step-2 trap.
- **Reshaped fix verified** — `/tmp/opencode/repro/verify-reshaped-fix.mjs` (patch =
  splice-by-identity + `parent = null` + `created` purge + keep `fragments.delete` +
  keep silent no-op + `rematerialize(parent)`): 20/20 true assertions pass, covering
  plain remove, subtree remove, the remove→re-create non-resurrection pin (asserts
  BOTH the no-float AND the no-double-serialization shapes), one-arm-of-a-fork remove,
  FRG-H24 root removal (styles-prefix-only, unchanged), FRG-H18-remove, double-remove
  no-throw, both cascade orders (parent-first / child-first) → root-only, unknown-key
  silent no-op, FRG-H25 floating intact, FRG-H26 no leak, floating-remove dropped,
  and bounded `created` across repeated remove→re-create.
- **Case 12b of that script (my only "failed" expectation) is itself the proof the
  identity-filter is wrong**: after a dup-create (NO remove) the key-based filter
  emits `<div><div></div></div><div></div>` — old descriptor still in the root subtree
  + clobbered NEW descriptor floating top-level. That IS the DOM-F4 mirror
  (`DomAdapter.createEl` keeps the old element mounted AND mounts the new one at top
  level). An identity-based filter would drop the old descriptor from SSR, breaking
  the FRG-F3/DOM-F4 dup-create parity — the step-2 rejection of the identity filter is
  CONFIRMED.
- **`this.created` has no other consumer** (adapters.ts:320 declaration, :338 push,
  :412 filter iteration only) — the purge is safe and complete; the dead fd's state
  lives in the `states` WeakMap and is GC'd once the fd is unreachable.
- **Trio green at the time of this review** (no src/tests changes made): `npm run
  typecheck` clean; `npm test` 1022/1022 green (49 files).

### Is it a good idea? (does the defect matter, what breaks without it)

- **It matters.** The SSR fragment is the server-render half of the PAR-5 parity
  contract (adapters.md §8 PAR-5, SSR-F4 "adapter behaviors must not diverge for the
  same op"). A destroyed element that the DOM removed but the SSR string still contains
  is a false render surface (stale DOM on hydrate / mismatched node sets) — the exact
  class the battery S5 pinned. The proposal closes the divergence by converging SSR
  remove on the DOM detach shape.
- **Without it** the divergence stays filed as a defect against the upstream package;
  the consumer's workaround (asserting the DOM collapse as the host green) remains.

### The reshaped fix — exact contract the implementation must satisfy

`SSRFragmentAdapter.removeEl(wire, forkKey?)` (adapters.ts:395-397) becomes:

1. **Resolve + silent no-op guard (PIN — §3.7 / FRG-F2 / DOM-F3 analog):**
   `const key = wireKey(wire, forkKey); const fd = this.fragments.get(key); if (!fd) return`
   — before ANY state work. The DECIDED silent-no-op for unknown/absent composite keys
   must survive (today `fragments.delete` on a missing key is already silent).
2. **Splice the descriptor out of its parent's `children` by identity:**
   `const parent = this.states.get(fd)!.parent;` then, if `parent` is non-null,
   `parentState.children.indexOf(fd)` → `splice(i, 1)` when found. The splice is by
   descriptor identity, NOT key — two fork arms of one wire (FRG-H23, both in the same
   parent's `children`) never collide; the `fragments.get(wireKey(wire, forkKey))`
   resolution selects the specific arm.
3. **Set `parent = null`** on the removed fd's state.
4. **Purge the descriptor from `this.created` by identity** (REQUIRED amendment —
   the step-2 trap): `const ci = this.created.indexOf(fd); if (ci !== -1) this.created.splice(ci, 1)`.
   Without this, the D3-legal remove→re-create path (R-ORD-6) resurrects the dead fd as
   a floating top-level fragment. This is the ONLY change to the floating surface, and
   it is scoped to genuinely removed descriptors — the never-appended floating contract
   (FRG-H25) and the dup-create clobber surface (FRG-F3/DOM-F4) are untouched.
5. **Keep `fragments.delete(key)`** (PIN — the proposal is additive, never
   "instead of"; dropping it turns every removed element into a floating fragment).
6. **`rematerialize(parent)`** with a null-guard: `if (parent) this.rematerialize(parent)`.
   NOTE: `rematerialize`'s current param type is `FragmentDescriptor` (adapters.ts:428),
   so passing `parent` (typed `FragmentDescriptor | null`) requires the guard (or
   widening the param to `FragmentDescriptor | null` — runtime is safe either way,
   `states.get(null)` → undefined → return). Do NOT add a throw.
7. **No rootKey reset.** FRG-H24 (removeEl(root) → styles-prefix-only) is preserved:
   the root fd is purged from `created`, `fragments.get(rootKey)` → undefined short-
   circuits toString's root branch before the floating filter runs (adapters.ts:406-407);
   `rootKey` stays the first-wire key and a re-created root re-resolves through it.

### Residual gaps / conditions (for the implementer)

- **Type detail (item 6 above):** the null-guard around `rematerialize(parent)` or a
  widened param — a TS error otherwise.
- **Ordering is free:** `rematerialize` reads only `states`/`children`/`contentText`
  (never `fragments` or `created`), so splice/delete/purge/rematerialize may run in any
  order; pick one deterministic order and pin it in the test.
- **Out of scope (flag, don't fix):** the applyOps bare-wire→composite-arm forwarding
  no-op (render-helpers.ts:214-220 forwards the original bare wire; a bare remove that
  resolves to a fork arm then no-ops in `removeEl` — `DomAdapter` behaves identically,
  parity holds, pre-existing).
- **Out of scope (flag, don't fix):** the remove-LESS dup-create double-serialization
  inside the root subtree (create w, append, dup-create w) — a pre-existing surface
  that the created-purge correctly leaves alone because no removeEl ran. It is NOT this
  defect; "fixing" it would break DOM-F4 parity.
- **Doc hygiene (this review's finding):** HANDOFF-4.md Round 5 and this review's header
  cite `docs/specs/adapter-parity-battery.md` + `tests/adapter-parity-battery.test.mjs`
  as the repro provenance, but those files do not exist in THIS repo (consumer-owned,
  per HANDOFF-4's "adjacent folder" framing). Either add the battery spec or repoint the
  citations to the consumer repo path.
- **adapters.md updates (step-2 item 5, endorsed):** §4.6 `removeEl` row → detach
  semantics; §4.6 floating paragraph → a removed descriptor never floats even after a
  same-wire re-create; §10.2 matrix → widen the FRG-H18-remove row + NEW fail-state row
  for remove→re-create→toString non-resurrection.

### TDD shape (test-first, red before any implementation)

Write these unit tests FIRST (in `tests/unit/adapters.test.ts`'s FRG block); every RED
test fails against the current code, and tests 1-3 also catch a partial fix:

1. **Plain-remove detach (the filed defect):** root + appended child; `removeEl(child)`;
   `toString()` → `<div></div>` (current: `<div><div></div></div>`).
2. **Remove→re-create non-resurrection (KEY TRAP):** root + `w` appended;
   `removeEl('w')` → assert `<div></div>`; re-create `w` + append → assert
   `<div><div></div></div>` (exactly ONE serialization). This asserts BOTH wrong shapes
   at once — current code double-serializes inside the root; a splice-without-created-
   purge floats the dead fd top-level.
3. **Fork-arm remove:** two arms `fk1`/`fk2` of wire `w` under one parent;
   `removeEl('w', 'fk1')` → `toString()` = `<div><div></div></div>` (fk2 + parent
   intact; current: both arms retained).
4. **Cascade order independence:** root ← p ← c; remove in BOTH orders
   (p-then-c and c-then-p) → `toString()` = `<div></div>`, no throw.
5. **Unknown-key silent no-op:** `removeEl('ghost')` → no throw, output intact
   (green-guard for the §3.7 pin).
6. **Repeated remove→re-create bounded:** 3× create-w + append + removeEl → final
   `toString()` = `<div></div>` (created stays bounded; no accumulation).
7. **Regression pins (must stay green):** FRG-H24 (root removal), FRG-H25 (floating),
   FRG-H26 (no leak), FRG-H18-remove, FRG-H23 (fork descriptors), FRG-F3 (dup-create).

Full validation trio after implementation (AGENTS.md item 4): `npm test`, `npm run
typecheck`, `npm run demo:smoke` (and `npm run build` clean). Watch the d12 profile
totals — the fix adds no smoke-measured cost (static pages are first-render,
`diffMinimal(prev = null)` emits zero removes; the runtime fork-stress page never
removes wires), so no profile-total regression is expected; flag any change.

### Cost / benefit — risk surface

- **Scope: SSR adapter only.** `DomAdapter` is untouched (its detach already works).
- **Per-op cost:** `rematerialize` is O(depth × remaining-children-html) per removeEl
  (adapters.ts:435-442 ancestor walk); the splice is O(k). For k siblings under one wide
  parent the sweep totals O(k² × ℓ) — at d12 (4095) ~megabytes of one-time string churn,
  acceptable and consistent with the existing model (`setProp` already rematerializes on
  every set, adapters.ts:382-383; the DOM side does equivalent per-element removal). At
  d14 (16383, browser-only scaling probe) a remove-heavy sweep could cost a few seconds
  — browser probe only, not smoke-measured. Optional future optimization (not required,
  do not hold up): batch/dirty-flag materialization.
- **Pipeline/safety:** no new pipeline knowledge; mutates only the parent/children
  structure `appendChild` already mutates (adapters.ts:386-393). applyOps' per-call
  `created` map (render-helpers.ts:181-226) is separate from the adapter's `this.created`
  — no interference. The ancestor walk terminates (parent chains acyclic; appendChild
  never re-roots). Destroy-cascade order independence verified (both orders).

### Alternatives — is there a better solution?

- **Identity-based floating filter** (`fragments.get(key) === fd`): **REJECTED —
  confirmed by this agent.** It breaks the FRG-F3/DOM-F4 dup-create parity surface: the
  clobbered old descriptor that `DomAdapter` keeps mounted would vanish from the SSR
  string (my case-12b trace showed the key-based filter producing the exact DOM-F4
  mirror). The created-purge is scoped to removed descriptors and preserves that surface.
- **Tombstone set** (`Set<FragmentDescriptor>` consulted in the filter): functionally
  equivalent to the purge for the resurrection trap, but strictly worse — unbounded
  growth (dead descriptors accumulate forever), extra state, and it does not shrink the
  filter's iteration like the purge does. The created-purge dominates it.
- **Document-as-divergence** (keep the current behavior, note it): **REJECTED** — the
  divergence violates the PAR-5/SSR-F4 parity letter (a core contract, adapters.md §8)
  and the consumer battery pins it as a defect. Not a defensible outcome.
- **Verdict: the reshaped fix is the best available shape** — minimal, parity-closing,
  additive, and scoped so every existing FRG contract survives.
