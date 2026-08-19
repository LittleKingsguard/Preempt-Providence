import type { AnchorDecl, BatchRecord, LayerApplyOp, LayerMutationList, LinkConfigNameHub, MutationOp, NodeBaseData, NodeId, PlacementAttachOp, PlacementTrigger, RowsClearOp, RowsMintOp, StateSliceOp } from './types.js'
import { SingleParentError, CycleError, ApplyError } from './errors.js'
import { Node, findCycle, ancestorConsumesZone } from './node.js'
import { markPending, registerMinted, defPrototypesFor } from './registry.js'
import { Link } from './link.js'

export interface OpContext {
  hub: LinkConfigNameHub
  nodes: Map<NodeId, Node>
}

function toNode(value: unknown): Node {
  return value as unknown as Node
}

function toLink(a: { link: unknown }): Link {
  return a.link as unknown as Link
}

export function applyStateSlice(node: Node, mutation: LayerMutationList): void {
  for (const m of mutation) {
    // placement/children targeting is hard-blocked at the state-slice boundary (FS-10)
    if ((m.targetProp as string).startsWith('placement') || (m.targetProp as string) === 'children') {
      throw new ApplyError('placement-target-blocked', m)
    }
  }
  node.applySlice(mutation)
}

function attach(node: Node, to: Node, priority: number | undefined): NodeId {
  const existing = node.anchors.find(a => a.role === 'child')
  if (existing) {
    const link = toLink(existing)
    const parentAnchor = link.anchorsOf('parent')[0]
    // the contentNodes permanent-owner token (translate-minted, P3 §10.ad/
    // F-13) is a placeholder family edge — a real parent edge supersedes it
    // ("attach adds a placement path to an already-in-tree content root");
    // destroy() bypasses the parent-child link's min-1 child count
    if (parentAnchor && parentAnchor.target === 'contentNodes') {
      link.destroy()
    } else {
      const existingParent = parentAnchor && typeof parentAnchor.target === 'object'
        ? parentAnchor.target
        : null
      if (existingParent !== to) {
        throw new SingleParentError(node.id)
      }
      return to.id
    }
  }
  const link = to.familyLinkFor()
  if (!link) {
    throw new SingleParentError(node.id)
  }
  const options: { priority?: number } = {}
  if (priority !== undefined) {
    options.priority = priority
  } else {
    const siblings = link.anchorsOf('child')
    const max = siblings.reduce((m, a) => Math.max(m, a.options.priority ?? 0), -1)
    options.priority = max + 1
  }
  node.addAnchor('child', node, options, link)
  return to.id
}

/** DEFECT #12 fix (2026-08-15) — the SAFE per-node detach, shared by the ops
 *  executors, the supervisor detach/move/undo paths, and the payload
 *  lifecycle: removes ONLY this node's child anchor from its family link
 *  (siblings keep their edges — the old `link.destroy()` wiped the whole
 *  shared link because `parentCount` counts PARENT anchors, always 1 on a
 *  family link) and marks the node pending so the sweep cascade-destroys it
 *  unless it is re-attached first. When the LAST child leaves the shared
 *  link, the parent side dissolves too (S-R3.4 — a childless parent carries
 *  zero parent anchors). */
export function detachNodeSafe(node: Node): void {
  const ca = node.childAnchor()
  if (!ca) {
    markPending(node) // already unplaced — still sweep-eligible
    return
  }
  const link = ca.link as unknown as Link
  const idx = link.anchors.indexOf(ca)
  if (idx !== -1) link.anchors.splice(idx, 1)
  const nIdx = node.anchors.indexOf(ca)
  if (nIdx !== -1) node.anchors.splice(nIdx, 1)
  markPending(node)
  if (link.anchorsOf('child').length === 0) {
    const pa = link.anchorsOf('parent')[0]
    if (pa && typeof pa.target === 'object' && pa.target !== null) {
      const owner = pa.target as Node
      const oi = owner.anchors.indexOf(pa)
      if (oi !== -1) owner.anchors.splice(oi, 1)
    }
    link.anchors.length = 0
  }
}

function detach(node: Node): NodeId {
  detachNodeSafe(node)
  return node.id
}

export interface PlacementAttachResult {
  containerAnchorMinted: boolean
  attachZone: string
}

/** P3 §1.3 — the ancestor-name veto: legacy nulls out a `placementName` when
 *  an ancestor already offers the same name (the anti-loop guard). Runtime
 *  minting applies the same veto against the ATTACH TARGET's (the container
 *  node's) ancestor chain: an ancestor offering the zone → the container
 *  anchor is NOT minted (warn `placement-name-vetoed`, warn+skip, never a
 *  throw). Content anchors (the consumer side) are never vetoed. */
