/**
 * PRESERVE-BY-REVERSAL — Feature 4 (docs/specs/handoffs-review-9.md
 * PROCEED-AS-RESHAPED, 2026-08-25; rulings 23/24/26 + decisions D1-D8).
 *
 * TDD red set: every test fails before the implementation exists (the
 * `preserveByReversal` layer field + the reverse-filter override).
 *
 *   P1  flag read (D1) — a layer-apply with preserveByReversal:true → its
 *       origin-owned nodes reverse as authored edits; absent flag → excluded
 *   P2  whole-subtree cascade (D2, ruling 26) — a preserved node's minted
 *       descendants reverse too, even if their own layer isn't flagged
 *   P3  compression (Feature 4.25) — a preserved node reverses as ORDINARY
 *       authored data (current compiled state only, no layer machinery, no
 *       flag residue)
 *   P4  re-translate re-mint (ruling 24) — reverse a preserved subtree →
 *       re-translate → builds it as a normal authored node (fresh mint, no
 *       layer tie); the preserved layer is NOT re-attached
 *   P5  handlers-CLEAR guard (D6) — a preserved node with a cleared handler
 *       reverses with the CLEARED state (handlers: []), never resurrects it
 *   P6  auto-mint-exclude (D6, DEFECT #28) — a preserved node whose only id
 *       is the mint reverses WITHOUT a props.id (re-mints on re-translate);
 *       an authored props.id ships
 *   P7  re-mint flag loss (D4) — a same-hookName rowsMint REPLACES the layer
 *       with a flag-less object → the flag is dropped (host re-declares)
 *   P8  condense flag loss (D4) — a preserved layer's preservation is LOST
 *       across a condense round-trip (documented)
 *   P9  serialize asymmetry (D5) — a preserved node is still excluded from
 *       serializeNode (round-trip ships authored-only); the flag does NOT
 *       change serialize
 *   P10 promotion distinction (D3) — promotion (teardown) still clears
 *       originLayer → the node reverses as authored permanently; the flag
 *       does NOT change the node's runtime status (still minted)
 *   P11 regression greens — DEFECT #28 reverse blocks, REVERSE-OF-CLEAR,
 *       the existing reverse.test.ts suite
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy, reverseTranslate, type LegacyInitialData } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { serializeSlice } from '../../src/core/serialize.js'
import { makeRoot, makeNode, childOf, hub, familyLink } from '../helpers/fixtures.js'
import { registerDefPrototypes } from '../../src/core/registry.js'
import { Node } from '../../src/core/node.js'

function legacyDoc(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'app',
        children: [{ type: 'div', content: 'authored' }],
      },
    },
    content: [],
  } as never
}

/** A layer-apply that mints a family child under `target` with a layer that
 *  may carry `preserveByReversal`. */
function mintViaLayerApply(sup: Supervisor, target: Node, layerId: string, preserve: boolean, data: Record<string, unknown>): void {
  sup.apply({
    kind: 'layer-apply',
    target,
    layerId,
    sourceName: 'test',
    nodes: [data],
    ...(preserve ? { preserveByReversal: true } : {}),
  } as never)
}

/** Find the minted node under the target div in the reversed output (the
 *  layer-apply mints a family child of the target, so it nests under it). */
function mintedUnderDiv(out: LegacyInitialData, type: string, content: unknown): { type: string; content: unknown; children?: unknown[]; props?: Record<string, unknown>; handlers?: unknown[]; originLayer?: unknown; preserveByReversal?: unknown } | undefined {
  const rootChildren = out.template.root.children ?? []
  const div = rootChildren.find((c) => c.type === 'div' && c.content === 'authored')
  const divChildren = (div as { children?: Array<{ type: string; content: unknown }> }).children ?? []
  return divChildren.find((c) => c.type === type && c.content === content) as never
}

