/**
 * Fork-stress DATA-DRIVEN browser page + data envelope module.
 *
 * One module, two roles:
 *
 *  1. DATA (`forkStressLegacyData(depth)`, exported): the LEGACY envelope
 *     (`LegacyInitialData`) carrying the root and, per layer 1..depth−1, TWO
 *     prototype nodes (one per sibling slot). The prototypes declare their
 *     `after-compile` handler BY NAME (`handlers: [{ name: 'stress-expand',
 *     phase: 'after-compile' }]` — the BODY cannot be JSON-serialized). The
 *     page module supplies the body for that name. This export is used by
 *     scripts/fork-stress-data-page.mjs (Node) to embed the envelope.
 *
 *  2. PAGE (browser, guarded by `typeof document !== 'undefined'` so the
 *     builder can import the data without a DOM): CORE-ONLY imports
 *     (dist/core/*) — translateLegacy → Supervisor → createClient → the
 *     incremental render loop (bootstrap compile once, then consume
 *     supervisor.takePass2States()). NO demo-fixtures imports; the only
 *     shared helpers are the pure data-derivation `levelCss`/
 *     `cssPropForLevel`/`LAYER_METHODS`/`layerName` from fork-stress-fixture.
 *
 * The tree assembles at runtime: the page clones the layer-1 prototypes onto
 * the root (`clone-instance` op); each clone inherits its prototype's
 * `after-compile` handler, whose body expands the next layer by cloning the
 * layer+1 prototypes under it. The supervisor registers/attaches/marks each
 * copy, so its own after-compile expands the next layer — recursion builds
 * the whole 2^depth − 1 tree from the data alone.
 *
 * Spec: docs/specs/fork-stress-data.md.
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { createClient } from '../dist/core/client.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner } from './lib/runner.js'
import { LAYER_METHODS, layerName, levelCss, cssPropForLevel } from './fork-stress-fixture.js'

// ============================================================================
// DATA — the LEGACY envelope (pure data derivation, no graph construction).
// ============================================================================

/**
 * LegacyInitialData for a fork-stress page of the given depth: the root plus
 * TWO prototype nodes per layer 1..depth−1 (slot 'a' = div, slot 'b' = span).
 * The prototypes are content-payload items (unplaced); the tree assembles at
 * runtime via `clone-instance`. `stress:kind` cycles the four mechanisms
 * (placement|values|link|handler) every 4 layers; `levelCss(layer, slot)`
 * supplies the per-level property + per-slot value css stressor (shared pure
 * helper from fork-stress-fixture.js — demo-only, NOT a core API).
 */
