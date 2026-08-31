import { describe, it, expect } from 'vitest'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'

// ===========================================================================
// BARE-TEXT-EMIT — a `text` child node renders escaped text with NO wrapper
// element (2026-08-31 gate PROCEED-AS-RESHAPED, docs/specs/bare-text-emit-review.md).
//
// Shape A1: SSR uses an empty open/close + an `isText` flag (childHtml renders
// contentText only); DOM uses a real `Text` node (covered by the DOM-side spec
// tests in body-runs). Interleaving is deterministic via childOrder: a text
// child splices at position among element children. TestWriter red set — written
// BEFORE implementation. Focus: SSR bare-text emit + emit/translate seams.
// ===========================================================================

/** Drive SSRFragmentAdapter directly with a childOrder of (wire,type) in order. */
function ssrOf(kinds: Array<[wire: string, type: string, text: string]>): string {
  const ssr = new SSRFragmentAdapter()
  ssr.createEl('div', 'root')
  for (const [wire, type, text] of kinds) {
    ssr.createEl(type, wire)
    if (text !== '') ssr.setProp(wire, 'text', text)
  }
  for (const [wire] of kinds) ssr.appendChild('root', wire)
  return ssr.fragments.get('root')!.contentText
}

describe('BARE-TEXT-EMIT — SSR bare-text child renders with NO wrapper, in childOrder position', () => {
  it('[text, strong, text] renders A <strong>bold</strong> text (mid-line interleave)', () => {
    const out = ssrOf([
      ['t1', 'text', 'A '],
      ['b1', 'strong', 'bold'],
      ['t2', 'text', ' text'],
    ])
    expect(out).toBe('A <strong>bold</strong> text')
  })

  it('ordering is deterministic via childOrder: [text,strong] != [strong,text]', () => {
    const a = ssrOf([
      ['t1', 'text', 'A '],
      ['b1', 'strong', 'B'],
    ])
    const b = ssrOf([
      ['b1', 'strong', 'B'],
      ['t1', 'text', 'A '],
    ])
    expect(a).toBe('A <strong>B</strong>')
    expect(b).toBe('<strong>B</strong>A ')
    expect(a).not.toBe(b)
  })

  it('a text child escapes its content (no bare < or & in output)', () => {
    const out = ssrOf([['t1', 'text', 'a < b & c > d']])
    expect(out).toBe('a &lt; b &amp; c &gt; d')
  })

  it('an empty text child renders nothing (no wrapper)', () => {
    const out = ssrOf([['t1', 'text', '']])
    expect(out).toBe('')
  })

  it('whitespace in a text child is preserved verbatim', () => {
    // a text child '  ' (not normalized away) beside an element
    const out = ssrOf([
      ['t1', 'text', '  '],
      ['b1', 'strong', 'x'],
    ])
    expect(out).toBe('  <strong>x</strong>')
  })
})

describe('BARE-TEXT-EMIT — emit/translate end-to-end (a text child in a legacy envelope)', () => {
  function translateWithTextChild(): { out: string; warnings: string[] } {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          children: [
            { type: 'text', content: 'A ' },
            { type: 'strong', content: 'bold', props: { id: 'b1' } },
            { type: 'text', content: ' text' },
          ],
        },
      },
      content: [],
      clientConfig: {},
    }
    const t = translateLegacy(doc)
    const states = t.nodes.flatMap((n) => n.compilePath().actionable)
    const els = emitElements(states, new Map(t.nodes.map((n) => [n.id, n])))
    const ssr = new SSRFragmentAdapter()
    for (const e of els) {
      ssr.createEl(e.type, e.wire)
      for (const [k, v] of Object.entries(e.props)) ssr.setProp(e.wire, k, v)
    }
    for (const e of els) for (const c of e.childOrder) ssr.appendChild(e.wire, c)
    const root = ssr.fragments.get('root')
    return { out: root ? root.contentText : '', warnings: [] }
  }

  it('a text child in the template envelope renders bare (no <text> wrapper)', () => {
    const { out } = translateWithTextChild()
    // the strong keeps its authored id="b1"; only the text children drop wrappers/attrs
    expect(out).toBe('A <strong id="b1">bold</strong> text')
  })
})
