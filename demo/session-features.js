// session-features.js — BLIND-TEST WRITER page module for
// docs/specs/landed-features-scenarios.md (2026-08-20).
// CSS-CLASSES seam + RETAINED-HANDLER-MAP + Supervisor.dispatchEvent (Phase A).
// CORE-ONLY: every capability comes from dist/core/* + the envelope data module.
// The harness mirrors the supervisor: translateLegacy -> Supervisor + EventBridge
// -> register -> compile -> recordResolved -> emitElements/diffMinimal/applyOps;
// EVERY interaction is driven through Supervisor.dispatchEvent (Group 3 is the
// seam the other groups' interactions already use — cross-coverage is intended).
import { translateLegacy, reverseTranslate } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { sessionFeaturesEnvelopes, sessionFeaturesServerData } from './session-features-data.js'
import { makeRunner } from './lib/runner.js'

const MOUNTS = [
  { key: 'badge', mountId: 'mount-badge' },
  { key: 'badge-array', mountId: 'mount-badge-array' },
  { key: 'badge-missing', mountId: 'mount-badge-missing' },
  { key: 'blocked', mountId: 'mount-blocked' },
  { key: 'roundtrip', mountId: 'mount-roundtrip' },
  { key: 'self-remove', mountId: 'mount-self-remove' },
  { key: 'remove-el', mountId: 'mount-remove-el' },
  { key: 'sayhi', mountId: 'mount-sayhi' },
  { key: 'fork', mountId: 'mount-fork' },
  { key: 'unknown', mountId: 'mount-unknown' },
  { key: 'readonly', mountId: 'mount-readonly' },
  { key: 'noprop', mountId: 'mount-noprop' },
  { key: 'reenter', mountId: 'mount-reenter' }
]

const now = () => (typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now())

const PROFILE = {
  registered: 0,
  inTree: 0,
  unplaced: 0,
  destroyed: 0,
  prototypes: 0,
  cloneOps: 0,
  renderCount: 0,
  loadMs: 0,
  compileMs: 0,
  emitMs: 0,
  diffMs: 0,
  applyMs: 0,
  checksMs: 0,
  coveredMs: 0,
  totalMs: 0
}

const TIMING = { load: 0, compile: 0, emit: 0, diff: 0, apply: 0, checks: 0 }

async function flushMicrotasks() {
  for (let i = 0; i < 8; i++) {
    await new Promise(r => setTimeout(r, 0))
  }
}

function censusOf(sup) {
  const all = sup.allNodes()
  return {
    registered: all.length,
    inTree: all.filter(n => !n.destroyed && n.isInTree).length,
    unplaced: all.filter(n => !n.destroyed && n.state === 'unplaced').length,
    destroyed: all.filter(n => n.destroyed).length,
    prototypes: all.filter(n => n.state === 'prototype').length,
    cloneOps: 0
  }
}

function stateCount(states) {
  if (!states) return 0
  if (states instanceof Map) return states.size
  if (typeof states.length === 'number') return states.length
  return 0
}

// takePass2States() is renderer-owned and draining; it may arrive as a flat
// CompiledState[], an array of per-node CompiledState[] groups, or a Map.
// All three shapes merge into the same Map<nodeId, CompiledState[]>.
function mergeStates(prevStates, states) {
  if (!states) return
  if (states instanceof Map) {
    for (const [k, v] of states) prevStates.set(k, v)
    return
  }
  const list = Array.isArray(states) ? states : []
  for (const item of list) {
    if (!item) continue
    if (Array.isArray(item)) {
      const first = item[0]
      if (first && typeof first === 'object' && first.nodeId) prevStates.set(first.nodeId, item)
    } else if (typeof item === 'object' && item.nodeId) {
      prevStates.set(item.nodeId, [item])
    }
  }
}

// Node lookup by AUTHORED props.id (design skill §14.1 rule 1).
function byId(sup, id) {
  return sup.allNodes().find(n => n.props && n.props.id === id)
}

// Element lookup in the mount: stack-walk el.children matching the id. The
// id comes from `props.id` → setAttribute('id', ...) (the shim sets `attrs`,
// never `el.id`; css:id sets `el.id` directly) — so read getAttribute('id')
// FIRST (works in both the shim and a real browser), then el.id.
function findEl(mountEl, id) {
  const stack = Array.from((mountEl && mountEl.children) || [])
  while (stack.length) {
    const el = stack.pop()
    const elId = el.getAttribute ? el.getAttribute('id') : el.id != null ? el.id : null
    if (String(elId) === String(id)) return el
    if (el.children) {
      for (const c of Array.from(el.children)) stack.push(c)
    }
  }
  return null
}

