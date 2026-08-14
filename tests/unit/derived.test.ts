/**
 * Derived State — variant D core unit (docs/specs/derived-state.md).
 * Red-state TDD: written BEFORE any implementation exists. Covers the §10
 * exhaustiveness gate (DV-H1..H13, DV-F1..F4) plus the §2/§4/§5/§7/§8
 * contract points: clone inheritance (incl. the layer-copy loop), the public
 * `node.derived` getter, serialization round-trips both ways, the legacy
 * round-trip, pass-1 canon untouched, derived-wins precedence,
 * null-omission, and per-arm bindings.
 */
import { describe, it, expect } from 'vitest'
import { Node, Supervisor, reconcileParentTargets } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { EventBridge } from '../../src/core/events.js'
import { validateDerived, evaluateDerived } from '../../src/core/derived.js'
import { serializeNode, serializeSlice, loadState } from '../../src/core/serialize.js'
import type { RenderNodeState } from '../../src/core/serialize.js'
import { translateLegacy, reverseTranslate } from '../../src/core/translate.js'
import { applyStateSlice } from '../../src/core/ops.js'
import { diffMinimal } from '../../src/core/render.js'
import { minimalFromState, wireKey } from '../../src/core/render-helpers.js'
import {
  makeRoot,
  makeNode,
  makePrototype,
  childOf,
  hub,
  addComponentSource,
  targetAnchor,
} from '../helpers/fixtures.js'
import type { CompileResult, CompiledState, DerivedDecl, DerivedExpr, NodeBaseData } from '../../src/core/types.js'
import type { LegacyInitialData } from '../../src/core/translate.js'

function compileSlice(slice: Node[]): CompileResult {
  return slice[0]!.compile(slice)
}

function statesFor(slice: Node[], nodeId: string): CompiledState[] {
  return compileSlice(slice).actionable.filter(cs => cs.nodeId === nodeId)
}

/** Assert a call throws an Error carrying code `derived-invalid` (contract §7). */
function expectDerivedInvalid(fn: () => unknown): void {
  let thrown: unknown
  try {
    fn()
  } catch (e) {
    thrown = e
  }
  expect(thrown).toBeInstanceOf(Error)
  expect((thrown as Error & { code?: unknown }).code).toBe('derived-invalid')
}

/** A live node + compiled state to evaluate expressions against. */
function evalCtx(): { node: Node; cs: CompiledState } {
  const root = makeRoot({ type: 'root' })
  const n = childOf(root, makeNode({
    type: 'card',
    content: 'hello',
    props: { title: 'T', obj: { a: 1, b: [1, 2] }, o2: { b: [1, 2], a: 1 }, arr: [] },
  }))
  addComponentSource(root, 'theme', 'dark')
  targetAnchor(n, 'theme')
  targetAnchor(n, 'nope') // never provided → unresolved arm entry
  childOf(n, makeNode({ type: 'inner' }))
  n.addAnchor('container', 'slot-main', {}, new Link({ name: 'placement' }))
  const cs = statesFor([root, n], n.id)[0]!
  return { node: n, cs }
}

