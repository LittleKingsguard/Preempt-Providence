/**
 * Phase-handler contract — Supervisor.runPhase + ordering hooks.
 * Written against the STUB surface; the implementation must satisfy:
 *   before-compile → after-compile (before render) → after-render
 */
import { describe, it, expect } from 'vitest'
import { Supervisor, focusedSliceFor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { Node } from '../../src/core/node.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor, familyLink } from '../helpers/fixtures.js'
import type { HandlerContext, HandlerPhase } from '../../src/core/handlers.js'

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const root = makeRoot()
  supervisor.registerNode(root)
  return { supervisor, events, root }
}

async function flushTicks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

describe('Supervisor phase hooks (stub contract)', () => {
  it('exposes clientAPI and a handler context on the supervisor', () => {
    const { supervisor } = newSystem()
    expect(typeof supervisor.clientAPI.apply).toBe('function')
    expect(typeof supervisor.clientAPI.getState).toBe('function')
    expect(typeof supervisor.handlerContext.tree.allNodes).toBe('function')
    expect(typeof supervisor.handlerContext.tree.getNode).toBe('function')
    expect(typeof supervisor.handlerContext.tree.ancestorsOf).toBe('function')
    expect(typeof supervisor.handlerContext.tree.descendantsOf).toBe('function')
    expect(supervisor.handlerContext.clientAPI).toBe(supervisor.clientAPI)
  })

  it('after-compile bodies receive ctx.node (the focused node) and ctx.states (THIS pass)', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ content: 'orig' }))
    supervisor.registerNode(n)
    let seen: { nodeId: string | undefined; contents: unknown[] | undefined } = { nodeId: undefined, contents: undefined }
    n.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'self-id',
          phase: 'after-compile',
          body: (c: HandlerContext) => { seen = { nodeId: c.node?.id, contents: c.states?.map((s) => s.content) } },
        },
      ],
    })

    const res = supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    expect(res.status).toBe('applied')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    // the body identified ITS OWN node and saw THIS pass's fresh state
    expect(seen.nodeId).toBe(n.id)
    expect(seen.contents).toEqual(['x'])
  })

  it('an after-compile body updates its OWN node via ctx.node (the fork-stress marker pattern)', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    let fires = 0
    n.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'mark',
          phase: 'after-compile',
          body: (c: HandlerContext) => {
            fires += 1
            const me = c.node
            if (!me || me.props?.['mark:done']) return
            c.clientAPI.apply(me.id, [{ targetProp: 'props.mark:done', mode: 'replace', value: true }])
          },
        },
      ],
    })

    const res = supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    expect(res.status).toBe('applied')
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(n.props['mark:done']).toBe(true)
    // the marker re-dirties the node → one re-fire that no-ops (idempotent)
    expect(fires).toBe(2)
  })

  it('runPhase dispatches a phase on a single node and on all nodes', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const hits: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [{ name: 'p', phase: 'after-render', body: () => hits.push('single') }],
    })
    root.addLayer({
      id: 'h',
      handlers: [{ name: 'p', phase: 'after-render', body: () => hits.push('all') }],
    })

    supervisor.runPhase('after-render', n.id)
    expect(hits).toEqual(['single'])
    supervisor.runPhase('after-render')
    expect(hits).toEqual(['single', 'all', 'single'])
  })

  it('runPhase with an unknown node id is a safe no-op', () => {
    const { supervisor } = newSystem()
    expect(() => supervisor.runPhase('before-compile', 'nope')).not.toThrow()
  })

  it('apply() runs before-compile handlers on the op node before the op executes', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ content: 'orig' }))
    supervisor.registerNode(n)
    const order: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [
        { name: 'pre', phase: 'before-compile', body: () => order.push('pre:' + n.content) },
      ],
    })

    const res = supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'new' }] })
    expect(res.status).toBe('applied')
    // before-compile observed the PRE-op value; the op applied after
    expect(order).toEqual(['pre:orig'])
    expect(n.content).toBe('new')
  })

  it('pass-2 flush runs after-compile (before render) then after-render, in order', async () => {
    const { supervisor, events, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const order: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [
        { name: 'after', phase: 'after-compile', body: () => order.push('after-compile') },
        { name: 'rendered', phase: 'after-render', body: () => order.push('after-render') },
      ],
    })
    events.subscribe('state', () => order.push('state-event'))

    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'v' }] })
    // pass-2 + events flush on the microtask queue
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(order).toEqual(['after-compile', 'state-event', 'after-render'])
  })

  it('the three phases run in order across an apply+flush cycle', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const order: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [
        { name: 'pre', phase: 'before-compile', body: () => order.push('before-compile') },
        { name: 'after', phase: 'after-compile', body: () => order.push('after-compile') },
        { name: 'rendered', phase: 'after-render', body: () => order.push('after-render') },
      ],
    })

    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))

    expect(order).toEqual(['before-compile', 'after-compile', 'after-render'])
    void (null as unknown as HandlerPhase)
  })
})