function classesOf(el) {
  const raw = el.className != null ? el.className : el.getAttribute ? el.getAttribute('class') : ''
  return String(raw || '').split(/\s+/).filter(Boolean)
}

function styleTextOf(el) {
  if (el.style && el.style.cssText != null) return String(el.style.cssText)
  if (el.getAttribute) return String(el.getAttribute('style') || '')
  return ''
}

// ---------------------------------------------------------------------------
// Per-mount harness — one Supervisor + DomAdapter + render loop per scenario.
// ---------------------------------------------------------------------------
function harnessFor(mountEl, env) {
  const translated = translateLegacy(env)
  const sup = new Supervisor({ events: new EventBridge() })
  for (const node of translated.nodes) sup.registerNode(node)
  const adapter = new DomAdapter(mountEl)
  const nodeById = new Map()
  for (const n of translated.nodes) nodeById.set(n.id, n)
  const prevStates = new Map()
  let prevMap = null
  let lastOps = []
  let renderCount = 0

  function seedFromActionable(actionable) {
    prevStates.clear()
    for (const cs of actionable) {
      const group = prevStates.get(cs.nodeId)
      if (group) group.push(cs)
      else prevStates.set(cs.nodeId, [cs])
    }
  }

  function renderEmit() {
    renderCount++
    const actionable = []
    for (const [nodeId, group] of prevStates) {
      const node = nodeById.get(nodeId)
      // drop nodes that are destroyed OR no longer in-tree (a destroy detaches
      // to 'unplaced' — the `destroyed` flag alone misses it); their elements
      // then leave the emit set and the diff emits the `remove` op (which also
      // purges the retained listener via DomAdapter.removeEl).
      if (node && (node.destroyed || !node.isInTree)) {
        prevStates.delete(nodeId)
        continue
      }
      for (const cs of group) actionable.push(cs)
    }
    sup.recordResolved(actionable)
    const t0 = now()
    const els = emitElements(actionable, nodeById)
    TIMING.emit += now() - t0
    const t1 = now()
    const ops = diffMinimal(prevMap, els)
    TIMING.diff += now() - t1
    prevMap = new Map(els.map(e => [e.wire, e]))
    lastOps = ops
    const t2 = now()
    adapter.beginBatch()
    applyOps(adapter, ops)
    adapter.endBatch()
    TIMING.apply += now() - t2
    return ops
  }

  const tCompile = now()
  const cr = translated.root.compile(translated.nodes)
  TIMING.compile += now() - tCompile
  sup.recordResolved(cr.actionable)
  seedFromActionable(cr.actionable)
  renderEmit()

  async function dispatch(target, event, ...args) {
    const j0 = sup.journal.length
    const r = sup.dispatchEvent(target, event, ...args)
    await flushMicrotasks()
    const states = sup.takePass2States()
    // Re-render only when SOMETHING changed: the journal grew (a body applied
    // an op — e.g. a destroy produces NO pass-2 states, yet the diff must emit
    // the `remove` op) OR fresh pass-2 states arrived. A READ-ONLY dispatch
    // (S3.4) changes neither → no re-render (dispatch is a trigger, never a
    // drain).
    const changed = sup.journal.length !== j0 || stateCount(states) > 0
    if (stateCount(states) > 0) mergeStates(prevStates, states)
    if (changed) renderEmit()
    return r
  }

  async function applyOp(op) {
    const res = sup.apply(op)
    await flushMicrotasks()
    mergeStates(prevStates, sup.takePass2States())
    renderEmit()
    return res
  }

  return {
    sup,
    adapter,
    nodeById,
    translated,
    cr,
    dispatch,
    applyOp,
    get renderCount() {
      return renderCount
    },
    get lastOps() {
      return lastOps
    },
    census: () => censusOf(sup)
  }
}

