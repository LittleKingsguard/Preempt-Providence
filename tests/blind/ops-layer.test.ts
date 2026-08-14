/**
 * BLIND-TEST WRITER artifact — OPS LAYER contract test (input→output).
 *
 * Sources (ONLY): docs/specs/ops.md §1/§2.6/§4/§7 (G21/G22), docs/specs/api.md §1/§3.3/§7
 * (T6/T16/T32, W2/W3), docs/specs/placement-path-spec.md (FINAL) §1.2/§3.3 + §6.2
 * (node.ts:413 guard, supervisor rows), docs/specs/node.md FS-10, designing-pages §11
 * (supervisor.test.ts rows S-P1..S-P6).
 *
 * Contract under test: mutations (ops through ClientAPI.apply) → state/event outputs.
 *
 * AMBIGUITIES (my readings — the reviewer adjudicates):
 *  D1. Supervisor construction/registration/state access: fork-stress-data §5 names
 *      `takePass2States()` and ops.md names `supervisor.registerNode` (idempotent).
 *      Reading: `new Supervisor()`, `supervisor.registerNode(n)`, `supervisor.takePass2States()`.
 *  D2. Raw event envelopes (topic/tick/seq) are transport-level (api.md §7 W1). The
 *      per-path state-event CONTRACT (W2/W3: one event per (nodeId, forkKey) of the
 *      affected set, fork: { forkKey: pathKey, nodeIds: trace }, never collapsed per
 *      node) is encoded via the pass-2 state set (takePass2States) + the client's
 *      per-path exposure (api.md §6 getState → ExposedState[].fork). The reviewer may
 *      substitute the WS event surface for the envelope assertions.
 *  D3. The runtime anchor-declaration shape for the duplicate-source guard: api.md §4
 *      ComponentAnchorDecl = { referenceName, role, value? } via Node.addAnchor
 *      (node.ts:413); the warn channel is console.warn (K4-style additive, warn+skip).
 *  D4. Trigger derivation when absent from the payload (ops.md §2.6): a container
 *      anchor NEWLY minted ⇒ 'container-added', else 'content-added'.
 */
import { describe, it, expect, vi } from 'vitest'
import { translateLegacy } from '../../src/core/translate.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { createClient } from '../../src/core/client.js'
import { Link } from '../../src/core/link.js'
import { Node } from '../../src/core/node.js'

/* ------------------------------------------------------------------ */
/* local, documentation-derived types                                 */
/* ------------------------------------------------------------------ */

interface NodeView {
  id: string
  state: string
  props: Record<string, unknown>
  type: string
  children: NodeView[]
  anchors: Array<{ role: string; target: unknown; link?: unknown; value?: unknown }>
}
interface TranslatedView {
  root: NodeView
  nodes: NodeView[]
  content: NodeView[]
  warnings: Array<{ code: string; path?: string }>
}
interface PathState {
  nodeId: string
  pathKey: string
  forkKey?: string
  props: Record<string, unknown>
  children: unknown[]
  [k: string]: unknown
}
interface ExposedState {
  nodeId: string
  status: string
  fork?: { name?: string; forkKey: string; nodeIds: string[] }
}
type ApplyResult =
  | { status: 'applied'; journalId: string; dirtied: string[] }
  | { status: 'no-usable-state'; nodeState: string }
  | { status: 'rejected'; error: { code: string; detail?: unknown } }

/* ------------------------------------------------------------------ */
/* harness                                                            */
/* ------------------------------------------------------------------ */

const asView = (t: unknown): TranslatedView => t as TranslatedView
const statesOf = (result: unknown): PathState[] =>
  (Array.isArray(result) ? result : (result as { actionable: PathState[] }).actionable) as PathState[]

const flush = async () => {
  await new Promise((r) => setTimeout(r, 0))
  await new Promise((r) => setTimeout(r, 0))
}

