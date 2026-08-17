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
import type { Anchor, CompiledState, Link, NodeId, UnresolvedRef } from './types.js'

export interface ProviderHit {
  anchor: Anchor
  owner: Node
}

/** HOOKS (hooks-map-review.md §7.2 pin 2) — the single value read for a
 *  provider anchor: the node-local `hook-<name>` layer value FIRST, the
 *  authored `anchor.value` fallback (the cleared-hook fallback — clearing
 *  the hook layer restores the authored value). Consulted at the five
 *  pinned anchor-value read sites (resolve.ts:307/314, resolve.ts:189,
 *  node.ts seedOwnBindings, node.ts materializeSeam, render-helpers.ts
 *  emit-time def-fill). */
export function providerValueFor(owner: Node, anchor: Anchor, name: string): unknown {
  const hook = owner.layers.find((l) => l.id === `hook-${name}`)
  if (hook !== undefined && hook.value !== undefined) return hook.value
  return anchor.value
}

/** HOOKS — the seam/def-fill source read (materializeSeam + the emit-time
 *  def-fill): walk a component Link's source/duplex provider anchors through
 *  `providerValueFor` (the mirror design — serialize/loadState/nodeToLegacy
 *  ship ONE value via the anchor; the hook layer rides the read for the
 *  live tree). Preserves the pre-hook behavior for non-string targets. */
export function providerValueFromLink(link: Link): unknown {
  for (const a of link.anchorsOf('source')) {
    if (a.owner === undefined) continue
    const v = typeof a.target === 'string' ? providerValueFor(a.owner, a, a.target) : a.value
    if (v !== undefined) return v
  }
  for (const a of link.anchorsOf('duplex')) {
    if (a.owner === undefined) continue
    const v = typeof a.target === 'string' ? providerValueFor(a.owner, a, a.target) : a.value
    if (v !== undefined) return v
  }
  return undefined
}

/** HOOKS — the node-local hook name resolution: the source/duplex anchor
 *  whose target matches the hook name (a hook names a SAME-NODE
 *  value-provider component binding). */
