# Stress-Test Scenarios — translate-layer kernel (K1–K8) breakage probes

Status: **COMPLETE** — input artifact of the stress-test review loop
(AGENTS.md item 10, step a) — the TRANSLATE-LAYER pass. Written by the
SCENARIO agent; completed by the PROBE agent (step b); adjudicated by the
REVIEW agent (step c) — verdicts, the engine-defect list, and the validation
numbers land in `docs/test-findings.md` §"Stress-test review loop #2 —
translate-layer". Every expectation corrected by the review carries a
`[reviewed]` marker. The prior loop's artifact
`docs/specs/stress-test-scenarios.md` remains the record for the
non-translate scenarios; its translate-scenario set is superseded per the
note below.

## Purpose

Hunt for translate/reverse-layer breakage by framing specs for **VALID
legacy-JSON page data** that *should* break or surprise the NEW translate
kernel (K1–K8: `component.target` = local apply path, K7 array form, K8
pre-anchor guards, K4 warnings channel, K5 reverse emission + N1 strip, K6
root source flip, `handler-phase-unknown`/`handler-body-invalid` downgrades).
Every envelope is valid `LegacyInitialData` per `docs/specs/translate.md` §1 —
the malformed-envelope guards (TR-F1) and the §3 payload guards are already
tested and are deliberately NOT probed. The surprise must come from
**semantics**: doc-vs-data tensions where the docs are silent, order-dependent
behavior, guard boundaries that are per-surface only, and round-trip loss the
reverse contract only implies. Some scenarios are expected to pass cleanly —
a probe that confirms the documented behavior is as valuable as one that
breaks it.

## Probe contract (probe agent, step b)

1. For each scenario: feed the envelope to `translateLegacy` from
   `dist/core/*` (the exact JSON in the `Situation` code block), record
   `translated.warnings` (codes + paths, in order), the component anchors of
   every binding-bearing node (`{role, target, value?, applyPath?}`), and the
   node's merged `derived`. Then compile the translated tree and render
   through BOTH concrete adapters (`SSRFragmentAdapter` + `DomAdapter` /
   `treeFromOps`/`treeSig` parity oracle, `dist/core/adapters.js`,
   `dist/core/render-helpers.js`). Record intended-vs-actual per scenario.
2. **Reverse probes**: where the scenario says so, run `reverseTranslate`
   on the translated root, then RE-TRANSLATE the reversed document and
   compare the anchor sets + warnings to the first pass (re-translate
   stability / idempotence).
3. Probe scripts use ONLY core + legacy JSON — no page-side logic. Runtime
   anchors (`addAnchor`) may be used ONLY where the scenario explicitly says
   so (cross-surface cases are expressible from JSON alone).
4. After any probe work, the validation trio must pass
   (`npm test`, `npm run typecheck`, `npm run demo:smoke`) and the smoke's
   `[fork-stress-data:profile]` d12 totals must stay within ~1.5× of the
   placement total (AGENTS.md item 4 — watch `total − Σ(measured)`).
5. Every real-vs-expected mismatch is classified by the review agent as:
   doc/spec bug (fix the doc), data-authoring bug (fix the scenario data),
   or genuine engine defect (report — do not fix engine code in this loop).

## Prior-scenario supersession note

The prior loop (`docs/specs/stress-test-scenarios.md`, scenarios 4–16) was
framed PRE-kernel, under the duplex reading of `component.target` (target =
second component name). The K1–K8 kernel landed between the loops and
redefined `target` as the local `props.<key>` apply path. Consequences:

- **FULLY STALE (replaced by this set):** prior scenarios **5** (root duplex
  `target:'du'` + mixed duplexes), **6** (circular/linear chains via
  `target:'a2'`-as-name), and **9** (nearest-shadows-far via root duplex
  `target:'dup'`). Their envelopes carry `target: <name>` values that the
  kernel reads as apply paths — unknown vocabulary → `component-target-gap`
  warns, zero duplex anchors, so every expected output (self-bind, chains,
  shadows) is unreproducible. Re-framed here as scenarios 12/13 (K6/K7
  semantics: root sources + applyPath-free shadowing).
- **CLAUSE-LEVEL STALE:** prior scenario **11**'s `syntax-h` clause expected
  "translate throws a raw SyntaxError" — K8 NP11 downgraded that to
  warn+skip (`handler-body-invalid`, TR-F2); re-probed here in scenario 8.
  Prior scenario **15**'s `pc3` clause ("carries a duplex (source selfv +
  target selfv)") — under the kernel `target:'selfv'` is an unknown apply
  path → `component-target-gap` warn at `content[0].content[2]`, no duplex;
  the rest of #15 (inert payload items, duplicate literals) stands.
- **NOTE-LEVEL SUPERSESSION:** prior scenario **7**'s format-limit note
  ("the legacy format carries ONE component binding per node" — blind-test
  F5 premise) is obsolete: K7 accepts the array form. The scenario's DATA
  (5 provider NODES, one binding each) is still expressible and stands.
- **STANDING (kernel-agnostic — no `target` fields, no duplex premises):**
  prior scenarios 4, 8, 10, 12, 13, 14, 16.

This set also deliberately does NOT re-probe what blind test #2
(`docs/test-findings.md`, translate-showcase) and the unit pins already
proved: the #array-card 3-binding mix, the single-shape duplicate guards, the
vacuous/empty-array cards, the single syntax-edge/gap/dotted-reference cards,
and the K5 reverse round-trips (pinned in `tests/unit/reverse.test.ts`).

## Dropped scenario ideas (one-line reasons)

- `component: []` on a content-bearing node — proven by blind test #2's
  #empty-array-card (no warn, content renders); trivial duplicate.
