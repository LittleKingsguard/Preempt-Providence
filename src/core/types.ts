// Shared wire/internal types for src/core (contract.md §types).
// Pure types only — this module emits no runtime code and imports nothing.

// Forward structural references to the Node/Link classes (defined in
// node.ts / link.ts, which this module is not allowed to import). Kept
// minimal: `isNode` distinguishes a Node from a Link structurally, which the
// C2 contract relies on (a Link can never fill AnchorTarget).
export type Role = 'parent'|'child'|'source'|'target'|'duplex'|'container'|'content'|'component'
export type AnchorTarget = Node | 'rootNode' | 'component' | 'contentNodes' | string
export interface Node {
  readonly isNode: true
  readonly id: string
  readonly base: Readonly<NodeBaseData>
  readonly layers: NodeLayer[]
  readonly anchors: Anchor[]
  readonly dirty: Set<DirtyScope>
  destroyed: boolean
  readonly state: NodeState
  readonly isInTree: boolean
  readonly parent: Node | null
  readonly children: Node[]
  readonly type: string
  readonly props: Record<string, unknown>
  readonly css: Record<string, unknown>
  readonly content: unknown
  readonly pathKey: string
  readonly derived: DerivedDecl | undefined
  addLayer(layer: NodeLayer): void
  removeLayer(id: string): void
  removeLayersForSource(sourceName: string): void
  clone(actor?: string, opts?: { ignore?: string[] }): Node
  destroy(): void
  destroyLinks(): void
  markDestroyed(): void
  markDirty(scope: DirtyScope): void
  addAnchor(role: Role, target: AnchorTarget | string, options?: AnchorOptions, link?: unknown): Anchor | null
  removeAnchor(anchor: Anchor): void
  familyLinkFor(): Link
  reconcileAnchors(): void
  compileLocal(): void
  compileRemote(visited?: Set<string>, depth?: number): void
  compile(slice: Node[]): CompileResult
  /** Placement-path enumeration compile mode (P3 §2) — the third compile
   *  scope: mints one CompiledState per valid (node, owner-path) pair. */
  compilePath(): CompileResult
  applySlice(mutation: LayerMutationList): void
  orphan(childAnchor: Anchor): void
  __onLinkDissolve?(anchor: Anchor): void
}
export interface Link {
  readonly id: string
  readonly config: LinkConfig
  readonly anchors: Anchor[]
  anchorsOf(role: Role, target?: AnchorTarget): Anchor[]
  parents(): Anchor[]
  children(): Anchor[]
  sources(): Anchor[]
  targets(): Anchor[]
  addAnchor(a: Anchor): void
  removeAnchor(a: Anchor): void
  setOrder(a: Anchor, priority: number): void
  destroy(): void
}
export interface AnchorOptions {
  priority?: number
  order?: number
  /** K5 — the legacy local-apply path (`props.<key>`) a component binding's
   *  resolved value is applied to; persisted so reverseTranslate can re-emit
   *  `target` on the round-trip (translate.ts sets it at synthesis). */
  applyPath?: string
  /** AUTH-SEAM (2026-08-15) — `handlers.afterAssembly` maps to a PHASE: the
   *  N5 carve-out for the one legacy lifecycle name with a semantic home
   *  (after-compile = the consumer's assembly). */
  handlerPhase?: string
  /** HANDLER-SEAM (2026-08-15, D6 un-park) — a `handlers.<event>` binding's
   *  event suffix, verbatim: the consumer's handler layer fires on that event. */
  handlerEvent?: string
  /** DEFECT #10 (2026-08-15) — the seam target anchor NAME that drove a seam
   *  parent link: the materializeSeam reversion pass removes seam links
   *  whose driving seam anchor is gone (removeLayer unwinds the seam it
   *  minted). */
  seamTarget?: string
  /** D7/F17 — the anchor-layer seam marker: `true` on layer-materialized seam
   *  parent/child anchors (F15/F19 — the role-scoped single-parent exemption
   *  and the familyLinkFor filter key off it); the persisted seam target
   *  STRING (`'type'|'content'|'children'`) on translate-planned target
   *  anchors (F17 — assembly distinguishes seam candidates by it). */
  seam?: boolean | 'type' | 'content' | 'children'
  /** ORIGIN-OWNER (archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review §12.4.3) — the layer id that
   *  minted an anchor: `layer-apply`'s decl child anchors carry it (admitted
   *  by the role-scoped single-parent exemption, like the seam flag). */
  origin?: string
}
export interface Anchor { role: Role; target: AnchorTarget; options: AnchorOptions; link: Link; value?: unknown; owner?: import('./node.js').Node }
// `value` is the provided/deployed cell for `source`/`duplex` anchors (api.md §4.1: source provides
// its resolved value; duplex carries BOTH target and value). Resolvers read `anchor.value`.
// `owner` is the node that holds the anchor (set by Node.addAnchor) — the per-name component Link
// can therefore enumerate the PROVIDER NODES relevant for a reference (the link registry query).
export type NodeState = 'prototype'|'unplaced'|'in-tree'|'destroyed'
export type LinkConfigErrorCode = 'unique-order'|'count-exceeded'|'count-underflow'|'role-mismatch'
export interface LinkConfig {
  name: 'parent-child'|'component'|'placement' | (string & {})
  parent?: { count: 1 }
  children?: { min: number; max: number; orderKey: 'unique' }
  roles: Role[]
}
export type NodeId = string
export type PathKey = string
export type NodeRef = NodeId
export type LinkId = string
export type Actor = string

