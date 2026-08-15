// Stress-test review loop round 2 — step (b) PROBE agent (scenarios 17-26).
// Core-only probe harness: legacy-JSON envelopes -> translateLegacy -> compile
// (root.compile(slice) and/or per-node compilePath) -> emitElements ->
// diffMinimal -> applyOps(SSRFragmentAdapter + DomAdapter), with console.warn
// capture, op-stream inspection, handler dispatch, and reverseTranslate
// round-trips. No src/, no dist/, no demo/ changes; no page logic.
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { DomAdapter, SSRFragmentAdapter, VOID_TAGS } from '../../dist/core/adapters.js'
import { emitElements, applyOps, treeSig, treeFromOps } from '../../dist/core/render-helpers.js'
import { diffMinimal } from '../../dist/core/render.js'
import { dispatchEvent } from '../../dist/core/handlers.js'
import { serializeSlice, loadState } from '../../dist/core/serialize.js'

// ---------------------------------------------------------------------------
// Minimal DOM shim (pattern: scripts/demo-smoke.mjs) — installed only for the
// DomAdapter probes; harmless for SSR-only runs.
// ---------------------------------------------------------------------------
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.attrs = {}
    this.dataset = {}
    this.style = { cssText: '' }
    this.listeners = {}
    this.textContent = ''
    this.className = ''
    this.id = ''
    this.value = ''
    this.parent = null
  }
  appendChild(c) {
    if (c.parent) {
      const i = c.parent.children.indexOf(c)
      if (i !== -1) c.parent.children.splice(i, 1)
    }
    const i = this.children.indexOf(c)
    if (i !== -1) this.children.splice(i, 1)
    this.children.push(c)
    c.parent = this
    return c
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'id') this.id = '' }
  addEventListener(evt, fn) { (this.listeners[evt] ??= []).push(fn) }
  remove() {
    this.removed = true
    if (this.parent) {
      const i = this.parent.children.indexOf(this)
      if (i !== -1) this.parent.children.splice(i, 1)
      this.parent = null
    }
  }
}
function installDomShim() {
  if (typeof globalThis.document !== 'undefined') return
  const byId = new Map()
  const styleEls = []
  globalThis.document = {
    createElement: (tag) => new El(tag),
    getElementById: (id) => {
      if (!byId.has(id)) byId.set(id, new El('div'))
      return byId.get(id)
    },
    head: { appendChild: (el) => { styleEls.push(el) }, __styleEls: styleEls },
  }
  globalThis.window = globalThis
}
installDomShim()

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------
const now = () => (globalThis.performance?.now ? performance.now() : Date.now())

/** Core-only translate+register+compile+emit+diff+apply sequence (slice scope:
 *  root.compile(nodes)). Captures console.warn (translate + compile + render). */
function pipeline(doc, { path = false } = {}) {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => { warnings.push(typeof msg === 'string' ? msg : String(msg)) }
  const t = {}
  try {
    const t0 = now()
    const translated = translateLegacy(doc)
    t.translate = now() - t0
    const events = new EventBridge()
    const supervisor = new Supervisor({ events })
    for (const n of translated.nodes) supervisor.registerNode(n)
    const t1 = now()
    let cr
    let byNode = new Map()
    if (path) {
      const actionable = []
      const warnings = []
      const dropped = []
      for (const n of translated.nodes) {
        const r = n.compilePath()
        actionable.push(...r.actionable)
        warnings.push(...r.warnings)
        dropped.push(...r.dropped)
      }
      cr = { actionable, dropped, warnings }
      for (const s of actionable) {
        const arr = byNode.get(s.nodeId) ?? []
        arr.push(s)
        byNode.set(s.nodeId, arr)
      }
    }
    else {
      cr = translated.root.compile(translated.nodes)
      for (const s of cr.actionable) {
        if (!supervisor.getNode(s.nodeId)?.isInTree) continue
        const arr = byNode.get(s.nodeId) ?? []
        arr.push(s)
        byNode.set(s.nodeId, arr)
      }
    }
    t.compile = now() - t1
    supervisor.recordResolved(cr.actionable)
    const actionable = []
    for (const states of byNode.values()) actionable.push(...states)
    const nodeById = new Map(supervisor.allNodes().map((n) => [n.id, n]))
    const t2 = now()
    const els = emitElements(actionable, nodeById)
    t.emit = now() - t2
    const t3 = now()
    const ops = diffMinimal(null, els)
    t.diff = now() - t3
    const adapter = new SSRFragmentAdapter()
    const t4 = now()
    applyOps(adapter, ops)
    t.apply = now() - t4
    const html = adapter.toString()
    return {
      translated, supervisor, cr, actionable, els, ops, html,
      warnings, byNode, timing: t, ssrAdapter: adapter, nodeById,
    }
  }
  finally {
    console.warn = origWarn
  }
}

/** Render through DomAdapter too (op stream identical) — returns the mount. */
function domRender(ops) {
  const mount = document.createElement('mount')
  const adapter = new DomAdapter(mount)
  applyOps(adapter, ops)
  return { mount, adapter }
}

function findNode(p, authoredId) {
  return p.supervisor.allNodes().find((n) => n.props?.id === authoredId)
}
function stateOf(p, authoredId) {
  const n = findNode(p, authoredId)
  return n ? p.byNode.get(n.id) ?? [] : []
}
function attr(html, elemId, attrName) {
  const m = new RegExp(`<[^>]+id="${elemId}"[^>]*>`).exec(html)
  if (!m) return null
  const am = new RegExp(`${attrName}="([^"]*)"`).exec(m[0])
  return am ? am[1] : null
}
function countSubstr(haystack, needle) {
  let n = 0
  let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) { n += 1; i += needle.length }
  return n
}
function tagOpenCount(html, tag) { return countSubstr(html, `<${tag}`) }
function deepEqual(a, b) {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]))
  }
  if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a).sort()
    const kb = Object.keys(b).sort()
    return ka.length === kb.length && ka.every((k, i) => k === kb[i] && deepEqual(a[k], b[k]))
  }
  return false
}
function warnCodes(p) {
  return (p.cr.warnings ?? []).map((w) => w.code)
}
function tWarnCodes(translated) {
  return (translated.warnings ?? []).map((w) => w.code)
}
/** Extract the full SSR subtree of the element whose opening tag carries
 *  id="<id>" (void-safe, depth-counted). Returns '(absent)' when missing. */
