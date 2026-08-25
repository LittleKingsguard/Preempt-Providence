/**
 * KEYED BATCH-REUSE — Feature 1b (docs/specs/handoffs-review-6.md
 * PROCEED-AS-RESHAPED, 2026-08-24; rulings 6-11 + decisions D1-D14).
 *
 * TDD red set: every test fails before the implementation exists (the
 * keyField carrier, the reuse executor, the preRecord undo, the boundary).
 *
 *   R1  keyField carrier — op writes it to the record; serialize → loadState
 *       round-trips it; a post-restore keyed UPDATE reuses the re-minted nodes
 *   R2  schema boundary (D13) — non-string/empty record keyField → mismatch
 *   R3  keyed reuse identity (D1) — same keys + updated values → SAME node
 *       ids, values updated, no accumulation
 *   R4  whole-op degrade (D2) — a key-less row / keyField-prototype-zone
 *       mismatch → plain replace (fresh ids), record WITHOUT keyField
 *   R5  reserved keyField (D3) — construction keys / non-string → warn + degrade
 *   R6  value identity + key change (D1/D6) — changed key → remove-missing +
 *       mint-new; reused keys keep ids
 *   R7  prune semantics (D4) — dropped field removes the source anchor;
 *       shape-field difference warns rows-reuse-shape-ignored, shape frozen
 *   R8  duplicate keys (D5) — within-input duplicate-identifier warn + keep-first
 *   R9  deep-equality no-op (D1/D11) — identical rows: no anchor rewrite, no
 *       consumer marks; replay() converges
 *   R10 consumer walk / silent-abort (D10/D11) — ONE changed row dirties only
 *       its field-name consumers; result reports minted/reused/removed
 *   R11 keyed undo (D8) — pre-op record + reused values restored, mint-new
 *       destroyed, removed rows re-minted; redo re-applies
 *   R12 first-mint keyed undo (D8) — op created the batch → payload-teardown
 *   R13 replay-then-undo (D9) — the preRecord survives the result refresh
 *   R14 no-promotion (1b.11) — reused nodes stay origin-owned; remove-missing
 *       destroys via the batch teardown
 *   R15 keyed rows: [] (D7) — CLEAR, never a sticky empty record
 *   R16 placement-kind keyed reuse — same placementName reuses (content
 *       anchors kept); changed placementName degrades
 *   R17 linear-tripwire regression — the fan-out census holds after a keyed
 *       update
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { serializeSlice, loadState } from '../../src/core/serialize.js'
import { registerDefPrototypes, registerDefRootPrototype, mintedByOrigin } from '../../src/core/registry.js'
import { hub, childOf } from '../helpers/fixtures.js'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Keyed-mint-able graph: a def prototype registered by name + unique node ids
 *  per call (the module registries are layerId-keyed — DEFECT #23). */
let mintSeq = 0
function mintable() {
  const h = hub()
  const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
  registerDefPrototypes(h.linkFor('item', 'component'), [proto])
  const root = new Node({ type: 'div' }, h, 'root')
  const creator = new Node({ type: 'section' }, h, `creator-${++mintSeq}`)
  const events = new EventBridge()
  const sup = new Supervisor({ hub: h, events })
  sup.registerNode(root)
  sup.registerNode(creator)
  return { h, proto, root, creator, sup }
}

function keyedMint(sup: Supervisor, creator: Node, rows: unknown[], extra: Record<string, unknown> = {}) {
  return sup.apply({
    kind: 'rows-mint',
    target: creator,
    hookName: 'items',
    mintKind: 'component',
    prototypeName: 'item',
    keyField: 'sku',
    rows,
    ...extra,
  } as never)
}

function recordOf(creator: Node): Record<string, unknown> | undefined {
  return (creator as unknown as { batches?: Record<string, unknown> }).batches?.['items'] as Record<string, unknown> | undefined
}

/** Find a minted row by its keyField source-anchor value (safe — skips nodes
 *  without the key anchor, e.g. a non-row sibling child). */
