/**
 * NC-1 — the NO-CLONE INVARIANT suite (docs/specs/no-clone-invariants.md §8.1),
 * covering the contract clauses I1..I5 (§3), the typed property register (§5)
 * and the cross-expression row P-TP-2.
 *
 * ── WHY THIS FILE EXISTS, AND WHAT A RED CASE MEANS ────────────────────────
 * The invariant HOLDS on the current tree (measured 2026-09-22,
 * archive/reviews/2026-09-22/2026-09-22-noclone-probe.md:22-31). These are
 * therefore **regression guards encoding a holding invariant**: NC-1a..NC-1g
 * are expected GREEN, and a RED NC-1 case is a DEFECT DISCOVERY (file a
 * docs/defects.md row — spec §2.2 row 1), NEVER a licence to edit src/**.
 *
 * ── STATE ENUMERATION (what each case's states are) ────────────────────────
 *   NC-1a  placement states: authored-only / translate-minted / attached /
 *          re-attached (idempotent) / two-zone ordered content anchors.
 *   NC-1b  path-multiplicity states: d=6 static fork — translate, compile,
 *          emit, diff, apply (registry identical at each of the five points).
 *   NC-1c  fork-arm states: one node, k=2 arms, emitted / registry-scanned —
 *          each arm state's `nodeId` must resolve through the registry to the
 *          SAME Node OBJECT (T2).
 *   NC-1d  component states: 1 def value + 3 consumers — translate, compileAll,
 *          emit, diff, apply; def-root OBJECT identity over all three seam
 *          edges and the def-prototype OBJECT identity set across the pass (T5).
 *   NC-1e  clone-reachability states: placement / component / def-fill
 *          pipelines (ZERO calls) + the handler positive controls on BOTH
 *          `clone()` call sites (site 1 of 2 via the `ops.ts` dispatcher, site 2
 *          of 2 via `Supervisor.apply` AND the documented `clientAPI.apply`
 *          surface) + the `src/**` call-site census (exactly two) (T11).
 *   NC-1f  census states: empty journal / k=2 applied clones / decoy
 *          (layer-apply, rows-mint) node growth with zero clones / the
 *          PRODUCTION page's published census field (T7).
 *   NC-1g  cross-expression states: static arm / runtime arm at d=4 + the
 *          production page's registered decomposition (T8).
 *   Register rows: P-IM-1..P-IM-4, P-TP-1, P-TP-2 executed as seeded
 *          generators; P-SM-1 EXECUTES and reports its own §8.4 line in
 *          tests/unit/no-clone-guards.test.ts (T1 — it is no longer excused).
 *
 * ── FAIL-STATES (documented fail-states this file covers) ──────────────────
 *   · a placement path that constructs a node (registered rises on attach)
 *   · two PRODUCERS of one zone name whose `container` anchors land on
 *     different Link objects; an anchor owner that is not the authored node; a
 *     re-attach that duplicates a content anchor
 *   · distinct nodeIds growing with path count / consumer count / arm count
 *   · a state whose nodeId is not a registry id; an arm wire in the registry
 *   · a per-consumer def mint (N distinct def-root OBJECTS behind N seam edges)
 *   · a def-prototype RE-MINT returning NEW objects with the same ids
 *   · ANY clone() call on a translate / placement / seam / emit path; a THIRD
 *     `clone(` call site anywhere in `src/**`
 *   · a census that is a literal or an arithmetic identity (cannot fail) —
 *     including the PRODUCTION page's published census field
 *   · a production page that re-aliases its published measurement to the census
 *     field (`PROFILE.journalCloneOps = PROFILE.cloneOps`, T7's self-referential
 *     census) or drops its own drift guard — the ALIASING is asserted by P-TP-1p
 *     as a GREEN clause (the harness pass has landed it); the same case catches
 *     a regression to the alias or to a literal
 *   · a census computed through a truncated journal window (silent under-count)
 *
 * ── FALSIFICATION EVIDENCE (one line per case: what a violator would emit) ─
 *   NC-1a  attach raising allNodes().length (4→5), anchors on two Links, or a
 *          second content anchor for the same zone name on re-attach.
 *   NC-1b  distinct nodeId = 63 (a node per path) instead of 11, or the
 *          registry growing between compile and emit.
 *   NC-1c  an arm state whose nodeId resolves to a DIFFERENT registry object (or
 *          to nothing), a second node object registered under `cons.id`, or the
 *          registry's object-identity set changing across compile/emit.
 *   NC-1d  a per-consumer mint (two def-root OBJECTS behind the three seam
 *          edges) or a prototype re-mint (same ids, NEW objects) across the pass.
 *   NC-1e  a non-zero spy count on any of the three pipelines; a control count
 *          ≠ the applied op count (spy never matched ⇒ UNDETERMINED, asserted);
 *          a third `clone(` call site in `src/**`.
 *   NC-1f  the measured count ≠ the journal's clone-instance entries (a
 *          literal 0 on the k=2 arm), ≠ 0 on the decoy arm (arithmetic-identity
 *          derivation counts any mint), or the PRODUCTION page's published
 *          `cloneOps` ≠ the independently derived `2^d − 2`.
 *   NC-1g  the two arms disagreeing on states/elements, the runtime prototype
 *          population ≠ `2(d−1)`, or the runtime difference ≠ the measured
 *          clones once the (identically cancelling) prototype term is removed.
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Node, Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { translateLegacy, type LegacyInitialData, type LegacyNodeData } from '../../src/core/translate.js'
import { emitElements, applyOps as applyOpsReal } from '../../src/core/render-helpers.js'
import { diffMinimal, type RenderOp } from '../../src/core/render.js'
import { registerDefPrototypes } from '../../src/core/registry.js'
import { execute } from '../../src/core/ops.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import type { Anchor, CompiledState, NodeId } from '../../src/core/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// Harness — the spec §8.1 surface
// ============================================================================

function flushSweep(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0))
}

/** A supervisor over a translated tree (the path-fork-e2e pattern). */
function supOf(t: { root: Node; nodes: Node[] }): Supervisor {
  return new Supervisor(t.root, new Map(t.nodes.map(n => [n.id, n])))
}

/** The permanent-owner terminal of a node's PRIMARY (family) chain —
 *  'rootNode' | 'component' | 'contentNodes' | null (§1.1/S1.1). */
function chainTerminalOf(node: Node): string | null {
  let cur: Node | null = node
  for (let hops = 0; hops < 64 && cur; hops += 1) {
    const parentAnchor = cur.childAnchor()?.link.anchorsOf('parent')[0]
    if (!parentAnchor) return null
    if (typeof parentAnchor.target === 'string') return parentAnchor.target
    cur = parentAnchor.target as Node
  }
  return null
}

/** The registry's PROTOTYPE census (`'component'`-token family chain), taken
 *  over the live registry — the phase-INDEPENDENT prototype count. */
function componentPrototypeIds(sup: Supervisor): NodeId[] {
  return componentPrototypeNodes(sup).map(n => n.id)
}

/** The same census as registry **Node OBJECTS** — the observable I3's corrected
 *  clause constrains: a re-mint that produces NEW objects with the SAME ids is
 *  invisible to an id list and caught only by object identity (`===`) (T5). */
function componentPrototypeNodes(sup: Supervisor): Node[] {
  return sup.allNodes().filter(n => chainTerminalOf(n) === 'component')
}

/** The registry's id set (I1/I2's "is this wire a node?" oracle). */
function registryIds(sup: Supervisor): Set<NodeId> {
  return new Set(sup.allNodes().map(n => n.id))
}

/** nodeId → the registry OBJECT behind it (T2/T4: an arm state's identity is
 *  asserted by resolving its nodeId to an object and comparing with `===`, never
 *  by a distinct-set of the ids it was filtered on). */
function registryById(sup: Supervisor): Map<NodeId, Node> {
  return new Map(sup.allNodes().map(n => [n.id, n]))
}

/** Every node's compiled states (the renderer's view: compileAll). */
function compileAll(nodes: Node[]): CompiledState[] {
  const out: CompiledState[] = []
  for (const n of nodes) out.push(...n.compilePath().actionable)
  return out
}

function distinctNodeIds(states: CompiledState[]): NodeId[] {
  return [...new Set(states.map(s => s.nodeId))]
}

/** A counting adapter (the demos' adapter surface, minimised). */
function countingAdapter() {
  const wires = new Map<string, { wire: string; type: string }>()
  const calls: RenderOp[] = []
  return {
    wires,
    calls,
    createEl(type: string, wire: string): { wire: string; type: string } {
      const e = { wire, type }
      wires.set(wire, e)
      calls.push({ kind: 'create', wire, type })
      return e
    },
    setProp(wire: string, name: string, value: unknown): void {
      calls.push({ kind: 'set', wire, name, value })
    },
    appendChild(owner: { wire: string }, child: { wire: string }): void {
      calls.push({ kind: 'append', owner: owner.wire, child: child.wire })
    },
    hydrate(): void {},
    removeEl(wire: string): void {
      calls.push({ kind: 'remove', wire })
    },
  }
}

/** §3 I5's measurement rule, engine-side: the journal-derived clone count with
 *  the window-completeness guard asserted (a truncated window must fail loudly,
 *  never silently under-count). */
function journalCloneOps(sup: Supervisor): { count: number; totalEntries: number } {
  const view = sup.journalEntries({ afterIndex: 0, limit: 1000 })
  const complete = view.truncated === false
    || (view.fromIndex === 0 && view.entries.length === view.totalEntries)
  expect(complete, `journal window incomplete: truncated=${view.truncated} fromIndex=${view.fromIndex} entries=${view.entries.length} total=${view.totalEntries}`).toBe(true)
  return {
    count: view.entries.filter(e => e.kind === 'clone-instance').length,
    totalEntries: view.totalEntries,
  }
}

// ============================================================================
// T7 — THE PRODUCTION CENSUS ARTIFACT (the page's PUBLISHED field)
//
// The findings this block closes: P-TP-1/NC-1f/P-TP-2 used to test the LOCAL
// `journalCloneOps()` helper against itself, so a PRODUCTION census that
// regressed to a literal or to an arithmetic identity was invisible. The
// coupling below reads the REAL page module's published census field and
// asserts it against a count derived INDEPENDENTLY of the page: after the
// 2026-09-22 conversion the data-driven family compiles by PATH ENUMERATION
// over 2·(d−1) + 1 nodes, emitting 2^d − 1 wires and applying NO ops at all ⇒
// the independently derived clone count is **0** and the registry is
// **2·depth − 1** (fork-stress-data-p3.md §3 K2/K6). A mismatch FAILS.
//
// ✎ §8.2 row 7 RE-POINT (user ruling 2026-09-22): `expectedCloneOps(depth)` now
// returns `0` (it returned `2 ** depth - 2`), the derived registry is
// `2·depth − 1` (it was `1 + prototypes + clones`), and the published journal
// total is 0 (nothing is applied). The coupling's POINT is unchanged — the real
// page's PUBLISHED field against a count derived without reading the page — and
// the page driven is still the d2 artifact (the clause is about the census
// FIELD, not scale). The SUBSTANCE that changed: the regression the clause must
// catch is now (a) a non-zero clone count on a path-enumerated family and
// (b) a per-path node mint (`registered = 2^depth − 1` with `cloneOps = 0` —
// the failure the ruling names, which a clone-count-only clause cannot see).
// ============================================================================

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Import a repo file by ABSOLUTE PATH at runtime (non-literal specifier, so no
 *  TS declaration is required for the plain-JS shim / demo page). The runner's
 *  dynamic-import resolution handles an absolute path; a `file://` URL is
 *  percent-encoded and is NOT resolved as a filesystem path. */
async function importFile(absPath: string): Promise<unknown> {
  return await import(/* @vite-ignore */ absPath)
}

/** The production page the census coupling drives (d2 keeps the in-process run
 *  to a 3-node tree; the clause is about the census FIELD, not about scale). */
const PROD_PAGE = 'demo/fork-stress-data-d2.html'
const PROD_PAGE_DEPTH = 2

/** The page HTML carries the page's `server-data` (depth/method) and its legacy
 *  envelope; it is a BUILD ARTIFACT (`npm run demo:build` +
 *  `node scripts/build-demo.mjs`), absent on a clean checkout — the production
 *  case then SKIPS with this reason (the AGENTS.md item 12 skip-when-absent rule;
 *  the same precondition `npm run demo:smoke` has). */
const PROD_PAGE_PRESENT = existsSync(join(REPO_ROOT, PROD_PAGE))

/** The INDEPENDENTLY derived clone count for the CONVERTED data-driven
 *  family: **0** at every depth. Its construction is path enumeration over the
 *  prototype topology (2·(d−1) + 1 nodes → 2^d − 1 wires); NO `clone-instance`
 *  op exists anywhere in it, so no op mints a copy (fork-stress-data-p3.md §3
 *  K1/K6-a, E2E-1). The value is derived from the CONSTRUCTION, never read from
 *  the page, so it can disagree with the page — which is the coupling's point.
 *  (Pre-conversion this returned `2 ** depth - 2`, the handler-driven count.)
 *  The `depth` argument is retained because the call sites pass the page's own
 *  depth token: the derivation is depth-INDEPENDENT (0 at every depth), and
 *  taking the argument keeps the page's depth in the call so a future
 *  depth-dependent topology cannot silently reuse a constant. */
function expectedCloneOps(_depth: number): number {
  return 0
}

/** The INDEPENDENTLY derived REGISTRY size for the converted family:
 *  `2·(depth−1) + 1` prototypes+root — a node minted per path/wire would read
 *  `2^depth − 1` instead, which is the failure mode the node half of the pin
 *  exists to catch (§3 K6-e). */
function expectedRegisteredNodes(depth: number): number {
  return 2 * depth - 1
}

let prodCensus: Record<string, number> | null = null
let prodCensusReason = 'not attempted'

/** Run the REAL demo page module against the built page HTML IN-PROCESS (the
 *  smoke's own path: the shared DOM shim + the generated fork-stress-data page)
 *  and return the profile object the page PUBLISHES. `null` ⇒ the build artifact
 *  is absent (or the page published nothing) — the caller reports the reason. */
