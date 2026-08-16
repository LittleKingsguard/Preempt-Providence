/**
 * Fork-stress DATA-DRIVEN browser page + data envelope module.
 *
 * One module, two roles:
 *
 *  1. DATA (`forkStressLegacyData(depth, method)`, exported): the LEGACY
 *     envelope (`LegacyInitialData`) carrying the root and, per layer
 *     1..depth−1, TWO prototype nodes (one per sibling slot). The prototypes
 *     declare their `after-compile` handler BY NAME (`handlers: [{ name:
 *     'stress-expand', phase: 'after-compile' }]` — the BODY cannot be
 *     JSON-serialized). The page module supplies the body for that name.
 *     This export is used by scripts/fork-stress-data-page.mjs (Node) to
 *     embed the envelope.
 *
 *     `method` selects WHICH child-creation mechanism the whole tree relies on
 *     (the "single-method" pages — spec: docs/specs/fork-stress-data.md §4):
 *       - undefined (default): the FOUR-mechanism cycle label per layer
 *         (placement → values → link → handler, repeated) — the original
 *         multi-method pages, where the labels document the mechanism that
 *         the IMPERATIVE page drives for that layer;
 *       - 'placement': the tree is pure clone-instance structure — every
 *         node's `stress:kind` is `placement`, no component refs;
 *       - 'values': every prototype carries `component: { reference:
 *         'values-<layer>.<slot>', value: 'value-<SLOT>-<layer>' }` — a
 *         value-bearing binding translates to a SOURCE anchor (translate.md
 *         §2), the clone-instance op inherits it WITH its value, and every
 *         clone resolves its own provider depth-0 and renders it as text;
 *       - 'link': every prototype carries `component: { reference:
 *         'link-<layer>', value: <def> }` — each clone's inherited source is
 *         a component DEF (prototype-as-child link) whose EMISSION re-types
 *         the clone's children per the def. This exercises the recursive def
 *         chain: every level is a def consumer whose children are themselves
 *         def consumers, so the emitter must emit defChildren for covered
 *         consumers too (render-helpers emitElements).
 *
 *     All sources are DECLARED IN THE DATA (the envelope) — the page module
 *     itself never attaches a single anchor: it stays core-only + legacy
 *     data (translateLegacy → Supervisor → clone-instance → render).
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
import { LAYER_METHODS, layerName, levelCss, cssPropForLevel, linkDefForLevel } from './fork-stress-fixture.js'

// ============================================================================
// DATA — the LEGACY envelope (pure data derivation, no graph construction).
// ============================================================================

/**
 * LegacyInitialData for a fork-stress page of the given depth: the root plus
 * TWO prototype nodes per layer 1..depth−1 (slot 'a' = div, slot 'b' = span).
 * The prototypes are content-payload items, family-in-tree via the
 * contentNodes permanent-owner token (P3 §10.ad/F-13); the tree assembles at
 * runtime via `clone-instance`. `levelCss(layer, slot)` supplies the per-level
 * property + per-slot value css stressor (shared pure helper from
 * fork-stress-fixture.js — demo-only, NOT a core API).
 *
 * `method` picks the single mechanism the whole tree relies on (see header):
 * 'values'/'link' declare the component SOURCE the mechanism needs ON THE
 * PROTOTYPE (a value-bearing `component` binding translates to a `source`
 * anchor — translate.md §2 — and the clone-instance op inherits the anchor
 * WITH its value, so every clone resolves its own provider depth-0 and
 * renders it); the default keeps the four-mechanism cycle LABELS
 * (placement|values|link|handler) that the multi-method pages document per
 * layer.
 */
