/**
 * FRS-A — PASS2-FIT-REFERENCE-SCOPE: the parity + scope suite for R1
 * (`docs/specs/pass2-fit-reference-scope.md` §3 S1..S9, §5's seven-row register,
 * §7.1's honest-red doctrine, §7.2's FRS-1..FRS-8).
 *
 * ── WHAT THIS SUITE IS ─────────────────────────────────────────────────────
 * The unit narrows `fitReference`'s descendant walk (`src/core/resolve.ts:205-229`)
 * to nodes that are members of the slice passed into `Node.compile(slice)`. On a
 * DESCENDANT-CLOSED slice the change is OUTPUT-PRESERVING (§3 S1 fact 2: the
 * engine's slices are descendant-closed, so `D_S(n) = D(n)` for `n ∈ S` and the
 * hit set AND hit ORDER are unchanged) — so this suite has TWO assertion families
 * (§7.1):
 *
 *   1. SCOPE assertions (FRS-2, FRS-6, FRS-7) — the honest-RED half BEFORE the
 *      engine change landed (`resolve.ts:219` pushed `...d.children` with no
 *      membership test, so a slice node whose subtree extends beyond the slice
 *      was descended into). Observed by the test's OWN accessor wrapper. **The
 *      engine change has landed and these cases are GREEN** — the observable is
 *      the READ-OWNER set (the nodes whose `children` accessor was READ, i.e.
 *      the nodes the walk ENTERED): it is ⊆ the slice under the landed walk and
 *      was `[g, g2, y, y2]` under the pre-change walk. Every re-pointed case is
 *      still falsified by the pre-change walk (see the FALSIFICATION block).
 *   2. PARITY assertions (FRS-1, FRS-3, FRS-4, FRS-5, P-TP-1) — GREEN before and
 *      after by design (the pre-change behaviour IS the reference); they are the
 *      frozen regression guards that make a green scope assertion meaningful (a
 *      green scope assertion alone could be satisfied by an empty scan).
 *
 * A parity case that fails is a PRE-EXISTING DEFECT, never a legitimate red
 * (§3 S7 / §7.1) — the split is reported exactly as above.
 *
 * ── THE OBSERVABLE: ENTERED (read-owners) vs YIELDED (child-list elements) ──
 * §3 S1 confines the DESCENT: *"a child outside the slice is not descended into
 * and its subtree is not traversed"*. It never says such a child is not
 * ENUMERATED — and it cannot: `get children` (`src/core/node.ts:562-582`) returns
 * the live child list with NO membership filter, so to reach its in-slice
 * descendants the walk MUST read the in-slice `focus`/`x`'s child lists, and
 * those reads YIELD the out-of-slice `y`/`g` as elements. An empty "yielded" set
 * is therefore UNSATISFIABLE in any confined implementation, so it is not an
 * observable S1 supports. This suite observes the READ-OWNER set
 * (`ChildrenProbeState.readOwners`): `children` is read on a node only when the
 * walk is about to enter that node's subtree, so "read-owners ⊆ slice" IS "no
 * out-of-slice node is descended into". The *yielded* set is kept — and asserted
 * NON-empty outside the slice — as the discrimination proof that the read-owner
 * filter has content to filter. The unbounded operand for the strict-subset
 * statement is the same instrumentation run over the test's own PRE-CHANGE
 * traversal (walking into `[g, g2, y, y2]`, the ids the confined walk never
 * enters), so no assertion here can pass vacuously.
 *
 * ── ENUMERATED DATA STATES (one valid/happy-path case per reasonable state) ──
 *   S-EMPTY      empty slice (`compile([])`)                              FRS-1e (S6a)
 *   S-CLOSED     descendant-closed slice — the WHOLE tree (the engine's
 *                real shape; also `focusedSliceFor`'s slice)               FRS-1/3/5
 *   S-CLOSED-P   a PROPER descendant-closed slice: the consumer's whole
 *                subtree, D*(focus), with its ancestor `root` left OUT     FRS-2f
 *   S-OPEN       slice whose descendant region extends beyond it (built):
 *                used ONLY for the no-descent/scope observables, never as a
 *                parity basis (see the FIXTURE DECISION in §4)            FRS-2/6/7
 *   S-OWN        provider on the resolving node itself                     FRS-3(i)
 *   S-DESC       provider in a descendant subtree                          FRS-3(ii)
 *   S-ANC        provider on an ancestor ≠ focus                           FRS-3(iii)
 *   S-HUBLESS    private-link provider, no hub (provider-universe sweep)   FRS-3(iv)
 *   S-NONVIABLE  same-name provider that is not viable (term outcome)      FRS-3(v)
 *   S-MULTI      several same-name providers ⇒ `#f:` fork arms             FRS-1/4
 *   S-PLACEMENT  placement-routed node (hub-answered placement link)       FRS-1d
 *   S-SHUFFLE    same node set, different slice order                      FRS-5
 *   S-RECOMPILE  same slice compiled twice                                 FRS-5
 *
 * ── DOCUMENTED FAIL-STATES (one fail-safe test each) ───────────────────────
 *   FS-1  empty slice: no throw, no warn, empty result                     FRS-1e (S6a)
 *   FS-2  no out-of-slice node is ENTERED by the compile (its `children` is
 *         never read) — the read-owner set ⊆ the slice and a STRICT subset of
 *         the unbounded operand's read-owner set                       FRS-2c/d (S1)
 *   FS-3  the descent stops AT an out-of-slice child: no out-of-slice subtree
 *         is entered, while in-slice non-providers are still descended
 *         THROUGH to a deep in-slice provider                        FRS-6a/b (S6c)
 *   FS-4  a non-viable same-name provider keeps its term outcome            FRS-3(v) (S6d)
 *   FS-5  the walk does not stop at an in-slice child that is not a
 *         provider (a slice-list scan is forbidden)                         FRS-6c (S1)
 *
 * ── FALSIFICATION PER CASE (what a violating implementation produces) ──────
 *   FRS-1  any per-state field difference / state-count change / reorder.
 *   FRS-2  a READ-OWNER id absent from the slice — a node the walk entered that
 *          is not a slice member (pre-change: g/g2, entered from the in-slice x,
 *          and y/y2, entered from the in-slice focus) — or a read-owner set that
 *          is NOT a strict subset of the unbounded operand's (i.e. the walk
 *          entered everything the unconfined walk enters: no scope change).
 *   FRS-3  a lost provider (`bindings[name]` → unresolved), a flipped
 *          term/none, or an ancestor hit that changes owner.
 *   FRS-4  a set-equal but order-different permutation of the hits; a
 *          renumbered `#f:` index with the same owners; a `bindings` value
 *          sourced from the wrong arm. The naive-slice-list control ASSERTING
 *          inequality is the anti-vacuity proof that the sequence discriminates.
 *   FRS-5  a second compile differing in `bindings`/`forkKey`; an
 *          order-dependent per-node projection (a cache keyed by order).
 *   FRS-6  a walk that ENTERS an out-of-slice child (pre-change: the read-owner
 *          set contained [g, g2, y, y2]), or a walk that does NOT descend
 *          THROUGH an in-slice non-provider to a deep in-slice provider (the
 *          slice-list rewrite / a direct-children-only scan) — both directions
 *          asserted. FRS-6b's arm clause discriminates the *too-tight* and
 *          *slice-list* confinements; the ENTERED clause is the one the
 *          pre-change walk falsifies (see the file's NOT-DISCRIMINATING note in
 *          FRS-6b: an out-of-slice provider can never be viable — `viable ⊆
 *          slice` — so the pre/post walks agree on the arm SET here).
 *   FRS-7  an unchanged (or wider) bounded-walk count on the SAME input.
 *   FRS-8  a row reporting HELD while its clause is absent.
 *
 * ── NOTHING IS ASSERTED AS A WALL-CLOCK NUMBER (§5 omissions row 1) ───────
 * FRS-7 is a RELATIONAL count assertion on the same input; no literal visit
 * count is pinned (§5 omissions row 4).
 *
 * ── WHY THE TEST HAS ITS OWN ORACLE ───────────────────────────────────────
 * `fitReference` is module-local (§3 S3 — the report's probe was blocked by
 * exactly this, `…diagnosis.md:230`), so the pre-change traversal is
 * re-implemented HERE, verbatim from `resolve.ts:214-220`, as the test's own
 * oracle. The test therefore owns both sides of every parity/scope comparison
 * and adds NO engine surface.
 */