function subtreeHtml(html, id) {
  const m = new RegExp(`<[^>]*id="${id}"[^>]*>`).exec(html)
  if (!m) return '(absent)'
  let i = m.index + m[0].length
  let depth = 0
  const tagName = /^<([A-Za-z0-9-]+)/.exec(m[0])?.[1]
  if (tagName && VOID_TAGS.has(tagName.toLowerCase())) return m[0]
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) return html.slice(m.index)
    const close = html[lt + 1] === '/'
    let j = lt + (close ? 2 : 1)
    let name = ''
    while (j < html.length && /[A-Za-z0-9]/.test(html[j])) { name += html[j]; j += 1 }
    let quote = null
    while (j < html.length) {
      const ch = html[j]
      if (quote !== null) { if (ch === quote) quote = null }
      else if (ch === '"' || ch === "'") quote = ch
      else if (ch === '>') break
      j += 1
    }
    const end = j < html.length ? j + 1 : html.length
    if (!close && name && !VOID_TAGS.has(name.toLowerCase())) depth += 1
    else if (close && name) {
      depth -= 1
      if (depth < 0) return html.slice(m.index, end)
    }
    i = end
  }
  return html.slice(m.index)
}

// ---------------------------------------------------------------------------
// Scenario data — envelopes EXACTLY as authored in archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md
// ---------------------------------------------------------------------------
const SC17 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'nested-root' },
      component: [
        { reference: 'outer', value: { type: 'nav', css: { classes: ['outer-bar'] }, children: [
          { type: 'div', props: { id: 'nested-shell' }, content: 'nested shell text', component: { reference: 'inner', target: 'children' } },
        ] } },
        { reference: 'inner', value: { type: 'aside', css: { classes: ['inner-panel'] }, children: [
          { type: 'span', props: { id: 'inner-a' }, content: 'inner-a' },
        ] } },
      ],
      children: [
        { type: 'div', props: { id: 'outer-consumer' }, content: 'outer shell text', component: { reference: 'outer', target: 'children' } },
      ],
    },
  },
}

const SC18 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'multi-root' },
      component: [
        { reference: 'menu', value: { type: 'nav', css: { classes: ['menu-bar'], cssDef: [{ selector: '.menu-link', styles: { color: 'blue' } }, { selector: 'nav', styles: { display: 'flex' } }, { selector: '@media (min-width: 600px)', styles: { '.menu-link': { color: 'blue' } } }] }, children: [
          { type: 'span', props: { id: 'menu-logo' }, content: 'logo' },
          { type: 'span', props: { id: 'menu-links' }, content: 'links' },
        ] } },
      ],
      children: [
        { type: 'div', props: { id: 'con-a' }, content: 'shell A', children: [{ type: 'p', props: { id: 'authored-a' }, content: 'authored child A' }], component: { reference: 'menu', target: 'children' } },
        { type: 'div', props: { id: 'con-b' }, content: 'shell B', component: { reference: 'menu', target: 'children' } },
      ],
    },
  },
}

const SC19 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'self-seam-root' },
      children: [
        { type: 'div', props: { id: 'self-type' }, content: 'authored text', component: { reference: 'selfdef', value: { type: 'aside', css: { classes: ['self-panel'], cssDef: [{ selector: '.self-panel', styles: { border: '1px solid' } }] }, children: [
          { type: 'strong', props: { id: 'self-child' }, content: 'self child' },
        ] }, target: 'type' } },
        { type: 'div', props: { id: 'self-children' }, content: 'wrapper text', component: { reference: 'selfdef2', value: { type: 'section', css: { classes: ['self-section'] }, children: [
          { type: 'span', props: { id: 'sc-a' }, content: 'sc-a' },
        ] }, target: 'children' } },
        { type: 'span', props: { id: 'self-leaf' }, component: { reference: 'leafdef', value: { type: 'button', css: { classes: ['leaf-btn'] }, content: 'unused label' }, target: 'type' } },
      ],
    },
  },
}

const SC20 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'eo-root' },
      component: [
        { reference: 'eoDef', value: { type: 'nav', css: { classes: ['eo-nav'] }, children: [{ type: 'span', props: { id: 'eo-child' }, content: 'eo child' }] } },
        { reference: 'eoText', value: { type: 'h2', content: 'seam text' } },
      ],
      children: [
        { type: 'section', props: { id: 'eo-empty' }, placement: { placementName: 'zone-e' } },
        { type: 'section', props: { id: 'eo-text' }, placement: { placementName: 'zone-t' }, content: 'authored text' },
        { type: 'section', props: { id: 'eo-style' }, placement: { placementName: 'zone-s' }, css: { style: 'width: 200px;' } },
        { type: 'section', props: { id: 'eo-display' }, placement: { placementName: 'zone-d' }, css: { style: 'display: flex;' } },
        { type: 'section', props: { id: 'eo-seam-kids' }, placement: { placementName: 'zone-k' }, component: { reference: 'eoDef', target: 'children' } },
        { type: 'section', props: { id: 'eo-seam-text' }, placement: { placementName: 'zone-c' }, component: { reference: 'eoText', target: 'content' } },
        { type: 'section', props: { id: 'eo-seam-dead' }, placement: { placementName: 'zone-x' }, component: { reference: 'ghost', target: 'children' } },
        { type: 'div', props: { id: 'eo-noncontainer' } },
      ],
    },
  },
}

const SC21 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'seam-fan-root' },
      component: [
        { reference: 'title', value: { type: 'h1', content: "The def's text content" } },
        { reference: 'quiet', value: { type: 'p' } },
      ],
      children: [
        { type: 'aside', props: { id: 'fan-a' }, placement: { placementName: 'fan-zone' } },
        { type: 'div', props: { id: 'fan-wrap' }, children: [
          { type: 'aside', props: { id: 'fan-b' }, placement: { placementName: 'fan-zone' } },
        ] },
      ],
    },
  },
  content: [
    { content: [
      { type: 'h1', props: { id: 'fan-consumer' }, component: { reference: 'title', target: 'content' }, placement: { targetPlacement: ['fan-zone'] } },
      { type: 'h1', props: { id: 'quiet-consumer' }, content: 'authored text', component: { reference: 'quiet', target: 'content' }, placement: { targetPlacement: ['fan-zone'] } },
    ] },
  ],
}

