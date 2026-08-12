/**
 * Fork-stress browser page — layered stress test of the forking render system.
 *
 * Static part (L1 placement, L2 component values, L3 component link) is
 * serialized in `preempt-initial-data`; this module drives the runtime
 * layers (L4..depth) through the four mechanisms and verifies each.
 *
 * ONLY core + handler code — no demo-side render machinery:
 *   - reconstruction: loadState → Node (S4.2)
 *   - runtime layers: clientAPI `attach` op, addComponentSource/targetAnchor,
 *     idempotent after-compile handlers
 *   - render: bootstrap compile once, then consume supervisor.takePass2States()
 *     (DECIDED incremental contract), diffMinimal + core applyOps
 */
import { Node, reconcileParentTargets, Supervisor, focusedSliceFor } from '../dist/core/node.js'
import { diffMinimal } from '../dist/core/render.js'
import { loadState } from '../dist/core/serialize.js'
import { createClient } from '../dist/core/client.js'
import { EventBridge } from '../dist/core/events.js'
import { dispatchEvent } from '../dist/core/handlers.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps, jsonClone, wireKey } from '../dist/core/render-helpers.js'
import { hub, addComponentSource, targetAnchor } from './demo-fixtures.js'
import { makeRunner } from './lib/runner.js'
import {
  LAYER_METHODS,
  layerName,
  placementName,
  componentName,
  valuePair,
  linkDef,
  HANDLER_MARKER,
  levelCss,
  layerMarkerProp,
  cssPropForLevel,
} from './fork-stress-fixture.js'

setCompilePassLogging(true)
globalThis.setCompilePassLogging = setCompilePassLogging

const runner = makeRunner()
document.getElementById('results').appendChild(runner.el)

const initialData = JSON.parse(document.getElementById('preempt-initial-data').textContent)
const serverData = JSON.parse(document.getElementById('server-data').textContent)
const depth = serverData.depth
const byName = {}
for (const [id, l] of Object.entries(serverData.nodeLabels)) byName[l.name] = id

const adapter = new DomAdapter(document.getElementById('app'), { onEvent: handleDomEvent })

// ---- profiling -------------------------------------------------------------
const PROFILE = { loadMs: 0, compileMs: 0, emitMs: 0, diffMs: 0, applyMs: 0, renderCount: 0, totalMs: 0 }
const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
const tStart = now()
function acc(key, fn) {
  const t0 = now()
  const r = fn()
  PROFILE[key] += now() - t0
  return r
}

// ---- reconstruct the graph from the shipped document (S4.2) --------------
const loadT0 = now()
const seeded = loadState(jsonClone(initialData)).map((d) => new Node(d, hub()))
reconcileParentTargets(seeded)
const rootNode = seeded[0]
const wireToNode = new Map(seeded.map((n) => [n.id, n]))
PROFILE.loadMs = now() - loadT0

const events = new EventBridge()
const supervisor = new Supervisor({ hub: hub(), events })
for (const n of seeded) supervisor.registerNode(n)
const clientAPI = createClient(supervisor)

let nodeSeq = 0
const runtimeId = () => `fs-runtime-${++nodeSeq}`

// ---- runtime child-creation mechanisms (layers 4+) ------------------------
/** Create + register + attach a child under parent (the attach op). */
function addChild(parent, data, priority) {
  const child = new Node(data, hub(), runtimeId())
  supervisor.registerNode(child)
  const res = clientAPI.apply(child.id, { kind: 'attach', node: child.id, to: parent.id, priority })
  if (res.status !== 'applied') throw new Error(`attach failed: ${res.status}`)
  return child
}

/** L4/L8: idempotent after-compile handler — creates 2 children only when
 *  its marker child is absent (the default guard against after-assembly
 *  loops). */
