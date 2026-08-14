# Spec — Legacy Schema Translation: `translateLegacy`

Derivative of `RENDER_PROCESS_NOTES.md` §3.1 (raw NodeSchema types), §10.8
(anchor graph), §10.10.1 (DECIDED). The rebuild's serialized node shape is
anchors-first (`id` + `anchors[]`, children derived); original `/Preempt`
backend JSON is translated AT THE BOUNDARY so trees build out completely from
original-format data. This file is the behavior contract for the TestWriter.

> **STATUS (K1–K8 landed; reverse unit shipped; P3 placement minting landed —
> read this first):** the
> kernel landed in two units — the translate half (K1–K4, K6–K8, K5
> persistence: `options.applyPath` on anchors, `src/core/translate.ts`) and
> the reverse half (K5 emission + N1 strip-on-reverse: `nodeToLegacy` emits
> the legacy `target` field ONLY when `options.applyPath` exists — consumer
> `{reference, target}`, provider `{reference, value, target}`; anchors
> without an apply path keep the pre-kernel emission; synthesized derived
> keys (K2 `bindings.*` machinery) are stripped on reverse, authored derived
> stays; a runtime name-target coexisting with a provider anchor is
> legacy-unexpressible and is DROPPED on reverse — the reverse never emits a
> two-name duplex, and same-reference runtime forks keep the first provider
> only). The P3 placement feed (placement-path-spec §6.2) landed on top:
> `targetPlacement: string[]` mints one ORDERED `content` anchor per requested
> name (a bare string is coerced with a `placement-string-coerced` warn);
> `activePlacement` is DERIVED (typed `string`, never minted — §2.5);
> `#`-names and duplicates warn + skip (`placement-name-invalid` /
> `placement-duplicate-reference`, keep-first); the interim
> `component-target-placement` warn is REMOVED; every content payload root and
> `template.children` root receives the `contentNodes` permanent-owner parent
> anchor at translate (family-'in-tree', P3 §10.ad/F-13) and `nodeToLegacy`
> STRIPS it on reverse; the reverse emits `content` anchors back as
> `targetPlacement: string[]` in mint order + the derived `activePlacement:
> string` read. Sentences below tagged "(post-K1–K8)"/"(post-K5)"/"(P3)"
> describe THIS
> landed contract, not a future one. Everything untagged describes current
> behavior. Behavioral pins: `tests/unit/translate.test.ts` (64) +
> `tests/unit/reverse.test.ts` (15). The PRE-KERNEL contract
> (`docs/specs/legacy-component-ref-only-review.md` Appendix B/D, kept for
> history) read `component.target` as a SECOND COMPONENT NAME (duplex), never
> validated the target vocabulary, stored the root's `template.component`
> value on a dead target anchor, and emitted `target` on reverse only for the
> duplex shape — all of that is GONE and must not be resurrected.

---

## 1. Public surface

