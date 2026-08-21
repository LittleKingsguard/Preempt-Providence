// Stress-test review loop — step (b) PROBE agent (2026-08-21).
// BLIND probe: from documentation only. Core-only: legacy-JSON -> translateLegacy
// -> compile -> emitElements -> diffMinimal -> applyOps, with handler dispatch.
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { createClient } from '../../dist/core/client.js'
import { EventBridge } from '../../dist/core/events.js'
import { DomAdapter, SSRFragmentAdapter, VOID_TAGS } from '../../dist/core/adapters.js'
import { emitElements, applyOps, treeSig, treeFromOps, renderProducingProcess, bakeValue } from '../../dist/core/render-helpers.js'
import { diffMinimal } from '../../dist/core/render.js'
import { dispatchEvent, dispatchPhase } from '../../dist/core/handlers.js'
import { serializeSlice, loadState } from '../../dist/core/serialize.js'

// ---------------------------------------------------------------------------
// Minimal DOM shim
// ---------------------------------------------------------------------------
class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}
    this.dataset = {}; this.style = {}; this.listeners = {}
    this.textContent = ''; this.className = ''; this.id = ''; this.value = ''; this.parent = null
  }
  appendChild(c) {
    if (c.parent) { const i = c.parent.children.indexOf(c); if (i !== -1) c.parent.children.splice(i, 1) }
    const i = this.children.indexOf(c); if (i !== -1) this.children.splice(i, 1)
    this.children.push(c); c.parent = this; return c
  }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = String(v) }
  getAttribute(k) { return this.attrs[k] ?? null }
  removeAttribute(k) { delete this.attrs[k]; if (k === 'id') this.id = '' }
  addEventListener(evt, fn) { (this.listeners[evt] ??= []).push(fn) }
  removeEventListener(evt, fn) {
    const arr = this.listeners[evt]; if (!arr) return
    const i = arr.indexOf(fn); if (i !== -1) arr.splice(i, 1)
    if (arr.length === 0) delete this.listeners[evt]
  }
  remove() {
    this.removed = true
    if (this.parent) { const i = this.parent.children.indexOf(this); if (i !== -1) this.parent.children.splice(i, 1); this.parent = null }
  }
}
function installDomShim() {
  if (typeof globalThis.document !== 'undefined') return
  const byId = new Map(); const styleEls = []
  globalThis.document = {
    createElement: (tag) => new El(tag),
    getElementById: (id) => { if (!byId.has(id)) byId.set(id, new El('div')); return byId.get(id) },
    head: { appendChild: (el) => { styleEls.push(el) }, __styleEls: styleEls },
  }
  globalThis.window = globalThis
}
installDomShim()

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------
const now = () => (globalThis.performance?.now ? performance.now() : Date.now())

function pipeline(doc) {
  const warnings = []; const origWarn = console.warn
  console.warn = (msg) => { warnings.push(typeof msg === 'string' ? msg : String(msg)) }
  const t = {}
  try {
    const t0 = now()
    const translated = translateLegacy(doc); t.translate = now() - t0
    const events = new EventBridge(); const supervisor = new Supervisor({ events })
    for (const n of translated.nodes) supervisor.registerNode(n)
    const clientAPI = createClient(supervisor)
    const t1 = now(); const cr = translated.root.compile(translated.nodes); t.compile = now() - t1
    const byNode = new Map()
    for (const s of cr.actionable) {
      if (!supervisor.getNode(s.nodeId)?.isInTree) continue
      const arr = byNode.get(s.nodeId) ?? []; arr.push(s); byNode.set(s.nodeId, arr)
    }
    supervisor.recordResolved(cr.actionable)
    const actionable = []; for (const states of byNode.values()) actionable.push(...states)
    const nodeById = new Map(supervisor.allNodes().map((n) => [n.id, n]))
    const t2 = now(); const els = emitElements(actionable, nodeById); t.emit = now() - t2
    const t3 = now(); const ops = diffMinimal(null, els); t.diff = now() - t3
    const adapter = new SSRFragmentAdapter()
    const t4 = now(); applyOps(adapter, ops); t.apply = now() - t4
    const html = adapter.toString()
    return { translated, supervisor, clientAPI, cr, actionable, els, ops, html, warnings, byNode, timing: t, ssrAdapter: adapter }
  } finally { console.warn = origWarn }
}

