import { describe, it, expect } from 'vitest'
import { translateLegacy, type LegacyInitialData } from '../../src/core/translate.js'

// ===========================================================================
// BARE-TEXT-EMIT (0.4.0 gate) — the deprecation / back-compat warns +
// the `text` content-only rule. docs/specs/bare-text-emit-review.md §6.
// (CORRECTED 2026-09-22 — N5: this file covers TWO warns, not three; the third
// name in the original header is DEFERRED to 1.0.0. See the CORRECTION note at
// the end of this header block.)
//
//  - `text-content-only`: a `text` child carries ONLY content; props/css/
//    handlers/placement are ignored with this warn.
//  - `bodyruns-deprecated`: using `bodyRuns` warns (deprecated-but-present,
//    behavior unchanged; removed at the next major).
//  - `content-with-children-recommended`: a node with both `content` and
//    `children` warns (recommendation to use text-children / <span>, NO render
//    change, round-trip preserved). All warn-never-throw.
//
//  CORRECTION (2026-09-22 — N5, docs/specs/ur-2026-09-17-review.md:234; HEADER
//  COMMENT ONLY, no executable change): `content-with-children-recommended` is
//  DEFERRED to the 1.0.0 major — it is NOT one of the warns this file covers and
//  the string exists nowhere in `src/` (src/core/translate.ts:965-970 is a
//  comment-only deferral; the warn ships with the XOR render enforcement). It was
//  listed above as if built. This file therefore asserts TWO of the three names
//  (text-content-only, bodyruns-deprecated), both translate-time. Also note
//  (N6): `text-content-only` fires at TRANSLATE and covers the legacy-JSON path
//  only — the emit-time content-only rule is a SILENT filter
//  (docs/specs/render.md §3.2b BT-EMIT-5).
// TestWriter red set — written BEFORE implementation.
// ===========================================================================

function translateWith(doc: LegacyInitialData): string[] {
  const t = translateLegacy(doc)
  return t.warnings.map((w) => w.code)
}

describe('BARE-TEXT-EMIT — deprecation / back-compat warns (warn-never-throw, no render change)', () => {
  it('a text node with props emits a text-content-only warn (still renders, no throw)', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          children: [
            { type: 'text', content: 'hi', props: { id: 'x', 'data-foo': '1' } },
          ],
        },
      },
      content: [],
      clientConfig: {},
    }
    const codes = translateWith(doc)
    expect(codes).toContain('text-content-only')
  })

  it('a text node with handlers emits a text-content-only warn', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          children: [
            { type: 'text', content: 'hi', handlers: [{ name: 'h', event: 'click' }] },
          ],
        },
      },
      content: [],
      clientConfig: {},
    }
    const codes = translateWith(doc)
    expect(codes).toContain('text-content-only')
  })

  it('a text node with placement emits a text-content-only warn', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          placement: [{ placementName: 'zone' }],
          children: [{ type: 'text', content: 'hi', placement: [{ targetPlacement: ['zone'] }] }],
        },
      },
      content: [],
      clientConfig: {},
    }
    const codes = translateWith(doc)
    expect(codes).toContain('text-content-only')
  })

  it('a pure text node (content only) does NOT warn', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          children: [{ type: 'text', content: 'hi' }],
        },
      },
      content: [],
      clientConfig: {},
    }
    const codes = translateWith(doc)
    expect(codes).not.toContain('text-content-only')
  })

  it('a node using bodyRuns emits a bodyruns-deprecated warn (render unchanged)', () => {
    const doc: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          bodyRuns: [{ text: 'A ' }, { child: 'x' }, { text: ' B' }],
          children: [{ type: 'strong', content: 'b', props: { id: 'x' } }],
        },
      },
      content: [],
      clientConfig: {},
    }
    const codes = translateWith(doc)
    expect(codes).toContain('bodyruns-deprecated')
  })
})
