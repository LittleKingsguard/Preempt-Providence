# Derived State — Spec (variant D: data-carried, single-pass, parity-safe derivation)

Status: spec for variant D of the "mid-process handlers" proposal — the
three-agent review (`docs/specs/mid-process-handler-review.md`) verdict.
Reviewer loop (subagents.md Step 3): 3 passes, clean — findings 1-17 (pass
1) resolved or parked as DECIDED (§3 syntax adaptation, §7 direct
`layers.push` constraint, §8 legacy flattening); pass 2 (must-fix §9.2
leaf-chain redesign + 2 a-big fixes); pass 3 (one a-big prose precision on
the flush-coalescing guarantee, fixed). IMPLEMENTATION DONE: core unit
(src/core/derived.ts + types/node/serialize/translate + tests/unit/
derived.test.ts — 27 tests, 496 total) and demo adoption (§9.2 — all
fork-stress-data pages: derived `stress:expanded`, parent-set chains,
no self-ops — handlerCalls 8188 → 4094 at d12, totals dropped ~35%).
§9.1 (components.js data-resolution bake) PARKED as a follow-up.
reject in-compile handler mutation (Mode B); replace with A (landed: `ctx.node`
per-dispatch context enrichment) + D (this spec). D is the durable, safe form
of "bake derived values into the compiled state without a second pass":
a data-carried `derived` declaration evaluated inside the existing compile
path — no dispatch, no handler, no journal, no eval. Companion:
`docs/specs/mid-process-handler-review.md` §5D, `docs/specs/render.md` §5
(SER-R1), `docs/specs/node.md` (two-pass compile).

## 1. Purpose

Let node data declare props that are DERIVED from the node's own compiled
state (resolved bindings, pathKey, children count, …) and have them baked
into every compiled state — durably (re-derived on EVERY pass, focus or
walk-path) and parity-safe (the rule ships in the serialized/legacy data, so
SSR and client re-resolution agree by construction). It replaces the pattern
of a handler (or a second pass) writing marker props after compile: those
patterns are (a) unjournaled when done by hand, (b) a second pass when done
through the managed channel (the fork-stress marker op re-dirties the node →
a second compile + after-compile dispatch), and (c) non-portable across
browser/SSR. The derived declaration is a PURE function of the compiled
state — it is the compile-side equivalent of the emit-time derivations the
demos already perform (e.g. `expandState` baking `prop:data-resolution` from
`state.bindings` in demo/components.js:193-245), made visible to handlers
(`getState`/`node.resolved`), the renderer, and the checks — everywhere the
compiled state is read.

## 2. The declaration

`derived` lives on both authoring surfaces and is merged like `handlers`
(base seeded, layers override):

```ts
interface NodeBaseData { /* … */ derived?: DerivedDecl }
interface NodeLayer     { /* … */ derived?: DerivedDecl }

interface DerivedDecl { props?: Record<string, DerivedExpr> }
```

- `compileLocal` merges `base.derived` + each layer's `derived` into the
  node's pass-1 `derived` (layer wins per key), exactly like `props`/`css`;
  a public read-only getter `node.derived` exposes the merged declaration
  (serializeNode emits from it).
- `Node.clone` copies base (`{ ...this.base }` — `derived` rides) AND must
  copy `derived` in the layer-copy loop (the loop currently enumerates
  type/content/props/css/handlers/anchors — `derived` is an implementation
  site in that loop). A clone therefore INHERITS its prototype's derived
  declarations (the fork-stress prototype-driven assembly derives on every
  clone).
- The rule ships in every data boundary: `NodeBaseData` (programmatic),
  `RenderNodeState.derived` (serializeSlice emits it; parseNodeState reads
  + VALIDATES it back — a malformed serialized `derived` throws
  `derived-invalid` at the schema boundary, like the other envelope guards),
  and `LegacyNodeData.derived` (translateLegacy `baseFrom` maps + validates
  it; reverseTranslate/nodeToLegacy emits the MERGED declaration — layers
  have no legacy home, so the round-trip is value-equivalent, not
  shape-exact: DECIDED). Without the rule in the data, SER-R1 parity would
  break: the baked props are NOT part of the authored state, so the
  serialized doc must carry the derivation, not the value. `serializeNode`
  additionally OMITS derived keys from the shipped `props` (the rule
  replaces them — a stale authored value never round-trips).

## 3. The expression DSL (JSON-only, pure, whitelisted — NO eval)

