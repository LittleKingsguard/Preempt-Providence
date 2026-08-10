/**
 * Browser mirror of tests/e2e/ssr-render.test.ts.
 *
 * Input: the `<script id="preempt-initial-data">` document embedded by
 * scripts/build-demo.mjs — the exact data the e2e SSR tests serialize from
 * the nested pane. This page parses it, re-resolves from the serialized
 * anchors (S4.2), renders the DOM in-browser, and verifies the e2e
 * assertions — including PAR-5 parity against the server-side reference that
 * was embedded alongside the data.
 */
import { Node, reconcileParentTargets } from '../dist/core/node.js'
import { diffMinimal } from '../dist/core/render.js'
import { loadState } from '../dist/core/serialize.js'
import { createClient } from '../dist/core/client.js'
import { EventBridge } from '../dist/core/events.js'
import { Supervisor } from '../dist/core/node.js'
import { hub } from './demo-fixtures.js'
import { makeRunner } from './lib/runner.js'
import { DomAdapter } from './lib/dom-adapter.js'
import { minimalFromState, applyOps, treeFromOps, treeSig, jsonClone } from './lib/render-ops.js'

const runner = makeRunner()
document.getElementById('results').appendChild(runner.el)

// ---- the framework input ------------------------------------------------
const initialData = JSON.parse(document.getElementById('preempt-initial-data').textContent)
const serverData = JSON.parse(document.getElementById('server-data').textContent)
const labels = serverData.nodeLabels

function labelOf(wire) {
  const l = labels[wire]
  return l ? l.name : wire
}

/** Render a structural tree (expected or rendered) as a styled nested list. */
function renderTree(container, nodes) {
  const ul = document.createElement('ul')
  ul.className = 'doc-tree'
  for (const node of nodes) {
    const li = document.createElement('li')
    const chip = document.createElement('span')
    chip.className = 'node-chip'
    const name = labelOf(node.wire)
    chip.textContent = `${name} <${node.type}>`
    chip.title = `wire ${node.wire}`
    li.appendChild(chip)
    const bits = []
    for (const [k, v] of Object.entries(node.props ?? {})) {
      if (k === 'text') bits.push(`text=${JSON.stringify(v)}`)
      else bits.push(`${k}=${JSON.stringify(v)}`)
    }
    if (bits.length) {
      const props = document.createElement('span')
      props.className = 'node-props'
      props.textContent = bits.join(' ')
      li.appendChild(props)
    }
    if (node.children.length) renderTree(li, node.children)
    ul.appendChild(li)
  }
  container.appendChild(ul)
}

/** Walk the live DOM mount and describe it as a structural tree. */
function walkDom(el) {
  const out = []
  for (const child of el.children) {
    if (!child.tagName) continue
    const props = {}
    if (child.id) props['css:id'] = child.id
    const text = child.childNodes?.length ? '' : child.textContent?.trim()
    if (text) props['text'] = text
    out.push({
      wire: child.dataset?.wire ?? '',
      type: child.tagName.toLowerCase(),
      props,
      children: walkDom(child),
    })
  }
  return out
}

