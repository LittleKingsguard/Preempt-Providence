/**
 * Feature showcase — DATA-DRIVEN page + data envelope module.
 *
 * One module, two roles:
 *
 *  1. DATA (`showcaseLegacyData()`): a LEGACY envelope (`LegacyInitialData`,
 *     docs/specs/translate.md §1) that demonstrates the framework's advertised
 *     features BOTH in isolation (feature-lab section) and in one combined set
 *     (ops-dashboard section). The ONLY "code" in the envelope is JSON:
 *       - handler bodies ship as function-source STRINGS, instantiated into
 *         live functions at translate (translate.md §2 "STRING body →
 *         instantiated"); ~no page-side logic is needed for any feature.
 *       - every component/placement/derived rule rides in the data.
 *
 *  2. PAGE (browser): CORE-ONLY imports (dist/core/*) — translateLegacy →
 *     Supervisor → createClient → DomAdapter + emitElements/diffMinimal/
 *     applyOps + the adapter's `onEvent` seam → dispatchEvent/runPhase.
 *     The page performs NO feature logic of its own: it renders the envelope
 *     and runs the documented mutation surfaces the data's handler bodies use.
 *
 * Contract / intended result: docs/framework-feature-summary.md §5 and the
 * annotations embedded in demo/feature-showcase.template.html. The expected
 * final output (demo/feature-showcase.expected.html) is generated from the
 * SAME data through the SSRFragmentAdapter (PAR-5 parity — the ops interpret
 * identically under DOM and SSR).
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { createClient } from '../dist/core/client.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter, SSRFragmentAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps, treeSig, treeFromOps } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { dispatchEvent } from '../dist/core/handlers.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner } from './lib/runner.js'

// ============================================================================
// DATA — the LEGACY envelope (pure JSON; no graph construction by the page).
// ============================================================================

/** Legacy handler bodies shipped as function-source strings (translate.md §2:
 *  `new Function(\`return (${src})\`)()` at translate). */
const INPUT_BODY = `function (ctx, value) {
  const t = value == null ? '' : String(value);
  const all = ctx.tree.allNodes();
  const node = all.find(function (n) { return n && n.props && n.props.id === 'cmd-echo'; });
  if (node) ctx.clientAPI.apply(node.id, [{ targetProp: 'props.msg', mode: 'replace', value: t }]);
}`

const CLICK_BODY = `function (ctx) {
  const all = ctx.tree.allNodes();
  const node = all.find(function (n) { return n && n.props && n.props.id === 'cmd-echo'; });
  if (!node) return;
  const cur = Boolean(node.props.authorized);
  ctx.clientAPI.apply(node.id, [{ targetProp: 'props.authorized', mode: 'replace', value: !cur }]);
}`

const STAMP_BODY = `function (ctx) {
  const n = ctx.node;
  if (!n || !ctx.clientAPI) return;
  if (n.props && n.props['stamp:done']) return;
  ctx.clientAPI.apply(n.id, [{ targetProp: 'props.stamp:done', mode: 'replace', value: true }]);
}`

const RISK_BODY = `function () { throw new Error('intentional containment probe'); }`

