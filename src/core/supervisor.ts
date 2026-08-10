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
import type { Anchor, LinkConfigNameHub, NodeId, NodeState } from './types.js'

let journalSeq = 0

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
    if (dirty.length > 0 && this.events) {
      const slice = this.allNodes()
      for (const nodeId of dirty) {
        const node = this.nodes.get(nodeId)
        if (!node || node.destroyed) continue
        const cr = node.compile(slice)
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
    this.eventTick++
    this.events?.flush(this.eventTick)
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
        (node as Node).destroy()
        const entry = this.journalIfApplied(op, { status: 'applied' })
        this.emitStructure('destroy', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id }
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
        const entry = this.journalIfApplied(op, { status: 'applied' })
        this.emitStructure('attach', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id }
      }
      if (op.kind === 'detach') {
        const childAnchor = (node as Node).anchors.find(a => a.role === 'child')
        if (childAnchor) {
          (childAnchor.link as unknown as Link).destroy()
        }
        const entry = this.journalIfApplied(op, { status: 'applied' })
        this.emitStructure('detach', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id }
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
        const entry = this.journalIfApplied(op, { status: 'applied' })
        this.emitStructure('move', node!.id); this.markPass2(node!.id)
        return { status: 'applied', journalId: entry!.id }
      }
      if (op.kind === 'clone-instance') {
        const source = node as Node
        const copy = source.clone('actor')
        this.registerNode(copy)
        const entry = this.journalIfApplied(op, { status: 'applied' })
        return { status: 'applied', journalId: entry!.id }
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
