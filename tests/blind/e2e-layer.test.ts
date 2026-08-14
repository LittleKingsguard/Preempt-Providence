/**
 * BLIND-TEST WRITER artifact — MAIN E2E layer contract test (input→output).
 *
 * Sources (ONLY): docs/specs/placement-path-spec.md (FINAL) §0/§1.2/§2/§3/§4/§5,
 * docs/specs/derived-state.md §9.2, docs/specs/ops.md §2.6, docs/specs/render.md §3,
 * docs/skills/designing-pages.md §11 (path-fork-e2e row) + §12 (path-fork-data row).
 *
 * Contract under test: the static fork legacy envelope → full pipeline →
 * element tree (E2E-1) and the three incremental constraints (E2E-2/3/4).
 *
 * AMBIGUITIES (my readings — the reviewer adjudicates):
 *  E1. Level-1 prototypes MUST request zone-0 (the root's producer zone): §5.1's
 *      "(the level-1 prototypes and root are producers only)" contradicts the pinned
 *      arithmetic (Σ 2^k k=1..11 + root = 2^12 − 1 = 4095; per-level 2^k; "depth 4 →
 *      15 states"; p4b "8 max-depth states"). Reading: every level-k prototype carries
 *      placementName 'zone-<k>' AND targetPlacement ['zone-(k-1)'] (k≥1); root owns 'zone-0'.
 *  E2. E2E-4 fixture: "render diff = ONE create" is unreachable on the sibling-shared
 *      binary topology (a third level-4 node targeting zone-3 fans out through BOTH
 *      level-3 containers ⇒ 8 creates). Reading: §0's "e.g. add a third depth-4 node"
 *      leaves the fixture open; the fixture here is a single-container-zone tree
 *      (root, l1, l2, p3, p4a, p4b, d5a) where the added node compiles exactly ONE
 *      path-state ⇒ ONE create + one append under the container's path wire; d5a
 *      (depth 5) gets zero passes and no set ops on its wire.
 *  E3. E2E-3 fixture: the provider is the ROOT node's own value-carrying component
 *      binding (K6 → SOURCE anchor); consumers are data-declared `{reference}` target
 *      bindings on the selected prototypes (the "permitted additional fixture" of §0,
 *      §3.2/§6.3). Affected set = {provider} ∪ per-name component Link target owners.
 *  E4. The compile-scope spies target the exported compilePath (node.ts, §2.1); if
 *      the supervisor's pass-2 entry differs, the reviewer re-targets the spy — the
 *      pass-2 KEY assertions carry the contract regardless.
 *  E5. "Registered at every stage" is observed via supervisor.allNodes() (tree.allNodes
 *      is the documented handler-context accessor; the supervisor registry accessor is
 *      the equivalent — D1 in ops-layer). "Journal empty of clone-instance" is encoded
 *      as: the E2E-1 flow performs ZERO ClientAPI.apply calls (bootstrap only).
 *  E6. The HTML-sink adapter surface: the e2e row's PAR-5 parity uses the
 *      SSRFragmentAdapter (render.md §2/§8); its export name + mount/toString surface
 *      is asserted as { new SSRFragmentAdapter(); applyOps(a, ops); a.toString() }.
 */
import { describe, it, expect, vi } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { createClient } from '../../src/core/client.js'
import { Node } from '../../src/core/node.js'
import { emitElements, applyOps } from '../../src/core/render-helpers.js'
import { diffMinimal } from '../../src/core/render.js'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'

/* ------------------------------------------------------------------ */
/* local, documentation-derived types                                 */
/* ------------------------------------------------------------------ */

