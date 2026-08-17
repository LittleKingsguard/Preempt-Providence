/**
 * Static derived-family page + data envelope module — the static re-expression
 * of the fork-stress tree (placement-path-spec §5): the SAME 2·(depth−1)-
 * prototype binary topology compiled by the §2 path enumeration instead of
 * runtime clone-instance assembly. THREE method variants (the derived trio,
 * derived-fork-variants-review §5.1): placement (the original static page),
 * values (component-provided scalar values on every prototype), link (the
 * component def on every prototype — the recursive def chain over
 * path-states). Depth-parameterized (2026-08-16 — the d14 scaling probes):
 * d12 = 23 nodes / 4095 path-states / 4095 elements; d14 = 27 nodes / 16383.
 * Same topology, ONE compilePath bootstrap, ZERO clone-instance ops, 2^depth − 1
 * elements for every method (the link census holds post the covered-leaf
 * def-fill gate — render.md P-EMIT-3 carve-out letter).
 *
 * One module, three roles:
 *
 *  1. DATA (`pathForkLegacyData(method, depth)`, exported): the LEGACY
 *     envelope carrying the root + TWO prototype nodes per layer 1..depth−1
 *     (2·(depth−1) prototypes, 2·depth−1 graph nodes — the R2.2
 *     sibling-shared owner-name topology, path-fork-review.md R2.2). Each
 *     prototype declares
 *     `placement: { placementName: 'zone-<k>' }` (producer — the 'container'
 *     role); layers ≥ 2 additionally declare
 *     `placement: { targetPlacement: ['zone-<k-1>'] }` (consumer — one
 *     requested name, the chosen name; BOTH level-(k−1) prototypes own the
 *     shared zone name, so the chosen name's two containers fan out the path
 *     per hop — §1.2/§2.2). NO handler bodies, NO clone-instance: the tree is
 *     compiled by the path enumeration (Σ 2^k for k=1..depth−1 + root =
 *     2^depth − 1 path-states pinned to 2·depth−1 nodes — E2E-1 by
 *     construction). The per-method component fields (values/link) are pure
 *     data on the prototypes — the fork-stress-data.js:125-132 shapes, minus
 *     the `handlers`/`stress:handler` residue (the derived model has no
 *     after-compile expansion).
 *
 *  2. NODE side (builder): `buildPathForkSurface(method, depth)` compiles the
 *     envelope once (translate → register → compilePath per node →
 *     emitElements → diffMinimal) and returns the full surface;
 *     `pathForkServerData(method, depth)` is the server reference (expected
 *     census + the hashed PAR-5 shape signature); `pathForkSsrSample(method)`
 *     renders the FIRST ops through the REAL SSRFragmentAdapter (PAR-5 parity
 *     sample — the full 2^depth−1-element fragment is ~180MB at d12 and is
 *     never embedded; parity is the signature). Used by scripts/path-fork-page.mjs.
 *
 *  3. PAGE (browser, guarded by `typeof document !== 'undefined'` so the
 *     builder can import the data without a DOM): CORE-ONLY imports
 *     (dist/core/*) — translate → register → ONE compilePath bootstrap →
 *     emitElements / diffMinimal / applyOps (DomAdapter) → render. NO
 *     clone-instance ops, NO after-compile expansion. The only shared helpers
 *     are the pure data-derivation `levelCss`/`cssPropForLevel`/`linkDefForLevel`
 *     from fork-stress-fixture (demo-only, NOT core APIs).
 *
 * The runtime fork-stress-data page (clone-based) is KEPT alongside as the
 * runtime proof (placement-path-spec §5.1 — Q4: both ship).
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter, SSRFragmentAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps, treeFromOps, treeSig, wireKey } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner } from './lib/runner.js'
import { levelCss, cssPropForLevel, linkDefForLevel } from './fork-stress-fixture.js'

// ============================================================================
// DATA — the LEGACY envelope (pure data derivation, no graph construction).
// ============================================================================

/**
 * LegacyInitialData for the static placement-path page: the root plus TWO
 * prototype nodes per layer 1..depth−1 (slot 'a' = div, slot 'b' = span).
 * Level-1 prototypes are template.root.children (family in-tree, producers
 * only — they own the shared 'zone-1' name); layers ≥ 2 are content payload
 * roots (contentNodes-owned, family-'in-tree' per the F-13 minting) carrying
 * `placementName` (producer) + `targetPlacement` (consumer — the level above's
 * shared zone name). `levelCss(layer, slot)` supplies the per-level property +
 * per-slot value css stressor (shared pure helper from fork-stress-fixture.js
 * — demo-only, NOT a core API).
 *
 * Census (placement-path-spec §5.2): 2·depth−1 nodes → 2^depth − 1
 * path-states (Σ 2^k, k=1..depth−1, + root), one per (prototype, owner-path)
 * pair back to root. d12: 23 nodes / 4095; d14: 27 nodes / 16383.
 *
 * `method` picks the SINGLE mechanism the whole tree relies on — the derived
 * trio (placement / values / link — derived-fork-variants-review §5.1):
 * 'placement' = the current shape (no component fields); 'values' adds the
 * component-provided scalar VALUE on every prototype (`component: {reference:
 * 'values-<k>.<slot>', value: 'value-<SLOT>-<k>'}` — the fork-stress-data.js
 * values shape); 'link' adds the component DEF on every prototype
 * (`component: {reference: 'link-<k>', value: linkDefForLevel(k)}` — the
 * fork-stress-data.js link shape). NO handlers, NO stress:handler residue,
 * NO clone-instance: the derived model has no after-compile expansion — the
 * per-method fields are pure data on the prototypes.
 */
