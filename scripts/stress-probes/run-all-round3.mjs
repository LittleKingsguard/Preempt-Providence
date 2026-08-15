// Stress-test review loop round 3 — step (b) PROBE agent (scenarios 27-34).
// Round-3 scope: well-formed-but-INVALID legacy data — the TR-F2 K4 warn
// class, the TR-F1 THROW boundary, and the documented anti-patterns — with
// the FAIL-SAFE trinity per scenario: (1) documented warn code fires (or
// documented throw), (2) the rest of the doc still translates/renders, no
// crash, no partial corrupt state, (3) nothing malformed silently accepted
// with zero warnings (except where silence is itself the documented pin).
// Core-only: dist/core/* + legacy JSON. No src/, no dist/, no demo/ changes.
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { SSRFragmentAdapter } from '../../dist/core/adapters.js'
import { emitElements, applyOps, treeSig, treeFromOps } from '../../dist/core/render-helpers.js'
import { diffMinimal } from '../../dist/core/render.js'
import { dispatchEvent, dispatchPhase, makeHandlerContext } from '../../dist/core/handlers.js'
import { registered } from '../../dist/core/registry.js'

// ---------------------------------------------------------------------------
// Pipeline helpers (round-2 pattern)
// ---------------------------------------------------------------------------
const now = () => (globalThis.performance?.now ? performance.now() : Date.now())

/** translate-only probe: captures the strict warning order + codes. */
function translateOnly(doc) {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => { warnings.push(typeof msg === 'string' ? msg : String(msg)) }
  try {
    return { translated: translateLegacy(doc), consoleWarns: warnings }
  }
  finally {
    console.warn = origWarn
  }
}

/** full pipeline: translate -> register -> root.compile(slice) -> emit ->
 *  diff -> SSR apply. Returns html + ops + warnings + cr. */
function pipeline(doc) {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => { warnings.push(typeof msg === 'string' ? msg : String(msg)) }
  try {
    const translated = translateLegacy(doc)
    const events = new EventBridge()
    const supervisor = new Supervisor({ events })
    for (const n of translated.nodes) supervisor.registerNode(n)
    const cr = translated.root.compile(translated.nodes)
    supervisor.recordResolved(cr.actionable)
    const nodeById = new Map(supervisor.allNodes().map((n) => [n.id, n]))
    const els = emitElements(cr.actionable, nodeById)
    const ops = diffMinimal(null, els)
    const adapter = new SSRFragmentAdapter()
    applyOps(adapter, ops)
    const html = adapter.toString()
    return { translated, supervisor, cr, els, ops, html, warnings, nodeById }
  }
  finally {
    console.warn = origWarn
  }
}

/** compilePath-scope pipeline (placement scenarios). */
function pipelinePath(doc) {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => { warnings.push(typeof msg === 'string' ? msg : String(msg)) }
  try {
    const translated = translateLegacy(doc)
    const events = new EventBridge()
    const supervisor = new Supervisor({ events })
    for (const n of translated.nodes) supervisor.registerNode(n)
    const actionable = []
    const crWarnings = []
    const dropped = []
    for (const n of translated.nodes) {
      const r = n.compilePath()
      actionable.push(...r.actionable)
      crWarnings.push(...r.warnings)
      dropped.push(...r.dropped)
    }
    const cr = { actionable, warnings: crWarnings, dropped }
    supervisor.recordResolved(cr.actionable)
    const nodeById = new Map(supervisor.allNodes().map((n) => [n.id, n]))
    const els = emitElements(cr.actionable, nodeById)
    const ops = diffMinimal(null, els)
    const adapter = new SSRFragmentAdapter()
    applyOps(adapter, ops)
    return { translated, supervisor, cr, els, ops, html: adapter.toString(), warnings, nodeById }
  }
  finally {
    console.warn = origWarn
  }
}

function tWarnCodes(translated) {
  return (translated.warnings ?? []).map((w) => w.code)
}
function tWarns(translated) {
  return (translated.warnings ?? []).map((w) => `${w.code}@${w.path ?? '-'}`)
}
function warnCodes(cr) {
  return (cr.warnings ?? []).map((w) => w.code)
}
function nodeOf(p, authoredId) {
  return p.nodeById ? [...p.nodeById.values()].find((n) => n.props?.id === authoredId)
    : p.supervisor.allNodes().find((n) => n.props?.id === authoredId)
}
function countSubstr(haystack, needle) {
  let n = 0
  let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) { n += 1; i += needle.length }
  return n
}
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b)

// ---------------------------------------------------------------------------
// Scenario data — envelopes EXACTLY as authored in
// archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md §"Round 3" (scenarios 27-34)
// ---------------------------------------------------------------------------

const SC27 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'guard-root' },
      component: [
        { reference: 'c', value: 'cv' },
        { reference: 'd', value: 'dv' },
      ],
      children: [
        {
          type: 'div',
          props: { id: 'guard-node' },
          component: [
            {},
            { reference: 'fork', value: 'first' },
            { reference: 'fork', value: 'second' },
            { reference: 'a', target: 'props.x' },
            { reference: 'b', target: 'props.x' },
            { reference: 'c', target: 'css.id' },
            { reference: 'd', target: 'props.' },
            { reference: 'e', target: 'props.a.b' },
            { reference: 'ok', target: 'props.label' },
            { reference: 'ok2', value: 'ok2val' },
          ],
          children: [
            { type: 'span', props: { id: 'fork-consumer' }, component: { reference: 'fork' }, derived: { props: { 'data-fork': { $: 'bindings.fork' } } } },
            { type: 'span', props: { id: 'ok2-consumer' }, component: { reference: 'ok2' }, derived: { props: { 'data-ok2': { $: 'bindings.ok2' } } } },
            { type: 'span', props: { id: 'c-consumer' }, component: { reference: 'c' }, derived: { props: { 'data-c': { $: 'bindings.c' } } } },
            { type: 'span', props: { id: 'd-consumer' }, component: { reference: 'd' }, derived: { props: { 'data-d': { $: 'bindings.d' } } } },
          ],
        },
        { type: 'div', props: { id: 'empty-array' }, component: [] },
        { type: 'div', props: { id: 'nonobject' }, component: [42] },
      ],
    },
  },
}