```ts
type LegacyHandlerPhase = 'before-compile' | 'after-compile' | 'after-render'

interface LegacyHandlerDef {
  name: string
  event?: string
  phase?: LegacyHandlerPhase
  body?: (ctx: unknown, ...args: unknown[]) => unknown | string
  // live function OR its source as a string — a string body is instantiated
  // into a live function at translate (new Function; admin-gated backend)
}

interface LegacyPlacementConfig {
  placementName?: string      // → 'container' role anchor (P3 §1.1)
  targetPlacement?: string[]  // preference-ordered zone names → ordered 'content' anchors (P3 §1.2);
                              // a bare string (old mis-typed shape) is coerced to [string] with a
                              // 'placement-string-coerced' warn (back-compat)
  activePlacement?: string    // DERIVED resolution record (P3 §2.5) — never authored, never minted;
                              // nodeToLegacy emits the derived read on reverse
}

interface LegacyComponentBinding {
  reference: string
  target?: string      // LOCAL injection path on the host node — legacy target
                       // vocabulary (§2.1), NOT a second component name
  value?: unknown      // value set ⇒ THIS node is its own source provider
}

interface LegacyNodeData {
  type?: string
  placement?: LegacyPlacementConfig
  component?: LegacyComponentBinding | LegacyComponentBinding[]  // K7: single OR array
  content?: unknown
  children?: LegacyNodeData[]
  props?: Record<string, unknown>
  handlers?: LegacyHandlerDef[]
  css?: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }
  versions?: unknown
  derived?: DerivedDecl  // the derived RULE, never the baked values (derived-state.md §2/§8)
}

interface LegacyTemplateData { root: LegacyNodeData; children?: LegacyNodeData[]; component?: LegacyComponentBinding | LegacyComponentBinding[] }
interface LegacyContentPayload { metadata?: unknown; userData?: unknown; component?: LegacyComponentBinding; content: LegacyNodeData[] }
interface LegacyClientConfig { runInstantiation?: boolean; runAssembly?: boolean; runPreprocessing?: boolean; runValidation?: boolean; runRendering?: boolean; runPostprocessing?: boolean; runMonitoring?: boolean }
interface LegacyInitialData { template: LegacyTemplateData; content?: LegacyContentPayload[]; clientConfig?: LegacyClientConfig }

interface TranslatedTree {
  root: Node            // in-tree ('rootNode' owner)
  nodes: Node[]         // every translated node, root first, tree order
  content: Node[]       // content nodes (template.children + payload items) — contentNodes-owned,
                        // family-'in-tree' via the permanent-owner token (P3 §10.ad/F-13)
  warnings: TranslatedWarning[]  // K4 (landed) — always-present additive channel
  metadata?: unknown    // first payload's metadata
  userData?: unknown    // first payload's userData
  clientConfig: { adapter: string; persistence: boolean }
}

// K4 warnings channel: additive translate-time diagnostics; the translator
// NEVER throws for well-formed-but-invalid binding/handler content (TR-F2).
// `path` = tree position, e.g. 'root.children[2]' / 'template.children[0]' /
// 'content[0].content[1]' / 'root.handlers[0]'. Codes: §2.1 guard list.
interface TranslatedWarning { code: string; path?: string }

function translateLegacy(doc: LegacyInitialData, opts?: { hub?: LinkConfigNameHub }): TranslatedTree
```