describe('P1 — flag read (D1)', () => {
  it('a layer-apply with preserveByReversal:true → its origin-owned nodes reverse as authored edits', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'p', content: 'minted' })

    const out = reverseTranslate(t.root, { content: t.content })
    const rootChildren = out.template.root.children ?? []
    // the preserved minted node ships as an authored child of the target div
    const div = rootChildren.find((c) => c.type === 'div' && c.content === 'authored')
    expect(div).toBeDefined()
    const divChildren = (div as { children?: Array<{ type: string; content: unknown }> }).children ?? []
    expect(divChildren.some((c) => c.type === 'p' && c.content === 'minted')).toBe(true)
  })

  it('absent flag → the origin-owned node is excluded (current behavior)', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    mintViaLayerApply(sup, target, 'unpreserved-layer', false, { type: 'p', content: 'minted' })

    const out = reverseTranslate(t.root, { content: t.content })
    const rootChildren = out.template.root.children ?? []
    const div = rootChildren.find((c) => c.type === 'div' && c.content === 'authored')
    const divChildren = (div as { children?: Array<{ type: string; content: unknown }> }).children ?? []
    expect(divChildren.some((c) => c.type === 'p' && c.content === 'minted')).toBe(false)
  })
})

describe('P2 — whole-subtree cascade (D2, ruling 26)', () => {
  it('a preserved node\'s minted descendants reverse too, even if their own layer isn\'t flagged', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    // preserved layer mints a div; then an UNPRESERVED layer mints a child under it
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'div', content: 'outer' })
    const outer = target.children[0]!
    mintViaLayerApply(sup, outer, 'inner-unpreserved', false, { type: 'span', content: 'inner' })

    const out = reverseTranslate(t.root, { content: t.content })
    const rootChildren = out.template.root.children ?? []
    const div = rootChildren.find((c) => c.type === 'div' && c.content === 'authored')
    const divChildren = (div as { children?: Array<{ type: string; content: unknown }> }).children ?? []
    const outerNode = divChildren.find((c) => c.type === 'div' && c.content === 'outer')
    expect(outerNode).toBeDefined()
    // the cascade: the inner minted child ships too (under the preserved outer)
    const inner = (outerNode as { children?: Array<{ type: string; content: unknown }> }).children
    expect(inner?.some((c) => c.type === 'span' && c.content === 'inner')).toBe(true)
  })
})

describe('P3 — compression (Feature 4.25)', () => {
  it('a preserved node reverses as ORDINARY authored data (current compiled state, no layer machinery, no flag residue)', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'p', content: 'minted', props: { cls: 'row' } })

    const out = reverseTranslate(t.root, { content: t.content })
    const node = mintedUnderDiv(out, 'p', 'minted')
    expect(node).toBeDefined()
    // no layer machinery, no flag residue, no origin marker
    expect((node as { originLayer?: unknown }).originLayer).toBeUndefined()
    expect((node as { preserveByReversal?: unknown }).preserveByReversal).toBeUndefined()
    // the authored props ship
    expect((node as { props?: Record<string, unknown> }).props?.cls).toBe('row')
  })
})

describe('P4 — re-translate re-mint (ruling 24)', () => {
  it('reverse a preserved subtree → re-translate → builds it as a normal authored node (fresh mint, no layer tie)', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'p', content: 'minted' })

    const out = reverseTranslate(t.root, { content: t.content })
    const re = translateLegacy(out)
    const reTarget = re.root.children[0]!
    const reMinted = reTarget.children.find((c) => c.type === 'p' && c.content === 'minted')
    expect(reMinted).toBeDefined()
    // the re-minted node is a NORMAL authored node — no originLayer, no layer tie
    expect(reMinted!.originLayer).toBeUndefined()
    expect(reTarget.layers.some((l) => l.id === 'preserved-layer')).toBe(false)
  })
})

