/**
 * Phase B — SSR SYNTHETIC-EVENT CONTRACT parity harness
 * (docs/specs/ssr-synthetic-event.md, reviewed in docs/specs/ssr-synthetic-event-review.md — verdict PROCEED, no engine/adapter/render change).
 *
 * The contract (6 pins):
 *   P1 producing-process-keeps-graph  — the process that rendered the SSR
 *      fragment keeps the live Supervisor + compiled states (it can dispatch
 *      AFTER emitting the HTML string).
 *   P2 fragment-as-addressable-metadata — css.id (authored) + process-side
 *      nodeId/wire resolution locate a render target in the producing graph.
 *   P3 inline `on<event>="true"` is INERT — never the dispatch channel (the
 *      synthetic event targets the producing graph, never the HTML).
 *   P4 graph-canon, fragment-is-a-view — a synthetic event mutates the
 *      producing graph; the fragment STRING does not react; the producer may
 *      RE-EMIT a fresh fragment on demand (same SSRFragmentAdapter).
 *   P5 parity harness — same envelope through DomAdapter AND
 *      SSRFragmentAdapter ⇒ identical HandlerResult[] + post-apply re-emit
 *      structural parity (PAR-5, treeFromOps/treeSig oracle).
 *   P6 non-DOM-host consumers + Phase A flush discipline (trigger-not-journal,
 *      host awaits the flush before asserting).
 *
 * All pins are satisfied by the ALREADY-LANDED machinery (Phase A
 * `Supervisor.dispatchEvent` + the SSRFragmentAdapter + the existing
 * producing-process builder pattern) — this file ENCODES the contract as
 * tests so it cannot silently drift.
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { DomAdapter, SSRFragmentAdapter } from '../../src/core/adapters.js'
import { emitElements, applyOps, treeFromOps, treeSig } from '../../src/core/render-helpers.js'
import { diffMinimal } from '../../src/core/render.js'
import type { RenderOp, RenderAdapter } from '../../src/core/render.js'

// ---------------------------------------------------------------------------
// Minimal DOM shim (the adapters.test.ts pattern) — enough for DomAdapter.
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
  value = ''
  parent: El | null = null
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
    if (this.parent) {
      const i = this.parent.children.indexOf(this)
      if (i !== -1) this.parent.children.splice(i, 1)
      this.parent = null
    }
  }
  querySelector(_sel: string): El | null {
    return null
  }
}
const byId = new Map<string, El>()
const document = {
  createElement: (tag: string) => new El(tag),
  getElementById: (id: string) => {
    if (!byId.has(id)) byId.set(id, new El('div'))
    return byId.get(id)!
  },
  head: { appendChild: () => undefined },
}
beforeAll(() => {
  ;(globalThis as Record<string, unknown>).document = document
})

// ---------------------------------------------------------------------------
// The legacy envelope — a handler-bearing button with an authored css.id.
// ---------------------------------------------------------------------------
const ENV = {
  template: {
    root: {
      type: 'div',
      component: [
        {
          reference: 'SayHi',
          value: {
            name: 'SayHi',
            body: `function (event, context) {
              context.node.receiveNextState({ content: String(event.value == null ? '' : event.value) + '!' });
            }`,
          },
        },
      ],
      children: [
        {
          type: 'button',
          css: { id: 'the-btn' },
          component: [{ reference: 'SayHi', target: 'handlers.click' }],
          content: 'go',
        },
      ],
    },
  },
  content: [],
  clientConfig: { runInstantiation: true, runRendering: true },
}

async function flush(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise((r) => setTimeout(r, 0))
}

interface ProducingProcess {
  sup: Supervisor
  nodes: Array<{ id: string; cssId?: string }>
  nodeById: Map<string, unknown>
  prevStates: Map<string, Array<Record<string, unknown>>>
  render(): { els: unknown[]; ops: RenderOp[] }
  dispatch(target: string, event: string, ...args: unknown[]): Promise<unknown[]>
  cssIdToNode(cssId: string): unknown
}

/** The producing process: translate → register → bootstrap compile →
 *  recordResolved → emit; keeps the graph for later dispatch (P1). */
