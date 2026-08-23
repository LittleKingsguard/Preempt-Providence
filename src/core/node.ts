import type {
  Anchor,
  AnchorDecl,
  AnchorTarget,
  BatchRecord,
  CompileResult,
  CompiledState,
  DerivedDecl,
  DirtyScope,
  LayerMutationList,
  LinkConfigNameHub,
  NodeBaseData,
  NodeLayer,
  NodeId,
  NodeState,
  Role,
} from './types.js'
import { SingleParentError } from './errors.js'
import { Link } from './link.js'
import { MAX_COMPILE_DEPTH } from './constants.js'
import { registerNode, scheduleSweep, markPending, resolveNodeRef, defPrototypesFor, defRootPrototypeFor, mintedByOrigin, unregisterMinted, handlerDef, compileHandlerBody } from './registry.js'
import { resolveArms, resolvePathTargets, providerValueFor, providerValueFromLink, hookWriteGuard } from './resolve.js'
import { logCompilePass, compilePassLogEnabled } from './debug.js'
import { validateDerived, applyDerived } from './derived.js'
// detachNodeSafe (the shared sibling-preserving detach, DEFECT #12) is the
// origin-owner teardown's doomed-node path. Imported at call time only — the
// node.ts ↔ ops.ts cycle is safe exactly like the supervisor.ts ↔ node.ts one
// (ops.ts uses its node.js imports strictly inside function bodies).
import { detachNodeSafe } from './ops.js'
// wrapLegacyHandler (the LEGACY-HANDLER RUNTIME BRIDGE, decision 4) — the
// seam materialization installs legacy-format def bodies behind the
// (event, context) arg-order wrapper. Call-time use only — legacy-handlers
// imports node.js as TYPES ONLY, so the node.ts ↔ legacy-handlers.ts edge is
// a type edge at runtime (safe).
import { wrapLegacyHandler } from './legacy-handlers.js'

export { MAX_COMPILE_DEPTH }

let nodeSeq = 0

export function mintNodeId(): string {
  nodeSeq += 1
  return `node-${nodeSeq}`
}

function effectiveOrder(a: Anchor): number | undefined {
  return a.options.priority ?? a.options.order
}

function linkOf(a: Anchor): Link {
  return a.link as unknown as Link
}

/** DEFECT #9 (2026-08-15) — the name-keyed anchor roles whose links are the
 *  shared per-name registries (component per-name Links + placement per-name
 *  Links): clones REUSE these links; fresh links are only for genuinely new
 *  connections (the family-child attach case). */
const NAME_KEYED_ROLES = new Set(['source', 'target', 'duplex', 'component', 'container', 'content'])

/** P3 §1.3 ancestor-name veto predicate — shared by the op-time half
 *  (placement-attach, ops.ts) and the translate-time half (producer
 *  minting, translate.ts): does any FAMILY ancestor of `node` carry a
 *  `content`-role anchor targeting `zone` — i.e., WOULD attempt to place
 *  content INTO the zone? User correction 2026-08-14: the veto is
 *  LOOP-PREVENTION only — a descendant presenting a zone that an ancestor
 *  would attempt to place into creates a placement-path loop (the
 *  ancestor's content anchor → the per-name Link → the descendant's
 *  container → family edges up → the ancestor → revisit). DUPLICATE
 *  PRESENTATION (an ancestor merely OFFERS the same zone via a
 *  `container`-role anchor) is LEGAL — overriding an ancestor's zone is a
 *  component feature (nearest-shadows-far). The walk follows the live
 *  parent chain; string-token parents (rootNode / component /
 *  contentNodes) terminate it (no family ancestor — no veto). At translate
 *  the child's family parent edge is minted CHILD-SIDE (the child attaches
 *  itself before its own placement minting), so the same predicate is live
 *  in both phases. */
export function ancestorConsumesZone(node: Node, zone: string): boolean {
  for (let cur: Node | null = node.parent; cur; cur = cur.parent) {
    if (cur.anchors.some(a => a.role === 'content' && typeof a.target === 'string' && a.target === zone)) return true
  }
  return false
}

export type ChainKind =
  | { kind: 'token'; token: 'rootNode' | 'component' | 'contentNodes' | 'other' }
  | { kind: 'slice-root' }
  | { kind: 'loop' }
  | { kind: 'unplaced' }
  | { kind: 'destroyed-owner' }

function chainTokenKind(target: string): ChainKind {
  if (target === 'rootNode') return { kind: 'token', token: 'rootNode' }
  if (target === 'component') return { kind: 'token', token: 'component' }
  if (target === 'contentNodes') return { kind: 'token', token: 'contentNodes' }
  return { kind: 'token', token: 'other' }
}

function chainSliceRule(node: Node, slice: ReadonlySet<NodeId>): ChainKind {
  return slice.has(node.id) ? { kind: 'slice-root' } : { kind: 'unplaced' }
}

/** One placement-path walk: the hop chain from the compiled node toward root
 *  (bottom-up: hops[0] is the node's OWN hop) plus the terminal kind. */
interface PathWalk {
  terminal: 'root' | 'token' | 'loop' | 'no-edge'
  token?: string
  hops: Array<{ zone?: string; owner: Node }>
  loopKey?: string
}

/** The node's family-parent token ('rootNode' / 'component' / 'contentNodes')
 *  when its own child anchor's link carries a string parent target. The tree
 *  root is UNIQUELY the node whose own family parent is the 'rootNode' token
 *  (family children of the root always resolve their parent-anchor target to
 *  the root NODE object — the token lives only on the root's own link). */
function familyParentTokenOf(node: Node): string | null {
  const child = node.childAnchor()
  if (!child) return null
  const pa = linkOf(child).anchorsOf('parent')[0]
  if (!pa || typeof pa.target !== 'string') return null
  return pa.target
}

/** Placement-path enumeration (P3 §2.1): walk BOTH edge kinds toward root —
 *  family edges (single branch; the SI-1 single parent) and placement edges
 *  (each `content` anchor → its per-name placement Link → every
 *  `container`-role producer anchor → its owner node — one branch per zone).
 *  Termination: 'rootNode' token ⇒ viable; 'component'/'contentNodes' token
 *  or a dead edge ⇒ non-viable; a per-walk `seen` revisit ⇒ loop. The visit
 *  set is per-branch, never shared across walks (§1.4). `segs` accumulates
 *  the root-down key segments for the loop diagnostic. */
function enumPathWalks(node: Node, seen: Set<NodeId>, segs: string[]): PathWalk[] {
  const out: PathWalk[] = []
  const child = node.stateChildAnchor()
  const parentAnchor = child ? linkOf(child).anchorsOf('parent')[0] : undefined
  if (!child || !parentAnchor) {
    out.push({ terminal: 'no-edge', hops: [] })
  } else {
    const target = parentAnchor.target
    if (typeof target === 'string') {
      out.push({ terminal: target === 'rootNode' ? 'root' : 'token', token: target, hops: [] })
    } else if (target !== null) {
      const owner = target as Node
      if (owner.destroyed) {
        out.push({ terminal: 'no-edge', hops: [] })
      } else if (seen.has(owner.id)) {
        out.push({ terminal: 'loop', hops: [], loopKey: `root/${[...segs, owner.id].join('/')}` })
      } else {
        const next = new Set(seen)
        next.add(owner.id)
        for (const w of enumPathWalks(owner, next, [...segs, owner.id])) {
          out.push(extendWalk(w, { owner }))
        }
      }
    } else {
      out.push({ terminal: 'no-edge', hops: [] })
    }
  }
  for (const a of node.anchors) {
    if (a.role !== 'content') continue
    for (const coa of linkOf(a).anchors) {
      if (coa.role !== 'container' || typeof coa.target !== 'string') continue
      const owner = coa.owner
      if (!owner || owner.destroyed) continue
      const zone = coa.target
      if (seen.has(owner.id)) {
        out.push({ terminal: 'loop', hops: [], loopKey: `root/${[...segs, zone, owner.id].join('/')}` })
        continue
      }
      const next = new Set(seen)
      next.add(owner.id)
      for (const w of enumPathWalks(owner, next, [...segs, zone, owner.id])) {
        out.push(extendWalk(w, { zone, owner }))
      }
    }
  }
  return out
}

/** Prepend one hop onto a child walk, preserving its terminal kind. */
function extendWalk(w: PathWalk, hop: PathWalk['hops'][number]): PathWalk {
  const out: PathWalk = { terminal: w.terminal, hops: [hop, ...w.hops] }
  if (w.token !== undefined) out.token = w.token
  if (w.loopKey !== undefined) out.loopKey = w.loopKey
  return out
}

/** The zone name of a walk's FIRST hop — the compiled node's own placement
 *  hop, i.e. the requested name that routed this branch (undefined for
 *  family-first walks). */
function firstHopZone(w: PathWalk): string | undefined {
  return w.hops[0]?.zone
}

/** P3 §1.2 — preference-ordered first-match (resolve-side pruning): the MOST
 *  PREFERRED `content` anchor name in the compiled node's OWN ordered request
 *  list (the anchors array preserves targetPlacement order, §1.1) whose
 *  per-name placement Link has at least one container owner with a
 *  root-viable walk. Names before it with no viable container are skipped
 *  (not fatal); names after it are NEVER consulted; null ⇒ a whole-array
 *  miss — nothing forks. Unit 4 enumerated all valid paths; this prunes the
 *  compiled node's own request to the chosen name's branches (intermediate
 *  walk hops keep walking ALL their edges — the R2.2 sibling-shared census
 *  depends on the fan-out). */
function chosenPlacementName(node: Node, walks: PathWalk[]): string | null {
  const names: string[] = []
  for (const a of node.anchors) {
    if (a.role !== 'content' || typeof a.target !== 'string') continue
    names.push(a.target)
  }
  if (names.length === 0) return null
  const rootViable = new Set<string>()
  for (const w of walks) {
    if (w.terminal !== 'root') continue
    const zone = firstHopZone(w)
    if (zone !== undefined) rootViable.add(zone)
  }
  for (const name of names) {
    if (rootViable.has(name)) return name
  }
  return null
}

/** §2.2 pathKey: 'root/<zone>/<ownerId>/…/<nodeId>' — the family path back to
 *  root interleaved with the zone names that routed each hop, terminating at
 *  the node's own id. Each placement hop contributes '/<zone>/<ownerId>';
 *  family hops contribute '/<ownerId>'; the hop landing on the ROOT node
 *  contributes nothing (the 'root' prefix IS the root). The root node's own
 *  key is 'root' — the root is the only node whose family parent is the
 *  'rootNode' token, so no other node can collide. */
