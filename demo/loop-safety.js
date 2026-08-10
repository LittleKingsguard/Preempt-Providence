/**
 * Browser mirror of tests/e2e/loop-safety.test.ts. Each probe renders its goal,
 * the data involved, and the observed result (guard tripped / status / warnings).
 */
import { Node, Supervisor, findCycle, MAX_COMPILE_DEPTH } from '../dist/core/node.js'
import { Link } from '../dist/core/link.js'
import { CycleError, SingleParentError } from '../dist/core/errors.js'
import { EventBridge } from '../dist/core/events.js'
import { createClient } from '../dist/core/client.js'
import { makeRoot, makeNode, makePrototype, childOf, hub, addComponentSource, targetAnchor } from './demo-fixtures.js'
import { makeRunner } from './lib/runner.js'

const runner = makeRunner()
document.getElementById('results').appendChild(runner.el)

function probe(elId, text) {
  const el = document.getElementById(elId)
  const p = document.createElement('p')
  p.innerHTML = text
  el.appendChild(p)
}

/** Render a visible graph/tree structure diagram (e.g. "a → b", "a ⇄ b"). */
function structure(elId, lines) {
  const el = document.getElementById(elId)
  const pre = document.createElement('pre')
  pre.textContent = lines.join('\n')
  el.appendChild(pre)
}

function newSystem() {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  const clientAPI = createClient(supervisor)
  const register = (...nodes) => {
    for (const node of nodes) supervisor.registerNode(node)
    return nodes
  }
  return { clientAPI, supervisor, events, register }
}

function buildAnchorCircle() {
  const a = makeNode({ type: 'a' })
  const b = makeNode({ type: 'b' })
  const l1 = new Link({ name: 'parent-child' })
  a.addAnchor('parent', a, {}, l1)
  b.addAnchor('child', b, {}, l1)
  const l2 = new Link({ name: 'parent-child' })
  b.addAnchor('parent', b, {}, l2)
  a.addAnchor('child', a, {}, l2)
  return { a, b }
}