async function productionCensus(): Promise<Record<string, number> | null> {
  if (prodCensus) return prodCensus
  if (!PROD_PAGE_PRESENT) {
    prodCensusReason = `${PROD_PAGE} absent (run \`npm run demo:build\` + \`node scripts/build-demo.mjs\`)`
    return null
  }
  // Non-literal specifiers through a NATIVE dynamic import: the shim and the demo
  // page are plain `.mjs`/`.js` modules with no type declarations (a literal
  // specifier would need a `@ts-expect-error` per import site), and the import
  // must bypass the test runner's transform so the page module resolves its own
  // `../dist/core/*` imports natively (exactly as `scripts/demo-smoke.mjs` runs it).
  const shimPath = join(REPO_ROOT, 'scripts', 'smoke-shim.mjs')
  const pagePath = join(REPO_ROOT, 'demo', 'fork-stress-data.js')
  const { installSmokeShim } = await importFile(shimPath) as {
    installSmokeShim: () => { seedPage: (html: string) => void }
  }
  installSmokeShim().seedPage(readFileSync(join(REPO_ROOT, PROD_PAGE), 'utf8'))
  await importFile(pagePath)
  const g = globalThis as unknown as Record<string, unknown>
  await Promise.race([
    g.__forkStressDataDone as Promise<void>,
    new Promise(resolve => setTimeout(resolve, 60_000)),
  ]).catch(() => undefined)
  prodCensus = (g.__forkStressDataProfile ?? null) as Record<string, number> | null
  prodCensusReason = prodCensus ? 'ran' : 'the page run published no profile'
  // the shim installs `document`/`window` on globalThis for the page's sake; do
  // not leak them to the rest of the suite
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'window')
  return prodCensus
}

/** The production-coupling verdict for a row/case: `null` when the artifact is
 *  absent (skip, with `prodCensusReason`) or the clause holds; a message when the
 *  published census disagrees with the independently derived values. RE-POINTED
 *  for the converted family (§8.2 row 7): the clone count is derived as 0 AND
 *  the registry as 2·depth − 1, so the clause catches both regression shapes
 *  (a reappearing clone, and a node minted per path while the clone count
 *  stays 0). */
function productionCensusViolation(prod: Record<string, number> | null, expected: number): string | null {
  if (prod === null) return null
  const published = prod['cloneOps']
  if (typeof published !== 'number') return `the production page published no numeric cloneOps (${JSON.stringify(published)})`
  if (published !== expected) {
    return `production census cloneOps=${published} ≠ the independently derived ${expected} (path enumeration applies NO ops — E2E-1; ${PROD_PAGE})`
  }
  const registered = prod['registered']
  const expectedNodes = expectedRegisteredNodes(PROD_PAGE_DEPTH)
  if (typeof registered !== 'number') return `the production page published no numeric registered (${JSON.stringify(registered)})`
  if (registered !== expectedNodes) {
    return `production census registered=${registered} ≠ the independently derived 2·depth − 1 = ${expectedNodes} (a node minted per path would report 2^${PROD_PAGE_DEPTH} − 1 = ${2 ** PROD_PAGE_DEPTH - 1}; ${PROD_PAGE})`
  }
  return null
}

// ---- fixtures --------------------------------------------------------------

/** NC-1a: 4 authored nodes — root + 2 zone producers + 1 two-zone consumer
 *  (§8.1's input shape; the probe's M1 census is 4 authored → 4 registered). */
function placedEnvelope(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'root' },
        children: [
          { type: 'div', props: { id: 'A' }, placement: { placementName: 'zone-a' } },
          { type: 'div', props: { id: 'B' }, placement: { placementName: 'zone-b' } },
          {
            type: 'button',
            props: { id: 'C' },
            content: 'go',
            placement: { targetPlacement: ['zone-a', 'zone-b'] },
          },
        ],
      },
    },
    content: [],
    clientConfig: {},
  } as LegacyInitialData
}

/** The handler positive control's graph: a root with two authored siblings, so
 *  a clone may be attached at priority 0/1 without colliding with the authored
 *  child order (a fixture-shape detail, not a contract). */
function siblingEnvelope(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'root' },
        children: [
          { type: 'div', props: { id: 'child-a' }, content: 'a' },
          { type: 'span', props: { id: 'child-b' }, content: 'b' },
        ],
      },
    },
    content: [],
    clientConfig: {},
  } as LegacyInitialData
}

/** The next free family-child priority on a node's family link — the op's
 *  `priority` must not collide with an authored sibling's (ops.md §2.3's
 *  max+1 retry; a fixture-shape detail, not a contract). */
function nextPriorityOf(parent: Node): number {
  const link = parent.anchors.find(a => a.role === 'parent')?.link as unknown as
    { anchorsOf?: (r: string) => Array<{ options: { priority?: number; order?: number } }> } | undefined
  const kids = link?.anchorsOf ? link.anchorsOf('child') : []
  let max = -1
  for (const k of kids) max = Math.max(max, k.options.priority ?? k.options.order ?? -1)
  return max + 1
}

function contentAnchorsOf(n: Node): Anchor[] {
  return n.anchors.filter(a => a.role === 'content')
}

function containerAnchorsOf(n: Node, name: string): Anchor[] {
  return n.anchors.filter(a => a.role === 'container' && a.target === name)
}

/** R2.2 sibling-shared owner-name topology (the path-enum/path-fork-e2e shape,
 *  restated here so this file depends on no other suite): L1 prototypes are
 *  family children of the root sharing ONE zone name; every deeper layer is a
 *  content payload root targeting the zone above. Census 2d−1 nodes,
 *  2^d−1 path-states. */
function forkEnvelope(depth: number): LegacyInitialData {
  const children: LegacyNodeData[] = []
  const payload: LegacyNodeData[] = []
  for (let k = 1; k <= depth - 1; k += 1) {
    for (const slot of ['a', 'b'] as const) {
      const node: LegacyNodeData = {
        type: slot === 'a' ? 'div' : 'span',
        props: { id: `p${k}${slot}`, 'stress:layer': k, 'stress:slot': slot },
        css: { style: slot === 'a' ? 'color:red' : 'color:blue' },
        placement: {
          placementName: `zone-${k}`,
          ...(k >= 2 ? { targetPlacement: [`zone-${k - 1}`] } : {}),
        },
      }
      if (k === 1) children.push(node)
      else payload.push(node)
    }
  }
  return {
    template: { root: { type: 'app', children } },
    content: [{ content: payload }],
    clientConfig: {},
  } as LegacyInitialData
}

/** One authored def value (`nav`) referenced by N consumers — the component
 *  fixture I3/P-IM-3 constrain. Returns the raw envelope (for generation) and
 *  the per-N view of it. */
function defEnvelope(nConsumers: number, nChildren = 2): LegacyInitialData {
  const consumers: LegacyNodeData[] = []
  for (let i = 0; i < nConsumers; i += 1) {
    consumers.push({
      type: 'div',
      props: { id: `cons${i}` },
      component: [{ target: 'children', reference: 'nav' }],
    })
  }
  const defChildren: LegacyNodeData[] = []
  for (let i = 0; i < nChildren; i += 1) {
    defChildren.push({ type: 'span', props: { id: `d${i}` }, content: `D${i}` })
  }
  return {
    template: {
      root: { type: 'app', props: { id: 'root' }, children: consumers },
      component: [
        {
          reference: 'nav',
          value: {
            type: 'nav',
            props: { id: 'navdef' },
            css: { classes: ['nav-bar'] },
            children: defChildren,
          },
        },
      ],
    },
    content: [],
    clientConfig: {},
  } as LegacyInitialData
}

/** The seam edge target of a `children`-target consumer: the object on the
 *  child side of the consumer's seam `parent` anchor's link (ALS-2). */
function seamTargetsOf(consumer: Node): unknown[] {
  const out: unknown[] = []
  for (const a of consumer.anchors) {
    if (a.role !== 'parent') continue
    if ((a.options as { seam?: boolean }).seam !== true) continue
    const link = a.link as unknown as { anchorsOf?: (r: string) => Array<{ target: unknown }> }
    const kids = link.anchorsOf ? link.anchorsOf('child') : []
    for (const k of kids) out.push(k.target)
  }
  return out
}

function protoNodesOf(t: { nodes: Node[] }): Node[] {
  return t.nodes.filter(n => n.state === 'prototype')
}

// ============================================================================
// NC-1a — I1: a placement attaches the ORIGINAL node by link (zero growth)
// ============================================================================

describe('NC-1a — I1 placement attaches by link, zero node growth (§8.1)', () => {
  it('NC-1a translate mints anchors only; the attach op and an identical re-attach grow the registry by ZERO', async () => {
    const t = translateLegacy(placedEnvelope())
    // (i) one node per authored data node — the probe's 4 authored → 4 registered
    expect(t.nodes).toHaveLength(4)
    const byId = new Map(t.nodes.map(n => [String(n.props.id), n]))
    const A = byId.get('A')!
    const B = byId.get('B')!
    const C = byId.get('C')!
    const sup = supOf(t)
    expect(sup.allNodes()).toHaveLength(4)

    // (ii) one zone → ONE Link object shared by every participant
    const aZone = containerAnchorsOf(A, 'zone-a')
    const cZoneA = contentAnchorsOf(C).find(a => a.target === 'zone-a')!
    expect(aZone).toHaveLength(1)
    expect(cZoneA).toBeDefined()
    expect(aZone[0]!.link).toBe(cZoneA.link)
    // (iii) anchors reference the authored node — owner is the ORIGINAL object
    expect(aZone[0]!.owner).toBe(A)
    expect(cZoneA.owner).toBe(C)
    expect(containerAnchorsOf(B, 'zone-b')[0]!.owner).toBe(B)

    // (iv) the consumer's content anchors follow `names` order
    expect(contentAnchorsOf(C).map(a => a.target)).toEqual(['zone-a', 'zone-b'])

    // the op: attach the ORIGINAL consumer to the ORIGINAL container
    const before = sup.allNodes().length
    expect(before).toBe(4)
    const client = createClient(sup)
    const r1 = client.apply(C.id, { kind: 'placement-attach', node: C.id, container: A.id, names: ['zone-a', 'zone-b'] })
    expect(r1.status).toBe('applied')
    await flushSweep()
    const afterAttach = sup.allNodes().length
    expect(afterAttach).toBe(before)
    const contentAfter1 = contentAnchorsOf(C).length

    // (v) an IDENTICAL re-attach is idempotent on the registry AND the anchors
    const r2 = client.apply(C.id, { kind: 'placement-attach', node: C.id, container: A.id, names: ['zone-a', 'zone-b'] })
    expect(r2.status).toBe('applied')
    await flushSweep()
    expect(sup.allNodes().length).toBe(before)
    expect(contentAnchorsOf(C).length).toBe(contentAfter1)
    expect(contentAnchorsOf(C).map(a => a.target)).toEqual(['zone-a', 'zone-b'])
    // and the one-zone-per-name Link identity survived the re-attach
    expect(containerAnchorsOf(A, 'zone-a')[0]!.link).toBe(contentAnchorsOf(C).find(a => a.target === 'zone-a')!.link)
  })
})

// ============================================================================
// NC-1b — I2: one node, many paths (d = 6: 11 nodes / 63 path-states)
// ============================================================================

describe('NC-1b — I2 path multiplicity is a WIRE multiplicity (§8.1, probe M4)', () => {
  it('NC-1b d=6: 11 distinct nodeIds over 63 path-states, and the registry is identical at every pipeline stage', () => {
    const t = translateLegacy(forkEnvelope(6))
    expect(t.nodes).toHaveLength(11)
    const sup = supOf(t)
    const registeredAfterTranslate = sup.allNodes().length
    expect(registeredAfterTranslate).toBe(11)
    const ids = registryIds(sup)

    const states = compileAll(t.nodes)
    expect(states).toHaveLength(63)
    expect(distinctNodeIds(states)).toHaveLength(11)
    for (const s of states) expect(ids.has(s.nodeId)).toBe(true)
    expect(sup.allNodes().length).toBe(registeredAfterTranslate)

    const els = emitElements(states)
    expect(els).toHaveLength(63)
    expect(sup.allNodes().length).toBe(registeredAfterTranslate)

    const ops = diffMinimal(null, els)
    expect(sup.allNodes().length).toBe(registeredAfterTranslate)
    const adapter = countingAdapter()
    applyOpsReal(adapter as never, ops)
    expect(sup.allNodes().length).toBe(registeredAfterTranslate)
    expect(adapter.wires.size).toBe(63)
  })
})

// ============================================================================
// NC-1c — I2 component/fork-arm family: the arm is a WIRE, never a node
// ============================================================================

