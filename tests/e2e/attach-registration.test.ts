/**
 * `ATTACH-UNREGISTERED-SILENT-NOOP` (`docs/defects.md` row of that name) —
 * RED FIRST (AGENTS.md item 8): written against a tree where the defect is
 * live, with no `src/**` change accompanying this file.
 *
 * THE MEASURED CONDITION (the row's P-1/P-2 probes): `apply({kind:'attach',
 * node: <fresh, never registered>, to: <in-tree host>})` returns
 * `{status:'applied', dirtied:[<kid>]}` — and then the pass-2 flush's
 * unregistered-id skip discards the mark: `takePass2States()` is EMPTY, the
 * node is not in `getNode`, nothing emits, ZERO appends. The identical attach
 * after `registerNode(kid)` yields pass-2 states for the attached node, its
 * host AND the root and appends the child into its host. Registration is the
 * whole difference.
 *
 * THE OWNER'S RULED FIX SHAPE: register-if-new inside `attach`, consistent
 * with the other four add-ops (`placement-attach`, `clone-instance`,
 * `layer-apply`, `rows-mint`) — NOT a new rejection code.
 *
 * WHAT THIS FILE ASSERTS — the OBSERVABLE contract, never the mechanism (no
 * case reads `pass2Dirty`, the flush's skip, `markedAt` or any state shape):
 *  - **AR-1** (RED today) after `attach` of a never-registered node, the node
 *    IS retrievable: `supervisor.getNode(id)` returns it and `allNodes()`
 *    contains it — the op-time effect of an add-op, mirroring the control's
 *    explicit `registerNode`.
 *  - **AR-2** (RED today) the flush produces a pass-2 state for the attached
 *    node, its host container AND the root (`takePass2States()` keys).
 *  - **AR-3** (RED today) the render emits the child with EXACTLY ONE
 *    `append` whose `child` is the new node's wire and whose `owner` is the
 *    host's wire, and the html shows the node INSIDE the host.
 *  - **AR-4** (CONTROL — green today, must stay green) the same attach with
 *    `registerNode` first behaves identically: the registered path is pinned
 *    so a fix cannot change it.
 *  - **AR-5** (PIN — green today) the op result stays `{status:'applied'}`
 *    and the journal gains EXACTLY ONE entry: the fix must register, not
 *    re-journal or reject.
 *
 * The render idiom (host-owned `prevMap` + live per-node state map, emit →
 * diff → apply, `{nodeIdAttribute:true}`) and the html-slice reader are the
 * neighbouring e2e file's (`tests/e2e/post-bootstrap-emit.test.ts`); the
 * ops/journal reading is `tests/integration/supervisor.test.ts`'s. A
 * freshly translated tree-root is NOT used for the new node because it
 * carries its own child anchor and `attach` correctly rejects it
 * `single-parent` (pinned behaviour, part of the row's own reading) — the
 * "fresh, never registered" node is the unplaced fixture node the
 * supervisor tests build.
 */
import { describe, it, expect } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'
import { renderProducingProcess } from '../../src/core/render-helpers.js'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import { makeNode } from '../helpers/fixtures.js'
import type { MinimalElement, RenderAdapter, RenderOp } from '../../src/core/render.js'
import type { CompiledState, NodeRef } from '../../src/core/types.js'

// ============================================================================
// Fixture — root > host, translated through the legacy envelope and registered
// in the supervisor (the e2e host shape).
// ============================================================================

/** `div#root` with one family child, `div#host`: the in-tree container the
 *  fresh node is attached onto. */
function hostEnvelope(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        children: [{ type: 'div', css: { id: 'host' }, props: { id: 'host' } }],
      },
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

interface Fixture {
  sup: Supervisor
  root: Node
  host: Node
}

function fixture(): Fixture {
  const tree = translateLegacy(hostEnvelope())
  const authored = (cssId: string): Node => {
    const n = tree.nodes.find((x) => x.css?.id === cssId || x.props?.id === cssId)
    if (!n) throw new Error(`fixture: the envelope has no #${cssId} node`)
    return n
  }
  // The options object is the neighbouring files' host shape and is required:
  // an argument-less construction is mis-read as a root-Node form.
  const sup = new Supervisor({})
  for (const n of tree.nodes) sup.registerNode(n)
  return { sup, root: tree.root, host: authored('host') }
}

