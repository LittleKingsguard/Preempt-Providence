/**
 * `CONDENSE-CENSUS-NO-DEDUPE` (`docs/defects.md`, OPEN) — **RED FIRST**
 * (AGENTS.md item 8): this file encodes the defect against a tree where it is
 * **LIVE**, with **no `src/**` change** accompanying it.
 *
 * ─── THE DEFECT (measured on THIS tree while authoring this file) ───────────
 * `Supervisor.condense()` builds the snapshot census as a PLAIN CONCAT of
 * `this.allNodes()` and the scope's def-prototype registry (`supervisor.ts`
 * `condense()` — `const kids = this.allNodes()` followed by a
 * `for (const p of protoSet) … kids.push(p)` loop with **no membership test**),
 * so a node that is in BOTH lists ships TWICE in `doc.content` with the SAME id.
 *
 * The overlap is reachable on a **documented-legal host** (the RR-1 fixture of
 * `tests/e2e/restore-refusal.test.ts`):
 *
 *  1. `#defHost` carries the INLINE def `nav`
 *     (`component: [{ reference: 'nav', value: {...} }]`), which mints the
 *     def-root + one def-child PROTOTYPE (`translate.ts` `mintDefPrototypes`).
 *  2. A second node, `#seamConsumer`, **seam-targets that def's children**
 *     (`component: [{ target: 'children', reference: 'nav' }]`). Compiling the
 *     consumer wires the def-ROOT as a seam CHILD of the consumer, flipping the
 *     def-root's DERIVED `state` from `'prototype'` to `'in-tree'`.
 *  3. The documented host registers its bootstrap nodes through the pinned
 *     filter `state !== 'prototype'` (`serialize.md:99-100`), so the
 *     seam-wired def-root IS registered and reaches `allNodes()` — while it
 *     REMAINS in the def-prototype registry.
 *  4. `condense()` therefore pushes ONE node object twice and `serializeSlice`
 *     ships the same node ID twice.
 *
 * **MEASURED DUPLICATE IDS (this tree, the CCD-1 page):**
 * `content` ids read
 * `["node-1", "node-2", "node-3", "node-4", "node-5", "node-4", "node-3"]` —
 * `node-3` is the def-ROOT (registry root, in `allNodes()` after the seam flip)
 * and `node-4` is its def-CHILD; each appears **twice**. `node-1` is the
 * authored ROOT (the template) and appears ONCE in `content`.
 *
 * **THE MEASURED CONSEQUENCE (why this is a defect, not cosmetics):** the
 * restore pre-flight refuses the snapshot — `replay()` reports `'no-op'` and
 * emits exactly one `restore-refused-invalid-snapshot: … ships one node twice
 * (id "node-3" appears 2× …) …` warn — so the page **cannot be restored at
 * all**. (Since `RESTORE-REFUSES-NOT-EMPTIES` the refusal is LOUD and the graph
 * is KEPT: measured `allNodes()` 5 → 5 with the identical id set. The older,
 * worse shape was an eviction to an empty graph reported as `'applied'`.)
 *
 * **THE FIX IS NOT IN THIS FILE.** The fix is one membership condition on the
 * registry loop so the base ships every id ONCE; CCD-1/CCD-2 are RED today and
 * go GREEN after it. CCD-3/CCD-4 are GREEN today and must STAY green — they
 * are the controls that stop the dedupe being "achieved" by breaking the
 * healthy page (CCD-3) or by collapsing legitimately repeated STRUCTURES
 * (CCD-4: two containers offering the same placement name).
 *
 * ─── ⚠ THE INTENDED ROOT DOUBLE-SHIP — NOT A TARGET ────────────────────────
 * On EVERY healthy condense the authored ROOT ships TWICE: once as
 * `doc.template` and once as the `allNodes()` entry inside `content` (the
 * census IS `allNodes()`, which contains the root — measured on the control
 * page: `template.id === "node-41"` and content ids
 * `["node-41", "node-42", "node-44", "node-43"]`). That is **intended and
 * stays**: the restore's pre-flight encodes a ONE-occurrence exemption for the
 * template id (`_baseSnapshotRefusal`, "ONE EXEMPTION, measured on the live
 * recipe"). This file therefore never pins a root-less `content`; it pins the
 * **duplicate-carrier** case — a NON-template id appearing more than once —
 * and only asserts the template id appears **at most once** inside `content`.
 *
 * ─── ⚠ THE MARKER-REPLACEMENT TRAP (a comparison against a replaced marker
 *       measures NOTHING) ───────────────────────────────────────────────────
 * A condense is **deferred AND size-guarded**, and a LATER condense **REPLACES**
 * the base marker with a fresh, larger snapshot spliced in place of the old one
 * (`tests/unit/condense-base-invariance.test.ts` CBI-5 is the explicit negative
 * control for that artefact). Every case here therefore (a) uses
 * `maxJournalLength: 5` and drives `WRITE_COUNT = 35` ordinary `state-slice`
 * writes so the pre-base window outweighs the base, (b) asserts
 * `journalEntries().basePresent === true` BEFORE reading anything out of the
 * base, (c) captures the marker **entry id** and re-asserts it
 * (`assertSameMarker`) AFTER the census read — a replacement fails with a
 * `FIXTURE:` message instead of a finding — and (d) drives the read window
 * WITHOUT awaits so no replacement can be scheduled inside it.
 *
 * ─── ⚠ THE ONE WARN THAT IS NOT OURS (`unresolved-reference`) ──────────────
 * The seam consumer's own path compile emits `unresolved-reference at
 * root/<id>` (measured at bootstrap AND once per pass-2 refresh — the seam
 * names a DEF, which is not a provider in the compile slice). That diagnostic
 * belongs to the FIXTURE, not to the census, so CCD-2's "no restore diagnostic"
 * assertion is expressed as **no warn matching `/restore/i`** PLUS **no warn
 * outside that one fixture diagnostic** — which is what "the restore is silent"
 * honestly means on this page. A strict zero-warn pin would be RED for the
 * WRONG REASON once the census is deduped: measured on a simulated dedupe (the
 * census with its duplicate ids removed and the restore re-run), the window is
 * exactly `["unresolved-reference at root/<id>"]` — the fixture diagnostic and
 * nothing else.
 *
 * ─── WHAT EACH CASE ASSERTS ────────────────────────────────────────────────
 *  - **CCD-1** (RED today — the census). The seam-wired def page: `content`
 *    ships every NON-template id exactly once (today `node-3` and `node-4`
 *    appear twice), the def-prototype REGISTRY nodes still ship exactly once
 *    each (a dedupe that DROPPED them would break the documented round-trip),
 *    and the template id appears at most once inside `content`.
 *  - **CCD-2** (RED today — the capability). The same page: `replay()` must now
 *    SUCCEED — `status === 'applied'`, no `/restore/i` warn and nothing in the
 *    window but the fixture's own `unresolved-reference`, the graph non-empty
 *    with the same authored ids, an authored node still `compilePath()`-able,
 *    the def prototypes still registered/resolvable, and the compiled consumer
 *    still wired to the def-root. Today: `'no-op'` + one
 *    `restore-refused-invalid-snapshot` warn.
 *  - **CCD-3** (CONTROL, GREEN today — do not weaken). The SAME page WITHOUT
 *    the seam consumer: `content` ids are already unique, the registry-only
 *    prototypes still ship exactly once each, and the restore is silent and
 *    `'applied'`. Keeps CCD-1/2 honest: the dedupe must not be achievable by
 *    breaking the healthy page.
 *  - **CCD-4** (GREEN today — the over-correction guard). A page with PLACEMENT
 *    MULTIPLICITY (two containers offering the same placement name, `zoneA` /
 *    `zoneB`, plus a consumer) still condenses with unique `content` ids AND
 *    restores with its multiplicity INTACT (two distinct `pathKey`s on the
 *    consumer, two `container` anchors on the shared per-name Link) — the
 *    dedupe is by NODE IDENTITY / id, not by collapsing legitimately repeated
 *    structures.
 *
 * NAMESPACE/SCOPE DISCIPLINE: every case builds its OWN `createLinkHub()` and
 * its own translated tree, so no case shares a per-name `Link`, a registry
 * entry, or node ids with another (node ids come from a module counter). The
 * condense recipe, the `authoredIn`/`requireAuthored` idiom and the
 * measured-message + `console.warn` spy discipline are duplicated from
 * `tests/e2e/restore-refusal.test.ts` / `tests/e2e/restore-integrity.test.ts`;
 * the marker-capture discipline from
 * `tests/e2e/base-mutation-detection.test.ts`.
 *
 * IMPORT NOTE: the def-prototype REGISTRY enumerators are not on the package
 * barrel, so this file imports the deep core path (`src/core/registry.js`) —
 * the established idiom (`tests/e2e/restore-integrity.test.ts` imports
 * `isContentNode` the same way).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import {
  translateLegacy,
  createLinkHub,
  type LegacyInitialData,
  type TranslatedTree,
} from '../../src/core/translate.js'
// deep core path — the def-prototype registry is not on the package barrel
import { defPrototypeEntries, defRootPrototypeEntries } from '../../src/core/registry.js'

afterEach(() => {
  vi.restoreAllMocks()
})

const CLIENT_CONFIG = { runInstantiation: true, runRendering: true }

/** The condense trigger (`5`, the recipe every restore e2e file uses). Low
 *  enough that 35 plain writes blow past it, high enough that the writes are
 *  what fills the pre-base window. */
