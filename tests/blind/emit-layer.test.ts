/**
 * BLIND-TEST WRITER artifact — RENDER/EMIT LAYER contract test (input→output).
 *
 * Sources (ONLY): docs/specs/render.md §3.1/§3.2/§3.3/§6/§10.2 (FRK-P1..P3),
 * docs/specs/placement-path-spec.md (FINAL) §2.2/§2.3/§4.1/§4.2/§4.3 + §6.5 (DEFECT #1),
 * docs/skills/designing-pages.md §5.
 *
 * Contract under test: compiled path-states → MinimalElements → RenderOps → tree.
 *
 * AMBIGUITIES (my readings — the reviewer adjudicates):
 *  C1. Export locations: emitElements/minimalFromState are in render-helpers.ts
 *      (placement-path-spec §4.1/§6.2: render-helpers.ts:28-39, :36-38); diffMinimal
 *      is in render.ts:50-90. Imported accordingly.
 *  C2. The def VALUE shape is demo-side (fork-stress-data §4 linkDefForLevel) and not
 *      defined in the allowed docs. Reading: the def is a NodeData-like object
 *      { type, children: NodeData[] } whose `type` re-types the def-carrying consumer's
 *      element and whose children re-type the consumer's covered children in order.
 *  C3. The event-binding set op name is 'on:<event>' (designing-pages §5: set names are
 *      namespaced prop:* / css:* / text / on:<event>).
 *  C4. MinimalElement shape per render.md §3.2: { wire, type, props, childOrder, forkKey? }.
 *      childOrder on emitted path-state elements = the child STATES' pathKey wires
 *      (per-path child conversion, §4.2).
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'

import { emitElements, minimalFromState } from '../../src/core/render-helpers.js'
import { diffMinimal } from '../../src/core/render.js'

/* ------------------------------------------------------------------ */
/* local, documentation-derived types                                 */
/* ------------------------------------------------------------------ */

interface PathState {
  nodeId: string
  pathKey: string
  forkKey?: string
  type: string
  props: Record<string, unknown>
  children: unknown[]
  bindings: Record<string, unknown>
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

interface NodeView {
  id: string
  state: string
  props: Record<string, unknown>
  type: string
  children: NodeView[]
  anchors: Array<{ role: string; target: unknown }>
}
interface TranslatedView {
  root: NodeView
  nodes: NodeView[]
  content: NodeView[]
  warnings: Array<{ code: string; path?: string }>
}

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

/** root(zone-0) + l1a/l1b(zone-1) + l2a/l2b(zone-2, consume zone-1); l2a carries an event handler. */
function emitEnvelope() {
  return {
    template: { root: { type: 'app', props: { id: 'root' }, placement: { placementName: 'zone-0' } } },
    content: [
      {
        content: [
          {
            type: 'div',
            props: { 'stress:layer': 1, 'stress:slot': 'a' },
            placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] },
          },
          {
            type: 'span',
            props: { 'stress:layer': 1, 'stress:slot': 'b' },
            placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] },
          },
          {
            type: 'button',
            props: { 'stress:layer': 2, 'stress:slot': 'a' },
            placement: { placementName: 'zone-2', targetPlacement: ['zone-1'] },
            handlers: [{ name: 'click-h', event: 'click', body: '(ctx) => {}' }],
          },
          {
            type: 'section',
            props: { 'stress:layer': 2, 'stress:slot': 'b' },
            placement: { placementName: 'zone-2', targetPlacement: ['zone-1'] },
          },
        ],
      },
    ],
  }
}

/** root(zone-0, provider of def-x) + D(zone-1, consumes zone-0 + def-x) with family children c1/c2. */
function defEnvelope() {
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'root' },
        placement: { placementName: 'zone-0' },
        // K6: value-carrying root binding → SOURCE anchor; D consumes it (C2 def shape reading)
        component: {
          reference: 'def-x',
          value: { type: 'def-panel', children: [{ type: 'def-row-a' }, { type: 'def-row-b' }] },
        },
      },
    },
    content: [
      {
        content: [
          {
            type: 'panel',
            props: { id: 'D' },
            placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] },
            component: { reference: 'def-x' },
            children: [
              { type: 'row', props: { id: 'c1' } },
              { type: 'row', props: { id: 'c2' } },
            ],
          },
        ],
      },
    ],
  }
}

const asView = (t: unknown): TranslatedView => t as TranslatedView
const statesOf = (result: unknown): PathState[] =>
  (Array.isArray(result) ? result : (result as { actionable: PathState[] }).actionable) as PathState[]

