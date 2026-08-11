/**
 * payload.ts unit contract — content-payload lifecycle.
 * Written against the STUB surface; drop/refresh/append must make every
 * assertion pass.
 */
import { describe, it, expect } from 'vitest'
import { dropPayload, refreshPayload, appendToPayload, nextPriority, type Payload } from '../../src/core/payload.js'
import { registerContentNode } from '../../src/core/registry.js'
import { makeRoot, makeNode, childOf } from '../helpers/fixtures.js'
import type { Node } from '../../src/core/node.js'

async function drainSweep(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await new Promise<void>((r) => queueMicrotask(r))
  await new Promise<void>((r) => setTimeout(r, 0))
}

function makePayload(id: string, root: Node): Payload {
  return { id, roots: [root] }
}

describe('payload — dropPayload', () => {
  it('detaches in-tree payload roots; they cascade-destroy via the sweep; other payloads untouched', async () => {
    const root = makeRoot()
    const article = childOf(root, makeNode({ type: 'article', content: 'A' }), 0)
    const comments = childOf(root, makeNode({ type: 'comments', content: 'C' }), 1)
    const pArticle = makePayload('article', article)
    const pComments = makePayload('comments', comments)

    dropPayload(pArticle)
    expect(article.state).toBe('unplaced') // not destroyed synchronously
    expect(article.isInTree).toBe(false)

    await drainSweep()
    expect(article.state).toBe('destroyed')
    expect(root.children.map((c) => c.id)).not.toContain(article.id)
    // sibling payload untouched
    expect(comments.state).toBe('in-tree')
    expect(root.children.map((c) => c.id)).toContain(comments.id)
  })

  it('dropping an unplaced payload root destroys it', async () => {
    const article = makeNode({ type: 'article' })
    dropPayload(makePayload('p', article))
    await drainSweep()
    expect(article.state).toBe('destroyed')
  })

  it('re-attaching before the sweep blocks destruction', async () => {
    const root = makeRoot()
    const article = childOf(root, makeNode({ type: 'article' }), 0)
    dropPayload(makePayload('p', article))
    childOf(root, article) // same-tick re-attach
    await drainSweep()
    expect(article.state).toBe('in-tree')
    expect(article.destroyed).toBe(false)
  })

  it('payload-owned content PERSISTS in the background when detached while the payload still owns it (placement may return)', async () => {
    const root = makeRoot()
    const content = childOf(root, makeNode({ type: 'article' }), 0) // placed
    registerContentNode(content) // payload owns it
    const payload = makePayload('p', content)

    // placement is removed (detached) — but the payload still owns the node
    const link = (content.childAnchor()!.link as unknown as { destroy(): void })
    link.destroy()
    expect(content.state).toBe('unplaced')

    await drainSweep()
    // persists in the background — NOT destroyed, ready for re-placement
    expect(content.destroyed).toBe(false)
    expect(content.state).toBe('unplaced')
    expect(payload.roots).toEqual([content])
  })

  it('PLACED payload content is dropped with its payload (even though moved in by placement)', async () => {
    const root = makeRoot()
    const content = childOf(root, makeNode({ type: 'article' }), 0)
    registerContentNode(content)
    const payload = makePayload('p', content)

    dropPayload(payload)
    await drainSweep()
    expect(content.state).toBe('destroyed')
    expect(root.children.map((c) => c.id)).not.toContain(content.id)
    expect(payload.roots).toHaveLength(0)
  })

  it('handler-created nodes (no payload basis) are discarded once they lose root visibility', async () => {
    const root = makeRoot()
    const ghost = childOf(root, makeNode({ type: 'ghost' }), 0) // created wholecloth, no payload
    const link = (ghost.childAnchor()!.link as unknown as { destroy(): void })
    link.destroy()
    await drainSweep()
    expect(ghost.state).toBe('destroyed')
  })
})

describe('payload — refreshPayload', () => {
  it('replaces old roots with new ones under the same parent; old destroyed, new in-tree', async () => {
    const root = makeRoot()
    const oldArticle = childOf(root, makeNode({ type: 'article', content: 'old' }), 0)
    const comments = childOf(root, makeNode({ type: 'comments' }), 1)
    const payload = makePayload('article', oldArticle)

    const newArticle = makeNode({ type: 'article', content: 'new' })
    refreshPayload(payload, [newArticle], root)

    expect(payload.roots).toEqual([newArticle])
    await drainSweep()
    expect(oldArticle.state).toBe('destroyed')
    expect(newArticle.state).toBe('in-tree')
    expect(newArticle.parent).toBe(root)
    expect(root.children.map((c) => c.id)).toContain(newArticle.id)
    expect(root.children.map((c) => c.id)).not.toContain(oldArticle.id)
    expect(comments.state).toBe('in-tree') // other payload untouched
  })
})

describe('payload — appendToPayload', () => {
  it('attaches new nodes under the parent, keeps existing roots, priorities continue', async () => {
    const root = makeRoot()
    const first = childOf(root, makeNode({ type: 'comment' }), 0)
    const second = childOf(root, makeNode({ type: 'comment' }), 1)
    const payload = makePayload('comments', first)
    payload.roots.push(second)

    const third = makeNode({ type: 'comment' })
    appendToPayload(payload, [third], root)

    expect(payload.roots).toEqual([first, second, third])
    expect(third.state).toBe('in-tree')
    expect(third.parent).toBe(root)
    expect(root.children).toContain(third)
    // priorities: first=0, second=1, third=2
    const prio = third.childAnchor()?.options.priority
    expect(prio).toBe(2)
    // existing roots untouched
    expect(first.content).toBeUndefined()
  })
})

describe('payload — nextPriority', () => {
  it('returns max child priority + 1 (0 for a childless parent)', () => {
    const root = makeRoot()
    expect(nextPriority(root)).toBe(0)
    childOf(root, makeNode(), 3)
    childOf(root, makeNode(), 7)
    expect(nextPriority(root)).toBe(8)
  })
})