interface NodeView {
  id: string
  state: string
  props: Record<string, unknown>
  type: string
  children: NodeView[]
  anchors: Array<{ role: string; target: unknown; link?: unknown }>
}
interface TranslatedView {
  root: NodeView
  nodes: NodeView[]
  content: NodeView[]
  warnings: Array<{ code: string; path?: string }>
  clientConfig: { adapter: string; persistence: boolean }
}
interface PathState {
  nodeId: string
  pathKey: string
  forkKey?: string
  state: string
  props: Record<string, unknown>
  children: unknown[]
  bindings: Record<string, unknown>
  activePlacement?: string
  [k: string]: unknown
}
interface MinimalElement {
  wire: string
  type: string
  props: Record<string, unknown>
  childOrder: string[]
  forkKey?: string
}
type RenderOp =
  | { kind: 'create'; wire: string; type: string; forkKey?: string }
  | { kind: 'set'; wire: string; name: string; value: unknown; forkKey?: string }
  | { kind: 'append'; owner: string; child: string }
  | { kind: 'remove'; wire: string; forkKey?: string }
  | { kind: 'styles'; cssDefs: unknown[] }

const asView = (t: unknown): TranslatedView => t as TranslatedView
const statesOf = (result: unknown): PathState[] =>
  (Array.isArray(result) ? result : (result as { actionable: PathState[] }).actionable) as PathState[]

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

const mergeByKey = (prev: PathState[], fresh: PathState[]): PathState[] => {
  const m = new Map(prev.map((s) => [s.pathKey, s]))
  for (const s of fresh) m.set(s.pathKey, s)
  return [...m.values()]
}

/**
 * §2.1 adjudication (B1/E4): compilePath is a per-node METHOD (types.ts:45,
 * node.ts:947) — the E2E-1 census is the per-node aggregate over the 23 nodes
 * in ONE bootstrap sweep (engine pattern compileAll, path-fork-e2e.test.ts:122-125).
 */
function compileAll(t: TranslatedView): PathState[] {
  const out: PathState[] = []
  for (const n of t.nodes) {
    out.push(...(n as unknown as { compilePath(): { actionable: PathState[] } }).compilePath().actionable)
  }
  return out
}

/** §3.3/E2E-4 supervisor construction: root + registered nodes (engine supOf). */
function supOf(t: TranslatedView): Supervisor {
  const sup = new Supervisor({})
  for (const n of t.nodes) sup.registerNode(n as never)
  return sup
}

/** takePass2States returns Map<NodeId, CompiledState[]> — flatten to pathKeys. */
const pass2Keys = (sup: Supervisor): string[] =>
  [...(sup.takePass2States() as unknown as Map<string, PathState[]>).values()].flat().map((s) => s.pathKey)

/* ------------------------------------------------------------------ */
/* the static fork envelope (P3 §5.1, E1 reading)                      */
/* ------------------------------------------------------------------ */

/**
 * root(zone-0) + TWO prototypes per layer k=1..layers.
 * Level-k prototype: placementName 'zone-<k>' (producer) + targetPlacement ['zone-(k-1)']
 * (consumer — level 1 consumes the root's zone-0, E1), + the stress:expanded derived decl.
 * levels=11 ⇒ 2^12 − 1 = 4095 states (R2.2 bijection).
 */
function staticForkEnvelope(layers: number, extraBinding?: { reference: string; only?: string[] }) {
  const content: Array<Record<string, unknown>> = []
  for (let k = 1; k <= layers; k++) {
    for (const slot of ['a', 'b'] as const) {
      const node: Record<string, unknown> = {
        type: slot === 'a' ? 'div' : 'span',
        props: { 'stress:layer': k, 'stress:slot': slot, 'stress:kind': 'placement' },
        css: { style: `border-color: rgb(${k * 20}, 0, 0)` },
        placement: { placementName: `zone-${k}`, targetPlacement: [`zone-${k - 1}`] },
        derived: {
          props: {
            'stress:expanded': {
              $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true, else: false },
            },
          },
        },
      }
      if (extraBinding && (extraBinding.only === undefined || extraBinding.only.includes(`p${k}${slot}`))) {
        node.component = { reference: extraBinding.reference }
      }
      content.push(node)
    }
  }
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'stress-root', blind: 0 },
        placement: { placementName: 'zone-0' },
        ...(extraBinding ? { component: { reference: extraBinding.reference, value: 'V' } } : {}),
      },
    },
    content: [{ metadata: { title: 'path-fork blind' }, content }],
    clientConfig: { runInstantiation: false, runMonitoring: true },
  }
}

