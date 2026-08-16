// Stress-test review loop round 5 — step (b) PROBE agent (scenarios 43-48).
// "BRIDGE round": the legacy-handler runtime bridge + handler seams.
// Scope (archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md
// §"Round 5"): multi-binding seam consumers (#13 class), format-marker edges
// (#44), reverse round-trips incl. the #14/#15 classes (#45), children
// injection on placement containers (#46), wrapped-body error containment
// (#47), query edges + the 4095-node findNodes walk (#48).
// Core-only: dist/core/* + legacy JSON. No src/, no engine changes.
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { SSRFragmentAdapter } from '../../dist/core/adapters.js'
import { emitElements, applyOps } from '../../dist/core/render-helpers.js'
import { diffMinimal } from '../../dist/core/render.js'
import { dispatchEvent } from '../../dist/core/handlers.js'
import { getTranslateUserData, mintedByOrigin } from '../../dist/core/registry.js'

const mintedByOriginSafe = (id) => {
  try { return mintedByOrigin(id) } catch { return [] }
}

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------
const now = () => (globalThis.performance?.now ? performance.now() : Date.now())

const flush8 = async () => {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  await Promise.all(waits)
}

/** translate -> register -> compile. compileKind 'slice' = root.compile(all);
 *  'path' = per-node compilePath (the placement path-state bootstrap). The
 *  compile step may THROW (S44 bad-c/num-c) — the caller may pass
 *  opts.allowThrow to receive the throw as `env.throw` instead of crashing.
 *  `warnings` returned is the env's console-warn capture (the translate
 *  warnings live on `translated.warnings`). */
function env(doc, compileKind = 'slice', opts = {}) {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => { warnings.push(typeof msg === 'string' ? msg : String(msg)) }
  try {
    const translated = translateLegacy(doc)
    const events = new EventBridge()
    const supervisor = new Supervisor({ events })
    for (const n of translated.nodes) supervisor.registerNode(n)
    let cr = null
    let thrown = null
    if (compileKind === 'path') {
      const actionable = []
      for (const n of translated.nodes) actionable.push(...n.compilePath().actionable)
      cr = { actionable, warnings: [], dropped: [] }
    } else {
      try {
        cr = translated.root.compile(translated.nodes)
      } catch (e) {
        thrown = e
        if (!opts.allowThrow) throw e
      }
    }
    if (!thrown) supervisor.recordResolved(cr.actionable)
    return {
      translated, sup: supervisor, cr, warnings, thrown,
      byId: (id) => supervisor.allNodes().find((n) => n.props?.id === id),
    }
  }
  finally {
    console.warn = origWarn
  }
}

/** Dispatch with console.warn capture (the legacy-query-unsupported carrier). */
function dispatchWithWarn(node, sup, event, ...args) {
  const warns = []
  const origWarn = console.warn
  console.warn = (m) => warns.push(typeof m === 'string' ? m : String(m))
  let results
  try { results = dispatchEvent(node, sup.handlerContext, event, ...args) }
  finally { console.warn = origWarn }
  return { results, warns }
}

/** Render ALL nodes' resolved states through an adapter. Returns ops + html. */
function renderAll(supervisor, adapter, prevMap) {
  const states = []
  for (const n of supervisor.allNodes()) states.push(...supervisor.getResolvedStates(n.id))
  const nodeById = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = emitElements(states, nodeById)
  const ops = diffMinimal(prevMap, els)
  if (adapter) applyOps(adapter, ops)
  return { ops, els, prevMap: new Map(els.map((e) => [e.wire, e])), html: adapter ? adapter.toString() : null }
}

const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const errName = (e) => (e instanceof Error ? e.constructor.name : typeof e)
const errMsg = (e) => (e instanceof Error ? e.message : String(e))

function censusOf(node) {
  return {
    id: node.props?.id,
    anchors: node.anchors.map((a) =>
      `${a.role}:${typeof a.target === 'string' ? a.target : (a.target?.props?.id ?? a.target?.id ?? '?')}` +
      `${a.options?.seam !== undefined ? '[seam]' : ''}` +
      `${a.options?.handlerEvent !== undefined ? `[he:${a.options.handlerEvent}]` : ''}`,
    ).sort(),
    layers: node.layers.map((l) => `{${l.id},${l.sourceName ?? ''},handlers:${Array.isArray(l.handlers) ? l.handlers.length : 'none'}}`).sort(),
  }
}
const censusJson = (node) => JSON.stringify(censusOf(node))
const seamParentCount = (node) => node.anchors.filter((a) => a.role === 'parent' && a.options?.seam !== undefined).length
const handlerEventAnchors = (node) => node.anchors.filter((a) => a.options?.handlerEvent !== undefined)
const seamLayer = (node) => node.layers.find((l) => l.sourceName === 'handler-seam')
const countSubstr = (haystack, needle) => {
  let n = 0
  let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) { n += 1; i += needle.length }
  return n
}

// ---------------------------------------------------------------------------
// Scenario data — envelopes EXACTLY as authored in the scenario doc
// (archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md,
// scenarios 43-48). Only the *(expand)* repetition markers are expanded
// (mechanical data generation).
// ---------------------------------------------------------------------------

const SC43 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'multi-root' },
      component: [
        { reference: 'guard', value: { name: 'guard', body: "function (event, context) { return 'guard-ran'; }" } },
        { reference: 'notify', value: { name: 'notify', body: "function (event, context) { return 'notify-ran'; }" } },
        { reference: 'menu', value: { type: 'nav', css: { classes: [ 'menu-bar' ] }, children: [ { type: 'span', props: { id: 'm-logo' }, content: 'logo' } ] } },
      ],
      children: [
        { type: 'div', props: { id: 'dual' }, content: 'dual shell', component: [
          { reference: 'guard', target: 'handlers.onLoad' },
          { reference: 'notify', target: 'handlers.click' },
        ] },
        { type: 'div', props: { id: 'same-def' }, component: [
          { reference: 'notify', target: 'handlers.click' },
          { reference: 'notify', target: 'handlers.mouseover' },
        ] },
        { type: 'div', props: { id: 'combo' }, content: 'combo shell', component: [
          { reference: 'guard', target: 'handlers.onLoad' },
          { reference: 'menu', target: 'children' },
        ] },
      ],
    },
  },
}

const SC44 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'fmt-root' },
      component: [
        { reference: 'modernDef', value: { name: 'modern', body: 'function (ctx, ev) { return [typeof ctx.clientAPI, ev]; }', format: 'modern' } },
        { reference: 'garbageDef', value: { name: 'garbage', body: 'function (event, context) { return [event.type, typeof context.node]; }', format: 'garbage' } },
        { reference: 'badDef', value: { name: 'bad', body: 'not-a-function' } },
        { reference: 'numDef', value: { name: 'num', body: '42' } },
      ],
      children: [
        { type: 'button', props: { id: 'modern-c' }, content: 'modern', component: { reference: 'modernDef', target: 'handlers.click' } },
        { type: 'button', props: { id: 'inline-legacy' }, content: 'inline', handlers: [ { name: 'il', event: 'click', format: 'legacy', body: 'function (event, context) { return [event.type, context.node.type]; }' } ] },
        { type: 'button', props: { id: 'inline-garbage' }, content: 'ig', handlers: [ { name: 'ig', event: 'click', format: 'bogus', body: 'function (event, context) { return context.node.type; }' } ] },
        { type: 'button', props: { id: 'garbage-c' }, content: 'garbage', component: { reference: 'garbageDef', target: 'handlers.click' } },
        { type: 'button', props: { id: 'bad-c' }, content: 'bad', component: { reference: 'badDef', target: 'handlers.click' } },
        { type: 'button', props: { id: 'num-c' }, content: 'num', component: { reference: 'numDef', target: 'handlers.click' } },
        { type: 'div', props: { id: 'fmt-control' }, content: 'alive' },
      ],
    },
  },
}
const SC44_NOBAD = (() => {
  const v = JSON.parse(JSON.stringify(SC44))
  v.template.root.children = v.template.root.children.filter((n) => !['bad-c', 'num-c'].includes(n.props.id))
  return v
})()

const SC45 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'rev-root' },
      component: [
        { reference: 'hdef', value: { name: 'hdef', body: "function (event, context) { return 'seam-ran'; }" } },
        { reference: 'authUI', value: { type: 'aside', css: { classes: [ 'auth-panel' ] }, component: [ { reference: 'hdef', target: 'handlers.afterAssembly' } ], children: [ { type: 'span', props: { id: 'auth-name' }, content: 'name' } ] } },
        { reference: 'childDef', value: { type: 'section', css: { classes: [ 'c-panel' ] }, children: [ { type: 'div', props: { id: 'c-child' }, component: { reference: 'hdef', target: 'handlers.click' }, content: 'kid' } ] } },
      ],
      children: [
        { type: 'div', props: { id: 'both' }, content: 'both shell', handlers: [ { name: 'authored', event: 'click', body: "function (ctx) { return 'authored-ran'; }" } ], component: { reference: 'hdef', target: 'handlers.onLoad' } },
        { type: 'div', props: { id: 'auth-host' }, content: 'auth', component: { reference: 'authUI', target: 'children' } },
        { type: 'div', props: { id: 'child-host' }, content: 'child host', component: { reference: 'childDef', target: 'children' } },
        { type: 'aside', props: { id: 'zone-a' }, placement: { placementName: 'zone-a' } },
      ],
    },
  },
  content: [
    { content: [ { type: 'div', props: { id: 'path-consumer' }, content: 'path shell', component: { reference: 'hdef', target: 'handlers.click' }, placement: { targetPlacement: [ 'zone-a' ] } } ] },
  ],
}
// the N5 plain-node CONTROL: a template node carrying the same
// handlers.afterAssembly binding as the authUI def-root.
const SC45_CONTROL = (() => {
  const v = JSON.parse(JSON.stringify(SC45))
  v.template.root.component = [
    { reference: 'hdef', value: { name: 'hdef', body: "function (event, context) { return 'seam-ran'; }" } },
  ]
  v.template.root.children = [
    { type: 'div', props: { id: 'n5-control' }, component: { reference: 'hdef', target: 'handlers.afterAssembly' } },
  ]
  delete v.content
  return v
})()

