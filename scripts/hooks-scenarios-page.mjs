// hooks-scenarios-page — builder for demo/hooks-scenarios.html
//
// The VALUE-PROVIDER SLOT SPA page (docs/specs/hooks-map-review.md §7 —
// contract amendment B): embeds the ONE legacy envelope as
// preempt-initial-data + the expected census as server-data.
//
// The expected census is produced by the SAME core pipeline the page runs
// (translate -> register -> ONE bootstrap compile -> recordResolved) minus
// the DOM render — the page publishes its OWN measured census (captured
// pre-interaction) and the smoke pins equality, so the census can never
// silently drift.

import { readFile, writeFile } from 'node:fs/promises'
import { hooksScenariosEnvelopes, hooksScenariosServerData } from '../demo/hooks-scenarios.js'

const here = new URL('.', import.meta.url)
const demo = (name) => new URL(`../demo/${name}`, here)

export async function buildHooksScenariosPage() {
  const envelopes = hooksScenariosEnvelopes()
  const serverData = await hooksScenariosServerData()
  const template = await readFile(demo('hooks-scenarios.template.html'), 'utf8')
  const html = template
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(envelopes))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  await writeFile(demo('hooks-scenarios.html'), html)
  return { html, envelopes, serverData }
}

const { serverData } = await buildHooksScenariosPage()
const c = serverData.expected.census
console.log(`[hooks-scenarios:build] wrote demo/hooks-scenarios.html (1 SPA mount: theme/user/counter cards)`);
console.log(`[hooks-scenarios:build] expected census registered=${c.registered} inTree=${c.inTree} unplaced=${c.unplaced} destroyed=${c.destroyed} prototypes=${c.prototypes} cloneOps=${c.cloneOps}`);