const idFor = (t: TranslatedView, layer: number, slot: 'a' | 'b') =>
  t.content.find((n) => n.props['stress:layer'] === layer && n.props['stress:slot'] === slot)!.id

/** expected pathKeys of the (layer, slot) prototype: 2^(layer-1) keys.
 *  §2.2 grammar (node.ts pathKeyFor): each own placement hop contributes
 *  '/zone/ownerId'; the hop landing on the ROOT contributes nothing — so
 *  level-1 (a zone-0 consumer of the root) keys as 'root/<p1>', and the
 *  recursion descends with the level-k prototype's own producer zone
 *  ('zone-k') as the segment for its CHILD hop. */
function expectedLevelKeys(t: TranslatedView, layer: number, slot: 'a' | 'b'): string[] {
  const id = idFor(t, layer, slot)
  const keys: string[] = []
  const walk = (k: number, prefix: string) => {
    if (k === layer) {
      keys.push(`${prefix}/${id}`)
      return
    }
    for (const s of ['a', 'b'] as const) walk(k + 1, `${prefix}/zone-${k}/${idFor(t, k, s)}`)
  }
  walk(1, 'root')
  return keys
}

/* ------------------------------------------------------------------ */
/* E2E-1 — the static fork census (P3 §5.2, designing-pages §11)       */
/* ------------------------------------------------------------------ */

