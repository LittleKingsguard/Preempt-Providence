// src/core/legacy-handlers.ts — the LEGACY-HANDLER RUNTIME BRIDGE
// (docs/specs/legacy-handler-reuse-review.md §5/§6, decisions 3/4/5/6 +
// the user directive 2026-08-15: children-injection ships via the
// origin-owner `layer-apply` op). Adapter-internal compat surface for the
// legacy (event, context) handler convention:
//   - the arg-order wrapper + event stub (decision 4),
//   - the per-member legacy context (real supervisor + read-only userData,
//     real clientAPI, rootNode view, states/tree passthrough),
//   - the WeakMap-backed NodeView proxy (decision 3, review §5),
//   - the adapter-internal QueryUtils (decision 5, review §6).
// The engine's dispatch surface is untouched — the wrapper is installed at
// materialize/translate and the context factory runs at dispatch.
import { parseStyle, serializeStyle } from './translate.js'
import { getTranslateUserData } from './registry.js'
import type { Node } from './node.js'
import type { Supervisor } from './supervisor.js'
import type { ClientAPI } from './client.js'
import type { HandlerContext } from './handlers.js'
import type { LayerMutationList, NodeState } from './types.js'

export interface NodeViewServices {
  clientAPI: ClientAPI
  supervisor: Supervisor
  tree: HandlerContext['tree']
}

export interface LegacyNodeView {
  /** the view of the node's family parent — token-terminated (a legacy
   *  parent walk stops at the rootNode/contentNodes/component token, never
   *  observes a synthetic token node) */
  readonly parent: LegacyNodeView | null
  /** family children ONLY (the seam-wired def children are excluded by the
   *  family children walk); a FRESH array per read — direct mutations
   *  (`children.pop()`) are documented graph no-ops */
  readonly children: LegacyNodeView[]
  /** pass-1 css with the serialized style STRING parsed back to the
   *  Record<string,string> OBJECT on read (F7 — the D3 reverse contract) */
  readonly css: Record<string, unknown>
  /** the base facade — children NOT included (D5: graph-derived, never
   *  stored) */
  readonly data: { type: string; props: Record<string, unknown>; css: Record<string, unknown>; content: unknown; handlers: unknown[] }
  readonly state: NodeState
  readonly type: string
  readonly props: Record<string, unknown>
  readonly content: unknown
  readonly handlers: unknown[]
  /** READ-ONLY maps of the node's component anchor reference names (fresh
   *  copies — `.delete()` etc. are graph no-ops) */
  readonly targetComponents: Map<string, { reference: string }>
  readonly sourceComponents: Map<string, { reference: string }>
  findNode(query: LegacyQuery): LegacyNodeView | null
  findNodes(query: LegacyQuery): LegacyNodeView[]
  /** the legacy write surface: state keys → ONE state-slice; `{children}`
   *  → ONE layer-apply (the origin-owner op) */
  receiveNextState(payload: Record<string, unknown>): unknown
}

export type LegacyQuery = ((view: LegacyNodeView) => boolean) | Record<string, unknown>

// §5.1 — ONE view per live node, cached in a module-level WeakMap: the SAME
// view object across members of one dispatch, across dispatches, and across
// wrapper invocations (legacy bodies compare/attach to nodes). The WeakMap
// never leaks the live Node into page scope — the view exposes no node
// reference. The service references are bound at first creation (one
// supervisor per tree in this engine).
const views = new WeakMap<Node, LegacyNodeView>()

// "warn once per dispatch" carrier for unsupported query keys — reset by
// legacyContext per dispatch (legacy bodies run synchronously).
let dispatchWarnState: { warnedUnsupported: boolean } | undefined

function unsupportedQueryWarn(): void {
  if (dispatchWarnState !== undefined) {
    if (dispatchWarnState.warnedUnsupported) return
    dispatchWarnState.warnedUnsupported = true
  }
  console.warn('[legacy-bridge] legacy-query-unsupported: the query asked for a key outside the honest vocabulary (type / id / classes / props / predicate); no match returned — never a silent broad match')
}

