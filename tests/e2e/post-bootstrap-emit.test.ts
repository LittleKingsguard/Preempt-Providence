/**
 * E2E — `POST-BOOTSTRAP-EMIT-DROP` (`docs/defects.md`; RCA
 * `archive/reviews/2026-11-23/2026-11-23-post-bootstrap-emit-drop-rca.md`;
 * arm `docs/handoffs-arm-modularity-2026-11-23.md`; canonical construction
 * `docs/probes/post-bootstrap-emit-drop.mjs`).
 *
 * THE READING: an authored, content-bearing, PLACEMENT-ROUTED tree bootstraps
 * (the host's `compilePath` branch) → the SSR document is the authored one
 * (root + holder + card, 180 chars). Then the FIRST sanctioned post-bootstrap
 * structural change — `registerNode(extra)` → `detach(extra)` → `attach(extra →
 * #filler)` — and the document is **EMPTY** (0 chars).
 *
 * THE MECHANISM (pinned by the RCA, NOT by these assertions): the post-bootstrap
 * pass-2 flush plain-compiles the dirty node's focused slice — the ancestor
 * chain to the root included (`supervisor.ts` `runPass2AndFlush`) — so the
 * ancestors' states are replaced by FAMILY states (`makeCs`: `pathKey` but no
 * `forkKey`) while the bootstrap minted PATH states (`forkKey === pathKey`).
 * `isPathState` keys the wire off exactly that field, so the same elements move
 * from their bootstrap PATH wires (`root`, `root/node-3`) to their NODE-ID wires
 * (`node-1`, `node-3`), and the `SSRFragmentAdapter`'s `rootKey` — captured on
 * the first `createEl` and never reset — matches no fragment.
 *
 * WHAT THIS FILE ASSERTS: the INVARIANTS a reader of the contract can rely on,
 * never the mechanism — no case reads `makeCs`, `isPathState`, `forkKey`-minting
 * internals or the internal op sequence, and no case asserts a `forkKey`/state
 * shape (the emit layer's public domain signal `forkKey === wire` is the only
 * path-domain reading used; `Supervisor`, `apply`, `flush`, `takePass2States`,
 * `recordResolved`, `undo`/`replay`, `renderProducingProcess`, the adapters and
 * `translateLegacy` are the whole surface).
 *
 * **PBED-1..4 are stance-NEUTRAL — and that is exactly why the fix gate
 * (`docs/specs/post-bootstrap-emit-drop-fix-review.md` §8 "Pricing note") ruled
 * them INSUFFICIENT AS WRITTEN:** all four PASS under the owner's stance (A)
 * read as a BAN ("a family compile must not re-key a node holding a path
 * state"), because refusing the family compile freezes the ancestors — the
 * document stops changing instead of changing wrongly — and PBED-3 iterates only
 * nodes present in BOTH renders, so it cannot see the new node at all.
 *
 * **PBED-5..10 are the gate's §8 Phase-1 cases (P-1..P-6)** and they are the
 * ones that SELECT the mechanism: the append half (a refusal never appends the
 * new child), the refresh-channel CONTROL (a refusal silently freezes every
 * non-placement node), the strong domain rule applied to NEW nodes, Z1 (the
 * condensed base restored), Z2 (a drain-only host) and the
 * `ORPHAN-EMIT-TOP-LEVEL-LEAK` scenario that a refusal makes permanent. A fix
 * that only re-greens PBED-1..4 is not the sanctioned fix.
 *
 *  - **PBED-1** the document survives: the html stays non-empty and still
 *    carries the authored content (the root's id, the holder, the card).
 *  - **PBED-2** the root's wire is STABLE: the wire the root element is
 *    created/emitted on is the same before and after the change (`root`; it
 *    must never become the root's node-id wire), and the diff handed to the
 *    adapter neither removes the root's wire nor re-creates the root under its
 *    node id.
 *  - **PBED-3** the document is not silently MIXED-DOMAIN: no element that
 *    emitted on a path wire at bootstrap may re-emit on a node-id wire, and a
 *    node whose position the op sequence does not touch keeps its wire
 *    (placement-path-spec §4.1 wire stability — this breaks with ZERO topology
 *    change to that node).
 *  - **PBED-4** the identical loss on `MarkdownAdapter`, which carries the same
 *    never-recomputed `rootKey` shape (FRG-H24 class).
 *  - **PBED-5** (gate P-1, THE STANCE SELECTOR) the change is an APPEND: exactly
 *    one `append` op from the host's wire to the new node's wire, and the
 *    document shows the new element INSIDE its host (not as a sibling after the
 *    root). A refusal keeps the host's mint-time `childOrder` and never appends.
 *  - **PBED-6** (gate P-2, the CONTROL) a post-bootstrap `state-slice` write on a
 *    NON-placement node (the root) still reaches emit. DELIBERATELY GREEN TODAY;
 *    it turns red under a "refuse the family compile" fix, i.e. it catches
 *    OVERSHOOT.
 *  - **PBED-7** (gate P-3) the strong domain rule: every wire after the change is
 *    a bootstrap wire, or a PATH-domain wire — applied to the NEW node as well.
 *    No diagnostic channel exists for the other admissible branch.
 *  - **PBED-8** (gate P-4, Z1) condense past `maxJournalLength` → `undo()` to the
 *    base → the root still emits on `root` and the document is not empty; plus
 *    the `replay()`/`_restoreBase` leg a per-`Node` carrier dies on.
 *  - **PBED-9** (gate P-5, Z2) a host whose live map is REPLACED by each
 *    `takePass2States()` drain still emits the root.
 *  - **PBED-10** (gate P-6) the `ORPHAN-EMIT-TOP-LEVEL-LEAK` scenario: a
 *    `placement-attach` into a FAMILY-routed container must still APPEND the
 *    added node instead of serializing it as a detached top-level sibling.
 *
 * RED FIRST (AGENTS.md item 8): written before any fix, against a tree where
 * the defect is live. No `src/**` change accompanies this file.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import { translateLegacy, createLinkHub, type LegacyInitialData, type TranslatedTree } from '../../src/core/translate.js'
// `isPathState` — PBED-14 only: the engine's own state-domain predicate, used
// as the fixture's "did the bootstrap and the declared mode AGREE?" read (the
// file's PBED-1..13 cases deliberately do NOT read state shapes; see the header).
import { renderProducingProcess, treeFromOps, isPathState } from '../../src/core/render-helpers.js'
import { SSRFragmentAdapter, MarkdownAdapter } from '../../src/core/adapters.js'
import type { MinimalElement, RenderAdapter, RenderOp } from '../../src/core/render.js'
import type { CompiledState, NodeRef } from '../../src/core/types.js'

// ============================================================================
// The host recipe (the documented renderer shape, mirrored from
// docs/probes/post-bootstrap-emit-drop.mjs §"the host recipe"): the host OWNS
// the per-tree `prevMap` + the live per-node state map; bootstrap = one
// `compilePath` pass per translated node; every later render merges the
// supervisor's settled pass-2 states, then emit → diff → apply.
// ============================================================================

/** The managed channel's apply outcome (the `status` the host reports on). */
type ApplyOutcome = ReturnType<Supervisor['apply']>

interface HostSeries {
  /** the renderer's live state map: nodeId → that node's current states. */
  prevStates: Map<string, CompiledState[]>
  /** the diff baseline the last render produced (`null` on the first render). */
  prevMap: Map<NodeRef, MinimalElement> | null
}

/** The placement-routed bootstrap branch of the host recipe: a tree that
 *  carries `content` anchors is enumerated through `compilePath` (path states),
 *  never `root.compile` (family states). Recorded as the host's live states and
 *  mirrored into the supervisor's non-draining resolved store. */
function bootstrapStates(sup: Supervisor, nodes: Node[]): Map<string, CompiledState[]> {
  const actionable: CompiledState[] = []
  for (const n of nodes) actionable.push(...n.compilePath().actionable)
  const grouped = new Map<string, CompiledState[]>()
  for (const s of actionable) {
    const arr = grouped.get(s.nodeId) ?? []
    arr.push(s)
    grouped.set(s.nodeId, arr)
  }
  const prevStates = new Map<string, CompiledState[]>()
  for (const [id, arr] of grouped) if (sup.getNode(id)?.isInTree) prevStates.set(id, arr)
  sup.recordResolved(actionable)
  return prevStates
}

/** Merge the supervisor's settled pass-2 states into the host's live map (the
 *  host recipe's post-bootstrap half — in-tree nodes only). */
function mergePass2(sup: Supervisor, prevStates: Map<string, CompiledState[]>): void {
  for (const [id, arr] of sup.takePass2States()) if (sup.getNode(id)?.isInTree) prevStates.set(id, arr)
}

/**
 * The **FAMILY**-mode half of the same host recipe (PBED-12): a family-mode
 * supervisor is bootstrapped by ONE family compile over the whole slice —
 * `translated.root.compile(translated.nodes)` → `recordResolved`, the recipe
 * every family-bootstrapped demo runs (`demo/producing-host.js:156`,
 * `demo/feature-showcase.js:333`, `demo/hooks-scenarios.js:279`).
 *
 * It is NOT interchangeable with `bootstrapStates` above: that one bootstraps
 * through `compilePath` (the PATH domain), which under an EXPLICIT
 * `compileMode: 'family'` is not re-derived by pass-2 — the tree is left
 * mixed-domain and every authored element is re-keyed to a family wire
 * (`POST-BOOTSTRAP-EMIT-DROP`, pinned by PBED-1..9). PBED-12 measures the
 * family-mode ORPHAN, so it needs the honest family document: one tree, one
 * root, and the graft as its only unclaimed sibling.
 */
function familyBootstrapStates(sup: Supervisor, tree: TranslatedTree): Map<string, CompiledState[]> {
  const cr = tree.root.compile(tree.nodes)
  const grouped = new Map<string, CompiledState[]>()
  for (const s of cr.actionable) {
    const arr = grouped.get(s.nodeId) ?? []
    arr.push(s)
    grouped.set(s.nodeId, arr)
  }
  const prevStates = new Map<string, CompiledState[]>()
  for (const [id, arr] of grouped) if (sup.getNode(id)?.isInTree) prevStates.set(id, arr)
  sup.recordResolved(cr.actionable)
  return prevStates
}

/** One render pass: emit the live states → diff against the host's `prevMap` →
 *  apply to the adapter → read the document back through `toString()`. */
function renderPass<P, E>(
  sup: Supervisor,
  adapter: RenderAdapter<P, E> & { toString(): string },
  series: HostSeries,
): { els: MinimalElement[]; ops: RenderOp[]; html: string } {
  const actionable: CompiledState[] = []
  for (const states of series.prevStates.values()) actionable.push(...states)
  const nodeBy = new Map<string, Node>(sup.allNodes().map((n): [string, Node] => [n.id, n]))
  const out = renderProducingProcess(actionable, nodeBy, adapter, series.prevMap, { nodeIdAttribute: true })
  series.prevMap = out.prevMap
  return { els: out.els, ops: out.ops, html: adapter.toString() }
}

// ============================================================================
// The arm's envelope (handoffs §2 — the decisive detail is `#card`)
// ============================================================================

/**
 * `div#root` with two children — `aside#holder`, a placement PRODUCER
 * (`placementName: 'zone'`), and `div#filler`, a plain FAMILY child — plus ONE
 * authored, content-bearing, PLACEMENT-ROUTED consumer as `template.children[]`:
 * `div#card` with `targetPlacement: ['zone']`.
 *
 * The consumer is what makes the tree bootstrap through `compilePath`; `#filler`
 * is the FAMILY child the post-bootstrap change attaches onto. That mix is the
 * construction the RCA reproduced (and the consumer's arm handed over).
 *
 * `cardText` adds an AUTHORED text body. It is needed only by the
 * `MarkdownAdapter` arm: markdown has no element/id surface, so an id-bearing
 * but text-less envelope renders as `''` in BOTH renders and could not show a
 * loss.
 *
 * `fillerRouted` (PBED-12e ONLY — opt-in, every other case keeps the envelope
 * above byte-identical) gives `#filler` a `targetPlacement`, i.e. a `content`
 * anchor: the container then IS placement-routed and its pass-2 compile is
 * `compilePath` (`supervisor.ts` `runPass2AndFlush`: `placementRouted ? …`).
 * NOTE: `placementName` alone does NOT do this — it mints the PRODUCER
 * (`container`) anchor, which is what `#holder` carries; the consumer side is
 * `targetPlacement` → a `content` anchor (`translate.ts:1036` vs `:1078`).
 */
function placementEnvelope(opts: { cardText?: string; fillerRouted?: boolean } = {}): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        children: [
          { type: 'aside', css: { id: 'holder' }, props: { id: 'holder' }, placement: { placementName: 'zone' } },
          {
            type: 'div',
            css: { id: 'filler' },
            props: { id: 'filler' },
            ...(opts.fillerRouted ? { placement: { targetPlacement: ['zone'] } } : {}),
          },
        ],
      },
      children: [
        {
          type: 'div',
          css: { id: 'card' },
          props: { id: 'card' },
          ...(opts.cardText !== undefined ? { content: opts.cardText } : {}),
          placement: { targetPlacement: ['zone'] },
        },
      ],
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

interface Fixture {
  sup: Supervisor
  tree: TranslatedTree
  /** authored-id lookups (node ids are translate-minted, so never hard-coded). */
  root: Node
  holder: Node
  filler: Node
  card: Node
}

function fixture(opts: {
  cardText?: string
  maxJournalLength?: number
  sharedHub?: boolean
  /** PBED-12: DECLARE the tree's compile mode (`Supervisor({ compileMode })`).
   *  Absent ⇒ the shipped default — the mode is then INFERRED from the
   *  bootstrap states (`supervisor.ts` `recordResolved`, which flips a
   *  path-bootstrapped tree to `path`), which is what PBED-1..11 run under. */
  compileMode?: 'family' | 'path'
  /** PBED-12e: give `#filler` a `content` anchor (see `placementEnvelope`). */
  fillerRouted?: boolean
} = {}): Fixture {
  // `sharedHub` gives the SUPERVISOR the tree's own `LinkConfigNameHub` — the
  // documented host shape (`createLinkHub` is the public same-name shared-Link
  // factory; idiom: tests/unit/journal-condensing.test.ts `makeSupervisor`).
  // It is required only by the condensed-base restore path (`_restoreBase`
  // re-seeds through the hub and bails out with the graph already evicted when
  // the supervisor holds none), so it stays OPT-IN and PBED-1..4 keep the
  // hub-less host they were written against.
  const hub = opts.sharedHub ? createLinkHub() : undefined
  const tree = translateLegacy(placementEnvelope(opts), hub ? { hub } : undefined)
  const authored = (cssId: string): Node => {
    const n = tree.nodes.find((x) => x.css?.id === cssId || x.props?.id === cssId)
    if (!n) throw new Error(`fixture: the envelope has no #${cssId} node`)
    return n
  }
  // `maxJournalLength` is the public condense trigger (`docs/specs/ops.md` §6;
  // idiom: tests/unit/journal-condensing.test.ts). Absent ⇒ never condenses —
  // exactly the shipped default the other cases run under.
  const sup = new Supervisor({
    ...(hub ? { hub } : {}),
    ...(opts.maxJournalLength !== undefined ? { maxJournalLength: opts.maxJournalLength } : {}),
    ...(opts.compileMode !== undefined ? { compileMode: opts.compileMode } : {}),
  })
  for (const n of tree.nodes) sup.registerNode(n)
  return { sup, tree, root: tree.root, holder: authored('holder'), filler: authored('filler'), card: authored('card') }
}

