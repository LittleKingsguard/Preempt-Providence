// @ts-nocheck — the demo module under test is plain JS (no declarations).
/**
 * The family's ENVELOPE contract suite (spec §8.2 row 9), re-pointed for the
 * path-enumeration conversion (docs/specs/fork-stress-data-p3.md, user ruling
 * 2026-09-22):
 *
 *   · the `handlers: [{name:'stress-expand'}]` assertion INVERTS — the
 *     converted envelope must carry NO handler declaration and no
 *     `stress:handler` prop (the family no longer expands after compile);
 *   · the per-prototype `stress:kind` label assertions INVERT into
 *     PLACEMENT-TOPOLOGY assertions (the R2.2 sibling-shared owner-name
 *     topology, §3 K1/K2 — the same shape `FD-3` asserts over depth);
 *   · the `values`/`link` `component` shape assertions STAY — they are the
 *     §3 K3/K4 payload contract (the mechanism is declared as pure data);
 *   · the four-mechanism CYCLE-labels case is DROPPED-WITH-RECORD: the
 *     mechanism label is a clone-era per-node prop and the cycle framing has no
 *     path-model meaning (every path-state of a single-method page has the same
 *     mechanism — spec §7's disposition table, `stress:kind` → DROPPED-WITH-RECORD).
 *     Its replacement is the topology assertion below, which is what the
 *     converted default (cycle-labelled) pages must now satisfy.
 */
import { describe, it, expect } from 'vitest'
import { forkStressLegacyData } from '../../demo/fork-stress-data.js'

/** Level-1 prototypes are the root's children; levels 2..depth−1 are the
 *  content payload (the converted envelope's shape, §3 K1/K4). */
function levelsOf(env, depth) {
  const l1 = env.template.root.children
  const rest = env.content[0].content
  return { l1, rest, all: [...l1, ...rest], depth }
}

describe('forkStressLegacyData — the converted (path-enumeration) envelope', () => {
  it('placement-only: every prototype declares the R2.2 shared-name placement topology; NO handler, NO component refs', () => {
    const depth = 4
    const env = forkStressLegacyData(depth, 'placement')
    const { l1, rest, all } = levelsOf(env, depth)
    // the topology: TWO level-1 producers on the root, the deeper levels in the
    // content payload (contentNodes-owned) — 2·(depth−1) prototypes total
    expect(l1, 'level-1 prototypes are the root children').toHaveLength(2)
    expect(rest, 'levels 2..depth−1 are the content payload').toHaveLength(2 * (depth - 2))
    expect(all).toHaveLength(2 * (depth - 1))
    for (const p of all) {
      const k = p.props['stress:layer']
      const slot = p.props['stress:slot']
      // producer: every prototype owns the level's shared zone name
      expect(p.placement?.placementName, `L${k}${slot}: producer name`).toBe(`zone-${k}`)
      if (k === 1) {
        expect(p.placement?.targetPlacement, `L${k}${slot}: level 1 is producers-only`).toBeUndefined()
      } else {
        expect(p.placement?.targetPlacement, `L${k}${slot}: consumer edge to the level above's SHARED name`).toEqual([`zone-${k - 1}`])
      }
      // the clone-era residue is GONE: no handler declaration, no handler prop,
      // no mechanism label, and no per-path/node mechanism bookkeeping
      expect(p.handlers, `L${k}${slot}: no handler declaration`).toBeUndefined()
      expect(p.props['stress:handler'], `L${k}${slot}: no stress:handler prop`).toBeUndefined()
      expect(p.props['stress:kind'], `L${k}${slot}: no stress:kind label`).toBeUndefined()
      expect(p.component, `L${k}${slot}: placement declares no component`).toBeUndefined()
    }
    expect(JSON.stringify(env).includes('stress-expand'), 'the envelope still names the clone-expansion handler').toBe(false)
    expect(JSON.stringify(env).includes('stress:handler'), 'the envelope still carries a handler prop').toBe(false)
  })

  it('the multiplicity: each level k owns ONE shared name behind TWO containers (a distinct-name topology collapses to a chain)', () => {
    const env = forkStressLegacyData(6, 'placement')
    const { all } = levelsOf(env, 6)
    for (let k = 1; k <= 5; k += 1) {
      const layer = all.filter((p) => p.props['stress:layer'] === k)
      expect(layer, `level ${k}: two prototypes`).toHaveLength(2)
      const names = layer.map((p) => p.placement?.placementName)
      expect(names, `level ${k}: both siblings own the SAME zone name`).toEqual([`zone-${k}`, `zone-${k}`])
      expect(new Set(names).size, `level ${k}: one shared name`).toBe(1)
    }
  })

  it('values-only: every prototype declares its component source (reference + value) — pure DATA, no handler', () => {
    const env = forkStressLegacyData(4, 'values')
    const { all } = levelsOf(env, 4)
    for (const p of all) {
      const layer = p.props['stress:layer']
      const slot = p.props['stress:slot']
      expect(p.component).toEqual({ reference: `values-${layer}.${slot}`, value: `value-${slot.toUpperCase()}-${layer}` })
      expect(p.handlers).toBeUndefined()
    }
  })

  it('link-only: every prototype declares its component-def source (reference + def value) — pure DATA, no handler', () => {
    const env = forkStressLegacyData(4, 'link')
    const { all } = levelsOf(env, 4)
    for (const p of all) {
      const layer = p.props['stress:layer']
      expect(p.component.reference).toBe(`link-${layer}`)
      expect(p.component.value.type).toBe('div')
      expect(p.component.value.childOffset).toBe(0)
      expect(p.component.value.children).toEqual([
        { bind: 'a', type: 'div', content: `link-${layer}.a`, css: expect.anything(), props: expect.anything() },
        { bind: 'b', type: 'div', content: `link-${layer}.b`, css: expect.anything(), props: expect.anything() },
      ])
      expect(p.handlers).toBeUndefined()
    }
  })

  it('default (no method): the SAME path-enumeration topology (the cycle-label framing is dropped with the mechanism label)', () => {
    const env = forkStressLegacyData(5)
    const { l1, rest, all } = levelsOf(env, 5)
    expect(l1).toHaveLength(2)
    expect(rest).toHaveLength(2 * 3)
    for (const p of all) {
      const k = p.props['stress:layer']
      expect(p.placement?.placementName).toBe(`zone-${k}`)
      expect(p.props['stress:kind'], 'the mechanism label is dropped on the cycle pages too').toBeUndefined()
      expect(p.handlers).toBeUndefined()
    }
  })
})
