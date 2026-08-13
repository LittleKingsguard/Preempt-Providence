# Spec — Legacy Schema Translation: `translateLegacy`

Derivative of `RENDER_PROCESS_NOTES.md` §3.1 (raw NodeSchema types), §10.8
(anchor graph), §10.10.1 (DECIDED). The rebuild's serialized node shape is
anchors-first (`id` + `anchors[]`, children derived); original `/Preempt`
backend JSON is translated AT THE BOUNDARY so trees build out completely from
original-format data. This file is the behavior contract for the TestWriter.

> **TRANSITION STATE (read this first — do not write failing tests):** this
> spec documents TWO states. **Current behavior** (what `translate.ts` and the
> tests do TODAY — the §2 mapping and TR-* rows): `component.target` is read as
> a SECOND COMPONENT NAME (duplex: `{reference, value, target}` = source for
> `reference` + target anchor for `target`), the target vocabulary is never
> validated, the root's `template.component` value is stored on a target anchor
> and never published, and reverse emits `target` only for the duplex shape.
> **Post-K1–K6 contract** (`docs/specs/legacy-component-ref-only-review.md`
> §2.2): `target` is the LOCAL apply path (flat `props.<key>` scalar kernel,
> K1/K2), vacuous bindings warn (K3/K4), the apply path persists on reverse
> (K5), the root binding mirrors the node mapping (K6). Sentences tagged
> "(post-K1–K6)" / "(post-K5)" are contract-pending — today's code and tests do
> NOT have them; do not write tests against a tagged state until the kernel
> lands (TDD order: review doc §7). Sections 3–5 (guards, invariants, gates)
> describe current behavior unless a row says otherwise.

---

## 1. Public surface

