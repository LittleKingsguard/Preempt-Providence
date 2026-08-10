# Implementation Contract — public API surface for `src/core`

Test-first contract: the exhaustive vitest suites under `tests/` (derived from the per-spec
TestWriter matrices) are written against THE EXACT surface below. The `src/core`
implementation must satisfy every signature here exactly (TS strict, ESM, import specifiers
use the `.js` extension). Nothing outside `src/core` + `src/server.ts` may be exported to tests.

Imports in tests take the form `import { Link } from '../src/core/link.js'`. Module layout:

| Module | Exports |
| --- | --- |
| `src/core/types.ts` | all shared types |
| `src/core/errors.ts` | error classes |
| `src/core/link.ts` | `Link`, link factories, `mintLinkId`, default configs |
| `src/core/node.ts` | `Node`, `mintNodeId`, `MAX_COMPILE_DEPTH`, `Supervisor` |
| `src/core/ops.ts` | structural-op executors, cycle guard, `CycleError`, state-slice applier |
| `src/core/pipeline.ts` | `PhaseRegistry`, `PhaseWorker`, `PipelineStage`, `SliceLock`, `MicrotaskQueue`, `RenderMicrotaskQueue` |
| `src/core/validation.ts` | `TAG_SCHEMAS`, `registerTagSchema`, `validateNode`, `TagSchema` |
| `src/core/render.ts` | `RenderAdapter`, `MinimalElement`, `diffMinimal`, `RenderOp`, mock adapter |
| `src/core/serialize.ts` | JSON round-trip: `serializeNode`, `serializeSlice`, `SerializedAnchor`, `RenderNodeState`, `reResolve` |
| `src/core/client.ts` | `ClientAPI`, `createClient`, `ExposedState`, `CompileStatus` |
| `src/core/events.ts` | `EventBridge`, `EventEnvelope`, `PreemptEvent`, `coalesceByTick` |

---

## `src/core/types.ts`

```ts
export type Role = 'parent'|'child'|'source'|'target'|'duplex'|'placement'|'component'
export type AnchorTarget = Node | 'rootNode' | 'component' | 'contentNodes' | string
export interface AnchorOptions { priority?: number; order?: number }
export interface Anchor { role: Role; target: AnchorTarget; options: AnchorOptions; link: Link; value?: unknown }
// `value` is the provided/deployed cell for `source`/`duplex` anchors (api.md §4.1: source provides
// its resolved value; duplex carries BOTH target and value). Resolvers read `anchor.value`.
export type NodeState = 'prototype'|'unplaced'|'in-tree'|'destroyed'
export type LinkConfigErrorCode = 'unique-order'|'count-exceeded'|'count-underflow'|'role-mismatch'
export interface LinkConfig {
  name: 'parent-child'|'component'|'placement' | (string & {})
  parent?: { count: 1 }
  children?: { min: number; max: number; orderKey: 'unique' }
  roles: Role[]
}
export type NodeId = string; export type PathKey = string
export type NodeRef = NodeId; export type LinkId = string; export type Actor = string

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
export interface NodeBaseData { type?: string; content?: unknown; props?: Record<string,unknown>; css?: Record<string,unknown>; handlers?: unknown[] }
export interface LinkConfigNameHub { linkFor(name: string, kind: 'component'|'placement'): Link }
export interface HandlerDef { name: string; body?: (ctx: unknown, ...args: unknown[]) => unknown }
```

## `src/core/errors.ts`

```ts
import type { Anchor, AnchorOptions, AnchorTarget, LinkConfig, LinkConfigErrorCode, Role } from './types.js'
export class LinkConfigError extends Error {
  readonly code: LinkConfigErrorCode
  readonly linkId: string
  readonly config: LinkConfig
  readonly detail: {
    intendedAnchor?: { role: Role; target: AnchorTarget; options: AnchorOptions }
    conflicting: Anchor[]
    currentCell: Anchor[]
  }
  constructor(code, linkId, config, detail?)
}
export class SingleParentError extends Error { readonly nodeId: string; constructor(nodeId: string, message?: string) }
export class CycleError extends Error { readonly nodeId: string; constructor(nodeId: string, message?: string) }
export class PipelineError extends Error { readonly code: 'unknown-stage'|'duplicate-registration'; constructor(code, message?) }
export class PipelineLockError extends Error { readonly code: 'unlock-before-resolution'|'lock-order'|'cross-slice-emission'|'double-unlock'; constructor(code, message?) }
export class ApplyError extends Error { readonly code: ApplyErrorCode; readonly detail: unknown; constructor(code, detail?) }
```