/**
 * THE SANCTIONED FIRST POST-BOOTSTRAP STRUCTURAL CHANGE (handoffs §3, the
 * corrected recipe): a freshly translated node carries its own child
 * owner-token anchor, and `attach` rejects a single-parent node — so the
 * sanctioned sequence is register → detach → attach onto the family child
 * `#filler`. `attach`/`detach` are the public managed channel;
 * everything the supervisor does after them (the pass-2 flush) is the engine's
 * own settled path — no in-test focused-compile recipe is replayed here.
 */
function attachOntoFiller(
  sup: Supervisor,
  filler: Node,
): { extra: Node; detach: ApplyOutcome; attach: ApplyOutcome } {
  const extraTree = translateLegacy({
    template: { root: { type: 'span', props: { id: 'extra' } } },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  })
  const extra = extraTree.root
  sup.registerNode(extra)
  const detach = sup.apply({ kind: 'detach', node: extra })
  const attach = sup.apply({ kind: 'attach', node: extra, to: filler })
  return { extra, detach, attach }
}

// ============================================================================
// Reading the emitted document (public surfaces only)
// ============================================================================

/** The emitted element per NODE: every element carries the opt-in
 *  `data:node-id` prop (`renderProducingProcess(…, { nodeIdAttribute: true })`),
 *  which is also what appears in the html. */
function byNodeId(els: MinimalElement[]): Map<string, MinimalElement> {
  const m = new Map<string, MinimalElement>()
  for (const el of els) {
    const id = el.props['data:node-id']
    if (typeof id === 'string') m.set(id, el)
  }
  return m
}

/**
 * The emit layer's two wire DOMAINS, read off the emitted element itself
 * (`render-helpers.ts` `pathWireOf`/`isPathState`): a PATH-domain element
 * carries `forkKey === wire` (it was minted as a path state and emits on its
 * pathKey); a NODE-ID-domain element carries no forkKey (a plain family state).
 * This is a public property of the element, not a compile-mode probe.
 */
function isPathDomain(el: MinimalElement): boolean {
  return el.forkKey !== undefined && el.forkKey === el.wire
}

function removeWires(ops: RenderOp[]): NodeRef[] {
  return ops.flatMap((o) => (o.kind === 'remove' ? [o.wire] : []))
}

function createWires(ops: RenderOp[]): NodeRef[] {
  return ops.flatMap((o) => (o.kind === 'create' ? [o.wire] : []))
}

/** The `append` ops of one diff as plain owner/child pairs (`render.ts` §10.3
 *  structure pass: an append is emitted for a child created this pass or whose
 *  order changed). Owner/child only — the pair IS the pin, and it is the only
 *  public reading that tells "assembled into the host" from "created and never
 *  appended" (`ORPHAN-EMIT-TOP-LEVEL-LEAK`). */
function appendPairs(ops: RenderOp[]): Array<{ owner: NodeRef; child: NodeRef }> {
  return ops.flatMap((o) => (o.kind === 'append' ? [{ owner: o.owner, child: o.child }] : []))
}

/**
 * The html slice of the element carrying the authored `id`, from its opening tag
 * to its matching close tag (same-tag depth counted, so a nested element of the
 * same tag never truncates the slice). A text marker alone cannot tell a child
 * assembled INSIDE its host from a fragment that was created, never appended,
 * and therefore serialized top-level (`adapters.ts` `toString`'s `floating`
 * branch) — which is exactly the difference PBED-5 and PBED-10 pin.
 */
function outerHtmlOfAuthoredId(html: string, cssId: string): string | undefined {
  const marker = `id="${cssId}"`
  const at = html.indexOf(marker)
  if (at === -1) return undefined
  const openAt = html.lastIndexOf('<', at)
  if (openAt === -1) return undefined
  const tag = /^<([\w-]+)/.exec(html.slice(openAt))?.[1]
  if (!tag) return undefined
  const open = new RegExp(`<${tag}(?=[\\s>])`, 'g')
  const close = new RegExp(`</${tag}>`, 'g')
  let depth = 0
  let i = openAt
  while (i < html.length) {
    open.lastIndex = i
    close.lastIndex = i
    const nextOpen = open.exec(html)
    const nextClose = close.exec(html)
    if (!nextClose) return undefined // unbalanced — not a document we can read
    if (nextOpen && nextOpen.index < nextClose.index) {
      depth += 1
      i = nextOpen.index + 1
    } else {
      depth -= 1
      if (depth === 0) return html.slice(openAt, nextClose.index + nextClose[0].length)
      i = nextClose.index + 1
    }
  }
  return undefined
}

/** A node looked up by its authored id among a LIVE node set — needed after a
 *  graph-REPLACE restore (`replay()` → `_restoreBase`), which replaces the
 *  pre-base node objects, so the fixture's translate-time lookups are stale and
 *  the minted ids are new. Public surface only (the node's own `css`/`props`). */
function byAuthoredId(nodes: Node[], cssId: string): Node | undefined {
  return nodes.find((n) => n.css?.id === cssId || n.props?.id === cssId)
}

/** A freshly translated placement CONSUMER (`targetPlacement` only — it never
 *  produces a zone): the node a `placement-attach` adds to a container. */
function consumerNode(cssId: string): Node {
  return translateLegacy({
    template: { root: { type: 'span', props: { id: cssId } } },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }).root
}

/** Two macrotask turns — enough for the supervisor's DEFERRED condense
 *  (`supervisor.ts` `scheduleCondense`, a `setTimeout(0)`) to run. Idiom
 *  reused from `tests/unit/journal-condensing.test.ts` (`flushCondense`). */
