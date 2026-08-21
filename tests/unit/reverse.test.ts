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
import { dispatchEvent } from '../../src/core/handlers.js'
import type { Node, Node as NodeType } from '../../src/core/node.js'

function compAnchors(node: NodeType): Array<{ role: string; target: unknown; value?: unknown; applyPath?: string }> {
  return node.anchors
    .filter((a) => (a.role === 'target' || a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string')
    .map((a) => ({
      role: a.role,
      target: a.target,
      ...(a.value !== undefined ? { value: a.value } : {}),
      ...(typeof a.options.applyPath === 'string' ? { applyPath: a.options.applyPath } : {}),
    }))
}

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

describe('K5/N1 — reverse emission (applyPath → legacy target; synthesized derived stripped)', () => {
  it('K5 — consumer with applyPath reverses as { reference, target } and round-trips exactly', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          children: [{ type: 'pane', component: { reference: 'p10', target: 'props.name' } }],
        },
      },
      content: [],
    }
    const t = translateLegacy(doc)
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.children![0]!.component).toEqual({ reference: 'p10', target: 'props.name' })
    // re-translate reproduces the identical binding + apply path + synthesis
    const again = translateLegacy(out)
    expect(compAnchors(again.root.children[0]!)).toEqual([{ role: 'target', target: 'p10', applyPath: 'props.name' }])
    expect(again.root.children[0]!.derived?.props?.name).toEqual({ $: 'bindings.p10' })
    expect(again.warnings).toEqual([])
  })

  it('K5 — provider with applyPath reverses as { reference, value, target } and round-trips exactly', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          children: [{ type: 'pane', component: { reference: 'p10', value: 'v10', target: 'props.mood' } }],
        },
      },
      content: [],
    }
    const t = translateLegacy(doc)
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.children![0]!.component).toEqual({ reference: 'p10', value: 'v10', target: 'props.mood' })
    const again = translateLegacy(out)
    expect(compAnchors(again.root.children[0]!)).toEqual([{ role: 'duplex', target: 'p10', value: 'v10', applyPath: 'props.mood' }])
    expect(again.warnings).toEqual([])
  })

  it('K5 — anchors WITHOUT applyPath keep the current emission (consumer { reference }; provider { reference, value })', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: { reference: 'shell' },
          children: [{ type: 'pane', component: { reference: 'panel', value: { variant: 'a' } } }],
        },
      },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual({ reference: 'shell' })
    expect(out.template.root.children![0]!.component).toEqual({ reference: 'panel', value: { variant: 'a' } })
  })

  it('K5 — runtime duplex (source + name-target, no applyPath) emits { reference, value }; the name-target is DROPPED (legacy-unexpressible)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', component: { reference: 'sess', value: 'v' } } },
      content: [],
    })
    // the harness-style runtime consumer half on the same per-name link
    t.root.addAnchor('target', 'sess', {}, t.root.anchors.find((a) => a.role === 'source')!.link)
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual({ reference: 'sess', value: 'v' })
    // the dropped name-target cannot be re-expressed — re-translate yields the provider only
    const again = translateLegacy(out)
    expect(again.root.anchors.some((a) => a.role === 'source' && a.target === 'sess')).toBe(true)
    expect(again.root.anchors.some((a) => a.role === 'target' && a.target === 'sess')).toBe(false)
    expect(again.warnings).toEqual([])
  })

  it('K7 — multi-binding nodes reverse as arrays; an applyPath consumer next to a provider is NEVER dropped', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          component: [
            { reference: 'a', value: 1, target: 'props.x' },
            { reference: 'b', target: 'props.y' },
          ],
        },
      },
      content: [],
    }
    const t = translateLegacy(doc)
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual([
      { reference: 'a', value: 1, target: 'props.x' },
      { reference: 'b', target: 'props.y' },
    ])
    const again = translateLegacy(out)
    expect(compAnchors(again.root)).toEqual([
      { role: 'duplex', target: 'a', value: 1, applyPath: 'props.x' },
      { role: 'target', target: 'b', applyPath: 'props.y' },
    ])
    expect(again.warnings).toEqual([])
  })

  it('K5 — same-reference runtime forks are legacy-unexpressible: the guard keeps the first provider (no duplicate-reference on re-translate)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', component: { reference: 'a', value: 1 } } },
      content: [],
    })
    const link = t.root.anchors.find((a) => a.role === 'source')!.link
    // P3 §10.ab/ae — the component-source-duplicate guard rejects the second
    // same-name source anchor outright (warn + keep-first): the fork claim is
    // anti-patterned, so reverse emission sees exactly one provider
    const dup = t.root.addAnchor('source', 'a', {}, link)
    expect(dup).toBeNull()
    expect(t.root.anchors.filter((a) => a.role === 'source')).toHaveLength(1)
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual({ reference: 'a', value: 1 })
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
  })

  it('N1 — reverse strips the synthesized derived keys; authored derived stays; re-translate has no self-collision', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: { reference: 'a', value: 1, target: 'props.x' },
          derived: { props: { authored: 'AUTH' } },
        },
      },
      content: [],
    })
    // the live node carries BOTH the authored key and the synthesized bindings key
    expect(t.root.derived?.props?.x).toEqual({ $: 'bindings.a' })
    expect(t.root.derived?.props?.authored).toBe('AUTH')
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual({ reference: 'a', value: 1, target: 'props.x' })
    expect(out.template.root.derived).toEqual({ props: { authored: 'AUTH' } })
    // re-translate: the target field re-synthesizes the key cleanly — no
    // authored-derived collision, no component-target-skipped warning
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
    expect(compAnchors(again.root)).toEqual([{ role: 'duplex', target: 'a', value: 1, applyPath: 'props.x' }])
    expect(again.root.derived?.props?.x).toEqual({ $: 'bindings.a' })
    expect(again.root.derived?.props?.authored).toBe('AUTH')
  })

  it('N1/css.classes — reverse strips the synthesized css.classes, emits target: css.classes, re-translate round-trips clean', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: { reference: 'a', value: ['x'], target: 'css.classes' },
        },
      },
      content: [],
    })
    expect(t.root.derived?.css?.classes).toEqual({ $: 'bindings.a' })
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual({ reference: 'a', value: ['x'], target: 'css.classes' })
    // the synthesized key does NOT leak onto the emitted derived
    expect(out.template.root.derived).toEqual({})
    // re-translate re-synthesizes the seam cleanly — no warning, no collision
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
    expect(compAnchors(again.root)).toEqual([{ role: 'duplex', target: 'a', value: ['x'], applyPath: 'css.classes' }])
    expect(again.root.derived?.css?.classes).toEqual({ $: 'bindings.a' })
  })

  it('N1/css.classes — reverse strips ONLY the synthesized key alongside an authored props key', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: { reference: 'a', value: ['x'], target: 'css.classes' },
          derived: { props: { authored: 'AUTH' } },
        },
      },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual({ reference: 'a', value: ['x'], target: 'css.classes' })
    expect(out.template.root.derived).toEqual({ props: { authored: 'AUTH' } })
  })

  it('K6/K5 — template.component (root) applyPath round-trips as { reference, value, target }', () => {
    const doc: LegacyInitialData = {
      template: { root: { type: 'app' }, component: { reference: 'rootp', value: 'rv', target: 'props.rt' } },
      content: [],
    }
    const t = translateLegacy(doc)
    expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'rootp', value: 'rv', applyPath: 'props.rt' }])
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.component).toEqual({ reference: 'rootp', value: 'rv', target: 'props.rt' })
    const again = translateLegacy(out)
    expect(compAnchors(again.root)).toEqual([{ role: 'duplex', target: 'rootp', value: 'rv', applyPath: 'props.rt' }])
    expect(again.warnings).toEqual([])
  })
})

