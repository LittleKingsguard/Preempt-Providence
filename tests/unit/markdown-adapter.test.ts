/**
 * MARKDOWN ADAPTER — Feature 2 (docs/specs/handoffs-review-7.md
 * PROCEED-AS-RESHAPED, 2026-08-24; rulings 12-16 + decisions D1-D15).
 *
 * TDD red set: every test fails before the MarkdownAdapter exists.
 *
 *   M1  headings — h1..h6 → '#' markers (D3)
 *   M2  emphasis — strong/em → ** / * (element type only, D5)
 *   M3  lists — ul→'- ', ol→sibling-index '1. ', 2-space nesting (D4)
 *   M4  links — [text](href), [text](href "title"), bare text w/o href (D6)
 *   M5  on:* + data:* dropped (incl. data:node-id) (D7)
 *   M6  div/span/section/unknown = transparent container (D3)
 *   M7  blockquote/code/pre/hr/br/img markers (D3)
 *   M8  text escaping — content metacharacters escaped, markers unescaped (D9)
 *   M9  removeEl detaches the subtree text (D8); appendChild reorder splices (D8)
 *   M10 empty doc → ''; empty node → nothing (D11)
 *   M11 set-only re-render folds onto the retained tree (D2/D10)
 *   M12 toString is a concrete-family method; hydrate no-op; no styles (D1)
 */
import { describe, it, expect } from 'vitest'
import { MarkdownAdapter } from '../../src/core/adapters.js'
import { wireKey } from '../../src/core/render-helpers.js'

function render(adapter: MarkdownAdapter, ops: { kind: string; wire: string; forkKey?: string; type?: string; name?: string; value?: unknown; owner?: string; child?: string }[]): string {
  for (const op of ops) {
    if (op.kind === 'create') adapter.createEl(op.type!, op.wire, op.forkKey)
    else if (op.kind === 'set') adapter.setProp(op.wire, op.name!, op.value, op.forkKey)
    else if (op.kind === 'append') adapter.appendChild(op.owner!, op.child!)
    else if (op.kind === 'remove') adapter.removeEl(op.wire, op.forkKey)
  }
  return adapter.toString()
}

describe('M1 — headings', () => {
  it('h1..h6 map to #-level markers', () => {
    const a = new MarkdownAdapter()
    a.createEl('h1', 'w1'); a.setProp('w1', 'text', 'Title'); 
    expect(a.toString()).toBe('# Title')
    const b = new MarkdownAdapter()
    b.createEl('h3', 'w3'); b.setProp('w3', 'text', 'Sub'); 
    expect(b.toString()).toBe('### Sub')
    const c = new MarkdownAdapter()
    c.createEl('h6', 'w6'); c.setProp('w6', 'text', 'Deep'); 
    expect(c.toString()).toBe('###### Deep')
  })
})

describe('M2 — emphasis (element type only)', () => {
  it('strong → **text**, em → *text*', () => {
    const a = new MarkdownAdapter()
    a.createEl('strong', 's'); a.setProp('s', 'text', 'bold'); 
    expect(a.toString()).toBe('**bold**')
    const b = new MarkdownAdapter()
    b.createEl('em', 'e'); b.setProp('e', 'text', 'italic'); 
    expect(b.toString()).toBe('*italic*')
  })
  it('css:classes / css:style are DROPPED (never parsed into emphasis)', () => {
    const a = new MarkdownAdapter()
    a.createEl('div', 'd'); a.setProp('d', 'text', 'plain'); a.setProp('d', 'css:style', 'font-weight:bold')
    expect(a.toString()).toBe('plain')
  })
})

describe('M3 — lists', () => {
  it('ul → "- " items, ol → sibling-index "1. "', () => {
    const ul = new MarkdownAdapter()
    ul.createEl('ul', 'u'); ul.createEl('li', 'li1'); ul.createEl('li', 'li2')
    ul.setProp('li1', 'text', 'One'); ul.setProp('li2', 'text', 'Two')
    ul.appendChild('u', 'li1'); ul.appendChild('u', 'li2')
    expect(ul.toString()).toBe('- One\n- Two')
    const ol = new MarkdownAdapter()
    ol.createEl('ol', 'o'); ol.createEl('li', 'a'); ol.createEl('li', 'b')
    ol.setProp('a', 'text', 'A'); ol.setProp('b', 'text', 'B')
    ol.appendChild('o', 'a'); ol.appendChild('o', 'b')
    expect(ol.toString()).toBe('1. A\n2. B')
  })
  it('2-space nesting for a list inside a list item', () => {
    const a = new MarkdownAdapter()
    a.createEl('ul', 'u1'); a.createEl('li', 'top'); a.setProp('top', 'text', 'Top')
    a.appendChild('u1', 'top')
    a.createEl('ul', 'u2'); a.createEl('li', 'sub'); a.setProp('sub', 'text', 'Sub')
    a.appendChild('u2', 'sub'); a.appendChild('top', 'u2')
    expect(a.toString()).toBe('- Top\n  - Sub')
  })
})

describe('M4 — links', () => {
  it('a with href → [text](href)', () => {
    const a = new MarkdownAdapter()
    a.createEl('a', 'link'); a.setProp('link', 'text', 'Docs'); a.setProp('link', 'prop:href', '/docs')
    expect(a.toString()).toBe('[Docs](/docs)')
  })
  it('a with title → [text](href "title")', () => {
    const a = new MarkdownAdapter()
    a.createEl('a', 'link'); a.setProp('link', 'text', 'Docs'); a.setProp('link', 'prop:href', '/docs'); a.setProp('link', 'prop:title', 'Go')
    expect(a.toString()).toBe('[Docs](/docs "Go")')
  })
  it('a WITHOUT href → bare text (never a dangling []() )', () => {
    const a = new MarkdownAdapter()
    a.createEl('a', 'link'); a.setProp('link', 'text', 'Docs')
    expect(a.toString()).toBe('Docs')
  })
})