/**
 * §2.1 adjudication (B1/C1): compilePath is a per-node METHOD (types.ts:45,
 * node.ts:947) — the census is the per-node aggregate (engine pattern
 * compileAll, path-enum.test.ts:90-92).
 */
function compileAll(t: TranslatedView): PathState[] {
  const out: PathState[] = []
  for (const n of t.nodes) {
    out.push(...(n as unknown as { compilePath(): { actionable: PathState[] } }).compilePath().actionable)
  }
  return out
}

/* ------------------------------------------------------------------ */
/* pathKey wires + forkKey forwarding (P3 §4.1, §4.3, DEFECT #1 fix)   */
/* ------------------------------------------------------------------ */

describe('emit layer — pathKey wires (FRK-P1)', () => {
  it('emits every path-state at wire = pathKey with forkKey = pathKey; root at the conventional wire "root"', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const [l1a, l1b, l2a] = t.content as [NodeView, NodeView, NodeView]
    const states = statesOf(compileAll(t))
    expect(states).toHaveLength(7)
    const elements = emitElements(states as never) as MinimalElement[]
    expect(elements).toHaveLength(7)

    const byWire = new Map(elements.map((e) => [e.wire, e]))
    const k1a = `root/${l1a.id}`
    const k1b = `root/${l1b.id}`
    const k2aViaL1a = `root/zone-1/${l1a.id}/${l2a.id}`
    const k2aViaL1b = `root/zone-1/${l1b.id}/${l2a.id}`
    expect(byWire.has('root')).toBe(true)
    expect(byWire.get('root')!.forkKey).toBe('root')
    expect(byWire.get(k1a)!.wire).toBe(k1a)
    expect(byWire.get(k1a)!.forkKey).toBe(k1a)
    expect(byWire.get(k2aViaL1a)!.forkKey).toBe(k2aViaL1a)
    expect(byWire.get(k2aViaL1b)!.forkKey).toBe(k2aViaL1b)
    // identity is pathKey alone: no '#<i>' wires anywhere in the path model
    for (const e of elements) expect(e.wire.includes('#')).toBe(false)
  })

  it('forwards forkKey = cs.forkKey on EVERY emitted create AND set op (DEFECT #1 fixed); appends carry none', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const states = statesOf(compileAll(t))
    const elements = emitElements(states as never) as MinimalElement[]
    const ops = diffMinimal(null, elements) as RenderOp[]
    const creates = ops.filter((o) => o.kind === 'create')
    const sets = ops.filter((o) => o.kind === 'set')
    const appends = ops.filter((o) => o.kind === 'append')
    expect(creates).toHaveLength(7)
    expect(appends).toHaveLength(6) // every non-root element is appended exactly once
    for (const c of creates) expect(c.forkKey).toBe(c.wire)
    for (const s of sets) expect(s.forkKey).toBeDefined()
    for (const a of appends) expect((a as { forkKey?: string }).forkKey).toBeUndefined()
  })

  it('per-path append owners are pathKey wires from the path-derived childOrder (P3 §4.2)', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const [l1a, l1b, l2a, l2b] = t.content as [NodeView, NodeView, NodeView, NodeView]
    const states = statesOf(compileAll(t))
    const elements = emitElements(states as never) as MinimalElement[]
    const ops = diffMinimal(null, elements) as RenderOp[]
    const appends = ops.filter((o) => o.kind === 'append') as Array<{ owner: string; child: string }>
    const k1a = `root/${l1a.id}`
    const k1b = `root/${l1b.id}`
    const k2aViaL1a = `root/zone-1/${l1a.id}/${l2a.id}`
    const k2bViaL1a = `root/zone-1/${l1a.id}/${l2b.id}`
    const k2aViaL1b = `root/zone-1/${l1b.id}/${l2a.id}`
    const k2bViaL1b = `root/zone-1/${l1b.id}/${l2b.id}`
    const childrenOf = (owner: string) => appends.filter((a) => a.owner === owner).map((a) => a.child)
    expect(childrenOf('root')).toEqual([k1a, k1b])
    expect(childrenOf(k1a)).toEqual([k2aViaL1a, k2bViaL1a])
    expect(childrenOf(k1b)).toEqual([k2aViaL1b, k2bViaL1b])
    // every child is reachable from root via the append graph (tree shape 1→2→4)
    const reach = new Set<string>(['root'])
    let frontier = ['root']
    while (frontier.length) {
      const next: string[] = []
      for (const w of frontier) for (const a of appends) if (a.owner === w && !reach.has(a.child)) { reach.add(a.child); next.push(a.child) }
      frontier = next
    }
    expect(reach.size).toBe(7)
  })

  it('R-ORD-8: the create stream is root-first — every parent create precedes its descendants\' creates', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const states = statesOf(compileAll(t))
    const elements = emitElements(states as never) as MinimalElement[]
    const ops = diffMinimal(null, elements) as RenderOp[]
    const creates = ops.filter((o) => o.kind === 'create') as Array<{ wire: string }>
    const index = new Map(creates.map((c, i) => [c.wire, i]))
    const [l1a, , l2a] = t.content as [NodeView, NodeView, NodeView]
    const k1a = `root/${l1a.id}`
    const k2aViaL1a = `root/zone-1/${l1a.id}/${l2a.id}`
    expect(index.get('root')!).toBeLessThan(index.get(k1a)!)
    expect(index.get(k1a)!).toBeLessThan(index.get(k2aViaL1a)!)
  })
})

