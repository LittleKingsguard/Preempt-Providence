// Stress-test review loop — step (b) PROBE agent, translate-layer pass.
// Completes every scenario in archive/test-data/2026-08-15/2026-08-15-translate-stress-scenarios.md using
// ONLY core (dist/core/*) + legacy JSON. Envelopes kept EXACTLY as authored;
// any deviation is noted in RESULTS.md. No engine behavior is fixed here.
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { createClient } from '../../dist/core/client.js'
import { EventBridge } from '../../dist/core/events.js'
import { DomAdapter, SSRFragmentAdapter, VOID_TAGS } from '../../dist/core/adapters.js'
import { emitElements, applyOps, treeFromOps, treeSig } from '../../dist/core/render-helpers.js'
import { diffMinimal } from '../../dist/core/render.js'

// ---------------------------------------------------------------------------
// Minimal DOM shim (same pattern as scripts/stress-probes/run-all.mjs)
// ---------------------------------------------------------------------------
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.attrs = {}
    this.dataset = {}
    this.style = {}
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

/** Translate (console.warn captured) -> register -> compile -> emit ->
 *  diff -> apply(SSRFragmentAdapter) -> html. Returns everything a probe
 *  needs; translate-time warn strings captured separately from compile. */
function pipeline(doc) {
  const translateWarnStrings = []
  const origWarn = console.warn
  console.warn = (msg) => { translateWarnStrings.push(typeof msg === 'string' ? msg : String(msg)) }
  let translated
  try {
    translated = translateLegacy(doc)
  } finally {
    console.warn = origWarn
  }
  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const clientAPI = createClient(supervisor)
  const cr = translated.root.compile(translated.nodes)
  const byNode = new Map()
  for (const s of cr.actionable) {
    const arr = byNode.get(s.nodeId) ?? []
    arr.push(s)
    byNode.set(s.nodeId, arr)
  }
  supervisor.recordResolved(cr.actionable)
  const actionable = []
  for (const states of byNode.values()) actionable.push(...states)
  const nodeById = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = emitElements(actionable, nodeById)
  const ops = diffMinimal(null, els)
  const ssr = new SSRFragmentAdapter()
  applyOps(ssr, ops)
  const html = ssr.toString()
  return { translated, supervisor, clientAPI, cr, actionable, els, ops, html, byNode, translateWarnStrings, ssr }
}

function domRender(ops) {
  const mount = document.createElement('mount')
  const adapter = new DomAdapter(mount)
  applyOps(adapter, ops)
  const byId = new Map()
  const stack = [...mount.children]
  while (stack.length > 0) {
    const el = stack.pop()
    if (el.id) byId.set(el.id, el)
    stack.push(...el.children)
  }
  return { mount, adapter, byId }
}

function findNode(p, authoredId) {
  return p.supervisor.allNodes().find((n) => n.props?.id === authoredId)
}
function statesOf(p, authoredId) {
  const n = findNode(p, authoredId)
  return n ? (p.byNode.get(n.id) ?? []) : []
}
function attr(html, elemId, attrName) {
  const m = new RegExp(`<[^>]+id="${elemId}"[^>]*>`).exec(html)
  if (!m) return null
  const am = new RegExp(`(?:^|[^A-Za-z0-9])${attrName}="([^"]*)"`).exec(m[0])
  return am ? am[1] : null
}
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

/** Component-anchor snapshot for every binding-bearing node, keyed by the
 *  authored `props.id` (fallback: node id). {role, target, value?, applyPath?}
 *  in anchor (creation) order. */
function anchorsSnapshot(translated) {
  const out = {}
  for (const n of translated.nodes) {
    const comp = n.anchors.filter((a) => (a.role === 'target' || a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string')
    if (comp.length === 0) continue
    out[n.props?.id ?? n.id] = comp.map((a) => ({
      role: a.role,
      target: a.target,
      ...(a.value !== undefined ? { value: a.value } : {}),
      ...(a.options?.applyPath !== undefined ? { applyPath: a.options.applyPath } : {}),
    }))
  }
  return out
}
/** Merged derived declaration per binding-bearing node (authored + synthesized). */
function derivedSnapshot(translated) {
  const out = {}
  for (const n of translated.nodes) {
    if (n.derived !== undefined) out[n.props?.id ?? n.id] = n.derived
  }
  return out
}
/** `code@path` list, order preserved. */
function warnSig(warnings) {
  return warnings.map((w) => `${w.code}${w.path !== undefined ? '@' + w.path : ''}`)
}
function warnStringSig(warnings) {
  return warnings.map((w) => `${w.code}${w.path !== undefined ? '@' + w.path : ''}`)
}

/** Reverse the root, re-translate the reversed doc (warn capture), compare. */
function reverseProbe(translated, opts = {}) {
  const doc = reverseTranslate(translated.root, { content: translated.content, ...opts })
  const warnStrings = []
  const orig = console.warn
  console.warn = (m) => { warnStrings.push(typeof m === 'string' ? m : String(m)) }
  let re = null
  let reError = null
  try {
    re = translateLegacy(doc)
  } catch (e) {
    reError = e
  } finally {
    console.warn = orig
  }
  const first = anchorsSnapshot(translated)
  const again = re ? anchorsSnapshot(re) : null
  return {
    doc, re, reError, warnStrings,
    first, again,
    anchorsEqual: re !== null && JSON.stringify(first) === JSON.stringify(again),
    warningsEqual: re !== null && JSON.stringify(warnSig(translated.warnings)) === JSON.stringify(warnSig(re.warnings)),
  }
}

// ---------------------------------------------------------------------------
// Scenario envelopes — EXACTLY as authored in the scenario doc.
// ---------------------------------------------------------------------------
const S1 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'mix-root' },
      children: [
        { type: 'pane', props: { id: 'mix' }, component: [
          { reference: 'theme', value: 'dark' },
          { reference: 'label', target: 'props.caption' },
          { reference: 'slot', value: 'self-val', target: 'props.slotKey' },
          { reference: 'caption', value: 'CAP' },
        ] },
      ],
    },
  },
}

const S2_E1 = {
  template: { root: { type: 'app', component: [
    { reference: 'a', value: 1, target: 'props.x' },
    { reference: 'a', value: 1, target: 'props.x' },
  ] } },
}
const S2_E2 = {
  template: { root: { type: 'app', component: [
    { reference: 'a', value: 1, target: 'props.x' },
    { reference: 'b', value: 2, target: 'props.x' },
    { reference: 'a', value: 3, target: 'props.y' },
  ] } },
}
const S2_E3 = {
  template: {
    root: { type: 'app', component: [{ reference: 'a', value: 2, target: 'props.z' }] },
    component: { reference: 'a', value: 1, target: 'props.w' },
  },
}

const S3_E1 = {
  template: { root: { type: 'app', component: [
    { reference: 'a', value: 'V' },
    { reference: 'a' },
  ] } },
}
const S3_E2 = {
  template: { root: { type: 'app', component: [
    { reference: 'a' },
    { reference: 'a', value: 'V' },
  ] } },
}

const S4_E1 = {
  template: { root: { type: 'app', component: [
    { reference: 'a', value: 1, target: 'props.x' },
    { reference: 'b', value: 2, target: 'props.x.' },
  ] } },
}
const S4_E2 = {
  template: { root: { type: 'app', component: [
    { reference: 'b', value: 2, target: 'props.x.' },
    { reference: 'a', value: 1, target: 'props.x' },
  ] } },
}
const S4_CTRL = {
  template: { root: { type: 'app', component: [
    { reference: 'x', value: 1, target: 'props.x' },
    { reference: 'y', value: 2, target: 'props.x' },
  ] } },
}

const S5 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'vocab-root' },
      children: [
        { type: 'div', props: { id: 'vocab-a' }, component: [
          { reference: 't1', value: 1, target: 'type' },
          { reference: 't2', value: 2, target: 'content' },
          { reference: 't3', value: 3, target: 'children' },
          { reference: 't4', value: 4, target: 'props' },
          { reference: 't5', value: 5, target: 'css' },
          { reference: 't6', value: 6, target: 'css.id' },
          { reference: 't7', value: 7, target: 'css.classes' },
          { reference: 't8', value: 8, target: 'css.style' },
          { reference: 't9', value: 9, target: 'css.style.font-size' },
          { reference: 't10', value: 10, target: 'handlers' },
          { reference: 't11', value: 11, target: 'handlers.click' },
          { reference: 't12', value: 12, target: 'handlers.beforeAssembly' },
          { reference: 't13', value: 13, target: 'component' },
          { reference: 't14', value: 14, target: 'props.x' },
        ] },
        { type: 'div', props: { id: 'vocab-b' }, component: [
          { reference: 'u1', value: 1, target: 'a.b.c.d' },
          { reference: 'u2', value: 2, target: 'props..x' },
          { reference: 'dot.ref', value: 3, target: 'props.x' },
          { reference: 'slash/ref', value: 4, target: 'props.y' },
        ] },
      ],
    },
  },
}

