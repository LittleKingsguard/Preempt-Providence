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
import { describe, it, expect, vi } from 'vitest'
import { translateLegacy, reverseTranslate, type LegacyInitialData } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { dispatchEvent } from '../../src/core/handlers.js'
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

  it('[26] provider form {reference, value, target} persists options.seam on the DUPLEX anchor (S19 ruling 2026-08-15: value+target ⇒ duplex, not source)', () => {
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
      const anchor = t.root.anchors.find((a) => a.role === 'duplex' && a.target === 'd')
      expect(anchor).toBeDefined()
      expect((anchor!.options as { seam?: string }).seam).toBe(target)
      expect(anchor!.value).toBeDefined()
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

describe('D7/DEFECT-5/6 — self-provider duplex seams + reverse seam persistence (user directives 2026-08-15)', () => {
  // DEFECT #5 (S19): a legacy binding with BOTH value and target is a DUPLEX
  // (provider + consumer on one anchor), not a source — the seam flag
  // persists on the duplex anchor and the seam DETECTION must read it
  // (materializeSeam/findDefBinding/isSeamDefBinding keyed on target only).
  // DEFECT #6 (S26): nodeToLegacy must reverse seam anchors with their
  // target (`target: <seam>` — apply path OR seam target, never a second
  // name) so a re-translate reproduces the SAME seam plan.
  it('[28] a value+target binding plans a DUPLEX anchor carrying options.seam (not a source)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [
            { reference: 'self', value: { type: 'section', content: 'def text', css: { classes: ['self-panel'] } }, target: 'children' },
          ],
          children: [
            { type: 'div', content: 'wrapper text', component: [{ reference: 'self', target: 'children' }] },
          ],
        },
      },
      content: [],
    } as never)
    const root = t.root
    const selfAnchor = root.anchors.find((a) => a.target === 'self')!
    // value+target ⇒ duplex, NOT source — with the seam persisted
    expect(selfAnchor.role).toBe('duplex')
    expect(selfAnchor.options.seam).toBe('children')
    expect(selfAnchor.value).toBeDefined()
  })

  it('[29] a SELF-PROVIDER children-seam materializes: the host keeps its own text + authored children and gains the def-root (SED-2)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [
            { reference: 'menu', value: { type: 'nav', css: { classes: ['menu-def'] }, children: [{ type: 'span', content: 'logo' }] }, target: 'children' },
          ],
          children: [
            { type: 'div', content: 'wrapper text', component: [{ reference: 'menu', target: 'children' }], children: [{ type: 'p', content: 'authored' }] },
          ],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const cr = t.root.compile(t.nodes)
    const byNode = new Map(sup.allNodes().map((n) => [n.id, n])) as never
    const els = emitElements(cr.actionable, byNode)
    const wrapper = els.find((e) => e.type === 'div' && e.props['text'] !== undefined)!
    // B1: shell keeps its own text + authored child; the def-root joins
    expect(wrapper.props['text']).toBe('wrapper text')
    expect(wrapper.childOrder.length).toBe(2)
    const nav = els.find((e) => e.wire === wrapper.childOrder[1])!
    expect(nav.type).toBe('nav')
    expect(nav.props['css:classes']).toEqual(['menu-def'])
  })

  it('[30] reverseTranslate emits `target: <seam>` for seam anchors; re-translate reproduces the seam plan (TR-H16/R-H8)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [
            { reference: 'menu', value: { type: 'nav', css: { classes: ['menu-def'] }, children: [{ type: 'span', content: 'logo' }] } },
          ],
          children: [
            { type: 'div', content: 'wrapper text', component: [{ reference: 'menu', target: 'children' }] },
          ],
        },
      },
      content: [],
    } as never)
    const outRoot = reverseTranslate(t.root).template.root
    const outChild = outRoot.children![0]!
    const binding = (Array.isArray(outChild.component) ? outChild.component[0] : outChild.component) as { reference?: string; target?: string }
    expect(binding.reference).toBe('menu')
    expect(binding.target).toBe('children')
    // re-translate reproduces the seam plan (options.seam on the consumer anchor)
    const t2 = translateLegacy({ template: { root: outRoot } } as never)
    const consumer = t2.root.children[0]!
    const seamAnchor = consumer.anchors.find((a) => a.target === 'menu')!
    expect(seamAnchor.options.seam).toBe('children')
  })
})

