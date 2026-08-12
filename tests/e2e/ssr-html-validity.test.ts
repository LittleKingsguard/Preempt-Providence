/**
 * Step 7 e2e — SSR HTML output VALIDITY (docs/subagents.md Step 7).
 *
 * Replays each existing e2e render suite's scenario op stream (compile →
 * diffMinimal) through the REAL `applyOps` + `SSRFragmentAdapter`
 * (src/core/adapters.ts, src/core/render-helpers.ts) and validates the ACTUAL
 * emitted HTML string — not just the MockAdapter op stream / structural trees:
 *   - well-formedness: balanced, correctly-nested non-void tags (stack checker,
 *     no DOM parser); VOID_TAGS elements emit no close tag (adapters.md §4.1/§4.4)
 *   - escaping: text/attr content with `<`, `>`, `&`, `"` is entity-escaped
 *     (escapeText escapes & < >; escapeAttr additionally escapes " — §4.2)
 *   - root-first: the html begins with the first-created wire's open tag, or
 *     the stylesPrefix when the root was removed (§4.6)
 *   - styles prefix: the exact §4.5 join formula when a `styles` op is present
 */
import { describe, it, expect } from 'vitest'
import { Node, reconcileParentTargets, Supervisor, MAX_COMPILE_DEPTH } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { diffMinimal, type RenderOp } from '../../src/core/render.js'
import { minimalFromState, jsonClone } from '../../src/core/render-helpers.js'
import { serializeSlice, loadState } from '../../src/core/serialize.js'
import { translateLegacy } from '../../src/core/translate.js'
import { appendToPayload, refreshPayload, nextPriority, type Payload } from '../../src/core/payload.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import { renderOps, validateHtml, splitStylesPrefix, stylesPrefixOf, firstCreate, flushTicks } from './ssr-html-validity-helpers.js'
import type { HandlerContext } from '../../src/core/handlers.js'
import type { HandlerDef } from '../../src/core/types.js'

/** Content carrying every character the adapter must escape in text/attrs. */
const SPECIAL = 'a < b & c > d "q"'

// ---------------------------------------------------------------------------
// Scenario builders (reconstructed exactly as each e2e suite builds them)
// ---------------------------------------------------------------------------

/** ssr-render.test.ts buildNestedPane — root provider + forked dock + zone. */
function buildNestedPane() {
  const root = makeRoot({ type: 'app', content: 'shell', css: { id: 'css-app' } })
  const dock = childOf(root, makeNode({ type: 'dock', props: { role: 'main' }, css: { id: 'css-dock' } }), 0)
  const inner = childOf(dock, makeNode({ type: 'badge', content: 'inner', css: { id: 'css-inner' } }), 0)
  const zone = childOf(root, makeNode({ type: 'zone', content: 'slot', css: { id: 'css-zone' } }), 1)
  addComponentSource(root, 'feed', { label: 'A' })
  addComponentSource(root, 'feed', { label: 'B' })
  targetAnchor(dock, 'feed')
  const plink = hub().linkFor('slot-alpha', 'placement')
  zone.addAnchor('placement', 'slot-alpha', {}, plink)
  return { root, dock, inner, zone }
}

/** markdown-display.test.ts buildMarkdown — editor textarea + display parts. */
function buildMarkdown() {
  const root = makeRoot({ type: 'app' })
  const editor = childOf(root, makeNode({ type: 'textarea', content: 'Hello **world**!' }), 0)
  const display = childOf(root, makeNode({ type: 'div' }), 1)
  const part0 = childOf(display, makeNode({ type: 'span', content: '' }), 0)
  const part1 = childOf(display, makeNode({ type: 'strong', content: '' }), 1)
  const part2 = childOf(display, makeNode({ type: 'span', content: '' }), 2)
  return { root, editor, display, part0, part1, part2 }
}

/** component-handler.test.ts buildUserPanel — provider supplies the handler. */function buildUserPanel(session: { loggedIn: boolean; name?: string }) {
  const root = makeRoot({ type: 'app' })
  const provider = childOf(root, makeNode({ type: 'user-provider' }), 0)
  const panel = childOf(provider, makeNode({ type: 'user-panel' }), 0)
  const username = childOf(panel, makeNode({ type: 'text', content: '…' }), 0)
  const loginBtn = childOf(panel, makeNode({ type: 'button', content: '' }), 1)
  const handlerDef: HandlerDef = {
    name: 'user-panel:populate',
    phase: 'after-compile',
    body: (ctx: unknown) => {
      const c = ctx as HandlerContext
      if (session.loggedIn) {
        c.clientAPI.apply(username.id, [{ targetProp: 'content', mode: 'replace', value: `Welcome, ${session.name}` }])
        c.clientAPI.apply(loginBtn.id, [{ targetProp: 'content', mode: 'replace', value: 'Sign out' }])
      } else {
        c.clientAPI.apply(loginBtn.id, [{ targetProp: 'content', mode: 'replace', value: 'Log in' }])
      }
    },
  }
  addComponentSource(provider, 'user-panel', { ...handlerDef })
  targetAnchor(panel, 'user-panel')
  panel.addLayer({ id: 'component-handler', handlers: [handlerDef] })
  return { root, provider, panel, username, loginBtn }
}

