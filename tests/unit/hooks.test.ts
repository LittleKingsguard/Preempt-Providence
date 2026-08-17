/**
 * HOOKS — the value-provider slot (docs/specs/hooks-map-review.md §7 contract
 * amendment B; docs/decisions.md HOOKS row). The §7.2 pin-6 TDD list:
 * (a) the read sites — self-seed / arm resolution / path-state / seam read;
 * (b) the consumer cascade after a hook write; (c) the round-trip triple;
 * (d) the seam-name guard; (e) the clone-shadowing pin; (f) the mode
 * restriction + the layer-stack-stays-O(1) property.
 *
 * RED-STATE TDD: written BEFORE any engine change — the `hooks` field, the
 * `providerValueFor` helper, the `hooks.<name>` targetProp branch, and the
 * four K4 codes (hooks-shape-invalid / hook-name-unresolved / hook-seam-exempt
 * / hook-mode-blocked) do not exist yet.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { translateLegacy, reverseTranslate } from '../../src/core/translate.js'
import { serializeNode, serializeSlice, loadState } from '../../src/core/serialize.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { makePrototype, makeRoot, hub, addComponentSource, childOf } from '../helpers/fixtures.js'
import type { EmitNodeSource } from '../../src/core/render-helpers.js'
import type { NodeBaseData } from '../../src/core/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function supervisorOf(events: EventBridge, root: Node, nodes: Node[]): Supervisor {
  const sup = new Supervisor({ ...(root.hubFor ? { hub: root.hubFor } : {}), events })
  for (const n of nodes) sup.registerNode(n)
  return sup
}

/** Provider root (source anchor `theme` = 'dark', authored hooks field) with
 *  ONE plain consumer child (target anchor `theme`). */
function providerConsumerEnvelope(hooks?: string[] | unknown) {
  return {
    template: {
      root: {
        type: 'div',
        children: [
          { type: 'section', props: { id: 'consumer' }, component: [{ reference: 'theme' }] },
        ],
        component: [{ reference: 'theme', value: 'dark' }],
        ...(hooks !== undefined ? { hooks } : {}),
      },
    },
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

/** Provide-and-self-apply provider root: a DUPLEX anchor
 *  (`{reference, value, target: 'props.<key>'}` — K1/K2) so the node is BOTH
 *  the provider AND a state-carrying node (a pure provider is F3-dropped
 *  from render when its name is consumed elsewhere — the self-seed read is
 *  observed through the duplex, whose name nobody else consumes). */
function duplexProviderEnvelope(hooks?: string[] | unknown) {
  return {
    template: {
      root: {
        type: 'div',
        props: { id: 'self' },
        component: [{ reference: 'theme', value: 'dark', target: 'props.tone' }],
        ...(hooks !== undefined ? { hooks } : {}),
      },
    },
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

function consumerState(compiled: { actionable: Array<{ nodeId: string; bindings: Record<string, unknown> }> }, nodeId: string) {
  return compiled.actionable.find((s) => s.nodeId === nodeId)
}

describe('the hooks field — translate + reverse round-trip (the derived/handlers precedent)', () => {
  it('carries the field onto the provider node base with zero warnings', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const root = t.root
    expect(root.base.hooks).toEqual(['theme'])
    expect(t.warnings).toEqual([])
  })

  it('hooks-shape-invalid — a non-array field warns + is skipped', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope('theme') as never)
    expect(t.root.base.hooks).toBeUndefined()
    expect(t.warnings.some((w) => w.code === 'hooks-shape-invalid')).toBe(true)
    spy.mockRestore()
  })

  it('hooks-shape-invalid — a non-string member warns + skips that entry only', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const t = translateLegacy(providerConsumerEnvelope(['theme', 42, '']) as never)
    expect(t.root.base.hooks).toEqual(['theme'])
    expect(t.warnings.filter((w) => w.code === 'hooks-shape-invalid').length).toBe(2)
    spy.mockRestore()
  })

  it('reverse emits the field back; re-translate round-trips with zero warnings', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const reversed = reverseTranslate(t.root, { content: t.content })
    const rootData = reversed.template.root as { hooks?: unknown }
    expect(rootData.hooks).toEqual(['theme'])
    const re = translateLegacy(reversed as never)
    expect(re.root.base.hooks).toEqual(['theme'])
    expect(re.warnings).toEqual([])
  })
})