> **Boundary (do not conflate the two directions):** `translateLegacy`'s *input*
> is `LegacyInitialData` (`{ template, content?, clientConfig? }`) and its
> *output* is a `TranslatedTree` above — the `template`/`content`/`clientConfig`
> **envelope fields exist only on the `LegacyInitialData` INPUT**. The
> `TranslatedTree` OUTPUT has **no `.template` property**; the root node is
> `translated.root` and content nodes are `translated.content`. Only
> `reverseTranslate` (payload.md / reverse path) and `serializeSlice` produce
> an `{ template, content, clientConfig }`-shaped document again. Assertions
> like `translateLegacy(out).template?.component` are therefore wrong in both
> shapes: either `out` is `LegacyInitialData` (not yet translated) or the return
> is a `TranslatedTree` (no `.template`). The feature-matrix check that once
> read `.template` now asserts the round-tripped `target === 'session'` anchor
> on the re-translated root.
>
> **Source attachment in the legacy format** (per §10.8.2, corrected by §2.1):
> a node that contains a component VALUE is a provider — a `source` when it
> names no `target`; with a `target` path it is a provider with a LOCAL APPLY
> of the resolved value to the host path (§2.1 — legacy "provide and
> self-apply"; at a self-provider the applied value IS its own `value`; NOT a
> two-name duplex). `reverseTranslate` emits providers back
> (`{ reference, value }` — plus `target` when the anchor carries an apply
> path (K5, landed): `{ reference, value, target }`), and `Node.clone` carries
> provider values onto the clone, so a cloned data-declared provider resolves
> depth-0 at itself (S-R2.6).
>
> **RESOLVED ENGINE DEFECT (was: "publishOwn bypass on mixed nodes" —
> stress-test review loop #2, engine fix landed):** the "self-provider ⇒
> own value" contract above previously held ONLY on pure-provider nodes (no
> consumer anchors): a LEGAL K7 mix (a node carrying BOTH a consumer anchor
> and a self-provider with a local apply — distinct names, e.g. S1/S14/S15)
> routed through `resolveArms` (`node.ts:655-664` — the `publishOwn` branch
> required `targetNames.length === 0`) and its arm bindings carried only the
> CONSUMED names, so the synthesized `bindings.<own-ref>` read evaluated
> null and the self-apply was SILENTLY omitted. FIXED in the compile loop:
> `seedOwnBindings` (extracted from `publishOwn`) now seeds each arm's
> bindings with the node's own source/duplex values right after
> `cs.bindings = arm.bindings` and before the derived bake — skip-if-present
> (a same-name resolved/duplex value wins), consumed-first key order, own
> values node-static per arm. The §2.1 contract is unqualified again;
> verified by `tests/unit/node.test.ts` T1–T7 and the de-vacuoused
> translate-showcase smoke (see `docs/test-findings.md` §"Stress-test review
> loop #2" "Fix landed").

## 2. Mapping rules

| Legacy input | Translation | Basis |
| --- | --- | --- |
| `template.root` | root `Node` (`type/content/props/css/handlers`), attached to the permanent owner `'rootNode'` → in-tree | S1.1 |
| `template.root.children` (NodeData.children) | the root's OWN default children — attached under root via parent-child anchors, `priority` = array index (children stored in the root itself) | user decision, §10.10.1 |
| nested `NodeData.children` | recursively translated + attached under their parent (same priority rule) | §10.8 |
| `template.children` | contentNodes-owned content roots — translated + attached to the **`contentNodes` permanent-owner token** (family-'in-tree', node.ts:213; P3 §10.ad/F-13), returned in `TranslatedTree.content`; **registered as payload-owned content** (persist in the background while unplaced; dropped with their payload — see payload.md §1/§3). A real parent edge SUPERSEDES the token edge on attach ("attach adds a placement path to an already-in-tree content root", F-13) | user decision, §10.10.1, §10.10.4; placement-path-spec §10.ad/F-13 |
| `ContentPayload.content[]` | contentNodes-owned content roots (same as above) | user decision, §10.10.1; placement-path-spec §10.ad/F-13 |
| `NodeData.placement.placementName` | `container` anchor (`{role:'container', target: name}`) on the shared per-name placement Link (P3 §1.1 — the producer role, renamed from `'placement'`). A name containing `#` warns `placement-name-invalid` and the anchor is SKIPPED (P3 §1.3) | §10.8.3; placement-path-spec §1.1/§1.3 |
| `NodeData.placement.targetPlacement` (string[]) | ONE `content` anchor per requested name, in preference order, on the shared per-name placement Link (P3 §1.1/§1.2 — the consumer role; first-match-with-known-container wins at compile). Names containing `#` warn `placement-name-invalid` and are skipped; duplicate names warn `placement-duplicate-reference` (keep-first — K8-class guard); a bare STRING (old mis-typed shape) is coerced to `[string]` with `placement-string-coerced` (back-compat). The old `component-target-placement` ignore-warn (NP13/AP5) is REMOVED — the feed is implemented | placement-path-spec §1.2/§6.2 |
| `NodeData.placement.activePlacement` | **never minted** — derived read (P3 §2.5: the first `targetPlacement` name with any containers); `nodeToLegacy` emits it on reverse | placement-path-spec §2.5 |
| `NodeData.component.reference` | `target` anchor on a shared per-name component Link (consumer) | §10.8.2 |
| `NodeData.component.reference` + `value` (no `target`) | **`source` anchor** on the shared per-name component Link — the node PROVIDES `value` for `reference` (legacy source attachment) | §10.8.2 |
| `NodeData.component.reference` + `value` + `target` | provider + LOCAL APPLY shape: `source` anchor for `reference` (provides `value`) + the resolved value is applied to the host's `<target>` path (§2.1 — legacy "provide and self-apply"; at a self-provider the applied value IS its own `value`). NOT a two-name duplex: `target` is an injection path, never a component name (§2.1, `docs/specs/legacy-component-ref-only-review.md`). The runtime duplex anchor shape (source + target for a second NAME) is rebuild-internal and legacy-unexpressible — the reverse NEVER emits it: any applyPath-less non-provider (consumer) anchor coexisting with a provider anchor on the same node is DROPPED on reverse (K5, landed; the old `{reference, value, target: <name>}` emission is gone). The drop is shape-based — a legacy-data plain consumer `{reference}` next to a provider has the SAME graph shape as the runtime duplex and is dropped too (payload.md R-2 broadened, stress scenario 10) | §10.8.2 corrected by §2.1 |
| `NodeData.handlers` | carried on the node's base data → compiled `handlers`. A `body` shipped as a STRING (function source) is INSTANTIATED into a live function at translate (`new Function` — legacy loadable handlers; **security: `new Function` executes arbitrary code — the backend/DB layer that stores loadable handlers must gate writes to admin/trusted-developer only; the renderer performs no authorization of its own**). `reverseTranslate` ships live bodies back as their source string (native/bound code omitted) | §10.10.2 |
| `ContentPayload.metadata/userData` | surfaced on `TranslatedTree` (first payload wins) | §10.10.1 |
| `clientConfig.runInstantiation` | `adapter: 'ssr'` when `true`, else `'dom'` | §10.10.1 |
| `clientConfig.runMonitoring` | `persistence: true` when `true` | §10.10.1 |
| missing `clientConfig` | `{ adapter: 'dom', persistence: false }` | §10.10.1 |

Unknown extra fields (`versions`, …) are ignored, never rejected. The
placement fields are NOT extra: `targetPlacement` mints ordered `content`
anchors and `activePlacement` is the derived read (both above; the old
"targetPlacement ignored" line was reversed when the feed landed — P3 §6.2).

Content nodes are contentNodes-owned ⇒ family-'in-tree' (node.ts:213) but
**dropped from compile** (the `contentNodes` token terminates the compile
walk — P3 §2.4: in-tree is a family fact, never compiled viability) until a
real parent edge supersedes the token on attach ("attach adds a placement
path to an already-in-tree content root", F-13).

## 2.1 Complete legacy spec of valid component targets

The legacy `component.target` is the **local injection path** — the exact
schema property of the HOST node where the resolved component payload is
injected. It is NOT a component name. Authoritative legacy reference:
`docs/skills/components.md` §"Valid Local Targets for Components" in the
original Preempt project (`/media/ryan/Shared Files1/Projects/Preempt/docs/
skills/components.md`). This table IS the translator's contract for valid
targets.

| Target path | Category | Legacy payload / value type | Injection behavior | Translator status |
| :--- | :--- | :--- | :--- | :--- |
| `type` | Structural | single `NodeData` prototype sub-tree (never an array) | deep-merge prototype: replaces host `type`; injects layers for `props.*`, `css.id`, `css.classes`, `css.style.*`, `css.styleNodes`, `content`, `children`, `handlers`, `placement`, `component` | NOT implemented (gap). Value-shape-driven half realized: a def-shaped resolved value re-types the consumer via the def→re-type emission seam (`render-helpers.ts` `isLinkDef`); **path-level injection not implemented** |
| `content` | Slot | scalar string, or `NodeData`/`NodeData[]` (`_instantiatedNodes` ⇒ children) | injects scalar into `content` layer; instantiated nodes into `children` layer | NOT implemented (gap). Value-shape-driven half realized: a scalar resolved value binds to element text via the scalar→text seam (`render-helpers.ts` `scalarBinding`); **path-level injection not implemented** |
| `children` | Children slot | `NodeData`/`NodeData[]` child sub-trees | injects virtual child sub-trees into `children` layer; loop-guarded (`Component.isAppliedInAncestors()`) | NOT implemented (gap) |
| `props` | Properties | object dict (`Record<string, any>`) | injects/overwrites the host's whole `props` dict | NOT implemented (gap) |
| `props.<propertyName>` | Property key | any primitive or object value | deep-injects onto one host `props` key (`props.disabled`, `props.placeholder`, …) | **IMPLEMENTED (flat `props.<key>` only — kernel K1/K2, landed)**: the anchor carries `options.applyPath` (K5 persistence) and the node gains the synthesized `derived.props.<key> = { $: 'bindings.<ref>' }` read (apply of the RESOLVED value; at a self-provider that is its own `value`). Carve-outs warn `component-target-skipped` with no synthesis: dotted keys, dotted references, `props.id` (reserved derived key), authored-derived keys (no warn — authored wins), and the D7 syntax edges (`props.`, `props:name`, `props.name.`, bare `props`) |
| `css` | Style object | dict `{ id, classes, style, cssDef }` | injects into host `css` object | NOT implemented (gap) |
| `css.id` | Element id | string | injects `node.css.id` | NOT implemented (gap) |
| `css.classes` | Class list | string or `string[]` | injects `node.css.classes` | NOT implemented (gap) |
| `css.style` | Style dict | `Record<string,string>` | injects style key-value pairs | NOT implemented (gap) |
| `css.style.<property>` | Style property | string/numeric CSS value | injects one inline style property | NOT implemented (gap) |
| `handlers` | Handlers list | `HandlerDef`/`Handler` or array | injects into `node.handlers` | NOT implemented (gap) |
| `handlers.<eventName>` | Event binding | `HandlerDef` or JS string body | binds one event/lifecycle hook (`handlers.click`, `handlers.submit`, …). Legacy lifecycle hook NAMES (`handlers.beforeAssembly`, `handlers.beforePreprocess`, `handlers.afterAssembly`, …) are DELIBERATELY NOT SUPPORTED in the new version — no mapping; as a TARGET PATH they are recognition-only (`component-target-gap`, K8 vocabulary pass); separately, a handler DEF whose `phase` is a legacy lifecycle name warns `handler-phase-unknown` (K8, closed 3-set) and the definition is skipped | NOT implemented (gap; lifecycle names deliberately excluded) |
| `component` | Nested binding | `ComponentBinding` or array | injects nested component bindings onto the host's `component` array | NOT implemented (gap) |

**Core binding semantics (legacy, §6.3 of RENDER_PROCESS_NOTES.md):**

- `value` set ⇒ the node **IS its own source provider** for `reference`; else
  it **searches `sourceComponents` up the tree** for a provider — the binding
  is a consumer declaration.
- The resolved value is **deep-injected into the `target` path** of the host
  node at assembly (legacy Phase 3 `ComponentAssemblyWorker` for `type`;
  Phase 4 `SlotAssemblyWorker` for non-type targets). **Phase-numbering
  reconciliation:** the "Phase 3/Phase 4" here follows the legacy
  `docs/skills/components.md` numbering (routing not counted); the same
  workers are Phase 4 (`componentAssembly`) and Phase 5 (`slotAssembly`) in
  `RENDER_PROCESS_NOTES.md` §6.3's PhaseRegistry numbering (canon, with
  `componentRouting` = 3). Worker NAMES are the stable reference — this spec
  and the review doc ("Phase 5") each follow one numbering; legacy lifecycle
  HOOK names (e.g. `beforeAssembly`) are deliberately NOT mapped to the new
  3-phase set — `handler-phase-unknown` warn at translate (K8, DECIDED).
- **Empty placeholders are a legitimate pattern**: legacy templates
  deliberately declare `{ "reference": "MyComponent" }` (no `value`, no
  `target`) as placeholders whose value arrives via SSR payload injection —
  lookup logic MUST check `value !== undefined` rather than a bare
  reference match (legacy `docs/skills/components.md` §"Applying
  Components"). The translator's consumer form (`reference` alone → target
  anchor) is therefore NOT an error; the "warn + ignore" rule (kernel K3)
  applies ONLY to structurally vacuous bindings (`{}`, non-string or empty
  `reference`).
- **Placeholder family-walk caveat (post-K1–K8):** the K1 synthesized read
  `{ $: 'bindings.<ref>' }` resolves through the per-arm family walk — a
  placeholder's provider must sit in the CONSUMER's family (self / in-slice
  source/duplex). An UNPLACED payload provider (`TranslatedTree.content`,
  no parent anchor) is not in the walk, so the placeholder stays unresolved
  (S-R4.3) — the legacy SSR-payload-injection path has no new-system analog
  at translate time. `ContentPayload.component` (spec §1 type) is declared
  but NEVER read; payload-level bindings are dropped at translate (review
  doc Appendix D, N4).
- **Null-injection caveat (post-K1–K8):** legacy deep-injects `null` WITH the
  key present (`props.foo = null` is an authoring intent); the new seam's
  omit-on-null (`derived.ts:242-243`) DROPS null keys. Semantic loss to
  carry; accepted known gap with a follow-up DECIDED (review doc Appendix
  E.1/E.3 — N3).
- **Anti-patterns the legacy format rejects** (translator must never
  synthesize them): duplicate `target` paths on one node (legacy errors
  `[Node] Duplicate target component…`) — now EXPRESSIBLE and BLOCKED
  (post-K8: warn + skip, code `component-duplicate-target`); duplicate
  `reference` within one node's binding array (post-K8: warn + skip, code
  `component-duplicate-reference`); array payloads targeting `type` —
  recognition-only (nothing rejects arrays; `isLinkDef` renders nothing for
  array values — folds into the `component-target-gap` warn); self-referential
  component loops (`Component.isAppliedInAncestors()` → engine
  circular-source); unresolved bindings reset the target path back to the
  original `node.data` (never crash). **Emission first-wins (post-K7):** with
  2+ DEF-shaped bindings on one node, the FIRST def wins and the rest are
  silently dropped (`isLinkDef` first-def, render-helpers.ts:221) → new
  emission-time warn (`component-multiple-definitions`, >1 def); scalar text
  is first-wins by design (`scalarBinding`, render-helpers.ts:270-277) —
  documented, no warn.
