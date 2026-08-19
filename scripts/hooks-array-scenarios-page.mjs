// hooks-array-scenarios-page — builder for demo/hooks-array-scenarios.html
//
// The ROWS-MINT + CASCADE SPA page (docs/specs/hooks-array-injection-review.md
// §9 — CONTRACT AMENDMENT C): embeds the ONE legacy envelope as
// preempt-initial-data + the expected census as server-data.

import { readFile, writeFile } from 'node:fs/promises'
import { hooksArrayScenariosEnvelopes, hooksArrayScenariosServerData } from '../demo/hooks-array-scenarios.js'

const here = new URL('.', import.meta.url)
const demo = (name) => new URL(`../demo/${name}`, here)

export async function buildHooksArrayScenariosPage() {
  const envelopes = hooksArrayScenariosEnvelopes()
  const serverData = await hooksArrayScenariosServerData()
  const template = await readFile(demo('hooks-array-scenarios.template.html'), 'utf8')
  const html = template
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(envelopes))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  await writeFile(demo('hooks-array-scenarios.html'), html)
  return { html, envelopes, serverData }
}

const { serverData } = await buildHooksArrayScenariosPage()
const c = serverData.expected.census
console.log(`[hooks-array-scenarios:build] wrote demo/hooks-array-scenarios.html (1 SPA mount: rows-mint + cascade)`)
console.log(`[hooks-array-scenarios:build] expected census registered=${c.registered} inTree=${c.inTree} unplaced=${c.unplaced} destroyed=${c.destroyed} prototypes=${c.prototypes} cloneOps=${c.cloneOps}`)
