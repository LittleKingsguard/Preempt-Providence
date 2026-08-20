// DEFECT #24 probe — def-CHILD drop-zone placement (canonical red/green check).
// Core-only: dist/core/* + a minimal legacy envelope. Scenario: a navBar def
// whose child div carries placementName 'adminLinks'; root content packet places
// into that zone. Debugining: does the placed packet survive to emit?
import { translateLegacy } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { emitElements, applyOps } from '../../dist/core/render-helpers.js'
import { diffMinimal } from '../../dist/core/render.js'
import { DomAdapter } from '../../dist/core/adapters.js'
import { SSRFragmentAdapter } from '../../dist/core/adapters.js'

const env = {
  template: {
    root: {
      type: 'app',
      component: [
        {
          reference: 'navBar',
          target: 'children',
          value: {
            type: 'nav',
            css: { display: 'flex' },
            children: [
              { type: 'div', bind: 'menu', placement: [{ placementName: 'adminLinks' }] },
            ],
          },
        },
      ],
      children: [
        { type: 'div', bind: 'shell', placement: [{ placementName: 'rootZone' }], children: [{ type: 'div', bind: 'host', component: [{ reference: 'navBar', target: 'children' }] }] },
      ],
    },
  },
  content: [
    {
      content: [
        { type: 'a', bind: 'link1', content: 'Admin', placement: [{ targetPlacement: ['adminLinks'] }] },
      ],
    },
  ],
}

let t
t = translateLegacy(env)
console.log('--- translate ---')
console.log('  warnings:', JSON.stringify(t.warnings.map((w) => w.code)))
const sup = new Supervisor({ events: new EventBridge() })
for (const n of t.nodes) sup.registerNode(n)
const actionable = []
for (const n of t.nodes) actionable.push(...n.compilePath().actionable)
sup.recordResolved(actionable)
console.log('  resolved outs:', actionable.length)
const inTree = t.nodes.filter((n) => n.state === 'in-tree').map((n) => n.id + ':' + (n.content ?? '')).join(', ')
console.log('  in-tree nodes:', inTree)
console.log('  all nodes:', t.nodes.map((n) => `${n.id}:${n.content ?? ''}:${n.state ?? '?'}`).join(' | '))
const adminContainer = t.nodes.find((n) => n.bind === 'menu')
const placed = t.nodes.find((n) => n.content === 'Admin')
console.log('  adminLinks container found:', adminContainer ? `${adminContainer.id} state=${adminContainer.state}` : 'NONE')
console.log('  placed packet state:', placed?.state, 'id:', placed?.id)
console.log('  --- container (menu) anchors after compile ---')
for (const a of adminContainer?.anchors ?? []) console.log(`    role=${a.role} target=${typeof a.target === 'string' ? a.target : (a.target === null ? 'null' : 'NODE')} opts=${JSON.stringify(a.options ?? {})}`)
console.log('  --- host (seam consumer) anchors ---')
const host = t.nodes.find((n) => n.bind === 'host')
for (const a of host?.anchors ?? []) console.log(`    role=${a.role} target=${typeof a.target === 'string' ? a.target : (a.target === null ? 'null' : 'NODE')} opts=${JSON.stringify(a.options ?? {})}`)

console.log('\n--- emit (emitElements) ---')
const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
const els = emitElements(actionable, byNode)
console.log('  emitted element count:', els.length)
const text = els.map((e) => (typeof e.props?.text === 'string' && e.props.text ? e.props.text : '')).filter(Boolean)
console.log('  text-bearing elements:', JSON.stringify(text))
const adminLinks = els.filter((e) => (e.props?.['placement'] ? true : false) || (e.props?.id ? String(e.props.id).includes('admin') : false))
console.log('  admin-ish els:', adminLinks.map((e) => ({ id: e.props?.id, type: e.type, text: e.props?.text })))
console.log('  els containing "Admin" text prop:', els.filter((e) => e.props?.text === 'Admin').length)

const els2 = emitElements(actionable, byNode)
console.log('  els wires:', els2.map((e) => e.wire).join(','))
for (const e of els2) {
  const keys = Object.keys(e)
  console.log(`  el wire=${e.wire} keys=${keys.length}`)
}
const adapter = new SSRFragmentAdapter()
const ops = diffMinimal(null, els)
applyOps(adapter, ops)
console.log('\n--- placed packet trace ---')
const placedNode = placed
console.log('  placed.parent:', placedNode?.parent?.id ?? 'none')
for (const a of placedNode?.anchors ?? []) console.log(`  anchor role=${a.role} target=${typeof a.target === 'string' ? a.target : (Array.isArray(a.target) ? a.target.join(',') : (a.target === null ? 'null' : Object.keys(a.target ?? {}).join(',')))} opts=${JSON.stringify({ ...(a.options ?? {}), __skip: undefined })}`)
console.log('  placed.bindings:', JSON.stringify(placedNode?.bindings ?? {}))
console.log('  placed.activePlacement:', placedNode?.activePlacement)
const placedStates = actionable.filter((a) => a.nodeId === placed?.id)
console.log('  placed actionable states:', placedStates.length)
for (const s of placedStates) console.log(`  state nodeId=${s.nodeId} pathKey=${s.pathKey ?? 'none'} trace=${(s.trace ?? []).join('/')} children=${(s.children ?? []).join(',')}`)
const containerStates = actionable.filter((a) => a.nodeId === node3id())
console.log('  def-child container (menu) states:', containerStates.length)
for (const s of containerStates) console.log(`  state nodeId=${s.nodeId} pathKey=${s.pathKey ?? 'none'} children=${(s.children ?? []).join(',')}`)
function node3id() { const c = t.nodes.find((n) => n.bind === 'menu'); return c ? c.id : '?' }
console.log('\n--- diff ops ---')
console.log('  op count:', ops.length, '| kinds:', ops.map((o) => o.kind).join(','))