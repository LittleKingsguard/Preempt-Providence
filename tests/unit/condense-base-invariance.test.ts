/**
 * **CONDENSE-BASE-INVARIANCE** — the engine pin for `docs/decisions.md`
 * **`CONDENSE-BASE-IS-A-LIVE-VIEW`** (OWNER RULING 2026-11-23) and the CLOSED-BY-
 * DESIGN defect row `docs/defects.md` **`CONDENSE-BASE-ALIASES-LIVE-GRAPH`**.
 *
 * ─── WHAT IS PINNED (ONE SENTENCE) ───────────────────────────────────────────
 * Every SANCTIONED write path (`Supervisor.apply`'s `state-slice`, the
 * structural ops, `undo()`/`redo()`, a REJECTED op, and `replay()`) **REPLACES**
 * the live object it touches and **never mutates, in place, an object the
 * condensed base captured**. The condensed base's bytes are therefore invariant
 * under ordinary channel traffic.
 *
 * ─── THIS IS AN ENGINE PROPERTY, NOT A HOST-MUTATION OUTCOME ─────────────────
 * `Supervisor.condense()` stores `serializeSlice(...)` **uncloned**, so the base
 * ALIASES the live graph: `content` ships by reference, anchor `value` by
 * reference, `derived`/`bodyRuns`/`batches[*].rows`/`css.cssDef` by reference,
 * and nested `props` VALUES are the live objects (measured below: `#a`'s live
 * `props.meta` IS the base entry's `props.meta`). That aliasing is **INTENDED**
 * — the ruling is verbatim *"attempts to mutate history are unsupported
 * behaviour"* — so the ONE thing standing between a host and a retro-mutated
 * base is the engine's replace-not-mutate discipline, and today it is pinned by
 * NOTHING (it is an absence-of-writes claim over the whole engine). This file
 * turns that absence into a CI tripwire.
 *
 * It is deliberately **NOT** a red set: the invariant HOLDS on this tree by
 * measurement, and the file is GREEN. Nothing here encodes a host mutating the
 * graph and then complaining (that action is out of contract and would revive a
 * "red-first" requirement the ruling declines). The two stories this file must
 * never be rewritten into: *"the base is detached"* (false — see CBI-3a) and
 * *"the base is attached, therefore a mutation shows up"* (that is the host's
 * unsupported action, not an engine property).
 *
 * ─── THE MEASUREMENT THIS PROMOTES (the per-op bisect) ───────────────────────
 * `condense()` once, capture the base **by marker entry id**, then run the
 * sanctioned ops ONE AT A TIME, comparing `JSON.stringify(capturedSnapshot)`
 * before/after each, with a marker-identity assertion at every comparison point.
 * Measured on this tree (2026-11-23, this file): every comparison EQUAL — the
 * plain page's base sits at ~1.3 kB and the rich page's at ~1.9 kB (the exact
 * length varies per run because node ids are minted from a module counter, so
 * no byte count is hard-coded; only before/after EQUALITY is asserted).
 *
 * ─── TRAP 1 — A LATER CONDENSE REPLACES THE BASE MARKER (CBI-5) ──────────────
 * `maxJournalLength` makes the condense **deferred AND size-guarded**, and a
 * second condense SPLICES A FRESH SNAPSHOT IN PLACE OF THE OLD MARKER. A probe
 * that re-reads the base through the finder
 * (`sup.journal.find(e => e.op.kind === 'base')`) after such a replacement sees a
 * DIFFERENT, freshly-captured snapshot and concludes "the base changed" — a
 * false drift finding with no engine write behind it. Every comparison here
 * therefore (a) holds the captured `snapshot` OBJECT, and (b) asserts the marker
 * is STILL THE SAME ENTRY (`id` identity) at that point; a replacement fails
 * with a `FIXTURE:` message instead of reporting drift. The windows are also
 * driven WITHOUT awaits (a condense is a `setTimeout(0)`), so a replacement
 * cannot fire mid-window. **CBI-5 is the explicit negative control** that
 * documents the artefact in code so nobody re-derives it as a defect.
 *
 * ─── TRAP 2 — `card.compile()` THROWS ON THE RICH FIXTURE ────────────────────
 * `#card`'s `component: [{ reference: 'zone', target: 'children' }]` is a
 * children-seam consumer wired against a PLACEMENT name, so a standalone
 * `card.compile()` throws `TypeError: slice is not iterable` on this fixture
 * (measured). That is EXPECTED and is **not relied on**: no case calls
 * `card.compile()`, and the supervisor's own `flush()` pass-2 handles the slice
 * (it reports `unresolved-reference` for the name and moves on). If that throw
 * ever becomes an engine failure instead of a fixture curiosity, it must not be
 * "fixed" by weakening this file.
 *
 * ─── CBI-3 IS THE ANTI-VACUITY DEVICE ────────────────────────────────────────
 * The invariance cases (CBI-1/CBI-2/CBI-4) would ALSO pass on an engine that
 * deep-copied the base — the story the ruling explicitly declined. CBI-3 pins
 * BOTH halves of the actual contract: (a) the aliasing is real (`toBe` on the
 * shared `props.meta` object) and (b) a top-level `props` write REPLACES the
 * live carrier rather than mutating the captured one (`not.toBe`). If a future
 * engine legitimately clones at condense, (a) breaks **and not** (b) — that is
 * the control telling the reader the CONTRACT MOVED rather than the engine
 * breaking.
 *
 * NAMESPACE/SCOPE DISCIPLINE: every case builds its OWN `createLinkHub()` and
 * its own translated tree, so no case shares a per-name `Link` or node id with
 * another. The condense recipe (`maxJournalLength`, `WRITE_COUNT` ordinary
 * `state-slice` writes, `flush()`, two `setTimeout(0)` turns, and
 * `journalEntries().basePresent === true` asserted BEFORE any restore) is
 * duplicated from `tests/e2e/restore-integrity.test.ts` — the condense is
 * deferred AND size-guarded, so a skipped condense would make a case test
 * NOTHING.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import {
  translateLegacy,
  createLinkHub,
  type LegacyInitialData,
  type TranslatedTree,
} from '../../src/core/translate.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// The condense recipe (deferred + size-guarded — the header's trap)
// ============================================================================

const CLIENT_CONFIG = { runInstantiation: true, runRendering: true }

/** The condense trigger (`tests/e2e/restore-integrity.test.ts` uses `5`). Low
 *  enough that 35 plain writes blow past it, high enough that those writes are
 *  the thing filling the pre-base window the size guard measures. */
