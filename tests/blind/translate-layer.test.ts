/**
 * BLIND-TEST WRITER artifact — TRANSLATE LAYER contract test (input→output).
 *
 * Sources (ONLY): docs/specs/translate.md (final state), docs/specs/placement-path-spec.md
 * (FINAL) §1.1/§1.2/§1.3/§2.5/§6.2 + §10.ad F-13, docs/specs/api.md T26/T28,
 * docs/skills/designing-pages.md §3/§8.
 *
 * Contract under test: legacy envelope (LegacyInitialData) → TranslatedTree, and
 * the reverse emission (TranslatedTree → legacy NodeSchema doc).
 *
 * AMBIGUITIES (my readings — the reviewer adjudicates):
 *  A1. reverseTranslate's signature is not pinned in the docs (translate.md names
 *      nodeToLegacy; designing-pages §8 names reverseTranslate with opts.payloads).
 *      Reading: `reverseTranslate(translated, {})` returns the
 *      `{ template, content, clientConfig }`-shaped legacy doc.
 *  A2. The K4 warning `path` string format for placement warnings is not pinned
 *      per code (only the general format 'root.children[2]' / 'content[0].content[1]'
 *      is given). Reading: assert the code and that `path` is a string; never the
 *      exact string.
 *  A3. The ancestor-name veto (§1.3) walks the FAMILY chain. Reading: only family
 *      ancestors veto a producer's container anchor.
 *  A4. `activePlacement` reverse emission is a derived READ (first requested name
 *      with any containers); the value is asserted, the exact emission site is not.
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy, reverseTranslate } from '../../src/core/translate.js'

/* ------------------------------------------------------------------ */
/* local, documentation-derived types (translate.md §1)                */
/* ------------------------------------------------------------------ */

interface LegacyPlacementConfig {
  placementName?: string
  targetPlacement?: string | string[]
  activePlacement?: string
}

interface LegacyNodeData {
  type?: string
  placement?: LegacyPlacementConfig
  component?: unknown
  content?: unknown
  children?: LegacyNodeData[]
  props?: Record<string, unknown>
  handlers?: Array<{ name: string; event?: string; phase?: string; body?: string | Function }>
  css?: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }
  versions?: unknown
  derived?: { props?: Record<string, unknown> }
}

interface LegacyEnvelope {
  template: { root: LegacyNodeData; children?: LegacyNodeData[]; component?: unknown }
  content?: Array<{ metadata?: unknown; userData?: unknown; component?: unknown; content: LegacyNodeData[] }>
  clientConfig?: Record<string, unknown>
}

/** Minimal structural view of the documented Node/Anchor/Link surface (node.md §3/§5, translate.md §1). */
interface AnchorView {
  role: string
  target: string | unknown
  options?: Record<string, unknown>
  link?: { anchorsOf?: (role: string) => AnchorView[] }
}
interface NodeView {
  id: string
  state: string
  type: string
  props: Record<string, unknown>
  children: NodeView[]
  anchors: AnchorView[]
  parent: NodeView | null
}
interface TranslatedView {
  root: NodeView
  nodes: NodeView[]
  content: NodeView[]
  warnings: Array<{ code: string; path?: string }>
  clientConfig: { adapter: string; persistence: boolean }
}

const view = (t: unknown): TranslatedView => t as TranslatedView
/** Cast the writer-local envelope to the engine input type (never): the
 *  legacy targetPlacement string|string[] union is exactOptionalPropertyTypes-
 *  incompatible with LegacyInitialData's string[]; every call site casts. */
