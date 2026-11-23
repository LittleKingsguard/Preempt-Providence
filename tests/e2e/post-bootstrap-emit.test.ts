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
 * never the mechanism — the fix stance is still an OPEN contract decision
 * (RCA §5: (A) sticky path identity, (B) an explicit tree-level compile mode,
 * (C) adapter root re-capture — rejected as a fix alone). Every case below must
 * therefore stay green under ANY of (A)/(B), and no case reads `makeCs`,
 * `isPathState`, `forkKey`-minting internals or the internal op sequence:
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
 *
 * RED FIRST (AGENTS.md item 8): written before any fix, against a tree where
 * the defect is live. No `src/**` change accompanies this file.
 */
import { describe, it, expect } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import { translateLegacy, type LegacyInitialData, type TranslatedTree } from '../../src/core/translate.js'
import { renderProducingProcess } from '../../src/core/render-helpers.js'
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

function fixture(opts: { cardText?: string } = {}): Fixture {
  const tree = translateLegacy(placementEnvelope(opts))
  const authored = (cssId: string): Node => {
    const n = tree.nodes.find((x) => x.css?.id === cssId || x.props?.id === cssId)
    if (!n) throw new Error(`fixture: the envelope has no #${cssId} node`)
    return n
  }
  const sup = new Supervisor({})
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
})
