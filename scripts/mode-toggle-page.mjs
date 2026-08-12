/**
 * Mode-toggle page builder — the demo page that toggles between the SSR,
 * client, and markdown adapter modes. Used by
 *   - scripts/build-demo.mjs  (writes demo/mode-toggle.html, default client)
 *   - scripts/serve-demo.mjs  (serves the page dynamically per ?mode=)
 *
 * The page embeds the SAME feature-matrix document + server reference as
 * demo/feature-matrix.html (scripts/feature-matrix-server.mjs), so the shared
 * harness (demo/lib/feature-matrix-tests.js) drives the identical checks.
 *
 * Mode payloads — embedded in EVERY mode's page (not just the matching one),
 * so `?mode=` switching works under any static serve too:
 *   - SSR:      __SSR_HTML__ = the full HTML the server rendered through the
 *               real SSRFragmentAdapter (this is what the response body
 *               delivers — inspect the network tab), both as the parsed mount
 *               and as the raw string in `received-html-data`.
 *   - markdown: __MARKDOWN_RAW__ = the raw markdown editor source, embedded
 *               verbatim for manual inspection alongside the live display.
 * The body `data-mode` + `hidden` reveal state still render per-mode (the
 * dynamic serve additionally populates the live mount in SSR mode).
 */
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildFeatureMatrixPage, renderFeatureMatrixSsrHtml } from './feature-matrix-server.mjs'
import { demoData } from '../demo/feature-matrix-fixture.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const MODES = new Set(['ssr', 'client', 'markdown'])

/** The raw markdown the md-editor textarea ships (the display parses it). */
export function rawMarkdownSource() {
  const walk = (n) => {
    if (n.props?.id === 'md-editor') return n.props.value
    for (const c of n.children ?? []) {
      const v = walk(c)
      if (v !== undefined) return v
    }
    return undefined
  }
  const src = walk(demoData.template.root)
  return typeof src === 'string' ? src : 'Type **bold** here'
}

/** Escape `&<>"` for embedding raw markdown in HTML text. */
function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Build the mode-toggle page for the given mode.
 * @param {'ssr'|'client'|'markdown'} [mode]
 */
export async function buildModeTogglePage(mode = 'client') {
  if (!MODES.has(mode)) throw new Error(`unknown mode "${mode}" (expected ssr|client|markdown)`)
  const { doc, serverData } = buildFeatureMatrixPage()
  const template = await readFile(join(ROOT, 'demo', 'mode-toggle.template.html'), 'utf8')
  const ssrHtml = renderFeatureMatrixSsrHtml()
  const rawMarkdown = rawMarkdownSource()
  return template
    .replace('__MODE__', mode)
    .replace('__SSR_HIDDEN__', mode === 'ssr' ? '' : ' hidden')
    .replace('__MD_HIDDEN__', mode === 'markdown' ? '' : ' hidden')
    .replace('__SSR_HTML__', () => ssrHtml)
    .replace('__SSR_HTML_RAW__', () => ssrHtml)
    .replace('__MARKDOWN_RAW__', () => escHtml(rawMarkdown))
    .replace('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(doc))
    .replace('__SERVER_DATA__', () => JSON.stringify(serverData))
}