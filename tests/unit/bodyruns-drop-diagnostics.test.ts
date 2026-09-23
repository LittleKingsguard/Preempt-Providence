import { describe, it, expect, afterEach, vi } from 'vitest'
import { encodeRuns, decodeRuns, isBodyEncoded, type BodyRun } from '../../src/core/body-runs.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import { diffMinimal, type MinimalElement } from '../../src/core/render.js'
import {
  translateLegacy,
  reverseTranslate,
  type LegacyInitialData,
} from '../../src/core/translate.js'

// ===========================================================================
// BODYRUNS-DROP-DIAGNOSTICS — Unit A+ (the W4 red set) + the §5 typed property
// register (P-IM-1, P-IM-2, P-SM-1, P-IM-3, P-TP-1, P-IM-4).
//
// DERIVATION SOURCE (the ONLY contract input):
//   docs/specs/bodyruns-drop-diagnostics.md
//     §3 C1 (resolution order, the `:188` empty-map bail)
//     §3 C2 (containment — a foreign authored id is DROPPED, never rewritten)
//     §3 C3 (the drop/warn catalogue: codes + `console.warn` channel + message shape)
//     §3 C4 (the repetition bound — module-level signature dedup)
//     §3 C5 (the `text`-node children/`bodyRuns` warn-and-drop clause)
//     §3 C6 (byte-identical guarantee / no new MinimalElement field)
//     §3 C7 (`base.bodyRuns` never mutated)
//     §5    (the typed property register rows + their strategies)
//     §8.1 (Unit A+ cases A+1..A+7), §8.3 (property-layer execution rules)
//   Acceptance items: docs/specs/ur-2026-09-17-review.md §7
//     AC-26 (the red test exists + is executed + FAILS)
//     AC-27 (the test asserts the WARN, not only the drop)
//     AC-28 (the containment case: foreign id DROPPED, no foreign rewrite)
//     AC-29 (the `text`-node children case)
//     AC-32 (the trio stays green — no implementation change in this pass)
//
// USER RULINGS applied (binding, 2026-09-22):
//   * the diagnostic channel is `console.warn` at the emit resolver
//     (spec §3 C3; precedent src/core/ops.ts:401) — every "did a diagnostic
//     fire?" assertion is a `console.warn` spy assertion.
//   * NO implementation change in this pass: this file is the RED set; the
//     GREEN cases below are explicitly labelled controls.
//
// ADVERSARIAL CORRECTION PASS (2026-09-22, audit
// `archive/reviews/2026-09-22/2026-09-22-ur-aplus-adversarial.md` §1/§3/§5 —
// findings F2..F6; corrections only, NO assertion weakened and nothing under
// `src/**` touched):
//   * F2 — P-IM-4 / spec C5.3: the warn criterion is *content loss* (authored
//     children OR a `{ child }` run). A childless, `{ child }`-free `text`
//     node drops NOTHING and MUST stay silent, so the old `expectWarnFor` push
//     for that class (an input the property excludes) is removed and the
//     silence arm is asserted explicitly (plus a childless multi-`{text}`
//     GREEN arm). The RED warn half lives on the authored-children and
//     `{ child }`-run arms, so the row stays genuinely non-vacuous.
//   * F3 — P-IM-2 clause (d): generated runs are now TAGGED BY CLASS
//     (`own-wire` / `own-authored` / `foreign` / `junk-absent`) and `fresh` is
//     built ONLY from the drop class (`junk-absent`, i.e. values that are
//     neither an own child wire nor an own child's authored id), so a run that
//     legitimately RESOLVES (C1 step 1/2) can no longer be counted as a dropped
//     signature. No false red remains at W4, and the row still reds today for
//     the real reason (the diagnostic layer is absent).
//   * F4 — P-TP-1: the computed-but-discarded `emitted` string is replaced by
//     two live assertions on the same attempt (the resolving run's wire IS in
//     `decodeRuns(props['text'])`, the authored array is still deep-equal to
//     its snapshot, and the `foreign-<i>-<r>` run is ABSENT from the emitted
//     string — C2's "drop, never rewrite" half).
//   * F5 — P-IM-1: the mandatory per-attempt liveness clause is now ENFORCED
//     (every attempt must carry a run outside that element's own `childOrder`;
//     the generator proves it or the attempt fails loudly) AND the positive
//     half is asserted (a run naming a FOREIGN WIRE must not appear in the
//     emitted run set at all).
//   * F6 — the register harness records BEFORE it asserts (so a failing row
//     always emits a report line), and reports the §8.3 status vocabulary
//     (HELD / BROKEN / EXPECTED-RED / UNDETERMINED), the strategy id, the
//     attempts, the failure count, the minimized counterexample for a broken
//     row, and — for P-IM-2 — the explicit `fresh.length` vs `perPass[0]`
//     counts. A row may report HELD only when at least one falsification
//     clause was actually LIVE (otherwise UNDETERMINED), per §8.3.
//
// LANDED LINE ANCHORS (2026-09-22; re-anchored in the F1..F6 pass, again in the
// F7 gate-8 correction pass, and again in the W5 oracle-correction pass — the
// spec cites case-level anchors; these are the live line numbers so a later pass
// can re-derive them without prose drift):
//   A+1 258 · A+2 295 · A+2b 310 · A+2-control 329 · A+3 342 · A+4 355
//   A+4b 367 · A+4-control 377 · A+4c 394 · A+5 415 · A+6a 428
//   A+6b 436 · A+7a 516 (W5: its half is the WARN assertion now) · A+7b 535
//   P-IM-1 1111 · P-IM-2 1216 · P-SM-1 1370 · P-IM-3 1532 · P-TP-1 1606
//   P-IM-4 1759 · P-IM-4-control 1889 · register report 1941
// ✎ F7 (ADVERSARIAL CORRECTION, 2026-09-22 — audit finding 7): P-SM-1's
//   generator is corrected so its control is the input the strategy actually
//   describes — `childOrder = [a(dup), b(dup), c(other)]` with a run naming only
//   a unique, non-duplicated id ⇒ 0 `bodyruns-child-duplicate` warns while a
//   duplicate EXISTS (C3's reference gate), plus a second emit of the SAME wire
//   asserting the duplicate warn does not repeat (C4's cross-pass bound, which
//   P-IM-2 applied only to `bodyruns-child-unresolved`). Strengthening only —
//   no assertion weakened, `src/**` untouched, and the row's EXPECTED-RED tally
//   is unchanged (it already fails on the warn half).
//
// ✎ W5 TEST-SIDE ORACLE CORRECTION (2026-09-22 — the follow-up pass the W4
//   implementer correctly refused to do from `src/**`; spec §1.1 row **W5-1** +
//   §9.5(a)). FIVE cases that remained failing after W4 are fixed HERE, test-side
//   only (`src/**`, `package.json` and the frozen gate record untouched):
//   * A+7a — the AM-1-recorded contract flip: the silence half was written
//     against a DROPPING input, which §3 C3 row 1 mandates a
//     `bodyruns-child-unresolved` warn for. Re-pointed to the WARN (code + id +
//     wire), NOT weakened; A+7b keeps the adapter-silence half and gets its own
//     wire/id pair so C4's process-level set cannot mask it.
//   * P-IM-1 (ORACLE-1) — the generator threw BEFORE any emit on 19/100 attempts
//     because the row's own F5 liveness clause needs a (host, foreign child) pair
//     that cannot exist at `k = 1`. The row now supplies its precondition
//     (`k >= 2` AND >=1 child per element, the first child given a unique authored
//     id when it lacks one), so the property is satisfiable for every seed.
//   * P-IM-2 (ORACLE-2) — clauses (c) and (d) were mutually unsatisfiable:
//     (c)'s `expected` excluded the `foreign` drops C3/A+1 mandate a warn for
//     (`total = expected.size + 2`), and (d) filtered `fresh` with a ROW-LOCAL
//     set against C4's PROCESS-LEVEL set. `expected` now carries every C3 drop
//     class (unresolved `junk-absent` U `foreign`, plus `duplicate`) and `fresh`
//     is rebased on the process-level set, which required giving this row its own
//     `pim2-<e>` element namespace (the C3 signature embeds the element wire, so
//     P-IM-1's 100 attempts on `el-0` were suppressing exactly this row's
//     predicted signatures). The W4-grade `fresh.length <= perPass[0]` is
//     asserted.
//   * P-SM-1 (ORACLE-3) — `dupCount` could be 1, i.e. NO duplicate exists, while
//     the row demanded exactly 1 warn (9/40 attempts). The warn arm now really
//     carries a duplicate count of 2+; the single-wire shape is kept as the
//     SILENT control (the sharpest form of C3's reference gate).
//   * P-IM-4 (ORACLE-4) — shape-1 nodes with `cLen = 0` (no children, no
//     bodyRuns => nothing dropped) were pushed into `expectWarnFor`, the same
//     over-strength F2 already fixed for shape 2. The expectation is now assigned
//     BY C5.3's drop criterion; the warn arm stays live (guarded).
//   The status function no longer hard-codes `EXPECTED-RED` for those rows: a
//   failure reports `BROKEN`, so the harness cannot label a regression away.
//   Falsifiability is unchanged in both directions — each corrected clause is
//   falsified by exactly the same-code PRE-correction readings the W4 pass
//   measured (`total = expected.size + 2`; `fresh.length=2 perPass[0]=1`; 0
//   duplicate warns for a real duplicate; 0 `text-node-children-ignored` warns for
//   a real drop), which is what a deleted diagnostic layer produces.
//
// This file touches NO file under src/. It reads only the public seams named by
// the spec (§8.1 harness paragraph): `emitElements` + a node map, `decodeRuns`,
// `SSRFragmentAdapter`, `diffMinimal`, `translateLegacy`/`reverseTranslate`.
// ===========================================================================

const ID = {
  unresolved: 'bodyruns-child-unresolved',
  duplicate: 'bodyruns-child-duplicate',
  textChildren: 'text-node-children-ignored',
} as const

// ---------------------------------------------------------------------------
// Harness: the emit seam (the §8.1 pattern — an actionable array + a node map
// carrying authored `props.id`).
// ---------------------------------------------------------------------------

type EmitActionable = Parameters<typeof emitElements>[0][number]
type NodeMap = Map<string, { base: { props: Record<string, unknown> } }>

/** Build the node map: nodeId -> { base: { props } } (authored ids live here). */
function nodeMapOf(entries: Record<string, Record<string, unknown>>): NodeMap {
  const m: NodeMap = new Map()
  for (const [id, props] of Object.entries(entries)) m.set(id, { base: { props } })
  return m
}

function emit(
  actionable: EmitActionable[],
  nb: NodeMap | null,
): MinimalElement[] {
  return emitElements(actionable as never, (nb ?? null) as never)
}

/** A `console.warn` capture that ALWAYS restores the spy (hard constraint:
 *  never leave a spy installed — a leaked spy is a defect we introduce). */
function warnSpy(): { calls: () => string[]; restore: () => void } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  return {
    calls: () =>
      spy.mock.calls.map((c) => (typeof c[0] === 'string' ? c[0] : JSON.stringify(c[0]))),
    restore: () => spy.mockRestore(),
  }
}

const SPIES: Array<{ restore: () => void }> = []
function spyWarn(): { calls: () => string[]; restore: () => void } {
  const s = warnSpy()
  SPIES.push(s)
  return s
}
afterEach(() => {
  while (SPIES.length > 0) SPIES.pop()!.restore()
  vi.restoreAllMocks()
})

/** Every diagnostic line a code fired in this capture. */
function linesWith(calls: string[], code: string): string[] {
  return calls.filter((c) => c.includes(code))
}

/** The EMIT-RESOLVER diagnostic set this spec defines (§3 C3/C5). The
 *  translate-layer `bodyruns-deprecated` K4 warn is a DIFFERENT seam (C5.7: it
 *  fires at translate for a legacy-JSON doc) and is outside this spec's scope,
 *  so the controls assert on the resolver's own code set — never on "no console
 *  output at all". */
const EMIT_DIAGNOSTIC_CODES = [ID.unresolved, ID.duplicate, ID.textChildren]
function emitDiagnostics(calls: string[]): string[] {
  return calls.filter((c) => EMIT_DIAGNOSTIC_CODES.some((code) => c.includes(code)))
}

function emitP(
  nb: NodeMap | null,
  nodeId: string,
  type: string,
  children: string[],
  bodyRuns: BodyRun[] | undefined,
  extra: Record<string, unknown> = {},
): MinimalElement {
  const a: Record<string, unknown> = { nodeId, type, children, ...extra }
  if (bodyRuns !== undefined) a['bodyRuns'] = bodyRuns
  const els = emit([a as unknown as EmitActionable], nb)
  const el = els.find((e) => e.wire === nodeId)
  expect(el, `element ${nodeId} must be emitted`).toBeDefined()
  return el!
}

function runsOf(el: MinimalElement): BodyRun[] {
  const t = el.props['text']
  return typeof t === 'string' && isBodyEncoded(t) ? decodeRuns(t) : []
}

