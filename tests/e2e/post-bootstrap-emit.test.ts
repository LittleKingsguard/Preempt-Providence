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
import { describe, it, expect } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import { translateLegacy, createLinkHub, type LegacyInitialData, type TranslatedTree } from '../../src/core/translate.js'
import { renderProducingProcess, treeFromOps } from '../../src/core/render-helpers.js'
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
 */
function placementEnvelope(opts: { cardText?: string } = {}): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        children: [
          { type: 'aside', css: { id: 'holder' }, props: { id: 'holder' }, placement: { placementName: 'zone' } },
          { type: 'div', css: { id: 'filler' }, props: { id: 'filler' } },
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

function fixture(opts: { cardText?: string; maxJournalLength?: number; sharedHub?: boolean } = {}): Fixture {
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
