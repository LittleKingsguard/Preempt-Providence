/**
 * HOOKS ARRAY-INJECTION (docs/specs/hooks-array-injection-review.md §9 —
 * CONTRACT AMENDMENT C). The §9.4 TDD list, red → green:
 *   (1) the `hooksKind` field round-trip (baseFrom/nodeToLegacy/serialize/
 *       loadState) + `hooks-kind-shape-invalid` + `hooks-kind-unknown`
 *       containment;
 *   (2) the `hook-kind-mismatch` write rejection;
 *   (3) the rows-mint op (prototype-by-name, per-row value-bearing anchor
 *       mint via `AnchorDecl.value`, the mint-side consumer walk, batch
 *       registration);
 *   (4) per-batch journaling + replay idempotency;
 *   (5) round-trip re-mint (serialized-doc path) + the NODE-SCOPED batch
 *       layerId (DEFECT #23);
 *   (6) payload-controlled teardown (no-promotion) + undo/redo via the
 *       payload surface;
 *   (7) `rows-prototype-unresolved` FAIL-WITH-WARNING + `rows: []` clear +
 *       same-layerId replace pins;
 *   (8) the `'placement'`-kind mint-with-target-placement + components pin;
 *   the §7 scalar regression suite (hook writes stay VALUES) lives in
 *   tests/unit/hooks.test.ts (unchanged).
 *
 * RED-STATE TDD: this file is written BEFORE the implementation exists —
 * the `hooksKind` field, the `hooks-kind-*` codes, the `kind` gate, and the
 * rows-mint machinery do not exist yet.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { translateLegacy, reverseTranslate } from '../../src/core/translate.js'
import { serializeSlice, loadState } from '../../src/core/serialize.js'
import { hub, childOf } from '../helpers/fixtures.js'
import { registerDefPrototypes, registerDefRootPrototype, defPrototypesFor, defRootPrototypeFor, mintedByOrigin } from '../../src/core/registry.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function supervisorOf(events: EventBridge, root: Node, nodes: Node[]): Supervisor {
  const sup = new Supervisor({ ...(root.hubFor ? { hub: root.hubFor } : {}), events })
  for (const n of nodes) sup.registerNode(n)
  return sup
}

/** Provider root (source anchor `theme` = 'dark') + a plain consumer child,
 *  with optional `hooks` names + `hooksKind` declarations. */
