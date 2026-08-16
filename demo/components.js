/**
 * Bonus browser harness — component-driven rendering.
 *
 * Reads the framework data document embedded by scripts/build-demo.mjs
 * (component/placement resolution inputs), re-resolves from the serialized
 * anchors, expands component references into DOM (type/children population +
 * source-value fill), and renders EVERYTHING through the render adapter —
 * the only hand-written HTML is the document skeleton and the #root
 * placeholder. Each test is a content node in the tree; its result is written
 * back through the framework (ClientAPI.apply) and re-rendered via a diff.
 */
import { Node, reconcileParentTargets, Supervisor } from '../dist/core/node.js'
import { diffMinimal } from '../dist/core/render.js'
import { loadState } from '../dist/core/serialize.js'
import { createClient } from '../dist/core/client.js'
import { EventBridge } from '../dist/core/events.js'
import { dispatchEvent } from '../dist/core/handlers.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { applyOps, jsonClone } from '../dist/core/render-helpers.js'
import { hub } from './demo-fixtures.js'

// dev aid: log every compile pass (node ids + states) so dirty-node
// isolation is verifiable in the console — incremental pass-2s list only the
// focused walk path + providers, never unrelated nodes. Toggle anytime:
// window.setCompilePassLogging(false)
setCompilePassLogging(true)
globalThis.setCompilePassLogging = setCompilePassLogging

const initialData = JSON.parse(document.getElementById('preempt-initial-data').textContent)
const serverData = JSON.parse(document.getElementById('server-data').textContent)
const labels = serverData.nodeLabels
const goals = serverData.goals
const byName = {}
for (const [id, l] of Object.entries(labels)) byName[l.name] = id

const rootEl = document.getElementById('root')
const adapter = new DomAdapter(rootEl, { onEvent: handleDomEvent })

// ---- reconstruct the graph from the shipped document (S4.2) --------------
const seeded = loadState(jsonClone(initialData)).map((d) => new Node(d, hub()))
reconcileParentTargets(seeded)
const wireToNode = new Map(seeded.map((n) => [n.id, n]))
const events = new EventBridge()
const supervisor = new Supervisor({ hub: hub(), events })
for (const n of seeded) supervisor.registerNode(n)
const clientAPI = createClient(supervisor)
const ctx = supervisor.handlerContext

// ---- user pane: session + component-provided after-compile handler --------
// The `user-panel` component (source on root) resolves on the pane; the
// after-compile handler (wired here from the resolved component) populates
// the pane's descendants from session state. Login/logout are mock buttons
// driven by the pane's own event handlers.
const predefinedUser = { name: 'Ada Lovelace' }
const session = { loggedIn: false, user: predefinedUser }
let tick = 0

const paneId = byName['user-pane']
const usernameId = byName['username']
const statusId = byName['status']
const loginId = byName['login']
const logoutId = byName['logout']

const paneNode = wireToNode.get(paneId)
const loginNode = wireToNode.get(loginId)
const logoutNode = wireToNode.get(logoutId)

const populateHandler = {
  name: 'user-panel:populate',
  phase: 'after-compile',
  body: (c) => {
    if (session.loggedIn) {
      c.clientAPI.apply(usernameId, [{ targetProp: 'content', mode: 'replace', value: `Welcome, ${session.user.name}` }])
      c.clientAPI.apply(statusId, [{ targetProp: 'content', mode: 'replace', value: 'Signed in' }])
    } else {
      c.clientAPI.apply(usernameId, [{ targetProp: 'content', mode: 'replace', value: 'You are signed out' }])
      c.clientAPI.apply(statusId, [{ targetProp: 'content', mode: 'replace', value: 'Signed out' }])
    }
  },
}
paneNode.addLayer({ id: 'user-handler', handlers: [populateHandler] })
loginNode.addLayer({
  id: 'login-handler',
  handlers: [
    {
      name: 'login',
      event: 'click',
      body: () => {
        session.loggedIn = true
        session.user = predefinedUser // mock login: show the predefined user
        return clientAPI.apply(paneId, [{ targetProp: 'props.tick', mode: 'replace', value: ++tick }])
      },
    },
  ],
})
logoutNode.addLayer({
  id: 'logout-handler',
  handlers: [
    {
      name: 'logout',
      event: 'click',
      body: () => {
        session.loggedIn = false
        return clientAPI.apply(paneId, [{ targetProp: 'props.tick', mode: 'replace', value: ++tick }])
      },
    },
  ],
})