/** The fresh, NEVER-registered node under test: an unplaced fixture node with
 *  no anchors, so a single `attach` is a legal op (the row's P-1 shape —
 *  `{status:'applied', dirtied:[<kid>]}`). */
function freshNode(id: string): Node {
  return makeNode({ type: 'span', props: { id } }, id)
}

interface Attached {
  sup: Supervisor
  root: Node
  host: Node
  kid: Node
  result: ReturnType<Supervisor['apply']>
}

/** Register the tree, create the fresh node, `attach` it onto `#host`, then
 *  let the engine's own pass-2 flush settle. `registerFirst` is the CONTROL
 *  arm: the caller explicitly registers the node before the op. */
async function attachFresh(opts: { id: string; registerFirst?: boolean }): Promise<Attached> {
  const { sup, root, host } = fixture()
  const kid = freshNode(opts.id)
  const registeredBefore = sup.getNode(kid.id)
  if (registeredBefore !== undefined) throw new Error('FIXTURE: the fresh node must start unregistered')
  if (opts.registerFirst) sup.registerNode(kid)
  const result = sup.apply({ kind: 'attach', node: kid, to: host })
  await sup.flush()
  return { sup, root, host, kid, result }
}

// ============================================================================
// The render recipe (host-owned prevMap + live per-node state map) — the
// neighbouring e2e file's shape, unchanged.
// ============================================================================

interface HostSeries {
  prevStates: Map<string, CompiledState[]>
  prevMap: Map<NodeRef, MinimalElement> | null
}

/** One render pass: emit the live states → diff against the host's `prevMap`
 *  → apply to the adapter → read the document back through `toString()`. */
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

/** Group a bootstrap compile's actionable states per node (the host's live
 *  state map, family compile — the plain tree's own compile scope). */
function stateMapOf(states: CompiledState[]): Map<string, CompiledState[]> {
  const grouped = new Map<string, CompiledState[]>()
  for (const s of states) {
    const arr = grouped.get(s.nodeId) ?? []
    arr.push(s)
    grouped.set(s.nodeId, arr)
  }
  return grouped
}

/** The emitted element per NODE: every element carries the opt-in
 *  `data:node-id` prop (`renderProducingProcess(…, { nodeIdAttribute: true })`). */
function byNodeId(els: MinimalElement[]): Map<string, MinimalElement> {
  const m = new Map<string, MinimalElement>()
  for (const el of els) {
    const id = el.props['data:node-id']
    if (typeof id === 'string') m.set(id, el)
  }
  return m
}

/** The `append` ops of one diff as plain owner/child pairs — the only public
 *  reading that tells "assembled into the host" from "created and never
 *  appended". */
function appendPairs(ops: RenderOp[]): Array<{ owner: NodeRef; child: NodeRef }> {
  return ops.flatMap((o) => (o.kind === 'append' ? [{ owner: o.owner, child: o.child }] : []))
}

/** The html slice of the element carrying the authored `id`, from its opening
 *  tag to its matching close tag (same-tag depth counted). A bare marker
 *  cannot tell a child assembled INSIDE its host from a fragment serialized
 *  top-level. (Adapted from `tests/e2e/post-bootstrap-emit.test.ts`.) */
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

/** Bootstrap render + the post-attach render, both through the host recipe.
 *  The bootstrap compiles the plain family tree (`root.compile`), so this file
 *  is independent of the path-mode work
 *  (`PATH-MODE-SILENT-UNRESOLVED`) and of the placement-routed bootstrap. */
async function renderAroundAttach(opts: {
  id: string
  registerFirst?: boolean
}): Promise<{
  att: Attached
  /** the pass-2 keys the ONE drain (in the helper) observed — captured here
   *  because `takePass2States()` drains. */
  pass2Keys: NodeRef[]
  r1: { html: string; ops: RenderOp[] }
  r2: { html: string; ops: RenderOp[]; els: MinimalElement[] }
}> {
  const { sup, root, host } = fixture()
  const adapter = new SSRFragmentAdapter()
  const series: HostSeries = { prevStates: stateMapOf(root.compile(sup.allNodes()).actionable), prevMap: null }
  const r1 = renderPass(sup, adapter, series)
  const kid = freshNode(opts.id)
  if (opts.registerFirst) sup.registerNode(kid)
  const result = sup.apply({ kind: 'attach', node: kid, to: host })
  await sup.flush()
  const pass2 = sup.takePass2States()
  const pass2Keys = [...pass2.keys()]
  for (const [id, arr] of pass2) if (sup.getNode(id)?.isInTree) series.prevStates.set(id, arr)
  const r2 = renderPass(sup, adapter, series)
  return { att: { sup, root, host, kid, result }, pass2Keys, r1: { html: r1.html, ops: r1.ops }, r2 }
}

