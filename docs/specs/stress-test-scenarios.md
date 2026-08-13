# Stress-Test Scenarios — legacy-JSON compile/render breakage probes

Status: input artifact of the stress-test review loop (AGENTS.md item 10,
step a). Written by the SCENARIO agent; completed by the PROBE agent (step b);
failure-state analysis lands in `docs/test-findings.md` §"Stress-test review
loop" by the REVIEW agent (step c). Entries marked `[reviewed]` were
corrected by the step-c review (scenario data or expectation fixes).

## Purpose

Hunt for compile/render breakage by framing SPECS for **VALID legacy-JSON
page data** that *should* break or surprise the compile/render pipeline. Every
envelope below is valid `LegacyInitialData` per `docs/specs/translate.md` §1
(correct shapes — the malformed-envelope guards TR-F1/TR-F2 are already
tested and are deliberately NOT probed here). The surprise must come from
**semantics**: doc-vs-data tensions where the docs are silent, contradictory,
or where behavior is defined for tiny inputs but untested at scale. Some
scenarios are expected to pass cleanly — a probe that confirms the documented
behavior is as valuable as one that breaks it.

## How to run (probe agent contract)

1. For each scenario: feed the envelope to `translateLegacy` from
   `dist/core/*` (the exact JSON in the `Situation` code block; see the
   repetition-marker rule below), compile the translated tree, and render
   through BOTH concrete adapters (`SSRFragmentAdapter` + `DomAdapter` /
   `treeFromOps`/`treeSig` parity oracle, `dist/core/adapters.js`,
   `dist/core/render-helpers.js`). Record real vs expected output per
   scenario. Probe scripts use ONLY core + legacy JSON — no page-side logic.
2. **Repetition markers**: scenarios marked *(expand)* contain a compact
   node template plus a deterministic repetition rule (e.g. "1000 levels of
   this child" / "10,000 children of this shape"). The probe generates the
   full envelope mechanically before feeding it — the expansion is data
   generation, not page logic.
3. **Dispatch-driven scenarios**: where the expected output requires a
   handler to fire (event/phase), the probe drives it with core APIs
   (`dispatchEvent`/`dispatchPhase`/`runPhase`) after the static render, and
   records both the static render and the post-dispatch delta.
4. For each scenario the probe must also verify the validation trio
   (below) still passes after any probe work, and must watch the
   `[fork-stress-data:profile]` totals for pass-2 scaling regressions.
5. Every real-vs-expected mismatch is classified by the review agent as:
   doc/spec bug (fix the doc), data-authoring bug (fix the scenario data),
   or genuine engine defect (report — do not fix engine code in this loop).

## Validation trio (each probe agent, after its work)

```
npm test           # vitest — full suite
npm run typecheck  # tsc --noEmit
npm run demo:smoke # headless run of all demo checks
```

All three must pass before a scenario is reported complete. Also watch the
smoke's profile totals: the values/link-only d12 totals must stay within
~1.5× of the placement d12 total; the page profiler does NOT time supervisor
pass-2 (RCA: `docs/session-defect-review.md`, fork-stress-data section) — a
blow-up in `total − Σ(measured sections)` means the pass-2 pipeline is
scaling badly (AGENTS.md item 4).

---

## Scenario 1 — 1000-level acyclic child chain (deep nesting) *(expand)*

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "deep-root" },
      "content": "level 0",
      "children": [ { "type": "div", "props": { "id": "level-1" }, "content": "level 1", "children": [ /* REPEAT 998x: {"type":"div","props":{"id":"level-N"},"content":"level N","children":[...]} */ { "type": "div", "props": { "id": "level-1000" }, "content": "level 1000" } ] } ]
    }
  }
}
```

*(expand)*: a single-parent child chain of exactly 1000 `div` nodes, each
with `props.id` `level-<N>` and `content` `"level <N>"`, nested depth-first
under the root.

**Expected output**

Per `docs/specs/compile-horizon-review.md` §6.1: acyclic parent chains have
**no depth cap** (memoized root-first chainRoot, cycle-only loop signal) →
all 1000 levels compile actionable, root-first; the leaf renders; `pathKey`
of the leaf is 1000 segments; SSR `toString()` nests 1000 deep with correct
close tags at every level (FRG-H15 asserts 3+ levels only); `serializeSlice`
round-trips. No warning, no drop.

**Suspected failure stage**

compile (pass-2), emit.

**Why it might break**

Docs pin the parent-chain walk as cycle-only, but nothing tests a 1000-level
chain. Any per-level recursion left in `compileRemote`/`emitElements`/
`serializeSlice`/`diffMinimal`/SSR serialization (FRG-H15 covers "3+")
grows to 1000–2000 stack frames; `JSON.stringify`/`parse` of the shipped doc
nests 1000 deep. Valid data, documented-as-supported, untested at this
horizon.

---

## Scenario 2 — 10,000-child wide tree *(expand)*

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "wide-root" },
      "children": [ /* REPEAT 10000x: {"type":"div","props":{"id":"cell-N"},"content":"cell N"} */ ]
    }
  }
}
```

*(expand)*: 10,000 direct `div` children of the root, `props.id` `cell-<N>`,
`content` `"cell <N>"`, in array order.

**Expected output**

All 10,000 children attach under root with `priority` = array index
(translate.md §2); all compile actionable; emit is root-first (R-ORD-8) —
one `create` per wire, 10,000 `append` ops; SSR string contains 10,000
sibling fragments in order; DOM mounts 10,000 elements. No reorder, no
duplicate, no drop.

**Suspected failure stage**

compile (pass-2 — child-order materialization on one parent-child link),
emit, diff.

**Why it might break**

The parent-child `LinkConfig` is `children: { min: 1; max: Infinity;
orderKey: 'unique' }` — 10,000 unique-priority anchors on ONE link is legal
but untested; any O(n²) order/priority or `append`-order path (D5
re-append-in-order) surfaces at this width. The diff `prev` map is bare-wire:
a 10,000-entry minimal-element diff is the largest single-batch surface the
adapter contract defines.