- Authored-derived wins on the SAME key, no warn — pinned
  `tests/unit/translate.test.ts:356`; trivial duplicate.
- `{reference, value, target}` re-translate idempotence — pinned
  `tests/unit/reverse.test.ts:129` + `translate.test.ts:638`; trivial
  duplicate.
- `{reference, target}` for a provider-less name reverse round-trip — pinned
  `tests/unit/reverse.test.ts:109`; trivial duplicate.
- Runtime duplex (name-target via `addAnchor`) dropped on reverse — pinned
  `tests/unit/reverse.test.ts:163`; the unpinned LEGACY-DATA variant (plain
  consumer next to a provider) is scenario 10.
- Duplicate detection across single-binding + array MIXED within one
  `component` field — impossible: the field is either a single binding or an
  array, never both; re-expressed as the cross-SURFACE case
  (`template.component` vs `template.root.component`) in scenario 2.
- "A doc whose ONLY warning is handler-body-invalid syntax error" as a
  standalone — pinned `translate.test.ts:569`; folded into scenario 8's
  guard-ordering variant (phase-first) instead.

---

## Scenario 1 — K7 mixed-kind array where one binding's reference equals another binding's target-path key

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "mix-root" },
      "children": [
        { "type": "pane", "props": { "id": "mix" }, "component": [
          { "reference": "theme", "value": "dark" },
          { "reference": "label", "target": "props.caption" },
          { "reference": "slot", "value": "self-val", "target": "props.slotKey" },
          { "reference": "caption", "value": "CAP" }
        ] }
      ]
    }
  }
}
```

**Expected output**

- Anchors on `mix`: `source:theme` (value `dark`), `target:label`
  (applyPath `props.caption`), `source:slot` (value `self-val`, applyPath
  `props.slotKey`), `source:caption` (value `CAP`) — 4 anchors, array order.
- Synthesized derived on `mix`: `props.caption = { $: 'bindings.label' }`
  and `props.slotKey = { $: 'bindings.slot' }` only. Zero warnings.
- Compile: `mix` is actionable. `[reviewed]` — the doc's original
  expectation ("`bindings.theme='dark'`, `bindings.slot='self-val'`,
  `bindings.caption='CAP'` (publishOwn, depth-0)"; "slotKey bakes
  `self-val` (self-provider ⇒ own value)") is what translate.md §2.1's
  unqualified "self-provider ⇒ own value" contract promises, but the ENGINE
  does not deliver it on a MIXED node: `mix` carries a consumer anchor
  (`label`) → compile routes it through `resolveArms` and the `publishOwn`
  branch (node.ts:655-664, requires `targetNames.length === 0`) NEVER runs →
  arm bindings = `{}` (only `label` resolved, unresolved) → the synthesized
  reads `bindings.slot` / `bindings.caption` / `bindings.theme` all evaluate
  null → `slotKey` AND `caption` omitted from the compiled state and from
  emission (`prop:slotKey` absent on both adapters). Classified by the
  review agent: **GENUINE ENGINE DEFECT #1 (publishOwn bypass on
  consumer-bearing nodes — see test-findings §"Stress-test review loop
  #2")**; the self-apply expectation stays the contract for the future TDD
  fix. The cross-namespace `caption`/`CAP` trap (the doc's stated goal) is
  CONFIRMED: the binding NAME `caption` (index 3) and the apply-path KEY
  `caption` (index 1) are different namespaces; a descendant consumer
  `{reference:'caption'}` would get `CAP` while the host bakes nothing.
  Emit: no `prop:slotKey`, no `prop:caption`.
- Reverse: `{reference:'theme', value:'dark'}, {reference:'label',
  target:'props.caption'}, {reference:'slot', value:'self-val',
  target:'props.slotKey'}, {reference:'caption', value:'CAP'}` — exact
  array; re-translate yields identical anchors + zero warnings (N1 strip
  removes both synthesized keys). `[reviewed]` — PASS as authored.

**Suspected failure stage**

compile (synthesis bake — cross-namespace collision), reverse (N1 strip on a
node with 4 anchors).

**Why it might break**

K1 synthesis writes `props.<key>` reads keyed on the target path, while the
binding namespace is keyed on `reference`; nothing in the docs says the two
namespaces collide invisibly on one node. A naive "the key named caption
should show the value CAP" reading is the trap; the probe pins that the
synthesized read resolves the REFERENCE of its own binding, never a
same-named sibling's value.

---

## Scenario 2 — duplicate-literal arrays, guard precedence, and the cross-surface guard bypass

**Situation** (probe feeds three envelopes; each is a valid doc)

```json
{ "template": { "root": { "type": "app", "component": [
  { "reference": "a", "value": 1, "target": "props.x" },
  { "reference": "a", "value": 1, "target": "props.x" }
] } } }
```

```json
{ "template": { "root": { "type": "app", "component": [
  { "reference": "a", "value": 1, "target": "props.x" },
  { "reference": "b", "value": 2, "target": "props.x" },
  { "reference": "a", "value": 3, "target": "props.y" }
] } } }
```

```json
{ "template": {
  "root": { "type": "app", "component": [ { "reference": "a", "value": 2, "target": "props.z" } ] },
  "component": { "reference": "a", "value": 1, "target": "props.w" }
} }
```

**Expected output**

- Envelope 1 (identical literal duplicated — JSON has no identity): exactly
  ONE warning `component-duplicate-reference` at `root`; the duplicate's
  TARGET is never compared (reference guard runs first, `continue`) — no
  `component-duplicate-target` for the identical target. One anchor only:
  `source:a` (value 1, applyPath `props.x`); derived `props.x`.
- Envelope 2: warnings IN ARRAY ORDER: `component-duplicate-target`
  (2nd binding, `props.x` — strict element order: binding 1 ({b,2,props.x})
  is processed before binding 2 ({a,3,props.y}), and its target-check fires
  before binding 2's reference-check), then `component-duplicate-reference`
  (3rd binding, ref `a` — per-binding, ref-check precedes target-check, so
  `props.y` never fires a dup-target). `[reviewed]` — the original
  expectation listed `component-duplicate-reference` first and used
  1-based "index 3/index 2" numbering for a 3-element (max index 2) array;
  the per-binding ref-before-target mechanism claim is CONFIRMED, the
  cross-binding ARRAY-ORDER dominance was wrong. One anchor: `source:a`
  value 1 applyPath `props.x` (first-wins).
- Envelope 3 (the cross-surface bypass): `template.component` and
  `template.root.component` are planned by SEPARATE `planBindings` calls,
  each with its own `seenReferences`/`seenTargets` → **no duplicate guard
  fires**. The root carries TWO source anchors for `a` (values 1 and 2,
  applyPaths `props.w` and `props.z`) plus both synthesized derived reads —
  merged first-wins (no duplicate key). This is exactly the phantom-fork
  shape the K8 guards prevent WITHIN one array (review doc Appendix E.2:
  "two providers on one name produce phantom-forks", stress probes C2/C4) —
  the guard is per-surface, and the two root binding surfaces are both
  reachable in one envelope. Compile outcome is NOT documented: either a
  2-arm multiplicity fork for consumers of `a` (S-R2.5) or first-source
  wins. Probe records the actual. Note also: both surfaces warn at the same
  path string `'root'` — cross-surface warnings are path-indistinguishable.

**Suspected failure stage**

translate (guard precedence + per-surface scoping), compile (phantom fork).

**Why it might break**

The duplicate-reference guard's `continue` means a binding duplicating BOTH
reference and target reports only one code — the docs' "duplicate reference
/ duplicate target" table implies both are checked per binding. And the
K8 guards' "pre-anchor" promise is only intra-array: the legacy envelope has
TWO component surfaces (template.component + template.root.component) and
nothing dedupes across them. Envelope 3 is legal data with a documented
anti-pattern reachable through it.

---

## Scenario 3 — provider-vs-consumer duplicate: order-dependent outcome

**Situation** (probe feeds both envelopes)

```json
{ "template": { "root": { "type": "app", "component": [
  { "reference": "a", "value": "V" },
  { "reference": "a" }
] } } }
```

```json
{ "template": { "root": { "type": "app", "component": [
  { "reference": "a" },
  { "reference": "a", "value": "V" }
] } } }
```

**Expected output**

- Envelope 1 (provider first): warn `component-duplicate-reference` at
  `root`; anchor `source:a` value `V` kept; the consumer is blocked.
- Envelope 2 (consumer first): the SAME single warning; but now the
  CONSUMER anchor `target:a` is kept and the provider is blocked — the
  value `V` is silently lost. Compile: `a` unresolvable →
  `unresolved-reference` at compile (S-R4.3: node renders own state), no
  `bindings.a`, no fork. Identical warning, opposite semantics — the guard
  is order-sensitive and the docs do not state which half wins.

**Suspected failure stage**

translate (first-wins selection), compile (unresolved consumer).

**Why it might break**

The K8 legality matrix says "same reference (any target): ILLEGAL → block +
warn" — it does not say WHICH declaration is the "duplicate". `{reference}`
is the DECIDED consumer/placeholder form (translate.md §2.1) and
`{reference, value}` the provider form; keeping the wrong half destroys a
legitimate declaration with a code that looks like a quality warning.

---

## Scenario 4 — duplicate-target normalization timing: `props.x` vs `props.x.`

**Situation** (probe feeds both envelopes)

```json
{ "template": { "root": { "type": "app", "component": [
  { "reference": "a", "value": 1, "target": "props.x" },
  { "reference": "b", "value": 2, "target": "props.x." }
] } } }
```

```json
{ "template": { "root": { "type": "app", "component": [
  { "reference": "b", "value": 2, "target": "props.x." },
  { "reference": "a", "value": 1, "target": "props.x" }
] } } }
```

**Expected output**

- Neither envelope fires `component-duplicate-target`: the K8 guard compares
  RAW target strings pre-normalization (`'props.x'` ≠ `'props.x.'`).
- Both orders: the `props.x.` binding is skipped at classification
  (`component-target-skipped`, dotted-key edge) and the `props.x.` anchor
  carries NO applyPath; the `props.x` binding synthesizes. Final anchors are
  order-identical — and so is the warning array: `[reviewed]` — both
  envelopes produce the IDENTICAL single-element array
  [`component-target-skipped@root`] (one edge binding per doc; the warn
  always comes from the `props.x.` element, first or second). Only the
  ANCHOR creation order differs (E1: a then b; E2: b then a). The original
  "the WARN ARRAY ORDER differs between the envelopes" prediction was wrong;
  the probe pins the exact arrays here.
- Control: `props.x` + `props.x` (exact) → `component-duplicate-target`,
  one anchor, one synthesis.

**Suspected failure stage**

translate (guard timing — pre-normalization comparison).

**Why it might break**

The docs promise normalization for the D7 edges ("target-syntax normalization
(post-kernel, D7)") but the duplicate guard runs before classification —
whether `props.x.` counts as "the same EXACT target path" as `props.x` for
the K8 guard is only decidable by reading `planBindings` (raw-string compare).
The probe pins the two possible readings (guard-normalized vs guard-raw) and
the order-dependence of the warning stream.

---

## Scenario 5 — the full 13-path target vocabulary on value-bearing bindings, plus dotted unknowns and dot/slash references

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "vocab-root" },
      "children": [
        { "type": "div", "props": { "id": "vocab-a" }, "component": [
          { "reference": "t1", "value": 1, "target": "type" },
          { "reference": "t2", "value": 2, "target": "content" },
          { "reference": "t3", "value": 3, "target": "children" },
          { "reference": "t4", "value": 4, "target": "props" },
          { "reference": "t5", "value": 5, "target": "css" },
          { "reference": "t6", "value": 6, "target": "css.id" },
          { "reference": "t7", "value": 7, "target": "css.classes" },
          { "reference": "t8", "value": 8, "target": "css.style" },
          { "reference": "t9", "value": 9, "target": "css.style.font-size" },
          { "reference": "t10", "value": 10, "target": "handlers" },
          { "reference": "t11", "value": 11, "target": "handlers.click" },
          { "reference": "t12", "value": 12, "target": "handlers.beforeAssembly" },
          { "reference": "t13", "value": 13, "target": "component" },
          { "reference": "t14", "value": 14, "target": "props.x" }
        ] },
        { "type": "div", "props": { "id": "vocab-b" }, "component": [
          { "reference": "u1", "value": 1, "target": "a.b.c.d" },
          { "reference": "u2", "value": 2, "target": "props..x" },
          { "reference": "dot.ref", "value": 3, "target": "props.x" },
          { "reference": "slash/ref", "value": 4, "target": "props.y" }
        ] }
      ]
    }
  }
}
```