import { describe, it, expect, afterEach } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { makeRoot, makeNode, childOf, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import { Node } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { focusedSliceFor } from '../../src/core/supervisor.js'
import { emitElements } from '../../src/core/render-helpers.js'
import { diffMinimal } from '../../src/core/render.js'
import type { CompiledState, LinkConfigNameHub, NodeId } from '../../src/core/types.js'
import type { ProviderHit } from '../../src/core/resolve.js'
import type { Node as NodeType } from '../../src/core/node.js'

// ============================================================================
// 0. THE PINNED SEED + the seeded PRNG (§5's rule: the seed is printed)
// ============================================================================

/** 0x5eed2026 — pinned so the generated family is reproducible from the report
 *  alone. The whole family is a pure function of this constant. */
const PINNED_SEED = 0x5eed2026

type Rand = { int: (lo: number, hi: number) => number }

function makeRand(seed: number): Rand {
  let s = (seed >>> 0) || 1
  const next = (): number => {
    s ^= s << 13; s >>>= 0
    s ^= s >>> 17
    s ^= s << 5; s >>>= 0
    return s
  }
  return { int: (lo, hi) => lo + (next() % (hi - lo + 1)) }
}

/** The register's per-row budget (§5: ≤100 attempts/row, ≤400 total) + the
 *  suite's stop-after-5 counterexample rule. */
const ATTEMPTS_PER_ROW_CAP = 100
const REGISTER_TOTAL_CAP = 400
const COUNTEREXAMPLE_STOP = 5

// ============================================================================
// 1. THE ACCESSOR WRAPPER — belt AND braces (in-body `finally` + `afterEach`)
// ============================================================================

interface ChildrenProbeState {
  /** Every `node.children` read seen (walk and non-walk alike). */
  calls: number
  /** The owners whose `children` was read, in call order (the array form of
   *  `readOwners`, needed where the ORDER/count of the reads is asserted —
   *  FRS-6d's liveness and FRS-7b's relational count). */
  owners: NodeId[]
  /** THE S1 OBSERVABLE (§3 S1): the set of nodes whose `children` accessor was
   *  READ — i.e. the nodes the walk ENTERED. `children` is read on a node only
   *  when the code is about to enumerate/push that node's subtree (the seed read
   *  on the resolving consumer, then one read per popped node — `resolve.ts`
   *  `for (const c of node.children) …` / `for (const c of d.children) …`), so
   *  "readOwners ⊆ slice" is exactly "no out-of-slice node is descended into
   *  and no out-of-slice subtree is traversed". The pre-change walk read the
   *  `children` of `[g, g2, y, y2]` on the open slice; the landed walk does not.
   *  (Reads made by the compile's own state minting are included, which is what
   *  makes this a statement about the WHOLE compile, not only the walk — and it
   *  is the stronger assertion for that: no out-of-slice node is entered by
   *  anything the compile does.) */
  readOwners: Set<NodeId>
  /** The id of every node HANDED OUT by a `children` read (the child-list
   *  ELEMENTS), in no particular order. This is NOT the S1 observable and must
   *  never be asserted empty: `get children` yields every live child with no
   *  membership filter, so an in-slice node whose child list contains an
   *  out-of-slice child NECESSARILY yields that child (that is how the walk
   *  reaches its in-slice descendants at all). It is recorded so the cases can
   *  assert the ENUMERATED-but-not-ENTERED distinction — the proof that the
   *  read-owner filter has content to filter and is not vacuously empty. */
  yielded: Set<NodeId>
}

/** Installed wrappers, restored by `afterEach` unconditionally: these wrap
 *  `Node` PROTOTYPE accessors used by every other suite in the repo, so a leak
 *  would be catastrophic. `installChildrenProbe` also returns its own `restore`
 *  (used by `underProbe` in a `finally`) — the two mechanisms are independent. */
const installedRestores: (() => void)[] = []
let wrappersInstalledCount = 0

function installChildrenProbe(): { restore: () => void; state: ChildrenProbeState } {
  const state: ChildrenProbeState = { calls: 0, owners: [], readOwners: new Set(), yielded: new Set() }
  const own = Object.getOwnPropertyDescriptor(Node.prototype, 'children')!
  const orig = own.get!
  Object.defineProperty(Node.prototype, 'children', {
    configurable: true,
    enumerable: own.enumerable ?? true,
    get(this: NodeType) {
      const out = orig.call(this) as NodeType[]
      state.calls += 1
      state.owners.push(this.id)
      state.readOwners.add(this.id)
      for (const c of out) state.yielded.add(c.id)
      // the SAME array reference is returned: the wrapper alters no behaviour
      return out
    },
  })
  const restore = (): void => { Object.defineProperty(Node.prototype, 'children', own) }
  installedRestores.push(restore)
  wrappersInstalledCount += 1
  return { restore, state }
}

afterEach(() => {
  while (installedRestores.length > 0) installedRestores.pop()!()
})

/** Runs `fn` under the probe, restoring in a `finally` even when `fn` throws. */
function underProbe<T>(fn: () => T): { value: T; probe: ChildrenProbeState } {
  const { restore, state } = installChildrenProbe()
  try {
    return { value: fn(), probe: state }
  } finally {
    restore()
  }
}

// ============================================================================
// 2. THE TEST'S OWN ORACLE — the PRE-CHANGE traversal, verbatim
// ============================================================================

/** `providersOn` (`resolve.ts:102-111`) — anchors in array order (insertion
 *  order, never re-sorted). */
function providersOn(owner: NodeType, name: string): ProviderHit[] {
  const out: ProviderHit[] = []
  for (const a of owner.anchors) {
    if (typeof a.target !== 'string') continue
    if ((a.role === 'source' || a.role === 'duplex') && a.target === name) out.push({ anchor: a, owner })
  }
  return out
}

/** The PRE-CHANGE descendant arm (`resolve.ts:214-221`) — LIFO stack over
 *  `children` pre-sorted by `effectiveOrder`, hits pushed in `owner.anchors`
 *  order. This is the reference sequence FRS-1/FRS-4 freeze. */
function descendantHits(node: NodeType, name: string, viable: ReadonlySet<NodeId>): ProviderHit[] {
  const descendants: ProviderHit[] = []
  const stack: NodeType[] = [...node.children]
  while (stack.length > 0) {
    const d = stack.pop()!
    if (viable.has(d.id)) descendants.push(...providersOn(d, name))
    stack.push(...d.children)
  }
  return descendants
}

/** The UNBOUNDED walk's visited-id set, in visit order. */
function unboundedVisited(node: NodeType): NodeId[] {
  const seen = new Set<NodeId>()
  const order: NodeId[] = []
  const stack: NodeType[] = [...node.children]
  while (stack.length > 0) {
    const d = stack.pop()!
    if (seen.has(d.id)) continue
    seen.add(d.id)
    order.push(d.id)
    stack.push(...d.children)
  }
  return order
}

/** The UNBOUNDED walk's visited NODES, in visit order (the node-returning form
 *  of `unboundedVisited`, needed where the instrumentation must READ each
 *  visited node's `children`). */
function unboundedVisitedNodes(node: NodeType): NodeType[] {
  const seen = new Set<NodeId>()
  const order: NodeType[] = []
  const stack: NodeType[] = [...node.children]
  while (stack.length > 0) {
    const d = stack.pop()!
    if (seen.has(d.id)) continue
    seen.add(d.id)
    order.push(d)
    stack.push(...d.children)
  }
  return order
}

/** The MEMBERSHIP-BOUNDED walk (the fix's shape), used ONLY as the relational
 *  operand of FRS-7/8 — never as a parity reference. */
function boundedVisited(node: NodeType, sliceSet: ReadonlySet<NodeId>): NodeId[] {
  const seen = new Set<NodeId>()
  const order: NodeId[] = []
  const stack: NodeType[] = [...node.children]
  while (stack.length > 0) {
    const d = stack.pop()!
    if (!sliceSet.has(d.id)) continue
    if (seen.has(d.id)) continue
    seen.add(d.id)
    order.push(d.id)
    stack.push(...d.children)
  }
  return order
}

/** The `children` reads the UNBOUNDED descendant arm makes over a whole slice
 *  (one arm invocation per visible node — `resolveNames`, `resolve.ts:350`). */
function unboundedChildrenCalls(slice: readonly NodeType[]): number {
  let calls = 0
  for (const n of slice) {
    calls += 1 // `[...node.children]` (:215)
    calls += unboundedVisited(n).length // one `...d.children` per visited node (:219)
  }
  return calls
}

function boundedChildrenCalls(slice: readonly NodeType[], sliceSet: ReadonlySet<NodeId>): number {
  let calls = 0
  for (const n of slice) {
    calls += 1 // `[...node.children]` (:215) — the slice node itself is a member
    calls += boundedVisited(n, sliceSet).length
  }
  return calls
}

// ============================================================================
// 3. PROJECTION + COMPARISON HELPERS
// ============================================================================

interface StateProjection {
  nodeId: NodeId
  pathKey: string
  forkKey?: string
  bindings: Record<string, unknown>
  unresolved: unknown
  trace?: string[]
  state: string
  children: NodeId[]
}

function projectState(s: CompiledState): StateProjection {
  const out: StateProjection = {
    nodeId: s.nodeId,
    pathKey: s.pathKey,
    bindings: s.bindings,
    unresolved: s.unresolved,
    state: s.state,
    children: [...s.children],
  }
  if (s.forkKey !== undefined) out.forkKey = s.forkKey
  if (s.trace !== undefined) out.trace = s.trace
  return out
}

interface ResultProjection {
  actionable: StateProjection[]
  dropped: Array<{ arm: NodeId[]; reason: string }>
  warnings: Array<{ code: string; pathKey: string }>
}

function project(res: ReturnType<NodeType['compile']>): ResultProjection {
  return {
    actionable: res.actionable.map(projectState),
    dropped: res.dropped.map(d => ({ arm: [...d.arm], reason: d.reason })),
    warnings: res.warnings.map(w => ({ code: w.code, pathKey: w.pathKey })),
  }
}

/** Per-NODE projection (order-independent — S8: "only the array order follows
 *  the slice"). */
function perNodeProjection(res: ReturnType<NodeType['compile']>): Map<NodeId, StateProjection[]> {
  const m = new Map<NodeId, StateProjection[]>()
  for (const s of res.actionable) {
    const arr = m.get(s.nodeId)
    if (arr) arr.push(projectState(s))
    else m.set(s.nodeId, [projectState(s)])
  }
  return m
}

function sliceIds(slice: readonly NodeType[]): NodeId[] {
  return slice.map(n => n.id)
}

/** §3 S1 fact 2 as a testable predicate: children of slice members that are NOT
 *  themselves slice members. */
function descendantsOutsideSlice(slice: readonly NodeType[]): NodeId[] {
  const set = new Set(sliceIds(slice))
  const out: NodeId[] = []
  for (const n of slice) for (const c of n.children) if (!set.has(c.id)) out.push(c.id)
  return out
}

/** The oracle's arm result for a consumer: the `own` arm, the descendant arm
 *  VERBATIM, the ancestor arm, then the slice-wide `fallbackTermination`
 *  (`resolve.ts:192-201`) — the engine's arm precedence. Only the arm RESULT is
 *  compared (S2), never the state-minting pipeline. `viable` is passed in
 *  explicitly: the engine's set is `viable ⊆ slice` (S1 fact 1) and every
 *  fixture here is built so that all slice members are viable (asserted in
 *  FRS-1c via `dropped === []`). */
type OracleFit = { kind: 'hits'; hits: ProviderHit[] } | { kind: 'term' } | { kind: 'none' }

function oracleFit(consumer: NodeType, name: string, slice: readonly NodeType[], viable: ReadonlySet<NodeId>): OracleFit {
  const own = providersOn(consumer, name)
  if (own.length > 0) return { kind: 'hits', hits: own }
  const desc = descendantHits(consumer, name, viable)
  if (desc.length > 0) return { kind: 'hits', hits: desc }
  for (let cur = consumer.parent; cur; cur = cur.parent) {
    if (!viable.has(cur.id)) continue
    const up = providersOn(cur, name)
    if (up.length > 0) return { kind: 'hits', hits: up }
  }
  const fallback: ProviderHit[] = []
  for (const s of slice) {
    if (viable.has(s.id)) continue
    fallback.push(...providersOn(s, name))
  }
  return fallback.length > 0 ? { kind: 'term' } : { kind: 'none' }
}

/** The `pathKey`s and `bindings` the engine must produce for a target-bearing
 *  consumer — the parity oracle for FRS-1/FRS-8 (one hit ⇒ NO `#f:` key,
 *  `resolve.ts:395-410`). */
function oracleArmsFor(consumer: NodeType, name: string, slice: readonly NodeType[], viable: ReadonlySet<NodeId>): {
  hitOwners: NodeId[]
  pathKeys: string[]
  bindings: unknown[]
} {
  const fit = oracleFit(consumer, name, slice, viable)
  if (fit.kind !== 'hits') return { hitOwners: [], pathKeys: [], bindings: [] }
  const hits = fit.hits
  return {
    hitOwners: hits.map(h => h.owner.id),
    pathKeys: hits.length === 1
      ? [consumer.pathKey]
      : hits.map((h, i) => `${consumer.pathKey}#f:${h.owner.id}#${i}`),
    bindings: hits.map(h => h.anchor.value),
  }
}

// ============================================================================
// 4. THE GOLDEN FIXTURE
// ============================================================================

/** Deterministic GOLDEN fixture (every node explicitly id'd; built through the
 *  repo's canonical `tests/helpers/fixtures.ts` builders so the shared family
 *  link keeps the root's `rootNode` target — the reason every node is `in-tree`
 *  and therefore viable):
 *
 *      root ── focus            focus targets `slot` (the consumer)
 *               ├── x           children order = x, y, z (priority 0, 1, 2)
 *               │    ├── x2     provider `slot` = 'slot-x2'
 *               │    └── g      provider `slot` = 'slot-g'
 *               │         └── g2
 *               ├── y
 *               │    └── y2     provider `slot` = 'slot-y2'
 *               └── z
 *                    └── h1 └── h2 └── h3   h3 provides `slot` = 'slot-h3'
 *
 *  Descent order (LIFO over `children` sorted by `effectiveOrder`):
 *  z→h1→h2→h3, y→y2, x→g→g2, x2 ⇒ hit order [h3, y2, g, x2] on `slot`.
 *
 *  The OPEN slice (FRS-2/6/7) drops `g`/`g2` and the whole `y` subtree, so the
 *  walk from the IN-SLICE `x` and `z` reaches out-of-slice children — the only
 *  shape in which the pre-change violation is observable, because the engine's
 *  own `focusedSliceFor` slices ARE descendant-closed (asserted in FRS-2b).
 *
 * ── THE FIXTURE DECISION (which slice carries which claim) ─────────────────
 * This file uses **option (a), with (b)'s parity half added**: the OPEN slice is
 * deliberately NOT descendant-closed and is used ONLY for the no-descent/scope
 * observables (FRS-2/FRS-6/FRS-7), whose observable is the READ-OWNER set; the
 * PARITY claims live exclusively on DESCENDANT-CLOSED slices, which is the
 * invariant that makes the confinement output-preserving (S1 fact 2: `D*(focus)`
 * is a union of complete `children`-subtrees, so for `n ∈ S`, `D_S(n) = D(n)` and
 * the confined walk yields the same hits in the same pre-order). The closed
 * parity bases in this file are:
 *   (i)  `closedSlice` — the WHOLE tree (a `focusedSliceFor` slice on the
 *        target-bearing focus; FRS-1a/1b/1c, FRS-3(ii), FRS-5a, P-TP-1);
 *   (ii) `focusedSliceFor`'s slice itself — FRS-2b asserts its closure and
 *        FRS-3(iv)/FRS-8d(iv) compile over it (the hub-less sweep shape);
 *   (iii) `consumerSubtreeSlice` — a PROPER descendant-closed slice, `D*(focus)`
 *        with the consumer's ancestor `root` LEFT OUT (FRS-2f): root's absence
 *        changes no arm, and a naive slice-list scan is caught there because its
 *        slice order (children-order pre-order) differs from the descent order.
 * The open slice carries NO parity claim against a frozen golden, and the reason
 * it can still carry FRS-6b's arm clause (which reads the same pre- and post-
 * change, because an out-of-slice provider can never be viable — `viable ⊆
 * slice`) is stated IN that case rather than left implicit. Self-consistency
 * check the file is built to pass: every case that asserts a hit set/order/
 * golden uses a slice with `descendantsOutsideSlice(slice) === []`.
 */
interface GoldenTree {
  root: NodeType
  focus: NodeType
  x: NodeType
  x2: NodeType
  g: NodeType
  g2: NodeType
  y: NodeType
  y2: NodeType
  z: NodeType
  h1: NodeType
  h2: NodeType
  h3: NodeType
  /** DFS preorder = the engine's slice order for the `all` slice. */
  all: NodeType[]
}

function buildGoldenTree(): GoldenTree {
  const root = makeRoot({ type: 'div' }, 'root')
  const focus = childOf(root, makeNode({ type: 'div' }, 'focus'), 0)
  targetAnchor(focus, 'slot')
  const x = childOf(focus, makeNode({ type: 'div' }, 'x'), 0)
  const y = childOf(focus, makeNode({ type: 'div' }, 'y'), 1)
  const z = childOf(focus, makeNode({ type: 'div' }, 'z'), 2)
  const x2 = childOf(x, makeNode({ type: 'p' }, 'x2'), 0)
  const g = childOf(x, makeNode({ type: 'p' }, 'g'), 1)
  const g2 = childOf(g, makeNode({ type: 'p' }, 'g2'), 0)
  const y2 = childOf(y, makeNode({ type: 'p' }, 'y2'), 0)
  const h1 = childOf(z, makeNode({ type: 'p' }, 'h1'), 0)
  const h2 = childOf(h1, makeNode({ type: 'p' }, 'h2'), 0)
  const h3 = childOf(h2, makeNode({ type: 'p' }, 'h3'), 0)
  addComponentSource(x2, 'slot', 'slot-x2')
  addComponentSource(y2, 'slot', 'slot-y2')
  addComponentSource(g, 'slot', 'slot-g')
  addComponentSource(h3, 'slot', 'slot-h3')
  const all: NodeType[] = []
  const walk = (n: NodeType): void => { all.push(n); for (const c of n.children) walk(c) }
  walk(root)
  return { root, focus, x, x2, g, g2, y, y2, z, h1, h2, h3, all }
}

/** The descendant-CLOSED slice: every node (the engine's real shape — a
 *  `focusedSliceFor` slice on a target-bearing focus includes its whole
 *  subtree, and the sweep only ever ADDS members). */
function closedSlice(t: GoldenTree): NodeType[] {
  return t.all
}

/** The PROPER descendant-closed slice (S-CLOSED-P): the consumer's whole
 *  subtree `D*(focus)` in children-order pre-order — closure holds node by node
 *  (`descendantsOutsideSlice` = []), and it is PROPER because the consumer's
 *  ancestor `root` is outside it. This is the parity basis FRS-2f compiles over,
 *  and its slice ORDER (`focus, x, x2, g, g2, y, y2, z, h1, h2, h3`) differs from
 *  the descent order (`h3, y2, g, x2`), so a naive slice-list scan is caught. */
function consumerSubtreeSlice(t: GoldenTree): NodeType[] {
  const out: NodeType[] = []
  const walk = (n: NodeType): void => { out.push(n); for (const c of n.children) walk(c) }
  walk(t.focus)
  return out
}

/** The OPEN slice: `focus`, `x`, `z` are in it; `g`/`g2` (x's subtree) and the
 *  whole `y` subtree are NOT — while `x` and `z` remain slice members whose
 *  `children` extend beyond it. NOT descendant-closed, and used ONLY for the
 *  no-descent/scope observables (the FIXTURE DECISION in §4). */
function openSlice(t: GoldenTree): NodeType[] {
  const drop = new Set<NodeId>([t.g.id, t.g2.id, t.y.id, t.y2.id])
  return t.all.filter(n => !drop.has(n.id))
}

/** The viable set the engine computes for these fixtures: every slice member is
 *  in-tree (no destroyed node, no prototype token, no loop) ⇒ `viable = slice`
 *  (S1 fact 1 — the engine only ever adds ids it iterated out of the slice). */
function viableFor(t: GoldenTree): ReadonlySet<NodeId> {
  return new Set(t.all.map(n => n.id))
}

// ============================================================================
// 5. FRS-1 — CompileResult parity (frozen golden + oracle parity)
// ============================================================================

/** THE FROZEN GOLDEN (P-IM-1): captured EMPIRICALLY from the pre-change build
 *  (§3 S2's instruction: capture the sequence empirically, then freeze it), then
 *  frozen. It is the `closedSlice` compile of `buildGoldenTree()`, projected to
 *  the S2 field list. Order is the contract: `actionable` follows the state
 *  array (slice order, per-node arms in descent order) and the `#f:<owner>#<i>`
 *  arm keys are numbered by the DESCENT sequence — h3 first, then y2, g, x2 —
 *  i.e. child-subtree-first LIFO, which is NOT flat child order. An implementer
 *  who "preserves child order" by re-sorting the hits breaks this while
 *  believing they satisfied S2.
 *
 *  RE-FROZEN (VALUE-PROVIDER-RENDER-DISPOSITION §4.1 / AM-7, contract-mandated
 *  re-pin): the four target-less `slot` providers `x2`, `g`, `y2`, `h3` are
 *  AUTHORED providers, so §2 C1 releases them from the render drop — each now
 *  carries its OWN state at its own `pathKey`, in its own `slice` position
 *  (`x2` after `x`, `g` after `x2`, `y2` after `y`, `h3` after `h2`), with its
 *  own published `slot` binding and its real child ids (`g` keeps `['g2']`).
 *  RE-VERIFIED in the same pass: the `#f:<owner>#<i>` arm numbering is
 *  UNCHANGED (h3#0, y2#1, g#2, x2#3 — resolution is untouched by C1), the
 *  `focus` arm states are byte-identical (values, `trace`, `children`) and
 *  `dropped` / `warnings` stay `[]` (the released providers were never in
 *  `dropped`). Every new line is attributable to C1: one state per released
 *  authored provider, nothing else. */
const FROZEN_GOLDEN: ResultProjection = {
  actionable: [
    { nodeId: 'root', pathKey: 'root', bindings: {}, unresolved: [], state: 'in-tree', children: ['focus'] },
    { nodeId: 'focus', pathKey: 'root/focus#f:h3#0', forkKey: 'root/focus#f:h3#0', bindings: { slot: 'slot-h3' }, unresolved: [], trace: ['h3'], state: 'in-tree', children: ['x', 'y', 'z'] },
    { nodeId: 'focus', pathKey: 'root/focus#f:y2#1', forkKey: 'root/focus#f:y2#1', bindings: { slot: 'slot-y2' }, unresolved: [], trace: ['y2'], state: 'in-tree', children: ['x', 'y', 'z'] },
    { nodeId: 'focus', pathKey: 'root/focus#f:g#2', forkKey: 'root/focus#f:g#2', bindings: { slot: 'slot-g' }, unresolved: [], trace: ['g'], state: 'in-tree', children: ['x', 'y', 'z'] },
    { nodeId: 'focus', pathKey: 'root/focus#f:x2#3', forkKey: 'root/focus#f:x2#3', bindings: { slot: 'slot-x2' }, unresolved: [], trace: ['x2'], state: 'in-tree', children: ['x', 'y', 'z'] },
    { nodeId: 'x', pathKey: 'root/focus/x', bindings: {}, unresolved: [], state: 'in-tree', children: ['x2', 'g'] },
    { nodeId: 'x2', pathKey: 'root/focus/x/x2', bindings: { slot: 'slot-x2' }, unresolved: [], state: 'in-tree', children: [] },
    { nodeId: 'g', pathKey: 'root/focus/x/g', bindings: { slot: 'slot-g' }, unresolved: [], state: 'in-tree', children: ['g2'] },
    { nodeId: 'g2', pathKey: 'root/focus/x/g/g2', bindings: {}, unresolved: [], state: 'in-tree', children: [] },
    { nodeId: 'y', pathKey: 'root/focus/y', bindings: {}, unresolved: [], state: 'in-tree', children: ['y2'] },
    { nodeId: 'y2', pathKey: 'root/focus/y/y2', bindings: { slot: 'slot-y2' }, unresolved: [], state: 'in-tree', children: [] },
    { nodeId: 'z', pathKey: 'root/focus/z', bindings: {}, unresolved: [], state: 'in-tree', children: ['h1'] },
    { nodeId: 'h1', pathKey: 'root/focus/z/h1', bindings: {}, unresolved: [], state: 'in-tree', children: ['h2'] },
    { nodeId: 'h2', pathKey: 'root/focus/z/h1/h2', bindings: {}, unresolved: [], state: 'in-tree', children: ['h3'] },
    { nodeId: 'h3', pathKey: 'root/focus/z/h1/h2/h3', bindings: { slot: 'slot-h3' }, unresolved: [], state: 'in-tree', children: [] },
  ],
  dropped: [],
  warnings: [],
}

describe('FRS-1 — CompileResult parity: the scoped scan changes NOTHING the compile returns (P-IM-1, S2/S6c/S6e)', () => {
  it('FRS-1a the frozen golden over the deterministic fixture family (deep-equal, every S2 field)', () => {
    const t = buildGoldenTree()
    const res = t.focus.compile(closedSlice(t))
    expect(project(res)).toEqual(FROZEN_GOLDEN)
    // falsification: any per-state field difference, state-count change or
    // reorder (including a forkKey renumbering) fails the deep-equal above.
  })

  it('FRS-1b oracle parity — the compile equals the test’s own PRE-CHANGE traversal on the same closed slice', () => {
    const t = buildGoldenTree()
    const oracle = oracleArmsFor(t.focus, 'slot', closedSlice(t), viableFor(t))
    expect(oracle.hitOwners).toEqual(['h3', 'y2', 'g', 'x2'])
    const arms = t.focus.compile(closedSlice(t)).actionable.filter(s => s.nodeId === t.focus.id)
    expect(arms.map(s => s.pathKey)).toEqual(oracle.pathKeys)
    expect(arms.map(s => s.bindings['slot'])).toEqual(oracle.bindings)
  })

  it('FRS-1c generated family (seeded): full per-attempt parity against the oracle', () => {
    const rand = makeRand(PINNED_SEED ^ 0x1)
    const attempts = 40
    let multiProvider = 0
    let oversizedWalk = 0
    for (let i = 0; i < attempts; i += 1) {
      const t = buildGeneratedTree(i, rand.int(2, 4), rand.int(3, 7), rand.int(1, 4))
      const slice = t.slice
      const viable = new Set(sliceIds(slice))
      const oracle = oracleArmsFor(t.focus, 'slot', slice, viable)
      const res = t.focus.compile(slice)
      // every slice member is viable in this family (S1 fact 1: viable ⊆ slice
      // and here it is the WHOLE slice) — the oracle's premise, asserted
      expect(res.dropped, `attempt ${i}: no node of the generated slice is non-viable`).toEqual([])
      const arms = res.actionable.filter(s => s.nodeId === t.focus.id)
      expect(arms.map(s => s.pathKey), `attempt ${i}: hit-order parity`).toEqual(oracle.pathKeys)
      expect(arms.map(s => s.bindings['slot']), `attempt ${i}: binding parity`).toEqual(oracle.bindings)
      // the WHOLE state array: nodeId order follows the slice order, and every
      // non-consumer state's pathKey is the node's own
      const idsInOrder = [...new Set(res.actionable.map(s => s.nodeId))]
      expect(idsInOrder, `attempt ${i}: the state array follows the slice order`).toEqual(
        sliceIds(slice).filter(id => res.actionable.some(s => s.nodeId === id)),
      )
      for (const s of res.actionable) {
        if (s.nodeId === t.focus.id) continue // the consumer's fork arms carry keys
        expect(s.pathKey, `attempt ${i}: pathKey of ${s.nodeId}`).toBe(nodePathKey(s.nodeId, t))
      }
      expect(res.warnings, `attempt ${i}: no new warnings`).toEqual([])
      if (oracle.hitOwners.length >= 2) multiProvider += 1
      // the liveness shape: the unbounded walk reaches a node that is NOT a
      // slice member (the unplaced non-viable provider) — the "walks further
      // than the slice" condition of §5 P-IM-1
      if (unboundedVisited(t.focus).some(id => !sliceSetHas(slice, id))) oversizedWalk += 1
    }
    // ANTI-VACUITY (§5 P-IM-1): the generator MUST have produced the liveness
    // shapes, else this row reports UNDETERMINED rather than HELD.
    expect(multiProvider, 'anti-vacuity: ≥1 attempt with ≥2 same-name providers').toBeGreaterThan(0)
    expect(oversizedWalk, 'anti-vacuity: ≥1 attempt where the unbounded walk exceeds the slice').toBeGreaterThan(0)
  })

  it('FRS-1d the placement-routed shape compiles identically to the oracle', () => {
    const t = buildPlacementRouted()
    const oracle = oracleArmsFor(t.focus, 'slot', t.slice, new Set(sliceIds(t.slice)))
    expect(oracle.hitOwners.length).toBeGreaterThan(0)
    const arms = t.focus.compile(t.slice).actionable.filter(s => s.nodeId === t.focus.id)
    expect(arms.map(s => s.pathKey)).toEqual(oracle.pathKeys)
    expect(arms.map(s => s.bindings['slot'])).toEqual(oracle.bindings)
  })

  it('FRS-1e FS-1 (S6a) — an empty slice is a safe empty result: no throw, no warn, no state', () => {
    const t = buildGoldenTree()
    const warns: unknown[] = []
    const origWarn = console.warn
    console.warn = (...args: unknown[]) => { warns.push(args) }
    let res: ReturnType<NodeType['compile']>
    try {
      res = t.focus.compile([])
    } finally {
      console.warn = origWarn
    }
    expect(res.actionable).toEqual([])
    expect(res.dropped).toEqual([])
    expect(res.warnings).toEqual([])
    expect(warns, 'an empty slice must not log').toEqual([])
  })
})

/** `node.pathKey` by id, resolved through the generated tree's node list. */
function nodePathKey(id: NodeId, t: GeneratedTree): string {
  const n = t.all.find(x => x.id === id)
  if (!n) throw new Error(`unknown node ${id}`)
  return n.pathKey
}

function sliceSetHas(slice: readonly NodeType[], id: NodeId): boolean {
  return slice.some(n => n.id === id)
}

// ============================================================================
// 6. FRS-2 — THE SCOPE ASSERTION (the honest-RED half pre-change; GREEN post)
// ============================================================================

describe('FRS-2 — the descendant walk ENTERS only slice members (P-IM-2, S1) — GREEN post-change', () => {
  it('FRS-2a the wrapper is live, the open slice is non-descendant-closed, and its out-of-slice children ARE enumerated', () => {
    const t = buildGoldenTree()
    const open = openSlice(t)
    const { probe } = underProbe(() => t.focus.compile(open))
    // the spy MUST be shown to fire (§5 P-IM-2's anti-vacuity clause)
    expect(probe.calls, 'the wrapped `children` accessor never fired — the spy is dead').toBeGreaterThan(0)
    // and the slice MUST be the shape the clause is about: the slice members
    // focus and x carry children that are NOT slice members (y and g)
    expect(descendantsOutsideSlice(open).sort()).toEqual(['g', 'y'])
    // THE ENTERED-vs-YIELDED DISCRIMINATION: the walk necessarily YIELDS the
    // out-of-slice children, because `get children` has no membership filter and
    // the walk must read `focus`'s list to reach `x`/`z` and `x`'s list to reach
    // `x2`. That is why the "yielded set" can never be asserted empty (S1) and
    // why the scope observable is the READ-OWNER set, asserted below.
    const yieldedOutside = [...probe.yielded].filter(id => !open.some(n => n.id === id)).sort()
    expect(
      yieldedOutside,
      'anti-vacuity: the walk MUST enumerate the out-of-slice children (they are elements of an in-slice node’s live child list) — if this were empty the read-owner assertion would be testing a set with no content to filter',
    ).toEqual(['g', 'y'])
  })

  it('FRS-2b the engine’s own `focusedSliceFor` slice IS descendant-closed (S1 fact 2 — why parity holds)', () => {
    const t = buildGoldenTree()
    expect(descendantsOutsideSlice(focusedSliceFor(t.focus, t.all))).toEqual([])
  })

  it('FRS-2c FS-2 (S1): no out-of-slice node is ENTERED by the compile — the read-owner set ⊆ the slice', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const inSlice = new Set(sliceIds(slice))
    const { probe } = underProbe(() => t.focus.compile(slice))
    const readOwners = [...probe.readOwners].sort()
    const outside = readOwners.filter(id => !inSlice.has(id))
    expect(
      outside,
      `the compile read the \`children\` of node(s) OUTSIDE the slice: [${outside.join(', ')}] — reading a node's child list is what entering its subtree means (the pre-change walk entered [g, g2, y, y2] here). read-owners=[${readOwners.join(', ')}], children reads=${probe.calls}; the out-of-slice children ENUMERATED by those reads=[${[...probe.yielded].filter(id => !inSlice.has(id)).sort().join(', ')}] (enumeration is NOT a violation — S1 constrains the descent, not the child list)`,
    ).toEqual([])
    // falsification retained: the PRE-change walk reads g's and y's `children`
    // (measured [g, g2, y, y2]) ⇒ this assertion is RED on the unconfined walk
    // and on any implementation that descends past an out-of-slice child.
  })

  it('FRS-2d FS-2 (S1 + §5 P-IM-2): the read-owner set is a STRICT subset of the unbounded operand’s — with a NON-empty operand', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const inSlice = new Set(sliceIds(slice))
    // (1) the code under test
    const code = underProbe(() => t.focus.compile(slice))
    // (2) the UNBOUNDED operand through the same instrumentation: the test's own
    //     pre-change traversal (`resolve.ts`'s old `[...node.children]` +
    //     `stack.push(...d.children)`), which reads the `children` of every node
    //     it reaches, out-of-slice ones included.
    const oracle = underProbe(() => {
      void t.focus.children
      for (const n of unboundedVisitedNodes(t.focus)) void n.children
    })
    const codeReadOwners = new Set(code.probe.owners)
    const oracleReadOwners = new Set(oracle.probe.owners)
    // ANTI-VACUITY: the unbounded operand is non-empty AND reaches the four
    // out-of-slice nodes — so "⊆ the operand" / "strictly smaller" have content.
    expect(oracleReadOwners.size, 'the unbounded operand must have read `children`').toBeGreaterThan(0)
    const oracleOutside = [...oracleReadOwners].filter(id => !inSlice.has(id)).sort()
    expect(
      oracleOutside,
      'the falsification target must be non-empty: the unbounded operand enters the out-of-slice subtrees',
    ).toEqual(['g', 'g2', 'y', 'y2'])
    // THE TWO ASSERTIONS UNDER TEST. They are mutually CONSISTENT (the earlier
    // form of this case demanded the opposite of FRS-2c):
    //  (a) the walk never leaves the consumer's own subtree — the only read
    //      owners outside it are slice ANCESTORS read by state minting (`root`),
    //      which the unbounded descendant walk never reaches from `focus`;
    const consumerSubtree = new Set<NodeId>([t.focus.id, ...unboundedVisited(t.focus)])
    const codeWalkOwners = [...codeReadOwners].filter(id => consumerSubtree.has(id))
    expect(codeWalkOwners.length, 'the walk must have read some `children` (liveness)').toBeGreaterThan(0)
    expect(
      [...codeWalkOwners].filter(id => !oracleReadOwners.has(id)),
      'every node the confined walk ENTERED must be a node the unbounded walk also enters',
    ).toEqual([])
    //  (b) … and it is STRICTLY smaller: the unbounded walk enters the four
    //      out-of-slice nodes the confined walk never enters.
    const skipped = [...oracleReadOwners].filter(id => !codeReadOwners.has(id)).sort()
    expect(
      skipped,
      'the scope change must remove a REAL traversal, not a cosmetic one: the unbounded operand enters [g, g2, y, y2] and the confined walk must not',
    ).toEqual(['g', 'g2', 'y', 'y2'])
    expect(skipped.length, 'the strict-subset statement must not be vacuous').toBeGreaterThan(0)
    // falsification retained: on the unconfined walk `skipped` is [] (the walk
    // enters everything the operand enters) ⇒ RED; under the confined walk the
    // two sets differ exactly by the out-of-slice subtrees ⇒ GREEN.
  })

  it('FRS-2e the unbounded walk demonstrably enters NON-slice nodes (the falsification target exists)', () => {
    const t = buildGoldenTree()
    const inSlice = new Set(sliceIds(openSlice(t)))
    expect(unboundedVisited(t.focus).filter(id => !inSlice.has(id))).toEqual(['y', 'y2', 'g', 'g2'])
  })

  it('FRS-2f S-CLOSED-P: the PROPER descendant-closed parity basis carries the same arms as the whole-tree golden', () => {
    const t = buildGoldenTree()
    const dstar = consumerSubtreeSlice(t)
    // the fixture's defining property (S1 fact 2's premise) …
    expect(descendantsOutsideSlice(dstar), 'D*(focus) must be descendant-closed').toEqual([])
    expect(sliceIds(dstar)).not.toContain(t.root.id)
    expect(dstar.length, 'the slice must be PROPER (an ancestor is outside it)').toBeLessThan(t.all.length)
    // … and the parity obligation (§3 S2) ON THAT BASIS: the confined walk
    // descends the whole subtree, skipping the out-of-slice ancestor, and the
    // resulting hit set AND order are the oracle's
    const oracle = oracleArmsFor(t.focus, 'slot', dstar, new Set(sliceIds(dstar)))
    expect(oracle.hitOwners).toEqual(['h3', 'y2', 'g', 'x2'])
    const res = t.focus.compile(dstar)
    const arms = res.actionable.filter(s => s.nodeId === t.focus.id)
    expect(arms.map(s => s.pathKey)).toEqual(oracle.pathKeys)
    expect(arms.map(s => s.bindings['slot'])).toEqual(oracle.bindings)
    expect(res.actionable.some(s => s.nodeId === t.root.id), 'the out-of-slice ancestor yields no state').toBe(false)
    // identical to the whole-tree golden's focus arms ⇒ confinement is
    // output-preserving when the slice is descendant-closed
    const goldenFocus = FROZEN_GOLDEN.actionable.filter(s => s.nodeId === 'focus')
    expect(arms.map(s => ({ pathKey: s.pathKey, bindings: s.bindings['slot'] })))
      .toEqual(goldenFocus.map(s => ({ pathKey: s.pathKey, bindings: s.bindings['slot'] })))
    // THE COUNTEREXAMPLE (liveness): a naive slice-list scan over the SAME input
    // yields a DIFFERENT sequence, so this case discriminates the confined
    // descent from the rewrite §3 S1 forbids.
    const naive = dstar.filter(n => providersOn(n, 'slot').length > 0).map(n => n.id)
    expect(naive, 'the naive slice-list control must differ on this input too').toEqual(['x2', 'g', 'y2', 'h3'])
    expect(naive).not.toEqual(oracle.hitOwners)
  })
})
// ============================================================================
// 7. FRS-3 — no provider loss (P-IM-4, S6c/S6d)
// ============================================================================

