/**
 * Fork-stress DATA-DRIVEN browser page + data envelope module — converted to
 * PATH ENUMERATION (spec: docs/specs/fork-stress-data-p3.md, the 2026-09-22
 * user ruling; the reference model is docs/specs/placement-path-spec.md §2/§5
 * and the static family `demo/path-fork-data.*`).
 *
 * One module, two roles:
 *
 *  1. DATA (`forkStressLegacyData(depth, method)`, exported): the LEGACY
 *     envelope (`LegacyInitialData`) carrying the root plus TWO prototype
 *     nodes per layer 1..depth−1 (slot 'a' = div, slot 'b' = span) — the R2.2
 *     sibling-shared owner-name topology: level-1 prototypes are the root's
 *     children and own ONE shared zone name (`zone-1`); every deeper layer is a
 *     content payload root (contentNodes-owned, F-13) that owns `zone-<k>` AND
 *     requests `['zone-<k−1>']`. Both level-(k−1) prototypes own the SAME name,
 *     so first-match picks that name and its two sibling containers fan the
 *     path per hop ⇒ 2^depth − 1 path-states over 2·depth − 1 graph nodes.
 *     `method` selects the ONE mechanism the whole tree relies on, expressed as
 *     pure DATA on the prototypes:
 *       - 'placement': the placement declarations alone (the tree-shape proof);
 *       - 'values':    `component: { reference: 'values-<k>.<slot>', value:
 *                      'value-<SLOT>-<k>' }` — every path-state of a prototype
 *                      IS the provider for its own scalar source
 *                      (`seedOwnBindings` at translate time), rendered as text;
 *       - 'link':      `component: { reference: 'link-<k>', value:
 *                      <def> }` — every path-state is a def CONSUMER whose own
 *                      path-derived children are re-typed by the def at emit
 *                      time (the recursive def chain over path-states).
 *     NO `handlers`, NO `stress:handler` prop, NO `clone-instance`: the tree is
 *     compiled by the path enumeration (§3 K1/K3/K4). This export is used by
 *     scripts/fork-stress-data-page.mjs (Node) to embed the envelope.
 *
 *     What this family uniquely covers after the conversion (§3 K5): the page
 *     TRANSLATES the legacy envelope at RUNTIME and its census is a pure
 *     runtime MEASUREMENT — the builder embeds no compiled expectation
 *     (`server-data` carries `depth`/`method` + the label lists only), whereas
 *     the static family's `expected`/`serverTreeSig` are computed at build time
 *     by its builder. That is why the family survives the conversion as a
 *     mechanism swap, not a deletion.
 *
 *  2. PAGE (browser, guarded by `typeof document !== 'undefined'` so the
 *     builder can import the data without a DOM): CORE-ONLY imports
 *     (dist/core/*) — translateLegacy → Supervisor → ONE path-enumeration
 *     bootstrap (compilePath per translated node) → emitElements → diffMinimal
 *     → applyOps (DomAdapter) → the census checks. NO demo-fixtures imports,
 *     NO page-side anchor attach; the only shared helpers are the pure
 *     data-derivation `levelCss`/`cssPropForLevel`/`linkDefForLevel` from
 *     fork-stress-fixture (demo-only, NOT core APIs).
 *
 * The census is MEASURED, never assigned: `PROFILE.cloneOps` counts the
 * `clone-instance` entries in the supervisor's OWN journal through the read
 * accessor (`journalEntries`), with a window-completeness guard, and a second
 * INDEPENDENT source (the per-kind walk) is published beside it and compared
 * (§3 K6 / no-clone-invariants.md §3 I5). The pinned expectation is the PAIR
 * `cloneOps = 0` AND `registered = inTree = 2·depth − 1` (§3 K6-a/K6-e): a node
 * minted per path reads `cloneOps = 0` with `registered = 2^depth − 1`, so a
 * clone-count-only pin would miss exactly the failure the ruling names.
 *
 * Census (placement-path-spec §5.2, §3 K2): d12 = 23 nodes / 4095 path-states
 * / 4095 elements / 0 clones / 1 bootstrap pass; d14 = 27 / 16383 / 16383 / 0.
 *
 * Superseded record: docs/specs/fork-stress-data.md §"RUNTIME-variant scope
 * note" (annotated, not deleted) — the clone assembly this module used to
 * perform is retired; the contract now lives in fork-stress-data-p3.md.
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps, treeFromOps, wireKey } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner } from './lib/runner.js'
import { LAYER_METHODS, levelCss, cssPropForLevel, linkDefForLevel } from './fork-stress-fixture.js'

// ============================================================================
// THE CLONE CENSUS MEASUREMENT (docs/specs/no-clone-invariants.md §3 I5)
// ============================================================================

/**
 * The clone census is a MEASUREMENT, never a literal and never an arithmetic
 * identity: `PROFILE.cloneOps` counts the `clone-instance` entries in the
 * supervisor's OWN journal through the read accessor (`journalEntries`,
 * ENG-JOURNAL-ENTRY-READ-API — non-draining, read-only). The converted family
 * applies NO ops at all (path enumeration needs none), so the measured count is
 * 0 — and it reads 0 BECAUSE the journal is empty, not because 0 was written
 * down. An injected `clone-instance` op makes the same measurement read 1, 2, …
 * (§5 P-IM-3's falsifiability arm drives exactly that).
 *
 * The window must COVER the whole journal or the measurement must fail loudly
 * (§3 I5 / K6-c): a truncated window silently under-counting is the same defect
 * class as a literal — so this THROWS rather than publishing a number the
 * journal does not support. `limit` is clamped to [1, 1000] by the accessor, so
 * the measurement window requests the maximum and asserts its own completeness.
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
 * the other, which would make the harness's comparison `x !== x` — so a genuine
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
// THE RULED ELEMENT RELATION — `2^depth − 1` + the childless-uncovered
// def-host def-fill term (FD7-D2-LINK-CENSUS / FD7-D2-LINK-TREEFROMOPS-CHECK;
// user ruling 2026-09-23, `docs/decisions.md` DERIVED-FAMILY-SHALLOW-DEF-FILL-
// EXCEPTION).
// ============================================================================

/**
 * The family's CHILDLESS-UNCOVERED def-host def-fill term — the ONE shallow
 * exception to `elements = 2^depth − 1` (this family: `d2/link`, where the
 * census is `3 + 2·2 = 7`).
 *
 * WHY THE TERM EXISTS (mechanism, cited — never inferred):
 * `emitElements` pushes a def host's `defChildren` when the host is NOT a
 * covered-childless state (`src/core/render-helpers.ts:743-746`): a COVERED
 * childless state (one that arrived as a family parent's def-re-typed child —
 * the fork-stress link leaves) fires only the P-EMIT-3 fill, whose synthetic
 * `` `${wire}:${bind}` `` orphans would be never-attached phantoms, so they are
 * skipped; a NON-covered childless def host keeps the standalone fill. The
 * contract is `docs/specs/render.md:224` DFC-1 (the P-EMIT-3 carve-out + the
 * covered-CHILDLESS gate). At `d2/link` the two level-1 prototypes are direct
 * root children (trace length 2 ⇒ NOT covered by any family parent's chain),
 * their path-states own no children (the tree is only one hop deep) and their
 * defs carry 2 children each ⇒ `2 × 2 = 4` synthetic `<hostWire>:a|:b`
 * elements. From `d3` on the level-1 hosts own real children
 * (`(s.children ?? []).length === 2`), so the re-typing branch fires and the
 * term is 0 — as it is for `placement`/`values` at every depth (no def hosts
 * at all).
 *
 * DERIVATION (from the SAME compiled path states the page emits — never a
 * literal): a def host is a path-state whose `bindings` carry a def value
 * (`type` present); CHILDLESS is `(s.children ?? []).length === 0`; UNCOVERED
 * is `(s.trace ?? []).length === 2` (a state that landed as another host's
 * def-re-typed child carries the covering owner in its trace and is therefore
 * def-covered). The term is the sum of those hosts' `def.children.length`.
 *
 * MEASURED (2026-09-23, this family, the page's own enumeration):
 * `d2/link` → hosts `root/node-2`(2) + `root/node-3`(2) = 4;
 * `d3/link` and `d4/link` → 0 (the level-1 hosts are non-childless);
 * `d2/placement` / `d2/values` → 0 (no def bindings).
 *
 * @param {Array<object>} states the compiled path states (`compilePath().actionable`)
 * @returns {number} the extra def-fill elements beyond `2^depth − 1`
 */
