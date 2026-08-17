/**
 * Per-page demo-page runner for the smoke harness — runs ONE generated page's
 * module as a subprocess so its retained frame (supervisor + DOM tree +
 * prevMap, ~50MB+ at d14) is freed on exit instead of accumulating across pages
 * in the main smoke process (RCA: every page module instance keeps its whole
 * frame alive; a dozen stacked instances balloon the live heap to hundreds of
 * MB and each later page's allocations trigger full mark-sweep storms — 0.3s of
 * page work measured at 95s of wall time. Isolating per page makes the smoke
 * deterministic — AGENTS.md item-4 guards stay exact).
 *
 * Usage: node scripts/smoke-page-worker.mjs <resultFile> <pageHtmlPath>
 *        <modulePath> <query> <doneGlobal> <raceWindowMs>
 *
 * Seeds the page's embedded data into the shared shim (same as the inline
 * smoke), imports the module, waits for its async `done` global (with the same
 * race window the inline smoke uses), then writes the page's PROFILE object as
 * JSON to <resultFile>. The page's own `[xxx:profile]` console lines stream
 * verbatim. Exit code: 0 when the page's done-global produced a profile; 1
 * when it threw, timed out, or left no profile.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { installSmokeShim } from './smoke-shim.mjs'

const { seedPage, collectBanners } = installSmokeShim()

const [resultFile, pageHtmlPath, modulePath, query, doneGlobal, raceWindowMs] = process.argv.slice(2)
if (!pageHtmlPath || !modulePath || !doneGlobal) {
  console.error(`[smoke-worker] usage: <resultFile> <pageHtml> <module> <query> <doneGlobal> <raceMs>`)
  process.exit(1)
}

const base = fileURLToPath(new URL('../', import.meta.url))
const html = await readFile(pageHtmlPath, 'utf8')
seedPage(html)
try {
  // cache-bust per instance; the module is fresh in this child process anyway,
  // the query is kept for symmetry with the inline smoke's distinct instances
  await import(`${modulePath}?${query}`)
} catch (e) {
  console.error(`[smoke-worker] module import failed for ${modulePath}?${query}:`, e)
  process.exit(1)
}
await Promise.race([
  globalThis[doneGlobal],
  new Promise((r) => setTimeout(r, Number(raceWindowMs ?? 60000))),
]).catch(() => {})

const profKey = doneGlobal.replace(/Done$/, 'Profile')
const profile = globalThis[profKey]
if (!profile) {
  console.error(`[smoke-worker] ${doneGlobal} produced no ${profKey} — page did not finish profiling`)
  process.exit(1)
}
await writeFile(resultFile, JSON.stringify({ profile, banners: collectBanners() }), 'utf8')
process.exit(0)