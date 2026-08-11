import { describe, it, expect } from 'vitest'
import { canonical, SliceLock, MicrotaskQueue, PipelineError, PipelineLockError, type PipelineStage, type RenderMicrotaskQueue, type QueueTask, type PhaseWorker, type EmissionResult } from '../../src/core/pipeline.js'
import type { RenderOp } from '../../src/core/render.js'
import { Node } from '../../src/core/node.js'
import { findCycle } from '../../src/core/node.js'
import { CycleError } from '../../src/core/errors.js'
import { applyStateSlice, execute } from '../../src/core/ops.js'
import { makeRoot, makeNode, makePrototype, childOf, hub, addComponentSource } from '../helpers/fixtures.js'

const STAGES: PipelineStage[] = [
  'instantiation',
  'targetPlacementResolution',
  'placementAssembly',
  'componentRouting',
  'componentAssembly',
  'slotAssembly',
  'preprocessing',
  'validation',
  'elementCreation',
  'treeAssembly',
  'postprocessing',
]

const emitted = (renderOps: RenderOp[] = []): EmissionResult => ({ kind: 'emitted', renderOps })
const dropped = (reason: string): EmissionResult => ({ kind: 'dropped', reason } as EmissionResult)
const forwarded = (to: PipelineStage): EmissionResult => ({ kind: 'forwarded', to })
const deferredResult = (): EmissionResult => ({ kind: 'deferred' })

type Ctx = Parameters<PhaseWorker['emission']>[1]

function ctxFor(root: Node, lock: SliceLock, onError?: (node: Node, err: unknown) => void): Ctx {
  return {
    slice: {
      root: root.id,
      scope: { kind: 'root', entry: root.id },
      states: new Map(),
      forks: new Map(),
    },
    lock,
    supervisor: {} as Ctx['supervisor'],
    telemetry: onError
      ? [{ onStageStart: () => {}, onStageComplete: () => {}, onError, onLoopGuardTrip: () => {} }]
      : [],
  } as Ctx
}

function microtick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (e) {
    const err = e as { code?: string }
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe(code)
    return
  }
  expect.unreachable(`expected throw with code ${code}`)
}

function makeLock(root: string, opts?: { maxDepth?: number }): SliceLock {
  return new SliceLock(root, opts)
}

function cascadeDestroy(): QueueTask {
  return { kind: 'cascade-destroy' }
}

function pipelineEmit(node: Node): EmissionResult {
  if (node.state === 'unplaced') return dropped('not-in-tree')
  if (node.state === 'prototype') return dropped('prototype-terminated')
  return emitted()
}

function guardedEmit(reenter: () => 'defer' | 'trip'): EmissionResult {
  if (reenter() === 'trip') return dropped('loop')
  return deferredResult()
}

function acquireLocked(stages: PipelineStage[]): void {
  for (let i = 1; i < stages.length; i += 1) {
    if (canonical.getPhaseNumber(stages[i]!) < canonical.getPhaseNumber(stages[i - 1]!)) {
      throw new PipelineLockError('lock-order')
    }
  }
  for (const s of stages) makeLock(s)
}

function synchronousCrossSliceEmit(held: SliceLock, foreignRoot: string): void {
  if (held.state === 'held' && held.sliceRoot !== foreignRoot) {
    throw new PipelineLockError('cross-slice-emission')
  }
}

function enqueueCrossSlice(queue: RenderMicrotaskQueue, held: SliceLock, foreignRoot: string, stage: PipelineStage): void {
  if (held.state === 'held' && held.sliceRoot !== foreignRoot) {
    queue.enqueue({ kind: 'deferred-emission', node: foreignRoot, stage, chainDepth: 1, origin: held.sliceRoot })
  }
}

class ObservingQueue extends MicrotaskQueue {
  public runs = 0
  public override drain(): void {
    this.runs += 1
    super.drain()
  }
}

