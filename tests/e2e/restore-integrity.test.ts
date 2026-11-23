/**
 * `RESTORE-PATHKEY-DUPLICATION` + `RESTORE-INTEGRITY` (`docs/defects.md` rows of
 * those names) — RED FIRST (AGENTS.md item 8): written against a tree where both
 * defects are live, with **no `src/**` change** accompanying this file.
 *
 * THE MECHANISM (the rows' 2026-11-23 probe, re-measured here): a condensed-base
 * restore is a **graph-REPLACE** — `Supervisor.replay()` hits the `base` marker,
 * `_restoreBase` evicts every pre-base node from the supervisor's map and
 * re-seeds the snapshot through `new Node(d, hub, …)`. Two things the replace
 * never does:
 *
 *  - **(a) it never detaches the evicted generation's anchors from a
 *    HUB-SHARED `Link`.** The per-name placement Link (`hub.linkFor(name,
 *    'placement')`) still holds the old generation's `container`-role anchors —
 *    and those owners are **not destroyed**, only evicted — so the NEXT
 *    `compilePath` of a placement consumer fans out through both generations
 *    (`node.ts` `enumPathWalks`' placement branch: for each `content` anchor →
 *    for each `container` anchor on that link) and mints one path state per
 *    stale anchor with a `pathKey` that is **byte-identical** to the live one
 *    (the restore re-seeds the same node ids). Two elements on one wire is the
 *    `GRAFT-ROOT-PATHKEY-COLLISION` hazard re-opened by a different route.
 *  - **(b) it never re-establishes `contentNodes` scope membership**
 *    (`registerContentNode` is called only by `translate`/`payload`), and it
 *    **empties the graph outright when the supervisor holds no hub** (`if (!hub)
 *    return` runs AFTER the eviction).
 *
 * ⚠ THE FIXTURE TRAP THIS FILE DEFENDS AGAINST (it invalidated a first probe): a
 * condense is **deferred AND size-guarded** — `condense()` compares the estimated
 * base against the pre-base journal and SKIPS the rewrite with
 * `condense-skipped-size` when the base is not smaller. If no base marker
 * exists, `replay()` never runs `_restoreBase` and a "restore" case silently
 * passes on nothing. Every restore cycle here therefore (a) sets
 * `maxJournalLength: 5`, (b) writes 35 ordinary `state-slice` writes so the
 * pre-base window outweighs the base, and (c) **asserts
 * `journalEntries().basePresent === true` BEFORE `replay()`** — a skip fails
 * loudly on a `FIXTURE:` message instead of passing vacuously. Idiom:
 * `tests/e2e/post-bootstrap-emit.test.ts` PBED-8 + `tests/unit/journal-condensing.test.ts`.
 *
 * WHAT THIS FILE ASSERTS:
 *  - **RI-1a** (RED today) `#card.compilePath().actionable.length` is STABLE
 *    across three restores (measured today: **2 → 4 → 6 → 8**).
 *  - **RI-1b** (RED today) the `pathKey` SET is unchanged AND duplicate-free
 *    after every restore (today the two placement keys repeat once per restore).
 *  - **RI-1c** (RED today) the per-name placement `Link`'s `container`-role
 *    anchor count is STABLE (measured today: **2 → 4 → 6 → 8**).
 *  - **RI-2a** (RED today) a restored content root still satisfies
 *    `isContentNode(node) === true` (today `false`, while `state` still reads
 *    `'in-tree'` because that is token-derived — the loss is LATENT).
 *  - **RI-2b** (RED today) the OBSERVABLE consequence: a restored content root
 *    whose token anchor is detached (so `state` is no longer `'in-tree'`) is
 *    SPARED by the sweep (today it is finalized and evicted).
 *  - **RI-2c** (CONTROL, green today) without a restore the same detach leaves
 *    the payload-owned content root alive — the semantics RI-2b must restore.
 *  - **RI-3** (RED today) a hub-LESS restore does not empty the graph, and if it
 *    cannot restore it says so (today: `allNodes() === 0` with
 *    `replay().status === 'applied'` and ZERO `console.warn` — silent total loss).
 *
 * NAMESPACE/SCOPE DISCIPLINE: every case builds its OWN `createLinkHub()` and its
 * own translated tree, so no case is coupled to another's shared per-name Link
 * or node ids (node ids are minted from a module counter).
 *
 * IMPORT NOTE: `isContentNode` is NOT re-exported from the package barrel
 * (`src/index.ts`), so this file imports the deep core path — the established
 * idiom for the registry surface (`tests/unit/destroy-cascade.test.ts:15`).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import {
  translateLegacy,
  createLinkHub,
  type LegacyInitialData,
  type TranslatedTree,
} from '../../src/core/translate.js'
// deep core path — not on the package barrel (see the header's IMPORT NOTE)
import { isContentNode } from '../../src/core/registry.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// The page (`root > #zA, #zB (both offer 'zone') + #card (targets 'zone')`)
// ============================================================================

const CLIENT_CONFIG = { runInstantiation: true, runRendering: true }

/** The condense trigger (the row's probe used `5`). Low enough that 35 plain
 *  writes blow past it, high enough that the writes are the thing that fills
 *  the pre-base window (the deferred, SIZE-GUARDED condense — see the header). */
