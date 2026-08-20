# Spec — Legacy Schema Translation: `translateLegacy`

Derivative of `RENDER_PROCESS_NOTES.md` §3.1 (raw NodeSchema types), §10.8
(anchor graph), §10.10.1 (DECIDED). The rebuild's serialized node shape is
anchors-first (`id` + `anchors[]`, children derived); original `/Preempt`
backend JSON is translated AT THE BOUNDARY so trees build out completely from
original-format data. This file is the behavior contract for the TestWriter.

> **STATUS (K1–K8 landed; reverse unit shipped; P3 placement minting landed;
> live-prod legacy-shape decisions D1–D8 **LANDED** 2026-08-14 (the engine
> fix pass shipped with the translate/ops/render seam work — 766 tests
> green; a TestWriter's D1–D8 pins expect GREEN) — read this first):** the
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
> string` read. The live-prod legacy-shape pass (2026-08-14, dispositions
> D1–D8 — `live-prod/placeholderLanding/FINDINGS.md`; Step-3 review round
> applied 2026-08-14) encodes these translate-side contracts below —
> **LANDED** (the engine fix pass shipped 2026-08-14 with the
> translate/ops/render seam work; the tagged sentences describe current
> behavior):
> placement is ARRAY-canonical (D1, each entry mapped through the
> single-entry logic; reverse merges to one object per node, array only
> for multi-producer nodes); `doc.content` is array-only with ANY non-array
> shape warned `payload-shape-obsolete` (D2); `css.style` OBJECTS serialize
> to kebab-case `k: v;` CSS strings and reverse ALWAYS parses style strings
> back to objects, no provenance tracking (D3/F7); `nodeData.content` is
> TEXT-ONLY — the dual-parse is discontinued and must not be reimplemented
> (D5); the `type`/`content`/`children` target bindings plan the D7
> anchor-layer seam — `content` delivers the def's TEXT only (F13),
> `children`/`type` deliver subtree links through the seam, def children
> are PRE-MINTED at translate as out-of-tree `'component'`-token prototype
> nodes (F16), and the seam target string persists on the anchor options
> (`options.seam`) (F17); def children are never emitted by the host (D8).
> Sentences below tagged
> "(post-K1–K8)"/"(post-K5)"/"(P3)"/"(D1)"/"(D2)"/"(D3)"/"(D5)"/"(D7)"/"(D8)"
> describe THIS
> landed contract, not a future one. Everything untagged describes current
> behavior (D1–D8-tagged sentences: LANDED contract — test pins green). Behavioral pins: `tests/unit/translate.test.ts` (64) +
> `tests/unit/reverse.test.ts` (15). The PRE-KERNEL contract
> (`archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md` Appendix B/D, kept for
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
  format?: 'legacy' | 'modern'
  // FORMAT MARKER (decision 4, LANDED 2026-08-15) — the body's data-format
  // convention: 'legacy' bodies are (event, context) and are installed
  // WRAPPED by the bridge (wrapLegacyHandler — the arg order restored);
  // 'modern' bodies are raw (ctx, ...args), installed unwrapped. INLINE
  // bodies default to 'modern' (the demo surface's convention); seam-installed
  // defs default to 'legacy' (wrapped). An explicit per-def field overrides
  // the default and persists on reverse (K5-style); any other format value
  // warns `handler-format-invalid` + falls back to the provenance default
  // (never a throw). An inline legacy-wrapped handler reverses with its
  // ORIGINAL body source (sourceBody) + the explicit format, so re-translate
  // reproduces the same wrap.
  sourceBody?: string // internal — the original body source of an inline legacy-wrapped handler
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

// ARRAY form is CANONICAL (D1 — live-prod disposition 2026-08-14): the legacy
// `NodeData.placement` is `PlacementConfig[]` (old Preempt
// `types/NodeSchema.ts:84`, old `core/Node.ts:614-616` iterates it; the
// single-object form is the legacy convenience, `:617-619`). `placement` is
// declared `LegacyPlacementConfig | LegacyPlacementConfig[]`: EVERY ARRAY
// ENTRY maps through the single-entry logic below (container minting from
// placementName, ordered content anchors from targetPlacement, `#`-validation,
// string coercion) — a node may carry producer + consumer (or several
// consumers) via multiple entries; the single-object form stays accepted as a
// convenience. An array must NEVER silently no-op (the original defect: the
// array passed the truthy gate and minted nothing). Shape pins (D1,
// LANDED): `placement: []` is a VALID empty multi-entry list — zero
// anchors, no warn (mirror of the `component: []` K3 carve-out); a
// NON-OBJECT entry (`[null]`, `["x"]`, `[42]`) warns the new K4 code
// `placement-entry-invalid` + skips that entry only (the rest of the array
// still maps); a non-array, non-object `placement` value (string/number) is
// treated as an invalid entry — same `placement-entry-invalid` warn + no
// anchors. ANCESTOR VETO (F3 — IMPLEMENTED 2026-08-14, DEFECT #3-1 fixed;
// condition corrected per user 2026-08-14): the §1.3 veto fires at BOTH
// phases and is LOOP-PREVENTION ONLY. Translate: family attach is CHILD-SIDE
// (the child attaches itself to its family parent before its own placement
// minting), so the shared `ancestorConsumesZone` predicate (node.ts, imported
// by ops.ts and translate.ts) walks a live parent chain at translate — a
// producer whose family ancestor WOULD ATTEMPT TO PLACE INTO the zone (a
// `content`-role anchor for it) is NOT minted and warns
// `placement-name-vetoed` (K4). DUPLICATE PRESENTATION (an ancestor merely
// OFFERS the same zone via a `container`-role anchor) is LEGAL — placement
// resolution NEVER shadows (nearest-shadows-far is COMPONENT resolution):
// a consumer fans into ALL zones of its best-fit targetPlacement, so a
// duplicate presentation is just an additional zone of the multiplicity
// (no revisit); the veto is loop-prevention only (user corrections
// 2026-08-14).

interface LegacyComponentBinding {
  reference: string
  target?: string      // LOCAL injection path on the host node — legacy target
                       // vocabulary (§2.1), NOT a second component name
  value?: unknown      // value set ⇒ THIS node is its own source provider
}

interface LegacyNodeData {
  type?: string
  placement?: LegacyPlacementConfig | LegacyPlacementConfig[]  // D1 — ARRAY canonical, object = convenience
  component?: LegacyComponentBinding | LegacyComponentBinding[]  // K7: single OR array
  content?: string          // TEXT ONLY (D5) — matches ONLY the text field. The legacy dual-parse
                            // (content EITHER text OR children when the value is NodeData — old
                            // `core/Node.ts` dynamic parse) was a confusion hazard, DISCONTINUED,
                            // and MUST NOT be reimplemented. Children live ONLY in `children`.
  children?: LegacyNodeData[]   // D5 — ONLY child nodes. A non-ARRAY children value (single
                                // NodeData OBJECT, string, …) warns `children-shape-invalid`
                                // (new K4 code) + the field is SKIPPED (no children attached) —
                                // never dual-parsed into content, never wrapped
  props?: Record<string, unknown>
  handlers?: LegacyHandlerDef[]
  css?: { id?: string; classes?: string[]; style?: string | Record<string, string>; cssDef?: unknown }
  // `css.style` may be the legacy `Record<string,string>` OBJECT (old `core/Css.ts:18`) —
  // translate SERIALIZES it to a kebab-case `k: v;` CSS string (D3); reverseTranslate
  // ALWAYS parses style strings back to objects — NO provenance tracking (F7: a
  // pre-serialized string-authored style becomes an object on save; the legacy format is
  // object-native, accepted). The object must never reach the adapters'
  // `String(val)` (`[object Object]` was the defect).
  versions?: unknown
  derived?: DerivedDecl  // the derived RULE, never the baked values (derived-state.md §2/§8)
  hooks?: string[]       // HOOKS (hooks-map-review.md §7 — the value-provider slot, contract
                         // amendment B, IMPLEMENTED 2026-08-16): a STRING-ARRAY of SAME-NODE
                         // value-provider component names — each entry names a `component`
                         // binding with a matching `reference` on THIS node (a source/duplex
                         // anchor; the component-source-duplicate guard means at most one
                         // anchor per name). The names round-trip (baseFrom/nodeToLegacy/
                         // serialize — the derived/handlers precedent ~4 sites); the VALUE
                         // lives in the component binding (a hook write mirrors the provider
                         // anchor's value — ONE source, no duplicate). A non-ARRAY field, or a
                         // non-string member, warns `hooks-shape-invalid` + skips (the
                         // children-shape-invalid discipline — never a silent drop; the K4
                         // unknown-key gap is closed FOR THIS FIELD).
}

interface LegacyTemplateData { root: LegacyNodeData; children?: LegacyNodeData[]; component?: LegacyComponentBinding | LegacyComponentBinding[] }
interface LegacyContentPayload { metadata?: unknown; userData?: unknown; component?: LegacyComponentBinding; content: LegacyNodeData[] }
interface LegacyClientConfig { runInstantiation?: boolean; runAssembly?: boolean; runPreprocessing?: boolean; runValidation?: boolean; runRendering?: boolean; runPostprocessing?: boolean; runMonitoring?: boolean }
interface LegacyInitialData { template: LegacyTemplateData; content?: LegacyContentPayload[]; clientConfig?: LegacyClientConfig }
// `doc.content` is ARRAY-ONLY — `ContentPayload[]` (D2 — live-prod disposition
// 2026-08-14). The obsolete single-payload-object form `{ content: NodeData[],
// metadata }` (old `core/Supervisor.ts:428` accepted array OR object) is
// outdated legacy: translate must WARN (new code `payload-shape-obsolete`) on
// it instead of silently dropping the whole payload (the defect), and the
// payload is SKIPPED — never half-translated. **The never-silent rule extends
// to ANY non-array `doc.content`** (F5): a string / null / number / boolean
// `content` value ALSO warns `payload-shape-obsolete` (same code, same skip)
// — the array is the only supported shape, any other shape is a
// well-formed-but-invalid document (warn + skip, never a throw, TR-F2).

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
> routed through `resolveArms` (`resolve.ts:247` — the `publishOwn` branch
> required `targetNames.length === 0`; fixed by `seedOwnBindings`,
> node.ts:255) and its arm bindings carried only the
> CONSUMED names, so the synthesized `bindings.<own-ref>` read evaluated
> null and the self-apply was SILENTLY omitted. FIXED in the compile loop:
> `seedOwnBindings` (extracted from `publishOwn`) now seeds each arm's
> bindings with the node's own source/duplex values right after
> `cs.bindings = arm.bindings` and before the derived bake — skip-if-present
> (a same-name resolved/duplex value wins), consumed-first key order, own
> values node-static per arm. The §2.1 contract is unqualified again;
> verified by `tests/unit/node.test.ts` T1–T7 and the de-vacuoused
> translate-showcase smoke (see `archive/findings/2026-08-15/2026-08-15-test-findings.md` §"Stress-test review
> loop #2" "Fix landed").

## 2. Mapping rules

| Legacy input | Translation | Basis |
| --- | --- | --- |
| `template.root` | root `Node` (`type/content/props/css/handlers`), attached to the permanent owner `'rootNode'` → in-tree | S1.1 |
| `template.root.children` (NodeData.children) | the root's OWN default children — attached under root via parent-child anchors, `priority` = array index (children stored in the root itself) | user decision, §10.10.1 |
| nested `NodeData.children` | recursively translated + attached under their parent (same priority rule) | §10.8 |
| `template.children` | contentNodes-owned content roots — translated + attached to the **`contentNodes` permanent-owner token** (family-'in-tree', node.ts:417; P3 §10.ad/F-13), returned in `TranslatedTree.content`; **registered as payload-owned content** (persist in the background while unplaced; dropped with their payload — see payload.md §1/§3). A real parent edge SUPERSEDES the token edge on attach ("attach adds a placement path to an already-in-tree content root", F-13) | user decision, §10.10.1, §10.10.4; placement-path-spec §10.ad/F-13 |
| `ContentPayload.content[]` | contentNodes-owned content roots (same as above) | user decision, §10.10.1; placement-path-spec §10.ad/F-13 |
| `doc.content` shape (D2/F5) | **ARRAY-ONLY** (`ContentPayload[]`, each `{metadata?, userData?, content: NodeData[]}`). ANY non-array shape warns `payload-shape-obsolete` (new K4 code) and the payload is SKIPPED — never silently dropped, never half-translated: the obsolete single-payload OBJECT `{content: NodeData[], metadata}` (old `core/Supervisor.ts:428` array-or-object), AND a string/null/number/boolean `content` value (the never-silent rule extends to every non-array). `doc.content` absent/undefined stays legal (no payloads) | live-prod/placeholderLanding/FINDINGS.md D2; old `core/Supervisor.ts:428` |
| `NodeData.placement.placementName` | `container` anchor (`{role:'container', target: name}`) on the shared per-name placement Link (P3 §1.1 — the producer role, renamed from `'placement'`). A name containing `#` warns `placement-name-invalid` and the anchor is SKIPPED (P3 §1.3). **(D1)** Also mapped PER ENTRY inside a `placement: [...]` ARRAY — the array is canonical, each entry goes through this row's logic (and the `targetPlacement` row's) | §10.8.3; placement-path-spec §1.1/§1.3 |
| `NodeData.placement.targetPlacement` (string[]) | ONE `content` anchor per requested name, in preference order, on the shared per-name placement Link (P3 §1.1/§1.2 — the consumer role; first-match-with-known-container wins at compile). Names containing `#` warn `placement-name-invalid` and are skipped; duplicate names warn `placement-duplicate-reference` (keep-first — K8-class guard); a bare STRING (old mis-typed shape) is coerced to `[string]` with `placement-string-coerced` (back-compat). The old `component-target-placement` ignore-warn (NP13/AP5) is REMOVED — the feed is implemented. **(D1)** The same per-entry mapping applies inside a `placement: [...]` ARRAY (multiple consumers, or producer + consumer on ONE node, are only expressible via the array) | placement-path-spec §1.2/§6.2 |
| `NodeData.placement` as an ARRAY (D1) | **canonical legacy form** — each entry mapped through the two rows above independently (mint order = array order; per-entry `#`-validation, string coercion, duplicates); the single-OBJECT form stays accepted as a convenience (mapped once). Never a silent no-op: an array entry that mints nothing MUST warn (a `#`-name, a duplicate, or a non-string/empty targetPlacement entry each warns via its own code above). **Shape pins (D1, LANDED):** `placement: []` = valid empty multi-entry list, zero anchors, NO warn (mirror of `component: []`); a NON-OBJECT entry (`[null]`, `["x"]`, `[42]`) → new warn `placement-entry-invalid`, skip THAT entry only; a non-array non-object `placement` (string/number) → same `placement-entry-invalid`, no anchors. **Ancestor veto (F3 — IMPLEMENTED 2026-08-14, DEFECT #3-1 fixed; condition corrected per user):** the §1.3 veto fires at translate AND op-time and is LOOP-PREVENTION ONLY — it fires when a family ancestor WOULD ATTEMPT TO PLACE INTO the zone (`content`-role anchor for it); DUPLICATE PRESENTATION (an ancestor merely OFFERS the zone) is LEGAL (override). Shared `ancestorConsumesZone` predicate (node.ts) + child-side family attach. **REVERSE CONTRACT (F2, LANDED):** `nodeToLegacy` emits ONE flat placement object per node, MERGING the node's placement anchors — `placementName` = the container anchor name, `targetPlacement: string[]` = the content anchors' names in MINT order (order preserved); a node with TWO OR MORE container anchors (multi-producer — only expressible via the array) emits the canonical `placement` ARRAY, one entry per container anchor in mint order, the node's content-anchor names in the first entry (`targetPlacement` mint order). Re-translate of either emission is ANCHOR-IDENTICAL (per-name anchors; the `placement-duplicate-reference` keep-first guard dedups re-expressed name lists) | live-prod/placeholderLanding/FINDINGS.md D1; old Preempt `types/NodeSchema.ts:84`, `core/Node.ts:614-619` |
| `NodeData.placement.activePlacement` | **never minted** — derived read (P3 §2.5: the first `targetPlacement` name with any containers); `nodeToLegacy` emits it on reverse | placement-path-spec §2.5 |
| `NodeData.css.style` as an OBJECT (D3) | serialized AT TRANSLATE into a CSS string the adapters/parser can interpret: kebab-case keys (`backgroundColor` → `background-color`; VENDOR-prefixed keys too — `WebkitTransform` → `-webkit-transform`, `msTransition` → `-ms-transition`), `k: v;` form. **SERIALIZE GRAMMAR (F8, pinned):** split each entry on the FIRST `:` (values may contain `:` — e.g. `content: "a:b"`); `;` splits entries EXCEPT inside `url(...)` (data URIs — `background: url(data:image/png;base64,…)` is one entry); numeric values are stringified (`opacity: 1`); the empty object `{}` serializes to `''` (no style attr at the adapter). **REVERSE (F7, pinned):** `nodeToLegacy` ALWAYS parses the serialized string back to the `Record<string,string>` object — NO provenance tracking: a pre-serialized STRING-authored style becomes an OBJECT on save (legacy format is object-native — accepted, documented); the string form is never re-emitted. **Key-case pin (stress-test review loop #3, scenario 26):** the parse-back keys are the `camelKey`-normalized forms, never verbatim — a leading-dash vendor key capitalizes its first segment (`-webkit-transform` → `WebkitTransform`, `-ms-transition` → `MsTransition`, so an authored `msTransition` round-trips as `MsTransition`); the round-trip is KEBAB-NORMALIZED value-equivalent (values verbatim). The raw object must never flow to the adapters (`String(obj)` → `[object Object]` was the defect) | live-prod/placeholderLanding/FINDINGS.md D3; old `core/Css.ts:18` |
| `NodeData.content` (D5) | **TEXT ONLY** — matches ONLY the text field; `nodeData.children` (and component links targeting `children`) contain ONLY child nodes. The legacy dual-parse (content as EITHER text OR `node.children` when the value was NodeData — old `core/Node.ts` dynamic parse) is DISCONTINUED and MUST NOT be reimplemented. **Children shape (F14, LANDED):** a non-ARRAY `children` value (a single NodeData OBJECT, string, …) warns the new K4 code `children-shape-invalid` and the field is SKIPPED (no children attached) — never dual-parsed into content, never wrapped. **Content-target delivery (F13, pinned):** a `target: 'content'` binding delivers the def's TEXT content — the def's `content` FIELD VALUE lands in the consumer's content slot via the content-target seam (NOT `scalarBinding`, NOT the def's children); subtree delivery happens only via `target: 'children'` / `target: 'type'` (the D7 anchor-layer seam) | live-prod/placeholderLanding/FINDINGS.md D5 |
| `NodeData.component.reference` | `target` anchor on a shared per-name component Link (consumer) | §10.8.2 |
| `NodeData.component.reference` + `value` (no `target`) | **`source` anchor** on the shared per-name component Link — the node PROVIDES `value` for `reference` (legacy source attachment) | §10.8.2 |
| `NodeData.component.reference` + `value` + `target` | **DUPLEX anchor (S19 ruling 2026-08-15 — value+target is NOT a source, and the value+target duplex IS legacy-expressible):** the node both PROVIDES `reference` (the `value`) and CONSUMES it (the target — a LOCAL injection path: `props.<k>` apply path (K5, provide-and-self-apply — the applied value IS its own `value`) or a D7 seam target `type`/`content`/`children` (self-provider seam — the seam flag persists on the duplex anchor and the seam-detection sites read it). `target` is an injection path, never a SECOND component NAME (§2.1, archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md — that claim is unchanged); the two-NAME duplex (source for one name + target for another) stays rebuild-internal. Reverse: a duplex emits `{reference, value, target}` — the target = the apply path OR the seam target (K5 extension pinned, TR-H16 — a seam round-trip reproduces the SAME plan). Any applyPath-less non-provider (consumer) anchor coexisting with a provider anchor on the same node is DROPPED on reverse — shape-based: a legacy-data plain consumer `{reference}` next to a provider has the same graph shape as a runtime two-name duplex and is dropped too (payload.md R-2 broadened, stress scenario 10) | §10.8.2 corrected by §2.1 |
| `component.target: 'type' | 'content' | 'children'` + `reference` (D7) | **anchor-layer seam candidates** — translate PLANS the binding (recognition; no `component-target-gap` warn for these three targets) and **PERSISTS the seam target** (F17, LANDED — `BindingPlan` (translate.ts:356-366) carries `seam: 'type' | 'content' | 'children'`, and `applyPlans` (translate.ts:511-524) stores it on the anchor options as `options.seam` — the same persistence channel as K5) so assembly can distinguish seam candidates from plain consumers. At compile/assembly the binding RESOLVES the def (value-carrying source anchor) and materializes the def's CHILDREN links + PLACEMENT links onto the consumer node as an ANCHOR LAYER (node.ts `addLayer`/`reconcileAnchors`, same as clone-instance inherits prototype anchors); the parent anchor of each passed child link sits ON THE RESOLVED NODE (`resolvedNode.addAnchor('parent', resolvedNode, { seam: true }, link)` — target = self, the standard familyLinkFor/attach pattern, marked with the SAME seam flag as the child decls, ops.md ALS-2/ALS-4), never on the def/prototype side; the consumer's OWN family parent anchor is untouched. **DELIVERY SHAPES (user ruling 2026-08-14, LANDED — ops.md ALS-1, render.md SED-1..3):** `content` = TEXT delivery ONLY (the def's `content` field value → the consumer's content slot, unchanged); `children` = SHELL + DEF-ROOT CHILD — the consumer STAYS a distinct element (the wrapper shell div) that CONTAINS the referred node(s): the DEF-ROOT element materializes as a seam-wired child of the wrapper (`div > nav.nav-bar > [logo, links, auth]`), carrying the def's type + css (classes + cssDef rules); `type` = SHELL COLLAPSE — the consumer's element BECOMES the def's element (the type-target is the legacy form of the fork-suite values method; the consumer's element takes the def's type AND the def's css (classes + cssDef rules); the current empty-host def-fill behavior is correct for type-targets). The re-expressed placeholderLanding envelope uses `target: 'children'` on the four subtree wrappers (root.children[0]/[1]/[3] → navBar/header/footer, and the header-def p → articleSubtitle — each renders as its own shell element containing the def-root element); the h1's `target: 'content'` articleTitle tag stays content (text-delivery test feature with no def). `target: 'type'` is the legacy form of the fork-suite 'values' method (provider-side `{reference, value}` is the new-system twin) | live-prod/placeholderLanding/FINDINGS.md D7; F13/F17 rulings + delivery-shape ruling 2026-08-14 |
| def children / `template.component` def values (D8/F16) | **OUT-OF-TREE prototypes, PRE-MINTED at translate** (F16 + delivery-shape ruling, LANDED): a value-carrying def binding's `value.children` — and, per the delivery-shape ruling, the DEF-ROOT (the def's own root element: type + css incl. cssDef + the child links to the def-children prototypes) — are minted as out-of-tree prototype NODES at the def's own translate site — attached to the **`'component'` permanent-owner token** (chain kind `'token'/'component'` → derived state `'prototype'`, node.ts:73-78/416 — the prototype-terminated disposition: registered via `registerNode` (registry.ts:73, census-visible), id-minted by the normal `mintNodeId()` path, family-'in-tree'-NEVER (a prototype is never compiled/renderable on its own — FRK-F1 silent-drop disposition). The D7 seam's anchor layer materializes the child links FROM these pre-minted nodes at `reconcileAnchors`. Def root + children are NEVER attached to the HOST node by translate and NEVER emitted by the host (the emit-time def-chain is scoped to the fork-stress 1:1 link method — render.md §3.4.2; the seam `type`-target's element-level def-fill is the sanctioned exception, SED-1). Everything else materializes through the D7 anchor-layer seam when wired by component assembly. **B2 scoping (minting exclusions, pinned — stress-test review loop #3, scenario 23):** a seam-LESS LINK-METHOD def (children are bind-specs, the fork-stress shape) mints NO prototypes — only SEAM-TARGETED defs (the pre-scanned seamRefs set) and defs whose children are DELIVERABLE child nodes pre-mint (the fork-stress-data census-pollution RCA: bind-spec children were briefly minted, registered 4161 vs 4117). **Consequence:** a NESTED seam consumer inside a seam-less def's value (a def-child carrying `component: {reference, target: type|content|children}`) does NOT materialize — the emit-side nested seam branch reads the def-child PROTOTYPE's seam anchor (render-helpers.ts `emitDefChildTree`), and B2 never mints that prototype. Data authors needing nested seam delivery must make the OUTER binding a D7 seam target (`{reference, target: 'children'}` → Family A). | live-prod/placeholderLanding/FINDINGS.md D8; F16 + delivery-shape rulings 2026-08-14 |
| `NodeData.handlers` | carried on the node's base data → compiled `handlers`. A `body` shipped as a STRING (function source) is INSTANTIATED into a live function at translate (`new Function` — legacy loadable handlers; **security: `new Function` executes arbitrary code — the backend/DB layer that stores loadable handlers must gate writes to admin/trusted-developer only; the renderer performs no authorization of its own**). **FORMAT MARKER (decision 4, LANDED 2026-08-15):** an explicit `format: 'legacy'` wraps the body via the bridge (`wrapLegacyHandler` — the (event, context) arg order restored; the ORIGINAL source is kept as `sourceBody` so reverse re-emits the authored body, never the wrapper source); `format: 'modern'` installs the raw `(ctx, ...args)` body; INLINE bodies default to 'modern'; any other format value warns `handler-format-invalid` + falls back to the default (never a throw — TR-F2). `reverseTranslate` ships live bodies back as their source string (native/bound code omitted; a wrapped body re-emits `sourceBody`) + the explicit `format` when authored | §10.10.2 |
| `ContentPayload.metadata/userData` | surfaced on `TranslatedTree` (first payload wins) | §10.10.1 |
| `clientConfig.runInstantiation` | `adapter: 'ssr'` when `true`, else `'dom'` | §10.10.1 |
| `clientConfig.runMonitoring` | `persistence: true` when `true` | §10.10.1 |
| missing `clientConfig` | `{ adapter: 'dom', persistence: false }` | §10.10.1 |

Unknown extra fields (`versions`, …) are ignored, never rejected. The
placement fields are NOT extra: `targetPlacement` mints ordered `content`
anchors and `activePlacement` is the derived read (both above; the old
"targetPlacement ignored" line was reversed when the feed landed — P3 §6.2).

Content nodes are contentNodes-owned ⇒ family-'in-tree' (node.ts:417) but
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
| `type` | Structural | single `NodeData` prototype sub-tree (never an array) | deep-merge prototype: replaces host `type`; injects layers for `props.*`, `css.id`, `css.classes`, `css.style.*`, `css.styleNodes`, `content`, `children`, `handlers`, `placement`, `component` | **ANCHOR-LAYER SEAM (D7, LANDED 2026-08-14)** — translate plans the binding with `options.seam = 'type'` (F17) and no `component-target-gap` warn; at assembly the resolved def's CHILDREN links + PLACEMENT links pass to the consumer node as an ANCHOR LAYER (parent anchor ON the resolved node, §2 mapping row). `target: 'type'` is the legacy form of the fork-suite 'values' method (provider-side `{reference, value}` is the new-system twin). The old def→re-type emission seam (`isLinkDef`) survives ONLY for the 1:1 fork-stress link method (render.md §3.4.2) |
| `content` | Slot | scalar string, or `NodeData`/`NodeData[]` (`_instantiatedNodes` ⇒ children) | injects scalar into `content` layer; instantiated nodes into `children` layer | **D5 + D7, LANDED (F13):** a `target: 'content'` binding delivers the def's TEXT CONTENT ONLY — the def's `content` FIELD VALUE lands in the consumer's content slot via the content-target seam (NOT `scalarBinding`, NOT the def's children — no subtree, no dual-parse). Subtree delivery happens ONLY via `target: 'children'` / `target: 'type'` (the anchor-layer seam). The legacy scalar-vs-NodeData dual form is discontinued (D5) |
| `children` | Children slot | `NodeData`/`NodeData[]` child sub-trees | injects virtual child sub-trees into `children` layer; loop-guarded (`Component.isAppliedInAncestors()`) | **ANCHOR-LAYER SEAM (D7, LANDED)** — translate plans the binding with `options.seam = 'children'` (F17) and no `component-target-gap` warn; the resolved def's children (PRE-MINTED out-of-tree `'component'`-token prototypes, F16) materialize on the consumer as an anchor layer (D8: never emitted by the host, never attached by translate) |
| `props` | Properties | object dict (`Record<string, any>`) | injects/overwrites the host's whole `props` dict | NOT implemented (gap) |
| `props.<propertyName>` | Property key | any primitive or object value | deep-injects onto one host `props` key (`props.disabled`, `props.placeholder`, …) | **IMPLEMENTED (flat `props.<key>` only — kernel K1/K2, landed)**: the anchor carries `options.applyPath` (K5 persistence) and the node gains the synthesized `derived.props.<key> = { $: 'bindings.<ref>' }` read (apply of the RESOLVED value; at a self-provider that is its own `value`). Carve-outs warn `component-target-skipped` with no synthesis: dotted keys, dotted references, `props.id` (reserved derived key), authored-derived keys (no warn — authored wins), and the D7 syntax edges (`props.`, `props:name`, `props.name.`, bare `props`) |
| `css` | Style object | dict `{ id, classes, style, cssDef }` | injects into host `css` object | NOT implemented (gap) |
| `css.id` | Element id | string | injects `node.css.id` | NOT implemented (gap) |
| `css.classes` | Class list | string or `string[]` | injects `node.css.classes` | NOT implemented (gap) |
| `css.style` | Style dict | `Record<string,string>` | injects style key-value pairs | NOT implemented (gap) |
| `css.style.<property>` | Style property | string/numeric CSS value | injects one inline style property | NOT implemented (gap) |
| `handlers` | Handlers list | `HandlerDef`/`Handler` or array | injects into `node.handlers` | NOT implemented (gap) |
| `handlers.<eventName>` | Event binding | `HandlerDef` or JS string body | binds one event/lifecycle hook (`handlers.click`, `handlers.submit`, …). Legacy lifecycle hook NAMES (`handlers.beforeAssembly`, `handlers.beforePreprocess`, `handlers.afterAssembly`, …) are DELIBERATELY NOT SUPPORTED in the new version — no mapping; as a TARGET PATH they warn `handler-phase-unknown` + skip (N5 — the 3-phase set is closed; event-only reuse); separately, a handler DEF whose `phase` is a legacy lifecycle name warns `handler-phase-unknown` (K8, closed 3-set) and the definition is skipped | **HANDLER-SEAM (D6 un-park, LANDED 2026-08-15)** — the event suffix plans WITHOUT the `component-target-gap` warn (`options.handlerEvent` persisted verbatim, F17-style); the def registers by reference and compile materializes ONE provenance-marked handlers layer on the consumer (handlers.md §6); legacy lifecycle names as the suffix stay excluded — **EXCEPT `afterAssembly` (the AUTH-SEAM carve-out, 2026-08-16 — decisions.md AUTH-SEAM row):** it maps to the `after-compile` PHASE (`handlerPhase: 'after-compile'` planned on the anchor, `AnchorOptions.handlerPhase` — the consumer's ASSEMBLY is its after-compile pass; tests AU1-AU3); the def-root NEVER executes the handler — the compiled entries COPY onto the TYPE-target consumer (`seam-handlers-def` layer) which re-homes the def's children in-tree |
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
   The ONE carve-out (AUTH-SEAM, 2026-08-16): `handlers.afterAssembly`
   maps to the `after-compile` PHASE via the component binding
   (`handlerPhase: 'after-compile'` on the anchor) — see decisions.md
   AUTH-SEAM row.
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
  array values — folds into the `component-target-gap` warn; note the D7
  seam target set `type`/`content`/`children` is NO LONGER gap-warned —
  array VALUES for these targets are still vacuous at the seam and carry no
  explicit warn, they simply materialize nothing); self-referential
  component loops (`Component.isAppliedInAncestors()` → engine
  circular-source); unresolved bindings reset the target path back to the
  original `node.data` (never crash). **Emission first-wins (post-K7):** with
  2+ DEF-shaped bindings on one node, the FIRST def wins and the rest are
  silently dropped (`isLinkDef` first-def, render-helpers.ts:221) → new
  emission-time warn (`component-multiple-definitions`, >1 def); scalar text
  is first-wins by design (`scalarBinding`, render-helpers.ts:270-277) —
  documented, no warn.
- **Warn coverage (the full guard set, landed with K1–K8 + P3; D1–D8
  additions LANDED 2026-08-14):** all
  translate-time guards ride the K4 additive channel and are warn+skip, never
  a throw (TR-F2). The translate-time code set is:
  `component-binding-empty` (K3, vacuous bindings),
  `component-target-skipped` (K2, synthesis carve-outs + D7 target-syntax
  edges), `component-target-gap` (K8 pre-anchor vocabulary pass — unknown
  target paths, NP1/N2 code, DECIDED; the D7 seam set `type`/`content`/
  `children` is EXCLUDED from this gap), `component-duplicate-reference` +
  `component-duplicate-target` (K8, pre-anchor), `placement-name-invalid`
  (P3 §1.3 — a `#` in a placementName/targetPlacement name, or a
  non-string/empty targetPlacement entry: warn + skip that binding),
  `placement-string-coerced` (P3 back-compat — the old single-STRING
  targetPlacement shape is coerced to `[string]`), `placement-target-invalid`
  (targetPlacement is neither string nor string[]), `placement-duplicate-reference`
  (K8-class keep-first guard across the targetPlacement list),
  `placement-entry-invalid` (D1, LANDED — a non-object `placement`
  array entry, or a non-array non-object `placement` value: warn + skip that
  entry; `placement: []` stays a legal empty list, no warn),
  `handler-phase-unknown` (AP13, closed 3-set at
  translate.ts:177 — raw legacy names never dispatch, guard lives at
  translate; the ONE carve-out is `handlers.afterAssembly` → the
  `after-compile` PHASE, AUTH-SEAM 2026-08-16 — decisions.md AUTH-SEAM row), `handler-body-invalid` (NP11 — the pre-kernel non-function-body
  THROW is downgraded to warn+skip per TR-F2; a body STRING that fails to
  compile or evaluate to a function also warns + skips),
  `handler-format-invalid` (FORMAT MARKER, LANDED 2026-08-15 — a `format`
  value that is neither 'legacy' nor 'modern' warns + falls back to the
  provenance default: 'legacy' for seam-installed defs, 'modern' for inline
  bodies; two sites — the inline `NodeData.handlers` pass and the def-shaped
  `{name, body, format}` seam registration),
  `payload-shape-obsolete` (D2/F5, LANDED — ANY non-array `doc.content`
  (obsolete single-payload OBJECT, string, null, number, boolean) warns +
  the payload is SKIPPED, never silently dropped; the array form is the only
  supported shape),   `children-shape-invalid` (D5/F14, LANDED — a
  non-array `nodeData.children` (single NodeData OBJECT, string, …) warns +
  the field is SKIPPED, never dual-parsed, never wrapped),
  `hooks-shape-invalid` (HOOKS, LANDED 2026-08-16 — a non-array `hooks`
  field, or a non-string/empty member, warns + skips (that entry) — the
  children-shape-invalid discipline; the K4 unknown-key gap is closed FOR
  THIS FIELD, hooks-map-review §7.2 pin 4). Runtime (the managed channel):
  `hook-name-unresolved` (a `hooks.<name>` write naming a name with NO
  source/duplex anchor on the node → the state-slice op is REJECTED,
  `ApplyErrorCode`; the defensive applySlice path warns + skips, never
  throws), `hook-mode-blocked` (append/replaceAll on a hooks target →
  rejected), `hook-seam-exempt` (a seam/def-shaped provider — the landmine
  guard — warns + the mutation is an inert no-op).
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
restricted, `node.ts:648-672`) and compile cross-products multiple target
names (`resolve.ts:247-320`); the landed kernel accepts
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

**Parity scope (post-clarification; D7-amended 2026-08-14):** full 13-path
parity is NOT claimed. `type` / `content` / `children` are now the D7
ANCHOR-LAYER SEAM (planned at translate, materialized by assembly — §2
mapping rows; the old value-shape-driven halves remain only as the 1:1
fork-stress link-method emit path, render.md §3.4); `handlers.<event>` wires
via the HANDLER-SEAM (D6 un-park, LANDED 2026-08-15 — `options.handlerEvent`
persisted at translate, ONE provenance-marked handlers layer materialized on
the consumer at compile, def-shaped `{name, body}` values register by
reference; handlers.md §6). `css.*` family
paths are excluded from the parity claim (legal legacy, no seam).
Array-form parity is scoped to graph-level N bindings + `props.<key>`
apply paths only.

**Accepted emission-layer gaps (parity, known — tracked: NP5/NP9 RESOLVED
2026-08-19, N3 still accepted as a follow-up; review doc Appendix E.3):**
two value-shape gaps were ACCEPTED; neither blocks the K7/K8 parity claim
(props scalar + duplicates). **NP5/NP9 LANDED — an object emission seam
(`bakeValue`, decisions.md OTGE row, RENDER_PROCESS_NOTES §10.10.7).** N3 is
tracked in `docs/pending.md` (PARKED — emission-layer known gaps), revisit
when a consumer needs the propagated null shape:

| Gap | Symptom | Current code | Resolution shape |
| --- | --- | --- | --- |
| **NP5/NP9 — object values bake `[object Object]`** | A binding whose value is an OBJECT (non-def payload, `props.<key>` object) coerced to the literal `[object Object]` via `String()` in both adapters (`escapeText`/`escapeAttr`, the css-style/text bakes) — there was NO object emission seam: `scalarBinding` (`render-helpers.ts:502-509`) admits only `string`/`number`/`boolean`, so an object value fell through to the coercing bakes | `scalarBinding` `render-helpers.ts:502-509` (scalar gate) | **RESOLVED 2026-08-19 — `bakeValue(v)` seam (JSON string encoding, user directive):** plain objects (non-null, non-array) → `JSON.stringify(v)`, scalars/arrays keep existing coercion; applied at `adapters.ts` `escapeText`/`escapeAttr`, `DomAdapter.setProp` (text/form, css.*, prop/attr), `SSRFragmentAdapter.setProp` (text + cssDef), and the `render-helpers.ts` def-content bakes (def.content / spec.content / seam-resolved nested.content incl. seam 'content'/'type' delivery). Unchanged: `css:classes` arrays (`join`), `ruleBody` (nested CSS objects recurse). Tests: DOM-NP5 ×2 + FRG-NP5 ×2 |
| **N3 — null injection is lost on the derived seam** | A legacy deep-inject of NULL (key present, value null) is semantically lost: `applyDerived` omits null keys at `derived.ts:244` (`value !== null && value !== undefined`), so the derived record that reaches the adapters never carries the key at all (vs. present-with-null); the authored key-present half is only visible pre-bake (`seedOwnBindings` publishes the null at `node.ts:280` — `providerValueFor` returns null, `bindings[name] = null`), then the derived seam drops it | `derived.ts:244` (null-key omit), `node.ts:280` (null published), `render-helpers.ts:502-509` (`scalarBinding` also skips null — no text wire) | PARKED — a **null-preserving derived read**: either carry `key: null` through `applyDerived` (and decide how the adapters bake a null — set attribute? omit?) or document key-present-null as UNSUPPORTED-on-derived and keep the omission as the intentional contract. Revisit when a consumer needs the propagated shape (pending.md); re-verify review-doc Appendix E.3 first |

**Target-syntax normalization (post-kernel, D7):** the K1/K2 kernel accepts
the FLAT `props.<key>` form only (one segment — derived writes flat keys,
`validatePath` `derived.ts:37-54`). Edge forms are DELIBERATE-EXCLUSION →
block+warn (Appendix E.1; warn + skip via the K2 channel, code
`component-target-skipped`, never throw): `props.` (empty key), `props:name`
(colon separator), `props.name.` (trailing dot), bare `props` (whole-dict
overwrite — a parked target root, §2.1 table). Dotted `props.a.b` keys and
dotted `reference` names are K2 carve-outs (skip + `component-target-skipped`).

**Pre-kernel divergences (all corrected by the K1–K8 kernel, landed —
`archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md`):** the translator read
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
> `{reference, target: 'props.x'}` document round-trips exactly. **Seam
> targets (D7/F17, pinned — stress-test review loop #3, scenario 26):** a
> seam anchor (`options.seam = 'type' | 'content' | 'children'`) emits the
> seam target as the legacy `target` field too — consumer
> `{reference, target: <seam>}`, provider `{reference, value, target: <seam>}`
> — so re-translate reproduces the same seam plan (TR-H16's promise). The
> `target` field therefore means "apply path OR D7 seam target", never a
> second component name. **IMPLEMENTED 2026-08-15 (DEFECT #6 fixed)** —
> `nodeToLegacy` emits `target: <seam>` for seam anchors alongside the
> applyPath branch; the value+target provider is a DUPLEX anchor (S19) and
> reverses as `{reference, value, target}`. Two runtime
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
| `template.root` present but NOT an object (`42`, `[...]`, `"x"`, `true` — any truthy or falsy non-object) | **[reviewed, stress loop round 3]** throws `legacy-envelope-mismatch` — a non-object root is a MALFORMED ENVELOPE, never a default-div source. (ENGINE GAP vs this pin: the truthy gate at translate.ts:822 passes non-object roots through to `baseFrom`'s access-safe default-div mint with ZERO warns — reported in archive/findings/2026-08-15/2026-08-15-test-findings §"Stress-test review loop #4" DEFECT #8; the fix must type-check `template.root` at the gate, separate TDD pass) |
| payload without `content: NodeData[]` | throws `legacy-payload-mismatch` |
| `doc.content` is ANY non-array (D2/F5) — the obsolete single-payload OBJECT `{content, metadata}`, a string, null, number, boolean | well-formed-but-invalid — **warn + skip**, never a throw: K4 code `payload-shape-obsolete` fires (path `content`), the payload contributes nothing (no roots, no metadata/userData), and translation of the rest of the document continues normally (TR-F2). `doc.content` absent/undefined stays legal (no payloads) |

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
| TR-H11 | placement ARRAY form (D1) | `placement: [{...}, {...}]` maps EVERY entry through the TR-H3 single-entry logic (mint order = array order; producer + consumer on ONE node expressible; per-entry `#`-validation / string coercion / duplicates fire with their codes); the single-OBJECT form maps exactly once (convenience); an array NEVER silently no-ops — every skipped entry has a warn. **Shape pins (D1, LANDED):** `placement: []` → zero anchors, NO warn; non-object entries (`[null]`, `["x"]`) → `placement-entry-invalid`, skip that entry only; non-array non-object `placement` → `placement-entry-invalid`, no anchors. **Ancestor veto (F3 — IMPLEMENTED 2026-08-14, DEFECT #3-1 fixed; condition corrected per user):** loop-prevention only — fires when a family ancestor would attempt to place into the zone (`content` anchor); duplicate presentation legal; shared `ancestorConsumesZone` predicate — the producer row above. **Reverse (F2):** one flat merged object per node (`placementName` + `targetPlacement: string[]` mint order); multi-producer nodes (>1 container anchor) → `placement` ARRAY, one entry per container anchor, content names in the first entry; re-translate anchor-identical |
| TR-H12 | `css.style` OBJECT (D3) | serialized at translate to a kebab-case `k: v;` CSS string in the compiled state (never an object at the adapter boundary); reverseTranslate ALWAYS parses style strings back to the `Record<string,string>` object — no provenance (F7: a string-authored style becomes an object on save; legacy format is object-native, accepted). **Grammar (F8):** split on FIRST `:` (values may contain `:`); `;` splits entries except inside `url(...)`; vendor keys kebab-cased; numbers stringified; `{}` → `''` (no style attr) |
| TR-H13 | `doc.content` non-array shape (D2/F5) | K4 warn `payload-shape-obsolete` (obsolete OBJECT or any other non-array), payload skipped, no throw; array form is the only supported shape; absent `content` stays legal |
| TR-H14 | `nodeData.content` (D5) | text-only — carried as the text field; a NodeData/NodeData[] value is NOT dual-parsed into children (discontinued legacy; never reimplemented); children come only from `nodeData.children`. **Children shape (F14):** a non-array `children` value warns `children-shape-invalid` + the field is skipped (never wrapped, never dual-parsed). **Children ENTRY shape (stress loop round 3, PINNED — ENGINE GAP, see archive/findings/2026-08-15/2026-08-15-test-findings DEFECT #7):** a non-OBJECT entry inside a VALID `children` array (`[null]`, `["x"]`, `[42]`) warns the new K4 code `children-entry-invalid` + skips THAT entry only (mirror of `placement-entry-invalid`); the REST of the array still translates; NEVER a throw (TR-F2) and NEVER a crash — the current engine has no per-entry guard (translate.ts:799-803 passes the entry straight to `translateNodeData`, which reads `data.component` on it at translate.ts:692) and `children: [null]` aborts the WHOLE-DOC translate with an uncaught TypeError (fail-safe violation). The `[42]`-entry silent default-`div` mint (the `type: 42` fallback) is the documented known-gap folded into the same guard decision (warn + skip). **Content-target (F13):** `target: 'content'` delivers the def's `content` FIELD value into the consumer's content slot (NOT `scalarBinding`, NOT subtree); `target: 'children'` / `target: 'type'` deliver subtree links via the seam |
| TR-H15 | seam-target bindings (D7, translate side) | `component.target` in `type`/`content`/`children` is PLANNED (recognition) — NO `component-target-gap` warn for these three targets; the seam target persists on the anchor options (`options.seam = 'type' | 'content' | 'children'`, via `BindingPlan` → `applyPlans`, F17); resolution + layer materialization happen at assembly (ops.md §2.7); def children AND the DEF-ROOT are PRE-MINTED out-of-tree `'component'`-token prototypes at translate (registered, census-visible, minted ids — F16 + delivery-shape ruling: the def-root carries the def's type + css incl. cssDef + the child links to the def-children prototypes) — never attached to the host by translate |
| TR-H16 | seam reverse (D7/F20) | seam-wired def children are NOT emitted as the consumer's authored `data.children` on reverse — they stay in the def's JSON home (the def value keeps its own `children`); the consumer reverses with its authored children ONLY. Re-translate of the reversed document reproduces the same seam plan (`options.seam`) — the seam target is emitted as the legacy `target` field on reverse (K5 extension, pinned — stress-test review loop #3 scenario 26; ENGINE GAP reported: `nodeToLegacy` emits `target` for `options.applyPath` only, losing the seam plan) |
| TR-H4 | handlers on legacy nodes | carried to compiled `handlers`; STRING bodies instantiated into functions at translate; reverse emits live bodies as source strings (round-trips) |
| TR-H5 | template.children + content payloads | contentNodes-owned content roots in `TranslatedTree.content` (family-'in-tree', token edge — P3 §10.ad/F-13); metadata/userData surfaced |
| TR-H6 | run* gates | adapter/persistence mapping; defaults when absent; preserved by serializeSlice |
| TR-H7 | shared hub | same-name anchors on shared links |
| TR-H8 | compile+serialize of translated tree | new-format round-trip after `reconcileParentTargets` |
| TR-H9 | contentNodes-owned content roots | family-'in-tree' (node.ts:417) but the token terminates the compile walk — dropped from compile (P3 §2.4: in-tree is a family fact, not compiled viability); a real parent edge supersedes the token on attach |
| TR-H10 | K4 warnings channel + guards | `translated.warnings` is always present (empty for a clean doc); each entry `{ code, path }` fires a focused `console.warn`; every guard code (§2.1 list) warns + skips its binding/handler def, never throws (TR-F2); vacuous bindings (`{}`, non-string/empty reference) → `component-binding-empty`, zero anchors, while `component: []` stays a legal empty multi-binding list (no warning) |
| TR-F1 | malformed envelope / payload | throws (guards §3) |
| TR-F2 | legacy-only fields (`versions`, …) and malformed binding/handler content | ignored, never a throw — well-formed-but-invalid content surfaces on the K4 warnings channel (`placement-name-invalid`, `placement-string-coerced`, `placement-duplicate-reference`, `placement-entry-invalid`, `handler-phase-unknown`, `handler-body-invalid`, `payload-shape-obsolete`, `children-shape-invalid`, `children-entry-invalid` (pinned, stress loop round 3 — non-object children ENTRIES warn + skip), duplicate/vacuous/gap guards); only malformed envelopes/payloads throw (§3). The old `component-target-placement` code is REMOVED (the targetPlacement feed is implemented). The D7 seam targets `type`/`content`/`children` are planned (with `options.seam`), NOT gap-warned |
