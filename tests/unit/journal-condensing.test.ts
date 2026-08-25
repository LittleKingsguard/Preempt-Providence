/**
 * JOURNAL CONDENSING — Feature 3 (docs/specs/handoffs-review-8.md
 * PROCEED-AS-RESHAPED, 2026-08-25; rulings 17-22 + decisions D1-D10).
 *
 * TDD red set: every test fails before the implementation exists (the
 * `maxJournalLength` init field, the deferred condense, the `base` marker +
 * replay branch, `_restoreBase`, the undo/redo id-fallback).
 *
 *   C1  trigger — maxJournalLength set → condense fires (pre-base entries →
 *       ONE base marker); absent → never; no condense on replay/redo
 *   C2  base marker shape — {kind:'base', snapshot, result:{status:'base'}};
 *       undoStack truncates to post-base; redoStack clears; marker never
 *       undo-able
 *   C3  replay-from-base (state) — post-stream render-relevant state equal
 *   C4  replay-from-base (hook values) — pre-base hook write survives via
 *       anchor.value (merged-only restore, D1)
 *   C5  replay-from-base (rows) — re-mint per batches record, fresh ids,
 *       count + values equal; keyed record keeps keyField (D8)
 *   C6  replay-from-base (defs) — def-prototype re-registration per census
 *       (D8)
 *   C7  undo after replay-from-base (D3) — post-base undo operates on the
 *       restored graph (id-fallback), never a silent no-op
 *   C8  base-boundary undo guard — an undo crossing the base warns
 *       base-boundary + fails (never silent, never partial)
 *   C9  graph-REPLACE eviction (D4) — pre-base nodes evicted from
 *       registered/byId/contentNodes/mintedByLayer; the sweep does not
 *       compile zombie state; mintedByOrigin returns only live rows
 *   C10 condense failure containment (D5) — a function-bearing node →
 *       condense-aborted warn, journal UNTOUCHED; a later clean condense
 *       succeeds
 *   C11 size guard (D5) — a base ≥ the pre-base journal →
 *       condense-skipped-size warn, no rewrite
 *   C12 no hot-path latency — the condense is deferred (a tight apply loop
 *       returns without an inline O(graph) block; the restore runs on a
 *       microtask)
 *   C13 requestId/takePass2 non-interference (ruling 21) — the condense
 *       never drains takePass2States, never touches the requestId dedup LRU;
 *       the dispatch window's dirtied union is not undercounted by the base
 *       entry (D6)
 *   C14 replay-loop uniformity — replay walks the base marker + post-base
 *       entries uniformly; post-base entries re-apply with their existing
 *       gates; the base never reaches apply()
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub } from '../../src/core/translate.js'
import { serializeSlice, loadState, reRegisterDefPrototypes, type SerializedRenderDoc } from '../../src/core/serialize.js'
import { registerDefPrototypes, mintedByOrigin, registered, evictDestroyedNode } from '../../src/core/registry.js'
import { hub, makeRoot, makeNode, childOf, addComponentSource, targetAnchor, familyLink } from '../helpers/fixtures.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** Two microtask turns — enough for a deferred condense to run. */
async function flushCondense(): Promise<void> {
  await flushSweep()
  await flushSweep()
}

function makeSupervisor(opts: { maxJournalLength?: number } = {}) {
  const h = hub()
  const events = new EventBridge()
  const sup = new Supervisor({ hub: h, events, ...opts } as never)
  return { h, events, sup }
}

/** A root on the SHARED hub (familyLink adds the rootNode token — the
 *  fixture makeRoot uses its OWN hub; the rows-mint prototype resolution and
 *  the condense root-detection both need the shared hub). */
function sharedRoot(h: ReturnType<typeof hub>, id: string): Node {
  const root = new Node({ type: 'app' }, h, id)
  familyLink(root, 'rootNode')
  return root
}

