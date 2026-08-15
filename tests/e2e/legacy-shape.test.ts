/**
 * Run A (RED) — legacy-shape E2E (full envelope → render → round-trip).
 *
 * The envelope follows the feature-showcase blind-test data-authoring rules:
 * legacy-JSON envelope input, handler bodies as function-STRING data, no
 * outside scripts. The page module `demo/legacy-shape.js` is NOT built yet —
 * this test drives the engine directly on the public surface.
 *
 * States / fail-states enumerated:
 *
 * [1] a full legacy envelope (ARRAY placement, OBJECT css.style, TEXT-only
 *     content, string handler bodies, def bindings) renders through the SSR
 *     adapter: the emitted style attribute is the serialized kebab string
 *     (never "[object Object]"), text stays text, array placement mints its
 *     anchors (D1+D3+D5 end-to-end — RED today on the style string and the
 *     placement anchors).
 * [2] the same envelope round-trips reverse → re-translate with zero
 *     warnings (D1/D2/D3/D5 halves compose; RED today).
 * [3] a cssDef-bearing envelope renders with the D4 styles block prefixed
 *     into the SSR result (rule strings only; RED today — no styles op is
 *     generated).
 * [4] doc.content emitted as ContentPayload[] on reverse (D2 R-H4 — already
 *     green; flag).
 * [5] D7 seam-flow (ops.md ALS-1/ALS-2 — VERIFICATION GAP, fix pass PENDING):
 *     a legacy envelope shaped like live prod — root with 3 children (wrapper
 *     A seam-targets 'children'→'nav', wrapper B seam-targets 'children'→'foot',
 *     plus a plain div), template.component defs `nav`/`foot` with
 *     deliverable children — runs translate → register → compile → emit →
 *     diffMinimal → applyOps(SSR). The seam materializes the def's pre-minted
 *     prototype children as the wrapper's descendants: wrapper A nests logo +
 *     Home, wrapper B nests the footer p, each def child appears exactly once
 *     (no duplication, no orphan at root level); after compile the consumer's
 *     anchors carry the seam child links (parent-role, options.seam) whose
 *     child side sits on the pre-minted prototypes; the consumer's OWN family
 *     parent anchor stays the root. RED today: no materialization — the
 *     wrappers emit as empty divs, the def children never nest.
 * [6] root-clobber pin (render.md DFC-F1/DFC-2 — VERIFICATION GAP): the ROOT
 *     carries a value-carrying source binding 'auth' (def children: button
 *     'Sign In' + div) seam-targeted by wrapper A. The ROOT must emit its OWN
 *     real children — the 3 wrappers in authored order with their own types —
 *     never aliased to auth's button+div; the auth def children appear ONLY
 *     inside wrapper A. RED today: the root is skipped from compile entirely
 *     (resolution-participant), no root element exists at all.
 * [7] SED-2 (delivery-shape ruling — children-target = SHELL + DEF-ROOT
 *     CHILD, render.md §3.4.2/§10.7, ops.md ALS-1/ALS-2): wrapper A stays a
 *     `div` SHELL containing a `nav.nav-bar` element (def type + class) whose
 *     child is the logo div 'logo' — that exact nesting. RED today: the
 *     wrapper collapses to `nav` with no class (the old def-fill).
 * [8] SED-1 (type-target = SHELL COLLAPSE): wrapper B's element IS
 *     `section.panel` (def type + def classes) containing p 'hi'; NO separate
 *     def-root element renders. RED today: the element takes the def type but
 *     NOT the def css (no 'panel' class).
 * [9] SED-2 cssDef (D4 interplay): the def-root's `.nav-bar{...}` rule joins
 *     the deduped styles block exactly ONCE. RED today: no styles op at all
 *     (the def cssDef never reaches a renderable compiled state).
 * [10] SED-1 cssDef: `.panel{...}` appears once in the styles block. RED
 *      today (same root cause).
 * [11] SED-3 (content-target = TEXT ONLY): the consumer's content slot takes
 *      the def's text; no element child, no def-root element. (GREEN today —
 *      the ALS-7 content layer landed.)
 * [12] ALS-1b (def-ROOT minting): after translate, a def-root prototype
 *      exists for `nav` — registered, census-visible, 'component'-token
 *      family parent, type `nav`, css classes ['nav-bar'] + cssDef, with
 *      child links to the pre-minted def-children prototypes. RED today: only
 *      the def-CHILDREN prototypes are minted, never the def-root.
 * [13] ALS-2 (children-target parent anchors): after compile, the def-root's
 *      own child links carry their parent anchors ON the def-root (target =
 *      self, options.seam = true); the consumer's seam child link points at
 *      the def-root; the consumer's family parent is still the root. RED
 *      today on the def-root halves (no def-root exists).
 * [14] leaf-def children-target: a `p` children-targeting a content-bearing
 *      leaf def (`{type:'span', content:'x'}`) renders `p > span` 'x'. RED
 *      today: the def-fill needs a children array (isLinkDef), so the leaf
 *      delivers nothing and the p emits empty.
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy, reverseTranslate, type LegacyInitialData } from '../../src/core/translate.js'
import { Node, Supervisor } from '../../src/core/node.js'
import { minimalFromState, applyOps, emitElements } from '../../src/core/render-helpers.js'
import { diffMinimal, type RenderOp, type MinimalElement } from '../../src/core/render.js'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import { EventBridge } from '../../src/core/events.js'
import { registered } from '../../src/core/registry.js'
import { hub } from '../helpers/fixtures.js'

function envelope(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'app',
        css: {
          id: 'app-root',
          style: { backgroundColor: '#1b1b1b', color: '#e0e0e0' } as never,
          cssDef: [{ selector: '.card', styles: { border: '1px solid #444', padding: '8px' } }],
        },
        placement: [{ placementName: 'main-zone' }, { targetPlacement: ['header-slot'] }] as never,
        component: { reference: 'articleTitle', target: 'content' },
        handlers: [{ name: 'boot', phase: 'after-render', body: 'function (c) { return "booted" }' }],
        children: [
          {
            type: 'h1',
            content: 'Welcome',
            css: { style: { WebkitTransform: 'rotate(1deg)' } as never },
            component: { reference: 'heroDef', target: 'children' },
          },
          { type: 'p', content: 'text-only content' },
        ],
      },
      children: [{ type: 'hero', content: 'unplaced hero' }],
    },
    content: [
      {
        metadata: { locale: 'en' },
        userData: { session: 's1' },
        content: [{ type: 'card', content: 'card text' }],
      },
    ],
    clientConfig: { runInstantiation: true, runMonitoring: true },
  }
}

function renderOps(t: ReturnType<typeof translateLegacy>): RenderOp[] {
  const cr = t.root.compile(t.nodes)
  const els: MinimalElement[] = cr.actionable.map(minimalFromState)
  return diffMinimal(null, els)
}

function ssr(t: ReturnType<typeof translateLegacy>): SSRFragmentAdapter {
  const adapter = new SSRFragmentAdapter()
  applyOps(adapter as never, renderOps(t))
  return adapter
}

/** Every element nested under `rootWire` (transitive childOrder walk). */
function descendantsOf(els: MinimalElement[], rootWire: string): MinimalElement[] {
  const byWire = new Map(els.map((e) => [e.wire, e]))
  const out: MinimalElement[] = []
  const walk = (wire: string): void => {
    const el = byWire.get(wire)
    if (!el) return
    for (const c of el.childOrder ?? []) {
      const ce = byWire.get(c)
      if (ce) {
        out.push(ce)
        walk(c)
      }
    }
  }
  walk(rootWire)
  return out
}