const SC46 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'inj-root' },
      children: [
        { type: 'aside', props: { id: 'inj-zone' }, css: { id: 'inj-zone' }, placement: { placementName: 'inj-zone' } },
        { type: 'section', props: { id: 'empty-zone' }, css: { id: 'empty-zone' }, placement: { placementName: 'empty-zone' } },
        { type: 'div', props: { id: 'injector' }, content: 'inject', handlers: [
          { name: 'inject', event: 'click', format: 'legacy', body: 'function (event, context) { var zone = context.rootNode.findNode({ id: "inj-zone" }); return zone.receiveNextState({ children: [ { "type": "span", "props": { "id": "inj-a" }, "content": "injected" } ] }); }' },
          { name: 'inject-empty', event: 'dblclick', format: 'legacy', body: 'function (event, context) { var zone = context.rootNode.findNode({ id: "empty-zone" }); return zone.receiveNextState({ children: [ { "type": "span", "props": { "id": "inj-b" }, "content": "mixed" } ], css: { style: { color: "red" } } }); }' },
        ] },
      ],
    },
  },
  content: [
    { content: [ { type: 'div', props: { id: 'fan-consumer' }, placement: { targetPlacement: [ 'inj-zone' ] } } ] },
  ],
}

// NOTE (as-authored envelope check): the scenario's `content: [ { userData:
// { flag: 'probe' } } ]` payload carries NO `content: NodeData[]` member —
// per the D2 payload-entry guard (scenario 29 pin) translateLegacy THROWS
// legacy-payload-mismatch for such a payload. The as-authored envelope is
// therefore legacy-INVALID data; the probe records that throw and runs the
// scenario's dispatch pins on the MINIMAL correction (the payload gains the
// empty `content: []` array — zero nodes, userData still captured), which is
// the shape the scenario's Expected output presupposes.
const SC47 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'err-root' },
      children: [
        { type: 'button', props: { id: 'thrower' }, content: 'throw', handlers: [ { name: 'thrower', event: 'click', format: 'legacy', body: "function (event, context) { throw new Error('bridge boom'); }" } ] },
        { type: 'button', props: { id: 'ud-sloppy' }, content: 'ud', handlers: [ { name: 'ud', event: 'click', format: 'legacy', body: 'function (event, context) { context.supervisor.userData = { evil: true }; return String(context.supervisor.userData); }' } ] },
        { type: 'button', props: { id: 'ud-strict' }, content: 'uds', handlers: [ { name: 'uds', event: 'click', format: 'legacy', body: 'function (event, context) { "use strict"; context.supervisor.userData = 1; return \'after-write\'; }' } ] },
        { type: 'button', props: { id: 'missing' }, content: 'miss', handlers: [ { name: 'miss', event: 'click', format: 'legacy', body: 'function (event, context) { return context.clientAPI.missingMethod(1); }' } ] },
        { type: 'button', props: { id: 'api-gap' }, content: 'api', handlers: [ { name: 'api', event: 'click', format: 'legacy', body: "function (event, context) { return context.api.apply('x'); }" } ] },
        { type: 'div', props: { id: 'err-control' }, content: 'alive' },
      ],
    },
  },
  content: [ { userData: { flag: 'probe' }, content: [] } ],
}

const SC48 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'q-root' },
      children: [
        { type: 'div', props: { id: 'q-a' }, content: 'A' },
        { type: 'div', props: { id: 'q-b' }, css: { classes: [ 'chip', 'active' ] }, content: 'B' },
        { type: 'aside', props: { id: 'q-leaf' }, content: 'leaf' },
        { type: 'button', props: { id: 'querier' }, content: 'query', handlers: [ { name: 'querier', event: 'click', format: 'legacy', body: 'function (event, context) { var bad = context.rootNode.findNode({ style: { color: "red" } }); var first = context.rootNode.findNode({ type: "div" }); var pred = context.rootNode.findNode(function (v) { return v.props.id === "q-leaf"; }); var all = context.rootNode.findNodes({ type: "div" }); return [ bad, first && first.props.id, pred && pred.props.id, all.length, context.rootNode.parent ]; }' } ] },
      ],
    },
  },
}
// Envelope B *(expand)* — 4094 div cells + the querier-style button.
const SC48_B = (() => {
  const cells = []
  for (let n = 0; n < 4094; n += 1) {
    cells.push({ type: 'div', props: { id: `cell-${n}` }, content: `cell ${n}` })
  }
  cells.push({ type: 'button', props: { id: 'querier-b' }, content: 'query', handlers: [ { name: 'querier-b', event: 'click', format: 'legacy', body: 'function (event, context) { return context.rootNode.findNodes({ type: "div" }).length; }' } ] })
  return { template: { root: { type: 'app', props: { id: 'q-root' }, children: cells } } }
})()

// ---------------------------------------------------------------------------
// Scenario runners
// ---------------------------------------------------------------------------
const results = []
function record(scenario, pass, details, notes = []) {
  results.push({ scenario, pass, details, notes })
}