describe('DV-H1 — expression semantics (§3)', () => {
  it('literals evaluate as themselves', () => {
    const { node, cs } = evalCtx()
    expect(evaluateDerived('lit', { node, cs })).toBe('lit')
    expect(evaluateDerived(3, { node, cs })).toBe(3)
    expect(evaluateDerived(true, { node, cs })).toBe(true)
    expect(evaluateDerived(false, { node, cs })).toBe(false)
    expect(evaluateDerived(null, { node, cs })).toBe(null)
  })

  it('$ paths read the whitelisted sources; a MISSING source yields null', () => {
    const { node, cs } = evalCtx()
    expect(evaluateDerived({ $: 'type' }, { node, cs })).toBe('card')
    expect(evaluateDerived({ $: 'content' }, { node, cs })).toBe('hello')
    expect(evaluateDerived({ $: 'pathKey' }, { node, cs })).toBe(cs.pathKey)
    expect(evaluateDerived({ $: 'props.title' }, { node, cs })).toBe('T')
    expect(evaluateDerived({ $: 'props.missing' }, { node, cs })).toBe(null)
    expect(evaluateDerived({ $: 'bindings.theme' }, { node, cs })).toBe('dark')
    expect(evaluateDerived({ $: 'bindings.missing' }, { node, cs })).toBe(null)
    expect(evaluateDerived({ $: 'children.length' }, { node, cs })).toBe(1)
    expect(evaluateDerived({ $: 'unresolved.length' }, { node, cs })).toBe(1)
    expect(evaluateDerived({ $: 'placement' }, { node, cs })).toBe('slot-main')
  })

  it('placement reads null for a node without a placement anchor', () => {
    const root = makeRoot()
    const m = childOf(root, makeNode({ type: 'plain' }))
    const cs = statesFor([root, m], m.id)[0]!
    expect(evaluateDerived({ $: 'placement' }, { node: m, cs })).toBe(null)
  })

  it('$concat: String() for primitives, JSON.stringify for objects, "" for null/undefined', () => {
    const { node, cs } = evalCtx()
    const expr = { $concat: ['a', 1, true, { $: 'props.obj' }, { $: 'bindings.missing' }] }
    expect(evaluateDerived(expr, { node, cs })).toBe('a1true{"a":1,"b":[1,2]}')
  })

  it('$if truthiness is COMPLETE: false/null/undefined/0/"" falsy; everything else truthy', () => {
    const { node, cs } = evalCtx()
    const pick = (cond: DerivedExpr): unknown => evaluateDerived({ $if: { cond, then: 'Y', else: 'N' } }, { node, cs })
    expect(pick(false)).toBe('N')
    expect(pick({ $: 'bindings.missing' })).toBe('N') // null cond
    expect(pick(0)).toBe('N')
    expect(pick('')).toBe('N')
    expect(pick(true)).toBe('Y')
    expect(pick(1)).toBe('Y')
    expect(pick('x')).toBe('Y')
    expect(pick('0')).toBe('Y') // non-empty string — truthy even when it looks like zero
    expect(pick({ $: 'props.obj' })).toBe('Y') // {} and friends — truthy
    expect(pick({ $: 'props.arr' })).toBe('Y') // [] — truthy
    // missing else → null
    expect(evaluateDerived({ $if: { cond: false, then: 'Y' } }, { node, cs })).toBe(null)
  })

  it('$eq is JSON-deep, key-order-insensitive, null-safe', () => {
    const { node, cs } = evalCtx()
    expect(evaluateDerived({ $eq: [1, 1] }, { node, cs })).toBe(true)
    expect(evaluateDerived({ $eq: ['a', 'a'] }, { node, cs })).toBe(true)
    expect(evaluateDerived({ $eq: ['a', 'b'] }, { node, cs })).toBe(false)
    expect(evaluateDerived({ $eq: [{ $: 'props.obj' }, { $: 'props.o2' }] }, { node, cs })).toBe(true)
    expect(evaluateDerived({ $eq: [{ $: 'props.missing' }, null] }, { node, cs })).toBe(true)
    expect(evaluateDerived({ $eq: [{ $: 'props.missing' }, { $: 'bindings.missing' }] }, { node, cs })).toBe(true)
    expect(evaluateDerived({ $eq: [1, '1'] }, { node, cs })).toBe(false)
  })

  it('$gt: number/number and string/string only; ANY other pair → null', () => {
    const { node, cs } = evalCtx()
    expect(evaluateDerived({ $gt: [2, 1] }, { node, cs })).toBe(true)
    expect(evaluateDerived({ $gt: [1, 2] }, { node, cs })).toBe(false)
    expect(evaluateDerived({ $gt: ['b', 'a'] }, { node, cs })).toBe(true)
    expect(evaluateDerived({ $gt: ['a', 'b'] }, { node, cs })).toBe(false)
    expect(evaluateDerived({ $gt: ['a', 1] }, { node, cs })).toBe(null)
    expect(evaluateDerived({ $gt: [{ $: 'props.missing' }, 1] }, { node, cs })).toBe(null)
    expect(evaluateDerived({ $gt: [{ $: 'props.obj' }, { $: 'props.o2' }] }, { node, cs })).toBe(null)
  })
})

