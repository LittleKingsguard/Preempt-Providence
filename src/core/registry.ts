// src/core/registry.ts — process-wide node registry + the post-op sweep
// (cascade-destroy + coalesced pass-2). Owns the per-graph sets so the Node
// class stays free of global-state bookkeeping.
//
// MULTI-GRAPH / REGISTRY ISOLATION (D1-D8, docs/specs/multi-graph-isolation-
// spec.md): every set lives on a `GraphScope`. The DEFAULT scope IS the
// current module singleton (D8 — non-breaking: no opt-in is byte-identical
// to today). An ISOLATED scope is created ONLY on explicit host opt-in
// (createIsolatedScope) and is threaded through translateLegacy / Supervisor /
// loadState / renderProducingProcess so a multi-graph host can guarantee two
// graphs in one process cannot address each other. The opt-in, NOT hub
// presence, decides isolation.
//
// Imports Node and Link only as TYPES (erased at runtime), so there is no
// import cycle with node.ts / link.ts.
import type { Node } from './node.js'
import type { Link } from './link.js'
import type { NodeId } from './types.js'

/** A per-graph registry scope: the isolated partition of every registry set
 *  + sweep state. An isolated scope is created only on explicit opt-in; the
 *  default scope IS the module singleton (D8). */
export interface GraphScope {
  registered: Set<Node>
  byId: Map<NodeId, Node>
  handlerDefs: Map<string, HandlerDefRecord>
  translateUserData: unknown
  contentNodes: Set<Node>
  defPrototypes: Map<Link, Node[]>
  defRootPrototypes: Map<Link, Node>
  mintedByLayer: Map<NodeId, string>
  cascadeFlags: Map<Node, { prototypeRooted: boolean }>
  pendingDestroy: Node[]
}

function createScope(): GraphScope {
  return {
    registered: new Set<Node>(),
    byId: new Map<NodeId, Node>(),
    handlerDefs: new Map<string, HandlerDefRecord>(),
    translateUserData: undefined,
    contentNodes: new Set<Node>(),
    defPrototypes: new Map<Link, Node[]>(),
    defRootPrototypes: new Map<Link, Node>(),
    mintedByLayer: new Map<NodeId, string>(),
    cascadeFlags: new Map<Node, { prototypeRooted: boolean }>(),
    pendingDestroy: [],
  }
}

/** The default scope IS the module singleton (D8) — back-compat for every
 *  accessor that takes no scope. */
export const DEFAULT_SCOPE: GraphScope = createScope()

/** Every live scope, for the single coalesced sweep timer (D6). */
const allScopes = new Set<GraphScope>([DEFAULT_SCOPE])

/** Create an isolated scope (the explicit opt-in — D1). A graph rendered
 *  under this scope is fully disjoint from every other scope: it never
 *  resolves, compiles, or destroys another graph's handler defs, nodes, or
 *  userData. */
export function createIsolatedScope(): GraphScope {
  const s = createScope()
  allScopes.add(s)
  return s
}

/** The module-level `registered` export — the DEFAULT scope's set (D8). */
export const registered: Set<Node> = DEFAULT_SCOPE.registered

// HANDLER-SEAM (2026-08-15, D6 un-park) — the legacy handler-def registry:
// def-shaped bindings (`{reference, value: {name, body}}`) register by name at
// translate; the seam materialization resolves them when a consumer's
// `handlers.<event>` binding compiles. Lives here (not node.ts/translate.ts)
// to avoid the node↔translate cycle.
// FORMAT MARKER (decision 4, 2026-08-15) — each def records its data-format
// convention: 'legacy' (the (event, context) bodies — the seam default,
// wrapped by the bridge at materialization) or 'modern' (raw (ctx, ...args)
// bodies, installed unwrapped). The default is applied at registration.
export interface HandlerDefRecord {
  name: string
  body: string
  format: 'legacy' | 'modern'
}

export function registerHandlerDef(name: string, def: { name: string; body: string; format?: 'legacy' | 'modern' }, scope: GraphScope = DEFAULT_SCOPE): void {
  scope.handlerDefs.set(name, { ...def, format: def.format ?? 'legacy' })
}

