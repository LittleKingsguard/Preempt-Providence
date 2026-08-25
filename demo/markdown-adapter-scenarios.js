/**
 * markdown-adapter-scenarios — MarkdownAdapter demo (Feature 2, D14 landing).
 *
 * Exercises the MarkdownAdapter through `renderProducingProcess(…, adapter)`
 * with a legacy-JSON-envelope-driven page. The document contains D3 closed
 * types used in the demo: h1, h2, p (with strong/em/link), blockquote>p,
 * div>ul>li (with nested ol), pre (fenced), hr, img.
 *
 * Pipeline: translateLegacy → register → compile → renderProducingProcess
 * → applyOps → adapter.toString() → display.
 *
 * Runner checks assert the markdown output contains expected content for
 * each section.
 *
 * Banner: `markdown-adapter-scenarios`; profile line
 * `[markdown-adapter:profile]`; globals `__markdownAdapterScenariosDone` +
 * `__markdownAdapterScenariosProfile`.
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { MarkdownAdapter } from '../dist/core/adapters.js'
import { renderProducingProcess, applyOps } from '../dist/core/render-helpers.js'
import { makeRunner } from './lib/runner.js'

// ============================================================================
// PAGE — browser module (runs only when a DOM is present).
// ============================================================================

if (typeof document !== 'undefined') {
  const runner = makeRunner()
  document.getElementById('results').appendChild(runner.el)

  const payload = JSON.parse(document.getElementById('preempt-initial-data').textContent.trim())
  const serverData = JSON.parse(document.getElementById('server-data').textContent.trim())

  const PROFILE = {
    loadMs: 0, compileMs: 0, emitMs: 0, applyMs: 0,
    checksMs: 0, totalMs: 0, coveredMs: 0, renderCount: 0, compileCalls: 0,
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }

  // ---- the single mount ----------------------------------------------------
  const translated = acc('loadMs', () => translateLegacy(payload.main))
  const events = new EventBridge()
  const sup = new Supervisor({ events })
  for (const n of translated.nodes) sup.registerNode(n)
  if (translated.warnings.length > 0) console.warn('markdown-adapter-scenarios translate warnings:', translated.warnings)

  const adapter = new MarkdownAdapter()
  let prevMap = null

  function bootstrap() {
    const cr = acc('compileMs', () => translated.root.compile(translated.nodes))
    PROFILE.compileCalls += 1
    sup.recordResolved(cr.actionable)
    return cr
  }

  function renderMarkdown(cr) {
    const nodeById = new Map(sup.allNodes().map((n) => [n.id, n]))
    const r = acc('emitMs', () => renderProducingProcess(cr.actionable, nodeById, adapter, prevMap))
    prevMap = r.prevMap
    PROFILE.renderCount += 1
    return adapter.toString()
  }

  async function main() {
    const cr = bootstrap()
    const mdOutput = renderMarkdown(cr)

    // Display the markdown output
    const outputEl = document.getElementById('markdown-output')
    if (outputEl) outputEl.textContent = mdOutput

    const checksT0 = now()

    // ---- M1 — headings -----------------------------------------------------
    await runner.check('M1: headings — h1 renders with # marker, h2 renders with ## marker', () => {
      if (!mdOutput.includes('# Markdown Adapter Demo')) throw new Error('h1 missing')
      if (!mdOutput.includes('## Inline Content')) throw new Error('h2 "Inline Content" missing')
      if (!mdOutput.includes('## Blockquote')) throw new Error('h2 "Blockquote" missing')
      if (!mdOutput.includes('## List with Nesting')) throw new Error('h2 "List with Nesting" missing')
      if (!mdOutput.includes('## Code Block')) throw new Error('h2 "Code Block" missing')
      if (!mdOutput.includes('## Image')) throw new Error('h2 "Image" missing')
    })

    // ---- M2 — inline content ------------------------------------------------
    await runner.check('M2: inline content — strong renders **bold**, em renders *italic*, a renders [text](href "title")', () => {
      if (!mdOutput.includes('**bold**')) throw new Error('strong missing')
      if (!mdOutput.includes('*italic*')) throw new Error('em missing')
      if (!mdOutput.includes('[link with title](http://example.com "a bold link")')) throw new Error('link with title missing')
    })

    // ---- M3 — blockquote ----------------------------------------------------
    await runner.check('M3: blockquote — blockquote wraps its paragraph content with > prefix', () => {
      if (!mdOutput.includes('> This is a blockquote containing a paragraph.')) throw new Error('blockquote missing')
    })

    // ---- M4 — list nesting --------------------------------------------------
    await runner.check('M4: list nesting — div (transparent container) wraps ul>li with nested ol inside one li', () => {
      if (!mdOutput.includes('- First item')) throw new Error('ul li 1 missing')
      if (!mdOutput.includes('- Second item with nested list')) throw new Error('ul li 2 missing')
      if (!mdOutput.includes('- Third item')) throw new Error('ul li 3 missing')
      if (!mdOutput.includes('  1. Nested ordered one')) throw new Error('nested ol 1 missing')
      if (!mdOutput.includes('  2. Nested ordered two')) throw new Error('nested ol 2 missing')
    })

    // ---- M5 — fenced pre ----------------------------------------------------
    await runner.check('M5: fenced pre — pre renders as a fenced code block with LITERAL content (no backslash escaping — MD-PRE-ESCAPE)', () => {
      if (!mdOutput.includes('```')) throw new Error('fence markers missing')
      if (!mdOutput.includes('function hello() {')) throw new Error('pre content missing or escaped')
      if (mdOutput.includes('function hello\\(')) throw new Error('pre content was escaped (stray backslash)')
    })

    // ---- M6 — hr ------------------------------------------------------------
    await runner.check('M6: hr — hr renders as ---', () => {
      if (!mdOutput.includes('---')) throw new Error('hr marker missing')
    })

    // ---- M7 — img -----------------------------------------------------------
    await runner.check('M7: img — img renders as ![alt](src)', () => {
      if (!mdOutput.includes('![Example image](http://example.com/image.png)')) throw new Error('img missing')
    })

    PROFILE.checksMs = now() - checksT0

    runner.summary('markdown-adapter-scenarios')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.emitMs +
      PROFILE.applyMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[markdown-adapter:profile] renderCount=${PROFILE.renderCount} compileCalls=${PROFILE.compileCalls} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms apply=${f(PROFILE.applyMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__markdownAdapterScenariosProfile = PROFILE
  }

  globalThis.__markdownAdapterScenariosDone = main().catch((e) => {
    console.error('markdown-adapter-scenarios failed:', e)
    runner.summary('markdown-adapter-scenarios')
  })
}