function domRender(ops) {
  const mount = document.createElement('mount'); const adapter = new DomAdapter(mount)
  applyOps(adapter, ops); return { mount, adapter }
}

function findNode(s, authoredId) {
  return s.allNodes().find((n) => n.props?.id === authoredId)
}
function stateOf(p, authoredId) {
  const n = findNode(p.supervisor, authoredId); return n ? p.byNode.get(n.id) ?? [] : []
}
function attr(html, elemId, attrName) {
  const m = new RegExp(`<[^>]+id="${elemId}"[^>]*>`).exec(html); if (!m) return null
  const am = new RegExp(`${attrName}="([^"]*)"`).exec(m[0]); return am ? am[1] : null
}
function countSubstr(haystack, needle) {
  let n = 0; let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) { n += 1; i += needle.length }; return n
}

// ---------------------------------------------------------------------------
// Scenario envelopes — mutation is an ARRAY (API requirement)
// ---------------------------------------------------------------------------
const SC1 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'a#b' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "hit-a" }' }] },
  { type: 'div', props: { id: 'a' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "hit-a-bare" }' }] },
] } } }

const SC2 = { template: {
  root: { type: 'app', component: { reference: 'p', value: 'v1' }, children: [
    { type: 'div', props: { id: 'consumer' }, component: { reference: 'p', target: 'props.x' }, handlers: [{ name: 'bump', event: 'bump', body: 'function(ctx){ ctx.clientAPI.apply(ctx.node.id, { kind: "state-slice", mutation: [{ targetProp: "props.id", mode: "replace", value: "edited" }] }) }' }] },
    { type: 'span', props: { id: 'sibling' } },
  ] },
  children: [ { type: 'def', id: 'p', content: 'P' } ],
} }

const SC3 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'boom' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ throw new Error("kaput") }' }] },
] } } }

const SC4 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'boom' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ throw new Error("kaput") }' }] },
  { type: 'div', props: { id: 'other' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "other-hit" }' }] },
] } } }

const SC5 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'outer' }, handlers: [{ name: 'click', event: 'click', body: 'async function(ctx){ await ctx.supervisor.flush(); return ctx.supervisor.dispatchEvent("inner", "click").length }' }] },
  { type: 'div', props: { id: 'inner' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ ctx.clientAPI.apply(ctx.node.id, { kind: "state-slice", mutation: [{ targetProp: "content", mode: "replace", value: "mutated" }] }); return "inner-hit" }' }] },
] } } }

const SC6 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'a' }, content: 'A' },
  { type: 'div', props: { id: 'b' }, content: 'B' },
] } } }

const SC7 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'prov' }, component: { reference: 'v', value: 'shared' }, children: [
    { type: 'div', props: { id: 'con-a' }, component: { reference: 'v' }, derived: { props: { 'data-resolved': { $: 'bindings.v' } } } },
    { type: 'div', props: { id: 'con-b' }, component: { reference: 'v' }, derived: { props: { 'data-resolved': { $: 'bindings.v' } } } },
  ] },
] } } }

const SC8 = { template: {
  root: { type: 'app', children: [
    { type: 'a', css: { classes: ['nav-link'] }, component: { reference: 'navdef', target: 'type' } },
  ] },
  children: [ { type: 'navdef', id: 'navdef', content: 'Admin', props: { href: '/content/1' } } ],
} }

const SC9 = { template: { root: { type: 'app', children: [
  { type: 'button', props: { id: 'btn' }, content: 'go', handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "first" }' }] },
] } } }

const SC11 = { template: { root: { type: 'app', css: { id: 'css-app' }, children: [
  { type: 'div', props: { id: 'preempt-node-node-1' } },
] } } }

