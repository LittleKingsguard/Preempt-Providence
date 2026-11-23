/**
 * `RESTORE-SEAM-STRIP-MISS-TOTAL-LOSS` (`docs/defects.md`, OPEN — MEASURED
 * 2026-11-23) — RED FIRST (AGENTS.md item 8): this file encodes the defect
 * against a tree where it is **LIVE**, with **no `src/**` change** accompanying
 * it. It is the red set for the row's **(b) SWALLOW half** — the owner-queued
 * unit in `docs/next-steps.md` ("never leave the graph evicted-and-empty
 * silently") — written through the public host API only.
 *
 * THE MECHANISM (measured on THIS tree while authoring this file; see the
 * ✎ MEASURED note below for where the row's stated throw site differs):
 *
 *  1. `#defHost` carries the INLINE def `nav` (`component: [{ reference: 'nav',
 *     value: {...} }]`), which mints the def-root + def-child PROTOTYPES
 *     (registry-only, `translate.ts` `mintDefPrototypes`). A SECOND node,
 *     `#seamConsumer`, seam-targets that def's children
 *     (`component: [{ target: 'children', reference: 'nav' }]`).
 *  2. **Compiling the consumer wires the def-root as a seam CHILD of the
 *     consumer**, which flips the def-root's DERIVED `state` from
 *     `'prototype'` to `'in-tree'` (`node.ts` `stateChildAnchor`: the seam
 *     child anchor's parent anchor sits on an in-tree consumer). The
 *     state-dependence is the whole defect class: every reader that classifies
 *     a node by `state` now mis-classifies a seam-wired def-root.
 *  3. The def-root is therefore in `allNodes()` (the host's registration
 *     filter skips only `state === 'prototype'`) **AND** still in the
 *     def-prototype registry. `condense()` builds its capture slice as
 *     `kids = allNodes()` + the hub-filtered registry prototypes with a plain
 *     concat (`supervisor.ts:961-962`, **no Set guard**), so the ONE node
 *     appears TWICE in the snapshot's `content`.
 *  4. `replay()` → `_restoreBase` **evicts every pre-base node first**
 *     (`supervisor.ts:1021-1038`) and only then seeds; the duplicated seed
 *     makes `reconcileParentTargets` throw `LinkConfigError`
 *     (`code: 'unique-order'`, empty message). `replay`'s base branch is a
 *     bare `try/catch {}` (`supervisor.ts:1734-1739`, `UNDO-REDO-ADV-MAL-6`),
 *     so the throw is SWALLOWED **after** the eviction: measured
 *     `allNodes() === 0`, `replay().status === 'applied'`, ZERO
 *     `console.warn` — silent total graph loss on the canonical host recipe
 *     (hub present), i.e. the same class as the landed hub-less refusal
 *     (`RESTORE-INTEGRITY` (b)) but with a valid hub.
 *
 * ✎ MEASURED — WHERE THE ROW'S STATED THROW SITE DIFFERS (recorded, never
 * quietly worked around): the row predicts the post-seed
 * `state === 'prototype'` tripwire in `reRegisterDefPrototypes`
 * (`serialize.ts:546-580`) firing because "`serializeSlice`'s C2 strip only
 * drops seam child anchors from prototype-state entries". On THIS tree the C2
 * strip is keyed on **registry-census membership**, not on derived `state`
 * (`serialize.ts:240-247`: `prototypeInstances.has(kid)`), so a seam-wired
 * def-root's `child`+`seam` anchor IS stripped and the tripwire passes —
 * measured directly: the snapshot's def-root entry ships
 * `child/parent/parent(seam)` (no seam child anchor), and a restore of the
 * seam page whose prototypes stay registry-only SUCCEEDS (`allNodes()`
 * 3 → 3, `status: 'applied'`). The defect is nonetheless LIVE and this file
 * reproduces the row's measured SIGNATURE exactly — the seam's state flip is
 * still the trigger, it lands one reader later: the host's derived-state
 * registration filter (step 3) instead of the strip. The throwing call is
 * `reconcileParentTargets` (`LinkConfigError: unique-order`), i.e. the
 * duplicate seed, not the census tripwire. Both halves the row asks for are
 * unchanged by this distinction: (a) the seam-wired def-root must round-trip,
 * (b) a restore that cannot complete must never leave an empty graph silently.
 *
 * ⚠ THE FIXTURE TRAP THIS FILE DEFENDS AGAINST (it invalidated a first probe,
 * and `tests/e2e/restore-links.test.ts` header trap 1 records the same
 * mistake): a condense is **deferred AND size-guarded** — `condense()` SKIPS
 * the rewrite with `condense-skipped-size` when the estimated base is not
 * smaller than the pre-base journal, and with no base marker `replay()` never
 * calls `_restoreBase` at all, so a "restore" case passes VACUOUSLY ON
 * NOTHING. Every case here therefore (a) uses `maxJournalLength: 5`, (b)
 * drives `WRITE_COUNT = 35` ordinary `state-slice` writes so the pre-base
 * window outweighs the base, (c) waits `await sup.flush()` + two `setTimeout(0)`
 * turns for the deferred condense, and (d) **asserts
 * `journalEntries().basePresent === true` BEFORE `replay()`** on a `FIXTURE:`
 * message — a skipped condense fails loudly instead of passing on nothing.
 * The seam-wiring precondition (the def-root's derived state flipped to
 * `'in-tree'` by the consumer's compile) is asserted the same way: a fixture
 * that fails to wire is a loud `FIXTURE:` failure, never a silent green.
 *
 * WHAT THIS FILE ASSERTS (✎ LANDED 2026-11-23 — every case is GREEN; the
 * "RED today"/"measured TODAY" markers below are the RED-FIRST INTENT this file
 * was authored with and are kept as the historical requirement record. The fix
 * is `RESTORE-REFUSES-NOT-EMPTIES`, gate record
 * `docs/specs/undo-redo-report.md` U19 + `docs/defects.md`
 * `RESTORE-SEAM-STRIP-MISS-TOTAL-LOSS` (b)):
 *  - **RR-1** (was RED at authoring; ✎ RE-BASED — see the next block) a restore
 *    that cannot complete keeps the graph it had: (i) `allNodes()` is NOT empty
 *    and its sorted id set equals the pre-replay one, and an authored node is
 *    still usable (`compilePath()` does not throw); (ii) EXACTLY ONE
 *    `console.warn` names a restore failure (`/restore/i` AND
 *    `/fail|refus|error|cannot|unable|abort/i`); (iii) `replay().status` is NOT
 *    `'applied'` — it is `'no-op'`. Measured at AUTHORING time: (i) 0 nodes,
 *    (ii) 0 warns, (iii) `'applied'`; measured after the re-base: (i) 5 nodes
 *    with the identical id set, (ii) 1 warn
 *    (`restore-refused-invalid-snapshot: the condensed base could not be
 *    parsed …`), (iii) `'no-op'`.
 *  - **RR-2** (CONTROL, GREEN today) the SAME page WITHOUT the seam consumer:
 *    the condense + restore succeed (`status: 'applied'`), the graph is
 *    non-empty, and ZERO warns — proving RR-1's red is caused by the
 *    seam-wired def and not by broken condense plumbing.
 *
 * ─── ✎ RE-BASED (the `CONDENSE-CENSUS-NO-DEDUPE` landing) ───────────────────
 * RR-1's ORIGINAL trigger was the duplicated condense census this page
 * produces: the seam-wired def-root is in `allNodes()` AND in the
 * def-prototype registry, `condense()`'s plain concat shipped it twice, and the
 * restore was REFUSED (`restore-refused-invalid-snapshot: … ships one node
 * twice …`). That producer defect is its own OPEN row (`docs/defects.md`
 * `CONDENSE-CENSUS-NO-DEDUPE`) and its fix — one membership condition on the
 * registry loop — makes THIS page restore SUCCESSFULLY, i.e. it DELETES RR-1's
 * trigger. RR-1's honest contract ("a restore that cannot complete must keep
 * the graph it had and say so") is not about the census, so it is re-based onto
 * a refusal that SURVIVES the dedupe: a **crafted malformed base** injected
 * through the public `sup.journal` field (the `MAL-6` idiom of
 * `tests/unit/undo-redo-report-adversarial.test.ts`: `sup.journal.length = 0;
 * sup.journal.push({ id, op: { kind: 'base', snapshot: { template: null,
 * content: [] } }, result: { status: 'base' } })`), which `loadState` cannot
 * parse (`envelope-mismatch`) — so `_restoreBase` refuses at step 0b, BEFORE any
 * eviction, exactly the contract RR-1 pins.
 *
 * WHAT CHANGED IN THIS RE-BASE: **nothing in RR-1's three assertions** — (i),
 * (ii) and (iii) are byte-identical, and so is every FIXTURE precondition
 * (the page, the seam-wiring asserts, the condense recipe and the
 * `basePresent` gate) — and no message was reworded either. The ONLY addition is
 * the marker replacement itself. The seam page is KEPT as the fixture
 * (rather than swapping in a plain page) precisely so no assertion had to move.
 * The census duplication is now pinned — RED-first — by
 * `tests/e2e/condense-census-dedupe.test.ts` CCD-1/CCD-2, which is the file to
 * read for the producer defect itself. **RR-2 is untouched** (its page, recipe
 * and assertions are unchanged); it remains the control that a successful
 * restore is silent.
 *
 * NAMESPACE/SCOPE DISCIPLINE: every case builds its OWN `createLinkHub()` and
 * its own translated tree, so no case shares a per-name `Link`, a registry
 * entry, or node ids with another (node ids come from a module counter).
 * Helpers are duplicated DELIBERATELY (both model files keep theirs private):
 * `tests/e2e/restore-integrity.test.ts` (condense recipe, `buildPage`,
 * `authoredIn`/`requireAuthored`, `writePastTheCondenseThreshold`) and
 * `tests/e2e/restore-links.test.ts` (the def/registry page + the traps).
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

const CLIENT_CONFIG = { runInstantiation: true, runRendering: true }

/** The condense trigger (the row's probe used `5`). Low enough that 35 plain
 *  writes blow past it, high enough that the writes are the thing that fills
 *  the pre-base window (the deferred, SIZE-GUARDED condense — header trap). */