export function pathForkLegacyData(method = 'placement', depth = 12) {
  const children = []
  const payload = []
  for (let k = 1; k <= depth - 1; k += 1) {
    for (const slot of ['a', 'b']) {
      const proto = {
        type: slot === 'a' ? 'div' : 'span',
        props: {
          // AUTHORED ids: stable across builds — the PAR-5 shape signature
          // compares props, and auto-minted ids would differ between the
          // builder (Node) and the page (browser) translations of the SAME
          // legacy envelope
          id: `p${k}${slot}`,
          'stress:layer': k,
          'stress:slot': slot,
          // the .fs-node ::before badge renders the depth marker
          'data-depth': String(k),
        },
        css: levelCss(k, slot),
        // P3 §1.1 two-sided placement: producer (placementName → 'container'
        // anchor) + consumer (targetPlacement → ordered 'content' anchors).
        // Level 1 owns the shared 'zone-1' name; every level ≥ 2 targets the
        // level above's single shared name (the R2.2 sibling-shared
        // owner-name topology) — first-match = that name, and the two sibling
        // containers of the chosen name fan out the path (§1.2).
        placement: {
          placementName: `zone-${k}`,
          ...(k >= 2 ? { targetPlacement: [`zone-${k - 1}`] } : {}),
        },
        // `stress:expanded` is DERIVED from the path-state's OWN (path-derived,
        // §2.3) children count — true for non-leaf path-states, false for
        // leaves. No marker op, no re-dirty (derived-state.md §9.2).
        derived: {
          props: {
            'stress:expanded': {
              $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true, else: false },
            },
          },
        },
      }
      if (method === 'values') {
        // every path-state provides (and renders) its own scalar value
        proto.component = { reference: `values-${k}.${slot}`, value: `value-${slot.toUpperCase()}-${k}` }
      }
      if (method === 'link') {
        // every path-state provides the component DEF that re-types its
        // children — the recursive def chain over path-states
        proto.component = { reference: `link-${k}`, value: linkDefForLevel(k) }
      }
      if (k === 1) children.push(proto)
      else payload.push(proto)
    }
  }
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'path-root' },
        // the root's path-state is a non-leaf too — it bakes the same derived
        // stress:expanded (children.length > 0) as every non-leaf prototype
        derived: {
          props: {
            'stress:expanded': {
              $if: { cond: { $gt: [{ $: 'children.length' }, 0] }, then: true, else: false },
            },
          },
        },
        children,
      },
    },
    content: [{ metadata: { title: `static ${method}-derived prototypes` }, content: payload }],
    clientConfig: { runInstantiation: false, runMonitoring: true },
  }
}