async function flushCondense(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// ============================================================================
// PBED-1 — the document survives
// ============================================================================

describe('POST-BOOTSTRAP-EMIT-DROP — a post-bootstrap structural change must not re-key a path-bootstrapped document', () => {
  it('PBED-1 the authored document survives the first sanctioned structural change (root + holder + card still emit)', async () => {
    const { sup, tree, root, holder, filler, card } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    // ---- R1: bootstrap (compilePath) — the baseline the defect loses --------
    const boot = renderPass(sup, adapter, series)
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')
    expect(boot.html, 'FIXTURE: the root must be in the bootstrap document').toContain('id="root"')
    expect(boot.html, 'FIXTURE: the holder must be in the bootstrap document').toContain('id="holder"')
    expect(boot.html, 'FIXTURE: the card must be in the bootstrap document').toContain('id="card"')

    // ---- the sanctioned change, then the engine's own settled flush --------
    const { detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status, 'FIXTURE: detach(extra) is a sanctioned applied op').toBe('applied')
    expect(attach.status, 'FIXTURE: attach(extra → #filler) is a sanctioned applied op').toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)

    // ---- R2: the first post-bootstrap render ------------------------------
    const post = renderPass(sup, adapter, series)
    expect(
      post.html,
      `the SSR document was ZEROED by one sanctioned structural change (attach #extra onto #filler): bootstrap html was ${boot.html.length} chars, after the change it is ${post.html.length}`,
    ).not.toBe('')
    expect(post.html, 'the ROOT stopped emitting after the post-bootstrap change').toContain('id="root"')
    expect(post.html, 'the HOLDER stopped emitting after the post-bootstrap change').toContain('id="holder"')
    expect(post.html, 'the CARD stopped emitting after the post-bootstrap change').toContain('id="card"')
    // the authored content is the same document, assembled through the root
    expect(post.html).toContain(`data-node-id="${root.id}"`)
    expect(post.html).toContain(`data-node-id="${holder.id}"`)
    expect(post.html).toContain(`data-node-id="${card.id}"`)
  })

  // ==========================================================================
  // PBED-2 — the root's wire is stable
  // ==========================================================================

  it('PBED-2 the root keeps its bootstrap wire ("root") — never removed under it and re-created under its node-id wire', async () => {
    const { sup, tree, root, filler } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    const bootRoot = byNodeId(boot.els).get(root.id)
    expect(bootRoot, 'FIXTURE: the root must emit at bootstrap').toBeDefined()
    expect(bootRoot!.wire, 'FIXTURE: the bootstrap root emits on the conventional path wire "root"').toBe('root')

    const { detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status).toBe('applied')
    expect(attach.status).toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)
    const post = renderPass(sup, adapter, series)

    // (a) the same element is still emitted — and still on the SAME wire
    const postRoot = byNodeId(post.els).get(root.id)
    expect(postRoot, 'the root element stopped emitting after the change').toBeDefined()
    expect(
      postRoot!.wire,
      `the ROOT's wire moved across the post-bootstrap change (node ${root.id}): the whole document is assembled through this wire`,
    ).toBe(bootRoot!.wire)

    // (b) the adapter was never told to drop the root's wire…
    expect(
      removeWires(post.ops),
      'the diff REMOVED the root under its bootstrap wire — the adapter\'s captured rootKey then matches nothing',
    ).not.toContain(bootRoot!.wire)
    // (c) …and the root was never re-created under its node-id wire
    expect(
      createWires(post.ops),
      `the root was RE-CREATED under its node-id wire (${root.id}) instead of being re-emitted on "${String(bootRoot!.wire)}"`,
    ).not.toContain(root.id)
  })

  // ==========================================================================
  // PBED-3 — the document is not silently mixed-domain
  // ==========================================================================

  it('PBED-3 no element that emitted on a PATH wire at bootstrap re-emits on a NODE-ID wire (no mixed-domain document)', async () => {
    const { sup, tree, root, holder, filler, card } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    const bootById = byNodeId(boot.els)
    // FIXTURE: the whole bootstrap document is PATH-domain (the placement-routed
    // branch minted path states for every node — the domain the adapter's
    // rootKey is captured in)
    expect(
      [...bootById.values()].filter(isPathDomain),
      'FIXTURE: every bootstrap element must emit on a path wire (compilePath branch)',
    ).toHaveLength(boot.els.length)

    const { detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status).toBe('applied')
    expect(attach.status).toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)
    const post = renderPass(sup, adapter, series)
    const postById = byNodeId(post.els)

    // (a) NO silent domain flip: an element that emitted on a path wire at
    // bootstrap must not re-emit on a node-id wire
    const flipped: Array<{ nodeId: string; from: NodeRef; to: NodeRef }> = []
    for (const [nodeId, el] of bootById) {
      const after = postById.get(nodeId)
      if (!after) continue
      if (!isPathDomain(after)) flipped.push({ nodeId, from: el.wire, to: after.wire })
    }
    expect(
      flipped,
      'element(s) that emitted on a PATH wire at bootstrap re-emitted on a NODE-ID wire — the document is silently mixed-domain',
    ).toEqual([])

    // (b) wire stability for the nodes this op sequence does NOT move: the
    // attach adds a child to #filler; it does not relocate the root, the holder
    // or the card (placement-path-spec §4.1: wire identity is stable across
    // renders while a node's topology is unchanged)
    for (const n of [root, holder, card]) {
      const label = (n.css?.id as string | undefined) ?? n.id
      const after = postById.get(n.id)
      expect(after, `#${label} stopped emitting after the change`).toBeDefined()
      expect(
        after!.wire,
        `#${label} was re-keyed by a change that does not touch its position (wire stability, placement-path-spec §4.1)`,
      ).toBe(bootById.get(n.id)!.wire)
    }
  })

  // ==========================================================================
  // PBED-4 — the same document on MarkdownAdapter (identical `rootKey` shape)
  // ==========================================================================

  it('PBED-4 the same document survives on MarkdownAdapter (identical, never-recomputed rootKey — FRG-H24 shape)', async () => {
    const { sup, tree, filler } = fixture({ cardText: 'card body' })
    const adapter = new MarkdownAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    expect(boot.html, 'FIXTURE: the bootstrap markdown must carry the card\'s authored text').toContain('card body')

    const { detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status).toBe('applied')
    expect(attach.status).toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)
    const post = renderPass(sup, adapter, series)

    expect(
      post.html,
      `the markdown document was ZEROED by one sanctioned structural change (bootstrap: ${JSON.stringify(boot.html)}; after: ${JSON.stringify(post.html)})`,
    ).toContain('card body')
  })

  // ==========================================================================
  // PBED-5 — the APPEND half (gate §8 P-1) — THE STANCE SELECTOR
  // ==========================================================================

  it('PBED-5 the change is an APPEND into the host: exactly one append (#filler → the new node) and the new element sits INSIDE #filler', async () => {
    const { sup, tree, root, filler } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    // ---- R1: bootstrap — the host's wire and the document's entry ----------
    const boot = renderPass(sup, adapter, series)
    const bootById = byNodeId(boot.els)
    const hostWire = bootById.get(filler.id)?.wire
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')
    expect(hostWire, 'FIXTURE: #filler must emit at bootstrap').toBeDefined()
    expect(bootById.get(root.id)?.wire, 'FIXTURE: the bootstrap root emits on the conventional path wire "root"').toBe('root')

    // ---- the sanctioned change, then the engine's own settled flush --------
    const { extra, detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status, 'FIXTURE: detach(extra) is a sanctioned applied op').toBe('applied')
    expect(attach.status, 'FIXTURE: attach(extra → #filler) is a sanctioned applied op').toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)

    const post = renderPass(sup, adapter, series)
    const extraEl = byNodeId(post.els).get(extra.id)
    expect(extraEl, 'the added node stopped emitting after the change').toBeDefined()

    // (a) THE APPEND. One op adds one child: the diff must APPEND it into the
    // host's wire. A fix that REFUSES the family compile keeps the host's
    // mint-time `childOrder` (`node.ts` mintPathState; placement-path-spec §4.2
    // "childOrder is path-derived and attached AT MINT TIME"), so the new child
    // is never appended at all and this list is empty.
    expect(
      appendPairs(post.ops),
      `the change must append exactly the new child into #filler (host wire "${String(hostWire)}"): the host did not re-derive its childOrder, so the new node is created and never appended (ORPHAN-EMIT-TOP-LEVEL-LEAK)`,
    ).toEqual([{ owner: hostWire, child: extraEl!.wire }])

    // (b) …and the DOCUMENT shows it there — inside #filler, inside the root.
    const hostHtml = outerHtmlOfAuthoredId(post.html, 'filler')
    expect(hostHtml, '#filler is absent from the document — the page is not the authored one').toBeDefined()
    expect(
      hostHtml ?? '',
      `the added node (${extra.id}) is NOT inside #filler: it was created but never appended into its host`,
    ).toContain(`data-node-id="${extra.id}"`)
    const rootHtml = outerHtmlOfAuthoredId(post.html, 'root')
    expect(rootHtml, 'the document root is absent — the page is not assembled through it').toBeDefined()
    expect(
      rootHtml ?? '',
      `the added node leaked OUTSIDE the document root — it renders as a sibling of the root, not as #filler's child`,
    ).toContain(`data-node-id="${extra.id}"`)
  })

  // ==========================================================================
  // PBED-6 — the refresh channel, the CONTROL against overshoot (gate §8 P-2)
  // ==========================================================================

  it('PBED-6 CONTROL — a post-bootstrap state-slice write on the NON-placement root still REACHES emit (deliberately green today)', async () => {
    const { sup, tree, root } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')

    const res = sup.apply({
      kind: 'state-slice',
      node: root,
      mutation: [{ targetProp: 'props.title', mode: 'replace', value: 'after-write' }],
    })
    expect(res.status, 'FIXTURE: the state-slice props write is a sanctioned applied op').toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)

    const post = renderPass(sup, adapter, series)
    const postRoot = byNodeId(post.els).get(root.id)
    expect(postRoot, 'the root stopped emitting after a props write').toBeDefined()

    // THE CONTROL — DELIBERATELY GREEN TODAY. The root is a NON-placement node,
    // so the pass-2 family compile is its ONLY refresh channel (`supervisor.ts`
    // `runPass2AndFlush`: `placementRouted ? compilePath : compile(focusedSlice)`;
    // the root carries no `content` anchor and the supervisor will never choose
    // `compilePath` for it). A fix that REFUSES the family compile ("a family
    // compile must not re-key a node holding a path state" read as a BAN) turns
    // this write into a SILENT no-op with no diagnostic — the emitted element
    // keeps its bootstrap value and the page silently freezes. That is the
    // overshoot this case exists to catch.
    //
    // NOT asserted here: the html-level visibility of the same write. That is the
    // rootKey/wire-domain defect itself (PBED-1…PBED-3), and repeating it here
    // would make the control red on the OTHER defect — this case isolates the
    // refresh channel, which is what a fix must not freeze.
    expect(
      postRoot!.props['prop:title'],
      "a post-bootstrap props write on the non-placement root never reached emit — the tree's ONLY refresh channel is frozen (the (A)-refusal signature)",
    ).toBe('after-write')
  })

  // ==========================================================================
  // PBED-7 — the strong domain rule (gate §8 P-3), applied to NEW nodes
  // ==========================================================================

  it('PBED-7 every wire after the change is a bootstrap wire or a PATH-domain wire — applied to the NEW node too (no nodeId wire in a path document)', async () => {
    const { sup, tree, root, filler } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    const bootWires = new Set(boot.els.map((el) => String(el.wire)))
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')
    expect(bootWires.size, 'FIXTURE: the bootstrap document must have wires').toBe(boot.els.length)

    const { extra, detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status, 'FIXTURE: detach(extra) is a sanctioned applied op').toBe('applied')
    expect(attach.status, 'FIXTURE: attach(extra → #filler) is a sanctioned applied op').toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)

    const post = renderPass(sup, adapter, series)
    const postById = byNodeId(post.els)

    // (a) THE RULE, strong form: every wire the second render emits lies in the
    // bootstrap wire set, OR is a NEW wire in the PATH domain. The rule's other
    // admissible branch — "the new-domain wire is accompanied by a DIAGNOSTIC" —
    // has no channel in this host (the fixture constructs no `EventBridge` for
    // the supervisor), so a stranger wire is admissible only in the path domain.
    // PBED-3 CANNOT SEE THIS: it iterates only the nodes present in BOTH renders
    // and its wire list names only the three authored elements.
    const strangers = post.els
      .filter((el) => !bootWires.has(String(el.wire)))
      .map((el) => ({
        nodeId: String(el.props['data:node-id']),
        wire: String(el.wire),
        pathDomain: isPathDomain(el),
      }))
    expect(
      strangers.filter((s) => !s.pathDomain),
      'wire(s) emitted on a NODE-ID wire that the bootstrap path document never emitted — the document is silently mixed-domain',
    ).toEqual([])

    // (b) the rule APPLIED TO NEW NODES: the added node is not in the bootstrap
    // wire set (it cannot be), so it must carry a PATH wire.
    const extraEl = postById.get(extra.id)
    expect(extraEl, 'the added node stopped emitting after the change').toBeDefined()
    expect(bootWires.has(String(extraEl!.wire)), 'FIXTURE: the added node is a NEW wire (not a bootstrap wire)').toBe(false)
    expect(
      isPathDomain(extraEl!),
      `the NEW node emits on a NODE-ID wire ("${String(extraEl!.wire)}") in a PATH document, with no diagnostic accompanying it`,
    ).toBe(true)
  })

  // ==========================================================================
  // PBED-8 — Z1: the condensed base (gate §8 P-4)
  // ==========================================================================

  it('PBED-8 Z1 — bootstrap → op → condense past maxJournalLength → undo() to base → the root still emits on "root" and the document is not empty', async () => {
    // `sharedHub`: the condensed-base restore re-seeds the graph THROUGH the
    // supervisor's hub (the documented host shape — the condense/restore tests
    // construct their supervisor the same way); without it `_restoreBase`
    // evicts the graph and returns before re-seeding, which would make the
    // restore leg fail on the FIXTURE instead of on the defect.
    const { sup, tree, root, filler } = fixture({ maxJournalLength: 1, sharedHub: true })
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')
    expect(byNodeId(boot.els).get(root.id)?.wire, 'FIXTURE: the bootstrap root emits on "root"').toBe('root')

    // ---- the ONE post-bootstrap structural op (PBED-1's sanctioned change) ---
    const { detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status, 'FIXTURE: detach(extra) is a sanctioned applied op').toBe('applied')
    expect(attach.status, 'FIXTURE: attach(extra → #filler) is a sanctioned applied op').toBe('applied')

    // ---- drive the journal past `maxJournalLength` (the host's own writes) ---
    // The condense is DEFERRED (a `setTimeout(0)`) and SIZE-GUARDED: a base
    // >= the pre-base journal it would replace is skipped with
    // `condense-skipped-size` (`supervisor.ts` `condense`). Two structural
    // entries alone (~140B) never outweigh this tree's base (~940B), so the
    // pre-base window is filled with ordinary post-bootstrap refresh writes
    // until the rewrite is a memory win — then the base marker exists.
    for (let i = 0; i < 20; i += 1) {
      sup.apply({ kind: 'state-slice', node: filler, mutation: [{ targetProp: 'props.tick', mode: 'replace', value: String(i) }] })
    }
    await sup.flush()
    mergePass2(sup, series.prevStates)
    await flushCondense()

    // ---- FIXTURE: the condense really happened (it rewrote the journal) -----
    const view = sup.journalEntries()
    expect(
      view.basePresent,
      "FIXTURE: the journal must carry the condensed base marker (if it does not, the D5 size guard skipped the rewrite with 'condense-skipped-size' and this case would test nothing)",
    ).toBe(true)
    expect(view.undoBaseBoundary, 'FIXTURE: the condense truncated the undoStack at the base').toBe(true)

    // ---- undo() to base: the recorded base-boundary fail, never a restore ----
    const undo = sup.undo()
    expect(
      undo.status,
      'FIXTURE: undo to the condensed base is the recorded base-boundary fail (the base marker is never undo-able)',
    ).toBe('base-boundary')
    await sup.flush()
    mergePass2(sup, series.prevStates)

    const postUndo = renderPass(sup, adapter, series)
    const rootAfterUndo = byNodeId(postUndo.els).get(root.id)
    expect(rootAfterUndo, 'the root stopped emitting after a condense + undo-to-base').toBeDefined()
    expect(
      rootAfterUndo!.wire,
      "Z1: the root's wire left the captured path domain across a condense + undo-to-base (the adapter's rootKey then matches no fragment)",
    ).toBe('root')
    expect(postUndo.html, 'Z1: the document is EMPTY after a condense + undo-to-base').not.toBe('')

    // ---- Z1's `_restoreBase` leg --------------------------------------------
    // The condensed base restored through the public `replay()` surface: a
    // graph-REPLACE that rebuilds every `Node` object and schedules a FULL
    // pass-2 refresh — the leg a per-`Node` carrier cannot survive, and the one
    // that decides whether the mode is carried by the SUPERVISOR.
    const beforeRestore = sup.getNode(root.id)
    const replay = sup.replay()
    expect(replay.status, 'FIXTURE: replay() restores the condensed base').toBe('applied')
    await sup.flush()
    expect(
      sup.getNode(root.id),
      'FIXTURE: the restore REPLACES the pre-base node objects (a per-Node marker cannot survive it)',
    ).not.toBe(beforeRestore)
    // the host's live map is invalidated with those objects (the probe's host
    // recipe — docs/probes/post-bootstrap-emit-drop.mjs — prunes ids the graph
    // no longer holds)
    const live = new Set(sup.allNodes().map((n): string => n.id))
    for (const id of [...series.prevStates.keys()]) if (!live.has(id)) series.prevStates.delete(id)
    mergePass2(sup, series.prevStates)

    const postRestore = renderPass(sup, adapter, series)
    const restoredRoot = byAuthoredId(sup.allNodes(), 'root')
    expect(restoredRoot, 'FIXTURE: the restored graph must still hold the authored root').toBeDefined()
    const rootAfterRestore = byNodeId(postRestore.els).get(restoredRoot!.id)
    expect(rootAfterRestore, 'the root stopped emitting after the condensed base was restored (_restoreBase)').toBeDefined()
    expect(
      rootAfterRestore!.wire,
      "Z1: the root's wire left the captured path domain across a _restoreBase (the condensed base re-compiles the whole tree)",
    ).toBe('root')
    expect(postRestore.html, 'Z1: the document is EMPTY after the condensed base was restored').not.toBe('')
  })

  // ==========================================================================
  // PBED-9 — Z2: the drain-only host (gate §8 P-5)
  // ==========================================================================

  it('PBED-9 Z2 — a host whose live map is REPLACED by each takePass2States() drain still emits the root', async () => {
    const { sup, tree, root, filler } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    const bootRootWire = byNodeId(boot.els).get(root.id)?.wire
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')
    expect(bootRootWire, 'FIXTURE: the bootstrap root emits on "root"').toBe('root')

    const { detach, attach } = attachOntoFiller(sup, filler)
    expect(detach.status, 'FIXTURE: detach(extra) is a sanctioned applied op').toBe('applied')
    expect(attach.status, 'FIXTURE: attach(extra → #filler) is a sanctioned applied op').toBe('applied')
    await sup.flush()

    // THE Z2 HOST: the settled drain is the ONLY carrier — the live map is
    // REPLACED by it, never merged into (`takePass2States` is the caller's
    // drain, `resolvedStates` stays non-draining; ops.md §5/§6, and
    // tests/integration/resolved-exposure.test.ts for the non-draining half).
    const drained = sup.takePass2States()
    expect(drained.size, "FIXTURE: the settled pass-2 must carry states — it is this host's only carrier").toBeGreaterThan(0)
    expect(
      [...drained.keys()],
      "Z2: this host's ONLY carrier of render state does not hold the ROOT's state — a drain-only host silently loses the root and the whole document",
    ).toContain(root.id)
    series.prevStates = new Map(drained)

    const post = renderPass(sup, adapter, series)
    const postRoot = byNodeId(post.els).get(root.id)
    expect(postRoot, 'Z2: the root stopped emitting on a drain-only host').toBeDefined()
    expect(
      postRoot!.wire,
      "Z2: the root's wire left the captured path domain on a drain-only host",
    ).toBe(bootRootWire)
    expect(post.html, 'Z2: the document is EMPTY on a drain-only host').not.toBe('')
  })

  // ==========================================================================
  // PBED-10 — the ORPHAN-EMIT-TOP-LEVEL-LEAK scenario (gate §8 P-6)
  // ==========================================================================

  it('PBED-10 a placement-attach into a FAMILY-routed container still APPENDS the added node (no detached top-level sibling)', async () => {
    const { sup, tree, root, filler } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    const bootById = byNodeId(boot.els)
    const bootRootWire = bootById.get(root.id)?.wire
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')
    expect(bootRootWire, 'FIXTURE: the bootstrap root emits on "root"').toBe('root')
    expect(bootById.get(filler.id), 'FIXTURE: the family-routed container #filler must emit at bootstrap').toBeDefined()

    // `placement-path-spec` §3.3, scope pin (stress-test round 4, scenario
    // 40(c)): a placement-attach into a container that is NOT placement-routed
    // (container anchors only — no `content` anchor). #filler is a plain family
    // child; #holder is the zone producer.
    const graft = consumerNode('graft')
    sup.registerNode(graft)
    const res = sup.apply({ kind: 'placement-attach', node: graft, container: filler, names: ['zone'] })
    expect(res.status, 'FIXTURE: the placement-attach is a sanctioned applied op').toBe('applied')
    const dirtied = res.status === 'applied' ? [...(res.dirtied ?? [])] : []
    expect(
      dirtied.sort(),
      'FIXTURE: the E2E-4 affected set — the container + the added node only',
    ).toEqual([filler.id, graft.id].sort())
    await sup.flush()
    mergePass2(sup, series.prevStates)

    const post = renderPass(sup, adapter, series)
    const graftEl = byNodeId(post.els).get(graft.id)
    expect(graftEl, 'the added node stopped emitting').toBeDefined()

    // (a) THE PIN — the added node GAINS ITS APPEND. §3.3 pins the opposite
    // reading as today's behavior: "the added node's element is created on its
    // pathKey wire with NO append op — the widget does not render". The
    // consumer's re-test observed the real consequence: it surfaces as a
    // DETACHED TOP-LEVEL SIBLING after the root (`ORPHAN-EMIT-TOP-LEVEL-LEAK`).
    // Under a tree compile mode the container RE-MINTS, so its path-state's
    // childOrder names the added node and the append exists (gate §5
    // disposition 8 — the row closes on this evidence, never by citation).
    const appends = appendPairs(post.ops)
    expect(
      appends.filter((p) => p.child === graftEl!.wire),
      'the added node was created with NO append — it surfaces as a detached top-level sibling (ORPHAN-EMIT-TOP-LEVEL-LEAK), not as a child of its container',
    ).toHaveLength(1)

    // (b) NO TOP-LEVEL LEAK: the added node must not occupy the document root's
    // own wire, and it must appear AFTER the root in the document. An
    // unappended fragment is serialized top-level by the adapter
    // (`adapters.ts` `toString` — "fragments that were created but never
    // appended ... serialize top-level after it"), and the capture order can
    // give it the rootKey slot.
    expect(graftEl!.wire, "the added node emits on the document ROOT's own wire").not.toBe(bootRootWire)
    const graftAt = post.html.indexOf(`data-node-id="${graft.id}"`)
    const rootAt = post.html.indexOf(`data-node-id="${root.id}"`)
    expect(graftAt, 'the added node is not in the document at all').toBeGreaterThan(-1)
    expect(rootAt, 'the document root is not in the document at all').toBeGreaterThan(-1)
    expect(
      graftAt,
      'the added node surfaces BEFORE the document root — a detached top-level sibling (ORPHAN-EMIT-TOP-LEVEL-LEAK)',
    ).toBeGreaterThan(rootAt)
  })

  // ==========================================================================
  // PBED-11 — the DUPLICATE CENSUS (ORPHAN-EMIT gate §8 P-3a)
  // ==========================================================================
  //
  // `PBED-10` keys a `data-node-id` **Map** (last-wins) to read the document, so
  // it is BLIND to the duplicate: a `placement-attach`ed graft holds a TOKEN walk
  // beside its placement walks, so the graft emits ONE ELEMENT PER WALK, and
  // every one of them carries the same `data-node-id`. The supervisor's decisive
  // probe (`docs/specs/orphan-emit-gate-review.md` §4.3) measured **3** elements
  // / 3 wires / a **3**-root forest for a two-offering-container fixture; this
  // fixture offers ONE container (the family child `#filler`), so the same
  // count is **2** (token walk + one placement walk).
  //
  // This case reads the document as an ARRAY (never through `byNodeId`), so the
  // duplicate is visible, and it pins the accepted remedy `E5` (§5 D-2: do not
  // mint the token walk for a `routed` node) from the OUTSIDE: one element, one
  // `create`, one document, one occurrence in the html.
  //
  // RED FIRST: no `src/**` change accompanies it.

  it('PBED-11 the duplicate census — a placement-attached graft emits ONE element, not one per walk', async () => {
    const { sup, tree, root, filler } = fixture()
    const adapter = new SSRFragmentAdapter()
    const series: HostSeries = { prevStates: bootstrapStates(sup, tree.nodes), prevMap: null }

    const boot = renderPass(sup, adapter, series)
    expect(boot.html, 'FIXTURE: the bootstrap render must be the authored document').not.toBe('')
    expect(byNodeId(boot.els).get(root.id)?.wire, 'FIXTURE: the bootstrap root emits on "root"').toBe('root')
    expect(byNodeId(boot.els).get(filler.id), 'FIXTURE: the family-routed container #filler must emit at bootstrap').toBeDefined()

    // PBED-10's construction, unchanged: a separately translated tree ROOT
    // (a graft — it roots its own tree and carries the 'rootNode' token)
    // placed by name into the authored page's container.
    const graft = consumerNode('graft')
    sup.registerNode(graft)
    const res = sup.apply({ kind: 'placement-attach', node: graft, container: filler, names: ['zone'] })
    expect(res.status, 'FIXTURE: the placement-attach is a sanctioned applied op').toBe('applied')
    await sup.flush()
    mergePass2(sup, series.prevStates)

    const post = renderPass(sup, adapter, series)

    // The graft's wires as the HOST holds them (its live states' pathKeys — the
    // public identity field), so the `create` census below is not a restatement
    // of the element census.
    const graftStates = series.prevStates.get(graft.id) ?? []
    expect(graftStates.length, 'FIXTURE: the graft must hold at least one state').toBeGreaterThan(0)
    const graftWires = new Set(graftStates.map((s) => String(s.pathKey)))

    // (1) THE DUPLICATE, over `post.els` AS AN ARRAY. `byNodeId` collapses this
    // to 1 by construction (last-wins) — which is why PBED-10 cannot see it.
    const graftEls = post.els.filter((el) => el.props['data:node-id'] === graft.id)
    expect(
      graftEls.map((el) => String(el.wire)),
      `the graft (${graft.id}) emitted ${graftEls.length} elements — one per WALK (its token walk + one per offering container) instead of one per POSITION in the document`,
    ).toHaveLength(1)

    // (2) …and the adapter was told to CREATE it once.
    const graftCreates = createWires(post.ops).filter((w) => graftWires.has(String(w)))
    expect(
      graftCreates.map(String),
      `the engine CREATED ${graftCreates.length} elements for the one graft node (${graft.id})`,
    ).toHaveLength(1)

    // (3) ONE DOCUMENT: the op stream must serialize a single tree — no stray
    // sibling beside the document root. The forest census is taken over the
    // DOCUMENT stream (a fresh baseline over the same live states, exactly what
    // a fresh host/adapter receives): `post.ops` alone is a DIFF against
    // `prevMap`, whose root count only names the elements created THIS pass that
    // nothing appended — pinned separately just below, because that is the
    // adapter-visible half of the same duplicate.
    const docSeries: HostSeries = { prevStates: series.prevStates, prevMap: null }
    const doc = renderPass(sup, new SSRFragmentAdapter(), docSeries)
    const docTrees = treeFromOps(doc.ops)
    expect(
      docTrees.map((t) => String(t.wire)),
      `the document is a FOREST, not one tree: ${docTrees.length} roots in the op stream (the unclaimed graft element is a top-level sibling of the document root)`,
    ).toHaveLength(1)
    expect(
      treeFromOps(post.ops).map((t) => String(t.wire)),
      'the post-bootstrap diff left an element created-but-never-appended — a forest root beside the document root: an element no parent in the document claims',
    ).toEqual([])

    // (4) …and the serialized document carries the graft's id exactly ONCE.
    const marker = `data-node-id="${graft.id}"`
    const occurrences = post.html.split(marker).length - 1
    expect(
      occurrences,
      `the graft's data-node-id appears ${occurrences}× in the adapter's html — the same node rendered as ${occurrences} elements`,
    ).toBe(1)
  })
})

