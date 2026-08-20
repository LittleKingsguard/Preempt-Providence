/**
 * Run C (RED) — the LEGACY-HANDLER RUNTIME BRIDGE (archive/reviews/
 * 2026-08-16/2026-08-16-legacy-handler-reuse-review.md §5/§6 + decisions
 * 3/4/5/6 + the user
 * directive 2026-08-15: children-injection SHIPS via the origin-owner
 * `layer-apply` op). Runtime surface: the NodeView proxy (WeakMap-backed per
 * live node), the arg-order wrapper + event stub, the per-member legacy
 * context (real supervisor + read-only userData captured at translate,
 * real clientAPI, rootNode view, states/tree passthrough), QueryUtils
 * (honest keys / unsupported-warn / predicate), and the receiveNextState
 * mapping incl. the ONE layer-apply children write.
 *
 * The 6 corpus defs (live-prod/placeholderLanding/placeholderLanding.json)
 * are read VERBATIM from the corpus file and wired via `handlers.<event>`
 * seam targets (event-only reuse — N5: the corpus's own afterAssembly
 * target is a legacy lifecycle name and stays excluded).
 *
 * States / fail-states enumerated:
 * [B1] eventStub — type/preventDefault/stopPropagation/target (NodeView)/
 *      isTrusted/value (args[0] when present) present through the seam wrap.
 * [B2] NodeView identity — one view per live node (WeakMap): the SAME view
 *      object across dispatches.
 * [B3] NodeView members — parent (token-terminated), children (family only,
 *      seam children excluded), css style STRING parsed to OBJECT on read.
 * [B4] receiveNextState type/content/props/css/handlers → state-slice;
 *      verified via the compiled node state after apply; css.style OBJECT
 *      writes serialize back (D3).
 * [B5] receiveNextState({children}) → ONE layer-apply: children minted as
 *      origin-owned family children, layer id deterministic per consumer,
 *      re-injection idempotent, teardown on layer removal.
 * [B6] QueryUtils — honest keys (type/id/classes/props exact-eq) match;
 *      unsupported keys (style/handlers/components/hasNonTypeTargetComponents)
 *      warn legacy-query-unsupported once per dispatch + match NOTHING;
 *      predicate-function queries supported.
 * [B7] userData — read-only passthrough captured from TranslatedTree.userData
 *      at translate; a WRITE is a contained no-op.
 * [B8] the 6 corpus defs compile + dispatch under the bridge:
 *      AuthInitHandler (userData read + receiveNextState type/content),
 *      ToggleUserDropdown (findNode({classes}) + parent walk + css read/write
 *      incl. style object spread), LogoutHandler verbatim, showComments (css
 *      write + children injection), toggleCommentsButton (window guard),
 *      enterEditMode (preventDefault + fetch path).
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { translateLegacy, reverseTranslate, type LegacyInitialData } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { EventBridge } from '../../src/core/events.js'
import { dispatchEvent, dispatchPhase } from '../../src/core/handlers.js'
import { mintedByOrigin } from '../../src/core/registry.js'
import { getNodeView } from '../../src/core/legacy-handlers.js'
import { emitElements, applyOps } from '../../src/core/render-helpers.js'
import { diffMinimal } from '../../src/core/render.js'
import { SSRFragmentAdapter } from '../../src/core/adapters.js'
import type { Node as NodeType } from '../../src/core/node.js'

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  delete (globalThis as Record<string, unknown>)['__bridge_seen']
})

/** The 6 corpus handler defs, verbatim from the live-prod envelope. */
const corpus = JSON.parse(
  readFileSync(new URL('../../live-prod/placeholderLanding/placeholderLanding.json', import.meta.url), 'utf8'),
) as {
  template: { root: { component: Array<{ reference: string; value: { name: string; body: string } }> } }
}
const corpusDefs = new Map(corpus.template.root.component.map((c) => [c.reference, c.value]))

const defs = (names: string[]): Array<{ reference: string; value: { name: string; body: string } }> =>
  names.map((n) => ({ reference: n, value: corpusDefs.get(n)! }))

/** The auth-scenario envelope: the userAuthDropdown container with the
 *  corpus defs wired via event targets (event-only reuse). */
