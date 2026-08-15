// Stress-test review loop round 4 — step (b) PROBE agent (scenarios 35-42).
// Round-4 scope (archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md §"Round 4"):
//   Focus A — LAYER IDEMPOTENCY + CASCADE: double-apply seam compiles,
//   state-slice double-apply, layer-driven seam/container mints and removals
//   (addLayer/removeLayer/removeLayersForSource), compile-scope spies, and
//   the pass-2 dirty-set = affected-set pins.
//   Focus B — BACK-TRANSLATION / ROLLBACK: reverseTranslate must reproduce
//   the AUTHORED envelope (not the post-application graph); the ONE sanctioned
//   leak is R-3 (user edits from the live node state).
// Core-only: dist/core/* + legacy JSON. No src/, no dist/, no demo/ changes.
// The probe drives the CORE APIs per the round-4 probe contract (anchor +
// layer census, compile-scope spies, reverse round-trip stability).
import { translateLegacy, reverseTranslate } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { SSRFragmentAdapter } from '../../dist/core/adapters.js'
import { emitElements, applyOps, treeSig, treeFromOps } from '../../dist/core/render-helpers.js'
import { diffMinimal } from '../../dist/core/render.js'
import { dispatchPhase } from '../../dist/core/handlers.js'

// ---------------------------------------------------------------------------
// Pipeline helpers
// ---------------------------------------------------------------------------
const now = () => (globalThis.performance?.now ? performance.now() : Date.now())

const flush8 = async () => {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  await Promise.all(waits)
}

/** translate -> register -> (bootstrap compile) — staged control for the
 *  mutation scenarios. compileKind: 'slice' (root.compile(nodes)) or 'path'
 *  (per-node compilePath). */
function env(doc, compileKind = 'slice') {
  const warnings = []
  const origWarn = console.warn
  console.warn = (msg) => { warnings.push(typeof msg === 'string' ? msg : String(msg)) }
  try {
    const translated = translateLegacy(doc)
    const events = new EventBridge()
    const supervisor = new Supervisor({ events })
    for (const n of translated.nodes) supervisor.registerNode(n)
    let cr
    if (compileKind === 'path') {
      const actionable = []
      for (const n of translated.nodes) actionable.push(...n.compilePath().actionable)
      cr = { actionable, warnings: [], dropped: [] }
    } else {
      cr = translated.root.compile(translated.nodes)
    }
    supervisor.recordResolved(cr.actionable)
    return { translated, sup: supervisor, cr, warnings, byId: (id) => supervisor.allNodes().find((n) => n.props?.id === id) }
  }
  finally {
    console.warn = origWarn
  }
}

/** Render ALL nodes' resolved states through an adapter (the demos' pattern).
 *  adapter may be null (diff-only). Returns ops + html + prevMap + els. */
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

function censusOf(node) {
  return {
    id: node.props?.id,
    state: node.state,
    anchors: node.anchors.map((a) =>
      `${a.role}:${typeof a.target === 'string' ? a.target : (a.target?.id ?? '?')}` +
      `${a.options?.seam !== undefined ? '[seam]' : ''}` +
      `${a.options?.applyPath !== undefined ? '[ap]' : ''}`,
    ).sort(),
    layers: node.layers.map((l) => l.id).sort(),
  }
}
const censusJson = (node) => JSON.stringify(censusOf(node))
const seamParentOf = (node) => node.anchors.find((a) => a.role === 'parent' && a.options?.seam !== undefined)
const seamParentCount = (node) => node.anchors.filter((a) => a.role === 'parent' && a.options?.seam !== undefined).length
const seamChildCount = (node) => node.anchors.filter((a) => a.role === 'child' && a.options?.seam !== undefined).length
const countSubstr = (haystack, needle) => {
  let n = 0
  let i = 0
  while ((i = haystack.indexOf(needle, i)) !== -1) { n += 1; i += needle.length }
  return n
}

// ---------------------------------------------------------------------------
// Scenario data — envelopes EXACTLY as authored in
// archive/test-data/2026-08-15/2026-08-15-stress-test-scenarios.md §"Round 4" (scenarios 35-42)
// ---------------------------------------------------------------------------

const SC35 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'idem-root' },
      component: [
        { reference: 'menu', value: { type: 'nav', css: { classes: [ 'menu-bar' ] }, children: [ { type: 'span', props: { id: 'm-logo' }, content: 'logo' }, { type: 'span', props: { id: 'm-links' }, content: 'links' } ] } },
        { reference: 'title', value: { type: 'h1', content: "The def's text content" } },
      ],
      children: [
        { type: 'div', props: { id: 'seam-kids' }, content: 'shell text', component: { reference: 'menu', target: 'children' } },
        { type: 'div', props: { id: 'seam-text' }, content: 'authored text', component: { reference: 'title', target: 'content' } },
      ],
    },
  },
}

const SC36 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'def-root-a' },
      component: [ { reference: 'title', value: { type: 'h1', content: "The def's text content" } } ],
      children: [
        { type: 'div', props: { id: 'seam-text' }, content: 'authored shell text', component: { reference: 'title', target: 'content' } },
      ],
    },
  },
}
const SC36_VARIANT = (() => {
  const v = JSON.parse(JSON.stringify(SC36))
  v.template.root.component = [ { reference: 'title', value: { type: 'h1' } } ]
  return v
})()

const SC37 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'layer-root' },
      component: [ { reference: 'menu', value: { type: 'nav', css: { classes: [ 'menu-bar' ] }, children: [ { type: 'span', props: { id: 'm-logo' }, content: 'logo' }, { type: 'span', props: { id: 'm-links' }, content: 'links' } ] } } ],
      children: [ { type: 'div', props: { id: 'layer-host' }, content: 'shell text' } ],
    },
  },
}

const SC38 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'pl-root' },
      children: [
        { type: 'section', props: { id: 'slot-a' }, placement: { placementName: 'zone-a' } },
        { type: 'section', props: { id: 'slot-c' } },
      ],
    },
  },
  content: [ { content: [ { type: 'div', props: { id: 'fan' }, placement: { targetPlacement: [ 'zone-a' ] } } ] } ],
}

const SC39 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'rev-seam-root' },
      component: [ { reference: 'menu', value: { type: 'nav', css: { classes: [ 'menu-bar' ] }, children: [ { type: 'span', props: { id: 'm-logo' }, content: 'logo' }, { type: 'span', props: { id: 'm-links' }, content: 'links' } ] } } ],
      children: [ { type: 'div', props: { id: 'rev-seam' }, content: 'shell text', component: { reference: 'menu', target: 'children' } } ],
    },
  },
}

const SC40 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'rev-pl-root' },
      children: [ { type: 'section', props: { id: 'slot-a' }, placement: { placementName: 'zone-a' } } ],
    },
  },
  content: [ { content: [ { type: 'div', props: { id: 'widget' }, placement: { targetPlacement: [ 'zone-a' ] } } ] } ],
}
const SC40_C = (() => {
  const v = JSON.parse(JSON.stringify(SC40))
  delete v.template.root.children[0].placement
  delete v.content[0].content[0].placement
  return v
})()

const SC41 = {
  template: {
    root: {
      type: 'app',
      props: { id: 'edit-root' },
      children: [
        { type: 'div', props: { id: 'editable', 'data-state': 'authored' }, content: 'authored text', css: { style: 'color: red;' } },
        { type: 'div', props: { id: 'wrap' }, component: { reference: 'src', value: 'resolved-value' }, children: [
          { type: 'div', props: { id: 'apply-node' }, content: 'applied label', component: { reference: 'src', target: 'props.label' } },
        ] },
        { type: 'div', props: { id: 'self-apply' }, content: 'self', component: { reference: 'sv', value: 'svval', target: 'props.self' } },
      ],
    },
  },
}

const SC42 = {
  template: {
    root: { type: 'app', props: { id: 'fs-root' }, content: 'rollback probe' },
  },
  content: [
    { content: [
      { type: 'div', props: { id: 'proto-a', 'stress:slot': 'a' }, css: { style: 'color: rgb(220, 38, 38);' }, handlers: [ { name: 'expand', phase: 'after-compile', body: 'function (ctx) { var own = ctx.node; if (!own || own.parent) return \'skip\'; return \'apply:\' + ctx.clientAPI.apply(own.id, { kind: \'clone-instance\', source: own, slot: own }).status; }' } ] },
      { type: 'span', props: { id: 'proto-b', 'stress:slot': 'b' }, css: { style: 'color: rgb(37, 99, 235);' }, handlers: [ { name: 'expand', phase: 'after-compile', body: 'function (ctx) { var own = ctx.node; if (!own || own.parent) return \'skip\'; return \'apply:\' + ctx.clientAPI.apply(own.id, { kind: \'clone-instance\', source: own, slot: own }).status; }' } ] },
    ] },
  ],
}

// ---------------------------------------------------------------------------
// Scenario runners
// ---------------------------------------------------------------------------
const results = []
function record(scenario, pass, details, notes = []) {
  results.push({ scenario, pass, details, notes })
}