const S6 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'synth-root' },
      children: [
        { type: 'div', props: { id: 'obj-bake' }, component: { reference: 'obj', value: { k: 1 }, target: 'props.baked' } },
        { type: 'div', props: { id: 'null-bake' }, component: { reference: 'n', value: null, target: 'props.k' } },
      ],
    },
  },
}

const S7 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'warn-root' },
      placement: { placementName: 'zone', targetPlacement: 'somewhere' },
      component: [
        { reference: 'dup1', value: 1 },
        { reference: 'dup1', value: 2 },
        { reference: 'a', value: 1, target: 'props.name.' },
        { reference: 'b', value: 1, target: 'css.style' },
        { reference: 'c', value: 1, target: 'props.dup' },
        { reference: 'd', value: 2, target: 'props.dup' },
        {},
      ],
      handlers: [
        { name: 'h1', phase: 'beforeAssembly', body: 'function () { return 1 }' },
        { name: 'h2', phase: 'after-render', body: 'not-a-function(' },
      ],
    },
  },
}

const S8 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'guard-root' },
      handlers: [
        { name: 'legacy', phase: 'beforeAssembly', body: 'not-a-function(' },
        { name: 'ok', phase: 'after-render', body: 'function (c) { return 1 }' },
      ],
    },
  },
}

const S9 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'collide-root' },
      component: [
        { reference: 'a', value: 1, target: 'props.x' },
        { reference: 'b', value: 2, target: 'props.y' },
      ],
      derived: { props: { y: { $: 'type' } } },
    },
  },
}

const S10 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'drop-root' },
      component: [
        { reference: 'x', value: 'v' },
        { reference: 'y' },
      ],
    },
  },
}
const S10_VARIANT = {
  template: {
    root: {
      type: 'app',
      props: { id: 'drop-root' },
      component: [
        { reference: 'x', value: 'v' },
        { reference: 'y', target: 'y' },
      ],
    },
  },
}

const S11 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'prov3-root' },
      children: [
        { type: 'pane', props: { id: 'prov3' }, component: [
          { reference: 'p1', value: 'v1' },
          { reference: 'p2', value: 'v2' },
          { reference: 'p3', value: 'v3' },
        ] },
      ],
    },
  },
}

const S12 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'shadow-root' },
      children: [
        { type: 'div', props: { id: 'near-provider' }, component: { reference: 'dup', value: 'near' }, children: [
          { type: 'div', props: { id: 'deep-consumer' }, component: { reference: 'dup' }, derived: { props: { 'data-resolved': { $: 'bindings.dup' } } } },
        ] },
        { type: 'div', props: { id: 'sib-consumer' }, component: { reference: 'dup' }, derived: { props: { 'data-resolved': { $: 'bindings.dup' } } } },
      ],
    },
    component: { reference: 'dup', value: 'far' },
  },
}

const S13 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'multi-root' },
      children: [
        { type: 'div', props: { id: 'c-a1' }, component: { reference: 'a' }, derived: { props: { 'data-v': { $: 'bindings.a' } } } },
        { type: 'div', props: { id: 'c-a2' }, component: { reference: 'a' }, derived: { props: { 'data-v': { $: 'bindings.a' } } } },
        { type: 'div', props: { id: 'c-b' }, component: { reference: 'b' }, derived: { props: { 'data-v': { $: 'bindings.b' } } } },
      ],
    },
    component: [
      { reference: 'a', value: 'A' },
      { reference: 'b', value: 'B' },
      { reference: 'r', value: 'RV', target: 'props.rt' },
    ],
  },
}
const S13_VARIANT = {
  template: {
    root: { type: 'app', props: { id: 'multi-root' } },
    component: [
      { reference: 'a', value: 'A' },
      { reference: 'b', value: 'B' },
      { reference: 'r', value: 'RV', target: 'props.rt' },
    ],
  },
}

const S14 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'tri-root' },
      children: [
        { type: 'section', props: { id: 'tri' },
          placement: { placementName: 'slot-1' },
          component: [
            { reference: 'a', value: 1, target: 'props.x' },
            { reference: 'b', target: 'props.y' },
          ],
          handlers: [{ name: 'h', event: 'click', body: 'function (c) { return 2 }' }] },
      ],
    },
  },
}

const S15 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'names-root' },
      children: [
        { type: 'div', props: { id: 'names' }, component: [
          { reference: 'héllo', value: 'H', target: 'props.キー' },
          { reference: 'bindings', value: 'bv', target: 'props.a' },
          { reference: 'children', value: 'cv', target: 'props.b' },
          { reference: 'pathKey', value: 'pv', target: 'props.c' },
          { reference: 'placement', value: 'plv', target: 'props.d' },
          { reference: 'unresolved', value: 'uv', target: 'props.e' },
          { reference: 'props', value: 'ppv', target: 'props.f' },
          { reference: 'empty', target: '' },
          { reference: 'numb', value: 'nv', target: 42 },
        ] },
      ],
    },
  },
}

// ---------------------------------------------------------------------------
// Scenario runners
// ---------------------------------------------------------------------------
const results = []
function record(scenario, pass, details, notes = []) {
  results.push({ scenario, pass, details, notes })
}

function runScenario1() {
  const d = []
  const p = pipeline(S1)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`anchors: ${JSON.stringify(anchorsSnapshot(t)['mix'])}`)
  d.push(`mix derived: ${JSON.stringify(derivedSnapshot(t)['mix'])}`)
  const compileCodes = p.cr.warnings.map((w) => w.code)
  d.push(`compile warnings: ${JSON.stringify(compileCodes)}`)
  const mix = statesOf(p, 'mix')
  d.push(`mix states=${mix.length} bindings=${JSON.stringify(mix[0]?.bindings)}`)
  d.push(`mix cs.props: ${JSON.stringify(mix[0]?.props)}`)
  d.push(`ssr has mix: ${p.html.includes('id="mix"')} prop:slotKey=${attr(p.html, 'mix', 'slotKey')} prop:caption=${attr(p.html, 'mix', 'caption')}`)
  const { byId } = domRender(p.ops)
  d.push(`dom slotKey=${byId.get('mix')?.getAttribute('slotKey')} caption=${byId.get('mix')?.getAttribute('caption')}`)
  const rt = reverseProbe(t)
  d.push(`reversed mix component: ${JSON.stringify(rt.doc.template.root.children[0].component)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError}`)
  d.push(`re-translate anchorsEqual=${rt.anchorsEqual}`)
  const anchorsOk = JSON.stringify(anchorsSnapshot(t)['mix']) === JSON.stringify([
    { role: 'source', target: 'theme', value: 'dark' },
    { role: 'target', target: 'label', applyPath: 'props.caption' },
    { role: 'source', target: 'slot', value: 'self-val', applyPath: 'props.slotKey' },
    { role: 'source', target: 'caption', value: 'CAP' },
  ])
  const derivedOk = deepEqual(derivedSnapshot(t)['mix'], {
    props: { caption: { $: 'bindings.label' }, slotKey: { $: 'bindings.slot' } },
  })
  const warnOk = t.warnings.length === 0
  const compileOk = compileCodes.includes('unresolved-reference')
  const bakeOk = mix.length === 1 && mix[0]?.props?.slotKey === 'self-val' && !('caption' in (mix[0]?.props ?? {}))
  const emitOk = attr(p.html, 'mix', 'slotKey') === 'self-val' && attr(p.html, 'mix', 'caption') === null
  const reverseOk = JSON.stringify(rt.doc.template.root.children[0].component) === JSON.stringify([
    { reference: 'theme', value: 'dark' },
    { reference: 'label', target: 'props.caption' },
    { reference: 'slot', value: 'self-val', target: 'props.slotKey' },
    { reference: 'caption', value: 'CAP' },
  ]) && rt.anchorsEqual && rt.re?.warnings?.length === 0
  const ok = anchorsOk && derivedOk && warnOk && compileOk && bakeOk && emitOk && reverseOk
  record('1', ok, d, [
    `MISMATCH core: expected "bindings.theme='dark', bindings.slot='self-val', bindings.caption='CAP' (publishOwn, depth-0)" and emit prop:slotKey="self-val" — actual: mix carries a target anchor (label), which routes it down the resolveArms path where publishOwn NEVER runs (node.js compile: the publishOwn branch requires targetNames.length === 0). The arm bindings = {} (only 'label' unresolved); the synthesized reads bindings.slot / bindings.label both evaluate null → slotKey AND caption omitted from cs.props and from emission. The cross-namespace caption/CAP trap (doc's stated goal) is confirmed, but the self-provider half of the expectation does not survive on a node that ALSO consumes.`,
    'Reverse + N1 + re-translate: exact 4-binding array, anchors identical, warnings [] — PASS.',
  ])
}

