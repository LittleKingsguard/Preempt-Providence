import type { NodeRef } from './types.js'

/**
 * Declared contract pinned by these tests for the Renderer (src/core/render.ts,
 * src/core/serialize.ts). The implementation does not exist yet (TDD red state).
 * Tests follow render.md §10.1–§10.5 and contract.md. Where the notes leave seam
 * latitude, the intended deterministic behavior is recorded here:
 *
 *  diffMinimal(prev, next), in order:
 *    1. `remove` for every prev wire absent from `next` (D2; D5 "departed").
 *    2. per element in `next` array order:
 *        - new wire             -> `create` + one `set` per prop, object order (D1);
 *        - type changed         -> `remove` + `create` + `set`* (D3, no morphing);
 *        - otherwise            -> `set` only for prop names whose value changed
 *                                  versus prev (D4, removed props re-`set`,
 *                                  added props `set`, unchanged names silent).
 *    3. structure pass: for each element in `next` order, for each child in its
 *       `childOrder` whose wire is present in `next`, emit `append(owner, child)` —
 *       this doubles as D1's append and D5's re-append in compiled order.
 *    `styles` ops are never synthesized by the tree diff; the sweep coalescer
 *    owns them (R-ORD-6) and coalesces to one per batch.
 *
 *   MinimalElement.props use the namespaced `set` names verbatim
 *   (`prop:*`, `css:*`, `text`, `on:<event>`), kept by the compiled-state reducer
 *   `minimalFromState` below.
 */

export type RenderOp =
  | { kind: 'create'; wire: NodeRef; type: string }
  | { kind: 'set'; wire: NodeRef; name: string; value: unknown }
  | { kind: 'append'; owner: NodeRef; child: NodeRef }
  | { kind: 'remove'; wire: NodeRef }
  | { kind: 'styles'; cssDefs: unknown[] }

export interface MinimalElement {
  wire: NodeRef
  type: string
  props: Record<string, unknown>
  childOrder: NodeRef[]
}

export function diffMinimal(prev: Map<NodeRef, MinimalElement> | null, next: MinimalElement[]): RenderOp[] {
  const ops: RenderOp[] = []
  if (prev) {
    for (const [wire] of prev) {
      if (!next.some((el) => el.wire === wire)) ops.push({ kind: 'remove', wire })
    }
  }
  for (const el of next) {
    const before = prev ? prev.get(el.wire) : undefined
    if (!before) {
      ops.push({ kind: 'create', wire: el.wire, type: el.type })
      for (const [name, value] of Object.entries(el.props)) ops.push({ kind: 'set', wire: el.wire, name, value })
    } else if (before.type !== el.type) {
      ops.push({ kind: 'remove', wire: el.wire })
      ops.push({ kind: 'create', wire: el.wire, type: el.type })
      for (const [name, value] of Object.entries(el.props)) ops.push({ kind: 'set', wire: el.wire, name, value })
    } else {
      const hasPrev = new Set(Object.keys(before.props))
      const hasNext = new Set(Object.keys(el.props))
      for (const name of hasNext) {
        if (!hasPrev.has(name) || before.props[name] !== el.props[name]) {
          ops.push({ kind: 'set', wire: el.wire, name, value: el.props[name] })
        }
      }
      for (const name of hasPrev) {
        if (!hasNext.has(name)) ops.push({ kind: 'set', wire: el.wire, name, value: undefined })
      }
    }
  }
  const present = new Set(next.map((el) => el.wire))
  for (const el of next) {
    for (const child of el.childOrder) {
      if (present.has(child)) ops.push({ kind: 'append', owner: el.wire, child })
    }
  }
  return ops
}

export interface RenderAdapter<P = unknown, E = unknown> {
  createEl(type: string, wire: NodeRef): P
  setProp(wire: NodeRef, name: string, val: unknown): void
  appendChild(owner: P, child: P): void
  hydrate(rootWire: NodeRef, vdom: unknown): void
  removeEl?(wire: NodeRef): void
}

export class MockAdapter implements RenderAdapter<{ wire: string; type: string }> {
  readonly calls: RenderOp[] = []
  createEl(type: string, wire: NodeRef): { wire: string; type: string } {
    this.calls.push({ kind: 'create', wire, type })
    return { wire, type }
  }
  setProp(wire: NodeRef, name: string, val: unknown): void {
    this.calls.push({ kind: 'set', wire, name, value: val })
  }
  appendChild(owner: { wire: string; type: string }, child: { wire: string; type: string }): void {
    this.calls.push({ kind: 'append', owner: owner.wire, child: child.wire })
  }
  hydrate(_rootWire: NodeRef, _vdom: unknown): void {}
  removeEl(wire: NodeRef): void {
    this.calls.push({ kind: 'remove', wire })
  }
}