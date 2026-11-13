/**
 * VALUE-PROVIDER-RENDER-DISPOSITION — the §8 RED SET (register rows VPD-1..VPD-12).
 *
 * DERIVATION SOURCE (the only contract input): `docs/specs/value-provider-render-disposition.md`
 *   §2 C1  the provenance rule + the disposition table
 *          (an AUTHORED provider IS an element; only a runtime-minted VALUE RECORD is dropped)
 *   §2 C2  the dedicated `valueRecord` marker (mint sites, promotion keeps it, never serialized:
 *          `parseNodeState`'s whitelist cannot admit `valueRecord`/`originLayer`/`runtimeMinted`)
 *   §2 C3  the residual drop's diagnostic: `console.warn` ONLY, code `value-record-drop`,
 *          message `value-record-drop at <pathKey>: runtime-minted value record "<name>" is
 *          consumed in this compile slice — not rendered as an element`; module-level
 *          `(code, nodeId, name)` dedup; `shouldWarn(node)` focus gate; R-W4-5 inherited
 *   §2 C4  what does NOT change (per-arm mixed emit, `dropped` membership, `warnings` union)
 *   §2 C5  the three exclusions (content-root, minted-parent flattening, no position index)
 *   §3     FS-VPD-1..10 (the fail-states)
 *   §8     register rows VPD-1..12 — one `it` name per row, at least one case per row
 *
 * RED-FIRST (AGENTS.md item 8). Today `src/core/node.ts:1253` drops from render ANY target-less
 * node that provides a component name another node in the compile slice consumes — silently.
 * The RED set as MEASURED on the clean tree (832b62b) is:
 *   VPD-1/2/8  RED   — an authored provider is dropped, so it has no state and no element.
 *   VPD-3/12   RED   — the diagnostic does not exist, so no `value-record-drop` warn fires
 *                      (VPD-3's drop/no-`dropped`/no-element halves already hold: only its
 *                      warn half is red).
 *   VPD-11     RED   — the seeded (authored) provider is dropped by that same predicate; its
 *                      non-forgeability halves already pass, and the case stays RED only until
 *                      the provenance rule releases an authored provider.
 * The CONTROLS below are GREEN today by construction and must NOT regress; each is written as a
 * fail-state because the release could break it:
 *   VPD-4      the promoted record must STAY dropped (marker survives survivor promotion; C2) —
 *              today the same predicate drops it, so the case guards the *future* marker
 *              semantics (an implementer keying the drop on `originLayer` would pass today and
 *              fail here after promotion).
 *   VPD-5      the seam exemption (C1/A2: evaluated BEFORE any provenance test) — the `[6]` pin.
 *   VPD-6      the earlier `owner-terminated` gate (C5 exclusion 1) and the absence of its warn.
 *   VPD-7      the per-arm mixed emit (C4: state count = arm count, never "+ a standalone state").
 *   VPD-9      the `hasAnyTarget` control — FS-VPD-9 pins behaviour "byte-identical to today".
 *   VPD-10     marker-alone is INSUFFICIENT (C1 conjunct 2: consumption by name is required).
 * No file under `src/**` is touched, no assertion references a field that does not exist yet
 * (`node.valueRecord` is never read — the marker is asserted only through its OBSERVABLES, and
 * the only direct field reads are the long-standing `originLayer` / `runtimeMinted`).
 *
 * DEDUP DISCIPLINE (§3 "Diagnostic-shape notes", C3 / R-W4-5): the dedup set is MODULE-LEVEL and
 * process-wide, keyed `(code, nodeId, name)`. Every case therefore uses unique node ids AND a
 * unique consumed name (the `vpdN` prefix), never asserts a global warn count, and filters the
 * captured warns by that case's own needle — a stray warn from another case can never satisfy or
 * spoil a row.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest'
import { Node, reconcileParentTargets } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub, translateLegacy, reverseTranslate } from '../../src/core/translate.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { rowsMint, detachNodeSafe } from '../../src/core/ops.js'
import { registerDefPrototypes } from '../../src/core/registry.js'
import { serializeNode, serializeSlice, loadState, type SerializedRenderDoc } from '../../src/core/serialize.js'
import type { MinimalElement } from '../../src/core/render.js'
import type { CompileResult, NodeBaseData } from '../../src/core/types.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor, familyLink } from '../helpers/fixtures.js'

/** The only code string this contract introduces (§2 C3). */
const VALUE_RECORD_DROP = 'value-record-drop'