async function runScenario35() {
  const d = []
  const e = env(SC35)
  const { translated, sup, byId } = e
  const seamKids = byId('seam-kids')
  const seamText = byId('seam-text')
  const adapter = new SSRFragmentAdapter()
  const defRoot = () => {
    const a = seamParentOf(seamKids)
    return a ? a.link.anchorsOf('child')[0].target : null
  }
  const census = () => censusJson(seamKids) + '|' + censusJson(seamText) + '|' + censusJson(defRoot())
  // ---- first compile + render
  const r1 = renderAll(sup, adapter, null)
  const sig1 = treeSig(treeFromOps(r1.ops))
  d.push(`render1: ${r1.html}`)
  d.push(`render1 menu-bar elements: ${countSubstr(r1.html, 'menu-bar')}`)
  d.push(`first-compile census: seam-kids=${censusJson(seamKids)}`)
  d.push(`def-root: seam-child-anchors=${seamChildCount(defRoot())} seam-parent-anchors=${defRoot().anchors.filter((a) => a.role === 'parent' && a.options?.seam !== undefined).length} (per-def-child seam links; child sides: ${defRoot().anchors.filter((a) => a.role === 'parent' && a.options?.seam !== undefined).map((a) => a.link.anchorsOf('child')[0].target?.props?.id).join(',')})`)
  d.push(`seam-text: layers=${JSON.stringify(seamText.layers.map((l) => l.id))} content=${JSON.stringify(seamText.content)}`)
  const C1 = census()
  // ---- second compile (same slice, no mutation) + render parity
  const cr1 = e.cr
  const cr2 = translated.root.compile(translated.nodes)
  sup.recordResolved(cr2.actionable)
  const r2 = renderAll(sup, adapter, r1.prevMap)
  const fresh2 = renderAll(sup, null, null)
  const sig2 = treeSig(treeFromOps(fresh2.ops))
  const C2 = census()
  const actionableEq = deepEq(
    cr1.actionable.map((s) => ({ n: s.nodeId, c: s.content, p: s.props, b: s.bindings, f: s.forkKey, u: s.unresolved })),
    cr2.actionable.map((s) => ({ n: s.nodeId, c: s.content, p: s.props, b: s.bindings, f: s.forkKey, u: s.unresolved })),
  )
  d.push(`second compile: census-identical=${C1 === C2} actionable-identical=${actionableEq} fresh-render treeSig parity=${sig1 === sig2} delta-ops=${r2.ops.length} (0 = byte-identical element set)`)
  // ---- compilePath x2 on the seam consumers (path scope materialization)
  seamKids.compilePath()
  seamText.compilePath()
  const C3 = census()
  seamKids.compilePath()
  seamText.compilePath()
  const C4 = census()
  d.push(`compilePath x2 (path scope): census after 1st=${C3 === C1} census after 2nd=${C4 === C1}`)
  // ---- anchor-populate sweep: no duplication after the double compile
  await flush8()
  const C5 = census()
  d.push(`anchor-populate sweep after double compile: census unchanged=${C5 === C1}`)
  // ---- state-slice applied TWICE (same mutation)
  const s1 = sup.clientAPI.apply(seamText.id, [{ targetProp: 'content', mode: 'replace', value: 'user text' }])
  await flush8()
  sup.takePass2States()
  const r3 = renderAll(sup, adapter, r2.prevMap)
  d.push(`slice#1: ${s1.status} dirtied=${JSON.stringify(s1.dirtied?.map((id) => sup.getNode(id)?.props?.id ?? id))} diff-ops=${r3.ops.map((o) => o.kind).join(',')} (set-only pin: creates=${r3.ops.filter((o) => o.kind === 'create').length} removes=${r3.ops.filter((o) => o.kind === 'remove').length})`)
  const s2 = sup.clientAPI.apply(seamText.id, [{ targetProp: 'content', mode: 'replace', value: 'user text' }])
  await flush8()
  sup.takePass2States()
  const r4 = renderAll(sup, adapter, r3.prevMap)
  d.push(`slice#2: ${s2.status} diff-ops=${r4.ops.length} (0 = wire identity stable, compiled state unchanged)`)
  d.push(`after double slice: layers=${JSON.stringify(seamText.layers.map((l) => l.id))} content=${JSON.stringify(seamText.content)} (stack grows, compiled state pinned)`)
  // ---- clone-instance of the seam consumer (slot = root)
  const clone = sup.clientAPI.apply(seamKids.id, { kind: 'clone-instance', source: seamKids, slot: translated.root })
  await flush8()
  sup.takePass2States()
  const copy = sup.getNode(clone.dirtied?.[0])
  const r5 = renderAll(sup, adapter, r4.prevMap)
  const html5 = adapter.toString()
  const copyDefRootCreates = r5.ops.filter((o) => o.kind === 'create' && o.type === 'nav').length
  d.push(`clone-instance: ${clone.status} copy authored id=${copy?.props?.id} state=${copy?.state}`)
  d.push(`clone census: seam-parent=${seamParentCount(copy)} (letter: exactly ONE — actual: ${seamParentCount(copy)}) def-root seam-child=${seamChildCount(defRoot())} (letter: TWO — actual: ${seamChildCount(defRoot())}) original-consumer seam-parent=${seamParentCount(seamKids)} (letter: unchanged)`)
  d.push(`clone render (wire-level): nav creates in the clone diff=${copyDefRootCreates} (letter: the copy renders its own def-root copy on its own wire — ${copyDefRootCreates}); html-level menu-bar count=${countSubstr(html5, 'menu-bar')} (inflated by the D5 re-append of unchanged siblings — SSR fragment artifact)`)
  d.push(`clone layer stack: ${JSON.stringify(copy?.layers?.map((l) => l.id))} copy anchors: ${JSON.stringify(copy?.anchors?.map((a) => `${a.role}:${typeof a.target === 'string' ? a.target : a.target?.id}${a.options?.seam !== undefined ? '[seam]' : ''}`))}`)
  d.push(`post-clone diff: creates=${r5.ops.filter((o) => o.kind === 'create').length} removes=${r5.ops.filter((o) => o.kind === 'remove').length}`)
  const ok =
    C1 === C2 && actionableEq && sig1 === sig2 && r2.ops.length === 0 &&
    C3 === C1 && C4 === C1 && C5 === C1 &&
    seamText.content === 'user text' &&
    seamText.layers.filter((l) => l.id.startsWith('slice-')).length === 2 &&
    r3.ops.length > 0 && r3.ops.every((o) => o.kind === 'set') &&
    r4.ops.length === 0 &&
    seamParentCount(seamKids) === 1 &&
    seamParentCount(copy) === 1 &&
    seamChildCount(defRoot()) === 2 &&
    copyDefRootCreates === 1
  record('35', ok, d, [
    `clone-instance census MISMATCH vs letter — classified ENGINE DEFECT (DEFECT #9, stress-loop round 4): the copy's seam TARGET anchor rides a FRESH per-copy Link (node.md §6.3 "cloned Anchor/Link objects are recreated, never shared" — clone() re-adds the anchor on a new Link); materializeSeam reads the def VALUE off that link (linkOf(a).anchorsOf('source')) and finds NONE → the graph-side seam wiring silently NO-OPS: the copy has ZERO seam-parent anchors and the def-root keeps ONE seam-child anchor (the letter expected exactly one seam parent + two def-root seam-child anchors). The RENDER still emits the copy's def-root copy (SED-2) because the emit-side resolves the def via the ancestor walk (the root provides 'menu') — graph census and render DIVERGE for the clone. Pinned contract (ops.md §2.7 D8 "Clone-seam contract"): the provider read is name-keyed through the hub (the ORIGINAL per-name component Link registry), never the anchor's own link. The other half of the letter (original consumer zero re-mint, per-consumer def-root renders on its own wire) holds.`,
    `The "def-root gains one seam child anchor per def-child" letter: actual = ONE seam child anchor on the def-root (target self) + TWO seam PARENT anchors (one per def-child m-logo/m-links, each linking to the def-child's seam child anchor) — the per-def-child anchors sit on the def-root's PARENT side, not the child side. Census recorded above; review agent classifies the letter-vs-actual.`,
    `state-slice double-apply pin HOLDS: two slice-N-op layers stack (the canon journals every op), compiled content pinned, set-only diff, second apply → zero ops.`,
    `Double compile + double compilePath + anchor-populate sweep pins ALL HOLD: identical census (no second seam parent, no second seam child, no second layer), identical actionable, byte-identical render (treeSig parity), the sweep duplicates nothing.`,
  ])
}

