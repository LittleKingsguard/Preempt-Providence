import { describe, it, expect, beforeEach, afterEach } from 'vitest'
// Target modules — DO NOT EXIST YET (TDD red state). TestWriter write-only pass.
import {
  DomAdapter,
  SSRFragmentAdapter,
  VOID_TAGS,
} from '../../src/core/adapters.js'
import {
  minimalFromState,
  emitElements,
  applyOps,
  treeFromOps,
  treeSig,
  jsonClone,
  wireKey,
} from '../../src/core/render-helpers.js'
import type { RenderTree } from '../../src/core/render-helpers.js'
import { MockAdapter, diffMinimal, type RenderOp } from '../../src/core/render.js'
import { Node } from '../../src/core/node.js'
import { makeRoot, makeNode, childOf, addComponentSource, targetAnchor } from '../helpers/fixtures.js'

// ---------------------------------------------------------------------------
// DOM shim (SDED: replicate demo-smoke.mjs's El and extend it): a satisfiable
// document.head that records appended children, removeAttribute, style.cssText,
// and a manual listener-invocation helper. See docs/specs/adapters.md §9.
// ---------------------------------------------------------------------------
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
  private _value = ''
  get value(): string {
    return this._value
  }
  set value(v: string) {
    this._value = v
  }
  parent: El | null = null
  removed = false
  constructor(tag: string) {
    this.tagName = tag.toUpperCase()
  }
  appendChild(c: El): El {
    const i = this.children.indexOf(c)
    if (i !== -1) this.children.splice(i, 1)
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
  removeAttribute(k: string): void {
    delete this.attrs[k]
  }
  addEventListener(evt: string, fn: (e: unknown) => void): void {
    ;(this.listeners[evt] ??= []).push(fn)
  }
  removeEventListener(evt: string, fn: (e: unknown) => void): void {
    const arr = this.listeners[evt]
    if (arr) {
      const i = arr.indexOf(fn)
      if (i !== -1) arr.splice(i, 1)
    }
  }
  remove(): void {
    this.removed = true
    if (this.parent) {
      const i = this.parent.children.indexOf(this)
      if (i !== -1) this.parent.children.splice(i, 1)
      this.parent = null
    }
  }
  querySelector(_sel: string): El | null {
    return null
  }
  dispatch(evt: string, domEvent: unknown = {}): void {
    for (const fn of this.listeners[evt] ?? []) fn(domEvent)
  }
}

class Head {
  children: El[] = []
  appendChild(c: El): El {
    this.children.push(c)
    return c
  }
}

class Mount extends El {
  querySelectorAll: El[] = []
  querySelector(sel: string): El | null {
    const m = /^\[id="([^"]+)"\]$/.exec(sel)
    if (m) return this.querySelectorAll.find((e) => e.id === m[1]) ?? null
    return null
  }
}

let doc: {
  createElement: (tag: string) => El
  getElementById: (id: string) => El
  head: Head
}
let savedDocument: unknown
let savedGlobalDocument: PropertyDescriptor | undefined

function installDom(): void {
  doc = {
    createElement: (tag: string) => new El(tag),
    getElementById: () => new El('div'),
    head: new Head(),
  }
  savedGlobalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true })
}

function uninstallDom(): void {
  if (savedGlobalDocument) Object.defineProperty(globalThis, 'document', savedGlobalDocument)
  else delete (globalThis as Record<string, unknown>).document
}

function makeMount(): Mount {
  const m = new Mount('div')
  m.id = 'mount'
  return m
}

function elOf(adapter: DomAdapter, w: string, fk?: string): El | undefined {
  return adapter.wires.get(wireKey(w, fk)) as El | undefined
}

function mountEl(m: Mount): HTMLElement {
  return m as unknown as HTMLElement
}

// ---------------------------------------------------------------------------
// TypeScript lib gate (TYP-*): see docs/specs/adapters.md §10.5. TYP-F1 is NOT
// a unit test (it is a one-time build/CI gate). TYP-H1 is ensured structurally by
// the file compiling under tsc with lib ["ES2022","DOM"], exercised by
// npm run typecheck when adapters.ts exists. No runtime assert needed.
// ---------------------------------------------------------------------------