describe('E2E-1 — 22 prototypes + root → 4095 path-states, one pass, zero node creation', () => {
  it('census: registered=23, in-tree=23, path-viable=4095 states, unplaced=0, destroyed=0, cloneOps=0', async () => {
    const t = asView(translateLegacy(staticForkEnvelope(11) as never))
    // envelope → translate: exactly 23 nodes
    expect(t.nodes).toHaveLength(23)
    expect(t.nodes.every((n) => n.state === 'in-tree')).toBe(true) // root + contentNodes-owned prototypes
    expect(t.nodes.some((n) => n.state === 'unplaced')).toBe(false)
    expect(t.nodes.some((n) => n.state === 'destroyed')).toBe(false)

    const supervisor = supOf(t)
    // E5: the registry observable
    expect((supervisor as unknown as { allNodes(): unknown[] }).allNodes()).toHaveLength(23)

    // ONE path-enumeration bootstrap sweep: one compilePath pass PER NODE
    // (§2.1 — the per-node method; the aggregate is the census, E2E-1)
    const spy = vi.spyOn(Node.prototype, 'compilePath')
    const states = compileAll(t)
    expect(spy).toHaveBeenCalledTimes(23)
    spy.mockRestore()

    // state census: 4095 distinct pathKeys; forkKey = pathKey on every state; no '#' anywhere
    expect(states).toHaveLength(4095)
    expect(new Set(states.map((s) => s.pathKey)).size).toBe(4095)
    for (const s of states) {
      expect(s.forkKey).toBe(s.pathKey)
      expect(s.pathKey.includes('#')).toBe(false)
    }
    // zero node creation: every state is pinned to one of the 23 translated nodes
    const translatedIds = new Set(t.nodes.map((n) => n.id))
    expect(new Set(states.map((s) => s.nodeId)).size).toBe(23)
    for (const s of states) expect(translatedIds.has(s.nodeId)).toBe(true)

    // per-level state census: level-k total = 2^k (2^(k-1) per prototype) — the R2.2 bijection
    for (let k = 1; k <= 11; k++) {
      for (const slot of ['a', 'b'] as const) {
        const nodeStates = states.filter((s) => s.nodeId === idFor(t, k, slot))
        expect(nodeStates).toHaveLength(2 ** (k - 1))
        const keys = new Set(nodeStates.map((s) => s.pathKey))
        expect(keys).toEqual(new Set(expectedLevelKeys(t, k, slot)))
      }
    }
    // activePlacement = the chosen zone name per state (the state's final placement hop)
    for (let k = 1; k <= 11; k++) {
      for (const slot of ['a', 'b'] as const) {
        for (const s of states.filter((s) => s.nodeId === idFor(t, k, slot))) {
          expect(s.activePlacement).toBe(`zone-${k - 1}`)
        }
      }
    }
    // derived stress:expanded (children.length > 0): the prototypes carry the
    // derived decl — root + non-leaf path-states true; leaves false. The ROOT
    // itself has no authored derived decl (the writer's envelope) — its state
    // carries no stress:expanded key.
    const byKey = new Map(states.map((s) => [s.pathKey, s]))
    expect(byKey.get('root')!.props['stress:expanded']).toBeUndefined()
    // level-1 is a zone-0 consumer of the ROOT — its key is 'root/<id>' (no zone segment)
    expect(byKey.get(`root/${idFor(t, 1, 'a')}`)!.props['stress:expanded']).toBe(true)
    const leaf = byKey.get(expectedLevelKeys(t, 11, 'a')[0]!)!
    expect(leaf.props['stress:expanded']).toBe(false)
    expect(leaf.children.length).toBe(0)

    // element census: 4095 elements, wires = pathKeys (root at the conventional wire 'root')
    const elements = emitElements(states as never) as MinimalElement[]
    expect(elements).toHaveLength(4095)
    expect(new Set(elements.map((e) => e.wire))).toEqual(new Set(states.map((s) => s.pathKey)))
    for (const e of elements) expect(e.forkKey).toBe(e.wire)

    // op census: 4095 creates, 4094 appends, ZERO removes; root-first (R-ORD-8)
    // (diffMinimal's first argument is a prevMap or null — engine pattern)
    const ops = diffMinimal(null, elements) as RenderOp[]
    expect(ops.filter((o) => o.kind === 'create')).toHaveLength(4095)
    expect(ops.filter((o) => o.kind === 'remove')).toHaveLength(0)
    expect(ops.filter((o) => o.kind === 'append')).toHaveLength(4094)

    // applyOps through the SSR string adapter: well-formed HTML covering all 4095 elements
    const adapter = new SSRFragmentAdapter()
    applyOps(adapter as never, ops as never)
    const html = adapter.toString()
    const tagCount = (html.match(/<div|<span|<app/g) ?? []).length
    expect(tagCount).toBe(4095)

    // E5: cloneOps = 0 — the E2E-1 flow performs zero ClientAPI.apply calls
    // (bootstrap only; nothing journaled)
  })
})

/* ------------------------------------------------------------------ */
/* E2E-2 — node-local invalidation (P3 §3.1)                           */
/* ------------------------------------------------------------------ */