const MAX_JOURNAL_LENGTH = 5

/** Ordinary post-bootstrap writes. 35 is the corpus count: enough that the
 *  condensed base is a memory WIN, so the size guard rewrites instead of
 *  warning `condense-skipped-size` (a skipped condense = no base = every case
 *  here tests NOTHING). */
const WRITE_COUNT = 35

/** The one diagnostic the FIXTURE itself produces (see the header): the seam
 *  consumer's own path compile reports an unresolved DEF name. Pinned as a
 *  PREFIX so CCD-2's window assertion can name it instead of tolerating "any
 *  warn". */
const UNRESOLVED_FIXTURE_PREFIX = 'unresolved-reference at '

// ============================================================================
// The pages
// ============================================================================

/**
 * `div#app > div#defHost` (which hosts the inline, css-carrying def `nav` —
 * `mintDefPrototypes` mints its DEF-ROOT + one DEF-CHILD prototype) and, when
 * `seam` is true, `div#seamConsumer` whose `component` list SEAM-TARGETS that
 * def's children (`{ target: 'children', reference: 'nav' }`).
 *
 * `seam: true` is the defect page (CCD-1/CCD-2); `seam: false` is CCD-3's
 * control — the SAME page minus the consumer, so the only difference between
 * them is the seam.
 */
function censusPage(opts: { seam: boolean }): LegacyInitialData {
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

/**
 * CCD-4's page — the placement-multiplicity shape of
 * `tests/e2e/restore-integrity.test.ts`: `div#app` holding TWO placement
 * PRODUCERS (`#zoneA`, `#zoneB`, both offering `zone`) and ONE placement
 * consumer as `template.children[]` (`#card`, `targetPlacement: ['zone']`), i.e.
 * one intended path state per offering container. Nothing here is a
 * duplicate-CARRIER: the two containers are two DISTINCT nodes (distinct ids),
 * which is exactly what the dedupe must not collapse.
 */
function placementPage(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'app' },
        props: { id: 'app' },
        children: [
          { type: 'aside', css: { id: 'zoneA' }, props: { id: 'zoneA' }, placement: { placementName: 'zone' } },
          { type: 'aside', css: { id: 'zoneB' }, props: { id: 'zoneB' }, placement: { placementName: 'zone' } },
        ],
      },
      children: [
        { type: 'div', css: { id: 'card' }, props: { id: 'card' }, placement: { targetPlacement: ['zone'] } },
      ],
    },
    content: [],
    clientConfig: CLIENT_CONFIG,
  } as unknown as LegacyInitialData
}