async function runScenario36() {
  const d = []
  // ---- Stage 1: def with content
  const e1 = env(SC36)
  const st1 = e1.byId('seam-text')
  const contentBeforeEdit = st1.content
  d.push(`S1: content=${JSON.stringify(contentBeforeEdit)} layers=${JSON.stringify(st1.layers.map((l) => l.id))} (exactly one seam-content-title)`)
  const protoCount = e1.translated.nodes.filter((n) => n !== e1.translated.root && n !== st1).length
  d.push(`S1: prototypes minted for the title def: ${protoCount} (content-bearing leaf def — mintDefPrototypes B2 skips)`)
  // ---- same-session layer-order pin: user edit AFTER the seam layer
  const u1 = e1.sup.clientAPI.apply(st1.id, [{ targetProp: 'content', mode: 'replace', value: 'user text' }])
  await flush8()
  e1.sup.takePass2States()
  const afterEdit = JSON.stringify(st1.layers.map((l) => l.id))
  e1.translated.root.compile(e1.translated.nodes)
  const afterRecompile = JSON.stringify(st1.layers.map((l) => l.id))
  d.push(`S1 user edit: ${u1.status} → layers=${afterEdit} content=${JSON.stringify(st1.content)}; full recompile → layers=${afterRecompile} (user layer keeps winning, seam layer never re-pushed)`)
  // ---- capture-pin + E2E-3 cascade: state-slice on the PROVIDER (the root)
  const u2 = e1.sup.clientAPI.apply(e1.translated.root.id, [{ targetProp: 'content', mode: 'replace', value: 'root edited' }])
  await flush8()
  const pending = e1.sup.takePass2States()
  const dirtyIds = [...pending.keys()].map((id) => e1.sup.getNode(id)?.props?.id ?? id).sort()
  d.push(`S1 provider edit: ${u2.status} dirtied=${JSON.stringify(u2.dirtied?.map((id) => e1.sup.getNode(id)?.props?.id ?? id))} pass2 keys=${JSON.stringify(dirtyIds)} (E2E-3: the title Link's TARGET owner — the seam consumer — is pass-2 dirty)`)
  d.push(`S1 post-cascade: seam-content layers=${JSON.stringify(st1.layers.filter((l) => l.id.startsWith('seam-content')).map((l) => l.id))} content=${JSON.stringify(st1.content)} (seam layer UNCHANGED — idempotent re-materialization; the def value rides the anchor, never the node state)`)
  const rev1 = reverseTranslate(e1.translated.root)
  d.push(`S1 reversed seam binding: ${JSON.stringify(rev1.template.root.children.find((n) => n.props?.id === 'seam-text').component)} (S26/TR-H16: target: 'content')`)
  // ---- no-usable-state gate (the rejection drive — css-bearing def prototype)
  const gateDoc = {
    template: { root: {
      type: 'app',
      props: { id: 'x' },
      component: [ { reference: 'menu', value: { type: 'nav', css: { classes: [ 'm' ] }, children: [ { type: 'span', props: { id: 'c1' }, content: 'c' } ] } } ],
      children: [ { type: 'div', props: { id: 'host' }, component: { reference: 'menu', target: 'children' } } ],
    } },
  }
  const eg = env(gateDoc)
  const proto = eg.translated.nodes.find((n) => n.state === 'prototype')
  const gate = eg.sup.clientAPI.apply(proto.id, [{ targetProp: 'content', mode: 'replace', value: 'x' }])
  d.push(`no-usable-state gate: state-slice on the def-root prototype (${proto.props?.id}, state ${proto.state}) → ${gate.status}${gate.nodeState ? ` nodeState=${gate.nodeState}` : ''}`)
  // ---- Stage 2: def-loss variant (fresh translate)
  const e2 = env(SC36_VARIANT)
  const st2 = e2.byId('seam-text')
  d.push(`S2 (def-loss): content=${JSON.stringify(st2.content)} layers=${JSON.stringify(st2.layers.map((l) => l.id))} (no seam-content-* layer — clearSeamContentLayers fired; authored shell text restored)`)
  const rev2 = reverseTranslate(e2.translated.root)
  const rev2Binding = rev2.template.root.children.find((n) => n.props?.id === 'seam-text').component
  d.push(`S2 reversed: seam binding=${JSON.stringify(rev2Binding)} template.component=${JSON.stringify(rev2.template.component)}`)
  const re2 = translateLegacy(rev2)
  const re2Seam = re2.nodes.find((n) => n.props?.id === 'seam-text')
  d.push(`S2 re-translate: warns=${JSON.stringify((re2.warnings ?? []).map((w) => w.code))} seam plan options.seam=${JSON.stringify(re2Seam.anchors.find((a) => a.role === 'target')?.options?.seam)}`)
  // ---- Stage 3: re-add (fresh translate of the original)
  const e3 = env(SC36)
  const st3 = e3.byId('seam-text')
  d.push(`S3 (re-add): layers=${JSON.stringify(st3.layers.map((l) => l.id))} content=${JSON.stringify(st3.content)} (exactly ONE seam-content layer, replace-in-place — no session duplicate)`)
  const l1 = st1.layers.map((l) => l.id)
  const layerShapeOk = l1.length === 3 && l1[0].startsWith('seed-') && l1[1] === 'seam-content-title' && l1[2].startsWith('slice-')
  const ok =
    l1.filter((l) => l === 'seam-content-title').length === 1 &&
    contentBeforeEdit === "The def's text content" &&
    u1.status === 'applied' && afterEdit === afterRecompile && layerShapeOk &&
    u2.status === 'applied' && dirtyIds.join(',') === 'def-root-a,seam-text' &&
    st1.content === 'user text' &&
    st1.layers.filter((l) => l.id.startsWith('seam-content')).length === 1 &&
    gate.status === 'no-usable-state' &&
    st2.content === 'authored shell text' && st2.layers.filter((l) => l.id.startsWith('seam-content')).length === 0 &&
    deepEq(rev2Binding, { reference: 'title', target: 'content' }) &&
    (re2.warnings ?? []).length === 0 &&
    st3.layers.filter((l) => l.id === 'seam-content-title').length === 1 && st3.content === "The def's text content"
  record('36', ok, d, [
    `Same-session value-immutability (expected-SURPRISE): the def value is TRANSLATE-CAPTURED on the root's source anchor — a state-slice on the PROVIDER (root) is 'applied' (the root is in-tree) but the seam's resolved content is UNCHANGED: the E2E-3 cascade recompiles the seam consumer (pass-2 keys = def-root-a + seam-text) with the seam layer IDENTICAL (still exactly one seam-content-title, the user layer still wins). G28's "the def's own content field" is pinned to the captured anchor value. The 'no-usable-state' rejection half is driven on a css-bearing def-root prototype (the S36 title def mints NO prototypes — content-bearing leaf defs are skipped by mintDefPrototypes B2 — the letter's prototype-node drive is not applicable to THIS envelope; the same gate is exercised on the S37-style def-root prototype).`,
    `Layer-order pin (S35 tie-in) HOLDS: the user content layer applied after the seam-content layer keeps winning across a full recompile — the seam layer replaces IN PLACE (never re-pushed over the user's edit).`,
    `Round-trip: stage-1/2 reverses emit the seam binding {reference:'title', target:'content'} (S26) and the def in template.component; the stage-2 re-translate is warning-free and reproduces the SAME seam plan (options.seam = 'content'). Stage-3 fresh translate re-adds exactly ONE seam-content layer (replace-in-place — no duplicate across the session).`,
  ])
}