/** The full showcase envelope. Every feature below is deliberately data-only. */
export function showcaseLegacyData() {
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'showcase-root' },
        // ONE depth-0 source rides the root (components resolve depth-0:
        // an in-tree source node is invisible to non-descendants — S-R2.6;
        // the legacy format carries one component binding per node, so the
        // resolved scalar path uses this single provider).
        component: { reference: 'kpirev', value: 4242 },
        children: [
          // --- Combined set: the ops dashboard -----------------------------
          {
            type: 'header',
            props: { id: 'app-header' },
            css: { classes: ['app-header'], style: 'padding:10px 14px;background:#122;color:#cfe;' },
            content: 'Preempt-Providence — data-only feature showcase (legacy JSON input)',
          },
          {
            type: 'main',
            props: { id: 'dashboard' },
            children: [
              {
                type: 'p',
                props: { id: 'intro' },
                css: { classes: ['goals'] },
                content: 'Rendered, mutated and re-rendered entirely from the legacy envelope + core interfaces. Sections below pair the data with the documentation and the intended result.',
              },
              {
                type: 'section',
                props: { id: 'ops' },
                css: { classes: ['lab-card'], style: 'border:1px solid #267;padding:10px;margin:12px 0;' },
                derived: {
                  props: {
                    // features H6/C2 combined: children.count + component bindings derived into props
                    'data-child-count': { $: 'children.length' },
                    'data-path': { $: 'pathKey' },
                    'data-resolved-refs': { $concat: ['ops|kpirev|tenantflavor'] },
                  },
                },
                children: [
                  { type: 'h2', props: { id: 'ops-title' }, content: 'Ops dashboard — features combined' },
                  // target: reference only → TARGET anchor; text = resolved scalar
                  // (the source is the root's depth-0 provider above — translate.md §2, S-R2.6)
                  {
                    type: 'div',
                    props: { id: 'kpi-a' },
                    component: { reference: 'kpirev' },
                    derived: {
                      props: {
                        'data-resolved': { $: 'bindings.kpirev' },
                        'data-kind': { $concat: ['kpi-card|', { $: 'bindings.kpirev' }] },
                      },
                    },
                    children: [{ type: 'span', props: { id: 'kpi-a-label' }, content: 'Revenue (consumer 1)' }],
                  },
                  // same reference again → shared per-name link (TR-2), two consumers
                  {
                    type: 'div',
                    props: { id: 'kpi-b' },
                    component: { reference: 'kpirev' },
                    derived: { props: { 'data-resolved': { $: 'bindings.kpirev' } } },
                    children: [{ type: 'span', props: { id: 'kpi-b-label' }, content: 'Revenue (2nd consumer)' }],
                  },
                  // multiplicity: two self-providers share ONE reference name —
                  // each resolves its OWN value at self and renders it (S-R2.6,
                  // S-R2.5 forks; a consumer arm set from N providers at depth-0
                  // is demonstrated in demo/components.html — the legacy format
                  // carries one provider at the root).
                  { type: 'div', props: { id: 'flavor-a' }, component: { reference: 'tenantflavor', value: 'alpha' }, css: { classes: ['chip'] } },
                  { type: 'div', props: { id: 'flavor-b' }, component: { reference: 'tenantflavor', value: 'beta' }, css: { classes: ['chip'] } },
                  // provide-and-self-apply (translate.md §2.1, K1): reference
                  // + value + target:'props.<key>' → SOURCE anchor (self-
                  // provider) + a translate-synthesized derived
                  // `props.moodPanel = { $: 'bindings.mood' }` — the node's
                  // own compiled props receive the resolved value ('calm'),
                  // surfaced via derived (kernel K1/K2; the runtime duplex
                  // anchor shape is legacy-unexpressible).
                  {
                    type: 'div',
                    props: { id: 'mood' },
                    component: { reference: 'mood', value: 'calm', target: 'props.moodPanel' },
                    content: 'self-apply: source=mood(calm) / props.moodPanel (synthesized derived)',
                    derived: { props: { 'data-mood-panel': { $: 'bindings.mood' } } },
                  },
                  // self-provider chip (distinct name so the mood node's
                  // apply-path probe does not fork-collide with it — S-R2.5)
                  { type: 'div', props: { id: 'mood-panel' }, component: { reference: 'moodpanelprobe', value: 'panel:ok' }, css: { classes: ['chip'] } },
                  // handlers: event handlers with STRING bodies on input + click
                  {
                    type: 'div',
                    props: { id: 'cmd-card' },
                    css: { classes: ['cmd'], style: 'gap:8px;display:flex;margin:10px 0;' },
                    children: [
                      { type: 'label', props: { id: 'cmd-label' }, content: 'Command: ' },
                      {
                        type: 'input',
                        props: { id: 'cmd-input' },
                        handlers: [{ name: 'cmd-update', event: 'input', body: INPUT_BODY }],
                      },
                      {
                        type: 'button',
                        props: { id: 'run-btn' },
                        handlers: [{ name: 'toggle-auth', event: 'click', body: CLICK_BODY }],
                        content: 'Authorize',
                      },
                      {
                        type: 'div',
                        props: { id: 'cmd-echo' },
                        content: 'awaiting input',
                        derived: {
                          props: {
                            'data-last-msg': { $: 'props.msg' },
                            'data-authorized': { $: 'props.authorized' },
                          },
                        },
                      },
                    ],
                  },
                ],
              },
              // --- Isolation labs: one feature per card ----------------------
              {
                type: 'section',
                props: { id: 'labs' },
                children: [
                  { type: 'h2', props: { id: 'labs-title' }, content: 'Feature lab — each card shows ONE feature in isolation' },
                  // unresolved-reference fail-state (api.md §4.3)
                  {
                    type: 'div',
                    props: { id: 'ghost' },
                    component: { reference: 'ghostservice' },
                    content: 'ghost (no provider -> unresolved)',
                    derived: { props: { 'data-unresolved': { $: 'unresolved.length' } } },
                  },
                  // loop safety: a REAL borrow-walk cycle (api.md §4.2) —
                  // loop-a provides loop.x and consumes loop.y; its child
                  // loop-b provides loop.y and consumes loop.x. The K7 array
                  // form expresses provider + consumer on ONE node
                  // (component: [{reference,value},{reference}]). Resolution
                  // hops consumer → provider → the provider's own targets →
                  // … and revisits a node already on the walk path → the arm
                  // drops with reason 'loop' + a 'circular-source' diagnostic
                  // (api.md §4.2 "Path loops → no actionable state"). Dropped
                  // arms are NEVER rendered — the pair is absent from the
                  // output while the page still renders everything else (no
                  // hang).
                  {
                    type: 'div',
                    props: { id: 'loop-a' },
                    component: [{ reference: 'loop.x', value: 'A' }, { reference: 'loop.y' }],
                    content: 'loop-a (circular chain — arm dropped, never rendered)',
                    children: [
                      {
                        type: 'div',
                        props: { id: 'loop-b' },
                        component: [{ reference: 'loop.y', value: 'B' }, { reference: 'loop.x' }],
                        content: 'loop-b (circular chain — arm dropped, never rendered)',
                      },
                    ],
                  },
                  // derived-state DSL (docs/specs/derived-state.md §3)
                  {
                    type: 'div',
                    props: { id: 'dsl-card' },
                    content: 'derived DSL',
                    derived: {
                      props: {
                        'data-child-count': { $: 'children.length' },
                        'data-path': { $: 'pathKey' },
                        'data-kind': { $concat: ['kind=', { $: 'type' }] },
                        'data-eq': { $if: { cond: { $eq: [{ $: 'type' }, 'div'] }, then: 'is-div', else: 'not-div' } },
                        'data-gt': { $if: { cond: { $gt: [{ $: 'children.length' }, 2] }, then: 'deep', else: 'shallow' } },
                      },
                    },
                    children: [
                      { type: 'span', props: { id: 'dsl-c1' }, content: 'one' },
                      { type: 'span', props: { id: 'dsl-c2' }, content: 'two' },
                      { type: 'span', props: { id: 'dsl-c3' }, content: 'three' },
                    ],
                  },
                  // placement anchor (translate.md §2 → placement-role anchor; api.md §5)
                  {
                    type: 'div',
                    props: { id: 'placement-lab' },
                    placement: { placementName: 'lab-placement' },
                    content: 'placement anchor (lab-placement)',
                    derived: { props: { 'data-placement': { $: 'placement' } } },
                  },
                  // css: classes + inline style (adapters.md §3)
                  { type: 'div', props: { id: 'css-lab' }, css: { id: 'css-lab-id', classes: ['lab-card', 'accent'], style: 'padding:8px;border:1px solid #888;' }, content: 'css: id + classes + style' },
                  // phase handler (handlers.md §4) — one-shot, idempotent stamp
                  {
                    type: 'div',
                    props: { id: 'stamp-lab' },
                    content: 'phase (after-compile) one-shot stamp',
                    handlers: [{ name: 'stamp', phase: 'after-compile', body: STAMP_BODY }],
                    derived: { props: { 'data-stamp-done': { $: 'props.stamp:done' } } },
                  },
                  // throwing handler → containment (handlers.md §3 H-H4)
                  {
                    type: 'div',
                    props: { id: 'risk-lab' },
                    content: 'risk (throwing handler, contained)',
                    handlers: [{ name: 'risk', event: 'risk', body: RISK_BODY }],
                  },
                ],
              },
              {
                type: 'footer',
                props: { id: 'app-footer' },
                css: { classes: ['app-header'], style: 'padding:8px;color:#8ab;' },
                content: 'Driven by the legacy JSON envelope below; expected output: demo/feature-showcase.expected.html',
              },
            ],
          },
        ],
      },
    },
    // content payload: UNPLACED nodes (translate.md §2; TR-6) — one self-providing
    content: [
      {
        metadata: { title: 'showcase payloads' },
        content: [
          { type: 'div', props: { id: 'widget-discover' }, component: { reference: 'widgetdiscover', value: 'Radar-Discovery' } },
          { type: 'div', props: { id: 'payload-banner' }, content: 'unplaced payload node (never rendered)' },
        ],
      },
    ],
    clientConfig: { runInstantiation: false, runMonitoring: true },
  }
}