describe('focusedSliceFor — bounded pass-2 slices stay bounded (no all-tree scans per pass)', () => {
  it('excludes the source-bearing universe when the walk path has NO targets (no resolution can run, so the fallback is dead weight)', () => {
    const root = makeRoot()
    const child = makeNode({ type: 'div' })
    childOf(root, child)
    // every node is a source PROVIDER (values-style page): providers on the
    // walk path resolve depth-0 at themselves and never need the universe
    addComponentSource(child, 'values-1.a', 'value-A-1')
    addComponentSource(root, 'values-0.a', 'value-A-0')
    // an OFF-PATH provider must NOT be swept into the slice
    const offPath = makeNode({ type: 'div' })
    addComponentSource(offPath, 'values-9.b', 'value-B-9')
    const slice = focusedSliceFor(child, [root, child, offPath])
    expect(slice.map((n) => n.id).sort()).toEqual([root.id, child.id].sort())
  })

  it('keeps the universe when the walk path carries a target (arm termination needs the fallback)', () => {
    const root = makeRoot()
    const child = makeNode({ type: 'div' })
    childOf(root, child)
    targetAnchor(child, 'theme')
    const provider = makeNode({ type: 'div' })
    addComponentSource(provider, 'ghost', 'x')
    const slice = focusedSliceFor(child, [root, child, provider])
    expect(slice.map((n) => n.id).sort()).toEqual([root.id, child.id, provider.id].sort())
  })

  it('shared-hub trees: the per-name component Link provides the providers — NO full-graph sweep (slice = walk path only)', () => {
    const h = hub()
    const root = new Node({ type: 'app' }, h)
    familyLink(root, 'rootNode')
    const child = new Node({ type: 'div' }, h)
    childOf(root, child)
    child.addAnchor('target', 'theme', {}, h.linkFor('theme', 'component'))
    // an off-path prototype provider sharing the SAME hub: the link knows it
    const provider = new Node({ type: 'section' }, h)
    familyLink(provider, 'component')
    const src = provider.addAnchor('source', 'theme', {}, h.linkFor('theme', 'component'))!
    src.value = 'dark'
    const slice = focusedSliceFor(child, [root, child, provider])
    expect(slice.map((n) => n.id).sort()).toEqual([root.id, child.id].sort())
  })
})

