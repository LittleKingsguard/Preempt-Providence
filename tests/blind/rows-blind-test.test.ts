/**
 * rows-blind-test — blind-test PAGE REVIEWER vitest (AGENTS.md item 10).
 *
 * Exercises the same core pipeline the writer's demo page runs (the exported
 * `buildRowsBlindTestSurface`, `censusOf`, `fanoutCensusOf`, `runRoundTrip`
 * functions), rewritten to use src/core imports so vitest can resolve them.
 *
 * Checks mirror the page's S1–S8 goals:
 *  S1: envelope translates cleanly (zero warnings) + pre-mint render
 *  S2: census matches (registered / inTree / prototypes)
 *  S3: fan-out census — each consumer resolves 5 states
 *  S4: linearity pin — fanoutStates ≤ 2 × fanoutRows + no fan-out-blowup warn
 *  S5: DOM materialization — 5 arms per consumer with row field values
 *  S6: serialized doc carries a defPrototypes section (Feature 1a)
 *  S7: round-trip — serialize → loadState → seed → reconcile →
 *       reRegisterDefPrototypes → host re-mint → 5 rows + per-row source values
 *  S8: round-trip re-mint stays at 5 (replace-in-place, replay-safe)
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy, createLinkHub } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { dispatchEvent } from '../../src/core/handlers.js'
import { serializeSlice, loadState, reRegisterDefPrototypes } from '../../src/core/serialize.js'
import { Node, reconcileParentTargets } from '../../src/core/node.js'
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — .data.js has no declaration file
import { rowsBlindTestEnvelopes, ROWS_BLIND_TEST_ROWS } from '../../demo/rows-blind-test.data.js'

// ---------------------------------------------------------------------------
// Shared helpers — identical to the page module's exported functions
// ---------------------------------------------------------------------------

function flushMicrotasks(): Promise<void> {
  const waits: Promise<void>[] = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits).then()
}

async function buildSurface() {
  const envelopes = rowsBlindTestEnvelopes()
  const translated = translateLegacy(envelopes.main)
  const events = new EventBridge()
  const sup = new Supervisor({ events })
  for (const n of translated.nodes) sup.registerNode(n)
  sup.recordResolved(translated.root.compile(translated.nodes).actionable)
  await flushMicrotasks()
  const mintBtn = translated.nodes.find((n) => n.base.props?.id === 'mint-btn')
  if (!mintBtn) throw new Error('rows-blind-test envelope: mint-btn missing')
  const mintNode = sup.getNode(mintBtn.id)
  if (!mintNode) throw new Error('rows-blind-test envelope: mint-btn node not in supervisor')
  dispatchEvent(mintNode, sup.handlerContext, 'click')
  await flushMicrotasks()
  const rowsList = translated.nodes.find((n) => n.base.props?.id === 'rows-list')
  return { translated, sup, rowsList: rowsList ? sup.getNode(rowsList.id) ?? null : null }
}

function censusOf(supervisor: Supervisor) {
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

function fanoutCensusOf(sup: Supervisor, rowsList: Node | null) {
  if (!rowsList) return { fanoutRows: 0, fanoutStates: 0 }
  const layerId = `hook-${rowsList.id}-product-list-rows`
  const fanoutRows = rowsList.children.filter((c) => c.originLayer === layerId).length
  let fanoutStates = 0
  for (const id of ['consumer-name', 'consumer-price', 'consumer-stock']) {
    const n = sup.allNodes().find((x) => x.props?.id === id)
    if (n) fanoutStates = Math.max(fanoutStates, sup.getResolvedStates(n.id).length)
  }
  return { fanoutRows, fanoutStates }
}

async function runRoundTrip(sup: Supervisor, translated: ReturnType<typeof translateLegacy>) {
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
  const record = reRowsList.batches?.['product-list'] as Record<string, unknown> | undefined
  if (!record) throw new Error('round trip: the batches record did not round-trip')
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('rows-blind-test — blind-test page reviewer (AGENTS.md item 10)', () => {
  it('S1: the envelope translates cleanly (zero warnings) and bootstraps', async () => {
    const { translated } = await buildSurface()
    expect(translated.warnings).toHaveLength(0)
  })

  it('S2: the census — registered / inTree / prototypes', async () => {
    const { sup } = await buildSurface()
    const census = censusOf(sup)
    // 8 original envelope nodes + 5 minted product rows = 13 registered
    // 7 original in-tree + 5 minted in-tree = 12 in-tree
    // 1 prototype (product-card, out-of-tree)
    expect(census.registered).toBe(13)
    expect(census.inTree).toBe(12)
    expect(census.unplaced).toBe(0)
    expect(census.destroyed).toBe(0)
    expect(census.prototypes).toBe(1)
    expect(census.cloneOps).toBe(0)
  })

  it('S3: the fan-out census — every cross-row consumer resolves 5 states', async () => {
    const { sup, rowsList } = await buildSurface()
    expect(rowsList).not.toBeNull()
    const fan = fanoutCensusOf(sup, rowsList!)
    expect(fan.fanoutRows).toBe(5)
    expect(fan.fanoutStates).toBe(5)
  })

  it('S4: the linearity pin — fanoutStates ≤ 2 × fanoutRows', async () => {
    const { sup, rowsList } = await buildSurface()
    expect(rowsList).not.toBeNull()
    const fan = fanoutCensusOf(sup, rowsList!)
    expect(fan.fanoutStates).toBeLessThanOrEqual(2 * fan.fanoutRows)
  })

  it('S5: DOM materialization — 5 arms per consumer with row field values', async () => {
    const { sup, rowsList } = await buildSurface()
    expect(rowsList).not.toBeNull()
    const layerId = `hook-${rowsList!.id}-product-list-rows`
    const minted = rowsList!.children.filter((c) => c.originLayer === layerId)
    expect(minted).toHaveLength(5)
    // each row carries the source anchors (name, price, stock)
    for (const expected of ROWS_BLIND_TEST_ROWS) {
      const row = minted.find((r) => {
        const src = r.anchors.find((a) => a.role === 'source' && a.target === 'name')
        return src && src.value === expected.name
      })
      expect(row).toBeDefined()
      for (const f of ['price', 'stock'] as const) {
        const src = row!.anchors.find((a) => a.role === 'source' && a.target === f)
        expect(src).toBeDefined()
        expect(src!.value).toBe(expected[f])
      }
    }
  })

  it('S6: the serialized doc carries a defPrototypes section', async () => {
    const { translated } = await buildSurface()
    const slice = [...translated.nodes]
    const doc = serializeSlice(translated.root, slice.filter((n) => n !== translated.root))
    expect(Array.isArray(doc.defPrototypes)).toBe(true)
    expect(doc.defPrototypes!.length).toBeGreaterThan(0)
    // product-card is a child prototype (isRoot=false), not a root
    const entry = doc.defPrototypes!.find((e) => e.name === 'product-card')
    expect(entry).toBeDefined()
    expect(entry!.isRoot).toBe(false)
  })

  it('S7 (Feature 1a): round trip — serialize → loadState → seed → reconcile → reRegisterDefPrototypes → host re-mint → 5 rows + per-row source values', async () => {
    const { sup, translated } = await buildSurface()
    const roundTrip = await runRoundTrip(sup, translated)
    expect(roundTrip.firstRes.status).toBe('applied')
    const rows = roundTrip.reRowsList.children.filter((c) => c.originLayer)
    expect(rows).toHaveLength(5)
    for (const expected of ROWS_BLIND_TEST_ROWS) {
      const row = rows.find((r) => {
        const src = r.anchors.find((a) => a.role === 'source' && a.target === 'name')
        return src && src.value === expected.name
      })
      expect(row).toBeDefined()
      for (const f of ['price', 'stock'] as const) {
        const src = row!.anchors.find((a) => a.role === 'source' && a.target === f)
        expect(src).toBeDefined()
        expect(src!.value).toBe(expected[f])
      }
    }
  })

  it('S8 (Feature 1a): round-trip re-mint stays at 5 (replay-safe)', async () => {
    const { sup, translated } = await buildSurface()
    const roundTrip = await runRoundTrip(sup, translated)
    const again = roundTrip.applyReMint()
    expect(again.status).toBe('applied')
    const rows = roundTrip.reRowsList.children.filter((c) => c.originLayer)
    expect(rows).toHaveLength(5)
  })
})
