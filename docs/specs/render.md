# Spec — Render: `RenderAdapter`, render ops, client/SSR mapping

Canon: `RENDER_PROCESS_NOTES.md` §10.6 (Pillar F), §10.8.2, §10.8.4, §10.9
ledgers (S1.1, S2.3, S3.1, S4.2, S4.3, S-R2.5, S-R2.6, S-R3.3, S-R3.10,
S-R3.12, S-R4.3) and the state-serialization decision (node state MUST round-trip to the JSON schemas —
notes §10.6 "State round-trips … (decided)", `arch_review.md` D4).
Supporting legacy mapping: §3.1 (NodeSchema), §5.1 (hydration seam),
§6.8/§6.9 (client vs SSR element/assembly), §8.2 (parity).

Items not literal in the notes are marked *(derived)*. Graph/compile/locking
internals live in `graph.md` / `ops.md` / `pipeline.md`; this spec covers only
the render-facing surface.

---

## 1. Contract overview

The render layer consumes **compiled state** (two-phase `compile(slice)`,
notes §10.8.4) and emits **declarative render ops**; adapters map ops to a host
(DOM / HTML string / snapshot / canvas). The renderer is a pure consumer:

| In | Out |
| --- | --- |
| Fully-resolved, actionable, `'in-tree'` compiled slices only (S1.1) | `RenderOp[]` batches (tree diff) + serialized JSON state docs |
| Serialized anchors as typed refs (never live objects) | Adapter calls: DOM mutations, HTML string, `hydrate` |

Pipeline output is a **first-class JSON document, never an in-object proxy**
(notes §10.6, `arch_review.md` D4).

---

## 2. `RenderAdapter` interface (notes §10.6, verbatim core)

```ts
type NodeRef = string             // unique per-node ID, generated at creation (S3.1); the wire key
type ForkPathKey = string         // 'root/<id>/<id>/…' — path of NodeRefs back to the root node
type Role = 'parent' | 'child' | 'source' | 'target' | 'duplex' | 'placement' | 'component'

interface RenderAdapter<P, E> {   // P = element product (HTMLElement | fragment descriptor)
                                  // E = host environment (Document | string sink) — adapter-specialized
  createEl(type: string, wire: NodeRef): P
  setProp(wire: NodeRef, name: string, val: unknown): void
  appendChild(owner: P, child: P): void
  hydrate(rootWire: NodeRef, vdom: SerializedRenderDoc): void
  removeEl?(wire: NodeRef): void  // (derived) required by the diff op set; notes §10.6 lists the core four
}
```

### Method semantics

| Method | Client (DOM) adapter | SSR (string) adapter |
| --- | --- | --- |
| `createEl` | `document.createElement(type)`, keyed by `wire` (+ optional `forkKey`); reuse is via the **functional `css.id` hydrate seam** (adapters.md §3.6), not tag-match (legacy §6.8 tag-match reuse PARKED) | fragment descriptor `{ openTag, closeTag, contentText, isVoid }` (notes §6.8 shape) |
| `setProp` | `setAttribute` / `addEventListener` for `on*+raw` events / text content / input-`value` special-case; empty placement containers `display:none` | attribute strings; handlers inlined `on…="…"`; text into `contentText` |
| `appendChild` | DOM insert/reorder in compiled child order; stale children removed (notes §6.9) | string concatenation in compiled child order |
| `hydrate` | reuse SSR DOM via `getElementById(css.id)` seam (notes §5.1), bind wires, attach listeners | n/a — server never hydrates |
| `removeEl` *(derived)* | `el.remove()` + wire-table drop | omission from the string pass |
| styles op (below) | `<style id="preempt-dynamic-styles">` injection | same block, prefixed into the SSR result (notes §6.9) |

---

## 3. Render ops & minimal elements

### 3.1 Op vocabulary *(derived from notes §10.6 "declarative render ops (tree diff)")*