function installHandlerLayer(parents, cycle) {
  const name = layerName(cycle * 4) // 'handler-1' | 'handler-2'
  const marker = HANDLER_MARKER
  for (const parent of parents) {
    parent.addLayer({
      id: `fork-stress-${name}`,
      handlers: [
        {
          name: `stress-${name}`,
          phase: 'after-compile',
          body: (c) => {
            PROFILE.handlerCalls = (PROFILE.handlerCalls ?? 0) + 1
            const node = c.tree.getNode(parent.id)
            if (!node) return
            // idempotency: already added this layer? (guard against loops)
            const existing = c.tree.descendantsOf(node).some((d) => d.props?.[marker] === name)
            if (existing) return
            for (const [k, tag] of [['a', 'span'], ['b', 'span']]) {
              const pid = `${node.props.id}-h-${k}`
              const child = addChild(node, {
                type: tag,
                props: {
                  id: pid,
                  'stress:layers': `${node.props['stress:layers'] ?? ''}|L${cycle * 4}:${name}`,
                  [marker]: name,
                  ...layerMarkerProp(cycle * 4, 'handler'),
                },
                css: levelCss(cycle * 4, k),
              }, k === 'a' ? 0 : 1)
              wireToNode.set(child.id, child)
            }
          },
        },
      ],
    })
  }
}

/** L5: placement layer — create 2 nodes per parent, placed into a fresh zone
 *  per parent with placement name stress-<n>. */
function addPlacementLayer(parents, cycle) {
  const pName = placementName(cycle)
  const out = []
  for (const parent of parents) {
    parent.addAnchor('placement', pName, {}, hub().linkFor(pName, 'placement'))
    for (const [k, tag] of [['a', 'div'], ['b', 'div']]) {
      const pid = `${parent.props.id}-p-${k}`
      const child = addChild(parent, {
        type: tag,
        props: {
          id: pid,
          'stress:layers': `${parent.props['stress:layers'] ?? ''}|L${cycle * 4 - 3}:placement`,
          ...layerMarkerProp(cycle * 4 - 3, 'placement'),
        },
        css: levelCss(cycle * 4 - 3, k),
      }, k === 'a' ? 0 : 1)
      wireToNode.set(child.id, child)
      child.addAnchor('placement', pName, {}, hub().linkFor(pName, 'placement'))
      out.push(child)
    }
  }
  return out
}

/** L6: values layer — component provides 2 values for 2 authored children. */
function addValuesLayer(parents, cycle) {
  const cName = componentName('values', cycle)
  const pair = valuePair(cycle)
  addComponentSource(rootNode, `${cName}.a`, pair.a)
  addComponentSource(rootNode, `${cName}.b`, pair.b)
  const out = []
  for (const parent of parents) {
    targetAnchor(parent, cName)
    for (const [k, bind] of [['a', `${cName}.a`], ['b', `${cName}.b`]]) {
      const pid = `${parent.props.id}-v-${k}`
      const child = addChild(parent, {
        type: 'span',
        props: {
          id: pid,
          'stress:layers': `${parent.props['stress:layers'] ?? ''}|L${cycle * 4 - 2}:${cName}`,
          ...layerMarkerProp(cycle * 4 - 2, 'values'),
        },
        css: levelCss(cycle * 4 - 2, k),
      }, k === 'a' ? 0 : 1)
      targetAnchor(child, bind)
      out.push(child)
    }
  }
  return out
}

/** L7: link layer — component links a prototype as a child-driver: create 2
 *  real children per parent, then the parent consumes the def (the emitter
 *  re-types the children per def.children order + ancestry suffix). */
function addLinkLayer(parents, cycle) {
  const cName = componentName('link', cycle)
  addComponentSource(rootNode, cName, linkDef(cycle))
  const out = []
  for (const parent of parents) {
    targetAnchor(parent, cName)
    for (const [k, tag] of [['a', 'div'], ['b', 'div']]) {
      const pid = `${parent.props.id}-l-${k}`
      const child = addChild(parent, {
        type: tag,
        props: {
          id: pid,
          'stress:layers': `${parent.props['stress:layers'] ?? ''}|L${cycle * 4 - 1}:${cName}`,
          ...layerMarkerProp(cycle * 4 - 1, 'link'),
        },
        css: levelCss(cycle * 4 - 1, k),
      }, k === 'a' ? 0 : 1)
      wireToNode.set(child.id, child)
      out.push(child)
    }
  }
  return out
}

