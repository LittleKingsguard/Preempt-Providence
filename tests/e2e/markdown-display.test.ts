/**
 * Step 7 e2e — in-place render behavior (markdown editor → display window).
 *
 * Real-world case: a WYSIWYG-ish editor whose source is markdown; typing
 * updates the editor container node; the display window's after-compile
 * handler converts **bold** into a structured strong element. The render
 * must update state IN PLACE — never destroying/replacing an existing
 * element (which would lose focus in a real editor) — for BOTH local
 * changes (the editor itself) and parent changes (the display container).
 */
import { describe, it, expect } from 'vitest'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { diffMinimal, MockAdapter, type RenderOp, type MinimalElement, type RenderAdapter } from '../../src/core/render.js'
import { makeRoot, makeNode, childOf, hub } from '../helpers/fixtures.js'
import { dispatchEvent } from '../../src/core/handlers.js'
import type { HandlerContext } from '../../src/core/handlers.js'
import type { Node } from '../../src/core/node.js'

interface PEl {
  wire: string
  type: string
}

function minimalFromState(cs: { nodeId: string; type: string; props?: Record<string, unknown>; css?: Record<string, unknown>; content?: unknown; children: string[] }): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) props[`css:${k}`] = v
  if (cs.content !== undefined) props['text'] = cs.content
  return { wire: cs.nodeId, type: cs.type, props, childOrder: [...cs.children] }
}

/** Applies ops and returns the live element map (wire → element) so tests
 *  can assert identity — a replaced element means focus loss. */
function applyOps(adapter: RenderAdapter<PEl>, ops: RenderOp[]): Map<string, PEl> {
  const els = new Map<string, PEl>()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        els.set(op.wire, adapter.createEl(op.type, op.wire))
        break
      case 'set':
        adapter.setProp(op.wire, op.name, op.value)
        break
      case 'append': {
        const owner = els.get(op.owner)
        const child = els.get(op.child)
        if (owner && child) adapter.appendChild(owner, child)
        break
      }
      case 'remove': {
        const w = els.get(op.wire)
        if (w && adapter.removeEl) adapter.removeEl(op.wire)
        els.delete(op.wire)
        break
      }
      case 'styles':
        break
    }
  }
  return els
}

interface MarkdownFixture {
  root: Node
  editor: Node
  display: Node
  part0: Node
  part1: Node
  part2: Node
}

/** Split on the first **bold** pair: prefix / bold / suffix. */
function parseBold(md: string): { prefix: string; bold: string; suffix: string } {
  const m = /^(.*?)\*\*([^*]+)\*\*(.*)$/.exec(md)
  if (!m) return { prefix: md, bold: '', suffix: '' }
  return { prefix: m[1]!, bold: m[2]!, suffix: m[3]! }
}

function buildMarkdown(): MarkdownFixture {
  const root = makeRoot({ type: 'app' })
  const editor = childOf(root, makeNode({ type: 'textarea', content: 'Hello **world**!' }), 0)
  const display = childOf(root, makeNode({ type: 'div' }), 1)
  const part0 = childOf(display, makeNode({ type: 'span', content: '' }), 0)
  const part1 = childOf(display, makeNode({ type: 'strong', content: '' }), 1)
  const part2 = childOf(display, makeNode({ type: 'span', content: '' }), 2)
  return { root, editor, display, part0, part1, part2 }
}

function newSystem(f: MarkdownFixture) {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  for (const n of [f.root, f.editor, f.display, f.part0, f.part1, f.part2]) supervisor.registerNode(n)
  const clientAPI = createClient(supervisor)
  const ctx = supervisor.handlerContext

  // display window handler: parse the editor source into structured parts
  f.display.addLayer({
    id: 'md-handler',
    handlers: [
      {
        name: 'markdown:render',
        phase: 'after-compile',
        body: (c: unknown) => {
          const cc = c as HandlerContext
          const src = String(cc.tree.getNode(f.editor.id)?.content ?? '')
          const { prefix, bold, suffix } = parseBold(src)
          cc.clientAPI.apply(f.part0.id, [{ targetProp: 'content', mode: 'replace', value: prefix }])
          cc.clientAPI.apply(f.part1.id, [{ targetProp: 'content', mode: 'replace', value: bold }])
          cc.clientAPI.apply(f.part2.id, [{ targetProp: 'content', mode: 'replace', value: suffix }])
        },
      },
    ],
  })
  // editor input handler: typing updates the source + pokes the display
  f.editor.addLayer({
    id: 'input-handler',
    handlers: [
      {
        name: 'input',
        event: 'input',
        body: (c: unknown, value: unknown) => {
          const cc = c as HandlerContext
          const v = String(value ?? '')
          cc.clientAPI.apply(f.editor.id, [{ targetProp: 'content', mode: 'replace', value: v }])
          cc.clientAPI.apply(f.display.id, [{ targetProp: 'props.tick', mode: 'replace', value: 1 }])
        },
      },
    ],
  })
  return { supervisor, clientAPI, ctx }
}

/** Adapter that retains created elements — identity across updates proves
 *  no element was replaced (replacement ⇒ focus loss in a real editor). */
