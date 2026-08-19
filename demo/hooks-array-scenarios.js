/**
 * hooks-array-scenarios — the ROWS-MINT + CASCADE SPA page
 * (docs/specs/hooks-array-injection-review.md §9 — CONTRACT AMENDMENT C)
 *
 * Three roles (the hooks-scenarios.js pattern):
 *
 *  1. DATA: ONE legacy envelope whose root carries the component prototype
 *     binding + the `hooksKind` declaration (`item-list: 'component'`). The
 *     `rows-mint` op runs during bootstrap (NOT from a handler body). A
 *     cross-row consumer references a per-row field name (`title`) and sees
 *     N arms (the pin-6 fan-out).
 *
 *  2. NODE side: the builder's expected census — the same core pipeline
 *     minus the DOM render.
 *
 *  3. PAGE: CORE-ONLY imports + shared runner. The harness asserts both
 *     sides of the cascade (minted row source anchors + consumer fan-out).
 *
 * Banner: `hooks-array-scenarios`
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { createClient } from '../dist/core/client.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { registerDefPrototypes, registerDefRootPrototype, mintedByOrigin } from '../dist/core/registry.js'
import { makeRunner } from './lib/runner.js'
import { Node } from '../dist/core/node.js'

// ============================================================================
// DATA — the SPA envelope + the registered row prototype.
// ============================================================================

function flushMicrotasks() {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

export function hooksArrayScenariosEnvelope() {
  return {
    template: {
      root: {
        type: 'div',
        props: { id: 'hooks-array-root' },
        children: [
          {
            type: 'section',
            props: { id: 'cross-row' },
            component: [{ reference: 'title' }],
            children: [
              {
                type: 'div',
                props: { id: 'row-list' },
                content: 'Rows will appear here (minted by rows-mint on bootstrap).',
              },
            ],
          },
        ],
        hooks: ['item-list'],
        hooksKind: { 'item-list': 'component' },
      },
    },
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

export function hooksArrayScenariosEnvelopes() {
  return { main: hooksArrayScenariosEnvelope() }
}

// ============================================================================
// Shared pipeline half
// ============================================================================

export function censusOf(supervisor) {
  const all = supervisor.allNodes()
  return {
    registered: all.length,
    inTree: all.filter((n) => !n.destroyed && n.isInTree).length,
    unplaced: all.filter((n) => !n.destroyed && n.state === 'unplaced').length,
    destroyed: all.filter((n) => n.destroyed).length,
    prototypes: all.filter((n) => n.state === 'prototype').length,
    cloneOps: 0,
  }
}

export async function hooksArrayScenariosServerData() {
  // register the prototype (pre-minted def prototype, registry.js:78-86)
  // Cache link objects per (name,kind) so registerDefPrototypes and the
  // executor's defPrototypesFor lookup hit the same key.
  const linkCache = new Map()
  const hub = {
    linkFor(name, kind) {
      const key = `${kind}:${name}`
      let l = linkCache.get(key)
      if (!l) {
        const anchors = []
        l = { name, kind, anchors, addAnchor(a) { anchors.push(a); return a }, anchorsOf(role) { return anchors.filter(a => a.role === role) } }
        linkCache.set(key, l)
      }
      return l
    },
  }
  const proto = new Node({ type: 'li', css: { classes: ['row-item'] } }, hub, 'row-proto', false)
  const protoLink = hub.linkFor('item', 'component')
  registerDefPrototypes(protoLink, [proto])
  registerDefRootPrototype(protoLink, proto)

  const translated = translateLegacy(hooksArrayScenariosEnvelope(), { hub })
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub, events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  supervisor.recordResolved(translated.root.compile(translated.nodes).actionable)
  await flushMicrotasks()
  return {
    goals: [
      'S1 rows-mint: 3 rows minted from the prototype by name carry per-row value-bearing source anchors (pin 3)',
      'S2 cross-row consumer: the consumer references `title` and sees N arms via the multi-provider fan-out (pin 6 — the cascade)',
      'S3 user contract: census matches, rows-mint layer is node-scoped (DEFECT #23), batch record on the option-C field (pin 5)',
    ],
    expected: { census: censusOf(supervisor) },
  }
}

// ============================================================================
// PAGE — browser module
// ============================================================================

if (typeof document !== 'undefined') {
  const runner = makeRunner()
  document.getElementById('results').appendChild(runner.el)

  const payload = JSON.parse(document.getElementById('preempt-initial-data').textContent.trim())
  const serverData = JSON.parse(document.getElementById('server-data').textContent.trim())

  const PROFILE = {
    loadMs: 0, compileMs: 0, flushMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    checksMs: 0, totalMs: 0, coveredMs: 0, renderCount: 0, compileCalls: 0,
    rowsMinted: 0,
    registered: 0, inTree: 0, unplaced: 0, destroyed: 0, prototypes: 0, cloneOps: 0,
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) { const t0 = now(); const r = fn(); PROFILE[key] += now() - t0; return r }
  async function accAsync(key, fn) { const t0 = now(); const r = await fn(); PROFILE[key] += now() - t0; return r }

  async function main() {
    const env = payload.main
    // The hub must be created BEFORE translateLegacy so the nodes use the
    // SAME hub the def prototypes are registered against.
    const linkCache = new Map()
    const hub = {
      linkFor(name, kind) {
        const key = `${kind}:${name}`
        let l = linkCache.get(key)
        if (!l) {
          const anchors = []
          l = { name, kind, anchors, addAnchor(a) { anchors.push(a); return a }, anchorsOf(role) { return anchors.filter(a => a.role === role) } }
          linkCache.set(key, l)
        }
        return l
      },
    }
    const proto = new Node({ type: 'li', css: { classes: ['row-item'] } }, hub, 'row-proto', false)
    const protoLink = hub.linkFor('item', 'component')
    registerDefPrototypes(protoLink, [proto])
    registerDefRootPrototype(protoLink, proto)

    const translated = acc('loadMs', () => translateLegacy(env, { hub }))
    const events = new EventBridge()
    const sup = new Supervisor({ hub, events })
    for (const n of translated.nodes) sup.registerNode(n)
    const clientAPI = createClient(sup)
    const adapter = new DomAdapter(document.getElementById('mount-main'))
    const ctx = sup.handlerContext
    const prevStates = new Map()
    let prevMap = null

    function mergeStates(byNode) {
      for (const [id, arr] of byNode) {
        const n = sup.getNode(id)
        if (!n || n.destroyed || !n.isInTree) { prevStates.delete(id); continue }
        prevStates.set(id, arr)
      }
    }
    function groupByNode(actionable) {
      const byNode = new Map()
      for (const s of actionable) { const arr = byNode.get(s.nodeId) ?? []; arr.push(s); byNode.set(s.nodeId, arr) }
      return byNode
    }
    function renderEmit() {
      for (const [id] of prevStates) { const n = sup.getNode(id); if (!n || n.destroyed || !n.isInTree) prevStates.delete(id) }
      const actionable = []
      for (const [, states] of prevStates) actionable.push(...states)
      const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
      const els = acc('emitMs', () => emitElements(actionable, byNode))
      const ops = acc('diffMs', () => diffMinimal(prevMap, els))
      acc('applyMs', () => { adapter.beginBatch(); applyOps(adapter, ops); adapter.endBatch() })
      prevMap = new Map(els.map((e) => [e.wire, e]))
      PROFILE.renderCount += 1
    }
    function bootstrap() {
      const cr = acc('compileMs', () => translated.root.compile(translated.nodes))
      PROFILE.compileCalls += 1
      mergeStates(groupByNode(cr.actionable))
      sup.recordResolved(cr.actionable)
    }
    async function interact(fn) {
      fn()
      await accAsync('flushMs', async () => { await flushMicrotasks(); mergeStates(sup.takePass2States()) })
      renderEmit()
    }

    // ---- bootstrap + ROWS-MINT --------------------------------------------------
    bootstrap()
    const census0 = censusOf(sup)
    for (const k of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) PROFILE[k] = census0[k]

    const listNode = translated.nodes.find((n) => n.base.props?.id === 'row-list')
    const container = listNode ? sup.getNode(listNode.id) : null
    if (container) {
      const res = sup.apply({
        kind: 'rows-mint',
        target: container,
        hookName: 'item-list',
        mintKind: 'component',
        prototypeName: 'item',
        rows: [
          { id: 'r1', title: 'First row' },
          { id: 'r2', title: 'Second row' },
          { id: 'r3', title: 'Third row' },
        ],
        sourceName: 'hooks-array-rows',
      })
      PROFILE.rowsMinted = (res.minted ?? []).length
      await accAsync('flushMs', async () => { await flushMicrotasks(); mergeStates(sup.takePass2States()) })
      renderEmit()
    }

    // ---- runner checks -----------------------------------------------------------
    const checksT0 = now()
    const flushAtChecksStart = PROFILE.flushMs

    await runner.check('S1: rows-mint mints 3 family children from the prototype with per-row source anchors', async () => {
      const listNode = translated.nodes.find((n) => n.base.props?.id === 'row-list')
      const list = listNode ? sup.getNode(listNode.id) : null
      if (!list) throw new Error('row-list not found')
      if (list.children.length !== 3) throw new Error(`children=${list.children.length}`)
      for (const [i, expected] of [['r1', 'First row'], ['r2', 'Second row'], ['r3', 'Third row']]) {
        const row = list.children.find((c) => (c.base.props?.id) === i || c.anchors.some((a) => a.role === 'source' && a.target === 'id' && a.value === i))
        if (!row) throw new Error(`row ${i} not found`)
        const src = row.anchors.find((a) => a.role === 'source' && a.target === 'title')
        if (!src) throw new Error(`row ${i} missing source anchor 'title'`)
        if (src.value !== expected) throw new Error(`row ${i} title=${JSON.stringify(src.value)} expected=${JSON.stringify(expected)}`)
      }
    })

    await runner.check('S2: the mint-side consumer walk dirties the cross-row consumer (the cascade)', async () => {
      const crossNode = translated.nodes.find((n) => n.base.props?.id === 'cross-row')
      const consumer = crossNode ? sup.getNode(crossNode.id) : null
      if (!consumer) throw new Error('cross-row consumer not found')
      const resolved = sup.getResolvedStates(consumer.id)
      if (resolved.length === 0) throw new Error('consumer has no resolved states')
      const titles = resolved.map((cs) => cs.bindings.title).filter((v) => v !== undefined)
      if (titles.length !== 3) throw new Error(`titles=${JSON.stringify(titles)}`)
      for (const expected of ['First row', 'Second row', 'Third row']) {
        if (!titles.includes(expected)) throw new Error(`missing ${JSON.stringify(expected)}`)
      }
    })

    await runner.check('S3: the rows-mint layer is node-scoped (DEFECT #23) + batch record on Option-C field', () => {
      const listNode = translated.nodes.find((n) => n.base.props?.id === 'row-list')
      const list = listNode ? sup.getNode(listNode.id) : null
      if (!list) throw new Error('row-list not found')
      const layerId = `hook-${list.id}-item-list-rows`
      if (!list.layers.some((l) => l.id === layerId)) throw new Error('batch layer missing')
      if (mintedByOrigin(layerId).length !== 3) throw new Error(`minted set length=${mintedByOrigin(layerId).length}`)
      if (!list.batches?.['item-list']) throw new Error('batch record missing')
      if (list.batches['item-list'].rows.length !== 3) throw new Error(`batch rows count=${list.batches['item-list'].rows.length}`)
    })

    PROFILE.checksMs = (now() - checksT0) - (PROFILE.flushMs - flushAtChecksStart)

    runner.summary('hooks-array-scenarios')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.flushMs + PROFILE.emitMs +
      PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[hooks-array-scenarios:profile] renderCount=${PROFILE.renderCount} compileCalls=${PROFILE.compileCalls} ` +
      `rowsMinted=${PROFILE.rowsMinted} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms flush=${f(PROFILE.flushMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} ` +
      `destroyed=${PROFILE.destroyed} prototypes=${PROFILE.prototypes} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__hooksArrayScenariosProfile = PROFILE
  }

  globalThis.__hooksArrayScenariosDone = main().catch((e) => {
    console.error('hooks-array-scenarios failed:', e)
    runner.summary('hooks-array-scenarios')
  })
}