/** The hub type every case shares between `translateLegacy` and the
 *  `Supervisor` (the documented host shape the restore path needs). */
type Hub = ReturnType<typeof createLinkHub>

interface Page {
  sup: Supervisor
  hub: Hub
  tree: TranslatedTree
  /** the def prototypes translate minted (`state === 'prototype'` at translate
   *  time) — asserted per case so a translate-shape change fails as a
   *  `FIXTURE:`, not as a defect red. */
  protosAtTranslate: Node[]
  /** the translated nodes the registration filter SKIPPED (registry-only by
   *  design). */
  skipped: Node[]
  /** the translated nodes actually registered with the supervisor. */
  registered: Node[]
}

/**
 * The documented host shape: ONE hub shared by `translateLegacy` and the
 * `Supervisor` (`createLinkHub` is the public same-name shared-Link factory;
 * idiom `tests/unit/journal-condensing.test.ts` `makeSupervisor`).
 *
 * ORDER MATTERS AND IS THE DEFECT'S REPRODUCTION on the seam page: the host
 * runs its BOOTSTRAP COMPILE (`#seamConsumer.compilePath()` — a read-only path
 * compile, legal before registration) and only THEN registers the translated
 * nodes through the derived-state filter `state !== 'prototype'`. That is the
 * order in which the seam's state flip is visible to the filter.
 */
function buildPage(envelope: LegacyInitialData, opts: { seam: boolean; where: string }): Page {
  const hub = createLinkHub()
  const tree = translateLegacy(envelope, { hub })
  const sup = new Supervisor({ hub, maxJournalLength: MAX_JOURNAL_LENGTH })
  const protosAtTranslate = tree.nodes.filter((n) => n.state === 'prototype')
  if (opts.seam) {
    const consumer = tree.nodes.find((n) => n.css?.id === 'seamConsumer')
    if (!consumer) throw new Error(`FIXTURE (${opts.where}): the seam page holds no #seamConsumer node`)
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
  return { sup, hub, tree, protosAtTranslate, skipped, registered }
}

// ============================================================================
// Reading the graph and the def registry (public surfaces only)
// ============================================================================

/** A live node by its AUTHORED id — the restore REPLACES node objects, so a
 *  translate-time reference is stale after `replay()`. */
function authoredIn(nodes: Node[], cssId: string): Node | undefined {
  return nodes.find((n) => n.css?.id === cssId || n.props?.id === cssId)
}

/** `authoredIn` with a loud FIXTURE failure — a setup break must never read as
 *  a defect red. */
function requireAuthored(nodes: Node[], cssId: string, where: string): Node {
  const n = authoredIn(nodes, cssId)
  if (!n) throw new Error(`FIXTURE (${where}): the live graph holds no authored #${cssId} node`)
  return n
}

/** The graph's AUTHORED id set, SORTED — ONLY `css.id`, i.e. the ids these
 *  envelopes actually author. A `props.id` fallback is deliberately NOT used:
 *  `translateLegacy` SYNTHESIZES `props.id` for an id-less node (measured: the
 *  minted def prototypes carry `props.id === 'preempt-node-<minted id>'`), so a
 *  fallback would smuggle a MINTED id into the "authored" set — and that is
 *  precisely the axis that changes across a restore (a def prototype
 *  legitimately comes back registry-only, out of `allNodes()`). */
function authoredIds(nodes: Node[]): string[] {
  const out: string[] = []
  for (const n of nodes) if (typeof n.css?.id === 'string' && n.css.id.length > 0) out.push(n.css.id)
  return out.sort()
}

const ids = (nodes: Node[]): string[] => nodes.map((n) => n.id).sort()

/** The def-prototype registry entries for THIS graph — the same hub filter the
 *  census itself applies (`supervisor.ts` `condense()`: `p.hubFor === this.hub`),
 *  read through the deep core path. */
function registryChildren(hub: Hub): Node[] {
  const out: Node[] = []
  for (const [, protos] of defPrototypeEntries()) for (const p of protos) if (p.hubFor === hub) out.push(p)
  return out
}

/** The def-ROOT registry entries for THIS graph (hub-filtered, as above). */
function registryRoots(hub: Hub): Node[] {
  const out: Node[] = []
  for (const [, root] of defRootPrototypeEntries()) if (root.hubFor === hub) out.push(root)
  return out
}

/** Every registry node this graph owns, in the CENSUS'S OWN loop order (the
 *  def-children loop first, then the def-roots loop) — so a failure message can
 *  be read against the concat order that produced the duplicate. */
function registryNodes(hub: Hub): Node[] {
  return [...registryChildren(hub), ...registryRoots(hub)]
}

/** The node ids wired as CHILDREN of `node`: walk its `parent`-role anchors and
 *  read the `child` end off each anchor's shared `Link` (`Anchor.owner` is the
 *  holding node). Public surface only. */
function childrenOf(node: Node): string[] {
  const out: string[] = []
  for (const a of node.anchors) {
    if (a.role !== 'parent') continue
    for (const c of a.link.anchorsOf('child')) if (c.owner) out.push(c.owner.id)
  }
  return out.sort()
}

/** The `container`-role anchor count on the shared per-name placement `Link` a
 *  live producer reads — via the public `Anchor.link` backref, never an
 *  internal map. Multiplicity lives here: two producers of `zone` ⇒ 2. */
function containerAnchorCount(nodes: Node[], cssId: string, where: string): number {
  const node = requireAuthored(nodes, cssId, where)
  const anchor = node.anchors.find((a) => a.role === 'container')
  if (!anchor) throw new Error(`FIXTURE (${where}): the live #${cssId} carries no container-role anchor (the 'zone' producer anchor)`)
  return anchor.link.anchorsOf('container').length
}

/** The node's actionable path states' keys, SORTED (so a series is comparable
 *  regardless of mint order). */
function pathKeysOf(node: Node): string[] {
  return node.compilePath().actionable.map((s): string => s.pathKey).sort()
}

/** The captured `console.warn` calls, each flattened to one string (idiom:
 *  `tests/e2e/restore-refusal.test.ts`). Non-string args are stringified, never
 *  dropped. */
function warnLines(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map((call) => String(call.map(String).join(' ')))
}

/** The "is an authored node still usable" probe: the node's own path compile,
 *  contained so the case can REPORT the outcome instead of aborting on it. */
function usableReport(node: Node | undefined): string {
  if (!node) return 'the graph holds no authored node'
  try {
    node.compilePath()
    return 'compilePath() ok'
  } catch (e) {
    return `compilePath() threw: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`
  }
}

// ============================================================================
// The condense recipe (deferred + size-guarded) and the base capture
// ============================================================================

/** Two macrotask turns: enough for the supervisor's DEFERRED condense
 *  (`scheduleCondense`, a `setTimeout(0)`). Idiom:
 *  `tests/e2e/post-bootstrap-emit.test.ts` `flushCondense`. */
async function flushCondense(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/** Drive the journal past `maxJournalLength` with the host's own ordinary
 *  writes (a `state-slice` on the authored root), then let the deferred condense
 *  run. Returns the journal view so the CALLER asserts `basePresent` (each
 *  case's own precondition — never hidden in this helper). */
async function writePastTheCondenseThreshold(
  sup: Supervisor,
  where: string,
): Promise<ReturnType<Supervisor['journalEntries']>> {
  const root = requireAuthored(sup.allNodes(), 'app', `${where} condense recipe`)
  for (let i = 0; i < WRITE_COUNT; i += 1) {
    const res = sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.tick', mode: 'replace', value: `tick-${i}` }],
    })
    expect(
      res.status,
      `FIXTURE (${where}): the condense recipe's own write ${i} must apply — measured '${res.status}'; a rejected write would shrink the pre-base window and the size guard could skip the condense`,
    ).toBe('applied')
  }
  await sup.flush()
  await flushCondense()
  return sup.journalEntries()
}