describe('HLP-* render helpers (adapter-neutral)', () => {
  beforeEach(() => {
    installDom()
  })
  afterEach(() => {
    uninstallDom()
  })

  describe('minimalFromState (HLP-H1..H3, H13)', () => {
    it('HLP-H1 maps props→prop:* css→css:* content→text childOrder (excluding cssDef)', () => {
      const out = minimalFromState({
        nodeId: 'n',
        type: 'div',
        props: { a: 1 },
        css: { id: 'k', classes: ['x'], style: 'color:red', cssDef: '.x{}' },
        content: 'hi',
        children: ['c1'],
      })
      expect(out.wire).toBe('n')
      expect(out.type).toBe('div')
      expect(out.props['prop:a']).toBe(1)
      expect(out.props['css:id']).toBe('k')
      expect(out.props['text']).toBe('hi')
      expect(out.childOrder).toEqual(['c1'])
      expect(Object.keys(out.props)).not.toContain('css:cssDef')
    })
    it('HLP-H2 content undefined → no text prop', () => {
      const out = minimalFromState({ nodeId: 'n', type: 'div' })
      expect(out.props['text']).toBeUndefined()
    })
    it('HLP-H3 no css → no css:* props', () => {
      const out = minimalFromState({ nodeId: 'n', type: 'div', props: { a: 1 } })
      expect(Object.keys(out.props).some((k) => k.startsWith('css:'))).toBe(false)
    })
    it('HLP-H13 css.cssDef present → not mapped to a set prop', () => {
      const out = minimalFromState({ nodeId: 'n', type: 'div', css: { cssDef: '.x{}' } })
      expect(Object.keys(out.props)).not.toContain('css:cssDef')
    })
  })

  describe('applyOps (HLP-H4..H7, HLP-F1)', () => {
    it('HLP-H4 full batch drives adapter calls in op order and forwards forkKey', () => {
      const a = new MockAdapter()
      const ops: RenderOp[] = [
        { kind: 'create', wire: 'root', type: 'div', forkKey: 'root' },
        { kind: 'create', wire: 'w', type: 'span', forkKey: 'fk' },
        { kind: 'set', wire: 'w', name: 'text', value: 'hi', forkKey: 'fk' },
        { kind: 'append', owner: 'root', child: 'w' },
      ]
      applyOps(a, ops)
      expect(a.calls.some((o) => o.kind === 'create' && o.type === 'span')).toBe(true)
    })

    it('HLP-H5 append/remove from a previous batch resolves via the persistent wires map', () => {
      const mount = makeMount()
      const a = new DomAdapter(mountEl(mount))
      applyOps(a, [{ kind: 'create', wire: 'owner', type: 'div' }])
      applyOps(a, [{ kind: 'create', wire: 'child', type: 'span' }])
      applyOps(a, [{ kind: 'append', owner: 'owner', child: 'child' }])
      expect(elOf(a, 'owner')!.children.map((c) => c.tagName)).toContain('SPAN')
    })

    it('HLP-H6 append where wire in neither batch nor wires map → skipped silently', () => {
      const a = new MockAdapter()
      const before = a.calls.length
      applyOps(a, [{ kind: 'append', owner: 'ghost', child: 'ghost2' }])
      expect(a.calls.length).toBe(before)
    })

    it('HLP-H7 styles op invokes adapter.styles?.() when exposed; skipped otherwise', () => {
      const mount = makeMount()
      const a = new DomAdapter(mountEl(mount))
      applyOps(a, [{ kind: 'styles', cssDefs: ['.a{}'] }])
      const styleEl = doc.head.children[0]
      expect(styleEl?.tagName).toBe('STYLE')
      expect(styleEl?.id).toBe('preempt-dynamic-styles')
    })
  })

  describe('treeFromOps / treeSig (HLP-H8..H12, H14, HLP-F2)', () => {
    it('HLP-H8 folds set ops onto props and builds children from append edges', () => {
      const ops: RenderOp[] = [
        { kind: 'create', wire: 'r', type: 'div' },
        { kind: 'set', wire: 'r', name: 'prop:title', value: 't' },
        { kind: 'create', wire: 'c', type: 'span' },
        { kind: 'append', owner: 'r', child: 'c' },
      ]
      const trees = treeFromOps(ops)
      expect(trees).toHaveLength(1)
      expect(trees[0]!.type).toBe('div')
      expect(trees[0]!.props['prop:title']).toBe('t')
      expect(trees[0]!.children).toHaveLength(1)
    })
    it('HLP-H9 skip option excludes matching names', () => {
      const ops: RenderOp[] = [
        { kind: 'create', wire: 'r', type: 'div' },
        { kind: 'set', wire: 'r', name: 'on:click', value: '{}' },
      ]
      const trees = treeFromOps(ops, { skip: (n) => n.startsWith('on:') })
      expect(Object.keys(trees[0]!.props)).not.toContain('on:click')
    })
    it('HLP-H10 treeSig sorted-key canonical signature stable under set-op order', () => {
      const a: RenderTree = { wire: 'r', type: 'div', props: { a: '1', z: '2' }, children: [] }
      const b: RenderTree = { wire: 'r', type: 'div', props: { z: '2', a: '1' }, children: [] }
      expect(treeSig([a])).toBe(treeSig([b]))
    })
    it('HLP-H11 jsonClone deep-clones', () => {
      const src = { a: { b: [1, 2] } }
      const out = jsonClone(src)
      expect(out).toEqual(src)
      expect(out).not.toBe(src)
    })
    it('HLP-H12 set whose create appears later still folds (order-independent)', () => {
      const ops: RenderOp[] = [
        { kind: 'set', wire: 'r', name: 'prop:title', value: 'late' },
        { kind: 'create', wire: 'r', type: 'div' },
      ]
      const trees = treeFromOps(ops)
      expect(trees[0]!.props['prop:title']).toBe('late')
    })
    it('HLP-H14 forked stream keeps two distinct entries keyed by wireKey', () => {
      const ops: RenderOp[] = [
        { kind: 'create', wire: 'w', type: 'div', forkKey: 'fk1' },
        { kind: 'create', wire: 'w', type: 'div', forkKey: 'fk2' },
      ]
      const trees = treeFromOps(ops)
      expect(trees).toHaveLength(2)
    })
    it('HLP-F2 styles op ignored by treeFromOps', () => {
      const trees = treeFromOps([{ kind: 'styles', cssDefs: ['.x{}'] }])
      expect(trees).toHaveLength(0)
    })
  })

  describe('wireKey (HLP-H15)', () => {
    it('HLP-H15 composite key: bare wire, or wire + \\x00 + forkKey', () => {
      expect(wireKey('w')).toBe('w')
      expect(wireKey('w', 'fk')).toBe('w\x00fk')
    })
    it('HLP-H16 a compiled fork (Node.compile → minimalFromState → diffMinimal) emits ops with distinct forkKeys', () => {
      const root = makeRoot({ type: 'app' })
      const leaf = childOf(root, makeNode({ type: 'leaf' }))
      targetAnchor(leaf, 'feed')
      // two provider NODES under the consumer (legitimate multiplicity,
      // §10.ab #4; same-node same-name sources are the guarded anti-pattern)
      const fA = childOf(leaf, makeNode({ type: 'fA' }))
      const fB = childOf(leaf, makeNode({ type: 'fB' }))
      addComponentSource(fA, 'feed', { label: 'A' })
      addComponentSource(fB, 'feed', { label: 'B' })
      const cr = root.compile([root, leaf, fA, fB])
      const arms = cr.actionable.filter((s) => s.nodeId === leaf.id)
      expect(arms).toHaveLength(2)
      expect(new Set(arms.map((a) => a.forkKey)).size).toBe(2)
      const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
      const creates = ops.filter(
        (o): o is Extract<RenderOp, { kind: 'create' }> => o.kind === 'create' && o.wire === leaf.id,
      )
      expect(creates).toHaveLength(2)
      // both arms forward a forkKey, and the two keys are distinct (S-R3.10)
      expect(creates.every((o) => o.forkKey !== undefined)).toBe(true)
      expect(new Set(creates.map((o) => o.forkKey)).size).toBe(2)
      // set ops for each arm carry the same forkKey as its create (arm-targeted)
      for (const create of creates) {
        const armSets = ops.filter(
          (o) => o.kind === 'set' && o.wire === leaf.id && o.forkKey === create.forkKey,
        )
        expect(armSets.length).toBeGreaterThan(0)
      }
    })
  })
})