- **Warn coverage (D2 — the full guard set, landed with K1–K8 + P3):** all
  translate-time guards ride the K4 additive channel and are warn+skip, never
  a throw (TR-F2). The translate-time code set is:
  `component-binding-empty` (K3, vacuous bindings),
  `component-target-skipped` (K2, synthesis carve-outs + D7 target-syntax
  edges), `component-target-gap` (K8 pre-anchor vocabulary pass — unknown
  target paths, NP1/N2 code, DECIDED), `component-duplicate-reference` +
  `component-duplicate-target` (K8, pre-anchor), `placement-name-invalid`
  (P3 §1.3 — a `#` in a placementName/targetPlacement name, or a
  non-string/empty targetPlacement entry: warn + skip that binding),
  `placement-string-coerced` (P3 back-compat — the old single-STRING
  targetPlacement shape is coerced to `[string]`), `placement-target-invalid`
  (targetPlacement is neither string nor string[]), `placement-duplicate-reference`
  (K8-class keep-first guard across the targetPlacement list),
  `handler-phase-unknown` (AP13, closed 3-set at
  translate.ts:177 — raw legacy names never dispatch, guard lives at
  translate), `handler-body-invalid` (NP11 — the pre-kernel non-function-body
  THROW is downgraded to warn+skip per TR-F2; a body STRING that fails to
  compile or evaluate to a function also warns + skips).
  Emission-time: `component-multiple-definitions` (post-K7, >1 def-shaped
  binding, first-def wins). Full guard table: review doc Appendix E.2.
  The interim `component-target-placement` warn (AP5/NP13 —
  targetPlacement-on-component block+warn) is REMOVED: the placement feed is
  implemented, so `targetPlacement` mints its anchors on any node (P3 §6.2).
