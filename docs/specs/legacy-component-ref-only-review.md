# Legacy Component Target / Reference-Only — Feasibility Review (REVISED)

Status: design review of the **corrected** proposal "legacy `component.target`
is the LOCAL property path where the resolved component value is applied; a
binding must have at least one of `value` or `target`; reference-only →
warn + ignore at translate". This is the step-3 CHANGE-ANALYSIS verdict over
pass #2 (the validity + critique agents that reviewed the corrected
semantics) of the three-agent proposal gate (`docs/subagents.md` / AGENTS.md
item 8). No code changed. The pass-1 verdict (rejected under a misread of
`target` as a component name) is preserved verbatim in Appendix A; §2 and §3
explain the correction and why it overturns that verdict. Companion context:
`docs/specs/translate.md`, `docs/specs/payload.md`, `docs/specs/derived-state.md`,
`docs/specs/compile-horizon-review.md` (format model), `RENDER_PROCESS_NOTES.md`
§3.1/§6.3/§10.10.1/§10.10.5.

> **STATUS (K1–K8 LANDED — this review is now the historical record + kernel
> contract):** the full kernel is implemented and green. Translate half
> (K1–K4, K6–K8, K5 persistence `options.applyPath` — `planBindings` /
> `classifyTarget` / `applyPlans`, `src/core/translate.ts`) and reverse half
> (K5 emission + N1 strip-on-reverse — `nodeToLegacy`), behaviorally pinned by
> `tests/unit/translate.test.ts` (52 tests) + `tests/unit/reverse.test.ts`
> (K5/N1 unit, 8 tests). Everything §2.2 / §5 / Appendix E.3 marks kernel-scope
> is LANDED as written. The follow-up DECIDEDs in §E.3 below stay open as listed
> (emission-layer object fix, targetPlacement feed, payload.component, null
> injection, >1-def emission guard); the "reverse strip-on-reverse (N1)" item
> is CONFIRMED LANDED. Appendix B's spot-check line references are
> PRE-KERNEL — the `translate.ts` they cite was replaced by the kernel; the
> claims they verify are re-verified by the unit pins. Docs of record for the
> landed behavior: `docs/specs/translate.md` (§2/§2.1/§5) + `docs/specs/payload.md`
> (R-2/R-5).

## 1. What the proposal asks (corrected semantics — authoritative)

1. Legacy `ComponentBinding.target` is **not** a second component name. It is
   the LOCAL property path on the consuming node where the resolved value of
   `reference` is applied — e.g. `{"reference":"p10","value":"v10","target":
   "props.name"}` writes the node's own `props.name`.
2. A binding must carry at least one of `value` (provide) or `target` (local
   apply). A binding carrying only `reference` ("reference-only") raises a
   warning and is ignored during translation.
3. When both `value` and `target` are present, the value applied to the
   target path is the **RESOLVED value of `reference`** — for a self-providing
   binding that is its own `value` ("self-provider ⇒ own value").

The correction is confirmed by the codebase itself (`RENDER_PROCESS_NOTES.md`
§6.3, lines 160-166): the original backend's Phase 5 (`SlotAssemblyWorker`)
applies non-type bindings via `buildLayerMap` for
`content`/`children`/`handlers`/`props.*`/`css.*` — i.e. `target` selects
which LOCAL layer property receives the resolved value — and "if
`Component.value` is set, it IS its own source provider" (the value-set
self-provider rule, proposal item 3).

## 2. Feasibility verdict

**PASS (revised) — adopt the "props.* scalar kernel" as scoped by the pass-2
critique, with the three open items decided in §5.** The proposal is feasible
as a translate + compile + reverse change, but only in the props.* scalar
form; every other target root is parked (§4), and the reference-only clause is
narrowed (§5 item A).

### 2.1 Why pass 1 rejected and what changed

