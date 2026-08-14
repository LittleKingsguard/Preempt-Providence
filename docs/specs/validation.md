# Validation Spec — Pillar E + LinkConfig Boundary

**Source:** RENDER_PROCESS_NOTES.md §10.5, §10.8, §10.8.1, §10.9 (S3.2, S3.4, S3.5/S-R2.5, S-R3.4, S-R3.8, S-R3.9, S-R3.13, S-R4.2, S-R4.3, trade-off 4)

---

## 1. Tag Schemas (Pillar E)

Pillar E replaces `Node.REQUIRED_PROPS_MAP` and per-tag `validateNode` chains with **schema data** resolved by tag at runtime.

```ts
interface TagSchema {
  required: string[]                           // e.g. ['content', 'handlers']
  validate: Record<string, (v: unknown) => boolean>  // per-prop validators
}

// Registry
const TAG_SCHEMAS = new Map<string, TagSchema>()
```

| Aspect | Rule |
|--------|------|
| Registration | Validators registered by `Tag` (or `Prop`) in one file |
| Content scope | Node *content/props/values* only — never structural invariants |
| Extensibility | New tag type = one schema row (+ optional validator fn). No edits to `Node.ts`, `ValidationWorker`, or domain classes |
| Graph objects | `Link` and `Anchor` participate in schema validation (trade-off 4) so graph objects aren't second-class citizens |

**Example (from notes §10.5):**
```ts
const QRCODE_SCHEMA: TagSchema = {
  required: ['content', 'handlers'],
  validate: { content: v => typeof v === 'string' }
}
```

---

## 2. LinkConfig vs Schema Boundary

Two enforcement layers exist. They **never step on each other** (notes §10.5):

| Layer | Owns | Cannot do |
|-------|------|-----------|
| **LinkConfig** (structural) | Parent-child counts, unique `priority`, role whitelists, link-shape invariants | Reject a *value* (content/props) |
| **Schema validation** (Pillar E) | Tag schemas, prop values, content types | Break a *link invariant* (counts, roles, order) |

```ts
// Reference copy — canonical definition lives in graph.md §2; do not extend here.
interface LinkConfig {
  name: 'parent-child' | 'component' | 'placement' /* | … prototype/assembly compose from these */
  parent: { count: 1 }                                  // 'parent-child' only
  children: { min: 1; max: typeof Infinity; orderKey: 'unique' }
  roles: Role[]                                         // whitelist of admitted roles (S-R3.9)
}

type Role = 'parent' | 'child' | 'source' | 'target' | 'duplex' | 'container' | 'content' | 'component'   // P3 §1.1
```

**Boundary rules:**
- `LinkConfig` enforcement happens **at the mutation boundary** — inside `addAnchor`, `removeAnchor`, `setOrder` (notes §10.8).
- Schema validation happens **at compile time** (Pillar E) on node values.
- A structural write that violates `LinkConfig` throws `LinkConfigError`; a value that fails schema throws a schema-validation error (distinct type, not catalogued here).

---

## 3. LinkConfigError — Code Catalog (open union)

**Four codes today** — everything `Link` methods throw; the union is **intentionally open** (new configs may add codes — graph.md §4.2). The class carries verbose actionable data (notes §10.8.1). `unresolved-reference` and `circular-source` are **compile outcomes** (CompileStatus + warning / fork-arm drop disposition), **NOT** error codes — never thrown by `Link` methods (see §4–§5).

```ts
class LinkConfigError extends Error {
  code: LinkConfigErrorCode
  linkId: string
  config: LinkConfig                    // serialized
  detail: {
    intendedAnchor?: { role: Role; target: AnchorTarget; options: AnchorOptions }
    conflicting: Anchor[]               // anchors blocking the op
    currentCell: Anchor[]               // full current anchor set
  }
}

type LinkConfigErrorCode =
  | 'unique-order'        // duplicate priority/order on child anchor
  | 'count-exceeded'      // adding anchor would exceed max count
  | 'count-underflow'     // removing anchor would drop below min count
  | 'role-mismatch'       // role not in LinkConfig.roles whitelist
// NOT codes: 'unresolved-reference' / 'circular-source' are compile outcomes (§4), never thrown.
```

