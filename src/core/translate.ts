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
// (archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md §2.2 + Appendix E):
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
import { Node, mintNodeId, ancestorConsumesZone } from './node.js'
import { Link } from './link.js'
import { registerContentNode, registerDefPrototypes, registerDefRootPrototype, defRootPrototypeFor, registerHandlerDef, setTranslateUserData } from './registry.js'
import { wrapLegacyHandler } from './legacy-handlers.js'
import { validateDerived } from './derived.js'
import type { Anchor, DerivedDecl, DerivedExpr, HookKind, LinkConfigNameHub, NodeBaseData } from './types.js'
export type LegacyHandlerPhase = 'before-compile' | 'after-compile' | 'after-render'

export interface LegacyHandlerDef {
  name: string
  event?: string
  phase?: LegacyHandlerPhase
  /** FORMAT MARKER (decision 4, 2026-08-15) — the body's data-format
   *  convention: 'legacy' bodies are (event, context) and get wrapped by the
   *  bridge; 'modern' bodies are raw (ctx, ...args). INLINE bodies default
   *  to 'modern' (unwrapped); seam-installed defs default to 'legacy'
   *  (wrapped). An explicit per-def field overrides the default and persists
   *  on reverse (K5-style). */
  format?: 'legacy' | 'modern'
  /** internal — the ORIGINAL body source of an inline legacy-wrapped
   *  handler: reverse re-emits it (never the bridge wrapper source), so the
   *  round-trip reproduces the same wrap. */
  sourceBody?: string
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
  /** D1 — ARRAY canonical (each entry maps through the single-entry logic),
   *  single-object convenience kept */
  placement?: LegacyPlacementConfig | LegacyPlacementConfig[]
  /** single binding OR the K7 array form (multiple bindings per node) */
  component?: LegacyComponentBinding | LegacyComponentBinding[]
  content?: unknown
  /** D5 — ONLY child nodes; a non-ARRAY value (single NodeData OBJECT, string,
   *  …) warns `children-shape-invalid` + the field is skipped */
  children?: LegacyNodeData[]
  props?: Record<string, unknown>
  handlers?: LegacyHandlerDef[]
  /** D3 — css.style may be the legacy Record<string,string> OBJECT; translate
   *  serializes it to a kebab-case `k: v;` CSS string */
  css?: { id?: string; classes?: string[]; style?: string | Record<string, string>; cssDef?: unknown }
  versions?: unknown
  /** the derived RULE (never the baked values) — flat legacy home for the
   *  merged declaration (derived-state.md §2/§8: layers have no legacy
   *  home; the round-trip is value-equivalent, not shape-exact) */
  derived?: DerivedDecl
  /** HOOKS (hooks-map-review.md §7, contract amendment B) — the
   *  value-provider slot: a STRING-ARRAY of same-node provider component
   *  names (each names a `component` binding with a `reference` matching
   *  the entry — the `component-source-duplicate` guard means at most one
   *  anchor per name). The names round-trip; the VALUE lives in the
   *  component binding (the hook write mirrors the provider anchor's
   *  value — ONE source). A non-array field, or a non-string member,
   *  warns `hooks-shape-invalid` + skips (the children-shape-invalid
   *  discipline). */
  hooks?: string[]
  /** HOOKS-ARRAY (§9.4 item 1, CONTRACT AMENDMENT C) — the kind
   *  discriminator for the hooks declared in `hooks`: a name→HookKind
   *  record mapping declared hook names to their operation kind
   *  (`'value'`/`'component'`/`'placement'`). A non-object field warns
   *  `hooks-kind-shape-invalid` + is skipped; a non-string kind value warns
   *  `hooks-kind-shape-invalid` + skips that entry; a kind outside the
   *  closed union warns `hooks-kind-unknown` + skips that entry. A hooks
   *  name with NO hooksKind entry is implicitly `'value'` (documented
   *  default — NOT a silent reclassification). The record round-trips
   *  (baseFrom/nodeToLegacy/serialize/loadState). */
  hooksKind?: Record<string, HookKind>
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
  /** D2 — ARRAY-ONLY (ContentPayload[]); ANY other shape warns
   *  `payload-shape-obsolete` + is skipped, never silent */
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

/** HANDLER-SEAM — legacy lifecycle hook names used as `handlers.<phase>`
 *  event suffixes: warned + skipped (N5 — the 3-phase set is closed; the
 *  legacy names have no event home). Mirrors the old Handler.ts phase list. */
const LEGACY_LIFECYCLE_EVENTS: ReadonlySet<string> = new Set([
  'beforeAssembly', 'afterAssembly', 'beforeRender', 'afterRender',
  'beforeInstantiate', 'afterInstantiate', 'beforePreprocessing',
  'afterPreprocessing', 'beforeValidation', 'afterValidation',
  'beforePostprocessing', 'afterPostprocessing', 'beforeComponentRouting',
  'afterComponentRouting', 'beforeSlotAssembly', 'afterSlotAssembly',
])

/** K8 AP13 — the closed 3-set; legacy lifecycle hook names are deliberately
 *  excluded (no mapping), guarded at translate with `handler-phase-unknown`. */
const LEGACY_HANDLER_PHASES: ReadonlySet<string> = new Set(['before-compile', 'after-compile', 'after-render'])

/** D3/F8 — camelCase key → kebab-case; vendor-prefixed heads get the leading
 *  dash (`WebkitTransform` → `-webkit-transform`, `msTransition` →
 *  `-ms-transition`). Exported for the emit-side cssDef rule serializer
 *  (render-helpers) — one canonical kebab implementation. */
export function kebabKey(key: string): string {
  const dashed = key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)
  return dashed.startsWith('ms-') && key.startsWith('ms') ? `-${dashed}` : dashed
}