export interface AttachOp { kind: 'attach'; node: Node; to: Node; zone?: string; priority?: number }
export interface DetachOp { kind: 'detach'; node: Node; from?: Link }
export interface MoveOp   { kind: 'move'; node: Node; to: { parent: Node; priority?: number } }
export interface CloneInstanceOp { kind: 'clone-instance'; source: Node; slot: string; priority?: number }
export interface DestroyOp { kind: 'destroy'; node: Node }
/** P3 §3.3/§9-Q2 — the silent-abort carrier (C-2/10.ac.2 #7): which placement
 *  link an update changed and how. Passed into the pass-2 dispatch through
 *  `supervisor.apply`; the compiler entry evaluates `placementChangeIrrelevant`
 *  per affected node before any state regeneration. */
export interface PlacementTrigger {
  kind: 'placement'
  linkName: string
  direction: 'container-added' | 'container-removed' | 'content-added'
}
/** P3 §3.3 — the dedicated placement-attach op (F-4): registers the node if
 *  new, mints its `content` anchor(s) per `names` (preference order), mints/
 *  ensures the `container` anchor on the target container node (with the §1.3
 *  ancestor-name veto), and marks pass-2 dirty ONLY the container node + the
 *  added node (E2E-4's ideal affected set). `attach` stays family-only;
 *  `AttachOp.zone` is superseded by this kind. The op payload carries the
 *  trigger-identity fields; `supervisor.apply` derives them when absent. */
export interface PlacementAttachOp {
  kind: 'placement-attach'
  node: Node
  container: Node
  names: string[]
  trigger?: PlacementTrigger
}
/** ORIGIN-OWNER (archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review §12.4, unpark acceptance) — the
 *  atomic mint-and-wire structural op: mints each NodeData as a family child
 *  of `target` (family children ONLY — a NodeData `anchors` field is
 *  rejected/warned, A5), registers the minted set (per-node `originLayer` +
 *  the module-level registry), and applies an anchor layer (`decls`) to
 *  `target` — the decl child anchors carry `options.origin = layerId`.
 *  Re-applying the SAME layerId is a no-op (idempotent); teardown = one
 *  removeLayer/removeLayersForSource on the creator (the pre-detach survival
 *  predicate, §12.4.2/6). The journal result persists `minted` (A3). */