/** The shapes this file reads off a serialized base. */
interface CensusEntry {
  id?: unknown
}

/** The captured base: the marker's ENTRY ID plus the SNAPSHOT OBJECT held by
 *  reference, so a later marker replacement cannot silently swap the thing being
 *  measured (the header's trap). */
interface CapturedBase {
  id: string
  snapshot: { template: { id?: unknown }; content: CensusEntry[] }
}

/** Capture the base through the PUBLIC `sup.journal` field, asserting the
 *  condense actually happened (`basePresent` BEFORE the read — a skipped
 *  condense makes every case measure NOTHING). */
function capturedBase(sup: Supervisor, where: string): CapturedBase {
  expect(
    sup.journalEntries().basePresent,
    `FIXTURE (${where}): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')`,
  ).toBe(true)
  const entry = sup.journal.find((e) => e.op?.kind === 'base')
  const snapshot = entry === undefined ? undefined : (entry.op as { snapshot?: unknown }).snapshot
  const shaped =
    typeof snapshot === 'object' &&
    snapshot !== null &&
    Array.isArray((snapshot as { content?: unknown }).content) &&
    typeof (snapshot as { template?: unknown }).template === 'object' &&
    (snapshot as { template?: unknown }).template !== null
  if (entry === undefined || !shaped) {
    throw new Error(
      `FIXTURE (${where}): journalEntries() reports basePresent yet the journal holds no shaped { template, content[] } base marker (marker ${entry?.id ?? '<none>'})`,
    )
  }
  return { id: entry.id, snapshot: snapshot as unknown as CapturedBase['snapshot'] }
}

/**
 * Assert the journal still holds THE CAPTURED MARKER. A later condense splices a
 * FRESH snapshot in place of the marker, which invalidates every measurement in
 * the window — so this fails as a `FIXTURE:` break, never as a finding.
 */
function assertSameMarker(sup: Supervisor, capturedId: string, where: string): void {
  const now = sup.journal.find((e) => e.op?.kind === 'base')
  if (now?.id !== capturedId) {
    throw new Error(
      `FIXTURE (${where}): a LATER condense REPLACED the condensed base marker (captured ${capturedId}, the journal now holds ${now?.id ?? 'no base at all'}) — this window measured NOTHING. A later condense splices a FRESH snapshot of the CURRENT graph in place of the marker (pinned as a negative control by condense-base-invariance CBI-5), so every id count below would be about a DIFFERENT marker. Keep the window await-free and the post-condense journal at/under maxJournalLength (${MAX_JOURNAL_LENGTH})`,
    )
  }
}

/** The base's `content` ids, in SHIP ORDER (order matters: it is the concat
 *  order the duplicate comes from). A non-string id is a FIXTURE break — the
 *  whole case is about ids. */
function contentIds(base: CapturedBase, where: string): string[] {
  const raw = base.snapshot.content.map((c) => (typeof c.id === 'string' && c.id.length > 0 ? c.id : undefined))
  const missing = raw.filter((id) => id === undefined).length
  if (missing > 0) {
    throw new Error(
      `FIXTURE (${where}): ${missing} of the condensed base's ${raw.length} content entries carry no string id, so "does this id ship twice?" cannot be measured`,
    )
  }
  return raw as string[]
}