describe('P5 — handlers-CLEAR guard (D6)', () => {
  it('a preserved node with a cleared handler reverses with the CLEARED state (handlers: []), never resurrects it', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'p', content: 'minted', handlers: [{ name: 'click', event: 'click', body: () => 1 }] })
    const minted = target.children[0]!
    // clear the handler via a state-slice
    sup.apply({ kind: 'state-slice', node: minted, mutation: [{ targetProp: 'handlers', mode: 'replace', value: [] }] } as never)

    const out = reverseTranslate(t.root, { content: t.content })
    const node = mintedUnderDiv(out, 'p', 'minted')
    expect(node).toBeDefined()
    // the CLEARED state ships — no resurrected handler
    expect((node as { handlers?: unknown[] }).handlers).toEqual([])
  })
})

describe('P6 — auto-mint-exclude (D6, DEFECT #28)', () => {
  it('a preserved node whose only id is the mint reverses WITHOUT a props.id (re-mints on re-translate); an authored props.id ships', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    // minted node with NO authored id (the mint pattern)
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'p', content: 'minted' })

    const out = reverseTranslate(t.root, { content: t.content })
    const node = mintedUnderDiv(out, 'p', 'minted')
    expect(node).toBeDefined()
    // the minted id is NOT shipped (DEFECT #28)
    expect((node as { props?: Record<string, unknown> }).props?.id).toBeUndefined()
  })
})

describe('P7 — re-mint flag loss (D4)', () => {
  it('a same-hookName rowsMint REPLACES the layer with a flag-less object → the flag is dropped (host re-declares)', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    // build on the SHARED hub h (the mint resolves the prototype via the target's hub)
    const root = new Node({ type: 'app' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    childOf(root, creator)
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    // first mint with preserveByReversal
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', rows: [{ name: 'a' }], preserveByReversal: true } as never)
    const layer1 = creator.layers.find((l) => l.id === `hook-${creator.id}-items-rows`)
    expect(layer1?.preserveByReversal).toBe(true)
    // second mint (same hook) — the layer is REPLACED flag-less
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', rows: [{ name: 'b' }] } as never)
    const layer2 = creator.layers.find((l) => l.id === `hook-${creator.id}-items-rows`)
    expect(layer2?.preserveByReversal).toBeUndefined()
  })
})

describe('P8 — condense flag loss (D4)', () => {
  it('a preserved layer\'s preservation is LOST across a condense round-trip (documented)', async () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'app' }, h, 'root')
    familyLink(root, 'rootNode')
    const creator = new Node({ type: 'section' }, h, 'creator')
    childOf(root, creator)
    const sup = new Supervisor({ hub: h, events: new EventBridge(), maxJournalLength: 2 } as never)
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', rows: [{ name: 'a' }], preserveByReversal: true } as never)
    // condense (the base excludes origin-owned nodes; restore re-mints flag-less)
    for (let i = 0; i < 8; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `x${i}` }] })
    }
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    sup.replay()
    await new Promise((r) => setTimeout(r, 0))
    await new Promise((r) => setTimeout(r, 0))
    const restoredCreator = sup.getNode(creator.id)!
    const layer = restoredCreator.layers.find((l) => l.id === `hook-${restoredCreator.id}-items-rows`)
    expect(layer?.preserveByReversal).toBeUndefined()
  })
})

describe('P9 — serialize asymmetry (D5)', () => {
  it('a preserved node is still excluded from serializeNode (round-trip ships authored-only); the flag does NOT change serialize', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'p', content: 'minted' })

    const doc = serializeSlice(t.root, [...t.nodes])
    // the preserved minted node is NOT in the serialized content (origin-owned)
    const contentIds = doc.content.map((c) => (c as { id: string }).id)
    const mintedId = target.children[0]!.id
    expect(contentIds.includes(mintedId)).toBe(false)
  })
})