- **Placement inside component sub-trees** is supported (`placementName`
  drop-zones + `targetPlacement` request lists on any node — P3 §1.1).

**Array form (REQUIRED feature parity — K7, landed):** the legacy node schema
allows MULTIPLE bindings per node (`component: [{…}, {…}]`, see legacy
components.md examples with `target: "css.style"` AND `target: "handlers.click"`
on one node). The array form is a REQUIRED feature-parity item (format
clarification, authoritative: "multiple components are allowed on the same
prop in legacy, but not with the same reference or target"). The engine
already supports N component anchors per node (only the `child` role is
restricted, `node.ts:416-419`) and compile cross-products multiple target
names (`node.ts:651-666`, `resolve.ts:186-199`); the landed kernel accepts
`component: LegacyComponentBinding[]` (and the same array on
`template.component`) — each element is a binding in its own right
(graph-level N bindings per node + `props.<key>` apply paths only, per the
parity scope below). **K3 carve-out (D3/N7):** the vacuous-binding trigger
checks `Array.isArray(component)` FIRST — `component: []` is a VALID
multi-binding form, NOT an empty binding; firing `component-binding-empty`
on it would misdiagnose.

**Multi-binding legality matrix (post-K7, pinned — one node's binding
array):**

| Binding set | Verdict | Mechanism |
| --- | --- | --- |
| distinct `reference` + distinct `target` | **LEGAL** | anchor + K2 synthesis per binding |
| same `reference` (any target) | **ILLEGAL → block + warn** (`component-duplicate-reference`) | duplicate reference is deliberately-unsupported bad practice |
| distinct references + same EXACT target path | **ILLEGAL → block + warn** (`component-duplicate-target`) | duplicate target is deliberately-unsupported bad practice (AP2 flipped) |
| distinct references + same family, different paths (`props.x` + `props.y`) | **LEGAL** | K2 synthesis handles each path |
| `css.*` family, different paths | legal legacy but **no seam** | excluded from the parity claim |

Duplicate detection **must run PRE-ANCHOR** (before any anchor is created for
the array): compile is blind — a duplicate target silently last-wins
(`resolve.ts:239`) and two providers on one name produce phantom-forks
(stress probes C2/C4). All guards are translate-time warn+skip, never a throw
(TR-F2), on the K4 warnings channel (K8 — review doc Appendix E.2).
**Guard order (pinned, stress scenario 2):** warnings fire in STRICT
binding-array order — each binding is checked reference-then-target (a
binding duplicating both reports only its reference code, `continue`), but
an EARLIER binding's `component-duplicate-target` warn precedes a LATER
binding's `component-duplicate-reference` warn (per-binding sequence is
subordinate to element order).