interface Harness {
  t: TranslatedView
  supervisor: Supervisor
  client: {
    apply(nodeRef: string, mutation: unknown): ApplyResult
    getState(nodeRef: string): ExposedState[]
  }
  pass2Keys: () => string[]
}

async function setup(envelope: unknown): Promise<Harness> {
  const t = asView(translateLegacy(envelope as never))
  const supervisor = new Supervisor({}) // D1 — hub-less supervisor; the NODES carry the translate hub
  for (const n of t.nodes) supervisor.registerNode(n as never) // D1
  const client = createClient(supervisor) as Harness['client']
  // one path-enumeration bootstrap over every node (§2.1: per-node compilePath
  // — engine pattern compileAll, path-enum.test.ts:90-92) + seed the resolved
  // store so getResolvedStates exposes the path-states pre-op
  const all: PathState[] = []
  for (const n of t.nodes) {
    all.push(...(n as unknown as { compilePath(): { actionable: PathState[] } }).compilePath().actionable)
  }
  supervisor.recordResolved(all as never)
  await flush()
  return {
    t,
    supervisor,
    client,
    pass2Keys: () => [...supervisor.takePass2States().values()].flat().map((s) => s.pathKey),
  }
}

/* ------------------------------------------------------------------ */
/* placement-attach op (ops.md §2.6, G21, T16-b, E2E-4 dirty set)      */
/* ------------------------------------------------------------------ */

describe('ops layer — placement-attach (G21, S-P1)', () => {
  it('registers-if-new, mints ordered content anchors (dedup keep-first), ensures the container anchor, dirty = {container, added} only', async () => {
    // fixture: root(zone-0); l1(zone-1); l2(zone-2); p3(zone-3); p4a/p4b (consume zone-3); d5a (consume zone-4 under p4a)
    const { t, client, supervisor, pass2Keys } = await setup({
      template: { root: { type: 'app', placement: { placementName: 'zone-0' } } },
      content: [
        {
          content: [
            { type: 'div', props: { id: 'l1' }, placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] } },
            { type: 'div', props: { id: 'l2' }, placement: { placementName: 'zone-2', targetPlacement: ['zone-1'] } },
            { type: 'div', props: { id: 'p3' }, placement: { placementName: 'zone-3', targetPlacement: ['zone-2'] } },
            { type: 'div', props: { id: 'p4a' }, placement: { placementName: 'zone-4', targetPlacement: ['zone-3'] } },
            { type: 'div', props: { id: 'p4b' }, placement: { targetPlacement: ['zone-3'] } },
            { type: 'div', props: { id: 'd5a' }, placement: { targetPlacement: ['zone-4'] } },
          ],
        },
      ],
    })
    const byId = new Map(t.nodes.map((n) => [n.props.id as string, n]))
    const p3 = byId.get('p3')!
    const d5a = byId.get('d5a')!
    const p4a = byId.get('p4a')!

    const p4new = new Node({ type: 'section', props: { id: 'p4new' } })
    supervisor.registerNode(p4new as never)
    const res = client.apply(p4new.id, {
      kind: 'placement-attach',
      node: p4new.id,
      container: p3.id,
      names: ['zone-3'],
    })
    expect(res.status).toBe('applied')
    const applied = res as { status: 'applied'; dirtied: string[] }
    expect(new Set(applied.dirtied)).toEqual(new Set([p3.id, p4new.id]))
    await flush()

    // the added node's content anchor minted; the container anchor ensured (already present ⇒ no new)
    const newAnchors = (p4new as unknown as NodeView).anchors.filter((a) => a.role === 'content')
    expect(newAnchors.map((a) => a.target)).toEqual(['zone-3'])
    // E2E-4: no depth>4 recalc — pass-2 keys are ONLY {p3 path, p4new path}; d5a/p4a/p4b silent
    // (§2.2 grammar: each own placement hop contributes /zone/ownerId; the root landing contributes nothing)
    const p3Key = `root/zone-1/${byId.get('l1')!.id}/zone-2/${byId.get('l2')!.id}/${p3.id}`
    // §2.2 key grammar: the added node's own consumer hop (zone-3 → owner p3)
    // is inserted BEFORE its own id — p3's key with '/zone-3/p3' before '/p4new'
    const p4newKey = `root/zone-1/${byId.get('l1')!.id}/zone-2/${byId.get('l2')!.id}/zone-3/${p3.id}/${p4new.id}`
    // pass2Keys() DRAINS — capture once
    const pass2 = pass2Keys()
    expect(new Set(pass2)).toEqual(new Set([p3Key, p4newKey]))
    expect(pass2.includes(p3Key)).toBe(true)
    expect(pass2.includes(p4newKey)).toBe(true)
    expect(pass2.some((k) => k.includes(d5a.id))).toBe(false)
    expect(pass2.some((k) => k.includes(p4a.id))).toBe(false)

    // the added node's single path-state is actionable (one container for zone-3) —
    // per-path exposure via the supervisor's resolved store (getState is the
    // api.md:151 surface-only read; the W2/W3 per-path exposure is the
    // resolved/pass-2 store + events channel)
    const exposed = supervisor.getResolvedStates(p4new.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]!.forkKey).toBe(p4newKey)

    // replay idempotency (G21): re-applying the same op dedups keep-first — one content anchor only
    const res2 = client.apply(p4new.id, {
      kind: 'placement-attach',
      node: p4new.id,
      container: p3.id,
      names: ['zone-3', 'zone-3'],
    })
    expect(res2.status).toBe('applied')
    await flush()
    expect((p4new as unknown as NodeView).anchors.filter((a) => a.role === 'content')).toHaveLength(1)
  })
})

