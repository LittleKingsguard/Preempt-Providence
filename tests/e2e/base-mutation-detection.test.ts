/**
 * `RESTORE-BASE-MUTATION-DETECTION` (`P-CBM-1`, gate record
 * `docs/specs/restore-base-mutation-detection-gate-review.md` §5) — **RED FIRST**
 * (AGENTS.md item 8): this file encodes the approved change against a tree that
 * does **not** have it, with **no `src/**` change** accompanying the file.
 *
 * ─── THE FACT THIS FEATURE IS ABOUT ─────────────────────────────────────────
 * The condensed journal base ALIASES live graph objects by design
 * (`docs/decisions.md` **`CONDENSE-BASE-IS-A-LIVE-VIEW`**; defect row
 * `docs/defects.md` **`CONDENSE-BASE-ALIASES-LIVE-GRAPH`**, closed BY DESIGN):
 * `condense()` stores `serializeSlice(...)` **uncloned**, so a host that mutates
 * one of those shared objects IN PLACE rewrites recorded history, and a later
 * `replay()`/`undo()` past that base returns the rewritten state. Mutating
 * history is UNSUPPORTED — but until this change it was also **SILENT**, and the
 * owner approved DETECTION ONLY (gate record §4/§5: warn, never refuse; no
 * clone; no new `UndoRedoReport` value; no repair).
 *
 * ─── THE CONTRACT (the six points this file pins) ───────────────────────────
 *  1. `condense()` records a **digest** of the snapshot it stored (a hash of its
 *     JSON serialization, or NOTHING when the snapshot cannot be serialized).
 *  2. `_restoreBase`'s pre-flight **compares** that digest **before any
 *     eviction** and **after** the existing refusal checks — so a REFUSED base
 *     never gets a mutation warning (nothing is restored; "restoring the
 *     rewritten state" would be a lie).
 *  3. On a mismatch it emits **exactly one** `console.warn` whose text starts
 *     `restore-base-mutated:` and names the fact, the shared-carrier cause and
 *     that the recorded-but-rewritten state is being restored.
 *  4. The restore **PROCEEDS**: the graph is re-seeded, `replay().status` is
 *     `'applied'`, the post-base entries are re-applied, nothing is repaired,
 *     and **no new `UndoRedoReport` value** is introduced — the report is
 *     `'applied'`, not a new word for "restored a rewritten base".
 *  5. **One warn per base MARKER**, re-armed by the next condense. A second
 *     `replay()` of the SAME marker must NOT warn again (the marker is never
 *     repaired, so an unchecked dedupe would warn forever); a condense that
 *     replaces the marker re-arms it.
 *  6. A base whose digest cannot be computed (a non-JSON-serializable snapshot)
 *     is **silently unchecked** — never refused, and never a reason to abort a
 *     condense (`condense-aborted` must not fire: the gate record §2 kill shot 2
 *     is exactly the hazard of a `JSON.stringify` digest inside `condense()`'s
 *     abort path, which would make every future condense abort and the journal
 *     grow without bound).
 *
 * ─── ⚠ THE TRAP THAT WOULD MAKE EVERY CASE VACUOUS ─────────────────────────
 * `maxJournalLength` makes the condense **deferred AND size-guarded**, and a
 * LATER condense **REPLACES the base marker** with a fresh snapshot spliced in
 * place of the old one (measured, and documented as a negative control in
 * `tests/unit/condense-base-invariance.test.ts` CBI-5 — this exact artefact cost
 * the gate reviewer one false finding, gate record §3 item 1). Every case here
 * therefore:
 *   (a) uses `maxJournalLength: 5` and drives `WRITE_COUNT = 35` ordinary
 *       `state-slice` writes so the pre-base window outweighs the base (the
 *       size guard skips with `condense-skipped-size` otherwise, giving NO base
 *       at all and a case that tests NOTHING);
 *   (b) asserts `journalEntries().basePresent === true` BEFORE `replay()`, on a
 *       `FIXTURE:` message;
 *   (c) captures the base **by MARKER ENTRY ID** and re-asserts
 *       `assertSameMarker(...)` at the window boundaries — if a second condense
 *       fired, the case measured a DIFFERENT marker and fails with a `FIXTURE:`
 *       message saying so, never with a finding;
 *   (d) keeps the post-condense journal at/under `maxJournalLength` so no
 *       replacement can be scheduled mid-window.
 *
 * ─── THE TWO EXISTING WARN-COUNT PINS THIS FILE MUST NOT CONTRADICT ─────────
 * `tests/e2e/restore-refusal.test.ts` already pins the warn counts of the two
 * sibling restore outcomes and both must stay true:
 *  - **RR-1** pins **exactly ONE** warn on a **REFUSED** restore (the
 *    `restore-refused-invalid-snapshot:` diagnostic). A mutation warn on a
 *    refused base would make that two → **BMD-5** pins "a refused base gets the
 *    refusal and NO mutation warn", which is contract point 2.
 *  - **RR-2** pins **ZERO** warns on a **HEALTHY** restore. A feature that warns
 *    on every restore would break it → **BMD-2** is the anti-noise control:
 *    the same page, the same restore, NO mutation, no warn.
 *
 * ─── WHAT EACH CASE ASSERTS ────────────────────────────────────────────────
 *  - **BMD-1** (RED today — the defect: a mutated base is now LOUD). Condense on
 *    the plain page, assert the alias is REAL (`#a`'s live `props.meta` IS the
 *    base entry's `props.meta`, the `CBI-3a` device), `push` a tag in place
 *    (rewriting the base), then `replay()`: **exactly one**
 *    `restore-base-mutated` warn, `status === 'applied'`, the graph is non-empty
 *    and keeps its authored id set, the live node objects were REPLACED (the
 *    restore really ran), the post-base write was re-applied, and the base was
 *    NOT repaired.
 *  - **BMD-2** (CONTROL, GREEN today — the anti-noise pin). Same page, NO
 *    mutation: ZERO `restore-base-mutated` (in fact zero) warns, `status ===
 *    'applied'`, graph intact.
 *  - **BMD-3** (RED today). After BMD-1's mutation, `replay()` a SECOND time:
 *    exactly ONE mutation warn **in total across both replays** (per replay:
 *    1 then 0), i.e. "one per base MARKER", never "one per replay".
 *  - **BMD-4** (RED today). After the first warn, force a SECOND condense
 *    (`SECOND_CONDENSE_WRITES` writes + `flush()` + two turns), assert the
 *    marker id CHANGED, mutate the NEW base's captured carrier, `replay()`:
 *    exactly one ADDITIONAL warn (two in total). This pins "per marker", not
 *    "per process" and not "warn once and then never again".
 *  - **BMD-5** (GREEN today — the refused-base control). A page whose restore is
 *    REFUSED **with a mutated base**: the window holds exactly ONE warn and it
 *    is the refusal — no `restore-base-mutated` (contract point 2).
 *    ✎ **RE-BASED** (the `CONDENSE-CENSUS-NO-DEDUPE` landing) — see the block
 *    below: the original trigger was the RR-1 seam page, whose condense census
 *    ships a node twice (a refusal the census fix DELETES). The trigger is now
 *    the **hub-less refusal** of `tests/e2e/restore-integrity.test.ts` RI-3.
 *  - **BMD-6** (GREEN today — the unserializable-base control, contract point 6).
 *    A root whose `css.cssDef` is CYCLIC (`cssDef` is NOT `assertJsonSafe`d, so
 *    it slips into the base uncloned — gate record §2/§5), with a mutated
 *    carrier: the condense must NOT abort (`condense-aborted` absent) and the
 *    restore must NOT warn (the digest could not be computed ⇒ silently
 *    unchecked), and the restore still applies.
 *
 * ─── ✎ BMD-5 RE-BASED — WHICH REFUSAL, AND WHY (read this before editing it) ─
 * BMD-5's claim is ORDERING: contract point 2 says the digest comparison runs
 * AFTER every refusal and BEFORE the eviction, so a base that is REFUSED must
 * never also get a `restore-base-mutated` claim ("the rewritten recorded state
 * is being restored" would be a lie — nothing is restored). To measure ordering
 * the case needs a refusal that (a) SURVIVES the census dedupe and (b) fires on
 * a marker the digest was RECORDED for. A **crafted malformed base** (the
 * `MAL-6` idiom RR-1 uses) fails (b): an injected `{ template: null, content:
 * [] }` marker is not the marker `condense()` digested, so the digest
 * comparison would skip under "no evidence" (gate record §5 item 7) and the case
 * could not tell correct ORDERING from an ABSENT comparison — it would pass
 * even if step 0c ran first. The authorable choice is therefore the
 * **hub-less refusal** (RI-3's shape, a documented-legal single-graph host):
 * the condense is REAL (so `baseDigest` IS keyed to this marker), the mutation
 * is REAL (the host writes in place through the base's own aliased carrier — the
 * `CBI-3a` device — measured: 1090B → 1094B, the base's own entry reads the
 * pushed tag), and the refusal fires at step 0 (no hub), BEFORE the step-0c
 * digest comparison. If step 0c ever moved ahead of it, this case would see a
 * SECOND warn and fail. Measured: exactly one warn,
 * `restore-refused-no-hub: …`, `status: 'no-op'`, graph 2 → 2 nodes with the
 * identical id set.
 *
 * NAMESPACE/SCOPE DISCIPLINE: every case builds its OWN `createLinkHub()` and its
 * own translated tree, so no case shares a per-name `Link`, a registry entry or
 * node ids with another. Helpers are duplicated DELIBERATELY (the model files
 * keep theirs private): the condense recipe + `buildPage`/`flushCondense` +
 * `authoredIn`/`requireAuthored` idioms come from
 * `tests/e2e/restore-integrity.test.ts`, the marker-capture/`FIXTURE:` discipline
 * and the `CBI-3a` alias device from `tests/unit/condense-base-invariance.test.ts`,
 * and the measured-message + `console.warn` spy discipline from
 * `tests/e2e/restore-refusal.test.ts`.
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

/** Ordinary post-bootstrap writes. 35 matches the restore-integrity recipe:
 *  enough BYTES that the condensed base is a memory win, so the D5 size guard
 *  rewrites instead of warning `condense-skipped-size` (a skipped condense = no
 *  base = a case testing nothing). */