function pathKeyFor(node: Node, walk: PathWalk): string {
  if (familyParentTokenOf(node) === 'rootNode') return 'root'
  const segs: string[] = []
  for (let i = walk.hops.length - 1; i >= 0; i -= 1) {
    const h = walk.hops[i]!
    if (familyParentTokenOf(h.owner) === 'rootNode') continue
    segs.push(h.zone !== undefined ? `${h.zone}/${h.owner.id}` : h.owner.id)
  }
  return `root/${[...segs, node.id].join('/')}`
}

/** §2.3 path-derived children for a path-state: the node ids of the
 *  level-(k+1) states whose owner-path extends this path by one level —
 *  the node's own family children plus every node that routes a content
 *  anchor into one of the node's container zones. A consumer whose extended
 *  walk would revisit a node already on the path is a loop arm and is NOT a
 *  child. Pure graph derivation — never recompiles the child states (E2E-2). */
function pathChildrenFor(node: Node, pathNodes: ReadonlySet<NodeId>): NodeId[] {
  const out: NodeId[] = []
  const seen = new Set<NodeId>()
  for (const kid of node.children) {
    seen.add(kid.id)
    out.push(kid.id)
  }
  for (const a of node.anchors) {
    if (a.role !== 'container' || typeof a.target !== 'string') continue
    for (const cna of linkOf(a).anchors) {
      if (cna.role !== 'content') continue
      const owner = cna.owner
      if (!owner || owner === node || seen.has(owner.id) || pathNodes.has(owner.id)) continue
      seen.add(owner.id)
      out.push(owner.id)
    }
  }
  return out
}

/** Seed a bindings record with the node's OWN published provider values
 *  (source/duplex anchors): `bindings[name] = <provider value>` when the value is
 *  set and the name is not already present (skip-if-present — a resolved/
 *  consumed value or a same-name duplex resolution wins). Consumed-first key
 *  order is preserved (own names are appended only). HOOKS (§7.2 pin 2) —
 *  the value read goes through `providerValueFor`: the node-local
 *  `hook-<name>` layer value wins over the authored `anchor.value`. */
function seedOwnBindings(node: Node, bindings: Record<string, unknown>): void {
  for (const a of node.anchors) {
    if (typeof a.target !== 'string') continue
    if (a.role === 'source' || a.role === 'duplex') {
      const v = providerValueFor(node, a, a.target)
      if (v !== undefined && bindings[a.target] === undefined) bindings[a.target] = v
    }
  }
}

/** Phase-B parent-chain walk (compile-horizon §6.1/§6.2): follows parent-anchor
 *  object targets from `root` until a termination rule applies — a revisit
 *  (per-walk `seen`, never shared) ⇒ loop; a string token ⇒ its kind; a
 *  destroyed node ⇒ destroyed-owner (wins over childless, exempt from
 *  pass-through); a childless node ⇒ the slice rule; an absent parent anchor ⇒
 *  the slice rule. The walk is bounded by `seen` only — there is NO depth cap:
 *  acyclic chains of any length classify by their true termination. Known-kind
 *  nodes with a child anchor are never a walk stop — only Phase C inherits.
 */
function chainRoot(root: Node, slice: ReadonlySet<NodeId>, depth = 0, seen = new Set<NodeId>()): ChainKind {
  if (seen.has(root.id)) return { kind: 'loop' }
  seen.add(root.id)
  const child = root.childAnchor()
  if (!child) return { kind: 'unplaced' }
  const parentAnchor = linkOf(child).anchorsOf('parent')[0]
  if (!parentAnchor) return chainSliceRule(root, slice)
  const target = parentAnchor.target
  if (typeof target === 'string') return chainTokenKind(target)
  if (typeof target === 'object' && target !== null) {
    const owner = target as Node
    if (owner.destroyed) return { kind: 'destroyed-owner' }
    if (owner.childAnchor() === null) return chainSliceRule(owner, slice)
    return chainRoot(owner, slice, depth + 1, seen)
  }
  return chainSliceRule(root, slice)
}

function makeLayer(
  id: string,
  src: string | undefined,
  fields: Record<string, unknown>,
): NodeLayer {
  const layer: NodeLayer = { id }
  for (const k of Object.keys(fields)) {
    const v = fields[k]
    if (v === undefined) continue
    ;(layer as unknown as Record<string, unknown>)[k] = v
  }
  if (src !== undefined) layer.sourceName = src
  return layer
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [v]
}

/** DEFECT #27 (2026-08-20) — is this an EXPLICIT handlers CLEAR layer? A
 *  `slice-*` handlers layer created by a state-slice write (applySlice's
 *  `slice-${nodeSeq}-${src}` scheme) whose value is an EMPTY ARRAY means "the
 *  node has no handlers". This is the only surface that can subtract handlers
 *  (the D16 merge is append-with-override, so an empty non-slice layer would
 *  contribute nothing). It drives BOTH the compileLocal merge reset AND the
 *  seam-handlers suppression (durable across compiles). NOTE: only the empty-
 *  ARRAY form is a clear — `value: undefined`/absent `handlers` on a `slice-*`
 *  layer is indistinguishable from a type/content/props write (makeLayer omits
 *  undefined fields) and stays a no-op. */
function isHandlerClearLayer(l: NodeLayer): boolean {
  return typeof l.id === 'string' && l.id.startsWith('slice-')
    && Array.isArray(l.handlers) && l.handlers.length === 0
}

/** Derived bake landing: assign the baked props AND the baked css.classes
 *  append (2026-08-20) onto the fresh compiled state — clone-only, never the
 *  pass-1 canon. `baked.css` already carries host + injected classes. */
function applyDerivedBake(node: Node, cs: CompiledState): void {
  const baked = applyDerived(node, cs)
  if (baked?.props !== undefined) cs.props = baked.props
  if (baked?.css !== undefined) cs.css = baked.css
}

export class Node {
  readonly isNode = true as const
  readonly id: string
  readonly base: Readonly<NodeBaseData>
  layers: NodeLayer[]
  destroyed = false
  /** DEFECT #11 (2026-08-15) — runtime-minted family nodes (clone-instance
   *  artifacts): reverseTranslate EXCLUDES them (the authored envelope is
   *  base truth; the graph redesign removed the need for literal cloning in
   *  placement/component logic — clone-instance is a legacy artifact guard).
   *  Runtime-only; never serialized. */
  runtimeMinted = false
  /** ORIGIN-OWNER (archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review §12.4.3) — the per-node
   *  origin marker: the layer id that minted this node via `layer-apply`.
   *  Doubles as the reverse-exclusion marker (nodeToLegacy's filter, like
   *  runtimeMinted). Cleared by the teardown's survivor promotion (a moved
   *  minted node becomes authored content) and by the doomed path.
   *  Runtime-only; never serialized. */
  originLayer: string | undefined
  /** HOOKS-ARRAY (OPTION C — the batch storage cell, §9.2 pin 5) — the
   *  PAYLOAD records for hook-driven mint batches, keyed by hook name. The
   *  single control handle: write → mint/replace; clear/remove → payload-
   *  controlled teardown; read → the batch + the minted set + the round-trip
   *  source. A MUTABLE runtime slot (base is frozen — the record is not
   *  authored data, it is the runtime payload); serialized alongside the
   *  node for the serialized-doc re-mint (rows are DATA, the minted nodes
   *  are DERIVED) and excluded from nodeToLegacy's reverse (the minted
   *  children are origin-excluded; the record ships only via the serialized
   *  doc path). */
  batches: Record<string, BatchRecord> = {}

  private readonly _anchors: Anchor[]
  private readonly _dirty: Set<DirtyScope>
  private readonly hub: LinkConfigNameHub | null
  private _resolved: CompiledState[] = []
  private pass1: {
    type: string
    props: Record<string, unknown>
    css: Record<string, unknown>
    content: unknown
    handlers: unknown[]
    derived: DerivedDecl | undefined
  }

  get anchors(): Anchor[] {
    return this._anchors
  }

  /** The tree's shared component/placement link hub (may be null for
   *  hub-less graphs — same-name anchors then do NOT share links and
   *  resolution falls back to graph scans). */
  get hubFor(): LinkConfigNameHub | null {
    return this.hub
  }

  get dirty(): Set<DirtyScope> {
    return this._dirty
  }

  constructor(data: NodeBaseData = {}, hub?: LinkConfigNameHub, id?: string, noSeed = false) {
    validateDerived(data.derived)
    this.id = id ?? data.id ?? mintNodeId()
    this.base = { ...data }
    Object.freeze(this.base)
    // HOOKS-ARRAY — seed the batch records from serialized data (the
    // round-trip source: the serialized-doc path re-mints from these)
    const seedBatches = (data as unknown as { batches?: Record<string, BatchRecord> }).batches
    if (seedBatches && typeof seedBatches === 'object') this.batches = { ...seedBatches }
    this.layers = []
    this._anchors = []
    this._dirty = new Set<DirtyScope>()
    this.hub = hub ?? null
    this.pass1 = { type: 'div', props: {}, css: {}, content: undefined, handlers: [], derived: undefined }
    if (data.type && !noSeed) {
      this.layers.push(makeLayer(`seed-${this.id}`, undefined, {
        type: data.type,
        props: data.props,
        css: data.css,
        content: data.content,
        handlers: data.handlers,
      }))
    }
    registerNode(this)
    this.compileLocal()
    this.ensureAutoIds()
    // materialize anchors from seed data (serialization round-trip)
    const seedAnchors = (data as unknown as { anchors?: Array<{ role: Role; target: string; options?: Record<string, unknown>; value?: unknown; parent?: string }> }).anchors
    if (seedAnchors && seedAnchors.length > 0) {
      let hasChildRef = false
      for (const sa of seedAnchors) {
        const role = sa.role
        const target = sa.target as string
        if (role === 'child') {
          if (this.childAnchor()) continue
          hasChildRef = true
          const link = new Link({ name: 'parent-child' })
          this.addAnchor('child', this, sa.options as Anchor['options'], link)
          const parentTarget: string = sa.parent ?? target
          const pa: Anchor = { role: 'parent', target: parentTarget, options: {}, link }
          // resolve the parent reference to a live node if already constructed
          if (parentTarget !== 'rootNode' && parentTarget !== 'component' && parentTarget !== 'contentNodes') {
            const resolved = resolveNodeRef(parentTarget)
            if (resolved) pa.target = resolved
          }
          link.addAnchor(pa)
          continue
        }
        if (role === 'parent') continue
        const kind = role === 'container' || role === 'content' ? 'placement' : role === 'source' || role === 'target' || role === 'duplex' ? 'component' : 'parent-child'
        // REQ-GAP-9 (handoffs-review-2 §3) — seed-path hub threading: route
        // the placement/component ROLE anchors through this.hub when it
        // exists so same-name anchors across seeds land on ONE shared Link
        // (the DEFECT #9 sharing semantics). Hub-less graphs keep the status
        // quo — per-node fresh links. Child anchors stay per-node fresh
        // links (reconciled later by reconcileParentTargets).
        const link = this.hub && (kind === 'placement' || kind === 'component')
          ? this.hub.linkFor(target as string, kind)
          : new Link({ name: kind })
        try {
          const a = this.addAnchor(role, target as AnchorTarget, sa.options as Anchor['options'], link)
          if (a !== null && sa.value !== undefined) a.value = sa.value
        } catch {
        }
      }
    }
  }

