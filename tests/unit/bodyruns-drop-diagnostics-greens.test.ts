/**
 * ===========================================================================
 * BLIND GREENS SET — BODYRUNS-DROP-DIAGNOSTICS (emit-boundary drop diagnostic
 * + the `text`-node children silence clause).  Written 2026-09-23.
 * ===========================================================================
 *
 * BLIND-RULE DECLARATION (AGENTS.md item 10a): this file was authored from the
 * DOCUMENTATION ONLY by an agent who did NOT read `src/**`, and who did NOT read
 * the landed oracle sets `tests/unit/bodyruns-drop-diagnostics.test.ts` or
 * `tests/unit/xor-content-free-parent.test.ts`. Every expectation below is
 * derived from the doc text quoted in the `doc:` line of its case. Other tests
 * were consulted ONLY for harness/import conventions (how the public seams are
 * imported and how a compiled-state-shaped actionable array is fed to
 * `emitElements`), never for behavioural expectations.
 *
 * Derived from:
 *  - `docs/specs/bodyruns-drop-diagnostics.md` — §3 C1 (resolution order),
 *    C2 (containment), C3 (the drop/warn catalogue + message shape table),
 *    C4 (the repetition bound + the signature `${code}\u0000${wire}\u0000${value}`),
 *    C5 / C5.3 (the `text`-node DROP CRITERION: authored `children` (non-empty)
 *    OR a `{ child }` run; a `{ child }`-free run set of ANY length is SILENT),
 *    C6 (byte-identical + no-new-field), C7 (`base.bodyRuns` never mutated),
 *    §4 (the bare-text emit cross-reference), §5 (register rows P-IM-1/2/3,
 *    P-SM-1, P-TP-1, P-IM-4), §9 (W4 implementation notes) incl. §9.2 (the
 *    exact message templates + the dedup key), §9.6 (the fork-arm residual),
 *    §9.8 (residuals R-A1 / R-W4-1).
 *  - `docs/specs/render.md` §3.2b (BT-EMIT-1 content-only, BT-EMIT-3
 *    `childOrder: []`, BT-H5/BT-H6) + §3.4.3 (EMPTY-OWNER-1c).
 *  - `docs/specs/adapters.md` §3.1 (DOM Text-holder step 0) / §3.2 (the
 *    Text-owner rows) / §4.1 (the SSR `isText` descriptor) / §4.3 (the
 *    `childHtml` `isText` branch, FRG-H28) / §4.4 (the `isText` void
 *    exclusion) / §6 (SSR-F5).
 *  - `docs/specs/node.md` §2.1 (the `text` type register entry).
 *  - `docs/skills/designing-pages.md` §2 (the author-facing emit-boundary
 *    diagnostics summary + the bare-text row).
 *  - `docs/decisions.md` rows BODYRUNS-DROP-DIAGNOSTICS, BARE-TEXT-EMIT,
 *    EMPTY-OWNER (the rows the above cite).
 *
 * Public seams used (all named by the docs): `src/core/render-helpers.js`
 * (`emitElements`), `src/core/body-runs.js` (`decodeRuns`), `src/core/adapters.js`
 * (`SSRFragmentAdapter`), `src/core/translate.js` (`translateLegacy`),
 * `src/core/render.js` (`diffMinimal`).
 *
 * NO IMPLEMENTATION FILE WAS READ. Where an observed reading contradicted a doc
 * clause it is reported as a FINDING in the case comment + the run report — the
 * case is NOT reshaped to match the observation.
 *
 * NOTE on the C4 process-level dedup: the signature set is MODULE-level and is
 * never cleared per pass (C4), so every case below uses its OWN element wire and
 * its OWN authored-id values. That makes each case's warn count independent of
 * the other cases in this file (and of the other files in the suite).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { emitElements } from '../../src/core/render-helpers.js'
import { decodeRuns, type BodyRun } from '../../src/core/body-runs.js'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'
import { diffMinimal } from '../../src/core/render.js'

// ---------------------------------------------------------------------------
// Harness — the documented public seam: `emitElements` driven with a
// compiled-state-shaped actionable array + a `Map<string, {base:{props}}>`
// node map (§8.1 harness note; the same map shape C1's authored-id read
// (`base.props.id`) requires).
// ---------------------------------------------------------------------------

type NodeEntry = { base: { props: Record<string, unknown> } }

/** Monotonic name factory: one fresh element wire per EMIT (C4 hygiene). */
let nameSeq = 0
function fresh(prefix: string, base: string): string {
  nameSeq += 1
  return `${prefix}-${base}-${nameSeq}`
}

type Actionable = Record<string, unknown>
type El = {
  wire: string
  type: string
  props: Record<string, unknown>
  childOrder: string[]
  forkKey?: string
}

/** Emit an actionable array + node map through the emit boundary. */
function emit(actionable: Actionable[], nodes: Map<string, NodeEntry>): El[] {
  return emitElements(actionable as never, nodes as never) as unknown as El[]
}