export function forkStressLegacyData(depth) {
  const prototypes = []
  for (let layer = 1; layer <= depth - 1; layer += 1) {
    for (const slot of ['a', 'b']) {
      prototypes.push({
        type: slot === 'a' ? 'div' : 'span',
        props: {
          'stress:layer': layer,
          'stress:slot': slot,
          'stress:kind': LAYER_METHODS[(layer - 1) % LAYER_METHODS.length],
          'stress:handler': 'stress-expand',
        },
        css: levelCss(layer, slot),
        handlers: [{ name: 'stress-expand', phase: 'after-compile' }],
      })
    }
  }
  return {
    template: { root: { type: 'app', props: { id: 'stress-root' } } },
    content: [{ metadata: { title: 'fork-stress prototypes' }, content: prototypes }],
    clientConfig: { runInstantiation: false, runMonitoring: true },
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

  const envelope = JSON.parse(document.getElementById('preempt-initial-data').textContent)
  const serverData = JSON.parse(document.getElementById('server-data').textContent)
  const depth = serverData.depth

  const adapter = new DomAdapter(document.getElementById('app'))

  // ---- profiling -----------------------------------------------------------
  const PROFILE = {
    loadMs: 0, compileMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    renderCount: 0, compileCalls: 0, handlerCalls: 0, totalMs: 0,
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }

  // ---- translate the LEGACY envelope → graph (core-only) -------------------
  const loadT0 = now()
  const translated = translateLegacy(envelope)
  const rootNode = translated.root
  const prototypes = translated.content // the unplaced prototype nodes
  PROFILE.loadMs = now() - loadT0

  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const clientAPI = createClient(supervisor)

  // prototype registry: `layer:slot` → prototype node
  const protoByKey = new Map()
  for (const p of prototypes) protoByKey.set(`${p.props['stress:layer']}:${p.props['stress:slot']}`, p)

  /** Chain segment for a layer, matching the imperative page's format
   *  (L1:placement, L2:values-1, L3:link-1, L4:handler-1, L5:placement, …). */
  function chainSegment(layer) {
    const method = LAYER_METHODS[(layer - 1) % LAYER_METHODS.length]
    return method === 'placement' ? `L${layer}:placement` : `L${layer}:${layerName(layer)}`
  }

  /** Pending (created-but-not-yet-expanded) clones per `layer:slot` — filled
   *  by the PARENT layer's handler from the clone-instance results (the page
   *  kickoff fills layer 1), consumed by this layer's first handler pass. A
   *  page-side registry keeps every after-compile call O(1): re-runs pop an
   *  empty list and return (no graph scan). */
  const pendingByKey = new Map()

  /** Install the `stress-expand` body on a prototype: the data declared the
   *  handler by NAME + phase; here the page supplies the BODY. The clone
   *  inherits the prototype's layer (incl. the body), so the body runs on
   *  every clone's after-compile. HandlerContext carries no current node, so
   *  the body (closed over its prototype) expands every pending clone of its
   *  prototype's (layer, slot) — the first clone's pass expands all of that
   *  layer's clones, the rest no-op. */
  function installStressExpandBody(proto) {
    const layer = proto.props['stress:layer']
    const slot = proto.props['stress:slot']
    proto.addLayer({
      id: `stress-expand-${proto.id}`,
      handlers: [
        {
          name: 'stress-expand',
          phase: 'after-compile',
          body: (c) => {
            PROFILE.handlerCalls += 1
            const key = `${layer}:${slot}`
            const candidates = pendingByKey.get(key) ?? []
            if (candidates.length === 0) return
            pendingByKey.set(key, [])
            const nextKey = `${layer + 1}:`
            const protoA = protoByKey.get(`${layer + 1}:a`)
            const protoB = protoByKey.get(`${layer + 1}:b`)
            for (const n of candidates) {
              // idempotency guard (defensive — the registry is drained once)
              if (n.children.length > 0 || n.props?.['stress:expanded']) continue
              // mark the clone expanded FIRST (its own next after-compile
              // will no-op) + build its stress:layers chain (parent chain +
              // `|L<layer>:<kind>`)
              const parentChain = n.parent?.props?.['stress:layers'] ?? ''
              const segment = chainSegment(layer)
              const chain = parentChain ? `${parentChain}|${segment}` : segment
              c.clientAPI.apply(n.id, [
                { targetProp: 'props.stress:expanded', mode: 'replace', value: true },
                { targetProp: 'props.stress:layers', mode: 'replace', value: chain },
              ])
              // deepest layer: no children to create
              if (layer >= depth - 1) continue
              // clone the NEXT layer's prototypes under this clone — the
              // supervisor registers + attaches + marks the copies pass-2
              // dirty, so their own after-compile expands the next layer
              // (recursive assembly). The fresh copies join the next layer's
              // pending registry so the next flush expands them.
              const rA = c.clientAPI.apply(n.id, { kind: 'clone-instance', source: protoA, slot: n, priority: 0 })
              const rB = c.clientAPI.apply(n.id, { kind: 'clone-instance', source: protoB, slot: n, priority: 1 })
              if (rA.status === 'applied' && rB.status === 'applied') {
                const copyA = rA.dirtied?.[0] ? c.tree.getNode(rA.dirtied[0]) : undefined
                const copyB = rB.dirtied?.[0] ? c.tree.getNode(rB.dirtied[0]) : undefined
                if (copyA) pendingByKey.set(`${nextKey}a`, [...(pendingByKey.get(`${nextKey}a`) ?? []), copyA])
                if (copyB) pendingByKey.set(`${nextKey}b`, [...(pendingByKey.get(`${nextKey}b`) ?? []), copyB])
              } else {
                throw new Error(`clone-instance rejected: ${rA.status}/${rB.status}`)
              }
            }
          },
        },
      ],
    })
  }
  for (const p of prototypes) installStressExpandBody(p)

  // ---- render: bootstrap once, then consume the supervisor's pass-2 --------
  let prevStates = new Map()
  let prevMap = null
  let bootstrapped = false
  function setStates(actionable) {
    const byNode = new Map()
    for (const s of actionable) {
      const arr = byNode.get(s.nodeId) ?? []
      arr.push(s)
      byNode.set(s.nodeId, arr)
    }
    for (const [id, arr] of byNode) prevStates.set(id, arr)
  }
  function render() {
    const origWarn = console.warn
    console.warn = () => {}
    try {
      if (!bootstrapped) {
        const cr = acc('compileMs', () => rootNode.compile(translated.nodes))
        PROFILE.compileCalls += 1
        setStates(cr.actionable)
        supervisor.recordResolved(cr.actionable)
        bootstrapped = true
      } else {
        const fresh = supervisor.takePass2States()
        for (const [id, arr] of fresh) prevStates.set(id, arr)
      }
      const actionable = []
      for (const [, states] of prevStates) actionable.push(...states)
      const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
      const els = acc('emitMs', () => emitElements(actionable, byNode))
      const ops = acc('diffMs', () => diffMinimal(prevMap, els))
      acc('applyMs', () => applyOps(adapter, ops))
      prevMap = new Map(els.map((e) => [e.wire, e]))
      PROFILE.renderCount += 1
      return { els, ops }
    } finally {
      console.warn = origWarn
    }
  }

  function flushMicrotasks() {
    const waits = []
    for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
    return Promise.all(waits)
  }

  document.getElementById('layer-plan').textContent =
    'depth ' + depth + '\n' +
    serverData.layerNames.map((n, i) => `L${i + 1}  ${LAYER_METHODS[i % 4]}  ${n}`).join('\n')

  // ---- helpers for the runner checks ---------------------------------------
  function allNodes() {
    return supervisor.allNodes().filter((n) => !n.destroyed && n.isInTree && n !== rootNode)
  }
  function wireOf(el) {
    if (!el) return ''
    return el.getAttribute?.('data-wire') ?? el.dataset?.wire ?? ''
  }

  // --------------------------------------------------------------------------
  async function main() {
    // bootstrap render (the ONLY full compile of the page)
    render()

    // kick off the recursion: clone the layer-1 prototypes onto the root and
    // seed the pending registry from the clone results. The root has no
    // handler of its own, so it also gets a tick to recompile with the fresh
    // childOrder.
    const r1 = clientAPI.apply(rootNode.id, { kind: 'clone-instance', source: protoByKey.get('1:a'), slot: rootNode, priority: 0 })
    const r2 = clientAPI.apply(rootNode.id, { kind: 'clone-instance', source: protoByKey.get('1:b'), slot: rootNode, priority: 1 })
    if (r1.status !== 'applied' || r2.status !== 'applied') {
      throw new Error(`layer-1 clone-instance rejected: ${r1.status}/${r2.status}`)
    }
    pendingByKey.set('1:a', [supervisor.getNode(r1.dirtied[0])])
    pendingByKey.set('1:b', [supervisor.getNode(r2.dirtied[0])])
    clientAPI.apply(rootNode.id, [{ targetProp: 'props.stressTick', mode: 'replace', value: 1 }])

    // drain the supervisor's pass-2 pipeline (the handler recursion schedules
    // its own microtask flushes — one generation per round).
    for (let round = 0; round < 40; round += 1) {
      await flushMicrotasks()
      const pending = supervisor.takePass2States()
      if (pending.size === 0) break
      for (const [id, arr] of pending) prevStates.set(id, arr)
      render()
      if (round === 39) throw new Error('pass-2 did not drain after 40 rounds')
    }

    // ---- checks -------------------------------------------------------------
    await runner.check('layer k has exactly 2^k nodes; total (incl. root) = 2^depth − 1', () => {
      const inTree = supervisor.allNodes().filter((n) => !n.destroyed && n.isInTree)
      if (inTree.length !== 2 ** depth - 1) {
        throw new Error(`total: expected ${2 ** depth - 1}, got ${inTree.length}`)
      }
      for (let k = 1; k <= depth - 1; k += 1) {
        const layerNodes = inTree.filter((n) => n.props?.['stress:layer'] === k)
        if (layerNodes.length !== 2 ** k) {
          throw new Error(`layer ${k}: expected ${2 ** k} nodes, got ${layerNodes.length}`)
        }
      }
    })

    await runner.check('prototypes stay unplaced; every clone is in-tree', () => {
      const unplaced = supervisor.allNodes().filter((n) => !n.destroyed && n.state === 'unplaced')
      if (unplaced.length !== prototypes.length) {
        throw new Error(`expected ${prototypes.length} unplaced prototypes, got ${unplaced.length}`)
      }
    })

    await runner.check('css stress: each level changes a DIFFERENT property; the two sibling slots get the two expected values', () => {
      const seenPairs = {}
      for (const [key, el] of adapter.wires) {
        const attr = el.getAttribute?.('stress:layer') ?? ''
        if (!attr) continue
        const level = Number(attr)
        const prop = cssPropForLevel(level)
        const cssText = el.style?.cssText ?? el.getAttribute?.('data-css-style') ?? ''
        const m = new RegExp(`${prop}:\\s*([^;]+);`).exec(cssText)
        if (!m) throw new Error(`element ${key} (L${level}) has no ${prop} in style "${cssText}"`)
        const pair = `${prop}=${m[1].trim()}`
        ;(seenPairs[level] ??= new Set()).add(pair)
      }
      for (let k = 1; k <= depth - 1; k += 1) {
        const mkPair = (slot) => {
          const css = levelCss(k, slot)
          const m = /^([a-z-]+):\s*([^;]+);/.exec(css.style)
          return `${m[1]}=${m[2].trim()}`
        }
        const expected = new Set([mkPair('a'), mkPair('b')])
        if (expected.size !== 2) throw new Error(`L${k}: sibling slots share a css value`)
        const actual = seenPairs[k] ?? new Set()
        if (actual.size !== 2) throw new Error(`L${k}: expected exactly 2 css pairs, got ${[...actual].join(' | ')}`)
        for (const e of expected) if (!actual.has(e)) throw new Error(`L${k}: missing expected pair ${e} (got ${[...actual].join(' | ')})`)
      }
    })

    await runner.check('stress:kind on every node matches its layer mechanism', () => {
      for (const n of allNodes()) {
        const k = n.props?.['stress:layer']
        const expected = LAYER_METHODS[(k - 1) % LAYER_METHODS.length]
        if (n.props?.['stress:kind'] !== expected) {
          throw new Error(`node ${n.id} (L${k}): stress:kind "${n.props?.['stress:kind']}" ≠ "${expected}"`)
        }
      }
      for (const [, el] of adapter.wires) {
        const attr = el.getAttribute?.('stress:layer') ?? ''
        if (!attr) continue
        const k = Number(attr)
        const expected = LAYER_METHODS[(k - 1) % LAYER_METHODS.length]
        const kind = el.getAttribute?.('stress:kind') ?? ''
        if (kind !== expected) throw new Error(`element wire ${wireOf(el)} (L${k}): stress:kind "${kind}" ≠ "${expected}"`)
      }
    })

    await runner.check('DOM nesting: every element\'s direct children are exactly its graph node\'s children', () => {
      const rootEl = adapter.wires.get(rootNode.id)
      if (!rootEl) throw new Error('root element missing from the adapter wire map')
      let checked = 0
      const walk = (el) => {
        const wire = wireOf(el)
        const node = wire ? supervisor.getNode(wire) : undefined
        if (node) {
          const domKids = Array.from(el.children ?? []).map((c) => wireOf(c)).filter(Boolean)
          const graphKids = node.children.map((c) => c.id)
          if (JSON.stringify(domKids) !== JSON.stringify(graphKids)) {
            throw new Error(`nesting mismatch on ${wire}: DOM children ${JSON.stringify(domKids)} ≠ graph children ${JSON.stringify(graphKids)}`)
          }
          checked += 1
        }
        for (const c of Array.from(el.children ?? [])) walk(c)
      }
      walk(rootEl)
      if (checked !== 2 ** depth - 1) {
        throw new Error(`nesting check visited ${checked} nodes, expected ${2 ** depth - 1}`)
      }
    })

    await runner.check('every node documents its depth + tree back to root (stress:layers)', () => {
      for (const n of allNodes()) {
        const k = n.props?.['stress:layer']
        const chain = n.props?.['stress:layers']
        const segments = (chain ?? '').split('|').filter(Boolean)
        if (segments.length !== k) throw new Error(`node ${n.id}: chain "${chain}" has ${segments.length} segments, expected ${k}`)
        for (let i = 0; i < segments.length; i += 1) {
          const expected = chainSegment(i + 1)
          if (segments[i] !== expected) {
            throw new Error(`node ${n.id}: chain segment ${i + 1} "${segments[i]}" ≠ "${expected}"`)
          }
        }
      }
    })

    await runner.check('idempotent expansion: every node expanded exactly once (2 children per non-leaf, no after-compile loops)', () => {
      for (const n of allNodes()) {
        const k = n.props?.['stress:layer']
        if (k < depth - 1) {
          if (n.children.length !== 2) throw new Error(`node ${n.id} (L${k}): expected 2 children, got ${n.children.length}`)
          if (n.props?.['stress:expanded'] !== true) throw new Error(`node ${n.id} (L${k}): stress:expanded not set`)
        } else if (n.children.length !== 0) {
          throw new Error(`leaf node ${n.id} (L${k}): expected 0 children, got ${n.children.length}`)
        }
      }
    })

    await runner.check('incremental render contract: bootstrap was the only full compile', () => {
      if (PROFILE.compileCalls !== 1) throw new Error(`expected 1 full compile (bootstrap), got ${PROFILE.compileCalls}`)
      if (PROFILE.renderCount < 2) throw new Error(`expected incremental renders after bootstrap, got ${PROFILE.renderCount}`)
    })

    runner.summary(`Fork Stress (data) — depth ${depth}`)

    PROFILE.totalMs = now() - tStart
    const f = (v) => v.toFixed(1)
    console.log(
      `[fork-stress-data:profile] depth=${depth} nodes=${2 ** depth - 1} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms ` +
      `renders=${PROFILE.renderCount} handlers=${PROFILE.handlerCalls} total=${f(PROFILE.totalMs)}ms`,
    )
  }

  // The smoke test awaits this to know the page finished (deep pages take
  // longer than the generic settle window).
  globalThis.__forkStressDataDone = main()
}
