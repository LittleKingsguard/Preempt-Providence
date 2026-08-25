import type { ForkPathKey, RenderAdapter } from './render.js'
import type { NodeRef } from './types.js'
import { wireKey, bakeValue } from './render-helpers.js'

export interface FragmentDescriptor {
  openTag: string
  closeTag: string
  contentText: string
  isVoid: boolean
}

export const VOID_TAGS: ReadonlySet<string> = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
])

export interface DomAdapterOptions {
  onEvent?: (wire: NodeRef, event: Event) => void
}

const FORM_CONTROLS = new Set(['TEXTAREA', 'INPUT', 'SELECT'])
const VALUE_FORMS = new Set(['INPUT', 'TEXTAREA'])

export class DomAdapter implements RenderAdapter<HTMLElement, Document> {
  readonly wires: Map<string, HTMLElement> = new Map()
  readonly reused: Set<string> = new Set()
  private readonly mount: HTMLElement
  private readonly onEvent: ((wire: NodeRef, event: Event) => void) | undefined
  private stylesEl: HTMLElement | null = null
  /** RETAINED HANDLER MAP (2026-08-20 — the listener-removal un-park;
   *  doc: docs/specs/retained-handler-map-review.md). The EXACT function
   *  references this adapter passed to `addEventListener`, keyed by
   *  `wireKey(wire, forkKey)` then event name — `removeEventListener` needs
   *  the same reference object, and the previous anonymous-closure pattern
   *  kept none (removal was a parked no-op). Attach = REPLACE (remove the old
   *  exact fn first — supersedes the additive DOM-F5 contract), detach
   *  (`on:<event>` set with undefined) = `removeEventListener(evt, fn)` +
   *  delete, purge on removeEl AND on duplicate createEl (the old element
   *  stays mounted per DOM-F4 but must stop firing). Derived/replayable
   *  state in the same class as `wires` — a pure function of (op stream,
   *  onEvent), never pipeline semantics. */
  private readonly listeners = new Map<string, Map<string, { el: unknown; fn: (e: Event) => void }>>()
  /** A (2026-08-16) — the DETACHED INITIAL-BUILD batch: while a batch is
   *  open, created elements are HELD BACK from the live mount; the append
   *  ops re-parent them under their owners; `endBatch` mounts ONLY the roots
   *  (elements never re-parented by an append op) — one live-tree attachment
   *  per root instead of the create-then-move churn (every element was
   *  previously mount-appended at creation and then MOVED under its owner by
   *  the append op — 4095 useless live attachments on a 4095-node first
   *  render, each triggering the browser's incremental style machinery).
   *  Non-batched calls keep the immediate-attach behavior (DOM-H1). */
  private batchEls: HTMLElement[] | null = null
  /** D4 (DOM-H29) — per-adapter-instance rule-signature dedup set: a rule
   *  string whose exact signature was already appended is SKIPPED (the emit
   *  side already dedups per sweep; this is the boundary's defensive half). */
  private readonly stylesSeen = new Set<string>()

  constructor(mount: HTMLElement, opts: DomAdapterOptions = {}) {
    if (typeof document === 'undefined') {
      throw new Error('DomAdapter requires a DOM (document) environment')
    }
    this.mount = mount
    this.onEvent = opts.onEvent
  }

  /** A — open a detached build batch (see the batchEls doc). Idempotent per
   *  pair: a beginBatch while one is open resets the pending set (the caller
   *  owns the pair). */
  beginBatch(): void {
    this.batchEls = []
  }

  /** A — close the batch: mount the roots (elements never re-parented by an
   *  append op) in creation order. Non-batched state is restored afterwards. */
  endBatch(): void {
    if (this.batchEls) {
      for (const el of this.batchEls) this.mount.appendChild(el)
      this.batchEls = null
    }
  }