describe('FRS-3 — no provider loss across own / descendant / ancestor / private-link / non-viable (P-IM-4, S6c/S6d)', () => {
  it('FRS-3(i) an OWN provider wins (depth-0 self-resolution, S6g — the own arm is untouched)', () => {
    const root = makeRoot({ type: 'div' }, 'i-root')
    const focus = childOf(root, makeNode({ type: 'div' }, 'i-focus'), 0)
    targetAnchor(focus, 'slot')
    addComponentSource(focus, 'slot', 'own-value')
    const kid = childOf(focus, makeNode({ type: 'p' }, 'i-kid'), 0)
    addComponentSource(kid, 'slot', 'kid-value')
    const st = focus.compile([root, focus, kid]).actionable.find(s => s.nodeId === focus.id)!
    expect(st.bindings['slot']).toBe('own-value')
    expect(st.forkKey, 'an own hit alone never forks (one hit ⇒ no #f: key)').toBeUndefined()
  })

  it('FRS-3(ii) a DESCENDANT provider resolves and forks once per hit', () => {
    const t = buildGoldenTree()
    const oracle = oracleArmsFor(t.focus, 'slot', closedSlice(t), viableFor(t))
    const arms = t.focus.compile(closedSlice(t)).actionable.filter(s => s.nodeId === 'focus')
    expect(arms.map(s => s.bindings['slot'])).toEqual(oracle.bindings)
    expect(arms.length).toBe(oracle.hitOwners.length)
  })

  it('FRS-3(iii) a provider on an ANCESTOR other than the focus resolves (the case a slice-membership-only filter defeats)', () => {
    // The provider must live on a VIABLE ancestor: the root node itself owns no
    // child anchor, so it is classified `unplaced`/non-viable and can only answer
    // through `fallbackTermination` — the ancestor arm needs a real in-tree
    // ancestor, so the provider sits on a mid-tree node that IS in the slice.
    const root = makeRoot({ type: 'div' }, 'iii-root')
    const anc = childOf(root, makeNode({ type: 'div' }, 'iii-anc'), 0)
    addComponentSource(anc, 'slot', 'anc-value')
    const off = childOf(anc, makeNode({ type: 'div' }, 'iii-off'), 0)
    const focus = childOf(off, makeNode({ type: 'div' }, 'iii-focus'), 0)
    targetAnchor(focus, 'slot')
    const slice = [root, anc, off, focus]
    const st = focus.compile(slice).actionable.find(s => s.nodeId === focus.id)!
    expect(st.bindings['slot'], 'the ancestor provider must be found').toBe('anc-value')
    expect(descendantHits(focus, 'slot', new Set(sliceIds(slice))), 'no descendant provides it — the ancestor arm did').toEqual([])
    expect(sliceIds(slice)).toContain(anc.id)
  })

  it('FRS-3(iv) a HUB-LESS private-link provider (the provider-universe sweep) is not lost', () => {
    const root = makeRoot({ type: 'div' }, 'iv-root') // no hub anywhere in this tree
    const focus = childOf(root, makeNode({ type: 'div' }, 'iv-focus'), 0)
    targetAnchor(focus, 'slot')
    const kid = childOf(focus, makeNode({ type: 'p' }, 'iv-kid'), 0)
    addComponentSource(kid, 'slot', 'private-value')
    const slice = focusedSliceFor(focus, [root, focus, kid])
    expect(sliceIds(slice), 'the hub-less sweep must add the provider').toContain(kid.id)
    const st = focus.compile(slice).actionable.find(s => s.nodeId === focus.id)!
    expect(st.bindings['slot']).toBe('private-value')
  })

  it('FRS-3(v) FS-4 a NON-VIABLE same-name provider is confined to `fallbackTermination` (S6d)', () => {
    // A slice member that the engine can NEVER make viable: an UNPLACED node
    // (no family edge ⇒ chain → 'unplaced') with NO self-provide... except that
    // a source anchor IS what makes an unplaced node self-providing
    // (`node.ts:1149-1153`). The engine's own viability rule is therefore exact
    // here: the non-viable-only case needs a provider whose ONLY anchor-bearing
    // role is the name itself AND which is destroyed — the one unplaced shape
    // `viable` refuses. Both halves of S6d are asserted:
    //  (a) a non-viable provider contributes NOTHING when a viable one exists
    //      (its value is not the binding — the fallback is never consulted);
    //  (b) a non-viable-ONLY provider set terminates the arm with the fallback's
    //      reason instead of binding.
    // (a)
    {
      const root = makeRoot({ type: 'div' }, 'v-root')
      const focus = childOf(root, makeNode({ type: 'div' }, 'v-focus'), 0)
      targetAnchor(focus, 'slot')
      const viable = childOf(focus, makeNode({ type: 'p' }, 'v-kid'), 0)
      addComponentSource(viable, 'slot', 'viable-value')
      const dead = childOf(focus, makeNode({ type: 'p' }, 'v-dead'), 1)
      addComponentSource(dead, 'slot', 'dead-value')
      dead.markDestroyed() // the ONLY slice-member shape `viable` refuses outright (`node.ts:1121-1124`)
      const slice = [root, focus, viable, dead]
      expect(dead.destroyed).toBe(true)
      const res = focus.compile(slice)
      const st = res.actionable.find(s => s.nodeId === focus.id)!
      expect(st.bindings['slot'], 'the VIABLE provider wins; the non-viable one contributes nothing').toBe('viable-value')
      expect(st.bindings['slot']).not.toBe('dead-value')
      expect(res.dropped.some(d => d.arm.includes(dead.id)), 'the destroyed provider is dropped, never consulted').toBe(true)
    }
    // (b)
    {
      const root = makeRoot({ type: 'div' }, 'v2-root')
      const focus = childOf(root, makeNode({ type: 'div' }, 'v2-focus'), 0)
      targetAnchor(focus, 'slot')
      const dead = childOf(focus, makeNode({ type: 'p' }, 'v2-dead'), 0)
      addComponentSource(dead, 'slot', 'dead-value')
      dead.markDestroyed()
      const slice = [root, focus, dead]
      const res = focus.compile(slice)
      expect(res.actionable.filter(s => s.nodeId === focus.id), 'a non-viable-only provider terminates the arm').toEqual([])
      expect(
        res.dropped.some(d => d.arm.includes(focus.id)),
        `the arm must DROP (term), not bind (dropped=${JSON.stringify(res.dropped.map(d => ({ arm: d.arm, reason: d.reason })))})`,
      ).toBe(true)
      // and the oracle agrees on the term outcome (the fallback's business)
      expect(oracleFit(focus, 'slot', slice, new Set([root.id, focus.id])).kind).toBe('term')
    }
  })
})

