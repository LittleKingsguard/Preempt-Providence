// producing-host-page.mjs — builder for demo/producing-host.html (5 mounts).
// Reads the template, embeds the envelope map + server data JSON, writes the page.
// Runs at module top-level so importing it in build-demo.mjs builds the page.
// The expected census is computed by the IDENTICAL core pipeline the page runs
// (translate → register → ONE bootstrap compile), so the smoke's equality pin holds.
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { producingHostEnvelopes } from '../demo/producing-host-data.js'

const here = dirname(fileURLToPath(import.meta.url))
const templatePath = join(here, '..', 'demo', 'producing-host.template.html')
const outPath = join(here, '..', 'demo', 'producing-host.html')

// Mount key → envelope key mapping (mirrors the page module's MOUNTS array).
// Multiple mounts may share one envelope (e.g. optin/default/controls all use twoNode).
const MOUNT_KEYS = ['twoNode', 'twoNode', 'chain', 'prune', 'twoNode']

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
  const envelopes = producingHostEnvelopes()
  const census = { registered: 0, inTree: 0, unplaced: 0, destroyed: 0, prototypes: 0, cloneOps: 0 }
  for (const key of MOUNT_KEYS) {
    const translated = translateLegacy(envelopes[key])
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of translated.nodes) sup.registerNode(n)
    translated.root.compile(translated.nodes)
    const c = censusOf(sup)
    for (const k of Object.keys(census)) census[k] += c[k]
  }
  return census
}

export async function buildProducingHostPage() {
  const template = await readFile(templatePath, 'utf8')
  const envelopes = producingHostEnvelopes()
  const serverData = {
    expected: { census: computeExpectedCensus(), mounts: MOUNT_KEYS.length },
    goals: [
      'S4.1 opt-in threading: data-node-id on every emitted element, real nodeById key',
      'S4.2 default off: no data-node-id, byte-identical render',
      'S4.3 prevMap chain: incremental re-render keeps stamping, zero-op on no change',
      'S4.4 destroy-prune: destroyed wire removed, never re-created; survivors keep stamp',
      'controls: barrel export identity; op stream == adapter call log'
    ]
  }
  const html = template
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(envelopes))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  await writeFile(outPath, html)
  const c = serverData.expected.census
  console.log(
    `[producing-host:build] wrote demo/producing-host.html (${serverData.expected.mounts} mounts) ` +
    `census(registered=${c.registered} inTree=${c.inTree} unplaced=${c.unplaced} destroyed=${c.destroyed} prototypes=${c.prototypes} cloneOps=${c.cloneOps})`
  )
  return outPath
}

await buildProducingHostPage()