/** The base's `template` id (the authored root, shipped OUTSIDE `content` too). */
function templateIdOf(base: CapturedBase, where: string): string {
  const id = base.snapshot.template.id
  if (typeof id !== 'string' || id.length === 0) {
    throw new Error(`FIXTURE (${where}): the condensed base's template carries no string id (measured ${JSON.stringify(id)})`)
  }
  return id
}

/** How many times each id ships in `content`. */
function censusCounts(contentIds: string[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const id of contentIds) counts.set(id, (counts.get(id) ?? 0) + 1)
  return counts
}

/**
 * THE CENSUS CLAIM (CCD-1/CCD-3/CCD-4): every NON-template id appears in
 * `content` exactly ONCE, and the template id appears **at most once** there.
 *
 * The template exemption is the INTENDED root double-ship, not a target: the
 * root legitimately ships as `doc.template` AND as the `allNodes()` entry inside
 * `content` (the restore's pre-flight exempts exactly one such occurrence). Two
 * `content` occurrences of it would be a duplicate CARRIER and still a defect.
 */
function assertCensusShipsEveryIdOnce(base: CapturedBase, where: string): void {
  const shipped = contentIds(base, where)
  const templateId = templateIdOf(base, where)
  const counts = censusCounts(shipped)
  const offenders = [...counts.entries()]
    .filter(([id, count]) => id !== templateId && count > 1)
    .map(([id, count]) => `${id}×${count}`)
  expect(
    offenders,
    `${where}: the condensed census must ship every NON-template node id EXACTLY ONCE in doc.content — a node that is in BOTH allNodes() and the def-prototype registry is pushed TWICE by condense()'s PLAIN CONCAT (supervisor.ts, no membership test), and a repeated id cannot be re-seeded (replay() refuses the snapshot: 'restore-refused-invalid-snapshot'). Measured content ids (ship order): ${JSON.stringify(shipped)}; offending (id×occurrences): ${JSON.stringify(offenders)}; template id "${templateId}" (exempt from THIS check, see the next assertion)`,
  ).toEqual([])
  expect(
    counts.get(templateId) ?? 0,
    `${where}: the TEMPLATE (authored root) id must appear AT MOST ONCE inside doc.content. The intended double-ship is template + ONE content occurrence (the census IS allNodes(), which contains the root; the restore's pre-flight exempts exactly one) — a SECOND content occurrence is a duplicate carrier, not the intended shape. Measured content ids: ${JSON.stringify(shipped)} (template id "${templateId}")`,
  ).toBeLessThanOrEqual(1)
}

// ============================================================================
// CCD-1 — the census: a node in BOTH lists ships TWICE (RED today)
// ============================================================================