let warn: MockInstance

beforeEach(() => {
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  // never leave a console.warn spy leaking into another case / file
  vi.restoreAllMocks()
})

/** The `value-record-drop` warn lines attributable to THIS case (unique needle filter). */
function vpdWarns(needle: string): string[] {
  return warn.mock.calls
    .map((c) => String(c[0] ?? ''))
    .filter((s) => s.includes(VALUE_RECORD_DROP) && s.includes(needle))
}

/** The `emitElements(actionable, nodeById)` element list for a compile result. */
function emitted(res: CompileResult, nodes: Node[]): MinimalElement[] {
  const byId = new Map<string, Node>()
  for (const n of nodes) byId.set(n.id, n)
  return emitElements(res.actionable, byId)
}

/** Element descendants of `rootWire` (order preserved, depth-first). */
function descendantsOf(els: MinimalElement[], rootWire: string): MinimalElement[] {
  const byWire = new Map(els.map((e) => [e.wire, e]))
  const out: MinimalElement[] = []
  const walk = (wire: string): void => {
    const el = byWire.get(wire)
    if (!el) return
    for (const c of el.childOrder) {
      const ce = byWire.get(c)
      if (ce) {
        out.push(ce)
        walk(c)
      }
    }
  }
  walk(rootWire)
  return out
}

/** Attach a family edge that terminates at a string TOKEN (rootNode / component / contentNodes). */
function chainToToken(node: Node, token: 'rootNode' | 'component' | 'contentNodes'): Node {
  const link = new Link({ name: 'parent-child' })
  node.addAnchor('child', node, { priority: 0 }, link)
  link.addAnchor({ role: 'parent', target: token, options: {}, link })
  return node
}

interface RowsCase {
  h: ReturnType<typeof createLinkHub>
  root: Node
  creator: Node
  consumer: Node
  row: Node
  layerId: string
  nodes: Node[]
}

/**
 * Drive the REAL rows-mint path (`rowsMint` → `mintRowNode`) so the value record is minted by
 * production code, never faked with a flag (§2 C2 "mint sites: mintRowNode").
 */
function rowsCase(
  prefix: string,
  fieldName: string,
  fieldValue: unknown,
  rowExtra: Record<string, unknown> = {},
): RowsCase {
  const h = createLinkHub()
  const protoName = `${prefix}-def`
  registerDefPrototypes(h.linkFor(protoName, 'component'), [new Node({ type: 'li' }, h, `${prefix}-proto`)])
  const root = new Node({ type: 'div' }, h, `${prefix}-root`)
  familyLink(root, 'rootNode')
  const creator = childOf(root, new Node({ type: 'section' }, h, `${prefix}-creator`))
  const consumer = childOf(root, new Node({ type: 'span' }, h, `${prefix}-consumer`))
  const minted = rowsMint(
    {
      kind: 'rows-mint',
      target: creator,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: protoName,
      rows: [{ [fieldName]: fieldValue, ...rowExtra } as unknown as NodeBaseData],
      sourceName: `${prefix}-rows`,
    },
    { hub: h, nodes: new Map<string, Node>() },
  )
  const row = creator.children.find((c) => c.id === minted.minted[0])!
  return { h, root, creator, consumer, row, layerId: minted.layerId, nodes: [root, creator, consumer, row] }
}

/** The consumer's `target` anchor, on the SAME per-name link the row minted its field anchor on. */
function consume(rc: RowsCase, name: string): void {
  rc.consumer.addAnchor('target', name, {}, rc.h.linkFor(name, 'component'))
}