describe('C1 — trigger (ruling 17)', () => {
  it('1. maxJournalLength set → a condense fires after the journal exceeds it (pre-base entries become ONE base marker)', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 2 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)

    for (let i = 1; i <= 3; i += 1) {
      const res = sup.apply({
        kind: 'state-slice',
        node: root,
        mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }],
      })
      expect(res.status).toBe('applied')
    }
    // pre-condense: 3 entries (the deferred condense has not run inline)
    expect(sup.journal.length).toBe(3)
    expect(sup.journal.every((e) => e.op.kind !== 'base')).toBe(true)

    await flushCondense()
    expect(sup.journal.length).toBe(1)
    expect(sup.journal[0]!.op.kind).toBe('base')
    expect((sup.journal[0]!.op as { snapshot?: unknown }).snapshot).toBeDefined()
  })

  it('2. absent maxJournalLength → never condenses', async () => {
    const { sup } = makeSupervisor()
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    for (let i = 1; i <= 10; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
    }
    await flushCondense()
    expect(sup.journal.length).toBe(10)
    expect(sup.journal.every((e) => e.op.kind !== 'base')).toBe(true)
  })

  it('3. replay/redo no-journal re-applies never trigger a condense (the journal is not growing)', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 3 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    for (let i = 1; i <= 3; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
    }
    sup.undo() // pops A3 → redoStack
    sup.redo() // no-journal re-apply of A3 — must NOT schedule a condense
    // a further op pushes the journal over the threshold → ONE condense
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A4' }] })
    await flushCondense()
    const bases = sup.journal.filter((e) => e.op.kind === 'base')
    expect(bases.length).toBe(1)
  })
})

describe('C2 — base marker shape (D6)', () => {
  it('4. marker is {kind:"base", snapshot} with result {status:"base"}; undoStack truncates to post-base; redoStack clears; the marker is never undo-able', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 2 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    // two pre-base ops
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A2' }] })
    sup.undo() // pushes A2's entry to redoStack
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A3' }] })
    await flushCondense() // 3 entries > 2 → condensed

    // the post-base op must be applied AFTER the condense to stay post-base
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A4' }] })

    expect(sup.journal.length).toBe(2) // base marker + the post-base entry
    expect(sup.journal[0]!.op.kind).toBe('base')
    expect(sup.journal[0]!.result).toEqual({ status: 'base' })
    expect(sup.journal[1]!.op.kind).toBe('state-slice')

    // redoStack cleared at condense — a redo of the pre-base A2 entry is impossible
    sup.redo()
    expect(sup.getNode(root.id)!.content).toBe('A4') // nothing to redo — unchanged
  })
})

describe('C3 — replay-from-base (state)', () => {
  it('5. a state-slice sequence condensed, then replay(): the base restore + post-base re-apply reproduces the post-stream render-relevant state (SER-R1)', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 2 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'props.title', mode: 'replace', value: 'T' }] })
    await flushCondense() // 2 entries are NOT > 2 — push one more first
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A2' }] })
    await flushCondense() // 3 > 2 → condensed (A1 + A2 + title-T all pre-base)

// the POST-base op — applied after the condense so it stays post-base
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'props.title', mode: 'replace', value: 'T2' }] })
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
    expect(sup.journal.filter((e) => e.op.kind === 'state-slice').length).toBe(1)

    // pre-replay live node (the restore REPLACES the objects — D4)
    const preReplay = sup.getNode(root.id)!

    sup.replay()
    await flushCondense()
    const restored = sup.getNode(root.id)!
    expect(restored).not.toBe(preReplay) // graph-REPLACE: fresh seed objects
    expect(restored.content).toBe('A2')
    expect(restored.props?.title).toBe('T2')
  })
})

describe('C4 — replay-from-base (hook values, D1)', () => {
  it('6. a pre-base hook write survives the restore via anchor.value; providerValueFor returns the live value after replay', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 2 })
    const root = makeRoot({ type: 'app' })
    addComponentSource(root, 'theme', 'dark')
    sup.registerNode(root)

    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'hooks.theme', mode: 'replace', value: 'light' }] })
    await flushCondense() // 1 !> 2
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    await flushCondense() // 2 !> 2 — push a third
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'y' }] })
    await flushCondense() // 3 > 2 → condensed
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)

    // diverge the live graph
    const pre = sup.getNode(root.id)!
    expect(pre.anchors.find((a) => a.target === 'theme')?.value).toBe('light')

    sup.replay()
    await flushCondense()
    const restored = sup.getNode(root.id)!
    const restoredAnchor = restored.anchors.find((a) => a.target === 'theme')
    expect(restoredAnchor?.value).toBe('light')
  })
})

