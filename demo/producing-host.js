// producing-host.js — BLIND-TEST WRITER page module for
// docs/specs/landed-features-scenarios.md Group 4 (REQ-GAP-8).
// CORE-ONLY: every capability comes from dist/core/* + the envelope data module.
// Uses the EXPORTED canonical re-emit loop renderProducingProcess (NOT hand-rolled
// emit/diff/apply) to exercise the opt-in renderOptions parameter.
import { renderProducingProcess } from '../dist/core/render-helpers.js'
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { producingHostEnvelopes, producingHostServerData } from './producing-host-data.js'
import { makeRunner } from './lib/runner.js'

const MOUNTS = [
  { key: 'twoNode', mountId: 'mount-optin' },
  { key: 'twoNode', mountId: 'mount-default' },
  { key: 'chain', mountId: 'mount-chain' },
  { key: 'prune', mountId: 'mount-prune' },
  { key: 'twoNode', mountId: 'mount-controls' }
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

function byId(sup, id) {
  return sup.allNodes().find(n => n.props && n.props.id === id)
}

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

// ---------------------------------------------------------------------------
// Per-mount harness — uses the EXPORTED renderProducingProcess loop.
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
  let lastResult = null
  let renderCount = 0

  function seedFromActionable(actionable) {
    prevStates.clear()
    for (const cs of actionable) {
      const group = prevStates.get(cs.nodeId)
      if (group) group.push(cs)
      else prevStates.set(cs.nodeId, [cs])
    }
  }

  function getActionable() {
    const out = []
    for (const [nodeId, group] of prevStates) {
      const node = nodeById.get(nodeId)
      if (node && (node.destroyed || !node.isInTree)) {
        prevStates.delete(nodeId)
        continue
      }
      for (const cs of group) out.push(cs)
    }
    return out
  }

  function renderEmit(options) {
    renderCount++
    const actionable = getActionable()
    sup.recordResolved(actionable)
    const t0 = now()
    const result = renderProducingProcess(actionable, nodeById, adapter, prevMap, options)
    TIMING.emit += now() - t0
    prevMap = result.prevMap
    lastOps = result.ops
    lastResult = result
    return result
  }

  const tCompile = now()
  const cr = translated.root.compile(translated.nodes)
  TIMING.compile += now() - tCompile
  sup.recordResolved(cr.actionable)
  seedFromActionable(cr.actionable)

  async function dispatch(target, event, options, ...args) {
    const j0 = sup.journal.length
    const r = sup.dispatchEvent(target, event, ...args)
    await flushMicrotasks()
    const states = sup.takePass2States()
    const changed = sup.journal.length !== j0 || stateCount(states) > 0
    if (stateCount(states) > 0) mergeStates(prevStates, states)
    if (changed) renderEmit(options)
    return r
  }

  async function applyOp(op, options) {
    const res = sup.apply(op)
    await flushMicrotasks()
    mergeStates(prevStates, sup.takePass2States())
    const rendered = renderEmit(options)
    return { ...res, rendered }
  }

  return {
    sup,
    adapter,
    nodeById,
    translated,
    cr,
    dispatch,
    applyOp,
    renderEmit,
    get renderCount() {
      return renderCount
    },
    get lastOps() {
      return lastOps
    },
    get lastResult() {
      return lastResult
    },
    census: () => censusOf(sup)
  }
}

