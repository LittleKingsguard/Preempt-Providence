/**
 * translate.ts unit contract — legacy /Preempt NodeSchema → anchor graph.
 *
 * Mapping (per §10.10.1 + user decision): the root node stores its OWN
 * default children (`template.root.children`, attached in-tree). The
 * `template.children` list and content-payload items are the UNPLACED
 * content nodes — translated without a parent anchor, returned in
 * `TranslatedTree.content`, awaiting placement.
 *
 * Component bindings follow the POST-K1–K8 contract
 * (archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md §2.2 + Appendix E;
 * docs/specs/translate.md §2/§2.1): `target` is the LOCAL `props.<key>`
 * apply path (flat only); `component` accepts a single binding OR an array
 * (K7); vacuous bindings warn `component-binding-empty` (K3, never throw);
 * duplicate reference/target warn + block pre-anchor (K8); the warnings
 * channel is additive on `TranslatedTree` (K4); the apply path persists on
 * anchor options `applyPath` (K5 translate half); root `template.component`
 * value-carrying bindings become SOURCE anchors (K6); handler guards
 * `handler-phase-unknown` / `handler-body-invalid` warn + skip (K8, TR-F2).
 */
import { describe, it, expect, vi } from 'vitest'
import { translateLegacy, reverseTranslate, type LegacyInitialData } from '../../src/core/translate.js'
import { dispatchPhase } from '../../src/core/handlers.js'
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

  it('template.children + content payloads become contentNodes-owned content roots (family in-tree, never root children)', () => {
    const t = translateLegacy(legacyDoc())
    // template.children (hero) + payload item (card)
    expect(t.content.map((c: NodeType) => c.type)).toEqual(['hero', 'card'])
    for (const c of t.content) {
      // contentNodes permanent-owner minting (P3 §10.ad/F-13): family-wise
      // the roots are 'in-tree' via the token — never 'unplaced'
      expect(c.parent).toBeNull()
      expect(c.state).toBe('in-tree')
    }
    // root children are ONLY the root's own default children
    expect(t.root.children.map((c: NodeType) => c.type)).toEqual(['header', 'pane'])
    // nested children inside a content node still attach within it
    expect(t.content[1]!.children.map((c: NodeType) => c.type)).toEqual(['title'])
  })

  it('materializes component bindings: plain reference → target; reference+value → SOURCE provider', () => {
    const t = translateLegacy(legacyDoc())
    // plain reference (no value, no target) → target consumer
    const targets = t.root.anchors.filter((a) => a.role === 'target' && typeof a.target === 'string')
    expect(targets.map((a) => a.target)).toContain('shell')

    // value + NO target field → SOURCE anchor: the node PROVIDES `reference` = value
    const pane = t.root.children[1]!
    const paneSource = pane.anchors.find((a) => a.role === 'source' && a.target === 'panel')!
    expect(paneSource).toBeDefined()
    expect(paneSource.value).toEqual({ variant: 'a' })
    expect(pane.anchors.find((a) => a.role === 'target' && a.target === 'panel')).toBeUndefined()
  })

  describe('K4 — warnings channel (additive, never throws)', () => {
    it('warnings is always an array (empty for a clean document)', () => {
      expect(translateLegacy(legacyDoc()).warnings).toEqual([])
      expect(translateLegacy({ template: { root: { type: 'page' } } }).warnings).toEqual([])
    })

    it('each warning carries { code, path } and fires a focused console.warn', () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      try {
        const t = translateLegacy({
          template: { root: { type: 'app', component: {} as never } },
          content: [],
        })
        expect(t.warnings).toEqual([{ code: 'component-binding-empty', path: 'root' }])
        expect(spy).toHaveBeenCalledTimes(1)
        expect(String(spy.mock.calls[0]![0])).toContain('component-binding-empty')
        expect(String(spy.mock.calls[0]![0])).toContain('root')
      } finally {
        spy.mockRestore()
      }
    })

    it('warning paths reflect the tree position (root.children[i], template.children[i], content[p].content[i])', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            children: [
              { type: 'header' },
              { type: 'pane', component: {} as never },
            ],
          },
          children: [{ type: 'hero', component: { reference: '' } }],
        },
        content: [{ content: [{ type: 'card', component: {} as never }] }],
      })
      expect(t.warnings).toEqual([
        { code: 'component-binding-empty', path: 'root.children[1]' },
        { code: 'component-binding-empty', path: 'template.children[0]' },
        { code: 'component-binding-empty', path: 'content[0].content[0]' },
      ])
    })
  })

  describe('K3 — vacuous bindings warn + skip, never throw', () => {
    it('component: {} → component-binding-empty, zero anchors', () => {
      const t = translateLegacy({ template: { root: { type: 'app', component: {} as never } }, content: [] })
      expect(t.warnings).toEqual([{ code: 'component-binding-empty', path: 'root' }])
      expect(compAnchors(t.root)).toEqual([])
    })

    it('non-string reference ({reference: 42}) → component-binding-empty, zero anchors', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 42, value: 'x' } as never } },
        content: [],
      })
      expect(t.warnings).toEqual([{ code: 'component-binding-empty', path: 'root' }])
      expect(compAnchors(t.root)).toEqual([])
    })

    it('empty-string reference ({reference: ""}) → component-binding-empty, zero anchors (no empty-name anchor)', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: '' } } },
        content: [],
      })
      expect(t.warnings).toEqual([{ code: 'component-binding-empty', path: 'root' }])
      expect(compAnchors(t.root)).toEqual([])
    })

    it('component: null is absence — no warning, no anchors', () => {
      const t = translateLegacy({ template: { root: { type: 'app', component: null as never } }, content: [] })
      expect(t.warnings).toEqual([])
      expect(compAnchors(t.root)).toEqual([])
    })

    it('Array.isArray carve-out: component: [] is a VALID empty multi-binding form (no warning)', () => {
      const t = translateLegacy({ template: { root: { type: 'app', component: [] } }, content: [] })
      expect(t.warnings).toEqual([])
      expect(compAnchors(t.root)).toEqual([])
    })

    it('a vacuous element inside an array warns but the rest still anchor', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: [{ reference: 'a', value: 1 }, {} as never] } },
        content: [],
      })
      expect(t.warnings).toEqual([{ code: 'component-binding-empty', path: 'root' }])
      expect(compAnchors(t.root)).toEqual([{ role: 'source', target: 'a', value: 1 }])
    })
  })

  describe('K7 — array form: N bindings per node (single binding OR array)', () => {
    it('single binding still works (backward compatible)', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'a', value: 1 } } },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'source', target: 'a', value: 1 }])
    })

    it('array of N bindings anchors EVERY binding (consumer + provider mix)', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: [
              { reference: 'a', value: 1 },
              { reference: 'b' },
              { reference: 'c', value: 'C' },
            ],
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([
        { role: 'source', target: 'a', value: 1 },
        { role: 'target', target: 'b' },
        { role: 'source', target: 'c', value: 'C' },
      ])
      expect(t.warnings).toEqual([])
    })

    it('template.component accepts the array form too (anchors on the root)', () => {
      const t = translateLegacy({
        template: {
          root: { type: 'app' },
          component: [
            { reference: 'a', value: 1 },
            { reference: 'b' },
          ],
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([
        { role: 'source', target: 'a', value: 1 },
        { role: 'target', target: 'b' },
      ])
      expect(t.warnings).toEqual([])
    })
  })

  describe('K1/K2 — target = local props.<key> apply path (flat only)', () => {
    it('{reference, target: "props.<key>"} → target anchor + synthesized derived + applyPath on the anchor', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'p10', target: 'props.name' } } },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'target', target: 'p10', applyPath: 'props.name' }])
      expect(t.root.derived?.props?.name).toEqual({ $: 'bindings.p10' })
      expect(t.warnings).toEqual([])
    })

    it('{reference, value, target: "props.<key>"} → DUPLEX anchor (S19 ruling 2026-08-15: value+target ⇒ duplex, not source) + same synthesis (provide-and-self-apply)', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'p10', value: 'v10', target: 'props.name' } } },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'p10', value: 'v10', applyPath: 'props.name' }])
      expect(t.root.derived?.props?.name).toEqual({ $: 'bindings.p10' })
      expect(t.warnings).toEqual([])
    })

    it('no SECOND-NAME target anchor is created for a props.<key> target — the target is the applyPath ON the duplex anchor (S19: value+target is NOW expressible as duplex)', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'val', value: 42, target: 'props.theme' } } },
        content: [],
      })
      const anchors = compAnchors(t.root)
      expect(anchors.filter((a) => a.target === 'theme')).toEqual([])
      expect(anchors).toEqual([{ role: 'duplex', target: 'val', value: 42, applyPath: 'props.theme' }])
    })

    it('synthesis rides the compiled derived bake (self-provider ⇒ own value)', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: { reference: 'mood', value: 'calm', target: 'props.moodPanel' },
          },
        },
        content: [],
      })
      // the synthesized key applies onto the host's compiled props (the local
      // apply); reading it requires the bindings.* root (props.* reads the
      // pass-1 cache, never the bake — derived.ts pathValue)
      const res = t.root.compile(t.nodes)
      const state = res.actionable.find((s) => s.nodeId === t.root.id)!
      expect(state.props.moodPanel).toBe('calm')
    })

    it('template.component value-less binding with target applies synthesis on the ROOT too', () => {
      const t = translateLegacy({
        template: { root: { type: 'app' }, component: { reference: 'p10', target: 'props.name' } },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'target', target: 'p10', applyPath: 'props.name' }])
      expect(t.root.derived?.props?.name).toEqual({ $: 'bindings.p10' })
      expect(t.warnings).toEqual([])
    })

    it('K2 carve-out — dotted reference names: anchor kept, synthesis skipped with component-target-skipped', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'a.b', value: 1, target: 'props.x' } } },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a.b', value: 1 }]) // kept, NO applyPath
      expect(t.root.derived?.props?.x).toBeUndefined()
      expect(t.warnings).toEqual([{ code: 'component-target-skipped', path: 'root' }])
    })

    it('K2 carve-out — props.id target: anchor kept, synthesis skipped (reserved derived key)', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'a', value: 1, target: 'props.id' } } },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1 }])
      expect(t.root.derived?.props?.id).toBeUndefined()
      expect(t.warnings).toEqual([{ code: 'component-target-skipped', path: 'root' }])
    })

    it('K2 carve-out — dotted props.<a.b> key: anchor kept, synthesis skipped', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'a', value: 1, target: 'props.a.b' } } },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1 }])
      expect(t.root.derived).toBeUndefined()
      expect(t.warnings).toEqual([{ code: 'component-target-skipped', path: 'root' }])
    })

    it('K2 carve-out — authored-derived wins: key already present in derived.props, no synthesis, NO warning', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: { reference: 'a', value: 1, target: 'props.x' },
            derived: { props: { x: { $: 'type' } } },
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1 }])
      expect(t.root.derived?.props?.x).toEqual({ $: 'type' })
      expect(t.warnings).toEqual([])
    })

    it('K8 gap — flat known-vocabulary targets warn component-target-gap, anchor kept, no synthesis', () => {
      // the D7 seam set `type`/`content`/`children` is EXCLUDED from the gap
      // (SPEC-ENCODED — they plan as seam candidates, options.seam = target)
      const targets = [
        'css',
        'css.id',
        'css.classes',
        'css.style',
        'css.style.color',
        'handlers',
        'component',
      ]
      for (const target of targets) {
        const t = translateLegacy({
          template: { root: { type: 'app', component: { reference: 'a', value: 1, target } } },
          content: [],
        })
        expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1 }])
        expect(t.root.derived).toBeUndefined()
        expect(t.warnings).toEqual([{ code: 'component-target-gap', path: 'root' }])
      }
    })

    it('K8 gap — unknown / typo\'d target strings warn component-target-gap, anchor kept, no synthesis', () => {
      const targets = ['moodpanel', 'propx.foo', 'propx', 'x.prop', 'propsx', 'theme', 'componentname']
      for (const target of targets) {
        const t = translateLegacy({
          template: { root: { type: 'app', component: { reference: 'a', value: 1, target } } },
          content: [],
        })
        expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1 }])
        expect(t.root.derived).toBeUndefined()
        expect(t.warnings).toEqual([{ code: 'component-target-gap', path: 'root' }])
      }
    })

    it('K8 D7 — target-syntax edges (props., props:name, props.name., bare props) warn component-target-skipped, anchor kept', () => {
      const targets = ['props.', 'props:name', 'props.name.', 'props']
      for (const target of targets) {
        const t = translateLegacy({
          template: { root: { type: 'app', component: { reference: 'a', value: 1, target } } },
          content: [],
        })
        expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1 }])
        expect(t.root.derived).toBeUndefined()
        expect(t.warnings).toEqual([{ code: 'component-target-skipped', path: 'root' }])
      }
    })
  })

  describe('K8 — pre-anchor guards (duplicate reference / duplicate target)', () => {
    it('duplicate reference → component-duplicate-reference, first binding keeps its anchor', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: [
              { reference: 'a', value: 1 },
              { reference: 'a', value: 2 },
            ],
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'source', target: 'a', value: 1 }])
      expect(t.warnings).toEqual([{ code: 'component-duplicate-reference', path: 'root' }])
    })

    it('duplicate exact target path → component-duplicate-target, first binding keeps its anchor + synthesis', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: [
              { reference: 'a', value: 1, target: 'props.x' },
              { reference: 'b', value: 2, target: 'props.x' },
            ],
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1, applyPath: 'props.x' }])
      expect(t.root.derived?.props?.x).toEqual({ $: 'bindings.a' })
      expect(t.warnings).toEqual([{ code: 'component-duplicate-target', path: 'root' }])
    })

    it('distinct references with same family, different paths (props.x + props.y) is LEGAL', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: [
              { reference: 'a', value: 1, target: 'props.x' },
              { reference: 'b', value: 2, target: 'props.y' },
            ],
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([
        { role: 'duplex', target: 'a', value: 1, applyPath: 'props.x' },
        { role: 'duplex', target: 'b', value: 2, applyPath: 'props.y' },
      ])
      expect(t.root.derived?.props?.x).toEqual({ $: 'bindings.a' })
      expect(t.root.derived?.props?.y).toEqual({ $: 'bindings.b' })
      expect(t.warnings).toEqual([])
    })

    it('duplicate non-props target (gap path) is blocked too', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: [
              { reference: 'a', value: 1, target: 'css.style' },
              { reference: 'b', value: 2, target: 'css.style' },
            ],
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'duplex', target: 'a', value: 1 }])
      // first binding's target is itself a recognition-only gap → gap warn,
      // THEN the second is blocked as a duplicate
      expect(t.warnings).toEqual([
        { code: 'component-target-gap', path: 'root' },
        { code: 'component-duplicate-target', path: 'root' },
      ])
    })
  })

  describe('P3 — targetPlacement mints content anchors even on component-bearing nodes (interim warn removed)', () => {
    it('targetPlacement: string[] on a component-bearing node MINTS ordered content anchors, no warning', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            placement: { placementName: 'zone', targetPlacement: ['somewhere', 'elsewhere'] },
            component: { reference: 'a', value: 1 },
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'source', target: 'a', value: 1 }])
      // placementName still materializes — as a 'container' role anchor (P3 §1.1)
      expect(t.root.anchors.find((a) => a.role === 'container')).toBeDefined()
      // and the preference list mints its content anchors in order (the old
      // component-target-placement ignore-warn is REMOVED — §6.1 NP13/AP5)
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['somewhere', 'elsewhere'])
      expect(t.warnings).toEqual([])
    })

    it('no component binding: targetPlacement mints content anchors with no warning', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { targetPlacement: ['somewhere'] } } },
        content: [],
      })
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['somewhere'])
      expect(t.warnings).toEqual([])
    })
  })

  describe('K8 — handler guards (phase-unknown / body-invalid, warn + skip, never throw)', () => {
    it('phase not in the closed 3-set → handler-phase-unknown, handler def skipped', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            handlers: [
              { name: 'legacy-hook', phase: 'beforeAssembly' as never, body: 'function () { return 1 }' },
              { name: 'boot', phase: 'after-render', body: 'function () { return 1 }' },
              { name: 'no-phase', body: 'function () { return 1 }' },
            ],
          },
        },
        content: [],
      })
      const names = (t.root.handlers as Array<{ name: string }>).map((h) => h.name)
      expect(names).toEqual(['boot', 'no-phase'])
      expect(t.warnings).toEqual([{ code: 'handler-phase-unknown', path: 'root.handlers[0]' }])
    })

    it('body that is neither a function nor a string → handler-body-invalid, handler def skipped', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            handlers: [
              { name: 'num', phase: 'after-render', body: 42 as never },
              { name: 'ok', phase: 'after-render', body: 'function () { return 1 }' },
            ],
          },
        },
        content: [],
      })
      expect((t.root.handlers as Array<{ name: string }>).map((h) => h.name)).toEqual(['ok'])
      expect(t.warnings).toEqual([{ code: 'handler-body-invalid', path: 'root.handlers[0]' }])
    })

    it('a body STRING that fails to compile (syntax error) warns + skips instead of throwing (TR-F2 downgrade)', () => {
      const t = translateLegacy({
        template: {
          root: { type: 'app', handlers: [{ name: 'x', phase: 'after-render', body: 'not-a-function(' }] },
        },
        content: [],
      })
      expect(t.root.handlers).toHaveLength(0)
      expect(t.warnings).toEqual([{ code: 'handler-body-invalid', path: 'root.handlers[0]' }])
    })

    it('a body STRING that evaluates to a non-function warns + skips instead of throwing (TR-F2 downgrade)', () => {
      const t = translateLegacy({
        template: {
          root: { type: 'app', handlers: [{ name: 'x', phase: 'after-render', body: '42' }] },
        },
        content: [],
      })
      expect(t.root.handlers).toHaveLength(0)
      expect(t.warnings).toEqual([{ code: 'handler-body-invalid', path: 'root.handlers[0]' }])
    })
  })

  describe('K6 — root template.component mirrors the node mapping', () => {
    it('value-carrying root binding → SOURCE anchor (value published), not a dead-value target anchor', () => {
      const t = translateLegacy({
        template: { root: { type: 'app' }, component: { reference: 'rootval', value: 'v' } },
        content: [],
      })
      const src = t.root.anchors.find((a) => a.role === 'source' && a.target === 'rootval')!
      expect(src).toBeDefined()
      expect(src.value).toBe('v')
      expect(t.root.anchors.find((a) => a.role === 'target' && a.target === 'rootval')).toBeUndefined()
    })

    it('value-less root binding stays a target consumer', () => {
      const t = translateLegacy({
        template: { root: { type: 'app' }, component: { reference: 'consumer' } },
        content: [],
      })
      expect(t.root.anchors.find((a) => a.role === 'target' && a.target === 'consumer')).toBeDefined()
    })
  })

  describe('K5 (translate half) — applyPath persists on anchor options', () => {
    it('round-trips through the new-format boundary (serializeSlice → loadState)', () => {
      const t = translateLegacy({
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
      })
      const doc = serializeSlice(t.root, t.nodes, t.clientConfig)
      const seeded = loadState(JSON.parse(JSON.stringify(doc)))
      const node = new Node(seeded[0]!, hub())
      const anchors = compAnchors(node)
      expect(anchors).toEqual([
        { role: 'duplex', target: 'a', value: 1, applyPath: 'props.x' },
        { role: 'target', target: 'b', applyPath: 'props.y' },
      ])
    })
  })

  it('K5 — reference+value+target:props.<k> reverses WITH the apply path as target (round-trip exact)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: { reference: 'val', value: 42, target: 'props.theme' },
          children: [{ type: 'pane', component: { reference: 'panel', value: { variant: 'a' } } }],
        },
      },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: t.content })
    expect(out.template?.component).toEqual({ reference: 'val', value: 42, target: 'props.theme' })
    expect(out.template?.root.children?.[0]?.component).toEqual({ reference: 'panel', value: { variant: 'a' } })
    // the reversed doc re-translates into the identical anchors (no warnings)
    const again = translateLegacy(out)
    expect(compAnchors(again.root)).toEqual([{ role: 'duplex', target: 'val', value: 42, applyPath: 'props.theme' }])
    expect(again.warnings).toEqual([])
  })

  it('materializes placement configs as container anchors', () => {
    const t = translateLegacy(legacyDoc())
    const card = t.content[1]!
    const container = card.anchors.find((a) => a.role === 'container')!
    expect(container).toBeDefined()
    expect(container.target).toBe('slot-alpha')
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

  it('contentNodes-owned content roots are not actionable until placed; root subtree compiles', () => {
    const t = translateLegacy(legacyDoc())
    // content roots are family-in-tree (token) but the token terminates the
    // compile walk → dropped (P3 §2.4); root + its own children are actionable
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

  it('instantiates legacy handler bodies shipped as function-source STRINGS (function-expression and arrow)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          handlers: [
            { name: 'boot', phase: 'after-render', body: 'function (c) { return "booted-from-string" }' },
            { name: 'click', event: 'click', body: '(c) => 42' },
          ],
        },
      },
      content: [],
    })
    const handlers = t.root.handlers as Array<{ name: string; phase?: string; event?: string; body: unknown }>
    expect(typeof handlers[0]!.body).toBe('function')
    expect(typeof handlers[1]!.body).toBe('function')
    const results = dispatchPhase(t.root, null as never, 'after-render')
    expect(results).toContain('booted-from-string')
  })

  it('reverseTranslate ships live handler bodies back as function-source strings (round-trip via translate)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          handlers: [{ name: 'boot', phase: 'after-render', body: 'function (c) { return c ? "ok" : "no" }' }],
        },
      },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: t.content })
    const emitted = out.template?.root.handlers?.[0] as { body?: unknown }
    expect(typeof emitted?.body).toBe('string')
    expect(emitted!.body).toContain('return c ? "ok" : "no"')
    // the emitted doc re-translates into a live function again
    const t2 = translateLegacy(out)
    const results = dispatchPhase(t2.root, { seed: 'ctx' } as never, 'after-render')
    expect(results).toContain('ok')
  })

  it('a shared hub keeps same-name component/placement anchors on shared links', () => {
    const h = hub()
    const t = translateLegacy(legacyDoc(), { hub: h })
    const shellLink = h.linkFor('shell', 'component')
    expect(shellLink.anchorsOf('target')).toHaveLength(1)
    const slotLink = h.linkFor('slot-alpha', 'placement')
    expect(slotLink.anchorsOf('container')).toHaveLength(1)
    void t
  })

  it('is deterministic and independent of fixture roots', () => {
    const t = translateLegacy({ template: { root: { type: 'page' } } })
    expect(t.root.id).toBeTruthy()
    expect(t.nodes).toHaveLength(1)
    expect(t.content).toHaveLength(0)
    expect(t.warnings).toEqual([])
  })

  describe('P3 — contentNodes-ownership minting (translate-global)', () => {
    it('content payload roots + template.children roots carry the contentNodes parent anchor (family in-tree)', () => {
      const t = translateLegacy(legacyDoc())
      // template.children (hero) + payload item (card)
      expect(t.content.map((c: NodeType) => c.type)).toEqual(['hero', 'card'])
      for (const c of t.content) {
        // the contentNodes permanent-owner token labels content roots
        // 'in-tree' at the FAMILY level (node.ts:213) — never 'unplaced'
        expect(c.state).toBe('in-tree')
        const child = c.childAnchor()
        expect(child).not.toBeNull()
        const parentAnchor = child!.link.anchorsOf('parent')[0]
        expect(parentAnchor).toBeDefined()
        expect(parentAnchor!.target).toBe('contentNodes')
      }
      // nested children inside a content node still attach within it
      expect(t.content[1]!.children.map((c: NodeType) => c.type)).toEqual(['title'])
      expect(t.warnings).toEqual([])
    })

    it('contentNodes-owned roots are family-in-tree but NOT compiled (token terminates the walk)', () => {
      const t = translateLegacy(legacyDoc())
      const res = t.root.compile(t.nodes)
      const actionableIds = res.actionable.map((s) => s.nodeId)
      for (const c of t.content) expect(actionableIds).not.toContain(c.id)
      const droppedIds = res.dropped.map((d) => d.arm[0])
      for (const c of t.content) expect(droppedIds).toContain(c.id)
    })
  })

  describe('P3 — ordered content anchors from targetPlacement: string[]', () => {
    it('mints one content anchor per requested name, in preference order', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { targetPlacement: ['zone-b', 'zone-a', 'zone-c'] } } },
        content: [],
      })
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['zone-b', 'zone-a', 'zone-c'])
      expect(t.warnings).toEqual([])
    })

    it('content anchors land on the shared per-name placement Link', () => {
      const h = hub()
      const t = translateLegacy(
        { template: { root: { type: 'app', placement: { targetPlacement: ['zone-b', 'zone-a'] } } }, content: [] },
        { hub: h },
      )
      const linkB = h.linkFor('zone-b', 'placement')
      const linkA = h.linkFor('zone-a', 'placement')
      expect(linkB.anchorsOf('content')).toHaveLength(1)
      expect(linkA.anchorsOf('content')).toHaveLength(1)
      void t
    })

    it('preference order survives the serialize round-trip (content anchors excluded from the target sort)', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { targetPlacement: ['zone-b', 'zone-a', 'zone-c'] } } },
        content: [],
      })
      const doc = serializeSlice(t.root, t.nodes, t.clientConfig)
      const seeded = loadState(JSON.parse(JSON.stringify(doc)))
      const node = new Node(seeded[0]!, hub())
      expect(node.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['zone-b', 'zone-a', 'zone-c'])
    })

    it('back-compat: the old single-string targetPlacement is coerced to [string] with a warn', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { targetPlacement: 'zone-a' as never } } },
        content: [],
      })
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['zone-a'])
      expect(t.warnings).toEqual([{ code: 'placement-string-coerced', path: 'root' }])
    })

    it('placementName (container) + targetPlacement (content) coexist on one node', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { placementName: 'my-zone', targetPlacement: ['zone-b', 'zone-a'] } } },
        content: [],
      })
      expect(t.root.anchors.filter((a) => a.role === 'container').map((a) => a.target)).toEqual(['my-zone'])
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['zone-b', 'zone-a'])
      expect(t.warnings).toEqual([])
    })

    it('targetPlacement on a component-bearing node now MINTS (the interim component-target-placement warn is gone)', () => {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            placement: { placementName: 'zone', targetPlacement: ['somewhere'] },
            component: { reference: 'a', value: 1 },
          },
        },
        content: [],
      })
      expect(compAnchors(t.root)).toEqual([{ role: 'source', target: 'a', value: 1 }])
      expect(t.root.anchors.filter((a) => a.role === 'container').map((a) => a.target)).toEqual(['zone'])
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['somewhere'])
      expect(t.warnings).toEqual([])
    })
  })

  describe('P3 — #-validation at the placement minting site (placement-name-invalid)', () => {
    it('a placementName containing # warns and the container anchor is skipped', () => {
      const t = translateLegacy({ template: { root: { type: 'app', placement: { placementName: 'bad#zone' } } }, content: [] })
      expect(t.root.anchors.filter((a) => a.role === 'container')).toEqual([])
      expect(t.warnings).toEqual([{ code: 'placement-name-invalid', path: 'root' }])
    })

    it('a targetPlacement name containing # warns and ONLY that binding is skipped', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { targetPlacement: ['ok-zone', 'bad#zone', 'ok-zone-2'] } } },
        content: [],
      })
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['ok-zone', 'ok-zone-2'])
      expect(t.warnings).toEqual([{ code: 'placement-name-invalid', path: 'root' }])
    })
  })

  describe('P3 — activePlacement is derived, never authored', () => {
    it('an authored activePlacement produces NO anchor and NO warning', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { placementName: 'zone', targetPlacement: ['zone'], activePlacement: 'zone' } } },
        content: [],
      })
      expect(t.root.anchors.filter((a) => a.role === 'container').map((a) => a.target)).toEqual(['zone'])
      expect(t.root.anchors.filter((a) => a.role === 'content')).toHaveLength(1)
      expect(t.warnings).toEqual([])
    })
  })

  describe('P3 — duplicate names in targetPlacement (K8-class guard)', () => {
    it('duplicate name → placement-duplicate-reference warn, keep-first, skip the rest', () => {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: { targetPlacement: ['zone-a', 'zone-b', 'zone-a'] } } },
        content: [],
      })
      expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['zone-a', 'zone-b'])
      expect(t.warnings).toEqual([{ code: 'placement-duplicate-reference', path: 'root' }])
    })
  })
})
