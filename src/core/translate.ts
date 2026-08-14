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
// Component bindings follow the K1–K8 kernel
// (docs/specs/legacy-component-ref-only-review.md §2.2 + Appendix E):
// `target` is the LOCAL `props.<key>` apply path (never a second component
// name — the runtime duplex anchor shape is legacy-unexpressible); a single
// binding or an ARRAY of bindings is accepted (K7); vacuous bindings warn +
// skip (K3); duplicate reference/target warn + block pre-anchor (K8); the
// apply path persists on the anchor options `applyPath` (K5) and reverse
// emits it as the legacy `target` field again — consumer `{reference,
// target}`, provider `{reference, value, target}`, emitted ONLY when the
// anchor has an apply path; the synthesized derived keys (K2 `bindings.*`
// machinery) are stripped on reverse (N1); the root's `template.component`
// mirrors the node mapping incl. the source flip (K6); handler phase/body
// guards warn + skip, never throw (K8, TR-F2).
//
// Children arrays attach via parent-child anchors (single-parent enforced);
// component references become `target` anchors resolved by the existing
// compile walk; placements become `placement` anchors.
import { Node, mintNodeId } from './node.js'
import { Link } from './link.js'
import { registerContentNode } from './registry.js'
import { validateDerived } from './derived.js'
import type { Anchor, DerivedDecl, DerivedExpr, LinkConfigNameHub, NodeBaseData } from './types.js'
export type LegacyHandlerPhase = 'before-compile' | 'after-compile' | 'after-render'

export interface LegacyHandlerDef {
  name: string
  event?: string
  phase?: LegacyHandlerPhase
  /** live function OR its source as a string (instantiated at translate —
   *  legacy loadable handlers, admin-gated at the backend) */
  body?: ((ctx: unknown, ...args: unknown[]) => unknown) | string
}

export interface LegacyPlacementConfig {
  placementName?: string
  /** Preference-ordered list of zone names to route this node into (P3 §1.2 —
   *  legacy shape is `string[]`; one `content` anchor per name, in order).
   *  A bare string (the old mis-typed shape) is coerced to `[string]` with a
   *  `placement-string-coerced` warn (back-compat). */
  targetPlacement?: string[]
  /** DERIVED resolution record (P3 §2.5) — never authored, never minted into
   *  an anchor; `nodeToLegacy` emits the derived read on reverse. */
  activePlacement?: string
}

export interface LegacyComponentBinding {
  reference: string
  /** LOCAL injection path on the host node — legacy target vocabulary
   *  (§2.1: flat `props.<key>` is the only translate-time apply seam; other
   *  vocabulary paths are recognition-only gaps). NOT a second component
   *  name — the runtime duplex anchor shape is legacy-unexpressible (K1). */
  target?: string
  value?: unknown
}

/** K4 warnings channel — additive translate-time diagnostics; the translator
 *  never throws for well-formed-but-invalid semantics (TR-F2). */
export interface TranslatedWarning {
  code: string
  /** tree position, e.g. `root.children[2]` / `template.children[0]` /
   *  `content[0].content[1]` / `root.handlers[0]` */
  path?: string
}

export interface LegacyNodeData {
  type?: string
  placement?: LegacyPlacementConfig
  /** single binding OR the K7 array form (multiple bindings per node) */
  component?: LegacyComponentBinding | LegacyComponentBinding[]
  content?: unknown
  children?: LegacyNodeData[]
  props?: Record<string, unknown>
  handlers?: LegacyHandlerDef[]
  css?: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }
  versions?: unknown
  /** the derived RULE (never the baked values) — flat legacy home for the
   *  merged declaration (derived-state.md §2/§8: layers have no legacy
   *  home; the round-trip is value-equivalent, not shape-exact) */
  derived?: DerivedDecl
}

