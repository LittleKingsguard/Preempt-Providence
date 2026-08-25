// src/core/supervisor.ts — the journaling mutation sink behind ClientAPI
// (api.md §1, §8): resolves ops, journals applied ones, drives pass-2
// compile + event emission, and supports replay/undo/redo.
//
// Depends on the Node class only through its public surface; `findCycle` is
// the sole runtime import from node.js (used at call time, so the circular
// import between the two modules is safe).
import { findCycle, reconcileParentTargets, Node } from './node.js'
import type { Node as NodeType } from './node.js'
import { Link } from './link.js'
import { CycleError, SingleParentError } from './errors.js'
import { EventBridge } from './events.js'
import { createClient } from './client.js'
import type { ClientAPI } from './client.js'
import { makeHandlerContext, dispatchPhase, dispatchPhaseForNodes, dispatchEvent } from './handlers.js'
import type { HandlerContext, HandlerPhase, HandlerResult } from './handlers.js'
import { unregisterContentNode, resolveNodeRef, evictDestroyedNode, onNodeFinalized, markCascadeExplicit, mintedByOrigin, drainPendingDestroy, defRootPrototypeEntries, defPrototypeEntries } from './registry.js'
import { placementChangeIrrelevant, activePlacementOf, hookWriteGuard } from './resolve.js'
import { placementAttach, derivePlacementTrigger, detachNodeSafe, layerApply, rowsMint, rowsClear } from './ops.js'
import { serializeSlice, loadState, reRegisterDefPrototypes } from './serialize.js'
import type { Anchor, CompiledState, LinkConfigNameHub, NodeId, NodeState, PlacementTrigger, RowsMintOp } from './types.js'

let journalSeq = 0

/**
 * Bounded pass-2 slice for one changed node: the node itself, its ancestor
 * chain and its subtree — the walk path. PLUS, only when the walk path
 * carries a target AND the tree cannot answer from its per-name component
 * Links, the source/duplex-bearing universe (the fallback — prototype/
 * contentNodes-owned providers must stay discoverable so arms terminate
 * with the right drop reason).
 *
 * The per-name component Link IS the registry of nodes relevant for a
 * target (anchors carry their owner backref — resolve.ts reads providers
 * straight off the Link). A shared-hub tree therefore needs NO universe in
 * the slice at all — sweeping every provider in the graph into every dirty
 * node's slice is pure O(n) overhead per pass, pathological when every node
 * is a self-providing provider (values/link-only stress pages: 4094 dirty
 * nodes × 4095-node slices). Hub-less trees (same-name anchors on private
 * links) keep the status-quo sweep, still gated on targets + lazily
 * materialized.
 */