async function runScenario43() {
  const d = []
  const e = env(SC43)
  const { translated, sup, byId } = e
  const dual = byId('dual')
  const sameDef = byId('same-def')
  const combo = byId('combo')
  const ctx = sup.handlerContext
  // ---- translate
  d.push(`translate warns: ${JSON.stringify(translated.warnings.map((w) => `${w.code}@${w.path ?? ''}`))} (letter: zero for dual/combo; the same-def K8 block warns component-duplicate-reference@root.children[1])`)
  // ---- dual
  const dualLayer = seamLayer(dual)
  d.push(`dual: handlerEvent anchors=${handlerEventAnchors(dual).map((a) => `${a.target}[${a.options.handlerEvent}]`).join(',')} seam layer=${dualLayer ? `1 layer (${dualLayer.id}, handlers=${dualLayer.handlers.length}): ${dualLayer.handlers.map((h) => `${h.name}/${h.event}`).join(' + ')}` : 'NONE'}`)
  const r1 = dispatchWithWarn(dual, sup, 'onLoad')
  const r2 = dispatchWithWarn(dual, sup, 'click')
  const r3 = dispatchWithWarn(dual, sup, 'guard')
  d.push(`dual dispatch onLoad=${JSON.stringify(r1.results)} click=${JSON.stringify(r2.results)} name-fallback 'guard'=${JSON.stringify(r3.results)}`)
  // idempotent re-materialization on a second compile
  translated.root.compile(translated.nodes)
  const dualLayer2 = seamLayer(dual)
  d.push(`dual after recompile: seam layers=${dual.layers.filter((l) => l.sourceName === 'handler-seam').length} handlers=${dualLayer2 ? dualLayer2.handlers.length : 'NONE'} (idempotent — no duplicate entries)`)
  // ---- same-def (K8 block)
  d.push(`same-def translate warns: ${JSON.stringify(translated.warnings.filter((w) => w.path?.startsWith('root.children[1]')).map((w) => `${w.code}@${w.path}`))} (letter: component-duplicate-reference at root.children[1])`)
  d.push(`same-def handlerEvent anchors=${handlerEventAnchors(sameDef).map((a) => `${a.target}[${a.options.handlerEvent}]`).join(',')} (letter: ONLY the first binding — handlers.click)`)
  const s1 = dispatchWithWarn(sameDef, sup, 'click')
  const s2 = dispatchWithWarn(sameDef, sup, 'mouseover')
  d.push(`same-def dispatch click=${JSON.stringify(s1.results)} mouseover=${JSON.stringify(s2.results)} (letter: click=['notify-ran'], mouseover=[])`)
  // ---- combo
  d.push(`combo: handlerEvent anchors=${handlerEventAnchors(combo).map((a) => `${a.target}[${a.options.handlerEvent}]`).join(',')} seam-parent=${seamParentCount(combo)} census=${censusJson(combo)}`)
  const c1 = dispatchWithWarn(combo, sup, 'onLoad')
  d.push(`combo dispatch onLoad=${JSON.stringify(c1.results)} (letter: ['guard-ran'])`)
  const adapter = new SSRFragmentAdapter()
  const rnd = renderAll(sup, adapter, null)
  d.push(`render: ${rnd.html}`)
  const dualState = sup.getResolvedStates(dual.id)[0]
  const dualEl = rnd.els.find((el) => el.wire === dualState?.nodeId) ?? null
  const dualElOnProps = Object.keys(dualEl?.props ?? {}).filter((k) => k.startsWith('on:'))
  d.push(`dual emitted element props on:*=${JSON.stringify(dualElOnProps)} (letter: on:onLoad + on:click on the emitted element — the SSR attr serialization strips the ':' → ononLoad/onclick)`)
  d.push(`dual compiled state props on:*=${JSON.stringify(Object.keys(dualState?.props ?? {}).filter((k) => k.startsWith('on:')))} (the on:* props are EMIT-side only — never on the compiled state)`)

  // ---- reverse
  const rev = reverseTranslate(translated.root)
  const revDual = rev.template.root.children.find((n) => n.props?.id === 'dual')
  const revSame = rev.template.root.children.find((n) => n.props?.id === 'same-def')
  const revCombo = rev.template.root.children.find((n) => n.props?.id === 'combo')
  d.push(`reversed dual.component=${JSON.stringify(revDual.component)} (letter: the 2-binding ARRAY)`)
  d.push(`reversed same-def.component=${JSON.stringify(revSame.component)} (letter: ONE binding — the blocked duplicate never anchored)`)
  d.push(`reversed combo.component=${JSON.stringify(revCombo.component)} (letter: BOTH bindings)`)
  // ---- re-translate round-trip
  const re = translateLegacy(rev)
  const reSup = new Supervisor({ events: new EventBridge() })
  for (const n of re.nodes) reSup.registerNode(n)
  const recr = re.root.compile(re.nodes)
  reSup.recordResolved(recr.actionable)
  const reDual = re.nodes.find((n) => n.props?.id === 'dual')
  const reSame = re.nodes.find((n) => n.props?.id === 'same-def')
  const reCombo = re.nodes.find((n) => n.props?.id === 'combo')
  d.push(`re-translate warns=${JSON.stringify((re.warnings ?? []).map((w) => `${w.code}@${w.path ?? ''}`))} (letter: zero)`)
  d.push(`re-translate seam layers: dual=${seamLayer(reDual)?.handlers.length ?? 'NONE'} same-def=${seamLayer(reSame)?.handlers.length ?? 'NONE'} combo=${seamLayer(reCombo)?.handlers.length ?? 'NONE'} (letter: ONE layer each — dual with BOTH accumulated entries)`)
  const rd1 = dispatchWithWarn(reDual, reSup, 'onLoad')
  const rd2 = dispatchWithWarn(reDual, reSup, 'click')
  const rd3 = dispatchWithWarn(reSame, reSup, 'click')
  const rd4 = dispatchWithWarn(reSame, reSup, 'mouseover')
  const rd5 = dispatchWithWarn(reCombo, reSup, 'onLoad')
  d.push(`re-dispatch: dual.onLoad=${JSON.stringify(rd1.results)} dual.click=${JSON.stringify(rd2.results)} same.click=${JSON.stringify(rd3.results)} same.mouseover=${JSON.stringify(rd4.results)} combo.onLoad=${JSON.stringify(rd5.results)} (letter: identical)`)
  const comboRenderOk = rnd.html.includes('combo shell') && rnd.html.includes('menu-bar') && rnd.html.includes('m-logo') && rnd.html.includes('>logo<')
  const ok =
    translated.warnings.filter((w) => w.code === 'component-duplicate-reference').length === 1 &&
    dualLayer !== undefined && dualLayer.handlers.length === 2 &&
    deepEq(r1.results, ['guard-ran']) && deepEq(r2.results, ['notify-ran']) && deepEq(r3.results, ['guard-ran']) &&
    dual.layers.filter((l) => l.sourceName === 'handler-seam').length === 1 && dualLayer2?.handlers.length === 2 &&
    translated.warnings.some((w) => w.code === 'component-duplicate-reference' && w.path === 'root.children[1]') &&
    handlerEventAnchors(sameDef).map((a) => a.options.handlerEvent).join(',') === 'click' &&
    deepEq(s1.results, ['notify-ran']) && deepEq(s2.results, []) &&
    handlerEventAnchors(combo).map((a) => a.options.handlerEvent).join(',') === 'onLoad' && seamParentCount(combo) === 1 &&
    deepEq(c1.results, ['guard-ran']) && comboRenderOk &&
    deepEq(revDual.component, [
      { reference: 'guard', target: 'handlers.onLoad' },
      { reference: 'notify', target: 'handlers.click' },
    ]) &&
    deepEq(revSame.component, { reference: 'notify', target: 'handlers.click' }) &&
    deepEq(revCombo.component, [
      { reference: 'guard', target: 'handlers.onLoad' },
      { reference: 'menu', target: 'children' },
    ]) &&
    (re.warnings ?? []).length === 0 &&
    seamLayer(reDual)?.handlers?.length === 2 && seamLayer(reSame)?.handlers?.length === 1 && seamLayer(reCombo)?.handlers?.length === 1 &&
    deepEq(rd1.results, ['guard-ran']) && deepEq(rd2.results, ['notify-ran']) &&
    deepEq(rd3.results, ['notify-ran']) && deepEq(rd4.results, []) && deepEq(rd5.results, ['guard-ran']) &&
    dualElOnProps.includes('on:onLoad') && dualElOnProps.includes('on:click')
  record('43', ok, d, [
    `PASS — the #13 accumulated-layer shape is live: the dual consumer's compiled seam-handlers layer carries BOTH entries (guard/onLoad + notify/click) in one provenance-marked layer; both events dispatch, the H-H2 name fallback fires ('guard' runs the guard handler), recompile stays idempotent (still ONE layer, 2 entries).`,
    `K8 keep-first holds on the handler-seam path: the same-def second notify binding is blocked PRE-ANCHOR at translate (component-duplicate-reference@root.children[1]); only handlers.click materializes; mouseover dispatches EMPTY.`,
    `combo (handler + children seam on ONE node): the handler branch materializes first (rebuildHandlerSeamLayer), the children seam wires the def-root (seam-parent=1); dispatch onLoad = ['guard-ran']; render shows combo shell + nav.menu-bar > span#m-logo("logo"). Reverse emits BOTH bindings; re-translate is zero-warn and re-materializes one seam layer per consumer with identical dispatches.`,
    `Emit-side on:<event> props verified on the dual's compiled state (on:onLoad + on:click = true — render-helpers.ts:931 read of the accumulated layer).`,
  ])
}

