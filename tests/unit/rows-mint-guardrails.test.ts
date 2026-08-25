/**
 * ROWS-MINT GUARDRAILS — the 2026-08-24 adversarial fix pass (red → green).
 * Tests encode the fix contracts for the ADVERSARIAL-S1..S16 defects
 * (archive/findings/2026-08-24/2026-08-24-adversarial-findings.md):
 *   G1 (S1):  rows-op target type-check — string target → contained unknown-node
 *   G2 (S2):  destroyed target → contained no-usable-state, never uncaught
 *   G3 (S3):  row-shape validation + atomicity — no partial mint on bad rows
 *   G4 (S4):  serialize-exclude minted rows; round-trip never doubles
 *   G5 (S5):  teardown paths dirty the consumers (no stale fan-out arms)
 *   G6 (S6):  census boundary — same-name roots / root-less children rejected
 *   G7 (S7):  def-root fallback shape — a single-element def can mint
 *   G8 (S8/S9): no-promotion on the replace + clear paths
 *   G9 (S13): row `id` never hijacks the minted node id
 *   G10 (S14): smuggled row anchors stripped (rows-mint-anchors-rejected)
 *   G11 (S16): JSON-safety over batches/anchor values at serialize
 *   G12 (S15): placement-kind without placementName rejected
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { serializeSlice, loadState } from '../../src/core/serialize.js'
import { registerDefPrototypes, registerDefRootPrototype, mintedByOrigin } from '../../src/core/registry.js'
import { hub, childOf } from '../helpers/fixtures.js'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Minimal mint-able graph: a def prototype registered by name + an (unplaced
 *  is fine — the pre-fix contract) creator. Unique node ids per call — the
 *  module-level mintedByOrigin registry is keyed by the node-scoped layerId
 *  (DEFECT #23), so reused ids would cross-contaminate origins across tests. */
let mintSeq = 0
function mintable(extra = {}) {
  const h = hub()
  const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
  registerDefPrototypes(h.linkFor('item', 'component'), [proto])
  const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
  const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, `creator-${++mintSeq}`)
  const events = new EventBridge()
  const sup = new Supervisor({ hub: h, events })
  sup.registerNode(root)
  sup.registerNode(creator)
  return { h, proto, root, creator, sup, ...extra }
}

describe('G1 (ADVERSARIAL-S1) — rows-op target type-check', () => {
  it('a STRING target on rows-mint is a CONTAINED unknown-node rejection — never an uncaught throw', () => {
    const { creator, sup } = mintable()
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator.id as never,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    expect(res.status).toBe('rejected')
    expect((res as { error?: { code?: string } }).error?.code).toBe('unknown-node')
    expect(creator.children.length).toBe(0)
  })

  it('a STRING target on rows-clear is a CONTAINED unknown-node rejection — never a silent applied no-op', () => {
    const { creator, sup } = mintable()
    const res = sup.apply({ kind: 'rows-clear', target: creator.id as never, hookName: 'items' } as never)
    expect(res.status).toBe('rejected')
    expect((res as { error?: { code?: string } }).error?.code).toBe('unknown-node')
  })

  it('the clientAPI wire path resolves a string target (the refKey list) — a wire rows-mint applies', () => {
    const { creator, sup } = mintable()
    const client = createClient(sup)
    const res = client.apply(creator.id, {
      kind: 'rows-mint',
      target: creator.id,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }],
    })
    expect(res.status).toBe('applied')
    expect(creator.children.length).toBe(1)
  })
})

describe('G2 (ADVERSARIAL-S2) — rows-mint target state gate', () => {
  it('rows-mint on a DESTROYED target is a contained no-usable-state — never an uncaught throw, never a mint', async () => {
    const { creator, sup } = mintable()
    sup.apply({ kind: 'destroy', node: creator } as never)
    await new Promise((r) => setTimeout(r, 0))
    expect(creator.destroyed).toBe(true)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    expect(res.status).toBe('no-usable-state')
    expect(mintedByOrigin(`hook-${creator.id}-items-rows`).length).toBe(0)
  })

  it('rows-clear on a DESTROYED target is contained too', async () => {
    const { creator, sup } = mintable()
    sup.apply({ kind: 'destroy', node: creator } as never)
    await new Promise((r) => setTimeout(r, 0))
    expect(creator.destroyed).toBe(true)
    const res = sup.apply({ kind: 'rows-clear', target: creator, hookName: 'items' } as never)
    expect(res.status).toBe('no-usable-state')
  })
})

