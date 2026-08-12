// @ts-nocheck — the demo module under test is plain JS (no declarations).
import { describe, it, expect } from 'vitest'
import { forkStressLegacyData } from '../../demo/fork-stress-data.js'

describe('forkStressLegacyData — single-method envelopes', () => {
  it('placement-only: every prototype kind is placement; no component refs', () => {
    const env = forkStressLegacyData(4, 'placement')
    const protos = env.content[0].content
    expect(protos).toHaveLength(2 * 3)
    for (const p of protos) {
      expect(p.props['stress:kind']).toBe('placement')
      expect(p.component).toBeUndefined()
      expect(p.handlers).toEqual([{ name: 'stress-expand', phase: 'after-compile' }])
    }
  })

  it('values-only: every prototype declares its component source (reference + value)', () => {
    const env = forkStressLegacyData(4, 'values')
    for (const p of env.content[0].content) {
      const layer = p.props['stress:layer']
      const slot = p.props['stress:slot']
      expect(p.props['stress:kind']).toBe('values')
      expect(p.component).toEqual({ reference: `values-${layer}.${slot}`, value: `value-${slot.toUpperCase()}-${layer}` })
    }
  })

  it('link-only: every prototype declares its component-def source (reference + def value)', () => {
    const env = forkStressLegacyData(4, 'link')
    for (const p of env.content[0].content) {
      const layer = p.props['stress:layer']
      expect(p.props['stress:kind']).toBe('link')
      expect(p.component.reference).toBe(`link-${layer}`)
      expect(p.component.value.type).toBe('div')
      expect(p.component.value.childOffset).toBe(0)
      expect(p.component.value.children).toEqual([
        { bind: 'a', type: 'div', content: `link-${layer}.a`, css: expect.anything(), props: expect.anything() },
        { bind: 'b', type: 'div', content: `link-${layer}.b`, css: expect.anything(), props: expect.anything() },
      ])
    }
  })

  it('default (no method): the four-mechanism cycle label per layer (placement→values→link→handler)', () => {
    const env = forkStressLegacyData(5)
    for (const p of env.content[0].content) {
      const layer = p.props['stress:layer']
      expect(p.props['stress:kind']).toBe(['placement', 'values', 'link', 'handler'][(layer - 1) % 4])
    }
  })
})