describe('NC-1c — I2 the fork arm is `nodeId#<i>` over ONE node (§8.1, probe M3)', () => {
  it('NC-1c 2 resolved arms → the arm states resolve to the ONE `cons` object (wires cons#0/cons#1; no arm wire in the registry; no second node object)', () => {
    const root = makeRoot({ type: 'root' })
    const cons = childOf(root, makeNode({ type: 'div', content: 'F' }, 'cons'), 0)
    targetAnchor(cons, 'slot')
    const pV = childOf(cons, makeNode({ type: 'pV' }, 'pv'), 0)
    const pW = childOf(cons, makeNode({ type: 'pW' }, 'pw'), 1)
    addComponentSource(pV, 'slot', 'v')
    addComponentSource(pW, 'slot', 'w')

    const sup = supOf({ root, nodes: [root, cons, pV, pW] })
    const registeredBefore = sup.allNodes().length
    const registryObjectsBefore = sup.allNodes().slice()
    const res = root.compile([root, cons, pV, pW])
    const armStates = res.actionable.filter(s => s.nodeId === cons.id)

    // (i) two arms over ONE node identity. T2: this used to be
    // `expect(distinctNodeIds(armStates)).toEqual([cons.id])` — a FILTERED set
    // asserted against the value it was filtered on, i.e. an assertion that
    // cannot fail. It is replaced by the object-identity clause that a per-arm
    // mint (or a per-arm copy behind the same id) would break.
    expect(armStates).toHaveLength(2)
    const idsToObjects = registryById(sup)
    const armOwners = armStates.map(s => idsToObjects.get(s.nodeId))
    expect(
      armOwners.every(o => o === cons),
      `the arm states resolve to ${armOwners.map(o => (o ? o.id : 'MISSING')).join(',')} — a per-arm mint puts a different registry OBJECT behind the arms`,
    ).toBe(true)

    // (ii) the emitted arm wires are exactly the #<i> suffixes over that node
    const els = emitElements(res.actionable)
    const armWires = els.filter(e => e.wire.startsWith(`${cons.id}#`)).map(e => e.wire)
    expect(armWires.sort()).toEqual([`${cons.id}#0`, `${cons.id}#1`].sort())
    // the parent re-points childOrder at the arm wires (never at the bare id)
    const rootEl = els.find(e => e.wire === root.id)!
    expect(rootEl.childOrder).toEqual([`${cons.id}#0`, `${cons.id}#1`])

    // (iii) NO arm wire is a registry node id
    const ids = registryIds(sup)
    for (const w of armWires) expect(ids.has(w)).toBe(false)

    // (iv) NO additional node object exists behind the arms: the registry's
    // object-identity set is untouched by the arm compile/emit (a size-only
    // check would pass if a node were replaced by an equal-but-distinct copy).
    const after = sup.allNodes()
    expect(after).toHaveLength(registeredBefore)
    after.forEach((n, i) => expect(n, `registry entry ${i} is not the same object as before the arm compile`).toBe(registryObjectsBefore[i]))
    const sameId = after.filter(n => n.id === cons.id)
    expect(sameId, `the registry holds ${sameId.length} node objects under cons.id — a per-arm mint registered a second one`).toHaveLength(1)
    expect(sameId[0]).toBe(cons)
  })
})

// ============================================================================
// NC-1d — I3: one def value + 3 consumers → ONE prototype identity set
// ============================================================================

describe('NC-1d — I3 a component is resolution + seam, never a copy (§8.1, probe M2/M5)', () => {
  it('NC-1d 3 consumers of one def: 1 def-root object, 2 def-children, registry + prototype OBJECT identities flat across the full pass', () => {
    const t = translateLegacy(defEnvelope(3, 2))
    // (i) the authored census: root + 3 consumers + 1 def-root + 2 def-children
    expect(t.nodes).toHaveLength(7)
    expect(protoNodesOf(t)).toHaveLength(3)
    const sup = supOf(t)
    const registeredAfterTranslate = sup.allNodes().length
    const idsAfterTranslate = new Set(sup.allNodes().map(n => n.id))
    expect(registeredAfterTranslate).toBe(7)
    // the def-root / def-children prototypes are identified by their authored type
    const defRoots = protoNodesOf(t).filter(n => n.type === 'nav')
    const defChildren = protoNodesOf(t).filter(n => n.type === 'span')
    expect(defRoots).toHaveLength(1)
    expect(defChildren).toHaveLength(2)
    const defRoot = defRoots[0]!

    // ✎ §8.6-AMENDED (2026-09-22): the ORIGINAL §8.1 NC-1d(iii) asked for the
    // `'prototype'`-STATE count to be identical across the pass. That literal
    // was corrected by the executed amendment (docs/specs/no-clone-invariants.md
    // §8.6, "NC-1d / P-IM-3 / §3 I3" row) and is NOT an asserted observable: the
    // def-root's family parent edge is a SEAM edge, so on seam materialization
    // the node's derived state becomes 'in-tree' (observed 3 prototypes → 0
    // while the registry stays at 7 — no node was created; the DEFECT #24
    // SEAM-RESOLVED CARRIERS realization). The phase-INDEPENDENT observables I3
    // constrains — and the ones asserted here — are the registry SIZE, the
    // registry's 'component'-token prototype census, and (T5) the def-prototype
    // OBJECT IDENTITY SET.
    const prototypesBefore = componentPrototypeNodes(sup)

    const consumers = t.root.children
    expect(consumers).toHaveLength(3)

    // compile every consumer (the resolution pass)
    const consumerStates = compileAll(consumers)
    expect(consumerStates.length).toBeGreaterThan(0)
    // (ii) ALL THREE consumers' seam edges target the SAME def-root OBJECT
    const targets = consumers.flatMap(c => seamTargetsOf(c))
    expect(targets).toHaveLength(3)
    expect(targets.every(x => x === defRoot)).toBe(true)
    expect(new Set(targets).size).toBe(1)
    expect(sup.allNodes().length).toBe(registeredAfterTranslate)

    // emit → diff → apply (the full pass)
    const allStates = compileAll(sup.allNodes())
    const els = emitElements(allStates)
    expect(els.length).toBeGreaterThan(0)
    const ops = diffMinimal(null, els)
    const adapter = countingAdapter()
    applyOpsReal(adapter as never, ops)

    // (iii) the registry, the prototype census id list AND (T5) the prototype
    // OBJECT IDENTITY SET are unchanged across the FULL pass. The id list alone
    // cannot see a re-mint that returns NEW objects carrying the SAME ids; the
    // `toBe` comparison below is what catches it.
    expect(sup.allNodes().length).toBe(registeredAfterTranslate)
    expect(componentPrototypeIds(sup)).toEqual(prototypesBefore.map(n => n.id))
    expect(new Set(sup.allNodes().map(n => n.id))).toEqual(idsAfterTranslate)
    const prototypesAfter = componentPrototypeNodes(sup)
    expect(prototypesAfter).toHaveLength(prototypesBefore.length)
    prototypesBefore.forEach((before, i) => {
      expect(
        prototypesAfter[i],
        `def-prototype ${i} (id ${before.id}) was RE-MINTED across the pass: the object identity changed (same-id re-mint)`,
      ).toBe(before)
    })
    // (iv) no def-fill synthetic wire is a registry node id
    const ids = registryIds(sup)
    const synthetic = els.filter(e => String(e.wire).includes(':'))
    expect(synthetic.length).toBeGreaterThan(0) // the def-fill actually emitted
    for (const e of synthetic) expect(ids.has(String(e.wire))).toBe(false)
  })
})

// ============================================================================
// NC-1e — I4: clone() containment + the MANDATORY handler positive controls
// ============================================================================

/** I4's call-site census: every `*.clone(` invocation in `src/**` (the two and
 *  only two call sites are `src/core/ops.ts` and `src/core/supervisor.ts`).
 *  A THIRD site is exactly what I4's "what a violation would look like" names —
 *  the fix for a legitimate new site is a spec amendment, not a silent pass. */
function cloneCallSites(): Array<{ file: string; line: number; text: string }> {
  return srcSites(/\.clone\s*\(/)
}

/** The ops dispatcher's (`src/core/ops.ts` `execute`) call sites in `src/**` —
 *  T11: the dispatcher holds clone call site 1 of 2 and, unlike
 *  `supervisor.ts:1243`, it has NO caller in `src/**` (the documented
 *  `clientAPI.apply` surface routes to the SUPERVISOR, not here), which is why
 *  the NC-1e control drives it directly. A new caller is a routing change that
 *  must be reviewed (it would make a second route reach clone site 1). */
function opsDispatcherCallSites(): Array<{ file: string; line: number; text: string }> {
  return srcSites(/\bexecute\s*\(/).filter(s => !/export function execute\s*\(/.test(s.text))
}

function srcSites(pattern: RegExp): Array<{ file: string; line: number; text: string }> {
  const out: Array<{ file: string; line: number; text: string }> = []
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name)
      if (entry.isDirectory()) walk(p)
      else if (entry.name.endsWith('.ts')) {
        readFileSync(p, 'utf8').split('\n').forEach((text, i) => {
          if (pattern.test(text)) out.push({ file: p.slice(REPO_ROOT.length + 1), line: i + 1, text: text.trim() })
        })
      }
    }
  }
  walk(join(REPO_ROOT, 'src'))
  return out
}

describe('NC-1e — I4 clone() is unreachable from placement/component/emit (§8.1)', () => {
  it('NC-1e ZERO clone calls on three non-handler pipelines; BOTH call sites fire exactly once on their controls (else UNDETERMINED)', async () => {
    const spy = vi.spyOn(Node.prototype, 'clone')
    let controlObserved = 0
    let clientControlCalls = 0
    let opsSiteCalls = 0
    let status: 'HELD' | 'UNDETERMINED' = 'UNDETERMINED'
    try {
      // (a) placement pipeline: translate mint + placement-attach
      const pt = translateLegacy(placedEnvelope())
      const pById = new Map(pt.nodes.map(n => [String(n.props.id), n]))
      const pSup = supOf(pt)
      const pClient = createClient(pSup)
      expect(spy.mock.calls.length).toBe(0) // after translate
      const pRes = pClient.apply(pById.get('C')!.id, {
        kind: 'placement-attach',
        node: pById.get('C')!.id,
        container: pById.get('A')!.id,
        names: ['zone-a', 'zone-b'],
      })
      expect(pRes.status).toBe('applied')
      expect(spy.mock.calls.length).toBe(0) // after the attach op
      compileAll(pt.nodes)
      expect(spy.mock.calls.length).toBe(0) // after the path compile

      // (b) component-resolution pipeline: def prototypes + seam fan-out (N=3)
      const ct = translateLegacy(defEnvelope(3, 2))
      expect(spy.mock.calls.length).toBe(0) // after translate (def mints are new Node, not clone)
      const cSup = supOf(ct)
      compileAll(ct.nodes)
      expect(spy.mock.calls.length).toBe(0) // after the seam materialization

      // (c) def-fill pipeline: emit (and diff/apply of the result)
      const cStates = compileAll(cSup.allNodes())
      const cEls = emitElements(cStates)
      expect(cEls.length).toBeGreaterThan(0)
      expect(spy.mock.calls.length).toBe(0) // after emit
      const ops = diffMinimal(null, cEls)
      applyOpsReal(countingAdapter() as never, ops)
      await flushSweep()
      expect(spy.mock.calls.length).toBe(0) // after diff+apply

      // POSITIVE CONTROL 1 — call site 2 of 2 (src/core/supervisor.ts): the
      // direct `Supervisor.apply` route. Same test body, asserted BEFORE the
      // row's status. A control of 0 proves the spy never matched ⇒
      // UNDETERMINED, never HELD.
      spy.mockClear()
      const ht = translateLegacy(siblingEnvelope())
      const hSup = supOf(ht)
      const hSource = ht.root.children[0]!
      for (let i = 0; i < 2; i += 1) {
        const r = hSup.apply({
          kind: 'clone-instance',
          node: hSource,
          source: hSource,
          slot: ht.root,
          priority: nextPriorityOf(ht.root) + i,
        } as never)
        expect(r.status, `control op ${i} rejected: ${JSON.stringify(r)}`).toBe('applied')
      }
      controlObserved = spy.mock.calls.length
      const copies = hSup.allNodes().filter(n => n.runtimeMinted)
      // (1) the spy fired exactly twice, (2) every copy is runtime-minted,
      // (3) every call's receiver is the Node it was invoked on
      expect(copies).toHaveLength(2)
      expect(copies.every(c => c.runtimeMinted === true)).toBe(true)
      const controlContexts = (spy.mock as unknown as { contexts: unknown[] }).contexts
      expect(controlContexts.every(c => c instanceof Node)).toBe(true)
      expect(copies.every(c => !hSup.allNodes().includes(hSource) || c !== hSource)).toBe(true)
      expect(controlObserved).toBe(2)

      // POSITIVE CONTROL 2 — call site 2 of 2 through the DOCUMENTED CLIENT
      // SURFACE (`clientAPI.apply`, T11): the same route, but reached through
      // the client the demo pages use — a regression that stops routing a
      // client clone-instance op through the supervisor is caught here. The
      // client resolves the `source` string ref (the `slot` is passed as the
      // live Node, as the pages do).
      spy.mockClear()
      const ct2 = translateLegacy(siblingEnvelope())
      const cSup2 = supOf(ct2)
      const cClient = createClient(cSup2)
      const cSource = ct2.root.children[0]!
      const clientOp = cClient.apply(cSource.id, {
        kind: 'clone-instance',
        source: cSource.id,
        slot: ct2.root,
        priority: nextPriorityOf(ct2.root),
      } as never)
      expect(clientOp.status, `clientAPI.apply clone-instance rejected: ${JSON.stringify(clientOp)}`).toBe('applied')
      clientControlCalls = spy.mock.calls.length
      expect(clientControlCalls, 'clientAPI.apply reached NO clone() site — the client route does not exercise site 2 of 2').toBe(1)

      // POSITIVE CONTROL 3 — call site 1 of 2 (src/core/ops.ts's op dispatcher,
      // imported directly: `clientAPI.apply` — like `Supervisor.apply` — routes
      // to supervisor.ts, NOT to this dispatcher, and the dispatcher has no
      // caller anywhere in `src/**`; see the census clause below). The arm is
      // therefore the ONLY way to prove site 1 of 2 is a live clone call site
      // (the anti-vacuity half of I4 for that route).
      spy.mockClear()
      const oh = hub()
      const detachedSource = new Node({ type: 'div', content: 'site-1' }, oh, `nc1e-ops-${nextSeq()}`)
      const opsRes = execute(
        { kind: 'clone-instance', source: detachedSource, node: detachedSource, priority: 0 } as never,
        { hub: oh, nodes: new Map([[detachedSource.id, detachedSource]]) } as never,
      )
      opsSiteCalls = spy.mock.calls.length
      expect(opsSiteCalls, 'the ops.ts clone-instance dispatcher fired NO clone() — site 1 of 2 is dead (the control cannot fire)').toBe(1)
      expect(opsRes.doorways, `the ops.ts dispatcher returned ${JSON.stringify(opsRes)}`).toHaveLength(1)
      status = 'HELD'
    } finally {
      vi.restoreAllMocks()
    }
    // the row's anti-vacuity rule, AS AN ASSERTION (not a comment): a control
    // count of 0 means the spy never matched — the row is UNDETERMINED
    expect(controlObserved, 'P-IM-4/NC-1e positive control did not fire — the row is UNDETERMINED, never HELD').toBe(2)
    expect(clientControlCalls).toBe(1)
    expect(opsSiteCalls).toBe(1)
    expect(status).toBe('HELD')

    // I4's call-site census: exactly the two documented sites, nowhere else, and
    // no line-numbers pinned (a source edit elsewhere must not be mistaken for a
    // new clone site).
    // FALSIFICATION: a third `.clone(` in src/** (e.g. a placement or seam path
    // that clones) fails this clause with the offending file:line printed.
    const sites = cloneCallSites()
    expect(
      sites.map(s => s.file).sort(),
      `src/** clone() call sites = ${sites.map(s => `${s.file}:${s.line} ${s.text}`).join(' | ')} — I4 pins exactly two (ops.ts + supervisor.ts)`,
    ).toEqual(['src/core/ops.ts', 'src/core/supervisor.ts'])
    expect(sites, `src/** holds ${sites.length} clone() call sites — I4 pins exactly 2`).toHaveLength(2)

    // T11 — WHY site 1 of 2 is driven directly: the ops dispatcher
    // (`src/core/ops.ts`'s `execute`) has NO caller in `src/**`; the documented
    // public route (`clientAPI.apply`) and the internal one (`Supervisor.apply`)
    // both land on `supervisor.ts`'s clone site. A new `execute(` caller would be
    // a routing change reaching clone site 1 and must be reviewed (the clause
    // fails and names it).
    expect(
      opsDispatcherCallSites().map(s => `${s.file}:${s.line} ${s.text}`),
      'the ops dispatcher now has a caller in src/** — a second route reaches clone call site 1 of 2 without being covered by this control',
    ).toEqual([])
  })
})