```ts
type RenderOp =
  | { kind: 'create'; wire: NodeRef; type: string; forkKey?: ForkPathKey }      // forkKey present only on actionable fork-arm emits (S-R3.10)
  | { kind: 'set';    wire: NodeRef; name: string; value: unknown; forkKey?: ForkPathKey }
  | { kind: 'append'; owner: NodeRef; child: NodeRef }                          // reorder = re-append in compiled order
  | { kind: 'remove'; wire: NodeRef; forkKey?: ForkPathKey }
  | { kind: 'styles'; cssDefs: unknown[] }                                      // one per sweep → preempt-dynamic-styles
```

### 3.2 MinimalElement — the node-local diff unit

```ts
interface MinimalElement {
  wire: NodeRef
  type: string
  props: Record<string, unknown>  // render-relevant compiled props incl. css id/classes/style, text, event bindings (cssDef flows via the styles op, not here)
  childOrder: NodeRef[]           // compiled children order (child-anchor `priority`, notes §10.8)
  forkKey?: ForkPathKey           // present on actionable fork arms (S-R3.10); forwarded onto emitted create/set/remove ops
}
```

Diff rules (prev vs next `MinimalElement`, per wire):

| # | Condition | Emitted ops |
| --- | --- | --- |
| D1 | wire in next, not prev | `create` + `set`* + `append` |
| D2 | wire in prev, not next | `remove` |
| D3 | `type` changed | `remove` + `create` (no morphing) |
| D4 | prop values changed | `set` **only for changed names** |
| D5 | `childOrder` changed | re-`append` in next order + `remove` departed |

Every emitted op **forwards the element's `forkKey` when present** (S-R3.10), so actionable
fork arms stay distinct at the adapter boundary (adapters.md §2/R2; `append` carries no
forkKey — it targets the already-created arm entries).

### 3.3 Emit ordering vs dirty sweep (D3/S-R2.3/S-R3.12)

| Rule | Statement |
| --- | --- |
| R-ORD-1 | Pass 1 (`compileLocal`) runs **synchronously inside the op**; pass 2 (`compileRemote`) never runs mid-op |
| R-ORD-2 | Dirtied dependents' pass 2 runs in **one coalesced microtask sweep per tick** — all nodes dirtied by a batch compile remote in the same sweep |
| R-ORD-3 | **Render emit happens strictly after the sweep completes — including the cascade-destroy sweep** (cascade runs BEFORE render emit; drain order owned by pipeline.md §5.1); emits consume fully-resolved slices only |
| R-ORD-4 | Any anchor-adding effect — including a new layer (S-R3.12) — is populated **in the sweep**, idempotently, never inside the creating compile pass |
| R-ORD-5 | Slice stays **locked until final resolution** — every fork emitted **or** dropped; only then `unlock` (S2.3) |
| R-ORD-6 | Within one emit batch: `create(parent)` precedes `append(parent, child)`; `remove(wire)` precedes any re-`create` of the same wire; at most one `styles` op |
| R-ORD-7 | Nested emission on an active slice chain is **deferred to the microtask queue** (locking Option B); recursion-depth cap is the loop tripwire |
| R-ORD-8 | The actionable `next` array is **root-first**: every node's `create` precedes its descendants' `create` (adapters derive the SSR root as the first-created wire, adapters.md §4.6) |

---

## 4. Two-scope model (notes §10.6, notes §10.8 compile bullet, notes §10.8.4)

Same `compile(slice)` primitive, parameterized by entry point:

| | Root-out deep render | Node-local minimal-element render |
| --- | --- | --- |
| Trigger | bootstrap / full reconcile / hydrate re-resolution | event emission: `state-slice` via `ClientAPI.apply(nodeRef, mutation)` (S2.1, S-R3.11) |
| Entry point | supervisor's root anchor | the affected node's own anchors |
| Pass 1 | whole slice | affected node/subtree only |
| Pass 2 | one coherent walk | **bounded**: ancestor chain only, for parent + source/duplex borrow |
| Emit | full op stream / vdom (`hydrate`) | **diffed `MinimalElement` ops only** — D1–D5; no full graph walk per update |
| Cost | O(slice) | O(node layers + anchors + ancestors) |

Handler-caused re-render MUST NOT trigger a full supervisor walk (notes §10.6).

---

## 5. JSON-schema serialization contract (notes §10.6, `arch_review.md` D4 — DECIDED)