describe('P3 §2.3/§2.5 — the derived placement root is per-path (Unit 10)', () => {
  /** Two sibling containers sharing ONE zone name (the R2.2 shape) + a second
   *  zone with a different name: path-states with distinct chosen names. */
  function pathTree(): { root: Node; A: Node; B: Node; E: Node; C: Node; D: Node } {
    const root = makeRoot()
    const A = childOf(root, makeNode({ type: 'div' }, 'A'))
    const B = childOf(root, makeNode({ type: 'div' }, 'B'))
    const z1 = new Link({ name: 'placement' })
    A.addAnchor('container', 'slot-a', {}, z1)
    B.addAnchor('container', 'slot-a', {}, z1)
    const C = makeNode({ type: 'button', content: 'Go' }, 'C')
    C.addAnchor('content', 'slot-a', {}, z1)
    const E = childOf(root, makeNode({ type: 'aside' }, 'E'))
    const z2 = new Link({ name: 'placement' })
    E.addAnchor('container', 'slot-b', {}, z2)
    const D = makeNode({ type: 'button' }, 'D')
    D.addAnchor('content', 'slot-b', {}, z2)
    return { root, A, B, E, C, D }
  }

  it('(a) a path-state placement read = its activePlacement (the chosen zone name), per path', () => {
    const t = pathTree()
    const csC = t.C.compilePath().actionable
    expect(csC).toHaveLength(2)
    for (const cs of csC) {
      expect(cs.activePlacement).toBe('slot-a')
      expect(evaluateDerived({ $: 'placement' }, { node: t.C, cs })).toBe('slot-a')
    }
    const csD = t.D.compilePath().actionable
    expect(csD).toHaveLength(1)
    expect(csD[0]!.activePlacement).toBe('slot-b')
    expect(evaluateDerived({ $: 'placement' }, { node: t.D, cs: csD[0]! })).toBe('slot-b')
  })

  it('(b) family states keep the container-anchor-target read — the runtime data-placement bakes stay identical', () => {
    const { node, cs } = evalCtx()
    expect(evaluateDerived({ $: 'placement' }, { node, cs })).toBe('slot-main')
    // no container anchor → null (unchanged)
    const root = makeRoot()
    const m = childOf(root, makeNode({ type: 'plain' }))
    const cs2 = statesFor([root, m], m.id)[0]!
    expect(evaluateDerived({ $: 'placement' }, { node: m, cs: cs2 })).toBe(null)
  })

  it('(b2) the feature-showcase #placement-lab bake (data-placement = the container anchor target) survives', () => {
    const root = makeRoot()
    const lab = childOf(root, makeNode({
      type: 'div',
      props: { id: 'placement-lab' },
      derived: { props: { 'data-placement': { $: 'placement' } } },
    }))
    lab.addAnchor('container', 'lab-placement', {}, new Link({ name: 'placement' }))
    const cs = statesFor([root, lab], lab.id)[0]!
    expect(cs.props['data-placement']).toBe('lab-placement')
  })

  it('(c) a family-first path-state (no activePlacement) falls back to the container anchor target', () => {
    const root = makeRoot()
    const A = childOf(root, makeNode({}, 'A'))
    const B = childOf(A, makeNode({}, 'B'))
    // B is a producer (container anchor) AND a placement consumer (content anchor)
    B.addAnchor('container', 'slot-x', {}, new Link({ name: 'placement' }))
    const z1 = new Link({ name: 'placement' })
    A.addAnchor('container', 'z1', {}, z1)
    B.addAnchor('content', 'z1', {}, z1)

    const cr = B.compilePath()
    const viaFamily = cr.actionable.find(s => s.pathKey === 'root/A/B')!
    const viaZ1 = cr.actionable.find(s => s.pathKey === 'root/z1/A/B')!
    expect(viaFamily.activePlacement).toBeUndefined()
    expect(viaZ1.activePlacement).toBe('z1')
    // family-first: legacy container-anchor read
    expect(evaluateDerived({ $: 'placement' }, { node: B, cs: viaFamily })).toBe('slot-x')
    // placement-routed: the CHOSEN name wins over the node's own container anchor
    expect(evaluateDerived({ $: 'placement' }, { node: B, cs: viaZ1 })).toBe('z1')
  })

  it('(d) children.length on a path-state reads the path-derived children (Unit 4 seam)', () => {
    const root = makeRoot()
    const P1a = childOf(root, makeNode({ type: 'div' }, 'P1a'))
    const P1b = childOf(root, makeNode({ type: 'div' }, 'P1b'))
    const z1 = new Link({ name: 'placement' })
    P1a.addAnchor('container', 'zone-1', {}, z1)
    P1b.addAnchor('container', 'zone-1', {}, z1)
    const P2 = makeNode({ type: 'button', derived: { props: { n: { $: 'children.length' } } } }, 'P2')
    P2.addAnchor('content', 'zone-1', {}, z1)

    const csP1 = P1a.compilePath().actionable[0]!
    expect(csP1.children).toEqual([P2.id])
    expect(evaluateDerived({ $: 'children.length' }, { node: P1a, cs: csP1 })).toBe(1)

    const csP2 = P2.compilePath().actionable
    expect(csP2).toHaveLength(2)
    for (const cs of csP2) {
      expect(cs.children).toEqual([])
      expect(evaluateDerived({ $: 'children.length' }, { node: P2, cs })).toBe(0)
      expect(cs.props.n).toBe(0)
    }
  })
})