describe('DOM-* DomAdapter', () => {
  let mount: Mount
  let adapter: DomAdapter

  beforeEach(() => {
    installDom()
    mount = makeMount()
    adapter = new DomAdapter(mountEl(mount))
  })
  afterEach(() => {
    uninstallDom()
  })

  describe('createEl (DOM-H1, H26, F4, F3-not-applicable)', () => {
    it('DOM-H1 createEl creates element, sets dataset.wire, appends to mount', () => {
      const el = adapter.createEl('div', 'w1')
      expect(el.tagName).toBe('DIV')
      expect(el.dataset.wire).toBe('w1')
      expect(elOf(adapter, 'w1')).toBe(el)
      expect(mount.children).toContain(el)
    })
    it('DOM-H26 two creates same wire, distinct forkKeys → both mounted, distinct entries', () => {
      const e1 = adapter.createEl('div', 'w', 'fk1')
      const e2 = adapter.createEl('div', 'w', 'fk2')
      expect(e1).not.toBe(e2)
      expect(elOf(adapter, 'w', 'fk1')).toBe(e1)
      expect(elOf(adapter, 'w', 'fk2')).toBe(e2)
      expect(mount.children).toContain(e1)
      expect(mount.children).toContain(e2)
    })
    it('DOM-F4 createEl twice same (wire, forkKey) → last write wins, prior stays mounted', () => {
      const e1 = adapter.createEl('div', 'w')
      const e2 = adapter.createEl('div', 'w')
      expect(elOf(adapter, 'w')).toBe(e2)
      expect(mount.children).toContain(e1)
      expect(mount.children).toContain(e2)
    })
    it('VOID_TAGS exported set is non-empty', () => {
      expect(VOID_TAGS.has('br')).toBe(true)
    })
  })

  describe('setProp text branch (DOM-H2..H7)', () => {
    it('DOM-H2 text on div → textContent', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'text', 'hi')
      expect(elOf(adapter, 'w')!.textContent).toBe('hi')
    })
    it('DOM-NP5 text OBJECT value → JSON string (never "[object Object]")', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'text', { a: 1, b: 'x' })
      expect(elOf(adapter, 'w')!.textContent).toBe('{"a":1,"b":"x"}')
      expect(elOf(adapter, 'w')!.textContent).not.toContain('[object Object]')
    })
    it('DOM-H3 text on TEXTAREA → value, node identity preserved', () => {
      const el = adapter.createEl('textarea', 'w') as unknown as El
      adapter.setProp('w', 'text', 'hi')
      expect(el.value).toBe('hi')
      expect(elOf(adapter, 'w')).toBe(el)
    })
    it('DOM-H4 text on INPUT → value', () => {
      adapter.createEl('input', 'w')
      adapter.setProp('w', 'text', 'v')
      expect(elOf(adapter, 'w')!.value).toBe('v')
    })
    it('DOM-H5 text on SELECT → value', () => {
      adapter.createEl('select', 'w')
      adapter.setProp('w', 'text', 'v')
      expect(elOf(adapter, 'w')!.value).toBe('v')
    })
    it('DOM-H6 text non-string coerced', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'text', 42)
      expect(elOf(adapter, 'w')!.textContent).toBe('42')
    })
    it('DOM-H7 same-value text on form skips the write (focus-safe)', () => {
      const el = adapter.createEl('input', 'w')
      let calls = 0
      const orig = Object.getOwnPropertyDescriptor(El.prototype, 'value')!
      Object.defineProperty(el, 'value', {
        get: () => 'same',
        set: () => {
          calls += 1
        },
      })
      adapter.setProp('w', 'text', 'same')
      expect(calls).toBe(0)
      Object.defineProperty(El.prototype, 'value', orig)
    })
  })

  describe('setProp css branch (DOM-H8..H14)', () => {
    it('DOM-H8 css:id → el.id', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:id', 'k')
      expect(elOf(adapter, 'w')!.id).toBe('k')
    })
    it('DOM-H9 css:classes array → joined className', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:classes', ['a', 'b'])
      expect(elOf(adapter, 'w')!.className).toBe('a b')
    })
    it('DOM-H10 css:classes string → className', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:classes', 'x')
      expect(elOf(adapter, 'w')!.className).toBe('x')
    })
    it('DOM-H11 css:style → style.cssText', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:style', 'color:red')
      expect(elOf(adapter, 'w')!.style['cssText']).toBe('color:red')
    })
    it('DOM-H12 styles() op creates exactly one #preempt-dynamic-styles in head', () => {
      applyOps(adapter, [{ kind: 'styles', cssDefs: ['.x{}'] }])
      const stylesEls = doc.head.children.filter((e) => e.id === 'preempt-dynamic-styles')
      expect(stylesEls).toHaveLength(1)
      expect(stylesEls[0]!.textContent).toBe('\n.x{}')
    })
    it('DOM-H13 multiple styles ops → single element, defs appended in order', () => {
      applyOps(adapter, [{ kind: 'styles', cssDefs: ['.a{}', '.b{}'] }])
      const stylesEls = doc.head.children.filter((e) => e.id === 'preempt-dynamic-styles')
      expect(stylesEls).toHaveLength(1)
      expect(stylesEls[0]!.textContent).toBe('\n.a{}\n.b{}')
    })
    it('DOM-H14 css:<other> unknown sub-name → setAttribute', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:data-x', 'v')
      expect(elOf(adapter, 'w')!.getAttribute('data-x')).toBe('v')
    })
  })

  describe('on: bindings (DOM-H15, H16, F5-flip, F6..F12 — retained-handler-map)', () => {
    it('DOM-H15 on:click with onEvent injects and dispatches (wire, domEvent)', () => {
      const received: Array<[string, unknown]> = []
      adapter = new DomAdapter(mountEl(mount), {
        onEvent: (wire, ev) => received.push([wire, ev]),
      })
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      const domEvent = { type: 'click' }
      elOf(adapter, 'w')!.dispatch('click', domEvent)
      expect(received).toEqual([['w', domEvent]])
    })
    it('DOM-H16 on:click without onEvent does not throw, no callback', () => {
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      expect(() => elOf(adapter, 'w')!.dispatch('click', {})).not.toThrow()
    })
    it('DOM-F5 two sets on same on:click → ONE listener (REPLACE semantics, the retained map)', () => {
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', 'a')
      adapter.setProp('w', 'on:click', 'b')
      const el = elOf(adapter, 'w')!
      expect(el.listeners['click']).toHaveLength(1)
      let calls = 0
      el.dispatch('click', {})
    })
    it('DOM-F6 on:click set then undefined → listener REMOVED; dispatch no longer fires', () => {
      const received: unknown[] = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (_w, ev) => received.push(ev) })
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      elOf(adapter, 'w')!.dispatch('click', { n: 1 })
      expect(received).toHaveLength(1)
      adapter.setProp('w', 'on:click', undefined)
      expect(elOf(adapter, 'w')!.listeners['click'] ?? []).toHaveLength(0)
      elOf(adapter, 'w')!.dispatch('click', { n: 2 })
      expect(received).toHaveLength(1) // the second dispatch did not fire
    })
    it('DOM-F6b re-set after undefined rebinds (single listener again)', () => {
      const received: unknown[] = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (_w, ev) => received.push(ev) })
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      adapter.setProp('w', 'on:click', undefined)
      adapter.setProp('w', 'on:click', '{}')
      expect(elOf(adapter, 'w')!.listeners['click']).toHaveLength(1)
      elOf(adapter, 'w')!.dispatch('click', {})
      expect(received).toHaveLength(1)
    })
    it('DOM-F7 removeEl purges the retained listener (old element stops firing)', () => {
      const received: unknown[] = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (_w, ev) => received.push(ev) })
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      const el = elOf(adapter, 'w')!
      adapter.removeEl('w')
      expect(el.removed).toBe(true)
      expect((el.listeners['click'] ?? []).length).toBe(0)
      el.dispatch('click', {})
      expect(received).toHaveLength(0)
    })
    it('DOM-F8 duplicate createEl purges the OLD (still-mounted) element listener', () => {
      const received: unknown[] = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (_w, ev) => received.push(ev) })
      const e1 = adapter.createEl('button', 'w') as unknown as El
      adapter.setProp('w', 'on:click', '{}')
      const e2 = adapter.createEl('button', 'w') as unknown as El
      expect(elOf(adapter, 'w')).toBe(e2)
      expect(mount.children).toContain(e1) // DOM-F4: the old stays mounted
      expect((e1.listeners['click'] ?? []).length).toBe(0) // its listener is gone
      e1.dispatch('click', {})
      expect(received).toHaveLength(0)
    })
    it('DOM-F9 multiple on:<event> per node are independent (removing one keeps the other)', () => {
      const received: Array<[string, unknown]> = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (w, ev) => received.push([w, ev]) })
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      adapter.setProp('w', 'on:focus', '{}')
      adapter.setProp('w', 'on:click', undefined)
      expect((elOf(adapter, 'w')!.listeners['click'] ?? []).length).toBe(0)
      expect((elOf(adapter, 'w')!.listeners['focus'] ?? []).length).toBe(1)
      elOf(adapter, 'w')!.dispatch('focus', { f: 1 })
      expect(received).toEqual([['w', { f: 1 }]])
    })
    it('DOM-F10 forkKey arms keep independent listener state', () => {
      const received: Array<[string, unknown]> = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (w, ev) => received.push([w, ev]) })
      adapter.createEl('button', 'w', 'fk1')
      adapter.createEl('button', 'w', 'fk2')
      adapter.setProp('w', 'on:click', '{}', 'fk1')
      adapter.setProp('w', 'on:click', '{}', 'fk2')
      adapter.setProp('w', 'on:click', undefined, 'fk1')
      expect((elOf(adapter, 'w', 'fk1')!.listeners['click'] ?? []).length).toBe(0)
      expect((elOf(adapter, 'w', 'fk2')!.listeners['click'] ?? []).length).toBe(1)
      elOf(adapter, 'w', 'fk2')!.dispatch('click', { k: 'fk2' })
      expect(received).toEqual([['w', { k: 'fk2' }]])
    })
    it('DOM-F11 re-entrant self-removal during dispatch does not throw (live-array skip semantics)', () => {
      adapter = new DomAdapter(mountEl(mount), {
        onEvent: () => adapter.setProp('w', 'on:click', undefined),
      })
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      expect(() => elOf(adapter, 'w')!.dispatch('click', {})).not.toThrow()
      expect((elOf(adapter, 'w')!.listeners['click'] ?? []).length).toBe(0)
    })
    it('DOM-F12 SSR double-slot: a raw onclick attr COEXISTS with the listener (native attr inert)', () => {
      const received: unknown[] = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (_w, ev) => received.push(ev) })
      adapter.createEl('button', 'w')
      elOf(adapter, 'w')!.setAttribute('onclick', 'true') // what SSR inlines (FRG-H18b)
      adapter.setProp('w', 'on:click', '{}')
      elOf(adapter, 'w')!.dispatch('click', {})
      expect(received).toHaveLength(1) // only the addEventListener slot fires
      expect(elOf(adapter, 'w')!.getAttribute('onclick')).toBe('true') // attr still there
      adapter.setProp('w', 'on:click', undefined)
      elOf(adapter, 'w')!.dispatch('click', {})
      expect(received).toHaveLength(1) // listener slot dropped; attr alone fires nothing
    })
    it('DOM-F12b reused (hydrated css.id) element binds on: via the normal wires path', () => {
      const received: unknown[] = []
      adapter = new DomAdapter(mountEl(mount), { onEvent: (_w, ev) => received.push(ev) })
      mount.querySelectorAll = [Object.assign(new El('div'), { id: 'a' })]
      adapter.hydrate('root', { template: { css: { id: 'a' } }, content: [] })
      expect(adapter.reused.has('a')).toBe(true)
      adapter.createEl('button', 'w')
      adapter.setProp('w', 'on:click', '{}')
      elOf(adapter, 'w')!.dispatch('click', {})
      expect(received).toHaveLength(1)
    })
  })

  describe('prop:/bare setProp (DOM-H17..H21)', () => {
    it('DOM-H17 bare name setAttribute', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'hidden', true)
      expect(elOf(adapter, 'w')!.getAttribute('hidden')).toBe('true')
    })
    it('DOM-NP5 bare-prop OBJECT value → JSON attribute (never "[object Object]")', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'data-payload', { k: 'v', n: 3 })
      expect(elOf(adapter, 'w')!.getAttribute('data-payload')).toBe('{"k":"v","n":3}')
      expect(elOf(adapter, 'w')!.getAttribute('data-payload')).not.toContain('[object Object]')
    })
    it('DOM-N3 bare-prop NULL value → the JSON string "null" (OTGE-consistent present-null bake)', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'data-nullsig', null)
      expect(elOf(adapter, 'w')!.getAttribute('data-nullsig')).toBe('null')
    })
    it('DOM-H18 prop:title → setAttribute title', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'prop:title', 't')
      expect(elOf(adapter, 'w')!.getAttribute('title')).toBe('t')
    })
    it('DOM-H19 prop:value on INPUT → property', () => {
      adapter.createEl('input', 'w')
      adapter.setProp('w', 'prop:value', 'v')
      expect(elOf(adapter, 'w')!.value).toBe('v')
    })
    it('DOM-H20 prop:value on TEXTAREA → property', () => {
      adapter.createEl('textarea', 'w')
      adapter.setProp('w', 'prop:value', 'v')
      expect(elOf(adapter, 'w')!.value).toBe('v')
    })
    it('DOM-H21 prop:value on div and SELECT → setAttribute', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'prop:value', 'v')
      expect(elOf(adapter, 'w')!.getAttribute('value')).toBe('v')
    })
  })

  describe('setProp forkKey targeting (DOM-H27)', () => {
    it('DOM-H27 set with forkKey targets only that arm', () => {
      adapter.createEl('div', 'w', 'fk1')
      adapter.createEl('div', 'w', 'fk2')
      adapter.setProp('w', 'prop:title', 'first', 'fk1')
      expect(elOf(adapter, 'w', 'fk1')!.getAttribute('title')).toBe('first')
      expect(elOf(adapter, 'w', 'fk2')!.getAttribute('title')).toBeNull()
    })
  })

  describe('undefined-valued set drops (DOM-H28)', () => {
    it('DOM-H28 prop:title undefined → removeAttribute; re-set works', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'prop:title', 'a')
      adapter.setProp('w', 'prop:title', undefined)
      expect(elOf(adapter, 'w')!.getAttribute('title')).toBeNull()
      adapter.setProp('w', 'prop:title', 'b')
      expect(elOf(adapter, 'w')!.getAttribute('title')).toBe('b')
    })
    it('DOM-H28 css:id undefined → empty id', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:id', 'k')
      adapter.setProp('w', 'css:id', undefined)
      expect(elOf(adapter, 'w')!.id).toBe('')
    })
    it('DOM-H28 css:style undefined → empty cssText', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:style', 'color:red')
      adapter.setProp('w', 'css:style', undefined)
      expect(elOf(adapter, 'w')!.style['cssText']).toBe('')
    })
    it('DOM-H28 text undefined → empty on div and form', () => {
      adapter.createEl('div', 'wd')
      adapter.setProp('wd', 'text', 'hi')
      adapter.setProp('wd', 'text', undefined)
      expect(elOf(adapter, 'wd')!.textContent).toBe('')
    })
  })

  describe('appendChild / removeEl / missing-wire (DOM-H22, H23, F1, F3)', () => {
    it('DOM-H22 appendChild re-append relocates', () => {
      adapter.createEl('div', 'p')
      const c1 = adapter.createEl('span', 'c1')
      const c2 = adapter.createEl('span', 'c2')
      mount.appendChild(c1 as unknown as El)
      adapter.appendChild(elOf(adapter, 'p')! as unknown as HTMLElement, c1 as unknown as HTMLElement)
      adapter.appendChild(elOf(adapter, 'p')! as unknown as HTMLElement, c2 as unknown as HTMLElement)
      adapter.appendChild(elOf(adapter, 'p')! as unknown as HTMLElement, c1 as unknown as HTMLElement)
      expect(elOf(adapter, 'p')!.children.map((c) => c.tagName)).toEqual(['SPAN', 'SPAN'])
    })
    it('DOM-H23 removeEl removes and drops from wires', () => {
      adapter.createEl('div', 'w')
      const el = elOf(adapter, 'w')!
      adapter.removeEl('w')
      expect(el.removed).toBe(true)
      expect(adapter.wires.has('w')).toBe(false)
    })
    it('DOM-F1 setProp unknown wire → no-op', () => {
      expect(() => adapter.setProp('ghost', 'text', 'x')).not.toThrow()
      expect(elOf(adapter, 'ghost')).toBeUndefined()
    })
    it('DOM-F3 removeEl unknown wire → no-op', () => {
      expect(() => adapter.removeEl('ghost')).not.toThrow()
    })
  })

  describe('hydrate seam (DOM-H24)', () => {
    it('DOM-H24 collects css.ids; valid ids not re-created', () => {
      mount.querySelectorAll = [Object.assign(new El('div'), { id: 'a' }), Object.assign(new El('div'), { id: 'b' })]
      adapter.hydrate('root', { template: { css: { id: 'a' } }, content: [{ css: { id: 'b' } }, { css: {} }] })
      expect(adapter.reused.has('a')).toBe(true)
      expect(adapter.reused.has('b')).toBe(true)
      expect(adapter.reused.size).toBe(2)
    })
  })
})

