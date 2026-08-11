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
  'T7 — user pane: component-provided after-compile handler populates descendants; mock login shows the predefined user, logout clears it',
  'T8 — markdown display: typing updates the source; **bold** parses into a strong element; elements update IN PLACE (no rebuild, no focus loss)',
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

  // user pane: component provides the source for an after-compile handler
  // (wired client-side); descendants are populated from session state.
  const userPane = childOf(root, makeNode({ type: 'section', css: { classes: ['user-pane'] } }), 4)
  const username = childOf(userPane, makeNode({ type: 'p', content: '…', css: { classes: ['username'] } }), 0)
  const statusLine = childOf(userPane, makeNode({ type: 'p', content: 'Signed out', css: { classes: ['status'] } }), 1)
  const actions = childOf(userPane, makeNode({ type: 'div', css: { classes: ['actions'] } }), 2)
  const loginBtn = childOf(actions, makeNode({ type: 'button', content: 'Log in', css: { classes: ['login-btn'] } }), 0)
  const logoutBtn = childOf(actions, makeNode({ type: 'button', content: 'Log out', css: { classes: ['logout-btn'] } }), 1)
  targetAnchor(userPane, 'user-panel')
  addComponentSource(root, 'user-panel', { handler: 'user-panel:populate', phase: 'after-compile' })

  const tests = childOf(root, makeNode({ type: 'section', content: 'Tests — each test below is a content node in this document tree', css: { classes: ['tests'] } }), 5)
  const testNodes = testGoals.map((g, i) => childOf(tests, makeNode({ type: 'div', content: g, css: { classes: ['test-item'] } }), i))
  const footer = childOf(root, makeNode({ type: 'p', content: 'rendered by the preempt pipeline — no other hand-written HTML', css: { classes: ['footer'] } }), 6)

  // markdown editor → display window (in-place render behavior):
  // typing updates the editor source; the display's after-compile handler
  // parses **bold** into a strong element. Updates must NEVER replace the
  // editor element (focus retention).
  const editor = childOf(root, makeNode({ type: 'textarea', content: 'Hello **world**!', css: { classes: ['editor'] } }), 7)
  const display = childOf(root, makeNode({ type: 'div', css: { classes: ['display'] } }), 8)
  const part0 = childOf(display, makeNode({ type: 'span', content: '', css: { classes: ['md-part', 'md-prefix'] } }), 0)
  const part1 = childOf(display, makeNode({ type: 'strong', content: '', css: { classes: ['md-part', 'md-bold'] } }), 1)
  const part2 = childOf(display, makeNode({ type: 'span', content: '', css: { classes: ['md-part', 'md-suffix'] } }), 2)

  addComponentSource(root, 'panel', panelDefA)
  addComponentSource(root, 'panel', panelDefB)
  addComponentSource(root, 'heading', 'Hello from a component source')
  addComponentSource(root, 'body', 'Values resolve from source anchors and populate the panel children.')
  return { root, header, intro, panelC, zone, userPane, username, statusLine, actions, loginBtn, logoutBtn, editor, display, part0, part1, part2, tests, testNodes, footer }
}

/** Render-facing labels for every node, keyed by wire id. */
export function componentLabelsFor(tree) {
  const entries = [
    ['header', tree.header],
    ['intro', tree.intro],
    ['panel', tree.panelC],
    ['zone', tree.zone],
    ['user-pane', tree.userPane],
    ['username', tree.username],
    ['status', tree.statusLine],
    ['login', tree.loginBtn],
    ['actions', tree.actions],
    ['logout', tree.logoutBtn],
    ['editor', tree.editor],
    ['display', tree.display],
    ['part-0', tree.part0],
    ['part-1', tree.part1],
    ['part-2', tree.part2],
    ['tests', tree.tests],
    ['footer', tree.footer],
    ...tree.testNodes.map((n, i) => [`t${i + 1}`, n]),
  ]
  const out = {}
  for (const [name, n] of entries) out[n.id] = { name, type: n.type, content: n.content, cssId: n.css?.id }
  return out
}