/* ------------------------------------------------------------------ */
/* trigger identity + silent abort (G22, S-P4, P3 §1.2/§3.3)           */
/* ------------------------------------------------------------------ */

describe('ops layer — trigger identity / silent abort (G22, S-P4)', () => {
  /**
   * fixture: root(zone-0); c1a owns zone-1; c2b consumes ['zone-1','zone-2']
   * (chosen zone-1 — the first name with a container); C consumes zone-1.
   * G22/S-P4 re-adjudicated: the trigger's relevance pre-check gates the
   * ATTACH's own dirty nodes — {container, added} (§3.3/E2E-4 ideal set) —
   * NOT the changed link's consumers. The silent abort fires when the dirty
   * CONTAINER node's own chosen name outranks the attach zone; the
   * consumer-fan-out only appears on the consumer's own next compile
   * (the per-path test below drives exactly that).
   */
  async function abortFixture() {
    const h = await setup({
      template: { root: { type: 'app', placement: { placementName: 'zone-0' } } },
      content: [
        {
          content: [
            { type: 'div', props: { id: 'c1a' }, placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] } },
            { type: 'div', props: { id: 'c2b' }, placement: { targetPlacement: ['zone-1', 'zone-2'] } },
            { type: 'button', props: { id: 'C' }, placement: { targetPlacement: ['zone-1'] } },
          ],
        },
      ],
    })
    const byId = new Map(h.t.nodes.map((n) => [n.props.id as string, n]))
    const C = byId.get('C')!
    // bootstrap: c2b's chosen name = zone-1 (first with a container); one state.
    // Per-path exposure reads the supervisor's resolved store (getState is the
    // api.md:151 surface-only read; W2/W3 per-path exposure lives in the
    // resolved/pass-2 store + events channel)
    const c2b = byId.get('c2b')!
    expect(h.supervisor.getResolvedStates(c2b.id)).toHaveLength(1)
    const c1a = byId.get('c1a')!
    expect(h.supervisor.getResolvedStates(c2b.id)![0]!.forkKey).toBe(`root/zone-1/${c1a.id}/${c2b.id}`)
    return { ...h, byId }
  }

  it('an attach that adds a container for a LESS-favored zone ⇒ silent abort: the dirty container node does NOT regenerate', async () => {
    const { supervisor, client, byId, pass2Keys } = await abortFixture()
    const c2b = byId.get('c2b')!
    const c1a = byId.get('c1a')!
    const C = byId.get('C')!

    const x1 = new Node({ type: 'section' })
    supervisor.registerNode(x1 as never)
    const res = client.apply(x1.id, {
      kind: 'placement-attach',
      node: x1.id,
      container: c2b.id,
      names: ['zone-2'],
    })
    expect(res.status).toBe('applied')
    await flush()

    // c2b's zone-2 container anchor was NEWLY minted ⇒ trigger 'container-added' (D4)
    const c2bAnchors = (c2b as unknown as NodeView).anchors.filter((a) => a.role === 'container' && a.target === 'zone-2')
    expect(c2bAnchors).toHaveLength(1)
    // c2b is dirty WITH the trigger: chosen zone-1 > changed zone-2 ⇒ the
    // relevance pre-check aborts its compile — zero regeneration, zero events
    const pass2 = pass2Keys()
    console.log('DBG pass2:', JSON.stringify(pass2))
    expect(pass2.some((k) => k.endsWith(`/zone-1/${c2b.id}`))).toBe(false)
    // c2b's exposure is untouched: still ONE state, same key
    const exposed = supervisor.getResolvedStates(c2b.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]!.forkKey).toBe(`root/zone-1/${c1a.id}/${c2b.id}`)
    // the added node itself compiled its new path-state (zone-2's container
    // c2b has a path to root through its chosen zone-1)
    const x1Exposed = supervisor.getResolvedStates(x1.id)
    expect(x1Exposed).toHaveLength(1)
    expect(x1Exposed[0]!.forkKey).toBe(`root/zone-1/${c1a.id}/zone-2/${c2b.id}/${x1.id}`)
    // C (zone-1 consumer) is NOT in the attach's affected set (§3.3) — untouched
    expect(pass2.some((k) => k.endsWith(`/zone-1/${C.id}`))).toBe(false)
    expect(supervisor.getResolvedStates(C.id)).toHaveLength(1)
  })

  it('an attach that adds a container for the CHOSEN link ⇒ relevant ⇒ the dirty container node regenerates (consumer fan-out needs the consumer\'s own next compile)', async () => {
    const { supervisor, client, byId, pass2Keys } = await abortFixture()
    const c2b = byId.get('c2b')!
    const c1a = byId.get('c1a')!
    const nc1 = byId.get('c2b')!
    const C = byId.get('C')!

    // re-request: c2b becomes a zone-2 consumer with zone-1 still chosen —
    // the attach zone-2 ranks BELOW zone-1, so the change cannot move the
    // choice... for the RELEVANT branch the dirty container's chosen name
    // must EQUAL the attach zone: give c2b a zone-2 consumer slot via attach
    // and then attach zone-1 onto a fresh container node.
    const x2 = new Node({ type: 'section' })
    supervisor.registerNode(x2 as never)
    const res = client.apply(x2.id, {
      kind: 'placement-attach',
      node: x2.id,
      container: nc1.id,
      names: ['zone-1'],
    })
    expect(res.status).toBe('applied')
    await flush()

    // nc1 already consumes zone-1 (chosen); the attach zone-1 EQUALS the
    // chosen name ⇒ relevant ⇒ nc1 regenerates (its own state, unchanged set
    // — its self-container branch is a per-walk loop arm and drops). The
    // added node x2 fans out over BOTH zone-1 containers (c1a, nc1).
    const pass2 = pass2Keys()
    console.log('DBG pass2:', JSON.stringify(pass2))
    expect(pass2).toContain(`root/zone-1/${c1a.id}/${nc1.id}`)
    expect(pass2).toContain(`root/zone-1/${c1a.id}/${x2.id}`)
    expect(pass2).toContain(`root/zone-1/${c1a.id}/zone-1/${nc1.id}/${x2.id}`)
    // C is outside the attach's affected set — its fan-out waits for its own compile
    expect(pass2.some((k) => k.endsWith(`/zone-1/${C.id}`))).toBe(false)
    const exposed = supervisor.getResolvedStates(C.id)
    expect(exposed).toHaveLength(1)
    expect(exposed[0]!.forkKey).toBe(`root/zone-1/${c1a.id}/${C.id}`)
  })
})