describe('DOM-F2 no-document constructor throw (stubbed-global, isolated)', () => {
  afterEach(() => {
    uninstallDom()
  })
  it('DOM-F2 constructing DomAdapter without global document throws', () => {
    installDom()
    const mount = makeMount()
    uninstallDom()
    expect(() => new DomAdapter(mountEl(mount))).toThrow(/DOM/)
  })
})

describe('FRG-* SSRFragmentAdapter', () => {
  let adapter: SSRFragmentAdapter
  beforeEach(() => {
    adapter = new SSRFragmentAdapter()
  })

  describe('createEl (FRG-H1, H2, F3, H23)', () => {
    it('FRG-H1 non-void descriptor shape + fragments registration', () => {
      const fd = adapter.createEl('div', 'w')
      expect(fd.openTag).toBe('<div>')
      expect(fd.closeTag).toBe('</div>')
      expect(fd.contentText).toBe('')
      expect(fd.isVoid).toBe(false)
      expect(adapter.fragments.get('w')).toBe(fd)
    })
    it('FRG-H2 void tag → isVoid true, closeTag empty', () => {
      for (const t of ['br', 'img', 'input']) {
        const fd = adapter.createEl(t, `w_${t}`)
        expect(fd.isVoid).toBe(true)
        expect(fd.closeTag).toBe('')
      }
    })
    it('FRG-H23 two creates same wire distinct forkKeys → distinct descriptors', () => {
      const a = adapter.createEl('div', 'w', 'fk1')
      const b = adapter.createEl('div', 'w', 'fk2')
      expect(a).not.toBe(b)
      expect(adapter.fragments.get(wireKey('w', 'fk1'))).toBe(a)
      expect(adapter.fragments.get(wireKey('w', 'fk2'))).toBe(b)
    })
    it('FRG-F3 duplicate createEl same (wire, forkKey) → overwrite', () => {
      const a = adapter.createEl('div', 'w')
      const b = adapter.createEl('div', 'w')
      expect(adapter.fragments.get('w')).toBe(b)
    })
  })

  describe('setProp attribute/text emission (FRG-H3..H13, H21, H22)', () => {
    it('FRG-H3 text → contentText', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'text', 'hi')
      expect(adapter.fragments.get('w')!.contentText).toBe('hi')
    })
    it('FRG-NP5 text OBJECT value → JSON contentText (never "[object Object]")', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'text', { done: true, n: 1 })
      expect(adapter.fragments.get('w')!.contentText).toBe('{"done":true,"n":1}')
    })
    it('FRG-NP5 attr OBJECT value → escaped JSON attribute', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'prop:title', { a: '<x>', q: '&"' })
      expect(adapter.fragments.get('w')!.openTag).toContain('title="{&quot;a&quot;:&quot;&lt;x&gt;&quot;,&quot;q&quot;:&quot;&amp;\\&quot;&quot;}"')
    })
    it('FRG-N3 attr NULL value → the JSON string "null" attribute', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'prop:title', null)
      expect(adapter.fragments.get('w')!.openTag).toContain('title="null"')
    })
    it('FRG-H4 css:id → openTag contains id="k"', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:id', 'k')
      expect(adapter.fragments.get('w')!.openTag).toBe('<div id="k">')
    })
    it('FRG-H5 css:classes array → class="a b"', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:classes', ['a', 'b'])
      expect(adapter.fragments.get('w')!.openTag).toContain('class="a b"')
    })
    it('FRG-H6 css:style → style="color:red"', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:style', 'color:red')
      expect(adapter.fragments.get('w')!.openTag).toContain('style="color:red"')
    })
    it('FRG-H7 css:cssDef → no attribute; pushed to styles buffer', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:cssDef', '.x{}')
      expect(adapter.fragments.get('w')!.openTag).toBe('<div>')
      expect(adapter.styles).toContain('.x{}')
    })
    it('FRG-H8 on:click → inlined onclick attr', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'on:click', 'alert(1)')
      expect(adapter.fragments.get('w')!.openTag).toContain('onclick="alert(1)"')
    })
    it('FRG-H8b on:<event> attr values escaped per §4.2 (escapeAttr on handler strings)', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'on:click', 'a&b "c" <d>')
      expect(adapter.fragments.get('w')!.openTag).toContain('onclick="a&amp;b &quot;c&quot; &lt;d&gt;"')
      expect(adapter.fragments.get('w')!.openTag).not.toContain('a&b "c" <d>')
    })
    it('FRG-H9 prop:title → title attr, prefix stripped', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'prop:title', 't')
      expect(adapter.fragments.get('w')!.openTag).toContain('title="t"')
    })
    it('FRG-H10 bare hidden → hidden="true"', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'hidden', true)
      expect(adapter.fragments.get('w')!.openTag).toContain('hidden="true"')
    })
    it('FRG-H11 value on input → value="v" attribute', () => {
      adapter.createEl('input', 'w')
      adapter.setProp('w', 'value', 'v')
      expect(adapter.fragments.get('w')!.openTag).toContain('value="v"')
    })
    it('FRG-H12 attr value escaped', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'prop:title', 'a&b "c" <d> e')
      expect(adapter.fragments.get('w')!.openTag).toContain('a&amp;b &quot;c&quot; &lt;d&gt; e')
    })
    it('FRG-H13 text escaped', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'text', 'a < b & c > d')
      expect(adapter.fragments.get('w')!.contentText).toBe('a &lt; b &amp; c &gt; d')
    })
    it('FRG-H21 repeated css:id → openTag identical (D4 idempotent)', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:id', 'k')
      const one = adapter.fragments.get('w')!.openTag
      adapter.setProp('w', 'css:id', 'k')
      expect(adapter.fragments.get('w')!.openTag).toBe(one)
    })
    it('FRG-H22 openTag unchanged by text set; contentText separate', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'css:id', 'k')
      const tag = adapter.fragments.get('w')!.openTag
      adapter.setProp('w', 'text', 'hi')
      expect(adapter.fragments.get('w')!.openTag).toBe(tag)
      expect(adapter.fragments.get('w')!.contentText).toBe('hi')
    })
  })

  describe('appendChild / void / undefined-drop (FRG-H14..H20, H24, F1, F2, F4)', () => {
    it('FRG-H14 append serializes child into owner contentText', () => {
      const owner = adapter.createEl('div', 'o')
      const child = adapter.createEl('span', 'c')
      adapter.setProp('c', 'text', 'x')
      adapter.appendChild(owner, child)
      expect(owner.contentText).toContain('<span>x</span>')
    })
    it('FRG-H15 deep nesting correct', () => {
      const r = adapter.createEl('div', 'r')
      const a = adapter.createEl('div', 'a')
      const b = adapter.createEl('div', 'b')
      adapter.appendChild(r, a)
      adapter.appendChild(a, b)
      expect(r.contentText).toBe('<div><div></div></div>')
    })
    it('FRG-H16 toString: styles prefix + root html; root = first-created wire', () => {
      adapter.createEl('div', 'root')
      adapter.createEl('div', 'child')
      adapter.styles(['.x{}'])
      const out = adapter.toString()
      expect(out.startsWith('<style id="preempt-dynamic-styles">\n.x{}</style>')).toBe(true)
      expect(out).toContain('<div>')
    })
    it('FRG-H17 multiple styles ops → single prefix, defs in arrival order', () => {
      adapter.createEl('div', 'root')
      adapter.styles(['.a{}', '.b{}'])
      const out = adapter.toString()
      expect(out.startsWith('<style id="preempt-dynamic-styles">\n.a{}\n.b{}</style>')).toBe(true)
    })
    it('FRG-H18 undefined-valued attr omitted and removed from openTag', () => {
      adapter.createEl('div', 'w')
      adapter.setProp('w', 'hidden', true)
      adapter.setProp('w', 'hidden', undefined)
      expect(adapter.fragments.get('w')!.openTag).toBe('<div>')
      adapter.setProp('w', 'text', 'x')
      adapter.setProp('w', 'text', undefined)
      expect(adapter.fragments.get('w')!.contentText).toBe('')
    })
    it('FRG-H19 hydrate is a no-op', () => {
      adapter.createEl('div', 'w')
      adapter.hydrate('root', { template: { css: { id: 'a' } } })
      expect(adapter.fragments.get('w')!.openTag).toBe('<div>')
    })
    it('FRG-H20 void element ignores text/children at serialization', () => {
      const v = adapter.createEl('br', 'vb')
      adapter.setProp('vb', 'text', 'ignored')
      expect(adapter.toString()).toBe('<br>')
    })
    it('FRG-F1 append to void owner ignored in output', () => {
      const v = adapter.createEl('br', 'vb')
      const c = adapter.createEl('span', 'c')
      adapter.appendChild(v, c)
      expect(adapter.toString()).toBe('<br>')
    })
    it('FRG-F2 setProp unknown wire → no-op', () => {
      expect(() => adapter.setProp('ghost', 'text', 'x')).not.toThrow()
    })
    it('FRG-F4 on:click non-string coerced via String() (then §4.2 escapeAttr)', () => {
      adapter.createEl('div', 'w')
      const fn = () => {}
      adapter.setProp('w', 'on:click', fn as never)
      // escapeAttr(String(fn)): the arrow's `>` is entity-escaped (&gt;) per §4.2
      const expected = String(fn).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      expect(adapter.fragments.get('w')!.openTag).toContain(`onclick="${expected}"`)
    })
    it('FRG-H24 removeEl(root) then toString → styles prefix only', () => {
      adapter.createEl('div', 'root')
      adapter.removeEl('root')
      adapter.styles(['.x{}'])
      expect(adapter.toString()).toBe('<style id="preempt-dynamic-styles">\n.x{}</style>')
    })
    it('FRG-H25 created-but-never-appended fragment serializes after the root subtree (DomAdapter mount-parity)', () => {
      const rootFd = adapter.createEl('div', 'root')
      const child = adapter.createEl('span', 'child')
      adapter.setProp('child', 'text', 'hi')
      adapter.appendChild(rootFd, child)
      adapter.createEl('section', 'float')
      adapter.setProp('float', 'text', 'orphan')
      // root html first, then the never-appended fragment in creation order
      expect(adapter.toString()).toBe('<div><span>hi</span></div><section>orphan</section>')
    })
    it('FRG-H26 fully-connected streams are unchanged: appended fragments never leak as top-level', () => {
      const rootFd = adapter.createEl('div', 'root')
      const a = adapter.createEl('div', 'a')
      const b = adapter.createEl('div', 'b')
      adapter.appendChild(rootFd, a)
      adapter.appendChild(a, b)
      expect(adapter.toString()).toBe('<div><div><div></div></div></div>')
    })
  })

  describe('removeEl (FRG-H18-remove)', () => {
    it('FRG-H18 removeEl drops from fragments and toString', () => {
      adapter.createEl('div', 'w')
      adapter.removeEl('w')
      expect(adapter.toString()).toBe('')
    })
  })
})

