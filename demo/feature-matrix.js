/**
 * Feature-matrix browser page — every framework surface in one document.
 *
 * The shipped `preempt-initial-data` document (legacy envelope → translate →
 * serialize, built by scripts/build-demo.mjs) is re-resolved from its
 * serialized anchors (S4.2), handlers are installed at runtime (handler bodies
 * are runtime-only; SER-F1), and everything is rendered through the framework:
 * compile → diffMinimal → DomAdapter. The page then drives the documented
 * feature set (placements, components/forks, payload lifecycle, managed
 * updates, reverse translation, loop-safety) and asserts the smoke expectations
 * the server embedded alongside the data.
 */
import { Node, reconcileParentTargets, Supervisor } from '../dist/core/node.js'
import { diffMinimal } from '../dist/core/render.js'
import { loadState } from '../dist/core/serialize.js'
import { createClient } from '../dist/core/client.js'
import { EventBridge } from '../dist/core/events.js'
import { dispatchEvent } from '../dist/core/handlers.js'
import { translateLegacy, reverseTranslate } from '../dist/core/translate.js'
import { appendToPayload, refreshPayload, dropPayload } from '../dist/core/payload.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { hub } from './demo-fixtures.js'
import { DomAdapter } from './lib/dom-adapter.js'
import { emitElements } from './lib/feature-matrix-emit.js'
import { makeRunner } from './lib/runner.js'
import { applyOps, treeFromOps, treeSig, jsonClone } from './lib/render-ops.js'

setCompilePassLogging(true)
globalThis.setCompilePassLogging = setCompilePassLogging

const runner = makeRunner()
document.getElementById('results').appendChild(runner.el)

const initialData = JSON.parse(document.getElementById('preempt-initial-data').textContent)
const serverData = JSON.parse(document.getElementById('server-data').textContent)
const labels = serverData.nodeLabels
const byName = {}
for (const [id, l] of Object.entries(labels)) byName[l.name] = id
const expected = serverData.expected

const adapter = new DomAdapter(document.getElementById('app'), { onEvent: handleDomEvent })

// ---- reconstruct the graph from the shipped document (S4.2) --------------
const seeded = loadState(jsonClone(initialData)).map((d) => new Node(d, hub()))
reconcileParentTargets(seeded)
const rootNode = seeded[0]
const wireToNode = new Map(seeded.map((n) => [n.id, n]))
let renderNodes = [...seeded]

const events = new EventBridge()
const supervisor = new Supervisor({ hub: hub(), events })
for (const n of seeded) supervisor.registerNode(n)
const clientAPI = createClient(supervisor)

// ---- payload objects from the server-embedded wire groups ------------------
const articlePayload = { id: 'article', roots: serverData.payloadGroups.article.map((w) => wireToNode.get(w)) }
const commentsPayload = { id: 'comments', roots: serverData.payloadGroups.comments.map((w) => wireToNode.get(w)) }

// ---- session state + runtime handlers (bodies are runtime-only) ------------
const session = { loggedIn: false, user: { name: 'ada', role: 'admin' } }
let tick = 0

const paneNode = wireToNode.get(byName['user-pane'])
const loginNode = wireToNode.get(byName['login-btn'])
const logoutNode = wireToNode.get(byName['logout-btn'])

paneNode.addLayer({
  id: 'session-populate',
  handlers: [
    {
      name: 'populate-session',
      phase: 'after-compile',
      body: (c) => {
        if (session.loggedIn) {
          c.clientAPI.apply(byName['username'], [{ targetProp: 'content', mode: 'replace', value: `Welcome, ${session.user.name} — session: ok` }])
        } else {
          c.clientAPI.apply(byName['username'], [{ targetProp: 'content', mode: 'replace', value: 'Logged out. Click login.' }])
        }
      },
    },
  ],
})
loginNode.addLayer({
  id: 'login-handler',
  handlers: [{ name: 'login', event: 'click', body: () => { session.loggedIn = true; return clientAPI.apply(byName['user-pane'], [{ targetProp: 'props.tick', mode: 'replace', value: ++tick }]) } }],
})
logoutNode.addLayer({
  id: 'logout-handler',
  handlers: [{ name: 'logout', event: 'click', body: () => { session.loggedIn = false; return clientAPI.apply(byName['user-pane'], [{ targetProp: 'props.tick', mode: 'replace', value: ++tick }]) } }],
})