// ===========================================================================
// VPD-1 — FS-VPD-1 · authored provider WITH children, consumed by a descendant
// ===========================================================================
describe('VPD-1 — an authored provider with children is an ELEMENT (provenance rule, C1)', () => {
  it('VPD-1 — authored provider with children emits one state at its own pathKey, its children in order, the parent childOrder entry is a real wire, no warn', () => {
    const root = makeRoot({ type: 'app' }, 'vpd1-root')
    const provider = childOf(root, makeNode({ type: 'section', css: { classes: ['vpd1-provider'] } }, 'vpd1-provider'))
    addComponentSource(provider, 'vpd1-name', 'vpd1-value')
    const kidA = childOf(provider, makeNode({ type: 'p', content: 'vpd1-a' }, 'vpd1-kid-a'))
    const kidB = childOf(provider, makeNode({ type: 'p', content: 'vpd1-b' }, 'vpd1-kid-b'))
    const consumer = childOf(provider, makeNode({ type: 'span' }, 'vpd1-consumer'))
    targetAnchor(consumer, 'vpd1-name')

    const slice = [root, provider, kidA, kidB, consumer]
    const res = root.compile(slice)

    // exactly ONE actionable state, at the provider's OWN pathKey, its own published value
    const states = res.actionable.filter((s) => s.nodeId === provider.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.pathKey).toBe(provider.pathKey)
    expect(states[0]!.bindings['vpd1-name']).toBe('vpd1-value')
    // the target-less branch emits ONE state, no fork (§2 C1 "no forkKey")
    expect(states[0]!.forkKey).toBeUndefined()
    // ...and it is the node's whole state set: no second, standalone provider state (C1 MUST NOT)
    expect(res.actionable.filter((s) => s.nodeId === provider.id && s.forkKey !== undefined)).toEqual([])

    const els = emitted(res, slice)
    const providerEl = els.find((e) => e.wire === provider.id)
    expect(providerEl).toBeDefined()
    expect(providerEl!.type).toBe('section')
    expect(providerEl!.props['css:classes']).toEqual(['vpd1-provider'])
    // the authored children nest under the provider — NOT flattened to the grandparent
    expect(providerEl!.childOrder).toEqual([kidA.id, kidB.id, consumer.id])
    for (const wire of providerEl!.childOrder) {
      expect(els.some((e) => e.wire === wire)).toBe(true)
    }

    // the parent's childOrder entry resolves to a REAL wire with an element behind it
    const rootEl = els.find((e) => e.wire === root.id)
    expect(rootEl).toBeDefined()
    expect(rootEl!.childOrder).toEqual([provider.id])
    expect(els.some((e) => e.wire === rootEl!.childOrder[0])).toBe(true)
    // the children are NOT adopted by the grandparent (the defect's orphaning)
    expect(rootEl!.childOrder).not.toContain(kidA.id)

    // disposition is provenance-based: no residual diagnostic
    expect(vpdWarns('vpd1')).toEqual([])
  })
})

// ===========================================================================
// VPD-2 — FS-VPD-2 · authored LEAF provider (child-count is not the discriminator)
// ===========================================================================
describe('VPD-2 — an authored LEAF provider is an element too (provenance, not child count)', () => {
  it('VPD-2 — an authored leaf provider consumed in the slice emits one state and one childless element, zero warns', () => {
    const root = makeRoot({ type: 'app' }, 'vpd2-root')
    const leaf = childOf(root, makeNode({ type: 'em' }, 'vpd2-leaf'))
    addComponentSource(leaf, 'vpd2-name', 'vpd2-value')
    const consumer = childOf(root, makeNode({ type: 'span' }, 'vpd2-consumer'))
    targetAnchor(consumer, 'vpd2-name')

    const slice = [root, leaf, consumer]
    const res = root.compile(slice)

    const states = res.actionable.filter((s) => s.nodeId === leaf.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.pathKey).toBe(leaf.pathKey)
    expect(states[0]!.bindings['vpd2-name']).toBe('vpd2-value')
    expect(states[0]!.children).toEqual([])

    const els = emitted(res, slice)
    const leafEl = els.find((e) => e.wire === leaf.id)
    expect(leafEl).toBeDefined()
    expect(leafEl!.type).toBe('em')
    expect(leafEl!.childOrder).toEqual([])

    expect(vpdWarns('vpd2')).toEqual([])
  })
})

// ===========================================================================
// VPD-3 — FS-VPD-3 · runtime-minted value record, field consumed → DROP + WARN ONCE
// ===========================================================================
describe('VPD-3 — a consumed runtime-minted value record is dropped, warned once, never in `dropped`', () => {
  it('VPD-3 — minted record consumed in the slice: no state, no element, no `dropped` entry, exactly one warn (once per process), zero more on re-compile', () => {
    const rc = rowsCase('vpd3', 'vpd3-field', 'vpd3-value')
    consume(rc, 'vpd3-field')
    const slice = rc.nodes

    const res = rc.root.compile(slice)

    // no actionable state and no emitted element for the row
    expect(res.actionable.filter((s) => s.nodeId === rc.row.id)).toEqual([])
    const els = emitted(res, slice)
    expect(els.filter((e) => e.wire === rc.row.id)).toEqual([])
    // `dropped` gains NO entry (C3/C4 — the residual stays outside `dropped`)
    expect(res.dropped.filter((d) => d.arm.includes(rc.row.id))).toEqual([])

    // exactly ONE warn: the code, the row's pathKey and the consumed name
    const lines = vpdWarns('vpd3')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(rc.row.pathKey)
    expect(lines[0]).toContain('vpd3-field')

    // per-signature dedup (C3, R-W4-5 item 1): a second identical compile warns ZERO more times
    rc.root.compile(slice)
    expect(vpdWarns('vpd3')).toHaveLength(1)
  })
})