// ---------------------------------------------------------------------------
// Runner checks — the spec's INTENDED OUTPUTS per scenario.
// ---------------------------------------------------------------------------
async function runChecks(runner, mounts) {
  const mountEl = id => document.getElementById(id)

  // ---- Group 1: css.classes injection seam -------------------------------
  {
    const h = mounts['badge']
    await runner.check('S1.1: badge class attribute = host first, injected appended (scalar)', () => {
      const el = findEl(mountEl('mount-badge'), 'badge-el')
      if (!el) throw new Error('badge-el not rendered')
      const joined = classesOf(el).join(' ')
      if (joined !== 'badge is-primary') throw new Error('expected "badge is-primary", got "' + joined + '"')
    })
    await runner.check('S1.1: translate emits no gap warning for the css.classes seam target', () => {
      const gaps = h.translated.warnings.filter(w => w.code === 'component-target-gap')
      if (gaps.length !== 0) throw new Error('unexpected component-target-gap warnings: ' + gaps.length)
    })
  }
  {
    const h = mounts['badge-array']
    await runner.check('S1.2: array-form classes appended in order (host-first)', () => {
      const el = findEl(mountEl('mount-badge-array'), 'badge-array-el')
      if (!el) throw new Error('badge-array-el not rendered')
      const joined = classesOf(el).join(' ')
      if (joined !== 'badge is-primary is-large') throw new Error('expected "badge is-primary is-large", got "' + joined + '"')
    })
  }
  {
    const h = mounts['badge-missing']
    await runner.check('S1.3: missing/unresolved source keeps the authored class list', () => {
      const el = findEl(mountEl('mount-badge-missing'), 'badge-missing-el')
      if (!el) throw new Error('badge-missing-el not rendered')
      const joined = classesOf(el).join(' ')
      if (joined !== 'badge') throw new Error('expected only "badge", got "' + joined + '"')
    })
    await runner.check('S1.3: unresolved reference surfaces as the documented fail-state', () => {
      const hit = (h.cr.warnings || []).some(w => w.code === 'unresolved-reference')
      if (!hit) throw new Error('expected unresolved-reference warning in the compile result')
    })
  }
  {
    const h = mounts['blocked']
    await runner.check('S1.4: exactly four component-target-skipped warnings (blocked css targets)', () => {
      const skipped = h.translated.warnings.filter(w => w.code === 'component-target-skipped')
      if (skipped.length !== 4) throw new Error('expected 4 skipped warnings, got ' + skipped.length)
    })
    await runner.check('S1.4: no component-target-gap confuses the register', () => {
      const gaps = h.translated.warnings.filter(w => w.code === 'component-target-gap')
      if (gaps.length !== 0) throw new Error('unexpected component-target-gap warnings: ' + gaps.length)
    })
    await runner.check('S1.4: the button keeps its own authored css untouched', () => {
      const el = findEl(mountEl('mount-blocked'), 'blocked-btn-el')
      if (!el) throw new Error('blocked-btn-el not rendered')
      const joined = classesOf(el).join(' ')
      if (joined !== 'btn blocked-btn') throw new Error('classes lost: "' + joined + '"')
      const style = styleTextOf(el)
      if (style.indexOf('color: green') === -1) throw new Error('authored style lost: "' + style + '"')
    })
  }
  {
    const h = mounts['roundtrip']
    await runner.check('S1.5: the re-translated round-trip tree is warning-free', () => {
      if (h.translated.warnings.length !== 0) {
        throw new Error('re-translate warnings: ' + JSON.stringify(h.translated.warnings))
      }
    })
    await runner.check('S1.5: the reversed doc renders the same class plan', () => {
      const el = findEl(mountEl('mount-roundtrip'), 'badge-roundtrip-el')
      if (!el) throw new Error('badge-roundtrip-el not rendered')
      const joined = classesOf(el).join(' ')
      if (joined !== 'badge is-primary') throw new Error('expected "badge is-primary", got "' + joined + '"')
    })
  }

  // ---- Group 2: retained-handler-map listener lifecycle ------------------
  {
    const h = mounts['self-remove']
    const mEl = mountEl('mount-self-remove')
    const btn = byId(h.sup, 'one-shot-btn')
    // DEFECT #27 FIXED (2026-08-20): a `handlers` state-slice `value: []` now
    // CLEARS the compiled handlers durably (the seam layer is suppressed), so
    // the FULL S2.1 intended output is expressible: first click writes content
    // + clears handlers, the diff emits set('on:click', undefined), the
    // retained listener detaches, and a second click runs nothing.
    await runner.check('S2.1: one-shot button has a retained click listener after bootstrap', () => {
      if (!btn) throw new Error('one-shot-btn node not found')
      const el = findEl(mEl, 'one-shot-btn')
      if (!el) throw new Error('one-shot-btn not rendered')
      const wire = el.dataset && el.dataset.wire
      if (!wire) throw new Error('no dataset.wire on the emitted button')
      if (!(h.adapter.listeners && h.adapter.listeners.get(wire) && h.adapter.listeners.get(wire).get('click'))) {
        throw new Error('no retained click listener for wire ' + wire)
      }
    })
    await runner.check('S2.1: first click writes content AND clears the compiled handlers', async () => {
      const r = await h.dispatch(btn.id, 'click')
      if (r.length !== 1) throw new Error('expected 1 result, got ' + JSON.stringify(r))
      const el = findEl(mEl, 'one-shot-btn')
      if (!el || el.textContent !== 'clicked') throw new Error('content after click: "' + (el && el.textContent) + '"')
      const node = byId(h.sup, 'one-shot-btn')
      const hLen = node && node.handlers ? node.handlers.length : 0
      if (hLen !== 0) throw new Error('handlers not cleared: ' + hLen)
    })
    await runner.check('S2.1: diffMinimal emitted set(on:click, undefined) (the prop left the set)', () => {
      const el = findEl(mEl, 'one-shot-btn')
      const wire = el && el.dataset && el.dataset.wire
      const hit = (h.lastOps || []).some(o => o.kind === 'set' && o.name === 'on:click' && o.value === undefined && (!wire || o.wire === wire))
      if (!hit) throw new Error('no set(on:click, undefined) op for wire ' + wire)
    })
    await runner.check('S2.1: the retained listener is removed after the re-render (DOM-F6 detach)', () => {
      const el = findEl(mEl, 'one-shot-btn')
      const wire = el && el.dataset && el.dataset.wire
      if (h.adapter.listeners && h.adapter.listeners.get(wire) && h.adapter.listeners.get(wire).get('click')) {
        throw new Error('listener still present for wire ' + wire)
      }
    })
    await runner.check('S2.1: a second click runs nothing and preserves content', async () => {
      const r = await h.dispatch(btn.id, 'click')
      if (r.length !== 0) throw new Error('second click ran ' + r.length + ' handlers')
      const el = findEl(mEl, 'one-shot-btn')
      if (!el || el.textContent !== 'clicked') throw new Error('content not preserved: "' + (el && el.textContent) + '"')
    })
  }
  {
    const h = mounts['remove-el']
    const mEl = mountEl('mount-remove-el')
    const trigger = byId(h.sup, 'remove-trigger-btn')
    let rmWire = null
    await runner.check('S2.2: remove-me has a retained click listener after bootstrap', () => {
      const el = findEl(mEl, 'remove-me-btn')
      if (!el) throw new Error('remove-me-btn not rendered')
      rmWire = el.dataset && el.dataset.wire
      if (!rmWire) throw new Error('no dataset.wire on remove-me')
      if (!(h.adapter.listeners && h.adapter.listeners.get(rmWire) && h.adapter.listeners.get(rmWire).get('click'))) {
        throw new Error('no retained click listener for wire ' + rmWire)
      }
    })
    await runner.check('S2.2: dispatching the remove-trigger destroys remove-me', async () => {
      const r = await h.dispatch(trigger.id, 'click')
      if (r.length !== 1) throw new Error('expected 1 result, got ' + JSON.stringify(r))
      if (findEl(mEl, 'remove-me-btn')) throw new Error('remove-me element still present')
      if (!findEl(mEl, 'remove-trigger-btn')) throw new Error('page did not keep rendering (remove-trigger gone)')
    })
    await runner.check('S2.2: the destroyed control\u2019s retained listener is purged', () => {
      if (!rmWire) throw new Error('rmWire was not captured')
      if (h.adapter.listeners && h.adapter.listeners.get(rmWire) && h.adapter.listeners.get(rmWire).get('click')) {
        throw new Error('listener not purged for wire ' + rmWire)
      }
    })
  }

  // ---- Group 3: Supervisor.dispatchEvent engine entry --------------------
  {
    const h = mounts['sayhi']
    const mEl = mountEl('mount-sayhi')
    const btn = byId(h.sup, 'sayhi-btn')
    await runner.check('S3.1: engine dispatch drives the data-authored control (event.value passthrough)', async () => {
      const r = await h.dispatch(btn.id, 'click', 'hi')
      if (r.length !== 1 || r[0] !== undefined) throw new Error('expected [undefined], got ' + JSON.stringify(r))
      const el = findEl(mEl, 'sayhi-btn')
      if (!el || el.textContent !== 'hi!') throw new Error('button text: "' + (el && el.textContent) + '"')
    })
  }
  {
    const h = mounts['fork']
    const mEl = mountEl('mount-fork')
    const display = byId(h.sup, 'display-el')
    await runner.check('S3.2: two fork arms resolved for the display consumer', () => {
      const states = h.sup.getResolvedStates(display.id)
      if (!states || states.length !== 2) throw new Error('expected 2 fork arms, got ' + (states && states.length))
    })
    await runner.check('S3.2: fork-arm wire dispatch fires the node ONCE with ctx.states length 2', async () => {
      const r = await h.dispatch(display.id + '#0', 'click')
      if (r.length !== 1 || r[0] !== 1) throw new Error('expected [1], got ' + JSON.stringify(r))
      const el = findEl(mEl, 'display-el')
      const arms = el && el.getAttribute ? el.getAttribute('arms') : null
      if (arms !== '2') throw new Error('arms prop: "' + arms + '" (expected "2")')
    })
  }
  {
    const h = mounts['unknown']
    const mEl = mountEl('mount-unknown')
    const victim = byId(h.sup, 'victim-btn')
    await runner.check('S3.3: unknown target is a safe no-op', async () => {
      const r = await h.dispatch('no-such-id', 'click')
      if (r.length !== 0) throw new Error('expected [], got ' + JSON.stringify(r))
      if (!findEl(mEl, 'sayhi-btn-33')) throw new Error('page did not stay alive')
    })
    await runner.check('S3.3: destroyed target is a safe no-op', async () => {
      // supervisor.apply's state-slice/destroy paths take a live Node (op.node),
      // not a node id string.
      const res = await h.applyOp({ kind: 'destroy', node: victim })
      if (!res || res.status !== 'applied') throw new Error('destroy not applied: ' + JSON.stringify(res))
      const r = await h.dispatch(victim.id, 'click')
      if (r.length !== 0) throw new Error('destroyed target ran ' + r.length + ' handlers')
    })
  }
  {
    const h = mounts['readonly']
    const mEl = mountEl('mount-readonly')
    const node = byId(h.sup, 'readonly-el')
    await runner.check('S3.4: a read-only dispatch produces no pass-2 states and no re-render', async () => {
      const before = h.renderCount
      const r = await h.dispatch(node.id, 'click')
      if (r.length !== 1) throw new Error('read-only body did not run: ' + JSON.stringify(r))
      if (h.renderCount !== before) throw new Error('render count changed: ' + before + ' -> ' + h.renderCount)
    })
    await runner.check('S3.4: a subsequent apply DOES re-render', async () => {
      const before = h.renderCount
      const res = await h.applyOp({
        kind: 'state-slice',
        node: node, // the live Node, not the id string
        mutation: [{ targetProp: 'content', mode: 'replace', value: 'applied' }]
      })
      if (!res || res.status !== 'applied') throw new Error('apply failed: ' + JSON.stringify(res))
      if (h.renderCount <= before) throw new Error('no re-render after the apply')
      const el = findEl(mEl, 'readonly-el')
      if (!el || el.textContent !== 'applied') throw new Error('content after apply: "' + (el && el.textContent) + '"')
    })
  }
  {
    const h = mounts['noprop']
    const mEl = mountEl('mount-noprop')
    const child = byId(h.sup, 'child-btn')
    await runner.check('S3.5: dispatching the child fires ONLY the child handler', async () => {
      const r = await h.dispatch(child.id, 'click')
      if (r.length !== 1 || r[0] !== 1) throw new Error('expected [1], got ' + JSON.stringify(r))
      const childEl = findEl(mEl, 'child-btn')
      if (!childEl || childEl.textContent !== '1') throw new Error('child content: "' + (childEl && childEl.textContent) + '"')
      const panelEl = findEl(mEl, 'panel-el')
      if (!panelEl || panelEl.textContent !== '0') throw new Error('panel content changed: "' + (panelEl && panelEl.textContent) + '"')
    })
  }
  {
    const h = mounts['reenter']
    const mEl = mountEl('mount-reenter')
    const node = byId(h.sup, 'reenter-el')
    await runner.check('S3.6: a self-re-dispatching click runs exactly ONCE', async () => {
      const r = await h.dispatch(node.id, 'click')
      if (r.length !== 1 || r[0] !== 1) throw new Error('expected [1], got ' + JSON.stringify(r))
      const el = findEl(mEl, 'reenter-el')
      const nestedLen = el && el.getAttribute ? el.getAttribute('nestedLen') : null
      if (nestedLen !== '0') throw new Error('nestedLen prop: "' + nestedLen + '" (expected "0")')
    })
    await runner.check('S3.6: a different event on the same node is not blocked', async () => {
      const r = await h.dispatch(node.id, 'focus')
      if (r.length !== 1 || r[0] !== 'focus') throw new Error('expected ["focus"], got ' + JSON.stringify(r))
      const el = findEl(mEl, 'reenter-el')
      const focus = el && el.getAttribute ? el.getAttribute('focus') : null
      if (focus !== '1') throw new Error('focus prop: "' + focus + '" (expected "1")')
    })
  }
}