`LinkConfigError` carries the exact fields above; `SingleParentError`/`CycleError` are op-level
violations; `ApplyError` surfaces from `ClientAPI.apply` / `Supervisor.apply`.

## `src/core/link.ts`

```ts
import type { Anchor, AnchorOptions, AnchorTarget, LinkConfig, Role } from './types.js'
export function mintLinkId(): string
export const DEFAULT_PARENT_CHILD: LinkConfig    // { name:'parent-child', parent:{count:1}, children:{min:1,max:Infinity,orderKey:'unique'}, roles:['parent','child'] }
export const DEFAULT_COMPONENT: LinkConfig       // { name:'component', roles:['source','target','duplex'] }
export const DEFAULT_PLACEMENT: LinkConfig       // { name:'placement', roles:['placement'] }

export class Link {
  readonly id: string
  readonly config: LinkConfig
  readonly anchors: Anchor[]
  constructor(config?: Partial<LinkConfig> & { name: LinkConfig['name'] }, id?: string)
  anchorsOf(role: Role, target?: AnchorTarget): Anchor[]
  parents(): Anchor[]; children(): Anchor[]; sources(): Anchor[]; targets(): Anchor[]
  addAnchor(a: Anchor): void      // throws LinkConfigError; atomic
  removeAnchor(a: Anchor): void   // throws LinkConfigError (count-underflow); atomic
  setOrder(a: Anchor, priority: number): void // throws LinkConfigError; atomic
  destroy(): void                 // deliberate wipe; orphans child anchors
}
```

`addAnchor` enforces: role whitelist (`role-mismatch`), `'parent'` count max (`count-exceeded`),
child `priority` uniqueness (`unique-order`). `removeAnchor` enforces min counts
(`count-underflow`). Every rejecting call leaves `anchors` byte-identical (G1–G20).

## `src/core/node.ts`

```ts
import type { Anchor, AnchorOptions, AnchorTarget, CompiledState, CompileResult, LinkConfigNameHub, NodeBaseData, NodeLayer, NodeState, Role } from './types.js'
export function mintNodeId(): string
export const MAX_COMPILE_DEPTH = 8

export class Node {
  readonly isNode = true as const
  readonly id: string
  readonly base: Readonly<NodeBaseData>
  readonly layers: NodeLayer[]
  readonly anchors: Anchor[]
  readonly dirty: Set<DirtyScope>
  constructor(data?: NodeBaseData, hub?: LinkConfigNameHub, id?: string)
  get destroyed(): boolean
  get state(): NodeState          // derived: chain→'rootNode'⇒'in-tree'; 'component'⇒'prototype'; none/other⇒'unplaced'
  get isInTree(): boolean
  get parent(): Node | null       // ≤1 'child' anchor → Link → 'parent' anchor → its node; null on token/no-child
  get children(): Node[]          // family Link child anchors, priority-sorted
  get type(): string; get props(): Record<string,unknown>; get css(): Record<string,unknown>; get content(): unknown
  get pathKey(): PathKey
  addLayer(layer: NodeLayer): void
  removeLayer(layerId: string): void
  removeLayersForSource(sourceName: string): void
  markDirty(scope: DirtyScope): void
  addAnchor(role: Role, target: AnchorTarget, options: AnchorOptions, link: Link): Anchor
  removeAnchor(anchor: Anchor): void
  familyLinkFor(): Link | null        // this node's own 'parent' family link (create if none)
  reconcileAnchors(): void            // pass-1 anchor materialization from layers
  compileLocal(): void
  compileRemote(visited?: Set<Node>, depth?: number): CompiledState
  compile(slice: Node[]): CompileResult
  destroyLinks(): void
  markDestroyed(): void
  orphan(childAnchor: Anchor): void
}
```

`compile(slice)` runs pass-1 for the whole slice before pass-2 (tests assert order by the
absence of mid-op walks / by anchor freshness). `state` is derived per call, never stored;
`'parent'` setter and `children` array assignments are impossible (no such fields).

### `Supervisor` (exported from `src/core/node.ts`)

The op journal + node registry at the pipeline boundary (ops.md §3, api.md §5). Both constructor
forms below must work:

```ts
export type JournalEntry = { id: string; op: MutationOp }

export class Supervisor {
  constructor(init: { hub: LinkConfigNameHub; events: EventBridge })   // api.test.ts form
  constructor(root: Node, nodes: Map<string, Node>)                     // ops.test.ts form
  readonly journal: JournalEntry[]        // replayable op stream, appended by apply()
  registerNode(node: Node): void          // registers in the owned registry
  apply(op: WireMutationOp | MutationOp): ApplyStatus   // wire shape resolved via registry; journals
  replay(): void                          // re-execute journal in order on the current registry
  undo(): void                            // invert/undo last journaled op
  redo(): void                            // reapply the undone op
}
```