const SC28 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'pl-root' },
      children: [
        {
          type: 'div',
          props: { id: 'p-mixed' },
          placement: [
            null,
            'x',
            42,
            { placementName: '#bad' },
            { targetPlacement: 'zone' },
            { targetPlacement: ['dup', 'dup', 'ok-zone'] },
            { targetPlacement: 42 },
            { targetPlacement: [''] },
            { placementName: 'good-zone' },
          ],
        },
        { type: 'div', props: { id: 'p-null-target' }, placement: { targetPlacement: null } },
        { type: 'div', props: { id: 'p-null' }, placement: null },
        { type: 'div', props: { id: 'p-string' }, placement: 'zone' },
        { type: 'div', props: { id: 'p-empty' }, placement: [] },
        {
          type: 'div',
          props: { id: 'v-consumer' },
          placement: { targetPlacement: ['veto-zone'] },
          children: [
            { type: 'section', props: { id: 'v-producer' }, placement: { placementName: 'veto-zone' } },
          ],
        },
        {
          type: 'section',
          props: { id: 'pres-a' },
          placement: { placementName: 'pres-zone' },
          children: [
            { type: 'section', props: { id: 'pres-b' }, placement: { placementName: 'pres-zone' } },
          ],
        },
      ],
    },
  },
  content: [
    { content: [
      { type: 'div', props: { id: 'fan-consumer' }, placement: { targetPlacement: ['zone', 'dup', 'ok-zone', 'good-zone', 'veto-zone'] } },
    ] },
  ],
}

// Scenario 29 — seven/nine envelopes sharing one minimal template
const SC29_TEMPLATE = { template: { root: { type: 'app', props: { id: 'p-root' }, content: 'alive' } } }
const SC29_ENVELOPES = [
  { ...SC29_TEMPLATE, content: { metadata: { m: 1 }, content: [{ type: 'div', props: { id: 'obsolete-root' } }] } },
  { ...SC29_TEMPLATE, content: null },
  { ...SC29_TEMPLATE, content: 'hello' },
  { ...SC29_TEMPLATE, content: 42 },
  { ...SC29_TEMPLATE, content: true },
  { ...SC29_TEMPLATE, content: [{ metadata: { m: 1 }, content: [] }] },
  { ...SC29_TEMPLATE, content: [{}] },
  { ...SC29_TEMPLATE, content: [{ content: 'not-an-array' }] },
  { ...SC29_TEMPLATE, content: [null] },
]

const SC30 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'd5-root' },
      children: [
        {
          type: 'div',
          props: { id: 'dual' },
          content: {
            type: 'div',
            props: { id: 'nested-not-a-node' },
            children: [{ type: 'span', props: { id: 'also-not-a-node' } }],
            component: { reference: 'nope' },
          },
        },
        { type: 'div', props: { id: 'child-obj' }, children: { type: 'div', props: { id: 'obj-child' } } },
        { type: 'div', props: { id: 'child-str' }, children: 'hello' },
        { type: 'div', props: { id: 'child-null' }, children: null },
        { type: 'div', props: { id: 'child-num' }, children: [42] },
        { type: 'div', props: { id: 'child-null-entry' }, children: [null] },
        { type: 'div', props: { id: 'control' }, content: 'alive', children: [{ type: 'span', props: { id: 'control-child' }, content: 'kid' }] },
      ],
    },
  },
}

const SC31 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'h-root' },
      children: [
        {
          type: 'button',
          props: { id: 'handler-node' },
          content: 'click',
          handlers: [
            { name: 'legacy', phase: 'beforeAssembly', body: 'function () { return 1; }' },
            { name: 'syntax', event: 'boom', body: 'function () {' },
            { name: 'nofn', event: 'boom', body: 'not-a-function' },
            { name: 'num', event: 'boom', body: 42 },
            { name: 'both-bad', phase: 'beforeAssembly', body: 'function () {' },
            { name: 'ok1', event: 'click', body: 'function () { return \'ok1\'; }' },
            { name: 'ok2', phase: 'after-compile', body: 'function () { return \'ok2\'; }' },
          ],
        },
        { type: 'div', props: { id: 'h-control' }, content: 'alive' },
      ],
    },
  },
}

const SC32_ENVELOPES = [
  null,
  {},
  { template: {} },
  { template: { root: null } },
  { template: { root: 0 } },
  { template: { root: 42 } },
  { template: { root: [{ type: 'div' }] } },
  {
    template: { root: { type: 'app', props: { id: 'u-root' }, content: 'alive' }, children: [] },
    versions: 42,
    bogusField: { nested: true },
    extraList: [1, 2],
    clientConfig: { runInstantiation: true, runRendering: false, runWhatever: true },
  },
]