function runScenario2() {
  const d = []
  // Envelope 1
  const p1 = pipeline(S2_E1)
  d.push(`E1 warnings: ${JSON.stringify(warnStringSig(p1.translated.warnings))}`)
  d.push(`E1 anchors: ${JSON.stringify(Object.values(anchorsSnapshot(p1.translated))[0])}`)
  const snap1 = anchorsSnapshot(p1.translated)
  const id1 = Object.keys(snap1)[0]
  d.push(`E1 derived: ${JSON.stringify(derivedSnapshot(p1.translated)[id1])}`)
  const e1warnOk = warnStringSig(p1.translated.warnings).join('|') === 'component-duplicate-reference@root'
  const e1anchorOk = snap1[id1]?.length === 1 && snap1[id1][0]?.role === 'source' && snap1[id1][0]?.target === 'a' && snap1[id1][0]?.value === 1 && snap1[id1][0]?.applyPath === 'props.x'
  // Envelope 2
  const p2 = pipeline(S2_E2)
  d.push(`E2 warnings: ${JSON.stringify(warnStringSig(p2.translated.warnings))}`)
  const snap2 = anchorsSnapshot(p2.translated)
  const id2 = Object.keys(snap2)[0]
  d.push(`E2 anchors: ${JSON.stringify(snap2[id2])}`)
  const e2warnOk = warnStringSig(p2.translated.warnings).join('|') === 'component-duplicate-reference@root|component-duplicate-target@root'
  const e2anchorOk = snap2[id2]?.length === 1 && snap2[id2][0]?.role === 'source' && snap2[id2][0]?.target === 'a' && snap2[id2][0]?.value === 1 && snap2[id2][0]?.applyPath === 'props.x'
  // Envelope 3 (cross-surface)
  const p3 = pipeline(S2_E3)
  const t3 = p3.translated
  d.push(`E3 warnings: ${JSON.stringify(warnStringSig(t3.warnings))}`)
  const snap3 = anchorsSnapshot(t3)
  const id3 = Object.keys(snap3)[0]
  d.push(`E3 anchors: ${JSON.stringify(snap3[id3])}`)
  d.push(`E3 derived: ${JSON.stringify(derivedSnapshot(t3)[id3])}`)
  const root3States = p3.byNode.get(p3.translated.root.id)
  d.push(`E3 root states=${root3States?.length} bindings=${JSON.stringify(root3States?.[0]?.bindings)} props=${JSON.stringify(root3States?.[0]?.props)}`)
  d.push(`E3 ssr: w attr=${attr(p3.html, p3.translated.root.id, 'w')} z attr=${attr(p3.html, p3.translated.root.id, 'z')} w-in-html=${p3.html.includes('w="2"')} z-in-html=${p3.html.includes('z="2"')}`)
  d.push(`E3 root rendered=${p3.html.includes(`id="${p3.translated.root.props.id}"`)}`)
  const e3warnOk = t3.warnings.length === 0
  const e3anchorOk = snap3[id3]?.length === 2 && snap3[id3].every((a) => a.role === 'source' && a.target === 'a') &&
    snap3[id3].some((a) => a.value === 1 && a.applyPath === 'props.w') && snap3[id3].some((a) => a.value === 2 && a.applyPath === 'props.z')
  const e3derivedOk = deepEqual(derivedSnapshot(t3)[id3], { props: { z: { $: 'bindings.a' }, w: { $: 'bindings.a' } } })
  const e3renderOk = root3States?.length === 1 && JSON.stringify(root3States[0].bindings) === JSON.stringify({ a: 2 }) &&
    p3.html.includes(`id="${p3.translated.root.props.id}"`) && p3.html.includes('w="2"') && p3.html.includes('z="2"')
  const rt3 = reverseProbe(t3)
  d.push(`E3 reversed template.component: ${JSON.stringify(rt3.doc.template.component)}`)
  d.push(`E3 re-translate anchors: ${JSON.stringify(rt3.again)}`)
  d.push(`E3 re-translate warnings: ${rt3.re ? JSON.stringify(warnStringSig(rt3.re.warnings)) : 'ERR ' + rt3.reError}`)
  const ok = e1warnOk && e1anchorOk && e2warnOk && e2anchorOk && e3warnOk && e3anchorOk && e3derivedOk && e3renderOk
  record('2', ok, d, [
    `MISMATCH core (E2): doc expected warning order [component-duplicate-reference, component-duplicate-target] ("index 3 … then index 2"). Actual per planBindings processing (strict array order, per-binding reference-check-then-target-check): index 1 ({b,2,props.x}) fires component-duplicate-target BEFORE index 2 ({a,3,props.y}) fires component-duplicate-reference → [component-duplicate-target, component-duplicate-reference]. The doc's "index 3/index 2" numbering also does not match the 3-element array (max index 2). The ref-check-precedes-target-check claim for the index-2 binding itself is CONFIRMED (no dup-target fires for props.y).`,
    `E1 PASS (exactly one duplicate-reference; the duplicate's target never compared; one anchor; derived props.x). E3 PASS: zero warnings across the two root binding surfaces (separate planBindings seen-sets — the per-surface K8 guard bypass confirmed); root carries TWO source:a anchors + both synthesized derived keys (z/w); no phantom fork materializes (no consumers of 'a' in the doc).`,
    `E3 recorded actual (doc defers): root states=1, bindings.a='2' (first anchor in creation order = template.root.component's value 2 — publishOwn first-wins), derived bake w=2 AND z=2 → SSR prop:w="2" prop:z="2". Reverse emits template.component {a,2,props.z} ONLY — the second anchor for the same reference is dropped by nodeToLegacy (K5 seenReferences) and the template.component surface binding (value 1, props.w) is lost; re-translate has 1 anchor (round-trip not anchor-identical — silent loss of one provider on the cross-surface shape).`,
    'Both surfaces warn at the same path string "root" — path-indistinguishable cross-surface warnings (doc note confirmed; no warnings fired here).',
  ])
}

function runScenario3() {
  const d = []
  const p1 = pipeline(S3_E1)
  const snap1 = anchorsSnapshot(p1.translated)
  const id1 = Object.keys(snap1)[0]
  d.push(`E1 warnings: ${JSON.stringify(warnStringSig(p1.translated.warnings))}`)
  d.push(`E1 anchors: ${JSON.stringify(snap1[id1])}`)
  const root1 = p1.byNode.get(p1.translated.root.id)
  d.push(`E1 root states=${root1?.length} bindings=${JSON.stringify(root1?.[0]?.bindings)} root rendered=${p1.html.includes(`id="${p1.translated.root.props.id}"`)}`)
  const e1warnOk = warnStringSig(p1.translated.warnings).join('|') === 'component-duplicate-reference@root'
  const e1anchorOk = snap1[id1]?.length === 1 && snap1[id1][0]?.role === 'source' && snap1[id1][0]?.target === 'a' && snap1[id1][0]?.value === 'V'
  const e1compileOk = root1?.length === 1 && root1[0]?.bindings?.a === 'V'
  const p2 = pipeline(S3_E2)
  const snap2 = anchorsSnapshot(p2.translated)
  const id2 = Object.keys(snap2)[0]
  d.push(`E2 warnings: ${JSON.stringify(warnStringSig(p2.translated.warnings))}`)
  d.push(`E2 anchors: ${JSON.stringify(snap2[id2])}`)
  d.push(`E2 compile warnings: ${JSON.stringify(p2.cr.warnings.map((w) => w.code))}`)
  const root2 = p2.byNode.get(p2.translated.root.id)
  d.push(`E2 root states=${root2?.length} bindings=${JSON.stringify(root2?.[0]?.bindings)} root rendered=${p2.html.includes(`id="${p2.translated.root.props.id}"`)}`)
  const e2warnOk = warnStringSig(p2.translated.warnings).join('|') === 'component-duplicate-reference@root'
  const e2anchorOk = snap2[id2]?.length === 1 && snap2[id2][0]?.role === 'target' && snap2[id2][0]?.target === 'a'
  const e2compileOk = root2?.length === 1 && !('a' in (root2?.[0]?.bindings ?? {})) && p2.cr.warnings.some((w) => w.code === 'unresolved-reference')
  const ok = e1warnOk && e1anchorOk && e1compileOk && e2warnOk && e2anchorOk && e2compileOk
  record('3', ok, d, [
    `Both envelopes: IDENTICAL single warning component-duplicate-reference@root, opposite kept halves — provider-first keeps source:a(V) (publishOwn → bindings.a=V, root renders); consumer-first keeps target:a (consumer), the provider is blocked, value V silently lost, compile unresolved-reference, bindings={} — order-sensitive first-wins with the same warning code, exactly as the doc framed. PASS on both.`,
  ])
}

