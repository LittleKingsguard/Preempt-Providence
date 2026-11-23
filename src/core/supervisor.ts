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
import { unregisterContentNode, registerContentNode, resolveNodeRef, evictDestroyedNode, onNodeFinalized, markCascadeExplicit, mintedByOrigin, drainPendingDestroy, defRootPrototypeEntries, defPrototypeEntries, scopeOf } from './registry.js'
import type { GraphScope } from './registry.js'
import { placementChangeIrrelevant, activePlacementOf, hookWriteGuard } from './resolve.js'
import { placementAttach, derivePlacementTrigger, detachNodeSafe, layerApply, rowsMint, rowsClear } from './ops.js'
import { serializeSlice, loadState, reRegisterDefPrototypes } from './serialize.js'
import { isPathState } from './render-helpers.js'
import type { Anchor, CompiledState, CompileResult, LinkConfigNameHub, NodeBaseData, NodeId, NodeState, PlacementTrigger, RowsMintOp } from './types.js'

let journalSeq = 0

/** ENG-JOURNAL-ENTRY-READ-API — `journalEntries` window sizing. */
const DEFAULT_JOURNAL_WINDOW = 500
const MAX_JOURNAL_WINDOW = 1000
/** The cursor-relative default window peeks this far past the cursor so an
 *  undone (redo-able) tail is visible without an explicit `afterIndex`. */
const REDO_PEEK = 50

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

/** UNDO-REDO-REPORT (docs/specs/undo-redo-report.md — DECIDED 2026-08-26):
 *  the host-report surface for undo()/redo()/replay(). `scheduledDirtied` is
 *  the markPass2-SCHEDULED (pending-flush) set from pass2Dirty — NOT
 *  re-rendered states; a host awaiting settled states must `await flush()` +
 *  `takePass2States()`. `baseBoundary` is distinct from an empty stack: the
 *  base marker is never in the undoStack (truncated at condense), so an empty
 *  stack with a base present is the guarded boundary, not "nothing to undo". */
export interface UndoRedoReport {
  status: 'applied' | 'no-op' | 'base-boundary'
  scheduledDirtied: NodeId[]
  stackTopKind?: string
  redoTopKind?: string
  baseBoundary: boolean
}

/** ENG-JOURNAL-ENTRY-READ-API (docs/specs/journal-read-access-review.md,
 *  DECIDED 2026-09-12) — the sanitized journal-read surface. A row carries ONLY
 *  the absolute position and the coerced op-kind / last-apply status: never a
 *  live Node ref (`op.node`/`op.target`), a snapshot payload (the `base` op's
 *  `op.snapshot`), a raw `result.dirtied`, or the internal entry id. */
export interface JournalEntryView {
  index: number
  kind: string
  status: string
}

/** Window options for `Supervisor.journalEntries`. */
export interface JournalViewOptions {
  /** Absolute start override (clamped to `[0, total]`); when omitted the window
   *  is cursor-relative (a REDO_PEEK span ahead of the cursor). */
  afterIndex?: number
  /** Window size (default 500; clamped `[1, 1000]`). */
  limit?: number
}

/** The sanitized, JSON-safe journal snapshot returned by `journalEntries()`. */
export interface JournalView {
  entries: JournalEntryView[]
  fromIndex: number
  totalEntries: number
  truncated: boolean
  undoDepth: number
  redoDepth: number
  /** A `base` condense marker exists anywhere in the journal (independent of
   *  `undoBaseBoundary`, which is true only at the floor). */
  basePresent: boolean
  undoBaseBoundary: boolean
  /** Omitted when the undo stack is empty (`exactOptionalPropertyTypes`). */
  undoTopKind?: string
  /** Omitted when the redo stack is empty. */
  redoTopKind?: string
  /** Omitted when undefined (no journal condensing configured). */
  maxJournalLength?: number
}


/** Shared-host dispatch report (ssr-synthetic-event.md §3.1). */
export interface DispatchReport {
  results: HandlerResult[]
  dirtied: NodeId[]
}

/**
 * POST-BOOTSTRAP-EMIT-DROP (R-1 —
 * `docs/specs/post-bootstrap-emit-drop-fix-review.md` §4.4): the TREE compile
 * mode carried by a `Supervisor`. The invariant the mode delivers: *a node that
 * has been minted in the path domain is always re-derived in the path domain.*
 *
 *  - `family` (default, and byte-identical to the pre-R-1 dispatch): a dirty
 *    node's focused slice is compiled by `Node.compile` — family states, so
 *    every slice member's wire is its `nodeId` wire.
 *  - `path`: EVERY member of the dirty node's bounded focused slice is
 *    re-derived by its own `Node.compilePath`, so a node that already holds a
 *    path-state (the bootstrap's path states) is re-MINTED instead of being
 *    overwritten by a family state. A re-mint of an unchanged path yields the
 *    same wire, which is what makes path-domain identity sticky across renders.
 *
 * Entered at the documented bootstrap seam (`recordResolved`, which infers
 * `path` from recorded path states) or DECLARED by the host through
 * `new Supervisor({ compileMode })` / `setCompileMode()` for a bootstrap the
 * supervisor never hears about. The mode lives on the Supervisor (never on a
 * `Node`) so it survives `_restoreBase`'s node rebuild.
 */
export type CompileMode = 'family' | 'path'

/** The `Supervisor` options object (the `{ hub, events, maxJournalLength,
 *  graphScope, compileMode }` form passed to the constructor). */
export interface SupervisorOptions {
  hub?: LinkConfigNameHub
  events?: EventBridge
  maxJournalLength?: number
  graphScope?: GraphScope
  /** Explicit tree compile mode (R-1 §4.4(3)); an explicit value is never
   *  overridden by `recordResolved`'s inference. */
  compileMode?: CompileMode
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
  /** MULTI-GRAPH (D1-D8) — the graph scope this supervisor renders into
   *  (isolated opt-in, else null → the shared default). Threaded to ops so
   *  minted/registered nodes + the sweep stay scope-local. */
  readonly graphScope: GraphScope | null
  /** POST-BOOTSTRAP-EMIT-DROP (R-1) — the tree compile mode (see
   *  `CompileMode`). Carried on the SUPERVISOR, not on a `Node`, so it survives
   *  `_restoreBase`'s graph-REPLACE node rebuild. Inferred at the documented
   *  bootstrap seam (`recordResolved`) unless the host declared it explicitly. */
  private compileMode: CompileMode = 'family'
  /** True once a host DECLARED the mode (`{ compileMode }` / `setCompileMode`)
   *  — an explicit declaration is never overridden by the inference. */
  private compileModeExplicit = false
  /** PATH-MODE-SILENT-UNRESOLVED loud half (owner ruling 2026-11-23, gate §5
   *  ruling 3 — "Refuse loudly"): ONE-SHOT per supervisor instance. The
   *  condition is a per-supervisor CONFIGURATION fact (declared `path` mode +
   *  a bootstrap that recorded the family domain), so it must not repeat per
   *  op — and it must not use the module-level never-cleared signature sets
   *  other diagnostics dedupe with (`node.ts:404-429`): those dedupe per
   *  `pathKey` and node ids are per-document, which would yield one line per
   *  TREE rather than one per supervisor. */
  private modeMismatchWarned = false
  private undoStack: JournalEntry[] = []
  private redoStack: JournalEntry[] = []
  private client: ClientAPI | null = null
  private handlerCtx: HandlerContext | null = null
  /** Feature 3 (handoffs-review-8.md, ruling 17) — the condense trigger:
   *  absent = never; a journal length above it schedules a deferred condense
   *  (D5). Read-only once constructed. */
  private readonly maxJournalLength: number | undefined
  private condenseScheduled = false
  /** ENG-SUPERVISOR-HOOK-ACCUMULATION — the module finalize-hook unsubscribe
   *  returned by `onNodeFinalized`; called by `dispose()`. */
  private finalizeUnsub: () => void = () => {}

