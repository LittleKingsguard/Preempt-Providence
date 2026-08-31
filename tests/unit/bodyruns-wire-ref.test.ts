import { describe, it, expect } from 'vitest'
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

  it('warn-and-drop: an authored id absent from the node own children is dropped (§3)', () => {
    makeNode('node-9', { id: 'present-inline' })
    const { text } = emit(['node-9'], [{ child: 'missing-inline' }, { text: ' only' }])
    expect(decodeRuns(text)).toEqual([{ text: ' only' }])
  })

  it('base/bodyRuns is NOT mutated (the emitted string is the only rewrite)', () => {
    const inlineId = makeNode('node-11', { id: 'k' })
    const runs: BodyRun[] = [{ child: 'k' }, { text: ' t' }]
    emit([inlineId], runs)
    // the authored run list is untouched
    expect(runs).toEqual([{ child: 'k' }, { text: ' t' }])
  })
})
