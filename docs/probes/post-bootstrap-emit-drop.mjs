// post-bootstrap-emit-drop.mjs — the re-test 1 arm, handed over by Provident-Electron
// in answer to docs/handoffs-request-arm-modularity-2026-11-23.md.
//
// WHAT THIS IS: the minimal reproduction of the `4 → 0` reading — an authored,
// content-bearing consumer placed at bootstrap (a placement-routed tree), then the
// first post-bootstrap structural change: `registerNode(extra)` + `detach(extra)` +
// `attach(extra → #filler)`. The render goes from four emitted elements to zero.
//
// RUN: plain node, no build, no launch, read-only.
//   node post-bootstrap-emit-drop.mjs                 # imports ../../dist/index.js (this checkout's build)
//   node post-bootstrap-emit-drop.mjs <pkg-dir>       # imports <pkg-dir>/dist/index.js (e.g. an installed 0.5.2)
//
// WHAT IT PRINTS, PER RENDER: the emitted element wires, the per-wire OP STREAM
// (`create` / `set` / `append` / `remove` / `styles`, each with the wire or owner it
// targets), the `prevMap` keys the diff ran against, and the adapter's fragment keys.
// The op stream is the point: it tells "created and never appended" from "emitted then
// removed" without guessing.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const arg = process.argv[2]
const BASE = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '')
const has = (p) => { try { readFileSync(p); return true } catch { return false } }
const entry = arg
  ? (arg.endsWith('.js')
      ? arg
      : (has(`${arg}/node_modules/provident-ssr/dist/index.js`) ? `${arg}/node_modules/provident-ssr/dist/index.js` : `${arg}/dist/index.js`))
  : (has(`${BASE}/node_modules/provident-ssr/dist/index.js`) ? `${BASE}/node_modules/provident-ssr/dist/index.js` : `${BASE}/dist/index.js`)
const pkgDir = entry.slice(0, -'/dist/index.js'.length)
const mod = await import(entry)
const { translateLegacy, Supervisor, SSRFragmentAdapter, renderProducingProcess, focusedSliceFor, VOID_TAGS } = mod
const pkg = JSON.parse(readFileSync(`${pkgDir}/package.json`, 'utf8'))

const J = (v) => JSON.stringify(v, (k, val) => (typeof val === 'function' ? `[Function ${val.name || 'anon'}]` : val))
const idsOf = (html) => [...html.matchAll(/data-node-id="([^"]+)"/g)].map((x) => x[1])
const byId = (t, cssId) => t.nodes.find((n) => (n.css && n.css.id === cssId) || (n.props && n.props.id === cssId))
const idOf = (n) => (n ? n.id : 'undefined')
const wiresOf = (els) => els.map((e) => String(e.wire))

// ---- the host recipe: mirrors src/renderer/runtime.ts's render() ---------------
function setStates(sup, prevStates, actionable) {
  const byNode = new Map()
  for (const s of actionable) {
    const id = s.nodeId
    const arr = byNode.get(id) ?? []
    arr.push(s)
    byNode.set(id, arr)
  }
  for (const [id, arr] of byNode) if (sup.getNode(id)?.isInTree) prevStates.set(id, arr)
}
function mergePass2(sup, prevStates) {
  const pass2 = sup.takePass2States()
  for (const [id, arr] of pass2) if (sup.getNode(id)?.isInTree) prevStates.set(id, arr)
}

function opLine(op) {
  switch (op.kind) {
    case 'create': return `create wire=${J(op.wire)} type=${op.type}`
    case 'set': return `set    wire=${J(op.wire)} name=${op.name} value=${J(op.value)}`
    case 'append': return `append owner=${J(op.owner)} child=${J(op.child)}`
    case 'remove': return `remove wire=${J(op.wire)}`
    case 'styles': return `styles (${(op.cssDefs || []).length} rule(s))`
    default: return `${op.kind} ${J(op)}`
  }
}

function render(sup, series, tag) {
  if (!series.bootstrapped) {
    const routed = series.nodes.some((n) => n.anchors.some((a) => a.role === 'content'))
    if (routed) {
      const actionable = []
      for (const n of series.nodes) actionable.push(...(n.compilePath().actionable ?? []))
      setStates(sup, series.prevStates, actionable)
      sup.recordResolved(actionable)
    } else {
      const cr = series.root.compile(series.nodes)
      setStates(sup, series.prevStates, cr.actionable)
      sup.recordResolved(cr.actionable)
    }
    series.bootstrapped = true
    series.branch = routed ? 'placement-routed (compilePath)' : 'default (root.compile)'
  } else {
    mergePass2(sup, series.prevStates)
  }
  const actionable = []
  for (const states of series.prevStates.values()) actionable.push(...states)
  const nodeBy = new Map(sup.allNodes().map((n) => [n.id, n]))
  for (const id of [...series.prevStates.keys()]) if (!nodeBy.has(id)) series.prevStates.delete(id)
  const live = []
  for (const states of series.prevStates.values()) for (const s of states) live.push(s)
  const out = renderProducingProcess(live, nodeBy, series.ssr, series.prevMap, { nodeIdAttribute: true })
  const html = series.ssr.toString()

  console.log(`\n  --[${tag}] branch=${series.branch}`)
  console.log(`  --[${tag}] states(${live.length}): ${J(live.map((s) => `${s.nodeId}@${String(s.wire ?? s.forkKey ?? s.pathKey ?? '-')}`))}`)
  console.log(`  --[${tag}] prevMap(${series.prevMap ? series.prevMap.size : 'null'}): ${J([...(series.prevMap?.keys() ?? [])])}`)
  console.log(`  --[${tag}] emitted wires(${out.els.length}): ${J(wiresOf(out.els))}`)
  console.log(`  --[${tag}] op stream(${out.ops.length}):`)
  for (const op of out.ops) console.log(`       ${opLine(op)}`)
  console.log(`  --[${tag}] adapter fragments: ${J([...series.ssr.fragments.keys()])} · rootKey=${J(series.ssr.rootKey)}`)
  console.log(`  --[${tag}] html(${html.length} chars): ${html.length === 0 ? '(EMPTY)' : html}`)
  console.log(`  --[${tag}] ids(${idsOf(html).length}): ${J(idsOf(html))}`)

  series.prevMap = out.prevMap
  series.lastHtml = html
  return out
}