  childAnchor(): Anchor | null {
    return this.anchors.find(a => a.role === 'child') ?? null
  }

  /** DEFECT #24 (2026-08-19) — the RESOLUTION child anchor: the first 'child'
   *  anchor whose edge actually drives toward root. While a def root/child
   *  stays out-of-tree its PRIMARY family edge is the 'component'-token
   *  permanent owner (prototype); once the seam materializes the def subtree
   *  under an IN-TREE consumer, the seam child anchor becomes the resolution
   *  edge — the def realizes in-tree and the cascade flows through the def
   *  children to the placement containers (a def-internal drop-zone's placed
   *  packets start walking). The base edge still governs the family-children
   *  census + reverse emit (seam-wired nodes stay out of `consumer.children` —
   *  node.ts familyChildAnchors) and the seam can still be reverted (DEFECT
   *  #10) without dissolving the prototype's base attach. Falls back to
   *  childAnchor() when no seam edge exists (unresolved defs stay
   *  'prototype'). */
  stateChildAnchor(): Anchor | null {
    const first = this.childAnchor()
    if (!first) return null
    const pa = linkOf(first).anchorsOf('parent')[0]
    // token-terminated (component/contentNodes) — an unresolved prototype —
    // but a seam edge to an in-tree consumer exists: resolve through it
    if (pa && typeof pa.target === 'string') {
      for (const a of this.anchors) {
        if (a.role === 'child' && a.options.seam !== undefined) return a
      }
    }
    return first
  }

  get state(): NodeState {
    if (this.destroyed) return 'destroyed'
    const child = this.stateChildAnchor()
    if (!child) return 'unplaced'
    return this.stateFrom(child, 0, new Set<NodeId>())
  }

  private stateFrom(child: Anchor, depth: number, seen: Set<NodeId>): NodeState {
    const parentAnchor = linkOf(child).anchorsOf('parent')[0]
    if (!parentAnchor) return 'unplaced'
    const target = parentAnchor.target
    if (target === 'rootNode') return 'in-tree'
    if (target === 'component') return 'prototype'
    if (target === 'contentNodes') return 'in-tree'
    if (typeof target === 'object' && target !== null) {
      const owner = target as Node
      if (owner.destroyed) return 'unplaced'
      if (seen.has(owner.id)) return 'unplaced'
      seen.add(owner.id)
      const ownerChild = owner.stateChildAnchor()
      if (!ownerChild) return 'unplaced'
      return owner.stateFrom(ownerChild, depth + 1, seen)
    }
    return 'unplaced'
  }

  get isInTree(): boolean {
    return this.state === 'in-tree'
  }

  get parent(): Node | null {
    const child = this.childAnchor()
    if (!child) return null
    const parentAnchor = linkOf(child).anchorsOf('parent')[0]
    if (!parentAnchor) return null
    const target = parentAnchor.target
    if (typeof target === 'object' && target !== null) return target as Node
    return null
  }

  private familyChildAnchors(): { anchor: Anchor; node: Node }[] {
    const out: { anchor: Anchor; node: Node }[] = []
    const seen = new Set<NodeId>()
    for (const a of this.anchors) {
      if (a.role !== 'parent') continue
      // D7/ALS-5 (G26/F19) — seam parent anchors are DISTINCT from the
      // family parent: the family children walk ignores them (a seam-wired
      // def child never appears in consumer.children).
      if ((a.options as { seam?: unknown }).seam !== undefined) continue
      for (const ca of linkOf(a).anchorsOf('child')) {
        if (typeof ca.target === 'object' && ca.target !== null) {
          const n = ca.target as Node
          if (!seen.has(n.id)) {
            seen.add(n.id)
            out.push({ anchor: ca, node: n })
          }
        }
      }
    }
    return out
  }

  get children(): Node[] {
    return this.familyChildAnchors()
      .sort((x, y) => {
        const px = effectiveOrder(x.anchor) ?? 0
        const py = effectiveOrder(y.anchor) ?? 0
        if (px !== py) return px - py
        return 0
      })
      .map(x => x.node)
  }

  get type(): string {
    return this.pass1.type
  }

  get props(): Record<string, unknown> {
    return this.pass1.props
  }

  get css(): Record<string, unknown> {
    return this.pass1.css
  }

  /** Read-only merged derived declaration (base seeded, layers override per
   *  key — like props/css). serializeNode emits from it. */
  get derived(): DerivedDecl | undefined {
    return this.pass1.derived
  }

  get content(): unknown {
    return this.pass1.content
  }

  get handlers(): unknown[] {
    return this.pass1.handlers
  }

  get hasHandlers(): boolean {
    if (this.base.handlers !== undefined) return true
    return this.layers.some(l => l.handlers !== undefined)
  }

  get pathKey(): string {
    return this.pathKeyFrom(new Set<NodeId>())
  }

  /** Read-only pass-2 resolved states (compiled by the supervisor's pass-2).
   *  Returns a fresh shallow copy — callers can never mutate the node's cache. */
  get resolved(): CompiledState[] {
    return [...this._resolved]
  }

  private pathKeyFrom(seen: Set<NodeId>): string {
    if (seen.has(this.id)) return this.id
    seen.add(this.id)
    const parent = this.parent
    if (!parent) return this.state === 'in-tree' ? 'root' : this.id
    return `${parent.pathKeyFrom(seen)}/${this.id}`
  }

  addLayer(layer: NodeLayer): void {
    this.ensureWritable()
    validateDerived(layer.derived)
    const hasAnchors = Array.isArray(layer.anchors) && layer.anchors.length > 0
    const existingIdx = this.layers.findIndex(l => l.id === layer.id)
    if (existingIdx !== -1) {
      this.layers[existingIdx] = layer
    } else {
      this.layers.push({ ...layer })
    }
    this.compileLocal()
    if (hasAnchors) {
      this.reconcileAnchors()
      this.markDirty('anchor-populate')
    }
    this.markRemote()
    scheduleSweep(true)
  }

  removeLayer(id: string): void {
    this.ensureWritable()
    const idx = this.layers.findIndex(l => l.id === id)
    if (idx === -1) return
    const [layer] = this.layers.splice(idx, 1)
    if (layer === undefined) return
    // DEFECT #10 fix (S37/S38, stress round 4): the layer's GENERATING
    // anchors are removed with it (node.md §6.2 — "removed together with
    // its generating anchor"): each decl'd anchor leaves the node; the next
    // materializeSeam unwinds the seam links the removed anchor drove. The
    // placement fan-out then shrinks on recompile (no stale containers).
    if (Array.isArray(layer.anchors) && layer.anchors.length > 0) {
      for (const decl of layer.anchors) {
        if (typeof decl.target !== 'string') continue
        const match = this.anchors.find(a =>
          a.role === decl.role && a.target === decl.target
          && (decl.options?.seam === undefined || a.options.seam === decl.options.seam),
        )
        if (match) this.removeAnchor(match)
      }
    }
    // ORIGIN-OWNER (§12.4.4, ruling 5) — layer removal on the creator ALSO
    // tears down its minted set (the pre-detach survival predicate).
    this.teardownMinted(id)
    this.compileLocal()
    this.markDirty('anchor-populate')
    this.markRemote()
    scheduleSweep(true)
  }

  removeLayersForSource(sourceName: string): void {
    this.ensureWritable()
    const removed = this.layers.filter(l => l.sourceName === sourceName)
    this.layers = this.layers.filter(l => l.sourceName !== sourceName)
    // DEFECT #10 — source-scoped removal also unwinds the generating anchors
    for (const layer of removed) {
      if (!Array.isArray(layer.anchors) || layer.anchors.length === 0) continue
      for (const decl of layer.anchors) {
        if (typeof decl.target !== 'string') continue
        const match = this.anchors.find(a =>
          a.role === decl.role && a.target === decl.target
          && (decl.options?.seam === undefined || a.options.seam === decl.options.seam),
        )
        if (match) this.removeAnchor(match)
      }
    }
    // ORIGIN-OWNER — source-scoped removal tears down every removed layer's
    // minted set (the whole-subtree cascade, ruling 5).
    for (const layer of removed) this.teardownMinted(layer.id)
    this.compileLocal()
    this.markDirty('anchor-populate')
    this.markRemote()
    scheduleSweep(true)
  }

  /** ORIGIN-OWNER teardown (archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review §12.4.2/6, B2) — the
   *  PRE-DETACH survival predicate, per minted node, decided BEFORE any
   *  detach (post-detach a node is always 'unplaced', so the sweep gate can
   *  never see it in-tree): DOOMED iff the node's CURRENT family chain
   *  reaches a non-permanent terminal (chainRoot ∈ {unplaced,
   *  destroyed-owner, loop, slice-root, token 'other'}) OR the chain still
   *  passes through this origin — the whole-subtree cascade (ruling 5:
   *  includes created nodes placed elsewhere). SURVIVES iff the chain
   *  reaches a permanent token (rootNode/contentNodes/component) under a
   *  NON-origin parent — promotion: the origin marker is cleared and the
   *  node unregistered (becomes authored content, reverse-emitted;
   *  §12.4.6). Doomed nodes are detached via the shared sibling-preserving
   *  detach (detachNodeSafe — their current child anchor, wherever they
   *  moved) and the sweep cascade destroys their subtrees. The marker is
   *  cleared and the registry entry dropped for every touched node
   *  (double-remove no-ops; the record never lingers past its rollback). */
  private teardownMinted(layerId: string): void {
    for (const id of mintedByOrigin(layerId)) {
      const node = resolveNodeRef(id)
      if (node) {
        let originOnChain = false
        for (let cur: Node | null = node; cur; cur = cur.parent) {
          if (cur === this) {
            originOnChain = true
            break
          }
        }
        const kind = chainRoot(node, new Set<NodeId>())
        const permanent = kind.kind === 'token'
          && (kind.token === 'rootNode' || kind.token === 'contentNodes' || kind.token === 'component')
        if (!originOnChain && permanent) {
          // survivor promotion: origin marker cleared, node unregistered —
          // it is now authored content (reverse-emitted)
          node.originLayer = undefined
        } else {
          // doomed: the sibling-preserving detach; the sweep cascade
          // destroys the node and its subtree unless re-attached first
          detachNodeSafe(node)
          node.originLayer = undefined
        }
      }
      unregisterMinted(id)
    }
  }

