/**
 * `DESTROY-SHARED-LINK-RESIDUE`, `RESTORE-REGISTERS-PROTOTYPES` and
 * `RESTORE-PLACED-CONTENT-MEMBERSHIP` (`docs/defects.md` rows of those names;
 * gate `docs/specs/serializer-census-gate-review.md` §1(a)/(b)/(c) + §3 items
 * 1-3) — RED FIRST (AGENTS.md item 8): written against a tree where all three
 * defects are LIVE, with **no `src/**` change** accompanying this file.
 *
 * THE MECHANISM (all three rows come out of ONE host shape — the condensed-base
 * restore, `Supervisor.replay()` → `_restoreBase`):
 *
 *  - **DR-1** the graph-REPLACE evicts the pre-base generation and re-seeds the
 *    document through `new Node(d, hub, …)`, so the RESTORED instances re-join
 *    the hub-shared per-name component `Link` — but nothing takes the PRE-BASE
 *    generation's `source`/`duplex`/`target` anchors off that Link.
 *    `Node.destroy()` → `destroyLinks` removes only `child`/`content`/
 *    `container` (`node.ts:956-973`), and the registry-only prototypes are not
 *    even in `this.nodes`, so the eviction loop never touches them. The Link is
 *    now an ORDERED list spanning two generations, and every reader that walks
 *    it (`providerValueFromLink`, `resolve.ts:36-47` — the seam/def value read)
 *    returns the FIRST anchor with a value: the DEAD one. Measured: a seam
 *    consumer recompiled after the restore delivers the pre-base generation's
 *    value object.
 *  - **DR-2** `_restoreBase` seeds every `loadState` entry and registers **all**
 *    seeds (`supervisor.ts:1050`), plain prototypes included, while
 *    `serialize.md:99-100` (and the `supervisor.ts:951-952` comment) pin "plain
 *    prototypes stay out of `this.nodes`" — true of the translate path only.
 *  - **DR-3** the landing restore detector re-establishes `contentNodes`
 *    membership from a FAMILY PARENT ANCHOR TARGETING THE `'contentNodes'`
 *    TOKEN (`supervisor.ts:1061-1065`), but `addAnchor` DESTROYS that
 *    placeholder edge the moment a real family parent supersedes it
 *    (`node.ts:1022-1023`) and the document records only the real parent — so a
 *    RESTORED **placed** content root is byte-indistinguishable from an
 *    authored tree node and loses the sweep exemption ("payload-owned content
 *    persists (placement may return)").
 *
 * ⚠ THE FIXTURE TRAPS (each one silently produced a vacuous run in a probe):
 *
 *  1. **A skipped condense makes a "restore" case pass on nothing.** `condense`
 *     is DEFERRED (a `setTimeout(0)`) AND SIZE-GUARDED — `baseBytes >=
 *     journalBytes` skips the rewrite with `condense-skipped-size`. Every cycle
 *     here therefore writes `WRITE_COUNT` ordinary `state-slice` writes under
 *     `maxJournalLength: 5` and **asserts `journalEntries().basePresent ===
 *     true` BEFORE `replay()`**; without a base marker `_restoreBase` never
 *     runs. Idiom (helpers duplicated deliberately — that file's are private):
 *     `tests/e2e/restore-integrity.test.ts`.
 *  2. **A `children`/`type`-target seam consumer cannot be used in the DR-1/DR-2
 *     fixture.** Compiling one wires the def-root as a seam CHILD of the
 *     consumer, which flips the def-root's derived `state` from `'prototype'`
 *     to `'in-tree'`. `serializeSlice`'s C2 strip only drops seam child anchors
 *     from **prototype-state** entries, so the seam anchor ships, and the
 *     restore then throws `NodeSchema-shape-mismatch` at the post-seed
 *     `state === 'prototype'` tripwire (`serialize.ts:539`) — swallowed by
 *     `replay`'s bare `catch` (`supervisor.ts:1672-1685`), leaving
 *     `allNodes() === 0`. That is a FOURTH, related-but-distinct defect (NOT
 *     one of these three rows) and it would mask DR-1/DR-2 entirely, so the def
 *     under test here is never seam-targeted through `children`: the prototypes
 *     are minted by the `nav` def's own translate site, and the ONE seam
 *     consumer is a `content`-target on a DIFFERENT, prototype-less def.
 *  3. **A prototype must be identifiable without guessing state shape.** The
 *     fixture registers only nodes whose derived `state !== 'prototype'` (the
 *     pin's own shape — `serialize.md:99-100`) and asserts what it skipped, so
 *     a translate-shape change fails loudly as `FIXTURE:` instead of reddening
 *     a defect case.
 *
 * ✎ STATUS (2026-11-23, post-fix): the three fixes landed (`supervisor.ts`,
 * `serialize.ts`, `types.ts`), so DR-1a, DR-1b, DR-2a, DR-3a and DR-3b are
 * GREEN and DR-3c stays green. The "(RED today)" markers below are the
 * RED-FIRST INTENT this file was authored with, kept as the historical
 * requirement record — they are not a statement about the current tree. TWO
 * cases were CORRECTED on this pass (their post-restore expectations were
 * unsatisfiable as written, for reasons that are NOT engine defects); each
 * carries a `✎ CORRECTED` note in place, with the reason and the defect row it
 * defers to.
 *
 * WHAT THIS FILE ASSERTS:
 *  - **DR-1a** (RED at authoring time) no anchor of the hub-shared component
 *    Link is owned by a PRE-BASE prototype instance after a real restore.
 *    ✎ CORRECTED: its post-restore PRECONDITION used to be
 *    `allNodes().length >= tree.nodes.length` (5 = 3 in-tree + 2 minted
 *    prototypes), which contradicted DR-2a's pin (the restored `allNodes()` is
 *    the IN-TREE set, 3) — mutually unsatisfiable. It now pins the IN-TREE
 *    census; see `RESTORE-REGISTERS-PROTOTYPES`.
 *  - **DR-1b** (RED at authoring time) ✎ CORRECTED: the seam read after a
 *    restore is served by the RESTORED generation — measured as ANCHOR
 *    OWNERSHIP by object identity, plus the pre-base residue assertion. It used
 *    to demand that the delivered VALUE object be a different object from the
 *    pre-restore one; that is not the property the row claims, and the
 *    in-process condense path cannot satisfy it at all (the base aliases live
 *    state — `CONDENSE-BASE-ALIASES-LIVE-GRAPH`), so the value half is now a
 *    documented structural CONTROL. Measured through `compilePath()`, the
 *    `content` slot being the only surface a `content`-target seam read lands
 *    on; `bindings` is asserted alongside as the control.
 *  - **DR-2a** (RED today) the restored `allNodes()` is the pinned shape — the
 *    same node set as the pre-restore in-tree graph, no plain prototypes.
 *  - **DR-2b** (GREEN today, must STAY green) the restored graph's IN-TREE half
 *    is complete: same authored ids, same count, before and after.
 *  - **DR-3a** (RED today) a restored PLACED content root satisfies
 *    `isContentNode(node) === true`.
 *  - **DR-3b** (RED today) its behavioural consequence: detached (so `state` is
 *    no longer `'in-tree'`) it SURVIVES the sweep — with a non-content sentinel
 *    in the same window that IS destroyed, so "survived" is not vacuous.
 *  - **DR-3c** (CONTROL, green today) without a restore the same detach leaves
 *    the placed content root alive — the semantics DR-3b restores.
 *
 * NAMESPACE/SCOPE DISCIPLINE: every case builds its OWN `createLinkHub()`,
 * translate call and `Supervisor`, so no case shares a per-name Link, a
 * registry entry or node ids with another (node ids come from a module counter).
 *
 * IMPORT NOTE: `isContentNode` is NOT re-exported from the package barrel
 * (`src/index.ts`), so this file imports the deep core path — the established
 * idiom for the registry surface (`tests/unit/destroy-cascade.test.ts:15`,
 * `tests/e2e/restore-integrity.test.ts:75`). `refreshPayload` is the documented
 * host API for placing a payload root under a real family parent (DR-3); see
 * the case's own comment for why `apply({kind:'attach', …})` cannot do it.
 */