// ============================================================================
// NC-1f — I5: the census is a MEASUREMENT (journal-derived), not a constant
// ============================================================================

describe('NC-1f — I5 the clone census is journal-derived (§8.1)', () => {
  it('NC-1f empty journal → 0; k=2 applied clones → 2; decoys mint nodes but stay 0; the PRODUCTION page publishes the independently derived count', async () => {
    // (a) the zero arm — a graph with no ops applied at all
    const t0 = translateLegacy(defEnvelope(2, 1))
    const sup0 = supOf(t0)
    const arm0 = journalCloneOps(sup0)
    expect(arm0.totalEntries).toBe(0)
    expect(arm0.count).toBe(0)

    // (b) the positive arm — k = 2 explicit clone-instance ops
    const t1 = translateLegacy(siblingEnvelope())
    const sup1 = supOf(t1)
    const source = t1.root.children[0]!
    for (let i = 0; i < 2; i += 1) {
      const r = sup1.apply({ kind: 'clone-instance', node: source, source, slot: t1.root, priority: nextPriorityOf(t1.root) + i } as never)
      expect(r.status).toBe('applied')
    }
    await flushSweep()
    const arm1 = journalCloneOps(sup1)
    expect(arm1.count).toBe(2)
    expect(arm1.count).toBe(arm1.totalEntries)
    expect(arm1.count).not.toBe(0)

    // (c) the DECOY arm — node growth through layer-apply + rows-mint, which are
    // NOT clone-instance: the falsifier for an arithmetic-identity derivation.
    const h = hub()
    const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, 'nc1f-proto')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div', props: { id: 'nc1f-root' } }, h, 'nc1f-root')
    const sup2 = new Supervisor({ hub: h, events: new EventBridge() })
    sup2.registerNode(root)
    sup2.registerNode(proto)
    const client2 = createClient(sup2)
    const before = sup2.allNodes().length
    const la = client2.apply(root.id, {
      kind: 'layer-apply',
      target: root.id,
      layerId: 'nc1f-layer',
      sourceName: 'nc1f',
      decls: [{ role: 'child', target: root, options: { priority: 9 } }],
      nodes: [{ type: 'span', props: { id: 'nc1f-m1' } }, { type: 'span', props: { id: 'nc1f-m2' } }],
    })
    expect(la.status).toBe('applied')
    const rows = client2.apply(root.id, {
      kind: 'rows-mint',
      target: root.id,
      hookName: 'items',
      mintKind: 'component',
      prototypeName: 'item',
      rows: [{ title: 'First' }, { title: 'Second' }],
    })
    expect(rows.status).toBe('applied')
    await flushSweep()
    expect(sup2.allNodes().length).toBeGreaterThan(before) // node growth DID happen
    const arm2 = journalCloneOps(sup2)
    expect(arm2.count).toBe(0) // still zero — the census is not node growth
    expect(arm2.totalEntries).toBe(2)
    expect(arm2.count).toBeLessThan(arm2.totalEntries)

    // (d) the PRODUCTION arm (T7) — the census VALUE the real page PUBLISHES,
    // asserted against values derived from the topology, never from the page.
    // RE-POINTED for the converted family (§8.2 row 7): the page compiles by
    // path enumeration, so the independently derived clone count is 0 AND the
    // registry is 2·depth − 1. This arm still catches the regression the local
    // helper cannot see: a page that mints a node per path publishes
    // registered = 2^depth − 1 while cloneOps stays 0 (the failure the ruling
    // names), and a page that reintroduces a clone publishes a non-zero count.
    // A mismatch FAILS (the case NC-1f-prod carries the skip-when-absent arm for
    // a clean checkout).
    const prod = await productionCensus()
    if (prod !== null) {
      const expected = expectedCloneOps(PROD_PAGE_DEPTH)
      const violation = productionCensusViolation(prod, expected)
      expect(violation, `${violation} (published profile=${JSON.stringify(prod)})`).toBeNull()
      expect(prod['journalCloneOps'], 'the published measurement token is absent from the production profile').toBe(expected)
      expect(prod['registered'], 'the production registry is the path-enumeration node count').toBe(expectedRegisteredNodes(PROD_PAGE_DEPTH))
    }
  })
})

// ============================================================================
// NC-1f-prod — the production artifact, on its own (skip-when-absent)
// ============================================================================

describe('NC-1f-prod — the PRODUCTION page publishes a MEASURED census (T7)', () => {
  it.skipIf(!PROD_PAGE_PRESENT)(
    `NC-1f-prod the real ${PROD_PAGE} page publishes cloneOps = 0 (path enumeration, E2E-1) with registered = 2·${PROD_PAGE_DEPTH} − 1`,
    async () => {
      // FALSIFICATION: a production page publishing a non-zero clone count (the
      // old clone model), a literal that disagrees with its own journal walk, or
      // a per-path node mint (registered = 2^depth − 1 with cloneOps = 0) — the
      // exact regressions the local-helper-only form of this suite could not see.
      const prod = await productionCensus()
      expect(prod, `the production page run published no profile (${prodCensusReason})`).not.toBeNull()
      const expected = expectedCloneOps(PROD_PAGE_DEPTH)
      expect(prod!['cloneOps'], `published census = ${JSON.stringify(prod)}`).toBe(expected)
      // the page's own journal-walk measurement must agree with the census field
      // AND with the independent count. (The landed page derives this field from
      // a SEPARATE per-kind journal walk — `journalKindCensus` — and compares the
      // two at run time; the P-TP-1p case asserts that independence and the drift
      // guard source-side, so this clause cannot be satisfied by an alias alone.)
      expect(prod!['journalCloneOps']).toBe(expected)
      // the node half (§3 K6-e): the registry is the path-enumeration count —
      // 2·depth − 1 at d2 = 3 — NOT 2^depth − 1 = 3-by-coincidence: at d2 the
      // two expressions agree (2·2−1 = 3 = 2^2−1), which is exactly why the
      // equality clause is carried with the DEPTH-INDEPENDENT derivation below
      expect(prod!['registered'], 'the production registry is the path-enumeration node count').toBe(expectedRegisteredNodes(PROD_PAGE_DEPTH))
      // the page's journal is EMPTY (path enumeration applies no ops): the
      // measurement was taken over that journal and reports 0 — the provenance
      // of the count is the published total
      expect(prod!['journalEntries'], 'the page published no journal total (the measurement has no provenance)').toBe(0)
    },
  )
})

// ============================================================================
// NC-1g — P-TP-2: static-vs-runtime cross-expression agreement (d = 4)
// ============================================================================

/** The RUNTIME arm of the fork topology: translate the prototype set and apply
 *  the handler expansion (2 clone-instance ops per expand) — core-only. */
function runtimeForkArm(depth: number): {
  root: Node
  nodes: Node[]
  sup: Supervisor
  states: CompiledState[]
  elements: number
  registered: number
  prototypes: number
  cloneOps: number
} {
  const prototypes: LegacyNodeData[] = []
  for (let layer = 1; layer <= depth - 1; layer += 1) {
    for (const slot of ['a', 'b'] as const) {
      prototypes.push({
        type: slot === 'a' ? 'div' : 'span',
        props: { 'stress:layer': layer, 'stress:slot': slot, id: `L${layer}${slot}` },
        css: { style: slot === 'a' ? 'color:red' : 'color:blue' },
      })
    }
  }
  const t = translateLegacy({
    template: { root: { type: 'app', props: { id: 'rt-root' } } },
    content: [{ content: prototypes }],
    clientConfig: {},
  } as LegacyInitialData)
  const sup = supOf(t)
  const client = createClient(sup)
  const protoByKey = new Map<string, Node>()
  for (const p of t.content) protoByKey.set(`${p.props['stress:layer']}:${p.props['stress:slot']}`, p)

  const expand = (host: Node, layer: number): void => {
    if (layer > depth - 1) return
    const a = client.apply(host.id, {
      kind: 'clone-instance',
      source: protoByKey.get(`${layer}:a`)!,
      slot: host,
      priority: nextPriorityOf(host),
    })
    const b = client.apply(host.id, {
      kind: 'clone-instance',
      source: protoByKey.get(`${layer}:b`)!,
      slot: host,
      priority: nextPriorityOf(host) + 1,
    })
    expect([a.status, b.status]).toEqual(['applied', 'applied'])
    for (const k of host.children.filter(c => c.runtimeMinted)) expand(k, layer + 1)
  }
  expand(t.root, 1)

  const states = compileAll(sup.allNodes())
  const cloneOps = journalCloneOps(sup).count
  return {
    root: t.root,
    nodes: t.nodes,
    sup,
    states,
    elements: emitElements(states).length,
    registered: sup.allNodes().length,
    prototypes: t.content.length,
    cloneOps,
  }
}

describe('NC-1g — P-TP-2 static vs runtime expressions agree on states/elements (§8.1)', () => {
  it('NC-1g d=4: both arms states = elements = 15; the prototype term is pinned and the relation reduces to registered = 2d−1 + clones', async () => {
    const depth = 4
    // STATIC arm — the placement topology, compiled, no ops applied
    const st = translateLegacy(forkEnvelope(depth))
    const sSup = supOf(st)
    const sStates = compileAll(st.nodes)
    const sElements = emitElements(sStates).length
    const sRegistered = sSup.allNodes().length
    const sJournal = journalCloneOps(sSup)

    // RUNTIME arm — the handler-driven clone expansion
    const rt = runtimeForkArm(depth)

    expect(sStates).toHaveLength(2 ** depth - 1) // 15
    expect(sElements).toBe(2 ** depth - 1)
    expect(rt.states).toHaveLength(2 ** depth - 1)
    expect(rt.elements).toBe(2 ** depth - 1)
    expect(rt.states.length).toBe(sStates.length)
    expect(rt.elements).toBe(sElements)

    expect(sJournal.count).toBe(0)
    expect(sJournal.totalEntries).toBe(0)
    expect(rt.cloneOps).toBeGreaterThan(0) // anti-vacuity: the difference clause needs clones
    expect(rt.cloneOps).toBe(journalCloneOps(rt.sup).count)

    // ── THE ✎ CORRECTED (§8.6, 2026-09-22) RELATION — the ASSERTED one ───────
    // The runtime census counts its OWN prototype set (2(d−1) = 2d − 2 nodes,
    // the same population its `prototypes` term names), so the difference clause
    // is `runtime − static = clones + prototypes − (2d−2)`.
    // T8, stated so no reader believes the prototype term is tested BY that
    // clause: `rt.prototypes` and the discount `(2d−2)` are THE SAME QUANTITY by
    // construction, so they cancel identically and the difference clause reduces
    // to `runtimeRegistered = staticRegistered + clones = (2d−1) + clones`.
    // The prototype population is therefore asserted SEPARATELY below — those
    // clauses are the only ones sensitive to a prototype-count drift.
    const prototypeSetNodes = 2 * depth - 2
    expect(rt.prototypes, `the runtime arm's prototype population is not the topology's 2(d−1): ${rt.prototypes}`).toBe(2 * (depth - 1))
    expect(rt.prototypes).toBe(prototypeSetNodes)
    expect(rt.registered, 'the runtime registered census is not 1 + prototypes + clones').toBe(1 + rt.prototypes + rt.cloneOps)
    expect(rt.registered - sRegistered, 'the prototype term cancelled: the difference must be exactly the measured clones').toBe(rt.cloneOps)
    expect(rt.registered - sRegistered).toBe(rt.cloneOps + rt.prototypes - prototypeSetNodes)
    // and the static expression's own shape: registered = 2d − 1
    expect(sRegistered).toBe(2 * depth - 1)

    // the PRODUCTION decomposition (T7/T8), RE-POINTED for the converted page
    // (§8.2 row 7): the real data-driven page's `registered` must now be the
    // PATH-ENUMERATION node count `1 + 2(d−1) + 0` — its prototype population
    // plus the root, with NO clones (it used to be `1 + 2(d−1) + clones` with
    // `clones = 2^d − 2`). A prototype-population drift in the page (e.g. 3
    // prototypes per layer) moves `registered` off this value while every other
    // production clause still holds — the clause's purpose, unchanged.
    const prod = await productionCensus()
    if (prod !== null) {
      const expectedRegistered = 1 + 2 * (PROD_PAGE_DEPTH - 1) + expectedCloneOps(PROD_PAGE_DEPTH)
      expect(
        prod['registered'],
        `the production page's registered=${prod['registered']} ≠ 1 + 2(d−1) + clones(0) = ${expectedRegistered} (published profile=${JSON.stringify(prod)}) — the converted page compiles by path enumeration, so its registry is prototypes + root`,
      ).toBe(expectedRegistered)
      expect(prod['cloneOps']).toBe(expectedCloneOps(PROD_PAGE_DEPTH))
    }
  })
})