const SC22 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'chain-root' },
      children: [
        { type: 'div', props: { id: 'chain-a' }, component: { reference: 'retyp', value: { type: 'div', childOffset: 0, children: [
          { bind: 'a', type: 'span', content: 'retyped-A' },
          { bind: 'b', type: 'em', content: 'retyped-B' },
        ] } }, children: [
          { type: 'p', props: { id: 'real-a' }, content: 'real-A', css: { style: 'color: red;' } },
          { type: 'p', props: { id: 'real-b' }, content: 'real-B', css: { style: 'color: blue;' } },
        ] },
        { type: 'div', props: { id: 'chain-b' }, component: { reference: 'deliv', value: { type: 'section', children: [
          { type: 'div', props: { id: 'deliv-child' }, content: 'deliverable content', css: { classes: ['d-child'] } },
        ] } }, children: [
          { type: 'p', props: { id: 'real-c' }, content: 'real-C' },
        ] },
        { type: 'div', props: { id: 'chain-c' }, component: { reference: 'mismatch', value: { type: 'div', children: [
          { bind: 'a', type: 'span', content: 'm-a' },
          { bind: 'b', type: 'em', content: 'm-b' },
        ] } }, children: [
          { type: 'p', props: { id: 'real-d' }, content: 'real-D' },
        ] },
        { type: 'div', props: { id: 'chain-d' }, component: { reference: 'off', value: { type: 'div', childOffset: 1, children: [
          { bind: 'a', type: 'span', content: 'o-a' },
          { bind: 'b', type: 'em', content: 'o-b' },
        ] } }, children: [
          { type: 'p', props: { id: 'real-e' }, content: 'real-E' },
          { type: 'p', props: { id: 'real-f' }, content: 'real-F' },
        ] },
      ],
    },
  },
}

const SC23 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'fill-root' },
      component: [
        { reference: 'inner', value: { type: 'em', content: 'nested text' } },
      ],
      children: [
        { type: 'section', props: { id: 'fill-host' }, placement: { placementName: 'fill-zone' }, component: { reference: 'filldef', value: { type: 'div', children: [
          { bind: 'a', type: 'span', content: 'fill-a' },
          { bind: 'b', type: 'strong', content: 'fill-b', component: { reference: 'inner', target: 'content' } },
        ] } } },
      ],
    },
  },
}

const SC24 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'placement-root' },
      children: [
        { type: 'div', props: { id: 'mixed' }, placement: [{ placementName: 'zone-a' }, { targetPlacement: ['zone-b'] }] },
        { type: 'div', props: { id: 'empty-list' }, placement: [] },
        { type: 'div', props: { id: 'p-consumer' }, placement: { targetPlacement: ['modal'] }, children: [
          { type: 'section', props: { id: 'p-producer' }, placement: { placementName: 'modal' } },
        ] },
        { type: 'section', props: { id: 'dup-p1' }, placement: { placementName: 'zone' } },
        { type: 'div', props: { id: 'dup-wrap' }, children: [
          { type: 'section', props: { id: 'dup-p2' }, placement: { placementName: 'zone' } },
        ] },
        { type: 'div', props: { id: 'self-serving' }, placement: [{ placementName: 'loop-zone', targetPlacement: ['loop-zone'] }] },
      ],
    },
  },
  content: [
    { content: [
      { type: 'div', props: { id: 'zone-consumer' }, placement: { targetPlacement: ['zone'] } },
    ] },
  ],
}

const SC25 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'bestfit-root' },
      children: [
        { type: 'aside', props: { id: 'side-a' }, placement: { placementName: 'side-zone' } },
        { type: 'div', props: { id: 'nest-wrap' }, children: [
          { type: 'aside', props: { id: 'side-b' }, placement: { placementName: 'side-zone' } },
        ] },
        { type: 'div', props: { id: 'depth-consumer' }, placement: { targetPlacement: ['deep-zone'] }, children: [
          { type: 'section', props: { id: 'deep-producer' }, placement: { placementName: 'deep-zone' } },
        ] },
      ],
    },
  },
  content: [
    { content: [
      { type: 'div', props: { id: 'bestfit-consumer' }, placement: { targetPlacement: ['no-such-zone', 'side-zone'] } },
      { type: 'div', props: { id: 'ghost-consumer' }, placement: { targetPlacement: ['ghost-zone'] } },
    ] },
  ],
}

const SC26 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'edges-root' },
      component: [
        { reference: 'menu', value: { type: 'nav', css: { classes: ['menu-bar'] }, children: [{ type: 'span', props: { id: 'm-logo' }, content: 'logo' }] } },
      ],
      children: [
        { type: 'div', props: { id: 'bad-children' }, children: { type: 'div', props: { id: 'object-child' } } },
        { type: 'div', props: { id: 'obj-content' }, content: { type: 'div' } },
        { type: 'div', props: { id: 'vendor-style' }, css: { style: { WebkitTransform: 'rotate(90deg)', msTransition: 'all 1s', background: 'url(data:image/png;base64,iVBORw0KGgo=) center/cover no-repeat', content: '"a:b"' } } },
        { type: 'div', props: { id: 'seam-consumer' }, content: 'shell text', component: { reference: 'menu', target: 'children' } },
        { type: 'button', props: { id: 'handler-gap' }, component: { reference: 'hdef', value: { type: 'span', content: 'never delivered' }, target: 'handlers.click' }, handlers: [{ name: 'click', event: 'click', body: 'function (ctx) { return \'alive\'; }' }] },
      ],
    },
  },
}

// ---------------------------------------------------------------------------
// Scenario runners
// ---------------------------------------------------------------------------
const results = []

function record(scenario, pass, details, notes = []) {
  if (scenario === 26) { console.log('[sc26 detail]', details.join(' || ')) }
  results.push({ scenario, pass, details, notes })
}