describe('DEFECT-7/8 — translate fail-safe (stress loop round 3 findings, 2026-08-15)', () => {
  // DEFECT #7: children:[null] crashed translate (uncaught TypeError on null
  // data.component, translate.ts:692 — whole-doc abort). Pinned contract:
  // a non-object ENTRY inside a valid children array warns
  // `children-entry-invalid` + skips THAT entry only; the rest translates.
  it('[31] a null / primitive children ENTRY warns children-entry-invalid and is skipped — no crash, rest renders', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [null, { type: 'div', content: 'ok' }, 42, 'x' as never],
        },
      },
      content: [],
    } as never)
    expect(t.warnings.filter((w) => w.code === 'children-entry-invalid').length).toBe(3)
    expect(t.root.children.map((c) => c.type)).toEqual(['div'])
    expect(t.root.children[0]!.content).toBe('ok')
  })

  // DEFECT #8: a TRUTHY NON-OBJECT template.root (42 / array) silently minted
  // a default div with ZERO warns. Pinned contract: non-object roots are
  // malformed envelopes → legacy-envelope-mismatch (same as falsy roots).
  it('[32] a truthy non-object template.root throws legacy-envelope-mismatch (42 and array)', () => {
    for (const root of [42, ['div']]) {
      expect(() =>
        translateLegacy({ template: { root: root as never } } as never),
      ).toThrow('legacy-envelope-mismatch')
    }
    // the object root still translates
    const t = translateLegacy({ template: { root: { type: 'app' } }, content: [] })
    expect(t.root.type).toBe('app')
  })
})

describe('HANDLER-SEAM — handlers.<event> targets wire legacy handler defs (D6 un-park; review A′ §2, 2026-08-15)', () => {
  // Decision-7 slice: handler-def-shaped bindings register by name; the
  // consumer's handlers.<event> target plans without the gap warn; compile
  // materializes a provenance-marked handlers layer (idempotent, traceable);
  // reverse keeps the defs in template.component and emits the target.
  it('[H1] a handler-def-shaped value ({name, body}) registers as a handler def — NO K3 warn; the def stays a value-carrying source', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'showComments', value: { name: 'showComments', body: '(e, c) => { return c.clientAPI.apply(c.node.id, []) }' } }],
        },
      },
      content: [],
    } as never)
    expect(t.warnings).toEqual([])
    const anchor = t.root.anchors.find((a) => a.target === 'showComments')!
    expect(anchor.role).toBe('source')
    expect((anchor.value as { name?: string }).name).toBe('showComments')
  })

  it('[H2] a genuinely vacuous binding still fires K3 component-binding-empty', () => {
    const t = translateLegacy({
      template: { root: { type: 'app', component: [{ reference: '', value: { name: 'x', body: 'y' } }] } },
      content: [],
    } as never)
    expect(t.warnings.map((w) => w.code)).toContain('component-binding-empty')
  })

  it('[H3] a handlers.click target plans WITHOUT the gap warn and persists the event verbatim', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'showComments', value: { name: 'showComments', body: '() => {}' } }],
          children: [{ type: 'button', component: [{ reference: 'showComments', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    expect(t.warnings.filter((w) => w.code === 'component-target-gap')).toEqual([])
    const btn = t.root.children[0]!
    const anchor = btn.anchors.find((a) => a.target === 'showComments')!
    expect(anchor.options.handlerEvent).toBe('click')
  })

  it('[H4] a legacy lifecycle name as the event suffix warns handler-phase-unknown + skips', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'authInit', value: { name: 'authInit', body: '() => {}' } }],
          children: [{ type: 'div', component: [{ reference: 'authInit', target: 'handlers.afterAssembly' }] }],
        },
      },
      content: [],
    } as never)
    expect(t.warnings.map((w) => w.code)).toContain('handler-phase-unknown')
  })

  it('[H5] compile materializes ONE provenance-marked handlers layer on the consumer; dispatchEvent fires the body; re-compile stays idempotent', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: '(e, c) => { return "clicked" }' } }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!
    const cr = t.root.compile(t.nodes)
    const handlersLayers = btn.layers.filter((l) => l.handlers !== undefined)
    expect(handlersLayers.length).toBe(1)
    const h = handlersLayers[0]!.handlers![0] as { name: string; event: string; body: (e: unknown, c: unknown) => string }
    expect(h.name).toBe('cb')
    expect(h.event).toBe('click')
    const results = dispatchEvent(btn, sup.handlerContext, 'click', 'v')
    expect(String(results[0])).toContain('clicked')
    // idempotent: recompile → still ONE layer
    t.root.compile(t.nodes)
    expect(btn.layers.filter((l) => l.handlers !== undefined).length).toBe(1)
  })

  it('[H6] reverse keeps the defs in template.component and emits the consumer target; re-translate zero-warn, no double-emit', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: '() => {}' } }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const rev = reverseTranslate(t.root)
    const defs = (Array.isArray(rev.template.component) ? rev.template.component : rev.template.component ? [rev.template.component] : []) as Array<{ reference?: string; value?: { name?: string } }>
    expect(defs.some((d) => d.reference === 'cb' && d.value?.name === 'cb')).toBe(true)
    const btn = rev.template.root.children![0]!
    const binding = (Array.isArray(btn.component) ? btn.component[0] : btn.component) as { reference?: string; target?: string }
    expect(binding.reference).toBe('cb')
    expect(binding.target).toBe('handlers.click')
    const t2 = translateLegacy(rev)
    expect(t2.warnings).toEqual([])
    // no double-emit: the re-translated consumer has ONE handler layer after compile
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t2.nodes) sup.registerNode(n)
    t2.root.compile(t2.nodes)
    const btn2 = t2.root.children[0]!
    expect(btn2.layers.filter((l) => l.handlers !== undefined).length).toBe(1)
  })
})