Pass 1 read `target` as the name of a second component (the "consumed" name,
`translate.ts:210`), under which the proposal criminalized the format's
DECIDED native consumer form (`RENDER_PROCESS_NOTES.md` §10.10.5: "plain
`reference` stays a `target` consumer"; `translate.md` §2 TR-H2). Under the
CORRECTED semantics the value-less `target` field is a local apply path, not
a component name — the pass-1 "no legal pure-consumer form exists" objection
(gap A) dissolves: `{ reference, target: 'props.x' }` becomes a legal,
meaningful consumer-with-local-apply, and the current translate code that
ignores the field (`translate.ts:219-221`, spot-checked below) is a genuine
mapping defect the proposal fixes. The pass-1 kernel (translate-time warning
for genuinely EMPTY bindings, never a throw) is retained and folded into the
corrected kernel as the vacuous-binding trigger (§4-K3).

### 2.2 The kernel (what is adopted)

- **K1 — translate mapping fix.** A value-less `{reference, target:
  'props.<k>'}` keeps its target consumer anchor (unchanged consumption, so
  `unresolved-reference`/S-R4.3 still fires) AND additionally synthesizes
  `derived.props.<k> = { $: 'bindings.<reference>' }` on the node before
  construction. A `{reference, value, target: 'props.<k>'}` keeps its source
  (self-provider) anchor and applies the same synthesis — the synthesized
  read resolves to the node's own published value ("self-provider ⇒ own
  value"). The synthesized declaration rides the EXISTING per-arm derived
  evaluation (`node.ts:696`); no engine/derived change is needed — the
  `bindings.*` root is already whitelisted (`derived.ts:41-43`).
- **K2 — synthesis carve-outs (skip + warn, code `component-target-skipped`):**
  dotted reference names, dotted `props.*` keys (derived writes flat keys
  only — no nested seam), `props.id` (collides with the reserved derived key,
  `derived.ts:113`), and keys already present in the node's authored
  `derived.props` ("authored-derived wins"). Object-valued references:
  out of scope (documented; legacy object consumption was the
  content/children-injection seam, parked per §4).
- **K3 — vacuous-binding trigger (pass-1 kernel retained).** `data.component`
  present but `reference` not a non-empty string (`{}`, `{reference: 42}`,
  `{reference: ''}`): warn (code `component-binding-empty`), create NO
  anchors (eliminates today's degenerate empty-name target anchor), never
  throw.
- **K4 — warnings channel.** `TranslatedTree` gains an always-present
  additive `warnings: Array<{ code: 'component-binding-empty' |
  'component-target-skipped'; path: string }>` (`path` = tree path, e.g.
  `root.children[2]`) plus a focused `console.warn`. No diagnostic events
  (the events bridge does not exist at translate time).
- **K5 — reverse persistence.** `AnchorOptions` gains one optional field
  (e.g. `applyPath?: string`) set on the synthesized target anchor;
  `nodeToLegacy` emits `target` when present, so the reversed document is
  byte-equivalent legacy and R-2/R-5 round-trips (Appendix B, spot-check 6).
  Runtime duplex anchors (source + target, same name) stay legal in the
  runtime model but become legacy-unexpressible — the legacy encoder cannot
  emit them, documented.
- **K6 — `template.component` root asymmetry.** The root's `template.component`
  with a `value` must create a SOURCE (provider) anchor mirroring
  `translateNodeData` (today the value is stored on a target anchor and
  never published — dead weight, spot-check 5). Value-less stays a target
  consumer.

### 2.3 What is NOT adopted (parked)

- `content`/`children`/`handlers`/`css.*` targets have no write seam at
  translate time (derived writes props only; mutation of those layers is a
  compile/runtime channel, not a translate-time one) — parked.
- The proposal's reference-only clause as literally written — narrowed, see
  §5 item A.

## 3. Adjudication of pass #2 (validity + critique consistency)

**The two pass-2 analyses are consistent with each other, with the code, and
with the corrected proposal.** Validity confirmed the corrected semantics from
`RENDER_PROCESS_NOTES.md` §6.3 and sized the change as translate + compile +
reverse; the critique independently verified the same seams in code
(`buildLayerMap` roots `content`/`children`/`handlers`/`props.*`/`css.*` =
Phase 5; value-set = self provider) and narrowed scope to the props.* scalar
kernel. No contradiction, no over-claim. The one mechanical claim both rely on
— that a synthesized `derived.props.<k> = {$: 'bindings.<name>'}` rides the
per-arm derived evaluator and omits on null — was re-verified independently in
this pass (spot-check 1-4, Appendix B). One nuance the critique left implicit
is made explicit in §5 item A: the reference-only clause cannot be implemented
at translate time as a warn+ignore for usable names.

## 4. Gaps and critique (revised, ordered by severity)

### A — The reference-only clause vs the structural-consumer surface (blocking as written, decided)

The corrected proposal's "reference-only → warn + ignore" reads fine on
paper — a binding with neither `value` nor `target` has no provide seam and
no apply seam — but it is unimplementable at translate time as stated:
resolution (knowing whether the reference resolves to a type/structural
component, a record, or a scalar) happens at COMPILE time, and translate
cannot distinguish a vacuous scalar consumer from the engine's legitimate
structural consumers. Verified blast radius: `demo/feature-matrix-fixture.js:
45` consumes the `session` RECORD with `{reference: 'session'}`; the theme
forks and showcase "shell" consumers listed in pass-1 gap B are reference-only
by design (`translate.md` TR-H2, notes §10.10.5). Warn+ignore would silently
destroy the consumption on every one of them. **Decision in §5-A: usable-name
reference-only keeps current behavior; warn+ignore applies only to the
structurally vacuous trigger (K3).**

### B — `target`-field semantics split: name vs local path (blocking, resolved by the kernel)

`translate.ts:210` computes `consumed` from the `target` field, the value-less
branch (`translate.ts:219-221`) ignores it, and `nodeToLegacy`
(`translate.ts:357-365`) can emit `target` only for duplex providers. The
proposal splits this single field into two disjoint meanings (duplex name vs
local apply path). The kernel resolves the split by giving the field ONE
meaning in legacy (local apply path) and moving the duplex encoding's
consumed-name out of legacy entirely (legacy-unexpressible, documented — §2-K5).

### C — Round-trip parity (R-2/R-5) without a persistence seam (blocking, resolved by K5)

Without persisting the apply path, reverse emits `{reference}` for the
consumer and the local apply is lost on round-trip (the reverse doc still
re-translates, but only because the synthesized derived would ship as derived
data — polluting the legacy doc with Preempt-only `bindings.*` machinery the
backend cannot interpret). K5's one optional `AnchorOptions` field keeps the
reversed document clean legacy with `target` emitted. Cost: one optional
field, one read in `nodeToLegacy`, one write at synthesis.

### D — Empty-binding and dead-value degeneracies (resolved by K3/K6)

Today `{reference: ''}` creates an empty-name target anchor (compile-time
`unresolved-reference`); `component: {}` and non-string references are silent
no-ops; the root's `template.component` value is stored on a target anchor and
never published (`translate.ts:260`; `publishOwn` publishes source/duplex
only, `node.ts:643`). K3 eliminates the first two with a real warning; K6
fixes the root asymmetry.

### E — Kernel invariants

1. **Never throw.** Translate-time warnings only (TR-F2 stays: per-binding
   content is never a throw; only malformed envelopes throw).
2. **Authored-derived wins.** Synthesis skips existing keys — no duplicate
   derived keys, no override of an authored declaration.
3. **No engine change.** `derived.ts` untouched: `bindings.<name>` single
   segment is already whitelisted (`validatePath`, `derived.ts:41-43`);
   `id` is the only reserved derived key (`derived.ts:113`).
4. **Additive only.** `warnings` field + one `AnchorOptions` field; no
   existing anchor semantics change; no existing test asserts whole-tree
   shape on `TranslatedTree` (property assertions only).

## 5. Open-item decisions (final)

### A — Reference-only: warn+ignore vs drop silently → NEITHER for usable names

Usable-name `{reference}` keeps current behavior (target consumer anchor,
S-R4.3 compile-time `unresolved-reference` if unresolvable). Warn+ignore (or
drop-silently) applies ONLY to the structurally vacuous forms — `{}`,
non-string or empty `reference` — via K3. Rationale: usable-name reference-only
is the engine's DECIDED consumer/structural seam (verified live in the demo
surface); translate cannot know the resolved value's shape.

### B — `template.component` root asymmetry → INCLUDED

As K6: value-carrying root bindings become source (provider) anchors,
mirroring the node mapping. It is a one-branch fix inside the same mapping
change and removes the dead-value artifact. The root's provider role also
makes `bindings.<ref>` readable at the root (publishOwn), which the synthesis
relies on for root-level `target` applies.

### C — value+target = "apply the RESOLVED value of reference" → WRITTEN DOWN

Written into the translate.md spec amendment (and this review): the
synthesized read is `{$: 'bindings.<reference>'}` — the resolved, per-arm
value — which for a self-provider equals its own `value` (publishOwn
`node.ts:640-647` runs before the derived bake `node.ts:658-661`), and for a
consumer equals the provider's resolved value.

## 6. Costs / benefits

| Option | Costs | Benefits |
| --- | --- | --- |
| **(i) Status quo** | `component: {}` / non-string reference invisible forever; `{reference:'',}` degenerate empty-name anchor; `target` field dead in value-less bindings (authors think it does something); root `template.component` value silently dropped | Zero change; zero risk; all contracts/tests/demos untouched |
| **(ii) Kernel without reverse fix** (K1-K4, K6; no K5) | Same as (iii) minus the options-field work; BUT reverse output ships the synthesized derived as `bindings.*` derived data — legacy-doc pollution the backend cannot interpret; `target` never round-trips; R-2/R-5 hold only via the polluted channel | Local apply works; warnings surface works; no anchor/serialize changes |
| **(iii) Full kernel** (K1-K6 at pass 2; scope extended to K1–K8 by the multi-binding clarification — Appendix E) | **Migration cost:** translate.ts — value-less branch synthesis + warnings array on `TranslatedTree` (+2 codes) + root `template.component` branch; types.ts — one `AnchorOptions` field (`applyPath?`); nodeToLegacy — emit `target` from the field; no derived.ts changes. Tests: translate.test.ts (synthesis; carve-out skips + warn; vacuous warn+ignore; reference-only unchanged; authored-derived wins; `props.id`; root flip; reverse target round-trip; warnings shape) + reverse.test.ts additions; ~6 doc files (translate.md, payload.md R-2/R-5 note, derived-state.md §3 note, designing-pages.md §11/§12, RENDER_PROCESS_NOTES.md §10.10 DECIDED, this review). Re-run loops: validation trio (AGENTS.md 4 — watch the demo:smoke profile totals; synthesis adds per-arm derived eval only for target-bearing nodes, so fork-stress/placement d12 totals must stay flat — flag if they move) + blind-test (item 9) + stress-loop (item 10). Runtime duplex anchors become legacy-unexpressible (doc note only — runtime unaffected) | `target` finally means something in value-less bindings (local apply of the RESOLVED value); value+target self-apply honored; silent data errors visible at the boundary (`component-binding-empty`); root provider asymmetry fixed; clean legacy round-trip (R-2/R-5); never throws; every legal binding shape preserved or upgraded; zero engine change |

## 7. Recommended landing plan

1. **Spec first (subagents.md Step 4 gate):** amend `docs/specs/translate.md`
   — binding contract (at least one of `value`/`target`; `target` = local
   `props.<k>` apply path; value+target = resolved value, self-provider ⇒ own
   value), mapping (K1), warnings (K3/K4 with the two codes), reverse `target`
   emission (K5), root `template.component` source flip (K6); note the
   duplex-unexpressible carve-out; note reference-only = unchanged consumer
   form (§5-A). Touch `payload.md` (R-2/R-5 target note), `derived-state.md`
   §3 (bindings root read already whitelisted — no grammar change), and
   `docs/skills/designing-pages.md` §11 matrix + §12 demo pages. Add the
   `RENDER_PROCESS_NOTES.md` §10.10 DECIDED entry on user go-ahead.
2. **TDD red → green (AGENTS.md 7):** writer/TestWriter unit first —
   tests encoding every state in the spec (red set): synthesis for
   value-less-with-target and value+target; carve-outs skip + warn (dotted
   reference, dotted prop key, `props.id`, authored-derived key); vacuous
   warn+ignore + zero anchors; usable-name reference-only unchanged (no
   warning); root `template.component` value → source anchor; reverse
   round-trip emits `target`; `warnings` shape. Run the red set, report.
   Then implement the least code in `translate.ts`/`types.ts` only.
3. **Validation trio:** `npm test`, `npm run typecheck`, `npm run demo:smoke`
   — all green, and confirm the smoke's profile totals show no blow-up
   (AGENTS.md 4).
4. **Doc flip + decision records:** flip translate.md/payload.md/
   designing-pages.md; `RENDER_PROCESS_NOTES.md` §10.10 DECIDED addendum
   (only after user go-ahead).
5. **Re-run loops:** blind-test (AGENTS.md 9 — writer from docs only, using
   `target`-carrying legacy JSON) + stress-loop (AGENTS.md 10 — new scenarios
   for target-bearing bindings: dotted names, `props.id`, root component,
   empty reference, authored-derived collision, round-trips); findings
   appended to `docs/test-findings.md`; lessons folded into
   designing-pages.md §14-style rules.

## Appendix A — Pass 1 (as recorded, superseded)

The original verdict — written when `target` was misread as a second component
name — is preserved below verbatim in structure. Its "no legal pure-consumer
form" (gap A) and "reference-only is the DECIDED consumer form" claims are
overturned by the corrected semantics for the `target`-bearing case (§2.1);
its empty-binding kernel and its gap B (reverse parity), C (no warnings
channel), D (S-R4.3 does not cover genuinely empty bindings), and E (kernel
scope) analyses remain valid and are folded into §2-K3/K4 and §4 above.

1. **Verdict as stated: reject** — under the misread, the proposal
   criminalized the format's native consumer form, was self-inconsistent (no
   legal pure-consumer form), broke reverse parity (payload.md R-2/R-5,
   reverse.test.ts:49) and the demo surface (feature-matrix forks, showcase
   consumers, "shell" bindings in 6 test files + 2 demo files), and delivered
   nothing S-R4.3 did not already deliver for reference-only consumers.