const MAX_JOURNAL_LENGTH = 5

/** Ordinary post-bootstrap writes the host would make. 35 matches the
 *  restore-integrity recipe: enough BYTES that the condensed base is a memory
 *  win, so the D5 size guard rewrites instead of warning
 *  `condense-skipped-size` (a skipped condense = no base = a case testing
 *  nothing). */
const WRITE_COUNT = 35

/** Ordinary writes that must force CBI-5's SECOND condense. The rewrite is
 *  size-guarded (`base >= pre-base journal` is skipped), and the pre-base
 *  journal includes the OLD base marker, so the window has to outweigh it —
 *  measured: the rewrite fires well inside this budget. If CBI-5's replacement
 *  assertion fails, the condense POLICY changed (the size guard, or how many
 *  bytes a `state-slice` entry costs): raise this count — the failure message
 *  says so — and never "fix" it by re-reading the finder. */
const SECOND_CONDENSE_WRITES = 40

// ============================================================================
// The two pages (`plain` and `rich` — the same envelope, plus the zone/card pair)
// ============================================================================

/**
 * **plain** — `div#app` (`props.theme = {mode:'light', depth:{n:1}}`,
 * `css.style = 'color: red;'`) with a child `div#a`
 * (`props.meta = {tags:['x','y']}`, `content: 'hello'`, and a `span` child).
 * The nested `props` values are the aliased carriers CBI-1 bisects;
 * `props.theme` is the object CBI-3b proves is REPLACED by a top-level write.
 */
function plainPage(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'app', style: 'color: red;' },
        props: { id: 'app', theme: { mode: 'light', depth: { n: 1 } } },
        children: [
          {
            type: 'div',
            css: { id: 'a' },
            props: { id: 'a', meta: { tags: ['x', 'y'] } },
            content: 'hello',
            children: [{ type: 'span', props: { id: 'a-span' } }],
          },
        ],
      },
    },
    content: [],
    clientConfig: CLIENT_CONFIG,
  } as unknown as LegacyInitialData
}

/**
 * **rich** — the plain page PLUS a placement producer (`div#zoneA`, a
 * `container` anchor on the `zone` placement link) and a children-seam consumer
 * (`div#card`, `component: [{ reference: 'zone', target: 'children' }]`). The
 * consumer is what makes the shared-object surface reachable (the shared
 * per-name `Link`, the def/placement anchor graph and the clone/undo/replay
 * paths CBI-2 and CBI-4 drive). TRAP 2 in this file's header: `card.compile()`
 * throws here and nothing relies on it.
 */
function richPage(): LegacyInitialData {
  const page = plainPage() as unknown as {
    template: { root: { children: Record<string, unknown>[] } }
    content: unknown[]
    clientConfig: unknown
  }
  page.template.root.children.push(
    { type: 'div', css: { id: 'zoneA' }, props: { id: 'zoneA' }, placement: { placementName: 'zone' } },
    { type: 'div', css: { id: 'card' }, props: { id: 'card' }, component: [{ reference: 'zone', target: 'children' }] },
  )
  return page as unknown as LegacyInitialData
}

interface Page {
  sup: Supervisor
  tree: TranslatedTree
  /** authored-id lookups on the LIVE graph (translate-time objects; a restore
   *  REPLACES them, so CBI-4 re-finds by authored id). */
  root: Node
  a: Node
  zoneA: Node | undefined
  card: Node | undefined
}

/** A live node by its AUTHORED id — a restore replaces node objects, so only
 *  authored ids survive a `replay()` (`restore-integrity` `authoredIn`). */
