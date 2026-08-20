# Spec — Concrete Render Adapters: `src/core/adapters.ts` + `src/core/render-helpers.ts`

Canon: `RENDER_PROCESS_NOTES.md` §6.8 (SSR fragment descriptor `{ openTag, closeTag,
contentText, isVoid }`; handlers inlined `on…="…"`), §6.9 (styles block prefixed into
the SSR result), §5.1 (hydration `css.id` seam), §2.2 (`preempt-initial-data` envelope),
§8.2 (parity — no SSR-only render path survives), §10.6 (Pillar F), and
`docs/specs/render.md` §2 (`RenderAdapter` interface + method-semantics table), §3
(`RenderOp` / `MinimalElement` / diff rules D1–D5), §5 (serialization), §7 (SSR flow),
§8 (parity PAR-1..PAR-5).
De facto reference behavior: `src/core/adapters.ts` `DomAdapter` (browser
`DomAdapter`, every branch) and `src/core/render-helpers.ts` (render-helper
utilities — `minimalFromState`/`applyOps`/`treeFromOps`/`treeSig`/`jsonClone`/
`emitElements`). The browser demos import these from `dist/core/*`; no demo-side
render machinery exists. Tests already encoding
the render contract: `tests/unit/render.test.ts` (`MockAdapter`/`HydrationAdapter`,
`minimalFromState`, `applyOps`, `treeFromOps`), `tests/e2e/ssr-render.test.ts`
(SSR-H1..H3, PAR-5 structural parity).

Items not literal in the notes/demo are marked *(derived)* with a one-line rationale.
New decisions are tagged `DECIDED` and are to be folded into §10.9 of the notes on the
next consistency pass. This spec **extends** render.md without contradicting it:
render.md owns the abstract `RenderAdapter` (still implemented by `MockAdapter` in
`src/core/render.ts`); this spec owns the **concrete** DOM/SSR adapters and the
render-helper utilities that decode ops into structures.

---

## 1. Contract overview

The render layer (render.md §3) emits `RenderOp[]` batches (root-out deep compile and
node-local minimal-element diffs, render.md §4) built from `MinimalElement[]`. The
concrete adapters **map ops to a host** — DOM (`HTMLElement`) or an SSR HTML string
(fragment descriptors) — exactly as render.md §2's method-semantics table promises.

| In (from render.md) | Out (this spec) |
| --- | --- |
| `create`/`set`/`append`/`remove`/`styles` ops with `NodeRef` wires (optionally a `forkKey`, render.md §3.1) | DOM mutations (DomAdapter) / HTML string (SSRFragmentAdapter) || `set` names namespaced verbatim: `prop:*`, `css:*`, `text`, `on:<event>` | attribute / text / style-block / listener decisions (§3, §4) |
| `hydrate(rootWire, vdom)` over the serialized doc (§5 SER, render.md §7) | `css.id` reuse seam (notes §5.1) |