export interface LayerApplyOp {
  kind: 'layer-apply'
  target: Node
  layerId: string
  sourceName: string
  decls: AnchorDecl[]
  nodes: NodeBaseData[]
  /** FEATURE 4 (handoffs-review-9.md D1, ruling 23) — PRESERVE-BY-REVERSAL:
   *  when true, the minted layer's origin-owned nodes reverse as authored
   *  edits. Forwarded to the layer object (a runtime layer property). */
  preserveByReversal?: boolean
}
/** HOOKS-ARRAY (§9.4 items 3-8, CONTRACT AMENDMENT C) — the rows-mint op:
 *  mints ONE family node per raw data row from a prototype resolved by
 *  NAME (`prototypeName` → the per-name component Link's def prototypes),
 *  attaches each row's fields as VALUE-BEARING source anchors, and applies
 *  a NODE-SCOPED batch layer `hook-${target.id}-${hookName}-rows`
 *  (DEFECT #23). `kind: 'component'` mints with the components only;
 *  `kind: 'placement'` ALSO routes the minted set into the specified
 *  `placementName` target zone. The payload is the CONTROL MECHANISM —
 *  teardown/deletion operates on the `batches[hookName]` record, never on
 *  the minting apparatus directly. */
export interface RowsMintOp {
  kind: 'rows-mint'
  target: Node
  hookName: string
  /** the mint KIND discriminator (the hook declaration's operation kind):
   *  `'component'` mints family nodes with the components only; `'placement'`
   *  ALSO routes the minted set into the specified `placementName` zone. */
  mintKind: 'component' | 'placement'
  prototypeName: string
  placementName?: string
  rows: NodeBaseData[]
  sourceName?: string
  /** KEYED BATCH-REUSE (Feature 1b, 2026-08-24 — handoffs-review-6.md D1-D6):
   *  the OPTIONAL DECLARED identifier column. When present (and valid), a
   *  re-mint on the same hookName REUSES the minted node whose `keyField`
   *  source-anchor value === the row's keyField value (in-place value
   *  re-apply), mints-new for unmatched keys, and removes rows absent from
   *  the input. Any inconsistency (non-string/empty keyField, a reserved
   *  construction key, a row lacking a primitive key value, or a record
   *  mismatch on keyField/prototypeName/placementName) DEGRADES the WHOLE op
   *  to the plain whole-batch replace (batch-keyfield-invalid warn). */
  keyField?: string
  /** FEATURE 4 (handoffs-review-9.md D1, ruling 23) — PRESERVE-BY-REVERSAL:
   *  when true, the batch layer's origin-owned rows reverse as authored
   *  edits. Forwarded to the layer object (a runtime layer property; NOT
   *  carried in the batch record — D4). */
  preserveByReversal?: boolean
}
/** HOOKS-ARRAY (§9.4 item 6 — the payload-controlled teardown). The op is
 *  the PAYLOAD-CONTROL: it deletes the `batches[hookName]` record (the
 *  SINGLE handle) and tears down the minted set via the record's layerId —
 *  the minting apparatus (`removeLayer`/`teardownMinted`/the registry) is
 *  INTERNAL and never addressed directly by external code. Rows never
 *  PROMOTE (a promoted row would reverse-ship as authored content — data
 *  corruption); the no-promotion override applies to the rows namespace. */
export interface RowsClearOp {
  kind: 'rows-clear'
  target: Node
  hookName: string
  sourceName?: string
}
/** HOOKS-ARRAY (OPTION C — the batch storage cell, §9.2 pin 5) — the
 *  PAYLOAD record that is the single control handle for a hook-driven mint
 *  batch: write it → mint/replace; clear/remove it → payload-controlled
 *  teardown; read it → the batch + the minted set + the round-trip source.
 *  Held as a RUNTIME field on Node (`node.batches[hookName]` — base is
 *  frozen, so the record is a mutable node-level slot), serialized alongside
 *  the node for the serialized-doc re-mint (rows are DATA, the minted nodes
 *  are DERIVED). */
