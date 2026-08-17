/**
 * hooks-scenarios — the VALUE-PROVIDER SLOT SPA page
 * (docs/specs/hooks-map-review.md §7 contract amendment B — the user's
 * directive: "create single-page application scenarios that implement the
 * hooks logic").
 *
 * One module, three roles (the handlers-scenarios.js pattern):
 *
 *  1. DATA (`hooksScenariosEnvelope`): ONE legacy envelope (translate.md §1
 *     LegacyInitialData) whose root carries the THREE value providers as
 *     `component` value bindings (`theme` / `user` / `counter` — scalars,
 *     never def-shaped) + the `hooks: ['theme','user','counter']` field
 *     naming them. The scenario CARDS (theme switcher / session panel / live
 *     counter) are authored sections containing the consumer readouts
 *     (component target bindings + derived `bindings.*` bakes) and the
 *     CONTROL buttons, whose click bodies are function-STRING data. Every
 *     control body writes its hook through the MANAGED CHANNEL
 *     (`context.clientAPI.apply(id, [{ targetProp: 'hooks.<name>', mode:
 *     'replace', value }])`) — never direct node access (the api.md §1
 *     letter; hooks-map-review §7.2 pin 1). A use case that needs an
 *     outside script/function is a data-authoring mistake (blind-test rule).
 *
 *     The root is a PURE provider — F3-dropped from render ("a value
 *     holder, never an element", node.md) — so it carries no element; the
 *     cards (its family children) render. The control bodies walk the
 *     FAMILY chain up to the root (`while (provider.parent) ...`) to find
 *     the provider id — the hook write target.
 *
 *  2. NODE side (`hooksScenariosServerData`): the builder's expected
 *     census — the SAME core pipeline the page runs (translate → register →
 *     ONE bootstrap compile → recordResolved) minus the DOM render —
 *     embedded in server-data; the page publishes its OWN measured census
 *     (captured pre-interaction) and the smoke pins equality.
 *
 *  3. PAGE (browser, `typeof document !== 'undefined'` guard): CORE-ONLY
 *     imports (dist/core/*) + the shared runner. The harness mirrors the
 *     supervisor pass-2 flush (compile → recordResolved → emit → apply) and
 *     drives the controls through `dispatchEvent`; the runner checks assert
 *     the hook write → cascade → rendered-output chain. Banner:
 *     `hooks-scenarios`; sets `globalThis.__hooksScenariosDone` +
 *     `__hooksScenariosProfile` for the smoke.
 *
 * Scenario map (the SPA scenarios):
 *  S1  THEME SWITCHER   — `hooks.theme` writes (light/dark) cascade into the
 *                        theme readout (text + derived themeName bake)
 *  S2  USER/SESSION      — login/logout writes `hooks.user` repopulate the
 *                        session readout
 *  S3  LIVE COUNTER      — the tick buttons read the readout's derived count
 *                        bake and write `hooks.counter`; the badge follows
 *  S4  USER CONTRACT     — N hook writes land ONE `hook-<name>` layer
 *                        (replace-in-place — the layer stack stays O(1));
 *                        `hook-name-unresolved` / `hook-seam-exempt` /
 *                        `hook-mode-blocked` containments on the page.
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { createClient } from '../dist/core/client.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { dispatchEvent } from '../dist/core/handlers.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner } from './lib/runner.js'

// ============================================================================
// DATA — the SPA envelope. Control bodies are `(event, context)` function
// strings (the seam's legacy format — the bridge wraps them so bodies receive
// (event, context), handlers.md §6).
// ============================================================================

/** S1 — SetTheme: write `hooks.theme` on the root (the provider node —
 *  walked up the FAMILY chain from the control button) through the managed
 *  channel. The event arg carries the target theme. */
const SET_THEME_BODY = `function (event, context) {
  var value = event.value == null ? 'dark' : String(event.value);
  var provider = event.target;
  while (provider && provider.parent) { provider = provider.parent; }
  if (!provider) return;
  var res = context.clientAPI.apply(provider.id, [{ targetProp: 'hooks.theme', mode: 'replace', value: value }]);
  return res.status;
}`

/** S2 — Login / Logout: write `hooks.user` (the session label). The event
 *  arg carries the label (login) or 'guest' (logout). */