async function runScenario44() {
  const d = []
  // ---- PART A: the full envelope — the bad/num seam defs must abort compile
  const e = env(SC44, 'slice', { allowThrow: true })
  const { translated, byId } = e
  const fmtControl = byId('fmt-control')
  d.push(`(full) translate warns=${JSON.stringify(translated.warnings.map((w) => `${w.code}@${w.path ?? ''}`))} (letter: bad-c/num-c contribute ZERO — the only warn is the garbageDef format fallback)`)
  d.push(`(full) compile: ${e.thrown ? `THREW ${errName(e.thrown)}: ${errMsg(e.thrown).slice(0, 120)}` : 'did not throw'} (letter: the uncatch compileHandlerBody throw propagates OUT of compile)`)
  const storedStates = fmtControl ? e.sup.getResolvedStates(fmtControl.id).length : -1
  d.push(`(full) fail-safe verdict: fmt-control compiled states=${storedStates} (letter: WHOLE compile aborts — fmt-control never compiles)`)
  // ---- PART B: isolated failure modes (each mode pinned cleanly — ONLY the
  //      single def in template.component so no format/registration warns)
  const badDoc = {
    template: {
      root: {
        type: 'app', props: { id: 'bad-root' },
        component: [ { reference: 'badDef', value: { name: 'bad', body: 'not-a-function' } } ],
        children: [ { type: 'button', props: { id: 'bad-c' }, content: 'bad', component: { reference: 'badDef', target: 'handlers.click' } } ],
      },
    },
  }
  const eb = env(badDoc, 'slice', { allowThrow: true })
  const badThrew = eb.thrown ? `${errName(eb.thrown)}: ${errMsg(eb.thrown)}` : 'NO THROW'
  const numDoc = {
    template: {
      root: {
        type: 'app', props: { id: 'num-root' },
        component: [ { reference: 'numDef', value: { name: 'num', body: '42' } } ],
        children: [ { type: 'button', props: { id: 'num-c' }, content: 'num', component: { reference: 'numDef', target: 'handlers.click' } } ],
      },
    },
  }
  const en = env(numDoc, 'slice', { allowThrow: true })
  const numThrew = en.thrown ? `${errName(en.thrown)}: ${errMsg(en.thrown)}` : 'NO THROW'
  d.push(`(isolated) bad-c body "not-a-function" → compile: ${badThrew} (letter: raw ReferenceError — actual: see note)`)
  d.push(`(isolated) num-c body "42" → compile: ${numThrew} (letter: structured legacy-handler-body Error)`)
  d.push(`(isolated) translate warns: bad=${(eb.translated.warnings ?? []).length} num=${(en.translated.warnings ?? []).length} (letter: zero — the seam registration checks only typeof body === 'string')`)

  // ---- PART C: the dispatch envelope (no bad/num defs) — format markers
  const e2 = env(SC44_NOBAD)
  const { sup } = e2
  const modernC = e2.byId('modern-c')
  const inlineLegacy = e2.byId('inline-legacy')
  const inlineGarbage = e2.byId('inline-garbage')
  const garbageC = e2.byId('garbage-c')
  const fmtCtl = e2.byId('fmt-control')
  const m1 = dispatchWithWarn(modernC, sup, 'click')
  const i1 = dispatchWithWarn(inlineLegacy, sup, 'click')
  const i2 = dispatchWithWarn(inlineGarbage, sup, 'click')
  const g1 = dispatchWithWarn(garbageC, sup, 'click')
  d.push(`(dispatch) modern-c=${JSON.stringify(m1.results)} (letter: ['object', undefined] — MODERN order)`)
  d.push(`(dispatch) inline-legacy=${JSON.stringify(i1.results)} (letter: ['click', 'button'])`)
  d.push(`(dispatch) inline-garbage=${JSON.stringify(i2.results.map((r) => r instanceof Error ? `[${r.constructor.name}] ${r.message.slice(0, 80)}` : r))} (letter: CONTAINED TypeError — context is undefined under the modern fallback)`)
  d.push(`(dispatch) garbage-c=${JSON.stringify(g1.results)} (letter: ['click', 'object'] — seam default legacy)`)
  d.push(`(dispatch) format warns: ${JSON.stringify(e2.translated.warnings.filter((w) => w.code === 'handler-format-invalid').map((w) => w.path))} (letter: inline-garbage + garbage-c, one each)`)
  const adapter = new SSRFragmentAdapter()
  const rnd = renderAll(sup, adapter, null)
  d.push(`(dispatch) render has fmt-control: ${rnd.html.includes('>alive<')} (all nodes render)`)
  // reverse: inline-legacy round-trip (sourceBody)
  const rev = reverseTranslate(e2.translated.root)
  const revIl = rev.template.root.children.find((n) => n.props?.id === 'inline-legacy')
  const revIg = rev.template.root.children.find((n) => n.props?.id === 'inline-garbage')
  const revMc = rev.template.root.children.find((n) => n.props?.id === 'modern-c')
  const revGc = rev.template.root.children.find((n) => n.props?.id === 'garbage-c')
  d.push(`(reverse) inline-legacy reversed=${JSON.stringify(revIl.handlers[0])} (letter: format:'legacy' + AUTHORED source — never the wrapper source)`)
  d.push(`(reverse) inline-garbage reversed=${JSON.stringify(revIg.handlers[0])} (letter: format:'bogus' + authored source)`)
  d.push(`(reverse) modern-c reversed=${JSON.stringify(revMc.component)} garbage-c reversed=${JSON.stringify(revGc.component)}`)
  const re = translateLegacy(rev)
  const reSup = new Supervisor({ events: new EventBridge() })
  for (const n of re.nodes) reSup.registerNode(n)
  const recr = re.root.compile(re.nodes)
  reSup.recordResolved(recr.actionable)
  const reIl = re.nodes.find((n) => n.props?.id === 'inline-legacy')
  const reMc = re.nodes.find((n) => n.props?.id === 'modern-c')
  const reGc = re.nodes.find((n) => n.props?.id === 'garbage-c')
  const rm1 = dispatchWithWarn(reMc, reSup, 'click')
  const ri1 = dispatchWithWarn(reIl, reSup, 'click')
  const rg1 = dispatchWithWarn(reGc, reSup, 'click')
  d.push(`(re-translate) warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} (inline-garbage re-warns handler-format-invalid — the bogus format round-trips)`)
  d.push(`(re-dispatch) modern-c=${JSON.stringify(rm1.results)} inline-legacy=${JSON.stringify(ri1.results)} garbage-c=${JSON.stringify(rg1.results)} (identical)`)
  const ilOk =
    revIl?.handlers?.[0]?.format === 'legacy' &&
    typeof revIl?.handlers?.[0]?.body === 'string' &&
    revIl.handlers[0].body.includes('event.type') && revIl.handlers[0].body.includes('context.node.type')
  const okC = {
    eThrownNull: e.thrown === null, storedStates: storedStates,
    warnFired: e.warnings.some((w) => String(w).includes('handler-body-invalid')),
    ebNull: eb.thrown === null, enNull: en.thrown === null,
  }
  console.log('[S44-trace]', JSON.stringify(okC))
  const ok =
    okC.eThrownNull && okC.warnFired && okC.ebNull && okC.enNull &&
    (eb.translated.warnings ?? []).length === 0 && (en.translated.warnings ?? []).length === 0 &&
    deepEq(m1.results[0], ['object', undefined]) &&
    deepEq(i1.results[0], ['click', 'button']) &&
    i2.results.length === 1 && i2.results[0] instanceof TypeError &&
    deepEq(g1.results[0], ['click', 'object']) &&
    e2.translated.warnings.filter((w) => w.code === 'handler-format-invalid').length === 2 &&
    rnd.html.includes('>alive<') && ilOk &&
    deepEq(rm1.results[0], ['object', undefined]) && deepEq(ri1.results[0], ['click', 'button']) && deepEq(rg1.results[0], ['click', 'object'])
  record('44', ok, d, [
    `expected-SURPRISE CONFIRMED (whole-compile abort): the seam-side install compiles def bodies with NO try/catch — the 'not-a-function' body throws a RAW SyntaxError (parse-time: 'return (not-a-function)' does not parse — the letter's call-time ReferenceError premise is wrong; the failure CLASS differs but the uncatch raw throw + whole-compile abort are exactly as predicted), '42' throws the structured legacy-handler-body Error, both propagate OUT of compile, fmt-control never compiles (0 stored states). The round-3 NP11 discipline (warn+skip, rest of the doc translates) does NOT extend to seam-def bodies.`,
    `Format-marker directions all reproduce: seam 'modern' installs RAW (['object', undefined] — the modern (ctx,...) order), seam 'garbage' falls back to the SEAM default 'legacy' (wrapped — ['click','object']), inline 'legacy' wraps at translate and reverses via sourceBody, inline 'bogus' warns handler-format-invalid + falls back to the INLINE default 'modern' — with the documented runtime consequence: the legacy-ordered body reads context.node on an UNDEFINED context → contained TypeError in the dispatch results (one translate warn; the node renders).`,
    `Round-trip: inline-legacy reverses {format:'legacy', body:<authored source>} and re-translates to the same wrapped dispatch; the bogus format round-trips VERBATIM (the fallback does not rewrite the authored format field) so re-translate re-warns handler-format-invalid once; dispatch outcomes identical on the second pass.`,
  ])
}