type QueryMatch = boolean | 'unsupported'

/** §6 — honest-key matching: type (exact), id (css.id), classes (css.classes
 *  — every requested class present), props (exact equality per key). ANY key
 *  outside that vocabulary (style/handlers/components/
 *  hasNonTypeTargetComponents included) marks the query 'unsupported' —
 *  warn + match NOTHING, never a silent broad match. */
function matchQuery(node: Node, query: Record<string, unknown>): QueryMatch {
  let unsupported = false
  for (const [key, value] of Object.entries(query)) {
    switch (key) {
      case 'type':
        if (typeof value !== 'string' || node.type !== value) return false
        break
      case 'id':
        if (typeof value !== 'string' || (node.css as { id?: unknown }).id !== value) return false
        break
      case 'classes': {
        const want = Array.isArray(value) ? value : typeof value === 'string' ? [value] : null
        if (want === null) return false
        const classes = Array.isArray(node.css?.classes) ? (node.css.classes as string[]) : []
        for (const c of want) {
          if (!classes.includes(c as string)) return false
        }
        break
      }
      case 'props': {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
        for (const [k, v] of Object.entries(value)) {
          if ((node.props as Record<string, unknown>)[k] !== v) return false
        }
        break
      }
      default:
        unsupported = true
    }
  }
  return unsupported ? 'unsupported' : true
}

/** READ-ONLY map of the node's anchor reference names (per-name component
 *  anchors). The legacy bodies read/iterate them; writes are graph no-ops
 *  (every read returns a fresh copy). */
function componentsOf(node: Node, side: 'target' | 'source'): Map<string, { reference: string }> {
  const map = new Map<string, { reference: string }>()
  for (const a of node.anchors) {
    if (typeof a.target !== 'string') continue
    const isSide = side === 'target' ? a.role === 'target' : a.role === 'source' || a.role === 'duplex'
    if (isSide && !map.has(a.target)) map.set(a.target, { reference: a.target })
  }
  return map
}

/** §5.5/D3 — a style OBJECT write serializes back to the kebab-case CSS
 *  string before the slice (the adapters never see the raw object). */
function cssValue(key: string, value: unknown): unknown {
  if (key === 'style' && typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return serializeStyle(value as Record<string, unknown>)
  }
  return value
}

/** The state-key half of receiveNextState: type / content / props.* / css.* /
 *  handlers → one LayerMutationList (children is never a state key). */
function mutationFrom(payload: Record<string, unknown>): LayerMutationList {
  const mutation: LayerMutationList = []
  if (payload.type !== undefined) mutation.push({ targetProp: 'type', mode: 'replace', value: payload.type })
  if (payload.content !== undefined) mutation.push({ targetProp: 'content', mode: 'replace', value: payload.content })
  if (payload.props !== undefined && typeof payload.props === 'object' && payload.props !== null && !Array.isArray(payload.props)) {
    for (const [key, value] of Object.entries(payload.props)) {
      mutation.push({ targetProp: `props.${key}`, mode: 'replaceAll', value })
    }
  }
  if (payload.css !== undefined && typeof payload.css === 'object' && payload.css !== null && !Array.isArray(payload.css)) {
    for (const [key, value] of Object.entries(payload.css)) {
      mutation.push({ targetProp: `css.${key}`, mode: 'replaceAll', value: cssValue(key, value) })
    }
  }
  if (payload.handlers !== undefined) mutation.push({ targetProp: 'handlers', mode: 'replace', value: payload.handlers })
  return mutation
}

/** A children-payload entry coerced to NodeData: a NodeView entry (the
 *  corpus spreads `container.children` views into the payload) serializes to
 *  its data shape with the style re-serialized (D3); plain objects pass
 *  through untouched. */
function nodeDataFrom(entry: unknown): Record<string, unknown> {
  if (entry instanceof NodeViewImpl) {
    const css: Record<string, unknown> = { ...entry.css }
    if (typeof css.style === 'object' && css.style !== null) css.style = serializeStyle(css.style as Record<string, unknown>)
    return { type: entry.type, content: entry.content, props: { ...entry.props }, css }
  }
  return entry as Record<string, unknown>
}

