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

## Tree shape (depth 12 = 4095 nodes)

```
L0  root (1)
L1  placement 'stress-1'      → 2 children per root        (2)
L2  component 'values-1'      → 2 children per L1 node     (4)
L3  component 'link-1'        → 2 children per L2 node     (8)
L4  handler 'h1'              → 2 children per L3 node     (16)
L5  placement 'stress-5'      → 2 children per L4 node     (32)
L6  component 'values-2'      → 2 children per L5 node     (64)
L7  component 'link-2'        → 2 children per L6 node     (128)
L8  handler 'h2'              → 2 children per L7 node     (256)
L9  placement 'stress-9'      → 2 children per L8 node     (512)
L10 component 'values-3'      → 2 children per L9 node     (1024)
L11 component 'link-3'        → 2 children per L10 node    (2048)
                                                          (4095 total)
```

Pages: `fork-stress-d{2,4,6,8,9,10,11,12}.html` — depth d has layers 1..d−1
(2^d − 1 nodes). The memoized-chainRoot change (compile-horizon review §6)
made depths 9-12 compilable: acyclic parent chains are no longer
depth-capped (only resolution recursion is), so the deep layers render.

## Per-node CSS stress (different property per level, value per sibling slot)

Each node carries a **visible css style**, and the style stresses the compile
lookup: **each level changes a DIFFERENT css property**, and within a level
the **value differs by sibling slot** (first vs second child of the parent):

| Level | css property | slot a (first child) | slot b (second child) |
| --- | --- | --- | --- |
| L1/L5/L9 | `background-color` | `hsl(level·53, 70%, 50%)` | `hsl(level·53+40, 70%, 50%)` |
| L2/L6/L10 | `border-style` | `solid`/`dotted`/`groove` (per cycle) | `dashed`/`double`/`ridge` |
| L3/L7/L11 | `border-width` | `1/3/5px` (per cycle) | `2/4/6px` |
| L4/L8/L12 | `text-decoration` | `underline`/`overline`/`line-through underline` | `line-through`/`underline line-through`/`overline line-through` |

- **DEMO-ONLY helper: `levelCss(level, slot)` + `cssPropForLevel(level)` in
  `demo/fork-stress-fixture.js`** — NOT part of the core API; do NOT document
  them in core docs (`src/`, core `docs/specs/*.md`, design skill §1-§9).
- The css is emitted through the serializable `style` key (the serialization
  schema carries only `id`/`classes`/`style`/`cssDef`), formatted as
  `property: value;` so different levels carry different property names.
- The marker `stress:kind` (`placement:1`, `values:6`, …) is a **props** key
  (serialized + emitted as an attribute), NOT a css key.
- The harness check "css stress: each level changes a DIFFERENT css property;
  the two sibling slots get different values" asserts: every layer-bearing
  element's style contains `cssPropForLevel(level)`; each level produces
  exactly the two expected (property, value) pairs from `levelCss(k,'a')` /
  `levelCss(k,'b')`; and `stress:kind` matches the node's top
  `stress:layers` segment.

### Lessons learned (CSS stress)

1. **Uniqueness must be guaranteed, not hashed.** An earlier per-node
   `nodeSeed(id) % N` collided (two L3 siblings shared a hue). The final
   design keys the value by (level, slot) — a deterministic pair — and the
   property by level, so the css string is unique per (level, slot) by
   construction.
2. **`css` is a closed serialization schema.** `serializeSlice` ships only
   `id`/`classes`/`style`/`cssDef` (`serialize.ts` `cssState`). A demo-side
   css key (e.g. `data-layer`) is silently dropped from
   `preempt-initial-data`; emit per-level properties through the `style`
   string, and put markers in `props` (emitted as attributes).
3. **Def-retyped children keep their OWN authored css/props.** The
   component-link emitter re-types real children (their standalone emission
   is skipped via `defCovered`), so it must preserve each real child's own
   css/props — the def's css/props are a fallback for synthetic
   `${wire}:${bind}` children only. A def-covered consumer that is ITSELF a
   def consumer (the data-driven link-only chains, fork-stress-data §4)
   still emits its own `defChildren` — the covered-skip suppresses only the
   standalone element (render-helpers `emitElements`, recursive def
   chains).