describe('DV-H2 — base + layer merge (§2)', () => {
  it('derived merges like props; layer wins per key; the public getter exposes the merged declaration', () => {
    const n = makeNode({
      type: 'div',
      derived: { props: { a: 'A', b: 'B' } },
    })
    n.addLayer({ id: 'L', derived: { props: { b: 'B2', c: { $: 'type' } } } })
    expect(n.derived).toEqual({ props: { a: 'A', b: 'B2', c: { $: 'type' } } })

    const root = makeRoot()
    childOf(root, n)
    const s = statesFor([root, n], n.id)[0]!
    expect(s.props.a).toBe('A')
    expect(s.props.b).toBe('B2')
    expect(s.props.c).toBe('div')
  })
})

describe('DV-H3 — per-arm evaluation (§4)', () => {
  it('fork arms with different bindings bake different props per arm', () => {
    const root = makeRoot({ type: 'root' })
    const n = childOf(root, makeNode({ type: 'swatch', derived: { props: { swatch: { $: 'bindings.color' } } } }))
    targetAnchor(n, 'color')
    // two provider NODES under the consumer — the legitimate multiplicity
    // (§10.ab #4); same-node same-name sources are the guarded anti-pattern
    const pRed = childOf(n, makeNode({ type: 'pRed' }), 0)
    const pBlue = childOf(n, makeNode({ type: 'pBlue' }), 1)
    addComponentSource(pRed, 'color', 'red')
    addComponentSource(pBlue, 'color', 'blue')

    const arms = statesFor([root, n, pRed, pBlue], n.id)
    expect(arms).toHaveLength(2)
    const byBinding = new Map(arms.map(a => [a.bindings.color, a.props.swatch]))
    expect(byBinding.get('red')).toBe('red')
    expect(byBinding.get('blue')).toBe('blue')
  })
})