/** P3 §3.3/§9-Q2 — the placement-attach executor: mints the node's `content`
 *  anchor(s) per the requested container names (preference order, dedup
 *  keep-first — re-attach is idempotent) and mints/ensures the `container`
 *  anchor on the target container node for the attach zone (names[0]), under
 *  the §1.3 ancestor-name veto. Both roles land on the SHARED per-name
 *  placement Link (the zone registry). */
export function placementAttach(node: Node, container: Node, names: string[], hub: LinkConfigNameHub): PlacementAttachResult {
  const attachZone = names[0]
  if (typeof attachZone !== 'string' || attachZone.length === 0) {
    throw new ApplyError('placement-target-blocked', { detail: 'placement-attach requires at least one requested container name' })
  }
  for (const name of names) {
    if (typeof name !== 'string' || name.length === 0) continue
    if (node.anchors.some(a => a.role === 'content' && a.target === name)) continue
    node.addAnchor('content', name, {}, hub.linkFor(name, 'placement'))
  }
  let containerAnchorMinted = false
  const existing = container.anchors.find(a => a.role === 'container' && a.target === attachZone)
  if (!existing) {
    if (ancestorConsumesZone(container, attachZone)) {
      console.warn(`[placement-attach] placement-name-vetoed: an ancestor of ${container.id} already offers zone "${attachZone}"; container anchor skipped (P3 §1.3)`)
    } else {
      container.addAnchor('container', attachZone, {}, hub.linkFor(attachZone, 'placement'))
      containerAnchorMinted = true
    }
  }
  return { containerAnchorMinted, attachZone }
}

/** P3 §1.2/10.ac.2 #7 — the trigger-identity derivation: a freshly minted
 *  container anchor is a `container-added`; an ensured (already-present)
 *  container with only new content anchors is a `content-added`. (`container-
 *  removed` arrives with removal ops in later units — the direction union
 *  already admits it.) */
export function derivePlacementTrigger(linkName: string, containerAnchorMinted: boolean): PlacementTrigger {
  return { kind: 'placement', linkName, direction: containerAnchorMinted ? 'container-added' : 'content-added' }
}

/** ORIGIN-OWNER (archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review §12.4, unpark acceptance) — the
 *  layer-apply executor: ONE atomic mint-and-wire op. Mints each NodeData as
 *  a family child of the target (appended after the current children), marks
 *  each node's `originLayer` + registers it in the module-level minted-set
 *  registry (survives creator death, A1), and applies the anchor layer
 *  (`decls`, child-role decls carrying `options.origin = layerId` — admitted
 *  by the role-scoped single-parent exemption) to the target. Family children
 *  ONLY (A5): a NodeData carrying an `anchors` field warns
 *  `layer-apply-anchors-rejected` and the child data still mints (the
 *  smuggled anchors never materialize). Re-applying the SAME layerId is a
 *  no-op (idempotent — the minted set and census are untouched); the minted
 *  ids ride the journal result (A3 — replay resolves them). Teardown = one
 *  removeLayer/removeLayersForSource on the creator. */
export function layerApply(op: LayerApplyOp, ctx: OpContext): { minted: NodeId[]; doorways: NodeId[] } {
  const target = toNode(op.target)
  if (target.layers.some(l => l.id === op.layerId)) return { minted: [], doorways: [target.id] }
  const minted: NodeId[] = []
  const link = target.familyLinkFor()
  let priority = link.anchorsOf('child').reduce((m, a) => Math.max(m, a.options.priority ?? 0), -1) + 1
  for (const nd of op.nodes ?? []) {
    // A5 seed-anchor veto: v1 mints family children ONLY — a NodeData
    // `anchors` field is rejected with a warn; the child data still mints
    const { anchors, ...data } = nd as NodeBaseData & { anchors?: AnchorDecl[] }
    if (anchors !== undefined) {
      console.warn(`layer-apply-anchors-rejected at ${target.id}: seed anchors are not minted by layer-apply (v1 mints family children only)`)
    }
    const node = new Node(data, target.hubFor ?? ctx.hub ?? undefined)
    node.originLayer = op.layerId
    registerMinted(node.id, op.layerId)
    minted.push(node.id)
    node.addAnchor('child', node, { priority }, link)
    priority += 1
  }
  // the anchor layer on the creator; child-role decls carry the origin marker
  const decls = (op.decls ?? []).map(d =>
    d.role === 'child' ? { ...d, options: { ...(d.options ?? {}), origin: op.layerId } } : d,
  )
  target.addLayer({ id: op.layerId, sourceName: op.sourceName, anchors: decls })
  return { minted, doorways: [target.id, ...minted] }
}