// ===========================================================================
// VPD-4 — FS-VPD-4 · a value record PROMOTED by a move (survivor promotion) still does not render
// ===========================================================================
describe('VPD-4 — survivor promotion clears `originLayer` only; the record stays a value', () => {
  it('VPD-4 — a promoted (originLayer-cleared) value record gains no state and no element; it reverses as authored content', () => {
    const rc = rowsCase('vpd4', 'vpd4-field', 'vpd4-value', { props: { id: 'vpd4-row-marker' } })
    consume(rc, 'vpd4-field')

    // MOVE the row out of the creator subtree (under the permanent root) ...
    detachNodeSafe(rc.row)
    childOf(rc.root, rc.row)
    // ... then tear the batch down: `teardownMinted`'s SURVIVOR-PROMOTION branch runs
    // (originLayer cleared, the node is not doomed) — the marker itself must survive.
    rc.creator.removeLayer(rc.layerId)
    expect(rc.row.originLayer).toBeUndefined()
    expect(rc.row.destroyed).toBe(false)

    const slice = rc.nodes
    const res = rc.root.compile(slice)

    // STILL DROPPED as a value: no state, no element (C2 — promotion clears originLayer only)
    expect(res.actionable.filter((s) => s.nodeId === rc.row.id)).toEqual([])
    const els = emitted(res, slice)
    expect(els.filter((e) => e.wire === rc.row.id)).toEqual([])

    // reverse exclusion is governed by the (cleared) originLayer — unchanged behaviour (C4)
    const out = reverseTranslate(rc.root)
    const rootKids = ((out.template.root as { children?: Array<{ props?: Record<string, unknown> }> }).children) ?? []
    expect(rootKids.some((k) => k.props?.['id'] === 'vpd4-row-marker')).toBe(true)
  })
})

// ===========================================================================
// VPD-5 — FS-VPD-5 · the seam-host CONTROL (the `[6]` root-clobber pin must not regress)
// ===========================================================================
describe('VPD-5 — the seam-consumed provider keeps rendering exactly as the [6] pin expects', () => {
  it('VPD-5 — a seam-consumed provider root emits its OWN element with its own type and children; def children appear only inside the seam wrapper; no warns', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: {
            reference: 'auth',
            value: { type: 'div', children: [{ type: 'button', content: 'Sign In' }, { type: 'div' }] },
          },
          children: [
            { type: 'div', component: [{ target: 'children', reference: 'auth' }] },
            { type: 'div', component: [{ target: 'children', reference: 'nav' }] },
            { type: 'div', content: 'plain' },
          ],
        },
        component: [{ reference: 'nav', value: { type: 'nav', children: [{ type: 'div', content: 'logo' }] } }],
      },
      content: [],
    })
    const sup = new Supervisor({ hub: hub(), events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)

    const res = t.root.compile(t.nodes)
    const els = emitElements(
      res.actionable,
      new Map(t.nodes.map((n) => [n.id, { handlers: [], children: n.children.map((c) => ({ id: c.id })) }])),
    )

    // the ROOT emits its own element with its OWN type (never the def's 'div')
    const rootEl = els.find((e) => e.wire === t.root.id)
    expect(rootEl).toBeDefined()
    expect(rootEl!.type).toBe('app')
    expect(rootEl!.childOrder).toEqual(t.root.children.map((c) => c.id))

    // the def children appear ONLY inside the wrapper that seam-references them, exactly once
    const wA = t.root.children[0]!
    const signIns = els.filter((e) => e.props['text'] === 'Sign In')
    expect(signIns).toHaveLength(1)
    expect(descendantsOf(els, wA.id).some((e) => e.props['text'] === 'Sign In')).toBe(true)
    // no def-prototype wire is ever emitted as an element
    const protoIds = new Set(t.nodes.filter((n) => n.state === 'prototype').map((n) => n.id))
    expect(els.filter((e) => protoIds.has(e.wire))).toEqual([])

    // the seam exemption is decided BEFORE any provenance test — no residual diagnostic
    expect(vpdWarns('vpd5')).toEqual([])
  })
})