describe('CONDENSE-CENSUS-NO-DEDUPE — condense() must ship every node id ONCE', () => {
  it('CCD-1 the seam-wired def page condenses with every non-template content id exactly once', async () => {
    const page = buildPage(censusPage({ seam: true }), { seam: true, where: 'CCD-1' })
    const sup = page.sup

    // ---- FIXTURE, part 1: the seam actually WIRED the def prototypes. ------
    // Without this the case would measure the CCD-3 control page and pass
    // vacuously, so the state flip (`'prototype'` → `'in-tree'`) is asserted
    // loudly.
    const protoStates = page.protosAtTranslate.map((n) => n.state)
    expect(
      page.protosAtTranslate.length,
      'FIXTURE (CCD-1): the `nav` def must mint its def-root + one def-child prototype (translate.ts mintDefPrototypes) — without prototypes there is nothing for the census to duplicate',
    ).toBe(2)
    expect(
      protoStates,
      `FIXTURE (CCD-1): compiling the children-target seam consumer must wire the def-root under it, flipping the derived state of EVERY def prototype from 'prototype' to 'in-tree' (measured ${JSON.stringify(protoStates)}); if they are still 'prototype' the seam did not wire and this case would silently degrade into CCD-3`,
    ).toEqual(protoStates.map(() => 'in-tree'))
    expect(
      page.skipped.map((n) => n.id),
      `FIXTURE (CCD-1): the host's registration filter skips only derived-'prototype' nodes, and the seam flip means NOTHING is skipped on the defect page (measured skipped ${JSON.stringify(page.skipped.map((n) => n.id))}) — the seam-wired def-root therefore reaches allNodes() while STAYING in the def-prototype registry, which is the duplication this case is about`,
    ).toEqual([])
    expect(
      page.registered.length,
      'FIXTURE (CCD-1): every translated node is registered on the defect page',
    ).toBe(page.tree.nodes.length)

    // ---- FIXTURE, part 2: a REAL condensed base exists. --------------------
    expect(
      sup.allNodes().length,
      'FIXTURE (CCD-1): the page must be non-empty before the condense',
    ).toBeGreaterThan(0)
    const view = await writePastTheCondenseThreshold(sup, 'CCD-1')
    expect(
      view.basePresent,
      "FIXTURE (CCD-1): the journal must carry the condensed base marker — without it there is no base to read and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')",
    ).toBe(true)

    // ---- THE CENSUS (await-free window: no replacement can be scheduled) ---
    const base = capturedBase(sup, 'CCD-1')
    const shipped = contentIds(base, 'CCD-1')
    const counts = censusCounts(shipped)

    assertCensusShipsEveryIdOnce(base, 'CCD-1')

    // The duplicated CARRIERS are the def-prototype registry nodes: each must
    // ship exactly once — and must still SHIP (a "dedupe" that dropped the
    // registry half would break the documented prototype round-trip).
    const registry = registryNodes(page.hub)
    const registryMeasured = registry.map((n) => `${n.id}×${counts.get(n.id) ?? 0}`)
    expect(
      registry.length,
      `FIXTURE (CCD-1): the def registry must hold the def-root + its def-child for this graph (measured ${JSON.stringify(registry.map((n) => `${n.id}:${n.state}`))}); with the seam flip both are ALSO in allNodes(), i.e. the census's two inputs overlap by exactly these nodes`,
    ).toBe(2)
    expect(
      registryMeasured,
      `CCD-1: every def-prototype REGISTRY node must appear in doc.content EXACTLY ONCE — these are the nodes the plain concat duplicates (measured id×occurrences ${JSON.stringify(registryMeasured)}; the registry loop runs AFTER allNodes(), in the order ${JSON.stringify(registry.map((n) => n.id))}); they must also still SHIP (0× means the registry half was dropped, which breaks the restored-prototype round-trip that CCD-3 pins on the healthy page). Measured content ids (ship order): ${JSON.stringify(shipped)}`,
    ).toEqual(registry.map((n) => `${n.id}×1`))

    // The trap: a comparison against a REPLACED marker measures nothing.
    assertSameMarker(sup, base.id, 'CCD-1 after the census read')
  })

  // ==========================================================================
  // CCD-2 — the capability: the page must be RESTORABLE (RED today)
  // ==========================================================================

  it('CCD-2 the same page now restores (status applied, no restore diagnostic) with its def prototypes still resolvable', async () => {
    const page = buildPage(censusPage({ seam: true }), { seam: true, where: 'CCD-2' })
    const sup = page.sup

    // FIXTURE: the seam wired the def prototypes (the duplication's precondition).
    expect(
      page.protosAtTranslate.map((n) => n.state),
      `FIXTURE (CCD-2): the children-target seam consumer must flip EVERY def prototype to 'in-tree' (measured ${JSON.stringify(page.protosAtTranslate.map((n) => n.state))})`,
    ).toEqual(page.protosAtTranslate.map(() => 'in-tree'))
    expect(
      page.skipped.map((n) => n.id),
      `FIXTURE (CCD-2): the seam-wired def-root must reach allNodes() (measured skipped ${JSON.stringify(page.skipped.map((n) => n.id))})`,
    ).toEqual([])

    const view = await writePastTheCondenseThreshold(sup, 'CCD-2')
    expect(
      view.basePresent,
      "FIXTURE (CCD-2): the journal must carry the condensed base marker before replay() — a skipped condense would make this case test NOTHING",
    ).toBe(true)
    const base = capturedBase(sup, 'CCD-2')
    const preNodes = sup.allNodes()
    const preCount = preNodes.length
    const preAuthored = authoredIds(preNodes)
    const preRegistry = registryNodes(page.hub).map((n) => n.id).sort()

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    // the trap: this window must still be measuring THE captured marker
    assertSameMarker(sup, base.id, 'CCD-2 immediately after replay()')
    await sup.flush()
    await flushCondense()
    const warns = warnLines(warn)
    const postNodes = sup.allNodes()
    const postCount = postNodes.length
    const postAuthored = authoredIds(postNodes)

    // (1) the restore PROCEEDS — today it is refused ('no-op').
    expect(
      replay.status,
      `CCD-2: the seam-wired def page must be RESTORABLE — replay() measured '${replay.status}' with allNodes() ${preCount} -> ${postNodes.length}. Today the condensed census ships the def-root and its def-child TWICE (measured content ids ${JSON.stringify(contentIds(base, 'CCD-2'))}), _baseSnapshotRefusal rejects the repeated id, and the page can never be restored. Measured warns: ${JSON.stringify(warns)}`,
    ).toBe('applied')

    // (2) NO restore diagnostic at all — no refusal, and no mutation claim for
    //     a base nothing rewrote. Today: one 'restore-refused-invalid-snapshot'.
    const restoreWarns = warns.filter((w) => /restore/i.test(w))
    expect(
      restoreWarns,
      `CCD-2: a SUCCESSFUL restore must emit ZERO restore diagnostics (no 'restore-refused-*', no 'restore-base-mutated', no 'restore-failed') — measured ${restoreWarns.length} of ${warns.length} warn(s): ${JSON.stringify(restoreWarns)}; full window ${JSON.stringify(warns)}`,
    ).toEqual([])

    // (3) …and nothing else in the window either, except the FIXTURE's own
    //     unresolved-DEF diagnostic (see the header block).
    const unexpected = warns.filter((w) => !w.startsWith(UNRESOLVED_FIXTURE_PREFIX))
    expect(
      unexpected,
      `CCD-2: the restore window must carry no diagnostic but this page's OWN '${UNRESOLVED_FIXTURE_PREFIX}…' fixture diagnostic (the seam consumer's compile reports the DEF name as unresolved — measured at bootstrap too, so it is the fixture, not the census). Measured ${unexpected.length} unexpected warn(s): ${JSON.stringify(unexpected)}; full window ${JSON.stringify(warns)}`,
    ).toEqual([])

    // (4) the graph came back with the same authored ids (non-empty).
    expect(
      postCount,
      `CCD-2: the restore must re-seed a NON-empty graph (measured ${preCount} -> ${postNodes.length})`,
    ).toBeGreaterThan(0)
    const missingAuthored = preAuthored.filter((id) => !postAuthored.includes(id))
    expect(
      missingAuthored,
      `CCD-2: the authored id set must survive the restore — measured before ${JSON.stringify(preAuthored)} (${preCount} nodes), after ${JSON.stringify(postAuthored)} (${postNodes.length} nodes); missing ${JSON.stringify(missingAuthored)}. (The def-root/def-child legitimately come back as REGISTRY prototypes and re-wire on compile, so the node COUNT may differ — the authored ids must not)`,
    ).toEqual([])

    // (5) an authored node is still usable.
    expect(
      usableReport(authoredIn(postNodes, 'app')),
      `CCD-2: an authored node must still be usable after the restore — measured ${usableReport(authoredIn(postNodes, 'app'))} over ${postNodes.length} node(s)`,
    ).toBe('compilePath() ok')

    // (6) the def prototypes are STILL REGISTERED and resolvable after it.
    const postRegistry = registryNodes(page.hub)
    const postRegistryIds = postRegistry.map((n) => n.id).sort()
    expect(
      postRegistryIds,
      `CCD-2: the restore must RE-REGISTER the def prototypes (measured before ${JSON.stringify(preRegistry)}, after ${JSON.stringify(postRegistryIds)}); a restore that lost the registry leaves a post-restore rows-mint by name unresolvable`,
    ).toEqual(preRegistry)
    const postRoots = registryRoots(page.hub)
    const postRoot = postRoots[0]
    expect(
      postRoot?.state,
      `CCD-2: the restored def-ROOT must be live-wired — its derived state reads '${postRoot?.state}' over ${JSON.stringify(postRoots.map((n) => `${n.id}:${n.state}`))}; 'in-tree' is the seam flip (the consumer re-wired it on the restore's pass-2), 'prototype' would mean the def came back registry-only and the seam was lost`,
    ).toBe('in-tree')

    // (7) the compiled consumer still resolves ITS def: its seam child IS the
    //     registry's def-root instance.
    const consumer = requireAuthored(postNodes, 'seamConsumer', 'CCD-2 post-restore')
    const consumerChildren = childrenOf(consumer)
    const wired = postRoot !== undefined && consumerChildren.includes(postRoot.id)
    expect(
      wired,
      `CCD-2: the restored consumer must still resolve its def — #seamConsumer's child-anchor children measured ${JSON.stringify(consumerChildren)}, the registry's def-root is ${postRoot?.id ?? '<none>'}; without the def-root under the consumer the seam is dead even though the graph looks restored`,
    ).toBe(true)

    assertSameMarker(sup, base.id, 'CCD-2 after the restore window')
  })

  // ==========================================================================
  // CCD-3 — the CONTROL: the same page WITHOUT the seam already ships unique ids
  // ==========================================================================

  it('CCD-3 (CONTROL, GREEN today) the same page without the seam consumer already condenses uniquely and restores silently', async () => {
    const page = buildPage(censusPage({ seam: false }), { seam: false, where: 'CCD-3' })
    const sup = page.sup

    // FIXTURE: with no seam consumer the def prototypes stay registry-only —
    // the ONLY difference from CCD-1/CCD-2.
    expect(
      page.protosAtTranslate.map((n) => n.state),
      "FIXTURE (CCD-3): without a seam consumer the def prototypes must stay derived-'prototype' (nothing wires them into the tree)",
    ).toEqual(page.protosAtTranslate.map(() => 'prototype'))
    expect(
      page.skipped.length,
      `FIXTURE (CCD-3): the registration filter must skip the registry-only def prototypes (measured skipped ${JSON.stringify(page.skipped.map((n) => n.id))})`,
    ).toBe(2)
    expect(
      sup.allNodes().length,
      'FIXTURE (CCD-3): the page must be non-empty before the condense',
    ).toBeGreaterThan(0)

    const view = await writePastTheCondenseThreshold(sup, 'CCD-3')
    expect(
      view.basePresent,
      "FIXTURE (CCD-3): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING",
    ).toBe(true)

    const base = capturedBase(sup, 'CCD-3')
    // GREEN TODAY: the healthy page's census is already duplicate-free.
    assertCensusShipsRegistryPrototypes(sup, base, page.hub, 'CCD-3')

    const preNodes = sup.allNodes()
    const preCount = preNodes.length
    const preAuthored = authoredIds(preNodes)

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    await sup.flush()
    await flushCondense()
    const warns = warnLines(warn)

    expect(
      replay.status,
      `CCD-3 (CONTROL): the same page WITHOUT the seam consumer must restore normally — measured '${replay.status}' (a dedupe that broke the healthy page would fail HERE)`,
    ).toBe('applied')
    expect(
      warns,
      `CCD-3 (CONTROL): a SUCCESSFUL restore of the healthy page must be COMPLETELY silent — measured ${warns.length} warn(s): ${JSON.stringify(warns)}. A fix for CCD-1/CCD-2 that warns on every restore breaks this control`,
    ).toEqual([])
    expect(
      sup.allNodes().length,
      `CCD-3 (CONTROL): the restore must re-seed the graph (measured ${preCount} -> ${sup.allNodes().length})`,
    ).toBeGreaterThan(0)
    expect(
      authoredIds(sup.allNodes()),
      `CCD-3 (CONTROL): the authored id set must survive a healthy restore — measured before ${JSON.stringify(preAuthored)}, after ${JSON.stringify(authoredIds(sup.allNodes()))}`,
    ).toEqual(preAuthored)
    assertSameMarker(sup, base.id, 'CCD-3 after the restore')
  })

  // ==========================================================================
  // CCD-4 — the over-correction guard: placement multiplicity is NOT duplication
  // ==========================================================================

  it('CCD-4 (GREEN today) placement multiplicity still condenses uniquely and restores with the multiplicity intact', async () => {
    const page = buildPage(placementPage(), { seam: false, where: 'CCD-4' })
    const sup = page.sup

    // ---- FIXTURE: the multiplicity is REAL (two distinct containers). ------
    const cardBefore = requireAuthored(sup.allNodes(), 'card', 'CCD-4')
    const keysBefore = pathKeysOf(cardBefore)
    expect(
      keysBefore.length,
      `FIXTURE (CCD-4): the two 'zone' containers must give #card TWO distinct path states (one per offering container) — measured ${JSON.stringify(keysBefore)}; with fewer, this case would not measure multiplicity at all`,
    ).toBe(2)
    const containersBefore = containerAnchorCount(sup.allNodes(), 'zoneA', 'CCD-4')
    expect(
      containersBefore,
      `FIXTURE (CCD-4): the shared per-name 'zone' Link must carry TWO container anchors (measured ${containersBefore}) — that IS the multiplicity the dedupe must not collapse`,
    ).toBe(2)
    const preCount = sup.allNodes().length
    const preIds = ids(sup.allNodes())
    const preAuthored = authoredIds(sup.allNodes())

    const view = await writePastTheCondenseThreshold(sup, 'CCD-4')
    expect(
      view.basePresent,
      "FIXTURE (CCD-4): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING",
    ).toBe(true)

    // ---- the census is unique BY ID (the repeated STRUCTURE stays). --------
    const base = capturedBase(sup, 'CCD-4')
    const shipped = contentIds(base, 'CCD-4')
    const counts = censusCounts(shipped)
    assertCensusShipsEveryIdOnce(base, 'CCD-4')
    const authoredMeasured = ['app', 'zoneA', 'zoneB', 'card'].map((cssId) => {
      const node = requireAuthored(sup.allNodes(), cssId, 'CCD-4 census read')
      return `${cssId}=${node.id}×${counts.get(node.id) ?? 0}`
    })
    expect(
      authoredMeasured,
      `CCD-4: every AUTHORED node of this page must ship exactly once — measured ${JSON.stringify(authoredMeasured)} over content ids ${JSON.stringify(shipped)}. #zoneA and #zoneB are two DISTINCT nodes offering the same placement name, so a dedupe keyed on anything but node identity/ID would wrongly collapse them`,
    ).toEqual(['app', 'zoneA', 'zoneB', 'card'].map((cssId) => {
      const node = requireAuthored(sup.allNodes(), cssId, 'CCD-4 census read')
      return `${cssId}=${node.id}×1`
    }))

    // ---- …and the page still restores, with the multiplicity INTACT. ------
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    await sup.flush()
    await flushCondense()
    const warns = warnLines(warn)

    expect(
      replay.status,
      `CCD-4: a placement-multiplicity page must restore normally — measured '${replay.status}' with allNodes() ${preCount} -> ${sup.allNodes().length}`,
    ).toBe('applied')
    expect(
      warns,
      `CCD-4: the placement page's restore must be silent — measured ${warns.length} warn(s): ${JSON.stringify(warns)}`,
    ).toEqual([])
    expect(
      sup.allNodes().length,
      `CCD-4: the restore must re-seed every node (measured ${preCount} -> ${sup.allNodes().length})`,
    ).toBe(preCount)
    expect(
      ids(sup.allNodes()),
      `CCD-4: the node id set must survive the restore — measured before ${JSON.stringify(preIds)}, after ${JSON.stringify(ids(sup.allNodes()))}`,
    ).toEqual(preIds)
    expect(
      authoredIds(sup.allNodes()),
      `CCD-4: the authored id set must survive the restore — measured before ${JSON.stringify(preAuthored)}`,
    ).toEqual(preAuthored)
    const cardAfter = requireAuthored(sup.allNodes(), 'card', 'CCD-4 post-restore')
    expect(
      pathKeysOf(cardAfter),
      `CCD-4: #card's path states must be exactly the pre-restore ones (measured before ${JSON.stringify(keysBefore)}, after ${JSON.stringify(pathKeysOf(cardAfter))}) — one per offering container, not one per duplicated census entry`,
    ).toEqual(keysBefore)
    expect(
      containerAnchorCount(sup.allNodes(), 'zoneA', 'CCD-4 post-restore'),
      `CCD-4: the shared 'zone' Link must still carry TWO container anchors after the restore (one per producer) — measured ${containerAnchorCount(sup.allNodes(), 'zoneA', 'CCD-4 post-restore')}`,
    ).toBe(2)
    assertSameMarker(sup, base.id, 'CCD-4 after the restore')
  })
})

