# Fork-Stress Demo Spec — layered runtime child-creation stress test

Status: spec for the `fork-stress` demo series. Companion review:
`docs/session-defect-review.md`. Design skill: `docs/skills/designing-pages.md`
§14 (authoring + browser-realism rules apply).

## Purpose

A demo-only stress test of the forking render system. A binary tree is built
layer by layer; each layer adds exactly **2 children per node** using a
different one of the four valid runtime child-creation mechanisms, cycling
through them every 4 layers. Each page is a fixed-depth tree (pages at depth
2, 4, 6, 8 → 3, 15, 63, 255 nodes). The demo uses ONLY core (`dist/core/*`)
and handler code — no demo-side render machinery (per the session principle).

## The four mechanisms (the layer cycle)

| Layer | Mechanism | Core/handler surface |
| --- | --- | --- |
| 1, 5 | **Placement** — children attached into a placement zone | placement anchor (`hub().linkFor(name,'placement')`) + parent-child anchor; static attach in fixture for L1, runtime `attach` op for L5 |
| 2, 6 | **Component providing values from a prototype** | parent `target` ref; root `source` anchors; 2 authored children whose text comes from child `bindings` (components-demo heading/body pattern) |
| 3, 7 | **Component linking a prototype as a child** | parent `target` ref; root `source` = definition object `{ type, children: [{bind,type}×2] }`; emitter expands `def.children` into 2 child wires (`${wire}:${spec.bind}`) |
| 4, 8 | **Handler creating children** | `after-compile` handler on each parent creates 2 `Node`s, registers them (`c.supervisor.registerNode`), attaches via `clientAPI.apply(id, { kind:'attach', node:id, to:parent })`. **Idempotent**: runs only when its layer marker is absent (guards against after-compile loops) |

Layer method cycle: `placement, values, link, handler, placement, values, link, handler`
(L5/L6/L7/L8 reuse L1–L4 with **different placement names / component names**).

## Tree shape (depth 8 = 255 nodes)

```
L0  root (1)
L1  placement 'stress-1'      → 2 children per root        (2)
L2  component 'values-1'      → 2 children per L1 node     (4)
L3  component 'link-1'        → 2 children per L2 node     (8)
L4  handler 'h4'              → 2 children per L3 node     (16)
L5  placement 'stress-5'      → 2 children per L4 node     (32)
L6  component 'values-2'      → 2 children per L5 node     (64)
L7  component 'link-2'        → 2 children per L6 node     (128)
L8  handler 'h8'              → 2 children per L7 node     (128 leaves, 255 total)
```

Pages: `fork-stress-d2.html` (L1–L2), `fork-stress-d4.html` (L1–L4),
`fork-stress-d6.html` (L1–L6), `fork-stress-d8.html` (L1–L8).

## Static vs runtime construction

- **Fixture (serializable)**: root + L1 (placement, attached), L2 (values
  children authored + component refs/sources), L3 (link defs + sources).
  Serialized via `serializeSlice` → `preempt-initial-data`.
- **Runtime (page module, core + handlers only)**: the driver, after
  reconstruction, builds the remaining layers in order, each layer being a
  distinct mechanism:
  - L4/L8: install the idempotent `after-compile` handler on each parent,
    then trigger its compile (pass-2 via `clientAPI.apply` tick on the
    parent). Handler creates 2 children (marker props), attaches via the
    `attach` op.
  - L5: create 2 nodes per L4 parent, add placement anchor
    `'stress-5'`, register, `attach` op.
  - L6: for each L5 node add `target 'values-2'`; create 2 authored
    children each targeting `values-2.a`/`values-2.b`; root sources
    `values-2.a`/`values-2.b`; attach.
  - L7: for each L6 node add `target 'link-2'`; root source `link-2` def;
    emitter expands (no runtime children needed).
- Render: bootstrap compile once; every layer build is followed by
  `supervisor.takePass2States()` consumption + `diffMinimal` + core
  `applyOps` (the DECIDED incremental contract).

## Per-node ancestry documentation

Every node carries `props: { 'stress:layers': '<L1:method>|…|<Lk:method>' }`
(the chain of layer mechanisms from root to it) and the page emitter renders
it as a label chip (`<span class="stress-label">`), visually documenting
depth + tree-back-to-root. Depth = number of `|` segments.

## Emission

The page needs the two component-layer interpretations core `emitElements`
does not provide (def expansion for link layers; binding-fed text for value
layers). It keeps a small page-local `expandState` (mirroring the components
demo — page logic, not render machinery) that maps compiled states →
`MinimalElement`s and feeds core `diffMinimal`/`applyOps`. Fork arms wired
`<nodeId>#<i>` (core `emitElements` convention) when a consumer forks.

## Harness checks (per page, in the browser runner + demo:smoke)

1. Node counts: layer k has exactly 2^k nodes; total = 2^depth − 1.
2. Method correctness per layer:
   - L1/L5: children have a `placement` anchor named `stress-1`/`stress-5`.
   - L2/L6: children's compiled `bindings` carry the source values; rendered
     text = the value.
   - L3/L7: `bindings['link-N']` is the def object; rendered wires include
     the def-expanded child wires.
   - L4/L8: children carry the handler marker; attaching twice (re-dirtying
     the parent) adds nothing (idempotency, no loop).
3. Ancestry labels: every node's `stress:layers` chain matches its level.
4. Incremental contract: no render-side full compile after bootstrap
   (focused passes only).
5. Zero-failure banner per page.

## Validation (AGENTS.md item 4)

```
npm test; npm run typecheck; npm run demo:smoke; npm run build
```

## Docs to update on completion

- `docs/skills/designing-pages.md` §11 (matrix row) + §12 (demo pages list).
- `docs/session-defect-review.md` "Where the rules live now" + demo list if
  referenced.
- `demo/index.html` (page list).
- `RENDER_PROCESS_NOTES.md` §10.10 DECIDED entry (fork-stress demo; the
  after-compile idempotency rule).