/* ------------------------------------------------------------------ */
/* per-path events (W2/W3, Q3, S-P5/S-P6)                              */
/* ------------------------------------------------------------------ */

describe('ops layer — per-path state events for the affected set (W2/W3, S-P5/S-P6)', () => {
  it('a state-slice on a multi-path node regenerates ONLY its path-states; per-path (nodeId, forkKey) exposure, never collapsed per node', async () => {
    const { t, client, supervisor, pass2Keys } = await setup({
      template: { root: { type: 'app', placement: { placementName: 'zone-0' } } },
      content: [
        {
          content: [
            { type: 'div', props: { id: 'c1a' }, placement: { placementName: 'zone-1', targetPlacement: ['zone-0'] } },
            { type: 'div', props: { id: 'nc1' }, placement: { targetPlacement: ['zone-0'] } },
            { type: 'button', props: { id: 'C' }, placement: { targetPlacement: ['zone-1'] } },
          ],
        },
      ],
    })
    const byId = new Map(t.nodes.map((n) => [n.props.id as string, n]))
    const C = byId.get('C')!
    const c1a = byId.get('c1a')!
    const nc1 = byId.get('nc1')!

    // make C a two-path node: attach a second zone-1 container (chosen-link
    // container-added). C is OUTSIDE the attach's affected set (§3.3) — its
    // fan-out materializes on C's OWN next compile (the slice below)
    const x2 = new Node({ type: 'section' })
    supervisor.registerNode(x2 as never)
    client.apply(x2.id, { kind: 'placement-attach', node: x2.id, container: nc1.id, names: ['zone-1'] })
    await flush()
    expect(supervisor.getResolvedStates(C.id)).toHaveLength(1)
    pass2Keys() // drain the attach's own sweep states (nc1/x2) — the slice's drain is C's alone

    // state-slice on C: affected set = C only (node-local invalidation, §3.1)
    const res = client.apply(C.id, [{ targetProp: 'props.blind', mode: 'replace', value: 1 }])
    expect(res.status).toBe('applied')
    await flush()

    // pass-2 keys = C's two pathKeys ONLY — no other node's states regenerate
    // (a state's key ENDS with the node's own id — no zone segment before it)
    const pass2 = pass2Keys()
    const cKeys = pass2.filter((k) => k.endsWith(`/${C.id}`))
    expect(cKeys).toHaveLength(2)
    expect(pass2.length).toBe(2)

    // per-path exposure: two DISTINCT (nodeId, forkKey) states — never collapsed
    // into one (W2/W3 keying; read via the resolved store, §9-Q3 fork payload)
    const exposed = supervisor.getResolvedStates(C.id)
    expect(exposed).toHaveLength(2)
    for (const e of exposed) {
      expect(e.nodeId).toBe(C.id)
      // a path-state's key ends with its own id (no zone segment before it)
      expect(e.forkKey).toMatch(new RegExp(`/${C.id}$`))
      // trace = hop owners root-down + nodeId (P3 §4.2 mintPathState)
      expect(e.trace![e.trace!.length - 1]).toBe(C.id)
    }
    const keySet = new Set(exposed.map((e) => `${e.nodeId}:${e.forkKey}`))
    expect(keySet.size).toBe(2)
    expect(exposed.map((e) => e.forkKey)).toContain(`root/zone-1/${c1a.id}/${C.id}`)
    expect(exposed.map((e) => e.forkKey)).toContain(`root/zone-1/${nc1.id}/${C.id}`)
  })
})