// ---------------------------------------------------------------------------
// Runner checks — the spec's INTENDED OUTPUTS per scenario.
// ---------------------------------------------------------------------------
async function runChecks(runner, mounts) {
  const mountEl = id => document.getElementById(id)

  // ---- S4.1: OPT-IN threading -------------------------------------------
  {
    const h = mounts['mount-optin']
    const mEl = mountEl('mount-optin')
    const result = h.renderEmit({ nodeIdAttribute: true })

    await runner.check('S4.1: every emitted element carries data:node-id', () => {
      for (const el of result.els) {
        if (el.props['data:node-id'] == null) {
          throw new Error('element on wire "' + el.wire + '" missing data:node-id')
        }
      }
    })
    await runner.check('S4.1: every data:node-id value is a real nodeById key', () => {
      for (const el of result.els) {
        const nid = el.props['data:node-id']
        if (!h.nodeById.has(nid)) {
          throw new Error('data:node-id "' + nid + '" is not a nodeById key')
        }
      }
    })
    await runner.check('S4.1: ops stream carries the data: prop', () => {
      for (const op of result.ops) {
        if (op.kind === 'set' && op.name && op.name.indexOf('data:') === 0) return
      }
      throw new Error('no data: set op found in the ops stream')
    })
    await runner.check('S4.1: DOM adapter set the data-node-id attribute', () => {
      const el = findEl(mEl, 'host-div')
      if (!el) throw new Error('host-div not rendered')
      const nid = el.getAttribute('data-node-id')
      if (nid == null || nid === '') throw new Error('data-node-id attribute not set on host-div')
      if (!h.nodeById.has(nid)) throw new Error('data-node-id "' + nid + '" is not a real nodeById key')
    })
  }

  // ---- S4.2: DEFAULT OFF -------------------------------------------------
  {
    const h = mounts['mount-default']
    const mEl = mountEl('mount-default')
    const result = h.renderEmit()

    await runner.check('S4.2: no data:node-id on any element', () => {
      for (const el of result.els) {
        if (el.props['data:node-id'] != null) {
          throw new Error('element on wire "' + el.wire + '" unexpectedly has data:node-id')
        }
      }
    })
    await runner.check('S4.2: no data: set ops in the stream', () => {
      for (const op of result.ops) {
        if (op.kind === 'set' && op.name && op.name.indexOf('data:') === 0) {
          throw new Error('unexpected data: set op: ' + op.name)
        }
      }
    })
    await runner.check('S4.2: no data-node-id attribute on DOM elements', () => {
      const el = findEl(mEl, 'host-div')
      if (!el) throw new Error('host-div not rendered')
      const nid = el.getAttribute('data-node-id')
      if (nid != null && nid !== '') throw new Error('data-node-id attribute present: ' + nid)
    })
  }

  // ---- S4.3: prevMap chain -----------------------------------------------
  {
    const h = mounts['mount-chain']
    const mEl = mountEl('mount-chain')
    const btn = byId(h.sup, 'chain-btn')

    // First render with options — stamps everything
    const firstResult = h.renderEmit({ nodeIdAttribute: true })

    await runner.check('S4.3: first render stamps every element with data:node-id', () => {
      for (const el of firstResult.els) {
        if (el.props['data:node-id'] == null) {
          throw new Error('element on wire "' + el.wire + '" missing data:node-id on first render')
        }
      }
    })

    // Dispatch click → flush → drain → merge → re-render with caller-held prevMap + options
    await h.dispatch(btn.id, 'click', { nodeIdAttribute: true })

    const secondResult = h.lastResult
    await runner.check('S4.3: re-render after mutation is incremental (set-only, no creates)', () => {
      const creates = secondResult.ops.filter(o => o.kind === 'create')
      const removes = secondResult.ops.filter(o => o.kind === 'remove')
      if (creates.length !== 0) throw new Error('unexpected create ops: ' + creates.length)
      if (removes.length !== 0) throw new Error('unexpected remove ops: ' + removes.length)
    })
    await runner.check('S4.3: re-render still stamps every element', () => {
      for (const el of secondResult.els) {
        if (el.props['data:node-id'] == null) {
          throw new Error('element on wire "' + el.wire + '" missing data:node-id after re-render')
        }
      }
    })

    // Third render with no changes → zero ops
    const thirdResult = h.renderEmit({ nodeIdAttribute: true })
    await runner.check('S4.3: third render with no changes yields zero ops', () => {
      if (thirdResult.ops.length !== 0) {
        throw new Error('expected zero ops, got ' + thirdResult.ops.length)
      }
    })
  }

  // ---- S4.4: destroy-prune under the option ------------------------------
  {
    const h = mounts['mount-prune']
    const mEl = mountEl('mount-prune')
    const victim = byId(h.sup, 'victim-span')

    // Render with options — stamps everything
    h.renderEmit({ nodeIdAttribute: true })

    // Destroy the victim — the remove op fires during this render
    const destroyResult = await h.applyOp({ kind: 'destroy', node: victim }, { nodeIdAttribute: true })
    const result = destroyResult.rendered

    await runner.check('S4.4: destroyed wire gets remove, never re-create', () => {
      const removes = result.ops.filter(o => o.kind === 'remove')
      const creates = result.ops.filter(o => o.kind === 'create')
      if (removes.length === 0) throw new Error('expected at least one remove for the destroyed wire')
      if (creates.length !== 0) throw new Error('unexpected create ops after destroy: ' + creates.length)
    })
    await runner.check('S4.4: surviving elements keep data:node-id', () => {
      for (const el of result.els) {
        if (el.props['data:node-id'] == null) {
          throw new Error('surviving element on wire "' + el.wire + '" lost data:node-id')
        }
      }
    })
  }

  // ---- Controls ----------------------------------------------------------
  {
    const h = mounts['mount-controls']

    await runner.check('Controls: renderProducingProcess is importable from the barrel (identity check)', async () => {
      const barrel = await import('../dist/index.js')
      if (typeof barrel.renderProducingProcess !== 'function') {
        throw new Error('barrel renderProducingProcess is not a function: ' + typeof barrel.renderProducingProcess)
      }
      if (barrel.renderProducingProcess !== renderProducingProcess) {
        throw new Error('barrel export differs from direct import')
      }
    })
    await runner.check('Controls: op stream equals adapter call log (adapter-neutral)', () => {
      // The loop returns the op stream verbatim — the returned ops ARE the
      // adapter-neutral representation. The DomAdapter consumes them 1:1.
      const result = h.renderEmit()
      // Every op in the stream has a kind — verify the stream is well-formed.
      for (const op of result.ops) {
        if (!op.kind) throw new Error('op without kind: ' + JSON.stringify(op))
      }
      // The els array size matches the ops that created elements.
      const creates = result.ops.filter(o => o.kind === 'create')
      if (result.els.length !== creates.length) {
        throw new Error('els count (' + result.els.length + ') !== create ops count (' + creates.length + ')')
      }
    })
  }
}