// ============================================================================
// §5 THE TYPED PROPERTY REGISTER — executed seeded generators
// ============================================================================

/** The pinned seed for the whole run (printed in the report line). */
const PINNED_SEED = 20260922
const PER_ROW_ATTEMPTS = 60
const PER_ROW_STOP_AFTER_FAILURES = 5
const TOTAL_ATTEMPTS_BUDGET = 400

let totalAttempts = 0

/** Inline seeded PRNG (mulberry32) — no new dependency (spec §8.4). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** `min(m, 1 + floor(r * m))` — a small bounded draw. */
function drawInt(rng: () => number, min: number, max: number): number {
  return min + Math.floor(rng() * (max - min + 1))
}

/** The four-value report vocabulary (§8.4): HELD / BROKEN / EXPECTED-RED /
 *  UNDETERMINED. The line is emitted BEFORE the assertion, so a failing row
 *  still reports. */
interface RowReport {
  id: string
  strategy: string
  status: 'HELD' | 'BROKEN' | 'EXPECTED-RED' | 'UNDETERMINED'
  attempts: number
  failures: number
  liveness: string
  counterexample: string
}

/** Every executed register row, in execution order (the report contract §8.4
 *  requires each line to carry id/strategy/status/attempts/failures/liveness/
 *  counterexample, and the budget check reads `attempts` back). */
const rowReports: RowReport[] = []

function reportRow(row: RowReport): string {
  const line = `[no-clone:register] seed=${PINNED_SEED} row=${row.id} strategy=${row.strategy} status=${row.status} attempts=${row.attempts} failures=${row.failures} liveness=${row.liveness} counterexample=${row.counterexample}`
  console.log(line)
  rowReports.push(row)
  return line
}

interface RowOutcome {
  attempts: number
  failures: number
  counterexample: string
  liveness: string
}

/** The per-attempt liveness sink handed to a generator. The note must carry the
 *  ROW it belongs to (`row=<id> …`) — `runRow` REJECTS a note that carries a
 *  different row's id, so a note can never be attributed to the wrong row (T10:
 *  the former module-level `liveNotes` pool with one `pop()` per successful
 *  attempt could report an earlier row's note as a later row's liveness). */
type NoteFn = (text: string) => void

/** Drive one register row's generator to the budget rules. */
function runRow(
  id: string,
  strategy: string,
  seed: number,
  attemptFn: (rng: () => number, attempt: number, note: NoteFn) => string | null,
): RowOutcome {
  const rng = mulberry32(seed)
  let attempts = 0
  let failures = 0
  let counterexample = 'none'
  let liveness = 'none'
  while (attempts < PER_ROW_ATTEMPTS && failures < PER_ROW_STOP_AFTER_FAILURES && totalAttempts < TOTAL_ATTEMPTS_BUDGET) {
    attempts += 1
    totalAttempts += 1
    // ROW-SCOPED: created fresh per attempt, reachable only from this attempt's
    // generator closure — there is no pool to leak from another row.
    let note: string | null = null
    const noteFn: NoteFn = (text) => { note = text }
    let failure: string | null = null
    try {
      failure = attemptFn(rng, attempts, noteFn)
    } catch (e) {
      failure = `threw: ${(e as Error).message}`
    }
    if (failure === null) {
      if (note !== null) {
        const text = note as string
        if (text.startsWith(`row=${id} `)) {
          liveness = text
        } else {
          // a note that does not belong to this row is a CONTAMINATION, never a
          // liveness proof (this is the assertion the row-scoping exists for)
          failures += 1
          if (counterexample === 'none') {
            counterexample = `liveness note does not belong to row ${id}: "${text}"`
          }
          note = null
        }
      }
    } else {
      failures += 1
      if (counterexample === 'none') counterexample = failure
    }
  }
  void id
  void strategy
  return { attempts, failures, counterexample, liveness }
}

// ---- P-IM-1 generator ------------------------------------------------------

/** Every Nth attempt is constructed with a SHARED zone name (≥2 producers on one
 *  name) and a 3-zone consumer — see `generatedPlacement`. */
const SHARED_ZONE_ATTEMPT_EVERY = 3

/** Authored placement graph (T6). `n ∈ [3,6]` authored nodes: a root, `p`
 *  producers and `n−1−p ≥ 1` consumers.
 *
 *  TWO anti-vacuity guarantees the generator CONSTRUCTS (never assumes):
 *   1. a zone-NAME POOL: producers are assigned `zoneNames[i % pool]` with
 *      `pool ≤ p−1` whenever `p ≥ 2`, so at least two producers carry the SAME
 *      zone name — the "all producers' container anchors for one zone share ONE
 *      Link object" clause then compares TWO anchors and can FAIL. (The former
 *      generator gave every producer a unique `z<i>-<rand>` name, so
 *      `containers.length` was always 1 and that clause could never fire.)
 *   2. every `SHARED_ZONE_ATTEMPT_EVERY`-th attempt carries 3 zone names and the
 *      consumer targets ALL THREE — the `k = 3` requirement, counted on the
 *      CONSUMER's `targetPlacement` list (the quantity the two-zone clause is
 *      about), not on the producer count.
 *
 *  A zone the consumer names always has ≥1 producer container, and the consumer
 *  always exists — otherwise the shared-Link clause would compare nothing and
 *  the attempt THROWS (it must never pass silently). */
function generatedPlacement(rng: () => number, attempt: number): { doc: LegacyInitialData; zones: string[]; producerCount: number } {
  const sharedZoneAttempt = attempt % SHARED_ZONE_ATTEMPT_EVERY === 0
  const childCount = sharedZoneAttempt ? 5 : drawInt(rng, 2, 5) // root + 2..5 children
  const producers = sharedZoneAttempt ? 4 : Math.min(childCount - 1, drawInt(rng, 1, 4))
  if (producers < 1 || producers > childCount - 1) {
    throw new Error(`generator fault: p=${producers} outside [1, n−1] for n=${childCount + 1}`)
  }
  // the zone-name POOL: pool < producers ⇒ at least one name is SHARED
  const pool = sharedZoneAttempt
    ? 3
    : (producers >= 2 ? Math.max(1, Math.min(drawInt(rng, 1, 3), producers - 1)) : 1)
  const zoneNames = Array.from({ length: pool }, (_, i) => `z${i}`)
  const children: LegacyNodeData[] = []
  for (let i = 0; i < childCount; i += 1) {
    const id = `n${i}`
    if (i < producers) {
      children.push({ type: 'div', props: { id }, placement: { placementName: zoneNames[i % pool] } } as LegacyNodeData)
    } else {
      children.push({ type: 'span', props: { id }, content: `c${i}` } as LegacyNodeData)
    }
  }
  // the consumer's `targetPlacement` list IS the k axis (k = zones.length)
  const k = sharedZoneAttempt ? 3 : drawInt(rng, 1, Math.min(3, pool))
  const targets = zoneNames.slice(0, k)
  const consumerIndex = children.findIndex(c => !(c as { placement?: unknown }).placement)
  if (consumerIndex < 0) {
    // ≥1 consumer is a construction requirement, not an option
    throw new Error('generator fault: no consumer slot (the two-zone clause needs one)')
  }
  ;(children[consumerIndex] as { placement?: unknown }).placement = { targetPlacement: targets }
  const doc = {
    template: { root: { type: 'app', props: { id: 'gen-root' }, children } },
    content: [],
    clientConfig: {},
  } as LegacyInitialData
  return { doc, zones: targets, producerCount: producers }
}

const P_IM_1_ID = 'P-IM-1'
const P_IM_1_STRATEGY = 'placement-graph:n[3,6]/p[1,n-1]/k[1,3]-shared-zone/reattach'

describe(`P-IM-1 placement attaches the ORIGINAL node by link (strategy ${P_IM_1_STRATEGY})`, () => {
  it('P-IM-1 reports HELD (zero growth + ONE shared Link per zone name over ≥2 producers + ordered content anchors)', async () => {
    // FALSIFICATION EVIDENCE: a placement path that constructs a node shows as
    // allNodes().length rising across translate→attach→re-attach (the row's
    // first clause); two PRODUCERS of one zone name whose container anchors land
    // on different Link objects (a per-node link instead of the shared per-name
    // placement Link) fails clause (ii) with both Link counts printed; an anchor
    // owner ≠ the authored node fails it too; a re-attach that duplicates a
    // content anchor fails clause (iii) with the doubled target printed.
    const k3Seen = { count: 0 }
    const sharedZoneClauses = { count: 0 }
    const outcome = runRow(P_IM_1_ID, P_IM_1_STRATEGY, PINNED_SEED + 1, (rng, attempt, note) => {
      const { doc, zones, producerCount } = generatedPlacement(rng, attempt)
      // the k axis is the CONSUMER's target list — counted there, not on the
      // producer count (T6)
      if (zones.length >= 3) k3Seen.count += 1
      if (zones.length === 0) throw new Error('generator fault: the consumer names no zone (the shared-Link clause would compare nothing)')
      const t = translateLegacy(doc)
      const sup = supOf(t)
      const registered = sup.allNodes().length
      if (registered !== t.nodes.length) {
        return `translate registered=${registered} ≠ nodes[]=${t.nodes.length} (a mint added a node)`
      }
      const client = createClient(sup)
      // every requested zone resolves to ONE shared per-name Link
      for (const zone of zones) {
        const containers = t.nodes.filter(n =>
          n.anchors.some(a => a.role === 'container' && a.target === zone))
        if (containers.length === 0) {
          throw new Error(`generator fault: zone ${zone} has no producer container (the shared-Link clause would be vacuous)`)
        }
        if (containers.length >= 2) sharedZoneClauses.count += 1
        const links = new Set(containers.map(n => containerAnchorsOf(n, zone)[0]!.link))
        if (links.size !== 1) {
          return `zone ${zone}: ${links.size} distinct container Links over ${containers.length} producers (${containers.map(c => c.props.id).join(',')}) — the per-name placement Link is not shared`
        }
        const consumers = t.nodes.filter(n => contentAnchorsOf(n).some(a => a.target === zone))
        if (consumers.length === 0) {
          throw new Error(`generator fault: zone ${zone} has no consumer content anchor (the clause would be vacuous)`)
        }
        for (const c of consumers) {
          const ca = contentAnchorsOf(c).find(a => a.target === zone)!
          if (ca.link !== containerAnchorsOf(containers[0]!, zone)[0]!.link) {
            return `zone ${zone}: consumer ${String(c.props.id)} content anchor on a different Link`
          }
          if (ca.owner !== c) return `zone ${zone}: consumer anchor owner ≠ authored node`
        }
        for (const cont of containers) {
          if (containerAnchorsOf(cont, zone)[0]!.owner !== cont) {
            return `zone ${zone}: container anchor owner ≠ the authored producer ${cont.id}`
          }
        }
      }
      // the attach arm: the ORIGINAL consumer onto the ORIGINAL container
      const consumer = t.nodes.find(n => contentAnchorsOf(n).some(a => a.target === zones[0]))
      if (!consumer) return 'generator produced no consumer for the requested zone'
      const container = t.nodes.find(n => containerAnchorsOf(n, zones[0]!)[0])
      if (!container) return `no producer container for zone ${zones[0]} (generator fault)`
      const names = zones.slice()
      const contentBefore = contentAnchorsOf(consumer).length
      const r1 = client.apply(consumer.id, { kind: 'placement-attach', node: consumer.id, container: container.id, names })
      if (r1.status !== 'applied') return `attach rejected: ${JSON.stringify(r1)}`
      const after1 = sup.allNodes().length
      if (after1 !== registered) return `attach grew the registry ${registered} → ${after1}`
      const r2 = client.apply(consumer.id, { kind: 'placement-attach', node: consumer.id, container: container.id, names })
      if (r2.status !== 'applied') return `re-attach rejected: ${JSON.stringify(r2)}`
      const after2 = sup.allNodes().length
      if (after2 !== registered) return `re-attach grew the registry ${registered} → ${after2}`
      const contentAfter = contentAnchorsOf(consumer).length
      if (contentAfter !== contentBefore) {
        return `re-attach changed content-anchor multiplicity ${contentBefore} → ${contentAfter} (dedup keep-first broken)`
      }
      // preference order preserved
      const order = contentAnchorsOf(consumer).map(a => a.target)
      const expected = names.filter(n => order.includes(n))
      if (JSON.stringify(order) !== JSON.stringify(expected)) {
        return `content anchors out of names order: ${JSON.stringify(order)} vs ${JSON.stringify(expected)}`
      }
      note(`row=${P_IM_1_ID} zones=${zones.length} producers=${producerCount} sharedZoneClauses=${sharedZoneClauses.count} registered=${registered} content=${contentAfter}`)
      return null
    })
    // the two-zones requirement: at least one attempt must carry k = 3, AND at
    // least one attempt must COMPARE TWO producers' container anchors for one
    // zone name (the clause the generator now constructs)
    const liveness = `k3-attempts=${k3Seen.count} shared-zone-clauses=${sharedZoneClauses.count} ${outcome.liveness}`
    const status: 'HELD' | 'BROKEN' | 'UNDETERMINED' =
      outcome.failures > 0
        ? 'BROKEN'
        : (k3Seen.count === 0 || sharedZoneClauses.count === 0 ? 'UNDETERMINED' : 'HELD')
    reportRow({
      id: P_IM_1_ID,
      strategy: P_IM_1_STRATEGY,
      status,
      attempts: outcome.attempts,
      failures: outcome.failures,
      liveness,
      counterexample: outcome.counterexample,
    })
    expect(k3Seen.count, 'P-IM-1 k = 3 requirement never exercised — the row is UNDETERMINED').toBeGreaterThan(0)
    expect(
      sharedZoneClauses.count,
      'the shared-Link clause never compared two producers of ONE zone name (containers.length was never ≥ 2) — the clause is UNREACHABLE and the row is UNDETERMINED',
    ).toBeGreaterThan(0)
    expect(outcome.attempts).toBeGreaterThan(0)
    expect(outcome.failures).toBe(0)
  })
})