4. **Runtime nodes must be registered in the page's own `wireToNode` map**
   for emitter lookups to find them — `supervisor.registerNode` alone is not
   enough.

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
**P3 note (implemented):** the runtime page's child-creation names are
DISTINCT per sibling slot (`.a`/`.b` — fork-stress-fixture.js:185-186), so
no same-name fork actually fires on this page; the `<nodeId>#<i>` arm
convention is the historical/edge shape — the `component-source-duplicate`
guard (P3 §10.ab/§10.ae) removes the arm-generating case from shipped data,
and placement multiplicity is path-keyed (`forkKey = pathKey`, no `#`).

## Harness checks (per page, in the browser runner + demo:smoke)

1. Node counts: layer k has exactly 2^k nodes; total = 2^depth − 1.
2. Rendered element counts: each layer renders 2^k elements, no re-creates
   (wire-map count).
3. CSS stress: every node carries a distinct visible style; `stress:kind`
   matches its top layer (see §Per-node CSS stress).
4. Method correctness per layer:
   - L1/L5: children have a `placement` anchor named `stress-1`/`stress-5`.
   - L2/L6: children's compiled `bindings` carry the source values; rendered
     text = the value.
   - L3/L7: `bindings['link-N']` is the def object; rendered wires include
     the def-expanded child wires.
   - L4/L8: children carry the handler marker; attaching twice (re-dirtying
     the parent) adds nothing (idempotency, no loop).
5. Ancestry labels: every node's `stress:layers` chain matches its level.
6. Incremental contract: no render-side full compile after bootstrap
   (focused passes only).
7. Zero-failure banner per page.

## Data-driven variant (prototype-driven assembly)

A companion page proves the same tree can be assembled with NO outside
helpers beyond core: `docs/specs/fork-stress-data.md`. `fork-stress-data.js`
carries the LEGACY envelope (root + two prototypes per layer, handler
declared by NAME in the data — the page supplies the body) and assembles the
whole 2^depth − 1 tree at runtime via the `clone-instance` op (each clone's
inherited `after-compile` handler expands the next layer). Pages
`fork-stress-data-d{2,4,6,8,9,10,11,12}.html` with the same depth set.

**Static twin (placement-path-spec §5 — Unit 11, shipped alongside):** the
same topology is re-expressed WITHOUT clone-instance assembly — the
`demo/path-fork-data.*` page compiles the 22 prototypes + root through the
path-enumeration compile mode (`compilePath`): `placementName` producer /
`targetPlacement: string[]` consumer declarations in the legacy envelope,
ONE enumeration bootstrap → 4095 path-states pinned to 23 nodes (census
23/4095/0/0, cloneOps=0). The four-mechanism cycle doc above describes the
RUNTIME page (kept — placement-path-spec §9-Q4: both pages ship); the
runtime page's census asserts are re-pinned per §5.2 F-13 (in-tree =
2^depth − 1 + prototypes, unplaced = 0).

## Validation (AGENTS.md item 4)

```
npm test; npm run typecheck; npm run demo:smoke; npm run build
```

## Data-driven variant (completion test)

A second page series (`fork-stress-data-d{2,4,6,8,9,10,11,12}.html`)
rebuilds the same stress tree with a stricter contract: **core-only page
module** (no demo-fixtures helpers), **legacy-format data envelope**
(`translateLegacy` input), and **two prototypes per layer** with everything
else assembled dynamically — each prototype declares an `after-compile`
handler BY NAME in the data; the page maps the name to a body that clones the
next layer's prototypes (`clone-instance` op), so the 2^k-per-layer tree
grows recursively from the data alone. Spec: `docs/specs/fork-stress-data.md`.

## Docs to update on completion

- `docs/skills/designing-pages.md` §11 (matrix row) + §12 (demo pages list).
- `docs/session-defect-review.md` "Where the rules live now" + demo list if
  referenced.
- `demo/index.html` (page list).
- `RENDER_PROCESS_NOTES.md` §10.10 DECIDED entry (fork-stress demo; the
  after-compile idempotency rule).
