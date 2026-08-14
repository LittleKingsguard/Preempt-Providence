import { describe, it, expect, vi, afterEach } from 'vitest'
import { mintNodeId, Node, Supervisor, findCycle } from '../../src/core/node.js'
import { execute, applyStateSlice, placementAttach, derivePlacementTrigger, type OpContext } from '../../src/core/ops.js'
import { LinkConfigError, SingleParentError, CycleError, PipelineLockError } from '../../src/core/errors.js'
import { Link, DEFAULT_COMPONENT, DEFAULT_PARENT_CHILD } from '../../src/core/link.js'
import { SliceLock } from '../../src/core/pipeline.js'
import { makeRoot, makeNode, makePrototype, childOf, hub } from '../helpers/fixtures.js'
import type { AttachOp, StateSliceOp, MutationOp, LayerMutation } from '../../src/core/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function opCtx(...nodes: Node[]): OpContext {
  const m = new Map<string, Node>()
  for (const n of nodes) m.set(n.id, n)
  return { hub: hub(), nodes: m }
}

function supOf(root: Node, ...rest: Node[]): Supervisor {
  const nodes = new Map<string, Node>()
  nodes.set(root.id, root)
  for (const n of rest) nodes.set(n.id, n)
  return new Supervisor(root, nodes)
}

function ofRole(node: Node, role: string) {
  return node.anchors.filter(a => a.role === role)
}