/* ------------------------------------------------------------------ */
/* component-source-duplicate guard (node.ts:413, §10.ae)              */
/* ------------------------------------------------------------------ */

describe('ops layer — component-source-duplicate guard (§10.ab/§10.ae, UNCONDITIONAL)', () => {
  it('a second same-name source anchor on ONE node warns, keeps the first, skips the second', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const n = new Node({ type: 'div' })
      const l1 = new Link({ name: 'component' })
      const l2 = new Link({ name: 'component' })
      const first = n.addAnchor('source', 'ref-a', {}, l1)!
      first.value = 'FIRST'
      const second = n.addAnchor('source', 'ref-a', {}, l2)
      expect(second).toBeNull()
      const sources = (n as unknown as NodeView).anchors.filter((a) => a.role === 'source' && a.target === 'ref-a')
      expect(sources).toHaveLength(1) // keep-first, skip-second
      expect(sources[0]!.value).toBe('FIRST')
      expect(warn.mock.calls.some((c) => c.some((x) => String(x).includes('component-source-duplicate')))).toBe(true)
      // the skipped anchor is absent from its own link too (per-link NO carve-out)
      expect(l2.anchors.some((a) => a.role === 'source' && a.target === 'ref-a')).toBe(false)
      // different-name sources are unaffected
      const l3 = new Link({ name: 'component' })
      n.addAnchor('source', 'ref-b', {}, l3)!
      expect((n as unknown as NodeView).anchors.filter((a) => a.role === 'source')).toHaveLength(2)
    } finally {
      warn.mockRestore()
    }
  })
})