**[reviewed]** Probe PASS — output fully correct (10,001 actionable, 10,000
appends, all 10,000 children mounted in order, translate/compile/emit/diff
linear). One pre-existing scaling observation, NOT a defect: the
`SSRFragmentAdapter.appendChild` REMATERIALIZES the owner's `contentHtml` on
every append (adapters.md §4.3 documents "rematerialize contentText" per
append, FRG-H22 — no complexity bound is promised), i.e. O(children) string
joins per append → ~O(n²) SSR apply (10k ≈ 3.5–4s; first 5000 ≈ 502ms, last
5000 ≈ 1629ms). The DOM adapter is unaffected (pointer moves). No spec
contract violated; candidates for a future optimization pass, not this loop.

---

## Scenario 3 — element-type oddities: void tags with children, missing/numeric/uppercase types

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "types-root" },
      "children": [
        { "type": "input", "props": { "id": "void-input", "value": "v" }, "content": "text-on-input", "children": [ { "type": "span", "props": { "id": "input-child" }, "content": "child-of-input" } ] },
        { "type": "br", "props": { "id": "void-br" }, "content": "text-on-br" },
        { "type": "img", "props": { "id": "void-img" }, "children": [ { "type": "div", "props": { "id": "img-child" } } ] },
        { "type": "my-widget", "props": { "id": "custom-el" }, "content": "custom" },
        { "type": "FooBar", "props": { "id": "cased-el" }, "content": "cased" },
        { "type": 42, "props": { "id": "numeric-el" }, "content": "numeric" },
        { "props": { "id": "missing-type-el" }, "content": "notype" }
      ]
    }
  }
}
```

Note: `type` is optional in `LegacyNodeData` (`type?: string`); the
documented translate guards (translate.md §3, TR-F1) cover envelope/payload
SHAPE only — no field-level type guard is documented, so `type: 42` is
legal under the documented guard surface.

**Expected output**

- Void tags: `input`/`br`/`img` render as void (`VOID_TAGS`, adapters.md
  §4.4). **Documented divergence**: `text`/children on a void fragment are
  dropped at SSR serialization (FRG-F1/FRG-H20 — output html is `openTag`
  only), while `DomAdapter.appendChild` is plain DOM move semantics — the
  child/`value`/text land in the live DOM. Both adapters are pure mappings
  of the same op stream (PAR-5, SSR-F4) — this envelope forces a structural
  DOM-vs-SSR divergence the ops themselves do not encode.
- Unknown/custom tags: `my-widget` → `createEl('my-widget')` / `<my-widget>`;
  `FooBar` → SSR `openTag` is `'<FooBar>'` verbatim, DOM `createElement`
  lowercases per HTML parsing — the op-level parity oracle (`treeSig`) sees
  identical types on both sides; the real-browser DOM diverges from the SSR
  string (engine-neutral case folding, documented nowhere).
- `type: 42` and missing `type`: **[reviewed]** the pipeline does NOT pass
  the value through — `baseFrom` copies only string-typed `type` fields
  (translate.js `if (typeof nodeData.type === 'string')`), so the Node falls
  back to the default type `'div'` SILENTLY (node.js `type: 'div'` default);
  neither `<42>` nor `<undefined>` is ever produced on either adapter and
  nothing throws. The docs define none of this (validation.md §1 has no
  tag-name validator) — probe-recorded actual: silent `'div'` fallback.

**Suspected failure stage**

emit (adapters), validation (Pillar E tag lookup), diff/parity.

**Why it might break**

The adapter contract covers void-tag serialization but not "void + children
in the SAME batch as their parent". **[reviewed]** The divergence is fully
DOCUMENTED on both sides — SSR drops text/children on void fragments
(adapters.md §4.3/§4.4, FRG-F1/FRG-H20: void output html is `openTag`
only) and `DomAdapter.appendChild` is plain DOM move semantics (adapters.md
§3.4), so the op stream is identical while the DOM and the string diverge
— this is the documented case, NOT the class SSR-F4 forbids (neither
adapter diverges from its own §2-table row; the void-row divergence is
inherent to DOM vs string semantics and pinned by FRG-H20/FRG-F1). Probe
confirmed both sides exactly as documented.

---

## Scenario 4 — component values of unusual types + two-consumers-one-source + in-tree source scope

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "values-root" },
      "children": [
        { "type": "div", "props": { "id": "prov-v" }, "component": { "reference": "val", "value": "v1" }, "children": [
          { "type": "div", "props": { "id": "con-a" }, "component": { "reference": "val" }, "derived": { "props": { "data-resolved": { "$": "bindings.val" } } } },
          { "type": "div", "props": { "id": "con-b" }, "component": { "reference": "val" }, "derived": { "props": { "data-resolved": { "$": "bindings.val" } } } }
        ] },
        { "type": "div", "props": { "id": "sib-con" }, "component": { "reference": "val" }, "derived": { "props": { "data-resolved": { "$": "bindings.val" } } } },
        { "type": "div", "props": { "id": "prov-null" }, "component": { "reference": "nullv", "value": null }, "children": [ { "type": "div", "props": { "id": "con-null" }, "component": { "reference": "nullv" }, "derived": { "props": { "data-resolved": { "$": "bindings.nullv" }, "data-cat": { "$concat": [ "x|", { "$": "bindings.nullv" } ] } } } } ] },
        { "type": "div", "props": { "id": "prov-zero" }, "component": { "reference": "zerov", "value": 0 }, "children": [ { "type": "div", "props": { "id": "con-zero" }, "component": { "reference": "zerov" }, "derived": { "props": { "data-resolved": { "$": "bindings.zerov" } } } } ] },
        { "type": "div", "props": { "id": "prov-false" }, "component": { "reference": "falsev", "value": false }, "children": [ { "type": "div", "props": { "id": "con-false" }, "component": { "reference": "falsev" }, "derived": { "props": { "data-resolved": { "$": "bindings.falsev" } } } } ] },
        { "type": "div", "props": { "id": "prov-empty" }, "component": { "reference": "emptyv", "value": "" }, "children": [ { "type": "div", "props": { "id": "con-empty" }, "component": { "reference": "emptyv" }, "derived": { "props": { "data-resolved": { "$": "bindings.emptyv" } } } } ] },
        { "type": "div", "props": { "id": "prov-obj" }, "component": { "reference": "objv", "value": { "k": 1 } }, "children": [ { "type": "div", "props": { "id": "con-obj" }, "component": { "reference": "objv" }, "derived": { "props": { "data-cat": { "$concat": [ { "$": "bindings.objv" }, "-suffix" ] } } } } ] },
        { "type": "div", "props": { "id": "prov-arr" }, "component": { "reference": "arrv", "value": [ 1, 2 ] }, "children": [ { "type": "div", "props": { "id": "con-arr" }, "component": { "reference": "arrv" }, "derived": { "props": { "data-eq": { "$eq": [ { "$": "bindings.arrv" }, { "$": "bindings.arrv" } ] }, "data-eq-null": { "$eq": [ { "$": "bindings.arrv" }, { "$": "bindings.nope" } ] } } } } ] }
      ]
    }
  }
}
```