function flushSweep(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

function isCycleFailure(e: unknown): boolean {
  return (
    e instanceof CycleError ||
    (e instanceof Error && 'code' in e && (e as { code?: unknown }).code === 'cycle-detected')
  )
}

function addComponentSource(owner: Node, name: string, value: unknown): void {
  const link = new Link(DEFAULT_COMPONENT)
  const anchor = owner.addAnchor('source', name, {}, link)
  ;(anchor as { value?: unknown }).value = value
}

describe('ops — structural executors (O1–O7, O16, O17, O19)', () => {
  it('O1 attach to a valid parent creates/reuses the parent anchor and adds the child anchor on the same link', () => {
    const id = mintNodeId()
    const root = makeRoot()
    const first = new Node({ type: 'a' }, hub(), id)
    const second = makeNode({ type: 'b' })
    const ctx = opCtx(root, first, second)

    execute({ kind: 'attach', node: first, to: root }, ctx)
    execute({ kind: 'attach', node: second, to: root }, ctx)

    const rootParents = ofRole(root, 'parent')
    const firstChild = ofRole(first, 'child')
    const secondChild = ofRole(second, 'child')

    expect(first.id).toBe(id)
    expect(rootParents).toHaveLength(1)
    expect(firstChild).toHaveLength(1)
    expect(secondChild).toHaveLength(1)
    expect(firstChild[0]!.link).toBe(rootParents[0]!.link)
    expect(secondChild[0]!.link).toBe(rootParents[0]!.link)
    expect(first.parent).toBe(root)
    expect(second.parent).toBe(root)
    expect(first.state).toBe('in-tree')
    expect(second.state).toBe('in-tree')
    expect(root.children.map(c => c.id)).toEqual([first.id, second.id])
  })

  it('O2 attach/move that would create a cycle -> findCycle true, execute rejects, graph stays in pre-op state', () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    const c = makeNode()
    const ctx = opCtx(root, a, b, c)
    childOf(root, a)
    childOf(a, b)
    childOf(b, c)

    expect(findCycle(b, c)).toBe(true)
    expect(findCycle(c, b)).toBe(false)

    const before = graphKey(a) + graphKey(b) + graphKey(c)
    let err: unknown
    try {
      execute({ kind: 'move', node: b, to: { parent: c } }, ctx)
    } catch (e) {
      err = e
    }
    expect(isCycleFailure(err)).toBe(true)
    expect(graphKey(a) + graphKey(b) + graphKey(c)).toBe(before)
    expect(b.parent).toBe(a)
    expect(a.state).toBe('in-tree')
    expect(c.state).toBe('in-tree')
  })

  it('O3 duplicate priority -> unique-order LinkConfigError with conflicting; retry at max+1 succeeds', () => {
    const root = makeRoot()
    const first = makeNode()
    const second = makeNode()
    const ctx = opCtx(root, first, second)

    execute({ kind: 'attach', node: first, to: root, priority: 5 }, ctx)
    let err: LinkConfigError | undefined
    try {
      execute({ kind: 'attach', node: second, to: root, priority: 5 }, ctx)
    } catch (e) {
      err = e as LinkConfigError
    }

    expect(err).toBeInstanceOf(LinkConfigError)
    expect(err?.code).toBe('unique-order')
    expect(err?.linkId).toBe(ofRole(first, 'child')[0]!.link.id)
    expect(err?.detail.conflicting).toHaveLength(1)
    expect(err?.detail.conflicting[0]!.options.priority).toBe(5)
    expect(err?.detail.intendedAnchor?.options.priority).toBe(5)

    execute({ kind: 'attach', node: second, to: root, priority: 6 }, ctx)
    expect(ofRole(first, 'child')[0]!.options.priority).toBe(5)
    expect(ofRole(second, 'child')[0]!.options.priority).toBe(6)

    const family = ofRole(first, 'child')[0]!.link
    expect(() => family.setOrder(ofRole(first, 'child')[0]!, 6)).toThrow(LinkConfigError)
    family.setOrder(ofRole(first, 'child')[0]!, 7)
    expect(family.anchorsOf('child').map(x => x.options.priority).sort()).toEqual([6, 7])
  })

  it('O4 removing the parent anchor -> count-underflow; escalation to link.destroy() orphans child anchors to unplaced', () => {
    const root = makeRoot()
    const kid = makeNode()
    const ctx = opCtx(root, kid)
    execute({ kind: 'attach', node: kid, to: root }, ctx)

    const family = ofRole(kid, 'child')[0]!.link
    let err: LinkConfigError | undefined
    try {
      family.removeAnchor(ofRole(root, 'parent')[0]!)
    } catch (e) {
      err = e as LinkConfigError
    }
    expect(err).toBeInstanceOf(LinkConfigError)
    expect(err?.code).toBe('count-underflow')
    expect(family.anchorsOf('parent').length).toBe(1)

    family.destroy()
    expect(ofRole(kid, 'child')).toHaveLength(0)
    expect(kid.state).toBe('unplaced')
    expect(kid.parent).toBeNull()
    expect(ofRole(root, 'parent')).toHaveLength(0)
    expect(root.children).toHaveLength(0)
  })

  it('O5 synchronous re-attach before the sweep blocks cascade-destroy', async () => {
    const root = makeRoot()
    const parent = makeNode()
    const child = makeNode()
    const ctx = opCtx(root, parent, child)
    childOf(root, parent)
    childOf(parent, child)

    const sup = supOf(root, parent, child)
    sup.apply({ kind: 'destroy', node: parent })
    execute({ kind: 'move', node: child, to: { parent: root } }, ctx)
    await flushSweep()

    expect(parent.state).toBe('destroyed')
    expect(child.state).toBe('in-tree')
    expect(child.parent).toBe(root)
    expect(root.children.map(c => c.id)).toContain(child.id)
  })

  it('O6 an ownerless orphan is cascade-destroyed by the async sweep', async () => {
    const root = makeRoot()
    const parent = makeNode()
    const child = makeNode()
    childOf(root, parent)
    childOf(parent, child)

    const sup = supOf(root, parent, child)
    sup.apply({ kind: 'destroy', node: parent })

    expect(child.state).not.toBe('destroyed')
    expect(parent.state).not.toBe('destroyed')

    await flushSweep()
    expect(parent.state).toBe('destroyed')
    expect(child.state).toBe('destroyed')
    expect(root.children).toHaveLength(0)
    expect(root.state).toBe('in-tree')
  })

  it('O7 a mid-op rejection leaves the link byte-identical (no partial application)', () => {
    const root = makeRoot()
    const first = makeNode()
    const second = makeNode()
    const bad = makeNode()
    const ctx = opCtx(root, first, second, bad)

    execute({ kind: 'attach', node: first, to: root }, ctx)
    execute({ kind: 'attach', node: second, to: root }, ctx)
    const family = ofRole(first, 'child')[0]!.link
    const beforeAnchors = family.anchors.slice()
    const beforeParentCount = ofRole(root, 'parent').length
    const beforeChildren = root.children.map(x => x.id)

    let err: LinkConfigError | undefined
    try {
      execute({ kind: 'attach', node: bad, to: root, priority: 0 }, ctx)
    } catch (e) {
      err = e as LinkConfigError
    }
    expect(err).toBeInstanceOf(LinkConfigError)
    expect(err!.code).toBe('unique-order')
    expect(family.anchors).toEqual(beforeAnchors)
    expect(ofRole(bad, 'child')).toHaveLength(0)
    expect(ofRole(root, 'parent')).toHaveLength(beforeParentCount)
    expect(root.children.map(x => x.id)).toEqual(beforeChildren)
  })

  it('O16 second attach without a detach fails with the dedicated SingleParentError, never a silent move', () => {
    const rootA = makeRoot()
    const rootB = makeRoot()
    const child = makeNode()
    const ctx = opCtx(child, rootA, rootB)
    execute({ kind: 'attach', node: child, to: rootA }, ctx)

    let err: SingleParentError | undefined
    try {
      execute({ kind: 'attach', node: child, to: rootB }, ctx)
    } catch (e) {
      err = e as SingleParentError
    }

    expect(err).toBeInstanceOf(SingleParentError)
    expect(err?.nodeId).toBe(child.id)
    expect(ofRole(child, 'child')).toHaveLength(1)
    expect(child.parent).toBe(rootA)
    expect(rootB.children).toHaveLength(0)
  })

  it('O17 a role outside the link whitelist is rejected with role-mismatch', () => {
    const link = new Link(DEFAULT_COMPONENT)
    const before = link.anchors.slice()

    let err: LinkConfigError | undefined
    try {
      // P3 §1.1: a placement-side role ('content') never satisfies a component link
      link.addAnchor({ role: 'content', target: 'slot-a', options: {}, link })
    } catch (e) {
      err = e as LinkConfigError
    }
    expect(err).toBeInstanceOf(LinkConfigError)
    expect(err?.code).toBe('role-mismatch')
    expect(err?.linkId).toBe(link.id)
    expect(err?.detail.intendedAnchor?.role).toBe('content')
    expect(link.anchors).toEqual(before)
  })

  it('O19 destroy on a node with descendants dissolves links and cascade-destroys descendants', async () => {
    const root = makeRoot()
    const parent = makeNode()
    const s1 = makeNode()
    const s2 = makeNode()
    childOf(root, parent)
    childOf(parent, s1)
    childOf(s1, s2)

    const sup = supOf(root, parent, s1, s2)
    sup.apply({ kind: 'destroy', node: parent })

    expect(s1.state).not.toBe('destroyed')
    expect(s2.state).not.toBe('destroyed')

    await flushSweep()
    expect(parent.state).toBe('destroyed')
    expect(s1.state).toBe('destroyed')
    expect(s2.state).toBe('destroyed')
    expect(root.children).toHaveLength(0)
    expect(root.state).toBe('in-tree')
  })
})