/** ✎ F7 (a) — a SECOND emit of the SAME element (one actionable) through the
 *  same seam, so the C4 signature (`code\0elementWire\0runChildValue`) is
 *  identical to the first pass's. Used by P-SM-1 to assert the
 *  `bodyruns-child-duplicate` diagnostic does not REPEAT across passes (the
 *  pre-correction row asserted the duplicate warn only within a single emit). */
function emitTwo(
  a: { nodeId: string; type: string; children: string[]; bodyRuns: BodyRun[] },
  nb: NodeMap | null,
): MinimalElement[] {
  return emit([a as unknown as EmitActionable], nb)
}

/** The `{ child }` values that survive in an element's emitted run set. */
function emittedChildWires(el: MinimalElement): string[] {
  return runsOf(el)
    .filter((r): r is { child: string } => typeof (r as { child?: unknown }).child === 'string')
    .map((r) => r.child)
}

// ===========================================================================
// Unit A+ — the red set (§8.1)
// ===========================================================================

describe('BODYRUNS-DROP-DIAGNOSTICS Unit A+ (§8.1) — emit-boundary drop diagnostics + the text-node children clause', () => {
  // -------------------------------------------------------------------------
  // A+1 — foreign/containment (AC-28, §3 C2).
  //   Both elements MUST be constructed inside ONE emitElements call, else the
  //   §8.1-flagged empty-map bail (`render-helpers.ts:188`) short-circuits
  //   before any run is examined and the drop branch is unreachable.
  //   RED expected against the current global-index-first branch (:196-203).
  // -------------------------------------------------------------------------
  it('A+1 — AC-28/C2: a {child} run referencing an authored id that is present elsewhere in the graph but absent from this element\'s own childOrder is DROPPED (never rewritten to the foreign wire)', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({
      'parent-a': {},
      'parent-b': {},
      'node-1': { id: 'a1' }, // A's own child — present ELSEWHERE in the graph
      'node-2': { id: 'b1' }, // B's own child
    })
    // One emitElements call over the WHOLE graph: every authored-id carrier is
    // actionable (the real render shape), so the global index is NON-EMPTY —
    // required, else the C1 `:188` empty-map bail returns before any run is
    // examined (§8.1 harness requirement).
    const els = emit(
      [
        { nodeId: 'parent-a', type: 'p', children: ['node-1'], bodyRuns: [{ text: 'a' }] },
        { nodeId: 'node-1', type: 'span', children: [] },
        { nodeId: 'parent-b', type: 'p', children: ['node-2'], bodyRuns: [{ child: 'a1' }, { text: ' x' }] },
        { nodeId: 'node-2', type: 'span', children: [] },
      ],
      nb,
    )
    const b = els.find((e) => e.wire === 'parent-b')!
    expect(b.childOrder).toEqual(['node-2'])
    const runs = runsOf(b)
    // (a) the foreign wire must never appear (N1: DOM MOVES the element, SSR
    //     DUPLICATES its HTML — §3 C2 consequence table)
    expect(runs.some((r) => (r as { child?: string }).child === 'node-1')).toBe(false)
    // (b) the run is DROPPED, so the run set is exactly the companion text run
    expect(runs).toEqual([{ text: ' x' }])
    // (c) AC-27/§3 C3: the foreign class warns on the `console.warn` channel
    expect(linesWith(spy.calls(), ID.unresolved).length).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // A+2 — duplicate authored id (AC-27, §3 C3 `bodyruns-child-duplicate`).
  //   First-match-in-order + exactly one warn; the no-reference control warns 0.
  // -------------------------------------------------------------------------
  it('A+2 — C3/C4: a run referencing a duplicated authored id resolves to the FIRST wire in childOrder and warns exactly once per signature (bodyruns-child-duplicate)', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ dup: {}, 'node-1': { id: 'dup' }, 'node-2': { id: 'dup' } })
    const el = emitP(nb, 'dup', 'p', ['node-1', 'node-2'], [{ child: 'dup' }, { text: '!' }])
    expect(runsOf(el)).toEqual([{ child: 'node-1' }, { text: '!' }])
    const dupLines = linesWith(spy.calls(), ID.duplicate)
    expect(dupLines.length).toBe(1)
    expect(dupLines[0]).toContain('dup')
  })

  // A+2b — the LOCAL-FIRST half of the C1/C2 precedence pin (§3 C2
  //   "Precedence pin": wherever the own-child local map and the global index
  //   disagree, the own-child map wins). This is the only shape where the two
  //   maps CAN disagree (a duplicated id). Its warn half is asserted by A+2;
  //   this case pins the rewrite/precedence observable alone.
  it('A+2b — C1 step 2: where the own-child local map and the global index disagree on a duplicated id, the OWN child wins (no foreign rewrite)', () => {
    // foreign element 'other' declares id 'dup' BEFORE the element that owns the
    // 'dup' children, so the global index's first entry is the foreign wire.
    const nb = nodeMapOf({ other: {}, own: {}, 'node-1': { id: 'dup' }, 'node-2': { id: 'other-id' } })
    const els = emit(
      [
        { nodeId: 'other', type: 'p', children: [], bodyRuns: [{ text: 'o' }] },
        { nodeId: 'own', type: 'p', children: ['node-1', 'node-2'], bodyRuns: [{ child: 'dup' }, { text: '?' }] },
        { nodeId: 'node-1', type: 'span', children: [] },
        { nodeId: 'node-2', type: 'span', children: [] },
      ],
      nb,
    )
    const own = els.find((e) => e.wire === 'own')!
    const runs = runsOf(own)
    expect(runs.some((r) => (r as { child?: string }).child === 'other')).toBe(false)
    expect(runs).toEqual([{ child: 'node-1' }, { text: '?' }])
  })

  it('A+2-control — C3: a duplicated authored id that NO run references is silent (0 warns)', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ dup: {}, 'node-1': { id: 'dup' }, 'node-2': { id: 'dup' } })
    const el = emitP(nb, 'dup', 'p', ['node-1', 'node-2'], [{ text: 'no run here' }])
    expect(el.childOrder).toEqual(['node-1', 'node-2'])
    expect(emitDiagnostics(spy.calls())).toEqual([])
  })

  // -------------------------------------------------------------------------
  // A+3 — dangling/absent id (§3 C1 step 4 + C3 `bodyruns-child-unresolved`).
  //   The DROP half already holds today (tests/unit/bodyruns-wire-ref.test.ts:69-73);
  //   AC-27 requires the WARN half — the assertion that makes this case RED.
  // -------------------------------------------------------------------------
  it('A+3 — AC-27/C3: an authored id absent from the graph entirely is DROPPED and warns bodyruns-child-unresolved naming the dropped id', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ present: {}, 'node-9': { id: 'present-inline' } })
    const el = emitP(nb, 'present', 'p', ['node-9'], [{ child: 'missing-inline' }, { text: ' only' }])
    expect(runsOf(el)).toEqual([{ text: ' only' }]) // the drop half (GREEN today)
    const lines = linesWith(spy.calls(), ID.unresolved)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toContain('missing-inline')
  })

  // -------------------------------------------------------------------------
  // A+4 — `type:'text'` node with authored children (AC-29, §3 C5).
  // -------------------------------------------------------------------------
  it('A+4 — AC-29/C5: a type:"text" node carrying authored children is emitted with childOrder [] and warns text-node-children-ignored', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ 'node-1': { id: 'kid' } })
    const el = emitP(nb, 'txt-0', 'text', ['node-1'], undefined, { content: 'A ' })
    expect(el.type).toBe('text')
    expect(el.props['text']).toBe('A ')
    expect(el.childOrder).toEqual([]) // the warn-and-drop shape — no synthesis
    const lines = linesWith(spy.calls(), ID.textChildren)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toContain('children')
  })

  it('A+4b — C5.1: a type:"text" node with BOTH children and an interleaving bodyRuns warns once (children+bodyRuns)', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ 'node-1': { id: 'kid' }, 'node-2': { id: 'b1' } })
    const el = emitP(nb, 'txt-1', 'text', ['node-1'], [{ text: 'A ' }, { child: 'b1' }], { content: 'A ' })
    expect(el.childOrder).toEqual([])
    const lines = linesWith(spy.calls(), ID.textChildren)
    expect(lines.length).toBe(1)
    expect(lines[0]).toContain('children+bodyRuns')
  })

  it('A+4-control — C5.3: a childless {text}-only node never warns (the single {text} run normalizes to scalar content)', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ 'node-1': { id: 'kid' } })
    const el = emitP(nb, 'txt-2', 'text', [], [{ text: 'just text' }], { content: 'just text' })
    expect(el.type).toBe('text')
    expect(el.childOrder).toEqual([])
    expect(emitDiagnostics(spy.calls())).toEqual([])
  })

  // -------------------------------------------------------------------------
  // A+4c — F2/C5.3 (adversarial correction): the childless, `{ child }`-FREE
  //   multi-`{text}` node. NOTHING is dropped by the clause here (there are no
  //   authored children and no `{ child }` run), so C5 MUST stay SILENT — the
  //   old P-IM-4 generator made this input warn (a correct implementation would
  //   have FAILED it). This is the GREEN silence control for that class; the
  //   multi-run set is the `isInterleaving` NORMALIZATION flag, not a loss flag.
  // -------------------------------------------------------------------------
  it('A+4c — F2/C5.3 GREEN: a childless, { child }-free multi-{text} text node drops nothing and stays silent (isInterleaving is a normalization flag, not a loss flag)', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ 'node-1': { id: 'kid' } })
    const el = emitP(
      nb,
      'txt-3',
      'text',
      [],
      [{ text: 'A ' }, { text: 'x' }],
      { content: 'A ' },
    )
    expect(el.type).toBe('text')
    expect(el.childOrder).toEqual([])
    expect(emittedChildWires(el)).toEqual([])
    expect(emitDiagnostics(spy.calls())).toEqual([])
  })

  // -------------------------------------------------------------------------
  // A+5 — GREEN CONTROL: the resolving path is unchanged (the landed
  //   0.3.1/0.3.2 contract). Labelled as the landed-contract guard.
  // -------------------------------------------------------------------------
  it('A+5 — GREEN control (landed contract, C1 step 2): a {child} run naming the element\'s OWN child resolves to that child wire and emits NO warn', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ 'node-3': { id: 'inline-0' } })
    const el = emitP(nb, 'p-a5', 'p', ['node-3'], [{ child: 'inline-0' }, { text: ' text' }])
    expect(runsOf(el)).toEqual([{ child: 'node-3' }, { text: ' text' }])
    expect(el.childOrder).toEqual(['node-3'])
    expect(emitDiagnostics(spy.calls())).toEqual([])
  })

  // -------------------------------------------------------------------------
  // A+6 — GREEN CONTROLS: real-wire passthrough + def-fill synthetic rewrite
  //   (the N1-regression guard named in §6).
  // -------------------------------------------------------------------------
  it('A+6a — GREEN control (C1 step 1): a run that is already a real child wire passes through verbatim, no warn', () => {
    const spy = spyWarn()
    const nb = nodeMapOf({ 'node-7': { id: 'foo' } })
    const el = emitP(nb, 'p-a6', 'p', ['node-7'], [{ child: 'node-7' }, { text: ' x' }])
    expect(runsOf(el)).toEqual([{ child: 'node-7' }, { text: ' x' }])
    expect(emitDiagnostics(spy.calls())).toEqual([])
  })

  it('A+6b — GREEN control (C1 step 3, def-fill synthetic wire): a def-child bodyRuns {child} resolves to the element\'s OWN synthetic wire, no warn', () => {
    const spy = spyWarn()
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          component: [
            {
              reference: 'card',
              target: 'children',
              value: {
                type: 'div',
                children: [
                  {
                    type: 'p',
                    content: 'Some text',
                    bodyRuns: [{ text: 'Some ' }, { child: 'bold' }, { text: ' text' }],
                    children: [{ type: 'strong', content: 'Proposal:', props: { id: 'bold' } }],
                  },
                ],
              },
            },
          ],
        },
      },
      content: [],
      clientConfig: {},
    }
    const t = translateLegacy(doc)
    const states = t.nodes.flatMap((n) => n.compilePath().actionable)
    const els = emitElements(states, new Map(t.nodes.map((n) => [n.id, n])) as never)
    const pe = els.find((e) => e.type === 'p')!
    const runs = decodeRuns(pe.props['text'] as string)
    expect(runs).toHaveLength(3)
    const childRun = runs[1] as { child: string }
    expect(childRun.child).not.toBe('bold')
    expect(childRun.child).toContain(pe.wire)
    // the rewrite RESOLVED to the element's own child (not simply dropped):
    // the synthetic wire is a member of this element's childOrder
    expect(pe.childOrder).toContain(childRun.child)
    expect(childRun.child).toBe(pe.childOrder[0])
    // SSR renders it (the synthetic wire resolves inside the adapter too)
    const ssr = new SSRFragmentAdapter()
    for (const e of els) {
      ssr.createEl(e.type, e.wire)
      for (const [k, v] of Object.entries(e.props)) ssr.setProp(e.wire, k, v)
    }
    for (const e of els) for (const c of e.childOrder) ssr.appendChild(e.wire, c)
    const rootHtml = ssr.fragments.get('root')!.contentText
    expect(rootHtml).toContain('Some <strong')
    expect(rootHtml).toContain('</strong> text')
    expect(emitDiagnostics(spy.calls())).toEqual([])
  })

  // -------------------------------------------------------------------------
  // A+7 — the empty-map bail is a DOCUMENTED LIMITATION (C1 `:188`), not a
  //   defect: the run is dropped and (A+7a, RE-POINTED at W4) warned.
  //
  // SPEC DEVIATION, REPORTED (not silently re-shaped): §8.1 A+7 asks for the
  //   run to survive VERBATIM. That observable is NOT REACHABLE through the
  //   public seam: `emitElements` always builds and passes a non-null global
  //   index (`render-helpers.ts:606-613` → `:668`), and `nodeById` is the
  //   function's own parameter — calling without it suppresses the child
  //   elements themselves. So the `!authoredIdToWire` half of the `:188` guard
  //   is unreachable and the `:188`-style outcome cannot be pinned from the
  //   public API. These two cases pin what IS observable: the run DROPS via C1
  //   step 4 WITH the C3 diagnostic (A+7a), and the adapter silent-no-ops the
  //   dropped/absent wire (A+7b, C6: no new output).
  //
  // ✎ RE-POINTED 2026-09-22 (W4 — the AM-1-recorded EXPECTED FLIP, defect row
  //   W4-A+7A-REPOINT / spec §8.1 + §9.4): this case's silence half —
  //   `expect(emitDiagnostics(spy.calls())).toEqual([])` — was written against a
  //   DROPPING input, and §3 C3 row 1 mandates `bodyruns-child-unresolved` for
  //   exactly that drop class, so W4 made the half FALSE BY CONTRACT. Re-pointed
  //   (NOT weakened): the case now asserts the WARN, and asserts the specific
  //   CODE and the dropped `<id>` (not merely "something warned"), exactly as
  //   A+3 does for the same class through the resolver. The drop half and the
  //   no-synthesis half are unchanged. A+7b's assertion is the ADAPTER's silence
  //   and stays GREEN (no adapter-side diagnostic exists — NVA-3).
  // -------------------------------------------------------------------------
  it('A+7a — documented limitation (C1 `:188`): with an empty authored-id space the run is DROPPED by C1 step 4 AND warns bodyruns-child-unresolved naming the dropped id (the spec\'s verbatim-bail observable is unreachable via the public seam; re-pointed at W4 by AM-1/W4-A+7A-REPOINT)', () => {
    const spy = spyWarn()
    // No authored props.id anywhere; the global index is empty (not null), so
    // the `:188` bail requires the map to be ABSENT — see the deviation note.
    const nb = nodeMapOf({ parent: {}, 'node-5': {} })
    const el = emitP(nb, 'parent', 'p', ['node-5'], [{ child: 'ghost' }, { text: ' t' }])
    // (i) the DROP half (unchanged): C1 step 4 removes the run
    expect(runsOf(el)).toEqual([{ text: ' t' }])
    expect(String(el.props['text'])).not.toContain('ghost')
    // (ii) the emit neither throws nor synthesizes a child
    expect(el.childOrder).toEqual(['node-5'])
    // (iii) RE-POINTED: the drop class is `bodyruns-child-unresolved` + warn
    //       (§3 C3 row 1) — the code and the dropped id are both asserted.
    const lines = linesWith(spy.calls(), ID.unresolved)
    expect(lines.length).toBeGreaterThan(0)
    expect(lines[0]).toContain('ghost')
    expect(lines[0]).toContain('parent')
  })

  it('A+7b — documented limitation: the SSR adapter silent-no-ops an unresolved wire (no HTML, no throw, no adapter-side diagnostic)', () => {
    const spy = spyWarn()
    // A wire+id pair unique to THIS case, so the C4 process-level set cannot
    // suppress the resolver's warn and the "no ADAPTER-side diagnostic" half is
    // observed on its own evidence rather than through another case's dedup.
    const nb = nodeMapOf({ 'parent-b7': {}, 'node-5': {} })
    const el = emitP(nb, 'parent-b7', 'p', ['node-5'], [{ child: 'ghost-b7' }, { text: ' t' }])
    // The resolver's own diagnostic fired (C3 + A+7a's contract, through a fresh
    // signature); everything AFTER this point is the adapter's responsibility.
    expect(linesWith(spy.calls(), ID.unresolved).length).toBe(1)
    const afterEmit = spy.calls().length
    const ssr = new SSRFragmentAdapter()
    ssr.createEl(el.type, el.wire)
    for (const [k, v] of Object.entries(el.props)) ssr.setProp(el.wire, k, v)
    ssr.createEl('p', 'node-5')
    ssr.setProp('node-5', 'text', 'child')
    ssr.appendChild(el.wire, 'node-5')
    expect(ssr.fragments.get('parent-b7')!.contentText).toBe(' t')
    // ✎ The assertion is scoped to the ADAPTER's silence (NVA-3,
    //   `adapters.md:561`; spec §8.1 A+7b): the adapter is a pure silent
    //   consumer — materializing the element (createEl/setProp/appendChild)
    //   added NO diagnostic of any kind, and in particular no adapter-side
    //   `bodyruns-child-unresolved`. This half stays GREEN at W4 and fails a W4
    //   that "helpfully" adds an adapter-side warn.
    expect(spy.calls().length).toBe(afterEmit)
    expect(emitDiagnostics(spy.calls()).length).toBe(1)
  })
})