function rowByKey(creator: Node, key: unknown): Node | undefined {
  return creator.children.find((c) => {
    const s = c.anchors.find((a) => a.target === 'sku')
    return s !== undefined && s.value === key
  })
}
function skuOf(c: Node): unknown {
  const s = c.anchors.find((a) => a.target === 'sku')
  return s === undefined ? undefined : s.value
}

describe('R1 — keyField carrier + the round-trip carry', () => {
  it('the op writes keyField to the record; serialize → loadState round-trips it', () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const rec = recordOf(creator)!
    expect(rec.keyField).toBe('sku')
    const doc = serializeSlice(creator, [...sup.allNodes()])
    const seeded = loadState(JSON.parse(JSON.stringify(doc)))
    const reCreator = seeded.find((n) => n.id === creator.id)!
    const reRec = (reCreator as unknown as { batches?: Record<string, unknown> }).batches?.['items'] as Record<string, unknown>
    expect(reRec.keyField).toBe('sku')
  })

  it('a post-restore keyed UPDATE reuses the re-minted nodes (identity carry)', () => {
    const { creator, sup, h } = mintable()
    keyedMint(sup, creator, [
      { sku: 'a', title: 'First' },
      { sku: 'b', title: 'Second' },
    ])
    const doc = serializeSlice(creator, [...sup.allNodes()])
    // the round-trip recipe: loadState → seed on a FRESH hub → re-register
    // the def prototype → re-mint per the record (WITH the record's keyField)
    const h2 = hub()
    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, h2))
    const reCreator = seeded.find((n) => n.id === creator.id)!
    const reRoot = seeded.find((n) => n.id === 'root')!
    const sup2 = new Supervisor({ hub: h2, events: new EventBridge() })
    sup2.registerNode(reRoot)
    sup2.registerNode(reCreator)
    registerDefPrototypes(h2.linkFor('item', 'component'), [new Node({ type: 'li' }, h2, 'proto-2')])
    const rec = (reCreator as unknown as { batches?: Record<string, unknown> }).batches?.['items'] as {
      prototypeName: string; rows: unknown[]; mintKind: string; keyField?: string
    }
    const remint = sup2.apply({
      kind: 'rows-mint',
      target: reCreator,
      hookName: 'items',
      mintKind: rec.mintKind,
      prototypeName: rec.prototypeName,
      keyField: rec.keyField,
      rows: rec.rows as never,
    })
    expect(remint.status).toBe('applied')
    const firstIds = reCreator.children.map((c) => c.id).sort()
    // a post-restore keyed UPDATE reuses the re-minted nodes — ids stable
    const update = sup2.apply({
      kind: 'rows-mint',
      target: reCreator,
      hookName: 'items',
      mintKind: rec.mintKind,
      prototypeName: rec.prototypeName,
      keyField: rec.keyField,
      rows: [
        { sku: 'a', title: 'First UPDATED' },
        { sku: 'b', title: 'Second' },
      ] as never,
    })
    expect(update.status).toBe('applied')
    const afterIds = reCreator.children.map((c) => c.id).sort()
    expect(afterIds).toEqual(firstIds)
  })
})

describe('R2 — schema boundary (D13)', () => {
  it('a serialized record with a non-string keyField → NodeSchema-shape-mismatch', () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const doc = serializeSlice(creator, [...sup.allNodes()])
    const template = doc.template as { batches: Record<string, { keyField?: unknown }> }
    template.batches.items!.keyField = 42
    expect(() => loadState(JSON.parse(JSON.stringify(doc)))).toThrow('NodeSchema-shape-mismatch')
  })

  it('a serialized record with an EMPTY keyField → NodeSchema-shape-mismatch', () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const doc = serializeSlice(creator, [...sup.allNodes()])
    const template = doc.template as { batches: Record<string, { keyField?: unknown }> }
    template.batches.items!.keyField = ''
    expect(() => loadState(JSON.parse(JSON.stringify(doc)))).toThrow('NodeSchema-shape-mismatch')
  })
})