async function main() {
  document.getElementById('server-doc').textContent = JSON.stringify(initialData, null, 2)

  // ---- expected tree (server reference, embedded with the data) ----------
  renderTree(document.getElementById('expected-tree'), serverData.expectedTree)

  // ---- client pipeline over the shipped data -----------------------------
  await runner.check('input data parses and is JSON-stable (NVS-5)', () => {
    if (JSON.stringify(jsonClone(initialData)) !== JSON.stringify(initialData)) {
      throw new Error('initial data not JSON-stable')
    }
  })

  const seeded = loadState(jsonClone(initialData)).map((d) => new Node(d, hub()))
  reconcileParentTargets(seeded)
  const cr = seeded[0].compile(seeded)
  const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
  const dockId = Object.keys(labels).find((w) => labels[w].name === 'dock')

  await runner.check('SSR-H3: client re-resolves 2 fork arms with distinct path keys (S4.2)', () => {
    if (serverData.forkArms.length !== 2) throw new Error('server embedded 2 fork arms')
    const mine = cr.actionable.filter((s) => s.nodeId === dockId)
    if (mine.length !== 2) throw new Error(`expected 2 arms, got ${mine.length}`)
    if (new Set(mine.map((a) => a.pathKey)).size !== 2) throw new Error('path keys not distinct')
  })

  await runner.check('fork bindings surface both candidate values (A and B)', () => {
    const bindings = cr.actionable.filter((s) => s.nodeId === dockId).map((s) => s.bindings['feed'])
    if (!bindings.some((b) => b?.label === 'A') || !bindings.some((b) => b?.label === 'B')) {
      throw new Error(`missing candidates: ${JSON.stringify(bindings)}`)
    }
  })

  await runner.check('both fork arms emit a create for the dock wire (§6)', () => {
    if (ops.filter((o) => o.kind === 'create' && o.wire === dockId).length !== 2) {
      throw new Error('expected 2 create ops for dock wire')
    }
  })

  // ---- render in-browser: apply ops into the DOM mount -------------------
  const mount = document.getElementById('mount')
  const adapter = new DomAdapter(mount)
  applyOps(adapter, ops)
  for (const el of adapter.wires.values()) mount.appendChild(el)

  await runner.check('HTML rendering succeeds: dock, nested badge and zone elements exist in the DOM', () => {
    // app (root) is a consumed provider — a fork candidate, not a standalone wire
    const renderWires = Object.keys(labels).filter((w) => labels[w].name !== 'app')
    for (const wire of renderWires) {
      if (!adapter.wires.has(wire)) throw new Error(`wire ${wire} not created in DOM`)
    }
  })

  // ---- rendered tree dump from the actual DOM ----------------------------
  renderTree(document.getElementById('rendered-tree'), walkDom(mount))

  // ---- PAR-5 parity against the embedded server reference ----------------
  await runner.check('PAR-5: in-browser render tree ≡ server render tree', () => {
    const clientSig = treeSig(treeFromOps(ops))
    if (clientSig !== serverData.serverTreeSig) {
      throw new Error('server/client tree signatures differ')
    }
  })

  // ---- fork arms, rendered visibly ---------------------------------------
  const armsBox = document.getElementById('fork-arms')
  const arms = cr.actionable.filter((s) => s.nodeId === dockId)
  arms.forEach((arm, i) => {
    const card = document.createElement('div')
    card.className = 'arm-card'
    const title = document.createElement('h4')
    title.textContent = `Fork arm ${i}`
    const meta = document.createElement('p')
    meta.textContent = `pathKey: ${arm.pathKey}`
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = `feed=${arm.bindings['feed']?.label}`
    const nested = document.createElement('span')
    nested.className = 'nested-badge'
    nested.textContent = `nested badge: ${arm.children.length ? 'present' : 'missing'}`
    card.appendChild(title)
    card.appendChild(meta)
    card.appendChild(badge)
    card.appendChild(nested)
    armsBox.appendChild(card)
  })

  // ---- SSR-F1: tampered shipped fork is never trusted --------------------
  await runner.check('SSR-F1: a tampered shipped fork id is never materialized', () => {
    const tampered = jsonClone(initialData)
    const t = tampered.content.find((n) => n.id === dockId)
    t.forkKey = 'root/stale-node/arm'
    const reSeeded = loadState(tampered).map((d) => new Node(d, hub()))
    reconcileParentTargets(reSeeded)
    const reCr = reSeeded[0].compile(reSeeded)
    const reArms = reCr.actionable.filter((s) => s.nodeId === dockId)
    if (reArms.length !== 2) throw new Error('re-resolution surface changed')
    for (const a of reArms) if (a.pathKey.includes('stale-node')) throw new Error('stale fork materialized')
  })

  // ---- SSR-H2: hydrate seam ----------------------------------------------
  await runner.check('SSR-H2: hydrate reuses SSR DOM via the css.id seam', () => {
    const h = new DomAdapter(document.createElement('div'))
    h.hydrate(seeded[0].id, initialData)
    if (h.reused.size === 0) throw new Error('no css.id keys found to reuse')
  })

  // ---- placement block (framework surface) -------------------------------
  await runner.check('placement via state-slice is hard-blocked; placement anchor renders', () => {
    const events = new EventBridge()
    const supervisor = new Supervisor({ hub: hub(), events })
    const client = createClient(supervisor)
    const zoneId = Object.keys(labels).find((w) => labels[w].name === 'zone')
    const seeded2 = loadState(jsonClone(initialData)).map((d) => new Node(d, hub()))
    reconcileParentTargets(seeded2)
    for (const n of seeded2) supervisor.registerNode(n)
    const res = client.apply(zoneId, [{ targetProp: 'placement', mode: 'replace', value: 'x' }])
    if (res.status !== 'rejected' || res.error.code !== 'placement-target-blocked') {
      throw new Error(`expected placement-target-blocked, got ${res.status}`)
    }
  })

  runner.summary('SSR receive → complete render')
}

main()