const MAX_JOURNAL_LENGTH = 5

/** Ordinary post-bootstrap writes the host would make. 35 is the row's probe
 *  count: enough bytes that the condensed base is a memory WIN, so the D5 size
 *  guard rewrites instead of warning `condense-skipped-size`. */
const WRITE_COUNT = 35

/**
 * `div#root` with two placement PRODUCERS (`#zA`, `#zB`, both offering `zone`)
 * and ONE placement consumer as `template.children[]` (`div#card`,
 * `targetPlacement: ['zone']`) — i.e. one intended path state per offering
 * container (`PLACEMENT-SECOND-CONTAINER-STALE` ratified that multiplicity as
 * design). The consumer is a CONTENT root, so the tree bootstraps through
 * `compilePath` (path states).
 *
 * `payload` adds a `content: [...]` payload: it mints a second, UNPLACED
 * content root (`section#slot`), which is what RI-2 needs — a content node whose
 * survival depends on `contentNodes` membership rather than on a token-derived
 * `'in-tree'` state it shares with every restored template node.
 */
function restorePage(opts: { payload?: boolean } = {}): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        children: [
          { type: 'aside', css: { id: 'zA' }, props: { id: 'zA' }, placement: { placementName: 'zone' } },
          { type: 'aside', css: { id: 'zB' }, props: { id: 'zB' }, placement: { placementName: 'zone' } },
        ],
      },
      children: [
        { type: 'div', css: { id: 'card' }, props: { id: 'card' }, placement: { targetPlacement: ['zone'] } },
      ],
    },
    content: opts.payload === true
      ? [{ content: [{ type: 'section', css: { id: 'slot' }, props: { id: 'slot' } }] }]
      : [],
    clientConfig: CLIENT_CONFIG,
  }
}

interface Page {
  sup: Supervisor
  tree: TranslatedTree
  /** authored-id lookups on the PRE-restore graph (node ids are minted). */
  root: Node
  zA: Node
  zB: Node
  card: Node
  /** the `content: [...]` payload root (`undefined` when no payload). */
  slot: Node | undefined
}

/**
 * The documented host shape the restore path needs: ONE hub shared by the
 * translate call, the `Supervisor`, and the re-seed (`createLinkHub` is the
 * public same-name shared-Link factory; idiom `tests/unit/journal-condensing.test.ts`
 * `makeSupervisor`). `hub: false` builds the hub-less host RI-3 is about (a
 * normal shape for a single-graph host — `Supervisor`'s constructor accepts it).
 */
function buildPage(opts: { hub: boolean; payload?: boolean; maxJournalLength?: number }): Page {
  const hub = opts.hub ? createLinkHub() : undefined
  const tree = translateLegacy(restorePage(opts), hub ? { hub } : undefined)
  const sup = new Supervisor({
    ...(hub ? { hub } : {}),
    ...(opts.maxJournalLength !== undefined ? { maxJournalLength: opts.maxJournalLength } : {}),
  })
  for (const n of tree.nodes) sup.registerNode(n)
  const authored = (cssId: string): Node => {
    const n = tree.nodes.find((x) => x.css?.id === cssId || x.props?.id === cssId)
    if (!n) throw new Error(`FIXTURE: the envelope has no #${cssId} node`)
    return n
  }
  return {
    sup,
    tree,
    root: tree.root,
    zA: authored('zA'),
    zB: authored('zB'),
    card: authored('card'),
    slot: opts.payload === true ? authored('slot') : undefined,
  }
}