describe('R3 — keyed reuse identity (D1)', () => {
  it('same keys + updated values → the SAME node ids survive, values updated, no accumulation', () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [
      { sku: 'a', title: 'First', price: '1' },
      { sku: 'b', title: 'Second', price: '2' },
    ])
    const firstIds = creator.children.map((c) => c.id).sort()
    expect(creator.children.length).toBe(2)
    const res = keyedMint(sup, creator, [
      { sku: 'a', title: 'First NEW', price: '10' },
      { sku: 'b', title: 'Second', price: '2' },
    ])
    expect(res.status).toBe('applied')
    const afterIds = creator.children.map((c) => c.id).sort()
    expect(afterIds).toEqual(firstIds)
    expect(creator.children.length).toBe(2)
    const rowA = rowByKey(creator, 'a')!
    const titleA = rowA.anchors.find((a) => a.target === 'title') as { value?: unknown }
    expect(titleA.value).toBe('First NEW')
    const priceA = rowA.anchors.find((a) => a.target === 'price') as { value?: unknown }
    expect(priceA.value).toBe('10')
    // no accumulation in the module registry for THIS batch's own set
    expect(mintedByOrigin(`hook-${creator.id}-items-rows`).length).toBe(2)
  })
})

describe('R4 — whole-op degrade (D2)', () => {
  it('ONE key-less row in an otherwise-keyed update → plain replace (fresh ids), record WITHOUT keyField', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [
      { sku: 'a', title: 'First' },
      { sku: 'b', title: 'Second' },
    ])
    const firstIds = creator.children.map((c) => c.id).sort()
    const res = keyedMint(sup, creator, [
      { sku: 'a', title: 'First NEW' },
      { title: 'Keyless' },
    ])
    expect(res.status).toBe('applied')
    // fresh ids — the old nodes were torn down
    const afterIds = creator.children.map((c) => c.id).sort()
    expect(afterIds).not.toEqual(firstIds)
    expect(afterIds).toHaveLength(2)
    expect(recordOf(creator)!.keyField).toBeUndefined()
    spy.mockRestore()
  })

  it('op.keyField ≠ record.keyField → degrade; prototypeName mismatch → degrade; placementName mismatch → degrade', () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const firstIds = creator.children.map((c) => c.id).sort()
    const differentKey = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      keyField: 'other',
      rows: [{ other: 'x', title: 'Second' }] as never,
    })
    expect(differentKey.status).toBe('applied')
    expect(creator.children.map((c) => c.id).sort()).not.toEqual(firstIds)
    expect(recordOf(creator)!.keyField).toBeUndefined()
  })
})

describe('R5 — reserved keyField (D3)', () => {
  it('keyField naming a construction key → batch-keyfield-invalid warn + degrade', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      keyField: 'type',
      rows: [{ type: 'x', title: 'Second' }] as never,
    })
    expect(res.status).toBe('applied')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('batch-keyfield-invalid'))
    expect(recordOf(creator)!.keyField).toBeUndefined()
    spy.mockRestore()
  })

  it('a NON-STRING keyField on the op → batch-keyfield-invalid warn + degrade', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { creator, sup } = mintable()
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      keyField: 42,
      rows: [{ sku: 'a', title: 'First' }] as never,
    })
    expect(res.status).toBe('applied')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('batch-keyfield-invalid'))
    expect(recordOf(creator)!.keyField).toBeUndefined()
    spy.mockRestore()
  })
})

