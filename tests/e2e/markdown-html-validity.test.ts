/**
 * Step 7 e2e — Markdown→HTML output validity (docs/subagents.md Step 7).
 *
 * Builds the markdown-display scenario (editor textarea source + display with
 * an after-compile handler that parses `**bold**` into a structured strong
 * element), then runs the REAL compile → diffMinimal → applyOps →
 * SSRFragmentAdapter pipeline and validates the ACTUAL emitted HTML:
 *   - the structured strong element serializes as a real `<strong>…</strong>`
 *   - markdown source text that stays text is escaped/preserved correctly
 *   - the output is well-formed per the describe-A checks (validateHtml)
 */
import { describe, it, expect } from 'vitest'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { diffMinimal, type RenderOp } from '../../src/core/render.js'
import { minimalFromState } from '../../src/core/render-helpers.js'
import { makeRoot, makeNode, childOf, hub } from '../helpers/fixtures.js'
import { dispatchEvent } from '../../src/core/handlers.js'
import { renderOps, validateHtml, splitStylesPrefix } from './ssr-html-validity-helpers.js'
import type { HandlerContext } from '../../src/core/handlers.js'

async function flushTicks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0))
}

function buildMarkdown() {
  const root = makeRoot({ type: 'app' })
  const editor = childOf(root, makeNode({ type: 'textarea', content: 'Hello **world**!' }), 0)
  const display = childOf(root, makeNode({ type: 'div' }), 1)
  const part0 = childOf(display, makeNode({ type: 'span', content: '' }), 0)
  const part1 = childOf(display, makeNode({ type: 'strong', content: '' }), 1)
  const part2 = childOf(display, makeNode({ type: 'span', content: '' }), 2)
  return { root, editor, display, part0, part1, part2 }
}

/** Split on the first **bold** pair: prefix / bold / suffix. */
function parseBold(md: string): { prefix: string; bold: string; suffix: string } {
  const m = /^(.*?)\*\*([^*]+)\*\*(.*)$/.exec(md)
  if (!m) return { prefix: md, bold: '', suffix: '' }
  return { prefix: m[1]!, bold: m[2]!, suffix: m[3]! }
}

function newSystem(f: ReturnType<typeof buildMarkdown>) {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  for (const n of [f.root, f.editor, f.display, f.part0, f.part1, f.part2]) supervisor.registerNode(n)
  const ctx = supervisor.handlerContext
  f.display.addLayer({
    id: 'md-handler',
    handlers: [
      {
        name: 'markdown:render',
        phase: 'after-compile',
        body: (c: unknown) => {
          const cc = c as HandlerContext
          const src = String(cc.tree.getNode(f.editor.id)?.content ?? '')
          const { prefix, bold, suffix } = parseBold(src)
          cc.clientAPI.apply(f.part0.id, [{ targetProp: 'content', mode: 'replace', value: prefix }])
          cc.clientAPI.apply(f.part1.id, [{ targetProp: 'content', mode: 'replace', value: bold }])
          cc.clientAPI.apply(f.part2.id, [{ targetProp: 'content', mode: 'replace', value: suffix }])
        },
      },
    ],
  })
  f.editor.addLayer({
    id: 'input-handler',
    handlers: [
      {
        name: 'input',
        event: 'input',
        body: (c: unknown, value: unknown) => {
          const cc = c as HandlerContext
          cc.clientAPI.apply(f.editor.id, [{ targetProp: 'content', mode: 'replace', value: String(value ?? '') }])
          cc.clientAPI.apply(f.display.id, [{ targetProp: 'props.tick', mode: 'replace', value: 1 }])
        },
      },
    ],
  })
  return { supervisor, clientAPI: createClient(supervisor), ctx }
}

/** Type `source` into the editor, run the handler passes, and render to HTML. */
async function renderMarkdown(source: string): Promise<string> {
  const f = buildMarkdown()
  const { supervisor, ctx } = newSystem(f)
  supervisor.clientAPI.apply(f.display.id, [{ targetProp: 'props.init', mode: 'replace', value: true }])
  await flushTicks()
  dispatchEvent(f.editor, ctx, 'input', source)
  await flushTicks()
  const slice = [f.root, f.editor, f.display, f.part0, f.part1, f.part2]
  const ops = diffMinimal(null, f.root.compile(slice).actionable.map(minimalFromState))
  return renderOps(ops)
}

describe('e2e — Markdown→HTML output validity', () => {
  it('MD-V1 the structured strong element renders as a real <strong>…</strong> in the emitted HTML', async () => {
    const html = await renderMarkdown('**hello** world')
    const { body } = splitStylesPrefix(html)
    // part1 is a `strong` node whose content is the bold slice — it must
    // serialize as an actual strong element containing the escaped text
    expect(body).toContain('<strong')
    expect(body).toContain('>hello</strong>')
    // the editor source (markdown that stays text) is preserved in the textarea
    expect(body).toContain('>**hello** world</textarea>')
  })

  it('MD-V2 markdown source text is escaped/preserved correctly (no raw < or & survives)', async () => {
    const html = await renderMarkdown('**<b>hi</b>** & "q"')
    const { body } = splitStylesPrefix(html)
    // bold slice `<b>hi</b>` is text content of the strong element → escaped
    expect(body).toContain('<strong')
    expect(body).toContain('>&lt;b&gt;hi&lt;/b&gt;</strong>')
    // suffix ` & "q"` stays text: & → &amp;; " is left verbatim in text (escapeText)
    expect(body).toContain('&amp; "q"')
    // the editor source itself is escaped in the textarea
    expect(body).toContain('**&lt;b&gt;hi&lt;/b&gt;** &amp; "q"')
    expect(body).not.toContain('<b>hi</b>')
    expect(body).not.toContain('& "q"')
  })

  it('MD-V3 the emitted HTML is well-formed per the describe-A checks', async () => {
    const html = await renderMarkdown('**bold** & <x> "y"')
    expect(validateHtml(html)).toEqual([])
  })
})