import { describe, it, expect } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import {
  translateLegacy,
  createLinkHub,
  type LegacyInitialData,
  type TranslatedTree,
} from '../../src/core/translate.js'
import { refreshPayload, type Payload } from '../../src/core/payload.js'
// deep core path — not on the package barrel (see the header's IMPORT NOTE).
// `defPrototypeEntries`/`defRootPrototypeEntries` are the READ-ONLY registry
// enumerators the condense census uses (`supervisor.ts:957-960`): DR-1b needs
// them to name the CURRENT def-prototype generation (a restored def provider is
// registry-only by the pin, so `allNodes()` alone is the wrong universe).
import { isContentNode, defPrototypeEntries, defRootPrototypeEntries } from '../../src/core/registry.js'

// ============================================================================
// The condense recipe (deferred + size-guarded — header trap 1)
// ============================================================================

const CLIENT_CONFIG = { runInstantiation: true, runRendering: true }

/** The condense trigger (the rows' probe used `5`). Low enough that 35 plain
 *  writes blow past it, high enough that the writes are the thing that fills
 *  the pre-base window (the deferred, SIZE-GUARDED condense). */
const MAX_JOURNAL_LENGTH = 5

/** Ordinary post-bootstrap writes. 35 is the row's probe count: enough bytes
 *  that the condensed base is a memory WIN, so the size guard rewrites instead
 *  of warning `condense-skipped-size`. */
const WRITE_COUNT = 35

/** Two macrotask turns: enough for the supervisor's DEFERRED condense
 *  (`scheduleCondense`, a `setTimeout(0)`). */
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

/**
 * ONE real condensed-base restore cycle: writes → wait → **assert the base
 * marker exists** → `replay()` → assert it applied. Every FIXTURE precondition
 * lives here so a setup break fails on a `FIXTURE:` message and never reads as
 * a defect red.
 */
async function restoreOnce(sup: Supervisor, label: string): Promise<void> {
  const view = await writePastTheCondenseThreshold(sup)
  expect(
    view.basePresent,
    `FIXTURE (${label}): the journal must carry the condensed base marker — without it replay() never calls _restoreBase and this case would test NOTHING (the condense is deferred AND size-guarded: a base >= the pre-base journal is skipped with 'condense-skipped-size')`,
  ).toBe(true)
  const replay = sup.replay()
  expect(replay.status, `FIXTURE (${label}): replay() must restore the condensed base`).toBe('applied')
  await sup.flush()
}

// ============================================================================
// Reading the live graph (public surfaces only)
// ============================================================================

/** A live node by its AUTHORED id — the restore REPLACES node objects, so a
 *  translate-time reference is stale after `replay()`. */
function authoredIn(nodes: Node[], cssId: string): Node | undefined {
  return nodes.find((n) => n.css?.id === cssId || n.props?.id === cssId)
}