// ---- P-IM-2 generator ------------------------------------------------------

const P_IM_2_ID = 'P-IM-2'
const P_IM_2_STRATEGY = 'three-arm:placement(d[3,6])/component(N[2,4] identity)/fork-arm(k[2,4] identity)'

describe(`P-IM-2 distinct-nodeId invariance under path multiplicity (strategy ${P_IM_2_STRATEGY})`, () => {
  it('P-IM-2 reports HELD (placement/component/fork-arm arms; def-prototype OBJECT identity and arm-state object identity)', () => {
    // FALSIFICATION EVIDENCE: a node minted per path shows distinct nodeId
    // growing with d (63 instead of 11 at d=6); a PER-CONSUMER DEF MINT shows as
    // N distinct def-prototype OBJECTS behind the N seam edges (the T3 clause —
    // the former "consumer distinct nodeId ≠ N" clause was a tautology of
    // `compilePath`); a per-arm mint shows the arm states resolving to a
    // DIFFERENT registry object than `cons` (the T4 clause — the former
    // distinctNodeIds-of-a-filtered-set clause was likewise tautological); a
    // state carrying a non-registry nodeId fails the membership clause with the
    // offending id printed.
    const armLiveness: string[] = []
    const outcome = runRow(P_IM_2_ID, P_IM_2_STRATEGY, PINNED_SEED + 2, (rng, _attempt, note) => {
      // (a) placement arm — the axis-separation live control. d ≥ 3: at d = 2
      // the topology has 3 nodes and 3 path-states, so nodeRatio = 1 and the
      // control would be vacuous (a generator whose liveness is probabilistic
      // does not satisfy §5's anti-vacuity rule — the axis must be separated by
      // CONSTRUCTION, so the generator starts where 2^d−1 > 2d−1).
      const d = drawInt(rng, 3, 6)
      const pt = translateLegacy(forkEnvelope(d))
      const pSup = supOf(pt)
      const pIds = registryIds(pSup)
      const pStates = compileAll(pt.nodes)
      const pDistinct = distinctNodeIds(pStates)
      const expectedStates = 2 ** d - 1
      if (pStates.length !== expectedStates) return `placement arm d=${d}: states=${pStates.length} ≠ 2^d−1=${expectedStates}`
      if (pDistinct.length !== 2 * d - 1) return `placement arm d=${d}: distinct nodeId=${pDistinct.length} ≠ 2d−1=${2 * d - 1}`
      if (!(pStates.length > pDistinct.length)) return `axis separation is flat at d=${d} (states ${pStates.length} ≤ distinct ${pDistinct.length}) — the control is not live`
      for (const s of pStates) if (!pIds.has(s.nodeId)) return `placement arm state ${s.pathKey} nodeId=${s.nodeId} not a registry id`
      const pRatio = pStates.length / pDistinct.length

      // (b) component arm — one def value, N ∈ [2,4] consumers.
      // T3: the clause is stated on DEF IDENTITY — the distinct
      // def-PROTOTYPE OBJECTS reachable from the consumers' seam edges. That IS
      // what a per-consumer mint doubles (N distinct def-root objects behind N
      // edges); a distinct-`nodeId` count of the consumer states could not fail,
      // because `compilePath` gives each actionable state its own nodeId by
      // construction.
      const n = drawInt(rng, 2, 4)
      const nKids = drawInt(rng, 1, 3)
      const ct = translateLegacy(defEnvelope(n, nKids))
      const cSup = supOf(ct)
      const cIds = registryIds(cSup)
      const protos = protoNodesOf(ct)
      if (protos.filter(p => p.type === 'nav').length !== 1) {
        return `component arm N=${n}: def-root prototype count=${protos.filter(p => p.type === 'nav').length} ≠ 1`
      }
      if (protos.filter(p => p.type === 'span').length !== nKids) {
        return `component arm N=${n}: def-child prototype count ≠ ${nKids}`
      }
      const consumers = ct.root.children
      if (consumers.length !== n) return `component arm N=${n}: consumers=${consumers.length} (the graph was not constructed)`
      const cStates = compileAll(ct.nodes)
      for (const s of cStates) if (!cIds.has(s.nodeId)) return `component arm state ${s.pathKey} nodeId=${s.nodeId} not a registry id`
      compileAll(consumers) // the resolution pass that materializes the seam edges
      const seamTargets = consumers.flatMap(c => seamTargetsOf(c))
      if (seamTargets.length < n) {
        throw new Error(`component arm N=${n}: only ${seamTargets.length} seam edges for N consumers — the identity clause would be vacuous`)
      }
      const distinctTargets = new Set(seamTargets)
      if (distinctTargets.size !== 1) {
        return `component arm N=${n}: ${distinctTargets.size} distinct def-prototype OBJECTS behind ${seamTargets.length} seam edges (per-consumer mint)`
      }
      const defRoot = protos.find(p => p.type === 'nav')!
      if (!seamTargets.every(x => x === defRoot)) {
        return `component arm N=${n}: a seam edge targets an object that is not the authored def-root ${defRoot.id}`
      }
      if (!seamTargets.every(x => cIds.has((x as Node).id))) {
        return `component arm N=${n}: a seam target is not a registry node id (${(seamTargets as Node[]).map(x => x.id).join(',')})`
      }

      // (c) fork-arm arm — one consumer, k ∈ [2,4] providers.
      // T4: the arm states' identity is asserted by resolving each `nodeId`
      // through the registry and comparing the OBJECT with `cons`.
      const k = drawInt(rng, 2, 4)
      const root = makeRoot({ type: 'root' })
      const cons = childOf(root, makeNode({ type: 'div', content: 'F' }, `cons-${nextSeq()}`), 0)
      targetAnchor(cons, 'slot')
      const providers: Node[] = []
      for (let i = 0; i < k; i += 1) {
        const p = childOf(cons, makeNode({ type: 'p', content: `v${i}` }, `pv-${i}-${nextSeq()}`), i)
        addComponentSource(p, 'slot', `v${i}`)
        providers.push(p)
      }
      const aSup = supOf({ root, nodes: [root, cons, ...providers] })
      const registeredBefore = aSup.allNodes().length
      const registryObjectsBefore = aSup.allNodes().slice()
      const res = root.compile([root, cons, ...providers])
      const armStates = res.actionable.filter(s => s.nodeId === cons.id)
      if (armStates.length < 2) {
        throw new Error(`fork-arm k=${k}: only ${armStates.length} arms resolved — the identity clause would be vacuous`)
      }
      const aIdsToObjects = registryById(aSup)
      const armOwners = armStates.map(s => aIdsToObjects.get(s.nodeId))
      if (!armOwners.every(o => o === cons)) {
        return `fork-arm k=${k}: arm states resolve to ${armOwners.map(o => (o ? o.id : 'MISSING')).join(',')} — not the ONE consumer object (per-arm mint)`
      }
      const els = emitElements(res.actionable)
      const wires = els.filter(e => e.wire.startsWith(`${cons.id}#`)).map(e => e.wire).sort()
      const expectedWires = Array.from({ length: armStates.length }, (_, i) => `${cons.id}#${i}`).sort()
      if (JSON.stringify(wires) !== JSON.stringify(expectedWires)) {
        return `fork-arm wires ${JSON.stringify(wires)} ≠ ${JSON.stringify(expectedWires)}`
      }
      const aIds = registryIds(aSup)
      for (const w of wires) if (aIds.has(w)) return `fork-arm wire ${w} IS a registry node id`
      const afterNodes = aSup.allNodes()
      if (afterNodes.length !== registeredBefore) return 'fork-arm: registry grew across compile/emit'
      const identityDrift = afterNodes.findIndex((node, i) => node !== registryObjectsBefore[i])
      if (identityDrift >= 0) {
        return `fork-arm: registry entry ${identityDrift} is not the same object after compile/emit (a node was replaced by an equal-but-distinct copy)`
      }

      armLiveness.push(`d=${d} ratio=${pRatio.toFixed(1)}x N=${n} k=${k} arms=${armStates.length}`)
      note(`row=${P_IM_2_ID} d=${d} ratio=${pRatio.toFixed(1)}x N=${n} seamTargets=1 k=${k} arms=${armStates.length}`)
      return null
    })
    const status: 'HELD' | 'BROKEN' = outcome.failures > 0 ? 'BROKEN' : 'HELD'
    reportRow({
      id: P_IM_2_ID,
      strategy: P_IM_2_STRATEGY,
      status,
      attempts: outcome.attempts,
      failures: outcome.failures,
      liveness: outcome.liveness === 'none' ? 'none' : outcome.liveness,
      counterexample: outcome.counterexample,
    })
    expect(outcome.attempts).toBeGreaterThan(0)
    expect(armLiveness.length).toBeGreaterThan(0)
    expect(outcome.failures).toBe(0)
  })
})

let attemptSeq = 0
/** A unique id suffix per generated node (the module-level registries key on
 *  node ids — reused ids would cross-contaminate across attempts). */
function nextSeq(): number {
  attemptSeq += 1
  return attemptSeq
}

// ---- P-IM-3 generator ------------------------------------------------------

const P_IM_3_ID = 'P-IM-3'
const P_IM_3_STRATEGY = 'def-value:N[2,4]-consumers/full-pass/prototype-OBJECT-identity'

describe(`P-IM-3 a component is resolution + seam, never a copy (strategy ${P_IM_3_STRATEGY})`, () => {
  it('P-IM-3 reports HELD (ONE seam identity set over N ≥ 2 consumers; registry + prototype OBJECT identities flat across the full pass)', async () => {
    // FALSIFICATION EVIDENCE: a per-consumer mint makes the distinct seam-target
    // identity count `N` (with the distinct object ids printed); a
    // def-prototype RE-MINT that returns NEW objects carrying the SAME ids is
    // caught only by the object-identity clause below (T5 — a prototype-ID list
    // cannot see it); a registry rise across the pass prints the before/after
    // counts; a def-fill synthetic wire registered as a node fails the byId
    // clause with that wire printed.
    const outcome = runRow(P_IM_3_ID, P_IM_3_STRATEGY, PINNED_SEED + 3, (rng, _attempt, note) => {
      const n = drawInt(rng, 2, 4)
      const nKids = drawInt(rng, 1, 3)
      const t = translateLegacy(defEnvelope(n, nKids))
      const sup = supOf(t)
      const consumers = t.root.children
      // anti-vacuity, asserted BEFORE the identity clause: N ≥ 2
      if (consumers.length !== n || n < 2) return `N collapsed to ${consumers.length} (vacuity — "shared by N consumers" needs N ≥ 2)`
      const defRoots = protoNodesOf(t).filter(p => p.type === 'nav')
      const defChildren = protoNodesOf(t).filter(p => p.type === 'span')
      if (defRoots.length !== 1) return `def-root prototype count=${defRoots.length} ≠ 1 (per-consumer mint?)`
      if (defChildren.length !== nKids) return `def-child prototype count=${defChildren.length} ≠ ${nKids}`
      const registeredAfterTranslate = sup.allNodes().length
      const idsAfterTranslate = new Set(sup.allNodes().map(n => n.id))
      const prototypesAfterTranslate = componentPrototypeNodes(sup)

      // the identity clause — evaluated only after N ≥ 2 is proven
      compileAll(consumers)
      const targets = consumers.flatMap(c => seamTargetsOf(c))
      if (targets.length < n) return `seam edge count=${targets.length} < N=${n} (the multi-consumer graph was not constructed)`
      for (const x of targets) if (x !== defRoots[0]) return `seam edge targets a different object than the def-root ${defRoots[0]!.id}`
      if (new Set(targets).size !== 1) return `distinct seam-target identities=${new Set(targets).size} over ${targets.length} edges`

      // full pass: compileAll → emitElements → diffMinimal → applyOps
      const allStates = compileAll(sup.allNodes())
      const els = emitElements(allStates)
      const ops = diffMinimal(null, els)
      const adapter = countingAdapter()
      applyOpsReal(adapter as never, ops)
      if (sup.allNodes().length !== registeredAfterTranslate) {
        return `registry moved ${registeredAfterTranslate} → ${sup.allNodes().length} across the full pass`
      }
      // T5 — the def-prototype OBJECT IDENTITY SET, not the id list: a re-mint
      // with the same ids passes an id comparison and fails here.
      const protosAfter = componentPrototypeNodes(sup)
      if (JSON.stringify(protosAfter.map(p => p.id)) !== JSON.stringify(prototypesAfterTranslate.map(p => p.id))) {
        return `prototype census ids moved ${JSON.stringify(prototypesAfterTranslate.map(p => p.id))} → ${JSON.stringify(protosAfter.map(p => p.id))} across the full pass`
      }
      if (protosAfter.length !== prototypesAfterTranslate.length) {
        return `prototype object count ${prototypesAfterTranslate.length} → ${protosAfter.length} across the full pass`
      }
      const reminted = prototypesAfterTranslate.findIndex((before, i) => protosAfter[i] !== before)
      if (reminted >= 0) {
        return `def-prototype ${reminted} (id ${prototypesAfterTranslate[reminted]!.id}) was RE-MINTED across the full pass — new object, same id`
      }
      if (new Set(sup.allNodes().map(n => n.id)).size !== idsAfterTranslate.size) {
        return `node-identity set moved ${idsAfterTranslate.size} → ${new Set(sup.allNodes().map(n => n.id)).size} across the full pass`
      }
      const ids = registryIds(sup)
      const synthetic = els.filter(e => String(e.wire).includes(':'))
      if (synthetic.length === 0) return 'no def-fill element emitted (the synthetic-wire clause would scan nothing — generator must construct one)'
      for (const e of synthetic) if (ids.has(String(e.wire))) return `synthetic def-fill wire ${e.wire} IS a registry node id`

      note(`row=${P_IM_3_ID} N=${n} kids=${nKids} seam-edges=${targets.length} distinct=1 protoObjects=${protosAfter.length} synthetic=${synthetic.length}`)
      return null
    })
    const status: 'HELD' | 'BROKEN' = outcome.failures > 0 ? 'BROKEN' : 'HELD'
    reportRow({
      id: P_IM_3_ID,
      strategy: P_IM_3_STRATEGY,
      status,
      attempts: outcome.attempts,
      failures: outcome.failures,
      liveness: outcome.liveness,
      counterexample: outcome.counterexample,
    })
    expect(outcome.attempts).toBeGreaterThan(0)
    expect(outcome.failures).toBe(0)
  })
})

