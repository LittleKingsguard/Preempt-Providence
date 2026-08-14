import type {
  Anchor,
  AnchorDecl,
  AnchorTarget,
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
import { registerNode, scheduleSweep, markPending, resolveNodeRef } from './registry.js'
import { resolveArms, resolvePathTargets } from './resolve.js'
import { logCompilePass, compilePassLogEnabled } from './debug.js'
import { validateDerived, applyDerived } from './derived.js'

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
  const child = node.childAnchor()
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
 *  (source/duplex anchors): `bindings[name] = anchor.value` when the value is
 *  set and the name is not already present (skip-if-present — a resolved/
 *  consumed value or a same-name duplex resolution wins). Consumed-first key
 *  order is preserved (own names are appended only). */
function seedOwnBindings(node: Node, bindings: Record<string, unknown>): void {
  for (const a of node.anchors) {
    if (typeof a.target !== 'string') continue
    if ((a.role === 'source' || a.role === 'duplex') && a.value !== undefined) {
      if (bindings[a.target] === undefined) bindings[a.target] = a.value
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

export class Node {
  readonly isNode = true as const
  readonly id: string
  readonly base: Readonly<NodeBaseData>
  layers: NodeLayer[]
  destroyed = false

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
        const link = new Link({ name: role === 'container' || role === 'content' ? 'placement' : role === 'source' || role === 'target' || role === 'duplex' ? 'component' : 'parent-child' })
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

  get state(): NodeState {
    if (this.destroyed) return 'destroyed'
    const child = this.childAnchor()
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
      const ownerChild = owner.childAnchor()
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
    this.layers.splice(idx, 1)
    this.compileLocal()
    this.markRemote()
  }

  removeLayersForSource(sourceName: string): void {
    this.ensureWritable()
    this.layers = this.layers.filter(l => l.sourceName !== sourceName)
    this.compileLocal()
    this.markRemote()
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
      }))
    }
    copy.compileLocal()
    for (const a of this.anchors) {
      if (a.role === 'child' && typeof a.target === 'string') continue
      if (a.role === 'parent' && a.target instanceof Node) continue
      const fresh = new Link({ name: linkOf(a).config.name })
      try {
        const copyAnchor = copy.addAnchor(a.role, a.target as AnchorTarget, { ...a.options }, fresh)
        // provider values ride along (a clone of a data-declared provider is
        // itself a provider — same convention as hydrateAnchor)
        if (copyAnchor !== null && a.value !== undefined) copyAnchor.value = a.value
      } catch {
        // unmaterializable profile entries are skipped
      }
    }
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
    const existing = this.anchors.find(a => a.role === 'parent')
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
      if (layer.handlers) handlers = [...(layer.handlers as unknown[])]
      if (layer.derived?.props) {
        derived = derived?.props
          ? { props: { ...derived.props, ...layer.derived.props } }
          : { props: { ...layer.derived.props } }
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
      if (!viable.has(node.id)) continue
      const targetNames = node.anchors
        .filter(a => a.role === 'target' && typeof a.target === 'string')
        .map(a => a.target as string)

      if (!hasAnyTarget || targetNames.length === 0) {
        if (hasAnyTarget && isResolutionParticipant(node)) continue
        const cs = makeCs(node)
        publishOwn(node, cs)
        // derived bake (§4): the copy is what lands — the pass-1 canon is
        // never mutated (clone-before-merge)
        cs.props = applyDerived(node, cs) ?? cs.props
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
        // seed (per-arm determinism, docs/test-findings §"Stress-test review
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
        cs.props = applyDerived(node, cs) ?? cs.props
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
    cs.props = applyDerived(this, cs) ?? cs.props
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
      }
    }
    scheduleSweep(true)
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