const SC12 = { template: { root: { type: 'app', handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "never-runs" }' }] } } }
const SC12_BAD = { template: { root: { type: 'app', handlers: [{ name: 'click', event: 'click', body: 'function ctx{ broken' }] } } }

const SC13 = { template: {
  root: { type: 'app', css: { classes: ['host-a'] }, component: { reference: 'cls', value: ['inj-b', 'inj-c'], target: 'css.classes' } },
  children: [ { type: 'def', id: 'cls', content: 'C' } ],
} }

const SC14 = { template: {
  root: { type: 'app', children: [
    { type: 'a', css: { classes: ['nav-link'] }, component: { reference: 'navdef', target: 'type' } },
  ] },
  children: [ { type: 'navdef', id: 'navdef', content: 'Admin', props: { href: '/content/1' }, component: [{ reference: 'h', target: 'handlers.click' }] } ],
  component: [ { name: 'h', handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "nav-hit" }' }] } ],
} }

const SC15 = { template: {
  root: { type: 'app', component: { reference: 'd', target: 'content' }, content: { a: 1, b: [2, 3] } },
  children: [ { type: 'def', id: 'd', content: 'D' } ],
  derived: { props: { maybe: null } },
} }

const SC16 = { template: { root: { type: 'app', placement: { targetPlacement: ['zone'] }, children: [
  { type: 'div', placement: { placementName: 'zone' }, content: 'routed', handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "routed-hit" }' }] },
] } } }

const SC17 = { template: { root: { type: 'app', children: [
  { type: 'button', props: { id: 'btn' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "v1" }' }] },
] } } }

const SC18 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'a' }, content: 'A', handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "leaf-hit" }' }] },
  { type: 'div', props: { id: 'b' }, content: 'B' },
  { type: 'div', props: { id: 'c' }, content: 'C', handlers: [{ name: 'go', event: 'go', body: 'function(ctx){ return "c-go" }' }] },
] } } }

const CC1 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'x' }, content: 'X' },
  { type: 'div', props: { id: 'y' }, content: 'Y' },
] } } }

const CC2 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'h' }, handlers: [{ name: 'click', event: 'click', body: 'function(ctx){ return "ctrl-hit" }' }] },
] } } }

const CC3 = { template: { root: { type: 'app', children: [
  { type: 'div', props: { id: 'el' }, content: 'E' },
] } } }

// ---------------------------------------------------------------------------
// Scenario runners
// ---------------------------------------------------------------------------
const results = []
function record(scenario, pass, details, notes = []) { results.push({ scenario, pass, details, notes }) }

function runScenario1() {
  const p = pipeline(SC1); const d = []
  const nodeHash = findNode(p.supervisor, 'a#b')
  const nodeBare = findNode(p.supervisor, 'a')
  d.push(`nodeHash=${nodeHash?.id} nodeBare=${nodeBare?.id} distinct=${nodeHash !== nodeBare}`)
  const rHash = dispatchEvent(nodeHash, p.supervisor.handlerContext, 'click')
  d.push(`dispatch a#b: ${JSON.stringify(rHash)}`)
  const rBare = dispatchEvent(nodeBare, p.supervisor.handlerContext, 'click')
  d.push(`dispatch a: ${JSON.stringify(rBare)}`)
  const ok = nodeHash !== undefined && nodeBare !== undefined && nodeHash !== nodeBare &&
    JSON.stringify(rHash) === '["hit-a"]' && JSON.stringify(rBare) === '["hit-a-bare"]'
  record('1', ok, d)
}

async function runScenario2() {
  const p = pipeline(SC2); const d = []
  const divNode = findNode(p.supervisor, 'consumer')
  d.push(`consumer: ${divNode?.id}`)
  if (!divNode) { d.push('not found'); record('2', false, d); return }
  const report = await p.supervisor.dispatchAndReport(divNode.id, 'bump')
  d.push(`results: ${JSON.stringify(report.results)}`)
  d.push(`dirtied: ${report.dirtied.length} ids: ${JSON.stringify(report.dirtied)}`)
  const hasConsumer = report.dirtied.includes(divNode.id)
  d.push(`dirtied includes consumer: ${hasConsumer} size>=2: ${report.dirtied.length >= 2}`)
  d.push(`hasPendingWork: ${p.supervisor.hasPendingWork()}`)
  const ok = report.results.length > 0 && report.dirtied.length >= 2 && hasConsumer && !p.supervisor.hasPendingWork()
  record('2', ok, d)
}