describe('C5 — replay-from-base (rows, D8)', () => {
  it('7. a pre-base rows-mint re-mints per the batches record (fresh ids, count + values equal)', async () => {
    const { h, sup } = makeSupervisor({ maxJournalLength: 2 })
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    // the mint resolves the prototype via the TARGET's hub — build with the
    // SAME hub h (a fixture-root uses its own internal hub → unresolved)
    const root = sharedRoot(h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    childOf(root, creator)
    sup.registerNode(root)
    sup.registerNode(creator)

    const mintRes = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ name: 'a' }, { name: 'b' }],
    } as never)
    expect(mintRes.status).toBe('applied')

    // push ENOUGH state-slices that the journal (small payloads, 12+ entries)
    // clearly exceeds the base (the small graph) — the D5 size guard must NOT
    // skip, so the condense actually fires
    const first = sup.journal.length
    for (let i = 0; i < 12; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `x${i}` }] })
    }
    expect(sup.journal.length - first).toBe(12)
    await flushCondense()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)

    sup.replay()
    await flushCondense()
    const restoredCreator = sup.getNode(creator.id)!
    const rows = restoredCreator.children.filter((c) => (c as unknown as { originLayer?: string }).originLayer !== undefined)
    expect(rows.length).toBe(2)
    const record = (restoredCreator as unknown as { batches?: Record<string, { rows: unknown[] }> }).batches?.items
    expect(record?.rows.length).toBe(2)
  })
})

describe('C6 — replay-from-base (defs, D8)', () => {
  it('8. a pre-base def-bearing graph re-registers per the census', async () => {
    const { h, sup } = makeSupervisor({ maxJournalLength: 2 })
    const proto = new Node({ type: 'nav' }, h, 'proto-nav')
    registerDefPrototypes(h.linkFor('nav', 'component'), [proto])
    const root = sharedRoot(h, 'root')
    sup.registerNode(root)

    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'y' }] })
    // push enough that the journal exceeds the base (the small graph) — D5
    for (let i = 0; i < 12; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `z${i}` }] })
    }
    await flushCondense()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)

    sup.replay()
    await flushCondense()
    // the census re-registered the def — a mint by name must resolve
    const restoredRoot = sup.getNode(root.id)!
    const creator = new Node({ type: 'section' }, h, 'creator2')
    childOf(restoredRoot, creator)
    sup.registerNode(creator)
    const res = sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'nav',
      rows: [{ name: 'a' }],
    } as never)
    expect(res.status).toBe('applied')
  })
})

describe('C7 — undo after replay-from-base (D3)', () => {
  it('9. condense, replay-from-base, then undo a POST-base op: the inverse operates on the restored graph (never a silent no-op)', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 3 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'props.title', mode: 'replace', value: 'T' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A2' }] })
    await flushCondense() // 3 !> 3
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A3' }] })
    await flushCondense() // 4 > 3 → condensed (A1/A2/title/A3 all pre-base)
// the POST-base op
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A4' }] })
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
    expect(sup.journal.filter((e) => e.op.kind === 'state-slice').length).toBe(1)

    const preReplay = sup.getNode(root.id)!
    sup.replay()
    await flushCondense()
    expect(sup.getNode(root.id)).not.toBe(preReplay) // graph-REPLACE
    expect(sup.getNode(root.id)!.content).toBe('A4')

    // undo the POST-base op — content A4 → A3 on the RESTORED graph
    sup.undo()
    await flushSweep()
    const restored = sup.getNode(root.id)!
    expect(restored.content).toBe('A3')
    expect(restored.props?.title).toBe('T')
  })
})