function runScenario4() {
  const d = []
  const p1 = pipeline(S4_E1)
  d.push(`E1 warnings: ${JSON.stringify(warnStringSig(p1.translated.warnings))}`)
  d.push(`E1 anchors: ${JSON.stringify(Object.values(anchorsSnapshot(p1.translated))[0])}`)
  const p2 = pipeline(S4_E2)
  d.push(`E2 warnings: ${JSON.stringify(warnStringSig(p2.translated.warnings))}`)
  d.push(`E2 anchors: ${JSON.stringify(Object.values(anchorsSnapshot(p2.translated))[0])}`)
  const pc = pipeline(S4_CTRL)
  d.push(`CTRL warnings: ${JSON.stringify(warnStringSig(pc.translated.warnings))}`)
  d.push(`CTRL anchors: ${JSON.stringify(Object.values(anchorsSnapshot(pc.translated))[0])}`)
  const e1Warn = warnStringSig(p1.translated.warnings).join('|')
  const e2Warn = warnStringSig(p2.translated.warnings).join('|')
  const noDupOk = e1Warn === 'component-target-skipped@root' && e2Warn === 'component-target-skipped@root'
  const e1a = Object.values(anchorsSnapshot(p1.translated))[0]
  const e2a = Object.values(anchorsSnapshot(p2.translated))[0]
  const anchorSetOk = JSON.stringify(e1a.map(({ role, target, value, applyPath }) => ({ role, target, value, applyPath: applyPath ?? null })).sort((x, y) => x.target < y.target ? -1 : 1)) ===
    JSON.stringify(e2a.map(({ role, target, value, applyPath }) => ({ role, target, value, applyPath: applyPath ?? null })).sort((x, y) => x.target < y.target ? -1 : 1)) &&
    e1a.length === 2 && e1a[0]?.applyPath === 'props.x' && e1a[1]?.applyPath === undefined &&
    e2a[0]?.applyPath === undefined && e2a[1]?.applyPath === 'props.x'
  const ctrlOk = warnStringSig(pc.translated.warnings).join('|') === 'component-duplicate-target@root' &&
    Object.values(anchorsSnapshot(pc.translated))[0]?.length === 1
  const ok = noDupOk && anchorSetOk && ctrlOk
  record('4', ok, d, [
    `RAW-string guard timing CONFIRMED: props.x vs props.x. never fires component-duplicate-target in either order; the props.x. binding warns component-target-skipped (dotted-key edge) and carries NO applyPath; props.x synthesizes. Control (distinct refs, exact same target) fires component-duplicate-target with one anchor.`,
    `Warn-array nuance: doc predicted "the WARN ARRAY ORDER differs between the envelopes" — actual: both envelopes produce the IDENTICAL single-element array [component-target-skipped@root] (one edge binding per doc; the warn always comes from the props.x. element, first or second). Only the ANCHOR creation order differs (E1: a then b; E2: b then a) — the anchor SET is order-identical.`,
  ])
}

function runScenario5() {
  const d = []
  const p = pipeline(S5)
  const t = p.translated
  const sig = warnStringSig(t.warnings)
  d.push(`translate warnings (${sig.length}): ${JSON.stringify(sig)}`)
  d.push(`vocab-a anchors: ${JSON.stringify(anchorsSnapshot(t)['vocab-a'])}`)
  d.push(`vocab-b anchors: ${JSON.stringify(anchorsSnapshot(t)['vocab-b'])}`)
  d.push(`vocab-a derived: ${JSON.stringify(derivedSnapshot(t)['vocab-a'])}`)
  d.push(`vocab-b derived: ${JSON.stringify(derivedSnapshot(t)['vocab-b'])}`)
  d.push(`compile warnings: ${JSON.stringify(p.cr.warnings.map((w) => w.code))}`)
  d.push(`ssr vocab-a x=${attr(p.html, 'vocab-a', 'x')} vocab-b y=${attr(p.html, 'vocab-b', 'y')}`)
  const { byId } = domRender(p.ops)
  d.push(`dom vocab-a x=${byId.get('vocab-a')?.getAttribute('x')} vocab-b y=${byId.get('vocab-b')?.getAttribute('y')}`)
  const expectedSig = [
    'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]',
    'component-target-skipped@root.children[0]',
    'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]',
    'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]',
    'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]', 'component-target-gap@root.children[0]',
    'component-target-gap@root.children[1]', 'component-target-skipped@root.children[1]', 'component-target-skipped@root.children[1]',
  ]
  const warnOk = JSON.stringify(sig) === JSON.stringify(expectedSig)
  const a = anchorsSnapshot(t)['vocab-a']
  const b = anchorsSnapshot(t)['vocab-b']
  const anchorOk = a.length === 14 && a.every((x) => x.role === 'source') && a.filter((x) => x.applyPath === 'props.x').length === 1 && a[13]?.applyPath === 'props.x' &&
    b.length === 4 && b.every((x) => x.role === 'source') && b[3]?.applyPath === 'props.y' && b.slice(0, 3).every((x) => x.applyPath === undefined)
  const derivedOk = deepEqual(derivedSnapshot(t)['vocab-a'], { props: { x: { $: 'bindings.t14' } } }) &&
    deepEqual(derivedSnapshot(t)['vocab-b'], { props: { y: { $: 'bindings.slash/ref' } } })
  const bakeOk = attr(p.html, 'vocab-a', 'x') === '14' && attr(p.html, 'vocab-b', 'y') === '4'
  const rt = reverseProbe(t)
  d.push(`reversed vocab-a component (${rt.doc.template.root.children[0].component.length}): ${JSON.stringify(rt.doc.template.root.children[0].component)}`)
  d.push(`reversed vocab-b component (${rt.doc.template.root.children[1].component.length}): ${JSON.stringify(rt.doc.template.root.children[1].component)}`)
  d.push(`re-translate warnings (${rt.re ? rt.re.warnings.length : 'ERR'}): ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : rt.reError}`)
  d.push(`re-translate anchorsEqual=${rt.anchorsEqual}`)
  const revAOk = JSON.stringify(rt.doc.template.root.children[0].component) === JSON.stringify([
    { reference: 't1', value: 1 }, { reference: 't2', value: 2 }, { reference: 't3', value: 3 }, { reference: 't4', value: 4 },
    { reference: 't5', value: 5 }, { reference: 't6', value: 6 }, { reference: 't7', value: 7 }, { reference: 't8', value: 8 },
    { reference: 't9', value: 9 }, { reference: 't10', value: 10 }, { reference: 't11', value: 11 }, { reference: 't12', value: 12 },
    { reference: 't13', value: 13 }, { reference: 't14', value: 14, target: 'props.x' },
  ])
  const revBOk = JSON.stringify(rt.doc.template.root.children[1].component) === JSON.stringify([
    { reference: 'u1', value: 1 }, { reference: 'u2', value: 2 }, { reference: 'dot.ref', value: 3 }, { reference: 'slash/ref', value: 4, target: 'props.y' },
  ])
  const retransOk = rt.anchorsEqual && rt.re?.warnings?.length === 0
  const warnReemitOk = JSON.stringify(warnStringSig(rt.re.warnings)) === JSON.stringify(sig)
  const ok = warnOk && anchorOk && derivedOk && bakeOk && revAOk && revBOk && retransOk && warnReemitOk
  record('5', ok, d, [
    'Vocabulary partition CONFIRMED: 12 gap (type/content/children/css/css.id/css.classes/css.style/css.style.font-size/handlers/handlers.click/handlers.beforeAssembly/component) + 1 skipped (bare props) on vocab-a; 1 gap (a.b.c.d) + 2 skipped (props..x, dotted reference dot.ref) on vocab-b; t14/u4 synthesize. handlers.beforeAssembly as a TARGET PATH warns gap (recognition-only) — confirmed.',
    `slash/ref CONFIRMED: the dotted-reference carve-out is a literal includes('.') check — 'slash/ref' has no dot, so the K2 carve-out does NOT fire; bindings.slash/ref synthesizes and self-resolves (y="4" bakes on both adapters).`,
    `MISMATCH (re-translate warning-stream claim): doc expected "same anchors + same warning stream (warns are re-emitted on re-translate)". Actual: re-translate warnings = [] — the gap/skip bindings (t1–t13, u1–u3) reverse WITHOUT their target fields (K5 emits target only when options.applyPath exists; a gap/skipped binding never carries one), so there is nothing left on re-translate to re-warn. The doc's OWN reverse expectation ("t14 with target, the rest without") makes the re-emission claim impossible — internally inconsistent. Anchors ARE identical (source anchors survive target-less reverse).`,
  ])
}