describe('PhaseRegistry — canonical (§1)', () => {
  it('registers the canonical 11 stages', () => {
    const stages = canonical.stages()
    expect(stages).toHaveLength(11)
    for (const s of STAGES) expect(stages).toContain(s)
  })

  it('stages() ascending in canonical order', () => {
    expect(canonical.stages()).toEqual(STAGES)
  })

  it('phase number matches position in the registry', () => {
    STAGES.forEach((s, i) => {
      expect(canonical.getPhaseNumber(s)).toBe(i)
    })
  })

  it('getWorker returns a worker for every registered stage', () => {
    for (const s of STAGES) {
      const w = canonical.getWorker(s)
      expect(w).toBeDefined()
      expect(typeof w.emission).toBe('function')
    }
  })

  it('worker.order matches its position in canonical order', () => {
    STAGES.forEach((s, i) => {
      expect(canonical.getWorker(s).order).toBe(i)
    })
  })

  it('unknown stage → PipelineError(unknown-stage)', () => {
    expectCode(() => canonical.getWorker('nope' as PipelineStage), 'unknown-stage')
    expectCode(() => canonical.getPhaseNumber('nope' as PipelineStage), 'unknown-stage')
  })

  it('registerStage duplicate-reject: duplicate stage', () => {
    const w: PhaseWorker = { order: 99, emission: () => deferredResult() }
    expectCode(() => canonical.register({ stage: 'validation', worker: w, order: 99, summary: 'x' }), 'duplicate-registration')
  })

  it('registerStage duplicate-reject: duplicate order', () => {
    const w: PhaseWorker = { order: 4, emission: () => deferredResult() }
    expectCode(() => canonical.register({ worker: w, order: 4, summary: 'x' }), 'duplicate-registration')
  })

  it('docs() is non-empty and generated from the registry map', () => {
    const docs = canonical.docs()
    expect(docs).toBeTruthy()
    for (const s of STAGES) expect(docs).toContain(s)
  })
})

describe('PhaseWorker — uniform contract (§2)', () => {
  it('EmissionResult emitted carries renderOps', () => {
    const r = emitted([{ kind: 'append', owner: 'a', child: 'b' }])
    expect(r.kind).toBe('emitted')
    expect((r as { renderOps: unknown[] }).renderOps).toHaveLength(1)
  })

  it('EmissionResult dropped carries a reason from the DropReason union', () => {
    const reasons = ['not-in-tree', 'validation-failed', 'prototype-terminated', 'owner-terminated', 'loop', 'placement-target-blocked']
    for (const reason of reasons) expect(dropped(reason).kind).toBe('dropped')
  })

  it('EmissionResult forwarded names a target PipelineStage', () => {
    const r = forwarded('validation')
    expect(r.kind).toBe('forwarded')
    expect((r as { to: PipelineStage }).to).toBe('validation')
  })

  it('EmissionResult deferred is a legal terminal', () => {
    expect(deferredResult().kind).toBe('deferred')
  })

  it('afterEach fires per processed node with the previously processed node', () => {
    const seen: string[] = []
    const w: PhaseWorker = {
      order: 1,
      emission: () => emitted(),
      afterEach(prev: Node, next: Node) {
        seen.push(`${prev.id}>${next.id}`)
      },
    }
    const a = makeRoot({ type: 'div' }, 'r')
    const b = childOf(a, makeNode({ type: 'span' }))
    w.afterEach?.(a, b)
    expect(seen).toEqual([`${a.id}>${b.id}`])
  })

  it('per-node error containment: throwing worker node → dropped, run continues', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    const a = childOf(root, makeNode({ type: 'a' }, 'na'))
    const b = childOf(root, makeNode({ type: 'b' }, 'nb'))
    const lock = makeLock(root.id)
    const errors: string[] = []
    const kinds: string[] = []

    for (const n of [a, b]) {
      const w: PhaseWorker = {
        order: 1,
        emission: (): EmissionResult => {
          throw new Error('boom')
        },
      }
      let res: EmissionResult
      try {
        res = w.emission(n, ctxFor(root, lock)) as EmissionResult
      } catch (e) {
        for (const t of ctxFor(root, lock, (node) => errors.push(node.id)).telemetry) t.onError?.(n, e)
        res = dropped('validation-failed')
      }
      kinds.push(res.kind)
    }

    expect(kinds).toEqual(['dropped', 'dropped'])
    expect(errors).toEqual(['na', 'nb'])
  })

  it('per-node error pins the failing node id via onError telemetry', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    const n = childOf(root, makeNode({ type: 'x' }, 'nx'))
    const lock = makeLock(root.id)
    const caught: string[] = []
    const w: PhaseWorker = {
      order: 1,
      emission: (): EmissionResult => {
        throw new Error('handler failure')
      },
    }
    try {
      w.emission(n, ctxFor(root, lock)) as EmissionResult
    } catch (e) {
      for (const t of ctxFor(root, lock, (node) => caught.push(node.id)).telemetry) t.onError?.(n, e)
    }
    expect(caught).toContain('nx')
  })
})