// ===========================================================================
// VPD-6 — FS-VPD-6 · the content-root provider is dropped EARLIER (`owner-terminated`), no warn
// ===========================================================================
describe('VPD-6 — a content-root provider is `owner-terminated` in `dropped` and never reaches the emit gate', () => {
  it("VPD-6 — contentNodes-terminated provider: dropped with reason 'owner-terminated', no state, no value-record-drop warn", () => {
    const provider = chainToToken(
      makeNode({ type: 'div', props: { id: 'vpd6-provider' } }, 'vpd6-provider'),
      'contentNodes',
    )
    addComponentSource(provider, 'vpd6-name', 'vpd6-value')
    // a consumer with a string `target` makes `hasAnyTarget` true (it is dropped too — unplaced)
    const consumer = makeNode({ type: 'span' }, 'vpd6-consumer')
    targetAnchor(consumer, 'vpd6-name')

    const slice = [provider, consumer]
    const res = provider.compile(slice)

    const entry = res.dropped.find((d) => d.arm.includes(provider.id))
    expect(entry).toBeDefined()
    expect(entry!.reason).toBe('owner-terminated')
    expect(res.actionable.filter((s) => s.nodeId === provider.id)).toEqual([])
    // the diagnostic cannot fire for a node that never reached the emit gate (C5 exclusion 1)
    expect(vpdWarns('vpd6')).toEqual([])
  })
})

// ===========================================================================
// VPD-7 — FS-VPD-7 · mixed provider+consumer keeps its PER-ARM emit (count = arm count)
// ===========================================================================
describe('VPD-7 — a mixed provider+consumer node keeps exactly one state per arm', () => {
  it('VPD-7 — mixed node (targets A, provides B, self-applies B) yields ONE state per resolved arm with its own bindings/forkKey and no standalone provider state', () => {
    const root = makeRoot({ type: 'app' }, 'vpd7-root')
    const mixed = childOf(
      root,
      makeNode({ type: 'section', derived: { props: { 'vpd7-out': { $: 'bindings.vpd7B' } } } }, 'vpd7-mixed'),
    )
    targetAnchor(mixed, 'vpd7A')
    addComponentSource(mixed, 'vpd7B', 'vpd7-bv')
    // two root-terminated producers of A (the K7 legal mix: consume A + provide B + self-apply B)
    const pA1 = childOf(mixed, makeNode({ type: 'div' }, 'vpd7-producer-1'))
    addComponentSource(pA1, 'vpd7A', 'vpd7-a1')
    const pA2 = childOf(mixed, makeNode({ type: 'div' }, 'vpd7-producer-2'))
    addComponentSource(pA2, 'vpd7A', 'vpd7-a2')

    const slice = [root, pA1, pA2, mixed]
    const res = root.compile(slice)

    const arms = res.actionable.filter((s) => s.nodeId === mixed.id)
    // the count is fixed by the ARM count — never by "plus a standalone provider state"
    expect(arms).toHaveLength(2)
    expect(new Set(arms.map((a) => a.pathKey)).size).toBe(2)
    expect(arms.map((a) => a.bindings['vpd7A']).sort()).toEqual(['vpd7-a1', 'vpd7-a2'])
    for (const arm of arms) {
      // own value seeded per arm + the self-apply read bakes per arm
      expect(arm.bindings['vpd7B']).toBe('vpd7-bv')
      expect(arm.props['vpd7-out']).toBe('vpd7-bv')
      expect(arm.forkKey).toBe(arm.pathKey)
    }
  })
})