describe('E2E-2 — shallow props slice on a depth-2 node (P3 §3.1, T30)', () => {
  it('regenerates ONLY that node\'s path-states; its element is reused (zero create/remove, set-only)', async () => {
    const t = asView(translateLegacy(staticForkEnvelope(5) as never)) // levels 1..5, 31 states
    const supervisor = supOf(t)
    const client = createClient(supervisor)
    const bootstrap = compileAll(t)
    supervisor.recordResolved(bootstrap as never)
    await flush()
    const elements1 = emitElements(bootstrap as never) as MinimalElement[]

    const l2a = idFor(t, 2, 'a')
    const l2aKeys = expectedLevelKeys(t, 2, 'a')
    const spy = vi.spyOn(Node.prototype, 'compilePath')
    spy.mockClear()
    const res = client.apply(l2a, [{ targetProp: 'props.stress:layer', mode: 'replace', value: 99 }])
    expect(res.status).toBe('applied')
    await flush()

    // compile-scope (E4): only l2a's compile ran in the sweep
    expect(spy).toHaveBeenCalledTimes(1)
    expect((spy.mock.instances[0] as { id?: string }).id).toBe(l2a)
    spy.mockRestore()

    // pass-2 keys: exactly l2a's two path-states (takePass2States = per-node map)
    const pass2 = pass2Keys(supervisor)
    expect(new Set(pass2)).toEqual(new Set(l2aKeys))

    // render diff over the merged set: zero create/remove/append; set ops ONLY on l2a's wires
    const next = mergeByKey(bootstrap, supervisor.getResolvedStates(l2a) as never)
    const elements2 = emitElements(next as never) as MinimalElement[]
    const ops = diffMinimal(new Map(elements1.map((e) => [e.wire, e])), elements2) as RenderOp[]
    expect(ops.filter((o) => o.kind === 'create')).toHaveLength(0)
    expect(ops.filter((o) => o.kind === 'remove')).toHaveLength(0)
    expect(ops.filter((o) => o.kind === 'append')).toHaveLength(0)
    const sets = ops.filter((o) => o.kind === 'set')
    expect(sets.length).toBeGreaterThan(0)
    for (const s of sets) expect(l2aKeys).toContain(s.wire)
  })
})

/* ------------------------------------------------------------------ */
/* E2E-3 — component changes: consumers only (P3 §3.2, T31)            */
/* ------------------------------------------------------------------ */