const legacyEnv = (o: Partial<LegacyEnvelope> = {}): never => makeEnvelope(o) as never
const anchorsOfRole = (n: NodeView, role: string): AnchorView[] => n.anchors.filter((a) => a.role === role)

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function makeEnvelope(overrides: Partial<LegacyEnvelope> = {}): LegacyEnvelope {
  return {
    template: { root: { type: 'app', props: { id: 'root' } } },
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* 1. placementName → 'container' anchor (producer role)               */
/* ------------------------------------------------------------------ */

describe('translate layer — container-role minting (P3 §1.1, TR-H3)', () => {
  it('mints a single container anchor (role "container", target = name) for placementName', () => {
    // input: node with placement.placementName 'zone-1'
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [{ content: [{ type: 'section', placement: { placementName: 'zone-1' } }] }],
        }),
      ),
    )
    const producer = t.content[0]!
    const containers = anchorsOfRole(producer, 'container')
    expect(containers).toHaveLength(1)
    expect(containers[0]!.target).toBe('zone-1')
    // no consumer-side anchors minted from a producer-only config
    expect(anchorsOfRole(producer, 'content')).toHaveLength(0)
    // family label: content roots are contentNodes-owned ⇒ in-tree (F-13 minting, §10.ad)
    expect(producer.state).toBe('in-tree')
    expect(t.warnings).toEqual([])
  })

  it('TR-2: same-name producers share ONE per-name placement Link; producer+consumer of one name share it too', () => {
    // input: two producers of 'zone-1' + one consumer requesting 'zone-1'
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            {
              content: [
                { type: 'div', placement: { placementName: 'zone-1' } },
                { type: 'span', placement: { placementName: 'zone-1' } },
                { type: 'button', placement: { targetPlacement: ['zone-1'] } },
              ],
            },
          ],
        }),
      ),
    )
    const [p1, p2, consumer] = t.content as [NodeView, NodeView, NodeView]
    const l1 = anchorsOfRole(p1, 'container')[0]!.link
    expect(anchorsOfRole(p2, 'container')[0]!.link).toBe(l1)
    expect(anchorsOfRole(consumer, 'content')[0]!.link).toBe(l1)
  })
})

/* ------------------------------------------------------------------ */
/* 2. targetPlacement: string[] → ordered 'content' anchors            */
/* ------------------------------------------------------------------ */