async function runScenario3() {
  const p = pipeline(SC3); const d = []
  const boomNode = findNode(p.supervisor, 'boom')
  const r1a = await p.supervisor.dispatchAndReport(boomNode.id, 'click', { requestId: 'r1' })
  d.push(`r1a results=${JSON.stringify(r1a.results)} dirtied=${r1a.dirtied.length}`)
  const r1b = await p.supervisor.dispatchAndReport(boomNode.id, 'click', { requestId: 'r1' })
  d.push(`r1b echo=${JSON.stringify(r1b.results)}`)
  const echoMatch = JSON.stringify(r1a.results) === JSON.stringify(r1b.results)
  const hasError = r1a.results.some((r) => r instanceof Error)
  d.push(`echo: ${echoMatch} hasError: ${hasError}`)
  p.supervisor.clientAPI.apply(boomNode.id, { kind: 'destroy' })
  const r2a = await p.supervisor.dispatchAndReport(boomNode.id, 'click', { requestId: 'r2' })
  d.push(`r2a destroyed: results=${JSON.stringify(r2a.results)} dirtied=${r2a.dirtied.length}`)
  const r2b = await p.supervisor.dispatchAndReport(boomNode.id, 'click', { requestId: 'r2' })
  d.push(`r2b echo: ${JSON.stringify(r2b.results)}`)
  const ok = hasError && echoMatch && r2a.results.length === 0 && r2a.dirtied.length === 0 &&
    JSON.stringify(r2a.results) === JSON.stringify(r2b.results)
  record('3', ok, d)
}

async function runScenario4() {
  const p = pipeline(SC4); const d = []
  const boomNode = findNode(p.supervisor, 'boom')
  const otherNode = findNode(p.supervisor, 'other')
  const origWarn = console.warn; const warns = []
  console.warn = (msg) => { warns.push(typeof msg === 'string' ? msg : String(msg)) }
  try {
    const r1 = await p.supervisor.dispatchAndReport(boomNode.id, 'click', { requestId: 'x' })
    d.push(`boom: ${JSON.stringify(r1.results)}`)
    const r2 = await p.supervisor.dispatchAndReport(otherNode.id, 'click', { requestId: 'x' })
    d.push(`other: ${JSON.stringify(r2.results)}`)
    d.push(`warns: ${warns.length}`)
    const ok = r1.results.some((r) => r instanceof Error) && r2.results.includes('other-hit') && warns.length > 0
    record('4', ok, d)
  } finally { console.warn = origWarn }
}

async function runScenario5() {
  const p = pipeline(SC5); const d = []
  try {
    const outerNode = findNode(p.supervisor, 'outer')
    const report = await p.supervisor.dispatchAndReport(outerNode.id, 'click')
    d.push(`results: ${JSON.stringify(report.results)}`)
    d.push(`dirtied: ${report.dirtied.length}`)
    d.push(`hasPendingWork: ${p.supervisor.hasPendingWork()}`)
    const ok = report.dirtied.length > 0 && !p.supervisor.hasPendingWork()
    record('5', ok, d)
  } catch (e) { d.push(`ERROR: ${e?.message}`); record('5', false, d) }
}

function runScenario6() {
  const p = pipeline(SC6); const d = []
  const adapter = new SSRFragmentAdapter()
  const nodeById = new Map(p.supervisor.allNodes().map((n) => [n.id, n]))
  const r1 = renderProducingProcess(p.actionable, nodeById, adapter, null)
  d.push(`r1 ops=${r1.ops.length} creates=${r1.ops.filter(o => o.kind === 'create').length}`)
  const nodeA = findNode(p.supervisor, 'a')
  const nodeB = findNode(p.supervisor, 'b')
  p.supervisor.clientAPI.apply(nodeA.id, { kind: 'state-slice', mutation: [{ targetProp: 'content', mode: 'replace', value: 'A2' }] })
  p.supervisor.clientAPI.apply(nodeB.id, { kind: 'destroy' })
  const adapter2 = new SSRFragmentAdapter()
  const r2 = renderProducingProcess(p.actionable, nodeById, adapter2, r1.prevMap)
  d.push(`r2 ops=${r2.ops.length} sets=${r2.ops.filter(o => o.kind === 'set').length} removes=${r2.ops.filter(o => o.kind === 'remove').length}`)
  const adapter3 = new SSRFragmentAdapter()
  const r3 = renderProducingProcess(p.actionable, nodeById, adapter3, r2.prevMap)
  d.push(`r3 ops (no change)=${r3.ops.length}`)
  const ok = r1.ops.filter(o => o.kind === 'create').length >= 2 && r2.ops.filter(o => o.kind === 'remove').length >= 1 && r3.ops.length === 0
  record('6', ok, d)
}