// ============================================================================
// Reading the live graph (public surfaces only: `allNodes`, `node.css`/`props`,
// `node.anchors` → `Anchor.link` → `Link.anchorsOf`, `node.compilePath`)
// ============================================================================

/** A live node by its AUTHORED id — the restore REPLACES node objects, so a
 *  translate-time reference is stale after `replay()` (`post-bootstrap-emit`
 *  `byAuthoredId`). */
function authoredIn(nodes: Node[], cssId: string): Node | undefined {
  return nodes.find((n) => n.css?.id === cssId || n.props?.id === cssId)
}

/** `authoredIn` with a loud FIXTURE failure — a setup break must never read as
 *  a defect red. */
function requireAuthored(nodes: Node[], cssId: string): Node {
  const n = authoredIn(nodes, cssId)
  if (!n) throw new Error(`FIXTURE: the live graph holds no authored #${cssId} node (the restore lost it)`)
  return n
}

/** The node's actionable path states' keys, SORTED (so a series is comparable
 *  across cycles regardless of mint order). */
function pathKeysOf(node: Node): string[] {
  return node.compilePath().actionable.map((s): string => s.pathKey).sort()
}

/** The `container`-role anchor count on the per-name placement `Link` a live
 *  producer reads — via the public `Anchor.link` backref, never an internal map.
 *  `#zA`'s own anchor is the handle: the `'zone'` Link is shared by every
 *  producer of that name AND (today, wrongly) by every evicted generation. */
function containerAnchorCount(nodes: Node[], cssId: string): number {
  const node = requireAuthored(nodes, cssId)
  const anchor = node.anchors.find((a) => a.role === 'container')
  if (!anchor) throw new Error(`FIXTURE: the live #${cssId} carries no container-role anchor (the 'zone' producer anchor)`)
  return anchor.link.anchorsOf('container').length
}

// ============================================================================
// The condense recipe (deferred + size-guarded — the header's trap)
// ============================================================================

/** Two macrotask turns: enough for the supervisor's DEFERRED condense
 *  (`scheduleCondense`, a `setTimeout(0)`). Idiom:
 *  `tests/e2e/post-bootstrap-emit.test.ts` `flushCondense`. */