describe('FORMAT MARKER — the data-format marker + arg-order wrapper (decision 4; review A′ §2.3, 2026-08-15)', () => {
  // The runtime bridge (src/core/legacy-handlers.ts) wraps seam-installed
  // LEGACY bodies as (ctx, ...args) => body(eventStub(ctx, args),
  // legacyContext(ctx)) — the legacy (event, context) arg order restored.
  // Seam-installed defs default to 'legacy'; inline NodeData.handlers bodies
  // default to 'modern' (unwrapped); an explicit per-def format field
  // overrides the default and persists on reverse (K5-style).
  function seamEnv(def: Record<string, unknown>): { t: ReturnType<typeof translateLegacy>; sup: Supervisor; btn: NodeType } {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: def }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    return { t, sup, btn: t.root.children[0]! }
  }

  it('[F1] seam default — a def WITHOUT a format marker materializes a WRAPPED legacy body: the body receives (event, context) in legacy order', () => {
    const { sup, btn } = seamEnv({ name: 'cb', body: '(event, context) => event.type + ":" + context.node.type' })
    const results = dispatchEvent(btn, sup.handlerContext, 'click', 'v')
    expect(String(results[0])).toBe('click:button')
  })

  it('[F2] explicit format "legacy" — the same wrapped dispatch', () => {
    const { sup, btn } = seamEnv({ name: 'cb', format: 'legacy', body: '(event, context) => event.type + ":" + context.node.type' })
    const results = dispatchEvent(btn, sup.handlerContext, 'click')
    expect(String(results[0])).toBe('click:button')
  })

  it('[F3] explicit format "modern" — the body is installed RAW: modern (ctx, ...args) order (no wrap)', () => {
    const { sup, btn } = seamEnv({ name: 'cb', format: 'modern', body: '(ctx, ...args) => ctx.node.type + ":" + String(args[0])' })
    const results = dispatchEvent(btn, sup.handlerContext, 'click', 'v')
    expect(String(results[0])).toBe('button:v')
  })

  it('[F4] inline NodeData.handlers bodies default MODERN — installed unwrapped (raw body, (ctx, ...args) order)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [{ type: 'button', handlers: [{ name: 'boot', event: 'click', body: '(ctx) => ctx.node.type' }] }],
        },
      },
      content: [],
    })
    expect(t.warnings).toEqual([])
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!
    const results = dispatchEvent(btn, sup.handlerContext, 'click')
    expect(String(results[0])).toBe('button')
  })

  it('[F5] an inline handler with an explicit format "legacy" IS wrapped: the body receives (event, context) in legacy order', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [{
            type: 'button',
            handlers: [{ name: 'boot', format: 'legacy', event: 'click', body: '(event, context) => event.type + ":" + context.node.type' }],
          }],
        },
      },
      content: [],
    })
    expect(t.warnings).toEqual([])
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!
    const results = dispatchEvent(btn, sup.handlerContext, 'click')
    expect(String(results[0])).toBe('click:button')
  })

  it('[F6] a non-legacy/modern format value warns handler-format-invalid and FALLS BACK to the provenance default (def → legacy, inline → modern)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { t, sup, btn } = seamEnv({ name: 'cb', format: 'v3', body: '(event, context) => event.type' })
      expect(t.warnings.map((w) => w.code)).toContain('handler-format-invalid')
      // fallback = the seam default (legacy): still wrapped, dispatches in legacy order
      expect(String(dispatchEvent(btn, sup.handlerContext, 'click')[0])).toBe('click')

      const t2 = translateLegacy({
        template: {
          root: {
            type: 'app',
            children: [{ type: 'button', handlers: [{ name: 'b', format: 'v3' as never, event: 'click', body: '(ctx) => ctx.node.type' }] }],
          },
        },
        content: [],
      })
      expect(t2.warnings.map((w) => w.code)).toContain('handler-format-invalid')
      // fallback = the inline default (modern): unwrapped, (ctx, ...args) order
      const sup2 = new Supervisor({ events: new EventBridge() })
      for (const n of t2.nodes) sup2.registerNode(n)
      expect(String(dispatchEvent(t2.root.children[0]!, sup2.handlerContext, 'click')[0])).toBe('button')
    } finally {
      warn.mockRestore()
    }
  })

  it('[F7] reverse — an EXPLICIT format persists on the def ({reference, value: {name, body, format}}); the provenance default does NOT persist; re-translate reproduces the same wrapping, zero warns', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [
            { reference: 'explicit', value: { name: 'explicit', format: 'legacy', body: '(e, c) => e.type' } },
            { reference: 'implicit', value: { name: 'implicit', body: '(e, c) => e.type' } },
          ],
          children: [
            { type: 'button', component: [{ reference: 'explicit', target: 'handlers.click' }] },
            { type: 'button', component: [{ reference: 'implicit', target: 'handlers.click' }] },
          ],
        },
      },
      content: [],
    } as never)
    const rev = reverseTranslate(t.root)
    const defs = (Array.isArray(rev.template.component) ? rev.template.component : rev.template.component ? [rev.template.component] : []) as Array<{ reference: string; value: { name: string; body: string; format?: string } }>
    const explicit = defs.find((d) => d.reference === 'explicit')!
    expect(explicit.value.format).toBe('legacy')
    const implicit = defs.find((d) => d.reference === 'implicit')!
    expect(implicit.value.format).toBeUndefined()
    // re-translate: zero warns, and the explicit def re-materializes WRAPPED
    const t2 = translateLegacy(rev)
    expect(t2.warnings).toEqual([])
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t2.nodes) sup.registerNode(n)
    t2.root.compile(t2.nodes)
    const btn = t2.root.children[0]!
    expect(String(dispatchEvent(btn, sup.handlerContext, 'click')[0])).toBe('click')
  })

  it('[F8] an inline legacy-wrapped handler reverses with its ORIGINAL body source (never the wrapper source) + the explicit format', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [{
            type: 'button',
            handlers: [{ name: 'boot', format: 'legacy', event: 'click', body: '(event, context) => event.type' }],
          }],
        },
      },
      content: [],
    })
    const rev = reverseTranslate(t.root)
    const h = (rev.template.root.children![0] as { handlers?: Array<{ name: string; body: string; format?: string }> }).handlers![0]!
    expect(h.format).toBe('legacy')
    expect(h.body).toBe('(event, context) => event.type')
    expect(h.body).not.toContain('legacyContext')
    expect(h.body).not.toContain('eventStub')
  })
})