const WRITE_COUNT = 35

/** Ordinary writes that must force BMD-4's SECOND condense. The rewrite is
 *  size-guarded (`base >= pre-base journal` is skipped) and the pre-base journal
 *  includes the OLD base marker, so the window has to outweigh it — measured:
 *  the rewrite fires well inside this budget. If BMD-4's replacement assertion
 *  fails with a `FIXTURE:` message, the condense POLICY changed (the size guard,
 *  or how many bytes a `state-slice` entry costs): raise this count, never
 *  "fix" it by re-reading the finder. */
const SECOND_CONDENSE_WRITES = 40

/** The warn prefix the feature must use (gate record §5 item 4). Matched as a
 *  PREFIX, never as a substring: a warn that merely mentions the phrase is not
 *  the diagnostic. */
const BASE_MUTATION_WARN_PREFIX = 'restore-base-mutated:'

/** The in-place tags BMD-1/BMD-3/BMD-6 push and BMD-4 pushes a second time. */
const MUTATION_TAG = 'z'
const SECOND_MUTATION_TAG = 'z2'

// ============================================================================
// The pages
// ============================================================================

/**
 * **plain** — `div#app` (`props.theme = {mode:'light', depth:{n:1}}`,
 * `css.style = 'color: red;'`) with a child `div#a`
 * (`props.meta = {tags:['x','y']}`, `content: 'hello'`, and a `span` child).
 * `#a`'s nested `props.meta` object is the ALIASED carrier every case mutates in
 * place (measured: it IS the base content entry's `props.meta` object).
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
 * **plain + a cyclic `css.cssDef`** (BMD-6). `serializeNode`'s `cssState` ships
 * `cssDef` VERBATIM with no `assertJsonSafe` (only `props`/`content`/anchor
 * `value`/`bodyRuns`/`batches` ride that boundary — `serialize.ts:107-113`), so
 * a cyclic cssDef condenses into the base today (measured: the condense fires and
 * the restore applies) and the base's JSON serialization is impossible.
 */
function cssDefPage(cssDef: unknown): LegacyInitialData {
  const page = plainPage() as unknown as { template: { root: { css: Record<string, unknown> } } }
  page.template.root.css.cssDef = cssDef
  return page as unknown as LegacyInitialData
}

/**
 * **the RR-1 page** (`tests/e2e/restore-refusal.test.ts`), kept as BMD-5's
 * carrier page: `div#app > div#defHost` (which hosts the inline def `nav`,
 * minting its def-root + def-child prototypes) plus `div#seamConsumer`
 * (`component: [{ target: 'children', reference: 'nav' }]`).
 * `#defHost.props.meta` is the nested object the base aliases.
 *
 * ✎ RE-BASED NOTE: BMD-5 no longer *uses* the seam (`seam: false` — the
 * duplicated-census refusal it used to ride on is removed by
 * `CONDENSE-CENSUS-NO-DEDUPE`, header block). The consumer stays in the
 * envelope because it is what makes this the same page RR-1 uses, and the
 * restore's refusal trigger is now the host's missing HUB, not the seam.
 */
function seamPage(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'app' },
        props: { id: 'app' },
        children: [
          {
            type: 'div',
            css: { id: 'defHost' },
            props: { id: 'defHost', meta: { tags: ['n'] } },
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
          {
            type: 'div',
            css: { id: 'seamConsumer' },
            props: { id: 'seamConsumer' },
            component: [{ target: 'children', reference: 'nav' }],
          },
        ],
      },
    },
    content: [],
    clientConfig: CLIENT_CONFIG,
  } as unknown as LegacyInitialData
}

