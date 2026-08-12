// Shared wire/internal types for src/core (contract.md §types).
// Pure types only — this module emits no runtime code and imports nothing.

// Forward structural references to the Node/Link classes (defined in
// node.ts / link.ts, which this module is not allowed to import). Kept
// minimal: `isNode` distinguishes a Node from a Link structurally, which the
// C2 contract relies on (a Link can never fill AnchorTarget).
export type Role = 'parent'|'child'|'source'|'target'|'duplex'|'placement'|'component'
export type AnchorTarget = Node | 'rootNode' | 'component' | 'contentNodes' | string
interface Node {
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
  addLayer(layer: NodeLayer): void
  removeLayer(id: string): void
  removeLayersForSource(sourceName: string): void
  clone(actor?: string, opts?: { ignore?: string[] }): Node
  destroy(): void
  destroyLinks(): void
  markDestroyed(): void
  markDirty(scope: DirtyScope): void
  addAnchor(role: Role, target: AnchorTarget | string, options?: AnchorOptions, link?: unknown): Anchor
  removeAnchor(anchor: Anchor): void
  familyLinkFor(): Link
  reconcileAnchors(): void
  compileLocal(): void
  compileRemote(visited?: Set<string>, depth?: number): void
  compile(slice: Node[]): CompileResult
  applySlice(mutation: LayerMutationList): void
  orphan(childAnchor: Anchor): void
  __onLinkDissolve?(anchor: Anchor): void
}
interface Link {
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
export interface AnchorOptions { priority?: number; order?: number }
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
export type StructuralOp = AttachOp|DetachOp|MoveOp|CloneInstanceOp|DestroyOp

export interface LayerMutation {
  targetProp: 'type'|'content'|'handlers'|`props.${string}`|`css.${string}`
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
export type WireStructuralOp = WireAttachOp|WireDetachOp|WireMoveOp|WireCloneInstanceOp|WireDestroyOp
export interface WireStateSliceOp { kind:'state-slice'; node: NodeRef; mutation: LayerMutationList; actor?: string }
export type WireMutationOp = WireStructuralOp | WireStateSliceOp
export type MutationInput = LayerMutationList | WireStructuralOp

export type ApplyStatus =
  | { status:'applied'; journalId: string; dirtied: NodeId[] }
  | { status:'no-usable-state'; nodeState: NodeState }
  | { status:'rejected'; error: ApplyError }
export type ApplyErrorCode = 'unknown-node'|'placement-target-blocked'|'link-config'|'cycle-detected'|'single-parent'
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
}
export interface CompileResult {
  actionable: CompiledState[]
  dropped: Array<{ arm: NodeRef[]; reason: ArmDropReason }>
  warnings: Array<{ code: 'circular-source'|'unresolved-reference'; pathKey: PathKey }>
}
export interface AnchorDecl { role: Role; target: AnchorTarget|string; options?: AnchorOptions }
export interface NodeLayer {
  id: string; sourceName?: string; type?: string
  props?: Record<string, unknown>; css?: Record<string, unknown>
  content?: unknown; handlers?: unknown[]; anchors?: AnchorDecl[]
}
export interface NodeBaseData { id?: string; type?: string; content?: unknown; props?: Record<string,unknown>; css?: Record<string,unknown>; handlers?: unknown[] }
export interface LinkConfigNameHub { linkFor(name: string, kind: 'component'|'placement'): Link }
export interface HandlerDef { name: string; event?: string; phase?: string; body?: (ctx: unknown, ...args: unknown[]) => unknown }