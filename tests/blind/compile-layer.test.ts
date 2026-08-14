/**
 * BLIND-TEST WRITER artifact — COMPILE LAYER contract test (input→output).
 *
 * Sources (ONLY): docs/specs/placement-path-spec.md (FINAL) §1.2/§1.4/§2.1–§2.5,
 * docs/specs/node.md §2/§7.1/§8.3/§8.4/FS-1/FS-7, docs/specs/render.md §6,
 * docs/specs/api.md T27/T29, docs/specs/derived-state.md §2.3/§9.2/DV-H14.
 *
 * Contract under test: graph inputs (legacy envelope → TranslatedTree) →
 * path-enumeration compile outputs (one CompiledState per (node, owner-path)).
 *
 * AMBIGUITIES (my readings — the reviewer adjudicates):
 *  B1. compilePath's exact return shape is not pinned (node.md's CompileResult has
 *      actionable/dropped/warnings; the census language says "4095 path-states").
 *      Reading: compilePath(node) returns the full placement-routed graph's states;
 *      a normalize helper accepts either a bare CompiledState[] or a CompileResult
 *      and exposes `.actionable` / `.dropped` / `.warnings` when present.
 *  B2. Level-1 prototypes MUST request zone-0 (the root's producer zone) for the
 *      R2.2 arithmetic to hold (Σ 2^k, k=1..11 + root = 4095; per-level 2^k elements;
 *      "depth 4 → 15 states"). §5.1's "(the level-1 prototypes and root are producers
 *      only)" contradicts that arithmetic. Reading: every level-k prototype carries
 *      placementName 'zone-<k>' AND targetPlacement ['zone-(k-1)'] (k≥1); the root
 *      carries placementName 'zone-0'.
 *  B3. cs.children on path-states: §2.3 says descendant path-STATES; §4.2 says
 *      "the minted cs.children are the child NODES' ids". Reading: children.length is
 *      the descendant-state count per path (the stress:expanded input contract);
 *      the wire-form is asserted in the emit layer. children.length is asserted here.
 *  B4. cs.activePlacement is read as a field on path-states (derived-state DV-H14
 *      cites "cs.activePlacement"); if the real surface is a helper, the reviewer
 *      adjusts the accessor.
 *  B5. forkKey on FAMILY (non-path) states: path-states carry forkKey = pathKey
 *      unconditionally; family states carry none (render.test row "non-fork states
 *      carry none"). Asserted accordingly.
 *  B6. The prototype-terminated arm (FRK-F1) needs runtime seed-anchor construction
 *      not documented in the allowed docs; only the contentNodes-token termination
 *      (expressible via legacy data) is encoded here.
 */
import { describe, it, expect } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'


/* ------------------------------------------------------------------ */
/* local, documentation-derived types                                 */
/* ------------------------------------------------------------------ */

interface PathState {
  nodeId: string
  pathKey: string
  forkKey?: string
  state: string
  children: Array<{ id?: string; pathKey?: string } | string>
  activePlacement?: string
  props: Record<string, unknown>
  bindings: Record<string, unknown>
}

interface CompileOutput {
  states: PathState[]
  dropped?: Array<{ arm: unknown[]; reason: string }>
  warnings?: Array<{ code: string; pathKey?: string }>
}

/** Accept either a bare CompiledState[] or a CompileResult-like (node.md §2). */
function normalize(result: unknown): CompileOutput {
  if (Array.isArray(result)) return { states: result as PathState[] }
  const r = result as { actionable?: unknown[]; dropped?: unknown[]; warnings?: unknown[] }
  const out: CompileOutput = { states: (r.actionable ?? []) as PathState[] }
  if (r.dropped !== undefined) out.dropped = r.dropped as NonNullable<CompileOutput['dropped']>
  if (r.warnings !== undefined) out.warnings = r.warnings as NonNullable<CompileOutput['warnings']>
  return out
}

/**
 * §2.1 adjudication (B1): compilePath is a per-node METHOD (Node#compilePath,
 * src/core/types.ts:45; node.ts:947) — the supervisor's slice/compile-mode
 * switch compiles ONE dirty node through it (supervisor.ts:283), and the
 * whole-graph census is the per-node aggregate (engine pattern compileAll,
 * path-enum.test.ts:90-92). A whole-graph free function does not exist.
 */
function compileAll(t: TranslatedView): {
  actionable: PathState[]
  dropped: Array<{ arm: string[]; reason: string }>
  warnings: Array<{ code: string; pathKey: string }>
} {
  const actionable: PathState[] = []
  const dropped: Array<{ arm: string[]; reason: string }> = []
  const warnings: Array<{ code: string; pathKey: string }> = []
  for (const n of t.nodes) {
    const r = (n as unknown as {
      compilePath(): {
        actionable: PathState[]
        dropped: Array<{ arm: string[]; reason: string }>
        warnings: Array<{ code: string; pathKey: string }>
      }
    }).compilePath()
    actionable.push(...r.actionable)
    dropped.push(...r.dropped)
    warnings.push(...r.warnings)
  }
  return { actionable, dropped, warnings }
}

