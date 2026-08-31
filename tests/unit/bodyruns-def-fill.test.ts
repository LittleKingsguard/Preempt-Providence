import { describe, it, expect } from 'vitest'
import {
  decodeRuns,
  isBodyEncoded,
} from '../../src/core/body-runs.js'
import {
  translateLegacy,
  type LegacyInitialData,
} from '../../src/core/translate.js'
import { emitElements, applyOps } from '../../src/core/render-helpers.js'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import type { BodyRun } from '../../src/core/body-runs.js'

// ===========================================================================
// ENG-BODYRUNS-WIRE-REF-PATHSTATE — def-fill / component-prototype `bodyRuns`
// interleaving (2026-08-31 gate PROCEED-AS-RESHAPED, docs/specs/
// eng-bodyruns-wire-ref-pathstate-review.md §3).
//
// The approved reshaped contract:
//   (1) all six def-fill text sites consult `bodyRuns` via the shared
//       `emitTextProp` (with the prototype's base.bodyRuns), not bare
//       `bakeValue(def.content)` — so a def-consumer / def-child carrying
//       `bodyRuns` interleaves instead of flattening to scalar content;
//   (2) a SINGLE GLOBAL authoredId -> wire index built ONCE per emitElements
//       (O(n)) resolves `{ child: <authoredId> }` for def-fill elements,
//       incl. def-fill SYNTHETIC wires (proto.base.props.id -> synthetic wire);
//   (3) own-childOrder containment kept — a run may reference only a child of
//       the element carrying the runs; placement-sibling refs stay dropped.
// TestWriter red set — written BEFORE implementation. The failing shapes here
// are the def-fill / component-prototype paths that today discard bodyRuns.
// ===========================================================================

function nodesOf(t: { nodes: Array<{ id: string; type: string; compilePath: () => { actionable: unknown[] } }> }) {
  return t.nodes
}

/** Translate a def-fill envelope + emitElements (the real seam the host uses). */
function renderDefConsumer(bodyRuns: BodyRun[] | undefined): { els: Array<{ wire: string; type: string; childOrder: string[]; text: string | unknown }>; nodes: unknown[] } {
  const doc: LegacyInitialData = {
    template: {
      root: {
        type: 'div',
        component: [{ reference: 'card', target: 'children', value: {
          type: 'div',
          children: [
            { type: 'p', content: 'Some text', bodyRuns, children: [{ type: 'strong', content: 'Proposal:', props: { id: 'bold' } }] },
          ],
        } }],
      },
    },
    content: [],
    clientConfig: {},
  }
  const t = translateLegacy(doc)
  const states = t.nodes.flatMap((n) => n.compilePath().actionable)
  const els = emitElements(states, new Map(t.nodes.map((n) => [n.id, n])))
  return { els: els.map((e) => ({ wire: e.wire, type: e.type, childOrder: e.childOrder, text: e.props['text'] })), nodes: t.nodes }
}

describe('ENG-BODYRUNS-WIRE-REF-PATHSTATE — def-fill/component-prototype emit (gate §3.1)', () => {
  it('a def-child carrying bodyRuns interleaves (not flattened to scalar content)', () => {
    const { els } = renderDefConsumer([{ text: 'Some ' }, { child: 'bold' }, { text: ' text' }])
    // the p def-child emits at a synthetic wire (root:<n>:<i>); its text must be run-encoded + resolve the bold child
    const pEl = els.find((e) => e.type === 'p')
    expect(pEl).toBeDefined()
    const txt = pEl!.text
    expect(typeof txt === 'string' && isBodyEncoded(txt)).toBe(true)
    const runs = decodeRuns(txt as string)
    expect(runs).toHaveLength(3)
    expect(runs[0]).toEqual({ text: 'Some ' })
    expect(runs[1]).toHaveProperty('child')
    // the child run resolves to the def-child's SYNTHETIC wire (not the authored id 'bold')
    const childRun = runs[1] as { child: string }
    expect(childRun.child).not.toBe('bold')
    expect(childRun.child).toContain(pEl!.wire)
    expect(runs[2]).toEqual({ text: ' text' })
  })

  it('SSR renders the def-child interleaving in order (Some <strong>... text)', () => {
    const { els } = renderDefConsumer([{ text: 'Some ' }, { child: 'bold' }, { text: ' text' }])
    const ssr = new SSRFragmentAdapter()
    const pEl = els.find((e) => e.type === 'p')!
    const strongEl = els.find((e) => e.type === 'strong')!
    // root, then p, then the strong def-child — at their real (synthetic) wires
    ssr.createEl('div', 'root')
    ssr.createEl('p', pEl.wire)
    ssr.createEl('strong', strongEl.wire)
    ssr.setProp(pEl.wire, 'text', pEl.text as string)
    ssr.setProp(strongEl.wire, 'text', 'Proposal:')
    ssr.appendChild(pEl.wire, strongEl.wire)
    expect(ssr.fragments.get(pEl.wire)!.contentText).toBe('Some <strong>Proposal:</strong> text')
  })

  it('no bodyRuns -> byte-identical scalar (no encode)', () => {
    const { els } = renderDefConsumer(undefined)
    const pEl = els.find((e) => e.type === 'p')!
    expect(pEl.text).toBe('Some text')
  })
})