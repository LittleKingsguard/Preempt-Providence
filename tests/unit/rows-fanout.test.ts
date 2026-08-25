/**
 * Feature 1.4 — the rows compile fan-out census pin + the LINEARITY tripwire
 * (handoffs-review-5.md / next-feature-batch-0.2.0.md §Feature 1.4, ruling
 * a ADOPTED 2026-08-24): a name with N per-row providers yields N keyed arms
 * per consumer (measured ratio 1.0); the bound is states-per-consumer ≤ k·N
 * with k from the census (1.0) + 2× safety headroom = 2N, asserted here and
 * on the demo page; a blow-up (>2× the per-arm provider structure — a
 * FUTURE-REGRESSION class, structurally unreachable in the current resolve)
 * warns `fan-out-blowup` at compile.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub } from '../../src/core/translate.js'
import { registerDefPrototypes } from '../../src/core/registry.js'
import { isFanOutBlowup } from '../../src/core/resolve.js'

afterEach(() => {
  vi.restoreAllMocks()
})

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function mintRows(h: ReturnType<typeof createLinkHub>, creator: Node, rows: { id: string; name: string }[]) {
  const proto = new Node({ type: 'li' }, h, `proto-${creator.id}`)
  proto.addAnchor('source', 'row-def', {}, h.linkFor('row-def', 'component'))
  registerDefPrototypes(h.linkFor('row-def', 'component'), [proto])
  const sup = new Supervisor({ hub: h, events: new EventBridge() })
  const root = new Node({ type: 'div' }, h, 'root')
  const consumer = new Node({ type: 'span' }, h, 'consumer')
  consumer.addAnchor('target', 'name', {}, h.linkFor('name', 'component'))
  sup.registerNode(root)
  sup.registerNode(consumer)
  sup.registerNode(creator)
  sup.apply({ kind: 'attach', node: consumer, to: root })
  sup.apply({ kind: 'attach', node: creator, to: consumer })
  sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'row-def', rows, sourceName: 'rows-src' })
  return { sup, consumer }
}

describe('Feature 1.4 — the fan-out census pin (the linear shape)', () => {
  it('the measured shape: states-per-consumer = N exactly (ratio 1.0) for N = 2..32 rows, bounded ≤ 2N', async () => {
    for (const N of [2, 4, 8, 16, 32]) {
      const h = createLinkHub()
      const creator = new Node({ type: 'section' }, h, `creator-${N}`)
      const { sup, consumer } = mintRows(h, creator, Array.from({ length: N }, (_, i) => ({ id: `r${i}-${N}`, name: `name-${i}-${N}` })))
      await flushSweep()
      const pass2 = sup.takePass2States()
      const states = pass2.get('consumer') ?? []
      expect(states.length).toBe(N) // the 1:1 linear census
      expect(states.length).toBeLessThanOrEqual(2 * N) // the 2× headroom bound
      // the per-row values all resolve (the fork arms carry distinct bindings)
      const names = states.map((cs) => (cs as { bindings: Record<string, unknown> }).bindings.name)
      for (let i = 0; i < N; i += 1) expect(names).toContain(`name-${i}-${N}`)
      void consumer
    }
  })

  it('the tripwire is silent on the fork-stress-safe shape (2 providers per level, 3 levels)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = createLinkHub()
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    const root = new Node({ type: 'div' }, h, 'root')
    const consumer = new Node({ type: 'span' }, h, 'consumer')
    consumer.addAnchor('target', 'n1', {}, h.linkFor('n1', 'component'))
    sup.registerNode(root)
    sup.registerNode(consumer)
    sup.apply({ kind: 'attach', node: consumer, to: root })
    // 2 providers per level, 3 levels: a1/a2 (n1) → b1/b2 (n2) → c1/c2 (n3)
    let prev: Node[] = [consumer]
    for (const [i, name] of ['n1', 'n2', 'n3'].entries()) {
      const next: Node[] = []
      for (const p of prev) {
        for (let k = 0; k < 2; k += 1) {
          const n = new Node({ type: 'div' }, h, `l${i}-${p.id}-${k}`)
          n.addAnchor('source', name, {}, h.linkFor(name, 'component'))
          sup.registerNode(n)
          sup.apply({ kind: 'attach', node: n, to: p })
          next.push(n)
        }
      }
      prev = next
    }
    // the full-slice compile (the demo bootstrap pattern — the pass-2
    // focused slice reaches only the DIRECT providers by design)
    const cr = consumer.compile(sup.allNodes())
    const states = cr.actionable.filter((s) => s.nodeId === 'consumer')
    expect(states.length).toBe(2) // the consumer's OWN arms = the direct hits
    expect(warn.mock.calls.some((c) => String(c[0]).includes('fan-out-blowup'))).toBe(false)
  })

  it('the bound helper — the >2× per-arm product is the tripwire (the DEFECT #22-class regression guard)', () => {
    // the measured shape: next = arms × hits (the designed fork product) —
    // within the 2× headroom at ANY depth
    expect(isFanOutBlowup(64, 64, 1)).toBe(false) // the demo N=64, base arm
    expect(isFanOutBlowup(2, 2, 1)).toBe(false) // fork-stress level 1
    expect(isFanOutBlowup(4, 2, 2)).toBe(false) // fork-stress level 2 (2×2)
    expect(isFanOutBlowup(8, 2, 4)).toBe(false) // fork-stress level 3 (2×2×2)
    expect(isFanOutBlowup(2, 1, 1)).toBe(false) // the blow-up test's 1×2 nested
    expect(isFanOutBlowup(4, 4, 1)).toBe(false) // 1×4 nested — the designed product (next = arms × hits = 4 ≤ 2×4)
    // the regression class: an arm forking 3+ times per hit (>2× the product)
    expect(isFanOutBlowup(6, 1, 1)).toBe(true)
    expect(isFanOutBlowup(3, 1, 1)).toBe(true)
    expect(isFanOutBlowup(9, 1, 2)).toBe(true)
  })

  it('the tripwire is silent on the 1×4 nested blow-up shape (the arms are linear in the per-level hits)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const h = createLinkHub()
    const sup = new Supervisor({ hub: h, events: new EventBridge() })
    const root = new Node({ type: 'div' }, h, 'root')
    const consumer = new Node({ type: 'span' }, h, 'consumer')
    consumer.addAnchor('target', 'outer', {}, h.linkFor('outer', 'component'))
    sup.registerNode(root)
    sup.registerNode(consumer)
    sup.apply({ kind: 'attach', node: consumer, to: root })
    const outer = new Node({ type: 'div' }, h, 'outer')
    outer.addAnchor('source', 'outer', {}, h.linkFor('outer', 'component'))
    outer.addAnchor('target', 'inner', {}, h.linkFor('inner', 'component'))
    sup.registerNode(outer)
    sup.apply({ kind: 'attach', node: outer, to: root })
    for (let k = 0; k < 4; k += 1) {
      const inner = new Node({ type: 'div' }, h, `inner-${k}`)
      inner.addAnchor('source', 'inner', {}, h.linkFor('inner', 'component'))
      sup.registerNode(inner)
      sup.apply({ kind: 'attach', node: inner, to: outer })
    }
    const cr = consumer.compile(sup.allNodes())
    const states = cr.actionable.filter((s) => s.nodeId === 'consumer')
    expect(states.length).toBe(1) // the consumer's own arm = the 1 direct hit
    // the nested arms are linear in the per-level hits (1 × 4) — silent
    expect(warn.mock.calls.some((c) => String(c[0]).includes('fan-out-blowup'))).toBe(false)
  })
})