export function focusedSliceFor(node: Node, all: Node[] | (() => Node[])): Node[] {
  const set = new Map<NodeId, Node>()
  for (let cur: Node | null = node; cur; cur = cur.parent) set.set(cur.id, cur)
  const stack: Node[] = [...node.children]
  while (stack.length > 0) {
    const d = stack.pop()!
    set.set(d.id, d)
    stack.push(...d.children)
  }
  const pathHasTarget = [...set.values()].some(n =>
    n.anchors.some(a => a.role === 'target' && typeof a.target === 'string'),
  )
  if (pathHasTarget) {
    const names = new Set<string>()
    for (const n of set.values()) {
      for (const a of n.anchors) {
        if (a.role === 'target' && typeof a.target === 'string') names.add(a.target)
      }
    }
    let hubAnswers = false
    const hub = node.hubFor
    if (hub) {
      for (const name of names) {
        if (hub.linkFor(name, 'component').anchors.length > 0) hubAnswers = true
      }
    }
    if (!hubAnswers) {
      // hub-less / unshared-link trees: the fallback can only answer from
      // the slice — sweep the providers in (status quo, target-gated)
      const universe = typeof all === 'function' ? all() : all
      for (const n of universe) {
        if (set.has(n.id)) continue
        if (n.anchors.some(a => (a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string')) {
          set.set(n.id, n)
        }
      }
    }
  }
  return [...set.values()]
}

export interface JournalEntry {
  id: string
  op: { kind: string; [key: string]: unknown }
  result: { status: string; [key: string]: unknown }
}

/** Shared-host dispatch report (ssr-synthetic-event.md §3.1). */
export interface DispatchReport {
  results: HandlerResult[]
  dirtied: NodeId[]
}

/** Options for `dispatchAndReport` — the opt-in bounded `requestId` dedup. */
export interface DispatchOptions {
  requestId?: string
}

/** One bounded-LRU window entry (requestId → (target, event) pair + report). */
interface DispatchDedupEntry {
  target: NodeId | string
  event: string
  /** the FIRST caller's in-flight promise — pending duplicates await this */
  inFlight: Promise<DispatchReport> | undefined
  /** the settled report — duplicates after completion echo this (TTL'd) */
  settled: DispatchReport | undefined
  ts: number
}

export class Supervisor {
  readonly journal: JournalEntry[] = []
  private readonly nodes: Map<NodeId, Node>
  /** REQ-GAP-11 — the destroyed-ref tombstone (PRIVATE, handoffs-review-2
   *  §REQ-GAP-11): destroyed nodes leave `this.nodes` (allNodes() = the
   *  live-tree scan the handoff complains about) but keep resolving here so
   *  stale ids still gate `no-usable-state` (never `unknown-node`), repeated
   *  retention lookups keep working, and dispatchEvent on destroyed targets
   *  stays `[]`. Destroyed is terminal, so entries are never removed; the
   *  tombstone is never scanned (allNodes / pass-2 / focusedSlice read
   *  `this.nodes` only). */
  private readonly destroyedRefs = new Map<NodeId, Node>()
  private readonly hub: LinkConfigNameHub | null
  readonly events: EventBridge | null
  private undoStack: JournalEntry[] = []
  private redoStack: JournalEntry[] = []
  private client: ClientAPI | null = null
  private handlerCtx: HandlerContext | null = null
  /** Feature 3 (handoffs-review-8.md, ruling 17) — the condense trigger:
   *  absent = never; a journal length above it schedules a deferred condense
   *  (D5). Read-only once constructed. */
  private readonly maxJournalLength: number | undefined
  private condenseScheduled = false

  constructor(rootOrOpts: Node | { hub?: LinkConfigNameHub; events?: EventBridge; maxJournalLength?: number }, nodes?: Map<NodeId, Node>) {
    this.hub = null
    this.events = null
    this.maxJournalLength = undefined
    if (rootOrOpts !== null && typeof rootOrOpts === 'object' && (rootOrOpts as { isNode?: boolean }).isNode === true) {
      const root = rootOrOpts as Node
      this.nodes = nodes ?? new Map<NodeId, Node>()
      this.nodes.set(root.id, root)
    } else {
      const opts = rootOrOpts as { hub?: LinkConfigNameHub; events?: EventBridge; maxJournalLength?: number }
      this.nodes = new Map<NodeId, Node>()
      this.hub = opts.hub ?? null
      this.events = opts.events ?? null
      this.maxJournalLength = opts.maxJournalLength
    }
    // REQ-GAP-11 — the sweep-hook seam: cascade-finalized nodes (the sweep's
    // own finalization, terminal) leave this supervisor's scan surfaces too.
    // Guarded by INSTANCE ownership: only a node this supervisor actually
    // holds is tombstoned here — the id-keyed delete would otherwise remove a
    // DIFFERENT graph's re-seeded node sharing the same id (the smoke runs
    // several loadState-re-seeded graphs in one process with shared ids).
    onNodeFinalized((node) => {
      if (this.nodes.get(node.id) === node) {
        this.nodes.delete(node.id)
        this.destroyedRefs.set(node.id, node)
      }
    })
  }

  getNode(id: NodeId): Node | undefined {
    return this.nodes.get(id) ?? this.destroyedRefs.get(id)
  }

  allNodes(): Node[] {
    return [...this.nodes.values()]
  }

  registerNode(node: Node): void {
    this.nodes.set(node.id, node)
  }

  /** Lazily-built client API for handler contexts. */
  get clientAPI(): ClientAPI {
    this.client ??= createClient(this)
    return this.client
  }

  /** Handler context exposing the mutation channel + tree search. */
  get handlerContext(): HandlerContext {
    this.handlerCtx ??= makeHandlerContext(this, this.clientAPI)
    return this.handlerCtx
  }

  /** Run a phase's handlers on one node (or all registered nodes if omitted). */
  runPhase(phase: HandlerPhase, nodeId?: NodeId): void {
    if (nodeId !== undefined) {
      const node = this.nodes.get(nodeId)
      if (node) dispatchPhase(node, this.handlerContext, phase)
      return
    }
    dispatchPhaseForNodes(this.allNodes(), this.handlerContext, phase)
  }

  /** Internal: dispatch a phase on one node (contained errors, reentrancy-guarded). */
  private dispatchingPhases = new Set<string>()

  private runPhaseOnNode(phase: HandlerPhase, node: Node): void {
    const key = `${phase}:${node.id}`
    if (this.dispatchingPhases.has(key)) return
    this.dispatchingPhases.add(key)
    try {
      dispatchPhase(node, this.handlerContext, phase)
    } finally {
      this.dispatchingPhases.delete(key)
    }
  }

  /** Phase A (2026-08-20 — event-dispatch-wiring-review.md): the EVENT-dispatch
   *  engine entry — the sibling of `runPhase` for events. Resolves a target
   *  (a Node instance / a nodeId / a wire string) to a live Node and runs
   *  `dispatchEvent(node, handlerContext, event, ...args)`, REUSING the
   *  existing containment (throwing bodies land in the results list) + the
   *  per-dispatch node/states enrichment (handlers.ts `scopedFor`) + the
   *  managed mutation channel (bodies mutate only via clientAPI.apply).
   *  Pins (review + handlers.md §3): dispatch is a TRIGGER, never a journal
   *  entry; it never drains pass-2 states, never flushes applies (the
   *  microtask flush owns a body's apply effects) and never emits EventBridge
   *  events — a host awaits the flush before asserting; NO propagation
   *  (target handlers only); unknown / destroyed / unplaced targets return []
   *  (mirror of runPhase's unknown-id no-op, but events RETURN results).
   *  Wire resolution: full string first (a nodeId), then the first-`#` prefix
   *  (fork-arm wires are `<nodeId>#<i>`, render-helpers §4.1); a fork-arm
   *  dispatch fires the NODE's handlers once, all arms visible in ctx.states.
   *  Reentrancy: a nested dispatch of the SAME (node, event) no-ops via the
   *  dispatchingEvents guard. The DomAdapter.onEvent seam stays the page-side
   *  path — the decoupling pin is unchanged. */
  private dispatchingEvents = new Set<string>()

  dispatchEvent(target: Node | NodeId | string, event: string, ...args: unknown[]): HandlerResult[] {
    const node = typeof target === 'string' ? this.resolveDispatchTarget(target) : target
    if (!node || node.destroyed || node.state === 'unplaced') return []
    const key = `event:${event}:${node.id}`
    if (this.dispatchingEvents.has(key)) return []
    this.dispatchingEvents.add(key)
    try {
      return dispatchEvent(node, this.handlerContext, event, ...args)
    } finally {
      this.dispatchingEvents.delete(key)
    }
  }

  /** Resolve a dispatch-target string to a live node: the FULL string as a
   *  nodeId first (so a `#`-bearing node id wins over the arm grammar), then
   *  the first-`#` prefix (fork-arm wire `<nodeId>#<i>`). */
  private resolveDispatchTarget(target: string): Node | undefined {
    const exact = this.nodes.get(target)
    if (exact) return exact
    const hash = target.indexOf('#')
    if (hash !== -1) return this.nodes.get(target.slice(0, hash))
    return undefined
  }

  /** PUBLIC deterministic settle (2026-08-21 — user ruling D2,
   *  ssr-synthetic-event.md §2.6): awaits the pass-2 flush cascade to
   *  completion — `while (hasPendingWork()) await oneTaskBoundary`. The
   *  microtask flush cascade is bounded, so the settle is deterministic
   *  without magic tick counts. `hasPendingWork` is a NON-draining probe —
   *  this never consumes the renderer's takePass2States snapshot. The
   *  never-flush-on-dispatch pin is about the ENGINE (dispatchEvent never
   *  flushes internally); a host-called flush is exactly what the pins
   *  assume exists. */
  async flush(): Promise<void> {
    while (this.hasPendingWork()) {
      await new Promise((r) => setTimeout(r, 0))
    }
  }

  /** Shared-host dispatch report surface (2026-08-21 — ssr-synthetic-event.md
   *  §3, handoffs-review REQ-GAP-4): the ADDITIVE async sibling of
   *  `dispatchEvent` (which stays UNCHANGED — sync, HandlerResult[]).
   *  Resolution + guards are identical (wire/nodeId resolution,
   *  destroyed/unplaced → empty report, same-(node,event) reentrancy no-ops
   *  through the SAME dispatchingEvents key — a nested dispatchAndReport
   *  inside a body no-ops like a nested dispatchEvent). Flush-before-response:
   *  awaits `flush()` internally, then takes pass-2 states as the report's
   *  caller, then returns. `dirtied` = ∪(result.dirtied of journal entries
   *  appended DURING this dispatch — the new-entry span j0→length, bounded;
   *  the whole-journal snapshot derivation is REJECTED) ∪ keys(states).
   *  `options.requestId` = OPT-IN bounded LRU dedup, registered SYNCHRONOUSLY
   *  at call entry (before any await): a duplicate within the window (same
   *  requestId AND same (target, event)) returns the FIRST caller's report —
   *  awaiting the in-flight promise if pending, else the settled report
   *  (idempotent ECHO). A requestId reused with a DIFFERENT (target, event)
   *  is a host error: warn + treat as a miss. NOT journaled, process-local
   *  (dies on loadState/restart — correct); best-effort under LRU/TTL
   *  pressure; zero cost when requestId is absent. */
  dispatchAndReport(
    target: Node | NodeId | string,
    event: string,
    options: DispatchOptions = {},
    ...args: unknown[]
  ): Promise<DispatchReport> {
    const requestId = options.requestId
    const node = typeof target === 'string' ? this.resolveDispatchTarget(target) : target
    const targetKey = node ? node.id : (typeof target === 'string' ? target : String(target))
    if (requestId !== undefined) {
      const hit = this.dispatchDedup.get(requestId)
      if (hit && Date.now() - hit.ts <= Supervisor.DEDUP_TTL_MS) {
        if (hit.target === targetKey && hit.event === event) {
          return hit.inFlight ?? Promise.resolve(hit.settled!)
        }
        console.warn(`[supervisor] requestId "${requestId}" reused with a different (target, event); treating as a fresh dispatch`)
      }
    }
    if (!node || node.destroyed || node.state === 'unplaced') {
      const empty: DispatchReport = { results: [], dirtied: [] }
      if (requestId !== undefined) this.recordDedup(requestId, { target: targetKey, event, inFlight: undefined, settled: empty, ts: Date.now() })
      return Promise.resolve(empty)
    }
    const key = `event:${event}:${node.id}`
    if (this.dispatchingEvents.has(key)) {
      const empty: DispatchReport = { results: [], dirtied: [] }
      if (requestId !== undefined) this.recordDedup(requestId, { target: targetKey, event, inFlight: undefined, settled: empty, ts: Date.now() })
      return Promise.resolve(empty)
    }
    const j0 = this.journal.length
    const run = async (): Promise<DispatchReport> => {
      this.dispatchingEvents.add(key)
      let results: HandlerResult[]
      try {
        results = dispatchEvent(node, this.handlerContext, event, ...args)
      } finally {
        this.dispatchingEvents.delete(key)
      }
      await this.flush()
      const states = this.takePass2States()
      const dirtied = new Set<NodeId>()
      for (let i = j0; i < this.journal.length; i++) {
        const d = this.journal[i]!.result.dirtied
        if (Array.isArray(d)) for (const id of d) dirtied.add(id as NodeId)
      }
      for (const id of states.keys()) dirtied.add(id)
      return { results, dirtied: [...dirtied] }
    }
    if (requestId !== undefined) {
      const entry: DispatchDedupEntry = { target: targetKey, event, inFlight: undefined, settled: undefined, ts: Date.now() }
      const promise = run()
      entry.inFlight = promise
      promise.then(
        (report) => {
          entry.inFlight = undefined
          entry.settled = report
          entry.ts = Date.now()
        },
        () => {
          this.dispatchDedup.delete(requestId)
        },
      )
      this.recordDedup(requestId, entry)
      return promise
    }
    return run()
  }

  /** OPT-IN requestId dedup window (ssr-synthetic-event.md §3.3): bounded LRU
   *  (cap ~128 entries + ~10s TTL), process-local, NOT journaled. */
  private static readonly DEDUP_CAP = 128
  private static readonly DEDUP_TTL_MS = 10_000
  private readonly dispatchDedup = new Map<string, DispatchDedupEntry>()

  private recordDedup(requestId: string, entry: DispatchDedupEntry): void {
    // recency move: delete+set keeps the Map's iteration order an LRU order
    this.dispatchDedup.delete(requestId)
    this.dispatchDedup.set(requestId, entry)
    if (this.dispatchDedup.size > Supervisor.DEDUP_CAP) {
      const oldest = this.dispatchDedup.keys().next().value
      if (oldest !== undefined) this.dispatchDedup.delete(oldest)
    }
  }

  /**
   * Bounded pass-2 slice: the changed node's walk path + (only when the path
   * carries a target) the lazily-materialized provider universe.
   */
  private focusedSlice(node: Node): Node[] {
    return focusedSliceFor(node, () => this.allNodes())
  }

  /** Compiled states produced by pass-2 since the last take — the renderer
   *  consumes these instead of recompiling (with the flush awaited, every
   *  dirty node's compile has already resolved). */
  private pass2States = new Map<NodeId, CompiledState[]>()

  /** Non-draining mirror of pass2States: last-known pass-2 states per node
   *  (grouped per node, fork arms preserved). Handlers read this via
   *  getResolvedStates / Node.resolved — it must NEVER be drained, and must
   *  never consume the renderer's snapshot. */
  private resolvedStates = new Map<NodeId, CompiledState[]>()

  takePass2States(): Map<NodeId, CompiledState[]> {
    const out = this.pass2States
    this.pass2States = new Map<NodeId, CompiledState[]>()
    return out
  }

  /** HARNESS settle-check (2026-08-16) — is the pass-2 pipeline still
   *  holding work (a scheduled flush, dirty nodes, pending placement
   *  triggers)? NON-draining — the renderer's takePass2States stays the
   *  drain. Lets a page harness replace blind timer-yield bursts (8×
   *  setTimeout(0)) with an adaptive settle loop: the flush cascade is
   *  microtask-bound, so one task boundary drains it; the check confirms
   *  completion without consuming state. */
  hasPendingWork(): boolean {
    return this.flushScheduled || this.pass2Dirty.size > 0 || this.pendingTriggers.size > 0
  }

  /** TIMING (2026-08-16) — the SYNCHRONOUS pass-2 engine work accumulated
   *  across flushes (measured around runPass2AndFlush only, excluding the
   *  scheduler windows a page harness's awaits occupy). A profile can split
   *  its wall-time pass2Ms into engine work (this) vs scheduler idle
   *  (pass2Ms − this): the fork-stress pages' flush cascades run inside the
   *  await windows, so a wall-only number cannot tell the two apart. */
  private flushWorkMs = 0

  pass2WorkMs(): number {
    return this.flushWorkMs
  }

  /** Group compiled states per node (fork arms preserved per node). */
  private groupByNode(actionable: CompiledState[]): Map<NodeId, CompiledState[]> {
    const grouped = new Map<NodeId, CompiledState[]>()
    for (const cs of actionable) {
      const g = grouped.get(cs.nodeId) ?? []
      g.push(cs)
      grouped.set(cs.nodeId, g)
    }
    return grouped
  }

  /** Write grouped pass-2 states into the non-draining resolved store and
   *  through to each node's read-only `resolved` cache. */
  private storeResolved(grouped: Map<NodeId, CompiledState[]>): void {
    for (const [id, arr] of grouped) {
      this.resolvedStates.set(id, arr)
      const n = this.nodes.get(id)
      if (n && !n.destroyed) n.__setResolved(arr)
    }
  }

  /** Seed the resolved store from a bootstrap compile's actionable states —
   *  the demos' bootstrap compiles the root DIRECTLY (bypassing the
   *  supervisor), so callers must recordResolved(cr.actionable) after that
   *  full compile. Groups per node and writes through node.resolved. This
   *  NEVER touches pass2States and never drains. */
  recordResolved(actionable: CompiledState[]): void {
    this.storeResolved(this.groupByNode(actionable))
  }

  /** Non-draining getter: a node's last-known pass-2 compiled states
   *  (grouped, fork arms preserved) or []. Returns a shallow copy so callers
   *  cannot mutate the store. */
  getResolvedStates(id: NodeId): CompiledState[] {
    return [...(this.resolvedStates.get(id) ?? [])]
  }

  private eventTick = 0
  private flushScheduled = false
  private pass2Dirty = new Set<NodeId>()
  /** P3 §1.2/§3.3 (C-2, 10.ac.2 #7) — the update trigger identity carried from
   *  `supervisor.apply` into the pass-2 dispatch: which placement link changed
   *  and how. Set by placement-affecting ops for their dirty nodes; consumed
   *  (and cleared) by the runPass2AndFlush relevance pre-check. */
  private pendingTriggers = new Map<NodeId, PlacementTrigger>()

  private emitStructure(opKind: string, nodeId: NodeId): void {
    if (!this.events) return
    this.events.push('structure', { type: 'structure', op: opKind as never, nodeId })
    this.scheduleFlush()
  }

  private markPass2(nodeId: NodeId, trigger?: PlacementTrigger): void {
    this.pass2Dirty.add(nodeId)
    if (trigger) this.pendingTriggers.set(nodeId, trigger)
    this.scheduleFlush()
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return
    this.flushScheduled = true
    queueMicrotask(() => {
      this.flushScheduled = false
      const t0 = performance.now()
      this.runPass2AndFlush()
      this.flushWorkMs += performance.now() - t0
    })
  }

  private runPass2AndFlush(): void {
    const dirty = [...this.pass2Dirty]
    this.pass2Dirty.clear()
    if (dirty.length > 0) {
      for (const nodeId of dirty) {
        const node = this.nodes.get(nodeId)
        if (!node || node.destroyed) {
          this.pendingTriggers.delete(nodeId)
          continue
        }
        // slice/compile-mode switch (placement-path-spec §2.1/§6.2): a dirty
        // node that is placement-routed (carries `content` anchors) compiles
        // through the path-enumeration mode — per-path states, node-local
        // (E2E-2: only this node's path-states regenerate). Non-placement
        // nodes keep the bounded focused-slice compile unchanged.
        const placementRouted = node.anchors.some(a => a.role === 'content')
        // P3 §1.2/§3.3 (C-2) — the silent abort, evaluated BEFORE node.compile:
        // the update trigger identity (which placement link changed) gates
        // placement-routed nodes — "can the changed link alter this node's
        // first-match choice?" (chosenName from the node's LAST states'
        // activePlacement). Irrelevant ⇒ skip the compile ENTIRELY: no state
        // regeneration, no events, no dirty residue.
        const trigger = this.pendingTriggers.get(nodeId)
        this.pendingTriggers.delete(nodeId)
        if (placementRouted && trigger && trigger.kind === 'placement') {
          const chosenName = activePlacementOf(this.resolvedStates.get(nodeId) ?? [])
          if (placementChangeIrrelevant(node, chosenName, trigger.linkName)) continue
        }
        const cr = placementRouted
          ? node.compilePath()
          : node.compile(this.focusedSlice(node), { focusNodeId: nodeId })
        // hand the fresh compiled states to the renderer (no recompile there).
        // Group fork arms per compile result, then REPLACE per node — a later
        // dirty node's compile (e.g. a descendant's own pass) supersedes the
        // walk-path copy produced by an ancestor's pass.
        const grouped = this.groupByNode(cr.actionable)
        for (const [id, arr] of grouped) this.pass2States.set(id, arr)
        // also mirror into the non-draining resolved store (handlers/read-only
        // access) + write through to each node's `resolved` cache
        this.storeResolved(grouped)
        // after-compile (before render): phase handlers see the fresh compile
        this.runPhaseOnNode('after-compile', node)
        if (this.events) {
          for (const cs of cr.actionable) {
            if (cs.nodeId !== nodeId) continue
            let status: string = 'ok'
            if (cs.unresolved.length > 0) status = 'unresolved-reference'
            // §9-Q3 (R2-Q6/C-6) — the `#f` gate re-expressed: EVERY path-state
            // (forkKey present = pathKey, set unconditionally at mint) emits
            // for its path — {forkKey: pathKey, nodeIds: trace}; there is no
            // `#f`-grammar dependency left (path-states' keys are placement
            // pathKeys; the W2 (nodeId, forkKey) dedup keys are path-unique).
            const fork = cs.forkKey !== undefined
              ? { forkKey: cs.forkKey, nodeIds: cs.trace ?? [cs.nodeId] }
              : undefined
            this.events.push('state', { type: 'state', nodeId: cs.nodeId, status: status as never, fork: fork as never })
          }
          for (const d of cr.dropped) {
            if (d.reason === 'loop' && d.arm[0] === nodeId) {
              this.events.push('diagnostic', { type: 'diagnostic', code: 'circular-source', trace: (node.pathKey || node.id) as never })
            }
          }
        }
      }
    }
    this.eventTick++
    this.events?.flush(this.eventTick)
    // after-render: the tick's events have been emitted (destroyed nodes skip)
    for (const nodeId of dirty) {
      const node = this.nodes.get(nodeId)
      if (node && !node.destroyed) this.runPhaseOnNode('after-render', node)
    }
  }

  private journalIfApplied(op: { kind: string; [key: string]: unknown }, result: { status: string; [key: string]: unknown }): JournalEntry | null {
    if (result.status !== 'applied') return null
    const { kind, ...rest } = op
    const entry: JournalEntry = { id: `journal-${journalSeq++}`, op: { kind, ...rest }, result }
    // INTERNAL no-journal mode (redo/replay — handoffs-review-4.md §3c): the
    // caller refreshes the ORIGINAL entry's result in place; a suppressed
    // apply must not grow the journal.
    if (this.suppressJournal) return entry
    this.journal.push(entry)
    this.undoStack.push(entry)
    this.redoStack = []
    // Feature 3 (ruling 17, D5) — the O(1) condense trigger: a journal above
    // the configured length schedules a DEFERRED condense (microtask — never
    // an inline O(graph) serialize in apply's hot path; D5). Suppressed
    // applies (redo/replay) never trigger it — the journal is not growing.
    if (this.maxJournalLength !== undefined && this.journal.length > this.maxJournalLength) {
      this.scheduleCondense()
    }
    return entry
  }

  /** Feature 3 (D5) — schedule the deferred condense ONCE (a microtask); the
   *  condense itself runs after the triggering op returns, so a tight apply
   *  loop never blocks on the O(graph) serialize. */
  private scheduleCondense(): void {
    if (this.condenseScheduled) return
    this.condenseScheduled = true
    setTimeout(() => {
      this.condenseScheduled = false
      this.condense()
    }, 0)
  }

  /** Feature 3 (D5/D6/D7) — the condense: build the base snapshot (the
   *  round-trip recipe, D1), size-guard (D5), and rewrite the journal to ONE
   *  base marker. Failure-contained (D5): a serialize throw aborts with a
   *  `condense-aborted` warn and the journal is UNTOUCHED. */
  /** Feature 3 (D5) — the honest memory-win guard: a base ≥ the journal it
   *  replaces is a regression; warn + skip (the host raises the threshold).
   *  Sizes are ESTIMATED with a circular-safe walk. LIVE node references
   *  (op.node / op.target) count as a fixed O(1) pointer — the journal's
   *  actual memory is the DATA payloads, not the graph they reference (which
   *  the base ALSO captures; recursing into the node graph would double-count
   *  it and make the guard never skip). */
  private static estBytes(v: unknown, seen: Set<object> = new Set()): number {
    if (v === null || v === undefined) return 4
    const t = typeof v
    if (t === 'string') return (v as string).length
    if (t === 'number' || t === 'boolean') return 8
    if (t === 'function') return String(v).length
    if (t === 'object') {
      if (seen.has(v as object)) return 4 // circular ref — counted once
      // a LIVE NODE (op.node / op.target) — count as an O(1) pointer; the
      // graph it owns is captured by the base, not the journal payload
      if ((v as { isNode?: boolean }).isNode === true) return 8
      seen.add(v as object)
      if (Array.isArray(v)) {
        let n = 4
        for (const e of v) n += Supervisor.estBytes(e, seen)
        return n
      }
      let n = 8
      for (const [, val] of Object.entries(v as Record<string, unknown>)) n += Supervisor.estBytes(val, seen)
      return n
    }
    return 8
  }

  private condense(): void {
    if (this.journal.length === 0) return
    const preLen = this.journal.length
    try {
      const root = this.allNodes().find((n) => {
        const child = n.childAnchor()
        if (!child) return false
        const pa = child.link.anchorsOf('parent')[0]
        return pa !== undefined && pa.target === 'rootNode'
      })
      if (!root) return
      // D8 — the capture slice = allNodes() ∪ the def-prototype registry
      // (plain prototypes stay OUT of this.nodes by design — serialize.md §3
      // step 5; the census must still ship them so the restore re-registers
      // them and a post-restore rows-mint by name resolves). ADV-S12 — the
      // pull is GRAPH-FILTERED: prototypes built on a DIFFERENT hub (another
      // graph in this process) must not leak into this base (the census is
      // instance-membership-scoped to THIS graph's nodes).
      const protoSet = new Set<Node>()
      for (const [, protos] of defPrototypeEntries()) for (const p of protos) if (p.hubFor === this.hub) protoSet.add(p)
      for (const [, r] of defRootPrototypeEntries()) if (r.hubFor === this.hub) protoSet.add(r)
      const kids = this.allNodes()
      for (const p of protoSet) if (p !== root) kids.push(p)
      const snapshot = serializeSlice(root, kids) as never
      const baseBytes = Supervisor.estBytes(snapshot)
      const journalBytes = Supervisor.estBytes(this.journal.slice(0, preLen))
      if (baseBytes >= journalBytes) {
        console.warn(`condense-skipped-size at journal-${journalSeq}: base ${baseBytes}B >= pre-base journal ${journalBytes}B; no rewrite (raise maxJournalLength)`)
        return
      }
      const marker: JournalEntry = {
        id: `journal-${journalSeq++}`,
        op: { kind: 'base', snapshot },
        result: { status: 'base' },
      }
      // D6 — the rewrite: ONE base marker replaces the pre-base entries; the
      // marker is NEVER pushed to undoStack; redoStack clears (a pre-base
      // entry lingering there would double-apply); undoStack truncates to the
      // post-base entries.
      this.journal.splice(0, preLen, marker)
      const baseIds = new Set(this.journal.slice(1).map((e) => e.id))
      this.undoStack = this.undoStack.filter((e) => baseIds.has(e.id))
      this.redoStack = []
    } catch (e) {
      // D5 — failure containment: never a partial rewrite
      console.warn(`condense-aborted: ${(e as Error)?.message ?? String(e)}; journal untouched`)
    }
  }

  /** Feature 3 (D4) — the SYNCHRONOUS graph-REPLACE restore: drain the
   *  pending-destroy queue + evict the pre-base nodes, clear this.nodes, run
   *  the §3 recipe (loadState → seed with the SAME hub → reconcileParentTargets
   *  → reRegisterDefPrototypes → registerNode per node → re-mint rows per the
   *  batches records), then schedule a FULL pass-2 refresh. The async sweep
   *  cannot interleave (the drain ran synchronously). Re-runnable: a second
   *  restore drains the first restore's nodes the same way. */
  private _restoreBase(snapshot: { template: unknown; content: unknown[]; clientConfig?: unknown }): void {
    // step 1 — drain + evict every pre-base node (synchronous critical section)
    drainPendingDestroy()
    for (const n of [...this.nodes.values()]) {
      evictDestroyedNode(n)
      this.nodes.delete(n.id)
    }
    this.destroyedRefs.clear()
    // step 2 — the §3 recipe (D1: the round-trip, executed in-process).
    // The template (root) seeds FIRST, then the content states (the §3
    // ordering — a def-root must precede its def-children).
    const hub = this.hub
    if (!hub) return
    const doc = snapshot as unknown as { template: unknown; content: unknown[] }
    const seeds: Node[] = []
    seeds.push(new Node(doc.template as never, hub))
    for (const d of loadState(doc as never)) seeds.push(new Node(d as never, hub))
    reconcileParentTargets(seeds)
    reRegisterDefPrototypes(doc as never, hub, seeds as never[])
    for (const n of seeds) this.registerNode(n)
    // step 3 — re-mint rows per the batches records (step 4.5 of the §3
    // recipe; fresh ids — the serialize.md §4 residual). Runs with the
    // journal suppressed — the restore must not grow the journal.
    for (const n of seeds) {
      const batches = (n as unknown as { batches?: Record<string, { prototypeName: string; mintKind?: string; placementName?: string; keyField?: string; rows: unknown[] }> }).batches
      if (!batches) continue
      for (const [hookName, rec] of Object.entries(batches)) {
        this.apply({
          kind: 'rows-mint',
          target: n,
          hookName,
          mintKind: rec.mintKind ?? 'component',
          prototypeName: rec.prototypeName,
          ...(rec.placementName !== undefined ? { placementName: rec.placementName } : {}),
          ...(rec.keyField !== undefined ? { keyField: rec.keyField } : {}),
          rows: rec.rows,
          sourceName: 'condense-restore',
        } as never, { journal: false, quiet: true })
      }
    }
    // step 4 — the full pass-2 refresh: every restored node is remote-dirty,
    // so the renderer sees a consistent window (no stale compiled states).
    for (const n of seeds) {
      n.markDirty('remote')
      this.markPass2(n.id)
    }
  }

  /** INTERNAL (handoffs-review-4.md §3c — redo/replay use it): re-apply an op
   *  WITHOUT journaling a new entry (the caller refreshes the original
   *  entry's `result` in place instead). The public `apply` signature is
   *  unchanged; `opts` is underscored-internal. */
  private suppressJournal = false
  /** ADV-S5 (2026-08-25 adversarial pass) — the internal restore re-mint is a
   *  QUIET graph-REPLACE: `_restoreBase` runs rows-mint through `apply` with
   *  `quiet:true`, which suppresses the before-compile phase handlers + the
   *  `structure` event (a restore must not fire side effects the journal does
   *  not record). Mirrors `suppressJournal`. */
  private quietApply = false
  apply(op: { kind: string; node?: Node; [key: string]: unknown }, opts?: { journal?: boolean; skipKindGate?: boolean; quiet?: boolean }): {
    status: 'applied' | 'no-usable-state' | 'rejected'
    journalId?: string
    dirtied?: NodeId[]
    nodeState?: string
    error?: { code: string; detail?: unknown }
    minted?: NodeId[]
    sliceLayers?: string[]
    hookUndo?: { name: string; preValue: unknown; created: boolean; cleared: boolean }[]
    reused?: NodeId[]
    removed?: { key: unknown; nodeId: string }[]
    preRecord?: { prototypeName: string; rows: unknown[]; layerId: string; mintKind: string; placementName?: string; keyField?: string } | null
  } {
    const node = op.node as Node | undefined
    const prevSuppress = this.suppressJournal
    if (opts?.journal === false) this.suppressJournal = true
    const prevQuiet = this.quietApply
    if (opts?.quiet) this.quietApply = true
    if (!node && op.kind !== 'clone-instance' && op.kind !== 'layer-apply' && op.kind !== 'rows-mint' && op.kind !== 'rows-clear') {
      this.suppressJournal = prevSuppress
      return { status: 'rejected', error: { code: 'unknown-node' } }
    }

    // ADVERSARIAL-S1/S2 (2026-08-24) — the rows ops carry `op.target` (not
    // `op.node`) and BYPASS id-resolution (the `!node && ...` skip above):
    // validate it here so a malformed (string / absent) target is a CONTAINED
    // `unknown-node` rejection (never an uncaught TypeError escaping apply,
    // never a silent `applied` no-op) and a DESTROYED target is a contained
    // `no-usable-state` (never an uncaught destroyed-write throw, never a
    // mint under a dead parent).
    if (op.kind === 'rows-mint' || op.kind === 'rows-clear') {
      const t = op.target as Node | undefined
      if (!t || typeof t !== 'object' || typeof (t as { id?: unknown }).id !== 'string') {
        this.suppressJournal = prevSuppress
        return { status: 'rejected', error: { code: 'unknown-node' } }
      }
      if (t.destroyed) {
        this.suppressJournal = prevSuppress
        return { status: 'no-usable-state', nodeState: 'destroyed' }
      }
    }

    // before-compile: phase handlers run before the op executes (and its
    // compile/apply happens). Errors are contained by dispatchPhase. A QUIET
    // apply (the restore re-mint, ADV-S5) skips them — a restore is an
    // internal graph-REPLACE, not a user op.
    const phaseTarget = op.kind === 'layer-apply' || op.kind === 'rows-mint' || op.kind === 'rows-clear' ? (op.target as Node | undefined) : node
    if (phaseTarget && !this.quietApply) this.runPhaseOnNode('before-compile', phaseTarget)

    try {
      if (op.kind === 'state-slice') {
        const mutation = op.mutation as { targetProp: string; mode: string; value: unknown }[]
        // placement/children writes are hard-blocked regardless of tree state (FS-10)
        for (const m of mutation) {
          if (m.targetProp.startsWith('placement') || m.targetProp === 'children') {
            return { status: 'rejected', error: { code: 'placement-target-blocked' } }
          }
          // HOOKS (hooks-map-review.md §7.2 pins 1/5 — the value-provider
          // slot): the managed-channel ENTRY gate. `hooks.<name>` writes are
          // 'replace'-only (`hook-mode-blocked`) and resolve against the
          // node's OWN source/duplex anchors (`hook-name-unresolved` — a
          // bare `hooks` target has no name); a seam/def-shaped provider is
          // the landmine — `hook-seam-exempt` warn + the mutation is an
          // inert NO-OP (the rest of the op still applies). The same gate
          // runs defensively inside node.applySlice (warn + skip, never
          // throw) — this pre-check is what turns the containment into a
          // rejected RESULT on the managed channel.
          if (m.targetProp.startsWith('hooks.') || m.targetProp === 'hooks') {
            const name = m.targetProp === 'hooks' ? '' : m.targetProp.slice('hooks.'.length)
            if (name.length === 0 || m.mode !== 'replace') {
              return {
                status: 'rejected',
                error: {
                  code: m.mode !== 'replace' ? 'hook-mode-blocked' : 'hook-name-unresolved',
                  detail: `hooks.${name}: 'replace' mode only, targeting a same-node source/duplex provider name`,
                },
              }
            }
            const guard = hookWriteGuard(node as Node, name)
            if (!guard.ok) {
              if (guard.code === 'hook-name-unresolved') {
                return {
                  status: 'rejected',
                  error: { code: 'hook-name-unresolved', detail: `no source/duplex anchor named "${name}" on ${(node as Node).id}` },
                }
              }
              console.warn(`hook-seam-exempt at ${(node as Node).id}: "${name}" is a seam/def-shaped provider; hook write skipped (a hook write would tear down the seam)`)
              continue
            }
            // HOOKS-ARRAY §9.4 item 2 (CONTRACT AMENDMENT C) — the KIND gate:
            // a scalar `hooks.<name>` VALUE write targets the VALUE-provider
            // surface only. A name DECLARED as a non-value kind
            // (`'component'`/`'placement'` — the minting kinds) is
            // rejected with `hook-kind-mismatch`: those hooks mint nodes;
            // they never take a scalar hook write. Undeclared names and
            // explicit `'value'` kinds keep the shipped state-slice
            // behavior.
            const kind = ((node as Node).base.hooksKind ?? {})[name]
            if (kind !== undefined && kind !== 'value') {
              return {
                status: 'rejected',
                error: { code: 'hook-kind-mismatch', detail: `hooks.${name}: declared kind "${kind}" mints nodes — scalar value writes are rejected` },
              }
            }
          }
        }
        const nodeState = (node as Node).state
        // AUTH-SEAM nested (2026-08-16) — the family-adopted def child
        // instance (runtimeMinted, delivered component data) is mutable
        // even in a prototype chain (a nested seam consumer's adopted def
        // children sit under a token-terminated def-root, so their state is
        // 'prototype'); the def DATA is the authored truth, the runtime
        // instance is the delivered component. 'unplaced'/'destroyed'
        // rejections stay untouched.
        if (nodeState !== 'in-tree' && !(nodeState === 'prototype' && (node as Node).runtimeMinted)) {
          return { status: 'no-usable-state', nodeState }
        }
        const sliceFacts = (node as Node).applySlice(mutation as never)
        const dirtied = [node!.id]
        // P3 §3.2 (E2E-3) — component-source change: the affected set is the
        // per-name component Link's TARGET owners (the consumers that resolve
        // the changed name), read off the Link registry
        // (`link.anchorsOf('target')` → `anchor.owner`), never a family walk
        // (spec §3.2: "resolved through the graph, never by enumerating
        // states"). A node with no source/duplex anchors keeps the node-local
        // set (E2E-2: one node compiles). Keep-first dedup: one consumer can
        // target several names, and a node that consumes its own name is
        // already dirty.
        for (const a of (node as Node).anchors) {
          if ((a.role !== 'source' && a.role !== 'duplex') || typeof a.target !== 'string') continue
          for (const ta of a.link.anchorsOf('target')) {
            const consumer = ta.owner
            if (!consumer || consumer === node || dirtied.includes(consumer.id)) continue
            dirtied.push(consumer.id)
            this.markPass2(consumer.id)
          }
        }
        const entry = this.journalIfApplied(op, {
          status: 'applied',
          dirtied,
          // DEFECT-JOURNAL-UNDO (handoffs-review-4.md §3) — the undo handle
          // and the replay gate: the layer ids applySlice created + the per-
          // hook-mutation pre-op facts. Never serialized (the journal is
          // process-local). sliceLayers is the exact inverse for every non-
          // hook mode (removeLayer per id); hookUndo carries the pre-op
          // anchor.value + created/replaced/cleared disposition (the
          // deterministic `hook-<name>` id + replace-in-place semantics make
          // id-only undo inexact on a second write).
          sliceLayers: sliceFacts.createdLayers,
          hookUndo: sliceFacts.hookUndo,
        })
        this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id, dirtied, sliceLayers: sliceFacts.createdLayers, hookUndo: sliceFacts.hookUndo }
      }
      if (op.kind === 'destroy') {
        // explicit destroy: the node leaves the content source of truth too,
        // so the sweep finalizes it (content otherwise persists when detached)
        unregisterContentNode(node as Node)
        const target = node as Node
        if (target.runtimeMinted) {
          // AUTH-SEAM (2026-08-15) — RUNTIME-MINTED retention destroy: a
          // family-adopted def child (or a clone-instance) is marked
          // destroyed WITHOUT dissolving its family edge — the walk keeps
          // the slot (the legacy view's children[i] positions stay stable,
          // the sibling's shared family link is never touched) while the
          // compile drops the node (destroyed ⇒ no state ⇒ no render).
          target.markDestroyed()
        } else {
          // REQ-GAP-12 (handoffs-review-2 §REQ-GAP-12, user ruling 1,
          // 2026-08-21) — mark the EXPLICIT destroy as cascade-capable: the
          // sweep's finalizeDestroyed then recurses into the destroyed node's
          // EXPLICIT (family parent-child) children — payload content
          // included — while SKIPPING placement-owned nodes and
          // 'component'-token prototype nodes. Internal state only (never an
          // op payload — the journal shape is unchanged). Teardown-to-root
          // becomes ONE destroy op for payload trees; the runtimeMinted
          // branch above stays non-cascading (retention split).
          markCascadeExplicit(target)
          target.destroy()
        }
        // REQ-GAP-11 (handoffs-review-2 §REQ-GAP-11 AMENDMENT, 2026-08-21) —
        // evict the destroyed node's map entries on BOTH destroy branches:
        // the markDestroyed branch never calls markPending, so it never
        // reaches finalizeDestroyed and would never be evicted by the sweep
        // alone. The retention letter protects the WALK/anchors (slot
        // stability — the family edge above is kept), not the maps, so
        // registered/byId/this.nodes drop the node while getNode resolution
        // survives via the private destroyedRefs tombstone.
        evictDestroyedNode(target)
        if (this.nodes.get(target.id) === target) {
          this.nodes.delete(target.id)
          this.destroyedRefs.set(target.id, target)
        }
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [node!.id] })
        this.emitStructure('destroy', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id, dirtied: [node!.id] }
      }
      if (op.kind === 'placement-attach') {
        // P3 §3.3/§9-Q2 — the dedicated placement-attach op (E2E-4): registers
        // the node if new, mints its `content` anchor(s) per `names`
        // (preference order) + the `container` anchor on the target container
        // node (with the §1.3 veto), and marks pass-2 dirty ONLY the container
        // node + the added node. `attach` stays family-only; the state-slice
        // placement block stays hard-blocked (P4). The trigger identity
        // (which placement link changed) rides the op payload; apply derives
        // it when the payload omits it and passes it into the pass-2 dispatch
        // (C-2/10.ac.2 #7) — the silent-abort carrier.
        const container = (op as { container?: Node }).container
        if (!container) return { status: 'rejected', error: { code: 'unknown-node' } }
        const names = (op as { names?: string[] }).names ?? []
        this.registerNode(node as Node)
        const hub = (node as Node).hubFor ?? container.hubFor ?? this.hub
        if (!hub) return { status: 'rejected', error: { code: 'link-config', detail: 'no link hub for placement-attach' } }
        const res = placementAttach(node as Node, container, names, hub)
        const trigger = (op as { trigger?: PlacementTrigger }).trigger
          ?? derivePlacementTrigger(res.attachZone, res.containerAnchorMinted)
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [container.id, node!.id] })
        this.emitStructure('placement-attach', node!.id)
        this.markPass2(container.id, trigger)
        this.markPass2(node!.id, trigger)
        return { status: 'applied', journalId: entry!.id, dirtied: [container.id, node!.id] }
      }
      if (op.kind === 'attach') {
        if (findCycle(node as Node, op.to as Node)) throw new CycleError((node as Node).id)
        if ((node as Node).anchors.find(a => a.role === 'child')) {
          throw new SingleParentError((node as Node).id)
        }
        const link = (op.to as Node).familyLinkFor()
        const options: { priority?: number } = {}
        const prio = (op as { priority?: number }).priority
        if (prio !== undefined) options.priority = prio
        ;(node as Node).addAnchor('child', node as Node, options, link)
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [node!.id] })
        this.emitStructure('attach', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id, dirtied: [node!.id] }
      }
      if (op.kind === 'detach') {
        // DEFECT #12 — the safe per-node detach (siblings keep their edges)
        detachNodeSafe(node as Node)
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [node!.id] })
        this.emitStructure('detach', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id, dirtied: [node!.id] }
      }
      if (op.kind === 'move') {
        const toParent = (op.to as { parent: Node }).parent
        if (findCycle(node as Node, toParent)) throw new CycleError((node as Node).id)
        // DEFECT #12 — safe detach of the moved node; siblings untouched
        detachNodeSafe(node as Node)
        const link = toParent.familyLinkFor()
        const options: { priority?: number } = {}
        const prio = (op.to as { priority?: number }).priority
        if (prio !== undefined) options.priority = prio
        ;(node as Node).addAnchor('child', node as Node, options, link)
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [node!.id] })
        this.emitStructure('move', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id, dirtied: [node!.id] }
      }
      if (op.kind === 'clone-instance') {
        // source may arrive as `source` (wire contract) or `node` (internal)
        const source = (op.source as Node | undefined) ?? node
        if (!source) return { status: 'rejected', error: { code: 'unknown-node' } }
        const copy = source.clone('actor')
        this.registerNode(copy)
        const slot = op.slot as Node | undefined
        if (slot) {
          // instantiation: the instance's parent is the slot — replace any
          // inherited parent edge from the clone (single-parent respected)
          const inherited = copy.childAnchor()
          if (inherited) {
            ;(inherited.link as unknown as Link).destroy()
            const idx = copy.anchors.indexOf(inherited)
            if (idx !== -1) copy.anchors.splice(idx, 1)
          }
          const options: { priority?: number } = {}
          const prio = (op as { priority?: number }).priority
          if (prio !== undefined) options.priority = prio
          const link = slot.familyLinkFor()
          copy.addAnchor('child', copy, options, link)
        }
        const entry = this.journalIfApplied(op, {
          status: 'applied',
          dirtied: [copy.id],
          // DEFECT-CLONE-REPLAY-NONIDEMPOTENT (handoffs-review-4.md §4) — the
          // A3-minted precedent: persist the copy id so replay can gate on
          // its liveness (a live copy in this.nodes → skip) instead of
          // re-minting a fresh copy per replay.
          minted: [copy.id],
        })
        this.emitStructure('clone-instance', copy.id); this.markPass2(copy.id)
        return { status: 'applied', journalId: entry!.id, dirtied: [copy.id], minted: [copy.id] }
      }
      if (op.kind === 'layer-apply') {
        // ORIGIN-OWNER (archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review §12.4) — the atomic
        // mint-and-wire op: mints the NodeData set as family children of the
        // target, registers the minted set, and applies the anchor layer.
        // Idempotent (same layerId = no-op); the journal result persists the
        // minted ids (A3 — replay resolves them to the existing nodes).
        const target = op.target as Node | undefined
        if (!target) return { status: 'rejected', error: { code: 'unknown-node' } }
        const res = layerApply(op as never, { hub: target.hubFor ?? this.hub ?? null as never, nodes: this.nodes })
        // supervisor visibility: every minted node is registered here so
        // getNode/allNodes/pass-2 resolve it (the minted-set registry tracks
        // ownership for teardown; the supervisor tracks the graph)
        for (const id of res.minted) {
          const n = resolveNodeRef(id)
          if (n) this.registerNode(n)
        }
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: res.doorways, minted: res.minted })
        this.emitStructure('layer-apply', target.id)
        this.markPass2(target.id)
        for (const id of res.minted) this.markPass2(id)
        return { status: 'applied', journalId: entry!.id, dirtied: res.doorways, minted: res.minted }
      }
      if (op.kind === 'rows-mint') {
        // HOOKS-ARRAY (CONTRACT AMENDMENT C §9.2 pins 2/3/5) — the rows-mint
        // op: mint per-row nodes from a prototype by name + register the
        // minted set (the layer-apply visibility precedent), journal the
        // batch, and run the MINT-SIDE consumer walk (each minted row's
        // source anchors' links' target owners markPass2 — the cascade that
        // the scalar E2E-3 host-scoped walk does not cover, §9.2 pin 7). The
        // KIND GATE: a declared `hooksKind[hookName]` must admit the op's
        // kind ('component' yields the component mint; 'placement' the
        // placement mint) — a mismatch is rejected here (the write-surface
        // gate, pin 2).
        const target = op.target as Node | undefined
        if (!target) return { status: 'rejected', error: { code: 'unknown-node' } }
        const rowsOp = op as unknown as RowsMintOp
        // ADVERSARIAL-KEYED-S22 — the D8 undo re-apply passes `skipKindGate`
        // (an inverse restores a previously-VALID state; a hooksKind change
        // after the op must not block the undo). The forward path keeps the gate.
        if (!(opts as { skipKindGate?: boolean } | undefined)?.skipKindGate) {
          const declared = (target.base.hooksKind ?? {})[rowsOp.hookName]
          if (declared !== undefined && declared !== rowsOp.mintKind) {
            return { status: 'rejected', error: { code: 'hook-kind-mismatch', detail: `rows-mint ${rowsOp.hookName}: declared kind "${declared}" ≠ op kind "${rowsOp.mintKind}"` } }
          }
          if (declared === undefined && rowsOp.mintKind !== 'component') {
            return { status: 'rejected', error: { code: 'hook-kind-mismatch', detail: `rows-mint ${rowsOp.hookName}: undeclared hook — only 'component' is implied; declare hooksKind` } }
          }
        }
        const res = rowsMint(rowsOp as never, { hub: target.hubFor ?? this.hub ?? (null as never), nodes: this.nodes })
        for (const id of res.minted) {
          const n = resolveNodeRef(id)
          if (n) this.registerNode(n)
        }
        const entry = this.journalIfApplied(op, {
          status: 'applied',
          dirtied: res.doorways,
          minted: res.minted,
          // Feature 1b (D10) — additive observability + the undo fact-set:
          // `reused` = in-place-updated (changed) ids, `removed` = the
          // per-id-teardown rows, `preRecord` = the pre-op batch record
          // (null when the op created the batch) — the D8 exact-inverse undo.
          reused: res.reused ?? [],
          removed: res.removed ?? [],
          preRecord: res.preRecord ?? null,
        })
        // MINT-SIDE consumer walk: consumers of any changed row's source/duplex
        // field names are dirtied + pass-2'ed (the cascade the amendment pins).
        // Feature 1b — the walk covers the REUSED (changed) rows + the
        // REMOVE-MISSING set (captured by the executor before teardown) too,
        // so a value-only keyed update dirties the changed field-name
        // consumers (the silent-abort: an unchanged row is NOT in `reused`,
        // so its consumers are not marked). The unchanged-row no-op yields an
        // empty walk → target-only dirtied (replay-churn bound).
        const consumed = new Set<string>()
        for (const id of [...(res.minted ?? []), ...(res.reused ?? []), ...(res.removed ?? []).map((r) => r.nodeId)]) {
          const n = resolveNodeRef(id)
          if (!n) continue
          for (const a of n.anchors) {
            if ((a.role !== 'source' && a.role !== 'duplex') || typeof a.target !== 'string') continue
            for (const ta of a.link.anchorsOf('target')) {
              const consumer = ta.owner
              if (!consumer || consumed.has(consumer.id)) continue
              consumed.add(consumer.id)
              this.markPass2(consumer.id)
            }
          }
        }
        if (this.quietApply) {
          // ADV-S5 — the restore re-mint is a QUIET internal op: no structure
          // event (the renderer must not see a forward rows-mint for a restore)
        } else {
          this.emitStructure('rows-mint', target.id)
        }
        this.markPass2(target.id)
        // NOTE: the minted rows are NOT independently pass-2'ed — their
        // element states are produced by the ancestor/consumer compiles that
        // include them in the focused slice. Marking each row dirty would
        // recompile the CONSUMER from the row's NARROW slice (only that row +
        // its walk path), overwriting the consumer's full multi-provider arm
        // set with a single-provider result (the pin-6 fan-out must survive
        // the flush). The consumers marked below compile last and win.
        const dirtied = [...new Set([...res.doorways, ...consumed])]
        return { status: 'applied', journalId: entry!.id, dirtied, minted: res.minted, reused: res.reused ?? [], removed: res.removed ?? [], preRecord: res.preRecord ?? null }
      }
      if (op.kind === 'rows-clear') {
        // HOOKS-ARRAY (§9.4 item 6) — the PAYLOAD-CONTROLLED teardown: the
        // `batches[hookName]` record is the single handle (delete it → the
        // no-promotion rowsTeardown via the record's layerId). The minting
        // apparatus is never addressed directly.
        const target = op.target as Node | undefined
        if (!target) return { status: 'rejected', error: { code: 'unknown-node' } }
        const res = rowsClear(op as never, { hub: target.hubFor ?? this.hub ?? (null as never), nodes: this.nodes })
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: res.doorways })
        // ADVERSARIAL-S5 (2026-08-24) — the mint-side consumer walk on
        // teardown too: rows-clear marks the field-name consumers pass-2 so
        // their stale fan-out arms refresh (the apply-time walk covers the
        // mint only; a clear/undo must not leave ghost arms in the store).
        const consumed = new Set<string>()
        for (const id of res.minted ?? []) {
          const n = resolveNodeRef(id)
          if (!n) continue
          for (const a of n.anchors) {
            if ((a.role !== 'source' && a.role !== 'duplex') || typeof a.target !== 'string') continue
            for (const ta of a.link.anchorsOf('target')) {
              const consumer = ta.owner
              if (!consumer || consumed.has(consumer.id)) continue
              consumed.add(consumer.id)
              this.markPass2(consumer.id)
            }
          }
        }
        this.emitStructure('rows-clear', target.id)
        this.markPass2(target.id)
        const dirtied = [...new Set([...res.doorways, ...consumed])]
        return entry
          ? { status: 'applied', journalId: entry.id, dirtied }
          : { status: 'applied', dirtied }
      }

      return { status: 'no-usable-state', nodeState: (node as Node)?.state ?? 'unplaced' }
    } catch (e: unknown) {
      if (e instanceof CycleError) {
        return { status: 'rejected', error: { code: 'cycle-detected' } }
      }
      if (e instanceof SingleParentError) {
        return { status: 'rejected', error: { code: 'single-parent' } }
      }
      if (e instanceof Error && 'code' in e) {
        const err = e as { code: string }
        return { status: 'rejected', error: { code: err.code } }
      }
      throw e
    } finally {
      this.suppressJournal = prevSuppress
      this.quietApply = prevQuiet
    }
  }

  replay(): void {
    // Snapshot the stream: re-applies journaled ops, so iterating the LIVE
    // array would keep visiting appended entries — an infinite journal-growth
    // loop for any op that applies successfully on replay. The replayed ops
    // are the ORIGINAL entries only.
    for (const entry of [...this.journal]) {
      // Feature 3 (D6) — the base branch runs FIRST: a base marker restores
      // the graph snapshot (D4) and is NEVER dispatched to apply(). The
      // post-base entries then re-apply with their existing gates below.
      if (entry.op.kind === 'base') {
        const snapshot = (entry.op as { snapshot?: { template: unknown; content: unknown[] } }).snapshot
        if (snapshot) this._restoreBase(snapshot)
        continue
      }
      // DEFECT-JOURNAL-REPLAY-APPEND + DEFECT-CLONE-REPLAY-NONIDEMPOTENT
      // (handoffs-review-4.md §3b/§4) — the idempotency gate: a state-slice
      // whose recorded sliceLayers all exist is already applied (skip);
      // hooks gate on layer existence AND value-equality (the deterministic
      // `hook-<name>` id is not entry-distinguishing); clone-instance gates
      // on the recorded minted copy resolving LIVE in this.nodes. The
      // all-or-nothing semantics are pinned: no stream path removes
      // `slice-*` layers except an undo (which removes ALL of an entry's
      // layers atomically), so partial existence is unreachable — do not
      // branch on it.
      const kind = entry.op.kind
      const result = entry.result as { sliceLayers?: string[]; hookUndo?: { name: string; preValue: unknown; created: boolean; cleared: boolean }[]; minted?: NodeId[] }
      if (kind === 'state-slice' && entry.op.mutation && this.gateBlocksReplay(entry, result)) continue
      if (kind === 'clone-instance' && result.minted && result.minted.every((id) => !this.nodes.get(id)?.destroyed)) continue
      const op = { ...entry.op } as { kind: string; node?: Node; [key: string]: unknown }
      // Feature 3 (D3) — id-resolve BOTH the live node ref AND the rows-op
      // target (ADV-S11/S19: the rows ops carry their subject on `op.target`,
      // not `op.node`). A `_restoreBase`-evicted ref resolves by id to the
      // restored seed; the live ref is preferred only while it is STILL this
      // supervisor's registered node.
      this._resolveOpRefs(op, entry.op)
      try {
        // no-journal re-apply + in-place result refresh (the re-apply mints
        // fresh slice layer ids — the recorded ones would go stale).
        const res = this.apply(op, { journal: false })
        if (res.status === 'applied') {
          // Feature 1b (D9) — PRESERVE the ORIGINAL `preRecord` across the
          // refresh: replay re-runs a keyed op against the CURRENT (post-op)
          // state, so the re-apply's preRecord is the post-op record — the
          // undo fact-set must stay the first-applied pre-op record (a
          // subsequent undo must restore the PRE-op values, never the
          // post-op ones). `'preRecord' in` keeps an explicit null (an op
          // that CREATED the batch → payload-teardown undo) intact.
          const merged = { ...res } as { status: string; [key: string]: unknown }
          if ('preRecord' in (entry.result as object)) merged.preRecord = (entry.result as { preRecord?: unknown }).preRecord
          entry.result = merged
        }
      } catch {
        // replay reproduces same rejections silently
      }
    }
    // ADV-S4 (2026-08-25 adversarial pass) — a replay that hit a base marker
    // must CLEAR the redoStack. D6 clears it at condense; replay runs AFTER
    // the condense (a host can replay a condensed journal) and must not leave
    // pre-replay undo entries in the redoStack — a subsequent redo would
    // re-apply an op already consumed by the replay/undo and double-apply it
    // (worst for non-idempotent rows-mint/destroy). Clearing on the base
    // branch makes replay a clean graph-REPLACE (the pre-replay undo/redo
    // state is meaningless against the restored graph).
    if (this.journal.some((e) => e.op.kind === 'base')) this.redoStack = []
  }

  /** Feature 3 (D3, ADV-S11/S19) — id-resolve BOTH the live node ref and the
   *  rows-op target against the CURRENTLY registered nodes, so a replay/redo/
   *  undo after a `_restoreBase` graph-REPLACE targets the restored seed (same
   *  ids, fresh objects). The live ref is preferred only while it is STILL
   *  this supervisor's registered node; otherwise the id fallback resolves it
   *  (or leaves it untouched if the id is gone). */
  private _resolveOpRefs(op: { node?: Node; target?: Node; [key: string]: unknown }, from: { node?: Node; target?: Node; [key: string]: unknown }): void {
    const resolveOne = (key: 'node' | 'target'): void => {
      const live = from[key] as Node | undefined
      const current = op[key] as Node | undefined
      if (current && live) {
        if (!live.destroyed && this.nodes.get(live.id) === live) {
          op[key] = live
        } else {
          op[key] = this.nodes.get(live.id) ?? live
        }
      }
    }
    resolveOne('node')
    resolveOne('target')
  }

  private gateBlocksReplay(entry: JournalEntry, result: { sliceLayers?: string[]; hookUndo?: { name: string; preValue: unknown; created: boolean; cleared: boolean }[] }): boolean {
    // Feature 3 (D3) — resolve the node by id FIRST: after a replay-from-base
    // the entry's live ref is the evicted pre-base object whose layers still
    // exist (the gate would wrongly skip the post-base re-apply). The id
    // fallback targets the CURRENTLY REGISTERED node (same ids, fresh seeds).
    const rawNode = (entry.op.node ?? entry.op.target) as Node | undefined
    const node = rawNode ? (this.nodes.get(rawNode.id) ?? rawNode) : undefined
    if (!node) return false
    if (result.sliceLayers && result.sliceLayers.length > 0) {
      if (!result.sliceLayers.every((id) => node.layers.some((l) => l.id === id))) return false
    }
    if (result.hookUndo && result.hookUndo.length > 0) {
      const mutation = entry.op.mutation as { targetProp: string; mode: string; value: unknown }[] | undefined
      for (const fact of result.hookUndo) {
        const layer = node.layers.find((l) => l.id === `hook-${fact.name}`)
        const opValue = mutation?.find((m) => m.targetProp === `hooks.${fact.name}`)?.value
        if (!layer || !opValue || layer.value !== opValue) return false
      }
    }
    // an entry with no recorded layers (e.g. a seam-exempt hooks no-op) is
    // not gated — re-applying reproduces the same no-op
    return (result.sliceLayers?.length ?? 0) > 0 || (result.hookUndo?.length ?? 0) > 0
  }

  undo(): void {
    // Feature 3 (ruling 19) — the base-boundary guard: an undo with no
    // post-base entries left (the undoStack was truncated at condense) would
    // have to cross the base marker — warn + fail, never a silent no-op,
    // never a partial restore.
    if (this.undoStack.length === 0) {
      if (this.journal.some((e) => e.op.kind === 'base')) {
        console.warn('base-boundary: undo cannot cross the condensed base marker (undoStack truncated at condense)')
      }
      return
    }
    const entry = this.undoStack.pop()!
    this.redoStack.push(entry)
    const kind = entry.op.kind
    const rawNode = entry.op.node ?? entry.op.target
    const node = rawNode as Node
    if (!node) return
    // Feature 3 (D3) — the id-fallback: after a replay-from-base the pre-base
    // node OBJECTS are replaced by fresh seeds with the SAME ids; undo() must
    // re-resolve an evicted/destroyed live ref by id (mirror of replay's
    // resolution — prefer the live ref only when it is STILL this supervisor's
    // registered node; the wrong-node hazard note handoffs-review-4 §5).
    const resolved = !node.destroyed && this.nodes.get(node.id) === node ? node : (this.nodes.get(node.id) ?? null)
    if (!resolved) return
    try {
      if (kind === 'attach') {
        // DEFECT #12 — attach-undo uses the safe per-node detach too
        detachNodeSafe(resolved)
      } else if (kind === 'destroy') {
        // destroy is terminal; undo is a no-op for destroyed nodes
      } else if (kind === 'rows-mint') {
        // Feature 1b (D8) — the keyed-reuse EXACT inverse: when the entry
        // carried a `preRecord` (a non-null pre-op BatchRecord), undo RE-APPLIES
        // the pre-op rows through the SAME keyed executor (journal:false) —
        // this restores the record + every reused node's values, destroys the
        // mint-new half (remove-missing), and re-mints the removed half (fresh
        // ids — identity across undo is not a promise, D8). An entry with
        // `preRecord === null` (the op CREATED the batch) keeps the plain
        // payload-controlled teardown below.
        const mResult = entry.result as { preRecord?: { keyField?: string; prototypeName: string; mintKind: string; placementName?: string; rows: unknown[] } | null } | undefined
        const preRecord = mResult?.preRecord
        if (preRecord) {
          this.apply({
            kind: 'rows-mint',
            target: resolved,
            hookName: (entry.op as { hookName?: string }).hookName,
            mintKind: preRecord.mintKind,
            prototypeName: preRecord.prototypeName,
            ...(preRecord.placementName !== undefined ? { placementName: preRecord.placementName } : {}),
            ...(preRecord.keyField !== undefined ? { keyField: preRecord.keyField } : {}),
            rows: preRecord.rows,
            sourceName: 'rows-undo',
            ...((entry.op as { preserveByReversal?: boolean }).preserveByReversal !== undefined
              ? { preserveByReversal: (entry.op as { preserveByReversal?: boolean }).preserveByReversal }
              : {}),
          }, { journal: false, skipKindGate: true })
        } else {
          // HOOKS-ARRAY (§9.4 item 6) — undo of a rows-mint is the PAYLOAD-
          // CONTROLLED teardown: clear the batch record + rowsTeardown via the
          // record's layerId (the record is the undo handle; the operation is
          // redoable by re-applying the journaled mint op).
          const hookName = (entry.op as { hookName?: string }).hookName
          if (hookName !== undefined) {
            const batches = (resolved as unknown as { batches?: Record<string, { layerId: string }> }).batches ?? {}
            const record = batches[hookName]
            if (record) {
              // ADVERSARIAL-S5 (2026-08-24) — capture the minted set before the
              // teardown + walk the field-name consumers (the undo path must
              // refresh their pass-2 states — no stale fan-out arms after undo).
              const minted = mintedByOrigin(record.layerId)
              delete batches[hookName]
              resolved.rowsTeardown(record.layerId)
              resolved.removeLayer(record.layerId)
              for (const id of minted) {
                const n = resolveNodeRef(id)
                if (!n) continue
                for (const a of n.anchors) {
                  if ((a.role !== 'source' && a.role !== 'duplex') || typeof a.target !== 'string') continue
                  for (const ta of a.link.anchorsOf('target')) {
                    const consumer = ta.owner
                    if (!consumer) continue
                    this.markPass2(consumer.id)
                  }
                }
              }
            }
          }
        }
      } else if (kind === 'state-slice') {
        // DEFECT-JOURNAL-UNDO (handoffs-review-4.md §3a) — the sliceLayers
        // inverse: removeLayer per recorded id; per hook mutation restore the
        // pre-op anchor.value (and the layer value when the op replaced a
        // pre-existing hook layer; remove the layer iff the op created it;
        // re-add it with the authored fallback iff the op cleared it).
        // No phases/handlers run (RUNTIME-WRITE BODY letter); no emitStructure
        // (state-slice has none in apply either); markPass2 the node + the
        // E2E-3 source/duplex consumer walk (the flush is scheduled by
        // markPass2). Per-inverse try/catch — missing layers are silent no-ops.
        this.undoStateSlice(entry, resolved)
      }
    } catch {
      // a failed inverse degrades to a no-op — undo never throws
    }
  }

  private undoStateSlice(entry: JournalEntry, node: Node): void {
    const result = entry.result as { sliceLayers?: string[]; hookUndo?: { name: string; preValue: unknown; created: boolean; cleared: boolean }[] } | undefined
    const slices = result?.sliceLayers ?? []
    for (const id of slices) {
      try {
        node.removeLayer(id)
      } catch {
        // missing layer → silent no-op
      }
    }
    const hooks = result?.hookUndo ?? []
    for (const fact of hooks) {
      const layerId = `hook-${fact.name}`
      const anchor = node.anchors.find((a) => (a.role === 'source' || a.role === 'duplex') && a.target === fact.name)
      try {
        if (fact.cleared) {
          // the op removed the layer (hook clear): re-add it with the pre-op
          // value; the authored fallback is the anchor's current value
          if (anchor) {
            node.addLayer({ id: layerId, value: fact.preValue, hookFallback: anchor.value } as never)
            anchor.value = fact.preValue
          }
        } else if (fact.created) {
          node.removeLayer(layerId)
          if (anchor) anchor.value = fact.preValue
        } else {
          // replaced a pre-existing layer: keep it, restore the prior value
          const layer = node.layers.find((l) => l.id === layerId)
          if (layer) {
            ;(layer as unknown as { value: unknown }).value = fact.preValue
          }
          if (anchor) anchor.value = fact.preValue
        }
      } catch {
        // per-fact failure degrades to a no-op
      }
    }
    // the render-honesty half: dirty the node + its source/duplex consumers
    // (the E2E-3 walk mirror — the flush is scheduled by markPass2)
    node.markDirty('remote')
    this.markPass2(node.id)
    for (const a of node.anchors) {
      if ((a.role !== 'source' && a.role !== 'duplex') || typeof a.target !== 'string') continue
      for (const ta of a.link.anchorsOf('target')) {
        const consumer = ta.owner
        if (!consumer || consumer === node || consumer.destroyed) continue
        consumer.markDirty('remote')
        this.markPass2(consumer.id)
      }
    }
  }

  redo(): void {
    if (this.redoStack.length === 0) return
    const entry = this.redoStack.pop()!
    const op = { ...entry.op } as { kind: string; node?: Node; [key: string]: unknown }
    // Feature 3 (D3, ADV-S19) — id-resolve BOTH op.node AND op.target (the
    // rows ops carry their subject on op.target; a _restoreBase-evicted ref
    // must resolve to the restored seed).
    this._resolveOpRefs(op, entry.op)
    try {
      // no-journal re-apply + in-place result refresh; push the SAME entry to
      // undoStack (one journal entry per op — no double-undo) and never clear
      // the redoStack beyond the pop (redo-chains stay possible).
      const res = this.apply(op, { journal: false })
      if (res.status === 'applied') {
        // Feature 1b (D9) — preserve the original `preRecord` (same rationale
        // as replay: a redo's re-apply reads the CURRENT post-op state).
        const merged = { ...res } as { status: string; [key: string]: unknown }
        if ('preRecord' in (entry.result as object)) merged.preRecord = (entry.result as { preRecord?: unknown }).preRecord
        entry.result = merged
      }
      this.undoStack.push(entry)
    } catch {
      // redo reproduces same behavior
    }
  }
}