export function derivedDefFillChildlessCount(states) {
  let extra = 0
  for (const s of states) {
    const def = Object.values(s.bindings ?? {}).find((v) => v && typeof v === 'object' && v.type !== undefined)
    if (!def) continue // not a def host — the fill branch cannot fire
    if ((s.children ?? []).length !== 0) continue // populated host: the re-typing branch, never the fill
    if ((s.trace ?? []).length !== 2) continue // def-covered (arrived as a re-typed child) — the gate skips the fill
    extra += Array.isArray(def.children) ? def.children.length : 0
  }
  return extra
}

// ============================================================================
// DATA — the LEGACY envelope (pure data derivation, no graph construction).
// ============================================================================

/**
 * LegacyInitialData for a fork-stress page of the given depth: the root plus
 * TWO prototype nodes per layer 1..depth−1 (slot 'a' = div, slot 'b' = span).
 * Level-1 prototypes are `template.root.children` (producers only — they own
 * the shared 'zone-1' name); layers ≥ 2 are content payload roots
 * (contentNodes-owned, family-'in-tree' per the F-13 minting) carrying
 * `placementName` (producer) AND `targetPlacement` (consumer — the level
 * above's SHARED zone name). `levelCss(layer, slot)` supplies the per-level
 * property + per-slot value css stressor (shared pure helper from
 * fork-stress-fixture.js — demo-only, NOT a core API).
 *
 * Census (placement-path-spec §5.2 / §3 K2): 2·depth−1 nodes → 2^depth − 1
 * path-states (Σ 2^k, k=1..depth−1, + root), one per (prototype, owner-path)
 * pair back to root; one emitted element per path-state; ZERO clones.
 * d12: 23 nodes / 4095; d14: 27 nodes / 16383.
 *
 * THE ELEMENT CENSUS IS THE RULED RELATION — `2^depth − 1` PLUS the
 * childless-uncovered def-host def-fill term (`derivedDefFillChildlessCount`
 * below): at `d2/link` only, the two level-1 def hosts' path-states are
 * CHILDLESS and UNCOVERED, so the standalone P-EMIT-3 def-fill branch
 * (`src/core/render-helpers.ts:743-746`) adds their def children —
 * `3 + 2·2 = 7` (contract `docs/specs/render.md:224` DFC-1; the documented
 * boundary, NOT an engine defect — `docs/decisions.md` row
 * DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION, user ruling 2026-09-23, and
 * `docs/defects.md` FD7-D2-LINK-CENSUS). The term is 0 at every other
 * (depth, method) — from d3 the level-1 hosts have real children. The term is
 * DERIVED from the compiled path states, never a literal, so a def-shape change
 * moves it instead of silently invalidating a constant (the static family's
 * `demo/path-fork-data.js` `derivedDefFillChildlessCount` is the sibling).
 *
 * `method` picks the SINGLE mechanism the whole tree relies on — expressed as
 * pure DATA on the prototypes (see the module header). NO handlers, NO
 * stress:handler residue, NO clone-instance: the derived model has no
 * after-compile expansion.
 */