  createEl(type: string, wire: NodeRef, forkKey?: ForkPathKey): HTMLElement {
    const el = document.createElement(type)
    el.dataset.wire = wire
    const key = wireKey(wire, forkKey)
    // DOM-F8 (retained-handler-map): a duplicate create overwrites the wire
    // entry but the PRIOR element stays mounted (DOM-F4) — purge its retained
    // listeners so the orphaned (still live) element stops dispatching.
    const prev = this.wires.get(key)
    if (prev) this.purgeListeners(key, prev)
    this.wires.set(key, el)
    if (this.batchEls) this.batchEls.push(el)
    else this.mount.appendChild(el)
    return el
  }

  setProp(wire: NodeRef, name: string, val: unknown, forkKey?: ForkPathKey): void {
    const el = this.wires.get(wireKey(wire, forkKey))
    if (!el) return
    if (name === 'text') {
      if (FORM_CONTROLS.has(el.tagName)) {
        const formEl = el as HTMLInputElement
        if (val === undefined) {
          formEl.value = ''
        } else if (formEl.value !== bakeValue(val)) {
          formEl.value = bakeValue(val)
        }
      } else {
        el.textContent = val === undefined ? '' : bakeValue(val)
      }
    } else if (name.startsWith('css:')) {
      const key = name.slice(4)
      if (val === undefined) {
        if (key === 'id') el.id = ''
        else if (key === 'classes') el.className = ''
        else if (key === 'style') el.style.cssText = ''
        else el.removeAttribute(key)
      } else if (key === 'id') {
        el.id = bakeValue(val)
      } else if (key === 'classes') {
        el.className = Array.isArray(val) ? val.join(' ') : bakeValue(val)
      } else if (key === 'style') {
        el.style.cssText = bakeValue(val)
      } else if (key === 'cssDef') {
        el.setAttribute('cssDef', bakeValue(val))
      } else {
        el.setAttribute(key, bakeValue(val))
      }
    } else if (name.startsWith('on:')) {
      const evtName = name.slice(3)
      if (val === undefined) {
        // DOM-F6 (retained-handler-map): undefined = real detach — drop the
        // EXACT listener this adapter bound (R7 row 2026-08-14 was the
        // parked no-op). SSR (FRG-H18) drops its inline attr; DOM now
        // converges.
        const evtMap = this.listeners.get(wireKey(wire, forkKey))
        if (evtMap) {
          const entry = evtMap.get(evtName)
          if (entry) {
            ;(el as unknown as { removeEventListener: (e: string, f: (e: Event) => void) => void }).removeEventListener(evtName, entry.fn)
            evtMap.delete(evtName)
            if (evtMap.size === 0) this.listeners.delete(wireKey(wire, forkKey))
          }
        }
        return
      }
      const onEvent = this.onEvent
      const handler = (domEvent: Event) => {
        if (onEvent) onEvent(wire, domEvent)
      }
      // DOM-F5-flip (retained-handler-map): REPLACE semantics — re-setting the
      // same slot drops the previous (exact) listener before re-binding, so
      // one slot never accumulates listeners (the additive contract was the
      // parked DOM-F5; stale closures on handler churn are the hazard fixed).
      const key = wireKey(wire, forkKey)
      const prev = this.listeners.get(key)?.get(evtName)
      if (prev) {
        ;(el as unknown as { removeEventListener: (e: string, f: (e: Event) => void) => void }).removeEventListener(evtName, prev.fn)
      }
      el.addEventListener(evtName, handler)
      let evtMap = this.listeners.get(key)
      if (!evtMap) {
        evtMap = new Map()
        this.listeners.set(key, evtMap)
      }
      evtMap.set(evtName, { el, fn: handler })
    } else if (name.startsWith('data:')) {
      // DATA-* (ssr-synthetic-event.md §4 — the opt-in `data:` namespace): a
      // `data:<name>` op prop routes to setAttribute('data-<name>') (the
      // data-node-id traceability attribute), mirroring the prop:/css: routing.
      const attr = 'data-' + name.slice(5)
      if (val === undefined) el.removeAttribute(attr)
      else el.setAttribute(attr, bakeValue(val))
    } else {
      const attr = name.startsWith('prop:') ? name.slice(5) : name
      if (val === undefined) {
        el.removeAttribute(attr)
      } else if (attr === 'value' && VALUE_FORMS.has(el.tagName)) {
        ;(el as HTMLInputElement).value = bakeValue(val)
      } else {
        el.setAttribute(attr, bakeValue(val))
      }
    }
  }