/** HOOKS-ARRAY (CONTRACT AMENDMENT C §9.2 pins 3/5 — options C) — the
 *  rows-mint executor: ONE atomic mint op. Resolves the prototype BY NAME
 *  (the `prototypeName` → the per-name component Link's translate-minted def
 *  prototypes), then mints ONE family node per raw data row (each row's
 *  fields become VALUE-BEARING source anchors on the minted node), marks
 *  each minted node's `originLayer` + registers it, applies the batch layer
 *  on the target, and records the PAYLOAD (the `batches[hookName]` record —
 *  Option C, the single control handle). The layerId is NODE-SCOPED
 *  (`hook-${target.id}-${hookName}-rows` — DEFECT #23: the module-level
 *  mintedByLayer/mintedByOrigin registry keys by origin string, so an
 *  unscoped id would let one node's teardown cross-destroy another's set).
 *  FAIL-WITH-WARNING: a `prototypeName` with no prototypes throws
 *  `rows-prototype-unresolved` (the supervisor rejects the op + warns) —
 *  never a silent zero-row mint. Re-applying the SAME hookName REPLACES the
 *  batch (the same-layerId replace pin — distinct from layer-apply's no-op);
 *  payload-control teardown lives in the supervisor (a `rows-clear` op / the
 *  `batches` record removal). */
export function rowsMint(op: RowsMintOp, ctx: OpContext): { minted: NodeId[]; doorways: NodeId[]; layerId: string } {
  const target = toNode(op.target)
  const layerId = `hook-${target.id}-${op.hookName}-rows`
  const hub = target.hubFor ?? ctx.hub ?? undefined
  // prototype-by-name resolution — the per-name component Link's def
  // prototypes (registry.js:78-86); FAIL-WITH-WARNING on empty.
  const protoLink = hub.linkFor(op.prototypeName, 'component')
  const protos = defPrototypesFor(protoLink)
  if (protos.length === 0) {
    console.warn(`rows-prototype-unresolved at ${target.id}: prototype "${op.prototypeName}" has no def prototypes; rows-mint rejected`)
    throw new ApplyError('rows-prototype-unresolved' as never, { prototypeName: op.prototypeName })
  }
  const shape = protos[0]!
  // PAYLOAD-CONTROLLED replace: a re-mint on the SAME hookName first tears
  // down the prior batch (the control record + layer removal) so the minted
  // set never accumulates (the single-source constraint).
  const existing = target.layers.find((l) => l.id === layerId)
  if (existing !== undefined) {
    target.removeLayer(layerId)
  }
  // §9.4 item 7 — the `rows: []` CLEAR contract: an empty batch is a CLEAR,
  // NOT a sticky empty record (distinct from the B5 `{children: []}` no-op).
  // After the prior-batch teardown above, nothing mints and no record is
  // written — the hook is simply absent.
  if ((op.rows ?? []).length === 0) {
    const batches = (target as unknown as { batches?: Record<string, BatchRecord> }).batches ?? {}
    delete batches[op.hookName]
    return { minted: [], doorways: [target.id], layerId }
  }
  const minted: NodeId[] = []
  const fam = target.familyLinkFor()
  let priority = fam.anchorsOf('child').reduce((m, a) => Math.max(m, a.options.priority ?? 0), -1) + 1
  for (const row of op.rows ?? []) {
    const node = new Node({ ...row, type: row.type ?? shape.type, css: row.css ?? shape.css } as NodeBaseData, hub)
    node.originLayer = layerId
    registerMinted(node.id, layerId)
    minted.push(node.id)
    node.addAnchor('child', node, { priority }, fam)
    priority += 1
    // the row's fields as VALUE-BEARING source anchors (per-row provider
    // anchors — consumers resolving a field name fan out per row, §9.2 pin 6)
    for (const key of Object.keys(row)) {
      if (key === 'type' || key === 'css' || key === 'children' || key === 'props' || key === 'content' || key === 'handlers') continue
      const fieldLink = hub.linkFor(key, 'component')
      const anchor = node.addAnchor('source', key, {}, fieldLink)
      if (anchor !== null) anchor.value = (row as unknown as Record<string, unknown>)[key]
    }
    // §9.4 item 8 — the 'placement' kind: each minted row requests the
    // SPECIFIED target placement (a `content` anchor on the shared per-name
    // placement Link — the consumer side of the zone registry, P3 §1.1). The
    // zone itself rides the EXISTING placement-attach/content-anchor surface
    // (a container node offering the zone via its `container` anchor on the
    // same per-name placement Link); this op only mints the rows' REQUEST
    // side — no placement-path machinery, no F3-veto interplay here.
    if (op.mintKind === 'placement' && op.placementName !== undefined) {
      node.addAnchor('content', op.placementName, {}, hub.linkFor(op.placementName, 'placement'))
    }
  }
  const decls = minted.map((_, i) => ({ role: 'child', target, options: { priority: i, origin: layerId } } as AnchorDecl))
  target.addLayer({ id: layerId, sourceName: op.sourceName ?? 'rows-mint', anchors: decls })
  // OPTION C — the payload record (the single control handle)
  const batch: BatchRecord = {
    prototypeName: op.prototypeName,
    rows: op.rows,
    layerId,
    mintKind: op.mintKind,
    ...(op.placementName !== undefined ? { placementName: op.placementName } : {}),
  }
  ;(target as unknown as { batches?: Record<string, BatchRecord> }).batches ??= {}
  ;(target as unknown as { batches: Record<string, BatchRecord> }).batches[op.hookName] = batch
  return { minted, doorways: [target.id, ...minted], layerId }
}