// ============================================================================
// 8. FRS-4 — hit ORDER + the mandatory naive-slice-list control (P-IM-3, S2)
// ============================================================================

interface OrderTree { root: NodeType; focus: NodeType; slice: NodeType[]; expectedOrder: NodeId[] }

/** Two sibling subtrees under the consumer whose `effectiveOrder` makes x
 *  precede y in `children`, each carrying a same-name provider — so the descent
 *  sequence is unambiguously child-subtree-first (y2 before x2) and any
 *  re-sort/reversal is caught. */
function buildOrderTree(): OrderTree {
  const root = makeRoot({ type: 'div' }, 'o-root')
  const focus = childOf(root, makeNode({ type: 'div' }, 'o-focus'), 0)
  targetAnchor(focus, 'slot')
  const x = childOf(focus, makeNode({ type: 'div' }, 'o-x'), 0)
  const y = childOf(focus, makeNode({ type: 'div' }, 'o-y'), 1)
  const x2 = childOf(x, makeNode({ type: 'p' }, 'o-x2'), 0)
  const y2 = childOf(y, makeNode({ type: 'p' }, 'o-y2'), 0)
  addComponentSource(x2, 'slot', 'o-x2v')
  addComponentSource(y2, 'slot', 'o-y2v')
  return { root, focus, slice: [root, focus, x, y, x2, y2], expectedOrder: ['o-y2', 'o-x2'] }
}

