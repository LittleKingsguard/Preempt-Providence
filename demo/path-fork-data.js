/**
 * Static placement-path page + data envelope module — the static re-expression
 * of the fork-stress tree (placement-path-spec §5): the SAME 22-prototype
 * binary topology compiled by the §2 path enumeration instead of runtime
 * clone-instance assembly.
 *
 * One module, three roles:
 *
 *  1. DATA (`pathForkLegacyData()`, exported): the LEGACY envelope carrying
 *     the root + TWO prototype nodes per layer 1..11 (22 prototypes, 23 graph
 *     nodes — the R2.2 sibling-shared owner-name topology, path-fork-review.md
 *     R2.2). Each prototype declares `placement: { placementName: 'zone-<k>' }`
 *     (producer — the 'container' role); layers ≥ 2 additionally declare
 *     `placement: { targetPlacement: ['zone-<k-1>'] }` (consumer — one
 *     requested name, the chosen name; BOTH level-(k−1) prototypes own the
 *     shared zone name, so the chosen name's two containers fan out the path
 *     per hop — §1.2/§2.2). NO handler bodies, NO clone-instance: the tree is
 *     compiled by the path enumeration (Σ 2^k for k=1..11 + root = 2^12 − 1 =
 *     4095 path-states pinned to 23 nodes — E2E-1 by construction).
 *
 *  2. NODE side (builder): `buildPathForkSurface()` compiles the envelope once
 *     (translate → register → compilePath per node → emitElements →
 *     diffMinimal) and returns the full surface; `pathForkServerData()` is the
 *     server reference (expected census + the hashed PAR-5 shape signature);
 *     `pathForkSsrSample()` renders the FIRST ops through the REAL
 *     SSRFragmentAdapter (PAR-5 parity sample — the full 4095-element fragment
 *     is ~190MB and is never embedded; parity is the signature). Used by
 *     scripts/path-fork-page.mjs.
 *
 *  3. PAGE (browser, guarded by `typeof document !== 'undefined'` so the
 *     builder can import the data without a DOM): CORE-ONLY imports
 *     (dist/core/*) — translate → register → ONE compilePath bootstrap →
 *     emitElements / diffMinimal / applyOps (DomAdapter) → render. NO
 *     clone-instance ops, NO after-compile expansion. The only shared helpers
 *     are the pure data-derivation `levelCss`/`cssPropForLevel` from
 *     fork-stress-fixture (demo-only, NOT core APIs).
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
import { levelCss, cssPropForLevel } from './fork-stress-fixture.js'

// ============================================================================
// DATA — the LEGACY envelope (pure data derivation, no graph construction).
// ============================================================================

/**
 * LegacyInitialData for the static placement-path page: the root plus TWO
 * prototype nodes per layer 1..11 (slot 'a' = div, slot 'b' = span).
 * Level-1 prototypes are template.root.children (family in-tree, producers
 * only — they own the shared 'zone-1' name); layers ≥ 2 are content payload
 * roots (contentNodes-owned, family-'in-tree' per the F-13 minting) carrying
 * `placementName` (producer) + `targetPlacement` (consumer — the level above's
 * shared zone name). `levelCss(layer, slot)` supplies the per-level property +
 * per-slot value css stressor (shared pure helper from fork-stress-fixture.js
 * — demo-only, NOT a core API).
 *
 * Census (placement-path-spec §5.2): 23 nodes → 4095 path-states (Σ 2^k,
 * k=1..11, + root), one per (prototype, owner-path) pair back to root.
 */
export function pathForkLegacyData() {
  const children = []
  const payload = []
  for (let k = 1; k <= 11; k += 1) {
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
    content: [{ metadata: { title: 'static placement-path prototypes' }, content: payload }],
    clientConfig: { runInstantiation: false, runMonitoring: true },
  }
}

// ============================================================================
// NODE-side surface: compile the envelope once → render ops (shared by the
// page's DomAdapter and the builder's SSRFragmentAdapter — PAR-5 parity).
// ============================================================================

/** Compile the static envelope: translate → register → ONE path-enumeration
 *  pass (compilePath per node) → emitElements → diffMinimal. */