function runScenario7() {
  const p = pipeline(SC7); const d = []
  const nodeById = new Map(p.supervisor.allNodes().map((n) => [n.id, n]))
  const elsOn = emitElements(p.actionable, nodeById, { nodeIdAttribute: true })
  const withNodeId = elsOn.filter((e) => e.props?.['data:node-id'])
  d.push(`ON: ${elsOn.length} els, ${withNodeId.length} with data:node-id`)
  d.push(`values: ${JSON.stringify(withNodeId.map(e => e.props['data:node-id']))}`)
  const elsOff = emitElements(p.actionable, nodeById)
  const offWith = elsOff.filter((e) => e.props?.['data:node-id'])
  d.push(`OFF: ${elsOff.length} els, ${offWith.length} with data:node-id`)
  const ok = withNodeId.length > 0 && offWith.length === 0
  record('7', ok, d)
}

function runScenario8() {
  const p = pipeline(SC8); const d = []
  const nodeById = new Map(p.supervisor.allNodes().map((n) => [n.id, n]))
  const elsOn = emitElements(p.actionable, nodeById, { nodeIdAttribute: true })
  d.push(`els: ${elsOn.length}`)
  for (const el of elsOn) d.push(`  type=${el.type} data:node-id=${el.props?.['data:node-id']} text=${el.props?.text}`)
  d.push(`html Admin: ${p.html.includes('Admin')} nav-link: ${p.html.includes('nav-link')}`)
  d.push(`warnings: ${JSON.stringify(p.cr.warnings)}`)
  const ok = p.html.includes('nav-link')
  record('8', ok, d)
}

async function runScenario9() {
  const p = pipeline(SC9); const d = []
  const btnNode = findNode(p.supervisor, 'btn')
  let r = dispatchEvent(btnNode, p.supervisor.handlerContext, 'click')
  d.push(`initial: ${JSON.stringify(r)}`)
  p.supervisor.clientAPI.apply(btnNode.id, { kind: 'state-slice', mutation: [{ targetProp: 'handlers', mode: 'replace', value: [] }] })
  r = dispatchEvent(btnNode, p.supervisor.handlerContext, 'click')
  d.push(`after clear: ${JSON.stringify(r)}`)
  p.supervisor.clientAPI.apply(btnNode.id, { kind: 'state-slice', mutation: [{ targetProp: 'content', mode: 'replace', value: 'go2' }] })
  r = dispatchEvent(btnNode, p.supervisor.handlerContext, 'click')
  d.push(`after content: ${JSON.stringify(r)}`)
  p.supervisor.clientAPI.apply(btnNode.id, { kind: 'state-slice', mutation: [{ targetProp: 'handlers', mode: 'replace', value: [{ name: 'click', event: 'click', body: 'function(ctx){ return "new" }' }] }] })
  r = dispatchEvent(btnNode, p.supervisor.handlerContext, 'click')
  d.push(`after new handlers: ${JSON.stringify(r)}`)
  const rev = reverseTranslate(p.translated.root)
  const revBtn = rev.template.root.children?.find((c) => c.props?.id === 'btn')
  d.push(`reversed handlers: ${JSON.stringify(revBtn?.handlers)}`)
  const ok = JSON.stringify(r) === '["new"]'
  record('9', ok, d)
}