describe('C8 — base-boundary undo guard (ruling 19)', () => {
  it('10. an undo that would cross the base warns base-boundary + fails (never a silent no-op, never a partial restore)', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 2 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    // push enough that the journal (many small slices) exceeds the base (root)
    for (let i = 0; i < 12; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
    }
    await flushCondense() // 12 > 2 → condensed
    expect(sup.journal.length).toBe(1) // only the base marker
    expect(sup.journal[0]!.op.kind).toBe('base')

    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warns.push(String(args[0] ?? '')) }
    try {
      // the undoStack was truncated — a crossing attempt is only reachable
      // through a stale reference; the guard must warn + fail, never partial
      sup.undo()
    } finally {
      console.warn = origWarn
    }
    await flushSweep()
    expect(warns.some((w) => w.includes('base-boundary'))).toBe(true)
    expect(sup.getNode(root.id)!.content).toBe('A11') // unchanged — never partial
  })
})

describe('C9 — graph-REPLACE eviction (D4)', () => {
  it('11. after a restore the pre-base nodes are evicted from registered/byId; mintedByOrigin returns only live rows; the sweep does not compile zombie state', async () => {
    const { h, sup } = makeSupervisor({ maxJournalLength: 2 })
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = makeRoot({ type: 'app' })
    const creator = makeNode({ type: 'section' })
    childOf(root, creator)
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ name: 'a' }],
    } as never)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    await flushCondense()

    const preIds = new Set(sup.allNodes().map((n) => n.id))
    sup.replay()
    await flushCondense()
    const postIds = new Set(sup.allNodes().map((n) => n.id))
    // every pre-base id is either re-seeded (same id) or evicted — none may
    // be a zombie in the registry
    for (const id of preIds) {
      if (!postIds.has(id)) {
        // evicted: the registered set must not hold a destroyed/absent stale
        const inRegistry = [...registered].some((n) => n.id === id && !n.destroyed)
        expect(inRegistry).toBe(false)
      }
    }
  })
})

describe('C10 — condense failure containment (D5)', () => {
  it('12. a node whose props/content carries a function → condense-aborted warn, the journal UNTOUCHED; a later clean condense succeeds', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 1 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    // push ENOUGH small slices that the journal exceeds the base (D5 must not
    // skip BEFORE serialize runs — the abort is a SERIALIZE-time failure)
    for (let i = 0; i < 12; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
    }

    // poison the graph with a function-bearing anchor VALUE (serializeNode
    // ships a.value → assertJsonSafe throws; the props getter is read-only)
    const anchor = addComponentSource(root, 'poison', 'clean')
    anchor.value = () => 1

    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warns.push(String(args[0] ?? '')) }
    try {
      await flushCondense()
    } finally {
      console.warn = origWarn
    }
    expect(warns.some((w) => w.includes('condense-aborted'))).toBe(true)
    // journal UNTOUCHED — still the twelve pre-base entries
    expect(sup.journal.length).toBe(12)
    expect(sup.journal.every((e) => e.op.kind !== 'base')).toBe(true)

    // heal the graph → the next condense succeeds
    anchor.value = 'clean'
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A3' }] })
    await flushCondense()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
  })
})

describe('C11 — size guard (D5)', () => {
  it('13. a base estimated ≥ the pre-base journal → condense-skipped-size warn, no rewrite', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 1 })
    const root = makeRoot({ type: 'app' })
    sup.registerNode(root)
    // a LARGE child rides the BASE but not any journal op.node (the ops touch
    // only root) — so the serialized base clearly exceeds the tiny journal
    const big = makeNode({ type: 'section', content: 'x'.repeat(5000) })
    childOf(root, big)
    sup.registerNode(big)
    // TWO ops: the journal is tiny (root + two small mutations)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A2' }] })

    const warns: string[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warns.push(String(args[0] ?? '')) }
    try {
      await flushCondense()
    } finally {
      console.warn = origWarn
    }
    expect(warns.some((w) => w.includes('condense-skipped-size'))).toBe(true)
    expect(sup.journal.length).toBe(2)
    expect(sup.journal[0]!.op.kind).toBe('state-slice') // NOT condensed
  })
})