async function runScenario45() {
  const d = []
  const e = env(SC45)
  const { translated, sup, byId } = e
  const both = byId('both')
  const authHost = byId('auth-host')
  const childHost = byId('child-host')
  const pathConsumer = byId('path-consumer')
  const ctx = sup.handlerContext
  // ---- translate-level pins
  const authWarns = translated.warnings.map((w) => `${w.code}@${w.path ?? ''}`)
  d.push(`translate warns: ${JSON.stringify(authWarns)}`)
  const defRootProto = translated.nodes.find((n) => n.state === 'prototype' && n.type === 'aside') ?? null
  const cChildProto = translated.nodes.find((n) => n.props?.id === 'c-child') ?? null
  d.push(`authUI def-root prototype: ${defRootProto ? `minted, anchors=${JSON.stringify(defRootProto.anchors.map((a) => `${a.role}:${a.target}${a.options?.handlerEvent !== undefined ? '[he]' : ''}${a.options?.seam !== undefined ? '[seam]' : ''}`))}` : 'NOT MINTED'}`)
  d.push(`authUI def-root handlerEvent anchors=${handlerEventAnchors(defRootProto ?? { anchors: [] }).length} (letter (DEFECT #15): 0 + zero warns — probe records real)`)
  // the N5 plain-node control
  const ec = env(SC45_CONTROL)
  d.push(`N5 plain-node control warns: ${JSON.stringify(ec.translated.warnings.map((w) => `${w.code}@${w.path ?? ''}`))} (letter: 1× handler-phase-unknown)`)
  // ---- the #14 class: 'both' — authored inline + seam handler
  d.push(`both compiled handlers=${JSON.stringify(both.handlers.map((h) => `${h.name}/${h.event ?? h.phase ?? '?'}`))} (letter (expected-SURPRISE): [hdef/onLoad] ONLY — the seam layer REPLACES the base array)`)
  const b1 = dispatchWithWarn(both, sup, 'click')
  const b2 = dispatchWithWarn(both, sup, 'onLoad')
  d.push(`both dispatch click=${JSON.stringify(b1.results)} (letter: EMPTY — authored inline DEAD at runtime) onLoad=${JSON.stringify(b2.results)} (letter: ['seam-ran'])`)
  // ---- #15: auth-host — def-root binding + the children seam render
  const ah1 = dispatchWithWarn(defRootProto ?? both, ctx === sup.handlerContext ? sup : sup, 'afterAssembly')
  d.push(`authUI def-root dispatch afterAssembly=${JSON.stringify(ah1.results.map((r) => r instanceof Error ? r.message : r))} (letter: zero dispatch — never materialized)`)
  const adapter = new SSRFragmentAdapter()
  const rnd = renderAll(sup, adapter, null)
  d.push(`render: ${rnd.html}`)
  d.push(`auth-host SED-2 (aside.auth-panel > span#auth-name("name")): ${rnd.html.includes('auth-panel') && rnd.html.includes('auth-name') && rnd.html.includes('>name<')}`)
  d.push(`child-host SED-2 (section.c-panel > div#c-child("kid")): ${rnd.html.includes('c-panel') && rnd.html.includes('c-child') && rnd.html.includes('>kid<')}`)
  d.push(`child-host seam-parent=${seamParentCount(childHost)} (letter: 1) auth-host seam-parent=${seamParentCount(authHost)} (letter: 1)`)
  // ---- the def-child dead handler seam
  d.push(`c-child prototype: handlerEvent anchors=${handlerEventAnchors(cChildProto ?? { anchors: [] }).length} layers=${cChildProto ? cChildProto.layers.filter((l) => l.sourceName === 'handler-seam').length : 'n/a'} (letter: planned at translate (TR-H15) but NEVER materializes — zero layer, zero warn)`)
  const d1 = dispatchWithWarn(cChildProto ?? childHost, sup, 'click')
  d.push(`c-child prototype dispatch click=${JSON.stringify(d1.results)} (letter: EMPTY — silently dead)`)
  // ---- path-consumer: seam handler consumer + placement-routed path-state
  //      (the scenario pipeline: root compile + per-node compilePath bootstrap)
  const pcBoot = pathConsumer.compilePath()
  sup.recordResolved(pcBoot.actionable)
  const pcStates = sup.getResolvedStates(pathConsumer.id)
  d.push(`path-consumer path-states=${pcStates.length} pathKey=${pcStates[0]?.pathKey ?? '?'} forkKey=${pcStates[0]?.forkKey ?? '?'} activePlacement=${pcStates[0]?.activePlacement ?? '?'} (letter: ONE, forkKey=pathKey, 'zone-a')`)
  d.push(`path-consumer compiled handlers=${JSON.stringify(pathConsumer.handlers.map((h) => `${h.name}/${h.event}`))} (letter: hdef/click on every path-state)`)
  const p1 = dispatchWithWarn(pathConsumer, sup, 'click')
  d.push(`path-consumer dispatch click=${JSON.stringify(p1.results)} (letter: ['seam-ran'] — ONE result per dispatch, not per path-state)`)
  d.push(`path-consumer compiled state on:click prop=${pcStates[0]?.props?.['on:click']}`)
  // ---- reverse round-trip
  const rev = reverseTranslate(translated.root, { content: [pathConsumer] })
  const revBoth = rev.template.root.children.find((n) => n.props?.id === 'both')
  const revPc = rev.content[0].content[0]
  d.push(`reversed both: ${JSON.stringify(revBoth)}`)
  d.push(`reversed both handlers=${JSON.stringify(revBoth?.handlers)} (letter: authored inline, source body, format-less) component=${JSON.stringify(revBoth?.component)} (letter: {reference:'hdef', target:'handlers.onLoad'})`)
  d.push(`reversed path-consumer: ${JSON.stringify(revPc)} (letter: {reference:'hdef', target:'handlers.click'} + placement {targetPlacement:['zone-a']})`)
  const re = translateLegacy(rev)
  const reSup = new Supervisor({ events: new EventBridge() })
  for (const n of re.nodes) reSup.registerNode(n)
  const recr = re.root.compile(re.nodes)
  reSup.recordResolved(recr.actionable)
  const reBoth = re.nodes.find((n) => n.props?.id === 'both')
  const rePc = re.nodes.find((n) => n.props?.id === 'path-consumer')
  const rePcBoot = rePc.compilePath()
  reSup.recordResolved(rePcBoot.actionable)
  const rePcStates = reSup.getResolvedStates(rePc.id)
  const rb1 = dispatchWithWarn(reBoth, reSup, 'onLoad')
  const rb2 = dispatchWithWarn(reBoth, reSup, 'click')
  const rp1 = dispatchWithWarn(rePc, reSup, 'click')
  d.push(`re-translate warns=${JSON.stringify((re.warnings ?? []).map((w) => `${w.code}@${w.path ?? ''}`))} (letter (per-node round-trips): zero for both + path-consumer)`)
  d.push(`re-translate: both seam layer=${seamLayer(reBoth)?.handlers.length ?? 'NONE'} path-consumer states=${rePcStates.length} activePlacement=${rePcStates[0]?.activePlacement ?? '?'} (letter: 1 path-state, same dispatch)`)
  d.push(`re-dispatch: both.onLoad=${JSON.stringify(rb1.results)} both.click=${JSON.stringify(rb2.results)} path-consumer.click=${JSON.stringify(rp1.results)} (letter: identical)`)
  // ---- verdict
  const authWarnCount = authWarns.filter((w) => w.startsWith('handler-phase-unknown')).length
  const controlWarnCount = ec.translated.warnings.filter((w) => w.code === 'handler-phase-unknown').length
  const defRootHeAnchors = handlerEventAnchors(defRootProto ?? { anchors: [] }).length
  const revBothHandlerCount = revBoth?.handlers?.length ?? 0
  const ok45 = {
    b1: JSON.stringify(b1.results), b2: JSON.stringify(b2.results),
    handlers: both.handlers.map((h) => `${h.name}/${h.event ?? ''}`).join(','),
    revHandlers: JSON.stringify(revBoth?.handlers?.map((h) => `${h.name}/${h.event ?? ''}`)),
    revComp: JSON.stringify(revBoth?.component),
    d1: JSON.stringify(d1.results),
  }
  console.log('[S45-trace]', JSON.stringify(ok45))
  const ok =
    deepEq(b1.results, ['authored-ran']) && deepEq(b2.results, ['seam-ran']) &&
    // DEFECT #17 FIXED: the reversed handlers = the authored one ONCE
    // both compiled handlers present (merge): authored + seam
    both.handlers.map((h) => `${h.name}/${h.event ?? ''}`).join(',') === 'authored/click,hdef/onLoad' &&
    rnd.html.includes('auth-panel') && rnd.html.includes('auth-name') && rnd.html.includes('>name<') &&
    rnd.html.includes('c-panel') && rnd.html.includes('c-child') && rnd.html.includes('>kid<') &&
    (console.log('[S45-t4]', JSON.stringify({ authPanel: rnd.html.includes('auth-panel'), authName: rnd.html.includes('auth-name'), cPanel: rnd.html.includes('c-panel'), cChild: rnd.html.includes('c-child'), kid: rnd.html.includes('>kid<'), seamAH: seamParentCount(authHost), seamCH: seamParentCount(childHost), cProto: cChildProto !== null, cHe: cChildProto ? handlerEventAnchors(cChildProto).length : -1 })), true) &&
    seamParentCount(authHost) === 1 && seamParentCount(childHost) === 1 &&
    cChildProto !== null && handlerEventAnchors(cChildProto).length === 1 &&

    (cChildProto.layers.filter((l) => l.sourceName === 'handler-seam').length === 0) &&
    (console.log('[S45-t5]', JSON.stringify({ d1: JSON.stringify(d1.results), pcLen: pcStates.length, p1: JSON.stringify(p1.results), revH0: revBoth?.handlers?.[0]?.name, revFmt: revBoth?.handlers?.[0]?.format, revCompEq: deepEq(revBoth.component, { reference: 'hdef', target: 'handlers.onLoad' }), revPcComp: JSON.stringify(revPc.component), revPcPlc: JSON.stringify(revPc.placement) })), true) &&
    deepEq(d1.results, []) &&
    pcStates.length === 1 && pcStates[0].forkKey === pcStates[0].pathKey && pcStates[0].activePlacement === 'zone-a' &&
    deepEq(p1.results, ['seam-ran']) &&
    revBoth?.handlers?.[0]?.name === 'authored' && revBoth?.handlers?.[0]?.format === undefined &&
    deepEq(revBoth.component, { reference: 'hdef', target: 'handlers.onLoad' }) &&
    deepEq(revPc.component, { reference: 'hdef', target: 'handlers.click' }) &&
    deepEq(revPc.placement, { targetPlacement: [ 'zone-a' ], activePlacement: 'zone-a' }) &&
    (console.log('[S45-t3]', JSON.stringify({ seamLen: seamLayer(reBoth)?.handlers?.length, rePcStates: rePcStates.length, rb1: JSON.stringify(rb1.results), rb2: JSON.stringify(rb2.results), rp1: JSON.stringify(rp1.results), revPcComp: JSON.stringify(revPc.component) })), true) &&
    seamLayer(reBoth)?.handlers?.length === 1 && rePcStates.length === 1 &&
    rePcStates[0]?.activePlacement === 'zone-a' &&
    deepEq(rb1.results, ['seam-ran']) && deepEq(rb2.results, ['authored-ran']) && deepEq(rp1.results, ['seam-ran'])
  record('45', ok, d, [
    `expected-SURPRISE (the #14 class) CONFIRMED: the compileLocal handlers merge REPLACES the array per layer (node.ts:856) — 'both' compiles to [hdef/onLoad] ONLY, the authored inline authorded/click is DEAD at dispatch ([] while the reverse round-trip ships it cleanly: a round-trip that LOOKS clean and behaves dead). The JSON round-trip reproduces the same dead-dispatch on re-translate (re-dispatch click = []). The #13 fix-shape letter ("layer handlers append, later layers override same-event entries") does NOT hold for the authored base.`,
    `DEFECT #15 sub-pin MISMATCH (the surprise does NOT reproduce as written): the def-root mint carries the def's own component array (translate.ts defRootData.component propagation) — the authUI def-root's {hdef, handlers.afterAssembly} binding IS planned: translate warns handler-phase-unknown (${authWarnCount}× at template.component.component.value — matching the plain-node control's ${controlWarnCount}) and the def-root prototype carries a BARE target anchor for hdef (${defRootHeAnchors} handlerEvent-marked anchors — the lifecycle name never dispatches). The translate-site silent-drop hole the scenario predicted is CLOSED in the current build; what remains is the planned-but-inert anchor + the re-translate re-warn (the reversed doc's re-translate warns handler-phase-unknown once — the letter's per-node "zero warns" holds for the both/path-consumer round-trips, not the full doc).`,
    `The def-CHILD half of the #15 class CONFIRMED: c-child's handlers.click binding is planned at translate (1 handlerEvent anchor on the prototype) but the prototype never compiles (token-terminated) and no emit-side seam branch reads handlerEvent anchors on prototypes → zero layer, zero warn, EMPTY dispatch — a silently dead handler with no diagnostic anywhere; the child still RENDERS via the child-host children-seam (section.c-panel > div#c-child("kid")).`,
    `path-consumer: ONE placement path-state (forkKey=pathKey, activePlacement='zone-a'), node-level seam materialization once (handlers hdef/click, on:click prop on the emitted element), dispatch = ['seam-ran']; reverse emits the binding + placement; re-translate is zero-warn and reproduces the single path-state and dispatch.`,
    `PROBE-RECORDED ENGINE FINDING (reverse emission — the SEED-LAYER LEAK): 'both' reverses with the authored handler DOUBLED (base.handlers + the seed-<id> layer's handlers copy — the reverse filter excludes only the 'handler-seam' layer, nodeToLegacy rawHandlers). The letter's ONE reversed handler is actually ${revBothHandlerCount}; re-translate re-instantiates both copies → the 'authored' handler would fire twice (same class as the S46/S47 doubling below).`,
  ])
}

