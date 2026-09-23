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
 * Same topology, ONE compilePath bootstrap, ZERO clone-instance ops.
 *
 * THE ELEMENT CENSUS RELATION (measured 2026-09-23, `FD7-D2-LINK-CENSUS`):
 * `elements = 2^depth − 1` for EVERY method at `depth ≥ 3` and for
 * placement/values at `depth = 2`; the ONE shallow exception is
 * **d2/link = 7 = (2^2 − 1) + 4** — the level-1 def hosts' path-states are
 * childless at d2, so the covered-CHILDLESS gate does not fire for them and
 * the standalone P-EMIT-3 def-fill pushes their synthetic def children
 * (`<wire>:a` / `<wire>:b`) into the element set:
 * `src/core/render-helpers.ts:743-746` (gate rationale: the comment block at
 * `:733-742`; contract `docs/specs/render.md:224` DFC-1). At `depth ≥ 3` those
 * two hosts have real children, the fill is bounded by the re-typed real
 * children, and the census lands exactly on `2^depth − 1`. This is the
 * DOCUMENTED boundary of the gate, NOT an engine defect — the expectation is
 * what the stale `2^depth − 1`-for-every-method formula got wrong.
 * `derivedDefFillChildlessCount(method, depth)` derives the term (see below).
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
// THE CLONE CENSUS MEASUREMENT (docs/specs/no-clone-invariants.md §3 I5)
// ============================================================================

/**
 * The clone census is a MEASUREMENT, never a literal and never an arithmetic
 * identity: `PROFILE.cloneOps` counts the `clone-instance` entries in the
 * supervisor's OWN journal through the read accessor (`journalEntries`,
 * ENG-JOURNAL-ENTRY-READ-API — non-draining, read-only). A hard-coded `0`
 * carries no evidence and cannot fail for the reason the field exists.
 *
 * The window must COVER the whole journal or the measurement must fail loudly:
 * `journalEntries` returns `truncated` + `fromIndex` + `totalEntries`, and this
 * guard accepts the accessor's own `truncated === false` OR an explicit
 * `fromIndex === 0 && entries.length === totalEntries` (the §3 I5 rule). A
 * truncated window silently under-counting is the same defect class as a
 * literal — so it THROWS rather than publishing a number the journal does not
 * support. `limit` is clamped to [1, 1000] (`supervisor.ts`), so the
 * measurement window requests the maximum and asserts its own completeness.
 *
 * @param {object} view the `JournalView` returned by `journalEntries(...)`
 * @returns {number} the number of journaled `clone-instance` ops
 */
function measuredCloneOps(view) {
  const complete = view.truncated === false || (view.fromIndex === 0 && view.entries.length === view.totalEntries)
  if (!complete) {
    throw new Error(`clone census: journal window incomplete (fromIndex=${view.fromIndex} entries=${view.entries.length} totalEntries=${view.totalEntries} truncated=${view.truncated}) — refusing to publish a silently under-counted cloneOps`)
  }
  return view.entries.filter((e) => e.kind === 'clone-instance').length
}

/**
 * The PER-KIND journal census — the census's INDEPENDENT second source
 * (2026-09-22 audit finding 5). `PROFILE.cloneOps` comes from the journal READ
 * above (`measuredCloneOps`); this walk pages the SAME read accessor through a
 * separate traversal and tallies the entries BY KIND. The two are published as
 * DISTINCT fields (`cloneOps` and `journalCloneOps`) — never one assigned from
 * the other, which would make the smoke's comparison `x !== x` — so a genuine
 * drift between the census read and the journal's per-kind tally is detectable.
 *
 * It THROWS if the paged walk does not cover the journal's own `totalEntries`:
 * a silently truncated walk would agree with a wrong first source by
 * construction.
 *
 * @param {object} sup the page's supervisor
 * @returns {{cloneInstances: number, kinds: Record<string, number>, totalEntries: number}}
 */