export function buildPathForkSurface() {
  const doc = pathForkLegacyData()
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

/** Expected census + parity reference embedded in the page (server-data). */
export function pathForkServerData() {
  const s = buildPathForkSurface()
  return {
    expected: {
      nodes: 23,
      states: 4095,
      elements: 4095,
      unplaced: 0,
      cloneOps: 0,
      // per-level element counts: 2^k at level k (k = 1..11)
      perLevel: Array.from({ length: 11 }, (_, i) => 2 ** (i + 1)),
    },
    serverTreeSig: pathForkShapeSig(s.ops),
  }
}

/** Cheap SSR SAMPLE: applies only the FIRST `maxOps` ops (root element + early
 *  structure) through the SSRFragmentAdapter. The full 4095-element fragment
 *  is ~190MB (nested binary tree — O(n·depth) serialization) and is NEVER
 *  rendered for embedding; parity is the hashed shape signature. */
export function pathForkSsrSample(maxOps = 300) {
  const { ops } = buildPathForkSurface()
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
  acc('applyMs', () => applyOps(adapter, ops))
  PROFILE.renderCount = 1

  const stateByWire = new Map(actionable.map((s) => [s.pathKey, s]))
  const layerOfState = (s) => byNode.get(s.nodeId)?.props?.['stress:layer']
  // every path-state element is stored under the composite key
  // wireKey(pathKey, forkKey) = `pathKey\x00pathKey` (forkKey = pathKey) —
  // bare pathKey lookups miss (the same composite-key contract as fork arms)
  const domElOf = (pathKey) => adapter.wires.get(wireKey(pathKey, pathKey))
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
    await runner.check('node census: registered=23, in-tree=23, unplaced=0, destroyed=0, cloneOps=0', () => {
      const all = supervisor.allNodes()
      if (all.length !== 23) throw new Error(`registered: expected 23, got ${all.length}`)
      const inTree = all.filter((n) => !n.destroyed && n.isInTree)
      if (inTree.length !== 23) throw new Error(`in-tree: expected 23 (22 prototypes contentNodes-owned + root), got ${inTree.length}`)
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
    await runner.check('state census: 4095 path-states, distinct pathKeys, forkKey = pathKey on every state', () => {
      if (actionable.length !== 4095) throw new Error(`states: expected 4095, got ${actionable.length}`)
      if (new Set(actionable.map((s) => s.pathKey)).size !== 4095) throw new Error('pathKeys not distinct')
      for (const s of actionable) {
        if (s.forkKey !== s.pathKey) throw new Error(`forkKey ≠ pathKey on ${s.pathKey}`)
        if (s.pathKey !== 'root' && !s.pathKey.startsWith('root/')) throw new Error(`bad pathKey ${s.pathKey}`)
        if (s.pathKey.includes('#')) throw new Error(`arm suffix leaked into ${s.pathKey}`)
      }
    })

    // ---- element census + per-level counts ----------------------------------
    await runner.check('element census: 4095 elements, wires = pathKeys; level k has exactly 2^k elements', () => {
      if (els.length !== 4095) throw new Error(`elements: expected 4095, got ${els.length}`)
      const perLevel = {}
      for (const e of els) {
        const s = stateByWire.get(e.wire)
        if (!s) throw new Error(`element wire ${e.wire} has no path-state`)
        if (e.wire !== e.forkKey) throw new Error(`element ${e.wire}: forkKey ${e.forkKey} ≠ wire`)
        const k = layerOfState(s)
        perLevel[k] = (perLevel[k] ?? 0) + 1
      }
      for (let k = 1; k <= 11; k += 1) {
        const n = 2 ** k
        if (perLevel[k] !== n) throw new Error(`level ${k}: expected ${n} elements, got ${perLevel[k]}`)
      }
      // the DOM mirrors the element set (every path-state rendered once)
      const domLevels = {}
      for (const [, el] of adapter.wires) {
        const attr = el.getAttribute?.('stress:layer')
        if (attr) domLevels[Number(attr)] = (domLevels[Number(attr)] ?? 0) + 1
      }
      for (let k = 1; k <= 11; k += 1) {
        if (domLevels[k] !== 2 ** k) throw new Error(`DOM level ${k}: expected ${2 ** k} elements, got ${domLevels[k]}`)
      }
      if (domElOf('root') == null) throw new Error('root element missing')
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
      for (let k = 1; k <= 11; k += 1) {
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
        const nonLeaf = k === undefined || k < 11
        if (s.props?.['stress:expanded'] !== nonLeaf) {
          throw new Error(`state ${s.pathKey} (L${k}): stress:expanded ${s.props?.['stress:expanded']}, expected ${nonLeaf}`)
        }
        const el = domElOf(s.pathKey)
        if (el?.getAttribute?.('stress:expanded') !== String(nonLeaf)) {
          throw new Error(`element ${s.pathKey} (L${k}): baked stress:expanded ${el?.getAttribute?.('stress:expanded')}`)
        }
      }
    })

    // ---- treeFromOps reconstructs the binary shape --------------------------
    await runner.check('treeFromOps: one root; full binary tree (2 children per non-leaf); 2048 leaves at depth 11; 4095 nodes total', () => {
      if (trees.length !== 1 || trees[0].wire !== 'root') throw new Error(`expected a single root tree, got ${trees.length}`)
      let leaves = 0
      let total = 0
      const walk = (t, depth) => {
        total += 1
        if (t.children.length === 0) {
          leaves += 1
          if (depth !== 11) throw new Error(`leaf at depth ${depth}, expected 11`)
          return
        }
        if (t.children.length !== 2) throw new Error(`non-leaf at depth ${depth} with ${t.children.length} children`)
        for (const c of t.children) walk(c, depth + 1)
      }
      walk(trees[0], 0)
      if (total !== 4095) throw new Error(`tree total: expected 4095, got ${total}`)
      if (leaves !== 2048) throw new Error(`leaves: expected 2048, got ${leaves}`)
    })

    // ---- PAR-5 parity against the builder's SSR snapshot --------------------
    await runner.check('PAR-5: in-browser render shape ≡ server render shape (wire-agnostic signature)', () => {
      const clientSig = shapeSigOfTrees(trees)
      if (clientSig !== serverData.serverTreeSig) throw new Error('server/client shape signatures differ')
    })
    await runner.check('SSR sample present: the builder\'s SSRFragmentAdapter fragment (truncated) is embedded', () => {
      // the full 4095-element fragment is ~180MB (nested binary tree, O(n·depth)
      // serialization) — NOT embedded; parity is the shape signature above, and
      // the embedded sample proves the builder's SSR pipeline ran
      if (typeof serverData.expectedSsrSample !== 'string' || !serverData.expectedSsrSample.includes('<app')) {
        throw new Error('expected SSR sample missing from the page data')
      }
    })
    PROFILE.checksMs = now() - checksT0

    runner.summary('Path Fork (static) — 23 nodes / 4095 path-states')

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
      `[path-fork:profile] states=${PROFILE.states} passes=${PROFILE.passes} elements=${PROFILE.elements} ` +
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