describe('translate layer — content-role minting (P3 §1.1/§1.2, T26, TR-H3)', () => {
  it('mints ONE content anchor per requested name, in array (preference) order, on the shared per-name Link', () => {
    // input: targetPlacement ['zone-b', 'zone-a', 'zone-c'] — deliberately NOT alphabetical
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            { content: [{ type: 'button', placement: { targetPlacement: ['zone-b', 'zone-a', 'zone-c'] } }] },
          ],
        }),
      ),
    )
    const consumer = t.content[0]!
    const contentAnchors = anchorsOfRole(consumer, 'content')
    expect(contentAnchors.map((a) => a.target)).toEqual(['zone-b', 'zone-a', 'zone-c'])
    expect(t.warnings).toEqual([])
  })

  it('coerces a bare STRING targetPlacement with a placement-string-coerced warn (back-compat)', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [{ content: [{ type: 'button', placement: { targetPlacement: 'zone-1' } }] }],
        }),
      ),
    )
    expect(anchorsOfRole(t.content[0]!, 'content').map((a) => a.target)).toEqual(['zone-1'])
    expect(t.warnings.map((w) => w.code)).toContain('placement-string-coerced')
  })

  it('warns placement-target-invalid and skips when targetPlacement is neither string nor string[]', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            // @ts-expect-error deliberate malformed input
            { content: [{ type: 'button', placement: { targetPlacement: 42 } }] },
          ],
        }),
      ),
    )
    expect(anchorsOfRole(t.content[0]!, 'content')).toHaveLength(0)
    expect(t.warnings.map((w) => w.code)).toContain('placement-target-invalid')
  })

  it('skips #-containing names with placement-name-invalid (P3 §1.3) but still mints the clean names', () => {
    // input: a '#' name among valid names
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            { content: [{ type: 'button', placement: { targetPlacement: ['zone#1', 'zone-2'] } }] },
          ],
        }),
      ),
    )
    const consumer = t.content[0]!
    expect(anchorsOfRole(consumer, 'content').map((a) => a.target)).toEqual(['zone-2'])
    expect(t.warnings.map((w) => w.code)).toContain('placement-name-invalid')
  })

  it('warns placement-name-invalid and skips the producer anchor for a # placementName (P3 §1.3)', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [{ content: [{ type: 'section', placement: { placementName: 'zone#1' } }] }],
        }),
      ),
    )
    expect(anchorsOfRole(t.content[0]!, 'container')).toHaveLength(0)
    expect(t.warnings.map((w) => w.code)).toContain('placement-name-invalid')
  })

  it('keeps the first of duplicate names with placement-duplicate-reference (K8-class guard)', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            { content: [{ type: 'button', placement: { targetPlacement: ['zone-1', 'zone-1'] } }] },
          ],
        }),
      ),
    )
    expect(anchorsOfRole(t.content[0]!, 'content').map((a) => a.target)).toEqual(['zone-1'])
    expect(t.warnings.map((w) => w.code)).toContain('placement-duplicate-reference')
  })

  it('never mints authored activePlacement — it is a derived read (P3 §2.5)', () => {
    // input: an authored activePlacement value must not produce any anchor or stored field
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            {
              content: [
                { type: 'button', placement: { targetPlacement: ['zone-1'], activePlacement: 'zone-9' } },
              ],
            },
          ],
        }),
      ),
    )
    const consumer = t.content[0]!
    expect(anchorsOfRole(consumer, 'content').map((a) => a.target)).toEqual(['zone-1'])
    expect(anchorsOfRole(consumer, 'container')).toHaveLength(0)
    expect(consumer.anchors.some((a) => a.target === 'zone-9')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 3. contentNodes-ownership minting (F-13 chosen reading)             */
/* ------------------------------------------------------------------ */

describe('translate layer — contentNodes-ownership minting (P3 §10.ad/F-13, TR-H5/TR-6)', () => {
  it('gives every content payload root AND template.children root a contentNodes parent anchor; family-in-tree', () => {
    const t = view(
      translateLegacy({
        template: {
          root: { type: 'app', props: { id: 'root' } },
          children: [{ type: 'aside', props: { id: 'tc' } }],
        },
        content: [{ content: [{ type: 'section', props: { id: 'c1' } }] }],
      }),
    )
    const [templateChild] = t.content
    const [payloadChild] = [t.content[1]!]
    for (const n of [templateChild!, payloadChild]) {
      const childAnchor = n.anchors.find((a) => a.role === 'child')
      // F-13 token shape (node.md:73 AnchorTarget): the node-side 'child'
      // anchor targets the node itself; the 'contentNodes' TOKEN lives on
      // the link's 'parent' anchor (engine pattern, translate.test.ts:798-803)
      const parentAnchor = (childAnchor as unknown as { link?: { anchorsOf(role: string): AnchorView[] } })?.link?.anchorsOf(
        'parent',
      )[0]
      expect(parentAnchor?.target).toBe('contentNodes')
      expect(n.state).toBe('in-tree')
    }
    expect(t.content.map((n) => n.props.id)).toEqual(['tc', 'c1'])
  })

  it('TR-3/TR-4: minted ids are unique, root first; every node appears exactly once', () => {
    const t = view(
      translateLegacy({
        template: {
          root: {
            type: 'app',
            props: { id: 'root' },
            children: [{ type: 'div', props: { id: 'c' } }],
          },
        },
        content: [{ content: [{ type: 'span', props: { id: 'p' } }] }],
      }),
    )
    const ids = t.nodes.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(t.nodes[0]).toBe(t.root)
    expect(t.root.props.id).toBe('root')
  })
})

/* ------------------------------------------------------------------ */
/* 4. the NP13/AP5 component-target-placement warn is REMOVED          */
/* ------------------------------------------------------------------ */

describe('translate layer — targetPlacement feed is implemented (NP13/AP5 removed, T26)', () => {
  it('mints content anchors on any node (placement inside component sub-trees) with NO component-target-placement warn', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            {
              content: [
                {
                  type: 'button',
                  component: { reference: 'MyComp' },
                  placement: { targetPlacement: ['zone-1'] },
                },
              ],
            },
          ],
        }),
      ),
    )
    expect(anchorsOfRole(t.content[0]!, 'content').map((a) => a.target)).toEqual(['zone-1'])
    expect(t.warnings.some((w) => w.code === 'component-target-placement')).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* 5. K4 warnings channel + TR-F2 (warn+skip, never throw)             */
/* ------------------------------------------------------------------ */