// ============================================================================
// PBED-12 — the FAMILY-MODE ORPHAN and its op-site diagnostic
//          (`ORPHAN-EMIT-TOP-LEVEL-LEAK` engine half; gate `E6`, D-3)
// ============================================================================
//
// THE ACCEPTED REMEDY (`docs/specs/orphan-emit-gate-review.md` §5 D-3(a), and
// §8 P-3b): the family-mode orphan is a DOCUMENTED LIMIT **plus a diagnostic at
// the op site** — never in emit (`E1`/`E2`/`E3` REJECTED: every live residual is
// root-shaped, so an emit filter either exempts them or drops the seven
// legitimate literal-batch inputs; `E4` PARKED). The op site is
// `placementAttach` (`src/core/ops.ts:125-146`) because it holds BOTH facts the
// predicate needs and emit holds neither:
//
//   1. the CONTAINER's routing — `container.anchors.some(a => a.role ===
//      'content')` is exactly the expression the supervisor's pass-2 dispatch
//      already uses for the same question (`supervisor.ts:774`
//      `placementRouted`), and a routed container's compile is `compilePath`,
//      whose `pathChildrenFor` (`node.ts:260`) claims the placed child;
//   2. the SUPERVISOR's compile mode — `getCompileMode()` (public); in `path`
//      mode EVERY dirty node is re-derived in the path domain
//      (`compilePathSlice`), so the container re-mints and appends.
//
// When BOTH conditions of the leak hold (container NOT routed, mode `family`),
// nothing appends the added node's state, and it emits as a DETACHED TOP-LEVEL
// SIBLING — silently. The diagnostic makes that behaviour honest and changes
// nothing else: the op still applies, the state still emits.
//
// WHAT THIS BLOCK PINS, per sub-case:
//  - **PBED-12a** the warn FIRES, once, at the op, naming the container.
//    **RED today** — no such diagnostic exists.
//  - **PBED-12b** the op still APPLIES with its today shape (the warn must not
//    reject). GREEN today.
//  - **PBED-12c** DELIBERATE CONFIRMATION of the leak shape: 1 element, 0
//    appends, a 2-root document stream, the graft serialized top-level AFTER
//    the page root. GREEN today — **a future "fix" of the family-mode leak
//    must change THIS FILE rather than silently re-render.**
//  - **PBED-12d** CONTROL — `path` mode stays SILENT (the container re-mints
//    and appends; `PBED-10` is the proof of the append).
//  - **PBED-12e** CONTROL — a `content`-anchored container in a `family`-mode
//    tree stays SILENT (its path-states own the child).
//  - **PBED-12f** NO BEHAVIOUR CHANGE beside the diagnostic: the added node's
//    token walk stays SUPPRESSED (`E5`) — exactly one state, on its placement
//    wire, one element, still unappended.
//
// RED FIRST (AGENTS.md item 8): written before the diagnostic exists. Only
// `PBED-12a` is red; every other sub-case pins behaviour the engine already
// has. No `src/**` change accompanies this file.

/** One PBED-12 run: the family/path-mode construction, the op, its settled
 *  flush, the diff render and a fresh-baseline DOCUMENT render of the same live
 *  states (what a brand-new adapter receives — the forest census). */
interface OrphanRun {
  sup: Supervisor
  root: Node
  filler: Node
  graft: Node
  boot: { els: MinimalElement[]; ops: RenderOp[]; html: string }
  post: { els: MinimalElement[]; ops: RenderOp[]; html: string }
  doc: { els: MinimalElement[]; ops: RenderOp[]; html: string }
  res: ApplyOutcome
  /** flattened `console.warn` lines captured from just BEFORE the op … */
  warnsAtOp: string[]
  /** … through the supervisor's settled flush. */
  warnsAfterFlush: string[]
  /** the added node's live states as the HOST holds them (`pathKey` identity). */
  graftStates: CompiledState[]
}

/**
 * THE PBED-12 CONSTRUCTION — one `placement-attach` of a separately translated
 * tree ROOT (a graft) into `#filler`, on a supervisor whose compile mode is
 * DECLARED, after that tree's own canonical bootstrap (`opts.mode` decides
 * which: a family compile for `family`, `compilePath` per node for `path`).
 *
 * `console.warn` is spied for the whole window (`vi.spyOn`, args flattened with
 * `args.map(String).join(' ')`) — the existing op-site diagnostic channel
 * (`placement-name-vetoed`, `ops.ts:139`), restored by the block's `afterEach`.
 */
async function orphanRun(opts: { mode: 'family' | 'path'; fillerRouted?: boolean; zone?: string }): Promise<OrphanRun> {
  const { sup, tree, root, filler } = fixture({
    compileMode: opts.mode,
    ...(opts.fillerRouted ? { fillerRouted: true } : {}),
  })
  const series: HostSeries = {
    prevStates: opts.mode === 'path' ? bootstrapStates(sup, tree.nodes) : familyBootstrapStates(sup, tree),
    prevMap: null,
  }
  const adapter = new SSRFragmentAdapter()
  const boot = renderPass(sup, adapter, series)

  const graft = consumerNode('graft')
  sup.registerNode(graft)

  const lines: string[] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })
  const res = sup.apply({ kind: 'placement-attach', node: graft, container: filler, names: [opts.zone ?? 'zone'] })
  const warnsAtOp = [...lines]
  await sup.flush()
  mergePass2(sup, series.prevStates)
  const warnsAfterFlush = [...lines]
  const post = renderPass(sup, adapter, series)
  const graftStates = [...(series.prevStates.get(graft.id) ?? [])]
  const doc = renderPass(sup, new SSRFragmentAdapter(), { prevStates: series.prevStates, prevMap: null })
  warn.mockRestore()

  return { sup, root, filler, graft, boot, post, doc, res, warnsAtOp, warnsAfterFlush, graftStates }
}

/** The emitted elements of ONE node, read over `els` AS AN ARRAY (never through
 *  the last-wins `byNodeId` Map — the graft can hold several). */
function elsOfNode(els: MinimalElement[], nodeId: string): MinimalElement[] {
  return els.filter((el) => el.props['data:node-id'] === nodeId)
}

/** The `append` ops whose CHILD is one of `wires` — "was this element claimed by
 *  a parent in the document?" (the orphan test). */
function appendsTo(ops: RenderOp[], wires: ReadonlySet<string>): Array<{ owner: NodeRef; child: NodeRef }> {
  return appendPairs(ops).filter((p) => wires.has(String(p.child)))
}

