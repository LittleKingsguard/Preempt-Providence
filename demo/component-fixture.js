/**
 * Bonus demo fixture — component-driven rendering.
 *
 * Pattern exercised: a node containing a TARGET component reference for
 * type/children (resolution populates descendant nodes), with SOURCE
 * component references providing the values populated in those children:
 *
 *   panel-consumer  targets 'panel' (→ type + children), 'heading', 'body'
 *   app (provider)  sources 'panel' ×2 (fork → two arms), 'heading', 'body'
 *
 * Each test below is itself a content node placed in the document tree.
 */
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor } from './demo-fixtures.js'

export const panelDefA = {
  type: 'section',
  label: 'component: panel — arm A (type/children from the target reference)',
  children: [
    { bind: 'heading', type: 'h2' },
    { bind: 'body', type: 'p' },
  ],
}

export const panelDefB = {
  type: 'section',
  label: 'component: panel — arm B (type/children from the target reference)',
  children: [
    { bind: 'heading', type: 'h2' },
    { bind: 'body', type: 'p' },
  ],
}

export const testGoals = [
  'T1 — component reference resolves: the "panel" target drives the resolved type and populates descendant nodes',
  'T2 — source references populate child values: "heading" and "body" resolve into the populated panel children',
  'T3 — placement resolution: the zone element follows placement "slot-alpha" and renders a resolution label',
  'T4 — each test is a content node placed into the tree and rendered by the pipeline',
  'T5 — a dangling reference is unresolved (warning) while the node still renders its own content',
  'T6 — two component sources fork into two arms with distinct path keys; never a coerced pick',
]

export function buildComponentTree() {
  const root = makeRoot({ type: 'app' })
  const header = childOf(root, makeNode({ type: 'p', content: 'Component & placement resolution — every element below is framework-rendered', css: { classes: ['header'] } }), 0)
  const intro = childOf(root, makeNode({ type: 'p', content: 'Only the document skeleton and the #root placeholder are hand-written HTML.', css: { classes: ['intro'] } }), 1)
  targetAnchor(intro, 'missing')
  const panelC = childOf(root, makeNode({ type: 'div', css: { classes: ['panel-wrap'] } }), 2)
  targetAnchor(panelC, 'panel')
  targetAnchor(panelC, 'heading')
  targetAnchor(panelC, 'body')
  const zone = childOf(root, makeNode({ type: 'div', css: { classes: ['zone'] } }), 3)
  const plink = hub().linkFor('slot-alpha', 'placement')
  zone.addAnchor('placement', 'slot-alpha', {}, plink)
  const tests = childOf(root, makeNode({ type: 'section', content: 'Tests — each test below is a content node in this document tree', css: { classes: ['tests'] } }), 4)
  const testNodes = testGoals.map((g, i) => childOf(tests, makeNode({ type: 'div', content: g, css: { classes: ['test-item'] } }), i))
  const footer = childOf(root, makeNode({ type: 'p', content: 'rendered by the preempt pipeline — no other hand-written HTML', css: { classes: ['footer'] } }), 5)
  addComponentSource(root, 'panel', panelDefA)
  addComponentSource(root, 'panel', panelDefB)
  addComponentSource(root, 'heading', 'Hello from a component source')
  addComponentSource(root, 'body', 'Values resolve from source anchors and populate the panel children.')
  return { root, header, intro, panelC, zone, tests, testNodes, footer }
}

/** Render-facing labels for every node, keyed by wire id. */
export function componentLabelsFor(tree) {
  const entries = [
    ['header', tree.header],
    ['intro', tree.intro],
    ['panel', tree.panelC],
    ['zone', tree.zone],
    ['tests', tree.tests],
    ['footer', tree.footer],
    ...tree.testNodes.map((n, i) => [`t${i + 1}`, n]),
  ]
  const out = {}
  for (const [name, n] of entries) out[n.id] = { name, type: n.type, content: n.content, cssId: n.css?.id }
  return out
}