// ===========================================================================
// VPD-8 — FS-VPD-8 · array-valued provider binding: arity changes nothing
//
// NOTE on the row's second half: FS-VPD-8's "two flushes over an object-valued
// derived bake produce one `set` per flush" is the ACCEPTED churn (AM-8-ii),
// not a new fail-state, and its set-op count depends on HOW a given bake
// expression materialises (a fresh array per bake vs. the anchor's own
// reference). Asserting a set-op count here would pin an implementation detail
// the contract explicitly leaves unguarded, so this case asserts the row's
// disposition half only (EMIT + array published as-is) and re-publishes the
// value on a second compile to prove it is not cached/stale.
// ===========================================================================
describe('VPD-8 — an array-valued provider binding emits with the array published as-is', () => {
  it('VPD-8 — array-valued provider: one state, the array published verbatim, the derived read bakes the array onto the element', () => {
    const arr = ['vpd8-a', 'vpd8-b']
    const root = makeRoot({ type: 'app' }, 'vpd8-root')
    const provider = childOf(
      root,
      makeNode({ type: 'div', derived: { props: { 'vpd8-out': { $: 'bindings.vpd8arr' } } } }, 'vpd8-provider'),
    )
    addComponentSource(provider, 'vpd8arr', arr)
    const consumer = childOf(root, makeNode({ type: 'span' }, 'vpd8-consumer'))
    targetAnchor(consumer, 'vpd8arr')

    const slice = [root, provider, consumer]
    const res = root.compile(slice)

    const states = res.actionable.filter((s) => s.nodeId === provider.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.bindings['vpd8arr']).toEqual(arr)

    const els = emitted(res, slice)
    const providerEl = els.find((e) => e.wire === provider.id)
    expect(providerEl).toBeDefined()
    expect(providerEl!.props['prop:vpd8-out']).toEqual(arr)

    // a second compile re-publishes the same array value (the bake is per state, not cached)
    const again = emitted(root.compile(slice), slice)
    expect(again.find((e) => e.wire === provider.id)!.props['prop:vpd8-out']).toEqual(arr)

    expect(vpdWarns('vpd8')).toEqual([])
  })
})

// ===========================================================================
// VPD-9 — FS-VPD-9 · target-free slice CONTROL (`hasAnyTarget` false ⇒ the drop is inert)
// ===========================================================================
describe('VPD-9 — in a target-free slice the provider emits and stays silent', () => {
  it('VPD-9 — no `target`-role anchor anywhere in the slice: the authored provider emits its element and no warn fires', () => {
    const root = makeRoot({ type: 'app' }, 'vpd9-root')
    const provider = childOf(root, makeNode({ type: 'div' }, 'vpd9-provider'))
    addComponentSource(provider, 'vpd9-name', 'vpd9-value')
    // a consumer-shaped anchor that is NOT a `target` role (a duplex) — hasAnyTarget stays false
    const other = childOf(root, makeNode({ type: 'span' }, 'vpd9-other'))
    addComponentSource(other, 'vpd9-name', 'vpd9-duplex', 'duplex')

    const slice = [root, provider, other]
    // fixture guard: the slice really carries no string `target` anchor
    expect(slice.some((n) => n.anchors.some((a) => a.role === 'target'))).toBe(false)

    const res = root.compile(slice)
    const states = res.actionable.filter((s) => s.nodeId === provider.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.bindings['vpd9-name']).toBe('vpd9-value')

    const els = emitted(res, slice)
    expect(els.some((e) => e.wire === provider.id)).toBe(true)
    expect(vpdWarns('vpd9')).toEqual([])
  })
})

// ===========================================================================
// VPD-10 — FS-VPD-10 · a value record NOBODY consumes emits (the marker alone is insufficient)
// ===========================================================================
describe('VPD-10 — a value record whose names nobody consumes is not a resolution participant', () => {
  it('VPD-10 — unconsumed minted record: emits as an ordinary node and raises no warn', () => {
    const rc = rowsCase('vpd10', 'vpd10-field', 'vpd10-value')
    // a string `target` exists in the slice, but it consumes a DIFFERENT name
    consume(rc, 'vpd10-other')

    const slice = rc.nodes
    const res = rc.root.compile(slice)

    const states = res.actionable.filter((s) => s.nodeId === rc.row.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.bindings['vpd10-field']).toBe('vpd10-value')
    const els = emitted(res, slice)
    expect(els.some((e) => e.wire === rc.row.id)).toBe(true)
    expect(vpdWarns('vpd10')).toEqual([])
  })
})