describe('PBED-12 — the family-mode orphan: the op-site diagnostic (gate §5 D-3 / §8 P-3b)', () => {
  // the op-site channel is `console.warn`; every case restores whatever it spied
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // PBED-12a — THE WARN FIRES in the exact leak condition (RED TODAY)
  // ==========================================================================

  it('PBED-12a a placement-attach into a NON-placement-routed container in a family-mode tree WARNS once, at the op, naming the container (RED today)', async () => {
    const run = await orphanRun({ mode: 'family' })

    // ---- FIXTURE: both halves of the predicate really are in hand ----------
    expect(
      run.sup.getCompileMode(),
      'FIXTURE: the supervisor must still be in FAMILY mode at the op (a path-mode supervisor re-mints the container and there is nothing to warn about)',
    ).toBe('family')
    expect(
      run.filler.anchors.some((a) => a.role === 'content'),
      'FIXTURE: #filler must NOT carry a `content` anchor — that anchor is what makes a container placement-routed',
    ).toBe(false)
    expect(
      run.graft.anchors.some((a) => a.role === 'content'),
      'FIXTURE: the ADDED node must carry a `content` anchor (it is the placement consumer the op attaches)',
    ).toBe(true)

    // ---- THE DIAGNOSTIC: exactly ONE line, from the OP ---------------------
    expect(
      run.warnsAtOp,
      `the placement-attach emitted ${run.warnsAtOp.length} console.warn line(s) at the op: ${JSON.stringify(run.warnsAtOp)} — the family-mode orphan is silent today and must warn (ORPHAN-EMIT-TOP-LEVEL-LEAK, gate D-3(a))`,
    ).toHaveLength(1)

    // …and it NAMES THE CONTAINER. The message SHAPE is the implementer's
    // (nothing here pins wording); a stable identifier is required: the
    // container's authored id (#filler) or its node id — plus a word that says
    // what is wrong with it (`placement` / `append` / `orphan`).
    const line = run.warnsAtOp[0] ?? ''
    expect(
      line.includes(run.filler.id) || line.includes('filler'),
      `the diagnostic does not name the container: expected #filler or ${run.filler.id} in ${JSON.stringify(line)}`,
    ).toBe(true)
    expect(
      /placement|append|orphan/i.test(line),
      `the diagnostic names the container but not what is wrong with it (no "placement"/"append"/"orphan" word): ${JSON.stringify(line)}`,
    ).toBe(true)

    // ---- …and NOTHING ELSE warns: the diagnostic is at the OP, not in emit --
    expect(
      run.warnsAfterFlush,
      'a further diagnostic appeared during the settled flush — the diagnostic belongs at the OP SITE, where the container routing and the compile mode are both in hand (gate D-3(a))',
    ).toHaveLength(1)
  })

  // ==========================================================================
  // PBED-12b — the op STILL APPLIES (GREEN TODAY: the warn must not reject)
  // ==========================================================================

  it('PBED-12b the diagnostic does not change the op: the placement-attach still APPLIES, with today\'s result shape (GREEN today)', async () => {
    const run = await orphanRun({ mode: 'family' })

    expect(
      run.res.status,
      'the placement-attach was not APPLIED — a warn+skip (or a throw) is a BEHAVIOUR change; D-3(a) rules the diagnostic, not a veto',
    ).toBe('applied')
    if (run.res.status !== 'applied') return

    expect(
      [...(run.res.dirtied ?? [])].sort(),
      'the applied result shape moved: the E2E-4 affected set is still exactly the container + the added node',
    ).toEqual([run.filler.id, run.graft.id].sort())
    expect(run.res.journalId, 'the applied op must still be journaled (the result shape is unchanged)').toBeTypeOf('string')
  })

  // ==========================================================================
  // PBED-12c — THE LEAK SHAPE, PINNED AS TODAY'S BEHAVIOUR (GREEN TODAY)
  // ==========================================================================

  it('PBED-12c DELIBERATE CONFIRMATION — the family-mode leak, pinned as today\'s behaviour: 1 element, 0 appends, a 2-root document stream (GREEN today)', async () => {
    const run = await orphanRun({ mode: 'family' })

    const pageRootWire = byNodeId(run.boot.els).get(run.root.id)?.wire
    expect(pageRootWire, 'FIXTURE: the page root must emit at bootstrap').toBeDefined()

    // (1) THE ADDED NODE EMITS — once. Its token walk is not minted (`E5`), so
    // the ONE placement state is the whole of it.
    const graftEls = elsOfNode(run.post.els, run.graft.id)
    expect(
      graftEls.map((el) => String(el.wire)),
      `the added node emitted ${graftEls.length} element(s) — in family mode it must be exactly ONE (its placement walk; the token walk is suppressed, E5)`,
    ).toHaveLength(1)
    const graftWires = new Set(graftEls.map((el) => String(el.wire)))

    // (2) …with ZERO APPENDS: nothing in the document claims it.
    expect(
      appendsTo(run.post.ops, graftWires),
      'the family-mode container APPENDED the added node — that is the FIXED behaviour (path mode / `E4`), not today\'s. If this case fails, change THIS FILE deliberately: the family-mode leak is a documented limit + a diagnostic (gate §5 D-3), and the pin must be re-stated, never silently re-rendered',
    ).toEqual([])

    // (3) THE DOCUMENT STREAM IS A FOREST: the page root + the floating graft,
    // and nothing else. Read over a FRESH baseline (prevMap `null`) over the
    // same live states — exactly what a brand-new adapter receives.
    const docRoots = treeFromOps(run.doc.ops).map((t) => String(t.wire))
    expect(
      docRoots,
      `the document stream carries ${docRoots.length} roots: [${docRoots.join(', ')}] — the family-mode orphan shape is 2 (the page root + the floating graft); a third root means a different defect moved in (see PBED-12d/e), and a single root means the leak was FIXED`,
    ).toHaveLength(2)
    expect(docRoots, 'the page root must still be a document root').toContain(String(pageRootWire))
    expect(docRoots, 'the added node is not a document root — the leak shape moved').toContain(String(graftEls[0]!.wire))

    // (4) …and the RENDERED document shows the CONSEQUENCE the authors meet:
    // the graft IS in the html, but as a detached TOP-LEVEL SIBLING after the
    // page root (`adapters.ts` `toString`'s floating branch) — silently.
    const marker = `data-node-id="${run.graft.id}"`
    const graftAt = run.post.html.indexOf(marker)
    expect(graftAt, 'the added node is absent from the rendered document — it must at least render (the leak is that it renders OUTSIDE its container)').toBeGreaterThan(-1)
    const rootHtml = outerHtmlOfAuthoredId(run.post.html, 'root')
    expect(rootHtml, 'the page root is absent from the rendered document').toBeDefined()
    expect(
      rootHtml ?? '',
      'the added node is INSIDE the page root — that is the fixed shape, not today\'s family-mode behaviour',
    ).not.toContain(marker)
    const rootEnd = run.post.html.indexOf(rootHtml ?? '') + (rootHtml ?? '').length
    expect(
      graftAt,
      'the added node must serialize as a detached TOP-LEVEL SIBLING: after the page root\'s closing tag (ORPHAN-EMIT-TOP-LEVEL-LEAK)',
    ).toBeGreaterThanOrEqual(rootEnd)
  })

  // ==========================================================================
  // PBED-12d — CONTROL: path mode stays SILENT (GREEN TODAY)
  // ==========================================================================

  it('PBED-12d CONTROL — the same construction on a `path`-mode supervisor is SILENT: the container re-mints and APPENDS the graft (GREEN today)', async () => {
    const run = await orphanRun({ mode: 'path' })

    expect(
      run.sup.getCompileMode(),
      'FIXTURE: the supervisor must be in path mode (declared, never inferred over)',
    ).toBe('path')
    expect(
      run.warnsAtOp,
      `a path-mode placement-attach warned: ${JSON.stringify(run.warnsAtOp)} — this tree has no orphan to report (the container is re-derived in the path domain and appends), so the diagnostic must be SILENT`,
    ).toEqual([])
    expect(run.warnsAfterFlush, 'a path-mode flush warned — the silence control must hold through the settled pass too').toEqual([])

    // the reason there is nothing to warn about: the append EXISTS (PBED-10's
    // proof, re-stated here so this control cannot pass vacuously).
    const graftWires = new Set(elsOfNode(run.post.els, run.graft.id).map((el) => String(el.wire)))
    expect(graftWires.size, 'FIXTURE: the added node must emit in path mode').toBeGreaterThan(0)
    expect(
      appendsTo(run.post.ops, graftWires).length,
      'CONTROL: path mode did not append the added node, so this control would not prove the diagnostic is mode-scoped (PBED-10 owns the append pin)',
    ).toBeGreaterThan(0)
    expect(treeFromOps(run.doc.ops).map((t) => String(t.wire)), 'CONTROL: the path-mode document must be ONE tree').toHaveLength(1)
  })

  // ==========================================================================
  // PBED-12e — CONTROL: a placement-ROUTED container stays SILENT (GREEN TODAY)
  // ==========================================================================

  it('PBED-12e CONTROL — a `content`-anchored container in a family-mode tree is SILENT (its path-states own the child) (GREEN today)', async () => {
    // The container difference is the ONLY difference from PBED-12a: `#filler`
    // carries a `content` anchor (authored `targetPlacement` — NOT
    // `placementName`, which mints the producer anchor), so pass-2 compiles it
    // with `compilePath` and its `pathChildrenFor` claims the added node.
    // The attach is requested on a SEPARATE zone (`inner`) so `#holder` is not
    // a second OFFERING container for the same name — that multiplicity is the
    // unruled N-way duplication (gate §4.3 / D-9) and does not belong in a
    // control. (The routed container still mints one state per path it is
    // itself reachable by, so the added node can emit on more than one wire —
    // hence the census below is "every element is CLAIMED", never a count.)
    const run = await orphanRun({ mode: 'family', fillerRouted: true, zone: 'inner' })

    expect(run.sup.getCompileMode(), 'FIXTURE: still family mode — the routing of the container is the variable').toBe('family')
    expect(
      run.filler.anchors.some((a) => a.role === 'content'),
      'FIXTURE: #filler must carry a `content` anchor here (that IS the control variable)',
    ).toBe(true)
    expect(
      run.warnsAtOp,
      `a family-mode placement-attach into a ROUTED container warned: ${JSON.stringify(run.warnsAtOp)} — its path-states own the child, so the leak condition does not hold and the diagnostic must be SILENT`,
    ).toEqual([])
    expect(run.warnsAfterFlush, 'a routed-container flush warned — the silence control must hold through the settled pass too').toEqual([])

    // …and the child really is OWNED: every element of the added node is an
    // append child (no orphan), which is what "the container is routed" buys.
    const graftEls = elsOfNode(run.post.els, run.graft.id)
    expect(graftEls.length, 'FIXTURE: the added node must emit').toBeGreaterThan(0)
    const claimed = new Set(appendsTo(run.post.ops, new Set(graftEls.map((el) => String(el.wire)))).map((p) => String(p.child)))
    expect(
      graftEls.filter((el) => !claimed.has(String(el.wire))).map((el) => String(el.wire)),
      'CONTROL: the routed container left an element of the added node unappended — then this control is not the "path-states own the child" construction it claims to be',
    ).toEqual([])
  })

  // ==========================================================================
  // PBED-12f — NO BEHAVIOUR CHANGE beside the diagnostic (GREEN TODAY)
  // ==========================================================================

  it('PBED-12f the diagnostic lands with NO behaviour change: the added node\'s token walk stays SUPPRESSED (E5), one state on its placement wire, one element, still unappended (GREEN today)', async () => {
    const run = await orphanRun({ mode: 'family' })

    // (1) THE ADDED NODE'S OWN STATE CENSUS — `E5` in the family-mode tree:
    // one PLACEMENT state, and NOT the zero-hop token identity (`root/<id>`),
    // which would be a second element on a wire of its own.
    expect(
      run.graftStates.map((s) => String(s.pathKey)),
      `the added node holds ${run.graftStates.length} state(s): the routed graft mints ONE placement state and its token walk stays suppressed (ORPHAN-EMIT gate §5 D-2 / E5)`,
    ).toHaveLength(1)
    const wire = String(run.graftStates[0]?.pathKey)
    expect(wire, "the surviving state is the graft's TOKEN identity — the graft would emit a detached fragment beside its placement element (the duplicate `E5` removed)").not.toBe(`root/${run.graft.id}`)
    expect(
      run.graftStates[0]?.forkKey !== undefined && String(run.graftStates[0]?.forkKey) === wire,
      `the surviving state is not a PATH state (forkKey must equal its pathKey "${wire}")`,
    ).toBe(true)

    // (2) …and it emits exactly ONE element, on exactly that wire.
    expect(
      elsOfNode(run.post.els, run.graft.id).map((el) => String(el.wire)),
      'the added node must emit exactly one element, on its placement wire — the diagnostic must not be accompanied by a re-render',
    ).toEqual([wire])

    // (3) …on a wire no token identity owns, and still UNCLAIMED: the leak is
    // untouched (PBED-12c owns its document-level pin; this repeats the two
    // readings that a "make the warn do something" change would move first).
    expect(
      appendsTo(run.post.ops, new Set([wire])),
      'the added node is now APPENDED in family mode — the diagnostic must not change the op\'s behaviour (PBED-12c carries the deliberate pin)',
    ).toEqual([])
  })
})

// ============================================================================
// PBED-13 — TWO OFFERING CONTAINERS: BOTH must populate
//          (`PLACEMENT-SECOND-CONTAINER-STALE`; the owner's 2026-11-23 ruling)
// ============================================================================
//
// **THE OWNER'S RULING** (`docs/defects.md` row
// `PLACEMENT-SECOND-CONTAINER-STALE`, verbatim): *"If two nodes share a
// placement name, they both populate with nodes targeting that placement."*
//
// So the MULTIPLICITY IS THE DESIGN, not the defect: a graft whose `content`
// anchor targets a name that TWO containers offer mints ONE placement state per
// offering container (2 states, 2 elements). What is broken is the POPULATION.
//
// **THE MEASURED DEFECT** (the row's probe, reproduced by this construction):
// the `placement-attach` op dirties `[container, node]` — only the container
// the HOST passed — so every OTHER offering container is never re-derived and
// keeps the `childOrder` it minted BEFORE the graft existed. Today: the diff
// emits exactly ONE `append` (`owner` = `#zoneA`'s wire), `#zoneB`'s html slice
// never contains the graft, and the second graft element is created but never
// appended — a **2-root** document stream.
//
// **THE FIX SHAPE THE OWNER RULED:** widen the dirty set — re-derive EVERY
// offering container. The op SIGNATURE does not change. This case therefore
// never asserts the `dirtied` set of the op (that is the one reading the fix is
// allowed to move), only the document-level consequences a reader of the ruling
// can rely on.
//
// **THE CONSTRUCTION'S ONE NON-OBVIOUS REQUIREMENT (a setup trap, not a
// behaviour):** the page AND the graft must be translated on ONE
// `createLinkHub()`. `placement-attach` mints the graft's `content` anchor
// through `node.hubFor ?? container.hubFor ?? this.hub`, and each container's
// `container` anchor sits on its own tree's per-name placement Link — so a
// graft translated on its OWN hub cannot see the containers at all: its walk
// enumerates ZERO placement branches, the multiplicity collapses to one
// unkeyed state, and this case would measure nothing. PBED-13a asserts the
// shared Link explicitly (and `GRAFT-ROOT-PATHKEY-COLLISION` is what an
// un-shared hub surfaces as instead, masking this defect entirely).
//
// WHAT THIS BLOCK PINS, per sub-case (assertions ordered fixture-first):
//  - **PBED-13a** FIXTURE + THE INTENDED MULTIPLICITY: both sibling containers
//    carry a `container` anchor for the zone on ONE placement Link, the graft
//    carries a `content` anchor for it, the graft mints exactly 2 placement
//    states (one per offering container) and emits 2 elements on their wires.
//    **GREEN today** — this half pins the ruling.
//  - **PBED-13b** THE POPULATION: exactly 2 `append` ops whose child is a graft
//    wire — one per offering container — and each offering container is an
//    `append` owner exactly once. **RED today** (1 append).
//  - **PBED-13c** THE DOCUMENT: the graft sits INSIDE each offering container
//    (tag-depth-matched html slice) and the document stream is ONE tree, not
//    the 2-root forest. **RED today**.
//  - **PBED-13d** CONTROL — FAMILY mode keeps `ORPHAN-EMIT-TOP-LEVEL-LEAK`'s
//    documented limit (0 appends, both containers empty) — untouched by this
//    fix; `PBED-12c` remains the single-container family pin and still holds.
//    **GREEN today.**
//  - **PBED-13e** CONTROL — the SINGLE-container case the widened rule must not
//    change: 1 append, 1 element, 1 document root (`PBED-10` owns the shape).
//    **GREEN today.**
//
// RED FIRST (AGENTS.md item 8): written before the fix, against a tree where
// the defect is live. No `src/**` change accompanies this file.

/** The zone BOTH sibling containers offer in PBED-13. */
const PBED13_ZONE = 'zone'

/**
 * The PBED-13 authored page: `div#root` with one `<aside>` sibling per
 * `containerIds` entry, EVERY one of them a producer of the SAME zone.
 *
 * `placement: { placementName }` mints the `container`-role anchor
 * (`translate.ts:1036`); `targetPlacement` would mint the consuming side
 * instead. Sibling duplication is LEGAL — the §1.3 veto
 * (`node.ts` `ancestorConsumesZone`) fires only against an ANCESTOR that
 * CONSUMES the zone, so neither sibling vetoes the other (no
 * `placement-name-vetoed` here).
 */
function zoneSiblingEnvelope(containerIds: string[]): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        children: containerIds.map((id) => ({
          type: 'aside',
          css: { id },
          props: { id },
          placement: { placementName: PBED13_ZONE },
        })),
      },
      children: [],
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

/**
 * The graft, translated ONTO THE PAGE TREE'S HUB (see the block header's
 * "one non-obvious requirement"): a separately translated tree ROOT placed into
 * the authored page's containers by name. It is deliberately NOT
 * `consumerNode()` — that helper translates on a hub of its own, which is the
 * right shape for PBED-10..12 (one container, whose anchor the op can reach
 * through `graft.hubFor`) and the WRONG one here.
 */
function graftOnHub(cssId: string, hub: ReturnType<typeof createLinkHub>): Node {
  return translateLegacy(
    {
      template: { root: { type: 'span', props: { id: cssId } } },
      content: [],
      clientConfig: { runInstantiation: true, runRendering: true },
    },
    { hub },
  ).root
}

interface RenderRead {
  els: MinimalElement[]
  ops: RenderOp[]
  html: string
}

interface ZoneRun {
  sup: Supervisor
  /** the offering containers, in `containerIds` order. */
  containers: Node[]
  graft: Node
  boot: RenderRead
  /** the diff render after the op + its settled flush (what the adapter applies). */
  post: RenderRead
  /** a FRESH-baseline render over the same live states (the forest census). */
  doc: RenderRead
  res: ApplyOutcome
  /** the graft's live states as the HOST holds them. */
  graftStates: CompiledState[]
}

/**
 * ONE PBED-13 run: authored page with `containerIds.length` sibling containers
 * all offering the same zone → the tree's own canonical bootstrap (`compilePath`
 * per node in `path` mode, one family compile in `family` mode) → register the
 * graft → ONE `placement-attach` naming the zone, onto the FIRST container →
 * the supervisor's settled flush → the diff render → a fresh-baseline document
 * render.
 *
 * The supervisor gets the SAME `hub` as both translations, and the mode is
 * DECLARED (`compileMode`), never inferred.
 */
async function zoneRun(opts: { mode: 'family' | 'path'; containerIds: string[] }): Promise<ZoneRun> {
  const hub = createLinkHub()
  const tree = translateLegacy(zoneSiblingEnvelope(opts.containerIds), { hub })
  const sup = new Supervisor({ hub, compileMode: opts.mode })
  for (const n of tree.nodes) sup.registerNode(n)
  const containers = opts.containerIds.map((id): Node => {
    const n = tree.nodes.find((x) => x.css?.id === id || x.props?.id === id)
    if (!n) throw new Error(`PBED-13 fixture: the envelope has no #${id} node`)
    return n
  })
  const series: HostSeries = {
    prevStates: opts.mode === 'path' ? bootstrapStates(sup, tree.nodes) : familyBootstrapStates(sup, tree),
    prevMap: null,
  }
  const adapter = new SSRFragmentAdapter()
  const boot = renderPass(sup, adapter, series)

  const graft = graftOnHub('graft', hub)
  sup.registerNode(graft)
  const res = sup.apply({ kind: 'placement-attach', node: graft, container: containers[0]!, names: [PBED13_ZONE] })
  await sup.flush()
  mergePass2(sup, series.prevStates)

  const post = renderPass(sup, adapter, series)
  const graftStates = [...(series.prevStates.get(graft.id) ?? [])]
  const doc = renderPass(sup, new SSRFragmentAdapter(), { prevStates: series.prevStates, prevMap: null })
  return { sup, containers, graft, boot, post, doc, res, graftStates }
}