async function flushTicks() {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

async function main() {
  // ---------- Probe 1: op-time cycle rejection ----------
  await runner.check('Probe 1 — A→B→A move rejected with cycle-detected; graph unchanged, not journaled', async () => {
    const root = makeRoot()
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    childOf(root, a)
    childOf(a, b)
    if (!findCycle(a, b)) throw new Error('findCycle(a, b) should be true')
    structure(
      's1',
      ['document tree:   root', '                  └── a', '                      └── b',
       '',
       'attempted move:  a → under b   (would close: a → b → a)',
       'expected:        cycle-detected · rollback · no journal entry'],
    )
    const { clientAPI, supervisor, register } = newSystem()
    register(root, a, b)
    const before = supervisor.journal.length
    const res = clientAPI.apply(a.id, { kind: 'move', node: a.id, to: { parent: b.id } })
    if (res.status !== 'rejected' || res.error.code !== 'cycle-detected') {
      throw new Error(`expected cycle-detected, got ${res.status}`)
    }
    if (a.parent !== root) throw new Error('graph not rolled back')
    if (supervisor.journal.length !== before) throw new Error('rejected op was journaled')
    probe(
      'p1',
      `Observed: <span class="badge fail">cycle-detected</span> — rejected, a.parent = root (rolled back), journal unchanged.`,
    )
  })

  // ---------- Probe 2: anchor circle compile ----------
  await runner.check('Probe 2 — A↔B anchor circle compiles to a dropped loop arm + circular-source warning', () => {
    const { a, b } = buildAnchorCircle()
    structure(
      's2',
      ['anchor graph:    a ⇄ b   (l1: a is parent of b; l2: b is parent of a)',
       '',
       'expected:        zero actionable · dropped (loop) · circular-source warning'],
    )
    const res = a.compile([a, b])
    if (res.actionable.length !== 0) throw new Error('expected zero actionable states')
    if (!res.dropped.some((d) => d.reason === 'loop')) throw new Error('expected loop drop')
    if (!res.warnings.some((w) => w.code === 'circular-source')) throw new Error('expected circular-source warning')
    probe(
      'p2',
      `Observed: dropped arm (<code>loop</code>) + warning <code>circular-source</code> — bounded, no stack growth. a.state = <b>${a.state}</b>.`,
    )
  })

  // ---------- Probe 3: component self-reference ----------
  await runner.check('Probe 3 — component self-reference resolves at depth 0, never loops', () => {
    const { clientAPI, register } = newSystem()
    const root = makeRoot()
    const comp = childOf(root, makeNode({ type: 'component-host' }))
    register(root, comp)
    addComponentSource(comp, 'self-slot', { origin: 'self' }, 'duplex')
    targetAnchor(comp, 'self-slot')
    const res = clientAPI.apply(comp.id, [{ targetProp: 'content', mode: 'replace', value: 'v' }])
    if (res.status !== 'applied') throw new Error(`expected applied, got ${res.status}`)
    const exposed = clientAPI.getState(comp.id)
    if (exposed.length !== 1 || exposed[0].status !== 'ok') {
      throw new Error(`expected ok state, got ${JSON.stringify(exposed)}`)
    }
    probe(
      'p3',
      `Built: <code>component-host</code> both provides (<code>duplex</code>) and consumes <code>self-slot</code>.<br/>
       Observed: depth-0 self-resolution (S4.1) — state status <span class="badge pass">ok</span>, no loop, still renders.`,
    )
  })

  // ---------- Probe 4: dangling source/target ----------
  await runner.check('Probe 4 — dangling target → unresolved-reference warning; own state still renders', async () => {
    const { clientAPI, events, register } = newSystem()
    const root = makeRoot()
    const holder = childOf(root, makeNode())
    const t = childOf(holder, makeNode())
    register(root, holder, t)
    targetAnchor(t, 'missing-src')

    const seen = []
    events.subscribe('state', (env) => {
      for (const e of env.events) if (e.type === 'state') seen.push(e)
    })
    let warns = 0
    const origWarn = console.warn
    console.warn = () => {
      warns++
    }
    const res = clientAPI.apply(t.id, [{ targetProp: 'props.title', mode: 'replace', value: 'own' }])
    await flushTicks()
    console.warn = origWarn

    if (res.status !== 'applied') throw new Error(`expected applied, got ${res.status}`)
    if (warns === 0) throw new Error('expected a logged warning')
    const mine = seen.find((e) => e.nodeId === t.id)
    if (mine?.status !== 'unresolved-reference') throw new Error(`expected unresolved-reference, got ${mine?.status}`)
    if (t.props.title !== 'own' || !t.isInTree) throw new Error('own state not rendered')

    probe(
      'p4',
      `Built: <code>t</code> targets <code>missing-src</code> — no source anywhere.<br/>
       Observed: status <span class="badge warn">unresolved-reference</span> (${warns} console warning logged);
       own state still renders: title = <b>${t.props.title}</b>, in-tree = <b>${t.isInTree}</b>.`,
    )
  })

  // ---------- Probe 5: prototype-only candidate ----------
  await runner.check('Probe 5 — prototype-only candidate drops silently (zero events, zero warnings)', async () => {
    const { clientAPI, events, register } = newSystem()
    const root = makeRoot()
    const consumer = childOf(root, makeNode())
    register(root, consumer)
    targetAnchor(consumer, 'proto-only')

    const proto = makePrototype()
    const holder = childOf(proto, makeNode())
    addComponentSource(holder, 'proto-only', { from: 'proto' })
    register(proto, holder)

    const seen = []
    events.subscribe('state', (env) => {
      for (const e of env.events) if (e.type === 'state') seen.push(e)
    })
    let warns = 0
    const origWarn = console.warn
    console.warn = () => {
      warns++
    }
    clientAPI.apply(consumer.id, [{ targetProp: 'content', mode: 'replace', value: 'u' }])
    await flushTicks()
    console.warn = origWarn

    if (seen.filter((e) => e.nodeId === consumer.id).length !== 0) throw new Error('expected silent drop')
    if (warns !== 0) throw new Error('expected zero warnings')

    probe(
      'p5',
      `Built: consumer targets <code>proto-only</code>; the only provider lives under a component prototype.<br/>
       Observed: <span class="badge pass">silent drop</span> — 0 state events, 0 warnings (holder in-tree = <b>${holder.isInTree}</b>).`,
    )
  })

  // ---------- Probe 6: depth-cap trip ----------
  await runner.check('Probe 6 — borrow walk deeper than the cap is dropped as loop, never hangs', () => {
    const root = makeRoot()
    const chain = [root]
    let parent = root
    for (let i = 0; i <= MAX_COMPILE_DEPTH + 1; i++) {
      const n = makeNode()
      childOf(parent, n)
      chain.push(n)
      parent = n
    }
    const deep = parent
    targetAnchor(deep, 'deep-borrow')
    addComponentSource(root, 'deep-borrow', { at: 'root' })

    const depth = MAX_COMPILE_DEPTH + 2
    structure(
      's6',
      [`document tree:   root ─ ${'─'.repeat(depth)} deep (${depth} levels, cap = ${MAX_COMPILE_DEPTH})`,
       '',
       'borrow walk:     deep → … → root (exceeds cap)',
       'expected:        dropped (loop) · circular-source warning · no actionable deep state'],
    )

    const res = root.compile(chain)
    if (!res.dropped.some((d) => d.reason === 'loop')) throw new Error('expected loop drop')
    if (!res.warnings.some((w) => w.code === 'circular-source')) throw new Error('expected circular-source warning')
    if (res.actionable.find((s) => s.nodeId === deep.id)) throw new Error('deep node should not be actionable')

    probe(
      'p6',
      `Observed: <span class="badge fail">loop drop</span> + <code>circular-source</code> warning; the deep node produced no actionable state.`,
    )
  })

  // ---------- Probe 7: single-parent ----------
  await runner.check('Probe 7 — a second parent is rejected, never silently reparented', () => {
    const root = makeRoot()
    const a = makeNode()
    const b = makeNode()
    childOf(root, a)
    let threw = false
    try {
      childOf(b, a)
    } catch (e) {
      threw = e instanceof SingleParentError
    }
    if (!threw) throw new Error('expected SingleParentError')
    if (a.parent !== root) throw new Error('a was reparented')

    probe(
      'p7',
      `Tried: <code>childOf(b, a)</code> while a already has parent root.<br/>
       Observed: <span class="badge fail">SingleParentError</span> — a.parent still root (<b>${a.parent.id}</b>).`,
    )
  })

  runner.summary('Loop-safety probes')
}

main()
