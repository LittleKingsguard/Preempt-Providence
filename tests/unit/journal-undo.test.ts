/**
 * DEFECT-JOURNAL-UNDO + DEFECT-JOURNAL-REPLAY-APPEND + DEFECT-CLONE-REPLAY-
 * NONIDEMPOTENT (handoffs-review-4.md — PROCEED-WITH-CONDITIONS, 2026-08-24).
 * TDD red set: state-slice undo via journaled sliceLayers (+ hook pre-op
 * values), replay/redo idempotency gates + the no-journal re-apply mode.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub, translateLegacy } from '../../src/core/translate.js'
import { makeRoot, makeNode, childOf } from '../helpers/fixtures.js'
import { resolveNodeRef } from '../../src/core/registry.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeSupervisor(hub?: ReturnType<typeof createLinkHub>) {
  return new Supervisor({ hub: hub ?? createLinkHub(), events: new EventBridge() })
}

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('DEFECT-JOURNAL-UNDO — state-slice undo via journaled sliceLayers', () => {
  it('1. state-slice replace undo — content A0→A1, undo() → A0', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)

    const res = sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }],
    })
    expect(res.status).toBe('applied')
    expect(root.content).toBe('A1')

    sup.undo()
    await flushSweep()
    expect(root.content).toBe('A0')
  })

  it('2. state-slice append undo — ["a"] + append x, undo() → ["a"]', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', props: { items: ['a'] } })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.items', mode: 'append', value: ['x'] }],
    })
    expect(root.props.items).toEqual(['a', 'x'])

    sup.undo()
    await flushSweep()
    expect(root.props.items).toEqual(['a'])
  })

  it('3. multi-mutation single-op undo — content + props.append both reverted by ONE undo', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0', props: { items: ['a'] } })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [
        { targetProp: 'content', mode: 'replace', value: 'A1' },
        { targetProp: 'props.items', mode: 'append', value: ['x'] },
      ],
    })
    expect(root.content).toBe('A1')
    expect(root.props.items).toEqual(['a', 'x'])

    sup.undo()
    await flushSweep()
    expect(root.content).toBe('A0')
    expect(root.props.items).toEqual(['a'])
  })

  it('4a. replaceAll undo — props.items replaceAll [x,y], undo() → authored', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', props: { items: ['a'] } })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.items', mode: 'replaceAll', value: ['x', 'y'] }],
    })
    expect(root.props.items).toEqual(['x', 'y'])

    sup.undo()
    await flushSweep()
    expect(root.props.items).toEqual(['a'])
  })

  it('4b. css undo — css.color replace, undo() → authored', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', css: { style: { color: 'red' } } })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'css.style', mode: 'replace', value: { color: 'blue' } }],
    })
    expect((root.css.style as Record<string, string> | undefined)?.color).toBe('blue')

    sup.undo()
    await flushSweep()
    expect((root.css.style as Record<string, string> | undefined)?.color).toBe('red')
  })

  it('4c. type undo — type replace, undo() → authored', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'div' })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'type', mode: 'replace', value: 'section' }],
    })
    expect(root.type).toBe('section')

    sup.undo()
    await flushSweep()
    expect(root.type).toBe('div')
  })

  it('5. hooks undo exactness — first write removes the layer + restores authored; SECOND write restores the PRIOR value with the layer surviving', async () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'div',
          component: [{ reference: 'theme', value: 'dark' }],
          hooks: ['theme'],
        },
      },
      clientConfig: { runInstantiation: true, runRendering: true },
    } as never)
    const sup = makeSupervisor()
    sup.registerNode(t.root)

    // first write: layer created, anchor.value = light
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    sup.undo()
    await flushSweep()
    // authored value restored, layer gone
    expect(t.root.layers.some((l) => l.id === 'hook-theme')).toBe(false)

    // second write: layer replaced in place (value = light)
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }],
    })
    // third write: replace in place (value = dim)
    sup.apply({
      kind: 'state-slice',
      node: t.root,
      mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'dim' }],
    })
    sup.undo()
    await flushSweep()
    // layer SURVIVES with the prior write's value; anchor restored
    const layer = t.root.layers.find((l) => l.id === 'hook-theme')
    expect(layer).toBeDefined()
    expect((layer as unknown as { value: string }).value).toBe('light')
  })

  it('10. undo on a destroyed node — silent no-op, never throws', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    const kid = childOf(root, makeNode({ type: 'span' }), 0)
    sup.registerNode(root)
    sup.registerNode(kid)

    sup.apply({
      kind: 'state-slice',
      node: kid,
      mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }],
    })
    sup.apply({ kind: 'destroy', node: kid })
    await flushSweep()

    expect(() => sup.undo()).not.toThrow()
    await flushSweep()
  })

  it('11. undo render honesty — apply slice, undo, flush → compiled states reflect the undone value', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }],
    })
    sup.undo()
    await flushSweep()
    const compiled = root.compile(sup.allNodes())
    expect(compiled.actionable[0]!.content).toBe('A0')
  })
})

describe('DEFECT-JOURNAL-REPLAY-APPEND — replay idempotency via the sliceLayers gate', () => {
  it('6. replay-append idempotency — ["a"] + append x + append y, replay() → still ["a","x","y"], journal unchanged', () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', props: { items: ['a'] } })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.items', mode: 'append', value: ['x'] }],
    })
    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.items', mode: 'append', value: ['y'] }],
    })
    expect(root.props.items).toEqual(['a', 'x', 'y'])
    const journalLen = sup.journal.length

    sup.replay()
    expect(root.props.items).toEqual(['a', 'x', 'y'])
    expect(sup.journal.length).toBe(journalLen)
  })

  it('7. replay-after-undo restores the stream — append x, append y, undo, replay → ["a","x","y"]', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', props: { items: ['a'] } })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.items', mode: 'append', value: ['x'] }],
    })
    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.items', mode: 'append', value: ['y'] }],
    })
    sup.undo() // undoes append y
    await flushSweep()
    expect(root.props.items).toEqual(['a', 'x'])

    sup.replay() // only the undone entry re-applies
    expect(root.props.items).toEqual(['a', 'x', 'y'])
  })

  it('12. gate soundness — a hook-clear + layer-apply on the same node leave earlier slice-* layers intact so replay skips correctly', () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }],
    })
    // a non-slice op journaled after the slice — must not disturb the slice layers
    const proto = makeNode({ type: 'proto' })
    sup.apply({ kind: 'clone-instance', source: proto, slot: root, priority: 0 })

    const journalLen = sup.journal.length
    sup.replay()
    expect(root.content).toBe('A1')
    expect(sup.journal.length).toBe(journalLen)
  })
})

describe('DEFECT-CLONE-REPLAY-NONIDEMPOTENT — clone-instance replay via result.minted liveness', () => {
  it('9. clone-instance replay — N nodes after replay, no fresh copy, journal unchanged', () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app' })
    const proto = makeNode({ type: 'proto' })
    sup.registerNode(root)

    sup.apply({ kind: 'clone-instance', source: proto, slot: root, priority: 0 })
    const before = sup.allNodes().length
    const journalLen = sup.journal.length

    sup.replay()
    expect(sup.allNodes().length).toBe(before)
    expect(sup.journal.length).toBe(journalLen)
  })
})

describe('redo hygiene — no-journal redo with in-place result refresh', () => {
  it('8. apply → undo → redo → post-op value; undo → pre-op value; journal length 1; no double-undo', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)

    sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }],
    })
    const journalLen = sup.journal.length
    expect(journalLen).toBe(1)

    sup.undo()
    await flushSweep()
    expect(root.content).toBe('A0')

    sup.redo()
    await flushSweep()
    expect(root.content).toBe('A1')
    expect(sup.journal.length).toBe(1)

    sup.undo()
    await flushSweep()
    expect(root.content).toBe('A0')

    // the redo pushed the SAME entry — a second undo pop must not exist
    expect(() => sup.undo()).not.toThrow()
    await flushSweep()
    expect(root.content).toBe('A0')
  })
})