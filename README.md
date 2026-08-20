# Preempt-Providence

Experimental stack for Preempt frontend — a reactive render engine:
legacy-envelope translate, an anchor-graph `Supervisor`, handlers, and SSR/DOM
render adapters. ESM-only, zero runtime dependencies.

## Install

```sh
npm install provident-ssr
```

## Import

The package is a pure ESM engine (Node ≥ 16 and browsers via a bundler). The
top-level entry re-exports the public surface; direct per-module access is
available through the `provident-ssr/core/*` subpath.

```js
import { translateLegacy, Supervisor, EventBridge, emitElements, diffMinimal, applyOps, DomAdapter } from 'provident-ssr'
import { Node, loadState } from 'provident-ssr/core/node.js'
import { translateLegacy as tl2 } from 'provident-ssr/core/translate.js'
```

## Minimal example — translate → compile → render

```js
import { translateLegacy, Supervisor, EventBridge, emitElements, diffMinimal, applyOps, DomAdapter } from 'provident-ssr'

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
const elements = emitElements(compiled.actionable, nodeById)
adapter.beginBatch()
applyOps(adapter, diffMinimal(null, elements))
adapter.endBatch()
```

## API

- `translateLegacy` / `reverseTranslate` — legacy envelope in/out.
- `Node` / `Supervisor` — the graph + the journaled managed channel
  (`clientAPI.apply`, `dispatchEvent`, `runPhase`).
- `dispatchEvent` / `dispatchPhase` / `makeHandlerContext` — handlers.
- `diffMinimal` / `emitElements` / `applyOps` / `treeFromOps` / `treeSig` —
  render ops + the adapter-neutral parity oracle.
- `DomAdapter` (browser DOM; requires a DOM environment) / `SSRFragmentAdapter`
  (string HTML, works anywhere) / `VOID_TAGS`.
- `serializeSlice` / `loadState` — the SSR document round-trip.

The in-repo specs under `docs/specs/*.md` are the full behavior contract;
`docs/specs/contract.md` owns the exact public surface.

## License

AGPL-3.0.