function runScenario6() {
  const d = []
  const p = pipeline(S6)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`anchors: ${JSON.stringify(anchorsSnapshot(t))}`)
  d.push(`derived: ${JSON.stringify(derivedSnapshot(t))}`)
  const obj = statesOf(p, 'obj-bake')
  const nul = statesOf(p, 'null-bake')
  d.push(`obj-bake cs.props.baked=${JSON.stringify(obj[0]?.props?.baked)} (deep-equal {k:1}: ${deepEqual(obj[0]?.props?.baked, { k: 1 })})`)
  d.push(`null-bake cs has k=${'k' in (nul[0]?.props ?? {})} bindings=${JSON.stringify(nul[0]?.bindings)}`)
  d.push(`ssr obj-bake baked=${attr(p.html, 'obj-bake', 'baked')} null-bake k=${attr(p.html, 'null-bake', 'k')}`)
  const { byId } = domRender(p.ops)
  d.push(`dom obj-bake baked=${byId.get('obj-bake')?.getAttribute('baked')} null-bake k=${byId.get('null-bake')?.getAttribute('k')}`)
  const rt = reverseProbe(t)
  d.push(`reversed obj-bake component: ${JSON.stringify(rt.doc.template.root.children[0].component)}`)
  d.push(`reversed null-bake component: ${JSON.stringify(rt.doc.template.root.children[1].component)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError} anchorsEqual=${rt.anchorsEqual}`)
  const ok = t.warnings.length === 0 &&
    deepEqual(obj[0]?.props?.baked, { k: 1 }) &&
    !('k' in (nul[0]?.props ?? {})) &&
    attr(p.html, 'obj-bake', 'baked') === '[object Object]' &&
    byId.get('obj-bake')?.getAttribute('baked') === '[object Object]' &&
    attr(p.html, 'null-bake', 'k') === null && byId.get('null-bake')?.getAttribute('k') === null &&
    JSON.stringify(rt.doc.template.root.children[0].component) === JSON.stringify({ reference: 'obj', value: { k: 1 }, target: 'props.baked' }) &&
    JSON.stringify(rt.doc.template.root.children[1].component) === JSON.stringify({ reference: 'n', value: null, target: 'props.k' }) &&
    rt.anchorsEqual && rt.re?.warnings?.length === 0
  record('6', ok, d, [
    'Synthesized-path accepted gaps CONFIRMED on BOTH adapters: object value bakes "[object Object]" (String() coercion, NP5) while the compiled state carries the OBJECT itself (value-faithful in state); null provider publishes null (bindings.n=null) but the derived bake omits the key (N3 omit-on-null) → no prop:k on either adapter.',
    'Reverse: both bindings round-trip exactly (object value intact, null value intact); N1 strips both synthesized keys; re-translate anchor-identical, zero warnings.',
  ])
}

function runScenario7() {
  const d = []
  const p = pipeline(S7)
  const t = p.translated
  const sig = warnStringSig(t.warnings)
  d.push(`translate warnings (${sig.length}): ${JSON.stringify(sig)}`)
  const codes = sig.map((s) => s.split('@')[0])
  d.push(`distinct codes: ${new Set(codes).size} ${[...new Set(codes)].join(',')}`)
  const warnedCodes = [...new Set(p.translateWarnStrings.map((s) => (s.match(/\[legacy-translate\] (\S+)/) ?? [null, null])[1]))]
  d.push(`console.warn codes fired: ${JSON.stringify(warnedCodes)}`)
  d.push(`anchors: ${JSON.stringify(Object.values(anchorsSnapshot(t))[0])}`)
  d.push(`placement anchor: ${JSON.stringify(t.root.anchors.filter((a) => a.role === 'container').map((a) => a.target))}`)
  const rootNode = t.root
  d.push(`live handlers: ${rootNode.handlers.length}`)
  const rootStates = p.byNode.get(t.root.id)
  d.push(`root states=${rootStates?.length} props=${JSON.stringify(rootStates?.[0]?.props)}`)
  const rt = reverseProbe(t)
  d.push(`reversed component: ${JSON.stringify(rt.doc.template.component)}`)
  d.push(`reversed placement: ${JSON.stringify(rt.doc.template.root.placement)}`)
  d.push(`reversed handlers: ${JSON.stringify(rt.doc.template.root.handlers)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError}`)
  const expected = ['component-duplicate-reference@root', 'component-target-skipped@root', 'component-target-gap@root',
    'component-duplicate-target@root', 'component-binding-empty@root', 'handler-phase-unknown@root.handlers[0]',
    'handler-body-invalid@root.handlers[1]', 'component-target-placement@root']
  const orderOk = JSON.stringify(sig) === JSON.stringify(expected)
  const focusOk = warnedCodes.length === 8 && warnedCodes.every((c) => expected.some((e) => e.startsWith(c)))
  const anchors = Object.values(anchorsSnapshot(t))[0]
  const anchorOk = JSON.stringify(anchors) === JSON.stringify([
    { role: 'source', target: 'dup1', value: 1 },
    { role: 'source', target: 'a', value: 1 },
    { role: 'source', target: 'b', value: 1 },
    { role: 'source', target: 'c', value: 1, applyPath: 'props.dup' },
  ]) && t.root.anchors.some((a) => a.role === 'container' && a.target === 'zone')
  const handlerOk = rootNode.handlers.length === 0
  const reWarnDocOk = JSON.stringify(warnStringSig(rt.re.warnings)) === JSON.stringify(['component-target-skipped@root', 'component-target-gap@root', 'component-binding-empty@root'])
  const ok = orderOk && focusOk && anchorOk && handlerOk && reWarnDocOk
  record('7', ok, d, [
    `Exact 8-code order CONFIRMED: binding guards in array order (dup-ref @ index 1, skipped @ index 2, gap @ index 3, dup-target @ index 5, binding-empty @ index 6) → handler guards (phase-unknown @ root.handlers[0], body-invalid @ root.handlers[1]) → component-target-placement. Each fires a focused console.warn (8 distinct codes captured). Anchors exactly [dup1(1), a(1), b(1), c(1,props.dup)] + placement 'zone'; zero live handlers.`,
    `MISMATCH (re-translate claim): doc expected "Re-translate of the reversed doc is NOT warning-clean (the vacuous {}, syntax-edge and gap-target warn re-fire — they are data-borne)". Actual: re-translate warnings = [] — fully clean. Three reasons: (1) the vacuous {} produced NO anchor, so nodeToLegacy never emits it — it cannot re-fire; (2) the skipped (props.name.) and gap (css.style) bindings reverse WITHOUT their target fields (K5 emits target only on applyPath; neither carried one) — nothing left to re-warn; (3) targetPlacement and both handler warns likewise cannot re-fire (reversed placement drops targetPlacement; both handler defs were skipped at translate and are absent). The duplicate guards cannot re-fire — confirmed as expected. Anchors re-translate identical.`,
  ])
}

function runScenario8() {
  const d = []
  const p = pipeline(S8)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  const handlers = t.root.handlers
  d.push(`live handlers: ${handlers.length} names=${handlers.map((h) => h.name).join(',')} ok type=${typeof handlers[0]?.body}`)
  d.push(`compile warnings: ${JSON.stringify(p.cr.warnings.map((w) => w.code))}`)
  d.push(`render ok (guard-root present): ${p.html.includes('guard-root')}`)
  const rt = reverseProbe(t)
  d.push(`reversed handlers: ${JSON.stringify(rt.doc.template.root.handlers)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError}`)
  const ok = warnStringSig(t.warnings).join('|') === 'handler-phase-unknown@root.handlers[0]' &&
    handlers.length === 1 && handlers[0].name === 'ok' && typeof handlers[0].body === 'function' &&
    p.cr.warnings.length === 0 && p.html.includes('guard-root') &&
    JSON.stringify(rt.doc.template.root.handlers) === JSON.stringify([{ name: 'ok', phase: 'after-render', body: 'function (c) { return 1 }' }]) &&
    rt.re?.warnings?.length === 0
  record('8', ok, d, [
    'Phase-first guard ordering CONFIRMED: handler-phase-unknown fires for the beforeAssembly def and the invalid body string is NEVER handed to new Function — no handler-body-invalid, no SyntaxError (NP11 downgrade holds). The doc\'s ONLY warning is the phase guard; `ok` instantiates to a live function and renders.',
    'Reverse: legacy absent, ok ships as its source string; re-translate warnings [] — the phase-unknown def is gone, the round-trip is clean.',
  ])
}