  appendChild(owner: HTMLElement, child: HTMLElement): void {
    if (this.batchEls) {
      const i = this.batchEls.indexOf(child)
      if (i !== -1) this.batchEls.splice(i, 1)
    }
    owner.appendChild(child)
  }

  removeEl(wire: NodeRef, forkKey?: ForkPathKey): void {
    const key = wireKey(wire, forkKey)
    const el = this.wires.get(key)
    if (el) {
      // DOM-F7 (retained-handler-map): purge the retained listeners BEFORE
      // the element leaves — the detached element must not keep live
      // closures (or fire again if it outlives the op).
      this.purgeListeners(key, el)
      if (this.batchEls) {
        const i = this.batchEls.indexOf(el)
        if (i !== -1) this.batchEls.splice(i, 1)
      }
      el.remove()
      this.wires.delete(key)
    }
  }

  /** Remove every listener this adapter bound for one `(wire, forkKey)` slot
   *  from the element, and drop the slot from the retained map. */
  private purgeListeners(key: string, el: unknown): void {
    const evtMap = this.listeners.get(key)
    if (!evtMap) return
    const remove = (el as unknown as { removeEventListener: (e: string, f: (e: Event) => void) => void }).removeEventListener.bind(el)
    for (const [evt, { fn }] of evtMap) remove(evt, fn)
    this.listeners.delete(key)
  }

  hydrate(_rootWire: NodeRef, vdom: unknown): void {
    const doc = vdom as { template?: unknown; content?: unknown[] } | null
    const nodes = [doc?.template, ...(doc?.content ?? [])]
    for (const n of nodes) {
      const node = n as { css?: { id?: unknown } } | null
      if (node && typeof node === 'object' && node.css && typeof node.css.id === 'string') {
        this.reused.add(node.css.id)
      }
    }
  }

  styles(cssDefs: unknown[]): void {
    for (const def of cssDefs) {
      const rule = String(def)
      if (this.stylesSeen.has(rule)) continue
      this.stylesSeen.add(rule)
      this.ensureStyles(rule)
    }
  }

  private ensureStyles(def: string): void {
    if (!this.stylesEl) {
      const styleEl = document.createElement('style')
      styleEl.id = 'preempt-dynamic-styles'
      document.head.appendChild(styleEl)
      this.stylesEl = styleEl
    }
    this.stylesEl.textContent += '\n' + def
  }
}

interface SSRFragmentState {
  key: string
  type: string
  isVoid: boolean
  attrs: Map<string, string>
  text: string
  children: FragmentDescriptor[]
  parent: FragmentDescriptor | null
}

type StylesBuffer = string[] & ((cssDefs: unknown[]) => void)

/** D4 (FRG-H27) — the SSR styles buffer: pushes dedup per-adapter-instance
 *  on the exact rule string (the same rule never appends twice — mirror of
 *  the DomAdapter's stylesSeen, the defensive boundary half). */
function makeStylesBuffer(buffer: string[], seen: Set<string>): StylesBuffer {
  const call = (cssDefs: unknown[]): void => {
    for (const def of cssDefs) {
      const rule = String(def)
      if (seen.has(rule)) continue
      seen.add(rule)
      buffer.push(rule)
    }
  }
  const fn = call as unknown as StylesBuffer
  Object.defineProperty(fn, Symbol.iterator, { value: buffer[Symbol.iterator].bind(buffer) })
  fn.includes = buffer.includes.bind(buffer)
  fn.indexOf = buffer.indexOf.bind(buffer)
  fn.push = buffer.push.bind(buffer)
  fn.join = buffer.join.bind(buffer)
  fn.map = buffer.map.bind(buffer)
  return fn
}