  constructor(rootOrOpts: Node | SupervisorOptions, nodes?: Map<NodeId, Node>) {
    this.hub = null
    this.events = null
    this.maxJournalLength = undefined
    this.graphScope = null
    if (rootOrOpts !== null && typeof rootOrOpts === 'object' && (rootOrOpts as { isNode?: boolean }).isNode === true) {
      const root = rootOrOpts as Node
      this.nodes = nodes ?? new Map<NodeId, Node>()
      this.nodes.set(root.id, root)
      this.graphScope = root.graphScope ?? null
    } else {
      const opts = rootOrOpts as SupervisorOptions
      this.nodes = new Map<NodeId, Node>()
      this.hub = opts.hub ?? null
      this.events = opts.events ?? null
      this.maxJournalLength = opts.maxJournalLength
      this.graphScope = opts.graphScope ?? null
      if (opts.compileMode !== undefined) {
        this.compileMode = opts.compileMode
        this.compileModeExplicit = true
      }
    }
    // REQ-GAP-11 — the sweep-hook seam: cascade-finalized nodes (the sweep's
    // own finalization, terminal) leave this supervisor's scan surfaces too.
    // Guarded by INSTANCE ownership: only a node this supervisor actually
    // holds is tombstoned here — the id-keyed delete would otherwise remove a
    // DIFFERENT graph's re-seeded node sharing the same id (the smoke runs
    // several loadState-re-seeded graphs in one process with shared ids).
    this.finalizeUnsub = onNodeFinalized((node) => {
      if (this.nodes.get(node.id) === node) {
        this.nodes.delete(node.id)
        this.destroyedRefs.set(node.id, node)
      }
    })
  }

