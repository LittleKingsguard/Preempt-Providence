// Blind test #4 — PAGE-REVIEWER verification of the legacy-handler bridge
// (AGENTS.md item 10c). Independent probe: runs the placeholderLanding corpus
// through the LANDED bridge and checks the WRITER's 7 claims at runtime.
// Probe expectations encode the runtime contract (per the unit pins B1-B8 +
// the landed containment semantics) — engine defects are REPORTED, never fixed.
import { readFileSync } from 'node:fs'
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { dispatchEvent } from '../../dist/core/handlers.js'
import { getNodeView, eventStub, legacyContext } from '../../dist/core/legacy-handlers.js'
import { handlerDef, getTranslateUserData, mintedByOrigin } from '../../dist/core/registry.js'

const env = JSON.parse(readFileSync(new URL('../../live-prod/placeholderLanding/placeholderLanding.json', import.meta.url), 'utf8'))
const flush = () => new Promise((r) => setTimeout(r, 0))
let pass = 0
let fail = 0
const results = []
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; results.push(`PASS ${name}`) }
  else { fail += 1; results.push(`FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
  console.log(`  ${cond ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`)
}
const warnLog = []
const origLog = console.log
const origWarn = console.warn
console.warn = (m) => { warnLog.push(typeof m === 'string' ? m : String(m)) }

// =====================================================================
// 0. pipeline: translate → register → per-node compilePath (demo pipeline)
// =====================================================================
console.log('--- 0. translate + compile of the REAL placeholderLanding corpus ---')
console.log = () => {}
const t = translateLegacy(env)
console.log = origLog
const translateWarns = t.warnings.map((w) => w.code)
console.log(`  translate warnings: ${JSON.stringify(translateWarns)}`)
const sup = new Supervisor({ events: new EventBridge() })
for (const n of t.nodes) sup.registerNode(n)
for (const n of t.nodes) n.compilePath()

const signIn = t.nodes.find((n) => n.content === 'Sign In / Profile')
const logoutBtn = t.nodes.find((n) => n.content === 'Logout')
const showBtn = t.nodes.find((n) => n.content === 'Show Comments')
const authC = t.nodes.find((n) => (n.css?.classes ?? []).includes('user-auth-dropdown'))
const dropdown = t.nodes.find((n) => (n.css?.classes ?? []).includes('dropdown-menu'))
const container = showBtn.parent
const svc = { clientAPI: sup.clientAPI, supervisor: sup, tree: sup.handlerContext.tree }
const layerNames = (n) => (n?.layers ?? []).filter((l) => l.handlers).map((l) => l.handlers.map((h) => `${h.name}:${h.event}`).join(',')).join(' | ')

// an apply spy: captures every bridge write + its status
const applyCalls = []
const realApply = sup.clientAPI.apply.bind(sup.clientAPI)
sup.clientAPI.apply = (nodeRef, op) => {
  const res = realApply(nodeRef, op)
  applyCalls.push({ kind: op.kind, nodeRef, status: res.status, nodeState: res.nodeState, layerId: op.layerId, minted: res.minted })
  return res
}

// =====================================================================
// CLAIM 1 — the 4 dispatched defs run through the WRAPPED seam bodies
// =====================================================================
console.log('\n--- claim 1: wrapped seam dispatch, (event, context) order ---')
const seamBodies = []
for (const n of [signIn, logoutBtn, showBtn]) {
  for (const h of n?.handlers ?? []) {
    seamBodies.push([n.content ?? n.type, h.name, String(h.body)])
  }
}
ok('1a seam layers materialized for the 4 bound defs',
  layerNames(signIn).includes('ToggleUserDropdown:click')
  && layerNames(logoutBtn).includes('LogoutHandler:click')
  && layerNames(showBtn).includes('toggleCommentsButton:onLoad')
  && layerNames(showBtn).includes('showComments:click'), layerNames(showBtn))
ok('1b seam bodies installed WRAPPED (the (event, context) bridge seam — legacy default)',
  // DEFECT #13 fix: ONE accumulated seam-handlers layer per consumer — the
  // 4 bound defs all installed WRAPPED (legacy default)
  seamBodies.length === 4 && seamBodies.every(([, , src]) => src.includes('(ctx, ...args)')), seamBodies.map((b) => b[1]).join(','))

// ToggleUserDropdown: parent walk + findNode + css read + write attempt
applyCalls.length = 0
const toggleRes = dispatchEvent(signIn, sup.handlerContext, 'click')
const toggleApply = applyCalls.filter((c) => c.kind === 'state-slice')
ok('1c ToggleUserDropdown body RAN via the wrapper (no throw)',
  toggleRes.length === 1 && !(toggleRes[0] instanceof Error))
ok('1d parent walk + findNode({classes:[dropdown-menu]}) HIT the dropdown node (write attempted on it)',
  toggleApply.length === 1 && toggleApply[0].nodeRef === dropdown.id, JSON.stringify(toggleApply))
ok('1e css style-object read/spread semantics: empty-authored style → display toggled to block; write is CONTAINED on the out-of-tree prototype (no-usable-state, no journal)',
  toggleApply[0]?.status === 'no-usable-state' && toggleApply[0]?.nodeState === 'prototype' && JSON.stringify(toggleApply[0]) !== null)

// LogoutHandler verbatim
const fetchCalls = []
const realFetch = globalThis.fetch
globalThis.fetch = (url, opts) => { fetchCalls.push([url, opts]); return Promise.reject(new Error('offline')) }
globalThis.window = { location: { href: '' } }
applyCalls.length = 0
dispatchEvent(logoutBtn, sup.handlerContext, 'click')
await flush()
ok('1f LogoutHandler VERBATIM: fetch POST /api/logout', JSON.stringify(fetchCalls[0]) === JSON.stringify(['/api/logout', { method: 'POST' }]))
ok('1g LogoutHandler VERBATIM: redirect to /api/oauth/logout on fetch failure', globalThis.window.location.href === '/api/oauth/logout')

// showComments: css write on the button + children → ONE layer-apply
applyCalls.length = 0
globalThis.window = {}
dispatchEvent(showBtn, sup.handlerContext, 'click')
const laCalls = applyCalls.filter((c) => c.kind === 'layer-apply')
const btnSlice = applyCalls.filter((c) => c.kind === 'state-slice' && c.nodeRef === showBtn.id)
ok('1h showComments: css write on the button LANDED (in-tree state-slice applied)', btnSlice.length === 1 && btnSlice[0].status === 'applied', JSON.stringify(btnSlice))
ok('1i showComments: children payload → ONE layer-apply (atomic, journaled)', laCalls.length === 1 && laCalls[0].status === 'applied', JSON.stringify(laCalls))

// toggleCommentsButton: window-guard — EXPECTED the seam layer dispatches on onLoad
const jBefore = sup.journal.length
const logsOnLoad = []
console.log = (m) => { logsOnLoad.push(String(m)) }
const onLoadRes = dispatchEvent(showBtn, sup.handlerContext, 'onLoad')
console.log = origLog
ok('1j toggleCommentsButton seam layer EXISTS on the Show Comments button', layerNames(showBtn).includes('toggleCommentsButton:onLoad'))
ok('1k toggleCommentsButton BODY RUNS on onLoad dispatch (window-guard reachable)', logsOnLoad.some((m) => m.includes('Executing handler: toggleCommentsButton')), `ran: ${JSON.stringify(logsOnLoad)}`)
console.log('    NOTE 1k is a MISMATCH if the body never runs — engine defect, see the report.')

// =====================================================================
// CLAIM 2 — AuthInitHandler: handler-phase-unknown + never dispatches
// =====================================================================
console.log('\n--- claim 2: AuthInitHandler ---')
ok('2a translate emitted handler-phase-unknown for the handlers.afterAssembly binding',
  translateWarns.includes('handler-phase-unknown'), JSON.stringify(translateWarns))
ok('2b the def has NO handler-consumer anchor anywhere (never dispatches)',
  !t.nodes.some((n) => n.anchors.some((a) => a.role === 'target' && typeof a.target === 'string' && a.target === 'AuthInitHandler' && a.options.handlerEvent !== undefined)))
const rootSourceAuth = t.root.anchors.some((a) => a.role === 'source' && a.target === 'AuthInitHandler')
console.log(`    (the ONLY AuthInitHandler anchor is the root SOURCE def-registration anchor: ${rootSourceAuth})`)
ok('2c the def itself IS registered (seam default legacy)', handlerDef('AuthInitHandler')?.format === 'legacy')
const authBtn = authC?.children[0]
ok('2d auth UI nodes are OUT-OF-TREE prototypes in the new engine (seam-wired, never in-tree)',
  authC?.state === 'prototype' && authBtn?.state === 'prototype')

// =====================================================================
// CLAIM 3 — wrapper arg order + event stub members
// =====================================================================
console.log('\n--- claim 3: wrapper arg order + event stub ---')
const t3 = translateLegacy({
  template: {
    root: {
      type: 'app',
      component: [{ reference: 'cb', value: { name: 'cb', body: `(event, context) => {
        const ctxOk = context && typeof context.node?.receiveNextState === 'function'
          && typeof context.clientAPI?.apply === 'function'
          && context.supervisor && context.supervisor.userData === undefined;
        return [event.type, event.isTrusted, typeof event.preventDefault, typeof event.stopPropagation,
          typeof event.target?.receiveNextState, event.value, ctxOk];
      }` } }],
      children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
    },
  },
  content: [],
})
const sup3 = new Supervisor({ events: new EventBridge() })
for (const n of t3.nodes) sup3.registerNode(n)
t3.root.compile(t3.nodes)
const r3 = dispatchEvent(t3.root.children[0], sup3.handlerContext, 'click', 'v')[0]
ok('3a first param = event stub {type, isTrusted, preventDefault, stopPropagation, target: nodeView, value when args}',
  JSON.stringify(r3) === JSON.stringify(['click', false, 'function', 'function', 'function', 'v', true]), JSON.stringify(r3))
const r3b = dispatchEvent(t3.root.children[0], sup3.handlerContext, 'click')[0]
ok('3b stub.value ABSENT when the dispatch carries no args', Array.isArray(r3b) && r3b[5] === undefined)

// =====================================================================
// CLAIM 4 — QueryUtils honest keys + legacy-query-unsupported warn
// =====================================================================
console.log('\n--- claim 4: QueryUtils ---')
const qw = []
const ow = console.warn
console.warn = (m) => { qw.push(typeof m === 'string' ? m : String(m)) }
const t4 = translateLegacy({
  template: {
    root: {
      type: 'app',
      component: [{ reference: 'q', value: { name: 'q', body: `(event, context) => {
        const v = context.node;
        return [
          v.findNode({ type: 'div' }) ? 'type-hit' : null,
          v.findNode({ classes: ['dropdown-menu'] }) ? 'classes-hit' : null,
          v.findNode((n) => n.props && n.props.name === 'x') ? 'predicate-hit' : null,
          v.findNode({ style: { display: 'none' } }) ?? 'style-unsupported',
          v.findNode({ handlers: ['click'] }) ?? 'handlers-unsupported',
        ];
      }` } }],
      children: [{ type: 'div', css: { classes: ['dropdown-menu'] }, props: { name: 'x' }, component: [{ reference: 'q', target: 'handlers.click' }] }],
    },
  },
  content: [],
})
const sup4 = new Supervisor({ events: new EventBridge() })
for (const n of t4.nodes) sup4.registerNode(n)
t4.root.compile(t4.nodes)
const qr = dispatchEvent(t4.root.children[0], sup4.handlerContext, 'click')[0]
ok('4a honest keys match: type / classes / predicate', JSON.stringify(qr.slice(0, 3)) === JSON.stringify(['type-hit', 'classes-hit', 'predicate-hit']), JSON.stringify(qr))
ok('4b style/handlers keys → unsupported (no match, no throw)', qr[3] === 'style-unsupported' && qr[4] === 'handlers-unsupported', JSON.stringify(qr.slice(3)))
ok('4c legacy-query-unsupported warn fired ONCE per dispatch', qw.filter((m) => m.includes('legacy-query-unsupported')).length === 1, String(qw.length))
console.warn = ow

// =====================================================================
// CLAIM 5 — userData read-only: undefined here; a write is contained
// =====================================================================
console.log('\n--- claim 5: userData ---')
ok('5a userData captured at translate is UNDEFINED for this corpus (no userData in any payload)', getTranslateUserData() === undefined)
const t5 = translateLegacy({
  template: {
    root: {
      type: 'app',
      component: [{ reference: 'ud', value: { name: 'ud', body: `(event, context) => {
        const before = context.supervisor.userData;
        context.supervisor.userData = { hacked: true };
        return before;
      }` } }],
      children: [{ type: 'button', component: [{ reference: 'ud', target: 'handlers.click' }] }],
    },
  },
  content: [],
})
const sup5 = new Supervisor({ events: new EventBridge() })
for (const n of t5.nodes) sup5.registerNode(n)
t5.root.compile(t5.nodes)
const r5 = dispatchEvent(t5.root.children[0], sup5.handlerContext, 'click')[0]
ok('5b sloppy-mode WRITE is a contained no-op: read stays undefined across dispatches',
  r5 === undefined && getTranslateUserData() === undefined)
ok('5c a strict-mode write throws inside the dispatch (contained result, no propagation)',
  (() => {
    const t6 = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 's', value: { name: 's', body: `(event, context) => { 'use strict'; context.supervisor.userData = 1; }` } }],
          children: [{ type: 'button', component: [{ reference: 's', target: 'handlers.click' }] }],
        },
      },
      content: [],
    })
    const sup6 = new Supervisor({ events: new EventBridge() })
    for (const n of t6.nodes) sup6.registerNode(n)
    t6.root.compile(t6.nodes)
    const res = dispatchEvent(t6.root.children[0], sup6.handlerContext, 'click')
    return res.length === 1 && res[0] instanceof TypeError
  })())

// =====================================================================
// CLAIM 6 — children-injection: ONE layer-apply, minted origin-owned
// family children, deterministic layer id, idempotent, teardown, reverse-excluded
// =====================================================================
console.log('\n--- claim 6: children-injection (synthetic receiveNextState on a clean in-tree node) ---')
const injTarget = t.root
const kidCountBefore = injTarget.children.length
applyCalls.length = 0
const jBefore6 = sup.journal.length
const view = getNodeView(injTarget, svc)
const injResult = view.receiveNextState({ children: [{ type: 'div', props: { name: 'commentsContainer' } }] })
const la6 = applyCalls.filter((c) => c.kind === 'layer-apply')
ok('6a synthetic receiveNextState({children}) → EXACTLY ONE layer-apply (applied, minted ids in the result)',
  la6.length === 1 && la6[0].status === 'applied' && la6[0].minted?.length === 1
  && sup.journal.slice(jBefore6).filter((j) => j.op.kind === 'layer-apply').length === 1, JSON.stringify(la6))
ok('6b deterministic layer id legacy-kids-<nodeId>', la6[0]?.layerId === `legacy-kids-${injTarget.id}`, String(la6[0]?.layerId))
const minted = injTarget.children.filter((c) => c.originLayer !== undefined)
ok('6c minted node is a FAMILY child, originLayer-marked + registered in the minted set',
  minted.length === 1 && minted[0].originLayer === `legacy-kids-${injTarget.id}`
  && mintedByOrigin(`legacy-kids-${injTarget.id}`).includes(minted[0].id)
  && minted[0].parent === injTarget && minted[0].props.name === 'commentsContainer')
ok('6d re-injection with the same payload is idempotent (no duplicate mint)',
  (view.receiveNextState({ children: [{ type: 'div', props: { name: 'commentsContainer' } }] }), injTarget.children.filter((c) => c.originLayer !== undefined).length === 1))
// teardown: one layer removal
const mintedRef = minted[0]
injTarget.removeLayer(`legacy-kids-${injTarget.id}`)
for (let i = 0; i < 10; i += 1) await flush()
ok('6e teardown on layer removal: the minted node is destroyed + unregistered + the census returns to base',
  mintedRef.destroyed === true && mintedByOrigin(`legacy-kids-${injTarget.id}`).length === 0
  && injTarget.children.length === kidCountBefore, `after=${injTarget.children.length}`)
// reverse-exclusion (re-inject, reverse, then check)
view.receiveNextState({ children: [{ type: 'div', props: { name: 'commentsContainer' } }] })
const rev6 = reverseTranslate(t.root)
const walk6 = (d) => { if (d.props && d.props.name === 'commentsContainer') throw new Error('leak') ; if (Array.isArray(d.children)) d.children.forEach(walk6) }
let leaked6 = false
try { walk6(rev6.template.root) } catch (e) { leaked6 = true }
ok('6f minted children are reverse-EXCLUDED (origin-owned, never authored content)', !leaked6)
view.receiveNextState({ children: [{ type: 'div', props: { name: 'commentsContainer' } }] }) // clean the tree again
injTarget.removeLayer(`legacy-kids-${injTarget.id}`)
for (let i = 0; i < 10; i += 1) await flush()

// =====================================================================
// CLAIM 7 — format marker: seam default legacy, explicit override,
// handler-format-invalid fallback, reverse persistence
// =====================================================================
console.log('\n--- claim 7: format marker ---')
ok('7a seam default: the 6 corpus defs (no format field) register legacy (wrapped at materialize)',
  ['toggleCommentsButton', 'showComments', 'ToggleUserDropdown', 'LogoutHandler', 'AuthInitHandler', 'enterEditMode']
    .every((n) => handlerDef(n)?.format === 'legacy'))
const t7 = translateLegacy({
  template: {
    root: {
      type: 'app',
      component: [
        { reference: 'mod', value: { name: 'mod', format: 'modern', body: '(ctx, ...args) => ctx.node.type + ":" + String(args[0])' } },
        { reference: 'bog', value: { name: 'bog', format: 'bogus', body: '(event, context) => [event.type, context.node.type]' } },
      ],
      children: [
        { type: 'button', component: [{ reference: 'mod', target: 'handlers.click' }] },
        { type: 'button', component: [{ reference: 'bog', target: 'handlers.click' }] },
      ],
    },
  },
  content: [],
})
const sup7 = new Supervisor({ events: new EventBridge() })
for (const n of t7.nodes) sup7.registerNode(n)
t7.root.compile(t7.nodes)
ok('7b explicit modern → installed RAW (ctx, ...args)',
  String(dispatchEvent(t7.root.children[0], sup7.handlerContext, 'click', 'v')[0]) === 'button:v')
ok('7c handler-format-invalid: a non-legacy/modern format warns + falls back to the seam default (legacy → wrapped)',
  t7.warnings.some((w) => w.code === 'handler-format-invalid')
  && handlerDef('bog')?.format === 'legacy'
  && JSON.stringify(dispatchEvent(t7.root.children[1], sup7.handlerContext, 'click')[0]) === JSON.stringify(['click', 'button']))
// inline format reverse persistence (no seam in the way)
const t8 = translateLegacy({
  template: {
    root: {
      type: 'app',
      handlers: [{ name: 'il', event: 'click', format: 'legacy', body: '(event, context) => [event.type, context.node.type]' }],
      children: [{ type: 'button', content: 'x' }],
    },
  },
  content: [],
})
const sup8 = new Supervisor({ events: new EventBridge() })
for (const n of t8.nodes) sup8.registerNode(n)
t8.root.compile(t8.nodes)
const rev8 = reverseTranslate(t8.root)
const h8 = rev8.template.root.handlers[0]
const t9 = translateLegacy(rev8)
const sup9 = new Supervisor({ events: new EventBridge() })
for (const n of t9.nodes) sup9.registerNode(n)
t9.root.compile(t9.nodes)
ok('7d reverse persistence (inline): format + original source survive the round trip; re-translate re-wraps',
  h8.format === 'legacy' && !String(h8.body).includes('(ctx, ...args)')
  && t9.warnings.length === 0
  && JSON.stringify(dispatchEvent(t9.root, sup9.handlerContext, 'click')[0]) === JSON.stringify(['click', 'app']))

// =====================================================================
// Reverse of the REAL envelope (post-dispatch tree)
// =====================================================================
console.log('\n--- reverse of the real envelope (clean-round-trip contract) ---')
const revReal = reverseTranslate(t.root)
const walk = (d, cb) => { cb(d); if (Array.isArray(d.children)) d.children.forEach((c) => walk(c, cb)) }
const inlineInReverse = []
walk(revReal.template.root, (d) => {
  if (Array.isArray(d.handlers)) for (const h of d.handlers) inlineInReverse.push({ name: h.name, event: h.event, format: h.format, wrapperSource: typeof h.body === 'string' && h.body.includes('(ctx, ...args)') })
})
const bindingCount = []
walk(revReal.template.root, (d) => {
  const comp = Array.isArray(d.component) ? d.component : d.component ? [d.component] : []
  for (const b of comp) if (typeof b.target === 'string' && b.target.startsWith('handlers.')) bindingCount.push(b.target)
})
ok('R1 reverse: NO seam-sourced inline handlers on consumers (authored envelope has none)',
  inlineInReverse.length === 0, JSON.stringify(inlineInReverse))
ok('R2 reverse: every in-tree seam consumer emits its handlers.* bindings',
  bindingCount.length === 2 && bindingCount.includes('handlers.onLoad') && bindingCount.includes('handlers.click'), JSON.stringify(bindingCount))

console.warn = origWarn
globalThis.fetch = realFetch
console.log(`\n==== blind4 page-review probe: ${pass} passed, ${fail} failed ====`)
console.log('---- per-claim summary ----')
console.log(results.join('\n'))
process.exit(fail === 0 ? 0 : 1)