describe('G3 (ADVERSARIAL-S3) — row-shape validation + atomicity', () => {
  it('rows containing a null member → rejected BEFORE any minting (no orphan, no record, no layer)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { creator, sup } = mintable()
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }, null] as never,
    })
    expect(res.status).toBe('rejected')
    expect((res as { error?: { code?: string } }).error?.code).toBe('rows-shape-invalid')
    expect(creator.children.length).toBe(0)
    expect(mintedByOrigin(`hook-${creator.id}-items-rows`).length).toBe(0)
    expect((creator as unknown as { batches?: Record<string, unknown> }).batches?.['items']).toBeUndefined()
    expect(creator.layers.some((l) => l.id === `hook-${creator.id}-items-rows`)).toBe(false)
    spy.mockRestore()
  })

  it('rows: 5 (non-array) → contained rejection (rows-shape-invalid), never an uncaught not-iterable', () => {
    const { creator, sup } = mintable()
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: 5 as never,
    })
    expect(res.status).toBe('rejected')
    expect((res as { error?: { code?: string } }).error?.code).toBe('rows-shape-invalid')
  })

  it('rows: "ab" (string rows) → contained rejection, never spread-to-garbage-anchors', () => {
    const { creator, sup } = mintable()
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: ['ab'] as never,
    })
    expect(res.status).toBe('rejected')
    expect((res as { error?: { code?: string } }).error?.code).toBe('rows-shape-invalid')
    expect(creator.children.length).toBe(0)
  })

  it('rows: [] stays the CLEAR contract (legal, not rejected)', () => {
    const { creator, sup } = mintable()
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [] as never,
    })
    expect(res.status).toBe('applied')
  })

  it('a serialized doc with a null ROW MEMBER is rejected at the schema boundary (S3e — never a host-side crash)', () => {
    const { creator, sup } = mintable()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    const doc = serializeSlice(creator, [creator, ...sup.allNodes()])
    const template = doc.template as { batches: Record<string, { rows: unknown[] }> }
    template.batches.items!.rows.push(null)
    expect(() => loadState(JSON.parse(JSON.stringify(doc)))).toThrow('NodeSchema-shape-mismatch')
  })
})

describe('G4 (ADVERSARIAL-S4) — serialize-exclude minted rows; no double-mint', () => {
  it('a post-mint full-node-list serialize ships NO minted rows in content (origin-layer exclude)', () => {
    const { creator, sup, h } = mintable()
    const proto = new Node({ type: 'li' }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div' }, h, 'root')
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }, { title: 'Second' }] as never,
    })
    expect(creator.children.length).toBe(2)
    const doc = serializeSlice(creator, [...sup.allNodes()])
    const contentIds = doc.content.map((c) => (c as { id?: string }).id)
    // the minted rows (origin-minted) must NOT ship
    for (const row of creator.children) expect(contentIds).not.toContain(row.id)
    // the batch record still ships (rows are data)
    expect((doc.template as { batches?: Record<string, unknown> }).batches?.['items']).toBeDefined()
  })

  it('the round trip never DOUBLES the rows: seed + re-mint per the record → still N rows', () => {
    const { creator, sup } = mintable()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }, { title: 'Second' }, { title: 'Third' }] as never,
    })
    const doc = serializeSlice(creator, [...sup.allNodes()])
    const h2 = hub()
    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, h2))
    const reCreator = seeded.find((n) => n.id === creator.id)!
    const reRoot = seeded.find((n) => n.id === 'root')!
    const sup2 = new Supervisor({ hub: h2, events: new EventBridge() })
    sup2.registerNode(reRoot)
    sup2.registerNode(reCreator)
    const record = (reCreator as unknown as { batches?: Record<string, unknown> }).batches?.['items'] as {
      prototypeName: string; rows: unknown[]; mintKind: string; layerId: string
    }
    expect(record).toBeDefined()
    // re-register the prototype on the fresh hub (the recipe step 1.5)
    const proto2 = new Node({ type: 'li' }, h2, 'proto-2')
    registerDefPrototypes(h2.linkFor(record.prototypeName, 'component'), [proto2])
    const res = sup2.apply({
      kind: 'rows-mint',
      target: reCreator,
      hookName: 'items',
      mintKind: record.mintKind as 'component',
      prototypeName: record.prototypeName,
      rows: record.rows as never,
    })
    expect(res.status).toBe('applied')
    expect(reCreator.children.length).toBe(3)
  })
})