describe('state-slice reducer & compile (O8–O12)', () => {
  it('O8 state-slice on an in-tree node compiles synchronously, queues pass-2, and journals', async () => {
    const root = makeRoot()
    const child = makeNode({ type: 'original' })
    childOf(root, child)
    const sup = supOf(root, child)

    const res = sup.apply({
      kind: 'state-slice',
      node: child,
      mutation: [{ targetProp: 'props.foo', mode: 'replace', value: 'bar' }],
    })
    expect(res.status).toBe('applied')
    if (res.status === 'applied') {
      expect(typeof res.journalId).toBe('string')
      expect(res.dirtied).toContain(child.id)
    }
    expect(child.props.foo).toBe('bar')
    expect(child.dirty.has('remote')).toBe(true)

    await flushSweep()
    expect(child.dirty.has('remote')).toBe(false)
  })

  it('O9 a node not in-tree yields no usable compiled state', async () => {
    const root = makeRoot()
    const solo = makeNode({ type: 'div' })
    const sup = supOf(root, solo)

    const res = sup.apply({
      kind: 'state-slice',
      node: solo,
      mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }],
    })
    expect(res.status).toBe('no-usable-state')
    if (res.status === 'no-usable-state') {
      expect(res.nodeState).toBe('unplaced')
    }
    expect(solo.content).toBeUndefined()

    const compiled = solo.compile([solo])
    expect(compiled.actionable).toHaveLength(0)
  })

  it('O10 multiple same-name sources yield multiple keyed states, never a coerced pick', () => {
    const root = makeRoot()
    const leaf1 = makeNode({ type: 'provider' })
    const leaf2 = makeNode({ type: 'provider' })
    childOf(root, leaf1)
    childOf(root, leaf2)
    addComponentSource(leaf1, 'ident', { v: 'A' })
    addComponentSource(leaf2, 'ident', { v: 'B' })

    const res = root.compile([root, leaf1, leaf2])
    const providers = res.actionable.filter(s => s.nodeId === leaf1.id || s.nodeId === leaf2.id)
    expect(providers).toHaveLength(2)
    const keys = providers.map(s => s.pathKey)
    expect(new Set(keys).size).toBe(2)
    const values = providers.map(s => s.bindings['ident'])
    expect(values).toContainEqual({ v: 'A' })
    expect(values).toContainEqual({ v: 'B' })
  })

  it('O11 a fork arm terminating at a prototype contributes no actionable state', () => {
    const proto = makePrototype()
    const frag = makeNode({ type: 'proto-child' })
    childOf(proto, frag)

    const res = frag.compile([proto, frag])
    expect(frag.state).toBe('prototype')
    expect(res.actionable).toHaveLength(0)
    expect(res.dropped.some(d => d.reason === 'prototype-terminated')).toBe(true)
  })

  it('O12 a looping fork arm logs circular-source and the arm is dropped', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const a = makeNode()
    const b = makeNode()
    const l1 = new Link(DEFAULT_PARENT_CHILD)
    a.addAnchor('parent', a, {}, l1)
    b.addAnchor('child', b, {}, l1)
    const l2 = new Link(DEFAULT_PARENT_CHILD)
    b.addAnchor('parent', b, {}, l2)
    a.addAnchor('child', a, {}, l2)

    const res = a.compile([a, b])
    expect(res.actionable).toHaveLength(0)
    expect(res.warnings.some(w => w.code === 'circular-source')).toBe(true)
    expect(res.dropped.some(d => d.reason === 'loop')).toBe(true)
    expect(warn).toHaveBeenCalled()
  })
})