function providerConsumerEnvelope(hooks?: unknown, hooksKind?: unknown) {
  return {
    template: {
      root: {
        type: 'div',
        children: [
          { type: 'section', props: { id: 'consumer' }, component: [{ reference: 'theme' }] },
        ],
        component: [{ reference: 'theme', value: 'dark' }],
        ...(hooks !== undefined ? { hooks } : {}),
        ...(hooksKind !== undefined ? { hooksKind } : {}),
      },
    },
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

// ---- §9.4 item 1 — the hooksKind field round-trip ------------------------

describe('pin 1 — the hooksKind field round-trip (the derived/handlers precedent)', () => {
  it('carries the field onto the provider node base with zero warnings', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'value' }) as never)
    const root = t.root
    expect(root.base.hooks).toEqual(['theme'])
    expect(root.base.hooksKind).toEqual({ theme: 'value' })
    expect(t.warnings).toEqual([])
  })

  it('a name declared in hooksKind without a hooks entry is carried regardless (the record is independent)', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'value', other: 'component' }) as never)
    expect(t.root.base.hooksKind).toEqual({ theme: 'value', other: 'component' })
    expect(t.warnings).toEqual([])
  })

  it('hooks-kind-shape-invalid — a non-object field warns + is skipped', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme'], 'value') as never)
    expect(t.root.base.hooksKind).toBeUndefined()
    expect(t.warnings.some((w) => w.code === 'hooks-kind-shape-invalid')).toBe(true)
    spy.mockRestore()
  })

  it('hooks-kind-unknown — a kind value outside the closed union warns + skips that entry only', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'value', bad: 'frobnicate' }) as never)
    expect(t.root.base.hooksKind).toEqual({ theme: 'value' })
    expect(t.warnings.some((w) => w.code === 'hooks-kind-unknown')).toBe(true)
    spy.mockRestore()
  })

  it('hooks-kind-shape-invalid — a non-string kind value warns + skips that entry only', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 42 } as never) as never)
    expect(t.root.base.hooksKind).toBeUndefined()
    expect(t.warnings.some((w) => w.code === 'hooks-kind-shape-invalid')).toBe(true)
    spy.mockRestore()
  })

  it('reverse emits the field back; re-translate round-trips with zero warnings', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'component' }) as never)
    const reversed = reverseTranslate(t.root, { content: t.content })
    const rootData = reversed.template.root as { hooksKind?: unknown }
    expect(rootData.hooksKind).toEqual({ theme: 'component' })
    const re = translateLegacy(reversed as never)
    expect(re.root.base.hooksKind).toEqual({ theme: 'component' })
    expect(re.warnings).toEqual([])
  })

  it('serialize → loadState reproduces the field', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'placement' }) as never)
    const doc = serializeSlice(t.root, t.nodes)
    const seeded = loadState(JSON.parse(JSON.stringify(doc)))
    const reloaded = seeded.map((d) => new Node(d, hub()))
    const provider = reloaded.find((n) => n.id === t.root.id)!
    expect(provider.base.hooksKind).toEqual({ theme: 'placement' })
  })

  it('serialized hooksKind with an unknown kind is rejected at the schema boundary', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'value' }) as never)
    const doc = serializeSlice(t.root, t.nodes) as unknown as { template: { hooksKind: unknown } }
    doc.template.hooksKind = { theme: 'frobnicate' }
    expect(() => loadState(JSON.parse(JSON.stringify(doc)))).toThrow()
  })
})

// ---- §9.4 item 1b — the kind defaults to 'value' --------------------------

describe('pin 1 — the implicit-value default', () => {
  it("a hooks name with no hooksKind entry is treated as kind 'value' (no warn, no reclassification)", () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    expect(t.root.base.hooks).toEqual(['theme'])
    expect(t.root.base.hooksKind).toBeUndefined()
    expect(t.warnings).toEqual([])
    spy.mockRestore()
  })
})

// ---- §9.4 item 2 — the hook-kind-mismatch write rejection ----------------

describe('pin 2 — the kind gate rejects scalar writes to non-value hooks', () => {
  it('a scalar hooks.<name> write to a name declared kind "components" is REJECTED (hook-kind-mismatch)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'component' }) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, [t.root])
    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(res.status).toBe('rejected')
    const err = (res as { error?: { code?: string } }).error
    expect(err?.code).toBe('hook-kind-mismatch')
    spy.mockRestore()
  })

  it('a scalar hooks.<name> write to a name declared kind "placement" is REJECTED (hook-kind-mismatch)', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'placement' }) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, [t.root])
    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(res.status).toBe('rejected')
    const err = (res as { error?: { code?: string } }).error
    expect(err?.code).toBe('hook-kind-mismatch')
    spy.mockRestore()
  })

  it('a scalar hooks.<name> write to a name declared kind "value" (or undeclared) is STILL ACCEPTED', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme'], { theme: 'value' }) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, [t.root])
    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(res.status).toBe('applied')
    const anchor = t.root.anchors.find((a) => a.target === 'theme')!
    expect(anchor.value).toBe('light')
    spy.mockRestore()
  })
})

// ---- §9.4 item 3 — the rows-mint op --------------------------------------