// ---------------------------------------------------------------------------
// main — mount every scenario, run the checks, publish the profile.
// ---------------------------------------------------------------------------
let __runner = null

async function main() {
  const server = sessionFeaturesServerData()
  if (!server.expected || server.expected.mounts !== MOUNTS.length) {
    throw new Error('sessionFeaturesServerData().expected.mounts !== ' + MOUNTS.length)
  }

  __runner = makeRunner()
  document.getElementById('results').appendChild(__runner.el)

  const envelopes = sessionFeaturesEnvelopes()
  const tStart = now()
  const mounts = {}

  for (const m of MOUNTS) {
    const mountEl = document.getElementById(m.mountId)
    const tLoad = now()
    let env = envelopes[m.key]
    if (m.key === 'roundtrip') {
      // S1.5: the mounted envelope is the RE-TRANSLATED doc.
      env = reverseTranslate(translateLegacy(env).root)
    }
    const h = harnessFor(mountEl, env)
    TIMING.load += now() - tLoad
    mounts[m.key] = h
    const c = h.census()
    PROFILE.registered += c.registered
    PROFILE.inTree += c.inTree
    PROFILE.unplaced += c.unplaced
    PROFILE.destroyed += c.destroyed
    PROFILE.prototypes += c.prototypes
    PROFILE.cloneOps += c.cloneOps
  }

  const tChecks = now()
  await runChecks(__runner, mounts)
  TIMING.checks = now() - tChecks

  PROFILE.renderCount = MOUNTS.reduce((s, m) => s + (mounts[m.key] ? mounts[m.key].renderCount : 0), 0)
  PROFILE.loadMs = Math.round(TIMING.load)
  PROFILE.compileMs = Math.round(TIMING.compile)
  PROFILE.emitMs = Math.round(TIMING.emit)
  PROFILE.diffMs = Math.round(TIMING.diff)
  PROFILE.applyMs = Math.round(TIMING.apply)
  PROFILE.checksMs = Math.round(TIMING.checks)
  PROFILE.coveredMs = PROFILE.loadMs + PROFILE.compileMs + PROFILE.emitMs + PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
  PROFILE.totalMs = Math.round(now() - tStart)

  globalThis.__sessionFeaturesProfile = PROFILE
  console.log(
    '[session-features:profile] census(registered=' + PROFILE.registered +
    ',inTree=' + PROFILE.inTree + ',unplaced=' + PROFILE.unplaced +
    ',destroyed=' + PROFILE.destroyed + ',prototypes=' + PROFILE.prototypes +
    ',cloneOps=' + PROFILE.cloneOps + ') renderCount=' + PROFILE.renderCount +
    ' loadMs=' + PROFILE.loadMs + ' compileMs=' + PROFILE.compileMs +
    ' emitMs=' + PROFILE.emitMs + ' diffMs=' + PROFILE.diffMs +
    ' applyMs=' + PROFILE.applyMs + ' checksMs=' + PROFILE.checksMs +
    ' coveredMs=' + PROFILE.coveredMs + ' total=' + PROFILE.totalMs + 'ms'
  )

  __runner.summary('session-features')
}

if (typeof document !== 'undefined') {
  globalThis.__sessionFeaturesDone = main().catch(e => {
    console.error('session-features failed:', e)
    const r = __runner || makeRunner()
    if (!__runner) {
      const resultsEl = document.getElementById('results')
      if (resultsEl) resultsEl.appendChild(r.el)
    }
    r.summary('session-features')
  })
} else {
  globalThis.__sessionFeaturesDone = Promise.resolve()
}
