/**
 * Feature 1a — Def-prototype round-trip (handoffs-review-5.md PROCEED-AS-
 * RESHAPED, 2026-08-24): the CENSUS section `defPrototypes?: {name, nodeId,
 * isRoot}[]` whose prototype STATE rides `content` (status quo transport),
 * the loadState-side re-REGISTRATION helper `reRegisterDefPrototypes`, the
 * seam-anchor strip (C2), the ordering tripwire (C3/C5), and the §4 caveat
 * flip (doc-carriage-conditional).
 */
import { describe, it, expect } from 'vitest'
import { Node, Supervisor, reconcileParentTargets } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub, translateLegacy } from '../../src/core/translate.js'
import { serializeSlice, loadState, reRegisterDefPrototypes, type SerializedRenderDoc } from '../../src/core/serialize.js'
import { registerDefPrototypes, registerDefRootPrototype, defPrototypesFor, defRootPrototypeFor, defNameForLink } from '../../src/core/registry.js'
import { hub, makePrototype } from '../helpers/fixtures.js'

/** A seam-targeted def-bearing legacy doc: css-carrying def (→ def-root
 *  minted) + two def-children. */
function defDoc(): ReturnType<typeof translateLegacy> {
  return translateLegacy({
    template: {
      root: {
        type: 'app',
        children: [{ type: 'div', component: [{ target: 'children', reference: 'nav' }] }],
      },
      component: [
        {
          reference: 'nav',
          value: {
            type: 'nav',
            css: { style: { color: 'red' } },
            children: [
              { type: 'div', content: 'logo' },
              { type: 'div', content: 'link' },
            ],
          },
        },
      ],
    },
    content: [],
  } as never)
}

describe('Feature 1a — census emit', () => {
  it('1. a def-bearing doc gains defPrototypes: {name, nodeId, isRoot} per entry, root first, children in mint order; a def-less doc has NO section key', () => {
    const t = defDoc()
    const doc = serializeSlice(t.root, t.nodes) as SerializedRenderDoc
    expect(doc.defPrototypes).toBeDefined()
    const census = doc.defPrototypes!
    expect(census.length).toBe(3) // 1 def-root + 2 def-children
    expect(census[0]!.name).toBe('nav')
    expect(census[0]!.isRoot).toBe(true)
    // root's nodeId is the def-root prototype instance
    expect(t.nodes.some((n) => n.id === census[0]!.nodeId && n.state === 'prototype')).toBe(true)
    // children in mint order, isRoot false
    expect(census[1]!.isRoot).toBe(false)
    expect(census[2]!.isRoot).toBe(false)
    expect(census[1]!.nodeId).not.toBe(census[2]!.nodeId)

    // a def-less doc has NO section key
    const plain = translateLegacy({
      template: { root: { type: 'app', children: [{ type: 'div', content: 'x' }] } },
      content: [],
    } as never)
    const plainDoc = serializeSlice(plain.root, plain.nodes) as SerializedRenderDoc
    expect(plainDoc.defPrototypes).toBeUndefined()
  })

  it('2. R3\': a process with TWO hubs\' registrations ships only the slice\'s own instances; never-registered seeds ship none', () => {
    const tA = defDoc()
    // graph B on a second hub (its own registration)
    const hubB = createLinkHub()
    const protoB = new Node({ type: 'li' }, hubB, 'proto-b')
    registerDefPrototypes(hubB.linkFor('other', 'component'), [protoB])

    const docA = serializeSlice(tA.root, tA.nodes) as SerializedRenderDoc
    // only A's entries — never B's (B's instances are not in A's slice)
    expect(docA.defPrototypes!.every((e) => e.name === 'nav')).toBe(true)
    expect(docA.defPrototypes!.some((e) => e.nodeId === 'proto-b')).toBe(false)

    // a 0.1.5-style graph (seeded, never re-registered) ships no census
    const plain = translateLegacy({
      template: { root: { type: 'app', children: [{ type: 'div', content: 'x' }] } },
      content: [],
    } as never)
    const doc = serializeSlice(plain.root, plain.nodes) as SerializedRenderDoc
    expect(doc.defPrototypes).toBeUndefined()
  })

  it('3. ruling-1 skip — a prototype registered on a name-less link contributes NO census entry', () => {
    const h = hub()
    const proto = new Node({ type: 'li' }, h, 'proto-nameless')
    registerDefPrototypes(h.linkFor('x', 'component'), [proto])
    expect(defNameForLink(h.linkFor('x', 'component'))).toBeUndefined()
    const root = new Node({ type: 'div' }, h, 'root')
    const doc = serializeSlice(root, [root, proto]) as SerializedRenderDoc
    // no census entries at all (the name-less registration was skipped)
    expect(doc.defPrototypes ?? []).toHaveLength(0)
    expect((doc.defPrototypes ?? []).some((e) => e.nodeId === 'proto-nameless')).toBe(false)
  })

  it('7. C2 strip — seam child anchors are dropped from prototype-state content entries', () => {
    const t = defDoc()
    t.root.compile(t.nodes) // materialize the seam
    const doc = serializeSlice(t.root, t.nodes) as SerializedRenderDoc
    const census = doc.defPrototypes!
    for (const entry of census) {
      const state = [doc.template, ...doc.content].find((n) => (n as { id?: string }).id === entry.nodeId)
      expect(state).toBeDefined()
      const anchors = (state as { anchors?: { role: string; options?: { seam?: boolean } }[] }).anchors ?? []
      expect(anchors.some((a) => a.role === 'child' && a.options?.seam)).toBe(false)
    }
  })
})

