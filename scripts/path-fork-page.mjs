/**
 * Static placement-path page builder — emits ONE page
 * (demo/path-fork-data.html) from the static re-expression envelope
 * (placement-path-spec §5): root + 22 prototypes with placement links
 * (placementName producers + targetPlacement consumers — the R2.2
 * sibling-shared owner-name topology), compiled by the §2 path enumeration
 * (4095 path-states, ONE pass, no clone-instance).
 *
 * Embeds the LEGACY envelope as `preempt-initial-data` and the server
 * reference (expected census + the PAR-5 shape signature) as `server-data`.
 * The full 4095-element SSR snapshot is NOT embedded (it is ~180MB — the
 * nested binary tree serializes O(n·depth)); parity is verified by the
 * wire-agnostic shape signature at runtime, and the expected section shows
 * a truncated sample of the builder's SSR fragment. The browser module
 * (demo/path-fork-data.js) is core-only + legacy data.
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathForkLegacyData, pathForkServerData, pathForkSsrSample } from '../demo/path-fork-data.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Build the embedded data + server reference + SSR expected sample. */
export async function buildPathForkPage() {
  const initialData = pathForkLegacyData()
  const serverData = pathForkServerData()
  // cheap sample: render only the FIRST ops (root element + early structure)
  // through the SSRFragmentAdapter — never the full ~190MB 4095-element
  // fragment (O(n·depth) serialization; parity is the hashed shape signature)
  const sample = pathForkSsrSample(300)
  serverData.expectedSsrSample = sample
  const template = await readFile(join(ROOT, 'demo', 'path-fork-data.template.html'), 'utf8')
  const html = template
    .replaceAll('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(initialData))
    .replaceAll('__SERVER_DATA__', () => JSON.stringify(serverData))
    .replaceAll('__SR_EXPECTED__', () => sample
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
  return { html, initialData, serverData, ssrHtml: sample }
}