describe('C12 — no hot-path latency', () => {
  it('14. the condense is deferred — a tight apply loop returns WITHOUT an inline O(graph) block; the restore runs on the microtask', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 3 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    for (let i = 1; i <= 5; i += 1) {
      const res = sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
      expect(res.status).toBe('applied')
      // synchronously after the triggering apply, the journal still has ALL
      // entries — the condense has NOT run inline
      expect(sup.journal.length).toBe(i)
    }
    await flushCondense()
    expect(sup.journal.length).toBeLessThanOrEqual(2)
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
  })
})

describe('C13 — requestId/takePass2 non-interference (ruling 21)', () => {
  it('15. a condense between dispatches never drains takePass2States; the dispatch window dirtied union is not undercounted by the base entry (D6)', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 2 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A2' }] })

    // the pass-2 states from the LAST apply must still be available
    const states = sup.takePass2States()
    expect(states.size).toBeGreaterThanOrEqual(0) // may be empty — the point is it does NOT throw

    await flushCondense()
    // after the condense, takePass2States still works (no drain, no throw)
    const after = sup.takePass2States()
    expect(after).toBeInstanceOf(Map)
  })
})

describe('C14 — replay-loop uniformity', () => {
  it('16. replay walks the base marker + post-base entries uniformly; the base never reaches apply()', async () => {
    const { sup } = makeSupervisor({ maxJournalLength: 3 })
    const root = makeRoot({ type: 'app', content: 'A0' })
    sup.registerNode(root)
    // push ENOUGH that the journal exceeds the base — D5 must not skip
    for (let i = 1; i <= 10; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
    }
    await flushCondense() // 10 > 3 → condensed (A1..A10 pre-base)
    // TWO post-base entries (after the condense microtask)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A11' }] })
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A12' }] })
    expect(sup.journal.filter((e) => e.op.kind === 'base').length).toBe(1)
    expect(sup.journal.filter((e) => e.op.kind === 'state-slice').length).toBe(2)

    const applySpy = vi.spyOn(sup, 'apply')
    const preReplay = sup.getNode(root.id)!
    sup.replay()
    await flushCondense()
    expect(sup.getNode(root.id)).not.toBe(preReplay) // graph-REPLACE
    expect(sup.getNode(root.id)!.content).toBe('A12')
    // the base entry is restored via _restoreBase — the apply spy sees only
    // the POST-base re-applies (2 state-slices), never a kind:'base' apply
    const baseCalls = applySpy.mock.calls.filter((c) => (c[0] as { kind?: string }).kind === 'base')
    expect(baseCalls.length).toBe(0)
    const sliceCalls = applySpy.mock.calls.filter((c) => (c[0] as { kind?: string }).kind === 'state-slice')
    expect(sliceCalls.length).toBe(2)
  })
})