describe('FRS-4 — hit-ORDER parity + the mandatory naive-slice-list control (P-IM-3, S2/S6e)', () => {
  it('FRS-4a the hit sequence, arm keys, pathKey/forkKey and per-arm bindings follow the DESCENT order', () => {
    const t = buildOrderTree()
    const oracle = oracleArmsFor(t.focus, 'slot', t.slice, new Set(sliceIds(t.slice)))
    expect(oracle.hitOwners).toEqual(t.expectedOrder)
    const arms = t.focus.compile(t.slice).actionable.filter(s => s.nodeId === t.focus.id)
    expect(arms.map(s => s.pathKey)).toEqual(oracle.pathKeys)
    expect(arms.map(s => s.forkKey)).toEqual(oracle.pathKeys)
    expect(arms.map(s => s.bindings['slot'])).toEqual(oracle.bindings)
  })

  it('FRS-4b the NAIVE slice-list scan produces a DIFFERENT sequence on the SAME input (mandatory liveness control)', () => {
    const t = buildOrderTree()
    const oracle = oracleArmsFor(t.focus, 'slot', t.slice, new Set(sliceIds(t.slice)))
    const dfsSequence = oracle.hitOwners
    // The naive rewrite §3 S1 names: iterate the slice ARRAY in insertion order
    // (ancestors-first, then descendants as `focusedSliceFor` builds them) and
    // treat viable members carrying the name as the hits.
    const naiveSequence = t.slice.filter(n => providersOn(n, 'slot').length > 0).map(n => n.id)
    expect(
      naiveSequence,
      'the naive control must produce a DIFFERENT sequence on the same input — else the counterexample is not discriminating and the row is vacuous',
    ).not.toEqual(dfsSequence)
    expect(naiveSequence).toEqual(['o-x2', 'o-y2'])
    const naiveKeys = naiveSequence.map((id, i) => `${t.focus.pathKey}#f:${id}#${i}`)
    expect(naiveKeys, 'the arm keys would renumber under the naive form').not.toEqual(oracle.pathKeys)
  })
})

// ============================================================================
// 9. FRS-5 — determinism + shuffled-slice per-node parity (P-IM-5, S8/S3)
// ============================================================================

describe('FRS-5 — determinism and idempotence (P-IM-5, S8/S3)', () => {
  it('FRS-5a compiling the same slice twice returns deep-equal results (no warm-up dependence)', () => {
    const t = buildGoldenTree()
    const slice = closedSlice(t)
    const a = project(t.focus.compile(slice))
    expect(project(t.focus.compile(slice))).toEqual(a)
    expect(project(t.focus.compile(slice))).toEqual(a)
  })

  it('FRS-5b a REORDERED slice yields the same per-node states/bindings/unresolved/dropped/warnings', () => {
    // FLAT fixture: the focus carries N sibling provider subtrees whose leaves
    // are the slice's TAIL, so a leaf-order reversal is a REAL order change that
    // cannot perturb the engine's chain classification (every slice member's
    // parent chain is in the slice either way — S8's premise).
    const root = makeRoot({ type: 'div' }, 's-root')
    const focus = childOf(root, makeNode({ type: 'div' }, 's-focus'), 0)
    targetAnchor(focus, 'slot')
    const holders: NodeType[] = []
    const leaves: NodeType[] = []
    for (let i = 0; i < 4; i += 1) {
      const h = childOf(focus, makeNode({ type: 'div' }, `s-h${i}`), i)
      holders.push(h)
      const l = childOf(h, makeNode({ type: 'p' }, `s-p${i}`), 0)
      leaves.push(l)
      addComponentSource(l, 'slot', `s-v${i}`)
    }
    const slice = [root, focus, ...holders, ...leaves]
    // the shuffle: reverse the LEAF tail (the last `leaves.length` members)
    const shuffled = [...slice.slice(0, slice.length - leaves.length), ...[...leaves].reverse()]
    expect(sliceIds(shuffled), 'the shuffled arm must ACTUALLY differ in order').not.toEqual(sliceIds(slice))
    const base = focus.compile(slice)
    const other = focus.compile(shuffled)
    const a = perNodeProjection(base)
    const b = perNodeProjection(other)
    expect([...b.keys()].sort()).toEqual([...a.keys()].sort())
    for (const id of a.keys()) expect(b.get(id), `per-node parity for ${id}`).toEqual(a.get(id))
    expect(other.dropped.map(d => ({ arm: [...d.arm], reason: d.reason }))).toEqual(base.dropped.map(d => ({ arm: [...d.arm], reason: d.reason })))
    expect(other.warnings.map(w => ({ ...w }))).toEqual(base.warnings.map(w => ({ ...w })))
  })

  it('FRS-5c the reordered slice does NOT renumber the fork keys (arm identity is descent-keyed)', () => {
    const t = buildOrderTree()
    const base = t.focus.compile(t.slice)
    const reversed = [...t.slice].reverse()
    expect(sliceIds(reversed)).not.toEqual(sliceIds(t.slice))
    const other = t.focus.compile(reversed)
    expect(
      other.actionable.filter(s => s.nodeId === t.focus.id).map(s => s.pathKey),
      'the arm keys are keyed by the DESCENT owner, never by the slice index',
    ).toEqual(base.actionable.filter(s => s.nodeId === t.focus.id).map(s => s.pathKey))
  })
})

// ============================================================================
// 10. FRS-6 — no descent past an out-of-slice child + BOTH anti-vacuity controls
// ============================================================================

