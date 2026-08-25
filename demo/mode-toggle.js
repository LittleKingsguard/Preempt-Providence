/**
 * Mode-toggle browser page — toggles between the SSR, client, and markdown
 * adapter modes for the same feature-matrix document.
 *
 * The server serves this page per `?mode=` (scripts/serve-demo.mjs →
 * scripts/mode-toggle-page.mjs). This module:
 *   1. reveals the mode-specific section the server embedded
 *      (SSR: full HTML received; markdown: raw source);
 *   2. highlights the active toggle;
 *   3. drives the shared feature-matrix harness (demo/lib/feature-matrix-tests.js)
 *      with the mode's extra assertions — the exact checks the feature-matrix
 *      page runs, plus mode-specific ones.
 */
import { runFeatureMatrixTests } from './lib/feature-matrix-tests.js'

const modeUrl = new URL(import.meta.url)
if (!modeUrl.search && globalThis.location?.search) modeUrl.search = globalThis.location.search
const requested = modeUrl.searchParams.get('mode')
const served = document.body?.dataset?.mode ?? 'client'
let mode = requested ?? served
// Every build of this page embeds BOTH mode payloads (SSR html string + raw
// markdown source), so ?mode= switching works under any static serve too.
// The fallback below is a safety net only for stale builds that lack a
// payload: it degrades to the mode the page actually carries.
if (mode === 'ssr' && !(document.getElementById('received-html-data')?.textContent ?? '').trim()) {
  console.info(`mode-toggle: ?mode=ssr requested but no SSR payload embedded; falling back to "${served}"`)
  mode = served
}
if (mode === 'markdown' && !(document.getElementById('markdown-source')?.textContent ?? '').trim()) {
  console.info(`mode-toggle: ?mode=markdown requested but no raw markdown embedded; falling back to "${served}"`)
  mode = served
}

// reveal the mode-specific section + highlight the toggle
const ssrReceived = document.getElementById('ssr-received')
const mdRaw = document.getElementById('markdown-raw')
if (ssrReceived) ssrReceived.hidden = mode !== 'ssr'
if (mdRaw) mdRaw.hidden = mode !== 'markdown'
if (typeof document.querySelectorAll === 'function') {
  for (const a of document.querySelectorAll('#mode-toggle a')) {
    if (a.dataset.mode === mode) a.classList.add('active')
  }
}

// SSR mode: show the raw received HTML in the inspection pane (the live mount
// next to it is the parsed document the server sent). The server embeds the raw
// string in a text/plain script element so it is available verbatim — the exact
// string the response body carries (devtools → Network → Response).
let receivedHtml = ''
if (mode === 'ssr') {
  const raw = document.getElementById('received-html-data')
  const pane = document.getElementById('received-html')
  if (raw) {
    receivedHtml = raw.textContent ?? ''
    if (pane) pane.textContent = receivedHtml
  }
}

// Markdown mode: mirror the embedded MarkdownAdapter output into the inspection
// pane (raw text/plain script → pre, like the SSR arm above).
let markdownAdapterOutput = ''
if (mode === 'markdown') {
  const raw = document.getElementById('markdown-adapter-data')
  const pane = document.getElementById('markdown-adapter-raw')
  if (raw) {
    markdownAdapterOutput = raw.textContent ?? ''
    if (pane) pane.textContent = markdownAdapterOutput
  }
}

const initialData = JSON.parse(document.getElementById('preempt-initial-data').textContent)
const serverData = JSON.parse(document.getElementById('server-data').textContent)

runFeatureMatrixTests({
  appEl: document.getElementById('app'),
  resultsEl: document.getElementById('results'),
  serverDocEl: document.getElementById('server-doc'),
  initialData,
  serverData,
  mode,
  receivedHtml,
  markdownSource: document.getElementById('markdown-source')?.textContent ?? '',
  markdownAdapterOutput,
  title: `Mode toggle — ${mode}`,
})