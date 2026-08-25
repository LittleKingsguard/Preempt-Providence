// rows-scenarios-page — builder for demo/rows-scenarios.html
//
// The rows demo gate (docs/next-feature-batch-0.2.0.md §Feature 1.5) + the
// Feature 1a round-trip arm: embeds the ONE legacy envelope (a root + a
// consumers section, the hooksKind declaration, the def prototype, the
// cross-row consumers) as preempt-initial-data + the expected census + the
// fan-out pin as server-data.
//
// The expected census/fan-out is produced by the SAME core pipeline the page
// runs (translate -> register -> compile -> recordResolved -> the mint CLICK
// dispatch through the real function-STRING handler seam -> flush) minus the
// DOM render — the page publishes its OWN measured census + fan-out pin
// (captured post-mint) and the smoke pins equality, so the census can never
// silently drift.

import { readFile, writeFile } from 'node:fs/promises'
import { rowsScenariosEnvelopes } from '../demo/rows-scenarios.data.js'
import { rowsScenariosServerData } from '../demo/rows-scenarios.js'

const here = new URL('.', import.meta.url)
const demo = (name) => new URL(`../demo/${name}`, here)

export async function buildRowsScenariosPage() {
  const envelopes = rowsScenariosEnvelopes()
  const serverData = await rowsScenariosServerData()
  const template = await readFile(demo('rows-scenarios.template.html'), 'utf8')
  const html = template
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(envelopes))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
  await writeFile(demo('rows-scenarios.html'), html)
  return { html, envelopes, serverData }
}

const { serverData } = await buildRowsScenariosPage()
const c = serverData.expected.census
console.log(`[rows-scenarios:build] wrote demo/rows-scenarios.html (1 mount: rows-mint drive + 3 cross-row consumers)`);
console.log(`[rows-scenarios:build] expected census registered=${c.registered} inTree=${c.inTree} unplaced=${c.unplaced} destroyed=${c.destroyed} prototypes=${c.prototypes} cloneOps=${c.cloneOps} fanoutRows=${serverData.expected.fanoutRows} fanoutStates=${serverData.expected.fanoutStates}`);