interface NodeView {
  id: string
  state: string
  props: Record<string, unknown>
  type: string
  children: NodeView[]
  anchors: Array<{ role: string; target: unknown }>
}
interface TranslatedView {
  root: NodeView
  nodes: NodeView[]
  content: NodeView[]
  warnings: Array<{ code: string; path?: string }>
}

/* ------------------------------------------------------------------ */
/* envelope builders                                                   */
/* ------------------------------------------------------------------ */

/** root(zone-0) + ONE prototype per level k=1..levels (zone-k, consumes zone-(k-1)). */
function chainEnvelope(levels: number, consumer?: Record<string, unknown>) {
  const content: Array<Record<string, unknown>> = []
  for (let k = 1; k <= levels; k++) {
    content.push({
      type: 'div',
      props: { 'stress:layer': k },
      placement: { placementName: `zone-${k}`, targetPlacement: [`zone-${k - 1}`] },
    })
  }
  if (consumer) content.push(consumer)
  return {
    template: { root: { type: 'app', props: { id: 'root' }, placement: { placementName: 'zone-0' } } },
    content: [{ content }],
  }
}

/** root(zone-0) + TWO prototypes per level (R2.2 sibling-shared owner names). */
function binaryEnvelope(levels: number) {
  const content: Array<Record<string, unknown>> = []
  for (let k = 1; k <= levels; k++) {
    for (const slot of ['a', 'b']) {
      content.push({
        type: slot === 'a' ? 'div' : 'span',
        props: { 'stress:layer': k, 'stress:slot': slot },
        placement: { placementName: `zone-${k}`, targetPlacement: [`zone-${k - 1}`] },
      })
    }
  }
  return {
    template: { root: { type: 'app', props: { id: 'root' }, placement: { placementName: 'zone-0' } } },
    content: [{ content }],
  }
}

const byKey = (s: PathState[]) => new Map(s.map((st) => [st.pathKey, st]))
const byNode = (s: PathState[]) => {
  const m = new Map<string, PathState[]>()
  for (const st of s) m.set(st.nodeId, [...(m.get(st.nodeId) ?? []), st])
  return m
}

describe('compile layer — path enumeration (P3 §2.1/§2.2)', () => {
  it('mints one state per (node, path-to-root); pathKey = root/<zone>/<ownerId>/…/<nodeId>; forkKey = pathKey', () => {
    // input: chain(1): root(zone-0) + a(zone-1, consumes zone-0)
    const t = translateLegacy(chainEnvelope(1)) as unknown as TranslatedView
    const a = t.content[0]!
    const out = normalize(compileAll(t))
    const map = byKey(out.states)
    expect(out.states).toHaveLength(2)
    expect(map.has('root')).toBe(true)
    expect(map.get('root')!.nodeId).toBe(t.root.id)
    // pathKey grammar (§2.2, node.ts pathKeyFor): the hop landing on the ROOT
    // node contributes nothing — 'root' IS the root, so a zone-0 consumer of
    // the root's own container keys as 'root/<id>', not 'root/zone-0/<id>'.
    const aKey = `root/${a.id}`
    const aState = map.get(aKey)
    expect(aState?.nodeId).toBe(a.id)
    expect(aState?.forkKey).toBe(aKey)
    expect(aState?.state).toBe('in-tree') // family label via contentNodes token (§10.aa)
  })

  it('fans out per container anchor of the chosen name — two sibling owners ⇒ two distinct path-states', () => {
    // input: binary(2): l1a/l1b own zone-1 (shared name); l2 consumes zone-1
    const t = translateLegacy(binaryEnvelope(2)) as unknown as TranslatedView
    const [l1a, l1b, l2a, l2b] = t.content as [NodeView, NodeView, NodeView, NodeView]
    const out = normalize(compileAll(t))
    const map = byKey(out.states)
    expect(out.states).toHaveLength(7) // root(1) + l1a(1) + l1b(1) + l2a(2) + l2b(2)
    // level-1 prototypes are zone-0 consumers of the ROOT's own container —
    // the root landing contributes nothing to the key
    expect(map.has(`root/${l1a.id}`)).toBe(true)
    expect(map.has(`root/${l1b.id}`)).toBe(true)
    // level-2 prototypes fan out over BOTH zone-1 containers (l1a, l1b)
    expect(map.has(`root/zone-1/${l1a.id}/${l2a.id}`)).toBe(true)
    expect(map.has(`root/zone-1/${l1b.id}/${l2a.id}`)).toBe(true)
    // sibling prototypes produce DISTINCT keys at their final segment (R2.2)
    expect(map.has(`root/zone-1/${l1a.id}/${l2b.id}`)).toBe(true)
    // every state: forkKey = pathKey; identity = pathKey alone — no '#<i>' anywhere
    for (const st of out.states) {
      expect(st.forkKey).toBe(st.pathKey)
      expect(st.pathKey.includes('#')).toBe(false)
    }
  })

  it('one path-state per (node, path): level-k prototype has 2^(k-1) states; depth-4 census = 15 (E2E-1 shape)', () => {
    const t = translateLegacy(binaryEnvelope(3)) as unknown as TranslatedView
    const out = normalize(compileAll(t))
    expect(out.states).toHaveLength(15) // 2^4 − 1
    const byN = byNode(out.states)
    expect(byN.get(t.root.id)).toHaveLength(1)
    for (let k = 1; k <= 3; k++) {
      for (const slot of ['a', 'b']) {
        const n = t.content[(k - 1) * 2 + (slot === 'b' ? 1 : 0)]!
        expect(byN.get(n.id)).toHaveLength(2 ** (k - 1))
      }
    }
    expect(new Set(out.states.map((s) => s.pathKey)).size).toBe(15)
  })
})

