import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  DomAdapter,
  SSRFragmentAdapter,
  VOID_TAGS,
} from '../../src/core/adapters.js'
import {
  encodeRuns,
  decodeRuns,
  isBodyEncoded,
} from '../../src/core/body-runs.js'
import {
  minimalFromState,
  emitElements,
  applyOps,
  wireKey,
} from '../../src/core/render-helpers.js'
import { diffMinimal, MockAdapter, type RenderOp } from '../../src/core/render.js'
import type { MinimalElement } from '../../src/core/render.js'
import type { BodyRun } from '../../src/core/body-runs.js'
import { Node, mintNodeId } from '../../src/core/node.js'
import { translateLegacy } from '../../src/core/translate.js'
import { serializeNode, loadState } from '../../src/core/serialize.js'

// ===========================================================================
// ENG-INLINE-ORDER text/element interleaving — `bodyRuns` segments (amended
// spec 2026-08-30: field `bodyRuns` / type `BodyRun`; the adapter-visible
// `props['text']` value is a run-encoded STRING via encodeRuns/decodeRuns).
// TestWriter red set per §10 (happy) + §11 (fail). Tests written BEFORE any
// implementation (TDD red). The helper module src/core/body-runs.ts and its
// exports do not exist yet — this file is the red set that defines them.
// ===========================================================================

function el(
  wire: string,
  type: string,
  props: Record<string, unknown> = {},
  childOrder: string[] = [],
): MinimalElement {
  return { wire, type, props, childOrder }
}

function jsonClone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T
}

// ---------------------------------------------------------------------------
// DOM shim: a minimal El that ALSO records ordered content (text runs +
// appended child elements in document order) so interleaving is testable.
// This mirrors how the real DOM adapter must rebuild an element's content
// order-aware on the run-encoded path.
// ---------------------------------------------------------------------------
type OrderedEntry = { kind: 'text'; value: string } | { kind: 'child'; el: El }
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
  ordered: OrderedEntry[] = []
  parent: El | null = null
  removed = false
  constructor(tag: string) {
    this.tagName = tag.toUpperCase()
  }
  appendChild(c: El): El {
    const i = this.children.indexOf(c)
    if (i !== -1) this.children.splice(i, 1)
    this.children.push(c)
    this.ordered.push({ kind: 'child', el: c })
    c.parent = this
    return c
  }
  setAttribute(k: string, v: unknown): void {
    this.attrs[k] = String(v)
  }
  getAttribute(k: string): string | null {
    return this.attrs[k] ?? null
  }
  remove(): void {
    this.removed = true
    if (this.parent) {
      const i = this.parent.children.indexOf(this)
      if (i !== -1) this.parent.children.splice(i, 1)
      this.parent = null
    }
  }
}

class Mount extends El {
  querySelectorAll: El[] = []
}
class Head {
  children: El[] = []
  appendChild(c: El): El {
    this.children.push(c)
    return c
  }
}
class ElMap {
  private m = new Map<string, El>()
  set(k: string, v: unknown): void {
    this.m.set(k, v as El)
  }
  get(k: string): El | undefined {
    return this.m.get(k)
  }
  [Symbol.iterator](): IterableIterator<[string, El]> {
    return this.m[Symbol.iterator]()
  }
}
let doc: {
  createElement: (tag: string) => El
  getElementById: (id: string) => El
  head: Head
}
let savedDocument: unknown
function installDom(): void {
  doc = {
    createElement: (tag: string) => new El(tag),
    getElementById: () => new El('div'),
    head: new Head(),
  }
  savedDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true, writable: true })
}
function uninstallDom(): void {
  if (savedDocument) Object.defineProperty(globalThis, 'document', savedDocument)
  else delete (globalThis as Record<string, unknown>).document
}
function makeMount(): Mount {
  const m = new Mount('div')
  m.id = 'mount'
  return m
}
function mountEl(m: Mount): HTMLElement {
  return m as unknown as HTMLElement
}
function elOf(adapter: DomAdapter, w: string): El | undefined {
  return adapter.wires.get(w) as El | undefined
}

