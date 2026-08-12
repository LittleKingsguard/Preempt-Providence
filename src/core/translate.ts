// src/core/translate.ts — legacy /Preempt NodeSchema → anchor-based graph.
//
// Maps the ORIGINAL project's data schemas (RENDER_PROCESS_NOTES §3.1) onto
// the rebuilt anchor graph so a JSON file supplied by the original backend
// can build out a complete tree:
//
//   LegacyNodeData  { type, placement, component, content, children,
//                     props, handlers, css, versions }   → Node
//   TemplateData    { root, children?, component? }       → root node ('rootNode')
//   ContentPayload  { metadata?, userData?, component?, content[] }
//   ComponentBinding{ reference, target?, value? }        → target anchor
//   PlacementConfig { placementName?, ... }               → placement anchor
//   HandlerDef      { name, event?|phase?, body }         → node handlers
//   clientConfig    run* gates                            → {adapter,persistence}
//
// Children arrays attach via parent-child anchors (single-parent enforced);
// component references become `target` anchors resolved by the existing
// compile walk; placements become `placement` anchors.
import { Node, mintNodeId } from './node.js'
import { Link } from './link.js'
import { registerContentNode } from './registry.js'
import type { Anchor, LinkConfigNameHub, NodeBaseData } from './types.js'

export type LegacyHandlerPhase = 'before-compile' | 'after-compile' | 'after-render'

export interface LegacyHandlerDef {
  name: string
  event?: string
  phase?: LegacyHandlerPhase
  body?: (ctx: unknown, ...args: unknown[]) => unknown
}

export interface LegacyPlacementConfig {
  placementName?: string
  targetPlacement?: string
  activePlacement?: boolean
}

export interface LegacyComponentBinding {
  reference: string
  target?: string
  value?: unknown
}

export interface LegacyNodeData {
  type?: string
  placement?: LegacyPlacementConfig
  component?: LegacyComponentBinding
  content?: unknown
  children?: LegacyNodeData[]
  props?: Record<string, unknown>
  handlers?: LegacyHandlerDef[]
  css?: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }
  versions?: unknown
}

export interface LegacyTemplateData {
  root: LegacyNodeData
  children?: LegacyNodeData[]
  component?: LegacyComponentBinding
}

export interface LegacyContentPayload {
  metadata?: unknown
  userData?: unknown
  component?: LegacyComponentBinding
  content: LegacyNodeData[]
}

export interface LegacyClientConfig {
  runInstantiation?: boolean
  runAssembly?: boolean
  runPreprocessing?: boolean
  runValidation?: boolean
  runRendering?: boolean
  runPostprocessing?: boolean
  runMonitoring?: boolean
}

export interface LegacyInitialData {
  template: LegacyTemplateData
  content?: LegacyContentPayload[]
  clientConfig?: LegacyClientConfig
}

export interface TranslatedTree {
  root: Node
  /** every translated node, root first, tree order */
  nodes: Node[]
  /** unplaced content nodes (template.children + payload items) */
  content: Node[]
  metadata?: unknown
  userData?: unknown
  clientConfig: { adapter: string; persistence: boolean }
}

function defaultHub(): LinkConfigNameHub {
  const m = new Map<string, Link>()
  return {
    linkFor(name: string, kind: 'component' | 'placement'): Link {
      const key = `${kind}:${name}`
      let l = m.get(key)
      if (!l) {
        l = new Link({ name: kind })
        m.set(key, l)
      }
      return l
    },
  }
}

/** Permanent-owner family edge (chain → 'rootNode' ⇒ in-tree). */
function attachToPermanentOwner(node: Node, target: 'rootNode' | 'component'): void {
  const link = new Link({ name: 'parent-child' })
  node.addAnchor('child', node, { priority: 0 }, link)
  link.addAnchor({ role: 'parent', target, options: {}, link })
}

function familyLinkFor(parent: Node): Link {
  const existing = parent.anchors.find(a => a.role === 'parent')
  if (existing) return existing.link as unknown as Link
  const link = new Link({ name: 'parent-child' })
  parent.addAnchor('parent', parent, {}, link)
  return link
}

function attachChild(parent: Node, child: Node, priority: number): void {
  const link = familyLinkFor(parent)
  child.addAnchor('child', child, { priority }, link)
}

function baseFrom(nodeData: LegacyNodeData): NodeBaseData {
  const base: NodeBaseData = {}
  if (typeof nodeData.type === 'string') base.type = nodeData.type
  if (nodeData.content !== undefined) base.content = nodeData.content
  if (nodeData.props !== undefined) base.props = nodeData.props
  if (nodeData.css !== undefined) base.css = nodeData.css
  if (nodeData.handlers !== undefined) base.handlers = nodeData.handlers as unknown as unknown[]
  return base
}

