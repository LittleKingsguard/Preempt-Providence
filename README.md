# Preempt-Providence

Experimental stack for Preempt frontend — a reactive render engine:
legacy-envelope translate, an anchor-graph `Supervisor`, handlers, and SSR/DOM
render adapters. ESM-only, zero runtime dependencies.

## Install

```sh
npm install provident-ssr
```

## Private pre-release (GitHub Packages)

Before a public release, the engine is published to **GitHub Packages** under
the scoped name `@littlekingsguard/provident-ssr` so it can be tested in the
Electron project without exposing it publicly. A push of a pre-release tag
(`v*-rc.*`, `v*-beta.*`, `v*-alpha.*`) triggers the publish workflow
(`.github/workflows/publish-prerelease.yml`).

To consume the private pre-release in the Electron project, add a `.npmrc`
pointing the scope at GitHub Packages with a read token:

```ini
@littlekingsguard:registry=https://npm.pkg.github.com/
//npm.pkg.github.com/:_authToken=${GITHUB_TOKEN}
```

then install the scoped package:

```sh
npm install @littlekingsguard/provident-ssr@0.2.0-rc.1
```

The `GITHUB_TOKEN` must be a personal access token (classic, `read:packages`
scope) or a fine-grained token with read access to the `Preempt-Providence`
repository's packages. The public `provident-ssr` name is reserved for the
actual public release.

## Import

The package is ESM-only (no CommonJS build) and dependency-free: it runs on
Node ≥ 16 and in browsers via a bundler. Import from the package root to get
the whole public surface, or import a single module directly through the
`provident-ssr/core/*` subpath.

```js
import { translateLegacy, Supervisor, EventBridge, emitElements, diffMinimal, applyOps, DomAdapter, renderProducingProcess } from 'provident-ssr'
import { Node } from 'provident-ssr/core/node.js'
import { loadState } from 'provident-ssr/core/serialize.js'
import { translateLegacy as tl2 } from 'provident-ssr/core/translate.js'
```

## Exposed input surfaces

The engine accepts the same document through several entry points, each
intended for a different host role:

| Surface | Entry | Shape | Who uses it |
| --- | --- | --- | --- |
| **Legacy envelope** | `translateLegacy(env)` | A JSON document: `{ template: { root, component? }, content: [], clientConfig }`. Handler bodies are **function-STRING data** (`"body": "function (event, context) { … }"`); providers are `component: [{ reference, value }]` bindings (a `value` = source anchor, a `target` = consumer seam). | Static pages, SSR, blind-test fixtures — the authored-truth input |
| **Direct graph** | `new Node(data)` + `supervisor.registerNode(node)` | Programmatic `Node` construction with `base` data + `addLayer`/`addAnchor` — the same data model translate produces | Hosts that build the graph in code, migrations |
| **Managed mutation channel** | `supervisor.apply(op)` | Wire or node-shaped ops: structural (`attach`/`detach`/`move`/`destroy`/`clone-instance`) + `state-slice` (`mutation: [{ targetProp, mode, value }]`). Journaled, replayable, gated (`unknown-node`, `single-parent`, `cycle-detected`, `placement-target-blocked`). | Runtime updates through the **managed channel only** — handlers and hosts never write nodes directly |
| **Client API** | `clientAPI.apply(nodeRef, mutation)` | The 2-method surface (`apply` / `getState`) wrapping a `state-slice`; in-tree gating | Handler bodies (`context.clientAPI`) |
| **Serialized document** | `serializeSlice(node, kids)` / `loadState(doc)` | `node → JSON → parse → recompile` SSR round-trip | SSR + hydration hosts |
| **Dispatch** | `supervisor.dispatchEvent(target, event, …args)` / `dispatchPhase` | A TRIGGER: runs the target's handler bodies with `(event, context)`; never drains pass-2, never re-renders by itself | Interaction handling (the host re-emits on demand) |

Every surface converges on the same anchor-graph `Supervisor` — the input
format changes, the engine contract does not.

## The graph → wires → elements transmission

This is the core transmission that turns graph state into rendered output. It
has four stages; the first two are pure functions of the graph, the last two
are adapter-neutral and host-driven.

```
compile(slice)          → CompiledState[]   (actionable — resolved, renderable states)
emitElements(states)    → MinimalElement[]  (wires + namespaced props, per state)
diffMinimal(prev, els)  → RenderOp[]        (create / set / append / remove / styles)
applyOps(adapter, ops)  → rendered output   (DOM elements or SSR fragments)
```

### 1. Compile — graph states become renderable states

`node.compile(slice)` runs the two-scope compile (pass-1 local, pass-2
remote) and returns `CompileResult.actionable`: a flat list of
`CompiledState` — one per node **and one per placement path-state** — each
carrying `nodeId`, `pathKey`, resolved `type`/`props`/`css`/`content`,
`anchors`, `bindings`, and `unresolved`. States whose resolution dropped
(loop, prototype-terminated, owner-terminated) are excluded; the
`dropped`/`warnings` report tells you why.

### 2. Emit — states become minimal elements (the wire boundary)

