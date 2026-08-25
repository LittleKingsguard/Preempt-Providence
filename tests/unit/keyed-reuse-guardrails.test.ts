/**
 * KEYED-REUSE GUARDRAILS — the 2026-08-24 adversarial-1b fix pass (TDD).
 * Tests encode the fix contracts for the ADVERSARIAL-KEYED-S* defects
 * (archive/findings/2026-08-24/2026-08-24-keyed-adversarial-findings.md):
 *   G-S15  cross-graph shared-id reuse guard (a keyed mint never reuses a
 *          node that is NOT a child of THIS target)
 *   G-S22  keyed-undo bypasses the forward kind gate (values restore even
 *          after the hook's hooksKind changed)
 *   G-S16/S5/S10 the re-arm reshape — a keyed op whose record lost keyField
 *          re-arms keyed (all rows key-valid), so replay after a plain op
 *          reproduces the keyed identity
 *   G-S17  hub-less reused nodes gain NEW fields on reuse (no silent drop)
 *   G-S18  the keyed decls rewrite excludes non-batch family children
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { registerDefPrototypes } from '../../src/core/registry.js'
import { createLinkHub } from '../../src/core/translate.js'
import { hub, childOf } from '../helpers/fixtures.js'

afterEach(() => {
  vi.restoreAllMocks()
})

let seq = 0
function freshMintable(id?: string, useHub = true) {
  const h = useHub ? createLinkHub() : hub()
  registerDefPrototypes(h.linkFor('item', 'component'), [new Node({ type: 'li' }, h, 'proto')])
  seq += 1
  const root = new Node({ type: 'div' }, h, `root-${seq}`)
  const creator = new Node({ type: 'section', hooksKind: { items: 'component' } } as never, h, id ?? `creator-${seq}`)
  const sup = new Supervisor({ hub: h, events: new EventBridge() })
  sup.registerNode(root)
  sup.registerNode(creator)
  return { h, root, creator, sup }
}

function keyed(sup: Supervisor, creator: Node, rows: unknown[], keyField = 'sku') {
  return sup.apply({
    kind: 'rows-mint',
    target: creator,
    hookName: 'items',
    mintKind: 'component',
    prototypeName: 'item',
    keyField,
    rows,
  } as never)
}
function sku(c: Node): unknown {
  const s = c.anchors.find((a) => a.target === 'sku')
  return s === undefined ? undefined : s.value
}
function titleOf(c: Node): unknown {
  const s = c.anchors.find((a) => a.target === 'title')
  return s === undefined ? undefined : s.value
}
function recKeyField(creator: Node): string | undefined {
  const b = (creator as unknown as { batches?: Record<string, { keyField?: string }> }).batches?.items
  return b?.keyField
}

describe('G-S15 — cross-graph shared-id reuse guard', () => {
  it('two graphs in ONE process whose creators SHARE a node id + hookName do NOT cross-reuse', () => {
    const a = freshMintable('shared')
    keyed(a.sup, a.creator, [{ sku: 'a1', title: 'A1' }])
    const b = freshMintable('shared')
    keyed(b.sup, b.creator, [{ sku: 'b1', title: 'B1' }])
    expect(b.creator.children.length).toBe(1)
    expect(sku(b.creator.children[0]!)).toBe('b1')
    expect(titleOf(b.creator.children[0]!)).toBe('B1')
    expect(a.creator.children.length).toBe(1)
    expect(titleOf(a.creator.children[0]!)).toBe('A1')
    keyed(b.sup, b.creator, [{ sku: 'b1', title: 'B1 UPDATED' }])
    expect(b.creator.children.length).toBe(1)
    expect(titleOf(b.creator.children[0]!)).toBe('B1 UPDATED')
    expect(titleOf(a.creator.children[0]!)).toBe('A1')
  })
})

describe('G-S22 — keyed-undo bypasses the per-node kind gate', () => {
  it('undo of a keyed UPDATE still restores the pre-op values even after hooksKind changed', () => {
    const { creator, sup } = freshMintable()
    keyed(sup, creator, [{ sku: 'a', title: 'First' }])
    keyed(sup, creator, [{ sku: 'a', title: 'First NEW' }])
    // change the creator's hooksKind so the forward re-apply kind gate would reject
    const bk = (creator as unknown as { base: { hooksKind?: Record<string, string> } }).base.hooksKind
    if (bk) bk.items = 'placement'
    sup.undo()
    expect(titleOf(creator.children[0]!)).toBe('First')
  })
})

describe('G-S16/S5/S10 — the re-arm reshape', () => {
  it('a keyed op whose record lost keyField RE-ARMS keyed (all rows key-valid)', () => {
    const { creator, sup } = freshMintable()
    keyed(sup, creator, [{ sku: 'a', title: 'First' }])
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'Plain' }] as never,
    })
    expect(recKeyField(creator)).toBeUndefined()
    const rearm = keyed(sup, creator, [{ sku: 'a', title: 'Rearmed' }])
    expect(rearm.status).toBe('applied')
    expect(recKeyField(creator)).toBe('sku')
  })

  it('REPLAY re-arms a keyed op that follows a plain op (the keyed decision converges, no keyed-identity loss)', () => {
    const { creator, sup } = freshMintable()
    keyed(sup, creator, [{ sku: 'a', title: 'First' }])
    // a plain op (degrades, strips keyField)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'Plain' }] as never,
    })
    expect(recKeyField(creator)).toBeUndefined()
    // a keyed op RE-ARMS (record gains keyField) + replaces the plain rows
    const rearm = keyed(sup, creator, [{ sku: 'a', title: 'Rearmed' }])
    expect(rearm.status).toBe('applied')
    expect(recKeyField(creator)).toBe('sku')
    const liveSkuCount = creator.children.filter((c) => sku(c) === 'a').length
    expect(liveSkuCount).toBe(1)
    // replay reproduces the keyed final state (re-armed; no degrade on re-run)
    sup.replay()
    expect(recKeyField(creator)).toBe('sku')
    expect(creator.children.filter((c) => sku(c) === 'a').length).toBe(liveSkuCount)
  })
})

describe('G-S17 — keyed reuse gains NEW fields (no hub-less silent drop)', () => {
  it('a reused node gains a NEW field on a keyed update (the mint-path hub source is used)', () => {
    const { creator, sup } = freshMintable()
    keyed(sup, creator, [{ sku: 'a', title: 'First' }])
    const res = keyed(sup, creator, [{ sku: 'a', title: 'First', price: '9.99' }])
    expect(res.status).toBe('applied')
    const row = creator.children[0]!
    const price = row.anchors.find((a) => a.role === 'source' && a.target === 'price')
    expect(price).toBeDefined()
    expect((price as { value?: unknown }).value).toBe('9.99')
  })
})

describe('G-S18 — the keyed decls rewrite preserves the authored child', () => {
  it('an authored (non-batch) child of the batch owner survives a keyed update + clear', () => {
    const { creator, sup, h } = freshMintable()
    const authored = new Node({ type: 'span', content: 'authored' }, h, 'authored')
    childOf(creator, authored, 0)
    sup.registerNode(authored)
    keyed(sup, creator, [{ sku: 'a', title: 'First' }])
    expect(creator.children.some((c) => c.id === authored.id)).toBe(true)
    expect(authored.destroyed).toBe(false)
    keyed(sup, creator, [])
    expect(authored.destroyed).toBe(false)
    expect(creator.children.some((c) => c.id === authored.id)).toBe(true)
  })
})