describe('placement-attach op (P3 §3.3, E2E-4) — Unit 6', () => {
  it('P-A1 the executor mints ordered content anchors + ensures the container anchor on the shared per-name Link', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({}, 'A'))
    const D = makeNode({ type: 'button' }, 'D')
    const ctx = opCtx(root, A, D)

    const res = execute({ kind: 'placement-attach', node: D, container: A, names: ['zone-b', 'zone-a'] }, ctx)

    expect(res.doorways).toEqual([A.id, D.id])
    const content = ofRole(D, 'content')
    expect(content).toHaveLength(2)
    // the anchors array preserves the targetPlacement preference order
    expect(content.map(a => a.target)).toEqual(['zone-b', 'zone-a'])
    const container = ofRole(A, 'container')
    expect(container).toHaveLength(1)
    expect(container[0]!.target).toBe('zone-b')
    // the per-name placement Link IS the zone registry: same-name anchors share it
    expect(content[0]!.link).toBe(container[0]!.link)
    expect(content[1]!.link).not.toBe(container[0]!.link)
  })

  it('P-A2 re-attach is idempotent: content anchors dedup keep-first, the container anchor is ensured not duplicated', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({}, 'A'))
    const D = makeNode({}, 'D')
    const ctx = opCtx(root, A, D)

    execute({ kind: 'placement-attach', node: D, container: A, names: ['zone-1'] }, ctx)
    execute({ kind: 'placement-attach', node: D, container: A, names: ['zone-1'] }, ctx)
    expect(ofRole(D, 'content')).toHaveLength(1)
    expect(ofRole(A, 'container')).toHaveLength(1)
  })

  it('P-A3 the §1.3 ancestor-name veto skips the container anchor mint with a placement-name-vetoed warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const root = makeRoot()
    const P = childOf(root, makeNode({}, 'P'))
    const A = childOf(P, makeNode({}, 'A'))
    const D = makeNode({}, 'D')
    const ctx = opCtx(root, P, A, D)
    P.addAnchor('container', 'zone-1', {}, ctx.hub.linkFor('zone-1', 'placement'))

    execute({ kind: 'placement-attach', node: D, container: A, names: ['zone-1'] }, ctx)

    expect(ofRole(A, 'container')).toHaveLength(0)
    expect(ofRole(D, 'content')).toHaveLength(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('placement-name-vetoed'))
  })

  it('P-A4 derivePlacementTrigger: a freshly minted container → container-added; an ensured one → content-added', () => {
    expect(derivePlacementTrigger('zone-1', true)).toEqual({ kind: 'placement', linkName: 'zone-1', direction: 'container-added' })
    expect(derivePlacementTrigger('zone-1', false)).toEqual({ kind: 'placement', linkName: 'zone-1', direction: 'content-added' })
  })
})

describe('slice lock (O20)', () => {
  it('O20 unlocking before final resolution is rejected; unlock is only legal from resolved', () => {
    const lock = new SliceLock('root-vnode', { maxDepth: 4 })
    expect(lock.state).toBe('held')
    expect(() => lock.unlock()).toThrow(PipelineLockError)
    expect(lock.state).toBe('held')

    lock.beginResolution()
    expect(lock.state).toBe('resolving')
    expect(() => lock.unlock()).toThrow(PipelineLockError)

    lock.resolveFork('a', { kind: 'emitted', renderOps: [] })
    lock.resolveFork('b', { kind: 'dropped', reason: 'owner-terminated' })
    expect(lock.state).toBe('resolved')

    lock.unlock()
    expect(lock.state).toBe('released')
    expect(() => lock.unlock()).toThrow(PipelineLockError)
  })
})

function graphKey(node: Node): string {
  return node.anchors
    .map(a => `${a.role}@${a.link.id}#${typeof a.target === 'string' ? a.target : a.target.id}:${JSON.stringify(a.options)}`)
    .join('|')
}