// ============================================================================
// AR-1 — the node is REGISTERED by the op
// ============================================================================

describe('ATTACH-UNREGISTERED-SILENT-NOOP — `attach` must register a new node (register-if-new)', () => {
  it('AR-1 after attach of a never-registered node, the node IS retrievable (getNode + allNodes)', async () => {
    const { sup, host, kid, result } = await attachFresh({ id: 'kid-attach-a' })

    expect(result.status, 'FIXTURE: attaching an unplaced node onto an in-tree host is a sanctioned applied op').toBe('applied')
    // the graph side of the op is already true today — it is the REGISTRY side
    // that silently disagrees (the row's "created and silently discarded").
    expect(kid.state, 'FIXTURE: the attach put the node in-tree').toBe('in-tree')
    expect(kid.parent?.id, 'FIXTURE: the attach set the node\'s parent to the host').toBe(host.id)

    const viaGet = sup.getNode(kid.id)
    expect(
      viaGet?.id,
      `attach reported "applied" for ${kid.id} but supervisor.getNode(${kid.id}) does not resolve it: the node never entered the registry, so the pass-2 flush's unregistered-id skip throws its mark away (ATTACH-UNREGISTERED-SILENT-NOOP)`,
    ).toBe(kid.id)
    expect(
      sup.allNodes().map((n) => n.id),
      `the attached node ${kid.id} is not in supervisor.allNodes(): a host enumerating the tree can never reach the node it just attached, while the other four add-ops (placement-attach, clone-instance, layer-apply, rows-mint) all register`,
    ).toContain(kid.id)
  })

  // ==========================================================================
  // AR-2 — the flush produces the three pass-2 states
  // ==========================================================================

  it('AR-2 the flush produces a pass-2 state for the attached node, its host container AND the root', async () => {
    const { sup, root, host, kid } = await attachFresh({ id: 'kid-attach-b' })
    const pass2 = sup.takePass2States()
    const keys = [...pass2.keys()]

    expect(
      keys,
      `attach(${kid.id} → ${host.id}) produced NO pass-2 state for the attached node — the op was reported applied and its mark was then dropped (measured: takePass2States() keys = ${JSON.stringify(keys)})`,
    ).toContain(kid.id)
    expect(
      keys,
      `the attached node's HOST container (${host.id}) is missing from the pass-2 states: the container's childOrder never learns about the new child`,
    ).toContain(host.id)
    expect(
      keys,
      `the ROOT (${root.id}) is missing from the pass-2 states: the document's entry element is never re-derived for a structural change under it`,
    ).toContain(root.id)
    // each state is a real compiled state for that node (not an empty bucket)
    for (const id of [kid.id, host.id, root.id]) {
      const arr = pass2.get(id) ?? []
      expect(arr.length, `pass-2 stored an EMPTY state list for ${id} — a key with no state cannot reach emit`).toBeGreaterThan(0)
      expect(arr[0]!.nodeId, `the pass-2 state filed under ${id} belongs to ${String(arr[0]!.nodeId)}`).toBe(id)
    }
  })

  // ==========================================================================
  // AR-3 — the render appends the child into its host
  // ==========================================================================

  it('AR-3 the render emits exactly ONE append (owner = host wire, child = new node wire) and shows the node INSIDE the host', async () => {
    const { att, r1, r2 } = await renderAroundAttach({ id: 'kid-attach-c' })
    const { kid, host, result } = att

    expect(result.status, 'FIXTURE: the attach is a sanctioned applied op').toBe('applied')
    expect(r1.html, 'FIXTURE: the bootstrap document must carry the host').toContain('id="host"')

    const elsById = byNodeId(r2.els)
    const kidEl = elsById.get(kid.id)
    const hostEl = elsById.get(host.id)
    expect(kidEl, `the newly attached node ${kid.id} emitted NO element at all: it is absent from the render`).toBeDefined()
    expect(hostEl, 'FIXTURE: the host must still emit after the attach').toBeDefined()
    const kidWire = kidEl!.wire
    const hostWire = hostEl!.wire

    const appends = appendPairs(r2.ops)
    const intoHost = appends.filter((p) => p.owner === hostWire && p.child === kidWire)
    expect(
      intoHost,
      `the diff never appended the new node into its host: expected exactly one append {owner: ${String(hostWire)}, child: ${String(kidWire)}}, measured appends = ${JSON.stringify(appends)} (zero appends = the element is created and never assembled, so the widget does not render in its host)`,
    ).toHaveLength(1)
    expect(
      appends.filter((p) => p.owner === hostWire),
      `the host ${host.id} gained ${appends.filter((p) => p.owner === hostWire).length} appends for ONE attached child — a single attach must append exactly one child`,
    ).toHaveLength(1)

    const hostHtml = outerHtmlOfAuthoredId(r2.html, 'host')
    expect(hostHtml, 'FIXTURE: the host element must be readable in the document (balanced tags)').toBeDefined()
    const kidAuthoredId = String(kid.props.id ?? kid.id)
    expect(
      hostHtml,
      `the new node is NOT inside its host in the rendered document: <div id="host"> … </div> does not contain id="${kidAuthoredId}" — the child either never rendered or serialized as a detached top-level sibling (ORPHAN-EMIT-TOP-LEVEL-LEAK's observable). Document: ${r2.html}`,
    ).toContain(`id="${kidAuthoredId}"`)
  })

  // ==========================================================================
  // AR-4 — CONTROL: the registered path (green today) is pinned
  // ==========================================================================

  it('AR-4 CONTROL — the identical attach with registerNode first behaves identically (registered path pinned)', async () => {
    const { att, pass2Keys, r2 } = await renderAroundAttach({ id: 'kid-attach-d', registerFirst: true })
    const { sup, root, host, kid, result } = att

    expect(result.status, 'the registered path is applied today and must stay applied').toBe('applied')

    const keys = pass2Keys
    // The registered control's measured reading (the row's P-2 counter-probe):
    // pass-2 states for the attached node, its host and the root.
    expect(keys, 'the registered control lost the attached node\'s pass-2 state').toContain(kid.id)
    expect(keys, 'the registered control lost the HOST\'s pass-2 state').toContain(host.id)
    expect(keys, 'the registered control lost the ROOT\'s pass-2 state').toContain(root.id)

    const elsById = byNodeId(r2.els)
    const kidEl = elsById.get(kid.id)
    const hostEl = elsById.get(host.id)
    expect(kidEl, 'the registered control must emit the attached node').toBeDefined()
    expect(hostEl, 'the registered control must emit the host').toBeDefined()
    const appends = appendPairs(r2.ops)
    expect(
      appends.filter((p) => p.owner === hostEl!.wire && p.child === kidEl!.wire),
      `the registered control's append pair moved: expected exactly one {owner: ${String(hostEl!.wire)}, child: ${String(kidEl!.wire)}}, measured ${JSON.stringify(appends)}`,
    ).toHaveLength(1)

    const hostHtml = outerHtmlOfAuthoredId(r2.html, 'host')
    expect(hostHtml, 'FIXTURE: the host must be readable in the registered control').toBeDefined()
    expect(hostHtml, 'the registered control must place the attached node inside its host').toContain(
      `id="${String(kid.props.id ?? kid.id)}"`,
    )
  })

  // ==========================================================================
  // AR-5 — PIN: the op result and the journal are unchanged
  // ==========================================================================

  it('AR-5 the op result stays {status:"applied"} and the journal gains EXACTLY ONE entry', async () => {
    const { sup, host, kid, result } = await attachFresh({ id: 'kid-attach-e', registerFirst: false })

    expect(
      result,
      'attach must keep reporting the plain applied outcome — register-if-new is a registration, never a new rejection code',
    ).toMatchObject({ status: 'applied' })
    expect(result, `FIXTURE: the applied result names the attached node as dirtied (measured: ${JSON.stringify(result)})`).toMatchObject({
      dirtied: [kid.id],
    })

    const entries = sup.journalEntries().entries
    expect(
      entries,
      `one attach must add EXACTLY ONE journal entry — measured ${JSON.stringify(entries)} (two entries would mean the fix journals registration or re-applies the op)`,
    ).toHaveLength(1)
    expect(entries[0]!.kind, 'the single journal entry must be the attach op').toBe('attach')
    expect(entries[0]!.status, 'the single journal entry must record the applied status').toBe('applied')
    // and the node really is the one the entry is about
    expect(kid.parent?.id).toBe(host.id)
  })
})