describe('Supervisor event dispatch (Phase A — dispatchEvent engine wiring)', () => {
  it('dispatches the matching event on a Node target and returns the contained results', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const hits: string[] = []
    n.addLayer({
      id: 'h',
      handlers: [{ name: 'click', event: 'click', body: () => { hits.push('fired'); return 'ok' } }],
    })
    const results = supervisor.dispatchEvent(n, 'click')
    expect(hits).toEqual(['fired'])
    expect(results).toEqual(['ok'])
  })

  it('resolves a nodeId string target', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    let hits = 0
    n.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => { hits++ } }] })
    const results = supervisor.dispatchEvent(n.id, 'click')
    expect(hits).toBe(1)
    expect(results).toEqual([undefined])
  })

  it('resolves a fork-arm wire (nodeId#<i>) to the node and fires ONCE with all arms in ctx.states', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ type: 'card' }))
    supervisor.registerNode(n)
    targetAnchor(n, 'color')
    const pRed = childOf(n, makeNode({ type: 'pRed' }))
    const pBlue = childOf(n, makeNode({ type: 'pBlue' }))
    supervisor.registerNode(pRed)
    supervisor.registerNode(pBlue)
    addComponentSource(pRed, 'color', 'red')
    addComponentSource(pBlue, 'color', 'blue')
    let fires = 0
    let seenArms = -1
    n.addLayer({
      id: 'h',
      handlers: [{ name: 'click', event: 'click', body: (c: HandlerContext) => { fires++; seenArms = c.states?.length ?? -1 } }],
    })
    supervisor.apply({ kind: 'state-slice', node: n, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    await flushTicks()
    expect(supervisor.getResolvedStates(n.id)).toHaveLength(2) // two fork arms
    supervisor.dispatchEvent(`${n.id}#0`, 'click')
    expect(fires).toBe(1) // fired ONCE for the node, never once-per-arm
    expect(seenArms).toBe(2) // all arms exposed via ctx.states
  })

  it('unknown / unresolvable targets → [] without throwing', () => {
    const { supervisor } = newSystem()
    expect(() => supervisor.dispatchEvent('nope', 'click')).not.toThrow()
    expect(supervisor.dispatchEvent('nope', 'click')).toEqual([])
  })

  it('destroyed targets → [] (the handler never fires)', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    n.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => { throw new Error('should not run') } }] })
    n.markDestroyed()
    expect(supervisor.dispatchEvent(n.id, 'click')).toEqual([])
  })

  it('`#`-in-nodeId resolution order: full string first, then first-`#` prefix', () => {
    const { supervisor, root } = newSystem()
    const a = childOf(root, makeNode({ type: 'div' }, 'a'))
    const aHashB = childOf(root, makeNode({ type: 'div' }, 'a#b'))
    supervisor.registerNode(a)
    supervisor.registerNode(aHashB)
    const hits: string[] = []
    a.addLayer({ id: 'ha', handlers: [{ name: 'click', event: 'click', body: () => hits.push('A') }] })
    aHashB.addLayer({ id: 'hb', handlers: [{ name: 'click', event: 'click', body: () => hits.push('A#B') }] })
    supervisor.dispatchEvent('a#0', 'click') // the fork-arm wire of node 'a' → A
    supervisor.dispatchEvent('a#b', 'click') // the FULL-string node id 'a#b' → A#B
    expect(hits).toEqual(['A', 'A#B'])
  })

  it('reentrancy: a body dispatching the SAME node+event no-ops (guard); a DIFFERENT event still fires', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    let entered = 0
    let focusFired = 0
    n.addLayer({
      id: 'h',
      handlers: [
        { name: 'click', event: 'click', body: (c: HandlerContext) => { entered++; c.supervisor.dispatchEvent(n.id, 'click'); c.supervisor.dispatchEvent(n.id, 'focus') } },
        { name: 'focus', event: 'focus', body: () => { focusFired++ } },
      ],
    })
    supervisor.dispatchEvent(n.id, 'click')
    expect(entered).toBe(1) // the nested same-event dispatch was guarded
    expect(focusFired).toBe(1) // a DIFFERENT event is not blocked by the guard
  })

  it('containment: throwing bodies return the error in the results, never propagate', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    n.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => { throw new Error('boom') } }] })
    const results = supervisor.dispatchEvent(n.id, 'click')
    expect(results).toHaveLength(1)
    expect(results[0]).toBeInstanceOf(Error)
    expect((results[0] as Error).message).toBe('boom')
  })

  it('no propagation: only the TARGET node\'s matching handlers fire', () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    const hits: string[] = []
    root.addLayer({ id: 'hr', handlers: [{ name: 'click', event: 'click', body: () => hits.push('ROOT') }] })
    n.addLayer({ id: 'hn', handlers: [{ name: 'click', event: 'click', body: () => hits.push('NODE') }] })
    supervisor.dispatchEvent(n.id, 'click')
    expect(hits).toEqual(['NODE'])
  })

  it('dispatch is a trigger, never a drain: with no applies it produces no pass-2 states', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    n.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => 'read-only' }] })
    supervisor.dispatchEvent(n.id, 'click')
    await flushTicks()
    expect(supervisor.takePass2States().size).toBe(0) // nothing drained, nothing scheduled
  })
})