const MAX_JOURNAL_LENGTH = 5

/** Ordinary post-bootstrap writes the host would make. 35 is the row's probe
 *  count: enough bytes that the condensed base is a memory WIN, so the size
 *  guard rewrites instead of warning `condense-skipped-size`. */
const WRITE_COUNT = 35

// ============================================================================
// The page (`root > #defHost (hosts the `nav` def) [+ #seamConsumer]`)
// ============================================================================

/**
 * `div#app > div#defHost` (which hosts the inline, css-carrying def `nav` —
 * `mintDefPrototypes` mints its DEF-ROOT + one DEF-CHILD prototype) and, when
 * `seam` is true, `div#seamConsumer` whose `component` list SEAM-TARGETS that
 * def's children (`{ target: 'children', reference: 'nav' }`).
 *
 * `seam: true` is the defect page (RR-1); `seam: false` is the control (RR-2) —
 * the SAME page minus the consumer, so the only difference between the two
 * cases is the seam.
 */
function refusalPage(opts: { seam: boolean }): LegacyInitialData {
  const children: Record<string, unknown>[] = [
    {
      type: 'div',
      css: { id: 'defHost' },
      props: { id: 'defHost' },
      component: [
        {
          reference: 'nav',
          value: {
            type: 'nav',
            css: { style: 'color: red;' },
            children: [{ type: 'span', content: 'logo' }],
          },
        },
      ],
    },
  ]
  if (opts.seam) {
    children.push({
      type: 'div',
      css: { id: 'seamConsumer' },
      props: { id: 'seamConsumer' },
      component: [{ target: 'children', reference: 'nav' }],
    })
  }
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'app' },
        props: { id: 'app' },
        children,
      },
    },
    content: [],
    clientConfig: CLIENT_CONFIG,
  } as unknown as LegacyInitialData
}

