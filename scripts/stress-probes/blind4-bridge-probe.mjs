// Blind test #4 — the LEGACY-HANDLER BRIDGE (AGENTS.md item 10, page-reviewer
// role). Core-only probe: dist/core/* + the placeholderLanding legacy envelope.
//
// Pipeline: translate → register → per-node compilePath bootstrap (the demo
// pipeline — materializes seam layers for def-internal consumers) → dispatch
// the 6 defs through the bridge → verify the WRITER claims vs the real
// envelope behavior.
import { readFileSync } from 'node:fs'
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { dispatchEvent } from '../../dist/core/handlers.js'
import { mintedByOrigin } from '../../dist/core/registry.js'
import { getNodeView } from '../../dist/core/legacy-handlers.js'

const env = JSON.parse(readFileSync(new URL('../../live-prod/placeholderLanding/placeholderLanding.json', import.meta.url), 'utf8'))
const flush = () => new Promise((r) => setTimeout(r, 0))
let pass = 0
let fail = 0
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log(`  PASS ${name}${detail ? ` — ${detail}` : ''}`) }
  else { fail += 1; console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`) }
}
const warns = []
const realWarn = console.warn
const realLog = console.log
console.warn = (m) => { warns.push(typeof m === 'string' ? m : String(m)) }

// ---- 1. translate the REAL envelope ----------------------------------------
let t
console.log = () => {}
t = translateLegacy(env)
console.log = realLog
console.log('--- translate of the REAL placeholderLanding envelope ---')
console.log(`  warnings: ${JSON.stringify(t.warnings.map((w) => w.code))}`)
ok('envelope translates without legacy-envelope-mismatch', !!t.root)

// ---- 2. compile (per-node compilePath bootstrap — the demo pipeline) --------
const sup = new Supervisor({ events: new EventBridge() })
for (const n of t.nodes) sup.registerNode(n)
for (const n of t.nodes) n.compilePath()
console.log('\n--- seam materialization ---')
const signIn = t.nodes.find((n) => n.content === 'Sign In / Profile')
const logoutBtn = t.nodes.find((n) => n.content === 'Logout')
const showBtn = t.nodes.find((n) => n.content === 'Show Comments')
const seamLayerNames = (n) => (n?.layers ?? []).filter((l) => l.handlers).map((l) => l.handlers.map((h) => `${h.name}:${h.event}`).join(',')).join(' | ')
console.log(`  Sign In layers: ${seamLayerNames(signIn)}`)
console.log(`  Logout layers: ${seamLayerNames(logoutBtn)}`)
console.log(`  Show Comments layers: ${seamLayerNames(showBtn)}`)

// ---- 3. wrapper arg order + event stub (unit surfaces) ----------------------
console.log('\n--- wrapper + event stub + format marker ---')
const svc = { clientAPI: sup.clientAPI, supervisor: sup, tree: sup.handlerContext.tree }
{
  const view = getNodeView(signIn, svc)
  ok('NodeView identity: same view across reads (WeakMap)', getNodeView(signIn, svc) === view)
  const t2 = translateLegacy({
    template: {
      root: {
        type: 'app',
        component: [{ reference: 'cb', value: { name: 'cb', body: '(event, context) => [event.type, event.isTrusted, typeof event.preventDefault, typeof event.stopPropagation, typeof event.target.receiveNextState, event.value]' } }],
        children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
      },
    },
    content: [],
  })
  const sup2 = new Supervisor({ events: new EventBridge() })
  for (const n of t2.nodes) sup2.registerNode(n)
  t2.root.compile(t2.nodes)
  const r = dispatchEvent(t2.root.children[0], sup2.handlerContext, 'click', 'v')[0]
  ok('wrapper restores legacy (event, context) order; stub members present', JSON.stringify(r) === JSON.stringify(['click', false, 'function', 'function', 'function', 'v']), JSON.stringify(r))
  const r2 = dispatchEvent(t2.root.children[0], sup2.handlerContext, 'click')[0]
  ok('stub.value ABSENT when dispatch carries no args', Array.isArray(r2) && r2[5] === undefined)
  const t3 = translateLegacy({
    template: {
      root: {
        type: 'app',
        component: [{ reference: 'm', value: { name: 'm', format: 'modern', body: '(ctx, ...args) => ctx.node.type + ":" + String(args[0])' } }],
        children: [{ type: 'button', component: [{ reference: 'm', target: 'handlers.click' }] }],
      },
    },
    content: [],
  })
  const sup3 = new Supervisor({ events: new EventBridge() })
  for (const n of t3.nodes) sup3.registerNode(n)
  t3.root.compile(t3.nodes)
  ok('format marker: explicit modern → installed RAW ((ctx, ...args))', String(dispatchEvent(t3.root.children[0], sup3.handlerContext, 'click', 'v')[0]) === 'button:v')
}

// ---- 4. def-internal consumers: materialization + writes --------------------
console.log('\n--- def-internal consumers (the auth UI inside the userAuthComponent def) ---')
ok('ToggleUserDropdown layer materialized (compilePath pipeline)', seamLayerNames(signIn).includes('ToggleUserDropdown:click'), seamLayerNames(signIn))
ok('LogoutHandler layer materialized (compilePath pipeline)', seamLayerNames(logoutBtn).includes('LogoutHandler:click'), seamLayerNames(logoutBtn))
const dropdown = t.nodes.find((n) => (n.css?.classes ?? []).includes('dropdown-menu'))
console.log(`  dropdown state: ${dropdown.state} (prototype ⇒ out-of-tree def child)`)
const styleBefore = dropdown.css.style
console.log(`  dropdown initial css.style: ${JSON.stringify(styleBefore)}`)
const jBefore = sup.journal.length
const toggleResults = dispatchEvent(signIn, sup.handlerContext, 'click')
const newJournal = sup.journal.slice(jBefore)
ok('ToggleUserDropdown body RAN (no throw; wrapper fired)', toggleResults.length === 1)
ok('ToggleUserDropdown css write LANDED on the dropdown (real envelope)', dropdown.css.style === 'display: block;', `got ${JSON.stringify(dropdown.css.style)}; journal=${newJournal.map((j) => j.op.kind).join(',')}`)

// ---- 5. LogoutHandler (verbatim) ---------------------------------------------
console.log('\n--- LogoutHandler: fetch + location ---')
const fetchCalls = []
const realFetch = globalThis.fetch
globalThis.fetch = (url, opts) => { fetchCalls.push([url, opts]); return Promise.reject(new Error('offline')) }
globalThis.window = { location: { href: '' } }
dispatchEvent(logoutBtn, sup.handlerContext, 'click')
await flush()
ok('LogoutHandler fetch POST /api/logout', JSON.stringify(fetchCalls[0]) === JSON.stringify(['/api/logout', { method: 'POST' }]))
ok('LogoutHandler redirects on failure', globalThis.window.location.href === '/api/oauth/logout')

// ---- 6. Show Comments button: TWO seam bindings (onLoad + click) --------------
console.log('\n--- Show Comments button: onLoad + click bindings ---')
const jBefore2 = sup.journal.length
globalThis.window = {} // no Preempt
const onLoadResults = dispatchEvent(showBtn, sup.handlerContext, 'onLoad')
ok('toggleCommentsButton dispatch on onLoad returns (no crash)', onLoadResults.length <= 1)
ok('toggleCommentsButton: window-guard early return (no journal)', sup.journal.length === jBefore2)
const showBtnStyleBefore = showBtn.css.style
globalThis.window = { Preempt: { contentData: { props: { commentsAllowed: false } } } }
dispatchEvent(showBtn, sup.handlerContext, 'onLoad')
ok('toggleCommentsButton: comments disallowed → css write lands', showBtn.css.style.includes('display: none'), JSON.stringify(showBtn.css.style.slice(-40)))
const showBtnStyleBackup = showBtn.css.style
// showComments (click): css write on the button + children injection
const jBefore3 = sup.journal.length
const kidsBefore = showBtn.parent.children.length
dispatchEvent(showBtn, sup.handlerContext, 'click')
const layerApplyOps = sup.journal.slice(jBefore3).filter((j) => j.op.kind === 'layer-apply')
ok('showComments: ONE layer-apply journaled for the children write', layerApplyOps.length === 1)
const la = layerApplyOps[0]?.op
ok('showComments: deterministic layerId legacy-kids-<container>', la?.layerId === `legacy-kids-${showBtn.parent.id}`, String(la?.layerId))
ok('showComments: minted children appended (existing spread + 1 = 3 minted)', showBtn.parent.children.length === kidsBefore + 3, `before=${kidsBefore} after=${showBtn.parent.children.length}`)
const minted = showBtn.parent.children.filter((c) => c.originLayer)
ok('showComments: minted nodes originLayer-marked + registered', minted.length === 3 && minted.every((c) => c.originLayer === `legacy-kids-${showBtn.parent.id}` && mintedByOrigin(`legacy-kids-${showBtn.parent.id}`).includes(c.id)))
ok('showComments: commentsContainer minted with props.name', minted.some((c) => c.props && c.props.name === 'commentsContainer'))
// idempotent re-inject
dispatchEvent(showBtn, sup.handlerContext, 'click')
ok('showComments: re-injection idempotent (no duplicate mint)', showBtn.parent.children.length === kidsBefore + 3)
// teardown
const mintedRefs = minted
showBtn.parent.removeLayer(`legacy-kids-${showBtn.parent.id}`)
for (let i = 0; i < 10; i += 1) await flush()
ok('showComments: teardown on layer removal (minted nodes destroyed)', mintedRefs.every((c) => c.destroyed === true))
ok('showComments: css write on the button landed', showBtn.css.style.includes('display: none'), JSON.stringify(showBtn.css.style.slice(-30)))

// ---- 7. enterEditMode: preventDefault + fetch path (data-fixed binding) -------
console.log('\n--- enterEditMode (data-fixed consumer; the envelope binds none) ---')
ok('REAL envelope: enterEditMode has NO consumer binding (not reachable via the bridge)', !t.nodes.some((n) => n.anchors.some((a) => a.options.handlerEvent !== undefined && n !== showBtn && n !== signIn && n !== logoutBtn)))
const env2 = JSON.parse(JSON.stringify(env))
const findNode = (d, pred) => {
  if (pred(d)) return d
  if (Array.isArray(d.children)) for (const c of d.children) { const r = findNode(c, pred); if (r) return r }
  return undefined
}
// bind enterEditMode on the wrapper div around the Show Comments button
// (the click target is already taken by showComments — bind on the parent)
const wrapperData = findNode(env2.template.root, (d) => d.type === 'div' && Array.isArray(d.children) && d.children.some((c) => c.type === 'button' && c.content === 'Show Comments'))
wrapperData.component = wrapperData.component ?? []
wrapperData.component.push({ reference: 'enterEditMode', target: 'handlers.click' })
const t4 = translateLegacy(env2)
const sup4 = new Supervisor({ events: new EventBridge() })
for (const n of t4.nodes) sup4.registerNode(n)
for (const n of t4.nodes) n.compilePath()
const editBtn = t4.nodes.find((n) => n.anchors.some((a) => a.options.handlerEvent === 'click' && a.target === 'enterEditMode'))
const fetchCalls2 = []
globalThis.fetch = (url) => { fetchCalls2.push(url); return Promise.resolve({ ok: true, json: async () => [] }) }
globalThis.window = {}
dispatchEvent(editBtn, sup4.handlerContext, 'click')
await flush()
ok('enterEditMode: fetch path ran (stubbed)', fetchCalls2.includes('/api/content?tags=editor-tools'), JSON.stringify(fetchCalls2))

// ---- 8. AuthInitHandler: afterAssembly is N5-skipped; data-fix to handlers.load
console.log('\n--- AuthInitHandler (afterAssembly → N5 skip; data-fixed to handlers.load) ---')
ok('REAL envelope: the AuthInitHandler binding target afterAssembly is a legacy lifecycle name', env.template.root.component.find((c) => c.reference === 'userAuthComponent')?.value?.component?.some((b) => b.target === 'handlers.afterAssembly') === true)
const env3 = JSON.parse(JSON.stringify(env))
const userAuth = env3.template.root.component.find((c) => c.reference === 'userAuthComponent')
for (const b of userAuth.value.component) if (b.target === 'handlers.afterAssembly') b.target = 'handlers.load'
const t5 = translateLegacy(env3)
const sup5 = new Supervisor({ events: new EventBridge() })
for (const n of t5.nodes) sup5.registerNode(n)
for (const n of t5.nodes) n.compilePath()
const authC = t5.nodes.find((n) => (n.css?.classes ?? []).includes('user-auth-dropdown'))
const authBtn = authC.children[0]
const authKidsBefore = authC.children.length
ok('AuthInitHandler: seam layer materialized on the auth container (data-fixed)', seamLayerNames(authC).includes('AuthInitHandler:load'), seamLayerNames(authC))
dispatchEvent(authC, sup5.handlerContext, 'load')
ok('AuthInitHandler: userData read (falsy) → Sign-In branch: children[0] becomes <a> with content+props', authBtn.type === 'a' && authBtn.content === 'Sign In' && authBtn.props.href === '/api/oauth/login', `type=${authBtn.type} content=${authBtn.content}`)
ok('AuthInitHandler: targetComponents.delete is a GRAPH NO-OP', authBtn.anchors.some((a) => a.role === 'target' && a.target === 'ToggleUserDropdown'))
ok('AuthInitHandler: children.pop() is a GRAPH NO-OP', authC.children.length === authKidsBefore)

// ---- 9. QueryUtils honest/unsupported -----------------------------------------
console.log('\n--- QueryUtils ---')
const qw = []
const ow2 = console.warn
console.warn = (m) => { qw.push(typeof m === 'string' ? m : String(m)) }
const t6 = translateLegacy({
  template: {
    root: {
      type: 'app',
      component: [{ reference: 'q', value: { name: 'q', body: `(event, context) => {
        const v = context.node;
        return [
          v.findNode({ classes: ['dropdown-menu'] })?.type ?? null,
          v.findNode({ style: { display: 'none' } }) ?? 'unsupported-style',
          v.findNode({ handlers: ['click'] }) ?? 'unsupported-handlers',
          v.findNode({ components: ['x'] }) ?? 'unsupported-components',
        ];
      }` } }],
      children: [{ type: 'div', css: { classes: ['user-auth-dropdown'] }, component: [{ reference: 'q', target: 'handlers.click' }], children: [{ type: 'div', css: { classes: ['dropdown-menu'] } }] }],
    },
  },
  content: [],
})
const sup6 = new Supervisor({ events: new EventBridge() })
for (const n of t6.nodes) sup6.registerNode(n)
t6.root.compile(t6.nodes)
const qres = dispatchEvent(t6.root.children[0], sup6.handlerContext, 'click')
const q = qres[0]
ok('honest key classes matches', q[0] === 'div', JSON.stringify(q[0]))
ok('style key → unsupported (no match, no throw)', q[1] === 'unsupported-style', JSON.stringify(q[1]))
ok('handlers key → unsupported', q[2] === 'unsupported-handlers', JSON.stringify(q[2]))
ok('components key → unsupported', q[3] === 'unsupported-components', JSON.stringify(q[3]))
ok('legacy-query-unsupported warn fired (once)', qw.filter((m) => m.includes('legacy-query-unsupported')).length === 1)
console.warn = ow2

// ---- 10. reverse after compile: no double-emit contract ------------------------
console.log('\n--- reverse after compile ---')
const rev = reverseTranslate(t.root)
const walk = (d, path, cb) => {
  cb(d, path)
  if (Array.isArray(d.children)) d.children.forEach((c, i) => walk(c, path + '/' + i, cb))
}
let inlineCount = 0
let bindingCount = 0
walk(rev.template.root, 'root', (d) => {
  if (d.handlers) inlineCount += 1
  const comp = Array.isArray(d.component) ? d.component : d.component ? [d.component] : []
  for (const b of comp) if (typeof b.target === 'string' && b.target.startsWith('handlers.')) bindingCount += 1
})
console.log(`  consumers with INLINE handlers after reverse: ${inlineCount}; handler bindings: ${bindingCount}`)
ok('reverse: NO consumer double-emits (inline seam layer + binding)', inlineCount === 0, `inline=${inlineCount}`)
ok('reverse: bindings emitted for every seam consumer', bindingCount >= 4, `bindings=${bindingCount}`)
const t7 = translateLegacy(rev)
ok('re-translate of the reversed doc: zero warns', t7.warnings.length === 0, JSON.stringify(t7.warnings.map((w) => w.code)))

console.warn = realWarn
globalThis.fetch = realFetch
console.log(`\n==== blind4-bridge probe: ${pass} passed, ${fail} failed ====`)
process.exit(fail === 0 ? 0 : 1)