/** Server reference baked into the page for the smoke + human readers. */
export function showcaseServerData() {
  return {
    goals: [
      'combined set: source/target/self-apply components (K1), fork multiplicity, derived bakes, css',
      'isolation: unresolved fail-state, loop safety, derived DSL, placement, css, phase handler, containment',
    ],
    expected: {
      kpi: '4242',
      flavors: ['alpha', 'beta'],
      mood: 'calm',
      moodPanel: 'calm', // provide-and-self-apply: synthesized derived props.moodPanel
      placement: 'lab-placement',
      loops: 'dropped', // circular-source pair (api.md §4.2): never rendered
    },
  }
}

// ============================================================================
// NODE-side surface: compile the envelope once → render ops (shared by the
// page's DomAdapter and the builder's SSRFragmentAdapter — PAR-5 parity).
// ============================================================================

export function buildShowcaseSurface() {
  const doc = showcaseLegacyData()
  const translated = translateLegacy(doc)
  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const clientAPI = createClient(supervisor)
  const cr = translated.root.compile(translated.nodes)
  const byNode = new Map()
  for (const s of cr.actionable) {
    if (!supervisor.getNode(s.nodeId)?.isInTree) continue
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
  return { doc, translated, rootNode: translated.root, supervisor, clientAPI, nodeById, els, ops }
}

/** Expected final output: identical ops through the SSRFragmentAdapter. */
export function renderShowcaseSsrHtml() {
  const { ops, els } = buildShowcaseSurface()
  const sr = treeSig(treeFromOps(diffMinimal(null, els)))
  const adapter = new SSRFragmentAdapter()
  applyOps(adapter, ops)
  const html = adapter.toString()
  if (treeSig(treeFromOps(ops)) !== sr) {
    throw new Error('feature-showcase SSR surface diverges from the parity reference')
  }
  return html
}

// ============================================================================
// PAGE — browser module (guarded so the Node builder can import the data).
// ============================================================================

if (typeof document !== 'undefined') {
  setCompilePassLogging(true)
  globalThis.setCompilePassLogging = setCompilePassLogging

  const runner = makeRunner()
  document.getElementById('results').appendChild(runner.el)

  const envelope = JSON.parse(document.getElementById('preempt-initial-data').textContent)
  const serverData = JSON.parse(document.getElementById('server-data').textContent)

  const PROFILE = { loadMs: 0, compileMs: 0, emitMs: 0, diffMs: 0, applyMs: 0, renderCount: 0, compileCalls: 0, totalMs: 0 }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }

  const adapter = new DomAdapter(document.getElementById('app'), { onEvent: handleDomEvent })

  const loadT0 = now()
  const translated = translateLegacy(envelope)
  const rootNode = translated.root
  PROFILE.loadMs = now() - loadT0

  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const clientAPI = createClient(supervisor)
  const ctx = supervisor.handlerContext

  let prevStates = new Map()
  let prevMap = null
  let bootstrapped = false
  let bootstrapWarnings = []

  function mergeStates(byNode) {
    for (const [id, arr] of byNode) {
      if (!supervisor.getNode(id)?.isInTree) continue
      prevStates.set(id, arr)
    }
  }
  function setStates(actionable) {
    const byNode = new Map()
    for (const s of actionable) {
      const arr = byNode.get(s.nodeId) ?? []
      arr.push(s)
      byNode.set(s.nodeId, arr)
    }
    mergeStates(byNode)
  }
  function render() {
    const origWarn = console.warn
    console.warn = () => {}
    try {
      if (!bootstrapped) {
        const cr = acc('compileMs', () => rootNode.compile(translated.nodes))
        PROFILE.compileCalls += 1
        bootstrapWarnings = cr.warnings
        setStates(cr.actionable)
        supervisor.recordResolved(cr.actionable)
        bootstrapped = true
      } else {
        mergeStates(supervisor.takePass2States())
      }
      const actionable = []
      for (const [, states] of prevStates) actionable.push(...states)
      const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
      const els = acc('emitMs', () => emitElements(actionable, byNode))
      const ops = acc('diffMs', () => diffMinimal(prevMap, els))
      acc('applyMs', () => applyOps(adapter, ops))
      prevMap = new Map(els.map((e) => [e.wire, e]))
      PROFILE.renderCount += 1
      return { els, ops }
    } finally {
      console.warn = origWarn
    }
  }

  /** Documented adapter seam (adapters.md §3): the DomAdapter hands every DOM
   *  event to opts.onEvent; the page converts it to a handler dispatch.
   *  All feature logic stays in the data-declared string bodies. */
  function handleDomEvent(wire, domEvent) {
    const node = supervisor.getNode(wire)
    if (!node) return
    const eventName = domEvent && typeof domEvent === 'object' && typeof domEvent.type === 'string' ? domEvent.type : String(domEvent ?? '')
    const extra = domEvent && domEvent.target && typeof domEvent.target.value === 'string' ? [domEvent.target.value] : []
    dispatchEvent(node, ctx, eventName, ...extra)
    return flushMicrotasks().then(() => render())
  }

  function flushMicrotasks() {
    const waits = []
    for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
    return Promise.all(waits)
  }

  // lookup by authored prop id (page has no feature logic beyond plumbing)
  function byAuthoredId(id) {
    return supervisor.allNodes().find((n) => !n.destroyed && n.props?.id === id)
  }
  // locate a rendered element by its authored id, walking the #app subtree —
  // works under the smoke DOM shim (which only tracks seeded elements) AND in
  // a real browser (tree walk over the live HTMLCollection)
  // locate a rendered element by its authored id, walking the #app subtree —
  // works under the smoke DOM shim (which only tracks seeded elements) AND in
  // a real browser (tree walk over the live HTMLCollection)
  function findById(id) {
    const root = document.getElementById('app')
    const stack = [root]
    while (stack.length > 0) {
      const el = stack.pop()
      if (!el) continue
      if ((el.id || el.getAttribute?.('id') || '') === id) return el
      const kids = el.children ?? []
      for (let i = 0; i < kids.length; i += 1) stack.push(kids[i])
    }
    return null
  }
  function textOf(el) {
    return el ? (el.textContent ?? '') : ''
  }

  // --------------------------------------------------------------------------
  async function main() {
    render() // bootstrap (the ONLY full compile)

    // runPhase: documented surface (handlers.md §4 / H-H9) — drives the ONE
    // phase handler the data declares (stamp-lab). One call = one stamp; a
    // second call must be a no-op (idempotency guard in the data body).
    const stampNode = byAuthoredId('stamp-lab')
    supervisor.runPhase('after-compile', stampNode.id)
    await flushMicrotasks()
    render()
    supervisor.runPhase('after-compile', stampNode.id)
    await flushMicrotasks()
    render()

    // containment probe (handlers.md H-H4): a throwing body is contained.
    const riskNode = byAuthoredId('risk-lab')
    const riskResults = dispatchEvent(riskNode, ctx, 'risk')
    await flushMicrotasks()

    // ---- checks -----------------------------------------------------------
    await runner.check('legacy envelope translates: in-tree root + unplaced content; clientConfig dom+persistence', () => {
      if (!rootNode.isInTree) throw new Error('root not in-tree')
      if (translated.content.length !== 2) throw new Error(`expected 2 unplaced content nodes, got ${translated.content.length}`)
      if (supervisor.allNodes().filter((n) => n.state === 'unplaced').length !== 2) throw new Error('unplaced content not tracked')
      // clientConfig gates → adapter/persistence (translate.md §2, TR-H6):
      // runInstantiation:false → adapter 'dom'; runMonitoring:true → persistence true
      if (translated.clientConfig.adapter !== 'dom' || translated.clientConfig.persistence !== true) {
        throw new Error(`clientConfig gates: adapter=${translated.clientConfig.adapter} persistence=${translated.clientConfig.persistence}`)
      }
    })

    await runner.check('component target resolves the source text=4242 with data-resolved baked (derived bindings)', () => {
      const a = findById('kpi-a')
      if (!a) throw new Error('kpi-a missing')
      if (!textOf(a).includes('4242')) throw new Error(`kpi-a text ${JSON.stringify(textOf(a))}`)
      if (a.getAttribute('data-resolved') !== '4242') throw new Error(`kpi-a data-resolved=${a.getAttribute('data-resolved')}`)
      if (a.getAttribute('data-kind') !== 'kpi-card|4242') throw new Error(`kpi-a data-kind=${a.getAttribute('data-kind')}`)
    })

    await runner.check('shared per-name link: two consumers, same resolved value', () => {
      const b = findById('kpi-b')
      if (!b) throw new Error('kpi-b missing')
      if (!textOf(b).includes('4242')) throw new Error(`kpi-b text ${JSON.stringify(textOf(b))}`)
      if (b.getAttribute('data-resolved') !== '4242') throw new Error('kpi-b data-resolved mismatch')
    })

    await runner.check('multiplicity: two same-name self-providers each render their own value (no coerced pick)', () => {
      const a = findById('flavor-a')
      const b = findById('flavor-b')
      if (!a || !b) throw new Error('flavor chips missing')
      if (!textOf(a).includes('alpha')) throw new Error(`flavor-a text ${JSON.stringify(textOf(a))}`)
      if (!textOf(b).includes('beta')) throw new Error(`flavor-b text ${JSON.stringify(textOf(b))}`)
    })

    await runner.check('self-apply (provide + local apply): source=mood(calm) bakes props.moodPanel via synthesized derived', () => {
      const mood = findById('mood')
      if (!mood) throw new Error('mood missing')
      if (!textOf(mood).includes('calm')) throw new Error(`mood text ${JSON.stringify(textOf(mood))}`)
      if (mood.getAttribute('data-mood-panel') !== 'calm') throw new Error(`mood data-mood-panel=${mood.getAttribute('data-mood-panel')}`)
      const panel = findById('mood-panel')
      if (!textOf(panel).includes('panel:ok')) throw new Error(`mood-panel text ${JSON.stringify(textOf(panel))}`)
    })

    await runner.check('unresolved-reference fail-state: ghost renders own content + unresolved badge', () => {
      const g = findById('ghost')
      if (!g) throw new Error('ghost missing')
      if (!textOf(g).includes('ghost')) throw new Error(`ghost text ${JSON.stringify(textOf(g))}`)
      if (Number(g.getAttribute('data-unresolved') ?? 0) < 1) throw new Error(`ghost data-unresolved=${g.getAttribute('data-unresolved')}`)
    })

    await runner.check('loop safety: circular A->B->A provider+consumer chain drops as loop (never rendered), no hang', () => {
      // api.md §4.2: a loop-terminated arm has NO actionable state — the pair is
      // absent from the DOM; the circular-source diagnostic is a compile outcome.
      if (findById('loop-a') || findById('loop-b')) throw new Error('dropped loop arms must never render')
      if (!bootstrapWarnings.some((w) => w.code === 'circular-source')) throw new Error('circular-source diagnostic missing at compile')
    })

    await runner.check('derived DSL: children.length, $concat, $if/$eq/$gt, pathKey baked', () => {
      const d = findById('dsl-card')
      if (!d) throw new Error('dsl-card missing')
      if (d.getAttribute('data-child-count') !== '3') throw new Error(`data-child-count=${d.getAttribute('data-child-count')}`)
      if (d.getAttribute('data-kind') !== 'kind=div') throw new Error(`data-kind=${d.getAttribute('data-kind')}`)
      if (d.getAttribute('data-eq') !== 'is-div') throw new Error(`data-eq=${d.getAttribute('data-eq')}`)
      if (d.getAttribute('data-gt') !== 'deep') throw new Error(`data-gt=${d.getAttribute('data-gt')}`)
      if (!d.getAttribute('data-path')) throw new Error('data-path empty')
    })

    await runner.check('placement anchor: derived placement badge = anchor target', () => {
      const p = findById('placement-lab')
      if (!p) throw new Error('placement-lab missing')
      if (p.getAttribute('data-placement') !== 'lab-placement') throw new Error(`data-placement=${p.getAttribute('data-placement')}`)
    })

    await runner.check('css: id + classes + inline style applied', () => {
      // css.id overrides the authored id on render (adapters.md §3: css:id → el.id)
      const c = findById('css-lab-id')
      if (!c) throw new Error('css-lab (css:id -> css-lab-id) missing')
      const cls = (c.className ?? c.getAttribute?.('class') ?? '').split(/\s+/)
      if (!cls.includes('lab-card') || !cls.includes('accent')) throw new Error(`css classes missing: ${cls.join(',')}`)
      const style = (c.style?.cssText ?? c.getAttribute?.('style') ?? '')
      if (!style.includes('padding:8px')) throw new Error(`style=${style}`)
      if ((c.id ?? c.getAttribute?.('id') ?? '') !== 'css-lab-id') throw new Error('css:id not applied')
    })

    await runner.check('event handler (input): mutation journals to the preview via string body', async () => {
      // documented surface (handlers.md §3): dispatchEvent matches event|name —
      // the same dispatch the DomAdapter's onEvent seam performs on real DOM events
      dispatchEvent(byAuthoredId('cmd-input'), ctx, 'input', 'hello frame')
      await flushMicrotasks()
      render()
      const echo = findById('cmd-echo')
      if ((echo?.getAttribute('data-last-msg') ?? '') !== 'hello frame') {
        throw new Error(`data-last-msg=${echo?.getAttribute('data-last-msg')}`)
      }
    })

    await runner.check('event handler (click): toggle authorization via state-slice', async () => {
      dispatchEvent(byAuthoredId('run-btn'), ctx, 'click')
      await flushMicrotasks()
      render()
      const echo = findById('cmd-echo')
      if (echo?.getAttribute('data-authorized') !== 'true') throw new Error(`data-authorized=${echo?.getAttribute('data-authorized')}`)
      dispatchEvent(byAuthoredId('run-btn'), ctx, 'click')
      await flushMicrotasks()
      render()
      if (echo?.getAttribute('data-authorized') !== 'false') throw new Error(`toggle failed: data-authorized=${echo?.getAttribute('data-authorized')}`)
    })

    await runner.check('phase handler (after-compile): one-shot stamp + idempotent re-run', () => {
      const s = findById('stamp-lab')
      if (!s) throw new Error('stamp-lab missing')
      if (s.getAttribute('data-stamp-done') !== 'true') {
        throw new Error(`data-stamp-done=${s.getAttribute('data-stamp-done')}`)
      }
    })

    await runner.check('containment: throwing handler error is returned, never thrown', () => {
      const hasError = (riskResults ?? []).some((r) => Boolean(r?.error) || r instanceof Error)
      if (!hasError) throw new Error('probe error not surfaced in results')
    })

    runner.summary('feature-showcase')
    PROFILE.totalMs = now() - loadT0
    console.log(`[feature-showcase:profile] load=${PROFILE.loadMs.toFixed(1)}ms compile=${PROFILE.compileMs.toFixed(1)}ms emit=${PROFILE.emitMs.toFixed(1)}ms diff=${PROFILE.diffMs.toFixed(1)}ms apply=${PROFILE.applyMs.toFixed(1)}ms renderCount=${PROFILE.renderCount} compileCalls=${PROFILE.compileCalls} total=${PROFILE.totalMs.toFixed(1)}ms`)
  }

  globalThis.__featureShowcaseDone = main().catch((e) => {
    console.error('feature-showcase failed:', e)
    runner.summary('feature-showcase')
  })
}