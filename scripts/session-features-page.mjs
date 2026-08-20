// session-features-page.mjs — builder for demo/session-features.html (13 mounts).
// Reads the template, embeds the envelope map + server data JSON, writes the page.
// Runs at module top-level so importing it in build-demo.mjs builds the page.
// The expected census is computed by the IDENTICAL core pipeline the page runs
// (translate → register → ONE bootstrap compile), so the smoke's equality pin
// holds.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { sessionFeaturesEnvelopes } from '../demo/session-features-data.js'

const here = dirname(fileURLToPath(import.meta.url))
const templatePath = join(here, '..', 'demo', 'session-features.template.html')
const outPath = join(here, '..', 'demo', 'session-features.html')

function censusOf(sup) {
  const all = sup.allNodes()
  return {
    registered: all.length,
    inTree: all.filter(n => !n.destroyed && n.isInTree).length,
    unplaced: all.filter(n => !n.destroyed && n.state === 'unplaced').length,
    destroyed: all.filter(n => n.destroyed).length,
    prototypes: all.filter(n => n.state === 'prototype').length,
    cloneOps: 0
  }
}

function computeExpectedCensus() {
  const envelopes = sessionFeaturesEnvelopes()
  const census = { registered: 0, inTree: 0, unplaced: 0, destroyed: 0, prototypes: 0, cloneOps: 0 }
  for (const key of Object.keys(envelopes)) {
    const translated = translateLegacy(envelopes[key])
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of translated.nodes) sup.registerNode(n)
    translated.root.compile(translated.nodes)
    const c = censusOf(sup)
    for (const k of Object.keys(census)) census[k] += c[k]
  }
  return census
}

export async function buildSessionFeaturesPage() {
  const template = await readFile(templatePath, 'utf8')
  const envelopes = sessionFeaturesEnvelopes()
  const serverData = {
    expected: { census: computeExpectedCensus(), mounts: Object.keys(envelopes).length },
    goals: [
      'S1.1 provider-colored badge: scalar append, host class first, injected after',
      'S1.2 array-form multi-class injection: array order preserved, host-first',
      'S1.3 missing/unresolved source: keeps authored list (omit, never wipes)',
      'S1.4 blocked css targets: warn + skip (component-target-skipped), never throw',
      'S1.5 reverse round-trip: target: css.classes persists warning-free',
      'S2.1 self-removing handler: retained listener present + first-click write (self-removal not pipeline-reachable — recorded finding)',
      'S2.2 element removal purges the retained listener (removeEl → DOM-F7)',
      'S3.1 engine dispatch drives a data-authored control (event.value passthrough)',
      'S3.2 fork-arm wire once-fire with all arms in ctx.states',
      'S3.3 unknown/destroyed targets are safe no-ops',
      'S3.4 read-only dispatch re-renders nothing; an apply re-renders',
      'S3.5 no propagation: only the target handler fires',
      'S3.6 same-(node,event) reentrancy no-ops; a different event fires'
    ]
  }
  const html = template
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(envelopes))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  await writeFile(outPath, html)
  const c = serverData.expected.census
  console.log(
    `[session-features:build] wrote demo/session-features.html (${serverData.expected.mounts} mounts) ` +
    `census(registered=${c.registered} inTree=${c.inTree} unplaced=${c.unplaced} destroyed=${c.destroyed} prototypes=${c.prototypes} cloneOps=${c.cloneOps})`
  )
  return outPath
}

await buildSessionFeaturesPage()
