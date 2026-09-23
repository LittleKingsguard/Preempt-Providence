import { describe, it, expect, afterEach, vi } from 'vitest'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'

// ===========================================================================
// UR-4 / AC-21 CONFIRMATION — "children win" XOR enforcement is a NO-OP for a
// `content`-FREE parent with text children.
//
// DERIVATION SOURCE: docs/specs/bodyruns-drop-diagnostics.md §8.2 (Unit
// UR-4-confirmation) + docs/specs/ur-2026-09-17-review.md §7 AC-21 (`:354`) and
// UR-4's adopted shape (`:182-186`).
//
// (i)   THIS IS THE AC-21 CONFIRMATION TEST. It is GREEN on purpose: it encodes
//       CURRENT INTENDED BEHAVIOUR (a confirmation, not a fix). The 0.4.0
//       bare-text emit already renders the shape correctly and the XOR
//       enforcement is deferred, so there is nothing to repair here.
// (ii)  The XOR render enforcement + the `bodyRuns` removal + the producer
//       migration guide are the 1.0.0 batch (docs/decisions.md:23
//       BARE-TEXT-EMIT 1.0.0 deferral; ur-2026-09-17-review.md:451-469 — Q4
//       option A; AC-24 records the three coupled deliverables).
// (iii) THIS CASE MUST BE RE-EXAMINED AT THE 1.0.0 MAJOR: at that gate the
//       `content`-XOR rule becomes enforced and this no-op question has to be
//       answered for real (the file has a distinct lifecycle from the landed
//       0.4.0 bare-text suite precisely so the marker stays greppable).
//
// DELIBERATELY NOT ASSERTED (§8.2 "Not asserted (deliberate)", AC-25): anything
// about a parent that DOES carry `content` + children — that is the 1.0.0 XOR
// question and asserting it here would encode unpublished semantics.
// ===========================================================================

afterEach(() => {
  vi.restoreAllMocks()
})

type Case = { withContent: boolean }

/** The requester's own shape (§8.2 input shape; bare-text-emit-review.md:93-95):
 *  a root `div` with NO `content` key at all and `[text, strong, text]` children. */
function renderCase(opts: Case): { out: string; warnings: string[]; warnLines: string[] } {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  try {
    const root: Record<string, unknown> = {
      type: 'div',
      children: [
        { type: 'text', content: 'A ' },
        { type: 'strong', content: 'bold', props: { id: 'b1' } },
        { type: 'text', content: ' text' },
      ],
    }
    if (opts.withContent) root['content'] = 'A bold text'
    const doc: LegacyInitialData = {
      template: { root: root as LegacyInitialData['template']['root'] },
      content: [],
      clientConfig: {},
    }
    const t = translateLegacy(doc)
    const states = t.nodes.flatMap((n) => n.compilePath().actionable)
    const els = emitElements(states, new Map(t.nodes.map((n) => [n.id, n])) as never)
    const ssr = new SSRFragmentAdapter()
    for (const e of els) {
      ssr.createEl(e.type, e.wire)
      for (const [k, v] of Object.entries(e.props)) ssr.setProp(e.wire, k, v)
    }
    for (const e of els) for (const c of e.childOrder) ssr.appendChild(e.wire, c)
    const frag = ssr.fragments.get('root')
    return {
      out: frag ? frag.contentText : '',
      warnings: t.warnings.map((w) => w.code),
      warnLines: spy.mock.calls.map((c) => String(c[0])),
    }
  } finally {
    spy.mockRestore()
  }
}

describe('UR-4 / AC-21 — the content-free-parent no-op (1.0.0 XOR revisit)', () => {
  it('UR-4/AC-21 — XOR "children win" is a NO-OP for a content-free parent with text children (1.0.0 no-op question; decisions.md BARE-TEXT-EMIT)', () => {
    const { out, warnings, warnLines } = renderCase({ withContent: false })
    // the exact asserted render (§8.2): bare text children in childOrder
    // position, the authored id preserved, no `<text>` wrapper, no parent wrapper
    expect(out).toBe('A <strong id="b1">bold</strong> text')
    // silence: the K4 translate channel is empty and no console.warn fires —
    // `content-with-children-recommended` is DEFERRED to 1.0.0 (translate.ts:965-970)
    expect(warnings).toEqual([])
    expect(warnLines).toEqual([])
  })

  it('UR-4/AC-21 — the content-free parent emits NO wrapper element and no synthesised text node for its children (the children render bare, in childOrder position)', () => {
    const { out, warnings, warnLines } = renderCase({ withContent: false })
    // bare-text emit shape: no `<text>` wrapper, and every child sits in
    // childOrder position (nothing is re-parented or wrapped by a "children win"
    // rule — there is no content for that rule to act on)
    expect(out).toContain('A ')
    expect(out).not.toContain('<text')
    expect(out).not.toContain('<div>A <strong')
    expect(out.match(/<strong/g)?.length).toBe(1)
    expect(warnings).toEqual([])
    expect(warnLines).toEqual([])
  })
})
