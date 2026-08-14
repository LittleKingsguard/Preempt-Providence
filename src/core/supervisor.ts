// src/core/supervisor.ts — the journaling mutation sink behind ClientAPI
// (api.md §1, §8): resolves ops, journals applied ones, drives pass-2
// compile + event emission, and supports replay/undo/redo.
//
// Depends on the Node class only through its public surface; `findCycle` is
// the sole runtime import from node.js (used at call time, so the circular
// import between the two modules is safe).
import { findCycle } from './node.js'
import type { Node } from './node.js'
import { Link } from './link.js'
import { CycleError, SingleParentError } from './errors.js'
import { EventBridge } from './events.js'
import { createClient } from './client.js'
import type { ClientAPI } from './client.js'
import { makeHandlerContext, dispatchPhase, dispatchPhaseForNodes } from './handlers.js'
import type { HandlerContext, HandlerPhase } from './handlers.js'
import { unregisterContentNode } from './registry.js'
import { placementChangeIrrelevant, activePlacementOf } from './resolve.js'
import { placementAttach, derivePlacementTrigger } from './ops.js'
import type { Anchor, CompiledState, LinkConfigNameHub, NodeId, NodeState, PlacementTrigger } from './types.js'

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

export class Supervisor {
  readonly journal: JournalEntry[] = []
  private readonly nodes: Map<NodeId, Node>
  private readonly hub: LinkConfigNameHub | null
  readonly events: EventBridge | null
  private undoStack: JournalEntry[] = []
  private redoStack: JournalEntry[] = []
  private client: ClientAPI | null = null
  private handlerCtx: HandlerContext | null = null

  constructor(rootOrOpts: Node | { hub?: LinkConfigNameHub; events?: EventBridge }, nodes?: Map<NodeId, Node>) {
    this.hub = null
    this.events = null
    if (rootOrOpts !== null && typeof rootOrOpts === 'object' && (rootOrOpts as { isNode?: boolean }).isNode === true) {
      const root = rootOrOpts as Node
      this.nodes = nodes ?? new Map<NodeId, Node>()
      this.nodes.set(root.id, root)
    } else {
      const opts = rootOrOpts as { hub?: LinkConfigNameHub; events?: EventBridge }
      this.nodes = new Map<NodeId, Node>()
      this.hub = opts.hub ?? null
      this.events = opts.events ?? null
    }
  }

  getNode(id: NodeId): Node | undefined {
    return this.nodes.get(id)
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
      this.runPass2AndFlush()
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
    this.journal.push(entry)
    this.undoStack.push(entry)
    this.redoStack = []
    return entry
  }

  apply(op: { kind: string; node?: Node; [key: string]: unknown }): {
    status: 'applied' | 'no-usable-state' | 'rejected'
    journalId?: string
    dirtied?: NodeId[]
    nodeState?: string
    error?: { code: string; detail?: unknown }
  } {
    const node = op.node as Node | undefined
    if (!node && op.kind !== 'clone-instance') {
      return { status: 'rejected', error: { code: 'unknown-node' } }
    }

    // before-compile: phase handlers run before the op executes (and its
    // compile/apply happens). Errors are contained by dispatchPhase.
    if (node) this.runPhaseOnNode('before-compile', node)

    try {
      if (op.kind === 'state-slice') {
        const mutation = op.mutation as { targetProp: string; mode: string; value: unknown }[]
        // placement/children writes are hard-blocked regardless of tree state (FS-10)
        for (const m of mutation) {
          if (m.targetProp.startsWith('placement') || m.targetProp === 'children') {
            return { status: 'rejected', error: { code: 'placement-target-blocked' } }
          }
        }
        const nodeState = (node as Node).state
        if (nodeState !== 'in-tree') {
          return { status: 'no-usable-state', nodeState }
        }
        ;(node as Node).applySlice(mutation as never)
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
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied })
        this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id, dirtied }
      }
      if (op.kind === 'destroy') {
        // explicit destroy: the node leaves the content source of truth too,
        // so the sweep finalizes it (content otherwise persists when detached)
        unregisterContentNode(node as Node)
        ;(node as Node).destroy()
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
        const childAnchor = (node as Node).anchors.find(a => a.role === 'child')
        if (childAnchor) {
          (childAnchor.link as unknown as Link).destroy()
        }
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [node!.id] })
        this.emitStructure('detach', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id, dirtied: [node!.id] }
      }
      if (op.kind === 'move') {
        const toParent = (op.to as { parent: Node }).parent
        if (findCycle(node as Node, toParent)) throw new CycleError((node as Node).id)
        const childAnchor = (node as Node).anchors.find(a => a.role === 'child')
        if (childAnchor) (childAnchor.link as unknown as Link).destroy()
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
        const entry = this.journalIfApplied(op, { status: 'applied', dirtied: [copy.id] })
        this.emitStructure('clone-instance', copy.id); this.markPass2(copy.id)
        return { status: 'applied', journalId: entry!.id, dirtied: [copy.id] }
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
    }
  }

  replay(): void {
    // Snapshot the stream: `apply` journals re-applied ops, so iterating the
    // LIVE array would keep visiting the appended entries — an infinite
    // journal-growth loop for any op that applies successfully on replay
    // (e.g. the idempotent placement-attach). The replayed ops are the ORIGINAL
    // entries only.
    for (const entry of [...this.journal]) {
      const op = { ...entry.op } as { kind: string; node?: Node; [key: string]: unknown }
      if (op.node) {
        op.node = this.nodes.get((op.node as Node).id) ?? op.node
      }
      try {
        this.apply(op)
      } catch {
        // replay reproduces same rejections silently
      }
    }
  }

  undo(): void {
    if (this.undoStack.length === 0) return
    const entry = this.undoStack.pop()!
    this.redoStack.push(entry)
    const kind = entry.op.kind
    const node = entry.op.node as Node
    if (!node) return
    const resolved = this.nodes.get(node.id) ?? node
    if (kind === 'attach') {
      const childAnchor = resolved.anchors.find(a => a.role === 'child')
      if (childAnchor) {
        (childAnchor.link as unknown as Link).destroy()
      }
    } else if (kind === 'destroy') {
      // destroy is terminal; undo is a no-op for destroyed nodes
    }
  }

  redo(): void {
    if (this.redoStack.length === 0) return
    const entry = this.redoStack.pop()!
    this.undoStack.push(entry)
    const op = { ...entry.op } as { kind: string; node?: Node; [key: string]: unknown }
    if (op.node) {
      op.node = this.nodes.get((op.node as Node).id!) ?? op.node
    }
    try {
      this.apply(op)
    } catch {
      // redo reproduces same behavior
    }
  }
}
