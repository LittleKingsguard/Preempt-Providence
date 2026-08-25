/**
 * rows-scenarios — the rows demo gate (Feature 1/1.5 of
 * docs/next-feature-batch-0.2.0.md) + the Feature 1a round-trip arm.
 *
 * Three roles (the handlers-scenarios pattern):
 *
 *  1. DATA (demo/rows-scenarios.data.js): ONE legacy envelope (LegacyInitialData)
 *     whose consumers section carries the `hooksKind` declaration
 *     (`product-list: 'component'`), the registered def prototype
 *     (`product-row` — a def-shaped template.component value), and the
 *     cross-row consumers. The rows-mint DRIVE is a CONTROL (a button) whose
 *     function-STRING body calls clientAPI.apply with the rows-mint op (rows
 *     data embedded in the body string at authoring time).
 *
 *  2. NODE side (buildRowsScenariosSurface / rowsScenariosServerData): the
 *     builder's server reference — the SAME core pipeline the page runs
 *     (translate → register → bootstrap compile → recordResolved → flush →
 *     the mint CLICK dispatch through the real handler seam → flush) minus
 *     the DOM render, producing the expected census + fan-out pin embedded
 *     in server-data.
 *
 *  3. PAGE (browser): CORE-ONLY imports + the shared runner. The checks
 *     assert: the 8 minted rows in the family tree, the per-row source
 *     anchors, the fan-out census (states-per-consumer = 8 ≤ 2×8 — the
 *     linearity pin) with NO fan-out-blowup warn, the rows' DOM
 *     materialization (the consumers' per-row arms — the F3 letter: minted
 *     rows are pure providers, "value holders, never elements"; their
 *     rendered output IS the cross-row fan-out, hooks-array-injection-review
 *     §3), the node-scoped layer + Option-C batch record (DEFECT #23), the
 *     re-mint no-accumulation, and the Feature 1a ROUND-TRIP arm (serialize
 *     → loadState → seed → reconcile → reRegisterDefPrototypes → the host
 *     re-mint per the `batches[hookName]` record → the row count unchanged,
 *     replace-in-place via the round-tripping layerId).
 *
 * Banner: `rows-scenarios`; profile line `[rows:profile]` (totalMs/coveredMs
 * + the census fields + fanoutStates/fanoutRows); globals
 * `__rowsScenariosDone` + `__rowsScenariosProfile`.
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
import { rowsScenariosEnvelopes, ROWS_SCENARIOS_ROWS } from './rows-scenarios.data.js'

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
 *  the mint CLICK dispatch (the MintRows function-STRING body →
 *  clientAPI.apply rows-mint) → flush. Returns the live graph. */
export async function buildRowsScenariosSurface() {
  const envelopes = rowsScenariosEnvelopes()
  const translated = translateLegacy(envelopes.main)
  const events = new EventBridge()
  const sup = new Supervisor({ events })
  for (const n of translated.nodes) sup.registerNode(n)
  sup.recordResolved(translated.root.compile(translated.nodes).actionable)
  await flushMicrotasks()
  const mintBtn = translated.nodes.find((n) => n.base.props?.id === 'mint-btn')
  if (!mintBtn) throw new Error('rows-scenarios envelope: mint-btn missing')
  dispatchEvent(sup.getNode(mintBtn.id), sup.handlerContext, 'click')
  await flushMicrotasks()
  const rowsList = translated.nodes.find((n) => n.base.props?.id === 'rows-list')
  return { translated, sup, rowsList: rowsList ? sup.getNode(rowsList.id) : null }
}

/** Per-supervisor census (the legacy-shape convention: destroyed excluded
 *  from inTree). */
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

/** The fan-out census pin: live minted-row count (the batch layer's set) +
 *  the MAX per-consumer resolved-state count (Feature 1.4 — states-per-
 *  consumer vs N rows; the linearity tripwire's inputs). */
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
export async function rowsScenariosServerData() {
  const { sup, rowsList } = await buildRowsScenariosSurface()
  const census = censusOf(sup)
  const fan = fanoutCensusOf(sup, rowsList)
  return {
    goals: [
      'S1 rows-mint drive: the function-STRING control body calls clientAPI.apply with the rows-mint op (rows data embedded) — 8 product rows minted from the registered def prototype by name',
      'S2 per-row source anchors: every minted row carries value-bearing name/price/stock anchors (the row fields become providers)',
      'S3 fan-out census: the cross-row consumers resolve 8 states each — states-per-consumer = rows (ratio 1.0); the linearity pin fanoutStates ≤ 2 × fanoutRows (Feature 1.4) with NO fan-out-blowup warn',
      'S4 per-row source values in the DOM: the consumers render one arm per row, each carrying its row field value',
      'S5 user contract: node-scoped layer (DEFECT #23) + the Option-C batches record; re-mint replaces in place (no accumulation)',
      'S6 round-trip (Feature 1a): serialize → loadState → seed → reconcile → reRegisterDefPrototypes → the host re-mint per the batches record → the row count unchanged (replace-in-place via the round-tripping layerId)',
    ],
    expected: { census, fanoutRows: fan.fanoutRows, fanoutStates: fan.fanoutStates, rowsMinted: fan.fanoutRows },
  }
}

