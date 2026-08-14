# Graph Spec — `Link` / `Anchor` / `LinkConfig` / `LinkConfigError`

Substrate spec for Pillar G (graph-derived parentage). Supersedes the local `parent` field:
no structural relationship is stored on the node; parentage, order, component and placement
resolution are all inferred from the anchor graph.

Source: `RENDER_PROCESS_NOTES.md` §8.4, §10.2, §10.8–§10.8.4, §10.9 (S1.1–S1.4, S3.2–S3.4,
S-R2.1/2/3/5/6/8/9, S-R3.1–S-R3.13, S-R4.2).

---

## 1. Core model

| Rule | Statement |
| --- | --- |
| Edge ownership | `Link` is the edge class: a **collection of anchors** (not necessarily binary) with query helpers and a `config` it enforces. The edge lives **on the `Link`**, reached via `anchor.link`. |
| Anchor residence | Anchors live on-node as `node.anchors: Anchor[]` — a **reconciled materialization**. Canon is the **layer stack** (may carry `AnchorLayer`s); `compileLocal` reconciles the node's anchors against its layers. No independent write path (S1.3, S-R3.8). |
| Injected anchors | Any effect that adds anchors — including a new layer — is populated by the **post-op dirty sweep**, never inside the creating compile pass; traceable to the generating anchor and removed with it (idempotent) (S-R2.9, S-R3.12). |
| Atomic family edge | A family edge is established/disestablished **atomically** (one op adds/removes the child anchor on the family `Link`) — never two independent field writes. Kills notes §8.4 #1. |
| Order | Children order is carried by each child anchor's `priority`/`order` in `Anchor.options`; `config.children.orderKey = 'unique'` enforces uniqueness. Never a stored array (S3.2). |
| `Anchor.target` | **NEVER the `Link` itself** (C2). The target is the resolved owner from the `AnchorTarget` union. |

---

## 2. Types

```ts
/** Roles a Link admits / an Anchor carries (S-R3.9; P3 §1.1: 'placement' renamed 'container', consumer role 'content' added). */
type Role =
  | 'parent' | 'child'                    // family ('parent-child') roles
  | 'source' | 'target' | 'duplex'        // component resolution maps (notes §10.8.2)
  | 'container' | 'content' | 'component' // peripheral edges: placement producer/consumer roles + component (S-R2.8, S-R3.9, P3 §1.1)

/** Anchor target. NEVER `Link` — the edge is reached via `anchor.link` (C2). */
type AnchorTarget =
  | Node                                  // resolved owner node
  | 'rootNode'                            // permanent owner: supervisor root (C1)
  | 'component'                           // permanent owner: component prototype
  | 'contentNodes'                        // permanent owner: unplaced content array (S-R2.2)
  | string                                // referenceName token (component/placement maps, notes §10.8.2)

interface AnchorOptions {
  priority?: number                       // child anchors carry priority/order
  order?: number
}

interface Anchor {
  role: Role
  target: AnchorTarget
  options: AnchorOptions
  link: Link                              // back-reference to the owning edge
}

interface LinkConfig {
  name: 'parent-child' | 'component' | 'placement' /* | … prototype/assembly compose from these */
  parent: { count: 1 }                                   // 'parent-child' only
  children: { min: 1; max: typeof Infinity; orderKey: 'unique' }
  roles: Role[]                                          // role whitelist this link admits (S-R3.9)
}

interface Link {
  id: string
  config: LinkConfig
  anchors: Anchor[]

  /** Find anchors by role, optionally narrowed by target / options. */
  anchorsOf(role: Role, target?: AnchorTarget): Anchor[]

  parents(): Anchor[]
  children(): Anchor[]
  sources(): Anchor[]
  targets(): Anchor[]

  /** @throws LinkConfigError on any config violation; pre-call state preserved. */
  addAnchor(a: Anchor): void
  /** @throws LinkConfigError (e.g. 'count-underflow'); pre-call state preserved. */
  removeAnchor(a: Anchor): void
  /** @throws LinkConfigError on duplicate ('unique-order') / range-out. */
  setOrder(a: Anchor, priority: number): void

  /** Deliberate wipe — disposes the link, orphans its child anchors. §6 erase semantics. */
  destroy(): void
}

class LinkConfigError extends Error {
  code: LinkConfigErrorCode               // full list in §4.2
  linkId: string
  config: LinkConfig                      // serialized snapshot of the enforced config
  detail: {
    intendedAnchor?: { role: Role; target: AnchorTarget; options: AnchorOptions }
    conflicting: Anchor[]                 // anchor(s) blocking the op (e.g. holding the requested order)
    currentCell: Anchor[]                 // full current anchor set of the link, for caller inspection
  }
}
```

---

## 3. Canonical link shapes & storage (notes §10.8.3)