function producingProcess(adapter: RenderAdapter<unknown, unknown>): ProducingProcess {
  const t = translateLegacy(ENV)
  const sup = new Supervisor({ events: new EventBridge() })
  for (const n of t.nodes) sup.registerNode(n)
  const cr = t.root.compile(t.nodes)
  sup.recordResolved(cr.actionable)
  const nodeById = new Map(t.nodes.map((n) => [n.id, n]))
  const prevStates = new Map<string, Array<Record<string, unknown>>>()
  for (const cs of cr.actionable) {
    const arr = prevStates.get(cs.nodeId) ?? []
    arr.push(cs as unknown as Record<string, unknown>)
    prevStates.set(cs.nodeId, arr)
  }
  let prevMap: Map<string, unknown> | null = null

  function render(): { els: unknown[]; ops: RenderOp[] } {
    const actionable: Array<Record<string, unknown>> = []
    for (const [id, group] of prevStates) {
      const node = nodeById.get(id) as { destroyed?: boolean; isInTree?: boolean } | undefined
      if (node && (node.destroyed || !node.isInTree)) {
        prevStates.delete(id)
        continue
      }
      for (const cs of group) actionable.push(cs)
    }
    const els = emitElements(actionable as never, nodeById as never)
    const ops = diffMinimal(prevMap as never, els as never)
    prevMap = new Map(els.map((e) => [(e as { wire: string }).wire, e]))
    applyOps(adapter, ops)
    return { els, ops }
  }
  render()

  async function dispatch(target: string, event: string, ...args: unknown[]): Promise<unknown[]> {
    const j0 = sup.journal.length
    const r = sup.dispatchEvent(target, event, ...args)
    await flush()
    const states = sup.takePass2States()
    const changed = sup.journal.length !== j0 || states.size > 0
    if (states.size > 0) {
      for (const [id, arr] of states) prevStates.set(id, arr as never)
    }
    // P4/P6 — dispatch NEVER renders (Phase A: trigger-not-journal, no flush,
    // no emit). The graph mutated; the fragment string is untouched until the
    // HOST explicitly re-renders on demand (graph-canon, fragment-is-a-view).
    void changed
    return r
  }

  function cssIdToNode(cssId: string): unknown {
    return t.nodes.find((n) => (n.base.css as { id?: string } | undefined)?.id === cssId) ?? null
  }

  return {
    sup,
    nodes: t.nodes.map((n) => {
      const cssId = (n.base.css as { id?: string } | undefined)?.id
      return cssId === undefined ? { id: n.id } : { id: n.id, cssId }
    }),
    nodeById,
    prevStates,
    render,
    dispatch,
    cssIdToNode,
  }
}

// ---------------------------------------------------------------------------
// Fragment parser — the SSR string is ADDRESSABLE METADATA (P2): read css.id
// + text + the inert inline on<event> back off the emitted HTML.
// ---------------------------------------------------------------------------
interface FragEl {
  type: string
  id: string | null
  text: string
  attrs: Record<string, string>
  children: FragEl[]
}
function parseFragment(html: string): FragEl[] {
  const root: FragEl = { type: '#root', id: null, text: '', attrs: {}, children: [] }
  const stack: FragEl[] = [root]
  const tokenRe = /<(\/?)([a-zA-Z0-9]+)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/g
  let m: RegExpExecArray | null
  while ((m = tokenRe.exec(html))) {
    if (m[5] !== undefined) {
      stack[stack.length - 1]!.text += m[5]
      continue
    }
    const closing = m[1] === '/'
    const tag = m[2]!
    const attrsText = m[3] ?? ''
    if (closing) {
      if (stack.length > 1) stack.pop()
      continue
    }
    const el: FragEl = { type: tag, id: null, text: '', attrs: {}, children: [] }
    const attrRe = /([a-zA-Z0-9:-]+)(?:\s*=\s*"([^"]*)")?/g
    let am: RegExpExecArray | null
    while ((am = attrRe.exec(attrsText))) {
      el.attrs[am[1]!] = am[2] ?? ''
      if (am[1] === 'id') el.id = am[2] ?? null
    }
    const parent = stack[stack.length - 1]!
    parent.children.push(el)
    if (m[4] !== '/') stack.push(el)
  }
  return root.children
}
function flatten(frag: FragEl[]): Array<{ type: string; id: string | null; text: string; onclick?: string }> {
  const out: Array<{ type: string; id: string | null; text: string; onclick?: string }> = []
  for (const el of frag) {
    const rec: { type: string; id: string | null; text: string; onclick?: string } = {
      type: el.type,
      id: el.id,
      text: el.text,
    }
    if (el.attrs['onclick'] !== undefined) rec.onclick = el.attrs['onclick']
    out.push(rec)
    out.push(...flatten(el.children))
  }
  return out
}