/** translate → register → compile → emitElements → diffMinimal → applyOps(SSR). */
function renderPipeline(
  t: ReturnType<typeof translateLegacy>,
): { els: MinimalElement[]; ops: RenderOp[]; html: string } {
  const supervisor = new Supervisor({ hub: hub(), events: new EventBridge() })
  for (const n of t.nodes) supervisor.registerNode(n)
  const cr = t.root.compile(t.nodes)
  const nodeById = new Map(t.nodes.map((n) => [n.id, { handlers: [], children: n.children.map((c) => ({ id: c.id })) }]))
  const els = emitElements(cr.actionable, nodeById)
  const ops = diffMinimal(null, els)
  const adapter = new SSRFragmentAdapter()
  applyOps(adapter as never, ops)
  return { els, ops, html: adapter.toString() }
}

describe('legacy-shape envelope — full pipeline (D1/D3/D5/D7)', () => {
  it('[1] the emitted style attribute is the serialized kebab string — never "[object Object]" — and placement arrays mint', () => {
    const t = translateLegacy(envelope(), { hub: hub() })
    // D1 — the ARRAY placement minted container + content anchors (no warn)
    expect(t.root.anchors.filter((a) => a.role === 'container').map((a) => a.target)).toEqual(['main-zone'])
    expect(t.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['header-slot'])
    expect(t.warnings).toEqual([])

    // D3 — object style serialized at translate
    expect(t.root.css?.style).toBe('background-color: #1b1b1b; color: #e0e0e0;')

    // D3 boundary — the SSR style attribute carries the kebab string
    const html = ssr(t).toString()
    expect(html).toContain('style="background-color: #1b1b1b; color: #e0e0e0;"')
    expect(html).not.toContain('[object Object]')
    // vendor-prefixed child style serializes too
    expect(html).toContain('-webkit-transform: rotate(1deg)')

    // D5 — text stays text (no dual-parse artifacts)
    expect(html).toContain('Welcome')
    expect(html).toContain('text-only content')
  })

  it('[2] the envelope round-trips reverse → re-translate with ZERO warnings (D1/D2/D3/D5 halves compose)', () => {
    const t = translateLegacy(envelope(), { hub: hub() })
    const out = reverseTranslate(t.root, {
      content: t.content,
      metadata: t.metadata,
      userData: t.userData,
    })
    // D2 R-H4 — content is ALWAYS a ContentPayload[] array on reverse
    expect(Array.isArray(out.content)).toBe(true)
    // D3 F7 — style strings reversed back to objects
    const h1 = out.template?.root.children?.[0]
    expect(h1?.css?.style).toEqual({ WebkitTransform: 'rotate(1deg)' })
    // D5 — payload content reversed as text (content[0] is the template.children
    // hero per the pinned reverse order [hero, card] — reverse.test.ts:70;
    // the payload card is found by type)
    const card = out.content?.[0]?.content.find((c) => c.type === 'card')
    expect(card?.content).toBe('card text')
    // re-translate is warning-free and anchor-identical
    const again = translateLegacy(out)
    expect(again.warnings).toEqual([])
    expect(again.root.anchors.filter((a) => a.role === 'container').map((a) => a.target)).toEqual(['main-zone'])
    expect(again.root.anchors.filter((a) => a.role === 'content').map((a) => a.target)).toEqual(['header-slot'])
  })

  it('[3] a cssDef-bearing envelope renders with the D4 styles block prefixed into the SSR result (rule strings only)', () => {
    const t = translateLegacy(envelope(), { hub: hub() })
    const html = ssr(t).toString()
    expect(html.startsWith('<style id="preempt-dynamic-styles">')).toBe(true)
    expect(html).toContain('.card{')
    expect(html).toContain('border: 1px solid #444')
    expect(html).not.toContain('[object Object]')
  })

  it('[4] reverse emits content as ContentPayload[] even for a single group (D2 R-H4 — already green)', () => {
    const t = translateLegacy({ template: { root: { type: 'app' } }, content: [{ content: [{ type: 'x' }] }] })
    const out = reverseTranslate(t.root, { content: t.content })
    expect(Array.isArray(out.content)).toBe(true)
    expect(out.content![0]!.content.map((c) => c.type)).toEqual(['x'])
  })
})

