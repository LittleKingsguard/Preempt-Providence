/**
 * Step 6 integration — payload lifecycle with edits surviving refresh.
 * Article + comments payloads from a translated legacy doc: editing the
 * article, appending comments (websocket), refreshing the article — user
 * edits on one payload must survive changes to another, and the reverse
 * translation must reflect the live state.
 */
import { describe, it, expect } from 'vitest'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { translateLegacy, reverseTranslate } from '../../src/core/translate.js'
import { dropPayload, appendToPayload, refreshPayload, nextPriority, type Payload } from '../../src/core/payload.js'
import { hub, makeNode } from '../helpers/fixtures.js'
import type { Node } from '../../src/core/node.js'

function doc() {
  return {
    template: {
      root: { type: 'app', children: [{ type: 'header', content: 'News' }] },
    },
    content: [
      {
        metadata: { kind: 'article' },
        content: [{ type: 'article', content: 'original story' }],
      },
      {
        metadata: { kind: 'comments' },
        content: [{ type: 'comment', content: 'first!' }],
      },
    ],
    clientConfig: { runMonitoring: true },
  }
}

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const clientAPI = createClient(supervisor)
  return { supervisor, clientAPI, events }
}

describe('integration — payload lifecycle (Step 6)', () => {
  it('editing one payload survives appending to and refreshing another', async () => {
    const { supervisor, clientAPI } = newSystem()
    const t = translateLegacy(doc() as never)
    for (const n of t.nodes) supervisor.registerNode(n)
    const article = t.content[0]!
    const comments = t.content[1]!
    const articlePayload: Payload = { id: 'article', roots: [article] }
    const commentsPayload: Payload = { id: 'comments', roots: [comments] }

    // place the payloads into zones (attach under root) — content becomes editable
    for (const c of [article, comments]) {
      const link = t.root.anchors.find((a) => a.role === 'parent')!.link as never
      c.addAnchor('child', c, { priority: nextPriority(t.root) }, link)
    }

    // user edits the COMMENTS payload (typing) — must survive the article refresh
    clientAPI.apply(comments.id, [{ targetProp: 'content', mode: 'replace', value: 'edited comment' }])
    expect(comments.content).toBe('edited comment')

    // websocket appends a comment
    const c2 = makeNode({ type: 'comment', content: 'second!' })
    supervisor.registerNode(c2)
    appendToPayload(commentsPayload, [c2], t.root)
    expect(c2.state).toBe('in-tree')
    expect(commentsPayload.roots).toEqual([comments, c2])

    // article refreshed with a new story — comments' edit + append untouched
    const newStory = makeNode({ type: 'article', content: 'breaking news' })
    supervisor.registerNode(newStory)
    refreshPayload(articlePayload, [newStory], t.root)

    expect(newStory.state).toBe('in-tree')
    expect(article.state).toBe('unplaced') // dropped, swept async
    expect(c2.state).toBe('in-tree')
    expect(commentsPayload.roots.map((r) => r.content)).toEqual(['edited comment', 'second!'])

    // reverse translation: each payload reverses as its own ContentPayload,
    // carrying the LIVE state (fresh article; comments edit + append kept)
    const out = reverseTranslate(t.root, {
      payloads: [
        { roots: articlePayload.roots, metadata: { kind: 'article' } },
        { roots: commentsPayload.roots, metadata: { kind: 'comments' } },
      ],
    })
    expect(out.content).toHaveLength(2)
    const articleOut = out.content![0]!.content.find((c) => c.type === 'article')!
    expect(articleOut.content).toBe('breaking news')
    expect(out.content![1]!.content.map((c) => c.content)).toEqual(['edited comment', 'second!'])
  })

  it('dropping a payload removes its nodes; other payloads stay rendered', async () => {
    const { supervisor } = newSystem()
    const t = translateLegacy(doc() as never)
    for (const n of t.nodes) supervisor.registerNode(n)
    const article = t.content[0]!
    const comments = t.content[1]!
    const articlePayload: Payload = { id: 'article', roots: [article] }

    dropPayload(articlePayload)
    expect(article.state).toBe('unplaced')
    expect(comments.state).toBe('unplaced') // content stays unplaced until placed
    const res = t.root.compile(t.nodes)
    expect(res.actionable.map((s) => s.nodeId)).not.toContain(article.id)
  })
})
