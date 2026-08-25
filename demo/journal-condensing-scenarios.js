/**
 * journal-condensing-scenarios — the Feature 3 bounded-journal demo
 * (docs/specs/handoffs-review-8.md D1-D10, decisions.md JOURNAL-CONDENSING
 * row, 2026-08-25).
 *
 * Demonstrates the auto-condensing Supervisor journal: a `maxJournalLength`
 * init, a state-slice stream that exceeds the threshold, the deferred
 * microtask condense (pre-base entries → ONE `base` marker), the base marker's
 * `{kind:'base', snapshot}` shape, a replay-from-base (graph-REPLACE restore
 * + post-base re-apply), and the post-base undo (D3 id-resolution to the
 * restored graph).
 *
 * Banner: `journal-condensing-scenarios`; profile line
 * `[journal-condensing:profile]`; globals `__journalCondensingScenariosDone` +
 * `__journalCondensingScenariosProfile`.
 */
import { Node, Supervisor } from '../dist/core/node.js'
import { EventBridge } from '../dist/core/events.js'
import { Link } from '../dist/core/link.js'
import { hub } from './demo-fixtures.js'
import { makeRunner } from './lib/runner.js'

function flushCondense() {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

/** A root on the SHARED hub (the rootNode token — the condense root-detection
 *  needs it; the fixture makeRoot uses its OWN hub). */
function sharedRoot(h, id) {
  const root = new Node({ type: 'app', content: 'A0' }, h, id)
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
    loadMs: 0, applyMs: 0, condenseMs: 0, replayMs: 0, undoMs: 0,
    checksMs: 0, totalMs: 0, coveredMs: 0, renderCount: 0,
    journalBefore: 0, journalAfter: 0, baseMarkers: 0, postBaseEntries: 0,
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
    const sup = new Supervisor({ hub: h, events, maxJournalLength: 3 })

    const root = sharedRoot(h, 'root')
    sup.registerNode(root)

    const journalBox = document.getElementById('journal-box')
    const stateBox = document.getElementById('state-box')
    function render() {
      journalBox.textContent = sup.journal.map((e) => `${e.id} ${e.op.kind}`).join('\n')
      stateBox.textContent = `content: ${String(sup.getNode(root.id)?.content ?? '')}`
    }

    // ---- a state-slice stream that exceeds the threshold -------------------
    for (let i = 1; i <= 6; i += 1) {
      acc('applyMs', () => sup.apply({
        kind: 'state-slice',
        node: root,
        mutation: [{ targetProp: 'content', mode: 'replace', value: `A${i}` }],
      }))
    }
    PROFILE.journalBefore = sup.journal.length
    render()

    // ---- the deferred condense fires on the microtask ----------------------
    await acc('condenseMs', async () => { await flushCondense() })
    PROFILE.journalAfter = sup.journal.length
    PROFILE.baseMarkers = sup.journal.filter((e) => e.op.kind === 'base').length
    PROFILE.postBaseEntries = sup.journal.filter((e) => e.op.kind !== 'base').length
    render()

    // ---- checks ------------------------------------------------------------
    const checksT0 = now()

    await runner.check('condense: the journal collapsed to ONE base marker + the post-base entries', () => {
      if (PROFILE.baseMarkers !== 1) throw new Error(`baseMarkers=${PROFILE.baseMarkers}`)
      if (PROFILE.journalAfter >= PROFILE.journalBefore) throw new Error(`journal did not shrink: ${PROFILE.journalBefore} -> ${PROFILE.journalAfter}`)
    })

    await runner.check('base marker shape: {kind:"base", snapshot} with result {status:"base"}', () => {
      const base = sup.journal.find((e) => e.op.kind === 'base')
      if (!base) throw new Error('no base marker')
      if (base.result?.status !== 'base') throw new Error(`base result=${JSON.stringify(base.result)}`)
      const snapshot = base.op?.snapshot
      if (!snapshot || typeof snapshot.template !== 'object' || !Array.isArray(snapshot.content)) {
        throw new Error('base snapshot is not a SerializedRenderDoc')
      }
    })

    await runner.check('replay-from-base: the graph-REPLACE restore + post-base re-apply reproduces the post-stream state', async () => {
      const preReplay = sup.getNode(root.id)
      acc('replayMs', () => sup.replay())
      await flushCondense()
      const restored = sup.getNode(root.id)
      if (restored === preReplay) throw new Error('replay did not graph-REPLACE (same node object)')
      if (restored.content !== 'A6') throw new Error(`restored content=${String(restored.content)}`)
    })

    await runner.check('post-base undo (D3): the inverse operates on the restored graph', async () => {
      // a post-base op, then undo it — the inverse must target the restored graph
      sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'B1' }] })
      acc('undoMs', () => sup.undo())
      await flushCondense()
      const after = sup.getNode(root.id)
      if (after.content !== 'A6') throw new Error(`post-base undo left content=${String(after.content)} (expected A6)`)
    })

    PROFILE.checksMs = now() - checksT0

    runner.summary('journal-condensing-scenarios')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.applyMs + PROFILE.condenseMs + PROFILE.replayMs + PROFILE.undoMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[journal-condensing:profile] journalBefore=${PROFILE.journalBefore} journalAfter=${PROFILE.journalAfter} ` +
      `baseMarkers=${PROFILE.baseMarkers} postBaseEntries=${PROFILE.postBaseEntries} ` +
      `apply=${f(PROFILE.applyMs)}ms condense=${f(PROFILE.condenseMs)}ms replay=${f(PROFILE.replayMs)}ms ` +
      `undo=${f(PROFILE.undoMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__journalCondensingScenariosProfile = PROFILE
  }

  globalThis.__journalCondensingScenariosDone = main().catch((e) => {
    console.error('journal-condensing-scenarios failed:', e)
    runner.summary('journal-condensing-scenarios')
  })
}
