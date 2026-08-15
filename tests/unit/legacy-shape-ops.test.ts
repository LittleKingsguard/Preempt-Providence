/**
 * Run A (RED) — D7 anchor-layer seam ops contract (docs/specs/ops.md §2.7
 * ALS-1..7 + G23-G28; fix pass PENDING).
 *
 * States / fail-states enumerated:
 *
 * [1]  ALS-4/G24 — the seam grants the def child a SECOND legal parent: a
 *      'child' anchor whose options carry seam:true is admitted WITHOUT the
 *      single-parent gate (a def referenced more than once ⇒ multiple legal
 *      parents — INTENDED). Today the role-scoped exemption does not exist:
 *      SingleParentError throws.
 * [2]  G25 — a second FAMILY child anchor STILL rejects 'single-parent'
 *      (the guard scoping is seam-side only — already green).
 * [3]  ALS-2/ALS-3/G23 — after seam materialization: the consumer's own
 *      family parent edge is UNTOUCHED and the seam parent anchor (target =
 *      self, options.seam = true) sits on the consumer's anchors.
 * [4]  ALS-5/G26 — seam 'parent' anchors are DISTINCT from the family parent:
 *      familyLinkFor filters options.seam anchors and returns the FAMILY
 *      link; the family children walk ignores seam parent anchors (a
 *      seam-wired def child never appears in consumer.children).
 * [5]  G27/F18 — seam-wired def children enumerate via their PRIMARY (family)
 *      path only: the seam parent anchor never contributes a path hop —
 *      compilePath of a seam-wired def child (prototype-terminated primary
 *      chain) yields ZERO actionable states.
 * [6]  ALS-7/G28 — content-target text delivery: a layer carrying a content
 *      VALUE merges it into the consumer's compiled content slot (the
 *      testable layer unit — green today via generic layer machinery).
 * [7] G28 pipeline — a translate-planned target: 'content' binding resolves
 *      the def and delivers the def's content TEXT into the consumer's
 *      compiled content slot (NOT scalarBinding, NOT the def's children).
 *      A def WITHOUT a content field delivers nothing (consumer keeps its
 *      authored content).
 * [8] ALS-1/ALS-6 (VERIFICATION GAP, fix pass PENDING) — the def's PLACEMENT
 *      links ride the seam layer onto the consumer: a def child carrying
 *      `placement: [{placementName: 'zone'}]` is pre-minted WITH its
 *      container anchor (green — F16 landed), and after compile the seam
 *      consumer's anchors carry that container anchor too (the layer-passed
 *      placement link). RED today: nothing materializes — the container
 *      anchor exists only on the out-of-tree prototype.
 *
 * RED set today: 1, 3, 4, 5, 7, 8. Green-by-accident pins (flag): 2, 6, 7b.
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'
import { Node, type Node as NodeType } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { SingleParentError } from '../../src/core/errors.js'
import { makeRoot, makeNode, childOf, hub } from '../helpers/fixtures.js'
import type { Anchor } from '../../src/core/types.js'

/** SPEC-ENCODED pending (F15/F17): the seam anchor-option marker. */
const seamOpts = { seam: true } as Anchor['options']
const seamOf = (o: Anchor['options']): boolean => (o as { seam?: boolean }).seam === true

function defProto(type: string): Node {
  const n = makeNode({ type })
  const tokenLink = new Link({ name: 'parent-child' })
  n.addAnchor('child', n, { priority: 0 }, tokenLink)
  tokenLink.addAnchor({ role: 'parent', target: 'component', options: {}, link: tokenLink })
  return n
}

