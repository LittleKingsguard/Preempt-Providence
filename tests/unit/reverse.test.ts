/**
 * reverseTranslate unit contract — live tree → legacy backend format.
 * Written against the STUB surface; the implementation must make every
 * assertion pass (component/placement state reversed, user edits kept).
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy, reverseTranslate, type LegacyInitialData } from '../../src/core/translate.js'
import { makeRoot, makeNode, childOf, hub } from '../helpers/fixtures.js'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import type { Node } from '../../src/core/node.js'

function legacyDoc(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'app',
        component: { reference: 'shell' },
        children: [
          { type: 'header', content: 'Head', handlers: [{ name: 'click', event: 'click', body: () => 1 }] },
          { type: 'pane', component: { reference: 'panel', value: { variant: 'a' } }, children: [{ type: 'badge', content: 'nested' }] },
        ],
      },
      children: [{ type: 'hero', content: 'hero' }],
    },
    content: [
      {
        metadata: { locale: 'en' },
        userData: { session: 's1' },
        content: [{ type: 'card', placement: { placementName: 'slot-alpha' }, children: [{ type: 'title', content: 'T' }] }],
      },
    ],
    clientConfig: { runInstantiation: true, runMonitoring: true },
  }
}

describe('reverseTranslate — live tree → legacy format', () => {
  it('round-trips the authored document (template root + children + component; content payloads; placement)', () => {
    const doc = legacyDoc()
    const t = translateLegacy(doc)
    // place the content card into the zone (component/placement-induced state)
    const card = t.content[0]!
    card.addAnchor('child', card, { priority: 5 }, t.root.anchors.find((a) => a.role === 'parent')!.link)

    const out = reverseTranslate(t.root, { content: t.content, metadata: t.metadata, userData: t.userData })

    expect(out.template.root.type).toBe('app')
    expect(out.template.component).toEqual({ reference: 'shell' })
    // authored children in order (content roots excluded from template children)
    expect(out.template.root.children?.map((c) => c.type)).toEqual(['header', 'pane'])
    expect(out.template.root.children?.[1]?.children?.map((c) => c.type)).toEqual(['badge'])
    expect(out.template.root.children?.[1]?.component).toEqual({ reference: 'panel', value: { variant: 'a' } })
    // content payloads separate — even though the card was placed in-tree
    expect(out.content).toHaveLength(1)
    expect(out.content![0]!.metadata).toEqual({ locale: 'en' })
    expect(out.content![0]!.userData).toEqual({ session: 's1' })
    const contentTypes = out.content![0]!.content.map((c) => c.type)
    expect(contentTypes).toEqual(['hero', 'card']) // template.children + payload items
    const cardLegacy = out.content![0]!.content.find((c) => c.type === 'card')!
    expect(cardLegacy.placement).toEqual({ placementName: 'slot-alpha' })
    expect(cardLegacy.children?.map((c) => c.type)).toEqual(['title'])
  })

  it('keeps user-created state updates (text edits) from the LIVE node state', () => {
    const t = translateLegacy(legacyDoc())
    const editor = t.root.children[0]! // header
    const events = new EventBridge()
    const supervisor = new Supervisor({ hub: hub(), events })
    for (const n of t.nodes) supervisor.registerNode(n)
    const clientAPI = createClient(supervisor)

    clientAPI.apply(editor.id, [{ targetProp: 'content', mode: 'replace', value: 'Edited heading' }])

    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.children?.[0]?.content).toBe('Edited heading')
  })

  it('template.children content nodes reverse to ContentPayload, never template children', () => {
    const t = translateLegacy(legacyDoc())
    const hero = t.content.find((c) => c.type === 'hero')!
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.children?.map((c) => c.type)).not.toContain('hero')
    expect(out.content![0]!.content.map((c) => c.type)).toContain('hero')
    void hero
  })

  it('handlers are carried back on the nodes that own them', () => {
    const t = translateLegacy(legacyDoc())
    const out = reverseTranslate(t.root, { content: t.content })
    const header = out.template.root.children![0]!
    expect(header.handlers?.[0]?.name).toBe('click')
    expect(header.handlers?.[0]?.event).toBe('click')
  })
})