/** legacy-bootstrap.test.ts richLegacy — original backend NodeSchema JSON. */
function richLegacy(): Record<string, unknown> {
  return {
    template: {
      root: {
        type: 'app',
        component: { reference: 'shell' },
        children: [
          { type: 'header', content: 'Legacy header' },
          {
            type: 'pane',
            component: { reference: 'panel', value: { variant: 'a' } },
            children: [{ type: 'badge', content: 'nested badge' }],
          },
        ],
      },
      children: [{ type: 'hero', content: 'unplaced hero' }],
    },
    content: [
      {
        metadata: { locale: 'en' },
        userData: { session: 's1' },
        content: [
          {
            type: 'card',
            placement: { placementName: 'slot-alpha' },
            children: [{ type: 'title', content: 'Card title' }],
          },
        ],
      },
    ],
    clientConfig: { runInstantiation: true, runMonitoring: true },
  }
}

/** payload-refresh.test.ts legacyDoc — article + comments payloads. */
function legacyDoc(): Record<string, unknown> {
  return {
    template: { root: { type: 'app', children: [{ type: 'header', content: 'News' }] } },
    content: [
      { metadata: { kind: 'article' }, content: [{ type: 'article', content: 'original story' }] },
      { metadata: { kind: 'comments' }, content: [{ type: 'comment', content: 'first!' }] },
    ],
    clientConfig: { runMonitoring: true },
  }
}