describe('pin-6 (a) — the read sites see the hook value', () => {
  it('self-seed bindings read the hook layer first', async () => {
    const t = translateLegacy(duplexProviderEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)

    const boot = t.root.compile(t.nodes)
    // the duplex provider's OWN state seeds its self-provider value
    const ownState = consumerState(boot, t.root.id)!
    expect(ownState.bindings.theme).toBe('dark')

    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(res.status).toBe('applied')
    await flushSweep()

    const after = t.root.compile(t.nodes)
    const afterOwn = consumerState(after, t.root.id)!
    expect(afterOwn.bindings.theme).toBe('light')
  })

  it('the consumer arm bindings (continueArm) read the hook layer first', async () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    const consumer = t.nodes.find((n) => n.base.props?.id === 'consumer')!

    const boot = t.root.compile(t.nodes)
    const bootState = consumerState(boot, consumer.id)!
    expect(bootState.bindings.theme).toBe('dark')

    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(res.status).toBe('applied')
    await flushSweep()

    const after = t.root.compile(t.nodes)
    const afterState = consumerState(after, consumer.id)!
    expect(afterState.bindings.theme).toBe('light')
  })

  it('path-state bindings (resolvePathTargets) read the hook layer first', async () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'div',
          children: [
            { type: 'section', props: { id: 'zone' }, placement: { placementName: 'zone-a' } },
            {
              type: 'section',
              props: { id: 'consumer' },
              placement: { targetPlacement: ['zone-a'] },
              component: [{ reference: 'theme' }],
            },
          ],
          component: [{ reference: 'theme', value: 'dark' }],
          hooks: ['theme'],
        },
      },
      clientConfig: { runInstantiation: true, runRendering: true },
    } as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    const consumer = t.nodes.find((n) => n.base.props?.id === 'consumer')!

    const boot = consumer.compilePath()
    const bootState = boot.actionable.find((s) => s.nodeId === consumer.id)!
    expect(bootState.bindings.theme).toBe('dark')

    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'midnight' }],
    })
    expect(res.status).toBe('applied')
    await flushSweep()

    const after = consumer.compilePath()
    const afterState = after.actionable.find((s) => s.nodeId === consumer.id)!
    expect(afterState.bindings.theme).toBe('midnight')
  })

  it('the seam read delivers the authored def value — a def-named hook is exempt, never tears the seam', async () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'div',
          children: [
            { type: 'section', props: { id: 'seam-consumer' }, component: [{ reference: 'cardDef', target: 'type' }] },
          ],
          component: [{ reference: 'cardDef', value: { type: 'div', css: { classes: ['card'] }, content: 'Card body' } }],
          hooks: ['cardDef'],
        },
      },
      clientConfig: { runInstantiation: true, runRendering: true },
    } as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)

    // the seam/def-name guard: warn + the mutation is an inert NO-OP (the
    // op itself still applies — the seam case is never a rejection)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.cardDef', mode: 'replace', value: 'teardown' }],
    })
    expect(res.status).toBe('applied')
    expect(spy.mock.calls.some((c) => String(c[0]).includes('hook-seam-exempt'))).toBe(true)
    spy.mockRestore()

    // the def value is untouched — the seam read still delivers the def
    const defAnchor = t.root.anchors.find((a) => a.target === 'cardDef')!
    expect(defAnchor.value).toEqual({ type: 'div', css: { classes: ['card'] }, content: 'Card body' })
    expect(t.root.layers.some((l) => l.id === 'hook-cardDef')).toBe(false)
    // SED-1: the type-target seam COLLAPSE is emit-time — the consumer's
    // element IS the def's element (def type + css), sourced through the
    // seam read (providerValueFromLink)
    const compiled = t.root.compile(t.nodes)
    const consumer = t.nodes.find((n) => n.base.props?.id === 'seam-consumer')!
    const byNode = new Map(t.nodes.map((n) => [n.id, n as unknown as EmitNodeSource]))
    const els = emitElements(compiled.actionable, byNode)
    const consumerEl = els.find((e) => e.wire === consumer.id)
    expect(consumerEl).toBeDefined()
    expect(consumerEl!.type).toBe('div')
    expect(consumerEl!.props['css:classes']).toContain('card')
  })
})