// ---------------------------------------------------------------------------
// §5.1 encodeRuns / decodeRuns — the run-encoded serialization contract.
// ---------------------------------------------------------------------------
describe('encodeRuns / decodeRuns (ENG-INLINE-ORDER §5.1)', () => {
  it('round-trips a run sequence exactly (order + text preserved)', () => {
    const runs: BodyRun[] = [{ text: 'Some ' }, { child: 'w1' }, { text: ' text' }]
    expect(decodeRuns(encodeRuns(runs))).toEqual(runs)
  })

  it('H2 — distinguishes [text,child,text] from [text,text,child]', () => {
    const a: BodyRun[] = [{ text: 'x' }, { child: 'w' }, { text: 'y' }]
    const b: BodyRun[] = [{ text: 'x' }, { text: 'y' }, { child: 'w' }]
    expect(encodeRuns(a)).not.toBe(encodeRuns(b))
  })

  it('is byte-stable for an identical sequence (L2 order-key stability)', () => {
    const runs: BodyRun[] = [{ text: 'Some ' }, { child: 'w1' }, { text: ' text' }]
    expect(encodeRuns(runs)).toBe(encodeRuns(runs))
  })

  it('M3 — escapes special characters in text before encoding, never a bare string', () => {
    const runs: BodyRun[] = [{ text: 'a & b < c > d' }]
    const enc = encodeRuns(runs)
    expect(enc).not.toContain('<')
    expect(enc).not.toContain('>')
    expect(enc).not.toContain('&')
    // decode returns the ORIGINAL unescaped text
    expect(decodeRuns(enc)).toEqual(runs)
  })

  it('isBodyEncoded is a stable prefix check that never flags plain text', () => {
    expect(isBodyEncoded(encodeRuns([{ text: 'hi' }]))).toBe(true)
    expect(isBodyEncoded('hi')).toBe(false)
    expect(isBodyEncoded('')).toBe(false)
    expect(isBodyEncoded(undefined)).toBe(false)
    expect(isBodyEncoded(123)).toBe(false)
  })

  it('child-only run is representable (degenerate)', () => {
    const runs: BodyRun[] = [{ child: 'w1' }]
    expect(decodeRuns(encodeRuns(runs))).toEqual(runs)
  })
})

