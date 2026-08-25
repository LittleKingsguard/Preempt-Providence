/**
 * preserve-reversal-scenarios — the Feature 4 preserve-by-reversal demo
 * (docs/specs/handoffs-review-9.md D1-D8, decisions.md PRESERVE-BY-REVERSAL
 * row, 2026-08-25).
 *
 * Demonstrates the preserve-by-reversal flag: a layerApply mint with
 * preserveByReversal:true, reverseTranslate ships the preserved subtree as
 * authored, the descendant cascade, the distinction from promotion, and the
 * re-mint flag loss.
 *
 * Banner: `preserve-reversal-scenarios`; profile line
 * `[preserve-reversal:profile]`; globals `__preserveReversalScenariosDone` +
 * `__preserveReversalScenariosProfile`.
 */
import { Node, Supervisor } from '../dist/core/node.js'
import { EventBridge } from '../dist/core/events.js'
import { Link } from '../dist/core/link.js'
import { reverseTranslate } from '../dist/core/translate.js'
import { hub, childOf } from './demo-fixtures.js'
import { registerDefPrototypes } from '../dist/core/registry.js'
import { makeRunner } from './lib/runner.js'

/** A root on the SHARED hub (the rootNode token — the reverse root-detection
 *  needs it). */
function sharedRoot(h, id) {
  const root = new Node({ type: 'app', content: 'root' }, h, id)
  const link = new Link({ name: 'parent-child' })
  root.addAnchor('child', root, { priority: 0 }, link)
  link.addAnchor({ role: 'parent', target: 'rootNode', options: {}, link })
  return root
}

// ============================================================================
// PAGE — browser module.
// ============================================================================

