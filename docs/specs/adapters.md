# Spec — Concrete Render Adapters: `src/core/adapters.ts` + `src/core/render-helpers.ts`

Canon: `RENDER_PROCESS_NOTES.md` §6.8 (SSR fragment descriptor `{ openTag, closeTag,
contentText, isVoid }`; handlers inlined `on…="…"`), §6.9 (styles block prefixed into
the SSR result), §5.1 (hydration `css.id` seam), §2.2 (`preempt-initial-data` envelope),
§8.2 (parity — no SSR-only render path survives), §10.6 (Pillar F), and
`docs/specs/render.md` §2 (`RenderAdapter` interface + method-semantics table), §3
(`RenderOp` / `MinimalElement` / diff rules D1–D5), §5 (serialization), §7 (SSR flow),
§8 (parity PAR-1..PAR-5).
De facto reference behavior: `demo/lib/dom-adapter.js` (browser `DomAdapter`, every
branch) and `demo/lib/render-ops.js` (render-helper utilities). Tests already encoding
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
| `create`/`set`/`append`/`remove`/`styles` ops with `NodeRef` wires (optionally a `forkKey`, render.md §3.1) | DOM mutations (DomAdapter) / HTML string (SSRFragmentAdapter) |
| `set` names namespaced verbatim: `prop:*`, `css:*`, `text`, `on:<event>` | attribute / text / style-block / listener decisions (§3, §4) |
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
`forkKey` on an op (render.md §3.1) — see §3/§4.

---

## 2. Module layout decision (DECIDED)

Three modules own the render surface. The existing `src/core/render.ts` is **unchanged**
(render.md §2/§3 — the abstract contract); the two new modules are:

| Concern | Module | Exports |
| --- | --- | --- |
| Abstract `RenderAdapter`, `RenderOp`, `MinimalElement`, `diffMinimal`, `MockAdapter` | `src/core/render.ts` (unchanged) | per contract.md |
| Concrete DOM + SSR adapters, fragment descriptor, void-tag table — the **only** modules that touch `document`/DOM globals / emit HTML strings | `src/core/adapters.ts` (new) | `DomAdapter`, `SSRFragmentAdapter`, `FragmentDescriptor`, `VOID_TAGS`, `DomAdapterOptions` |
| Adapter-neutral op decoding: compiled state → `MinimalElement`; op stream → adapter calls; op stream → structural tree (parity) | `src/core/render-helpers.ts` (new) | `minimalFromState`, `applyOps`, `treeFromOps`, `treeSig`, `jsonClone`, `MinimalElementSource`, `RenderTree` |

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
forwards the op's `forkKey` onto the `createEl`/`setProp`/`removeEl` call) — they never
derive it (pure consumer, R2). Fork-arm emission can produce **two `create` ops for one
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

`treeSig` and `jsonClone` are *(derived)* from `demo/lib/render-ops.js` (the demo exposes
them; the e2e suites re-implement the same signatures locally). Their canonical home is
`render-helpers.ts` so parity tests stop re-deriving them.

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
  mounted; a correct pipeline only re-creates a wire after `remove` (D3, R-ORD-6) — see DOM-F4.
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
| `css:style` | `el.style.cssText = String(val)` | de facto |
| `css:<other>` (any other `css:` sub-name) | `el.setAttribute(key, String(val))` where `key = name.slice(4)` | de facto |
| `on:<event>` | `el.addEventListener(evtName, (domEvent) => { if (this.onEvent) this.onEvent(wire, domEvent) })` where `evtName = name.slice(3)` — dispatch goes through the injected `opts.onEvent`, never a pipeline-coupled direct call | de facto |
| `prop:<name>` | strip prefix: `attr = name.slice(5)`; if `attr === 'value'` and element is `INPUT` or `TEXTAREA` → `el.value = String(val)`; else `el.setAttribute(attr, String(val))` | de facto |
| bare (anything else) | same as `prop:` branch with `attr = name` (the `value` special-case therefore also applies to a bare `value` on `INPUT`/`TEXTAREA`) | de facto |
| any branch with `val === undefined` | **DECIDED drop — not a write, always a remove/reset** (R7): attr-type names (`prop:*`, bare, `css:<other>`) → `el.removeAttribute(attrName)`; `css:id` → `el.id = ''`; `css:classes` → `el.className = ''`; `css:style` → `el.style.cssText = ''`; `text` → `el.textContent = ''` on non-forms, `el.value = ''` on `INPUT`/`TEXTAREA`/`SELECT`; `on:<event>` → **no-op** (no listener-removal channel, PARKED §3.7) | DECIDED (R7) |