/** `authoredIn` with a loud FIXTURE failure. */
function requireAuthored(nodes: Node[], cssId: string): Node {
  const n = authoredIn(nodes, cssId)
  if (!n) throw new Error(`FIXTURE: the live graph holds no authored #${cssId} node (the restore lost it)`)
  return n
}

const ids = (nodes: Node[]): string[] => nodes.map((n) => n.id).sort()

// ============================================================================
// The def/links page (DR-1 + DR-2)
// ============================================================================
//
// `div#app > (div#defHost, div#lblConsumer)`. `#defHost` carries the INLINE
// value-carrying def `nav` (the authoring form of `tests/unit/def-roundtrip.test.ts`
// `defDoc`, but bound on the node instead of in the `template.component` census
// so the provider anchor lives on a graph node): a css-bearing def →
// `mintDefPrototypes` mints its DEF-ROOT prototype plus one DEF-CHILD prototype
// (`translate.ts:835-905`). The def-child in turn carries a component binding
// (`lbl`) of its own — that is what puts a `source` anchor owned by a
// REGISTRY-ONLY prototype on a hub-shared component Link, i.e. the generation
// `DESTROY-SHARED-LINK-RESIDUE` is about (absent from `this.nodes`, so even the
// `for (const n of [...this.nodes.values()])` eviction loop never reaches it).
//
// `#lblConsumer` is the PROVIDER-READ handle: `component: [{target: 'content',
// reference: 'lbl'}]` is a `content`-target seam, whose delivery is
// `providerValueFromLink(link).content` (`node.ts:1832-1857`) — the only seam
// shape that lands a VALUE (a `children`/`type` seam reads the registry for its
// nodes and only null-checks the value). It is also the shape that is SAFE in
// this fixture: it materializes a LAYER, never a seam family edge, so it does
// not flip the prototypes' derived `state` (header trap 2).
function defLinksPage(): LegacyInitialData {
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
            props: { id: 'defHost' },
            component: [
              {
                reference: 'nav',
                value: {
                  type: 'nav',
                  css: { style: 'color: red;' },
                  children: [
                    {
                      type: 'span',
                      content: 'logo',
                      component: [{ reference: 'lbl', value: { type: 'b', content: { label: 'pre-base' } } }],
                    },
                  ],
                },
              },
            ],
          },
          {
            type: 'div',
            css: { id: 'lblConsumer' },
            props: { id: 'lblConsumer' },
            component: [{ target: 'content', reference: 'lbl' }],
          },
        ],
      },
    },
    content: [],
    clientConfig: CLIENT_CONFIG,
  } as unknown as LegacyInitialData
}

interface DefPage {
  sup: Supervisor
  tree: TranslatedTree
  hub: ReturnType<typeof createLinkHub>
  /** the def prototypes translate minted — NOT registered (the pin's shape). */
  prototypes: Node[]
}

/**
 * The documented host shape the restore path needs: ONE hub shared by the
 * translate call, the `Supervisor`, and the re-seed. Only nodes whose derived
 * `state !== 'prototype'` are registered — the pin's translated shape
 * (`serialize.md:99-100`, header trap 3); the skipped prototypes are returned so
 * each case can assert its own preconditions on them.
 */
function buildDefPage(): DefPage {
  const hub = createLinkHub()
  const tree = translateLegacy(defLinksPage(), { hub })
  const sup = new Supervisor({ hub, maxJournalLength: MAX_JOURNAL_LENGTH })
  const prototypes = tree.nodes.filter((n) => n.state === 'prototype')
  for (const n of tree.nodes) if (n.state !== 'prototype') sup.registerNode(n)
  return { sup, tree, hub, prototypes }
}

/** The `source`/`duplex` anchors of the hub-shared per-name component Link —
 *  the anchors `providerValueFromLink` walks (`resolve.ts:36-47`). */
function providerAnchors(hub: DefPage['hub'], name: string) {
  const link = hub.linkFor(name, 'component')
  return link.anchors.filter((a) => a.role === 'source' || a.role === 'duplex')
}

// ============================================================================
// DR-1 — DESTROY-SHARED-LINK-RESIDUE
// ============================================================================