export function handlerDef(name: string, scope: GraphScope = DEFAULT_SCOPE): HandlerDefRecord | undefined {
  return scope.handlerDefs.get(name)
}

// USERDATA passthrough (decision 6, 2026-08-15) — the legacy bridge's
// read-only `supervisor.userData` member is captured from
// `TranslatedTree.userData` (the first content payload's userData) at
// translate into this per-scope slot. Read at dispatch by the bridge
// context; writes are contained no-ops (no session channel exists).
// D4 — an isolated graph carries its own slot (no single-slot clobber).
export function setTranslateUserData(value: unknown, scope: GraphScope = DEFAULT_SCOPE): void {
  scope.translateUserData = value
}

export function getTranslateUserData(scope: GraphScope = DEFAULT_SCOPE): unknown {
  return scope.translateUserData
}

/** Shared legacy-body compiler (the translate-time `new Function` gate —
 *  admin/trusted-developer bodies only). The seam materialization compiles
 *  def bodies when it layers them onto a consumer. D2 — an isolated scope
 *  never compiles a body it cannot resolve (resolution is scope-local, so
 *  compilation cannot be reached cross-scope). */
export function compileHandlerBody(src: string): (...args: unknown[]) => unknown {
  const fn = new Function(`return (${src})`)()
  if (typeof fn !== 'function') {
    throw new Error(`legacy-handler-body: "${src}" does not evaluate to a function`)
  }
  return fn
}
let sweepScheduled = false

/** REQ-GAP-12 (handoffs-review-2 §REQ-GAP-12, user ruling 1, 2026-08-21) —
 *  the explicit-destroy cascade trigger flag: the supervisor destroy op marks
 *  an EXPLICIT destroy as cascade-capable so `finalizeDestroyed` relaxes the
 *  content exemption for the destroyed node's EXPLICIT (family parent-child)
 *  children — teardown-to-root becomes ONE destroy op for payload trees.
 *  Internal state ONLY: never an op payload, never journaled (replay-safe).
 *  `prototypeRooted`: the destroyed node's family chain terminated at the
 *  'component' token at OP time — its whole family subtree is a def/seam
 *  prototype subtree (never renders). The token edge is dissolved by
 *  destroyLinks before the sweep runs, so the sweep cannot re-derive this
 *  from the node's state — the op captures it. */
export function markCascadeExplicit(node: Node): void {
  // `prototypeRooted` is captured HERE (op time): the token edge is dissolved
  // by destroyLinks before the sweep runs, so the sweep cannot re-derive it.
  // Scoped on the node's OWN graph scope (D6).
  scopeOf(node).cascadeFlags.set(node, { prototypeRooted: chainTerminatesAtComponent(node) })
}

/** REQ-GAP-12 — the placement-owned gate: a node carrying `content` anchors
 *  participates in the placement system (placed, or placement-returnable) —
 *  the placement-may-return persistence letter keeps such nodes alive across
 *  an owner destroy. */
function isPlacementOwned(node: Node): boolean {
  return node.anchors.some(a => a.role === 'content')
}

/** REQ-GAP-12 — does `node`'s family chain terminate at the 'component'
 *  token (a def/seam prototype — never renders)? Walked at OP time (the
 *  destroyed node's token edge is still intact then). */
function chainTerminatesAtComponent(node: Node): boolean {
  const seen = new Set<string>()
  for (let cur: Node | null = node; cur && !seen.has(cur.id); cur = cur.parent) {
    seen.add(cur.id)
    const child = cur.childAnchor()
    if (!child) continue
    const pa = child.link.anchorsOf('parent')[0]
    if (!pa || typeof pa.target !== 'string') continue
    if (pa.target === 'component') return true
    if (pa.target === 'rootNode' || pa.target === 'contentNodes') return false
  }
  return false
}

// Origin tracking: content/component nodes owned by payload arrays are the
// source of truth for graph accessibility (besides the root + template).
// They PERSIST in the background while unplaced (placement may return);
// handler-created nodes (no basis in root/payload arrays) are discarded once
// they lose root visibility. Scoped per graph (D6) via scopeOf(node).