```ts
type LegacyHandlerPhase = 'before-compile' | 'after-compile' | 'after-render'

interface LegacyHandlerDef {
  name: string
  event?: string
  phase?: LegacyHandlerPhase
  body?: (ctx: unknown, ...args: unknown[]) => unknown
}

interface LegacyPlacementConfig {
  placementName?: string
  targetPlacement?: string
  activePlacement?: boolean
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
  component?: LegacyComponentBinding
  content?: unknown
  children?: LegacyNodeData[]
  props?: Record<string, unknown>
  handlers?: LegacyHandlerDef[]
  css?: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }
  versions?: unknown
}

interface LegacyTemplateData { root: LegacyNodeData; children?: LegacyNodeData[]; component?: LegacyComponentBinding }
interface LegacyContentPayload { metadata?: unknown; userData?: unknown; component?: LegacyComponentBinding; content: LegacyNodeData[] }
interface LegacyClientConfig { runInstantiation?: boolean; runAssembly?: boolean; runPreprocessing?: boolean; runValidation?: boolean; runRendering?: boolean; runPostprocessing?: boolean; runMonitoring?: boolean }
interface LegacyInitialData { template: LegacyTemplateData; content?: LegacyContentPayload[]; clientConfig?: LegacyClientConfig }

interface TranslatedTree {
  root: Node            // in-tree ('rootNode' owner)
  nodes: Node[]         // every translated node, root first, tree order
  content: Node[]       // UNPLACED content nodes (template.children + payload items)
  metadata?: unknown    // first payload's metadata
  userData?: unknown    // first payload's userData
  clientConfig: { adapter: string; persistence: boolean }
}

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
> (`{ reference, value }` / `{ reference, value, target }` once the apply-path
> persistence of kernel K5 lands — today the apply path is not persisted),
> and `Node.clone` carries provider values onto the clone, so a cloned
> data-declared provider resolves depth-0 at itself (S-R2.6).

## 2. Mapping rules

| Legacy input | Translation | Basis |
| --- | --- | --- |
| `template.root` | root `Node` (`type/content/props/css/handlers`), attached to the permanent owner `'rootNode'` → in-tree | S1.1 |
| `template.root.children` (NodeData.children) | the root's OWN default children — attached under root via parent-child anchors, `priority` = array index (children stored in the root itself) | user decision, §10.10.1 |
| nested `NodeData.children` | recursively translated + attached under their parent (same priority rule) | §10.8 |
| `template.children` | UNPLACED content nodes — translated, NO parent anchor, returned in `TranslatedTree.content`; **registered as payload-owned content** (persist in the background; dropped with their payload — see payload.md §1/§3) | user decision, §10.10.1, §10.10.4 |
| `ContentPayload.content[]` | UNPLACED content nodes (same as above) | user decision, §10.10.1 |
| `NodeData.placement.placementName` | `placement` anchor (`{role:'placement', target: name}`) on a shared per-name placement Link | §10.8.3 |
| `NodeData.component.reference` | `target` anchor on a shared per-name component Link (consumer) | §10.8.2 |
| `NodeData.component.reference` + `value` (no `target`) | **`source` anchor** on the shared per-name component Link — the node PROVIDES `value` for `reference` (legacy source attachment) | §10.8.2 |
| `NodeData.component.reference` + `value` + `target` | provider + LOCAL APPLY shape: `source` anchor for `reference` (provides `value`) + the resolved value is applied to the host's `<target>` path (§2.1 — legacy "provide and self-apply"; at a self-provider the applied value IS its own `value`). NOT a two-name duplex: `target` is an injection path, never a component name (§2.1, `docs/specs/legacy-component-ref-only-review.md`). The runtime duplex anchor role (source + target for a second NAME) is rebuild-internal and unexpressible from legacy data **post-K5 — NOT today**: the current translator reads `target` as that second name and reverse round-trips it (`translate.ts:210-218` / `:357-361`, `translate.test.ts:104-130`; the §10.10.5 DECIDED still codifies the duplex reading). The one-meaning-per-field split lands with the K1–K6 kernel | §10.8.2 corrected by §2.1 |
| `NodeData.handlers` | carried on the node's base data → compiled `handlers`. A `body` shipped as a STRING (function source) is INSTANTIATED into a live function at translate (`new Function` — legacy loadable handlers; **security: `new Function` executes arbitrary code — the backend/DB layer that stores loadable handlers must gate writes to admin/trusted-developer only; the renderer performs no authorization of its own**). `reverseTranslate` ships live bodies back as their source string (native/bound code omitted) | §10.10.2 |
| `ContentPayload.metadata/userData` | surfaced on `TranslatedTree` (first payload wins) | §10.10.1 |
| `clientConfig.runInstantiation` | `adapter: 'ssr'` when `true`, else `'dom'` | §10.10.1 |
| `clientConfig.runMonitoring` | `persistence: true` when `true` | §10.10.1 |
| missing `clientConfig` | `{ adapter: 'dom', persistence: false }` | §10.10.1 |

Unknown extra fields (`versions`, `targetPlacement`, `activePlacement`, …)
are ignored, never rejected.

Content nodes are unplaced ⇒ dropped from compile (S1.1) until attached into
a placement zone; a content node that self-provides (source/duplex) resolves
depth-0 (S-R2.6).

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
| `props.<propertyName>` | Property key | any primitive or object value | deep-injects onto one host `props` key (`props.disabled`, `props.placeholder`, …) | NOT implemented as injection; nearest seam = synthesized derived `{ $: 'bindings.<ref>' }` (kernel K2) |
| `css` | Style object | dict `{ id, classes, style, cssDef }` | injects into host `css` object | NOT implemented (gap) |
| `css.id` | Element id | string | injects `node.css.id` | NOT implemented (gap) |
| `css.classes` | Class list | string or `string[]` | injects `node.css.classes` | NOT implemented (gap) |
| `css.style` | Style dict | `Record<string,string>` | injects style key-value pairs | NOT implemented (gap) |
| `css.style.<property>` | Style property | string/numeric CSS value | injects one inline style property | NOT implemented (gap) |
| `handlers` | Handlers list | `HandlerDef`/`Handler` or array | injects into `node.handlers` | NOT implemented (gap) |
| `handlers.<eventName>` | Event binding | `HandlerDef` or JS string body | binds one event/lifecycle hook (`handlers.click`, `handlers.submit`, `handlers.beforeAssembly`, …) | NOT implemented (gap) |
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
  and the review doc ("Phase 5") each follow one numbering; a full
  lifecycle-phase mapping is a follow-up DECIDED (review doc Appendix D.5-4).
- **Empty placeholders are a legitimate pattern**: legacy templates
  deliberately declare `{ "reference": "MyComponent" }` (no `value`, no
  `target`) as placeholders whose value arrives via SSR payload injection —
  lookup logic MUST check `value !== undefined` rather than a bare
  reference match (legacy `docs/skills/components.md` §"Applying
  Components"). The translator's consumer form (`reference` alone → target
  anchor) is therefore NOT an error; the "warn + ignore" rule (kernel K3)
  applies ONLY to structurally vacuous bindings (`{}`, non-string or empty
  `reference`).
- **Placeholder family-walk caveat (post-K1–K6):** the K1 synthesized read
  `{ $: 'bindings.<ref>' }` resolves through the per-arm family walk — a
  placeholder's provider must sit in the CONSUMER's family (self / in-slice
  source/duplex). An UNPLACED payload provider (`TranslatedTree.content`,
  no parent anchor) is not in the walk, so the placeholder stays unresolved
  (S-R4.3) — the legacy SSR-payload-injection path has no new-system analog
  at translate time. `ContentPayload.component` (spec §1 type) is declared
  but NEVER read; payload-level bindings are dropped at translate (review
  doc Appendix D, N4).
- **Null-injection caveat (post-K1–K6):** legacy deep-injects `null` WITH the
  key present (`props.foo = null` is an authoring intent); the new seam's
  omit-on-null (`derived.ts:242-243`) DROPS null keys. Semantic loss to
  carry; resolution is a follow-up DECIDED (review doc Appendix D.5-6).
- **Anti-patterns the legacy format rejects** (translator must never
  synthesize them; recognition is documentation-only unless a warn code is
  listed below): duplicate `target`
  paths on one node (legacy errors `[Node] Duplicate target component…`);
  array payloads targeting `type`; self-referential component loops
  (`Component.isAppliedInAncestors()`); unresolved bindings reset the target
  path back to the original `node.data` (never crash).
- **Warn coverage today vs post-kernel (D2):** TODAY none of the above warns —
  the translator has no warnings channel. Post-K1–K6 exactly TWO codes exist:
  `component-binding-empty` (K3, vacuous bindings) and `component-target-skipped`
  (K2, synthesis carve-outs). Duplicate-target, array-on-type, and
  `targetPlacement` anti-patterns get NO warn path in the kernel — each needs
  its own DECIDED; the standing candidate is a gap-target code
  (`component-target-gap`, review doc Appendix D.5-2).
- **Placement inside component sub-trees** is supported (`placementName`
  drop-zones); `targetPlacement` on a component node and placement-bearing
  children of `type` components are anti-patterns.

**Array form (known gap):** the legacy node schema allows MULTIPLE bindings
per node (`component: [{…}, {…}]`, see legacy components.md examples with
`target: "css.style"` AND `target: "handlers.click"` on one node). The
translator accepts a SINGLE `LegacyComponentBinding` today; the array form is
part of the complete legacy vocabulary and is a declared translator gap
(separate DECIDED required). **K3 carve-out (post-kernel, D3/N7):** the
vacuous-binding trigger must check `Array.isArray(component)` FIRST —
`component: []` is a VALID multi-binding form, NOT an empty binding; firing
`component-binding-empty` on it would misdiagnose. Carve-out warn code (e.g.
`component-array-unsupported`) is DECIDED-pending.

**Target-syntax normalization (post-kernel, D7):** the K1/K2 kernel accepts
the FLAT `props.<key>` form only (one segment — derived writes flat keys,
`validatePath` `derived.ts:37-54`). Edge forms must warn + skip (code TBD in
the kernel, never throw): `props.` (empty key), `props:name` (colon
separator), `props.name.` (trailing dot), bare `props` (whole-dict overwrite
— a parked target root, §2.1 table). Dotted `props.a.b` keys and dotted
`reference` names are K2 carve-outs (skip + `component-target-skipped`).

**Current implementation divergence (must be corrected by the K1–K6 kernel,
`docs/specs/legacy-component-ref-only-review.md`):** the translator reads
`component.target` as a SECOND COMPONENT NAME (duplex shape, §2 above) and
never validates the target vocabulary; `template.component` on the root
emits a target anchor even when `value` is set (value dead); reverse
emission drops the apply path. Two further divergence notes: **(N1) reverse
emits `node.derived` UNCONDITIONALLY** (`translate.ts:330-333`) — once K1
synthesizes derived, reversed documents would ship `bindings.*` machinery the
backend cannot interpret; K5 must strip synthesized derived on reverse.
**(N2) non-`props.*` targets** (`content`/`children`/`handlers`/`css.*`/
`type`) silently no-op today — post-kernel they need a gap-target warn code
(`component-target-gap`, DECIDED-pending). Under the corrected semantics:
`{reference, target}` = consumer + local apply to `<target>`;
`{reference, value, target}`
= provider + self-apply of the resolved value (self-provider ⇒ its own
value, `publishOwn` runs before the derived bake); `template.component`
value-carrying root bindings become SOURCE providers.

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
| TR-6 | Content nodes stay unplaced until attached into a placement zone |

## 5. Exhaustiveness gate

| ID | State | Expected |
| --- | --- | --- |
| TR-H1 | template root + its own nested children | root in-tree; default children attached, array-order priorities |
| TR-H2 | component binding (reference + value) on node/template | value-bearing binding → `source` anchor (provider); + a `target` path → source + LOCAL APPLY of the resolved value to the host path (§2.1 — legacy "provide and self-apply"; the applied value at a self-provider is its own `value`); plain reference → `target` anchor (consumer — legacy empty-placeholder pattern, §2.1). Cloned providers keep their value |
| TR-H3 | placement config | `placement` anchor |
| TR-H4 | handlers on legacy nodes | carried to compiled `handlers`; STRING bodies instantiated into functions at translate; reverse emits live bodies as source strings (round-trips) |
| TR-H5 | template.children + content payloads | unplaced content nodes in `TranslatedTree.content`; metadata/userData surfaced |
| TR-H6 | run* gates | adapter/persistence mapping; defaults when absent; preserved by serializeSlice |
| TR-H7 | shared hub | same-name anchors on shared links |
| TR-H8 | compile+serialize of translated tree | new-format round-trip after `reconcileParentTargets` |
| TR-H9 | unplaced content nodes | dropped from compile (S1.1); self-providing ones resolve depth-0 |
| TR-F1 | malformed envelope / payload | throws (guards §3) |
| TR-F2 | legacy-only fields (`versions`, targetPlacement…) | ignored, no throw |