/* ------------------------------------------------------------------ */
/* state-slice placement block + gates (T6/FS-10, T2, api.md §1.2)     */
/* ------------------------------------------------------------------ */

describe('ops layer — state-slice placement block + apply gates', () => {
  it('T6/FS-10: a state-slice targeting placement rejects with placement-target-blocked', async () => {
    const { client, t } = await setup({
      template: { root: { type: 'app', placement: { placementName: 'zone-0' } } },
      content: [{ content: [{ type: 'section', props: { id: 'c' } }] }],
    })
    const c = t.content[0]!
    const res = client.apply(c.id, [{ targetProp: 'placement', mode: 'replace', value: { placementName: 'z' } }])
    expect(res.status).toBe('rejected')
    expect((res as { status: 'rejected'; error: { code: string } }).error.code).toBe('placement-target-blocked')
  })

  it('T2: apply on an unplaced node returns no-usable-state (never partial)', async () => {
    const { supervisor, client } = await setup({
      template: { root: { type: 'app', placement: { placementName: 'zone-0' } } },
      content: [{ content: [{ type: 'section', props: { id: 'c' } }] }],
    })
    const orphan = new Node({ type: 'section' }) // no anchors at all ⇒ 'unplaced'
    supervisor.registerNode(orphan as never) // the op must REACH the node — unregistered ⇒ 'unknown-node'
    const res = client.apply(orphan.id, [{ targetProp: 'props.x', mode: 'replace', value: 1 }])
    expect(res.status).toBe('no-usable-state')
    expect((res as { status: 'no-usable-state'; nodeState: string }).nodeState).toBe('unplaced')
  })

  it('10.ac.2 #1: contentNodes-owned content roots clear the apply gate (E2E-2 prerequisite)', async () => {
    const { client, t } = await setup({
      template: { root: { type: 'app', placement: { placementName: 'zone-0' } } },
      content: [{ content: [{ type: 'section', props: { id: 'c' } }] }],
    })
    const c = t.content[0]!
    const res = client.apply(c.id, [{ targetProp: 'props.blind', mode: 'replace', value: 1 }])
    expect(res.status).toBe('applied')
  })
})