describe('DV-H4 / DV-H13 — clone inheritance (§2)', () => {
  it('a clone of a derived-bearing prototype re-derives: base rides via spread, layers via the copy loop', () => {
    const proto = makePrototype({
      type: 'panel',
      derived: { props: { fromBase: 'B', shared: 'BASE' } },
    })
    proto.addLayer({ id: 'L', derived: { props: { fromLayer: { $: 'type' }, shared: 'LAYER' } } })

    const copy = proto.clone()
    // reparent like the supervisor's clone-instance (supervisor.ts): replace
    // the inherited prototype child edge before attaching
    const inherited = copy.childAnchor()
    if (inherited) {
      inherited.link.destroy()
      const idx = copy.anchors.indexOf(inherited)
      if (idx !== -1) copy.anchors.splice(idx, 1)
    }
    // base + layer-copy: the merged DECLARATION survives the clone (the
    // getter exposes the rule — expressions, not evaluated values)
    expect(copy.derived).toEqual({
      props: { fromBase: 'B', fromLayer: { $: 'type' }, shared: 'LAYER' },
    })

    const root = makeRoot()
    childOf(root, copy)
    const s = statesFor([root, copy], copy.id)[0]!
    expect(s.props.fromBase).toBe('B')
    expect(s.props.fromLayer).toBe('panel')
    expect(s.props.shared).toBe('LAYER')
  })
})

describe('DV-H5 — pass-1 canon untouched (§4)', () => {
  it('derivation clones before merging: node.props is never mutated', () => {
    const n = makeNode({
      type: 'box',
      props: { authored: 'keep' },
      derived: { props: { baked: { $concat: [{ $: 'type' }, '!'] } } },
    })
    const root = makeRoot()
    childOf(root, n)
    const before = JSON.stringify(n.props)
    const s = statesFor([root, n], n.id)[0]!
    expect(n.props.baked).toBeUndefined()
    expect(n.props.authored).toBe('keep')
    expect(JSON.stringify(n.props)).toBe(before)
    expect(s.props.baked).toBe('box!')
    expect(s.props.authored).toBe('keep')
  })
})

describe('DV-H6 — derived wins over authored values (§5)', () => {
  it('a derived key authored via state-slice is overwritten by the rule on the next compile', () => {
    const root = makeRoot()
    const n = childOf(root, makeNode({ type: 'div', derived: { props: { data: { $: 'bindings.mode' } } } }))
    addComponentSource(n, 'mode', 'derived-value')
    applyStateSlice(n, [{ targetProp: 'props.data', mode: 'replace', value: 'authored' }])

    const s = statesFor([root, n], n.id)[0]!
    expect(n.props.data).toBe('authored') // authored value stays in the pass-1 canon
    expect(s.props.data).toBe('derived-value') // derived wins at the state level
  })
})

describe('DV-H7 — determinism (§4, §5, D4)', () => {
  it('two compiles produce equal states; a re-render emits no set churn for the baked key', () => {
    const root = makeRoot({ type: 'root' })
    const n = childOf(root, makeNode({
      type: 'div',
      derived: { props: { stamp: { $concat: [{ $: 'type' }, '-', { $: 'pathKey' }] } } },
    }))

    // determinism: two compiles → equal states (actionable carries live
    // anchor objects, so compare a serializable projection)
    const sig = (slice: Node[]) => compileSlice(slice).actionable.map(cs => ({
      nodeId: cs.nodeId,
      pathKey: cs.pathKey,
      type: cs.type,
      props: cs.props,
      children: cs.children,
      bindings: cs.bindings,
      unresolved: cs.unresolved,
    }))
    expect(sig([root, n])).toEqual(sig([root, n]))

    const render = () => compileSlice([root, n]).actionable.map(minimalFromState)
    const r1 = render()
    const r2 = render()
    const ops = diffMinimal(new Map(r1.map(e => [wireKey(e.wire, e.forkKey), e])), r2)
    expect(ops.filter(o => o.kind === 'set' && o.name === 'prop:stamp')).toHaveLength(0)
  })
})