| Shape | Composition | Config essentials | Owned by |
| --- | --- | --- | --- |
| `parent-child` | 1 link = exactly 1 `'parent'` anchor + ≥1 `'child'` anchors | `parent.count: 1`; `children { min: 1, max: Infinity, orderKey: 'unique' }`; `roles: ['parent','child']` | `LinkConfig 'parent-child'` |
| `component` | 1 link **per `referenceName`**; members anchor as `source` / `target` / `duplex` | `roles` includes source/target/duplex whitelist | `LinkConfig 'component'` |
| `placement` | the per-name **placement Link IS the zone registry** (P3 §2.1): `'container'`-role anchors (producers — legacy `placementName`, renamed from `'placement'`) offer a zone; `'content'`-role anchors (consumers — minted from `targetPlacement: string[]`, preference-ordered) request routing; both roles live on the shared per-name Link (roles `['container','content']`). Applied by the `placement-attach` op / compile (P3 §3.3; S-R2.8 — shares the borrow algorithm, NOT component role semantics) | per-name resolution Link | `LinkConfig` |

| Concept | Living location | Owned by |
| --- | --- | --- |
| `Anchor` | `node.anchors: Anchor[]` (materialization; canon = layer stack) | the node, back-ref to `Link` |
| `Link.anchors` | the link's anchor set | `Link` |

---

## 4. Role-holder convention & invariants

### 4.1 Role holders (S-R2.1, S-R3.4)

| Holder | Anchor held | Meaning |
| --- | --- | --- |
| Parent node | the single `'parent'` anchor on its family `Link` | "this node **as a parent**" — `node.anchorsOf('parent')` returns this |
| Child node | its single `'child'` anchor on that **same** family `Link` | the node's own in-tree edge |
| Root | family `'parent'` anchor with `target: 'rootNode'` (attached to supervisor, not a node) | unambiguous root — no `parent === null` case |
| Prototype member | parent-link whose `'parent'` anchor has `target: 'component'` | `prototype` state |
| Leaf / unplaced | **no `'child'` anchor** and no chain to a permanent owner | `unplaced` (S-R3.5 terminology) |

`node.parent` getter = ≤1 `'child'` anchor → its `Link` → the Link's `'parent'` anchor → its node (S-R3.1).

### 4.2 `LinkConfigError` — full code list

```ts
type LinkConfigErrorCode =
  | 'unique-order'      // priority/order already held by another anchor on this link
  | 'count-exceeded'    // role count would exceed its max (e.g. 2nd 'parent' vs count: 1)
  | 'count-underflow'   // removal would drop a role below its min (parent→0, children→0)
  | 'role-mismatch'     // anchor role not in config.roles whitelist
  /* | … */             // union is intentionally open — new configs may add codes
```

**Compile outcomes are NOT error codes:** `unresolved-reference` and
`circular-source` are compile results (CompileStatus + logged warning / fork-arm
drop disposition — see §7) — never thrown by `Link` methods, never part of this
union. Likewise the single-parent violation (2nd `'child'` anchor on one node) is
an **op-level** error `'single-parent'` raised at op validation (S-R4.2), not a
per-link `LinkConfigError` — see §9 G12.

### 4.3 Method → failure matrix

| Method | Fail condition | `code` | Caller reaction |
| --- | --- | --- | --- |
| `addAnchor(child, order)` | `order`/`priority` held by an existing child anchor | `unique-order` | **retry**: read `conflicting`, pick max+1 (§5) |
| `addAnchor(2nd 'parent')` | `parent.count: 1` already filled | `count-exceeded` | config forbids; use another link/role |
| `addAnchor(role ∉ config.roles)` | whitelist violation | `role-mismatch` | fix role or config |
| `removeAnchor(parentAnchor)` | parent count → 0 | `count-underflow` | **erase**: deliberate `link.destroy()` (§6) |
| `removeAnchor(last childAnchor)` | `children.min: 1` → 0 | `count-underflow` | **erase**: deliberate `link.destroy()` (§6) |
| `setOrder(a, p)` | `p` held by another anchor | `unique-order` | **retry** at max+1 (S3.2) |
| `setOrder(a, p)` | `p` out of range | (range-out; rejects) | fix value |

**Atomicity guarantee:** every rejecting method leaves the link in its exact **pre-call state** —
enforcement is atomic with validation; no partial application, ever.

---

## 5. Retry semantics (`unique-order` → max+1)

Policy (S3.2): **priority re-sort = append max+1. No reindexing by default.**

1. `addAnchor` / `setOrder` throws `LinkConfigError` with `code: 'unique-order'`.
2. Caller reads `error.detail.conflicting` (anchors holding the requested order) and
   `error.detail.currentCell` (full anchor set) — no guessing.
3. Caller picks a fresh order = **max(existing orders) + 1** and retries.
4. The failed write left the link **untouched** (atomicity), so retry is always from a clean,
   known state. Loop-safe and graceful.

---

## 6. Erase semantics (`count-underflow` → deliberate `destroy()`)

`removeAnchor` that would violate a `min` count **rejects** (`count-underflow`). Destruction is
never an accident of a removal — it is a separate deliberate call:

- **Erase flow:** `removeAnchor(parentAnchor)` rejects → caller calls **`link.destroy()`** —
  a deliberate wipe that disposes the whole link and **orphans its child anchors** (their nodes
  drop to `state: 'unplaced'`). One clean step, not a sequence of partially-rejected writes.