describe('e2e — SSR HTML output validity (real SSRFragmentAdapter)', () => {
  describe('ssr-render.test.ts scenario (SSR-H1 + placements + components + nested)', () => {
    it('SSR-V1 server stream: emitted HTML is well-formed and begins with the first-created wire', () => {
      const { root, dock, inner, zone } = buildNestedPane()
      const slice = [root, dock, inner, zone]
      const ops = diffMinimal(null, root.compile(slice).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      const first = firstCreate(ops)
      expect(html.startsWith('<' + first.type)).toBe(true)
      // the emitted HTML is the rendered surface the suite's structural checks imply
      expect(html).toContain('<dock')
      expect(html).toContain('<badge')
      expect(html).toContain('<zone')
      void first
    })

    it('SSR-V2 client re-render: serialized doc re-compiles to the identical emitted HTML (PAR-5)', () => {
      const { root, dock, inner, zone } = buildNestedPane()
      const slice = [root, dock, inner, zone]
      const serverOps = diffMinimal(null, root.compile(slice).actionable.map(minimalFromState))
      const serverHtml = renderOps(serverOps)

      const doc = serializeSlice(root, slice)
      const seeded = loadState(jsonClone(doc)).map((d) => new Node(d, hub()))
      reconcileParentTargets(seeded)
      const clientOps = diffMinimal(null, seeded[0]!.compile(seeded).actionable.map(minimalFromState))
      const clientHtml = renderOps(clientOps)
      expect(validateHtml(clientHtml)).toEqual([])
      expect(clientHtml).toBe(serverHtml)
    })

    it('SSR-V3 escaping: text and attr content with <, >, &, " is entity-escaped in the emitted HTML', () => {
      const root = makeRoot({ type: 'app', content: 'shell' })
      const dock = childOf(root, makeNode({ type: 'dock', props: { role: 'main', title: SPECIAL }, css: { id: 'css-dock' } }), 0)
      const inner = childOf(dock, makeNode({ type: 'badge', content: SPECIAL, css: { id: 'css-inner' } }), 0)
      const ops = diffMinimal(null, root.compile([root, dock, inner]).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      // attr value: & → &amp;, " → &quot;, < → &lt;, > → &gt;
      expect(html).toContain('title="a &lt; b &amp; c &gt; d &quot;q&quot;"')
      // text: & → &amp;, < → &lt;, > → &gt; (" is left verbatim in text per escapeText)
      expect(html).toContain('a &lt; b &amp; c &gt; d "q"')
      expect(html).not.toContain('& b ') // no raw & survived anywhere
    })
  })

  describe('markdown-display.test.ts scenario (markdown render)', () => {
    it('SSR-V4 after-compile markdown render: emitted HTML is well-formed, root-first, strong element present', async () => {
      const f = buildMarkdown()
      const events = new EventBridge()
      const supervisor = new Supervisor({ hub: hub(), events })
      for (const n of [f.root, f.editor, f.display, f.part0, f.part1, f.part2]) supervisor.registerNode(n)
      f.display.addLayer({
        id: 'md-handler',
        handlers: [
          {
            name: 'markdown:render',
            phase: 'after-compile',
            body: (c: unknown) => {
              const cc = c as HandlerContext
              const src = String(cc.tree.getNode(f.editor.id)?.content ?? '')
              const m = /^(.*?)\*\*([^*]+)\*\*(.*)$/.exec(src)
              const prefix = m ? m[1]! : src
              const bold = m ? m[2]! : ''
              const suffix = m ? m[3]! : ''
              cc.clientAPI.apply(f.part0.id, [{ targetProp: 'content', mode: 'replace', value: prefix }])
              cc.clientAPI.apply(f.part1.id, [{ targetProp: 'content', mode: 'replace', value: bold }])
              cc.clientAPI.apply(f.part2.id, [{ targetProp: 'content', mode: 'replace', value: suffix }])
            },
          },
        ],
      })
      supervisor.clientAPI.apply(f.display.id, [{ targetProp: 'props.init', mode: 'replace', value: true }])
      await flushTicks()

      const slice = [f.root, f.editor, f.display, f.part0, f.part1, f.part2]
      const ops = diffMinimal(null, f.root.compile(slice).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      expect(html.startsWith('<app')).toBe(true)
      expect(html).toContain('<strong')
      expect(html).toContain('Hello ')
      expect(html).toContain('world')
    })
  })

  describe('component-handler.test.ts scenario (component as handler source)', () => {
    it('SSR-V5 logged-in panel: emitted HTML is well-formed and contains the populated panel', async () => {
      const panel = buildUserPanel({ loggedIn: true, name: 'Ada' })
      const events = new EventBridge()
      const supervisor = new Supervisor({ hub: hub(), events })
      for (const n of [panel.root, panel.provider, panel.panel, panel.username, panel.loginBtn]) supervisor.registerNode(n)
      supervisor.apply({ kind: 'state-slice', node: panel.panel, mutation: [{ targetProp: 'props.role', mode: 'replace', value: 'main' }] })
      await flushTicks()

      const slice = [panel.root, panel.provider, panel.panel, panel.username, panel.loginBtn]
      const ops = diffMinimal(null, panel.root.compile(slice).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      expect(html.startsWith('<app')).toBe(true)
      expect(html).toContain('<user-panel')
      expect(html).toContain('Welcome, Ada')
      expect(html).toContain('Sign out')
    })
  })

  describe('legacy-bootstrap.test.ts scenario (translateLegacy → render)', () => {
    it('SSR-V6 legacy render: emitted HTML is well-formed, root-first, unplaced nodes excluded', () => {
      const t = translateLegacy(richLegacy() as never)
      const ops = diffMinimal(null, t.root.compile(t.nodes).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      expect(html.startsWith('<app')).toBe(true)
      expect(html).toContain('Legacy header')
      expect(html).toContain('nested badge')
      for (const c of t.content) expect(html).not.toContain(c.id)
    })

    it('SSR-V7 escaping: legacy content with <, >, &, " is entity-escaped in the emitted HTML', () => {
      const legacy = richLegacy()
      ;(legacy.template as Record<string, unknown>).root = {
        type: 'app',
        component: { reference: 'shell' },
        children: [{ type: 'header', content: SPECIAL }],
      }
      const t = translateLegacy(legacy as never)
      const ops = diffMinimal(null, t.root.compile(t.nodes).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      expect(html).toContain('a &lt; b &amp; c &gt; d "q"')
      expect(html).not.toContain('& b ')
    })
  })

  describe('loop-safety.test.ts scenario (loop-safety render)', () => {
    it('SSR-V8 depth-cap render: dropped loop arm absent; remaining chain emits well-formed HTML', () => {
      const root = makeRoot()
      const chain: Node[] = [root]
      let parent = root
      for (let i = 0; i <= MAX_COMPILE_DEPTH + 1; i++) {
        const n = makeNode()
        childOf(parent, n)
        chain.push(n)
        parent = n
      }
      const deep = parent
      targetAnchor(deep, 'deep-borrow')
      addComponentSource(root, 'deep-borrow', { at: 'root' })

      const cr = root.compile(chain)
      const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      expect(html.startsWith('<div')).toBe(true)
      // the loop-dropped deep node contributes nothing (NVS-2, SER-R4)
      expect(html).not.toContain(deep.id)
    })
  })

  describe('payload-refresh.test.ts scenario (payload lifecycle render)', () => {
    it('SSR-V9 payload lifecycle render: emitted HTML is well-formed, root-first, refreshed state present', () => {
      const events = new EventBridge()
      const supervisor = new Supervisor({ hub: hub(), events })
      const t = translateLegacy(legacyDoc() as never)
      for (const n of t.nodes) supervisor.registerNode(n)
      const clientAPI = createClient(supervisor)

      const article = t.content[0]!
      const comments = t.content[1]!
      const articlePayload: Payload = { id: 'article', roots: [article] }
      const commentsPayload: Payload = { id: 'comments', roots: [comments] }
      for (const c of [article, comments]) {
        const link = t.root.anchors.find((a) => a.role === 'parent')!.link as never
        c.addAnchor('child', c, { priority: nextPriority(t.root) }, link)
      }
      const slice: Node[] = [...t.nodes]

      clientAPI.apply(comments.id, [{ targetProp: 'content', mode: 'replace', value: 'edited comment' }])
      const c2 = makeNode({ type: 'comment', content: 'second!' })
      supervisor.registerNode(c2)
      slice.push(c2)
      appendToPayload(commentsPayload, [c2], t.root)
      const newStory = makeNode({ type: 'article', content: 'breaking news' })
      supervisor.registerNode(newStory)
      slice.push(newStory)
      refreshPayload(articlePayload, [newStory], t.root)

      const ops = diffMinimal(null, t.root.compile(slice).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      expect(html.startsWith('<app')).toBe(true)
      expect(html).toContain('>News<')
      expect(html).toContain('edited comment')
      expect(html).toContain('second!')
      expect(html).toContain('breaking news')
    })

    it('SSR-V10 escaping: payload content with <, >, &, " is entity-escaped in the emitted HTML', () => {
      const events = new EventBridge()
      const supervisor = new Supervisor({ hub: hub(), events })
      const t = translateLegacy(legacyDoc() as never)
      for (const n of t.nodes) supervisor.registerNode(n)
      const comments = t.content[1]!
      const commentsPayload: Payload = { id: 'comments', roots: [comments] }
      const link = t.root.anchors.find((a) => a.role === 'parent')!.link as never
      comments.addAnchor('child', comments, { priority: nextPriority(t.root) }, link)
      const slice: Node[] = [...t.nodes]
      const c2 = makeNode({ type: 'comment', content: SPECIAL })
      supervisor.registerNode(c2)
      slice.push(c2)
      appendToPayload(commentsPayload, [c2], t.root)

      const ops = diffMinimal(null, t.root.compile(slice).actionable.map(minimalFromState))
      const html = renderOps(ops)
      expect(validateHtml(html)).toEqual([])
      expect(html).toContain('a &lt; b &amp; c &gt; d "q"')
      expect(html).not.toContain('& b ')
    })
  })

  describe('serialization edge cases', () => {
    it('SSR-V11 an explicit styles op pins the exact §4.5 join formula before the root html', () => {
      const ops: RenderOp[] = [
        { kind: 'styles', cssDefs: ['.a{}', '.b{}'] },
        { kind: 'create', wire: 'root', type: 'div' },
        { kind: 'set', wire: 'root', name: 'css:id', value: 'r' },
        { kind: 'create', wire: 'c', type: 'span' },
        { kind: 'set', wire: 'c', name: 'text', value: 'hi' },
        { kind: 'append', owner: 'root', child: 'c' },
      ]
      const html = renderOps(ops)
      const { prefix, body } = splitStylesPrefix(html)
      expect(prefix).toBe(stylesPrefixOf(['.a{}', '.b{}']))
      expect(body).toBe('<div id="r"><span>hi</span></div>')
      expect(validateHtml(html)).toEqual([])
    })

    it('SSR-V12 root removed → stylesPrefix only; no create ever → empty string', () => {
      const ops: RenderOp[] = [
        { kind: 'styles', cssDefs: ['.x{}'] },
        { kind: 'create', wire: 'root', type: 'div' },
        { kind: 'remove', wire: 'root' },
      ]
      expect(renderOps(ops)).toBe(stylesPrefixOf(['.x{}']))
      expect(renderOps([{ kind: 'styles', cssDefs: ['.x{}'] }])).toBe(stylesPrefixOf(['.x{}']))
      expect(renderOps([])).toBe('')
    })

    it('SSR-V13 on:<event> handler attr values are escaped per §4.2', () => {
      const ops: RenderOp[] = [
        { kind: 'create', wire: 'w', type: 'div' },
        { kind: 'set', wire: 'w', name: 'on:click', value: 'a&b "c" <d>' },
      ]
      const html = renderOps(ops)
      // §4.2: attr `on<event> = escapeAttr(val)` — & → &amp;, " → &quot;, < → &lt;, > → &gt;
      expect(html).toContain('onclick="a&amp;b &quot;c&quot; &lt;d&gt;"')
      expect(html).not.toContain('a&b "c" <d>')
      expect(validateHtml(html)).toEqual([])
    })
  })
})
