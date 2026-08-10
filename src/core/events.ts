import type { CompileStatus } from './client.js'
import type { NodeId, PathKey, StructuralOp } from './types.js'

export interface EventEnvelope {
  topic: string
  tick: number
  seq: number
  events: PreemptEvent[]
}

export type PreemptEvent =
  | { type: 'state'; nodeId: NodeId; fork?: { forkKey: PathKey; nodeIds: NodeId[] }; status: CompileStatus }
  | { type: 'structure'; op: StructuralOp['kind']; nodeId: NodeId }
  | { type: 'diagnostic'; code: 'circular-source'; trace: PathKey }

function stateKey(e: PreemptEvent): string | null {
  if (e.type !== 'state') return null
  return `${e.nodeId}\u0000${e.fork?.forkKey ?? ''}`
}

export function coalesceByTick(events: PreemptEvent[]): PreemptEvent[] {
  const seen = new Map<string, number>()
  const out: PreemptEvent[] = []
  for (const e of events) {
    const key = stateKey(e)
    if (key === null) {
      out.push(e)
      continue
    }
    const idx = seen.get(key)
    if (idx === undefined) {
      seen.set(key, out.length)
      out.push(e)
    } else {
      out[idx] = e
    }
  }
  return out
}

export class EventBridge {
  get state(): Set<NodeId> {
    return this.stateIds
  }
  private stateIds = new Set<NodeId>()
  private readonly subscribers = new Map<string, Set<(env: EventEnvelope) => void>>()
  private readonly buffers = new Map<string, PreemptEvent[]>()
  private seq = 0

  subscribe(topic: string, fn: (env: EventEnvelope) => void): () => void {
    let set = this.subscribers.get(topic)
    if (!set) {
      set = new Set()
      this.subscribers.set(topic, set)
    }
    set.add(fn)
    return () => {
      set.delete(fn)
    }
  }

  push(topic: string, e: PreemptEvent): void {
    let buf = this.buffers.get(topic)
    if (!buf) {
      buf = []
      this.buffers.set(topic, buf)
    }
    if (e.type === 'state') {
      // api.md §7 W2: at most one 'state' event per node per tick (keyed by nodeId + forkKey);
      // the last write of the batch wins.
      const key = `${e.nodeId}\u0000${e.fork?.forkKey ?? ''}`
      const idx = buf.findIndex((x) => x.type === 'state' && `${x.nodeId}\u0000${x.fork?.forkKey ?? ''}` === key)
      if (idx === -1) buf.push(e)
      else buf[idx] = e
    } else {
      buf.push(e)
    }
  }

  flush(tick: number): void {
    const stateIds = new Set<NodeId>()
    for (const [topic, buf] of [...this.buffers.entries()]) {
      if (buf.length === 0) continue
      const events = coalesceByTick(buf)
      buf.length = 0
      for (const e of events) {
        if (e.type === 'state') stateIds.add(e.nodeId)
      }
      const env: EventEnvelope = { topic, tick, seq: ++this.seq, events }
      const subs = this.subscribers.get(topic)
      if (subs) for (const fn of subs) fn(env)
    }
    this.stateIds = stateIds
  }
}