interface Page {
  sup: Supervisor
  tree: TranslatedTree
  /** the def prototypes translate minted (BMD-5 asserts the seam wired them). */
  protosAtTranslate: Node[]
  /** the translated nodes the registration filter SKIPPED (registry-only
   *  prototypes by design) — BMD-5 asserts the seam page skips none. */
  skipped: Node[]
}

/**
 * The documented host shape the restore path needs: ONE hub shared by
 * `translateLegacy` and the `Supervisor`, and registration through the
 * derived-state filter `state !== 'prototype'` (`serialize.md:99-100`).
 *
 * ORDER MATTERS ON THE SEAM PAGE and is the (historical) refusal's
 * reproduction: the host runs its BOOTSTRAP COMPILE
 * (`#seamConsumer.compilePath()`, a read-only path compile, legal before
 * registration) and only THEN registers — that is the order in which the seam's
 * state flip is visible to the filter.
 *
 * `hub: false` builds the HUB-LESS host BMD-5 is re-based onto (✎ see the
 * header block): a documented-legal shape for a single-graph host
 * (`Supervisor`'s constructor accepts it) whose restore is refused at the
 * hub check — the `tests/e2e/restore-integrity.test.ts` RI-3 idiom.
 */
function buildPage(opts: { envelope: LegacyInitialData; seam: boolean; where: string; hub?: boolean }): Page {
  const hub = opts.hub === false ? undefined : createLinkHub()
  const tree = translateLegacy(opts.envelope, hub ? { hub } : undefined)
  const sup = new Supervisor({
    ...(hub ? { hub } : {}),
    maxJournalLength: MAX_JOURNAL_LENGTH,
  })
  const protosAtTranslate = tree.nodes.filter((n) => n.state === 'prototype')
  if (opts.seam) {
    const consumer = tree.nodes.find((n) => n.css?.id === 'seamConsumer')
    if (!consumer) throw new Error(`FIXTURE (${opts.where}): the seam page holds no #seamConsumer node`)
    consumer.compilePath()
  }
  const skipped: Node[] = []
  for (const n of tree.nodes) {
    if (n.state === 'prototype') {
      skipped.push(n)
      continue
    }
    sup.registerNode(n)
  }
  expect(
    sup.allNodes().length,
    `FIXTURE (${opts.where}): every translated node whose derived state is not 'prototype' must be registered (measured ${sup.allNodes().length} registered of ${tree.nodes.length - skipped.length} registerable / ${tree.nodes.length} translated)`,
  ).toBe(tree.nodes.length - skipped.length)
  return { sup, tree, protosAtTranslate, skipped }
}

// ============================================================================
// Reading the live graph (public surfaces only)
// ============================================================================

/** A live node by its AUTHORED id — the restore REPLACES node objects, so a
 *  translate-time reference is stale after `replay()`. */
function authoredIn(nodes: Node[], cssId: string): Node | undefined {
  return nodes.find((n) => n.css?.id === cssId || n.props?.id === cssId)
}

/** `authoredIn` with a loud FIXTURE failure — a setup break must never read as
 *  a feature red. */
function requireAuthored(nodes: Node[], cssId: string, where: string): Node {
  const n = authoredIn(nodes, cssId)
  if (!n) throw new Error(`FIXTURE (${where}): the live graph holds no authored #${cssId} node`)
  return n
}

/** The graph's AUTHORED id set, SORTED (minted node ids survive a restore
 *  verbatim, so either axis works; authored ids are what the fixture knows). */
function authoredIds(nodes: Node[]): string[] {
  return nodes
    .map((n) => (typeof n.css?.id === 'string' ? n.css.id : typeof n.props?.id === 'string' ? n.props.id : n.id))
    .sort()
}

/** The captured `console.warn` calls, each flattened to one string (idiom:
 *  `tests/e2e/restore-refusal.test.ts`). Non-string args are stringified, never
 *  dropped, so a `console.warn('restore-base-mutated:', detail)`-style call is
 *  still counted. */
function warnLines(mock: { mock: { calls: unknown[][] } }): string[] {
  return mock.mock.calls.map((call) => String(call.map(String).join(' ')))
}

/** Contract point 3's marker: the PREFIX, not a substring. */
function isBaseMutationWarn(line: string): boolean {
  return line.startsWith(BASE_MUTATION_WARN_PREFIX)
}

// ============================================================================
// The aliased carrier every case mutates in place
// ============================================================================

/** The shape the base and the live node share: a mutable `tags` array under
 *  `props.meta`. Deliberately narrow — it is the pin's whole surface. */
interface TagCarrier {
  tags: string[]
}

/** Read `props.meta` as the tag carrier, or fail as a `FIXTURE:` break. */
function tagsOf(props: Record<string, unknown> | undefined, where: string): TagCarrier {
  const meta = props?.meta
  const shaped = typeof meta === 'object' && meta !== null && Array.isArray((meta as { tags?: unknown }).tags)
  if (!shaped) {
    throw new Error(`FIXTURE (${where}): props.meta must be a { tags: string[] } carrier — measured ${JSON.stringify(meta)}`)
  }
  return meta as unknown as TagCarrier
}

/**
 * Contract-adjacent FIXTURE: the condensed base must ALIAS the live graph — the
 * live node's `props.meta` must be THE SAME OBJECT as the base content entry's
 * `props.meta`. Without it an in-place write would NOT rewrite recorded history
 * and every case in this file would pass vacuously (this is the `CBI-3a` device,
 * duplicated). A future clone-on-condense engine legitimately breaks THIS half —
 * that is the control reporting the CONTRACT MOVED
 * (`docs/decisions.md` `CONDENSE-BASE-IS-A-LIVE-VIEW`), not the engine breaking.
 */
function assertAliasedCarrier(
  live: Record<string, unknown> | undefined,
  baseProps: Record<string, unknown> | undefined,
  where: string,
): void {
  const liveMeta = live?.meta
  const baseMeta = baseProps?.meta
  if (liveMeta === undefined || baseMeta === undefined) {
    throw new Error(
      `FIXTURE (${where}): the live node and the condensed base must BOTH carry props.meta — measured live ${JSON.stringify(liveMeta)} / base ${JSON.stringify(baseMeta)}`,
    )
  }
  expect(
    baseMeta,
    `FIXTURE (${where}): the condensed base must SHIP THE LIVE OBJECT BY REFERENCE — the base content entry's props.meta must be the SAME object as the live node's props.meta (docs/decisions.md CONDENSE-BASE-IS-A-LIVE-VIEW; measured live ${JSON.stringify(liveMeta)} vs base ${JSON.stringify(baseMeta)}). If they are different objects the base was detached/cloned, an in-place write cannot rewrite recorded history, and this case would be vacuous`,
  ).toBe(liveMeta)
}

// ============================================================================
// Capturing the base BY MARKER ENTRY ID (never by "whatever the finder says")
// ============================================================================

/** The shapes this file reads off a serialized base. */
interface SnapshotEntry {
  id?: unknown
  props?: Record<string, unknown>
  css?: Record<string, unknown>
}