**Expected output**

- `con-a` and `con-b` are both descendants of `prov-v` → both resolve the
  source's value at the ancestor hop (R3): `data-resolved="v1"` on both —
  two consumers, one source, no fork (FRK-H1).
- `sib-con` is a SIBLING of `prov-v` (not a descendant of the provider, and
  the provider is not on the root): the in-tree source is invisible to it
  (S-R2.6, blind-test F2) → `unresolved-reference` compile status + logged
  warning; the node still renders its own state (S-R4.3); `data-resolved`
  omitted (missing binding → null → key omitted).
- Value types flow verbatim into bindings (source anchor `value` cell):
  `null` → `data-resolved` OMITTED, `data-cat="x|"` (null renders as `''` in
  `$concat`); `0` → `data-resolved="0"`; `false` → `"false"`; `""` →
  `data-resolved=""` (empty string bakes — NOT omitted); object →
  `data-cat='{"k":1}-suffix'` (JSON.stringify in `$concat`).
- Deep-array `$eq`: **[reviewed]** the DSL's literal whitelist is
  string/number/boolean/null ONLY (derived-state.md §3 — an array is not a
  `DerivedExpr`), so a literal `[1, 2]` operand is REJECTED at validation
  (`derived-invalid: malformed derived expression: [1,2]` — derived.js
  `validateExpr`, DV-F1 class; verified by the probe's primary run). The
  original `data-eq: { $eq: [bindings.arrv, [1,2]] }` was therefore
  unexpressible data, re-expressed above as two `$`-path operands:
  `data-eq="true"` (deep-array equality of an array-VALUED binding against
  itself — the `deepEquals` array branch, structural not reference) and
  `data-eq-null="false"` (array vs missing binding → null-safe false).
- Provider chips (`prov-*`) all have same-name targets in their own scope
  (`prov-v` HAS `con-a`/`con-b` in ITS subtree; every other provider has its
  own same-name consumer) → **[reviewed]** ALL are dropped from render per
  blind-test F3 — none renders (the original "render as empty elements"
  clause applied only to a provider WITHOUT same-name targets in scope,
  which does not exist in this envelope).

**Suspected failure stage**

compile (borrow — source scope, closest-first), derived (coercion/omission).

**Why it might break**

The doc contract for *which* sources a consumer may see (depth-0, self,
descendants, ancestors, root-fallback — resolve.md `fitReference` order) is
subtle and was wrong in the blind-test author's first pass (F2); `sib-con`
exercises the same trap. Binding values of falsy/unusual types interact
with the derived DSL's COMPLETELY-defined truthiness and null-omission
rules (derived-state.md §3–4) — `0`/`false`/`""` must bake, `null` must
omit, and a `$concat` must stringify objects — any `if (value)` shortcut in
the evaluator breaks them identically.

---

## Scenario 5 — duplex on the root (with children) + duplex whose consumed name its ancestor also provides

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "duplex-root" },
      "component": { "reference": "du", "value": "rootval", "target": "du" },
      "children": [
        { "type": "div", "props": { "id": "du-consumer" }, "component": { "reference": "du" }, "derived": { "props": { "data-resolved": { "$": "bindings.du" } } } },
        { "type": "div", "props": { "id": "du2" }, "component": { "reference": "x", "value": "duplexval", "target": "y" }, "derived": { "props": { "data-self-y": { "$": "bindings.y" } } }, "children": [
          { "type": "div", "props": { "id": "x-consumer" }, "component": { "reference": "x" }, "derived": { "props": { "data-resolved": { "$": "bindings.x" } } } }
        ] },
        { "type": "div", "props": { "id": "y-source" }, "component": { "reference": "y", "value": "ancestry" } }
      ]
    }
  }
}
```

**Expected output**

- Root carries `{reference:'du', value:'rootval', target:'du'}` → DUPLEX
  shape (translate.md §2): source for `du` + target for `du`. Root's own
  target resolves at **depth-0 (self)** — it binds its own value (S-R2.6),
  despite ALSO being the provider.
- `du-consumer` (root child, target `du`): walk → root carries a source
  `du` → binds `rootval` — the root's source half serves its descendants
  while the root's own target self-resolves. One name, two different
  bindings in one tree.
- `du2` is a duplex for a DIFFERENT pair: source `x` (value `duplexval`),
  target `y`. Its target `y` is provided by sibling `y-source` — but `du2`
  is NOT a descendant of `y-source` (siblings; source is not on the root):
  `y` → `unresolved-reference` (S-R2.6 — the sibling source is invisible),
  `data-self-y` omitted, `du2` still renders its own content.
- `x-consumer` is a CHILD of `du2` (the scenario doc originally wrote
  "descendant of du2" but the authored envelope placed it as a root SIBLING
  — a data-authoring premise error, fixed above) → the descendant walk hits
  `du2`'s source half first → binds `duplexval`, `data-resolved="duplexval"`.
  The sibling `y-source` (provider of `y`) is invisible to both `du2`'s own
  target `y` and to `x-consumer` (S-R2.6) — a duplex's `y` target never
  shadows its own `x` source for its descendants.
- Root duplex with children: the root renders both its own state and its
  children (node with BOTH a component def and children).

**[reviewed]** Corrected envelope verified against the engine: all bullets
above reproduce exactly (du-consumer=`rootval`, du2 self-y omitted +
renders, x-consumer=`duplexval`, y-source dropped, 2× unresolved-reference
warnings).

**Suspected failure stage**

compile (borrow/fork — depth-0 self-resolution vs source-half service).

**Why it might break**

The duplex is a single anchor carrying target + value; the depth-0 rule
(R2) resolves the node's OWN target at itself, while its source half feeds
descendants — the split is only documented in prose (translate.md §2
"self-providing consumer", api.md §4 R2) and was misread in the blind test
(F4: "duplex-alone → no self binding"). A root-level duplex is the extreme
of that split: same node is root, provider, consumer, and parent.

---

## Scenario 6 — circular and depth-capped component chains

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "chain-root" },
      "children": [
        { "type": "div", "props": { "id": "tri-consumer" }, "component": { "reference": "a1" }, "derived": { "props": { "data-resolved": { "$": "bindings.a1" } } }, "children": [
          { "type": "div", "props": { "id": "tri-a" }, "component": { "reference": "a1", "value": "A", "target": "a2" }, "children": [
            { "type": "div", "props": { "id": "tri-b" }, "component": { "reference": "a2", "value": "B", "target": "a3" }, "children": [
              { "type": "div", "props": { "id": "tri-c" }, "component": { "reference": "a3", "value": "C", "target": "a1" } }
            ] }
          ] }
        ] },
        { "type": "div", "props": { "id": "lin-consumer" }, "component": { "reference": "p1" }, "derived": { "props": { "data-resolved": { "$": "bindings.p1" } } }, "children": [
          { "type": "div", "props": { "id": "lin-p1" }, "component": { "reference": "p1", "value": "v1", "target": "p2" }, "children": [
            { "type": "div", "props": { "id": "lin-p2" }, "component": { "reference": "p2", "value": "v2", "target": "p3" }, "children": [
              { "type": "div", "props": { "id": "lin-p3" }, "component": { "reference": "p3", "value": "v3", "target": "p4" }, "children": [
                { "type": "div", "props": { "id": "lin-p4" }, "component": { "reference": "p4", "value": "v4", "target": "p5" }, "children": [
                  { "type": "div", "props": { "id": "lin-p5" }, "component": { "reference": "p5", "value": "v5", "target": "p6" }, "children": [
                    { "type": "div", "props": { "id": "lin-p6" }, "component": { "reference": "p6", "value": "v6", "target": "p7" }, "children": [
                      { "type": "div", "props": { "id": "lin-p7" }, "component": { "reference": "p7", "value": "v7", "target": "p8" }, "children": [
                        { "type": "div", "props": { "id": "lin-p8" }, "component": { "reference": "p8", "value": "v8", "target": "p9" }, "children": [
                          { "type": "div", "props": { "id": "lin-p9" }, "component": { "reference": "p9", "value": "v9", "target": "p10" }, "children": [
                            { "type": "div", "props": { "id": "lin-p10" }, "component": { "reference": "p10", "value": "v10", "target": "p11" } }
                          ] }
                        ] }
                      ] }
                    ] }
                  ] }
                ] }
              ] }
            ] }
          ] }
        ] }
      ]
    }
  }
}
```

