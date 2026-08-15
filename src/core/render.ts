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
 *       `childOrder` whose wire is present in `next`, emit `append(owner, child)`
 *       ONLY when the child order changed (vs the previous render's `childOrder`,
 *       D5) or the child was created/re-created this pass — this doubles as D1's
 *       append and D5's re-append in compiled order. Re-appending an UNCHANGED
 *       order is deliberately skipped: in a real DOM, `appendChild` on an
 *       already-attached element detaches + re-inserts it, which would blur a
 *       focused form element (e.g. a markdown editor) on every keystroke.
 *    `styles` ops are never synthesized by the tree diff; the sweep coalescer
 *    owns them (R-ORD-6) and coalesces to one per batch.
 *
 *   MinimalElement.props use the namespaced `set` names verbatim
 *   (`prop:*`, `css:*`, `text`, `on:<event>`), kept by the compiled-state reducer
 *   `minimalFromState` below.
 */

export type ForkPathKey = string

export type RenderOp =
  | { kind: 'create'; wire: NodeRef; type: string; forkKey?: ForkPathKey }
  | { kind: 'set'; wire: NodeRef; name: string; value: unknown; forkKey?: ForkPathKey }
  | { kind: 'append'; owner: NodeRef; child: NodeRef }
  | { kind: 'remove'; wire: NodeRef; forkKey?: ForkPathKey }
  | { kind: 'styles'; cssDefs: unknown[] }

export interface MinimalElement {
  wire: NodeRef
  type: string
  props: Record<string, unknown>
  childOrder: NodeRef[]
  forkKey?: ForkPathKey
  /** D4/STL-1 — the element's css.cssDef serialized to RULE STRINGS
   *  `{selector}{kebab-case k: v; styles}` (media-query nesting serialized
   *  recursively as nested blocks). Carried on the element so the diff's
   *  sweep coalescer can dedup across the whole sweep and emit at most one
   *  `styles` op (STL-2/STL-4, R-ORD-6). */
  styles?: string[]
}

export function diffMinimal(prev: Map<NodeRef, MinimalElement> | null, next: MinimalElement[]): RenderOp[] {
  const ops: RenderOp[] = []
  const created = new Set<NodeRef>()
  const present = new Set(next.map((el) => el.wire))
  if (prev) {
    for (const [wire, el] of prev) {
      if (!present.has(wire)) {
        ops.push({ kind: 'remove', wire, ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
      }
    }
  }
  for (const el of next) {
    const before = prev ? prev.get(el.wire) : undefined
    if (!before) {
      created.add(el.wire)
      ops.push({ kind: 'create', wire: el.wire, type: el.type, ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
      for (const [name, value] of Object.entries(el.props)) {
        ops.push({ kind: 'set', wire: el.wire, name, value, ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
      }
    } else if (before.type !== el.type) {
      created.add(el.wire)
      ops.push({ kind: 'remove', wire: el.wire, ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
      ops.push({ kind: 'create', wire: el.wire, type: el.type, ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
      for (const [name, value] of Object.entries(el.props)) {
        ops.push({ kind: 'set', wire: el.wire, name, value, ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
      }
    } else {
      const hasPrev = new Set(Object.keys(before.props))
      const hasNext = new Set(Object.keys(el.props))
      for (const name of hasNext) {
        if (!hasPrev.has(name) || before.props[name] !== el.props[name]) {
          ops.push({ kind: 'set', wire: el.wire, name, value: el.props[name], ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
        }
      }
      for (const name of hasPrev) {
        if (!hasNext.has(name)) {
          ops.push({ kind: 'set', wire: el.wire, name, value: undefined, ...(el.forkKey !== undefined ? { forkKey: el.forkKey } : {}) })
        }
      }
    }
  }
  // order signatures are computed ONCE per map (not per element) — the
  // structure pass below compares them per wire (D5 re-append guard, ORD-H6).
  const orderSig = (els: Map<NodeRef, MinimalElement>): Map<NodeRef, string> => {
    const out = new Map<NodeRef, string>()
    for (const [wire, el] of els) {
      out.set(wire, (el.childOrder ?? []).filter((c) => present.has(c)).join('\u0000'))
    }
    return out
  }
  const prevOrder = prev ? orderSig(prev) : null
  const nextOrder = orderSig(new Map(next.map((e) => [e.wire, e])))
  for (const el of next) {
    // D5 "re-append in compiled order" only needs to fire when the child
    // ORDER actually changed (or a child is new / re-created this pass).
    // Re-appending an unchanged order would, in a real DOM, detach + re-insert
    // every already-attached child — which blurs a focused element (e.g. the
    // markdown editor) on every keystroke.
    const orderChanged = !prev || prevOrder!.get(el.wire) !== nextOrder.get(el.wire)
    for (const child of el.childOrder) {
      if (!present.has(child)) continue
      if (orderChanged || created.has(child)) ops.push({ kind: 'append', owner: el.wire, child })
    }
  }
  // D4/STL-2/STL-4 (R-ORD-6) — the sweep coalescer: at most ONE `styles` op
  // per sweep, its payload the deduped RULE STRINGS in first-seen order over
  // the actionable node set. A cssDef-less sweep emits NO styles op (F11 —
  // no empty `<style>` block, no empty styles prefix at the adapters).
  const rules: string[] = []
  const seen = new Set<string>()
  for (const el of next) {
    for (const rule of el.styles ?? []) {
      if (!seen.has(rule)) {
        seen.add(rule)
        rules.push(rule)
      }
    }
  }
  if (rules.length > 0) ops.push({ kind: 'styles', cssDefs: rules })
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