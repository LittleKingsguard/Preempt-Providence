/**
 * ENG-JOURNAL-ENTRY-READ-API — the sanitized, non-draining journal reader
 * (Astrographer handoff; gate docs/specs/journal-read-access-review.md; target
 * 0.5.0). TDD red set — written BEFORE implementation.
 *
 * `Supervisor.journalEntries(opts?)` returns a sanitized `JournalView`: no live
 * Node refs / snapshot payloads, absolute-index pagination, exact depths, and
 * the condense base marker surfaced. It never mutates or drains the journal.
 */
import { describe, it, expect } from 'vitest'
import { Supervisor } from '../../src/core/supervisor.js'
import { createLinkHub } from '../../src/core/translate.js'
import { EventBridge } from '../../src/core/events.js'
import { makeRoot } from '../helpers/fixtures.js'

function makeSupervisor(maxJournalLength?: number): Supervisor {
  return new Supervisor(
    maxJournalLength === undefined
      ? {}
      : { hub: createLinkHub(), events: new EventBridge(), maxJournalLength },
  )
}

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function withApplied(sup: Supervisor, count: number): void {
  const root = makeRoot({ type: 'app', content: 'A0' })
  sup.registerNode(root)
  for (let i = 1; i <= count; i += 1) {
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
  }
}

describe('JOURNAL-READ — journalEntries() sanitized view', () => {
  it('J1. empty journal: zeroed view, omitted optional keys, never throws', () => {
    const sup = makeSupervisor()
    const v = sup.journalEntries()
    expect(v.entries).toEqual([])
    expect(v.fromIndex).toBe(0)
    expect(v.totalEntries).toBe(0)
    expect(v.truncated).toBe(false)
    expect(v.undoDepth).toBe(0)
    expect(v.redoDepth).toBe(0)
    expect(v.basePresent).toBe(false)
    expect(v.undoBaseBoundary).toBe(false)
    expect('undoTopKind' in v).toBe(false)
    expect('redoTopKind' in v).toBe(false)
    expect('maxJournalLength' in v).toBe(false)
  })

  it('J2. applied ops → sanitized rows; JSON.stringify is safe despite live Node refs', () => {
    const sup = makeSupervisor()
    withApplied(sup, 1)
    const v = sup.journalEntries()
    expect(v.entries).toEqual([{ index: 0, kind: 'state-slice', status: 'applied' }])
    expect(v.totalEntries).toBe(1)
    expect(v.undoTopKind).toBe('state-slice')
    // sanitization: only {index,kind,status}; no op/node/snapshot/id
    const json = JSON.stringify(v)
    expect(json).toContain('"kind":"state-slice"')
    expect(json).not.toContain('"op"')
    expect(json).not.toContain('"snapshot"')
    const row = JSON.parse(json).entries[0]
    expect(Object.keys(row).sort()).toEqual(['index', 'kind', 'status'])
  })

  it('J3. non-draining: journal + stacks unchanged by the read', () => {
    const sup = makeSupervisor()
    withApplied(sup, 3)
    const len = sup.journal.length
    const undo = sup.undoDepth
    sup.journalEntries({ limit: 1 })
    expect(sup.journal.length).toBe(len)
    expect(sup.undoDepth).toBe(undo)
  })

  it('J4. pagination: afterIndex + limit + fromIndex/totalEntries/truncated', () => {
    const sup = makeSupervisor()
    withApplied(sup, 5)
    const v = sup.journalEntries({ afterIndex: 1, limit: 2 })
    expect(v.fromIndex).toBe(1)
    expect(v.entries.map((e) => e.index)).toEqual([1, 2])
    expect(v.totalEntries).toBe(5)
    expect(v.truncated).toBe(true)

    const all = sup.journalEntries({ afterIndex: 0, limit: 10 })
    expect(all.entries.map((e) => e.index)).toEqual([0, 1, 2, 3, 4])
    expect(all.truncated).toBe(false)
  })

  it('J5. limit clamps to [1,1000]; afterIndex at/after the tail → empty, not truncated', () => {
    const sup = makeSupervisor()
    withApplied(sup, 5)
    const one = sup.journalEntries({ limit: 0 })
    expect(one.entries).toHaveLength(1)
    expect(one.entries[0]!.index).toBe(4)

    const beyond = sup.journalEntries({ afterIndex: 99 })
    expect(beyond.entries).toEqual([])
    expect(beyond.fromIndex).toBe(5)
    expect(beyond.truncated).toBe(false)
  })

  it('J6. default window is cursor-relative (peeks ahead of undone entries)', () => {
    const sup = makeSupervisor()
    withApplied(sup, 5)
    sup.undo()
    sup.undo()
    expect(sup.undoDepth).toBe(3)
    expect(sup.redoDepth).toBe(2)
    const v = sup.journalEntries({ limit: 2 })
    // cursor = 3; REDO_PEEK pulls the window to the tail → [3,4]
    expect(v.entries.map((e) => e.index)).toEqual([3, 4])
    expect(v.undoDepth).toBe(3)
    expect(v.redoDepth).toBe(2)
  })

  it('J7. condensed base marker is surfaced (index 0, kind base) + basePresent/baseBoundary', async () => {
    const sup = makeSupervisor(2)
    withApplied(sup, 3)
    await flushSweep()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
    const v = sup.journalEntries()
    expect(v.basePresent).toBe(true)
    expect(v.entries[0]).toEqual({ index: 0, kind: 'base', status: 'base' })
    expect(v.undoBaseBoundary).toBe(true)
    expect(v.undoDepth).toBe(0)
  })

  it('J8. maxJournalLength is echoed when configured', () => {
    const sup = makeSupervisor(10)
    expect(sup.journalEntries().maxJournalLength).toBe(10)
  })

  it('J9. malformed entry → kind/status "unknown", never throws', () => {
    const sup = makeSupervisor()
    sup.journal.push({ id: 'x', op: {} as never, result: {} as never } as never)
    const v = sup.journalEntries()
    expect(v.entries[0]).toEqual({ index: 0, kind: 'unknown', status: 'unknown' })
  })
})