describe('pin 3 — the rows-mint op mints per-row nodes from a prototype by name', () => {
  it('resolves the prototype by name, mints one family node per row, attaches per-row value-bearing source anchors', async () => {
    const h = hub()
    // the pre-minted def prototype registered against the per-name component Link
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    const protoLink = h.linkFor('item', 'component')
    registerDefPrototypes(protoLink, [proto])
    registerDefRootPrototype(protoLink, proto)

    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')

    const events = new EventBridge()
    // wire root + creator + register a consumer that references each row's per-row name
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [
        { id: 'r1', title: 'First' },
        { id: 'r2', title: 'Second' },
      ] as never,
      sourceName: 'rows-src',
    })
    expect(res.status).toBe('applied')
    const rows = (res as { minted?: string[] }).minted
    expect(rows).toBeDefined()
    expect(rows!.length).toBe(2)
    // each minted node is a family child of the creator
    expect(creator.children.length).toBe(2)
    const n1 = creator.children[0]!
    const n2 = creator.children[1]!
    // the minted node carries its row's fields as value-bearing source anchors
    const srcA = n1.anchors.find((a) => a.role === 'source' && a.target === 'title')
    expect(srcA).toBeDefined()
    expect((srcA as { value?: unknown }).value).toBe('First')
    const srcB = n2.anchors.find((a) => a.role === 'source' && a.target === 'title')
    expect((srcB as { value?: unknown }).value).toBe('Second')
    // the NODE-SCOPED batch layerId (DEFECT #23) marks both origins
    const layerId = `hook-creator-items-rows`
    expect(n1.originLayer).toBe(layerId)
    expect(n2.originLayer).toBe(layerId)
    expect(mintedByOrigin(layerId).sort()).toEqual([n1.id, n2.id].sort())
    // the batch layer lives on the creator with the child decls
    const layer = creator.layers.find((l) => l.id === layerId)
    expect(layer).toBeDefined()
    expect(layer!.sourceName).toBe('rows-src')
  })

  it('rolls up a batch record on the creator base (the batches field, Option C) with the prototype + rows + layerId', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'r1', title: 'First' }] as never,
      sourceName: 'rows-src',
    })
    expect(res.status).toBe('applied')
    const record = (creator as unknown as { batches?: Record<string, unknown> }).batches?.['items']
    expect(record).toBeDefined()
    expect((record as { prototypeName?: string }).prototypeName).toBe('item')
    expect((record as { rows?: unknown[] }).rows).toEqual([{ id: 'r1', title: 'First' }])
    expect((record as { layerId?: string }).layerId).toBe('hook-creator-items-rows')
  })

  it('the MINT-SIDE consumer walk dirties the consumers of the rows\' field names and refreshes their states per row (the cascade)', async () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    // the consumer is the ANCESTOR whose descendant tree holds the rows
    // (the resolve walk reaches the minted rows via the descendant walk)
    const consumer = new Node({ type: 'span', props: { id: 'consumer' } }, h, 'consumer')
    childOf(root, consumer, 1)
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    childOf(consumer, creator, 0)
    // the consumer references the row's per-row field name 'title'
    const titleLink = h.linkFor('title', 'component')
    consumer.addAnchor('target', 'title', {}, titleLink)
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.registerNode(consumer)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [
        { id: 'r1', title: 'First' },
        { id: 'r2', title: 'Second' },
      ] as never,
      sourceName: 'rows-src',
    })
    expect(res.status).toBe('applied')
    // the mint-side walk dirtied the consumer
    expect(res.dirtied).toContain(consumer.id)
    await new Promise((r) => setTimeout(r, 0))
    const pass2 = sup.takePass2States()
    const consumerStates = pass2.get(consumer.id)
    expect(consumerStates).toBeDefined()
    // the consumer resolves ONE arm per row (the multi-provider fan-out,
    // §9.2 pin 6): bindings.title per row value across the arms
    const titles = consumerStates!.map((cs) => cs.bindings.title)
    expect(titles).toContain('First')
    expect(titles).toContain('Second')
  })

  it('rows-prototype-unresolved — a prototypeName with no def prototypes FAILS WITH WARNING (rejected, never a silent empty mint)', async () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = hub()
    // no prototypes registered for 'item'
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'r1', title: 'First' }] as never,
      sourceName: 'rows-src',
    })
    expect(res.status).toBe('rejected')
    const err = (res as { error?: { code?: string } }).error
    expect(err?.code).toBe('rows-prototype-unresolved')
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('rows-prototype-unresolved'))
    expect(creator.children.length).toBe(0)
    expect(creator.layers.some((l) => l.id === 'hook-creator-items-rows')).toBe(false)
    spy.mockRestore()
  })
})