function runScenario9() {
  const d = []
  const p = pipeline(S9)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`anchors: ${JSON.stringify(Object.values(anchorsSnapshot(t))[0])}`)
  d.push(`derived: ${JSON.stringify(Object.values(derivedSnapshot(t))[0])}`)
  const rootStates = p.byNode.get(t.root.id)
  d.push(`root states=${rootStates?.length} bindings=${JSON.stringify(rootStates?.[0]?.bindings)} props=${JSON.stringify(rootStates?.[0]?.props)}`)
  d.push(`ssr x=${attr(p.html, 'collide-root', 'x')} y=${attr(p.html, 'collide-root', 'y')}`)
  const rt = reverseProbe(t)
  d.push(`reversed component: ${JSON.stringify(rt.doc.template.component)}`)
  d.push(`reversed derived: ${JSON.stringify(rt.doc.template.root.derived)}`)
  d.push(`re-translate anchors: ${JSON.stringify(rt.again)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError}`)
  const silentSkipOk = t.warnings.length === 0 &&
    JSON.stringify(Object.values(anchorsSnapshot(t))[0]) === JSON.stringify([
      { role: 'source', target: 'a', value: 1, applyPath: 'props.x' },
      { role: 'source', target: 'b', value: 2 },
    ])
  const bakeOk = attr(p.html, 'collide-root', 'x') === '1' && attr(p.html, 'collide-root', 'y') === 'app'
  const reverseOk = JSON.stringify(rt.doc.template.component) === JSON.stringify([
    { reference: 'a', value: 1, target: 'props.x' },
    { reference: 'b', value: 2 },
  ]) && deepEqual(rt.doc.template.root.derived, { props: { y: { $: 'type' } } })
  const docClaimOk = !rt.anchorsEqual
  const ok = silentSkipOk && bakeOk && reverseOk && docClaimOk
  record('9', ok, d, [
    `MECHANISM CONFIRMED (pass 1): binding b's synthesis is skipped SILENTLY (authoredDerived.props.y exists → classifyTarget returns {} with no warn) → source:b carries NO applyPath while the authored y stays; a synthesizes props.x. Root is target-less → publishOwn: bindings.a=1, bindings.b=2 → prop:x="1" bakes (y evaluates from the authored {$:'type'} expr).`,
    `MISMATCH core (doc claim): expected "Re-translate: anchors differ from the first pass … the round-trip is not anchor-identical". Actual: the round-trip IS anchor-identical — the loss happens on the FIRST pass already (b never had an applyPath), and the reversed doc preserves that shape, so pass 2 reproduces it exactly. The data-loss chain (authored-wins ⇒ no synthesis ⇒ no applyPath ⇒ no reverse target) is real and permanent, but it is idempotent from pass 1 — no ADDITIONAL loss on re-translate. N1 does not strip the authored y ({$:'type'} shape mismatch) — confirmed.`,
  ])
}

function runScenario10() {
  const d = []
  const p = pipeline(S10)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`anchors: ${JSON.stringify(Object.values(anchorsSnapshot(t))[0])}`)
  const rt = reverseProbe(t)
  d.push(`reversed component: ${JSON.stringify(rt.doc.template.component)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError}`)
  d.push(`re-translate anchors: ${JSON.stringify(rt.again)}`)
  const pv = pipeline(S10_VARIANT)
  const tv = pv.translated
  d.push(`variant warnings: ${JSON.stringify(warnStringSig(tv.warnings))}`)
  d.push(`variant anchors: ${JSON.stringify(Object.values(anchorsSnapshot(tv))[0])}`)
  const rtv = reverseProbe(tv)
  d.push(`variant reversed component: ${JSON.stringify(rtv.doc.template.component)}`)
  d.push(`variant re-translate warnings: ${rtv.re ? JSON.stringify(warnStringSig(rtv.re.warnings)) : 'ERR ' + rtv.reError}`)
  const ok = t.warnings.length === 0 &&
    JSON.stringify(Object.values(anchorsSnapshot(t))[0]) === JSON.stringify([
      { role: 'source', target: 'x', value: 'v' },
      { role: 'target', target: 'y' },
    ]) &&
    JSON.stringify(rt.doc.template.component) === JSON.stringify({ reference: 'x', value: 'v' }) &&
    rt.re?.warnings?.length === 0 &&
    warnStringSig(tv.warnings).join('|') === 'component-target-gap@root' &&
    JSON.stringify(rtv.doc.template.component) === JSON.stringify({ reference: 'x', value: 'v' }) &&
    rtv.re?.warnings?.length === 0
  record('10', ok, d, [
    "DROP CONFIRMED mechanically: the plain consumer {reference:'y'} (decided placeholder form, translate.md §2.1) next to a provider is DROPPED on reverse — nodeToLegacy's '!isProvider && applyPath === undefined && hasProvider' branch catches it; the reversed doc carries {x,v} only; re-translate clean. Same for the variant ({y,target:'y'} → gap warn at translate, dropped on reverse).",
    `DOC-VS-CODE BOUNDARY (for the review agent): payload.md R-2's letter scopes the drop to "a name-target (no apply path)" — this {reference:'y'} has NO target field at all, so per the spec sentence it should survive; the code drops any applyPath-less non-provider next to a provider. The scenario doc's "Expected output" calls the survival the R-2-letter reading and the drop the likely actual — recorded as the probe decided: code drops it, docs' R-2 sentence needs the broader wording OR the code needs a plain-consumer carve-out.`,
  ])
}

function runScenario11() {
  const d = []
  const p = pipeline(S11)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`prov3 anchors: ${JSON.stringify(anchorsSnapshot(t)['prov3'])}`)
  const prov3 = statesOf(p, 'prov3')
  d.push(`prov3 states=${prov3.length} bindings=${JSON.stringify(prov3[0]?.bindings)} rendered=${p.html.includes('id="prov3"')}`)
  const rt = reverseProbe(t)
  d.push(`reversed prov3 component: ${JSON.stringify(rt.doc.template.root.children[0].component)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError} anchorsEqual=${rt.anchorsEqual}`)
  const ok = t.warnings.length === 0 &&
    JSON.stringify(anchorsSnapshot(t)['prov3']) === JSON.stringify([
      { role: 'source', target: 'p1', value: 'v1' },
      { role: 'source', target: 'p2', value: 'v2' },
      { role: 'source', target: 'p3', value: 'v3' },
    ]) &&
    prov3.length === 1 && JSON.stringify(prov3[0]?.bindings) === JSON.stringify({ p1: 'v1', p2: 'v2', p3: 'v3' }) &&
    p.html.includes('id="prov3"') &&
    JSON.stringify(rt.doc.template.root.children[0].component) === JSON.stringify([
      { reference: 'p1', value: 'v1' },
      { reference: 'p2', value: 'v2' },
      { reference: 'p3', value: 'v3' },
    ]) && rt.anchorsEqual && rt.re?.warnings?.length === 0
  record('11', ok, d, [
    'Anchor order survives the round-trip: 3 source anchors in array order (p1,p2,p3), reversed as the 3-binding K7 array in anchor order, re-translate identical + warnings []. No first-wins truncation among distinct references. prov3 renders self-scoped (F3 alone/self-scoped), bindings published depth-0.',
  ])
}