// ---- markdown editor → display --------------------------------------------
const editorNode = wireToNode.get(byName['md-editor'])
const displayNode = wireToNode.get(byName['md-display'])

/** POC markdown: split on the first **bold** pair into prefix/bold/suffix. */
function parseBold(md) {
  const m = /^(.*?)\*\*([^*]+)\*\*(.*)$/.exec(String(md ?? ''))
  if (!m) return { prefix: String(md ?? ''), bold: '', suffix: '' }
  return { prefix: m[1], bold: m[2], suffix: m[3] }
}

displayNode.addLayer({
  id: 'md-handler',
  handlers: [
    {
      name: 'render-markdown',
      phase: 'after-compile',
      body: (c) => {
        // the editor's text lives in `content` (after typing) or the initial
        // `props.value`; both surface through the handler tree.
        const editor = c.tree.getNode(byName['md-editor'])
        const src = String(editor?.content ?? editor?.props?.value ?? '')
        const { prefix, bold, suffix } = parseBold(src)
        c.clientAPI.apply(byName['md-prefix'], [{ targetProp: 'content', mode: 'replace', value: prefix }])
        c.clientAPI.apply(byName['md-bold'], [{ targetProp: 'content', mode: 'replace', value: bold }])
        c.clientAPI.apply(byName['md-suffix'], [{ targetProp: 'content', mode: 'replace', value: suffix }])
      },
    },
  ],
})
editorNode.addLayer({
  id: 'input-handler',
  handlers: [
    {
      name: 'on-input',
      event: 'input',
      body: (c, value) => {
        const v = String(value ?? '')
        c.clientAPI.apply(byName['md-editor'], [{ targetProp: 'content', mode: 'replace', value: v }])
        c.clientAPI.apply(byName['md-display'], [{ targetProp: 'props.tick', mode: 'replace', value: ++tick }])
      },
    },
  ],
})