/** D3/F8 (reverse half) — kebab-case key back to the camelCase object key;
 *  a vendor-prefixed key (leading dash) capitalizes its first segment too
 *  (`-webkit-transform` → `WebkitTransform`). */
function camelKey(key: string): string {
  const parts = key.split('-').filter((p) => p.length > 0)
  if (parts.length === 0) return ''
  const start = key.startsWith('-') ? 1 : 0
  let out = parts[0]!
  for (let i = 1; i < parts.length; i++) {
    out += parts[i]![0]!.toUpperCase() + parts[i]!.slice(1)
  }
  if (start === 1) out = out[0]!.toUpperCase() + out.slice(1)
  return out
}

/** D3/F8 — serialize a `Record<string,string>` style OBJECT into the
 *  kebab-case `k: v;` CSS string the adapters/parser can interpret. The empty
 *  object serializes to `''`. Exported for the emit/ops units to reuse — the
 *  adapters never see the raw object. */
export function serializeStyle(style: Record<string, unknown>): string {
  const parts: string[] = []
  for (const [key, value] of Object.entries(style)) {
    parts.push(`${kebabKey(key)}: ${String(value)};`)
  }
  return parts.join(' ')
}

/** D3/F7 — parse a serialized style STRING back to the object; `;` splits
 *  entries EXCEPT inside `url(...)`; each entry splits on the FIRST `:` so
 *  values containing `:` survive. */