if (typeof document !== 'undefined') {
  const runner = makeRunner()
  document.getElementById('results').appendChild(runner.el)

  const PROFILE = {
    loadMs: 0, mintMs: 0, reverseMs: 0, checksMs: 0, totalMs: 0, coveredMs: 0,
    preservedShipped: 0, descendantsShipped: 0, flagStillSet: false,
    reMintDroppedFlag: false,
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }

  async function main() {
    const h = hub()
    const events = new EventBridge()
    const sup = new Supervisor({ hub: h, events })

    const root = sharedRoot(h, 'root')
    sup.registerNode(root)

    const outputBox = document.getElementById('output-box')
    function renderOutput(out) {
      outputBox.textContent = JSON.stringify(out, null, 2)
    }

    // ---- D1 — mint a preserved node under the root via layerApply -----------
    acc('mintMs', () => sup.apply({
      kind: 'layer-apply',
      target: root,
      layerId: 'preserved-layer-1',
      sourceName: 'test',
      nodes: [{ type: 'p', content: 'preserved-child' }],
      preserveByReversal: true,
    }))

    // ---- D2 — mint an UNPRESERVED child under the preserved node (cascade) --
    const preservedChild = root.children[0]
    acc('mintMs', () => sup.apply({
      kind: 'layer-apply',
      target: preservedChild,
      layerId: 'inner-layer-1',
      sourceName: 'test',
      nodes: [{ type: 'span', content: 'inner-descendant' }],
    }))

    // ---- reverse the tree ---------------------------------------------------
    const out = acc('reverseMs', () => reverseTranslate(root, { content: [] }))
    renderOutput(out)

    // ---- checks -------------------------------------------------------------
    const checksT0 = now()

    // D1 — preserved node ships as authored in the reverse output
    const rootChildren = out.template.root.children ?? []
    const preservedInReverse = rootChildren.find(
      (c) => c.type === 'p' && c.content === 'preserved-child'
    )
    await runner.check('D1 — preserved node ships as authored in the reverse output', () => {
      if (!preservedInReverse) throw new Error('preserved child not found in reverse output')
      // no layer machinery, no flag residue — compressed into authored data
      if (preservedInReverse.originLayer !== undefined) throw new Error('originLayer leaked into reverse output')
      if (preservedInReverse.preserveByReversal !== undefined) throw new Error('preserveByReversal leaked into reverse output')
      PROFILE.preservedShipped = 1
    })

    // D2 — descendant cascade: the inner unpreserved child ships under the
    // preserved parent (the preserved context cascades through nodeToLegacy)
    await runner.check('D2 — descendant cascade: origin-built descendants ship too', () => {
      if (!preservedInReverse) throw new Error('preserved child not found (D2 prerequisite)')
      const preservedChildren = preservedInReverse.children ?? []
      const innerInReverse = preservedChildren.find(
        (c) => c.type === 'span' && c.content === 'inner-descendant'
      )
      if (!innerInReverse) throw new Error('inner descendant not found under preserved parent')
      PROFILE.descendantsShipped = 1
    })

    // D3 — not-promotion: the node stays minted after the flag is set
    await runner.check('D3 — not-promotion: node stays minted after flag is set', () => {
      // originLayer is STILL set — the node is still minted, not promoted
      if (preservedChild.originLayer !== 'preserved-layer-1') {
        throw new Error(`originLayer=${preservedChild.originLayer} (expected 'preserved-layer-1')`)
      }
      PROFILE.flagStillSet = true
    })

    // D4 — re-mint drops flag: a same-hookName rowsMint REPLACES the layer
    // (ops.ts:449) with a flag-less object → the flag is dropped; the
    // re-minted rows are then excluded on reverse. This is a genuine
    // rows-mint re-mint (the ADV-S24 pattern) — NOT a removeLayer teardown.
    const h2 = hub()
    const proto2 = new Node({ type: 'li', props: { cls: 'row' } }, h2, 'proto-2')
    registerDefPrototypes(h2.linkFor('item', 'component'), [proto2])
    const root2 = new Node({ type: 'app' }, h2, 'root2')
    const creator2 = new Node({ type: 'section' }, h2, 'creator2')
    childOf(root2, creator2)
    const sup2 = new Supervisor({ hub: h2, events: new EventBridge() })
    sup2.registerNode(root2)
    sup2.registerNode(creator2)

    // FIRST mint WITH the flag — a keyed rows-mint lands preserveByReversal
    sup2.apply({
      kind: 'rows-mint',
      target: creator2,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      keyField: 'sku',
      rows: [{ sku: 'a', name: 'A' }],
      preserveByReversal: true,
    })
    const layer2Before = creator2.layers.find((l) => l.id === `hook-${creator2.id}-items-rows`)
    const flagBefore = layer2Before?.preserveByReversal === true

    // Reverse before re-mint — the preserved row ships as authored
    const outBefore = reverseTranslate(root2, { content: [] })
    const creatorBefore = (outBefore.template.root.children ?? []).find(
      (c) => c.type === 'section'
    )
    const childBefore = (creatorBefore?.children ?? []).some(
      (c) => c.type === 'li'
    )

    // SECOND mint, SAME hookName, WITHOUT the flag — the layer is REPLACED
    // flag-less (ops.ts:449), so the flag drops
    sup2.apply({
      kind: 'rows-mint',
      target: creator2,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      keyField: 'sku',
      rows: [{ sku: 'a', name: 'A' }, { sku: 'b', name: 'B' }],
    })
    const layer2After = creator2.layers.find((l) => l.id === `hook-${creator2.id}-items-rows`)
    const flagAfter = layer2After?.preserveByReversal === true

    // After the re-mint the flag is GONE — the re-minted rows are excluded
    const outAfter = reverseTranslate(root2, { content: [] })
    const creatorAfter = (outAfter.template.root.children ?? []).find(
      (c) => c.type === 'section'
    )
    const childAfter = (creatorAfter?.children ?? []).some(
      (c) => c.type === 'li'
    )

    await runner.check('D4 — re-mint drops flag: same-hookName rows-mint replaces the layer flag-less', () => {
      if (!flagBefore) throw new Error('flag was not set before re-mint')
      if (!childBefore) throw new Error('preserved row was not present before re-mint (prerequisite)')
      if (flagAfter) throw new Error('flag should be dropped after the re-mint replaces the layer')
      if (childAfter) throw new Error('re-minted rows should be excluded after the flag is dropped')
      PROFILE.reMintDroppedFlag = true
    })

    PROFILE.checksMs = now() - checksT0

    runner.summary('preserve-reversal-scenarios')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.mintMs + PROFILE.reverseMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[preserve-reversal:profile] preservedShipped=${PROFILE.preservedShipped} ` +
      `descendantsShipped=${PROFILE.descendantsShipped} ` +
      `flagStillSet=${PROFILE.flagStillSet} reMintDroppedFlag=${PROFILE.reMintDroppedFlag} ` +
      `mint=${f(PROFILE.mintMs)}ms reverse=${f(PROFILE.reverseMs)}ms ` +
      `checks=${f(PROFILE.checksMs)}ms ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__preserveReversalScenariosProfile = PROFILE
  }

  globalThis.__preserveReversalScenariosDone = main().catch((e) => {
    console.error('preserve-reversal-scenarios failed:', e)
    runner.summary('preserve-reversal-scenarios')
  })
}