describe('DV-H8 — serializeSlice → loadState round-trip (SER-R1, §2, §8)', () => {
  it('the RULE ships in the data (values never stored); recompile re-derives equal states', () => {
    const root = makeRoot({
      type: 'root',
      props: { marker: 'stale', other: 1 },
      derived: { props: { marker: { $concat: [{ $: 'type' }, '-', { $: 'children.length' }] } } },
    })
    const leaf = childOf(root, makeNode({ type: 'leaf' }))
    const decl = { props: { marker: { $concat: [{ $: 'type' }, '-', { $: 'children.length' }] } } } as const
    expect(statesFor([root, leaf], root.id)[0]!.props.marker).toBe('root-1')

    const doc = serializeSlice(root, [root, leaf])
    const template = doc.template as RenderNodeState
    expect(template.derived).toEqual(decl)
    // the rule replaces the value: the stale authored marker never round-trips
    expect(template.props.marker).toBeUndefined()
    expect(template.props.other).toBe(1)

    const seeds = loadState(JSON.parse(JSON.stringify(doc)))
    const seeded = seeds.map(d => new Node(d, hub()))
    reconcileParentTargets(seeded) // standard round-trip step (restores family edges)
    expect(seeded[0]!.derived).toEqual(decl)
    const after = statesFor(seeded, root.id)[0]!
    expect(after.props.marker).toBe('root-1') // SER-R1: equal baked states

    // and the recompiled node re-serializes to the same rule (round-trip both ways)
    expect(serializeNode(seeded[0]!).derived).toEqual(decl)
  })
})

describe('DV-H9 — legacy envelope round-trip (§2, §8)', () => {
  it('baseFrom maps + validates; nodeToLegacy emits the merged declaration; string-shippable', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          derived: { props: { tag: { $: 'type' }, count: { $concat: ['N=', { $: 'children.length' }] } } },
        },
      },
    }
    const t = translateLegacy(doc)
    expect(t.root.derived).toEqual(doc.template.root.derived)
    const out = reverseTranslate(t.root)
    expect(out.template.root.derived).toEqual(doc.template.root.derived)
    expect(() => JSON.stringify(out)).not.toThrow()
    expect(JSON.parse(JSON.stringify(out))).toEqual(out)
    // translateLegacy(reverseTranslate(...)) reproduces the merged rule
    const t2 = translateLegacy(out)
    expect(t2.root.derived).toEqual(doc.template.root.derived)
  })

  it('layers have no legacy home — the merged declaration ships flat (DECIDED)', () => {
    const doc: LegacyInitialData = {
      template: { root: { type: 'div', derived: { props: { base: 'B' } } } },
    }
    const t = translateLegacy(doc)
    t.root.addLayer({ id: 'L', derived: { props: { layerOnly: 'LAY', base: 'LAYER-WINS' } } })
    const out = reverseTranslate(t.root)
    expect(out.template.root.derived).toEqual({ props: { base: 'LAYER-WINS', layerOnly: 'LAY' } })
  })
})

describe('DV-H10 — visibility (§5)', () => {
  it('baked props appear in CompiledState.props / node.resolved / getState / emitted prop:* — never in node.props', () => {
    const root = makeRoot({ type: 'root', content: 'ROOT', derived: { props: { data: { $: 'content' } } } })
    const cr = root.compile([root])
    const cs = cr.actionable.find(s => s.nodeId === root.id)!
    expect(cs.props.data).toBe('ROOT')

    // emitter input: prop:* attribute
    const me = minimalFromState(cs)
    expect(me.props['prop:data']).toBe('ROOT')

    // handler surface: node.resolved + the getState backing store
    const supervisor = new Supervisor({ hub: hub(), events: new EventBridge() })
    supervisor.registerNode(root)
    supervisor.recordResolved(cr.actionable)
    expect(supervisor.getNode(root.id)!.resolved[0]!.props.data).toBe('ROOT')
    expect(supervisor.getResolvedStates(root.id)[0]!.props.data).toBe('ROOT')

    // NOT in pass-1 authored props
    expect(root.props.data).toBeUndefined()
  })
})

describe('DV-H11 — no-target branch (self-provided bindings only, §4)', () => {
  it('a derived bindings.<name> bakes the SELF-provided value; an undefined provider omits the key', () => {
    const root = makeRoot({ type: 'root' })
    const a = childOf(root, makeNode({ type: 'a', derived: { props: { self: { $: 'bindings.x' } } } }))
    addComponentSource(a, 'x', 'own-value')
    const b = childOf(root, makeNode({ type: 'b', derived: { props: { self: { $: 'bindings.y' } } } }))
    addComponentSource(b, 'y', undefined)

    const cr = root.compile([root, a, b])
    const sa = cr.actionable.find(s => s.nodeId === a.id)!
    expect(sa.props.self).toBe('own-value')
    const sb = cr.actionable.find(s => s.nodeId === b.id)!
    expect('self' in sb.props).toBe(false) // null → omitted
  })
})

