/**
 * Run A (RED) — legacy-shape EMIT contract, D3/D4/D8 pins
 * (docs/specs/render.md §3.4, docs/specs/adapters.md §3.3/§4.5;
 * fix pass PENDING).
 *
 * States / fail-states enumerated:
 *
 * D3 — style-string boundary at emit (adapters.md §3.2 css:style row):
 *   [1] translate(object style) → compile → minimalFromState: the css:style
 *       prop value is the serialized STRING, never the raw object
 *       (the [object Object] defect class never reaches String(val))
 *
 * D4 — styles-op generation from css.cssDef (render.md STL-1..4):
 *   [2] STL-H1 — a cssDef-bearing actionable node produces exactly ONE
 *       `styles` op whose payload entries are RULE STRINGS `{sel}{k: v;}`
 *   [3] STL-H2 — a NESTED styles value (media-query form) serializes
 *       recursively inside the outer rule
 *   [4] STL-H3 — the SAME rule on TWO nodes emits ONCE (rule-signature dedup)
 *   [5] STL-H4 — rules come ONLY from actionable compiled states: a cssDef on
 *       a token-owned content root (dropped arm) contributes NO rule
 *   [6] STL-F1 — zero-or-one styles op per sweep (two distinct rules → ONE op)
 *   [7] STL-H5 — cssDef-less render → NO styles op (no empty style block;
 *       green-by-accident today — nothing ever generates the op)
 *   [8] STL-F2 — the op payload is rule strings ONLY (never a raw cssDef object)
 *   [9] adapters.md DOM-H29 — DomAdapter dedups same-signature rule strings
 *       per adapter instance (exactly one <style id="preempt-dynamic-styles">,
 *       single entry)
 *   [10] adapters.md FRG-H27 — SSRFragmentAdapter styles buffer dedups
 *        same-signature rule strings
 *
 * D8 — def-chain emit scoping (render.md DFC-1..3):
 *   [11] DFC-H1 — fork-stress link-method 1:1 at offset 0 re-types the
 *        covered real children (each keeping its OWN authored css/props), NO
 *        synthetic `${wire}:${bind}` wires (green today — fork-stress proof)
 *   [12] DFC-F1 — def.children.length !== childWires.length → NO re-typing of
 *        real child wires, NO synthetic wires, real children keep own types
 *        and order (the clobber defect lives here today)
 *   [13] DFC-F1b — same for the longer-def direction: no drops beyond the
 *        covered slice, no aliasing
 *   [14] DFC-F2 — a SEAM-TARGET def (options.seam set) NEVER drives an
 *        emit-time chain: a translate-planned seam consumer resolves the def
 *        value but emits its OWN type + authored children (today the binding
 *        resolution trips isLinkDef and the clobber fires)
 *   [15] DFC-F1 (VERIFICATION GAP, fix pass PENDING) — a DELIVERABLE-spec def
 *        (children WITHOUT `bind` keys) with a count MISMATCH never drives
 *        the chain: the node emits its REAL children (own types, own order),
 *        the def children are NOT emitted by the host, no re-typing, no
 *        aliasing. RED today: linkChainAllowed returns true for non-link-
 *        method defs unconditionally — the root-clobber case (def.children
 *        shorter than the real children: the first N real children get
 *        aliased to the def's children and the rest drop from the order)
 *
 * RED set today: 1,2,3,4,5,6,8,9,10,12,13,14,15. Green-by-accident pins (flag):
 * 7, 11.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { minimalFromState, emitElements, applyOps, wireKey } from '../../src/core/render-helpers.js'
import { diffMinimal, type RenderOp, type MinimalElement } from '../../src/core/render.js'
import { DomAdapter, SSRFragmentAdapter } from '../../src/core/adapters.js'
import { execute } from '../../src/core/ops.js'
import { hub } from '../helpers/fixtures.js'

type EmitState = {
  nodeId: string
  type: string
  props?: Record<string, unknown>
  css?: Record<string, unknown>
  content?: unknown
  children?: string[]
  bindings?: Record<string, unknown>
  forkKey?: string
}

function stylesOps(ops: RenderOp[]): Array<{ cssDefs: unknown[] }> {
  return ops.filter((o) => o.kind === 'styles') as unknown as Array<{ cssDefs: unknown[] }>
}

describe('D3 — css:style reaches the emit boundary as a STRING (never the raw object)', () => {
  it('[1] translate(object style) → compile → minimalFromState: css:style prop is the kebab string', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', css: { style: { backgroundColor: 'red' } as never } } },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const el = minimalFromState(cr.actionable.find((s) => s.nodeId === t.root.id)!)
    expect(typeof el.props['css:style']).toBe('string')
    expect(el.props['css:style']).toBe('background-color: red;')
  })
})

describe('D4 — css.cssDef generates a styles op with RULE STRINGS (STL-1..4)', () => {
  it('[2] STL-H1 — a cssDef-bearing actionable node emits exactly ONE styles op; entries are rule strings', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          css: { cssDef: [{ selector: '.a', styles: { color: 'red' } }] },
        },
      },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const styles = stylesOps(ops)
    expect(styles).toHaveLength(1)
    const rules = styles[0]!.cssDefs
    expect(rules).toHaveLength(1)
    expect(typeof rules[0]).toBe('string')
    expect(rules[0]).toContain('.a{')
    expect(rules[0]).toContain('color: red')
  })

  it('[3] STL-H2 — a NESTED styles value (media-query form) serializes recursively inside the outer rule', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          css: {
            cssDef: [
              {
                selector: '@media (prefers-color-scheme: dark)',
                styles: { '.a': { color: '#e0e0e0', background: '#121212' } },
              },
            ],
          },
        },
      },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const rules = stylesOps(ops)[0]!.cssDefs
    expect(rules).toHaveLength(1)
    const rule = String(rules[0])
    expect(rule).toContain('@media (prefers-color-scheme: dark)')
    expect(rule).toContain('{.a{')
    expect(rule).toContain('color:#e0e0e0')
    expect(rule).toContain('background:#121212')
  })

  it('[4] STL-H3 — the SAME rule on TWO nodes emits ONCE (rule-signature dedup across the render)', () => {
    const rule = { selector: '.dup', styles: { color: 'blue' } }
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          css: { cssDef: [rule] },
          children: [{ type: 'kid', css: { cssDef: [rule] } }],
        },
      },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const rules = stylesOps(ops)[0]!.cssDefs
    expect(rules).toHaveLength(1)
  })

  it('[5] STL-H4 — rules come ONLY from actionable states: a cssDef on a token-owned content root contributes NO rule', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', css: { cssDef: [{ selector: '.live', styles: { color: 'red' } }] } },
        children: [{ type: 'hero', css: { cssDef: [{ selector: '.dropped', styles: { color: 'green' } }] } }],
      },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const rules = stylesOps(ops)[0]!.cssDefs
    expect(rules).toHaveLength(1)
    expect(String(rules[0])).toContain('.live{')
    expect(String(rules[0])).not.toContain('.dropped')
  })

  it('[6] STL-F1 — zero-or-one styles op per sweep: two distinct rules on two nodes → ONE op with both', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          css: { cssDef: [{ selector: '.one', styles: { color: 'red' } }] },
          children: [{ type: 'kid', css: { cssDef: [{ selector: '.two', styles: { color: 'blue' } }] } }],
        },
      },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const styles = stylesOps(ops)
    expect(styles).toHaveLength(1)
    expect(styles[0]!.cssDefs).toHaveLength(2)
  })

  it('[7] STL-H5 — a cssDef-less render emits NO styles op (no empty style block)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', children: [{ type: 'kid', content: 'x' }] } },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    expect(stylesOps(ops)).toEqual([])
  })

  it('[8] STL-F2 — the styles op payload carries rule STRINGS, never raw cssDef objects', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', css: { cssDef: [{ selector: '.a', styles: { color: 'red' } }] } },
      },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const styles = stylesOps(ops)
    expect(styles).toHaveLength(1)
    for (const r of styles[0]!.cssDefs) expect(typeof r).toBe('string')
  })
})

describe('D4 — adapter-side rule-string dedup (defensive half)', () => {
  class El {
    tagName: string
    children: El[] = []
    attrs: Record<string, string> = {}
    dataset: Record<string, string> = {}
    style: Record<string, string> = {}
    listeners: Record<string, Array<(e: unknown) => void>> = {}
    textContent = ''
    className = ''
    id = ''
    value = ''
    parent: El | null = null
    removed = false
    constructor(tag: string) {
      this.tagName = tag.toUpperCase()
    }
    appendChild(c: El): El {
      this.children.push(c)
      c.parent = this
      return c
    }
    setAttribute(k: string, v: unknown): void {
      this.attrs[k] = String(v)
    }
    removeAttribute(k: string): void {
      delete this.attrs[k]
    }
    addEventListener(_e: string, _fn: unknown): void {}
    remove(): void {
      this.removed = true
    }
  }
  class Head {
    children: El[] = []
    appendChild(c: El): El {
      this.children.push(c)
      return c
    }
  }

  let doc: { createElement: (tag: string) => El; head: Head }
  let savedDoc: PropertyDescriptor | undefined

  beforeEach(() => {
    doc = { createElement: (tag: string) => new El(tag), head: new Head() }
    savedDoc = Object.getOwnPropertyDescriptor(globalThis, 'document')
    Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true })
  })
  afterEach(() => {
    if (savedDoc) Object.defineProperty(globalThis, 'document', savedDoc)
    else delete (globalThis as Record<string, unknown>).document
  })

  it('[9] DOM-H29 — DomAdapter dedups the SAME rule string across ops (one style element, one entry)', () => {
    const mount = new El('div')
    const adapter = new DomAdapter(mount as unknown as HTMLElement)
    adapter.styles(['.x{a:b}', '.x{a:b}'])
    const styleEls = doc.head.children.filter((c) => c.id === 'preempt-dynamic-styles')
    expect(styleEls).toHaveLength(1)
    expect(styleEls[0]!.textContent).toBe('\n.x{a:b}')
  })

  it('[10] FRG-H27 — SSRFragmentAdapter styles buffer dedups the SAME rule string (per adapter instance)', () => {
    const frag = new SSRFragmentAdapter()
    frag.styles(['.x{a:b}', '.x{a:b}'])
    expect(Array.from(frag.styles)).toEqual(['.x{a:b}'])
    const out = frag.toString()
    expect(out.match(/\.x\{a:b\}/g)).toHaveLength(1)
  })
})

describe('D8 — def-chain emit scoping (DFC-1..3)', () => {
  const linkDef = (children: Array<{ bind: string; type: string; content?: unknown }>) => ({
    type: 'div',
    label: 'lk',
    childOffset: 0,
    children,
  })

  it('[11] DFC-H1 — 1:1 link-method def at offset 0 re-types the covered real children, each keeping its OWN css/props; NO synthetic wires', () => {
    const def = linkDef([
      { bind: 'a', type: 'span', content: 'd.a' },
      { bind: 'b', type: 'span', content: 'd.b' },
    ])
    const states: EmitState[] = [
      { nodeId: 'C', type: 'section', children: ['A', 'B'], bindings: { 'link-1': def } },
    ]
    const nodeById = new Map([
      ['A', { handlers: [], css: { color: 'red' }, props: { x: 1 }, children: [] }],
      ['B', { handlers: [], css: { bg: 'blue' }, props: { y: 2 }, children: [] }],
    ])
    const els = emitElements(states, nodeById)
    const consumer = els.find((e) => e.wire === 'C')!
    expect(consumer.type).toBe('div')
    expect(consumer.childOrder).toEqual(['A', 'B'])
    // no synthetic `${wire}:${bind}` wires — the real children are covered
    for (const el of els) expect(el.wire.includes(':')).toBe(false)
    const reTypedA = els.find((e) => e.wire === 'A')!
    const reTypedB = els.find((e) => e.wire === 'B')!
    expect(reTypedA.type).toBe('span')
    expect(reTypedA.props['css:color']).toBe('red')
    expect(reTypedA.props['prop:x']).toBe(1)
    expect(reTypedB.props['css:bg']).toBe('blue')
    expect(reTypedB.props['prop:y']).toBe(2)
  })

  it('[12] DFC-F1 — MISMATCHED counts (def.children longer): NO re-typing of real wires, NO synthetic wires, no clobber', () => {
    const def = linkDef([
      { bind: 'x', type: 'span', content: 'd.x' },
      { bind: 'y', type: 'b', content: 'd.y' },
    ])
    const states: EmitState[] = [{ nodeId: 'C', type: 'section', children: ['A'], bindings: { 'link-1': def } }]
    const els = emitElements(states)
    const consumer = els.find((e) => e.wire === 'C')!
    // the host emits its OWN children — the def chain never fires
    expect(consumer.type).toBe('section')
    expect(consumer.childOrder).toEqual(['A'])
    // no synthetic wires, no id-less orphans, real child keeps its own type
    const realChild = els.find((e) => e.wire === 'A')
    expect(realChild).toBeDefined()
    expect(realChild!.type).not.toBe('span')
    for (const el of els) expect(el.wire.includes(':')).toBe(false)
  })

  it('[13] DFC-F1b — MISMATCHED counts (def.children shorter): NO drops beyond the covered slice, real wires keep own order', () => {
    const def = linkDef([{ bind: 'x', type: 'span', content: 'd.x' }])
    const states: EmitState[] = [{ nodeId: 'C', type: 'section', children: ['A', 'B'], bindings: { 'link-1': def } }]
    const els = emitElements(states)
    const consumer = els.find((e) => e.wire === 'C')!
    expect(consumer.type).toBe('section')
    expect(consumer.childOrder).toEqual(['A', 'B'])
    const realB = els.find((e) => e.wire === 'B')
    expect(realB).toBeDefined()
    expect(realB!.type).not.toBe('span')
  })

  it('[14] DFC-F2 — a SEAM-TARGET def (target: "children", options.seam planned at translate) NEVER drives an emit-time chain', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [
            // the def provider (value-carrying source) — its def is NOT 1:1
            // with its real children, so no legal link-method chain exists
            {
              type: 'def-host',
              component: {
                reference: 'defA',
                value: {
                  type: 'div',
                  children: [
                    { bind: 'x', type: 'span', content: 'd.x' },
                    { bind: 'y', type: 'b', content: 'd.y' },
                  ],
                },
              },
              children: [
                // the SEAM consumer: target 'children' → planned with
                // options.seam at translate; resolves the def value but emits
                // its OWN type + authored children (no re-typing, no def
                // children by the host)
                {
                  type: 'section',
                  component: { reference: 'defA', target: 'children' },
                  children: [{ type: 'p', content: 'real' }],
                },
              ],
            },
          ],
        },
      },
      content: [],
    })
    const cr = t.root.compile(t.nodes)
    const nodeById = new Map(
      t.nodes.map((n) => [n.id, { handlers: [], children: n.children.map((c) => ({ id: c.id })) }]),
    )
    const els = emitElements(cr.actionable, nodeById)
    const consumer = t.root.children[0]!.children[0]!
    const consumerEl = els.find((e) => e.wire === consumer.id)!
    // own type, own authored children, own child's type — the seam def does
    // not re-type or expand the REAL children (B1 ruling 2026-08-14: a
    // children-target keeps the original node data as-is and ADDS the
    // def-root prototype node as an ADDITIONAL child — the def-root's wire
    // is the seam child `${wire}:0`)
    expect(consumerEl.type).toBe('section')
    const childEl = els.find((e) => e.wire === consumer.children[0]!.id)!
    expect(childEl.type).toBe('p')
    expect(consumerEl.childOrder).toEqual([consumer.children[0]!.id, `${consumer.id}:0`])
    // the def-root element (def type) joins as the extra child; the def's
    // children are NOT emitted as the host's children (no clobber, no
    // re-typing of the real children)
    const defRootEl = els.find((e) => e.wire === `${consumer.id}:0`)!
    expect(defRootEl.type).toBe('div')
    expect(consumerEl.childOrder.filter((w) => w === consumer.children[0]!.id)).toHaveLength(1)
  })

  it('[15] DFC-F1 — a DELIVERABLE-spec def (children WITHOUT bind keys) with a count MISMATCH never drives the chain', () => {
    // the live-prod root-clobber shape: the auth def's 2 deliverable children
    // vs the host's 3 real children — linkChainAllowed today returns true for
    // any non-link-method def, so the chain fires and aliases the first two
    const def = { type: 'div', children: [{ type: 'button', content: 'Sign In' }, { type: 'div' }] }
    const states: EmitState[] = [
      { nodeId: 'C', type: 'section', children: ['A', 'B', 'D'], bindings: { 'auth': def } },
    ]
    const nodeById = new Map([
      ['A', { handlers: [], type: 'span', css: {}, props: {}, children: [] }],
      ['B', { handlers: [], type: 'p', css: {}, props: {}, children: [] }],
      ['D', { handlers: [], type: 'b', css: {}, props: {}, children: [] }],
    ])
    const els = emitElements(states, nodeById)
    const consumer = els.find((e) => e.wire === 'C')!
    // the host emits its OWN type + ALL its real children in their own order
    expect(consumer.type).toBe('section')
    expect(consumer.childOrder).toEqual(['A', 'B', 'D'])
    // no re-typing/aliasing: each real child keeps its OWN type
    expect(els.find((e) => e.wire === 'A')!.type).toBe('span')
    expect(els.find((e) => e.wire === 'B')!.type).toBe('p')
    expect(els.find((e) => e.wire === 'D')).toBeDefined()
    // the def children are NOT emitted by the host — no 'Sign In' text
    // anywhere in the element set
    expect(els.every((e) => e.props['text'] !== 'Sign In')).toBe(true)
    for (const el of els) expect(el.wire.includes(':')).toBe(false)
  })
})

describe('D4/D8 — the styles op flows through applyOps to the SSR adapter', () => {
  it('a styles op with rule strings reaches the SSR adapter styles buffer (rule strings only)', () => {
    const frag = new SSRFragmentAdapter()
    applyOps(frag as never, [{ kind: 'styles', cssDefs: ['.a{color: red;}'] }])
    expect(Array.from(frag.styles)).toEqual(['.a{color: red;}'])
  })

  it('wireKey is the shared composite key the adapters consult (cross-file re-pin)', () => {
    expect(wireKey('w')).toBe('w')
    expect(wireKey('w', 'fk')).toBe('w\x00fk')
  })
})

describe('EMPTY-OWNER — an empty placement container renders display:none (user rule 2026-08-14)', () => {
  // States:
  //  [16] a placement-owner (container anchor) with NO children → css style
  //       gains "display: none" (the modal/sidebar clutter defect)
  //  [17] a placement-owner WITH children → NO display:none
  //  [18] a NON-container node with no children → NO display:none (rule is
  //       scoped to placement owners)
  //  [19] an empty placement-owner with an AUTHORED display → authored display
  //       wins (author intent overrides emptiness)
  //  [20] update path: the container gains a child → the re-render emits the
  //       style WITHOUT display:none (diffMinimal set op removes it)

  function envelope(children: Array<Record<string, unknown>> | undefined) {
    return {
      template: {
        root: {
          type: 'app',
          children: [
            { type: 'div', placement: [{ placementName: 'zone' }], ...(children ? { children } : {}) },
            { type: 'span', content: 'plain' },
          ],
        },
      },
    }
  }

  function renderOnce(env: Record<string, unknown>, adapter: SSRFragmentAdapter) {
    const t = translateLegacy(env as never)
    const supervisor = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) supervisor.registerNode(n)
    const cr = t.root.compile(t.nodes)
    const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n])) as never
    const els = emitElements(cr.actionable, byNode)
    const ops = diffMinimal(null, els)
    applyOps(adapter as never, ops)
    return { els, adapter, supervisor }
  }

  it('[16] an empty placement-owner container renders with display: none', () => {
    const { els } = renderOnce(envelope([]), new SSRFragmentAdapter())
    const container = els.find((e) => e.props['css:classes'] === undefined && e.type === 'div' && e.props['css:style'] !== undefined)
    // the container is the FIRST child div of the root (placement owner)
    const root = els.find((e) => e.type === 'app')
    const contWire = root!.childOrder[0]
    const cont = els.find((e) => e.wire === contWire)!
    expect(String(cont.props['css:style'] ?? '')).toContain('display: none')
  })

  it('[17] a placement-owner WITH children renders without display: none', () => {
    const { els } = renderOnce(envelope([{ type: 'p', content: 'kid' }]), new SSRFragmentAdapter())
    const root = els.find((e) => e.type === 'app')
    const cont = els.find((e) => e.wire === root!.childOrder[0])!
    expect(String(cont.props['css:style'] ?? '')).not.toContain('display: none')
  })

  it('[18] a NON-container node with no children gets NO display: none', () => {
    const { els } = renderOnce(envelope([]), new SSRFragmentAdapter())
    const root = els.find((e) => e.type === 'app')
    const span = els.find((e) => e.wire === root!.childOrder[1])!
    expect(String(span.props['css:style'] ?? '')).not.toContain('display: none')
    expect(span.type).toBe('span')
  })

  it('[19] an empty placement-owner with an authored display keeps it (author wins)', () => {
    const env = {
      template: {
        root: {
          type: 'app',
          children: [
            { type: 'div', css: { style: { display: 'flex' } }, placement: [{ placementName: 'zone' }] },
          ],
        },
      },
    }
    const { els } = renderOnce(env, new SSRFragmentAdapter())
    const root = els.find((e) => e.type === 'app')
    const cont = els.find((e) => e.wire === root!.childOrder[0])!
    const style = String(cont.props['css:style'] ?? '')
    expect(style).toContain('display: flex')
    expect(style).not.toContain('display: none')
  })

  it('[20] the container gains a child → the re-render drops display: none (diff set op)', () => {
    const { els, supervisor } = renderOnce(envelope([]), new SSRFragmentAdapter())
    const root = els.find((e) => e.type === 'app')
    const contWire = root!.childOrder[0]
    const first = els.find((e) => e.wire === contWire)!
    expect(String(first.props['css:style'] ?? '')).toContain('display: none')
    // attach a child to the container (family attach — the attach op's own
    // primitives: familyLinkFor + child anchor), then recompile + re-diff:
    // the empty-owner rule must re-evaluate (no display:none on the set op)
    const cont = supervisor.getNode(contWire!)!
    const kid = new Node({ type: 'p', content: 'kid' } as never)
    supervisor.registerNode(kid)
    const fam = cont.familyLinkFor()!
    kid.addAnchor('child', kid, {}, fam)
    const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n])) as never
    const fresh = cont.compile([cont])
    const next = emitElements(fresh.actionable, byNode)
    const ops = diffMinimal(new Map(els.map((e) => [e.wire, e])), next)
    const setOp = ops.find((o) => o.kind === 'set' && o.wire === contWire && o.name === 'css:style') as
      | { kind: 'set'; value?: unknown }
      | undefined
    expect(setOp).toBeDefined()
    expect(String(setOp!.value ?? '')).not.toContain('display: none')
  })
})

describe('EMPTY-OWNER refinement — hide only containers with NO renderable information (user ruling 2026-08-14)', () => {
  // [21] an empty placement owner WITH TEXT is not hidden (text is renderable)
  // [22] an empty placement owner WITH an authored css.style is not hidden
  //      (inline style is renderable — the path-fork/fork-stress tree leaves)
  // [16] an empty placement owner with NEITHER still hides (the modal case)

  function render(children: Array<Record<string, unknown>> | undefined, extra: Record<string, unknown> | undefined) {
    const env = {
      template: {
        root: {
          type: 'app',
          children: [
            { type: 'div', placement: [{ placementName: 'zone' }], ...(children ? { children } : {}), ...(extra ?? {}) },
          ],
        },
      },
    }
    const t = translateLegacy(env as never)
    const supervisor = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) supervisor.registerNode(n)
    const cr = t.root.compile(t.nodes)
    const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n])) as never
    const els = emitElements(cr.actionable, byNode)
    const root = els.find((e) => e.type === 'app')
    return els.find((e) => e.wire === root!.childOrder[0])!
  }

  it('[21] an empty placement owner WITH text renders WITHOUT display: none', () => {
    const el = render(undefined, { content: 'zone label' })
    expect(String(el.props['text'] ?? '')).toBe('zone label')
    expect(String(el.props['css:style'] ?? '')).not.toContain('display: none')
  })

  it('[22] an empty placement owner WITH an authored css.style renders WITHOUT display: none', () => {
    const el = render(undefined, { css: { style: { background: 'red' } } })
    expect(String(el.props['css:style'] ?? '')).toContain('background: red')
    expect(String(el.props['css:style'] ?? '')).not.toContain('display: none')
  })
})