// ---- §9.4 item 4/5 — per-batch journaling + replay + DEFECT #23 + round-trip

describe('pin 4/5 — per-batch journaling, replay idempotency, node-scoped layerId, round-trip re-mint', () => {
  it('journals ONE entry per batch carrying result.minted (A3) + replay re-applies idempotently on the node-scoped layerId', async () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'r1', title: 'First' }, { id: 'r2', title: 'Second' }] as never,
      sourceName: 'rows-src',
    })
    // ONE journal entry with the minted ids (A3)
    const entries = sup.journal.filter((e) => e.op.kind === 'rows-mint')
    expect(entries).toHaveLength(1)
    const minted = (entries[0]!.result as { minted?: string[] }).minted
    expect(minted).toHaveLength(2)
    expect((entries[0]!.op as { layerId?: string }).layerId).toBeUndefined()
    // the NODE-SCOPED layerId is derived INSIDE the executor (DEFECT #23)
    const layerId = 'hook-creator-items-rows'
    expect(mintedByOrigin(layerId).sort()).toEqual([...minted!].sort())

    // replay re-applies the journal: the batch is REPLACED (same layerId =
    // replace pin), never accumulated; the no-journal mode (handoffs-review-4
    // §3c — DEFECT-JOURNAL-REPLAY-APPEND fix) keeps ONE entry per op.
    const before = creator.children.length
    sup.replay()
    const mintEntries = sup.journal.filter((e) => e.op.kind === 'rows-mint')
    expect(creator.children.length).toBe(before)
    expect(mintedByOrigin(layerId).length).toBe(2)
    expect(mintEntries.length).toBe(1)
  })

  it('the IDENTICAL row set re-applied on the SAME hookName REPLACES the batch (no accumulation, same layerId)', async () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    const applyRows = () => sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'r1', title: 'First' }, { id: 'r2', title: 'Second' }] as never,
      sourceName: 'rows-src',
    })
    applyRows()
    applyRows()
    expect(creator.children.length).toBe(2)
    expect(mintedByOrigin('hook-creator-items-rows').length).toBe(2)
  })

  it('serialize → loadState round-trips the batch record (the round-trip source: rows are DATA, minted nodes DERIVED)', async () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'r1', title: 'First' }] as never,
      sourceName: 'rows-src',
    })
    const serialized = serializeSlice(creator, [root, creator])
    const seeded = loadState(JSON.parse(JSON.stringify(serialized)))
    const reloaded = seeded.map((d) => new Node(d, h))
    const reCreator = reloaded.find((n) => n.id === 'creator')!
    const record = (reCreator as unknown as { batches?: Record<string, unknown> }).batches?.['items']
    expect(record).toBeDefined()
    expect((record as { prototypeName?: string }).prototypeName).toBe('item')
    expect((record as { rows?: unknown[] }).rows).toEqual([{ id: 'r1', title: 'First' }])
    expect((record as { layerId?: string }).layerId).toBe('hook-creator-items-rows')
  })
})

// ---- §9.4 item 6 — payload-controlled teardown (no-promotion) ------------

