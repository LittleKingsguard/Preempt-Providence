/**
 * rows-blind-test — the blind-test WRITER artifact (AGENTS.md item 10a).
 * Produced from DOCUMENTATION ONLY — no implementation reading.
 *
 * Three roles (the handlers-scenarios pattern):
 *
 *  1. DATA (demo/rows-blind-test.data.js): ONE legacy envelope whose
 *     consumers section carries the `hooksKind` declaration, the registered
 *     def prototype (`product-card`), and cross-row consumers. The rows-mint
 *     drive is a control whose function-STRING body calls clientAPI.apply
 *     with the rows-mint op.
 *
 *  2. NODE side (builder — NOT written by the writer): the builder's server
 *     reference produces the expected census + fan-out pin embedded in
 *     server-data. The page checks assert equality.
 *
 *  3. PAGE (browser): CORE-ONLY imports + the shared runner. Checks assert:
 *     the 5 minted rows, the per-row source anchors, the fan-out census
 *     (states-per-consumer = 5, ratio 1.0, linearity pin ≤ 2×5), the DOM
 *     materialization, the schema boundary (defPrototypes section present in
 *     the serialized doc), and the Feature 1a round-trip arm.
 *
 * Banner: `rows-blind-test`; profile line `[rows-blind-test:profile]`;
 * globals `__rowsBlindTestDone` + `__rowsBlindTestProfile`.
 */
import { translateLegacy, createLinkHub } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { dispatchEvent } from '../dist/core/handlers.js'
import { serializeSlice, loadState, reRegisterDefPrototypes } from '../dist/core/serialize.js'
import { Node, reconcileParentTargets } from '../dist/core/node.js'
import { mintedByOrigin } from '../dist/core/registry.js'
import { makeRunner } from './lib/runner.js'
import { rowsBlindTestEnvelopes, ROWS_BLIND_TEST_ROWS } from './rows-blind-test.data.js'