export function forkStressLegacyData(depth, method) {
  const prototypes = []
  for (let layer = 1; layer <= depth - 1; layer += 1) {
    for (const slot of ['a', 'b']) {
      const kind = method ?? LAYER_METHODS[(layer - 1) % LAYER_METHODS.length]
      const proto = {
        type: slot === 'a' ? 'div' : 'span',
        props: {
          'stress:layer': layer,
          'stress:slot': slot,
          'stress:kind': kind,
          'stress:handler': 'stress-expand',
          // the .fs-node ::before badge renders `"L" attr(data-depth)` —
          // the same depth marker the imperative page's nodes carry
          'data-depth': String(layer),
        },
        css: levelCss(layer, slot),
        handlers: [{ name: 'stress-expand', phase: 'after-compile' }],
        // `stress:expanded` is DERIVED from the node's own children count
        // (docs/specs/derived-state.md §9.2): no marker op, no re-dirty.
        // Clones inherit the declaration via baseFrom → Node.clone. Leaf
        // clones read false forever; non-leaves bake true once their
        // children exist. The chain (`stress:layers`) stays op-based
        // (§6 — cross-node derived reads are out of scope). `data-path`
        // bakes the compiled pathKey so every node DISPLAYS its path back
        // to root (the .fs-node ::after badge renders attr(data-path)).
        derived: {
          props: {
            'stress:expanded': {
              $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true, else: false },
            },
            'data-path': { $: 'pathKey' },
          },
        },
      }
      if (method === 'values') {
        // every clone provides (and renders) its own scalar value
        proto.component = { reference: `values-${layer}.${slot}`, value: `value-${slot.toUpperCase()}-${layer}` }
      }
      if (method === 'link') {
        // every clone provides the component DEF that re-types its children
        proto.component = { reference: `link-${layer}`, value: linkDefForLevel(layer) }
      }
      prototypes.push(proto)
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
  const method = serverData.method

  const adapter = new DomAdapter(document.getElementById('app'))

  // ---- profiling -----------------------------------------------------------
  // Measured sections: load (translate), compile (bootstrap), emit/diff/apply
  // (render). pass2Ms covers the mutation pipeline the render sections never
  // touch (kick-off ops + flush cascades + takePass2States — where the
  // after-compile expansion runs); handlerMs times the 4094 body executions.
  // coveredMs = Σ(all timed) — the smoke asserts it covers ~all of totalMs so
  // "total" can never hide an untimed pipeline again (RCA:
  // docs/session-defect-review.md, "missing timing steps").
  const PROFILE = {
    loadMs: 0, compileMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    pass2Ms: 0, handlerMs: 0,
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
  const prototypes = translated.content // the contentNodes-owned prototype roots
  PROFILE.loadMs = now() - loadT0

  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const clientAPI = createClient(supervisor)

  // prototype registry: `layer:slot` → prototype node
  const protoByKey = new Map()
  for (const p of prototypes) protoByKey.set(`${p.props['stress:layer']}:${p.props['stress:slot']}`, p)

  /** Chain segment for a layer. Single-method pages: `L<k>:<method>` for every
   *  layer. Multi-method (cycle) pages keep the imperative page's format
   *  (L1:placement, L2:values-1, L3:link-1, L4:handler-1, L5:placement, …). */
  function chainSegment(layer) {
    if (method) return `L${layer}:${method}`
    const m = LAYER_METHODS[(layer - 1) % LAYER_METHODS.length]
    return m === 'placement' ? `L${layer}:placement` : `L${layer}:${layerName(layer)}`
  }

  /** Install the `stress-expand` body on a prototype: the data declared the
   *  handler by NAME + phase; here the page supplies the BODY. The clone
   *  inherits the prototype's layer (incl. the body), so the body runs on
   *  every clone's after-compile. The body is SELF-CONTAINED: variant A
   *  (ctx.node) lets it identify the clone it runs on (layer/slot read from
   *  the clone's own props) and expand THAT clone — no pending registry, no
   *  closure over (layer, slot). Each firing is O(1) and the clone fires
   *  EXACTLY ONCE: no self-ops at all — the idempotency guard is
   *  `children.length`-only (the parent sets the CHILDREN's chains at
   *  creation; a leaf hits the deepest-layer return BEFORE any op, so it
   *  never re-dirties; derived-state.md §9.2). */
  function installStressExpandBody(proto) {
    proto.addLayer({
      id: `stress-expand-${proto.id}`,
      handlers: [
        {
          name: 'stress-expand',
          phase: 'after-compile',
          body: (c) => {
            PROFILE.handlerCalls += 1
            const h0 = now()
            try {
            const n = c.node
            if (!n) return
            // idempotency guard: children.length-only — a clone with
            // children was already expanded. No self-ops, so the clone is
            // never re-dirtied by its own body.
            if (n.children.length > 0) return
            const layer = n.props['stress:layer']
            // deepest layer: the leaf check runs BEFORE any op/child work —
            // a leaf never touches an op (no re-dirty → no re-fire → no loop)
            if (layer >= depth - 1) return
            // clone the NEXT layer's prototypes under this clone — the
            // supervisor registers + attaches + marks the copies pass-2
            // dirty, so their own after-compile expands the next layer
            // (recursive assembly — each clone expands itself). The parent
            // then sets the CHILDREN's chains at creation: the fresh copy is
            // in-tree right after attach, so the state-slice applies; both
            // marks (clone-instance + chain slice) land in the SAME flush
            // (pass2Dirty is a Set) — one flush, one compile, one fire.
            const parentChain = n.props?.['stress:layers'] ?? ''
            const childChain = parentChain ? `${parentChain}|${chainSegment(layer + 1)}` : chainSegment(layer + 1)
            const rA = c.clientAPI.apply(n.id, { kind: 'clone-instance', source: protoByKey.get(`${layer + 1}:a`), slot: n, priority: 0 })
            const rB = c.clientAPI.apply(n.id, { kind: 'clone-instance', source: protoByKey.get(`${layer + 1}:b`), slot: n, priority: 1 })
            if (rA.status !== 'applied' || rB.status !== 'applied') {
              throw new Error(`clone-instance rejected: ${rA.status}/${rB.status}`)
            }
            for (const r of [rA, rB]) {
              const copyId = r.dirtied?.[0]
              if (copyId) {
                c.clientAPI.apply(copyId, [{ targetProp: 'props.stress:layers', mode: 'replace', value: childChain }])
              }
            }
            } finally {
              PROFILE.handlerMs += now() - h0
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
   // The renderer only ever renders nodes with compiled states: the bootstrap
   // slice includes the contentNodes-owned PROTOTYPES, but the token
   // terminates the compile walk (P3 §2.4) — they never produce states, so
   // they never reach the emit path and the DOM never grows phantom
   // prototype elements (the isInTree guard is belt-and-braces).
   function mergeStates(byNode) {
     for (const [id, arr] of byNode) {
       if (!supervisor.getNode(id)?.isInTree) continue
       prevStates.set(id, arr)
     }
   }
   function setStates(actionable) {
     const byNode = new Map()
     for (const s of actionable) {
       const arr = byNode.get(s.nodeId) ?? []
       arr.push(s)
       byNode.set(s.nodeId, arr)
     }
     mergeStates(byNode)
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
         mergeStates(fresh)
       }
      const actionable = []
      for (const [, states] of prevStates) actionable.push(...states)
      const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
      const els = acc('emitMs', () => emitElements(actionable, byNode))
      const ops = acc('diffMs', () => diffMinimal(prevMap, els))
      acc('applyMs', () => {
        adapter.beginBatch()
        applyOps(adapter, ops)
        adapter.endBatch()
      })
      prevMap = new Map(els.map((e) => [e.wire, e]))
      PROFILE.renderCount += 1
      return { els, ops }
    } finally {
      console.warn = origWarn
    }
  }

  let flushYields = 0
  let flushIdleMs = 0
  function flushMicrotasks() {
    // 2026-08-16 — the MICROTASK drain (no timer yields): the pass-2 cascade
    // is microtask-bound (scheduleFlush → queueMicrotask; handler applies
    // chain in microtasks), so checkpoints of `await Promise.resolve()` drain
    // it. Timer yields (setTimeout(0)) were the pass2Ms inflator: browsers
    // and even Node clamp/throttle 0ms timers (0.5s+ per yield here, seconds
    // in the browser) — the d12 pages measured pass2 ≈ 5-54s of mostly
    // scheduler idle while the page had already populated. hasPendingWork()
    // is the non-draining settle-check; flushYields/flushIdleMs split the
    // drain window (now ≈ the engine work).
    return (async () => {
      for (let i = 0; i < 100; i += 1) {
        const y0 = now()
        await Promise.resolve()
        flushIdleMs += now() - y0
        flushYields += 1
        if (!supervisor.hasPendingWork()) return
      }
    })()
  }

  document.getElementById('layer-plan').textContent =
    'depth ' + depth + (method ? ` (single method: ${method})` : '') + '\n' +
    serverData.layerNames.map((n, i) => `L${i + 1}  ${method ?? LAYER_METHODS[i % 4]}  ${n}`).join('\n')

  // ---- helpers for the runner checks ---------------------------------------
  // the prototype content roots are family-in-tree (contentNodes-owned, F-13)
  // but never compile/render — every per-node render/derived check below is
  // about the CLONE tree, so the prototypes are excluded
  function allNodes() {
    return supervisor.allNodes().filter((n) => !n.destroyed && n.isInTree && n !== rootNode && !prototypes.includes(n))
  }
  function wireOf(el) {
    if (!el) return ''
    return el.getAttribute?.('data-wire') ?? el.dataset?.wire ?? ''
  }
  function elText(el) {
    return el.textContent ?? ''
  }

  // --------------------------------------------------------------------------
  async function main() {
    // bootstrap render (the ONLY full compile of the page)
    render()

    // kick off the recursion: clone the layer-1 prototypes onto the root,
    // then set the L1 chains the same way the expander sets child chains
    // (the L1 copies are in-tree right after attach; both marks land in the
    // same flush). The root has no handler of its own, so it also gets a
    // tick to recompile with the fresh childOrder.

    // drain the supervisor's pass-2 pipeline (the handler recursion schedules
    // its own microtask flushes — one generation per round). The ENTIRE
    // runtime expansion (kick-off ops, flush cascades, per-flush pass-2
    // compiles + after-compile dispatches, takePass2States) is timed as
    // pass2Ms — the render sections above never touch this region (RCA:
    // docs/session-defect-review.md "missing timing steps").
    const p0 = now()
    const kickR1 = clientAPI.apply(rootNode.id, { kind: 'clone-instance', source: protoByKey.get('1:a'), slot: rootNode, priority: 0 })
    const kickR2 = clientAPI.apply(rootNode.id, { kind: 'clone-instance', source: protoByKey.get('1:b'), slot: rootNode, priority: 1 })
    if (kickR1.status !== 'applied' || kickR2.status !== 'applied') {
      throw new Error(`layer-1 clone-instance rejected: ${kickR1.status}/${kickR2.status}`)
    }
    for (const r of [kickR1, kickR2]) {
      const copyId = r.dirtied?.[0]
      if (copyId) {
        clientAPI.apply(copyId, [{ targetProp: 'props.stress:layers', mode: 'replace', value: chainSegment(1) }])
      }
    }
    // the root has no handler of its own, so it also gets a tick to
    // recompile with the fresh childOrder
    clientAPI.apply(rootNode.id, [{ targetProp: 'props.stressTick', mode: 'replace', value: 1 }])
    PROFILE.pass2Ms += now() - p0
    for (let round = 0; round < 40; round += 1) {
      const r0 = now()
      await flushMicrotasks()
      const pending = supervisor.takePass2States()
      PROFILE.pass2Ms += now() - r0
      if (pending.size === 0) break
      mergeStates(pending)
      render()
      if (round === 39) throw new Error('pass-2 did not drain after 40 rounds')
    }

    // ---- checks -------------------------------------------------------------
    // F-13 re-pin (placement-path-spec §5.2): the contentNodes-ownership
    // minting makes the 22 PROTOTYPES family-in-tree too, so the census is
    // in-tree = 2^depth − 1 + prototypes.length (4117 at d12), unplaced = 0.
    await runner.check(`layer k has exactly 2^k clones + 2 prototypes; total (incl. root) = 2^depth − 1 + prototypes`, () => {
      const inTree = supervisor.allNodes().filter((n) => !n.destroyed && n.isInTree)
      if (inTree.length !== 2 ** depth - 1 + prototypes.length) {
        throw new Error(`total: expected ${2 ** depth - 1 + prototypes.length}, got ${inTree.length}`)
      }
      for (let k = 1; k <= depth - 1; k += 1) {
        const layerNodes = inTree.filter((n) => n.props?.['stress:layer'] === k)
        if (layerNodes.length !== 2 ** k + 2) {
          throw new Error(`layer ${k}: expected ${2 ** k} clones + 2 prototypes, got ${layerNodes.length}`)
        }
      }
    })

    await runner.check('prototypes are contentNodes-owned in-tree; no node is unplaced', () => {
      const unplaced = supervisor.allNodes().filter((n) => !n.destroyed && n.state === 'unplaced')
      if (unplaced.length !== 0) {
        throw new Error(`expected 0 unplaced nodes, got ${unplaced.length}`)
      }
      for (const p of prototypes) {
        if (p.state !== 'in-tree') throw new Error(`prototype ${p.id} expected in-tree (contentNodes owner), got ${p.state}`)
        const pa = p.childAnchor()?.link.anchorsOf('parent')[0]
        if (pa?.target !== 'contentNodes') throw new Error(`prototype ${p.id} lost its contentNodes parent anchor (${pa?.target})`)
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
        const expected = method ?? LAYER_METHODS[(k - 1) % LAYER_METHODS.length]
        if (n.props?.['stress:kind'] !== expected) {
          throw new Error(`node ${n.id} (L${k}): stress:kind "${n.props?.['stress:kind']}" ≠ "${expected}"`)
        }
      }
      for (const [, el] of adapter.wires) {
        const attr = el.getAttribute?.('stress:layer') ?? ''
        if (!attr) continue
        const k = Number(attr)
        const expected = method ?? LAYER_METHODS[(k - 1) % LAYER_METHODS.length]
        const kind = el.getAttribute?.('stress:kind') ?? ''
        if (kind !== expected) throw new Error(`element wire ${wireOf(el)} (L${k}): stress:kind "${kind}" ≠ "${expected}"`)
      }
    })

    if (method === 'values') {
      await runner.check('values-only: every node renders its component-provided value as text', () => {
        for (const n of allNodes()) {
          const el = adapter.wires.get(n.id)
          if (!el) throw new Error(`no element for ${n.id}`)
          const k = n.props['stress:layer']
          const slot = n.props['stress:slot']
          const expected = `value-${slot.toUpperCase()}-${k}`
          if (!elText(el).includes(expected)) {
            throw new Error(`node ${n.id} (L${k}${slot}): text "${elText(el)}" lacks "${expected}"`)
          }
        }
      })
    }

    if (method === 'link') {
      await runner.check('link-only: every node renders via its parent def (div type, def content)', () => {
        for (const n of allNodes()) {
          const el = adapter.wires.get(n.id)
          if (!el) throw new Error(`no element for ${n.id}`)
          const k = n.props['stress:layer']
          if ((el.tagName ?? '').toLowerCase() !== 'div') {
            throw new Error(`node ${n.id} (L${k}): expected div (def type), got ${el.tagName}`)
          }
          if (k > 1) {
            const expected = `link-${k - 1}.${n.props['stress:slot']}`
            if (!elText(el).includes(expected)) {
              throw new Error(`node ${n.id} (L${k}): text "${elText(el)}" lacks def content "${expected}"`)
            }
          }
        }
      })
    }

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

    await runner.check('every node derives its pathKey into a displayable data-path (derived: { $: pathKey })', () => {
      for (const n of allNodes()) {
        const k = n.props?.['stress:layer']
        // the DERIVED contract: every node's compiled state carries the bake
        const state = supervisor.getResolvedStates(n.id)?.[0]
        const baked = state?.props?.['data-path']
        if (typeof baked !== 'string' || !baked.startsWith('root')) {
          throw new Error(`node ${n.id}: resolved state lacks derived data-path (got ${JSON.stringify(baked)})`)
        }
        const segments = baked.split('/').filter(Boolean)
        if (segments.length !== k + 1) {
          throw new Error(`node ${n.id} (L${k}): data-path "${baked}" has ${segments.length} segments, expected ${k + 1}`)
        }
        // the DOM attr (standalone-emitted nodes — link def-covered children
        // are re-typed from pass-1 props and legitimately lack it)
        const el = adapter.wires.get(n.id)
        const attr = el?.getAttribute?.('data-path') ?? null
        if (method !== 'link' && attr !== baked) {
          throw new Error(`node ${n.id}: element data-path "${attr}" ≠ derived "${baked}"`)
        }
      }
    })

    await runner.check('idempotent expansion: every node expanded exactly once (2 children per non-leaf, no after-compile loops)', () => {
      for (const n of allNodes()) {
        const k = n.props?.['stress:layer']
        // `stress:expanded` is DERIVED — read it from the RESOLVED state
        // (never pass-1 `n.props`, which does not carry it). Non-leaves must
        // bake true, leaves false (children.length-only rule).
        const resolvedProps = supervisor.getResolvedStates(n.id)?.[0]?.props
        if (k < depth - 1) {
          if (n.children.length !== 2) throw new Error(`node ${n.id} (L${k}): expected 2 children, got ${n.children.length}`)
          if (resolvedProps?.['stress:expanded'] !== true) throw new Error(`node ${n.id} (L${k}): derived stress:expanded not true (${resolvedProps?.['stress:expanded']})`)
        } else if (n.children.length !== 0) {
          throw new Error(`leaf node ${n.id} (L${k}): expected 0 children, got ${n.children.length}`)
        } else if (resolvedProps?.['stress:expanded'] !== false) {
          throw new Error(`leaf node ${n.id} (L${k}): derived stress:expanded not false (${resolvedProps?.['stress:expanded']})`)
        }
      }
    })

    await runner.check('incremental render contract: bootstrap was the only full compile', () => {
      if (PROFILE.compileCalls !== 1) throw new Error(`expected 1 full compile (bootstrap), got ${PROFILE.compileCalls}`)
      if (PROFILE.renderCount < 2) throw new Error(`expected incremental renders after bootstrap, got ${PROFILE.renderCount}`)
    })

    runner.summary(`Fork Stress (data${method ? `: ${method}` : ''}) — depth ${depth}`)

    // ---- clone-usage census (published for the smoke guard) -----------------
    // End-of-render census over the supervisor's registry (allNodes()):
    // in-tree/unplaced are asserted by the page's own checks above; the
    // rest is derived arithmetic the smoke pins (registered = in-tree +
    // unplaced + destroyed; cloneOps = registered − unplaced − 1 −
    // prototypes = the journaled clone-instance count, one per clone — the
    // prototypes are family-in-tree (F-13) but were never cloned into).
    const censusNodes = supervisor.allNodes()
    PROFILE.registered = censusNodes.length
    PROFILE.inTree = censusNodes.filter((n) => !n.destroyed && n.isInTree).length
    PROFILE.unplaced = censusNodes.filter((n) => !n.destroyed && n.state === 'unplaced').length
    PROFILE.destroyed = censusNodes.filter((n) => n.destroyed).length
    PROFILE.cloneOps = PROFILE.registered - PROFILE.unplaced - 1 - prototypes.length

    PROFILE.totalMs = now() - tStart
    const f = (v) => v.toFixed(1)
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.emitMs + PROFILE.diffMs +
      PROFILE.applyMs + PROFILE.pass2Ms + PROFILE.handlerMs
    console.log(
      `[fork-stress-data:profile] depth=${depth} method=${method ?? 'cycle'} nodes=${2 ** depth - 1} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms ` +
      `pass2=${f(PROFILE.pass2Ms)}ms handlerMs=${f(PROFILE.handlerMs)}ms ` +
      `flush=${flushYields}y/${f(flushIdleMs)}ms work:${f(supervisor.pass2WorkMs())}ms ` +
      `renders=${PROFILE.renderCount} handlers=${PROFILE.handlerCalls} ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} destroyed=${PROFILE.destroyed} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms ` +
      `unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    // the smoke guard reads the profile (per page) to assert coverage + the
    // d12 ratio bounds — see scripts/demo-smoke.mjs
    globalThis.__forkStressDataProfile = PROFILE
  }

  // The smoke test awaits this to know the page finished (deep pages take
  // longer than the generic settle window).
  globalThis.__forkStressDataDone = main()
}