`apply` gates `unknown-node` (wire refs not in registry), resolves wire IDs to live nodes, journals a
successful mutation, returns `{ status:'applied'; journalId; dirtied }` (or the matching rejection).
Empty `journal = []` satisfies `journal.length` checks in tests T1–T5.

## `src/core/ops.ts`

```ts
export interface OpContext { hub: LinkConfigNameHub; nodes: Map<NodeId, Node> }
export function execute(op: MutationOp, ctx: OpContext): { doorways: NodeId[] }
export function findCycle(node: Node, dest: Node): boolean
export function applyStateSlice(node: Node, mutation: LayerMutationList): void
```

- `execute` dispatches by kind. `attach` enforces: dest loop guard, single-parent (throws
  `SingleParentError` when node already owns a `'child'` anchor), atomic family edge. `move`,
  `detach`, `destroy`, `clone-instance` per ops.md §2.
- `applyStateSlice` applies `LayerMutation`s as appended layers (named ops/journal-friendly)
  and rejects placement-target writes (`targetProp` never includes `'placement'`/`'children'`).
- `findCycle` re-implements the compile-time detector for `attach`/`move` (src3.4).
- Return value `{ nodeId }` names dirtied nodes for the caller (sweep scheduling).

## `src/core/pipeline.ts`

```ts
export type PipelineStage = 'instantiation'|'targetPlacementResolution'|'placementAssembly'|'componentRouting'|'componentAssembly'|'slotAssembly'|'preprocessing'|'validation'|'elementCreation'|'treeAssembly'|'postprocessing'
export interface PhaseRegistryEntry { stage?: PipelineStage; worker: PhaseWorker; order: number; summary: string }
export interface PhaseRegistry { register(e): void; getWorker(stage): PhaseWorker; getPhaseNumber(stage): number; stages(): readEntry[]; docs(): string }
export const canonical: PhaseRegistry  // prefilled with the 11 phases (order 0..10)
export interface PhaseWorker { readonly order: number; emission(node, ctx): EmissionResult | Promise<EmissionResult>; afterEach?(prev, next): void }
export type EmissionResult = { kind:'emitted'; renderOps: RenderOp[] } | { kind:'dropped'; reason: DropReason } | { kind:'forwarded'; to: PipelineStage } | { kind:'deferred' }
export type DropReason = 'not-in-tree'|'validation-failed'|'prototype-terminated'|'owner-terminated'|'loop'|'placement-target-blocked'
export class SliceLock {
  constructor(sliceRoot: NodeId, opts?: { maxDepth?: number })
  readonly sliceRoot: NodeId
  readonly maxDepth: number
  get state(): LockState
  get visitSet(): ReadonlySet<NodeId>
  recordVisit(id: NodeId): void
  reenter(chainDepth: number): 'defer' | 'trip'
  beginResolution(): void
  resolveFork(key: string, r: EmissionResult): void
  unlock(): void
}
export type LockState = 'held'|'resolving'|'resolved'|'released'
export interface RenderMicrotaskQueue {
  enqueue(t: QueueTask): void
  schedule(): void
  readonly scheduled: boolean
}
export type QueueTask =
  | { kind:'deferred-emission'; node: NodeId; stage: PipelineStage; chainDepth: number; origin: NodeId }
  | { kind:'dirty-pass2'; dirty: Set<NodeId> }
  | { kind:'cascade-destroy' }
  | { kind:'event-batch'; batch: EventEnvelope }
  | { kind:'render-emit'; ops: RenderOp[] }
export class MicrotaskQueue implements RenderMicrotaskQueue {
  drain(): void
  drainOrder(): QueueTask['kind'][]   // fixed: deferred-emission → dirty-pass2 → cascade-destroy → event-batch → render-emit
}
```

`SliceLock` per pipeline.md §4 (reenter returns `'defer'`/`'trip'`; unlock gates on `resolved`).
`PhaseRegistry` rejects duplicate stage/order (`duplicate-registration`) and throws
`PipelineError('unknown-stage')`. `MicrotaskQueue.drainOrder()` exposes the fixed §5.1 order.

## `src/core/validation.ts`

```ts
export interface TagSchema { required: string[]; validate: Record<string, (v: unknown) => boolean> }
export const TAG_SCHEMAS: Map<string, TagSchema>
export function registerTagSchema(tag: string, schema: TagSchema): void
export function validateNode(node: Node, tag?: string): { tag: string; errors: string[] }
```

