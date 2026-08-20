// DEFECT #24 probe round 2 — the REAL logged-in envelope (live-prod/Logged-inLanding).
// Core-only pipeline. Does placed content resolving into def-internal drop-zones
// (adminLinks/authorLinks/contributorLinks/navAdditionalLinks) survive to emit?
import { readFileSync } from 'node:fs'
import { translateLegacy } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { emitElements } from '../../dist/core/render-helpers.js'

const env = JSON.parse(readFileSync(new URL('../../live-prod/Logged-inLanding/Logged-inLanding.json', import.meta.url), 'utf8'))
let t = translateLegacy(env)
console.log('--- translate ---')
console.log('  warnings:', JSON.stringify(t.warnings.map((w) => w.code)))
const sup = new Supervisor({ events: new EventBridge() })
for (const n of t.nodes) sup.registerNode(n)
const actionable = []
for (const n of t.nodes) actionable.push(...n.compilePath().actionable)
sup.recordResolved(actionable)
console.log('  resolved outs:', actionable.length)

const admin = t.nodes.find((n) => n.props?.href === '/api/admin/dashboard' || (n.content ?? '').includes('Admin'))
const placedLabels = t.nodes.filter((n) => actionable.some((a) => a.nodeId === n.id) && n.type === 'a').map((n) => n.content)
console.log('  placed <a> nodes with actionable states:', JSON.stringify(placedLabels))
console.log('  adminDashboard target states:', actionable.filter((a) => admin && a.nodeId === admin.id).length)
console.log('  --- actionable state nodeIds ---')
for (const a of actionable) {
  const n = t.nodes.find((x) => x.id === a.nodeId)
  console.log(`  nodeId=${a.nodeId} wire=${a.pathKey ?? a.forkKey ?? '?'} type=${a.type} content=${JSON.stringify(a.content ?? '')}`)
}
console.log('  --- all nodes (non-prototype) ---')
for (const n of t.nodes) {
  if (n.state === 'prototype') continue
  console.log(`  ${n.id}: type=${n.type} content=${JSON.stringify(n.content ?? '')} state=${n.state}`)
}

// the zone containers inside the navBar def children — their protos must adopt the
// placed children if the deliverable is met
const zoneContainers = t.nodes.filter((n) => {
  const p = n.placement ?? []
  return Array.isArray(p) ? p.some((x) => x && typeof x === 'object' && x.placementName) : false
})
console.log('  zone-container nodes:', zoneContainers.map((n) => `${n.id}:${n.state}`).join(', '))
console.log('  --- zone containers detail ---')
for (const z of zoneContainers) {
  console.log(`  ${z.id}: state=${z.state} parent=${z.parent?.id ?? 'none'} content=${JSON.stringify(z.content ?? '')}`)
  for (const a of z.anchors ?? []) console.log(`    anchor role=${a.role} target=${typeof a.target === 'string' ? a.target : (Array.isArray(a.target) ? `[${a.target.join(',')}]` : (a.target === null ? 'null' : '[obj]'))} opts=${JSON.stringify({ ...(a.options ?? {}) })}`)
}
console.log('  --- placed consumers (targetPlacement divs) ---')
const consumers = t.nodes.filter((n) => {
  const p = n.placement ?? []
  return Array.isArray(p) && p.some((x) => x && typeof x === 'object' && x.targetPlacement)
})
for (const c of consumers) {
  const st = actionable.filter((a) => a.nodeId === c.id)
  console.log(`  ${c.id}: state=${c.state} type=${c.type} actionable=${st.length} content=${JSON.stringify(c.content ?? '')}`)
  for (const a of c.anchors ?? []) console.log(`    anchor role=${a.role} target=${typeof a.target === 'string' ? a.target : (a.target === null ? 'null' : '[obj]')} opts=${JSON.stringify({ ...(a.options ?? {}) })}`)
}

const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
const els = emitElements(actionable, byNode)
console.log('\n--- emit ---')
console.log('  emitted elements:', els.length)
const placedTexts = els.filter((e) => typeof e.props?.text === 'string' && e.props.text.length > 0 && /admin|create|edit|contrib/i.test(String(e.props.text))).map((e) => e.props.text)
console.log('  emitted admin/auth-ish text els:', JSON.stringify(placedTexts))
const placedAnchors = els.filter((e) => e.type === 'a' && String(e.props?.href ?? '').includes('/api/admin'))
console.log('  emitted admin dashboard anchors:', placedAnchors.length)
const zoneElementWires = els.filter((e) => /menu|content/.test(String(e.wire))).map((e) => e.wire)
console.log('  def-child zone-ish wires:', zoneElementWires.join(','))
console.log('  total <a> els:', els.filter((e) => e.type === 'a').length)
console.log('  --- full emitted tree ---')
for (const e of els) {
  console.log(`  wire=${e.wire} type=${e.type} text=${JSON.stringify(e.props?.text ?? '')} childOrder=${String(e.childOrder ?? '')}`)
}