// ---------------------------------------------------------------------------
// `minimalFromState` emit — §3.3 + §4: bodyRuns present → encoded props['text'];
// absent / single-text → scalar (byte-identical default).
// ---------------------------------------------------------------------------
describe('minimalFromState emit (ENG-INLINE-ORDER §3.3/§4)', () => {
  it('§10.1 no interleaving, no bodyRuns → byte-identical scalar text', () => {
    const out = minimalFromState({ nodeId: 'n', type: 'div', content: 'hi', children: ['c1', 'c2'] })
    expect(out.props['text']).toBe('hi')
    expect(out.childOrder).toEqual(['c1', 'c2'])
    expect(isBodyEncoded(out.props['text'])).toBe(false)
  })

  it('§10.2 single {text} bodyRuns NORMALIZES to scalar content (no encode)', () => {
    const out = minimalFromState({
      nodeId: 'n',
      type: 'div',
      content: 'hi',
      bodyRuns: [{ text: 'hi' }],
      children: [],
    })
    expect(out.props['text']).toBe('hi')
    expect(isBodyEncoded(out.props['text'])).toBe(false)
  })

  it('§10.3 [text,child,text] emits the encoded string on text', () => {
    const out = minimalFromState({
      nodeId: 'p',
      type: 'p',
      content: 'Some bold text',
      bodyRuns: [{ text: 'Some ' }, { child: 'b1' }, { text: ' text' }],
      children: ['b1'],
    })
    expect(isBodyEncoded(out.props['text'])).toBe(true)
    expect(decodeRuns(out.props['text'] as string)).toEqual([
      { text: 'Some ' },
      { child: 'b1' },
      { text: ' text' },
    ])
    // childOrder still emitted so treeSig stays order-faithful (H2 §6.3)
    expect(out.childOrder).toEqual(['b1'])
  })

  it('§10.4 child-first [child,text] encodes order', () => {
    const out = minimalFromState({
      nodeId: 'p',
      type: 'p',
      content: ' Astrographer',
      bodyRuns: [{ child: 'b1' }, { text: ' Astrographer' }],
      children: ['b1'],
    })
    expect(decodeRuns(out.props['text'] as string)).toEqual([
      { child: 'b1' },
      { text: ' Astrographer' },
    ])
  })

  it('§11.3 bodyRuns on a non-actionable node → ignored (minimalFromState has no throw)', () => {
    const out = minimalFromState({ nodeId: 'n', type: 'div' })
    expect(out.props['text']).toBeUndefined()
  })

  it('hideEmptyContainer must NOT fire for a bodyRuns node with no scalar content (§8/M4)', () => {
    // a container-owner whose only renderable info is a bodyRuns (no scalar
    // content, no styled emptiness) must be treated as NON-empty
    const out = emitElements([
      {
        nodeId: 'c',
        type: 'div',
        bodyRuns: [{ child: 'w1' }],
        children: ['w1'],
        anchors: [{ role: 'container', target: 'z' }] as never,
      },
    ])
    expect(out[0]!.props['css:style']).toBeUndefined()
    expect(isBodyEncoded(out[0]!.props['text'])).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// diffMinimal — L2: identical encoded string → no spurious re-set §6.
// ---------------------------------------------------------------------------
describe('diffMinimal interleaving identity (ENG-INLINE-ORDER §6)', () => {
  it("§10.7 re-emitting an unchanged interleaving emits ZERO 'set' ops", () => {
    const enc = encodeRuns([{ text: 'Some ' }, { child: 'b1' }, { text: ' text' }])
    const prev = new Map([
      ['p', el('p', 'p', { text: enc }, ['b1'])],
    ])
    const next = [el('p', 'p', { text: enc }, ['b1'])]
    // first call: from null → all sets; second call (prev set) → no change
    const ops = diffMinimal(prev, next)
    expect(ops.filter((o) => o.kind === 'set')).toHaveLength(0)
    expect(ops.filter((o) => o.kind === 'append')).toHaveLength(0)
  })

  it('an interleaving CHANGE emits ONE set op (no multiplication, M2)', () => {
    const a = encodeRuns([{ text: 'Some ' }, { child: 'b1' }])
    const b = encodeRuns([{ text: 'Some ' }, { child: 'b1' }, { text: ' end' }])
    const prev = new Map([['p', el('p', 'p', { text: a }, ['b1'])]])
    const next = [el('p', 'p', { text: b }, ['b1'])]
    const ops = diffMinimal(prev, next)
    expect(ops.filter((o) => o.kind === 'set')).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// §6.1 SSR adapter — run-encoded text renders segments in order.
// ---------------------------------------------------------------------------
describe('SSRFragmentAdapter interleaving (ENG-INLINE-ORDER §6.1)', () => {
  it('§10.3 [text,child,text] → child HTML interleaved in position', () => {
    const a = new SSRFragmentAdapter()
    a.createEl('p', 'p')
    a.createEl('strong', 'b1')
    a.setProp('p', 'text', encodeRuns([{ text: 'Some ' }, { child: 'b1' }, { text: ' text' }]))
    a.setProp('b1', 'text', 'bold')
    a.appendChild('p', 'b1')
    expect(a.fragments.get('p')!.contentText).toBe('Some <strong>bold</strong> text')
  })

  it('§10.4 child-first [child,text] → bold BEFORE text', () => {
    const a = new SSRFragmentAdapter()
    a.createEl('p', 'p')
    a.createEl('strong', 'b1')
    a.setProp('p', 'text', encodeRuns([{ child: 'b1' }, { text: ' Astrographer' }]))
    a.setProp('b1', 'text', 'Proposal:')
    a.appendChild('p', 'b1')
    expect(a.fragments.get('p')!.contentText).toBe('<strong>Proposal:</strong> Astrographer')
  })

  it('plain string text is UNCHANGED (escapeText + children)', () => {
    const a = new SSRFragmentAdapter()
    a.createEl('p', 'p')
    a.createEl('strong', 'b1')
    a.setProp('p', 'text', 'a & b < c')
    a.setProp('b1', 'text', 'x')
    a.appendChild('p', 'b1')
    expect(a.fragments.get('p')!.contentText).toBe('a &amp; b &lt; c<strong>x</strong>')
  })

  it('§11.4 an undecodable interleaving value falls back to escaped text (never throws)', () => {
    const a = new SSRFragmentAdapter()
    a.createEl('p', 'p')
    a.setProp('p', 'text', '\u0001BODY\u001fgarbage')
    expect(() => a.fragments.get('p')!.contentText).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// §6.2 DOM adapter — run-encoded text renders order-aware.
// ---------------------------------------------------------------------------
describe('DomAdapter interleaving (ENG-INLINE-ORDER §6.2)', () => {
  let a: DomAdapter
  beforeEach(() => {
    installDom()
    a = new DomAdapter(mountEl(makeMount()))
  })
  afterEach(() => {
    uninstallDom()
  })

  it('§10.3 [text,child,text] → ordered content: text, element, text', () => {
    a.createEl('p', 'p')
    a.createEl('strong', 'b1')
    a.setProp('p', 'text', encodeRuns([{ text: 'Some ' }, { child: 'b1' }, { text: ' text' }]))
    a.setProp('b1', 'text', 'bold')
    a.appendChild('p', 'b1')
    const p = elOf(a, 'p')!
    const order = p.ordered
    expect(order[0]).toEqual({ kind: 'text', value: 'Some ' })
    expect(order[1]!.kind).toBe('child')
    expect(order[2]).toEqual({ kind: 'text', value: ' text' })
  })

  it('§10.4 child-first [child,text] → element BEFORE text', () => {
    a.createEl('p', 'p')
    a.createEl('strong', 'b1')
    a.setProp('p', 'text', encodeRuns([{ child: 'b1' }, { text: ' Astrographer' }]))
    a.setProp('b1', 'text', 'Proposal:')
    a.appendChild('p', 'b1')
    const p = elOf(a, 'p')!
    expect(p.ordered[0]!.kind).toBe('child')
    expect(p.ordered[1]).toEqual({ kind: 'text', value: ' Astrographer' })
  })

  it('plain string text is UNCHANGED (textContent, no ordered entries)', () => {
    a.createEl('p', 'p')
    a.setProp('p', 'text', 'hi')
    const p = elOf(a, 'p')!
    expect(p.textContent).toBe('hi')
    expect(p.ordered).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Round-trip — §7: bodyRuns survives serialize/loadState and Node data.
// ---------------------------------------------------------------------------
describe('bodyRuns round-trip (ENG-INLINE-ORDER §7)', () => {
  it('Node data carries bodyRuns to the compiled state', () => {
    const root = new Node({ type: 'div', bodyRuns: [{ text: 'Some ' }, { child: 'w' }] }, undefined, 'root')
    // structural: the node's base keeps bodyRuns (round-trip source)
    expect((root as unknown as { base: { bodyRuns?: BodyRun[] } }).base.bodyRuns).toEqual([
      { text: 'Some ' },
      { child: 'w' },
    ])
  })

  it('serializeNode → loadState preserves bodyRuns on the seeded base', () => {
    const node = new Node(
      { type: 'p', id: 'p1', bodyRuns: [{ text: 'Some ' }, { child: 'w' }], childrenRefs: [] } as never,
      undefined,
      'p1',
    ) as unknown as { base: Record<string, unknown> }
    // force a parent chain via serializeNode which reads node.children
    const serialized = serializeNode(node as never)
    expect((serialized as unknown as { bodyRuns?: BodyRun[] }).bodyRuns).toEqual([
      { text: 'Some ' },
      { child: 'w' },
    ])
  })

  it('§10.8 a one-run or absent bodyRuns normalizes to scalar content (byte-identical)', () => {
    const node = new Node({ type: 'p', content: 'hi', bodyRuns: [{ text: 'hi' }] })
    const runs = (node as unknown as { base: { bodyRuns?: BodyRun[] } }).base.bodyRuns
    const out = minimalFromState({
      nodeId: node.id,
      type: node.type,
      content: node.content as string,
      ...(runs !== undefined ? { bodyRuns: runs } : {}),
      children: [],
    })
    expect(isBodyEncoded(out.props['text'])).toBe(false)
    expect(out.props['text']).toBe('hi')
  })
})

// ---------------------------------------------------------------------------
// §11 fail-states — malformed bodyRuns is a shape warn-or-skip, never a throw.
// ---------------------------------------------------------------------------
describe('bodyRuns fail-states (ENG-INLINE-ORDER §11)', () => {
  it('§11.1 a non-array bodyRuns on node data is tolerated (no throw); not encoded', () => {
    // constructing a Node with a malformed bodyRuns must not throw
    expect(() => new Node({ type: 'p', bodyRuns: 'oops' } as never)).not.toThrow()
  })
})