**Expected output**

- **Triangle** (`a1→a2→a3→a1`): resolving `tri-consumer`'s target `a1`
  descends into provider-own-target recursion and revisits `a1` → fork arm
  **dropped** with reason `loop` + one `circular-source` diagnostic warning
  **per dropping node** (S-R2.5, api.md §4.3 — the warnings array is
  per-drop: tri-consumer + tri-a/b/c log 4 total, not one; [reviewed]);
  `data-resolved` omitted; the other subtree is
  unaffected.
- **Linear chain** (`p1→…→p10`): acyclic but ≥9 provider hops →
  `resolveNames` recursion trips `MAX_COMPILE_DEPTH = 8`
  (compile-horizon-review.md §6.3/§6.4 — pinned: "provider chain ≥ 9 hops
  → drop"; depth-cap trips **count AS loop**, pipeline.md §2.1) → arm
  dropped + `circular-source` warning per dropping node (lin-consumer +
  lin-p1 = 2 more); `data-resolved` omitted.
- **Rendering after a drop**: **[reviewed]** a LOOP-dropped arm exposes NO
  actionable state (api.md T13: "no actionable state" — dropped arms
  contribute nothing, S-R3.10), so `tri-consumer` and `lin-consumer` do NOT
  render at all (absent from SSR). Only the `unresolved-reference` class
  renders its own state (S-R4.3) — here `lin-p2`…`lin-p10` (their walks hit
  `p11` at exactly depth 8 → no provider → actionable WITH
  `unresolved-reference`; probe: 9 unresolved warnings total). The original
  "the consumer still renders its own state" expectation applied the
  unresolved class's rule to the loop class by mistake.

**Suspected failure stage**

compile (borrow/fork — `resolveNames` recursion + loop detection).

**Why it might break**

Two documented caps that are easy to conflate: the parent-chain walk is
now uncapped/cycle-only (compile-horizon §6.1), but the PROVIDER-CHAIN
recursion cap (8) still drops valid data — and per pipeline.md §2.1 the
drop is mislabeled `loop`. A linear chain that merely exceeds the recursion
cap gets reported as `circular-source`, which is semantically false. The
triangle is the real-cycle control: both must produce `circular-source`,
but only the triangle is a genuine loop.

---

## Scenario 7 — fork: 5 descendant providers for one name (5 arms) + derived per-arm bake

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "fork5-root" },
      "children": [
        { "type": "div", "props": { "id": "fork-consumer" }, "component": { "reference": "multi" }, "derived": { "props": { "data-resolved": { "$": "bindings.multi" } } }, "children": [
          { "type": "div", "props": { "id": "f1" }, "component": { "reference": "multi", "value": "m1" } },
          { "type": "div", "props": { "id": "f2" }, "component": { "reference": "multi", "value": "m2" } },
          { "type": "div", "props": { "id": "f3" }, "component": { "reference": "multi", "value": "m3" } },
          { "type": "div", "props": { "id": "f4" }, "component": { "reference": "multi", "value": "m4" } },
          { "type": "div", "props": { "id": "f5" }, "component": { "reference": "multi", "value": "m5" } }
        ] }
      ]
    }
  }
}
```

Note (format limit, blind-test F5): the legacy format carries ONE component
binding per node, so five same-name sources cannot ride the root — the
consumer's **descendant** providers are used instead (`fitReference` order:
self → descendants → ancestors → fallback, compile-horizon §6.3).

**Expected output**

- `fork-consumer` resolves `multi` across 5 descendant sources → **5
  actionable fork arms**, all root-terminated, distinct `forkKey`s
  (path-to-root through each provider: `root/…/f1` … `root/…/f5`); no
  coerced pick (S-R2.5, api.md §4.2/§6 F4).
- Emit: **[reviewed]** 5 `create` ops — one PER ARM on the documented
  `emitElements` arm-wire scheme `<nodeId>#<0..4>` (fork-stress.md — the
  scenario's "5 creates for ONE wire" premise conflated the adapter-level
  contract DOM-H26/FRG-H23, same-wire+distinct-forkKey, with the canonical
  emit convention) — 5 mounted elements / 5 SSR fragments; each arm's `set`
  ops should ALSO carry that arm's `forkKey` (render.md §3.1/adapters.md
  HLP-H16) but do NOT — the compiled states carry distinct `forkKey`s and
  `emitOne` drops them (ENGINE DEFECT #1, see test-findings); arms stay
  distinct only via the wire suffixes.
- Derived per-arm (DV-H3): each arm's state bakes its own `data-resolved` —
  `m1`…`m5` across the 5 arms (probe: arms enumerate m5→m1 in arm order
  0..4 — the descendant-provider walk pops the child stack LIFO, f5 first;
  all five values present); `treeSig` keeps the arms distinct.
- The provider nodes `f1..f5` are source-only with same-name targets in
  scope → dropped from render (blind-test F3).

**Suspected failure stage**

compile (fork), emit (multi-create per-arm wires; forkKey forwarding),
derived (per-arm evaluation).

**Why it might break**

The multi-create-per-wire contract is tested at 2 arms (DOM-H26/FRG-H23)
and the fork-stress demo forks at scale via clone-instance — but a legacy
envelope producing 5 arms for one consumer exercises the fork/emit path
with no page logic. Per-arm derived baking (derived-state §4 "per-arm
evaluation") is the newest surface. Profile note: this is a values-method
shaped tree — its d12-style totals must not blow up pass-2 (AGENTS.md item
4).

---

## Scenario 8 — fork where one arm resolves and another silently drops

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "mixed-root" },
      "component": { "reference": "mixed", "value": "rootval" },
      "children": [
        { "type": "div", "props": { "id": "mixed-consumer" }, "component": { "reference": "mixed" }, "derived": { "props": { "data-resolved": { "$": "bindings.mixed" } } } }
      ]
    },
    "children": [
      { "type": "div", "props": { "id": "unplaced-provider" }, "component": { "reference": "mixed", "value": "unplacedval" } }
    ]
  }
}
```

**Expected output**

- `mixed-consumer` (root child) resolves `mixed`: the ROOT itself carries
  the source (depth-0, fallback-of-last-resort, D5) → arm root-terminated
  → **actionable**, `data-resolved="rootval"`.
- `unplaced-provider` sits in `template.children` → unplaced content node
  (translate.md §2, registered payload-owned). **[reviewed]** Mechanism
  differs from the original prose: the unplaced provider is NEVER enumerated
  as an arm — `fitReference` hits the root's source during the ancestor walk
  FIRST (D5 root fallback), so the "arm terminates at an unplaced node →
  silent drop" branch (owner-terminated class, S-R3.10) never fires. The
  OUTCOME is the original expectation: exactly ONE actionable state for
  `mixed-consumer` (`rootval`), zero warnings, zero drops; `treeSig` shows
  one arm; the unplaced provider renders nothing.

**Suspected failure stage**

compile (fork — arm-termination disposition), resolve.

**Why it might break**

The docs define fork-arm disposition for three terminations — root
(actionable), component prototype/`contentNodes` (silent drop), loop
(warning) — and are **silent on a provider whose chain is simply
`unplaced`**. Valid data whose second arm terminates in a state the spec
does not enumerate: the probe will find either a silent drop (best-doc
reading), an `unresolved-reference` on the consumer, or a crash. All three
outcomes are interesting.

---

## Scenario 9 — a name provided by the consumer's own ancestor TWICE (nearest shadows far)

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "shadow-root" },
      "component": { "reference": "dup", "value": "far", "target": "dup" },
      "children": [
        { "type": "div", "props": { "id": "near-provider" }, "component": { "reference": "dup", "value": "near" }, "children": [
          { "type": "div", "props": { "id": "deep-consumer" }, "component": { "reference": "dup" }, "derived": { "props": { "data-resolved": { "$": "bindings.dup" } } } }
        ] }
      ]
    }
  }
}
```

