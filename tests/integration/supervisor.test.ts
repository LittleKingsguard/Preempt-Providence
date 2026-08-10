import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { makeRoot, makeNode, childOf } from '../helpers/fixtures.js'

afterEach(() => {
  vi.restoreAllMocks()
})

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

describe('supervisor journal / undo-redo / cascade-destroy sweep (integration)', () => {
  it('O13 journal replay re-executes ops in order and reproduces the same rejection', () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    const c = makeNode()
    const sup = supOf(root, a, b, c)

    sup.apply({ kind: 'attach', node: a, to: root })
    sup.apply({ kind: 'attach', node: b, to: a })
    sup.apply({ kind: 'attach', node: c, to: b })

    const cycleLive = sup.apply({ kind: 'move', node: b, to: { parent: c } })
    expect(cycleLive.status).toBe('rejected')
    expect(b.parent).toBe(a)

    sup.replay()
    expect(a.parent).toBe(root)
    expect(b.parent).toBe(a)
    expect(c.parent).toBe(b)
    expect(a.state).toBe('in-tree')

    const cycleReplay = sup.apply({ kind: 'move', node: b, to: { parent: c } })
    expect(cycleReplay.status).toBe('rejected')
  })

  it('O14 undo and redo invert and reapply the named op stream', () => {
    const root = makeRoot()
    const a = makeNode()
    const sup = supOf(root, a)

    sup.apply({ kind: 'attach', node: a, to: root })
    expect(a.parent).toBe(root)
    expect(a.state).toBe('in-tree')

    sup.undo()
    expect(a.parent).toBeNull()
    expect(a.state).toBe('unplaced')

    sup.redo()
    expect(a.parent).toBe(root)
    expect(a.state).toBe('in-tree')
  })

  it('O15 an anchor-adding effect forces a new sweep, populating anchors only after the op', async () => {
    const root = makeRoot()
    const node = makeNode()
    childOf(root, node)

    node.addLayer({ id: 'placement-1', anchors: [{ role: 'placement', target: 'slot-alpha' }] })
    expect(node.dirty.has('anchor-populate')).toBe(true)

    await flushSweep()
    const placements = ofRole(node, 'placement')
    expect(placements).toHaveLength(1)
    expect(placements[0]!.link).toBeDefined()
  })

  it('O18 a batch of dirtied dependents is coalesced into one pass-2 sweep with no whole-tree recompile', async () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    const far = makeNode()
    childOf(root, a)
    childOf(root, b)

    const spyA = vi.spyOn(a, 'compileRemote')
    const spyB = vi.spyOn(b, 'compileRemote')
    const spyFar = vi.spyOn(far, 'compileRemote')

    const sup = supOf(root, a, b, far)
    sup.apply({ kind: 'state-slice', node: a, mutation: [{ targetProp: 'content', mode: 'replace', value: '1' }] })
    sup.apply({ kind: 'state-slice', node: b, mutation: [{ targetProp: 'content', mode: 'replace', value: '2' }] })

    await flushSweep()
    expect(spyA).toHaveBeenCalledTimes(1)
    expect(spyB).toHaveBeenCalledTimes(1)
    expect(spyFar).not.toHaveBeenCalled()
  })
})