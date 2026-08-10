import { describe, it, expect } from 'vitest'
import { Link, DEFAULT_PARENT_CHILD, DEFAULT_COMPONENT, DEFAULT_PLACEMENT, mintLinkId } from '../../src/core/link.js'
import { LinkConfigError, SingleParentError, CycleError } from '../../src/core/errors.js'
import type { Anchor, LinkConfig, Role } from '../../src/core/types.js'
import { makeRoot, makeNode, makePrototype, childOf, anchorsOf } from '../helpers/fixtures.js'

type ExpectedAnchor = {
  role: Role
  target: Anchor['target']
  options: Anchor['options']
}

/**
 * Serialize a Link's anchor set — order-sensitive "byte" image used to prove
 * atomicity (§4.3): rejecting ops must leave the link in its exact pre-call state.
 */
function anchorKey(link: Link): string {
  return link.anchors
    .map(a => `${a.role}@${a.link.id}:${typeof a.target === 'string' ? `#${a.target}` : (a.target as { id: string }).id}:${JSON.stringify(a.options)}`)
    .join('|')
}

/** Serialize a whole node's anchor set so a rejected op provably left the graph untouched. */
function nodeKey(node: ReturnType<typeof makeNode>): string {
  return node.anchors
    .map(a => `${a.role}@${a.link.id}:${typeof a.target === 'string' ? `#${a.target}` : (a.target as { id: string }).id}:${JSON.stringify(a.options)}`)
    .join('|')
}

/**
 * Run an op expecting a LinkConfigError and assert the full §4.2 envelope
 * (code / linkId / serialized config snapshot / detail / atomicity).
 */
function assertLinkError(
  op: () => unknown,
  link: Link,
  code: LinkConfigError['code'],
  opts?: {
    intended?: ExpectedAnchor
    conflicts?: (conflicting: Anchor[]) => void
  },
): LinkConfigError {
  const before = link.anchors.slice()
  const beforeKey = anchorKey(link)
  let thrown: unknown
  try {
    op()
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(LinkConfigError)
  const err = thrown as LinkConfigError
  expect(err.code).toBe(code)
  expect(err.linkId).toBe(link.id)
  expect(err.config).toEqual(link.config)
  expect(err.detail.currentCell).toEqual(link.anchors)
  if (opts?.intended) expect(err.detail.intendedAnchor).toEqual(opts.intended)
  if (opts?.conflicts) opts.conflicts(err.detail.conflicting)
  expect(link.anchors).toEqual(before)
  expect(anchorKey(link)).toBe(beforeKey)
  expect(link.anchors.length).toBe(before.length)
  before.forEach((a, i) => expect(link.anchors[i]).toBe(a))
  return err
}

/** True when `e` is any of the loop/single-parent/config violators the graph spec admits. */
function isGraphViolation(e: unknown): boolean {
  return e instanceof CycleError || e instanceof SingleParentError || e instanceof LinkConfigError
}

async function drainSweep(): Promise<void> {
  for (let i = 0; i < 8; i++) await new Promise<void>(r => queueMicrotask(r))
  await new Promise<void>(r => setTimeout(r, 0))
}

describe('g — Link/Anchor graph matrix (G1–G20)', () => {
  it('G1 attach child with fresh order on existing family link → 1 parent + n child anchors, unique priorities', () => {
    const root = makeRoot()
    const first = makeNode({ type: 'a' })
    const second = makeNode({ type: 'b' })
    childOf(root, first, 10)
    childOf(root, second, 20)

    const family = anchorsOf(first, 'child')[0]!.link
    const parentAnchors = family.anchorsOf('parent')
    const childAnchors = family.anchorsOf('child')
    expect(parentAnchors).toHaveLength(1)
    expect(childAnchors).toHaveLength(2)
    expect(anchorsOf(root, 'parent')).toHaveLength(1)
    expect(anchorsOf(first, 'child')).toHaveLength(1)
    expect(anchorsOf(second, 'child')).toHaveLength(1)
    expect(anchorsOf(first, 'child')[0]!.link).toBe(family)
    expect(anchorsOf(second, 'child')[0]!.link).toBe(family)

    const priorities = childAnchors.map(c => c.options.priority)
    expect(new Set(priorities).size).toBe(priorities.length)
    expect([...priorities].sort((a, b) => (a! - b!))).toEqual([10, 20])
    expect(mintLinkId()).not.toBe(family.id)
  })

  it('G2 attach on a childless parent creates the family parent anchor and satisfies parent.count:1 (S-R3.13)', () => {
    const parent = makeNode({ type: 'p' })
    expect(anchorsOf(parent, 'parent')).toHaveLength(0)

    const kid = makeNode({ type: 'k' })
    childOf(parent, kid)

    const parentAnchors = anchorsOf(parent, 'parent')
    expect(parentAnchors).toHaveLength(1)
    const family = parentAnchors[0]!.link
    expect(family.config).toEqual(DEFAULT_PARENT_CHILD)
    expect(family.anchorsOf('parent')).toHaveLength(1)
    expect(family.anchorsOf('child')).toHaveLength(1)
    expect(kid.parent).toBe(parent)
  })

  it('G3 addAnchor child with a colliding order → unique-order, conflicting = holder, link byte-identical', () => {
    const parent = makeNode()
    const held = makeNode({ type: 'held' })
    const blocked = makeNode({ type: 'blocked' })
    childOf(parent, held, 5)

    const family = anchorsOf(held, 'child')[0]!.link
    const holder = family.anchorsOf('child').find(c => c.target === held)!

    const err = assertLinkError(
      () => childOf(parent, blocked, 5),
      family,
      'unique-order',
      {
        intended: { role: 'child', target: blocked, options: { priority: 5 } },
        conflicts: c => {
          expect(c).toHaveLength(1)
          expect(c[0]).toBe(holder)
          expect(c[0]!.options.priority).toBe(5)
        },
      },
    )
    expect(err.detail.conflicting[0]).toBe(holder)
    expect(anchorsOf(blocked, 'child')).toHaveLength(0)
    expect(anchorsOf(held, 'child')).toHaveLength(1)
    expect(family.anchorsOf('child')).toHaveLength(1)
  })

  it('G4 after unique-order, retry at max+1 succeeds and existing anchors are NOT reindexed (S3.2)', () => {
    const parent = makeNode()
    const held = makeNode()
    const retry = makeNode()
    childOf(parent, held, 5)
    const family = anchorsOf(held, 'child')[0]!.link

    expect(() => childOf(parent, retry, 5)).toThrow(LinkConfigError)
    const priorities = family.children().map(c => c.options.priority ?? 0)
    const next = Math.max(...priorities) + 1

    childOf(parent, retry, next)

    expect(anchorsOf(retry, 'child')).toHaveLength(1)
    expect(anchorsOf(retry, 'child')[0]!.link).toBe(family)
    expect(family.anchorsOf('child')).toHaveLength(2)
    expect(anchorsOf(held, 'child')[0]!.options.priority).toBe(5)
    expect(anchorsOf(retry, 'child')[0]!.options.priority).toBe(next)
    expect([...family.children().map(c => c.options.priority)].sort((a, b) => (a! - b!))).toEqual([5, next])
    expect(new Set(family.children().map(c => c.options.priority)).size).toBe(2)
  })

  it('G5 setOrder onto a held priority → unique-order, conflicting = holder, link unchanged', () => {
    const parent = makeNode()
    const a = makeNode()
    const b = makeNode()
    childOf(parent, a, 1)
    childOf(parent, b, 2)
    const family = anchorsOf(a, 'child')[0]!.link
    const holder = family.anchorsOf('child').find(c => c.target === b)!

    const err = assertLinkError(
      () => family.setOrder(anchorsOf(a, 'child')[0]!, 2),
      family,
      'unique-order',
      { conflicts: c => expect(c).toEqual([holder]) },
    )
    expect(err.detail.conflicting[0]).toBe(holder)
    expect(family.anchorsOf('child')[0]!.options.priority).toBe(1)
    expect(family.anchorsOf('child')[1]!.options.priority).toBe(2)
  })

  it('G6 setOrder out of range (NaN / Infinity) rejects and the link is unchanged', () => {
    const parent = makeNode()
    const a = makeNode()
    childOf(parent, a, 7)
    const family = anchorsOf(a, 'child')[0]!.link
    const anchor = family.anchorsOf('child')[0]!
    const before = family.anchors.slice()

    expect(() => family.setOrder(anchor, NaN)).toThrow()
    expect(family.anchors).toEqual(before)
    expect(anchor.options.priority).toBe(7)

    expect(() => family.setOrder(anchor, Infinity)).toThrow()
    expect(family.anchors).toEqual(before)
    expect(anchor.options.priority).toBe(7)
  })

  it('G7 adding a 2nd parent anchor → count-exceeded, link byte-identical', () => {
    const parent = makeNode()
    const kid = makeNode()
    childOf(parent, kid)
    const family = anchorsOf(kid, 'child')[0]!.link
    const existingParent = family.anchorsOf('parent')[0]!
    const offender = makeNode({ type: 'x' })

    const err = assertLinkError(
      () => family.addAnchor({ role: 'parent', target: offender, options: {}, link: family }),
      family,
      'count-exceeded',
      {
        intended: { role: 'parent', target: offender, options: {} },
        conflicts: c => expect(c).toEqual([existingParent]),
      },
    )
    expect(err.detail.conflicting[0]).toBe(existingParent)
    expect(family.anchorsOf('parent')).toHaveLength(1)
  })

  it('G8 removeAnchor(parent) → count-underflow, parent anchor survives, link byte-identical', () => {
    const parent = makeNode()
    const kid = makeNode()
    childOf(parent, kid)
    const family = anchorsOf(kid, 'child')[0]!.link
    const parentAnchor = family.anchorsOf('parent')[0]!

    const err = assertLinkError(
      () => family.removeAnchor(parentAnchor),
      family,
      'count-underflow',
      { conflicts: c => expect(c).toEqual([parentAnchor]) },
    )
    expect(err.detail.conflicting[0]).toBe(parentAnchor)
    expect(family.anchorsOf('parent')).toHaveLength(1)
  })

  it('G9 removeAnchor(last child) → count-underflow, child intact, link byte-identical', () => {
    const parent = makeNode()
    const kid = makeNode()
    childOf(parent, kid)
    const family = anchorsOf(kid, 'child')[0]!.link
    const childAnchor = family.anchorsOf('child')[0]!

    const err = assertLinkError(
      () => family.removeAnchor(childAnchor),
      family,
      'count-underflow',
      { conflicts: c => expect(c).toEqual([childAnchor]) },
    )
    expect(err.detail.conflicting[0]).toBe(childAnchor)
    expect(family.anchorsOf('child')).toHaveLength(1)
    expect(anchorsOf(kid, 'child')).toHaveLength(1)
  })

  it('G10 link.destroy() after a rejected removal disposes the edge: anchors empty, children orphaned, nodes → unplaced', () => {
    const root = makeRoot()
    const kid = makeNode()
    childOf(root, kid)
    const family = anchorsOf(kid, 'child')[0]!.link

    expect(() => family.removeAnchor(family.anchorsOf('parent')[0]!)).toThrow(LinkConfigError)
    family.destroy()

    expect(family.anchors).toHaveLength(0)
    expect(anchorsOf(kid, 'child')).toHaveLength(0)
    expect(anchorsOf(root, 'parent')).toHaveLength(0)
    expect(kid.parent).toBeNull()
    expect(kid.state).toBe('unplaced')
    expect(root.children).toHaveLength(0)
  })

  it('G11 addAnchor with a role outside config.roles → role-mismatch, link byte-identical', () => {
    const component = new Link(DEFAULT_COMPONENT)

    const err = assertLinkError(
      () => component.addAnchor({ role: 'placement', target: 'slot-a', options: {}, link: component }),
      component,
      'role-mismatch',
      {
        intended: { role: 'placement', target: 'slot-a', options: {} },
        conflicts: c => expect(c).toEqual([]),
      },
    )
    expect(component.config).toEqual(DEFAULT_COMPONENT)

    const placement = new Link(DEFAULT_PLACEMENT)
    assertLinkError(
      () => placement.addAnchor({ role: 'parent', target: 'nobody', options: {}, link: placement }),
      placement,
      'role-mismatch',
    )
    expect(placement.anchors).toHaveLength(0)
  })

  it('G12 second child-role anchor on an in-tree node → SingleParentError with the child\'s nodeId (cross-link, op-level)', () => {
    const pa = makeNode()
    const pb = makeNode()
    const kid = makeNode()
    childOf(pa, kid)

    const beforeKid = nodeKey(kid)
    let err: SingleParentError | undefined
    try {
      childOf(pb, kid)
    } catch (e) {
      if (e instanceof SingleParentError) err = e
    }
    expect(err).toBeInstanceOf(SingleParentError)
    expect(err?.nodeId).toBe(kid.id)
    expect(anchorsOf(kid, 'child')).toHaveLength(1)
    expect(nodeKey(kid)).toBe(beforeKid)
    expect(kid.parent).toBe(pa)
  })

  it('G13 a childless parent carries zero parent anchors until the first child attaches (S-R3.4/S-R3.13)', () => {
    const parent = makeNode()
    expect(anchorsOf(parent, 'parent')).toHaveLength(0)

    const kid = makeNode()
    childOf(parent, kid)

    expect(anchorsOf(parent, 'parent')).toHaveLength(1)
    const family = anchorsOf(kid, 'child')[0]!.link
    expect(family.anchorsOf('parent')).toHaveLength(1)
    expect(family.anchorsOf('child')).toHaveLength(1)
  })

  it('G14 attach A under its own descendant D → cycle guard rejects, op rolls back, graph pre-op', () => {
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    const d = makeNode({ type: 'd' })
    childOf(a, b) // b under a
    childOf(b, d) // d under b → a → b → d

    const beforeA = nodeKey(a)
    const beforeD = nodeKey(d)

    let err: unknown
    try {
      childOf(d, a) // attach A under its own descendant D → cycle!
    } catch (e) {
      err = e
    }
    expect(isGraphViolation(err)).toBe(true)
    expect(nodeKey(a)).toBe(beforeA)
    expect(nodeKey(d)).toBe(beforeD)
    expect(anchorsOf(a, 'child')).toHaveLength(0)
    expect(anchorsOf(d, 'parent')).toHaveLength(0)
    expect(a.parent).toBeNull()
    expect(d.children).toHaveLength(0)
  })

  it('G15 move subtree under itself → same cycle detector, rollback to pre-op state', () => {
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    const c = makeNode({ type: 'c' })
    childOf(a, b) // b under a
    childOf(b, c) // c under b → a → b → c

    const before = nodeKey(a) + nodeKey(b) + nodeKey(c)

    let err: unknown
    try {
      childOf(c, a) // move A under its own descendant C → cycle!
    } catch (e) {
      err = e
    }
    expect(isGraphViolation(err)).toBe(true)
    expect(nodeKey(a) + nodeKey(b) + nodeKey(c)).toBe(before)
    expect(b.parent).toBe(a)
    expect(c.parent).toBe(b)
    expect(anchorsOf(a, 'child')).toHaveLength(0)
    expect(anchorsOf(c, 'parent')).toHaveLength(0)
    expect(c.children).toHaveLength(0)
  })

  it('G16 an orphaned node with no permanent owner is async cascade-destroyed by the microtask sweep', async () => {
    const root = makeRoot()
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    childOf(root, a)
    childOf(a, b)

    const family = anchorsOf(b, 'child')[0]!.link
    family.destroy()

    expect(b.state).toBe('unplaced')
    expect(b.state).not.toBe('destroyed')

    await drainSweep()

    expect(b.state).toBe('destroyed')
    expect(a.state).toBe('in-tree')
    expect(root.state).toBe('in-tree')
  })

  it('G17 an orphan re-attached synchronously before the sweep blocks destruction', async () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    childOf(root, a)
    childOf(a, b)

    const family = anchorsOf(b, 'child')[0]!.link
    family.destroy()

    childOf(root, b)

    await drainSweep()

    expect(b.state).toBe('in-tree')
    expect(b.parent).toBe(root)
    expect(b.destroyed).toBe(false)
    expect(root.children.map(c => c.id)).toContain(b.id)
  })

  it('G18 chains terminating at rootNode / component / contentNodes survive the sweep', async () => {
    const root = makeRoot()
    const kid = makeNode()
    childOf(root, kid)

    const proto = makePrototype()
    const frag = makeNode()
    childOf(proto, frag)

    const cn = makeNode({ type: 'content' })
    const cnLink = new Link(DEFAULT_PARENT_CHILD)
    cn.addAnchor('parent', 'contentNodes', {}, cnLink)

    const lone = makeNode()
    const loneParent = makeNode()
    childOf(loneParent, lone)
    anchorsOf(lone, 'child')[0]!.link.destroy()

    await drainSweep()

    expect(root.state).toBe('in-tree')
    expect(kid.state).toBe('in-tree')
    expect(proto.state).toBe('prototype')
    expect(frag.state).toBe('prototype')
    expect(cn.destroyed).toBe(false)
    expect(anchorsOf(cn, 'parent')).toHaveLength(1)
    expect(lone.state).toBe('destroyed')
  })

  it('G19 parent-first and child-first underflow variants both end in deliberate link destruction, orphans → unplaced', () => {
    // parent-first: rejecting remove on the parent side, then destroy.
    const p1 = makeNode()
    const k1 = makeNode()
    childOf(p1, k1)
    const f1 = anchorsOf(k1, 'child')[0]!.link
    expect(() => f1.removeAnchor(f1.anchorsOf('parent')[0]!)).toThrow(LinkConfigError)
    f1.destroy()
    expect(anchorsOf(k1, 'child')).toHaveLength(0)
    expect(k1.state).toBe('unplaced')
    expect(anchorsOf(p1, 'parent')).toHaveLength(0)

    // child-first: rejecting remove on the child side, then destroy.
    const p2 = makeNode()
    const k2 = makeNode()
    childOf(p2, k2)
    const f2 = anchorsOf(k2, 'child')[0]!.link
    expect(() => f2.removeAnchor(f2.anchorsOf('child')[0]!)).toThrow(LinkConfigError)
    f2.destroy()
    expect(anchorsOf(k2, 'child')).toHaveLength(0)
    expect(k2.state).toBe('unplaced')
    expect(anchorsOf(p2, 'parent')).toHaveLength(0)
  })

  it('G20 anchor target is never a Link — the edge lives on anchor.link (C2)', () => {
    const someLink = new Link(DEFAULT_PARENT_CHILD)
    // FSA-level proof the contract is unrepresentable: a Link may not fill Anchor.target.
    // @ts-expect-error — C2: a Link edge can never be an AnchorTarget
    const impossible: Anchor['target'] = someLink
    void impossible

    // Behaviourally: every anchor in a real family targets a node/token, never a Link.
    const root = makeRoot()
    const kid = makeNode()
    childOf(root, kid)
    const family = anchorsOf(kid, 'child')[0]!.link
    const targetIsNeverALink = (t: Anchor['target']): boolean =>
      !(typeof t === 'object' && t !== null && t instanceof Link)
    for (const aPrim of [...root.anchors, ...kid.anchors]) {
      expect(aPrim.target).not.toBe(family)
      expect(aPrim.link instanceof Link).toBe(true)
      expect(targetIsNeverALink(aPrim.target)).toBe(true)
    }
    expect(family.anchorsOf('child').every(c => c.link === family)).toBe(true)
    expect(family.anchorsOf('child').every(c => targetIsNeverALink(c.target))).toBe(true)

    // Attempting to construct `{role:'child', target: link}` through the graph API
    // must be rejected by the runtime guard (the type system forbids it statically).
    const childAnchor = family.anchorsOf('child')[0]!
    const before = family.anchors.slice()
    expect(() =>
      family.addAnchor({
        role: 'child',
        target: someLink as unknown as Anchor['target'],
        options: { priority: 99 },
        link: family,
      }),
    ).toThrow()
    expect(family.anchors).toEqual(before)
    expect(childAnchor.target).toBe(kid)
  })
})