function runScenario17() {
  const d = []
  const p = pipeline(SC17)
  const tCodes = tWarnCodes(p.translated)
  d.push(`translate warns: ${JSON.stringify(tCodes)} gap-count=${tCodes.filter((c) => c === 'component-target-gap').length}`)
  const shellProto = p.translated.nodes.find((n) => n.props?.id === 'nested-shell' && n.state === 'prototype')
  const seamTarget = shellProto?.anchors?.find((a) => a.role === 'target' && a.target === 'inner')
  d.push(`nested-shell prototype state=${shellProto?.state} seam target=${seamTarget?.target} options.seam=${JSON.stringify(seamTarget?.options?.seam)}`)
  d.push(`slice-compile SSR: ${p.html}`)
  // compilePath scope too
  const p2 = pipeline(SC17, { path: true })
  d.push(`compilePath SSR identical: ${p2.html === p.html}`)
  d.push(`html has 'nested shell text': ${p.html.includes('nested shell text')}`)
  d.push(`html has 'outer shell text': ${p.html.includes('outer shell text')}`)
  d.push(`nav outer-bar count=${tagOpenCount(p.html, 'nav')} aside inner-panel count=${tagOpenCount(p.html, 'aside')}`)
  d.push(`warnings=${JSON.stringify(warnCodes(p))}`)
  const expected = '<div>outer shell text<nav class="outer-bar"><div>nested shell text<aside class="inner-panel"><span>inner-a</span></aside></div></nav></div>'
  const ok = tCodes.filter((c) => c === 'component-target-gap').length === 0 &&
    seamTarget?.options?.seam === 'children' &&
    p.html.includes('outer shell text') && p.html.includes('nested shell text') &&
    p2.html === p.html && p.html.includes('<nav class="outer-bar">') && p.html.includes('<aside class="inner-panel">')
  record('17', ok, d, [
    ok ? '' : 'EXPECTED SSR (SED-2/B1 letter): ' + expected,
  ].filter(Boolean))
}

function runScenario18() {
  const d = []
  let p
  try {
    p = pipeline(SC18)
    d.push('compile: no SingleParentError')
  }
  catch (e) {
    d.push(`compile THREW ${e?.constructor?.name}: ${e?.message?.slice(0, 90)}`)
  }
  if (p) {
    d.push(`con-a SSR: ${subtreeHtml(p.html, 'con-a').slice(0, 240)}`)
    d.push(`con-b SSR: ${subtreeHtml(p.html, 'con-b').slice(0, 200)}`)
    d.push(`con-a rendered=${p.html.includes('id="con-a"')} con-b rendered=${p.html.includes('id="con-b"')}`)
    d.push(`authored-a before def-root in con-a: ${p.html.indexOf('id="authored-a"') < p.html.indexOf('menu-bar')}`)
    d.push(`menu-bar count=${countSubstr(p.html, 'menu-bar')} logo count=${countSubstr(p.html, '>logo<')} links count=${countSubstr(p.html, '>links<')}`)
    const stylesOps = p.ops.filter((o) => o.kind === 'styles')
    d.push(`styles ops=${stylesOps.length} rules=${JSON.stringify(stylesOps.flatMap((o) => o.cssDefs))}`)
    const creates = p.ops.filter((o) => o.kind === 'create')
    const rootWires = creates.filter((c) => /:0$/.test(c.wire) && !/:0:\d+$/.test(c.wire)).map((c) => c.wire)
    d.push(`def-root wires (…:0, excl. their children): ${rootWires.join(',')}`)
    d.push(`warnings=${JSON.stringify(warnCodes(p))}`)
    const rules = stylesOps.flatMap((o) => o.cssDefs)
    const ok = p.html.includes('id="con-a"') && p.html.includes('id="con-b"') &&
      p.html.includes('id="authored-a"') && p.html.includes('>logo<') && p.html.includes('>links<') &&
      p.html.indexOf('id="authored-a"') < p.html.indexOf('menu-bar') &&
      rootWires.length === 2 &&
      rules.filter((r) => r === '.menu-link{color: blue;}').length === 1 &&
      rules.filter((r) => r === 'nav{display: flex;}').length === 1
    record('18', ok, d, [
      'cssDef now authored in the DOCUMENTED StyleNode ARRAY form [{selector, styles}] + one STL-1 nested media-query pin (selector-key form INSIDE a styles value); the top-level selector-key form (the round-2 original) yields zero rules per cssDefRules — reviewed as DATA-AUTHORING, scenario data fixed.',
    ])
  }
  else {
    record('18', false, d)
  }
}

function runScenario19() {
  const d = []
  const p = pipeline(SC19)
  const styleOps = p.ops.filter((o) => o.kind === 'styles')
  d.push(`styles ops=${styleOps.length} rules=${JSON.stringify(styleOps.flatMap((o) => o.cssDefs))}`)
  d.push(`self-type SSR: ${subtreeHtml(p.html, 'self-type').slice(0, 220)}`)
  d.push(`self-children SSR: ${subtreeHtml(p.html, 'self-children').slice(0, 220)}`)
  d.push(`self-leaf SSR: ${subtreeHtml(p.html, 'self-leaf').slice(0, 140)}`)
  d.push(`'authored text' present: ${p.html.includes('authored text')}`)
  d.push(`'self child' present: ${p.html.includes('self child')} 'wrapper text' present: ${p.html.includes('wrapper text')} sc-a present: ${p.html.includes('sc-a')}`)
  d.push(`'unused label' present: ${p.html.includes('unused label')}`)
  d.push(`section count=${tagOpenCount(p.html, 'section')} aside count=${tagOpenCount(p.html, 'aside')} button count=${tagOpenCount(p.html, 'button')}`)
  d.push(`full html: ${p.html}`)
  // idempotency across recompiles: compile the SAME graph twice
  const before = p.cr.actionable.length
  const cr2 = p.translated.root.compile(p.translated.nodes)
  d.push(`recompile actionable: ${before} -> ${cr2.actionable.length} (idempotent: ${before === cr2.actionable.length})`)
  // node still provides at depth-0
  const selfTypeNode = findNode(p, 'self-type')
  const cs = stateOf(p, 'self-type')[0]
  d.push(`self-type state bindings selfdef=${JSON.stringify(cs?.bindings?.selfdef)} arms=${stateOf(p, 'self-type').length}`)
  const selfType = subtreeHtml(p.html, 'self-type')
  const leafTag = subtreeHtml(p.html, 'self-leaf')
  const ok = selfType.includes('class="self-panel"') && selfType.includes('self child') &&
    !p.html.includes('authored text') && p.html.includes('wrapper text') && p.html.includes('sc-a') &&
    !p.html.includes('unused label') && leafTag.includes('class="leaf-btn"') &&
    before === cr2.actionable.length && cs?.bindings?.selfdef !== undefined
  record('19', ok, d, [
    'cssDef now authored in the documented {selector, styles} ARRAY form (scenario data fix — the round-2 original used the top-level selector-key form). The MISMATCH remains: GENUINE ENGINE DEFECT — the self-provider seam never materializes (applyPlans stores options.seam on the SOURCE anchor for value-carrying bindings; all seam detection keys on role===\'target\' anchors only — node.ts:1204-1207, render-helpers.ts:527-529/624-627). Red by design.',
  ])
}