const LOGIN_BODY = `function (event, context) {
  var value = event.value == null ? 'alice (admin)' : String(event.value);
  var provider = event.target;
  while (provider && provider.parent) { provider = provider.parent; }
  if (!provider) return;
  var res = context.clientAPI.apply(provider.id, [{ targetProp: 'hooks.user', mode: 'replace', value: value }]);
  return res.status;
}`
const LOGOUT_BODY = `function (event, context) {
  var provider = event.target;
  while (provider && provider.parent) { provider = provider.parent; }
  if (!provider) return;
  var res = context.clientAPI.apply(provider.id, [{ targetProp: 'hooks.user', mode: 'replace', value: 'guest' }]);
  return res.status;
}`

/** S3 — CounterTick: the "external live source" injector — the control is
 *  the boundary where the external update (websocket tick, job queue, ...)
 *  enters the framework: the event arg carries the ABSOLUTE incoming value
 *  (`+1` → the source pushed 1, `-1` → it pushed the previous count) and
 *  the body pushes it into `hooks.counter` through the managed channel —
 *  the consumers follow via the source→target cascade. The body never reads
 *  a value back (the external world owns the number). */
const COUNTER_TICK_BODY = `function (event, context) {
  var v = Number(event.value);
  if (Number.isNaN(v)) return;
  var provider = event.target;
  while (provider && provider.parent) { provider = provider.parent; }
  if (!provider) return;
  var res = context.clientAPI.apply(provider.id, [{ targetProp: 'hooks.counter', mode: 'replace', value: v }]);
  return res.status;
}`