describe('P3 — reverse emission of placement anchors (content + activePlacement; contentNodes stripped)', () => {
  it('content anchors reverse as targetPlacement: string[] in mint order; re-translate is stable', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', placement: { targetPlacement: ['zone-b', 'zone-a'] } } },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.placement).toEqual({ targetPlacement: ['zone-b', 'zone-a'] })
    const again = translateLegacy(out)
    expect(again.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['zone-b', 'zone-a'])
    expect(again.warnings).toEqual([])
  })

  it('derived activePlacement: string emits on reverse (first name with containers), never authored', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', placement: { placementName: 'zone-b', targetPlacement: ['zone-b', 'zone-a'] } },
      },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.placement).toEqual({
      placementName: 'zone-b',
      targetPlacement: ['zone-b', 'zone-a'],
      activePlacement: 'zone-b',
    })
    // activePlacement is never minted back into an anchor (derived read only)
    const again = translateLegacy(out)
    expect(again.root.anchors.some((a) => a.role === 'content' && a.target === 'zone-b')).toBe(true)
    expect(again.root.anchors.filter((a) => a.role === 'container').map((a) => a.target)).toEqual(['zone-b'])
    expect(again.warnings).toEqual([])
  })

  it('DEFECT #28 — the auto-mint props.id does NOT leak into reversed legacy (json-out = json-in)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', children: [{ type: 'header', content: 'Head' }] } },
      content: [],
    })
    // the engine minted a props.id fill on every node without an authored one
    expect(t.root.props.id).toBe(`preempt-node-${t.root.id}`)
    expect(t.root.children[0]!.props.id).toBe(`preempt-node-${t.root.children[0]!.id}`)
    const out = reverseTranslate(t.root, { content: t.content })
    expect(JSON.stringify(out)).not.toContain('preempt-node-')
    expect(out.template.root.props).toBeUndefined()
    expect(out.template.root.children?.[0]?.props).toBeUndefined()
    // round-trip: re-translate re-mints the fill cleanly — no warning, the
    // fill matches the NEW node's own id (node ids are a global seq, so the
    // minted value differs per translate pass — only the pattern is stable)
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
    expect(again.root.props.id).toBe(`preempt-node-${again.root.id}`)
    expect(again.root.children[0]!.props.id).toBe(`preempt-node-${again.root.children[0]!.id}`)
  })

  it('DEFECT #28 — an AUTHORED props.id survives reverse (authored data is never stripped)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', props: { id: 'authored-1' } } },
      content: [],
    })
    expect(t.root.props.id).toBe('authored-1')
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.props).toEqual({ id: 'authored-1' })
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
    expect(again.root.props.id).toBe('authored-1')
  })

  it('DEFECT #28 — an authored props.id EQUAL to the engine mint pattern is kept (base-authored wins)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', props: { id: `preempt-node-node-1` } } },
      content: [],
    })
    expect(t.root.props.id).toBe(`preempt-node-node-1`)
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template.root.props).toEqual({ id: `preempt-node-node-1` })
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
    expect(again.root.props.id).toBe(`preempt-node-node-1`)
  })

  it('reverse emission strips the minted contentNodes anchor (no artifact; re-translate re-mints cleanly)', () => {
    const t = translateLegacy(legacyDoc())
    const out = reverseTranslate(t.root, { content: t.content, metadata: t.metadata, userData: t.userData })
    expect(JSON.stringify(out)).not.toContain('contentNodes')
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
    for (const c of again.content) {
      expect(c.state).toBe('in-tree')
      expect(c.childAnchor()!.link.anchorsOf('parent')[0]!.target).toBe('contentNodes')
    }
    // the authored placement round-trips untouched
    const card = again.content.find((c) => c.type === 'card')!
    expect(card.anchors.find((a) => a.role === 'container' && a.target === 'slot-alpha')).toBeDefined()
    expect(card.children.map((c) => c.type)).toEqual(['title'])
  })
})