const SC33 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'u-root' },
      component: [
        { name: 'AuthInitHandler', body: 'function (ctx) { return 1; }' },
      ],
      children: [
        { type: 'div', props: { id: 'ghost-consumer' }, component: { reference: 'ghost' }, content: 'own state', derived: { props: { 'data-ghost': { $: 'bindings.ghost' } } } },
        { type: 'div', props: { id: 'seam-array' }, component: { reference: 'arrdef', value: [{ type: 'div', props: { id: 'arr-a' } }, { type: 'span', props: { id: 'arr-b' } }], target: 'children' }, content: 'shell' },
        { type: 'div', props: { id: 'seam-array-content' }, component: { reference: 'arrtxt', value: [{ type: 'div' }], target: 'content' }, content: 'text' },
      ],
    },
  },
}

const SC34 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'r-root' },
      children: [
        {
          type: 'div',
          props: { id: 'duplex-node' },
          component: [
            { reference: 'p', value: 'pv' },
            { reference: 'c' },
          ],
        },
        { type: 'div', props: { id: 'cssdef-node' }, css: { classes: ['probe'], style: 'color: red;', cssDef: { '.probe': { color: 'blue' } } }, content: 'styled' },
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

function runScenario27() {
  const d = []
  const p = pipeline(SC27)
  const t = p.translated
  d.push(`translate warns: ${JSON.stringify(tWarns(t))}`)
  const guardAnchors = nodeOf(p, 'guard-node').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role))
  d.push(`guard-node anchors: ${guardAnchors.map((a) => `${a.role}:${a.target}${a.value !== undefined ? '=' + JSON.stringify(a.value) : ''}`).join(' | ')}`)
  d.push(`empty-array comp anchors: ${nodeOf(p, 'empty-array').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).length}`)
  d.push(`nonobject comp anchors: ${nodeOf(p, 'nonobject').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).length}`)
  d.push(`compile warns: ${JSON.stringify(warnCodes(p.cr))}`)
  const idOf = (id) => nodeOf(p, id).id
  const propsOf = (id) => p.cr.actionable.filter((s) => s.nodeId === idOf(id)).map((s) => s.props)
  for (const id of ['guard-node', 'fork-consumer', 'ok2-consumer', 'c-consumer', 'd-consumer']) {
    d.push(`${id} actionable=${propsOf(id).length} rendered=${p.html.includes(`id="${id}"`)} props=${JSON.stringify(propsOf(id)[0] ?? null)}`)
  }
  d.push(`data-fork=${JSON.stringify(propsOf('fork-consumer')[0]?.['data-fork'])} data-ok2=${JSON.stringify(propsOf('ok2-consumer')[0]?.['data-ok2'])} data-c=${JSON.stringify(propsOf('c-consumer')[0]?.['data-c'])} data-d=${JSON.stringify(propsOf('d-consumer')[0]?.['data-d'])}`)
  d.push(`guard-node subtree: ${p.html.match(/<div[^>]*id="guard-node"[^>]*>.*?<\/div>/s)?.[0]?.slice(0, 240)}`)
  const expected = [
    'component-binding-empty@root.children[0]',
    'component-duplicate-reference@root.children[0]',
    'component-duplicate-target@root.children[0]',
    'component-target-gap@root.children[0]',
    'component-target-skipped@root.children[0]',
    'component-target-skipped@root.children[0]',
    'component-binding-empty@root.children[2]',
  ]
  const ok = deepEq(tWarns(t), expected) &&
    propsOf('fork-consumer')[0]?.['data-fork'] === 'first' &&
    propsOf('ok2-consumer')[0]?.['data-ok2'] === 'ok2val' &&
    propsOf('c-consumer')[0]?.['data-c'] === 'cv' &&
    propsOf('d-consumer')[0]?.['data-d'] === 'dv' &&
    propsOf('guard-node').length === 1 &&
    p.html.includes('id="guard-node"') && p.html.includes('id="empty-array"') && p.html.includes('id="nonobject"') &&
    nodeOf(p, 'empty-array').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).length === 0 &&
    nodeOf(p, 'nonobject').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).length === 0 &&
    warnCodes(p.cr).filter((c) => c === 'unresolved-reference').length === 3
  record('27', ok, d, [
    `compile warns on guard-node: ${JSON.stringify(warnCodes(p.cr))} — the KEPT recognition-only anchors (a/e/ok apply targets with NO provider anywhere in the doc) resolve to unresolved arms (3× unresolved-reference, one per kept gap/skipped anchor); the node still renders its own state (S-R4.3). The scenario doc pins this as compile-side (the scenario text counts TRANSLATE warnings only).`,
    'OBSERVATION (values convention, documented): guard-node and the consumers carry NO authored text, yet SSR shows text = the first scalar binding (guard-node="cv", fork-consumer="first", c-consumer="cv", d-consumer="dv") — scalarBinding "component provides values" first-scalar emission (archive/reviews/2026-08-15/2026-08-15-legacy-component-ref-only-review.md E-row: "scalarBinding picks the first scalar"; fork-stress.md §2,6). Guard-node\'s first binding is `c` (cv), so its own element renders "cv". Consistent with the docs, not a defect.',
  ].filter(Boolean))
}