describe('pin 6 — payload-controlled teardown: the batches record is the single control handle', () => {
  function mintOnce(extraRows: unknown[] = []) {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'r1', title: 'First' }, ...extraRows] as never,
      sourceName: 'rows-src',
    })
    return { h, proto, root, creator, sup }
  }

  it('a rows-clear op (PAYLOAD-CONTROL) tears down the minted set + deletes the record; the rows never promote (no-promotion)', async () => {
    const { h, root, creator, sup } = mintOnce()
    const res = sup.apply({ kind: 'rows-clear', target: creator, hookName: 'items' } as never)
    expect(res.status).toBe('applied')
    // the payload record is gone — the SINGLE handle
    expect((creator as unknown as { batches?: Record<string, unknown> }).batches?.['items']).toBeUndefined()
    // the minted set is unregistered (mintedByOrigin empty) + the layer removed
    expect(mintedByOrigin('hook-creator-items-rows').length).toBe(0)
    expect(creator.layers.some((l) => l.id === 'hook-creator-items-rows')).toBe(false)
    // the rows are NOT promoted to authored content (no-promotion): their
    // origin marker stays cleared AND they are gone from the family tree
    await new Promise((r) => setTimeout(r, 0))
    expect(creator.children.length).toBe(0)
  })

  it('a rows-clear op on an unknown hookName is a contained no-op (applied, nothing to clear)', () => {
    const { creator, sup } = mintOnce()
    const res = sup.apply({ kind: 'rows-clear', target: creator, hookName: 'nope' } as never)
    expect(res.status).toBe('applied')
  })

  it('undo() of a rows-mint applies the payload-controlled teardown (the record is the undo handle)', async () => {
    const { creator, sup } = mintOnce()
    sup.undo()
    expect((creator as unknown as { batches?: Record<string, unknown> }).batches?.['items']).toBeUndefined()
    expect(mintedByOrigin('hook-creator-items-rows').length).toBe(0)
    await new Promise((r) => setTimeout(r, 0))
    expect(creator.children.length).toBe(0)
  })
})

// ---- §9.4 item 7 — the rows:[] CLEAR contract ----------------------------

describe('pin 7 — an empty rows batch is a CLEAR, not a sticky empty record', () => {
  it('rows: [] on an EXISTING batch clears the minted set + the record (empty = clear, distinct from the B5 children:[] no-op)', async () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    const creator = new Node({ type: 'section', props: { id: 'creator' } }, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ id: 'r1', title: 'First' }] as never,
      sourceName: 'rows-src',
    })
    expect(creator.children.length).toBe(1)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [] as never,
      sourceName: 'rows-src',
    })
    expect(res.status).toBe('applied')
    // the empty batch CLEARED: no minted set, no sticky record
    expect(mintedByOrigin('hook-creator-items-rows').length).toBe(0)
    expect((creator as unknown as { batches?: Record<string, unknown> }).batches?.['items']).toBeUndefined()
    await new Promise((r) => setTimeout(r, 0))
    expect(creator.children.length).toBe(0)
  })
})

// ---- §9.4 item 8 — the 'placement'-kind mint-with-target-placement --------

describe('pin 8 — the placement kind mints the rows with the target placement + components', () => {
  it('placement-kind rows-mint attaches a content anchor per row for the zone + the container anchor on the container', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'root' } }, h, 'root')
    // the container offers the zone (producer side)
    const container = new Node({ type: 'aside', props: { id: 'container' } }, h, 'container')
    container.addAnchor('container', 'main-zone', {}, h.linkFor('main-zone', 'placement'))
    const creator = new Node({ type: 'section', props: { id: 'creator' }, hooksKind: { items: 'placement' } } as never, h, 'creator')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })
    sup.registerNode(root)
    sup.registerNode(container)
    sup.registerNode(creator)
    // the hook is declared 'placement' so the kind gate admits the placement op
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'placement',
      prototypeName: 'item',
      placementName: 'main-zone',
      rows: [{ id: 'r1', title: 'First' }] as never,
      sourceName: 'rows-src',
    })
    expect(res.status).toBe('applied')
    const r1 = creator.children.find((c) => (c.base.props as { id?: string } | undefined)?.id === 'r1')
    // hmm — the row's props.id is a FIELD anchor, not props; find by the row's source 'id' anchor
    const row = creator.children[0]!
    expect(row).toBeDefined()
    // the row carries a CONTENT anchor for the placement zone (consumer side)
    expect(row.anchors.some((a) => a.role === 'content' && a.target === 'main-zone')).toBe(true)
    expect(row.anchors.some((a) => a.role === 'source' && a.target === 'title')).toBe(true)
    expect((row.anchors.find((a) => a.role === 'source' && a.target === 'title') as { value?: unknown }).value).toBe('First')
  })
})