**Expected output**

- `vocab-a`: 14 value-bearing bindings, distinct references, distinct
  targets → 14 source anchors, all kept. Warnings in array order: 12
  `component-target-gap` (t1–t3 type/content/children; t5–t13 all css.*,
  handlers.*, handlers.beforeAssembly, component) + 1 `component-target-
  skipped` (t4, bare `props`) + NO warn for t14. Only t14 carries
  applyPath `props.x`; `derived.props.x = { $: 'bindings.t14' }` is the sole
  synthesized key. `handlers.beforeAssembly` as a TARGET PATH is
  recognition-only gap (translate.md §2.1 — lifecycle names are excluded;
  the target-path recognition and the handler-DEF phase guard are different
  surfaces).
- `vocab-b`: `a.b.c.d` → `component-target-gap` (unknown, dotted); `props..x`
  → `component-target-skipped` (dotted key); reference `dot.ref` → anchor
  kept, `component-target-skipped` (dotted reference — bindings.dot.ref is
  invalid); reference `slash/ref` → **synthesizes** `{$:'bindings.slash/ref'}`
  — a slash is not a dot, `validatePath` accepts the single segment, so the
  K2 dotted-reference carve-out does NOT fire; anchor carries applyPath
  `props.y`. Compile: `slash/ref` self-resolves → `y='4'` bakes; all other
  gap/skip anchors stay provider-only.