/* ------------------------------------------------------------------ */
/* on:* on every path-state (P3 §4.2 gate re-expression)               */
/* ------------------------------------------------------------------ */

describe('emit layer — on:* handler attachment on path-states (render-helpers :341-347 re-expression)', () => {
  it('attaches the event binding to EVERY path-state of a handler-carrying node', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const [l1a, l1b, l2a] = t.content as [NodeView, NodeView, NodeView, NodeView]
    const states = statesOf(compileAll(t))
    // on:* attachment needs the live-node handler source (engine pattern
    // P-EMIT-3: emitElements(states, nodeById) — EmitNodeSource.handlers)
    const nodeById = new Map(t.nodes.map((n) => [n.id, { handlers: (n as unknown as { handlers?: unknown[] }).handlers }])) as never
    const elements = emitElements(states as never, nodeById) as MinimalElement[]
    const ops = diffMinimal(null, elements) as RenderOp[]
    const k2aViaL1a = `root/zone-1/${l1a.id}/${l2a.id}`
    const k2aViaL1b = `root/zone-1/${l1b.id}/${l2a.id}`
    const onClicks = ops.filter((o) => o.kind === 'set' && (o as { name?: string }).name === 'on:click')
    const clickWires = onClicks.map((o) => (o as { wire: string }).wire).sort()
    expect(clickWires).toEqual([k2aViaL1a, k2aViaL1b].sort())
    // the handler-less sibling's states carry no binding
    expect(ops.some((o) => o.kind === 'set' && (o as { name?: string; wire?: string }).name === 'on:click' && (o as { wire?: string }).wire?.includes(l2a.id) === false)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* def-retyping on path-states (P3 §4.2)                               */
/* ------------------------------------------------------------------ */

describe('emit layer — def-retyping applies to def-carrying path-states (C2 reading)', () => {
  it('re-types the def-carrying path-state element and covers its path-children via pathKey→nodeId', () => {
    const t = asView(translateLegacy(defEnvelope() as never))
    const D = t.content[0]!
    const states = statesOf(compileAll(t))
    // D's binding for def-x resolves per-path from the root provider
    const dStates = states.filter((s) => s.nodeId === D.id)
    expect(dStates).toHaveLength(1)
    expect(dStates[0]!.bindings['def-x']).toBeDefined()
    const elements = emitElements(states as never) as MinimalElement[]
    const byWire = new Map(elements.map((e) => [e.wire, e]))
    const dKey = `root/${D.id}`
    const c1Key = `root/${D.id}/${D.children[0]!.id}`
    const c2Key = `root/${D.id}/${D.children[1]!.id}`
    // C2 adjudicated: the def VALUE shape {type, children} is confirmed
    // (isLinkDef, render-helpers.ts:385). The re-type chain: the PROVIDER
    // (root) is def-retyped by its own published value (seedOwnBindings), and
    // D — def-covered as the root's first def child — is re-typed by the
    // ROOT's def (def-row-a) while D's OWN def re-types D's children only
    // (covered-consumer chain, render-helpers.ts:309-347). The writer's
    // "consumer element = def.type" reading was the def-only case; with a
    // provider in the same tree the covered-child semantics win.
    expect(byWire.get('root')!.type).toBe('def-panel')
    expect(byWire.get('root')!.childOrder[0]).toBe(dKey)
    expect(byWire.get(dKey)!.type).toBe('def-row-a')
    expect(byWire.get(dKey)!.childOrder).toEqual([c1Key, c2Key])
    // D's own def re-types D's covered path children (defChildren join the set)
    expect(byWire.get(c1Key)!.type).toBe('def-row-a')
    expect(byWire.get(c2Key)!.type).toBe('def-row-b')
  })
})

/* ------------------------------------------------------------------ */
/* diffMinimal reuse (P3 §4.1, FRK-P3, D4, ORD-H6)                     */
/* ------------------------------------------------------------------ */

describe('emit layer — element reuse by stable pathKey wires', () => {
  it('identical recompile ⇒ zero ops; same pathKey ⇒ same wire ⇒ prevMap reuse', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const states1 = statesOf(compileAll(t))
    const elements1 = emitElements(states1 as never) as MinimalElement[]
    const states2 = statesOf(compileAll(t))
    const elements2 = emitElements(states2 as never) as MinimalElement[]
    expect(diffMinimal(new Map(elements1.map((e) => [e.wire, e])), elements2)).toEqual([])
  })

  it('a shallow prop change on one node ⇒ set-only ops on ITS wires; zero create/remove/append (D4 + ORD-H6)', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const [l1a, l1b, l2a] = t.content as [NodeView, NodeView, NodeView, NodeView]
    const states1 = statesOf(compileAll(t))
    const elements1 = emitElements(states1 as never) as MinimalElement[]
    // test-side shallow mutation of l2a's own state surface (compile-side equivalent of a props slice)
    const states2 = states1.map((s) =>
      s.nodeId === l2a.id ? { ...s, props: { ...s.props, 'stress:layer': 99 } } : s,
    )
    const elements2 = emitElements(states2 as never) as MinimalElement[]
    const ops = diffMinimal(new Map(elements1.map((e) => [e.wire, e])), elements2) as RenderOp[]
    const k2aViaL1a = `root/zone-1/${l1a.id}/${l2a.id}`
    const k2aViaL1b = `root/zone-1/${l1b.id}/${l2a.id}`
    expect(ops.filter((o) => o.kind === 'create')).toHaveLength(0)
    expect(ops.filter((o) => o.kind === 'remove')).toHaveLength(0)
    expect(ops.filter((o) => o.kind === 'append')).toHaveLength(0) // unchanged child order: no re-append
    const sets = ops.filter((o) => o.kind === 'set')
    expect(sets.length).toBeGreaterThan(0)
    for (const s of sets) expect([k2aViaL1a, k2aViaL1b]).toContain(s.wire)
  })
})

/* ------------------------------------------------------------------ */
/* minimalFromState (single-state callers) + family states             */
/* ------------------------------------------------------------------ */

describe('emit layer — minimalFromState + family states', () => {
  it('minimalFromState emits the pathKey WIRE with forkKey forwarded and childOrder as-is', () => {
    const t = asView(translateLegacy(emitEnvelope() as never))
    const states = statesOf(compileAll(t))
    const l2aStates = states.filter((s) => s.props['stress:layer'] === 2 && s.props['stress:slot'] === 'a')
    const one = l2aStates[0]!
    const el = minimalFromState(one as never) as MinimalElement
    expect(el.wire).toBe(one.pathKey)
    expect(el.forkKey).toBe(one.pathKey)
    expect(Array.isArray(el.childOrder)).toBe(true)
    expect(el.childOrder.length).toBe(one.children.length)
  })

  it('family states minted by compilePath emit on the family pathKey wire with forkKey forwarded (B5 corrected)', () => {
    const t = asView(
      translateLegacy({
        template: {
          root: {
            type: 'app',
            props: { id: 'root' },
            placement: { placementName: 'zone-0' },
            children: [{ type: 'section', props: { id: 'fc' } }],
          },
        },
        content: [
          { content: [{ type: 'div', placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] } }] },
        ],
      } as never),
    )
    const fc = t.root.children[0]!
    const states = statesOf(compileAll(t))
    const elements = emitElements(states as never) as MinimalElement[]
    // §2.2 (B5 corrected): forkKey = pathKey is UNCONDITIONAL on every state
    // minted by compilePath — the family state is still a path-state, so it
    // emits on its family pathKey wire ('root/<id>'), NOT the nodeId wire,
    // and carries forkKey = pathKey (pathWireOf, render-helpers.ts:55-62).
    const familyEl = elements.find((e) => e.wire === `root/${fc.id}`)
    expect(familyEl).toBeDefined()
    expect(familyEl!.forkKey).toBe(`root/${fc.id}`)
  })
})