A `DerivedExpr` is one of:

| Form | Meaning |
| --- | --- |
| `string` / `number` / `boolean` / `null` | literal |
| `{ $: '<path>' }` | read a path source (below); a MISSING source yields `null` |
| `{ $concat: [e, e, …] }` | string concatenation (null renders as `''`) |
| `{ $if: { cond, then, else? } }` | conditional; `cond` truthy = boolean true, non-null, non-empty string, non-zero number |
| `{ $eq: [a, b] }` | JSON-deep equality (deterministic; null-safe — missing = null) |
| `{ $gt: [a, b] }` | numeric comparison (strings lexicographic); ANY operand pair that is not (number, number) or (string, string) — including object/array operands and `null` (missing paths) — yields `null` |

**Path roots** (whitelisted — the evaluator can never touch anything else):

| Root | Source |
| --- | --- |
| `props.<key>` | the node's pass-1 props (authored/layered) |
| `bindings.<name>` | the node's resolved binding value for `<name>` (per-arm) |
| `content` | the node's content |
| `type` | the node's type |
| `pathKey` | the compiled state's `pathKey` (fork arms carry their path) |
| `children` / `children.length` | the compiled state's child wire ids |
| `unresolved` / `unresolved.length` | the compiled state's unresolved references |
| `placement` | the node's `placement` anchor target (string) or `null` |

Rules: paths are exactly the whitelisted roots + one key segment (`props.x`,
`bindings.theme`, … — `bindings`/`props` keys are single segments; keys with
dots are REJECTED at validation); `children`/`unresolved`/`placement` are
valid ONLY as `.length` (children/unresolved) or bare (placement) — a whole-
array read of `children`/`unresolved` is REJECTED; resolved VALUES are
returned whole — deep paths into them are NOT allowed (safety + simplicity).
`$if` truthiness is defined COMPLETELY: false, null, undefined, 0, and ''
are falsy; EVERYTHING else — including `{}` and `[]` — is truthy. `$concat`
converts primitives with `String(v)` and objects/arrays with
`JSON.stringify` (values are JSON-safe); null/undefined render as `''`.
`$eq`/`$gt` on mixed shapes follow the table above. There is no string
parsing, no `new Function`, no template interpolation: everything is JSON,
validated at declaration time. This is the containment story D offers that
string handler bodies (translate.md §2) explicitly do not.

NOTE (DECIDED adaptation): the review's sketch forms (`'bindings.<name>'` /
`'$pathKey'`) predate this DSL — under §3 a plain string is a LITERAL, and
the path form is written `{ $: 'bindings.<name>' }`. The review sketch is
superseded; this syntax is the decision.

## 4. Application in the compile path

In `compile()` (node.ts), after a node's `CompiledState` is built and its
per-arm `bindings` assigned (both the no-target branch and the per-arm
branch of the actionable loop), run `applyDerived(node, cs)`:

```
if (node.derived?.props) {
  cs.props = { ...cs.props, ...evaluate(node.derived.props, { node, cs }) }
}
```

- **Clone-before-merge is mandatory**: `cs.props` aliases the pass-1 cache
  today — the merge must copy first so the authored canon (`node.props`) is
  never mutated (the pass-1 canon stays the only canon writer).