function runScenario12() {
  const d = []
  const p = pipeline(S12)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`anchors: ${JSON.stringify(anchorsSnapshot(t))}`)
  const deep = statesOf(p, 'deep-consumer')
  const sib = statesOf(p, 'sib-consumer')
  d.push(`deep-consumer arms=${deep.length} data-resolved=${attr(p.html, 'deep-consumer', 'data-resolved')}`)
  d.push(`sib-consumer arms=${sib.length} data-resolved=${attr(p.html, 'sib-consumer', 'data-resolved')}`)
  d.push(`near-provider rendered=${p.html.includes('id="near-provider"')} root rendered=${p.html.includes('id="shadow-root"')}`)
  d.push(`compile warnings: ${JSON.stringify(p.cr.warnings.map((w) => w.code))}`)
  const rt = reverseProbe(t)
  d.push(`reversed template.component: ${JSON.stringify(rt.doc.template.component)}`)
  d.push(`reversed near-provider component: ${JSON.stringify(rt.doc.template.root.children[0].component)}`)
  d.push(`reversed deep-consumer component: ${JSON.stringify(rt.doc.template.root.children[0].children[0].component)}`)
  d.push(`reversed sib-consumer component: ${JSON.stringify(rt.doc.template.root.children[1].component)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError} anchorsEqual=${rt.anchorsEqual}`)
  const anchorOk = JSON.stringify(Object.values(anchorsSnapshot(t))[0]) === JSON.stringify([{ role: 'source', target: 'dup', value: 'far' }]) &&
    JSON.stringify(anchorsSnapshot(t)['near-provider']) === JSON.stringify([{ role: 'source', target: 'dup', value: 'near' }]) &&
    JSON.stringify(anchorsSnapshot(t)['deep-consumer']) === JSON.stringify([{ role: 'target', target: 'dup' }]) &&
    JSON.stringify(anchorsSnapshot(t)['sib-consumer']) === JSON.stringify([{ role: 'target', target: 'dup' }])
  const compileOk = deep.length === 1 && sib.length === 1 &&
    attr(p.html, 'deep-consumer', 'data-resolved') === 'near' && attr(p.html, 'sib-consumer', 'data-resolved') === 'far' &&
    !p.html.includes('id="near-provider"') && !p.html.includes('id="shadow-root"') && p.cr.warnings.length === 0
  const reverseOk = JSON.stringify(rt.doc.template.component) === JSON.stringify({ reference: 'dup', value: 'far' }) &&
    JSON.stringify(rt.doc.template.root.children[0].component) === JSON.stringify({ reference: 'dup', value: 'near' }) &&
    JSON.stringify(rt.doc.template.root.children[0].children[0].component) === JSON.stringify({ reference: 'dup' }) &&
    JSON.stringify(rt.doc.template.root.children[1].component) === JSON.stringify({ reference: 'dup' }) &&
    rt.anchorsEqual && rt.re?.warnings?.length === 0
  const ok = t.warnings.length === 0 && anchorOk && compileOk && reverseOk
  record('12', ok, d, [
    'K6 nearest-shadows-far CONFIRMED: deep-consumer resolves near-provider first (data-resolved="near", ONE arm, no fork); sib-consumer walks past the sibling to the root depth-0 source (data-resolved="far"). Two consumers of one name, two resolved values, one tree. Root + near-provider dropped from render (F3 — same-name targets in scope). Zero translate warnings.',
    'Reverse: root emits template.component {dup,far}; near-provider {dup,near}; both consumers {dup}; re-translate anchor-identical, warnings [].',
  ])
}

function runScenario13() {
  const d = []
  const p = pipeline(S13)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`root anchors: ${JSON.stringify(Object.values(anchorsSnapshot(t))[0])}`)
  d.push(`root derived: ${JSON.stringify(Object.values(derivedSnapshot(t))[0])}`)
  const a1 = statesOf(p, 'c-a1')
  const a2 = statesOf(p, 'c-a2')
  const cb = statesOf(p, 'c-b')
  d.push(`c-a1 arms=${a1.length} data-v=${attr(p.html, 'c-a1', 'data-v')} c-a2 arms=${a2.length} data-v=${attr(p.html, 'c-a2', 'data-v')} c-b arms=${cb.length} data-v=${attr(p.html, 'c-b', 'data-v')}`)
  d.push(`root rendered=${p.html.includes('id="multi-root"')} rt attr=${attr(p.html, 'multi-root', 'rt')}`)
  d.push(`compile warnings: ${JSON.stringify(p.cr.warnings.map((w) => w.code))}`)
  const rt = reverseProbe(t)
  d.push(`reversed template.component: ${JSON.stringify(rt.doc.template.component)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError} anchorsEqual=${rt.anchorsEqual}`)
  // Variant: consumers removed
  const pv = pipeline(S13_VARIANT)
  const tv = pv.translated
  const rootV = pv.byNode.get(tv.root.id)
  d.push(`variant root states=${rootV?.length} rt=${attr(pv.html, 'multi-root', 'rt')} warnings=${JSON.stringify(warnStringSig(tv.warnings))}`)
  const ok = t.warnings.length === 0 &&
    JSON.stringify(Object.values(anchorsSnapshot(t))[0]) === JSON.stringify([
      { role: 'source', target: 'a', value: 'A' },
      { role: 'source', target: 'b', value: 'B' },
      { role: 'source', target: 'r', value: 'RV', applyPath: 'props.rt' },
    ]) &&
    deepEqual(Object.values(derivedSnapshot(t))[0], { props: { rt: { $: 'bindings.r' } } }) &&
    a1.length === 1 && a2.length === 1 && cb.length === 1 &&
    attr(p.html, 'c-a1', 'data-v') === 'A' && attr(p.html, 'c-a2', 'data-v') === 'A' && attr(p.html, 'c-b', 'data-v') === 'B' &&
    !p.html.includes('id="multi-root"') && p.cr.warnings.length === 0 &&
    JSON.stringify(rt.doc.template.component) === JSON.stringify([
      { reference: 'a', value: 'A' },
      { reference: 'b', value: 'B' },
      { reference: 'r', value: 'RV', target: 'props.rt' },
    ]) && rt.anchorsEqual && rt.re?.warnings?.length === 0 &&
    attr(pv.html, 'multi-root', 'rt') === 'RV'
  record('13', ok, d, [
    'K7 root array CONFIRMED: root = multi-source depth-0 provider (a/b/r); r synthesizes props.rt. Two consumers of a (c-a1, c-a2) resolve the ONE depth-0 source → both data-v="A", single arm each, NO fork (FRK-H1); c-b → "B".',
    'F3 drop vs self-apply CONFIRMED: the root has same-name targets in scope → dropped from render → its own props.rt bake (bindings.r=RV self-provider) never reaches an adapter (no rt attr; root absent). Variant (consumers removed): root alone/self-scoped → actionable → prop:rt="RV" bakes.',
    'Reverse: template.component = the exact 3-binding array (r with target props.rt); re-translate anchor-identical, warnings [].',
  ])
}

function runScenario14() {
  const d = []
  const p = pipeline(S14)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`tri anchors: ${JSON.stringify(anchorsSnapshot(t)['tri'])}`)
  d.push(`tri derived: ${JSON.stringify(derivedSnapshot(t)['tri'])}`)
  const triNode = findNode(p, 'tri')
  d.push(`tri handlers: ${triNode.handlers.map((h) => `${h.name}:${h.event}:${typeof h.body}`).join(',')}`)
  d.push(`compile warnings: ${JSON.stringify(p.cr.warnings.map((w) => w.code))}`)
  const tri = statesOf(p, 'tri')
  d.push(`tri states=${tri.length} bindings=${JSON.stringify(tri[0]?.bindings)} props=${JSON.stringify(tri[0]?.props)}`)
  d.push(`ssr x=${attr(p.html, 'tri', 'x')} y=${attr(p.html, 'tri', 'y')}`)
  const rt = reverseProbe(t)
  d.push(`reversed tri: ${JSON.stringify(rt.doc.template.root.children[0])}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError} anchorsEqual=${rt.anchorsEqual}`)
  const translateOk = t.warnings.length === 0 &&
    JSON.stringify(anchorsSnapshot(t)['tri']) === JSON.stringify([
      { role: 'source', target: 'a', value: 1, applyPath: 'props.x' },
      { role: 'target', target: 'b', applyPath: 'props.y' },
    ]) &&
    deepEqual(derivedSnapshot(t)['tri'], { props: { x: { $: 'bindings.a' }, y: { $: 'bindings.b' } } }) &&
    triNode.handlers.length === 1 && triNode.handlers[0].name === 'h' && triNode.handlers[0].event === 'click' && typeof triNode.handlers[0].body === 'function' &&
    t.root.anchors.some((a) => a.role === 'container' && a.target === 'slot-1')
  const compileWarnOk = p.cr.warnings.some((w) => w.code === 'unresolved-reference')
  const bakeOk = attr(p.html, 'tri', 'x') === '1' && attr(p.html, 'tri', 'y') === null
  const reverseOk = JSON.stringify(rt.doc.template.root.children[0]) === JSON.stringify({
    type: 'section', props: { id: 'tri' }, placement: { placementName: 'slot-1' },
    component: [
      { reference: 'a', value: 1, target: 'props.x' },
      { reference: 'b', target: 'props.y' },
    ],
    handlers: [{ name: 'h', event: 'click', body: 'function (c) { return 2 }' }],
  }) && rt.anchorsEqual && rt.re?.warnings?.length === 0
  const ok = translateOk && compileWarnOk && bakeOk && reverseOk
  record('14', ok, d, [
    `MISMATCH core (compile/emit half): doc expected "props.x bakes 1 — self-provider ⇒ own value. Emits prop:x='1'". Actual: tri carries a target anchor (b) → resolveArms path, publishOwn NEVER runs (same bypass as scenario 1) → arm bindings = {} with b unresolved → BOTH synthesized reads (bindings.a AND bindings.b) evaluate null → props.x AND props.y omitted; SSR emits NO prop:x. The placement + component + handlers surfaces still translate and reverse without interference.`,
    'All three surfaces confirmed otherwise: placement anchor "slot-1" minted, both component anchors with applyPaths, handler h instantiated (click, live function). Reverse emits ALL THREE surfaces (placement, 2-binding array with both targets, handler as source string); re-translate anchor-identical, handler live again, warnings []. No mutual exclusion between surfaces.',
  ])
}

