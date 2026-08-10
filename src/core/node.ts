import type {
  Anchor,
  AnchorDecl,
  AnchorTarget,
  CompileResult,
  CompiledState,
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
import { resolveArms } from './resolve.js'

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

function chainRoot(root: Node, slice: ReadonlySet<NodeId>, depth = 0, seen = new Set<NodeId>()): ChainKind {
  if (depth > MAX_COMPILE_DEPTH) return { kind: 'loop' }
  if (seen.has(root.id)) return { kind: 'loop' }
  seen.add(root.id)
  const child = root.childAnchor()
  if (!child) return { kind: 'unplaced' }
  const parentAnchor = linkOf(child).anchorsOf('parent')[0]
  if (!parentAnchor) return slice.has(root.id) ? { kind: 'slice-root' } : { kind: 'unplaced' }
  const target = parentAnchor.target
  if (typeof target === 'string') {
    if (target === 'rootNode') return { kind: 'token', token: 'rootNode' }
    if (target === 'component') return { kind: 'token', token: 'component' }
    if (target === 'contentNodes') return { kind: 'token', token: 'contentNodes' }
    return { kind: 'token', token: 'other' }
  }
  if (typeof target === 'object' && target !== null) {
    const owner = target as Node
    if (owner.destroyed) return { kind: 'destroyed-owner' }
    if (owner.childAnchor() === null) {
      return slice.has(owner.id) ? { kind: 'slice-root' } : { kind: 'unplaced' }
    }
    return chainRoot(owner, slice, depth + 1, seen)
  }
  return slice.has(root.id) ? { kind: 'slice-root' } : { kind: 'unplaced' }
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
  private pass1: {
    type: string
    props: Record<string, unknown>
    css: Record<string, unknown>
    content: unknown
    handlers: unknown[]
  }

  get anchors(): Anchor[] {
    return this._anchors
  }

  get dirty(): Set<DirtyScope> {
    return this._dirty
  }

  constructor(data: NodeBaseData = {}, hub?: LinkConfigNameHub, id?: string, noSeed = false) {
    this.id = id ?? data.id ?? mintNodeId()
    this.base = { ...data }
    Object.freeze(this.base)
    this.layers = []
    this._anchors = []
    this._dirty = new Set<DirtyScope>()
    this.hub = hub ?? null
    this.pass1 = { type: 'div', props: {}, css: {}, content: undefined, handlers: [] }
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
        const link = new Link({ name: role === 'placement' ? 'placement' : role === 'source' || role === 'target' || role === 'duplex' ? 'component' : 'parent-child' })
        try {
          const a = this.addAnchor(role, target as AnchorTarget, sa.options as Anchor['options'], link)
          if (sa.value !== undefined) a.value = sa.value
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

  private pathKeyFrom(seen: Set<NodeId>): string {
    if (seen.has(this.id)) return this.id
    seen.add(this.id)
    const parent = this.parent
    if (!parent) return this.state === 'in-tree' ? 'root' : this.id
    return `${parent.pathKeyFrom(seen)}/${this.id}`
  }

  addLayer(layer: NodeLayer): void {
    this.ensureWritable()
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
      }))
    }
    copy.compileLocal()
    for (const a of this.anchors) {
      if (a.role === 'child' && typeof a.target === 'string') continue
      if (a.role === 'parent' && a.target instanceof Node) continue
      const fresh = new Link({ name: linkOf(a).config.name })
      try {
        copy.addAnchor(a.role, a.target as AnchorTarget, { ...a.options }, fresh)
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

  addAnchor(role: Role, target: AnchorTarget | string, options: Anchor['options'], link: Link): Anchor {
    this.ensureWritable()
    const anchor: Anchor = { role, target: target as AnchorTarget, options: { ...options }, link }
    if (role === 'child') {
      const existing = this.childAnchor()
      if (existing) throw new SingleParentError(this.id)
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
    for (const layer of this.layers) {
      if (layer.type) type = layer.type
      if (layer.content !== undefined) content = layer.content
      if (layer.props) for (const k of Object.keys(layer.props)) props[k] = layer.props[k]
      if (layer.css) for (const k of Object.keys(layer.css)) css[k] = layer.css[k]
      if (layer.handlers) handlers = [...(layer.handlers as unknown[])]
    }
    this.pass1 = { type, props, css, content, handlers: handlers ?? [] }
    this.ensureAutoIds()
  }

  compileRemote(visited: Set<string> = new Set(), depth = 0): void {
    if (depth > MAX_COMPILE_DEPTH) return
    if (visited.has(this.id)) return
    visited.add(this.id)
    this.compileLocal()
    for (const kid of this.children) kid.compileRemote(visited, depth + 1)
  }

  compile(slice: Node[]): CompileResult {
    const actionable: CompiledState[] = []
    const dropped: CompileResult['dropped'] = []
    const warnings: CompileResult['warnings'] = []

    for (const node of slice) node.compileLocal()

    const sliceSet = new Set<NodeId>(slice.map(n => n.id))
    const kinds = new Map<NodeId, ChainKind>()
    for (const node of slice) kinds.set(node.id, chainRoot(node, sliceSet))

    const viable = new Set<NodeId>()
    for (const node of slice) {
      if (node.destroyed) {
        dropped.push({ arm: [node.id], reason: 'owner-terminated' })
        continue
      }
      const kind = kinds.get(node.id)!
      if (kind.kind === 'loop') {
        warnings.push({ code: 'circular-source', pathKey: node.pathKey })
        console.warn('circular-source at', node.pathKey)
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
        const selfResolvable = node.anchors.some(a => a.role === 'target' && typeof a.target === 'string')
        if (selfResolvable) {
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
      state: 'in-tree',
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

    const publishOwn = (node: Node, cs: CompiledState): void => {
      for (const a of node.anchors) {
        if (typeof a.target !== 'string') continue
        if ((a.role === 'source' || a.role === 'duplex') && a.value !== undefined) {
          if (cs.bindings[a.target] === undefined) cs.bindings[a.target] = a.value
        }
      }
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
        actionable.push(cs)
        continue
      }

      const arms = resolveArms(node, targetNames, slice, viable, kinds)
      let warnedUnresolved = false
      for (const arm of arms) {
        if (arm.drop) {
          if (arm.drop.reason === 'loop') {
            warnings.push({ code: 'circular-source', pathKey: node.pathKey })
            console.warn('circular-source at', node.pathKey)
          }
          dropped.push({ arm: [node.id], reason: arm.drop.reason })
          continue
        }
        const cs = makeCs(node)
        cs.bindings = arm.bindings
        cs.unresolved = arm.unresolved
        if (arm.trace.length > 0) cs.trace = arm.trace
        if (arm.keys.length > 0) {
          cs.pathKey = `${node.pathKey}${arm.keys.join('')}`
        }
        if (cs.unresolved.length > 0 && !warnedUnresolved) {
          warnedUnresolved = true
          warnings.push({ code: 'unresolved-reference', pathKey: node.pathKey })
          console.warn('unresolved-reference at', node.pathKey)
        }
        actionable.push(cs)
      }
    }

    return { actionable, dropped, warnings }
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
      if (role === 'placement' || typeof decl.target === 'string') {
        const key = typeof decl.target === 'string' ? decl.target : 'slot'
        const fromHub = this.hub?.linkFor(key, role === 'placement' ? 'placement' : 'component')
        link = fromHub
          ? (fromHub as unknown as Link)
          : new Link({ name: role === 'placement' ? 'placement' : 'component' })
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
export { Supervisor, type JournalEntry } from './supervisor.js'
