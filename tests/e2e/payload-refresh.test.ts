/**
 * Step 7 e2e — payload lifecycle end-to-end.
 *
 * Legacy backend doc (article + comments payloads) → translate → render →
 * place payloads → user edit (typing) → websocket append → article refresh →
 * re-render (in-place, only changed wires) → reverse translation to backend
 * format with live state (fresh article; comments edit + append kept).
 */
import { describe, it, expect } from 'vitest'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { diffMinimal, MockAdapter, type RenderOp, type MinimalElement } from '../../src/core/render.js'
import { translateLegacy, reverseTranslate } from '../../src/core/translate.js'
import { appendToPayload, refreshPayload, nextPriority, type Payload } from '../../src/core/payload.js'
import { hub, makeNode } from '../helpers/fixtures.js'
import type { Node } from '../../src/core/node.js'

function minimalFromState(cs: { nodeId: string; type: string; props?: Record<string, unknown>; css?: Record<string, unknown>; content?: unknown; children: string[] }): MinimalElement {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) props[`css:${k}`] = v
  if (cs.content !== undefined) props['text'] = cs.content
  return { wire: cs.nodeId, type: cs.type, props, childOrder: [...cs.children] }
}

function legacyDoc() {
  return {
    template: { root: { type: 'app', children: [{ type: 'header', content: 'News' }] } },
    content: [
      { metadata: { kind: 'article' }, content: [{ type: 'article', content: 'original story' }] },
      { metadata: { kind: 'comments' }, content: [{ type: 'comment', content: 'first!' }] },
    ],
    clientConfig: { runMonitoring: true },
  }
}

describe('e2e — payload lifecycle (Step 7)', () => {
  it('edit + websocket append + article refresh: re-renders in place; reverse keeps live state', async () => {
    const events = new EventBridge()
    const supervisor = new Supervisor({ hub: hub(), events })
    const t = translateLegacy(legacyDoc() as never)
    for (const n of t.nodes) supervisor.registerNode(n)
    const clientAPI = createClient(supervisor)

    const article = t.content[0]!
    const comments = t.content[1]!
    const articlePayload: Payload = { id: 'article', roots: [article] }
    const commentsPayload: Payload = { id: 'comments', roots: [comments] }

    // place payloads into zones (in-tree → renderable + editable)
    for (const c of [article, comments]) {
      const link = t.root.anchors.find((a) => a.role === 'parent')!.link as never
      c.addAnchor('child', c, { priority: nextPriority(t.root) }, link)
    }
    const slice: Node[] = [...t.nodes]

    const render = (prev: Map<string, MinimalElement> | null): { ops: RenderOp[]; map: Map<string, MinimalElement> } => {
      const cr = t.root.compile(slice)
      const els = cr.actionable.map(minimalFromState)
      const ops = diffMinimal(prev, els)
      return { ops, map: new Map(els.map((e) => [e.wire, e])) }
    }

    // initial render
    let { ops: ops0, map: prev } = render(null)
    expect(ops0.filter((o) => o.kind === 'create').map((o) => o.wire)).toContain(article.id)
    expect(ops0.filter((o) => o.kind === 'create').map((o) => o.wire)).toContain(comments.id)

    // user edit (typing on the comment) + websocket append + article refresh
    clientAPI.apply(comments.id, [{ targetProp: 'content', mode: 'replace', value: 'edited comment' }])
    const c2 = makeNode({ type: 'comment', content: 'second!' })
    supervisor.registerNode(c2)
    slice.push(c2)
    appendToPayload(commentsPayload, [c2], t.root)
    const newStory = makeNode({ type: 'article', content: 'breaking news' })
    supervisor.registerNode(newStory)
    slice.push(newStory)
    refreshPayload(articlePayload, [newStory], t.root)

    // re-render diff: existing wires updated in place, new wires created, dropped wire removed
    let { ops: ops1 } = render(prev)
    const existing = new Set(prev.keys())
    const droppedOps = ops1.filter((o) => o.kind === 'remove' && o.wire === article.id)
    expect(droppedOps).toHaveLength(1) // old article removed
    expect(ops1.filter((o) => o.kind === 'create' && (o.wire === newStory.id || o.wire === c2.id))).toHaveLength(2)
    // unchanged existing wires never recreated
    expect(ops1.filter((o) => o.kind === 'create' && existing.has(o.wire))).toHaveLength(0)
    // edits land as set ops on the comment wire
    expect(ops1.filter((o) => o.kind === 'set' && o.wire === comments.id && o.value === 'edited comment')).toHaveLength(1)

    // reverse translation: backend format with live state, payloads separate
    const out = reverseTranslate(t.root, {
      payloads: [
        { roots: articlePayload.roots, metadata: { kind: 'article' } },
        { roots: commentsPayload.roots, metadata: { kind: 'comments' } },
      ],
    })
    expect(out.content).toHaveLength(2)
    expect(out.content![0]!.content[0]!.content).toBe('breaking news')
    expect(out.content![1]!.content.map((c) => c.content)).toEqual(['edited comment', 'second!'])
    // reversed doc round-trips back through the same pipeline
    const again = translateLegacy(out as never)
    expect(again.content.map((c) => c.content)).toContain('breaking news')
    expect(again.content.map((c) => c.content)).toContain('edited comment')
    void ops0
    void ops1
    void MockAdapter
  })
})