function authEnv(userData?: unknown): ReturnType<typeof translateLegacy> {
  const env: LegacyInitialData = {
    template: {
      root: {
        type: 'app',
        component: defs(['AuthInitHandler', 'LogoutHandler', 'ToggleUserDropdown', 'showComments', 'toggleCommentsButton', 'enterEditMode']),
        children: [
          {
            type: 'div',
            css: { classes: ['user-auth-dropdown'] },
            component: [{ reference: 'AuthInitHandler', target: 'handlers.load' }],
            children: [
              {
                type: 'button',
                css: { classes: ['auth-main-btn'] },
                content: 'Sign In / Profile',
                component: [{ reference: 'ToggleUserDropdown', target: 'handlers.click' }],
              },
              {
                type: 'div',
                css: { classes: ['dropdown-menu'] },
                children: [
                  { type: 'a', props: { href: '/profile' }, content: 'Profile' },
                  { type: 'a', props: { href: '/inbox' }, content: 'Messages' },
                  {
                    type: 'button',
                    css: { classes: ['dropdown-btn-danger'] },
                    content: 'Logout',
                    component: [{ reference: 'LogoutHandler', target: 'handlers.click' }],
                  },
                ],
              },
            ],
          },
          {
            type: 'div',
            css: { style: { flex: '1', padding: '2rem' } },
            children: [
              {
                type: 'button',
                css: { style: { display: 'block' } },
                content: 'Show Comments',
                component: [
                  { reference: 'toggleCommentsButton', target: 'handlers.onLoad' },
                  { reference: 'showComments', target: 'handlers.click' },
                ],
              },
            ],
          },
          { type: 'div', content: 'editor', component: [{ reference: 'enterEditMode', target: 'handlers.click' }] },
        ],
      },
    },
    content: [{
      ...(userData !== undefined ? { userData } : {}),
      content: [{ type: 'div', props: { id: 'payload-root' } }],
    }],
    clientConfig: { runInstantiation: true },
  }
  const t = translateLegacy(env as never)
  expect(t.warnings).toEqual([])
  const sup = new Supervisor({ events: new EventBridge() })
  for (const n of t.nodes) sup.registerNode(n)
  t.root.compile(t.nodes)
  return t
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

/** One seam-wired handler dispatch on the container node, returning the
 *  single dispatch result. */
function dispatch(sup: Supervisor, node: NodeType, event: string, ...args: unknown[]): unknown {
  const results = dispatchEvent(node, sup.handlerContext, event, ...args)
  return results[0]
}

describe('BRIDGE — the event stub + the wrapper arg order (decision 4, A′ §2.3)', () => {
  function seamEnv(def: Record<string, unknown>): { sup: Supervisor; btn: NodeType } {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: def }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    return { sup, btn: t.root.children[0]! }
  }

  it('[B1] eventStub — type/preventDefault/stopPropagation/target (a NodeView)/isTrusted/value (args[0]) all present', () => {
    const { sup, btn } = seamEnv({
      name: 'cb',
      body: `(event, context) => {
        event.preventDefault();
        event.stopPropagation();
        return [
          event.type,
          event.isTrusted,
          event.value,
          event.target.type,
          typeof event.preventDefault,
          typeof event.stopPropagation,
          event.target.receiveNextState !== undefined,
        ];
      }`,
    })
    const results = dispatchEvent(btn, sup.handlerContext, 'click', 'v')
    const r = results[0] as unknown[]
    expect(r).toEqual(['click', false, 'v', 'button', 'function', 'function', true])
  })

  it('[B1b] value is ABSENT when the dispatch carries no args', () => {
    const { sup, btn } = seamEnv({
      name: 'cb',
      body: `(event, context) => Object.prototype.hasOwnProperty.call(event, 'value')`,
    })
    const results = dispatchEvent(btn, sup.handlerContext, 'click')
    expect(results[0]).toBe(false)
  })
})

