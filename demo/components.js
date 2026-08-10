/**
 * Bonus browser harness — component-driven rendering.
 *
 * Reads the framework data document embedded by scripts/build-demo.mjs
 * (component/placement resolution inputs), re-resolves from the serialized
 * anchors, expands component references into DOM (type/children population +
 * source-value fill), and renders EVERYTHING through the render adapter —
 * the only hand-written HTML is the document skeleton and the #root
 * placeholder. Each test is a content node in the tree; its result is written
 * back through the framework (ClientAPI.apply) and re-rendered via a diff.
 */
import { Node, reconcileParentTargets } from '../dist/core/node.js'
import { diffMinimal } from '../dist/core/render.js'
import { loadState } from '../dist/core/serialize.js'
import { createClient } from '../dist/core/client.js'
import { EventBridge } from '../dist/core/events.js'
import { Supervisor } from '../dist/core/node.js'
import { hub } from './demo-fixtures.js'
import { DomAdapter } from './lib/dom-adapter.js'
import { applyOps, jsonClone } from './lib/render-ops.js'

const initialData = JSON.parse(document.getElementById('preempt-initial-data').textContent)
const serverData = JSON.parse(document.getElementById('server-data').textContent)
const labels = serverData.nodeLabels
const goals = serverData.goals
const byName = {}
for (const [id, l] of Object.entries(labels)) byName[l.name] = id

const rootEl = document.getElementById('root')
const adapter = new DomAdapter(rootEl)

// ---- reconstruct the graph from the shipped document (S4.2) --------------
const seeded = loadState(jsonClone(initialData)).map((d) => new Node(d, hub()))
reconcileParentTargets(seeded)
const events = new EventBridge()
const supervisor = new Supervisor({ hub: hub(), events })
for (const n of seeded) supervisor.registerNode(n)
const clientAPI = createClient(supervisor)

// ---- component expansion (emission layer) --------------------------------
/**
 * Expand one compiled state into renderable elements.
 * - A state whose 'panel' target resolved: the component reference drives the
 *   element TYPE and populates DESCENDANT nodes from the definition; each
 *   child's value comes from its SOURCE reference binding.
 * - Placement states render their resolution label.
 * - Every element carries a label describing the resolution it follows.
 */
function expandState(state, armIdx) {
  const els = []
  const label = (wire, text, cls) => {
    els.push({ wire: `${wire}:label`, type: 'span', props: { 'css:classes': cls ?? ['res-label'], text }, childOrder: [] })
  }
  const classes = state.css?.classes ? [...state.css.classes] : []
  const def = state.bindings['panel']

  if (def) {
    // component reference for type/children → populated descendant nodes
    const wire = `${state.nodeId}#${armIdx}`
    const children = def.children.map((spec) => {
      const cw = `${wire}:${spec.bind}`
      els.push({ wire: cw, type: spec.type, props: { text: state.bindings[spec.bind] ?? '(missing)', 'css:classes': ['bound-value'] }, childOrder: [`${cw}:label`] })
      label(cw, `component: ${spec.bind} (source ref)`, ['res-label', 'child'])
      return cw
    })
    els.push({
      wire,
      type: def.type,
      props: { 'css:classes': ['panel'], 'prop:data-resolution': 'component:panel' },
      childOrder: [...children, `${wire}:label`],
    })
    label(wire, def.label, ['res-label', 'panel-label'])
    return els
  }

  const placement = state.anchors.find((a) => a.role === 'placement')
  const unresolved = state.unresolved.length > 0
  const props = { 'css:classes': classes }
  if (state.content !== undefined) props['text'] = state.content
  if (placement) props['prop:data-resolution'] = `placement:${placement.target}`
  if (unresolved) props['prop:data-resolution'] = 'component:missing → unresolved-reference'
  els.push({ wire: state.nodeId, type: state.type, props, childOrder: [`${state.nodeId}:label`] })
  const labelText = placement
    ? `placement: ${placement.target}`
    : unresolved
      ? 'component: missing → unresolved-reference (own content still renders)'
      : classes.includes('test-item')
        ? 'content node · test (goal updated by the pipeline)'
        : 'content node'
  label(state.nodeId, labelText)
  return els
}

function buildElements(cr) {
  const byNode = new Map()
  for (const s of cr.actionable) {
    const arr = byNode.get(s.nodeId) ?? []
    arr.push(s)
    byNode.set(s.nodeId, arr)
  }
  const els = []
  for (const states of byNode.values()) {
    states.forEach((s, i) => {
      els.push(...expandState(s, states.length > 1 ? i : 0))
    })
  }
  return els
}