`emitElements(actionable, nodeById, renderOptions?)` maps each state to a
`MinimalElement` — the node-local diff unit:

- **`wire` = the state's `pathKey`** — for placement path-states the wire IS
  the path (`root/<zone>/<ownerId>/…/<nodeId>`), so a single graph node can
  emit MANY elements (one per path-state). Wires are stable across renders
  while the placement topology is unchanged, so element reuse falls out of
  the prevMap diff: steady-state renders are set-only.
- **`forkKey`** — carried by every element (for path-states it equals the
  `pathKey`). It is forwarded onto every emitted `create`/`set`/`remove` op,
  so fork arms stay distinct at the adapter boundary. The adapters key their
  element tables by `wireKey(wire, forkKey)` — the composite key — so two
  arms of the same wire never collide.
- **Namespaced props** — `props` is a flat record where the compiled
  surface is encoded in the key namespace: `prop:*` (authored props),
  `css:*` (classes/style/id), `text` (content), `on:<event>` (handler
  bindings), and — only with the opt-in `renderOptions: { nodeIdAttribute:
  true }` — `data:node-id` (the element→graph traceability attribute, the
  producing node's real id). `cssDef` never rides here; it flows separately
  as the `styles` op.

### 3. Diff — elements become an op stream

`diffMinimal(prevMap, els)` compares the previous per-wire element map with
the new list and emits the minimal op stream:

| Condition | Ops |
| --- | --- |
| wire in `next`, not in `prev` | `create` + `set`* + `append` |
| wire in `prev`, not in `next` | `remove` |
| `type` changed | `remove` + `create` (no morphing) |
| prop value changed | `set` — only the changed names |
| child order changed | re-`append` in the new order + `remove` departed |

Every op forwards its element's `forkKey`. The stream is adapter-neutral —
both adapters and the parity oracle consume the identical stream.

### 4. Apply — ops become output

`applyOps(adapter, ops)` drives a `RenderAdapter`:

- `DomAdapter` — real browser DOM (`HTMLElement`s under a mount).
- `SSRFragmentAdapter` — string HTML fragments (`toString()` assembles the
  document; works anywhere, no DOM).
- `MockAdapter` — records every call (the op-stream == call-log parity
  check).

`applyOps` resolves `append`/`remove` owners from the batch's created
elements, then from the adapter's persistent wire map — so incremental
batches (set-only) attach to previously created elements.

### The canonical loop

`renderProducingProcess(actionable, nodeById, adapter, prevMap, renderOptions?)`
wraps stages 2–4 in one call: it prunes states whose node is destroyed or
not-in-tree, emits, diffs, applies, and returns `{ els, ops, prevMap }` —
the new `prevMap` feeds the next call. Ownership rules: the caller owns the
per-tree `prevMap` (pass `null` for the first render); `takePass2States()`
is the caller's drain; calling the loop never dispatches (it is the host's
explicit on-demand re-emit).

```js
import { translateLegacy, Supervisor, EventBridge, renderProducingProcess, DomAdapter } from 'provident-ssr'

// a LEGACY envelope (function-STRING handler bodies are the data format)
const env = {
  template: {
    root: {
      type: 'div',
      component: [{ reference: 'tone', value: 'is-primary' }],
      children: [{ type: 'span', css: { classes: ['badge'] }, component: [{ reference: 'tone', target: 'css.classes' }], content: 'Badge' }],
    },
  },
  content: [],
  clientConfig: { runInstantiation: true, runRendering: true },
}

const translated = translateLegacy(env)
const supervisor = new Supervisor({ events: new EventBridge() })
for (const node of translated.nodes) supervisor.registerNode(node)

const compiled = translated.root.compile(translated.nodes)
supervisor.recordResolved(compiled.actionable)

const mount = document.getElementById('app') // a DOM element
const adapter = new DomAdapter(mount)
const nodeById = new Map(translated.nodes.map((n) => [n.id, n]))

// first render (prevMap null) — subsequent renders pass the returned prevMap
const { els, ops, prevMap } = renderProducingProcess(compiled.actionable, nodeById, adapter, null)
```

## API

- `translateLegacy` / `reverseTranslate` — legacy envelope in/out.
- `Node` / `Supervisor` — the graph + the journaled managed channel
  (`clientAPI.apply`, `dispatchEvent`, `runPhase`, `flush`,
  `dispatchAndReport`).
- `dispatchEvent` / `dispatchPhase` / `makeHandlerContext` — handlers.
- `diffMinimal` / `emitElements` / `applyOps` / `renderProducingProcess` /
  `treeFromOps` / `treeSig` — the graph→wires→elements transmission above +
  the adapter-neutral parity oracle.
- `DomAdapter` (browser DOM; requires a DOM environment) / `SSRFragmentAdapter`
  (string HTML, works anywhere) / `VOID_TAGS`.
- `serializeSlice` / `loadState` — the SSR document round-trip.

The in-repo specs under `docs/specs/*.md` are the full behavior contract;
`docs/specs/contract.md` owns the exact public surface, `docs/specs/render.md`
owns the op vocabulary and wire model, `docs/specs/translate.md` owns the
envelope surface.

## License

AGPL-3.0.