function authoredIn(nodes: Node[], cssId: string): Node | undefined {
  return nodes.find((n) => n.css?.id === cssId || n.props?.id === cssId)
}

/** `authoredIn` with a loud FIXTURE failure — a setup break must never read as
 *  an invariance failure. */
function requireAuthored(nodes: Node[], cssId: string, where: string): Node {
  const n = authoredIn(nodes, cssId)
  if (!n) throw new Error(`FIXTURE (${where}): the live graph holds no authored #${cssId} node`)
  return n
}

/**
 * The documented host shape: ONE hub shared by `translateLegacy` and the
 * `Supervisor`, and registration through the derived-state filter
 * `state !== 'prototype'` (registry-only prototypes are not registered by
 * design). Both fixture facts each case depends on are asserted here so a
 * translate-shape change fails as `FIXTURE:`, never as an invariance red.
 */
function buildPage(opts: { rich: boolean; where: string }): Page {
  const hub = createLinkHub()
  const tree = translateLegacy(opts.rich ? richPage() : plainPage(), { hub })
  const sup = new Supervisor({ hub, maxJournalLength: MAX_JOURNAL_LENGTH })
  const registerable = tree.nodes.filter((n) => n.state !== 'prototype')
  for (const n of registerable) sup.registerNode(n)

  expect(
    sup.allNodes().length,
    `FIXTURE (${opts.rich ? 'rich' : 'plain'} page): every translated node whose derived state is not 'prototype' must be registered (measured ${sup.allNodes().length} registered of ${registerable.length} registerable / ${tree.nodes.length} translated)`,
  ).toBe(registerable.length)

  const root = requireAuthored(sup.allNodes(), 'app', opts.where)
  const a = requireAuthored(sup.allNodes(), 'a', opts.where)

  let zoneA: Node | undefined
  let card: Node | undefined
  if (opts.rich) {
    zoneA = requireAuthored(sup.allNodes(), 'zoneA', opts.where)
    card = requireAuthored(sup.allNodes(), 'card', opts.where)
    expect(
      zoneA.anchors.some((an) => an.role === 'container' && an.target === 'zone'),
      `FIXTURE (${opts.where}): #zoneA must carry a container-role anchor targeting 'zone' (the placement producer the consumer seam reads); measured anchors: ${JSON.stringify(zoneA.anchors.map((an) => `${an.role}:${typeof an.target === 'string' ? an.target : '<node>'}`))}`,
    ).toBe(true)
    expect(
      card.anchors.some((an) => an.role === 'target' && an.target === 'zone'),
      `FIXTURE (${opts.where}): #card must carry a target-role anchor naming 'zone' (its children-seam consumer edge); measured anchors: ${JSON.stringify(card.anchors.map((an) => `${an.role}:${typeof an.target === 'string' ? an.target : '<node>'}`))}`,
    ).toBe(true)
  }
  return { sup, tree, root, a, zoneA, card }
}

// ============================================================================
// Capturing the base BY MARKER ENTRY ID (never by "whatever the finder says")
// ============================================================================

/** The shapes this file reads off a serialized base. Deliberately narrow: the
 *  pin reads `template.props` and each `content[*].props` and nothing else. */
interface SnapshotEntry {
  id?: unknown
  props?: Record<string, unknown>
  css?: Record<string, unknown>
}

/** The captured base: the marker's `id` plus the SNAPSHOT OBJECT (held by
 *  reference, so a later marker replacement cannot silently swap the thing
 *  being compared — see the header's TRAP 1). */
interface BaseMarker {
  id: string
  snapshot: { template: SnapshotEntry; content: SnapshotEntry[] }
}

/** Two macrotask turns: enough for the supervisor's DEFERRED condense
 *  (`scheduleCondense`, a `setTimeout(0)`). Idiom:
 *  `tests/e2e/restore-integrity.test.ts` `flushCondense`. */