**Parity scope (post-clarification):** full 13-path parity is NOT claimed.
`type` / `content` / `handlers.<event>` are PARTIAL — their value-shape-driven
halves exist (def→re-type via `isLinkDef`, scalar→text via `scalarBinding`),
path-level injection does not; `handlers.<event>` has NO engine seam at all —
the component-handler e2e wires the resolved handler MANUALLY
(`tests/e2e/component-handler.test.ts:101`, `panel.addLayer`; no engine code
moves a binding value into `node.handlers`) — full parity there is not
claimable. `css.*` family paths are excluded from the parity claim (legal
legacy, no seam). Array-form parity is scoped to graph-level N bindings +
`props.<key>` apply paths only.

**Accepted emission-layer gaps (parity, known):** object values bake
`[object Object]` via `String()` coercion in both adapters (NP5/NP9 — no
object emission seam) and null injection is lost on the derived seam (N3 —
`applyDerived` omits null keys, `derived.ts:242-243`; `publishOwn` publishes
null at `:644` but the bake drops it). Both are accepted known gaps with
TODO entries (review doc Appendix E.3); neither blocks the K7/K8
parity claim (props scalar + duplicates).

**Target-syntax normalization (post-kernel, D7):** the K1/K2 kernel accepts
the FLAT `props.<key>` form only (one segment — derived writes flat keys,
`validatePath` `derived.ts:37-54`). Edge forms are DELIBERATE-EXCLUSION →
block+warn (Appendix E.1; warn + skip via the K2 channel, code
`component-target-skipped`, never throw): `props.` (empty key), `props:name`
(colon separator), `props.name.` (trailing dot), bare `props` (whole-dict
overwrite — a parked target root, §2.1 table). Dotted `props.a.b` keys and
dotted `reference` names are K2 carve-outs (skip + `component-target-skipped`).

