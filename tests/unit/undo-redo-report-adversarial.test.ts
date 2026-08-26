/**
 * UNDO-REDO-ADVERSARIAL (archive/findings/2026-08-26/2026-08-26-undo-redo-report-
 * adversarial-findings.md — 2026-08-26 stress loop: scenario→probe→review).
 * TDD red set: the 8 genuine defects from the adversarial pass.
 *   UR-2 — keyed-rows undo omits the REUSED id from `scheduledDirtied`.
 *   UR-3 — plain-rows undo omits the creator id from `scheduledDirtied`.
 *   UR-4 — attach-undo reports `applied` with empty `scheduledDirtied`.
 *   UR-6 — redo of a FAILED re-apply reports `applied` + re-pushes the entry.
 *   UR-7 — non-base replay leaves a stale redoStack → redo double-applies.
 *   ISO-1 — the undo consumer walk leaks a cross-graph id into `scheduledDirtied`.
 *   MAL-1..6 — malformed state-slice/layer-apply/attach/destroy/replay ops
 *              throw out of the managed channel (must be CONTAINED rejections).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { Node, Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createLinkHub } from '../../src/core/translate.js'
import { createIsolatedScope, registerDefPrototypes, scopeOf } from '../../src/core/registry.js'
import { makeRoot, familyLink } from '../helpers/fixtures.js'

function flushSweep(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function makeSupervisor(hub?: ReturnType<typeof createLinkHub>) {
  return new Supervisor({ hub: hub ?? createLinkHub(), events: new EventBridge() })
}

describe('UNDO-REDO-ADV-UR2 — keyed-rows undo reports the REUSED id', () => {
  it('a keyed re-mint then undo() → scheduledDirtied includes the reused row id', async () => {
    const h = createLinkHub()
    const sup = makeSupervisor(h)
    const proto = new Node({ type: 'li' }, h, 'proto-row')
    registerDefPrototypes(h.linkFor('item', 'component'), [proto])
    const root = new Node({ type: 'div' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    sup.registerNode(root)
    sup.registerNode(creator)
    const mint = (rows: unknown[]) =>
      sup.apply({ kind: 'rows-mint', target: creator, hookName: 'items', mintKind: 'component', prototypeName: 'item', keyField: 'sku', rows } as never)
    mint([{ sku: 'a', v: 1 }, { sku: 'b', v: 2 }])
    await sup.flush()
    mint([{ sku: 'a', v: 9 }, { sku: 'c', v: 3 }])
    await sup.flush()
    // the reused `a` row id before undo
    const aNode = creator.children.find((c) => c.anchors.find((a) => a.target === 'sku')?.value === 'a')!
    const report = sup.undo()
    expect(report.status).toBe('applied')
    expect(report.scheduledDirtied).toContain(aNode.id)
  })

  it('UR-3 — plain-rows undo → scheduledDirtied includes the creator id', async () => {
    const h = createLinkHub()
    const sup = makeSupervisor(h)
    const proto = new Node({ type: 'li' }, h, 'proto-row3')
    registerDefPrototypes(h.linkFor('row', 'component'), [proto])
    const root = new Node({ type: 'div' }, h, 'root')
    const creator = new Node({ type: 'section' }, h, 'creator')
    sup.registerNode(root)
    sup.registerNode(creator)
    sup.apply({ kind: 'rows-mint', target: creator, hookName: 'rows', mintKind: 'component', prototypeName: 'row', rows: [{ v: 1 }, { v: 2 }] } as never)
    await sup.flush()
    const report = sup.undo()
    expect(report.status).toBe('applied')
    expect(report.scheduledDirtied).toContain(creator.id)
  })

  it('UR4 — attach-undo reports the detached node id in scheduledDirtied', async () => {
    const h = createLinkHub()
    const sup = makeSupervisor(h)
    const root = new Node({ type: 'div' }, h, 'root')
    const child = new Node({ type: 'span' }, h, 'child')
    sup.registerNode(root)
    sup.registerNode(child)
    sup.apply({ kind: 'attach', node: child, to: root } as never)
    await sup.flush()
    const report = sup.undo()
    expect(report.status).toBe('applied')
    expect(report.scheduledDirtied).toContain(child.id)
  })

  it('UR6 — redo of a failed re-apply reports no-op and does not re-push the entry', async () => {
    const sup = makeSupervisor()
    const root = new Node({ type: 'div' }, undefined, 'root')
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.undo()
    // destroy the node so the redo re-apply fails
    root.destroy()
    const report = sup.redo()
    expect(report.status).toBe('no-op')
    expect(sup.undoDepth).toBe(0)
  })

  it('UR7 — replay clears the redoStack so a stale redo does not double-apply', async () => {
    const sup = makeSupervisor()
    const root = new Node({ type: 'div' }, undefined, 'root')
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    sup.undo() // E → redoStack
    sup.replay() // re-applies E; must clear the redoStack
    expect(sup.redoDepth).toBe(0)
    const r = sup.redo()
    expect(r.status).toBe('no-op')
  })

  it('ISO1 — the undo consumer walk does not leak a cross-graph id into scheduledDirtied', async () => {
    const sA = createIsolatedScope()
    const sB = createIsolatedScope()
    const h = createLinkHub()
    const supA = new Supervisor({ hub: h, events: new EventBridge(), graphScope: sA })
    const rootA = new Node({ type: 'app', content: 'A0' }, h, 'rootA', false, sA)
    familyLink(rootA, 'rootNode')
    const consumerB = new Node({ type: 'app', content: 'C0' }, h, 'cB', false, sB)
    familyLink(consumerB, 'rootNode')
    supA.registerNode(rootA)
    supA.registerNode(consumerB)
    const link = h.linkFor('content', 'component')
    rootA.addAnchor('source', 'content', {}, link)
    consumerB.addAnchor('target', 'content', {}, link)
    supA.apply({ kind: 'state-slice', node: rootA, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    await supA.flush()
    const report = supA.undo()
    expect(report.scheduledDirtied).toContain(rootA.id)
    expect(report.scheduledDirtied).not.toContain(consumerB.id)
  })
})

describe('UNDO-REDO-ADV-MAL — malformed ops are CONTAINED rejections (never a throw)', () => {
  it('MAL1 — state-slice with no mutation is a contained rejection', () => {
    const sup = makeSupervisor()
    const root = new Node({ type: 'div' }, undefined, 'root')
    sup.registerNode(root)
    expect(() => sup.apply({ kind: 'state-slice', node: root } as never)).not.toThrow()
    const res = sup.apply({ kind: 'state-slice', node: root } as never)
    expect(res.status).toBe('rejected')
  })

  it('MAL2 — a mutation entry missing targetProp is a contained rejection', () => {
    const sup = makeSupervisor()
    const root = new Node({ type: 'div' }, undefined, 'root')
    sup.registerNode(root)
    expect(() => sup.apply({ kind: 'state-slice', node: root, mutation: [{ mode: 'replace', value: 'A1' }] } as never)).not.toThrow()
    const res = sup.apply({ kind: 'state-slice', node: root, mutation: [{ mode: 'replace', value: 'A1' }] } as never)
    expect(res.status).toBe('rejected')
  })

  it('MAL3 — layer-apply with non-array nodes is a contained rejection', () => {
    const sup = makeSupervisor()
    const root = new Node({ type: 'div' }, undefined, 'root')
    sup.registerNode(root)
    expect(() => sup.apply({ kind: 'layer-apply', target: root, layerId: 'L1', nodes: { a: 1 } } as never)).not.toThrow()
    const res = sup.apply({ kind: 'layer-apply', target: root, layerId: 'L1', nodes: { a: 1 } } as never)
    expect(res.status).toBe('rejected')
  })

  it('MAL4 — attach without to is a contained rejection', () => {
    const sup = makeSupervisor()
    const root = new Node({ type: 'div' }, undefined, 'root')
    sup.registerNode(root)
    expect(() => sup.apply({ kind: 'attach', node: root } as never)).not.toThrow()
    const res = sup.apply({ kind: 'attach', node: root } as never)
    expect(res.status).toBe('rejected')
  })

  it('MAL5 — destroy with a plain-object node is a contained rejection', () => {
    const sup = makeSupervisor()
    expect(() => sup.apply({ kind: 'destroy', node: { id: 'x' } } as never)).not.toThrow()
    const res = sup.apply({ kind: 'destroy', node: { id: 'x' } } as never)
    expect(res.status).toBe('rejected')
  })

  it('MAL6 — replay with a malformed base snapshot is contained (no throw)', () => {
    const sup = makeSupervisor()
    const root = new Node({ type: 'div' }, undefined, 'root')
    sup.registerNode(root)
    sup.apply({ kind: 'state-slice', node: root, mutation: [{ targetProp: 'content', mode: 'replace', value: 'A1' }] })
    // inject a base marker carrying a malformed snapshot (corrupted journal)
    sup.journal.length = 0
    sup.journal.push({ id: 'journal-base', op: { kind: 'base', snapshot: { template: null, content: [] } }, result: { status: 'base' } })
    expect(() => sup.replay()).not.toThrow()
  })
})