- Reverse: vocab-a reverses as the 14-binding array (t14 with target, the
  rest without); re-translate: `[reviewed]` — warnings = `[]`, FULLY clean
  (the original "warns are re-emitted on re-translate with the identical
  order" claim was internally inconsistent with the doc's OWN reverse
  expectation: the gap/skipped bindings t1–t13/u1–u3 reverse WITHOUT their
  target fields — K5 emits `target` only when `options.applyPath` exists and
  a gap/skipped binding never carries one — so re-translate has nothing left
  to re-warn; R-5's "re-translates without self-collision" promise holds).
  Anchors are identical (source anchors survive the target-less reverse).

**Suspected failure stage**

translate (vocabulary classification — regex rows + bare-props skip),
compile (slash-reference synthesis bake).

**Why it might break**

The 13-path table's classification is split across three code paths
(flat-props branch, syntax-edge branch, known-gap set + two regexes); a
full-set doc is the only way to prove the partition is complete and
non-overlapping. The `slash/ref` case probes the carve-out's literal
`includes('.')` trigger — a slash-heavy reference name is valid data that
slips past the carve-out the docs frame as "dotted references".

---

## Scenario 6 — synthesis of object and null provider values (accepted-gap pins)

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "synth-root" },
      "children": [
        { "type": "div", "props": { "id": "obj-bake" }, "component": { "reference": "obj", "value": { "k": 1 }, "target": "props.baked" } },
        { "type": "div", "props": { "id": "null-bake" }, "component": { "reference": "n", "value": null, "target": "props.k" } }
      ]
    }
  }
}
```

**Expected output**

- `obj-bake`: `source:obj` (value `{k:1}`, applyPath `props.baked`);
  derived `props.baked = { $: 'bindings.obj' }`. Compiled state carries
  `baked` AS THE OBJECT (deep-equal `{k:1}` — the bake is value-faithful in
  state). Emit: both adapters emit the String() coercion
  `prop:baked="[object Object]"` (NP5 — accepted emission-layer gap, assert
  the literal string). Reverse: the N1 strip still matches the declaration
  shape (`{$:'bindings.obj'}`), so the reversed doc is
  `{reference:'obj', value:{k:1}, target:'props.baked'}` and re-translates
  anchor-identical with zero warnings — the object never round-trips
  through the derived channel.
- `null-bake`: `source:n` with value null (null is a value — the binding is
  a provider, `value !== undefined`); applyPath `props.k`; derived
  `props.k = { $: 'bindings.n' }`. Compile: publishOwn publishes null but
  the derived bake omits the null key (N3 — `applyDerived` omit-on-null,
  derived.ts:242-243) → the compiled state has NO `k`; no `prop:k` on either
  adapter. Reverse: N1 strips the key; `{reference:'n', value:null,
  target:'props.k'}` round-trips; re-translate stable.
- Zero translate warnings on both nodes.

**Suspected failure stage**

compile (null-omit in the synthesized path), emit (object coercion parity
across adapters).

**Why it might break**

The accepted gaps (NP5 object `[object Object]`, N3 null-omit) are documented
for the seams generally, but the SYNTHESIZED derived path is newer: whether
the K2 `bindings.<ref>` read participates in the same omit-on-null and the
same coercion as authored derived is only implied (same `applyDerived`
entry). The probe pins the actual emitted strings on BOTH adapters and the
object's presence in the compiled state.

---

## Scenario 7 — warnings channel: all eight K4 codes in one envelope, exact order + paths

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "warn-root" },
      "placement": { "placementName": "zone", "targetPlacement": "somewhere" },
      "component": [
        { "reference": "dup1", "value": 1 },
        { "reference": "dup1", "value": 2 },
        { "reference": "a", "value": 1, "target": "props.name." },
        { "reference": "b", "value": 1, "target": "css.style" },
        { "reference": "c", "value": 1, "target": "props.dup" },
        { "reference": "d", "value": 2, "target": "props.dup" },
        {}
      ],
      "handlers": [
        { "name": "h1", "phase": "beforeAssembly", "body": "function () { return 1 }" },
        { "name": "h2", "phase": "after-render", "body": "not-a-function(" }
      ]
    }
  }
}
```

