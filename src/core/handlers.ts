// src/core/handlers.ts — event handlers + handler context.
//
// A node's compiled `handlers` (HandlerDef[]) can carry event handlers
// (`event: 'click'`) and phase handlers (`phase: 'before-compile'` etc.).
// `dispatchEvent`/`dispatchPhase` invoke the bodies with a HandlerContext
// that gives handlers the managed mutation channel (ctx.clientAPI.apply),
// read-only state, and tree search (getNode/allNodes/ancestorsOf/
// descendantsOf) — mirroring the original project's handler contract.
//
// Handler bodies that throw are contained: the error is returned in the
// result list, never propagated into the render/compile flow.
import type { Node } from './node.js'
import type { ClientAPI } from './client.js'
import type { Supervisor } from './supervisor.js'
import type { CompiledState, HandlerDef, NodeId } from './types.js'

export type HandlerPhase = 'before-compile' | 'after-compile' | 'after-render'

export interface HandlerContext {
  clientAPI: ClientAPI
  supervisor: Supervisor
  /** The node being dispatched — set on the per-dispatch context only
   *  (variant A: handler visibility of the node). Undefined on the base
   *  context. */
  node?: Node
  /** The dispatched node's last-known resolved states (read-only — the same
   *  store as tree.getState; at after-compile this is THIS pass's states,
   *  since storeResolved runs before the dispatch). */
  states?: CompiledState[]
  tree: {
    getNode(id: NodeId): Node | undefined
    allNodes(): Node[]
    ancestorsOf(node: Node): Node[]
    descendantsOf(node: Node): Node[]
    getState(id: NodeId): CompiledState[]
  }
}

// Handlers read pass-1 compiled state via tree.getNode's value getters
// (type/props/css/content — always fresh, node.md §5) AND pass-2 RESOLVED
// values (component bindings, fork arms, pathKey) via the read-only surface:
//   - ctx.tree.getState(id): CompiledState[] — non-draining (reads
//     supervisor.getResolvedStates, never consumes the renderer's snapshot)
//   - node.resolved: CompiledState[] — read-only, populated by the supervisor
//     during pass-2 ({ focusNodeId } compiles)
// supervisor.takePass2States() remains renderer-owned (draining).
// Docs: handlers.md §2.1.

export function makeHandlerContext(supervisor: Supervisor, clientAPI: ClientAPI): HandlerContext {
  return {
    clientAPI,
    supervisor,
    tree: {
      getNode: (id: NodeId): Node | undefined => supervisor.getNode(id),
      allNodes: (): Node[] => supervisor.allNodes(),
      ancestorsOf(node: Node): Node[] {
        const out: Node[] = []
        let cur = node.parent
        while (cur) {
          out.push(cur)
          cur = cur.parent
        }
        return out
      },
      descendantsOf(node: Node): Node[] {
        const out: Node[] = []
        const stack: Node[] = [...node.children]
        while (stack.length > 0) {
          const cur = stack.pop()!
          out.push(cur)
          stack.push(...cur.children)
        }
        return out
      },
      getState: (id: NodeId): CompiledState[] => supervisor.getResolvedStates(id),
    },
  }
}

function handlersOf(node: Node): HandlerDef[] {
  return (node.handlers ?? []) as unknown as HandlerDef[]
}

export type HandlerResult = unknown

/** Per-dispatch context: enriches the shared base context with the node
 *  being dispatched + its last-known resolved states. Fresh object per
 *  dispatch — the shared base context is never mutated (no reentrancy
 *  clobbering across nested dispatches). Null / supervisor-less contexts
 *  (hand-rolled test contexts) pass through untouched. */
function scopedFor(node: Node, ctx: HandlerContext): HandlerContext {
  if (!ctx || ctx.node === node) return ctx
  return { ...ctx, node, states: ctx.supervisor?.getResolvedStates(node.id) ?? [] }
}

/** Run handlers whose `event` (or `name`) matches, with the given args. */
export function dispatchEvent(node: Node, ctx: HandlerContext, event: string, ...args: unknown[]): HandlerResult[] {
  const results: HandlerResult[] = []
  const scoped = scopedFor(node, ctx)
  for (const handler of handlersOf(node)) {
    if (handler.event !== event && handler.name !== event) continue
    if (typeof handler.body !== 'function') continue
    try {
      results.push(handler.body(scoped, ...args))
    } catch (e) {
      results.push(e)
    }
  }
  return results
}

/** Run handlers whose `phase` matches. */
export function dispatchPhase(node: Node, ctx: HandlerContext, phase: HandlerPhase): HandlerResult[] {
  const results: HandlerResult[] = []
  const scoped = scopedFor(node, ctx)
  for (const handler of handlersOf(node)) {
    if (handler.phase !== phase) continue
    if (typeof handler.body !== 'function') continue
    try {
      results.push(handler.body(scoped))
    } catch (e) {
      results.push(e)
    }
  }
  return results
}

/** Run a phase across a set of nodes (e.g. the dirty slice). */
export function dispatchPhaseForNodes(nodes: Node[], ctx: HandlerContext, phase: HandlerPhase): HandlerResult[] {
  const results: HandlerResult[] = []
  for (const node of nodes) results.push(...dispatchPhase(node, ctx, phase))
  return results
}