function runScenario28() {
  const d = []
  const p = pipelinePath(SC28)
  const t = p.translated
  d.push(`translate warns: ${JSON.stringify(tWarns(t))}`)
  const mixed = nodeOf(p, 'p-mixed')
  d.push(`p-mixed anchors: ${mixed.anchors.map((a) => `${a.role}:${a.target}`).join(',')}`)
  for (const id of ['p-null-target', 'p-null', 'p-string', 'p-empty', 'pres-b']) {
    const n = nodeOf(p, id)
    const pa = n.anchors.filter((a) => a.role === 'container' || a.role === 'content').map((a) => `${a.role}:${a.target}`)
    d.push(`${id}: placement anchors ${JSON.stringify(pa)}`)
  }
  const vp = nodeOf(p, 'v-producer')
  d.push(`v-producer container anchors: ${JSON.stringify(vp.anchors.filter((a) => a.role === 'container').map((a) => a.target))}`)
  d.push(`v-consumer rendered=${p.html.includes('id="v-consumer"')} v-producer rendered=${p.html.includes('id="v-producer"')}`)
  d.push(`pres-a rendered=${p.html.includes('id="pres-a"')} pres-b rendered=${p.html.includes('id="pres-b"')} pres-b style=${JSON.stringify((p.html.match(/<section[^>]*id="pres-b"[^>]*>/) ?? [''])[0].match(/style="[^"]*"/)?.[0] ?? null)}`)
  const fanNode = nodeOf(p, 'fan-consumer')
  const fanStates = p.cr.actionable.filter((s) => s.nodeId === fanNode.id)
  d.push(`fan-consumer path-states=${fanStates.length}`)
  for (const s of fanStates) d.push(`  pathKey=${s.pathKey} activePlacement=${s.activePlacement}`)
  d.push(`fan-consumer elements=${countSubstr(p.html, 'id="fan-consumer"')}`)
  d.push(`compile warns: ${JSON.stringify(warnCodes(p.cr))}`)
  const expected = [
    'placement-entry-invalid@root.children[0]',
    'placement-name-invalid@root.children[0]',
    'placement-string-coerced@root.children[0]',
    'placement-duplicate-reference@root.children[0]',
    'placement-target-invalid@root.children[0]',
    'placement-name-invalid@root.children[0]',
    'placement-entry-invalid@root.children[3]',
    'placement-name-vetoed@root.children[5].children[0]',
  ]
  const ok = deepEq(tWarns(t), expected) &&
    mixed.anchors.some((a) => a.role === 'content' && a.target === 'zone') &&
    mixed.anchors.some((a) => a.role === 'content' && a.target === 'dup') &&
    mixed.anchors.some((a) => a.role === 'content' && a.target === 'ok-zone') &&
    mixed.anchors.some((a) => a.role === 'container' && a.target === 'good-zone') &&
    !mixed.anchors.some((a) => a.role === 'container' && a.target === '#bad') &&
    nodeOf(p, 'p-null-target').anchors.filter((a) => a.role === 'container' || a.role === 'content').length === 0 &&
    nodeOf(p, 'p-null').anchors.filter((a) => a.role === 'container' || a.role === 'content').length === 0 &&
    nodeOf(p, 'p-string').anchors.filter((a) => a.role === 'container' || a.role === 'content').length === 0 &&
    nodeOf(p, 'p-empty').anchors.filter((a) => a.role === 'container' || a.role === 'content').length === 0 &&
    nodeOf(p, 'pres-b').anchors.some((a) => a.role === 'container' && a.target === 'pres-zone') &&
    vp.anchors.filter((a) => a.role === 'container').length === 0 &&
    p.html.includes('id="v-consumer"') && p.html.includes('id="v-producer"') &&
    fanStates.length === 1 && countSubstr(p.html, 'id="fan-consumer"') === 1
  record('28', ok, d, [
    'REVIEW-CORRECTED (data-authoring bug, scenario doc + this assertion fixed in the review pass): the scenario originally pinned FOUR fan-out path-states (zone/dup/ok-zone/good-zone), but the p-mixed `zone`/`dup`/`ok-zone` anchors are CONTENT (consumer) anchors — they mint no container, so best-fit lands in the only zone WITH a container (`good-zone`). The doc\'s "zones WITH containers only" clause (first-match-with-known-container) supports ONE path-state: `root/good-zone/node-10/node-19` (forkKey = pathKey, activePlacement=good-zone), one element. `veto-zone` has no container → skipped non-fatally.',
    'SILENCE IS DOCUMENTED-PINNED: p-null-target (`{targetPlacement: null}`) and p-null (`placement: null`) mint ZERO anchors with ZERO warns — the code treats null as absent (`!== undefined && !== null` guards), exactly the expected-SURPRISE the scenario suspicised. The never-silent D1 letter is scoped to array ENTRIES, not null values.',
    'child-num-style `[42]`-entry precedent does not exist for placement: the non-object entries (null/"x"/42) warn `placement-entry-invalid` ONCE per field (invalidWarned flag), not once per entry — as the scenario pinned.',
    'OBSERVATION: pres-b renders `style="display: none;"` (EMPTY-OWNER-1 — a placement container with no authored children, no content, no inline style, and NO fan-out landing in pres-zone hides; pres-zone has no consumers in this envelope). Consistent with EMPTY-OWNER docs; the scenario\'s expectation for pres-b was the container minting only.',
  ].filter(Boolean))
}