// ---- markdown editor → display window -------------------------------------
// Typing updates the editor source; the display's after-compile handler
// parses **bold** into a strong element. The editor element is NEVER
// replaced (in-place diff + .value writes), so focus is retained while
// typing.
const editorId = byName['editor']
const displayId = byName['display']
const part0Id = byName['part-0']
const part1Id = byName['part-1']
const part2Id = byName['part-2']

const editorNode = wireToNode.get(editorId)
const displayNode = wireToNode.get(displayId)

/** POC markdown: split on the first **bold** pair into prefix/bold/suffix. */
function parseBold(md) {
  const m = /^(.*?)\*\*([^*]+)\*\*(.*)$/.exec(String(md ?? ''))
  if (!m) return { prefix: String(md ?? ''), bold: '', suffix: '' }
  return { prefix: m[1], bold: m[2], suffix: m[3] }
}

const mdRenderHandler = {
  name: 'markdown:render',
  phase: 'after-compile',
  body: (c) => {
    const src = String(c.tree.getNode(editorId)?.content ?? '')
    const { prefix, bold, suffix } = parseBold(src)
    c.clientAPI.apply(part0Id, [{ targetProp: 'content', mode: 'replace', value: prefix }])
    c.clientAPI.apply(part1Id, [{ targetProp: 'content', mode: 'replace', value: bold }])
    c.clientAPI.apply(part2Id, [{ targetProp: 'content', mode: 'replace', value: suffix }])
  },
}
displayNode.addLayer({ id: 'md-handler', handlers: [mdRenderHandler] })

editorNode.addLayer({
  id: 'input-handler',
  handlers: [
    {
      name: 'input',
      event: 'input',
      body: (c, value) => {
        const v = String(value ?? '')
        c.clientAPI.apply(editorId, [{ targetProp: 'content', mode: 'replace', value: v }])
        c.clientAPI.apply(displayId, [{ targetProp: 'props.tick', mode: 'replace', value: ++tick }])
      },
    },
  ],
})