// ---------------------------------------------------------------------------
// The contract tests.
// ---------------------------------------------------------------------------
describe('Phase B — SSR synthetic-event contract (producing-process-keeps-graph + fragment-as-addressable-metadata)', () => {
  it('P1/P3 — the producing process keeps the graph after SSR render; the fragment carries an INERT inline on<event>="true" (never the handler body)', () => {
    const ssrAdapter = new SSRFragmentAdapter()
    const producer = producingProcess(ssrAdapter)
    const html = ssrAdapter.toString()
    // the fragment is addressable metadata: the authored css.id + the inert attr
    expect(html).toContain('id="the-btn"')
    expect(html).toContain('onclick="true"')
    // the handler BODY/source is NOT in the fragment (inline attr is constant-true, inert)
    expect(html).not.toContain('receiveNextState')
    // the producing process STILL resolves the node after toString()
    expect(producer.sup.getNode((producer.cssIdToNode('the-btn') as { id: string }).id)).toBeDefined()
  })

  it('P2 — css.id → producing node resolution locates the render target; nodeId dispatch is the authoritative channel', () => {
    const ssrAdapter = new SSRFragmentAdapter()
    const producer = producingProcess(ssrAdapter)
    const node = producer.cssIdToNode('the-btn') as { id: string; handlers?: unknown[] }
    expect(node).toBeDefined()
    expect((node.handlers as Array<{ event?: string }>).some((h) => h.event === 'click')).toBe(true)
  })

  it('P4/P6 — a synthetic event mutates the producing graph; the fragment STRING does not react; a post-apply re-emit reflects the applied state', async () => {
    const ssrAdapter = new SSRFragmentAdapter()
    const producer = producingProcess(ssrAdapter)
    const before = ssrAdapter.toString()
    const node = producer.cssIdToNode('the-btn') as { id: string }
    const results = await producer.dispatch(node.id, 'click', 'hi')
    expect(results).toEqual([undefined]) // the legacy body ran via the engine stub
    // the graph mutated (Phase A trigger → apply → flush)
    expect((producer.sup.getNode(node.id) as { content?: unknown }).content).toBe('hi!')
    // the EXISTING fragment string is a static artifact — it did NOT change
    expect(ssrAdapter.toString()).toBe(before)
    // graph-canon / fragment-is-a-view: re-emit on demand reflects the applied state
    producer.render()
    const after = ssrAdapter.toString()
    expect(after).not.toBe(before)
    expect(after).toContain('hi!')
    expect(flatten(parseFragment(after)).find((e) => e.id === 'the-btn')?.text).toBe('hi!')
  })

  it('P5 — DOM vs SSR parity: the SAME dispatch on each producing graph returns IDENTICAL results, and the post-apply re-emits are structurally equal (PAR-5, treeSig oracle)', async () => {
    const ssrAdapter = new SSRFragmentAdapter()
    const domAdapter = new DomAdapter(document.createElement('div') as unknown as HTMLElement)
    const ssrProducer = producingProcess(ssrAdapter)
    const domProducer = producingProcess(domAdapter)

    // identical HandlerResult[] (the dispatch is on the graph — adapter-independent)
    const ssrNode = ssrProducer.cssIdToNode('the-btn') as { id: string }
    const domNode = domProducer.cssIdToNode('the-btn') as { id: string }
    const [ssrResults, domResults] = await Promise.all([
      ssrProducer.dispatch(ssrNode.id, 'click', 'hello'),
      domProducer.dispatch(domNode.id, 'click', 'hello'),
    ])
    expect(ssrResults).toEqual(domResults)

    // post-apply re-emit structural parity: the canonical op-stream trees match (PAR-5 oracle)
    const ssrOps = ssrProducer.render().ops
    const domOps = domProducer.render().ops
    expect(treeSig(treeFromOps(ssrOps))).toBe(treeSig(treeFromOps(domOps)))

    // the DOM side reflected the apply; the SSR fragment reflects it too
    expect((domProducer.sup.getNode(domNode.id) as { content?: unknown }).content).toBe('hello!')
    expect(ssrAdapter.toString()).toContain('hello!')
  })
})