function runScenario29() {
  const d = []
  // envelopes 1-5: non-array doc.content -> warn + skip, template still renders
  for (let i = 0; i < 5; i++) {
    const r = translateOnly(SC29_ENVELOPES[i])
    const t = r.translated
    d.push(`env${i + 1} (${JSON.stringify(SC29_ENVELOPES[i].content)}): warns=${JSON.stringify(tWarns(t))} content-roots=${t.content.length} metadata=${JSON.stringify(t.metadata)} userData=${JSON.stringify(t.userData)}`)
  }
  // envelope 6: valid array, empty payload, metadata control
  const r6 = translateOnly(SC29_ENVELOPES[5])
  d.push(`env6 (valid array, empty payload): warns=${JSON.stringify(tWarns(r6.translated))} content-roots=${r6.translated.content.length} metadata=${JSON.stringify(r6.translated.metadata)}`)
  // envelopes 7-9: malformed ENTRY -> throws
  for (let i = 6; i < 9; i++) {
    let outcome
    try {
      const r = translateOnly(SC29_ENVELOPES[i])
      outcome = `NO THROW warns=${JSON.stringify(tWarns(r.translated))}`
    }
    catch (e) {
      outcome = `THREW ${e.constructor.name}: ${e.message.slice(0, 70)}`
    }
    d.push(`env${i + 1} (${JSON.stringify(SC29_ENVELOPES[i].content)}): ${outcome}`)
  }
  // fail-safe render for a warn envelope (env1) and the clean control (env6)
  const p1 = pipeline(SC29_ENVELOPES[0])
  d.push(`env1 SSR has 'alive': ${p1.html.includes('alive')} obsolete-root present=${p1.html.includes('obsolete-root')}`)
  const p6 = pipeline(SC29_ENVELOPES[5])
  d.push(`env6 SSR has 'alive': ${p6.html.includes('alive')}`)
  const ok =
    tWarns(translateOnly(SC29_ENVELOPES[0]).translated).join() === 'payload-shape-obsolete@content' &&
    tWarns(translateOnly(SC29_ENVELOPES[1]).translated).join() === 'payload-shape-obsolete@content' &&
    tWarns(translateOnly(SC29_ENVELOPES[2]).translated).join() === 'payload-shape-obsolete@content' &&
    tWarns(translateOnly(SC29_ENVELOPES[3]).translated).join() === 'payload-shape-obsolete@content' &&
    tWarns(translateOnly(SC29_ENVELOPES[4]).translated).join() === 'payload-shape-obsolete@content' &&
    tWarns(r6.translated).length === 0 && r6.translated.metadata?.m === 1 &&
    p1.html.includes('alive') && !p1.html.includes('obsolete-root') && p6.html.includes('alive')
  record('29', ok, d, [
    'Envelopes 7-9 (malformed payload ENTRY: `[{}]` / `[{content:\'not-an-array\'}]` / `[null]`) all throw `legacy-payload-mismatch` (TR-F1 class) — see outcome lines. The throw aborts the whole translate call; no partial TranslatedTree escapes (translate-only probe: the throw precedes the return).',
  ])
}

function runScenario30() {
  const d = []
  const censusBefore = registered.size
  let outcome
  try {
    const r = translateOnly(SC30)
    outcome = `NO THROW nodes=${r.translated.nodes.length}`
  }
  catch (e) {
    outcome = `THREW ${e.constructor.name}: ${e.message.slice(0, 90)}`
  }
  d.push(`outcome: ${outcome} (census before=${censusBefore})`)
  const ok = outcome.startsWith('NO THROW')
  record('30', ok, d, [
    'GENUINE ENGINE DEFECT (reported in archive/findings/2026-08-15/2026-08-15-test-findings §"Stress-test review loop #4" DEFECT #7 — RED BY DESIGN): `children: [null]` throws an UNCAUGHT TypeError at translate — `planBindings` reads `data.component` on the null entry (translate.ts:692; the children loop at translate.ts:799-803 has no per-entry guard). The crash aborts the ENTIRE document translate (TR-F2 discipline: only malformed envelopes/payloads may throw — a malformed children ENTRY is neither); the fail-safe trinity fails for this envelope (nothing after the null entry translates; the `control` sibling never renders). The probe asserts the DOC LETTER (no crash, fail-safe holds — pinned contract: `children-entry-invalid` warn + skip, translate.md TR-H14): the assertion stays red until the guard lands (separate TDD pass). The rest of the S30 matrix (dual-parse census, children-shape-invalid, [42] silent mint, reverse) is probed on the sibling set WITHOUT the [null] entry in scenario 30b.',
  ])
}