describe('DR-1 DESTROY-SHARED-LINK-RESIDUE — a restore must leave no pre-base generation on the hub-shared component Link', () => {
  it('DR-1a no source/duplex anchor of the component Link keeps a PRE-BASE prototype owner', async () => {
    const page = buildDefPage()

    // FIXTURE — the pre-base generation IS a registry-only prototype owning a
    // provider anchor on a hub-shared Link (the row's exact shape).
    expect(
      page.prototypes.length,
      'FIXTURE: the `nav` def must mint its def-root + one def-child prototype (translate.ts:835-905) — without prototypes this case tests nothing',
    ).toBe(2)
    const preAnchors = providerAnchors(page.hub, 'lbl')
    expect(
      preAnchors.length,
      "FIXTURE: the def-child prototype must publish exactly ONE `lbl` provider anchor on the shared Link (its inline `component: [{reference:'lbl', …}]` binding)",
    ).toBe(1)
    const preOwners = preAnchors.map((a) => a.owner).filter((o): o is Node => o !== undefined)
    expect(preOwners.length, 'FIXTURE: every `lbl` provider anchor must have a node owner').toBe(1)
    for (const owner of preOwners) {
      expect(page.prototypes, 'FIXTURE: the pre-base `lbl` provider must be one of the minted PROTOTYPES').toContain(owner)
      expect(owner.state, "FIXTURE: the pre-base `lbl` provider derives 'prototype'").toBe('prototype')
      expect(
        page.sup.allNodes(),
        "FIXTURE: the pre-base prototype generation must be REGISTRY-ONLY (absent from this.nodes) — that is the generation the row says neither an id census nor the this.nodes-only eviction loop can reach",
      ).not.toContain(owner)
    }

    // ✎ CORRECTED 2026-11-23 — the IN-TREE census this case's post-restore
    // precondition must be measured against. It used to be
    // `page.sup.allNodes().length >= page.tree.nodes.length`, i.e. >= 5, while
    // `tree.nodes` counts the MINTED PROTOTYPES as well (3 registered in-tree +
    // 2 def prototypes). DR-2a pins the restored `allNodes()` to the IN-TREE set
    // (3), so the two preconditions were mutually unsatisfiable and no correct
    // restore could pass both. The engine fix for `RESTORE-REGISTERS-PROTOTYPES`
    // (prototype seeds are skipped at registration, `supervisor.ts` step 5)
    // settles the count at 3 BY DESIGN — the pin is the shape, the census is a
    // consequence. Captured here as ids so a restore that swaps a node for one
    // with a different id fails as the fixture it is; the RESIDUE assertions
    // below are unchanged (this case is the shared-Link residue, the graph shape
    // is DR-2a's case).
    const preInTree = page.sup.allNodes()
    const preInTreeIds = ids(preInTree)
    const preConsumer = requireAuthored(preInTree, 'lblConsumer')

    await restoreOnce(page.sup, 'DR-1a')

    // POST-RESTORE PRECONDITION: the graph really was re-seeded (a restore that
    // bailed would leave the pre-base generation in place for a different
    // reason — `restoreOnce` already asserted basePresent/applied, this pins the
    // object REPLACEMENT of every registered in-tree node).
    const restoredConsumer = requireAuthored(page.sup.allNodes(), 'lblConsumer')
    expect(
      restoredConsumer,
      'FIXTURE: the restore REPLACES the pre-base node objects — a stale reference would be the fixture, not the defect',
    ).not.toBe(preConsumer)
    // Deliberately measured on the IN-TREE subset (`state`, not `allNodes()`
    // length): the restored graph's prototype membership is `serialize.md §3
    // step 5`'s business (DR-2a pins it), and this case must not redden as a
    // consequence of that shape — only of a restore that LOST or REPLACED an
    // in-tree node.
    expect(
      ids(page.sup.allNodes().filter((n) => n.state === 'in-tree')),
      `FIXTURE (✎ CORRECTED — see the note above): a hub-present restore must re-seed exactly the IN-TREE nodes that were registered before it (measured pre-restore ${JSON.stringify(preInTreeIds)}). \`tree.nodes\` was the old yardstick and it is NOT this one: it also counts the minted def prototypes (5 = 3 + 2), while \`RESTORE-REGISTERS-PROTOTYPES\` pins the restored allNodes() to the in-tree set — so \`>= tree.nodes.length\` contradicted DR-2a and could never pass on a correct restore`,
    ).toEqual(preInTreeIds)

    const link = page.hub.linkFor('lbl', 'component')
    const stale = link.anchors.filter((a) => a.owner !== undefined && preOwners.includes(a.owner))
    const measured = link.anchors.map((a) => `${a.role}->${(a.owner as Node | undefined)?.id ?? String(a.target)}`)

    expect(
      stale.map((a) => `${a.role}:${(a.owner as Node).id}`),
      `DR-1a: every restore leaves the EVICTED generation's \`source\`/\`duplex\` anchors on the hub-shared per-name component Link — \`destroy()\` → \`destroyLinks\` removes only child/content/container (node.ts:956-973) and a registry-only prototype is not in this.nodes at all, so the eviction loop never reaches it. The Link is now an ORDERED list spanning two generations and \`providerValueFromLink\` returns the FIRST anchor with a value — the DEAD one. The row's fix shape (_restoreBase step 1: hub-filtered registry enumerators → removeAnchor each instance's source/duplex/target, then evict, BEFORE reRegisterDefPrototypes) must clear this. Measured Link anchors after the restore: ${JSON.stringify(measured)}; live #lblConsumer id: ${restoredConsumer.id}`,
    ).toEqual([])

    // The stronger form of the same claim: NO anchor of the shared Link (any
    // role) may keep a pre-base prototype as its owner. A live generation that
    // legitimately holds source anchors is untouched by this (identity, never a
    // count — `link.anchors` after a correct fix = the restored generation).
    expect(
      link.anchors.filter((a) => a.owner !== undefined && preOwners.includes(a.owner)).length,
      `DR-1a: the shared Link still carries ${link.anchors.length} anchor(s) of which the pre-base prototype owns (any role): measured ${JSON.stringify(measured)}`,
    ).toBe(0)
  })

  it('DR-1b (✎ CORRECTED) after a restore the seam read is served by the RESTORED generation — anchor OWNERSHIP, not value freshness', async () => {
    const page = buildDefPage()
    const consumer0 = requireAuthored(page.sup.allNodes(), 'lblConsumer')

    // ✎ CORRECTED 2026-11-23 — WHAT THIS CASE USED TO ASSERT, AND WHY IT COULD
    // NOT PASS. It demanded that the post-restore seam read be a DIFFERENT
    // OBJECT from the pre-restore read (`postRead.some(v => v === preRead)`
    // must be false). That is wrong on two counts, and NEITHER is an engine
    // regression:
    //  (1) it is not the property `DESTROY-SHARED-LINK-RESIDUE` claims. The row
    //      is about WHICH GENERATION OWNS THE ANCHOR the read resolves; object
    //      allocation is a different question.
    //  (2) the in-process condense path cannot produce a fresh object at all:
    //      `condense()` stores `serializeSlice(...)` verbatim and
    //      `parseNodeState` keeps anchor `value`s BY REFERENCE, so the
    //      condensed base is a LIVE VIEW of the graph, not a document
    //      (`docs/defects.md` `CONDENSE-BASE-ALIASES-LIVE-GRAPH` — OPEN, filed
    //      separately, and the actual source of the old RED). Measured on this
    //      fixture: `postRead[0] === preRead` is TRUE even though the read is
    //      served by the RESTORED provider.
    // So the case is re-pointed at what the fix establishes — anchor ownership
    // by OBJECT IDENTITY (never by id: doc ids are re-seeded verbatim,
    // `serialize.ts:115`, so the restored prototype carries the VERY SAME id
    // string as the pre-base one — measured on this fixture in an isolated
    // probe run: provider anchor `source->node-4` before the restore and
    // `source->node-4` after it, two different objects; ids come from a module
    // counter, so the literal varies with this file's case order, the equality
    // does not. An id census cannot tell the generations apart, which is the
    // row's whole point), plus the pre-base residue assertion restated locally,
    // plus the value as a documented CONTROL that deliberately makes no
    // freshness claim.

    // The PRE-BASE read: the `content`-target seam delivers
    // `providerValueFromLink(link).content` — measured here as the object the
    // compiled state carries.
    const preStates = consumer0.compilePath().actionable
    expect(
      preStates.length,
      'FIXTURE: #lblConsumer must compile to exactly one state before the restore',
    ).toBe(1)
    const preRead = preStates[0]!.content
    expect(
      preRead,
      'FIXTURE: the `content`-target seam must DELIVER something before the restore (a null read would make the ownership check below vacuous)',
    ).toBeDefined()

    // THE PRE-BASE GENERATION, captured by OBJECT IDENTITY — the only
    // generation-distinct handle across a restore. Captured BEFORE `replay()`:
    // afterwards these same objects are evicted, and (ids being re-seeded
    // verbatim) their ids name the restored generation too.
    const preBasePrototypes = page.prototypes
    const preProviders = providerAnchors(page.hub, 'lbl')
    expect(
      preProviders.length,
      'FIXTURE: the hub-shared `lbl` Link carries exactly ONE `source`/`duplex` provider anchor before the restore (the def-child prototype\'s)',
    ).toBe(1)
    expect(
      preBasePrototypes,
      'FIXTURE: the pre-base provider is one of the minted PROTOTYPES (see DR-1a)',
    ).toContain(preProviders[0]!.owner as Node)

    await restoreOnce(page.sup, 'DR-1b')

    const consumer = requireAuthored(page.sup.allNodes(), 'lblConsumer')
    expect(
      consumer,
      'FIXTURE: the restore REPLACES the pre-base node objects — a stale reference would be the fixture, not the defect',
    ).not.toBe(consumer0)

    // Recompile: the seam re-reads the shared Link. The provider read is the
    // only way a `content`-target seam obtains its value, so this is the
    // strongest observable reachable through the compiled-state surface.
    const postStates = consumer.compilePath().actionable
    expect(postStates.length, 'FIXTURE: the restored #lblConsumer must compile to one state').toBe(1)
    const postRead = postStates.map((s) => s.content)
    const postBindings = postStates.flatMap((s) => Object.entries(s.bindings).map(([k, v]) => `${k}=${String(v)}`))
    // `getResolvedStates` is the non-draining view of the same pass-2 output the
    // renderer consumes — read too so the ownership verdict is not an artefact
    // of calling `compilePath` first (recorded, not asserted: the `content`
    // slot is the seam's delivery surface).
    page.sup.getResolvedStates(consumer.id)

    const link = page.hub.linkFor('lbl', 'component')
    const seamProviders = link.anchors.filter((a) => a.role === 'source' || a.role === 'duplex')
    const measuredAnchors = link.anchors.map((a) => `${a.role}->${(a.owner as Node | undefined)?.id ?? String(a.target)}`)

    // ---- (1) OWNERSHIP OF THE ANCHOR THE SEAM READ RESOLVES --------------
    expect(
      seamProviders.length,
      `DR-1b: the hub-shared \`lbl\` Link must carry exactly ONE \`source\`/\`duplex\` provider anchor after a restore — the RESTORED generation's. A second one is the pre-base residue \`DESTROY-SHARED-LINK-RESIDUE\` is about, and \`providerValueFromLink\` walks the Link in anchor order, so the first anchor wins. Measured anchors: ${JSON.stringify(measuredAnchors)}`,
    ).toBe(1)
    const seamOwner = seamProviders[0]!.owner as Node | undefined
    expect(seamOwner, 'FIXTURE: the `source` anchor the seam read resolves must have a node owner').toBeDefined()

    // The CURRENT generation = `this.nodes()` ∪ the def-prototype registry for
    // THIS hub (hub-filtered exactly like the condense census,
    // `supervisor.ts:957-960`). `allNodes()` alone is the wrong universe: a
    // restored def provider is registry-only BY THE PIN (`serialize.md:99-100`),
    // so requiring the owner in `allNodes()` would re-assert DR-2a's shape here.
    const livePrototypes = new Set<Node>()
    for (const [, protos] of defPrototypeEntries()) for (const p of protos) if (p.hubFor === page.hub) livePrototypes.add(p)
    for (const [, root] of defRootPrototypeEntries()) if (root.hubFor === page.hub) livePrototypes.add(root)
    const currentGeneration = new Set<Node>([...page.sup.allNodes(), ...livePrototypes])

    expect(
      preBasePrototypes.includes(seamOwner as Node),
      `DR-1b: the \`source\` anchor that the seam read resolves is still OWNED BY A PRE-BASE PROTOTYPE — the pre-base generation's provider anchor was never detached, so \`providerValueFromLink\` walks the dead generation first (the correctness half of the row: "the same order-dependence class as R-VPD-1"). Measured owner id: ${seamOwner?.id}; measured anchors: ${JSON.stringify(measuredAnchors)}`,
    ).toBe(false)

    expect(
      currentGeneration.has(seamOwner as Node),
      `DR-1b: the \`source\` anchor that the seam read resolves must be owned by a node of the RESTORED generation — by OBJECT IDENTITY in \`this.nodes()\` ∪ the hub's current def-prototype registry. Measured owner: id '${seamOwner?.id}', state '${seamOwner?.state}', in allNodes() ${page.sup.allNodes().includes(seamOwner as Node)}, in the hub's live def-prototype registry ${livePrototypes.has(seamOwner as Node)}. An ID IS NOT EVIDENCE ACROSS A RESTORE (doc ids are re-seeded verbatim, serialize.ts:115 — the pre-base and the restored prototype both read '${seamOwner?.id}'), which is why this is an identity check`,
    ).toBe(true)

    // ---- (2) NO PRE-BASE PROTOTYPE OWNS ANY ANCHOR ON THAT LINK ----------
    // The same residue assertion DR-1a makes, restated HERE so this case is
    // self-contained (a reader must not have to trust DR-1a's fixture for the
    // generation definition).
    const stale = link.anchors.filter((a) => a.owner !== undefined && preBasePrototypes.includes(a.owner as Node))
    expect(
      stale.map((a) => `${a.role}:${(a.owner as Node).id}`),
      `DR-1b (residue): an anchor of the hub-shared \`lbl\` Link is still owned by a PRE-BASE prototype (any role) — the eviction loop walks \`this.nodes\` only, and a registry-only prototype is absent from it, so \`destroy()\` never removes its name-keyed \`source\`/\`target\` anchors (node.ts:956-973). Measured anchors after the restore: ${JSON.stringify(measuredAnchors)}`,
    ).toEqual([])

    // ---- (3) VALUE CONTROL — deliberately NOT a freshness claim ----------
    // The seam read must still DELIVER the same VALUE after a restore (the
    // restored generation publishes the same authored `value`, so nothing may
    // null it out, swap it, or re-resolve it to a different def).
    // ⚠ THIS IS A STRUCTURAL CONTROL ON PURPOSE. Today the very same OBJECT
    // comes back, because `condense()` stores `serializeSlice(...)` and
    // `parseNodeState` keeps anchor `value`s BY REFERENCE — the base aliases
    // live state (`docs/defects.md` `CONDENSE-BASE-ALIASES-LIVE-GRAPH`, OPEN and
    // filed separately). A future fix of THAT row (a real document ⇒ fresh
    // objects per restore) legitimately changes the measured IDENTITY and
    // leaves this control green: that is not a regression in this case, and
    // this case must never be re-tightened into demanding — or forbidding —
    // object freshness.
    expect(
      postRead,
      `DR-1b (value control): the value the seam read delivers must be UNCHANGED by the restore (measured pre-restore ${JSON.stringify(preRead)}; measured post-restore ${JSON.stringify(postRead)}). Compared structurally — see the note above: object identity here is \`CONDENSE-BASE-ALIASES-LIVE-GRAPH\`, not a provider fact`,
    ).toEqual([preRead])

    // The `bindings` half (kept from the original case): no consumed binding
    // may reference the pre-base value object either — the same residue claim
    // on the other resolution path. (A `content`-target seam carries no
    // bindings today, so the FIXTURE below keeps this control non-vacuous.)
    expect
      .soft(
        postStates.some((s) => Object.values(s.bindings).some((v) => v === preRead)),
        'DR-1b (bindings): a consumed binding resolved to the pre-base generation value object',
      )
      .toBe(false)
    expect(
      postBindings,
      'FIXTURE: #lblConsumer is a `content`-target seam consumer — it resolves no bindings by construction (measured values recorded for the implementer)',
    ).toEqual([])
  })
})

