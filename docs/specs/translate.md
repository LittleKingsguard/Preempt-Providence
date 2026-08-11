# Spec — Legacy Schema Translation: `translateLegacy`

Derivative of `RENDER_PROCESS_NOTES.md` §3.1 (raw NodeSchema types), §10.8
(anchor graph), §10.10.1 (DECIDED). The rebuild's serialized node shape is
anchors-first (`id` + `anchors[]`, children derived); original `/Preempt`
backend JSON is translated AT THE BOUNDARY so trees build out completely from
original-format data. This file is the behavior contract for the TestWriter.

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
  target?: string
  value?: unknown
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

## 2. Mapping rules

| Legacy input | Translation | Basis |
| --- | --- | --- |
| `template.root` | root `Node` (`type/content/props/css/handlers`), attached to the permanent owner `'rootNode'` → in-tree | S1.1 |
| `template.root.children` (NodeData.children) | the root's OWN default children — attached under root via parent-child anchors, `priority` = array index (children stored in the root itself) | user decision, §10.10.1 |
| nested `NodeData.children` | recursively translated + attached under their parent (same priority rule) | §10.8 |
| `template.children` | UNPLACED content nodes — translated, NO parent anchor, returned in `TranslatedTree.content`; **registered as payload-owned content** (persist in the background; dropped with their payload — see payload.md §1/§3) | user decision, §10.10.1, §10.10.4 |
| `ContentPayload.content[]` | UNPLACED content nodes (same as above) | user decision, §10.10.1 |
| `NodeData.placement.placementName` | `placement` anchor (`{role:'placement', target: name}`) on a shared per-name placement Link | §10.8.3 |
| `NodeData.component.reference` | `target` anchor on a shared per-name component Link; `component.value` parked on the anchor (binding hint, not a provider — unresolved until a source exists) | §10.8.2 |
| `NodeData.handlers` | carried on the node's base data → compiled `handlers` (runtime-only: function bodies are NOT serializable, see SER-F1; lost at the JSON boundary by design) | §10.10.2 |
| `ContentPayload.metadata/userData` | surfaced on `TranslatedTree` (first payload wins) | §10.10.1 |
| `clientConfig.runInstantiation` | `adapter: 'ssr'` when `true`, else `'dom'` | §10.10.1 |
| `clientConfig.runMonitoring` | `persistence: true` when `true` | §10.10.1 |
| missing `clientConfig` | `{ adapter: 'dom', persistence: false }` | §10.10.1 |

Unknown extra fields (`versions`, `targetPlacement`, `activePlacement`, …)
are ignored, never rejected.

Content nodes are unplaced ⇒ dropped from compile (S1.1) until attached into
a placement zone; a content node that self-provides (source/duplex) resolves
depth-0 (S-R2.6).

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
| TR-H2 | component binding (reference + value) on node/template | `target` anchor (+ parked value) |
| TR-H3 | placement config | `placement` anchor |
| TR-H4 | handlers on legacy nodes | carried to compiled `handlers` (live tree; not serialized) |
| TR-H5 | template.children + content payloads | unplaced content nodes in `TranslatedTree.content`; metadata/userData surfaced |
| TR-H6 | run* gates | adapter/persistence mapping; defaults when absent; preserved by serializeSlice |
| TR-H7 | shared hub | same-name anchors on shared links |
| TR-H8 | compile+serialize of translated tree | new-format round-trip after `reconcileParentTargets` |
| TR-H9 | unplaced content nodes | dropped from compile (S1.1); self-providing ones resolve depth-0 |
| TR-F1 | malformed envelope / payload | throws (guards §3) |
| TR-F2 | legacy-only fields (`versions`, targetPlacement…) | ignored, no throw |