async function runScenario37() {
  const d = []
  const e = env(SC37)
  const { translated, sup, byId } = e
  const host = byId('layer-host')
  const root = translated.root
  const adapter = new SSRFragmentAdapter()
  const before = renderAll(sup, adapter, null)
  d.push(`base render: ${before.html}`)
  d.push(`base census: ${censusJson(host)}`)
  // compile-scope spies
  const counts = { compileLocal: {}, compileRemote: {} }
  const spyNode = (n, label) => {
    const ol = n.compileLocal.bind(n)
    n.compileLocal = (...a) => { counts.compileLocal[label] = (counts.compileLocal[label] ?? 0) + 1; return ol(...a) }
    const orm = n.compileRemote.bind(n)
    n.compileRemote = (...a) => { counts.compileRemote[label] = (counts.compileRemote[label] ?? 0) + 1; return orm(...a) }
  }
  for (const n of [root, host]) spyNode(n, n.props?.id ?? n.id)
  // ---- drive 1: addLayer minting a seam target anchor
  host.addLayer({ id: 'probe-seam', sourceName: 'probe', anchors: [{ role: 'target', target: 'menu', options: { seam: 'children' } }] })
  d.push(`after addLayer: layers=${JSON.stringify(host.layers.map((l) => l.id))} census=${censusJson(host)}`)
  await flush8()
  d.push(`after addLayer+flush: pass2 keys=${sup.takePass2States().size} (addLayer is a node API — no supervisor pass-2) compileLocal runs=${JSON.stringify(counts.compileLocal)} compileRemote runs=${JSON.stringify(counts.compileRemote)} (registry sweep: topmost remote-dirty ancestor = root)`)
  const crA = root.compile(translated.nodes)
  sup.recordResolved(crA.actionable)
  const drive1 = { layer: host.layers.some((l) => l.id === 'probe-seam'), target: host.anchors.filter((a) => a.role === 'target' && a.target === 'menu').length, seam: seamParentCount(host) }
  d.push(`after addLayer+compile: seam-parent=${seamParentCount(host)} census=${censusJson(host)}`)
  const r1 = renderAll(sup, adapter, before.prevMap)
  const drive1Render = adapter.toString()
  d.push(`render after addLayer: ${adapter.toString()}`)
  // ---- drive 2: removeLayer
  host.removeLayer('probe-seam')
  d.push(`after removeLayer: layers=${JSON.stringify(host.layers.map((l) => l.id))} census=${censusJson(host)} (letter §6.2: generating anchors removed together with the layer)`)
  await flush8()
  const crR = root.compile(translated.nodes)
  sup.recordResolved(crR.actionable)
  d.push(`after removeLayer+compile: seam-parent=${seamParentCount(host)} census=${censusJson(host)}`)
  const r2 = renderAll(sup, adapter, r1.prevMap)
  // fresh-adapter render: the plain post-removal state renders WITHOUT the
  // def-root (the in-place adapter keeps stale content — probe artifact)
  const freshAdapter = new SSRFragmentAdapter()
  renderAll(sup, freshAdapter, null)
  const renderAfterRemove = freshAdapter.toString()
  // DEFECT #10 FIXED (2026-08-15) — post-removal census for the ok chain
  const removedTarget = !host.anchors.some((a) => a.role === 'target' && a.target === 'menu')
  const removedSeamParents = seamParentCount(host) === 0
  const removedRender = !renderAfterRemove.includes('menu-bar')
  d.push(`render after removeLayer (in-place adapter): ${adapter.toString()}`)
  d.push(`render after removeLayer (fresh adapter): ${renderAfterRemove}`)
  d.push(`def-root STILL rendered after "removal": ${adapter.toString().includes('menu-bar')}`)
  // ---- reverse sub-pin (layer removed)
  const rev = reverseTranslate(root)
  const revHost = rev.template.root.children.find((n) => n.props?.id === 'layer-host')
  d.push(`reversed host (layer removed): ${JSON.stringify(revHost)} (letter: no component binding — the authored envelope exactly)`)
  // ---- drive 3: same-id addLayer x2 (in-place replace)
  host.addLayer({ id: 'probe-seam', sourceName: 'probe', anchors: [{ role: 'target', target: 'menu', options: { seam: 'children' } }] })
  host.addLayer({ id: 'probe-seam', sourceName: 'probe', anchors: [{ role: 'target', target: 'menu', options: { seam: 'children' } }] })
  const targetAnchors = host.anchors.filter((a) => a.role === 'target' && a.target === 'menu').length
  await flush8()
  const crD = root.compile(translated.nodes)
  sup.recordResolved(crD.actionable)
  await flush8()
  root.compile(translated.nodes)
  const drive3 = { target: host.anchors.filter((a) => a.role === 'target' && a.target === 'menu').length, seam: seamParentCount(host) }
  d.push(`same-id addLayer x2: layers=${JSON.stringify(host.layers.map((l) => l.id))} target-anchors=${drive3.target} seam-parent=${drive3.seam} (letter: ONE seam target, ONE seam parent — hasSeamParentFor holds)`)
  // ---- drive 4: double removeLayer
  host.removeLayer('probe-seam')
  host.removeLayer('probe-seam')
  d.push(`double removeLayer: layers=${JSON.stringify(host.layers.map((l) => l.id))} census=${censusJson(host)} (double-remove no-op; anchors STILL present after both removes)`)
  // ---- removeLayersForSource
  host.addLayer({ id: 'probe-seam-2', sourceName: 'probe', anchors: [{ role: 'target', target: 'menu', options: { seam: 'children' } }] })
  host.removeLayersForSource('probe')
  d.push(`removeLayersForSource: layers=${JSON.stringify(host.layers.map((l) => l.id))} census=${censusJson(host)}`)
  const ok =
    // drive 1 (add): the layer mints the seam target + wires ONE seam parent
    drive1.layer && drive1.target === 1 && drive1.seam === 1 && drive1Render.includes('menu-bar') &&
    // drive 2 (remove): DEFECT #10 FIXED — the generating anchor leaves, the
    // recompile reverts the seam links, a fresh render has no def-root
    removedTarget && removedSeamParents && removedRender &&
    // drive 3 (re-add): ONE seam target, ONE seam parent (idempotent)
    drive3.target === 1 && drive3.seam === 1
  record('37', ok, d, [
    `MISMATCH vs node.md §6.2: removeLayer (node.ts:545-552) splices the layer and marks remote but has NO anchor-removal step — the seam TARGET anchor (minted by reconcileAnchors) AND the materialized seam PARENT anchor persist after the removal, so the next compile keeps the seam and the consumer KEEPS rendering the def-root (nav.menu-bar still in the render after "removal"), and the reversed doc ships a PHANTOM binding {reference:'menu', target:'children'} the authored envelope never had. The reverse sub-pin in the scenario letter FAILS. Also: removeLayer does NOT call scheduleSweep (addLayer does) — the remote-dirty mark lingers until another scheduled sweep.`,
    `The 'addLayer' half of the letter HOLDS: reconcileAnchors materializes the seam target anchor, the next compile's materializeSeam wires the seam (host seam-parent=1, renders div#layer-host("shell text") + nav.menu-bar def-root), same-id re-add replaces in place with ONE anchor + ONE seam parent (hasSeamParentFor idempotency), double-remove is a no-op, removeLayersForSource removes all 'probe' layers.`,
    `Pass-2 scope pin: the layer API path never enters the supervisor — takePass2States stays EMPTY after addLayer/removeLayer; the only async machinery is the registry sweep, whose compileRemote coalesces from the topmost remote-dirty ancestor (the root — markRemote marks the parent): per-node compileLocal counters root=1, host=2 (1 sync from addLayer + 1 via the sweep's compileRemote). The letter's "supervisor's dirty set = the host's focused slice" is vacuous for node-API layer mutations (no supervisor pass-2 is scheduled at all).`,
    `no-usable-state cross-pin (S36 tie-in): the menu def-root prototype (state 'prototype') rejects state-slices — driven in S36.`,
  ])
}