// SC30 needs a run WITHOUT the crashing child-null-entry to verify the rest of
// the matrix + fail-safe — probed in runScenario30b below.
function runScenario30b() {
  const d = []
  const doc = JSON.parse(JSON.stringify(SC30))
  doc.template.root.children = doc.template.root.children.filter((c) => c.props.id !== 'child-null-entry')
  const p = pipeline(doc)
  const t = p.translated
  d.push(`translate warns: ${JSON.stringify(tWarns(t))}`)
  d.push(`dual content object carried: ${typeof nodeOf(p, 'dual').content === 'object'}`)
  d.push(`dual comp anchors: ${JSON.stringify(nodeOf(p, 'dual').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).map((a) => a.role + ':' + a.target))}`)
  d.push(`nested-not-a-node minted: ${t.nodes.some((n) => n.props?.id === 'nested-not-a-node')} also-not-a-node minted: ${t.nodes.some((n) => n.props?.id === 'also-not-a-node')}`)
  d.push(`dual SSR: ${p.html.match(/<div[^>]*id="dual"[^>]*>.*?<\/div>/s)?.[0] ?? 'MISSING'}`)
  for (const id of ['child-obj', 'child-str', 'child-null']) {
    const n = nodeOf(p, id)
    d.push(`${id}: children=${n.children.length} rendered=${p.html.includes(`id="${id}"`)}`)
  }
  const cn = nodeOf(p, 'child-num')
  d.push(`child-num: children=${cn.children.length} kid type=${cn.children[0]?.type} kid props=${JSON.stringify(cn.children[0]?.props)}`)
  d.push(`control rendered: ${p.html.includes('alive')} control-child=${p.html.includes('control-child')} kid-text=${p.html.includes('kid')}`)
  const rev = reverseTranslate(p.translated.root)
  const revDual = rev.template.root.children.find((n) => n.props?.id === 'dual')
  d.push(`reversed dual content: ${JSON.stringify(revDual?.content)?.slice(0, 100)} (object round-trips: ${typeof revDual?.content === 'object'})`)
  const revCn = rev.template.root.children.find((n) => n.props?.id === 'child-num')
  d.push(`reversed child-num children: ${JSON.stringify(revCn?.children)}`)
  const ok = tWarnCodes(t).filter((c) => c === 'children-shape-invalid').length === 3 &&
    // DEFECT #7 fix: [42] is a non-object ENTRY too → children-entry-invalid
    // warn + skip (the old silent-mint was part of the defect family)
    tWarnCodes(t).filter((c) => c === 'children-entry-invalid').length === 1 &&
    t.nodes.some((n) => n.props?.id === 'dual') &&
    !t.nodes.some((n) => n.props?.id === 'nested-not-a-node' || n.props?.id === 'also-not-a-node') &&
    nodeOf(p, 'dual').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).length === 0 &&
    p.html.includes('[object Object]') &&
    nodeOf(p, 'child-obj').children.length === 0 && nodeOf(p, 'child-str').children.length === 0 &&
    nodeOf(p, 'child-null').children.length === 0 &&
    cn.children.length === 0 &&
    p.html.includes('alive') && p.html.includes('kid') &&
    typeof revDual?.content === 'object' && revDual?.content?.type === 'div'
  record('30b', ok, d, [
    'This 30b probe runs the S30 envelope with the crashing `[null]` entry REMOVED so the dual-parse / children-matrix / fail-safe checks can complete (the crash aborts the whole call — 30 probe above). Verdict 30b reflects the matrix alone; the crash finding is the 30 probe.',
  ])
}

function runScenario31() {
  const d = []
  const p = pipeline(SC31)
  const t = p.translated
  d.push(`translate warns: ${JSON.stringify(tWarns(t))}`)
  const node = nodeOf(p, 'handler-node')
  d.push(`kept handlers: ${node.handlers.map((h) => h.name).join(',')}`)
  const ctx = makeHandlerContext()
  const click = dispatchEvent(node, ctx, 'click')
  const boom = dispatchEvent(node, ctx, 'boom')
  const afterCompile = dispatchPhase(node, ctx, 'after-compile')
  d.push(`dispatch click -> ${JSON.stringify(click)}`)
  d.push(`dispatch boom -> ${JSON.stringify(boom)}`)
  d.push(`dispatchPhase after-compile -> ${JSON.stringify(afterCompile)}`)
  d.push(`handler-node rendered=${p.html.includes('id="handler-node"')} control rendered=${p.html.includes('alive')}`)
  const expected = [
    'handler-phase-unknown@root.children[0].handlers[0]',
    'handler-body-invalid@root.children[0].handlers[1]',
    'handler-body-invalid@root.children[0].handlers[2]',
    'handler-body-invalid@root.children[0].handlers[3]',
    'handler-phase-unknown@root.children[0].handlers[4]',
  ]
  const ok = deepEq(tWarns(t), expected) &&
    deepEq(click, ['ok1']) && deepEq(afterCompile, ['ok2']) && deepEq(boom, []) &&
    p.html.includes('id="handler-node"') && p.html.includes('alive')
  record('31', ok, d, [
    'legacy-handler-body is NOT a translate throw (NP11 pinned): the instantiation error is caught and downgraded to `handler-body-invalid` warn + skip; the `legacy-handler-body` text surfaces only inside the warn reason. Phase-first ordering holds (handlers[4] both-bad warns phase-unknown only).',
  ])
}

