/**
 * HOST/U1-ENG — boolean-attribute support in `setProp` (Astrographer handoff,
 * gate docs/specs/handoffs-review-10.md §5.1). TDD red set — written BEFORE
 * implementation.
 *
 * The defect: `checked: false` / `selected: false` route to the generic `else`
 * and `bakeValue(false)` → `'false'`, so `setAttribute('checked','false')`
 * leaves the boolean attribute PRESENT. The fix routes a closed set of boolean
 * attribute names to presence/removal (DOM also reflects the property).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { DomAdapter, SSRFragmentAdapter } from '../../src/core/adapters.js'
import { wireKey } from '../../src/core/render-helpers.js'

// Minimal DOM shim (mirrors the adapters.test.ts El, plus boolean properties so
// the DOM property reflection is observable).
class El {
  tagName: string
  children: El[] = []
  attrs: Record<string, string> = {}
  dataset: Record<string, string> = {}
  style: Record<string, string> = { cssText: '' }
  checked = false
  selected = false
  disabled = false
  textContent = ''
  className = ''
  id = ''
  private _value = ''
  get value(): string {
    return this._value
  }
  set value(v: string) {
    this._value = v
  }
  parent: El | null = null
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
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null
  }
  hasAttribute(k: string): boolean {
    return Object.prototype.hasOwnProperty.call(this.attrs, k)
  }
  removeAttribute(k: string): void {
    delete this.attrs[k]
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  querySelector(): El | null {
    return null
  }
}

let savedDocument: unknown
function installDom(): void {
  const doc = {
    createElement: (tag: string) => new El(tag),
    getElementById: () => new El('div'),
    head: { appendChild: () => undefined },
  }
  savedDocument = (globalThis as Record<string, unknown>).document
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true })
}
function uninstallDom(): void {
  if (savedDocument) Object.defineProperty(globalThis, 'document', { value: savedDocument, configurable: true, writable: true })
  else delete (globalThis as Record<string, unknown>).document
}

function domEl(adapter: DomAdapter, w: string): El {
  return adapter.wires.get(wireKey(w)) as unknown as El
}

describe('HOST/U1-ENG — boolean attributes (DomAdapter)', () => {
  let adapter: DomAdapter
  beforeEach(() => {
    installDom()
    adapter = new DomAdapter(new El('div') as unknown as HTMLElement)
  })
  afterEach(() => uninstallDom())

  it('checked:false → attribute ABSENT + property false; checked:true → present + property true', () => {
    adapter.createEl('input', 'w')
    adapter.setProp('w', 'prop:checked', false)
    expect(domEl(adapter, 'w').checked).toBe(false)
    expect(domEl(adapter, 'w').hasAttribute('checked')).toBe(false)

    adapter.setProp('w', 'prop:checked', true)
    expect(domEl(adapter, 'w').checked).toBe(true)
    expect(domEl(adapter, 'w').hasAttribute('checked')).toBe(true)
    // never the broken "false" string form
    expect(domEl(adapter, 'w').getAttribute('checked')).not.toBe('false')
  })

  it("checked:'false' (string) is treated as false", () => {
    adapter.createEl('input', 'w')
    adapter.setProp('w', 'prop:checked', 'false')
    expect(domEl(adapter, 'w').checked).toBe(false)
    expect(domEl(adapter, 'w').hasAttribute('checked')).toBe(false)
  })

  it('selected / disabled on form elements', () => {
    adapter.createEl('option', 'o')
    adapter.setProp('o', 'prop:selected', false)
    expect(domEl(adapter, 'o').selected).toBe(false)
    expect(domEl(adapter, 'o').hasAttribute('selected')).toBe(false)
    adapter.setProp('o', 'prop:selected', true)
    expect(domEl(adapter, 'o').selected).toBe(true)

    adapter.createEl('button', 'b')
    adapter.setProp('b', 'prop:disabled', true)
    expect(domEl(adapter, 'b').disabled).toBe(true)
    expect(domEl(adapter, 'b').hasAttribute('disabled')).toBe(true)
    adapter.setProp('b', 'prop:disabled', false)
    expect(domEl(adapter, 'b').disabled).toBe(false)
    expect(domEl(adapter, 'b').hasAttribute('disabled')).toBe(false)
  })

  it('non-boolean prop value:false is unchanged (string "false" attribute)', () => {
    adapter.createEl('div', 'd')
    adapter.setProp('d', 'prop:title', false)
    expect(domEl(adapter, 'd').getAttribute('title')).toBe('false')
  })
})

describe('HOST/U1-ENG — boolean attributes (SSRFragmentAdapter)', () => {
  it('false omits the attribute; true emits it; never ="false"', () => {
    const ssr = new SSRFragmentAdapter()
    ssr.createEl('input', 'w')
    ssr.setProp('w', 'prop:checked', false)
    expect(ssr.fragments.get('w')!.openTag).not.toContain('checked')

    ssr.setProp('w', 'prop:checked', true)
    expect(ssr.fragments.get('w')!.openTag).toContain('checked')
    expect(ssr.fragments.get('w')!.openTag).not.toContain('checked="false"')

    ssr.setProp('w', 'prop:checked', 'false')
    expect(ssr.fragments.get('w')!.openTag).not.toContain('checked')
  })
})