/** The `owner → child` label of one append pair (a failure message that names
 *  WIRES, not just counts — the implementer needs to see which container is
 *  missing). */
function pairLabel(p: { owner: NodeRef; child: NodeRef }): string {
  return `${String(p.owner)} → ${String(p.child)}`
}

/** An offering container's emitted wire in `els` (undefined when it did not
 *  emit — a FIXTURE break, never a behaviour under test here). */
function containerWire(els: MinimalElement[], container: Node): NodeRef | undefined {
  return byNodeId(els).get(container.id)?.wire
}

/** The authored id of a container, for messages + the html read. */
function authoredIdOf(n: Node): string {
  return String(n.css?.id ?? n.props?.id ?? n.id)
}

describe('PLACEMENT-SECOND-CONTAINER-STALE — a placement name offered by TWO containers must populate BOTH (owner ruling 2026-11-23)', () => {
  // ==========================================================================
  // PBED-13a — FIXTURE + the INTENDED multiplicity (GREEN today)
  // ==========================================================================

  it('PBED-13a the fixture holds and the MULTIPLICITY is intended: one placement state + one element PER offering container (GREEN today)', async () => {
    const run = await zoneRun({ mode: 'path', containerIds: ['zoneA', 'zoneB'] })

    // ---- (1) FIXTURE PRECONDITIONS — the anchors the construction needs ----
    expect(
      run.sup.getCompileMode(),
      'FIXTURE: the supervisor must be in the DECLARED path mode (the `compilePath` bootstrap) — this case measures the path document',
    ).toBe('path')
    expect(
      run.res.status,
      'FIXTURE: the placement-attach must be a sanctioned APPLIED op — a rejected op would leave the tree in a shape none of these cases describe (the op SIGNATURE and its applied-ness are unchanged by the ruled fix)',
    ).toBe('applied')
    expect(run.containers, 'FIXTURE: the page must author two sibling offering containers').toHaveLength(2)
    for (const c of run.containers) {
      expect(
        c.anchors.filter((a) => a.role === 'container' && a.target === PBED13_ZONE).length,
        `FIXTURE: #${authoredIdOf(c)} does not OFFER zone "${PBED13_ZONE}" (no single container-role anchor for it) — a sibling that offers no zone is not an offering container, and the multiplicity this case pins cannot exist`,
      ).toBe(1)
    }
    const contentAnchors = run.graft.anchors.filter((a) => a.role === 'content' && a.target === PBED13_ZONE)
    expect(
      contentAnchors.length,
      `FIXTURE: the graft does not TARGET zone "${PBED13_ZONE}" exactly once (content-role anchors found: ${contentAnchors.length}) — the placement-attach must have minted it`,
    ).toBe(1)
    // …and every anchor pair sits on ONE per-name placement Link: otherwise the
    // graft's walk enumerates no container branch at all and the run silently
    // measures something else (see this block's header).
    const contentAnchor = contentAnchors[0]!
    for (const c of run.containers) {
      const containerAnchor = c.anchors.find((a) => a.role === 'container' && a.target === PBED13_ZONE)!
      expect(
        containerAnchor.link,
        `FIXTURE: #${authoredIdOf(c)}'s container anchor and the graft's content anchor are NOT on the same per-name placement Link — translate the page AND the graft with ONE createLinkHub() and hand that hub to the Supervisor, or the graft cannot see this container at all and this case measures nothing`,
      ).toBe(contentAnchor.link)
    }
    // the two containers RENDER on distinct wires (the appends below are keyed
    // off those wires, so they must be readable)
    const wires: NodeRef[] = []
    for (const c of run.containers) {
      const w = containerWire(run.post.els, c)
      expect(
        w,
        `FIXTURE: offering container #${authoredIdOf(c)} did not emit — a container that is not in the document cannot receive anything`,
      ).toBeDefined()
      wires.push(w!)
    }
    expect(
      new Set(wires.map(String)).size,
      `FIXTURE: the two offering containers share one wire [${wires.map(String).join(', ')}] — then an "append owner" reading could not tell them apart`,
    ).toBe(2)

    // ---- (2) THE MULTIPLICITY: INTENDED, and GREEN today -------------------
    // The owner's ruling makes one state PER OFFERING CONTAINER the design. This
    // half must stay standing after the fix: a fix that appends one element into
    // both containers (or otherwise collapses the per-container states) would
    // satisfy PBED-13b/13c while breaking the ruling.
    const stateKeys = run.graftStates.map((s) => String(s.pathKey))
    expect(
      stateKeys,
      `the graft minted ${stateKeys.length} placement state(s) for a zone TWO containers offer — one state PER OFFERING CONTAINER is the INTENDED multiplicity (owner ruling: "if two nodes share a placement name, they both populate with nodes targeting that placement")`,
    ).toHaveLength(2)
    expect(
      new Set(stateKeys).size,
      `the graft's two placement states collapsed onto ONE pathKey [${stateKeys.join(', ')}] — they are supposed to key per offering container`,
    ).toBe(2)
    expect(
      run.graftStates.map((s) => String(s.parent)).sort(),
      `the graft's placement states do not land on ONE OFFERING CONTAINER each (state.parent is the path's landing owner): expected [#${run.containers.map(authoredIdOf).join(', #')}]`,
    ).toEqual(run.containers.map((c) => c.id).sort())

    // …and each state emits its OWN element: two elements, on the two states'
    // wires (an element count of one would mean a state has no element, which
    // is what a "just append the same wire twice" fix could produce).
    const graftEls = elsOfNode(run.post.els, run.graft.id)
    expect(
      graftEls.map((el) => String(el.wire)),
      `the graft emitted ${graftEls.length} element(s) for its TWO placement states — one element per state is the intended multiplicity`,
    ).toHaveLength(2)
    expect(
      new Set(graftEls.map((el) => String(el.wire))).size,
      `the graft's two elements share one wire [${graftEls.map((el) => String(el.wire)).join(', ')}] — then the two offering containers could not own one each`,
    ).toBe(2)
    expect(
      graftEls.map((el) => String(el.wire)).sort(),
      'the emitted elements are not the minted placement states: every state must emit on its own pathKey wire',
    ).toEqual([...stateKeys].sort())
  })

  // ==========================================================================
  // PBED-13b — THE POPULATION (RED today)
  // ==========================================================================

  it('PBED-13b BOTH offering containers populate: one `append` per container, the graft as its child (RED today — the second container never receives the node)', async () => {
    const run = await zoneRun({ mode: 'path', containerIds: ['zoneA', 'zoneB'] })

    // FIXTURE (PBED-13a owns the pin): the multiplicity is present, otherwise a
    // 2-append reading below could not mean what it says.
    const graftWires = new Set(elsOfNode(run.post.els, run.graft.id).map((el) => String(el.wire)))
    expect(
      graftWires.size,
      'FIXTURE: the graft must emit one element per offering container (PBED-13a pins it)',
    ).toBe(2)

    // ---- THE APPENDS: exactly one per offering container -------------------
    const appends = appendsTo(run.post.ops, graftWires)
    expect(
      appends.map(pairLabel).sort(),
      `the diff emitted ${appends.length} append op(s) for a graft that TWO containers offer (${appends.map(pairLabel).join(' | ') || 'none'}) — the owner's ruling requires BOTH containers to populate; today the op dirties only the container passed to placement-attach, so every OTHER offering container is never re-derived and keeps the childOrder it minted before the graft existed (PLACEMENT-SECOND-CONTAINER-STALE)`,
    ).toHaveLength(2)
    expect(
      appends.map((p) => String(p.child)).sort(),
      `the appended CHILDREN are not exactly the graft's two emitted wires [${[...graftWires].sort().join(', ')}] — one append per offering container, each owning its OWN graft element`,
    ).toEqual([...graftWires].sort())

    // ---- …and each offering container is an `append` OWNER exactly ONCE ----
    for (const c of run.containers) {
      const wire = containerWire(run.post.els, c)
      expect(wire, `FIXTURE: offering container #${authoredIdOf(c)} did not emit`).toBeDefined()
      const owned = appendPairs(run.post.ops).filter((p) => String(p.owner) === String(wire))
      expect(
        owned.map(pairLabel),
        `offering container #${authoredIdOf(c)} is an append OWNER ${owned.length} time(s) — EVERY offering container must append the graft exactly once: the op's dirty set is [container, node] (only the container the host passed), so this container was never re-derived and its stored state still carries its pre-attach childOrder (PLACEMENT-SECOND-CONTAINER-STALE)`,
      ).toHaveLength(1)
      expect(
        graftWires.has(String(owned[0]?.child)),
        `offering container #${authoredIdOf(c)} appends ${String(owned[0]?.child)}, which is not one of the graft's wires [${[...graftWires].join(', ')}] — this case reads the graft's population, nothing else`,
      ).toBe(true)
    }
  })

  // ==========================================================================
  // PBED-13c — THE DOCUMENT, html half: INSIDE EACH container (RED today)
  // ==========================================================================

  it('PBED-13c the rendered HTML: the graft sits INSIDE EACH offering container, not beside it (RED today — #zoneB never receives it)', async () => {
    const run = await zoneRun({ mode: 'path', containerIds: ['zoneA', 'zoneB'] })
    const marker = `data-node-id="${run.graft.id}"`

    // FIXTURE: the graft is in the document at all (it is today — as a detached
    // sibling, which is exactly what the slices below discriminate).
    expect(
      run.post.html.includes(marker),
      `FIXTURE: the graft (${run.graft.id}) is absent from the rendered document — then nothing below can be read (it renders today; PBED-13b owns "in which container")`,
    ).toBe(true)

    // INSIDE EACH offering container, read through the tag-depth-matched slice
    // (`outerHtmlOfAuthoredId` — a text marker alone cannot tell "assembled into
    // the host" from "created, never appended, serialized top-level").
    for (const c of run.containers) {
      const authored = authoredIdOf(c)
      const slice = outerHtmlOfAuthoredId(run.post.html, authored)
      expect(
        slice,
        `FIXTURE: offering container #${authored} is absent from the rendered document (no id="${authored}" opening tag) — the html read is impossible`,
      ).toBeDefined()
      expect(
        slice ?? '',
        `#${authored} does NOT contain the graft: only the container passed to placement-attach is re-derived, so this offering container keeps its pre-attach childOrder, the graft is created on its own path wire and never appended, and the adapter serializes it OUTSIDE the container (PLACEMENT-SECOND-CONTAINER-STALE; owner ruling: "if two nodes share a placement name, they both populate with nodes targeting that placement")`,
      ).toContain(marker)
    }
  })

  // ==========================================================================
  // PBED-13d — THE DOCUMENT, stream half: ONE tree (RED today — 2-root forest)
  // ==========================================================================

  it('PBED-13d the DOCUMENT STREAM is a single tree, not the 2-root forest measured today (RED today)', async () => {
    const run = await zoneRun({ mode: 'path', containerIds: ['zoneA', 'zoneB'] })

    // FIXTURE: the graft is in the document (PBED-13c owns where).
    expect(
      elsOfNode(run.post.els, run.graft.id).length,
      'FIXTURE: the graft must emit in the path-mode document',
    ).toBeGreaterThan(0)

    // ONE DOCUMENT: a FRESH baseline (prevMap `null`) — exactly what a brand-new
    // adapter receives (`PBED-11`'s forest census idiom).
    const docRoots = treeFromOps(run.doc.ops).map((t) => String(t.wire))
    expect(
      docRoots,
      `the document stream carries ${docRoots.length} roots: [${docRoots.join(', ')}] — the graft element the second offering container never claimed is a TOP-LEVEL SIBLING of the page root (the 2-root forest measured today); ONE root means every graft element was appended by its own container`,
    ).toHaveLength(1)

    // …and the DIFF ITSELF left nothing created-but-unappended (the
    // adapter-visible half of the same fact).
    expect(
      treeFromOps(run.post.ops).map((t) => String(t.wire)),
      'the post-bootstrap diff left an element created-but-never-appended — no container in the document claims it (the second offering container never appended the graft)',
    ).toEqual([])
  })

  // ==========================================================================
  // PBED-13e — CONTROL: family mode keeps the DOCUMENTED limit (GREEN today)
  // ==========================================================================

  it('PBED-13e CONTROL — a family-mode tree keeps ORPHAN-EMIT-TOP-LEVEL-LEAK\'s documented limit: 0 appends, both containers empty (GREEN today)', async () => {
    // This half is `ORPHAN-EMIT-TOP-LEVEL-LEAK`'s DOCUMENTED LIMIT
    // (`docs/defects.md`; gate `docs/specs/orphan-emit-gate-review.md` §5 D-3),
    // UNTOUCHED by the fix this case's other halves ask for: a family-mode
    // container is not re-minted from the placement registry at all, so
    // widening the dirty set changes nothing for it. `PBED-12c` remains the
    // single-container family pin (1 element, 0 appends, a 2-root stream) and
    // still holds; this is its two-container twin.
    const run = await zoneRun({ mode: 'family', containerIds: ['zoneA', 'zoneB'] })

    expect(
      run.sup.getCompileMode(),
      'FIXTURE: still FAMILY mode — the compile mode is the variable between this control and PBED-13b',
    ).toBe('family')
    const graftEls = elsOfNode(run.post.els, run.graft.id)
    expect(
      graftEls.length,
      'FIXTURE: the graft must emit in family mode too (it does — as detached top-level fragments); a zero here would make the append census below vacuous',
    ).toBeGreaterThan(0)

    // (1) ZERO appends: nothing in the document claims the graft.
    expect(
      appendsTo(run.post.ops, new Set(graftEls.map((el) => String(el.wire)))),
      'a family-mode container APPENDED the graft — that is the FIXED path-mode behaviour (PBED-13b), NOT this documented limit. If this fails, change THIS FILE deliberately: the family-mode leak is a documented limit + an op-site diagnostic (gate §5 D-3) and the pin must be re-stated, never silently re-rendered',
    ).toEqual([])

    // (2) …and BOTH containers stay EMPTY in the html (neither receives the
    // node — the same staleness, plus the family limit).
    const marker = `data-node-id="${run.graft.id}"`
    for (const c of run.containers) {
      const authored = authoredIdOf(c)
      const slice = outerHtmlOfAuthoredId(run.post.html, authored)
      expect(slice, `FIXTURE: offering container #${authored} is absent from the family-mode document`).toBeDefined()
      expect(
        slice ?? '',
        `#${authored} CONTAINS the graft in family mode — the documented family-mode limit says no container is populated (ORPHAN-EMIT-TOP-LEVEL-LEAK, gate D-3); the path-mode fix must not move this half`,
      ).not.toContain(marker)
    }
  })

  // ==========================================================================
  // PBED-13f — CONTROL: ONE offering container is unchanged (GREEN today)
  // ==========================================================================

  it('PBED-13f CONTROL — the widened rule does not change the SINGLE-container case: 1 append, 1 element, 1 document root (GREEN today)', async () => {
    // `PBED-10` owns the single-container shape's pin; this case only asserts
    // that the widened dirty set leaves it alone.
    const run = await zoneRun({ mode: 'path', containerIds: ['zoneA'] })

    expect(
      run.graftStates.map((s) => String(s.pathKey)),
      'CONTROL: one offering container must mint exactly ONE placement state',
    ).toHaveLength(1)
    const graftEls = elsOfNode(run.post.els, run.graft.id)
    expect(
      graftEls.map((el) => String(el.wire)),
      `CONTROL: the single-container case emitted ${graftEls.length} graft element(s) — the widened rule must not duplicate it`,
    ).toHaveLength(1)
    const graftWire = String(graftEls[0]!.wire)
    const appends = appendsTo(run.post.ops, new Set([graftWire]))
    expect(
      appends.map(pairLabel),
      'CONTROL: the single-container case must still append the graft EXACTLY once (the widened dirty set changes nothing when there is one offering container)',
    ).toHaveLength(1)
    expect(
      treeFromOps(run.doc.ops).map((t) => String(t.wire)),
      'CONTROL: the single-container document must stay ONE tree',
    ).toHaveLength(1)
    const only = run.containers[0]!
    expect(
      outerHtmlOfAuthoredId(run.post.html, authoredIdOf(only)) ?? '',
      `CONTROL: the graft is not INSIDE the only offering container #${authoredIdOf(only)} (PBED-10 carries this pin; a widened dirty set must not regress it)`,
    ).toContain(`data-node-id="${run.graft.id}"`)
  })
})