function journalKindCensus(sup) {
  const kinds = {}
  let totalEntries = 0
  let seen = 0
  let after = 0
  for (;;) {
    const view = sup.journalEntries({ afterIndex: after, limit: 1000 })
    totalEntries = view.totalEntries
    for (const e of view.entries) {
      kinds[e.kind] = (kinds[e.kind] ?? 0) + 1
      seen += 1
    }
    if (view.truncated === false || view.entries.length === 0 || view.fromIndex + view.entries.length >= totalEntries) break
    after = view.fromIndex + view.entries.length
  }
  if (seen !== totalEntries) {
    throw new Error(`clone census (per-kind walk): the walk covered ${seen} of ${totalEntries} journal entries — refusing to publish a second source that did not read the whole journal`)
  }
  return { cloneInstances: kinds['clone-instance'] ?? 0, kinds, totalEntries }
}

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

/** The derived family's CHILDLESS DEF-HOST def-fill term — the shallow-depth
 *  exception to the `elements = 2^depth − 1` relation (`FD7-D2-LINK-CENSUS`,
 *  ruled 2026-09-23: DOCUMENTED behaviour of the standalone P-EMIT-3 def-fill
 *  branch, NOT an engine defect).
 *
 *  DERIVATION (from the envelopes the builder itself compiles — never a magic
 *  constant): only the `link` method puts a component DEF on every prototype
 *  (`component: {reference: 'link-<k>', value: linkDefForLevel(k)}`), so only
 *  the link family has def-fill hosts at all; and the level-1 path-states are
 *  CHILDLESS only at the shallowest depth (at `depth ≥ 3` their path-derived
 *  children — the level-2 states — exist, each level-1 host emits its re-typed
 *  real children and the def-fill fires nowhere). The term is therefore
 *  `(number of def-carrying level-1 prototypes) × (their def's child count)`:
 *
 *      depth = 2 :  2 hosts × 2 def children = 4   (the only childless case)
 *      depth ≥ 3 :  0 — the level-1 hosts have real children; the gate at
 *                   `src/core/render-helpers.ts:743` fires only on the COVERED
 *                   childless leaves, which emit nothing (`:744-746` skips
 *                   them), so the census is exactly `2^depth − 1`.
 *
 *  The count is read from the SAME legacy envelope the page/builder compiles
 *  (`pathForkLegacyData`), so a change to the def shape moves this term with
 *  it instead of silently invalidating a literal.
 *
 *  @param {string} method the derived-family method ('placement' | 'values' | 'link')
 *  @param {number} depth the family depth (d2 is the one shallow case)
 *  @returns {number} the extra def-fill elements beyond `2^depth − 1`
 */
export function derivedDefFillChildlessCount(method = 'placement', depth = 12) {
  if (method !== 'link') return 0
  const doc = pathForkLegacyData(method, depth)
  const level1 = doc.template?.root?.children ?? []
  if (level1.length === 0) return 0
  let extra = 0
  for (const host of level1) {
    const def = host.component?.value
    const defChildren = Array.isArray(def?.children) ? def.children.length : 0
    // the def-fill fires ONLY on a childless host (render-helpers.ts:743); at
    // d2 the level-1 prototypes carry no path-derived children at all.
    const childless = depth === 2
    extra += childless ? defChildren : 0
  }
  return extra
}

/** Expected census + parity reference embedded in the page (server-data).
 *  Depth-parameterized (2026-08-16 — the d14 scaling probes): d12 = 23 nodes
 *  / 4095 states; d14 = 27 nodes / 16383 states. `elements` carries the
 *  d2/link def-fill term (`derivedDefFillChildlessCount` — see that helper and
 *  the module header for the ruled relation + mechanism). */