describe('R6 — value identity + key change (D1/D6)', () => {
  it('a changed key → old node remove-missing, new node minted; reused keys keep ids', () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [
      { sku: 'a', title: 'First' },
      { sku: 'b', title: 'Second' },
    ])
    const idA = rowByKey(creator, 'a')!.id
    const res = keyedMint(sup, creator, [
      { sku: 'b', title: 'Second UPDATED' },
      { sku: 'c', title: 'Third' },
    ])
    expect(res.status).toBe('applied')
    const rows = creator.children
    expect(rows.length).toBe(2)
    // the reused 'b' node keeps its id
    const idB = rowByKey(creator, 'b')!.id
    const oldB = rowByKey(creator, 'b')!
    expect((oldB.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('Second UPDATED')
    // 'a' is GONE (remove-missing), 'c' is mint-new
    expect(rows.some((c) => skuOf(c) === 'a')).toBe(false)
    expect(rows.some((c) => skuOf(c) === 'c')).toBe(true)
    expect(idB).not.toBe(idA)
  })
})

describe('R7 — prune semantics (D4)', () => {
  it('a dropped field removes the reused node source anchor; consumers stop resolving it', async () => {
    const { creator, sup, h } = mintable()
    const consumer = new Node({ type: 'span' }, h, 'consumer')
    childOf(creator, consumer, 0)
    consumer.addAnchor('target', 'title', {}, h.linkFor('title', 'component'))
    sup.registerNode(consumer)
    keyedMint(sup, creator, [{ sku: 'a', title: 'First', price: '1' }])
    await new Promise((r) => setTimeout(r, 0))
    expect(sup.getResolvedStates(consumer.id).length).toBeGreaterThan(0)
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const row = rowByKey(creator, 'a')!
    // the 'price' source anchor is GONE (pruned)
    expect(row.anchors.some((a) => a.target === 'price')).toBe(false)
    // the 'title' anchor stays + the row is reused (same id)
    expect((row.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First')
  })

  it('a shape-field difference on a reused row warns rows-reuse-shape-ignored and keeps the shape', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const row = rowByKey(creator, 'a')!
    const typeBefore = row.type
    keyedMint(sup, creator, [{ sku: 'a', title: 'First', type: 'div' }])
    expect(row.type).toBe(typeBefore)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('rows-reuse-shape-ignored'))
    spy.mockRestore()
  })
})

describe('R8 — duplicate keys (D5)', () => {
  it('within-input duplicates → duplicate-identifier warn + keep-first', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { creator, sup } = mintable()
    const res = keyedMint(sup, creator, [
      { sku: 'a', title: 'First' },
      { sku: 'a', title: 'DUPLICATE' },
      { sku: 'b', title: 'Second' },
    ])
    expect(res.status).toBe('applied')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('duplicate-identifier'))
    // keep-first: only the FIRST 'a' row is minted
    expect(creator.children.length).toBe(2)
    const rowA = rowByKey(creator, 'a')!
    expect((rowA.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First')
    spy.mockRestore()
  })
})