2. **Kernel then recommended:** translate-time warning-only for genuinely
   empty component bindings (`{}`, non-string or empty-string `reference`),
   never a throw, scoped exactly per §3-E of the original: no anchor
   creation, `{reference}` and `{reference, target}` (value-less) unchanged,
   `warnings: [{code:'component-binding-empty', path}]` additive on
   `TranslatedTree`, zero round-trip impact (reverse never emits empty
   bindings). This survives as §2-K3/K4 of the revised verdict.
3. Status quo was deemed defensible then; the corrected proposal upgrades the
   recommendation because the value-less `target` field is now real work, not
   a placeholder.

## Appendix B — Mechanical spot-check (this pass, verified against source)

1. **`validateDerived` accepts `bindings.<name>` (single-segment name).**
   `derived.ts:37-54` (`validatePath`): root `bindings` requires
   `parts.length === 2 && parts[1] !== ''` → `bindings.p10` passes;
   `bindings.foo.bar` (dotted reference) THROWS `derived-invalid` — the
   carve-out trigger for dotted reference names is real.
2. **Reserved derived keys: `id` is the ONLY one.** `derived.ts:112-113`:
   `if (key === 'id') throw derivedInvalid(record[key])` — the sole reserved
   key. `props.id` synthesis would throw at `validateDerived`, confirming the
   K2 carve-out.