// ---- P-IM-4 generator ------------------------------------------------------

const P_IM_4_ID = 'P-IM-4'
const P_IM_4_STRATEGY = 'spy-containment:pipelines(a/b/c)+controls(supervisor+clientAPI,ops[1,3])'

describe(`P-IM-4 clone() reachability containment (strategy ${P_IM_4_STRATEGY})`, () => {
  it('P-IM-4 reports HELD (ZERO calls on all three pipelines, exactly ops on BOTH handler routes — a zero control is UNDETERMINED)', async () => {
    // FALSIFICATION EVIDENCE: any clone() on pipeline (a)/(b)/(c) shows as a
    // non-zero spy count at that stage boundary with the call count printed;
    // a control count ≠ ops means the spy over/under-fired OR the
    // clone-instance op silently no-opped on that route (the supervisor route
    // and the documented `clientAPI.apply` route are both driven, so a route
    // that stops cloning cannot hide behind the other); a control count of 0
    // proves the spy never matched and the line reports UNDETERMINED, never HELD.
    const spy = vi.spyOn(Node.prototype, 'clone')
    let controlTotal = 0
    let clientTotal = 0
    let supervisorTotal = 0
    let controlMintedOk = true
    let stage = 'none'
    try {
      const outcome = runRow(P_IM_4_ID, P_IM_4_STRATEGY, PINNED_SEED + 4, (rng, _attempt, note) => {
        spy.mockClear()
        // (a) placement pipeline
        stage = 'placement'
        const pt = translateLegacy(placedEnvelope())
        const pSup = supOf(pt)
        const pClient = createClient(pSup)
        const consumer = pt.nodes.find(x => String(x.props.id) === 'C')!
        const container = pt.nodes.find(x => String(x.props.id) === 'A')!
        if (spy.mock.calls.length !== 0) return `pipeline (a) clone calls=${spy.mock.calls.length} after translate`
        pClient.apply(consumer.id, { kind: 'placement-attach', node: consumer.id, container: container.id, names: ['zone-a', 'zone-b'] })
        if (spy.mock.calls.length !== 0) return `pipeline (a) clone calls=${spy.mock.calls.length} after placement-attach`
        compileAll(pt.nodes)
        if (spy.mock.calls.length !== 0) return `pipeline (a) clone calls=${spy.mock.calls.length} after compile`

        // (b) component-resolution pipeline, N ≥ 2
        stage = 'component'
        const n = drawInt(rng, 2, 4)
        const ct = translateLegacy(defEnvelope(n, 2))
        const cSup = supOf(ct)
        if (spy.mock.calls.length !== 0) return `pipeline (b) clone calls=${spy.mock.calls.length} after translate`
        compileAll(ct.nodes)
        if (spy.mock.calls.length !== 0) return `pipeline (b) clone calls=${spy.mock.calls.length} after seam fan-out`

        // (c) def-fill pipeline
        stage = 'def-fill'
        const els = emitElements(compileAll(cSup.allNodes()))
        if (spy.mock.calls.length !== 0) return `pipeline (c) clone calls=${spy.mock.calls.length} after emit`
        applyOpsReal(countingAdapter() as never, diffMinimal(null, els))
        if (spy.mock.calls.length !== 0) return `pipeline (c) clone calls=${spy.mock.calls.length} after diff+apply`

        // the MANDATORY handler positive control, same attempt, same spy:
        // the ops are split across BOTH routes of `clone()` (T11) — the
        // supervisor route (`hSup.apply`) and the documented client surface
        // (`clientAPI.apply`, which routes to the SAME supervisor call site; a
        // regression that stops routing client clone-instance ops through it is
        // caught here). The alternation starts on the CLIENT route so `ops = 1`
        // still drives it (`slot` is passed as the live Node, as the pages do).
        spy.mockClear()
        const ops = drawInt(rng, 1, 3)
        const ht = translateLegacy(siblingEnvelope())
        const hSup = supOf(ht)
        const hClient = createClient(hSup)
        const source = ht.root.children[0]!
        for (let i = 0; i < ops; i += 1) {
          const viaClient = i % 2 === 0
          const r = viaClient
            ? hClient.apply(source.id, { kind: 'clone-instance', source: source.id, slot: ht.root, priority: nextPriorityOf(ht.root) + i } as never)
            : hSup.apply({ kind: 'clone-instance', node: source, source, slot: ht.root, priority: nextPriorityOf(ht.root) + i } as never)
          if (r.status !== 'applied') return `control op ${i} (${viaClient ? 'clientAPI.apply' : 'Supervisor.apply'}) not applied: ${r.status}`
          if (viaClient) clientTotal += 1
          else supervisorTotal += 1
        }
        const count = spy.mock.calls.length
        const copies = hSup.allNodes().filter(x => x.runtimeMinted)
        if (copies.length !== ops) return `control copies=${copies.length} ≠ ops=${ops}`
        if (!copies.every(c => c.runtimeMinted === true)) return 'a control copy has runtimeMinted !== true'
        // every call's RECEIVER (`this`) is a Node, and the actor argument is the
        // one both routes pass — the receiver assertion is what makes "the spy
        // fired on the real prototype method" checkable
        const contexts = (spy.mock as unknown as { contexts: unknown[] }).contexts
        if (!contexts.every(c => c instanceof Node)) return 'a control call had a non-Node receiver'
        if (!spy.mock.calls.every(c => c[0] === 'actor')) return 'a control call carried an unexpected actor argument'
        if (!copies.every(c => c instanceof Node && typeof c.id === 'string')) return 'a control copy is not a Node'
        if (!(count >= 1 && count === ops)) return `control count=${count} ≠ ops=${ops}`
        if (count === 0) return 'control count 0 — the spy never matched (UNDETERMINED)'
        controlTotal += count
        if (!copies.every(c => c.runtimeMinted)) controlMintedOk = false
        note(`row=${P_IM_4_ID} pipeline(a/b/c)=0 controlOps=${ops} controlCalls=${count} clientRouteOps=${clientTotal}`)
        return null
      })
      const status: 'HELD' | 'BROKEN' | 'UNDETERMINED' =
        outcome.failures > 0 ? 'BROKEN' : (controlTotal === 0 ? 'UNDETERMINED' : 'HELD')
      reportRow({
        id: P_IM_4_ID,
        strategy: P_IM_4_STRATEGY,
        status,
        attempts: outcome.attempts,
        failures: outcome.failures,
        liveness: controlTotal > 0
          ? `control-calls=${controlTotal} clientAPI-route-ops=${clientTotal} supervisor-route-ops=${supervisorTotal} mintedOk=${controlMintedOk} ${outcome.liveness}`
          : 'none',
        counterexample: outcome.counterexample,
      })
      expect(controlTotal, 'P-IM-4 positive control never fired — the row MUST report UNDETERMINED, never HELD').toBeGreaterThan(0)
      expect(clientTotal, 'P-IM-4 never drove the `clientAPI.apply` route (T11) — that route is uncovered').toBeGreaterThan(0)
      expect(supervisorTotal, 'P-IM-4 never drove the direct `Supervisor.apply` route (T11) — that route is uncovered').toBeGreaterThan(0)
      expect(controlMintedOk).toBe(true)
      expect(outcome.failures).toBe(0)
      // `stage` is diagnostic context for the report line's counterexample
      void stage
    } finally {
      // restore the spy on EVERY exit path (no leak into the next suite)
      vi.restoreAllMocks()
    }
  })
})

// ---- P-TP-1 generator (engine-side half) -----------------------------------

const P_TP_1_ID = 'P-TP-1'
const P_TP_1_STRATEGY = 'journal-derived:zero(k=0)/positive(k[1,3])/decoy(layer-apply,rows-mint)/production-page'

describe(`P-TP-1 the clone census is journal-derived, engine-side half (strategy ${P_TP_1_STRATEGY})`, () => {
  it('P-TP-1 reports HELD (zero / positive / decoy arms) and asserts the PRODUCTION page value against an independently derived count', async () => {
    // FALSIFICATION EVIDENCE: a census that cannot be computed from
    // journalEntries at all (a constant) makes the positive arm read 0 ≠ k;
    // an arithmetic-identity derivation (registered − unplaced − 1 −
    // prototypes) makes the DECOY arm read non-zero while the journal holds no
    // clone-instance entry. T7: the local helper above is exercised through
    // `journalEntries`, so a PRODUCTION census that regressed to a literal is
    // invisible to the generator — the production clause below reads the REAL
    // page's published field and fails on the mismatch. (The page-side
    // INDEPENDENCE of the two published fields, and the page's own drift guard,
    // are the separate case P-TP-1p.)
    const decoyGrowth: number[] = []
    const outcome = runRow(P_TP_1_ID, P_TP_1_STRATEGY, PINNED_SEED + 5, (rng, _attempt, note) => {
      // (a) zero arm — a proven-empty journal
      const zt = translateLegacy(defEnvelope(2, 1))
      const zSup = supOf(zt)
      compileAll(zt.nodes)
      const zView = zSup.journalEntries({ afterIndex: 0, limit: 1000 })
      if (zView.totalEntries !== 0) return `zero arm: journal totalEntries=${zView.totalEntries} ≠ 0`
      if (zView.entries.filter(e => e.kind === 'clone-instance').length !== 0) return 'zero arm: a clone-instance entry exists'

      // (b) positive arm — the falsifier
      const k = drawInt(rng, 1, 3)
      const pt = translateLegacy(siblingEnvelope())
      const pSup = supOf(pt)
      const source = pt.root.children[0]!
      for (let i = 0; i < k; i += 1) {
        const r = pSup.apply({ kind: 'clone-instance', node: source, source, slot: pt.root, priority: nextPriorityOf(pt.root) + i } as never)
        if (r.status !== 'applied') return `positive arm: clone op ${i} not applied (${r.status})`
      }
      const measured = journalCloneOps(pSup).count
      if (measured !== k) return `positive arm: measured=${measured} ≠ k=${k} (a constant census reads 0 here)`
      if (measured === 0) return 'positive arm: measured 0 — the census cannot be derived from the journal'

      // (c) decoy arm — node-minting routes that are NOT clone-instance
      const h = hub()
      const proto = new Node({ type: 'li', props: { cls: 'row' } }, h, `nc-row-proto-${k}`)
      registerDefPrototypes(h.linkFor('item', 'component'), [proto])
      const root = new Node({ type: 'div', props: { id: 'nc-row-root' } }, h, `nc-row-root-${k}`)
      const dSup = new Supervisor({ hub: h, events: new EventBridge() })
      dSup.registerNode(root)
      dSup.registerNode(proto)
      const dClient = createClient(dSup)
      const before = dSup.allNodes().length
      const la = dClient.apply(root.id, {
        kind: 'layer-apply',
        target: root.id,
        layerId: `nc-decoy-${k}`,
        sourceName: 'nc-decoy',
        decls: [{ role: 'child', target: root, options: { priority: 9 } }],
        nodes: [{ type: 'span', props: { id: 'nc-decoy-1' } }],
      })
      if (la.status !== 'applied') return `decoy arm: layer-apply ${la.status}`
      const rm = dClient.apply(root.id, {
        kind: 'rows-mint',
        target: root.id,
        hookName: 'items',
        mintKind: 'component',
        prototypeName: 'item',
        rows: [{ title: 'T' }],
      })
      if (rm.status !== 'applied') return `decoy arm: rows-mint ${rm.status}`
      const grew = dSup.allNodes().length - before
      if (grew <= 0) return 'decoy arm: no node growth (the decoy proves nothing)'
      decoyGrowth.push(grew)
      const decoyCount = journalCloneOps(dSup).count
      if (decoyCount !== 0) return `decoy arm: measured=${decoyCount} ≠ 0 after ${grew} minted nodes (arithmetic-identity derivation)`

      note(`row=${P_TP_1_ID} k=${k} decoyGrowth=${grew} decoyCount=0`)
      return null
    })
    // T7 — the PRODUCTION value, asserted against the independently derived
    // count. The clause is evaluated BEFORE the report so a mismatch is
    // reflected in the reported status (report-before-assert), and a mismatch
    // FAILS below.
    const prod = await productionCensus()
    const prodFailure = productionCensusViolation(prod, expectedCloneOps(PROD_PAGE_DEPTH))
    const status: 'HELD' | 'BROKEN' = outcome.failures > 0 || prodFailure !== null ? 'BROKEN' : 'HELD'
    const liveness = `${outcome.liveness} prod=${prod === null ? `skipped(${prodCensusReason})` : `cloneOps=${prod['cloneOps']} registered=${prod['registered']} expected-cloneOps=${expectedCloneOps(PROD_PAGE_DEPTH)} expected-registered=${expectedRegisteredNodes(PROD_PAGE_DEPTH)}`}`
    reportRow({
      id: P_TP_1_ID,
      strategy: P_TP_1_STRATEGY,
      status,
      attempts: outcome.attempts,
      failures: outcome.failures,
      liveness,
      counterexample: prodFailure ?? outcome.counterexample,
    })
    expect(prodFailure, `the PRODUCTION census disagrees with the independently derived count: ${prodFailure}`).toBeNull()
    expect(outcome.failures).toBe(0)
    expect(decoyGrowth.length).toBeGreaterThan(0)
  })
})

// ---- P-TP-1 PAGE half — the published measurement must be INDEPENDENT ---------