function flushMicrotasks() {
  const waits = []
  for (let i = 0; i < 4; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

/** Browser event → dispatch the node's handlers (with the form value), then
 *  re-render through the framework. The event NAME is `domEvent.type` — the
 *  `DOM` adapter hands us the DOM event; `domEvent.target.value` is the arg. */
async function handleDomEvent(wire, domEvent) {
  const node = wireToNode.get(wire)
  if (!node) return
  const eventName = domEvent && typeof domEvent === 'object' && typeof domEvent.type === 'string'
    ? domEvent.type
    : String(domEvent ?? '')
  const extra = domEvent && domEvent.target && typeof domEvent.target.value === 'string' ? [domEvent.target.value] : []
  dispatchEvent(node, supervisor.handlerContext, eventName, ...extra)
  await flushMicrotasks()
  render()
}

// ---- render: compile → diffMinimal → DomAdapter ----------------------------
let prevMap = null
let lastCr = null
/** @returns {{cr, els, ops}} of the latest full compile */
function render() {
  const origWarn = console.warn
  console.warn = () => {} // compile warnings (unresolved/loop) are asserted, not noise
  try {
    // TODO(feature): consume `supervisor.takePass2States()` after bootstrap like
    // demo/components.js does — the DECIDED incremental-render contract (no
    // render-side compile after the bootstrap pass, notes §10.10.10). This page
    // currently recompiles `rootNode.compile(renderNodes)` per update for
    // readability and asserts the result equals the focused-pass contract; until
    // it flips to takePass2States, it is a documented-deviation, not the pattern.
    const cr = rootNode.compile(renderNodes)
    lastCr = cr
    const nodeById = new Map(renderNodes.map((n) => [n.id, n]))
    const els = emitElements(cr.actionable, nodeById)
    const ops = diffMinimal(prevMap, els)
    applyOps(adapter, ops)
    prevMap = new Map(els.map((e) => [e.wire, e]))
    return { cr, els, ops }
  } finally {
    console.warn = origWarn
  }
}

function statesOf(id) {
  return lastCr ? lastCr.actionable.filter((s) => s.nodeId === id) : []
}
function nodeText(wire) {
  const el = adapter.wires.get(wire)
  return el ? el.textContent.trim() : ''
}
function nodeById(name) {
  return wireToNode.get(byName[name])
}

/** PAR-5 signature: emission minus runtime `on:*` bindings (handler wiring is
 *  runtime-only; render data is what parity compares). */
function paritySig(els) {
  const strip = els.map((e) => {
    const props = {}
    for (const [k, v] of Object.entries(e.props)) if (!k.startsWith('on:')) props[k] = v
    return { ...e, props }
  })
  return treeSig(treeFromOps(diffMinimal(null, strip)))
}

async function main() {
  document.getElementById('server-doc').textContent = JSON.stringify(initialData, null, 2)

  // ------------------------------------------------------------------
  await runner.check('input data re-parses and is JSON-stable (NVS-5)', () => {
    if (JSON.stringify(jsonClone(initialData)) !== JSON.stringify(initialData)) throw new Error('not JSON-stable')
  })

  await runner.check('S4.2: the shipped document re-resolves into the full legacy graph', () => {
    if (seeded.length !== expected.nodeCount) throw new Error(`expected ${expected.nodeCount} nodes, got ${seeded.length}`)
    if (rootNode.state !== 'in-tree') throw new Error('root not in-tree')
    for (const name of ['article-1', 'comment-1']) {
      if (!nodeById(name)) throw new Error(`${name} missing`)
      if (nodeById(name).state !== 'in-tree') throw new Error(`${name} not placed`)
    }
  })

  // FIRST render (pristine graph) — PAR-5 against the server reference.
  const first = render()
  await runner.check('PAR-5: in-browser render tree ≡ server render tree', () => {
    if (paritySig(first.els) !== serverData.serverTreeSig) throw new Error('server/client tree signatures differ')
  })

  // trigger the phase handlers once so the pane + display populate (pass-2)
  clientAPI.apply(byName['user-pane'], [{ targetProp: 'props.init', mode: 'replace', value: true }])
  clientAPI.apply(byName['md-display'], [{ targetProp: 'props.init', mode: 'replace', value: true }])
  await flushMicrotasks()
  render()

  // ------------------------------------------------------------------
  // 1. SESSION PANE — component resolution + after-compile handler
  await runner.check('session component resolves; after-compile handler populates the username descendant', async () => {
    const pane = statesOf(byName['user-pane'])[0]
    if (!pane?.bindings['session']) throw new Error('session did not resolve on the pane')
    if (pane.bindings['session'].user !== 'ada') throw new Error('resolved session record missing user')
    if (nodeText(byName['username']) !== 'Logged out. Click login.') {
      throw new Error(`expected logged-out username, got "${nodeText(byName['username'])}"`)
    }
  })

  await runner.check('login/logout push managed updates through ClientAPI.apply (journaled)', async () => {
    const before = supervisor.journal.length
    dispatchEvent(loginNode, supervisor.handlerContext, 'click')
    await flushMicrotasks()
    render()
    if (nodeText(byName['username']) !== 'Welcome, ada — session: ok') {
      throw new Error(`expected logged-in username, got "${nodeText(byName['username'])}"`)
    }
    dispatchEvent(logoutNode, supervisor.handlerContext, 'click')
    await flushMicrotasks()
    render()
    if (nodeText(byName['username']) !== 'Logged out. Click login.') throw new Error('logout did not reset the username')
    if (supervisor.journal.length <= before) throw new Error('login/logout updates were not journaled')
  })

  // ------------------------------------------------------------------
  // 2. MARKDOWN — in-place render, focus retention
  await runner.check('markdown: **bold** parses into a strong element; typing re-parses IN PLACE (no focus loss)', async () => {
    if (nodeText(byName['md-prefix']) !== 'Type') throw new Error(`prefix wrong: "${nodeText(byName['md-prefix'])}"`)
    if (nodeText(byName['md-bold']) !== 'bold') throw new Error(`bold wrong: "${nodeText(byName['md-bold'])}"`)
    if (nodeText(byName['md-suffix']) !== 'here') throw new Error(`suffix wrong: "${nodeText(byName['md-suffix'])}"`)
    if (adapter.wires.get(byName['md-bold'])?.tagName !== 'STRONG') throw new Error('bold part is not a strong element')

    const editorEl = adapter.wires.get(byName['md-editor'])
    const boldEl = adapter.wires.get(byName['md-bold'])
    dispatchEvent(editorNode, supervisor.handlerContext, 'input', 'Goodbye **friend**!')
    await flushMicrotasks()
    render()
    if (adapter.wires.get(byName['md-editor']) !== editorEl) throw new Error('editor element replaced (focus lost)')
    if (adapter.wires.get(byName['md-bold']) !== boldEl) throw new Error('strong element replaced')
    if (nodeText(byName['md-prefix']) !== 'Goodbye') throw new Error('prefix not re-parsed')
    if (nodeText(byName['md-bold']) !== 'friend') throw new Error('bold not re-parsed')
    if (nodeText(byName['md-suffix']) !== '!') throw new Error('suffix not re-parsed')
  })

  // ------------------------------------------------------------------
  // 3. PLACEMENTS + PAYLOAD LIFECYCLE
  await runner.check('placements: zone children attached at build (article 2 + comment 1)', () => {
    const zone = adapter.wires.get(byName['content-zone'])
    if (!zone) throw new Error('content-zone not rendered')
    const kids = adapter.wires.get(byName['content-zone'])?.children.map((c) => c.dataset?.wire ?? '')
    const names = kids.map((w) => labels[w]?.name)
    if (!names.includes('article-1') || !names.includes('article-tagline')) {
      throw new Error(`content zone children wrong: ${JSON.stringify(names)}`)
    }
    if (adapter.wires.get(byName['comments-zone'])?.children.length !== 1) throw new Error('comments zone should have 1 child')
  })

  await runner.check('payload lifecycle: append → refresh → drop; edits on other payloads survive', async () => {
    // websocket append to comments
    // explicit wire ids — runtime minting could collide with seeded wires
    // (nodeSeq is process-global across demo modules in the headless smoke).
    const c2 = new Node({ type: 'p', props: { id: 'comment-2' }, content: 'Second comment.' }, hub(), 'rt-comment-2')
    supervisor.registerNode(c2)
    renderNodes.push(c2)
    const commentsZoneNode = nodeById('comments-zone')
    appendToPayload(commentsPayload, [c2], commentsZoneNode)
    await flushMicrotasks()
    render()
    const commentWires = adapter.wires.get(byName['comments-zone'])?.children.map((c) => c.dataset?.wire ?? '') ?? []
    if (commentsPayload.roots.length !== 2 || !commentWires.includes(c2.id)) throw new Error('append did not attach comment-2')

    // refresh the article payload
    const fresh = new Node({ type: 'article', props: { id: 'article-fresh' }, content: 'breaking news' }, hub(), 'rt-article-fresh')
    supervisor.registerNode(fresh)
    renderNodes.push(fresh)
    const contentZoneNode = nodeById('content-zone')
    refreshPayload(articlePayload, [fresh], contentZoneNode)
    await flushMicrotasks()
    render()
    if (adapter.wires.get(byName['article-1'])?.removed !== true && !adapter.wires.get(byName['article-1'])) {
      // old article either explicitly removed by the adapter or absent from the map
    }
    if (!adapter.wires.has(fresh.id)) throw new Error('fresh article not rendered')
    if (nodeText(fresh.id) !== 'breaking news') throw new Error('fresh article content wrong')
    if (adapter.wires.has(byName['article-1'])) throw new Error('old article still rendered after refresh')

    // drop the comments payload
    dropPayload(commentsPayload)
    await flushMicrotasks()
    render()
    if (adapter.wires.get(byName['comments-zone'])?.children.length !== 0) throw new Error('comments not dropped')
    if (commentsPayload.roots.length !== 0) throw new Error('comments payload roots did not clear')
    // sibling payload (article) still has its fresh root registered
    if (articlePayload.roots.length !== 1) throw new Error('article payload disturbed by comments drop')
  })

  // ------------------------------------------------------------------
  // 4. FORKS — N providers ⇒ N actionable arms, no coerced pick
  await runner.check('forks: each theme consumer resolves 2 distinct arms; both render', () => {
    console.error('DBG lastCr actionables:', lastCr.actionable.map((s) => `${s.nodeId}:${s.pathKey}:${JSON.stringify(s.bindings)}`).join(' | '))
    for (const c of ['fork-a', 'fork-b']) {
      const arms = statesOf(byName[c])
      if (arms.length !== 2) throw new Error(`${c}: expected 2 arms, got ${arms.length}`)
      if (new Set(arms.map((a) => a.pathKey)).size !== 2) throw new Error(`${c}: path keys not distinct`)
      const themes = arms.map((a) => a.bindings['theme'])
      if (!themes.includes('theme: dark') || !themes.includes('theme: light')) {
        throw new Error(`${c}: bindings missing candidates: ${JSON.stringify(themes)}`)
      }
    }
    if (serverData.forkArms.length !== expected.forkCount) throw new Error('server forkArms count mismatch')
    const domText = allText(adapter.wires.get(byName['fork-demo']))
    if (!domText.includes('theme: dark') || !domText.includes('theme: light')) throw new Error('fork arms not rendered into the DOM')
  })

  // ------------------------------------------------------------------
  // 5. LOOP SAFETY — circular-source arm dropped; siblings survive
  await runner.check('loop-safety: resolution cycle drops as loop; section + sibling note render', () => {
    const loopIds = ['loop-cycle', 'loop-nest', 'loop-a', 'loop-b'].map((n) => byName[n])
    for (const id of loopIds) {
      if (adapter.wires.has(id)) throw new Error(`dropped wire still rendered: ${labels[id]?.name}`)
      if (statesOf(id).length !== 0) throw new Error(`dropped wire still actionable: ${labels[id]?.name}`)
    }
    if (!serverData.loopDroppedWires.every((w) => !adapter.wires.has(w) && statesOf(w).length === 0)) {
      throw new Error('server loop drop not reproduced client-side')
    }
    if (!adapter.wires.has(byName['loop-probe'])) throw new Error('loop-probe section missing')
    if (adapter.wires.get(byName['loop-probe'])?.children.length !== 1) throw new Error('loop section should render only the surviving note')
    if (statesOf(byName['loop-a']).length) throw new Error('loop-a should be non-actionable')
  })

  // ------------------------------------------------------------------
  // 6. REVERSE TRANSLATION + round-trip
  await runner.check('reverse translation: payloads separate, LIVE state preserved, round-trips', () => {
    const out = reverseTranslate(rootNode, { payloads: [articlePayload, commentsPayload] })
    if (!out.template || !out.content) throw new Error('reversed envelope missing fields')
    if (out.content.length !== 2) throw new Error('expected 2 payload groups, got ' + out.content.length)
    if (out.content[0].content[0].content !== 'breaking news') throw new Error('article live state not preserved')
    if (out.content[1].content.length !== 0) throw new Error('dropped comments group should be empty')
    const again = translateLegacy(out)
    if (!again.content.some((c) => c.content === 'breaking news')) throw new Error('reversed doc round-trips (article missing)')
    if (!again.root.anchors.some((a) => a.role === 'target' && a.target === 'session')) throw new Error('template.component reference lost')
  })

  // ------------------------------------------------------------------
  // 7. HYDRATE SEAM + compile-pass logging surface
  await runner.check('SSR-H2: hydrate reuses SSR DOM via the css.id seam', () => {
    const h = new DomAdapter(document.createElement('div'))
    h.hydrate(rootNode.id, initialData)
    if (!h.reused.has(initialData.template.css.id)) throw new Error('css.id seam did not reuse the SSR template element')
    if (typeof globalThis.setCompilePassLogging !== 'function') throw new Error('setCompilePassLogging not exposed')
  })

  runner.summary('Feature Matrix')
}

function allText(el) {
  if (!el) return ''
  return (el.textContent ?? '') + (el.children ?? []).map(allText).join('')
}

main()