function runScenario11() {
  const p = pipeline(SC11); const d = []
  d.push(`html css-app: ${p.html.includes('css-app')} preempt: ${p.html.includes('preempt-node-node-1')}`)
  const rev = reverseTranslate(p.translated.root)
  d.push(`rev root css.id: ${rev.template.root.css?.id} props.id: ${rev.template.root.props?.id}`)
  const child = rev.template.root.children?.[0]
  d.push(`rev child props.id: ${child?.props?.id}`)
  let w2 = []; const ow = console.warn; console.warn = (m) => { w2.push(typeof m === 'string' ? m : String(m)) }
  let rt = null; try { rt = translateLegacy(rev) } catch (e) { d.push(`re-translate error: ${e?.message}`) }
  console.warn = ow; d.push(`re-translate warnings: ${w2.length}`)
  const ok = rev.template.root.css?.id === 'css-app' && !rev.template.root.props?.id &&
    child?.props?.id === 'preempt-node-node-1' && rt !== null
  record('11', ok, d)
}

function runScenario12() {
  const d = []
  const p1 = pipeline(SC12)
  const app1 = p1.supervisor.allNodes().find((n) => n.type === 'app')
  const r1 = dispatchEvent(app1, p1.supervisor.handlerContext, 'click')
  d.push(`normal: ${JSON.stringify(r1)}`)
  const origFn = globalThis.Function
  globalThis.Function = function() { throw new EvalError('Refused to evaluate a string as JavaScript') }
  let p2 = null
  try { p2 = pipeline(SC12) } catch (e) { d.push(`eval-blocked ERROR: ${e?.message}`) }
  globalThis.Function = origFn
  if (p2) {
    d.push(`eval-blocked warnings: ${p2.warnings.map(w => w.includes('handler-body-eval-blocked') ? 'EVAL-BLOCKED' : w.includes('handler-body-invalid') ? 'INVALID' : w).join(', ')}`)
    const app2 = p2.supervisor.allNodes().find((n) => n.type === 'app')
    const r2 = dispatchEvent(app2, p2.supervisor.handlerContext, 'click')
    d.push(`eval-blocked dispatch: ${JSON.stringify(r2)}`)
  }
  const p3 = pipeline(SC12)
  const app3 = p3.supervisor.allNodes().find((n) => n.type === 'app')
  const r3 = dispatchEvent(app3, p3.supervisor.handlerContext, 'click')
  d.push(`restored: ${JSON.stringify(r3)} warns: ${p3.warnings.length}`)
  const p4 = pipeline(SC12_BAD)
  d.push(`bad-syntax: ${p4.warnings.map(w => w.includes('handler-body-invalid') ? 'INVALID' : w).join(', ')}`)
  const ok = r1.includes('never-runs') && p2?.warnings?.some((w) => w.includes('handler-body-eval-blocked')) &&
    r3.includes('never-runs') && p4.warnings.some((w) => w.includes('handler-body-invalid'))
  record('12', ok, d)
}

function runScenario13() {
  const p = pipeline(SC13); const d = []
  d.push(`html host-a: ${p.html.includes('host-a')} inj-b: ${p.html.includes('inj-b')} inj-c: ${p.html.includes('inj-c')}`)
  const rev = reverseTranslate(p.translated.root)
  d.push(`rev css.classes: ${JSON.stringify(rev.template.root.css?.classes)} component: ${rev.template.root.component != null}`)
  let w2 = []; const ow = console.warn; console.warn = (m) => { w2.push(typeof m === 'string' ? m : String(m)) }
  let rt = null; try { rt = translateLegacy(rev) } catch (e) { d.push(`re-translate error: ${e?.message}`) }
  console.warn = ow; d.push(`re-translate warnings: ${w2.length}`)
  const ok = p.html.includes('host-a') && p.html.includes('inj-b') && p.html.includes('inj-c') && rt !== null
  record('13', ok, d)
}