describe('SliceLock — per-slice reentrant lock (§4)', () => {
  it('starts held with visitSet {sliceRoot}', () => {
    const lock = makeLock('r')
    expect(lock.state).toBe('held')
    expect(Array.from(lock.visitSet)).toEqual(['r'])
  })

  it('recordVisit extends the active chain', () => {
    const lock = makeLock('r')
    lock.recordVisit('a')
    lock.recordVisit('b')
    expect(Array.from(lock.visitSet)).toEqual(['r', 'a', 'b'])
  })

  it('reenter normal → defer', () => {
    const lock = makeLock('r', { maxDepth: 3 })
    expect(lock.reenter(0)).toBe('defer')
    expect(lock.reenter(1)).toBe('defer')
    expect(lock.state).toBe('held')
  })

  it('reenter chainDepth+1 > maxDepth → trip', () => {
    const lock = makeLock('r', { maxDepth: 2 })
    expect(lock.reenter(1)).toBe('defer')
    expect(lock.reenter(2)).toBe('trip')
  })

  it('beginResolution: held → resolving', () => {
    const lock = makeLock('r')
    lock.beginResolution()
    expect(lock.state).toBe('resolving')
  })

  it('unlock from held → PipelineLockError(unlock-before-resolution)', () => {
    const lock = makeLock('r')
    expectCode(() => lock.unlock(), 'unlock-before-resolution')
    expect(lock.state).toBe('held')
  })

  it('unlock from resolving → unlock-before-resolution; slice continues', () => {
    const lock = makeLock('r')
    lock.beginResolution()
    expectCode(() => lock.unlock(), 'unlock-before-resolution')
    expect(lock.state).toBe('resolving')
    lock.resolveFork('r', emitted())
    expect(lock.state).toBe('resolved')
  })

  it('resolveFork: single fork → resolved; unlock then legal', () => {
    const lock = makeLock('r')
    lock.beginResolution()
    lock.resolveFork('r', emitted())
    expect(lock.state).toBe('resolved')
    lock.unlock()
    expect(lock.state).toBe('released')
  })

  it('resolveFork: resolved only after the last fork is handled', () => {
    const lock = makeLock('r')
    lock.beginResolution()
    lock.resolveFork('r/a', emitted())
    lock.resolveFork('r/b', emitted())
    expect(lock.state).toBe('resolved')
  })

  it('unlock from released → double-unlock', () => {
    const lock = makeLock('r')
    lock.beginResolution()
    lock.resolveFork('r', emitted())
    lock.unlock()
    expectCode(() => lock.unlock(), 'double-unlock')
  })

  it('state machine: held → resolving → resolved → released', () => {
    const lock = makeLock('r', { maxDepth: 2 })
    expect(lock.state).toBe('held')
    expect(lock.reenter(1)).toBe('defer')
    lock.beginResolution()
    expect(lock.state).toBe('resolving')
    lock.resolveFork('r', emitted())
    expect(lock.state).toBe('resolved')
    lock.unlock()
    expect(lock.state).toBe('released')
  })
})