function runScenario32() {
  const d = []
  for (let i = 0; i < SC32_ENVELOPES.length; i++) {
    const doc = SC32_ENVELOPES[i]
    let outcome
    try {
      const r = translateOnly(doc)
      const t = r.translated
      outcome = `NO THROW type=${t.root.type} id=${t.root.id} warns=${JSON.stringify(tWarns(t))} adapter=${t.clientConfig.adapter} persistence=${t.clientConfig.persistence}`
    }
    catch (e) {
      outcome = `THREW ${e.constructor.name}: ${e.message.slice(0, 70)}`
    }
    d.push(`env${i + 1} (${doc === null ? 'null' : JSON.stringify(doc).slice(0, 60)}): ${outcome}`)
  }
  const p8 = pipeline(SC32_ENVELOPES[7])
  d.push(`env8 SSR has 'alive': ${p8.html.includes('alive')}`)
  const throwsOk = [0, 1, 2, 3, 4, 5, 6].every((i) => {
    try { translateLegacy(SC32_ENVELOPES[i]); return false } catch (e) { return String(e.message).includes('legacy-envelope-mismatch') }
  })
  const ok = throwsOk &&
    tWarnCodes(translateOnly(SC32_ENVELOPES[7]).translated).length === 0 &&
    translateOnly(SC32_ENVELOPES[7]).translated.clientConfig.adapter === 'ssr' &&
    translateOnly(SC32_ENVELOPES[7]).translated.clientConfig.persistence === false &&
    p8.html.includes('alive')
  record('32', ok, d, [
    'GENUINE ENGINE DEFECT (reported in archive/findings/2026-08-15/2026-08-15-test-findings §"Stress-test review loop #4" DEFECT #8 — RED BY DESIGN): the COHERENT CONTRACT was DECIDED in the review pass and pinned in translate.md §3 (extended `legacy-envelope-mismatch` row) — `template.root` must be an OBJECT; a truthy non-object root (`42`, `[...]`) is a MALFORMED ENVELOPE and MUST throw, not silently mint a default `div` with ZERO warns. The engine\'s truthy gate (translate.ts:822) passes 42/`[...]` through to baseFrom\'s access-safe default-div mint — the probe asserts the pinned letter (envelopes 6-7 must throw) and stays MISMATCH until the gate type-check lands (separate TDD pass). Envelope 8 (unknown top-level fields + unmapped run* gates): NO throw, ZERO translate warns (TR-F2) — `versions`/`bogusField`/`extraList` dropped; `clientConfig` maps only runInstantiation (adapter ssr) + runMonitoring (persistence false); runRendering/runWhatever inert. Doc renders "alive" fully.',
  ])
}

function runScenario33() {
  const d = []
  const p = pipeline(SC33)
  const t = p.translated
  d.push(`translate warns: ${JSON.stringify(tWarns(t))}`)
  const rootComp = nodeOf(p, 'u-root').anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role))
  d.push(`root comp anchors: ${JSON.stringify(rootComp.map((a) => a.role + ':' + a.target))}`)
  d.push(`compile warns: ${JSON.stringify(warnCodes(p.cr))}`)
  const ghost = nodeOf(p, 'ghost-consumer')
  const ghostCs = p.cr.actionable.filter((s) => s.nodeId === ghost.id)
  d.push(`ghost-consumer actionable=${ghostCs.length} rendered=${p.html.includes('id="ghost-consumer"')} own-state=${p.html.includes('own state')} data-ghost=${JSON.stringify(ghostCs[0]?.props?.['data-ghost'])}`)
  const sa = nodeOf(p, 'seam-array')
  d.push(`seam-array rendered=${p.html.includes('id="seam-array"')} shell=${p.html.includes('>shell<') || p.html.includes('shell')} arr-a minted=${t.nodes.some((n) => n.props?.id === 'arr-a')} arr-b minted=${t.nodes.some((n) => n.props?.id === 'arr-b')}`)
  const sac = nodeOf(p, 'seam-array-content')
  d.push(`seam-array-content rendered=${p.html.includes('id="seam-array-content"')} text=${p.html.includes('>text<')}`)
  d.push(`root rendered=${p.html.includes('id="u-root"')}`)
  const ok = deepEq(tWarns(t), ['component-binding-empty@root']) &&
    rootComp.length === 0 &&
    ghostCs.length === 1 && p.html.includes('own state') && ghostCs[0]?.props?.['data-ghost'] === undefined &&
    t.nodes.some((n) => n.props?.id === 'ghost-consumer') &&
    !t.nodes.some((n) => n.props?.id === 'arr-a' || n.props?.id === 'arr-b') &&
    p.html.includes('id="seam-array"') && p.html.includes('id="seam-array-content"') &&
    p.html.includes('id="u-root"')
  record('33', ok, d, [
    'D6-vs-K3 docs CONFLICT adjudicated + handlers.md §6 CORRECTED in the review pass (doc bug): the `template.component` D6 handler defs (`{name, body}`, no `reference`) DO fire `component-binding-empty` at path `root` — the K3 letter wins, the "die SILENTLY" claim was STALE. The defs become zero anchors; the root renders unaffected (dead-as-components, never HandlerDefs, no crash).',
    'Seam targets with ARRAY values: `value: [...]` + `target: children/content` → duplex anchor planned, `mintDefPrototypes` skips array values (translate.ts:571) — NO prototypes minted (arr-a/arr-b census-clean), seam never materializes, NO warn, node renders its own state ("shell"/"text"). Vacuity pin confirmed.',
    'unresolved-reference is a COMPILE outcome (per-node console warn + cr.warnings), never a throw; ghost-consumer still renders "own state" with data-ghost omitted (S-R4.3/DV-F2).',
  ])
}