### 3.1 Per-Code Semantics

| Code | Thrown by | Trigger | Semantics / Caller Reaction |
|------|-----------|---------|----------------------------|
| `unique-order` | `addAnchor`, `setOrder` | Child anchor `priority`/`order` collides with existing anchor | Read `conflicting` to see existing priority; retry with `max+1` (S3.2) |
| `count-exceeded` | `addAnchor` | Adding anchor exceeds `max` count (e.g. second `'parent'` anchor on parent-child link) | Pick different link or remove existing anchor first |
| `count-underflow` | `removeAnchor` | Removing anchor drops below `min` count (e.g. removing last `'parent'` anchor) | Caller may escalate to `link.destroy()` — deliberate wipe that orphans children to `unplaced` (notes §10.8.1) |
| `role-mismatch` | `addAnchor` | Anchor role not in `config.roles` whitelist | Check role spelling / link type; use correct `LinkConfig` |

### 3.2 Atomicity Guarantee

Every rejecting method leaves the link in its **pre-call state** (notes §10.8.1). Enforcement is atomic with validation — no partial application.

### 3.3 Op-Level Errors (NOT per-link `LinkConfigError`)

| Code | Raised by | Trigger | Semantics / Caller Reaction |
|------|-----------|---------|----------------------------|
| `single-parent` | **op validation** (`attach`/`clone-instance` executors — cross-link check) | Addend node already holds a `'child'`-role anchor on another family `Link` | Fails **explicitly and verbosely** (S-R4.2): NOT a per-link `count-exceeded`, NEVER a silent `move`. Caller must `detach`/`move` first, then retry |

---

## 4. Validation Timing

| Timing | Mechanism | What it catches | Rollback / Recovery |
|--------|-----------|---------------|---------------------|
| **Op-time** (structural mutation) | `addAnchor` / `removeAnchor` / `setOrder` guards + op validation | per-link: `unique-order`, `count-exceeded`, `count-underflow`, `role-mismatch`; op-level: `single-parent` (cross-link, S-R4.2) | **Test-and-rollback**: op runs detector (e.g. loop detection off destination parent-chain), detected cycle rolls op back (S3.4) |
| **Compile-time** (graph resolution) | `compileRemote` pass 2 | compile outcomes (NOT throws): `unresolved-reference`, `circular-source` | `unresolved-reference` → status + logged warning, node still renders its own state (S-R4.3); fork arms dropped (silent) or warned (`circular-source`) |

**Op-time loop detection (S3.4):**
- `attach` / `move` run the **same detector** as compile-time tree traversal, but off the destination's parent-chain.
- Detected cycle → op rolled back. No partial state.

**Compile-time fork-arm disposition (notes §10.8.4, S-R2.5, S-R3.3):**
- Arm terminates at **root** → actionable compiled state.
- Arm terminates at **component prototype** or **`contentNodes`** → fails silently, no actionable state.
- Arm terminates in **loop** → logs `circular-source` warning, dropped.
- No coerced pick is ever synthesized.

---

## 5. Unresolved-Reference Handling

**Trigger:** A component `target` anchor (or placement `content` anchor) with a `referenceName` that never matches a `source`/`duplex` anchor on the walk toward root (notes §10.8.2).

**Algorithm:**
1. Compile starts at the node itself — **depth-0 self-resolution** (S4.1, S-R2.6): if the node already carries a `source`/`duplex` anchor for that `referenceName`, it resolves at itself before any upward walk.
2. Unresolved targets walk **toward root**, taking the **first** `source`/`duplex` match. Nearest shadows far; root-level only if nothing closer exists.
3. No match on the way up → **`unresolved-reference` compile state** with clear code — a CompileStatus, not a throw. If the compile is otherwise viable, **log a warning and render the node's own state anyway** — not dropped, not hidden (S-R4.3).