export interface BatchRecord {
  prototypeName: string
  rows: NodeBaseData[]
  layerId: string
  mintKind: 'component' | 'placement'
  placementName?: string
  /** KEYED BATCH-REUSE (Feature 1b) — the declared identifier column; written
   *  ONLY when the keyed path ran (a degraded op's record loses it). Rides
   *  the round-trip (serialize §4) so a post-restore keyed update reuses the
   *  re-minted nodes. */
  keyField?: string
}
export type StructuralOp = AttachOp|DetachOp|MoveOp|CloneInstanceOp|DestroyOp|PlacementAttachOp|LayerApplyOp|RowsMintOp|RowsClearOp

export interface LayerMutation {
  /** HOOKS (hooks-map-review.md §7 contract amendment B — the value-provider
   *  slot): `hooks.<name>` targets a SAME-NODE value-provider hook (a
   *  `hooks` field names the source/duplex component bindings the node
   *  exposes for hook writes). `mode` is restricted to 'replace'
   *  (`hook-mode-blocked`); `value: undefined` CLEARS the hook (the layer is
   *  removed, the authored anchor value restores). */
  targetProp: 'type'|'content'|'handlers'|`props.${string}`|`css.${string}`|`hooks.${string}`
  mode: 'replace'|'append'|'replaceAll'
  value: unknown
  sourceName?: string
}
export type LayerMutationList = LayerMutation[]
export interface StateSliceOp { kind: 'state-slice'; node: Node; mutation: LayerMutationList; actor?: Actor }
export type MutationOp = StructuralOp | StateSliceOp

// wire forms (api.md §1)
export interface WireAttachOp { kind:'attach'; node: NodeRef; to: NodeRef; zone?: string; priority?: number }
export interface WireDetachOp { kind:'detach'; node: NodeRef; from?: LinkId }
export interface WireMoveOp   { kind:'move'; node: NodeRef; to: { parent: NodeRef; priority?: number } }
export interface WireCloneInstanceOp { kind:'clone-instance'; source: NodeRef; slot: string; priority?: number }
export interface WireDestroyOp { kind:'destroy'; node: NodeRef }
export interface WirePlacementAttachOp {
  kind: 'placement-attach'
  node: NodeRef
  container: NodeRef
  names: string[]
  trigger?: PlacementTrigger
}
export type WireStructuralOp = WireAttachOp|WireDetachOp|WireMoveOp|WireCloneInstanceOp|WireDestroyOp|WirePlacementAttachOp
export interface WireStateSliceOp { kind:'state-slice'; node: NodeRef; mutation: LayerMutationList; actor?: string }
export type WireMutationOp = WireStructuralOp | WireStateSliceOp
export type MutationInput = LayerMutationList | WireStructuralOp

export type ApplyStatus =
  | { status:'applied'; journalId: string; dirtied: NodeId[] }
  | { status:'no-usable-state'; nodeState: NodeState }
  | { status:'rejected'; error: ApplyError }
export type ApplyErrorCode = 'unknown-node'|'placement-target-blocked'|'link-config'|'cycle-detected'|'single-parent'
  |'hook-name-unresolved'|'hook-mode-blocked'|'hook-kind-mismatch'|'rows-prototype-unresolved'
export interface ApplyError { code: ApplyErrorCode; detail?: unknown }