describe('G5 (ADVERSARIAL-S5) — teardown paths dirty the consumers', () => {
  /** root → consumer → creator; consumer targets the row field 'title'. */
  function withConsumer() {
    const { h, proto, root, creator, sup } = mintable()
    const consumer = new Node({ type: 'span', props: { id: 'consumer' } }, h, 'consumer')
    childOf(root, consumer, 1)
    childOf(consumer, creator, 0)
    consumer.addAnchor('target', 'title', {}, h.linkFor('title', 'component'))
    sup.registerNode(consumer)
    return { h, proto, root, creator, consumer, sup }
  }

  it('rows-clear dirties the field-name consumers (their stale fan-out arms refresh)', async () => {
    const { creator, consumer, sup } = withConsumer()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }, { title: 'Second' }] as never,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(sup.getResolvedStates(consumer.id).map((s) => s.bindings?.title)).toContain('First')
    const res = sup.apply({ kind: 'rows-clear', target: creator, hookName: 'items' } as never)
    expect(res.status).toBe('applied')
    expect(res.dirtied).toContain(consumer.id)
    await new Promise((r) => setTimeout(r, 0))
    // after the pass-2 refresh the consumer keeps only its OWN state — the
    // stale provider arms are gone (no title value)
    const after = sup.getResolvedStates(consumer.id)
    expect(after.length).toBe(1)
    expect(after[0]!.bindings?.title).toBeUndefined()
  })

  it('undo(rows-mint) dirties the field-name consumers', async () => {
    const { creator, consumer, sup } = withConsumer()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    await new Promise((r) => setTimeout(r, 0))
    const before = sup.getResolvedStates(consumer.id)
    expect(before.map((s) => s.bindings?.title)).toContain('First')
    sup.undo()
    // the undo path marks the consumers dirty (they pass-2 to their own state)
    await new Promise((r) => setTimeout(r, 0))
    const after = sup.getResolvedStates(consumer.id)
    expect(after.length).toBe(1)
    expect(after[0]!.bindings?.title).toBeUndefined()
  })
})

describe('G6 (ADVERSARIAL-S6) — census boundary', () => {
  function defDocWithCensus(census: unknown[]) {
    return {
      template: { id: 'root', type: 'div', anchors: [{ role: 'parent', target: 'rootNode', options: {} }] },
      content: [
        { id: 'proto-root', type: 'ul', anchors: [{ role: 'child', target: 'component', options: {} }] },
        { id: 'proto-child', type: 'li', anchors: [{ role: 'child', target: 'proto-root', options: {} }] },
      ],
      clientConfig: { adapter: 'dom', persistence: false },
      defPrototypes: census,
    }
  }

  it('two same-name isRoot entries → NodeSchema-shape-mismatch (never silent last-wins)', () => {
    const doc = defDocWithCensus([
      { name: 'nav', nodeId: 'proto-root', isRoot: true },
      { name: 'nav', nodeId: 'proto-child', isRoot: true },
    ])
    expect(() => loadState(doc as never)).toThrow('NodeSchema-shape-mismatch')
  })

  it('a children-only census (no root for the name) is LEGAL — translate mints def-roots only for css-carrying defs', () => {
    const doc = defDocWithCensus([
      { name: 'nav', nodeId: 'proto-child', isRoot: false },
    ])
    expect(loadState(doc as never).length).toBeGreaterThan(0)
  })

  it('a legal census (one root + its children under the same name) still parses', () => {
    const doc = defDocWithCensus([
      { name: 'nav', nodeId: 'proto-root', isRoot: true },
      { name: 'nav', nodeId: 'proto-child', isRoot: false },
    ])
    expect(loadState(doc as never).length).toBeGreaterThan(0)
  })
})