describe('BRIDGE — the NodeView proxy (decision 3, review §5)', () => {
  it('[B2] identity — ONE view per live node (WeakMap): the SAME view object across dispatches', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: `(event, context) => {
            const seen = (globalThis.__bridge_seen = globalThis.__bridge_seen || []);
            seen.push(context.node);
            return seen.length > 1 ? seen[0] === context.node : true;
          }` } }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const btn = t.root.children[0]!
    expect(dispatch(sup, btn, 'click')).toBe(true)
    expect(dispatch(sup, btn, 'click')).toBe(true)
  })

  it('[B3] members — parent walk (token-terminated), children (family only), css style parsed to an OBJECT on read', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [{
            type: 'div',
            css: { style: { color: 'red' } },
            children: [{ type: 'button', content: 'me' }],
          }],
        },
      },
      content: [],
    })
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!.children[0]!
    const view = getNodeView(btn, {
      clientAPI: sup.clientAPI,
      supervisor: sup,
      tree: sup.handlerContext.tree,
    })
    // parent chain: button -> div -> app(root) -> null (token-terminated)
    expect(view.parent!.type).toBe('div')
    expect(view.parent!.parent!.type).toBe('app')
    expect(view.parent!.parent!.parent).toBeNull()
    // children: the authored child only
    expect(view.parent!.children.map((c) => c.type)).toEqual(['button'])
    // css style STRING parsed back to the OBJECT (F7)
    expect(view.parent!.css.style).toEqual({ color: 'red' })
  })

  it('[B4] receiveNextState — type/content/props/css/handlers map onto the state-slice; css.style OBJECT writes serialize back (D3)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: `(event, context) => {
            context.node.receiveNextState({
              type: 'a',
              content: 'Sign In',
              props: { href: '/api/oauth/login', flags: 1 },
              css: { style: { color: 'red' }, classes: ['btn'] },
              handlers: [{ name: 'h', event: 'click', body: '() => 1' }],
            });
            return 'done';
          }` } }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const btn = t.root.children[0]!
    expect(dispatch(sup, btn, 'click')).toBe('done')
    // the compiled pass-1 state reflects every mapped key (apply → addLayer → compileLocal)
    expect(btn.type).toBe('a')
    expect(btn.content).toBe('Sign In')
    expect(btn.props.href).toBe('/api/oauth/login')
    expect(btn.props.flags).toBe(1)
    expect(btn.css.style).toBe('color: red;')
    expect(btn.css.classes).toEqual(['btn'])
    // DEFECT #16 merge: the seam handler (cb:click) + the slice-injected
    // handler (h:click) both survive — append-with-override per (name, event)
    expect((btn.handlers as unknown[]).length).toBe(2)
    // the read side parses the serialized style back to the object
    expect(getNodeView(btn, { clientAPI: sup.clientAPI, supervisor: sup, tree: sup.handlerContext.tree }).css.style).toEqual({ color: 'red' })
  })

  it('[B5] receiveNextState({children}) → ONE layer-apply: origin-owned family children, deterministic layer id, idempotent re-injection, teardown on layer removal', async () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: `(event, context) =>
            context.node.receiveNextState({ children: [
              { type: 'div', content: 'c1' },
              { type: 'p', content: 'c2' },
            ] })` } }],
          children: [{ type: 'div', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const container = t.root.children[0]!
    expect(container.children.length).toBe(0)

    const res = dispatch(sup, container, 'click') as { status: string }
    expect(res.status).toBe('applied')
    // ONE journaled layer-apply
    expect(sup.journal.length).toBe(1)
    expect(sup.journal[0]!.op.kind).toBe('layer-apply')
    // the layer id is deterministic per consumer
    expect((sup.journal[0]!.op as { layerId?: string }).layerId).toBe(`legacy-kids-${container.id}`)
    // the children minted as family children, origin-marked + registered
    expect(container.children.length).toBe(2)
    expect(container.children.map((c) => c.type)).toEqual(['div', 'p'])
    expect(container.children[0]!.content).toBe('c1')
    const [m1, m2] = container.children
    expect(m1!.originLayer).toBe(`legacy-kids-${container.id}`)
    expect(m2!.originLayer).toBe(`legacy-kids-${container.id}`)
    expect(mintedByOrigin(`legacy-kids-${container.id}`).sort()).toEqual([m1!.id, m2!.id].sort())
    // the anchor layer on the creator: sourceName + child decls carrying origin
    const layer = container.layers.find((l) => l.id === `legacy-kids-${container.id}`)
    expect(layer).toBeDefined()
    expect(layer!.sourceName).toBe('legacy-bridge')
    expect(layer!.anchors!.every((d) => d.role === 'child' && d.options!.origin === `legacy-kids-${container.id}`)).toBe(true)

    // RE-INJECTION is idempotent: same children again → no duplicate mint
    const res2 = dispatch(sup, container, 'click') as { status: string; minted: unknown[] }
    expect(res2.status).toBe('applied')
    expect(res2.minted).toEqual([])
    expect(container.children.length).toBe(2)
    expect(sup.journal.length).toBe(2)
    expect(sup.journal[1]!.op.kind).toBe('layer-apply')

    // TEARDOWN on layer removal: the whole minted set is detached + swept
    container.removeLayer(`legacy-kids-${container.id}`)
    expect(container.layers.find((l) => l.id === `legacy-kids-${container.id}`)).toBeUndefined()
    expect(container.children.length).toBe(0)
    expect(mintedByOrigin(`legacy-kids-${container.id}`)).toEqual([])
    await flush()
    expect(m1!.destroyed).toBe(true)
    expect(m2!.destroyed).toBe(true)
  })
})

describe('BRIDGE — QueryUtils (decision 5: adapter-internal)', () => {
  const queryEnv = (): ReturnType<typeof translateLegacy> => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: `(event, context) => {
            const v = context.node;
            return [
              v.findNode({ type: 'a' })?.content ?? null,
              v.findNodes({ type: 'a' }).length,
              v.findNode({ id: 'the-menu' })?.type ?? null,
              v.findNode({ classes: ['dropdown-menu'] })?.type ?? null,
              v.findNode({ props: { href: '/profile' } })?.content ?? null,
              v.findNode((n) => n.content === 'Messages')?.content ?? null,
              v.findNode({ style: { display: 'none' } }) ?? 'unsupported-style',
              v.findNode({ handlers: ['click'] }) ?? 'unsupported-handlers',
              v.findNode({ components: ['x'] }) ?? 'unsupported-components',
              v.findNode({ hasNonTypeTargetComponents: true }) ?? 'unsupported-hasNonType',
            ];
          }` } }],
          children: [{
            type: 'div',
            css: { classes: ['user-auth-dropdown'] },
            component: [{ reference: 'cb', target: 'handlers.click' }],
            children: [
              { type: 'div', css: { id: 'the-menu', classes: ['dropdown-menu'] }, children: [
                { type: 'a', props: { href: '/profile' }, content: 'Profile' },
                { type: 'a', props: { href: '/inbox' }, content: 'Messages' },
              ] },
            ],
          }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    return t
  }

  it('[B6] honest keys match (type/id/classes/props exact-eq + predicate); unsupported keys warn legacy-query-unsupported ONCE per dispatch and match NOTHING', () => {
    const t = queryEnv()
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const container = t.root.children[0]!
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const results = dispatch(sup, container, 'click') as unknown[]
      expect(results[0]).toBe('Profile')
      expect(results[1]).toBe(2)
      expect(results[2]).toBe('div')
      expect(results[3]).toBe('div')
      expect(results[4]).toBe('Profile')
      expect(results[5]).toBe('Messages')
      // every unsupported key matches NOTHING (never a silent misfire)
      expect(results[6]).toBe('unsupported-style')
      expect(results[7]).toBe('unsupported-handlers')
      expect(results[8]).toBe('unsupported-components')
      expect(results[9]).toBe('unsupported-hasNonType')
      // the warn fires exactly ONCE for the whole dispatch
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('legacy-query-unsupported')).length).toBe(1)
    } finally {
      warn.mockRestore()
    }
  })
})

describe('BRIDGE — userData passthrough (decision 6)', () => {
  it('[B7] read-only passthrough: supervisor.userData = TranslatedTree.userData captured at translate; a WRITE is a contained no-op', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: `(event, context) => {
            const ud = context.supervisor.userData;
            context.supervisor.userData = { hacked: true };
            return ud;
          }` } }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [{ userData: { session: 's1' }, content: [{ type: 'div' }] }],
      clientConfig: { runInstantiation: true },
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const btn = t.root.children[0]!
    // the write is a contained no-op: every dispatch still reads the ORIGINAL value
    expect(dispatch(sup, btn, 'click')).toEqual({ session: 's1' })
    expect(dispatch(sup, btn, 'click')).toEqual({ session: 's1' })
  })
})

describe('BRIDGE — the 6 corpus defs compile + dispatch (decision-7 corpus, event-only reuse)', () => {
  it('[B8a] AuthInitHandler — userData READ: signed-in → receiveNextState({content}) on the first child', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const t = authEnv({ session: 's1' })
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const container = t.root.children[0]!
    dispatch(sup, container, 'load')
    const btn = container.children[0]!
    expect(btn.content).toBe('Profile ▼')
  })

  it('[B8a2] AuthInitHandler — NOT signed-in → receiveNextState({type, content, props}) on the first child; the direct mutations are graph no-ops', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const t = authEnv() // no userData
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const container = t.root.children[0]!
    expect(container.children.length).toBe(2)
    dispatch(sup, container, 'load')
    const btn = container.children[0]!
    // the receiveNextState write mapped type/content/props
    expect(btn.type).toBe('a')
    expect(btn.content).toBe('Sign In')
    expect(btn.props.href).toBe('/api/oauth/login')
    // the direct mutations (targetComponents.delete / children.pop / content.pop)
    // are documented graph no-ops: the graph is untouched
    expect(btn.anchors.some((a) => a.role === 'target' && a.target === 'ToggleUserDropdown')).toBe(true)
    expect(container.children.length).toBe(2)
  })

  it('[B8b] ToggleUserDropdown — findNode({classes}) + parent walk + css read/write incl. style object spread (toggle)', () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const t = authEnv({ session: 's1' })
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const btn = t.root.children[0]!.children[0]!
    // the dropdown's initial style: none (no display authored → parse of '' → {})
    const dropdown = t.root.children[0]!.children[1]!
    // first click: display '' → block
    dispatch(sup, btn, 'click')
    expect(dropdown.css.style).toBe('display: block;')
    // second click: block → none
    dispatch(sup, btn, 'click')
    expect(dropdown.css.style).toBe('display: none;')
  })

  it('[B8c] LogoutHandler — VERBATIM: fetch POST + redirect on failure', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'))
    vi.stubGlobal('fetch', fetchMock)
    vi.stubGlobal('window', { location: { href: '' } })
    const t = authEnv({ session: 's1' })
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const logoutBtn = t.root.children[0]!.children[1]!.children[2]!
    dispatch(sup, logoutBtn, 'click')
    expect(fetchMock).toHaveBeenCalledWith('/api/logout', { method: 'POST' })
    await flush()
    expect((globalThis.window as { location: { href: string } }).location.href).toBe('/api/oauth/logout')
  })

  it('[B8d] showComments (css write + the CHILDREN INJECTION as ONE layer-apply), toggleCommentsButton (window guard), enterEditMode (preventDefault + fetch path) all dispatch without crashing', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('window', {})
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => [] }))
    const t = authEnv({ session: 's1' })
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const wrapper = t.root.children[1]!
    const showBtn = wrapper.children[0]!
    const journalBefore = sup.journal.length

    // toggleCommentsButton: window.Preempt absent → guarded early return
    expect(dispatch(sup, showBtn, 'onLoad')).toBeUndefined()
    expect(sup.journal.length).toBe(journalBefore)

    // showComments: css write on the button + children injection on the parent
    dispatch(sup, showBtn, 'click')
    expect(showBtn.css.style).toBe('display: none;')
    // ONE layer-apply journaled for the children write
    expect(sup.journal[sup.journal.length - 1]!.op.kind).toBe('layer-apply')
    expect(wrapper.children.length).toBe(3) // authored button + 2 minted
    const minted = wrapper.children.slice(1)
    expect(minted.every((c) => c.originLayer === `legacy-kids-${wrapper.id}`)).toBe(true)
    const commentsContainer = minted.find((c) => (c.props as { name?: string } | undefined)?.name === 'commentsContainer')
    expect(commentsContainer).toBeDefined()

    // enterEditMode: preventDefault on the stub + the fetch path (items empty → return)
    const editBtn = t.root.children[2]!
    const res = dispatch(sup, editBtn, 'click')
    await expect(res).resolves.toBeUndefined() // the async body returned early without throwing
    expect((globalThis.fetch as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith('/api/content?tags=editor-tools')
  })
})

describe('ROUND-5 DEFECTS — #16 merge / #17 seed leak / #18 seam-install containment (2026-08-15)', () => {
  it('[D16] a consumer with an AUTHORED inline handler AND a seam handler dispatches BOTH (append-with-override merge)', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: '(e, c) => { return "seam" }' } }],
          children: [{
            type: 'button',
            handlers: [{ name: 'authored', event: 'click', body: '(ctx) => { return "authored" }' }],
            component: [{ reference: 'cb', target: 'handlers.click' }],
          }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!
    t.root.compile(t.nodes)
    const results = dispatchEvent(btn, sup.handlerContext, 'click')
    const values = results.map(String).sort()
    expect(values).toEqual(['authored', 'seam'])
  })

  it('[D17] reverse emits the authored handlers ONCE (no seed-layer double); a second reverse does not compound', () => {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          children: [{ type: 'button', handlers: [{ name: 'h', event: 'click', body: '() => {}' }] }],
        },
      },
      content: [],
    } as never)
    const rev1 = reverseTranslate(t.root)
    const kids1 = rev1.template.root.children![0]!
    const hs1 = (Array.isArray(kids1.handlers) ? kids1.handlers : []) as Array<{ name: string }>
    expect(hs1.filter((h) => h.name === 'h')).toHaveLength(1)
    const rev2 = reverseTranslate(translateLegacy(rev1).root)
    const kids2 = rev2.template.root.children![0]!
    const hs2 = (Array.isArray(kids2.handlers) ? kids2.handlers : []) as Array<{ name: string }>
    expect(hs2.filter((h) => h.name === 'h')).toHaveLength(1)
  })

  it('[D18] a seam def whose body does not evaluate is contained — compile completes, other bindings materialize, handler-body-invalid warns', () => {
    const warns: string[] = []
    const orig = console.warn
    console.warn = (m: unknown) => { warns.push(String(m)) }
    try {
      const t = translateLegacy({
        template: {
          root: {
            type: 'app',
            component: [
              { reference: 'bad', value: { name: 'bad', body: 'not-a-function' } },
              { reference: 'good', value: { name: 'good', body: '(e, c) => { return "ok" }' } },
            ],
            children: [{
              type: 'button',
              component: [
                { reference: 'bad', target: 'handlers.click' },
                { reference: 'good', target: 'handlers.onLoad' },
              ],
            }],
          },
        },
        content: [],
      } as never)
      const sup = new Supervisor({ events: new EventBridge() })
      for (const n of t.nodes) sup.registerNode(n)
      const btn = t.root.children[0]!
      t.root.compile(t.nodes)
      // no abort: the GOOD binding still materialized + dispatches (its own
      // event — the bad click binding was the abort trigger)
      const results = dispatchEvent(btn, sup.handlerContext, 'onLoad')
      expect(String(results[0])).toContain('ok')
      expect(warns.some((w) => w.includes('handler-body-invalid'))).toBe(true)
    } finally {
      console.warn = orig
    }
  })
})

describe('AUTH-SEAM — the def handler copies to the TYPE-target consumer (2026-08-15)', () => {
  // The legacy auth pattern: the userAuthComponent def carries
  // `handlers.afterAssembly` → AuthInitHandler. Per the design: the handler
  // COPIES with the def's data onto the TYPE-target consumer (the assembled
  // component node) — it never executes on the component prototype. The
  // consumer collapses into the def element with the def children as its
  // children; after-compile fires the copied phase handler with
  // ctx.node = the consumer (children[0] = the button, in-tree).
  const authEnvelope = (userData?: Record<string, unknown>) => ({
    template: {
      root: {
        type: 'app',
        component: [
          {
            reference: 'auth',
            value: {
              type: 'div',
              css: { classes: ['user-auth-dropdown'] },
              component: [{ target: 'handlers.afterAssembly', reference: 'AuthInitHandler' }],
              children: [
                { type: 'button', css: { classes: ['auth-main-btn'] }, content: 'Sign In / Profile', component: [{ target: 'handlers.click', reference: 'ToggleUserDropdown' }] },
                { type: 'div', css: { classes: ['dropdown-menu'] }, children: [{ type: 'a', props: { href: '/profile' }, content: 'Profile' }] },
              ],
            },
          },
          {
            reference: 'AuthInitHandler',
            value: {
              name: 'AuthInitHandler',
              body: `(event, context) => {
                const node = context.node;
                const btn = node.children[0];
                if (context.supervisor.userData) {
                  context.clientAPI.apply(btn.id, { kind: 'state-slice', mutation: [{ targetProp: 'content', mode: 'replace', value: 'Profile ▼' }] });
                } else {
                  context.clientAPI.apply(btn.id, { kind: 'state-slice', mutation: [
                    { targetProp: 'type', mode: 'replace', value: 'a' },
                    { targetProp: 'content', mode: 'replace', value: 'Sign In' },
                    { targetProp: 'props.href', mode: 'replace', value: '/api/oauth/login' },
                  ]});
                  context.clientAPI.apply(node.children[1].id, { kind: 'destroy' });
                }
                return 'auth-done';
              }`,
            },
          },
          { reference: 'ToggleUserDropdown', value: { name: 'ToggleUserDropdown', body: '() => {}' } },
        ],
        children: [{ type: 'div', props: { id: 'auth-consumer' }, component: [{ target: 'type', reference: 'auth' }] }],
      },
    },
    content: [{ ...(userData ? { userData } : {}), content: [] }],
  })

  it('[AU1] handlers.afterAssembly plans a PHASE (after-compile) — NO handler-phase-unknown warn; the other lifecycle names still warn+skip', () => {
    const t = translateLegacy(authEnvelope() as never)
    expect(t.warnings.filter((w) => w.code === 'handler-phase-unknown')).toEqual([])
    const t2 = translateLegacy({
      template: { root: { type: 'app', component: [{ reference: 'x', value: { name: 'x', body: '() => {}' } }], children: [{ type: 'div', component: [{ reference: 'x', target: 'handlers.beforeAssembly' }] }] } },
      content: [],
    } as never)
    expect(t2.warnings.map((w) => w.code)).toContain('handler-phase-unknown')
  })

  it('[AU2] the handler COPIES to the type-target consumer (never the prototype); WITHOUT userData the button converts to a Sign-In link and the dropdown is destroyed', () => {
    const t = translateLegacy(authEnvelope() as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = t.root.children[0]!
    // the handler ran on the CONSUMER (not a prototype): the phase entry lives there
    expect(consumer.handlers?.some((h) => (h as { phase?: string; name?: string }).phase === 'after-compile' && (h as { name?: string }).name === 'AuthInitHandler')).toBe(true)
    const results = dispatchPhase(consumer, sup.handlerContext, 'after-compile')
    expect(String(results[0])).toContain('auth-done')
    // the consumer's children are the def children (button + dropdown), in-tree
    const btn = consumer.children[0]!
    expect(btn.type).toBe('a')
    expect(btn.content).toBe('Sign In')
    expect(btn.props.href).toBe('/api/oauth/login')
    expect(consumer.children[1]!.destroyed).toBe(true)
  })

  it('[AU3] WITH userData the button becomes the profile label and the dropdown survives', () => {
    const t = translateLegacy(authEnvelope({ username: 'alice' }) as never)
    expect(t.userData).toEqual({ username: 'alice' })
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = t.root.children[0]!
    const results = dispatchPhase(consumer, sup.handlerContext, 'after-compile')
    expect(String(results[0])).toContain('auth-done')
    expect(consumer.children[0]!.content).toBe('Profile ▼')
    expect(consumer.children[0]!.type).toBe('button')
    expect(consumer.children[1]!.destroyed).not.toBe(true)
  })

  it('[N5] DEFECT #20 (top-level) — the destroyed adopted def child\'s element does NOT emit in the SED-1 def-fill either; the converted chip still does', () => {
    const t = translateLegacy(authEnvelope() as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = t.root.children[0]!
    dispatchPhase(consumer, sup.handlerContext, 'after-compile')
    // the harness flow: dispatch → RECOMPILE → emit
    const cr2 = t.root.compile(t.nodes)
    const byNode = new Map(sup.allNodes().map((n) => [n.id, n])) as never
    const els = emitElements(cr2.actionable, byNode)
    expect(els.some((e) => String(e.props['css:classes'] ?? '').includes('dropdown-menu'))).toBe(false)
    const btnEl = els.find((e) => e.type === 'a' && String(e.props['css:classes'] ?? '').includes('auth-main-btn'))
    expect(btnEl).toBeDefined()
    expect(String(btnEl!.props['text'])).toBe('Sign In')
  })
})

describe('AUTH-SEAM — NESTED seam consumer (def-in-def, 2026-08-16)', () => {
  // The live-prod auth pattern NESTED: the nav def's child div is a
  // `target: 'type'` seam consumer of the auth def — a PROTOTYPE-CHAIN node
  // (family child of the nav def-root prototype, itself token-terminated),
  // so it is never viable and the compile gate used to skip its seam
  // install entirely (the nested defect: no copied phase handler → no
  // dispatch, no adopted def children → the handler's children[0] is
  // undefined, the state-slice gate rejects prototype nodes, and the
  // nested-seam emit sources the SPEC data → the converted button never
  // renders). The fix: the seam install runs for every SEAM-BEARING node
  // regardless of viability; adopted def children are mutable in a
  // prototype chain; the emit sources the mutated proto pass1.
  const nestedEnvelope = (userData?: Record<string, unknown>) => ({
    template: {
      root: {
        type: 'app',
        component: [
          {
            reference: 'nav',
            value: {
              type: 'nav',
              css: { classes: ['nav-bar'] },
              children: [
                { type: 'div', props: { id: 'auth-slot' }, component: [{ target: 'type', reference: 'auth' }] },
              ],
            },
          },
          {
            reference: 'auth',
            value: {
              type: 'div',
              css: { classes: ['user-auth-dropdown'] },
              component: [{ target: 'handlers.afterAssembly', reference: 'AuthInitHandler' }],
              children: [
                { type: 'button', css: { classes: ['auth-main-btn'] }, content: 'Sign In / Profile', component: [{ target: 'handlers.click', reference: 'ToggleUserDropdown' }] },
                { type: 'div', css: { classes: ['dropdown-menu'] }, children: [{ type: 'a', props: { href: '/profile' }, content: 'Profile' }] },
              ],
            },
          },
          {
            reference: 'AuthInitHandler',
            value: {
              name: 'AuthInitHandler',
              body: `(event, context) => {
                const node = context.node;
                const btn = node.children[0];
                if (context.supervisor.userData) {
                  context.clientAPI.apply(btn.id, { kind: 'state-slice', mutation: [{ targetProp: 'content', mode: 'replace', value: 'Profile ▼' }] });
                } else {
                  context.clientAPI.apply(btn.id, { kind: 'state-slice', mutation: [
                    { targetProp: 'type', mode: 'replace', value: 'a' },
                    { targetProp: 'content', mode: 'replace', value: 'Sign In' },
                    { targetProp: 'props.href', mode: 'replace', value: '/api/oauth/login' },
                  ]});
                  context.clientAPI.apply(node.children[1].id, { kind: 'destroy' });
                }
                return 'auth-done';
              }`,
            },
          },
          { reference: 'ToggleUserDropdown', value: { name: 'ToggleUserDropdown', body: '() => {}' } },
        ],
        children: [{ type: 'div', component: [{ target: 'type', reference: 'nav' }] }],
      },
    },
    content: [{ ...(userData ? { userData } : {}), content: [] }],
  })

  /** the NESTED auth consumer: the nav def child whose `type`-seam target
   *  names 'auth' — a prototype-chain node (the top-level consumer targets
   *  'nav' and is in-tree, so this find is unambiguous). */
  const nestedConsumer = (t: ReturnType<typeof translateLegacy>) =>
    t.nodes.find((n) =>
      n.anchors.some((a) => (a.role === 'target' || a.role === 'duplex') && typeof a.target === 'string'
        && a.target === 'auth' && a.options.seam === 'type')
      && n.state === 'prototype',
    )!

  it('[N1] the NESTED (prototype-chain) consumer installs the copied phase handler + adopted def children; WITHOUT userData the button converts and the dropdown is destroyed', () => {
    const t = translateLegacy(nestedEnvelope() as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = nestedConsumer(t)
    expect(consumer.state).toBe('prototype')
    // the phase entry COPIES onto the nested consumer (the same cast pattern
    // as AU2 — the nested seam install runs even though the node is never
    // viable)
    expect(consumer.handlers?.some((h) => (h as { phase?: string; name?: string }).phase === 'after-compile' && (h as { name?: string }).name === 'AuthInitHandler')).toBe(true)
    // the def children are family-adopted onto the nested consumer
    expect(consumer.children.length).toBe(2)
    expect(consumer.children[0]!.type).toBe('button')
    expect((consumer.children[0]!.css as { classes?: string[] }).classes).toContain('auth-main-btn')
    expect((consumer.children[1]!.css as { classes?: string[] }).classes).toContain('dropdown-menu')
    const results = dispatchPhase(consumer, sup.handlerContext, 'after-compile')
    expect(String(results[0])).toContain('auth-done')
    const btn = consumer.children[0]!
    expect(btn.type).toBe('a')
    expect(btn.content).toBe('Sign In')
    expect(btn.props.href).toBe('/api/oauth/login')
    expect(consumer.children[1]!.destroyed).toBe(true)
  })

  it('[N2] WITH userData the profile label lands on the nested button and the dropdown survives', () => {
    const t = translateLegacy(nestedEnvelope({ username: 'alice' }) as never)
    expect(t.userData).toEqual({ username: 'alice' })
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = nestedConsumer(t)
    const results = dispatchPhase(consumer, sup.handlerContext, 'after-compile')
    expect(String(results[0])).toContain('auth-done')
    expect(consumer.children[0]!.content).toBe('Profile ▼')
    expect(consumer.children[0]!.type).toBe('button')
    expect(consumer.children[1]!.destroyed).not.toBe(true)
  })

  it('[N3] RENDER reflection: after dispatch + recompile the emitted auth-button element is the CONVERTED link (type a, text Sign In)', () => {
    const t = translateLegacy(nestedEnvelope() as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = nestedConsumer(t)
    dispatchPhase(consumer, sup.handlerContext, 'after-compile')
    // the harness flow: dispatch → RECOMPILE → emit
    const cr2 = t.root.compile(t.nodes)
    const byNode = new Map(sup.allNodes().map((n) => [n.id, n])) as never
    const els = emitElements(cr2.actionable, byNode)
    const btnEl = els.find((e) => e.type === 'a' && String(e.props['css:classes'] ?? '').includes('auth-main-btn'))
    expect(btnEl).toBeDefined()
    expect(btnEl!.type).toBe('a')
    expect(String(btnEl!.props['text'])).toBe('Sign In')
    expect(btnEl!.props['prop:href']).toBe('/api/oauth/login')
    // the render probe: a fresh diff + adapter application surfaces the
    // converted link in the HTML fragment
    const ops = diffMinimal(null, els)
    const adapter = new SSRFragmentAdapter()
    applyOps(adapter, ops)
    expect(adapter.toString()).toContain('<a')
    expect(adapter.toString()).toContain('Sign In')
  })

  it('[N4] DEFECT #20 (nested) — the destroyed adopted def child\'s element does NOT emit (the def-fill prunes it); the converted chip still does', () => {
    const t = translateLegacy(nestedEnvelope() as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = nestedConsumer(t)
    dispatchPhase(consumer, sup.handlerContext, 'after-compile')
    // the harness flow: dispatch → RECOMPILE → emit
    const cr2 = t.root.compile(t.nodes)
    const byNode = new Map(sup.allNodes().map((n) => [n.id, n])) as never
    const els = emitElements(cr2.actionable, byNode)
    // the destroyed dropdown's element must NOT surface (def-fill prune)
    expect(els.some((e) => String(e.props['css:classes'] ?? '').includes('dropdown-menu'))).toBe(false)
    const btnEl = els.find((e) => e.type === 'a' && String(e.props['css:classes'] ?? '').includes('auth-main-btn'))
    expect(btnEl).toBeDefined()
    expect(String(btnEl!.props['text'])).toBe('Sign In')
  })
})

describe('DEFECT #27 — a handlers state-slice CAN clear (empty value = CLEAR, durable vs the seam rebuild)', () => {
  function seamButton() {
    const t = translateLegacy({
      template: {
        root: {
          type: 'app',
          component: [{ reference: 'cb', value: { name: 'cb', body: '(e, c) => { return "seam" }' } }],
          children: [{ type: 'button', component: [{ reference: 'cb', target: 'handlers.click' }] }],
        },
      },
      content: [],
    } as never)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const btn = t.root.children[0]!
    t.root.compile(t.nodes)
    return { sup, btn, root: t.root }
  }

  it('an empty handlers state-slice value [] CLEARS seam-installed handlers AND survives a re-compile (seam suppressed)', () => {
    const { sup, btn, root } = seamButton()
    expect((btn.handlers as unknown[]).length).toBe(1) // the seam handler is installed
    const res = sup.apply({ kind: 'state-slice', node: btn, mutation: [{ targetProp: 'handlers', mode: 'replace', value: [] }] })
    expect(res.status).toBe('applied')
    expect((btn.handlers as unknown[]).length).toBe(0) // cleared
    root.compile([root, btn]) // a re-compile must NOT re-materialize the seam handler
    expect((btn.handlers as unknown[]).length).toBe(0) // durable
  })

  it('dispatching after the clear runs NOTHING (the one-shot self-removal works end-to-end)', () => {
    const { sup, btn } = seamButton()
    sup.apply({ kind: 'state-slice', node: btn, mutation: [{ targetProp: 'handlers', mode: 'replace', value: [] }] })
    const results = dispatchEvent(btn, sup.handlerContext, 'click')
    expect(results).toEqual([])
  })

  it('a NON-EMPTY handlers write still appends-with-override to the seam (D16/B4 preserved — no regression)', () => {
    const { sup, btn } = seamButton()
    sup.apply({
      kind: 'state-slice',
      node: btn,
      mutation: [{ targetProp: 'handlers', mode: 'replace', value: [{ name: 'h', event: 'click', body: () => 'injected' }] }],
    })
    const names = (btn.handlers as Array<{ name: string }>).map((h) => h.name).sort()
    expect(names).toEqual(['cb', 'h']) // seam + injected both survive (append-with-override)
  })
})