describe('PARS-* parity & hydration', () => {
  let mount: Mount
  let dom: DomAdapter
  beforeEach(() => {
    installDom()
    mount = makeMount()
    dom = new DomAdapter(mountEl(mount))
  })
  afterEach(() => {
    uninstallDom()
  })

  it('PARS-H1 identical op stream → structural parity (dom tree ≡ ssr ≡ treeSig)', () => {
    const ops: RenderOp[] = [
      { kind: 'create', wire: 'root', type: 'div' },
      { kind: 'set', wire: 'root', name: 'css:id', value: 'r' },
      { kind: 'create', wire: 'w', type: 'span' },
      { kind: 'set', wire: 'w', name: 'text', value: 'hi' },
      { kind: 'append', owner: 'root', child: 'w' },
    ]
    applyOps(dom, ops)
    const ssr = new SSRFragmentAdapter()
    applyOps(ssr, ops)
    const expectedSig = treeSig(treeFromOps(ops))
    // SSR root = first-created wire; root div with inlined child span (PAR-5)
    expect(ssr.toString().startsWith('<div id="r"><span>hi</span></div>')).toBe(true)
    expect(treeSig(treeFromOps(ops))).toBe(expectedSig)
  })

  it('PAR-6 fork arms stay distinct (wire, forkKey) entries on both adapters', () => {
    const ops: RenderOp[] = [
      { kind: 'create', wire: 'w', type: 'span', forkKey: 'fk1' },
      { kind: 'create', wire: 'w', type: 'span', forkKey: 'fk2' },
      { kind: 'set', wire: 'w', name: 'text', value: 'one', forkKey: 'fk1' },
    ]
    applyOps(dom, ops)
    expect(dom.wires.get(wireKey('w', 'fk1'))).toBeDefined()
    expect(dom.wires.get(wireKey('w', 'fk2'))).toBeDefined()
    expect(dom.wires.get(wireKey('w', 'fk1'))!.textContent).toBe('one')
    expect(dom.wires.get(wireKey('w', 'fk2'))!.textContent).toBe('')
    expect(treeFromOps(ops)).toHaveLength(2)
  })

  it('PARS-H2 hydrate over SSR doc → reused contains css.ids', () => {
    dom.hydrate('root', { template: { css: { id: 'a' } }, content: [{ css: { id: 'b' } }] })
    expect(dom.reused.has('a')).toBe(true)
    expect(dom.reused.has('b')).toBe(true)
  })

  it('PARS-H3 styles across both adapters emitted once', () => {
    applyOps(dom, [{ kind: 'styles', cssDefs: ['.x{}'] }])
    const stylesEls = doc.head.children.filter((e) => e.id === 'preempt-dynamic-styles')
    expect(stylesEls).toHaveLength(1)
    const ssr = new SSRFragmentAdapter()
    ssr.createEl('div', 'root')
    ssr.styles(['.x{}'])
    const prefix = ssr.toString().slice(0, '<style id="preempt-dynamic-styles">\n.x{}</style>'.length)
    expect(prefix).toBe('<style id="preempt-dynamic-styles">\n.x{}</style>')
  })

  it('PARS-F2 adapters are pure consumers (no resolution state)', () => {
    const ssr = new SSRFragmentAdapter()
    expect(typeof (ssr as unknown as { compile?: unknown }).compile).toBe('undefined')
    expect(typeof (dom as unknown as { compile?: unknown }).compile).toBe('undefined')
  })
})