// ============================================================================
// DR-2 — RESTORE-REGISTERS-PROTOTYPES
// ============================================================================

describe('DR-2 RESTORE-REGISTERS-PROTOTYPES — a restored graph must match the pinned allNodes() shape', () => {
  it('DR-2a plain prototypes are NOT in allNodes() after a restore; the in-tree half is complete', async () => {
    const page = buildDefPage()

    // FIXTURE — the pin's TRANSLATE-path shape (`serialize.md:99-100`): the host
    // registers the in-tree graph and nothing else.
    expect(
      page.prototypes.length,
      'FIXTURE: the `nav` def must mint its def-root + one def-child prototype',
    ).toBe(2)
    const preInTree = page.sup.allNodes()
    expect(
      preInTree.length,
      'FIXTURE: the pre-restore allNodes() must be exactly the registered in-tree nodes',
    ).toBe(3)
    for (const n of preInTree) {
      expect(n.state, 'FIXTURE: no registered pre-restore node may derive `prototype` (the pin)').not.toBe('prototype')
    }
    for (const p of page.prototypes) {
      expect(preInTree, 'FIXTURE: minted prototypes stay OUT of this.nodes on the translate path').not.toContain(p)
    }

    await restoreOnce(page.sup, 'DR-2a')

    const post = page.sup.allNodes()
    const postPrototypes = post.filter((n) => n.state === 'prototype')

    // ---- HALF 1 (RED today): the pinned shape -----------------------------
    // ⚠ CONTRACT NOTE FOR THE IMPLEMENTER (`serializer-census-gate-review` §3
    // item 3): this half encodes disposition (i) — SKIP prototypes at
    // `supervisor.ts:1050` so the restored graph matches the pin. The gate
    // allows (ii) instead: amend `serialize.md:99-100` (+ step 5 at `:93-97`)
    // to ADMIT them post-restore, and file the pass-2 divergence. Disposition
    // (ii) requires AMENDING THIS CASE in the same pass — it must never be
    // silently flipped/relaxed to green: either the pin holds, or the pin's
    // document and this case both change on the record.
    expect.soft(
      ids(post),
      `DR-2a: a restored graph contains PLAIN PROTOTYPES in this.nodes — _restoreBase seeds every loadState entry and registers ALL seeds (supervisor.ts:1047, :1050), so the restored shape contradicts the pin "plain prototypes stay out of this.nodes" (serialize.md:99-100). ` +
        `Measured: pre-restore in-tree ids ${JSON.stringify(ids(preInTree))}; post-restore allNodes() ids ${JSON.stringify(ids(post))}; nodes reading 'prototype' (${postPrototypes.length}): ${JSON.stringify(postPrototypes.map((n) => n.id))}`,
    ).toEqual(ids(preInTree))

    expect.soft(
      postPrototypes.map((n) => n.id),
      `DR-2a: the RESTORED graph must hold no plain prototype (measured ${postPrototypes.length} — every loadState seed is registered); the restore re-registers them via reRegisterDefPrototypes (serialize.ts:515-540), which is all the seam/rows-mint machinery needs — this.nodes membership is NOT required`,
    ).toEqual([])

    // ---- HALF 2 (GREEN today — must stay green either way) ---------------
    const postInTree = post.filter((n) => n.state === 'in-tree')
    expect(
      ids(postInTree),
      `DR-2a (positive half): the restored graph must keep every pre-restore in-tree node — same authored ids, same count. Measured: pre-restore ${JSON.stringify(ids(preInTree))} vs post-restore in-tree ${JSON.stringify(ids(postInTree))}`,
    ).toEqual(ids(preInTree))
    for (const cssId of ['app', 'defHost', 'lblConsumer']) {
      expect(
        authoredIn(post, cssId),
        `DR-2a (positive half): the restored in-tree graph must still resolve #${cssId}`,
      ).toBeDefined()
    }
  })
})