export function parseStyle(str: string): Record<string, string> {
  const out: Record<string, string> = {}
  const parts: string[] = []
  let buf = ''
  let urlDepth = 0
  for (let i = 0; i < str.length; i++) {
    const ch = str[i]!
    if (urlDepth === 0) {
      if (str.startsWith('url(', i)) {
        urlDepth = 1
        buf += 'url('
        i += 3
        continue
      }
      if (ch === ';') {
        parts.push(buf)
        buf = ''
        continue
      }
    } else if (ch === '(') {
      urlDepth++
    } else if (ch === ')') {
      urlDepth--
    }
    buf += ch
  }
  if (buf.trim() !== '') parts.push(buf)
  for (const part of parts) {
    const idx = part.indexOf(':')
    if (idx <= 0) continue
    const key = camelKey(part.slice(0, idx).trim())
    if (key.length === 0) continue
    out[key] = part.slice(idx + 1).trim()
  }
  return out
}

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
  if (nodeData.css !== undefined) {
    // D3 — a css.style OBJECT is serialized AT TRANSLATE into the kebab-case
    // `k: v;` CSS string (F8); the raw object must never reach the adapters.
    const css = { ...nodeData.css }
    if (typeof css.style === 'object' && css.style !== null) {
      css.style = serializeStyle(css.style as Record<string, string>)
    }
    base.css = css
  }
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
      // FORMAT MARKER (decision 4) — inline bodies default to MODERN
      // (unwrapped, the demo surface's convention); an explicit 'legacy'
      // format wraps the body via the bridge (the (event, context) arg order
      // restored); any other format value warns + falls back to the default.
      const fmt = h.format
      const format: 'legacy' | 'modern' | undefined = fmt === 'legacy' || fmt === 'modern' ? fmt : undefined
      if (fmt !== undefined && format === undefined) {
        warn(warnings, 'handler-format-invalid', hp, `format "${String(fmt)}" is not 'legacy' or 'modern'; falling back to the inline default (modern)`)
      }
      if (typeof h.body === 'string') {
        // string → new Function instantiation; a body that fails to compile
        // (syntax error or non-function evaluation) warns + skips — TR-F2:
        // per-definition content is never a throw at translate
        try {
          const fn = instantiateHandlerBody(h.body)
          const { format: _authoredFormat, ...hRest } = h
          if (format === 'legacy') {
            // the wrapper is installed at translate; the ORIGINAL source is
            // kept (sourceBody) so reverse re-emits the authored body, never
            // the wrapper source
            kept.push({ ...hRest, format, body: wrapLegacyHandler(fn, h.event ?? h.name), sourceBody: h.body })
          } else {
            kept.push({ ...hRest, ...(format !== undefined ? { format } : {}), body: fn })
          }
        } catch (e) {
          const reason = e instanceof Error ? e.message : String(e)
          warn(warnings, 'handler-body-invalid', hp, `body string failed to instantiate (${reason}); handler definition skipped`)
        }
        return
      }
      const { format: _authoredFormat2, ...hRest } = h
      if (format === 'legacy' && typeof h.body === 'function') {
        kept.push({ ...hRest, format, body: wrapLegacyHandler(h.body, h.event ?? h.name) })
      } else {
        kept.push({ ...hRest, ...(format !== undefined ? { format } : {}), ...(h.body !== undefined ? { body: h.body } : {}) })
      }
    })
    base.handlers = kept
  }
  if (derived !== undefined) {
    // schema-boundary guard (derived-state.md §7): malformed legacy derived
    // data throws `derived-invalid` at translate, never reaches compile
    validateDerived(derived)
    base.derived = derived
  }
  if (nodeData.hooks !== undefined) {
    // HOOKS §7.2 pin 4 — the K4 unknown-key gap is closed FOR THIS FIELD:
    // `hooks` is a schema-known key with `hooks-shape-invalid` containment
    // (a non-array field, or a non-string member, warns + skips — the
    // children-shape-invalid discipline; never a silent drop)
    if (!Array.isArray(nodeData.hooks)) {
      warn(warnings, 'hooks-shape-invalid', path, 'hooks must be an array of hook names; field skipped')
    } else {
      const kept: string[] = []
      nodeData.hooks.forEach((h, i) => {
        if (typeof h !== 'string' || h.length === 0) {
          warn(warnings, 'hooks-shape-invalid', `${path}.hooks[${i}]`, 'a hook name must be a non-empty string; entry skipped')
          return
        }
        kept.push(h)
      })
      if (kept.length > 0) base.hooks = kept
    }
  }
  if (nodeData.hooksKind !== undefined) {
    // HOOKS-ARRAY §9.4 item 1 — the kind discriminator rides the schema
    // boundary with `hooks-kind-shape-invalid` / `hooks-kind-unknown`
    // containment (the hooks-shape-invalid discipline; never a silent drop).
    if (typeof nodeData.hooksKind !== 'object' || nodeData.hooksKind === null || Array.isArray(nodeData.hooksKind)) {
      warn(warnings, 'hooks-kind-shape-invalid', path, 'hooksKind must be a name→kind record; field skipped')
    } else {
      const kept: Record<string, HookKind> = {}
      for (const [name, kind] of Object.entries(nodeData.hooksKind)) {
        if (name.length === 0) {
          warn(warnings, 'hooks-kind-shape-invalid', `${path}.hooksKind`, 'a hook kind key must be a non-empty name; entry skipped')
          continue
        }
        if (typeof kind !== 'string' || kind.length === 0) {
          warn(warnings, 'hooks-kind-shape-invalid', `${path}.hooksKind.${name}`, 'a hook kind must be a non-empty string; entry skipped')
          continue
        }
        if (kind !== 'value' && kind !== 'component' && kind !== 'placement') {
          warn(warnings, 'hooks-kind-unknown', `${path}.hooksKind.${name}`, `unknown hook kind "${kind}" (value/component/placement); entry skipped`)
          continue
        }
        kept[name] = kind as HookKind
      }
      if (Object.keys(kept).length > 0) base.hooksKind = kept
    }
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
 *  local-apply synthesis + the persisted apply path (K5 translate half) +
 *  the D7 anchor-layer seam target (F17). */
interface BindingPlan {
  reference: string
  role: 'source' | 'target' | 'duplex'
  value?: unknown
  applyPath?: string | undefined
  synthesized?: DerivedDecl | undefined
  /** AUTH-SEAM — `handlers.afterAssembly` maps to the after-compile phase. */
  handlerPhase?: string | undefined
  /** HANDLER-SEAM (D6 un-park) — a `handlers.<event>` target's verbatim event
   *  suffix. */
  handlerEvent?: string | undefined
  /** D7/F17 — `type`/`content`/`children` seam targets: planned WITHOUT the
   *  component-target-gap warn; the seam target persists on the anchor
   *  options (`options.seam`) so assembly can distinguish seam candidates. */
  seam?: 'type' | 'content' | 'children' | undefined
}

/** K8 NP1/D7 — target-syntax edges (component-target-skipped): `props.`,
 *  `props:name`, `props.name.`, bare `props`, dotted `props.a.b` keys. */

/** K8 NP1 — flat known-vocabulary targets (recognition-only gap,
 *  component-target-gap): every §2.1 vocabulary path EXCEPT `props.<key>`.
 *  `css.style.<key>` / `handlers.<event>` add the dotted member rows.
 *  The D7 seam set `type`/`content`/`children` is EXCLUDED from the gap
 *  (they plan as seam candidates instead, F17). */
const KNOWN_GAP_TARGETS: ReadonlySet<string> = new Set([
  'props', 'css', 'css.id', 'css.classes', 'css.style', 'handlers', 'component',
])

/** K1/K2 — classify one `target` string: returns the apply path + synthesized
 *  derived declaration for the flat `props.<key>` seam, the D7 anchor-layer
 *  seam target for `type`/`content`/`children`, or an empty apply for
 *  a warn+skip / recognition-only gap (the anchor is ALWAYS kept). */
function classifyTarget(
  target: string,
  reference: string,
  authoredDerived: DerivedDecl | undefined,
  warnings: TranslatedWarning[],
  path: string,
): { applyPath?: string; synthesized?: DerivedDecl; seam?: 'type' | 'content' | 'children'; handlerEvent?: string; handlerPhase?: string } {
  if (target === 'type' || target === 'content' || target === 'children') {
    // D7/F17 — anchor-layer seam candidate: no gap warn, seam persisted
    return { seam: target }
  }
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
  if (/^handlers\.[^.\s]+$/.test(target)) {
    // HANDLER-SEAM (D6 un-park, 2026-08-15): the event suffix verbatim — no
    // gap warn. LEGACY LIFECYCLE names as the suffix warn handler-phase-
    // unknown + skip (N5 — the 3-phase set is closed; event-only reuse).
    const event = target.slice('handlers.'.length)
    if (LEGACY_LIFECYCLE_EVENTS.has(event)) {
      // AUTH-SEAM (2026-08-15): `afterAssembly` is the ONE legacy lifecycle
      // name with a semantic home in the new 3-phase set — the consumer's
      // ASSEMBLY is its after-compile pass, so the binding maps to the
      // after-compile PHASE (the N5 carve-out). The other names stay
      // warn+skip (no home).
      if (event === 'afterAssembly') {
        return { handlerPhase: 'after-compile' }
      }
      warn(warnings, 'handler-phase-unknown', path, `target "${target}": "${event}" is a legacy lifecycle phase, not an event; binding skipped (N5)`)
      return {}
    }
    return { handlerEvent: event }
  }
  if (KNOWN_GAP_TARGETS.has(target) || /^css\.style\.[^.\s]+$/.test(target)) {
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
    // S19 (user directive 2026-08-15): a binding with BOTH value and target
    // is a DUPLEX (provider + consumer on one anchor), not a source — the
    // self-provider seam form `{reference, value, target: <seam>}` must plan
    // a duplex anchor so the seam flag is READ (the seam-detection sites
    // key on target/duplex/source)
    const plan: BindingPlan = {
      reference,
      role: binding!.value !== undefined ? (target !== undefined ? 'duplex' : 'source') : 'target',
    }
    if (binding!.value !== undefined) {
      plan.value = binding!.value
      // HANDLER-SEAM (D6 un-park): a def-shaped value ({name, body}) registers
      // as a handler def by reference — K3 superseded for THIS shape only.
      // FORMAT MARKER (decision 4): an explicit `format: 'legacy'|'modern'`
      // registers with the def; the seam default is 'legacy' (wrapped); any
      // other format value warns handler-format-invalid + falls back.
      const v = binding!.value as { name?: unknown; body?: unknown; format?: unknown }
      if (typeof v === 'object' && v !== null && typeof v.name === 'string' && v.name.length > 0 && typeof v.body === 'string') {
        const fmt = v.format
        let format: 'legacy' | 'modern' = 'legacy'
        if (fmt === 'legacy' || fmt === 'modern') {
          format = fmt
        } else if (fmt !== undefined) {
          warn(warnings, 'handler-format-invalid', path, `format "${String(fmt)}" is not 'legacy' or 'modern'; falling back to the seam default (legacy)`)
        }
        registerHandlerDef(reference, { name: v.name, body: v.body, format })
      }
    }
    if (target !== undefined) {
      const t = classifyTarget(target, reference, authoredDerived, warnings, path)
      plan.applyPath = t.applyPath
      plan.synthesized = t.synthesized
      plan.seam = t.seam
      plan.handlerEvent = t.handlerEvent
      plan.handlerPhase = t.handlerPhase
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
 *  provider, target for a consumer) and persist the K5 apply path + the D7
 *  seam target (F17 — `options.seam`, the same persistence channel as K5). */
function applyPlans(node: Node, plans: BindingPlan[], hub: LinkConfigNameHub): void {
  for (const plan of plans) {
    const link = hub.linkFor(plan.reference, 'component')
    const options: Record<string, unknown> = {}
    if (plan.applyPath !== undefined) options.applyPath = plan.applyPath
    if (plan.seam !== undefined) options.seam = plan.seam
    if (plan.handlerEvent !== undefined) options.handlerEvent = plan.handlerEvent
    if (plan.handlerPhase !== undefined) options.handlerPhase = plan.handlerPhase
    if (plan.role === 'source' || plan.role === 'duplex') {
      const a = node.addAnchor(plan.role, plan.reference, options, link)
      if (a !== null && plan.value !== undefined) a.value = plan.value
    } else {
      node.addAnchor('target', plan.reference, options, link)
    }
  }
}

/**
 * D8/F16 + B2/B3 scoping — PRE-MINT a value-carrying def binding's
 * `value.children` — and, per the delivery-shape ruling (ALS-1b), the
 * DEF-ROOT — as out-of-tree prototype nodes under the 'component' permanent-
 * owner token (chain kind token/'component' → derived state 'prototype').
 * Minted at the def's own translate site; never attached to the host, never
 * content, family-'in-tree'-NEVER (a prototype is never compiled/renderable
 * on its own). The D7 seam's anchor layer materializes the child links from
 * these nodes at reconcileAnchors (ops-side).
 *
 * B2 scoping: ONLY seam-targeted defs and defs whose children are
 * DELIVERABLE child nodes mint. The fork-stress LINK method's children are
 * 1:1 re-typing SPECS (each carrying a `bind` key) of the consumer's REAL
 * children — never deliverable nodes; minting them as prototype nodes
 * polluted the fork-stress-data census (registered 4161 vs 4117) and broke
 * demo-smoke. A def name appearing in ANY BindingPlan with a seam target
 * (`type`/`content`/`children` — the pre-scanned seamRefs set) mints
 * regardless of child shape (the seam layer materializes those links FROM
 * the pre-minted prototypes, ops.md ALS-1).
 *
 * B3 (ALS-1b): a css-bearing def (classes/cssDef/style) additionally mints
 * its ROOT element as a 'component'-token prototype (type + css + family
 * child links to the def-children prototypes) — the element-level carrier of
 * the def's css (SED-1/SED-2). css-less defs mint no def-root (their seam
 * wiring passes the def children directly).
 */
function mintDefPrototypes(
  plans: BindingPlan[],
  hub: LinkConfigNameHub,
  nodes: Node[],
  warnings: TranslatedWarning[],
  path: string,
  seamRefs: ReadonlySet<string>,
): void {
  for (const plan of plans) {
    if ((plan.role !== 'source' && plan.role !== 'duplex') || plan.value === undefined) continue
    const value = plan.value
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const def = value as LegacyNodeData
    if (typeof def.type !== 'string') continue
    const hasChildren = Array.isArray(def.children) && def.children.length > 0
    if (!hasChildren && def.content === undefined && def.css === undefined) continue
    if (hasChildren) {
      const linkSpec = def.children!.every(
        (c) => c !== null && typeof c === 'object' && (c as { bind?: unknown }).bind !== undefined,
      )
      if (linkSpec && !seamRefs.has(plan.reference)) continue
    } else if (def.css === undefined) {
      // a content-bearing leaf def (no children, no css): nothing to mint —
      // the emission synthesizes the def-root element from the def data
      continue
    }
    const link = hub.linkFor(plan.reference, 'component')
    const minted: Node[] = []
    // B3/ALS-1b — the def-ROOT prototype: minted when the def carries css
    // (the element-level carrier of the def's css — SED-1/SED-2). Its family
    // children are the def-children prototypes (their chain still terminates
    // at the 'component' token via the def-root).
    if (def.css !== undefined && typeof def.css === 'object' && Object.keys(def.css).length > 0) {
      const defRootData: LegacyNodeData = { type: def.type, css: def.css }
      const defComponent = (def as { component?: unknown }).component
      if (defComponent !== undefined) {
        defRootData.component = defComponent as LegacyComponentBinding | LegacyComponentBinding[]
      }
      const defRoot = translateNodeData(defRootData, hub, nodes, warnings, `${path}.component.value`)
      attachToPermanentOwner(defRoot, 'component')
      registerDefRootPrototype(link, defRoot)
    }
    if (hasChildren) {
      const root = defRootPrototypeFor(link)
      def.children!.forEach((childData, i) => {
        // child-side attach: the def-children prototypes attach to the
        // def-root (or the 'component' token when no def-root exists)
        const child = translateNodeData(childData, hub, nodes, warnings, `${path}.component.value.children[${i}]`, undefined, new Set(), root ? { node: root, index: i } : undefined)
        if (!root) attachToPermanentOwner(child, 'component')
        minted.push(child)
      })
      // the D7 seam materialization wires these pre-minted prototypes onto the
      // seam consumers (ops.md ALS-1 — the child links materialize FROM them)
      if (minted.length > 0) registerDefPrototypes(link, minted)
    }
  }
}

/** D7/F17 (B2) — pre-scan the whole document for seam-targeted binding
 *  references (`component.target` in `type`/`content`/`children`, single or
 *  K7 array, node-level + `template.component`), so a def provider translated
 *  BEFORE its seam consumer still knows its children must be pre-minted. */
function collectSeamRefs(doc: LegacyInitialData): Set<string> {
  const refs = new Set<string>()
  const scanBinding = (b: LegacyComponentBinding | null | undefined): void => {
    if (b === null || typeof b !== 'object') return
    if (typeof b.reference !== 'string' || b.reference.length === 0) return
    if (b.target === 'type' || b.target === 'content' || b.target === 'children') {
      refs.add(b.reference)
    }
  }
  const scanNode = (data: LegacyNodeData): void => {
    if (data === null || typeof data !== 'object') return
    const comp = data.component
    if (comp !== undefined && comp !== null) {
      const list: LegacyComponentBinding[] = Array.isArray(comp) ? comp : [comp as LegacyComponentBinding]
      for (const b of list) scanBinding(b)
    }
    if (Array.isArray(data.children)) {
      for (const c of data.children) {
        if (c !== null && typeof c === 'object') scanNode(c)
      }
    }
  }
  const rootData = doc.template?.root
  if (rootData !== null && typeof rootData === 'object') scanNode(rootData)
  const templateComp = doc.template?.component
  if (templateComp !== undefined && templateComp !== null) {
    const list: LegacyComponentBinding[] = Array.isArray(templateComp) ? templateComp : [templateComp as LegacyComponentBinding]
    for (const b of list) scanBinding(b)
  }
  if (Array.isArray(doc.template?.children)) {
    for (const c of doc.template.children) {
      if (c !== null && typeof c === 'object') scanNode(c)
    }
  }
  if (Array.isArray(doc.content)) {
    for (const p of doc.content) {
      if (p === null || typeof p !== 'object') continue
      const payload = p as LegacyContentPayload
      if (Array.isArray(payload.content)) {
        for (const c of payload.content) {
          if (c !== null && typeof c === 'object') scanNode(c)
        }
      }
    }
  }
  return refs
}

/**
 * Translate one legacy NodeData subtree into Nodes, attaching children via
 * parent-child anchors and materializing placement/component anchors.
 * Returns every created node in tree order (parent before children).
 *
 * FAMILY ATTACH IS CHILD-SIDE (DEFECT #3-1 fix, 2026-08-14): the parent
 * passes itself + the child index down; the CHILD attaches itself to its
 * family parent EARLY in its own translate (right after construction) —
 * BEFORE its own placement minting — so the P3 §1.3 ancestor-name veto
 * predicate (`ancestorConsumesZone`, shared with the op-time half) walks a
 * LIVE parent chain at translate and the producer mint can veto. Content
 * roots (`opts.asContentRoot`) never take a family parent — the contentNodes
 * permanent-owner token is their only edge (F-13).
 */
function translateNodeData(
  data: LegacyNodeData,
  hub: LinkConfigNameHub,
  nodes: Node[],
  warnings: TranslatedWarning[],
  path: string,
  opts: { asContentRoot?: boolean; extraDerived?: DerivedDecl } = {},
  seamRefs: ReadonlySet<string> = new Set<string>(),
  parent: { node: Node; index: number } | undefined = undefined,
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

  // CHILD-SIDE family attach (DEFECT #3-1): the child attaches itself to its
  // family parent BEFORE its own placement minting, so the ancestor veto
  // walks a live chain. Content roots never take a family parent (the token
  // edge above is their only one).
  if (parent !== undefined && opts.asContentRoot !== true) attachChild(parent.node, node, parent.index)

  // placement (PlacementConfig | PlacementConfig[] — D1 ARRAY canonical) →
  // container/content anchors on the shared per-name placement Link (P3 §1.1
  // — producer 'container' role from placementName; consumer 'content' role,
  // one anchor per requested name in preference order). EVERY ARRAY ENTRY
  // maps through the single-entry logic independently (mint order = array
  // order); `placement: []` is a valid empty list (no warn); a NON-OBJECT
  // entry, or a non-array non-object placement value, warns
  // `placement-entry-invalid` (once per field) and skips that entry.
  // activePlacement is DERIVED (§2.5) — never minted.
  const rawPlacement = data.placement
  if (rawPlacement !== undefined && rawPlacement !== null) {
    const entries: unknown[] = Array.isArray(rawPlacement) ? rawPlacement : [rawPlacement]
    let invalidWarned = false
    for (const entry of entries) {
      if (typeof entry !== 'object' || entry === null) {
        if (!invalidWarned) {
          warn(warnings, 'placement-entry-invalid', path, `placement entry "${String(entry)}" is not a PlacementConfig object; entry skipped`)
          invalidWarned = true
        }
        continue
      }
      const placement = entry as LegacyPlacementConfig
      // producer side: placementName → 'container' anchor (P3 §1.3 ancestor
      // veto — DEFECT #3-1 fix: the child-side family attach above makes the
      // shared `ancestorConsumesZone` predicate live at translate; a producer
      // whose family ancestor would attempt to place into the zone (a `content`-role anchor for it) is NOT minted and
      // warns `placement-name-vetoed` — same semantics as the op-time half)
      if (typeof placement.placementName === 'string' && placement.placementName.length > 0) {
        if (placement.placementName.includes('#')) {
          warn(warnings, 'placement-name-invalid', path, `placementName "${placement.placementName}" contains '#': container anchor skipped (P3 §1.3)`)
        } else if (ancestorConsumesZone(node, placement.placementName)) {
          warn(warnings, 'placement-name-vetoed', path, `placementName "${placement.placementName}" is already offered by a family ancestor; container anchor skipped (P3 §1.3)`)
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
  }

  applyPlans(node, plans, hub)

  // D8/F16 — def children pre-minted at the def's own translate site
  // (B2 scoping: link-method bind-spec children never mint unless the def
  // is seam-targeted — the pre-scanned seamRefs set)
  mintDefPrototypes(plans, hub, nodes, warnings, path, seamRefs)

  // children (NodeData[]) → parent-child anchors in array order (priority).
  // D5/F14 — a non-ARRAY children value (single NodeData OBJECT, string, …)
  // warns `children-shape-invalid` + the field is SKIPPED — never
  // dual-parsed into content, never wrapped.
  if (data.children !== undefined) {
    if (Array.isArray(data.children)) {
      data.children.forEach((childData, i) => {
        // DEFECT #7 fix (stress round 3, 2026-08-15): a non-OBJECT ENTRY
        // inside a valid children array (null / number / string) must warn
        // `children-entry-invalid` and skip THAT entry only — the old
        // behavior crashed translate with an uncaught TypeError (whole-doc
        // abort, a fail-safe violation). The rest of the array still maps.
        if (childData === null || typeof childData !== 'object' || Array.isArray(childData)) {
          warn(warnings, 'children-entry-invalid', path, `children[${i}] is not a NodeData object; entry skipped (the rest of the array still maps)`)
          return
        }
        // CHILD-SIDE family attach (DEFECT #3-1): the child attaches itself
        // inside its own translate (before its placement minting) — the
        // parent passes itself + the index down
        const child = translateNodeData(childData, hub, nodes, warnings, `${path}.children[${i}]`, undefined, seamRefs, { node, index: i })
      })
    } else {
      warn(warnings, 'children-shape-invalid', path, 'children must be an array of NodeData; field skipped (never dual-parsed, never wrapped)')
    }
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
  // DEFECT #8 fix (stress round 3, 2026-08-15): a TRUTHY NON-OBJECT root
  // (42, an array) is a malformed envelope too — silently minting a default
  // div with zero warns was the defect. The root must be a NodeData OBJECT.
  if (
    !doc || typeof doc !== 'object' || !doc.template || typeof doc.template !== 'object'
    || !doc.template.root || typeof doc.template.root !== 'object' || Array.isArray(doc.template.root)
  ) {
    throw new Error('legacy-envelope-mismatch: expected { template: { root }, content?, clientConfig? }')
  }
  const hub = opts?.hub ?? defaultHub()
  const nodes: Node[] = []
  const warnings: TranslatedWarning[] = []
  const template = doc.template

  // D7/F17 (B2) — the seam-reference pre-scan: seam-targeted def names must
  // be known BEFORE the def provider's own translate site mints (a def
  // provider may precede its seam consumer in the document)
  const seamRefs = collectSeamRefs(doc)

  // template.component binding on the root itself (K6/K7): planned before the
  // root's construction so its synthesis rides the root's base data
  const rootBinding = template.component
  const rootPlan = planBindings(rootBinding, template.root.derived, warnings, 'root')
  const rootSynthesis = mergeSynthesized(undefined, rootPlan.plans)

  // root with its own default children (stored in the root itself)
  const root = translateNodeData(template.root, hub, nodes, warnings, 'root', {
    ...(rootSynthesis !== undefined ? { extraDerived: rootSynthesis } : {}),
  }, seamRefs)
  attachToPermanentOwner(root, 'rootNode')

  // K6 — a value-carrying root binding is a SOURCE (provider) anchor; the
  // dead-value target anchor of the pre-kernel translator is gone. A
  // value-less binding stays a target consumer.
  applyPlans(root, rootPlan.plans, hub)

  // D8/F16 — template.component def values pre-mint their children prototypes
  // at the root's own translate site too (B2 scoping)
  mintDefPrototypes(rootPlan.plans, hub, nodes, warnings, 'template.component', seamRefs)

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
      const n = translateNodeData(childData, hub, nodes, warnings, `template.children[${i}]`, { asContentRoot: true }, seamRefs)
      registerContentNode(n)
      content.push(n)
    })
  }
  // D2/F5 — doc.content is ARRAY-ONLY: ANY other shape (the obsolete
  // single-payload OBJECT, string/null/number/boolean) warns
  // `payload-shape-obsolete` at path 'content' and the payload is SKIPPED —
  // never silently dropped, never half-translated (TR-F2).
  if (doc.content !== undefined && !Array.isArray(doc.content)) {
    warn(warnings, 'payload-shape-obsolete', 'content', 'doc.content must be a ContentPayload[] array; payload skipped')
  } else if (Array.isArray(doc.content)) {
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

  // DECISION 6 (2026-08-15) — the legacy bridge's read-only
  // `supervisor.userData` member captures the translated userData here (the
  // first payload's value; undefined clears the slot).
  setTranslateUserData(userData)

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
  // HOOKS §7.2 pin 4 — the authored field round-trips (the derived/handlers
  // precedent): the NAMES ship on reverse; the VALUE ships via the component
  // binding (`binding.value = a.value` below — the mirror makes the anchor
  // the ONE value source). Re-translate reproduces the same field + value.
  if (node.base.hooks !== undefined && node.base.hooks.length > 0) data.hooks = [...node.base.hooks]
  // HOOKS-ARRAY §9.4 item 1 — the kind discriminator round-trips with the
  // names (baseFrom → nodeToLegacy → baseFrom stays anchor-identical).
  if (node.base.hooksKind !== undefined && Object.keys(node.base.hooksKind).length > 0) {
    data.hooksKind = { ...node.base.hooksKind }
  }
  if (node.css && Object.keys(node.css).length > 0) {
    // D3/F7 — a serialized style STRING ALWAYS parses back to the
    // Record<string,string> OBJECT (no provenance tracking: a pre-serialized
    // string-authored style becomes an object on save — the legacy format is
    // object-native). The string form is never re-emitted.
    const css = { ...node.css }
    if (typeof css.style === 'string' && css.style.length > 0) {
      css.style = parseStyle(css.style)
    }
    data.css = css
  }
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
  // DEFECT #14 fix (blind test #4): the seam handlers layer is
  // provenance-marked (sourceName 'handler-seam') and its bindings reverse via
  // the component anchors as `{reference, target: 'handlers.<event>'}` — it
  // must NOT leak into `nodeData.handlers` as a zombie wrapped-function.
  // Emit the AUTHORED (base) handlers plus any non-seam layer additions
  // (runtime user edits via state-slice targetProp 'handlers' — the R-3 leak).
  const rawHandlers = [
    ...((node.base.handlers as unknown as LegacyHandlerDef[] | undefined) ?? []),
    ...node.layers
      // DEFECT #17 fix (round 5): the seed-<id> mirror layer carries a copy
      // of base.handlers (sourceName undefined) — excluding it stops the
      // double-emission that compounded per round-trip (4→8→…)
      .filter((l) => l.sourceName !== 'handler-seam' && !l.id.startsWith('seed-') && Array.isArray(l.handlers))
      .flatMap((l) => (l.handlers as unknown as LegacyHandlerDef[])),
  ]
  if (rawHandlers.length > 0) {
    data.handlers = rawHandlers.map((h) => {
      // live function bodies ship back as their SOURCE (so the doc round-trips
      // through the string-body instantiation); native/bound code has no
      // recoverable source and is omitted. An inline LEGACY-WRAPPED handler
      // re-emits its ORIGINAL source (sourceBody — never the bridge wrapper
      // source) + the explicit format, so re-translate reproduces the wrap.
      let body = h.body
      if (typeof h.body === 'function') {
        const src = h.sourceBody ?? h.body.toString()
        body = /\{\s*\[native code\]\s*\}/.test(src) ? undefined : src
      }
      return {
        name: h.name,
        ...(h.event ? { event: h.event } : {}),
        ...(h.phase ? { phase: h.phase } : {}),
        ...(h.format !== undefined ? { format: h.format } : {}),
        ...(body !== undefined ? { body } : {}),
      }
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
    // S26 (DEFECT #6 fix, 2026-08-15) — `target` = the apply path OR the
    // D7 seam target (never a second name — K1-K8 invariant): a seam anchor
    // must reverse with `target: <seam>` so re-translate reproduces the
    // SAME seam plan (TR-H16). Without this the seam wiring was silently
    // lost on every save/load round-trip (re-render collapsed into the
    // P-EMIT-3 fill).
    if (applyPath !== undefined) binding.target = applyPath
    else if (typeof a.options.seam === 'string') binding.target = a.options.seam
    else if (typeof a.options.handlerEvent === 'string') binding.target = `handlers.${a.options.handlerEvent}`
    bindings.push(binding)
  }
  if (bindings.length === 1) data.component = bindings[0]!
  else if (bindings.length > 1) data.component = bindings
  // P3 §6.2 + D1/F2 — reverse placement emission: the container anchor
  // (placementName) and the ordered content anchors (targetPlacement: string[]
  // in MINT order — the node's anchors array preserves the preference order).
  // A node with TWO OR MORE container anchors (multi-producer — only
  // expressible via the D1 array) emits the canonical placement ARRAY, one
  // entry per container anchor in mint order, the node's content-anchor names
  // in the FIRST entry; one container (or none) emits the flat merged object.
  // activePlacement is the DERIVED read (§2.5): the FIRST name with at least
  // one known container, emitted only when it exists. The minted contentNodes
  // parent anchor is never emitted (legacy has no representation for the
  // token).
  const containerAnchors = node.anchors.filter((a) => a.role === 'container' && typeof a.target === 'string')
  const contentAnchors = node.anchors.filter((a) => a.role === 'content' && typeof a.target === 'string')
  const contentNames = contentAnchors.map((a) => a.target as string)
  let activePlacement: string | undefined
  for (const a of contentAnchors) {
    if (a.link.anchorsOf('container').length > 0) {
      activePlacement = a.target as string
      break
    }
  }
  if (containerAnchors.length > 1) {
    const entries: Record<string, string | string[]>[] = containerAnchors.map((c, i) => {
      const e: Record<string, string | string[]> = { placementName: c.target as string }
      if (i === 0) {
        if (contentNames.length > 0) e.targetPlacement = contentNames
        if (activePlacement !== undefined) e.activePlacement = activePlacement
      }
      return e
    })
    data.placement = entries
  } else {
    const placement: Record<string, string | string[]> = {}
    if (containerAnchors.length === 1) placement.placementName = containerAnchors[0]!.target as string
    if (contentNames.length > 0) {
      placement.targetPlacement = contentNames
      if (activePlacement !== undefined) placement.activePlacement = activePlacement
    }
    if (Object.keys(placement).length > 0) data.placement = placement
  }
  // ORIGIN-OWNER (§12.4.3) — a node whose `originLayer` is set is minted
  // (never authored): reverse-excluded like the runtimeMinted filter (the
  // authored envelope is base truth; the teardown's promotion clears the
  // marker — a promoted node reverses as authored content).
  const kids = node.children.filter((c) => !isContentRoot(c) && !c.runtimeMinted && c.originLayer === undefined)
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
