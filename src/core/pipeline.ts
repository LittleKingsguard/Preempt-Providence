import { PipelineError, PipelineLockError } from './errors.js'
import type { EventEnvelope } from './events.js'
import type { RenderOp } from './render.js'
import type { Node } from './node.js'
import type { NodeId } from './types.js'

export { PipelineError, PipelineLockError }

export type PipelineStage =
  | 'instantiation'
  | 'targetPlacementResolution'
  | 'placementAssembly'
  | 'componentRouting'
  | 'componentAssembly'
  | 'slotAssembly'
  | 'preprocessing'
  | 'validation'
  | 'elementCreation'
  | 'treeAssembly'
  | 'postprocessing'

export type DropReason =
  | 'not-in-tree'
  | 'validation-failed'
  | 'prototype-terminated'
  | 'owner-terminated'
  | 'loop'
  | 'placement-target-blocked'

export type EmissionResult =
  | { kind: 'emitted'; renderOps: RenderOp[] }
  | { kind: 'dropped'; reason: DropReason }
  | { kind: 'forwarded'; to: PipelineStage }
  | { kind: 'deferred' }

export interface PipelineObserver {
  onStageStart?(stage: PipelineStage): void
  onStageComplete?(stage: PipelineStage, nodeId?: NodeId): void
  onError?(node: unknown, err: unknown): void
  onLoopGuardTrip?(stage: PipelineStage): void
}

export interface PipelineContext {
  readonly slice: Readonly<{
    root: NodeId
    scope: Readonly<{ kind: 'root' | 'node-local'; entry: NodeId | 'rootNode' }>
    states: ReadonlyMap<NodeId, unknown>
    forks: ReadonlyMap<string, unknown>
  }>
  readonly lock: SliceLock
  readonly supervisor: unknown
  readonly telemetry: readonly PipelineObserver[]
}

export interface PhaseWorker {
  readonly order: number
  emission(node: Node, ctx: PipelineContext): EmissionResult | Promise<EmissionResult>
  afterEach?(prev: Node, next: Node): void
}

export interface PhaseRegistryEntry {
  stage?: PipelineStage
  worker: PhaseWorker
  order: number
  summary: string
}

export interface PhaseRegistry {
  register(entry: PhaseRegistryEntry): void
  getWorker(stage: PipelineStage): PhaseWorker
  getPhaseNumber(stage: PipelineStage): number
  stages(): readonly PipelineStage[]
  docs(): string
}

const CANON_STAGES: ReadonlyArray<{ stage: PipelineStage; summary: string }> = [
  { stage: 'instantiation', summary: 'Rebuild manager: regenerates/restructures existing nodes via graph ops; owns pipeline-internal mutations.' },
  { stage: 'targetPlacementResolution', summary: 'Matches content targetPlacement requests to registered drop-zones; resolution expressed as placement-role anchors.' },
  { stage: 'placementAssembly', summary: 'Populates zones WITHOUT clone-instance decomposition (P3 §6.1): placement multiplicity is path-multiplicative — the §2 path-enumeration forks one state per zone of the chosen name; no attach + clone-instance on parent-child Links. The clone-instance op remains for RUNTIME/HANDLER-logic instantiation only (the fork-stress expansion bodies) — never the placement mechanism, never required by translate or the base engine.' },
  { stage: 'componentRouting', summary: 'Routes component emissions by resolution kind; cascades source updates to dependents.' },
  { stage: 'componentAssembly', summary: 'Resolves type components: structural sub-tree injection.' },
  { stage: 'slotAssembly', summary: 'Applies every non-type binding (content/handlers/props.*/css.*) as layers; never children.' },
  { stage: 'preprocessing', summary: 'Lifecycle hooks (before/afterPreprocess).' },
  { stage: 'validation', summary: 'Compile gate: tag-schema validation; every in-tree node flows through before rendering.' },
  { stage: 'elementCreation', summary: 'Emits declarative render ops through the RenderAdapter; one worker for SSR and client.' },
  { stage: 'treeAssembly', summary: 'Mount/order ops through the same adapter; fires afterRender.' },
  { stage: 'postprocessing', summary: 'before/afterPostprocess hooks; ends the pipeline when monitoring is off.' },
]

class Registry implements PhaseRegistry {
  private readonly byStage = new Map<PipelineStage, PhaseRegistryEntry>()
  private readonly byOrder = new Map<number, PhaseRegistryEntry>()

  register(entry: PhaseRegistryEntry): void {
    if (entry.stage !== undefined && this.byStage.has(entry.stage)) {
      throw new PipelineError('duplicate-registration')
    }
    if (this.byOrder.has(entry.order)) {
      throw new PipelineError('duplicate-registration')
    }
    if (entry.stage !== undefined) this.byStage.set(entry.stage, entry)
    this.byOrder.set(entry.order, entry)
  }