The `value` special-case covers **`INPUT`/`TEXTAREA` only** (not `SELECT`) — asymmetric
with the `text` branch, by de facto reference; the asymmetry is intentional and tested
(DOM-H21).

`css:cssDef` does **not** appear in the branch table: as a set-prop name it is
**removed** (R6). cssDefs flow **only** through the `styles` op (R-ORD-6, §3.3);
`minimalFromState` never maps `css.cssDef → css:cssDef` (HLP-H1/H13). If a
`css:cssDef` set still arrives despite that (invalid emit), it is treated as a
`css:<other>` attribute (`el.setAttribute('cssDef', String(val))`) — deterministic, and
marked legacy-unsupported.

### 3.3 `ensureStyles(defs)` / `styles(cssDefs)` — coalescing

| Step | Behavior | Ref |
| --- | --- | --- |
| 1 | First call: `this.stylesEl = document.createElement('style')`, `id = 'preempt-dynamic-styles'`, append to `document.head` | de facto |
| 2 | `this.stylesEl.textContent += '\n' + String(defs)` | de facto |

| 3 | Subsequent calls reuse the SAME element — exactly one `<style id="preempt-dynamic-styles">` exists regardless of how many `styles` ops arrive | de facto |

`styles(cssDefs)` applies `ensureStyles(d)` per entry — the batch-level channel consumed
by `applyOps` for `{ kind: 'styles' }` ops (render.md §3.1; the sweep coalescer emits ≤1
per batch, R-ORD-6).

**Channel ownership (R6, DECIDED):** the `styles` op is the ONLY batch/channel that
emits cssDefs — coalesced ≤1 per batch (R-ORD-6). `minimalFromState` does **not** map
`css.cssDef → css:cssDef` (see §3.2 and HLP-H1); every cssDef flows through `styles` →
`ensureStyles` here (and the SSR styles buffer, §4.5). The "exactly one
`<style id="preempt-dynamic-styles">` element" invariant (notes §6.9) is preserved.

**`applyOps` supersession (R5, DECIDED):** the demo's `applyOps` skips `styles` ops
(`demo/lib/render-ops.js` `case 'styles': break`) — that skip is **superseded**:
render-helpers `applyOps` invokes `adapter.styles?.(cssDefs)` when the adapter exposes
`styles`. `styles` is concrete-adapter-only; it is **not** on the abstract
`RenderAdapter` (render.md §2).

### 3.4 `appendChild(owner, child)`

