/**
 * Step 7 e2e — component-provided after-compile handler mutating descendants.
 *
 * Real-world scenario: a user-info panel. A component provides the source
 * for an after-compile handler; the handler runs once the consumer compiles,
 * checks session state, and populates its DESCENDANTS with the corrected
 * data — welcome text when logged in, a login button when not. The state
 * changes flow through the managed channel (journaled) and the descendants
 * re-render with the corrected data.
 */
import { describe, it, expect } from 'vitest'
import { Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { diffMinimal, MockAdapter, type RenderOp } from '../../src/core/render.js'
import { makeRoot, makeNode, childOf, hub, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import type { HandlerContext } from '../../src/core/handlers.js'
import type { HandlerDef } from '../../src/core/types.js'
import type { Node } from '../../src/core/node.js'

function minimalFromState(cs: { nodeId: string; type: string; props?: Record<string, unknown>; css?: Record<string, unknown>; content?: unknown; children: string[] }): {
  wire: string
  type: string
  props: Record<string, unknown>
  childOrder: string[]
} {
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(cs.props ?? {})) props[`prop:${k}`] = v
  for (const [k, v] of Object.entries(cs.css ?? {})) props[`css:${k}`] = v
  if (cs.content !== undefined) props['text'] = cs.content
  return { wire: cs.nodeId, type: cs.type, props, childOrder: [...cs.children] }
}

function applyOps(adapter: MockAdapter, ops: RenderOp[]): void {
  const els = new Map<string, { wire: string; type: string }>()
  for (const op of ops) {
    switch (op.kind) {
      case 'create':
        els.set(op.wire, adapter.createEl(op.type, op.wire))
        break
      case 'set':
        adapter.setProp(op.wire, op.name, op.value)
        break
      case 'append': {
        const owner = els.get(op.owner)
        const child = els.get(op.child)
        if (owner && child) adapter.appendChild(owner, child)
        break
      }
      case 'remove': {
        const w = els.get(op.wire)
        if (w && adapter.removeEl) adapter.removeEl(op.wire)
        els.delete(op.wire)
        break
      }
      case 'styles':
        break
    }
  }
}

interface PanelFixture {
  root: Node
  provider: Node
  panel: Node
  username: Node
  loginBtn: Node
}

/**
 * User-info panel: `provider` (ancestor of the consumer, per the walk-up
 * resolution model) supplies the `user-panel` component whose SOURCE VALUE is
 * an after-compile handler; the consumer `panel` targets `user-panel` and
 * wires the component-provided handler onto its handler list. The handler
 * mutates the panel's descendants from session state.
 */
function buildUserPanel(session: { loggedIn: boolean; name?: string }): PanelFixture {
  const root = makeRoot({ type: 'app' })
  const provider = childOf(root, makeNode({ type: 'user-provider' }), 0)
  const panel = childOf(provider, makeNode({ type: 'user-panel' }), 0)
  const username = childOf(panel, makeNode({ type: 'text', content: '…' }), 0)
  const loginBtn = childOf(panel, makeNode({ type: 'button', content: '' }), 1)

  const handlerDef: HandlerDef = {
    name: 'user-panel:populate',
    phase: 'after-compile',
    body: (ctx: unknown) => {
      const c = ctx as HandlerContext
      if (session.loggedIn) {
        c.clientAPI.apply(username.id, [{ targetProp: 'content', mode: 'replace', value: `Welcome, ${session.name}` }])
        c.clientAPI.apply(loginBtn.id, [{ targetProp: 'content', mode: 'replace', value: 'Sign out' }])
      } else {
        c.clientAPI.apply(loginBtn.id, [{ targetProp: 'content', mode: 'replace', value: 'Log in' }])
      }
    },
  }
  // the component provides the handler as its source value
  addComponentSource(provider, 'user-panel', { ...handlerDef })
  targetAnchor(panel, 'user-panel')
  // consumer wires the component-provided handler onto its handler list
  panel.addLayer({ id: 'component-handler', handlers: [handlerDef] })
  return { root, provider, panel, username, loginBtn }
}

function newSystem(panel: PanelFixture) {
  const events = new EventBridge()
  const supervisor = new Supervisor({ hub: hub(), events })
  for (const n of [panel.root, panel.provider, panel.panel, panel.username, panel.loginBtn]) supervisor.registerNode(n)
  return { supervisor, events, clientAPI: createClient(supervisor) }
}

async function flushTicks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0))
}