3. **Synthesized `{$:'bindings.<name>'}` evaluates per-arm and omits on
   null.** `node.ts:696` (`cs.props = applyDerived(node, cs) ?? cs.props`)
   runs inside the per-arm loop after `cs.bindings = arm.bindings`
   (`node.ts:678`); `derived.ts:242-243` omits null/undefined evaluated keys;
   `derived.ts:184-187` (`pathValue` for `bindings`) returns null for a
   missing key. Per-arm + omit-on-null CONFIRMED.
4. **No-engine-change claim.** The `bindings.*` root is already whitelisted
   (`derived.ts:41`); synthesis needs no grammar change. CONFIRMED.
5. **`template.component` root asymmetry.** `translate.ts:256-261` creates a
   target anchor and sets `a.value` (`:260`) but `publishOwn` publishes only
   source/duplex anchor values (`node.ts:643`) — the root value is dead
   weight today. CONFIRMED (K6).
6. **Value-less `target` field is ignored today.** `translate.ts:210`
   computes `consumed` but the value-less branch (`translate.ts:219-221`)
   anchors `component.reference` only; `nodeToLegacy` emits `{reference}`
   for consumers (`translate.ts:363-364`) and `target` only for duplex
   providers (`:361`). CONFIRMED — the mapping fix (K1) and the reverse
   persistence need (K5) are grounded; `AnchorOptions` today is
   `{priority?, order?}` only (`types.ts:61`).
7. **Self-provider ⇒ own value.** `publishOwn` (`node.ts:640-647`) writes the
   anchor value into `cs.bindings[target]` before the derived bake
   (`node.ts:658-661`); the synthesized read `{$:'bindings.<ref>'}` therefore
   returns the node's own value. CONFIRMED.
8. **Reference-only consumers are live in the surface.** `demo/feature-matrix-
   fixture.js:45` consumes the `session` record via `{reference:'session'}` —
   a usable-name reference-only binding whose consumption would be destroyed
   by warn+ignore. CONFIRMED (decides §5-A).

---

## Appendix C — complete legacy target vocabulary (source comparison)

Post-gate directive: the original legacy documentation was reviewed so the
translator spec carries the COMPLETE set of valid component targets.
Source: `/media/ryan/Shared Files1/Projects/Preempt/docs/skills/components.md`
(§"Reference: Valid Local Targets for Components" + §"Structural Components" +
§"Applying Components"). Result: `docs/specs/translate.md` §2.1 now embeds the
full vocabulary table — the translator's contract.

Key findings from the source review (all incorporated into translate.md §2.1):

1. **`target` = local injection path.** `component: [{reference,
   target}]` deep-injects the resolved payload into the host node's schema
   path (e.g. `css.style`, `handlers.click`, `props.disabled`, `type`).
   Confirms the corrected gate semantics and refutes the rebuild's
   duplex reading outright.
2. **Valid vocabulary is a closed 13-path table** (`type`, `content`,
   `children`, `props`, `props.<key>`, `css`, `css.id`, `css.classes`,
   `css.style`, `css.style.<key>`, `handlers`, `handlers.<event>`,
   `component`) with per-path payload types, assembly phases (3 = `type`,
   4 = all others), and injection behavior. The rebuild implements NONE of
   them as injections; the props.<key> seam (K2) is the only near-term
   path. All others are declared translator gaps (each requires its own
   DECIDED before implementation).
3. **`component` is an ARRAY in the legacy schema** (multiple bindings per
   node: `[{…,target:"css.style"},{…,target:"handlers.click"}]`). The
   translator accepts one binding per node — array form was a declared gap
   at this appendix's pass; **reclassified as REQUIRED feature-parity
   (kernel K7) by the multi-binding clarification — Appendix E**.