// ===========================================================================
// VPD-11 — C2 non-forgeability (no fail-state): the marker cannot be smuggled through a document
// ===========================================================================
describe('VPD-11 — `valueRecord`/`originLayer`/`runtimeMinted` are not forgeable through a document', () => {
  it('VPD-11 — a crafted document carrying the runtime markers seeds an AUTHORED provider (emits, no warn)', () => {
    const root = makeRoot({ type: 'app', props: { id: 'vpd11-root' } }, 'vpd11-root')
    const provider = childOf(root, makeNode({ type: 'section', css: { classes: ['vpd11-provider'] } }, 'vpd11-provider'))
    addComponentSource(provider, 'vpd11name', 'vpd11-value')
    const consumer = childOf(root, makeNode({ type: 'span' }, 'vpd11-consumer'))
    targetAnchor(consumer, 'vpd11name')

    // `serializeNode` never ships the runtime markers (they are runtime-only)
    const nodeState = serializeNode(provider) as unknown as Record<string, unknown>
    expect(nodeState['valueRecord']).toBeUndefined()
    expect(nodeState['originLayer']).toBeUndefined()
    expect(nodeState['runtimeMinted']).toBeUndefined()

    // ...and a CRAFTED document that carries them is not admitted by parseNodeState's whitelist
    const serialized = serializeSlice(root, [root, provider, consumer])
    const craftedDoc = JSON.parse(JSON.stringify(serialized)) as {
      template: unknown
      content: Array<Record<string, unknown>>
      clientConfig: { adapter: string; persistence: boolean }
    }
    const crafted = craftedDoc.content.find((entry) => entry['id'] === provider.id)!
    crafted['valueRecord'] = true
    crafted['originLayer'] = 'vpd11-crafted-layer'
    crafted['runtimeMinted'] = true
    expect(crafted['valueRecord']).toBe(true)

    const seeded = loadState(craftedDoc as unknown as SerializedRenderDoc).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded)
    const seededRoot = seeded.find((n) => n.id === root.id)!
    const seededProvider = seeded.find((n) => n.id === provider.id)!

    // the seeded node is AUTHORED: none of the crafted keys reached it
    expect((seededProvider as unknown as Record<string, unknown>)['valueRecord']).toBeUndefined()
    expect(seededProvider.originLayer).toBeUndefined()
    expect(seededProvider.runtimeMinted).toBe(false)

    const res = seededRoot.compile(seeded)
    const states = res.actionable.filter((s) => s.nodeId === provider.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.bindings['vpd11name']).toBe('vpd11-value')
    const els = emitted(res, seeded)
    const seededEl = els.find((e) => e.wire === provider.id)
    expect(seededEl).toBeDefined()
    expect(seededEl!.props['css:classes']).toEqual(['vpd11-provider'])
    expect(vpdWarns('vpd11')).toEqual([])
  })
})

// ===========================================================================
// VPD-12 — C3 dedup + the `shouldWarn` focus gate (no fail-state)
// ===========================================================================
describe('VPD-12 — the focus gate keeps an ancestor value-record drop quiet; the code never enters warnings/dropped', () => {
  it('VPD-12 — the same residual drop warns once with the focus on the record and zero times with the focus on a descendant', () => {
    const rc = rowsCase('vpd12', 'vpd12-field', 'vpd12-value')
    consume(rc, 'vpd12-field')
    const slice = rc.nodes

    // (b) FIRST — focus on a DESCENDANT (a non-record node of the same slice): the
    // `shouldWarn(node)` gate is id-equality, so this pass must stay quiet. Run before (a)
    // because the dedup set is process-wide: a quiet pass must not consume the signature.
    const quiet = rc.root.compile(slice, { focusNodeId: rc.consumer.id })
    expect(vpdWarns('vpd12')).toEqual([])
    // the code never appears in the closed `warnings` union nor in `dropped`, in either case
    expect(quiet.warnings.filter((w) => String(w.code) === VALUE_RECORD_DROP)).toEqual([])
    expect(quiet.dropped.filter((d) => d.arm.includes(rc.row.id))).toEqual([])

    // (a) focus on the record's OWN id — exactly one warn
    const loud = rc.root.compile(slice, { focusNodeId: rc.row.id })
    const lines = vpdWarns('vpd12')
    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain(rc.row.pathKey)
    expect(lines[0]).toContain('vpd12-field')
    expect(loud.warnings.filter((w) => String(w.code) === VALUE_RECORD_DROP)).toEqual([])
    expect(loud.dropped.filter((d) => d.arm.includes(rc.row.id))).toEqual([])
    expect(loud.actionable.filter((s) => s.nodeId === rc.row.id)).toEqual([])
  })
})