// ============================================================================
// DR-3 — RESTORE-PLACED-CONTENT-MEMBERSHIP
// ============================================================================
//
// The page: `div#app > section#host` plus a `content: [...]` payload whose root
// is `section#slot` (token-parented ⇒ content-owned + 'in-tree' at translate).
// The host then PLACES it — `refreshPayload(payload, [slot], host)` — which
// unregisters→detaches→re-registers the root as content and attaches it under
// the REAL family parent `#host`, destroying the `'contentNodes'` placeholder
// edge (`node.ts:1022-1023`).
//
// ⚠ WHY `refreshPayload` AND NOT `apply({kind:'attach', …})`: the managed
// `attach` op REQUIRES a node with no `child` anchor (`supervisor.ts:1409-1413`
// → `SingleParentError`), and a token-parented payload root always has one —
// measured today as `{status:'rejected', error:{code:'single-parent'}}`.
// `payload.ts`'s `refreshPayload` is the documented host API for this placement
// (`tests/e2e/payload-refresh.test.ts:79`), so DR-3 uses it and says so.
function placedContentPage(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'app' },
        props: { id: 'app' },
        children: [{ type: 'section', css: { id: 'host' }, props: { id: 'host' } }],
      },
    },
    content: [{ content: [{ type: 'section', css: { id: 'slot' }, props: { id: 'slot' } }] }],
    clientConfig: CLIENT_CONFIG,
  } as unknown as LegacyInitialData
}