**Expected output**

- Exactly 8 warnings, all `path: 'root'`, in this EXACT order (per-node
  sequence: binding guards → handler guards → targetPlacement guard):
  1. `component-duplicate-reference` (index 1, dup1)
  2. `component-target-skipped` (index 2, `props.name.`)
  3. `component-target-gap` (index 3, `css.style`)
  4. `component-duplicate-target` (index 5, `props.dup`)
  5. `component-binding-empty` (index 6, `{}`)
  6. `handler-phase-unknown` (`root.handlers[0]`)
  7. `handler-body-invalid` (`root.handlers[1]`)
  8. `component-target-placement` (placement-bearing + plans > 0)
- All 8 codes present exactly once; each fires a focused `console.warn`.
- Anchors: `source:dup1` (value 1), `source:a` (no applyPath), `source:b`,
  `source:c` (applyPath `props.dup`), `source:d` dropped (dup target). The
  placement anchor `zone` still materializes. Handler `h1` skipped (phase),
  `h2` skipped (body) → zero live handlers.
- Re-translate of the reversed doc: `[reviewed]` — warnings = `[]`, FULLY
  clean (the original "NOT warning-clean — the vacuous `{}`, syntax-edge and
  gap-target warn re-fire" claim was wrong): the vacuous `{}` produced NO
  anchor so nodeToLegacy never emits it; the skipped (`props.name.`) and gap
  (`css.style`) bindings reverse WITHOUT their target fields (K5 — no
  applyPath) so nothing remains to re-warn; the handler defs and
  `targetPlacement` were dropped at translate/reverse and cannot re-fire;
  the duplicate guards cannot re-fire either (the reversed array contains
  the kept bindings only — that half was correct).

**Suspected failure stage**

translate (warning stream ordering), none (if the additive channel is the
only surface).

**Why it might break**

TR-H10 promises the channel exists and each guard warns; it never pins the
ARRAY ORDER of a multi-guard doc, and the per-node internal sequence
(bindings → handlers → targetPlacement, with root `template.component`
planning ahead of `template.root` processing) is implementation detail the
probe makes observable. A consumer depending on warning order (or a
short-circuit — e.g. body-invalid before phase-unknown) breaks here.

---

## Scenario 8 — handler guard ordering: phase-unknown + invalid body on the SAME def; body never instantiated

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "guard-root" },
      "handlers": [
        { "name": "legacy", "phase": "beforeAssembly", "body": "not-a-function(" },
        { "name": "ok", "phase": "after-render", "body": "function (c) { return 1 }" }
      ]
    }
  }
}
```

**Expected output**

- Exactly ONE warning: `handler-phase-unknown` at `root.handlers[0]`. The
  phase guard runs BEFORE the body guard (baseFrom order) — the invalid body
  string is NEVER handed to `new Function`, so no `handler-body-invalid`
  warn and no SyntaxError (the K8 NP11 downgrade holds; a body-valid def
  under an unknown phase would be skipped the same way).
- `ok` instantiates to a live function; the doc translates + renders cleanly
  (the doc's ONLY warning is the phase guard).
- Reverse: `legacy` is absent from the reversed handlers; `ok` ships as its
  source string; re-translate → `handler-phase-unknown` can no longer fire
  (the def is gone) → warnings `[]`.

**Suspected failure stage**

translate (guard ordering), none.

**Why it might break**

Two guards can match one definition; which fires (and whether the body is
evaluated at all) is only implied by the guard list in the review doc's
Appendix E.2 — the phase-first ordering means an uninstantiable body hides
behind the phase warn. The downgrade itself (raw SyntaxError → warn+skip)
replaces prior stress scenario 11's `syntax-h` expectation.

---

## Scenario 9 — reverse: authored derived on a key that a DIFFERENT binding targets (non-idempotent round-trip)

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "collide-root" },
      "component": [
        { "reference": "a", "value": 1, "target": "props.x" },
        { "reference": "b", "value": 2, "target": "props.y" }
      ],
      "derived": { "props": { "y": { "$": "type" } } }
    }
  }
}
```