function runScenario20() {
  const d = []
  const p = pipeline(SC20)
  const g = (id, k) => attr(p.html, id, k)
  for (const id of ['eo-empty', 'eo-text', 'eo-style', 'eo-display', 'eo-seam-kids', 'eo-seam-text', 'eo-seam-dead', 'eo-noncontainer']) {
    d.push(`${id}: style=${JSON.stringify(g(id, 'style'))} rendered=${p.html.includes(`id="${id}"`)}`)
  }
  d.push(`eo-seam-kids SSR: ${(p.html.match(/<section[^>]*id="eo-seam-kids"[^>]*>.*?<\/section>/s) ?? ['MISSING'])[0].slice(0, 160)}`)
  d.push(`'seam text' present: ${p.html.includes('seam text')} 'eo child' present: ${p.html.includes('eo child')}`)
  d.push(`eo-seam-dead subtree: ${subtreeHtml(p.html, 'eo-seam-dead').slice(0, 120)}`)
  d.push(`warnings=${JSON.stringify(warnCodes(p))}`)
  const ok = g('eo-empty', 'style') === 'display: none;' &&
    g('eo-text', 'style') === null && p.html.includes('authored text') &&
    g('eo-style', 'style') === 'width: 200px;' &&
    g('eo-display', 'style') === 'display: flex;' &&
    g('eo-seam-kids', 'style') === null && p.html.includes('eo child') &&
    p.html.includes('seam text') && g('eo-seam-text', 'style') === null &&
    g('eo-seam-dead', 'style') === 'display: none;' && !subtreeHtml(p.html, 'eo-seam-dead').includes('eo-child') &&
    g('eo-noncontainer', 'style') === null
  record('20', ok, d)
}

function runScenario21() {
  const d = []
  const p = pipeline(SC21, { path: true })
  const fc = stateOf(p, 'fan-consumer')
  const qc = stateOf(p, 'quiet-consumer')
  d.push(`fan-consumer path-states=${fc.length}`)
  for (const s of fc) {
    d.push(`  pathKey=${s.pathKey} forkKey=${s.forkKey} activePlacement=${s.activePlacement} content=${JSON.stringify(s.content)}`)
  }
  d.push(`quiet-consumer path-states=${qc.length}`)
  for (const s of qc) {
    d.push(`  pathKey=${s.pathKey} content=${JSON.stringify(s.content)}`)
  }
  d.push(`'The def's text content' count=${countSubstr(p.html, "The def's text content")}`)
  d.push(`'authored text' count=${countSubstr(p.html, 'authored text')}`)
  d.push(`fan-a style=${JSON.stringify(attr(p.html, 'fan-a', 'style'))} fan-b style=${JSON.stringify(attr(p.html, 'fan-b', 'style'))}`)
  d.push(`display:none anywhere: ${p.html.includes('display: none')}`)
  d.push(`h1 elements=${tagOpenCount(p.html, 'h1')}`)
  d.push(`warnings=${JSON.stringify(warnCodes(p))}`)
  const keys = fc.map((s) => s.pathKey)
  // §2.2 letter: 'root/<zone>/<ownerId>/…/<nodeId>' — zone BEFORE owner,
  // interleaved at the hop (minted ids — shape assertion, never authored names)
  const shapeOk = keys.length === 2 &&
    keys.some((k) => /^root\/fan-zone\/node-\d+\/node-\d+$/.test(k)) &&
    keys.some((k) => /^root\/node-\d+\/fan-zone\/node-\d+\/node-\d+$/.test(k))
  d.push(`expected key shape (zone BEFORE owner, §2.2): ${JSON.stringify(['root/fan-zone/<fan-a-id>/<fan-consumer-id>', 'root/<fan-wrap-id>/fan-zone/<fan-b-id>/<fan-consumer-id>'])} — matched=${shapeOk}`)
  const ok = fc.length === 2 && fc.every((s) => s.forkKey === s.pathKey) &&
    fc.every((s) => s.activePlacement === 'fan-zone') &&
    fc.every((s) => s.content === "The def's text content") &&
    qc.length === 2 && qc.every((s) => s.content === 'authored text') &&
    countSubstr(p.html, "The def's text content") === 2 &&
    !p.html.includes('display: none') && tagOpenCount(p.html, 'h1') === 4 &&
    shapeOk
  record('21', ok, d, [
    shapeOk ? '' : `pathKey segment order differs from the scenario's Expected-output strings (actual keys above; doc §2.2 says 'root/<zone>/<ownerId>/…' — zone BEFORE owner).`,
  ].filter(Boolean))
}