export function hooksScenariosEnvelope() {
  return {
    template: {
      root: {
        type: 'div',
        props: { id: 'hooks-root' },
        children: [
          // ---- S1 — the theme switcher card ---------------------------------
          {
            type: 'section',
            props: { id: 'theme-card' },
            css: { classes: ['scenario-card', 'theme-card'] },
            children: [
              { type: 'h3', props: { id: 'theme-title' }, content: 'Scenario 1 — Theme switcher (hooks.theme)' },
              {
                type: 'p',
                props: { id: 'theme-expect' },
                css: { classes: ['expect'] },
                content: 'The control buttons write hooks.theme through clientAPI.apply (managed channel); the source→target cascade re-renders the readout (text + the derived themeName bake).',
              },
              {
                type: 'div',
                props: { id: 'theme-readout' },
                css: { classes: ['theme-readout'] },
                component: [{ reference: 'theme' }],
                derived: { props: { themeName: { $: 'bindings.theme' } } },
              },
              {
                type: 'button',
                props: { id: 'theme-light-btn' },
                css: { classes: ['control-btn'] },
                content: 'Set light theme',
                component: [{ target: 'handlers.click', reference: 'SetTheme' }],
              },
              {
                type: 'button',
                props: { id: 'theme-dark-btn' },
                css: { classes: ['control-btn'] },
                content: 'Set dark theme',
                component: [{ target: 'handlers.click', reference: 'SetTheme' }],
              },
            ],
          },
          // ---- S2 — the user/session panel card -----------------------------
          {
            type: 'section',
            props: { id: 'session-card' },
            css: { classes: ['scenario-card', 'session-card'] },
            children: [
              { type: 'h3', props: { id: 'session-title' }, content: 'Scenario 2 — User/session panel (hooks.user)' },
              {
                type: 'p',
                props: { id: 'session-expect' },
                css: { classes: ['expect'] },
                content: 'Login/logout write hooks.user; the session readout repopulates through the source→target cascade.',
              },
              {
                type: 'div',
                props: { id: 'session-readout' },
                css: { classes: ['session-readout'] },
                component: [{ reference: 'user' }],
                derived: { props: { sessionLabel: { $: 'bindings.user' } } },
              },
              {
                type: 'button',
                props: { id: 'login-btn' },
                css: { classes: ['control-btn'] },
                content: 'Log in as alice',
                component: [{ target: 'handlers.click', reference: 'Login' }],
              },
              {
                type: 'button',
                props: { id: 'logout-btn' },
                css: { classes: ['control-btn'] },
                content: 'Log out',
                component: [{ target: 'handlers.click', reference: 'Logout' }],
              },
            ],
          },
          // ---- S3 — the live counter/badge card -----------------------------
          {
            type: 'section',
            props: { id: 'counter-card' },
            css: { classes: ['scenario-card', 'counter-card'] },
            children: [
              { type: 'h3', props: { id: 'counter-title' }, content: 'Scenario 3 — Live counter / badge (hooks.counter)' },
              {
                type: 'p',
                props: { id: 'counter-expect' },
                css: { classes: ['expect'] },
                content: 'The tick controls are the boundary where the EXTERNAL live source enters: the event arg carries the incoming absolute count and the body pushes it into hooks.counter through the managed channel — the badge follows every push via the source→target cascade.',
              },
              {
                type: 'div',
                props: { id: 'counter-readout' },
                css: { classes: ['counter-readout', 'counter-badge'] },
                component: [{ reference: 'counter' }],
                derived: { props: { count: { $: 'bindings.counter' } } },
              },
              {
                type: 'button',
                props: { id: 'counter-inc-btn' },
                css: { classes: ['control-btn'] },
                content: '+1',
                component: [{ target: 'handlers.click', reference: 'CounterTick' }],
              },
              {
                type: 'button',
                props: { id: 'counter-dec-btn' },
                css: { classes: ['control-btn'] },
                content: '-1',
                component: [{ target: 'handlers.click', reference: 'CounterTick' }],
              },
            ],
          },
        ],
        component: [
          { reference: 'theme', value: 'dark' },
          { reference: 'user', value: 'guest' },
          { reference: 'counter', value: 0 },
          { reference: 'SetTheme', value: { name: 'SetTheme', body: SET_THEME_BODY } },
          { reference: 'Login', value: { name: 'Login', body: LOGIN_BODY } },
          { reference: 'Logout', value: { name: 'Logout', body: LOGOUT_BODY } },
          { reference: 'CounterTick', value: { name: 'CounterTick', body: COUNTER_TICK_BODY } },
        ],
        hooks: ['theme', 'user', 'counter'],
      },
    },
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

export function hooksScenariosEnvelopes() {
  return { main: hooksScenariosEnvelope() }
}

// ============================================================================
// Shared pipeline half — the pre-render core pipeline per mount (page AND
// builder run the IDENTICAL sequence; only the emit/apply side differs).
// ============================================================================

function flushMicrotasks() {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

/** Translate → register → ONE bootstrap compile → recordResolved. */
export async function buildHooksScenariosSurface() {
  const translated = translateLegacy(hooksScenariosEnvelope())
  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  supervisor.recordResolved(translated.root.compile(translated.nodes).actionable)
  await flushMicrotasks()
  return { translated, supervisor }
}

/** Per-supervisor census (the handlers-scenarios convention: destroyed
 *  excluded from inTree). */
export function censusOf(supervisor) {
  const all = supervisor.allNodes()
  return {
    registered: all.length,
    inTree: all.filter((n) => !n.destroyed && n.isInTree).length,
    unplaced: all.filter((n) => !n.destroyed && n.state === 'unplaced').length,
    destroyed: all.filter((n) => n.destroyed).length,
    prototypes: all.filter((n) => n.state === 'prototype').length,
    cloneOps: 0,
  }
}

/** Expected census + goals, embedded in server-data by the builder. The page
 *  publishes its OWN measured census (captured pre-interaction, after the
 *  identical pipeline) — the smoke pins equality. */
export async function hooksScenariosServerData() {
  const { supervisor } = await buildHooksScenariosSurface()
  return {
    goals: [
      'S1 theme switcher: hooks.theme writes through clientAPI.apply (managed channel) cascade into the theme readout (text + derived themeName bake)',
      'S2 session panel: login/logout hooks.user writes repopulate the session readout through the source→target cascade',
      'S3 live counter: the tick controls read the derived count bake and write hooks.counter; the badge follows',
      'S4 user contract: N hook writes land ONE deterministic hook-<name> replace-in-place layer (the layer stack stays O(1)) + the cascade actually re-renders the consumers; hook-name-unresolved / hook-seam-exempt / hook-mode-blocked containments',
    ],
    expected: { census: censusOf(supervisor) },
  }
}

// ============================================================================
// PAGE — browser module (runs only when a DOM is present; the smoke shim and
// the real browser both provide one, the Node builder does not).
// ============================================================================

if (typeof document !== 'undefined') {
  setCompilePassLogging(true)
  globalThis.setCompilePassLogging = setCompilePassLogging

  const runner = makeRunner()
  document.getElementById('results').appendChild(runner.el)

  const payload = JSON.parse(document.getElementById('preempt-initial-data').textContent.trim())
  const serverData = JSON.parse(document.getElementById('server-data').textContent.trim())

  // ---- profiling -----------------------------------------------------------
  const PROFILE = {
    loadMs: 0, compileMs: 0, flushMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    checksMs: 0, totalMs: 0, coveredMs: 0, renderCount: 0, compileCalls: 0,
    hookWrites: 0, maxHookLayers: 0,
    registered: 0, inTree: 0, unplaced: 0, destroyed: 0, prototypes: 0, cloneOps: 0,
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }
  async function accAsync(key, fn) {
    const t0 = now()
    const r = await fn()
    PROFILE[key] += now() - t0
    return r
  }

  // ---- the mount pipeline ---------------------------------------------------
  const env = payload.main
  const translated = acc('loadMs', () => translateLegacy(env))
  const events = new EventBridge()
  const sup = new Supervisor({ events })
  for (const n of translated.nodes) sup.registerNode(n)
  const clientAPI = createClient(sup)
  const adapter = new DomAdapter(document.getElementById('mount-main'))
  const ctx = sup.handlerContext
  const prevStates = new Map()
  let prevMap = null

  function mergeStates(byNode) {
    for (const [id, arr] of byNode) {
      const n = sup.getNode(id)
      if (!n || n.destroyed || !n.isInTree) {
        prevStates.delete(id)
        continue
      }
      prevStates.set(id, arr)
    }
  }
  function groupByNode(actionable) {
    const byNode = new Map()
    for (const s of actionable) {
      const arr = byNode.get(s.nodeId) ?? []
      arr.push(s)
      byNode.set(s.nodeId, arr)
    }
    return byNode
  }
  function renderEmit() {
    for (const [id] of prevStates) {
      const n = sup.getNode(id)
      if (!n || n.destroyed || !n.isInTree) prevStates.delete(id)
    }
    const actionable = []
    for (const [, states] of prevStates) actionable.push(...states)
    const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
    const els = acc('emitMs', () => emitElements(actionable, byNode))
    const ops = acc('diffMs', () => diffMinimal(prevMap, els))
    acc('applyMs', () => {
      adapter.beginBatch()
      applyOps(adapter, ops)
      adapter.endBatch()
    })
    prevMap = new Map(els.map((e) => [e.wire, e]))
    PROFILE.renderCount += 1
  }
  function bootstrap() {
    const cr = acc('compileMs', () => translated.root.compile(translated.nodes))
    PROFILE.compileCalls += 1
    mergeStates(groupByNode(cr.actionable))
    sup.recordResolved(cr.actionable)
  }
  async function interact(fn) {
    fn()
    await accAsync('flushMs', async () => {
      await flushMicrotasks()
      mergeStates(sup.takePass2States())
    })
    renderEmit()
  }
  /** The managed-channel hook write from the PAGE harness (the "external
   *  update" boundary — e.g. a websocket tick): clientAPI.apply, never a
   *  direct node write (api.md §1 letter). Tracks the write count + the
   *  hook-<name> layer stack height for the O(1) proof. */
  async function hookWrite(name, value) {
    const provider = sup.getNode(translated.root.id)
    const res = clientAPI.apply(provider.id, [{ targetProp: `hooks.${name}`, mode: 'replace', value }])
    PROFILE.hookWrites += 1
    const hookLayers = provider.layers.filter((l) => l.id === `hook-${name}`).length
    PROFILE.maxHookLayers = Math.max(PROFILE.maxHookLayers, hookLayers)
    await accAsync('flushMs', async () => {
      await flushMicrotasks()
      mergeStates(sup.takePass2States())
    })
    renderEmit()
    return res
  }

  bootstrap()
  renderEmit()

  // census — captured pre-interaction
  const c = censusOf(sup)
  for (const k of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) PROFILE[k] += c[k]

  // ---- check-surface helpers (shim- AND browser-compatible) -----------------
  function findNodeInGraph(id) {
    return sup.allNodes().find((n) => !n.destroyed && n.props?.id === id) ?? null
  }
  function findInMount(id) {
    const stack = [document.getElementById('mount-main')]
    while (stack.length > 0) {
      const el = stack.pop()
      if (!el) continue
      if ((el.id || el.getAttribute?.('id') || '') === id) return el
      const kids = el.children ?? []
      for (let i = 0; i < kids.length; i += 1) stack.push(kids[i])
    }
    return null
  }
  function ownText(el) {
    if (!el) return ''
    if (el.childNodes && el.childNodes.length > 0) {
      let out = ''
      for (const n of el.childNodes) if (n.nodeType === 3) out += n.textContent ?? ''
      return out
    }
    return el.textContent ?? ''
  }

  // ---- checks ----------------------------------------------------------------
  async function main() {
    const checksT0 = now()
    const flushAtChecksStart = PROFILE.flushMs

    // ---- S1 — theme switcher -------------------------------------------------
    await runner.check('S1: boot — the theme readout shows the authored value "dark" (text + derived themeName bake)', () => {
      const ro = findInMount('theme-readout')
      if (!ro) throw new Error('theme readout element missing')
      if (ownText(ro) !== 'dark') throw new Error(`text=${JSON.stringify(ownText(ro))}`)
      if (ro.getAttribute('themeName') !== 'dark') throw new Error(`themeName=${ro.getAttribute('themeName')}`)
    })
    await runner.check('S1: "Set light theme" → the control body writes hooks.theme (managed channel) → the cascade re-renders the readout', async () => {
      const btn = findNodeInGraph('theme-light-btn')
      await interact(() => dispatchEvent(btn, ctx, 'click', 'light'))
      const ro = findInMount('theme-readout')
      if (!ro || ownText(ro) !== 'light') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
      if (ro.getAttribute('themeName') !== 'light') throw new Error(`themeName=${ro.getAttribute('themeName')}`)
    })
    await runner.check('S1: "Set dark theme" → the same hook write path flips the readout back', async () => {
      const btn = findNodeInGraph('theme-dark-btn')
      await interact(() => dispatchEvent(btn, ctx, 'click', 'dark'))
      const ro = findInMount('theme-readout')
      if (!ro || ownText(ro) !== 'dark') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
    })

    // ---- S2 — user/session panel ---------------------------------------------
    await runner.check('S2: boot — the session readout shows the authored label "guest"', () => {
      const ro = findInMount('session-readout')
      if (!ro || ownText(ro) !== 'guest') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
    })
    await runner.check('S2: login → hooks.user write repopulates the readout ("alice (admin)")', async () => {
      const btn = findNodeInGraph('login-btn')
      await interact(() => dispatchEvent(btn, ctx, 'click', 'alice (admin)'))
      const ro = findInMount('session-readout')
      if (!ro || ownText(ro) !== 'alice (admin)') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
      if (ro.getAttribute('sessionLabel') !== 'alice (admin)') throw new Error(`sessionLabel=${ro.getAttribute('sessionLabel')}`)
    })
    await runner.check('S2: logout → hooks.user write restores the guest label', async () => {
      const btn = findNodeInGraph('logout-btn')
      await interact(() => dispatchEvent(btn, ctx, 'click'))
      const ro = findInMount('session-readout')
      if (!ro || ownText(ro) !== 'guest') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
    })

    // ---- S3 — live counter/badge ----------------------------------------------
    await runner.check('S3: boot — the counter badge shows 0 (the authored provider value)', () => {
      const ro = findInMount('counter-readout')
      if (!ro || ownText(ro) !== '0') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
    })
    await runner.check('S3: the live source pushes 1, 2, 3 → the badge follows through the source→target cascade', async () => {
      const btn = findNodeInGraph('counter-inc-btn')
      for (const v of ['1', '2', '3']) {
        await interact(() => dispatchEvent(btn, ctx, 'click', v))
      }
      const ro = findInMount('counter-readout')
      if (!ro || ownText(ro) !== '3') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
      if (ro.getAttribute('count') !== '3') throw new Error(`count=${ro.getAttribute('count')}`)
    })
    await runner.check('S3: the live source pushes 2 (a decrement) → the badge follows', async () => {
      const btn = findNodeInGraph('counter-dec-btn')
      await interact(() => dispatchEvent(btn, ctx, 'click', '2'))
      const ro = findInMount('counter-readout')
      if (!ro || ownText(ro) !== '2') throw new Error(`text=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
    })

    // ---- S4 — the user contract ------------------------------------------------
    await runner.check('S4: a repeated SAME-value write is a layer short-circuit — the hook-<name> layer stays ONE (replace-in-place)', async () => {
      const provider = sup.getNode(translated.root.id)
      const btn = findNodeInGraph('theme-light-btn')
      await interact(() => dispatchEvent(btn, ctx, 'click', 'light'))
      const ro = findInMount('theme-readout')
      if (!ro || ownText(ro) !== 'light') throw new Error(`text=${JSON.stringify(ownText(ro))}`)
      const themeLayers = provider.layers.filter((l) => l.id === 'hook-theme').length
      if (themeLayers !== 1) throw new Error(`hook-theme layers=${themeLayers} — the stack grew`)
    })
    await runner.check('S4: N hook writes land ONE deterministic hook-<name> layer (the layer stack stays O(1))', async () => {
      const provider = sup.getNode(translated.root.id)
      for (let i = 0; i < 20; i += 1) {
        await hookWrite('counter', 100 + i)
      }
      const themeLayers = provider.layers.filter((l) => l.id === 'hook-theme').length
      const counterLayers = provider.layers.filter((l) => l.id === 'hook-counter').length
      const userLayers = provider.layers.filter((l) => l.id === 'hook-user').length
      if (themeLayers !== 1 || counterLayers !== 1 || userLayers !== 1) {
        throw new Error(`hook layers theme=${themeLayers} counter=${counterLayers} user=${userLayers} — the stack grew`)
      }
      if (provider.layers.filter((l) => l.id.startsWith('hook-')).length !== 3) {
        throw new Error('the hook-layer family grew beyond the deterministic one-per-name set (theme/user/counter)')
      }
      const ro = findInMount('counter-readout')
      if (!ro || ownText(ro) !== '119') throw new Error(`badge after 20 writes=${JSON.stringify(ro ? ownText(ro) : 'missing')}`)
    })
    await runner.check('S4: hook-name-unresolved — a name with no provider anchor is rejected on the managed channel', async () => {
      const provider = sup.getNode(translated.root.id)
      const res = clientAPI.apply(provider.id, [{ targetProp: 'hooks.nosuch', mode: 'replace', value: 'x' }])
      if (res.status !== 'rejected') throw new Error(`status=${res.status}`)
      if (res.error?.code !== 'hook-name-unresolved') throw new Error(`code=${res.error?.code}`)
    })
    await runner.check('S4: hook-mode-blocked — append/replaceAll are rejected', async () => {
      const provider = sup.getNode(translated.root.id)
      const res = clientAPI.apply(provider.id, [{ targetProp: 'hooks.theme', mode: 'append', value: 'x' }])
      if (res.status !== 'rejected') throw new Error(`status=${res.status}`)
      if (res.error?.code !== 'hook-mode-blocked') throw new Error(`code=${res.error?.code}`)
    })
    await runner.check('S4: hook-seam-exempt — a def-shaped provider is a no-op (warn) + the def value stays', async () => {
      // SetTheme is a def-shaped ({name, body}) provider: hooking it would
      // tear down the handler seam — the write is exempt with a K4 warn.
      const provider = sup.getNode(translated.root.id)
      const res = clientAPI.apply(provider.id, [{ targetProp: 'hooks.SetTheme', mode: 'replace', value: 'x' }])
      if (res.status !== 'applied') throw new Error(`status=${res.status}`)
      if (provider.layers.some((l) => l.id === 'hook-SetTheme')) throw new Error('the seam/def hook landed')
      const anchor = provider.anchors.find((a) => a.target === 'SetTheme')
      if (!anchor || typeof anchor.value !== 'object' || anchor.value.name !== 'SetTheme') {
        throw new Error('the def value was clobbered')
      }
    })

    // ---- envelope hygiene ------------------------------------------------------
    await runner.check('envelope: zero K4 warnings on the translate channel', () => {
      if (translated.warnings.length !== 0) throw new Error(JSON.stringify(translated.warnings))
    })
    await runner.check('envelope: the hooks field rides the provider base + the anchors carry the ONE value source', () => {
      const provider = sup.getNode(translated.root.id)
      if (JSON.stringify(provider.base.hooks) !== JSON.stringify(['theme', 'user', 'counter'])) {
        throw new Error(`hooks field=${JSON.stringify(provider.base.hooks)}`)
      }
      for (const name of ['theme', 'user', 'counter']) {
        const a = provider.anchors.find((x) => x.target === name)
        if (!a || a.value === undefined) throw new Error(`anchor ${name} lost its value`)
      }
    })

    // the checks' wall time includes the interact flush windows (measured in
    // flushMs) — subtract them so the buckets never overlap
    PROFILE.checksMs = (now() - checksT0) - (PROFILE.flushMs - flushAtChecksStart)

    runner.summary('hooks-scenarios')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.flushMs + PROFILE.emitMs +
      PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[hooks-scenarios:profile] renderCount=${PROFILE.renderCount} compileCalls=${PROFILE.compileCalls} ` +
      `hookWrites=${PROFILE.hookWrites} maxHookLayers=${PROFILE.maxHookLayers} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms flush=${f(PROFILE.flushMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} ` +
      `destroyed=${PROFILE.destroyed} prototypes=${PROFILE.prototypes} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__hooksScenariosProfile = PROFILE
  }

  globalThis.__hooksScenariosDone = main().catch((e) => {
    console.error('hooks-scenarios failed:', e)
    runner.summary('hooks-scenarios')
  })
}