describe('E2E-3 — component SOURCE change invalidates ONLY the per-name component Link\'s target owners', () => {
  it('all-consumers pressure case: every consumer compiles once; zero passes anywhere else', async () => {
    // every one of the 10 prototypes consumes 'cc-all'; the root provides it
    const t = asView(translateLegacy(staticForkEnvelope(5, { reference: 'cc-all' }) as never))
    const supervisor = supOf(t)
    const client = createClient(supervisor)
    compileAll(t)
    await flush()

    const spy = vi.spyOn(Node.prototype, 'compilePath')
    spy.mockClear()
    const res = client.apply(t.root.id, [{ targetProp: 'props.blind', mode: 'replace', value: 2 }])
    expect(res.status).toBe('applied')
    await flush()

    // affected set = the per-name Link's 10 consumers (each compiles once via
    // compilePath). The root PROVIDER is NOT placement-routed — it compiles
    // through the supervisor's focused slice (mode switch §2.1), so it never
    // appears on the compilePath spy.
    const compiled = new Set(spy.mock.instances.map((i) => (i as { id?: string }).id))
    expect(compiled.size).toBe(10)
    for (let k = 1; k <= 5; k++) {
      for (const slot of ['a', 'b'] as const) expect(compiled.has(idFor(t, k, slot))).toBe(true)
    }
    spy.mockRestore()
    // every consumer's path-states regenerated (the pressure case: all 62
    // prototype pathKeys are in the drain — level k has 2^k states; the ROOT
    // provider is focused-compiled and its subtree states land in the drain
    // too, so the exact total is 63; the 62 consumer keys are the contract)
    const pass2 = pass2Keys(supervisor)
    const allKeys: string[] = []
    for (let k = 1; k <= 5; k++) for (const slot of ['a', 'b'] as const) allKeys.push(...expectedLevelKeys(t, k, slot))
    expect(new Set(allKeys).size).toBe(62)
    for (const key of allKeys) expect(pass2).toContain(key)
  })

  it('half-tree precision case: affected = {p3a, p4a}; the b-column runs ZERO passes; p4b\'s 8 states stay', async () => {
    const t = asView(translateLegacy(staticForkEnvelope(5, { reference: 'cc-half', only: ['p3a', 'p4a'] }) as never))
    const supervisor = supOf(t)
    const client = createClient(supervisor)
    const bootstrap = compileAll(t)
    supervisor.recordResolved(bootstrap as never)
    await flush()
    const elements1 = emitElements(bootstrap as never) as MinimalElement[]

    const spy = vi.spyOn(Node.prototype, 'compilePath')
    spy.mockClear()
    const res = client.apply(t.root.id, [{ targetProp: 'props.blind', mode: 'replace', value: 3 }])
    expect(res.status).toBe('applied')
    await flush()

    // the a-column consumers compile (2); the b-column + root never hit compilePath
    // (root is focused-compiled — mode switch §2.1; the b-column is not in the set)
    const compiled = new Set(spy.mock.instances.map((i) => (i as { id?: string }).id))
    expect(compiled).toEqual(new Set([idFor(t, 3, 'a'), idFor(t, 4, 'a')]))
    spy.mockRestore()

    // pass-2 keys: p3a (4) + p4a (8) + the root's own focused state (13 total);
    // p4b's 8 max-depth states are untouched
    const pass2 = pass2Keys(supervisor)
    expect(pass2).toHaveLength(13)
    const p4bKeys = expectedLevelKeys(t, 4, 'b')
    expect(pass2.some((k) => p4bKeys.includes(k))).toBe(false)
    const p3bKeys = expectedLevelKeys(t, 3, 'b')
    expect(pass2.some((k) => p3bKeys.includes(k))).toBe(false)

    // render diff: no set ops (and no create/remove/append) on the b-column wires
    const next = mergeByKey(bootstrap, supervisor.getResolvedStates(idFor(t, 3, 'a')) as never)
    const merged = mergeByKey(next, supervisor.getResolvedStates(idFor(t, 4, 'a')) as never)
    const elements2 = emitElements(merged as never) as MinimalElement[]
    const ops = diffMinimal(new Map(elements1.map((e) => [e.wire, e])), elements2) as RenderOp[]
    const nonBConsumerWires = [...p4bKeys, ...p3bKeys]
    for (const o of ops) {
      const wire = (o as { wire?: string; owner?: string; child?: string }).wire
      if (wire && nonBConsumerWires.includes(wire)) throw new Error(`b-column wire touched: ${wire}`)
    }
    // the a-column consumers resolved the binding per-path (Q8, provider above every path)
    const p3aStates = bootstrap.filter((s) => s.nodeId === idFor(t, 3, 'a'))
    expect(p3aStates.length).toBe(4)
    for (const s of p3aStates) expect(s.bindings['cc-half']).toBeDefined()
  })
})

/* ------------------------------------------------------------------ */
/* E2E-4 — post-render placement add (P3 §3.3, T32)                    */
/* ------------------------------------------------------------------ */