function runScenario22() {
  const d = []
  const p = pipeline(SC22)
  const aTag = subtreeHtml(p.html, 'chain-a')
  d.push(`chain-a SSR: ${aTag.slice(0, 260)}`)
  d.push(`chain-a: 'retyped-A'=${p.html.includes('retyped-A')} 'real-A'=${p.html.includes('real-A')} 'retyped-B'=${p.html.includes('retyped-B')}`)
  const bTag = subtreeHtml(p.html, 'chain-b')
  d.push(`chain-b SSR: ${bTag.slice(0, 200)}`)
  d.push(`chain-b: 'deliverable content'=${p.html.includes('deliverable content')} 'real-C'=${p.html.includes('real-C')} deliv-child=${p.html.includes('deliv-child')}`)
  const cTag = subtreeHtml(p.html, 'chain-c')
  d.push(`chain-c SSR: ${cTag.slice(0, 200)} m-a/m-b present: ${p.html.includes('m-a') || p.html.includes('m-b')}`)
  const dTag = subtreeHtml(p.html, 'chain-d')
  d.push(`chain-d SSR: ${dTag.slice(0, 200)} o-a/o-b present: ${p.html.includes('o-a') || p.html.includes('o-b')}`)
  const creates = p.ops.filter((o) => o.kind === 'create').map((c) => c.wire)
  d.push(`real-a wire created=${creates.includes('real-a')} real-b wire created=${creates.includes('real-b')}`)
  d.push(`warnings=${JSON.stringify(warnCodes(p))}`)
  const ok = p.html.includes('retyped-A') && p.html.includes('retyped-B') &&
    !p.html.includes('real-A') && !p.html.includes('real-B') &&
    attr(p.html, 'real-a', 'style') === 'color: red;' && attr(p.html, 'real-b', 'style') === 'color: blue;' &&
    p.html.includes('real-C') && !p.html.includes('deliverable content') && !p.html.includes('deliv-child') &&
    p.html.includes('real-D') && !p.html.includes('m-a') && !p.html.includes('m-b') &&
    p.html.includes('real-E') && p.html.includes('real-F') && !p.html.includes('o-a') && !p.html.includes('o-b') &&
    p.html.indexOf('real-E') < p.html.indexOf('real-F')
  record('22', ok, d)
}

function runScenario23() {
  const d = []
  const p = pipeline(SC23)
  const host = stateOf(p, 'fill-host')[0]
  d.push(`fill-host states=${stateOf(p, 'fill-host').length} graph children=${host?.children?.length}`)
  const creates = p.ops.filter((o) => o.kind === 'create')
  const hostEl = creates.find((c) => c.wire === host?.nodeId)
  d.push(`host create type=${hostEl?.type} wire=${hostEl?.wire}`)
  const syn = creates.filter((c) => /^.*:(a|b)$/.test(c.wire)).map((c) => `${c.wire}(${c.type})`)
  d.push(`synthetic fill wires: ${syn.join(', ')}`)
  d.push(`host SSR: ${(p.html.match(/<[^>]*id="fill-host"[^>]*>.*?<\/[^>]*>/s) ?? ['MISSING'])[0].slice(0, 240)}`)
  d.push(`'fill-a'=${p.html.includes('fill-a')} 'nested text'=${p.html.includes('nested text')} display:none=${p.html.includes('display: none')}`)
  // reverse (R-H8)
  const rev = reverseTranslate(p.translated.root)
  const revHost = rev.template.root.children.find((n) => n.props?.id === 'fill-host')
  d.push(`reversed fill-host children: ${JSON.stringify(revHost?.children ?? '(absent)')} component: ${JSON.stringify(revHost?.component).slice(0, 120)}`)
  const re = translateLegacy(rev)
  d.push(`re-translate warns: ${JSON.stringify(tWarnCodes(re))}`)
  const p2 = pipeline(rev)
  d.push(`re-render fill-a: ${p2.html.includes('fill-a')} nested text: ${p2.html.includes('nested text')}`)
  // P-EMIT-3 core + the B2 pin (reviewed expectation, scenario 23): the nested
  // seam consumer inside a SEAM-LESS def's value does NOT materialize — no
  // prototype is minted (translate.md D8/B2), so fill-b emits its OWN authored
  // content and 'nested text' never appears (forward AND re-render)
  const ok = host?.children?.length === 0 && hostEl?.type === 'div' &&
    p.html.includes('fill-a') && !p.html.includes('nested text') && !p.html.includes('display: none') &&
    revHost?.children === undefined && re && tWarnCodes(re).length === 0 &&
    p2.html.includes('fill-a') && !p2.html.includes('nested text')
  record('23', ok, d)
}

function runScenario24() {
  const d = []
  const p = pipeline(SC24, { path: true })
  const tCodes = tWarnCodes(p.translated)
  d.push(`translate warns: ${JSON.stringify(tCodes)}`)
  const mixed = findNode(p, 'mixed')
  d.push(`mixed anchors: ${mixed?.anchors?.map((a) => `${a.role}:${a.target}`).join(',')}`)
  const emptyList = findNode(p, 'empty-list')
  d.push(`empty-list anchors: ${emptyList?.anchors?.map((a) => a.role).join(',') || '(none)'}`)
  const producer = findNode(p, 'p-producer')
  d.push(`p-producer container anchors: ${producer?.anchors?.filter((a) => a.role === 'container').map((a) => a.target).join(',') || '(none)'}`)
  d.push(`p-producer rendered=${p.html.includes('id="p-producer"')} p-consumer rendered=${p.html.includes('id="p-consumer"')} p-consumer path-states=${stateOf(p, 'p-consumer').length}`)
  const zc = stateOf(p, 'zone-consumer')
  d.push(`zone-consumer path-states=${zc.length}`)
  for (const s of zc) d.push(`  pathKey=${s.pathKey} forkKey=${s.forkKey} activePlacement=${s.activePlacement}`)
  d.push(`zone-consumer elements=${countSubstr(p.html, 'id="zone-consumer"')}`)
  d.push(`dup-p1 style=${JSON.stringify(attr(p.html, 'dup-p1', 'style'))} dup-p2 style=${JSON.stringify(attr(p.html, 'dup-p2', 'style'))}`)
  const ss = stateOf(p, 'self-serving')
  d.push(`self-serving path-states=${ss.length} rendered=${p.html.includes('id="self-serving"')}`)
  const cCodes = warnCodes(p)
  const veto = tCodes.filter((c) => c === 'placement-name-vetoed').length
  const circ = cCodes.filter((c) => c === 'circular-source').length
  const dupWarn = cCodes.filter((c) => c === 'placement-duplicate-reference').length
  d.push(`compile warns: veto=${veto} circular-source=${circ} duplicate-reference=${dupWarn} all=${JSON.stringify(cCodes)}`)
  // reverse of 'mixed' (F2 flat merge)
  const rev = reverseTranslate(p.translated.root)
  const revMixed = rev.template.root.children.find((n) => n.props?.id === 'mixed')
  d.push(`reversed mixed placement: ${JSON.stringify(revMixed?.placement)}`)
  const ok = mixed?.anchors?.some((a) => a.role === 'container' && a.target === 'zone-a') &&
    mixed?.anchors?.some((a) => a.role === 'content' && a.target === 'zone-b') &&
    emptyList?.anchors?.filter((a) => a.role === 'container' || a.role === 'content').length === 0 &&
    tCodes.filter((c) => c === 'placement-name-vetoed').length === 1 &&
    !producer?.anchors?.some((a) => a.role === 'container') &&
    p.html.includes('id="p-producer"') && p.html.includes('id="p-consumer"') &&
    zc.length === 2 && new Set(zc.map((s) => s.pathKey)).size === 2 &&
    zc.every((s) => s.forkKey === s.pathKey) && zc.every((s) => s.activePlacement === 'zone') &&
    countSubstr(p.html, 'id="zone-consumer"') === 2 &&
    attr(p.html, 'dup-p1', 'style') === null && attr(p.html, 'dup-p2', 'style') === null &&
    ss.length === 1 && p.html.includes('id="self-serving"') &&
    veto === 1 && circ === 1 && dupWarn === 0 &&
    JSON.stringify(revMixed?.placement) === JSON.stringify({ placementName: 'zone-a', targetPlacement: ['zone-b'] })
  record('24', ok, d)
}

