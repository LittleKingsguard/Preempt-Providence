/**
 * Step 7 e2e — legacy /Preempt backend data → complete in-browser render.
 *
 * Mirrors the documented goals end-to-end on the public surface:
 *   original-format JSON → translateLegacy → compile → diffMinimal → adapter
 *   ops (in-tree parts render; unplaced content nodes stay out), then a
 *   handler dispatch pushes a managed update that re-renders via a diff.
 */
import { describe, it, expect } from 'vitest'
import { Node, reconcileParentTargets, Supervisor } from '../../src/core/node.js'
import { diffMinimal, MockAdapter, type RenderOp, type MinimalElement, type RenderAdapter } from '../../src/core/render.js'
import { serializeSlice, loadState } from '../../src/core/serialize.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'
import { dispatchEvent } from '../../src/core/handlers.js'
import { hub } from '../helpers/fixtures.js'
import type { HandlerContext } from '../../src/core/handlers.js'
import type { NodeId } from '../../src/core/types.js'

interface PEl {
  wire: string
  type: string
}

function minimalFromState(cs: { nodeId: string; type: string; props?: Record<string, unknown>; css?: Record<string, unknown>; content?: unknown; children: string[] }): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) props[`css:${k}`] = v
  if (cs.content !== undefined) props['text'] = cs.content
  return { wire: cs.nodeId, type: cs.type, props, childOrder: [...cs.children] }
}

function applyOps(adapter: RenderAdapter<PEl>, ops: RenderOp[]): void {
  const els = new Map<string, PEl>()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        els.set(op.wire, adapter.createEl(op.type, op.wire))
        break
      case 'set':
        adapter.setProp(op.wire, op.name, op.value)
        break
      case 'append': {
        const owner = els.get(op.owner)
        const child = els.get(op.child)
        if (owner && child) adapter.appendChild(owner, child)
        break
      }
      case 'remove': {
        const w = els.get(op.wire)
        if (w && adapter.removeEl) adapter.removeEl(op.wire)
        els.delete(op.wire)
        break
      }
      case 'styles':
        break
    }
  }
}

function wireNames(ops: RenderOp[]): string[] {
  return ops.filter((o) => o.kind === 'create').map((o) => o.wire)
}

function richLegacy(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'app',
        component: { reference: 'shell' },
        children: [
          { type: 'header', content: 'Legacy header' },
          {
            type: 'pane',
            component: { reference: 'panel', value: { variant: 'a' } },
            children: [{ type: 'badge', content: 'nested badge' }],
          },
        ],
      },
      children: [{ type: 'hero', content: 'unplaced hero' }],
    },
    content: [
      {
        metadata: { locale: 'en' },
        userData: { session: 's1' },
        content: [
          {
            type: 'card',
            placement: { placementName: 'slot-alpha' },
            children: [{ type: 'title', content: 'Card title' }],
          },
        ],
      },
    ],
    clientConfig: { runInstantiation: true, runMonitoring: true },
  }
}