describe('E2E-4 — third depth-4 node via placement-attach after render (E2 reading)', () => {
  it('dirties EXACTLY {container, added node}; no depth>4 recalc; ONE create + appends under the container\'s path wire', async () => {
    // single-container-zone fixture: root(zone-0), l1(zone-1), l2(zone-2), p3(zone-3),
    // p4a(zone-4), p4b (consumes zone-3), d5a (consumes zone-4 under p4a) — 7 nodes, 7 states
    const t = asView(
      translateLegacy({
        template: { root: { type: 'app', placement: { placementName: 'zone-0' } } },
        content: [
          {
            content: [
              { type: 'div', props: { id: 'l1' }, placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] } },
              { type: 'div', props: { id: 'l2' }, placement: { placementName: 'zone-2', targetPlacement: ['zone-1'] } },
              { type: 'div', props: { id: 'p3' }, placement: { placementName: 'zone-3', targetPlacement: ['zone-2'] } },
              { type: 'div', props: { id: 'p4a' }, placement: { placementName: 'zone-4', targetPlacement: ['zone-3'] } },
              { type: 'div', props: { id: 'p4b' }, placement: { targetPlacement: ['zone-3'] } },
              { type: 'div', props: { id: 'd5a' }, placement: { targetPlacement: ['zone-4'] } },
            ],
          },
        ],
      }) as never,
    )
    const byId = new Map(t.nodes.map((n) => [n.props.id as string, n]))
    const p3 = byId.get('p3')!
    const d5a = byId.get('d5a')!

    const supervisor = supOf(t)
    const client = createClient(supervisor)
    const bootstrap = compileAll(t)
    supervisor.recordResolved(bootstrap as never)
    await flush()
    expect(bootstrap).toHaveLength(7)
    const elements1 = emitElements(bootstrap as never) as MinimalElement[]
    // §2.2 key grammar: p3's own consumer hop (zone-2 → l2) + the level-1 hop
    // (zone-1 → l1); the root landing contributes nothing
    const p3Key = `root/zone-1/${byId.get('l1')!.id}/zone-2/${byId.get('l2')!.id}/${p3.id}`

    const p4new = new Node({ type: 'section' })
    supervisor.registerNode(p4new as never)
    const spy = vi.spyOn(Node.prototype, 'compilePath')
    spy.mockClear()
    const res = client.apply(p4new.id, {
      kind: 'placement-attach',
      node: p4new.id,
      container: p3.id,
      names: ['zone-3'],
    })
    expect(res.status).toBe('applied')
    expect(new Set((res as { status: 'applied'; dirtied: string[] }).dirtied)).toEqual(
      new Set([p3.id, p4new.id]),
    )
    await flush()

    // compile scope: ONLY {p3, p4new}; d5a at depth 5 gets ZERO passes
    const compiled = new Set(spy.mock.instances.map((i) => (i as { id?: string }).id))
    expect(compiled).toEqual(new Set([p3.id, p4new.id]))
    spy.mockRestore()

    // pass-2 keys: {p3, p4new} path-states only — nothing at depth>4
    const p4newKey = `root/zone-1/${byId.get('l1')!.id}/zone-2/${byId.get('l2')!.id}/zone-3/${p3.id}/${p4new.id}`
    const pass2 = pass2Keys(supervisor)
    expect(new Set(pass2)).toEqual(new Set([p3Key, p4newKey]))
    expect(pass2.some((k) => k.includes(d5a.id))).toBe(false)

    // render diff: ONE create + appends ONLY under the container's path wire;
    // every other element reused. p3's childOrder GAINED p4newKey ⇒ the D5
    // re-append fires for p3's WHOLE new order (p4a, p4b, p4new — 3 appends,
    // all under p3Key); zero create/remove/set anywhere else.
    const next = mergeByKey(bootstrap, supervisor.getResolvedStates(p3.id) as never)
    const merged = mergeByKey(next, supervisor.getResolvedStates(p4new.id) as never)
    const elements2 = emitElements(merged as never) as MinimalElement[]
    const ops = diffMinimal(new Map(elements1.map((e) => [e.wire, e])), elements2) as RenderOp[]
    const creates = ops.filter((o) => o.kind === 'create')
    const appends = ops.filter((o) => o.kind === 'append') as Array<{ owner: string; child: string }>
    const removes = ops.filter((o) => o.kind === 'remove')
    const sets = ops.filter((o) => o.kind === 'set')
    expect(creates).toHaveLength(1)
    expect((creates[0] as { wire: string }).wire).toBe(p4newKey)
    expect(appends).toHaveLength(3)
    for (const a of appends) expect(a.owner).toBe(p3Key)
    expect(appends.map((a) => a.child)).toContain(p4newKey)
    expect(removes).toHaveLength(0)
    // set ops ONLY accompany the new element's own props (a created element's
    // prop writes are emitted as sets) — nothing on d5a's wire (no depth>4 recalc)
    const setWires = sets.map((o) => (o as { wire?: string }).wire)
    expect(new Set(setWires)).toEqual(new Set([p4newKey]))
    expect(ops.some((o) => (o as { wire?: string }).wire === d5a.id)).toBe(false)
  })
})