describe('shared dispatch-report (ssr-synthetic-event.md §3 — dispatchAndReport + flush + opt-in requestId dedup)', () => {
  it('report shape: results mirror dispatchEvent; dirtied contains the applied sibling; the report consumed the pass-2 drain', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    const sibling = childOf(root, makeNode({ content: 'orig' }))
    supervisor.registerNode(n)
    supervisor.registerNode(sibling)
    n.addLayer({
      id: 'h',
      handlers: [{
        name: 'click', event: 'click',
        body: (c: HandlerContext) => {
          c.clientAPI.apply(sibling.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }])
          return 'ok'
        },
      }],
    })
    const report = await supervisor.dispatchAndReport(n.id, 'click')
    expect(report.results).toEqual(['ok'])
    expect(report.dirtied).toContain(sibling.id)
    // the report took pass-2 states as its caller — the drain is consumed
    expect(supervisor.takePass2States().size).toBe(0)
  })

  it('dirtied includes pass-2 state keys: the walk-path root recompiles via takePass2States although the journal dirtied names only the apply target', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ content: 'orig' }))
    supervisor.registerNode(n)
    n.addLayer({
      id: 'h',
      handlers: [{
        name: 'click', event: 'click',
        body: (c: HandlerContext) => {
          c.clientAPI.apply(n.id, [{ targetProp: 'content', mode: 'replace', value: 'y' }])
        },
      }],
    })
    const report = await supervisor.dispatchAndReport(n.id, 'click')
    expect(report.dirtied).toContain(n.id)
    // the root is NOT in the journal's dirtied ([n.id] only) — it appears via
    // the pass-2 walk-path recompile (keys of takePass2States)
    expect(report.dirtied).toContain(root.id)
  })

  it('unknown / destroyed / unplaced targets → { results: [], dirtied: [] }', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    n.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => 'should-not-run' }] })
    expect(await supervisor.dispatchAndReport('nope', 'click')).toEqual({ results: [], dirtied: [] })
    const unplaced = makeNode()
    supervisor.registerNode(unplaced)
    unplaced.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => 'should-not-run' }] })
    expect(await supervisor.dispatchAndReport(unplaced.id, 'click')).toEqual({ results: [], dirtied: [] })
    n.markDestroyed()
    expect(await supervisor.dispatchAndReport(n.id, 'click')).toEqual({ results: [], dirtied: [] })
  })

  it('requestId dedup: a duplicate returns the FIRST call\'s report and the dispatch ran once', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    let fires = 0
    n.addLayer({
      id: 'h',
      handlers: [{
        name: 'click', event: 'click',
        body: (c: HandlerContext) => { fires++; c.clientAPI.apply(n.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }]); return 'r' },
      }],
    })
    const first = await supervisor.dispatchAndReport(n.id, 'click', { requestId: 'req-1' })
    const jLen = supervisor.journal.length
    const second = await supervisor.dispatchAndReport(n.id, 'click', { requestId: 'req-1' })
    expect(fires).toBe(1)
    expect(second).toEqual(first)
    expect(second).toBe(first) // idempotent ECHO — the first caller's report object
    expect(supervisor.journal.length).toBe(jLen) // no second dispatch ran
  })

  it('concurrent requestId duplicates: both resolve to the same report and the dispatch ran once', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    let fires = 0
    n.addLayer({
      id: 'h',
      handlers: [{
        name: 'click', event: 'click',
        body: (c: HandlerContext) => { fires++; c.clientAPI.apply(n.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }]); return 'r' },
      }],
    })
    const [a, b] = await Promise.all([
      supervisor.dispatchAndReport(n.id, 'click', { requestId: 'req-2' }),
      supervisor.dispatchAndReport(n.id, 'click', { requestId: 'req-2' }),
    ])
    expect(fires).toBe(1) // the duplicate awaited the FIRST call's in-flight promise
    expect(a).toEqual(b)
    expect(a).toBe(b)
    expect(a.results).toEqual(['r'])
    expect(a.dirtied).toContain(n.id)
  })

  it('requestId reused with a DIFFERENT (target, event) is a miss — the stale report is never echoed', async () => {
    const { supervisor, root } = newSystem()
    const n1 = childOf(root, makeNode())
    const n2 = childOf(root, makeNode())
    supervisor.registerNode(n1)
    supervisor.registerNode(n2)
    let fires1 = 0
    let fires2 = 0
    n1.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => { fires1++; return 'one' } }] })
    n2.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => { fires2++; return 'two' } }] })
    const first = await supervisor.dispatchAndReport(n1.id, 'click', { requestId: 'req-3' })
    const second = await supervisor.dispatchAndReport(n2.id, 'click', { requestId: 'req-3' })
    expect(fires1).toBe(1)
    expect(fires2).toBe(1) // a FRESH dispatch ran on n2 — not the stale n1 report
    expect(second.results).toEqual(['two'])
    expect(second).not.toBe(first)
  })

  it('without requestId there is no dedup: two calls both dispatch', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    let fires = 0
    n.addLayer({ id: 'h', handlers: [{ name: 'click', event: 'click', body: () => { fires++ } }] })
    await supervisor.dispatchAndReport(n.id, 'click')
    await supervisor.dispatchAndReport(n.id, 'click')
    expect(fires).toBe(2)
  })

  it('reentrancy: a nested dispatchAndReport of the same (node,event) no-ops (empty report); a different event still fires', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode())
    supervisor.registerNode(n)
    let clickFires = 0
    let focusFires = 0
    n.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'click', event: 'click',
          body: (c: HandlerContext) => {
            clickFires++
            void c.supervisor.dispatchAndReport(n.id, 'click')
            void c.supervisor.dispatchAndReport(n.id, 'focus')
            return 'c'
          },
        },
        { name: 'focus', event: 'focus', body: () => { focusFires++ } },
      ],
    })
    const report = await supervisor.dispatchAndReport(n.id, 'click')
    expect(clickFires).toBe(1) // the nested same-event dispatchAndReport was guarded
    expect(focusFires).toBe(1) // a DIFFERENT event is not blocked by the guard
    expect(report.results).toEqual(['c'])
  })

  it('flush(): after a body\'s apply, await flush() leaves hasPendingWork() false and the pass-2 states available', async () => {
    const { supervisor, root } = newSystem()
    const n = childOf(root, makeNode({ content: 'orig' }))
    supervisor.registerNode(n)
    n.addLayer({
      id: 'h',
      handlers: [{
        name: 'click', event: 'click',
        body: (c: HandlerContext) => {
          c.clientAPI.apply(n.id, [{ targetProp: 'content', mode: 'replace', value: 'y' }])
        },
      }],
    })
    expect(supervisor.hasPendingWork()).toBe(false)
    supervisor.dispatchEvent(n.id, 'click') // the apply schedules the flush
    expect(supervisor.hasPendingWork()).toBe(true)
    await supervisor.flush()
    expect(supervisor.hasPendingWork()).toBe(false) // the deterministic settle drained everything
    expect(supervisor.takePass2States().size).toBeGreaterThan(0) // the settle produced states (non-draining probe)
    expect(n.content).toBe('y')
  })
})