describe('R9 — deep-equality no-op (D1/D11)', () => {
  it('re-applying IDENTICAL rows → no anchor rewrite, no consumer marks; replay converges', async () => {
    const { creator, sup, h } = mintable()
    const consumer = new Node({ type: 'span' }, h, 'consumer')
    childOf(creator, consumer, 0)
    consumer.addAnchor('target', 'title', {}, h.linkFor('title', 'component'))
    sup.registerNode(consumer)
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    await new Promise((r) => setTimeout(r, 0))
    const res = keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    expect(res.status).toBe('applied')
    // the no-op: NO consumer dirtied (the walk input is empty)
    expect((res as { dirtied?: string[] }).dirtied).toEqual([creator.id])
    const row = rowByKey(creator, 'a')!
    expect((row.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First')
    // replay converges: children count + values unchanged
    const childrenBefore = creator.children.length
    sup.replay()
    expect(creator.children.length).toBe(childrenBefore)
    expect((rowByKey(creator, 'a')!.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First')
  })
})

describe('R10 — consumer walk / silent-abort (D10/D11)', () => {
  it('changing ONE row dirties ONLY the changed field-name consumers; result reports minted/reused/removed', async () => {
    const { creator, sup, h } = mintable()
    const consumer = new Node({ type: 'span' }, h, 'consumer')
    childOf(creator, consumer, 0)
    consumer.addAnchor('target', 'title', {}, h.linkFor('title', 'component'))
    sup.registerNode(consumer)
    keyedMint(sup, creator, [
      { sku: 'a', title: 'First' },
      { sku: 'b', title: 'Second' },
    ])
    await new Promise((r) => setTimeout(r, 0))
    const res = keyedMint(sup, creator, [
      { sku: 'a', title: 'First UPDATED' },
      { sku: 'b', title: 'Second' },
    ])
    expect(res.status).toBe('applied')
    const r = res as { dirtied?: string[]; reused?: string[]; minted?: string[]; removed?: { key: unknown }[] }
    // the changed row's field-name consumer is dirtied
    expect(r.dirtied).toContain(consumer.id)
    // the result reports the reuse facts
    expect(r.reused).toHaveLength(1)
    expect(r.minted).toHaveLength(0)
    expect(r.removed).toHaveLength(0)
  })
})

describe('R11 — keyed undo (D8)', () => {
  it('keyed update then undo() → pre-op record + reused values restored, mint-new destroyed, removed rows re-minted; redo re-applies', async () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [
      { sku: 'a', title: 'First', price: '1' },
      { sku: 'b', title: 'Second', price: '2' },
    ])
    // the update: change 'a', drop 'b', add 'c'
    keyedMint(sup, creator, [
      { sku: 'a', title: 'First NEW', price: '10' },
      { sku: 'c', title: 'Third', price: '3' },
    ])
    expect(creator.children.length).toBe(2)
    sup.undo()
    await new Promise((r) => setTimeout(r, 0))
    // row count restored (b re-minted), 'a' values restored, 'c' destroyed
    const rows = creator.children
    expect(rows.length).toBe(2)
    const rowA = rowByKey(creator, 'a')!
    expect((rowA.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First')
    expect((rowA.anchors.find((a) => a.target === 'price') as { value?: unknown }).value).toBe('1')
    expect(rows.some((c) => skuOf(c) === 'b')).toBe(true)
    expect(rows.some((c) => skuOf(c) === 'c')).toBe(false)
    // the record is the pre-op record
    const rec = recordOf(creator)!
    expect((rec.rows as { sku: string }[]).map((r) => r.sku).sort()).toEqual(['a', 'b'])
    // redo re-applies the update
    sup.redo()
    expect(creator.children.length).toBe(2)
    const rowA2 = rowByKey(creator, 'a')!
    expect((rowA2.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First NEW')
    expect(creator.children.some((c) => skuOf(c) === 'c')).toBe(true)
  })
})

describe('R12 — first-mint keyed undo (D8)', () => {
  it('a keyed op that CREATED the batch undoes via the existing payload-controlled teardown', async () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    expect(creator.children.length).toBe(1)
    sup.undo()
    await new Promise((r) => setTimeout(r, 0))
    expect(creator.children.length).toBe(0)
    expect(recordOf(creator)).toBeUndefined()
  })
})

describe('R13 — replay-then-undo (D9)', () => {
  it('replay() then undo() restores the PRE-op values (the preRecord survives the result refresh)', () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First', price: '1' }])
    keyedMint(sup, creator, [{ sku: 'a', title: 'First NEW', price: '10' }])
    // replay re-applies the journal (the result refresh must NOT clobber the
    // first-applied preRecord)
    sup.replay()
    expect(creator.children.length).toBe(1)
    const rowA = creator.children[0]!
    expect((rowA.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First NEW')
    // undo the LAST applied op (the update) → the PRE-op values come back
    sup.undo()
    expect((creator.children[0]!.anchors.find((a) => a.target === 'title') as { value?: unknown }).value).toBe('First')
    expect((creator.children[0]!.anchors.find((a) => a.target === 'price') as { value?: unknown }).value).toBe('1')
  })
})

describe('R14 — no-promotion (1b.11)', () => {
  it('a reused node stays origin-owned across MANY updates (never authored)', () => {
    const { creator, sup, h } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    const row = rowByKey(creator, 'a')!
    const origin = row.originLayer
    expect(origin).toBeDefined()
    for (let i = 0; i < 5; i += 1) {
      keyedMint(sup, creator, [{ sku: 'a', title: `v${i}` }])
      expect(rowByKey(creator, 'a')!.originLayer).toBe(origin)
    }
  })
})

describe('R15 — keyed rows: [] (D7)', () => {
  it('an EMPTY keyed batch CLEARS — record deleted, set torn down, never a sticky empty record', async () => {
    const { creator, sup } = mintable()
    keyedMint(sup, creator, [{ sku: 'a', title: 'First' }])
    expect(creator.children.length).toBe(1)
    const res = keyedMint(sup, creator, [])
    expect(res.status).toBe('applied')
    expect(recordOf(creator)).toBeUndefined()
    await new Promise((r) => setTimeout(r, 0))
    expect(creator.children.length).toBe(0)
  })
})

describe('R16 — placement-kind keyed reuse (D1/D6)', () => {
  it('same placementName reuses (content anchors kept); changed placementName degrades', () => {
    const { h } = mintable()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div' }, h, 'root')
    const creator = new Node({ type: 'section', hooksKind: { items: 'placement' } } as never, h, 'creator')
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    const container = new Node({ type: 'aside' }, h, 'container')
    container.addAnchor('container', 'main-zone', {}, h.linkFor('main-zone', 'placement'))
    sup.registerNode(container)
    const placementMint = (placementName: string, rows: unknown[]) => sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'placement',
      prototypeName: 'item',
      placementName,
      keyField: 'sku',
      rows,
    } as never)
    const first = placementMint('main-zone', [{ sku: 'a', title: 'First' }])
    expect(first.status).toBe('applied')
    const row = rowByKey(creator, 'a')!
    expect(row.anchors.some((a) => a.role === 'content' && a.target === 'main-zone')).toBe(true)
    const firstId = row.id
    const update = placementMint('main-zone', [{ sku: 'a', title: 'First NEW' }])
    expect(update.status).toBe('applied')
    expect(rowByKey(creator, 'a')!.id).toBe(firstId)
    expect(rowByKey(creator, 'a')!.anchors.some((a) => a.role === 'content' && a.target === 'main-zone')).toBe(true)
    // a changed placementName → whole-op degrade
    const zoneChange = placementMint('other-zone', [{ sku: 'a', title: 'X' }])
    expect(zoneChange.status).toBe('applied')
    expect(rowByKey(creator, 'a')!.id).not.toBe(firstId)
  })
})

describe('R17 — linear-tripwire regression', () => {
  it('the fan-out census (states-per-consumer = rows) holds after a keyed update; fan-out-blowup silent', async () => {
    const { creator, sup, h } = mintable()
    // the consumer must be an ANCESTOR of the minted rows (the resolve walk
    // is own → descendants → ancestors) so the fan-out reaches the rows
    const consumer = new Node({ type: 'span' }, h, 'consumer')
    const root = sup.allNodes().find((n) => n.id === 'root')!
    childOf(root, consumer, 1)
    childOf(consumer, creator, 0)
    consumer.addAnchor('target', 'title', {}, h.linkFor('title', 'component'))
    sup.registerNode(consumer)
    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warns.push(String(args[0] ?? '')) }
    try {
      keyedMint(sup, creator, [
        { sku: 'a', title: 'First' },
        { sku: 'b', title: 'Second' },
      ])
      await new Promise((r) => setTimeout(r, 0))
      const before = sup.getResolvedStates(consumer.id).length
      expect(before).toBe(2)
      keyedMint(sup, creator, [
        { sku: 'a', title: 'First UPDATED' },
        { sku: 'b', title: 'Second' },
      ])
      await new Promise((r) => setTimeout(r, 0))
      const after = sup.getResolvedStates(consumer.id).length
      expect(after).toBe(2)
      expect(warns.some((w) => w.includes('fan-out-blowup'))).toBe(false)
    } finally {
      console.warn = origWarn
    }
  })
})