// ===========================================================================
// §5 THE TYPED PROPERTY REGISTER — executed per §8.3.
//
// Execution rules (§8.3, repo rules): one pinned seed for the whole run
// (SEED below, printed in the report); ≤100 attempts per row; ≤400 attempts
// total; stop after 5 failures per row. No PBT harness exists in this repo, so
// the generator is an inline seeded PRNG (no new dependency).
//
// §8.3 STATUS VOCABULARY (F6): every row is reported as `HELD` / `BROKEN` /
// `EXPECTED-RED` / `UNDETERMINED` **before** its assertion runs, so a FAILING
// row always emits a report line. A row may report `HELD` only when at least
// one of its falsification clauses was actually LIVE in the attempts
// (`live === true`); without a live clause the status is `UNDETERMINED`.
// ===========================================================================

/** PINNED SEED (printed by the register report). */
const SEED = 0x5eed_0922

function mulberry32(a: number): () => number {
  return () => {
    let t = (a += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Seeded generator helpers — deterministic, no dependency. */
class Seeded {
  readonly rnd: () => number
  constructor(public seed: number) {
    this.rnd = mulberry32(seed >>> 0)
  }
  int(lo: number, hi: number): number {
    if (hi <= lo) return lo
    return lo + Math.floor(this.rnd() * (hi - lo + 1))
  }
  pick<T>(arr: readonly T[]): T {
    return arr[this.int(0, arr.length - 1)]!
  }
  maybe(p: number): boolean {
    return this.rnd() < p
  }
  shuffled<T>(arr: readonly T[]): T[] {
    const a = [...arr]
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = this.int(0, i)
      const tmp = a[i]!
      a[i] = a[j]!
      a[j] = tmp
    }
    return a
  }
}

/** The pinned per-attempt seed (deterministic, seed-derived; never `i * huge`). */
function attemptSeed(i: number): number {
  return (SEED + Math.imul(i + 1, 0x9e3779b1)) >>> 0
}

/** §8.3 ATTEMPT BUDGET (explicit + checkable). Ceilings: ≤100 attempts per row,
 *  ≤400 attempts in total. The allocation is fixed PER ROW (not drawn from a
 *  shared running total) so every row is guaranteed work regardless of the
 *  order the rows execute in; the driver still stops a row after 5 failures. */
const BUDGET_CEILING = { perRow: 100, total: 400 }
const ROW_ATTEMPTS: Record<string, number> = {
  'P-IM-1': 100,
  'P-IM-2': 100,
  'P-SM-1': 40,
  'P-IM-3': 60,
  'P-TP-1': 50,
  'P-IM-4': 25,
  'P-IM-4-control': 25,
}
function rowAttempts(row: string): number {
  const n = ROW_ATTEMPTS[row]
  if (n === undefined) throw new Error(`no pinned attempt budget for row ${row}`)
  return n
}

// ---------------------------------------------------------------------------
// §8.3 report plumbing (F6). The report row is built and PUSHED before the
// row's `expect`, so a failing row is never silent; the status vocabulary is
// the §8.3 one and `HELD` requires a LIVE falsification clause.
// ---------------------------------------------------------------------------

type RowStatus = 'HELD' | 'BROKEN' | 'EXPECTED-RED' | 'UNDETERMINED'

type RegisterResult = { attempts: number; failures: number; first: string | null; live: boolean }
type ReportRow = {
  row: string
  strategy: string
  status: RowStatus
  attempts: number
  failures: number
  first: string | null
  /** the minimized counterexample (§8.3 — present for a broken/red row) */
  counterexample: string | null
  live: boolean
  /** P-IM-2: the non-vacuity counts §8.3 demands be explicit */
  freshCount?: number
  pass1Count?: number
  /** P-IM-1 (F5): how many attempts carried a live FOREIGN-WIRE candidate for
   *  the positive half — the evidence that the positive half is not a dead
   *  clause which only the universal negative keeps from running */
  positiveHalfLive?: number
  note?: string
}

/** The bounded register driver (§8.3): ≤100 attempts/row, stop after 5 failures.
 *  `run` returns a counterexample string (or null) and reports whether at least
 *  one falsification clause was LIVE in that attempt. */
function runRegisterRow(
  strategyId: string,
  maxAttempts: number,
  run: (attempt: number) => { problem: string | null; live: boolean },
): RegisterResult {
  let attempts = 0
  let failures = 0
  let first: string | null = null
  let live = false
  for (let i = 0; i < maxAttempts; i += 1) {
    attempts += 1
    let problem: string | null
    try {
      const r = run(i)
      problem = r.problem
      if (r.live) live = true
    } catch (err) {
      problem = `THREW: ${err instanceof Error ? err.message : String(err)}`
    }
    if (problem !== null) {
      failures += 1
      if (first === null) first = problem
      if (failures >= 5) break
    }
  }
  return { attempts, failures, first, live }
}

/** §8.3 status, derived HONESTLY (✎ ORACLE-1..4 CORRECTION, 2026-09-22): the
 *  four rows that used to be pinned to `EXPECTED-RED` are satisfiable now, so
 *  the status is no longer hard-coded per row — a failure means the code under
 *  test does not meet the row's pinned contract (`BROKEN`); no failures means
 *  `HELD` only with a LIVE falsification clause, else `UNDETERMINED`. The
 *  `EXPECTED-RED` value remains part of the §8.3 vocabulary for rows that pin a
 *  clause a later pass has not implemented yet. */
function statusOf(res: RegisterResult): RowStatus {
  if (res.failures > 0) return 'BROKEN'
  return res.live ? 'HELD' : 'UNDETERMINED'
}

/** Minimize a counterexample string for the report line (§8.3): collapse the
 *  whitespace and cap the length — the attempt index and the falsified clause
 *  survive, the bulk does not. */
function minimizeCounterexample(s: string | null): string | null {
  if (s === null) return null
  const flat = s.replace(/\s+/g, ' ').trim()
  return flat.length <= 400 ? flat : `${flat.slice(0, 397)}...`
}

/** The register report rows (console.log only — never a console.warn). */
const REGISTER: ReportRow[] = []
function record(row: ReportRow): void {
  REGISTER.push(row)
}

/** Record-then-assert (F6): the report row is PUSHED FIRST, so a row that
 *  fails its assertion still reports its status/attempts/counterexample. */
function reportAndAssert(row: string, strategy: string, res: RegisterResult): void {
  const report: ReportRow = {
    row,
    strategy,
    status: statusOf(res),
    attempts: res.attempts,
    failures: res.failures,
    first: res.first,
    counterexample: res.failures > 0 ? minimizeCounterexample(res.first) : null,
    live: res.live,
  }
  if (row === 'P-IM-2') {
    const counts = LAST_PIM2 ?? { fresh: [], perPass0: -1 }
    report.freshCount = counts.fresh.length
    report.pass1Count = counts.perPass0
  }
  if (row === 'P-IM-1') {
    report.positiveHalfLive = POSITIVE_HALF_LIVE_ATTEMPTS
  }
  record(report)
  expect(res.failures, `${row} counterexample: ${res.first ?? 'none'}`).toBe(0)
}

/** P-IM-2's explicit non-vacuity counts, captured by the row for the report. */
let LAST_PIM2: { fresh: string[]; perPass0: number } | null = null

/** ✎ ORACLE-2 CORRECTION (2026-09-22) — the PROCESS-LEVEL baseline of C4's
 *  signature set. C4's dedup set is MODULE-level and is NEVER cleared per pass
 *  (`render-helpers.ts:174` + `:187-188`), so a signature an EARLIER row in this
 *  same file already fired is legitimately suppressed for P-IM-2. The
 *  pre-correction row compared `fresh` (built against a ROW-LOCAL set only)
 *  against `perPass[0]`, so every such collision reded the row for a reason the
 *  contract MANDATES (measured: `fresh.length=2 perPass[0]=1`).
 *
 *  A baseline signature is `code\0elementWire\0value` exactly as the resolver
 *  builds it (`render-helpers.ts:186`). The entries are the signatures the A+
 *  cases ABOVE this row deterministically produce — including the two that were
 *  the actual collision source found in the full-file run: the id `duplicate`
 *  (`A+2`, wire `dup`) and the id `ghost` (`A+7a`'s drop, wire `parent`), which
 *  the generator's own `JUNK` pool draws too.
 *
 *  ⚠ **P-IM-1 is deliberately NOT enumerated here, and does not need to be:** it
 *  is the other row between the A+ cases and this one, and it fires
 *  `bodyruns-child-unresolved` for the same `JUNK` values this row draws — but
 *  with its own element namespace (`el-<e>`, the generator default) which this
 *  row's `pim2-<e>` isolation makes disjoint. **The isolation is the complete
 *  fix; enumerating P-IM-1's ~100-attempt signature space would be both fragile
 *  and redundant.** The row verifies the isolation empirically: if any P-IM-1
 *  signature could leak in, `fresh` would contain a signature the process had
 *  already fired and clause (d) would fail on the first attempt.
 *
 *  ⛔ It is a SUPPRESSION-only set: it can never make a clause pass that would
 *  otherwise fail. It only stops a signature the contract FORBIDS this row to
 *  count (C4 already fired it) from being demanded of pass 1 again. The
 *  `A+6b` translate path emits on its own `root…:` wire names, so it cannot
 *  collide with the generator's `el-<e>` wires.
 *
 *  =========================================================================
 *  ⚠ HARNESS INVARIANTS (spec docs/specs/bodyruns-drop-diagnostics.md **§8.4**,
 *  added 2026-09-22 by the gate-8 doc review of the W4 landing — audit finding 5).
 *  These are BINDING on any future edit of this file. Both are hardening: they
 *  forbid edits that would make a row pass (or fail) for a reason unrelated to the
 *  contract. **Do not break either one silently.**
 *
 *  H1 — THIS LIST IS A HAND-MAINTAINED MIRROR of the A+ cases' warn signatures.
 *  It is typed by hand, NOT derived, because P-IM-2 must reason about C4's
 *  PROCESS-level set. If you add, remove, rename, or re-point an A+ case's
 *  **element wire**, its dropped **id**, or its **code** (including adding a case
 *  that warns), you MUST update this list in the SAME edit — a desynchronised
 *  mirror silently produces a FALSE `HELD` on P-IM-2, which is exactly the
 *  ORACLE-2 defect class this file already paid for once (§9.5). If you change
 *  the list, say so in the pass report.
 *
 *  H2 — SUITE-LEVEL WIRE UNIQUENESS IS LOAD-BEARING. A+7b asserts an EXACT count
 *  (exactly 1 resolver diagnostic for its own `parent-b7` / `ghost-b7` pair, then
 *  0 further console calls from the adapter); A+7a's half and P-IM-2's clause (d)
 *  likewise depend on which signatures the process has already fired. A new
 *  warn-asserting case must therefore use a **UNIQUE** element wire + dropped id.
 *  Do NOT "tidy" wires to shared names: a reused pair pre-populates C4's
 *  process-level set and turns an exact-count assertion into a false pass (or a
 *  false fail). This is also why P-IM-2 carries its own `pim2-<e>` element
 *  namespace (W5).
 *  ========================================================================= */
const PROCESS_LEVEL_SIGNATURES_FROM_EARLIER_CASES: ReadonlyArray<string> = [
  // A+1 — the foreign-authored-id drop on element `parent-b`
  `bodyruns-child-unresolved\u0000parent-b\u0000a1`,
  // A+2 / A+2b / A+2-control — the duplicate-id diagnostic on elements `dup`/`own`
  `bodyruns-child-duplicate\u0000dup\u0000dup`,
  `bodyruns-child-duplicate\u0000own\u0000dup`,
  // A+3 — the dangling-id drop on element `present`
  `bodyruns-child-unresolved\u0000present\u0000missing-inline`,
  // A+4 / A+4b — both `text`-node clauses (value literal is `children`, C5/C4)
  `text-node-children-ignored\u0000txt-0\u0000children`,
  `text-node-children-ignored\u0000txt-1\u0000children`,
  // A+7a — the reachable empty-authored-id drop on element `parent`; its
  //   `<id>` is `ghost`, which is ALSO a member of the generator's JUNK pool
  `bodyruns-child-unresolved\u0000parent\u0000ghost`,
]


/** P-IM-1 (F5): attempts that carried a live FOREIGN-WIRE candidate for the
 *  containment positive half (reported so the half can never silently die). */
let POSITIVE_HALF_LIVE_ATTEMPTS = 0

/** P-IM-2 (ORACLE-2): attempts whose input carried at least one
 *  process-level-fresh dropped signature — the liveness evidence for clause
 *  (d), the row's only non-vacuity clause. */
let PIM2_FRESH_ATTEMPTS = 0

/** P-IM-4 (ORACLE-4): attempts that carried at least one WARN-arm `text` node
 *  (authored children OR a `{ child }` run) — the liveness evidence that the
 *  row's red warn half did not hollow out once the expectation became
 *  criterion-driven. */
let PIM4_WARN_ARM_ATTEMPTS = 0

/** P-SM-1 (F7, audit finding 7): attempts that exercised the C3
 *  reference-gate CONTROL (a duplicate IS present while the run names a unique,
 *  non-duplicated id ⇒ 0 `bodyruns-child-duplicate` warns). The guard after the
 *  row asserts this is non-zero, so the control can never be inert again. */
let PSM1_CONTROL_ATTEMPTS = 0

// ---------------------------------------------------------------------------
// The generated graph shared by P-IM-1 / P-IM-2 / P-SM-1.
// ---------------------------------------------------------------------------

/** F3: every generated run is TAGGED BY CLASS so a row can build its expected
 *  diagnostics from the DROP class only (never from a run that legally
 *  resolves through C1 step 1/2). */
type RunClass = 'own-wire' | 'own-authored' | 'foreign' | 'junk-absent'
type GenChild = { wire: string; authoredId: string | undefined; owner: string }
type GenRun = { run: BodyRun; isChildRef: boolean; runClass: RunClass; owner: string }
type GenElement = {
  nodeId: string
  children: string[]
  ownedChildren: GenChild[]
  runs: GenRun[]
  actionable: Record<string, unknown>
}
type GenGraph = {
  elements: GenElement[]
  childById: Map<string, GenChild>
  nodeMap: NodeMap
  nodeIds: string[]
  wireOf: (s: { nodeId: string; pathKey?: string }) => string
  /** the whole actionable set (elements + their children), the real-render shape */
  actionable: () => EmitActionable[]
}

const JUNK = ['nope-1', 'nope-2', 'ghost'] as const

/** Classify a run value against the element's OWN children and the graph
 *  (F3 — the `isInterleaving`-vs-drop-criterion distinction at the generator
 *  level: a value that resolves through C1 step 1 or step 2 is NOT a drop). */
function classifyValue(el: GenElement, childById: Map<string, GenChild>, value: string): RunClass {
  if (el.children.includes(value)) return 'own-wire'
  if (el.ownedChildren.some((c) => c.authoredId !== undefined && c.authoredId !== '' && c.authoredId === value)) {
    return 'own-authored'
  }
  const foreignWire = childById.get(value)
  if (foreignWire !== undefined && foreignWire.owner !== el.nodeId) return 'foreign'
  for (const c of childById.values()) {
    if (c.owner !== el.nodeId && c.authoredId !== undefined && c.authoredId !== '' && c.authoredId === value) {
      return 'foreign'
    }
  }
  return 'junk-absent'
}

/** F5: pick a (host element, foreign child) pair whose authored id is NOT the
 *  authored id of any of the host's OWN children — so a `{ child: <that id> }`
 *  run in the host is GUARANTEED to reference a non-own-child id (the
 *  mandatory per-attempt liveness clause). Returns null when no such pair
 *  exists. */
function findForeignChild(
  elements: GenElement[],
  childById: Map<string, GenChild>,
): { host: GenElement; child: GenChild } | null {
  for (const host of elements) {
    const ownIds = new Set(
      host.ownedChildren
        .map((c) => c.authoredId)
        .filter((x): x is string => typeof x === 'string' && x !== ''),
    )
    for (const foreign of childById.values()) {
      if (foreign.owner === host.nodeId) continue
      const id = foreign.authoredId
      if (id === undefined || id === '') continue
      if (ownIds.has(id)) continue
      return { host, child: foreign }
    }
  }
  return null
}

/** ✎ ORACLE-2 CORRECTION (2026-09-22) — the input-derived DROP-SIGNATURE set of
 *  one generated element, i.e. every diagnostic signature C3 MANDATES for this
 *  element's runs, computed from the INPUT (never from the emitted output, which
 *  cannot show a dropped run):
 *
 *   * `bodyruns-child-unresolved` — the C1 step 4 drop classes that reach the
 *     warn: an id absent from the whole graph (`junk-absent`) and a FOREIGN
 *     value (`foreign` — an authored id or a wire owned by another element, C3
 *     row 2/the N1 case). The F5 liveness injections are exactly this class.
 *     The F3 class filter counted `junk-absent` ONLY, which is why clause (c)
 *     failed with `total = expected.size + 2`: the two F5-injected `foreign`
 *     drops warn by contract (§3 C3 row 2) but were absent from `expected`.
 *   * `bodyruns-child-duplicate` — a run whose value is an authored id carried
 *     by ≥2 wires of THIS element's `childOrder` (C3 row 3), which the C1 step 2
 *     local-first resolution warns about. A run that classifies as
 *     `own-authored`/`own-wire` can still be a DUPLICATE reference, so the two
 *     classes are not mutually exclusive and `expected` must carry both, or
 *     clause (c) fails for a conformant implementation.
 *
 *  Both codes are keyed by the element's nodeId, which IS the emitted `el.wire`
 *  for a generated element (no pathKey / no fork arm), exactly as the row's own
 *  assertions assume. */
function expectedDropSignalsOf(el: GenElement): string[] {
  const out: string[] = []
  for (const gr of el.runs) {
    if (!gr.isChildRef) continue
    const value = (gr.run as { child: string }).child
    if (gr.runClass === 'junk-absent' || gr.runClass === 'foreign') {
      out.push(`${ID.unresolved}\u0000${el.nodeId}\u0000${value}`)
    }
  }
  const authoredCount = new Map<string, number>()
  for (const c of el.ownedChildren) {
    if (typeof c.authoredId === 'string' && c.authoredId !== '') {
      authoredCount.set(c.authoredId, (authoredCount.get(c.authoredId) ?? 0) + 1)
    }
  }
  for (const gr of el.runs) {
    if (!gr.isChildRef) continue
    const value = (gr.run as { child: string }).child
    if ((authoredCount.get(value) ?? 0) > 1) {
      out.push(`${ID.duplicate}\u0000${el.nodeId}\u0000${value}`)
    }
  }
  return out
}

function genGraph(
  g: Seeded,
  k: number,
  opts: { pickFromOwnWires?: boolean; minChildren?: number; prefix?: string } = {},
): GenGraph {
  // ✎ ORACLE-1 CORRECTION (2026-09-22, test-side re-point of §5 P-IM-1's
  //   strategy cell): `k ∈ [1,6]` alone CANNOT satisfy the F5 mandatory
  //   liveness clause, because at `k = 1` every child in the graph belongs to
  //   the single element — no (host, foreign authored child) pair exists and
  //   the F5 throw fires BEFORE any emit (pre-correction: 19/100 attempts).
  //   The row therefore seeds `k ≥ 2` AND `minChildren ≥ 1` (each element
  //   carries at least one child), which makes the pair CONSTRUCTIBLE by
  //   construction; the throw below stays as the loud guard of §8.3/F5's
  //   "throws rather than silently shrinking" rule, now unreachable for a row
  //   that supplies this precondition. `minChildren` is drawn with the same
  //   `g.int(0,5)` call as before, so the seeded stream of every other row is
  //   unchanged.
  const elements: GenElement[] = []
  const childById: Map<string, GenChild> = new Map()
  const prefix = opts.prefix ?? 'el'
  let childSeq = 0
  for (let e = 0; e < k; e += 1) {
    // ✎ ORACLE-2 CORRECTION (part 4 — NAMESPACE ISOLATION): the element wire
    //   prefix is a per-ROW parameter. C4's dedup set is MODULE-level and never
    //   cleared, and the C3 signature embeds the ELEMENT WIRE, so two rows that
    //   both emit an element named `el-0` share each other's signatures: the
    //   100 P-IM-1 attempts (which fire `bodyruns-child-unresolved at el-0` for
    //   the JUNK pool `nope-1` / `nope-2` / `ghost`) would populate C4's set
    //   with exactly the signatures P-IM-2's own input-derived `fresh` set
    //   predicts — an unsatisfiable `fresh.length <= perPass[0]` demand for a
    //   CONFORMANT implementation (measured before this fix: `fresh=3
    //   perPass[0]=1`). P-IM-2 therefore generates in its own `pim2-<e>`
    //   namespace; the shared `JUNK` values can no longer collide because the
    //   wire half of the signature differs.
    const nodeId = `${prefix}-${e}`
    const j = Math.max(opts.minChildren ?? 0, g.int(0, 5))
    const owned: GenChild[] = []
    for (let c = 0; c < j; c += 1) {
      childSeq += 1
      const wire = `node-${childSeq}`
      const roll = g.int(0, 4)
      const authoredId =
        roll === 0 ? 'common' : roll === 1 ? '' : roll === 2 ? undefined : `id-${g.int(0, 3)}`
      const ch: GenChild = { wire, authoredId, owner: nodeId }
      owned.push(ch)
      childById.set(wire, ch)
    }
    // ✎ ORACLE-1 CORRECTION: with `minChildren ≥ 1` the element carries a
    //   child, but that child's authored id may still be `common` / `''` /
    //   `undefined` — and an EMPTY authored id can never seed the F5 foreign
    //   pair. Give the FIRST child a per-element unique authored id when it has
    //   none, so `findForeignChild` always has a constructible pair (the row is
    //   then satisfiable for every seed, not merely with high probability).
    if ((opts.minChildren ?? 0) > 0 && owned.length > 0) {
      const first = owned[0]!
      if (first.authoredId === undefined || first.authoredId === '') {
        first.authoredId = `seed-${e}` // the nodeMap below reads it from here
      }
    }
    elements.push({ nodeId, children: owned.map((c) => c.wire), ownedChildren: owned, runs: [], actionable: {} })
  }
  const nodeMap: NodeMap = new Map()
  for (const el of elements) nodeMap.set(el.nodeId, { base: { props: {} } })
  for (const ch of childById.values()) {
    nodeMap.set(
      ch.wire,
      { base: { props: ch.authoredId !== undefined && ch.authoredId !== '' ? { id: ch.authoredId } : {} } },
    )
  }
  // Real-render shape: EVERY authored-id carrier is actionable in the same
  // call (the global index is built over the ACTIONABLE set — a child that is
  // not itself actionable carries no index entry, C1's `:188` note).
  const childActionable = [...childById.keys()].map(
    (wire) => ({ nodeId: wire, type: 'span', children: [] }) as EmitActionable,
  )
  const wireOf = (s: { nodeId: string; pathKey?: string }): string => s.pathKey ?? s.nodeId
  const graph: GenGraph = {
    elements,
    childById,
    nodeMap,
    nodeIds: elements.map((e) => e.nodeId),
    wireOf,
    actionable: () => [
      ...elements.map((e) => e.actionable as EmitActionable),
      ...childActionable,
    ],
  }
  // second pass: runs (F3 — classified; F5 — one guaranteed foreign run)
  for (const el of elements) {
    const m = g.int(0, 4)
    const authoredPool = [...new Set(elements.flatMap((o) => o.ownedChildren.map((c) => c.authoredId)))].filter(
      (x): x is string => typeof x === 'string' && x !== '',
    )
    const wirePool = elements.flatMap((o) => o.ownedChildren.map((c) => c.wire))
    const runs: GenRun[] = []
    for (let r = 0; r < m; r += 1) {
      if (g.maybe(0.35)) {
        runs.push({ run: { text: ' t' + String(r) }, isChildRef: false, runClass: 'junk-absent', owner: el.nodeId })
        continue
      }
      let value: string
      if (opts.pickFromOwnWires) {
        // determinism probe: a value that is EITHER this element's own wire or junk
        value = g.maybe(0.7) && el.children.length > 0 ? g.pick(el.children) : g.pick(JUNK)
      } else {
        const src = g.int(0, 2)
        value = src === 0 ? g.pick(authoredPool.length > 0 ? authoredPool : JUNK) : src === 1 ? g.pick(wirePool) : g.pick(JUNK)
      }
      runs.push({
        run: { child: value },
        isChildRef: true,
        runClass: classifyValue(el, childById, value),
        owner: el.nodeId,
      })
    }
    el.runs = runs
  }
  // F5 liveness injection: guarantee at least ONE run per attempt whose value
  // is not a member of the host element's own childOrder. Throws when the
  // generator cannot produce it (the row must fail loudly, never hollow out).
  const pair = findForeignChild(elements, childById)
  if (pair === null) {
    throw new Error(
      `genGraph: no (element, foreign authored child) pair with an authored id outside the host's own children (k=${k}) — the mandatory F5 liveness clause cannot be met`,
    )
  }
  pair.host.runs.push({
    run: { child: pair.child.authoredId! },
    isChildRef: true,
    runClass: 'foreign',
    owner: pair.host.nodeId,
  })
  // F5 liveness injection #2 (the POSITIVE half's candidate): guarantee a run
  // whose value is a FOREIGN **WIRE** — another element's child wire — so the
  // "a foreign wire must not appear in the emitted run set" assertion always has
  // a live candidate (an authored-id foreign value could not prove that half).
  const host = elements.find((el) => el.children.length > 0)
  const foreignWire = [...childById.values()].find(
    (ch) => host !== undefined && ch.owner !== host.nodeId,
  )
  if (host !== undefined && foreignWire !== undefined) {
    host.runs.push({
      run: { child: foreignWire.wire },
      isChildRef: true,
      runClass: 'foreign',
      owner: host.nodeId,
    })
  }
  for (const el of elements) {
    const a: Record<string, unknown> = { nodeId: el.nodeId, type: 'p', children: el.children }
    if (el.runs.length > 0) a['bodyRuns'] = el.runs.map((r) => r.run)
    el.actionable = a
  }
  return graph
}

describe('§5 property register — executed per §8.3 (inline seeded PRNG, ≤100 attempts/row, stop after 5 failures)', () => {
  // -------------------------------------------------------------------------
  // P-IM-1 — containment: no run ever resolves to a foreign wire (§3 C1/C2).
  //   GREEN against the landed C2 clamp (`childWires.has(globalWire)`,
  //   render-helpers.ts:249); reports HELD. ✎ ORACLE-1 CORRECTION
  //   (2026-09-22): the generator now supplies the F5 precondition the row
  //   demands (`k ≥ 2` AND ≥1 child per element) instead of throwing at `k=1`.
  // -------------------------------------------------------------------------
  it('P-IM-1 (strategy P-IM-1/foreign-graph-gen) — no emitted element carries a {child} wire outside its own childOrder, and a run naming a foreign wire is dropped rather than rewritten; reports HELD', () => {
    const strategy = 'P-IM-1/foreign-graph-gen'
    const maxAttempts = rowAttempts('P-IM-1')
    const res = runRegisterRow(strategy, maxAttempts, (i) => {
      const g = new Seeded(attemptSeed(i))
      // ✎ ORACLE-1 CORRECTION (§5 P-IM-1 strategy cell, amended): `k ≥ 2` plus
      //   at least one child per element — the liveness PRECONDITION the F5
      //   clause requires. The pre-correction draw `g.int(1, 6)` could be 1,
      //   where no foreign pair exists at all, so `genGraph` threw before any
      //   emit (19/100 attempts) and the row could never be satisfied. The row
      //   is now a satisfiable property over the F5 precondition instead of a
      //   generator crash.
      const graph = genGraph(g, g.int(2, 6), { minChildren: 1 })
      // F5 (a) — the mandatory per-attempt liveness clause: the generator must
      // have produced at least one run whose value is NOT a member of its own
      // element's childOrder. Fail the attempt loudly if it did not.
      const liveInputRuns = graph.elements.flatMap((el) =>
        el.runs.filter((r) => r.isChildRef && !el.children.includes((r.run as { child: string }).child)),
      )
      const foreignClassRuns = graph.elements.flatMap((el) => el.runs.filter((r) => r.runClass === 'foreign'))
      // F5: the POSITIVE half's own live candidate — a FOREIGN WIRE run (a wire
      // owned by another element in the same emit). Without it the positive-half
      // assertion would be a dead clause after C2 lands.
      const foreignWireRuns = graph.elements.flatMap((el) =>
        el.runs.filter(
          (r) =>
            r.isChildRef &&
            r.runClass === 'foreign' &&
            graph.childById.has((r.run as { child: string }).child) &&
            !el.children.includes((r.run as { child: string }).child),
        ),
      )
      if (foreignWireRuns.length > 0) POSITIVE_HALF_LIVE_ATTEMPTS += 1
      if (liveInputRuns.length === 0 || foreignClassRuns.length === 0) {
        return {
          problem: `attempt ${i}: LIVENESS VIOLATION — the generator produced no run outside its element's own childOrder (foreign-class runs: ${foreignClassRuns.length}), so the containment clause has no live candidate (F5)`,
          live: false,
        }
      }
      if (foreignWireRuns.length === 0) {
        return {
          problem: `attempt ${i}: LIVENESS VIOLATION — the generator produced no FOREIGN WIRE run, so the F5 positive half ("a foreign wire must not appear in the emitted run set") would be a dead clause`,
          live: false,
        }
      }
      const els = emit(graph.actionable(), graph.nodeMap)
      const foreign: string[] = []
      for (const el of els) {
        const own = new Set(el.childOrder)
        for (const r of runsOf(el)) {
          const w = (r as { child?: string }).child
          if (typeof w === 'string' && !own.has(w)) foreign.push(`${el.wire} -> ${w}`)
        }
      }
      if (foreign.length > 0) {
        const [wire, target] = foreign[0]!.split(' -> ')
        const el = els.find((e) => e.wire === wire)!
        return {
          problem: `attempt ${i}: element "${wire}" (childOrder=${JSON.stringify(el.childOrder)}) carries the FOREIGN run wire "${target}" (not in its own childOrder)`,
          live: true,
        }
      }
      // F5 (b) — the POSITIVE half: a `{ child }` run whose value is a FOREIGN
      // WIRE (a wire belonging to another element in the same emit) must not
      // appear in the emitting element's run set AT ALL — it must be dropped.
      // This is the half that a "dropped-then-re-added" or
      // "rewritten-to-another-own-child" slip would break even while every
      // surviving wire stays inside childOrder.
      for (const el of graph.elements) {
        const own = new Set(el.children)
        const forbidden = el.runs
          .filter((r) => r.isChildRef && r.runClass === 'foreign')
          .map((r) => (r.run as { child: string }).child)
          .filter((v) => graph.childById.has(v) && !own.has(v))
        if (forbidden.length === 0) continue
        const emitted = new Set(emittedChildWires(els.find((e) => e.wire === el.nodeId)!))
        const leaked = forbidden.filter((v) => emitted.has(v))
        if (leaked.length > 0) {
          return {
            problem: `attempt ${i}: element "${el.nodeId}" emitted the FOREIGN WIRE run "${leaked[0]}" — a foreign wire is a C1 step 4 DROP and must never appear in the emitted run set (F5 positive half; C2)`,
            live: true,
          }
        }
      }
      return { problem: null, live: liveInputRuns.length > 0 }
    })
    reportAndAssert('P-IM-1', strategy, res)
    // F5 anti-hollowing guard (runs after the row's report so it can never MASK
    // the row's own status): every attempt must have carried a live
    // FOREIGN-WIRE candidate, else the positive half would be a dead clause that
    // only the universal negative kept from executing.
    expect(
      POSITIVE_HALF_LIVE_ATTEMPTS,
      `F5: only ${POSITIVE_HALF_LIVE_ATTEMPTS} of ${res.attempts} P-IM-1 attempts carried a FOREIGN-WIRE run — the containment positive half would be a dead clause`,
    ).toBe(res.attempts)
  })

  // -------------------------------------------------------------------------
  // P-IM-2 — determinism + idempotency + the C4 count bound (§3 C4).
  //   (a)/(b)/(c) are bound clauses (satisfiable by an emit that warns
  //   nothing); (d) is the non-vacuity LOWER bound that closes that hole.
  //   ✎ ORACLE-2 CORRECTION (2026-09-22): (c)'s `expected` set and (d)'s
  //   `fresh` set are both rebuilt on the semantics the CONTRACT (C3/C4) and
  //   the LANDED code actually implement — see the two comments in the body.
  // -------------------------------------------------------------------------
  it('P-IM-2 (strategy P-IM-2/repeat-emit-determinism) — N successive emits over the same input: byte-identical output, 0 diagnostics on passes >1, total ≤ the distinct drop signatures the input mandates, and pass 1 ≥ the process-level-fresh ones; reports HELD', () => {
    const strategy = 'P-IM-2/repeat-emit-determinism'
    const maxAttempts = rowAttempts('P-IM-2')
    PIM2_FRESH_ATTEMPTS = 0
    /** signatures already met earlier in this row (C4's set is process-level) */
    const seenInFile = new Set<string>()
    const res = runRegisterRow(strategy, maxAttempts, (i) => {
      const g = new Seeded(attemptSeed(i))
      // ✎ ORACLE-2 CORRECTION (part 1 of the F5-precondition alignment): the
      //   same `k ≥ 2` + one-child-per-element precondition P-IM-1 needs, so
      //   the F5 injections this row's `expected` set must account for are
      //   always CONSTRUCTIBLE rather than probabilistically present.
      const graph = genGraph(g, g.int(2, 4), { pickFromOwnWires: true, minChildren: 1, prefix: 'pim2' })
      // NON-VACUITY guarantee: every attempt's first element gets a run with a
      // per-attempt UNIQUE unresolved id, so the attempt HAS a dropped signature
      // (a fresh signature the process has never seen). Without this the clause
      // set would hold vacuously while the diagnostics are entirely absent.
      const ghost = `ghost-${i}`
      const first = graph.elements[0]!
      const firstRuns = [...first.runs.map((r) => r.run), { child: ghost } as BodyRun]
      first.actionable['bodyRuns'] = firstRuns
      const actionable = graph.actionable()
      const N = g.int(2, 5)
      // §8.3 non-vacuity: derive the EXPECTED diagnostics count from the INPUT
      // (per spec §3 C3's message shape `[bodyruns] <code> at <elementWire>: …`)
      // — never from the emitted output, which cannot show a dropped run.
      // ✎ ORACLE-2 CORRECTION (part 2) — the F3 class filter was too narrow and
      //   was the direct cause of `total = expected.size + 2` (measured on
      //   attempts 0/1/2 with no prior row in the process): it counted
      //   `junk-absent` only, so the two F5-injected FOREIGN runs — drops C3
      //   row 2 MANDATES a `bodyruns-child-unresolved` warn for, and which A+1
      //   pins — were missing from `expected` while legitimately present in
      //   `total`. `expected` now carries EVERY drop class C3 mandates for this
      //   input: unresolved (`junk-absent` ∪ `foreign`) **and** duplicate
      //   (≥2 own `childOrder` wires carrying the referenced authored id), so
      //   clause (c) is satisfiable by a conformant implementation and still
      //   falsifiable (one extra warn per input breaks it).
      const expected = new Set<string>()
      for (const el of graph.elements) {
        for (const sig of expectedDropSignalsOf(el)) expected.add(sig)
      }
      // the ghost is a certain drop on the first element (its value is unique
      // to this attempt and can match no wire / no authored id anywhere)
      expected.add(`${ID.unresolved}\u0000${first.nodeId}\u0000${ghost}`)
      // C4's dedup set is PROCESS-level and never cleared, so a signature a
      // PREVIOUS attempt — OR an earlier case in this same file — already fired
      // is legitimately suppressed. Count only the never-seen signatures for
      // this attempt's bound, and record them as seen (the falsification is
      // per-signature, never a whole-graph total — §5).
      // ✎ ORACLE-2 CORRECTION (part 3 — clause (d)): the pre-correction row
      //   filtered `fresh` against a ROW-LOCAL set only, while C4's set is
      //   MODULE-level (`render-helpers.ts:174`, never cleared per pass) — so a
      //   signature an earlier A+ case fired (measured: `dup`/`duplicate` from
      //   A+2 and `ghost` from A+7a — the generated JUNK pool carries `ghost`
      //   too) stayed in `fresh` although the contract FORBIDS pass 1 to warn
      //   it again: `fresh.length=2 perPass[0]=1`, an unsatisfiable demand. The
      //   baseline is now the process-level signature set this file's earlier
      //   cases produce, exactly as §8.3's "account for a signature possibly
      //   already seen in this process" reporting rule requires. Suppression
      //   only: it can never make (d) pass where it would otherwise fail.
      const fresh = [...expected].filter(
        (sig) => !seenInFile.has(sig) && !PROCESS_LEVEL_SIGNATURES_FROM_EARLIER_CASES.includes(sig),
      )
      for (const sig of fresh) seenInFile.add(sig)
      if (fresh.length > 0) PIM2_FRESH_ATTEMPTS += 1
      const spy = spyWarn()
      try {
        const texts: string[] = []
        const canonical: string[] = []
        const perPass: number[] = []
        let total = 0
        let els: ReturnType<typeof emit> = []
        for (let n = 0; n < N; n += 1) {
          els = emit(actionable, graph.nodeMap)
          texts.push(els.map((e) => String(e.props['text'] ?? '')).join('|'))
          canonical.push(JSON.stringify(els))
          perPass.push(spy.calls().length - total)
          total = spy.calls().length
        }
        LAST_PIM2 = { fresh, perPass0: perPass[0]! }
        const lines: string[] = []
        if (new Set(texts).size !== 1 || new Set(canonical).size !== 1) {
          lines.push(`(a) output differs across ${N} passes over the same input`)
        }
        if (perPass.slice(1).some((c) => c !== 0)) {
          lines.push(`(b) pass >1 warned again (per-pass counts ${JSON.stringify(perPass)}) — the P2 per-keystroke hazard`)
        }
        // (c) the per-signature bound — NEVER a whole-graph absolute count
        //     (§5's own Omission note): the total over N passes is bounded by
        //     the number of DISTINCT drop signatures the input mandates, because
        //     the module-level set is never cleared, so it can only be ≤.
        if (total > expected.size) {
          lines.push(
            `(c) total ${total} diagnostics > the ${expected.size} distinct drop signature(s) this input mandates over N=${N}`,
          )
        }
        // (d) the NON-VACUITY lower bound (§8.3/F3): every process-level-FRESH
        //     drop signature the input carries must warn on pass 1 — a bound
        //     clause alone cannot distinguish "the bound holds" from "nothing
        //     exists". A conformant implementation emits exactly one warn per
        //     never-seen signature, so `fresh.length <= perPass[0]` — the
        //     F3-recorded W4-grade tightening of the landed
        //     `perPass[0] >= fresh.length` lower bound, now legitimate because
        //     the suppression set is process-level rather than row-local.
        const pass1Lines: string[] = []
        for (let n = 0; n < perPass[0]!; n += 1) pass1Lines.push(spy.calls()[n] ?? '')
        const warnedFresh = fresh.filter((sig) => {
          const [, wire, value] = sig.split('\u0000')
          return pass1Lines.some((line) => line.includes(value ?? '') && line.includes(wire ?? ''))
        })
        if (fresh.length > 0 && perPass[0]! < fresh.length) {
          const classesOfFresh = graph.elements.flatMap((el) =>
            el.runs
              .filter((r) => r.isChildRef && fresh.includes(`${ID.unresolved}\u0000${el.nodeId}\u0000${(r.run as { child: string }).child}`))
              .map((r) => `${el.nodeId}:${(r.run as { child: string }).child}=${r.runClass}/children=${JSON.stringify(el.children)}`),
          )
          lines.push(
            `(d) NON-VACUITY: the input carries ${fresh.length} process-level-fresh dropped signature(s) [${classesOfFresh.join(', ')}; ghost="${ghost}"] but pass 1 emitted ${perPass[0]} diagnostic(s) — the C3/C4 lower bound does not hold`,
          )
        } else if (fresh.length > 0 && warnedFresh.length !== fresh.length) {
          // the per-signature half: the COUNT bound alone is satisfied by any
          // warn; every process-level-fresh dropped signature must be the one
          // that actually warned (`<wire>` + `<id>` both present in the line).
          lines.push(
            `(d) NON-VACUITY: pass 1 emitted ${perPass[0]} diagnostic(s) but only ${warnedFresh.length} of the ${fresh.length} process-level-fresh dropped signature(s) appear in them (missing: ${JSON.stringify(fresh.filter((x) => !warnedFresh.includes(x)).slice(0, 2))})`,
          )
        }
        return {
          problem: lines.length > 0 ? `attempt ${i}: ${lines.join('; ')} (fresh=${fresh.length} perPass[0]=${perPass[0]})` : null,
          live: fresh.length > 0,
        }
      } finally {
        spy.restore()
      }
    })
    reportAndAssert('P-IM-2', strategy, res)
    // ✎ ORACLE-2 anti-hollowing guard (runs AFTER the row's report so it can
    //   never mask the row's own status): (d) is the row's ONLY non-vacuity
    //   clause, so the row must not be able to report HELD while that clause was
    //   inert. This asserts the clause was LIVE — at least one attempt carried a
    //   process-level-fresh dropped signature.
    expect(
      PIM2_FRESH_ATTEMPTS,
      `P-IM-2: 0 of ${res.attempts} attempts carried a process-level-fresh dropped signature — clause (d) would be inert and the row UNDETERMINED rather than HELD`,
    ).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // P-SM-1 — duplicate authored id: first-match-in-order + exactly one warn.
  //   GREEN against the landed C3 `bodyruns-child-duplicate` warn; reports
  //   HELD. ✎ ORACLE-3 CORRECTION (2026-09-22): the warn shape now really
  //   carries ≥2 wires with the id (the property statement's own scope), and
  //   the degenerate single-wire shape is the silent control.
  // -------------------------------------------------------------------------
  it('P-SM-1 (strategy P-SM-1/duplicate-id-gen) — a run naming a duplicated id resolves to the earliest childOrder wire and warns exactly once per signature, ZERO when a duplicate exists but NO run references it (C3), and does not re-warn on a further emit (C4 cross-pass bound); reports HELD', () => {
    const strategy = 'P-SM-1/duplicate-id-gen'
    const maxAttempts = rowAttempts('P-SM-1')
    PSM1_CONTROL_ATTEMPTS = 0
    const res = runRegisterRow(strategy, maxAttempts, (i) => {
      const g = new Seeded(attemptSeed(i))
      const j = g.int(3, 6)
      const dupId = `dup-${g.int(0, 3)}`
      const nodeId = `sm-${i}`
      const positions = g.shuffled([...Array(j).keys()])
      // ✎ F7 (ADVERSARIAL CORRECTION 2026-09-22 — audit finding 7): the
      //   `childOrder` shape is fixed so BOTH halves C3 names are exercised:
      //     positions 0 and 1 carry the DUPLICATED id, every other position a
      //     UNIQUE `other-<c>` id. The CONTROL can then genuinely be
      //     "a duplicate exists but no run references it" (the pre-correction
      //     control set `childOrder = [a(dup), b(dup), c(other)]` only in shape
      //     and then named a UNIQUE id, so C3's reference gate was never tested).
      //     The duplicate COUNT may be raised above 2 (the `<n>` detail of the
      //     C3 message template) without touching the two pinned positions —
      //     `firstDupWire` is the earliest `childOrder` position carrying `dupId`
      //     and the `other-<c>` id set is unchanged.
      //   The dupId is fixed per attempt (not per position) so the id the run
      //   names is the id the element's own `childOrder` actually duplicates.
      //   ✎ ORACLE-3 CORRECTION (2026-09-22, test-side re-point of §5 P-SM-1's
      //     strategy cell): the draw was `Math.min(j, g.int(1, 3))`, which can be
      //     **1** — i.e. ONE wire carries the id, so **no duplicate exists at
      //     all**. C3's trigger is "≥ 2 wires carry the same authored id" and the
      //     row's own property statement is scoped to ≥ 2 wires, so a run naming a
      //     UNIQUE id correctly resolves through C1 step 2 with NO warn (measured:
      //     9/40 attempts = [4,12,13,14,15,19,21,23,31]). Demanding exactly 1 warn
      //     there is an over-strength the contract does not make — the row now
      //     forces `dupCount ≥ 2` for every attempt, so the property it asserts is
      //     the property C3 states. The degenerate `dupCount === 1` shape keeps its
      //     value as a SILENT control (the `dupCount===1` arm below), which is
      //     exactly C3's reference gate: a unique id must not warn, in the same
      //     shape where a duplicate would.
      const dupDegenerate = g.int(0, 3) === 0
      const dupCount = dupDegenerate ? 1 : Math.min(j, g.int(2, 3))
      const dupPositions = positions.slice(0, dupCount)
      const dupWireSet = new Set(dupPositions)
      const nb: NodeMap = new Map()
      const children: string[] = []
      for (let c = 0; c < j; c += 1) {
        const wire = `sm-${i}-c${c}`
        children.push(wire)
        nb.set(wire, { base: { props: { id: dupWireSet.has(c) ? dupId : `other-${c}` } } })
      }
      // a UNIQUE id that no other child of this element carries — the control's
      // referenced value (it exists, so the run resolves; it is not duplicated
      // and not foreign, so C3 forbids a warn)
      const uniqueId = `unique-${i}`
      const firstDupWire = children[Math.min(...dupPositions)]!
      nb.set(nodeId, { base: { props: {} } })
      // ✎ ORACLE-3: the "referencing" shape is driven by the ACTUAL
      //   duplicate count, never by a coin flip. When `dupCount === 1` the
      //   element carries NO duplicate, so the run naming `dupId` references a
      //   UNIQUE own child — C3's reference gate says that is SILENT (the same
      //   contract A+5 pins), and the row must not demand a warn for it. The
      //   warn half therefore only runs on the shapes that really carry ≥2 wires
      //   with the id (the property statement's scope), and the degenerate shape
      //   becomes the silent control it always was.
      const references = dupCount >= 2 && g.maybe(0.7)
      const runs: BodyRun[] = references
        ? [{ child: dupId }, { text: ' d' }]
        : dupCount >= 2
          ? [{ child: uniqueId }, { text: ' c' }]
          : [{ child: dupId }, { text: ' u' }]
      const spy = spyWarn()
      try {
        const el = emitP(nb, nodeId, 'p', children, runs)
        const got = runsOf(el)
        const childRun = got.find((r) => (r as { child?: string }).child !== undefined) as
          | { child: string }
          | undefined
        const dupLines = linesWith(spy.calls(), ID.duplicate)
        if (references) {
          // C3 pins ONE `bodyruns-child-duplicate` warn per signature: the warn
          // states THAT the referenced id is ambiguous and which wire wins (the
          // `<n>` detail carries how many `childOrder` wires share it), so the
          // count is 1 however many duplicates exist.
          const expectedDupWarns = 1
          if (!childRun || childRun.child !== firstDupWire) {
            return {
              problem: `attempt ${i}: duplicate id "${dupId}" at childOrder positions ${JSON.stringify(dupPositions)} resolved to ${JSON.stringify(childRun?.child ?? null)} (expected the earliest wire "${firstDupWire}")`,
              live: true,
            }
          }
          if (dupLines.length !== expectedDupWarns) {
            return {
              problem: `attempt ${i}: duplicate reference to "${dupId}" produced ${dupLines.length} bodyruns-child-duplicate warnings (expected exactly 1 per signature, C3; ${dupCount} childOrder wires carry the id)`,
              live: true,
            }
          }
        } else {
          // ✎ F7 (a) — THE MISSING CONTROL: a duplicate IS present (`dupCount
          //   ≥ 2` positions carry the same authored id) while the run names a
          //   UNIQUE id, so C3's "warns only when a run actually REFERENCES the
          //   duplicated id" is exercised. ✎ ORACLE-3: on the degenerate
          //   `dupCount === 1` shape the very same gate is exercised in its
          //   sharpest form — the run names `dupId`, which resolves to exactly
          //   ONE child, so there is nothing ambiguous to warn about and a warn
          //   would be a false positive. The drop of the unresolved-but-unique
          //   ref is NOT this row's contract (it is `bodyruns-child-unresolved`, A+3 /
          //   P-IM-1) — only `bodyruns-child-duplicate` is counted here.
          if (dupLines.length !== 0) {
            return {
              problem: `attempt ${i}: an UNREFERENCED duplicate ("${dupId}" present ${dupCount}×) warned ${dupLines.length} bodyruns-child-duplicate time(s) (expected 0 — C3 warns only when a run REFERENCES the duplicated id)`,
              live: true,
            }
          }
          PSM1_CONTROL_ATTEMPTS += 1
        }
        // ✎ F7 (b) — C4's CROSS-PASS BOUND applied to `bodyruns-child-duplicate`
        //   (P-IM-2 applies it only to `bodyruns-child-unresolved`). The SAME
        //   wire is emitted a second time, so the C4 signature
        //   (`code\0elementWire\0runChildValue`, spec §3 C4) is IDENTICAL across
        //   the two emits — the pass-2 diagnostic count MUST be 0 whatever the
        //   first pass produced. A second ELEMENT (`sm2-<i>`) would carry a
        //   different elementWire and therefore a different signature, so it
        //   could NOT distinguish "deduped across passes" from "warned again".
        //   Both halves are live today (0 today, 1 at W4) without changing the
        //   row's expected tally: the row already fails on the warn half.
        const pass1 = dupLines.length
        const els2 = emitTwo(
          {
            nodeId,
            type: 'p',
            children,
            bodyRuns: runs,
          },
          nb,
        )
        expect(els2.filter((e) => e.wire === nodeId)).toHaveLength(1)
        const addedAcrossPass = linesWith(spy.calls(), ID.duplicate).length - pass1
        if (addedAcrossPass !== 0) {
          return {
            problem: `attempt ${i}: a second emit of an UNCHANGED input (element "${nodeId}", ${references ? `referencing the duplicated id "${dupId}"` : 'referencing no duplicated id'}) produced ${addedAcrossPass} additional bodyruns-child-duplicate warning(s) — C4's process-level signature dedup must bound the diagnostic across passes (spec §3 C4)`,
            live: true,
          }
        }
        return { problem: null, live: true }
      } finally {
        spy.restore()
      }
    })
    reportAndAssert('P-SM-1', strategy, res)
    // ✎ F7 anti-inert-control guard (runs AFTER the row's report so it can never
    // mask the row's own status): the C3 reference-gate control — a duplicate
    // that exists while NO run references it — must actually have been
    // exercised. The pre-correction generator's "control" named a UNIQUE id, so
    // this count would be 0 and the control asserted nothing about C3.
    expect(
      PSM1_CONTROL_ATTEMPTS,
      `F7 (audit finding 7): 0 of ${res.attempts} P-SM-1 attempts exercised the unreferenced-duplicate control — C3's reference gate would be untested`,
    ).toBeGreaterThan(0)
  })

  // -------------------------------------------------------------------------
  // P-IM-3 — clean-input passthrough (zero diagnostics, zero ops, exact keys).
  //   HELD (C6 is a preservation clause): its op-count and key-set assertions
  //   are POSITIVE, so a missing diagnostic layer cannot make it pass vacuously.
  // -------------------------------------------------------------------------
  it('P-IM-3 (strategy P-IM-3/clean-tree-gen) — a clean emit (no {child} run, no text node with children) fires no diagnostic, yields zero RenderOps from diffMinimal, and adds no MinimalElement field; reports HELD (positive clauses)', () => {
    const strategy = 'P-IM-3/clean-tree-gen'
    const maxAttempts = rowAttempts('P-IM-3')
    const res = runRegisterRow(strategy, maxAttempts, (i) => {
      const g = new Seeded(attemptSeed(i))
      const k = g.int(1, 4)
      const actionable: EmitActionable[] = []
      const nb: NodeMap = new Map()
      let seq = 0
      for (let e = 0; e < k; e += 1) {
        const nodeId = `clean-${i}-${e}`
        const j = g.int(0, 4)
        const children: string[] = []
        for (let c = 0; c < j; c += 1) {
          seq += 1
          const wire = `clean-${i}-${seq}`
          children.push(wire)
          nb.set(wire, { base: { props: g.maybe(0.3) ? { id: `c${seq}` } : {} } })
        }
        nb.set(nodeId, { base: { props: {} } })
        const shape = g.int(0, 2)
        const a: Record<string, unknown> = { nodeId, type: g.maybe(0.5) ? 'p' : 'span', children }
        if (shape === 1) a['bodyRuns'] = [{ text: 'plain ' }]
        else if (shape === 2) a['bodyRuns'] = [{ text: 'a ' }, { text: 'b' }]
        else a['content'] = 'scalar'
        actionable.push(a as unknown as EmitActionable)
      }
      const spy = spyWarn()
      try {
        const els = emit(actionable, nb)
        if (spy.calls().length !== 0) {
          return {
            problem: `attempt ${i}: a clean emit warned ${spy.calls().length} time(s): ${spy.calls()[0]}`,
            live: true,
          }
        }
        const prev = new Map(els.map((e) => [e.wire, e]))
        const els2 = emit(actionable, nb)
        const ops = diffMinimal(prev, els2)
        if (ops.length !== 0) {
          return {
            problem: `attempt ${i}: the second emit of an unchanged clean input produced ${ops.length} RenderOp(s): ${JSON.stringify(ops[0])}`,
            live: true,
          }
        }
        for (const el of els) {
          const keys = Object.keys(el).sort()
          const ok = keys.every((x) => ['childOrder', 'forkKey', 'props', 'styles', 'type', 'wire'].includes(x)) &&
            ['childOrder', 'props', 'type', 'wire'].every((x) => keys.includes(x))
          if (!ok) {
            return { problem: `attempt ${i}: element ${el.wire} carries unexpected keys ${JSON.stringify(keys)}`, live: true }
          }
          const src = actionable.find((a) => a.nodeId === el.wire)!
          if (JSON.stringify(el.childOrder) !== JSON.stringify(src.children ?? [])) {
            return {
              problem: `attempt ${i}: element ${el.wire} childOrder ${JSON.stringify(el.childOrder)} != children ${JSON.stringify(src.children ?? [])}`,
              live: true,
            }
          }
        }
        return { problem: null, live: true }
      } finally {
        spy.restore()
      }
    })
    reportAndAssert('P-IM-3', strategy, res)
  })

  // -------------------------------------------------------------------------
  // P-TP-1 — base.bodyRuns immutability + reverse fidelity (§3 C7).
  //   HELD (landed; must stay held through W4). F4: the property's SECOND half
  //   ("the emitted rewrite lives only in props['text']") is now asserted on
  //   the same attempt instead of being computed and discarded.
  // -------------------------------------------------------------------------
  it('P-TP-1 (strategy P-TP-1/roundtrip-gen) — the authored bodyRuns array is never mutated by an emit (drops/duplicates included), the emitted rewrite lives only in props["text"], a foreign run is dropped rather than rewritten, and the reverse keeps the authored ids; reports HELD', () => {
    const strategy = 'P-TP-1/roundtrip-gen'
    const maxAttempts = rowAttempts('P-TP-1')
    const res = runRegisterRow(strategy, maxAttempts, (i) => {
      const g = new Seeded(attemptSeed(i))
      const authored: BodyRun[] = []
      const childIds: string[] = []
      const foreignIds: string[] = []
      const m = g.int(1, 4)
      for (let r = 0; r < m; r += 1) {
        const roll = g.int(0, 3)
        if (roll === 0) authored.push({ text: ` t${r}` })
        else if (roll === 1) {
          authored.push({ child: `own-${i}` })
          childIds.push(`own-${i}`)
        } else if (roll === 2) {
          authored.push({ child: `foreign-${i}-${r}` })
          foreignIds.push(`foreign-${i}-${r}`)
        } else authored.push({ child: `dup-${i}` })
      }
      // the element's own children: wire `own-<i>` carries authored id own-<i>;
      // a DUPLICATE id is also placed in the global index via a foreign element.
      const nodeId = `tp-${i}`
      const ownWire = `tp-${i}-own`
      const dupWire = `tp-${i}-dup`
      const nb: NodeMap = new Map([
        [nodeId, { base: { props: {} } }],
        ['tp-foreign', { base: { props: { id: `dup-${i}` } } }],
        [ownWire, { base: { props: { id: `own-${i}` } } }],
        [dupWire, { base: { props: { id: `dup-${i}` } } }],
        [`tp-${i}-kid`, { base: { props: {} } }],
      ])
      const children = [ownWire, dupWire, `tp-${i}-kid`]
      const snapshot = JSON.stringify(authored)
      const el = emitP(nb, nodeId, 'p', children, authored)
      if (JSON.stringify(authored) !== snapshot) {
        return {
          problem: `attempt ${i}: the authored bodyRuns array was MUTATED by the emit: ${JSON.stringify(authored)} (was ${snapshot})`,
          live: true,
        }
      }
      // every dropped/duplicate id still appears verbatim in the source array
      for (const id of [`own-${i}`, `dup-${i}`]) {
        if (authored.some((r) => (r as { child?: string }).child === id) && !snapshot.includes(id)) {
          return { problem: `attempt ${i}: authored id "${id}" disappeared from the source array`, live: true }
        }
      }
      // F4 — the property's SECOND half, asserted live (previously the emitted
      // string was computed at `:859` and discarded at `:901`):
      //  (i) the emitted rewrite lives in props['text'] — the resolving
      //      `{ child: 'own-<i>' }` run IS present in the decoded emitted runs
      //      as the element's OWN child wire;
      const emittedRuns = runsOf(el)
      const emittedWire = String(el.props['text'] ?? '')
      if (authored.some((r) => (r as { child?: string }).child === `own-${i}`)) {
        const expectedWire = el.childOrder[0]!
        const childRuns = emittedRuns.filter(
          (r): r is { child: string } => typeof (r as { child?: unknown }).child === 'string',
        )
        if (!childRuns.some((r) => r.child === expectedWire)) {
          return {
            problem: `attempt ${i}: the resolving run { child: 'own-${i}' } is absent from the EMITTED props['text'] (emitted runs ${JSON.stringify(emittedRuns)}, expected the own child wire "${expectedWire}") — C1 step 2`,
            live: true,
          }
        }
        for (const r of childRuns) {
          if (!el.childOrder.includes(r.child)) {
            return {
              problem: `attempt ${i}: the emitted props['text'] carries the run wire "${r.child}", which is NOT in this element's childOrder ${JSON.stringify(el.childOrder)} (C2)`,
              live: true,
            }
          }
        }
      }
      //  (ii) the authored array is STILL byte-equal to its pre-emit snapshot
      //       after the emit (the rewrite is emit-local, C7 §1/§3);
      if (JSON.stringify(authored) !== snapshot) {
        return {
          problem: `attempt ${i}: the authored bodyRuns array changed across the emit (emit-local rewrite violated, C7): ${JSON.stringify(authored)} (was ${snapshot})`,
          live: true,
        }
      }
      //  (iii) C2's "drop, never rewrite" half: a FOREIGN run must be ABSENT
      //        from the emitted string — neither rewritten to a wire nor
      //        re-added.
      for (const fid of foreignIds) {
        if (emittedRuns.some((r) => (r as { child?: string }).child === fid) || emittedWire.includes(fid)) {
          return {
            problem: `attempt ${i}: the FOREIGN run "${fid}" appears in the emitted props['text'] (emitted runs ${JSON.stringify(emittedRuns)}) — a foreign id must be DROPPED, never rewritten (C2)`,
            live: true,
          }
        }
      }
      // round-trip: translate → emit → reverse keeps the authored ids
      const doc: LegacyInitialData = {
        template: {
          root: {
            type: 'div',
            children: [
              {
                type: 'p',
                content: 'x',
                bodyRuns: [{ text: 'Some ' }, { child: 'rt-bold' }, { text: ' tail' }],
                children: [{ type: 'strong', content: 'bold', props: { id: 'rt-bold' } }],
              },
            ],
          },
        },
        content: [],
        clientConfig: {},
      }
      const docSnapshot = JSON.stringify(doc)
      const t = translateLegacy(doc)
      const states = t.nodes.flatMap((n) => n.compilePath().actionable)
      const rtEls = emitElements(states, new Map(t.nodes.map((n) => [n.id, n])) as never)
      const rtP = rtEls.find((e) => e.type === 'p')!
      const rtRuns = decodeRuns(rtP.props['text'] as string)
      if (!rtRuns.some((r) => (r as { child?: string }).child === rtP.childOrder[0])) {
        return {
          problem: `attempt ${i}: the round-trip emit did not resolve {child:'rt-bold'} to the own child wire (emitted ${JSON.stringify(rtRuns)})`,
          live: true,
        }
      }
      const back = reverseTranslate(t.root)
      const backRuns = (back.template.root.children as Array<{ bodyRuns?: unknown }>)[0]?.bodyRuns
      if (JSON.stringify(backRuns) !== JSON.stringify([{ text: 'Some ' }, { child: 'rt-bold' }, { text: ' tail' }])) {
        return {
          problem: `attempt ${i}: the reverse kept ${JSON.stringify(backRuns)} instead of the authored ids (C7.2)`,
          live: true,
        }
      }
      if (JSON.stringify(doc) !== docSnapshot) {
        return { problem: `attempt ${i}: the input legacy document was mutated by translate/emit/reverse`, live: true }
      }
      return { problem: null, live: true }
    })
    reportAndAssert('P-TP-1', strategy, res)
  })

  // -------------------------------------------------------------------------
  // P-IM-4 — the `text`-node clause never synthesizes structure (§3 C5).
  //   GREEN against the landed C5 drop criterion; reports HELD. ✎ ORACLE-4
  //   CORRECTION (2026-09-22): the warn expectation is assigned BY THE
  //   CRITERION (authored children OR a `{ child }` run), so a `cLen = 0`
  //   shape-1 node is asserted SILENT instead of being demanded to warn.
  //
  //   F2 (adversarial correction, C5.3 AMENDED 2026-09-22): the warn criterion
  //   is CONTENT LOSS — authored `children` (non-empty) OR a `{ child }` run.
  //   A childless, `{ child }`-free `text` node (including a multi-`{text}`
  //   one — `isInterleaving` is a NORMALIZATION flag, not a loss flag) drops
  //   nothing and MUST stay silent; the old generator demanded exactly 1 warn
  //   for that class, which a CORRECT implementation would have failed.
  // -------------------------------------------------------------------------
  it('P-IM-4 (strategy P-IM-4/text-node-gen) — a type:"text" element with authored children and/or a { child } run carries childOrder [] and only a `text` prop, warns exactly once, while a childless { child }-free one stays SILENT; reports HELD', () => {
    const strategy = 'P-IM-4/text-node-gen'
    const maxAttempts = rowAttempts('P-IM-4')
    PIM4_WARN_ARM_ATTEMPTS = 0
    const res = runRegisterRow(strategy, maxAttempts, (i) => {
      const g = new Seeded(attemptSeed(i))
      const k = g.int(1, 3)
      const actionable: EmitActionable[] = []
      const nb: NodeMap = new Map()
      let seq = 0
      const expectWarnFor: string[] = []
      const expectSilenceFor: string[] = []
      for (let e = 0; e < k; e += 1) {
        const nodeId = `txt-${i}-${e}`
        const cLen = g.int(0, 3)
        const children: string[] = []
        for (let c = 0; c < cLen; c += 1) {
          seq += 1
          const wire = `txtkid-${i}-${seq}`
          children.push(wire)
          nb.set(wire, { base: { props: { id: `tk-${i}-${seq}` } } })
        }
        nb.set(nodeId, { base: { props: {} } })
        // shape 0: childless, no bodyRuns (silent)
        // shape 1: authored children, no bodyRuns (WARN)
        // shape 2: childless + multi-{text} bodyRuns (silent — F2's GREEN arm)
        // shape 3: no authored children + a { child } run (WARN)
        const shape = g.int(0, 3)
        const a: Record<string, unknown> = {
          nodeId,
          type: 'text',
          content: 'A ',
          props: { stray: 1 },
          css: { color: 'red' },
          children,
        }
        if (shape === 0) children.splice(0, children.length)
        else if (shape === 2) {
          children.splice(0, children.length)
          a['bodyRuns'] = [{ text: 'A ' }, { text: 'x' }]
        } else if (shape === 3) {
          a['bodyRuns'] = [{ text: 'A ' }, { child: `tk-${i}-1` }]
          children.splice(0, children.length) // interleaving form: no authored children
          a['children'] = []
        }
        // F2 — exactly ONE push per node (the old `:947-948` pushed twice; the
        // second line was dead). Warn only where content would be DROPPED.
        // ✎ ORACLE-4 CORRECTION (2026-09-22, test-side re-point of §5 P-IM-4's
        //   strategy cell): shape 1 was pushed into `expectWarnFor` REGARDLESS of
        //   `cLen`, but shape 1's only loss channel is authored `children` — so
        //   when `cLen = 0` the node carries NOTHING (`children: []`, no
        //   `bodyRuns`) and C5.3's drop criterion mandates SILENCE. Demanding a
        //   warn there was the SAME F2 over-strength the amendment already fixed
        //   for shape 2 (measured: attempts 12/14/20, 3 nodes). The expectation
        //   is now assigned by the drop criterion itself — authored `children`
        //   (non-empty) OR a `{ child }` run — and the warn arms stay live:
        //   shape 1 with `cLen > 0`, and shape 3's `{ child }` run.
        const hasChildRun = Array.isArray(a['bodyRuns']) &&
          (a['bodyRuns'] as BodyRun[]).some((r) => 'child' in r)
        const dropsContent = (a['children'] as string[]).length > 0 || hasChildRun
        if (dropsContent) expectWarnFor.push(nodeId)
        else expectSilenceFor.push(nodeId)
        actionable.push(a as unknown as EmitActionable)
      }
      // ✎ ORACLE-4 anti-inert guard: the WARN half must stay live. After the
      //   correction the warn arm is assigned by the drop criterion, so a
      //   generator draw that produced only silent nodes would hollow the row
      //   out — this counter (asserted after the row's report) forbids that.
      if (expectWarnFor.length > 0) PIM4_WARN_ARM_ATTEMPTS += 1
      const spy = spyWarn()
      try {
        const els = emit(actionable, nb)
        for (const el of els) {
          if (el.type !== 'text') continue
          if (el.childOrder.length !== 0) {
            return {
              problem: `attempt ${i}: text element ${el.wire} has childOrder ${JSON.stringify(el.childOrder)} (the clause never synthesizes structure)`,
              live: true,
            }
          }
          const names = Object.keys(el.props)
          const stray = names.filter((n) => n !== 'text')
          if (stray.length > 0) {
            return {
              problem: `attempt ${i}: text element ${el.wire} carries non-text props ${JSON.stringify(stray)}`,
              live: true,
            }
          }
        }
        const perWire = new Map<string, number>()
        for (const line of linesWith(spy.calls(), ID.textChildren)) {
          for (const w of [...expectWarnFor, ...expectSilenceFor]) {
            if (line.includes(w)) perWire.set(w, (perWire.get(w) ?? 0) + 1)
          }
        }
        for (const w of expectWarnFor) {
          const n = perWire.get(w) ?? 0
          if (n !== 1) {
            return {
              problem: `attempt ${i}: text node "${w}" (authored children and/or a { child } run — content would be DROPPED) fired ${n} text-node-children-ignored warn(s) (expected exactly 1)`,
              live: true,
            }
          }
        }
        // F2's silent half — a childless, { child }-free node drops NOTHING
        for (const w of expectSilenceFor) {
          const n = perWire.get(w) ?? 0
          if (n !== 0) {
            return {
              problem: `attempt ${i}: text node "${w}" is childless and { child }-free (bodyRuns ∈ {absent, [text], [text,text]}) so NOTHING is dropped, yet it fired ${n} text-node-children-ignored warn(s) (C5.3 as AMENDED 2026-09-22 (adversarial F2): expected 0)`,
              live: true,
            }
          }
        }
        return { problem: null, live: true }
      } finally {
        spy.restore()
      }
    })
    reportAndAssert('P-IM-4', strategy, res)
    // ✎ ORACLE-4 anti-inert guard (after the row's report, so it can never mask
    //   the row's own status): the criterion-driven expectation must still have
    //   produced WARN arms, else the row's red warn half would be dead and the
    //   row could pass on the shape half alone.
    expect(
      PIM4_WARN_ARM_ATTEMPTS,
      `ORACLE-4: 0 of ${res.attempts} P-IM-4 attempts carried a warn-arm text node (authored children OR a { child } run) — the row's warn half would be inert`,
    ).toBeGreaterThan(0)
  })

  it('P-IM-4-control (strategy P-IM-4/text-node-gen) — a childless, scalar-only text node is silent (the single-{text} normalization is not a loss); reports HELD (a control: its passing is its contract)', () => {
    const strategy = 'P-IM-4/text-node-gen'
    const maxAttempts = rowAttempts('P-IM-4-control')
    const res = runRegisterRow(strategy, maxAttempts, (i) => {
      const g = new Seeded(attemptSeed(i))
      const actionable: EmitActionable[] = []
      const nb: NodeMap = new Map()
      const k = g.int(1, 3)
      let silentNodes = 0
      for (let e = 0; e < k; e += 1) {
        const nodeId = `txtok-${i}-${e}`
        nb.set(nodeId, { base: { props: {} } })
        const a: Record<string, unknown> = { nodeId, type: 'text', content: 'plain', children: [] }
        if (g.maybe(0.5)) a['bodyRuns'] = [{ text: 'plain' }]
        else if (g.maybe(0.5)) a['bodyRuns'] = [{ text: 'plain' }, { text: ' more' }]
        actionable.push(a as unknown as EmitActionable)
        silentNodes += 1
      }
      const spy = spyWarn()
      try {
        emit(actionable, nb)
        if (spy.calls().length !== 0) {
          return {
            problem: `attempt ${i}: a childless {text}-only text node warned: ${spy.calls()[0]}`,
            live: true,
          }
        }
        return { problem: null, live: silentNodes > 0 }
      } finally {
        spy.restore()
      }
    })
    record({
      row: 'P-IM-4 (control)',
      strategy,
      status: res.failures > 0 ? 'BROKEN' : res.live ? 'HELD' : 'UNDETERMINED',
      attempts: res.attempts,
      failures: res.failures,
      first: res.first,
      counterexample: res.failures > 0 ? minimizeCounterexample(res.first) : null,
      live: res.live,
    })
    expect(res.failures, `P-IM-4 control counterexample: ${res.first ?? 'none'}`).toBe(0)
  })

  // -------------------------------------------------------------------------
  // The register report (§8.3: every row reported with its status, strategy id,
  // attempts, failure count and — for a broken row — the minimized
  // counterexample; P-IM-2 additionally reports `fresh.length` vs
  // `perPass[0]`). Rendered on the console (not `console.warn` — the
  // diagnostic channel must stay clean).
  // -------------------------------------------------------------------------
  it('register report — seed + per-row §8.3 status / strategy / attempts / counterexample (F6 report shape)', () => {
    // eslint-disable-next-line no-console
    console.log(`[property-register] SEED=0x${SEED.toString(16)} (${SEED})`)
    for (const r of REGISTER) {
      const parts = [
        `[property-register] row=${r.row}`,
        `strategy=${r.strategy}`,
        `status=${r.status}`,
        `attempts=${r.attempts}`,
        `failures=${r.failures}`,
        `live=${r.live}`,
      ]
      if (r.row === 'P-IM-2') {
        parts.push(`fresh.length=${String(r.freshCount ?? 0)}`, `perPass[0]=${String(r.pass1Count ?? 0)}`)
      }
      if (r.row === 'P-IM-1') {
        parts.push(`positiveHalfLiveAttempts=${String(r.positiveHalfLive ?? 0)}`)
      }
      parts.push(`counterexample=${r.counterexample ?? 'none'}`)
      // eslint-disable-next-line no-console
      console.log(parts.join(' '))
    }
    const budget = REGISTER.reduce((n, r) => n + r.attempts, 0)
    // eslint-disable-next-line no-console
    console.log(`[property-register] total attempts=${budget} (budget ceilings: ${BUDGET_CEILING.perRow}/row, ${BUDGET_CEILING.total} total)`)
    for (const r of REGISTER) {
      if (r.attempts > BUDGET_CEILING.perRow) {
        throw new Error(`row ${r.row} ran ${r.attempts} attempts (> ${BUDGET_CEILING.perRow})`)
      }
    }
    expect(budget).toBeLessThanOrEqual(400)
  })
})

// keep `encodeRuns` imported for the harness's future use without tripping noUnusedLocals
void encodeRuns