describe('e2e — component-provided after-compile handler (Step 7)', () => {
  it('the component resolves as the handler source: the binding carries the phase handler', () => {
    const panel = buildUserPanel({ loggedIn: true, name: 'Ada' })
    const cr = panel.root.compile([panel.root, panel.provider, panel.panel, panel.username, panel.loginBtn])
    const state = cr.actionable.find((s) => s.nodeId === panel.panel.id)
    expect(state).toBeDefined()
    const binding = state!.bindings['user-panel'] as { name: string; phase: string }
    expect(binding).toBeDefined()
    expect(binding.name).toBe('user-panel:populate')
    expect(binding.phase).toBe('after-compile')
  })

  it('logged in: the after-compile handler populates the username descendant; descendants re-render with the corrected data', async () => {
    const panel = buildUserPanel({ loggedIn: true, name: 'Ada' })
    const { supervisor } = newSystem(panel)

    // trigger pass-2 with a slice on the panel
    supervisor.apply({ kind: 'state-slice', node: panel.panel, mutation: [{ targetProp: 'props.role', mode: 'replace', value: 'main' }] })

    // after-compile runs in the flush, NOT synchronously with pass-1
    expect(panel.username.content).toBe('…')

    await flushTicks()

    // handler made a state change to descendants, journaled + identifiable
    expect(panel.username.content).toBe('Welcome, Ada')
    expect(panel.loginBtn.content).toBe('Sign out')
    expect(supervisor.journal).toHaveLength(3) // panel slice + username + login button
    expect(supervisor.journal[1]!.id).toBeDefined()

    // descendants render properly with the corrected data
    const cr = panel.root.compile([panel.root, panel.provider, panel.panel, panel.username, panel.loginBtn])
    const usernameState = cr.actionable.find((s) => s.nodeId === panel.username.id)!
    expect(usernameState.content).toBe('Welcome, Ada')
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const adapter = new MockAdapter()
    applyOps(adapter, ops)
    const texts = adapter.calls.filter((o): o is Extract<RenderOp, { kind: 'set' }> => o.kind === 'set' && o.name === 'text').map((o) => o.value)
    expect(texts).toContain('Welcome, Ada')
    expect(texts).toContain('Sign out')
  })

  it('logged out: the handler shows the login button; username untouched; button renders', async () => {
    const panel = buildUserPanel({ loggedIn: false })
    const { supervisor } = newSystem(panel)

    supervisor.apply({ kind: 'state-slice', node: panel.panel, mutation: [{ targetProp: 'props.role', mode: 'replace', value: 'main' }] })
    await flushTicks()

    expect(panel.loginBtn.content).toBe('Log in')
    expect(panel.username.content).toBe('…') // untouched
    expect(supervisor.journal).toHaveLength(2) // panel slice + login button

    const cr = panel.root.compile([panel.root, panel.provider, panel.panel, panel.username, panel.loginBtn])
    const ops = diffMinimal(null, cr.actionable.map(minimalFromState))
    const adapter = new MockAdapter()
    applyOps(adapter, ops)
    expect(adapter.calls.filter((o) => o.kind === 'set' && o.name === 'text' && o.value === 'Log in')).toHaveLength(1)
  })

  it('the corrected data survives a diff re-render: no element rebuild, only changed text is set', async () => {
    const panel = buildUserPanel({ loggedIn: true, name: 'Ada' })
    const { supervisor } = newSystem(panel)
    const slice = [panel.root, panel.provider, panel.panel, panel.username, panel.loginBtn]

    // pre-populate state: compile BEFORE the handler runs
    const pre = panel.root.compile(slice)
    const prevMap = new Map(pre.actionable.map(minimalFromState).map((e) => [e.wire, e]))

    supervisor.apply({ kind: 'state-slice', node: panel.panel, mutation: [{ targetProp: 'props.role', mode: 'replace', value: 'main' }] })
    await flushTicks()

    // diff the populated state against the pre-populate state
    const after = panel.root.compile(slice)
    const ops = diffMinimal(prevMap, after.actionable.map(minimalFromState))
    expect(ops.filter((o) => o.kind === 'create')).toHaveLength(0) // no rebuild
    const texts = ops.filter((o): o is Extract<RenderOp, { kind: 'set' }> => o.kind === 'set' && o.name === 'text').map((o) => o.value)
    expect(texts).toContain('Welcome, Ada')
    expect(texts).toContain('Sign out')
  })
})