/** Convenience: one element, one node map, `els[0]`. */
function emitOne(
  el: Actionable,
  nodes: Map<string, NodeEntry>,
): El {
  const els = emit([el], nodes)
  expect(els.length).toBeGreaterThanOrEqual(1)
  return els[0]!
}

/** The decoded emitted runs of an element (the adapter-visible run set). */
function runsOf(el: El): BodyRun[] {
  const text = el.props['text']
  return typeof text === 'string' ? decodeRuns(text) : []
}

/** Every `console.warn` call whose single string argument is a bodyruns diagnostic. */
function diagnostics(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls
    .map((c) => c[0])
    .filter((a): a is string => typeof a === 'string' && a.startsWith('[bodyruns]'))
}

/** The subset of diagnostic lines carrying a given code. */
function withCode(lines: string[], code: string): string[] {
  return lines.filter((l) => l.includes(code))
}

let warnSpy: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => {
  try {
    warnSpy.mockRestore()
  } finally {
    vi.restoreAllMocks()
  }
})

// ===========================================================================
// 1. THE C3 CATALOGUE ON THE EMITTED SURFACE
// ===========================================================================

describe('C3 catalogue — the emitted surface + the console.warn diagnostic', () => {
  it('C3-1 — a { child } run naming an authored id that is NOT this element’s child is DROPPED and warns bodyruns-child-unresolved naming the id', () => {
    // doc: §3 C3 row 1 ("absent / dangling id" → code bodyruns-child-unresolved,
    //      run DROPPED from the emitted props['text'], warns YES) + §3 C1 step 4
    //      + §9.2 template `[bodyruns] bodyruns-child-unresolved at <wire>: the
    //      { child } run references authored id "<id>", which is not a child of
    //      this element; the run is dropped`
    // §3 C3: "the run is DROPPED from the emitted props['text']" and the warn
    //      names `<id>` = the run's `child` value verbatim.
    const parent = fresh('w', 'c3dangling')
    const droppedId = `${parent}-missing`
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-kid`, { base: { props: { id: `${parent}-present` } } }],
    ])
    const el = emitOne(
      {
        nodeId: parent,
        type: 'p',
        children: [`${parent}-kid`],
        bodyRuns: [{ child: droppedId }, { text: ' only' }],
      },
      nodes,
    )

    // the drop: the run is absent from the decoded emitted runs
    expect(runsOf(el)).toEqual([{ text: ' only' }])
    expect(JSON.stringify(runsOf(el))).not.toContain(droppedId)

    // the diagnostic: exactly one, right code, right element wire, right id
    const d = diagnostics(warnSpy)
    expect(withCode(d, 'bodyruns-child-unresolved').length).toBe(1)
    expect(d[0]).toContain('bodyruns-child-unresolved')
    expect(d[0]).toContain(`at ${parent}:`)
    expect(d[0]).toContain(`"${droppedId}"`)
    expect(d[0]).toContain('is not a child of this element')
    expect(d[0]).toContain('the run is dropped')
  })

  it('C3-2 — a run naming an authored id carried by ≥2 of the element’s own children resolves to the FIRST in childOrder and warns bodyruns-child-duplicate once', () => {
    // doc: §3 C3 row "duplicate authored id" (code bodyruns-child-duplicate,
    //      "first-match-in-order: the EARLIEST wire in el.childOrder wins",
    //      "Warns ONLY when a { child } run actually references the duplicated
    //      id") + C1 step 2 ordering + §9.2 template with `<n>` = the count of
    //      childOrder wires carrying that authored id.
    const parent = fresh('w', 'c3dup')
    const dupId = `${parent}-dup`
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-k1`, { base: { props: { id: dupId } } }],
      [`${parent}-k2`, { base: { props: { id: dupId } } }],
      [`${parent}-k3`, { base: { props: { id: `${parent}-other` } } }],
    ])
    const el = emitOne(
      {
        nodeId: parent,
        type: 'p',
        children: [`${parent}-k1`, `${parent}-k2`, `${parent}-k3`],
        bodyRuns: [{ child: dupId }, { text: '!' }],
      },
      nodes,
    )

    // first-match-in-order: the earliest wire in childOrder carries the run
    expect(runsOf(el)).toEqual([{ child: `${parent}-k1` }, { text: '!' }])
    expect(runsOf(el)[0]).not.toEqual({ child: `${parent}-k2` })

    // exactly one warn for that signature, naming the id and the count (2)
    const d = diagnostics(warnSpy)
    expect(withCode(d, 'bodyruns-child-duplicate').length).toBe(1)
    expect(d[0]).toContain(`at ${parent}:`)
    expect(d[0]).toContain(`"${dupId}"`)
    expect(d[0]).toContain('2 children of this element')
    expect(d[0]).toContain('the first in childOrder is used')
  })

  it('C3-3 — a `text` node carrying authored children warns text-node-children-ignored ONCE and emits childOrder: [] with only the `text` prop', () => {
    // doc: §3 C5.1/C5.2/C5.3 (warn-and-drop; the element is emitted exactly as
    //      today — `childOrder: []`, props['text'] from the scalar/binding
    //      expression; "No children, no bodyRuns, no wrapper text is
    //      synthesized") + C3's detail literal ("the literal is `children` when
    //      s.children is non-empty") + render.md §3.2b BT-EMIT-1/BT-EMIT-3.
    const parent = fresh('w', 'c5children')
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-kid`, { base: { props: { id: `${parent}-kid-id` } } }],
    ])
    const els = emit(
      [
        {
          nodeId: parent,
          type: 'text',
          content: 'A ',
          children: [`${parent}-kid`],
        },
      ],
      nodes,
    )

    // no synthesis: the text element only, and it is content-only
    expect(els.length).toBe(1)
    const el = els[0]!
    expect(el.type).toBe('text')
    expect(el.childOrder).toEqual([])
    expect(Object.keys(el.props)).toEqual(['text'])
    expect(el.props['text']).toBe('A ')
    // the authored child is NOT emitted anywhere and no <text> wrapper exists
    expect(JSON.stringify(els)).not.toContain(`${parent}-kid`)

    const d = diagnostics(warnSpy)
    expect(withCode(d, 'text-node-children-ignored').length).toBe(1)
    expect(d[0]).toContain(`at ${parent}:`)
    expect(d[0]).toContain('a "text" node carries authored children;')
    expect(d[0]).toContain('no element is created')
  })

  it('C3-4 — a `text` node carrying a { child } run warns text-node-children-ignored ONCE with the `bodyRuns` literal and emits childOrder: []', () => {
    // doc: §3 C5.3 drop criterion (authored `children` non-empty OR at least one
    //      { child } run ⇒ warn) + the C3 detail-literal row (`bodyRuns` "when
    //      the interleaving form is present") + C5.2 (the runs are NOT encoded
    //      into props['text'] on this path — the scalar content expression wins
    //      verbatim).
    const parent = fresh('w', 'c5childrun')
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-kid`, { base: { props: { id: `${parent}-kid-id` } } }],
    ])
    const el = emitOne(
      {
        nodeId: parent,
        type: 'text',
        content: 'A ',
        children: [],
        bodyRuns: [{ text: 'A ' }, { child: `${parent}-kid-id` }],
      },
      nodes,
    )

    expect(el.childOrder).toEqual([])
    expect(Object.keys(el.props)).toEqual(['text'])
    // C5.2 precision note: the runs are NOT encoded into props['text'] on this
    // path — the scalar content expression wins VERBATIM, so the emitted value is
    // the plain (non-body-encoded) string and the { child } run appears nowhere.
    expect(el.props['text']).toBe('A ')
    expect(String(el.props['text'])).not.toContain('\u0001')
    expect(decodeRuns(String(el.props['text']))).toEqual([])

    const d = diagnostics(warnSpy)
    expect(withCode(d, 'text-node-children-ignored').length).toBe(1)
    expect(d[0]).toContain('a "text" node carries authored bodyRuns;')
  })
})