class NodeViewImpl implements LegacyNodeView {
  private readonly node: Node
  private readonly svc: NodeViewServices

  constructor(node: Node, svc: NodeViewServices) {
    this.node = node
    this.svc = svc
  }

  get parent(): LegacyNodeView | null {
    const p = this.node.parent
    return p ? getNodeView(p, this.svc) : null
  }

  get children(): LegacyNodeView[] {
    return this.node.children.map((c) => getNodeView(c, this.svc))
  }

  get css(): Record<string, unknown> {
    const css = { ...this.node.css }
    if (typeof css.style === 'string') css.style = parseStyle(css.style)
    return css
  }

  get data(): LegacyNodeView['data'] {
    return {
      type: this.node.type,
      props: { ...this.node.props },
      css: this.css,
      content: this.node.content,
      handlers: this.node.handlers,
    }
  }

  get state(): NodeState {
    return this.node.state
  }

  get type(): string {
    return this.node.type
  }

  get props(): Record<string, unknown> {
    return { ...this.node.props }
  }

  get content(): unknown {
    return this.node.content
  }

  get handlers(): unknown[] {
    return this.node.handlers
  }

  get targetComponents(): Map<string, { reference: string }> {
    return componentsOf(this.node, 'target')
  }

  get sourceComponents(): Map<string, { reference: string }> {
    return componentsOf(this.node, 'source')
  }

  findNode(query: LegacyQuery): LegacyNodeView | null {
    const all = this.findNodes(query)
    return all.length > 0 ? all[0]! : null
  }

  findNodes(query: LegacyQuery): LegacyNodeView[] {
    const out: LegacyNodeView[] = []
    // subtree scope: the view's node + its descendants in DOCUMENT order
    // (parent before children, children in order — the legacy "first match"
    // semantics; the engine's descendantsOf is LIFO-ordered, so the walk is
    // done here)
    const order: Node[] = [this.node]
    for (let i = 0; i < order.length; i++) {
      order.push(...order[i]!.children)
    }
    for (const n of order) {
      const match = typeof query === 'function'
        ? query(getNodeView(n, this.svc))
        : matchQuery(n, query)
      if (match === 'unsupported') {
        unsupportedQueryWarn()
        return []
      }
      if (match === true) out.push(getNodeView(n, this.svc))
    }
    return out
  }

  receiveNextState(payload: Record<string, unknown>): unknown {
    const nodeRef = this.node.id
    const { children, ...rest } = payload ?? {}
    if (children !== undefined) {
      if (!Array.isArray(children)) {
        return { status: 'rejected', error: { code: 'children-shape-invalid', detail: 'receiveNextState({children}) requires a NodeData[] payload' } }
      }
      // CHILDREN-INJECTION (the user directive, 2026-08-15) — ONE layer-apply:
      // the origin-owner op (atomic, journaled, idempotent, teardown = one
      // layer removal). The layerId is deterministic per consumer; re-injection
      // with the same layerId is a no-op.
      const layerId = `legacy-kids-${nodeRef}`
      const decls = children.map((_, i) => ({ role: 'child' as const, target: this.node, options: { priority: i } }))
      const result = this.svc.clientAPI.apply(nodeRef, {
        kind: 'layer-apply',
        target: this.node,
        layerId,
        sourceName: 'legacy-bridge',
        decls,
        nodes: children.map((c) => nodeDataFrom(c)),
      })
      // M2 — a MIXED payload (children + state keys): the atomic children op
      // is the layer-apply; the state keys ride a SEPARATE state-slice.
      const restMutation = mutationFrom(rest)
      if (restMutation.length > 0 && (result as { status?: string }).status === 'applied') {
        this.svc.clientAPI.apply(nodeRef, { kind: 'state-slice', mutation: restMutation })
      }
      return result
    }
    return this.svc.clientAPI.apply(nodeRef, { kind: 'state-slice', mutation: mutationFrom(rest) })
  }
}