describe('DOM-B* — the detached INITIAL-BUILD batch (A, 2026-08-16)', () => {
  let mount: Mount
  let adapter: DomAdapter

  beforeEach(() => {
    installDom()
    mount = makeMount()
    adapter = new DomAdapter(mountEl(mount))
  })
  afterEach(() => {
    uninstallDom()
  })

  it('DOM-B1 created elements are HELD BACK from the mount during a batch; endBatch mounts ONLY the roots, in creation order', () => {
    adapter.beginBatch()
    const root = adapter.createEl('div', 'root')
    const a = adapter.createEl('div', 'a')
    const b = adapter.createEl('div', 'b')
    // nothing touched the live mount yet
    expect(mount.children).toEqual([])
    // appends re-parent under owners (a, b under root)
    adapter.appendChild(root, a)
    adapter.appendChild(root, b)
    adapter.endBatch()
    // only the unparented root mounted; a/b nested under it, NOT on the mount
    expect(mount.children).toEqual([root])
    expect(root.children).toEqual([a, b])
    expect((a as unknown as { parent: unknown }).parent).toBe(root)
  })

  it('DOM-B2 an element re-parented by an append op during the batch is not a root; a true multi-root batch mounts both roots', () => {
    adapter.beginBatch()
    const r1 = adapter.createEl('div', 'r1')
    const r2 = adapter.createEl('div', 'r2')
    const kid = adapter.createEl('div', 'kid')
    adapter.appendChild(r1, kid)
    adapter.endBatch()
    expect(mount.children).toEqual([r1, r2])
    expect(r1.children).toEqual([kid])
    expect(mount.children).not.toContain(kid)
  })

  it('DOM-B3 the batch is one-shot and non-leaky: after endBatch, creates attach immediately again (DOM-H1 path)', () => {
    adapter.beginBatch()
    adapter.createEl('div', 'held')
    adapter.endBatch()
    expect(mount.children).toHaveLength(1)
    const live = adapter.createEl('div', 'live')
    expect(mount.children).toContain(live)
    // a second beginBatch/endBatch still works
    adapter.beginBatch()
    const r = adapter.createEl('div', 'r2')
    adapter.endBatch()
    expect(mount.children).toEqual([adapter.wires.get('held')!, live, r])
  })

  it('DOM-B4 a full applyOps op stream inside the batch builds the tree detached and mounts it whole at endBatch', () => {
    adapter.beginBatch()
    applyOps(adapter, [
      { kind: 'create', wire: 'root', type: 'div' },
      { kind: 'set', wire: 'root', name: 'text', value: 'title' },
      { kind: 'create', wire: 'c1', type: 'section' },
      { kind: 'create', wire: 'c2', type: 'section' },
      { kind: 'append', owner: 'root', child: 'c1' },
      { kind: 'append', owner: 'root', child: 'c2' },
    ])
    expect(mount.children).toEqual([])
    adapter.endBatch()
    const root = elOf(adapter, 'root')!
    expect(mount.children).toEqual([root])
    expect(root.children.map((c) => elOf(adapter, 'c1')! === c || elOf(adapter, 'c2')! === c)).toHaveLength(2)
    expect(root.textContent).toBe('title')
  })
})

