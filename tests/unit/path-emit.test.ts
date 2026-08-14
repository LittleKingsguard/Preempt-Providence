/**
 * Path-state EMIT layer — docs/specs/placement-path-spec.md §4 (render
 * contract) + §6.2 render-helpers row. Unit 7 of the placement-path chain.
 *
 * The compiled path-states (Unit 4/5: compilePath, pathKey identity, forkKey
 * = pathKey, path-derived children, per-path traces) meet the render layer:
 *
 *  1. PathKey wires: a path-state's element wire = its pathKey (identity =
 *     pathKey alone, §2.2). Family/non-path states keep wire = nodeId;
 *     component fork arms (`#f:` keys) keep wire = nodeId#i (§4.2, the
 *     "armWires re-expressed as pure pathKey wires" reading).
 *  2. Per-path childOrder: the parent path-state's childOrder references the
 *     CHILD STATES' pathKey wires (the compiled children are node ids — §2.3
 *     path-derived; the emit converts them per path via the states' traces).
 *     Appends then carry pathKey owners.
 *  3. The `armIdx === undefined` gates (def-retyping, `on:*` attachment,
 *     leaves-by-fiat) re-expressed: a path-state is NEVER an arm — every
 *     path-state of a handler/def-carrying node flows through the def/on:*
 *     branches.
 *  4. The root path-state emits at the conventional root wire `root`.
 *
 * RED first (TDD): these tests fail against the pre-change emit layer
 * (nodeId-grouped arms, armIdx gates skipping path-states, leaves-by-fiat).
 */
import { describe, it, expect } from 'vitest'
import { Node } from '../../src/core/node.js'
import { Link } from '../../src/core/link.js'
import { makeRoot, makeNode, childOf, addComponentSource, targetAnchor } from '../helpers/fixtures.js'
import { translateLegacy } from '../../src/core/translate.js'
import type { LegacyInitialData, LegacyNodeData } from '../../src/core/translate.js'
import {
  emitElements,
  applyOps as applyOpsReal,
  treeFromOps as treeFromOpsReal,
  wireKey,
} from '../../src/core/render-helpers.js'
import { diffMinimal } from '../../src/core/render.js'
import type { MinimalElement, RenderOp } from '../../src/core/render.js'
import type { CompiledState } from '../../src/core/types.js'

/** R2.2 sibling-shared owner-name topology via a legacy envelope (mirrors
 *  path-enum.test.ts): L1 prototypes are template.root.children (family
 *  in-tree, producers) sharing ONE zone name; L2..L(depth−1) are content
 *  payload roots that target the single shared zone name of the level above.
 *  Census: 2^depth − 1 path-states. */
function staticTree(depth: number): {
  root: Node
  nodes: Node[]
  content: Node[]
} {
  const layers = depth - 1
  const children: LegacyNodeData[] = []
  const payload: LegacyNodeData[] = []
  for (let k = 1; k <= layers; k += 1) {
    for (const slot of ['a', 'b'] as const) {
      const node: LegacyNodeData = {
        type: slot === 'a' ? 'div' : 'span',
        props: { 'stress:layer': k, 'stress:slot': slot, label: `${k}${slot}` },
        css: { style: slot === 'a' ? 'color:red' : 'color:blue' },
        placement: {
          placementName: `zone-${k}`,
          ...(k >= 2 ? { targetPlacement: [`zone-${k - 1}`] } : {}),
        },
      }
      if (k === 1) children.push(node)
      else payload.push(node)
    }
  }
  const doc: LegacyInitialData = {
    template: { root: { type: 'app', children } },
    content: [{ content: payload }],
    clientConfig: {},
  }
  const t = translateLegacy(doc)
  return { root: t.root, nodes: t.nodes, content: t.content }
}

function compileAll(tree: { nodes: Node[] }): CompiledState[] {
  const out: CompiledState[] = []
  for (const n of tree.nodes) out.push(...n.compilePath().actionable)
  return out
}

function wiresOf(els: MinimalElement[]): string[] {
  return els.map((e) => e.wire)
}

/** Recursive binary-shape census: every tree node carries exactly
 *  `branch` children except at the leaf depth. */
function countTree(tree: Array<{ wire: string; children: unknown[] }>, depth: number, branch: number, max: number): number {
  if (depth >= max) return 1
  expect(tree).toHaveLength(branch)
  let n = 1
  for (const node of tree) n += countTree(node.children as Array<{ wire: string; children: unknown[] }>, depth + 1, branch, max)
  return n
}