describe('DV-H12 — per-arm states + diff stability (D4)', () => {
  it('fork arms carry per-arm baked props and a re-render emits no spurious set churn', () => {
    const root = makeRoot({ type: 'root' })
    const n = childOf(root, makeNode({ type: 'swatch', derived: { props: { swatch: { $: 'bindings.color' } } } }))
    targetAnchor(n, 'color')
    // two provider NODES under the consumer (legitimate multiplicity, §10.ab #4)
    const pRed = childOf(n, makeNode({ type: 'pRed' }), 0)
    const pBlue = childOf(n, makeNode({ type: 'pBlue' }), 1)
    addComponentSource(pRed, 'color', 'red')
    addComponentSource(pBlue, 'color', 'blue')

    const arms = statesFor([root, n, pRed, pBlue], n.id)
    expect(arms.map(a => a.props.swatch).sort()).toEqual(['blue', 'red'])

    // D4: re-derivation is deterministic per arm — two renders carry the
    // same baked values (fork arms are same-wire elements; diffMinimal's
    // bare-wire prev lookup cannot distinguish them — the framework's fork
    // diff path is out of scope here, so pin per-arm stability instead)
    const render = () => root.compile([root, n, pRed, pBlue]).actionable.map(minimalFromState)
    expect(render()).toEqual(render())
    expect(render().map(e => e.props['prop:swatch'])).toEqual(render().map(e => e.props['prop:swatch']))
  })
})

