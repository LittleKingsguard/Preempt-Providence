// legacy-shape-page — builder for demo/legacy-shape.html +
// demo/legacy-shape.expected.html
//
// The REAL-LEGACY-SHAPE regression page (fix-pass plan item 5; the D1–D8
// live-prod legacy-shape dispositions). Embeds the LEGACY envelope (the
// blind-test translate-stack fixture, adapted) as preempt-initial-data + the
// expected census / PAR-5 shape signature / K4 side-card envelopes + their
// SSR fragments as server-data. The SSR expected fragments are produced
// through the documented core path — translateLegacy -> Supervisor -> register
// -> ONE per-node compilePath bootstrap (the placement-path pipeline: the
// fixture is placement-routed) -> recordResolved(actionable) ->
// emitElements -> diffMinimal(null, els) -> applyOps(new SSRFragmentAdapter())
// -> toString() — so the expected page is the SAME envelope through the real
// SSRFragmentAdapter (PAR-5 parity).

import { readFileSync, writeFileSync } from 'node:fs'
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { diffMinimal } from '../dist/core/render.js'
import { emitElements, applyOps } from '../dist/core/render-helpers.js'
import { SSRFragmentAdapter } from '../dist/core/adapters.js'
import {
  legacyShapeEnvelope,
  legacyShapeSideCardEnvelopes,
  legacyShapeServerData,
} from '../demo/legacy-shape.js'

const here = new URL('.', import.meta.url)
const demo = (name) => new URL(`../demo/${name}`, here)

/** The documented core pipeline on one legacy envelope → SSR fragment. */
function ssrFragment(doc) {
  const translated = translateLegacy(doc)
  const supervisor = new Supervisor({})
  for (const n of translated.nodes) supervisor.registerNode(n)
  const actionable = []
  for (const n of translated.nodes) actionable.push(...n.compilePath().actionable)
  supervisor.recordResolved(actionable)
  const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = emitElements(actionable, byNode)
  const ops = diffMinimal(null, els)
  const adapter = new SSRFragmentAdapter()
  applyOps(adapter, ops)
  return adapter.toString()
}

const data = legacyShapeEnvelope()
const serverData = legacyShapeServerData()

const fragment = ssrFragment(data)
serverData.expectedHtml = fragment

const side = legacyShapeSideCardEnvelopes()
serverData.sideCards = {
  entryInvalid: side.entryInvalid,
  payloadObsolete: side.payloadObsolete,
  expectedEntryInvalid: ssrFragment(side.entryInvalid),
  expectedPayloadObsolete: ssrFragment(side.payloadObsolete),
}

const template = readFileSync(demo('legacy-shape.template.html'), 'utf8')
const html = template
  .replace('__PREEMPT_INITIAL_DATA__', JSON.stringify(data))
  .replace('__SERVER_DATA__', JSON.stringify(serverData))
  .replace('__SR_EXPECTED__', escapeHtml(fragment))

writeFileSync(demo('legacy-shape.html'), html)

const entryInvalidWarnings = translateLegacy(side.entryInvalid).warnings
  .map((w) => `${w.code} @ ${w.path}`).join('\n')
const payloadObsoleteWarnings = translateLegacy(side.payloadObsolete).warnings
  .map((w) => `${w.code} @ ${w.path}`).join('\n')

// the expected page: the SSR fragments pre-filled into every mount + the
// warnings channels pre-filled — the page is complete without any JS.
const expectedHtml = html
  .replace('<div id="app"></div>', `<div id="app">${fragment}</div>`)
  .replace(
    '<div class="side-card-mount" id="invalid-entry-mount"></div>',
    `<div class="side-card-mount" id="invalid-entry-mount">${serverData.sideCards.expectedEntryInvalid}</div>`,
  )
  .replace(
    '<div class="side-card-mount" id="obsolete-payload-mount"></div>',
    `<div class="side-card-mount" id="obsolete-payload-mount">${serverData.sideCards.expectedPayloadObsolete}</div>`,
  )
  .replace('<pre class="warnings" id="invalid-entry-mount-warnings"></pre>', `<pre class="warnings" id="invalid-entry-mount-warnings">${entryInvalidWarnings}</pre>`)
  .replace('<pre class="warnings" id="obsolete-payload-mount-warnings"></pre>', `<pre class="warnings" id="obsolete-payload-mount-warnings">${payloadObsoleteWarnings}</pre>`)
  .replace('<script type="module" src="legacy-shape.js"></script>', '')

writeFileSync(demo('legacy-shape.expected.html'), expectedHtml)

console.log(`[legacy-shape:build] wrote demo/legacy-shape.html + demo/legacy-shape.expected.html`);
console.log(`[legacy-shape:build] main envelope SSR fragment: ${fragment.length} chars`);
console.log(`[legacy-shape:build] side-card warns: ${entryInvalidWarnings.split('\n').join(' | ')} | ${payloadObsoleteWarnings.split('\n').join(' | ')}`);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