describe('D7 seam-flow — def children materialize INSIDE the seam consumer (ALS-1/ALS-2)', () => {
  it('[5] wrapper A nests the nav def' + "'s children (logo + Home), wrapper B nests the footer p — exactly once, no orphan at root level", () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [
            { type: 'div', component: [{ target: 'children', reference: 'nav' }] },
            { type: 'div', component: [{ target: 'children', reference: 'foot' }] },
            { type: 'div', content: 'plain' },
          ],
        },
        component: [
          {
            reference: 'nav',
            value: {
              type: 'nav',
              children: [
                { type: 'div', content: 'logo' },
                { type: 'div', children: [{ type: 'a', props: { href: '/' }, content: 'Home' }] },
              ],
            },
          },
          { reference: 'foot', value: { type: 'footer', children: [{ type: 'p', content: '(c)' }] } },
        ],
      },
      content: [],
    })
    expect(t.warnings).toEqual([])

    // F16 (green) — the def children are pre-minted prototypes whose family
    // CHAIN terminates at the 'component' permanent-owner token (a nested
    // prototype's own childAnchor is its family link; the walk lands on the
    // token at the top of the chain)
    const protos = t.nodes.filter((n) => n.state === 'prototype')
    expect(protos.map((p) => p.type).sort()).toEqual(['a', 'div', 'div', 'p'])
    const chainTerminal = (p: Node): string | null => {
      let cur: Node | null = p
      while (cur) {
        const pa = cur.childAnchor()?.link.anchorsOf('parent')[0]
        if (!pa) return null
        if (typeof pa.target === 'string') return pa.target
        cur = pa.target as Node
      }
      return null
    }
    for (const p of protos) expect(chainTerminal(p)).toBe('component')

    const wA = t.root.children[0]!
    const wB = t.root.children[1]!
    const plain = t.root.children[2]!
    const protoIds = new Set(protos.map((p) => p.id))

    const { els, html } = renderPipeline(t)

    // ALS-2 (red) — after compile the seam consumer's anchors carry the seam
    // CHILD links: 'parent'-role anchors with options.seam...
    const seamParents = wA.anchors.filter(
      (an) => an.role === 'parent' && (an.options as { seam?: string }).seam !== undefined,
    )
    expect(seamParents.length).toBeGreaterThan(0)
    // ...whose child side sits on the pre-minted prototypes (ALS-1)
    const seamChildOwners = seamParents.flatMap((an) =>
      an.link.anchorsOf('child').map((ca) => ca.owner?.id).filter((id): id is string => id !== undefined),
    )
    for (const id of seamChildOwners) expect(protoIds.has(id)).toBe(true)

    // ALS-3 (green) — the consumer's OWN family parent anchor is untouched
    // (its family parent is still the root)
    expect(wA.childAnchor()!.link.anchorsOf('parent')[0]!.target).toBe(t.root)

    // wrapper A's emitted element contains the nav def's children as
    // descendants (logo + Home nested INSIDE the wrapper's element)
    const aDesc = descendantsOf(els, wA.id)
    expect(aDesc.some((e) => e.props['text'] === 'logo')).toBe(true)
    expect(aDesc.some((e) => e.props['text'] === 'Home')).toBe(true)
    // wrapper B's element contains the footer's p child
    const bDesc = descendantsOf(els, wB.id)
    expect(bDesc.some((e) => e.props['text'] === '(c)')).toBe(true)

    // the def children appear exactly once — no duplication, no orphan at
    // root level (the top-level element set never carries a def child wire)
    const count = (s: string): number => html.split(s).length - 1
    expect(count('logo')).toBe(1)
    expect(count('Home')).toBe(1)
    expect(count('(c)')).toBe(1)
    expect(els.filter((e) => protoIds.has(e.wire))).toEqual([])

    // the plain authored child still emits its own content (green)
    const plainEl = els.find((e) => e.wire === plain.id)!
    expect(plainEl.props['text']).toBe('plain')
  })

  it('[6] root-clobber pin — the ROOT emits its OWN real children (3 wrappers, authored order, own types), never aliased to the auth def' + "'s button+div", () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: {
            reference: 'auth',
            value: { type: 'div', children: [{ type: 'button', content: 'Sign In' }, { type: 'div' }] },
          },
          children: [
            { type: 'div', component: [{ target: 'children', reference: 'auth' }] },
            { type: 'div', component: [{ target: 'children', reference: 'nav' }] },
            { type: 'div', content: 'plain' },
          ],
        },
        component: [{ reference: 'nav', value: { type: 'nav', children: [{ type: 'div', content: 'logo' }] } }],
      },
      content: [],
    })
    const { els } = renderPipeline(t)

    // the ROOT emits its own element with its OWN type (never the def's 'div')
    const rootEl = els.find((e) => e.wire === t.root.id)
    expect(rootEl).toBeDefined()
    expect(rootEl!.type).toBe('app')
    // ...whose children are exactly the 3 authored wrappers in authored order
    expect(rootEl!.childOrder).toEqual(t.root.children.map((c) => c.id))
    // the first wrapper keeps its own type 'div' — NOT aliased to 'button'
    const wA = t.root.children[0]!
    const aEl = els.find((e) => e.wire === wA.id)
    expect(aEl).toBeDefined()
    expect(aEl!.type).toBe('div')
    // the auth def children appear ONLY inside the wrapper that seam-references
    // them (wrapper A) — exactly once, never at root level
    const signIns = els.filter((e) => e.props['text'] === 'Sign In')
    expect(signIns).toHaveLength(1)
    expect(descendantsOf(els, wA.id).some((e) => e.props['text'] === 'Sign In')).toBe(true)
    const authProtoIds = new Set(t.nodes.filter((n) => n.state === 'prototype').map((n) => n.id))
    expect(els.filter((e) => authProtoIds.has(e.wire))).toEqual([])
  })
})