describe('FRS-6 — no descent past an out-of-slice child (S1) — GREEN post-change, both directions asserted', () => {
  it('FRS-6a FS-3 (S1): the out-of-slice subtrees under IN-slice nodes are NOT ENTERED', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const inSlice = new Set(sliceIds(slice))
    const { probe } = underProbe(() => t.focus.compile(slice))
    // the walk's ENTERED set: `children` is read on a node only when the code
    // enumerates that node's child list — the pre-change walk read the lists of
    // g, g2 (under the in-slice x) and y, y2 (under the in-slice focus)
    const outside = [...probe.readOwners].filter(id => !inSlice.has(id)).sort()
    expect(
      outside,
      `the walk ENTERED out-of-slice subtree(s): [${outside.join(', ')}] — a descent past an out-of-slice child reads that child's \`children\` (pre-change: [g, g2, y, y2]; the out-of-slice children are still ENUMERATED as elements of an in-slice child list, which S1 does not forbid)`,
    ).toEqual([])
    // the same statement per node, so a failure names the exact offender
    for (const id of [t.y.id, t.g.id, t.g2.id, t.y2.id]) {
      expect([...probe.readOwners].includes(id), `\`children\` of out-of-slice ${id} must never be read`).toBe(false)
    }
  })

  it('FRS-6b the arms are produced ONLY by in-slice providers, in the descent order (h3 IS a slice member)', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const viable = new Set(sliceIds(slice))
    // THE ORACLE (the pre-change traversal shape over the slice's own viable
    // set): its hits are exactly the two IN-SLICE providers — x2 (the in-slice
    // child of x) and h3 (a SLICE MEMBER: `openSlice` drops only g/g2/y/y2, so
    // FRS-2a's `descendantsOutsideSlice === ['g','y']` is the authority here;
    // h1/h2/h3 are reached THROUGH the in-slice z→h1→h2 path).
    const oracle = oracleArmsFor(t.focus, 'slot', slice, viable)
    expect(oracle.hitOwners).toEqual(['h3', 'x2'])
    expect(oracle.hitOwners.every(id => viable.has(id)), 'every hit owner must be a slice member').toBe(true)
    const { probe, value: res } = underProbe(() => t.focus.compile(slice))
    const st = res.actionable.filter(s => s.nodeId === t.focus.id)
    expect(st.map(s => s.pathKey)).toEqual(oracle.pathKeys)
    expect(st.map(s => s.bindings['slot'])).toEqual(oracle.bindings)
    // no arm may be sourced from an out-of-slice provider
    expect(
      st.map(s => s.bindings['slot']).filter(v => v === 'slot-g' || v === 'slot-y2'),
      `arms=[${st.map(s => s.bindings['slot']).join(', ')}] — the out-of-slice providers g/y2 must not be consulted`,
    ).toEqual([])
    // THE CLAUSE THE PRE-CHANGE WALK FALSIFIES: the walk enters no out-of-slice
    // subtree. (Stated here as well as in FRS-6a because the arm clause ALONE
    // does not discriminate pre- from post-change on this fixture — see the note.)
    expect(
      [...probe.readOwners].filter(id => !viable.has(id)).sort(),
      'the walk ENTERED an out-of-slice node while producing these arms',
    ).toEqual([])
    // ── NOT-DISCRIMINATING NOTE (recorded, not hidden) ─────────────────────
    // The arm set/order above reads the SAME before and after the engine change:
    // an out-of-slice node can never be VIABLE (`viable ⊆ slice`, node.ts:1119-
    // 1160), so the pre-change walk found no hit in g/y2 either — it entered
    // them and found nothing. What the arm clause DOES falsify is the too-tight
    // and slice-list confinements: a direct-children-only walk misses h3 (FRS-6c
    // is its control), and a naive slice-array scan yields [x2, h3] instead of
    // the descent order [h3, x2] (FRS-4b/FRS-2f are its controls). The
    // pre/post-change discrimination for THIS fixture is the ENTERED-set clause
    // above, which is why it is asserted in the same case.
  })

  it('FRS-6c FS-5 anti-vacuity (direction 2): the walk DOES descend through an in-slice NON-provider to a DEEP in-slice provider', () => {
    // A slice-list scan cannot produce this, nor can a walk that stops at the
    // first non-provider child: the provider sits two levels below the focus,
    // behind a child that is not itself a provider.
    const root = makeRoot({ type: 'div' }, 'vi-root')
    const focus = childOf(root, makeNode({ type: 'div' }, 'vi-focus'), 0)
    targetAnchor(focus, 'slot')
    const mid = childOf(focus, makeNode({ type: 'div' }, 'vi-mid'), 0) // NOT a provider
    const deep = childOf(mid, makeNode({ type: 'p' }, 'vi-deep'), 0) // the provider
    addComponentSource(deep, 'slot', 'deep-value')
    const slice = [root, focus, mid, deep]
    const st = focus.compile(slice).actionable.find(s => s.nodeId === focus.id)!
    expect(st.bindings['slot'], 'the walk must descend to a DEEP in-slice provider').toBe('deep-value')
    // (b) the CONTROL: an implementation consulting only the focus's DIRECT
    //     children must FAIL — proving the assertion above can fail.
    expect([...focus.children].flatMap(c => providersOn(c, 'slot')), 'the direct-children-only control must MISS the deep provider').toEqual([])
    // (c) and the descent oracle finds it, so the engine is not special-cased
    expect(descendantHits(focus, 'slot', new Set(sliceIds(slice))).map(h => h.owner.id)).toEqual(['vi-deep'])
  })

  it('FRS-6d the descent reads the LIVE `children` accessor (S1 fact 4 — no cached child list)', () => {
    const t = buildGoldenTree()
    const before = sliceIds(t.x.children)
    const { probe } = underProbe(() => t.focus.compile(openSlice(t)))
    expect(probe.owners.filter(id => id === 'x').length, 'x’s children were read by the walk').toBeGreaterThan(0)
    expect(sliceIds(t.x.children)).toEqual(before)
  })
})

// ============================================================================
// 11. FRS-7 — the structural saving (relational children-count drop) — GREEN
// ============================================================================

describe('FRS-7 — the scope change is STRUCTURAL: the descendant walk’s `children` reads drop on the same input (S1/S4-a) — GREEN post-change', () => {
  it('FRS-7a the bounded walk reads strictly fewer `children` than the unbounded walk on the SAME slice', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const sliceSet = new Set(sliceIds(slice))
    const before = unboundedChildrenCalls(slice)
    const after = boundedChildrenCalls(slice, sliceSet)
    expect(after, 'a structurally narrower traversal must read strictly fewer children').toBeLessThan(before)
    expect(unboundedVisited(t.x).filter(id => !sliceSet.has(id)), 'the skipped subtree is the OUT-OF-SLICE one').toEqual(['g', 'g2'])
  })

  it('FRS-7b the CODE’s own `children` reads during the compile drop below the unbounded operand', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const sliceSet = new Set(sliceIds(slice))
    // (1) the code under test
    const code = underProbe(() => t.focus.compile(slice))
    // (2) the unbounded operand through the SAME instrumentation: one arm
    //     invocation per slice node (`resolveNames` loops the visible nodes),
    //     each reading `[...node.children]` then `...d.children` per popped node
    const oracle = underProbe(() => {
      for (const n of slice) {
        void n.children
        for (const d of unboundedVisitedNodes(n)) void d.children
      }
    })
    const oracleOwners = oracle.probe.owners.filter(id => sliceSet.has(id))
    // the instrumented operand's own count (a read means the walk ENTERED that
    // node — the read-owner set, which is the S1 observable)
    expect(oracleOwners.length, 'the instrumented operand must have read children').toBeGreaterThan(0)
    expect(
      code.probe.calls,
      `the compile's \`children\` reads (${code.probe.calls}) must be BELOW the unbounded walk's reads (${oracleOwners.length}) — equality means the scope change did not happen; the unbounded walk additionally reads the out-of-slice [g, g2] under x and the whole y subtree under focus`,
    ).toBeLessThan(oracleOwners.length)
    // and the code reads are confined to slice members (a stronger statement
    // than the count): no `children` of an out-of-slice node is ever read
    expect([...code.probe.owners].filter(id => !sliceSet.has(id))).toEqual([])
  })

  it('FRS-7c the measurement is reproducible: both operands are stable across repeats', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const sliceSet = new Set(sliceIds(slice))
    expect(unboundedChildrenCalls(slice)).toBe(unboundedChildrenCalls(slice))
    expect(boundedChildrenCalls(slice, sliceSet)).toBe(boundedChildrenCalls(slice, sliceSet))
    expect(boundedChildrenCalls(slice, sliceSet)).toBeLessThan(unboundedChildrenCalls(slice))
  })
})

// ============================================================================
// 12. THE GENERATED FAMILY + the placement-routed fixture
// ============================================================================

interface GeneratedTree { root: NodeType; focus: NodeType; slice: NodeType[]; all: NodeType[] }

function makeHub(): LinkConfigNameHub {
  const m = new Map<string, Link>()
  return {
    linkFor(name: string, kind: 'component' | 'placement'): Link {
      const key = `${kind}:${name}`
      let l = m.get(key)
      if (!l) { l = new Link({ name: kind }); m.set(key, l) }
      return l
    },
  }
}

/** The seeded shape family of §5 P-IM-1: a root + `zones ∈ [2,4]` sibling zones
 *  + a chain of `depth ∈ [3,7]` levels ending in the TARGET-bearing focus +
 *  `providers ∈ [1,4]` same-name providers distributed across ≥2 sibling
 *  subtrees of the focus + an own-anchor name consumed by the focus + an
 *  ancestor-provided name consumed by a sibling of the focus + a hub-answered
 *  placement-routed node in the focus's subtree. The slice is the whole tree
 *  (descendant-closed — the engine's real shape), so the parity oracle is
 *  meaningful. */
function buildGeneratedTree(attempt: number, zones: number, depth: number, providers: number): GeneratedTree {
  const hub = makeHub()
  const tag = (s: string): string => `g${attempt}-${s}`
  const root = makeRoot({ type: 'div' }, tag('root'))
  const all: NodeType[] = [root]
  const zoneNodes: NodeType[] = []
  for (let k = 0; k < zones; k += 1) { const z = childOf(root, makeNode({ type: 'div' }, tag(`zone${k}`)), k); zoneNodes.push(z); all.push(z) }
  // the target-bearing chain
  let cur = zoneNodes[0]!
  for (let d = 1; d < depth; d += 1) { const n = childOf(cur, makeNode({ type: 'div' }, tag(`lvl${d}`)), 0); all.push(n); cur = n }
  const focus = childOf(cur, makeNode({ type: 'div' }, tag('focus')), 0)
  all.push(focus)
  targetAnchor(focus, 'slot')
  // the same-name provider subtrees
  const subtreeCount = Math.min(4, Math.max(2, providers))
  const holders: NodeType[] = []
  for (let s = 0; s < subtreeCount; s += 1) { const h = childOf(focus, makeNode({ type: 'div' }, tag(`sub${s}`)), s); holders.push(h); all.push(h) }
  for (let p = 0; p < providers; p += 1) {
    const leaf = childOf(holders[p % holders.length]!, makeNode({ type: 'p' }, tag(`prov${p}`)), p)
    all.push(leaf)
    addComponentSource(leaf, 'slot', tag(`v${p}`))
  }
  // (ii) an own-anchor name consumed by the focus itself
  const ownName = tag('own')
  addComponentSource(focus, ownName, tag('ownv'))
  targetAnchor(focus, ownName)
  // (iii) an ancestor-provided name: a provider node whose CHILD consumes it —
  // the provider is an ancestor of the consumer, and IS a slice member
  const ancProvider = childOf(root, makeNode({ type: 'p' }, tag('ancprov')), zones)
  all.push(ancProvider)
  const ancName = tag('ancname')
  addComponentSource(ancProvider, ancName, tag('ancv'))
  const ancConsumer = childOf(ancProvider, makeNode({ type: 'div' }, tag('ancconsumer')), 0)
  all.push(ancConsumer)
  targetAnchor(ancConsumer, ancName)
  // (iv) the placement-routed node: a hub-answered placement link whose content
  // anchor rides the focus's subtree (so `focusedSliceFor` does not sweep)
  const plName = tag('plzone')
  const plLink = hub.linkFor(plName, 'placement')
  root.addAnchor('container', plName as unknown as never, {}, plLink)
  const plNode = childOf(focus, makeNode({ type: 'div' }, tag('plnode')), 9)
  all.push(plNode)
  plNode.addAnchor('content', plName as unknown as never, {}, plLink)
  // (v) a non-viable same-name provider: an UNPLACED node with a source anchor,
  // created AFTER the slice is taken — it is therefore reachable by the walk but
  // NOT a slice member (`viable ⊆ slice` ⇒ it can contribute nothing), and it is
  // also the FRS-1/P-IM-1 liveness shape ("the unbounded walk reaches a node
  // outside the slice")
  const unplaced = makeNode({ type: 'section' }, tag('unplaced'))
  childOf(focus, unplaced, 4)
  addComponentSource(unplaced, 'slot', tag('unplacedv'))
  const slice = dedupe(all)
  return { root, focus, slice, all: slice }
}