describe('D7 — the seam layer materializes def children as a SECOND LEGAL parent (ALS-2/3/4, G23-G25)', () => {
  it('[1] ALS-4/G24 — a seam ' + "'child'" + ' anchor (options.seam = true) is admitted WITHOUT the single-parent gate', () => {
    const root = makeRoot({ type: 'root' })
    const consumer = childOf(root, makeNode({ type: 'consumer' }), 0)
    const defChild = defProto('span') // pre-minted 'component'-token prototype (F16)
    const seamLink = new Link({ name: 'parent-child' })
    consumer.addAnchor('parent', consumer, seamOpts, seamLink) // ALS-2: parent side ON the consumer
    // the exemption: the def child's SECOND 'child' anchor (layer-materialized,
    // seam-marked) is admitted — a def referenced twice ⇒ multiple legal parents
    const anchor = defChild.addAnchor('child', defChild, seamOpts, seamLink)
    expect(anchor).not.toBeNull()
    expect(defChild.childAnchor()).not.toBeNull()
    void consumer
  })

  it('[2] G25 — a second FAMILY child anchor still rejects ' + "'single-parent'" + ' (guard scoping is seam-side only)', () => {
    const root = makeRoot({ type: 'root' })
    const c = childOf(root, makeNode({ type: 'c' }), 0)
    const other = new Link({ name: 'parent-child' })
    expect(() => c.addAnchor('child', c, {}, other)).toThrow(SingleParentError)
  })

  it('[3] ALS-3/G23 — after the seam, the consumer' + "'s OWN family parent anchor is untouched and the seam parent anchor (target = self, options.seam = true) sits on the consumer", () => {
    const root = makeRoot({ type: 'root' })
    const consumer = childOf(root, makeNode({ type: 'consumer' }), 0)
    const familyLink = consumer.childAnchor()!.link
    const defChild = defProto('span')
    const seamLink = new Link({ name: 'parent-child' })
    consumer.addAnchor('parent', consumer, seamOpts, seamLink)
    defChild.addAnchor('child', defChild, seamOpts, seamLink)

    // the consumer's family edge is untouched (same link, same parent)
    expect(consumer.childAnchor()!.link).toBe(familyLink)
    const seamParents = consumer.anchors.filter((a) => a.role === 'parent' && seamOf(a.options))
    expect(seamParents).toHaveLength(1)
    expect(seamParents[0]!.target).toBe(consumer)
    expect(seamParents[0]!.link).toBe(seamLink)
    // ALS-5 (F19) — the exactly-one-parent invariant is scoped to NON-SEAM
    // anchors; here the consumer's family edge is its CHILD anchor (the
    // family PARENT anchor lives on root, the childOf parent side) and the
    // seam flow itself creates no family parent anchor — a family parent
    // anchor on the consumer only appears when `familyLinkFor` is invoked
    // (G26 — the [4] pin)
    expect(consumer.anchors.filter((a) => a.role === 'parent' && !seamOf(a.options))).toHaveLength(0)
  })
})

describe('D7 — seam parent anchors are DISTINCT from the family parent (ALS-5, G26)', () => {
  it('[4] familyLinkFor filters seam anchors and returns the FAMILY link; the family children walk ignores seam parents', () => {
    const root = makeRoot({ type: 'root' })
    const consumer = childOf(root, makeNode({ type: 'consumer' }), 0)
    const defChild = makeNode({ type: 'span' })
    const seamLink = new Link({ name: 'parent-child' })
    consumer.addAnchor('parent', consumer, seamOpts, seamLink)
    defChild.addAnchor('child', defChild, seamOpts, seamLink)

    // familyLinkFor must NOT return the seam link — it creates/returns the family link
    const fam = consumer.familyLinkFor()
    expect(fam).not.toBe(seamLink)
    const kid = makeNode({ type: 'kid' })
    kid.addAnchor('child', kid, { priority: 0 }, fam)
    expect(consumer.children.map((c: NodeType) => c.id)).toEqual([kid.id])
    // the seam-wired def child NEVER appears in the family children walk
    expect(consumer.children.map((c: NodeType) => c.id)).not.toContain(defChild.id)
    // ALS-5: exactly-one-parent-role is scoped to NON-SEAM anchors
    expect(consumer.anchors.filter((a) => a.role === 'parent' && !seamOf(a.options))).toHaveLength(1)
  })
})