Compiled/render node state — **including its anchor/link form** — serializes
back to the existing `NodeSchema` shapes (notes §3.1): `NodeData` inside
`TemplateData` / `ContentPayload`; the SSR snapshot = **one JSON document per
schema**, delivered as `<script id="preempt-initial-data" type="application/json">
{ template, content, clientConfig }</script>` (notes §2.2). `clientConfig` carries
only **adapter selection + persistence flags** (notes §10.6; legacy `run*` gates
PARKED, S4.3). Server-only fragments are dropped permanently (notes §8.2).

```ts
interface SerializedAnchor {                  // anchors serialize as typed refs (notes §10.6) — never live objects
  role: Role
  target: NodeRef | 'rootNode' | 'component' | 'contentNodes' | string // string = referenceName token (notes §10.8.2)
  options: { priority?: number; order?: number }
  link: string                                // Link id
  value?: unknown                             // provider value (source/duplex) or component binding hint
  parent?: string                             // child anchors: the parent side's id/token (family edge round-trip)
}

interface RenderNodeState {                   // render-relevant slice of the compiled state; JSON-safe
  id: NodeRef
  state: 'in-tree'                            // only in-tree states are renderable/serializable as actionable (S1.1)
  type: string
  props: Record<string, unknown>
  css: { id?: string; classes?: string[]; style?: string; cssDef?: unknown }
  content?: unknown
  children: NodeRef[]                         // ordered by child-anchor priority
  anchors: SerializedAnchor[]
  forkKey?: ForkPathKey                       // trace only — present solely on actionable root-terminated forks (S-R3.10)
}

type SerializedRenderDoc = { template: unknown /* TemplateData */; content: unknown[] /* ContentPayload[] */; clientConfig: { adapter: string; persistence: boolean } }
```

`serializeSlice(node, kids, clientConfig?)` accepts an optional
`{ adapter, persistence }` (the translated legacy `run*`-gate mapping is
preserved); the default is `{ adapter: 'dom', persistence: false }`. Node
**handlers are runtime-only** — function bodies are not JSON-safe (SER-F1)
and never appear in the doc; they survive on the live tree (see handlers.md).

Round-trip rules:

| # | Rule |
| --- | --- |
| SER-R1 | `serialize(compile(node))` → NodeSchema JSON → parse → compile MUST yield equal render-relevant state (props/css/content/type/children order/anchor roles+targets) |
| SER-R2 | Live `Node` anchor targets serialize as their `NodeRef` — possible by construction (unique IDs at creation, S3.1) |
| SER-R3 | Fork states de-duplicate and serialize via node IDs **plus path-key traces** — no phantom coalescing (S3.1) |
| SER-R4 | Dropped fork arms contribute **nothing** to the serialized actionable set (notes §10.8.4) |
| SER-R5 | SSR/full-snapshot and client hydrate consume **the same format** (notes §10.6) |

---

## 6. Forked compiled states (notes §10.8.2, notes §10.8.4, S-R2.5, S-R3.3, S-R3.10)

Pass 2 forks when several sources/placements share a `referenceName`; each
candidate resolution is a separate compiled state **keyed by its path back to
the root** (`root/a/b/…`, notes §10.8.4).

| Arm termination | Actionable? | Rendered? | Log |
| --- | --- | --- | --- |
| root node (`'rootNode'` chain) | **yes** | yes — path-key material, `forkKey` trace serialized | — |
| component prototype | no | dropped, **zero ops, zero serialized state** | silent |
| `contentNodes` array | no (not-in-tree, S1.1) | dropped silently | silent |
| loop | no | dropped | **`circular-source` warning** (S-R2.5) |
| N arms, all root-terminated | N actionable | **all N render as multiple valid states** — a coerced pick is NEVER synthesized (notes §10.8.2/§10.8.4) | — |

Depth-0 rule (S4.1/S-R2.6): a node carrying a source/`duplex` anchor for the
`referenceName` resolves **at itself before any upward walk**; nearest source
shadows farther ones.

Renderer input set = actionable forks only. Fork path-keys are material
**only** for actionable root-terminated forks (S-R3.10). Fork-key collision
with differing content = hard error (never coalesce, S3.1); identical
re-derived forks de-dupe by node IDs.