// ============================================================================
// Feature 1a — the ROUND-TRIP arm (serialize.md §3 recipe: steps 1 → 4.5).
// The minted rows are DERIVED — they never ship as nodes; the batch RECORD
// (rows as data) is the round-trip carrier, and the host re-mints per
// `batches[hookName]` after re-registering the def prototypes (the census
// re-registration is what makes `prototypeName` resolve on the loadState
// hub). Slice = the FULL TranslatedTree.nodes list (authored + def
// prototypes; NO runtime-minted rows). ONE createLinkHub() instance for the
// seeds + the supervisor.
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
    sourceName: 'rows-scenarios-remint',
  })
  const firstRes = applyReMint()
  return { reRowsList, applyReMint, firstRes, record }
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
  if (translated.warnings.length > 0) console.warn('rows-scenarios translate warnings:', translated.warnings)

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

  // ---- check-surface helpers (shim- AND browser-compatible) -----------------
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

    // ---- boot + pre-mint state ----------------------------------------------
    await runner.check('boot: the envelope translates cleanly (zero translate warnings) and the consumers render ONE arm each pre-mint', () => {
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
    // census — post-mint (the builder ran the IDENTICAL pipeline incl. the
    // click-driven mint and embedded the expected; the smoke pins equality)
    const census = censusOf(sup)
    for (const k of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) PROFILE[k] = census[k]

    // ---- S1 — the mint drive + the rendered row count -----------------------
    // DATA-FIX NOTE (the F3 letter): a minted row is a PURE PROVIDER — the
    // compile's F3 discipline drops source-only nodes consumed by name from
    // render (node.ts compile — "a value holder, never an element";
    // hooks-array-injection-review §3: the rows' rendered output IS the
    // cross-row consumers). "8 rows rendered" therefore pins the 8 minted
    // rows in the family tree (the batch layer's set) + the consumers'
    // per-row arms (S5) — the rows materialize in the DOM THROUGH the
    // fan-out, which is the feature's actual story.
    await runner.check('S1: the mint control (function-STRING body) drives rows-mint through clientAPI.apply — 8 product rows minted into the family tree', () => {
      if (PROFILE.rowsMinted !== 8) throw new Error(`rowsMinted=${PROFILE.rowsMinted}`)
      const rec = rowsListLive.batches?.['product-list']
      if (!rec) throw new Error('batch record missing after the mint')
      if (rec.rows.length !== 8) throw new Error(`record rows=${rec.rows.length}`)
    })

    // ---- S2 — per-row source anchors (the value-bearing providers) ----------
    await runner.check('S2: per-row source anchors — each minted row carries value-bearing name/price/stock anchors', () => {
      const rows = rowsListLive.children.filter((c) => c.originLayer === layerId)
      if (rows.length !== 8) throw new Error(`live rows=${rows.length}`)
      for (const expected of ROWS_SCENARIOS_ROWS) {
        const row = rows.find((r) => {
          const src = r.anchors.find((a) => a.role === 'source' && a.target === 'name')
          return src && src.value === expected.name
        })
        if (!row) throw new Error(`row ${expected.name} missing`)
        for (const f of ['name', 'price', 'stock']) {
          const src = row.anchors.find((a) => a.role === 'source' && a.target === f)
          if (!src || src.value !== expected[f]) {
            throw new Error(`row ${expected.name} source ${f}=${src ? JSON.stringify(src.value) : 'missing'}`)
          }
        }
      }
    })

    // ---- S3 — the fan-out census (Feature 1.4) ------------------------------
    await runner.check('S3: the fan-out census — every cross-row consumer resolves 8 states (states-per-consumer = rows, ratio 1.0)', () => {
      for (const id of ['consumer-name', 'consumer-price', 'consumer-stock']) {
        const n = findNodeInGraph(id)
        const states = sup.getResolvedStates(n.id)
        if (states.length !== 8) throw new Error(`consumer ${id}: states=${states.length}`)
        const key = id === 'consumer-name' ? 'name' : id === 'consumer-price' ? 'price' : 'stock'
        const values = states.map((cs) => cs.bindings[key]).filter((v) => v !== undefined)
        if (values.length !== 8) throw new Error(`consumer ${id}: ${key} bindings=${values.length}`)
      }
    })
    await runner.check('S4: the linearity pin — fanoutStates (8) ≤ 2 × fanoutRows (8); the fan-out-blowup tripwire stayed silent', () => {
      if (PROFILE.fanoutStates > 2 * PROFILE.fanoutRows) {
        throw new Error(`fanoutStates=${PROFILE.fanoutStates} > 2 × fanoutRows=${PROFILE.fanoutRows}`)
      }
      if (warns.some((w) => w.includes('fan-out-blowup'))) {
        throw new Error(`fan-out-blowup fired during the mint flush: ${JSON.stringify(warns)}`)
      }
    })

    // ---- S5 — the rows materialize in the DOM as the consumers' arms -------
    await runner.check('S5: the rows materialize in the DOM — the consumers render ONE per-row arm each (8 elements), each carrying its row field value', () => {
      if (countEmitted('consumer-name') !== 8) throw new Error(`consumer-name arms=${countEmitted('consumer-name')}`)
      if (countEmitted('consumer-price') !== 8) throw new Error(`consumer-price arms=${countEmitted('consumer-price')}`)
      if (countEmitted('consumer-stock') !== 8) throw new Error(`consumer-stock arms=${countEmitted('consumer-stock')}`)
      const names = emittedValues('consumer-name', 'name')
      const expectedNames = ROWS_SCENARIOS_ROWS.map((r) => r.name)
      if (names.length !== 8) throw new Error(`consumer-name values=${names.length}`)
      for (const n of expectedNames) if (!names.includes(n)) throw new Error(`consumer-name missing ${n}: ${JSON.stringify(names)}`)
      const prices = emittedValues('consumer-price', 'price')
      for (const p of ROWS_SCENARIOS_ROWS.map((r) => r.price)) if (!prices.includes(p)) throw new Error(`consumer-price missing ${p}`)
      const stocks = emittedValues('consumer-stock', 'stock')
      for (const s of ROWS_SCENARIOS_ROWS.map((r) => r.stock)) if (!stocks.includes(s)) throw new Error(`consumer-stock missing ${s}`)
      const first = findInMount(document.getElementById('mount-main'), 'consumer-name')
      if (!first || first.getAttribute?.('name') !== expectedNames[0]) {
        throw new Error(`consumer-name DOM attribute missing: ${first ? first.getAttribute('name') : 'no element'}`)
      }
    })

    // ---- S6 — the node-scoped layer + Option-C record (DEFECT #23) ----------
    await runner.check('S6: the rows-mint layer is node-scoped (DEFECT #23) + the Option-C batches record is the single handle', () => {
      if (!rowsListLive.layers.some((l) => l.id === layerId)) throw new Error('batch layer missing')
      if (mintedByOrigin(layerId).length !== 8) throw new Error(`minted set=${mintedByOrigin(layerId).length}`)
      const rec = rowsListLive.batches?.['product-list']
      if (!rec) throw new Error('batch record missing')
      if (rec.prototypeName !== 'product-row' || rec.layerId !== layerId || rec.rows.length !== 8) {
        throw new Error(JSON.stringify(rec))
      }
    })

    // ---- S7 — re-mint idempotency (replace-in-place) -------------------------
    await runner.check('S7: a second mint click replaces in place — still 8 live rows + 8 consumer arms (the same-layerId replace pin; never accumulates)', async () => {
      await interact(() => dispatchEvent(mintBtnLive, ctx, 'click'))
      const live = rowsListLive.children.filter((c) => c.originLayer === layerId)
      if (live.length !== 8) throw new Error(`live rows after re-mint=${live.length}`)
      if (countEmitted('consumer-name') !== 8) throw new Error(`consumer arms after re-mint=${countEmitted('consumer-name')}`)
    })

    // ---- S8/S9 — the Feature 1a round-trip arm --------------------------------
    let roundTrip = null
    await runner.check('S8 (Feature 1a): the round trip — serialize → loadState → seed → reconcile → reRegisterDefPrototypes → the host re-mint per the batches record → 8 rows + the per-row source values', async () => {
      roundTrip = await runRoundTrip(sup, translated)
      if (roundTrip.firstRes.status !== 'applied') throw new Error(JSON.stringify(roundTrip.firstRes))
      const rows = roundTrip.reRowsList.children.filter((c) => c.originLayer)
      if (rows.length !== 8) throw new Error(`round-trip rows=${rows.length}`)
      for (const expected of ROWS_SCENARIOS_ROWS) {
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
    await runner.check('S9 (Feature 1a): the round-trip re-mint REPLACES in place — a second re-mint stays at 8 (the round-tripping layerId, replay-safe)', () => {
      const again = roundTrip.applyReMint()
      if (again.status !== 'applied') throw new Error(JSON.stringify(again))
      const rows = roundTrip.reRowsList.children.filter((c) => c.originLayer)
      if (rows.length !== 8) {
        throw new Error(`round-trip rows after re-mint=${rows.length}`)
      }
    })

    // the checks' wall time includes the interact flush windows (measured in
    // flushMs) — subtract them so the buckets never overlap
    PROFILE.checksMs = (now() - checksT0) - (PROFILE.flushMs - flushAtChecksStart)

    runner.summary('rows-scenarios')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.flushMs + PROFILE.emitMs +
      PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[rows:profile] renderCount=${PROFILE.renderCount} compileCalls=${PROFILE.compileCalls} ` +
      `rowsMinted=${PROFILE.rowsMinted} fanoutStates=${PROFILE.fanoutStates} fanoutRows=${PROFILE.fanoutRows} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms flush=${f(PROFILE.flushMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} ` +
      `destroyed=${PROFILE.destroyed} prototypes=${PROFILE.prototypes} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__rowsScenariosProfile = PROFILE
  }

  globalThis.__rowsScenariosDone = main().catch((e) => {
    console.error('rows-scenarios failed:', e)
    runner.summary('rows-scenarios')
  })
}