function flushMicrotasks() {
  const waits = []
  for (let i = 0; i < 4; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

/** Browser event → dispatch the node's handlers (with the input value when
 *  the event came from a form element), then re-render through the framework.
 *  The adapter hands us the DOM event object; the event NAME is its `.type`
 *  ('input', 'click', …) — matching `HandlerDef.event`. */
async function handleDomEvent(wire, domEvent) {
  const node = wireToNode.get(wire)
  if (!node) return
  const eventName = domEvent && typeof domEvent === 'object' && typeof domEvent.type === 'string'
    ? domEvent.type
    : String(domEvent ?? '')
  const extra = domEvent && domEvent.target && typeof domEvent.target.value === 'string' ? [domEvent.target.value] : []
  dispatchEvent(node, ctx, eventName, ...extra)
  await flushMicrotasks() // pass-2 → after-compile population
  render()
}

// ---- component expansion (emission layer) --------------------------------
/**
 * Expand one compiled state into renderable elements.
 * - A state whose 'panel-a'/'panel-b' target resolved: the component
 *   reference drives the element TYPE and populates DESCENDANT nodes from the
 *   definition; each child's value comes from its SOURCE reference binding.
 *   The two defs are DISTINCT names (anti-pattern compliance — no same-name
 *   sources), so the consumer's single state carries both bindings.
 * - The user pane resolves the 'user-panel' component → after-compile handler
 *   label; its buttons carry `on:click` bindings dispatched by the adapter.
 * - Placement states render their resolution label.
 * - Every element carries a label describing the resolution it follows.
 */
function expandState(state, armIdx) {
  const els = []
  const label = (wire, text, cls) => {
    els.push({ wire: `${wire}:label`, type: 'span', props: { 'css:classes': cls ?? ['res-label'], text }, childOrder: [] })
  }
  const classes = state.css?.classes ? [...state.css.classes] : []
  const def = state.bindings['panel-a'] ?? state.bindings['panel-b']

  if (def) {
    // component reference for type/children → populated descendant nodes.
    // The consumer carries a single state (distinct provider names), so its
    // wire is the plain node id — no arm suffix.
    const wire = state.nodeId
    const children = def.children.map((spec) => {
      const cw = `${wire}:${spec.bind}`
      els.push({ wire: cw, type: spec.type, props: { text: state.bindings[spec.bind] ?? '(missing)', 'css:classes': ['bound-value'] }, childOrder: [`${cw}:label`] })
      label(cw, `component: ${spec.bind} (source ref)`, ['res-label', 'child'])
      return cw
    })
    els.push({
      wire,
      type: def.type,
      props: { 'css:classes': ['panel'], 'prop:data-resolution': 'component:panel-a/panel-b' },
      childOrder: [...children, `${wire}:label`],
    })
    label(wire, def.label, ['res-label', 'panel-label'])
    return els
  }

  const placement = state.anchors.find((a) => a.role === 'container')
  const unresolved = state.unresolved.length > 0
  const userPanel = state.bindings['user-panel']
  const node = wireToNode.get(state.nodeId)
  const eventHandlers = node ? (node.handlers ?? []).filter((h) => h && typeof h.event === 'string') : []
  const props = { 'css:classes': classes }
  if (state.content !== undefined) props['text'] = state.content
  if (placement) props['prop:data-resolution'] = `placement:${placement.target}`
  if (unresolved) props['prop:data-resolution'] = 'component:missing → unresolved-reference'
  if (userPanel) props['prop:data-resolution'] = 'component:user-panel → after-compile handler'
  for (const h of eventHandlers) props[`on:${h.event}`] = true
  els.push({ wire: state.nodeId, type: state.type, props, childOrder: [...state.children, `${state.nodeId}:label`] })
  const labelText = placement
    ? `placement: ${placement.target}`
    : unresolved
      ? 'component: missing → unresolved-reference (own content still renders)'
      : userPanel
        ? 'component: user-panel — after-compile handler populates descendants'
        : eventHandlers.length
          ? `on:${eventHandlers.map((h) => h.event).join(', on:')} → ${eventHandlers.map((h) => h.name).join(', ')} (mock session)`
          : classes.includes('test-item')
            ? 'content node · test (goal updated by the pipeline)'
            : 'content node'
  label(state.nodeId, labelText)
  return els
}

function buildElementsFrom() {
  const els = []
  for (const states of prevStates.values()) {
    states.forEach((s, i) => {
      els.push(...expandState(s, states.length > 1 ? i : 0))
    })
  }
  return els
}

function setStates(actionable) {
  const byNode = new Map()
  for (const s of actionable) {
    const arr = byNode.get(s.nodeId) ?? []
    arr.push(s)
    byNode.set(s.nodeId, arr)
  }
  for (const [id, states] of byNode) prevStates.set(id, states)
}

/** Incremental render: consume the supervisor's pass-2 compiled states
 *  (the flush was awaited, so every dirty node's compile has resolved) and
 *  merge them into the cached state set — no render-side compile. */
let prevStates = new Map()
let prevMap = null
let bootstrapped = false
function render() {
  const rootNode = seeded[0]
  // bootstrap (first full compile) logs compile warnings — e.g. node-7's
  // dangling-reference warning fires ONCE on load (S-R4.3). Incremental
  // re-renders stay silent: their warnings are scoped to the pass-2 focus.
  const silent = console.warn
  if (bootstrapped) console.warn = () => {}
  if (!bootstrapped) {
    const cr = rootNode.compile(seeded)
    setStates(cr.actionable)
  } else {
    const fresh = supervisor.takePass2States()
    for (const [id, arr] of fresh) prevStates.set(id, arr)
  }
  console.warn = silent
  bootstrapped = true
  const els = buildElementsFrom()
  const ops = diffMinimal(prevMap, els)
  adapter.beginBatch()
  applyOps(adapter, ops)
  adapter.endBatch()
  prevMap = new Map(els.map((e) => [e.wire, e]))
  return { els }
}

function nodeText(wire) {
  const el = adapter.wires.get(wire)
  return el ? el.textContent : ''
}

/** Merged compiled states for a node (bootstrap + incremental recompiles). */
function statesOf(id) {
  return prevStates.get(id) ?? []
}

async function main() {
  // initial population: trigger pass-2 once so the pane's after-compile
  // handler runs (component-provided) and the display parses **bold**
  // before the first paint
  clientAPI.apply(paneId, [{ targetProp: 'props.init', mode: 'replace', value: true }])
  clientAPI.apply(displayId, [{ targetProp: 'props.init', mode: 'replace', value: true }])
  await flushMicrotasks()
  render()

  const panelId = byName['panel']
  const zoneId = byName['zone']
  const introId = byName['intro']
  const footerId = byName['footer']
  const testIds = goals.map((_, i) => byName[`t${i + 1}`])
  const introContent = labels[introId].content

  const warnCount = (fn) => {
    let n = 0
    const o = console.warn
    console.warn = () => {
      n++
    }
    try {
      fn()
    } finally {
      console.warn = o
    }
    return n
  }

  const warnCountAsync = async (fn) => {
    let n = 0
    const o = console.warn
    console.warn = () => {
      n++
    }
    try {
      await fn()
    } finally {
      console.warn = o
    }
    return n
  }

  const checks = [
    {
      // T1/T6 — two DISTINCT panel providers (panel-a/panel-b) resolve into
      // ONE consumer state carrying both def bindings; the single element
      // renders as a SECTION (anti-pattern compliance: no same-name sources)
      run: () => {
        const arms = statesOf(panelId)
        if (arms.length !== 1) throw new Error(`expected 1 panel state (two distinct providers), got ${arms.length}`)
        if (arms[0].bindings['panel-a']?.type !== 'section') throw new Error('panel-a def binding missing')
        if (arms[0].bindings['panel-b']?.type !== 'section') throw new Error('panel-b def binding missing')
        const p0 = adapter.wires.get(panelId)
        if (!p0 || p0.tagName !== 'SECTION') throw new Error('panel element not rendered as a section')
      },
    },
    {
      run: () => {
        if (!nodeText(`${panelId}:heading`).includes('Hello from a component source')) throw new Error('heading source value not populated')
        if (!nodeText(`${panelId}:body`).includes('Values resolve from source anchors')) throw new Error('body source value not populated')
        if (adapter.wires.get(`${panelId}:heading`)?.tagName !== 'H2') throw new Error('populated child wrong type')
      },
    },
    {
      run: () => {
        const zone = adapter.wires.get(zoneId)
        if (!zone) throw new Error('zone element missing')
        if (zone.getAttribute('data-resolution') !== 'placement:slot-alpha') throw new Error(`wrong placement label: ${zone.getAttribute('data-resolution')}`)
        if (!nodeText(`${zoneId}:label`).includes('placement: slot-alpha')) throw new Error('placement resolution label not rendered')
      },
    },
    {
      run: () => {
        for (const id of testIds) {
          if (!adapter.wires.has(id)) throw new Error(`test node ${id} not rendered`)
          if (!nodeText(id).trim()) throw new Error(`test node ${id} has no content`)
        }
      },
    },
    {
      run: async () => {
        // count the warning through the framework's own focused pass-2
        // (the supervisor compiles the intro node, scoped + non-silent)
        const warns = await warnCountAsync(async () => {
          const introNode = wireToNode.get(introId)
          if (!introNode) return
          clientAPI.apply(introId, [{ targetProp: 'props.probe', mode: 'replace', value: 'x' }])
          await flushMicrotasks()
        })
        if (warns === 0) throw new Error('expected an unresolved-reference warning')
        const introState = statesOf(introId)[0]
        if (!introState?.unresolved?.length) throw new Error('intro should be unresolved')
        if (!nodeText(introId).includes(introContent)) throw new Error('intro own content not rendered')
      },
    },
    {
      run: () => {
        const arms = statesOf(panelId)
        if (arms.length !== 1) throw new Error(`expected 1 panel state, got ${arms.length}`)
        if (!arms[0].pathKey) throw new Error('panel state missing its pathKey')
      },
    },
    {
      // T7 — user pane: component-provided after-compile handler populates
      // descendants; mock login shows the predefined user; logout clears it
      run: async () => {
        const paneState = statesOf(paneId)[0]
        if (!paneState?.bindings['user-panel']) throw new Error('user-panel component did not resolve as the handler source')
        // initial: signed out (populated by the after-compile handler)
        if (!nodeText(usernameId).includes('You are signed out')) throw new Error(`expected signed-out username, got "${nodeText(usernameId)}"`)
        if (nodeText(statusId).trim() !== 'Signed out') throw new Error(`expected status Signed out, got "${nodeText(statusId)}"`)
        // mock login → predefined user
        dispatchEvent(loginNode, ctx, 'click')
        await flushMicrotasks()
        render()
        if (!nodeText(usernameId).includes('Welcome, Ada Lovelace')) throw new Error(`predefined user not shown: "${nodeText(usernameId)}"`)
        if (nodeText(statusId).trim() !== 'Signed in') throw new Error(`expected status Signed in, got "${nodeText(statusId)}"`)
        // logout → cleared
        dispatchEvent(logoutNode, ctx, 'click')
        await flushMicrotasks()
        render()
        if (nodeText(statusId).trim() !== 'Signed out') throw new Error('logout did not clear the session')
        if (!nodeText(usernameId).includes('You are signed out')) throw new Error('username not reset after logout')
        // all state changes flowed through the managed channel (journaled)
        if (supervisor.journal.length < 5) throw new Error(`expected journaled updates, got ${supervisor.journal.length}`)
      },
    },
    {
      // T8 — markdown display: typing updates the source; **bold** parses
      // into a strong element; elements update IN PLACE (no rebuild, so the
      // editor never loses focus)
      run: async () => {
        // initial parse of "Hello **world**!"
        if (nodeText(part1Id).trim() !== 'world') throw new Error(`expected initial bold "world", got "${nodeText(part1Id)}"`)
        if (nodeText(part0Id).trim() !== 'Hello') throw new Error(`expected prefix "Hello ", got "${nodeText(part0Id)}"`)
        if (adapter.wires.get(part1Id)?.tagName !== 'STRONG') throw new Error('bold part is not a strong element')

        // capture element identity — replacement would mean focus loss
        const editorEl = adapter.wires.get(editorId)
        const boldEl = adapter.wires.get(part1Id)

        // typing: simulate the textarea input handler with the new source
        dispatchEvent(editorNode, ctx, 'input', 'Goodbye **bold** reader')
        await flushMicrotasks()
        render()

        // editor updated in place (same element object → focus retained)
        if (adapter.wires.get(editorId) !== editorEl) throw new Error('editor element was replaced (focus would be lost)')
        if (adapter.wires.get(part1Id) !== boldEl) throw new Error('strong element was replaced')
        // markdown re-parsed into the structured nodes
        if (nodeText(part0Id).trim() !== 'Goodbye') throw new Error(`expected prefix "Goodbye ", got "${nodeText(part0Id)}"`)
        if (nodeText(part1Id).trim() !== 'bold') throw new Error(`expected bold "bold", got "${nodeText(part1Id)}"`)
        if (nodeText(part2Id).trim() !== 'reader') throw new Error(`expected suffix " reader", got "${nodeText(part2Id)}"`)

        // parent change: updating the display container leaves parts in place
        const suffixEl = adapter.wires.get(part2Id)
        clientAPI.apply(displayId, [{ targetProp: 'props.note', mode: 'replace', value: 'x' }])
        await flushMicrotasks()
        render()
        if (adapter.wires.get(part1Id) !== boldEl) throw new Error('parent update replaced the bold element')
        if (adapter.wires.get(part2Id) !== suffixEl) throw new Error('parent update replaced the suffix element')
        if (nodeText(part1Id).trim() !== 'bold') throw new Error('parent update clobbered the parsed content')

        // everything flowed through the managed channel
        if (supervisor.journal.length < 12) throw new Error(`expected journaled updates, got ${supervisor.journal.length}`)
      },
    },
  ]

  let passed = 0
  for (let i = 0; i < checks.length; i++) {
    try {
      await checks[i].run()
      passed++
      clientAPI.apply(testIds[i], [
        { targetProp: 'content', mode: 'replace', value: `PASS — ${goals[i]}` },
        { targetProp: 'css.classes', mode: 'replace', value: ['test-item', 'pass'] },
      ])
    } catch (e) {
      clientAPI.apply(testIds[i], [
        { targetProp: 'content', mode: 'replace', value: `FAIL — ${goals[i]} (${e.message})` },
        { targetProp: 'css.classes', mode: 'replace', value: ['test-item', 'fail'] },
      ])
    }
    await flushMicrotasks() // let the pass-2 flush drain, then render incrementally
    render()
  }
  const failed = checks.length - passed
  clientAPI.apply(footerId, [
    {
      targetProp: 'content',
      mode: 'replace',
      value: `Summary: ${passed} passed, ${failed} failed — component & placement resolutions verified in-browser (every element framework-rendered)`,
    },
  ])
  await flushMicrotasks()
  render()
}

main()