// ---- the envelope: an authored, placement-routed content consumer --------------
const tree = translateLegacy({
  template: {
    root: {
      type: 'div', css: { id: 'root' }, props: { id: 'root' },
      children: [
        { type: 'aside', css: { id: 'holder' }, props: { id: 'holder' }, placement: { placementName: 'zone' } },
        { type: 'div', css: { id: 'filler' }, props: { id: 'filler' } },
      ],
    },
    children: [
      // THE AUTHORED CONTENT-BEARING CONSUMER — placement-routed at bootstrap.
      { type: 'div', css: { id: 'card' }, props: { id: 'card' }, placement: { targetPlacement: ['zone'] } },
    ],
  },
  content: [],
  clientConfig: { runInstantiation: true, runRendering: true },
})

const holder = byId(tree, 'holder')
const filler = byId(tree, 'filler')
const card = byId(tree, 'card')

console.log(`node ${process.version} · ${pkg.name}@${pkg.version} · entry ${entry}`)
console.log(`envelope: nodes=${J(tree.nodes.map((n) => n.css?.id ?? '?'))} · content=${J(tree.content.map((n) => n.id))} · warnings=${J(tree.warnings)}`)
console.log(`holder=${idOf(holder)} filler=${idOf(filler)} card=${idOf(card)}`)
console.log(`card anchors=${J(card.anchors.map((a) => ({ role: a.role, target: typeof a.target === 'string' ? a.target : (a.target?.id ?? 'obj') })))}`)

const sup = new Supervisor({})
for (const n of tree.nodes) sup.registerNode(n)
const series = { sup, ssr: new SSRFragmentAdapter(), prevMap: null, prevStates: new Map(), nodes: tree.nodes, root: tree.root, bootstrapped: false, branch: '-', lastHtml: '' }

// ---- R1: bootstrap -------------------------------------------------------------
render(sup, series, 'R1 bootstrap')

// ---- the op sequence after bootstrap ------------------------------------------
// A freshly translated node carries its own child owner-token anchor; `attach` rejects
// single-parent, so the sanctioned path is detach-then-attach (the upstream's reply §2,
// its corrected recipe).
const extraTree = translateLegacy({ template: { root: { type: 'span', props: { id: 'extra' } } }, content: [], clientConfig: { runInstantiation: true, runRendering: true } })
const extra = extraTree.root
console.log(`\nop sequence: registerNode(extra=${extra.id}) · detach(extra) · attach(extra → #filler=${filler.id})`)
console.log(`  extra anchors before: ${J(extra.anchors.map((a) => a.role))}`)
sup.registerNode(extra)
const d = sup.apply({ kind: 'detach', node: extra })
console.log(`  detach → ${J(d)} · anchors now ${J(extra.anchors.map((a) => a.role))}`)
const r = sup.apply({ kind: 'attach', node: extra, to: filler })
console.log(`  attach → ${J(r)}`)
console.log(`  filler.children after attach: ${J(filler.children.map((n) => n.id))}`)

// ---- R2: the first post-bootstrap structural render (host recipe's half) ------
const dirtied = (r.dirtied ?? []).filter((id) => sup.getNode(id)?.isInTree)
console.log(`  dirtied(in-tree): ${J(dirtied)}`)
for (const id of dirtied) {
  const node = sup.getNode(id)
  if (!node) continue
  const cr = node.compile(focusedSliceFor(node, () => sup.allNodes()), { focusNodeId: node.id })
  const grouped = new Map()
  for (const s of cr.actionable) {
    const arr = grouped.get(s.nodeId) ?? []
    arr.push(s)
    grouped.set(s.nodeId, arr)
  }
  for (const [gid, arr] of grouped) if (sup.getNode(gid)?.isInTree) series.prevStates.set(gid, arr)
}
render(sup, series, 'R2 post-apply')
await sup.flush()
mergePass2(sup, series.prevStates)
render(sup, series, 'R3 post-flush')

// ---- the control: the SAME states diffed against an EMPTY prevMap --------------
// The honest post-bootstrap case diffs against the map R1 produced; this arm shows the
// other side of the reply's §1.5 so the two failures are distinguishable.
series.prevMap = null
render(sup, series, 'R4 same states, empty map')
