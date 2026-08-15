/**
 * Run A (RED) — legacy-shape translate contract, D1–D8 pins
 * (live-prod/placeholderLanding/FINDINGS.md dispositions 2026-08-14,
 * SPEC-ENCODED in docs/specs/translate.md; fix pass PENDING).
 *
 * States / fail-states enumerated (comment block per docs/subagents.md Run A):
 *
 * D1 — placement ARRAY-canonical (translate.md §1/§2, TR-H11):
 *   [1] array with a single entry → that entry maps through the single-entry
 *       logic (container/content anchors minted), no warn
 *   [2] array with MULTIPLE entries (producer + consumer, or N consumers) →
 *       every entry maps independently in array order
 *   [3] placement: [] → valid empty list, zero anchors, NO warn
 *   [4] non-object entries ([null], ["x"], [42]) → placement-entry-invalid,
 *       skip that entry only
 *   [5] non-array non-object placement (string/number) → placement-entry-invalid,
 *       zero anchors
 *   [6] single-OBJECT convenience form still maps exactly once (unchanged)
 *   [7] reverse F2 — node with 2+ container anchors emits the placement ARRAY
 *       (one entry per container in mint order, content names in the first);
 *       re-translate anchor-identical
 *
 * D2 — doc.content array-only (translate.md §2/§3, TR-F2):
 *   [8]  array accepted (no warn — already green)
 *   [9]  obsolete single-payload OBJECT {content, metadata} → payload-shape-obsolete
 *        warn at path 'content', payload skipped (no roots, no metadata/userData)
 *   [10] string/null/number/boolean content → same warn + skip (never silent)
 *   [11] absent content stays legal, no warn
 *
 * D3 — css.style object serialization (translate.md §2, F8):
 *   [12] object → kebab-case 'k: v;' CSS STRING on the translated node
 *   [13] vendor prefixes (WebkitTransform → -webkit-transform, msTransition →
 *        -ms-transition)
 *   [14] first-':' split (values may contain ':' — content: "a:b")
 *   [15] url(...) data URIs — ';' inside url(...) does not split entries
 *   [16] numeric values stringified (opacity: 1)
 *   [17] empty object {} → '' (no style attr)
 *   [18] reverse F7 — a serialized style STRING ALWAYS parses back to the
 *        Record<string,string> object (no provenance tracking)
 *   [19] round-trip translate(object) → reverse(object)
 *
 * D5 — content TEXT-ONLY (translate.md §2, F13/F14):
 *   [20] non-array children (single NodeData OBJECT) → children-shape-invalid
 *        warn + field skipped
 *   [21] non-array children (string) → same warn + skip (never dual-parsed,
 *        never wrapped)
 *   [22] children-shape-invalid carries the tree path
 *   [23] array children fine, no warn (already green)
 *   [24] content text stays text (no dual-parse; a NodeData object in content
 *        is never parsed into children — green guard)
 *
 * D7 — seam planning at translate (translate.md §2.1, F17):
 *   [25] target 'type'/'content'/'children' plan WITHOUT component-target-gap;
 *        options.seam persists on the anchor (consumer form)
 *   [26] provider form {reference, value, target} persists options.seam too
 *   [27] array VALUES for the seam targets carry no explicit warn (vacuous
 *        at the seam)
 *
 * D8 — def children pre-minted prototypes (translate.md §2, F16):
 *   [28] a value-carrying def binding's value.children are minted at translate
 *        as out-of-tree 'component'-token prototype nodes (state 'prototype'),
 *        never attached to the host, never in t.content
 *
 * RED set today: 1,2,4,5,7,9,10,12,13,14,15,16,17,18,20,21,22,25,26,27,28.
 * Green-by-accident pins (flag): 3 (array no-op is silent), 6, 8, 11, 19
 * (object round-trips raw — wrong reason), 23, 24.
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy, reverseTranslate, type LegacyInitialData } from '../../src/core/translate.js'
import { Node, type Node as NodeType } from '../../src/core/node.js'
import { hub } from '../helpers/fixtures.js'

function placementAnchors(node: NodeType): Array<{ role: string; target: unknown }> {
  return node.anchors
    .filter((a) => a.role === 'container' || a.role === 'content')
    .map((a) => ({ role: a.role, target: a.target }))
}

describe('D1 — placement ARRAY is canonical (per-entry minting)', () => {
  it('[1] a single-entry placement array maps through the single-entry logic (container + content)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          placement: [{ placementName: 'zone-a', targetPlacement: ['x', 'y'] }] as never,
        },
      },
      content: [],
    })
    expect(placementAnchors(t.root)).toEqual([
      { role: 'container', target: 'zone-a' },
      { role: 'content', target: 'x' },
      { role: 'content', target: 'y' },
    ])
    expect(t.warnings).toEqual([])
  })

  it('[2] multi-entry array (producer + consumer on ONE node) maps EVERY entry in array order', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          placement: [
            { placementName: 'prod-zone' },
            { targetPlacement: ['zone-a', 'zone-b'] },
            { targetPlacement: ['zone-c'] },
          ] as never,
        },
      },
      content: [],
    })
    expect(placementAnchors(t.root)).toEqual([
      { role: 'container', target: 'prod-zone' },
      { role: 'content', target: 'zone-a' },
      { role: 'content', target: 'zone-b' },
      { role: 'content', target: 'zone-c' },
    ])
    expect(t.warnings).toEqual([])
  })

  it('[3] placement: [] is a VALID empty multi-entry list — zero anchors, NO warn', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', placement: [] as never } },
      content: [],
    })
    expect(placementAnchors(t.root)).toEqual([])
    expect(t.warnings).toEqual([])
  })

  it('[4] a NON-OBJECT array entry warns placement-entry-invalid and skips THAT entry only', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          placement: [{ placementName: 'ok-zone' }, null, 'x', 42] as never,
        },
      },
      content: [],
    })
    expect(placementAnchors(t.root)).toEqual([{ role: 'container', target: 'ok-zone' }])
    expect(t.warnings).toEqual([{ code: 'placement-entry-invalid', path: 'root' }])
  })

  it('[5] a non-array non-object placement value (string/number) warns placement-entry-invalid, zero anchors', () => {
    for (const bad of ['zone-a', 42]) {
      const t = translateLegacy({
        template: { root: { type: 'app', placement: bad as never } },
        content: [],
      })
      expect(placementAnchors(t.root)).toEqual([])
      expect(t.warnings).toEqual([{ code: 'placement-entry-invalid', path: 'root' }])
    }
  })

  it('[6] the single-OBJECT convenience form still maps exactly once (back-compat)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', placement: { placementName: 'zone-a', targetPlacement: ['x'] } } },
      content: [],
    })
    expect(placementAnchors(t.root)).toEqual([
      { role: 'container', target: 'zone-a' },
      { role: 'content', target: 'x' },
    ])
    expect(t.warnings).toEqual([])
  })

  it('[7] D1/F2 reverse — 2+ container anchors emit the canonical placement ARRAY, content names in the first entry', () => {
    const h = hub()
    const t = translateLegacy({
      template: { root: { type: 'app', placement: { placementName: 'zone-a', targetPlacement: ['x', 'y'] } } },
      content: [],
    })
    // a multi-producer node is only expressible via the array — synthesize
    // the second container anchor the array mapping would have minted
    t.root.addAnchor('container', 'zone-b', {}, h.linkFor('zone-b', 'placement'))
    const out = reverseTranslate(t.root, { content: [] })
    expect(out.template?.root.placement).toEqual([
      { placementName: 'zone-a', targetPlacement: ['x', 'y'] },
      { placementName: 'zone-b' },
    ])
    // re-translate of the array emission is anchor-identical
    const again = translateLegacy(out)
    expect(placementAnchors(again.root)).toEqual([
      { role: 'container', target: 'zone-a' },
      { role: 'content', target: 'x' },
      { role: 'content', target: 'y' },
      { role: 'container', target: 'zone-b' },
    ])
    expect(again.warnings).toEqual([])
  })

  it('[7b] D1 round-trip — array-placed doc reverses flat (single producer) and re-translates anchor-identical', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', placement: [{ placementName: 'prod', targetPlacement: ['x'] }] as never },
      },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: [] })
    expect(out.template?.root.placement).toEqual({ placementName: 'prod', targetPlacement: ['x'] })
    const again = translateLegacy(out)
    expect(placementAnchors(again.root)).toEqual([
      { role: 'container', target: 'prod' },
      { role: 'content', target: 'x' },
    ])
    expect(again.warnings).toEqual([])
  })
})

describe('D2 — doc.content is ARRAY-ONLY (payload-shape-obsolete, never silent)', () => {
  it('[8] the array form is accepted with no warn (already green)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app' } },
      content: [{ metadata: { m: 1 }, content: [{ type: 'card' }] }],
    })
    expect(t.warnings).toEqual([])
    expect(t.content.map((c: NodeType) => c.type)).toEqual(['card'])
    expect(t.metadata).toEqual({ m: 1 })
  })

  it('[9] the obsolete single-payload OBJECT warns payload-shape-obsolete and is SKIPPED (no roots, no metadata)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app' } },
      content: { metadata: { m: 1 }, content: [{ type: 'card' }] } as never,
    })
    expect(t.warnings).toEqual([{ code: 'payload-shape-obsolete', path: 'content' }])
    expect(t.content).toEqual([])
    expect(t.metadata).toBeUndefined()
    expect(t.userData).toBeUndefined()
    // the rest of the document translates normally (TR-F2)
    expect(t.root.type).toBe('app')
  })

  it('[10] ANY other non-array content value (string/null/number/boolean) warns payload-shape-obsolete + skips', () => {
    for (const bad of ['nope', null, 42, false]) {
      const t = translateLegacy({
        template: { root: { type: 'app' } },
        content: bad as never,
      })
      expect(t.warnings).toEqual([{ code: 'payload-shape-obsolete', path: 'content' }])
      expect(t.content).toEqual([])
    }
  })

  it('[11] doc.content absent/undefined stays legal (no payloads, no warn)', () => {
    const t = translateLegacy({ template: { root: { type: 'app' } } })
    expect(t.warnings).toEqual([])
    expect(t.content).toEqual([])
  })
})

describe('D3 — css.style OBJECT serializes to a kebab-case CSS string (F8)', () => {
  it('[12] object style → kebab-case "k: v;" STRING on the translated node (never the raw object)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', css: { style: { backgroundColor: 'red' } as never } } },
      content: [],
    })
    expect(t.root.css?.style).toBe('background-color: red;')
  })

  it('[13] VENDOR-prefixed keys kebab: WebkitTransform → -webkit-transform, msTransition → -ms-transition', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', css: { style: { WebkitTransform: 'rotate(2deg)', msTransition: 'all .2s' } as never } },
      },
      content: [],
    })
    const style = t.root.css?.style
    expect(style).toContain('-webkit-transform: rotate(2deg)')
    expect(style).toContain('-ms-transition: all .2s')
  })

  it('[14] entries split on the FIRST ":" — a value containing ":" survives (content: "a:b")', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', css: { style: { content: '"a:b"' } as never } } },
      content: [],
    })
    expect(t.root.css?.style).toBe('content: "a:b";')
  })

  it('[15] ";" inside url(...) does NOT split entries (data-URI background)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          css: { style: { background: 'url(data:image/png;base64,AAA;BB)' } as never },
        },
      },
      content: [],
    })
    expect(t.root.css?.style).toBe('background: url(data:image/png;base64,AAA;BB);')
  })

  it('[16] numeric values are stringified (opacity: 1)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', css: { style: { opacity: 1 } as never } } },
      content: [],
    })
    expect(t.root.css?.style).toBe('opacity: 1;')
  })

  it('[17] the empty object serializes to "" (no style attr at the adapter)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', css: { style: {} as never } } },
      content: [],
    })
    expect(t.root.css?.style).toBe('')
  })

  it('[18] D3/F7 reverse — a serialized style STRING ALWAYS parses back to the Record<string,string> OBJECT', () => {
    const n = new Node({ type: 'div', css: { style: 'color: red; background: #000' } }, hub(), 'n1')
    const out = reverseTranslate(n, { content: [] })
    expect(out.template?.root.css?.style).toEqual({ color: 'red', background: '#000' })
  })

  it('[19] round-trip: translate(object) → reverse(object) — the string form is never re-emitted', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', css: { style: { color: '#fff', background: '#000' } as never } },
      },
      content: [],
    })
    const out = reverseTranslate(t.root, { content: [] })
    expect(out.template?.root.css?.style).toEqual({ color: '#fff', background: '#000' })
  })
})

describe('D5 — content is TEXT-ONLY; children must be an array (F14)', () => {
  it('[20] a single NodeData OBJECT in children warns children-shape-invalid and the field is SKIPPED', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', children: { type: 'x' } as never } },
      content: [],
    })
    expect(t.warnings).toEqual([{ code: 'children-shape-invalid', path: 'root' }])
    expect(t.root.children).toEqual([])
  })

  it('[21] a STRING children value warns children-shape-invalid — never dual-parsed into content, never wrapped', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', children: 'oops' as never } },
      content: [],
    })
    expect(t.warnings).toEqual([{ code: 'children-shape-invalid', path: 'root' }])
    expect(t.root.children).toEqual([])
    expect(t.root.content).toBeUndefined()
  })

  it('[22] children-shape-invalid carries the tree path', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', children: [{ type: 'a', children: 'bad' as never }] },
      },
      content: [],
    })
    expect(t.warnings).toEqual([{ code: 'children-shape-invalid', path: 'root.children[0]' }])
  })

  it('[23] array children translate normally with no warn (already green)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', children: [{ type: 'a' }, { type: 'b' }] } },
      content: [],
    })
    expect(t.root.children.map((c: NodeType) => c.type)).toEqual(['a', 'b'])
    expect(t.warnings).toEqual([])
  })

  it('[24] content stays TEXT — a NodeData object in content is never dual-parsed into children (guard)', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', content: { type: 'ghost' } as never } },
      content: [],
    })
    expect(t.root.children).toEqual([])
    expect(t.root.content).toEqual({ type: 'ghost' })
    expect(t.warnings).toEqual([])
  })
})

describe('D7 — seam targets plan at translate WITHOUT component-target-gap (F17)', () => {
  it('[25] consumer form {reference, target: "type"|"content"|"children"} plans the seam: NO gap warn + options.seam', () => {
    for (const target of ['type', 'content', 'children']) {
      const t = translateLegacy({
        template: { root: { type: 'app', component: { reference: 'd', target } } },
        content: [],
      })
      expect(t.warnings).toEqual([])
      const anchor = t.root.anchors.find((a) => a.role === 'target' && a.target === 'd')
      expect(anchor).toBeDefined()
      expect((anchor!.options as { seam?: string }).seam).toBe(target)
    }
  })

  it('[26] provider form {reference, value, target} persists options.seam on the source anchor too', () => {
    for (const target of ['type', 'content', 'children']) {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: { reference: 'd', value: { type: 'div', content: 'def text', children: [{ type: 'span' }] }, target },
          },
        },
        content: [],
      })
      expect(t.warnings).toEqual([])
      const anchor = t.root.anchors.find((a) => a.role === 'source' && a.target === 'd')
      expect(anchor).toBeDefined()
      expect((anchor!.options as { seam?: string }).seam).toBe(target)
    }
  })

  it('[27] ARRAY VALUES for the seam targets are vacuous at the seam — no explicit warn, nothing materializes', () => {
    const t = translateLegacy({
      template: {
        root: { type: 'app', component: { reference: 'd', value: [{ type: 'x' }], target: 'children' } },
      },
      content: [],
    })
    expect(t.warnings).toEqual([])
  })
})

describe('D8 — def children are PRE-MINTED as out-of-tree "component"-token prototypes (F16)', () => {
  it('[28] a value-carrying def binding\'s value.children mint as prototype nodes at translate (never attached to the host)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: {
            reference: 'defA',
            value: { type: 'div', children: [{ type: 'span', content: 's1' }, { type: 'b', content: 's2' }] },
          },
        },
      },
      content: [],
    })
    // the def children exist as out-of-tree prototypes under the 'component'
    // permanent-owner token → derived state 'prototype'
    const prototypes = t.nodes.filter(
      (n: NodeType) =>
        n.state === 'prototype' && n.childAnchor()?.link.anchorsOf('parent')[0]?.target === 'component',
    )
    expect(prototypes.map((n: NodeType) => n.type)).toEqual(['span', 'b'])
    // never attached to the HOST node by translate, never content, never in-tree
    expect(t.root.children).toEqual([])
    expect(t.content).toEqual([])
  })
})