// ===========================================================================
// 2. THE C4 REPETITION BOUND
// ===========================================================================

describe('C4 repetition bound — one warn per signature, ever', () => {
  it('C4-1 — emitting the SAME input twice warns once per signature: the second emit adds NO warn', () => {
    // doc: §3 C4 — signature `${code}\u0000${elementWire}\u0000${runChildValue}`,
    //      "A signature already present is not re-warned. The set is never
    //      cleared on a render pass"; §9.2 (dedup key; "One warn per signature
    //      EVER"); §9.1 (C4 pinned by "P-SM-1's second emit (0 added across
    //      passes)").
    const parent = fresh('w', 'c4repeat')
    const droppedId = `${parent}-ghost`
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-kid`, { base: { props: { id: `${parent}-present` } } }],
    ])
    const actionable = () => [
      {
        nodeId: parent,
        type: 'p',
        children: [`${parent}-kid`],
        bodyRuns: [{ child: droppedId }, { text: ' t' }],
      },
    ]
    const mapOf = () => new Map(nodes)

    const first = emit(actionable(), mapOf())
    const afterFirst = diagnostics(warnSpy).length
    expect(withCode(diagnostics(warnSpy), 'bodyruns-child-unresolved').length).toBe(1)

    const second = emit(actionable(), mapOf())
    const afterSecond = diagnostics(warnSpy).length

    // the drop is identical on both emits (determinism, P-IM-2(a))
    expect(runsOf(first[0]!)).toEqual([{ text: ' t' }])
    expect(runsOf(second[0]!)).toEqual([{ text: ' t' }])
    expect(JSON.stringify(second)).toBe(JSON.stringify(first))

    // the bound: N repeated emits add exactly 0 further diagnostics
    expect(afterSecond).toBe(afterFirst)
    expect(withCode(diagnostics(warnSpy), 'bodyruns-child-unresolved').length).toBe(1)
  })

  it('C4-2 — the bound also holds for the duplicate code across a second emit of the same element wire', () => {
    // doc: §5 P-SM-1's F7 requirement — "a second emit of the SAME element wire
    //      asserting the duplicate warn does not repeat (C4's cross-pass bound)";
    //      §3 C4 (the set is never cleared per pass).
    const parent = fresh('w', 'c4dup')
    const dupId = `${parent}-dup`
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-k1`, { base: { props: { id: dupId } } }],
      [`${parent}-k2`, { base: { props: { id: dupId } } }],
    ])
    const actionable = () => [
      {
        nodeId: parent,
        type: 'p',
        children: [`${parent}-k1`, `${parent}-k2`],
        bodyRuns: [{ child: dupId }],
      },
    ]
    const mapOf = () => new Map(nodes)

    emit(actionable(), mapOf())
    const afterFirst = diagnostics(warnSpy).length
    expect(withCode(diagnostics(warnSpy), 'bodyruns-child-duplicate').length).toBe(1)

    emit(actionable(), mapOf())
    expect(diagnostics(warnSpy).length).toBe(afterFirst)
    expect(withCode(diagnostics(warnSpy), 'bodyruns-child-duplicate').length).toBe(1)
  })
})