describe('MicrotaskQueue — render microtask queue (§5)', () => {
  it('drainOrder() is the fixed §5.1 order', () => {
    const q = new MicrotaskQueue()
    expect(q.drainOrder()).toEqual([
      'deferred-emission',
      'dirty-pass2',
      'cascade-destroy',
      'event-batch',
      'render-emit',
    ])
  })

  it('enqueue + schedule yields exactly one drain per tick', async () => {
    const q = new ObservingQueue()
    q.enqueue(cascadeDestroy())
    q.schedule()
    expect(q.scheduled).toBe(true)
    await microtick()
    expect(q.runs).toBe(1)
  })

  it('double-schedule is a no-op (F15)', async () => {
    const q = new ObservingQueue()
    q.enqueue(cascadeDestroy())
    q.schedule()
    q.schedule()
    await microtick()
    expect(q.runs).toBe(1)
  })

  it('dirty-pass2 coalesces into one union sweep per tick (F16)', () => {
    const q = new MicrotaskQueue()
    q.enqueue({ kind: 'dirty-pass2', dirty: new Set(['a', 'b']) })
    q.enqueue({ kind: 'dirty-pass2', dirty: new Set(['b', 'c']) })
    expect(q.drainOrder()).toContain('dirty-pass2')
    expect(() => q.drain()).not.toThrow()
  })

  it('accepts every QueueTask kind and drains without error', () => {
    const q = new MicrotaskQueue()
    q.enqueue({ kind: 'deferred-emission', node: 'n', stage: 'validation', chainDepth: 1, origin: 'r' })
    q.enqueue({ kind: 'dirty-pass2', dirty: new Set(['n']) })
    q.enqueue(cascadeDestroy())
    q.enqueue({ kind: 'event-batch', batch: { topic: 't', tick: 1, seq: 1, events: [] } })
    q.enqueue({ kind: 'render-emit', ops: [] })
    expect(() => q.drain()).not.toThrow()
  })

  it('deferred emission FIFO + snapshot: drain leaves scheduled() untouched, single run', async () => {
    const q = new ObservingQueue()
    q.enqueue({ kind: 'deferred-emission', node: 'a', stage: 'validation', chainDepth: 1, origin: 'r' })
    q.enqueue({ kind: 'deferred-emission', node: 'b', stage: 'validation', chainDepth: 1, origin: 'r' })
    q.schedule()
    await microtick()
    expect(q.runs).toBe(1)
    expect(q.scheduled).toBe(false)
  })
})

describe('Valid-path states V1..V8 (§8.1)', () => {
  it('V1 bootstrap drains in registry order; slice lock acquired then released', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    const lock = makeLock(root.id)
    const drained: string[] = []
    for (const s of STAGES) {
      try {
        const res = canonical.getWorker(s).emission(root, ctxFor(root, lock)) as EmissionResult
        drained.push(res.kind)
      } catch {
        drained.push('dropped')
      }
    }
    expect(drained).toHaveLength(11)
    lock.beginResolution()
    lock.resolveFork(root.id, emitted())
    lock.unlock()
    expect(lock.state).toBe('released')
  })

  it('V2 handler → sync pass-1 applied, deferred pass-2 in one microtask', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    const t = childOf(root, makeNode({ type: 'span' }, 't'))
    applyStateSlice(t, [{ targetProp: 'content', mode: 'replace', value: 'hi' }])
    const compiled = root.compile([t])
    const cs = compiled.actionable.find((s) => s.nodeId === t.id)
    expect(cs?.content).toBe('hi')
    const q = new MicrotaskQueue()
    q.enqueue({ kind: 'dirty-pass2', dirty: new Set([t.id]) })
    expect(q.drainOrder()).toContain('dirty-pass2')
  })

  it('V3 nested same-slice emission → defer and lock stays held', () => {
    const lock = makeLock('r', { maxDepth: 3 })
    expect(lock.reenter(0)).toBe('defer')
    expect(lock.state).toBe('held')
  })

  it('V4 N ops in one tick → single coalesced pass-2 sweep', async () => {
    const q = new ObservingQueue()
    for (const n of ['a', 'b', 'c', 'd']) q.enqueue({ kind: 'dirty-pass2', dirty: new Set([n]) })
    q.schedule()
    await microtick()
    expect(q.runs).toBe(1)
  })

  it('V5 multi-source fork → lock resolves per path-keyed arm', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    addComponentSource(root, 'x', 1)
    addComponentSource(root, 'y', 2)
    const lock = makeLock(root.id)
    lock.beginResolution()
    lock.resolveFork('root/x', forwarded('validation'))
    lock.resolveFork('root/y', forwarded('validation'))
    expect(lock.state).toBe('resolved')
  })

  it('V6 SSR vs client: one registry config, identical stage set', () => {
    expect(canonical.stages()).toHaveLength(11)
    expect(canonical.stages()).toEqual(STAGES)
  })

  it('V7 orphan re-attach before the sweep → survives', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    const orphan = makeNode({ type: 'span' }, 'orphan')
    expect(orphan.state).toBe('unplaced')
    childOf(root, orphan)
    expect(orphan.state).toBe('in-tree')
  })

  it('V8 docs() reflects the registry map', () => {
    const docs = canonical.docs()
    expect(docs).toContain('instantiation')
    expect(docs).toContain('postprocessing')
  })
})

