/**
 * renderProducingProcess — the EXPORTED canonical re-emit loop
 * (docs/specs/ssr-synthetic-event.md §2.4, handoffs-review REQ-GAP-5, user
 * ruling B). TDD: red-first — the loop does not exist yet.
 *
 * Pinned ownership rules (the loop is a PURE function; the caller owns state):
 *   (i)   the caller owns the per-tree `prevMap` (null on first render);
 *   (ii)  destroyed / not-in-tree nodes are pruned before emit;
 *   (iii) `takePass2States` is the CALLER's drain — the loop never drains it;
 *   (iv)  ON-DEMAND ONLY — calling it never dispatches.
 * The loop: emitElements (DEFAULT options) → diffMinimal → applyOps →
 * { els, ops, prevMap }.
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { renderProducingProcess } from '../../src/core/render-helpers.js'
import { renderProducingProcess as renderProducingProcessBarrel } from '../../src/index.js'
import { MockAdapter, type RenderOp } from '../../src/core/render.js'
import type { CompiledState } from '../../src/core/types.js'

type Actionable = CompiledState[]

/** The legacy envelope: a handler-bearing button with an authored css.id and
 *  a sibling span that never changes. */
const ENV = {
  template: {
    root: {
      type: 'div',
      component: [
        {
          reference: 'SayHi',
          value: {
            name: 'SayHi',
            body: `function (event, context) {
              context.node.receiveNextState({ content: String(event.value == null ? '' : event.value) + '!' });
            }`,
          },
        },
      ],
      children: [
        { type: 'button', css: { id: 'the-btn' }, component: [{ reference: 'SayHi', target: 'handlers.click' }], content: 'go' },
        { type: 'span', content: 'stable' },
      ],
    },
  },
  content: [],
  clientConfig: { runInstantiation: true, runRendering: true },
}

interface ProducingSetup {
  sup: Supervisor
  actionable: Actionable
  nodeById: Map<string, never>
  btnId: string
  spanId: string
}

/** The producing process (P1): translate → register → bootstrap compile →
 *  recordResolved. The actionable list + nodeById feed the loop. */
function producingSetup(): ProducingSetup {
  const t = translateLegacy(ENV)
  const sup = new Supervisor({ events: new EventBridge() })
  for (const n of t.nodes) sup.registerNode(n)
  const cr = t.root.compile(t.nodes)
  sup.recordResolved(cr.actionable)
  const nodeById = new Map(t.nodes.map((n) => [n.id, n])) as never
  const btn = t.nodes.find((n) => n.type === 'button')!
  const span = t.nodes.find((n) => n.type === 'span')!
  return { sup, actionable: cr.actionable, nodeById, btnId: btn.id, spanId: span.id }
}

/** Merge the caller-drained pass-2 states into the actionable list (the
 *  loop NEVER drains takePass2States — the caller owns the merge). */
function mergePass2(actionable: Actionable, pass2: Map<string, CompiledState[]>): Actionable {
  const out: Actionable = []
  for (const [id, states] of pass2) out.push(...states)
  for (const cs of actionable) {
    if (!pass2.has(cs.nodeId)) out.push(cs)
  }
  return out
}