---

## 7. SSR flow & client re-resolution (S4.2)

1. Server runs the **same resolve-on-anchors pipeline** (same two-phase
   compile, same fork rules) with the SSR adapter → emits HTML string into the
   mount element (replaces legacy `renderToString`/`ssrResult`, notes §6.9).
2. Server serializes compiled state → the `preempt-initial-data` JSON doc
   (§5). SSR HTML and the JSON doc describe the **same** resolved state.
3. Client boot: parses `preempt-initial-data`; `hydrate(rootWire, vdom)`
   reuses SSR DOM via the `css.id` `getElementById` seam (notes §5.1) and binds
   wires/listeners.
4. **Client re-resolves from the serialized anchors — it re-runs the same
   pipeline** (S4.2). Shipped anchors are *inputs*, not conclusions; shipped
   fork traces are de-dup hints, never materialization instructions. The
   client MUST NOT materialize shipped forks blindly.
5. On hydrate mismatch (SSR HTML vs client re-resolution): the **client
   re-resolution is canon**; the mismatched slice re-renders through the
   normal op path (§3 diff). *(derived from S4.2)*

---

## 8. Client/SSR parity

| Invariant | Statement |
| --- | --- |
| PAR-1 | Same pipeline, same `compile(slice)`, same fork/disposition rules on both sides (notes §10.6, S4.2) |
| PAR-2 | Same serialized formats both directions (SER-R5) |
| PAR-3 | Only config differences: **which adapter** + **whether persistence runs** (notes §10.6) |
| PAR-4 | Server-only fragments dropped permanently — no SSR-only render path survives (notes §8.2) |
| PAR-5 | Same input state ⇒ structurally equal output: server HTML ≡ client DOM after hydrate + re-resolution |

---

## 9. What the renderer never sees

| # | Never | Basis |
| --- | --- | --- |
| NVS-1 | A coerced/arbitrary pick among ambiguous forks | notes §10.8.4 — "a coerced pick is never synthesized" |
| NVS-2 | Dropped-arm residue: no ops, no tombstones, no serialized state from non-actionable arms | notes §10.8.4, SER-R4 |
| NVS-3 | `'prototype'` / `'unplaced'` / `'destroyed'` nodes as render targets — compile of not-in-tree returns **no usable state** | S1.1 |
| NVS-4 | Unresolved component **targets as renderable bound values** — the unresolved binding is simply absent and flagged (`unresolved-reference` status); the node itself still renders **its own state** with a logged warning (viable compile, S-R4.3) | notes §10.8.2, S-R4.3 |
| NVS-5 | Live object graphs / in-object proxies — only first-class JSON docs, anchors as typed refs | notes §10.6, `arch_review.md` D4 |
| NVS-6 | Partial batches / mid-op walk results — emits follow the completed sweep only | R-ORD-1..5 |
| NVS-7 | Server-only fragment forms | PAR-4 |

Only **explicit named states** reach the adapter: `'in-tree'` actionable
compiled slices, each either unforked or carrying an actionable `forkKey`.

---

## 10. Exhaustiveness gate — states & fail-states for TestWriter

### 10.1 Serialization round-trip (notes §10.6, `arch_review.md` D4)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| SER-H1 | in-tree node, anchors covering every target kind (`Node`→NodeRef, `'rootNode'`, `'component'`, `'contentNodes'`, referenceName token) | round-trips per SER-R1 |
| SER-H2 | actionable fork with `forkKey` trace | round-trips incl. trace; de-dupes on node IDs (SER-R3) |
| SER-F1 | non-JSON value in props/content (function, cycle, symbol) | serialization error; nothing emitted or shipped |
| SER-F2 | round-trip mismatch (parse∘serialize compiles ≠ original) | hard failure — contract violation |
| SER-F3 | serialized doc carries a live object/proxy instead of a typed ref | rejected at the schema boundary |
| SER-F4 | dropped-arm state present in the serialized actionable set | MUST NOT occur (SER-R4) |
| SER-F5 | snapshot doc ≠ `preempt-initial-data` envelope / NodeSchema shape | rejected |
| SER-F6 | `clientConfig` carrying anything beyond adapter + persistence flags | rejected (S4.3 parked) |

