import type { CompileResult, NodeId, NodeState, LayerMutationList, ApplyError } from './types.js'
import type { Supervisor, Node } from './node.js'

export type CompileStatus = 'ok' | 'pass-through' | 'annotated' | 'attribute-bound' | 'keyed' | 'unresolved-reference'

export interface ExposedState {
  nodeId: NodeId
  status: CompileStatus
  pathKey?: string
  state: NodeState
}

export interface ClientAPI {
  apply(nodeRef: NodeId, mutation: unknown): ApplyResponse
  getState(nodeRef: NodeId): ExposedState[]
}

export type ApplyResponse =
  | { status: 'applied'; journalId: string; dirtied: NodeId[] }
  | { status: 'no-usable-state'; nodeState: NodeState }
  | { status: 'rejected'; error: ApplyError }

export function createClient(supervisor: Supervisor): ClientAPI {
  return {
    apply(nodeRef: NodeId, mutation: unknown): ApplyResponse {
      const node = supervisor.getNode(nodeRef)
      if (!node) return { status: 'rejected', error: { code: 'unknown-node' } }
      let op: { kind: string; node: Node; [key: string]: unknown }
      if (Array.isArray(mutation)) {
        op = { kind: 'state-slice', node, mutation } as never
      } else if (typeof mutation === 'object' && mutation !== null) {
        const m = mutation as Record<string, unknown>
        op = { ...m, node } as never
        if (!op.kind) {
          op.kind = 'state-slice'
          op.mutation = [m]
        }
        // resolve string refs to Node objects (P3 §3.3: placement-attach's
        // `container` joins the family-op refs; the op spread above already
        // carried the trigger-identity fields through untouched)
        for (const refKey of ['to', 'source', 'container'] as const) {
          if (typeof op[refKey] === 'string') {
            const resolved = supervisor.getNode(op[refKey] as NodeId)
            if (resolved) op[refKey] = resolved
          }
        }
        const par = op.to as { parent?: unknown } | undefined
        if (par && typeof par.parent === 'string') {
          const resolved = supervisor.getNode(par.parent as NodeId)
          if (resolved) (op.to as Record<string, unknown>).parent = resolved
        }
      } else {
        return { status: 'rejected', error: { code: 'unknown-op' as never } }
      }
      const result = supervisor.apply(op)
      if (result.status === 'rejected') {
        return result as { status: 'rejected'; error: ApplyError }
      }
      if (result.status === 'no-usable-state') {
        return { status: 'no-usable-state', nodeState: (node as Node).state }
      }
      return result as { status: 'applied'; journalId: string; dirtied: NodeId[] }
    },
    getState(nodeRef: NodeId): ExposedState[] {
      const node = supervisor.getNode(nodeRef)
      if (!node) return []
      const slice = [...supervisor.allNodes()]
      const cr = node.compile(slice)
      const mine = cr.actionable.filter(cs => cs.nodeId === nodeRef)
      if (mine.length === 0) return []
      return mine.map(cs => {
        let status: CompileStatus = 'ok'
        if (cs.unresolved.length > 0) status = 'unresolved-reference'
        return { nodeId: cs.nodeId, status, pathKey: cs.pathKey, state: cs.state }
      })
    },
  }
}