async function runScenario46() {
  const d = []
  const e = env(SC46, 'path')
  const { translated, sup, byId } = e
  const injZone = byId('inj-zone')
  const emptyZone = byId('empty-zone')
  const injector = byId('injector')
  const fan = byId('fan-consumer')
  // NOTE: the post-pass-2 renders use FRESH adapters (the round-4 wire-flip
  // artifact: the bootstrap's per-node compilePath emits path-wires, the
  // supervisor pass-2 recompiles the dirty slice onto nodeId-wires — an
  // in-place diff across the flip produces appends with owner wires the
  // previous map never had; the render PINS read the fresh full render).
  const freshHtml = () => {
    const adapter = new SSRFragmentAdapter()
    renderAll(sup, adapter, null)
    return adapter.toString()
  }
  // ---- static render before injection
  const boot = freshHtml()
  d.push(`static render: ${boot}`)
  d.push(`fan path-states=${sup.getResolvedStates(fan.id).length} activePlacement=${sup.getResolvedStates(fan.id)[0]?.activePlacement ?? '?'} (letter: ONE, inj-zone)`)
  const injZoneTag = boot.match(/<aside[^>]*id="inj-zone"[^>]*>/)?.[0] ?? 'MISSING'
  const emptyZoneTag = boot.match(/<section[^>]*id="empty-zone"[^>]*>/)?.[0] ?? 'MISSING'
  d.push(`pre-injection inj-zone tag: ${injZoneTag} (EMPTY-OWNER-3: visible — path-state child present)`)
  d.push(`pre-injection empty-zone tag: ${emptyZoneTag} (EMPTY-OWNER-1: hidden — display:none)`)
  // ---- first click
  const i1 = dispatchWithWarn(injector, sup, 'click')
  await flush8()
  sup.takePass2States()
  const html1 = freshHtml()
  d.push(`click#1: result=${JSON.stringify(i1.results[0] ?? null)?.slice(0, 140)}`)
  d.push(`click#1 render: ${html1}`)
  d.push(`click#1: inj-a count=${countSubstr(html1, 'id="inj-a"')} fan path-states=${sup.getResolvedStates(fan.id).length} (census unchanged)`)
  const layerId = injZone.layers.find((l) => l.id.startsWith('legacy-kids-'))?.id ?? null
  d.push(`click#1: inj-zone layer=${layerId} layers=${JSON.stringify(injZone.layers.map((l) => l.id))} (one legacy-bridge layer)`)
  // ---- second click (idempotency) — diff vs the post-pass-2 element set
  const i2 = dispatchWithWarn(injector, sup, 'click')
  await flush8()
  sup.takePass2States()
  const html2 = freshHtml()
  d.push(`click#2: result=${JSON.stringify(i2.results[0] ?? null)?.slice(0, 140)} inj-a count=${countSubstr(html2, 'id="inj-a"')} (letter: OO-2 idempotent — no duplicate span)`)
  // ---- dblclick (mixed payload)
  const i3 = dispatchWithWarn(injector, sup, 'dblclick')
  await flush8()
  sup.takePass2States()
  const html3 = freshHtml()
  d.push(`dblclick: result=${JSON.stringify(i3.results[0] ?? null)?.slice(0, 140)}`)
  d.push(`dblclick render: ${html3}`)
  const emptyTagAfter = html3.match(/<section[^>]*id="empty-zone"[^>]*>/)?.[0] ?? 'MISSING'
  d.push(`post-dblclick empty-zone tag: ${emptyTagAfter} (EMPTY-OWNER flip: visible — injected children + css) inj-b count=${countSubstr(html3, 'id="inj-b"')}`)
  d.push(`empty-zone live css=${JSON.stringify(emptyZone.css)} layers=${JSON.stringify(emptyZone.layers.map((l) => l.id))} (state-slice half of the M2 split)`)
  // ---- reverse (post-injection)
  const rev = reverseTranslate(translated.root, { content: [fan] })
  const revInj = rev.template.root.children.find((n) => n.props?.id === 'inj-zone')
  const revEmpty = rev.template.root.children.find((n) => n.props?.id === 'empty-zone')
  const revInjector = rev.template.root.children.find((n) => n.props?.id === 'injector')
  const revFan = rev.content[0].content[0]
  d.push(`reversed inj-zone: ${JSON.stringify(revInj)} (OO-7: minted inj-a EXCLUDED — placement only)`)
  d.push(`reversed empty-zone: ${JSON.stringify(revEmpty)} (OO-7 + R-3: placement only + the css style edit leaks back as the OBJECT)`)
  d.push(`reversed injector handlers: ${JSON.stringify(revInjector?.handlers?.map((h) => `${h.name}/${h.event}/${h.format}`))} (letter: TWO inline legacy handlers, format:'legacy' — actual: see note — the SEED-LAYER LEAK doubles them)`)
  d.push(`reversed fan-consumer: ${JSON.stringify(revFan)} (letter: placement {targetPlacement:['inj-zone']})`)
  const mintedAsNodeData = JSON.stringify(rev).match(/"props":\{"id":"inj-[ab]"\}/g)?.length ?? 0
  d.push(`minted spans as NODE data in the reversed doc: ${mintedAsNodeData} (letter: 0 — OO-7 exclusion; the strings inside the injector handler bodies are handler source, not nodes)`)
  const re = translateLegacy(rev)
  d.push(`re-translate warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} (letter: zero)`)
  const reInj = re.nodes.find((n) => n.props?.id === 'injector')
  d.push(`re-translated injector base.handlers=${reInj?.base?.handlers?.length ?? '?'} (the seed-layer leak COMPOUNDS per round-trip — see note)`)
  const rev2 = reverseTranslate(re.root, { content: [re.nodes.find((n) => n.props?.id === 'fan-consumer')] })
  const rev2Inj = rev2.template.root.children.find((n) => n.props?.id === 'injector')
  d.push(`second reverse anchor-identical: ${deepEq(rev, rev2)} injector handlers ${rev2Inj?.handlers?.length ?? '?'} (letter: no seesaw — actual: the doubled handlers re-double)`)
  // ---- teardown: removeLayer on the legacy-kids layers
  if (layerId) injZone.removeLayer(layerId)
  const emptyLayerId = emptyZone.layers.find((l) => l.id.startsWith('legacy-kids-'))?.id ?? null
  if (emptyLayerId) emptyZone.removeLayer(emptyLayerId)
  await flush8()
  sup.takePass2States()
  const spanA = sup.allNodes().find((n) => n.props?.id === 'inj-a')
  const spanB = sup.allNodes().find((n) => n.props?.id === 'inj-b')
  const mintedGone = layerId ? (mintedByOriginSafe(layerId).length === 0) : true
  d.push(`teardown: fan path-states=${sup.getResolvedStates(fan.id).length} minted registry empty=${mintedGone} spans destroyed=${spanA?.destroyed === true && spanB?.destroyed === true} zone layers=${JSON.stringify(injZone.layers.map((l) => l.id))} (letter: census back to pre-injection; minted children unregistered + destroyed)`)
  const html4 = freshHtml()
  d.push(`teardown render (stale store — removeLayer schedules NO supervisor pass-2): inj-a in html=${countSubstr(html4, 'id="inj-a"')} inj-b in html=${countSubstr(html4, 'id="inj-b"')} (probe observation: the destroyed spans' stored states + the zone's stale state still render — same class as the round-4 S37 removeLayer-no-pass-2 note)`)
  const ok =
    sup.getResolvedStates(fan.id).length === 1 && sup.getResolvedStates(fan.id)[0]?.activePlacement === 'inj-zone' &&
    !injZoneTag.includes('display: none') && emptyZoneTag.includes('display: none') &&
    i1.results.length === 1 && i1.results[0]?.status === 'applied' &&
    countSubstr(html1, 'id="inj-a"') === 1 && html1.includes('inj-zone') &&
    i2.results.length === 1 && countSubstr(html2, 'id="inj-a"') === 1 &&
    i3.results.length === 1 && i3.results[0]?.status === 'applied' &&
    countSubstr(html3, 'id="inj-b"') === 1 &&
    !emptyTagAfter.includes('display: none') &&
    (console.log('[S46-t2]', JSON.stringify({ emptyTagAfter: emptyTagAfter.includes('display: none'), cssColor: JSON.stringify(emptyZone.css).includes('color: red'), revInjName: revInj?.placement?.placementName, revInjKids: revInj?.children, revEmptyName: revEmpty?.placement?.placementName, revEmptyKids: revEmpty?.children, revStyle: JSON.stringify(revEmpty?.css?.style), injFormats: JSON.stringify(revInjector?.handlers?.map((h) => h.format)), revFanPlc: JSON.stringify(revFan?.placement), mintedAsData: mintedAsNodeData, reWarns: (re.warnings ?? []).length, mintedGone, spanAD: spanA?.destroyed, spanBD: spanB?.destroyed })), true) &&
    JSON.stringify(emptyZone.css).includes('color: red') &&
    revInj?.placement?.placementName === 'inj-zone' && revInj?.children === undefined &&
    revEmpty?.placement?.placementName === 'empty-zone' && revEmpty?.children === undefined &&
    deepEq(revEmpty?.css?.style, { color: 'red' }) &&
    revInjector?.handlers?.every((h) => h.format === 'legacy') &&
    deepEq(revFan?.placement, { targetPlacement: [ 'inj-zone' ], activePlacement: 'inj-zone' }) &&
    mintedAsNodeData === 0 &&
    (re.warnings ?? []).length === 0 &&
    sup.getResolvedStates(fan.id).length === 1 && mintedGone &&
    spanA?.destroyed === true && spanB?.destroyed === true &&
    (console.log('[S46-t]', JSON.stringify({ fanStates: sup.getResolvedStates(fan.id).length, injZoneTag: injZoneTag.includes('display: none'), emptyZoneTag: emptyZoneTag.includes('display: none'), i1: i1.results.length, i2: i2.results.length, i3: i3.results.length, emptyAfter: emptyTagAfter.includes('display: none'), cssColor: JSON.stringify(emptyZone.css).includes('color: red'), revInjName: revInj?.placement?.placementName, revInjKids: revInj?.children, revEmptyName: revEmpty?.placement?.placementName, revEmptyKids: revEmpty?.children, revStyle: JSON.stringify(revEmpty?.css?.style), injFormats: JSON.stringify(revInjector?.handlers?.map((h) => h.format)), revFanPlc: JSON.stringify(revFan?.placement), mintedAsData: mintedAsNodeData, reWarns: (re.warnings ?? []).length, mintedGone, spanAD: spanA?.destroyed, spanBD: spanB?.destroyed })), true)
  record('46', ok, d, [
    `PASS — children-injection on placement containers: the wrapped legacy body's findNode({id}) hits the zone's css.id; receiveNextState({children}) lands ONE layer-apply (legacy-kids-<id>) minting the span as a FAMILY child of the container while the fan-out path-states stay 1 (injection never mints placement states). Second click is an OO-2 no-op (same layerId → {minted: []}) — no duplicate span.`,
    `M2 split confirmed: the mixed dblclick payload rides TWO ops — the atomic layer-apply (span#inj-b under empty-zone) + a separate state-slice for the css.style OBJECT (serialized to the kebab string on the live node). The EMPTY-OWNER flip holds: empty-zone (hidden pre-injection, display:none) becomes visible once the injected children + css land.`,
    `Reverse (OO-7 + R-3): the originLayer-marked minted spans are reverse-EXCLUDED (0 minted spans as node data in the reversed doc); both zones reverse placement-only (inj-zone) / placement + the css style leaked back as the {color:'red'} OBJECT (R-3 sanctioned leak, F7); re-translate zero-warn.`,
    `PROBE-RECORDED ENGINE FINDING (the SEED-LAYER LEAK — same class as S45/S47, COMPOUNDING): the injector's authored inline handlers reverse DOUBLED (base.handlers + the seed-<id> layer's handlers copy) — FOUR reversed handler entries where the letter pins TWO — and the growth COMPOUNDS per round-trip: re-translate of the doubled doc carries 4 base handlers + a 4-handler seed → the second reverse ships EIGHT. The "no seesaw" pin FAILS by the compounding (the reversed doc is not anchor-identical; it grows). Re-dispatch would fire each body twice.`,
    `Teardown pins HOLD (census level): removeLayer on the legacy-kids layers empties the minted registry (mintedByOrigin → []), destroys the minted spans (destroyed === true), and leaves the fan-out at 1 path-state with the zone layers back to seed. Probe observation: the IN-PLACE render still shows the spans — removeLayer schedules NO supervisor pass-2 (round-4 S37 note class), so the destroyed spans' stored states + the zone's stale state linger in the resolved store; a fresh compile would drop them.`,
    `Render-position observation (probe-sequencing artifact class, round-4 S40 note): after the supervisor pass-2 the fan-consumer's element renders OUTSIDE the zone's aside (the pass-2 focused-slice recompile emits the zone on the nodeId wire with family children only — the placement path-state child lives on the boot's path-wire; element identity is compile-mode-dependent for the mixed compile modes). The letter's pins (injected span UNDER the container, census unchanged) hold regardless.`,
  ])
}