**Expected output**

- `deep-consumer` (depth 2): walk toward root hits `near-provider`'s source
  FIRST → binds `"near"` — **no fork** despite two same-name providers on
  the path (R3 closest-first, "nearest shadows far", D5; api.md T10).
  `data-resolved="near"`.
- The root's own duplex target `dup` self-resolves at depth 0 → root binds
  `"far"` (its own value) — one name, two resolved values in one tree.
- `near-provider` is a source-only node with a same-name target in its
  subtree → dropped from render (blind-test F3).

**Suspected failure stage**

compile (borrow — fork-vs-nearest ambiguity).

**Why it might break**

Multiplicity forks (S-R2.5) and closest-first shadowing (R3) are both
"first match" rules at different stages; a walk that encounters the same
name twice is the fork-vs-shadow boundary. A consumer whose ancestor chain
carries the name twice must NOT fork — only genuinely distinct
root-terminated paths fork (T12/T10 boundary).

---

## Scenario 10 — placement: same-name multiplicity (dots/unicode names) + placement+component on one node

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "placement-root" },
      "children": [
        { "type": "section", "props": { "id": "slot-1" }, "placement": { "placementName": "zone.one" } },
        { "type": "section", "props": { "id": "slot-2" }, "placement": { "placementName": "zone.one" } },
        { "type": "div", "props": { "id": "unicode-slot" }, "placement": { "placementName": "zóné 空间" } },
        { "type": "div", "props": { "id": "space-slot" }, "placement": { "placementName": "zone one" } },
        { "type": "div", "props": { "id": "dual-slot" }, "placement": { "placementName": "dual" }, "component": { "reference": "dual", "value": "dualval" } }
      ]
    }
  }
}
```

**Expected output**

- `slot-1` + `slot-2` share `placementName 'zone.one'` → both get
  `placement`-role anchors on the SAME per-name placement Link (TR-2).
  **[reviewed]** The original expectation — "placement multiplicity forks
  exactly like components (P3, api.md §5) → two actionable compiled states,
  distinct `forkKey`s, two `create` ops for one wire" — is NOT expressible
  from a static legacy envelope: api.md §4 applies placement resolution via
  **`attach` op + compile**, and P3's multiplicity fork materializes only
  through that dynamic path (same for components at §4.2 — attach-driven
  compile). In a static compile the two slots are two distinct NODES; each
  compiles to ONE actionable state on its OWN wire (no fork, no forkKey —
  placement anchors are seeds, inert until attach). The render OUTCOME of
  the original expectation holds: both slots render.
- Placement names with dots, unicode, spaces are opaque target strings —
  no parsing, no validation (placementName is not a derived path key; the
  dot-key rejection applies to derived DSL paths only, derived-state.md §3
  vs blind-test F1); minted verbatim, no throw.
- `dual-slot` carries BOTH a placement anchor AND a component source:
  different link kinds (placement Link vs component Link) → no
  `role-mismatch` (P2 — roles are whitelisted per link config); node
  actionable; provides `dual` at depth-0 to its subtree (probe:
  bindings.dual=dualval).

**Suspected failure stage**

compile (fork — placement multiplicity, attach-driven only),
translate (anchor minting for non-ASCII/dot names).

**Why it might break**

The placement fork (P3) is documented but is attach+compile-driven — a
static legacy envelope with two same-name placements is NOT a route to that
surface (the probe confirms: placement anchors are inert at static compile);
the same-name placements instead confirm the dual-anchor minting, the
opaque-name minting (unicode/dot/space), and the dual-anchor node the
`role-mismatch` prose (P2) warns about — the probe confirms the two roles
never collide.

---

## Scenario 11 — handler bodies: invalid JS syntax at translate, throwing, non-undefined return, duplicate names, event/phase cross-fire

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "handlers-root" },
      "children": [
        { "type": "div", "props": { "id": "syntax-h" }, "handlers": [ { "name": "syntax", "event": "boom", "body": "function () {" } ] },
        { "type": "div", "props": { "id": "throw-h" }, "handlers": [ { "name": "thrower", "event": "doit", "body": "function () { throw new Error('containment probe'); }" } ] },
        { "type": "div", "props": { "id": "ret-h" }, "handlers": [ { "name": "returner", "event": "ret", "body": "function (ctx) { return 42; }" } ] },
        { "type": "div", "props": { "id": "dup-h" }, "handlers": [
          { "name": "dup", "event": "click", "body": "function (ctx, ev) { return 'first'; }" },
          { "name": "dup", "event": "click", "body": "function (ctx, ev) { return 'second'; }" }
        ] },
        { "type": "div", "props": { "id": "cross-h" }, "handlers": [
          { "name": "tick", "event": "click", "body": "function () { return 'event-half'; }" },
          { "name": "tick", "phase": "after-compile", "body": "function () { return 'phase-half'; }" }
        ] }
      ]
    }
  }
}
```