describe('SED-1/2/3 — seam delivery shapes (delivery-shape ruling; ALS-1/1b/2, render.md §3.4.2/§10.7)', () => {
  /** Minimal live-prod-shaped envelope: children-target wrapper (nav), type-
   *  target wrapper (panel), leaf-def children-target (span), content-target
   *  consumer (title). Defs carry type + css (classes + cssDef) + children. */
  function sedEnvelope(): LegacyInitialData {
    return {
      template: {
        root: {
          type: 'app',
          children: [
            { type: 'div', component: [{ target: 'children', reference: 'nav' }] },
            { type: 'div', component: [{ target: 'type', reference: 'panel' }] },
            { type: 'p', component: [{ target: 'children', reference: 'leaf' }] },
            { type: 'h2', component: [{ target: 'content', reference: 'title' }] },
          ],
        },
        component: [
          {
            reference: 'nav',
            value: {
              type: 'nav',
              css: { classes: ['nav-bar'], cssDef: [{ selector: '.nav-bar', styles: { display: 'flex' } }] },
              children: [{ type: 'div', content: 'logo' }],
            },
          },
          {
            reference: 'panel',
            value: {
              type: 'section',
              css: { classes: ['panel'], cssDef: [{ selector: '.panel', styles: { padding: '1rem' } }] },
              children: [{ type: 'p', content: 'hi' }],
            },
          },
          { reference: 'leaf', value: { type: 'span', content: 'x' } },
          { reference: 'title', value: { type: 'span', content: 'Title text' } },
        ],
      },
      content: [],
    }
  }

  function chainTerminal(p: Node): string | null {
    let cur: Node | null = p
    while (cur) {
      const pa = cur.childAnchor()?.link.anchorsOf('parent')[0]
      if (!pa) return null
      if (typeof pa.target === 'string') return pa.target
      cur = pa.target as Node
    }
    return null
  }

  it('[7] SED-2 — children-target: wrapper A stays a div SHELL containing a nav.nav-bar element whose child is the logo div', () => {
    const t = translateLegacy(sedEnvelope())
    expect(t.warnings).toEqual([])
    const wA = t.root.children[0]!
    const { els, html } = renderPipeline(t)

    // the wrapper keeps its OWN element (the shell — authored type)
    const aEl = els.find((e) => e.wire === wA.id)!
    expect(aEl.type).toBe('div')
    // its first child is the DEF-ROOT element: nav with the def's class
    const navEl = els.find((e) => e.wire === aEl.childOrder[0]!)!
    expect(navEl.type).toBe('nav')
    expect(navEl.props['css:classes']).toEqual(['nav-bar'])
    // whose child is the logo div — exact nesting div > nav.nav-bar > div.logo
    const logoEl = els.find((e) => e.wire === navEl.childOrder[0]!)!
    expect(logoEl.type).toBe('div')
    expect(logoEl.props['text']).toBe('logo')
    expect(html).toContain('class="nav-bar"')
  })

  it('[8] SED-1 — type-target: wrapper B emits AS section.panel (def type + def classes) containing p "hi"; no separate def-root element', () => {
    const t = translateLegacy(sedEnvelope())
    const wB = t.root.children[1]!
    const { els } = renderPipeline(t)

    const bEl = els.find((e) => e.wire === wB.id)!
    // shell collapse: the consumer element IS the def's element
    expect(bEl.type).toBe('section')
    expect(bEl.props['css:classes']).toEqual(['panel'])
    // the def's children emit inside it
    const pEl = els.find((e) => e.wire === bEl.childOrder[0]!)!
    expect(pEl.type).toBe('p')
    expect(pEl.props['text']).toBe('hi')
    // NO separate def-root element renders — exactly one section element
    expect(els.filter((e) => e.type === 'section')).toHaveLength(1)
  })

  it('[9] SED-2 cssDef — the def-root' + "'s .nav-bar rule joins the deduped styles block exactly ONCE", () => {
    const t = translateLegacy(sedEnvelope())
    const { ops } = renderPipeline(t)
    const stylesOps = ops.filter((o) => o.kind === 'styles') as Array<{ cssDefs: unknown[] }>
    expect(stylesOps).toHaveLength(1)
    const rules = stylesOps[0]!.cssDefs.map(String)
    expect(rules.filter((r) => r.startsWith('.nav-bar{')).length).toBe(1)
    expect(rules.some((r) => r.includes('display: flex'))).toBe(true)
  })

  it('[10] SED-1 cssDef — the .panel rule appears once in the styles block', () => {
    const t = translateLegacy(sedEnvelope())
    const { ops } = renderPipeline(t)
    const stylesOps = ops.filter((o) => o.kind === 'styles') as Array<{ cssDefs: unknown[] }>
    expect(stylesOps).toHaveLength(1)
    const rules = stylesOps[0]!.cssDefs.map(String)
    expect(rules.filter((r) => r.startsWith('.panel{')).length).toBe(1)
    expect(rules.some((r) => r.includes('padding: 1rem'))).toBe(true)
  })

  it('[11] SED-3 — content-target: the def' + "'s text lands in the consumer's content slot; no element child, no def-root element (green today)", () => {
    const t = translateLegacy(sedEnvelope())
    const h2 = t.root.children[3]!
    const { els } = renderPipeline(t)
    const h2El = els.find((e) => e.wire === h2.id)!
    expect(h2El.type).toBe('h2')
    expect(h2El.props['text']).toBe('Title text')
    expect(h2El.childOrder).toEqual([])
  })

  it('[12] ALS-1b — the def-ROOT is pre-minted at translate: nav prototype (registered, component-token, type + css incl. cssDef) with child links to the def-children prototypes', () => {
    const t = translateLegacy(sedEnvelope())
    // after translate, BEFORE compile: the def-root prototype for nav exists
    const navRoot = t.nodes.find((n) => n.state === 'prototype' && n.type === 'nav')
    expect(navRoot).toBeDefined()
    // its family chain terminates at the 'component' permanent-owner token
    expect(chainTerminal(navRoot!)).toBe('component')
    // it carries the def's type + css (classes + cssDef)
    expect(navRoot!.css?.classes).toEqual(['nav-bar'])
    expect(navRoot!.css?.cssDef).toBeDefined()
    // it holds child links to the pre-minted def-children prototypes
    const childProtos = navRoot!.children
    expect(childProtos.map((c: Node) => c.type)).toEqual(['div'])
    expect(childProtos.every((c: Node) => c.state === 'prototype')).toBe(true)
    // registered + census-visible (the supervisor registration flow)
    const supervisor = new Supervisor({ hub: hub(), events: new EventBridge() })
    for (const n of t.nodes) supervisor.registerNode(n)
    expect(registered.has(navRoot!)).toBe(true)
  })

  it('[13] ALS-2 — children-target: the def-root' + "'s own child links carry their parent anchors ON the def-root (target = self, options.seam); the consumer's seam child link points at the def-root; the consumer's family parent stays the root", () => {
    const t = translateLegacy(sedEnvelope())
    const wA = t.root.children[0]!
    renderPipeline(t)
    const navRoot = t.nodes.find((n) => n.state === 'prototype' && n.type === 'nav')!

    // the def-root's child links (to the def-children prototypes) carry their
    // parent anchors ON the def-root — target = self, options.seam = true
    const defRootSeamParents = navRoot.anchors.filter(
      (a) => a.role === 'parent' && (a.options as { seam?: boolean }).seam === true,
    )
    expect(defRootSeamParents.length).toBeGreaterThan(0)
    for (const p of defRootSeamParents) expect(p.target).toBe(navRoot)
    // the def-children prototypes sit on those links' child side
    const passed = defRootSeamParents.flatMap((p) => p.link.anchorsOf('child'))
    expect(passed.some((ca) => ca.target === navRoot.children[0])).toBe(true)

    // the consumer's seam child link points at the def-root
    const wASeamParent = wA.anchors.find(
      (a) => a.role === 'parent' && (a.options as { seam?: boolean }).seam === true,
    )
    expect(wASeamParent).toBeDefined()
    expect(wASeamParent!.link.anchorsOf('child').some((ca) => ca.target === navRoot)).toBe(true)

    // the consumer's own family parent is untouched (still the root)
    expect(wA.childAnchor()!.link.anchorsOf('parent')[0]!.target).toBe(t.root)
  })

  it('[14] leaf-def children-target — a p children-targeting a content-bearing leaf def renders p > span "x"', () => {
    const t = translateLegacy(sedEnvelope())
    const pLeaf = t.root.children[2]!
    const { els } = renderPipeline(t)
    const pEl = els.find((e) => e.wire === pLeaf.id)!
    // the p keeps its own shell and gains the leaf def-root as its child
    expect(pEl.type).toBe('p')
    expect(pEl.childOrder).toHaveLength(1)
    const spanEl = els.find((e) => e.wire === pEl.childOrder[0]!)!
    expect(spanEl.type).toBe('span')
    expect(spanEl.props['text']).toBe('x')
  })
})