async function flushCondense(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Three macrotask turns — one for the module sweep (`registry.ts`
 *  `scheduleSweep`, a `setTimeout(0)`) plus slack for a cascade it re-schedules. */
async function settleSweep(): Promise<void> {
  for (let i = 0; i < 3; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Drive the journal past `maxJournalLength` with the host's own ordinary
 *  writes, then let the deferred condense run. Returns the journal view so the
 *  CALLER asserts `basePresent` (each case's own precondition — never hidden in
 *  this helper). */
async function writePastTheCondenseThreshold(sup: Supervisor): Promise<ReturnType<Supervisor['journalEntries']>> {
  const [target] = sup.allNodes()
  if (!target) throw new Error('FIXTURE: the graph is empty — there is nothing for the condense recipe to write to')
  for (let i = 0; i < WRITE_COUNT; i += 1) {
    sup.apply({
      kind: 'state-slice',
      node: target,
      mutation: [{ targetProp: 'props.tick', mode: 'replace', value: `tick-${i}` }],
    })
  }
  await sup.flush()
  await flushCondense()
  return sup.journalEntries()
}

/** A node that is NOT content-owned and NOT in-tree once detached: it is the
 *  sweep's sentinel. `destroyed === true` after the wait PROVES the sweep ran in
 *  that window, so "the content root survived" cannot be a run in which the
 *  sweep never fired. */
function sweepSentinel(cssId: string): Node {
  return translateLegacy({
    template: { root: { type: 'span', css: { id: cssId }, props: { id: cssId } } },
    content: [],
    clientConfig: CLIENT_CONFIG,
  }).root
}

// ============================================================================
// RI-1 — RESTORE-PATHKEY-DUPLICATION
// ============================================================================
//
// ⚠ BASELINE vs THE ROW'S PROBE SERIES (read before matching the numbers): the
// row records `3 → 5 → 7 → 9` states and `4 → 6 → 8 → 10` container anchors.
// THIS fixture's pristine post-bootstrap baseline is **2 states / 2 container
// anchors** (one placement path state per OFFERING container, and one container
// anchor per producer — both asserted as FIXTURE preconditions), measured
// today as `2 → 4 → 6 → 8` for BOTH series. The per-restore DELTA is exactly the
// row's **+2**, and the shape is identical (each live `pathKey` minted once more
// per restore; each evicted generation's anchors left on the shared Link). The
// row's series starts one unit higher on both axes — one extra STATE (the
// zero-hop token walk, which gate `E5` suppresses for a `routed` node) and one
// extra ANCHOR generation (that probe's baseline appears to have been taken one
// restore in). The assertion here is the STRICTER one: STABILITY against the
// pristine baseline, which is itself asserted, so the fix cannot satisfy it by
// moving the baseline.

interface RestoreTrail {
  /** `#card.compilePath().actionable.length` — index 0 = the pre-restore
   *  baseline, indices 1..3 = after each of three restores. */
  counts: number[]
  /** the same cycle's sorted `pathKey`s. */
  keysByCycle: string[][]
  /** the per-name placement Link's `container`-role anchor count per cycle. */
  containerAnchors: number[]
}

/**
 * Three full restore cycles: writes → wait → assert `basePresent` → `replay()` →
 * re-find the nodes. Every FIXTURE precondition is asserted here (base marker
 * present, `replay()` applied, the graph still holds the authored nodes and does
 * not shrink); the returned trail is what the cases assert on, so a setup break
 * fails on a `FIXTURE:` message and never reads as a defect red.
 */
async function measureThreeRestores(sup: Supervisor): Promise<RestoreTrail> {
  const card0 = requireAuthored(sup.allNodes(), 'card')
  const trail: RestoreTrail = {
    counts: [card0.compilePath().actionable.length],
    keysByCycle: [pathKeysOf(card0)],
    containerAnchors: [containerAnchorCount(sup.allNodes(), 'zA')],
  }
  for (let cycle = 1; cycle <= 3; cycle += 1) {
    const view = await writePastTheCondenseThreshold(sup)
    expect(
      view.basePresent,
      `FIXTURE (RI-1 cycle ${cycle}): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')`,
    ).toBe(true)

    const nodesBefore = sup.allNodes().length
    const replay = sup.replay()
    expect(replay.status, `FIXTURE (RI-1 cycle ${cycle}): replay() must restore the condensed base`).toBe('applied')
    await sup.flush()

    const nodesAfter = sup.allNodes()
    expect(
      nodesAfter.length,
      `FIXTURE (RI-1 cycle ${cycle}): the hub-present restore must not shrink the graph (${nodesBefore} -> ${nodesAfter.length}) — this case is about path states, not about the hub-less eviction (RI-3)`,
    ).toBeGreaterThanOrEqual(nodesBefore)

    const card = requireAuthored(nodesAfter, 'card')
    const states = card.compilePath().actionable
    trail.counts.push(states.length)
    trail.keysByCycle.push(pathKeysOf(card))
    trail.containerAnchors.push(containerAnchorCount(nodesAfter, 'zA'))
  }
  return trail
}

describe('RESTORE-PATHKEY-DUPLICATION — a condensed-base restore must not duplicate path states', () => {
  it('RI-1a #card.compilePath().actionable.length stays at the authored count across three restores', async () => {
    const page = buildPage({ hub: true, maxJournalLength: MAX_JOURNAL_LENGTH })
    const trail = await measureThreeRestores(page.sup)
    const baseline = trail.counts[0]

    // FIXTURE: one placement state per OFFERING container (2) — the ratified
    // multiplicity (`PLACEMENT-SECOND-CONTAINER-STALE`), and no zero-hop token
    // walk (gate `E5` suppresses it for a `routed` node).
    expect(
      baseline,
      'FIXTURE: #card must start with one path state per offering container (2 = #zA + #zB) — if this is not 2 the envelope, not the restore, is wrong',
    ).toBe(2)

    expect(
      trail.counts,
      `RI-1a: a restore DUPLICATED #card's path states — the count must stay at the authored ${baseline} after every restore; measured counts per cycle (index 0 = pre-restore baseline): ${JSON.stringify(trail.counts)}`,
    ).toEqual([baseline, baseline, baseline, baseline])
  })

  it('RI-1b the pathKey set is unchanged AND duplicate-free after every restore', async () => {
    const page = buildPage({ hub: true, maxJournalLength: MAX_JOURNAL_LENGTH })
    const trail = await measureThreeRestores(page.sup)
    const baselineKeys = trail.keysByCycle[0]!
    expect(baselineKeys, 'FIXTURE: the pre-restore baseline pathKeys must themselves be duplicate-free').toEqual([
      ...new Set(baselineKeys),
    ])

    const duplicated = trail.keysByCycle.slice(1).flatMap((keys, i) => {
      const seen = new Set<string>()
      const dupes = new Set<string>()
      for (const k of keys) {
        if (seen.has(k)) dupes.add(k)
        seen.add(k)
      }
      return [...dupes].map((k) => `cycle ${i + 1}: ${k}`)
    })
    expect(
      duplicated,
      `RI-1b: a restore re-minted path states with BYTE-IDENTICAL pathKeys — two elements on one wire; measured keys per cycle (index 0 = pre-restore baseline): ${JSON.stringify(trail.keysByCycle)}`,
    ).toEqual([])

    expect(
      trail.keysByCycle,
      `RI-1b: the pathKey SET must be unchanged across restores (the restore re-seeds the SAME node ids, so the same keys must come back exactly once each); measured keys per cycle: ${JSON.stringify(trail.keysByCycle)}`,
    ).toEqual([baselineKeys, baselineKeys, baselineKeys, baselineKeys])
  })

  it('RI-1c the per-name placement Link accumulates no stale container anchors across restores', async () => {
    const page = buildPage({ hub: true, maxJournalLength: MAX_JOURNAL_LENGTH })
    const trail = await measureThreeRestores(page.sup)
    const baseline = trail.containerAnchors[0]!

    expect(
      baseline,
      'FIXTURE: the per-name placement Link must start with one container anchor per producer (2 = #zA + #zB)',
    ).toBe(2)

    expect(
      trail.containerAnchors,
      `RI-1c: every restore left the EVICTED generation's container anchors on the hub-shared per-name Link (they are never destroyed, only evicted), so the count grows forever; measured container-anchor counts per cycle (index 0 = pre-restore baseline): ${JSON.stringify(trail.containerAnchors)}`,
    ).toEqual([baseline, baseline, baseline, baseline])
  })
})

// ============================================================================
// RI-2 — RESTORE-INTEGRITY (a): `contentNodes` membership is not re-established
// ============================================================================

describe('RESTORE-INTEGRITY (a) — a restore must re-establish contentNodes membership', () => {
  it('RI-2a a restored content root keeps `isContentNode(node) === true`', async () => {
    const page = buildPage({ hub: true, payload: true, maxJournalLength: MAX_JOURNAL_LENGTH })
    const slot0 = requireAuthored(page.sup.allNodes(), 'slot')

    // FIXTURE: before any restore the payload root IS content-owned and IS
    // in-tree (both registered by `translate` — `registerContentNode` at
    // `translate.ts:1182/1201`).
    expect(isContentNode(slot0), 'FIXTURE: the payload content root is content-owned before the restore').toBe(true)
    expect(slot0.state, "FIXTURE: the payload content root is token-parented ('contentNodes') and in-tree before the restore").toBe('in-tree')

    const view = await writePastTheCondenseThreshold(page.sup)
    expect(
      view.basePresent,
      "FIXTURE: the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the deferred, size-guarded condense)",
    ).toBe(true)

    const replay = page.sup.replay()
    expect(replay.status, 'FIXTURE: replay() must restore the condensed base').toBe('applied')
    await page.sup.flush()

    const slot = requireAuthored(page.sup.allNodes(), 'slot')
    expect(
      slot,
      'FIXTURE: the restore REPLACES the pre-base node objects — a stale reference would be the fixture, not the defect',
    ).not.toBe(slot0)
    expect(
      slot.state,
      "FIXTURE: the restored content root is still token-parented, so `state` still reads 'in-tree' — the membership loss is LATENT, visible only through isContentNode",
    ).toBe('in-tree')

    expect(
      isContentNode(slot),
      "RI-2a: a restored content root LOST its contentNodes scope membership (_restoreBase never calls registerContentNode — only translate/payload do), so `state === 'in-tree'` is the ONLY thing keeping it alive; once it leaves the tree it is finalized where it used to persist (\"payload-owned content persists (placement may return)\")",
    ).toBe(true)
  })

  it('RI-2b (observable consequence) a restored content root that leaves the tree SURVIVES the sweep', async () => {
    const page = buildPage({ hub: true, payload: true, maxJournalLength: MAX_JOURNAL_LENGTH })
    const view = await writePastTheCondenseThreshold(page.sup)
    expect(
      view.basePresent,
      'FIXTURE: the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING',
    ).toBe(true)

    const nodesBefore = page.sup.allNodes().length
    const replay = page.sup.replay()
    expect(replay.status, 'FIXTURE: replay() must restore the condensed base').toBe('applied')
    await page.sup.flush()
    expect(
      page.sup.allNodes().length,
      'FIXTURE: the hub-present restore must not shrink the graph (this case is the sweep\'s verdict, not RI-3\'s eviction)',
    ).toBeGreaterThanOrEqual(nodesBefore)

    const slot = requireAuthored(page.sup.allNodes(), 'slot')

    // The sentinel proves the sweep actually RAN in this window (it is neither
    // content-owned nor in-tree, so the sweep must finalize it).
    const sentinel = sweepSentinel('sweep-sentinel')
    page.sup.registerNode(sentinel)
    expect(
      page.sup.apply({ kind: 'detach', node: sentinel }).status,
      'FIXTURE: detaching the sweep sentinel is a sanctioned applied op',
    ).toBe('applied')
    expect(sentinel.state, "FIXTURE: the detached sentinel must not read 'in-tree'").not.toBe('in-tree')

    // The observable: take the restored content root OFF its token anchor, so
    // `state` is no longer 'in-tree' and the sweep — not the state — decides
    // (`registry.ts:295-296`: in-tree/prototype is exempted FIRST, then
    // `isContentNode`). RI-2a says that membership is gone after a restore.
    expect(
      page.sup.apply({ kind: 'detach', node: slot }).status,
      'FIXTURE: detaching the restored content root off its token anchor is a sanctioned applied op',
    ).toBe('applied')
    expect(slot.state, "FIXTURE: the detached content root must leave 'in-tree' — that is what makes the sweep the decider").toBe('unplaced')

    await settleSweep()

    expect(
      sentinel.destroyed,
      'FIXTURE: the sweep must have RUN in this window — the sentinel is neither content-owned nor in-tree, so a "survived" reading below would otherwise be vacuous',
    ).toBe(true)
    expect(
      slot.destroyed,
      'RI-2b: a restored content root was FINALIZED by the sweep after leaving the tree — its contentNodes membership was lost by the restore, so "payload-owned content persists (placement may return)" no longer holds; a restore must re-establish the membership',
    ).toBe(false)
    expect(
      page.sup.allNodes().some((n) => n.id === slot.id),
      'RI-2b: the restored content root was EVICTED from the supervisor, not merely flagged',
    ).toBe(true)
  })

  it('RI-2c (CONTROL, green today) without a restore the same detach leaves the content root alive', async () => {
    const page = buildPage({ hub: true, payload: true, maxJournalLength: MAX_JOURNAL_LENGTH })
    const slot = requireAuthored(page.sup.allNodes(), 'slot')
    expect(isContentNode(slot), 'FIXTURE: content-owned before the detach').toBe(true)

    const sentinel = sweepSentinel('sweep-sentinel')
    page.sup.registerNode(sentinel)
    expect(page.sup.apply({ kind: 'detach', node: sentinel }).status, 'FIXTURE: sentinel detach applied').toBe('applied')
    expect(
      page.sup.apply({ kind: 'detach', node: slot }).status,
      'FIXTURE: detaching the content root off its token anchor is a sanctioned applied op',
    ).toBe('applied')
    expect(slot.state, "FIXTURE: the detached content root must leave 'in-tree'").toBe('unplaced')

    await settleSweep()

    expect(sentinel.destroyed, 'FIXTURE: the sweep must have RUN in this window').toBe(true)
    expect(
      slot.destroyed,
      'RI-2c (CONTROL): a payload-owned content root must persist while unplaced ("placement may return") — this is the semantics RI-2b restores; a fix must not change it',
    ).toBe(false)
  })
})

// ============================================================================
// RI-3 — RESTORE-INTEGRITY (b): a hub-less restore empties the graph
// ============================================================================

describe('RESTORE-INTEGRITY (b) — a hub-less restore must not empty the graph', () => {
  it('RI-3 a hub-less restore preserves the graph, and is LOUD if it refuses', async () => {
    // THE HUB-LESS HOST: neither `translateLegacy` nor the `Supervisor` gets a
    // hub — a documented-legal shape for a single-graph host (`Supervisor`'s
    // constructor treats `hub` as optional).
    const page = buildPage({ hub: false, maxJournalLength: MAX_JOURNAL_LENGTH })
    const preCount = page.sup.allNodes().length
    expect(preCount, 'FIXTURE: the hub-less page must register its nodes before the restore').toBe(page.tree.nodes.length)
    const preRoot = page.sup.getNode(page.root.id)

    const view = await writePastTheCondenseThreshold(page.sup)
    expect(
      view.basePresent,
      'FIXTURE: the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the deferred, size-guarded condense)',
    ).toBe(true)

    // The warn spy covers ONLY the restore window: the condense (which warns
    // `condense-skipped-size` when it skips) already ran and `basePresent` is
    // true, so every captured warn here is a restore/pass-2 diagnostic.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = page.sup.replay()
    await page.sup.flush()
    await settleSweep()
    const warnText = warn.mock.calls.map((call) => call.map((a) => String(a)).join(' '))

    const postCount = page.sup.allNodes().length
    const postRoot = page.sup.getNode(page.root.id)
    const reseeded = preRoot !== undefined && postRoot !== undefined && postRoot !== preRoot

    // TODAY'S FAILURE MODE, stated here so the contract cannot be read as a
    // no-op: `_restoreBase` evicts every pre-base node FIRST and only then hits
    // `if (!hub) return` — so `allNodes()` is 0, `replay().status` is still
    // 'applied' and NOTHING is warned. Silent, total data loss.
    //
    // HALF 1 — the graph is never silently emptied.
    // (`expect.soft` on the two halves ONLY so each reports its own measurement:
    // today BOTH are red — the graph is emptied AND nothing is reported — and an
    // implementation that satisfies one must not hide the other.)
    expect.soft(
      postCount,
      `RI-3: a hub-less restore EVICTED the whole graph (allNodes ${preCount} -> ${postCount}); today the failure mode is allNodes() === 0 — silent total loss on a documented-legal host shape; the restore must either re-seed without a hub or refuse the restore BEFORE evicting`,
    ).toBeGreaterThanOrEqual(preCount)

    // HALF 2 — a restore that does not re-seed must SAY SO. A "refusal" is only
    // acceptable if it is loud, and a loud refusal must also keep the graph
    // (HALF 1); a silent no-op is rejected outright.
    const report =
      reseeded
        ? 'the graph was re-seeded'
        : `the graph was NOT re-seeded and nothing was reported (console.warn calls: ${JSON.stringify(warnText)}, replay().status: '${replay.status}')`
    expect.soft(
      reseeded || warnText.length > 0 || replay.status !== 'applied',
      `RI-3: the hub-less restore neither re-seeded the graph nor reported a diagnostic — ${report}; an engine that cannot restore must refuse LOUDLY (a console.warn or a non-success replay() status) instead of degrading to silence`,
    ).toBe(true)
  })
})