**Expected output**

- Translate: `a` synthesizes `props.x`; binding `b`'s synthesis is SKIPPED
  SILENTLY — `authoredDerived.props.y` exists, K2 authored-derived-wins
  returns `{}` with NO warn — so the `b` anchor carries **no applyPath**
  (`source:b`, value 2, no target) while the authored `y` declaration stays.
- Reverse: `a` → `{reference:'a', value:1, target:'props.x'}`; `b` →
  `{reference:'b', value:2}` (NO target — reverse emits `target` only when
  `options.applyPath` exists). The N1 strip does NOT remove the authored `y`
  (shape mismatch — it is `{$:'type'}`, not `{$:'bindings.b'}`).
- Re-translate: `[reviewed]` — the round-trip IS **anchor-identical**: the
  loss happens on the FIRST pass already (binding `b` never carried an
  applyPath — authored-wins ⇒ no synthesis), and the reversed doc preserves
  that exact shape, so pass 2 reproduces it. The original "anchors differ
  from the first pass … not anchor-identical" claim was wrong — there is no
  ADDITIONAL loss on re-translate. The authored-collision permanent loss is
  real, intended (K2 authored-derived-wins, no warn), and now documented as
  a data-loss chain: authored-wins ⇒ no synthesis ⇒ no applyPath ⇒ no
  reverse `target` ⇒ the local apply is permanently absent (idempotent from
  pass 1). N1 does not strip the authored `y` (`{$:'type'}` shape mismatch)
  — confirmed.

**Suspected failure stage**

reverse (target emission loss), translate (silent skip).

**Why it might break**

The authored-derived-wins carve-out is documented as "no warn — authored
wins", which reads as a benign precedence; its downstream consequence is the
loss of the apply path on reverse. A doc containing BOTH a targeted binding
and an authored derived on a different binding's target key round-trips
differently from the same doc with the authored key removed.

---

## Scenario 10 — reverse: a PLAIN consumer (no target) on a provider-bearing node is dropped

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "drop-root" },
      "component": [
        { "reference": "x", "value": "v" },
        { "reference": "y" }
      ]
    }
  }
}
```

**Expected output**

- Translate: anchors `source:x` (value `v`) + `target:y` (no applyPath) —
  a legal K7 array (distinct references), zero warnings.
- Reverse: `[reviewed]` — the plain consumer `{reference:'y'}` IS DROPPED.
  Per `nodeToLegacy`, any applyPath-less non-provider anchor next to a
  provider anchor is treated as the legacy-unexpressible "name-target"
  remnant and dropped (`!isProvider && applyPath === undefined &&
  hasProvider`). The original expectation argued payload.md R-2's letter
  (drop scoped to "a name-target (no apply path)") should let this DECIDED
  plain consumer survive — the review agent's verdict: the CODE is the sane
  behavior and R-2's letter was too narrow. The graph shape of a legacy
  plain consumer (target anchor, no applyPath) is INDISTINGUISHABLE from
  the runtime two-name duplex the drop was designed for — nodeToLegacy has
  no provenance to tell them apart — so the drop is shape-forced; R-2's
  sentence is broadened to "any applyPath-less consumer anchor on a
  provider-bearing node" (payload.md R-2, updated). The reversed doc
  carries `{reference:'x', value:'v'}` only; re-translate clean, `y` gone
  forever (silent loss on a legal K7 array — candidate follow-up guard,
  see test-findings §"Stress-test review loop #2" finding 4).
- Variant: `{reference:'y', target:'y'}` (unknown apply path → gap warn) is
  dropped the same way — the gap-warned consumer also disappears.
- Re-translate of the reversed doc: `y` is gone forever; no warnings.

**Suspected failure stage**

reverse (drop classification — plain consumer vs name-target).

**Why it might break**

The reverse drop was designed and pinned (reverse.test.ts:163) for a RUNTIME
duplex anchor; whether the same branch catches a legacy-data PLAIN consumer
on a provider-bearing node is a doc-vs-code boundary: the code drops it, the
docs' R-2 sentence scoped the drop to "a name-target (no apply path)".
Review adjudication: the graph shape is indistinguishable (no provenance),
so the CODE's drop is the sane behavior and the DOC is broadened (payload.md
R-2: "any applyPath-less consumer anchor on a provider-bearing node") —
decided.

---

## Scenario 11 — reverse of a K7 array with 3 providers: anchor order + first-wins + values

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "prov3-root" },
      "children": [
        { "type": "pane", "props": { "id": "prov3" }, "component": [
          { "reference": "p1", "value": "v1" },
          { "reference": "p2", "value": "v2" },
          { "reference": "p3", "value": "v3" }
        ] }
      ]
    }
  }
}
```

**Expected output**

- Translate: 3 source anchors in array order (`p1`, `p2`, `p3`), zero
  warnings. Compile: `prov3` is actionable (sources, no same-name targets in
  scope → renders its own content, F3 "alone/self-scoped"); `bindings.p1..p3`
  published depth-0 for its subtree.
- Reverse: `component` = the array `[{reference:'p1', value:'v1'},
  {reference:'p2', value:'v2'}, {reference:'p3', value:'v3'}]` in ANCHOR
  order (one binding per anchor; anchor order = creation order = array
  order). No first-wins truncation among distinct references.
- Re-translate: identical anchors, identical order, warnings `[]` —
  idempotent.

**Suspected failure stage**

reverse (anchor-order emission), none.

**Why it might break**

The "first provider kept, rest dropped" rule (payload.md R-2) applies only to
same-REFERENCE forks; with distinct references the full array must survive —
but nothing pins the ORDER guarantee across the anchor → binding round-trip
(anchor iteration order vs array order on re-translate). A reversal of order
here would silently reorder multi-provider nodes.