async function flushCondense(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** The journal's CURRENT base marker, read through the finder. TRAP 1: after a
 *  second condense this returns a DIFFERENT id and a FRESH snapshot — which is
 *  exactly why every comparison below holds a captured OBJECT and re-asserts
 *  the id instead of trusting this read. */
function currentBase(sup: Supervisor): BaseMarker | undefined {
  const entry = sup.journal.find((e) => e.op.kind === 'base')
  if (!entry) return undefined
  const snapshot = (entry.op as { snapshot?: unknown }).snapshot
  const shaped =
    typeof snapshot === 'object' &&
    snapshot !== null &&
    Array.isArray((snapshot as { content?: unknown }).content) &&
    typeof (snapshot as { template?: unknown }).template === 'object'
  if (!shaped) {
    throw new Error(`FIXTURE: the base marker ${entry.id} carries no { template, content[] } snapshot`)
  }
  return { id: entry.id, snapshot: snapshot as unknown as BaseMarker['snapshot'] }
}

/** Capture the base, asserting the condense actually happened (`basePresent`
 *  BEFORE any restore — a skipped condense makes every case test NOTHING). */
function captureBase(sup: Supervisor, where: string): BaseMarker {
  expect(
    sup.journalEntries().basePresent,
    `FIXTURE (${where}): the journal must carry the condensed base marker — without it the base is undefined and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')`,
  ).toBe(true)
  const base = currentBase(sup)
  if (!base) throw new Error(`FIXTURE (${where}): journalEntries() reports basePresent yet the journal holds no 'base' entry`)
  return base
}

/** The base's bytes. JSON (not a reference walk) so a nested in-place write is
 *  visible even when the outer carrier object is replaced. */
function bytesOf(base: BaseMarker): string {
  return JSON.stringify(base.snapshot)
}

/** Assert the marker is STILL the captured entry. A replacement means the
 *  comparison is invalid — say so as a FIXTURE break, never as drift. */
function assertMarkerIsCaptured(sup: Supervisor, base: BaseMarker, where: string): void {
  const now = sup.journal.find((e) => e.op.kind === 'base')
  if (now?.id !== base.id) {
    throw new Error(
      `FIXTURE (${where}): a SECOND condense replaced the condensed base marker (captured ${base.id}, the journal now holds ${now?.id ?? 'no base at all'}) — the comparison is INVALID, not a finding: the replacement splices a FRESH snapshot of the current graph in place of the old one, so re-reading the finder would look like "the base changed" while nothing was mutated. Drive this window WITHOUT awaits (the condense is a deferred setTimeout) and keep the post-condense writes at/under maxJournalLength so no replacement can fire mid-window; CBI-5 is the explicit negative control that documents this artefact.`,
    )
  }
}

/** The per-op bisect: marker identity first, then byte-identity. Returns the
 *  current bytes so the caller can chain the next comparison. */
function assertBaseUnchanged(sup: Supervisor, base: BaseMarker, before: string, where: string): string {
  assertMarkerIsCaptured(sup, base, where)
  const after = bytesOf(base)
  expect(
    after,
    `${where}: the sanctioned write MUTATED an object the condensed base captured in place — every sanctioned write path must REPLACE the object it touches (the base's aliasing is INTENDED, so this discipline is the only thing keeping a host's history honest: docs/decisions.md CONDENSE-BASE-IS-A-LIVE-VIEW). Measured base bytes: ${before.length} before -> ${after.length} after (marker ${base.id}, still the same entry)`,
  ).toBe(before)
  return after
}

/** The base's serialized entry for an authored id (CBI-3a reads its `props`). */
function contentEntryFor(base: BaseMarker, cssId: string): SnapshotEntry {
  const entry = base.snapshot.content.find((c) => c.props?.id === cssId || c.css?.id === cssId)
  if (!entry) {
    throw new Error(
      `FIXTURE: the condensed base ships no content entry for #${cssId} — measured content ids: ${JSON.stringify(base.snapshot.content.map((c) => String(c.id)))}`,
    )
  }
  return entry
}

/** Drive the recipe (`WRITE_COUNT` ordinary writes → `flush()` → two
 *  `setTimeout(0)` turns) and capture the base. The writes go through the
 *  ROOT so the base's `template.props` is the carrier CBI-1/CBI-3/CBI-4 bisect. */
async function condenseSup(sup: Supervisor, root: Node, where: string): Promise<BaseMarker> {
  for (let i = 0; i < WRITE_COUNT; i += 1) {
    const res = sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.tick', mode: 'replace', value: `tick-${i}` }],
    })
    expect(res.status, `FIXTURE (${where}): the condense recipe's own write ${i} must apply — measured '${res.status}'`).toBe('applied')
  }
  await sup.flush()
  await flushCondense()
  return captureBase(sup, where)
}

// ============================================================================
// CBI-1 — the invariant, plain page (the per-op bisect)
// ============================================================================
//
// ⚠ MEASURED SEMANTICS OF THE DOTTED WRITES (recorded, never worked around): a
// `props.theme.mode` write lands as a LITERAL FLAT key on the node's compiled
// props (`'theme.mode'`), it does NOT traverse/reach the nested `theme` object
// (`applyPropSlice` keys the layer verbatim). So the dotted rows prove the write
// path leaves the captured nested object alone, while the TOP-LEVEL
// `props.theme` replace is the row that swaps the aliased carrier out from under
// the base. Both must leave the base byte-identical — that is the contract, and
// a future engine that DOES implement dotted traversal must keep it too.
//
// ⚠ NO AWAITS INSIDE THIS WINDOW: `maxJournalLength` is 5, so the 6th
// post-condense journal entry schedules a second condense whose `setTimeout(0)`
// would fire at the next await and replace the marker (`assertMarkerIsCaptured`
// would then fail loudly). The seven writes are applied synchronously (their
// layer/`compileLocal` effect is synchronous), and the deferred work is drained
// only AFTER the last comparison.