let prevMap = null
let cr = null
function render() {
  const rootNode = seeded[0]
  const silent = console.warn
  console.warn = () => {}
  cr = rootNode.compile(seeded)
  console.warn = silent
  const els = buildElements(cr)
  const ops = diffMinimal(prevMap, els)
  applyOps(adapter, ops)
  prevMap = new Map(els.map((e) => [e.wire, e]))
  return { cr, els }
}

function nodeText(wire) {
  const el = adapter.wires.get(wire)
  return el ? el.textContent : ''
}

async function main() {
  render()

  const panelId = byName['panel']
  const zoneId = byName['zone']
  const introId = byName['intro']
  const footerId = byName['footer']
  const testIds = goals.map((_, i) => byName[`t${i + 1}`])
  const introContent = labels[introId].content

  const warnCount = (fn) => {
    let n = 0
    const o = console.warn
    console.warn = () => {
      n++
    }
    try {
      fn()
    } finally {
      console.warn = o
    }
    return n
  }

  const checks = [
    {
      run: () => {
        const arms = cr.actionable.filter((s) => s.nodeId === panelId)
        if (arms.length !== 2) throw new Error(`expected 2 panel arms, got ${arms.length}`)
        if (!arms.every((a) => a.bindings['panel']?.type === 'section')) throw new Error('resolved panel type missing')
        const p0 = adapter.wires.get(`${panelId}#0`)
        const p1 = adapter.wires.get(`${panelId}#1`)
        if (!p0 || p0.tagName !== 'SECTION') throw new Error('arm A panel element not rendered')
        if (!p1 || p1.tagName !== 'SECTION') throw new Error('arm B panel element not rendered')
      },
    },
    {
      run: () => {
        if (!nodeText(`${panelId}#0:heading`).includes('Hello from a component source')) throw new Error('heading source value not populated')
        if (!nodeText(`${panelId}#0:body`).includes('Values resolve from source anchors')) throw new Error('body source value not populated')
        if (!nodeText(`${panelId}#1:heading`).includes('Hello from a component source')) throw new Error('arm B heading not populated')
        if (adapter.wires.get(`${panelId}#0:heading`)?.tagName !== 'H2') throw new Error('populated child wrong type')
      },
    },
    {
      run: () => {
        const zone = adapter.wires.get(zoneId)
        if (!zone) throw new Error('zone element missing')
        if (zone.getAttribute('data-resolution') !== 'placement:slot-alpha') throw new Error(`wrong placement label: ${zone.getAttribute('data-resolution')}`)
        if (!nodeText(`${zoneId}:label`).includes('placement: slot-alpha')) throw new Error('placement resolution label not rendered')
      },
    },
    {
      run: () => {
        for (const id of testIds) {
          if (!adapter.wires.has(id)) throw new Error(`test node ${id} not rendered`)
          if (!nodeText(id).trim()) throw new Error(`test node ${id} has no content`)
        }
      },
    },
    {
      run: () => {
        const warns = warnCount(() => seeded[0].compile(seeded))
        if (warns === 0) throw new Error('expected an unresolved-reference warning')
        const introState = cr.actionable.find((s) => s.nodeId === introId)
        if (!introState?.unresolved?.length) throw new Error('intro should be unresolved')
        if (!nodeText(introId).includes(introContent)) throw new Error('intro own content not rendered')
      },
    },
    {
      run: () => {
        const arms = cr.actionable.filter((s) => s.nodeId === panelId)
        if (arms.length !== 2) throw new Error(`expected 2 arms, got ${arms.length}`)
        if (new Set(arms.map((a) => a.pathKey)).size !== 2) throw new Error('fork arms not distinct')
      },
    },
  ]

  let passed = 0
  for (let i = 0; i < checks.length; i++) {
    try {
      checks[i].run()
      passed++
      clientAPI.apply(testIds[i], [
        { targetProp: 'content', mode: 'replace', value: `PASS — ${goals[i]}` },
        { targetProp: 'css.classes', mode: 'replace', value: ['test-item', 'pass'] },
      ])
    } catch (e) {
      clientAPI.apply(testIds[i], [
        { targetProp: 'content', mode: 'replace', value: `FAIL — ${goals[i]} (${e.message})` },
        { targetProp: 'css.classes', mode: 'replace', value: ['test-item', 'fail'] },
      ])
    }
    render()
  }
  const failed = checks.length - passed
  clientAPI.apply(footerId, [
    {
      targetProp: 'content',
      mode: 'replace',
      value: `Summary: ${passed} passed, ${failed} failed — component & placement resolutions verified in-browser (every element framework-rendered)`,
    },
  ])
  render()
}

main()