function runScenario25() {
  const d = []
  const p = pipeline(SC25, { path: true })
  const tCodes = tWarnCodes(p.translated)
  d.push(`translate warns: ${JSON.stringify(tCodes)}`)
  const bc = stateOf(p, 'bestfit-consumer')
  d.push(`bestfit-consumer path-states=${bc.length}`)
  for (const s of bc) d.push(`  pathKey=${s.pathKey} activePlacement=${s.activePlacement}`)
  d.push(`bestfit elements=${countSubstr(p.html, 'id="bestfit-consumer"')}`)
  d.push(`side-a style=${JSON.stringify(attr(p.html, 'side-a', 'style'))} side-b style=${JSON.stringify(attr(p.html, 'side-b', 'style'))}`)
  const gc = stateOf(p, 'ghost-consumer')
  d.push(`ghost-consumer path-states=${gc.length} rendered=${p.html.includes('ghost-consumer')}`)
  const dc = stateOf(p, 'depth-consumer')
  d.push(`depth-consumer path-states=${dc.length} rendered=${p.html.includes('id="depth-consumer"')} deep-producer rendered=${p.html.includes('id="deep-producer"')}`)
  const deepProd = findNode(p, 'deep-producer')
  d.push(`deep-producer container anchors: ${deepProd?.anchors?.filter((a) => a.role === 'container').map((a) => a.target).join(',') || '(none)'}`)
  const cCodes = warnCodes(p)
  d.push(`compile warns: ${JSON.stringify(cCodes)}`)
  const ok = bc.length === 2 && new Set(bc.map((s) => s.pathKey)).size === 2 &&
    bc.every((s) => s.activePlacement === 'side-zone') &&
    countSubstr(p.html, 'id="bestfit-consumer"') === 2 &&
    attr(p.html, 'side-a', 'style') === null && attr(p.html, 'side-b', 'style') === null &&
    gc.length === 0 && !p.html.includes('ghost-consumer') &&
    dc.length === 1 && p.html.includes('id="depth-consumer"') && p.html.includes('id="deep-producer"') &&
    !deepProd?.anchors?.some((a) => a.role === 'container') &&
    tCodes.filter((c) => c === 'placement-name-vetoed').length === 1
  record('25', ok, d)
}