describe('REVERSE-OF-CLEAR — a handlers CLEAR layer is json-out durable (the clear suppresses the base in reverse)', () => {
  function clearedButton(additions?: Array<{ name: string; event: string; body: () => string }>) {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [
            {
              type: 'button',
              content: 'go',
              handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "first" }' }],
            },
          ],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!
    t.root.compile(t.nodes)
    const clear = sup.apply({ kind: 'state-slice', node: btn, mutation: [{ targetProp: 'handlers', mode: 'replace', value: [] }] })
    expect(clear.status).toBe('applied')
    if (additions) {
      const write = sup.apply({ kind: 'state-slice', node: btn, mutation: [{ targetProp: 'handlers', mode: 'replace', value: additions }] })
      expect(write.status).toBe('applied')
    }
    return { sup, btn, root: t.root }
  }

  it('a cleared node reverses WITHOUT the base handler (handlers: [] emitted — the clear is representable)', () => {
    const { root } = clearedButton()
    const out = reverseTranslate(root)
    const btn = out.template.root.children![0]!
    expect(btn.handlers).toEqual([])
  })

  it('a clear + additions write reverses as the additions ONLY (base suppressed)', () => {
    const { root } = clearedButton([{ name: 'click', event: 'click', body: () => 'injected' }])
    const out = reverseTranslate(root)
    const btn = out.template.root.children![0]!
    expect(btn.handlers?.map((h) => h.name)).toEqual(['click'])
    expect(btn.handlers![0]!.body).toContain('injected')
  })

  it('re-translate of the reversed clear round-trips the LIVE state (no handler fires after the round-trip)', () => {
    const { root } = clearedButton()
    const out = reverseTranslate(root)
    const again = translateLegacy(out)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of again.nodes) sup.registerNode(n)
    again.root.compile(again.nodes)
    const btn = again.root.children[0]!
    const results = dispatchEvent(btn, sup.handlerContext, 'click')
    expect(results).toEqual([])
  })

  it('an UNCLEARED node still reverses base + additions (no regression — the D16/R-3 letter is untouched)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [{ type: 'button', handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "base" }' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!
    t.root.compile(t.nodes)
    sup.apply({
      kind: 'state-slice',
      node: btn,
      mutation: [{ targetProp: 'handlers', mode: 'replace', value: [{ name: 'click', event: 'click', body: () => 'added' }] }],
    })
    const out = reverseTranslate(t.root)
    const revBtn = out.template.root.children![0]!
    expect(revBtn.handlers?.map((h) => h.name)).toEqual(['click', 'click'])
  })
})