export function pathForkServerData(method = 'placement', depth = 12) {
  const s = buildPathForkSurface(method, depth)
  const states = 2 ** depth - 1
  return {
    method,
    depth,
    expected: {
      nodes: 2 * depth - 1,
      states,
      elements: states + derivedDefFillChildlessCount(method, depth),
      unplaced: 0,
      cloneOps: 0,
      // per-level element counts: 2^k at level k (k = 1..depth−1), PLUS the
      // d2/link def-fill children — synthetic `<wire>:a`/`:b` elements that
      // carry the level-1 host's own `stress:layer`, so at d2/link level 1
      // counts 2 real + 4 def-fill = 6 (see `defFillPerLevel` below)
      perLevel: Array.from({ length: depth - 1 }, (_, i) => 2 ** (i + 1)),
      defFill: derivedDefFillChildlessCount(method, depth),
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
  // THE ELEMENT CENSUS (ruled 2026-09-23 — FD7-D2-LINK-CENSUS): one element per
  // path-state, PLUS the standalone P-EMIT-3 def-fill elements of the level-1
  // def hosts whose path-states are CHILDLESS (only d2/link: +4 — the level-1
  // hosts have real children from d3 on, so the term is 0 there). The
  // mechanism: the covered-CHILDLESS gate does not fire for an UN-covered
  // childless def host, so `render-helpers.ts:744-746` pushes its def children
  // (contract `docs/specs/render.md:224` DFC-1; the gate's own rationale at
  // `src/core/render-helpers.ts:733-742`). At d2/link the measured element
  // count is 7 = 3 path-states + 4 def-fill children (one probe: level 1 counts
  // 2 real + 4 def-fill = 6 elements, levels above are unchanged).
  const familyElements = expected.elements ?? familyStates

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
    // §3 I5 — the census fields the journal measurement publishes (both are
    // (re)assigned by the node-census check below; the initialisers are the
    // pre-measurement placeholder, never the published value)
    journalCloneOps: 0, journalEntries: 0,
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
      // static model mints NO clones and applies NO ops (E2E-1) — MEASURED from
      // the journal (§3 I5), never assigned as a literal
      PROFILE.cloneOps = measuredCloneOps(supervisor.journalEntries({ afterIndex: 0, limit: supervisor.journal.length || 1 }))
      // the second, INDEPENDENT source: the per-kind journal walk (audit finding 5).
      // NOTE (H15): `supervisor.journal` is read DIRECTLY in the `limit` above and in
      // the emptiness check — justified as the page's own diagnostic: it sizes a read
      // window; it is NOT the I5 census accessor (`journalEntries` is, and both
      // `measuredCloneOps` and this walk go through it).
      const kindCensus = journalKindCensus(supervisor)
      PROFILE.journalCloneOps = kindCensus.cloneInstances
      PROFILE.cloneOpKinds = kindCensus.kinds
      PROFILE.journalEntries = kindCensus.totalEntries
      // two independent sources must agree (an alias would make this vacuous)
      if (PROFILE.cloneOps !== PROFILE.journalCloneOps) {
        throw new Error(`clone census drift: the journal read counted ${PROFILE.cloneOps} clone-instance ops but the per-kind walk counted ${PROFILE.journalCloneOps} — two independent sources must agree (kinds=${JSON.stringify(PROFILE.cloneOpKinds)})`)
      }
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
    // the expectation is the DERIVED relation (familyElements = 2^depth − 1 +
    // the childless def-host def-fill term), never the stale
    // `2^depth − 1`-for-every-(depth, method) formula — FD7-D2-LINK-CENSUS.
    await runner.check(`element census: ${familyElements} elements (${familyStates} path-states${familyElements > familyStates ? ` + ${familyElements - familyStates} def-fill` : ''}), wires = pathKeys; level k has exactly 2^k elements`, () => {
      if (els.length !== familyElements) throw new Error(`elements: expected ${familyElements}, got ${els.length}`)
      const perLevel = {}
      for (const e of els) {
        const s = stateByWire.get(e.wire)
        if (!s) {
          // the def-fill synthetic children (`<hostWire>:a`/`:b`) have no
          // path-state — legitimate ONLY where the census expects them (the
          // childless def-host def-fill, d2/link), so the count is asserted
          // against the derived term rather than skipped.
          if (familyElements === familyStates) {
            throw new Error(`element wire ${e.wire} has no path-state and the census expects none (elements === states)`)
          }
          const host = stateByWire.get(String(e.wire).replace(/:[ab]$/, ''))
          if (!host) throw new Error(`def-fill element ${e.wire} does not name a def host wire (expected <hostWire>:a|:b)`)
          const k = layerOfState(host)
          perLevel[k] = (perLevel[k] ?? 0) + 1
          continue
        }
        // the link-derived page's re-typed def-chain children carry NO forkKey
        // (built without one — the adapter-key asymmetry) — legitimately
        // different from the standalone forkKey = pathKey contract
        if (e.forkKey !== undefined && e.forkKey !== e.wire) throw new Error(`element ${e.wire}: forkKey ${e.forkKey} ≠ wire`)
        const k = layerOfState(s)
        perLevel[k] = (perLevel[k] ?? 0) + 1
      }
      const defFill = familyElements - familyStates
      for (let k = 1; k <= familyLayers; k += 1) {
        // the def-fill children carry their HOST's `stress:layer`, so the level
        // that holds the childless def hosts counts its real elements PLUS the
        // fill (only level 1 at d2/link — every other level is 2^k)
        const n = 2 ** k + (k === 1 ? defFill : 0)
        if (perLevel[k] !== n) throw new Error(`level ${k}: expected ${n} elements, got ${perLevel[k]}`)
      }
      // the DOM mirrors the element set: every element the adapter REGISTERED
      // carries its level marker EXCEPT the d2/link def-fill synthetics — the
      // standalone P-EMIT-3 def-fill emits its children with the def spec's own
      // props (a `<hostWire>:a`/`:b` synthetic wire has no graph node, hence no
      // authored `stress:layer`; measured 2026-09-23 — the def children carry
      // `link-1.a`/`link-1.b` text and no layer attr) — and the ROOT (which has
      // no level at all). So the per-level tally is the plain `2^k`, and the
      // un-marked registered elements must be exactly root + the def-fill.
      const domLevels = {}
      let domUnmarked = 0
      for (const [, el] of adapter.wires) {
        const attr = el.getAttribute?.('stress:layer')
        if (attr) domLevels[Number(attr)] = (domLevels[Number(attr)] ?? 0) + 1
        else domUnmarked += 1
      }
      for (let k = 1; k <= familyLayers; k += 1) {
        if (domLevels[k] !== 2 ** k) throw new Error(`DOM level ${k}: expected ${2 ** k} elements, got ${domLevels[k]}`)
      }
      if (domUnmarked !== defFill + 1) {
        throw new Error(`DOM un-marked elements: expected the root + ${defFill} def-fill synthetic(s) (no stress:layer), got ${domUnmarked}`)
      }
      if (adapter.wires.size !== familyElements) {
        throw new Error(`DOM registered wires: expected ${familyElements} (= the element census), got ${adapter.wires.size}`)
      }
      if (elOfWire('root') == null) throw new Error('root element missing')
    })

    // ---- the d2/link def-fill PIN (FD7-D2-LINK-CENSUS regression protection) --
    // At the ONE shallow point where the census exceeds the path-state count
    // (d2/link: 7 = 3 + 4) the extra elements are the level-1 def hosts'
    // synthetic def children pushed by the standalone P-EMIT-3 def-fill branch
    // (`src/core/render-helpers.ts:744-746`; the covered-CHILDLESS gate at
    // `:743` does not fire for an UN-covered childless host). This check pins
    // the SHAPE, not the number: every extra element must be a `<hostWire>:<bind>`
    // child of a path-state, carrying the host's level and the def's content.
    // Why it matters: the DFC-1 phantom signature for this family is
    // `2·(2^d − 1) + 1` — at d2 that is ALSO 7, so a bare count cannot tell the
    // documented boundary from a regression; this assertion can (a phantom
    // re-emission would carry a real path-state wire, not a `:bind` synthetic).
    await runner.check('d2/link def-fill pin: at d2 the link census is 7 = 3 path-states + 4 synthetic def-fill children (documented P-EMIT-3 boundary, NOT a phantom)', () => {
      const fillEls = els.filter((e) => !stateByWire.has(e.wire))
      const expectedFill = familyElements - familyStates
      if (fillEls.length !== expectedFill) {
        throw new Error(`def-fill element count ${fillEls.length} ≠ the derived term ${expectedFill} (elements=${familyElements}, path-states=${familyStates})`)
      }
      if (expectedFill > 0) {
        if (!(depth === 2 && method === 'link')) {
          throw new Error(`a def-fill term of ${expectedFill} is only documented at d2/link — got depth=${depth} method=${method} (the level-1 hosts have real children from d3 on)`)
        }
        for (const e of fillEls) {
          const m = /^(.*):([ab])$/.exec(String(e.wire))
          if (!m) throw new Error(`def-fill element ${e.wire} is not a <hostWire>:<bind> synthetic child`)
          const host = stateByWire.get(m[1])
          if (!host) throw new Error(`def-fill element ${e.wire}: host wire ${m[1]} is not a path-state`)
          if (layerOfState(host) !== 1) throw new Error(`def-fill element ${e.wire}: host is level ${layerOfState(host)}, expected the childless level-1 def hosts`)
          const hostSlot = byNode.get(host.nodeId)?.props?.['stress:slot'] ?? ''
          // read the RENDERED element (the adapter's registration), not the
          // emitted record — `emitElements` returns wire/childOrder/defChildren
          // records, so the text only exists on the DOM element the fill built.
          const fillEl = elOfWire(e.wire)
          if (fillEl == null) throw new Error(`def-fill element ${e.wire} was emitted but never registered by the adapter`)
          if (!elText(fillEl).includes(`link-1.${m[2]}`)) {
            throw new Error(`def-fill element ${e.wire}: text "${elText(fillEl)}" lacks the def content link-1.${m[2]} (host slot ${hostSlot})`)
          }
        }
      }
      // anti-vacuity: the pin must be able to fire — at d2/link it asserts a
      // non-zero term, so a "no fill elements anywhere" regression is caught by
      // the COUNT above (0 ≠ 4), never silently satisfied.
      if (depth === 2 && method === 'link' && expectedFill !== 4) {
        throw new Error(`d2/link def-fill term is ${expectedFill}, the measured relation is 4 (2 level-1 def hosts × their def's 2 children) — the builder expectation drifted`)
      }
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
        // keys); the root + L1 (3) are standalone (forkKey = pathKey). The
        // count is `states − 3` at EVERY (depth, method) — including d2/link,
        // where the re-typed set is the 4 synthetic def-fill children of the
        // two childless level-1 def hosts (3 standalone + 4 = 7 = the ruled
        // census; FD7-D2-LINK-CENSUS).
        // the re-typed set = the standalone-emitted-minus-3 (root + the two
        // level-1 hosts are standalone, `forkKey = pathKey`) PLUS the d2/link
        // def-fill synthetics (also forkKey-less). Derived: `familyElements − 3`
        // — which is `states − 3` (= 0 at d2/link, the stale formula) only when
        // the shallow term is 0.
        const expectedRetyped = familyElements - 3
        const retyped = els.filter((e) => e.forkKey === undefined)
        if (retyped.length !== expectedRetyped) {
          throw new Error(`link-derived: expected ${expectedRetyped} re-typed def-chain elements (no forkKey), got ${retyped.length}`)
        }
      })
    }

    // ---- treeFromOps reconstructs the binary shape --------------------------
    // THE EXPECTATION IS THE RULED ELEMENT CENSUS — `2^depth − 1` PLUS the
    // childless-def-host def-fill term — never the stale
    // `2^d − 1`-for-every-(depth, method) formula (FD7-D2-LINK-CENSUS, user
    // ruling 2026-09-23; `docs/decisions.md`
    // DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION). Where the term is non-zero —
    // d2/link ONLY — the 4 synthetic def-fill children are `<hostWire>:a|:b`
    // children of the two level-1 def hosts (`src/core/render-helpers.ts:743-746`;
    // contract `docs/specs/render.md:224` DFC-1), so `treeFromOps` grows them
    // UNDER those hosts: the level-1 hosts STOP being leaves and the tree's
    // leaves become the 4 fills, one level below `familyLayers`
    // (measured 2026-09-23: root → 2 hosts → 2 fills each = 7 nodes, 4 leaves at
    // depth 2). At every other (depth, method) the term is 0 and this check is
    // the plain full-binary-shape assertion it always was — the correction is
    // the ruled census, NOT a relaxation: the total is pinned to the census
    // (7 at d2/link, 3/7/4095 elsewhere) and the def-fill arm additionally pins
    // the deepest level to the DOCUMENTED fill wires, so a DFC-1 phantom of the
    // same node count (the numerically identical `2·(2^d − 1) + 1` = 7) cannot
    // satisfy this check.
    const treeDefFill = familyElements - familyStates
    const expectedLeafDepth = familyLayers + (treeDefFill > 0 ? 1 : 0)
    const expectedLeaves = treeDefFill > 0 ? treeDefFill : 2 ** familyLayers
    await runner.check(`treeFromOps: one root; full binary tree (2 children per non-leaf); ${expectedLeaves} leaves at depth ${expectedLeafDepth}; ${familyElements} nodes total`, () => {
      if (trees.length !== 1 || trees[0].wire !== 'root') throw new Error(`expected a single root tree, got ${trees.length}`)
      let leaves = 0
      let total = 0
      const walk = (t, d) => {
        total += 1
        if (t.children.length === 0) {
          leaves += 1
          if (d !== expectedLeafDepth) throw new Error(`leaf at depth ${d}, expected ${expectedLeafDepth}`)
          return
        }
        if (t.children.length !== 2) throw new Error(`non-leaf at depth ${d} with ${t.children.length} children`)
        for (const c of t.children) walk(c, d + 1)
      }
      walk(trees[0], 0)
      if (total !== familyElements) {
        throw new Error(`tree total: expected ${familyElements} (the ruled element census: ${familyStates} path-states + ${treeDefFill} def-fill), got ${total}`)
      }
      if (leaves !== expectedLeaves) throw new Error(`leaves: expected ${expectedLeaves}, got ${leaves}`)
      if (treeDefFill > 0) {
        // the deepest level must BE the documented def-fill children, not merely
        // the right number of anonymous leaves: every `<hostWire>:a|:b`
        // synthetic, and NOT ONE a path-state wire (a phantom re-emission would
        // carry real path-state wires — the DFC-1 signature this arm separates).
        const fillWires = new Set(els.filter((e) => !stateByWire.has(e.wire)).map((e) => String(e.wire)))
        const deepest = []
        const collect = (t, d) => {
          if (d === expectedLeafDepth) deepest.push(String(t.wire))
          for (const c of t.children) collect(c, d + 1)
        }
        collect(trees[0], 0)
        if (deepest.length !== fillWires.size || deepest.some((w) => !fillWires.has(w))) {
          throw new Error(`the depth-${expectedLeafDepth} leaves are [${deepest.join(', ')}] — expected exactly the ${fillWires.size} documented def-fill synthetics [${[...fillWires].join(', ')}]`)
        }
      }
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
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} destroyed=${PROFILE.destroyed} cloneOps=${PROFILE.cloneOps} journalCloneOps=${PROFILE.journalCloneOps} cloneOpKinds=${JSON.stringify(PROFILE.cloneOpKinds)} journal=${PROFILE.journalEntries}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms ` +
      `unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    // the smoke guard reads the profile (per page) to assert the static census
    // + coverage + the placement baseline — see scripts/demo-smoke.mjs
    globalThis.__pathForkProfile = PROFILE
  }

  globalThis.__pathForkDone = main()
}