interface Page {
  sup: Supervisor
  tree: TranslatedTree
  /** the def prototypes translate minted (derived `state === 'prototype'` at
   *  translate time) — asserted per case so a translate-shape change fails as
   *  a `FIXTURE:`, not as a defect red. */
  protosAtTranslate: Node[]
  /** the translated nodes the registration filter SKIPPED (registry-only by
   *  design, `serialize.md:99-100`) — asserted per case. */
  skipped: Node[]
  /** the translated nodes actually registered with the supervisor. */
  registered: Node[]
}

/**
 * The documented host shape the restore path needs: ONE hub shared by the
 * `translateLegacy` call, the `Supervisor` and the re-seed (`createLinkHub` is
 * the public same-name shared-Link factory; idiom
 * `tests/unit/journal-condensing.test.ts` `makeSupervisor`).
 *
 * ORDER MATTERS AND IS THE DEFECT'S REPRODUCTION: the host runs its
 * BOOTSTRAP COMPILE (`#seamConsumer.compilePath()` — a read-only path compile,
 * legal before registration) and only THEN registers the translated nodes
 * through the derived-state filter `state !== 'prototype'`. That is the order
 * in which the seam's state flip is visible to the filter, which is exactly
 * the chain this defect is about (header step 2 → step 3). Registration skips
 * `state === 'prototype'` nodes — they are registry-only by design — and every
 * case asserts what was skipped.
 */