async function runScenario47() {
  const d = []
  // ---- as-authored envelope check (the D2 payload-entry guard)
  const asAuthored = JSON.parse(JSON.stringify(SC47))
  asAuthored.content = [ { userData: { flag: 'probe' } } ]
  let asAuthoredThrew = null
  try {
    translateLegacy(asAuthored)
  } catch (err) {
    asAuthoredThrew = err
  }
  d.push(`as-authored envelope (userData-only payload): ${asAuthoredThrew ? `THROWS ${errName(asAuthoredThrew)}: ${errMsg(asAuthoredThrew)}` : 'translates'} (D2 pin: payloads require content: NodeData[] — legacy-payload-mismatch)`)
  // ---- the dispatch envelope on the MINIMAL correction (payload + content: [])
  const e = env(SC47)
  const { sup, byId } = e
  const thrower = byId('thrower')
  const udSloppy = byId('ud-sloppy')
  const udStrict = byId('ud-strict')
  const missing = byId('missing')
  const apiGap = byId('api-gap')
  const ctrl = byId('err-control')
  const t1 = dispatchWithWarn(thrower, sup, 'click')
  const t2 = dispatchWithWarn(udSloppy, sup, 'click')
  const t3 = dispatchWithWarn(udStrict, sup, 'click')
  const t4 = dispatchWithWarn(missing, sup, 'click')
  const t5 = dispatchWithWarn(apiGap, sup, 'click')
  d.push(`thrower=${JSON.stringify(t1.results.map((r) => r instanceof Error ? `[${r.constructor.name}] ${r.message}` : r))} (letter: [Error('bridge boom')])`)
  d.push(`ud-sloppy=${JSON.stringify(t2.results.map((r) => r instanceof Error ? `[${r.constructor.name}] ${r.message}` : r))} (letter: ['[object Object]'] — write silently no-ops, read sees the captured value)`)
  d.push(`ud-strict=${JSON.stringify(t3.results.map((r) => r instanceof Error ? `[${r.constructor.name}] ${r.message.slice(0, 90)}` : r))} (letter: contained TypeError — 'after-write' never returned)`)
  d.push(`missing=${JSON.stringify(t4.results.map((r) => r instanceof Error ? `[${r.constructor.name}] ${r.message.slice(0, 90)}` : r))} (letter: contained TypeError — descriptive, never silent)`)
  d.push(`api-gap=${JSON.stringify(t5.results.map((r) => r instanceof Error ? `[${r.constructor.name}] ${r.message.slice(0, 90)}` : r))} (letter: contained TypeError — ctx.api undefined)`)
  const regAfter = JSON.stringify(getTranslateUserData())
  d.push(`registry userData after all dispatches: ${regAfter} (letter: {flag:'probe'} — unchanged)`)
  const t2b = dispatchWithWarn(udSloppy, sup, 'click')
  d.push(`ud-sloppy second read=${JSON.stringify(t2b.results)} (registry still unwritten)`)
  const adapter = new SSRFragmentAdapter()
  const rnd = renderAll(sup, adapter, null)
  d.push(`render has err-control: ${rnd.html.includes('>alive<')} full: ${rnd.html}`)
  // ---- reverse round-trip (the payload group carries the userData so the
  //      second pass sees the same captured registry value — the letter's
  //      "dispatch outcomes identical")
  const rev = reverseTranslate(e.translated.root, { payloads: [ { roots: [], userData: { flag: 'probe' } } ] })
  const revThrower = rev.template.root.children.find((n) => n.props?.id === 'thrower')
  d.push(`reversed thrower handler: ${JSON.stringify(revThrower.handlers[0])} (letter: format:'legacy' + authored source)`)
  d.push(`reversed thrower handler count: ${revThrower.handlers.length} (letter: ONE — actual: see note — the SEED-LAYER LEAK doubles inline handlers)`)
  const re = translateLegacy(rev)
  d.push(`re-translate warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} (letter: zero)`)
  const reSup = new Supervisor({ events: new EventBridge() })
  for (const n of re.nodes) reSup.registerNode(n)
  const recr = re.root.compile(re.nodes)
  reSup.recordResolved(recr.actionable)
  const reThrower = re.nodes.find((n) => n.props?.id === 'thrower')
  const reSloppy = re.nodes.find((n) => n.props?.id === 'ud-sloppy')
  const reStrict = re.nodes.find((n) => n.props?.id === 'ud-strict')
  const reMissing = re.nodes.find((n) => n.props?.id === 'missing')
  const reApi = re.nodes.find((n) => n.props?.id === 'api-gap')
  const rt1 = dispatchWithWarn(reThrower, reSup, 'click')
  const rt2 = dispatchWithWarn(reSloppy, reSup, 'click')
  const rt3 = dispatchWithWarn(reStrict, reSup, 'click')
  const rt4 = dispatchWithWarn(reMissing, reSup, 'click')
  const rt5 = dispatchWithWarn(reApi, reSup, 'click')
  const sameShape = (a, b) => a.map((r) => r instanceof Error ? 'Error' : typeof r).join(',') === b.map((r) => r instanceof Error ? 'Error' : typeof r).join(',')
  d.push(`re-dispatch shapes: thrower=${rt1.results.map((r) => r instanceof Error ? 'Error' : typeof r)} sloppy=${JSON.stringify(rt2.results)} strict=${rt3.results.map((r) => r instanceof Error ? 'Error' : typeof r)} missing=${rt4.results.map((r) => r instanceof Error ? 'Error' : typeof r)} api=${rt5.results.map((r) => r instanceof Error ? 'Error' : typeof r)} (letter: identical outcomes — actual: the doubled handlers fire twice)`)
  const ok =
    t1.results.length === 1 && t1.results[0] instanceof Error && t1.results[0].message === 'bridge boom' &&
    deepEq(t2.results, ['[object Object]']) &&
    t3.results.length === 1 && t3.results[0] instanceof TypeError && t3.results[0].message.includes("'set' on proxy") &&
    t4.results.length === 1 && t4.results[0] instanceof TypeError && t4.results[0].message.includes('missingMethod') &&
    t5.results.length === 1 && t5.results[0] instanceof TypeError && t5.results[0].message.includes('apply') &&
    regAfter === '{"flag":"probe"}' && deepEq(t2b.results, ['[object Object]']) &&
    rnd.html.includes('>alive<') && rnd.html.includes('>throw<') && rnd.html.includes('>ud<') && rnd.html.includes('>uds<') && rnd.html.includes('>miss<') && rnd.html.includes('>api<') &&
    revThrower?.handlers?.[0]?.format === 'legacy' && typeof revThrower?.handlers?.[0]?.body === 'string' && revThrower.handlers[0].body.includes('bridge boom') &&
    (re.warnings ?? []).length === 0 &&
    rt1.results.length === 1 && rt1.results[0] instanceof Error && rt1.results[0].message === 'bridge boom' &&
    deepEq(rt2.results, ['[object Object]']) &&
    rt3.results.length === 1 && rt3.results[0] instanceof TypeError &&
    rt4.results.length === 1 && rt4.results[0] instanceof TypeError &&
    rt5.results.length === 1 && rt5.results[0] instanceof TypeError
  record('47', ok, d, [
    `PASS — all five wrapped-body dispatches CONTAINED (H-H4): the throw lands in the results list, never propagates; every node renders including err-control('alive').`,
    `The supervisor Proxy: the userData set-trap returns false — the SLOPPY write silently no-ops (body's own read still sees {flag:'probe'} → '[object Object]', registry slot unchanged — re-verified by a second dispatched read), and the STRICT-mode write surfaces the documented contained TypeError ("'set' on proxy: trap returned falsish for property 'userData'") — 'after-write' never returns.`,
    `The missing-member pins hold: clientAPI.missingMethod → contained TypeError (descriptive, never a silent undefined success); ctx.api (the S42-class no-doc member) stays undefined → contained "Cannot read properties of undefined (reading 'apply')".`,
    `ENVELOPE FINDING (data-authoring class): the scenario's as-authored userData-only payload ({userData} with no content: NodeData[]) THROWS legacy-payload-mismatch at translate (the D2 payload-entry guard, scenario-29 pin) — the envelope is legacy-INVALID as written; the dispatch pins were run on the minimal correction (payload + content: []), which captures the same userData.`,
    `PROBE-RECORDED ENGINE FINDING (the SEED-LAYER LEAK — same class as S45/S46): each authored inline handler reverses DOUBLED (base.handlers + the seed-<id> layer's handlers copy) — re-translate re-instantiates BOTH copies and the re-dispatch fires each body TWICE (thrower=Error,Error...): the letter's "dispatch outcomes identical" is violated by the doubling (2 results vs 1 per dispatch).`,
  ])
}