- **Self-destruction + cascade (S3.3):** the Link destroys itself and cascades to its anchors;
  parent/child participants call link destruction. Covers **both** parent-first and child-first
  underflow cases.
- **Orphans are transient; cascade-destroy is async (S-R2.3):** an orphaned node is left
  **`unplaced`** — still a valid attach target. Cascade destruction is scheduled on the
  **post-op microtask sweep** and fires only for nodes that still resolve to **no permanent
  owner** at sweep time.
- **Permanent owners (S-R2.2, S-R3.7):** the root node (`'rootNode'`), a component prototype
  (`'component'`), or the **`contentNodes`** array (`'contentNodes'`). A chain terminating at
  any of these survives the sweep.
- **Rescue:** re-`attach`ing synchronously before the sweep resolves the tree and **blocks
  destruction**.

---

## 7. Op-time loop guard (S3.4)

- Compile-time tree-traversal loop detection **doubles as the op-time guard**.
- `attach` / `move` run the **same detector** off the **destination's parent-chain** before
  committing.
- A detected cycle **rolls the op back** — **test-and-rollback**: the op is rejected and the
  graph returns to its exact pre-op state (same atomicity guarantee as `LinkConfigError`).
- Compile-time disposition cross-ref (S-R2.5, S-R3.3): loop-terminated fork arms log a
  `circular-source` warning; prototype-terminated arms fail silently. Neither yields an
  actionable state.

---

## 8. `attach` anchor bookkeeping (S-R3.13)

`attach` = make/reuse the destination's `'parent-child'` Link:

1. **Create or reuse the addend's family `'parent'` anchor** when it has no children yet —
   satisfies `parent.count: 1` from the first attach.
2. Add the child's `'child'` anchor with its `priority` on that same Link (fresh order —
   default append max+1, §5).

---

## 9. Exhaustiveness gate — TestWriter matrix

A TestWriter MUST derive a test for **every** row below (states + fail-states). Each rejecting
case additionally asserts: error is `LinkConfigError` with the exact `code`, `linkId`,
serialized `config`, populated `detail.intendedAnchor` / `conflicting` / `currentCell`, **and
the link is byte-identical to its pre-call state**.

| # | Category | Scenario | Expected |
| --- | --- | --- | --- |
| G1 | state | `attach` child with fresh order on existing family link | 1 `'parent'` + n `'child'` anchors; orders unique |
| G2 | state | `attach` on parent with no children (S-R3.13) | family `'parent'` anchor created; `count: 1` satisfied |
| G3 | fail | `addAnchor` child with colliding order | `unique-order`; `conflicting` = holder(s); unchanged |
| G4 | retry | after G3, retry at max+1 | succeeds; **no reindexing** of existing anchors (S3.2) |
| G5 | fail | `setOrder` to a held priority | `unique-order`; unchanged |
| G6 | fail | `setOrder` out of range | rejects; unchanged |
| G7 | fail | `addAnchor` 2nd `'parent'` anchor | `count-exceeded`; unchanged |
| G8 | fail | `removeAnchor(parentAnchor)` | `count-underflow`; unchanged |
| G9 | fail | `removeAnchor(last childAnchor)` | `count-underflow`; unchanged |
| G10 | erase | `link.destroy()` after G8/G9 | link disposed; child anchors orphaned; nodes → `unplaced` |
| G11 | fail | `addAnchor` with role ∉ `config.roles` | `role-mismatch`; unchanged |
| G12 | invariant | 2nd `'child'`-role anchor on an in-tree node (≤1 per node, S-R3.4) | op validation fails **explicitly and verbosely** with the dedicated op-level error `'single-parent'` (cross-link check — NOT a per-link `count-exceeded`, never a silent `move`; S-R4.2); caller must `detach`/`move` first |
| G13 | fail | `'parent'` anchor without children (allowed only transiently via S-R3.13 path) | exactly one `'parent'` anchor only when ≥1 child (S-R3.4) |
| G14 | loop | `attach` A under its own descendant D | op-time guard on D's parent-chain detects cycle; **rollback**; pre-op state |
| G15 | loop | `move` subtree under itself | same detector; rollback |
| G16 | cascade | orphaned node, sweep runs, no permanent owner | async cascade-destroy (S3.3, S-R2.3) |
| G17 | rescue | orphaned node re-`attach`ed synchronously before sweep | destruction blocked (S-R2.3) |
| G18 | owners | chains ending at `'rootNode'` / `'component'` / `'contentNodes'` | survive sweep (S-R2.2) |
| G19 | cascade | parent-first underflow and child-first underflow variants of G10 | both covered by link self-destruction (S3.3) |
| G20 | target | anchor with `target` = a `Link` | forbidden — target is NEVER the Link; edge via `anchor.link` (C2) |

---

**Summary:** Pillar G graph spec — `Link`/`Anchor`/`LinkConfig` types, role-holder convention, full `LinkConfigError` code list, max+1 retry, deliberate-destroy erase, async cascade, op-time loop guard, atomicity guarantees, and a 20-row TestWriter exhaustiveness matrix.
**File:** `/media/ryan/Shared Files1/Projects/Preempt-Providence/docs/specs/graph.md`