  /** HOOKS-ARRAY (§9.4 item 6 — payload-controlled teardown, NO-PROMOTION
   *  override for the rows namespace). Identical to `teardownMinted` EXCEPT
   *  the survivor-promotion branch is suppressed: a hook-minted row is
   *  TRANSIENT DATA — promoting it (originLayer cleared + unregistered ⇒
   *  reverse-emitted as authored content) would ship raw rows the author
   *  never wrote through nodeToLegacy (payload corruption, the R-1 letter).
   *  Every minted row of the batch is DOOMED (sibling-preserving detach →
   *  sweep cascade-destroy) regardless of where it moved. Called internally
   *  by the PAYLOAD-CONTROL clear — never addressed directly by external
   *  code. */
  rowsTeardown(layerId: string): void {
    for (const id of mintedByOrigin(layerId)) {
      const node = resolveNodeRef(id)
      if (node) {
        detachNodeSafe(node)
        node.originLayer = undefined
      }
      unregisterMinted(id)
    }
  }

  clone(actor?: string, opts: { ignore?: string[] } = {}): Node {
    if (this.destroyed) throw new Error('cannot clone a destroyed node')
    const copy = new Node({ ...this.base }, this.hub ?? undefined, mintNodeId(), true)
    const ignore = new Set(opts.ignore ?? [])
    for (const l of this.layers) {
      if (l.id.startsWith('seed-')) continue
      if (ignore.has(l.id)) continue
      copy.layers.push(makeLayer(l.id, l.sourceName, {
        type: l.type,
        content: l.content,
        props: l.props ? { ...l.props } : undefined,
        css: l.css ? { ...l.css } : undefined,
        handlers: l.handlers,
        anchors: l.anchors ? l.anchors.map(a => ({ ...a })) : undefined,
        // derived rides the layer-copy loop too (spec §2): a clone inherits
        // its prototype's derived declarations (fork-stress assembly)
        derived: l.derived ? { ...l.derived, ...(l.derived.props ? { props: { ...l.derived.props } } : {}) } : undefined,
        // HOOKS (§7.2 pin-6 e — clone-shadowing): a hook layer rides the
        // copy (the clone carries the field via base + its OWN local layer
        // + the mirrored anchor value — no global registry)
        value: l.value,
        hookFallback: l.hookFallback,
      }))
    }
    copy.compileLocal()
    // DEFECT #9 fix (user directive 2026-08-15): NAME-KEYED anchors — the
    // component per-name roles (source/target/duplex/component) and the
    // placement per-name roles (container/content) — REUSE the ORIGINAL
    // shared per-name registry Link: the registry IS the connection (the
    // provider/zone resolution keys on the link), so a fresh link would
    // orphan the clone from resolution and seam materialization. A fresh
    // link is minted ONLY when the operation creates a connection that did
    // not exist before — the FAMILY child case (adding the clone as a child
    // to a previously childless host), which the skips below leave to the
    // attach path. DEFECT #11 fix: the clone is marked runtime-minted so
    // reverseTranslate excludes it (the authored envelope is base truth —
    // the graph redesign removed the need for literal cloning in
    // placement/component logic; clone-instance is a legacy artifact).
    for (const a of this.anchors) {
      if (a.role === 'child' && typeof a.target === 'string') continue
      if (a.role === 'parent' && a.target instanceof Node) continue
      const link = NAME_KEYED_ROLES.has(a.role) ? linkOf(a) : new Link({ name: linkOf(a).config.name })
      try {
        const copyAnchor = copy.addAnchor(a.role, a.target as AnchorTarget, { ...a.options }, link)
        // provider values ride along (a clone of a data-declared provider is
        // itself a provider — same convention as hydrateAnchor)
        if (copyAnchor !== null && a.value !== undefined) copyAnchor.value = a.value
      } catch {
        // unmaterializable profile entries are skipped
      }
    }
    copy.runtimeMinted = true
    return copy
  }

  destroy(): void {
    this.destroyLinks()
  }

  destroyLinks(): void {
    this.ensureWritable()
    let dissolved = false
    for (const a of [...this.anchors]) {
      if (a.role !== 'child') continue
      linkOf(a).destroy()
      dissolved = true
    }
    if (dissolved || this.childAnchor() === null) markPending(this)
  }

  markDestroyed(): void {
    this.destroyed = true
    this.dirty.add('sweep-candidate')
  }

  markDirty(scope: DirtyScope): void {
    this.dirty.add(scope)
  }

  addAnchor(role: Role, target: AnchorTarget | string, options: Anchor['options'], link: Link): Anchor | null {
    this.ensureWritable()
    // P3 §2.2/§10.ab/ae — component-source-duplicate guard, UNCONDITIONAL
    // (no seed-path opt-out, §10.ae): a SECOND same-name source/duplex
    // anchor on ONE node is the unsupported anti-pattern (the fork claim is
    // dead — identity = pathKey alone). Warn `component-source-duplicate`,
    // keep-first, skip-second. Covers the imperative path, the constructor
    // seed path (serialized docs), and materializeAnchors — the decl-path
    // dedup there (same role+target ⇒ skip BEFORE addAnchor) is
    // complementary and stays the single pre-filter for idempotent layer
    // re-application; the guard is the single ENFORCEMENT point for
    // everything that reaches addAnchor. source and duplex share one
    // provider namespace (resolve's providersOn + the legacy K8
    // reference-keyed guard), so the match is name-keyed across both roles.
    if ((role === 'source' || role === 'duplex') && typeof target === 'string') {
      const existing = this.anchors.find(
        a =>
          (a.role === 'source' || a.role === 'duplex') &&
          typeof a.target === 'string' &&
          a.target === target,
      )
      if (existing) {
        console.warn('component-source-duplicate at', this.id, role, target)
        return null
      }
    }
    const anchor: Anchor = { role, target: target as AnchorTarget, options: { ...options }, link, owner: this }
    if (role === 'child') {
      const existing = this.childAnchor()
      if (existing) {
        // The contentNodes permanent-owner token (minted at translate, P3
        // §10.ad/F-13) is a PLACEHOLDER family edge: a real parent edge
        // supersedes it — "attach adds a placement path to an already
        // in-tree content root" (placement-path-spec F-13 re-verification).
        // The single-parent invariant is preserved: the token is not a real
        // parent, so the node always has exactly one family parent.
        // (destroy() bypasses the parent-child link's min-1 child count —
        // the placeholder edge dissolves as a whole.)
        if (linkOf(existing).anchorsOf('parent')[0]?.target === 'contentNodes') {
          linkOf(existing).destroy()
        } else if ((options as { seam?: unknown }).seam !== undefined) {
          // D7/ALS-4 (F15) — role-scoped exemption: a LAYER-MATERIALIZED
          // 'child' anchor carrying the seam flag (options.seam — the
          // anchor-layer seam's second-parent admission) bypasses the
          // single-parent gate. A def referenced more than once gives its
          // children MULTIPLE LEGAL PARENTS — INTENDED (G24). EVERY other
          // second 'child' anchor keeps the gate (family attach ops — G25
          // unchanged).
        } else if ((options as { origin?: unknown }).origin !== undefined) {
          // ORIGIN-OWNER (§12.4.5) — same exemption for an origin-marked
          // 'child' anchor (options.origin — the layer-apply decl child
          // anchor's admission, the marker split's anchor side): a minted
          // child admitted as a second parent under its origin layer.
        } else {
          throw new SingleParentError(this.id)
        }
      }
    }
    link.addAnchor(anchor)
    this.anchors.push(anchor)
    return anchor
  }

  removeAnchor(anchor: Anchor): void {
    const idx = this.anchors.indexOf(anchor)
    if (idx === -1) return
    linkOf(anchor).removeAnchor(anchor)
    this.anchors.splice(idx, 1)
    if (anchor.role === 'child' && this.childAnchor() === null) markPending(this)
  }

  familyLinkFor(): Link {
    // D7/ALS-5 (F19) — the seam's 'parent'-role anchors (options.seam) are
    // NOT family edges: filter them out and return/create the FAMILY link, so
    // a real attachChild after a seam still grabs the family link.
    const existing = this.anchors.find(
      a => a.role === 'parent' && (a.options as { seam?: unknown }).seam === undefined,
    )
    if (existing) return linkOf(existing)
    const link = new Link({ name: 'parent-child' })
    this.addAnchor('parent', this, {}, link)
    return link
  }

  reconcileAnchors(): void {
    for (const layer of this.layers) {
      if (layer.anchors && layer.anchors.length > 0) {
        this.materializeAnchors(layer.anchors)
      }
    }
  }

  compileLocal(): void {
    const props: Record<string, unknown> = { ...(this.base.props ?? {}) }
    const css: Record<string, unknown> = { ...(this.base.css ?? {}) }
    let type = typeof this.base.type === 'string' ? this.base.type : 'div'
    let content: unknown = this.base.content
    let handlers: unknown[] | undefined = this.base.handlers
    // derived merges like props/css/handlers: base seeded, layers override
    // per key (spec §2); a layer whose decl carries no props leaves the
    // merge untouched
    let derived: DerivedDecl | undefined = this.base.derived
    for (const layer of this.layers) {
      if (layer.type) type = layer.type
      if (layer.content !== undefined) content = layer.content
      if (layer.props) for (const k of Object.keys(layer.props)) props[k] = layer.props[k]
      if (layer.css) for (const k of Object.keys(layer.css)) css[k] = layer.css[k]
      if (layer.handlers || isHandlerClearLayer(layer)) {
        // DEFECT #16 fix (round 5): handlers merge APPEND-WITH-OVERRIDE per
        // (name, event) — the old replace-array wiped the base's authored
        // handlers when a seam/handlers layer landed (silent dead handler).
        // Same-key later-wins; different entries accumulate (the handlers.md
        // letter: "layer handlers append, later layers override same-event").
        // DEFECT #27 (2026-08-20): an EXPLICIT state-slice handlers write with
        // an EMPTY list (or undefined) is a CLEAR — the accumulated handlers
        // reset to [] (base + seam + prior slices). Non-empty slice writes
        // keep the D16 append-with-override (B4/D16 preserved). The seam
        // layers themselves are suppressed by rebuildHandlerSeamLayer while a
        // clear layer exists, so the clear is durable across compiles.
        if (isHandlerClearLayer(layer)) {
          handlers = []
        } else {
          const merged = [...(handlers ?? [])] as Array<{ name?: unknown; event?: unknown }>
          for (const h of layer.handlers as Array<{ name?: unknown; event?: unknown }>) {
            const idx = merged.findIndex((m) => m.name === h.name && m.event === h.event)
            if (idx !== -1) merged[idx] = h
            else merged.push(h)
          }
          handlers = merged
        }
      }
      if (layer.derived?.props || layer.derived?.css) {
        derived = {
          ...(layer.derived.props
            ? { props: { ...(derived?.props ?? {}), ...layer.derived.props } }
            : derived?.props
              ? { props: derived.props }
              : {}),
          ...(layer.derived.css
            ? { css: { ...(derived?.css ?? {}), ...layer.derived.css } }
            : derived?.css
              ? { css: derived.css }
              : {}),
        }
      }
    }
    this.pass1 = { type, props, css, content, handlers: handlers ?? [], derived }
    this.ensureAutoIds()
  }