/** The scope a node belongs to (its isolated graph, else the shared default). */
export function scopeOf(node: Node): GraphScope {
  return node.graphScope ?? DEFAULT_SCOPE
}

/** D8/F16 (B2) — the def-children prototype registry: per component LINK, the
 *  pre-minted out-of-tree `'component'`-token prototype nodes minted at
 *  translate for a value-carrying def binding (mint order = def.children
 *  order). The D7 seam materialization (ops.md §2.7 ALS-1) and the emit-side
 *  seam fill read it to wire the def's children onto the seam consumer. */
export function registerDefPrototypes(link: Link, protos: Node[], scope: GraphScope = DEFAULT_SCOPE): void {
  scope.defPrototypes.set(link, protos)
}

export function defPrototypesFor(link: Link, scope: GraphScope = DEFAULT_SCOPE): Node[] {
  return scope.defPrototypes.get(link) ?? []
}

/** D8/ALS-1b (B3) — the def-ROOT prototype registry: per component LINK, the
 *  pre-minted `'component'`-token prototype carrying the def's own root
 *  element (type + css incl. cssDef) with family child links to the
 *  def-children prototypes. The element-level carrier of the def's css —
 *  wired as the seam consumer's child for `children`-targets (SED-2) and
 *  merged into the consumer's element for `type`-targets (SED-1). */
export function registerDefRootPrototype(link: Link, root: Node, scope: GraphScope = DEFAULT_SCOPE): void {
  scope.defRootPrototypes.set(link, root)
}

export function defRootPrototypeFor(link: Link, scope: GraphScope = DEFAULT_SCOPE): Node | undefined {
  return scope.defRootPrototypes.get(link)
}

/** Feature 1a (handoffs-review-5.md — the census emit): READ-ONLY enumerator
 *  over the def-children registry (REQ-GAP-11 discipline — the maps stay
 *  write-private; only reads are exposed). */
export function defPrototypeEntries(scope: GraphScope = DEFAULT_SCOPE): [Link, Node[]][] {
  return [...scope.defPrototypes.entries()]
}

/** Feature 1a — READ-ONLY enumerator over the def-ROOT registry. */
export function defRootPrototypeEntries(scope: GraphScope = DEFAULT_SCOPE): [Link, Node][] {
  return [...scope.defRootPrototypes.entries()]
}

/** Feature 1a (handoffs-review-5.md G2) — recover the registration NAME of a
 *  def Link: the per-name component Link carries the provider's source/duplex
 *  anchors with `target` = the reference name (translate.ts:751). A link with
 *  no such anchor is name-less → its prototypes are skipped (ruling 1). */
export function defNameForLink(link: Link): string | undefined {
  for (const role of ['source', 'duplex'] as const) {
    for (const a of link.anchorsOf(role)) {
      if (typeof a.target === 'string' && a.target.length > 0) return a.target
    }
  }
  return undefined
}

// Origin tracking (the ORIGIN-OWNER element, archive/reviews/2026-08-16/
// 2026-08-16-legacy-handler-reuse-review §12.4.3/4 — A1): the per-scope
// minted-set record — minted node id →
// origin layer id. It SURVIVES creator death (a moved minted node under a
// non-origin permanent parent is promoted by the teardown, never left
// permanently reverse-excluded) and is the rollback handle (one layer id →
// its whole minted set). Per-node marker split: Node.originLayer carries the
// same id (the reverse-exclusion read). Scoped per graph (D5/D6).
export function registerMinted(nodeId: NodeId, origin: string, scope: GraphScope = DEFAULT_SCOPE): void {
  scope.mintedByLayer.set(nodeId, origin)
}

export function unregisterMinted(nodeId: NodeId, scope: GraphScope = DEFAULT_SCOPE): void {
  scope.mintedByLayer.delete(nodeId)
}