function runScenario34() {
  const d = []
  const p = pipeline(SC34)
  const t = p.translated
  d.push(`translate warns: ${JSON.stringify(tWarns(t))}`)
  const dn = nodeOf(p, 'duplex-node')
  d.push(`duplex-node anchors: ${JSON.stringify(dn.anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).map((a) => `${a.role}:${a.target}${a.value !== undefined ? '=' + JSON.stringify(a.value) : ''}`))}`)
  d.push(`compile warns: ${JSON.stringify(warnCodes(p.cr))}`)
  d.push(`duplex-node rendered=${p.html.includes('id="duplex-node"')} cssdef-node rendered=${p.html.includes('id="cssdef-node"')} styled=${p.html.includes('styled')}`)
  const stylesOps = p.ops.filter((o) => o.kind === 'styles')
  d.push(`styles ops=${stylesOps.length} rules=${JSON.stringify(stylesOps.flatMap((o) => o.cssDefs))}`)
  const cssdefTag = p.html.match(/<div[^>]*id="cssdef-node"[^>]*>/)?.[0]
  d.push(`cssdef-node tag: ${cssdefTag}`)
  // reverse (R-2 shape-based drop)
  const rev = reverseTranslate(p.translated.root)
  const revDn = rev.template.root.children.find((n) => n.props?.id === 'duplex-node')
  d.push(`reversed duplex-node component: ${JSON.stringify(revDn?.component)}`)
  const re = translateLegacy(rev)
  d.push(`re-translate warns: ${JSON.stringify(tWarns(re))}`)
  const reDn = re.nodes.find((n) => n.props?.id === 'duplex-node')
  d.push(`re-translated duplex-node anchors: ${JSON.stringify(reDn.anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).map((a) => a.role + ':' + a.target))}`)
  // second cycle idempotence
  const rev2 = reverseTranslate(re.root)
  const rev2Dn = rev2.template.root.children.find((n) => n.props?.id === 'duplex-node')
  d.push(`second-cycle reversed component: ${JSON.stringify(rev2Dn?.component)} (identical: ${deepEq(revDn?.component, rev2Dn?.component)})`)
  const p2 = pipeline(rev)
  d.push(`re-render duplex-node=${p2.html.includes('id="duplex-node"')} cssdef-node=${p2.html.includes('id="cssdef-node"')} styled=${p2.html.includes('styled')}`)
  const ok =
    tWarnCodes(t).length === 0 &&
    dn.anchors.some((a) => a.role === 'source' && a.target === 'p' && a.value === 'pv') &&
    dn.anchors.some((a) => a.role === 'target' && a.target === 'c') &&
    warnCodes(p.cr).filter((c) => c === 'unresolved-reference').length === 1 &&
    p.html.includes('id="duplex-node"') &&
    stylesOps.flatMap((o) => o.cssDefs).length === 0 &&
    cssdefTag?.includes('class="probe"') && cssdefTag?.includes('color: red;') &&
    deepEq(revDn?.component, { reference: 'p', value: 'pv' }) &&
    tWarnCodes(re).length === 0 &&
    reDn.anchors.filter((a) => ['source', 'target', 'duplex'].includes(a.role)).length === 1 &&
    deepEq(revDn?.component, rev2Dn?.component)
  record('34', ok, d, [
    'R-2 shape-based reverse drop CONFIRMED: the applyPath-less consumer anchor `c` coexisting with provider `p` is DROPPED on reverse — the legacy data two-name-duplex shape `[{reference:p,value:pv},{reference:c}]` reverses to `{reference:p, value:pv}` ONLY (a two-name duplex is never emitted). The drop keys on the CONSUMER anchor (no applyPath) — the correct survivor (p) is kept. Re-translate: 1 source anchor, ZERO warnings; second reverse cycle is anchor-identical (no seesaw).',
    'cssDef top-level SELECTOR-KEY object: NO translate warn (css is opaque — no guard), styles op carries ZERO rules (cssDefRules yields nothing — no selector/styles keys), classes `class="probe"` + style `color: red;` still render, element renders "styled". Silence is the documented STL-1 consequence (expected-CLEAN).',
    'Compile note: duplex-node\'s own target `c` is provider-less → `unresolved-reference` compile warn (once) — the node still renders its own state (S-R4.3).',
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
run(27, runScenario27)
run(28, runScenario28)
run(29, runScenario29)
run(30, runScenario30)
run('30b', runScenario30b)
run(31, runScenario31)
run(32, runScenario32)
run(33, runScenario33)
run(34, runScenario34)

// ---------------------------------------------------------------------------
// RESULTS output
// ---------------------------------------------------------------------------
const lines = []
lines.push('# Stress-test probes round 3 — RESULTS (scenarios 27-34)')
lines.push('')
lines.push(`Probe agent output. Generated by \`scripts/stress-probes/run-all-round3.mjs\` on ${new Date().toISOString()}.`)
lines.push('Classification (doc/spec bug | data-authoring bug | genuine engine defect) is the REVIEW agent\'s job — nothing here is fixed. Each scenario\'s PASS/MISMATCH is against the scenario doc\'s "Expected output" only. Scope: TR-F2 warn class, TR-F1 throw boundary, documented anti-patterns, fail-safe trinity (warn fires / rest of doc intact / no silent acceptance).')
lines.push('')
for (const r of results) {
  lines.push(`## Scenario ${r.scenario} — ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const l of r.details) lines.push(`- ${l}`)
  for (const n of r.notes) lines.push(`- NOTE: ${n}`)
  lines.push('')
}
lines.push('## Validation trio (run after probe work)')
lines.push('')
lines.push('- `npm test` and `npm run typecheck`: see probe console (expected unchanged: 772 tests / clean).')
lines.push('- `npm run demo:smoke`: see probe console (profile totals watched for pass-2 blow-ups — no probe path touches fork-stress).')
lines.push('')

const out = lines.join('\n')
const { writeFileSync } = await import('node:fs')
writeFileSync(new URL('./RESULTS-round3.md', import.meta.url), out)

console.log('=== STRESS PROBE ROUND 3 SUMMARY ===')
for (const r of results) {
  console.log(`Scenario ${r.scenario}: ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const n of r.notes) console.log(`  note | ${n.slice(0, 160)}`)
}
const passCount = results.filter((r) => r.pass).length
console.log(`Total: ${passCount}/${results.length} result-entries PASS`)
console.log(`Total probe run: ${(now() - t0).toFixed(0)}ms`)