`validateNode` runs the tag's `required` + validators on the node's *values* (props/css/content)
only — never structural invariants (boundary rule, validation.md §2).

## `src/core/render.ts`

```ts
export type RenderOp =
  | { kind:'create'; wire: NodeRef; type: string }
  | { kind:'set'; wire: NodeRef; name: string; value: unknown }
  | { kind:'append'; owner: NodeRef; child: NodeRef }
  | { kind:'remove'; wire: NodeRef }
  | { kind:'styles'; cssDefs: unknown[] }
export interface MinimalElement { wire: NodeRef; type: string; props: Record<string, unknown>; childOrder: NodeRef[] }
export function diffMinimal(prev: Map<NodeRef, MinimalElement> | null, next: MinimalElement[]): RenderOp[]
export interface RenderAdapter<P = unknown, E = unknown> {
  createEl(type: string, wire: NodeRef): P
  setProp(wire: NodeRef, name: string, val: unknown): void
  appendChild(owner: P, child: P): void
  hydrate(rootWire: NodeRef, vdom: unknown): void
  removeEl?(wire: NodeRef): void
}
export class MockAdapter implements RenderAdapter<{ wire: string; type: string }> {
  readonly calls: RenderOp[]   // every adapter call recorded, in order
  createEl(type, wire): { wire; type }; setProp(...); appendChild(...); hydrate(...); removeEl(wire)
}
```
`diffMinimal` implements D1–D5 (create/set/append/remove/styles).

## `src/core/serialize.ts`

```ts
export type SerializedAnchor = { role: Role; target: NodeRef|'rootNode'|'component'|'contentNodes'|string; options: { priority?: number; order?: number }; link: string }
export interface RenderNodeState { id: NodeRef; state: 'in-tree'; type: string; props: Record<string, unknown>; css: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }; content?: unknown; children: NodeRef[]; anchors: SerializedAnchor[]; forkKey?: string }
export type SerializedRenderDoc = { template: unknown; content: unknown[]; clientConfig: { adapter: string; persistence: boolean } }
export function serializeNode(node: Node): RenderNodeState          // required per unique target-kind of anchors
export function serializeSlice(node: Node, kids: Node[]): SerializedRenderDoc   // template/content envelope
export function loadState(doc: SerializedRenderDoc): NodeBaseData[]   // parse → seed data (re-resolve path)
```
`node → JSON → parse → recompile` must round-trip equal render-relevant state (SER-R1; tests SER-H1/F1).

## `src/core/client.ts`

```ts
export type CompileStatus = 'ok'|'unresolved-reference'
export interface ExposedState { nodeId: NodeId; status: CompileStatus }
export interface ClientAPI {
  apply(nodeRef: NodeRef, mutation: MutationInput): ApplyStatus
  getState(nodeRef: NodeRef): ExposedState[]
}
export interface ClientAPIResult { clientAPI: ClientAPI; supervisor: Supervisor }
export function createClient (supervisor: Supervisor): ClientAPI
```
`apply` wraps a `LayerMutationList` into a `{kind:'state-slice'}` internally; journals through
`supervisor.apply`; gates `in-tree` (returns `{status:'no-usable-state'}`), and returns your
`{status:'rejected', ...}` for `unknown-node` / `placement-target-blocked` / `link-config` /
`cycle-detected` / `single-parent`.

## `src/core/events.ts`

```ts
export interface EventEnvelope { topic: string; tick: number; seq: number; events: PreemptEvent[] }
export type PreemptEvent =
  | { type: 'state'; nodeId: NodeId; fork?: { forkKey: PathKey; nodeIds: NodeId[] }; status: CompileStatus }
  | { type: 'structure'; op: kind; nodeId: NodeId }
  | { type: 'diagnostic'; code: 'circular-source'; trace: PathKey }
export class EventBridge {
  subscribe(topic: string, fn: (e: EventEnvelope) => void): () => void
  push(topic: string, e: PreemptEvent): void
  flush(tick: number): void   // coalesces: ≤1 'state' event per node per tick; one envelope per topic
  readonly state: Set<NodeId>  // observable after flush only (W1–W5)
}
```
Coalescing + ordering rules per api.md §7 (W1–W5).

## Server (`src/server.ts`, not unit-tested)

`http.createServer` + `ws` WebSocketServer; exposes `ClientAPI`:
- `GET /health` → `200 {status:'ok'}`
- `POST /api/apply` `{op}` → serialized `ApplyStatus`
- `GET /api/state?node=<ref>` → `getState`
- WS `/ws` fanning `EventEnvelope`s to subscribers per topic.