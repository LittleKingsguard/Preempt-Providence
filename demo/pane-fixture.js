/**
 * The SSR render e2e input tree — shared by the demo page builder
 * (scripts/build-demo.mjs) and the browser page (ssr-render.js) so the
 * shipped data is provably the same graph the e2e tests exercise.
 */
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor } from './demo-fixtures.js'

export function buildNestedPane() {
  const root = makeRoot({ type: 'app', content: 'shell', css: { id: 'css-app' } })
  const dock = childOf(root, makeNode({ type: 'dock', props: { role: 'main' }, css: { id: 'css-dock' } }), 0)
  const inner = childOf(dock, makeNode({ type: 'badge', content: 'inner', css: { id: 'css-inner' } }), 0)
  const zone = childOf(root, makeNode({ type: 'zone', content: 'slot', css: { id: 'css-zone' } }), 1)
  // anti-pattern compliance (placement-path-spec §10.ad): no node carries two
  // same-name source anchors — the two feed providers use DISTINCT names and
  // the dock consumes BOTH (one resolved state, two bindings — never a fork).
  addComponentSource(root, 'feed-a', { label: 'A' })
  addComponentSource(root, 'feed-b', { label: 'B' })
  targetAnchor(dock, 'feed-a')
  targetAnchor(dock, 'feed-b')
  const plink = hub().linkFor('slot-alpha', 'placement')
  zone.addAnchor('container', 'slot-alpha', {}, plink)
  return { root, dock, inner, zone }
}

/** Render-facing labels for every node, keyed by wire id. */
export function nodeLabelsFor(pane) {
  const { root, dock, inner, zone } = pane
  const out = {}
  for (const [n, name] of [
    [root, 'app'],
    [dock, 'dock'],
    [inner, 'badge'],
    [zone, 'zone'],
  ]) {
    out[n.id] = { name, type: n.type, content: n.content, cssId: n.css?.id }
  }
  return out
}