/** The captured base: the marker's `id` plus the SNAPSHOT OBJECT held by
 *  reference, so a later marker replacement cannot silently swap the thing being
 *  measured (the header's trap). */
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

/** The journal's CURRENT base marker, read through the finder. The trap: after a
 *  second condense this returns a DIFFERENT id and a FRESH snapshot — which is
 *  why every window re-asserts the captured id instead of trusting this read. */
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
    `FIXTURE (${where}): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')`,
  ).toBe(true)
  const base = currentBase(sup)
  if (!base) throw new Error(`FIXTURE (${where}): journalEntries() reports basePresent yet the journal holds no 'base' entry`)
  return base
}

/** The base's recorded BYTES. JSON (not a reference walk) so a nested in-place
 *  write is visible even when an outer carrier object was replaced. NOT usable on
 *  BMD-6's page — its snapshot cannot be JSON-serialized by construction. */
function bytesOf(base: BaseMarker): string {
  return JSON.stringify(base.snapshot)
}

/**
 * Assert the journal still holds THE CAPTURED MARKER. A second condense splices
 * a FRESH snapshot in place of the marker, which invalidates every measurement
 * in the window — so this fails as a `FIXTURE:` break, never as a finding.
 */
function assertSameMarker(sup: Supervisor, capturedId: string, where: string): void {
  const now = sup.journal.find((e) => e.op.kind === 'base')
  if (now?.id !== capturedId) {
    throw new Error(
      `FIXTURE (${where}): a SECOND condense replaced the condensed base marker (captured ${capturedId}, the journal now holds ${now?.id ?? 'no base at all'}) — this window measured NOTHING. A later condense splices a FRESH snapshot of the CURRENT graph in place of the marker, so "the base was mutated", "the warn fired once" and every byte count below would be about a DIFFERENT marker (the artefact recorded in the gate record §3 item 1 and pinned as a negative control by condense-base-invariance CBI-5). Keep the post-condense journal at/under maxJournalLength (${MAX_JOURNAL_LENGTH}) so no replacement can be scheduled, and drive the window without awaits until the replay under test`,
    )
  }
}

/** The base's serialized entry for an authored id. */
function contentEntryFor(base: BaseMarker, cssId: string): SnapshotEntry {
  const entry = base.snapshot.content.find((c) => c.props?.id === cssId || c.css?.id === cssId)
  if (!entry) {
    throw new Error(
      `FIXTURE: the condensed base ships no content entry for #${cssId} — measured content ids: ${JSON.stringify(base.snapshot.content.map((c) => String(c.props?.id ?? c.id)))}`,
    )
  }
  return entry
}

/** Drive the recipe (`WRITE_COUNT` ordinary writes → `flush()` → two
 *  `setTimeout(0)` turns). Returns the journal view so the CALLER asserts
 *  `basePresent` (each case's own precondition — and BMD-6 must check
 *  `condense-aborted` FIRST, so this never hides the skip). */
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
      `FIXTURE (${where}): the condense recipe's own write ${i} must apply — measured '${res.status}'; a rejected write would make the pre-base window smaller than intended and the size guard could skip the condense`,
    ).toBe('applied')
  }
  await sup.flush()
  await flushCondense()
  return sup.journalEntries()
}

/** The recipe + the capture, for the cases that do not need to inspect the
 *  condense window itself. */
async function condenseBase(sup: Supervisor, where: string): Promise<BaseMarker> {
  const view = await writePastTheCondenseThreshold(sup, where)
  expect(
    view.basePresent,
    `FIXTURE (${where}): the journal must carry the condensed base marker before any replay() — a skipped condense (deferred AND size-guarded, 'condense-skipped-size') would make this case test NOTHING`,
  ).toBe(true)
  return captureBase(sup, where)
}

/** An ordinary post-base write: it gives `replay()` a post-base entry to
 *  RE-APPLY (contract point 4) while keeping the journal at/under
 *  `maxJournalLength`, so the deferred condense cannot replace the marker. */
function postBaseWrite(sup: Supervisor, where: string): void {
  const root = requireAuthored(sup.allNodes(), 'app', where)
  const res = sup.apply({
    kind: 'state-slice',
    node: root,
    mutation: [{ targetProp: 'props.tick', mode: 'replace', value: 'post-base' }],
  })
  expect(res.status, `FIXTURE (${where}): the post-base write must apply — measured '${res.status}'`).toBe('applied')
  expect(
    sup.journal.length,
    `FIXTURE (${where}): the post-condense journal must stay at/under maxJournalLength (${MAX_JOURNAL_LENGTH}) so no deferred condense can REPLACE the base marker mid-window — measured ${sup.journal.length} entries`,
  ).toBeLessThanOrEqual(MAX_JOURNAL_LENGTH)
}

// ============================================================================
// BMD-1 — the defect: a mutated base is now LOUD, and the restore PROCEEDS
// ============================================================================