// ===========================================================================
// 3. THE C2 CONTAINMENT GUARANTEE
// ===========================================================================

describe('C2 containment — a foreign authored id is never rewritten to a foreign wire', () => {
  it('C2-1 — a foreign authored id (present elsewhere in the graph, absent from this childOrder) yields NO wire outside the emitting element’s own childOrder', () => {
    // doc: §3 C2 ("A { child } run may resolve ONLY to a wire that is a member of
    //      the emitting element's own final childOrder. Any candidate resolution
    //      whose wire is NOT in el.childOrder is dropped (C3), even when the
    //      authored id exists elsewhere in the graph") + §5 P-IM-1 (containment
    //      invariant) + §3 C3 row 2 (foreign id ⇒ bodyruns-child-unresolved +
    //      DROPPED, "no rewrite to the foreign wire").
    const a = fresh('w', 'c2a')
    const b = fresh('w', 'c2b')
    const foreignWire = `${a}-kid`
    const foreignId = `${a}-authored`
    const ownWire = `${b}-kid`
    const nodes = new Map<string, NodeEntry>([
      [foreignWire, { base: { props: { id: foreignId } } }],
      [ownWire, { base: { props: { id: `${b}-own` } } }],
    ])
    const els = emit(
      [
        { nodeId: a, type: 'p', children: [foreignWire] },
        {
          nodeId: b,
          type: 'p',
          children: [ownWire],
          bodyRuns: [{ child: foreignId }, { text: ' x' }],
        },
      ],
      nodes,
    )
    const bEl = els.find((e) => e.wire === b)!
    const ownChildOrder = new Set(bEl.childOrder)

    // containment: every surviving { child } run is a member of the element's
    // own childOrder — and the foreign wire appears nowhere
    for (const run of runsOf(bEl)) {
      if ('child' in run) expect(ownChildOrder.has(run.child)).toBe(true)
    }
    expect(runsOf(bEl)).toEqual([{ text: ' x' }])
    expect(JSON.stringify(els)).not.toContain(`"child":"${foreignWire}"`)

    const d = diagnostics(warnSpy)
    expect(withCode(d, 'bodyruns-child-unresolved').length).toBe(1)
    expect(d[0]).toContain(`at ${b}:`)
    expect(d[0]).toContain(`"${foreignId}"`)
  })
})

// ===========================================================================
// 4. THE SILENT CASES (the false-positive guards)
// ===========================================================================