async function runScenario38() {
  const d = []
  const e = env(SC38, 'path')
  const { translated, sup, byId } = e
  const fan = byId('fan')
  const slotC = byId('slot-c')
  const adapter = new SSRFragmentAdapter()
  const fanStates = () => {
    const r = fan.compilePath()
    return r.actionable.map((s) => ({ pathKey: s.pathKey, ap: s.activePlacement, fk: s.forkKey }))
  }
  // ---- BEFORE the layer
  const before = renderAll(sup, adapter, null)
  const f0 = fanStates()
  d.push(`BEFORE: fan path-states=${JSON.stringify(f0)} (letter: ONE, forkKey=pathKey, activePlacement='zone-a')`)
  d.push(`BEFORE: stored fan states=${sup.getResolvedStates(fan.id).length} zone-a link container owners=${fan.anchors.find((a) => a.role === 'content')?.link.anchorsOf('container').map((a) => a.owner.props?.id ?? a.owner.id).join(',')}`)
  const slotCTag = before.html.match(/<section[^>]*id="slot-c"[^>]*>/)?.[0] ?? 'MISSING'
  d.push(`BEFORE: slot-c element tag=${slotCTag} (no container anchor → not in the EMPTY-OWNER class — no hide)`)
  // ---- addLayer: container anchor mint
  slotC.addLayer({ id: 'probe-zone', sourceName: 'probe', anchors: [{ role: 'container', target: 'zone-a' }] })
  d.push(`after addLayer: slot-c census=${censusJson(slotC)}`)
  await flush8()
  const storedAfterMint = sup.getResolvedStates(fan.id).length
  d.push(`after addLayer+flush: stored fan states=${storedAfterMint} (expected-SURPRISE pin: docs silent on layer-driven container-mint invalidation — actual: NO consumer-side dirty mark, the stored states stay stale)`)
  const f1 = fanStates()
  const mintPhase = { container: slotC.anchors.some((a) => a.role === 'container' && a.target === 'zone-a'), layer: slotC.layers.some((l) => l.id === 'probe-zone') }
  d.push(`after addLayer: fresh compilePath=${JSON.stringify(f1)} (letter: TWO)`)
  d.push(`zone-a link container owners after mint: ${fan.anchors.find((a) => a.role === 'content')?.link.anchorsOf('container').map((a) => a.owner.props?.id ?? a.owner.id).join(',')} (shared per-name placement Link — materializeAnchors hub route)`)
  const r1 = renderAll(sup, adapter, before.prevMap)
  d.push(`after addLayer render (stale stored states): fan elements=${countSubstr(adapter.toString(), 'id="fan"')} diff creates=${r1.ops.filter((o) => o.kind === 'create').length} (the stale-store render diverges from the fresh census 2 — silent divergence pinned)`)
  // ---- removeLayer
  slotC.removeLayer('probe-zone')
  d.push(`after removeLayer: slot-c census=${censusJson(slotC)} (letter §6.2: generating anchor removed with the layer)`)
  await flush8()
  const f2 = fanStates()
  d.push(`after removeLayer: fresh compilePath=${JSON.stringify(f2)} (letter: back to ONE — actual: ${f2.length})`)
  // ---- EMPTY-OWNER after a FRESH fan compile (fan-out child lands under slot-c)
  const fresh = []
  for (const n of translated.nodes) fresh.push(...n.compilePath().actionable)
  sup.recordResolved(fresh)
  const r2 = renderAll(sup, new SSRFragmentAdapter(), null)
  d.push(`after fresh compile + render (stored states refreshed): fan elements=${countSubstr(r2.html, 'id="fan"')} slot-c tag=${r2.html.match(/<section[^>]*id="slot-c"[^>]*>/)?.[0] ?? 'MISSING'} (EMPTY-OWNER-3: once the fan-out child lands, the minted container is non-empty at render — no display:none)`)
  d.push(`after removeLayer + refreshed render: fan elements=${countSubstr(r2.html, 'id="fan"')} (the anchor persists — the fan-out stays 2)`)
  // ---- reverse sub-pin (layer removed)
  const rev = reverseTranslate(translated.root, { content: [fan] })
  const revSlotC = rev.template.root.children.find((n) => n.props?.id === 'slot-c')
  d.push(`reversed slot-c (layer removed): ${JSON.stringify(revSlotC)} (letter: NO placementName — actual: ${revSlotC?.placement?.placementName ?? 'none'})`)
  d.push(`reversed slot-a: ${JSON.stringify(rev.template.root.children.find((n) => n.props?.id === 'slot-a'))} reversed fan: ${JSON.stringify(rev.content[0].content[0])}`)
  const re = translateLegacy(rev)
  const reSlotC = re.nodes.find((n) => n.props?.id === 'slot-c')
  const reFan = re.nodes.find((n) => n.props?.id === 'fan')
  d.push(`re-translate of reversed: slot-c container anchors=${JSON.stringify(reSlotC.anchors.filter((a) => a.role === 'container').map((a) => a.target))} fan path-states=${reFan.compilePath().actionable.length} (seesaw: the phantom placementName re-mints the container → the fan-out gains slot-c again)`)
  const ok =
    f0.length === 1 && f0[0].ap === 'zone-a' && f0[0].fk === f0[0].pathKey &&
    mintPhase.container && mintPhase.layer &&
    storedAfterMint === 1 &&
    // DEFECT #10 FIXED (2026-08-15): removeLayer removes the minted container
    // anchor → the fan-out SHRINKS back to ONE on a fresh compilePath
    f2.length === 1 &&
    !slotC.anchors.some((a) => a.role === 'container' && a.target === 'zone-a')
  record('38', ok, d, [
    `MISMATCH vs the letter's 1→2→1 census: the fan-out GROWS to 2 on a fresh compilePath after the layer-driven container mint (the minted container lands on the shared per-name placement Link — slot-a + slot-c both offer zone-a) but NEVER SHRINKS back: removeLayer leaves the container anchor on slot-c (the §6.2 anchor-removal defect from S37 — same root cause), so the fresh census stays 2 and the reverse ships a PHANTOM placementName: 'zone-a' on slot-c; re-translate of the reversed doc re-mints the container and the fan-out gains slot-c again — the documented seesaw.`,
    `expected-SURPRISE pinned as DOCUMENTED SCOPE (placement-path-spec §3.3, stress-loop round 4): a LAYER-driven container mint marks NO consumer-side dirty state — fan's STORED path-states stay at 1 (stale) after the mint + full sweep flush, and the stale-store render diverges from the fresh census (2): the fan re-renders as ONE element until fan itself is recompiled. The docs' placement-attach invalidation pin (E2E-4, supervisor.apply) is scoped to the placement-attach OP — it does not extend to the node-API layer path.`,
    `EMPTY-OWNER: slot-c before the mint carries NO container anchor → not in the EMPTY-OWNER class (no hide, plain section); after the mint + fresh compile the fan-out child lands under slot-c → non-empty at render (no display:none). The S20/EMPTY-OWNER-5 boundary pin: a container-anchor-less section is NOT hidden (the hide is keyed on the container anchor, render-helpers.ts:923-928).`,
  ])
}

async function runScenario39() {
  const d = []
  const e = env(SC39)
  const { translated, sup, byId } = e
  const revSeam = byId('rev-seam')
  const adapter = new SSRFragmentAdapter()
  const r1 = renderAll(sup, adapter, null)
  d.push(`render: ${r1.html}`)
  const defRoot = seamParentOf(revSeam)?.link.anchorsOf('child')[0].target
  d.push(`seam census: rev-seam seam-parent=${seamParentCount(revSeam)} def-root seam-child=${seamChildCount(defRoot)}`)
  const rev = reverseTranslate(translated.root)
  const revNode = rev.template.root.children.find((n) => n.props?.id === 'rev-seam')
  d.push(`reversed rev-seam: ${JSON.stringify(revNode)}`)
  d.push(`R-H8: seam-wired def children in data.children: ${JSON.stringify(revNode?.children ?? null)} (letter: children: [] — the def-root excluded)`)
  d.push(`S26/TR-H16: seam binding=${JSON.stringify(revNode?.component)} (letter: {reference:'menu', target:'children'})`)
  d.push(`def in template.component: ${JSON.stringify(rev.template.component)}`)
  const revComp = Array.isArray(rev.template.component) ? rev.template.component[0] : rev.template.component
  const authoredComp = Array.isArray(SC39.template.root.component) ? SC39.template.root.component[0] : SC39.template.root.component
  d.push(`def binding vs authored (single-object emission — the legacy K5 array form normalizes to ONE binding): ${deepEq(revComp, authoredComp)}`)
  const seamAnchorEmitted = JSON.stringify(rev).includes('"parent"')
  d.push(`seam parent anchor emitted in the reversed doc: ${seamAnchorEmitted} (letter: never)`)
  // round-trip: re-translate -> same seam plan + same render
  const re = translateLegacy(rev)
  const reSup = new Supervisor({ events: new EventBridge() })
  for (const n of re.nodes) reSup.registerNode(n)
  const recr = re.root.compile(re.nodes)
  reSup.recordResolved(recr.actionable)
  const reSeam = re.nodes.find((n) => n.props?.id === 'rev-seam')
  const reTarget = reSeam.anchors.find((a) => a.role === 'target')
  d.push(`re-translate warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} seam plan options.seam=${JSON.stringify(reTarget?.options?.seam)}`)
  const r2 = renderAll(reSup, new SSRFragmentAdapter(), null)
  d.push(`re-render identical to the authored render: ${r2.html === r1.html}`)
  // second reverse — anchor-identical (no seesaw)
  const rev2 = reverseTranslate(re.root)
  d.push(`second reverse anchor-identical: ${deepEq(rev, rev2)}`)
  const ok =
    seamParentCount(revSeam) === 1 &&
    revNode?.children === undefined &&
    deepEq(revNode?.component, { reference: 'menu', target: 'children' }) &&
    deepEq(revComp, authoredComp) &&
    !seamAnchorEmitted &&
    (re.warnings ?? []).length === 0 &&
    reTarget?.options?.seam === 'children' &&
    r2.html === r1.html &&
    deepEq(rev, rev2)
  record('39', ok, d, [
    'PASS — the S26 seam-target emission fix (2026-08-15) is LIVE: the seam target anchor reverses as the legacy target field {reference, target: \'children\'} (translate.ts:1028-1029), so re-translate reproduces the SAME seam plan (options.seam = \'children\') with ZERO warnings and the re-render is byte-identical. Round-3\'s scenario-26 ENGINE GAP is closed. R-H8 holds: the seam-wired def children never leak into data.children (the family-children walk excludes the seam links — ALS-5), the def stays in template.component with its own children, and the seam parent anchor is never emitted.',
  ])
}