// ---- render: bootstrap once, then consume the supervisor's pass-2 ---------
let prevStates = new Map()
let prevMap = null
let bootstrapped = false
function setStates(actionable) {
  const byNode = new Map()
  for (const s of actionable) {
    const arr = byNode.get(s.nodeId) ?? []
    arr.push(s)
    byNode.set(s.nodeId, arr)
  }
  for (const [id, arr] of byNode) prevStates.set(id, arr)
}
function render() {
  const origWarn = console.warn
  console.warn = () => {}
  try {
    if (!bootstrapped) {
      const cr = acc('compileMs', () => rootNode.compile(seeded))
      setStates(cr.actionable)
      supervisor.recordResolved(cr.actionable)
      bootstrapped = true
    } else {
      const fresh = supervisor.takePass2States()
      for (const [id, arr] of fresh) prevStates.set(id, arr)
    }
    const actionable = []
    for (const [, states] of prevStates) actionable.push(...states)
    const els = acc('emitMs', () => emitElements(actionable, wireToNode))
    const ops = acc('diffMs', () => diffMinimal(prevMap, els))
    acc('applyMs', () => applyOps(adapter, ops))
    prevMap = new Map(els.map((e) => [e.wire, e]))
    PROFILE.renderCount += 1
    return { els, ops }
  } finally {
    console.warn = origWarn
  }
}

/** Recompile a focused slice for nodes mutated directly (payload-style). */
function recompileFocusedFor(node) {
  const slice = focusedSliceFor(node, supervisor.allNodes())
  const cr = acc('compileMs', () => node.compile(slice, { focusNodeId: node.id }))
  setStates(cr.actionable)
  supervisor.recordResolved(cr.actionable)
  for (const id of [...prevStates.keys()]) {
    const n = supervisor.getNode(id)
    if (!n) continue
    if (!n.isInTree && !cr.actionable.some((s) => s.nodeId === id)) prevStates.delete(id)
  }
  return cr
}

