/**
 * translate.ts unit contract — legacy /Preempt NodeSchema → anchor graph.
 *
 * Mapping (per §10.10.1 + user decision): the root node stores its OWN
 * default children (`template.root.children`, attached in-tree). The
 * `template.children` list and content-payload items are the UNPLACED
 * content nodes — translated without a parent anchor, returned in
 * `TranslatedTree.content`, awaiting placement.
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'
import { serializeSlice, loadState } from '../../src/core/serialize.js'
import { Node, reconcileParentTargets } from '../../src/core/node.js'
import { hub } from '../helpers/fixtures.js'
import type { Node as NodeType } from '../../src/core/node.js'

function legacyDoc(): LegacyInitialData {
  return {
    template: {
      // the root stores its own default children
      root: {
        type: 'app',
        props: { app: true },
        css: { id: 'css-app' },
        component: { reference: 'shell' },
        handlers: [{ name: 'boot', phase: 'after-render', body: () => 'booted' }],
        children: [
          { type: 'header', content: 'head', handlers: [{ name: 'click', event: 'click', body: () => 1 }] },
          {
            type: 'pane',
            component: { reference: 'panel', value: { variant: 'a' } },
            children: [{ type: 'badge', content: 'nested' }],
          },
        ],
      },
      // template.children → unplaced content nodes
      children: [{ type: 'hero', content: 'hero' }],
    },
    content: [
      {
        metadata: { locale: 'en' },
        userData: { session: 's1' },
        content: [
          {
            type: 'card',
            placement: { placementName: 'slot-alpha' },
            children: [{ type: 'title', content: 'T' }],
          },
        ],
      },
    ],
    clientConfig: { runInstantiation: true, runMonitoring: true },
  }
}

describe('translateLegacy — original /Preempt schema → anchor graph', () => {
  it('builds the root with its own default children (in-tree, array order = priority)', () => {
    const t = translateLegacy(legacyDoc())
    expect(t.root.type).toBe('app')
    expect(t.root.state).toBe('in-tree')
    expect(t.root.props).toMatchObject({ app: true })
    expect(t.root.css?.id).toBe('css-app')

    // root's OWN children (NodeData.children on the root) attach under it
    const children = t.root.children
    expect(children.map((c: NodeType) => c.type)).toEqual(['header', 'pane'])
    expect(children.map((c: NodeType) => c.parent).every((p) => p === t.root)).toBe(true)

    // nested children attach recursively
    const pane = children[1]!
    expect(pane.children.map((c: NodeType) => c.type)).toEqual(['badge'])
    expect(pane.children[0]!.content).toBe('nested')
  })

  it('template.children + content payloads become UNPLACED content nodes, never root children', () => {
    const t = translateLegacy(legacyDoc())
    // template.children (hero) + payload item (card)
    expect(t.content.map((c: NodeType) => c.type)).toEqual(['hero', 'card'])
    for (const c of t.content) {
      expect(c.parent).toBeNull()
      expect(c.state).toBe('unplaced')
    }
    // root children are ONLY the root's own default children
    expect(t.root.children.map((c: NodeType) => c.type)).toEqual(['header', 'pane'])
    // nested children inside a content node still attach within it
    expect(t.content[1]!.children.map((c: NodeType) => c.type)).toEqual(['title'])
  })

  it('materializes component bindings as target anchors (reference + value)', () => {
    const t = translateLegacy(legacyDoc())
    const targets = t.root.anchors.filter((a) => a.role === 'target' && typeof a.target === 'string')
    expect(targets.map((a) => a.target)).toContain('shell')

    const pane = t.root.children[1]!
    const paneTarget = pane.anchors.find((a) => a.role === 'target' && a.target === 'panel')!
    expect(paneTarget).toBeDefined()
    expect(paneTarget.value).toEqual({ variant: 'a' })
  })

  it('materializes placement configs as placement anchors', () => {
    const t = translateLegacy(legacyDoc())
    const card = t.content[1]!
    const placement = card.anchors.find((a) => a.role === 'placement')!
    expect(placement).toBeDefined()
    expect(placement.target).toBe('slot-alpha')
  })

  it('carries legacy handlers onto the translated nodes', () => {
    const t = translateLegacy(legacyDoc())
    expect(t.root.handlers).toHaveLength(1)
    expect((t.root.handlers as Array<{ name: string }>)[0]?.name).toBe('boot')
    const header = t.root.children[0]!
    expect(header.handlers).toHaveLength(1)
    expect((header.handlers as Array<{ event?: string }>)[0]?.event).toBe('click')
  })

  it('surfaces payload metadata/userData (first payload wins)', () => {
    const t = translateLegacy(legacyDoc())
    expect(t.metadata).toEqual({ locale: 'en' })
    expect(t.userData).toEqual({ session: 's1' })
  })

  it('maps legacy run* gates to adapter + persistence', () => {
    const t = translateLegacy(legacyDoc())
    expect(t.clientConfig).toEqual({ adapter: 'ssr', persistence: true })

    const t2 = translateLegacy({ template: { root: { type: 'app' } } })
    expect(t2.clientConfig).toEqual({ adapter: 'dom', persistence: false })
  })

  it('unplaced content nodes are not actionable until placed; root subtree compiles', () => {
    const t = translateLegacy(legacyDoc())
    // content nodes are unplaced → dropped from compile (S1.1)
    const res = t.root.compile(t.nodes)
    const droppedIds = res.dropped.map((d) => d.arm[0])
    for (const c of t.content) expect(droppedIds).toContain(c.id)
    // root + its own children are actionable
    expect(res.actionable.map((s) => s.nodeId)).toContain(t.root.id)
    expect(res.actionable.map((s) => s.nodeId)).toContain(t.root.children[0]!.id)
  })

  it('the translated tree round-trips through the new-format boundary (serialize → load → reconcile → compile)', () => {
    const t = translateLegacy(legacyDoc())
    // full tree (root + own children incl. nested badge + unplaced content)
    const doc = serializeSlice(t.root, t.nodes, t.clientConfig)
    expect(doc.clientConfig).toEqual(t.clientConfig)

    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded)
    const cr = seeded[0]!.compile(seeded)
    expect(cr.actionable.map((s) => s.nodeId)).toContain(t.root.id)
    expect(cr.actionable.map((s) => s.nodeId)).toContain(t.root.children[1]!.id) // pane w/ nested badge
    // nested badge was serialized (not a phantom child) and re-renders in-tree
    const paneId = t.root.children[1]!.id
    const paneState = cr.actionable.find((s) => s.nodeId === paneId)!
    expect(paneState.children).toContain(t.root.children[1]!.children[0]!.id)
  })

  it('rejects malformed legacy envelopes', () => {
    expect(() => translateLegacy(null as never)).toThrow()
    expect(() => translateLegacy({ template: {} } as never)).toThrow()
    expect(() =>
      translateLegacy({ template: { root: { type: 'app' } }, content: [{ content: 'nope' }] } as never),
    ).toThrow()
  })

  it('a shared hub keeps same-name component/placement anchors on shared links', () => {
    const h = hub()
    const t = translateLegacy(legacyDoc(), { hub: h })
    const shellLink = h.linkFor('shell', 'component')
    expect(shellLink.anchorsOf('target')).toHaveLength(1)
    const slotLink = h.linkFor('slot-alpha', 'placement')
    expect(slotLink.anchorsOf('placement')).toHaveLength(1)
    void t
  })

  it('is deterministic and independent of fixture roots', () => {
    const t = translateLegacy({ template: { root: { type: 'page' } } })
    expect(t.root.id).toBeTruthy()
    expect(t.nodes).toHaveLength(1)
    expect(t.content).toHaveLength(0)
  })
})