export type DirtyScope = 'remote'|'anchor-populate'|'sweep-candidate'
export type ArmDropReason = 'prototype-terminated'|'owner-terminated'|'loop'
export interface UnresolvedRef { referenceName: string; code: 'unresolved-reference' }
export interface CompiledState {
  nodeId: NodeId; pathKey: PathKey; state: NodeState; type: string
  props: Record<string, unknown>; css: Record<string, unknown>; content: unknown
  anchors: readonly Anchor[]; parent: NodeRef | null; children: NodeRef[]
  bindings: Record<string, unknown>; unresolved: UnresolvedRef[]
  trace?: NodeRef[]
  forkKey?: PathKey
  /** P3 §2.5 — the derived `activePlacement` read source: the CHOSEN name
   *  (the zone name of the path-state's own first placement hop) on
   *  placement-routed path-states. Never authored; absent on non-path and
   *  non-placement states. The derived `placement` root reads it per-path
   *  (derived.ts §2.3 — Unit 10 wiring). */
  activePlacement?: string
}
export interface CompileResult {
  actionable: CompiledState[]
  dropped: Array<{ arm: NodeRef[]; reason: ArmDropReason }>
  warnings: Array<{ code: 'circular-source'|'unresolved-reference'; pathKey: PathKey }>
}
export interface AnchorDecl { role: Role; target: AnchorTarget|string; options?: AnchorOptions }
// Derived state (docs/specs/derived-state.md §2/§3): a data-carried,
// JSON-only declaration of props derived from the node's own compiled state.
// Expressions are pure and whitelisted — no eval, no dispatch, no journal.
export type DerivedExpr =
  | string
  | number
  | boolean
  | null
  | { $: string }
  | { $concat: DerivedExpr[] }
  | { $if: { cond: DerivedExpr; then: DerivedExpr; else?: DerivedExpr } }
  | { $eq: [DerivedExpr, DerivedExpr] }
  | { $gt: [DerivedExpr, DerivedExpr] }
export interface DerivedDecl { props?: Record<string, DerivedExpr>; css?: Record<string, DerivedExpr> }
export interface NodeLayer {
  id: string; sourceName?: string; type?: string
  props?: Record<string, unknown>; css?: Record<string, unknown>
  content?: unknown; handlers?: unknown[]; anchors?: AnchorDecl[]; derived?: DerivedDecl
  /** HOOKS (hooks-map-review.md §7.3) — the dedicated hook layer VALUE slot
   *  (a `hook-<name>` layer). Never a `props.*` key (no authored-prop
   *  collision); compileLocal ignores it (pass-1 output unchanged). Read by
   *  `providerValueFor` (hook layer first, authored `a.value` fallback).
   *  The layer carries NO anchors (removeLayer safety — DEFECT #10). */
  value?: unknown
  /** HOOKS — the authored anchor value preserved at the FIRST hook write;
   *  the clear path (`value: undefined`) restores it to the anchor. */
  hookFallback?: unknown
  /** FEATURE 4 (handoffs-review-9.md D1, ruling 23) — PRESERVE-BY-REVERSAL:
   *  when true, the origin-owned nodes minted under this layer reverse as
   *  DELIBERATE EDITS in `nodeToLegacy` (not reverse-excluded). Read at
   *  REVERSE time via the parent→layer relationship (the minted node's parent
   *  holds this layer); a runtime layer property, never serialized. Absent
   *  defaults to no (the current reverse-exclusion). */
  preserveByReversal?: boolean
}
export interface NodeBaseData { id?: string; type?: string; content?: unknown; props?: Record<string,unknown>; css?: Record<string,unknown>; handlers?: unknown[]; derived?: DerivedDecl; hooks?: string[]; hooksKind?: Record<string, HookKind>; batches?: Record<string, BatchRecord> }
/** HOOKS-ARRAY (§9.4 item 1 — CONTRACT AMENDMENT C) — the closed kind union
 *  a `hooksKind` declaration may name: `'value'` (the shipped §7 scalar
 *  value-provider slot), `'component'` (the hook mints nodes with
 *  components), `'placement'` (the hook mints nodes with the SPECIFIED
 *  TARGET PLACEMENT + components). An unknown kind warns `hooks-kind-unknown`
 *  at translate + skips that entry; the union is closed (a future kind is a
 *  spec change). */
export type HookKind = 'value' | 'component' | 'placement'
/** ORIGIN-OWNER — the data shape of a layer-apply minted node (family
 *  children only; an `anchors` field is vetoed with the
 *  `layer-apply-anchors-rejected` warn). */
export type NodeData = NodeBaseData
export interface LinkConfigNameHub { linkFor(name: string, kind: 'component'|'placement'): Link }
export interface HandlerDef { name: string; event?: string; phase?: string; body?: (ctx: unknown, ...args: unknown[]) => unknown }