// ============================================================================
// NODE-side surface: compile the envelope once → render ops (shared by the
// page's DomAdapter and the builder's SSRFragmentAdapter — PAR-5 parity).
// ============================================================================

/** Compile the static envelope: translate → register → ONE path-enumeration
 *  pass (compilePath per node) → emitElements → diffMinimal. */
export function buildPathForkSurface(method = 'placement', depth = 12) {
  const doc = pathForkLegacyData(method, depth)
  const translated = translateLegacy(doc)
  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const actionable = []
  for (const n of translated.nodes) actionable.push(...n.compilePath().actionable)
  supervisor.recordResolved(actionable)
  const nodeById = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = emitElements(actionable, nodeById)
  const ops = diffMinimal(null, els)
  return { doc, translated, rootNode: translated.root, supervisor, nodeById, actionable, els, ops }
}

/** Deterministic small hash (FNV-1a 64-bit) over a string — used to digest
 *  the PAR-5 shape so the embedded reference stays tiny. The full-tree
 *  treeSig of a 4095-node nested binary tree is ~190MB (O(n·depth)
 *  serialization); the digest is the parity reference instead (collision
 *  risk negligible for a structural check; not a security hash). */
export function hash64(str) {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < str.length; i += 1) {
    h ^= BigInt(str.charCodeAt(i))
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

/** Recursive shape digest: folds each node's (type, sorted props, children
 *  digests) into a small string and hashes it. NEVER materializes the full
 *  tree as a string (treeSig of a 4095-node nested binary tree is ~190MB —
 *  O(n·depth) serialization; the recursive fold is O(n) and the per-node
 *  props JSON is small). Deterministic: same algorithm server + client. */
export function shapeSigOfTrees(trees) {
  const sortVal = (v) => {
    if (Array.isArray(v)) return v.map(sortVal)
    if (v !== null && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v).sort()) o[k] = sortVal(v[k])
      return o
    }
    return v
  }
  const fold = (nodes) => {
    let acc = ''
    for (const n of nodes) {
      const props = n.props ? JSON.stringify(sortVal(n.props)) : ''
      const kids = fold(n.children ?? [])
      acc += `${n.type}:${props}:${kids.length ? hash64(kids) : ''};`
    }
    return acc
  }
  return hash64(fold(trees))
}

export function pathForkShapeSig(ops) {
  return shapeSigOfTrees(treeFromOps(ops))
}

/** Expected census + parity reference embedded in the page (server-data).
 *  Depth-parameterized (2026-08-16 — the d14 scaling probes): d12 = 23 nodes
 *  / 4095 states; d14 = 27 nodes / 16383 states. */
export function pathForkServerData(method = 'placement', depth = 12) {
  const s = buildPathForkSurface(method, depth)
  const states = 2 ** depth - 1
  return {
    method,
    depth,
    expected: {
      nodes: 2 * depth - 1,
      states,
      elements: states,
      unplaced: 0,
      cloneOps: 0,
      // per-level element counts: 2^k at level k (k = 1..depth−1)
      perLevel: Array.from({ length: depth - 1 }, (_, i) => 2 ** (i + 1)),
    },
    serverTreeSig: pathForkShapeSig(s.ops),
  }
}

/** Cheap SSR SAMPLE: applies only the FIRST `maxOps` ops (root element + early
 *  structure) through the SSRFragmentAdapter. The full 2^depth−1-element
 *  fragment is ~180MB at d12 (nested binary tree — O(n·depth) serialization)
 *  and is NEVER rendered for embedding; parity is the hashed shape signature. */