interface PlacedPage {
  sup: Supervisor
  tree: TranslatedTree
  slot: Node
  host: Node
}

/** Builds the page and PLACES the payload root under `#host` (the precondition
 *  every DR-3 case asserts before it does anything else). */
function buildPlacedPage(): PlacedPage {
  const hub = createLinkHub()
  const tree = translateLegacy(placedContentPage(), { hub })
  const sup = new Supervisor({ hub, maxJournalLength: MAX_JOURNAL_LENGTH })
  for (const n of tree.nodes) sup.registerNode(n)
  const slot = requireAuthored(sup.allNodes(), 'slot')
  const host = requireAuthored(sup.allNodes(), 'host')
  const payload: Payload = { id: 'placed', roots: [slot] }
  refreshPayload(payload, [slot], host)
  return { sup, tree, slot, host }
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

/** The shared DR-3 shape: detach the sentinel + the placed content root, settle
 *  the sweep, and return the two verdicts (the assertions live in the cases). */
async function detachBothAndSettleSweep(sup: Supervisor, contentRoot: Node): Promise<{ sentinel: Node; sentinelDestroyed: boolean; contentDestroyed: boolean; state: string }> {
  const sentinel = sweepSentinel('sweep-sentinel')
  sup.registerNode(sentinel)
  expect(
    sup.apply({ kind: 'detach', node: sentinel }).status,
    'FIXTURE: detaching the sweep sentinel is a sanctioned applied op',
  ).toBe('applied')
  expect(sentinel.state, "FIXTURE: the detached sentinel must not read 'in-tree'").not.toBe('in-tree')

  expect(
    sup.apply({ kind: 'detach', node: contentRoot }).status,
    'FIXTURE: detaching the placed content root off its family edge is a sanctioned applied op',
  ).toBe('applied')
  expect(
    contentRoot.state,
    "FIXTURE: the detached content root must leave 'in-tree' — that is what makes the sweep, not the state, the decider",
  ).not.toBe('in-tree')

  await settleSweep()
  return { sentinel, sentinelDestroyed: sentinel.destroyed, contentDestroyed: contentRoot.destroyed, state: contentRoot.state }
}

describe('DR-3 RESTORE-PLACED-CONTENT-MEMBERSHIP — a restored PLACED content root must keep its sweep exemption', () => {
  it('DR-3a/DR-3b a placed content root keeps contentNodes membership across a restore and survives the sweep', async () => {
    const page = buildPlacedPage()

    // FIXTURE — the placement really happened: content-owned, family-parented
    // under #host, and the `'contentNodes'` token edge is gone (a token-parented
    // root reports `parent === null`).
    expect(
      isContentNode(page.slot),
      'FIXTURE: refreshPayload re-registers the placed root as payload-owned content',
    ).toBe(true)
    expect(page.slot.state, 'FIXTURE: the placed root is family-in-tree via #host').toBe('in-tree')
    expect(page.slot.parent, 'FIXTURE: the placed root must be attached under a REAL family parent (#host)').toBe(page.host)

    await restoreOnce(page.sup, 'DR-3')

    const slot = requireAuthored(page.sup.allNodes(), 'slot')
    expect(slot, 'FIXTURE: the restore REPLACES the pre-base node objects').not.toBe(page.slot)
    expect(
      slot.state,
      "FIXTURE: the restored placed root is still family-in-tree via #host, so `state` alone still reads 'in-tree' — the membership loss is LATENT",
    ).toBe('in-tree')
    expect(
      slot.parent,
      'FIXTURE: the restored placed root must still resolve its REAL family parent (#host) — that is the edge the document records',
    ).toBe(authoredIn(page.sup.allNodes(), 'host'))

    // ---- HALF 1 (RED today) ---------------------------------------------
    expect.soft(
      isContentNode(slot),
      "DR-3a: a restored PLACED content root LOST its contentNodes membership — the landing restore detector keys on a family parent anchor targeting the 'contentNodes' TOKEN (supervisor.ts:1061-1065), but addAnchor DESTROYED that placeholder edge when the real family parent superseded it (node.ts:1022-1023) and the document records only the real parent, so a placed content root comes back byte-indistinguishable from an authored tree node. `state === 'in-tree'` is the only thing keeping it alive; once it leaves the tree it is finalized where it used to persist",
    ).toBe(true)

    // ---- HALF 2 (RED today) — the behavioural consequence ---------------
    const verdict = await detachBothAndSettleSweep(page.sup, slot)
    expect(
      verdict.sentinelDestroyed,
      'FIXTURE: the sweep must have RUN in this window — the sentinel is neither content-owned nor in-tree, so a "survived" reading below would otherwise be vacuous',
    ).toBe(true)
    expect.soft(
      verdict.contentDestroyed,
      `DR-3b: the restored placed content root was FINALIZED by the sweep after leaving the tree (state '${verdict.state}') — its contentNodes membership was lost by the restore, so "payload-owned content persists (placement may return)" no longer holds for PLACED content (it holds for token-parented content only, the closed RESTORE-INTEGRITY (a))`,
    ).toBe(false)
    expect.soft(
      page.sup.allNodes().some((n) => n.id === slot.id),
      'DR-3b: the restored placed content root was EVICTED from the supervisor, not merely flagged',
    ).toBe(true)

    // NOT ASSERTED DELIBERATELY: the emit-side consequence. `RenderNodeState.state`
    // is a hardcoded 'in-tree' at emit (serialize.ts:116), so whether the fixed
    // document carries an `isContentRoot?: true` boolean field (the gate's §3
    // item 2 contract) is the implementer's contract change. This case asserts
    // the OBSERVABLE BEHAVIOUR only: membership restored ⇒ the root survives.
  })

  it('DR-3c (CONTROL, green today) without a restore the same detach leaves the placed content root alive', async () => {
    const page = buildPlacedPage()
    expect(isContentNode(page.slot), 'FIXTURE: content-owned before the detach').toBe(true)

    const verdict = await detachBothAndSettleSweep(page.sup, page.slot)

    expect(verdict.sentinelDestroyed, 'FIXTURE: the sweep must have RUN in this window').toBe(true)
    expect(
      verdict.contentDestroyed,
      'DR-3c (CONTROL): a PLACED, payload-owned content root must persist while unplaced ("placement may return") — this is the semantics DR-3b restores; a fix must not change it',
    ).toBe(false)
    expect(
      page.sup.allNodes().some((n) => n.id === page.slot.id),
      'DR-3c (CONTROL): the placed content root stays in the supervisor while unplaced',
    ).toBe(true)
  })
})