export function forkStressLegacyData(depth, method) {
  const children = []
  const payload = []
  for (let layer = 1; layer <= depth - 1; layer += 1) {
    for (const slot of ['a', 'b']) {
      const proto = {
        type: slot === 'a' ? 'div' : 'span',
        props: {
          // AUTHORED ids: stable across the builder's and the page's
          // translations of the SAME legacy envelope (the PAR-5 shape
          // signature compares props; auto-minted ids would differ)
          id: `p${layer}${slot}`,
          'stress:layer': layer,
          'stress:slot': slot,
          // the .fs-node ::before badge renders `"L" attr(data-depth)` —
          // the same depth marker the imperative page's nodes carry
          'data-depth': String(layer),
        },
        css: levelCss(layer, slot),
        // P3 §1.1 two-sided placement: producer (placementName → 'container'
        // anchor) + consumer (targetPlacement → ordered 'content' anchors).
        // Level 1 owns the shared 'zone-1' name; every level ≥ 2 targets the
        // level above's single shared name (the R2.2 sibling-shared
        // owner-name topology) — first-match = that name, and the two sibling
        // containers of the chosen name fan out the path (§1.2). A distinct
        // name per sibling would collapse the tree to a single chain.
        placement: {
          placementName: `zone-${layer}`,
          ...(layer >= 2 ? { targetPlacement: [`zone-${layer - 1}`] } : {}),
        },
        // `stress:expanded` is DERIVED from the path-state's OWN (path-derived,
        // §2.3) children count — true for non-leaf path-states, false for
        // leaves (derived-state.md §9.2). `data-path` bakes the compiled
        // pathKey so every element DISPLAYS its path back to root (the
        // .fs-node ::after badge renders attr(data-path)) — pure derived data
        // with per-path-state meaning (fork-stress-data-p3 §9 Q-2: carried).
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
        // every path-state provides (and renders) its own scalar value
        proto.component = { reference: `values-${layer}.${slot}`, value: `value-${slot.toUpperCase()}-${layer}` }
      }
      if (method === 'link') {
        // every path-state provides the component DEF that re-types its
        // children — the recursive def chain over path-states
        proto.component = { reference: `link-${layer}`, value: linkDefForLevel(layer) }
      }
      if (layer === 1) children.push(proto)
      else payload.push(proto)
    }
  }
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'stress-root' },
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
    content: [{ metadata: { title: 'fork-stress prototypes' }, content: payload }],
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
  // the census is DERIVED IN THE PAGE from (depth, method) alone — the builder
  // embeds no compiled expectation for this family (§3 K5 / FD-8)
  const familyNodes = 2 * depth - 1
  const familyStates = 2 ** depth - 1
  const familyLayers = depth - 1

  // ---- profiling -----------------------------------------------------------
  // Measured sections: load (translate), compile (the ONE path-enumeration
  // bootstrap), emit/diff/apply (render), checks (the verification surface over
  // 2^depth−1 elements). coveredMs = Σ(all timed) — the harness asserts it
  // covers ~all of totalMs so "total" can never hide an untimed pipeline. The
  // converted family has NO pass-2 region and NO handler executions (the clone
  // mechanism is gone — §8.2 row 4).
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
  // Every translated node enumerates ITS OWN valid paths back to the root; the
  // artefacts are STATES/WIRES, not nodes (E2E-1: no node is created per path
  // and none per element). `passes` counts the full compiles the page ran.
  const actionable = acc('compileMs', () => {
    const out = []
    for (const n of translated.nodes) out.push(...n.compilePath().actionable)
    return out
  })
  PROFILE.compileCalls = 1
  supervisor.recordResolved(actionable)

  const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = acc('emitMs', () => emitElements(actionable, byNode))
  // THE RULED ELEMENT RELATION (see the module header + the helper above): the
  // census is `2^depth − 1` PLUS the childless-uncovered def-host def-fill term.
  // Derived from the SAME compiled path states the page emits — never a literal,
  // and never the stale `2^depth − 1`-for-every-(depth, method) formula that
  // this family's shallow checks used to carry (`docs/defects.md`
  // FORK-STRESS-DATA-SHALLOW-LINK-STALE-EXPECTATIONS).
  const fillTerm = derivedDefFillChildlessCount(actionable)
  const expectedElements = familyStates + fillTerm
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
  // wireKey(pathKey, forkKey) = `pathKey\x00pathKey` (forkKey = pathKey).
  // Re-typed def-chain children (the LINK page's covered path-states) are built
  // WITHOUT a forkKey (render-helpers `reTyped` — the adapter-key asymmetry,
  // derived-fork-variants-review §3.3/§4.4) → stored under the BARE pathKey.
  // `elOfWire` tries bare first then the composite, so the link checks must
  // NEVER use a composite-only lookup.
  const elOfWire = (pathKey) => adapter.wires.get(pathKey) ?? adapter.wires.get(wireKey(pathKey, pathKey))
  function wireOf(el) {
    return el?.getAttribute?.('data-wire') ?? el?.dataset?.wire ?? ''
  }
  function elText(el) {
    return el.textContent ?? ''
  }

  document.getElementById('layer-plan').textContent =
    'depth ' + depth + (method ? ` (single method: ${method})` : '') + '\n' +
    (serverData.layerNames ?? []).map((n, i) => `L${i + 1}  ${method ?? LAYER_METHODS[i % LAYER_METHODS.length]}  ${n}`).join('\n')

  // --------------------------------------------------------------------------
  async function main() {
    // ---- checks -----------------------------------------------------------
    // The verification surface over 2^depth−1 elements is the page's heavy
    // region (treeFromOps' forkKey-prefix edge resolution, DOM walks) — it is
    // TIMED (checksMs) so the profile covers it.
    const checksT0 = now()
    const trees = treeFromOps(ops)

    // ---- node census + the clone census MEASUREMENT (K2/K6) ----------------
    await runner.check(`node census: registered=${familyNodes}, in-tree=${familyNodes}, unplaced=0, destroyed=0, cloneOps=0`, () => {
      const all = supervisor.allNodes()
      if (all.length !== familyNodes) {
        throw new Error(`registered: expected ${familyNodes} (2·(depth−1) prototypes + root — a node minted per path would read ${familyStates}), got ${all.length}`)
      }
      const inTree = all.filter((n) => !n.destroyed && n.isInTree)
      if (inTree.length !== familyNodes) throw new Error(`in-tree: expected ${familyNodes} (${familyNodes - 1} prototypes contentNodes-owned + root), got ${inTree.length}`)
      const unplaced = all.filter((n) => !n.destroyed && n.state === 'unplaced')
      if (unplaced.length !== 0) throw new Error(`unplaced: expected 0, got ${unplaced.length}`)
      const destroyed = all.filter((n) => n.destroyed)
      if (destroyed.length !== 0) throw new Error(`destroyed: expected 0, got ${destroyed.length}`)
      if (supervisor.journal.length !== 0) throw new Error(`journal must be empty (path enumeration applies NO ops — E2E-1), got ${supervisor.journal.length}`)
      // no clone-instance ops, no placement-attach ops, no state-slices: the
      // path model mints NO clones and applies NO ops — MEASURED from the
      // journal (§3 I5 / K6-a), never assigned as a literal
      PROFILE.cloneOps = measuredCloneOps(supervisor.journalEntries({ afterIndex: 0, limit: supervisor.journal.length || 1 }))
      // the second, INDEPENDENT source: the per-kind journal walk (audit finding 5).
      // NOTE: `supervisor.journal` is read DIRECTLY in the `limit` above and in
      // the emptiness check — justified as the page's own diagnostic: it sizes a
      // read window; it is NOT the I5 census accessor (`journalEntries` is, and
      // both `measuredCloneOps` and this walk go through it).
      const kindCensus = journalKindCensus(supervisor)
      PROFILE.journalCloneOps = kindCensus.cloneInstances
      PROFILE.cloneOpKinds = kindCensus.kinds
      PROFILE.journalEntries = kindCensus.totalEntries
      // two independent sources must agree (an alias would make this vacuous)
      if (PROFILE.cloneOps !== PROFILE.journalCloneOps) {
        throw new Error(`clone census drift: the journal read counted ${PROFILE.cloneOps} clone-instance ops but the per-kind walk counted ${PROFILE.journalCloneOps} — two independent sources must agree (kinds=${JSON.stringify(PROFILE.cloneOpKinds)})`)
      }
      if (PROFILE.cloneOps !== 0) {
        throw new Error(`clone census: expected 0 (path enumeration mints NO clones — E2E-1), got ${PROFILE.cloneOps}`)
      }
    })

    // ---- state census -------------------------------------------------------
    await runner.check(`state census: ${familyStates} path-states, distinct pathKeys, forkKey = pathKey on every state`, () => {
      if (actionable.length !== familyStates) throw new Error(`states: expected ${familyStates} (2^depth − 1), got ${actionable.length}`)
      if (new Set(actionable.map((s) => s.pathKey)).size !== familyStates) throw new Error('pathKeys not distinct')
      for (const s of actionable) {
        if (s.forkKey !== s.pathKey) throw new Error(`forkKey ≠ pathKey on ${s.pathKey}`)
        if (s.pathKey !== 'root' && !s.pathKey.startsWith('root/')) throw new Error(`bad pathKey ${s.pathKey}`)
        if (s.pathKey.includes('#')) throw new Error(`arm suffix leaked into ${s.pathKey}`)
      }
    })

    // ---- element census + per-level counts ----------------------------------
    // THE EXPECTATION IS THE RULED RELATION — `2^depth − 1` PLUS the
    // childless-uncovered def-host def-fill term — never the stale
    // `2^depth − 1`-for-every-(depth, method) formula (mechanism:
    // `src/core/render-helpers.ts:743-746`; contract `docs/specs/render.md:224`
    // DFC-1; ruling: `docs/decisions.md` DERIVED-FAMILY-SHALLOW-DEF-FILL-
    // EXCEPTION + `docs/defects.md` FD7-D2-LINK-CENSUS; sibling fixes:
    // FD7-D2-LINK-TREEFROMOPS-CHECK / FORK-STRESS-DATA-SHALLOW-LINK-STALE-
    // EXPECTATIONS). The two SHAPE clauses below (a: every def-fill element must
    // be a `<hostWire>:<bind>` synthetic naming a level-1 path state; b: the
    // un-marked registered set is exactly root + the fill) are what separates
    // the documented P-EMIT-3 boundary from the numerically IDENTICAL DFC-1
    // phantom signature `2·(2^d − 1) + 1` at d2 — a bare count cannot.
    await runner.check(`element census: ${expectedElements} elements (${familyStates} path-states${fillTerm > 0 ? ` + ${fillTerm} def-fill` : ''}), wires = pathKeys; level k has exactly 2^k elements`, () => {
      if (els.length !== expectedElements) {
        throw new Error(`elements: expected ${expectedElements} (2^depth − 1 = ${familyStates}${fillTerm > 0 ? ` + the childless-uncovered def-host def-fill term ${fillTerm}` : ''}), got ${els.length}`)
      }
      const perLevel = {}
      let fillEls = 0
      for (const e of els) {
        const s = stateByWire.get(e.wire)
        if (!s) {
          // the def-fill synthetics (`<hostWire>:a`/`:b`) have no path-state —
          // legitimate ONLY where the ruled relation EXPECTS them (the derived
          // term), and only as a level-1 path-state's synthetic child. This is
          // the shape half of the discriminator (a DFC-1 phantom re-emission
          // carries a REAL path-state wire, and would fail here).
          if (fillTerm === 0) {
            throw new Error(`element wire ${e.wire} has no path-state and the ruled relation expects no def-fill (elements === 2^depth − 1 = ${familyStates})`)
          }
          const m = /^(.*):[ab]$/.exec(String(e.wire))
          const host = m ? stateByWire.get(m[1]) : undefined
          if (!host) throw new Error(`def-fill element ${e.wire} is not a <hostWire>:<bind> synthetic child of a path-state`)
          const hk = layerOfState(host)
          if (hk !== 1) throw new Error(`def-fill element ${e.wire}: host ${host.pathKey} is level ${hk}, expected the childless level-1 def hosts`)
          fillEls += 1
          // the fill children carry their HOST's stress:layer marker (the def
          // spec's own props — measured 2026-09-23), so they count at level 1
          perLevel[hk] = (perLevel[hk] ?? 0) + 1
          continue
        }
        // the link page's re-typed def-chain children carry NO forkKey (built
        // without one — the adapter-key asymmetry) — legitimately different
        // from the standalone forkKey = pathKey contract
        if (e.forkKey !== undefined && e.forkKey !== e.wire) throw new Error(`element ${e.wire}: forkKey ${e.forkKey} ≠ wire`)
        const k = layerOfState(s)
        perLevel[k] = (perLevel[k] ?? 0) + 1
      }
      // the term is a COUNT of what was emitted AND a derivation from the
      // compiled states — the two independent sources must agree (an
      // under-counted or over-counted fill fails here, not silently)
      if (fillEls !== fillTerm) {
        throw new Error(`def-fill elements emitted: ${fillEls}, the term derived from the compiled path states: ${fillTerm} — the fill and its derivation disagree`)
      }
      for (let k = 1; k <= familyLayers; k += 1) {
        // the def-fill children carry their HOST's level marker, so the level
        // that holds the childless def hosts counts its real elements PLUS the
        // fill (level 1 only at d2/link — every other level is 2^k)
        const n = 2 ** k + (k === 1 ? fillTerm : 0)
        if (perLevel[k] !== n) throw new Error(`level ${k}: expected ${n} elements, got ${perLevel[k]}`)
      }
      // the DOM mirrors the element set (every path-state rendered once) —
      // re-typed elements keep the child's OWN stress:layer attr, so the
      // per-level DOM counts hold for every method; the def-fill synthetics
      // are built from the def SPEC (no `stress:layer` — measured 2026-09-23),
      // so they are exactly the un-marked elements beyond the root
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
      if (domUnmarked !== fillTerm + 1) {
        throw new Error(`DOM un-marked elements: expected the root + ${fillTerm} def-fill synthetic(s) (no stress:layer), got ${domUnmarked}`)
      }
      if (adapter.wires.size !== expectedElements) {
        throw new Error(`DOM registered wires: expected ${expectedElements} (= the element census), got ${adapter.wires.size}`)
      }
      if (elOfWire('root') == null) throw new Error('root element missing')
    })


    // ---- prototypes are contentNodes-owned + family-in-tree (F-13) ----------
    await runner.check('prototypes are contentNodes-owned in-tree; no node is unplaced', () => {
      const unplaced = supervisor.allNodes().filter((n) => !n.destroyed && n.state === 'unplaced')
      if (unplaced.length !== 0) throw new Error(`expected 0 unplaced nodes, got ${unplaced.length}`)
      for (const p of translated.content) {
        if (p.state !== 'in-tree') throw new Error(`prototype ${p.id} expected in-tree (contentNodes owner), got ${p.state}`)
        const pa = p.childAnchor()?.link.anchorsOf('parent')[0]
        if (pa?.target !== 'contentNodes') throw new Error(`prototype ${p.id} lost its contentNodes parent anchor (${pa?.target})`)
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

    // ---- the path display ------------------------------------------------------
    // `data-path` is a DERIVED prop (`{ $: 'pathKey' }`), so the contract to
    // assert is an EQUALITY, not a segment count: a pathKey names the owner
    // chain, and the chain's length is NOT the layer (the shared placement
    // containers between levels carry their own path segments). Asserting a
    // segment count here would be an invented expectation.
    await runner.check('every element documents its depth + its path back to root (derived data-path = the state\'s own pathKey)', () => {
      for (const s of actionable) {
        const k = layerOfState(s)
        if (k === undefined) continue // the root state carries no layer marker and no data-path
        // the DERIVED contract: every path-state's resolved state carries the
        // `data-path` bake of its OWN compiled pathKey
        const baked = s.props?.['data-path']
        if (baked !== s.pathKey) {
          throw new Error(`path-state ${s.pathKey} (L${k}): derived data-path ${JSON.stringify(baked)} ≠ its own pathKey`)
        }
        if (typeof baked !== 'string' || !baked.startsWith('root')) {
          throw new Error(`path-state ${s.pathKey} (L${k}): derived data-path does not start at root (got ${JSON.stringify(baked)})`)
        }
        // the DOM attr (standalone-emitted states — link def-covered children
        // are re-typed from pass-1 props and legitimately lack it)
        const el = elOfWire(s.pathKey)
        const attr = el?.getAttribute?.('data-path') ?? null
        if (method !== 'link' && attr !== baked) {
          throw new Error(`path-state ${s.pathKey}: element data-path "${attr}" ≠ derived "${baked}"`)
        }
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
        // ELEMENT assertion scoped to standalone-emitted path-states: the link
        // page's covered path-states are RE-TYPED from pass-1 node props and
        // legitimately lack the derived bake (the runtime page's
        // method !== 'link' exemption pattern)
        if (method === 'link') continue
        const el = elOfWire(s.pathKey)
        if (el?.getAttribute?.('stress:expanded') !== String(nonLeaf)) {
          throw new Error(`element ${s.pathKey} (L${k}): baked stress:expanded ${el?.getAttribute?.('stress:expanded')}`)
        }
      }
    })

    // ---- per-method mechanism checks (the mechanism is DATA on the
    // prototypes, realised over path-states — §3 K3) ------------------------
    if (method === 'values') {
      await runner.check('values: every path-state renders its component-provided value as text (one provider, N wires)', () => {
        let checked = 0
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
          checked += 1
        }
        // anti-vacuity: the multiplicity really is exercised (2^depth − 2 non-root states)
        if (checked !== familyStates - 1) throw new Error(`checked ${checked} non-root path-states, expected ${familyStates - 1}`)
      })
    }

    if (method === 'link') {
      await runner.check('link: every path-state renders via its parent def (div type, def content for k>1); re-typed children assert the child\'s OWN node props', () => {
        for (const s of actionable) {
          const k = layerOfState(s)
          if (k === undefined) continue // the root carries no def
          const el = elOfWire(s.pathKey)
          if (!el) throw new Error(`no element for ${s.pathKey}`)
          if ((el.tagName ?? '').toLowerCase() !== 'div') {
            throw new Error(`state ${s.pathKey} (L${k}): expected div (def type), got ${el.tagName}`)
          }
          const slot = byNode.get(s.nodeId)?.props?.['stress:slot']
          // level-1 path-states are re-typed by their OWN def (no def CONTENT —
          // content lives on the re-typed children); k ≥ 2 states are re-typed
          // by the level-(k−1) parent's def and carry its content
          if (k > 1) {
            const expected = `link-${k - 1}.${slot}`
            if (!elText(el).includes(expected)) {
              throw new Error(`state ${s.pathKey} (L${k}): text "${elText(el)}" lacks def content "${expected}"`)
            }
          }
          // explicit child-prop assertions: a covered re-type keeps the CHILD's
          // OWN authored props (the def spec's props are a fallback for
          // synthetic children only) — data-depth/stress:layer are the child's
          // level, NOT the parent def's layer
          if (el.getAttribute?.('data-depth') !== String(k)) {
            throw new Error(`state ${s.pathKey} (L${k}): data-depth ${el.getAttribute?.('data-depth')} ≠ own level ${k}`)
          }
          if (el.getAttribute?.('stress:layer') !== String(k)) {
            throw new Error(`state ${s.pathKey} (L${k}): stress:layer ${el.getAttribute?.('stress:layer')} ≠ own level ${k}`)
          }
        }
        // the adapter-key asymmetry pin: exactly the covered layers' elements
        // are re-typed (no forkKey, bare-wire keys); the root + all L1 STATES
        // (3) are standalone (forkKey = pathKey). The re-typed set is
        // `familyElements − 3`, NOT `familyStates − 3`: at d2/link the two
        // level-1 states have no covered child to re-type (the stale form read
        // 0) and the 4 def-fill synthetics are the forkKey-less elements
        // (3 standalone + 4 = 7 = the ruled census — the SAME correction the
        // static page's re-typed pin received; `docs/decisions.md`
        // DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION,
        // `docs/defects.md` FD7-D2-LINK-CENSUS).
        const retyped = els.filter((e) => e.forkKey === undefined)
        const expectedRetyped = expectedElements - 3
        if (retyped.length !== expectedRetyped) {
          throw new Error(`link: expected ${expectedRetyped} re-typed def-chain elements (no forkKey), got ${retyped.length}`)
        }
      })
    }

    // ---- treeFromOps reconstructs the binary shape --------------------------
    // THE EXPECTATION IS THE RULED ELEMENT CENSUS — `2^depth − 1` PLUS the
    // childless-uncovered def-host def-fill term — never the stale
    // `2^d − 1`-for-every-(depth, method) formula (FD7-D2-LINK-CENSUS ruling,
    // 2026-09-23; `docs/decisions.md` DERIVED-FAMILY-SHALLOW-DEF-FILL-
    // EXCEPTION). Where the term is non-zero — d2/link ONLY — the 4 synthetic
    // def-fill children are `<hostWire>:a|:b` children of the two level-1 def
    // hosts (`src/core/render-helpers.ts:743-746`; contract
    // `docs/specs/render.md:224` DFC-1), so `treeFromOps` grows them UNDER
    // those hosts: the level-1 hosts STOP being leaves and the tree's leaves
    // become the 4 fills, one level below `familyLayers` (measured 2026-09-23:
    // root → 2 hosts → 2 fills each = 7 nodes, 4 leaves at depth 2). At every
    // other (depth, method) the term is 0 and this is the plain
    // full-binary-shape assertion it always was — the correction is the ruled
    // census, NOT a relaxation: the total is pinned to the census and the fill
    // arm additionally pins the deepest level to the DOCUMENTED fill WIRES, so
    // a DFC-1 phantom of the same node count (the numerically identical
    // `2·(2^d − 1) + 1` = 7) cannot satisfy this check.
    const expectedLeafDepth = familyLayers + (fillTerm > 0 ? 1 : 0)
    const expectedLeaves = fillTerm > 0 ? fillTerm : 2 ** familyLayers
    await runner.check(`treeFromOps: one root; full binary tree (2 children per non-leaf); ${expectedLeaves} leaves at depth ${expectedLeafDepth}; ${expectedElements} nodes total`, () => {
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
      if (total !== expectedElements) {
        throw new Error(`tree total: expected ${expectedElements} (the ruled element census: ${familyStates} path-states + ${fillTerm} def-fill), got ${total}`)
      }
      if (leaves !== expectedLeaves) throw new Error(`leaves: expected ${expectedLeaves}, got ${leaves}`)
      if (fillTerm > 0) {
        // the deepest level must BE the documented def-fill children, not merely
        // the right number of anonymous leaves: every `<hostWire>:a|:b`
        // synthetic, and NOT ONE a path-state wire (a phantom re-emission would
        // carry real path-state wires — the DFC-1 signature this arm separates)
        const fillWires = new Set(els.filter((e) => !stateByWire.has(e.wire)).map((e) => String(e.wire)))
        const byWire = new Map(trees.map((t) => [String(t.wire), t]))
        const collectWire = (t) => {
          byWire.set(String(t.wire), t)
          for (const c of t.children) collectWire(c)
        }
        collectWire(trees[0])
        const deepest = []
        const collect = (t, d) => {
          if (d === expectedLeafDepth) deepest.push(String(t.wire))
          for (const c of t.children) collect(c, d + 1)
        }
        collect(trees[0], 0)
        if (deepest.length !== fillWires.size || deepest.some((w) => !fillWires.has(w))) {
          throw new Error(`the depth-${expectedLeafDepth} leaves are [${deepest.join(', ')}] — expected exactly the ${fillWires.size} documented def-fill synthetics [${[...fillWires].join(', ')}]`)
        }
        // and the hosts that gained them really are the childless level-1
        // def hosts (a fill under any other state is not this boundary)
        for (const w of fillWires) {
          const hostKey = String(w).replace(/:[ab]$/, '')
          const host = stateByWire.get(hostKey)
          if (!host || layerOfState(host) !== 1) {
            throw new Error(`def-fill ${w} is not a synthetic child of a level-1 path-state (host ${hostKey})`)
          }
          const hostTree = byWire.get(hostKey)
          if (!hostTree || !hostTree.children.some((c) => String(c.wire) === String(w))) {
            throw new Error(`def-fill ${w} is not a child of its host ${hostKey} in the reconstructed tree`)
          }
        }
      }
    })

    // ---- the incremental-render contract, converted to the path model -------
    await runner.check('render contract: ONE path-enumeration bootstrap (passes = 1), no pass-2 region', () => {
      if (PROFILE.compileCalls !== 1) throw new Error(`expected 1 enumeration bootstrap, got ${PROFILE.compileCalls}`)
      if (PROFILE.renderCount !== 1) throw new Error(`expected 1 render (the bootstrap), got ${PROFILE.renderCount}`)
      if (supervisor.hasPendingWork()) throw new Error('the supervisor still has pending pass-2 work — the path model has no pass-2')
    })
    PROFILE.checksMs = now() - checksT0

    runner.summary(`Fork Stress (data${method ? `: ${method}` : ''}) — depth ${depth}`)

    // ---- census published for the smoke guard (MEASURED, never assigned) ----
    // End-of-render census over the supervisor's registry (allNodes()) and the
    // page's OWN journal. `registered`/`inTree`/`unplaced`/`destroyed` are the
    // registry measurement; `cloneOps` counts the `clone-instance` entries of
    // that same page's journal through the read accessor; `journalCloneOps` is
    // the SEPARATE per-kind walk (published as its own field, never assigned
    // from `cloneOps` — an alias would make the harness's comparison `x !== x`)
    // and the two are asserted to AGREE inside the node-census check above.
    // `states`/`elements` are the wire multiplicity (2^depth − 1) — carried by
    // the WIRES, not by the 2·depth − 1 nodes (E2E-1).
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
      `[fork-stress-data:profile] depth=${depth} method=${method ?? 'cycle'} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms ` +
      `checks=${f(PROFILE.checksMs)}ms renders=${PROFILE.renderCount} passes=${PROFILE.passes} ` +
      `states=${PROFILE.states} elements=${PROFILE.elements} ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} destroyed=${PROFILE.destroyed} cloneOps=${PROFILE.cloneOps} journalCloneOps=${PROFILE.journalCloneOps} cloneOpKinds=${JSON.stringify(PROFILE.cloneOpKinds)} journal=${PROFILE.journalEntries}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms ` +
      `unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    // the smoke guard reads the profile (per page) to assert the converted
    // census + coverage — see scripts/demo-smoke.mjs
    globalThis.__forkStressDataProfile = PROFILE
  }

  // The smoke test awaits this to know the page finished (deep pages take
  // longer than the generic settle window).
  globalThis.__forkStressDataDone = main()
}