describe('G7 (ADVERSARIAL-S7) — def-root fallback shape', () => {
  it('a SINGLE-ELEMENT def (root only, no def-children) can mint — the def-root supplies the shape', () => {
    const h = hub()
    const rootProto = new Node({ type: 'div', css: { style: { color: 'red' } } }, h, 'proto-root')
    registerDefRootPrototype(h.linkFor('item', 'component'), rootProto)
    const root = new Node({ type: 'div' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    expect(res.status).toBe('applied')
    const row = creator.children[0]!
    expect(row.type).toBe('div')
  })
})

describe('G8 (ADVERSARIAL-S8/S9) — no-promotion on the replace + clear paths', () => {
  /** mintable with an IN-TREE root (the permanent rootNode parent) so a moved
   *  row genuinely reaches in-tree before the batch is replaced/cleared. */
  function mintableWithInTreeRoot() {
    const { h, proto, root, creator, sup } = mintable()
    root.addAnchor('parent', 'rootNode', {}, h.linkFor('rootNode', 'parent-child' as never))
    return { h, proto, root, creator, sup }
  }

  it('a MOVED row is doomed (not promoted) when the batch is REPLACED on the same hookName', async () => {
    const { creator, root, sup } = mintableWithInTreeRoot()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    const row = creator.children[0]!
    // move the row under the permanent root (the pre-fix replace path would
    // PROMOTE it — a non-origin chain to a permanent token)
    sup.apply({ kind: 'move', node: row, to: { parent: root } } as never)
    await new Promise((r) => setTimeout(r, 0))
    expect(row.state).toBe('in-tree')
    // re-mint on the same hookName REPLACES the batch
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'Second' }] as never,
    })
    await new Promise((r) => setTimeout(r, 0))
    // the moved row was NOT promoted to authored content: it is gone
    expect(row.destroyed).toBe(true)
    expect(creator.children.length).toBe(1)
  })

  it('the rows: [] clear-variant on an EXISTING batch dooms a moved row (no-promotion)', async () => {
    const { creator, root, sup } = mintableWithInTreeRoot()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    const row = creator.children[0]!
    sup.apply({ kind: 'move', node: row, to: { parent: root } } as never)
    await new Promise((r) => setTimeout(r, 0))
    expect(row.state).toBe('in-tree')
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [] as never,
    })
    await new Promise((r) => setTimeout(r, 0))
    expect(row.destroyed).toBe(true)
    expect(creator.children.length).toBe(0)
  })
})

describe('G9 (ADVERSARIAL-S13) — row `id` never hijacks the minted node id', () => {
  it('a row carrying an id mints a node with a FRESH id; the row id is a provider source value', () => {
    const { creator, sup } = mintable()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'product-42', title: 'First' }] as never,
    })
    const row = creator.children[0]!
    expect(row.id).not.toBe('product-42')
    // the row's id rides a value-bearing source anchor (consumers can read it)
    const idSrc = row.anchors.find((a) => a.role === 'source' && a.target === 'id')
    expect(idSrc).toBeDefined()
    expect((idSrc as { value?: unknown }).value).toBe('product-42')
  })

  it('an authored node id is never displaced by a minted row id (byId integrity)', async () => {
    const { creator, sup } = mintable()
    const h = creator.hubFor as never
    const authored = new Node({ type: 'div', props: { id: 'keep' } }, h, 'keep')
    sup.registerNode(authored)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'keep', title: 'First' }] as never,
    })
    // the authored node still resolves under its own id
    expect(sup.getNode('keep')).toBe(authored)
  })
})

describe('G10 (ADVERSARIAL-S14) — smuggled row anchors stripped', () => {
  it('a row carrying an anchors array mints WITHOUT the smuggled anchors + warns rows-mint-anchors-rejected', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { creator, sup } = mintable()
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First', anchors: [{ role: 'source', target: 'price', value: 99 }] }] as never,
    })
    expect(res.status).toBe('applied')
    const row = creator.children[0]!
    // no smuggled 'price' provider, no 'anchors' field anchor
    expect(row.anchors.some((a) => a.target === 'price')).toBe(false)
    expect(row.anchors.some((a) => a.target === 'anchors')).toBe(false)
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('rows-mint-anchors-rejected'))
    spy.mockRestore()
  })
})

describe('G11 (ADVERSARIAL-S16) — JSON-safety over batches', () => {
  it('serializing a graph whose batch record carries a function row throws serialization-error (never silent data loss)', () => {
    const { creator, sup } = mintable()
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    const creator2 = creator as unknown as { batches: Record<string, { rows: unknown[] }> }
    creator2.batches.items!.rows.push({ title: () => 'x' })
    expect(() => serializeSlice(creator, [creator, sup.allNodes()[0]!])).toThrow('serialization-error')
  })
})

describe('G12 (ADVERSARIAL-S15) — placement-kind mint without placementName', () => {
  it('placement-kind rows-mint with no placementName → rejected (never a silent no-placement)', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div' }, h, 'root')
    const creator = new Node({ type: 'section', hooksKind: { items: 'placement' } } as never, h, 'creator')
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'placement',
      prototypeName: 'item',
      rows: [{ title: 'First' }] as never,
    })
    expect(res.status).toBe('rejected')
    expect((res as { error?: { code?: string } }).error?.code).toBe('rows-placement-name-missing')
    expect(creator.children.length).toBe(0)
  })
})
