import type { AnchorDecl, BatchRecord, LayerApplyOp, LayerMutationList, LinkConfigNameHub, MutationOp, NodeBaseData, NodeId, PlacementAttachOp, PlacementTrigger, RowsClearOp, RowsMintOp, StateSliceOp } from './types.js'
import { SingleParentError, CycleError, ApplyError } from './errors.js'
import { Node, findCycle, ancestorConsumesZone } from './node.js'
import { markPending, registerMinted, defPrototypesFor, defRootPrototypeFor, mintedByOrigin, resolveNodeRef, unregisterMinted } from './registry.js'
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
 *  `batches` record removal).
 *  KEYED BATCH-REUSE (Feature 1b — handoffs-review-6.md D1-D8): with
 *  `op.keyField` the replace is a REUSE — the O(N) existing-set match (key =
 *  the minted node's `keyField` source-anchor VALUE, strict `===`), remove-
 *  missing (per-id no-promotion teardown), in-place field reconcile (prune +
 *  set + add; the keyField anchor is the identity — never pruned), deep-
 *  equality no-op (unchanged rows skip the rewrite), mint-new for unmatched
 *  keys (fresh ids, appended at max+1 — reused nodes keep their priority
 *  slots, the positional arm identity), the layer decls REWRITTEN via
 *  addLayer (never removeLayer — the promoting teardownMinted would promote
 *  the reused rows), and `result.preRecord` captured for the D8 EXACT
 *  inverse undo. The D2 predicate decides keyed vs plain UP FRONT (atomic):
 *  any failure → the status-quo whole-batch replace, record WITHOUT keyField. */
export function rowsMint(op: RowsMintOp, ctx: OpContext): {
  minted: NodeId[]; doorways: NodeId[]; layerId: string
  reused?: NodeId[]; removed?: { key: unknown; nodeId: string }[]; preRecord?: BatchRecord | null
} {
  const target = toNode(op.target)
  const layerId = `hook-${target.id}-${op.hookName}-rows`
  const hub = target.hubFor ?? ctx.hub ?? undefined
  // ADVERSARIAL-S15 (2026-08-24) — a placement-kind mint REQUIRES the target
  // zone: without `placementName` the rows would mint with zero content
  // anchors (silent no-placement). Reject, never a silent no-op.
  if (op.mintKind === 'placement' && op.placementName === undefined) {
    throw new ApplyError('rows-placement-name-missing' as never, { hookName: op.hookName })
  }
  // ADVERSARIAL-S3 (2026-08-24) — row-shape validation UP-FRONT: a non-array
  // `rows` or a non-object member rejects BEFORE any node is minted — the
  // mint is ATOMIC (a bad row never leaves a half-minted orphan set, no
  // record, no layer).
  const rows = op.rows
  if (rows !== undefined && !Array.isArray(rows)) {
    throw new ApplyError('rows-shape-invalid' as never, { hookName: op.hookName, reason: 'non-array rows' })
  }
  const rowList = rows ?? []
  for (const row of rowList) {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      throw new ApplyError('rows-shape-invalid' as never, { hookName: op.hookName, reason: 'non-object row' })
    }
  }
  // prototype-by-name resolution — the per-name component Link's def
  // prototypes (registry.js:78-86); FAIL-WITH-WARNING when the name has no
  // def at all. ADVERSARIAL-S7: a SINGLE-ELEMENT def (def-root only, no
  // def-children) supplies the row shape from the def-ROOT registry — the
  // resolution is no longer children-only.
  const protoLink = hub.linkFor(op.prototypeName, 'component')
  const protos = defPrototypesFor(protoLink)
  let shape: Node | undefined
  if (protos.length > 0) {
    shape = protos[0]!
  } else {
    shape = defRootPrototypeFor(protoLink)
  }
  if (shape === undefined) {
    console.warn(`rows-prototype-unresolved at ${target.id}: prototype "${op.prototypeName}" has no def prototypes; rows-mint rejected`)
    throw new ApplyError('rows-prototype-unresolved' as never, { prototypeName: op.prototypeName })
  }
  const batches = (target as unknown as { batches?: Record<string, BatchRecord> }).batches ?? {}
  // D8 — the pre-op record capture (the undo fact-set for the keyed path).
  const preRecord = batches[op.hookName] ?? null
  const existing = target.layers.find((l) => l.id === layerId)
  // §9.4 item 7 / D7 — the `rows: []` CLEAR contract (keyed or not): an
  // empty batch is a CLEAR, never a sticky empty record. Undo stays the
  // documented no-op (preRecord is NOT carried — the payload teardown finds
  // no record and no-ops).
  if (rowList.length === 0) {
    if (existing !== undefined) {
      target.rowsTeardown(layerId)
      target.removeLayer(layerId)
    }
    delete batches[op.hookName]
    return { minted: [], doorways: [target.id], layerId, reused: [], removed: [], preRecord: null }
  }
  // D2/D3 — the KEYED-PATH predicate (decided UP FRONT — atomic). The keyed
  // path runs IFF the keyField is a legal declared column, every row carries
  // a primitive key value, and the existing record (if any) is consistent.
  // **ADVERSARIAL-KEYED-S5/S10 (re-arm reshape):** a record with NO keyField
  // does NOT degrade a keyed op — it is a "never-keyed" record, and a keyed
  // op whose rows are all key-valid RE-ARMS keyed (the record gains keyField).
  // Only a record whose keyField DIFFERS from the op's (or a prototype/zone
  // change) forces the plain replace. ANY failure → the plain whole-batch
  // replace, record WITHOUT keyField.
  const keyField = op.keyField
  let keyed = false
  if (keyField !== undefined) {
    const reserved = new Set(['anchors', 'type', 'css', 'children', 'props', 'content', 'handlers'])
    const invalid = (reason: string): void => {
      console.warn(`batch-keyfield-invalid at ${target.id}: ${reason}; rows-mint degraded to the plain whole-batch path`)
    }
    if (typeof keyField !== 'string' || keyField.length === 0 || reserved.has(keyField)) {
      invalid(`keyField "${String(keyField)}" is not a legal declared column`)
    } else if (!rowList.every((r) => {
      const v = (r as Record<string, unknown>)[keyField]
      return v !== undefined && v !== null && (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
    })) {
      invalid(`a row lacks a primitive "${keyField}" value`)
    } else if (preRecord !== null && preRecord.keyField !== undefined && preRecord.keyField !== keyField) {
      invalid(`the batch record's keyField ("${preRecord.keyField}") differs from the op's ("${keyField}")`)
    } else if (preRecord !== null && (preRecord.prototypeName !== op.prototypeName || (preRecord.placementName ?? undefined) !== op.placementName)) {
      invalid(`the batch record's prototype/zone mismatch the op`)
    } else {
      keyed = true
    }
  }
  // the plain path (status quo — ADVERSARIAL-S8b/S9 no-promotion replace)
  if (!keyed) {
    if (existing !== undefined) {
      target.rowsTeardown(layerId)
      target.removeLayer(layerId)
    }
    const minted: NodeId[] = []
    const fam = target.familyLinkFor()
    let priority = fam.anchorsOf('child').reduce((m, a) => Math.max(m, a.options.priority ?? 0), -1) + 1
    for (const row of rowList) {
      const mintedNode = mintRowNode(row as unknown as Record<string, unknown>, shape, hub, fam, layerId, priority, target, op)
      priority += 1
      minted.push(mintedNode.id)
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
    batches[op.hookName] = batch
    return { minted, doorways: [target.id, ...minted], layerId, reused: [], removed: [], preRecord: null }
  }
  // ==========================================================================
  // the KEYED path (Feature 1b — D1/D4/D5/D6/D10)
  // ==========================================================================
  // the D2 predicate guaranteed `keyField` is a legal non-empty string here
  const kf = keyField as string
  // D1 — the O(N) existing-set map: key = the minted node's `keyField`
  // source-anchor VALUE (strict ===). A minted node lacking the key anchor
  // is unmatchable → remove-missing.
  // **ADVERSARIAL-KEYED-S15 (cross-graph guard):** the layerId is node-id-
  // scoped only (DEFECT #23), so in a process where TWO graphs share a creator
  // node id + hookName, `mintedByOrigin(layerId)` returns BOTH graphs' minted
  // rows. The reuse-match + remove-missing must therefore require the node to
  // be a CHILD OF THIS TARGET (`parent === target`) — a row belonging to the
  // other graph is NEVER reused, only mint-new (its own graph reuses it).
  const existingNodes = new Map<unknown, Node>()
  const unmatchable: Node[] = []
  for (const id of mintedByOrigin(layerId)) {
    const n = resolveNodeRef(id)
    if (!n) continue
    if (n.parent !== target) continue // another graph's row (same-id process)
    const keyAnchor = n.anchors.find((a) => a.role === 'source' && a.target === kf)
    if (!keyAnchor) {
      unmatchable.push(n)
      continue
    }
    existingNodes.set(keyAnchor.value, n)
  }
  // D5 — within-input duplicate keys: warn + keep-FIRST (the duplicate row is
  // dropped, never minted twice).
  const seen = new Set<unknown>()
  const rowsToApply: Record<string, unknown>[] = []
  for (const row of rowList) {
    const key = (row as unknown as Record<string, unknown>)[kf]
    if (seen.has(key)) {
      console.warn(`duplicate-identifier at ${target.id}: rows-mint keyed on "${kf}" saw the identifier ${JSON.stringify(key)} twice; keep-first`)
      continue
    }
    seen.add(key)
    rowsToApply.push(row as unknown as Record<string, unknown>)
  }
  // remove-missing — existing keys absent from the input (1b.11(ii): destroy
  // via the batch teardown — per-id, NO-PROMOTION).
  const inputKeys = new Set(rowsToApply.map((r) => r[kf]))
  const removed: { key: unknown; nodeId: string }[] = []
  for (const [key, node] of existingNodes) {
    if (!inputKeys.has(key)) removed.push({ key, nodeId: node.id })
  }
  for (const node of unmatchable) removed.push({ key: undefined, nodeId: node.id })
  for (const { nodeId } of removed) {
    const node = resolveNodeRef(nodeId)
    if (!node) continue
    // the per-id no-promotion teardown (the rowsTeardown body for a subset —
    // never removeLayer, whose teardownMinted would PROMOTE)
    detachNodeSafe(node)
    node.originLayer = undefined
    unregisterMinted(node.id)
  }
  const fam = target.familyLinkFor()
  let priority = fam.anchorsOf('child').reduce((m, a) => Math.max(m, a.options.priority ?? 0), -1) + 1
  const minted: NodeId[] = []
  const reused: NodeId[] = []
  for (const row of rowsToApply) {
    const key = row[kf]
    const node = existingNodes.get(key)
    if (node) {
      // D4 — reconcile the row's flat fields onto the reused node; the
      // deep-equality no-op (D1) returns false → the node is NOT in the
      // changed set → its consumers are not marked (the silent-abort, D11).
      // ADVERSARIAL-KEYED-S17 — pass the MINT-PATH hub (target.hubFor ??
      // ctx.hub), never `node.hubFor`: a hub-less reused node must still gain
      // NEW fields on reuse (the mint path uses the same source).
      if (reconcileRowFields(node, row, kf, target, hub)) reused.push(node.id)
    } else {
      const mintedNode = mintRowNode(row, shape, hub, fam, layerId, priority, target, op)
      priority += 1
      minted.push(mintedNode.id)
    }
  }
  // D1 — the layer decls REWRITTEN via addLayer (replaces same-id in place;
  // materializeAnchors is decl-path idempotent). Reused nodes keep their
  // priority slots (the positional arm identity); mint-new appended above.
  // **ADVERSARIAL-KEYED-S18:** the decls must cover ONLY this batch's rows
  // (originLayer === layerId) — a non-batch family child of the owner (e.g. an
  // authored sibling) is never part of the batch layer.
  const decls = [...fam.anchorsOf('child')]
    .filter((a) => {
      const owner = typeof a.target === 'object' && a.target !== null ? (a.target as Node) : undefined
      return owner !== undefined && owner.originLayer === layerId
    })
    .sort((x, y) => (x.options.priority ?? 0) - (y.options.priority ?? 0))
    .map((a, i) => ({ role: 'child', target, options: { priority: a.options.priority ?? i, origin: layerId } } as AnchorDecl))
  target.addLayer({ id: layerId, sourceName: op.sourceName ?? 'rows-mint', anchors: decls })
  // the record — keyField written ONLY on the keyed path (D2)
  const batch: BatchRecord = {
    prototypeName: op.prototypeName,
    rows: op.rows,
    layerId,
    mintKind: op.mintKind,
    ...(op.placementName !== undefined ? { placementName: op.placementName } : {}),
    keyField: kf,
  }
  batches[op.hookName] = batch
  return { minted, reused, removed, layerId, preRecord, doorways: [target.id, ...minted] }
}

/** The reserved construction keys — never source anchors (they are stripped
 *  in the constructor/field loop), so a keyField naming one could never be
 *  read back off a minted node (D3). */
const RESERVED_CONSTRUCTION_KEYS = new Set(['anchors', 'type', 'css', 'children', 'props', 'content', 'handlers'])

/** Feature 1b — mint ONE row node (shared by the plain + keyed paths). */
function mintRowNode(
  rowObj: Record<string, unknown>,
  shape: Node,
  hub: LinkConfigNameHub,
  fam: Link,
  layerId: string,
  priority: number,
  target: Node,
  op: RowsMintOp,
): Node {
  // ADVERSARIAL-S13 — a row's `id` NEVER hijacks the minted node id: strip
  // it from the construction data (the node gets a FRESH mint-generated
  // id); the row's id stays a PROVIDER value (consumers can read it).
  // ADVERSARIAL-S14 — a row's `anchors` array is REJECTED (the layer-apply
  // OO-3 veto mirror): the constructor seed path must never materialize
  // smuggled graph edges (fabricated providers / leaked children).
  const { id: _rowId, anchors: _rowAnchors, ...fields } = rowObj
  if (_rowAnchors !== undefined) {
    console.warn(`rows-mint-anchors-rejected at ${target.id}: row anchors are not admitted by rows-mint (smuggled edges never materialize); ignored`)
  }
  const node = new Node({ ...fields, type: (fields.type as string) ?? shape.type, css: (fields.css as Record<string, unknown>) ?? shape.css } as NodeBaseData, hub)
  node.originLayer = layerId
  registerMinted(node.id, layerId)
  node.addAnchor('child', node, { priority }, fam)
  // the row's fields as VALUE-BEARING source anchors (per-row provider
  // anchors — consumers resolving a field name fan out per row, §9.2 pin 6).
  // `id` stays a PROVIDER value (a consumer may read a row's natural id);
  // `anchors` is never a field (the OO-3 veto above).
  for (const key of Object.keys(rowObj)) {
    if (RESERVED_CONSTRUCTION_KEYS.has(key)) continue
    const fieldLink = hub.linkFor(key, 'component')
    const anchor = node.addAnchor('source', key, {}, fieldLink)
    if (anchor !== null) anchor.value = rowObj[key]
  }
  // §9.4 item 8 — the 'placement' kind: each minted row requests the
  // SPECIFIED target placement (a `content` anchor on the shared per-name
  // placement Link — the consumer side of the zone registry, P3 §1.1).
  if (op.mintKind === 'placement' && op.placementName !== undefined) {
    node.addAnchor('content', op.placementName, {}, hub.linkFor(op.placementName, 'placement'))
  }
  return node
}

/** Feature 1b — D4: reconcile the row's flat fields onto a REUSED node.
 *  Source anchors are reconciled to the row's field set exactly (new fields
 *  added, shared values set, absent fields PRUNED — the keyField anchor is
 *  the identity anchor, never pruned). Shape fields are FROZEN (a differing
 *  type/css/props/content/children/handlers warns `rows-reuse-shape-ignored`
 *  and stays — the reused node's base is immutable). Returns TRUE when any
 *  source value actually changed (the deep-equality no-op → false). */
function reconcileRowFields(node: Node, row: Record<string, unknown>, keyField: string, target: Node, hub?: LinkConfigNameHub): boolean {
  for (const k of ['type', 'css', 'props', 'content', 'children', 'handlers']) {
    if (row[k] === undefined) continue
    const current = k === 'type' ? node.type : (node.base as Record<string, unknown>)[k]
    const differs = k === 'css' || k === 'props'
      ? JSON.stringify(row[k]) !== JSON.stringify(current)
      : row[k] !== current
    if (differs) {
      console.warn(`rows-reuse-shape-ignored at ${target.id}: row field "${k}" differs from the reused node's frozen shape; the shape stays (drop keyField for a whole-op replace)`)
    }
  }
  let changed = false
  const rowFields = new Set<string>()
  for (const key of Object.keys(row)) {
    if (key === keyField || RESERVED_CONSTRUCTION_KEYS.has(key)) continue
    rowFields.add(key)
    const existingAnchor = node.anchors.find((a) => a.role === 'source' && a.target === key)
    if (existingAnchor) {
      if (existingAnchor.value !== row[key]) {
        existingAnchor.value = row[key]
        changed = true
      }
    } else {
      // ADVERSARIAL-KEYED-S17 — use the MINT-PATH hub (`target.hubFor ??
      // ctx.hub`) so a hub-LESS reused node still gains new field anchors;
      // `node.hubFor` may be null even when the batch hub is live.
      const fieldLink = hub?.linkFor(key, 'component')
      if (fieldLink) {
        const anchor = node.addAnchor('source', key, {}, fieldLink)
        if (anchor !== null) {
          anchor.value = row[key]
          changed = true
        }
      }
    }
  }
  for (const a of [...node.anchors]) {
    if (a.role !== 'source' || typeof a.target !== 'string') continue
    if (a.target === keyField) continue
    if (!rowFields.has(a.target)) {
      node.removeAnchor(a)
      changed = true
    }
  }
  return changed
}

/** HOOKS-ARRAY (§9.4 item 6 — the PAYLOAD-CONTROLLED teardown). Operates on
 *  the `batches[hookName]` record (the SINGLE handle): deletes the record
 *  and tears down the minted set via the record's layerId with the
 *  NO-PROMOTION override (rowsTeardown) — the minting apparatus
 *  (`removeLayer`/`teardownMinted`/the registry) is internal, never invoked
 *  directly by external code. An unknown hookName (no record) is a contained
 *  no-op (applied, nothing to clear). */
export function rowsClear(op: RowsClearOp, ctx: OpContext): { doorways: NodeId[]; layerId?: string; minted?: NodeId[] } {
  const target = toNode(op.target)
  const batches = (target as unknown as { batches?: Record<string, BatchRecord> }).batches ?? {}
  const record = batches[op.hookName]
  if (record === undefined) return { doorways: [target.id] }
  // ADVERSARIAL-S5 — capture the minted set BEFORE the teardown so the
  // supervisor can walk the field-name consumers (the mint-side cascade) and
  // refresh their pass-2 states — no stale fan-out arms after a clear.
  const minted = mintedByOrigin(record.layerId)
  delete batches[op.hookName]
  target.rowsTeardown(record.layerId)
  target.removeLayer(record.layerId)
  return { doorways: [target.id], layerId: record.layerId, minted }
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