// diagnostic: where do the auth buttons live in the REAL envelope after compile?
import { readFileSync } from 'node:fs'
import { translateLegacy } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'

const env = JSON.parse(readFileSync(new URL('../../live-prod/placeholderLanding/placeholderLanding.json', import.meta.url), 'utf8'))
const t = translateLegacy(env)
const sup = new Supervisor({ events: new EventBridge() })
for (const n of t.nodes) sup.registerNode(n)
const cr = t.root.compile(t.nodes)
const actionableIds = new Set(cr.actionable.map((cs) => cs.arm[0]))
console.log('actionable:', cr.actionable.length, 'dropped:', cr.dropped.length)
for (const n of t.nodes.filter((n) => n.anchors.some((a) => a.options.handlerEvent !== undefined))) {
  console.log(`${n.content ?? n.type} id=${n.id} state=${n.state} layers=${n.layers.length} actionable=${actionableIds.has(n.id)}`)
  const p = n.parent
  console.log(`  parent: ${p ? p.id + ' ' + (p.content ?? p.type) + ' state=' + p.state : 'NULL (token)'}`)
}
console.log('--- def-root prototypes ---')
for (const n of t.nodes.filter((n) => n.state === 'prototype')) {
  console.log(`${n.content ?? n.type} id=${n.id} state=${n.state} children=${n.children.length} layers=${n.layers.filter(l=>l.handlers).length}`)
}