function flushMicrotasks() {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

/** Drain the supervisor until no pass-2 work remains (each attach/apply
 *  schedules its own microtask flush — deep trees need several rounds). */
async function drainUntilStable() {
  for (let round = 0; round < 6; round += 1) {
    await flushMicrotasks()
    const pending = supervisor.takePass2States()
    if (pending.size === 0) return
    for (const [id, arr] of pending) prevStates.set(id, arr)
    if (round === 5) throw new Error('pass-2 did not drain after 6 rounds')
  }
}

async function handleDomEvent(wire, domEvent) {
  const node = wireToNode.get(wire)
  if (!node) return
  const eventName = domEvent && typeof domEvent === 'object' && typeof domEvent.type === 'string'
    ? domEvent.type
    : String(domEvent ?? '')
  const extra = domEvent && domEvent.target && typeof domEvent.target.value === 'string' ? [domEvent.target.value] : []
  dispatchEvent(node, supervisor.handlerContext, eventName, ...extra)
  await flushMicrotasks()
  render()
}

function nodeText(wire) {
  const el = adapter.wires.get(wire)
  return el ? el.textContent.trim() : ''
}
function allText(el) {
  if (!el) return ''
  return (el.textContent ?? '') + Array.from(el.children ?? []).map(allText).join('')
}
/** Text of the whole rendered surface (all adapter wires, incl. fork arms). */
function domText() {
  let out = ''
  for (const el of adapter.wires.values()) out += allText(el)
  return out
}
function statesOf(id) {
  return prevStates.get(id) ?? []
}
function nodeById(name) {
  return wireToNode.get(byName[name])
}
/** All live in-tree nodes in the graph, EXCLUDING the structural zone. */
function allNodes() {
  return supervisor.allNodes().filter((n) => !n.destroyed && n.isInTree && n.props?.id !== 'stress-zone')
}
/** Depth of a node = number of stress:layers segments (root = 0). */
function depthOf(n) {
  return (n.props?.['stress:layers'] ?? '').split('|').filter(Boolean).length
}
/** The layer method of a node's deepest layer. */
function topLayerOf(n) {
  const segs = (n.props?.['stress:layers'] ?? '').split('|').filter(Boolean)
  return segs[segs.length - 1] ?? ''
}

document.getElementById('layer-plan').textContent =
  'depth ' + depth + '\n' +
  serverData.layerNames.map((n, i) => `L${i + 1}  ${LAYER_METHODS[i % 4]}  ${n}`).join('\n')

// --------------------------------------------------------------------------
async function main() {
  // initial render (bootstrap)
  render()

  // L1..L3 are serialized; collect them from the graph by their layer chain.
  const zoneNode = seeded.find((n) => n.props?.id === 'stress-zone')
  const l1nodes = zoneNode ? [...zoneNode.children] : []
  const l2nodes = seeded.filter((n) => depthOf(n) === 2)
  const l3nodes = seeded.filter((n) => depthOf(n) === 3)

  let currentParents = l3nodes
  for (let level = 4; level <= depth - 1; level += 1) {
    const method = LAYER_METHODS[(level - 1) % 4]
    const cycle = Math.floor((level - 1) / 4) + 1
    if (method === 'handler') {
      installHandlerLayer(currentParents, cycle)
      // trigger: apply a tick to each parent → pass-2 → after-compile handler
      for (const p of currentParents) {
        clientAPI.apply(p.id, [{ targetProp: 'props.stressTick', mode: 'replace', value: level }])
      }
      await flushMicrotasks()
      render()
    } else if (method === 'placement') {
      currentParents = addPlacementLayer(currentParents, cycle)
      await flushMicrotasks()
      recompileFocusedFor(rootNode)
      render()
    } else if (method === 'values') {
      currentParents = addValuesLayer(currentParents, cycle)
      await flushMicrotasks()
      recompileFocusedFor(rootNode)
      render()
    } else if (method === 'link') {
      currentParents = addLinkLayer(currentParents, cycle)
      await flushMicrotasks()
      recompileFocusedFor(rootNode)
      render()
    }
    // next layer's parents are the children just created at this level
    currentParents = allNodes().filter((n) => depthOf(n) === level)
    console.log(`[fs:dbg] level ${level} (${method} cyc ${cycle}): parents=${currentParents.length}`)
  }

  // ---- checks -------------------------------------------------------------
  await runner.check('layer k has exactly 2^k nodes; total (incl. root) = 2^depth − 1', () => {
    const all = allNodes()
    for (let k = 1; k <= depth - 1; k += 1) {
      const layerNodes = all.filter((n) => depthOf(n) === k)
      if (layerNodes.length !== 2 ** k) {
        throw new Error(`layer ${k}: expected ${2 ** k} nodes, got ${layerNodes.length}`)
      }
    }
    if (all.length !== 2 ** depth - 1) throw new Error(`total: expected ${2 ** depth - 1}, got ${all.length}`)
  })

  await runner.check('rendered element counts match: each layer renders 2^k elements, no re-creates', () => {
    // Count THIS module's rendered elements via the adapter wire map (each
    // page has its own adapter; the shared #app mount accumulates across
    // smoke imports, so it cannot be used here). An element re-created on a
    // type change would surface as a `remove`+`create` in the diff — assert
    // no wire ever changed type across renders by tracking it here.
    const byLayer = {}
    for (const [key, el] of adapter.wires) {
      const layers = el.getAttribute?.('stress:layers') ?? el.dataset?.stressLayers ?? ''
      const n = layers ? layers.split('|').filter(Boolean).length : 0
      if (n > 0) byLayer[n] = (byLayer[n] ?? 0) + 1
    }
    for (let k = 1; k <= depth - 1; k += 1) {
      if (byLayer[k] !== 2 ** k) {
        throw new Error(`rendered layer ${k}: expected ${2 ** k} elements, got ${byLayer[k] ?? 0}`)
      }
    }
  })

  await runner.check("DOM nesting: every layer element's direct children are exactly its graph node's children (boxes nest)", () => {
    const wireOf = (e) => {
      if (!e) return ''
      return e.getAttribute?.('data-wire') ?? e.dataset?.wire ?? ''
    }
    const allWires = [...adapter.wires.values()]
    // the app root is a consumed PROVIDER (provides the values/link sources),
    // so it is not emitted — walk from the placement zone (the first rendered
    // element), and verify every zone-descendant nests under its graph parent.
    const zoneEl = allWires.find((e) => e && wireOf(e) === 'fs-zone')
    if (!zoneEl) throw new Error('placement zone element missing')
    let checked = 0
    const walk = (el) => {
      const wire = wireOf(el)
      const node = wire ? supervisor.getNode(wire) : undefined
      if (node) {
        const domKids = Array.from(el.children ?? []).map((c) => wireOf(c)).filter(Boolean)
        const graphKids = node.children.map((c) => c.id)
        if (JSON.stringify(domKids) !== JSON.stringify(graphKids)) {
          throw new Error(`nesting mismatch on ${wire}: DOM children ${JSON.stringify(domKids)} ≠ graph children ${JSON.stringify(graphKids)}`)
        }
        checked += 1
      }
      for (const c of Array.from(el.children ?? [])) walk(c)
    }
    walk(zoneEl)
    // zone + all layer nodes (root is a non-emitted provider)
    if (checked !== 2 ** depth - 1) throw new Error(`nesting check visited ${checked} nodes, expected ${2 ** depth - 1} (zone + layers)`)
  })

  await runner.check('css stress: each level changes a DIFFERENT css property; the two sibling slots get different values', () => {
    // Per level k, every node carries cssPropForLevel(k) inside its `style`
    // cssText. Within a level, the FIRST child (slot a) and SECOND child
    // (slot b) of every parent get DIFFERENT values; different levels use
    // different properties. The expected (prop, value) pairs come straight
    // from levelCss(k, 'a') / levelCss(k, 'b') — the compile/emit lookup
    // must produce exactly those two per level.
    const seenPairs = {}
    for (const [key, el] of adapter.wires) {
      const layers = el.getAttribute?.('stress:layers') ?? el.dataset?.stressLayers ?? ''
      if (!layers) continue // root / zone — no layer chain, no level css
      const level = layers.split('|').filter(Boolean).length
      const prop = cssPropForLevel(level)
      const cssText = el.style?.cssText ?? el.getAttribute?.('data-css-style') ?? ''
      const m = new RegExp(`${prop}:\\s*([^;]+);`).exec(cssText)
      if (!m) throw new Error(`element ${key} (L${level}) has no ${prop} in style "${cssText}"`)
      const pair = `${prop}=${m[1].trim()}`
      ;(seenPairs[level] ??= new Set()).add(pair)
      const top = layers.split('|').filter(Boolean).pop() ?? ''
      const kind = top.includes('placement') ? 'placement' : top.includes('values') ? 'values' : top.includes('link') ? 'link' : top.includes('handler') ? 'handler' : '?'
      const stressKind = el.getAttribute?.('stress:kind') ?? ''
      if (!stressKind.startsWith(kind)) throw new Error(`stress:kind "${stressKind}" does not match top layer "${top}" on ${key}`)
    }
    for (let k = 1; k <= depth - 1; k += 1) {
      const mkPair = (slot) => {
        const css = levelCss(k, slot)
        const m = /^([a-z-]+):\s*([^;]+);/.exec(css.style)
        return `${m[1]}=${m[2].trim()}`
      }
      const expected = new Set([mkPair('a'), mkPair('b')])
      if (expected.size !== 2) throw new Error(`L${k}: sibling slots share a css value`)
      const actual = seenPairs[k] ?? new Set()
      if (actual.size !== 2) throw new Error(`L${k}: expected exactly 2 css pairs, got ${[...actual].join(' | ')}`)
      for (const e of expected) if (!actual.has(e)) throw new Error(`L${k}: missing expected pair ${e} (got ${[...actual].join(' | ')})`)
    }
  })

  await runner.check('placement layers: children carry the placement anchor', () => {
    const all = allNodes()
    const placed = all.filter((n) => n.anchors.some((a) => a.role === 'placement' && typeof a.target === 'string'))
    if (placed.length === 0) throw new Error('no placement-anchored nodes')
    // every node whose TOP layer is placement must carry a placement anchor
    for (const n of all) {
      if (topLayerOf(n).startsWith('L') && topLayerOf(n).includes(':placement')) {
        if (!n.anchors.some((a) => a.role === 'placement')) throw new Error(`placement node ${n.id} lacks placement anchor`)
      }
    }
  })

  await runner.check('values layers: children render the component-provided value', () => {
    const rendered = domText()
    for (let cyc = 1; cyc * 4 - 2 <= depth - 1; cyc += 1) {
      const v = valuePair(cyc)
      if (!rendered.includes(v.a) || !rendered.includes(v.b)) {
        throw new Error(`values-${cyc} text missing: ${JSON.stringify(v)}`)
      }
    }
  })

  await runner.check('link layers: prototype def linked as child-driver (def binding present)', () => {
    if (depth < 4) return
    // the def CONSUMERS are parents whose CHILDREN's top layer is a link layer
    const all = allNodes()
    const consumers = all.filter((n) => n.children.some((c) => topLayerOf(c).includes(':link-')))
    if (!consumers.length) throw new Error('no link-layer consumers found')
    const linkBindings = (cs) => Object.keys(cs.bindings ?? {}).filter((k) => /^link-\d+$/.test(k))
    for (const c of consumers) {
      if (!statesOf(c.id).some((s) => linkBindings(s).length > 0)) {
        throw new Error(`link def binding missing on ${c.id}`)
      }
    }
    const rendered = domText()
    for (let cyc = 1; cyc * 4 - 1 <= depth - 1; cyc += 1) {
      const tag = `link-${cyc}.a`
      if (!rendered.includes(tag)) throw new Error(`${tag} children not rendered`)
    }
  })

  await runner.check('handler layers: children created, idempotent on re-run', async () => {
    const all = allNodes()
    // handler layers create 2 children per parent: L4 → 2×2^3=16; L8 (depth
    // ≥ 9) → 2×2^7=256; L12 (depth ≥ 13) would add 2×2^11
    const marked = all.filter((n) => n.props?.[HANDLER_MARKER])
    const expectMarked = depth >= 9 ? 16 + 256 : depth >= 5 ? 16 : 0
    if (marked.length !== expectMarked) throw new Error(`expected ${expectMarked} handler-created nodes, got ${marked.length}`)
    // idempotency: re-dirty a handler parent and verify no duplicate children
    const handlerParents = all.filter((n) => n.layers.some((l) => l.id?.startsWith('fork-stress-handler')))
    if (handlerParents.length) {
      const p = handlerParents[0]
      const before = p.children.length
      clientAPI.apply(p.id, [{ targetProp: 'props.stressTick', mode: 'replace', value: 999 }])
      await flushMicrotasks()
      render()
      if (p.children.length !== before) throw new Error('handler re-ran and duplicated children (loop)')
    }
  })

  await runner.check('every node documents its depth + tree back to root (stress:layers)', () => {
    for (const n of allNodes()) {
      if (n.id === rootNode.id) continue // root is depth 0 — no layer chain
      const chain = n.props?.['stress:layers']
      if (!chain) throw new Error(`node ${n.id} missing stress:layers`)
      const segments = chain.split('|').filter(Boolean)
      // depth = segments length; each segment is 'L<level>:<method>'
      for (let i = 0; i < segments.length; i += 1) {
        if (!/^L\d+:(placement|values-\d+|link-\d+|handler-\d+)$/.test(segments[i])) {
          throw new Error(`bad chain segment "${segments[i]}" on ${n.id}`)
        }
      }
    }
  })

  runner.summary(`Fork Stress — depth ${depth}`)

  PROFILE.totalMs = now() - tStart
  const f = (v) => v.toFixed(1)
  console.log(
    `[fork-stress:profile] depth=${depth} nodes=${2 ** depth - 1} ` +
    `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms ` +
    `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms ` +
    `renders=${PROFILE.renderCount} handlers=${PROFILE.handlerCalls ?? 0} total=${f(PROFILE.totalMs)}ms`,
  )
}

// The smoke test awaits this to know the page finished (deep pages take
// longer than the generic settle window).
globalThis.__forkStressDone = main()