export interface LegacyTemplateData {
  root: LegacyNodeData
  children?: LegacyNodeData[]
  component?: LegacyComponentBinding | LegacyComponentBinding[]
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
  /** content nodes (template.children + payload items) — contentNodes-owned,
   *  family-'in-tree' via the permanent-owner token (P3 §10.ad/F-13) */
  content: Node[]
  /** K4 — always-present additive warnings channel */
  warnings: TranslatedWarning[]
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

/** Permanent-owner family edge (chain → 'rootNode' / 'contentNodes' ⇒ in-tree). */
function attachToPermanentOwner(node: Node, target: 'rootNode' | 'component' | 'contentNodes'): void {
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

/** Focused per-warning console.warn + additive K4 channel entry. */
function warn(warnings: TranslatedWarning[], code: string, path: string | undefined, detail: string): void {
  warnings.push(path !== undefined ? { code, path } : { code })
  const at = path !== undefined ? ` at ${path}` : ''
  console.warn(`[legacy-translate] ${code}${at}: ${detail}`)
}

/** K8 AP13 — the closed 3-set; legacy lifecycle hook names are deliberately
 *  excluded (no mapping), guarded at translate with `handler-phase-unknown`. */
const LEGACY_HANDLER_PHASES: ReadonlySet<string> = new Set(['before-compile', 'after-compile', 'after-render'])

function baseFrom(
  nodeData: LegacyNodeData,
  derived: DerivedDecl | undefined,
  warnings: TranslatedWarning[],
  path: string,
): NodeBaseData {
  const base: NodeBaseData = {}
  if (typeof nodeData.type === 'string') base.type = nodeData.type
  if (nodeData.content !== undefined) base.content = nodeData.content
  if (nodeData.props !== undefined) base.props = nodeData.props
  if (nodeData.css !== undefined) base.css = nodeData.css
  if (nodeData.handlers !== undefined) {
    // legacy handler bodies may arrive as FUNCTION SOURCE (a string) — the
    // backend stores loadable handler definitions as text and the render
    // process instantiates them at the translation boundary
    const kept: LegacyHandlerDef[] = []
    nodeData.handlers.forEach((h, i) => {
      const hp = `${path}.handlers[${i}]`
      // K8 AP13 — unknown lifecycle phase → warn + skip (never dispatch)
      if (h.phase !== undefined && !LEGACY_HANDLER_PHASES.has(h.phase)) {
        warn(warnings, 'handler-phase-unknown', hp, `phase "${String(h.phase)}" is not a supported lifecycle phase; handler definition skipped`)
        return
      }
      // K8 NP11 — body neither function nor string → warn + skip (TR-F2
      // downgrade of the old silent passthrough)
      if (h.body !== undefined && typeof h.body !== 'function' && typeof h.body !== 'string') {
        warn(warnings, 'handler-body-invalid', hp, 'body must be a function or a function-source string; handler definition skipped')
        return
      }
      if (typeof h.body === 'string') {
        // string → new Function instantiation; a body that fails to compile
        // (syntax error or non-function evaluation) warns + skips — TR-F2:
        // per-definition content is never a throw at translate
        try {
          kept.push({ ...h, body: instantiateHandlerBody(h.body) })
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          warn(warnings, 'handler-body-invalid', hp, `body string failed to instantiate (${reason}); handler definition skipped`)
        }
        return
      }
      kept.push(h)
    })
    base.handlers = kept
  }
  if (derived !== undefined) {
    // schema-boundary guard (derived-state.md §7): malformed legacy derived
    // data throws `derived-invalid` at translate, never reaches compile
    validateDerived(derived)
    base.derived = derived
  }
  return base
}

/**
 * Instantiate a legacy handler body shipped as function source.
 *
 * The legacy format lets trusted backends store handler definitions as TEXT
 * (`body: "function (c) { … }"` / `"(c) => …"`) and load them from the DB
 * into the envelope; the render process compiles the string back into a live
 * function here.
 *
 * SECURITY: `new Function` executes arbitrary code at translate time. The
 * renderer performs NO authorization of its own — the backend/DB layer that
 * accepts loadable handler definitions MUST gate writes to
 * admin/trusted-developer only.
 */
function instantiateHandlerBody(src: string): (...args: unknown[]) => unknown {
  const fn = new Function(`return (${src})`)()
  if (typeof fn !== 'function') {
    throw new Error(`legacy-handler-body: "${src}" does not evaluate to a function`)
  }
  return fn
}

/** One planned component binding: the anchor to create + the (optional)
 *  local-apply synthesis + the persisted apply path (K5 translate half). */
interface BindingPlan {
  reference: string
  role: 'source' | 'target'
  value?: unknown
  applyPath?: string | undefined
  synthesized?: DerivedDecl | undefined
}

/** K8 NP1/D7 — target-syntax edges (component-target-skipped): `props.`,
 *  `props:name`, `props.name.`, bare `props`, dotted `props.a.b` keys. */

/** K8 NP1 — flat known-vocabulary targets (recognition-only gap,
 *  component-target-gap): every §2.1 vocabulary path EXCEPT `props.<key>`.
 *  `css.style.<key>` / `handlers.<event>` add the dotted member rows. */
const KNOWN_GAP_TARGETS: ReadonlySet<string> = new Set([
  'type', 'content', 'children', 'props', 'css', 'css.id', 'css.classes', 'css.style', 'handlers', 'component',
])

/** K1/K2 — classify one `target` string: returns the apply path + synthesized
 *  derived declaration for the flat `props.<key>` seam, or an empty apply for
 *  a warn+skip / recognition-only gap (the anchor is ALWAYS kept). */
function classifyTarget(
  target: string,
  reference: string,
  authoredDerived: DerivedDecl | undefined,
  warnings: TranslatedWarning[],
  path: string,
): { applyPath?: string; synthesized?: DerivedDecl } {
  if (target.startsWith('props.')) {
    const rest = target.slice('props.'.length)
    if (rest.length === 0) {
      warn(warnings, 'component-target-skipped', path, `target "${target}": empty props key (syntax edge); no apply`)
      return {}
    }
    if (rest.includes('.')) {
      warn(warnings, 'component-target-skipped', path, `target "${target}": dotted props keys have no write seam; no apply`)
      return {}
    }
    const key = rest
    if (key === 'id') {
      warn(warnings, 'component-target-skipped', path, `target "${target}": props.id collides with the reserved derived key; no apply`)
      return {}
    }
    if (reference.includes('.')) {
      warn(warnings, 'component-target-skipped', path, `reference "${reference}" is dotted — bindings.<ref> synthesis is impossible; no apply`)
      return {}
    }
    if (authoredDerived?.props?.[key] !== undefined) {
      // K2 — authored-derived wins: skip synthesis, no warn (deliberate)
      return {}
    }
    return { applyPath: target, synthesized: { props: { [key]: { $: `bindings.${reference}` } } } }
  }
  if (target === 'props' || target.startsWith('props:')) {
    warn(warnings, 'component-target-skipped', path, `target "${target}": malformed props form (syntax edge); no apply`)
    return {}
  }
  if (KNOWN_GAP_TARGETS.has(target) || /^css\.style\.[^.\s]+$/.test(target) || /^handlers\.[^.\s]+$/.test(target)) {
    warn(warnings, 'component-target-gap', path, `target "${target}" is a valid legacy injection path with no translate-time seam (recognition only); no apply`)
    return {}
  }
  warn(warnings, 'component-target-gap', path, `target "${target}" is not a known legacy target path; no apply`)
  return {}
}

/**
 * K1–K8 binding pipeline for ONE node's `component` value (single binding or
 * K7 array). Runs the K3 vacuous filter and the K8 pre-anchor duplicate
 * guards over the normalized list, then plans anchors + synthesis per
 * binding. Never throws for binding content (TR-F2).
 */
function planBindings(
  component: unknown,
  authoredDerived: DerivedDecl | undefined,
  warnings: TranslatedWarning[],
  path: string,
): { plans: BindingPlan[]; count: number } {
  const plans: BindingPlan[] = []
  if (component === undefined || component === null) return { plans, count: 0 }
  // K7 array form + K3 Array.isArray carve-out: `component: []` is a valid
  // empty multi-binding list, NOT a vacuous binding
  const list: unknown[] = Array.isArray(component) ? component : [component]
  const seenReferences = new Set<string>()
  const seenTargets = new Set<string>()
  for (const raw of list) {
    const binding = (typeof raw === 'object' && raw !== null ? raw : null) as LegacyComponentBinding | null
    const reference = binding?.reference
    // K3 — vacuous trigger: reference must be a non-empty string
    if (typeof reference !== 'string' || reference.length === 0) {
      warn(warnings, 'component-binding-empty', path, 'binding lacks a non-empty string `reference`; no anchors created')
      continue
    }
    // K8 — duplicate reference: keep first, block the rest pre-anchor
    if (seenReferences.has(reference)) {
      warn(warnings, 'component-duplicate-reference', path, `reference "${reference}" is already bound on this node; duplicate blocked`)
      continue
    }
    seenReferences.add(reference)
    const target = typeof binding!.target === 'string' && binding!.target.length > 0 ? binding!.target : undefined
    // K8 — duplicate exact target path: keep first, block the rest pre-anchor
    if (target !== undefined) {
      if (seenTargets.has(target)) {
        warn(warnings, 'component-duplicate-target', path, `target "${target}" is already bound on this node; duplicate blocked`)
        continue
      }
      seenTargets.add(target)
    }
    const plan: BindingPlan = { reference, role: binding!.value !== undefined ? 'source' : 'target' }
    if (binding!.value !== undefined) plan.value = binding!.value
    if (target !== undefined) {
      const t = classifyTarget(target, reference, authoredDerived, warnings, path)
      plan.applyPath = t.applyPath
      plan.synthesized = t.synthesized
    }
    plans.push(plan)
  }
  return { plans, count: plans.length }
}

/** Merge a plan's synthesized derived declarations into a base declaration
 *  (authored-derived wins — existing keys are never overridden). */
function mergeSynthesized(base: DerivedDecl | undefined, plans: BindingPlan[]): DerivedDecl | undefined {
  let merged = base
  for (const plan of plans) {
    if (plan.synthesized?.props) merged = mergeDecl(merged, plan.synthesized)
  }
  return merged
}

/** Merge an extra declaration into a base one, skipping keys that already
 *  exist (authored wins, no duplicate keys). */
function mergeDecl(base: DerivedDecl | undefined, extra: DerivedDecl): DerivedDecl | undefined {
  if (!extra.props) return base
  const props: Record<string, DerivedExpr> = { ...(base?.props ?? {}) }
  for (const [key, value] of Object.entries(extra.props)) {
    if (!(key in props)) props[key] = value
  }
  return { props }
}

/** Create the component anchors for the planned bindings (source for a
 *  provider, target for a consumer) and persist the K5 apply path. */
function applyPlans(node: Node, plans: BindingPlan[], hub: LinkConfigNameHub): void {
  for (const plan of plans) {
    const link = hub.linkFor(plan.reference, 'component')
    const options = plan.applyPath !== undefined ? { applyPath: plan.applyPath } : {}
    if (plan.role === 'source') {
      const a = node.addAnchor('source', plan.reference, options, link)
      if (a !== null && plan.value !== undefined) a.value = plan.value
    } else {
      node.addAnchor('target', plan.reference, options, link)
    }
  }
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
  warnings: TranslatedWarning[],
  path: string,
  opts: { asContentRoot?: boolean; extraDerived?: DerivedDecl } = {},
): Node {
  // component bindings (K1–K8): planned BEFORE construction so the
  // synthesized derived merge rides the node's base data ("authored-derived
  // wins", review doc §2.2 K2)
  const { plans } = planBindings(data.component, data.derived, warnings, path)
  let derived = mergeSynthesized(data.derived, plans)
  if (opts.extraDerived) derived = mergeDecl(derived, opts.extraDerived)
  const node = new Node(baseFrom(data, derived, warnings, path), hub, mintNodeId(), opts.asContentRoot === true)
  nodes.push(node)

  // P3 §10.ad (F-13) — contentNodes-ownership minting: every content payload
  // root (and template.children root) is owned by the contentNodes permanent
  // owner at translate — the content root is family-'in-tree' (node.ts:213)
  // and the runtime fork-stress census counts it in-tree. nodeToLegacy
  // STRIPS the minted anchor on reverse (legacy round-trips stay clean).
  if (opts.asContentRoot === true) attachToPermanentOwner(node, 'contentNodes')

  // placement (PlacementConfig) → container/content anchors on the shared
  // per-name placement Link (P3 §1.1 — producer 'container' role from
  // placementName; consumer 'content' role, one anchor per requested name in
  // preference order). activePlacement is DERIVED (§2.5) — never minted.
  const placement = data.placement
  if (placement) {
    // producer side: placementName → 'container' anchor
    if (typeof placement.placementName === 'string' && placement.placementName.length > 0) {
      if (placement.placementName.includes('#')) {
        warn(warnings, 'placement-name-invalid', path, `placementName "${placement.placementName}" contains '#': container anchor skipped (P3 §1.3)`)
      } else {
        const plink = hub.linkFor(placement.placementName, 'placement')
        node.addAnchor('container', placement.placementName, {}, plink)
      }
    }
    // consumer side: targetPlacement → ordered 'content' anchors (P3 §1.2).
    // Back-compat: the old mis-typed STRING shape is coerced to [string]
    // with a warn; anything else is rejected with a warn and skipped.
    if (placement.targetPlacement !== undefined && placement.targetPlacement !== null) {
      const raw = placement.targetPlacement
      let names: string[] = []
      if (typeof raw === 'string') {
        warn(warnings, 'placement-string-coerced', path, `targetPlacement "${raw}" is the old string shape; coerced to [string] (legacy type is string[])`)
        names = [raw]
      } else if (Array.isArray(raw)) {
        names = raw
      } else {
        warn(warnings, 'placement-target-invalid', path, `targetPlacement must be a string or string[]; field skipped`)
      }
      // K8-class guard across the new minting: duplicate name → warn,
      // keep-first, skip the rest (consistent with component-duplicate-reference)
      const seen = new Set<string>()
      for (const name of names) {
        if (typeof name !== 'string' || name.length === 0) {
          warn(warnings, 'placement-name-invalid', path, `targetPlacement entry "${String(name)}" is not a valid placement name; binding skipped (P3 §1.3)`)
          continue
        }
        if (name.includes('#')) {
          warn(warnings, 'placement-name-invalid', path, `targetPlacement "${name}" contains '#': binding skipped (P3 §1.3)`)
          continue
        }
        if (seen.has(name)) {
          warn(warnings, 'placement-duplicate-reference', path, `targetPlacement "${name}" is already requested on this node; duplicate skipped (keep-first)`)
          continue
        }
        seen.add(name)
        const plink = hub.linkFor(name, 'placement')
        node.addAnchor('content', name, {}, plink)
      }
    }
  }

  applyPlans(node, plans, hub)

  // children (NodeData[]) → parent-child anchors in array order (priority)
  if (Array.isArray(data.children)) {
    data.children.forEach((childData, i) => {
      const child = translateNodeData(childData, hub, nodes, warnings, `${path}.children[${i}]`)
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
  const warnings: TranslatedWarning[] = []
  const template = doc.template

  // template.component binding on the root itself (K6/K7): planned before the
  // root's construction so its synthesis rides the root's base data
  const rootBinding = template.component
  const rootPlan = planBindings(rootBinding, template.root.derived, warnings, 'root')
  const rootSynthesis = mergeSynthesized(undefined, rootPlan.plans)

  // root with its own default children (stored in the root itself)
  const root = translateNodeData(template.root, hub, nodes, warnings, 'root', {
    ...(rootSynthesis !== undefined ? { extraDerived: rootSynthesis } : {}),
  })
  attachToPermanentOwner(root, 'rootNode')

  // K6 — a value-carrying root binding is a SOURCE (provider) anchor; the
  // dead-value target anchor of the pre-kernel translator is gone. A
  // value-less binding stays a target consumer.
  applyPlans(root, rootPlan.plans, hub)

  // content nodes: template.children + content payloads — contentNodes-owned
  // (family-'in-tree' via the permanent-owner token, P3 §10.ad/F-13; NOT
  // attached under the root). metadata/userData surfaced from the first
  // payload. Registered as payload-owned content: they persist in the
  // background while unplaced (placement may return) and are dropped with
  // their payload.
  const content: Node[] = []
  let metadata: unknown
  let userData: unknown
  if (Array.isArray(template.children)) {
    template.children.forEach((childData, i) => {
      const n = translateNodeData(childData, hub, nodes, warnings, `template.children[${i}]`, { asContentRoot: true })
      registerContentNode(n)
      content.push(n)
    })
  }
  if (Array.isArray(doc.content)) {
    doc.content.forEach((payload, p) => {
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.content)) {
        throw new Error('legacy-payload-mismatch: payload requires content: NodeData[]')
      }
      if (metadata === undefined) metadata = payload.metadata
      if (userData === undefined) userData = payload.userData
      payload.content.forEach((contentData, i) => {
        const n = translateNodeData(contentData, hub, nodes, warnings, `content[${p}].content[${i}]`, { asContentRoot: true })
        registerContentNode(n)
        content.push(n)
      })
    })
  }

  // clientConfig: legacy run* gates → adapter + persistence
  const cfg = doc.clientConfig
  let adapter = 'dom'
  let persistence = false
  if (cfg && typeof cfg === 'object') {
    if (cfg.runInstantiation === true) adapter = 'ssr'
    if (cfg.runMonitoring === true) persistence = true
  }

  return { root, nodes, content, warnings, metadata, userData, clientConfig: { adapter, persistence } }
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
  // component anchors FIRST — both the N1 derived strip and the K5 emission
  // key off them (K5: the legacy `target` field is the persisted apply path)
  const compAnchors = node.anchors.filter(
    (a) => (a.role === 'target' || a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string',
  )
  // the MERGED derived declaration ships flat (DECIDED — layers have no
  // legacy home; the round-trip is value-equivalent)
  const derived = node.derived
  if (derived !== undefined) {
    // N1 — strip the translate-synthesized K2 machinery: a derived key whose
    // name matches a component anchor's applyPath `props.<key>` suffix AND
    // whose value is the synthesized `{$: 'bindings.<ref>'}` shape was created
    // at translate, never authored. Authored derived stays. (In every
    // translate-reachable state synthesis and applyPath coincide — K2's
    // authored-derived-wins carve-out skips BOTH — so key+shape match is
    // exact; the shape check guards runtime-added anchors.)
    const props: Record<string, DerivedExpr> = derived.props ? { ...derived.props } : {}
    for (const a of compAnchors) {
      const applyPath = a.options.applyPath
      if (typeof applyPath !== 'string' || !applyPath.startsWith('props.')) continue
      const key = applyPath.slice('props.'.length)
      const v = props[key]
      if (v !== undefined && typeof v === 'object' && v !== null && !Array.isArray(v)) {
        const expr = v as { $?: unknown }
        if (expr.$ === `bindings.${a.target}`) delete props[key]
      }
    }
    data.derived = Object.keys(props).length > 0 ? { props } : {}
  }
  const rawHandlers = node.handlers as unknown as LegacyHandlerDef[] | undefined
  if (rawHandlers && rawHandlers.length > 0) {
    data.handlers = rawHandlers.map((h) => {
      // live function bodies ship back as their SOURCE (so the doc round-trips
      // through the string-body instantiation); native/bound code has no
      // recoverable source and is omitted
      let body = h.body
      if (typeof h.body === 'function') {
        const src = h.body.toString()
        body = /\{\s*\[native code\]\s*\}/.test(src) ? undefined : src
      }
      return { name: h.name, ...(h.event ? { event: h.event } : {}), ...(h.phase ? { phase: h.phase } : {}), ...(body !== undefined ? { body } : {}) }
    })
  }
  // K5 — component bindings back, ONE binding per component anchor (in anchor
  // order, preserving the K7 array form). The legacy `target` field is the
  // persisted apply path, emitted ONLY when `options.applyPath` exists:
  //   consumer + applyPath → { reference, target }
  //   provider + applyPath → { reference, value, target }
  //   no applyPath        → current emission ({ reference } / { reference, value })
  // Two runtime-only anchor shapes are legacy-unexpressible and are DROPPED:
  //   - a name-target (no applyPath) coexisting with a provider anchor — the
  //     old two-name duplex is gone; `target` means apply path, never a
  //     second component name (never emit a two-name duplex)
  //   - a second anchor for an already-emitted reference — legacy rejects
  //     duplicate references (K8 blocks them pre-anchor on re-translate), so
  //     keep the first and drop the rest
  const bindings: LegacyComponentBinding[] = []
  const hasProvider = compAnchors.some((a) => a.role === 'source' || a.role === 'duplex')
  const seenReferences = new Set<string>()
  for (const a of compAnchors) {
    const reference = a.target as string
    const applyPath = typeof a.options.applyPath === 'string' ? a.options.applyPath : undefined
    const isProvider = a.role === 'source' || a.role === 'duplex'
    if (!isProvider && applyPath === undefined && hasProvider) continue
    if (seenReferences.has(reference)) continue
    seenReferences.add(reference)
    const binding: LegacyComponentBinding = { reference }
    if (isProvider && a.value !== undefined) binding.value = a.value
    if (applyPath !== undefined) binding.target = applyPath
    bindings.push(binding)
  }
  if (bindings.length === 1) data.component = bindings[0]!
  else if (bindings.length > 1) data.component = bindings
  // P3 §6.2 — reverse placement emission: the container anchor (placementName)
  // and the ordered content anchors (targetPlacement: string[] in MINT order —
  // the node's anchors array preserves the preference order). activePlacement
  // is the DERIVED read (§2.5): the FIRST name with at least one known
  // container, emitted only when it exists. The minted contentNodes parent
  // anchor is never emitted (legacy has no representation for the token).
  const placement: Record<string, string | string[]> = {}
  const containerAnchor = node.anchors.find((a) => a.role === 'container' && typeof a.target === 'string')
  if (containerAnchor) placement.placementName = containerAnchor.target as string
  const contentAnchors = node.anchors.filter((a) => a.role === 'content' && typeof a.target === 'string')
  if (contentAnchors.length > 0) {
    placement.targetPlacement = contentAnchors.map((a) => a.target as string)
    for (const a of contentAnchors) {
      if (a.link.anchorsOf('container').length > 0) {
        placement.activePlacement = a.target as string
        break
      }
    }
  }
  if (Object.keys(placement).length > 0) data.placement = placement
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