// ============================================================================
// PBED-14 — `compileMode:'path'` declared over a FAMILY-bootstrapped tree:
//          REFUSE LOUDLY (the owner's 2026-11-23 ruling on gate §5 ruling 3)
// ============================================================================
//
// **THE OWNER'S RULING** (`docs/specs/path-mode-resolution-gate-review.md` §5
// ruling 3, 2026-11-23): the compile-mode override — `compileMode: 'path'`
// declared over a tree whose bootstrap was FAMILY — must **"refuse loudly."**
// (The gate offered "forbid it, documented as unsupported" or "make it refuse
// loudly"; the owner took the second.)
//
// **THE CONFIGURATION AND ITS MEASURED COST** (probe P-7 arm **A5**,
// `docs/defects.md` row `PATH-MODE-SILENT-UNRESOLVED`, closed; the arm's facts
// re-measured by this file's construction): the family bootstrap emits a
// binding (`theme: 'dark'`) into the consumer's state; the FIRST `path`-mode
// pass-2 **DELETES it** (`bindings {}`, an `unresolved` entry left behind) —
// silently, because the bootstrap's states are FAMILY states (`forkKey`
// absent) and a path re-mint replaces them, so the resolution universe the
// binding came from (the family walk) is gone.
//
// **WHAT THE RULING IS, AND IS NOT.** It is a DIAGNOSTIC ruling: the engine
// must say something clear when this configuration is actually exercised,
// instead of deleting an emitted binding in silence. It is NOT a semantics
// change — the deletion still happens, the op still applies, nothing is
// rejected or skipped; the warn makes the loss honest. `PBED-14a` pins the
// deletion as today's behaviour for exactly that reason, and `PBED-14d` pins
// that the diagnostic changed nothing.
//
// **THE TREE (deliberately minimal — only what A5 needs).** `div#root` with
// ONE child of interest: `div#panel`, a CONSUMER that references `theme` into
// `props.theme`, with `#inner > #deeper` beneath it and `#deeper` the PROVIDER
// (`theme: 'dark'`). The provider is a DESCENDANT of the consumer — the one
// direction the family walk (`fitReference`: self → descendants → ancestors)
// resolves and the path walk (`resolvePathTargets`: self → path ancestors
// only) does not — so the bootstrap's binding is a genuine family-universe
// fact, not a restatement of the path domain.
//
// The consumer is deliberately **NOT** placement-routed: a `content`-anchored
// dirty node compiles through `compilePath` in BOTH modes
// (`supervisor.ts` `runPass2AndFlush`'s `placementRouted` branch), so it could
// never exhibit the MODE mismatch. A plain family-chain consumer is the shape
// where the declared mode alone decides the route —
// `compilePathSlice(slice)` under `path` vs `compile(focusedSlice)` under
// `family`.
//
// **THE SANCTIONED OP** is the same one `PBED-6` uses: ONE `state-slice` props
// write on the consumer. It dirties exactly that node (no topology change), so
// the ONLY difference between the two modes' pass-2 is the compile route —
// which is precisely the variable the owner ruled on.
//
// WHAT THIS BLOCK PINS, per sub-case (fixture preconditions first, always):
//  - **PBED-14a** the diagnostic FIRES, exactly once, on a supervisor whose
//    mode is declared `path` over a family bootstrap, and NAMES the mode
//    mismatch; the deletion it reports is unchanged (the bootstrap state
//    carries `theme: 'dark'`, the post-flush state does not).
//    **RED today** — no such diagnostic exists.
//  - **PBED-14b** CONTROL — path bootstrap + path mode (the SUPPORTED
//    configuration) warns nothing; `PBED-10`/`PBED-13` are its behaviour pins,
//    so this case reads diagnostics only. **GREEN today.**
//  - **PBED-14c** CONTROL — family bootstrap + family mode warns nothing, and
//    the binding SURVIVES the same op (the contrast that proves the deletion
//    in 14a is the mode mismatch, not the op). **GREEN today.**
//  - **PBED-14d** CONTROL — the diagnostic is a diagnostic only: the op is
//    still `applied`, it is still journaled, and the emitted element census is
//    unchanged versus the same construction that does not warn (nothing was
//    rejected, skipped or filtered). **GREEN today.**
//
// RED FIRST (AGENTS.md item 8): written before the diagnostic exists. Only
// `PBED-14a` is red; `14b`/`14c`/`14d` pin behaviour the engine already has.
// No `src/**` change accompanies this file.

/**
 * The PBED-14 authored page (see this block's header): a family-chain CONSUMER
 * (`#panel`, `component.reference 'theme' → props.theme`) over a DESCENDANT
 * PROVIDER (`#deeper`, `value: 'dark'`), with `#inner` in between — probe P-7's
 * `#panel`/`#inner`/`#deeper` shape, which is the only family-vs-path
 * resolution difference the A5 arm needs.
 *
 * Every PBED-14 case builds its OWN tree from this envelope: node ids are
 * minted from a module counter, so each run's states get distinct `pathKey`s
 * and one case can never be silenced by another's diagnostics (the
 * `PATH-MODE-DIAGNOSTIC-UNGUARDED` per-process dedup class).
 */