describe('silent cases — documented inputs where C3/C5 say NOTHING may be emitted', () => {
  it('SILENT-1 — a resolving authored-id ref rewrites to the own-child wire and warns NOTHING', () => {
    // doc: §3 C1 step 2 (rewrite to the own-child wire) + C3 row "run already a
    //      real child wire"/the catalogue's absent-class is not met + §8.1 A+5
    //      ("the run is rewritten to node-3; childOrder unchanged; no warn").
    const parent = fresh('w', 'silentresolve')
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-kid`, { base: { props: { id: `${parent}-inline` } } }],
    ])
    const el = emitOne(
      {
        nodeId: parent,
        type: 'p',
        children: [`${parent}-kid`],
        bodyRuns: [{ child: `${parent}-inline` }, { text: ' text' }],
      },
      nodes,
    )

    expect(el.childOrder).toEqual([`${parent}-kid`])
    expect(runsOf(el)).toEqual([{ child: `${parent}-kid` }, { text: ' text' }])
    expect(diagnostics(warnSpy)).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('SILENT-2 — a real child-WIRE passthrough is byte-identical and warns NOTHING', () => {
    // doc: §3 C1 step 1 ("the run's child value is already an emitted child
    //      wire … pass-through unchanged") + C3 row "run already a real child
    //      wire" (Disposition pass-through, byte-identical; Warns? NO).
    const parent = fresh('w', 'silentwire')
    const wire = `${parent}-kid`
    const nodes = new Map<string, NodeEntry>([
      [wire, { base: { props: { id: `${parent}-whatever` } } }],
    ])
    const el = emitOne(
      { nodeId: parent, type: 'p', children: [wire], bodyRuns: [{ child: wire }, { text: ' x' }] },
      nodes,
    )

    expect(runsOf(el)).toEqual([{ child: wire }, { text: ' x' }])
    expect(diagnostics(warnSpy)).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('SILENT-3 — a childless, { child }-free `text` node with MULTIPLE { text } runs is SILENT (permanent control)', () => {
    // doc: §3 C5.3 drop criterion — "A { child }-free run set — of ANY length,
    //      i.e. any number of { text } runs — NORMALIZES into the scalar text
    //      prop and is SILENT: no element, no wire and no child is named by it,
    //      so nothing is lost and the clause must not warn"; §5 P-IM-4 silent
    //      arm + the A+4c permanent silence control (§5 controls row).
    const parent = fresh('w', 'silenttext')
    const el = emitOne(
      {
        nodeId: parent,
        type: 'text',
        content: 'A ',
        children: [],
        bodyRuns: [{ text: 'A ' }, { text: 'x' }],
      },
      new Map<string, NodeEntry>(),
    )

    expect(el.type).toBe('text')
    expect(el.childOrder).toEqual([])
    expect(Object.keys(el.props)).toEqual(['text'])
    expect(el.props['text']).toBe('A ')
    expect(runsOf(el).some((r) => 'child' in r)).toBe(false)
    expect(diagnostics(warnSpy)).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })

  it('SILENT-4 — a duplicate authored id that NO run references emits NO duplicate warn (C3’s reference gate)', () => {
    // doc: §3 C3 duplicate row — "Warns ONLY when a { child } run actually
    //      references the duplicated id (not merely because a duplicate exists —
    //      that would warn on every emit of a legal document)"; §5 P-SM-1's F7
    //      control ("0 duplicate warns while a duplicate EXISTS").
    const parent = fresh('w', 'silentdup')
    const dupId = `${parent}-dup`
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-k1`, { base: { props: { id: dupId } } }],
      [`${parent}-k2`, { base: { props: { id: dupId } } }],
      [`${parent}-k3`, { base: { props: { id: `${parent}-unique` } } }],
    ])
    const el = emitOne(
      {
        nodeId: parent,
        type: 'p',
        children: [`${parent}-k1`, `${parent}-k2`, `${parent}-k3`],
        bodyRuns: [{ child: `${parent}-unique` }, { text: ' ok' }],
      },
      nodes,
    )

    // the control is not inert: a duplicate really is present in childOrder
    expect(el.childOrder).toEqual([`${parent}-k1`, `${parent}-k2`, `${parent}-k3`])
    // …and the run resolved through the local map to the unique child
    expect(runsOf(el)).toEqual([{ child: `${parent}-k3` }, { text: ' ok' }])
    expect(withCode(diagnostics(warnSpy), 'bodyruns-child-duplicate').length).toBe(0)
    expect(diagnostics(warnSpy)).toEqual([])
  })

  it('SILENT-5 — a normalized single-{ text } bodyRuns (no { child } run at all) warns NOTHING (the C1 zero-cost bail class)', () => {
    // doc: §3 C3 last row — "the props['text'] value is not body-encoded, or
    //      contains no child run ⇒ the resolver returns before doing any work;
    //      Warns? NO" + C6.5 (the zero-cost bail stays).
    const parent = fresh('w', 'silenttextonly')
    const el = emitOne(
      { nodeId: parent, type: 'p', content: 'plain', bodyRuns: [{ text: 'plain' }] },
      new Map<string, NodeEntry>(),
    )
    expect(String(el.props['text'])).toBe('plain')
    expect(diagnostics(warnSpy)).toEqual([])
    expect(warnSpy).not.toHaveBeenCalled()
  })
})

// ===========================================================================
// 5. C6 — BYTE-IDENTICAL EMIT + NO NEW FIELD + ZERO-OP DIFF
// ===========================================================================