describe('translate layer — K4 channel + envelope guards (§3, TR-H10, TR-F1/TR-F2)', () => {
  it('always surfaces a warnings array (empty for a clean doc); well-formed-but-invalid content warns + skips', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            {
              content: [
                { type: 'button', component: {} }, // vacuous binding → component-binding-empty
                { type: 'div', placement: { targetPlacement: ['ok', 'ok'] } }, // duplicate → warn
                { type: 'div', versions: { anything: true } }, // unknown extra field → ignored
              ],
            },
          ],
        }),
      ),
    )
    expect(Array.isArray(t.warnings)).toBe(true)
    const codes = t.warnings.map((w) => w.code)
    expect(codes).toContain('component-binding-empty')
    expect(codes).toContain('placement-duplicate-reference')
    expect(codes.filter((c) => c === 'placement-duplicate-reference').length).toBeGreaterThanOrEqual(1)
    for (const w of t.warnings) expect(typeof w.path).toBe('string')
    // the vacuous node still exists with zero anchors; unknown fields never throw
    expect(t.content.length).toBe(3)
  })

  it('throws legacy-envelope-mismatch for null / non-object / missing template.root', () => {
    expect(() => translateLegacy(null as unknown as never)).toThrow(/legacy-envelope-mismatch/)
    expect(() => translateLegacy({} as never)).toThrow(/legacy-envelope-mismatch/)
    expect(() => translateLegacy({ template: {} } as never)).toThrow(/legacy-envelope-mismatch/)
  })

  it('throws legacy-payload-mismatch for a payload without content: NodeData[]', () => {
    expect(() =>
      translateLegacy({
        template: { root: { type: 'app' } },
        content: [{ metadata: {} }],
      } as never),
    ).toThrow(/legacy-payload-mismatch/)
  })
})

/* ------------------------------------------------------------------ */
/* 6. ancestor-name veto (P3 §1.3, T28)                                */
/* ------------------------------------------------------------------ */

