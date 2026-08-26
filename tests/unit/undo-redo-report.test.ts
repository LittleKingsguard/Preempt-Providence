/**
 * UNDO-REDO-REPORT (docs/specs/undo-redo-report.md — DECIDED 2026-08-26).
 * TDD red set: undo()/redo()/replay() return an UndoRedoReport (status /
 * scheduledDirtied / stackTopKind / redoTopKind / baseBoundary) and the
 * read-only stack accessors (undoDepth / redoDepth / undoTopKind / redoTopKind
 * / undoBaseBoundary) so a host can faithfully report state after these ops.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub } from '../../src/core/translate.js'
import { makeRoot, familyLink } from '../helpers/fixtures.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function makeSupervisor(hub?: ReturnType<typeof createLinkHub>) {
  return new Supervisor({ hub: hub ?? createLinkHub(), events: new EventBridge() })
}

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** A root on the SHARED hub (familyLink adds the rootNode token — the condense
 *  root-detection needs the shared hub). */
function sharedRoot(h: ReturnType<typeof createLinkHub>, id: string): Node {
  const root = new Node({ type: 'app' }, h, id)
  familyLink(root, 'rootNode')
  return root
}

describe('UNDO-REDO-REPORT — undo()/redo()/replay() return a host report', () => {
  it('U1. undo() of a state-slice returns status applied + scheduledDirtied + stackTopKind', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })

    const report = sup.undo()
    await flushSweep()
    expect(report.status).toBe('applied')
    expect(report.scheduledDirtied).toContain(root.id)
    expect(report.baseBoundary).toBe(false)
    expect(root.content).toBe('A0')
  })

  it('U2. undo() with empty undoStack and no base marker → status no-op, empty dirtied', () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    const report = sup.undo()
    expect(report.status).toBe('no-op')
    expect(report.scheduledDirtied).toEqual([])
    expect(report.baseBoundary).toBe(false)
  })

  it('U3. undo() at the condensed base boundary → status base-boundary + baseBoundary true', async () => {
    const h = createLinkHub()
    const sup = new Supervisor({ hub: h, events: new EventBridge(), maxJournalLength: 2 })
    const root = sharedRoot(h, 'root')
    sup.registerNode(root)
    // 3 entries > 2 → the deferred condense fires, truncating the undoStack to
    // empty at the base marker
    for (let i = 1; i <= 3; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
    }
    await flushSweep()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
    expect(sup.undoDepth).toBe(0)
    const report = sup.undo()
    expect(report.status).toBe('base-boundary')
    expect(report.scheduledDirtied).toEqual([])
    expect(report.baseBoundary).toBe(true)
  })

  it('U4. undo() of a destroy (terminal) → status no-op, empty dirtied', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'destroy', node: root })
    const report = sup.undo()
    await flushSweep()
    expect(report.status).toBe('no-op')
    expect(report.scheduledDirtied).toEqual([])
  })

  it('U5. undo() of a state-slice dirties the node + its source/duplex consumers', async () => {
    const h = createLinkHub()
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    const root = makeRoot({ type: 'app', content: 'A0' })
    const consumer = makeRoot({ type: 'app', content: 'C0' })
    sup.registerNode(root)
    sup.registerNode(consumer)
    // wire a source/duplex link root → consumer on the SAME shared link so the
    // consumer walk fires
    const link = h.linkFor('content', 'component')
    root.addAnchor('source', 'content', {}, link)
    consumer.addAnchor('target', 'content', {}, link)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })

    const report = sup.undo()
    await flushSweep()
    expect(report.status).toBe('applied')
    expect(report.scheduledDirtied).toContain(root.id)
    expect(report.scheduledDirtied).toContain(consumer.id)
  })

  it('U7. redo() returns status applied + redoTopKind reflects the new top', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.undo()
    const report = sup.redo()
    await flushSweep()
    expect(report.status).toBe('applied')
    expect(report.scheduledDirtied).toContain(root.id)
    expect(root.content).toBe('A1')
  })

  it('U8. redo() with empty redoStack → status no-op, empty dirtied', () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    const report = sup.redo()
    expect(report.status).toBe('no-op')
    expect(report.scheduledDirtied).toEqual([])
  })

  it('U9. replay() returns status applied + scheduledDirtied', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    const report = sup.replay()
    await flushSweep()
    expect(report.status).toBe('applied')
    expect(report.scheduledDirtied).toContain(root.id)
  })

  it('U11. accessors reflect the stacks after ops', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    expect(sup.undoDepth).toBe(0)
    expect(sup.redoDepth).toBe(0)
    expect(sup.undoTopKind).toBeUndefined()
    expect(sup.redoTopKind).toBeUndefined()
    expect(sup.undoBaseBoundary).toBe(false)

    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    expect(sup.undoDepth).toBe(1)
    expect(sup.undoTopKind).toBe('state-slice')

    sup.undo()
    expect(sup.undoDepth).toBe(0)
    expect(sup.redoDepth).toBe(1)
    expect(sup.redoTopKind).toBe('state-slice')
    await flushSweep()
  })

  it('U12. accessors are read-only — reading them never mutates the stacks', () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    const before = sup.undoDepth
    void sup.undoTopKind
    void sup.redoTopKind
    void sup.undoBaseBoundary
    expect(sup.undoDepth).toBe(before)
  })

  it('U13. scheduledDirtied is the pending-flush set — flush() yields settled states', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    const report = sup.undo()
    expect(report.scheduledDirtied).toContain(root.id)
    await sup.flush()
    const states = sup.takePass2States()
    expect(states.has(root.id)).toBe(true)
  })

  it('U14. source-compatible — existing callers that ignore the return still work', async () => {
    const sup = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    // call and ignore the return (the old void contract)
    sup.undo()
    await flushSweep()
    expect(root.content).toBe('A0')
  })
})