describe('CONDENSE-BASE-INVARIANCE — every sanctioned write path REPLACES, never mutates, the captured base (plain page)', () => {
  it('CBI-1 seven sanctioned writes on the plain page leave the condensed base byte-identical (one op at a time)', async () => {
    const page = buildPage({ rich: false, where: 'CBI-1' })
    const sup = page.sup
    const base = await condenseSup(sup, page.root, 'CBI-1')

    assertMarkerIsCaptured(sup, base, 'CBI-1 window start')
    const initial = bytesOf(base)
    let bytes = initial

    const ops: { label: string; node: Node; targetProp: string; value: unknown }[] = [
      { label: 'props.theme.mode (dotted nested)', node: page.root, targetProp: 'props.theme.mode', value: 'dark' },
      { label: 'props.theme.depth.n (dotted deep)', node: page.root, targetProp: 'props.theme.depth.n', value: 9 },
      { label: 'props.theme (top-level carrier replace)', node: page.root, targetProp: 'props.theme', value: { extra: true } },
      { label: 'props.tick (top-level)', node: page.root, targetProp: 'props.tick', value: 'cbi-1-tick' },
      { label: 'props.meta.tags (dotted nested)', node: page.a, targetProp: 'props.meta.tags', value: ['z'] },
      { label: 'content', node: page.a, targetProp: 'content', value: 'bye' },
      { label: 'css.style', node: page.root, targetProp: 'css.style', value: 'color: blue;' },
    ]

    for (const op of ops) {
      const res = sup.apply({
        kind: 'state-slice',
        node: op.node,
        mutation: [{ targetProp: op.targetProp, mode: 'replace', value: op.value }],
      })
      expect(
        res.status,
        `FIXTURE (CBI-1 ${op.label}): the sanctioned write must APPLY — a rejected / no-usable-state write would make its base-invariance check VACUOUS (nothing touched the graph, so nothing could mutate the base); measured status '${res.status}'${res.error ? ` code '${res.error.code}'` : ''}`,
      ).toBe('applied')
      bytes = assertBaseUnchanged(sup, base, bytes, `CBI-1 ${op.label}`)
    }

    expect(
      bytes,
      `CBI-1: the condensed base changed across the seven-write window — measured ${bytes.length} bytes at the end vs the ${initial.length} bytes captured before the first op; every sanctioned write must REPLACE the object it touches (see the per-op messages above for which one drifted)`,
    ).toBe(initial)

    // Drain the deferred work AFTER the last comparison. A second condense may
    // replace the marker here (the journal is above maxJournalLength) — that is
    // CBI-5's artefact, not drift, so it is asserted there and not here.
    await sup.flush()
    await flushCondense()
    expect(
      sup.journalEntries().basePresent,
      'CBI-1: a base marker must still be present after the window drains (the condense rewrites the journal, it never removes the concept of a base)',
    ).toBe(true)
  })
})

// ============================================================================
// CBI-2 — the invariant, rich page (structural ops, undo/redo, rejections, replay)
// ============================================================================