export function pathForkSsrSample(method = 'placement', maxOps = 300, depth = 12) {
  const { ops } = buildPathForkSurface(method, depth)
  const adapter = new SSRFragmentAdapter()
  applyOps(adapter, ops.slice(0, maxOps))
  return adapter.toString()
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
  const expected = serverData.expected
  // the derived-family method: 'placement' (baseline) | 'values' | 'link'
  const method = serverData.method ?? 'placement'
  // depth-parameterized family (2026-08-16 — the d14 scaling probes): d12 =
  // 23 nodes / 4095 path-states; d14 = 27 nodes / 16383 path-states.
  const depth = serverData.depth ?? 12
  const familyNodes = 2 * depth - 1
  const familyStates = 2 ** depth - 1
  const familyLayers = depth - 1

  // ---- profiling -----------------------------------------------------------
  // Measured sections: load (translate), compile (the ONE path-enumeration
  // bootstrap), emit/diff/apply (render). coveredMs = Σ(all timed) — the smoke
  // asserts it covers ~all of totalMs so "total" can never hide an untimed
  // pipeline (RCA: docs/session-defect-review.md — the profiler does NOT time
  // pass-2; the static page has no pass-2, its bootstrap IS the enumeration).
  const PROFILE = {
    loadMs: 0, compileMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    checksMs: 0, renderCount: 0, compileCalls: 0, totalMs: 0, coveredMs: 0,
    states: 0, elements: 0, registered: 0, inTree: 0, unplaced: 0, destroyed: 0, cloneOps: 0,
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
  const translated = acc('loadMs', () => translateLegacy(envelope))
  const rootNode = translated.root

  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)

  // ---- ONE path-enumeration bootstrap pass --------------------------------
  const actionable = acc('compileMs', () => {
    const out = []
    for (const n of translated.nodes) out.push(...n.compilePath().actionable)
    return out
  })
  PROFILE.compileCalls = 1
  supervisor.recordResolved(actionable)

  const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = acc('emitMs', () => emitElements(actionable, byNode))
  const ops = acc('diffMs', () => diffMinimal(null, els))
  const adapter = new DomAdapter(document.getElementById('app'))
  acc('applyMs', () => {
    adapter.beginBatch()
    applyOps(adapter, ops)
    adapter.endBatch()
  })
  PROFILE.renderCount = 1

  const stateByWire = new Map(actionable.map((s) => [s.pathKey, s]))
  const layerOfState = (s) => byNode.get(s.nodeId)?.props?.['stress:layer']
  // every STANDALONE path-state element is stored under the composite key
  // wireKey(pathKey, forkKey) = `pathKey\x00pathKey` (forkKey = pathKey) —
  // bare pathKey lookups miss (the same composite-key contract as fork arms).
  // Re-typed def-chain children (the LINK-derived page's covered path-states)
  // are built WITHOUT a forkKey (render-helpers.ts reTyped — the adapter-key
  // asymmetry, derived-fork-variants-review §3.3/§4.4) → stored under the
  // BARE pathKey. `elOfWire` tries bare first then the composite — the checks
  // must NEVER use the composite-only `domElOf` lookup on the link page.
  const elOfWire = (pathKey) => adapter.wires.get(pathKey) ?? adapter.wires.get(wireKey(pathKey, pathKey))
  function wireOf(el) {
    return el?.getAttribute?.('data-wire') ?? el?.dataset?.wire ?? ''
  }
  function elText(el) {
    return el.textContent ?? ''
  }

  async function main() {
    // ---- checks -----------------------------------------------------------
    // The verification surface over 4095 elements is the page's heavy region
    // (treeFromOps' forkKey-prefix edge resolution, shape signatures, DOM
    // walks) — it is TIMED (checksMs) so the profile covers it, exactly as
    // fork-stress-data times its pass2/handler regions (RCA: the profiler
    // must not hide untimed regions in `total − Σ(measured)`).
    const checksT0 = now()
    const trees = treeFromOps(ops)
    // ---- node census (placement-path-spec §5.2) ----------------------------
    await runner.check(`node census: registered=${familyNodes}, in-tree=${familyNodes}, unplaced=0, destroyed=0, cloneOps=0`, () => {
      const all = supervisor.allNodes()
      if (all.length !== familyNodes) throw new Error(`registered: expected ${familyNodes}, got ${all.length}`)
      const inTree = all.filter((n) => !n.destroyed && n.isInTree)
      if (inTree.length !== familyNodes) throw new Error(`in-tree: expected ${familyNodes} (${familyNodes - 1} prototypes contentNodes-owned + root), got ${inTree.length}`)
      const unplaced = all.filter((n) => !n.destroyed && n.state === 'unplaced')
      if (unplaced.length !== 0) throw new Error(`unplaced: expected 0, got ${unplaced.length}`)
      const destroyed = all.filter((n) => n.destroyed)
      if (destroyed.length !== 0) throw new Error(`destroyed: expected 0, got ${destroyed.length}`)
      if (supervisor.journal.length !== 0) throw new Error(`journal must be empty (no ops applied), got ${supervisor.journal.length}`)
      // no clone-instance ops, no placement-attach ops, no state-slices: the
      // static model mints NO clones and applies NO ops (E2E-1)
      PROFILE.cloneOps = 0
    })

    // ---- state census -------------------------------------------------------
    await runner.check(`state census: ${familyStates} path-states, distinct pathKeys, forkKey = pathKey on every state`, () => {
      if (actionable.length !== familyStates) throw new Error(`states: expected ${familyStates}, got ${actionable.length}`)
      if (new Set(actionable.map((s) => s.pathKey)).size !== familyStates) throw new Error('pathKeys not distinct')
      for (const s of actionable) {
        if (s.forkKey !== s.pathKey) throw new Error(`forkKey ≠ pathKey on ${s.pathKey}`)
        if (s.pathKey !== 'root' && !s.pathKey.startsWith('root/')) throw new Error(`bad pathKey ${s.pathKey}`)
        if (s.pathKey.includes('#')) throw new Error(`arm suffix leaked into ${s.pathKey}`)
      }
    })

    // ---- element census + per-level counts ----------------------------------
    await runner.check(`element census: ${familyStates} elements, wires = pathKeys; level k has exactly 2^k elements`, () => {
      if (els.length !== familyStates) throw new Error(`elements: expected ${familyStates}, got ${els.length}`)
      const perLevel = {}
      for (const e of els) {
        const s = stateByWire.get(e.wire)
        if (!s) throw new Error(`element wire ${e.wire} has no path-state`)
        // the link-derived page's re-typed def-chain children carry NO forkKey
        // (built without one — the adapter-key asymmetry) — legitimately
        // different from the standalone forkKey = pathKey contract
        if (e.forkKey !== undefined && e.forkKey !== e.wire) throw new Error(`element ${e.wire}: forkKey ${e.forkKey} ≠ wire`)
        const k = layerOfState(s)
        perLevel[k] = (perLevel[k] ?? 0) + 1
      }
      for (let k = 1; k <= familyLayers; k += 1) {
        const n = 2 ** k
        if (perLevel[k] !== n) throw new Error(`level ${k}: expected ${n} elements, got ${perLevel[k]}`)
      }
      // the DOM mirrors the element set (every path-state rendered once) —
      // re-typed elements keep the child's OWN stress:layer attr, so the
      // per-level DOM counts hold for every method
      const domLevels = {}
      for (const [, el] of adapter.wires) {
        const attr = el.getAttribute?.('stress:layer')
        if (attr) domLevels[Number(attr)] = (domLevels[Number(attr)] ?? 0) + 1
      }
      for (let k = 1; k <= familyLayers; k += 1) {
        if (domLevels[k] !== 2 ** k) throw new Error(`DOM level ${k}: expected ${2 ** k} elements, got ${domLevels[k]}`)
      }
      if (elOfWire('root') == null) throw new Error('root element missing')
    })

    // ---- css stress (per-level property + per-slot value pairs) -------------
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
      for (let k = 1; k <= familyLayers; k += 1) {
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

    // ---- derived idempotency (path-derived children.length, §2.3) -----------
    await runner.check('derived: stress:expanded true for non-leaf path-states, false for leaves', () => {
      for (const s of actionable) {
        const k = layerOfState(s)
        // the root state is a non-leaf too (it declares the same derived prop)
        const nonLeaf = k === undefined || k < familyLayers
        if (s.props?.['stress:expanded'] !== nonLeaf) {
          throw new Error(`state ${s.pathKey} (L${k}): stress:expanded ${s.props?.['stress:expanded']}, expected ${nonLeaf}`)
        }
        // ELEMENT assertion scoped to standalone-emitted path-states: the
        // link-derived page's covered path-states are RE-TYPED from pass-1
        // node props and legitimately lack the derived bake (the runtime
        // page's method !== 'link' exemption pattern, fork-stress-data.js:594)
        if (method === 'link') continue
        const el = elOfWire(s.pathKey)
        if (el?.getAttribute?.('stress:expanded') !== String(nonLeaf)) {
          throw new Error(`element ${s.pathKey} (L${k}): baked stress:expanded ${el?.getAttribute?.('stress:expanded')}`)
        }
      }
    })

    // ---- per-method mechanism checks (the runtime bodies re-expressed as
    // path-state assertions — derived-fork-variants-review §6.1) -------------
    if (method === 'values') {
      await runner.check('values-derived: every path-state renders its component-provided value as text', () => {
        for (const s of actionable) {
          const k = layerOfState(s)
          if (k === undefined) continue // the root carries no source
          const slot = byNode.get(s.nodeId)?.props?.['stress:slot']
          const expected = `value-${slot.toUpperCase()}-${k}`
          const el = elOfWire(s.pathKey)
          if (!el) throw new Error(`no element for ${s.pathKey}`)
          if (!elText(el).includes(expected)) {
            throw new Error(`state ${s.pathKey} (L${k}${slot}): text "${elText(el)}" lacks "${expected}"`)
          }
        }
      })
    }

    if (method === 'link') {
      await runner.check('link-derived: every path-state renders via its parent def (div type, def content for k>1); re-typed children assert the child\'s OWN node props (review item 6)', () => {
        for (const s of actionable) {
          const k = layerOfState(s)
          if (k === undefined) continue // the root carries no def
          const el = elOfWire(s.pathKey)
          if (!el) throw new Error(`no element for ${s.pathKey}`)
          if ((el.tagName ?? '').toLowerCase() !== 'div') {
            throw new Error(`state ${s.pathKey} (L${k}): expected div (def type), got ${el.tagName}`)
          }
          const slot = byNode.get(s.nodeId)?.props?.['stress:slot']
          // level-1 path-states are re-typed by their OWN def (no def CONTENT
          // — content lives on the re-typed children); k ≥ 2 states are
          // re-typed by the level-(k−1) parent's def and carry its content
          if (k > 1) {
            const expected = `link-${k - 1}.${slot}`
            if (!elText(el).includes(expected)) {
              throw new Error(`state ${s.pathKey} (L${k}): text "${elText(el)}" lacks def content "${expected}"`)
            }
          }
          // explicit child-prop assertions: a covered re-type keeps the
          // CHILD's OWN authored props (the def spec's props are a fallback
          // for synthetic children only) — data-depth/stress:layer are the
          // child's level, NOT the parent def's layer
          if (el.getAttribute?.('data-depth') !== String(k)) {
            throw new Error(`state ${s.pathKey} (L${k}): data-depth ${el.getAttribute?.('data-depth')} ≠ own level ${k}`)
          }
          if (el.getAttribute?.('stress:layer') !== String(k)) {
            throw new Error(`state ${s.pathKey} (L${k}): stress:layer ${el.getAttribute?.('stress:layer')} ≠ own level ${k}`)
          }
        }
        // the adapter-key asymmetry pin: exactly the covered layers' elements
        // (L2..L11 = 4094 − 2 at d12) are re-typed (no forkKey, bare-wire
        // keys); the root + L1 (3) are standalone (forkKey = pathKey)
        const retyped = els.filter((e) => e.forkKey === undefined)
        if (retyped.length !== familyStates - 3) {
          throw new Error(`link-derived: expected ${familyStates - 3} re-typed def-chain elements (no forkKey), got ${retyped.length}`)
        }
      })
    }

    // ---- treeFromOps reconstructs the binary shape --------------------------
    await runner.check(`treeFromOps: one root; full binary tree (2 children per non-leaf); ${2 ** familyLayers} leaves at depth ${familyLayers}; ${familyStates} nodes total`, () => {
      if (trees.length !== 1 || trees[0].wire !== 'root') throw new Error(`expected a single root tree, got ${trees.length}`)
      let leaves = 0
      let total = 0
      const walk = (t, d) => {
        total += 1
        if (t.children.length === 0) {
          leaves += 1
          if (d !== familyLayers) throw new Error(`leaf at depth ${d}, expected ${familyLayers}`)
          return
        }
        if (t.children.length !== 2) throw new Error(`non-leaf at depth ${d} with ${t.children.length} children`)
        for (const c of t.children) walk(c, d + 1)
      }
      walk(trees[0], 0)
      if (total !== familyStates) throw new Error(`tree total: expected ${familyStates}, got ${total}`)
      if (leaves !== 2 ** familyLayers) throw new Error(`leaves: expected ${2 ** familyLayers}, got ${leaves}`)
    })

    // ---- PAR-5 parity against the builder's SSR snapshot --------------------
    await runner.check('PAR-5: in-browser render shape ≡ server render shape (wire-agnostic signature)', () => {
      const clientSig = shapeSigOfTrees(trees)
      if (clientSig !== serverData.serverTreeSig) throw new Error('server/client shape signatures differ')
    })
    await runner.check('SSR sample present: the builder\'s SSRFragmentAdapter fragment (truncated) is embedded', () => {
      // the full 2^depth−1-element fragment is ~180MB at d12 (nested binary
      // tree, O(n·depth) serialization) — NOT embedded; parity is the shape
      // signature above, and the embedded sample proves the builder's SSR
      // pipeline ran
      if (typeof serverData.expectedSsrSample !== 'string' || !serverData.expectedSsrSample.includes('<app')) {
        throw new Error('expected SSR sample missing from the page data')
      }
    })
    PROFILE.checksMs = now() - checksT0

    const methodLabel = { placement: 'static', values: 'values-derived', link: 'link-derived' }[method] ?? 'static'
    // the d12 banner keeps the original format; deeper families (the d14
    // scaling probes) carry the depth marker so the smoke can pin them apart
    runner.summary(
      depth === 12
        ? `Path Fork (${methodLabel}) — ${familyNodes} nodes / ${familyStates} path-states`
        : `Path Fork (${methodLabel}) — depth ${depth}: ${familyNodes} nodes / ${familyStates} path-states`,
    )

    // ---- census published for the smoke guard -------------------------------
    const censusNodes = supervisor.allNodes()
    PROFILE.states = actionable.length
    PROFILE.elements = els.length
    PROFILE.registered = censusNodes.length
    PROFILE.inTree = censusNodes.filter((n) => !n.destroyed && n.isInTree).length
    PROFILE.unplaced = censusNodes.filter((n) => !n.destroyed && n.state === 'unplaced').length
    PROFILE.destroyed = censusNodes.filter((n) => n.destroyed).length
    PROFILE.passes = PROFILE.compileCalls

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.emitMs + PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[derived-fork:profile] method=${method} states=${PROFILE.states} passes=${PROFILE.passes} elements=${PROFILE.elements} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `renders=${PROFILE.renderCount} ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} destroyed=${PROFILE.destroyed} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms ` +
      `unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    // the smoke guard reads the profile (per page) to assert the static census
    // + coverage + the placement baseline — see scripts/demo-smoke.mjs
    globalThis.__pathForkProfile = PROFILE
  }

  globalThis.__pathForkDone = main()
}