**Expected output**

- `syntax-h`: `new Function` on `"function () {"` throws a SyntaxError AT
  TRANSLATE (translate.md §2 — string bodies are instantiated at
  translate). The docs define NO guard for unparseable bodies — the
  envelope is valid data (a body is an opaque string). **Expected per
  current docs: translate throws (an undocumented crash surface)**; the
  probe must record whether it is a structured guard or a raw exception.
- `throw-h`: dispatch `doit` → body throws → **contained** (handlers.md
  H-H4): error returned in the results list, no propagation, node still
  renders.
- `ret-h`: dispatch `ret` → result `42` returned in the results; a
  non-undefined return causes no state change (returns are observation
  only, dispatch is not an apply).
- `dup-h`: dispatch `click` → BOTH `dup` handlers run in array order
  (dispatchEvent runs every match, handlers.md §3); results
  `['first','second']`.
- `cross-h`: dispatch `click` → only the event half (its `event` matches).
  Dispatch `tick` → BOTH halves run (the phase handler's `name === 'tick'`
  matches the name fallback, H-H2). `runPhase('after-compile')` → only the
  phase half.

**Suspected failure stage**

translate (body instantiation — guard-vs-crash), handler dispatch
(containment, matching).

**Why it might break**

The `new Function` instantiation at translate is the security-flagged seam
(translate.md §2) — invalid-syntax bodies are valid data that the docs
never say how to handle (guard `legacy-handler-syntax`? raw SyntaxError?
silent skip?). Dispatch containment is tested (H-H4) but the name-fallback
(H-H2) means a PHASE handler named like an event ALSO fires on that event
— a phase/event cross-fire the docs only imply; and duplicate names produce
double execution with no dedupe rule anywhere.

---

