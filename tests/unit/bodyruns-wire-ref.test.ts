import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  encodeRuns,
  decodeRuns,
  isBodyEncoded,
} from '../../src/core/body-runs.js'
import { emitElements } from '../../src/core/render-helpers.js'
import type { BodyRun } from '../../src/core/body-runs.js'

// ===========================================================================
// ENG-BODYRUNS-WIRE-REF — `bodyRuns` `{ child: <authoredId> }` references
// resolve to the child's MINTED WIRE at the EMIT boundary (approved gate shape,
// 2026-08-31 — docs/specs/eng-bodyruns-wire-ref-review.md §3).
//
// The adapters resolve `{ child: <wire> }` ONLY by the minted wire
// (`root/<zone>/<node-X>` / pathKey). A legacy-envelope author knows only the
// child's authored `props.id` (`inline-0`). The fix: at emit time, rewrite each
// `{ child: <authoredId> }` run to the child's ACTUAL wire, scoped to the node's
// OWN children (never a foreign element), base.bodyRuns stays authored
// (round-trip idempotent). TestWriter red set — written BEFORE implementation.
// ===========================================================================

// EmitElements is the seam that has nodeById (child props.id) + pathCtx. Feed it
// a compiled-state-shaped actionable + a real node map carrying authored props.id.
const NODE_PROPS: Map<string, { base: { props: Record<string, unknown> } }> = new Map()
function makeNode(id: string, props: Record<string, unknown>) {
  NODE_PROPS.set(id, { base: { props } })
  return id
}

// N4 (2026-09-22 — closed by the gate-8 doc review of the W4 landing): the case
// below is named "warn-and-drop", so it must assert BOTH halves. The W4 diagnostic
// layer (docs/specs/bodyruns-drop-diagnostics.md §9) now makes the drop class it
// carries emit a real `bodyruns-child-unresolved` warn on `console.warn`, so the
// name is no longer a promise the file does not test.
afterEach(() => {
  vi.restoreAllMocks()
})

function emit(children: string[], bodyRuns: BodyRun[]): { childOrder: string[]; text: string } {
  const els = emitElements(
    [
      {
        nodeId: 'parent',
        type: 'p',
        bodyRuns,
        children,
      },
    ],
    NODE_PROPS as Map<string, never>,
  )
  const el = els[0]!
  const text = el.props['text'] as string
  return { childOrder: el.childOrder, text }
}

describe('ENG-BODYRUNS-WIRE-REF emit-boundary authoredId→wire (gate §3)', () => {
  it('resolves a child run by authored props.id to the child wire', () => {
    const inlineId = makeNode('node-3', { id: 'inline-0' })
    const { childOrder, text } = emit([inlineId], [{ child: 'inline-0' }, { text: ' text' }])
    expect(decodeRuns(text)).toEqual([{ child: 'node-3' }, { text: ' text' }])
    expect(childOrder).toEqual(['node-3'])
  })

  it('child-first interleaving resolves in order', () => {
    const inlineId = makeNode('node-5', { id: 'bold' })
    const { text } = emit([inlineId], [{ child: 'bold' }, { text: ' Astrographer' }])
    expect(decodeRuns(text)).toEqual([{ child: 'node-5' }, { text: ' Astrographer' }])
  })

  it('a real WIRE reference passes through unchanged (no authored id rewrite)', () => {
    const inlineId = makeNode('node-7', { id: 'foo' })
    const { childOrder, text } = emit([inlineId], [{ child: 'node-7' }, { text: ' x' }])
    expect(decodeRuns(text)).toEqual([{ child: 'node-7' }, { text: ' x' }])
    expect(childOrder).toEqual(['node-7'])
  })

  it('warn-and-drop: an authored id absent from the node own children is DROPPED **and** warns (§3 C3/C4)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    makeNode('node-9', { id: 'present-inline' })
    const { text } = emit(['node-9'], [{ child: 'missing-inline' }, { text: ' only' }])
    // the DROP half (authored-id ref absent from the element's own childOrder)
    expect(decodeRuns(text)).toEqual([{ text: ' only' }])
    // the WARN half (N4 — the name promises it; the C3 catalogue mandates it).
    // NOTE: a `console.warn` spy is a call-boundary spy, so C4's module-level
    // signature dedup cannot suppress this assertion for a NEW signature — this
    // pair's (code, wire, id) is unique inside the file (spec §8.4 invariant H2).
    const lines = warn.mock.calls.map((c) => String(c[0]))
    expect(lines.filter((l) => l.includes('bodyruns-child-unresolved'))).toHaveLength(1)
    expect(lines.filter((l) => l.includes('missing-inline'))).toHaveLength(1)
  })

  it('base/bodyRuns is NOT mutated (the emitted string is the only rewrite)', () => {
    const inlineId = makeNode('node-11', { id: 'k' })
    const runs: BodyRun[] = [{ child: 'k' }, { text: ' t' }]
    emit([inlineId], runs)
    // the authored run list is untouched
    expect(runs).toEqual([{ child: 'k' }, { text: ' t' }])
  })
})