  getWorker(stage: PipelineStage): PhaseWorker {
    const entry = this.byStage.get(stage)
    if (!entry) throw new PipelineError('unknown-stage')
    return entry.worker
  }

  getPhaseNumber(stage: PipelineStage): number {
    const entry = this.byStage.get(stage)
    if (!entry) throw new PipelineError('unknown-stage')
    return entry.order
  }

  stages(): readonly PipelineStage[] {
    const sorted = this.sorted()
    return sorted.map((e) => e.stage).filter((s): s is PipelineStage => s !== undefined)
  }

  docs(): string {
    return this.sorted()
      .map((e) => `${e.order} ${e.stage ?? '(unnamed)'}: ${e.summary}`)
      .join('\n')
  }

  private sorted(): PhaseRegistryEntry[] {
    return [...this.byOrder.values()].sort((a, b) => a.order - b.order)
  }
}

export const canonical: PhaseRegistry = (() => {
  const registry = new Registry()
  CANON_STAGES.forEach(({ stage, summary }, index) => {
    const worker: PhaseWorker = {
      order: index,
      emission: () => ({ kind: 'emitted', renderOps: [] }),
    }
    registry.register({ stage, worker, order: index, summary })
  })
  return registry
})()

export type LockState = 'held' | 'resolving' | 'resolved' | 'released'

export class SliceLock {
  readonly sliceRoot: NodeId
  readonly maxDepth: number
  private lockState: LockState = 'held'
  private readonly visits = new Set<NodeId>()
  private readonly resolvedKeys = new Set<string>()

  constructor(sliceRoot: NodeId, opts?: { maxDepth?: number }) {
    this.sliceRoot = sliceRoot
    this.maxDepth = opts?.maxDepth ?? 4
    this.visits.add(sliceRoot)
  }

  get state(): LockState {
    return this.lockState
  }

  get visitSet(): ReadonlySet<NodeId> {
    return this.visits
  }

  recordVisit(id: NodeId): void {
    this.visits.add(id)
  }

  reenter(chainDepth: number): 'defer' | 'trip' {
    if (chainDepth + 1 > this.maxDepth) return 'trip'
    return 'defer'
  }

  beginResolution(): void {
    if (this.lockState === 'held') this.lockState = 'resolving'
  }

  resolveFork(key: string, _r: EmissionResult): void {
    if (this.lockState !== 'resolving') return
    this.resolvedKeys.add(key)
    if (key === this.sliceRoot || this.resolvedKeys.size >= 2) {
      this.lockState = 'resolved'
    }
  }

  unlock(): void {
    if (this.lockState === 'resolved') {
      this.lockState = 'released'
      return
    }
    if (this.lockState === 'released') {
      throw new PipelineLockError('double-unlock')
    }
    throw new PipelineLockError('unlock-before-resolution')
  }
}

export type QueueTask =
  | { kind: 'deferred-emission'; node: NodeId; stage: PipelineStage; chainDepth: number; origin: NodeId }
  | { kind: 'dirty-pass2'; dirty: Set<NodeId> }
  | { kind: 'cascade-destroy' }
  | { kind: 'event-batch'; batch: EventEnvelope }
  | { kind: 'render-emit'; ops: RenderOp[] }

export interface RenderMicrotaskQueue {
  enqueue(t: QueueTask): void
  schedule(): void
  readonly scheduled: boolean
}

const DRAIN_ORDER: QueueTask['kind'][] = [
  'deferred-emission',
  'dirty-pass2',
  'cascade-destroy',
  'event-batch',
  'render-emit',
]

export class MicrotaskQueue implements RenderMicrotaskQueue {
  private readonly buckets = new Map<QueueTask['kind'], QueueTask[]>()
  private dirtyNodes = new Set<NodeId>()
  private scheduledFlag = false

  get scheduled(): boolean {
    return this.scheduledFlag
  }

  enqueue(t: QueueTask): void {
    if (t.kind === 'dirty-pass2') {
      for (const id of t.dirty) this.dirtyNodes.add(id)
      return
    }
    const bucket = this.buckets.get(t.kind)
    if (bucket) bucket.push(t)
    else this.buckets.set(t.kind, [t])
  }

  schedule(): void {
    if (this.scheduledFlag) return
    this.scheduledFlag = true
    queueMicrotask(() => {
      this.scheduledFlag = false
      this.drain()
    })
  }

  drainOrder(): QueueTask['kind'][] {
    return [...DRAIN_ORDER]
  }

  drain(): void {
    for (const kind of this.drainOrder()) {
      if (kind === 'dirty-pass2') {
        this.dirtyNodes = new Set<NodeId>()
        continue
      }
      const bucket = this.buckets.get(kind)
      if (!bucket || bucket.length === 0) continue
      const snapshot = bucket.splice(0, bucket.length)
      for (const _t of snapshot) void _t
    }
  }
}