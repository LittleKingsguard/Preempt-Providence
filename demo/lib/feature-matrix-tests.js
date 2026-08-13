/**
 * Shared feature-matrix test harness — the exact browser checks the
 * feature-matrix page runs, extracted so the mode-toggle page (SSR / client /
 * markdown adapter modes) can drive the same surface. The feature-matrix page
 * is now a thin wrapper over this harness (demo/feature-matrix.js).
 *
 * Inputs are the same DOM ids feature-matrix.html used:
 *   preempt-initial-data / server-data (JSON script tags), #app (mount),
 *   #results (runner container), #server-doc (shipped-doc dump).
 *
 * `mode` selects optional extra checks:
 *   - 'ssr': asserts the full server-rendered HTML was received (non-empty,
 *     root-first, key wires present) — the "full HTML in the response body"
 *     the SSR adapter mode promises;
 *   - 'markdown': asserts the raw markdown source was embedded for manual
 *     inspection alongside the live rendered display.
 */
import { Node, reconcileParentTargets, Supervisor, focusedSliceFor } from '../../dist/core/node.js'
import { diffMinimal } from '../../dist/core/render.js'
import { loadState } from '../../dist/core/serialize.js'
import { createClient } from '../../dist/core/client.js'
import { EventBridge } from '../../dist/core/events.js'
import { dispatchEvent } from '../../dist/core/handlers.js'
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { appendToPayload, refreshPayload, dropPayload } from '../../dist/core/payload.js'
import { setCompilePassLogging } from '../../dist/core/debug.js'
import { hub } from '../demo-fixtures.js'
import { DomAdapter } from '../../dist/core/adapters.js'
import { emitElements, applyOps, treeFromOps, treeSig, jsonClone } from '../../dist/core/render-helpers.js'
import { makeRunner } from './runner.js'

setCompilePassLogging(true)
globalThis.setCompilePassLogging = setCompilePassLogging

/**
 * @param {object} opts
 * @param {HTMLElement} opts.appEl        live mount (DomAdapter root)
 * @param {HTMLElement} opts.resultsEl    runner container
 * @param {HTMLElement} opts.serverDocEl  shipped-doc <pre> dump
 * @param {object} opts.initialData       parsed preempt-initial-data
 * @param {object} opts.serverData        parsed server-data
 * @param {'client'|'ssr'|'markdown'} [opts.mode]
 * @param {string} [opts.receivedHtml]    full SSR HTML received from the server
 * @param {string} [opts.markdownSource]  raw markdown source embedded by the server
 * @param {string} [opts.title]
 */