---

## Scenario 12 — K6 root: root source + in-tree child provider for the SAME reference (nearest-shadows-far; root fallback)

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "shadow-root" },
      "children": [
        { "type": "div", "props": { "id": "near-provider" }, "component": { "reference": "dup", "value": "near" }, "children": [
          { "type": "div", "props": { "id": "deep-consumer" }, "component": { "reference": "dup" }, "derived": { "props": { "data-resolved": { "$": "bindings.dup" } } } }
        ] },
        { "type": "div", "props": { "id": "sib-consumer" }, "component": { "reference": "dup" }, "derived": { "props": { "data-resolved": { "$": "bindings.dup" } } } }
      ]
    },
    "component": { "reference": "dup", "value": "far" }
  }
}
```

**Expected output**

- Translate: root carries `source:dup` (value `far`, K6); `near-provider`
  carries `source:dup` (value `near`); `deep-consumer` + `sib-consumer`
  carry `target:dup`. TWO source anchors on the same per-name link at
  different depths — legal (distinct nodes, no K8 involvement). Zero
  warnings.
- Compile: `deep-consumer` walk hits `near-provider`'s source FIRST
  (nearest-shadows-far, R3) → `data-resolved="near"`, single arm, NO fork.
  `sib-consumer` (not a descendant of `near-provider`) walks to the root →
  depth-0 fallback → `data-resolved="far"`. One name, two resolved values in
  one tree; the root source still serves the sibling subtree.
- Render: root + `near-provider` are providers with same-name targets in
  scope → dropped (F3); both consumers render with their baked values.
- Reverse: root emits `template.component {reference:'dup', value:'far'}`;
  `near-provider` keeps `{reference:'dup', value:'near'}`; consumers keep
  `{reference:'dup'}`. Re-translate: same anchors, warnings `[]`.

**Suspected failure stage**

compile (borrow — closest-first with a root fallback present), none.

**Why it might break**

Prior stress scenario 9 (root duplex + in-tree provider) is the pre-kernel
cousin — the duplex half is gone, so the mechanism is now pure
source-vs-source shadowing with the root as depth-0 fallback. The trap: with
the root itself providing, a consumer under `near-provider` must still NOT
fork (R3 closest-first beats S-R2.5 multiplicity), and the sibling consumer
must resolve the root — two consumers of one name taking different paths in
one tree.

---

## Scenario 13 — K7 root array: multi-source depth-0 root + root self-apply bake vs the F3 drop

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "multi-root" },
      "children": [
        { "type": "div", "props": { "id": "c-a1" }, "component": { "reference": "a" }, "derived": { "props": { "data-v": { "$": "bindings.a" } } } },
        { "type": "div", "props": { "id": "c-a2" }, "component": { "reference": "a" }, "derived": { "props": { "data-v": { "$": "bindings.a" } } } },
        { "type": "div", "props": { "id": "c-b" }, "component": { "reference": "b" }, "derived": { "props": { "data-v": { "$": "bindings.b" } } } }
      ]
    },
    "component": [
      { "reference": "a", "value": "A" },
      { "reference": "b", "value": "B" },
      { "reference": "r", "value": "RV", "target": "props.rt" }
    ]
  }
}
```

**Expected output**

- Translate: root carries THREE source anchors (`a`→A, `b`→B, `r`→RV) —
  the root is a multi-source depth-0 provider; `r` also carries applyPath
  `props.rt` and root-derived `props.rt = { $: 'bindings.r' }`. Zero
  warnings (distinct references, distinct targets).
- Compile: `c-a1` and `c-a2` both resolve `a` from the root's depth-0 source
  → both `data-v="A"` — two consumers, one source, NO fork (FRK-H1);
  `c-b` → `data-v="B"`. The root has same-name targets in scope (c-a1, c-a2,
  c-b) → root is DROPPED from render (F3) → its own `props.rt` bake never
  reaches an adapter. The root's self-apply is therefore compile-visible but
  render-invisible here.
- Variant (same envelope, consumers removed): root alone/self-scoped →
  actionable → `prop:rt="RV"` bakes on the root element.
- Reverse: `template.component` = the 3-binding array EXACTLY (r with
  `target:'props.rt'`); re-translate anchor-identical, warnings `[]`.

**Suspected failure stage**

compile (root drop vs self-apply bake), none.

**Why it might break**