export function mintedByOrigin(origin: string, scope: GraphScope = DEFAULT_SCOPE): NodeId[] {
  const out: NodeId[] = []
  for (const [id, o] of scope.mintedByLayer) {
    if (o === origin) out.push(id)
  }
  return out
}

export function registerContentNode(node: Node): void {
  scopeOf(node).contentNodes.add(node)
}

export function unregisterContentNode(node: Node): void {
  scopeOf(node).contentNodes.delete(node)
}

export function isContentNode(node: Node): boolean {
  return scopeOf(node).contentNodes.has(node)
}

// id -> most recently constructed node; used to resolve serialized parent refs.
// Scoped per graph (D3): an isolated graph resolves only its OWN nodes.
export function resolveNodeRef(id: string, scope: GraphScope = DEFAULT_SCOPE): Node | undefined {
  return scope.byId.get(id)
}

/** Register a constructed node for sweep participation and id resolution. */
export function registerNode(node: Node): void {
  const scope = scopeOf(node)
  scope.registered.add(node)
  scope.byId.set(node.id, node)
}

/** Schedule a sweep run. Pass force=true to guarantee a run even if already scheduled.
 *  D6 — ONE module timer; the run partitions per-scope pendingDestroy/dirty sets. */
export function scheduleSweep(force = false): void {
  if (sweepScheduled && !force) return
  sweepScheduled = true
  setTimeout(() => {
    sweepScheduled = false
    runSweep()
  }, 0)
}

function runSweep(): void {
  for (const scope of allScopes) {
    const batch = scope.pendingDestroy.splice(0)
    for (const node of batch) {
      const flag = scope.cascadeFlags.get(node)
      scope.cascadeFlags.delete(node)
      if (node.destroyed) continue
      if (node.state === 'in-tree' || node.state === 'prototype') continue
      if (isContentNode(node)) continue // payload-owned content persists (placement may return)
      finalizeDestroyed(node, flag)
    }
  }
  // pass-2: coalesced compileRemote over the union of 'remote'-dirty nodes,
  // per scope (an isolated graph compiles only its own nodes).
  for (const scope of allScopes) {
    const visited = new Set<NodeId>()
    const dirty = [...scope.registered].filter(n => !n.destroyed && n.dirty.has('remote'))
    const depthOf = (n: Node): number => {
      let d = 0
      let cur = n.parent
      while (cur) {
        d++
        cur = cur.parent
      }
      return d
    }
    dirty.sort((x, y) => depthOf(x) - depthOf(y))
    for (const node of dirty) {
      if (visited.has(node.id)) continue
      node.compileRemote(visited)
      node.dirty.delete('remote')
    }
    for (const node of scope.registered) {
      if (node.destroyed) continue
      if (node.dirty.has('anchor-populate')) {
        node.reconcileAnchors()
        node.dirty.delete('anchor-populate')
      }
      if (node.dirty.has('remote')) node.dirty.delete('remote')
      if (node.dirty.has('sweep-candidate')) node.dirty.delete('sweep-candidate')
    }
  }
}

/** REQ-GAP-11 (handoffs-review-2 §REQ-GAP-11 + the 2026-08-21 amendment) —
 *  the internal eviction primitive (NOT host-facing surface; reset/prune/
 *  unregisterNode stay REJECTED): drops a destroyed node from its scope's
 *  `registered`/`byId` sets + the content/minted ownership registries. Destroy
 *  is terminal — deletion is safe and completes the lifecycle the sweep owns.
 *  Called from `finalizeDestroyed` AND from the supervisor destroy op on BOTH
 *  destroy branches (the runtimeMinted/markDestroyed branch never reaches the
 *  sweep — it never calls markPending — so finalize-only eviction would miss
 *  the clone-built workload). */
export function evictDestroyedNode(node: Node): void {
  const scope = scopeOf(node)
  scope.registered.delete(node)
  // INSTANCE-GUARDED byId eviction (isolated + shared graphs with re-seeded
  // SAME node ids — an unconditional id-keyed delete would remove ANOTHER
  // graph's live entry for the same id when a deferred sweep fires mid-run).
  if (scope.byId.get(node.id) === node) scope.byId.delete(node.id)
  unregisterContentNode(node)
  unregisterMinted(node.id, scope)
}