describe('M5 — handlers + node-id dropped', () => {
  it('on:* and data:* (incl. data:node-id) are dropped', () => {
    const a = new MarkdownAdapter()
    a.createEl('button', 'b'); a.setProp('b', 'text', 'Go'); a.setProp('b', 'on:click', true); a.setProp('b', 'data:node-id', 'node-1')
    expect(a.toString()).toBe('Go')
  })
})

describe('M6 — transparent containers', () => {
  it('div/span/section/article/unknown render their text without markers', () => {
    const a = new MarkdownAdapter()
    a.createEl('div', 'd'); a.setProp('d', 'text', 'Hello')
    expect(a.toString()).toBe('Hello')
    const b = new MarkdownAdapter()
    b.createEl('section', 's'); b.createEl('span', 'span'); b.setProp('span', 'text', 'Inner')
    b.appendChild('s', 'span')
    expect(b.toString()).toBe('Inner')
  })
})

describe('M7 — other block/inline markers', () => {
  it('blockquote → "> ", code/pre → backtick, hr → "---", br → newline, img → ![alt](src)', () => {
    const bq = new MarkdownAdapter(); bq.createEl('blockquote', 'q'); bq.setProp('q', 'text', 'quote'); expect(bq.toString()).toBe('> quote')
    const code = new MarkdownAdapter(); code.createEl('code', 'c'); code.setProp('c', 'text', 'x=1'); expect(code.toString()).toBe('`x=1`')
    const hr = new MarkdownAdapter(); hr.createEl('hr', 'r'); expect(hr.toString()).toBe('---')
    const br = new MarkdownAdapter(); br.createEl('p', 'p'); br.createEl('br', 'br1'); br.createEl('br', 'br2'); br.setProp('p', 'text', 'A')
    br.appendChild('p', 'br1'); br.appendChild('p', 'br2'); expect(br.toString()).toBe('A\n\n')
    const img = new MarkdownAdapter(); img.createEl('img', 'i'); img.setProp('i', 'prop:src', '/x.png'); img.setProp('i', 'prop:alt', 'pic'); expect(img.toString()).toBe('![pic](/x.png)')
  })
})

describe('M8 — text escaping (content metacharacters escaped, markers unescaped)', () => {
  it('a literal # / * / - / [ at line start or inline-pairing is escaped in CONTENT', () => {
    const a = new MarkdownAdapter()
    a.createEl('p', 'p'); a.setProp('p', 'text', '# not a heading')
    expect(a.toString()).toBe('\\# not a heading')
    const b = new MarkdownAdapter()
    b.createEl('p', 'p'); b.setProp('p', 'text', 'a * b and _ c_')
    expect(b.toString()).toBe('a \\* b and \\_ c\\_')
  })
  it('adapter-emitted markers are NOT escaped (the heading # stays)', () => {
    const a = new MarkdownAdapter()
    a.createEl('h1', 'h'); a.setProp('h', 'text', 'Title')
    expect(a.toString()).toBe('# Title')
  })
})

describe('M9 — removeEl + appendChild move semantics', () => {
  it('removeEl removes the subtree text', () => {
    const a = new MarkdownAdapter()
    a.createEl('ul', 'u'); a.createEl('li', 'l1'); a.createEl('li', 'l2')
    a.setProp('l1', 'text', 'One'); a.setProp('l2', 'text', 'Two')
    a.appendChild('u', 'l1'); a.appendChild('u', 'l2')
    a.removeEl('l1')
    expect(a.toString()).toBe('- Two')
  })
  it('appendChild reorder splices by identity (no duplicate text)', () => {
    const a = new MarkdownAdapter()
    a.createEl('ul', 'u'); a.createEl('li', 'l1'); a.createEl('li', 'l2')
    a.setProp('l1', 'text', 'One'); a.setProp('l2', 'text', 'Two')
    a.appendChild('u', 'l1'); a.appendChild('u', 'l2')
    a.appendChild('u', 'l1') // reorder: move l1 to the end
    expect(a.toString()).toBe('- Two\n- One')
  })
})

describe('M10 — empty output', () => {
  it('no creates → ""', () => {
    expect(new MarkdownAdapter().toString()).toBe('')
  })
  it('an empty container → nothing', () => {
    const a = new MarkdownAdapter(); a.createEl('div', 'd')
    expect(a.toString()).toBe('')
  })
})

describe('M11 — set-only re-render folds onto the retained tree', () => {
  it('a set-only update mutates the existing node text (no accumulation)', () => {
    const a = new MarkdownAdapter()
    a.createEl('h1', 'h'); a.setProp('h', 'text', 'Title')
    a.setProp('h', 'text', 'New Title')
    expect(a.toString()).toBe('# New Title')
  })
})

describe('M12 — interface shape', () => {
  it('hydrate is a no-op; no styles method', () => {
    const a = new MarkdownAdapter()
    expect(() => a.hydrate('root', undefined)).not.toThrow()
    expect((a as unknown as { styles?: unknown }).styles).toBeUndefined()
  })
  it('fragments map is the retained tree source', () => {
    const a = new MarkdownAdapter()
    a.createEl('p', 'p'); a.setProp('p', 'text', 'hi')
    expect(a.fragments.has(wireKey('p', undefined))).toBe(true)
  })
})
