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
import type { Anchor, CompiledState, LinkConfigNameHub, NodeId, NodeState } from './types.js'

let journalSeq = 0

/**
 * Bounded pass-2 slice for one changed node: the node itself, its ancestor
 * chain, its subtree, plus every source/duplex-bearing node (the fallback
 * universe — prototype/contentNodes-owned providers must stay discoverable
 * so their arms still terminate with the right drop reason).
 */
export function focusedSliceFor(node: Node, all: Node[]): Node[] {
  const set = new Map<NodeId, Node>()
  for (let cur: Node | null = node; cur; cur = cur.parent) set.set(cur.id, cur)
  const stack: Node[] = [...node.children]
  while (stack.length > 0) {
    const d = stack.pop()!
    set.set(d.id, d)
    stack.push(...d.children)
  }
  for (const n of all) {
    if (set.has(n.id)) continue
    if (n.anchors.some(a => (a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string')) {
      set.set(n.id, n)
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
   * Bounded pass-2 slice for one changed node: the node itself, its ancestor
   * chain, its subtree, plus every source/duplex-bearing node (the fallback
   * universe — prototype/contentNodes-owned providers must stay discoverable
   * so their arms still terminate with the right drop reason).
   */
  private focusedSlice(node: Node): Node[] {
    return focusedSliceFor(node, this.allNodes())
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

  private emitStructure(opKind: string, nodeId: NodeId): void {
    if (!this.events) return
    this.events.push('structure', { type: 'structure', op: opKind as never, nodeId })
    this.scheduleFlush()
  }

  private markPass2(nodeId: NodeId): void {
    this.pass2Dirty.add(nodeId)
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
        if (!node || node.destroyed) continue
        // bounded pass-2 (render.md §4): resolution walks are graph-based
        // (own → descendants → ancestors), so the slice only needs the
        // changed node's walk path plus every source-bearing node (the
        // fallback universe for prototype/owner-terminated arms). Unrelated
        // nodes are never recompiled or re-flagged.
        const cr = node.compile(this.focusedSlice(node), { focusNodeId: nodeId })
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
            const fork = cs.pathKey.includes('#f') && cs.trace
              ? { forkKey: cs.pathKey, nodeIds: cs.trace }
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
    for (const entry of this.journal) {
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