describe('C6 — the byte-identical emit guarantee on a clean input', () => {
  it('C6-1 — a clean emit adds NO key to the element and diffMinimal(prev, els) returns []', () => {
    // doc: §3 C6.1 ("An emit whose elements have no dropped run, no duplicate-id
    //      reference, and no text-node children is byte-identical to today's
    //      emit"), C6.2 ("No field is added to the returned MinimalElement"),
    //      C6.3 (a resolving rewrite still emits zero set ops); §5 P-IM-3 (the
    //      exact key set `{wire,type,props,childOrder}` + `diffMinimal(prev,
    //      els) === []` + 0 diagnostics).
    const parent = fresh('w', 'c6clean')
    const kid = `${parent}-kid`
    const nodes = new Map<string, NodeEntry>([
      [kid, { base: { props: { id: `${parent}-kidid` } } }],
    ])
    const actionable = [
      {
        nodeId: parent,
        type: 'p',
        content: 'plain',
        children: [kid],
        bodyRuns: [{ text: 'plain' }],
      },
    ]

    const els = emit(actionable, new Map(nodes))
    const el = els[0]!

    // key set: nothing new — no drop-list field, no diagnostic carrier
    expect(Object.keys(el).sort()).toEqual(['childOrder', 'props', 'type', 'wire'])
    expect(Object.keys(el.props)).toEqual(['text'])
    expect(el.childOrder).toEqual([kid])

    // zero diagnostics on the clean input
    expect(diagnostics(warnSpy)).toEqual([])

    // prev = the same element set keyed by wire ⇒ an unchanged re-emit is [] ops
    const prev = new Map(els.map((e) => [e.wire, e]))
    const els2 = emit(actionable, new Map(nodes))
    expect(els2[0]!.props['text']).toBe(el.props['text'])
    expect(diffMinimal(prev as never, els2 as never)).toEqual([])
  })

  it('C6-2 — a resolving authored-id rewrite also yields zero diff ops (the rewrite lands in the string before the === compare)', () => {
    // doc: §3 C6.3 ("A resolving rewrite is diff-safe: the rewrite lands in the
    //      emitted props['text'] string before diffMinimal's === compare, so an
    //      unchanged interleaving still emits zero set ops"); §3 C1 (the text
    //      value is rewritten once, at the end).
    const parent = fresh('w', 'c6rewrite')
    const kid = `${parent}-kid`
    const nodes = new Map<string, NodeEntry>([
      [kid, { base: { props: { id: `${parent}-inline` } } }],
    ])
    const actionable = [
      {
        nodeId: parent,
        type: 'p',
        children: [kid],
        bodyRuns: [{ child: `${parent}-inline` }, { text: ' tail' }],
      },
    ]
    const els = emit(actionable, new Map(nodes))
    // the rewrite happened (authored id → own child wire)
    expect(runsOf(els[0]!)).toEqual([{ child: kid }, { text: ' tail' }])
    const prev = new Map(els.map((e) => [e.wire, e]))
    const els2 = emit(actionable, new Map(nodes))
    expect(diffMinimal(prev as never, els2 as never)).toEqual([])
    expect(diagnostics(warnSpy)).toEqual([])
  })

  it('C7 — the emitted rewrite never mutates the authored bodyRuns array (snapshot equality)', () => {
    // doc: §3 C7.1 ("Only the emitted props['text'] string is rewritten; the
    //      authored base.bodyRuns array and its run objects are never written")
    //      + C7.3 ("The drop is emit-local") + §5 P-TP-1 (snapshot deep-equality).
    const parent = fresh('w', 'c7immut')
    const kid = `${parent}-kid`
    const nodes = new Map<string, NodeEntry>([
      [kid, { base: { props: { id: `${parent}-inline` } } }],
    ])
    const authored: BodyRun[] = [
      { child: `${parent}-inline` },
      { child: `${parent}-ghost` },
      { text: ' t' },
    ]
    const snapshot = JSON.stringify(authored)

    const el = emitOne(
      { nodeId: parent, type: 'p', children: [kid], bodyRuns: authored },
      nodes,
    )

    expect(JSON.stringify(authored)).toBe(snapshot)
    expect(authored.length).toBe(3)
    // the emitted rewrite lives only in the string: the resolving ref resolved,
    // the dangling ref dropped — the SOURCE still carries both authored values
    expect(runsOf(el)).toEqual([{ child: kid }, { text: ' t' }])
    expect(authored[1]).toEqual({ child: `${parent}-ghost` })
  })
})

// ===========================================================================
// 6. THE BARE-TEXT EMIT CONTRACT (§4 cross-reference)
// ===========================================================================