describe('D7 — path enumeration excludes seam links (G27, F18)', () => {
  it('[5] a seam-wired def child enumerates via its PRIMARY (family) path only — the seam parent anchor never contributes a path hop', () => {
    const root = makeRoot({ type: 'root' })
    const consumer = childOf(root, makeNode({ type: 'consumer' }), 0)
    const defChild = defProto('span')
    const seamLink = new Link({ name: 'parent-child' })
    consumer.addAnchor('parent', consumer, seamOpts, seamLink)
    defChild.addAnchor('child', defChild, seamOpts, seamLink)

    // the seam child anchor is the FIRST child anchor — a walk MUST still
    // ignore it: the def child's only path is its prototype-terminated
    // primary chain, so compilePath yields ZERO actionable states
    const res = defChild.compilePath()
    expect(res.actionable).toEqual([])
    expect(res.dropped.every((d) => d.reason === 'prototype-terminated' || d.reason === 'owner-terminated')).toBe(true)
  })
})

describe('D7 — content-target text delivery (ALS-7, G28)', () => {
  it('[6] the layer content VALUE unit: a layer carrying content merges it into the compiled content slot (green today)', () => {
    const root = makeRoot({ type: 'root' })
    const consumer = childOf(root, makeNode({ type: 'consumer', content: 'own' }), 0)
    consumer.addLayer({ id: 'seam-content', content: 'def-text' })
    consumer.compileLocal()
    expect(consumer.content).toBe('def-text')
  })

  it('[7] G28 pipeline — a translate-planned target: ' + "'content'" + ' binding delivers the def' + "'s TEXT into the consumer's compiled content slot", () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [
            { type: 'provider', component: { reference: 'defA', value: { type: 'div', content: 'def text' } } },
            { type: 'section', content: 'own text', component: { reference: 'defA', target: 'content' } },
          ],
        },
      },
      content: [],
    })
    const consumer = t.root.children[1]!
    const cr = t.root.compile(t.nodes)
    const state = cr.actionable.find((s) => s.nodeId === consumer.id)!
    // the def's content FIELD VALUE lands in the consumer's content slot
    // (NOT scalarBinding, NOT the def's children)
    expect(state.content).toBe('def text')
  })

  it('[7b] a def WITHOUT a content field delivers NO content — the consumer keeps its authored content', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [
            { type: 'provider', component: { reference: 'defB', value: { type: 'div' } } },
            { type: 'section', content: 'own text', component: { reference: 'defB', target: 'content' } },
          ],
        },
      },
      content: [],
    })
    const consumer = t.root.children[1]!
    const cr = t.root.compile(t.nodes)
    const state = cr.actionable.find((s) => s.nodeId === consumer.id)!
    expect(state.content).toBe('own text')
  })
})

describe('D7 — the def' + "'s PLACEMENT links ride the seam layer (ALS-1/ALS-6)", () => {
  it('[8] a def child' + "'s container anchor is reachable on the seam consumer after compile", () => {
    const t = translateLegacy({
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
              children: [
                { type: 'div', content: 'logo' },
                { type: 'div', placement: [{ placementName: 'zone' }] },
              ],
            },
          },
        ],
      },
      content: [],
    })
    const consumer = t.root.children[0]!

    // F16 (green) — the def child carrying the placement is pre-minted WITH
    // its container anchor (translate-side minting landed)
    const proto = t.nodes.find(
      (n: NodeType) => n.state === 'prototype' && n.anchors.some((a) => a.role === 'container' && a.target === 'zone'),
    )
    expect(proto).toBeDefined()

    // ALS-6 (red) — the layer pass carries the def's placement link onto the
    // seam consumer: after compile, the consumer's anchors include the
    // container anchor 'zone' (never re-minted, never re-vetoed — passed)
    t.root.compile(t.nodes)
    const container = consumer.anchors.find((a) => a.role === 'container' && a.target === 'zone')
    expect(container).toBeDefined()
  })
})