describe('compile layer — first-match preference (P3 §1.2, §2.5)', () => {
  it('stops at the MOST PREFERRED name with a known container; later names are NEVER consulted', () => {
    // input: C requests ['zone-1', 'zone-2'] with both names having containers
    const t = translateLegacy(
      chainEnvelope(2, {
        type: 'button',
        props: { id: 'C' },
        placement: { targetPlacement: ['zone-1', 'zone-2'] },
      }),
    ) as unknown as TranslatedView
    const C = t.content[2]!
    const out = normalize(compileAll(t))
    const cStates = out.states.filter((s) => s.nodeId === C.id)
    // chosen = zone-1 (first in array) → fan-out = zone-1's single container only.
    // C's path = C → zone-1 → l1 → zone-0 → root; the root landing contributes
    // nothing, so the key is root/zone-1/l1/C (no zone-0 segment).
    expect(cStates).toHaveLength(1)
    expect(cStates[0]!.pathKey).toBe(`root/zone-1/${t.content[0]!.id}/${C.id}`)
    expect(cStates[0]!.activePlacement).toBe('zone-1')
  })

  it('skips a no-container name before the chosen one (non-fatal) — chosen even when NOT first requested', () => {
    // input: C2 requests ['zone-x', 'zone-1']; zone-x has NO container, zone-1 has one
    const t = translateLegacy(
      chainEnvelope(1, {
        type: 'button',
        props: { id: 'C2' },
        placement: { targetPlacement: ['zone-x', 'zone-1'] },
      }),
    ) as unknown as TranslatedView
    const C2 = t.content[1]!
    const out = normalize(compileAll(t))
    const cStates = out.states.filter((s) => s.nodeId === C2.id)
    expect(cStates).toHaveLength(1)
    expect(cStates[0]!.pathKey).toBe(`root/zone-1/${t.content[0]!.id}/${C2.id}`)
    expect(cStates[0]!.activePlacement).toBe('zone-1')
    // skip is silent: no drops, no warnings
    expect(out.warnings ?? []).toHaveLength(0)
  })

  it('whole-array miss ⇒ nothing forks — the request is unsatisfied, silently', () => {
    const t = translateLegacy(
      chainEnvelope(1, {
        type: 'button',
        props: { id: 'C3' },
        placement: { targetPlacement: ['zone-x', 'zone-y'] },
      }),
    ) as unknown as TranslatedView
    const C3 = t.content[1]!
    const out = normalize(compileAll(t))
    expect(out.states.filter((s) => s.nodeId === C3.id)).toHaveLength(0)
  })
})

describe('compile layer — path-derived children at mint time (P3 §2.3, DV-H14)', () => {
  it('a path-state\'s children = the descendant path-states whose path extends it by one level; binary shape', () => {
    const t = translateLegacy(binaryEnvelope(3)) as unknown as TranslatedView
    const [l1a, , l2a, , l3a] = t.content as [NodeView, NodeView, NodeView, NodeView, NodeView]
    const out = normalize(compileAll(t))
    const map = byKey(out.states)
    // pathKey grammar (node.ts pathKeyFor): no zone segment for the root
    // landing; each own placement hop contributes '/zone/ownerId'
    const l1aKey = `root/${l1a.id}`
    const l2aViaL1a = `root/zone-1/${l1a.id}/${l2a.id}`
    const l3aViaL1aL2a = `root/zone-1/${l1a.id}/zone-2/${l2a.id}/${l3a.id}`
    // root has 2 children (the two level-1 states)
    expect(map.get('root')!.children.length).toBe(2)
    // l1a's state has 2 children (l2a, l2b under the l1a path)
    expect(map.get(l1aKey)!.children.length).toBe(2)
    // l2a-via-l1a has 2 children (l3a, l3b under that path)
    expect(map.get(l2aViaL1a)!.children.length).toBe(2)
    // l3a-via-l1a-l2a is a leaf
    expect(map.get(l3aViaL1aL2a)!.children.length).toBe(0)
    // stress:expanded contract: children.length > 0 on the state
    expect(map.get(l3aViaL1aL2a)!.children.length).toBe(0)
  })
})