function flushMicrotasks() {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

// ============================================================================
// Shared pipeline half — the pre-render core pipeline (page AND builder run
// the IDENTICAL sequence; only the emit/apply side differs). The mint is
// driven through the REAL handler seam (a click dispatch on the control), so
// the function-STRING body itself performs the rows-mint — the builder proves
// the data-authored drive works with no DOM at all.
// ============================================================================

/** Translate → register → ONE bootstrap compile → recordResolved → flush →
 *  the mint CLICK dispatch → flush. Returns the live graph. */
export async function buildRowsBlindTestSurface() {
  const envelopes = rowsBlindTestEnvelopes()
  const translated = translateLegacy(envelopes.main)
  const events = new EventBridge()
  const sup = new Supervisor({ events })
  for (const n of translated.nodes) sup.registerNode(n)
  sup.recordResolved(translated.root.compile(translated.nodes).actionable)
  await flushMicrotasks()
  const mintBtn = translated.nodes.find((n) => n.base.props?.id === 'mint-btn')
  if (!mintBtn) throw new Error('rows-blind-test envelope: mint-btn missing')
  dispatchEvent(sup.getNode(mintBtn.id), sup.handlerContext, 'click')
  await flushMicrotasks()
  const rowsList = translated.nodes.find((n) => n.base.props?.id === 'rows-list')
  return { translated, sup, rowsList: rowsList ? sup.getNode(rowsList.id) : null }
}

/** Per-supervisor census. */
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

/** The fan-out census pin: live minted-row count + the MAX per-consumer
 *  resolved-state count (Feature 1.4 linearity tripwire inputs). */
export function fanoutCensusOf(sup, rowsList) {
  const layerId = `hook-${rowsList.id}-product-list-rows`
  const fanoutRows = rowsList.children.filter((c) => c.originLayer === layerId).length
  let fanoutStates = 0
  for (const id of ['consumer-name', 'consumer-price', 'consumer-stock']) {
    const n = sup.allNodes().find((x) => x.props?.id === id)
    if (n) fanoutStates = Math.max(fanoutStates, sup.getResolvedStates(n.id).length)
  }
  return { fanoutRows, fanoutStates }
}

/** Expected census + fan-out pin, embedded in server-data by the builder. */
export async function rowsBlindTestServerData() {
  const { sup, rowsList } = await buildRowsBlindTestSurface()
  const census = censusOf(sup)
  const fan = fanoutCensusOf(sup, rowsList)
  return {
    goals: [
      'S1 boot: the envelope translates cleanly (zero translate warnings) and the consumers render ONE arm each pre-mint',
      'S2 census: the post-mint census matches the builder-embedded expected census (registered, inTree, prototypes)',
      'S3 fan-out census: the cross-row consumers resolve 5 states each — states-per-consumer = rows (ratio 1.0)',
      'S4 linearity pin: fanoutStates (5) ≤ 2 × fanoutRows (5); the fan-out-blowup tripwire stayed silent',
      'S5 DOM materialization: the consumers render ONE per-row arm each (5 elements), each carrying its row field value',
      'S6 schema boundary: the serialized doc carries a defPrototypes section (Feature 1a census shape)',
      'S7 round-trip (Feature 1a): serialize → loadState → seed → reconcile → reRegisterDefPrototypes → the host re-mint per the batches record → 5 rows + per-row source values',
      'S8 round-trip replace: a second re-mint stays at 5 (the round-tripping layerId, replay-safe)',
    ],
    expected: { census, fanoutRows: fan.fanoutRows, fanoutStates: fan.fanoutStates, rowsMinted: fan.fanoutRows },
  }
}

// ============================================================================
// Feature 1a — the ROUND-TRIP arm (serialize.md §3 recipe: steps 1 → 4.5).
// The minted rows are DERIVED — they never ship as nodes; the batch RECORD
// (rows as data) is the round-trip carrier, and the host re-mints per
// `batches[hookName]` after re-registering the def prototypes. Slice = the
// FULL TranslatedTree.nodes list (authored + def prototypes; NO
// runtime-minted rows). ONE createLinkHub() instance for seeds + supervisor.
// ============================================================================
export async function runRoundTrip(sup, translated) {
  const slice = [...translated.nodes]
  const doc = serializeSlice(translated.root, slice.filter((n) => n !== translated.root))
  const hub2 = createLinkHub()
  const seeds = loadState(JSON.parse(JSON.stringify(doc)))
  const seeded = seeds.map((d) => new Node(d, hub2))
  reconcileParentTargets(seeded)
  reRegisterDefPrototypes(doc, hub2, seeded)
  const sup2 = new Supervisor({ hub: hub2, events: new EventBridge() })
  for (const n of seeded) sup2.registerNode(n)
  const reRowsList = seeded.find((n) => n.props?.id === 'rows-list')
  if (!reRowsList) throw new Error('round trip: rows-list seed missing')
  const record = reRowsList.batches?.['product-list']
  if (!record) throw new Error('round trip: the batches record did not round-trip')
  // step 4.5 — ONE rows-mint per batches[hookName] record (host-driven)
  const applyReMint = () => sup2.apply({
    kind: 'rows-mint',
    target: reRowsList,
    hookName: 'product-list',
    mintKind: record.mintKind,
    prototypeName: record.prototypeName,
    rows: record.rows,
    sourceName: 'rows-blind-test-remint',
  })
  const firstRes = applyReMint()
  return { reRowsList, applyReMint, firstRes, record, doc }
}

// ============================================================================
// PAGE — browser module (runs only when a DOM is present).
// ============================================================================

if (typeof document !== 'undefined') {
  const runner = makeRunner()
  document.getElementById('results').appendChild(runner.el)

  const payload = JSON.parse(document.getElementById('preempt-initial-data').textContent.trim())
  const serverData = JSON.parse(document.getElementById('server-data').textContent.trim())

  const PROFILE = {
    loadMs: 0, compileMs: 0, flushMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    checksMs: 0, totalMs: 0, coveredMs: 0, renderCount: 0, compileCalls: 0,
    rowsMinted: 0, fanoutStates: 0, fanoutRows: 0,
    registered: 0, inTree: 0, unplaced: 0, destroyed: 0, prototypes: 0, cloneOps: 0,
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }
  async function accAsync(key, fn) {
    const t0 = now()
    const r = await fn()
    PROFILE[key] += now() - t0
    return r
  }

  // ---- the single mount ----------------------------------------------------
  const translated = acc('loadMs', () => translateLegacy(payload.main))
  const events = new EventBridge()
  const sup = new Supervisor({ events })
  for (const n of translated.nodes) sup.registerNode(n)
  if (translated.warnings.length > 0) console.warn('rows-blind-test translate warnings:', translated.warnings)

  const adapter = new DomAdapter(document.getElementById('mount-main'))
  const ctx = sup.handlerContext
  const prevStates = new Map()
  let prevMap = null
  const elsRef = { els: [] }

  function mergeStates(byNode) {
    for (const [id, arr] of byNode) {
      const n = sup.getNode(id)
      if (!n || n.destroyed || !n.isInTree) {
        prevStates.delete(id)
        continue
      }
      prevStates.set(id, arr)
    }
  }
  function groupByNode(actionable) {
    const byNode = new Map()
    for (const s of actionable) {
      const arr = byNode.get(s.nodeId) ?? []
      arr.push(s)
      byNode.set(s.nodeId, arr)
    }
    return byNode
  }
  function renderEmit() {
    for (const [id] of prevStates) {
      const n = sup.getNode(id)
      if (!n || n.destroyed || !n.isInTree) prevStates.delete(id)
    }
    const actionable = []
    for (const [, states] of prevStates) actionable.push(...states)
    const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
    const els = acc('emitMs', () => emitElements(actionable, byNode))
    const ops = acc('diffMs', () => diffMinimal(prevMap, els))
    acc('applyMs', () => {
      adapter.beginBatch()
      applyOps(adapter, ops)
      adapter.endBatch()
    })
    prevMap = new Map(els.map((e) => [e.wire, e]))
    elsRef.els = els
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
    await accAsync('flushMs', async () => {
      await flushMicrotasks()
      mergeStates(sup.takePass2States())
    })
    renderEmit()
  }

  // ---- check-surface helpers ------------------------------------------------
  function findNodeInGraph(id) {
    return sup.allNodes().find((n) => !n.destroyed && n.props?.id === id) ?? null
  }
  function findInMount(mountEl, id) {
    const stack = [mountEl]
    while (stack.length > 0) {
      const el = stack.pop()
      if (!el) continue
      if ((el.id || el.getAttribute?.('id') || '') === id) return el
      const kids = el.children ?? []
      for (let i = 0; i < kids.length; i += 1) stack.push(kids[i])
    }
    return null
  }
  function countEmitted(cls) {
    return elsRef.els.filter((e) => Array.isArray(e.props?.['css:classes']) && e.props['css:classes'].includes(cls)).length
  }
  function emittedValues(cls, propKey) {
    return elsRef.els
      .filter((e) => Array.isArray(e.props?.['css:classes']) && e.props['css:classes'].includes(cls))
      .map((e) => e.props?.[`prop:${propKey}`])
      .filter((v) => v !== undefined && v !== null)
  }

  async function main() {
    bootstrap()
    renderEmit()

    const rowsListLive = findNodeInGraph('rows-list')
    const mintBtnLive = findNodeInGraph('mint-btn')
    const layerId = `hook-${rowsListLive.id}-product-list-rows`
    const checksT0 = now()
    const flushAtChecksStart = PROFILE.flushMs

    // ---- S1 — boot: clean translate + pre-mint render -----------------------
    await runner.check('S1: the envelope translates cleanly (zero translate warnings) and the consumers render ONE arm each pre-mint', () => {
      if (translated.warnings.length !== 0) throw new Error(JSON.stringify(translated.warnings))
      if (countEmitted('consumer-name') !== 1) throw new Error(`pre-mint consumer arms=${countEmitted('consumer-name')}`)
    })

    // ---- the mint drive: the function-STRING control body -------------------
    const warns = []
    const origWarn = console.warn
    console.warn = (...args) => {
      warns.push(String(args[0] ?? ''))
    }
    try {
      await interact(() => dispatchEvent(mintBtnLive, ctx, 'click'))
    } finally {
      console.warn = origWarn
    }
    PROFILE.rowsMinted = rowsListLive.children.filter((c) => c.originLayer === layerId).length
    const fan = fanoutCensusOf(sup, rowsListLive)
    PROFILE.fanoutRows = fan.fanoutRows
    PROFILE.fanoutStates = fan.fanoutStates
    const census = censusOf(sup)
    for (const k of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) PROFILE[k] = census[k]

    // ---- S2 — census matches builder-embedded expected ----------------------
    const expectedCensus = serverData.expected?.census
    await runner.check('S2: the post-mint census matches the builder-embedded expected census', () => {
      if (!expectedCensus) throw new Error('server-data missing expected.census')
      for (const k of ['registered', 'inTree', 'prototypes']) {
        if (PROFILE[k] !== expectedCensus[k]) {
          throw new Error(`${k}: live=${PROFILE[k]} expected=${expectedCensus[k]}`)
        }
      }
    })

    // ---- S3 — fan-out census (Feature 1.4) ---------------------------------
    const expectedFanoutRows = serverData.expected?.fanoutRows ?? 5
    const expectedFanoutStates = serverData.expected?.fanoutStates ?? 5
    await runner.check('S3: the fan-out census — every cross-row consumer resolves 5 states (states-per-consumer = rows, ratio 1.0)', () => {
      for (const id of ['consumer-name', 'consumer-price', 'consumer-stock']) {
        const n = findNodeInGraph(id)
        const states = sup.getResolvedStates(n.id)
        if (states.length !== expectedFanoutStates) {
          throw new Error(`consumer ${id}: states=${states.length} expected=${expectedFanoutStates}`)
        }
      }
    })

    // ---- S4 — linearity pin (Feature 1.4) ----------------------------------
    await runner.check('S4: the linearity pin — fanoutStates ≤ 2 × fanoutRows; the fan-out-blowup tripwire stayed silent', () => {
      if (PROFILE.fanoutStates > 2 * PROFILE.fanoutRows) {
        throw new Error(`fanoutStates=${PROFILE.fanoutStates} > 2 × fanoutRows=${PROFILE.fanoutRows}`)
      }
      if (warns.some((w) => w.includes('fan-out-blowup'))) {
        throw new Error(`fan-out-blowup fired during the mint flush: ${JSON.stringify(warns)}`)
      }
    })

    // ---- S5 — DOM materialization (the rows render through the consumers) ---
    await runner.check('S5: the rows materialize in the DOM — the consumers render ONE per-row arm each (5 elements), each carrying its row field value', () => {
      if (countEmitted('consumer-name') !== 5) throw new Error(`consumer-name arms=${countEmitted('consumer-name')}`)
      if (countEmitted('consumer-price') !== 5) throw new Error(`consumer-price arms=${countEmitted('consumer-price')}`)
      if (countEmitted('consumer-stock') !== 5) throw new Error(`consumer-stock arms=${countEmitted('consumer-stock')}`)
      const names = emittedValues('consumer-name', 'name')
      const expectedNames = ROWS_BLIND_TEST_ROWS.map((r) => r.name)
      if (names.length !== 5) throw new Error(`consumer-name values=${names.length}`)
      for (const n of expectedNames) if (!names.includes(n)) throw new Error(`consumer-name missing ${n}: ${JSON.stringify(names)}`)
      const prices = emittedValues('consumer-price', 'price')
      for (const p of ROWS_BLIND_TEST_ROWS.map((r) => r.price)) if (!prices.includes(p)) throw new Error(`consumer-price missing ${p}`)
      const stocks = emittedValues('consumer-stock', 'stock')
      for (const s of ROWS_BLIND_TEST_ROWS.map((r) => r.stock)) if (!stocks.includes(s)) throw new Error(`consumer-stock missing ${s}`)
    })

    // ---- S6 — schema boundary (Feature 1a defPrototypes section) ------------
    let roundTrip = null
    await runner.check('S6: the serialized doc carries a defPrototypes section (Feature 1a census shape)', () => {
      const slice = [...translated.nodes]
      const doc = serializeSlice(translated.root, slice.filter((n) => n !== translated.root))
      if (!Array.isArray(doc.defPrototypes)) {
        throw new Error(`defPrototypes missing or not an array: ${typeof doc.defPrototypes}`)
      }
      if (doc.defPrototypes.length === 0) {
        throw new Error('defPrototypes section is empty — expected at least one entry')
      }
      // every entry has name (string), nodeId (string), isRoot (boolean)
      for (const entry of doc.defPrototypes) {
        if (typeof entry.name !== 'string') throw new Error(`defPrototypes entry missing name: ${JSON.stringify(entry)}`)
        if (typeof entry.nodeId !== 'string') throw new Error(`defPrototypes entry missing nodeId: ${JSON.stringify(entry)}`)
        if (typeof entry.isRoot !== 'boolean') throw new Error(`defPrototypes entry missing isRoot: ${JSON.stringify(entry)}`)
      }
      // the product-card root must be present
      const rootEntry = doc.defPrototypes.find((e) => e.name === 'product-card' && !e.isRoot)
      if (!rootEntry) throw new Error('product-card root not in defPrototypes')
    })

    // ---- S7/S8 — the Feature 1a round-trip arm -----------------------------
    await runner.check('S7 (Feature 1a): the round trip — serialize → loadState → seed → reconcile → reRegisterDefPrototypes → the host re-mint per the batches record → 5 rows + per-row source values', async () => {
      roundTrip = await runRoundTrip(sup, translated)
      if (roundTrip.firstRes.status !== 'applied') throw new Error(JSON.stringify(roundTrip.firstRes))
      const rows = roundTrip.reRowsList.children.filter((c) => c.originLayer)
      if (rows.length !== 5) throw new Error(`round-trip rows=${rows.length}`)
      for (const expected of ROWS_BLIND_TEST_ROWS) {
        const row = rows.find((r) => {
          const src = r.anchors.find((a) => a.role === 'source' && a.target === 'name')
          return src && src.value === expected.name
        })
        if (!row) throw new Error(`round-trip row ${expected.name} missing`)
        for (const f of ['price', 'stock']) {
          const src = row.anchors.find((a) => a.role === 'source' && a.target === f)
          if (!src || src.value !== expected[f]) throw new Error(`round-trip row ${expected.name} ${f}=${src && src.value}`)
        }
      }
    })
    await runner.check('S8 (Feature 1a): the round-trip re-mint REPLACES in place — a second re-mint stays at 5 (the round-tripping layerId, replay-safe)', () => {
      const again = roundTrip.applyReMint()
      if (again.status !== 'applied') throw new Error(JSON.stringify(again))
      const rows = roundTrip.reRowsList.children.filter((c) => c.originLayer)
      if (rows.length !== 5) throw new Error(`round-trip rows after re-mint=${rows.length}`)
    })

    PROFILE.checksMs = (now() - checksT0) - (PROFILE.flushMs - flushAtChecksStart)

    runner.summary('rows-blind-test')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.flushMs + PROFILE.emitMs +
      PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[rows-blind-test:profile] renderCount=${PROFILE.renderCount} compileCalls=${PROFILE.compileCalls} ` +
      `rowsMinted=${PROFILE.rowsMinted} fanoutStates=${PROFILE.fanoutStates} fanoutRows=${PROFILE.fanoutRows} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms flush=${f(PROFILE.flushMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} ` +
      `destroyed=${PROFILE.destroyed} prototypes=${PROFILE.prototypes} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__rowsBlindTestProfile = PROFILE
  }

  globalThis.__rowsBlindTestDone = main().catch((e) => {
    console.error('rows-blind-test failed:', e)
    runner.summary('rows-blind-test')
  })
}