class TrackingAdapter implements RenderAdapter<PEl> {
  readonly wires = new Map<string, PEl>()
  createEl(type: string, wire: string): PEl {
    const e = { wire, type }
    this.wires.set(wire, e)
    return e
  }
  setProp(): void {}
  appendChild(): void {}
  hydrate(): void {}
  removeEl(wire: string): void {
    this.wires.delete(wire)
  }
}

async function flushTicks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0))
}

const slice = (f: MarkdownFixture): Node[] => [f.root, f.editor, f.display, f.part0, f.part1, f.part2]

describe('e2e — in-place render behavior (Step 7)', () => {
  it('initial render parses **bold** into a strong element', async () => {
    const f = buildMarkdown()
    const { supervisor } = newSystem(f)
    const clientAPI = supervisor.clientAPI
    clientAPI.apply(f.display.id, [{ targetProp: 'props.init', mode: 'replace', value: true }])
    await flushTicks()

    const cr = f.root.compile(slice(f))
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const els = applyOps(new MockAdapter(), ops)
    expect(els.get(f.part1.id)?.type).toBe('strong')
    const boldState = cr.actionable.find((s) => s.nodeId === f.part1.id)
    expect(boldState?.content).toBe('world')
  })

  it('LOCAL change: typing updates the editor IN PLACE — same element, set-only ops, no focus loss', async () => {
    const f = buildMarkdown()
    const { supervisor, ctx } = newSystem(f)
    supervisor.clientAPI.apply(f.display.id, [{ targetProp: 'props.init', mode: 'replace', value: true }])
    await flushTicks()

    // initial render + element identity
    const cr0 = f.root.compile(slice(f))
    const els0 = cr0.actionable.map(minimalFromState)
    const map0 = new Map(els0.map((e) => [e.wire, e]))
    const adapter = new TrackingAdapter()
    applyOps(adapter, diffMinimal(null, els0))
    const editorEl = adapter.wires.get(f.editor.id)
    const boldEl = adapter.wires.get(f.part1.id)
    expect(editorEl).toBeDefined()

    // typing
    dispatchEvent(f.editor, ctx, 'input', 'Goodbye **bold** reader')
    await flushTicks()

    // re-render via diff against the previous element set
    const cr1 = f.root.compile(slice(f))
    const els1 = cr1.actionable.map(minimalFromState)
    const ops1 = diffMinimal(map0, els1)
    applyOps(adapter, ops1)

    // in place: no create/remove for any existing wire — only set
    const existing = new Set(map0.keys())
    expect(ops1.filter((o) => (o.kind === 'create' || o.kind === 'remove') && existing.has(o.wire))).toHaveLength(0)
    // same element objects → focus retained
    expect(adapter.wires.get(f.editor.id)).toBe(editorEl)
    expect(adapter.wires.get(f.part1.id)).toBe(boldEl)
    // markdown re-parsed into the structured nodes
    const boldState = cr1.actionable.find((s) => s.nodeId === f.part1.id)
    expect(boldState?.content).toBe('bold')
    const prefixState = cr1.actionable.find((s) => s.nodeId === f.part0.id)
    expect(prefixState?.content).toBe('Goodbye ')
  })

  it('PARENT change: updating the display container leaves child parts in place', async () => {
    const f = buildMarkdown()
    const { supervisor } = newSystem(f)
    supervisor.clientAPI.apply(f.display.id, [{ targetProp: 'props.init', mode: 'replace', value: true }])
    await flushTicks()

    const cr0 = f.root.compile(slice(f))
    const els0 = cr0.actionable.map(minimalFromState)
    const map0 = new Map(els0.map((e) => [e.wire, e]))
    const adapter = new MockAdapter()
    applyOps(adapter, diffMinimal(null, els0))

    // parent change: the display container's own props
    supervisor.apply({ kind: 'state-slice', node: f.display, mutation: [{ targetProp: 'props.note', mode: 'replace', value: 'x' }] })
    await flushTicks()

    const cr1 = f.root.compile(slice(f))
    const ops1 = diffMinimal(map0, cr1.actionable.map(minimalFromState))
    const existing = new Set(map0.keys())
    // children (parts) never recreated/removed by the parent's update
    expect(ops1.filter((o) => (o.kind === 'create' || o.kind === 'remove') && existing.has(o.wire))).toHaveLength(0)
    // parsed content intact
    const boldState = cr1.actionable.find((s) => s.nodeId === f.part1.id)
    expect(boldState?.content).toBe('world')
  })

  it('no-bold source renders the whole text in the first part; bold stays empty', async () => {
    const f = buildMarkdown()
    const { supervisor, ctx } = newSystem(f)
    supervisor.clientAPI.apply(f.display.id, [{ targetProp: 'props.init', mode: 'replace', value: true }])
    await flushTicks()

    dispatchEvent(f.editor, ctx, 'input', 'plain text, no formatting')
    await flushTicks()

    const cr = f.root.compile(slice(f))
    const boldState = cr.actionable.find((s) => s.nodeId === f.part1.id)
    const prefixState = cr.actionable.find((s) => s.nodeId === f.part0.id)
    expect(boldState?.content).toBe('')
    expect(prefixState?.content).toBe('plain text, no formatting')
  })
})