describe('e2e — legacy data → complete render (Step 7)', () => {
  it('renders the in-tree template subtree; unplaced content nodes produce no ops', () => {
    const t = translateLegacy(richLegacy())
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const names = wireNames(ops)

    // root + its own default children (incl. nested badge) render
    expect(names).toContain(t.root.id)
    expect(names).toContain(t.root.children[0]!.id) // header
    expect(names).toContain(t.root.children[1]!.id) // pane
    expect(names).toContain(t.root.children[1]!.children[0]!.id) // badge
    // unplaced content nodes (hero, card) never reach the renderer (S1.1)
    for (const c of t.content) expect(names).not.toContain(c.id)

    // component binding on the root resolves as a fork candidate state
    expect(cr.actionable.find((s) => s.nodeId === t.root.id)?.state).toBe('in-tree')
    expect(cr.warnings.filter((w) => w.code === 'circular-source')).toHaveLength(0)
  })

  it('attaching an unplaced content node into its placement zone makes it render', () => {
    const t = translateLegacy(richLegacy())
    const card = t.content[1]!
    expect(card.state).toBe('unplaced')
    expect(card.anchors.some((a) => a.role === 'placement' && a.target === 'slot-alpha')).toBe(true)

    // place the card under the root (the zone) — attach via the shared family link
    const family = t.root.anchors.find((a) => a.role === 'parent')!.link as never
    card.addAnchor('child', card, { priority: 5 }, family)

    expect(card.state).toBe('in-tree')
    const cr = t.root.compile(t.nodes)
    expect(cr.actionable.map((s) => s.nodeId)).toContain(card.id)
  })

  it('handler dispatch through the supervisor drives a managed update that re-renders via diff', () => {
    const events = new EventBridge()
    const supervisor = new Supervisor({ hub: hub(), events })
    const t = translateLegacy(richLegacy())
    for (const n of t.nodes) supervisor.registerNode(n)
    const clientAPI = createClient(supervisor)

    // a translated header handler: update its own content via the managed channel
    const header = t.root.children[0]!
    header.addLayer({
      id: 'h',
      handlers: [
        {
          name: 'refresh',
          event: 'refresh',
          body: (ctx: unknown) => {
            const c = ctx as HandlerContext
            return c.clientAPI.apply(header.id, [{ targetProp: 'content', mode: 'replace', value: 'Legacy header — updated' }])
          },
        },
      ],
    })

    // initial render
    const cr0 = t.root.compile(t.nodes)
    const ops0 = diffMinimal(null, cr0.actionable.map(minimalFromState))
    const adapter0 = new MockAdapter()
    applyOps(adapter0, ops0)
    expect(adapter0.calls.filter((o) => o.kind === 'set' && o.name === 'text' && o.value === 'Legacy header')).toHaveLength(1)

    // handler fires → journaled update
    const results = dispatchEvent(header, supervisor.handlerContext, 'refresh')
    expect(results).toHaveLength(1)
    expect(header.content).toBe('Legacy header — updated')
    expect(supervisor.journal).toHaveLength(1)
    expect(supervisor.journal[0]!.id).toBeDefined() // identifiable + replayable

    // re-render via diff: only the changed text is re-set (no full rebuild)
    const cr1 = t.root.compile(t.nodes)
    const ops1 = diffMinimal(new Map(cr0.actionable.map(minimalFromState).map((e) => [e.wire, e])), cr1.actionable.map(minimalFromState))
    const sets = ops1.filter((o) => o.kind === 'set')
    expect(sets.filter((o) => o.name === 'text' && o.value === 'Legacy header — updated')).toHaveLength(1)
    expect(ops1.filter((o) => o.kind === 'create')).toHaveLength(0) // no element rebuild
  })

  it('legacy data survives the new-format boundary and re-renders identically (PAR-5)', () => {
    const t = translateLegacy(richLegacy())
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const adapter = new MockAdapter()
    applyOps(adapter, ops)

    // serialize the FULL translated tree, re-hydrate client-side, re-render
    const doc = serializeSlice(t.root, t.nodes, t.clientConfig)
    const seeded = loadState(JSON.parse(JSON.stringify(doc))).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded)
    const cr2 = seeded[0]!.compile(seeded)
    const ops2 = diffMinimal(null, cr2.actionable.map(minimalFromState))
    const adapter2 = new MockAdapter()
    applyOps(adapter2, ops2)

    const sig = (opsArr: RenderOp[]): string =>
      JSON.stringify(
        opsArr.map((o) => (o.kind === 'set' ? [o.kind, o.wire, o.name, o.value] : o.kind === 'create' ? [o.kind, o.wire] : o.kind === 'remove' ? [o.kind, o.wire] : [o.kind])),
      )
    expect(sig(ops2)).toBe(sig(ops))
    void adapter
    void adapter2
  })
})