/**
 * The CCD-3 control's census check — the same claim as
 * `assertCensusShipsEveryIdOnce` PLUS the registry half: on this page the two
 * def prototypes are NOT in `allNodes()`, so their ONE occurrence in `content`
 * can only come from the registry loop. A "dedupe" that dropped the registry
 * half (instead of skipping an id already shipped) would break that round-trip
 * silently, so the control pins it explicitly.
 */
function assertCensusShipsRegistryPrototypes(
  sup: Supervisor,
  base: CapturedBase,
  hub: Hub,
  where: string,
): void {
  assertCensusShipsEveryIdOnce(base, where)
  const shipped = contentIds(base, where)
  const counts = censusCounts(shipped)
  const registry = registryNodes(hub)
  expect(
    registry.length,
    `FIXTURE (${where}): the def registry must still hold the def-root + its def-child (measured ${JSON.stringify(registry.map((n) => `${n.id}:${n.state}`))})`,
  ).toBe(2)
  const registryMeasured = registry.map((n) => `${n.id}×${counts.get(n.id) ?? 0}`)
  expect(
    registryMeasured,
    `${where} (CONTROL): the census must STILL SHIP the registry-only prototypes exactly once each — they are NOT in allNodes() on this page (measured allNodes ${JSON.stringify(ids(sup.allNodes()))}), so their single occurrence comes from the registry loop, which serialize.md §3 keeps so a restore re-registers them. Measured ${JSON.stringify(registryMeasured)} over content ids ${JSON.stringify(shipped)}; 0× would mean the registry half was dropped rather than deduped`,
  ).toEqual(registry.map((n) => `${n.id}×1`))
}