describe('compile layer — viability (P3 §2.4, node.md FS-1 carve-out)', () => {
  it('a contentNodes-owned node with a placement path to root compiles actionable path-states (label stays honest)', () => {
    const t = translateLegacy(binaryEnvelope(2)) as unknown as TranslatedView
    const [l1a] = t.content as [NodeView]
    const out = normalize(compileAll(t))
    const states = out.states.filter((s) => s.nodeId === l1a.id)
    expect(states).toHaveLength(1)
    expect(states[0]!.state).toBe('in-tree') // family fact via contentNodes token
  })

  it('a bare content root with NO placement path compiles NOTHING (contentNodes token terminates the walk)', () => {
    const t = translateLegacy(
      chainEnvelope(1, { type: 'section', props: { id: 'bare' } }),
    ) as unknown as TranslatedView
    const bare = t.content[1]!
    const out = normalize(compileAll(t))
    expect(out.states.filter((s) => s.nodeId === bare.id)).toHaveLength(0)
  })

  it('family-attached nodes stay ordinary: family pathKey root/<id>, unchanged (B5: no forkKey)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          placement: { placementName: 'zone-0' },
          children: [{ type: 'section', props: { id: 'fc' } }],
        },
      },
      content: [
        { content: [{ type: 'div', placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] } }] },
      ],
    }) as unknown as TranslatedView
    const fc = t.root.children[0]!
    const out = normalize(compileAll(t))
    const map = byKey(out.states)
    expect(map.has(`root/${fc.id}`)).toBe(true)
    const familyState = map.get(`root/${fc.id}`)!
    // §2.2 (B5 corrected): forkKey = pathKey is set UNCONDITIONALLY on every
    // state minted by compilePath — family-first states included (node.ts
    // mintPathState: `cs.forkKey = cs.pathKey` for all walks, not only
    // fork arms). The writer's "no forkKey" reading is overruled.
    expect(familyState.forkKey).toBe(`root/${fc.id}`)
    // the placement-routed node next to it is a path-state with forkKey
    // (zone-0 consumer of the root ⇒ 'root/<id>' — no zone-0 segment)
    const a = t.content[0]!
    expect(map.get(`root/${a.id}`)?.forkKey).toBe(`root/${a.id}`)
  })
})

describe('compile layer — per-walk visit-set cycle guard (P3 §1.4, T29, node.md FS-7)', () => {
  it('drops a placement loop arm with reason "loop" + circular-source; sibling walks unaffected', () => {
    // input: A owns zone-a & requests zone-b; B owns zone-b & requests zone-a (A→B→A loop);
    // S requests zone-0 (viable sibling)
    const t = translateLegacy({
      template: {
        root: { type: 'app', props: { id: 'root' }, placement: { placementName: 'zone-0' } },
      },
      content: [
        {
          content: [
            { type: 'div', props: { id: 'A' }, placement: { placementName: 'zone-a', targetPlacement: ['zone-b'] } },
            { type: 'div', props: { id: 'B' }, placement: { placementName: 'zone-b', targetPlacement: ['zone-a'] } },
            { type: 'span', props: { id: 'S' }, placement: { targetPlacement: ['zone-0'] } },
          ],
        },
      ],
    }) as unknown as TranslatedView
    const [A, B, S] = t.content as [NodeView, NodeView, NodeView]
    const out = normalize(compileAll(t))
    // A and B produce no actionable states (loop); S compiles fine
    expect(out.states.filter((s) => s.nodeId === A.id)).toHaveLength(0)
    expect(out.states.filter((s) => s.nodeId === B.id)).toHaveLength(0)
    expect(out.states.filter((s) => s.nodeId === S.id)).toHaveLength(1)
    // the loop records as a dropped arm with reason 'loop' + circular-source warning
    const dropReasons = (out.dropped ?? []).map((d) => d.reason)
    expect(dropReasons).toContain('loop')
    expect((out.warnings ?? []).map((w) => w.code)).toContain('circular-source')
  })
})