**Resolution context:** `LinkConfig` `roles` whitelist and `count` constraints apply to component links same as parent-child links (notes §10.8.2). The unresolved-target state is part of that config, not a validation-layer catch.

---

## 6. Clone/Options Machinery Participation

Per notes §10.8 trade-off 4: `Link` + `Anchor` participate in **clone/options machinery** (notes §10.4) and **schema validation** (notes §10.5) so graph objects aren't second-class citizens.

| Mechanism | Participation |
|-----------|---------------|
| **Clone** | `CloneUtils` keeps `Map<ConstructorName \| RefKind, CloneFn>` with registered fns for `Link`/`Anchor`; deep clone recreates the whole family (anchors + links) |
| **Options** | Default clone = base + layers + anchor profile (S1.4); options auto-derive where possible (e.g. fresh `'parent-child'` priority anchor, component `referenceName` role links) |
| **Schema validation** | `Link`/`Anchor` subject to tag-schema-like validation rules (trade-off 4) |

---

## 7. Exhaustiveness Gate — Test States

TestWriter derives every state/fail-state from the catalog above.

### 7.1 LinkConfigError Trigger Matrix

Four codes today (§3) — the union is intentionally open:

| Code | Minimal trigger | Boundary case | Timing |
|------|---------------|---------------|--------|
| `unique-order` | `addAnchor` child with `priority: 1` when `priority: 1` exists | Same priority on different link types | Op-time |
| `count-exceeded` | `addAnchor` second `'parent'` anchor to parent-child link | `max: 1` boundary | Op-time |
| `count-underflow` | `removeAnchor` last `'parent'` anchor from parent-child link | `min: 1` boundary; children orphaned | Op-time |
| `role-mismatch` | `addAnchor` with `role: 'source'` on parent-child link | Role not in `roles: ['parent','child']` | Op-time |

**Not `LinkConfigError` codes** — op-level error and compile outcomes, tested separately:

| Code / outcome | Minimal trigger | Boundary case | Timing |
|------|---------------|---------------|--------|
| `single-parent` (op-level error) | `attach` a node already holding a `'child'` anchor | Cross-link check; explicit verbose failure; caller `detach`/`move`s first (S-R4.2) | Op-time |
| `unresolved-reference` (compile status) | Compile node with `target` anchor, no matching `source` up chain | Self-resolving `duplex` at depth 0 does NOT trigger it; viable state logs a warning and renders its own state (S-R4.3) | Compile-time |
| `circular-source` (warning) | Compile fork arm that loops back to itself | Loop vs prototype-terminated (silent) vs root-terminated (valid) | Compile-time |

### 7.2 Timing Guarantees

| Guarantee | Test assertion |
|-----------|---------------|
| Op-time atomicity | Rejected `addAnchor` leaves link unchanged (`currentCell` equals pre-call state) |
| Op-time loop rollback | `attach` creating cycle → op rolled back, destination unchanged |
| Async orphan sweep | `removeAnchor` parent → children `unplaced`; re-attach before sweep blocks destruction (S-R2.3) |
| Compile fork disposition | Root-terminated arm = actionable; prototype/`contentNodes` arm = silent drop; loop arm = `circular-source` warning |

### 7.3 Clone Participation

| Scenario | Expected |
|----------|----------|
| Default `node.clone(actor)` | Copies base + layers + anchor profile; fresh priority derived (S1.4) |
| `Link` registered in `CloneUtils` | `Map` has explicit `CloneFn`, no arity probing |
| `Anchor` back-ref after clone | Cloned anchor points to cloned link, not original |

---

**Summary:** Validation splits into LinkConfig structural enforcement (op-time, throws `LinkConfigError` with 4 codes today — the union is intentionally open, graph.md §4.2 — plus the op-level `'single-parent'` error, S-R4.2) and Pillar E schema validation (compile-time, tag schemas); `unresolved-reference` and `circular-source` are compile outcomes (status/warning — never thrown codes), and Link/Anchor participate fully in clone/options machinery.

**File:** `/media/ryan/Shared Files1/Projects/Preempt-Providence/docs/specs/validation.md`