function escapeAttr(v: unknown): string {
  return bakeValue(v)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function escapeText(v: unknown): string {
  return bakeValue(v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export class SSRFragmentAdapter implements RenderAdapter<FragmentDescriptor, string> {
  readonly fragments: Map<string, FragmentDescriptor> = new Map()
  readonly styles: StylesBuffer
  private readonly stylesBuffer: string[] = []
  /** D4 (FRG-H27) — per-adapter-instance rule-signature dedup set. */
  private readonly stylesSeen = new Set<string>()
  private readonly states = new WeakMap<FragmentDescriptor, SSRFragmentState>()
  private readonly created: FragmentDescriptor[] = []
  private rootKey: string | undefined

  constructor() {
    this.styles = makeStylesBuffer(this.stylesBuffer, this.stylesSeen)
  }

  createEl(type: string, wire: NodeRef, forkKey?: ForkPathKey): FragmentDescriptor {
    const key = wireKey(wire, forkKey)
    const isVoid = VOID_TAGS.has(type)
    const fd: FragmentDescriptor = {
      openTag: '<' + type + '>',
      closeTag: isVoid ? '' : '</' + type + '>',
      contentText: '',
      isVoid,
    }
    this.states.set(fd, { key, type, isVoid, attrs: new Map(), text: '', children: [], parent: null })
    this.fragments.set(key, fd)
    this.created.push(fd)
    if (this.rootKey === undefined) this.rootKey = key
    return fd
  }

  setProp(wire: NodeRef, name: string, val: unknown, forkKey?: ForkPathKey): void {
    const fd = this.fragments.get(wireKey(wire, forkKey))
    if (!fd) return
    const state = this.states.get(fd)!
    if (name === 'text') {
      state.text = val === undefined ? '' : bakeValue(val)
    } else if (name.startsWith('css:')) {
      const key = name.slice(4)
      if (key === 'cssDef') {
        // D4 — rule strings only, deduped per adapter instance (FRG-H27)
        const rule = bakeValue(val)
        if (!this.stylesSeen.has(rule)) {
          this.stylesSeen.add(rule)
          this.stylesBuffer.push(rule)
        }
      } else {
        const attr = key === 'classes' ? 'class' : key
        if (val === undefined) state.attrs.delete(attr)
        else {
          const v = key === 'classes' && Array.isArray(val) ? val.join(' ') : val
          state.attrs.set(attr, escapeAttr(v))
        }
      }
    } else if (name.startsWith('on:')) {
      const attr = 'on' + name.slice(3)
      if (val === undefined) state.attrs.delete(attr)
      else state.attrs.set(attr, escapeAttr(val))
    } else if (name.startsWith('data:')) {
      // DATA-* (ssr-synthetic-event.md §4 — the opt-in `data:` namespace): a
      // `data:<name>` op prop routes to the `data-<name>` attribute (the
      // data-node-id traceability attribute), mirroring the prop:/css: routing.
      const attr = 'data-' + name.slice(5)
      if (val === undefined) state.attrs.delete(attr)
      else state.attrs.set(attr, escapeAttr(val))
    } else {
      const attr = name.startsWith('prop:') ? name.slice(5) : name
      if (val === undefined) state.attrs.delete(attr)
      else state.attrs.set(attr, escapeAttr(val))
    }
    fd.openTag = this.openTag(state)
    this.rematerialize(fd)
  }

  appendChild(owner: FragmentDescriptor, child: FragmentDescriptor): void {
    const ownerState = this.states.get(owner)
    const childState = this.states.get(child)
    if (!ownerState || !childState) return
    ownerState.children.push(child)
    childState.parent = owner
    this.rematerialize(owner)
  }

  removeEl(wire: NodeRef, forkKey?: ForkPathKey): void {
    // DEFECT-SSR-REMOVE (handoffs-review-3.md, 2026-08-23) — detach semantics
    // mirroring DomAdapter.removeEl (PAR-5/SSR-F4 parity): a removed element
    // must leave the parent subtree in the serialized fragment, not just the
    // fragments map. Pins: silent no-op on unknown keys; splice by descriptor
    // identity (fork arms of one wire never collide); created purge (a
    // D3-legal remove→re-create must never resurrect the dead descriptor as a
    // floating top-level fragment); fragments.delete kept (additive shape);
    // no rootKey reset (FRG-H24 preserved).
    const key = wireKey(wire, forkKey)
    const fd = this.fragments.get(key)
    if (!fd) return
    const state = this.states.get(fd)!
    const parent = state.parent
    if (parent) {
      const parentState = this.states.get(parent)!
      const i = parentState.children.indexOf(fd)
      if (i !== -1) parentState.children.splice(i, 1)
    }
    state.parent = null
    const ci = this.created.indexOf(fd)
    if (ci !== -1) this.created.splice(ci, 1)
    this.fragments.delete(key)
    if (parent) this.rematerialize(parent)
  }

  hydrate(_rootWire: NodeRef, _vdom: unknown): void {}

  toString(): string {
    const stylesPrefix = this.stylesBuffer.length
      ? '<style id="preempt-dynamic-styles">' + this.stylesBuffer.map((d) => '\n' + d).join('') + '</style>'
      : ''
    if (this.rootKey === undefined) return stylesPrefix
    const root = this.fragments.get(this.rootKey)
    if (!root) return stylesPrefix
    // DomAdapter mounts every created element at top level; fragments that were
    // created but never appended into the root subtree serialize top-level after
    // it (creation order), so SSR reflects the same render surface for the same
    // op stream (PAR-5 / adapters.md §6 SSR-F4).
    const floating = this.created
      .filter((fd) => fd !== root && this.fragments.has(this.states.get(fd)!.key) && this.states.get(fd)!.parent === null)
      .map((fd) => this.rootHtml(fd))
      .join('')
    return stylesPrefix + this.rootHtml(root) + floating
  }

  private openTag(state: SSRFragmentState): string {
    const attrs = [...state.attrs.entries()].map(([k, v]) => `${k}="${v}"`).join(' ')
    return '<' + state.type + (attrs ? ' ' + attrs : '') + '>'
  }

  private rootHtml(root: FragmentDescriptor): string {
    return root.isVoid ? root.openTag : root.openTag + root.contentText + root.closeTag
  }

  private rematerialize(fd: FragmentDescriptor): void {
    const state = this.states.get(fd)
    if (!state) return
    fd.contentText = this.contentHtml(state)
    if (state.parent) this.rematerialize(state.parent)
  }

  private contentHtml(state: SSRFragmentState): string {
    const body = state.children.map((c) => this.childHtml(c)).join('')
    return escapeText(state.text) + body
  }

  private childHtml(child: FragmentDescriptor): string {
    return child.isVoid ? child.openTag : child.openTag + child.contentText + child.closeTag
  }
}

// ============================================================================
// MARKDOWN ADAPTER — Feature 2 (handoffs-review-7.md PROCEED-AS-RESHAPED,
// 2026-08-24; rulings 12-16 + decisions D1-D15). A text-only render adapter in
// the SSRFragmentAdapter family: it consumes the SAME RenderOp stream and emits
// markdown text via toString(). Contract:
//  - toString() is a concrete-FAMILY method (the markdown + SSR text family);
//    hydrate() is a required no-op; `styles` is NOT implemented (applyOps
//    auto-skips the styles op — CSS rules have no text value).
//  - `fragments` is the sole toString source (a retained per-wire MdNode tree,
//    D2/D10) — set-only re-renders fold onto the existing nodes, never
//    accumulate.
//  - Type→marker table (D3): h1-6/#, ul/ol/lists, li, strong/em (element type
//    ONLY — css:classes/css:style are DROPPED, D5), a, blockquote, code/pre,
//    hr, br, img; div/span/section/article/unknown = transparent containers.
//  - List markers are parent-based (D4): ul→'- ', ol→sibling-index '1. ';
//    2-space nesting for a list inside a list item.
//  - on:* AND data:* (incl. the opt-in data:node-id) are DROPPED (D7) — the
//    output is non-interactive + carries no element→node mapping (ruling 15/16).
//  - appendChild splices-by-identity (D8 move semantics — a D5 reorder never
//    duplicates text); removeEl DETACHES the subtree (the DEFECT-SSR-REMOVE
//    shape).
//  - Escaping (D9): adapter-emitted markers are unescaped; CONTENT
//    metacharacters are escaped at line-leading + inline-pairing positions.
//  - Empty doc → ''; empty node → nothing (D11).
//  - NEW parity family (D12) — NOT PAR-5 (the lossy text output can't satisfy
//    cross-surface HTML equality); the pin is same-input → same-markdown on
//    re-render.
// ============================================================================
const MD_BLOCK_TYPES = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'ul', 'ol', 'li', 'blockquote', 'hr', 'pre', 'div', 'section', 'article'])
const MD_LIST_TYPES = new Set(['ul', 'ol'])
const MD_HEADING_LEVEL: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 }