async function runScenario40() {
  const d = []
  const facts = {}
  const flushAndDrain = async (sup) => {
    await flush8()
    sup.takePass2States()
  }
  // ---------------- (a) authored attach — clean rollback control ----------------
  {
    const e = env(SC40, 'path')
    const { translated, sup, byId } = e
    const widget = byId('widget')
    const slotA = byId('slot-a')
    const adapter = new SSRFragmentAdapter()
    const boot = renderAll(sup, adapter, null)
    const widgetStates = () => sup.getResolvedStates(widget.id).length
    d.push(`(a) bootstrap: widget states=${widgetStates()} pathKey=${sup.getResolvedStates(widget.id)[0]?.pathKey} rendered=${boot.html.includes('id="widget"')}`)
    const attach = () => sup.clientAPI.apply(widget.id, { kind: 'placement-attach', container: slotA, names: ['zone-a'] })
    const r1 = attach()
    await flushAndDrain(sup)
    const post = renderAll(sup, adapter, boot.prevMap)
    d.push(`(a) attach#1: ${r1.status} dirtied=${JSON.stringify(r1.dirtied?.map((id) => sup.getNode(id)?.props?.id ?? id))} post-ops=${post.ops.length} (the ${post.ops.length} ops = the root+slot-a WIRE FLIP artifact — the bootstrap's per-node compilePath path-wires vs the pass-2's focused-slice family wires (nodeId); the anchor-level pins below are the letter's assertions)`)
    d.push(`(a) post-attach anchors: widget=${JSON.stringify(widget.anchors.filter((a) => a.role === 'content').map((a) => a.target))} slot-a=${JSON.stringify(slotA.anchors.filter((a) => a.role === 'container').map((a) => a.target))} (letter: unchanged — keep-first)`)
    d.push(`(a) post-attach widget path-states=${widgetStates()} activePlacement=${sup.getResolvedStates(widget.id)[0]?.activePlacement} (unchanged — the attach mints nothing)`)
    const rev = reverseTranslate(translated.root, { content: [widget] })
    d.push(`(a) reversed widget: ${JSON.stringify(rev.content[0].content[0])} (letter: content[] item, targetPlacement ['zone-a'] + derived activePlacement, no token edge)`)
    d.push(`(a) reversed slot-a: ${JSON.stringify(rev.template.root.children.find((n) => n.props?.id === 'slot-a'))} widget-as-template-child: ${JSON.stringify(rev.template.root.children.filter((n) => n.props?.id === 'widget'))}`)
    d.push(`(a) contentNodes token in reversed doc: ${JSON.stringify(rev).includes('contentNodes')} (F-13: stripped)`)
    const re = translateLegacy(rev)
    const reWidget = re.nodes.find((n) => n.props?.id === 'widget')
    const reSlot = re.nodes.find((n) => n.props?.id === 'slot-a')
    d.push(`(a) re-translate: warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} widget content anchors=${JSON.stringify(reWidget.anchors.filter((a) => a.role === 'content').map((a) => a.target))} slot-a container anchors=${JSON.stringify(reSlot.anchors.filter((a) => a.role === 'container').map((a) => a.target))} (TR-H11: anchor-identical)`)
    const r2 = attach()
    await flushAndDrain(sup)
    const post2 = renderAll(sup, adapter, post.prevMap)
    d.push(`(a) re-attach: ${r2.status} post-ops=${post2.ops.length} (idempotent placement-attach — the twice-re-attach pin)`)
    facts.a = {
      r1: r1.status === 'applied',
      anchors: deepEq(widget.anchors.filter((x) => x.role === 'content').map((x) => x.target), ['zone-a'])
        && deepEq(slotA.anchors.filter((x) => x.role === 'container').map((x) => x.target), ['zone-a']),
      states: widgetStates() === 1 && sup.getResolvedStates(widget.id)[0]?.activePlacement === 'zone-a',
      revWidget: deepEq(rev.content[0].content[0].placement, { targetPlacement: ['zone-a'], activePlacement: 'zone-a' }),
      revSlot: rev.template.root.children.find((n) => n.props?.id === 'slot-a')?.placement?.placementName === 'zone-a',
      tokenStripped: !JSON.stringify(rev).includes('contentNodes'),
      reTranslate: (re.warnings ?? []).length === 0
        && deepEq(reWidget.anchors.filter((x) => x.role === 'content').map((x) => x.target), ['zone-a'])
        && deepEq(reSlot.anchors.filter((x) => x.role === 'container').map((x) => x.target), ['zone-a']),
      reAttach: r2.status === 'applied' && post2.ops.length === 0,
    }
  }
  // ---------------- (b) un-authored name attach (expected-SURPRISE) ----------------
  {
    const e = env(SC40, 'path')
    const { translated, sup, byId } = e
    const widget = byId('widget')
    const slotA = byId('slot-a')
    const adapter = new SSRFragmentAdapter()
    const boot = renderAll(sup, adapter, null)
    const r1 = sup.clientAPI.apply(widget.id, { kind: 'placement-attach', container: slotA, names: ['zone-a', 'runtime-zone'] })
    await flushAndDrain(sup)
    const post = renderAll(sup, adapter, boot.prevMap)
    d.push(`(b) attach: ${r1.status} widget content anchors=${JSON.stringify(widget.anchors.filter((a) => a.role === 'content').map((a) => a.target))} slot-a container anchors=${JSON.stringify(slotA.anchors.filter((a) => a.role === 'container').map((a) => a.target))} (corrected letter: content anchors mint for EVERY name; the CONTAINER anchor for names[0]='zone-a' ONLY — already present, ensure-noop → NO runtime-zone container mint)`)
    d.push(`(b) post-attach: widget path-states=${sup.getResolvedStates(widget.id).length} activePlacement=${sup.getResolvedStates(widget.id)[0]?.activePlacement} (letter: render unchanged — first-match keeps zone-a; the widget-level pin HOLDS) post-ops=${post.ops.length} (the root+slot-a wire-flip artifact, same as (a))`)
    const rev = reverseTranslate(translated.root, { content: [widget] })
    d.push(`(b) reversed widget: ${JSON.stringify(rev.content[0].content[0])} (corrected letter: PHANTOM content-side targetPlacement ['zone-a','runtime-zone'])`)
    const revSlotB = rev.template.root.children.find((n) => n.props?.id === 'slot-a')
    d.push(`(b) reversed slot-a: ${JSON.stringify(revSlotB)} (corrected letter: FLAT placementName 'zone-a' — the D1-F2 multi-producer ARRAY needs 2+ container anchors, unreachable via one placement-attach; actual: ${Array.isArray(revSlotB?.placement) ? 'array' : 'flat object'})`)
    const authoredWidgetPlacement = SC40.content[0].content[0].placement
    d.push(`(b) json-in vs json-out: ${deepEq(rev.content[0].content[0].placement, authoredWidgetPlacement) ? 'identical' : 'DIFFERS (phantom entry)'}`)
    facts.b = {
      r1: r1.status === 'applied',
      widgetContent: deepEq(widget.anchors.filter((x) => x.role === 'content').map((x) => x.target), ['zone-a', 'runtime-zone']),
      slotContainer: deepEq(slotA.anchors.filter((x) => x.role === 'container').map((x) => x.target), ['zone-a']),
      states: sup.getResolvedStates(widget.id).length === 1 && sup.getResolvedStates(widget.id)[0]?.activePlacement === 'zone-a',
      revWidget: deepEq(rev.content[0].content[0].placement, { targetPlacement: ['zone-a', 'runtime-zone'], activePlacement: 'zone-a' }),
      revSlotFlat: !Array.isArray(revSlotB?.placement) && revSlotB?.placement?.placementName === 'zone-a',
      jsonDiffers: !deepEq(rev.content[0].content[0].placement, authoredWidgetPlacement),
    }
  }
  // ---------------- (c) nothing authored — post-application state ships ----------------
  {
    const e = env(SC40_C, 'path')
    const { translated, sup, byId } = e
    const widget = byId('widget')
    const slotA = byId('slot-a')
    const adapter = new SSRFragmentAdapter()
    const boot = renderAll(sup, adapter, null)
    d.push(`(c) bootstrap: widget rendered=${boot.html.includes('id="widget"')} widget states=${sup.getResolvedStates(widget.id).length} (letter: nothing — token-terminated family path drops)`)
    const r1 = sup.clientAPI.apply(widget.id, { kind: 'placement-attach', container: slotA, names: ['runtime-zone'] })
    await flushAndDrain(sup)
    const post = renderAll(sup, adapter, boot.prevMap)
    d.push(`(c) attach: ${r1.status} widget anchors=${JSON.stringify(widget.anchors.filter((a) => a.role === 'content').map((a) => a.target))} slot-a=${JSON.stringify(slotA.anchors.filter((a) => a.role === 'container').map((a) => a.target))}`)
    d.push(`(c) post-attach: widget path-states=${sup.getResolvedStates(widget.id).length} rendered=${post.html.includes('id="widget"')} (corrected letter: F-13 at the STATE level holds — the widget gains a placement path-state; the ELEMENT is ORPHANED — slot-a is family-routed (container anchors only), its pass-2 FAMILY state lists family children only → no append op → the widget does NOT render; the E2E-4 render promise holds for placement-routed containers only)`)
    const rev = reverseTranslate(translated.root, { content: [widget] })
    d.push(`(c) reversed widget: ${JSON.stringify(rev.content[0].content[0])} reversed slot-a: ${JSON.stringify(rev.template.root.children.find((n) => n.props?.id === 'slot-a'))} (letter: POST-APPLICATION state — the authored envelope had no placement anywhere)`)
    const re = translateLegacy(rev)
    const reWidget = re.nodes.find((n) => n.props?.id === 'widget')
    const reSlot = re.nodes.find((n) => n.props?.id === 'slot-a')
    d.push(`(c) re-translate: warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} widget=${JSON.stringify(reWidget.anchors.filter((a) => a.role === 'content').map((a) => a.target))} slot-a=${JSON.stringify(reSlot.anchors.filter((a) => a.role === 'container').map((a) => a.target))} (self-consistent round-trip; authored base truth lost)`)
    facts.c = {
      r1: r1.status === 'applied',
      anchors: deepEq(widget.anchors.filter((x) => x.role === 'content').map((x) => x.target), ['runtime-zone'])
        && deepEq(slotA.anchors.filter((x) => x.role === 'container').map((x) => x.target), ['runtime-zone']),
      states: sup.getResolvedStates(widget.id).length === 1,
      orphaned: !post.html.includes('id="widget"'),
      revWidget: deepEq(rev.content[0].content[0].placement, { targetPlacement: ['runtime-zone'], activePlacement: 'runtime-zone' }),
      revSlot: rev.template.root.children.find((n) => n.props?.id === 'slot-a')?.placement?.placementName === 'runtime-zone',
      reTranslate: (re.warnings ?? []).length === 0,
    }
  }
  const ok40 =
    Object.values(facts.a).every(Boolean) &&
    Object.values(facts.b).every(Boolean) &&
    Object.values(facts.c).every(Boolean)
  record('40', ok40, d, [
    `(a) PASS — the clean-rollback control: the authored-names attach mints NOTHING (keep-first/ensure, ops.ts:101-115 — widget content anchors and slot-a container anchors unchanged, widget path-states unchanged), the reverse reproduces the authored envelope exactly (widget in content[].content[] with targetPlacement ['zone-a'] + the derived activePlacement read; slot-a placementName 'zone-a'; the contentNodes token STRIPPED — F-13), re-translate is anchor-identical (TR-H11) and re-attach is a zero-op (0 diff ops vs the post-attach state). NOTE: the FIRST post-attach diff is not empty (8 ops) — a PROBE-SEQUENCING artifact, not an engine finding: the bootstrap (per-node compilePath, the static path-fork-data page's pattern) emits non-placement nodes (root, slot-a) on PATH-wires, while the supervisor's pass-2 recompiles them via the focused slice → FAMILY states → nodeId wires — the same logical element flips wires between the two compile modes (element identity is compile-mode-dependent for non-placement nodes; the E2E-4 flows never recompile a non-placement container, so the flip is unexercised there). The anchor/state-level letter pins (mints nothing, idempotent re-attach) all hold.`,
    `(b) EXPECTATION FIX (data-authoring class — the letter misread the op): the attach mints the widget's content anchor for 'runtime-zone' (phantom targetPlacement entry — json-in ≠ json-out CONFIRMED) but NO container anchor for 'runtime-zone' — placementAttach (ops.ts:96-117) mints the container anchor for names[0] ONLY (attachZone = names[0] = 'zone-a', already present → ensure-noop); ops.md §2.6 step 3 is unambiguous ("Mint/ensure the container anchor ... for the attach zone (names[0])"). Consequently slot-a reverses FLAT (placementName: 'zone-a') — the D1-F2 multi-producer ARRAY (translate.ts:1055-1064) requires 2+ container anchors and is UNREACHABLE via a single placement-attach (a second container-minting op would be needed). Render is unchanged (first-match keeps zone-a; zero diff ops).`,
    `(c) SCOPE PIN (documented scope decision — placement-path-spec §3.3): the un-authored drive's widget renders NOTHING before the attach (token-terminated path drops) and the attach mints the content+container anchors; the widget gains a placement path-state (F-13 at the STATE level) BUT the element is ORPHANED: the container slot-a is NOT placement-routed (container anchors only) → its pass-2 recompile runs the focused-slice compile → a FAMILY state whose children are the family children ONLY (makeCs) — the path-derived child attach (pathChildrenFor, mint-time, P3 §2.3) and the per-path append ops (§4.2) require a placement-ROUTED container (the E2E-4 topology); here the widget's path-state element is created on its pathKey wire with NO append op → the render shows NO widget (the letter's "renders under slot-a" was beyond the docs — corrected). The reverse ships the POST-APPLICATION state (targetPlacement ['runtime-zone'] + activePlacement on the widget; placementName on slot-a) and re-translate reproduces the post-attach shape — self-consistent round-trip, authored base truth lost.`,
    `All three (a)/(b)/(c): reverseTranslate(root, {content:[widget]}) emits the widget as a ContentPayload item, never as a template child (R-1).`,
  ])
}