K7 on `template.component` makes the root a multi-provider at depth-0 —
untested before K7 (blind-test F5's format limit was superseded). The
interaction of the root's own K2 synthesis with the F3 provider drop is
undocumented: the bake exists in the (dropped) root state and silently never
emits. The fork question ("can a descendant consumer fork against a
multi-source root?") is answered per name: no — one source per name at the
root, two-consumers-one-source, single arm each.

---

## Scenario 14 — one node carrying all three legacy surfaces: component array + placement + handlers

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "tri-root" },
      "children": [
        { "type": "section", "props": { "id": "tri" },
          "placement": { "placementName": "slot-1" },
          "component": [
            { "reference": "a", "value": 1, "target": "props.x" },
            { "reference": "b", "target": "props.y" }
          ],
          "handlers": [ { "name": "h", "event": "click", "body": "function (c) { return 2 }" } ]
        }
      ]
    }
  }
}
```

**Expected output**

- Translate: `tri` mints the placement anchor (`slot-1`), BOTH component
  anchors (`source:a` applyPath `props.x`; `target:b` applyPath `props.y` —
  synthesized `props.x = {$:'bindings.a'}`, `props.y = {$:'bindings.b'}`),
  and the instantiated `click` handler. No `component-target-placement` warn
  (no `targetPlacement` field). Zero warnings.
- Compile: `tri` actionable. `[reviewed]` — the original "`props.x` bakes
  `1` — self-provider ⇒ own value; emits `prop:x="1"`" expectation is the
  SAME engine-defect manifestation as scenario 1 (GENUINE ENGINE DEFECT #1,
  publishOwn bypass): `tri` carries a consumer anchor (`b`) → the
  `resolveArms` path runs and publishOwn never fires → arm bindings = `{}`
  (`b` unresolved) → BOTH synthesized reads (`bindings.a` AND `bindings.b`)
  evaluate null → `props.x` AND `props.y` omitted; neither adapter emits
  `prop:x`. The unresolved `b` compile warning fires as expected.
- Reverse: `tri` emits ALL THREE surfaces — `placement: {placementName:
  'slot-1'}`, the 2-binding component array with both targets, and the
  handler as its source string. Re-translate: anchors identical, handler
  live again, warnings `[]` — the three surfaces round-trip without
  interference. `[reviewed]` — PASS as authored.

**Suspected failure stage**

translate (multi-surface minting), reverse (three-surface emission).

**Why it might break**

Each surface is pinned separately; the triple-node is the legacy schema's
maximal node shape and the docs never state that placement + component +
handlers coexist without interaction (prior stress scenario 10 pinned
placement+component only). Any accidental mutual exclusion (e.g. handlers
dropped when bindings exist, or the placement anchor skipped on
component-bearing nodes) surfaces here.

---

## Scenario 15 — cross-cutting names: unicode, derived-keyword collisions, empty/non-string targets

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "names-root" },
      "children": [
        { "type": "div", "props": { "id": "names" }, "component": [
          { "reference": "héllo", "value": "H", "target": "props.キー" },
          { "reference": "bindings", "value": "bv", "target": "props.a" },
          { "reference": "children", "value": "cv", "target": "props.b" },
          { "reference": "pathKey", "value": "pv", "target": "props.c" },
          { "reference": "placement", "value": "plv", "target": "props.d" },
          { "reference": "unresolved", "value": "uv", "target": "props.e" },
          { "reference": "props", "value": "ppv", "target": "props.f" },
          { "reference": "empty", "target": "" },
          { "reference": "numb", "value": "nv", "target": 42 }
        ] }
      ]
    }
  }
}
```

**Expected output**

- Translate: zero warnings. Seven bindings synthesize: `props.キー = {$
  :'bindings.héllo'}`, `props.a = {$:'bindings.bindings'}`, `props.b = {$
  :'bindings.children'}`, `props.c = {$:'bindings.pathKey'}`, `props.d = {$
  :'bindings.placement'}`, `props.e = {$:'bindings.unresolved'}`, `props.f =
  {$:'bindings.props'}` — all legal under `validatePath` (single-segment
  keys; the derived ROOT is `bindings`, so a reference NAMED `bindings`,
  `children`, `pathKey`, `placement`, `unresolved` or `props` is just a key,
  never a root collision).
- `target: ''` and `target: 42` are silently treated as ABSENT (non-empty
  string check) → `empty` anchors as a plain consumer, `numb` as a plain
  provider, NO warn — these two forms are not in the D7 syntax-edge list
  (props., props:name, props.name., bare props), so the docs are silent on
  them.
- Compile: `[reviewed]` — the original "all seven synthesized keys
  self-resolve and bake (`キー="H"`, …, `f="ppv"`)" expectation is the SAME
  engine-defect manifestation as scenarios 1/14 (GENUINE ENGINE DEFECT #1,
  publishOwn bypass): the `names` node carries a consumer anchor (`empty` —
  `target:''` is silently treated as ABSENT, so the binding anchors as a
  plain consumer) → `resolveArms` path, publishOwn never runs → bindings =
  `{}` → ALL seven synthesized reads evaluate null → NO key bakes on either
  adapter. The `empty` consumer fires the expected unresolved-reference
  compile warning; `numb` publishes nothing either (bypass). The
  unicode/root-keyword half is CONFIRMED harmless (translate-level claims
  below unchanged).
- Reverse: `[reviewed]` — all seven targeted bindings emit with `target`;
  N1 strips the seven synthesized keys; but `empty` does NOT emit
  `{reference:'empty'}` — it is DROPPED by the same shape-forced rule as
  scenario 10 (applyPath-less consumer next to a provider; payload.md R-2
  broadened — DOC fix, not a separate defect). `numb` survives as
  `{reference:'numb', value:'nv'}`. Re-translate: warnings `[]`, anchors NOT
  identical (`empty` permanently gone).

**Suspected failure stage**

translate (name/target plumbing — unicode + silent-absent targets), compile
(keyword-collision bakes).

**Why it might break**

Three doc-silent seams meet here: unicode reference/target names are only
tested for PLACEMENT (prior stress #10), never for component anchors and
derived synthesis; reference names that shadow derived DSL path ROOTS
(`bindings.<name>` reads where the name IS a root keyword) are nowhere
discussed — and `bindings.bindings` reads are a legal grammar edge that
could be accidentally reserved; and empty-string/non-string `target` values
slip past every documented guard into silent absence (the binding behaves as
reference-only, which for `{reference:'numb', value:'nv'}` silently converts
a would-be self-apply into a plain provider).

---

*End of scenario set. Probe agent: complete each scenario with core-only
probe scripts (translate → compile → both adapters; reverse + re-translate
where flagged); findings land in `docs/test-findings.md` §"Stress-test
review loop" with the validation trio green.*