describe('P3 §4 emit — pathKey wires (path-state emit layer)', () => {
  it('P-EMIT-1 two-zone doc: the chosen-name fan-out emits 2 elements with distinct pathKey wires, each with its path-derived childOrder; appends carry pathKey owners; treeFromOps reconstructs the path tree', () => {
    const t = staticTree(4)
    const [p1a, p1b] = t.root.children
    const [p2a] = t.content
    const [p3a, p3b] = t.content.slice(2)
    const els = emitElements(compileAll(t))

    // the two zones of the CHOSEN name each produce an element for p2a
    const p2aEls = els.filter((e) => e.wire.includes(`/${p2a!.id}`) && !e.wire.includes('/zone-2/'))
    expect(p2aEls).toHaveLength(2)
    const viaP1a = p2aEls.find((e) => e.wire === `root/zone-1/${p1a!.id}/${p2a!.id}`)
    const viaP1b = p2aEls.find((e) => e.wire === `root/zone-1/${p1b!.id}/${p2a!.id}`)
    expect(viaP1a).toBeDefined()
    expect(viaP1b).toBeDefined()
    // each element's childOrder = ITS path-derived children, as the child
    // states' pathKey wires (the per-path conversion of the node-id children)
    expect(viaP1a!.childOrder).toEqual([
      `root/zone-1/${p1a!.id}/zone-2/${p2a!.id}/${p3a!.id}`,
      `root/zone-1/${p1a!.id}/zone-2/${p2a!.id}/${p3b!.id}`,
    ])
    expect(viaP1b!.childOrder).toEqual([
      `root/zone-1/${p1b!.id}/zone-2/${p2a!.id}/${p3a!.id}`,
      `root/zone-1/${p1b!.id}/zone-2/${p2a!.id}/${p3b!.id}`,
    ])
    for (const el of els) expect(el.forkKey).toBe(el.wire)

    // append ops carry pathKey owners AND pathKey children
    const ops = diffMinimal(null, els)
    const appends = ops.filter((o): o is Extract<RenderOp, { kind: 'append' }> => o.kind === 'append')
    expect(appends.length).toBeGreaterThan(0)
    for (const op of appends) {
      expect(op.owner.startsWith('root/') || op.owner === 'root').toBe(true)
      expect(op.child.startsWith('root/') || op.child === 'root').toBe(true)
      expect(op.child).not.toContain('#')
    }
    // the parent's per-path appends exist with pathKey owners
    expect(appends.some((o) => o.owner === `root/zone-1/${p1a!.id}/${p2a!.id}`)).toBe(true)
    expect(appends.some((o) => o.owner === `root/zone-1/${p1b!.id}/${p2a!.id}`)).toBe(true)

    // treeFromOps reconstructs the path tree (applyOps round-trips it)
    const trees = treeFromOpsReal(ops)
    expect(trees).toHaveLength(1)
    expect(trees[0]!.wire).toBe('root')
    const byWire = new Map<string, { wire: string; children: Array<{ wire: string }> }>()
    const walk = (n: { wire: string; children: Array<{ wire: string }> }): void => {
      byWire.set(n.wire, n)
      for (const c of n.children) walk(c as { wire: string; children: Array<{ wire: string }> })
    }
    walk(trees[0]!)
    expect(byWire.size).toBe(15)
    const p2aTree = byWire.get(`root/zone-1/${p1a!.id}/${p2a!.id}`)!
    expect(p2aTree.children.map((c) => c.wire)).toEqual([
      `root/zone-1/${p1a!.id}/zone-2/${p2a!.id}/${p3a!.id}`,
      `root/zone-1/${p1a!.id}/zone-2/${p2a!.id}/${p3b!.id}`,
    ])
  })

  it('P-EMIT-2 fork-stress depth-4 probe: 15 elements, path-nested, no #i wires anywhere', () => {
    const t = staticTree(4)
    const els = emitElements(compileAll(t))
    expect(els).toHaveLength(15)
    const wires = wiresOf(els)
    expect(new Set(wires).size).toBe(15)
    for (const w of wires) {
      expect(w === 'root' || w.startsWith('root/')).toBe(true)
      expect(w).not.toContain('#')
    }
    const ops = diffMinimal(null, els)
    const trees = treeFromOpsReal(ops)
    // the binary shape: 1 root → 2 → 2 → 2 → 1 (countTree counts the parent
    // of the given list too — 15 total)
    expect(trees).toHaveLength(1)
    expect(countTree(trees[0]!.children as never, 1, 2, 4)).toBe(15)
    // applyOps reaches every element (bare pathKey wires resolve the
    // (wire, forkKey) composite keys — Unit 2's wireKey-aware findEl)
    const reached = new Set<string>()
    const adapter = {
      wires: new Map<string, { wire: string; type: string }>(),
      createEl(type: string, wire: string, forkKey?: string): { wire: string; type: string } {
        const e = { wire, type }
        this.wires.set(wireKey(wire, forkKey), e)
        reached.add(wire)
        return e
      },
      setProp(): void {},
      appendChild(): void {},
      hydrate(): void {},
      removeEl(): void {},
    }
    applyOpsReal(adapter as never, ops)
    expect(reached.size).toBe(15)
  })

  it('P-EMIT-3 a path-state is NEVER an arm: handler attachment and def-retyping flow through the def/on:* branches (armIdx gates re-expressed)', () => {
    const t = staticTree(3)
    const p2a = t.content[0]!
    const nodeById = new Map([[p2a.id, { handlers: [{ event: 'click', name: 'cb' }] }]])
    const states = compileAll(t)
    const p2aKeys = new Set(states.filter((s) => s.nodeId === p2a.id).map((s) => s.pathKey))
    expect(p2aKeys.size).toBe(2)
    const els = emitElements(states, nodeById)
    const p2aEls = els.filter((e) => p2aKeys.has(e.wire))
    expect(p2aEls).toHaveLength(2)
    // the handler branch must attach on:* for BOTH path-states of p2a — under
    // the pre-re-expression emit both were armIdx'd (multi group) and skipped
    for (const el of p2aEls) {
      expect(el.props['on:click']).toBe(true)
      expect(el.wire.startsWith('root/')).toBe(true)
    }

    // def-retyping on a path-state: two same-node path-states carrying a def
    // binding re-type (the old multi-group armIdx gate skipped the def branch)
    const defVal = { type: 'div', label: 'lk', childOffset: 0, children: [{ bind: 'x', type: 'span', content: 'd' }] }
    const defStates: Array<{
      nodeId: string
      pathKey: string
      forkKey: string
      trace: string[]
      type: string
      bindings: Record<string, unknown>
    }> = [
      { nodeId: 'C', pathKey: 'root/slot-a/A/C', forkKey: 'root/slot-a/A/C', trace: ['node-0', 'A', 'C'], type: 'span', bindings: { 'link-1': defVal } },
      { nodeId: 'C', pathKey: 'root/slot-a/B/C', forkKey: 'root/slot-a/B/C', trace: ['node-0', 'B', 'C'], type: 'span', bindings: { 'link-1': defVal } },
    ]
    const defEls = emitElements(defStates)
    // the def-typed consumer elements (the def's re-typed children join the
    // set separately — the def-children protocol)
    const consumers = defEls.filter((e) => e.type === 'div')
    expect(consumers).toHaveLength(2)
    for (const el of consumers) {
      expect(el.wire.startsWith('root/')).toBe(true)
      // re-typed by the def (def.type), not the authored span type
      expect(el.type).toBe('div')
      expect(el.forkKey).toBe(el.wire)
      expect(el.childOrder).toEqual([`${el.wire}:x`])
    }
  })

  it('P-EMIT-4 family states unchanged: wire = nodeId; component fork arms keep the nodeId#i scheme', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf', content: 'L' }), 0)
    const res = root.compile([root, leaf])
    const els = emitElements(res.actionable)
    const leafEl = els.find((e) => e.wire === leaf.id)!
    expect(leafEl).toBeDefined()
    expect('forkKey' in leafEl).toBe(false)
    expect(leafEl.childOrder).toEqual([])

    // a same-name component fork still emits nodeId#i arms with #f: forkKeys —
    // built from TWO PROVIDER NODES under the consumer (the legitimate
    // multiplicity, §10.ab #4; same-node duplicates are the guarded anti-pattern)
    const forked = childOf(root, makeNode({ type: 'div', content: 'F' }), 1)
    targetAnchor(forked, 'slot')
    const pV = childOf(forked, makeNode({ type: 'pV' }), 0)
    const pW = childOf(forked, makeNode({ type: 'pW' }), 1)
    addComponentSource(pV, 'slot', 'v')
    addComponentSource(pW, 'slot', 'w')
    const forkRes = root.compile([root, leaf, forked, pV, pW])
    const forkEls = emitElements(forkRes.actionable)
    const armEls = forkEls.filter((e) => e.wire.startsWith(`${forked.id}#`))
    expect(armEls).toHaveLength(2)
    for (const [i, el] of armEls.entries()) {
      expect(el.wire).toBe(`${forked.id}#${i}`)
      expect(el.forkKey).toContain('#f:')
      expect(el.forkKey).not.toBe(el.wire)
    }
  })

  it('P-EMIT-5 the root path-state emits at the conventional root wire `root`', () => {
    const t = staticTree(3)
    const els = emitElements(compileAll(t))
    const rootEl = els.find((e) => e.wire === 'root')!
    expect(rootEl).toBeDefined()
    expect(rootEl.type).toBe('app')
    expect(rootEl.forkKey).toBe('root')
    // the root's children attach under the root wire
    const ops = diffMinimal(null, els)
    const trees = treeFromOpsReal(ops)
    expect(trees).toHaveLength(1)
    expect(trees[0]!.wire).toBe('root')
    expect(trees[0]!.children).toHaveLength(2)
  })

  it('P-EMIT-6 diffMinimal reuse: same pathKey across a recompile ⇒ same wire ⇒ prevMap reuse (no re-create); a shallow props change is set-only on the path-states', () => {
    const t = staticTree(3)
    const p2a = t.content[0]!
    const p2aKeys = new Set(compileAll(t).filter((s) => s.nodeId === p2a.id).map((s) => s.pathKey))
    const els1 = emitElements(compileAll(t))
    expect(diffMinimal(null, els1).filter((o) => o.kind === 'create')).toHaveLength(7)

    // identical recompile → identical wires → ZERO ops (full reuse)
    const prevMap = new Map(els1.map((e) => [e.wire, e]))
    const els2 = emitElements(compileAll(t))
    expect(wiresOf(els2)).toEqual(wiresOf(els1))
    const ops2 = diffMinimal(prevMap, els2)
    expect(ops2.filter((o) => o.kind === 'create' || o.kind === 'remove')).toEqual([])

    // a shallow props mutation on p2a regenerates its path-states only — same
    // pathKey wires (element objects reused), set-only ops
    p2a.applySlice([{ targetProp: 'props.label', mode: 'replace', value: 'updated' }])
    const els3 = emitElements(compileAll(t))
    expect(wiresOf(els3)).toEqual(wiresOf(els1))
    const ops3 = diffMinimal(prevMap, els3)
    expect(ops3.filter((o) => o.kind === 'create' || o.kind === 'remove')).toEqual([])
    const sets = ops3.filter((o): o is Extract<RenderOp, { kind: 'set' }> => o.kind === 'set')
    expect(sets.length).toBeGreaterThan(0)
    const setWires = new Set(sets.map((o) => o.wire))
    expect(setWires.size).toBe(2)
    for (const w of setWires) expect(p2aKeys.has(w)).toBe(true)
  })

  it('P-EMIT-7 a mixed node (family state + path states) emits both kinds without wire collisions', () => {
    const root = makeRoot({ type: 'root' })
    const A = childOf(root, makeNode({ type: 'div' }, 'A'))
    const X = childOf(root, makeNode({ type: 'button', content: 'x' }, 'X'))
    const slot = new Link({ name: 'placement' })
    A.addAnchor('container', 'slot-a', {}, slot)
    X.addAnchor('content', 'slot-a', {}, slot)

    // X compiled the family way (focused slice) AND the path way
    const family = root.compile([root, X]).actionable.filter((s) => s.nodeId === X.id)
    expect(family).toHaveLength(1)
    expect(family[0]!.forkKey).toBeUndefined()
    const paths = X.compilePath().actionable
    expect(paths).toHaveLength(2)

    const els = emitElements([...family, ...paths])
    expect(els).toHaveLength(3)
    const wires = wiresOf(els)
    expect(new Set(wires).size).toBe(3)
    expect(wires).toContain(X.id)
    expect(wires).toContain('root/X')
    expect(wires).toContain('root/slot-a/A/X')
    const familyEl = els.find((e) => e.wire === X.id)!
    expect('forkKey' in familyEl).toBe(false)
    const pathEls = els.filter((e) => e.wire.startsWith('root/'))
    for (const el of pathEls) expect(el.forkKey).toBe(el.wire)
  })
})