/**
 * Translate one legacy NodeData subtree into Nodes, attaching children via
 * parent-child anchors and materializing placement/component anchors.
 * Returns every created node in tree order (parent before children).
 */
function translateNodeData(
  data: LegacyNodeData,
  hub: LinkConfigNameHub,
  nodes: Node[],
  opts: { asContentRoot?: boolean } = {},
): Node {
  const node = new Node(baseFrom(data), hub, mintNodeId(), opts.asContentRoot === true)
  nodes.push(node)

  // placement (PlacementConfig) → placement anchor
  const placement = data.placement
  if (placement && typeof placement.placementName === 'string') {
    const plink = hub.linkFor(placement.placementName, 'placement')
    node.addAnchor('placement', placement.placementName, {}, plink)
  }

  // component binding (ComponentBinding) → provider/consumer anchors.
  // A binding that carries a VALUE is a PROVIDER (translate.md §2): the node
  // provides `reference` = value as a `source` anchor — or, when it also
  // names a `target`, as a DUPLEX combo (source for `reference` + a `target`
  // anchor for `target`, the self-providing-consumer shape). A binding with
  // NO value is a plain `target` consumer.
  const component = data.component
  if (component && typeof component.reference === 'string') {
    const consumed = typeof component.target === 'string' && component.target.length > 0 ? component.target : undefined
    if (component.value !== undefined) {
      const clink = hub.linkFor(component.reference, 'component')
      const a = node.addAnchor('source', component.reference, {}, clink)
      a.value = component.value
      if (consumed) {
        const tlink = hub.linkFor(consumed, 'component')
        node.addAnchor('target', consumed, {}, tlink)
      }
    } else {
      const clink = hub.linkFor(component.reference, 'component')
      node.addAnchor('target', component.reference, {}, clink)
    }
  }

  // children (NodeData[]) → parent-child anchors in array order (priority)
  if (Array.isArray(data.children)) {
    data.children.forEach((childData, i) => {
      const child = translateNodeData(childData, hub, nodes)
      attachChild(node, child, i)
    })
  }
  return node
}

/**
 * Translate an original-format initial-data document into a complete tree.
 *
 * The root (with its own default `children`) is in-tree ('rootNode' owner).
 * `template.children` and content-payload items are the UNPLACED content
 * nodes — translated but not attached, awaiting placement; they are returned
 * in `TranslatedTree.content` and keep the payload metadata/userData on the
 * result (first payload wins).
 */
export function translateLegacy(doc: LegacyInitialData, opts?: { hub?: LinkConfigNameHub }): TranslatedTree {
  if (!doc || typeof doc !== 'object' || !doc.template || typeof doc.template !== 'object' || !doc.template.root) {
    throw new Error('legacy-envelope-mismatch: expected { template: { root }, content?, clientConfig? }')
  }
  const hub = opts?.hub ?? defaultHub()
  const nodes: Node[] = []
  const template = doc.template

  // root with its own default children (stored in the root itself)
  const root = translateNodeData(template.root, hub, nodes)
  attachToPermanentOwner(root, 'rootNode')

  // template.component binding on the root itself
  if (template.component && typeof template.component.reference === 'string') {
    const clink = hub.linkFor(template.component.reference, 'component')
    const a = root.addAnchor('target', template.component.reference, {}, clink)
    if (template.component.value !== undefined) a.value = template.component.value
  }

  // content nodes: template.children + content payloads — UNPLACED (no
  // parent anchor). metadata/userData surfaced from the first payload.
  // Registered as payload-owned content: they persist in the background
  // while unplaced (placement may return) and are dropped with their payload.
  const content: Node[] = []
  let metadata: unknown
  let userData: unknown
  if (Array.isArray(template.children)) {
    for (const childData of template.children) {
      const n = translateNodeData(childData, hub, nodes, { asContentRoot: true })
      registerContentNode(n)
      content.push(n)
    }
  }
  if (Array.isArray(doc.content)) {
    for (const payload of doc.content) {
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.content)) {
        throw new Error('legacy-payload-mismatch: payload requires content: NodeData[]')
      }
      if (metadata === undefined) metadata = payload.metadata
      if (userData === undefined) userData = payload.userData
      for (const contentData of payload.content) {
        const n = translateNodeData(contentData, hub, nodes, { asContentRoot: true })
        registerContentNode(n)
        content.push(n)
      }
    }
  }

  // clientConfig: legacy run* gates → adapter + persistence
  const cfg = doc.clientConfig
  let adapter = 'dom'
  let persistence = false
  if (cfg && typeof cfg === 'object') {
    if (cfg.runInstantiation === true) adapter = 'ssr'
    if (cfg.runMonitoring === true) persistence = true
  }

  return { root, nodes, content, metadata, userData, clientConfig: { adapter, persistence } }
}