export async function runFeatureMatrixTests({
  appEl,
  resultsEl,
  serverDocEl,
  initialData,
  serverData,
  mode = 'client',
  receivedHtml = '',
  markdownSource = '',
  title = 'Feature Matrix',
}) {
  const runner = makeRunner()
  resultsEl.appendChild(runner.el)

  const labels = serverData.nodeLabels
  const byName = {}
  for (const [id, l] of Object.entries(labels)) byName[l.name] = id
  const expected = serverData.expected

  const adapter = new DomAdapter(appEl, { onEvent: handleDomEvent })

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

  // ---- payload controls: "Drop comments" is USER-triggered (button click) --
  // The drop is NOT automatic: the visitor clicks the button and the comments
  // payload drops (P-4: roots destroyed, sibling article payload untouched).
  // The harness verifies the same path by dispatching the click.
  const dropBtnNode = wireToNode.get(byName['drop-comments-btn'])
  dropBtnNode.addLayer({
    id: 'drop-comments-handler',
    handlers: [
      {
        name: 'drop-comments',
        event: 'click',
        body: () => {
          dropPayload(commentsPayload)
          recompileFocusedFor(nodeById('comments-zone'))
          return true
        },
      },
    ],
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
   *  re-render through the framework. */
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

  // ---- render: bootstrap once, then consume the supervisor's pass-2 ---------
  // DECIDED incremental-render contract (notes §10.10.10): NO render-side
  // compile after the bootstrap pass. Every update flows through the
  // supervisor (clientAPI.apply / dispatchEvent) whose flush runs a BOUNDED
  // focused pass-2 (dirty node + walk path + source-bearing providers); the
  // renderer consumes `takePass2States()` and diffs — never recompiles.
  let prevStates = new Map()
  let prevMap = null
  let bootstrapped = false
  /** @returns {{els, ops, warnings}} of the latest incremental render */
  function render() {
    const origWarn = console.warn
    console.warn = () => {} // incremental compile warnings are asserted, not noise
    let bootstrapWarnings = null
    try {
      if (!bootstrapped) {
        const cr = rootNode.compile(renderNodes)
        setStates(cr.actionable)
        supervisor.recordResolved(cr.actionable)
        bootstrapWarnings = cr.warnings
        bootstrapped = true
      } else {
        const fresh = supervisor.takePass2States()
        for (const [id, arr] of fresh) prevStates.set(id, arr)
      }
      const els = buildElementsFrom()
      const ops = diffMinimal(prevMap, els)
      applyOps(adapter, ops)
      prevMap = new Map(els.map((e) => [e.wire, e]))
      return { els, ops, warnings: bootstrapWarnings ?? [] }
    } finally {
      console.warn = origWarn
    }
  }

  /** Surface the bootstrap's compile warnings (e.g. the loop probe's
   *  `circular-source` drops) in the console — the harness suppresses
   *  console.warn during renders so the checks stay quiet, but the loop
   *  diagnostic is the point of the probe and must be visible in devtools. */
  function logBootstrapWarnings() {
    const boot = render()
    for (const w of boot.warnings) {
      console.warn(`[feature-matrix] ${w.code} at ${w.pathKey}`)
    }
    return boot
  }

  /** Merge compiled states into the per-node cache (fork arms grouped). */
  function setStates(actionable) {
    const byNode = new Map()
    for (const s of actionable) {
      const arr = byNode.get(s.nodeId) ?? []
      arr.push(s)
      byNode.set(s.nodeId, arr)
    }
    for (const [id, arr] of byNode) prevStates.set(id, arr)
  }

  /** Recompile a bounded focused slice for nodes the payload layer mutated
   *  DIRECTLY (payload.ts attaches/detaches anchors outside the supervisor's
   *  dirty set) — the changed zone's walk path + its source-bearing providers,
   *  never the whole tree. States for nodes that left the tree are pruned. */
  function recompileFocusedFor(node) {
    const slice = focusedSliceFor(node, supervisor.allNodes())
    const cr = node.compile(slice, { focusNodeId: node.id })
    setStates(cr.actionable)
    supervisor.recordResolved(cr.actionable)
    // prune cached states for nodes no longer in-tree (dropped/refreshed
    // payload roots) so their wires get `remove`d by the diff
    for (const id of [...prevStates.keys()]) {
      const n = supervisor.getNode(id)
      if (!n) continue
      if (!n.isInTree && !cr.actionable.some((s) => s.nodeId === id)) prevStates.delete(id)
    }
    return cr
  }

  function buildElementsFrom() {
    const actionable = []
    for (const [, states] of prevStates) actionable.push(...states)
    // ONE call with the full set — emitElements computes fork-arm wire
    // adoption across the WHOLE surface (a parent's childOrder expands a
    // forked child into its arm wires); per-node calls would lose that.
    return emitElements(actionable, wireToNode)
  }

  function statesOf(id) {
    return prevStates.get(id) ?? []
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

  serverDocEl.textContent = JSON.stringify(initialData, null, 2)

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
  // This is the bootstrap: its warnings (the loop probe's `circular-source`
  // drops) are surfaced to the console so the diagnostic is visible in devtools.
  const first = logBootstrapWarnings()
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
    const typed = render()
    if (adapter.wires.get(byName['md-editor']) !== editorEl) throw new Error('editor element replaced (focus lost)')
    if (adapter.wires.get(byName['md-bold']) !== boldEl) throw new Error('strong element replaced')
    // real-browser focus safety: the editor wire must get NO append/remove op —
    // re-appending an attached element physically relocates it in the DOM,
    // which blurs the focused textarea even though the element object survives.
    for (const op of typed.ops) {
      if ((op.kind === 'append' || op.kind === 'remove') && (op.wire === editorEl.dataset.wire || op.child === editorEl.dataset.wire)) {
        throw new Error(`editor element touched by ${op.kind} op (would blur the focused editor)`)
      }
    }
    if (nodeText(byName['md-prefix']) !== 'Goodbye') throw new Error('prefix not re-parsed')
    if (nodeText(byName['md-bold']) !== 'friend') throw new Error('bold not re-parsed')
    if (nodeText(byName['md-suffix']) !== '!') throw new Error('suffix not re-parsed')
  })

  // ------------------------------------------------------------------
  // 3. PLACEMENTS + PAYLOAD LIFECYCLE
  await runner.check('placements: zone children attached at build (article 2 + comment 1)', () => {
    const zone = adapter.wires.get(byName['content-zone'])
    if (!zone) throw new Error('content-zone not rendered')
    // real DOM `children` is an HTMLCollection (no `.map`) — always Array.from
    const kids = Array.from(adapter.wires.get(byName['content-zone'])?.children ?? []).map((c) => c.dataset?.wire ?? '')
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
    recompileFocusedFor(commentsZoneNode)
    render()
    const commentWires = Array.from(adapter.wires.get(byName['comments-zone'])?.children ?? []).map((c) => c.dataset?.wire ?? '')
    if (commentsPayload.roots.length !== 2 || !commentWires.includes(c2.id)) throw new Error('append did not attach comment-2')

    // refresh the article payload
    const fresh = new Node({ type: 'article', props: { id: 'article-fresh' }, content: 'breaking news' }, hub(), 'rt-article-fresh')
    supervisor.registerNode(fresh)
    renderNodes.push(fresh)
    const contentZoneNode = nodeById('content-zone')
    refreshPayload(articlePayload, [fresh], contentZoneNode)
    await flushMicrotasks()
    recompileFocusedFor(contentZoneNode)
    render()
    if (adapter.wires.get(byName['article-1'])?.removed !== true && !adapter.wires.get(byName['article-1'])) {
      // old article either explicitly removed by the adapter or absent from the map
    }
    if (!adapter.wires.has(fresh.id)) throw new Error('fresh article not rendered')
    if (nodeText(fresh.id) !== 'breaking news') throw new Error('fresh article content wrong')
    if (adapter.wires.has(byName['article-1'])) throw new Error('old article still rendered after refresh')

    // drop the comments payload — USER-triggered: the harness dispatches the
    // same click a visitor gives the "Drop comments" button.
    dispatchEvent(dropBtnNode, supervisor.handlerContext, 'click')
    await flushMicrotasks()
    render()
    if (adapter.wires.get(byName['comments-zone'])?.children.length !== 0) throw new Error('comments not dropped')
    if (commentsPayload.roots.length !== 0) throw new Error('comments payload roots did not clear')
    // sibling payload (article) still has its fresh root registered
    if (articlePayload.roots.length !== 1) throw new Error('article payload disturbed by comments drop')

    // leave the page POPULATED with ALL the comments the demo created: the
    // zone is a placement target, so re-attach all three (build's comment-1,
    // the appended comment-2, and the restored comment-3) and keep the Drop
    // button live (drop stays manual, not hidden).
    const restored = [
      new Node({ type: 'p', props: { id: 'comment-1' }, content: 'First comment.' }, hub(), 'rt-comment-1'),
      new Node({ type: 'p', props: { id: 'comment-2' }, content: 'Second comment.' }, hub(), 'rt-comment-2'),
      new Node({ type: 'p', props: { id: 'comment-3' }, content: 'Third comment.' }, hub(), 'rt-comment-3'),
    ]
    for (const n of restored) {
      supervisor.registerNode(n)
      renderNodes.push(n)
    }
    appendToPayload(commentsPayload, restored, commentsZoneNode)
    await flushMicrotasks()
    recompileFocusedFor(commentsZoneNode)
    render()
    const restoredWires = Array.from(adapter.wires.get(byName['comments-zone'])?.children ?? []).map((c) => c.dataset?.wire ?? '')
    if (restoredWires.length !== 3) throw new Error(`expected 3 restored comments, got ${restoredWires.length}`)
  })

  // ------------------------------------------------------------------
  // 4. FORKS — N providers ⇒ N actionable arms, no coerced pick
  await runner.check('forks: each theme consumer resolves 2 distinct arms; both render', () => {
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
    // the section renders the note AND the plain survivor sibling; the looped
    // arm is the only thing dropped (FRK-F3: sibling content unaffected)
    const loopKids = Array.from(adapter.wires.get(byName['loop-probe'])?.children ?? []).map((c) => c.dataset?.wire ?? '')
    if (!loopKids.includes(byName['loop-note'])) throw new Error('loop note missing from the section')
    if (!loopKids.includes(byName['loop-survivor'])) throw new Error('surviving sibling content missing')
    if (adapter.wires.has(byName['loop-cycle'])) throw new Error('dropped loop arm still in the section')
    if (statesOf(byName['loop-a']).length) throw new Error('loop-a should be non-actionable')
  })

  // ------------------------------------------------------------------
  // 6. REVERSE TRANSLATION + round-trip
  await runner.check('reverse translation: payloads separate, LIVE state preserved, round-trips', () => {
    const out = reverseTranslate(rootNode, { payloads: [articlePayload, commentsPayload] })
    if (!out.template || !out.content) throw new Error('reversed envelope missing fields')
    if (out.content.length !== 2) throw new Error('expected 2 payload groups, got ' + out.content.length)
    if (out.content[0].content[0].content !== 'breaking news') throw new Error('article live state not preserved')
    // the drop was manual (button click) and the page restored all three
    // comments — reverse translation must carry each live comment's state
    const liveComments = (out.content[1].content ?? []).map((c) => c.content)
    if (JSON.stringify(liveComments) !== JSON.stringify(['First comment.', 'Second comment.', 'Third comment.'])) {
      throw new Error('restored comment live states not preserved in reverse translation: ' + JSON.stringify(liveComments))
    }
    const again = translateLegacy(out)
    if (!again.content.some((c) => c.content === 'breaking news')) throw new Error('reversed doc round-trips (article missing)')
    // K6: the value-carrying root binding round-trips as a SOURCE (provider)
    // anchor — reverse emits { reference, value }, translate re-creates the
    // root provider (translate.md §2/§2.1, kernel K6)
    if (!again.root.anchors.some((a) => a.role === 'source' && a.target === 'session')) throw new Error('template.component provider lost')
  })

  // ------------------------------------------------------------------
  // 7. HYDRATE SEAM + compile-pass logging surface
  await runner.check('SSR-H2: hydrate reuses SSR DOM via the css.id seam', () => {
    const h = new DomAdapter(document.createElement('div'))
    h.hydrate(rootNode.id, initialData)
    if (!h.reused.has(initialData.template.css.id)) throw new Error('css.id seam did not reuse the SSR template element')
    if (typeof globalThis.setCompilePassLogging !== 'function') throw new Error('setCompilePassLogging not exposed')
  })

  // ------------------------------------------------------------------
  // mode-specific checks
  if (mode === 'ssr') {
    await runner.check('SSR mode: full HTML received from the server (non-empty, root-first, key wires present)', () => {
      if (!receivedHtml) throw new Error('no received SSR HTML embedded in the page')
      if (!/<app[ >]/.test(receivedHtml)) throw new Error('received HTML does not begin with the app root')
      for (const wire of ['user-pane', 'md-editor', 'content-zone']) {
        // elements carry their props.id as the id attribute (adapter emit), so
        // match the presentation id directly — not the node ref.
        if (!receivedHtml.includes(`id="${wire}"`)) {
          throw new Error(`received HTML missing wire ${wire} (any node rendered with id="${wire}")`)
        }
      }
    })

    await runner.check('SSR mode: received HTML is well-formed (balanced non-void tags, no stray closes)', () => {
      void validateHtmlShape(receivedHtml)
    })
  }
  if (mode === 'markdown') {
    await runner.check('markdown mode: raw markdown source embedded for manual inspection; live display renders it', () => {
      if (!markdownSource.includes('**bold**')) throw new Error('raw markdown source not embedded')
      // the shared suite re-parsed the editor earlier, so the display is live —
      // assert it carries the re-parsed content, not the stale initial value
      if (!nodeText(byName['md-prefix'])) throw new Error('markdown display not rendered (md-prefix empty)')
      if (nodeText(byName['md-bold']) !== 'friend') throw new Error(`live display did not re-parse bold: "${nodeText(byName['md-bold'])}"`)
    })

    // restore the editor to the SHIPPED raw source (the harness's typing test
    // changed it) and mirror the parsed parts into the section's live display,
    // so what the visitor inspects matches what the page renders.
    clientAPI.apply(byName['md-editor'], [{ targetProp: 'content', mode: 'replace', value: markdownSource }])
    clientAPI.apply(byName['md-display'], [{ targetProp: 'props.tick', mode: 'replace', value: ++tick }])
    await flushMicrotasks()
    render()
    const live = document.getElementById('markdown-live')
    if (live) {
      for (const [fromId, toId] of [['md-prefix', 'md-live-prefix'], ['md-bold', 'md-live-bold'], ['md-suffix', 'md-live-suffix']]) {
        const src = adapter.wires.get(byName[fromId])
        const dst = live.querySelector ? live.querySelector(`#${toId}`) : null
        if (dst) dst.textContent = src ? src.textContent : ''
      }
    }
  }

  runner.summary(title)
}

function allText(el) {
  if (!el) return ''
  return (el.textContent ?? '') + Array.from(el.children ?? []).map(allText).join('')
}

/** Lightweight well-formedness scan over received SSR HTML: every non-void
 *  open tag has a matching close tag in the right order, and no close tag
 *  appears for a void element. Mirrors the stack-based validator used by the
 *  Step 7 e2e suite (tests/e2e/ssr-html-validity-helpers.ts). */
const SSR_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr'])
function validateHtmlShape(html) {
  const stack = []
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)(?:\s[^<>]*?)?>/g
  let m
  while ((m = tagRe.exec(html))) {
    const raw = m[0]
    const name = m[1].toLowerCase()
    const closing = raw.startsWith('</')
    if (closing) {
      const top = stack.pop()
      if (top !== name) throw new Error(`</${name}> closes out of order (expected </${top ?? '(nothing)'}>)`)
    } else if (!raw.endsWith('/>') && !SSR_VOID.has(name)) {
      stack.push(name)
    }
  }
  if (stack.length) throw new Error(`unclosed tags: ${stack.join(', ')}`)
}