describe('renderProducingProcess — the exported canonical re-emit loop (ssr-synthetic-event.md §2.4)', () => {
  it('barrel export — `renderProducingProcess` is importable from src/index.ts', () => {
    expect(typeof renderProducingProcessBarrel).toBe('function')
    expect(renderProducingProcessBarrel).toBe(renderProducingProcess)
  })

  it('first render with prevMap null CREATES the whole tree; the returned prevMap feeds a silent re-render', () => {
    const { actionable, nodeById } = producingSetup()
    const adapter = new MockAdapter()
    const r1 = renderProducingProcess(actionable, nodeById, adapter, null)
    expect(r1.ops.filter((o) => o.kind === 'create').length).toBeGreaterThan(0)
    expect(r1.ops.filter((o) => o.kind === 'remove')).toHaveLength(0)
    expect(r1.prevMap).not.toBeNull()
    // the returned prevMap is a NEW map, owned by the caller
    expect(r1.prevMap.size).toBe(r1.els.length)
    // a second render from the returned prevMap is a no-op (idempotent baseline)
    const r2 = renderProducingProcess(actionable, nodeById, adapter, r1.prevMap)
    expect(r2.ops).toHaveLength(0)
    expect(r2.els.map((e) => e.wire)).toEqual(r1.els.map((e) => e.wire))
  })

  it('re-render after a state-slice mutation is INCREMENTAL: set-only, no re-create of unchanged elements', async () => {
    const { sup, actionable, nodeById, btnId, spanId } = producingSetup()
    const adapter = new MockAdapter()
    const r1 = renderProducingProcess(actionable, nodeById, adapter, null)
    // dispatch on the producing graph (Phase A trigger → apply → microtask flush)
    const results = sup.dispatchEvent(btnId, 'click', 'hi')
    expect(results).toEqual([undefined])
    // the host awaits a task boundary (Supervisor.flush() is the supervisor's
    // own surface — the pinned host pattern here is a short setTimeout(0))
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    expect((sup.getNode(btnId) as { content?: unknown }).content).toBe('hi!')
    // caller drains pass-2 and merges the fresh states into the actionable list
    const pass2 = sup.takePass2States()
    const actionable2 = mergePass2(actionable, pass2)
    const r2 = renderProducingProcess(actionable2, nodeById, adapter, r1.prevMap)
    // incremental: no creates, no removes — ONLY the button's text set
    expect(r2.ops.filter((o) => o.kind === 'create')).toHaveLength(0)
    expect(r2.ops.filter((o) => o.kind === 'remove')).toHaveLength(0)
    const textSets = r2.ops.filter(
      (o): o is Extract<RenderOp, { kind: 'set' }> => o.kind === 'set' && o.name === 'text',
    )
    expect(textSets).toHaveLength(1)
    expect(textSets[0]!.wire).toBe(btnId)
    expect(textSets[0]!.value).toBe('hi!')
    // the unchanged span is silent
    expect(r2.ops.some((o) => o.kind === 'set' && o.wire === spanId)).toBe(false)
  })

  it('destroyed / not-in-tree nodes are PRUNED before emit — their wires are removed, never re-created', () => {
    const { sup, actionable, nodeById, spanId } = producingSetup()
    const adapter = new MockAdapter()
    const r1 = renderProducingProcess(actionable, nodeById, adapter, null)
    // destroy the span through the managed channel
    const spanNode = sup.getNode(spanId)!
    expect(sup.apply({ kind: 'destroy', node: spanNode }).status).toBe('applied')
    // the actionable list STILL contains the span's states (the caller did not prune)
    expect(actionable.some((cs) => cs.nodeId === spanId)).toBe(true)
    const r2 = renderProducingProcess(actionable, nodeById, adapter, r1.prevMap)
    // pruned: the span's element is gone; its wire is REMOVED, never re-created
    expect(r2.els.some((e) => e.wire === spanId)).toBe(false)
    expect(r2.ops.filter((o) => o.kind === 'remove').map((o) => o.wire)).toContain(spanId)
    expect(r2.ops.filter((o) => o.kind === 'create')).toHaveLength(0)
  })

  it('a DETACHED (not-in-tree) node is pruned the same way (state → unplaced ⇒ isInTree false)', () => {
    const { sup, actionable, nodeById, spanId } = producingSetup()
    const adapter = new MockAdapter()
    const r1 = renderProducingProcess(actionable, nodeById, adapter, null)
    const spanNode = sup.getNode(spanId)!
    expect(sup.apply({ kind: 'detach', node: spanNode }).status).toBe('applied')
    expect(spanNode.isInTree).toBe(false)
    const r2 = renderProducingProcess(actionable, nodeById, adapter, r1.prevMap)
    expect(r2.els.some((e) => e.wire === spanId)).toBe(false)
    expect(r2.ops.filter((o) => o.kind === 'remove').map((o) => o.wire)).toContain(spanId)
  })

  it('the loop is ON-DEMAND and adapter-neutral: applying through both adapters stays parity-consistent', () => {
    const { actionable, nodeById } = producingSetup()
    const adapter = new MockAdapter()
    const r1 = renderProducingProcess(actionable, nodeById, adapter, null)
    // the loop returns the op stream verbatim — a host can tee it to any adapter
    expect(r1.ops).toEqual(adapter.calls)
    // the prevMap chain keeps working across many calls
    let prevMap = r1.prevMap
    for (let i = 0; i < 3; i += 1) {
      const r = renderProducingProcess(actionable, nodeById, adapter, prevMap)
      expect(r.ops).toHaveLength(0)
      prevMap = r.prevMap
    }
  })

  it('REQ-GAP-8 — `renderOptions: { nodeIdAttribute: true }` threads through the loop: every emitted element carries data:node-id', () => {
    const { actionable, nodeById } = producingSetup()
    const adapter = new MockAdapter()
    const r = renderProducingProcess(actionable, nodeById, adapter, null, { nodeIdAttribute: true })
    expect(r.els.length).toBeGreaterThan(0)
    for (const el of r.els) {
      // the pinned contract: every stamped value is a REAL nodeId (a nodeById key)
      const stamped = el.props?.['data:node-id']
      expect(typeof stamped).toBe('string')
      expect(nodeById.has(stamped as string)).toBe(true)
    }
  })

  it('REQ-GAP-8 — the option is OPT-IN: the default loop render stays byte-identical (no data:node-id)', () => {
    const { actionable, nodeById } = producingSetup()
    const plain = renderProducingProcess(actionable, nodeById, new MockAdapter(), null)
    const opted = renderProducingProcess(actionable, nodeById, new MockAdapter(), null, { nodeIdAttribute: true })
    for (const el of plain.els) {
      expect(el.props?.['data:node-id']).toBeUndefined()
    }
    // the same underlying element set, differing ONLY in the data:node-id props
    expect(opted.els.map((e) => e.wire)).toEqual(plain.els.map((e) => e.wire))
    expect(plain.els.length).toBeGreaterThan(0)
  })

  it('REQ-GAP-8 — the option survives the prevMap chain (incremental re-renders keep stamping)', async () => {
    const { sup, actionable, nodeById, btnId } = producingSetup()
    const adapter = new MockAdapter()
    const r1 = renderProducingProcess(actionable, nodeById, adapter, null, { nodeIdAttribute: true })
    const results = sup.dispatchEvent(btnId, 'click', 'hi')
    expect(results).toEqual([undefined])
    await new Promise<void>((resolve) => setTimeout(resolve, 0))
    const pass2 = sup.takePass2States()
    const actionable2 = mergePass2(actionable, pass2)
    const r2 = renderProducingProcess(actionable2, nodeById, adapter, r1.prevMap, { nodeIdAttribute: true })
    expect(r2.ops.filter((o) => o.kind === 'create')).toHaveLength(0)
    expect(r2.els.some((e) => e.props?.['data:node-id'] !== undefined)).toBe(true)
  })
})