**The adapter is a pure consumer.** It holds **no compiled-state knowledge**: it never
runs `compile`, never resolves forks, never reads anchors or serialized state beyond the
`vdom` object passed to `hydrate`, and never mints wires. Every behavior is a function of
the single op it is given (notes §10.6; render.md §1 "pure consumer"). The op-stream
guarantees the adapter may rely on (render.md §3.3): R-ORD-6 (`create(parent)` precedes
`append(parent, child)`; `remove` precedes any re-`create` of the same wire; ≤1 `styles`
op per batch), R-ORD-8 (the actionable `next` array is root-first — every node's `create`
precedes its descendants' `create`), and D1–D5 — where a `set` targets a wire this adapter
created in **this** batch or a **prior** batch: node-local (render.md §4) diffs emit
`set`-only on wires the adapter created earlier, so the adapter's **persistent
`wires`/`fragments` map is the cross-batch resolution contract** (render.md §4, notes
§10.10 in-place render). Fork-arm emissions additionally disambiguate via the optional
`forkKey` on an op (render.md §3.1) — see §3/§4. **P3 §2.2/§4.1 (implemented):** the
`forkKey` is now forwarded on EVERY `emitOne` branch (DEFECT #1 fix, P3 §4.3/§6.5) and
equals the pathKey on every path-state — so path-states are distinct `(wire = pathKey,
forkKey)` entries in the wire table by construction, and placement-path re-renders reuse
elements through the same persistent-map diff.

---

## 2. Module layout decision (DECIDED)

Three modules own the render surface. The existing `src/core/render.ts` is **unchanged**
(render.md §2/§3 — the abstract contract); the two new modules are:

| Concern | Module | Exports |
| --- | --- | --- |
| Abstract `RenderAdapter`, `RenderOp`, `MinimalElement`, `diffMinimal`, `MockAdapter` | `src/core/render.ts` (unchanged) | per contract.md |
| Concrete DOM + SSR adapters, fragment descriptor, void-tag table — the **only** modules that touch `document`/DOM globals / emit HTML strings | `src/core/adapters.ts` (new) | `DomAdapter`, `SSRFragmentAdapter`, `FragmentDescriptor`, `VOID_TAGS`, `DomAdapterOptions` |
| Adapter-neutral op decoding: compiled state → `MinimalElement`; op stream → adapter calls; op stream → structural tree (parity) | `src/core/render-helpers.ts` (new) | `minimalFromState`, `applyOps`, `treeFromOps`, `treeSig`, `jsonClone`, `wireKey`, `MinimalElementSource`, `RenderTree` |

Split rationale *(derived from the constraint "helpers that decode ops into structures are
src/core; DOM/SSR-specific mutation is adapters.ts")*: `adapters.ts` owns every DOM/string
mutation and therefore owns the TypeScript `lib: "DOM"` requirement (§5, DECIDED);
`render-helpers.ts` is pure over `RenderOp`/`MinimalElement` and works against **any**
`RenderAdapter` (including `MockAdapter` and test-local adapters), which is what makes
`treeFromOps`/`treeSig` the adapter-neutral PAR-5 oracle; `render.ts` keeps the abstract
interface so the DOM lib stays out of it.

Exact signatures (authoritative, mirrored in contract.md — `.js` import specifiers per
the ESM contract):

```ts
// src/core/adapters.ts
import type { ForkPathKey, RenderAdapter } from './render.js'
import type { NodeRef } from './types.js'

export interface FragmentDescriptor {
  openTag: string          // '<div id="x">' — regenerated from type + attr map on each setProp (R9)
  closeTag: string         // '</div>' or '' for void
  contentText: string      // escaped text + serialized children, in emit order
  isVoid: boolean
}
// R9: the ordered attr Map and the childrenHtml/state are PRIVATE fields on the
// descriptor (an internal SSRFragmentState), NOT part of the public shape above.

export const VOID_TAGS: ReadonlySet<string>   // area base br col embed hr img input link meta param source track wbr (derived: HTML void elements)

export interface DomAdapterOptions {
  onEvent?: (wire: NodeRef, event: Event) => void   // injected dispatch point for on:* bindings
}

export class DomAdapter implements RenderAdapter<HTMLElement, Document> {
  readonly wires: Map<string, HTMLElement>    // key = wireKey(wire, forkKey): a (NodeRef, forkKey) composite — the persistent wire map applyOps consults (R12)
  readonly reused: Set<string>                // css.ids collected by hydrate (§5.1 seam)
  constructor(mount: HTMLElement, opts?: DomAdapterOptions)   // throws if no global `document` (DOM-F2)
  createEl(type: string, wire: NodeRef, forkKey?: ForkPathKey): HTMLElement
  setProp(wire: NodeRef, name: string, val: unknown, forkKey?: ForkPathKey): void
  appendChild(owner: HTMLElement, child: HTMLElement): void
  removeEl(wire: NodeRef, forkKey?: ForkPathKey): void
  hydrate(rootWire: NodeRef, vdom: unknown): void
  styles(cssDefs: unknown[]): void            // batch-level styles-op channel (see §3); NOT on the abstract interface (R5)
}

export class SSRFragmentAdapter implements RenderAdapter<FragmentDescriptor, string> {
  readonly fragments: Map<string, FragmentDescriptor>   // key = wireKey(wire, forkKey): a (NodeRef, forkKey) composite (R2/R12)
  readonly styles: string[]                   // cssDef payloads, emitted as one prefixed block in toString()
  createEl(type: string, wire: NodeRef, forkKey?: ForkPathKey): FragmentDescriptor
  setProp(wire: NodeRef, name: string, val: unknown, forkKey?: ForkPathKey): void
  appendChild(owner: FragmentDescriptor, child: FragmentDescriptor): void
  removeEl(wire: NodeRef, forkKey?: ForkPathKey): void
  hydrate(rootWire: NodeRef, vdom: unknown): void   // no-op: the server never hydrates (render.md §2)
  styles(cssDefs: unknown[]): void            // batch-level styles-op channel (see §4)
  toString(): string                          // stylesPrefix + root fragment html; root = first-created wire (R-ORD-8)
}
```

Both adapters **read `forkKey` off the op they are given** (render-helpers `applyOps`
forwards the op's `forkKey` onto the `createEl`/`setProp`/`removeEl` call — through a
structural cast, since the abstract `RenderAdapter` methods take no `forkKey` param; the
concrete signatures are the authorized superset, contract.md) — they never derive it
(pure consumer, R2). Fork-arm emission can produce **two `create` ops for one
wire in a single batch** (e.g. `tests/e2e/ssr-render.test.ts` asserts two creates for
`dock.id`); the entry key is the composite `wireKey(wire, forkKey)` = `wire` when
`forkKey` is absent, else `wire + '\x00' + forkKey`. Multiple arms stay mounted and
addressable; the last created arm does **not** clobber an earlier arm's entry when the
forkKeys differ (DOM-H26/FRG-H23). `wireKey` is exported from `render-helpers.ts` so
`applyOps`'s cross-batch lookups use the identical composite key.

```ts
// src/core/render-helpers.ts
import type { ForkPathKey, MinimalElement, RenderAdapter, RenderOp } from './render.js'

export interface MinimalElementSource {      // structural subset of CompiledState (types.ts) the reducer needs
  nodeId: string
  type: string
  props?: Record<string, unknown>
  css?: Record<string, unknown>
  content?: unknown
  children?: string[]
}

export interface RenderTree { wire: string; type: string; props: Record<string, unknown>; children: RenderTree[]; forkKey?: ForkPathKey }

export function wireKey(wire: NodeRef, forkKey?: ForkPathKey): string   // composite table key: bare `wire`, or `wire + '\x00' + forkKey` when forkKey present (R2/R12)
export function minimalFromState(cs: MinimalElementSource): MinimalElement  // maps css → `css:*` EXCLUDING `cssDef` (R6 — cssDefs flow via the styles op)
export function applyOps<P, E>(adapter: RenderAdapter<P, E>, ops: RenderOp[]): void  // styles ops invoke adapter.styles?.(cssDefs) — supersedes the demo's skip (R5)
export function treeFromOps(ops: RenderOp[], opts?: { skip?: (name: string) => boolean }): RenderTree[]  // keyed by wireKey(wire, forkKey); fork arms stay distinct (R11)
export function treeSig(trees: RenderTree[]): string  // canonical wire-agnostic JSON signature; sorted object keys = stable under set-op order; includes forkKey when present (R4/R11)
export function jsonClone<T>(v: T): T                          // JSON.parse(JSON.stringify(v)) deep clone
```

`treeSig`, `jsonClone`, `minimalFromState`, `applyOps`, `treeFromOps`, and
`emitElements` live in `src/core/render-helpers.ts` (canonical home; the browser
demos and parity tests import them from there).

---

## 3. `DomAdapter` behavior contract

Replicates `demo/lib/dom-adapter.js` branch-by-branch. "De facto" = identical to the
demo. Rows: every branch below has a corresponding row in §10.1.

### 3.1 `createEl(type, wire, forkKey?)`

| Step | Behavior | Ref |
| --- | --- | --- |
| 1 | `document.createElement(type)` | de facto |
| 2 | `el.dataset.wire = wire` (the **base** wire even for fork arms) | de facto |
| 3 | `this.wires.set(wireKey(wire, forkKey), el)` — table key is the composite `(NodeRef, forkKey)`; absent `forkKey` ⇒ bare wire | de facto + R2 |
| 4 | `this.mount.appendChild(el)` — new elements attach to the mount immediately | de facto |
| 5 | return `el` | de facto |

- Duplicate create for the **same `(wire, forkKey)`** **overwrites** the `wires` mapping
  (last-write-wins, `Map.set` semantics — de facto). The previously created element stays
  mounted; a correct pipeline only re-creates a wire after `remove` (D3, R-ORD-6) — the
  re-create rule operates per `(wire, forkKey)` composite, so two arms of one wire in a
  batch never collide — see DOM-F4/DOM-H26.
- Fork arms share one wire ref but carry **different** forkKeys: each is a **distinct**
  entry — the last created arm does **not** clobber the earlier arm's entry (DOM-H26);
  both stay mounted and addressable by their forkKey.
- Tag-match reuse (legacy notes §6.8) is **not** performed here — **PARKED** (§3.7);
  DOM reuse happens through the `css.id` hydration seam (§6 / §3.6), keeping `createEl`
  pure and matching the demo. render.md §2 mirrors this (R3).

### 3.2 `setProp(wire, name, val, forkKey?)` — namespace dispatch

`el` resolves via `wireKey(wire, forkKey)` — the `forkKey` is read off the op (R2). A
`set` carrying a `forkKey` targets **only that arm** (DOM-H27); a `set` with no `forkKey`
targets the `(wire, undefined)` entry. If that composite key is not in `this.wires`, the
first row applies.

| Branch (`name`) | Behavior | Ref |
| --- | --- | --- |
| `wireKey(wire, forkKey)` not in `this.wires` | **silent no-op** (DECIDED, §3.7) | de facto (returns) |
| `text` + `TEXTAREA`/`INPUT`/`SELECT` | focus-safe value write: `if (el.value !== String(val)) el.value = String(val)` — **never** replaces the node, never writes `textContent` on a form control | de facto |
| `text` + any other element | `el.textContent = String(val)` | de facto |
| `css:id` | `el.id = String(val)` | de facto |
| `css:classes` | `el.className = Array.isArray(val) ? val.join(' ') : String(val)` | de facto |
| `css:style` | `el.style.cssText = String(val)` — **boundary contract (D3, 2026-08-14 — SPEC-ENCODED, fix pass PENDING; expect RED):** values arriving here are ALWAYS strings. Legacy `css.style` OBJECTS (`Record<string,string>`) are serialized to kebab-case `k: v;` CSS strings by translate (translate.md §2); an object reaching this branch is a translate-side defect — the adapter still `String(val)`s it deterministically but that renders `[object Object]` (the live-prod defect class, never to be re-created by a correct pipeline) | de facto |
| `css:<other>` (any other `css:` sub-name) | `el.setAttribute(key, String(val))` where `key = name.slice(4)` | de facto |
| `on:<event>` | **RETAINED HANDLER MAP (2026-08-20 — the listener-removal un-park, docs/specs/retained-handler-map-review.md):** attach = `el.addEventListener(evtName, handler)` where `handler` is a NAMED closure storing the EXACT function reference in the retained map keyed `wireKey(wire, forkKey)` × `evtName` — **REPLACE semantics** (a re-set of the same slot removes the previous exact listener first, then rebinds; one slot never accumulates — the superseded DOM-F5 additive contract); `val === undefined` = real detach — `el.removeEventListener(evtName, retained.fn)` + map delete (the R7 drop row, now honored: DOM/SSR converge); dispatch still goes through the injected `opts.onEvent`, never a pipeline-coupled direct call — the adapter stays the DOM-only page-side seam (**2026-08-20 Phase A parallel path:** the engine entry `supervisor.dispatchEvent(target, event, ...args)` — handlers.md §3 — is a separate, host-callable path into the same bodies; onEvent and the engine entry are independent of each other) | de facto + retained-handler-map (DOM-F5-flip, F6..F12) |
| `prop:<name>` | strip prefix: `attr = name.slice(5)`; if `attr === 'value'` and element is `INPUT` or `TEXTAREA` → `el.value = String(val)`; else `el.setAttribute(attr, String(val))` | de facto |
| bare (anything else) | same as `prop:` branch with `attr = name` (the `value` special-case therefore also applies to a bare `value` on `INPUT`/`TEXTAREA`) | de facto |
| any branch with `val === undefined` | **DECIDED drop — not a write, always a remove/reset** (R7): attr-type names (`prop:*`, bare, `css:<other>`) → `el.removeAttribute(attrName)`; `css:id` → `el.id = ''`; `css:classes` → `el.className = ''`; `css:style` → `el.style.cssText = ''`; `text` → `el.textContent = ''` on non-forms, `el.value = ''` on `INPUT`/`TEXTAREA`/`SELECT`; `on:<event>` → **real detach** (`removeEventListener(evtName, retained.fn)` + map delete — the 2026-08-20 retained-handler-map un-park; the old "no listener-removal channel" no-op is superseded by §3.7) | DECIDED (R7) + retained-handler-map (2026-08-20, DOM-F6) |

The `value` special-case covers **`INPUT`/`TEXTAREA` only** (not `SELECT`) — asymmetric
with the `text` branch, by de facto reference; the asymmetry is intentional and tested
(DOM-H21).

`css:cssDef` does **not** appear in the branch table: as a set-prop name it is
**removed** (R6). cssDefs flow **only** through the `styles` op (R-ORD-6, §3.3);
`minimalFromState` never maps `css.cssDef → css:cssDef` (HLP-H1/H13). If a
`css:cssDef` set still arrives despite that (invalid emit), it is treated as a
`css:<other>` attribute (`el.setAttribute('cssDef', String(val))`) — deterministic, and
marked legacy-unsupported.

### 3.3 `ensureStyles(defs)` / `styles(cssDefs)` — coalescing + dedup

| Step | Behavior | Ref |
| --- | --- | --- |
| 1 | First call: `this.stylesEl = document.createElement('style')`, `id = 'preempt-dynamic-styles'`, append to `document.head` | de facto |
| 2 | **Rule-string contract (D4, 2026-08-14 — SPEC-ENCODED, fix pass PENDING; expect RED):** every payload entry is a RULE STRING `{selector}{serialized styles}` generated by the emit side (render.md §3.4.1 STL-1) — never a raw cssDef object. `this.stylesEl.textContent += '\n' + String(defs)` | de facto + D4 |

| 3 | Subsequent calls reuse the SAME element — exactly one `<style id="preempt-dynamic-styles">` exists regardless of how many `styles` ops arrive | de facto |

| 4 | **Rule-signature dedup (D4 — SPEC-ENCODED, fix pass PENDING; expect RED):** the adapter keeps a per-adapter-instance dedup set of emitted rule strings — a rule whose exact signature was already appended is SKIPPED (never emitted twice across the whole render). Mirrors the emit-side dedup (render.md STL-2) as the adapter boundary's defensive half; identical rules from different nodes collapse to one. **Zero-rule contract (F11):** the emit side never sends a `styles` op with an empty rule list (a cssDef-less render emits NO `styles` op at all — render.md STL-4) — so the style element/prefix only ever exists when ≥1 deduped rule was emitted | D4, live-prod/placeholderLanding/FINDINGS.md; F11 |

`styles(cssDefs)` applies `ensureStyles(d)` per entry — the batch-level channel consumed
by `applyOps` for `{ kind: 'styles' }` ops (render.md §3.1; the sweep coalescer emits ≤1
per batch, R-ORD-6).

**Channel ownership (R6, DECIDED):** the `styles` op is the ONLY batch/channel that
emits cssDefs — coalesced ≤1 per batch (R-ORD-6). `minimalFromState` does **not** map
`css.cssDef → css:cssDef` (see §3.2 and HLP-H1); every cssDef flows through `styles` →
`ensureStyles` here (and the SSR styles buffer, §4.5). The "exactly one
`<style id="preempt-dynamic-styles">` element" invariant (notes §6.9) is preserved.

**`applyOps` supersession (R5, DECIDED):** the earlier demo-side `applyOps`
skipped `styles` ops (`case 'styles': break`) — that skip is **superseded**:
`render-helpers.ts` `applyOps` invokes `adapter.styles?.(cssDefs)` when the
adapter exposes `styles`. `styles` is concrete-adapter-only; it is **not** on
the abstract
`RenderAdapter` (render.md §2).

### 3.4 `appendChild(owner, child)`

`owner.appendChild(child)` — plain DOM move semantics; re-appending an already-present
child relocates it (this is what makes D5's re-append-in-order work).

### 3.5 `removeEl(wire, forkKey?)`

`const el = this.wires.get(wireKey(wire, forkKey)); if (el) { el.remove();
this.wires.delete(wireKey(wire, forkKey)) }` — unknown composite key is a silent no-op (de
facto; DOM-F3). With a `forkKey` present on the op, only that arm is removed; the other
arms' elements stay mounted.

### 3.5b `beginBatch()` / `endBatch()` — the DETACHED INITIAL-BUILD batch (A, 2026-08-16)

`beginBatch()` opens a detached build: created elements are HELD BACK from the live
mount (`createEl` pushes them into a pending set instead of `mount.appendChild`);
`appendChild` re-parents them under their owners (removing the child from the pending
set — a re-parented element is no longer a root candidate); `removeEl` clears a batch
element from the pending set too (a create+remove within one batch — the re-type
shape — must not mount the removed element). `endBatch()` mounts ONLY the roots
(elements never re-parented by an append op) in creation order and restores the
immediate-attach behavior (DOM-H1 path). Every demo page's INITIAL render wraps its
single `applyOps` call in the pair — the ops nest the whole tree inside the batch, so
the first render performs ONE live-tree attachment per root instead of the
create-then-move churn (every element was previously mount-appended at creation and
then MOVED under its owner by the append op — 4095 useless live attachments on a
4095-element first render, each triggering the browser's incremental style machinery).
Non-batched calls are unchanged; the pair is one-shot (a `beginBatch` while one is
open resets the pending set). Tests: tests/unit/adapters.test.ts DOM-B1..B4.

### 3.6 `hydrate(rootWire, vdom)` — the §5.1 seam

`rootWire` is unused. Hydration keeps the DOM/reused state consistent so a later
`setProp(wire, 'css:id', id)` with a matching id can **discover and mark-as-reused**
content (R3):

1. Walk `[vdom.template, ...(vdom.content ?? [])]` and add every node's `css.id` (when it
   is a string) to `this.reused` — the de facto demo behavior.
2. **Reuse validation seam (R3, DECIDED):** whenever the environment supplies a real
   `document`/`mount.querySelector` (demo/browser — the unit harness's `El` shim covered
   in §9 does not), validate each collected id against the mount:
   `mount.querySelector('[id="<css.id>"]')` must resolve. Hydration-driven reuse means the
   DOM **already contains** the element, so the adapter will **not re-create** it: the
   matched element is the one the later `setProp(wire, 'css:id', id)` targets (that
   `setProp` writes `el.id = val` on an element that already carries the id — a bind, not
   a new node). When `document` is absent the seam degrades to step 1 only (no validation,
   no throw).

The `css.id` → wire binding that SSR-H2 asserts is established through the normal
`setProp(…, 'css:id', …)` path (the `bound` map in the test `HydrationAdapter`,
`tests/unit/render.test.ts`), which the test-level adapter tracks; the concrete
`DomAdapter` exposes `reused` + `wires` so the same assertion is expressible without a
separate `bound` map.

### 3.7 Decided fail-states (the demo does not specify these)

| Decision | Statement | Rationale |
| --- | --- | --- |
| `DECIDED` missing-wire `setProp`/`removeEl` | silent no-op | The de facto demo returns silently; `applyOps` first attempts cross-batch resolution against the persistent `wires`/`fragments` map (R12/HLP-H5), so a missing wire means no prior create in this or a prior batch. The no-op is **defensive against cross-batch drift**, not an "unreachable" branch (R1/R15): the fail-state tests (DOM-F1/F3, HLP-H6, FRG-F2) deliberately construct missing-wire cases. Throwing would couple the pure consumer to pipeline ordering |
| `DECIDED` no-`document` environment | `constructor` throws a descriptive error (`DomAdapter requires a DOM (document) environment`) when `typeof document === 'undefined'` | Fail-fast once at the boundary; per-call branches stay branch-free like the demo (DOM-F2; NVA-3 is scoped to missing wires and does NOT forbid this throw, R15) |
| `DECIDED` duplicate `createEl` | last-write-wins overwrite of the **`(wire, forkKey)`** entry | De facto `Map.set`; the caller must `remove` first per D3 (DOM-F4). Different forkKeys never collide (DOM-H26) |
| `SUPERSEDED 2026-08-20` repeated `setProp` on the same `on:<event>` | **REPLACE semantics — one listener per slot** (exact-fn removal + rebind; the additive contract and the "dedupe registry is state the pure consumer does not hold" rationale are superseded) | The retained-handler-map is DERIVED/REPLAYABLE adapter state — a pure function of (op stream, `onEvent`), re-derivable on replay/hydrate symmetric to `wires`/`stylesSeen`/`batchEls`; D4 only re-emits changed names, so the pipeline path never double-binds; the flip is a decision record (docs/specs/retained-handler-map-review.md; decisions.md RETAINED-HANDLER-MAP) — DOM-F5-flip |
| `SUPERSEDED 2026-08-20` listener-removal (`on:<event>` set with `undefined`) | `el.removeEventListener(evt, retained.fn)` + map delete — detach (R7 `on:<event>` row) | The retained map keeps the exact function reference the old anonymous-closure pattern did not; the documented DOM/SSR divergence is CLOSED — SSR already dropped the inline attr (§4.2/FRG-H18), DOM now detaches too (DOM-F6) |
| `PARKED` tag-match reuse (legacy notes §6.8) | not performed; DOM reuse is the `css.id` hydration seam (§3.6) | Keeps `createEl` pure and matches the demo; render.md §2 mirrors this (R3) |

---

## 4. `SSRFragmentAdapter` behavior contract

The SSR product is the fragment descriptor `{ openTag, closeTag, contentText, isVoid }`
(notes §6.8). The adapter consumes the **same op stream** as `DomAdapter` (PAR-1) and
serializes it to an HTML string. Every branch has a corresponding row in §10.2.

### 4.1 `createEl(type, wire, forkKey?)`

| Step | Behavior | Ref |
| --- | --- | --- |
| 1 | `isVoid = VOID_TAGS.has(type)` | *(derived)* HTML void-elements table |
| 2 | descriptor with `openTag = '<' + type + '>'`, `closeTag = isVoid ? '' : '</' + type + '>'`, `contentText = ''` | de facto §6.8 shape |
| 3 | `this.fragments.set(wireKey(wire, forkKey), descriptor)` — composite `(NodeRef, forkKey)` key (R2); fork arms stay distinct entries | de facto analog |
| 4 | return the descriptor | |

Attributes accumulate into an internal ordered `Map<attrName, attrValue>` (first-set
order preserved; a re-set of an existing name **replaces** its value in place); `openTag`
regenerates as `'<'+type+attrs+'>'`. This makes D4 re-`set`s idempotent (no duplicate
attribute strings) *(derived: no demo SSR reference exists; required for D4 correctness)*.

**Private side-storage (R9, DECIDED):** the ordered attr map and the
childrenHtml/`contentText` materialization are **private** fields on the descriptor (an
internal `SSRFragmentState`), NOT part of the public
`{ openTag, closeTag, contentText, isVoid }` shape — which stays **exactly** the notes
§6.8 shape. `openTag` is **regenerated from type + the ordered attr map on every
`setProp`**, so the public `openTag` field is always current (FRG-H4/H21); `contentText`
is rematerialized on `text`/`append` from the private text+children state (FRG-H22).

### 4.2 `setProp(wire, name, val, forkKey?)` — attribute/text emission

The fragment resolves via `wireKey(wire, forkKey)` (R2); a `set` with a `forkKey` targets
only that arm's fragment.

| Branch (`name`) | Behavior | Ref |
| --- | --- | --- |
| `wireKey(wire, forkKey)` not in `this.fragments` | **silent no-op** (mirrors the DOM DECIDED) | DOM-F2 analog |
| `text` | `textContent = escapeText(val)`; materialized `contentText = textContent + childrenHtml` | de facto §6.8 (text into `contentText`) |
| `css:id` | attr `id = escapeAttr(val)` | de facto |
| `css:classes` | attr `class = escapeAttr(Array.isArray(val) ? val.join(' ') : String(val))` | de facto |
| `css:style` | attr `style = escapeAttr(val)` — **D3 boundary contract (2026-08-14 — SPEC-ENCODED, fix pass PENDING; expect RED):** values are ALWAYS strings (legacy `css.style` OBJECTS serialize at translate, translate.md §2; an object here is a translate-side defect, deterministic `String(val)` — never a correct-pipeline artifact) | de facto |
| `css:<other>` | attr `<key> = escapeAttr(val)`, `key = name.slice(4)` | de facto symmetry with §3.2 |
| `on:<event>` | attr `on<event> = escapeAttr(val)` — handler **inlined** | de facto §6.8 "handlers inlined as `on…="…"`" |
| `prop:<name>` / bare | attr `<name> = escapeAttr(val)`, `prop:` prefix stripped | de facto |
| `value` | **no property special-case in string form** — always emitted as the attribute `value="…"` | de facto: `<input value="…">` is valid SSR |
| any branch with `val === undefined` | **DECIDED drop** (R7): the attribute is **omitted** from `openTag`, and a previously-set attribute of that name is **removed** from the ordered attr map; `text` with `undefined` → **empty content** (`textContent = ''`, `contentText = childrenHtml`) | DECIDED (R7) — D4 removed-props re-set |

Escaping *(derived: string emission needs deterministic entity encoding)*:
`escapeAttr(v) = String(v)` with `& → &amp;`, `" → &quot;`, `< → &lt;`, `> → &gt;`;
`escapeText(v) = String(v)` with `& → &amp;`, `< → &lt;`, `> → &gt;`. Attribute **names**
are emitted verbatim (names come from the pipeline; invalid names are a validation/Pillar
E concern, not the adapter's).

`css:cssDef` does **not** appear in the branch table — removed (R6, mirrors §3.2):
cssDefs flow only through the `styles` op (§4.5); if a `css:cssDef` set still arrives it
is treated as a `css:<other>` attribute `cssDef="…"` (legacy-unsupported, deterministic).

### 4.3 `appendChild(owner, child)`

`owner.childrenHtml.push(childHtml(child))` then rematerialize `contentText`, where
`childHtml(fd) = fd.openTag + fd.contentText + fd.closeTag`. Nested serialization in
compiled child order (render.md §2 "string concatenation in compiled child order").
A `text` set after appends re-materializes as `textContent + childrenHtml` (text precedes
children in emit order per R-ORD-6/diffMinimal: all `set`s, then `append`s).

### 4.4 Void elements

For an `isVoid` fragment the materialized html is `openTag` **only** — `contentText` and
appended children never appear in output (FRG-H20, FRG-F1). `text` on a void element
mutates state but is ignored at serialization time.

### 4.5 Styles block — emitted once

`styles(cssDefs)` ops push payloads to `this.styles` (stringified with `String(val)`,
appended in arrival order). **Rule-string contract (D4, 2026-08-14 — SPEC-ENCODED, fix pass PENDING; expect RED):** every payload
entry is a RULE STRING `{selector}{serialized styles}` from the emit side (render.md
§3.4.1 STL-1), never a raw cssDef object. **Rule-signature dedup (D4):** the adapter
keeps a per-adapter-instance dedup set — a rule whose exact signature was already
pushed is skipped (never emitted twice across the whole render; identical rules from
different nodes collapse). `css:cssDef` sets do **not** feed this buffer (R6 — removed).
`toString()` emits the styles block **exactly once**, prefixed before the root html
(render.md §2 "prefixed into the SSR result", notes §6.9).

Pinned join formula **(R18, DECIDED)** — a single leading `\n` before each def, defs
joined, no stray trailing newline:

```
stylesPrefix = '<style id="preempt-dynamic-styles">' + defs.map(d => '\n' + String(d)).join('') + '</style>'
```

```
<style id="preempt-dynamic-styles">\n<def1>\n<def2></style>
<root html>
```

The DOM side mirrors the same inner join: `ensureStyles` accumulates
`'\n' + String(defs)` per call, so the single style element's `textContent` is
`'\n<def1>\n<def2>'` (DOM-H12/H13, PARS-H3).

### 4.6 `removeEl` / `hydrate` / `toString()`

| Method | Behavior | Ref |
| --- | --- | --- |
| `removeEl(wire, forkKey?)` | `this.fragments.delete(wireKey(wire, forkKey))` — the fragment no longer contributes to output ("omission from the string pass", render.md §2) | de facto |
| `hydrate(rootWire, vdom)` | **no-op** — the server never hydrates (render.md §2 "n/a") | de facto |
| `toString()` | `stylesPrefix + htmlOf(root)`; `root` = the wire of the **first `createEl`** — deterministic because R-ORD-8 guarantees the actionable array is root-first (every node's `create` precedes its descendants'), so the root is always the first created wire *(derived: no demo SSR reference; root detection must be deterministic; R10)*. If `removeEl` removed the root wire (or no `create` ever ran), `toString()` returns **just the styles prefix** — the `<style id="preempt-dynamic-styles">` block alone, no root html (FRG-H24) | render.md §2 + R10 |

**Floating fragments (DECIDED, §4.6):** after the root subtree, `toString()`
serializes — in **creation order** — every fragment that was **created but never
appended into any parent** (still registered in `fragments`, `parent === null`,
excluding the root itself). Rationale: `DomAdapter.createEl` mounts every created
element at top level, so a `create` with no `append` edge into the root subtree
(e.g. an actionable descendant of a consumed provider, or a fork arm whose parent
wire is not actionable) is still part of the DOM render surface — the SSR string
must reflect the same surface for the same op stream (PAR-5, SSR-F4 class). The
guard: fully-connected streams (every non-root fragment appended) emit **exactly**
`stylesPrefix + htmlOf(root)` — no output change (FRG-H26). A `removeEl`d root
still yields just the styles prefix (FRG-H24); the floating set is computed from
creation order + parent linkage, never reordered by wire.

---

## 5. TypeScript `lib` decision (DECIDED)

`src/core/adapters.ts` types `HTMLElement`, `HTMLInputElement`, `HTMLTextAreaElement`,
`HTMLSelectElement`, `Element`, `Document`, `document`, `Event` — none of which exist under
the current `"lib": ["ES2022"]`. (`CSSStyleSheet` is **not** used by any behavior and is
**not** required.) **`DECIDED: adapters require tsconfig `lib: ["ES2022", "DOM"]`** —
recorded here (`docs/specs/adapters.md` §5) and folded into the notes §10.9 ledger as an
accepted, repo-global change (R16); the implementer applies the tsconfig diff in the same
commit that introduces `adapters.ts`.

Exact tsconfig diff (SpecDoc does NOT edit `tsconfig.json`; this is the declared change):

```diff
   "compilerOptions": {
-    "lib": ["ES2022"],
+    "lib": ["ES2022", "DOM"],
```

Scope guard: `"lib": ["DOM"]` is additive and `skipLibCheck` is already true. The change
is **repo-global — every `src/**` and `tests/**` file compiles under the combined lib**
(this is accepted and recorded in the notes ledger, R16). `render.ts` and
`render-helpers.ts` must compile under **both** configurations (render-helpers.ts touches
no DOM globals).

---

## 6. Parity + hydration (cross-ref render.md §7/§8)

| Invariant | Statement | Ref |
| --- | --- | --- |
| PAR-1 | Same pipeline, same `compile(slice)`, same fork/disposition rules on both sides — the only difference is **which adapter** | render.md §8 PAR-1/PAR-3 |
| PAR-5 | Same input state ⇒ structurally equal output: server HTML ≡ client DOM after hydrate + re-resolution | render.md §8 PAR-5 |
| PAR-6 | Fork arms stay **distinct `(wire, forkKey)` entries on both adapters**; the `treeFromOps`/`treeSig` parity oracle keys by `wireKey(wire, forkKey)` and never collapses arms (R11) | §10.4 PARS-H1 |
| PAR-7 | Root-first emit (R-ORD-8, R10): the actionable `next` array is root-first on both sides, so the SSR `toString()` root = first-created wire ≡ the DOM mount root | render.md §3.3 |
| SSR-H2 | `hydrate(rootWire, vdom)` reuses `css.id`-keyed DOM: the `reused` set collects every `css.id` in the doc (validated against `mount.querySelector` by id when the DOM exists — the seam yields the actual SSR-rendered element, which is never re-created); wires remain bound via the normal `setProp`/`wires` path | render.md §7.3, notes §5.1 |
| SSR-F2 | On hydrate mismatch, the **client re-resolution is canon**; the mismatched slice re-renders through the normal op path — adapters never bake in their own resolution | render.md §7.5 |
| SSR-F4 | Adapter behaviors must not diverge for the same op — both adapters are pure mappings of the identical `RenderOp` stream | render.md §8/§10.3 SSR-F4 |

The adapter-neutral parity oracle is `treeFromOps` + `treeSig` over the op stream
(render.md §3, `src/core/render-helpers.ts`); the SSR side is additionally checked by parsing
its `toString()` output into the same structural tree (type / attribute names+values /
nesting order / text). Hydration reads the `preempt-initial-data`-shaped vdom (§2.2) —
the adapter never interprets `clientConfig` (adapter selection + persistence only,
render.md §5).

---

## 7. What the concrete adapters never do

| # | Never | Basis |
| --- | --- | --- |
| NVA-1 | Run `compile`/`compileRemote`, resolve forks, or read anchors | §1 pure consumer; render.md §1 |
| NVA-2 | Mint or reorder `NodeRef` wires | §1; wires are opaque (S3.1) |
| NVA-3 | Make a pipeline decision on missing wires — silent no-op, never throw, never synthesize ops. **Scoped to missing wires only** (DOM-F1/F3, HLP-H6, FRG-F2 deliberately construct them); it does **not** forbid the documented constructor throw (DOM-F2) | §3.7 DECIDED |
| NVA-4 | Read `clientConfig` or any serialized doc field beyond the `css.id`/content walk in `hydrate` | §1, render.md §5 |
| NVA-5 | Implement hydration resolution — reuse is keyed on `css.id` strings only | §6 SSR-H2/SSR-F2 |
| NVA-6 | Coalesce or drop ops (the sweep/diff owns ordering); the adapter executes what it is given, in order | render.md R-ORD-6 |

---

## 8. Canonical export surface

The authoritative TS signatures for `src/core/adapters.ts` and
`src/core/render-helpers.ts` live in `docs/specs/contract.md` (module table + the two new
`## src/core/adapters.ts` / `## src/core/render-helpers.ts` sections). §2 of this spec
mirrors them; in any drift, contract.md wins for signatures and this file wins for
behavior.

---

## 9. Test-environment note

Unit tests for `DomAdapter` require DOM globals. The repo's vitest env is plain Node
(no jsdom/happy-dom in `package.json` today); the demo smoke harness
(`scripts/demo-smoke.mjs`) already ships a minimal DOM shim (`El` with `tagName`,
`children`, `attrs`, `dataset`, `style`, `listeners`, `textContent`, `className`, `value`,
`appendChild` move-semantics, `setAttribute`, `addEventListener`). The TestWriter should
replicate that shim pattern **and extend it** (R14, DECIDED) with: (a) a satisfiable
`document.head` (the styles-insertion assertion, DOM-H12/H13), and (b) a manual
listener-invocation helper (DOM-H15 dispatch — call the registered listener yourself, the
shim does not run real events). DOM-F2 (the no-`document` tender throw) must be **split
off** from the DOM-presence tests — a separate `describe` that temporarily stubs/removes
the global so the constructor path is exercised without an environment. Alternatively the
TestWriter may request a `jsdom`/`happy-dom` devDependency — a `package.json` change that
the Architect must gate (package.json is untouched by this spec change). `SSRFragmentAdapter`
and `render-helpers.ts` need no DOM.

---

## 10. Exhaustiveness gate — states & fail-states for TestWriter

### 10.1 `DomAdapter` (DOM-*)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| DOM-H1 | `createEl('div', 'w1')` | element created with tag `DIV`; `el.dataset.wire === 'w1'`; `wires.get('w1') === el`; element appended to `mount`; returns el |
| DOM-H2 | `setProp(w, 'text', 'hi')` on a `div` | `el.textContent === 'hi'` |
| DOM-H3 | `setProp(w, 'text', 'hi')` on a `TEXTAREA` | `el.value === 'hi'`; `el` node identity unchanged (never replaced); `textContent` untouched |
| DOM-H4 | `setProp(w, 'text', v)` on an `INPUT` | `el.value === String(v)`; node identity preserved |
| DOM-H5 | `setProp(w, 'text', v)` on a `SELECT` | `el.value === String(v)`; node identity preserved |
| DOM-H6 | `setProp(w, 'text', 42)` (non-string) | `el.textContent === '42'` (String-coerced) |
| DOM-H7 | `setProp(w, 'text', same-value)` on a form element | guard skips the write: `el.value` setter not re-invoked (focus-safe) |
| DOM-H8 | `setProp(w, 'css:id', 'k')` | `el.id === 'k'` |
| DOM-H9 | `setProp(w, 'css:classes', ['a','b'])` | `el.className === 'a b'` |
| DOM-H10 | `setProp(w, 'css:classes', 'x')` (string) | `el.className === 'x'` |
| DOM-H11 | `setProp(w, 'css:style', 'color:red')` | `el.style.cssText === 'color:red'` |
| DOM-H12 | `styles(['.x{}'])` (single `styles` op) | exactly one `<style id="preempt-dynamic-styles">` in `document.head`; `textContent === '\n.x{}'` (leading `\n` pinned by R18) |
| DOM-H13 | multiple `styles([...])` ops (no `css:cssDef` sets) | still exactly **one** style element; defs appended in arrival order with the pinned `'\n<def>'` join — `textContent === '\n.a{}\n.b{}'` |
| DOM-H29 | `styles(['.x{a:b}', '.x{a:b}'])` — the SAME rule string twice (same signature) | dedup (D4 — SPEC-ENCODED, fix pass PENDING; expect RED): appended ONCE — `textContent === '\n.x{a:b}'`; distinct rules append normally; the dedup set is per adapter instance, across ops |
| DOM-H30 | `setProp(w, 'css:style', <object>)` — a raw object at the boundary | deterministic `String(val)` (the `[object Object]` defect class) — the D3 boundary contract requires the pipeline to serialize objects BEFORE the adapter (SPEC-ENCODED — the translate-side serialization is pending the fix pass); the adapter behavior itself is unchanged |
| DOM-H14 | `setProp(w, 'css:data-x', v)` (unknown sub-name) | `el.setAttribute('data-x', String(v))` |
| DOM-H15 | `setProp(w, 'on:click', fn)` with `opts.onEvent` set; dispatch a click | listener registered on `click`; dispatch invokes `opts.onEvent(wire, domEvent)` with the wire and the DOM event |
| DOM-H16 | `setProp(w, 'on:click', fn)` with no `opts.onEvent` | listener registered; dispatch does not throw, no callback invoked |
| DOM-H17 | `setProp(w, 'hidden', true)` (bare name) | `el.setAttribute('hidden', 'true')` |
| DOM-H18 | `setProp(w, 'prop:title', 't')` | `el.setAttribute('title', 't')` — prefix stripped |
| DOM-H19 | `setProp(w, 'prop:value', 'v')` on an `INPUT` | `el.value === 'v'` (property write, no attribute) |
| DOM-H20 | `setProp(w, 'prop:value', 'v')` on a `TEXTAREA` | `el.value === 'v'` |
| DOM-H21 | `setProp(w, 'prop:value', 'v')` on a `div` (and a `SELECT`) | `el.setAttribute('value', 'v')` — special-case is INPUT/TEXTAREA only |
| DOM-H22 | `appendChild(ownerEl, childEl)` | child appended to owner (re-append relocates) |
| DOM-H23 | `removeEl(w)` for a live wire | `el.remove()` called; `wires.has(w) === false` |
| DOM-H24 | `hydrate(rootWire, { template: {css:{id:'a'}}, content:[{css:{id:'b'}},{css:{}}] })` | `reused` = `{'a','b'}`; missing `css.id` ignored; when the mount exposes a working `querySelector` and the elements exist, hydrate records them (reuse seam, §3.6) and creates **no** fresh element for them |
| DOM-H26 | `createEl('div','w')` with `forkKey:'fk1'`, then `createEl('div','w')` with `forkKey:'fk2'` (two creates, same wire, one batch) | **both** elements mounted and addressable; `wires.get(wireKey('w','fk1')) !== wires.get(wireKey('w','fk2'))`; both have `dataset.wire === 'w'`; last arm does **not** clobber the first (R2) |
| DOM-H27 | `setProp(w, 'title', 'a', 'fk1')` after both arms exist | only the `fk1` arm's element changes; the `fk2` arm's element untouched (forkKey-keyed targeting) |
| DOM-H28 | `setProp(w, 'prop:title', undefined)`; `setProp(w, 'css:id', undefined)`; `setProp(w, 'css:style', undefined)`; `setProp(w, 'text', undefined)` on div and on form; then re-`set` each | D4 drop (R7): `prop:title` → `el.removeAttribute('title')`; `css:id` → `el.id === ''`; `css:style` → `el.style.cssText === ''`; `text` on div → `el.textContent === ''`, on `INPUT`/`TEXTAREA`/`SELECT` → `el.value === ''`; re-set after drop works normally |
| DOM-F1 | `setProp(unknownWire, 'text', 'x')` (also unknown `(wire, forkKey)` composite) | silent no-op (DECIDED); no throw, no element created |
| DOM-F2 | `new DomAdapter(mount)` with `typeof document === 'undefined'` | constructor throws a descriptive error (DECIDED; tested in a separate `describe` that stubs the global, §9) |
| DOM-F3 | `removeEl(unknownWire)` (also unknown composite key) | silent no-op |
| DOM-F4 | `createEl('div', w)` twice for the **same `(wire, forkKey)`** | mapping overwritten (last-write-wins); previous element still mounted; different forkKeys never collide (DOM-H26) |
| DOM-F5 | `setProp(w, 'on:click', f)` twice on the same slot | **ONE listener — REPLACE semantics** (the 2026-08-20 retained-handler-map supersedes the additive contract; stale-closure accumulation fixed) |
| DOM-F6 | `setProp(w, 'on:click', f)` then `setProp(w, 'on:click', undefined)` | listener removed (exact-fn `removeEventListener`); dispatch no longer fires; re-set rebinds exactly one (F6b) |
| DOM-F7 | retained listener + `removeEl(w)` | the element's retained listeners are purged before `el.remove()` — the detached element stops firing |
| DOM-F8 | retained listener + duplicate `createEl(w)` | the OLD (still-mounted per DOM-F4) element's listener is purged — the orphaned live element must not keep dispatching |
| DOM-F9 | `on:click` + `on:focus` on one wire | per-event-name slots, independent; removing one keeps the other |
| DOM-F10 | forkKey arms (`w`/`fk1` + `w`/`fk2`) | independent listener state per `wireKey` composite |
| DOM-F11 | listener removes itself during dispatch (`onEvent` → `setProp(undefined)`) | contained; live-array skip semantics (no throw) |
| DOM-F12 | runtime `onclick="true"` attr + a bound listener on the same element | attr slot inert (native string no-op); only the addEventListener slot fires; dropping the listener keeps the attr (SSR double-slot guard) |
| DOM-F12b | reused (hydrated `css.id`) element + `on:<event>` set | binds via the normal `wires` path on the reused element |

### 10.2 `SSRFragmentAdapter` (FRG-*)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| FRG-H1 | `createEl('div', 'w')` | `{ openTag:'<div>', closeTag:'</div>', contentText:'', isVoid:false }`; registered in `fragments` |
| FRG-H2 | `createEl` for a void tag (`br`, `img`, `input`) | `isVoid:true`, `closeTag:''` |
| FRG-H3 | `setProp(w, 'text', 'hi')` | `contentText === 'hi'` |
| FRG-H4 | `setProp(w, 'css:id', 'k')` | `openTag === '<div id="k">'` |
| FRG-H5 | `setProp(w, 'css:classes', ['a','b'])` | `openTag` contains `class="a b"` |
| FRG-H6 | `setProp(w, 'css:style', 'color:red')` | `openTag` contains `style="color:red"` |
| FRG-H7 | `setProp(w, 'css:data-x', v)` (unknown sub-name) | attr `data-x="…"` in `openTag` (mirrors DOM-H14) |
| FRG-H8 | `setProp(w, 'on:click', 'alert(1)')` | `openTag` contains `onclick="alert(1)"` (inlined handler) |
| FRG-H8b | `setProp(w, 'on:click', 'a&b "c" <d>')` (on:* with escapables) | `openTag` contains `onclick="a&amp;b &quot;c&quot; &lt;d&gt;"` — §4.2 `escapeAttr` applies to `on:<event>` values |
| FRG-H9 | `setProp(w, 'prop:title', 't')` | `openTag` contains `title="t"` (prefix stripped) |
| FRG-H10 | `setProp(w, 'hidden', true)` (bare) | `openTag` contains `hidden="true"` |
| FRG-H11 | `setProp(w, 'value', 'v')` on `input` | `openTag` contains `value="v"` (attribute form; no property special-case) |
| FRG-H12 | attr value `a&b "c" <d> e` | escaped `a&amp;b &quot;c&quot; &lt;d&gt; e` in `openTag` |
| FRG-H13 | text `a < b & c > d` | `contentText === 'a &lt; b &amp; c &gt; d'` |
| FRG-H14 | `appendChild(owner, child)` | `owner.contentText` ends with `child.openTag + child.contentText + child.closeTag` |
| FRG-H15 | deep nesting (3+ levels) | full html string correct at every level |
| FRG-H16 | `toString()` after a full render | prefix is **exactly** `'<style id="preempt-dynamic-styles">' + defs.map(d => '\n' + String(d)).join('') + '</style>'` — a single leading `\n` before each def, defs joined, **no stray trailing `\n`** (R18) — then root fragment html; root = first-created wire |
| FRG-H17 | multiple `styles(['.a{}', '.b{}'])` ops (no `css:cssDef` sets) | single styles prefix block; defs in arrival order |
| FRG-H27 | `styles(['.x{a:b}', '.x{a:b}'])` — the SAME rule string twice | dedup (D4 — SPEC-ENCODED, fix pass PENDING; expect RED): pushed ONCE into `this.styles` — `toString()` prefix contains a single `\n.x{a:b}`; per adapter instance, across ops |
| FRG-H18 | `setProp(w, 'hidden', true)` then `setProp(w, 'hidden', undefined)`; `setProp(w, 'text', undefined)` | D4 drop (R7): attr **omitted** from `openTag`, removed from the ordered attr map; `text` `undefined` → `contentText === ''` (empty content) |
| FRG-H19 | `hydrate(rootWire, vdom)` | no-op — no state change, no throw |
| FRG-H20 | `text` / children on a void fragment | output html is `openTag` only; content ignored |
| FRG-H21 | `setProp(w, 'css:id', 'k')` twice | `openTag` identical both times (`<div id="k">`); no duplicate `id="k"` string — D4 idempotency (R8) |
| FRG-H22 | `setProp(w, 'css:id', 'k')` then `setProp(w, 'text', 'hi')` then read `openTag` | `openTag` regenerated from type + attr map, **unchanged** by the text set; `contentText === 'hi'` (R8) |
| FRG-H23 | `createEl('div','w')` with `forkKey:'fk1'`, then `forkKey:'fk2'` (two creates, same wire) | two **distinct** descriptors in `fragments` (`wireKey`-keyed); independent; no clobber (R2) |
| FRG-H24 | `removeEl(rootWire)` then `toString()` | returns **just the styles prefix** — the `<style id="preempt-dynamic-styles">` block alone, no root html (R10) |
| FRG-H25 | root + appended child, PLUS one created-but-never-appended fragment | `toString()` = root html then the floating fragment (creation order, §4.6 DECIDED) — both well-formed |
| FRG-H26 | fully-connected stream (every non-root fragment appended) | `toString()` = `stylesPrefix + htmlOf(root)` exactly — no floating fragments leak (guard, §4.6) |
| FRG-F1 | `appendChild(voidOwner, child)` | child serialization ignored in output (void html = openTag only) |
| FRG-F2 | `setProp(unknownWire, 'text', 'x')` (also unknown composite key) | silent no-op |
| FRG-F3 | duplicate `createEl` for the **same `(wire, forkKey)`** | mapping overwritten (last-write-wins); different forkKeys keep distinct entries (FRG-H23) |
| FRG-F4 | `on:<event>` with a non-string value (function) | rendered via `String(val)` (deterministic); SSR handler values are required to be strings by the emit side — callable-handler serialization is a handlers.md concern (PARKED) |

### 10.3 render helpers (HLP-*)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| HLP-H1 | `minimalFromState(cs)` with props/css/content/children | `props` → `prop:*`, `css` → `css:*` **excluding `cssDef`** (cssDefs flow via the `styles` op, R6), content → `text`, `childOrder` = `[...children]` |
| HLP-H2 | `minimalFromState(cs)` with `content === undefined` | no `text` prop |
| HLP-H3 | `minimalFromState(cs)` with no css | no `css:*` props |
| HLP-H4 | `applyOps(adapter, ops)` full batch (create/set/append/remove) | adapter calls recorded in op order; resulting tree correct; a `forkKey` on an op is **forwarded** to `createEl`/`setProp`/`removeEl` (R2) |
| HLP-H5 | `applyOps` append/remove where owner/child comes from a **previous** batch | cross-batch resolution against the adapter's `wires`/`fragments`-shaped persistent map, probed at runtime with `'wires' in adapter` (structural cast); **succeeds** for adapters exposing such a map, **skipped** (no call) for adapters that do not (R12, mirrors HLP-H6) |
| HLP-H6 | `applyOps` append/remove where wire is in neither batch nor the exposed persistent map | skipped silently (no call, no throw) |
| HLP-H7 | `applyOps` with a `styles` op | `adapter.styles?.(cssDefs)` invoked when the adapter exposes `styles`; skipped otherwise — the demo's skip is **superseded** (R5). Payload entries are RULE STRINGS (render.md §3.4.1 STL-1) — generated by the emit layer from cssDef (D4); `minimalFromState` still never maps `css.cssDef → css:cssDef` (R6) |
| HLP-H8 | `treeFromOps(ops)` | tree with `type`/`props`/`children`; `set` ops folded onto props |
| HLP-H9 | `treeFromOps(ops, { skip: (n) => n.startsWith('on:') })` | skipped names excluded from props |
| HLP-H10 | `treeSig(trees)` | canonical JSON signature via `JSON.stringify` with **sorted object keys** — stable regardless of `set`-op arrival order (R4); includes `forkKey` when present (R11); equal for structurally-equal trees |
| HLP-H11 | `jsonClone(v)` | deep clone equal to input, not same reference |
| HLP-H12 | `set` op whose `create` appears later in the stream | props still folded (propVals accumulation is order-independent) |
| HLP-H13 | `minimalFromState(cs)` with `css.cssDef` present | `cssDef` is **not** mapped to a `css:cssDef` prop — no styles reach the adapter via `set` (R6) |
| HLP-H14 | `treeFromOps` on a forked stream (two `create`s for one wire, distinct `forkKey`s) | two **distinct** `RenderTree` entries keyed by `wireKey(wire, forkKey)`; `treeSig` keeps them distinct — arms never collapse (R11) |
| HLP-H15 | `wireKey('w')` / `wireKey('w', 'fk')` | `'w'` / `'w\x00fk'` — the shared composite key both adapters and `applyOps` use (R2/R12) |
| HLP-H16 | a compiled fork (`Node.compile` → `minimalFromState` → `diffMinimal`) | ops carry **distinct `forkKey`s** per arm (S-R3.10): one `create` per arm with a distinct `forkKey`, and each arm's `set` ops forward the same `forkKey` as its `create` |
| HLP-F1 | `applyOps` `remove` for a wire never created | no `removeEl` call |
| HLP-F2 | `treeFromOps` with a `styles` op | ignored; no effect on the tree |

### 10.4 Parity + hydration (PARS-*, cross-ref render.md SSR-H2/F2/F4)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| PARS-H1 | identical op stream — including **multiple `create`s for one wire with distinct `forkKey`s** and root-first order — through `DomAdapter` and `SSRFragmentAdapter` | SSR `toString()` structure (types, attrs, nesting, text) ≡ DOM tree ≡ `treeSig(treeFromOps(ops))` (PAR-5); **fork arms are preserved as distinct `(wire, forkKey)` entries on both adapters** — `treeFromOps`/`treeSig` must not collapse them (R11); the SSR root = first-created wire ≡ the DOM mount root (R-ORD-8, R10) |
| PARS-H2 | hydrate over an SSR doc with `css.id`s | `reused` contains every `css.id`; wires bound via `setProp('css:id')`/`wires` (SSR-H2) |
| PARS-H3 | styles across both adapters | SSR emits the styles prefix **once**, before root html — mirrors the single DOM `<style id="preempt-dynamic-styles">` element |
| PARS-F1 | an adapter behavior diverges for the same op | parity failure (SSR-F4) |
| PARS-F2 | adapter expected to resolve on its own (no compile/fork knowledge) | assertion that both adapters are pure consumers — no resolution state, no divergence (SSR-F2 canon: client re-resolution wins) |

### 10.5 TypeScript `lib` (TYP-*)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| TYP-H1 | `adapters.ts` under `lib: ["ES2022","DOM"]` | `tsc --noEmit` passes; `HTMLElement`/`document`/`Event` resolve (CSSStyleSheet is not required, R16) |

> **TYP-F1 is NOT part of the vitest matrix** (R13, DECIDED): once the repo-global
> `"DOM"` lib is applied (§5), the negative case — `adapters.ts` under
> `lib: ["ES2022"]` alone — cannot compile inside this repo's config and cannot run under
> vitest/tsc. It is a **one-time build/CI gate**: the PR that adds `"DOM"` to `lib` must
> compile `adapters.ts` under **both** `["ES2022"]` and `["ES2022","DOM"]`, verified once
> by the implementer, not by the unit suite.

---

Spec: concrete render-adapter layer — `src/core/adapters.ts` (DomAdapter /
SSRFragmentAdapter / FragmentDescriptor) + `src/core/render-helpers.ts` (minimalFromState
/ applyOps / treeFromOps / treeSig / jsonClone) and the `tsconfig` `lib: ["DOM"]`
decision.