function buildPage(opts: { seam: boolean }): Page {
  const hub = createLinkHub()
  const tree = translateLegacy(refusalPage(opts), { hub })
  const sup = new Supervisor({ hub, maxJournalLength: MAX_JOURNAL_LENGTH })
  const protosAtTranslate = tree.nodes.filter((n) => n.state === 'prototype')
  if (opts.seam) {
    const consumer = tree.nodes.find((n) => n.css?.id === 'seamConsumer')
    if (!consumer) throw new Error('FIXTURE: the seam page holds no #seamConsumer node')
    consumer.compilePath()
  }
  const skipped: Node[] = []
  const registered: Node[] = []
  for (const n of tree.nodes) {
    if (n.state === 'prototype') {
      skipped.push(n)
      continue
    }
    sup.registerNode(n)
    registered.push(n)
  }
  return { sup, tree, protosAtTranslate, skipped, registered }
}

// ============================================================================
// Reading the live graph (public surfaces only)
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
  if (!n) throw new Error(`FIXTURE: the live graph holds no authored #${cssId} node`)
  return n
}

/** The graph's id set, SORTED (a series is only comparable that way). */
const ids = (nodes: Node[]): string[] => nodes.map((n) => n.id).sort()

/** The captured `console.warn` calls, each flattened to one string (idiom:
 *  `tests/e2e/restore-integrity.test.ts` RI-3). */
function warnLines(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map((call) => String(call.map(String).join(' ')))
}

// ============================================================================
// The condense recipe (deferred + size-guarded — header trap)
// ============================================================================

/** Two macrotask turns: enough for the supervisor's DEFERRED condense
 *  (`scheduleCondense`, a `setTimeout(0)`). Idiom:
 *  `tests/e2e/post-bootstrap-emit.test.ts` `flushCondense`. */