describe('CONDENSE-BASE-INVARIANCE — structural ops, undo/redo, rejected ops and replay leave the captured base byte-identical (rich page)', () => {
  it('CBI-2 clone-instance, undo, redo, a rejected placement-attach, a rejected attach and replay all leave the base untouched', async () => {
    const page = buildPage({ rich: true, where: 'CBI-2' })
    const sup = page.sup
    const base = await condenseSup(sup, page.root, 'CBI-2')

    assertMarkerIsCaptured(sup, base, 'CBI-2 window start')
    const initial = bytesOf(base)
    let bytes = initial
    const nodesBeforeClone = sup.allNodes().length

    // ---- clone-instance: mints (and wires) a fresh copy -------------------
    const clone = sup.apply({ kind: 'clone-instance', source: page.a, slot: page.root })
    expect(
      clone.status,
      `FIXTURE (CBI-2 clone-instance): the clone must APPLY on this healthy fixture — measured '${clone.status}'${clone.error ? ` code '${clone.error.code}'` : ''}`,
    ).toBe('applied')
    expect(
      sup.allNodes().length,
      `FIXTURE (CBI-2 clone-instance): the clone must actually mint a registered node (measured ${nodesBeforeClone} -> ${sup.allNodes().length}); an op that mints nothing makes its base check vacuous`,
    ).toBeGreaterThan(nodesBeforeClone)
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-2 clone-instance')

    // ---- a real journaled write, so undo/redo have a real inverse ---------
    // MEASURED: the `clone-instance` entry carries `op.source` (not `op.node`),
    // so `undo()` OF THAT ENTRY is a 'no-op' today; to keep the undo half of this
    // case from being vacuous the window also writes one ordinary `props.tick`
    // slice, whose inverse IS the layer removal asserted below.
    const write = sup.apply({
      kind: 'state-slice',
      node: page.root,
      mutation: [{ targetProp: 'props.tick', mode: 'replace', value: 'cbi-2-undo' }],
    })
    expect(write.status, `FIXTURE (CBI-2 undo write): the write that undo inverts must APPLY — measured '${write.status}'`).toBe('applied')
    const written = write.sliceLayers ?? []
    expect(
      written,
      'FIXTURE (CBI-2 undo write): the state-slice must report the layer id it created (the undo handle), otherwise "undo removed it" cannot be asserted',
    ).not.toEqual([])
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-2 props.tick (the write undo inverts)')

    // ---- undo(): the inverse removes the written layer --------------------
    const undo = sup.undo()
    expect(undo.status, `FIXTURE (CBI-2 undo): undo must apply (not 'no-op'/'base-boundary') — measured '${undo.status}'`).toBe('applied')
    expect(
      page.root.layers.filter((l) => written.includes(l.id)),
      `FIXTURE (CBI-2 undo): undo must have removed the write's own layer(s) ${JSON.stringify(written)} — measured layers still present: ${JSON.stringify(page.root.layers.map((l) => l.id))}; a "successful" undo that removes nothing makes this case vacuous`,
    ).toEqual([])
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-2 undo()')

    // ---- redo(): re-applies the write -------------------------------------
    const redo = sup.redo()
    expect(redo.status, `FIXTURE (CBI-2 redo): redo must apply — measured '${redo.status}'`).toBe('applied')
    expect(
      page.root.props.tick,
      `FIXTURE (CBI-2 redo): redo must re-apply the write (the live props.tick must be back to 'cbi-2-undo', measured ${JSON.stringify(page.root.props.tick)}) — a redo that re-applies nothing makes this case vacuous`,
    ).toBe('cbi-2-undo')
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-2 redo()')

    // ---- a REJECTED placement-attach (no valid container name) -----------
    // The rejection is asserted FIRST and loudly: a silently-applied op would
    // make the base check beside it vacuous.
    const rejectedPlacement = sup.apply({
      kind: 'placement-attach',
      node: page.a,
      container: page.zoneA,
      names: [],
    })
    expect(
      rejectedPlacement.status,
      `FIXTURE (CBI-2 placement-attach): a placement-attach with NO valid container name must be REJECTED (a silently-applied op would make this case vacuous); measured '${rejectedPlacement.status}'${rejectedPlacement.error ? ` code '${rejectedPlacement.error.code}'` : ''}`,
    ).toBe('rejected')
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-2 rejected placement-attach')

    // ---- a REJECTED attach (the node already has a parent) ---------------
    const rejectedAttach = sup.apply({ kind: 'attach', node: page.a, to: page.root })
    expect(
      rejectedAttach.status,
      `FIXTURE (CBI-2 attach): attaching an already-parented node must be REJECTED (single-parent); a silently-applied op would make this case vacuous — measured '${rejectedAttach.status}'${rejectedAttach.error ? ` code '${rejectedAttach.error.code}'` : ''}`,
    ).toBe('rejected')
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-2 rejected attach')

    // ---- replay(): restore + re-apply ------------------------------------
    const nodesBeforeReplay = sup.allNodes().length
    const replay = sup.replay()
    expect(
      replay.status,
      `CBI-2: replay() must APPLY on this healthy fixture — a refusal must not masquerade as "nothing changed" (measured '${replay.status}')`,
    ).toBe('applied')
    expect(
      sup.allNodes().length,
      `FIXTURE (CBI-2 replay): the restore must not empty the graph (measured ${nodesBeforeReplay} -> ${sup.allNodes().length})`,
    ).toBeGreaterThan(0)
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-2 replay()')

    await sup.flush()
    await flushCondense()
    assertMarkerIsCaptured(sup, base, 'CBI-2 window end')
    expect(
      bytes,
      `CBI-2: the condensed base changed across the structural window — measured ${bytes.length} bytes at the end vs the ${initial.length} bytes captured before the first op; every sanctioned path (clone/undo/redo/rejections/replay) must REPLACE the object it touches`,
    ).toBe(initial)
  })
})

// ============================================================================
// CBI-3 — the intentional-alias CONTROLS (the anti-vacuity device)
// ============================================================================