describe('bare-text emit — content only, no <text> wrapper, childOrder position', () => {
  function translateWithTextChildren(emptyContent: boolean): {
    out: string
    els: El[]
    root: El
    warnings: string[]
  } {
    const root: Record<string, unknown> = {
      type: 'div',
      children: [
        { type: 'text', content: 'A ' },
        { type: 'strong', content: 'bold', props: { id: 'b1' } },
        { type: 'text', content: ' text' },
      ],
    }
    if (emptyContent) root['content'] = ''
    const doc: LegacyInitialData = {
      template: { root },
      content: [],
      clientConfig: {},
    }
    const t = translateLegacy(doc)
    const states = t.nodes.flatMap((n) => n.compilePath().actionable)
    const els = emit(states as unknown as Actionable[], new Map(t.nodes.map((n) => [n.id, n])) as never)
    const ssr = new SSRFragmentAdapter()
    for (const e of els) {
      ssr.createEl(e.type, e.wire)
      for (const [k, v] of Object.entries(e.props)) ssr.setProp(e.wire, k, v)
    }
    for (const e of els) for (const c of e.childOrder) ssr.appendChild(e.wire, c)
    return {
      out: ssr.fragments.get('root')?.contentText ?? '',
      els,
      root: els.find((e) => e.wire === 'root')!,
      warnings: t.warnings as unknown as string[],
    }
  }

  it('BARE-1 — a parent with content: "" and [text, strong, text] children SSR-renders `A <strong id="b1">bold</strong> text` — no <text> wrapper, in childOrder position', () => {
    // doc: adapters.md §4.3 + FRG-H28 ("p.contentText === 'A <strong
    //      id=\"b1\">bold</strong> text' … no <text> substring appears anywhere
    //      in the output") + §4.4 (the `isText` case is excluded from the void
    //      rule) + render.md §3.2b BT-H5 + §8.2 (the AC-21 input shape: root div
    //      WITHOUT content and the same three children) + render.md §3.4.3
    //      EMPTY-OWNER-1c (an authored `content: ''` is EMITTED as props['text']
    //      = '' while counting as EMPTY for the hidden-container gates).
    const { out, els, root, warnings } = translateWithTextChildren(true)

    expect(out).toBe('A <strong id="b1">bold</strong> text')
    expect(out).not.toContain('<text')

    // the three children are in childOrder position
    expect(root.childOrder.length).toBe(3)
    const inOrder = root.childOrder.map((w) => els.find((e) => e.wire === w)!.type)
    expect(inOrder).toEqual(['text', 'strong', 'text'])

    // `content: ''` is emitted as a live empty text prop (EMPTY-OWNER-1c)
    expect(root.props['text']).toBe('')

    // no translate-channel warning is involved in the bare-text emit
    expect(warnings.length).toBe(0)
  })

  it('BARE-2 — a `text` child is content-only: its emitted element carries ONLY props[`text`] (no prop:/css:/on:/data: mapping)', () => {
    // doc: render.md §3.2b BT-EMIT-1 ("the emitted element carries ONLY
    //      props['text'] … there is no prop:* / css:* / on:* / data: mapping"),
    //      BT-EMIT-3 (`childOrder: []`), BT-EMIT-4 (an auto-minted props.id is
    //      dropped); node.md §2.1 (the same emit rule); adapters.md §3.1 step 0
    //      / §3.2 Text-owner rows (the adapter-side backstop).
    const { els, root, out } = translateWithTextChildren(false)
    const textEls = els.filter((e) => e.type === 'text')

    expect(textEls.length).toBe(2)
    for (const t of textEls) {
      expect(Object.keys(t.props)).toEqual(['text'])
      expect(t.childOrder).toEqual([])
      expect(Object.keys(t).sort()).toEqual(['childOrder', 'forkKey', 'props', 'type', 'wire'])
    }
    // the strong child keeps its authored id; the text children carry no id
    const strong = els.find((e) => e.type === 'strong')!
    expect(strong.props['prop:id']).toBe('b1')
    expect(out).toContain('<strong id="b1">')

    // the root's own childOrder is the [text, strong, text] order and the text
    // children are exactly the two bare fragments (no wrapper, no element shell)
    expect(root.childOrder.length).toBe(3)
  })
})

// ===========================================================================
// 7. THE DOCUMENTED RESIDUALS
// ===========================================================================