// ---------------------------------------------------------------------------
// DATA-* — the opt-in `data:` op-namespace routing (ssr-synthetic-event.md §4,
// user ruling A2). `data:<name>` op props → setAttribute('data-<name>') on the
// DomAdapter / the `data-<name>="…"` attribute in the SSR string — mirroring
// the existing `prop:`/`css:` routing. The default-OFF pin: a DEFAULT
// emitElements stream never produces a `data:` op (no data-node-id anywhere).
// ---------------------------------------------------------------------------

describe('DATA-* — the opt-in `data:` op namespace (ssr-synthetic-event.md §4)', () => {
  let mount: Mount
  let adapter: DomAdapter

  beforeEach(() => {
    installDom()
    mount = makeMount()
    adapter = new DomAdapter(mountEl(mount))
  })
  afterEach(() => {
    uninstallDom()
  })

  it('DATA-H1 DomAdapter routes `data:<name>` → setAttribute("data-<name>")', () => {
    adapter.createEl('div', 'w')
    adapter.setProp('w', 'data:node-id', 'node-3')
    expect(elOf(adapter, 'w')!.getAttribute('data-node-id')).toBe('node-3')
  })

  it('DATA-H2 DomAdapter undefined drops the data- attribute', () => {
    adapter.createEl('div', 'w')
    adapter.setProp('w', 'data:node-id', 'node-3')
    adapter.setProp('w', 'data:node-id', undefined)
    expect(elOf(adapter, 'w')!.getAttribute('data-node-id')).toBeNull()
  })

  it('DATA-H3 bare non-colon `data-x` names are untouched — only the `data:` colon namespace routes', () => {
    adapter.createEl('div', 'w')
    adapter.setProp('w', 'data-x', 'v')
    expect(elOf(adapter, 'w')!.getAttribute('data-x')).toBe('v')
    // a literal `data:x` (the colon form) never lands as an attribute name
    expect(elOf(adapter, 'w')!.getAttribute('data:x')).toBeNull()
  })

  it('DATA-H4 SSRFragmentAdapter routes `data:<name>` into the attribute list', () => {
    const ssr = new SSRFragmentAdapter()
    ssr.createEl('div', 'w')
    ssr.setProp('w', 'data:node-id', 'node-3')
    expect(ssr.fragments.get('w')!.openTag).toBe('<div data-node-id="node-3">')
  })

  it('DATA-H5 SSRFragmentAdapter undefined drops the data- attribute', () => {
    const ssr = new SSRFragmentAdapter()
    ssr.createEl('div', 'w')
    ssr.setProp('w', 'data:node-id', 'node-3')
    ssr.setProp('w', 'data:node-id', undefined)
    expect(ssr.fragments.get('w')!.openTag).toBe('<div>')
  })

  it('DATA-H6 default-OFF pin: a DEFAULT emitElements stream leaves NO data-node-id in the DOM or the SSR string', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf', content: 'L' }), 0)
    const res = root.compile([root, leaf])
    const ops = diffMinimal(null, emitElements(res.actionable))
    applyOps(adapter, ops)
    for (const el of adapter.wires.values()) {
      expect((el as unknown as El).getAttribute('data-node-id')).toBeNull()
    }
    const ssr = new SSRFragmentAdapter()
    applyOps(ssr, ops)
    expect(ssr.toString()).not.toContain('data-node-id')
  })

  it('DATA-H7 the ON stream reaches the DOM attribute and the SSR string end-to-end', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf', content: 'L' }), 0)
    const res = root.compile([root, leaf])
    const byNode = new Map([[root.id, root], [leaf.id, leaf]]) as never
    const ops = diffMinimal(null, emitElements(res.actionable, byNode, { nodeIdAttribute: true }))
    applyOps(adapter, ops)
    expect((elOf(adapter, leaf.id) as unknown as El).getAttribute('data-node-id')).toBe(leaf.id)
    const ssr = new SSRFragmentAdapter()
    applyOps(ssr, ops)
    expect(ssr.toString()).toContain(`data-node-id="${leaf.id}"`)
  })
})