describe('B1 — children-target NEVER collapses (user clarification 2026-08-14)', () => {
  it('[15] a children-target wrapper WITH authored children + authored text keeps everything and gains the def-root as an ADDITIONAL child', () => {
    const env = {
      template: {
        root: {
          type: 'app',
          component: [
            {
              reference: 'nav',
              value: { type: 'nav', css: { classes: ['nav-bar'] }, children: [{ type: 'div', content: 'logo' }] },
            },
          ],
          children: [
            {
              type: 'div',
              content: 'shell text',
              component: [{ target: 'children', reference: 'nav' }],
              children: [{ type: 'p', content: 'authored' }],
            },
          ],
        },
      },
      content: [],
    }
    const t = translateLegacy(env as never)
    const supervisor = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) supervisor.registerNode(n)
    const cr = t.root.compile(t.nodes)
    const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n])) as never
    const els = emitElements(cr.actionable, byNode)
    const ops = diffMinimal(null, els)
    const adapter = new SSRFragmentAdapter()
    applyOps(adapter as never, ops)
    const html = adapter.toString()

    const wA = t.root.children[0]!
    const aEl = els.find((e) => e.wire === wA.id)!
    // NO collapse: the wrapper keeps its OWN type, its OWN text, its OWN
    // authored child — and the def-root joins as an ADDITIONAL child
    expect(aEl.type).toBe('div')
    expect(aEl.props['text']).toBe('shell text')
    expect(aEl.childOrder.length).toBe(2)
    const pEl = els.find((e) => e.wire === aEl.childOrder[0]!)!
    expect(pEl.type).toBe('p')
    expect(pEl.props['text']).toBe('authored')
    const navEl = els.find((e) => e.wire === aEl.childOrder[1]!)!
    expect(navEl.type).toBe('nav')
    expect(navEl.props['css:classes']).toEqual(['nav-bar'])
    // exact nesting: div(shell text) > [p(authored), nav.nav-bar > div(logo)]
    expect(html).toContain('shell text')
    expect(html).toContain('authored</p>')
    expect(html).toContain('class="nav-bar"')
    expect(html).toContain('>logo</div>')
    // no collapse artifact: the wrapper never becomes the nav element
    expect(aEl.type).not.toBe('nav')
  })
})
