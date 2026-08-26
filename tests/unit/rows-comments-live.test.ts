/**
 * LIVE-COMMENTS — a production-realism validation of keyed batch-reuse (1b)
 * + the incremental render loop (Feature 1 / rendering.md §3).
 *
 * Simulates a page with a live-updating comments section fed by a websocket:
 * the host re-mints the full comment set (keyed by id) each time a new comment
 * arrives. The engine must REUSE the existing comment row nodes (stable ids)
 * so the render diff only ADDS the new comment's element — the existing
 * comment DOM nodes never regenerate (no re-create, no re-remove).
 *
 *   C1  first render of N comments → N consumer arms (fork-arm elements).
 *   C2  a websocket-delivered new comment (keyed re-mint of the full set) →
 *       the render diff is CREATE-the-new-arm ONLY: 0 removes, and the reused
 *       comments' arm wires are UNCHANGED (set on their own arms, no re-create).
 *   C3  the reused comment row NODES keep their ids (keyed identity — R3).
 *   C4  a comment that disappears is REMOVED (remove-missing → the arm is
 *       removed from the diff), never silently left stale.
 */
import { describe, it, expect } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub } from '../../src/core/translate.js'
import { registerDefPrototypes } from '../../src/core/registry.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { diffMinimal, type MinimalElement } from '../../src/core/render.js'

type WireMap = Map<string, MinimalElement>

/** A live-comments section: a def prototype + a consumer that resolves each
 *  comment row's `name` field → one fork-arm element per comment. */
function commentsSection() {
  const h = createLinkHub()
  const proto = new Node({ type: 'li', props: { cls: 'comment-row' } }, h, 'proto-1')
  registerDefPrototypes(h.linkFor('comment-row', 'component'), [proto])
  const root = new Node({ type: 'div' }, h, 'root')
  const creator = new Node({ type: 'section' }, h, 'comments')
  const consumer = new Node({ type: 'span' }, h, 'comment-text')
  consumer.addAnchor('target', 'name', {}, h.linkFor('name', 'component'))
  const sup = new Supervisor({ hub: h, events: new EventBridge() })
  sup.registerNode(root)
  sup.registerNode(consumer)
  sup.registerNode(creator)
  sup.apply({ kind: 'attach', node: consumer, to: root })
  sup.apply({ kind: 'attach', node: creator, to: consumer })
  return { h, root, creator, consumer, sup }
}

function rowNodeByKey(creator: Node, key: unknown): Node | undefined {
  return creator.children.find((c) => {
    const s = c.anchors.find((a) => a.target === 'id')
    return s !== undefined && s.value === key
  })
}

/** The host's per-websocket-message re-mint: key the full current comment set. */
function applyComments(sup: Supervisor, creator: Node, comments: Array<{ id: string; name: string }>) {
  return sup.apply({
    kind: 'rows-mint',
    target: creator,
    hookName: 'comments',
    mintKind: 'component',
    prototypeName: 'comment-row',
    keyField: 'id',
    rows: comments,
  } as never)
}

/** Render the consumer's current arms → { elements, ops, nextMap }. */
function renderConsumer(creator: Node, consumer: Node, sup: Supervisor, prevMap: WireMap | null) {
  const cr = consumer.compile(sup.allNodes())
  const states = cr.actionable.filter((s) => s.nodeId === consumer.id)
  const nodeById = new Map(sup.allNodes().map((n) => [n.id, n]))
  const els = emitElements(states, nodeById)
  const ops = diffMinimal(prevMap, els)
  const map = new Map(els.map((e) => [e.wire, e]))
  return { els, ops, map }
}