describe('Feature 1a — re-registration', () => {
  it('4. reRegisterDefPrototypes registers the SEEDED instances by identity on the host hub; the def-root derives prototype', () => {
    const t = defDoc()
    const doc = serializeSlice(t.root, t.nodes) as SerializedRenderDoc
    const h = createLinkHub()
    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, h))
    reconcileParentTargets(seeded)
    reRegisterDefPrototypes(doc, h, seeded)

    const link = h.linkFor('nav', 'component')
    const root = defRootPrototypeFor(link)
    expect(root).toBeDefined()
    const children = defPrototypesFor(link)
    expect(children.length).toBe(2)
    // INSTANCE IDENTITY = the seeded nodes (no second instances)
    const seededById = new Map(seeded.map((n) => [n.id, n]))
    expect(root).toBe(seededById.get(root!.id))
    for (const c of children) expect(seededById.get(c.id)).toBe(c)
    expect(root!.state).toBe('prototype')
    expect(children.every((c) => c.state === 'prototype')).toBe(true)
  })

  it('8. ordering tripwire — a def-child whose def-root is ABSENT from the seeded set derives unplaced and the helper throws NodeSchema-shape-mismatch; children census order is preserved', () => {
    const t = defDoc()
    const doc = serializeSlice(t.root, t.nodes) as SerializedRenderDoc
    const h = createLinkHub()
    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, h))
    // drop the def-root from the seeded set — the children's parent ref stays
    // unresolved → 'unplaced' (sweep-vulnerable) → the tripwire fires
    const defRootId = doc.defPrototypes!.find((e) => e.isRoot)!.nodeId
    const withoutRoot = seeded.filter((n) => n.id !== defRootId)
    reconcileParentTargets(withoutRoot)
    expect(() => reRegisterDefPrototypes(doc, h, withoutRoot)).toThrow('NodeSchema-shape-mismatch')

    // the good path preserves children census order
    reconcileParentTargets(seeded)
    reRegisterDefPrototypes(doc, h, seeded)
    const children = defPrototypesFor(h.linkFor('nav', 'component'))
    const censusChildren = doc.defPrototypes!.filter((e) => !e.isRoot)
    expect(children.map((n) => n.id)).toEqual(censusChildren.map((e) => e.nodeId))
  })

  it('6. seam re-materialization — a children-target consumer compiles post-restore and materializes the def-root wiring', () => {
    const t = defDoc()
    const doc = serializeSlice(t.root, t.nodes) as SerializedRenderDoc
    const h = createLinkHub()
    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, h))
    reconcileParentTargets(seeded)
    reRegisterDefPrototypes(doc, h, seeded)

    const consumer = seeded.find((n) => n.id === t.root.children[0]!.id)!
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    for (const n of seeded) sup.registerNode(n)
    const cr = consumer.compile(seeded)
    // the seam re-materialized: the def-root prototype is wired under the
    // consumer (its state flips prototype → in-tree through the seam chain),
    // and the def-children are re-homed under it (the reconcile consolidation)
    const defRoot = defRootPrototypeFor(h.linkFor('nav', 'component'))!
    expect(cr.actionable.some((s) => s.nodeId === consumer.id)).toBe(true)
    expect(defRoot.state).toBe('in-tree')
    expect(defRoot.children.map((n) => n.id)).toHaveLength(2)
    expect(defRoot.children.every((n) => n.state === 'in-tree')).toBe(true)
  })
})