**Pre-kernel divergences (all corrected by the K1–K8 kernel, landed —
`docs/specs/legacy-component-ref-only-review.md`):** the translator read
`component.target` as a SECOND COMPONENT NAME (the two-name duplex shape —
historical, review doc Appendix B) and
never validated the target vocabulary; `template.component` on the root
emitted a target anchor even when `value` was set (value dead); reverse
emission dropped the apply path. Two further divergence notes: **(N1) reverse
emitted `node.derived` UNCONDITIONALLY** — once K1 synthesizes derived,
reversed documents would ship `bindings.*` machinery the backend cannot
interpret; K5 strips synthesized derived on reverse (landed). **(N2)
non-`props.*` targets** (`content`/`children`/`handlers`/`css.*`/`type`)
silently no-oped — post-kernel they warn via the gap-target code
(`component-target-gap`, DECIDED — K8 pre-anchor vocabulary pass,
Appendix E.1). Under the landed semantics:
`{reference, target}` = consumer + local apply to `<target>`;
`{reference, value, target}`
= provider + self-apply of the resolved value (self-provider ⇒ its own
value, `publishOwn` runs before the derived bake); `template.component`
value-carrying root bindings become SOURCE providers (K6).

> **Reverse emission (post-K5, landed — `nodeToLegacy`, translate.ts):** the
> legacy `target` field is emitted ONLY when the anchor carries an
> `options.applyPath` — consumer `{reference, target}`, provider
> `{reference, value, target}`; anchors without an apply path keep the
> pre-kernel emission (`{reference}` / `{reference, value}`), so a
> `{reference, target: 'props.x'}` document round-trips exactly. Two runtime
> shapes are legacy-unexpressible and are DROPPED on reverse: any
> applyPath-less non-provider (consumer) anchor coexisting with a provider
> anchor on the same node — the reverse never emits a two-name duplex (the
> old `binding.target = consumed name` emission is gone; the drop is
> SHAPE-BASED, so a legacy-data plain consumer `{reference}` next to a
> provider is dropped too — payload.md R-2 broadened, stress scenario 10) —
> and a second anchor for an already-emitted reference (legacy rejects
> duplicate references; the first is kept, K8 blocks the rest pre-anchor on
> re-translate). **Placement reverse rows (P3 §6.2, landed):** `'container'`
> anchors emit `placementName`; `'content'` anchors emit back as
> `targetPlacement: string[]` in MINT order (serialize preserves the order);
> the derived `activePlacement: string` read (P3 §2.5) is emitted; the minted
> `contentNodes` permanent-owner anchor is STRIPPED on reverse (F-13) — the
> reverse never ships the token edge. N1 landed with K5: the translate-synthesized derived keys
> (key = applyPath `props.<key>` suffix, value = the `{$: 'bindings.<ref>'}`
> shape) are STRIPPED from the emitted `derived`; authored derived stays.
> **Authored-collision chain (pinned, stress scenario 9):** when an authored
> `derived.props.<k>` shadows a binding's target key, K2's authored-wins
> skip (no warn) means the binding never synthesizes ⇒ carries no applyPath
> ⇒ reverse emits no `target` ⇒ the local apply is permanently absent —
> idempotent from the first pass (re-translate IS anchor-identical), and the
> chain is a documented data-loss consequence of the K2 carve-out, not a
> round-trip bug.