/** HOOKS-ARRAY (§9.4 item 6 — the PAYLOAD-CONTROLLED teardown). Operates on
 *  the `batches[hookName]` record (the SINGLE handle): deletes the record
 *  and tears down the minted set via the record's layerId with the
 *  NO-PROMOTION override (rowsTeardown) — the minting apparatus
 *  (`removeLayer`/`teardownMinted`/the registry) is internal, never invoked
 *  directly by external code. An unknown hookName (no record) is a contained
 *  no-op (applied, nothing to clear). */
export function rowsClear(op: RowsClearOp, ctx: OpContext): { doorways: NodeId[]; layerId?: string } {
  const target = toNode(op.target)
  const batches = (target as unknown as { batches?: Record<string, BatchRecord> }).batches ?? {}
  const record = batches[op.hookName]
  if (record === undefined) return { doorways: [target.id] }
  delete batches[op.hookName]
  target.rowsTeardown(record.layerId)
  target.removeLayer(record.layerId)
  return { doorways: [target.id], layerId: record.layerId }
}

export function execute(op: MutationOp, ctx: OpContext): { doorways: NodeId[] } {
  switch (op.kind) {
    case 'attach': {
      const node = toNode(op.node)
      const to = toNode(op.to)
      if (findCycle(node, to)) throw new CycleError(node.id)
      attach(node, to, op.priority)
      return { doorways: [op.to.id] }
    }
    case 'detach': {
      detach(toNode(op.node))
      return { doorways: [op.node.id] }
    }
    case 'move': {
      const node = toNode(op.node)
      if (findCycle(node, toNode(op.to.parent))) {
        throw new CycleError(node.id)
      }
      detach(node)
      attach(node, toNode(op.to.parent), op.to.priority)
      return { doorways: [node.id] }
    }
    case 'destroy': {
      toNode(op.node).destroy()
      return { doorways: [op.node.id] }
    }
    case 'placement-attach': {
      const pa = op as PlacementAttachOp
      const node = toNode(pa.node)
      const container = toNode(pa.container)
      placementAttach(node, container, pa.names, ctx.hub)
      return { doorways: [container.id, node.id] }
    }
    case 'layer-apply': {
      const la = op as LayerApplyOp
      const res = layerApply(la, ctx)
      return { doorways: res.doorways }
    }
    case 'rows-mint': {
      const rm = op as RowsMintOp
      const res = rowsMint(rm, ctx)
      return { doorways: res.doorways }
    }
    case 'rows-clear': {
      const rc = op as RowsClearOp
      const res = rowsClear(rc, ctx)
      return { doorways: res.doorways }
    }
    case 'clone-instance': {
      const source = toNode(op.source)
      const copy = source.clone('actor')
      attach(copy, source.parent ?? source, op.priority)
      return { doorways: [copy.id] }
    }
    case 'state-slice': {
      const s = op as StateSliceOp
      applyStateSlice(toNode(s.node), s.mutation)
      return { doorways: [s.node.id] }
    }
  }
}