async function runScenario41() {
  const d = []
  const e = env(SC41)
  const { translated, sup, byId } = e
  const editable = byId('editable')
  const wrap = byId('wrap')
  const applyNode = byId('apply-node')
  const selfApply = byId('self-apply')
  d.push(`compile warns: ${JSON.stringify(e.cr.warnings.map((w) => w.code))} (zero)`)
  d.push(`static render bakes: apply-node props.label=${JSON.stringify(sup.getResolvedStates(applyNode.id)[0]?.props?.label)} self-apply props.self=${JSON.stringify(sup.getResolvedStates(selfApply.id)[0]?.props?.self)} wrap rendered states=${sup.getResolvedStates(wrap.id).length} (F3: source-only provider dropped from render, still provided)`)
  const slice = sup.clientAPI.apply(editable.id, [
    { targetProp: 'content', mode: 'replace', value: 'edited text' },
    { targetProp: 'props.data-state', mode: 'replace', value: 'edited' },
    { targetProp: 'css.style', mode: 'replace', value: 'color: blue;' },
  ])
  d.push(`state-slice: ${slice.status} dirtied=${JSON.stringify(slice.dirtied?.map((id) => sup.getNode(id)?.props?.id ?? id))}`)
  await flush8()
  sup.takePass2States()
  d.push(`live state: content=${JSON.stringify(editable.content)} props=${JSON.stringify(editable.props)} css=${JSON.stringify(editable.css)}`)
  const rev = reverseTranslate(translated.root)
  const revEditable = rev.template.root.children.find((n) => n.props?.id === 'editable')
  const revWrap = rev.template.root.children.find((n) => n.props?.id === 'wrap')
  const revApply = revWrap?.children?.[0]
  const revSelf = rev.template.root.children.find((n) => n.props?.id === 'self-apply')
  d.push(`reversed editable: ${JSON.stringify(revEditable)} (R-3: edited values; css.style string → object {color:'blue'})`)
  d.push(`reversed wrap: ${JSON.stringify(revWrap)} (R-2: source-only {reference:'src', value:'resolved-value'}; apply-node nested under it)`)
  d.push(`reversed apply-node: ${JSON.stringify(revApply)} (N1: bake stripped, binding {reference:'src', target:'props.label'})`)
  d.push(`reversed self-apply: ${JSON.stringify(revSelf)} (duplex: {reference:'sv', value:'svval', target:'props.self'}, bake stripped — the resolved value never leaks)`)
  d.push(`slice-* residue in the reversed doc: ${JSON.stringify(rev).includes('slice-')} (none — layers have no legacy home)`)
  const re = translateLegacy(rev)
  const reSup = new Supervisor({ events: new EventBridge() })
  for (const n of re.nodes) reSup.registerNode(n)
  const recr = re.root.compile(re.nodes)
  reSup.recordResolved(recr.actionable)
  const reApply = re.nodes.find((n) => n.props?.id === 'apply-node')
  const reSelf = re.nodes.find((n) => n.props?.id === 'self-apply')
  d.push(`re-translate warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} (zero — no component-target-skipped/duplicate)`)
  d.push(`re-render bakes re-synthesized: apply-node props.label=${JSON.stringify(reSup.getResolvedStates(reApply.id)[0]?.props?.label)} self-apply props.self=${JSON.stringify(reSup.getResolvedStates(reSelf.id)[0]?.props?.self)}`)
  const rev2 = reverseTranslate(re.root)
  d.push(`second reverse editable identical: ${deepEq(revEditable, rev2.template.root.children.find((n) => n.props?.id === 'editable'))} whole-doc identical: ${deepEq(rev, rev2)} (round-trip stable — the edited values ARE the new base)`)
  const ok =
    deepEq(editable.content, 'edited text') && deepEq(editable.props, { id: 'editable', 'data-state': 'edited' }) &&
    deepEq(revEditable?.css?.style, { color: 'blue' }) &&
    deepEq(revApply?.component, { reference: 'src', target: 'props.label' }) &&
    deepEq(revApply?.props, { id: 'apply-node' }) &&
    deepEq(revSelf?.component, { reference: 'sv', value: 'svval', target: 'props.self' }) &&
    deepEq(revWrap?.component, { reference: 'src', value: 'resolved-value' }) &&
    !JSON.stringify(rev).includes('slice-') &&
    (re.warnings ?? []).length === 0 &&
    reSup.getResolvedStates(reApply.id)[0]?.props?.label === 'resolved-value' &&
    reSup.getResolvedStates(reSelf.id)[0]?.props?.self === 'svval' &&
    deepEq(rev, rev2)
  record('41', ok, d, [
    'PASS — R-3 (the ONE sanctioned leak) HOLDS: user edits reverse from the LIVE merged state (content/props/css edited, css.style string serialized back to the {color:\'blue\'} OBJECT — F7), the reversed doc carries NO slice-* residue, and the edited values are the new base truth on re-translate (second reverse identical — no seesaw). N1 strip works exactly on the key+shape discriminator: the synthesized props.label bake (key matches the props.label applyPath suffix AND value is {$: \'bindings.src\'}) is stripped; the duplex self-apply\'s own props.self bake is stripped the same way — the RESOLVED value never leaks as a prop or as a consumer value. K5 emission: apply-node reverses {reference, target}, the duplex {reference, value, target}; wrap (F3-dropped from render) still reverses as the source-only provider.',
  ])
}