/** D9 — escape markdown-significant characters in CONTENT text only. Adapter-
 *  emitted markers are added by the renderer, never passed through this. */
function escapeMarkdown(text: string): string {
  let s = text.replace(/\\/g, '\\\\')
  // inline emphasis pairing (* and _) — escape everywhere
  s = s.replace(/([*_])/g, '\\$1')
  // link/code pairing brackets + backticks
  s = s.replace(/([[\]()`])/g, '\\$1')
  // line-leading structural markers (#, -, >, "1. ")
  s = s.split('\n').map((line) => {
    let l = line
    l = l.replace(/^([#>\-])/, '\\$1')
    l = l.replace(/^(\d+)\.\s/, '$1\\. ')
    return l
  }).join('\n')
  return s
}

interface MdNode {
  type: string
  wire: string
  text: string
  attrs: Map<string, unknown>
  children: MdNode[]
  parent: MdNode | null
}

export class MarkdownAdapter implements RenderAdapter<MdNode> {
  readonly fragments: Map<string, MdNode> = new Map()
  private readonly created: MdNode[] = []
  private rootKey: string | undefined

  createEl(type: string, wire: NodeRef, forkKey?: ForkPathKey): MdNode {
    const key = wireKey(wire, forkKey)
    const node: MdNode = { type, wire, text: '', attrs: new Map(), children: [], parent: null }
    this.fragments.set(key, node)
    this.created.push(node)
    if (this.rootKey === undefined) this.rootKey = key
    return node
  }

  setProp(wire: NodeRef, name: string, val: unknown, forkKey?: ForkPathKey): void {
    const node = this.fragments.get(wireKey(wire, forkKey))
    if (!node) return
    if (name === 'text') {
      node.text = val === undefined ? '' : bakeValue(val)
    } else if (name.startsWith('on:') || name.startsWith('data:')) {
      // D7 — dropped: non-interactive + no element→node mapping (ruling 15/16)
    } else if (name.startsWith('css:')) {
      // D5 — dropped: emphasis comes from the element TYPE, never css classes/
      // style (no CSS parsing at the adapter)
    } else if (name.startsWith('prop:')) {
      node.attrs.set(name.slice(5), val)
    } else {
      node.attrs.set(name, val)
    }
  }

  appendChild(owner: MdNode | string, child: MdNode | string): void {
    // D8 move semantics — splice the child out of its current parent so a D5
    // reorder never duplicates the child's text in the markdown output.
    // ADVERSARIAL-MD-S8 (disposition): the string overload is a TEST-helper
    // convenience for BARE wires (no forkKey). The RenderAdapter interface and
    // the real pipeline (applyOps → findEl) pass NODE OBJECTS — a fork-arm wire
    // MUST be passed as a node object (a bare string resolves to the bare key
    // and would miss the fork arm; the pipeline never passes strings).
    const o = typeof owner === 'string' ? this.fragments.get(wireKey(owner)) : owner
    const c = typeof child === 'string' ? this.fragments.get(wireKey(child)) : child
    if (!o || !c) return
    if (c.parent) {
      const p = c.parent
      const i = p.children.indexOf(c)
      if (i !== -1) p.children.splice(i, 1)
    }
    o.children.push(c)
    c.parent = o
  }

  removeEl(wire: NodeRef, forkKey?: ForkPathKey): void {
    const key = wireKey(wire, forkKey)
    const node = this.fragments.get(key)
    if (!node) return
    // D8 — DETACH shape (the DEFECT-SSR-REMOVE pin): splice the node out of
    // its parent so its subtree text vanishes from toString; then drop it.
    if (node.parent) {
      const p = node.parent
      const i = p.children.indexOf(node)
      if (i !== -1) p.children.splice(i, 1)
    }
    node.parent = null
    const ci = this.created.indexOf(node)
    if (ci !== -1) this.created.splice(ci, 1)
    this.fragments.delete(key)
  }

  hydrate(_rootWire: NodeRef, _vdom: unknown): void {}

  toString(): string {
    if (this.rootKey === undefined) return ''
    const root = this.fragments.get(this.rootKey)
    if (!root) return ''
    const rootLines = this.renderTree(root)
    // created-but-never-appended nodes render after the root (the SSR family's
    // floating-top-level convention, adapted to text).
    const floating = this.created
      .filter((n) => n !== root && n.parent === null && this.fragments.has(wireKey(n.wire)))
      .flatMap((n) => this.renderTree(n))
    return [...rootLines, ...floating].join('\n')
  }

  private renderTree(node: MdNode): string[] {
    const kind = this.classify(node.type)
    if (kind === 'list') {
      const out: string[] = []
      let idx = 1
      for (const child of node.children) {
        if (child.type !== 'li') continue
        // ADVERSARIAL-MD-S5 — an empty li STILL renders a bare bullet and
        // ALWAYS consumes the ol index.
        out.push(...this.renderListItem(child, node.type === 'ol' ? idx : null))
        idx += 1
      }
      return out
    }
    if (kind === 'heading') {
      // ADVERSARIAL-MD-S2 — a heading recurses its block children (a `p` child's
      // body is NOT lost); the inline line first, then the block-child lines.
      const lines = [`${'#'.repeat(MD_HEADING_LEVEL[node.type] ?? 1)} ${this.inlineContent(node)}`]
      for (const c of node.children) {
        if (this.classify(c.type) !== 'inline') lines.push(...this.renderTree(c))
      }
      return lines
    }
    if (kind === 'quote') {
      // ADVERSARIAL-MD-S1 — a blockquote recurses its block children (a `p`
      // child's text is NOT lost), `> `-prefixed per line. An empty own-inline
      // emits no stray `> ` line (the block children carry the body).
      const own = this.inlineContent(node)
      const lines = own ? own.split('\n').map((l) => '> ' + l) : []
      for (const c of node.children) {
        if (this.classify(c.type) !== 'inline') lines.push(...this.renderTree(c).map((l) => '> ' + l))
      }
      return lines
    }
    if (kind === 'pre') {
      // ADVERSARIAL-MD-S3 — `pre` is a triple-backtick FENCED block (the D3/M7
      // contract); `code` stays inline-backtick (renderInline).
      // MD-PRE-ESCAPE — the fence content is LITERAL: the triple-backtick
      // fence IS the escape mechanism, so the content is emitted VERBATIM
      // (no escapeMarkdown — escaping `(`/`)`/`*`/`#` inside the fence would
      // corrupt code with stray backslashes).
      return ['```', node.text, '```']
    }
    if (kind === 'hr') return ['---']
    if (kind === 'block') {
      const inline = this.inlineContent(node)
      const lines = inline ? [inline] : []
      for (const c of node.children) {
        // ADVERSARIAL-MD-S17 — a transparent container must recurse ALL
        // non-inline children, INCLUDING lists (a `div > ul` is never dropped).
        if (this.classify(c.type) !== 'inline') lines.push(...this.renderTree(c))
      }
      return lines
    }
    // inline
    return [this.renderInline(node)]
  }

  private renderListItem(li: MdNode, index: number | null): string[] {
    const marker = index === null ? '- ' : `${index}. `
    const content = this.inlineContent(li)
    // ADVERSARIAL-MD-S5 — ALWAYS emit a line (an empty li is a bare bullet);
    // ADVERSARIAL-MD-S6 — a non-list block child indents by 2 (does not break
    // the list).
    const lines = [marker + content]
    for (const c of li.children) {
      if (MD_LIST_TYPES.has(c.type)) {
        // nested list — indent each line by 2
        lines.push(...this.renderTree(c).map((l) => '  ' + l))
      } else if (this.classify(c.type) !== 'inline') {
        lines.push(...this.renderTree(c).map((l) => '  ' + l))
      }
    }
    return lines
  }

  private inlineContent(node: MdNode): string {
    const text = node.text ? escapeMarkdown(node.text) : ''
    // MD-INLINE-FILTER — pull ONLY true inline children (text/strong/em/a/
    // code/img/br/span). The pre-2026-08-25 filter `!== 'block'` folded
    // headings/lists/pre/hr/blockquote into the parent's inline line —
    // marker-less heads + escaped fence content in the line. Block-level
    // children render as their own lines (renderTree), never here.
    const inlineKids = node.children
      .filter((c) => this.classify(c.type) === 'inline')
      .map((c) => this.renderInline(c))
      .join('')
    return text + inlineKids
  }

  private renderInline(node: MdNode): string {
    switch (node.type) {
      case 'strong':
      case 'b':
        return '**' + this.inlineContent(node) + '**'
      case 'em':
      case 'i':
        return '*' + this.inlineContent(node) + '*'
      case 'code':
        return '`' + this.inlineContent(node) + '`'
      case 'a': {
        const text = this.inlineContent(node)
        const href = node.attrs.get('href')
        if (typeof href === 'string' && href.length > 0) {
          const title = node.attrs.get('title')
          // ADVERSARIAL-MD-S4 — the title's `"` is escaped (a bare quote would
          // break the `(href "…")` delimiter).
          return typeof title === 'string' && title.length > 0
            ? `[${text}](${escapeMarkdown(href)} "${escapeMarkdown(title).replace(/"/g, '\\"')}")`
            : `[${text}](${escapeMarkdown(href)})`
        }
        return text // bare text — never a dangling [](url)
      }
      case 'img': {
        const src = node.attrs.get('src')
        const alt = (node.attrs.get('alt') ?? node.text) as string
        return typeof src === 'string' ? `![${escapeMarkdown(alt)}](${escapeMarkdown(src)})` : ''
      }
      case 'br':
        return '\n'
      case 'span':
      default:
        return this.inlineContent(node)
    }
  }

  private classify(type: string): 'list' | 'heading' | 'quote' | 'hr' | 'pre' | 'block' | 'inline' {
    if (MD_LIST_TYPES.has(type)) return 'list'
    if (type === 'li') return 'block'
    if (MD_HEADING_LEVEL[type] !== undefined) return 'heading'
    if (type === 'blockquote') return 'quote'
    if (type === 'hr') return 'hr'
    if (type === 'pre') return 'pre'
    if (type === 'strong' || type === 'em' || type === 'b' || type === 'i' || type === 'a' || type === 'code' || type === 'img' || type === 'br' || type === 'span' || type === 'text') return 'inline'
    return 'block' // div/section/article/p/unknown = transparent block container
  }
}