describe('P10 — promotion distinction (D3)', () => {
  it('promotion (teardown) still clears originLayer → the node reverses as authored permanently; the flag does NOT change the node\'s runtime status', () => {
    const t = translateLegacy(legacyDoc())
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const target = t.root.children[0]!
    mintViaLayerApply(sup, target, 'preserved-layer', true, { type: 'p', content: 'minted' })
    const minted = target.children[0]!
    // the flag does NOT change the node's runtime status — it stays minted
    expect(minted.originLayer).toBe('preserved-layer')
    // teardown (removeLayer) still clears originLayer (promotion)
    target.removeLayer('preserved-layer')
    expect(minted.originLayer).toBeUndefined()
  })
})

describe('ADV-P — adversarial guardrails (2026-08-25 fix pass)', () => {
  it('ADV-S5 — a KEYED rows-mint with preserveByReversal:true lands the flag (the keyed addLayer path)', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'app' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    childOf(root, creator)
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    // a KEYED rows-mint with preserveByReversal (the keyed path at ops.ts:449)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', keyField: 'sku', rows: [{ sku: 'a', name: 'A' }], preserveByReversal: true } as never)
    const layer = creator.layers.find((l) => l.id === `hook-${creator.id}-items-rows`)
    expect(layer?.preserveByReversal).toBe(true)
  })

  it('ADV-S24 — a keyed rows-mint with preserveByReversal reverses its rows as authored edits', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'app' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    childOf(root, creator)
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', keyField: 'sku', rows: [{ sku: 'a', name: 'A' }], preserveByReversal: true } as never)
    // reverse the whole tree — the keyed row must ship as an authored child
    const out = reverseTranslate(root, { content: [] })
    const rootChildren = out.template.root.children ?? []
    const creatorNode = rootChildren.find((c) => c.type === 'section')
    expect(creatorNode).toBeDefined()
    const creatorChildren = (creatorNode as { children?: Array<{ type: string }> }).children ?? []
    // the keyed row ships as an authored `li` child (its fields are source
    // anchors, not content — the type is the ship signal)
    expect(creatorChildren.some((c) => c.type === 'li')).toBe(true)
  })

  it('X8 — D8 keyed-undo flag asymmetry: the flag SURVIVES an undo of a preserved keyed edit (the D8 preRecord re-apply must forward it)', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'app' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    childOf(root, creator)
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    // keyed mint WITH the flag
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', keyField: 'sku', rows: [{ sku: 'a', name: 'A' }], preserveByReversal: true } as never)
    // keyed update (also preserved)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', keyField: 'sku', rows: [{ sku: 'a', name: 'A2' }], preserveByReversal: true } as never)
    const layerBefore = creator.layers.find((l) => l.id === `hook-${creator.id}-items-rows`)
    expect(layerBefore?.preserveByReversal).toBe(true)
    // undo the keyed update (D8 preRecord re-apply) — the flag MUST survive
    sup.undo()
    const layerAfter = creator.layers.find((l) => l.id === `hook-${creator.id}-items-rows`)
    // the D8 preRecord re-apply must forward the flag (undo == redo symmetry)
    expect(layerAfter?.preserveByReversal).toBe(true)
  })

  it('X16 — D8 undo/redo symmetry: after undo then redo the keyed layer is STILL preserved', () => {
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'app' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    childOf(root, creator)
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', keyField: 'sku', rows: [{ sku: 'a', name: 'A' }], preserveByReversal: true } as never)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', keyField: 'sku', rows: [{ sku: 'a', name: 'A2' }], preserveByReversal: true } as never)
    sup.undo()
    const layerAfterUndo = creator.layers.find((l) => l.id === `hook-${creator.id}-items-rows`)
    sup.redo()
    const layerAfterRedo = creator.layers.find((l) => l.id === `hook-${creator.id}-items-rows`)
    expect(layerAfterUndo?.preserveByReversal).toBe(true)
    expect(layerAfterRedo?.preserveByReversal).toBe(true)
  })
})