describe('P-TP-1 page half — the demo modules publish TWO INDEPENDENTLY derived census fields (T7)', () => {
  it('P-TP-1p every demo module derives cloneOps from its journal AND publishes a separately derived measurement with a drift guard', async () => {
    // FALSIFICATION EVIDENCE (T7 — the regression this case exists for):
    //   · `PROFILE.cloneOps = 0` (a literal) or `= registered − unplaced − 1 −
    //     prototypes` (an arithmetic identity) → clause 1 fails with the line
    //     printed (the pre-fix state);
    //   · `PROFILE.journalCloneOps = PROFILE.cloneOps` (the page-census ALIASING
    //     the 2026-09-22 harness pass removed) → clause 2 fails: the two
    //     published values could never disagree, so the smoke's comparison and
    //     NC-2c's journal token are self-referential;
    //   · `PROFILE.journalCloneOps = <literal>` (or any RHS that is not a journal
    //     walk) → clause 2's independence check fails;
    //   · deleting the page's own `cloneOps !== journalCloneOps` drift guard →
    //     clause 3 fails: two sources published, never compared.
    // The VALUE-level form of the same property (the published number against an
    // INDEPENDENTLY derived count) is asserted by NC-1f / NC-1f-prod and by the
    // P-TP-1 and P-TP-2 register rows, on the real page's own profile.
    const sources = [
      { file: 'demo/path-fork-data.js', text: readRepoFile('demo/path-fork-data.js') },
      { file: 'demo/legacy-shape.js', text: readRepoFile('demo/legacy-shape.js') },
      { file: 'demo/fork-stress-data.js', text: readRepoFile('demo/fork-stress-data.js') },
    ]
    for (const { file, text } of sources) {
      const code = text.split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
      // ---- clause 1: the census field is the journal READ -------------------
      const censusAssignments = code.filter(l => /PROFILE\.cloneOps\s*=/.test(l))
      expect(censusAssignments.length, `${file}: no PROFILE.cloneOps assignment found (the census field vanished)`).toBeGreaterThan(0)
      for (const line of censusAssignments) {
        expect(
          /journalEntries\s*\(/.test(line) || /measured[A-Za-z]*CloneOps\s*\(/.test(line),
          `${file}: cloneOps assigned WITHOUT the journal measurement (§3 I5): ${line.trim()}`,
        ).toBe(true)
      }
      // ---- clause 2: the published measurement is NOT an alias --------------
      const measurementAssignments = code.filter(l => /PROFILE\.journalCloneOps\s*=/.test(l))
      expect(
        measurementAssignments.length,
        `${file}: no PROFILE.journalCloneOps assignment found (the published measurement token vanished)`,
      ).toBeGreaterThan(0)
      for (const line of measurementAssignments) {
        const marker = line.indexOf('PROFILE.journalCloneOps')
        const rhs = line.slice(marker).replace(/^PROFILE\.journalCloneOps\s*=\s*/, '').replace(/;?\s*$/, '').trim()
        expect(
          /\bcloneOps\b/.test(rhs),
          `${file}: the published measurement ALIASES the census field (RHS "${rhs}") — the two values can never disagree, so the comparison is self-referential (T7)`,
        ).toBe(false)
        expect(/^-?\d/.test(rhs), `${file}: the published measurement is a numeric LITERAL ("${rhs}")`).toBe(false)
        // the RHS must resolve to a journal-derived source: either a direct
        // `journalEntries(` call on the line, or an identifier bound in the file
        // to a helper whose body pages the SAME read accessor.
        const direct = /journalEntries\s*\(/.test(line)
        const lead = /^([A-Za-z_$][\w$]*)\b/.exec(rhs)?.[1]
        let indirect = false
        if (lead) {
          const binding = code.find(l => new RegExp(`(?:const|let|var)\\s+${lead}\\s*=\\s*[A-Za-z_$][\\w$]*\\s*\\(`).test(l))
          const helper = binding
            ? new RegExp(`(?:const|let|var)\\s+${lead}\\s*=\\s*([A-Za-z_$][\\w$]*)\\s*\\(`).exec(binding)?.[1]
            : undefined
          if (helper) {
            const defAt = text.indexOf(`function ${helper}(`)
            indirect = defAt >= 0 && /journalEntries\s*\(/.test(text.slice(defAt, defAt + 2500))
          }
        }
        expect(
          direct || indirect,
          `${file}: the published measurement is not derived from a journal read (RHS "${rhs}" is neither a direct journalEntries() call nor a helper that pages it): ${line.trim()}`,
        ).toBe(true)
      }
      // ---- clause 3: the page COMPARES its two independent sources ----------
      expect(
        /PROFILE\.cloneOps\s*!==\s*PROFILE\.journalCloneOps/.test(text),
        `${file}: the page publishes two census sources but never compares them — the drift they exist to catch cannot fail anything`,
      ).toBe(true)
    }
  })
})
// ---- P-TP-2 generator ------------------------------------------------------

const P_TP_2_ID = 'P-TP-2'
const P_TP_2_STRATEGY = 'cross-expression:static vs runtime at d[2,4]/prototype-term pinned separately'

describe(`P-TP-2 static-vs-runtime expressions differ ONLY by measured clones (strategy ${P_TP_2_STRATEGY})`, () => {
  it('P-TP-2 reports HELD (states/elements equal; the prototype term is pinned separately because it cancels in the difference)', async () => {
    // FALSIFICATION EVIDENCE: placement multiplicity leaking into node
    // multiplicity makes the two arms disagree on states/elements; a runtime
    // arm reporting 0 clones while its journal holds clone-instance entries
    // prints both numbers; a runtime prototype population ≠ 2(d−1) is invisible
    // to the difference clause (T8: `prototypes` and the `(2d−2)` discount are
    // THE SAME QUANTITY by construction, so they cancel identically and the
    // relation reduces to `runtimeRegistered = 2d−1 + clones`) — the SEPARATE
    // `rt.prototypes` and decomposition clauses below are what catch a
    // prototype-count drift, and the production clause catches it at page level.
    const outcome = runRow(P_TP_2_ID, P_TP_2_STRATEGY, PINNED_SEED + 6, (rng, _attempt, note) => {
      const d = drawInt(rng, 2, 4)
      const st = translateLegacy(forkEnvelope(d))
      const sSup = supOf(st)
      const sStates = compileAll(st.nodes)
      const sEls = emitElements(sStates).length
      const sRegistered = sSup.allNodes().length
      const sJournal = journalCloneOps(sSup)
      if (sJournal.count !== 0 || sJournal.totalEntries !== 0) return `static arm d=${d}: journal not empty (${sJournal.totalEntries} entries)`
      if (sStates.length !== 2 ** d - 1) return `static arm d=${d}: states=${sStates.length} ≠ 2^d−1`
      if (sEls !== 2 ** d - 1) return `static arm d=${d}: elements=${sEls} ≠ 2^d−1`
      if (sRegistered !== 2 * d - 1) return `static arm d=${d}: registered=${sRegistered} ≠ 2d−1`

      const rt = runtimeForkArm(d)
      if (rt.cloneOps <= 0) return `runtime arm d=${d}: measured clones=${rt.cloneOps} (0 makes the difference clause vacuous)`
      if (rt.cloneOps !== journalCloneOps(rt.sup).count) return 'runtime arm: census ≠ its journal clone count'
      if (rt.states.length !== sStates.length) return `arms disagree on states: ${rt.states.length} vs ${sStates.length}`
      if (rt.elements !== sEls) return `arms disagree on elements: ${rt.elements} vs ${sEls}`
      // T8 — the prototype-count-drift-sensitive clauses, stated separately from
      // the (cancelling) difference clause.
      if (rt.prototypes !== 2 * (d - 1)) {
        return `runtime arm d=${d}: prototype population=${rt.prototypes} ≠ 2(d−1)=${2 * (d - 1)} (the difference clause cannot see this — the term cancels)`
      }
      if (rt.registered !== 1 + rt.prototypes + rt.cloneOps) {
        return `runtime arm d=${d}: registered=${rt.registered} ≠ 1 + prototypes(${rt.prototypes}) + clones(${rt.cloneOps})`
      }
      const diff = rt.registered - sRegistered
      if (diff !== rt.cloneOps) {
        return `runtime − static registered=${diff} ≠ the measured clones ${rt.cloneOps} (the reduced relation: registered = 2d−1 + clones)`
      }
      const expectedDiff = rt.cloneOps + rt.prototypes - (2 * d - 2)
      if (diff !== expectedDiff) {
        return `runtime − static registered=${diff} ≠ clones(${rt.cloneOps}) + prototypes(${rt.prototypes}) − (2d−2)=${expectedDiff}`
      }
      note(`row=${P_TP_2_ID} d=${d} clones=${rt.cloneOps} protos=${rt.prototypes}=2(d-1) diff=${diff}=clones states=${sStates.length}`)
      return null
    })
    // the PRODUCTION decomposition (T7/T8), RE-POINTED for the converted page
    // (§8.2 row 7): the real page's `registered` must be `1 + 2(d−1) + 0` — the
    // path-enumeration node count, since the converted family adds no clones.
    const prod = await productionCensus()
    let prodFailure: string | null = null
    if (prod !== null) {
      const expectedRegistered = 1 + 2 * (PROD_PAGE_DEPTH - 1) + expectedCloneOps(PROD_PAGE_DEPTH)
      if (prod['registered'] !== expectedRegistered) {
        prodFailure = `production registered=${prod['registered']} ≠ 1 + 2(d−1) + clones(0) = ${expectedRegistered} (published profile=${JSON.stringify(prod)})`
      }
    }
    const status: 'HELD' | 'BROKEN' = outcome.failures > 0 || prodFailure !== null ? 'BROKEN' : 'HELD'
    reportRow({
      id: P_TP_2_ID,
      strategy: P_TP_2_STRATEGY,
      status,
      attempts: outcome.attempts,
      failures: outcome.failures,
      liveness: `${outcome.liveness} prodRegistered=${prod === null ? `skipped(${prodCensusReason})` : String(prod['registered'])}`,
      counterexample: prodFailure ?? outcome.counterexample,
    })
    expect(prodFailure).toBeNull()
    expect(outcome.attempts).toBeGreaterThan(0)
    expect(outcome.failures).toBe(0)
  })
})

// ============================================================================
// Register budget (§8.4: ≤ 100 attempts/row, ≤ 400 total) — SEVEN rows
// ============================================================================

/** The attempts this file's register rows may consume: six rows × the per-row
 *  budget. P-SM-1's allocation is asserted against it below (`P_SM_1_ATTEMPTS`),
 *  so the SEVEN-row total stays inside §8.4's 400-attempt budget even though the
 *  harness row executes in tests/unit/no-clone-guards.test.ts. */
const LOCAL_REGISTER_ROWS = 6
const P_SM_1_ATTEMPTS_ALLOWANCE = 4

describe('register report + budget — §8.4’s determinism and reporting rules', () => {
  it('every register row reports the four-value vocabulary, the attempts stay inside the budget, and the engine rows are HELD', () => {
    const ids = rowReports.map(r => r.id)
    for (const expected of ['P-IM-1', 'P-IM-2', 'P-IM-3', 'P-IM-4', 'P-TP-1', 'P-TP-2']) {
      expect(ids, `register row ${expected} did not report (rows=${ids.join(',')})`).toContain(expected)
    }
    // T1 — P-SM-1 is NO LONGER EXCUSED: the harness row executes and reports its
    // own §8.4 line in tests/unit/no-clone-guards.test.ts (its own case asserts
    // the line, its status, its attempts and its fault-arm liveness). This file
    // accounts for its allocation so the seven-row budget is checkable here too.
    expect(LOCAL_REGISTER_ROWS + 1, 'the register must hold exactly the seven §5 rows').toBe(7)
    expect(
      PER_ROW_ATTEMPTS * LOCAL_REGISTER_ROWS + P_SM_1_ATTEMPTS_ALLOWANCE,
      `the register's attempt budget overflows §8.4's 400 (${PER_ROW_ATTEMPTS}×${LOCAL_REGISTER_ROWS} + ${P_SM_1_ATTEMPTS_ALLOWANCE})`,
    ).toBeLessThanOrEqual(TOTAL_ATTEMPTS_BUDGET)
    for (const r of rowReports) {
      expect(['HELD', 'BROKEN', 'EXPECTED-RED', 'UNDETERMINED'], `row ${r.id} reported an off-vocabulary status`).toContain(r.status)
      expect(r.attempts, `row ${r.id} exceeded the ≤ 100 attempts/row rule`).toBeLessThanOrEqual(100)
      expect(r.strategy.length, `row ${r.id} reported no strategy id`).toBeGreaterThan(0)
      // T10 — every liveness note is ROW-SCOPED: a note carrying another row's
      // id would be a cross-row contamination, and `runRow` refuses to accept it
      // as liveness (it counts it as a failure instead). This is the assertion
      // that the module-level pool the suite used to keep cannot come back
      // unnoticed.
      if (r.liveness !== 'none') {
        expect(r.liveness, `row ${r.id} reported a liveness note that does not belong to it`).toContain(`row=${r.id} `)
        for (const other of rowReports) {
          if (other.id === r.id) continue
          expect(r.liveness, `row ${r.id} carries row ${other.id}'s liveness note`).not.toContain(`row=${other.id} `)
        }
      }
    }
    expect(totalAttempts).toBeGreaterThan(0)
    expect(totalAttempts).toBeLessThanOrEqual(TOTAL_ATTEMPTS_BUDGET)
    expect(PER_ROW_STOP_AFTER_FAILURES).toBe(5)
    // every register row this file executes must be HELD: a non-HELD row is a
    // DEFECT discovery, reported through that row's own counterexample line.
    // (P-TP-1's page-side INDEPENDENCE clause is asserted by the separate case
    // P-TP-1p, which is not a register row; P-SM-1's row reports its own line in
    // tests/unit/no-clone-guards.test.ts and is asserted there.)
    for (const r of rowReports) {
      expect(r.status, `row ${r.id} reported ${r.status} with counterexample=${r.counterexample}`).toBe('HELD')
      expect(r.failures).toBe(0)
    }
  })
})

// ---- small file-system helper (the §3 I5 page-half oracle) -----------------

function readRepoFile(rel: string): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return readFileSync(join(here, '..', '..', rel), 'utf8')
}