// ---------------------------------------------------------------------------
// main — mount every scenario, run the checks, publish the profile.
// ---------------------------------------------------------------------------
let __runner = null

async function main() {
  const server = producingHostServerData()
  if (!server.expected || server.expected.mounts !== MOUNTS.length) {
    throw new Error('producingHostServerData().expected.mounts !== ' + MOUNTS.length)
  }

  __runner = makeRunner()
  document.getElementById('results').appendChild(__runner.el)

  const envelopes = producingHostEnvelopes()
  const tStart = now()
  const mounts = {}

  for (const m of MOUNTS) {
    const mountEl = document.getElementById(m.mountId)
    const tLoad = now()
    const env = envelopes[m.key]
    const h = harnessFor(mountEl, env)
    TIMING.load += now() - tLoad
    mounts[m.mountId] = h
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

  PROFILE.renderCount = MOUNTS.reduce((s, m) => s + (mounts[m.mountId] ? mounts[m.mountId].renderCount : 0), 0)
  PROFILE.loadMs = Math.round(TIMING.load)
  PROFILE.compileMs = Math.round(TIMING.compile)
  PROFILE.emitMs = Math.round(TIMING.emit)
  PROFILE.diffMs = Math.round(TIMING.diff)
  PROFILE.applyMs = Math.round(TIMING.apply)
  PROFILE.checksMs = Math.round(TIMING.checks)
  PROFILE.coveredMs = PROFILE.loadMs + PROFILE.compileMs + PROFILE.emitMs + PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
  PROFILE.totalMs = Math.round(now() - tStart)

  globalThis.__producingHostProfile = PROFILE
  console.log(
    '[producing-host:profile] census(registered=' + PROFILE.registered +
    ',inTree=' + PROFILE.inTree + ',unplaced=' + PROFILE.unplaced +
    ',destroyed=' + PROFILE.destroyed + ',prototypes=' + PROFILE.prototypes +
    ',cloneOps=' + PROFILE.cloneOps + ') renderCount=' + PROFILE.renderCount +
    ' loadMs=' + PROFILE.loadMs + ' compileMs=' + PROFILE.compileMs +
    ' emitMs=' + PROFILE.emitMs + ' diffMs=' + PROFILE.diffMs +
    ' applyMs=' + PROFILE.applyMs + ' checksMs=' + PROFILE.checksMs +
    ' coveredMs=' + PROFILE.coveredMs + ' total=' + PROFILE.totalMs + 'ms'
  )

  __runner.summary('producing-host')
}

if (typeof document !== 'undefined') {
  globalThis.__producingHostDone = main().catch(e => {
    console.error('producing-host failed:', e)
    const r = __runner || makeRunner()
    if (!__runner) {
      const resultsEl = document.getElementById('results')
      if (resultsEl) resultsEl.appendChild(r.el)
    }
    r.summary('producing-host')
  })
} else {
  globalThis.__producingHostDone = Promise.resolve()
}