function runScenario15() {
  const d = []
  const p = pipeline(S15)
  const t = p.translated
  d.push(`translate warnings: ${JSON.stringify(warnStringSig(t.warnings))}`)
  d.push(`names anchors: ${JSON.stringify(anchorsSnapshot(t)['names'])}`)
  d.push(`names derived: ${JSON.stringify(derivedSnapshot(t)['names'])}`)
  d.push(`compile warnings: ${JSON.stringify(p.cr.warnings.map((w) => w.code))}`)
  const names = statesOf(p, 'names')
  d.push(`names states=${names.length} bindings=${JSON.stringify(names[0]?.bindings)}`)
  const keys = ['キー', 'a', 'b', 'c', 'd', 'e', 'f']
  const ssrVals = keys.map((k) => `${k}=${attr(p.html, 'names', k)}`).join(' ')
  const domVals = (() => { const { byId } = domRender(p.ops); const el = byId.get('names'); return keys.map((k) => `${k}=${el?.getAttribute(k)}`).join(' ') })()
  d.push(`ssr bakes: ${ssrVals}`)
  d.push(`dom bakes: ${domVals}`)
  const rt = reverseProbe(t)
  d.push(`reversed names component: ${JSON.stringify(rt.doc.template.root.children[0].component)}`)
  d.push(`re-translate warnings: ${rt.re ? JSON.stringify(warnStringSig(rt.re.warnings)) : 'ERR ' + rt.reError} anchorsEqual=${rt.anchorsEqual}`)
  const translateOk = t.warnings.length === 0 &&
    anchorsSnapshot(t)['names']?.length === 9 &&
    JSON.stringify(anchorsSnapshot(t)['names'].filter((a) => a.role === 'target')) === JSON.stringify([{ role: 'target', target: 'empty' }]) &&
    anchorsSnapshot(t)['names'].filter((a) => a.role === 'source').length === 8
  const derivedOk = (() => {
    const der = derivedSnapshot(t)['names']
    const want = ['bindings.héllo', 'bindings.bindings', 'bindings.children', 'bindings.pathKey', 'bindings.placement', 'bindings.unresolved', 'bindings.props']
    const vals = Object.values(der?.props ?? {})
    return vals.length === 7 && vals.every((v) => typeof v?.$ === 'string' && want.includes(v.$))
  })()
  const bakeOk = keys.every((k) => attr(p.html, 'names', k) === null)
  const reverseOk = JSON.stringify(rt.doc.template.root.children[0].component) === JSON.stringify([
    { reference: 'héllo', value: 'H', target: 'props.キー' },
    { reference: 'bindings', value: 'bv', target: 'props.a' },
    { reference: 'children', value: 'cv', target: 'props.b' },
    { reference: 'pathKey', value: 'pv', target: 'props.c' },
    { reference: 'placement', value: 'plv', target: 'props.d' },
    { reference: 'unresolved', value: 'uv', target: 'props.e' },
    { reference: 'props', value: 'ppv', target: 'props.f' },
    { reference: 'empty' },
    { reference: 'numb', value: 'nv' },
  ]) && rt.anchorsEqual && rt.re?.warnings?.length === 0
  const ok = translateOk && derivedOk && bakeOk && reverseOk
  record('15', ok, d, [
    `MISMATCH core (compile/bake half): doc expected all seven synthesized keys self-resolve and bake (キー="H" … f="ppv"). Actual: the 'names' node carries a consumer anchor ('empty' — target:'' is silently treated as ABSENT, so the binding anchors as a plain consumer) → resolveArms path, publishOwn NEVER runs → bindings = {} → ALL seven synthesized reads evaluate null → NO key bakes on either adapter (ssr/dom both empty). Only the empty consumer unresolved-reference compile warning fires. Same bypass root cause as scenarios 1 and 14.`,
    `MISMATCH core (reverse half): doc expected "empty/numb emit {reference:'empty'} / {reference:'numb', value:'nv'}" — actual: {reference:'empty'} is DROPPED on reverse by the same rule as scenario 10 (applyPath-less non-provider next to a provider anchor; the node has 8 providers) → the reversed component is 8 bindings and re-translate is NOT anchor-identical (the plain consumer is permanently gone; warnings []). numb survives as {reference:'numb', value:'nv'}. This is the same doc-vs-code boundary as scenario 10 — R-2's letter vs the code's broadened drop.`,
    'Unicode/root-keyword names CONFIRMED harmless at translate: héllo/キー, bindings/children/pathKey/placement/unresolved/props references all synthesize (bindings.bindings etc. legal single-segment reads); zero translate warnings; target:"" and target:42 treated as absent (non-empty-string check) with NO warn. The seven targeted bindings reverse with target (unicode target included); N1 strips all seven synthesized keys.',
  ])
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const t0 = now()
function run(label, fn) {
  const s = now()
  fn()
  console.log(`[probe] translate scenario ${label} done in ${(now() - s).toFixed(0)}ms`)
}
run(1, runScenario1)
run(2, runScenario2)
run(3, runScenario3)
run(4, runScenario4)
run(5, runScenario5)
run(6, runScenario6)
run(7, runScenario7)
run(8, runScenario8)
run(9, runScenario9)
run(10, runScenario10)
run(11, runScenario11)
run(12, runScenario12)
run(13, runScenario13)
run(14, runScenario14)
run(15, runScenario15)

// ---------------------------------------------------------------------------
// RESULTS.md output
// ---------------------------------------------------------------------------
const lines = []
lines.push('# Translate-layer stress probes — RESULTS')
lines.push('')
lines.push(`Probe agent output (step b, translate-layer pass). Generated by \`scripts/translate-stress-probes/run-all.mjs\` on ${new Date().toISOString()}.`)
lines.push('Core-only: dist/core/* + legacy-JSON envelopes kept EXACTLY as authored in `archive/test-data/2026-08-15/2026-08-15-translate-stress-scenarios.md`; no src/ changes, no page-side logic, no fixtures. Classification (doc/spec bug | data-authoring bug | genuine engine defect) is the REVIEW agent\'s job — nothing here is fixed.')
lines.push('')
for (const r of results) {
  lines.push(`## Scenario ${r.scenario} — ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const l of r.details) lines.push(`- ${l}`)
  for (const n of r.notes) lines.push(`- NOTE: ${n}`)
  lines.push('')
}
lines.push('## Per-scenario verdict summary')
lines.push('')
for (const r of results) lines.push(`- Scenario ${r.scenario}: ${r.pass ? 'PASS' : 'MISMATCH'}`)
lines.push('')
lines.push('## Validation trio (run after probe work)')
lines.push('')
lines.push('- `npm test`: to be filled by the validation run')
lines.push('- `npm run typecheck`: to be filled')
lines.push('- `npm run demo:smoke`: to be filled (profile totals check per AGENTS.md item 4)')
lines.push('')

const out = lines.join('\n')
const { writeFileSync } = await import('node:fs')
writeFileSync(new URL('./RESULTS.md', import.meta.url), out)

console.log('=== TRANSLATE STRESS PROBE SUMMARY ===')
for (const r of results) {
  console.log(`Scenario ${r.scenario}: ${r.pass ? 'PASS' : 'MISMATCH'}`)
}
console.log(`Total probe run: ${(now() - t0).toFixed(0)}ms`)