describe('documented residuals (§9.6 / §9.8) — behaviour the docs pin explicitly', () => {
  it('RES-1 — a run naming an id with NO authored-id space anywhere in the graph is DROPPED with bodyruns-child-unresolved (the reachable shape of the §188 bail / R-A1)', () => {
    // doc: §3 C1's dead-guard bullet + §8.1 A+7a + §1.1 AM-1 — "The reachable
    //      empty-authored-id shape is an empty-but-non-null index: the bail does
    //      not fire, the run falls through to C1 step 4 and is DROPPED"; §9.8
    //      R-A1 (the bail's !authoredIdToWire half is dead code); §1.1 W5-1
    //      (A+7a's clause (iii) is re-pointed from SILENCE to the WARN).
    const parent = fresh('w', 'res1')
    const ghost = `${parent}-ghost`
    // NO node in the map carries an authored props.id ⇒ the global index is empty
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-kid`, { base: { props: {} } }],
    ])
    const el = emitOne(
      {
        nodeId: parent,
        type: 'p',
        children: [`${parent}-kid`],
        bodyRuns: [{ child: ghost }, { text: ' t' }],
      },
      nodes,
    )

    // (i) the run is dropped by C1 step 4 and appears neither as a run nor as a rewrite
    expect(runsOf(el)).toEqual([{ text: ' t' }])
    expect(String(el.props['text'])).not.toContain(ghost)
    // (ii) the emit neither throws nor mutates the runs (harness reached here)
    expect(el.childOrder).toEqual([`${parent}-kid`])
    // (iii) the C3 warn class fires for exactly this input (the W4/W5 re-point)
    const d = diagnostics(warnSpy)
    expect(withCode(d, 'bodyruns-child-unresolved').length).toBe(1)
    expect(d[0]).toContain(`"${ghost}"`)
  })

  it('RES-2 — a run naming a fork arm’s EXPLICIT arm wire passes through unchanged, with NO warn', () => {
    // doc: §9.6 + §3 C3's fork-arm row — "the child is a component fork arm: the
    //      parent's post-remap childOrder carries nodeId#<i> … passes through
    //      unchanged by C1 step 1 (childWires.has(r.child) is true after the
    //      remap), so the run keeps the arm wire … pass-through: NO [warn]".
    const parent = fresh('w', 'res2')
    const armWire = `${parent}-n#0`
    const nodes = new Map<string, NodeEntry>([
      [`${parent}-n`, { base: { props: { id: `${parent}-base` } } }],
    ])
    const el = emitOne(
      { nodeId: parent, type: 'p', children: [armWire], bodyRuns: [{ child: armWire }, { text: ' arm' }] },
      nodes,
    )

    expect(el.childOrder).toEqual([armWire])
    expect(runsOf(el)).toEqual([{ child: armWire }, { text: ' arm' }])
    expect(diagnostics(warnSpy)).toEqual([])
  })

  it('RES-3 — a run naming the fork arm’s BASE node’s authored id is DROPPED + bodyruns-child-unresolved (R-W4-1: the base wire is not in this childOrder)', () => {
    // doc: §9.6 — "A run naming the arm's base node's authored id cannot resolve
    //      — the global index holds the base wire while childOrder holds the arm
    //      wires, so the clamp finds no member — and is therefore DROPPED +
    //      bodyruns-child-unresolved (C1 step 4)"; §9.8 R-W4-1; §3 C3's
    //      fork-arm row ("an authored-id ref naming the arm's base node resolves
    //      through C1 step 3 only if the indexed wire is in childOrder (it is
    //      not — the arm wires are); otherwise bodyruns-child-unresolved +
    //      DROP").
    const parent = fresh('w', 'res3')
    const baseNode = `${parent}-n`
    const baseId = `${parent}-base`
    const armWire = `${baseNode}#0`
    const nodes = new Map<string, NodeEntry>([
      [baseNode, { base: { props: { id: baseId } } }],
    ])
    const el = emitOne(
      {
        nodeId: parent,
        type: 'p',
        children: [armWire],
        bodyRuns: [{ child: baseId }, { text: ' t' }],
      },
      nodes,
    )

    expect(runsOf(el)).toEqual([{ text: ' t' }])
    expect(JSON.stringify(runsOf(el))).not.toContain(baseId)
    const d = diagnostics(warnSpy)
    expect(withCode(d, 'bodyruns-child-unresolved').length).toBe(1)
    expect(d[0]).toContain(`"${baseId}"`)
  })

  it('RES-4 — never a throw, on every documented drop class at once (containment pin: §3 C3 "Never a throw (DECIDED)")', () => {
    // doc: §3 C3 — "Never a throw (DECIDED): every class above is contained —
    //      matching 'deterministic + contained (never a throw)'"; §3 C5.5 (the
    //      throw alternative is REJECTED). One emit carrying a dangling run, a
    //      foreign run and a text node with authored children must complete and
    //      emit both elements.
    const a = fresh('w', 'res4a')
    const b = fresh('w', 'res4b')
    const foreignId = `${a}-authored`
    const nodes = new Map<string, NodeEntry>([
      [`${a}-kid`, { base: { props: { id: foreignId } } }],
      [`${b}-kid`, { base: { props: { id: `${b}-own` } } }],
    ])
    let els: El[] = []
    expect(() => {
      els = emit(
        [
          { nodeId: a, type: 'p', children: [`${a}-kid`] },
          {
            nodeId: b,
            type: 'p',
            children: [`${b}-kid`],
            bodyRuns: [{ child: foreignId }, { child: `${b}-nothing` }, { text: ' x' }],
          },
          {
            nodeId: `${b}-txt`,
            type: 'text',
            content: 'A ',
            children: [`${b}-kid`],
          },
        ],
        nodes,
      )
    }).not.toThrow()

    expect(els.length).toBe(3)
    expect(runsOf(els[1]!)).toEqual([{ text: ' x' }])
    expect(els[2]!.childOrder).toEqual([])
    const d = diagnostics(warnSpy)
    // one unresolved warn (both drop classes share the code) + one text-node warn
    expect(withCode(d, 'bodyruns-child-unresolved').length).toBeGreaterThanOrEqual(1)
    expect(withCode(d, 'text-node-children-ignored').length).toBe(1)
    // the diagnostic never enters a K4 translate channel — it is console-only
    expect(d.every((l) => l.startsWith('[bodyruns] '))).toBe(true)
  })
})