- **Per-arm evaluation**: bindings differ per fork arm, so a derived prop
  reading `bindings.<name>` is evaluated per arm with that arm's bindings
  (both actionable branches — the no-target branch sees only SELF-provided
  bindings via publishOwn, the arm branch sees the resolved arm bindings;
  "resolved binding" means whatever THIS branch's state carries).
- **Null omission**: an expression evaluating to `null`/`undefined` OMITS
  the key (the prop simply does not exist in the state — a conditional
  bake; a binding whose provider value is undefined reads as null here).
- **Determinism**: evaluation is a pure function of (node pass-1, cs) —
  the same compile twice yields equal states.

## 5. Semantics, visibility, precedence

- Derived props appear in **`CompiledState.props`** — and therefore in
  `node.resolved`, `ctx.tree.getState`, `takePass2States` (the renderer's
  input), and the emitted `prop:*` attributes. They do **NOT** appear in
  pass-1 `node.props`.
- **Precedence**: derived wins over authored values for its keys at the
  state level (a single deterministic source). Authoring a derived key via
  `state-slice` is possible but overwritten on the next compile — document
  derived keys as read-only-from-authoring.
- **Stability**: because the derivation is deterministic and re-run every
  pass, a rendered state carries the same baked props on the next pass —
  `diffMinimal` emits no spurious set churn.

## 6. Scope boundary — strictly OWN-STATE

A derived expression reads ONLY the node's own compiled state + pass-1
props. Cross-node DERIVED reads (e.g. the fork-stress `stress:layers` chain,
which needs the PARENT's derived chain) are **out of scope**: the parent's
derived value is not available at the child's compile time (compile order is
slice-order, not child-after-parent), and cross-node dependencies would break
the pure-function guarantee. The fork-stress `stress:layers` op stays
managed-channel based; only self-contained derivations are expressible
(e.g. `stress:expanded` from `children.length`).

## 7. Validation — fail-fast at declaration

`validateDerived(derived)` runs at EVERY declaration boundary, so malformed
derived data can never reach a compile pass:
- the Node constructor (base), `addLayer` (layers), `parseNodeState`
  (serialized docs — throws at the schema boundary like the other envelope
  guards), and `baseFrom` (legacy envelopes — throws `derived-invalid` at
  translate),
- and throws `derived-invalid` (code + message naming the offending
  expression) for: non-`DerivedDecl` shapes, unknown expression forms,
  non-whitelisted path roots, multi-segment `bindings`/`props` keys,
  dotted keys, `children`/`unresolved` without `.length`, deep paths into
  resolved values, `$concat`/`$eq`/`$gt` with wrong arity, `$if` without
  `cond` or without `then`, an empty `$concat`, and the reserved prop key
  `id` (collides with
  the auto-id, ensureAutoIds).

DECIDED (implementation): `applyDerived` returns `undefined` when every
key evaluates to null (the caller keeps the pass-1 alias — no needless
copy; clone-before-merge unaffected). DECIDED (parked): DV-H12's
"no spurious set churn across fork-arm re-renders" cannot be asserted at
the diff level — `diffMinimal`'s prev lookup is bare-wire, so same-wire
fork arms always churn against each other (pre-existing framework
limitation, out of derived scope); per-arm determinism is pinned instead.

DECIDED (parked): direct mutation of the public `layers` array
(`node.layers.push(...)`) bypasses `addLayer` validation — it is OUTSIDE
the supported surface (same trust level as pushing malformed handlers or
anchors today); all supported entry points validate.

Validation at declaration means compile never throws for derived data
(compile must stay non-throwing over its slice — the containment contract).

## 8. Parity guarantees

- **SER-R1 (render.md §5)**: the derived RULE ships in the data
  (NodeBaseData / RenderNodeState / LegacyNodeData), so
  `serialize(compile(node)) → JSON → loadState → compile` re-derives
  identical states. SSR and client re-resolution (S4.2) agree by
  construction — the value is never stored, only the rule.
- **Round-trips**: translateLegacy → reverseTranslate, serializeSlice →
  loadState both preserve `derived` exactly.
- **Diff stability**: deterministic re-derivation ⇒ no spurious `set` ops
  across renders (D4).

## 9. Expected consumers (implementation scope)

1. **demo/components.js `expandState`** — the `prop:data-resolution` bake
   (`component:<name>` / `placement:<target>` / `unresolved-reference` /
   `user-panel` …) becomes a `derived` declaration on the consumer nodes,
   moved from emit-time into compile — visible to handlers and checks, not
   just the emitter.
2. **fork-stress-data (all pages — cycle + single-method)** — `stress:expanded` becomes
   `{ $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true,
   else: false } }` on the prototypes (clones inherit it). This REQUIRES
   four coordinated changes, pinned here because a derived
   `stress:expanded` is always false for leaf clones (0 children forever)
   and because a self-applied op re-dirties the node (the second pass that
   a marker op used to cause):
   a. **The parent sets the CHILDREN's chains at creation.** The expander
      body, after each `clone-instance` op, applies
      `props.stress:layers = ownChain + '|' + chainSegment(layer + 1)` to
      the fresh copy (the copy is in-tree right after attach —
      `slot.familyLinkFor()` attaches it to the root-bound chain, so the
      state-slice's in-tree guard passes; the copy's own body therefore
      never sets its own chain). The kickoff sets the layer-1 chains the
      same way. Leaf chains are set by their parents — leaves never touch
      an op. The copy is marked pass-2 TWICE (clone-instance + the chain
      slice), but both marks land in the SAME flush: `pass2Dirty` is a Set
      and the chain slice runs synchronously before the copy's first
      microtask flush — one flush, one compile, one after-compile fire.
      (The 2N→N guarantee rests on this coalescing, not on single-marking —
      an async chain-slice applied after the copy's flush would re-fire.)
   b. **No self-ops at all.** The body's idempotency guard is
      `children.length`-only; after creating its children it applies NO op
      to itself. Each clone's after-compile therefore fires once per flush
      and the clone is never re-dirtied (handlerCalls drops from 2×N to N): the clone's state WITH children
      publishes through the CHILDREN's focused passes — the child's walk
      path includes the parent (focusedSliceFor), the compile's actionable
      covers the whole slice, and `pass2States.set` REPLACES the parent's
      state with the fresh copy (supervisor.ts:263-264). after-compile
      dispatches only on the dirty node, so the parent does not re-fire.
   c. **Leaf clones never re-dirty** (no op, no re-fire — no infinite
      after-compile loop; the deepest-layer check runs before any work).
   d. The checks read `stress:expanded` from the resolved state
      (`getResolvedStates`), not pass-1 props; the chain check is unchanged
      (chains are op-set pass-1 props).
   The `stress:layers` chain itself stays op-based (§6 — cross-node derived
   reads are out of scope).
3. Any future "bake a resolved binding into a prop" need.

## 10. Exhaustiveness gate (tests for the implementation unit)

| ID | State | Expected |
| --- | --- | --- |
| DV-H1 | literal / `$`-path / `$concat` / `$if` / `$eq` / `$gt` expressions | evaluated per §3 (incl. missing-path → null, truthiness rules) |
| DV-H2 | derived on base + layer (override) | merged like props; layer wins |
| DV-H3 | fork arms with different bindings | per-arm evaluation (each arm's state carries its own baked props) |
| DV-H4 | clone of a derived-bearing prototype | clone re-derives (base+layers inherited) |
| DV-H5 | `cs.props` aliasing | pass-1 `node.props` untouched after derivation (clone-before-merge) |
| DV-H6 | derived key authored via state-slice | derived wins on next compile (documented precedence) |
| DV-H7 | deterministic re-derivation | two compiles → equal states; a re-render emits no set churn for the baked key |
| DV-H8 | serializeSlice → loadState round-trip | `derived` preserved; recompile equal states (SER-R1) |
| DV-H9 | legacy envelope → translateLegacy → reverseTranslate | `derived` preserved; string-shippable |
| DV-H10 | visibility | baked props in `node.resolved`/`getState`/emitted `prop:*`; NOT in `node.props` |
| DV-H11 | no-target branch (self-provided bindings only) | derived `bindings.<name>` bakes the SELF-provided value (or omits when null) |
| DV-H12 | fork arms with differing bindings | per-arm states carry per-arm baked props; a re-render emits no spurious set churn (D4) |
| DV-H13 | clone of a derived-bearing prototype | clone re-derives (base + layer copy, incl. the layer-copy loop) |
| DV-F1 | malformed decl (unknown form / root / deep path / arity / missing cond / empty concat / dotted key / reserved `id`) | `derived-invalid` thrown at EVERY declaration boundary (constructor, addLayer, parseNodeState, baseFrom) |
| DV-F2 | expression referencing a non-existent binding | `null` → key omitted (coalesce-friendly), no unresolved-reference state change |
| DV-F3 | malformed `derived` inside a serialized doc / legacy envelope | schema-boundary `derived-invalid` (never reaches compile) |
| DV-F4 | direct `layers.push` of a malformed layer | outside the supported surface (parked decision, §7) — no test required beyond the constraint note |

## 11. Constraints

- NO dispatch, NO handler execution, NO journal writes in the derivation —
  the compile path stays pure (two-scope model, render.md §4).
- NO eval — the DSL is JSON + a whitelisted-path interpreter; the
  containment story vs string handler bodies (translate.md §2) is the point.
- The pass-1 canon is never mutated (clone-before-merge, §4).
- Cross-node derived reads are out of scope (§6).
- Validation fails fast at declaration; compile never throws for derived
  data (§7).

## 12. Companion docs to update

`docs/specs/mid-process-handler-review.md` (status: D spec exists),
`docs/specs/node.md` (makeCs/compileLocal surface), `docs/specs/render.md`
(§5 SER-R1 note + the RenderNodeState.derived field),
`RENDER_PROCESS_NOTES.md` §10.10 (DECIDED entry), `docs/skills/designing-pages.md`
(§11 matrix if the components.js bake lands).