  compileRemote(visited: Set<string> = new Set(), depth = 0): void {
    if (visited.has(this.id)) return
    visited.add(this.id)
    this.compileLocal()
    for (const kid of this.children) kid.compileRemote(visited, depth + 1)
  }

  /**
   * Two-pass compile over a slice. `opts.focusNodeId` scopes CONSOLE warnings
   * to one node: the slice remains the full resolution universe (bindings
   * need every provider), but only the focused node's warnings are logged —
   * atomic pass-2 updates never re-log unrelated nodes (e.g. a dangling
   * reference elsewhere in the tree).
   */
  compile(slice: Node[], opts?: { focusNodeId?: NodeId }): CompileResult {
    const actionable: CompiledState[] = []
    const dropped: CompileResult['dropped'] = []
    const warnings: CompileResult['warnings'] = []
    const shouldWarn = (node: Node): boolean =>
      opts?.focusNodeId === undefined || opts.focusNodeId === node.id

    // dev aid: log this pass's node set + derived states (enabled explicitly)
    if (compilePassLogEnabled()) {
      logCompilePass(
        slice.map(n => ({ id: n.id, state: n.state })),
        opts?.focusNodeId,
      )
    }

    for (const node of slice) node.compileLocal()

    const sliceSet = new Set<NodeId>(slice.map(n => n.id))
    const kinds = new Map<NodeId, ChainKind>()
    // Memoized chain classification (compile-horizon §6.2) — order-independent:
    // Phase A — unconditional local kinds, order-free: destroyed; no child
    // anchor; child anchor without a parent anchor; string-token parent;
    // destroyed-owner parent.
    for (const node of slice) {
      if (node.destroyed) {
        kinds.set(node.id, { kind: 'destroyed-owner' })
        continue
      }
      const child = node.childAnchor()
      if (!child) {
        kinds.set(node.id, { kind: 'unplaced' })
        continue
      }
      const parentAnchor = linkOf(child).anchorsOf('parent')[0]
      if (!parentAnchor) {
        kinds.set(node.id, chainSliceRule(node, sliceSet))
        continue
      }
      const target = parentAnchor.target
      if (typeof target === 'string') {
        kinds.set(node.id, chainTokenKind(target))
        continue
      }
      if (typeof target === 'object' && target !== null && (target as Node).destroyed) {
        kinds.set(node.id, { kind: 'destroyed-owner' })
      }
    }
    // Phase B — for any node whose parent-anchor target is an object whose
    // kind is NOT yet known (in or out of slice), walk the chain from that
    // parent with a per-walk `seen` set (never shared); no depth cap.
    for (const node of slice) {
      if (kinds.has(node.id)) continue
      const child = node.childAnchor()
      if (!child) continue
      const parentAnchor = linkOf(child).anchorsOf('parent')[0]
      if (!parentAnchor) continue
      const target = parentAnchor.target
      if (typeof target !== 'object' || target === null || kinds.has((target as Node).id)) continue
      kinds.set(node.id, chainRoot(target as Node, sliceSet))
    }
    // Phase C — memoized propagation over the complete parent map: a node
    // inherits its parent's kind, EXCEPT an in-slice parent with no child
    // anchor (and not destroyed) terminates the child's chain there ⇒ slice-root.
    for (const node of slice) {
      if (kinds.has(node.id)) continue
      const child = node.childAnchor()
      const parentAnchor = linkOf(child!).anchorsOf('parent')[0]!
      const parent = parentAnchor.target as Node
      if (sliceSet.has(parent.id) && parent.childAnchor() === null && !parent.destroyed) {
        kinds.set(node.id, { kind: 'slice-root' })
      } else {
        kinds.set(node.id, kinds.get(parent.id)!)
      }
    }

    const viable = new Set<NodeId>()
    for (const node of slice) {
      if (node.destroyed) {
        dropped.push({ arm: [node.id], reason: 'owner-terminated' })
        continue
      }
      const kind = kinds.get(node.id)!
      if (kind.kind === 'loop') {
        warnings.push({ code: 'circular-source', pathKey: node.pathKey })
        if (shouldWarn(node)) console.warn('circular-source at', node.pathKey)
        dropped.push({ arm: [node.id], reason: 'loop' })
        continue
      }
      if (kind.kind === 'token' && kind.token === 'component') {
        dropped.push({ arm: [node.id], reason: 'prototype-terminated' })
        continue
      }
      if (kind.kind === 'token' && kind.token !== 'rootNode') {
        dropped.push({ arm: [node.id], reason: 'owner-terminated' })
        continue
      }
      if (kind.kind === 'destroyed-owner') {
        dropped.push({ arm: [node.id], reason: 'owner-terminated' })
        continue
      }
      if (kind.kind === 'unplaced') {
        // not-in-tree nodes are dropped unless they SELF-provide a resolved
        // name (source/duplex) — the S-R2.6 depth-0 case (self-contained
        // content nodes). Unplaced pure consumers stay unactionable until
        // placed (S1.1).
        const selfProviding = node.anchors.some(a =>
          (a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string',
        )
        if (selfProviding) {
          viable.add(node.id)
        } else {
          dropped.push({ arm: [node.id], reason: 'owner-terminated' })
        }
        continue
      }
      viable.add(node.id)
    }

    const hasAnyTarget = slice.some(n =>
      n.anchors.some(a => a.role === 'target' && typeof a.target === 'string'),
    )
    const consumedNames = new Set<string>()
    for (const n of slice) {
      for (const a of n.anchors) {
        if (a.role === 'target' && typeof a.target === 'string') consumedNames.add(a.target)
      }
    }
    const isResolutionParticipant = (node: Node): boolean =>
      node.anchors.some(a =>
        typeof a.target === 'string' &&
        (a.role === 'source' || a.role === 'duplex') &&
        consumedNames.has(a.target),
      )
    // F3 discipline: a PURE provider (a source-only node) consumed by name
    // is dropped from render — it is a value holder, never an element.
    // EXCEPTION (D7 — the [6] root-clobber pin): a provider whose value is
    // SEAM-consumed (a seam-target anchor — options.seam — consumes the
    // name) is a def HOST — the seam wrapper renders the def's children, so
    // the provider node itself must render its own real children (the root
    // both provides `auth` and carries its wrapper children).
    const seamConsumedNames = new Set<string>()
    for (const n of slice) {
      for (const a of n.anchors) {
        if (a.role === 'target' && typeof a.target === 'string' && a.options.seam !== undefined) {
          seamConsumedNames.add(a.target)
        }
      }
    }
    const isSeamProvider = (node: Node): boolean =>
      node.anchors.some(a =>
        typeof a.target === 'string' &&
        (a.role === 'source' || a.role === 'duplex') &&
        seamConsumedNames.has(a.target),
      )

    const makeCs = (node: Node): CompiledState => ({
      nodeId: node.id,
      pathKey: node.pathKey,
      // honest label: derived node state, never hardcoded (S1.1 carve-out
      // §10.10.4: a self-providing unplaced node compiles as 'unplaced')
      state: node.state,
      type: node.type,
      props: node.props,
      css: node.css,
      content: node.content,
      anchors: node.anchors,
      parent: node.parent ? node.parent.id : null,
      children: node.children.map(c => c.id),
      bindings: {},
      unresolved: [],
    })

    /** Seed a bindings record with the node's OWN published provider values
     *  (source/duplex anchors): `bindings[name] = anchor.value` when the
     *  value is set and the name is not already present (skip-if-present —
     *  a resolved/consumed value or a same-name duplex resolution wins).
     *  Consumed-first key order is preserved (own names are appended only). */
    const publishOwn = (node: Node, cs: CompiledState): void => {
      seedOwnBindings(node, cs.bindings)
    }

    for (const node of slice) {
      // D7/ALS-1..7 (G23-G28) — the seam materialization runs for EVERY
      // viable node (DEFECT #10: the reversion pass must also run for
      // nodes whose seam anchors were REMOVED — a target-less node still
      // needs its stale seam links unwound). Materialized before makeCs so
      // the compiled state reads the merged slot + the seam anchors.
      // Idempotent across recompiles (no re-mint, no double-add; the
      // reversion unwinds links whose driving seam anchor is gone).
      // AUTH-SEAM (2026-08-16) — SEAM-BEARER carve-out: a nested seam
      // consumer in a prototype chain (a def-in-def type/children seam —
      // the live-prod auth div inside the nav def) is NEVER viable, yet it
      // still needs the seam install: the phase-handler layer copy
      // (copyDefPhaseHandlers), the def-children family adoption
      // (adoptDefChildren) and the seam-link reversion. The seam install
      // therefore runs for every seam-bearing node regardless of viability
      // (destroyed nodes are exempt — addAnchor rejects destroyed writes).
      const seamBearer = node.anchors.some(
        (a) => (a.role === 'target' || a.role === 'duplex') && typeof a.target === 'string'
          && (a.options.seam !== undefined || a.options.handlerEvent !== undefined || a.options.handlerPhase !== undefined),
      )
      if ((seamBearer && !node.destroyed) || viable.has(node.id)) node.materializeSeam()
      if (!viable.has(node.id)) continue
      const targetNames = node.anchors
        .filter(a => a.role === 'target' && typeof a.target === 'string')
        .map(a => a.target as string)

      if (!hasAnyTarget || targetNames.length === 0) {
        if (hasAnyTarget && isResolutionParticipant(node) && !isSeamProvider(node)) continue
        const cs = makeCs(node)
        publishOwn(node, cs)
        // derived bake (§4): the copy is what lands — the pass-1 canon is
        // never mutated (clone-before-merge)
        applyDerivedBake(node, cs)
        actionable.push(cs)
        continue
      }
      const arms = resolveArms(node, targetNames, slice, viable, kinds)
      let warnedUnresolved = false
      for (const arm of arms) {
        if (arm.drop) {
          if (arm.drop.reason === 'loop') {
            warnings.push({ code: 'circular-source', pathKey: node.pathKey })
            if (shouldWarn(node)) console.warn('circular-source at', node.pathKey)
          }
          dropped.push({ arm: [node.id], reason: arm.drop.reason })
          continue
        }
        const cs = makeCs(node)
        cs.bindings = arm.bindings
        // engine-defect #1 fix: a target-bearing node's arms carry only the
        // CONSUMED names — seed the node's OWN provider values per arm so the
        // K2 synthesized `bindings.<own-ref>` reads (self-apply) and authored
        // `bindings.*` reads resolve on a LEGAL mixed node (consume A + provide
        // B + self-apply B). Skip-if-present: a same-name resolved/duplex
        // value wins; own values are node-static so every arm gets the same
        // seed (per-arm determinism, archive/findings/2026-08-15/2026-08-15-test-findings §"Stress-test review
        // loop #2" DEFECT #1).
        seedOwnBindings(node, cs.bindings)
        cs.unresolved = arm.unresolved
        if (arm.trace.length > 0) cs.trace = arm.trace
        if (arm.keys.length > 0) {
          cs.pathKey = `${node.pathKey}${arm.keys.join('')}`
          // actionable fork-arm emit: carry the arm's distinct path material as
          // the forkKey (S-R3.10), so minimalFromState/diffMinimal forward it and
          // fork arms stay distinct (wire, forkKey) entries at the adapter boundary
          // (adapters.md §2/R2; render.md §3.2).
          cs.forkKey = cs.pathKey
        }
        if (cs.unresolved.length > 0 && !warnedUnresolved) {
          warnedUnresolved = true
          warnings.push({ code: 'unresolved-reference', pathKey: node.pathKey })
          if (shouldWarn(node)) console.warn('unresolved-reference at', node.pathKey)
        }
        // derived bake (§4): per-arm evaluation — each arm's bindings drive
        // its own baked props
        applyDerivedBake(node, cs)
        actionable.push(cs)
      }
    }

    return { actionable, dropped, warnings }
  }

  /**
   * Placement-path enumeration compile mode (P3 §2 — the third compile
   * scope). For a placement-routed node (one carrying `content` anchors), or
   * the root, enumerate every valid (node, owner-path) pair toward root —
   * placement edges (content anchor → per-name placement Link → each
   * container-role producer anchor → its owner) plus family edges — and mint
   * ONE CompiledState per viable path. §1.2 preference-ordered first-match
   * prunes the compiled node's OWN request to the chosen name's branches
   * (names after it are never consulted; names before it with no viable
   * container are skipped); every zone of the chosen name fans out. `forkKey`
   * = `pathKey` on every path-state (§2.2); `activePlacement` = the chosen
   * name (§2.5); component targets resolve path-only (Q8). Loop-terminated
   * paths drop with a `circular-source` warning; token/no-edge-terminated
   * paths drop silently (§2.4 arm disposition). Path-derived children attach
   * at mint time (§2.3).
   */
  compilePath(): CompileResult {
    const actionable: CompiledState[] = []
    const dropped: CompileResult['dropped'] = []
    const warnings: CompileResult['warnings'] = []
    if (this.destroyed) {
      return { actionable, dropped: [{ arm: [this.id], reason: 'owner-terminated' }], warnings }
    }
    this.compileLocal()
    // D7/ALS-1..7 — the seam materialization in the PATH scope (blind-test
    // engine defect 2026-08-15): compile(slice) materializes seams before
    // makeCs (node.ts:956), but compilePath never did — so a CONTENT-target
    // seam consumer (the graph-side ALs-7 layer) rendered textless in the
    // path-enumeration compile while the emit-side type/children seams
    // (SED-1/2) worked per-path. Idempotent (content-equality guard,
    // hasSeamParentFor, stale-layer clearing) — safe before every walk.
    this.materializeSeam()
    // DEFECT #24 (2026-08-19) — SEAM-RESOLVED DEF NODES ARE CARRIERS, NOT
    // EMITTERS: a def-root/def-child seam-wired under an IN-TREE consumer
    // (a seam child anchor — the def subtree realizes in-tree for the state
    // walk + the placement cascade) ships its authored truth via the seam
    // binding's def-fill (emitDefRootElement/emitDefChildTree), so a
    // STANDALONE path-state would DOUBLE-emit the element (real wire +
    // the synthetic `` `${wire}:${bind}` `` wire). Suppressed here (empty
    // actionable, no drops — silent like a prototype): the packet that walks
    // INTO its container still enumerates through it (enumPathWalks recurses
    // via stateChildAnchor), so def-internal placements keep the cascade.
    if (this.anchors.some((a) => a.role === 'child' && a.options.seam !== undefined)) {
      return { actionable: [], dropped: [], warnings: [] }
    }
    const walks = enumPathWalks(this, new Set<NodeId>([this.id]), [])
    // §1.2 first-match: only the CHOSEN name's placement branches are ever
    // consulted — later names are pruned SILENTLY (no drops, no warnings);
    // family-first walks and the chosen name's own branches pass through
    const chosen = chosenPlacementName(this, walks)
    for (const w of walks) {
      if (chosen !== null) {
        const firstZone = firstHopZone(w)
        if (firstZone !== undefined && firstZone !== chosen) continue
      }
      if (w.terminal === 'loop') {
        const at = w.loopKey ?? this.pathKey
        warnings.push({ code: 'circular-source', pathKey: at })
        console.warn('circular-source at', at)
        dropped.push({ arm: [this.id], reason: 'loop' })
        continue
      }
      if (w.terminal === 'token') {
        dropped.push({ arm: [this.id], reason: w.token === 'component' ? 'prototype-terminated' : 'owner-terminated' })
        continue
      }
      if (w.terminal !== 'root') {
        dropped.push({ arm: [this.id], reason: 'owner-terminated' })
        continue
      }
      actionable.push(this.mintPathState(w))
    }
    return { actionable, dropped, warnings }
  }

  private mintPathState(walk: PathWalk): CompiledState {
    const pathKey = pathKeyFor(this, walk)
    const pathNodes = new Set<NodeId>([this.id, ...walk.hops.map(h => h.owner.id)])
    const cs: CompiledState = {
      nodeId: this.id,
      pathKey,
      // §2.2: forkKey = pathKey on EVERY path-state, unconditionally
      forkKey: pathKey,
      // §2.5: activePlacement — the CHOSEN name = the zone name of the
      // state's own first placement hop. Never authored; absent on
      // non-placement (family-first) states. (Derived `placement` root reads
      // it per-path — derived.ts §2.3 wiring is a later unit.)
      ...(firstHopZone(walk) !== undefined ? { activePlacement: firstHopZone(walk)! } : {}),
      // §9-Q3: the per-path event trace — the path's node ids, root-down
      // (hops are bottom-up; the root landing contributes nothing). The
      // supervisor's "path-state ⇒ emit {forkKey, nodeIds}" fork payload
      // reads this (no `#f`-grammar dependency — C-6 re-expression).
      trace: [...walk.hops.map(h => h.owner.id).reverse(), this.id],
      // honest label: the NODE's derived state, never hardcoded — viability
      // is a property of the path, not the family label (§2.4)
      state: this.state,
      type: this.type,
      props: this.props,
      css: this.css,
      content: this.content,
      anchors: this.anchors,
      // the path's parent: the landing owner of the node's first hop
      parent: walk.hops.length > 0 ? walk.hops[0]!.owner.id : null,
      // §2.3: path-derived children attach at mint time (graph-derived,
      // never recompiling the child states)
      children: pathChildrenFor(this, pathNodes),
      bindings: {},
      unresolved: [],
    }
    // §2.5/Q8 — per-path component-target resolution: the state's own node
    // first, then ITS path's ancestors (nearest-wins, ≤1 hit per name per
    // path; never the family chain beyond the path)
    resolvePathTargets(this, walk.hops.map(h => h.owner), cs.bindings, cs.unresolved)
    // provider seeding for the node's own published values (path-states carry
    // their node's sources; skip-if-present — a resolved path binding wins)
    seedOwnBindings(this, cs.bindings)
    // derived bake: reads the path-state's own children/pathKey
    applyDerivedBake(this, cs)
    return cs
  }

  applySlice(mutation: LayerMutationList, sourceName?: string): void {
    this.ensureWritable()
    this.markDirty('remote')
    for (const m of mutation) {
      const src = m.sourceName ?? sourceName
      const id = `slice-${nodeSeq++}-${src ?? 'op'}`
      if (m.targetProp === 'type') {
        this.addLayer(makeLayer(id, src, { type: m.value as string }))
      } else if (m.targetProp === 'content') {
        this.addLayer(makeLayer(id, src, { content: m.value }))
      } else if (m.targetProp === 'handlers') {
        this.addLayer(makeLayer(id, src, { handlers: m.value as unknown[] }))
      } else if (m.targetProp.startsWith('props.')) {
        const key = m.targetProp.slice('props.'.length)
        this.applyPropSlice(id, key, m.mode, m.value, src)
      } else if (m.targetProp.startsWith('css.')) {
        const key = m.targetProp.slice('css.'.length)
        this.addLayer(makeLayer(id, src, { css: { [key]: m.value } }))
      } else if (m.targetProp.startsWith('hooks.')) {
        // HOOKS (hooks-map-review.md §7 — the value-provider slot): a
        // `hooks.<name>` write lands ONE deterministic `hook-<name>`
        // replace-in-place layer (the user's single-source constraint —
        // NEVER the seq-based `slice-${seq}` scheme above; the reserved
        // `hook-` prefix avoids collision with arbitrary layer-apply ids).
        // Defensive containment here (warn + skip, never throw); the
        // supervisor's state-slice pre-check already rejected the op-level
        // failures (`hook-name-unresolved` / `hook-mode-blocked`) and
        // warned the seam-exempt no-op before this ever runs.
        this.applyHookSlice(m.targetProp.slice('hooks.'.length), m.mode, m.value, src)
      }
    }
    scheduleSweep(true)
  }

  /** HOOKS §7.3 — the hook write: resolve the name against the node's own
   *  source/duplex anchors (`hook-name-unresolved` / `hook-seam-exempt`
   *  containment), mirror the provider anchor's value (`a.value = value`) so
   *  serializeNode/loadState/nodeToLegacy ship ONE value source (the anchor
   *  — they already ship `a.value`; zero changes there; the FIELD carries
   *  only the NAMES — the value lives in the component binding), and land
   *  ONE `hook-<name>` layer holding the VALUE ONLY — no anchors (removeLayer
   *  safety, DEFECT #10), no props keys (no authored-prop collision — the
   *  value rides the layer's dedicated `value` slot). Same-value writes
   *  short-circuit (the seam-content precedent). `mode` is 'replace' only
   *  (`hook-mode-blocked`). `value: undefined` CLEARS the hook: the layer is
   *  removed and the authored value (preserved as `hookFallback` at the
   *  first write) restores to the anchor. */
  private applyHookSlice(name: string, mode: LayerMutationList[number]['mode'], value: unknown, src: string | undefined): void {
    if (name.length === 0) {
      console.warn(`hook-name-unresolved at ${this.id}: hooks.<name> needs a name; mutation skipped`)
      return
    }
    if (mode !== 'replace') {
      console.warn(`hook-mode-blocked at ${this.id}: hooks.${name} accepts 'replace' only; mutation skipped`)
      return
    }
    const kind = (this.base.hooksKind ?? {})[name]
    if (kind !== undefined && kind !== 'value') {
      console.warn(`hook-kind-mismatch at ${this.id}: hooks.${name} declared kind "${kind}" mints nodes; scalar value write skipped`)
      return
    }
    const guard = hookWriteGuard(this, name)
    if (!guard.ok) {
      if (guard.code === 'hook-name-unresolved') {
        console.warn(`hook-name-unresolved at ${this.id}: no source/duplex anchor named "${name}"; mutation skipped`)
      } else {
        console.warn(`hook-seam-exempt at ${this.id}: "${name}" is a seam/def-shaped provider; hook write skipped (a hook write would tear down the seam)`)
      }
      return
    }
    const anchor = guard.anchor
    const layerId = `hook-${name}`
    const existing = this.layers.find((l) => l.id === layerId)
    if (value === undefined) {
      // clear: remove the hook layer, restore the authored value
      if (existing !== undefined) {
        anchor.value = (existing as { hookFallback?: unknown }).hookFallback
        this.removeLayer(layerId)
      }
      return
    }
    if (existing !== undefined && existing.value === value) return
    if (existing !== undefined) {
      this.addLayer(makeLayer(layerId, src, { value, hookFallback: (existing as { hookFallback?: unknown }).hookFallback }))
    } else {
      this.addLayer(makeLayer(layerId, src, { value, hookFallback: anchor.value }))
    }
    anchor.value = value
  }

  private applyPropSlice(id: string, key: string, mode: LayerMutationList[number]['mode'], value: unknown, src: string | undefined): void {
    if (mode === 'replaceAll') {
      this.addLayer(makeLayer(id, src, { props: { [key]: value } }))
      return
    }
    const existing = this.props[key]
    if (mode === 'append' && Array.isArray(existing)) {
      this.addLayer(makeLayer(id, src, { props: { [key]: [...(existing as unknown[]), ...asArray(value)] } }))
      return
    }
    this.addLayer(makeLayer(id, src, { props: { [key]: value } }))
  }

  orphan(childAnchor: Anchor): void {
    const idx = this.anchors.indexOf(childAnchor)
    if (idx === -1) return
    linkOf(childAnchor).removeAnchor(childAnchor)
    this.anchors.splice(idx, 1)
    markPending(this)
  }

  __onLinkDissolve(anchor: Anchor): void {
    if (anchor.role !== 'child') return
    if (this.childAnchor() === null) markPending(this)
  }

  /** internal — the Supervisor writes pass-2 resolved states here (stored as
   *  a copy). Never call from app code; read-only via the `resolved` getter. */
  __setResolved(states: CompiledState[]): void {
    this._resolved = [...states]
  }

  private materializeAnchors(decls: AnchorDecl[]): void {
    for (const decl of decls) {
      const role = decl.role
      const target = decl.target as AnchorTarget
      if (role === 'child' && this.childAnchor()) continue
      // idempotent: skip if an anchor with same role+target already exists
      const targetKey = typeof target === 'string' ? target : (target as Node).id
      if (this.anchors.some(a => a.role === role && (typeof a.target === 'string' ? a.target : (a.target as Node).id) === targetKey)) {
        continue
      }
      let link: Link
      if (role === 'container' || role === 'content' || typeof decl.target === 'string') {
        const key = typeof decl.target === 'string' ? decl.target : 'slot'
        const fromHub = this.hub?.linkFor(key, role === 'container' || role === 'content' ? 'placement' : 'component')
        link = fromHub
          ? (fromHub as unknown as Link)
          : new Link({ name: role === 'container' || role === 'content' ? 'placement' : 'component' })
      } else {
        link = new Link({ name: 'component' })
      }
      try {
        this.addAnchor(role, target, decl.options ?? {}, link)
      } catch {
        // already satisfied or unmaterializable
      }
    }
  }

  /** D7/ALS-7 (G28) — the seam CONTENT layer for translate-planned
   *  `target: 'content'` bindings: the def's own `content` field (when the
   *  def has one) lands as a layer `content` VALUE, merged by compileLocal
   *  into the node's compiled content slot (base seeded, layers override).
   *  Idempotent across recompiles (the layer replaces itself by id); a def
   *  WITHOUT a `content` field delivers nothing (the consumer keeps its
   *  authored content); `'children'`/`'type'` seam targets carry no content.
   *  The def is resolved off the per-name component Link (the provider
   *  registry) — never scalarBinding, never the def's children. */
  private materializeSeam(): void {
    let contentChanged = false
    // DEFECT #10 reversion (S37): seam links generated by a seam anchor that
    // no longer exists are REVERTED — a removed anchor layer must unwind the
    // seam it drove (node.md §6.2 "removed together with its generating
    // anchor"). The seam parent anchors carry `seamTarget` = their driving
    // seam anchor name; the link destroy cascades to both sides (the
    // consumer's parent anchor + the def-root/proto child anchor).
    const activeSeamTargets = new Set<string>()
    for (const a of this.anchors) {
      if ((a.role !== 'target' && a.role !== 'duplex') || typeof a.target !== 'string') continue
      if (a.options.seam !== undefined) activeSeamTargets.add(a.target)
    }
    for (const pa of [...this.anchors]) {
      if (pa.role !== 'parent' || pa.options.seamTarget === undefined) continue
      if (activeSeamTargets.has(pa.options.seamTarget)) continue
      linkOf(pa).destroy()
    }
    for (const a of this.anchors) {
      // S19 — seam detection reads target AND duplex anchors (a self-provider
      // `{reference, value, target: <seam>}` plans a duplex — the seam flag
      // must materialize from it)
      if ((a.role !== 'target' && a.role !== 'duplex') || typeof a.target !== 'string') continue
      const seam = a.options.seam
      // HANDLER-SEAM (D6 un-park, 2026-08-15): a `handlers.<event>` binding
      // resolves the def by reference and layers ONE provenance-marked
      // handlers layer on the consumer ({name, event, body: compiled}) —
      // idempotent (replace-in-place), traceable (the layer sourceName +
      // origin marker pattern). A def that disappeared clears the stale layer.
      // Handled BEFORE the seam gate (handler anchors carry handlerEvent, no
      // seam option).
      if (a.options.handlerEvent !== undefined) {
        // DEFECT #13 fix: ONE per-consumer `seam-handlers` layer accumulates
        // ALL the consumer's handler bindings (compileLocal's layer merge
        // REPLACES the handlers array per layer — per-binding layers would
        // collapse to the last one). The layer is REBUILT from the consumer's
        // current handlerEvent anchors on every materialize — idempotent.
        contentChanged = this.rebuildHandlerSeamLayer() || contentChanged
        continue
      }
      if (seam === undefined) continue
      const link = linkOf(a)
      // HOOKS (§7.2 pin 2/5) — the seam def read goes through
      // `providerValueFromLink` (per-anchor `providerValueFor`: hook layer
      // first, authored value fallback). A def-named hook can never land
      // (hook-seam-exempt blocks the write), so this stays the authored
      // def for seam names — the guard, not the read, protects the seam.
      const value = providerValueFromLink(link)
      if (seam === 'content') {
        // ALS-7 (G28) — content-target text delivery: the def's own `content`
        // field (when the def has one) lands as a layer `content` VALUE,
        // merged by compileLocal into the node's compiled content slot (base
        // seeded, layers override). A def WITHOUT a `content` field delivers
        // nothing (the consumer keeps its authored content); `'children'`/
        // `'type'` seam targets carry no content. Never scalarBinding, never
        // the def's children.
        if (typeof value !== 'object' || value === null || Array.isArray(value)
          || (value as { content?: unknown }).content === undefined) {
          // no def or a def WITHOUT a content field → delivers no content
          // (stale layers from an earlier resolve are cleared)
          contentChanged = this.clearSeamContentLayers(a.target) || contentChanged
          continue
        }
        const def = value as { content: unknown }
        const layer: NodeLayer = { id: `seam-content-${a.target}`, content: def.content }
        const idx = this.layers.findIndex((l) => l.id === layer.id)
        if (idx !== -1 && this.layers[idx] !== undefined && (this.layers[idx] as NodeLayer).content === def.content) continue
        if (idx !== -1) this.layers[idx] = layer
        else this.layers.push(layer)
        contentChanged = true
        continue
      }
      // 'children' | 'type' — ALS-1/ALS-1b/ALS-2/ALS-4/ALS-6 (G23-G26, G29):
      // the seam passes the def's subtree onto the consumer as an anchor
      // layer. Per the delivery-shape ruling: for `children`-targets the
      // DEF-ROOT is "the resolved node" — the def-root's CHILDREN links
      // carry their parent anchors ON the def-root (target = self,
      // options.seam = true), and the CONSUMER's seam child link points at
      // the def-root. For `type`-targets (and children-targets whose def
      // mints no def-root — a css-less def) the consumer is the resolved
      // node: each passed child link's parent anchor sits ON the consumer.
      // Either way: the consumer's OWN family parent edge is untouched
      // (ALS-3 — the seam links are never family attach ops); the child-side
      // anchors sit on the pre-minted prototypes (admitted by the role-scoped
      // single-parent exemption — a def referenced twice gives its children
      // MULTIPLE LEGAL PARENTS, G24). The def's PLACEMENT links ride the
      // layer (ALS-6 — the shared per-name placement Link; never re-minted,
      // never re-vetoed). DEFECT #24 (2026-08-19): the def CHILD's container/
      // content anchors are NOT copied onto the def-root anymore — the def
      // child realizes IN-TREE via the seam (stateChildAnchor) and is the
      // real rendered drop-zone; a def-root copy would announce the same zone
      // twice on the shared Link and fork a packet into a phantom second
      // route (placement-path-spec §10.ag).
      if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
      const protos = defPrototypesFor(link)
      const defRoot = defRootPrototypeFor(link)
      if (seam === 'children' && defRoot !== undefined) {
        if (!this.hasSeamParentFor(defRoot)) {
          const seamLink = new Link({ name: 'parent-child' })
          // seamTarget tags the link's driving seam anchor (DEFECT #10 — the
          // reversion pass removes seam links whose anchor is gone)
          this.addAnchor('parent', this, { seam: true, seamTarget: a.target }, seamLink)
          defRoot.addAnchor('child', defRoot, { seam: true }, seamLink)
        }
        // AUTH-SEAM (2026-08-15): the def-root carries the def's own phase
        // bindings (afterAssembly → after-compile, the N5 carve-out); the
        // layer install runs here so the compiled entries exist to COPY onto
        // the TYPE-target consumer. The def-root itself is a seam CARRIER —
        // token-terminated pre-resolution, realizing in-tree only through the
        // seam RESOLUTION edge (DEFECT #24, stateChildAnchor), and never
        // emitting standalone (compilePath suppresses it — the def-fill ships
        // its authored truth) — so the harness's phase dispatch still runs on
        // the IN-TREE consumer only.
        if (defRoot.rebuildHandlerSeamLayer()) defRoot.compileLocal()
        for (const proto of protos) {
          if (defRoot.hasSeamParentFor(proto)) continue
          const seamLink = new Link({ name: 'parent-child' })
          defRoot.addAnchor('parent', defRoot, { seam: true }, seamLink)
          proto.addAnchor('child', proto, { seam: true }, seamLink)
        }
        continue
      }
      if (defRoot !== undefined) {
        // AUTH-SEAM — the same consumer-side install for `type`-targets
        // (SED-1 shell collapse): the def's phase handlers copy onto the
        // consumer and the def's children are family-adopted (the auth
        // pattern's component root = the consumer, not the prototype).
        if (defRoot.rebuildHandlerSeamLayer()) defRoot.compileLocal()
        this.copyDefPhaseHandlers(defRoot)
        this.adoptDefChildren(defRoot)
      }
      for (const proto of protos) {
        if (this.hasSeamParentFor(proto)) continue
        const seamLink = new Link({ name: 'parent-child' })
        this.addAnchor('parent', this, { seam: true, seamTarget: a.target }, seamLink)
        proto.addAnchor('child', proto, { seam: true }, seamLink)
        for (const pa of proto.anchors) {
          if ((pa.role !== 'container' && pa.role !== 'content') || typeof pa.target !== 'string') continue
          if (this.anchors.some((x) => x.role === pa.role && x.target === pa.target && x.link === pa.link)) continue
          this.addAnchor(pa.role, pa.target, {}, pa.link)
        }
      }
    }
    if (contentChanged) this.compileLocal()
  }

  /** ALS-2 idempotency — has the consumer already a seam parent anchor whose
   *  passed child link's child side sits on `proto`? */
  private hasSeamParentFor(proto: Node): boolean {
    return this.anchors.some(
      (a) => a.role === 'parent' && a.options.seam !== undefined
        && a.link.anchorsOf('child').some((ca) => ca.target === proto),
    )
  }

  /** DEFECT #13/#14 (2026-08-15) — rebuild the consumer's SINGLE
   *  provenance-marked handler-seam layer from ALL its handlerEvent anchors
   *  (FORMAT MARKER: legacy bodies installed WRAPPED — the `(event, context)`
   *  arg order restored via eventStub + legacyContext; modern bodies raw).
   *  Idempotent: the rebuilt layer replaces in place. */
  private rebuildHandlerSeamLayer(): boolean {
    // DEFECT #27 (2026-08-20) — an explicit handlers CLEAR (a `slice-*`
    // handlers layer with empty/undefined value) SUPPRESSES the seam: the
    // seam must not re-materialize, and any existing `seam-handlers` layer is
    // removed, so the clear is durable across compiles (the merge alone would
    // be re-wiped by the next materialize).
    if (this.layers.some(isHandlerClearLayer)) {
      const before = this.layers.length
      this.layers = this.layers.filter((l) => l.sourceName !== 'handler-seam')
      return this.layers.length !== before
    }
    const entries: Array<{ name: string; event?: string; phase?: string; body: unknown }> = []
    let stale = false
    for (const a of this.anchors) {
      if ((a.role !== 'target' && a.role !== 'duplex') || typeof a.target !== 'string') continue
      if (a.options.handlerEvent === undefined && a.options.handlerPhase === undefined) continue
      const def = handlerDef(a.target)
      if (def) {
        // DEFECT #18 fix (round 5): per-ENTRY containment — a malformed def
        // body warns handler-body-invalid + skips THAT entry (the inline
        // path's NP11 discipline); it never aborts the compile or the rebuild
        // of the consumer's other bindings.
        try {
          const compiled = compileHandlerBody(def.body)
          entries.push(a.options.handlerPhase !== undefined
            ? { name: def.name, phase: a.options.handlerPhase, body: def.format === 'legacy' ? wrapLegacyHandler(compiled, a.options.handlerPhase) : compiled }
            : { name: def.name, event: a.options.handlerEvent!, body: def.format === 'legacy' ? wrapLegacyHandler(compiled, a.options.handlerEvent!) : compiled })
        } catch {
          console.warn(`handler-body-invalid at seam def "${a.target}": the body does not evaluate; entry skipped`)
        }
      }
    }
    if (entries.length === 0) {
      const before = this.layers.length
      this.layers = this.layers.filter((l) => l.sourceName !== 'handler-seam')
      return this.layers.length !== before
    }
    const layer: NodeLayer = { id: 'seam-handlers', sourceName: 'handler-seam', handlers: entries }
    const idx = this.layers.findIndex((l) => l.id === layer.id)
    if (idx !== -1 && this.layers[idx] !== undefined && JSON.stringify((this.layers[idx] as NodeLayer).handlers) === JSON.stringify(layer.handlers)) return stale
    if (idx !== -1) this.layers[idx] = layer
    else this.layers.push(layer)
    return true
  }

  /** AUTH-SEAM (2026-08-15) — copy the def-root's compiled phase-handler
   *  entries onto the consumer's own seam layer (`seam-handlers-def`,
   *  replace-in-place, idempotent). The consumer's own handlerEvent anchors
   *  keep their `seam-handlers` layer; compileLocal's append-with-override
   *  merge combines both. */
  private copyDefPhaseHandlers(defRoot: Node): void {
    // DEFECT #27 (2026-08-20) — an explicit handlers CLEAR suppresses the
    // AUTH-SEAM phase-handler copy too (a clear means no handlers).
    if (this.layers.some(isHandlerClearLayer)) {
      const idx = this.layers.findIndex((l) => l.id === 'seam-handlers-def')
      if (idx !== -1) this.layers.splice(idx, 1)
      return
    }
    const src = defRoot.layers.find((l) => l.sourceName === 'handler-seam')
    const entries = src?.handlers ?? []
    const idx = this.layers.findIndex((l) => l.id === 'seam-handlers-def')
    if (entries.length === 0) {
      if (idx !== -1) {
        this.layers.splice(idx, 1)
        this.compileLocal()
      }
      return
    }
    const layer: NodeLayer = { id: 'seam-handlers-def', sourceName: 'handler-seam', handlers: entries }
    if (idx !== -1) this.layers[idx] = layer
    else this.layers.push(layer)
    this.compileLocal()
  }

  /** AUTH-SEAM (2026-08-15) — when the def-root carries a PHASE-handler
   *  binding, the consumer RE-HOMES the def-root's children: the def child's
   *  PRIMARY family edge moves from the def-root (token-terminated, never
   *  compiles) to the consumer's family link — the assembled component's
   *  child is an IN-TREE node, so the legacy handler's ctx.node.children
   *  walk + the clientAPI apply surface land on it. Idempotent: children
   *  already on the consumer's family link are skipped. The adopted child
   *  anchor carries the seam flag (G24 admission — a second child anchor
   *  beside the seam-wired one); the def child is marked runtimeMinted
   *  (reverse-excluded like a clone-instance — the authored truth is the
   *  def's children data, shipped via the seam binding). */
  private adoptDefChildren(defRoot: Node): void {
    const phaseBound = defRoot.anchors.some(
      (a) => (a.role === 'target' || a.role === 'duplex') && typeof a.target === 'string'
        && a.options.handlerPhase !== undefined,
    )
    if (!phaseBound) return
    const fam = this.familyLinkFor()
    const kids = defRoot.children
    let changed = false
    for (let i = 0; i < kids.length; i++) {
      const kid = kids[i]!
      if (fam.anchorsOf('child').some((ca) => ca.target === kid)) continue
      // the def-root's family link is dissolved as a whole (the sanctioned
      // min-1-bypassing removal — S-R3.4, the same mechanism the ops detach
      // uses when the last child leaves); every def child re-homes in one go
      const primary = kid.childAnchor()
      if (primary && linkOf(primary).anchorsOf('parent')[0]?.target === defRoot) {
        linkOf(primary).destroy()
      }
      kid.runtimeMinted = true
      kid.addAnchor('child', kid, { priority: i, seam: true }, fam)
      changed = true
    }
    if (changed) this.compileLocal()
  }

  private clearHandlerSeamLayers(target: string): boolean {
    let removed = false
    this.layers = this.layers.filter((l) => {
      if (l.id.startsWith(`seam-handlers-${target}`)) {
        removed = true
        return false
      }
      return true
    })
    return removed
  }

  private clearSeamContentLayers(target: string): boolean {
    let removed = false
    this.layers = this.layers.filter((l) => {
      if (l.id.startsWith(`seam-content-${target}`)) {
        removed = true
        return false
      }
      return true
    })
    return removed
  }

  private ensureWritable(): void {
    if (this.destroyed) throw new Error('destroyed node writes are rejected')
  }

  private markRemote(): void {
    const parent = this.parent
    if (parent) parent.dirty.add('remote')
    for (const kid of this.children) kid.dirty.add('remote')
  }

  private ensureAutoIds(): void {
    if (typeof this.pass1.props.id !== 'string') {
      this.pass1.props.id = `preempt-node-${this.id}`
    }
  }
}

/** After deserialization, reconcile parent-child link sharing.
 *  Links are expected to have been created per-node during seed; this pass
 *  reassigns child anchors to the correct shared family links.
 */
export function reconcileParentTargets(nodes: Node[]): void {
  const byId = new Map<string, Node>()
  for (const n of nodes) byId.set(n.id, n)
  // First pass: resolve parent anchor targets and discover family links
  const familyLinks = new Map<string, Link>() // parent node id -> Link
  for (const n of nodes) {
    for (const a of [...n.anchors]) {
      if (a.role !== 'child') continue
      const link = a.link as unknown as Link
      const pa = link.anchorsOf('parent')[0]
      if (!pa) continue
      if (typeof pa.target === 'string') {
        const resolved = byId.get(pa.target)
        if (resolved) (pa as { target: unknown }).target = resolved
      }
      if (typeof pa.target === 'object' && pa.target !== null) {
        const parentNode = pa.target as Node
        let famLink = familyLinks.get(parentNode.id)
        if (!famLink) {
          famLink = new Link({ name: 'parent-child' })
          familyLinks.set(parentNode.id, famLink)
          parentNode.addAnchor('parent', parentNode, {}, famLink)
        }
        // Transfer child anchor to the shared family link without triggering remove on old link
        if (famLink !== link) {
          const oldIdx = link.anchors.indexOf(a)
          if (oldIdx !== -1) link.anchors.splice(oldIdx, 1)
          ;(a as { link: unknown }).link = famLink
          famLink.addAnchor(a)
        }
      }
    }
  }
}

export function findCycle(node: Node, dest: Node): boolean {
  let current: Node | null = dest
  const seen = new Set<Node>()
  while (current) {
    if (current === node) return true
    if (seen.has(current)) break
    seen.add(current)
    current = current.parent
  }
  return false
}

// Re-exported for compatibility — existing importers use node.js as the
// public surface (Supervisor/JournalEntry now live in supervisor.ts).
export { Supervisor, focusedSliceFor, type JournalEntry } from './supervisor.js'