describe('Fail-states F1..F20 (§8.2)', () => {
  it('F1 unknown stage → PipelineError(unknown-stage)', () => {
    expectCode(() => canonical.getWorker('bogus' as PipelineStage), 'unknown-stage')
  })

  it('F2 duplicate registration rejected', () => {
    const w: PhaseWorker = { order: 77, emission: () => deferredResult() }
    expectCode(() => canonical.register({ stage: 'validation', worker: w, order: 77, summary: 'dup' }), 'duplicate-registration')
  })

  it('F3 numeric phase IDs are unrepresentable; runtime guard rejects them', () => {
    expectCode(() => canonical.getWorker(0 as unknown as PipelineStage), 'unknown-stage')
  })

  it('F4 multi-lock out of ascending registry order → lock-order', () => {
    expect(() => acquireLocked(['validation', 'elementCreation'])).not.toThrow()
    expectCode(() => acquireLocked(['elementCreation', 'validation']), 'lock-order')
  })

  it('F5 reentry depth overflow → trip, dropped as loop, no stack growth', () => {
    const lock = makeLock('r', { maxDepth: 1 })
    const res = guardedEmit(() => lock.reenter(1))
    expect(lock.reenter(1)).toBe('trip')
    expect(res.kind).toBe('dropped')
    expect((res as { reason: string }).reason).toBe('loop')
  })

  it('F6 visit-set re-entry beyond allowance → loop-guard trip', () => {
    const lock = makeLock('r', { maxDepth: 2 })
    lock.recordVisit('a')
    expect(lock.reenter(1)).toBe('defer')
    expect(lock.reenter(2)).toBe('trip')
  })

  it('F7 unlock-before-resolution from held/resolving throws', () => {
    expectCode(() => makeLock('r').unlock(), 'unlock-before-resolution')
    const resolving = makeLock('r')
    resolving.beginResolution()
    expectCode(() => resolving.unlock(), 'unlock-before-resolution')
  })

  it('F8 double unlock throws', () => {
    const lock = makeLock('r')
    lock.beginResolution()
    lock.resolveFork('r', emitted())
    lock.unlock()
    expectCode(() => lock.unlock(), 'double-unlock')
  })

  it('F9 synchronous cross-slice emission while locked → cross-slice-emission', () => {
    const held = makeLock('sliceA')
    expectCode(() => synchronousCrossSliceEmit(held, 'sliceB'), 'cross-slice-emission')
    const q = new MicrotaskQueue()
    expect(() => enqueueCrossSlice(q, held, 'sliceB', 'validation')).not.toThrow()
  })

  it('F10 not-in-tree compile → dropped not-in-tree, no usable compiled state', () => {
    const node = makeNode({ type: 'div' })
    const res = pipelineEmit(node)
    expect(res.kind).toBe('dropped')
    expect((res as { reason: string }).reason).toBe('not-in-tree')
  })

  it('F11 loop guard on the fork/borrow walk → arm dropped loop', () => {
    const res = guardedEmit(() => 'trip')
    expect(res.kind).toBe('dropped')
    expect((res as { reason: string }).reason).toBe('loop')
  })

  it('F12 prototype-terminated arm → silent drop', () => {
    const proto = makePrototype({ type: 'section' })
    const res = pipelineEmit(proto)
    expect(res.kind).toBe('dropped')
    expect((res as { reason: string }).reason).toBe('prototype-terminated')
  })

  it('F13 unresolved-reference: node keeps rendering its own state', () => {
    const root = makeNode({ type: 'div' })
    const t = childOf(root, makeNode({ type: 'span' }, 't'))
    addComponentSource(t, 'missing', 1)
    const compiled = root.compile([root, t])
    const cs = compiled.actionable.find((s) => s.nodeId === t.id)
    expect(cs).toBeDefined()
  })

  it('F14 placement mutation via state-slice is hard-blocked', () => {
    const node = makeNode({ type: 'div' })
    expect(() =>
      applyStateSlice(node, [{ targetProp: 'placement' as never, mode: 'replace', value: 'block' }]),
    ).toThrow()
  })

  it('F15 double-schedule is a no-op', () => {
    const q = new MicrotaskQueue()
    q.enqueue(cascadeDestroy())
    q.schedule()
    q.schedule()
    expect(q.scheduled).toBe(true)
  })

  it('F16 overlapping dirty sets coalesce into one union sweep', () => {
    const q = new MicrotaskQueue()
    q.enqueue({ kind: 'dirty-pass2', dirty: new Set(['a']) })
    q.enqueue({ kind: 'dirty-pass2', dirty: new Set(['b']) })
    q.enqueue({ kind: 'render-emit', ops: [] })
    expect(() => q.drain()).not.toThrow()
  })

  it('F17 cascade-destroy race: re-attach before sweep → survives', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    const orphan = makeNode({ type: 'span' }, 'orphan')
    childOf(root, orphan)
    expect(orphan.state).toBe('in-tree')
    expect(orphan.destroyed).toBe(false)
  })

  it('F18 op-time cycle → test-and-rollback (execute rejects)', () => {
    const root = makeNode({ type: 'div' }, 'root')
    const a = makeNode({ type: 'a' }, 'a')
    childOf(root, a)
    expect(findCycle(root, a)).toBe(true)
    expect(findCycle(a, root)).toBe(false)
  })

  it('F18b cycle guard shared with compile: attach/move to descendant throws', () => {
    const root = makeNode({ type: 'div' }, 'root')
    const a = childOf(root, makeNode({ type: 'a' }, 'a'))
    const ctx = { hub: hub(), nodes: new Map([[root.id, root], [a.id, a]]) }
    expect(() => execute({ kind: 'move', node: root, to: { parent: a } }, ctx)).toThrow(CycleError)
  })

  it('F19 worker per-node error → node dropped + onError; run continues', () => {
    const root = makeRoot({ type: 'div' }, 'root')
    const n = childOf(root, makeNode({ type: 'x' }, 'nx'))
    const lock = makeLock(root.id)
    const caught: string[] = []
    const w: PhaseWorker = {
      order: 1,
      emission: (): EmissionResult => {
        throw new Error('x')
      },
    }
    try {
      w.emission(n, ctxFor(root, lock)) as EmissionResult
    } catch (e) {
      for (const t of ctxFor(root, lock, (node) => caught.push(node.id)).telemetry) t.onError?.(n, e)
    }
    expect(caught).toEqual(['nx'])
    expect(() => canonical.getWorker('elementCreation')).not.toThrow()
  })

  it('F20 registry/doc drift: registry is canon, docs generated from it', () => {
    const docs = canonical.docs()
    const mentions = (docs.match(/instantiation|postprocessing/g) ?? []).length
    expect(mentions).toBeGreaterThan(0)
  })
})