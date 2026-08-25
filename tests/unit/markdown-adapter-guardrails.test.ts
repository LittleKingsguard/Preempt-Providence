/**
 * MARKDOWN-ADAPTER GUARDRAILS — the 2026-08-24 adversarial-MD fix pass (TDD).
 * Tests encode the fix contracts for the ADVERSARIAL-MD-S* defects
 * (archive/findings/2026-08-24/2026-08-24-markdown-adversarial-findings.md):
 *   G-S17  a transparent container (div/section) wrapping a list recurses it
 *   G-S1   blockquote recurses its block children (no text loss)
 *   G-S2   heading recurses its block children (no text loss)
 *   G-S3   pre → triple-backtick fenced block; code → inline backtick
 *   G-S4   link title " is escaped
 *   G-S5   empty li renders a bare bullet AND consumes the ol index
 *   G-S6   block child of li indents by 2 (does not break the list)
 *   G-S8   the string-overload appendChild is removed (node-object only)
 */
import { describe, it, expect } from 'vitest'
import { MarkdownAdapter } from '../../src/core/adapters.js'
import { wireKey } from '../../src/core/render-helpers.js'

function fresh() { return new MarkdownAdapter() }

describe('G-S17 — transparent containers recurse lists', () => {
  it('a div wrapping a ul renders the list (not empty)', () => {
    const a = fresh()
    a.createEl('div', 'd')
    a.createEl('ul', 'u')
    a.createEl('li', 'l1'); a.setProp('l1', 'text', 'One')
    a.createEl('li', 'l2'); a.setProp('l2', 'text', 'Two')
    a.appendChild('d', 'u')
    a.appendChild('u', 'l1'); a.appendChild('u', 'l2')
    expect(a.toString()).toBe('- One\n- Two')
  })
})

describe('G-S1 — blockquote recurses block children', () => {
  it('a blockquote with a p child renders the p text with a > prefix', () => {
    const a = fresh()
    a.createEl('blockquote', 'q')
    a.createEl('p', 'p'); a.setProp('p', 'text', 'quote body')
    a.appendChild('q', 'p')
    expect(a.toString()).toBe('> quote body')
  })
})

describe('G-S2 — heading recurses block children', () => {
  it('an h1 with a p child renders both the heading and the body', () => {
    const a = fresh()
    a.createEl('h1', 'h'); a.setProp('h', 'text', 'Title')
    a.createEl('p', 'p'); a.setProp('p', 'text', 'body text')
    a.appendChild('h', 'p')
    expect(a.toString()).toBe('# Title\nbody text')
  })
})

describe('G-S3 — pre is fenced', () => {
  it('pre → triple-backtick fenced block', () => {
    const a = fresh()
    a.createEl('pre', 'p'); a.setProp('p', 'text', 'x = 1')
    expect(a.toString()).toBe('```\nx = 1\n```')
  })
  it('code stays inline backtick', () => {
    const a = fresh()
    a.createEl('code', 'c'); a.setProp('c', 'text', 'x = 1')
    expect(a.toString()).toBe('`x = 1`')
  })
})

describe('G-S4 — link title is escaped', () => {
  it('a title with a double-quote is escaped (no broken (href "…"))', () => {
    const a = fresh()
    a.createEl('a', 'l'); a.setProp('l', 'text', 'Docs'); a.setProp('l', 'prop:href', '/docs'); a.setProp('l', 'prop:title', 'say "hi"')
    expect(a.toString()).toBe('[Docs](/docs "say \\"hi\\"")')
  })
})

describe('G-S5 — empty li renders + consumes the index', () => {
  it('an empty li renders a bare bullet and advances the ol index', () => {
    const a = fresh()
    a.createEl('ol', 'o')
    a.createEl('li', 'a'); a.setProp('a', 'text', 'A')
    a.createEl('li', 'b') // empty
    a.createEl('li', 'c'); a.setProp('c', 'text', 'C')
    a.appendChild('o', 'a'); a.appendChild('o', 'b'); a.appendChild('o', 'c')
    expect(a.toString()).toBe('1. A\n2. \n3. C')
  })
  it('an empty li in a ul renders a bare "- " bullet', () => {
    const a = fresh()
    a.createEl('ul', 'u')
    a.createEl('li', 'a'); a.setProp('a', 'text', 'A')
    a.createEl('li', 'b') // empty
    a.appendChild('u', 'a'); a.appendChild('u', 'b')
    expect(a.toString()).toBe('- A\n- ')
  })
})

describe('G-S6 — block child of li indents', () => {
  it('a p block child of an li indents by 2 (does not break the list)', () => {
    const a = fresh()
    a.createEl('ul', 'u')
    a.createEl('li', 'top'); a.setProp('top', 'text', 'Top')
    a.appendChild('u', 'top')
    a.createEl('p', 'para'); a.setProp('para', 'text', 'para body')
    a.appendChild('top', 'para')
    expect(a.toString()).toBe('- Top\n  para body')
  })
})

describe('G-S8 — the appendChild seam', () => {
  it('fork-arm children MUST be appended by NODE OBJECT, never a bare string (a bare wire resolves to the bare key and drops the arm)', () => {
    const a = fresh()
    a.createEl('ul', 'u')
    a.createEl('li', 'l', 'fk1') // a fork arm of wire 'l'
    a.setProp('l', 'text', 'One', 'fk1')
    // bare-string append of the fork arm attaches NOTHING (the bare key 'l' is
    // not a created node) — the pipeline must pass the NODE OBJECT.
    a.appendChild('u', 'l')
    expect(a.toString()).toBe('')
  })
  it('appending by NODE OBJECT (the pipeline shape) attaches the fork arm', () => {
    const a = fresh()
    a.createEl('ul', 'u')
    const arm = a.createEl('li', 'l', 'fk1')
    a.setProp('l', 'text', 'One', 'fk1')
    a.appendChild(a.fragments.get(wireKey('u'))!, arm)
    expect(a.toString()).toBe('- One')
  })
})