/** Journal-condensing (D4, handoffs-review-8.md) — the SYNCHRONOUS
 *  pending-destroy drain: finalize + evict every queued node NOW, so the
 *  `_restoreBase` graph-REPLACE critical section can run without an async
 *  sweep interleaving (a deferred sweep must never finalize a NEW seed).
 *  Mirrors the async runSweep's per-node handling; the pass-2 compile half
 *  is NOT run here (the restore schedules its own full pass-2 refresh).
 *  Drains a scope's pending queue (scope-local per node). DEFECT-A fix
 *  (2026-08-25 adversarial pass, X19/X20): pass a scope to drain ONLY that
 *  scope's queue — a graph-A condense/replay must never finalize graph-B's
 *  pending nodes. `undefined` drains every scope (the pre-fix / shared-default
 *  behavior — a default host has one scope anyway). */
export function drainPendingDestroy(scope?: GraphScope): void {
  const scopes = scope ? [scope] : [...allScopes]
  for (const s of scopes) {
    const batch = s.pendingDestroy.splice(0)
    for (const node of batch) {
      const flag = s.cascadeFlags.get(node)
      s.cascadeFlags.delete(node)
      if (node.destroyed) continue
      if (node.state === 'in-tree' || node.state === 'prototype') continue
      if (isContentNode(node)) continue
      finalizeDestroyed(node, flag)
    }
  }
}

/** REQ-GAP-11 — the per-supervisor sweep hook seam (handoffs-review-2 §5
 *  accepted shape: "a sweep hook (or the destroy path) evicts the finalized
 *  node from this.nodes"). The sweep is module-level; each Supervisor
 *  registers its eviction callback so cascade-finalized nodes leave ITS
 *  this.nodes map too — at FINALIZE time (terminal), never at op time (the
 *  F17 destroy→re-attach rescue race must keep a rescued node registered). */
type FinalizeHook = (node: Node) => void
const finalizeHooks: FinalizeHook[] = []

export function onNodeFinalized(hook: FinalizeHook): void {
  finalizeHooks.push(hook)
}

function finalizeDestroyed(node: Node, flag?: { prototypeRooted: boolean }): void {
  if (node.destroyed) return
  node.destroyed = true
  node.dirty.add('sweep-candidate')
  const cascade = flag !== undefined
  for (const kid of node.children) {
    if (kid.destroyed) continue
    if (cascade) {
      // REQ-GAP-12 — the explicit-destroy cascade relaxes the content
      // exemption for EXPLICIT family children ONLY (user ruling 2026-08-21):
      // - a prototype-rooted destroy is a def/seam subtree: untouched,
      // - placement-owned children survive (placement-may-return letter),
      // - 'component'-token prototype children survive (never render),
      // - content children the cascade destroys are unregistered first (the
      //   destroy op unregisters only its direct target),
      // - the retention split: runtimeMinted children are markDestroyed (walk
      //   slots stable — the parent still lists them), never dissolved.
      if (flag!.prototypeRooted) continue
      if (isPlacementOwned(kid)) continue
      if (kid.state === 'prototype') continue
      if (isContentNode(kid)) unregisterContentNode(kid)
      if (kid.runtimeMinted) {
        kid.markDestroyed()
        evictDestroyedNode(kid)
        for (const hook of finalizeHooks) hook(kid)
        continue
      }
      finalizeDestroyed(kid, flag)
      continue
    }
    if (isContentNode(kid)) continue // a payload-owned descendant survives its tree owner
    if (kid.state === 'in-tree' || kid.state === 'prototype') continue
    finalizeDestroyed(kid)
  }
  evictDestroyedNode(node)
  for (const hook of finalizeHooks) hook(node)
}

/** Queue a node for the async cascade-destroy sweep (scope-partitioned, D6). */
export function markPending(node: Node): void {
  const scope = scopeOf(node)
  if (!scope.pendingDestroy.includes(node)) {
    scope.pendingDestroy.push(node)
    scheduleSweep()
  }
}