function pb14Envelope(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        children: [
          {
            type: 'div',
            css: { id: 'panel' },
            props: { id: 'panel' },
            component: { reference: 'theme', target: 'props.theme' },
            children: [
              {
                type: 'div',
                css: { id: 'inner' },
                props: { id: 'inner' },
                children: [
                  {
                    type: 'span',
                    css: { id: 'deeper' },
                    props: { id: 'deeper' },
                    component: { reference: 'theme', value: 'dark' },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

/** The STATE-level twin of `isPathDomain(el)`: a path state carries
 *  `forkKey === pathKey` (set at mint, `node.ts` `mintPathState`); a FAMILY
 *  state carries no `forkKey` at all. A public field of the compiled state, not
 *  a compile-mode probe — and deliberately the engine's OWN predicate
 *  (`render-helpers.ts` `isPathState`, the one `supervisor.ts:714` already uses
 *  to infer the bootstrap's domain), so a case can never disagree with the
 *  engine about which domain a recorded state belongs to. */
function stateIsPathDomain(s: CompiledState): boolean {
  return isPathState(s)
}

/** The authored ids PBED-14's document always carries — the census that a
 *  diagnostic did not reject/skip/filter an element reads it off the emitted
 *  elements (`PBED-14d`). */
const PB14_AUTHORED_IDS = ['root', 'panel', 'inner', 'deeper'] as const

/**
 * THE MODE-MISMATCH DIAGNOSTIC, read off the flattened `console.warn` lines.
 *
 * The owner ruled the CONTENT (a clear diagnostic when `compileMode: 'path'`
 * is exercised over a family bootstrapped tree), never the WORDING: any line
 * that names the mode class (a word carrying `mode` / `compil…` / `bootstrap…`)
 * AND `path` counts. The filter is deliberately tolerant for that reason —
 * and deliberately NARROW enough to exclude the OTHER diagnostics this
 * construction legitimately emits: the path resolver's landed loud half reports
 * the deleted reference as `unresolved-reference at <pathKey>` (the
 * `PATH-MODE-SILENT-UNRESOLVED` loud channel), which names neither the mode
 * nor `path` and must never be mistaken for the ruling's diagnostic.
 */
const PB14_MODE_WORD = /mode|compil|bootstrap/i
const PB14_PATH_WORD = /path/i

function modeMismatchWarns(lines: readonly string[]): string[] {
  return lines.filter((l) => PB14_MODE_WORD.test(l) && PB14_PATH_WORD.test(l))
}

interface Pb14Run {
  sup: Supervisor
  root: Node
  panel: Node
  /** the consumer's live states IMMEDIATELY after the bootstrap (before any op). */
  bootStates: CompiledState[]
  /** every recorded bootstrap state is a PATH state (true ⇔ the bootstrap and
   *  the declared mode AGREE — the supported configuration's precondition). */
  bootAllPath: boolean
  boot: RenderRead
  /** the consumer's live states after the op + the supervisor's settled flush. */
  postStates: CompiledState[]
  post: RenderRead
  res: ApplyOutcome
  /** the journal as the host reads it after the op (`journalEntries()`). */
  journal: ReturnType<Supervisor['journalEntries']>
  /** flattened `console.warn` lines, per phase of the construction. */
  warnsAtBootstrap: string[]
  warnsAfterFirstFlush: string[]
  warnsAfterSecondFlush: string[]
  /** the second sanctioned op's outcome (the one-shot probe) — never asserted
   *  for its own shape, only for the extra diagnostics it must NOT add. */
  second: ApplyOutcome
}

/**
 * ONE PBED-14 run: translate the A5 page → `Supervisor({ compileMode })` (the
 * mode is always DECLARED, never inferred) → the tree's own canonical
 * bootstrap in the requested domain (`opts.bootstrap`: `family` =
 * `tree.root.compile(tree.nodes)` → `recordResolved`, `path` = one
 * `compilePath` per node → `recordResolved`) → the bootstrap render → ONE
 * sanctioned `state-slice` props write on the consumer → `flush()` → the
 * post-flush render → ONE MORE sanctioned op + `flush()` (the one-shot probe)
 * → a final render.
 *
 * `console.warn` is spied from BEFORE the bootstrap (the diagnostic may
 * legitimately be raised at the bootstrap seam — `recordResolved` is where the
 * two facts first coexist — or at the first path-mode pass-2; this run must
 * hear it either way) and restored at the end. Args are flattened with
 * `args.map(String).join(' ')` (the `PBED-12` idiom).
 *
 * READ THE `els` ARRAY, NOT THE ADAPTER'S `toString()`: under a declared
 * `path` mode over a FAMILY bootstrap the re-mint re-keys every wire (family
 * wires → path wires), so a long-lived `SSRFragmentAdapter` zeroes its document
 * — `POST-BOOTSTRAP-EMIT-DROP`'s own mechanism (`PBED-1..4`), a SECOND
 * consequence of the same override. The element census these cases read is the
 * emit layer's output, which the override does not change.
 */
async function pb14Run(opts: { mode: 'family' | 'path'; bootstrap: 'family' | 'path' }): Promise<Pb14Run> {
  const lines: string[] = []
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(' '))
  })

  const tree = translateLegacy(pb14Envelope())
  const authored = (cssId: string): Node => {
    const n = tree.nodes.find((x) => x.css?.id === cssId || x.props?.id === cssId)
    if (!n) throw new Error(`PBED-14 fixture: the envelope has no #${cssId} node`)
    return n
  }
  const root = tree.root
  const panel = authored('panel')

  const sup = new Supervisor({ compileMode: opts.mode })
  for (const n of tree.nodes) sup.registerNode(n)

  const series: HostSeries = {
    prevStates: opts.bootstrap === 'path' ? bootstrapStates(sup, tree.nodes) : familyBootstrapStates(sup, tree),
    prevMap: null,
  }
  const bootStates = [...(series.prevStates.get(panel.id) ?? [])]
  const bootAllPath =
    series.prevStates.size > 0 && [...series.prevStates.values()].every((arr) => arr.every(stateIsPathDomain))

  const adapter = new SSRFragmentAdapter()
  const boot = renderPass(sup, adapter, series)
  const warnsAtBootstrap = [...lines]

  const res = sup.apply({
    kind: 'state-slice',
    node: panel,
    mutation: [{ targetProp: 'props.tick', mode: 'replace', value: '1' }],
  })
  await sup.flush()
  mergePass2(sup, series.prevStates)
  const postStates = [...(series.prevStates.get(panel.id) ?? [])]
  const post = renderPass(sup, adapter, series)
  const warnsAfterFirstFlush = [...lines]
  const journal = sup.journalEntries()

  // THE ONE-SHOT PROBE: a second sanctioned op + flush on the SAME supervisor.
  const second = sup.apply({
    kind: 'state-slice',
    node: panel,
    mutation: [{ targetProp: 'props.tick', mode: 'replace', value: '2' }],
  })
  await sup.flush()
  mergePass2(sup, series.prevStates)
  renderPass(sup, adapter, series)
  const warnsAfterSecondFlush = [...lines]
  sup.takePass2States()
  warn.mockRestore()

  return {
    sup,
    root,
    panel,
    bootStates,
    bootAllPath,
    boot,
    postStates,
    post,
    res,
    journal,
    warnsAtBootstrap,
    warnsAfterFirstFlush,
    warnsAfterSecondFlush,
    second,
  }
}

describe("PBED-14 — compileMode:'path' over a FAMILY-bootstrapped tree must REFUSE LOUDLY (owner ruling 2026-11-23)", () => {
  // the diagnostic channel is `console.warn`; restore whatever a case spied
  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ==========================================================================
  // PBED-14a — THE DIAGNOSTIC FIRES (RED TODAY)
  // ==========================================================================

  it("PBED-14a a declared `path` mode over a FAMILY bootstrap WARNS once, naming the mode mismatch, and the deletion it reports is unchanged (RED today)", async () => {
    const run = await pb14Run({ mode: 'path', bootstrap: 'family' })

    // ---- FIXTURE (1): the configuration really is the A5 one --------------
    expect(
      run.sup.getCompileMode(),
      'FIXTURE: the supervisor must be in the DECLARED path mode at the op (a mode inferred over by `recordResolved` would be the supported configuration, not the mismatch this case measures)',
    ).toBe('path')
    expect(
      run.bootStates.length,
      'FIXTURE: the family bootstrap must mint exactly ONE state for the consumer',
    ).toBe(1)
    expect(
      stateIsPathDomain(run.bootStates[0]!),
      "FIXTURE: the recorded bootstrap state must be a FAMILY state (no `forkKey`): if it were a path state, `path` mode and the bootstrap would AGREE and there would be no universe to lose",
    ).toBe(false)

    // ---- FIXTURE (2): the bootstrap state CARRIES the binding -------------
    // Without this the deletion 14a pins could be a no-op, and a diagnostic
    // about a lost binding would be reporting nothing.
    expect(
      run.bootStates[0]!.bindings,
      'FIXTURE: the FAMILY bootstrap must resolve the DESCENDANT-provided "theme" into the consumer\'s state — the binding whose silent deletion this ruling is about (probe P-7 arm A5; the family walk reaches 3 levels down, resolve.ts fitReference)',
    ).toMatchObject({ theme: 'dark' })
    expect(
      run.bootStates[0]!.unresolved,
      'FIXTURE: the bootstrap resolved "theme", so it must record NO unresolved entry for it',
    ).toHaveLength(0)
    const bootPanelEl = byNodeId(run.boot.els).get(run.panel.id)
    expect(bootPanelEl, 'FIXTURE: the consumer must emit at bootstrap').toBeDefined()
    expect(
      bootPanelEl!.props['prop:theme'],
      'FIXTURE: the bootstrap binding must reach EMIT — the emitted consumer element must carry `prop:theme` (the loss is visible in the document, not only in the state)',
    ).toBe('dark')

    // ---- (1) THE DIAGNOSTIC: exactly ONE line, naming the mode mismatch ---
    // Captured from BEFORE the bootstrap through the settled flush, so it does
    // not matter whether the engine raises it at the `recordResolved` seam
    // (where the declared mode and the family states first coexist) or at the
    // first path-mode pass-2: the ruling's requirement is that the
    // configuration, once EXERCISED, is loud.
    const atFirstFlush = modeMismatchWarns(run.warnsAfterFirstFlush)
    expect(
      atFirstFlush,
      `compileMode:'path' declared over a FAMILY-bootstrapped tree emitted ${atFirstFlush.length} console.warn line(s) naming the mode mismatch — the owner ruled it must REFUSE LOUDLY (gate §5 ruling 3, 2026-11-23: "Refuse loudly."), because the first path-mode pass-2 SILENTLY DELETES the binding the family bootstrap emitted (probe P-7 arm A5). Lines per phase — bootstrap: ${JSON.stringify(modeMismatchWarns(run.warnsAtBootstrap))}, after the op+flush: ${JSON.stringify(modeMismatchWarns(run.warnsAfterFirstFlush))}; ALL measured warn lines: ${JSON.stringify(run.warnsAfterFirstFlush)}`,
    ).toHaveLength(1)

    // ---- (2) …and it is ONE-SHOT per supervisor: a second op adds none ----
    // The condition is a PER-SUPERVISOR configuration fact (declared mode +
    // recorded bootstrap domain); it does not become truer on every op, and a
    // per-op warn would flood a host that writes on every tick.
    const atSecondFlush = modeMismatchWarns(run.warnsAfterSecondFlush)
    expect(
      atSecondFlush,
      `a SECOND sanctioned op + flush on the same supervisor added ${atSecondFlush.length - atFirstFlush.length} more mode-mismatch line(s) (${JSON.stringify(atSecondFlush)}): the diagnostic is owed ONCE per supervisor, keyed on the configuration — not once per op`,
    ).toHaveLength(1)

    // ---- (3) THE DELETION, PINNED AS UNCHANGED BEHAVIOUR ------------------
    // The ruling is a DIAGNOSTIC, not a fix: the path re-mint still replaces
    // the family-bootstrapped states, so the binding is still gone after the
    // flush. The warn makes that loss HONEST; it does not restore it. If a
    // future change makes this binding SURVIVE, change THIS FILE deliberately
    // — that would be a resolution-semantics change, which the owner
    // explicitly did not rule (`docs/decisions.md`
    // `PATH-MODE-RESOLUTION-UNIVERSE`).
    expect(
      run.postStates.length,
      'FIXTURE: the path-mode pass-2 must settle exactly ONE state for the consumer',
    ).toBe(1)
    expect(
      stateIsPathDomain(run.postStates[0]!),
      'FIXTURE: the post-flush state must be a PATH state — that is the re-mint that replaces the family bootstrap state',
    ).toBe(true)
    expect(
      run.postStates[0]!.bindings,
      `the consumer's binding SURVIVED the path-mode pass-2 (bindings ${JSON.stringify(run.postStates[0]!.bindings)}) — that is a RESOLUTION change, not the diagnostic this ruling ordered. Today the family-bootstrapped binding is replaced by the path state's bindings (A5), and only the diagnostic may be added`,
    ).not.toMatchObject({ theme: 'dark' })
    expect(
      run.postStates[0]!.unresolved,
      'the post-flush state must record WHY the binding is gone (`unresolved-reference` for "theme") — the state channel the deletion leaves behind',
    ).toContainEqual({ referenceName: 'theme', code: 'unresolved-reference' })
    const postPanelEl = byNodeId(run.post.els).get(run.panel.id)
    expect(postPanelEl, 'the consumer stopped emitting after the sanctioned op').toBeDefined()
    expect(
      postPanelEl!.props['prop:theme'],
      'the emitted consumer element still carries `prop:theme` — then the A5 deletion this ruling reports is not live any more and this case must be re-stated deliberately',
    ).toBeUndefined()
  })

  // ==========================================================================
  // PBED-14b — CONTROL: path bootstrap + path mode (the SUPPORTED config)
  // ==========================================================================

  it('PBED-14b CONTROL — a PATH bootstrap under a declared `path` mode is the SUPPORTED configuration and warns NOTHING (GREEN today)', async () => {
    // The behaviour pins this control does NOT restate: `PBED-10` (the append
    // under path enumeration) and `PBED-13` (the per-container population).
    // This case reads DIAGNOSTICS only.
    const run = await pb14Run({ mode: 'path', bootstrap: 'path' })

    // ---- FIXTURE: the mode and the bootstrap AGREE ------------------------
    expect(run.sup.getCompileMode(), 'FIXTURE: the supervisor must be in path mode').toBe('path')
    expect(
      run.bootAllPath,
      'FIXTURE: every recorded bootstrap state must be a PATH state — that is what makes this the supported configuration (the mode the tree was bootstrapped in is the mode declared on the supervisor)',
    ).toBe(true)
    expect(run.bootStates, 'FIXTURE: the path bootstrap must mint a state for the consumer').toHaveLength(1)

    // ---- THE CONTROL: no mode-mismatch diagnostic -------------------------
    expect(
      modeMismatchWarns(run.warnsAtBootstrap),
      `the SUPPORTED configuration (path bootstrap + declared path mode) warned at the bootstrap: ${JSON.stringify(modeMismatchWarns(run.warnsAtBootstrap))} — there is no mismatch to report, and a diagnostic here would fire on every path-mode host`,
    ).toEqual([])
    expect(
      modeMismatchWarns(run.warnsAfterFirstFlush),
      `the SUPPORTED configuration warned at the op/flush: ${JSON.stringify(modeMismatchWarns(run.warnsAfterFirstFlush))} — the diagnostic must be scoped to the OVERRIDE (a family bootstrap under a declared path mode), never to path mode itself`,
    ).toEqual([])
    expect(
      modeMismatchWarns(run.warnsAfterSecondFlush),
      'the SUPPORTED configuration warned on a second op — nothing but the configuration may raise this diagnostic',
    ).toEqual([])

    // ---- …and nothing was LOST, because nothing was there to lose ---------
    // The path walk does not reach a descendant provider, so the path
    // bootstrap never emitted this binding: the re-mint is a no-op on
    // `bindings` here. That is exactly why the supported configuration has
    // nothing to report (and why 14a's deletion is the override's doing).
    expect(
      run.bootStates[0]!.bindings,
      'FIXTURE: the path bootstrap must NOT resolve the descendant-provided "theme" (the path walk covers path ancestors only) — this control is vacuous without that reading',
    ).toEqual({})
    expect(
      run.postStates[0]!.bindings,
      'CONTROL: the op CHANGED the consumer\'s bindings in the supported configuration — then this control cannot distinguish "the mode mismatch deletes a binding" from "any op deletes a binding"',
    ).toEqual(run.bootStates[0]!.bindings)
  })

  // ==========================================================================
  // PBED-14c — CONTROL: family bootstrap + family mode
  // ==========================================================================

  it('PBED-14c CONTROL — a FAMILY bootstrap under a declared `family` mode warns NOTHING and the binding SURVIVES the same op (GREEN today)', async () => {
    const run = await pb14Run({ mode: 'family', bootstrap: 'family' })

    // ---- FIXTURE: same bootstrap domain, matching declared mode -----------
    expect(run.sup.getCompileMode(), 'FIXTURE: the supervisor must be in family mode').toBe('family')
    expect(
      stateIsPathDomain(run.bootStates[0]!),
      'FIXTURE: the family bootstrap must record a FAMILY state for the consumer',
    ).toBe(false)
    expect(
      run.bootStates[0]!.bindings,
      'FIXTURE: the family bootstrap must resolve the descendant-provided "theme" (this control is vacuous without it)',
    ).toMatchObject({ theme: 'dark' })

    // ---- THE CONTROL: no mode-mismatch diagnostic -------------------------
    expect(
      modeMismatchWarns(run.warnsAtBootstrap),
      `a FAMILY bootstrap under a declared FAMILY mode warned: ${JSON.stringify(modeMismatchWarns(run.warnsAtBootstrap))} — the two agree, so there is no universe to lose`,
    ).toEqual([])
    expect(
      modeMismatchWarns(run.warnsAfterFirstFlush),
      `a FAMILY bootstrap under a declared FAMILY mode warned at the op/flush: ${JSON.stringify(modeMismatchWarns(run.warnsAfterFirstFlush))} — the diagnostic is owed only to the OVERRIDE`,
    ).toEqual([])
    expect(
      modeMismatchWarns(run.warnsAfterSecondFlush),
      'a FAMILY bootstrap under a declared FAMILY mode warned on a second op',
    ).toEqual([])

    // ---- …and the same op does NOT delete the binding ---------------------
    // THE CONTRAST that gives 14a its meaning: identical tree, identical op,
    // identical bootstrap recipe; the ONLY variable is the declared mode. In
    // family mode the pass-2 re-compiles the consumer over the bounded family
    // slice (which is descendant-closed, `focusedSliceFor`), so the binding
    // survives — the deletion 14a pins is the path re-mint's doing.
    expect(
      run.postStates[0]!.bindings,
      `the same sanctioned op DELETED the binding in FAMILY mode (bindings ${JSON.stringify(run.postStates[0]!.bindings)}) — then 14a's deletion would not be attributable to the compile-mode override`,
    ).toMatchObject({ theme: 'dark' })
    const postPanelEl = byNodeId(run.post.els).get(run.panel.id)
    expect(postPanelEl, 'the consumer stopped emitting after the sanctioned op in family mode').toBeDefined()
    expect(
      postPanelEl!.props['prop:theme'],
      'the emitted consumer element lost `prop:theme` in FAMILY mode — the deletion is not mode-attributable then',
    ).toBe('dark')
  })

  // ==========================================================================
  // PBED-14d — CONTROL: the diagnostic is a DIAGNOSTIC only
  // ==========================================================================

  it('PBED-14d CONTROL — the warning changes NO behaviour: the op still applies, it is journaled, and the emitted element census is unchanged (GREEN today)', async () => {
    // The comparison run is the SAME construction (same envelope, same family
    // bootstrap recipe, same sanctioned op) whose supervisor is NOT declared
    // `path` — i.e. the configuration that has no warning to give. The
    // declared mode is the only variable, and it is exactly the variable the
    // ruling keys the diagnostic on; anything the warn may not do (reject the
    // op, skip the compile, filter an element) shows up as a census difference
    // between the two runs.
    const warned = await pb14Run({ mode: 'path', bootstrap: 'family' })
    const unwarned = await pb14Run({ mode: 'family', bootstrap: 'family' })

    // ---- FIXTURE: the two runs really are the two configurations ----------
    expect(warned.sup.getCompileMode(), 'FIXTURE: the first run is the overridden one').toBe('path')
    expect(unwarned.sup.getCompileMode(), 'FIXTURE: the comparison run is the family-mode one').toBe('family')
    expect(
      [stateIsPathDomain(warned.bootStates[0]!), stateIsPathDomain(unwarned.bootStates[0]!)],
      'FIXTURE: both runs must be bootstrapped by the SAME (family) recipe — the path state the overridden run ends up holding is the post-flush RE-MINT, never its bootstrap',
    ).toEqual([false, false])
    expect(
      stateIsPathDomain(warned.postStates[0]!),
      'FIXTURE: the overridden run must end up holding the path re-mint — that is the pass-2 the diagnostic reports',
    ).toBe(true)
    expect(warned.boot.els.length, 'FIXTURE: the overridden run must emit a document at bootstrap').toBeGreaterThan(0)

    // ---- (1) THE OP STILL APPLIES ----------------------------------------
    expect(
      warned.res.status,
      'the sanctioned op was NOT applied under the declared path mode — a warn+reject (or a throw) is a BEHAVIOUR change: the owner ruled a DIAGNOSTIC (gate §5 ruling 3), not a veto',
    ).toBe('applied')
    expect(warned.second.status, 'the second sanctioned op was not applied either').toBe('applied')

    // ---- (2) …and it is still JOURNALED ----------------------------------
    if (warned.res.status !== 'applied') return
    expect(warned.res.journalId, 'the applied op must still carry a journal id').toBeTypeOf('string')
    expect(
      warned.journal.entries.map((e) => `${e.kind}:${e.status}`),
      `the journal does not hold the one sanctioned op as a plain applied state-slice (measured: ${JSON.stringify(warned.journal.entries)}) — a diagnostic must not change what is recorded`,
    ).toEqual(['state-slice:applied'])
    expect(warned.journal.totalEntries, 'exactly one op was journaled at the time it was read').toBe(1)

    // ---- (3) NOTHING WAS REJECTED, SKIPPED OR FILTERED --------------------
    // The census is the EMIT layer's element list (`els`), never the adapter's
    // `toString()`: in this configuration the path re-mint ALSO re-keys every
    // wire (family wires → path wires), so a long-lived `SSRFragmentAdapter`
    // zeroes its document — `POST-BOOTSTRAP-EMIT-DROP`'s mechanism, which
    // `PBED-1..4` pin in their own direction. That is a SECOND consequence of
    // the same override, not the diagnostic's doing, and this control measures
    // only the diagnostic's.
    //
    // (a) within the run: the flush did not shrink the emitted set.
    expect(
      warned.post.els.length,
      `the post-flush EMIT produced ${warned.post.els.length} element(s) where the bootstrap produced ${warned.boot.els.length} — the diagnostic must not drop an element`,
    ).toBe(warned.boot.els.length)
    expect(
      warned.post.els.map((el) => String(el.props['prop:id'])).sort(),
      `the post-flush EMIT is not the authored element set — a diagnostic must not reject, skip or filter an element (measured: ${JSON.stringify(warned.post.els.map((el) => String(el.props['prop:id'])))})`,
    ).toEqual([...PB14_AUTHORED_IDS].sort())
    // (b) against the configuration that does not warn: the SAME census.
    expect(
      warned.post.els.length,
      `the overridden run emitted ${warned.post.els.length} element(s) while the same construction without the diagnostic emitted ${unwarned.post.els.length} — the warning is a diagnostic and must not change what the compile produces (owner ruling: the DELETION still happens; the warn names it)`,
    ).toBe(unwarned.post.els.length)
    expect(
      warned.post.els.map((el) => String(el.props['prop:id'])).sort(),
      'the emitted element SET differs between the overridden run and the same construction that does not warn — nothing may be rejected, skipped or filtered by a diagnostic',
    ).toEqual(unwarned.post.els.map((el) => String(el.props['prop:id'])).sort())
    // (c) …and the second op changed nothing either (the one-shot probe must
    // not have become a gate): the journal grew by exactly one entry.
    expect(
      warned.journal.totalEntries + 1,
      'the second sanctioned op was not journaled — the diagnostic turned into a gate after its first emission',
    ).toBe(warned.sup.journalEntries().totalEntries)
  })
})