describe('pin-6 (b) — the consumer cascade after a hook write', () => {
  it('the state-slice walk dirties the consumers + refreshes their resolved states + fires state events', async () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    const consumer = t.nodes.find((n) => n.base.props?.id === 'consumer')!

    const stateEvents: Array<{ nodeId: string }> = []
    events.subscribe('state', (e) => {
      for (const ev of e.events) stateEvents.push({ nodeId: (ev as { nodeId: string }).nodeId })
    })

    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(res.status).toBe('applied')
    const dirtied = res.dirtied!
    expect(dirtied).toContain(consumer.id)
    await flushSweep()

    const pass2 = sup.takePass2States()
    const consumerStates = pass2.get(consumer.id)
    expect(consumerStates).toBeDefined()
    for (const cs of consumerStates!) {
      expect(cs.bindings.theme).toBe('light')
    }
    expect(stateEvents.some((e) => e.nodeId === consumer.id)).toBe(true)
  })
})

describe('pin-6 (c) — the ONE-source round-trip triple', () => {
  it('serialize → loadState reproduces the ONE value + the field', async () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })

    const doc = serializeSlice(t.root, t.nodes)
    const seeded = loadState(JSON.parse(JSON.stringify(doc)))
    const reloaded = seeded.map((d) => new Node(d, hub()))
    const provider = reloaded.find((n) => n.id === t.root.id)!
    expect(provider.base.hooks).toEqual(['theme'])
    const anchor = provider.anchors.find((a) => a.target === 'theme')!
    expect(anchor.value).toBe('light')
  })

  it('reverse → re-translate ships the ONE value (the binding) + the field, zero warnings', async () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })

    const reversed = reverseTranslate(t.root, { content: t.content })
    const rootData = reversed.template.root as { hooks?: unknown }
    const templateComponent = reversed.template.component as
      | { reference?: string; value?: unknown }
      | Array<{ reference?: string; value?: unknown }>
    const bindings = Array.isArray(templateComponent) ? templateComponent : [templateComponent]
    const theme = bindings.find((b) => b.reference === 'theme') as { value?: unknown }
    expect(theme.value).toBe('light')
    expect(rootData.hooks).toEqual(['theme'])

    const re = translateLegacy(reversed as never)
    expect(re.root.base.hooks).toEqual(['theme'])
    expect(re.warnings).toEqual([])
    const reAnchor = re.root.anchors.find((a) => a.target === 'theme')!
    expect(reAnchor.value).toBe('light')
  })

  it('the SSR render (emitElements) carries the hook value', async () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'div',
          children: [
            {
              type: 'p',
              props: { id: 'consumer' },
              component: [{ reference: 'theme' }],
              derived: { props: { status: { $: 'bindings.theme' } } },
            },
          ],
          component: [{ reference: 'theme', value: 'dark' }],
          hooks: ['theme'],
        },
      },
      clientConfig: { runInstantiation: true, runRendering: true },
    } as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    await flushSweep()

    const compiled = t.root.compile(t.nodes)
    const byNode = new Map(t.nodes.map((n) => [n.id, n as unknown as EmitNodeSource]))
    const els = emitElements(compiled.actionable, byNode)
    const consumerEl = els.find((e) => (e.props as Record<string, unknown>)['prop:status'] === 'light')
    expect(consumerEl).toBeDefined()
  })
})

describe('pin-6 (d) — the seam/def-name guard', () => {
  it('applySlice never throws on a def-named hook write — warn + skip', async () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'div',
          component: [{ reference: 'cardDef', value: { type: 'div', content: 'Card' } }],
          hooks: ['cardDef'],
        },
      },
      clientConfig: { runInstantiation: true, runRendering: true },
    } as never)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => {
      t.root.applySlice([{ targetProp: 'hooks.cardDef', mode: 'replace', value: 'x' }])
    }).not.toThrow()
    expect(spy.mock.calls.some((c) => String(c[0]).includes('hook-seam-exempt'))).toBe(true)
    spy.mockRestore()
    const anchor = t.root.anchors.find((a) => a.target === 'cardDef')!
    expect(anchor.value).toEqual({ type: 'div', content: 'Card' })
  })
})