## Scenario 12 — derived DSL edges: missing path, `$gt` mixed, `$eq` deep array, `$concat` object, key collision, unplaced node

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "derived-root" },
      "component": { "reference": "arrv", "value": [ 1, 2 ] },
      "children": [
        { "type": "div", "props": { "id": "derived-d", "stress:expanded": "authored-value" },
          "component": { "reference": "arrv" },
          "derived": { "props": {
            "stress:expanded": { "$if": { "cond": { "$gt": [ { "$": "children.length" }, 0 ] }, "then": true, "else": false } },
            "data-missing": { "$": "bindings.nope" },
            "data-gt-mixed": { "$gt": [ { "$": "bindings.arrv" }, "a" ] },
            "data-gt-ok": { "$gt": [ { "$": "children.length" }, 0 ] },
            "data-eq": { "$eq": [ { "$": "bindings.arrv" }, { "$": "bindings.arrv" } ] },
            "data-cat": { "$concat": [ { "$": "bindings.arrv" }, "-suffix" ] }
          } },
          "children": [ { "type": "span", "props": { "id": "derived-d-child" } } ]
        }
      ]
    },
    "children": [
      { "type": "div", "props": { "id": "unplaced-derived" }, "derived": { "props": { "data-never": { "$": "children.length" } } } }
    ]
  }
}
```

**Expected output**

- `derived-d` is a root child targeting `arrv` → the root's depth-0 source
  resolves `[1, 2]` (D5 fallback) — one binding, read by every derived
  form below:
  - `data-missing`: `bindings.nope` does not exist → null → **key omitted**
    (DV-F2, null omission).
  - `data-gt-mixed`: `$gt` with (array, string) operands — a pair that is
    neither (number, number) nor (string, string) — → **null → key
    omitted** (derived-state.md §3 table).
  - `data-gt-ok`: `$gt` with (number, number) operands (`children.length`
    = 1 vs literal 0) → `true` — the CONTROL that the mixed rule is a
    type-pair rule, not an "operand B is a literal" rule.
  - `data-eq`: **[reviewed]** the array literal `[1,2]` operand was
    unexpressible data — the DSL literal whitelist is
    string/number/boolean/null only (derived-state.md §3), so the authored
    `$eq: [bindings.arrv, [1,2]]` threw `derived-invalid` at translate
    (probe primary). Re-expressed with two `$`-path operands: JSON-deep
    equality of the resolved `[1,2]` binding against itself → `true`.
  - `data-cat`: `$concat` with an array operand → `JSON.stringify` →
    `'[1,2]-suffix'`.
- `stress:expanded`: authored as a prop AND declared derived — derived wins
  at the STATE level (`true`, since `derived-d` has 1 child); the pass-1
  canon `node.props` keeps `'authored-value'` untouched (DV-H5/DV-H6 —
  clone-before-merge); **[reviewed]** `serializeNode` omits ALL
  derived-declared keys from shipped props per derived-state.md §2 ("the
  rule replaces them") — including the authored `stress:expanded`
  value, which therefore NEVER round-trips (probe: shipped keys = `["id"]`;
  the original "the serialized authored state keeps authored-value
  untouched" misapplied DV-H5 to the serialized doc).
- `unplaced-derived`: valid declaration, but the node is unplaced content
  → dropped from compile (S1.1) → the derived decl never evaluates; no
  state, no bake. (A MALFORMED decl on the same node WOULD throw
  `derived-invalid` at translate — DV-F3 — that guard is not probed here.)

**Suspected failure stage**

compile (pass-1 derived application), derived (evaluation/merge).

**Why it might break**

The DSL's edge semantics are precisely specified (§3) but hostile to
common shortcuts: `$gt` on mixed pairs must yield null (not false) and the
rule is a type-PAIR rule (a literal operand changes nothing), missing
bindings must omit keys (not bake `"null"`), arrays/objects in `$concat`
must JSON.stringify, deep-array `$eq` must be structural, and the
clone-before-merge (§4) must protect the pass-1 canon when a derived key
collides with an authored prop. Each of these is a documented rule with an
unforgiving opposite.

---

## Scenario 13 — css/id: classes as string, cssDef of object type, huge style string, css.id on root, authored id collisions

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "css-root" },
      "css": { "id": "app-root", "classes": "app app--wide", "style": "padding:1px;", "cssDef": { ".probe": { "color": "red" } } },
      "children": [
        { "type": "div", "props": { "id": "dup" }, "content": "first dup" },
        { "type": "div", "props": { "id": "dup" }, "content": "second dup" },
        { "type": "div", "props": { "id": "css-overridden" }, "css": { "id": "real-id" }, "content": "css id wins" },
        { "type": "div", "props": { "id": "huge-style" }, "css": { "style": "padding:1px;margin:2px;background:linear-gradient(90deg,#a1a1a1 0%,#b2b2b2 8.33%,#c3c3c3 16.66%,#d4d4d4 25%,#e5e5e5 33.33%,#f6f6f6 41.66%,#070707 50%,#181818 58.33%,#292929 66.66%,#3a3a3a 75%,#4b4b4b 83.33%,#5c5c5c 91.66%,#6d6d6d 100%)repeat-y;border:1px solid #123456;" } }
      ]
    }
  }
}
```

**Expected output**

- `css.classes` as a STRING (not array): adapter `css:classes` branch
  handles both (adapters.md §3.2 — `Array.isArray ? join : String(val)`) →
  `class="app app--wide"`; `minimalFromState` must pass it through.
- `css.cssDef` as an OBJECT: cssDef flows ONLY through the batch `styles`
  op (R6 — never a `css:cssDef` set); the styles channel stringifies with
  `String(val)` → the single `<style id="preempt-dynamic-styles">` block
  contains the object's string form (`[object Object]`); exactly one style
  element on DOM (DOM-H12/H13).
- Root `css.id` `app-root` → root element `id="app-root"`; the hydration
  seam collects it into `reused`.
- Two nodes authored `props.id "dup"` → both render `id="dup"` (duplicate
  DOM ids; no uniqueness guard documented).
- `css-overridden`: `css.id` overwrites the authored `props.id` on render
  (blind-test F6) → element id `real-id`, NOT `css-overridden`.

**[reviewed]** The expected output above is SPEC-CONSISTENT (it follows
R6/HLP-H1/H13 + DOM-H12/H13 + FRG-H17); the probe mismatch is ENGINE-side,
not doc-side: the canonical `emitElements` path leaks `css.cssDef` as a
`css:cssDef` SET op (R6's exclusion exists in `minimalFromState` only) and
never emits a `styles` op, so the DOM side gets a `cssDef="[object Object]"`
attribute (deterministic fallback, adapters.md §3.2) and NO style element,
while the SSR side routes the set into its stylesBuffer (style block present,
[object Object]) — the two adapters diverge for the same op stream.
Engine defects #2/#3 in test-findings.

**Suspected failure stage**

emit (minimalFromState cssDef exclusion), diff, adapters, hydrate seam.

**Why it might break**

The css surface has three doc-vs-data soft spots: (a) `cssDef` with a
non-string payload stringifies into the style block (valid data, ugly
output, and R6 depends on `minimalFromState` correctly excluding
`css:cssDef` from set-ops); (b) `classes` as string is adapter-supported
but may collide with a Pillar-E validator expecting an array; (c) duplicate
authored ids are legal and the hydration `querySelector` first-match makes
the SECOND `dup` element unreusable — the F6 `css.id`-wins rule interacts
with a colliding authored id.

---

## Scenario 14 — unicode / quoting / escaping in content and props

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "escape-root" },
      "children": [
        { "type": "div", "props": { "id": "esc-content" }, "content": "a < b & c > d \"q\" é→🚀 雪" },
        { "type": "div", "props": { "id": "esc-attr", "data-q": "x\"y&z", "data-u": "zóné 🚀" }, "content": "attr probe" },
        { "type": "div", "props": { "id": "esc-newline" }, "content": "line1\nline2\ttab" },
        { "type": "button", "props": { "id": "esc-handler" }, "handlers": [ { "name": "esc", "event": "click", "body": "function (ctx) { return \"quoted \\\"body\\\"\"; }" } ], "content": "click" }
      ]
    }
  }
}
```

**Expected output**

- SSR: text escaped with `& < >` (escapeText); attribute values escaped
  with `& " < >` (escapeAttr, FRG-H12/H13); unicode passes through
  verbatim (no entity encoding); newline/tab preserved in `contentText`.