export function hookAnchorFor(node: Node, name: string): Anchor | undefined {
  return node.anchors.find(
    (a) => (a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string' && a.target === name,
  )
}

/** HOOKS (§7.2 pin 5) — the DEF-SHAPED value discrimination (the
 *  seam/def landmine guard): a provider value that the seam/def machinery
 *  reads as a def — mintDefPrototypes' `type`-bearing node data, the
 *  materializeSeam `content`-carrying object, and the handler-def
 *  `{name, body}` shape. Hooking such a value would tear down the seam. */
export function isDefShapedValue(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return typeof o.type === 'string'
    || o.content !== undefined
    || (typeof o.name === 'string' && typeof o.body === 'string')
}

/** HOOKS (§7.2 pins 1/5) — the write-side gate, shared by the supervisor's
 *  state-slice pre-check (rejection) and node.applySlice's defensive branch
 *  (warn + skip, never throw): no source/duplex anchor ⇒ `hook-name-unresolved`;
 *  a seam/def-shaped provider ⇒ `hook-seam-exempt` (warn + no-op — the
 *  landmine guard). */
export function hookWriteGuard(
  node: Node,
  name: string,
): { ok: true; anchor: Anchor } | { ok: false; code: 'hook-name-unresolved' | 'hook-seam-exempt' } {
  const anchor = hookAnchorFor(node, name)
  if (!anchor) return { ok: false, code: 'hook-name-unresolved' }
  if (anchor.options.seam !== undefined || isDefShapedValue(anchor.value)) {
    return { ok: false, code: 'hook-seam-exempt' }
  }
  return { ok: true, anchor }
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

/** Token chain-kind for a string parent target (mirrors compile's
 *  chainTokenKind — kept local to avoid a node.ts import cycle). */
function chainTokenKind(target: string): ChainKind {
  if (target === 'rootNode') return { kind: 'token', token: 'rootNode' }
  if (target === 'component') return { kind: 'token', token: 'component' }
  if (target === 'contentNodes') return { kind: 'token', token: 'contentNodes' }
  return { kind: 'token', token: 'other' }
}

/** On-demand chain classification of an OUT-OF-SLICE node, mirroring the
 *  compile's chainRoot termination rules (string token → its kind; childless
 *  / absent parent anchor → unplaced; destroyed owner → destroyed-owner;
 *  revisit → loop). Only needs the FAMILY side — no slice, no memo. */
function chainKindOf(owner: Node): ChainKind | undefined {
  const seen = new Set<NodeId>()
  let cur: Node | null = owner
  while (cur !== null && !seen.has(cur.id)) {
    seen.add(cur.id)
    const child = cur.childAnchor()
    if (!child) return { kind: 'unplaced' }
    const parentAnchor = child.link.anchorsOf('parent')[0]
    if (!parentAnchor) return { kind: 'unplaced' }
    const target = parentAnchor.target
    if (typeof target === 'string') return chainTokenKind(target)
    if (target === null) return { kind: 'unplaced' }
    const ownerNode = target as Node
    if (ownerNode.destroyed) return { kind: 'destroyed-owner' }
    cur = ownerNode
  }
  return { kind: 'loop' }
}

/** Whether an owner can itself RESOLVE (mirrors compile's `viable` rules):
 *  in-tree (token rootNode) or an unplaced SELF-provider (S-R2.6). Only
 *  NON-viable providers terminate a consumer's arm. */
function isViable(kind: ChainKind | undefined, owner: Node): boolean {
  if (!kind) return false
  if (kind.kind === 'token' && kind.token === 'rootNode') return true
  if (kind.kind === 'token') return false // component / contentNodes / other
  if (kind.kind === 'unplaced') {
    return owner.anchors.some(a => (a.role === 'source' || a.role === 'duplex') && typeof a.target === 'string')
  }
  return false // loop / destroyed-owner
}

/**
 * Arm-termination fallback: does a NON-viable provider for `name` exist?
 *
 * The per-name component Link IS the registry of nodes relevant for the
 * target (anchors carry their owner backref) — a shared-hub tree answers
 * here directly, with NO full-graph sweep: the compile slice never needs
 * the provider universe. Hub-less trees (same-name anchors on private
 * links) fall back to the status-quo slice scan.
 */
function fallbackTermination(
  node: Node,
  name: string,
  slice: Node[],
  viable: ReadonlySet<NodeId>,
  kinds: ReadonlyMap<NodeId, ChainKind>,
): FitResult {
  const hub = node.hubFor
  if (hub) {
    const link = hub.linkFor(name, 'component')
    const providers: ProviderHit[] = []
    for (const a of link.anchors) {
      if (a.role !== 'source' && a.role !== 'duplex') continue
      if (typeof a.target !== 'string' || a.target !== name) continue
      const owner = a.owner
      if (!owner) continue
      const kind = chainKindOf(owner)
      if (isViable(kind, owner)) continue
      providers.push({ anchor: a, owner })
    }
    if (providers.length > 0) {
      const reason = kindDropReason(chainKindOf(providers[0]!.owner))
      return reason ? { kind: 'term', reason } : { kind: 'none' }
    }
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

  return fallbackTermination(node, name, slice, viable, kinds)
}

export function kindDropReason(kind: ChainKind | undefined): 'prototype-terminated' | 'owner-terminated' | undefined {
  if (!kind) return 'owner-terminated'
  if (kind.kind === 'token' && kind.token === 'component') return 'prototype-terminated'
  return 'owner-terminated'
}

/**
 * P3 §2.5/Q8 — per-path component-target resolution for a path-state. The
 * state's OWN node is resolved first (depth-0), then ITS PATH's ancestors —
 * the walk hop owners, nearest first — with NEAREST-WINS: at most one hit per
 * name per path. The graph node's family chain beyond the path is NEVER
 * consulted (path-only — a multi-path prototype's family anchors lead to a
 * DIFFERENT parent than the path being compiled; identical ancestor trees ⇒
 * identical bindings, which is why identity = pathKey alone, §2.2). Names
 * with no provider on the path record an unresolved-reference entry. In-place
 * on the state's `bindings`/`unresolved`; own published values seed later
 * (seedOwnBindings, skip-if-present).
 */
export function resolvePathTargets(
  node: Node,
  pathAncestors: Node[],
  bindings: Record<string, unknown>,
  unresolved: UnresolvedRef[],
): void {
  for (const a of node.anchors) {
    if (a.role !== 'target' || typeof a.target !== 'string') continue
    if (bindings[a.target] !== undefined) continue
    const hit = nearestPathProvider(node, pathAncestors, a.target)
    if (hit) bindings[a.target] = hit.anchor.value
    else unresolved.push({ referenceName: a.target, code: 'unresolved-reference' })
  }
}

function nearestPathProvider(node: Node, pathAncestors: Node[], name: string): ProviderHit | undefined {
  const own = providersOn(node, name)
  if (own.length > 0) return own[0]!
  for (const anc of pathAncestors) {
    const hit = providersOn(anc, name)
    if (hit.length > 0) return hit[0]!
  }
  return undefined
}

/**
 * P3 §1.2 (C-2) — the relevance pre-check for the silent abort: given a
 * placement-routed node, its CURRENT chosen name (the first-match result;
 * null = no satisfied request), and the name of the placement link an update
 * trigger names — can the changed link alter the node's first-match choice?
 *
 * Irrelevant (⇒ abort: no state regeneration, no events) exactly when the
 * changed link is NOT the chosen name AND ranks BELOW it in the node's
 * ordered request list (a change there cannot move the choice, and no
 * higher-rank link changed — the trigger names one link). Everything else is
 * conservatively RELEVANT: the chosen link itself (the instance set can
 * change), a higher-ranked link (a container can appear above the choice),
 * a link the node never requests, a stale/missing choice, and
 * non-placement-routed nodes.
 *
 * Unit 6 passes the trigger identity through `supervisor.apply` and gates
 * `node.compilePath` on this predicate; this unit is the pure decision.
 */
export function placementChangeIrrelevant(node: Node, chosenName: string | null, changedLinkName: string): boolean {
  if (chosenName === null) return false
  if (changedLinkName === chosenName) return false
  const names: string[] = []
  for (const a of node.anchors) {
    if (a.role !== 'content' || typeof a.target !== 'string') continue
    names.push(a.target)
  }
  const chosenIdx = names.indexOf(chosenName)
  if (chosenIdx === -1) return false
  const changedIdx = names.indexOf(changedLinkName)
  return changedIdx !== -1 && changedIdx > chosenIdx
}

/** P3 §2.5 — the silent-abort pre-check's chosen-name source (C-2): a node's
 *  LAST compiled states' `activePlacement` (all of a node's path-states share
 *  the chosen name; family-first states carry none and are skipped). null ⇒
 *  no satisfied choice yet — the update is conservatively RELEVANT. */
export function activePlacementOf(states: readonly CompiledState[]): string | null {
  for (const cs of states) {
    if (cs.activePlacement !== undefined) return cs.activePlacement
  }
  return null
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