export interface ReversePayloadGroup {
  roots: Node[]
  metadata?: unknown
  userData?: unknown
}

export interface ReverseTranslateOptions {
  /** payload/content roots to emit as ContentPayload items (single group) */
  content?: Node[]
  metadata?: unknown
  userData?: unknown
  /** per-payload groups — each emits as its own ContentPayload */
  payloads?: ReversePayloadGroup[]
}

/** One legacy NodeData from a live node: authored state from the LIVE cache
 *  (user edits preserved); component/placement anchors back to bindings;
 *  content-payload roots excluded from the authored children. */
function nodeToLegacy(node: Node, isContentRoot: (n: Node) => boolean): LegacyNodeData {
  const data: LegacyNodeData = {}
  data.type = node.type
  if (node.content !== undefined) data.content = node.content
  if (node.props && Object.keys(node.props).length > 0) data.props = { ...node.props }
  if (node.css && Object.keys(node.css).length > 0) data.css = { ...node.css }
  const rawHandlers = node.handlers as unknown as LegacyHandlerDef[] | undefined
  if (rawHandlers && rawHandlers.length > 0) data.handlers = rawHandlers.map((h) => ({ name: h.name, ...(h.event ? { event: h.event } : {}), ...(h.phase ? { phase: h.phase } : {}), ...(h.body ? { body: h.body } : {}) }))
  // component bindings back: a PROVIDER (source/duplex anchor with a value)
  // emits `reference` + `value` (+ `target` for the consumed name when the
  // node also consumes — the duplex shape); a plain consumer emits
  // `{ reference }` (translate.md §2 mapping).
  const compAnchors = node.anchors.filter(
    a => (a.role === 'target' || a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string',
  )
  const provider = compAnchors.find(a => a.role === 'source' || a.role === 'duplex')
  const consumer = compAnchors.find(a => a.role === 'target')
  if (provider) {
    const binding: LegacyComponentBinding = { reference: provider.target as string }
    if (provider.value !== undefined) binding.value = provider.value
    if (consumer) binding.target = consumer.target as string
    else if (provider.role === 'duplex') binding.target = provider.target as string
    data.component = binding
  } else if (consumer) {
    data.component = { reference: consumer.target as string }
  }
  const placement = node.anchors.find((a) => a.role === 'placement' && typeof a.target === 'string')
  if (placement) data.placement = { placementName: placement.target as string }
  const kids = node.children.filter((c) => !isContentRoot(c))
  if (kids.length > 0) data.children = kids.map((k) => nodeToLegacy(k, isContentRoot))
  return data
}

/**
 * Reverse-translate a live tree back into the original backend format.
 * Component/placement-induced tree state is reversed (placement-attached
 * content is emitted as ContentPayload, never as template children;
 * component bindings map back to `component.reference`), while
 * user-created state updates (content/props/css/handlers edits via the
 * managed channel) are preserved from the LIVE node state.
 */
export function reverseTranslate(root: Node, opts?: ReverseTranslateOptions): LegacyInitialData {
  const contentSet = new Set<Node>()
  for (const g of opts?.payloads ?? []) for (const n of g.roots) contentSet.add(n)
  for (const n of opts?.content ?? []) contentSet.add(n)
  const isContent = (n: Node): boolean => contentSet.has(n)
  const rootData = nodeToLegacy(root, isContent)
  const { component, ...templateRoot } = rootData
  const out: LegacyInitialData = {
    template: { root: templateRoot, ...(component ? { component } : {}) },
  }
  const groups: ReversePayloadGroup[] = opts?.payloads?.length
    ? opts.payloads
    : opts?.content?.length
      ? [{ roots: opts.content, metadata: opts.metadata, userData: opts.userData }]
      : []
  if (groups.length > 0) {
    out.content = groups.map((g) => {
      const payload: LegacyContentPayload = { content: g.roots.map((c) => nodeToLegacy(c, isContent)) }
      if (g.metadata !== undefined) payload.metadata = g.metadata
      if (g.userData !== undefined) payload.userData = g.userData
      return payload
    })
  }
  return out
}