describe('CONDENSE-BASE-INVARIANCE — the aliasing these cases defend is REAL, and the write path replaces rather than mutates it', () => {
  it('CBI-3 control: a live nested props object IS the base object, while a top-level write REPLACES the live carrier', async () => {
    const page = buildPage({ rich: true, where: 'CBI-3' })
    const sup = page.sup
    const base = await condenseSup(sup, page.root, 'CBI-3')

    // (a) THE ALIAS IS REAL. This is why the invariance cases above are load-
    // bearing: the base ships #a's `props.meta` BY REFERENCE, so an in-place
    // write anywhere on that object would retro-mutate recorded history.
    // A future engine that clones at condense legitimately breaks THIS half —
    // that is the control reporting the CONTRACT MOVED (the ruling in
    // docs/decisions.md CONDENSE-BASE-IS-A-LIVE-VIEW would have been amended),
    // not the engine breaking.
    const aBase = contentEntryFor(base, 'a')
    expect(
      page.a.props.meta,
      `CBI-3a: the condensed base must ALIAS the live graph — #a's live props.meta must be the SAME object as the base content entry's props.meta (shipped by reference, no copy: docs/decisions.md CONDENSE-BASE-IS-A-LIVE-VIEW). Measured live ${JSON.stringify(page.a.props.meta)} vs base ${JSON.stringify(aBase.props?.meta)}; if they are different OBJECTS the base was detached/cloned, and every invariance case in this file would then be satisfied vacuously`,
    ).toBe(aBase.props?.meta)

    // (b) THE WRITE REPLACES. Pre-write the live carrier IS the base's object;
    // after a top-level `props.theme` write the live carrier is a NEW object and
    // the base still holds the authored one — i.e. the write REPLACED rather
    // than mutating the captured object. (A clone-on-condense engine keeps THIS
    // half green, which is the asymmetry the header describes.)
    const baseTheme = base.snapshot.template.props?.theme
    expect(
      page.root.props.theme,
      `CBI-3b (precondition): before the write, the live root.props.theme must BE the base template's props.theme object (measured live ${JSON.stringify(page.root.props.theme)} vs base ${JSON.stringify(baseTheme)}) — otherwise "the identity changed" below is not evidence of a REPLACE`,
    ).toBe(baseTheme)

    const before = bytesOf(base)
    const write = sup.apply({
      kind: 'state-slice',
      node: page.root,
      mutation: [{ targetProp: 'props.theme', mode: 'replace', value: { mode: 'dark', depth: { n: 42 } } }],
    })
    expect(write.status, `FIXTURE (CBI-3b): the top-level props.theme write must APPLY — measured '${write.status}'`).toBe('applied')

    expect(
      page.root.props.theme,
      `CBI-3b: a top-level props write must REPLACE the live carrier object, not mutate the base's — measured live theme ${JSON.stringify(page.root.props.theme)} vs base theme ${JSON.stringify(base.snapshot.template.props?.theme)}; if these are the SAME object the write mutated the captured one in place (or replaced the base's reference), and the invariance pin is broken`,
    ).not.toBe(base.snapshot.template.props?.theme)
    expect(
      base.snapshot.template.props?.theme,
      `CBI-3b: the base's captured theme must still hold the AUTHORED value {mode:'light', depth:{n:1}} after the write — measured ${JSON.stringify(base.snapshot.template.props?.theme)}`,
    ).toEqual({ mode: 'light', depth: { n: 1 } })
    assertBaseUnchanged(sup, base, before, 'CBI-3b props.theme replace')
  })
})

// ============================================================================
// CBI-4 — the post-restore window (the case nobody has measured)
// ============================================================================

describe('CONDENSE-BASE-INVARIANCE — the post-restore window: writes made while the LIVE graph holds the base\'s own objects', () => {
  it('CBI-4 after a restore, sanctioned writes + a second replay leave the base byte-identical to its pre-restore self', async () => {
    const page = buildPage({ rich: false, where: 'CBI-4' })
    const sup = page.sup
    const base = await condenseSup(sup, page.root, 'CBI-4')
    const authoredTheme = base.snapshot.template.props?.theme
    const aBase = contentEntryFor(base, 'a')
    const beforeRestore = bytesOf(base)

    // ---- the restore: the graph-REPLACE re-seeds from the base itself -----
    const firstReplay = sup.replay()
    expect(firstReplay.status, `FIXTURE (CBI-4): the first replay() must apply — measured '${firstReplay.status}'`).toBe('applied')
    assertMarkerIsCaptured(sup, base, 'CBI-4 after the first replay')

    // Re-find by AUTHORED id: the restore replaces the node objects.
    const restoredRoot = requireAuthored(sup.allNodes(), 'app', 'CBI-4 post-restore')
    const restoredA = requireAuthored(sup.allNodes(), 'a', 'CBI-4 post-restore')

    // THE WINDOW'S OWN PRECONDITION: the live graph now holds the base's
    // carrier OBJECTS (the re-seed parses the snapshot in place — `parseNodeState`
    // keeps `props` by reference and `compileLocal` shallow-copies only the
    // outer object). An in-place write HERE would corrupt the base with no
    // engine bug required, which is what makes this window worth pinning.
    // A future clone-on-restore would legitimately make this a FIXTURE-shaped
    // report: the contract (docs/decisions.md CONDENSE-BASE-IS-A-LIVE-VIEW)
    // would have moved, and the invariance assertion below would then be
    // satisfied for a weaker reason.
    expect(
      restoredRoot.props.theme,
      `FIXTURE (CBI-4): after the restore the LIVE root.props.theme must BE the base template's theme object (measured live ${JSON.stringify(restoredRoot.props.theme)} vs base ${JSON.stringify(authoredTheme)}) — without that the "post-restore window" is not the aliased window this case is about`,
    ).toBe(authoredTheme)
    expect(
      restoredA.props.meta,
      `FIXTURE (CBI-4): after the restore the LIVE #a props.meta must BE the base content entry's props.meta (measured live ${JSON.stringify(restoredA.props.meta)} vs base ${JSON.stringify(aBase.props?.meta)})`,
    ).toBe(aBase.props?.meta)

    // ---- sanctioned writes INSIDE the window -----------------------------
    let bytes = beforeRestore
    const themeWrite = sup.apply({
      kind: 'state-slice',
      node: restoredRoot,
      mutation: [{ targetProp: 'props.theme', mode: 'replace', value: { mode: 'dark', depth: { n: 7 } } }],
    })
    expect(themeWrite.status, `FIXTURE (CBI-4 props.theme): the post-restore write must APPLY — measured '${themeWrite.status}'`).toBe('applied')
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-4 post-restore props.theme')

    const contentWrite = sup.apply({
      kind: 'state-slice',
      node: restoredA,
      mutation: [{ targetProp: 'content', mode: 'replace', value: 'restored-bye' }],
    })
    expect(contentWrite.status, `FIXTURE (CBI-4 content): the post-restore write must APPLY — measured '${contentWrite.status}'`).toBe('applied')
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-4 post-restore content')

    // ---- the second replay re-restores from the SAME base ----------------
    const secondReplay = sup.replay()
    expect(
      secondReplay.status,
      `FIXTURE (CBI-4): the second replay() must apply — measured '${secondReplay.status}'; a refusal would leave "nothing changed" unexplained`,
    ).toBe('applied')
    bytes = assertBaseUnchanged(sup, base, bytes, 'CBI-4 second replay()')

    expect(
      bytes,
      `CBI-4: the post-restore window corrupted the base — the window in which the LIVE graph IS the base's objects must leave it byte-identical to its pre-restore self (measured ${beforeRestore.length} bytes pre-restore vs ${bytes.length} now; an in-place write here retro-mutates a host's history with no engine bug required)`,
    ).toBe(beforeRestore)

    await sup.flush()
    await flushCondense()
    assertMarkerIsCaptured(sup, base, 'CBI-4 window end')
  })
})