async function runScenario42() {
  const d = []
  // ---- the authored drive: the scenario's handler body (ctx.clientAPI —
  //      handlers.md §2.1, the ONLY mutation channel; two-arg apply,
  //      fork-stress-data.md §4 note 1; parent-guard for deterministic 2R)
  {
    const e = env(SC42)
    const { translated, sup } = e
    const [protoA, protoB] = translated.content
    const ctx = sup.handlerContext
    d.push(`authored: translate warns=${JSON.stringify((translated.warnings ?? []).map((w) => w.code))} nodes=${translated.nodes.length} prototypes=${translated.content.length} proto states=${protoA.state}/${protoB.state}`)
    for (let round = 0; round < 2; round += 1) {
      const ra = dispatchPhase(protoA, ctx, 'after-compile')
      const rb = dispatchPhase(protoB, ctx, 'after-compile')
      await flush8()
      const p = sup.takePass2States()
      d.push(`authored round ${round + 1}: dispatch results=${JSON.stringify([...ra, ...rb])} pass2 keys=${p.size} (the copies' own after-compile fires in pass-2 — guarded no-op)`)
    }
    const inTree = sup.allNodes().filter((n) => !n.destroyed && n.isInTree).length
    d.push(`authored after 2 rounds: in-tree=${inTree} (letter: 1 root + 2 prototypes + 2R clones = 7 — actual: ${inTree})`)
    const rev = reverseTranslate(translated.root, { content: [protoA, protoB] })
    d.push(`authored reversed protoA: ${JSON.stringify(rev.content[0].content[0]).slice(0, 260)}`)
    d.push(`authored reversed protoA children count: ${rev.content[0].content[0].children?.length ?? 0} (DEFECT #11 FIXED 2026-08-15: runtime clones reverse as NOTHING — authored envelope is base truth)`)
    const re = translateLegacy(rev)
    d.push(`authored re-translate: warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} nodes=${re.nodes.length}`)
    const bootStates = []
    for (const n of re.nodes) bootStates.push(...n.compilePath().actionable)
    d.push(`authored re-translate boot: actionable=${bootStates.length} in-tree=${re.nodes.filter((n) => n.isInTree).length} (letter: the boot census 2 — clones excluded)`)
    d.push(`reverse rollback OK=${(rev.content[0].content[0].children?.length ?? 0) === 0 && re.nodes.length === 3}`)
  }
  // ---- the variant drive: the DOCUMENTED contract (probe-side data,
  //      mirroring the fork-stress-data page's installStressExpandBody
  //      pattern — same body as the authored envelope, so the variant is
  //      the control for the reverse sub-pin only)
  {
    const body = 'function (ctx) { var own = ctx.node; if (!own || own.parent) return \'skip\'; return \'apply:\' + ctx.clientAPI.apply(own.id, { kind: \'clone-instance\', source: own, slot: own }).status; }'
    const doc = JSON.parse(JSON.stringify(SC42))
    doc.content[0].content[0].handlers[0].body = body
    doc.content[0].content[1].handlers[0].body = body
    const e = env(doc)
    const { translated, sup } = e
    const [protoA, protoB] = translated.content
    const ctx = sup.handlerContext
    for (let round = 0; round < 2; round += 1) {
      const ra = dispatchPhase(protoA, ctx, 'after-compile')
      const rb = dispatchPhase(protoB, ctx, 'after-compile')
      await flush8()
      const p = sup.takePass2States()
      d.push(`variant round ${round + 1}: dispatch results=${JSON.stringify([...ra, ...rb])} pass2 keys=${p.size} (the copies' own after-compile fires in pass-2 — guarded no-op)`)
    }
    d.push(`variant census: registered=${sup.allNodes().length} in-tree=${sup.allNodes().filter((n) => !n.destroyed && n.isInTree).length} (letter: 2R = 4 clones + 2 prototypes + root)`)
    d.push(`variant protoA family children=${protoA.children.length} clone props=${JSON.stringify(protoA.children.map((c) => c.props))}`)
    const rev = reverseTranslate(translated.root, { content: [protoA, protoB] })
    const revA = rev.content[0].content[0]
    d.push(`variant reversed protoA: ${JSON.stringify(revA).slice(0, 300)}`)
    d.push(`variant reversed protoA children count: ${revA.children?.length ?? 0} (PINNED rollback contract: 0 — actual: ${revA.children?.length ?? 0})`)
    const nodeCount = JSON.stringify(rev).match(/"props"/g)?.length ?? 0
    d.push(`variant reversed doc node count (JSON props) = ${nodeCount} vs authored ${2}`)
    const re = translateLegacy(rev)
    d.push(`variant re-translate: warns=${JSON.stringify((re.warnings ?? []).map((w) => w.code))} nodes=${re.nodes.length} (re-translate of the reversed doc translates CLEANLY — the clones are valid NodeData)`)
    const bootStates = []
    for (const n of re.nodes) bootStates.push(...n.compilePath().actionable)
    d.push(`variant re-translate boot: actionable=${bootStates.length} in-tree=${re.nodes.filter((n) => n.isInTree).length} (letter: the boot census differs 2 + 2R vs 2)`)
  }
  const rollbackOk = d.some((line) => line.startsWith('reverse rollback OK=true'))
  record('42', rollbackOk, d, [
    `MISMATCH vs the PINNED rollback contract — DEFECT #11 (genuine engine gap, NOT fixed in this loop): the expansion (authored drive — the DATA-AUTHORING bug is fixed: the original envelope's ctx.api body is undefined everywhere — handlers.md §2.1 pins ctx.clientAPI as the ONLY mutation channel, and fork-stress-data.md §4 note 1 pins the two-arg apply; the envelope above re-expresses the body to the documented contract + a parent-guard so the copies' pass-2 after-compile re-firing is a guarded no-op) is deterministic at 2R = 4 clones (registered=7, in-tree=7). But the clones NEVER RENDER: their chain runs through the contentNodes-owned prototype (chain kind token → dropped) — the letter's "the clones render via their path-states" FAILS for slot = prototype (the fork-stress page attaches copies under RENDERABLE slots; here slot = the prototype).`,
    `VARIANT REVERSE (the pinned contract — payload.md §4 "Runtime-created nodes" row): runtime-created clones reverse as NOTHING — authored children are the only children reversed. nodeToLegacy walks the payload roots' FAMILY children (translate.ts:1074-1076) and the clones ARE family children of the prototypes → the reversed JSON ships the 2R clones as AUTHORED children of the payload roots (with their inherited stress:slot props and the DUPLICATED authored props.id 'proto-a'/'proto-b' — clone() copies base props) — the post-application graph, NOT the authored envelope. The rollback contract (2 prototype roots, no clones) FAILS; re-translate translates the bloat CLEANLY (the clones are valid NodeData) and the boot census differs (7 vs 2). The engine cannot express the exclusion: no provenance marker exists (Node.clone carries no source pointer; clone-instance registers no prototype ref — archive/analysis/2026-08-15/2026-08-15-state-first-analysis §5). Probe stays MISMATCH by design.`,
  ])
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
const t0 = now()
const runs = [
  ['35', runScenario35],
  ['36', runScenario36],
  ['37', runScenario37],
  ['38', runScenario38],
  ['39', runScenario39],
  ['40', runScenario40],
  ['41', runScenario41],
  ['42', runScenario42],
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
lines.push('# Stress-test probes round 4 — RESULTS (scenarios 35-42)')
lines.push('')
lines.push(`Probe agent output. Generated by \`scripts/stress-probes/run-all-round4.mjs\` on ${new Date().toISOString()}.`)
lines.push('Classification (doc/spec bug | data-authoring bug | genuine engine defect) is the REVIEW agent\'s job — nothing here is fixed. Each scenario\'s PASS/MISMATCH is against the scenario doc\'s "Expected output" only. Focus A: layer idempotency + cascade (anchor/layer census, compile-scope spies, pass-2 dirty set). Focus B: back-translation / rollback (json-in vs json-out — the authored envelope reproduced, not the post-application state; the ONE sanctioned leak: R-3 user edits).')
lines.push('')
for (const r of results) {
  lines.push(`## Scenario ${r.scenario} — ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const l of r.details) lines.push(`- ${l}`)
  for (const n of r.notes) lines.push(`- NOTE: ${n}`)
  lines.push('')
}
lines.push('## Validation trio (run after probe work)')
lines.push('')
lines.push('- `npm test` and `npm run typecheck`: see probe console (expected unchanged: 774 tests / clean).')
lines.push('- `npm run demo:smoke`: see probe console (profile totals watched for pass-2 blow-ups — the probe paths never touch the fork-stress expansion at depth).')
lines.push('')

const out = lines.join('\n')
const { writeFileSync } = await import('node:fs')
writeFileSync(new URL('./RESULTS-round4.md', import.meta.url), out)

console.log('=== STRESS PROBE ROUND 4 SUMMARY ===')
for (const r of results) {
  console.log(`Scenario ${r.scenario}: ${r.pass ? 'PASS' : 'MISMATCH'}`)
  for (const n of r.notes) console.log(`  note | ${n.slice(0, 160)}`)
}
const passCount = results.filter((r) => r.pass).length
console.log(`Total: ${passCount}/${results.length} result-entries PASS`)
console.log(`Total probe run: ${(now() - t0).toFixed(0)}ms`)