describe('RESTORE-BASE-MUTATION-DETECTION — a mutated condensed base warns exactly once and the restore proceeds', () => {
  it('BMD-1 a mutated base emits ONE restore-base-mutated warn, restores with status applied, replaces the graph and repairs nothing', async () => {
    const page = buildPage({ envelope: plainPage(), seam: false, where: 'BMD-1' })
    const sup = page.sup
    const base = await condenseBase(sup, 'BMD-1')
    const recordedBytes = bytesOf(base)
    const aBefore = requireAuthored(sup.allNodes(), 'a', 'BMD-1')
    const authoredBefore = authoredIds(sup.allNodes())

    // ---- FIXTURE: the alias is REAL (the CBI-3a device) -------------------
    const aBase = contentEntryFor(base, 'a')
    assertAliasedCarrier(aBefore.props, aBase.props, 'BMD-1 (#a props.meta)')

    // ---- THE HOST ACTION: an in-place write that rewrites recorded history
    tagsOf(aBefore.props, 'BMD-1 (the carrier being mutated)').tags.push(MUTATION_TAG)
    const mutatedBytes = bytesOf(base)
    expect(
      mutatedBytes,
      `FIXTURE (BMD-1): the in-place push must REWRITE the condensed base — measured ${recordedBytes.length} recorded bytes and ${mutatedBytes.length} after the push; if they are equal the base did NOT alias the live object and this case would be vacuous`,
    ).not.toBe(recordedBytes)
    expect(
      tagsOf(aBase.props, 'BMD-1 (the captured base after the mutation)').tags,
      `FIXTURE (BMD-1): the base's OWN content entry must now read the mutated tags — measured ${JSON.stringify(tagsOf(aBase.props, 'BMD-1').tags)}`,
    ).toEqual(['x', 'y', MUTATION_TAG])

    // ---- a post-base entry so "the post-base entries are re-applied" is measured
    postBaseWrite(sup, 'BMD-1')
    assertSameMarker(sup, base.id, 'BMD-1 immediately before replay()')

    // ---- the restore window ----------------------------------------------
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    await sup.flush()
    await flushCondense()
    const warns = warnLines(warn)
    const mutationWarns = warns.filter(isBaseMutationWarn)
    const mutationText = mutationWarns[0] ?? '<no restore-base-mutated warn was emitted>'
    const mutationDetail = mutationText.slice(BASE_MUTATION_WARN_PREFIX.length)

    // (1) the mutation is REPORTED — exactly once (contract point 3)
    expect(
      mutationWarns.length,
      `BMD-1: a restore from a MUTATED condensed base must say so LOUD — the base ALIASES the live graph (docs/decisions.md CONDENSE-BASE-IS-A-LIVE-VIEW), so the in-place push to #a props.meta rewrote recorded history (base ${recordedBytes.length}B -> ${mutatedBytes.length}B), yet the restore was SILENT: measured ${mutationWarns.length} 'restore-base-mutated' warn(s) in a window of ${warns.length} warn(s) ${JSON.stringify(warns)}. replay().status was '${replay.status}', allNodes() was ${sup.allNodes().length}, base marker ${base.id} (unchanged throughout the window). The approved change records a digest at condense() and compares it in _restoreBase's pre-flight (gate record docs/specs/restore-base-mutation-detection-gate-review.md §5) — warn-only, never a refusal`,
    ).toBe(1)

    // (2) it is the window's ONLY warn ("exactly one console.warn")
    expect(
      warns.length,
      `BMD-1: the mutation diagnostic must be the restore window's EXACTLY ONE console.warn (contract point 3); measured ${warns.length} warn(s): ${JSON.stringify(warns)}`,
    ).toBe(1)

    // (3) the text names the fact, the cause and the restore (contract point 3)
    expect(
      mutationText.startsWith(BASE_MUTATION_WARN_PREFIX),
      `BMD-1: the mutation warn's text must START with '${BASE_MUTATION_WARN_PREFIX}' — measured ${JSON.stringify(mutationText)}`,
    ).toBe(true)
    expect(
      /restor/i.test(mutationDetail),
      `BMD-1: the warn must say the recorded-but-REWRITTEN state is being RESTORED (gate record §5 item 4: "attribution-honest message … saying the state is being restored") — measured detail ${JSON.stringify(mutationDetail)}`,
    ).toBe(true)
    expect(
      /shared|alias|reference|in.place|same object|carrier/i.test(mutationDetail),
      `BMD-1: the warn must name the SHARED-CARRIER cause (the base aliases live graph objects — not vandalism, not an engine failure; gate record §5 item 4) — measured detail ${JSON.stringify(mutationDetail)}`,
    ).toBe(true)

    // (4) the restore PROCEEDS — warn-only, no refusal, no new status word
    expect(
      replay.status,
      `BMD-1: the restore must PROCEED after the mutation warn — 'applied' is the pinned word (contract point 4: warn-only, no new UndoRedoReport value; gate record §4 rejected refusal on four grounds) — measured '${replay.status}'`,
    ).toBe('applied')

    // (5) the graph came back: non-empty, same authored ids, REPLACED objects
    const postNodes = sup.allNodes()
    expect(
      postNodes.length,
      `BMD-1: the restore must re-seed the graph (measured ${postNodes.length} nodes after replay(); the condensed base is re-seeded in-process, so an empty graph would mean the restore was refused or failed)`,
    ).toBeGreaterThan(0)
    expect(
      authoredIds(postNodes),
      `BMD-1: the authored id set must survive the restore — measured before ${JSON.stringify(authoredBefore)}, after ${JSON.stringify(authoredIds(postNodes))}`,
    ).toEqual(authoredBefore)
    expect(
      requireAuthored(postNodes, 'a', 'BMD-1 post-restore'),
      `BMD-1: the restore must actually REPLACE the live node objects (it re-seeds through new Node(...)) — #a before the replay must NOT be the #a afterwards; measured the SAME object, so the graph was not re-seeded`,
    ).not.toBe(aBefore)

    // (6) the post-base entries were RE-APPLIED
    const restoredRoot = requireAuthored(postNodes, 'app', 'BMD-1 post-restore')
    expect(
      restoredRoot.props.tick,
      `BMD-1: the post-base state-slice entry must be re-applied on top of the restored base (contract point 4) — measured props.tick ${JSON.stringify(restoredRoot.props.tick)}, expected 'post-base'`,
    ).toBe('post-base')

    // (7) nothing is REPAIRED: the base still holds the rewritten bytes
    expect(
      bytesOf(base),
      `BMD-1: nothing may be repaired — the warn is detection, not remediation (no clone, no revert; gate record §5 "Rejected permanently"), so the captured base must still hold the REWRITTEN bytes ${mutatedBytes.length}B (measured ${bytesOf(base).length}B) and never fall back to the recorded ${recordedBytes.length}B`,
    ).toBe(mutatedBytes)
    assertSameMarker(sup, base.id, 'BMD-1 after the replay')
  })

  // ==========================================================================
  // BMD-2 — the CONTROL: no mutation, no warning (the anti-noise pin)
  // ==========================================================================

  it('BMD-2 (CONTROL, GREEN today) the same page with NO mutation restores silently — zero restore-base-mutated warns', async () => {
    const page = buildPage({ envelope: plainPage(), seam: false, where: 'BMD-2' })
    const sup = page.sup
    const base = await condenseBase(sup, 'BMD-2')
    const recordedBytes = bytesOf(base)
    const authoredBefore = authoredIds(sup.allNodes())

    // The alias exists on this page too (the base ships #a's props.meta by
    // reference) — the ONLY difference from BMD-1 is that nothing mutates it.
    assertAliasedCarrier(requireAuthored(sup.allNodes(), 'a', 'BMD-2').props, contentEntryFor(base, 'a').props, 'BMD-2 (#a props.meta)')

    postBaseWrite(sup, 'BMD-2')
    assertSameMarker(sup, base.id, 'BMD-2 immediately before replay()')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    await sup.flush()
    await flushCondense()
    const warns = warnLines(warn)
    const mutationWarns = warns.filter(isBaseMutationWarn)

    expect(
      mutationWarns.length,
      `BMD-2 (CONTROL): a HEALTHY restore — the base was never mutated (measured base bytes ${recordedBytes.length}B unchanged: ${bytesOf(base).length}B) — must emit ZERO 'restore-base-mutated' warns; measured ${mutationWarns.length}: ${JSON.stringify(mutationWarns)}. A feature that warns on every restore fails HERE (this is the anti-noise pin, and it is the same contract as RR-2's "a successful restore must not warn")`,
    ).toBe(0)
    expect(
      warns,
      `BMD-2 (CONTROL): the healthy restore must be COMPLETELY silent — tests/e2e/restore-refusal.test.ts RR-2 pins zero warns on a successful restore, and BMD-1's red must not be "fixed" by warning everywhere; measured ${warns.length} warn(s): ${JSON.stringify(warns)}`,
    ).toEqual([])
    expect(
      replay.status,
      `BMD-2 (CONTROL): the healthy restore must report 'applied' — measured '${replay.status}'`,
    ).toBe('applied')
    expect(
      sup.allNodes().length,
      'BMD-2 (CONTROL): the healthy restore must re-seed a non-empty graph',
    ).toBeGreaterThan(0)
    expect(
      authoredIds(sup.allNodes()),
      `BMD-2 (CONTROL): the authored id set must survive a healthy restore — measured before ${JSON.stringify(authoredBefore)}`,
    ).toEqual(authoredBefore)
    expect(
      bytesOf(base),
      `BMD-2 (CONTROL): a healthy restore must leave the base byte-identical (measured ${recordedBytes.length}B at capture, ${bytesOf(base).length}B now) — the digest comparison is a READ, never a rewrite of the base`,
    ).toBe(recordedBytes)
    assertSameMarker(sup, base.id, 'BMD-2 after the replay')
  })

  // ==========================================================================
  // BMD-3 — one warn per base MARKER, not one per replay
  // ==========================================================================

  it('BMD-3 a SECOND replay of the same mutated marker does not warn again — one warn in total across both replays', async () => {
    const page = buildPage({ envelope: plainPage(), seam: false, where: 'BMD-3' })
    const sup = page.sup
    const base = await condenseBase(sup, 'BMD-3')
    const aBefore = requireAuthored(sup.allNodes(), 'a', 'BMD-3')
    const aBase = contentEntryFor(base, 'a')
    assertAliasedCarrier(aBefore.props, aBase.props, 'BMD-3 (#a props.meta)')
    tagsOf(aBefore.props, 'BMD-3 (the carrier being mutated)').tags.push(MUTATION_TAG)
    assertSameMarker(sup, base.id, 'BMD-3 immediately before the first replay()')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const firstReplay = sup.replay()
    await sup.flush()
    const afterFirst = warnLines(warn).filter(isBaseMutationWarn).length
    assertSameMarker(sup, base.id, 'BMD-3 between the two replays')

    const secondReplay = sup.replay()
    await sup.flush()
    await flushCondense()
    const mutationWarns = warnLines(warn).filter(isBaseMutationWarn)
    const afterSecond = mutationWarns.length - afterFirst

    expect(
      [afterFirst, afterSecond],
      `BMD-3: the mutation warn is per base MARKER, not per replay (contract point 5) — the marker is NEVER repaired (nothing reverts the shared object), so an unchecked "warn once per mismatch" would fire on EVERY replay of the same base and a host would see an unbounded stream of diagnostics for one historical write. Measured mutation warns per replay: [${afterFirst}, ${afterSecond}] (expected [1, 0]); statuses '${firstReplay.status}' then '${secondReplay.status}'; marker ${base.id} throughout`,
    ).toEqual([1, 0])
    expect(
      mutationWarns.length,
      `BMD-3: exactly ONE 'restore-base-mutated' warn in total across the two replays (contract point 5) — measured ${mutationWarns.length}: ${JSON.stringify(mutationWarns)}`,
    ).toBe(1)
    expect(
      [firstReplay.status, secondReplay.status],
      `BMD-3: BOTH replays must report 'applied' — the warn is not a refusal, and a second replay of the same marker must behave exactly like the first (contract point 4) — measured ${JSON.stringify([firstReplay.status, secondReplay.status])}`,
    ).toEqual(['applied', 'applied'])
    expect(
      sup.allNodes().length,
      'BMD-3: the second replay must leave a re-seeded, non-empty graph',
    ).toBeGreaterThan(0)
    assertSameMarker(sup, base.id, 'BMD-3 after the second replay')
  })

  // ==========================================================================
  // BMD-4 — re-armed by the next condense (per marker, not per process)
  // ==========================================================================

  it('BMD-4 the next condense re-arms the warn: a NEW marker mutated again warns exactly one ADDITIONAL time (two in total)', async () => {
    const page = buildPage({ envelope: plainPage(), seam: false, where: 'BMD-4' })
    const sup = page.sup
    const base1 = await condenseBase(sup, 'BMD-4')
    const aFirst = requireAuthored(sup.allNodes(), 'a', 'BMD-4')
    assertAliasedCarrier(aFirst.props, contentEntryFor(base1, 'a').props, 'BMD-4 (base #1)')
    tagsOf(aFirst.props, 'BMD-4 (the base-#1 carrier being mutated)').tags.push(MUTATION_TAG)
    assertSameMarker(sup, base1.id, 'BMD-4 immediately before the first replay()')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // ---- the FIRST restore: one warn, for base #1 ------------------------
    const firstReplay = sup.replay()
    await sup.flush()
    const afterFirstReplay = warnLines(warn).filter(isBaseMutationWarn).length
    assertSameMarker(sup, base1.id, 'BMD-4 after the first replay')
    // Its red belongs to BMD-1 (same feature, same absence) — soft here so the
    // case's OWN claim (the re-arm below) is always measured and reported.
    expect.soft(
      afterFirstReplay,
      `BMD-4 (precondition, shared with BMD-1): the first replay of a MUTATED base must warn once — measured ${afterFirstReplay} 'restore-base-mutated' warn(s); status '${firstReplay.status}'. This half is BMD-1's red; BMD-4's own claim is the RE-ARM below`,
    ).toBe(1)

    // ---- force a SECOND condense (the marker REPLACEMENT) ----------------
    // Measured (condense-base-invariance CBI-5, same recipe): the rewrite is
    // size-guarded, so the pre-base window must outweigh the OLD base marker.
    const rootNow = requireAuthored(sup.allNodes(), 'app', 'BMD-4 second condense')
    for (let i = 0; i < SECOND_CONDENSE_WRITES; i += 1) {
      const res = sup.apply({
        kind: 'state-slice',
        node: rootNow,
        mutation: [{ targetProp: 'props.tick', mode: 'replace', value: `post2-${i}` }],
      })
      expect(
        res.status,
        `FIXTURE (BMD-4): write ${i} of the second-condense window must apply — measured '${res.status}'`,
      ).toBe('applied')
    }
    await sup.flush()
    await flushCondense()
    const afterSecondCondense = warnLines(warn).filter(isBaseMutationWarn).length
    const base2 = currentBase(sup)
    if (!base2) throw new Error('FIXTURE (BMD-4): the journal no longer holds ANY base marker after the second condense')
    expect(
      base2.id,
      `FIXTURE (BMD-4): the second condense must REPLACE the base marker — measured entry id '${base1.id}' then '${base2.id}'. If they are equal the rewrite did NOT fire (the deferred condense is also SIZE-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size'): raise SECOND_CONDENSE_WRITES (${SECOND_CONDENSE_WRITES}) — this is a condense-POLICY change, NOT the feature under test, and the fix is never to re-read the finder`,
    ).not.toBe(base1.id)
    expect(
      afterSecondCondense,
      `BMD-4: a CONDENSE must never emit a 'restore-base-mutated' warn (it is a restore-time diagnostic) — measured ${afterSecondCondense} warn(s) after the condense window that replaced the marker`,
    ).toBe(afterFirstReplay)

    // ---- mutate the NEW base's captured carrier -------------------------
    const aSecond = requireAuthored(sup.allNodes(), 'a', 'BMD-4 (base #2)')
    assertAliasedCarrier(aSecond.props, contentEntryFor(base2, 'a').props, 'BMD-4 (base #2)')
    tagsOf(aSecond.props, 'BMD-4 (the base-#2 carrier being mutated)').tags.push(SECOND_MUTATION_TAG)
    expect(
      tagsOf(contentEntryFor(base2, 'a').props, 'BMD-4 (base #2 after the mutation)').tags,
      'FIXTURE (BMD-4): the SECOND base must carry the second in-place mutation — otherwise the re-arm assertion below is vacuous',
    ).toEqual(['x', 'y', MUTATION_TAG, SECOND_MUTATION_TAG])

    // ---- the SECOND restore: one ADDITIONAL warn ------------------------
    const secondReplay = sup.replay()
    await sup.flush()
    await flushCondense()
    const mutationWarns = warnLines(warn).filter(isBaseMutationWarn)
    const afterSecondReplay = mutationWarns.length - afterSecondCondense

    expect(
      afterSecondReplay,
      `BMD-4: the warn is re-armed by the NEXT CONDENSE ("one warn per base marker", contract point 5) — the second base is a DIFFERENT marker and was mutated again, so the restore must warn exactly ONE more time; measured ${afterSecondReplay} additional 'restore-base-mutated' warn(s) after the marker change ${base1.id} -> ${base2.id}. A "warn once per supervisor, forever" implementation (the R-W4-5 starvation hazard, gate record §5 item 3) fails HERE`,
    ).toBe(1)
    expect(
      mutationWarns.length,
      `BMD-4: two mutated markers must produce exactly TWO warns in total across the case (measured ${mutationWarns.length}: ${JSON.stringify(mutationWarns)}); per phase: ${afterFirstReplay} after the first replay, ${afterSecondCondense - afterFirstReplay} during the second condense, ${afterSecondReplay} after the second replay`,
    ).toBe(2)
    expect(
      secondReplay.status,
      `BMD-4: the re-armed restore must still PROCEED ('applied', contract point 4) — measured '${secondReplay.status}'`,
    ).toBe('applied')
    expect(
      sup.allNodes().length,
      'BMD-4: the re-armed restore must leave a re-seeded, non-empty graph',
    ).toBeGreaterThan(0)
    assertSameMarker(sup, base2.id, 'BMD-4 after the second replay')
  })

  // ==========================================================================
  // BMD-5 — a REFUSED base must NOT get a mutation warn
  // ==========================================================================

  it('BMD-5 a REFUSED base gets exactly one warn and it is the REFUSAL — no restore-base-mutated claim for a restore that does not happen', async () => {
    // ✎ RE-BASED (header block): the trigger is the HUB-LESS refusal (RI-3's
    // documented-legal single-graph host), NOT the seam page's duplicated condense
    // census — that refusal is DELETED by `CONDENSE-CENSUS-NO-DEDUPE`. `seam:
    // false` keeps the seam out of the picture entirely (this case is about the
    // pre-flight ORDER, not about seams), and `hub: false` is what makes the
    // restore refuse.
    const page = buildPage({ envelope: seamPage(), seam: false, hub: false, where: 'BMD-5' })
    const sup = page.sup

    // FIXTURE: the page is the registry-only-prototype shape — with no seam, the
    // `nav` def prototypes stay derived-'prototype' and the registration filter
    // skips them (so the census is `allNodes()` alone). Without this the page is
    // not the one RI-3 describes.
    expect(
      page.protosAtTranslate.length,
      'FIXTURE (BMD-5): the `nav` def must mint its def-root + one def-child prototype (translate.ts mintDefPrototypes) — the page must be the DEF page, not an empty one',
    ).toBe(2)
    expect(
      page.protosAtTranslate.map((n) => n.state),
      `FIXTURE (BMD-5): with no seam consumer the def prototypes must stay derived-'prototype' (measured ${JSON.stringify(page.protosAtTranslate.map((n) => n.state))})`,
    ).toEqual(page.protosAtTranslate.map(() => 'prototype'))
    expect(
      page.skipped.length,
      `FIXTURE (BMD-5): the registration filter must skip the registry-only def prototypes (measured skipped ${JSON.stringify(page.skipped.map((n) => n.id))})`,
    ).toBe(2)

    const base = await condenseBase(sup, 'BMD-5')
    const defHostBefore = requireAuthored(sup.allNodes(), 'defHost', 'BMD-5')
    const preCount = sup.allNodes().length
    const preIds = authoredIds(sup.allNodes())
    const preAuthoredIds = sup.allNodes().map((n) => n.id).sort()

    // ---- THE MUTATION: the base ALIASES this live carrier (the CBI-3a device),
    // so this push rewrites recorded history on a marker the condense REALLY
    // digested — the precondition that makes "no mutation warn" discriminating.
    assertAliasedCarrier(defHostBefore.props, contentEntryFor(base, 'defHost').props, 'BMD-5 (#defHost props.meta)')
    tagsOf(defHostBefore.props, 'BMD-5 (the carrier being mutated)').tags.push(MUTATION_TAG)
    expect(
      tagsOf(contentEntryFor(base, 'defHost').props, 'BMD-5 (the captured base after the mutation)').tags,
      'FIXTURE (BMD-5): the in-place push must REWRITE the condensed base — otherwise "no mutation warn" would be trivially true and the case vacuous',
    ).toEqual(['n', MUTATION_TAG])
    assertSameMarker(sup, base.id, 'BMD-5 immediately before replay()')

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const replay = sup.replay()
    await sup.flush()
    await flushCondense()
    const warns = warnLines(warn)
    const mutationWarns = warns.filter(isBaseMutationWarn)
    // The refusal this case rides on: `_restoreBase` step 0 (no hub) — it runs
    // BEFORE step 0c's digest comparison, which is the ORDER contract point 2
    // pins. Matched as a PREFIX (never a substring).
    const refusalWarns = warns.filter((w) => w.startsWith('restore-refused-'))

    // (a) the refusal is the window's ONE warn (tests/e2e/restore-refusal.test.ts
    //     RR-1 pins exactly one warn on a refused restore — the mutation must not
    //     add a second).
    expect(
      warns.length,
      `BMD-5: a REFUSED restore must report EXACTLY ONE warn — the 'restore-refused-*' diagnostic (RR-1's pin in tests/e2e/restore-refusal.test.ts) and NOTHING else; measured ${warns.length} warn(s): ${JSON.stringify(warns)}. A mutation warn here means the digest was compared BEFORE the refusal checks (contract point 2)`,
    ).toBe(1)
    expect(
      refusalWarns.length,
      `BMD-5: the single warn must be the REFUSAL — this hub-less host's restore is refused at _restoreBase step 0, so no seeding (and no digest comparison) happens; measured ${JSON.stringify(warns)}`,
    ).toBe(1)
    expect(
      warns[0]?.startsWith('restore-refused-no-hub'),
      `BMD-5: the single warn must be the HUB-LESS refusal ('restore-refused-no-hub: …') — the re-based trigger (RI-3's shape). Measured ${JSON.stringify(warns)}; if this reads 'restore-refused-invalid-snapshot' the trigger moved and this case is measuring something else`,
    ).toBe(true)

    // (b) THE CLAIM: no mutation diagnostic for a base that is NOT restored.
    expect(
      mutationWarns.length,
      `BMD-5: a REFUSED base must NEVER get a 'restore-base-mutated' warn (contract point 2) — the base is not restored, so "the rewritten recorded state is being restored" would be a LIE, and the pre-flight order is contract: the refusal checks run FIRST, the digest comparison AFTER them, both BEFORE any eviction. Measured ${mutationWarns.length} mutation warn(s): ${JSON.stringify(mutationWarns)}`,
    ).toBe(0)

    // (c) the refusal kept the graph (so the case really took the refusal path)
    expect(
      replay.status,
      `BMD-5: the hub-less page's restore must be REPORTED as refused — measured '${replay.status}' (the RR-1 contract's word for "nothing was applied")`,
    ).toBe('no-op')
    expect(
      sup.allNodes().length,
      `BMD-5: a refused restore must keep the pre-base graph (measured ${preCount} -> ${sup.allNodes().length}) — an emptied graph would mean this case measured the eviction defect, not the refusal`,
    ).toBe(preCount)
    expect(
      sup.allNodes().map((n) => n.id).sort(),
      `BMD-5: a refused restore must keep the SAME nodes (measured ${JSON.stringify(preAuthoredIds)} before, ${JSON.stringify(sup.allNodes().map((n) => n.id).sort())} after)`,
    ).toEqual(preAuthoredIds)
    expect(
      authoredIds(sup.allNodes()),
      `BMD-5: the authored id set must be unchanged by the refusal — measured before ${JSON.stringify(preIds)}`,
    ).toEqual(preIds)
  })

  // ==========================================================================
  // BMD-6 — an unserializable base is SILENTLY UNCHECKED (never refused)
  // ==========================================================================

  it('BMD-6 a base that cannot be JSON-serialized does not abort the condense and does not warn at restore', async () => {
    // The CYCLE the gate record §2 kill shot 2 names: `css.cssDef` is NOT
    // `assertJsonSafe`d (`serialize.ts` `cssState` ships it verbatim), so this
    // slips into the frozen doc and makes its JSON serialization impossible.
    // (A `BigInt` in the cssDef was measured too and behaves identically — the
    // cycle is used because it is the exact hazard the gate record recorded.)
    const cycle: Record<string, unknown> = { rule: 'color: red;' }
    cycle.self = cycle
    const page = buildPage({ envelope: cssDefPage(cycle), seam: false, where: 'BMD-6' })
    const sup = page.sup

    // FIXTURE: the cyclic cssDef reached the LIVE node's css (by reference).
    expect(
      requireAuthored(sup.allNodes(), 'app', 'BMD-6').css.cssDef,
      'FIXTURE (BMD-6): the authored css.cssDef must be the live css object the page built — without it the base is serializable and this case tests nothing',
    ).toBe(cycle)

    // The spy covers the CONDENSE window here (contract point 6 is about the
    // condense surviving an un-digestible snapshot), then the restore window.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const view = await writePastTheCondenseThreshold(sup, 'BMD-6')
    const condenseWindow = warnLines(warn)

    // (1) the condense must NOT abort: a `JSON.stringify` digest inside
    //     `condense()`'s abort path would make EVERY future condense fail and the
    //     journal grow without bound (gate record §2 kill shot 2).
    expect(
      condenseWindow.filter((w) => w.startsWith('condense-aborted')).length,
      `BMD-6: a base whose snapshot cannot be JSON-serialized must NEVER abort the condense — the digest is computed OUTSIDE condense()'s abort path and an un-digestible snapshot simply goes unchecked (contract point 6; gate record §2 kill shot 2 / §5 item 2); measured condense-window warn(s): ${JSON.stringify(condenseWindow)}`,
    ).toBe(0)
    expect(
      view.basePresent,
      `FIXTURE (BMD-6): the journal must still carry the condensed base marker after an un-digestible condense — without it replay() never calls _restoreBase and this case would test NOTHING (measured condense-window warn(s): ${JSON.stringify(condenseWindow)})`,
    ).toBe(true)
    const base = captureBase(sup, 'BMD-6')

    // FIXTURE: the base really cannot be serialized (the whole premise).
    let stringifyError = ''
    try {
      JSON.stringify(base.snapshot)
    } catch (e) {
      stringifyError = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
    }
    expect(
      stringifyError,
      'FIXTURE (BMD-6): the condensed snapshot must be JSON-UNSERIALIZABLE — that is the premise of "the digest cannot be computed"; measured JSON.stringify did NOT throw, so the cyclic cssDef did not reach the base',
    ).toMatch(/circular/i)

    // ---- mutate a carrier: the check would fire IF it could run -----------
    const aBefore = requireAuthored(sup.allNodes(), 'a', 'BMD-6')
    assertAliasedCarrier(aBefore.props, contentEntryFor(base, 'a').props, 'BMD-6 (#a props.meta)')
    tagsOf(aBefore.props, 'BMD-6 (the carrier being mutated)').tags.push(MUTATION_TAG)
    expect(
      tagsOf(contentEntryFor(base, 'a').props, 'BMD-6 (the captured base after the mutation)').tags,
      'FIXTURE (BMD-6): the in-place push must REWRITE the condensed base — otherwise "silently unchecked" and "correctly detected nothing" are indistinguishable',
    ).toEqual(['x', 'y', MUTATION_TAG])
    assertSameMarker(sup, base.id, 'BMD-6 immediately before replay()')

    const before = condenseWindow.length
    const replay = sup.replay()
    await sup.flush()
    await flushCondense()
    const restoreWindow = warnLines(warn).slice(before)

    // (2) the restore must be SILENT about the mutation: no digest exists.
    expect(
      restoreWindow.filter(isBaseMutationWarn).length,
      `BMD-6: an un-digestible base is SILENTLY UNCHECKED (contract point 6) — no digest was recorded, so a mutated carrier can neither be detected nor claimed; the restore must not warn 'restore-base-mutated' (and must not refuse). Measured restore-window warn(s): ${JSON.stringify(restoreWindow)}`,
    ).toBe(0)
    // (3) and it must still restore normally.
    expect(
      replay.status,
      `BMD-6: the un-digestible base must restore normally — an un-serializable snapshot is "no check", never "no restore" (contract point 6) — measured '${replay.status}'`,
    ).toBe('applied')
    expect(
      sup.allNodes().length,
      'BMD-6: the restore must re-seed a non-empty graph',
    ).toBeGreaterThan(0)
    expect(
      requireAuthored(sup.allNodes(), 'a', 'BMD-6 post-restore'),
      'BMD-6: the restore must have REPLACED the live node objects (it re-seeds through new Node(...)) — measured the SAME #a object, so the graph was not re-seeded',
    ).not.toBe(aBefore)
    assertSameMarker(sup, base.id, 'BMD-6 after the replay')
  })
})