describe('DV-F1 — validation fail-fast at EVERY declaration boundary (§7)', () => {
  const malformed: Array<{ label: string; decl: unknown }> = [
    { label: 'non-object decl', decl: 42 },
    { label: 'array decl', decl: [] },
    { label: 'string decl', decl: 'derived' },
    { label: 'props not an object', decl: { props: [1] } },
    { label: 'unknown form', decl: { props: { k: { $bogus: 1 } } } },
    { label: 'no $-key form', decl: { props: { k: { a: 1 } } } },
    { label: 'non-whitelisted root', decl: { props: { k: { $: 'evil.x' } } } },
    { label: 'bare children read', decl: { props: { k: { $: 'children' } } } },
    { label: 'children non-length segment', decl: { props: { k: { $: 'children.size' } } } },
    { label: 'bare unresolved read', decl: { props: { k: { $: 'unresolved' } } } },
    { label: 'multi-segment props key', decl: { props: { k: { $: 'props.a.b' } } } },
    { label: 'dotted bindings key', decl: { props: { k: { $: 'bindings.a.b' } } } },
    { label: 'bare props root', decl: { props: { k: { $: 'props' } } } },
    { label: 'deep path into content', decl: { props: { k: { $: 'content.x' } } } },
    { label: 'deep path into type', decl: { props: { k: { $: 'type.x' } } } },
    { label: 'empty $concat', decl: { props: { k: { $concat: [] } } } },
    { label: 'non-array $concat', decl: { props: { k: { $concat: 'x' } } } },
    { label: '$eq wrong arity', decl: { props: { k: { $eq: [1] } } } },
    { label: '$eq non-array', decl: { props: { k: { $eq: 1 } } } },
    { label: '$gt wrong arity', decl: { props: { k: { $gt: [1, 2, 3] } } } },
    { label: '$if missing cond', decl: { props: { k: { $if: { then: 1 } } } } },
    { label: '$if missing then', decl: { props: { k: { $if: { cond: 1 } } } } },
    { label: 'reserved id key', decl: { props: { id: 'x' } } },
    { label: '$ path not a string', decl: { props: { k: { $: 42 } } } },
  ]
  const valid: unknown[] = [
    undefined,
    {},
    { props: {} },
    {
      props: {
        a: 'lit', b: 3, c: true, d: null,
        e: { $: 'type' },
        f: { $: 'children.length' },
        g: { $concat: [{ $: 'props.x' }] },
        h: { $if: { cond: { $: 'props.x' }, then: 1, else: 2 } },
        i: { $eq: [1, 2] },
        j: { $gt: ['a', 'b'] },
      },
    },
  ]

  it('validateDerived exposes the gate directly', () => {
    for (const { decl } of malformed) expectDerivedInvalid(() => validateDerived(decl))
    for (const decl of valid) expect(() => validateDerived(decl)).not.toThrow()
  })

  it('the Node constructor rejects every malformed base decl', () => {
    for (const { decl } of malformed) {
      expectDerivedInvalid(() => { new Node({ type: 'div', derived: decl as unknown as DerivedDecl }) })
    }
    for (const decl of valid) {
      expect(() => new Node({ type: 'div', derived: decl as unknown as DerivedDecl })).not.toThrow()
    }
  })

  it('addLayer rejects every malformed layer decl', () => {
    for (const { decl } of malformed) {
      const n = makeNode({ type: 'div' })
      expectDerivedInvalid(() => n.addLayer({ id: 'L', derived: decl as unknown as DerivedDecl }))
    }
  })

  it('parseNodeState rejects malformed derived inside a serialized doc', () => {
    for (const { decl } of malformed) {
      const inContent = {
        template: { id: 't', type: 'div', props: {} },
        content: [{ id: 'c', type: 'div', props: {}, derived: decl }],
        clientConfig: { adapter: 'dom', persistence: false },
      }
      expectDerivedInvalid(() => loadState(inContent))
      const inTemplate = {
        template: { id: 't', type: 'div', props: {}, derived: decl },
        content: [],
        clientConfig: { adapter: 'dom', persistence: false },
      }
      expectDerivedInvalid(() => loadState(inTemplate))
    }
  })

  it('baseFrom rejects malformed derived inside a legacy envelope', () => {
    for (const { decl } of malformed) {
      expectDerivedInvalid(() => translateLegacy({ template: { root: { type: 'div', derived: decl as unknown as DerivedDecl } } }))
    }
  })
})

describe('DV-F2 — non-existent binding → null → key omitted (§4, §7)', () => {
  it('a derived expression over a never-provided binding omits the key and changes no unresolved state', () => {
    const root = makeRoot({ type: 'root' })
    const n = childOf(root, makeNode({ type: 'div', derived: { props: { ghost: { $: 'bindings.never' } } } }))
    const cr = root.compile([root, n])
    const s = cr.actionable.find(cs => cs.nodeId === n.id)!
    expect('ghost' in s.props).toBe(false)
    expect(s.unresolved).toEqual([])
    expect(cr.warnings).toHaveLength(0) // no unresolved-reference state change
  })
})

describe('DV-F3 — malformed derived in serialized/legacy envelopes (§7, §8)', () => {
  it('throws derived-invalid at the schema boundary — the data never reaches compile', () => {
    const badDoc = {
      template: { id: 't', type: 'div', props: {}, derived: { props: { k: { $: 'nope.root' } } } },
      content: [],
      clientConfig: { adapter: 'dom', persistence: false },
    }
    expectDerivedInvalid(() => loadState(JSON.parse(JSON.stringify(badDoc))))
    const badLegacy = { template: { root: { type: 'div', derived: { props: { k: { $eq: [1] } } } } } }
    expectDerivedInvalid(() => translateLegacy(JSON.parse(JSON.stringify(badLegacy))))
  })
})

describe('DV-F4 — direct layers.push is OUTSIDE the supported surface (parked, §7)', () => {
  it('raw-array pushes bypass addLayer validation — a constraint note, not a supported entry point', () => {
    const n = makeNode({ type: 'div' })
    expect(() => {
      n.layers.push({ id: 'raw', derived: { props: { k: { $: 'not.a.root' } } } })
    }).not.toThrow()
  })
})