describe('live-comments — keyed batch-reuse keeps existing comment DOM stable across websocket updates', () => {
  it('C1 — first render of 2 comments creates 2 consumer arms (the row elements)', async () => {
    const { creator, consumer, sup } = commentsSection()
    applyComments(sup, creator, [{ id: 'c1', name: 'Alice' }, { id: 'c2', name: 'Bob' }])
    await new Promise((r) => setTimeout(r, 30))
    const { els, ops } = renderConsumer(creator, consumer, sup, null)
    expect(els.map((e) => e.wire).sort()).toEqual(['comment-text#0', 'comment-text#1'])
    // 2 arms created on the first render
    expect(ops.filter((o) => o.kind === 'create').length).toBe(2)
  })

  it('C2 — a new websocket comment creates ONLY its own arm; the existing arms are NOT regenerated', async () => {
    const { creator, consumer, sup } = commentsSection()
    applyComments(sup, creator, [{ id: 'c1', name: 'Alice' }, { id: 'c2', name: 'Bob' }])
    await new Promise((r) => setTimeout(r, 30))
    const r1 = renderConsumer(creator, consumer, sup, null)

    // the websocket delivers comment c3 → the host re-mints the full set keyed by id
    applyComments(sup, creator, [{ id: 'c1', name: 'Alice' }, { id: 'c2', name: 'Bob' }, { id: 'c3', name: 'Carol' }])
    await new Promise((r) => setTimeout(r, 30))
    const r2 = renderConsumer(creator, consumer, sup, r1.map)

    // 3 arms now
    expect(r2.els.map((e) => e.wire).sort()).toEqual(['comment-text#0', 'comment-text#1', 'comment-text#2'])
    // the incremental diff creates EXACTLY the new arm and removes NOTHING
    const creates = r2.ops.filter((o) => o.kind === 'create')
    expect(creates.length).toBe(1)
    expect(r2.ops.filter((o) => o.kind === 'remove')).toHaveLength(0)
    // the new arm is the third one
    expect(creates[0]!.wire).toBe('comment-text#2')
    // the reused arms (c1, c2) are updated in place on their OWN wires — never re-created
    const createdWires = new Set(r2.els.filter((e) => r2.ops.some((o) => o.kind === 'create' && o.wire === e.wire)).map((e) => e.wire))
    expect(createdWires.has('comment-text#0')).toBe(false)
    expect(createdWires.has('comment-text#1')).toBe(false)
  })

  it('C3 — the reused comment row NODES keep their ids (keyed identity), so their arms are stable', async () => {
    const { creator, consumer, sup } = commentsSection()
    applyComments(sup, creator, [{ id: 'c1', name: 'Alice' }, { id: 'c2', name: 'Bob' }])
    const c1Before = rowNodeByKey(creator, 'c1')!.id
    const c2Before = rowNodeByKey(creator, 'c2')!.id
    // a new comment arrives; c1/c2 stay
    applyComments(sup, creator, [{ id: 'c1', name: 'Alice' }, { id: 'c2', name: 'Bob' }, { id: 'c3', name: 'Carol' }])
    expect(rowNodeByKey(creator, 'c1')!.id).toBe(c1Before)
    expect(rowNodeByKey(creator, 'c2')!.id).toBe(c2Before)
    expect(rowNodeByKey(creator, 'c3')).toBeDefined()
    await new Promise((r) => setTimeout(r, 30))
  })

  it('C4 — a comment that disappears is REMOVED from the render (remove-missing → the arm is removed)', async () => {
    const { creator, consumer, sup } = commentsSection()
    applyComments(sup, creator, [{ id: 'c1', name: 'Alice' }, { id: 'c2', name: 'Bob' }, { id: 'c3', name: 'Carol' }])
    await new Promise((r) => setTimeout(r, 30))
    const r1 = renderConsumer(creator, consumer, sup, null)
    expect(r1.els.length).toBe(3)

    // the websocket indicates c2 was deleted → the host re-mints without it
    applyComments(sup, creator, [{ id: 'c1', name: 'Alice' }, { id: 'c3', name: 'Carol' }])
    await new Promise((r) => setTimeout(r, 30))
    const r2 = renderConsumer(creator, consumer, sup, r1.map)
    expect(r2.els.map((e) => e.wire).sort()).toEqual(['comment-text#0', 'comment-text#1'])
    // the removed comment's arm is REMOVED (not left stale), and nothing is re-created
    expect(r2.ops.filter((o) => o.kind === 'remove').length).toBe(1)
    expect(r2.ops.filter((o) => o.kind === 'create')).toHaveLength(0)
  })
})
