// src/core/debug.ts — dev-only compile-pass logging.
//
// Off by default (tests stay quiet). Enabled explicitly by demos/dev builds
// via `setCompilePassLogging(true)`; `logCompilePass` then prints one line
// per compile pass with the processed node ids + derived states, so
// dirty-node isolation is verifiable in the browser (an incremental pass-2
// must list only the focused walk path + providers — never unrelated nodes).
import type { NodeId, NodeState } from './types.js'

let enabled = false

export function setCompilePassLogging(on: boolean): void {
  enabled = on
}

export function compilePassLogEnabled(): boolean {
  return enabled
}

export function logCompilePass(nodes: Array<{ id: NodeId; state: NodeState }>, focusNodeId?: NodeId): void {
  if (!enabled) return
  const focus = focusNodeId !== undefined ? ` focus=${focusNodeId}` : ''
  console.info(`[compile] pass over ${nodes.length} node(s)${focus}: ${nodes.map(n => `${n.id}(${n.state})`).join(' ')}`)
}