  /** ENG-SUPERVISOR-HOOK-ACCUMULATION — release this Supervisor's module-level
   *  finalize hook + its node maps. Idempotent; a disposed Supervisor is inert.
   *  The module sweep timer is untouched; other Supervisors are unaffected. */
  dispose(): void {
    this.finalizeUnsub()
    this.finalizeUnsub = () => {}
    this.nodes.clear()
    this.destroyedRefs.clear()
    this.pass2Dirty.clear()
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

  /** UNDO-REDO-REPORT — read-only stack accessors (depths/top-kinds only;
   *  never raw `JournalEntry[]`, which hold live Node refs + snapshot
   *  payloads). `undoBaseBoundary` is true when the undoStack is empty BECAUSE
   *  it was truncated at the condensed base (further undo is a guarded no-op). */
  get undoDepth(): number {
    return this.undoStack.length
  }

  get redoDepth(): number {
    return this.redoStack.length
  }

  get undoTopKind(): string | undefined {
    return this.undoStack.at(-1)?.op.kind
  }

  get redoTopKind(): string | undefined {
    return this.redoStack.at(-1)?.op.kind
  }

  get undoBaseBoundary(): boolean {
    return this.undoStack.length === 0 && this.journal.some((e) => e.op.kind === 'base')
  }

  /**
   * ENG-JOURNAL-ENTRY-READ-API — a sanitized, non-draining snapshot of the
   * journal + the exact position accessors. JSON-safe (never live Node refs /
   * snapshot payloads). Read-only: never mutates, drains, awaits, or re-renders.
   * Pagination is by absolute index; `limit` is clamped [1, MAX_JOURNAL_WINDOW].
   */
  journalEntries(opts?: JournalViewOptions): JournalView {
    const total = this.journal.length
    const basePresent = this.journal.some((e) => e.op.kind === 'base')
    const limitRaw = opts?.limit
    const limit = limitRaw === undefined
      ? DEFAULT_JOURNAL_WINDOW
      : Math.min(Math.max(Math.floor(limitRaw), 1), MAX_JOURNAL_WINDOW)
    let fromIndex: number
    if (opts?.afterIndex !== undefined) {
      fromIndex = Math.min(total, Math.max(0, Math.floor(opts.afterIndex)))
    } else {
      const cursorIndex = (basePresent ? 1 : 0) + this.undoStack.length
      const toIndex = Math.min(total, cursorIndex + REDO_PEEK)
      fromIndex = Math.max(0, toIndex - limit)
    }
    const end = Math.min(total, fromIndex + limit)
    const entries: JournalEntryView[] = []
    for (let i = fromIndex; i < end; i++) {
      const e = this.journal[i]!
      entries.push({
        index: i,
        kind: typeof e.op?.kind === 'string' ? e.op.kind : 'unknown',
        status: typeof e.result?.status === 'string' ? e.result.status : 'unknown',
      })
    }
    const truncated = entries.length > 0 ? fromIndex > 0 || end < total : fromIndex < total
    const view: JournalView = {
      entries,
      fromIndex,
      totalEntries: total,
      truncated,
      undoDepth: this.undoStack.length,
      redoDepth: this.redoStack.length,
      basePresent,
      undoBaseBoundary: this.undoBaseBoundary,
    }
    const undoTop = this.undoStack.at(-1)?.op.kind
    if (undoTop !== undefined) view.undoTopKind = undoTop
    const redoTop = this.redoStack.at(-1)?.op.kind
    if (redoTop !== undefined) view.redoTopKind = redoTop
    if (this.maxJournalLength !== undefined) view.maxJournalLength = this.maxJournalLength
    return view
  }

  /** UNDO-REDO-REPORT — build the report from the post-op stacks, omitting the
   *  optional top-kind keys when the stack is empty (exactOptionalPropertyTypes). */
  private report(status: 'applied' | 'no-op' | 'base-boundary', dirtied: Set<NodeId>): UndoRedoReport {
    const base: UndoRedoReport = {
      status,
      scheduledDirtied: [...dirtied],
      baseBoundary: this.undoStack.length === 0 && this.journal.some((e) => e.op.kind === 'base'),
    }
    const undoTop = this.undoStack.at(-1)?.op.kind
    const redoTop = this.redoStack.at(-1)?.op.kind
    if (undoTop !== undefined) base.stackTopKind = undoTop
    if (redoTop !== undefined) base.redoTopKind = redoTop
    return base
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

  /** POST-BOOTSTRAP-EMIT-DROP (R-1 §4.4(4)) — the `path`-mode slice compile:
   *  merge the actionable states of EVERY member's own `compilePath`. A member
   *  only ever mints its OWN path-states (`mintPathState` keys them by the
   *  compiling node), so merging preserves the per-node overwrite semantics of
   *  the pass-2 dispatch unchanged: a member compiled later supersedes an
   *  earlier member's states for the same id. One compile per bounded-slice
   *  member, inside the same coalesced tick — no whole-tree recompile. */
  private compilePathSlice(node: Node): CompileResult {
    const actionable: CompiledState[] = []
    const dropped: CompileResult['dropped'] = []
    const warnings: CompileResult['warnings'] = []
    for (const member of this.focusedSlice(node)) {
      const cr = member.compilePath()
      actionable.push(...cr.actionable)
      dropped.push(...cr.dropped)
      warnings.push(...cr.warnings)
    }
    return { actionable, dropped, warnings }
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

  /** POST-BOOTSTRAP-EMIT-DROP (R-1 §4.4(3)) — the compile-mode getter/setter:
   *  the explicit `Supervisor` override for a host that bootstraps its tree by
   *  a route this supervisor never hears about (never a `recordResolved` call),
   *  so the mode cannot be inferred. Setting it DECLARES the mode: later
   *  `recordResolved` calls no longer infer over it. */
  getCompileMode(): CompileMode {
    return this.compileMode
  }

  setCompileMode(mode: CompileMode): void {
    this.compileMode = mode
    this.compileModeExplicit = true
  }

  /** Seed the resolved store from a bootstrap compile's actionable states —
   *  the demos' bootstrap compiles the root DIRECTLY (bypassing the
   *  supervisor), so callers must recordResolved(cr.actionable) after that
   *  full compile. Groups per node and writes through node.resolved. This
   *  NEVER touches pass2States and never drains.
   *
   *  POST-BOOTSTRAP-EMIT-DROP (R-1 §4.4(2)) — `recordResolved` IS the
   *  documented bootstrap channel, so the recorded states also DECLARE the
   *  tree's compile mode: a bootstrap that recorded PATH states puts this
   *  supervisor in `path` mode (and it never infers back to `family` — a node
   *  minted in the path domain is always re-derived in the path domain). A
   *  host-declared mode is never overridden. */
  recordResolved(actionable: CompiledState[]): void {
    if (!this.compileModeExplicit && actionable.length > 0 && actionable.every(isPathState)) {
      this.compileMode = 'path'
    }
    // PATH-MODE-SILENT-UNRESOLVED loud half (owner ruling 2026-11-23, gate §5
    // ruling 3 — "Refuse loudly"; probe P-7 arm A5): a DECLARED `path` mode
    // over a bootstrap that recorded the FAMILY domain. The recorded bootstrap
    // states' domain is known HERE — this is the same predicate the inference
    // above reads, so the mismatch is exactly the branch the inference skips.
    // The consequence is stated, never repaired: the first path-mode pass-2
    // re-mints every bounded-slice member in the path domain, replacing the
    // family-universe bindings (a descendant-provided value becomes
    // `unresolved-reference`) with the path re-mints. DIAGNOSTIC ONLY — the
    // states are still recorded, later ops still apply, nothing is rejected.
    if (
      !this.modeMismatchWarned &&
      this.compileModeExplicit &&
      this.compileMode === 'path' &&
      actionable.length > 0 &&
      !actionable.every(isPathState)
    ) {
      this.modeMismatchWarned = true
      console.warn(
        'compile-mode bootstrap mismatch: compileMode is declared \'path\' but the recorded bootstrap states are FAMILY states (no pathKey) — the first path-mode pass-2 re-mints every bounded-slice member in the path domain, so family-universe bindings (including a descendant-provided value) are replaced by path bindings and reported as unresolved-reference. Diagnostic only: the recorded states persist, ops still apply; to keep the family bindings, bootstrap the tree in family mode (compileMode \'path\' over a path bootstrap is the supported configuration).',
      )
    }
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
        const cr = this.compileMode === 'path'
          // POST-BOOTSTRAP-EMIT-DROP (R-1 §4.4(4)) — `path` mode: EVERY member
          // of the bounded slice is re-derived in the PATH domain, so an
          // ancestor holding a bootstrap path-state is re-minted (same wire
          // while its topology is unchanged) rather than overwritten by a
          // family state. `family` mode is untouched (byte-identical).
          ? this.compilePathSlice(node)
          : placementRouted
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
      const protoScope = this.graphScope ?? undefined
      for (const [, protos] of defPrototypeEntries(protoScope)) for (const p of protos) if (p.hubFor === this.hub) protoSet.add(p)
      for (const [, r] of defRootPrototypeEntries(protoScope)) if (r.hubFor === this.hub) protoSet.add(r)
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

  /** Feature 3 (D4) — the SYNCHRONOUS graph-REPLACE restore: PRE-FLIGHT the
   *  snapshot (step 0b), then drain the pending-destroy queue + evict the
   *  pre-base nodes, clear this.nodes, run the §3 recipe (loadState → seed with
   *  the SAME hub → reconcileParentTargets → reRegisterDefPrototypes →
   *  registerNode per node → re-mint rows per the batches records), then
   *  schedule a FULL pass-2 refresh. The async sweep cannot interleave (the
   *  drain ran synchronously). Re-runnable: a second restore drains the first
   *  restore's nodes the same way.
   *
   *  RETURNS whether the graph was RESTORED: `true` = re-seeded, `false` = the
   *  restore was REFUSED (the hub-less refusal below and the invalid-snapshot
   *  pre-flight) and the graph is exactly the pre-base graph. `replay()` reads
   *  it — a refusal must never be reported as an applied replay
   *  (RESTORE-SEAM-STRIP-MISS-TOTAL-LOSS (b)). */
  private _restoreBase(snapshot: { template: unknown; content: unknown[]; clientConfig?: unknown }): boolean {
    // step 0 — RESTORE-INTEGRITY (b): a restore NEEDS this supervisor's hub,
    // and it must refuse BEFORE the eviction below. The seeds are built with
    // `new Node(d, hub, …)`: with no hub their placement/component anchors
    // cannot rejoin any shared `Link`, so the re-seed is impossible — while the
    // eviction (step 1) has already dropped every pre-base node from
    // `this.nodes`, i.e. a hub-less restore used to EVICT THE WHOLE GRAPH
    // SILENTLY (`allNodes() === 0`, `replay().status === 'applied'`, no
    // diagnostic) — total data loss on a documented-legal host shape (a
    // hub-less `Supervisor` is normal for a single-graph host). Refuse LOUDLY
    // and keep the graph untouched. A hub is NOT minted on demand: the hub IS
    // the graph's identity (same-name shared Links), so minting one here would
    // silently change identity semantics and needs its own gate.
    const hub = this.hub
    if (!hub) {
      console.warn(
        "restore-refused-no-hub: a condensed-base restore needs the supervisor's hub to re-seed the graph (construct it as `new Supervisor({ hub: createLinkHub() })` and translate with the same hub); without it the restored seeds cannot rejoin the shared Links, so the graph would be EVICTED and left EMPTY. Restore refused — the current graph is kept as-is",
      )
      return false
    }
    const doc = snapshot as unknown as { template: unknown; content: unknown[]; defPrototypes?: unknown }
    // step 0b — RESTORE-SEAM-STRIP-MISS-TOTAL-LOSS (2026-11-23), the (b) SWALLOW
    // half, part 1: a PURE PRE-FLIGHT of the snapshot, BEFORE any eviction. The
    // eviction below is irreversible, so a snapshot that cannot be re-seeded
    // must be refused while the pre-base graph is still intact — the shipped
    // failure mode was the opposite: the eviction ran first, `reconcileParentTargets`
    // → `Link.addAnchor` then threw `LinkConfigError: unique-order`, and
    // `replay()`'s base branch swallowed it in a bare `catch {}` ⇒ empty graph,
    // `status: 'applied'`, no diagnostic.
    //
    // The checks are DATA ONLY — `loadState` (pure parse+validate) and pure
    // reads of the parsed data: NO `new Node` (construction calls `registerNode`,
    // so a scratch build before the eviction would clobber `scope.byId` for a
    // colliding id and mis-resolve family parents — a preflight must not mutate
    // the live graph), no registry write, no hub `Link` touched.
    //
    // THE PRODUCER DEFECT (measured 2026-11-23 — record it here because the
    // defect row's (a) description is WRONG): a host that registers the
    // bootstrap nodes through the documented `state !== 'prototype'` filter
    // registers a SEAM-WIRED def-root — compiling a
    // `component: [{ target: 'children', reference: '<def>' }]` consumer wires
    // the def-root under it, flipping its derived `state` from 'prototype' to
    // 'in-tree' — while that node STAYS in the scope's def-prototype registry.
    // `condense()` builds its census as `const kids = this.allNodes()` followed
    // by the registry prototypes with a PLAIN CONCAT (no dedupe), so the one
    // node object is pushed TWICE and `serializeSlice` ships the same node ID
    // twice in `doc.content` (measured on the RR-1 page: content ids
    // [node-1, node-2, node-3, node-4, node-5, node-4, node-3] — node-3 is the
    // def-root, node-4 its def-child). The row's (a) claim that the C2 strip is
    // keyed on derived STATE is false: it is keyed on registry-CENSUS membership
    // (`prototypeInstances.has(kid)`), so the strip already works. The real
    // producer defect is the UNDEDUPED census — a separate unit, deliberately
    // NOT fixed here (a dedupe would make this case pass as a successful restore
    // instead of a loud refusal, i.e. for the wrong reason).
    let parsedSeeds: NodeBaseData[]
    try {
      parsedSeeds = loadState(doc as never)
    } catch (e) {
      console.warn(
        `restore-refused-invalid-snapshot: the condensed base could not be parsed (${(e as Error)?.message ?? String(e)}) — seeding would throw after the graph was already EVICTED and left EMPTY. Restore refused — the current graph is kept as-is`,
      )
      return false
    }
    const refusal = this._baseSnapshotRefusal(doc, parsedSeeds)
    if (refusal !== undefined) {
      console.warn(
        `restore-refused-invalid-snapshot: ${refusal} — seeding would throw after the graph was already EVICTED and left EMPTY. Restore refused — the current graph is kept as-is`,
      )
      return false
    }
    // step 1 — drain + evict every pre-base node (synchronous critical section).
    // DEFECT-A fix (2026-08-25, X19/X20): drain only THIS scope's pending
    // queue — an isolated graph's restore must never finalize another graph's
    // nodes (a shared/default supervisor has one scope, so no behavior change).
    drainPendingDestroy(this.graphScope ?? undefined)
    for (const n of [...this.nodes.values()]) {
      // RESTORE-PATHKEY-DUPLICATION: dropping the evicted generation from
      // `this.nodes` does NOT take its anchors off the HUB-SHARED per-name
      // placement `Link`, so the re-seeded generation joins a Link that still
      // holds the old one — and `compilePath`'s placement fan-out then walks
      // BOTH generations, minting one path state per stale `container` anchor
      // with a `pathKey` byte-identical to the live one (two elements on one
      // wire; states and anchors grow by one generation per restore).
      // `destroy()` is the live node's own detach primitive: it removes THIS
      // node's `content`/`container` anchors via `removeAnchor` (never
      // `link.destroy()` — the Link is shared, so other producers/consumers
      // must keep their anchors) and dissolves the node's own per-node family
      // links, which also marks the generation for the sweep (terminal, so the
      // leaked generation stops being reachable from the shared Link).
      n.destroy()
      evictDestroyedNode(n)
      this.nodes.delete(n.id)
    }
    this.destroyedRefs.clear()
    // step 1b — DESTROY-SHARED-LINK-RESIDUE (`docs/defects.md`; gate
    // `docs/specs/serializer-census-gate-review.md` §1(a)/§3 item 1). The loop
    // above walks `this.nodes` only, so it can never reach the def-prototype
    // generation: plain prototypes are REGISTRY-ONLY (they stay out of
    // `this.nodes` — serialize.md §3 step 5), and doc ids are re-seeded
    // verbatim, so after the re-seed an id names BOTH generations. The only
    // generation-distinct handle is OBJECT IDENTITY in the live registry —
    // hence the enumerators, hub-filtered exactly like the condense census
    // (`:957-960`, ADV-S12: another graph's prototypes must not be touched).
    // `destroy()` → `destroyLinks` removes only `child`/`content`/`container`
    // (node.ts:956-973) — the `source`/`duplex`/`target` anchors (name-keyed
    // roles, node.ts:59) are NEVER removed, and those are exactly the anchors
    // the def registry recovers a name from (`defNameForLink`) and that every
    // provider read walks (`providerValueFromLink`, resolve.ts:36-47). Left in
    // place, the re-seeded generation joins a Link whose FIRST provider anchor
    // still belongs to the EVICTED generation, and a provider read returns a
    // DEAD provider's value (the order-dependence class of R-VPD-1). Detach
    // per instance with `removeAnchor` — never `link.destroy()` (the Link is
    // shared with the restored generation) — then evict. Runs BEFORE
    // `reRegisterDefPrototypes` (step 2), which overwrites the same registry
    // entries with the restored instances.
    const protoScope = this.graphScope ?? undefined
    const stalePrototypes = new Set<Node>()
    for (const [, protos] of defPrototypeEntries(protoScope)) for (const p of protos) if (p.hubFor === hub) stalePrototypes.add(p)
    for (const [, r] of defRootPrototypeEntries(protoScope)) if (r.hubFor === hub) stalePrototypes.add(r)
    for (const p of stalePrototypes) {
      for (const a of [...p.anchors]) {
        if (a.role === 'source' || a.role === 'duplex' || a.role === 'target') p.removeAnchor(a)
      }
      evictDestroyedNode(p)
      // INSTANCE-guarded (never id-keyed): a doc re-seeded verbatim makes the
      // id ambiguous across generations; only THIS object may be dropped.
      if (this.nodes.get(p.id) === p) this.nodes.delete(p.id)
    }
    // step 2 — the §3 recipe (D1: the round-trip, executed in-process).
    // The template (root) seeds FIRST, then the content states (the §3
    // ordering — a def-root must precede its def-children). The `loadState`
    // parse already ran in the pre-flight (step 0b) and is REUSED here — a
    // second parse would be the same data twice on the critical section.
    const seeds: Node[] = []
    const scope = this.graphScope ?? undefined
    seeds.push(new Node(doc.template as never, hub, undefined, false, scope))
    for (const d of parsedSeeds) seeds.push(new Node(d as never, hub, undefined, false, scope))
    reconcileParentTargets(seeds)
    reRegisterDefPrototypes(doc as never, hub, seeds as never[], scope)
    // RESTORE-REGISTERS-PROTOTYPES (`docs/defects.md`; gate
    // `serializer-census-gate-review.md` §1(c)/§3 item 3, disposition (i)):
    // step 5 of the §3 recipe registers the seeds in `this.nodes`, and the pin
    // "plain prototypes stay out of `this.nodes`" (serialize.md §3 step 5) is a
    // graph-shape invariant the translate path already honors. A plain
    // prototype seed is skipped HERE (this.nodes membership only — the module
    // registry already holds it from the constructor, and
    // `reRegisterDefPrototypes` above re-registered it, which is all the
    // seam/rows-mint machinery needs). A prototype is the seed the census
    // re-registered: after step 4 every census node derives 'prototype' (the
    // tripwire), so the derived state is the discriminator.
    for (const n of seeds) if (n.state !== 'prototype') this.registerNode(n)
    // RESTORE-INTEGRITY (a) — re-establish `contentNodes` scope membership.
    // `registerContentNode` is called by TRANSLATE/PAYLOAD only, so a restored
    // content root used to come back WITHOUT it: `state` still reads 'in-tree'
    // (the token is serialized with the seed), but once the node leaves the
    // tree the sweep's `isContentNode` exemption is gone and the payload-owned
    // root is FINALIZED where it used to persist ("payload-owned content
    // persists (placement may return)"). A content root is the node whose
    // FAMILY parent anchor targets the 'contentNodes' token — the same test
    // `node.state` uses (`stateFrom`); scoped through `scopeOf(node)` by
    // `registerContentNode` itself, so the seed's own graph scope is honored.
    // RESTORE-PLACED-CONTENT-MEMBERSHIP (`docs/defects.md`; gate §1(b)/§3 item
    // 2) — the token test above cannot see a PLACED content root:
    // `addAnchor` DESTROYS the 'contentNodes' placeholder edge the moment a
    // real family parent supersedes it (node.ts:1022-1023) and the document
    // records only the real parent, so a restored placed root came back
    // byte-indistinguishable from an authored tree node and lost its sweep
    // exemption. The snapshot now carries the ADVISORY `isContentRoot: true`
    // for a node that was content-owned at serialize time; it is honoured
    // ALONGSIDE the token test (an unplaced/token-parented root still has no
    // such flag and must keep working), and absent ⇒ today's behaviour.
    for (const n of seeds) {
      const child = n.childAnchor()
      const parentAnchor = child ? child.link.anchorsOf('parent')[0] : undefined
      if (parentAnchor !== undefined && parentAnchor.target === 'contentNodes') registerContentNode(n)
      else if (n.base.isContentRoot === true) registerContentNode(n)
    }
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
    return true
  }

  /** RESTORE-SEAM-STRIP-MISS-TOTAL-LOSS (2026-11-23), the (b) SWALLOW half,
   *  part 2 — the PRE-FLIGHT's checks over an ALREADY-PARSED condensed base
   *  (`loadState` ran in `_restoreBase` step 0b). Returns the refusal REASON, or
   *  `undefined` when the snapshot can be re-seeded into a live graph.
   *
   *  DATA ONLY by construction: no `new Node` (construction registers the node,
   *  which would clobber `scope.byId` for a colliding id and mis-resolve family
   *  parents before the eviction — a preflight that constructed a scratch
   *  generation would itself mutate the live graph), no registry write, no hub
   *  `Link` touched. Everything below reads the parsed doc and the parsed seeds.
   *
   *  WHAT IS **NOT** CHECKED HERE (deliberate, and named as a residual): the
   *  post-seed `state === 'prototype'` tripwire in `reRegisterDefPrototypes`
   *  needs CONSTRUCTION, so it cannot be pre-flighted — and it is currently
   *  unreachable anyway (the C2 strip drops the seam child anchors by
   *  registry-census membership, `serialize.ts:240-247`). If a future snapshot
   *  ever trips it, the throw happens AFTER the eviction: the graph is then
   *  emptied, but `replay()`'s `restore-failed` warn makes it LOUD instead of
   *  silent. Closing that residual needs the recipe to seed into a scratch
   *  scope, i.e. a contract change. */
  private _baseSnapshotRefusal(
    doc: { template: unknown; content: unknown[]; defPrototypes?: unknown },
    seeds: NodeBaseData[],
  ): string | undefined {
    // (1) NODE-ID UNIQUENESS — the id of `doc.template` PLUS the id of every
    // `doc.content` item must be distinct: a repeated id cannot be re-seeded
    // (`reconcileParentTargets` → `Link.addAnchor` throws
    // `LinkConfigError: unique-order` on the duplicated seed, measured), and
    // that throw is exactly what used to land after the eviction.
    //
    // The `doc.template` read is defensive (only a non-empty string counts — a
    // malformed snapshot such as `{ template: null, content: [] }` has none; it
    // is already refused by the parse above, this keeps the check shape-safe).
    //
    // ONE EXEMPTION, measured on the live recipe: the template id is ALLOWED to
    // appear ONCE among `doc.content` ids, because `condense()`'s census IS
    // `allNodes()`, which CONTAINS the root — so the template ships in `content`
    // too (measured on the CONTROL page: `template.id === 'node-41'` and
    // `content` ids `[node-41, node-42, node-44, node-43]`), and the recipe
    // already seeds that id twice (template + its content copy) in a restore
    // that SUCCEEDS today (`allNodes()` 2 → 2, `status: 'applied'`, no warn).
    // Treating the by-construction root copy as a duplicate would refuse every
    // healthy condense — a SECOND content occurrence is the duplication.
    const template = doc.template as { id?: unknown } | null | undefined
    const templateId = typeof template?.id === 'string' && template.id.length > 0 ? template.id : undefined
    const occurrences = new Map<string, number>()
    const countId = (id: string | undefined): void => {
      if (id === undefined) return
      occurrences.set(id, (occurrences.get(id) ?? 0) + 1)
    }
    countId(templateId)
    for (const item of doc.content) {
      // the parse above already enforced `typeof item.id === 'string'` for every
      // content entry (`parseNodeState`) — this read is schema-safe.
      countId((item as { id: string }).id)
    }
    for (const [id, count] of occurrences) {
      if (count <= (id === templateId ? 2 : 1)) continue
      return `the condensed snapshot ships one node twice (id "${id}" appears ${count}× among the seeded entries) — a snapshot with a repeated id cannot be re-seeded (\`reconcileParentTargets\` throws \`LinkConfigError: unique-order\` on the duplicated seed); the producer defect is \`condense()\`'s UNDEDUPED census (\`allNodes()\` + the def-prototype registry, plain concat)`
    }
    // (2) CENSUS MEMBERSHIP — every `doc.defPrototypes` entry's `nodeId` must be
    // one the snapshot actually ships. This is the same precondition
    // `reRegisterDefPrototypes` enforces as `NodeSchema-shape-mismatch`
    // (`serialize.ts:552-554`); checking it here means a bad doc is refused
    // BEFORE the eviction instead of throwing through it. The seed id set is the
    // recipe's own: the template seed (first) plus every parsed content seed.
    const census = doc.defPrototypes
    if (Array.isArray(census) && census.length > 0) {
      const seededIds = new Set<string>()
      if (templateId !== undefined) seededIds.add(templateId)
      for (const seed of seeds) if (typeof seed.id === 'string') seededIds.add(seed.id)
      for (const entry of census) {
        if (typeof entry !== 'object' || entry === null) continue
        const nodeId = (entry as { nodeId?: unknown }).nodeId
        if (typeof nodeId !== 'string' || seededIds.has(nodeId)) continue
        return `the def-prototype census names node "${nodeId}", which the condensed snapshot does not ship — \`reRegisterDefPrototypes\` would reject the doc (\`NodeSchema-shape-mismatch\`)`
      }
    }
    return undefined
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
    // DEFECT-B fix (2026-08-25 adversarial pass, X10/X11): a cross-graph
    // target guard. When THIS supervisor is ISOLATED (has a graphScope), its
    // ops must only act on nodes of ITS graph — a graph-A node passed as a
    // rows-mint/layer-apply/rows-clear target on a B supervisor would mint into
    // B while hanging the minted set off the graph-A node (a cross-graph family
    // link). Reject it. The DEFAULT path (no graphScope) keeps the shared
    // permissive contract.
    if (this.graphScope) {
      const guardTarget = op.kind === 'rows-mint' || op.kind === 'rows-clear' || op.kind === 'layer-apply'
        ? (op.target as Node | undefined)
        : node
      if (guardTarget && scopeOf(guardTarget) !== this.graphScope) {
        this.suppressJournal = prevSuppress
        return { status: 'rejected', error: { code: 'cross-graph-target' } }
      }
    }

    // UNDO-REDO-ADV-MAL (2026-08-26) — node-bearing ops must act on a REAL
    // Node (not a plain object), and attach/clone need a real target/source.
    // Malformed shapes are CONTAINED `malformed-op` rejections — never an
    // uncaught TypeError escaping the managed channel.
    const isNodeObject = (v: unknown): v is Node => !!v && typeof v === 'object' && (v as { isNode?: boolean }).isNode === true
    if (node !== undefined && !isNodeObject(node)) {
      this.suppressJournal = prevSuppress
      return { status: 'rejected', error: { code: 'malformed-op', detail: 'op.node must be a Node' } }
    }
    if ((op.kind === 'rows-mint' || op.kind === 'rows-clear' || op.kind === 'layer-apply') && op.target !== undefined && !isNodeObject(op.target)) {
      this.suppressJournal = prevSuppress
      return { status: 'rejected', error: { code: 'malformed-op', detail: 'op.target must be a Node' } }
    }
    if (op.kind === 'attach' && !isNodeObject(op.to)) {
      this.suppressJournal = prevSuppress
      return { status: 'rejected', error: { code: 'malformed-op', detail: 'attach requires a Node `to`' } }
    }
    // clone-instance's source may arrive as `op.source` (wire) or `op.node`
    // (internal); both are resolved + guarded below (unknown-node /
    // cross-scope) — no shape guard needed here.

    // before-compile: phase handlers run before the op executes (and its
    // compile/apply happens). Errors are contained by dispatchPhase. A QUIET
    // apply (the restore re-mint, ADV-S5) skips them — a restore is an
    // internal graph-REPLACE, not a user op.
    const phaseTarget = op.kind === 'layer-apply' || op.kind === 'rows-mint' || op.kind === 'rows-clear' ? (op.target as Node | undefined) : node
    if (phaseTarget && !this.quietApply) this.runPhaseOnNode('before-compile', phaseTarget)

    try {
      if (op.kind === 'state-slice') {
        // UNDO-REDO-ADV-MAL-1/MAL-2 (2026-08-26) — a malformed mutation
        // (missing/non-array, or a member missing a string `targetProp`) must
        // be a CONTAINED `malformed-op` rejection — never an uncaught TypeError
        // escaping the managed channel.
        const rawMutation = op.mutation
        if (!Array.isArray(rawMutation)) {
          return { status: 'rejected', error: { code: 'malformed-op', detail: 'state-slice mutation must be an array' } }
        }
        const mutation = rawMutation as { targetProp: string; mode: string; value: unknown }[]
        for (const m of mutation) {
          if (!m || typeof m.targetProp !== 'string') {
            return { status: 'rejected', error: { code: 'malformed-op', detail: 'state-slice mutation entry missing targetProp' } }
          }
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
        // ORPHAN-EMIT-TOP-LEVEL-LEAK (`docs/defects.md`, engine half;
        // `docs/specs/orphan-emit-gate-review.md` §5 D-3 — the ACCEPTED
        // disposition for the FAMILY-mode orphan: a documented limit PLUS a
        // diagnostic at the op site, never in emit). This branch is the only
        // place holding BOTH predicate facts: the container's routing (the same
        // expression pass-2 dispatch computes as `placementRouted`, below) and
        // the supervisor's compile mode. Container NOT placement-routed + mode
        // `family` ⇒ nothing appends the added node's state, so it emits as a
        // DETACHED TOP-LEVEL SIBLING, silently. WARN ONLY: the op still applies,
        // journals and dirties as before, and no state/render is touched (a
        // `path`-mode tree re-mints the container and appends — PBED-10 — and a
        // `content`-anchored container's path-states own the child: both silent).
        if (this.compileMode === 'family' && !container.anchors.some(a => a.role === 'content')) {
          const authored = (container.css?.id as string | undefined) ?? (container.props?.id as string | undefined)
          console.warn(`[placement-attach] placement-orphan: container ${container.id}${authored ? ` (#${authored})` : ''} is not placement-routed (no content anchor), so in FAMILY mode the added node's state will not be appended — it emits as a detached top-level sibling (ORPHAN-EMIT-TOP-LEVEL-LEAK); switching the tree to path mode re-mints the container and claims it, at the cost of a full re-key`)
        }
        const trigger = (op as { trigger?: PlacementTrigger }).trigger
          ?? derivePlacementTrigger(res.attachZone, res.containerAnchorMinted)
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [container.id, node!.id] })
        this.emitStructure('placement-attach', node!.id)
        this.markPass2(container.id, trigger)
        this.markPass2(node!.id, trigger)
        // PLACEMENT-SECOND-CONTAINER-STALE (`docs/defects.md`; gate record
        // `docs/specs/orphan-emit-gate-review.md` §5 D-9, the owner's ruling:
        // "if two nodes share a placement name, they both populate with nodes
        // targeting that placement"). The marked set above is only the
        // container the HOST passed, so every OTHER offering container is
        // never re-derived and keeps the `childOrder` it minted BEFORE this
        // attach — it can never append the added node. Widen the PASS-2
        // marking (only) to every offering container of the requested name:
        // the per-name placement Link holds one `container`-role anchor per
        // offering container, and `anchor.owner` is the node holding it. Same
        // coalesced tick, same trigger; the op's reported `dirtied` set and
        // its journal entry stay byte-identical (PBED-12b pins them).
        const others = new Set<NodeId>([container.id, node!.id])
        for (const a of hub.linkFor(res.attachZone, 'placement').anchors) {
          const owner = a.role === 'container' ? a.owner : undefined
          if (!owner || others.has(owner.id)) continue
          others.add(owner.id)
          this.markPass2(owner.id, trigger)
        }
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
        // ATTACH-UNREGISTERED-SILENT-NOOP (`docs/defects.md` row of that name;
        // tests/e2e/attach-registration.test.ts) — register-if-new, matching
        // the other four add-ops (placement-attach above, clone-instance,
        // layer-apply, rows-mint) and `placement-attach`'s pinned step 1
        // (`docs/specs/ops.md` §2.6). Without it the markPass2 below is
        // dropped by the flush's unregistered-id skip (`runPass2AndFlush`),
        // so the op reports applied while nothing renders. registerNode is
        // idempotent, so a re-attach of an already-registered node is
        // unchanged. The dirty set stays `[node.id]` (the container is not
        // marked — E2E-4's placement pin) and the journal shape is unchanged.
        this.registerNode(node as Node)
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
        // DEFECT-B/C fix (2026-08-25 adversarial pass, X12): a clone must land
        // in THIS supervisor's scope. An ISOLATED supervisor rejects a
        // cross-scope source (a graph-A node cloned into B).
        if (this.graphScope && scopeOf(source) !== this.graphScope) {
          return { status: 'rejected', error: { code: 'cross-graph-target' } }
        }
        const copy = source.clone('actor', {}, this.graphScope ?? undefined)
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
        // UNDO-REDO-ADV-MAL-3 (2026-08-26) — `nodes` must be an array; a
        // non-array (object/string) would throw in layerApply's `for...of`.
        if (!Array.isArray(op.nodes)) {
          return { status: 'rejected', error: { code: 'malformed-op', detail: 'layer-apply nodes must be an array' } }
        }
        const res = layerApply(op as never, { hub: target.hubFor ?? this.hub ?? null as never, nodes: this.nodes, ...(this.graphScope ? { graphScope: this.graphScope } : {}) })
        // supervisor visibility: every minted node is registered here so
        // getNode/allNodes/pass-2 resolve it (the minted-set registry tracks
        // ownership for teardown; the supervisor tracks the graph)
        for (const id of res.minted) {
          const n = this.graphScope ? this.graphScope.byId.get(id) : resolveNodeRef(id)
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
        const res = rowsMint(rowsOp as never, { hub: target.hubFor ?? this.hub ?? (null as never), nodes: this.nodes, ...(this.graphScope ? { graphScope: this.graphScope } : {}) })
        for (const id of res.minted) {
          const n = this.graphScope ? this.graphScope.byId.get(id) : resolveNodeRef(id)
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
          const n = this.graphScope ? this.graphScope.byId.get(id) : resolveNodeRef(id)
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
        const res = rowsClear(op as never, { hub: target.hubFor ?? this.hub ?? (null as never), nodes: this.nodes, ...(this.graphScope ? { graphScope: this.graphScope } : {}) })
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: res.doorways })
        // ADVERSARIAL-S5 (2026-08-24) — the mint-side consumer walk on
        // teardown too: rows-clear marks the field-name consumers pass-2 so
        // their stale fan-out arms refresh (the apply-time walk covers the
        // mint only; a clear/undo must not leave ghost arms in the store).
        const consumed = new Set<string>()
        for (const id of res.minted ?? []) {
          const n = this.graphScope ? this.graphScope.byId.get(id) : resolveNodeRef(id)
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

  replay(): UndoRedoReport {
    // UNDO-REDO-REPORT — the scheduled (pending-flush) dirty set, captured
    // from pass2Dirty AFTER the re-applies (the report reads the synchronous
    // scheduled set, NOT a journal scan — the dispatchAndReport O(n) pattern
    // is rejected; this is O(dirty-set)).
    const dirtied = new Set<NodeId>()
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
        // UNDO-REDO-ADV-MAL-6 (2026-08-26) — the base branch must be failure-
        // contained (mirror `condense`'s D5 containment at the journal point):
        // a malformed/corrupted base snapshot would otherwise throw a bare
        // TypeError OUT of replay (the try below wraps only the apply path).
        // RESTORE-SEAM-STRIP-MISS-TOTAL-LOSS (2026-11-23) — the (b) SWALLOW
        // half: containment must NEVER be the only thing between a host and an
        // empty graph. `_restoreBase` now refuses (returns false) BEFORE the
        // eviction for a snapshot it cannot re-seed, and reports whether the
        // graph was restored; a throw that still escapes (the post-eviction
        // residual: the post-seed `state === 'prototype'` tripwire) is LOUD
        // here instead of silent. Both the refusal warn and this one are
        // mutually exclusive per restore — a refusal returns `false` and never
        // reaches the catch.
        let restored = false
        try {
          if (snapshot) restored = this._restoreBase(snapshot)
        } catch (e) {
          // the swallow must never be the only thing between a host and an empty graph
          console.warn(`restore-failed: ${(e as Error)?.message ?? String(e)} — the graph is left as-is; a condensed-base restore must never empty the graph silently`)
          return this.report('no-op', dirtied)
        }
        // A REFUSED base leaves the graph as the PRE-base graph, so the
        // post-base entries must NOT be re-applied: re-applying them against the
        // un-rolled-back graph is a DOUBLE apply (rows-mint is not idempotent).
        // `'no-op'` is the honest word — nothing was applied — and it is already
        // in `UndoRedoReport`'s vocabulary (`'applied' | 'no-op' |
        // 'base-boundary'`); no new status value is invented.
        if (!restored) return this.report('no-op', dirtied)
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
          // UNDO-REDO-REPORT — accumulate the re-applied dirtied ids.
          if (Array.isArray(res.dirtied)) for (const id of res.dirtied) dirtied.add(id as NodeId)
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
    // (worst for non-idempotent rows-mint/destroy). UNDO-REDO-ADV-UR7
    // (2026-08-26) — the clear must ALSO fire on a NON-base replay: replay
    // re-applies EVERY journaled op, so any pre-replay undone entry (already
    // on the redoStack) is now re-applied in the journal — a later redo would
    // double-apply it. The redoStack is only meaningful against a live op
    // undone AFTER the replay; the pre-replay state is stale either way.
    this.redoStack = []
    // UNDO-REDO-REPORT — the report reflects the post-replay state.
    for (const id of this.pass2Dirty) dirtied.add(id)
    return this.report('applied', dirtied)
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

  undo(): UndoRedoReport {
    // UNDO-REDO-REPORT — the scheduled (pending-flush) dirty set, captured
    // from pass2Dirty AFTER the inverse runs (the report reads the synchronous
    // scheduled set, NOT a journal scan).
    const dirtied = new Set<NodeId>()
    // Feature 3 (ruling 19) — the base-boundary guard: an undo with no
    // post-base entries left (the undoStack was truncated at condense) would
    // have to cross the base marker — warn + fail, never a silent no-op,
    // never a partial restore.
    if (this.undoStack.length === 0) {
      if (this.journal.some((e) => e.op.kind === 'base')) {
        console.warn('base-boundary: undo cannot cross the condensed base marker (undoStack truncated at condense)')
        return this.report('base-boundary', new Set())
      }
      return this.report('no-op', new Set())
    }
    const entry = this.undoStack.pop()!
    this.redoStack.push(entry)
    const kind = entry.op.kind
    const rawNode = entry.op.node ?? entry.op.target
    const node = rawNode as Node
    if (!node) return this.report('no-op', new Set())
    // Feature 3 (D3) — the id-fallback: after a replay-from-base the pre-base
    // node OBJECTS are replaced by fresh seeds with the SAME ids; undo() must
    // re-resolve an evicted/destroyed live ref by id (mirror of replay's
    // resolution — prefer the live ref only when it is STILL this supervisor's
    // registered node; the wrong-node hazard note handoffs-review-4 §5).
    const resolved = !node.destroyed && this.nodes.get(node.id) === node ? node : (this.nodes.get(node.id) ?? null)
    if (!resolved) return this.report('no-op', new Set())
    try {
      if (kind === 'attach') {
        // DEFECT #12 — attach-undo uses the safe per-node detach too.
        // UNDO-REDO-ADV-UR4 (2026-08-26) — the detached node's state is stale
        // after the detach (detachNodeSafe only markPending → the sweep, never
        // pass-2); mark it pass2 so the report's `scheduledDirtied` + a host's
        // flush()+takePass2States() reflect the detached node.
        detachNodeSafe(resolved)
        this.markPass2(resolved.id)
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
          const res = this.apply({
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
          if (Array.isArray(res.dirtied)) for (const id of res.dirtied) dirtied.add(id as NodeId)
          // UNDO-REDO-ADV-UR2 (2026-08-26) — the preRecord inverse restores the
          // REUSED rows' values, but `res.dirtied` = doorways ∪ consumed (the
          // reused node is neither target nor minted) → the reused ids are
          // absent from the report. Accumulate them explicitly so a host's
          // flush()+takePass2States() refreshes the reused rows.
          if (Array.isArray(res.reused)) for (const id of res.reused) dirtied.add(id as NodeId)
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
              const minted = mintedByOrigin(record.layerId, this.graphScope ?? undefined)
              delete batches[hookName]
              resolved.rowsTeardown(record.layerId)
              resolved.removeLayer(record.layerId)
              // UNDO-REDO-ADV-UR3 (2026-08-26) — the teardown destroyed the
              // creator's batch + rows; the creator itself must be dirty (the
              // report's `scheduledDirtied` + a host's flush must reflect it).
              this.markPass2(resolved.id)
              for (const id of minted) {
                const n = this.graphScope ? this.graphScope.byId.get(id) : resolveNodeRef(id)
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
    // UNDO-REDO-REPORT — the report reflects the post-undo state.
    for (const id of this.pass2Dirty) dirtied.add(id)
    return this.report('applied', dirtied)
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
        // UNDO-REDO-ADV-ISO-1 (2026-08-26) — the consumer walk must not leak a
        // CROSS-GRAPH consumer id into this graph's report: when two isolated
        // scopes share one hub + the same per-name Link, a foreign-graph target
        // owner would otherwise be marked pass2 on THIS supervisor and appear
        // in the host-visible `scheduledDirtied`. Scope-filter the walk.
        if (!consumer || consumer === node || consumer.destroyed) continue
        if (this.graphScope && scopeOf(consumer) !== this.graphScope) continue
        consumer.markDirty('remote')
        this.markPass2(consumer.id)
      }
    }
  }

  redo(): UndoRedoReport {
    if (this.redoStack.length === 0) return this.report('no-op', new Set())
    const entry = this.redoStack.pop()!
    const op = { ...entry.op } as { kind: string; node?: Node; [key: string]: unknown }
    // Feature 3 (D3, ADV-S19) — id-resolve BOTH op.node AND op.target (the
    // rows ops carry their subject on op.target; a _restoreBase-evicted ref
    // must resolve to the restored seed).
    this._resolveOpRefs(op, entry.op)
    const dirtied = new Set<NodeId>()
    try {
      // no-journal re-apply + in-place result refresh; push the SAME entry to
      // undoStack (one journal entry per op — no double-undo) and never clear
      // the redoStack beyond the pop (redo-chains stay possible).
      const res = this.apply(op, { journal: false })
      if (res.status === 'applied') {
        // UNDO-REDO-REPORT — accumulate the re-applied dirtied ids.
        if (Array.isArray(res.dirtied)) for (const id of res.dirtied) dirtied.add(id as NodeId)
        // Feature 1b (D9) — preserve the original `preRecord` (same rationale
        // as replay: a redo's re-apply reads the CURRENT post-op state).
        const merged = { ...res } as { status: string; [key: string]: unknown }
        if ('preRecord' in (entry.result as object)) merged.preRecord = (entry.result as { preRecord?: unknown }).preRecord
        entry.result = merged
      } else {
        // UNDO-REDO-ADV-UR6 (2026-08-26) — a FAILED re-apply (rejected /
        // no-usable-state) must NOT be re-pushed onto the undoStack (it cannot
        // re-apply; re-pushing corrupts the stack) and must NOT report
        // `applied`. The entry stays popped off the redoStack; a later undo is
        // impossible for a failed redo.
        for (const id of this.pass2Dirty) dirtied.add(id as NodeId)
        return this.report('no-op', dirtied)
      }
      this.undoStack.push(entry)
    } catch {
      // redo reproduces same behavior
    }
    // UNDO-REDO-REPORT — the report reflects the post-redo state.
    for (const id of this.pass2Dirty) dirtied.add(id)
    return this.report('applied', dirtied)
  }
}