// ============================================================================
// CBI-5 — the ARTEFACT guard: a second condense REPLACES the marker (BY DESIGN)
// ============================================================================

describe('CONDENSE-BASE-INVARIANCE — a second condense REPLACES the base marker (the measurement artefact, documented as a negative control)', () => {
  it('CBI-5 a second condense replaces the marker (new entry id, basePresent stays true) — re-reading the finder is NOT drift', async () => {
    const page = buildPage({ rich: false, where: 'CBI-5' })
    const sup = page.sup
    const base1 = await condenseSup(sup, page.root, 'CBI-5')
    const oldBytes = bytesOf(base1)

    // Drive enough ORDINARY writes to force the deferred, size-guarded condense
    // to rewrite again. `journal.length` exceeds maxJournalLength on the 6th
    // post-condense entry; the single deferred condense then runs at the drain
    // below and splices a FRESH snapshot in place of the marker.
    for (let i = 0; i < SECOND_CONDENSE_WRITES; i += 1) {
      const res = sup.apply({
        kind: 'state-slice',
        node: page.root,
        mutation: [{ targetProp: 'props.tick', mode: 'replace', value: `post-${i}` }],
      })
      expect(res.status, `FIXTURE (CBI-5): write ${i} of the second-condense window must apply — measured '${res.status}'`).toBe('applied')
    }
    expect(
      sup.journalEntries().basePresent,
      'CBI-5: the first base must still be present before the drain (the replacement below is a REWRITE, not a removal)',
    ).toBe(true)

    await sup.flush()
    await flushCondense()

    const base2 = currentBase(sup)
    if (!base2) throw new Error('FIXTURE (CBI-5): the journal no longer holds ANY base marker after the drain')

    expect(
      base2.id,
      `CBI-5: a second condense must REPLACE the base marker — measured entry id '${base1.id}' then '${base2.id}'. If they are equal the rewrite did NOT fire (the deferred condense is also SIZE-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size'): raise SECOND_CONDENSE_WRITES — this is a condense-POLICY change, NOT an engine write, and the fix is never to re-read the finder`,
    ).not.toBe(base1.id)
    expect(
      sup.journalEntries().basePresent,
      'CBI-5: a replacement must keep a base marker present (the rewrite collapses the pre-base window into ONE base entry — basePresent must stay true)',
    ).toBe(true)
    expect(
      base1.snapshot.template.props?.tick,
      `CBI-5: the captured OLD snapshot object must be untouched by the replacement — measured template props.tick ${JSON.stringify(base1.snapshot.template.props?.tick)}, expected the condense recipe's last write 'tick-${WRITE_COUNT - 1}'`,
    ).toBe(`tick-${WRITE_COUNT - 1}`)
    expect(
      base2.snapshot.template.props?.tick,
      `CBI-5: the NEW marker is a FRESH capture of the CURRENT graph (that is why re-reading the finder looks like "the base changed") — measured template props.tick ${JSON.stringify(base2.snapshot.template.props?.tick)}, expected the last ordinary write 'post-${SECOND_CONDENSE_WRITES - 1}'`,
    ).toBe(`post-${SECOND_CONDENSE_WRITES - 1}`)
    expect(
      bytesOf(base1),
      `CBI-5: the captured OLD base object must stay byte-identical across the marker replacement (measured ${oldBytes.length} bytes at capture, ${bytesOf(base1).length} now) — the replacement SPLICES a new marker entry, it never rewrites the captured snapshot`,
    ).toBe(oldBytes)
  })
})