async function flushCondense(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Drive the journal past `maxJournalLength` with the host's own ordinary
 *  writes, then let the deferred condense run. Returns the journal view so the
 *  CALLER asserts `basePresent` (each case's own precondition — never hidden in
 *  this helper). */
async function writePastTheCondenseThreshold(
  sup: Supervisor,
): Promise<ReturnType<Supervisor['journalEntries']>> {
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

/** The "is an authored node still usable" probe: the node's own path compile,
 *  contained so the case can REPORT the outcome instead of aborting on it. */
function usableReport(node: Node | undefined): string {
  if (!node) return 'the graph holds no authored #app node'
  try {
    node.compilePath()
    return 'compilePath() ok'
  } catch (e) {
    return `compilePath() threw: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`
  }
}

// ============================================================================
// RR-1 — the measured defect: a restore that cannot complete is SILENT loss
// ============================================================================

describe('RESTORE-SEAM-STRIP-MISS-TOTAL-LOSS — a restore that cannot complete must keep the graph and say so', () => {
  it('RR-1 a failing restore keeps the pre-replay graph, warns exactly once, and does not report plain success', async () => {
    const page = buildPage({ seam: true })
    const sup = page.sup

    // ---- FIXTURE, part 1: the seam actually WIRED the def prototypes. ------
    // Without this the case would test the control page and pass vacuously, so
    // the state flip (`'prototype'` → `'in-tree'`) is asserted loudly.
    const protoStates = page.protosAtTranslate.map((n) => n.state)
    expect(
      page.protosAtTranslate.length,
      'FIXTURE: the `nav` def must mint its def-root + one def-child prototype (translate.ts mintDefPrototypes) — without prototypes this case tests nothing',
    ).toBe(2)
    expect(
      protoStates,
      `FIXTURE: compiling the children-target seam consumer must wire the def-root under it, flipping the derived state of EVERY def prototype from 'prototype' to 'in-tree' (measured ${JSON.stringify(protoStates)}); if they are still 'prototype' the seam did not wire and RR-1 would silently degrade into RR-2`,
    ).toEqual(protoStates.map(() => 'in-tree'))
    expect(
      page.skipped.map((n) => `${n.id}:${n.state}`),
      `FIXTURE: the host's registration filter skips only derived-'prototype' nodes, and the seam flip means NOTHING is skipped on the defect page (measured skipped ${JSON.stringify(page.skipped.map((n) => n.id))}) — the seam-wired def-root therefore reaches allNodes() while staying in the def-prototype registry, which is the duplication this case is about`,
    ).toEqual([])
    expect(
      page.registered.length,
      'FIXTURE: every translated node is registered on the defect page',
    ).toBe(page.tree.nodes.length)

    // ---- FIXTURE, part 2: a REAL condensed base exists before replay(). ----
    expect(
      sup.allNodes().length,
      'FIXTURE: the page must be non-empty before the condense',
    ).toBeGreaterThan(0)
    const view = await writePastTheCondenseThreshold(sup)
    expect(
      view.basePresent,
      "FIXTURE (RR-1): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')",
    ).toBe(true)

    // ---- THE TRIGGER (✎ RE-BASED — see the header): a crafted malformed base.
    // A restore that CANNOT complete is refused in `_restoreBase`'s pre-flight
    // (step 0b) before any eviction. The recipe above proved the condense itself
    // works and produced a REAL base; this replaces that marker with a snapshot
    // `loadState` cannot parse (`envelope-mismatch`), the `MAL-6` idiom
    // (`tests/unit/undo-redo-report-adversarial.test.ts`): a corrupted journal is
    // a documented host hazard, and the refusal it triggers SURVIVES the
    // `CONDENSE-CENSUS-NO-DEDUPE` fix — which removes only the duplicated-node
    // refusal this case used to ride on (header block). Measured: exactly ONE
    // warn (`restore-refused-invalid-snapshot: the condensed base could not be
    // parsed (envelope-mismatch) …`), `status: 'no-op'`, graph 5 -> 5 nodes with
    // the identical id set — the three assertions below are unchanged.
    sup.journal.length = 0
    sup.journal.push({
      id: 'journal-base',
      op: { kind: 'base', snapshot: { template: null, content: [] } },
      result: { status: 'base' },
    })

    const preNodes = sup.allNodes()
    const preCount = preNodes.length
    const preIds = ids(preNodes)

    // The warn spy covers ONLY the restore window: the condense (which warns
    // `condense-skipped-size` when it skips) already ran and `basePresent` is
    // true, so every captured warn here belongs to the restore itself.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    await sup.flush()
    const warns = warnLines(warn)
    const postNodes = sup.allNodes()
    const postCount = postNodes.length
    const postIds = ids(postNodes)

    // ---- (i) the graph the restore could not rebuild is KEPT -------------
    expect.soft(
      postCount,
      `RR-1 (i): a restore that cannot complete EVICTED the whole graph (allNodes ${preCount} -> ${postCount}); _restoreBase evicts every pre-base node BEFORE it knows the snapshot will re-seed, so a restore that cannot complete is total data loss. Measured today: allNodes() === 0. The restore must either complete or keep the graph it had`,
    ).toBeGreaterThan(0)
    expect.soft(
      postIds,
      `RR-1 (i): the pre-replay graph must survive a restore that cannot complete — sorted ids ${JSON.stringify(preIds)} (measured ${preCount} nodes) became ${JSON.stringify(postIds)} (measured ${postCount} nodes); a refused/failed restore must not swap the graph for a different or empty one`,
    ).toEqual(preIds)
    expect.soft(
      usableReport(authoredIn(postNodes, 'app')),
      `RR-1 (i): an authored node must still be usable after a restore that cannot complete (measured allNodes() === ${postCount}); measured ${usableReport(authoredIn(postNodes, 'app'))}`,
    ).toBe('compilePath() ok')

    // ---- (ii) exactly ONE diagnostic naming the failed restore -----------
    const restoreWarns = warns.filter((w) => /restore/i.test(w) && /fail|refus|error|cannot|unable|abort/i.test(w))
    expect.soft(
      warns.length,
      `RR-1 (ii): a restore that cannot complete must say so EXACTLY ONCE (one console.warn naming the failure); measured ${warns.length} warn(s): ${JSON.stringify(warns)}. ZERO warns is today's defect — replay()'s base branch is a bare try/catch {} that swallows the throw AFTER the eviction (UNDO-REDO-ADV-MAL-6 containment turned a loud failure into silent total loss)`,
    ).toBe(1)
    expect.soft(
      restoreWarns.length,
      `RR-1 (ii): the single warn must NAME a restore failure — text matching /restore/i AND a failure word (/fail|refus|error|cannot|unable|abort/i); measured warn(s): ${JSON.stringify(warns)}`,
    ).toBe(1)

    // ---- (iii) a refused restore must not report plain success -----------
    // The intended vocabulary word for a restore that did nothing is 'no-op'
    // (docs/next-steps.md: "if UndoRedoReport's vocabulary admits nothing
    // honest, keep 'applied', rely on the warn, and say so in the row"). This
    // case pins only "NOT plain success" so the fix is free to choose the word.
    expect.soft(
      replay.status,
      `RR-1 (iii): replay().status must NOT be 'applied' when the restore could not complete — a swallowed failure reporting plain success is what makes this defect silent (measured '${replay.status}'; the intended word is 'no-op')`,
    ).not.toBe('applied')
  })

  // ==========================================================================
  // RR-2 — the CONTROL: the same page WITHOUT the seam consumer
  // ==========================================================================

  it('RR-2 (CONTROL, GREEN today) the same page without the seam consumer restores cleanly and silently', async () => {
    const page = buildPage({ seam: false })
    const sup = page.sup

    // FIXTURE: with no seam consumer the def prototypes stay registry-only —
    // the shape the pin describes, and the ONLY difference from RR-1.
    expect(
      page.protosAtTranslate.map((n) => n.state),
      "FIXTURE (RR-2): without a seam consumer the def prototypes must stay derived-'prototype' (nothing wires them into the tree)",
    ).toEqual(page.protosAtTranslate.map(() => 'prototype'))
    expect(
      page.skipped.length,
      `FIXTURE (RR-2): the registration filter must skip the registry-only def prototypes (measured skipped ${JSON.stringify(page.skipped.map((n) => n.id))})`,
    ).toBe(2)
    expect(
      sup.allNodes().length,
      'FIXTURE (RR-2): the page must be non-empty before the condense',
    ).toBeGreaterThan(0)

    const view = await writePastTheCondenseThreshold(sup)
    expect(
      view.basePresent,
      "FIXTURE (RR-2): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')",
    ).toBe(true)

    const preCount = sup.allNodes().length
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    await sup.flush()
    await flushCondense()
    const warns = warnLines(warn)

    // GREEN TODAY (measured): the restore re-seeds, reports 'applied' and is
    // completely silent. This is the plumbing RR-1's red must NOT be able to
    // blame, and a fix for the swallow half must keep it green.
    expect(
      replay.status,
      `RR-2 (CONTROL): the same page WITHOUT the seam consumer must restore normally — measured '${replay.status}'`,
    ).toBe('applied')
    expect(
      sup.allNodes().length,
      `RR-2 (CONTROL): the restore must re-seed the graph (measured ${preCount} -> ${sup.allNodes().length})`,
    ).toBeGreaterThan(0)
    expect(
      warns,
      `RR-2 (CONTROL): a SUCCESSFUL restore must not warn (measured ${JSON.stringify(warns)}); a fix for RR-1 that warns on every restore breaks this control`,
    ).toEqual([])
    expect(
      usableReport(requireAuthored(sup.allNodes(), 'app')),
      'RR-2 (CONTROL): the restored graph must still hold a usable authored #app node',
    ).toBe('compilePath() ok')
  })
})