describe('pin-6 (e) — clone-shadowing', () => {
  it('a hook-bearing prototype\'s clone carries the field + its own local hook layer', async () => {
    const proto = makeRoot({ type: 'div', hooks: ['theme'] } as NodeBaseData)
    addComponentSource(proto, 'theme', 'dark')
    const events = new EventBridge()
    const sup = new Supervisor({ hub: hub(), events })
    sup.registerNode(proto)
    sup.apply({
      kind: 'state-slice',
      node: proto,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(proto.layers.some((l) => l.id === 'hook-theme' && l.value === 'light')).toBe(true)

    const copy = proto.clone('test')
    expect(copy.base.hooks).toEqual(['theme'])
    const copyLayer = copy.layers.find((l) => l.id === 'hook-theme')
    expect(copyLayer).toBeDefined()
    expect(copyLayer!.value).toBe('light')
    const copyAnchor = copy.anchors.find((a) => a.target === 'theme')!
    expect(copyAnchor.value).toBe('light')

    // independent: a further write on the clone never touches the prototype
    // (the copy is runtime-minted/unplaced — the state gate rejects managed
    // writes, so the direct applySlice path exercises the write containment)
    copy.applySlice([{ targetProp: 'hooks.theme', mode: 'replace', value: 'dark' }])
    expect(copy.layers.filter((l) => l.id === 'hook-theme').length).toBe(1)
    expect(copy.layers.find((l) => l.id === 'hook-theme')!.value).toBe('dark')
    expect(proto.layers.find((l) => l.id === 'hook-theme')!.value).toBe('light')
  })
})

describe('pin-6 (f) — mode restriction + the layer-stack-stays-O(1) property', () => {
  it('N hook writes land ONE deterministic hook-<name> layer (replace-in-place)', async () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    for (let i = 0; i < 25; i += 1) {
      const res = sup.apply({
        kind: 'state-slice',
        node: t.root,
        mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: `v${i}` }],
      })
      expect(res.status).toBe('applied')
    }
    const hookLayers = t.root.layers.filter((l) => l.id === 'hook-theme')
    expect(hookLayers.length).toBe(1)
    expect(hookLayers[0]!.value).toBe('v24')
    // the stack does not grow: the count of non-hook layers is unchanged too
    const before = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    expect(t.root.layers.length).toBe(before.root.layers.length + 1)
  })

  it('a same-value write is a short-circuit — no layer churn, no compile churn', async () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    const layersAfterFirst = t.root.layers.length
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    expect(t.root.layers.length).toBe(layersAfterFirst)
  })

  it('append/replaceAll modes are rejected with hook-mode-blocked', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'append', value: 'x' }],
    })
    expect(res.status).toBe('rejected')
    expect((res.error as { code?: string }).code).toBe('hook-mode-blocked')
    spy.mockRestore()
  })

  it('a name with no source/duplex anchor is rejected with hook-name-unresolved', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    const res = sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.nosuch', mode: 'replace', value: 'x' }],
    })
    expect(res.status).toBe('rejected')
    expect((res.error as { code?: string }).code).toBe('hook-name-unresolved')
  })

  it('the direct applySlice path contains an unresolved write: warn + skip, never throw', () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(() => {
      t.root.applySlice([{ targetProp: 'hooks.nosuch', mode: 'replace', value: 'x' }])
    }).not.toThrow()
    expect(spy.mock.calls.some((c) => String(c[0]).includes('hook-name-unresolved'))).toBe(true)
    spy.mockRestore()
    expect(t.root.layers.some((l) => l.id === 'hook-nosuch')).toBe(false)
  })

  it('clearing the hook (value undefined) removes the layer and restores the authored value', async () => {
    const t = translateLegacy(providerConsumerEnvelope(['theme']) as never)
    const events = new EventBridge()
    const sup = supervisorOf(events, t.root, t.nodes)
    const consumer = t.nodes.find((n) => n.base.props?.id === 'consumer')!
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: undefined as never }],
    })
    await flushSweep()
    expect(t.root.layers.some((l) => l.id === 'hook-theme')).toBe(false)
    const anchor = t.root.anchors.find((a) => a.target === 'theme')!
    expect(anchor.value).toBe('dark')
    const compiled = t.root.compile(t.nodes)
    expect(consumerState(compiled, consumer.id)!.bindings.theme).toBe('dark')
  })
})