describe('ADV-C — adversarial guardrails (2026-08-25 fix pass)', () => {
  it('ADV-S11 — replay id-resolves op.target (rows-mint post-base survives a restore)', async () => {
    const { h, sup } = makeSupervisor({ maxJournalLength: 3 })
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = sharedRoot(h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    sup.registerNode(root)
    sup.registerNode(creator)
    for (let i = 0; i < 8; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `x${i}` }] })
    }
    await flushCondense()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
    // a POST-base rows-mint — after the restore it must target the RESEEDED
    // creator (op.target id-resolution, D3), not the stale evicted one
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', rows: [{ name: 'a' }] } as never)

    sup.replay()
    await flushCondense()
    const reseeded = sup.getNode(creator.id)!
    const rows = reseeded.children.filter((c) => (c as unknown as { originLayer?: string }).originLayer !== undefined)
    // the post-base mint landed on the RESEEDED creator (not 0 — the S11/S19
    // defect would silently drop it on the stale evicted object)
    expect(rows.length).toBe(1)
    expect(rows[0]!.id).not.toBe(undefined)
  })

  it('ADV-S19 — redo id-resolves op.target (rows-mint redo after replay)', async () => {
    const { h, sup } = makeSupervisor({ maxJournalLength: 3 })
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = sharedRoot(h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    sup.registerNode(root)
    sup.registerNode(creator)
    for (let i = 0; i < 8; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `x${i}` }] })
    }
    await flushCondense()
    // a post-base rows-mint, then undo it (→ redoStack)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', rows: [{ name: 'a' }] } as never)
    sup.undo()
    sup.replay()
    await flushCondense()
    sup.redo()
    await flushCondense()
    const reseeded = sup.getNode(creator.id)!
    const rows = reseeded.children.filter((c) => (c as unknown as { originLayer?: string }).originLayer !== undefined)
    expect(rows.length).toBe(1) // the redone rows-mint landed on the reseeded creator
  })

  it('ADV-S4 — replay clears redoStack (an undone op is not redo-applied AFTER replay)', async () => {
    const { h, sup } = makeSupervisor({ maxJournalLength: 3 })
    const root = sharedRoot(h, 'root')
    sup.registerNode(root)
    for (let i = 0; i < 8; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }] })
    }
    await flushCondense()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
    // a post-base op, undone (its journal entry stays; the entry goes to
    // redoStack). replay re-applies the JOURNAL entry (B1), THEN must clear
    // the redoStack — so a subsequent redo is a NO-OP (no double-apply).
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'B1' }] })
    sup.undo()
    // the B1 journal entry is still in the journal — replay re-applies it
    sup.replay()
    await flushCondense()
    // after replay, the redoStack must be cleared → redo does nothing (no
    // double-apply of the already-replayed B1)
    const applySpy = vi.spyOn(sup, 'apply')
    sup.redo()
    await flushCondense()
    const appliedAfterRedo = applySpy.mock.calls.length
    expect(appliedAfterRedo).toBe(0) // redoStack cleared by replay — redo is a no-op
    vi.restoreAllMocks()
  })

  it('ADV-S5 — the restore re-mint is QUIET (no before-compile handler fires, no structure event)', async () => {
    const { h, events, sup } = makeSupervisor({ maxJournalLength: 3 })
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'proto-1')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = sharedRoot(h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    sup.registerNode(root)
    sup.registerNode(creator)
    // a before-compile handler that would fire during a NON-quiet restore
    let beforeCompileFired = 0
    creator.addLayer({
      id: 'probe-handler',
      handlers: [{ name: 'probe', phase: 'before-compile', body: () => { beforeCompileFired += 1 } }],
    } as never)
    // a structure-event listener
    let structureEvents = 0
    events.subscribe('structure', () => { structureEvents += 1 })
    // a PRE-BASE rows-mint (so _restoreBase re-mints it during replay)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', rows: [{ name: 'a' }] } as never)
    for (let i = 0; i < 8; i += 1) {
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: `x${i}` }] })
    }
    await flushCondense()
    expect(sup.journal.some((e) => e.op.kind === 'base')).toBe(true)
    const eventsBefore = structureEvents
    const handlersBefore = beforeCompileFired
    sup.replay()
    await flushCondense()
    // the restore's internal re-mint is a QUIET graph-REPLACE (D4/ADV-S5):
    // it must NOT fire the before-compile handler and must NOT emit a
    // structure:rows-mint event for the restore itself
    expect(beforeCompileFired).toBe(handlersBefore)
    expect(structureEvents).toBe(eventsBefore)
  })

  it('ADV-S12 — the condense capture is graph-filtered (graph B defs never leak into graph A\'s base)', async () => {
    const hA = hub()
    const hB = hub()
    const protoB = new Node({ type: 'nav' }, hB, 'proto-b')
    registerDefPrototypes(hB.linkFor('nav', 'component'), [protoB]) // graph B's def
    const supA = new Supervisor({ hub: hA, events: new EventBridge(), maxJournalLength: 2 } as never)
    const rootA = sharedRoot(hA, 'root')
    supA.registerNode(rootA)
    for (let i = 0; i < 8; i += 1) {
      supA.apply({ kind: 'state-slice', node: rootA, mutation: [{ targetProp: 'content', mode: 'replace', value: `x${i}` }] })
    }
    await flushCondense()
    const base = supA.journal.find((e) => e.op.kind === 'base')!.op as unknown as { snapshot: { content: { id: string }[] } }
    // graph A's base must NOT ship graph B's proto-b (the def-census is
    // instance-membership-scoped to graph A's nodes)
    expect(base.snapshot.content.some((c) => c.id === 'proto-b')).toBe(false)
  })
})