/**
 * REQ-GAP-9 (handoffs-review-2.md §3) — the public `createLinkHub()` factory +
 * seed-path hub threading contract (TDD red → green).
 *
 * Contract under test:
 * 1. `createLinkHub(): LinkConfigNameHub` is exported from the src/index.ts
 *    barrel (same function identity as the translate.ts export — one
 *    implementation, no drift), and the `LinkConfigNameHub` TYPE is
 *    barrel-exported (compile-time check below).
 * 2. `linkFor(name, kind)` hands out ONE shared Link per (kind, name) —
 *    same-name anchors land on the same link.
 * 3. The Node constructor's SEED path (serialized-doc round-trip) routes
 *    placement/component role anchors through the node's hub when present
 *    (node.ts:463 region): two seeds with the same anchor name resolve to the
 *    SAME Link. Hub-less seeds keep the status quo — per-node fresh links.
 * 4. Seed-path safety is preserved: the component-source-duplicate guard still
 *    fires (no double anchor on the shared link) and a bad seed anchor never
 *    throws out of the constructor (the `catch {}` containment).
 * 5. translateLegacy(doc) without opts defaults to an internal
 *    createLinkHub() — same-name anchors across nodes share one link.
 */
import { describe, it, expect, vi } from 'vitest'
import { createLinkHub, translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'
import { createLinkHub as createLinkHubBarrel } from '../../src/index.js'
import type { LinkConfigNameHub as LinkConfigNameHubBarrel } from '../../src/index.js'
import { Node } from '../../src/core/node.js'
import type { NodeBaseData } from '../../src/core/types.js'

/** loadState-shaped seed data: id + type + anchors with string targets. */
function seedData(id: string, anchors: Array<{ role: 'source' | 'target' | 'duplex' | 'container' | 'content' | 'component'; target: string; value?: unknown }>): NodeBaseData {
  return { id, type: 'div', anchors } as unknown as NodeBaseData
}

function compSource(node: Node, name: string) {
  return node.anchors.find(a => (a.role === 'source' || a.role === 'duplex') && a.target === name)
}

function placementAnchor(node: Node, name: string) {
  return node.anchors.find(a => (a.role === 'container' || a.role === 'content') && a.target === name)
}

describe('createLinkHub — the public same-name shared-Link factory (REQ-GAP-9)', () => {
  it('returns a LinkConfigNameHub whose linkFor shares ONE Link per (kind, name)', () => {
    const hub = createLinkHub()
    expect(typeof hub.linkFor).toBe('function')
    const a = hub.linkFor('panel', 'component')
    const b = hub.linkFor('panel', 'component')
    const c = hub.linkFor('panel', 'placement')
    const d = hub.linkFor('other', 'component')
    expect(b).toBe(a)
    expect(c).not.toBe(a)
    expect(d).not.toBe(a)
  })

  it('is barrel-exported from src/index.ts with the same function identity (no drift)', () => {
    expect(createLinkHubBarrel).toBe(createLinkHub)
    // compile-time check: the TYPE is barrel-exported too
    const typed: LinkConfigNameHubBarrel = createLinkHub()
    expect(typed.linkFor('x', 'placement')).toBeDefined()
  })
})

describe('seed-path hub threading (REQ-GAP-9) — serialized-doc seeds', () => {
  it('two seeds with the SAME component anchor name + one hub resolve to ONE shared Link', () => {
    const hub = createLinkHub()
    const a = new Node(seedData('seed-a', [{ role: 'source', target: 'panel' }]), hub)
    const b = new Node(seedData('seed-b', [{ role: 'target', target: 'panel' }]), hub)
    const src = compSource(a, 'panel')
    const tgt = b.anchors.find(a2 => a2.role === 'target' && a2.target === 'panel')
    expect(src).toBeDefined()
    expect(tgt).toBeDefined()
    expect(src!.link).toBe(tgt!.link)
    expect(hub.linkFor('panel', 'component')).toBe(src!.link)
  })

  it('two seeds with the SAME placement anchor name + one hub resolve to ONE shared Link', () => {
    const hub = createLinkHub()
    const a = new Node(seedData('seed-a', [{ role: 'container', target: 'slot-alpha' }]), hub)
    const b = new Node(seedData('seed-b', [{ role: 'content', target: 'slot-alpha' }]), hub)
    const ca = placementAnchor(a, 'slot-alpha')
    const cb = placementAnchor(b, 'slot-alpha')
    expect(ca).toBeDefined()
    expect(cb).toBeDefined()
    expect(ca!.link).toBe(cb!.link)
    expect(hub.linkFor('slot-alpha', 'placement')).toBe(ca!.link)
  })

  it('hub-LESS seeds keep per-node FRESH links for same names (status quo)', () => {
    const a = new Node(seedData('seed-a', [{ role: 'source', target: 'panel' }]))
    const b = new Node(seedData('seed-b', [{ role: 'target', target: 'panel' }]))
    const src = compSource(a, 'panel')
    const tgt = b.anchors.find(a2 => a2.role === 'target' && a2.target === 'panel')
    expect(src).toBeDefined()
    expect(tgt).toBeDefined()
    expect(src!.link).not.toBe(tgt!.link)
  })

  it('seed values still land on the shared link (a.value = value preserved)', () => {
    const hub = createLinkHub()
    const a = new Node(seedData('seed-a', [{ role: 'source', target: 'panel', value: { variant: 'a' } }]), hub)
    const b = new Node(seedData('seed-b', [{ role: 'target', target: 'panel' }]), hub)
    expect(compSource(a, 'panel')!.value).toEqual({ variant: 'a' })
    expect(compSource(a, 'panel')!.link).toBe(b.anchors.find(a2 => a2.role === 'target' && a2.target === 'panel')!.link)
  })
})

describe('seed-path safety preserved (REQ-GAP-9)', () => {
  it('a duplicate same-name component-source seed still triggers component-source-duplicate — ONE anchor on the shared link', () => {
    const hub = createLinkHub()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const node = new Node(
      seedData('seed-dup', [
        { role: 'source', target: 'dup' },
        { role: 'source', target: 'dup' },
      ]),
      hub,
    )
    const sources = node.anchors.filter(a => a.role === 'source' && a.target === 'dup')
    expect(sources).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith('component-source-duplicate at', node.id, 'source', 'dup')
    warn.mockRestore()
  })

  it('the constructor does NOT throw on a bad seed anchor (catch containment) — the anchor is dropped', () => {
    const hub = createLinkHub()
    // role 'component' cannot live on the parent-child-shaped link the seed
    // path would build for it → addAnchor throws inside → swallowed
    expect(() => new Node(seedData('seed-bad', [{ role: 'component', target: 'rootNode' }]), hub)).not.toThrow()
    const node = new Node(seedData('seed-bad', [{ role: 'component', target: 'rootNode' }]), hub)
    expect(node.anchors.find(a => a.role === 'component')).toBeUndefined()
  })
})

describe('translateLegacy default hub (REQ-GAP-9 — no-opts still works)', () => {
  it('translates WITHOUT opts, defaulting to an internal createLinkHub — same-name anchors share one link', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          component: { reference: 'shell' },
          children: [{ type: 'pane', component: { reference: 'pane' } }],
        },
      },
      content: [
        { content: [{ type: 'card', component: { reference: 'shell' } }] },
      ],
    }
    const t = translateLegacy(doc)
    const rootTarget = t.root.anchors.find(a => a.role === 'target' && a.target === 'shell')
    const cardTarget = t.content[0]!.anchors.find(a => a.role === 'target' && a.target === 'shell')
    expect(rootTarget).toBeDefined()
    expect(cardTarget).toBeDefined()
    // same reference across two nodes → ONE shared link via the default hub
    expect(rootTarget!.link).toBe(cardTarget!.link)
  })
})