/** §5.1 — the per-node view (WeakMap-backed, one object per live node). */
export function getNodeView(node: Node, services: NodeViewServices): LegacyNodeView {
  let v = views.get(node)
  if (!v) {
    v = new NodeViewImpl(node, services)
    views.set(node, v)
  }
  return v
}

/** §2.3 — the legacy event stub: `{type, preventDefault(){}, stopPropagation
 *  (){}, target: nodeView, isTrusted: false}` + `value: args[0]` when the
 *  dispatch carried an argument. */
export function eventStub(ctx: HandlerContext, event: string | undefined, args: unknown[]): Record<string, unknown> {
  const stub: Record<string, unknown> = {
    type: event,
    preventDefault() {},
    stopPropagation() {},
    target: ctx.node ? getNodeView(ctx.node, { clientAPI: ctx.clientAPI, supervisor: ctx.supervisor, tree: ctx.tree }) : undefined,
    isTrusted: false,
  }
  if (args.length > 0) stub.value = args[0]
  return stub
}

export interface LegacyContext {
  /** the NodeView proxy — the ONLY adapted member */
  node: LegacyNodeView
  /** the real Supervisor passthrough + a read-only userData member (the
   *  value captured from TranslatedTree.userData at translate); a WRITE is a
   *  contained no-op (strict-mode assignment failure surfaces in the
   *  dispatch results — no session channel) */
  supervisor: unknown
  /** the real ClientAPI */
  clientAPI: ClientAPI
  /** the root NodeView (read-only) */
  rootNode: LegacyNodeView | null
  /** passthrough from the scoped dispatch context */
  states?: HandlerContext['states']
  tree: HandlerContext['tree']
}

/** The per-dispatch legacy context. Only `node` is adapted (the NodeView
 *  proxy); every other member is the real surface with the documented
 *  read-only/no-op carve-outs. */
export function legacyContext(ctx: HandlerContext): LegacyContext {
  const node = ctx.node!
  dispatchWarnState = { warnedUnsupported: false }
  const svc: NodeViewServices = { clientAPI: ctx.clientAPI, supervisor: ctx.supervisor, tree: ctx.tree }
  const out: LegacyContext = {
    node: getNodeView(node, svc),
    supervisor: supervisorWithUserData(ctx.supervisor),
    clientAPI: ctx.clientAPI,
    rootNode: rootViewOf(node, svc),
    tree: ctx.tree,
  }
  if (ctx.states !== undefined) out.states = ctx.states
  return out
}

/** The real supervisor passthrough with a read-only `userData` member. */
function supervisorWithUserData(sup: Supervisor): unknown {
  return new Proxy(sup, {
    get(target, prop, receiver) {
      if (prop === 'userData') return getTranslateUserData()
      return Reflect.get(target, prop, receiver)
    },
    set(target, prop, value, receiver) {
      // the contained no-op: writes to userData never land (sloppy-mode
      // bodies silently no-op; strict-mode bodies throw, contained by the
      // dispatch)
      if (prop === 'userData') return false
      return Reflect.set(target, prop, value, receiver)
    },
  })
}

/** The root NodeView — the top of the node's live family chain (the
 *  rootNode/contentNodes/component token parent terminates the walk). */
function rootViewOf(node: Node, svc: NodeViewServices): LegacyNodeView | null {
  let top: Node | null = node
  let cur: Node | null = node
  while (cur) {
    top = cur
    cur = cur.parent
  }
  return top ? getNodeView(top, svc) : null
}

/** Decision 4 — the arg-order wrapper: installs the legacy (event, context)
 *  convention body behind the engine's (ctx, ...args) dispatch call. The
 *  returned function types its first argument loosely (dispatch passes the
 *  scoped HandlerContext). */
export function wrapLegacyHandler(
  body: (...args: unknown[]) => unknown,
  event: string | undefined,
): (ctx: unknown, ...args: unknown[]) => unknown {
  return (ctx, ...args) => {
    const scoped = ctx as HandlerContext
    return body(eventStub(scoped, event, args), legacyContext(scoped))
  }
}