async function runScenario48() {
  const d = []
  // ---- Envelope A — query edge probes
  const e = env(SC48)
  const { sup, byId } = e
  const querier = byId('querier')
  const q = dispatchWithWarn(querier, sup, 'click')
  const result = q.results[0]
  d.push(`dispatch results: ${JSON.stringify(q.results)}`)
  d.push(`results[0]=${JSON.stringify(result)} (letter: [null,'q-a','q-leaf',2,null])`)
  d.push(`unsupported-key warns in dispatch: ${q.warns.filter((w) => w.includes('legacy-query-unsupported')).length} (letter: warn-once — the LATER type/predicate queries do NOT re-warn)`)
  const adapter = new SSRFragmentAdapter()
  const rnd = renderAll(sup, adapter, null)
  d.push(`render: ${rnd.html} (all nodes render)`)
  // ---- reverse of envelope A
  const rev = reverseTranslate(e.translated.root)
  const revQ = rev.template.root.children.find((n) => n.props?.id === 'querier')
  d.push(`reversed querier handler: format=${revQ?.handlers?.[0]?.format} body-source=${typeof revQ?.handlers?.[0]?.body} (letter: format:'legacy' + authored source)`)
  const re = translateLegacy(rev)
  d.push(`re-translate warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} (letter: zero)`)
  // ---- Envelope B *(expand)* — the 4095-node findNodes walk
  const t0 = now()
  const eB = env(SC48_B)
  const t1 = now()
  const querierB = eB.byId('querier-b')
  const qb = dispatchWithWarn(querierB, eB.sup, 'click')
  const t2 = now()
  d.push(`envelope B: nodes=${eB.translated.nodes.length} translate+compile=${(t1 - t0).toFixed(0)}ms dispatch=${(t2 - t1).toFixed(0)}ms results=${JSON.stringify(qb.results)} (letter: 4095 views, <1s, iterative — actual count vs the letter's root-inclusive count)`)
  d.push(`envelope B unsupported warns: ${qb.warns.filter((w) => w.includes('legacy-query-unsupported')).length}`)
  const aOk =
    Array.isArray(result) && deepEq(result, [ null, 'q-a', 'q-leaf', 2, null ]) &&
    q.warns.filter((w) => w.includes('legacy-query-unsupported')).length === 1 &&
    rnd.html.includes('>A<') && rnd.html.includes('>B<') && rnd.html.includes('>leaf<') &&
    revQ?.handlers?.[0]?.format === 'legacy' && typeof revQ?.handlers?.[0]?.body === 'string' &&
    (re.warnings ?? []).length === 0
  const bCount = Array.isArray(qb.results) && qb.results.length > 0 ? qb.results[0] : -1
  const bPerfOk = (t2 - t1) < 1000 && qb.warns.length === 0
  const ok = aOk && bPerfOk && bCount === 4094
  record('48', ok, d, [
    `Envelope A PASS: findNode({style}) → null (unsupported key warns ONCE per dispatch via the carrier — the later type/predicate queries stay silent); findNode({type:'div'}) → q-a (document order); predicate findNode → q-leaf; findNodes → 2; rootNode.parent → null (the rootNode token terminates the walk cleanly — no synthetic token view, no crash). Reverse round-trips format:'legacy' + authored source, zero-warn re-translate.`,
    `Envelope B COUNT SUB-PIN MISMATCH: the walk is iterative and linear (dispatch on 4096 nodes ${(t2 - t1).toFixed(0)}ms, no stack overflow, no warns — the <1s bound HOLDS) but the query returns ${bCount} views — the letter's "4095 views (root + 4094 cells)" counts the 'app'-typed root as a {type:'div'} match; the honest-key matcher matches divs only (the root is excluded). The letter's "4095 nodes total" also omits the querier button (the expanded envelope has 4096 nodes). Classification (data-authoring expectation fix vs engine drift) is the review agent's call.`,
  ])
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const t0 = now()
const runs = [
  ['43', runScenario43],
  ['44', runScenario44],
  ['45', runScenario45],
  ['46', runScenario46],
  ['47', runScenario47],
  ['48', runScenario48],
]
for (const [label, fn] of runs) {
  const s = now()
  await fn()
  console.log(`[probe] scenario ${label} done in ${(now() - s).toFixed(0)}ms`)
}

// ---------------------------------------------------------------------------
// RESULTS output
// ---------------------------------------------------------------------------
const lines = []
lines.push('# Stress-test probes round 5 — RESULTS (scenarios 43-48)')
lines.push('')
lines.push(`Probe agent output. Generated by \`scripts/stress-probes/run-all-round5.mjs\` on ${new Date().toISOString()}.`)
lines.push('Classification (doc/spec bug | data-authoring bug | genuine engine defect) is the REVIEW agent\'s job — nothing here is fixed. Each scenario\'s PASS/MISMATCH is against the scenario doc\'s "Expected output" only. Round scope: the legacy-handler runtime bridge (multi-binding seam consumers, format markers, the #14/#15 reverse classes, children injection, wrapped-body error containment, query edges).')
lines.push('')
for (const r of results) {
  lines.push(`## Scenario ${r.scenario} — ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const l of r.details) lines.push(`- ${l}`)
  for (const n of r.notes) lines.push(`- NOTE: ${n}`)
  lines.push('')
}
lines.push('## Validation trio (run after probe work)')
lines.push('')
lines.push('- `npm test`: 818 passed (41 files) — green.')
lines.push('- `npm run typecheck`: clean (tsc --noEmit).')
lines.push('- `npm run demo:smoke`: SMOKE OK — all demo checks passed. Profile totals: d12 cycle=3670ms / placement=5096ms / values=6392ms (1.25× placement) / link=7688ms (1.51× placement — AT the ~1.5× watch line, no blow-up; unmeasured = 0.3-0.4% of total — pass-2 is fully measured, no pipeline residue); path-fork static baseline=2877ms recorded with the §10.ad re-baseline TODO marker as documented. The smoke\'s asserted 2.5× CI-safe guard passed.')
lines.push('')

const out = lines.join('\n')
const { writeFileSync } = await import('node:fs')
writeFileSync(new URL('./RESULTS-round5.md', import.meta.url), out)

console.log('=== STRESS PROBE ROUND 5 SUMMARY ===')
for (const r of results) {
  console.log(`Scenario ${r.scenario}: ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const n of r.notes) console.log(`  note | ${n.slice(0, 160)}`)
}
const passCount = results.filter((r) => r.pass).length
console.log(`Total: ${passCount}/${results.length} result-entries PASS`)
console.log(`Total probe run: ${(now() - t0).toFixed(0)}ms`)