function runScenario26() {
  const d = []
  const p = pipeline(SC26)
  const tCodes = tWarnCodes(p.translated)
  d.push(`translate warns: ${JSON.stringify(tCodes)}`)
  d.push(`bad-children rendered=${p.html.includes('id="bad-children"')} object-child present=${p.html.includes('object-child')}`)
  const objC = stateOf(p, 'obj-content')[0]
  d.push(`obj-content state content=${JSON.stringify(objC?.content)}`)
  d.push(`obj-content SSR: ${(p.html.match(/<div[^>]*id="obj-content"[^>]*>.*?<\/div>/s) ?? ['MISSING'])[0].slice(0, 140)}`)
  const vsTag = (p.html.match(/<div[^>]*id="vendor-style"[^>]*>/) ?? ['MISSING'])[0]
  d.push(`vendor-style SSR style attr: ${vsTag.slice(0, 320)}`)
  const vsNode = findNode(p, 'vendor-style')
  d.push(`vendor-style compiled css.style: ${JSON.stringify(vsNode?.css?.style)}`)
  const rev = reverseTranslate(p.translated.root)
  const revVs = rev.template.root.children.find((n) => n.props?.id === 'vendor-style')
  const revVsStyle = revVs?.css?.style
  d.push(`reversed vendor-style css.style keys: ${JSON.stringify(Object.keys(revVsStyle ?? {}))}`)
  const revKeysKebab = Object.keys(revVsStyle ?? {}).map((k) => k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^ms-/, '-ms-').replace(/^-/, '')).sort().join(',')
  d.push(`reversed vendor-style keys kebab-normalized: ${revKeysKebab}`)
  const sc = stateOf(p, 'seam-consumer')
  d.push(`seam-consumer states=${sc.length} SSR: ${subtreeHtml(p.html, 'seam-consumer').slice(0, 160)}`)
  const revSc = rev.template.root.children.find((n) => n.props?.id === 'seam-consumer')
  d.push(`reversed seam-consumer children: ${JSON.stringify(revSc?.children ?? '(absent)')} component: ${JSON.stringify(revSc?.component)}`)
  d.push(`reversed defs: ${JSON.stringify(rev.template.component).slice(0, 140)}`)
  const re = translateLegacy(rev)
  d.push(`re-translate warns: ${JSON.stringify(tWarnCodes(re))}`)
  const reConsumer = re.nodes.find((n) => n.props?.id === 'seam-consumer')
  d.push(`re-translated seam-consumer seam anchor: ${JSON.stringify(reConsumer?.anchors?.find((a) => a.role === 'target')?.options)}`)
  const p2 = pipeline(rev)
  d.push(`re-render seam-consumer has nav menu-bar: ${p2.html.includes('menu-bar')} has 'logo': ${p2.html.includes('>logo<')}`)
  // PINNED CONTRACT (translate.md K5 extension + TR-H16, reviewed scenario 26):
  // the seam target round-trips as the legacy `target` field, so the reversed
  // doc re-translates to the SAME seam plan (options.seam = 'children').
  // GENUINE ENGINE DEFECT (reported, red by design): nodeToLegacy emits
  // `target` for options.applyPath only — the seam anchor reverses to the
  // pre-kernel {reference} form and the seam plan is LOST.
  const seamRoundTrip = JSON.stringify(revSc?.component) === JSON.stringify({ reference: 'menu', target: 'children' }) &&
    reConsumer?.anchors?.find((a) => a.role === 'target')?.options?.seam === 'children' &&
    p2.html.includes('menu-bar')
  const hg = stateOf(p, 'handler-gap')
  const hgNode = findNode(p, 'handler-gap')
  d.push(`handler-gap states=${hg.length} rendered=${p.html.includes('id="handler-gap"')}`)
  d.push(`handler-gap hdef source anchor: ${hgNode?.anchors?.some((a) => a.role === 'source' && a.target === 'hdef')}`)
  const resultsOut = dispatchEvent(hgNode, p.supervisor.handlerContext, 'click')
  d.push(`handler-gap click results=${JSON.stringify(resultsOut)}`)
  const ok = tCodes.includes('children-shape-invalid') && p.html.includes('id="bad-children"') && !p.html.includes('object-child') &&
    p.html.includes('[object Object]') &&
    vsTag.includes('-webkit-transform: rotate(90deg)') && vsTag.includes('-ms-transition: all 1s') &&
    vsTag.includes('url(data:image/png;base64,iVBORw0KGgo=)') && vsTag.includes('content: &quot;a:b&quot;') &&
    revKeysKebab === 'background,content,ms-transition,webkit-transform' &&
    revVsStyle?.background === 'url(data:image/png;base64,iVBORw0KGgo=) center/cover no-repeat' &&
    revVsStyle?.content === '"a:b"' &&
    p.html.includes('shell text') && p.html.includes('menu-bar') && p.html.includes('>logo<') &&
    revSc?.children === undefined &&
    tCodes.filter((c) => c === 'component-target-gap').length === 1 &&
    p.html.includes('id="handler-gap"') && JSON.stringify(resultsOut) === JSON.stringify(['alive']) &&
    seamRoundTrip
  record('26', ok, d, [
    'reverse seam persistence (GENUINE ENGINE DEFECT — reviewed, pinned contract): nodeToLegacy emits `target` only for options.applyPath (K5); the pinned contract (translate.md K5 extension + TR-H16, stress-test review loop #3 scenario 26) requires a D7 seam target (options.seam, no applyPath) to reverse as `{reference, target: <seam>}` so re-translate reproduces the seam plan. Actual: the seam anchor reverses to {reference} WITHOUT the target — the seam plan is LOST (re-translate options = {}; re-render has NO nav menu-bar). Red by design.',
    'F7 reverse key case (reviewed — expectation fix): camelKey(`-ms-transition`) yields `MsTransition` (leading-dash branch capitalizes the first segment), NOT the authored `msTransition` and NOT kebab `-ms-transition`; kebab-normalized round-trip keys match the scenario\'s corrected list — the round-trip is kebab-normalized VALUE-equivalent (pinned in translate.md F7).',
    'handler-gap (reviewed — expectation fix): the gap-target binding is NOT skipped pre-anchor — applyPlans mints the SOURCE anchor (role source wins when value is set) with the def value (K8 recognition-only gap: the anchor is ALWAYS kept); `hdef` IS provided at depth-0 (nothing consumes it here). The def never materializes and nothing crashes.',
  ])
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const t0 = now()
function run(label, fn) {
  const s = now()
  fn()
  console.log(`[probe] scenario ${label} done in ${(now() - s).toFixed(0)}ms`)
}
run(17, runScenario17)
run(18, runScenario18)
run(19, runScenario19)
run(20, runScenario20)
run(21, runScenario21)
run(22, runScenario22)
run(23, runScenario23)
run(24, runScenario24)
run(25, runScenario25)
run(26, runScenario26)

// ---------------------------------------------------------------------------
// RESULTS output
// ---------------------------------------------------------------------------
const lines = []
lines.push('# Stress-test probes round 2 — RESULTS (scenarios 17-26)')
lines.push('')
lines.push(`Probe agent output. Generated by \`scripts/stress-probes/run-all-round2.mjs\` on ${new Date().toISOString()}.`)
lines.push('Classification (doc/spec bug | data-authoring bug | genuine engine defect) is the REVIEW agent\'s job — nothing here is fixed. Each scenario\'s PASS/MISMATCH is against the scenario doc\'s "Expected output" only.')
lines.push('')
for (const r of results) {
  lines.push(`## Scenario ${r.scenario} — ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const l of r.details) lines.push(`- ${l}`)
  for (const n of r.notes) lines.push(`- NOTE: ${n}`)
  lines.push('')
}
lines.push('## Validation trio (run after probe work)')
lines.push('')
lines.push('- `npm test` and `npm run typecheck`: see probe console (expected unchanged: 768 tests / clean).')
lines.push('')

const out = lines.join('\n')
const { writeFileSync } = await import('node:fs')
writeFileSync(new URL('./RESULTS-round2.md', import.meta.url), out)

console.log('=== STRESS PROBE ROUND 2 SUMMARY ===')
for (const r of results) {
  console.log(`Scenario ${r.scenario}: ${r.pass ? 'PASS' : 'MISMATCH'}`)
  if (r.scenario === 26) { for (const d of r.details) console.log('  sc26 |', d.slice(0, 200)) }
}
const passCount = results.filter((r) => r.pass).length
console.log(`Total: ${passCount}/${results.length} PASS`)
console.log(`Total probe run: ${(now() - t0).toFixed(0)}ms`)