function runScenario14() {
  const p = pipeline(SC14); const d = []
  d.push(`html Admin: ${p.html.includes('Admin')} nav-link: ${p.html.includes('nav-link')} href: ${p.html.includes('/content/1')}`)
  const consumer = p.supervisor.allNodes().find((n) => n.type === 'a' && n.isInTree)
  d.push(`consumer: type=${consumer?.type} id=${consumer?.id}`)
  if (consumer) {
    const r = dispatchEvent(consumer, p.supervisor.handlerContext, 'click')
    d.push(`dispatch: ${JSON.stringify(r)}`)
  }
  d.push(`warnings: ${JSON.stringify(p.cr.warnings)}`)
  const ok = p.html.includes('nav-link')
  record('14', ok, d)
}

function runScenario15() {
  const p = pipeline(SC15); const d = []
  d.push(`html: ${p.html.slice(0, 300)}`)
  d.push(`has [object Object]: ${p.html.includes('[object Object]')}`)
  d.push(`has JSON: ${p.html.includes('{"a":1') || p.html.includes('{&quot;a&quot;:1')}`)
  d.push(`warnings: ${JSON.stringify(p.cr.warnings)}`)
  const ok = !p.html.includes('[object Object]')
  record('15', ok, d)
}

function runScenario16() {
  const p = pipeline(SC16); const d = []
  d.push(`html routed: ${p.html.includes('routed')}`)
  const routed = p.supervisor.allNodes().find((n) => n.base?.content === 'routed')
  d.push(`routed node: type=${routed?.type} id=${routed?.id}`)
  if (routed) {
    const r = p.supervisor.dispatchEvent(routed.id, 'click')
    d.push(`dispatch: ${JSON.stringify(r)}`)
  }
  d.push(`warnings: ${JSON.stringify(p.cr.warnings)}`)
  const ok = p.html.includes('routed')
  record('16', ok, d)
}

function runScenario17() {
  const p = pipeline(SC17); const d = []
  const btnNode = findNode(p.supervisor, 'btn')
  let r = dispatchEvent(btnNode, p.supervisor.handlerContext, 'click')
  d.push(`v1: ${JSON.stringify(r)}`)
  p.supervisor.clientAPI.apply(btnNode.id, { kind: 'state-slice', mutation: [{ targetProp: 'handlers', mode: 'replace', value: [{ name: 'click', event: 'click', body: 'function(ctx){ return "v2" }' }] }] })
  r = dispatchEvent(btnNode, p.supervisor.handlerContext, 'click')
  d.push(`v2: ${JSON.stringify(r)}`)
  p.supervisor.clientAPI.apply(btnNode.id, { kind: 'state-slice', mutation: [{ targetProp: 'handlers', mode: 'replace', value: [] }] })
  r = dispatchEvent(btnNode, p.supervisor.handlerContext, 'click')
  d.push(`cleared: ${JSON.stringify(r)}`)
  const ok = JSON.stringify(r) === '[]'
  record('17', ok, d)
}

function runScenario18() {
  const p = pipeline(SC18); const d = []
  const adapter = new SSRFragmentAdapter()
  const nodeById = new Map(p.supervisor.allNodes().map((n) => [n.id, n]))
  const r1 = renderProducingProcess(p.actionable, nodeById, adapter, null)
  d.push(`r1 ops=${r1.ops.length} els=${r1.els.length}`)
  const aNode = findNode(p.supervisor, 'a')
  const r = dispatchEvent(aNode, p.supervisor.handlerContext, 'click')
  d.push(`dispatch a: ${JSON.stringify(r)}`)
  const ok = r1.ops.length > 0 && r.includes('leaf-hit')
  record('18', ok, d)
}

function runControl1() {
  const p = pipeline(CC1); const d = []
  const adapter1 = new SSRFragmentAdapter()
  const nodeById = new Map(p.supervisor.allNodes().map((n) => [n.id, n]))
  const r1 = renderProducingProcess(p.actionable, nodeById, adapter1, null)
  d.push(`r1 ops: ${r1.ops.length}`)
  const adapter2 = new SSRFragmentAdapter()
  const r2 = renderProducingProcess(p.actionable, nodeById, adapter2, r1.prevMap)
  d.push(`r2 ops: ${r2.ops.length}`)
  const ok = r2.ops.length === 0
  record('C1', ok, d)
}