describe('Feature 1a — schema boundary + the caveat flip', () => {
  it('9. schema boundary — non-array section → envelope-mismatch; malformed/duplicate/absent-nodeId → NodeSchema-shape-mismatch', () => {
    const t = defDoc()
    const doc = serializeSlice(t.root, t.nodes) as SerializedRenderDoc
    const good = JSON.parse(JSON.stringify(doc)) as SerializedRenderDoc

    // non-array section
    expect(() => loadState({ ...good, defPrototypes: 'nope' } as never)).toThrow('envelope-mismatch')
    // malformed entry (name non-string)
    expect(() => loadState({ ...good, defPrototypes: [{ name: 42, nodeId: 'x', isRoot: false }] } as never)).toThrow('NodeSchema-shape-mismatch')
    // malformed entry (isRoot non-boolean)
    expect(() => loadState({ ...good, defPrototypes: [{ name: 'a', nodeId: 'x', isRoot: 'yes' }] } as never)).toThrow('NodeSchema-shape-mismatch')
    // duplicate nodeId
    expect(() => loadState({ ...good, defPrototypes: [good.defPrototypes![0], { ...good.defPrototypes![0], name: 'other' }] } as never)).toThrow('NodeSchema-shape-mismatch')
    // nodeId absent from the doc
    expect(() => loadState({ ...good, defPrototypes: [{ name: 'ghost', nodeId: 'no-such-node', isRoot: false }] } as never)).toThrow('NodeSchema-shape-mismatch')
    // duplicate NAMES are LEGAL (a def-root + its def-children share the
    // registration name — the good doc's 3 entries are all named 'nav')
    expect(loadState({ ...good, defPrototypes: [good.defPrototypes![0], { ...good.defPrototypes![1], name: good.defPrototypes![0]!.name }] } as never).length).toBeGreaterThan(0)
    // the good doc still parses
    expect(loadState(good).length).toBeGreaterThan(0)
  })

  it('10. caveat flip — a section-absent reseeded graph rows-mints with rows-prototype-unresolved; the re-registered doc resolves (the absent arm of BH-N.4)', async () => {
    const h = hub()
    // makePrototype carries the 'component' token edge (the
    // attachToPermanentOwner shape — a prototype derives 'prototype' through it)
    const proto = makePrototype({ type: 'li', props: { cls: 'row' } }, 'proto-1')
    // the provider-side source anchor registers the name on the def Link
    // (the census name recovery — translate.ts:751 shape)
    proto.addAnchor('source', 'item', {}, h.linkFor('item', 'component'))
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
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
    // serialize → loadState → seed on a FRESH hub WITHOUT re-registration
    const doc = serializeSlice(creator, [root, creator, proto]) as SerializedRenderDoc
    const h2 = createLinkHub()
    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, h2))
    reconcileParentTargets(seeded)
    const reCreator = seeded.find((n) => n.id === 'creator')!
    const reRoot = seeded.find((n) => n.id === 'root')!
    const reProto = seeded.find((n) => n.id === 'proto-1')!
    const sup2 = new Supervisor({ hub: h2, events: new EventBridge() })
    sup2.registerNode(reRoot)
    sup2.registerNode(reCreator)
    sup2.registerNode(reProto)
    const record = (reCreator as unknown as { batches?: Record<string, unknown> }).batches?.['items'] as { prototypeName: string; rows: unknown[] } | undefined
    expect(record).toBeDefined()

    // absent arm: rows-mint without re-registration → rows-prototype-unresolved
    const absent = sup2.apply({
      kind: 'rows-mint',
      target: reCreator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: record!.prototypeName,
      rows: record!.rows as never,
      sourceName: 'rows-src',
    })
    expect((absent as { error?: { code?: string } }).error?.code).toBe('rows-prototype-unresolved')

    // present arm: re-register (the census + the seeded def link) → the mint resolves
    reRegisterDefPrototypes(doc, h2, seeded)
    const present = sup2.apply({
      kind: 'rows-mint',
      target: reCreator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: record!.prototypeName,
      rows: record!.rows as never,
      sourceName: 'rows-src',
    })
    expect(present.status).toBe('applied')
    // re-mint twice = no accumulation (replace-in-place via the round-tripping layerId)
    const again = sup2.apply({
      kind: 'rows-mint',
      target: reCreator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: record!.prototypeName,
      rows: record!.rows as never,
      sourceName: 'rows-src',
    })
    expect(again.status).toBe('applied')
    expect(reCreator.children.length).toBe(1)
  })
})