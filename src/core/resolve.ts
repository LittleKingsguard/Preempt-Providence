// src/core/resolve.ts — pass-2 fork/borrow resolution (notes §10.8.2, §10.8.4).
//
// Pure functions over the Node public surface: for a node's target
// referenceNames, find candidate providers (self → descendants → ancestors →
// non-viable fallback) and fork into per-path `ArmState`s. Imports Node and
// ChainKind only as TYPES (erased at runtime), so there is no import cycle
// with node.ts; the depth cap comes from the leaf constants module.
import type { Node } from './node.js'
import type { ChainKind } from './node.js'
import { MAX_COMPILE_DEPTH } from './constants.js'
import type { Anchor, NodeId } from './types.js'

export interface ProviderHit {
  anchor: Anchor
  owner: Node
}

export interface ArmState {
  bindings: Record<string, unknown>
  unresolved: { referenceName: string; code: 'unresolved-reference' }[]
  keys: string[]
  trace: string[]
  drop?: { reason: 'prototype-terminated' | 'owner-terminated' | 'loop' }
}

export type FitResult =
  | { kind: 'none' }
  | { kind: 'term'; reason: 'prototype-terminated' | 'owner-terminated' }
  | { kind: 'hits'; hits: ProviderHit[]; referenceName: string }

function providersOn(owner: Node, name: string): ProviderHit[] {
  const out: ProviderHit[] = []
  for (const a of owner.anchors) {
    if (typeof a.target !== 'string') continue
    if ((a.role === 'source' || a.role === 'duplex') && a.target === name) {
      out.push({ anchor: a, owner })
    }
  }
  return out
}

function fitReference(node: Node, name: string, slice: Node[], viable: ReadonlySet<NodeId>, kinds: ReadonlyMap<NodeId, ChainKind>): FitResult {
  const fit = (hits: ProviderHit[]): FitResult =>
    hits.length === 0
      ? { kind: 'none' }
      : { kind: 'hits', hits, referenceName: name }

  const own = providersOn(node, name)
  if (own.length > 0) return fit(own)

  const descendants: ProviderHit[] = []
  const stack: Node[] = [...node.children]
  while (stack.length > 0) {
    const d = stack.pop()!
    if (viable.has(d.id)) descendants.push(...providersOn(d, name))
    stack.push(...d.children)
  }
  if (descendants.length > 0) return fit(descendants)

  for (let cur: Node | null = node.parent; cur; cur = cur.parent) {
    if (!viable.has(cur.id)) continue
    const up = providersOn(cur, name)
    if (up.length > 0) return fit(up)
  }

  const fallback: ProviderHit[] = []
  for (const s of slice) {
    if (viable.has(s.id)) continue
    for (const p of providersOn(s, name)) fallback.push(p)
  }
  if (fallback.length > 0) {
    const first = fallback[0]
    const reason = first && kindDropReason(kinds.get(first.owner.id))
    return reason ? { kind: 'term', reason } : { kind: 'none' }
  }
  return { kind: 'none' }
}

export function kindDropReason(kind: ChainKind | undefined): 'prototype-terminated' | 'owner-terminated' | undefined {
  if (!kind) return 'owner-terminated'
  if (kind.kind === 'token' && kind.token === 'component') return 'prototype-terminated'
  return 'owner-terminated'
}

export function resolveArms(target: Node, names: string[], slice: Node[], viable: ReadonlySet<NodeId>, kinds: ReadonlyMap<NodeId, ChainKind>): ArmState[] {
  const leaf: ArmState = { bindings: {}, unresolved: [], keys: [], trace: [] }
  return resolveNames(target, names, leaf, slice, viable, kinds, new Set<NodeId>(), 0)
}

function resolveNames(
  node: Node,
  names: string[],
  partial: ArmState,
  slice: Node[],
  viable: ReadonlySet<NodeId>,
  kinds: ReadonlyMap<NodeId, ChainKind>,
  path: Set<NodeId>,
  depth: number,
): ArmState[] {
  if (depth > MAX_COMPILE_DEPTH || path.has(node.id)) {
    return [{ ...partial, keys: [...partial.keys], trace: [...partial.trace], drop: { reason: 'loop' } }]
  }
  path.add(node.id)
  let arms: ArmState[] = [{ ...partial, trace: [...partial.trace] }]
  for (const name of names) {
    const fit = fitReference(node, name, slice, viable, kinds)
    const next: ArmState[] = []
    for (const arm of arms) {
      for (const branch of continueArm(node, name, fit, arm, slice, viable, kinds, path, depth)) {
        next.push(branch)
      }
    }
    arms = next
  }
  path.delete(node.id)
  return arms
}

function continueArm(
  node: Node,
  name: string,
  fit: FitResult,
  arm: ArmState,
  slice: Node[],
  viable: ReadonlySet<NodeId>,
  kinds: ReadonlyMap<NodeId, ChainKind>,
  path: Set<NodeId>,
  depth: number,
): ArmState[] {
  if (arm.drop) return [arm]
  if (fit.kind === 'none') {
    arm.unresolved.push({ referenceName: name, code: 'unresolved-reference' })
    return [{ ...arm, keys: [...arm.keys], trace: [...arm.trace] }]
  }
  if (fit.kind === 'term') {
    return [{ ...arm, keys: [...arm.keys], trace: [...arm.trace], drop: { reason: fit.reason } }]
  }
  const outs: ArmState[] = []
  const hits = fit.hits
  const stepped =
    hits.length === 1
      ? [
          {
            arm: arm,
            value: hits[0]!.anchor.value,
            owner: hits[0]!.owner,
            key: '',
          },
        ]
      : hits.map((h, i) => ({
          arm: { ...arm, bindings: { ...arm.bindings }, unresolved: [...arm.unresolved], keys: [...arm.keys], trace: [...arm.trace] },
          value: h.anchor.value,
          owner: h.owner,
          key: `#f:${h.owner.id}#${i}`,
        }))
  for (const step of stepped) {
    step.arm.bindings[name] = step.value
    const keyed = step.key !== '' ? [...step.arm.keys, step.key] : step.arm.keys
    const traced = step.owner !== node ? [...step.arm.trace, step.owner.id] : step.arm.trace
    if (step.owner !== node) {
      const ownerNames = step.owner.anchors
        .filter(a => a.role === 'target' && typeof a.target === 'string')
        .map(a => a.target as string)
      if (ownerNames.length > 0) {
        const sub = resolveNames(step.owner, ownerNames, { ...step.arm, keys: keyed, trace: traced }, slice, viable, kinds, path, depth + 1)
        outs.push(...sub)
        continue
      }
    }
    outs.push({ ...step.arm, keys: keyed, trace: traced })
  }
  return outs
}