function dedupe(nodes: readonly NodeType[]): NodeType[] {
  const seen = new Set<NodeId>()
  const out: NodeType[] = []
  for (const n of nodes) {
    if (seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
  }
  return out
}

/** The placement-routed fixture (§5 P-IM-1's placement shape): the focus
 *  carries a `content` anchor on a HUB-answered placement link (so
 *  `focusedSliceFor` answers from the hub and does not sweep) plus a descendant
 *  provider, and the root carries the matching `container` anchor. */
function buildPlacementRouted(): { root: NodeType; focus: NodeType; slice: NodeType[] } {
  const hub = makeHub()
  const root = new Node({ type: 'div' }, hub, 'pl-root')
  root.addAnchor('parent', root as unknown as never, {}, new Link({ name: 'parent-child' }))
  const zone = childOf(root, new Node({ type: 'section' }, hub, 'pl-zone'), 0)
  const focus = childOf(zone, new Node({ type: 'div' }, hub, 'pl-focus'), 0)
  const plLink = hub.linkFor('zone-a', 'placement')
  root.addAnchor('container', 'zone-a' as unknown as never, {}, plLink)
  focus.addAnchor('content', 'zone-a' as unknown as never, {}, plLink)
  targetAnchor(focus, 'slot')
  const p1 = childOf(focus, new Node({ type: 'p' }, hub, 'pl-p1'), 0)
  addComponentSource(p1, 'slot', 'pl-v1')
  return { root, focus, slice: [root, zone, focus, p1] }
}

// ============================================================================
// 13. FRS-8 — the seven-row register report (P-IM-1..5, P-TP-1, P-SM-1)
//
// POST-LANDING STATUSES (the engine change + the measurement pass have landed):
//   P-IM-1..P-IM-5 HELD, P-TP-1 HELD, P-SM-1 UNDETERMINED-BECAUSE-DELEGATED
//   (its observable is the harness's printed S4 set, which only the serialised
//   smoke-ops phase can hold; this file asserts the LIVE pointer to its owner,
//   FRS-B, and never reports HELD without a clause it can actually fire).
// Pre-change the split was: P-IM-2 EXPECTED-RED (the walk entered out-of-slice
// nodes) + P-SM-1 EXPECTED-RED (no measurement set) + the other five HELD.
// ============================================================================

type RowStatus = 'HELD' | 'FAILED' | 'UNDETERMINED' | 'EXPECTED-RED'

interface RowReport {
  id: string
  kind: 'P-IM' | 'P-SM' | 'P-TP'
  strategy: string
  status: RowStatus
  attempts: number
  failures: number
  liveness: string
  counterexample: string
  antiVacuity: string
}

const registerRows: RowReport[] = []

/** §5's per-row reporting rule: every row REPORTS (id / kind / strategy /
 *  status / attempts / failures / row-scoped liveness / counterexample /
 *  anti-vacuity) BEFORE its assertions run. */
function reportRow(row: RowReport): void {
  registerRows.push(row)
  console.log(
    `[register] id=${row.id} kind=${row.kind} strategy=${row.strategy} status=${row.status} attempts=${row.attempts} failures=${row.failures} liveness=${row.liveness} anti-vacuity=${row.antiVacuity} counterexample=${row.counterexample}`,
  )
}

// P-TP-1's register row — REPORTED AT COLLECTION TIME (its fixtures are fixed,
// not generated, so the row's static shape is knowable without running the
// emitter; its MEASURED assertions in §14 flip it to FAILED if they break).
// Reporting it here keeps the whole seven-row register complete when the FRS-8
// assertions read it.
reportRow({
  id: 'P-TP-1', kind: 'P-TP', strategy: 'fixed fixtures: goldens + emitElements → diffMinimal → applyOps identity',
  status: 'HELD', attempts: 2, failures: 0,
  liveness: 'the fixed fixture set (plain nested tree + multi-provider fork + placement-routed shape) compiles and emits; the first render produces a non-empty op list',
  counterexample: 'none',
  antiVacuity: 'the first render must produce a NON-empty op list and the changed-input control (P-TP-1d) a non-empty diff; else the zero-op assertion is vacuous',
})

describe('FRS-8 — the typed property register report (§5; P-IM-1..5, P-TP-1, P-SM-1)', () => {
  it('FRS-8a P-IM-1 (parity) reports HELD with its liveness constructed by the generator', () => {
    const rand = makeRand(PINNED_SEED ^ 0x2)
    let attempts = 0
    let failures = 0
    let multiProvider = 0
    let oversized = 0
    const counterexamples: string[] = []
    for (let i = 0; i < ATTEMPTS_PER_ROW_CAP; i += 1) {
      attempts += 1
      const t = buildGeneratedTree(i, rand.int(2, 4), rand.int(3, 7), rand.int(1, 4))
      const oracle = oracleArmsFor(t.focus, 'slot', t.slice, new Set(sliceIds(t.slice)))
      if (oracle.hitOwners.length >= 2) multiProvider += 1
      if (unboundedVisited(t.focus).some(id => !sliceSetHas(t.slice, id))) oversized += 1
      const res = t.focus.compile(t.slice)
      const arms = res.actionable.filter(s => s.nodeId === t.focus.id)
      const ok = JSON.stringify(arms.map(s => s.pathKey)) === JSON.stringify(oracle.pathKeys)
        && JSON.stringify(arms.map(s => s.bindings['slot'])) === JSON.stringify(oracle.bindings)
        && res.dropped.length === 0
      if (!ok) { failures += 1; if (counterexamples.length < COUNTEREXAMPLE_STOP) counterexamples.push(`attempt ${i}`) }
      if (failures >= COUNTEREXAMPLE_STOP) break
    }
    reportRow({
      id: 'P-IM-1', kind: 'P-IM', strategy: 'generated family (zones 2..4 × depth 3..7 × providers 1..4)',
      status: failures > 0 ? 'FAILED' : (multiProvider > 0 && oversized > 0 ? 'HELD' : 'UNDETERMINED'),
      attempts, failures,
      liveness: `multi-provider attempts=${multiProvider}, unbounded-walk-exceeds-slice attempts=${oversized}`,
      counterexample: counterexamples.join('; ') || 'none',
      antiVacuity: '≥1 multi-provider attempt + ≥1 oversized-walk attempt required for HELD; else UNDETERMINED',
    })
    expect(failures, 'P-IM-1 parity failures').toBe(0)
    expect(multiProvider, 'P-IM-1 liveness').toBeGreaterThan(0)
    expect(oversized, 'P-IM-1 liveness').toBeGreaterThan(0)
  })

  it('FRS-8b P-IM-2 (scope) reports HELD with its falsification live', () => {
    const t = buildGoldenTree()
    const slice = openSlice(t)
    const inSlice = new Set(sliceIds(slice))
    const { probe } = underProbe(() => t.focus.compile(slice))
    // THE S1 OBSERVABLE: the ids whose `children` was READ (the nodes the walk
    // ENTERED). The yielded set is measured too — it is NON-empty outside the
    // slice by necessity and is the row's discrimination proof, never its
    // failure condition.
    const readOutside = [...probe.readOwners].filter(id => !inSlice.has(id)).sort()
    const yieldedOutside = [...probe.yielded].filter(id => !inSlice.has(id)).sort()
    const failures = readOutside.length > 0 ? 1 : 0
    reportRow({
      id: 'P-IM-2', kind: 'P-IM', strategy: 'open slice + test-local `children` accessor wrapper (READ-OWNER observable)',
      status: failures > 0 ? 'EXPECTED-RED' : 'HELD', attempts: 1, failures,
      liveness: `wrapped \`children\` reads=${probe.calls} (the spy fired), read-owners outside the slice=[${readOutside.join(', ')}] (none), out-of-slice children ENUMERATED by those reads=[${yieldedOutside.join(', ')}] (not descended into)`,
      counterexample: failures > 0 ? `the walk ENTERED out-of-slice node(s) [${readOutside.join(', ')}] under the in-slice focus/x` : 'none',
      antiVacuity: 'the read-owner assertion cannot be vacuous: the yielded-outside set is non-empty (S1 forbids the descent, not the enumeration), the strict-subset control FRS-2d shows the operand enters [g, g2, y, y2], and a too-tight walk is caught by FRS-6c',
    })
    // THE SCOPE ASSERTION (S1): the walk enters no node outside the slice. RED on
    // the pre-change walk (it entered [g, g2, y, y2]); GREEN under the landed
    // confined walk.
    expect(
      readOutside,
      `P-IM-2: the walk read the \`children\` of out-of-slice node(s) [${readOutside.join(', ')}] — reading a child list IS entering that subtree. read-owners=[${[...probe.readOwners].sort().join(', ')}], wrapped children reads=${probe.calls}, out-of-slice children enumerated=[${yieldedOutside.join(', ')}]`,
    ).toEqual([])
    // the row's own liveness statement, asserted (§5: a row that asserts a
    // NEGATIVE must carry the positive control that proves the observable can fire)
    expect(
      yieldedOutside,
      'anti-vacuity: the walk MUST have enumerated the out-of-slice children (they are elements of an in-slice node’s live child list) — an empty set here would make the read-owner assertion measure nothing',
    ).toEqual(['g', 'y'])
  })

  it('FRS-8c P-IM-3 (hit order) reports HELD with the naive control live', () => {
    const t = buildOrderTree()
    const oracle = oracleArmsFor(t.focus, 'slot', t.slice, new Set(sliceIds(t.slice)))
    const dfs = oracle.hitOwners
    const naive = t.slice.filter(n => providersOn(n, 'slot').length > 0).map(n => n.id)
    const differs = JSON.stringify(naive) !== JSON.stringify(dfs)
    const arms = t.focus.compile(t.slice).actionable.filter(s => s.nodeId === t.focus.id)
    const parity = JSON.stringify(arms.map(s => s.pathKey)) === JSON.stringify(oracle.pathKeys)
    reportRow({
      id: 'P-IM-3', kind: 'P-IM', strategy: 'two-sibling-subtree construction + naive slice-list control',
      status: parity && differs ? 'HELD' : (parity ? 'UNDETERMINED' : 'FAILED'),
      attempts: 1, failures: parity ? 0 : 1,
      liveness: `naive control differs=${differs} (naive=[${naive.join(', ')}] vs descent=[${dfs.join(', ')}])`,
      counterexample: parity ? 'none' : 'the arm-key sequence differs from the descent sequence',
      antiVacuity: 'the naive control must differ on the SAME input; else UNDETERMINED (never HELD)',
    })
    expect(parity).toBe(true)
    expect(differs, 'the naive control must discriminate').toBe(true)
  })

  it('FRS-8d P-IM-4 (no provider loss) reports HELD with every case shown to resolve', () => {
    const cases: Array<{ name: string; live: boolean }> = []
    // (i) own
    {
      const root = makeRoot({ type: 'div' }, 'r4i-root')
      const f = childOf(root, makeNode({ type: 'div' }, 'r4i-f'), 0)
      targetAnchor(f, 'slot'); addComponentSource(f, 'slot', 'v')
      cases.push({ name: 'own', live: f.compile([root, f]).actionable.some(s => s.bindings['slot'] !== undefined) })
    }
    // (ii) descendant
    {
      const root = makeRoot({ type: 'div' }, 'r4ii-root')
      const f = childOf(root, makeNode({ type: 'div' }, 'r4ii-f'), 0)
      targetAnchor(f, 'slot')
      const kid = childOf(f, makeNode({ type: 'p' }, 'r4ii-k'), 0)
      addComponentSource(kid, 'slot', 'v')
      cases.push({ name: 'descendant', live: f.compile([root, f, kid]).actionable.some(s => s.bindings['slot'] !== undefined) })
    }
    // (iii) a provider that is a DESCENDANT OF A SLICE ANCESTOR other than focus
    {
      const root = makeRoot({ type: 'div' }, 'r4iii-root')
      const a = childOf(root, makeNode({ type: 'div' }, 'r4iii-a'), 0)
      const aProv = childOf(a, makeNode({ type: 'p' }, 'r4iii-p'), 0)
      addComponentSource(a, 'slot', 'v')
      const branch = childOf(a, makeNode({ type: 'div' }, 'r4iii-b'), 1)
      const f = childOf(branch, makeNode({ type: 'div' }, 'r4iii-f'), 0)
      targetAnchor(f, 'slot')
      const slice = [root, a, aProv, branch, f]
      const st = f.compile(slice).actionable.find(s => s.nodeId === f.id)
      expect(sliceIds(slice)).toContain(a.id)
      // the provider is on the slice ANCESTOR `a`, reached via the ANCESTOR arm
      // (a is viable and a slice member) — never by descending from `f`'s own
      // subtree, which is what a slice-list scanner would substitute
      expect(descendantHits(f, 'slot', new Set(sliceIds(slice))), 'the consumer’s own subtree provides nothing').toEqual([])
      expect(providersOn(a, 'slot').map(h => h.owner.id), 'the provider anchor is on the slice ANCESTOR `a` itself').toEqual([a.id])
      expect(descendantHits(a, 'slot', new Set(sliceIds(slice))), 'no descendant of `a` provides it either').toEqual([])
      expect(st?.bindings['slot'], 'the ANCESTOR arm resolves it').toBe('v')
      cases.push({ name: 'ancestor-descendant', live: st?.bindings['slot'] !== undefined })
    }
    // (iv) private-link hub-less (the sweep)
    {
      const root = makeRoot({ type: 'div' }, 'r4iv-root')
      const f = childOf(root, makeNode({ type: 'div' }, 'r4iv-f'), 0)
      targetAnchor(f, 'slot')
      const kid = childOf(f, makeNode({ type: 'p' }, 'r4iv-k'), 0)
      addComponentSource(kid, 'slot', 'v')
      const slice = focusedSliceFor(f, [root, f, kid])
      cases.push({ name: 'hub-less-private-link', live: f.compile(slice).actionable.some(s => s.bindings['slot'] !== undefined) })
    }
    // (v) non-viable same-name provider ⇒ the fallback's term outcome only
    {
      const root = makeRoot({ type: 'div' }, 'r4v-root')
      const f = childOf(root, makeNode({ type: 'div' }, 'r4v-f'), 0)
      targetAnchor(f, 'slot')
      const dead = childOf(f, makeNode({ type: 'p' }, 'r4v-dead'), 0)
      addComponentSource(dead, 'slot', 'v')
      dead.markDestroyed()
      const res = f.compile([root, f, dead])
      cases.push({ name: 'non-viable-term-only', live: res.dropped.some(d => d.arm.includes(f.id)) && res.actionable.every(s => s.nodeId !== f.id) })
    }
    const dead = cases.filter(c => !c.live).map(c => c.name)
    reportRow({
      id: 'P-IM-4', kind: 'P-IM', strategy: 'five minimal cases (own / descendant / ancestor-descendant / private-link / non-viable)',
      status: dead.length === 0 ? 'HELD' : 'UNDETERMINED',
      attempts: cases.length, failures: dead.length,
      liveness: `cases resolving before the change: ${cases.map(c => `${c.name}=${c.live}`).join(', ')}`,
      counterexample: dead.join(', ') || 'none',
      antiVacuity: 'every case must be non-empty (resolving/terminating) on the baseline; else UNDETERMINED',
    })
    expect(dead, 'every P-IM-4 case must be shown to resolve BEFORE the change').toEqual([])
  })

  it('FRS-8e P-IM-5 (determinism) reports HELD with an actually-shuffled arm', () => {
    // FLAT fixture (same reason as FRS-5b): the shufflable tail is the provider
    // leaves, so a real order change cannot perturb the chain classification.
    const root = makeRoot({ type: 'div' }, 's8-root')
    const focus = childOf(root, makeNode({ type: 'div' }, 's8-focus'), 0)
    targetAnchor(focus, 'slot')
    const holders: NodeType[] = []
    const leaves: NodeType[] = []
    for (let i = 0; i < 4; i += 1) {
      const h = childOf(focus, makeNode({ type: 'div' }, `s8-h${i}`), i)
      holders.push(h)
      const l = childOf(h, makeNode({ type: 'p' }, `s8-p${i}`), 0)
      leaves.push(l)
      addComponentSource(l, 'slot', `s8-v${i}`)
    }
    const slice = [root, focus, ...holders, ...leaves]
    const shuffled = [...slice.slice(0, slice.length - leaves.length), ...[...leaves].reverse()]
    const a = project(focus.compile(slice))
    const b = project(focus.compile(slice))
    const reallyShuffled = JSON.stringify(sliceIds(shuffled)) !== JSON.stringify(sliceIds(slice))
    const base = perNodeProjection(focus.compile(slice))
    const c = perNodeProjection(focus.compile(shuffled))
    const distinctNodes = base.size
    let perNodeOk = true
    for (const id of base.keys()) if (JSON.stringify(c.get(id)) !== JSON.stringify(base.get(id))) perNodeOk = false
    const same = JSON.stringify(a) === JSON.stringify(b)
    reportRow({
      id: 'P-IM-5', kind: 'P-IM', strategy: 'compile ×2 + reversal of the provider-leaf tail of the flat fixture',
      status: same && perNodeOk && reallyShuffled && distinctNodes >= 2 ? 'HELD' : 'UNDETERMINED',
      attempts: 3, failures: same && perNodeOk ? 0 : 1,
      liveness: `shuffle actually reordered=${reallyShuffled}, distinct nodes with states=${distinctNodes}`,
      counterexample: perNodeOk ? 'none' : 'the per-node projection moved under a reorder',
      antiVacuity: 'the shuffled arm must ACTUALLY differ and ≥2 nodes must carry states; else UNDETERMINED',
    })
    expect(same).toBe(true)
    expect(perNodeOk).toBe(true)
    expect(reallyShuffled).toBe(true)
    expect(distinctNodes).toBeGreaterThanOrEqual(2)
  })

  it('FRS-8f P-SM-1 (the measured acceptance) reports its DELEGATION to the record suite — the harness-owned observable is not reachable from this phase', () => {
    // P-SM-1's property is "the S4 measurement set is produced and reported".
    // Its OBSERVABLE is the harness's printed lines, which only the serialised
    // smoke-ops phase can hold (the phase rule forbids this file from spawning
    // the smoke), so the row's owner is FRS-B
    // (`tests/unit/pass2-fit-reference-scope-measurement.test.ts`, registered in
    // `SMOKE_SPAWNING_TEST_FILES` and therefore run by plain `npm test`). This
    // file reports the row as UNDETERMINED-with-a-live-pointer: it cannot
    // establish the property itself, and §5 forbids a HELD row without a live
    // clause. The row's pointer clause is REAL (a missing owner file fails the
    // case) — an inert marker that can never fire would be the "spy that cannot
    // fail" defect the §5 anti-vacuity rule exists to prevent.
    const ownerRel = 'tests/unit/pass2-fit-reference-scope-measurement.test.ts'
    const ownerAbs = fileURLToPath(new URL(`../unit/pass2-fit-reference-scope-measurement.test.ts`, import.meta.url))
    const ownerExists = existsSync(ownerAbs)
    reportRow({
      id: 'P-SM-1', kind: 'P-SM', strategy: 'harness probe (FRS-B / tests/unit/pass2-fit-reference-scope-measurement.test.ts) — DELEGATED: this file cannot observe harness stdout',
      status: ownerExists ? 'UNDETERMINED' : 'FAILED', attempts: 1, failures: ownerExists ? 0 : 1,
      liveness: `the record suite (P-SM-1's owner) exists=${ownerExists} and is phase-registered, so plain \`npm test\` runs it in the serialised smoke-ops phase, where the [compile] census, the printed [runtime-fork:growth] growth envelope (both depths' pass-2/total readings, the pass2-ratio, the bound and the margin) with its offline falsifier, the derived-family pins and the Δpass-2 series are produced and asserted`,
      counterexample: ownerExists ? 'none — undetermined here BY SCOPE (the observable is harness stdout, unreachable from the parallel phase), never silently dropped: the owner exists and is executed' : `the record suite ${ownerRel} is MISSING — the row has no live owner and must fail`,
      antiVacuity: 'the pointer must be LIVE: the owner file must exist (asserted below); the harness-side clauses (both growth-envelope operands positive, the printed ratio derived from those operands, the 10× bound with its printed margin, the offline breach falsifier, the ordered entry log carrying runtime-fork-growth-guard PASSING, the informational-only cross-family print, the 2.5× pins) are asserted by the owner itself',
    })
    // the live pointer clause (§5: a row asserting a negative must prove its
    // observable can fire — here: the owner it delegates to must be present)
    expect(ownerExists, `P-SM-1's owner ${ownerRel} must exist — its evidence set is produced there, in the serialised smoke-ops phase`).toBe(true)
  })

  it('FRS-8g the register report is well-formed: ≤8 rows, P-IM/P-SM/P-TP only, no HELD without liveness', () => {
    const report = registerRows
    console.log(`[register-summary] seed=0x${PINNED_SEED.toString(16)} rows=${report.length} attempts=${report.reduce((a, r) => a + r.attempts, 0)} total-cap=${REGISTER_TOTAL_CAP} per-row-cap=${ATTEMPTS_PER_ROW_CAP}`)
    for (const r of report) console.log(`[register] ${r.id} ${r.kind} status=${r.status} attempts=${r.attempts} failures=${r.failures}`)
    // the complete register is asserted in FRS-8h; here the row set must be the
    // seven contract rows (P-TP-1 reports at collection time, so it is present)
    expect(report.map(r => r.id).sort()).toEqual(['P-IM-1', 'P-IM-2', 'P-IM-3', 'P-IM-4', 'P-IM-5', 'P-SM-1', 'P-TP-1'])
    for (const r of report) {
      expect(['P-IM', 'P-SM', 'P-TP']).toContain(r.kind)
      expect(r.id.startsWith('F-'), 'no F- rows are permitted').toBe(false)
      expect(r.attempts).toBeLessThanOrEqual(ATTEMPTS_PER_ROW_CAP)
      if (r.status === 'HELD') {
        expect(r.liveness.length, `${r.id} reported HELD with an empty liveness clause`).toBeGreaterThan(20)
        expect(r.liveness, `${r.id} reported HELD while its liveness clause is inert`).not.toMatch(/=(0|false)\b/)
      }
    }
    expect(report.reduce((a, r) => a + r.attempts, 0)).toBeLessThanOrEqual(REGISTER_TOTAL_CAP)
    expect(wrappersInstalledCount, 'the register suite must have exercised the accessor wrapper').toBeGreaterThan(0)
  })

  it('FRS-8h the COMPLETE seven-row register (after P-TP-1 has reported): ≤8 rows, no F- rows, no HELD without liveness', () => {
    const report = registerRows
    expect(report.length).toBeLessThanOrEqual(8)
    expect(report.map(r => r.id).sort()).toEqual(['P-IM-1', 'P-IM-2', 'P-IM-3', 'P-IM-4', 'P-IM-5', 'P-SM-1', 'P-TP-1'])
    expect(report.map(r => r.kind)).toContain('P-TP')
    expect(report.filter(r => r.status === 'HELD').length, 'HELD rows must carry their liveness clause').toBeGreaterThan(0)
    for (const r of report) {
      if (r.status !== 'HELD') continue
      expect(r.liveness.length).toBeGreaterThan(20)
      expect(r.liveness).not.toMatch(/=(0|false)\b/)
    }
    expect(report.reduce((a, r) => a + r.attempts, 0)).toBeLessThanOrEqual(REGISTER_TOTAL_CAP)
  })
})

// ============================================================================
// 14. P-TP-1 — the byte-identical default surface (fixed fixtures)
// ============================================================================

describe('P-TP-1 — the byte-identical default surface (S9/S3; render.md DFC-1/PAR-5/R-ORD-8)', () => {
  it('P-TP-1a the emitted elements are byte-identical across two renders, with a ZERO-op second diff', () => {
    const t = buildGoldenTree()
    const slice = closedSlice(t)
    const els1 = emitElements(t.focus.compile(slice).actionable)
    const els2 = emitElements(t.focus.compile(slice).actionable)
    expect(JSON.stringify(els2)).toBe(JSON.stringify(els1))
    const ops1 = diffMinimal(null, els1)
    const state1 = new Map(els1.map(e => [e.wire, e]))
    const ops2 = diffMinimal(state1, els2)
    const row = registerRows.find(r => r.id === 'P-TP-1')!
    row.failures = ops2.length === 0 && ops1.length > 0 ? 0 : 1
    row.status = row.failures === 0 ? 'HELD' : 'FAILED'
    expect(ops1.length, 'the first render must produce ops (else the second-render zero-op check is vacuous)').toBeGreaterThan(0)
    expect(ops2, 'the second render must be a ZERO-op diff (the byte-identical default)').toEqual([])
  })

  it('P-TP-1b the fork-arm wires carry the descent-numbered `#f:` keys (arm identity is unchanged)', () => {
    const t = buildGoldenTree()
    const els = emitElements(t.focus.compile(closedSlice(t)).actionable)
    const armWires = els.filter(e => e.wire.startsWith(`${t.focus.id}#`)).map(e => e.wire)
    expect(armWires).toEqual([`${t.focus.id}#0`, `${t.focus.id}#1`, `${t.focus.id}#2`, `${t.focus.id}#3`])
    for (const e of els.filter(e => e.wire.startsWith(`${t.focus.id}#`))) {
      expect(String(e.forkKey)).toContain('#f:')
      expect(e.forkKey).not.toBe(e.wire)
    }
  })

  it('P-TP-1c the no-clone observables of the fixture stay flat across the pass', () => {
    const t = buildGoldenTree()
    const slice = closedSlice(t)
    const a = t.focus.compile(slice)
    const b = t.focus.compile(slice)
    expect(b.actionable.map(s => s.nodeId)).toEqual(a.actionable.map(s => s.nodeId))
    expect(b.actionable.map(s => [...s.children])).toEqual(a.actionable.map(s => [...s.children]))
    expect(b.actionable.map(s => s.bodyRuns)).toEqual(a.actionable.map(s => s.bodyRuns))
    expect(b.actionable.map(s => s.trace)).toEqual(a.actionable.map(s => s.trace))
  })

  it('P-TP-1d the anti-vacuity control: the diff CAN fire (a changed input is observable)', () => {
    const t = buildGoldenTree()
    const elsA = emitElements(t.focus.compile(closedSlice(t)).actionable)
    const elsB = emitElements(t.focus.compile(openSlice(t)).actionable)
    const stateA = new Map(elsA.map(e => [e.wire, e]))
    expect(elsA, 'the two inputs must differ, else the zero-op control is vacuous').not.toEqual(elsB)
    expect(diffMinimal(stateA, elsB).length, 'the control mutation must produce a NON-empty op list').toBeGreaterThan(0)
  })
})