## 3. Envelope & payload guards

| State | Expected |
| --- | --- |
| `doc` null / non-object / missing `template.root` | throws `legacy-envelope-mismatch` |
| payload without `content: NodeData[]` | throws `legacy-payload-mismatch` |

## 4. Post-translation invariants (TestWriter targets)

| # | Invariant |
| --- | --- |
| TR-1 | Translated tree is a normal graph: `compile(slice)` + `serializeSlice` round-trip through the new format (caller runs `reconcileParentTargets` after `loadState` — the boundary does not own family-link reconciliation) |
| TR-2 | Same-name component/placement anchors share links when a `hub` is supplied (or an internal default hub) |
| TR-3 | Single-parent invariant holds: a legacy child appears exactly once |
| TR-4 | Node ids are minted (unique, deterministic order root-first) |
| TR-5 | `translated.clientConfig` is always the 2-field shape accepted by `loadState`; `serializeSlice` accepts it and preserves it |
| TR-6 | Content roots are contentNodes-owned (family-'in-tree' via the permanent-owner token, P3 §10.ad/F-13) until a real parent edge supersedes the token on attach |

## 5. Exhaustiveness gate

| ID | State | Expected |
| --- | --- | --- |
| TR-H1 | template root + its own nested children | root in-tree; default children attached, array-order priorities |
| TR-H2 | component binding (reference + value) on node/template | value-bearing binding → `source` anchor (provider); + a `target` path → source + LOCAL APPLY of the resolved value to the host path (§2.1 — legacy "provide and self-apply"; the applied value at a self-provider is its own `value`); plain reference → `target` anchor (consumer — legacy empty-placeholder pattern, §2.1). Cloned providers keep their value. `component` accepts a single binding OR the K7 array form (N bindings per node — distinct reference + distinct target paths; duplicates blocked, §2.1 legality matrix) |
| TR-H3 | placement config | `placementName` → `container` anchor on the per-name placement Link (P3 §1.1); `targetPlacement: string[]` → one ORDERED `content` anchor per name (preference order — serialization preserves it); `activePlacement` never minted (derived, P3 §2.5); `#`-names warn `placement-name-invalid` + skip; duplicates warn `placement-duplicate-reference` keep-first; string coercion warns `placement-string-coerced` |
| TR-H4 | handlers on legacy nodes | carried to compiled `handlers`; STRING bodies instantiated into functions at translate; reverse emits live bodies as source strings (round-trips) |
| TR-H5 | template.children + content payloads | contentNodes-owned content roots in `TranslatedTree.content` (family-'in-tree', token edge — P3 §10.ad/F-13); metadata/userData surfaced |
| TR-H6 | run* gates | adapter/persistence mapping; defaults when absent; preserved by serializeSlice |
| TR-H7 | shared hub | same-name anchors on shared links |
| TR-H8 | compile+serialize of translated tree | new-format round-trip after `reconcileParentTargets` |
| TR-H9 | contentNodes-owned content roots | family-'in-tree' (node.ts:213) but the token terminates the compile walk — dropped from compile (P3 §2.4: in-tree is a family fact, not compiled viability); a real parent edge supersedes the token on attach |
| TR-H10 | K4 warnings channel + guards | `translated.warnings` is always present (empty for a clean doc); each entry `{ code, path }` fires a focused `console.warn`; every guard code (§2.1 list) warns + skips its binding/handler def, never throws (TR-F2); vacuous bindings (`{}`, non-string/empty reference) → `component-binding-empty`, zero anchors, while `component: []` stays a legal empty multi-binding list (no warning) |
| TR-F1 | malformed envelope / payload | throws (guards §3) |
| TR-F2 | legacy-only fields (`versions`, …) and malformed binding/handler content | ignored, never a throw — well-formed-but-invalid content surfaces on the K4 warnings channel (`placement-name-invalid`, `placement-string-coerced`, `placement-duplicate-reference`, `handler-phase-unknown`, `handler-body-invalid`, duplicate/vacuous/gap guards); only malformed envelopes/payloads throw (§3). The old `component-target-placement` code is REMOVED (the targetPlacement feed is implemented) |