`owner.appendChild(child)` — plain DOM move semantics; re-appending an already-present
child relocates it (this is what makes D5's re-append-in-order work).

### 3.5 `removeEl(wire, forkKey?)`

`const el = this.wires.get(wireKey(wire, forkKey)); if (el) { el.remove();
this.wires.delete(wireKey(wire, forkKey)) }` — unknown composite key is a silent no-op (de
facto; DOM-F3). With a `forkKey` present on the op, only that arm is removed; the other
arms' elements stay mounted.

### 3.6 `hydrate(rootWire, vdom)` — the §5.1 seam

`rootWire` is unused. Walks `[vdom.template, ...(vdom.content ?? [])]` and adds every
node's `css.id` (when it is a string) to `this.reused` — the de facto demo behavior. The
`css.id` → wire binding that SSR-H2 asserts is established through the normal
`setProp(…, 'css:id', …)` path (the `bound` map in the test `HydrationAdapter`,
`tests/unit/render.test.ts`), which the test-level adapter tracks; the concrete
`DomAdapter` exposes `reused` + `wires` so the same assertion is expressible without a
separate `bound` map.

### 3.7 Decided fail-states (the demo does not specify these)

| Decision | Statement | Rationale |
| --- | --- | --- |
| `DECIDED` missing-wire `setProp`/`removeEl` | silent no-op | The de facto demo returns silently; R-ORD-6 + `applyOps` cross-batch resolution make a missing wire unreachable on a correct emit; throwing would couple the pure consumer to pipeline ordering (DOM-F1/F3) |
| `DECIDED` no-`document` environment | `constructor` throws a descriptive error (`DomAdapter requires a DOM (document) environment`) when `typeof document === 'undefined'` | Fail-fast once at the boundary; per-call branches stay branch-free like the demo (DOM-F2) |
| `DECIDED` duplicate `createEl` | last-write-wins overwrite of `wires` | De facto `Map.set`; the caller must `remove` first per D3 (DOM-F4) |
| `PARKED` repeated `setProp` on the same `on:<event>` | additive listener per set (de facto) | A listener-dedupe registry is state the pure consumer does not hold; D4 only re-emits changed names, so the normal path never double-binds (DOM-F5) |

---

## 4. `SSRFragmentAdapter` behavior contract

The SSR product is the fragment descriptor `{ openTag, closeTag, contentText, isVoid }`
(notes §6.8). The adapter consumes the **same op stream** as `DomAdapter` (PAR-1) and
serializes it to an HTML string. Every branch has a corresponding row in §10.2.

### 4.1 `createEl(type, wire)`

| Step | Behavior | Ref |
| --- | --- | --- |
| 1 | `isVoid = VOID_TAGS.has(type)` | *(derived)* HTML void-elements table |
| 2 | descriptor with `openTag = '<' + type + '>'`, `closeTag = isVoid ? '' : '</' + type + '>'`, `contentText = ''` | de facto §6.8 shape |
| 3 | `this.fragments.set(wire, descriptor)` | de facto analog |
| 4 | return the descriptor | |

Attributes accumulate into an internal ordered `Map<attrName, attrValue>` (first-set
order preserved; a re-set of an existing name **replaces** its value in place); `openTag`
regenerates as `'<'+type+attrs+'>'`. This makes D4 re-`set`s idempotent (no duplicate
attribute strings) *(derived: no demo SSR reference exists; required for D4 correctness)*.

### 4.2 `setProp(wire, name, val)` — attribute/text emission

| Branch (`name`) | Behavior | Ref |
| --- | --- | --- |
| wire not in `this.fragments` | **silent no-op** (mirrors the DOM DECIDED) | DOM-F2 analog |
| `text` | `textContent = escapeText(val)`; materialized `contentText = textContent + childrenHtml` | de facto §6.8 (text into `contentText`) |
| `css:id` | attr `id = escapeAttr(val)` | de facto |
| `css:classes` | attr `class = escapeAttr(Array.isArray(val) ? val.join(' ') : String(val))` | de facto |
| `css:style` | attr `style = escapeAttr(val)` | de facto |
| `css:cssDef` | **not an attribute** — pushed to `this.styles` buffer (§4.5) | de facto §6.9 styles block |
| `css:<other>` | attr `<key> = escapeAttr(val)`, `key = name.slice(4)` | de facto symmetry with §3.2 |
| `on:<event>` | attr `on<event> = escapeAttr(val)` — handler **inlined** | de facto §6.8 "handlers inlined as `on…="…"`" |
| `prop:<name>` / bare | attr `<name> = escapeAttr(val)`, `prop:` prefix stripped | de facto |
| `value` | **no property special-case in string form** — always emitted as the attribute `value="…"` | de facto: `<input value="…">` is valid SSR |

Escaping *(derived: string emission needs deterministic entity encoding)*:
`escapeAttr(v) = String(v)` with `& → &amp;`, `" → &quot;`, `< → &lt;`, `> → &gt;`;
`escapeText(v) = String(v)` with `& → &amp;`, `< → &lt;`, `> → &gt;`. Attribute **names**
are emitted verbatim (names come from the pipeline; invalid names are a validation/Pillar
E concern, not the adapter's).

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

`css:cssDef` sets and `styles(cssDefs)` ops push payloads to `this.styles` (stringified
with `String(val)`, appended in arrival order). `toString()` emits the styles block
**exactly once**, prefixed before the root html (render.md §2 "prefixed into the SSR
result", notes §6.9):

```
<style id="preempt-dynamic-styles">\n<def1>\n<def2></style>
<root html>
```

### 4.6 `removeEl` / `hydrate` / `toString()`

| Method | Behavior | Ref |
| --- | --- | --- |
| `removeEl(wire)` | `this.fragments.delete(wire)` — the fragment no longer contributes to output ("omission from the string pass", render.md §2) | de facto |
| `hydrate(rootWire, vdom)` | **no-op** — the server never hydrates (render.md §2 "n/a") | de facto |
| `toString()` | `stylesPrefix + htmlOf(root)`; `root` = the wire of the **first `createEl`** — deterministic because R-ORD-6 guarantees `create(parent)` precedes `append(parent, child)` so the root is always first *(derived: no demo SSR reference; root detection must be deterministic)* | render.md §2 |

---

## 5. TypeScript `lib` decision (DECIDED)

`src/core/adapters.ts` types `HTMLElement`, `HTMLInputElement`, `HTMLTextAreaElement`,
`HTMLSelectElement`, `Element`, `Document`, `document`, `Event`, `CSSStyleSheet` — none of
which exist under the current `"lib": ["ES2022"]`. **`DECIDED: adapters require tsconfig
`lib: ["ES2022", "DOM"]`** — recorded here (`docs/specs/adapters.md` §5) and folded into
the notes §10.9 ledger; the implementer applies the tsconfig diff in the same commit that
introduces `adapters.ts`.

Exact tsconfig diff (SpecDoc does NOT edit `tsconfig.json`; this is the declared change):

```diff
   "compilerOptions": {
-    "lib": ["ES2022"],
+    "lib": ["ES2022", "DOM"],
```

Scope guard: `"lib": ["DOM"]` is additive and `skipLibCheck` is already true; the change
is confined to the types `adapters.ts` needs. `render.ts` and `render-helpers.ts` must
compile under both configurations (render-helpers.ts touches no DOM globals).

---

## 6. Parity + hydration (cross-ref render.md §7/§8)

| Invariant | Statement | Ref |
| --- | --- | --- |
| PAR-1 | Same pipeline, same `compile(slice)`, same fork/disposition rules on both sides — the only difference is **which adapter** | render.md §8 PAR-1/PAR-3 |
| PAR-5 | Same input state ⇒ structurally equal output: server HTML ≡ client DOM after hydrate + re-resolution | render.md §8 PAR-5 |
| SSR-H2 | `hydrate(rootWire, vdom)` reuses `css.id`-keyed DOM: the `reused` set collects every `css.id` in the doc; wires remain bound via the normal `setProp`/`wires` path | render.md §7.3, notes §5.1 |
| SSR-F2 | On hydrate mismatch, the **client re-resolution is canon**; the mismatched slice re-renders through the normal op path — adapters never bake in their own resolution | render.md §7.5 |
| SSR-F4 | Adapter behaviors must not diverge for the same op — both adapters are pure mappings of the identical `RenderOp` stream | render.md §8/§10.3 SSR-F4 |

The adapter-neutral parity oracle is `treeFromOps` + `treeSig` over the op stream
(render.md §3, `demo/lib/render-ops.js`); the SSR side is additionally checked by parsing
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
| NVA-3 | Make a pipeline decision on missing wires — silent no-op, never throw, never synthesize ops | §3.7 DECIDED |
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
`appendChild` move-semantics, `setAttribute`, `addEventListener`). The TestWriter may
either reuse that shim pattern or request a `jsdom`/`happy-dom` devDependency — a
`package.json` change that the Architect must gate. `SSRFragmentAdapter` and
`render-helpers.ts` need no DOM.

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
| DOM-H12 | `setProp(w, 'css:cssDef', '.x{}')` | exactly one `<style id="preempt-dynamic-styles">` in `document.head`; textContent contains `.x{}` |
| DOM-H13 | multiple `css:cssDef` sets + `styles([...])` | still exactly **one** style element; defs appended in arrival order |
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
| DOM-H24 | `hydrate(rootWire, { template: {css:{id:'a'}}, content:[{css:{id:'b'}},{css:{}}] })` | `reused` = `{'a','b'}`; missing `css.id` ignored |
| DOM-H25 | `styles(['.a{}','.b{}'])` | `ensureStyles` per entry; one style element |
| DOM-F1 | `setProp(unknownWire, 'text', 'x')` | silent no-op (DECIDED); no throw, no element created |
| DOM-F2 | `new DomAdapter(mount)` with `typeof document === 'undefined'` | constructor throws a descriptive error (DECIDED) |
| DOM-F3 | `removeEl(unknownWire)` | silent no-op |
| DOM-F4 | `createEl('div', w)` twice for the same live wire | mapping overwritten (last-write-wins); previous element still mounted |
| DOM-F5 | `setProp(w, 'on:click', f)` twice | two listeners registered (additive — de facto; PARKED dedupe) |

### 10.2 `SSRFragmentAdapter` (FRG-*)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| FRG-H1 | `createEl('div', 'w')` | `{ openTag:'<div>', closeTag:'</div>', contentText:'', isVoid:false }`; registered in `fragments` |
| FRG-H2 | `createEl` for a void tag (`br`, `img`, `input`) | `isVoid:true`, `closeTag:''` |
| FRG-H3 | `setProp(w, 'text', 'hi')` | `contentText === 'hi'` |
| FRG-H4 | `setProp(w, 'css:id', 'k')` | `openTag === '<div id="k">'` |
| FRG-H5 | `setProp(w, 'css:classes', ['a','b'])` | `openTag` contains `class="a b"` |
| FRG-H6 | `setProp(w, 'css:style', 'color:red')` | `openTag` contains `style="color:red"` |
| FRG-H7 | `setProp(w, 'css:cssDef', '.x{}')` | no attribute on `openTag`; `.x{}` in `styles` buffer |
| FRG-H8 | `setProp(w, 'on:click', 'alert(1)')` | `openTag` contains `onclick="alert(1)"` (inlined handler) |
| FRG-H9 | `setProp(w, 'prop:title', 't')` | `openTag` contains `title="t"` (prefix stripped) |
| FRG-H10 | `setProp(w, 'hidden', true)` (bare) | `openTag` contains `hidden="true"` |
| FRG-H11 | `setProp(w, 'value', 'v')` on `input` | `openTag` contains `value="v"` (attribute form; no property special-case) |
| FRG-H12 | attr value `a&b "c" <d> e` | escaped `a&amp;b &quot;c&quot; &lt;d&gt; e` in `openTag` |
| FRG-H13 | text `a < b & c > d` | `contentText === 'a &lt; b &amp; c &gt; d'` |
| FRG-H14 | `appendChild(owner, child)` | `owner.contentText` ends with `child.openTag + child.contentText + child.closeTag` |
| FRG-H15 | deep nesting (3+ levels) | full html string correct at every level |
| FRG-H16 | `toString()` after a full render | `'<style id="preempt-dynamic-styles">' + styles + '</style>'` prefix, then root fragment html; root = first-created wire |
| FRG-H17 | multiple cssDef / styles ops | single styles prefix block; defs in arrival order |
| FRG-H18 | `removeEl(w)` | wire gone from `fragments`; absent from `toString()` |
| FRG-H19 | `hydrate(rootWire, vdom)` | no-op — no state change, no throw |
| FRG-H20 | `text` / children on a void fragment | output html is `openTag` only; content ignored |
| FRG-F1 | `appendChild(voidOwner, child)` | child serialization ignored in output (void html = openTag only) |
| FRG-F2 | `setProp(unknownWire, 'text', 'x')` | silent no-op |
| FRG-F3 | duplicate `createEl` same wire | mapping overwritten (last-write-wins) |
| FRG-F4 | `on:<event>` with a non-string value (function) | rendered via `String(val)` (deterministic); SSR handler values are required to be strings by the emit side — callable-handler serialization is a handlers.md concern (PARKED) |

### 10.3 render helpers (HLP-*)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| HLP-H1 | `minimalFromState(cs)` with props/css/content/children | `props` → `prop:*`, `css` → `css:*`, content → `text`, `childOrder` = `[...children]` |
| HLP-H2 | `minimalFromState(cs)` with `content === undefined` | no `text` prop |
| HLP-H3 | `minimalFromState(cs)` with no css | no `css:*` props |
| HLP-H4 | `applyOps(adapter, ops)` full batch (create/set/append/remove) | adapter calls recorded in op order; resulting tree correct |
| HLP-H5 | `applyOps` append/remove where owner/child comes from a **previous** batch | resolved from `adapter.wires` (persistent map); succeeds |
| HLP-H6 | `applyOps` append/remove where wire is in neither batch nor `adapter.wires` | skipped silently (no call, no throw) |
| HLP-H7 | `applyOps` with a `styles` op | `adapter.styles?.(cssDefs)` invoked; skipped when the adapter has no `styles` |
| HLP-H8 | `treeFromOps(ops)` | tree with `type`/`props`/`children`; `set` ops folded onto props |
| HLP-H9 | `treeFromOps(ops, { skip: (n) => n.startsWith('on:') })` | skipped names excluded from props |
| HLP-H10 | `treeSig(trees)` | canonical JSON signature; equal for structurally-equal trees regardless of `set`-op order |
| HLP-H11 | `jsonClone(v)` | deep clone equal to input, not same reference |
| HLP-H12 | `set` op whose `create` appears later in the stream | props still folded (propVals accumulation is order-independent) |
| HLP-F1 | `applyOps` `remove` for a wire never created | no `removeEl` call |
| HLP-F2 | `treeFromOps` with a `styles` op | ignored; no effect on the tree |

### 10.4 Parity + hydration (PARS-*, cross-ref render.md SSR-H2/F2/F4)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| PARS-H1 | identical op stream through `DomAdapter` and `SSRFragmentAdapter` | SSR `toString()` structure (types, attrs, nesting, text) ≡ DOM tree ≡ `treeSig(treeFromOps(ops))` (PAR-5) |
| PARS-H2 | hydrate over an SSR doc with `css.id`s | `reused` contains every `css.id`; wires bound via `setProp('css:id')`/`wires` (SSR-H2) |
| PARS-H3 | styles across both adapters | SSR emits the styles prefix **once**, before root html — mirrors the single DOM `<style id="preempt-dynamic-styles">` element |
| PARS-F1 | an adapter behavior diverges for the same op | parity failure (SSR-F4) |
| PARS-F2 | adapter expected to resolve on its own (no compile/fork knowledge) | assertion that both adapters are pure consumers — no resolution state, no divergence (SSR-F2 canon: client re-resolution wins) |

### 10.5 TypeScript `lib` (TYP-*)

| ID | State / fail-state | Expected |
| --- | --- | --- |
| TYP-H1 | `adapters.ts` under `lib: ["ES2022","DOM"]` | `tsc --noEmit` passes; `HTMLElement`/`document`/`Event`/`CSSStyleSheet` resolve |
| TYP-F1 | `adapters.ts` under `lib: ["ES2022"]` (no DOM) | TS compile errors on DOM/CSSOM types — the DECIDED change is required |

---

Spec: concrete render-adapter layer — `src/core/adapters.ts` (DomAdapter /
SSRFragmentAdapter / FragmentDescriptor) + `src/core/render-helpers.ts` (minimalFromState
/ applyOps / treeFromOps / treeSig / jsonClone) and the `tsconfig` `lib: ["DOM"]`
decision.
