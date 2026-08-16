// handlers-scenarios-page — builder for demo/handlers-scenarios.html
//
// Blind test #5 (docs/specs/handlers-scenarios.md): the mocked real-world
// handler scenarios through the LANDED legacy-handler surface. Embeds the
// LEGACY envelopes (keyed by mount: anon / alice — scenario 1's two userData
// variants — + main — scenarios 2-10) as preempt-initial-data + the expected
// census as server-data.
//
// The expected census is produced by the SAME core pipeline the page runs
// (translate -> register -> compile -> recordResolved -> the after-compile
// PHASE dispatch on phase-bearing nodes -> flush -> the page-load 'load'
// dispatch -> flush) minus the DOM render — the page publishes its OWN
// measured census (captured pre-interaction) and the smoke pins equality, so
// the census can never silently drift.

import { readFile, writeFile } from 'node:fs/promises'
import { handlersScenariosEnvelopes, handlersScenariosServerData } from '../demo/handlers-scenarios.js'

const here = new URL('.', import.meta.url)
const demo = (name) => new URL(`../demo/${name}`, here)

export async function buildHandlersScenariosPage() {
  const envelopes = handlersScenariosEnvelopes()
  const serverData = await handlersScenariosServerData()
  const template = await readFile(demo('handlers-scenarios.template.html'), 'utf8')
  const html = template
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(envelopes))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  await writeFile(demo('handlers-scenarios.html'), html)
  return { html, envelopes, serverData }
}

const { serverData } = await buildHandlersScenariosPage()
const c = serverData.expected.census
console.log(`[handlers-scenarios:build] wrote demo/handlers-scenarios.html (3 mounts: anon/alice/main)`);
console.log(`[handlers-scenarios:build] expected census registered=${c.registered} inTree=${c.inTree} unplaced=${c.unplaced} destroyed=${c.destroyed} prototypes=${c.prototypes} cloneOps=${c.cloneOps}`);