function runControl2() {
  const p = pipeline(CC2); const d = []
  const node = findNode(p.supervisor, 'h')
  const r = dispatchEvent(node, p.supervisor.handlerContext, 'click')
  d.push(`dispatch: ${JSON.stringify(r)}`)
  const ok = JSON.stringify(r) === '["ctrl-hit"]'
  record('C2', ok, d)
}

function runControl3() {
  const p = pipeline(CC3); const d = []
  const nodeById = new Map(p.supervisor.allNodes().map((n) => [n.id, n]))
  const elsOn = emitElements(p.actionable, nodeById, { nodeIdAttribute: true })
  d.push(`ON: ${elsOn.filter(e => e.props?.['data:node-id']).length}/${elsOn.length}`)
  const elsOff = emitElements(p.actionable, nodeById)
  d.push(`OFF: ${elsOff.filter(e => e.props?.['data:node-id']).length}/${elsOff.length}`)
  const rev = reverseTranslate(p.translated.root)
  d.push(`reverse has attr: ${JSON.stringify(rev).includes('nodeIdAttribute')}`)
  const ok = elsOn.some((e) => e.props?.['data:node-id']) && !elsOff.some((e) => e.props?.['data:node-id']) && !JSON.stringify(rev).includes('nodeIdAttribute')
  record('C3', ok, d)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const t0 = now()
async function run(label, fn) {
  const s = now(); const before = process.memoryUsage().heapUsed
  try { const result = fn(); if (result?.then) await result } catch (e) { console.log(`[probe] ${label} THREW: ${e?.message}`) }
  const after = process.memoryUsage().heapUsed
  console.log(`[probe] ${label} done in ${(now() - s).toFixed(0)}ms (heap +${((after - before) / 1048576).toFixed(1)}MB)`)
}

async function main() {
  await run('S1-dispatch-hash-id', runScenario1)
  await run('S2-dispatchAndReport-cascade', runScenario2)
  await run('S3-requestId-dedup', runScenario3)
  await run('S4-requestId-reuse', runScenario4)
  await run('S5-nested-flush-dispatch', runScenario5)
  await run('S6-renderProducingProcess', runScenario6)
  await run('S7-data-node-id-fork', runScenario7)
  await run('S8-data-node-id-SED1', runScenario8)
  await run('S9-handlers-clear', runScenario9)
  await run('S11-reverse-roundtrip', runScenario11)
  await run('S12-eval-blocked', runScenario12)
  await run('S13-css-classes-seam', runScenario13)
  await run('S14-SED1-handler-prop', runScenario14)
  await run('S15-OTGE-object', runScenario15)
  await run('S16-placement-unplaced', runScenario16)
  await run('S17-retained-handler-map', runScenario17)
  await run('S18-report-surface', runScenario18)
  await run('C1-idempotent-render', runControl1)
  await run('C2-dispatch-match', runControl2)
  await run('C3-data-node-id-reverse', runControl3)

  console.log('\n=== 2026-08-21 STRESS PROBE SUMMARY ===')
  for (const r of results) {
    console.log(`Scenario ${r.scenario}: ${r.pass ? 'PASS' : 'MISMATCH'}`)
    for (const l of r.details) console.log(`  ${l}`)
  }
  console.log(`\nTotal: ${(now() - t0).toFixed(0)}ms — Pass: ${results.filter(r => r.pass).length}/${results.length}`)

  const lines = ['# Stress-test probes 2026-08-21 — RESULTS', '', `Generated ${new Date().toISOString()}.`, '']
  for (const r of results) {
    lines.push(`## Scenario ${r.scenario} — ${r.pass ? 'PASS' : 'MISMATCH'}`)
    for (const l of r.details) lines.push(`- ${l}`)
    for (const n of r.notes) lines.push(`- NOTE: ${n}`)
    lines.push('')
  }
  const { writeFileSync } = await import('node:fs')
  writeFileSync(new URL('./RESULTS-2026-08-21.md', import.meta.url), lines.join('\n'))
  console.log('\nResults written to scripts/stress-probes/RESULTS-2026-08-21.md')
}

main().catch((e) => { console.error('FATAL:', e); process.exit(1) })