- DOM: `textContent`/attributes carry the raw values.
- Structural parity (PAR-5): `treeSig(treeFromOps(ops))` of the DOM op
  stream equals the SSR string parsed back into the same structural tree —
  the escape transformations must be inverse-of-nothing: escaping on the
  SSR side only, so both sides describe the same logical content.
- The handler body string (with embedded escaped quotes) instantiates and
  dispatches on `click` without mangling.

**Suspected failure stage**

emit (adapters — escape parity), handler dispatch.

**Why it might break**

Escaping is defined per-side (escapeText vs escapeAttr differ — `"` is
escaped in attributes but not text); a content value containing BOTH quote
styles and unicode is the exact input that separates the two tables. A
shared escape helper (or missing `"` in one table) breaks FRG-H12/H13
without any throw — silent output divergence.

---

## Scenario 15 — content payloads: empty content array, metadata, payload children, refs, self-providing duplex, duplicate literal children

**Situation**

```json
{
  "template": {
    "root": {
      "type": "app",
      "props": { "id": "payload-root" },
      "children": [
        { "type": "div", "props": { "id": "lit-a" }, "content": "lit" },
        { "type": "div", "props": { "id": "lit-b" }, "content": "lit" }
      ]
    }
  },
  "content": [
    { "metadata": { "section": "a" }, "userData": { "k": 1 }, "content": [] },
    { "content": [
      { "type": "div", "props": { "id": "pc1" }, "children": [ { "type": "span", "props": { "id": "pc1-child" }, "content": "child-of-payload" } ] },
      { "type": "div", "props": { "id": "pc2" }, "component": { "reference": "ghost" } },
      { "type": "div", "props": { "id": "pc3" }, "component": { "reference": "selfv", "value": "sv", "target": "selfv" } }
    ] }
  ]
}
```

**Expected output**

- First payload's `metadata`/`userData` surface on `TranslatedTree`
  (first-payload-wins, translate.md §2); an EMPTY `content: []` payload is
  valid (NodeData[]) and contributes zero nodes.
- Payload items are UNPLACED content nodes (translate.md §2): `pc1` +
  `pc1-child` translate with parent-child anchors (nested children
  recursively translated, TR-H1), `pc2` carries a `target` anchor, `pc3`
  carries a duplex (source `selfv` + target `selfv`).
- Root renders alone; NO payload node renders and NO payload compile
  happens (content nodes dropped from compile, S1.1) — so `pc2`'s `ghost`
  target never produces an `unresolved-reference` warning (compile never
  runs on it), and `pc3`'s self-providing duplex is only meaningful once
  attached into a placement zone (translate.md §2 "a content node that
  self-provides resolves depth-0" — resolution, not rendering).
- `lit-a`/`lit-b` are two IDENTICAL literal node objects in
  `template.root.children` (JSON has no identity — two equal literals is
  legal): they mint TWO distinct nodes (TR-3 single-parent each exactly
  once, TR-4 unique deterministic root-first ids), both in-tree, both
  render as two sibling copies with equal content — no dedupe-by-value, no
  object sharing.

**Suspected failure stage**

translate (minting — duplicate literals), compile (unplaced drop).

**Why it might break**

Two traps: (a) the duplicate-literal pair is legal data that tests whether
translation mints per-array-slot (TR-3/TR-4) or accidentally dedupes by
value / reuses a prototype object; (b) the payload items look "compilable"
(content/component refs/children) but must be inert until attached — any
eager compile or warning emission for unplaced nodes violates S1.1 and the
silent-drop discipline.

---

## Scenario 16 — clientConfig run* gate combinations

**Situation** (probe feeds all four envelopes; each is `LegacyInitialData`
with the same minimal root)

```json
{ "template": { "root": { "type": "app", "props": { "id": "cfg" }, "content": "cfg-probe" } } }
```

```json
{ "template": { "root": { "type": "app", "props": { "id": "cfg" }, "content": "cfg-probe" } }, "clientConfig": { "runInstantiation": true, "runMonitoring": true } }
```

```json
{ "template": { "root": { "type": "app", "props": { "id": "cfg" }, "content": "cfg-probe" } }, "clientConfig": { "runInstantiation": false, "runMonitoring": false } }
```

```json
{ "template": { "root": { "type": "app", "props": { "id": "cfg" }, "content": "cfg-probe" } }, "clientConfig": { "runInstantiation": true, "runRendering": false, "runValidation": false, "runAssembly": false, "runPostprocessing": false } }
```

**Expected output**

- Missing `clientConfig` → `{ adapter: 'dom', persistence: false }`.
- `{runInstantiation:true, runMonitoring:true}` → `{ adapter: 'ssr',
  persistence: true }`.
- `{runInstantiation:false, runMonitoring:false}` → `{ adapter: 'dom',
  persistence: false }`.
- The fourth envelope: `runInstantiation:true` → adapter `'ssr'`; the
  OTHER gates (`runRendering`, `runValidation`, `runAssembly`,
  `runPostprocessing`) are NOT mapped by translate.md §2 — ignored like
  other unknown fields (TR-F2), no throw; the doc still renders fully and
  identically to envelope 2 (rendering is not gated by `runRendering`).
- All four: `translated.clientConfig` keeps the exact 2-field shape
  `loadState` accepts; `serializeSlice` preserves it (TR-5).

**Suspected failure stage**

translate (mapping), none (if the mapping holds exactly).

**Why it might break**

The seven gate names (runInstantiation/runAssembly/runPreprocessing/
runValidation/runRendering/runPostprocessing/runMonitoring) look like a
pipeline control surface, but only two are mapped (adapter/persistence —
translate.md §2) — a data author reasonably expects `runRendering:false`
to stop rendering. The probe pins that the unmapped gates are truly inert
(TR-F2) rather than accidentally consulted somewhere in compile/render.

---

*End of scenario set. Probe agent: complete each scenario with core-only
probe scripts; findings land in `docs/test-findings.md` §"Stress-test
review loop" with the validation trio green.*