4. **Empty placeholders are legitimate, not vacuous** (§"Applying
   Components" warning): `{reference:"MyComponent"}` without value/target is
   the documented placeholder pattern whose value arrives via SSR payload
   injection; lookups must check `value !== undefined`. This confirms the
   K3 scope decision — warn+ignore ONLY for `{}`/non-string/empty
   `reference`; usable-name reference-only stays the consumer form.
5. **Value semantics confirmed** (§6.3 + components.md): value set ⇒ node
   is its own source provider; else it searches `sourceComponents` up the
   tree.
6. **Anti-patterns to recognize, never synthesize**: duplicate targets on
   one node (legacy error + overwrite), array payload on `type`, component
   self-loops (`Component.isAppliedInAncestors()`), unresolved bindings
   resetting the target path to `node.data` (never crash), `targetPlacement`
   on component nodes.
7. **`template.component` on the root** is a binding like any other —
   value-carrying ⇒ provider (K6), and target applies to the root's own
   path.

---

## Appendix D — Anti-pattern register (legacy vs new system)

Step-3 CHANGE-ANALYSIS consolidation (this pass): the 17 legacy anti-patterns
found during the review and their disposition, the new anti-patterns the
translation seam itself introduces (NP1–NP13) plus the step-2 notes (N1–N7),
the D1–D8 doc defects this pass fixed, and the standing decision register.
`docs/specs/translate.md` §2.1 + transition banner carry the fixed behavior
text. No code changed in this pass.

### D.1 Legacy anti-patterns (AP1–AP17)

| # | Anti-pattern | Disposition | Why |
| --- | --- | --- | --- |
| AP1 | unresolved-reset (unresolved-reference state + derived null-omit) | REDUNDANT | S-R4.3 unresolved-reference + derived omit-on-null already cover it; a missing provider resolves null and the derived key is omitted. Correction: legacy deep-injects null WITH the key present; the seam omits null keys (derived.ts:242-243) — semantic loss carried as N3 |
| AP2 | duplicate-target | DELIBERATE-EXCLUSION → block+warn (**FLIPPED from REDUNDANT** — Appendix E.1) | expressible post-K7 (array form); K8 pre-anchor guard `component-duplicate-target` (warn+skip). Legacy errors `[Node] Duplicate target component…` and LAST-wins; K2 synthesis FIRST-wins-silently — the flip resolves the old N2 decision divergence |
| AP3 | array-on-type | recognition-only, folds into the N2 gap warn (Appendix E.1) | `isLinkDef` (render-helpers.ts:287-290) returns false for array values and the scalar path renders nothing — nothing REJECTS arrays, so no def-type rejection analog. Post-K8 the `component-target-gap` warn surfaces it |
| AP4 | self-loops | REDUNDANT | circular-source + cycle rollback in the new engine |
| AP5 | targetPlacement | DELIBERATE-EXCLUSION → block+warn (**FLIPPED from REDUNDANT** — Appendix E.1) | `component-target-placement` warn + field ignored (translate.md §2: unknown fields never rejected); placement pipeline is placementName-keyed — targetPlacement has no consumer seam; the targetPlacement FEED is a separate follow-up DECIDED (NP13, Appendix E.3). **RESOLVED (placement-path-spec §1.1/§1.2 — the consumer seam EXISTS and is implemented):** `targetPlacement` mints ordered `content` anchors; the warn is removed |
| AP6 | placement-bearing type-children | REDUNDANT | children of a node are stored on the node; no placement-bearing child store exists — seam absent |
| AP7 | placeholder lookup | REDUNDANT (SAFE with caveat) | `value !== undefined` check has the value-set source-provider analog. Caveat: post-K1 the synthesized `bindings.<ref>` read resolves through the consumer's family walk — an UNPLACED payload provider is not in it (translate.md §2.1 placeholder caveat) |
| AP8 | unmapped handler table | REDUNDANT | source-anchor wiring replaces the legacy table |
| AP9 | dynamic unseeded deps | REDUNDANT | per-name Link registry is the provider registry (notes §10.10 DECIDED); no dynamic dep table |
| AP10 | ancestor drop-zone dup | REDUNDANT | shared walk + depth cap |
| AP11 | orphaned content | REDUNDANT | unplaced state (S1.1) + payload-owned registration (registry.ts `registerContentNode`) |
| AP12 | runtime handler compile | REDUNDANT | bodies instantiate at translate (`new Function`), never at dispatch |
| AP13 | invented phase keys | DELIBERATE-EXCLUSION → block+warn (Appendix E.1) | `phase: string` unvalidated, never dispatches — `LegacyHandlerPhase` is a closed 3-set (translate.ts:25) but translation carries raw strings; post-kernel translate-time guard `handler-phase-unknown` (no compile-time surface exists — the guard must live at translate) |
| AP14 | DOM-input stash race | STILL-VALID | virtual tree is the source of truth; no DOM-input path |
| AP15 | style edits | REDUNDANT | state-slice layers (`Css.merge`) |
| AP16 | hardcoded parent jumps | STILL-VALID | getter still exists (node.parent); documented anti-pattern, no removal |
| AP17 | template-content blur | STILL-VALID | hard consequence now: template.children stay unplaced content, dropped from compile (S1.1) — deliberate, documented (translate.md §2). **P3 F-13 annotation:** with the contentNodes-ownership minting, template.children/content roots are family-'in-tree' (contentNodes-owned) at translate — the "unplaced" label is superseded; the token still terminates the compile walk (never rendered until a real parent edge or placement path) |

### D.2 New anti-patterns (NP1–NP13) — introduced by the translation seam

| # | Anti-pattern | Reachability |
| --- | --- | --- |
| NP1 | unvalidated target vocabulary: typo → phantom consumer name + silent no-apply | translate.ts:210 (`consumed` from ANY non-empty string target) |
| NP2 | array-form silent truncation: `component: [{…},{…}]` — array read as a single binding, has no `.reference`, silently no-ops | translate.ts:209; K3 would mislabel it `component-binding-empty` (D3/N7) |
| NP3 | synthesized-derived wins over handler-layer writes (two truth surfaces) | K1 writes derived.props; handler `modifyNode` writes authored props; K2's authored-derived-wins carve-out covers only pre-existing derived keys, not handler-layer writes |
| NP4 | dotted-reference asymmetry: anchor ok / derived rejects | derived.ts:37-54 throws `derived-invalid` for `bindings.foo.bar`; anchor names accept dots |
| NP5 | object values bake `[object Object]` | scalarBinding (render-helpers.ts:270-277) skips objects; non-def objects coerce to `[object Object]` in text emission |
| NP6 | placeholder/provider merge semantics: unplaced payload provider not in family walk; in-tree same-name forks instead of first-match | per-arm family-walk resolution vs legacy sourceComponents-up-the-tree search |
| NP7 | applied-value re-evaluation per pass vs one-shot legacy injection | synthesized read `{$:'bindings.<ref>'}` re-evaluates every compile pass; legacy deep-injected once at assembly |
| NP8 | reverse round-trip loses apply path (pre-K5) + synthesized derived leaks into reversed docs | translate.ts:330-333 (nodeToLegacy emits `node.derived` unconditionally), :357-365 (target emitted only for duplex) — N1 |
| NP9 | css.style/cssDef object values bake `[object Object]` (css.style typed string) | `LegacyNodeData.css.style: string` (translate.md §1) — object payloads coerce |
| NP10 | root template.component asymmetry: value on a target anchor, never published (dead value) | translate.ts:256-261; publishOwn publishes source/duplex only (node.ts:643) |
| NP11 | new Function at translate + non-function body throw | translate.md §2 handlers row (security gate noted); body neither string nor function throws |
| NP12 | empty-name anchor / silent vacuous binding pre-K3 | translate.ts:209-223: `{reference:''}` anchors the empty name; `{}`/non-string silently no-op |
| NP13 | targetPlacement translation gap: legacy content routing dead | translate.md §2: field ignored; placement anchors keyed by placementName only. **RESOLVED (placement-path-spec §1.2/§6.2 — the feed is implemented):** `targetPlacement` mints ordered `content` anchors; the interim warn is removed |

### D.3 Step-2 notes (N1–N7)

| # | Note | Status |
| --- | --- | --- |
| N1 | synthesized-derived reverse leak: nodeToLegacy emits `node.derived` unconditionally (translate.ts:330-333) — K5 must strip synthesized derived on reverse | folded into K5 contract (translate.md §2.1 divergence) |
| N2 | silent loss for non-K2 targets needs a gap-target warn code (`component-target-gap`) | DECIDED-pending |
| N3 | null injection: legacy deep-injects null (key present); seam omits null keys | DECIDED-pending (translate.md §2.1 caveat added) |
| N4 | ContentPayload.component declared but never read (payload bindings dropped at translate) | DECIDED-pending (translate.md §2.1 placeholder caveat note added) |
| N5 | lifecycle-phase mapping (legacy Phase 3/4 vs PhaseRegistry 4/5) | footnote added (translate.md §2.1); full mapping DECIDED-pending |
| N6 | value-shape-driven vs path-driven crossover: scalar→text / def→re-type seams realize the value half; path-level injection is the other half | documented (D5 re-points the table rows) |
| N7 | K3 array misfire: `component: []` misdiagnosed as empty binding | = D3; Array.isArray carve-out required in kernel |

### D.4 Doc defects (D1–D8) and their resolutions

| # | Defect | Resolution |
| --- | --- | --- |
| D1 | "duplex unexpressible from legacy data" is FALSE today (translate.ts:210-218 + reverse :357-361 + translate.test.ts:104-130 round-trip; RENDER_PROCESS_NOTES.md:765-775 DECIDED still codifies duplex) | translate.md §2 row 7 qualified: duplex expressible TODAY; unexpressible only POST-K5 (one-meaning-per-field lands with the kernel) |
| D2 | §2.1 "warn/guard" promise vs kernel's 2 codes only (duplicate-target/array-on-type/targetPlacement have no warn path) | anti-pattern bullet rewritten: recognition-only today; exactly two codes post-kernel; gap-target code pending (N2) |
| D3 | K3 trigger misfires on the array form (`component: []` → `component-binding-empty`) | §2.1 array-form note: `Array.isArray` carve-out FIRST (N7) |
| D4 | phase numbering: §2.1 says Phase 3/4 (components.md) vs RENDER_PROCESS_NOTES §6.3 Phase 4/5 | reconciliation footnote pinned to worker NAMES (translate.md §2.1); full lifecycle mapping DECIDED-pending (N5) |
| D5 | content/type "gap" rows overstate: scalar→text + def→re-type seams already realize the value-shape-driven half | rows re-pointed at `scalarBinding`/`isLinkDef` (render-helpers.ts); "path-level injection not implemented" retained |
| D6 | ContentPayload.component unmapped (spec type + LegacyContentPayload exist, never read) | divergence note added (translate.md §2.1 placeholder caveat) |
| D7 | target-syntax normalization rules missing (props., props:name, props.name., bare props) | §2.1 normalization note: flat `props.<key>` only; edge forms warn+skip (code TBD in kernel) |
| D8 | spec header "behavior contract for the TestWriter" describes behavior code+tests don't have | transition-state banner added at the top of translate.md (current vs post-K1–K6; tagged sentences are not test targets yet) |

### D.5 Standing decision register

**The K1–K8 kernel fixes** — NP1/NP3/NP8/NP10/NP12, D1/D2/D3 (as scoped in
§2.2): K1 mapping fix (NP1 partial, NP3 partial, NP12 partial), K2 carve-outs
+ `component-target-skipped` (NP4, NP12 partial; D7 target-syntax edges), K3
vacuous trigger + `component-binding-empty` (NP12; `Array.isArray` carve-out
so `component: []` is not misdiagnosed — D3/N7), K4 warnings channel (NP1
partial), K5 reverse persistence + synthesized-strip-on-reverse (NP8, N1), K6
root `template.component` source flip (NP10). **K7/K8 added by the
multi-binding clarification — array form (NP2) and the duplicate
reference/target guards move INTO the kernel scope; this register is
superseded by Appendix E.3.**

**Follow-up DECIDEDs required** (each before its feature can land; order
arbitrary):

1. **Array form (NP2/D3)** — multi-binding per node; `Array.isArray` carve-out
   + warn code (`component-array-unsupported` candidate). **SUPERSEDED — the
   array form is kernel K7 (Appendix E.3); `component-array-unsupported` is
   retired (the form is supported, not warned).**
2. **Non-props targets (NP1/NP5/NP9)** — `component-target-gap` warn code
   (N2); object-value baking stays documented until then. **SUPERSEDED —
   `component-target-gap` is DECIDED and lands in K8's pre-anchor vocabulary
   pass (Appendix E.3); the NP5/NP9 emission-layer object fix remains a
   follow-up DECIDED.**
3. **ContentPayload.component (N4)** — read it, or declare payload-level
   bindings a permanent drop with a warning. TODO.
4. **Lifecycle-phase mapping (N5)** — **DECIDED: ignored, not supported.**
   Legacy lifecycle names are deliberately excluded; `handler-phase-unknown`
   warn at translate (K8). No mapping.
5. **Reactive applied-value semantics (NP7)** — DECIDED: keep per-pass
   reactive evaluation (divergence-in-favor); documented, no action.
6. **Null injection (N3)** — key-present-null on the seam, or document the
   loss as accepted. TODO.
7. **targetPlacement routing (NP13)** — interim keep-unplaced + warn is
   DECIDED; feed wiring TODO. **SUPERSEDED (placement-path-spec §1.2/§6.2 —
   implementation landed):** the feed is WIRED — `targetPlacement: string[]`
   mints ordered `content` anchors at translate (the interim keep-unplaced +
   `component-target-placement` warn is REMOVED), content roots receive the
   contentNodes-ownership anchor (family-'in-tree', F-13), and the
   path-enumeration compile resolves first-match-with-known-container.
   AP5's "targetPlacement has no consumer seam" premise (Appendix D.1 row)
   is likewise dead.
8. **Reverse strip-on-reverse (N1)** — folded into K5; confirm at kernel
   implementation.

---

## Appendix E — Feature-parity & deliberate-exclusion reclassification (multi-binding clarification)

Step-3 CHANGE-ANALYSIS reclassification (this pass, over Appendix D). Trigger:
the authoritative format clarification — **"Multiple components are allowed
on the same prop in legacy (and this should have feature parity), but not
with the same reference or target."** Consequences: the legacy `component`
ARRAY (multiple bindings per node) is a **REQUIRED feature-parity item**;
within one node's binding array, a duplicate REFERENCE or duplicate TARGET is
deliberately-unsupported bad practice that must be blocked and warned
against. This appendix supersedes the Appendix D rows it touches (D.1
AP2/AP3/AP5/AP13, D.5 register items 1-2) and the pass-2 §6 K1-K6 costing.
No engine code changed — this is a contract reclassification; implementation
lands with the K1–K8 kernel on user go-ahead (TDD order, §7).

**Guard shape (all new guards):** translate-time, warn+skip, never throw
(TR-F2), on the K4 additive warnings channel — prerequisite. Duplicate
detection MUST run **pre-anchor** (before any anchor is created for the
array): compile is blind — a duplicate target silently last-wins
(`resolve.ts:239`) and two providers on one name produce phantom-forks
(stress probes C2/C4).

### E.1 Three-bucket reclassification

**FEATURE-PARITY** (claimed as parity — scoped):

| Item | Scope / status |
| --- | --- |
| NP2 array form | REQUIRED parity — graph-level N bindings per node + `props.<key>` apply paths only. Translate-only change: the engine already supports N component anchors per node (only `child` is restricted, `node.ts:416-419`) and compile cross-products multiple target names (`node.ts:651-666`, `resolve.ts:186-199`); today `translate.ts:209` + `template.component` `:257` skip arrays silently. Kernel **K7** |
| NP5/NP9 emission-layer | object values bake `[object Object]` via `String()` coercion in both adapters — emission-layer parity gap, confirmed. Accepted for now; follow-up DECIDED (emission-layer object fix) |
| N3 null (scoped) | null-injection loss confirmed: `applyDerived` omits null keys (`derived.ts:242-243`), `publishOwn` publishes null (`:644`) but the bake drops it. Accepted known gap; follow-up DECIDED |
| NP13 feed | `targetPlacementResolution` phase exists (`pipeline.ts:78`) but translate never feeds it (`translate.ts:196-200` reads `placementName` only). Interim policy DECIDED: keep-unplaced + warn (`component-target-placement`); auto-attach at the boundary is a graph-mutation policy call, deferred to the kernel. Feed wiring = follow-up DECIDED. **RESOLVED (placement-path-spec §6.1 — the feed is implemented):** translate mints the consumer feed and the path-enumeration compile resolves it; the stage-1 registry row is no longer a dead promise (pipeline.md §1.2) |
| N4 payload component | `ContentPayload.component` declared but never read (`translate.ts:277-290`) — payload-level bindings dropped at translate. Follow-up DECIDED |
| N5 phase mapping | doc-level — legacy components.md Phase 3/4 vs PhaseRegistry 4/5, worker NAMES canonical; full lifecycle mapping is a documentation DECIDED |
| NP6 placeholder semantics | modern semantics ARE the parity (unplaced provider not in family walk; in-tree same-name forks — api.md F4); documented, no machinery |
| NP7 per-pass | DECIDED: **keep reactive** — synthesized-derived re-evaluation overrides handler-layer writes every pass (`applyDerived` spreads after `cs.props`, `derived.ts:246`); one seam, documented as divergence-in-favor. One-shot parity would need new machinery — rejected |

**DELIBERATE-EXCLUSION → block + warn** (never claimed as parity; all
translate-time, warn+skip, never throw — TR-F2, on the K4 channel):

| Item | Code / mechanism |
| --- | --- |
| duplicate reference (new) | `component-duplicate-reference` — pre-anchor (K8) |
| duplicate target (AP2 FLIPPED: REDUNDANT → DELIBERATE-EXCLUSION) | `component-duplicate-target` — pre-anchor (K8); legacy `[Node] Duplicate target component…` now expressible + blocked |
| AP3 array-on-type | recognition-only — nothing rejects arrays, `isLinkDef` renders nothing for array values; folds into the N2 gap warn (`component-target-gap`) |
| AP5 targetPlacement-on-component | `component-target-placement` — warn + field ignored (FLIPPED from REDUNDANT) |
| NP12 vacuous | `component-binding-empty` (K3, existing) |
| D7 syntax edges | `component-target-skipped` (K2 existing skip+warn channel; `props.`, `props:name`, `props.name.`, bare `props`) |
| NP1 unknown target path | `component-target-gap` (N2 code — now DECIDED), pre-anchor vocabulary pass (K8) |
| AP13 unknown phase | `handler-phase-unknown` — translate-time (closed 3-set, `translate.ts:25`; raw legacy names never dispatch — no compile-time surface) |
| NP11 body invalid | `handler-body-invalid` — TODAY's non-function-body THROW is DOWNGRADED to warn+skip (TR-F2); flagged kernel change |
| AP4 self-loops | existing engine circular-source + cycle rollback (no new code) |

**ADVISORY** (documented, no block/warn): AP14 (DOM-input stash race), AP16
(hardcoded parent jumps), AP17 (template-content blur). AP6 stays REDUNDANT
(the anchor model has no subtree-replacement harm — no flip).

### E.2 Legal/illegal matrix + guard-shape table

**Legal/illegal matrix** (one node's binding array — pinned):

| Binding set | Verdict | Mechanism |
| --- | --- | --- |
| distinct reference + distinct target | LEGAL | anchor + K2 synthesis per binding |
| same reference (any target) | ILLEGAL → block + warn | `component-duplicate-reference` |
| distinct references + same EXACT target path | ILLEGAL → block + warn | `component-duplicate-target` |
| distinct references + same family, different paths (`props.x` + `props.y`) | LEGAL | K2 synthesis handles |
| `css.*` family, different paths | legal legacy but NO seam | excluded from parity claims |

**Guard-shape table** (K4 additive channel is the prerequisite for every
translate-time guard; per-binding warn+skip, never throw — TR-F2):

| Guard | Code | Pre-anchor | Time |
| --- | --- | --- | --- |
| duplicate reference | `component-duplicate-reference` | YES | translate (K8) |
| duplicate exact target path | `component-duplicate-target` | YES | translate (K8) |
| unknown target path | `component-target-gap` | YES | translate (K8 vocabulary pass) |
| target-syntax edges (D7) | `component-target-skipped` | YES | translate (K2 channel) |
| vacuous binding | `component-binding-empty` | YES | translate (K3; `Array.isArray` carve-out first) |
| targetPlacement on component | `component-target-placement` | — | translate |
| unknown handler phase | `handler-phase-unknown` | — | translate |
| non-function handler body | `handler-body-invalid` | — | translate (throw→warn downgrade) |
| >1 def-shaped binding | `component-multiple-definitions` | n/a | emission (render) — NOT on the K4 channel |

### E.3 Partial-parity scoping, emission decisions, updated register

**Partial parity:** full 13-path parity is NOT claimed. `type` / `content`:
PARTIAL — value-shape seams only (def→re-type via `isLinkDef`, scalar→text
via `scalarBinding`, render-helpers.ts:270-277 / :221); path-level injection
not implemented. `handlers.<event>`: PARTIAL — **NO engine seam**; the
component-handler e2e wires the resolved handler MANUALLY
(`tests/e2e/component-handler.test.ts:101`, `panel.addLayer`) — no engine
code moves a binding value into `node.handlers`; claiming full parity there
would be a CATASTROPHIC over-claim. `css.*` family: excluded from the parity
claim entirely.

**Emission first-wins (legal multi-binding):** `scalarBinding` picks the
first scalar (`render-helpers.ts:270-277`) and `isLinkDef` the first def
(`:221`) — 2+ def-shaped bindings on one node silently drop the rest → new
guard: >1 def → warn (`component-multiple-definitions`); scalar text
first-wins is documented as intended (no warn).

**NP3/NP7 applied-value semantics — DECIDED: keep reactive.** The synthesized
read re-evaluates every compile pass and overrides handler-layer writes
(`applyDerived` spreads after `cs.props`, `derived.ts:246`) — documented as a
divergence-in-favor (fresh value each pass beats stale one-shot injection);
one-shot parity would require new machinery and is rejected.

**Updated standing-decision register** (supersedes D.5):

Kernel scope — now **K1–K8**: K1 mapping fix, K2 synthesis carve-outs, K3
vacuous trigger, K4 warnings channel, K5 reverse persistence, K6 root
`template.component` source flip (all unchanged), plus —

- **K7 — array form (NP2):** translate accepts `component:
  LegacyComponentBinding[]` (graph-level N bindings per node + `props.<key>`
  apply paths only; `component: []` is valid — K3's `Array.isArray` carve-out).
  Translate-only; no engine change.
- **K8 — pre-anchor guard pass:** `component-duplicate-reference` +
  `component-duplicate-target` (block+warn), `component-target-gap` (NP1/N2
  code, decided), `component-target-skipped` (D7 syntax edges). The remaining
  translate-time guards land with the kernel's K4-channel work: the NP11
  body-invalid throw→warn downgrade (flagged kernel change, TR-F2
  compliance), `handler-phase-unknown` (AP13), `component-target-placement`
  (AP5 block+warn + NP13 interim warn).

Follow-up DECIDEDs (stay open; each needs its own DECIDED before landing):
emission-layer object fix (NP5/NP9 — `[object Object]` bake), targetPlacement
feed (NP13 — interim keep-unplaced + warn), payload.component (N4), null
injection (N3), emission >1-def guard (`component-multiple-definitions`).
**Reverse strip-on-reverse (N1 — folded into K5): CONFIRMED LANDED** — the
synthesized `bindings.*` derived keys are stripped in `nodeToLegacy` and the
K5/N1 reverse unit (`tests/unit/reverse.test.ts`) pins the round-trip
(authored derived stays; re-translate fires no warnings).
**N5 lifecycle-phase mapping: DECIDED — legacy lifecycle names (e.g.
`beforeAssembly`, `beforePreprocess`, `afterAssembly`) are deliberately NOT
supported in the new version; no mapping table is provided. The translate-time
`handler-phase-unknown` guard (K8) warns and the binding is skipped.**