### 10.2 Fork keys, collisions, non-actionable dropping

| ID | State / fail-state | Expected |
| --- | --- | --- |
| FRK-H1 | single source for a `referenceName` | one actionable state, no fork |
| FRK-H2 | N sources, all root-terminated | N actionable states, **all render**; distinct path keys |
| FRK-H3 | `duplex`/self-source present | depth-0 self-resolution before any walk (S4.1/S-R2.6) |
| FRK-F1 | arm terminates at component prototype | silent drop: zero ops, zero serialized state |
| FRK-F2 | arm terminates at `contentNodes` | silent drop (not-in-tree, S1.1) |
| FRK-F3 | looped arm | drop + `circular-source` warning; sibling actionable arms still render |
| FRK-F4 | fork-key collision with differing content | hard error — no phantom coalescing (S3.1) |
| FRK-F5 | identical fork re-derived | de-duped by node IDs + path-key trace |
| FRK-F6 | ambiguous-but-terminating set | surfaces as multiple valid states; assert no arbitrary pick (NVS-1) |

### 10.3 SSR/client divergence

| ID | State / fail-state | Expected |
| --- | --- | --- |
| SSR-H1 | same input through server and client | structural equality (PAR-5) |
| SSR-H2 | hydrate over SSR HTML | DOM reused via the functional `css.id` seam (adapters.md §3.6 — the matched `mount.querySelector('[id="<css.id>"]')` element is targeted, not re-created); listeners bound |
| SSR-H3 | client after hydrate | re-resolves from serialized anchors; result = its own compile (S4.2) |
| SSR-F1 | shipped fork treated as materialization | ignored; client re-resolution is canon |
| SSR-F2 | hydrate mismatch (HTML vs re-resolution) | client wins; mismatched slice re-emitted via §3 diff |
| SSR-F3 | server-only fragment in output | MUST NOT exist (PAR-4) |
| SSR-F4 | adapter behaviors diverge from §2 table for same op | parity failure |

### 10.4 Render emit ordering vs dirty sweep

| ID | State / fail-state | Expected |
| --- | --- | --- |
| ORD-H1 | `state-slice` applied | pass 1 sync; pass 2 in the single tick sweep; emit after sweep (R-ORD-1..3) |
| ORD-H2 | multiple ops in one tick | one coalesced sweep, one emit batch (R-ORD-2) |
| ORD-H3 | anchor-adding effect / new layer mid-batch | anchors populated in the sweep, idempotently (R-ORD-4, S-R3.12) |
| ORD-H4 | node-local update, unchanged props | no `set` ops for unchanged names (D4) |
| ORD-H5 | one emit batch with nested nodes | actionable `next` is root-first — every node's `create` precedes its descendants' `create` (R-ORD-8) |
| ORD-F1 | emit attempted before sweep completion | impossible; slice locked until final resolution (R-ORD-3/5) |
| ORD-F2 | nested emission on active slice | deferred to microtask; depth cap trips loops (R-ORD-7) |
| ORD-F3 | `append` before `create` of same child | never emitted (R-ORD-6) |
| ORD-F4 | `remove` + re-`create` of one wire in a batch | `remove` strictly precedes `create` (R-ORD-6) |
| ORD-F5 | `unlock` before all forks emitted/dropped | rejected (S2.3) |
| ORD-F6 | more than one `styles` op per sweep | coalesced to one (R-ORD-6) |

### 10.5 Two-scope + renderer-never-sees assertions

| ID | State / fail-state | Expected |
| --- | --- | --- |
| SCOPE-1 | bootstrap / reconcile | root-out deep compile; full op stream + `hydrate` vdom |
| SCOPE-2 | handler/`ClientAPI.apply` update | node-local compile; minimal-element diff ops only; no full walk |
| SCOPE-3 | node-local bounded pass 2 | reads ancestor chain only |
| SCOPE-4 | both scopes | same `compile(slice)` primitive, entry-point parameter only |
| NVS-T1..T7 | one assertion test per §9 row NVS-1..NVS-7 | renderer input set contains none of the forbidden forms |