describe('translate layer — ancestor-name veto (T28)', () => {
  // ENGINE DEFECT #1 (reported in archive/findings/2026-08-15/2026-08-15-test-findings.md §"Blind test #3",
  // NOT fixed by the reviewer — reviewer never edits engine code): the
  // translate-time half of the §1.3 ancestor-name veto is MISSING in
  // src/core/translate.ts. placement-path-spec §1.3 + §6 CODE translate row +
  // api.md T28: the producer's container anchor must NOT be minted when a
  // family ancestor WOULD ATTEMPT TO PLACE INTO the zone (has a 'content'
  // anchor for it) — the presentation would create a placement-path loop
  // (the ancestor's content anchor → the per-name Link → the descendant's
  // container → family up → the ancestor → revisit). User correction
  // 2026-08-14: DUPLICATE PRESENTATION (an ancestor merely OFFERS the same
  // zone) is LEGAL — overriding an ancestor's zone is a feature
  // (nearest-shadows-far); the veto is loop-prevention ONLY.
  it('does NOT mint a container anchor when a family ancestor would attempt to place into the zone; warns placement-name-vetoed', () => {
    // root CONSUMES zone-0 (content anchor — would attempt to place into it);
    // its family child PRESENTS zone-0 → veto (loop-prevention)
    const t = view(
      translateLegacy({
        template: {
          root: {
            type: 'app',
            placement: { targetPlacement: ['zone-0'] },
            children: [{ type: 'section', placement: { placementName: 'zone-0' } }],
          },
        },
      }),
    )
    const child = t.root.children[0]!
    expect(anchorsOfRole(child, 'container')).toHaveLength(0)
    expect(t.warnings.map((w) => w.code)).toContain('placement-name-vetoed')
    // the root's own consumer anchor is untouched
    expect(anchorsOfRole(t.root, 'content').map((a) => a.target)).toEqual(['zone-0'])
  })

  it('DUPLICATE PRESENTATION is LEGAL: a descendant may present a zone its ancestor also OFFERS (override — no veto)', () => {
    // root offers zone-0 (container); its family child ALSO offers zone-0 —
    // no ancestor CONSUMES zone-0 → the child's presentation is a legal
    // override (nearest-shadows-far is a component feature)
    const t = view(
      translateLegacy({
        template: {
          root: {
            type: 'app',
            placement: { placementName: 'zone-0' },
            children: [{ type: 'section', placement: { placementName: 'zone-0' } }],
          },
        },
      }),
    )
    const child = t.root.children[0]!
    expect(anchorsOfRole(child, 'container').map((a) => a.target)).toEqual(['zone-0'])
    expect(t.warnings).toEqual([])
  })

  it('does not veto a DIFFERENT name on the same ancestor chain', () => {
    const t = view(
      translateLegacy({
        template: {
          root: {
            type: 'app',
            placement: { placementName: 'zone-0' },
            children: [{ type: 'section', placement: { placementName: 'zone-1' } }],
          },
        },
      }),
    )
    expect(anchorsOfRole(t.root.children[0]!, 'container').map((a) => a.target)).toEqual(['zone-1'])
    expect(t.warnings).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* 7. reverse emission (P3 §6.2, T26 reverse half)                     */
/* ------------------------------------------------------------------ */

describe('translate layer — reverse emission (P3 §6.2)', () => {
  it('round-trips content anchors → targetPlacement: string[] in MINT order + container anchors → placementName', () => {
    // input: consumer requesting ['zone-2', 'zone-0'] (non-alphabetical mint order)
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            {
              content: [
                { type: 'section', placement: { placementName: 'zone-1' } },
                { type: 'section', placement: { placementName: 'zone-2', targetPlacement: ['zone-0'] } },
                { type: 'button', placement: { targetPlacement: ['zone-2', 'zone-0'] } },
              ],
            },
          ],
        }),
      ),
    )
    const doc = reverseTranslate(t.root as never, { content: t.content as never }) as {
      template: { root: LegacyNodeData; children?: LegacyNodeData[] }
      content: Array<{ content: LegacyNodeData[] }>
    }
    const items = doc.content[0]!.content
    const consumer = items.find((n) => n.type === 'button')!
    const producer = items.find((n) => n.type === 'section' && (n.placement as any)?.targetPlacement)!
    expect((consumer.placement as any)?.targetPlacement).toEqual(['zone-2', 'zone-0'])
    expect((producer.placement as any)?.targetPlacement).toEqual(['zone-0'])
    // derived activePlacement: the FIRST requested name with any containers (zone-2 has producer zone-2)
    expect((consumer.placement as any)?.activePlacement).toBe('zone-2')
  })

  it('emits the derived activePlacement: string read on reverse', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [
            {
              content: [
                { type: 'section', placement: { placementName: 'zone-2' } },
                { type: 'button', placement: { targetPlacement: ['zone-9', 'zone-2'] } },
              ],
            },
          ],
        }),
      ),
    )
    const doc = reverseTranslate(t.root as never, { content: t.content as never }) as { content: Array<{ content: LegacyNodeData[] }> }
    const consumer = doc.content[0]!.content.find((n) => n.type === 'button')!
    // zone-9 has no container (skipped, non-fatal); zone-2 has one ⇒ derived read = 'zone-2'
    expect((consumer.placement as any)?.activePlacement).toBe('zone-2')
    expect(typeof (consumer.placement as any)?.activePlacement).toBe('string')
  })

  it('STRIPS the minted contentNodes anchor on reverse — re-translate re-mints cleanly, zero warnings', () => {
    const t = view(
      translateLegacy(
        legacyEnv({
          content: [{ content: [{ type: 'section', placement: { placementName: 'zone-1' } }] }],
        }),
      ),
    )
    const doc = reverseTranslate(t.root as never, { content: t.content as never }) as { content: Array<{ content: LegacyNodeData[] }> }
    const re = view(translateLegacy(doc as never))
    // the re-translated tree mints the token edge again from scratch: no veto/warn, no leftover artifacts
    expect(re.warnings).toEqual([])
    expect(re.content.map((n) => n.type)).toEqual(['section'])
    expect(anchorsOfRole(re.content[0]!, 'container').map((a) => a.target)).toEqual(['zone-1'])
    expect(anchorsOfRole(re.content[0]!, 'content')).toHaveLength(0)
  })
})
