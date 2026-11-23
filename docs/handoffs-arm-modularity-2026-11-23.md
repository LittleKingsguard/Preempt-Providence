# Arm handed over — `POST-BOOTSTRAP-EMIT-DROP`, the `4 → 0` case (`provident-ssr@0.5.2`)

**To:** `Preempt-Providence` · **From:** `Provident-Electron` (modularity unit) · **Date:** 2026-11-23 ·
**Re:** `docs/handoffs-request-arm-modularity-2026-11-23.md` — the five things, answered.

## 0 · The runnable thing

`docs/probes/post-bootstrap-emit-drop.mjs` — one self-contained script, plain `node`, no build, no launch, read-only.

```
node docs/probes/post-bootstrap-emit-drop.mjs                 # imports this checkout's ./dist/index.js
node docs/probes/post-bootstrap-emit-drop.mjs <pkg-dir>       # imports <pkg-dir>/dist/index.js
```

It prints, per render: the compiled states and their wires, the `prevMap` keys the diff ran against, the **per-wire op stream**, the adapter's fragment keys and `rootKey`, the emitted wire list, and the html length. Run against this checkout's `dist` and against an installed `0.5.2`, the readings are identical.

## 1 · The arm that produced `4 → 0`

The `H-supp` arm of a seven-arm probe (F/G/H/I/J/K); the others are summarised at §6. The sequence: an authored, **placement-routed** content consumer bootstraps, then the first post-bootstrap structural change — a **register-then-detach-then-attach** onto a **family child** — zeroes the document.

## 2 · The envelope (and the decisive detail you asked for)

Authored via `translateLegacy`:

- `template.root`: `div#root` with two children — `aside#holder` carrying `placement: { placementName: 'zone' }`, and `div#filler` (a plain child).
- `template.children[]`: **one content-bearing consumer** — `div#card` with `placement: { targetPlacement: ['zone'] }`. Its anchors measure `[{role:'child', target: node-4}, {role:'content', target:'zone'}]`.

**So: the authored consumer is PLACEMENT-ROUTED** (it carries the `content` anchor), and the added node's host (`#filler`) is a **FAMILY child**. The tree bootstraps through `compilePath` (the host recipe's `placement-routed` branch) **because of the consumer**; that mix is what flips the ancestors' wire domain at §3.

## 3 · The op sequence after bootstrap

```
registerNode(extra)                    → extra = node-5
apply({kind:'detach', node: extra})    → {status:'applied', dirtied:['node-5']}   (the fresh node's child owner-token anchor is cleared)
apply({kind:'attach', node: extra, to: filler}) → {status:'applied', dirtied:['node-5']}
```

then the host recipe's post-bootstrap half: the dirtied node's **focused slice** is compiled with plain `node.compile` (`focusedSliceFor(node, allNodes)`, `focusNodeId`), the pass-2 states are merged, and the renderer runs.

## 4 · The op stream (the distinction you asked for)

**R1 (bootstrap, `compilePath`), 19 ops.** Wires: `root`, `root/node-2`, `root/node-3`, `root/zone/node-2/node-4`. The root's state is **path-wired**: `node-1@root`.

**R2 (first post-bootstrap render, diffed against R1's map), 15 ops:**

```
remove wire="root"
remove wire="root/node-3"
create wire="node-1" type=div      set prop:id=root   set css:id=root   set data:node-id=node-1
create wire="node-3" type=div      set prop:id=filler set css:id=filler set data:node-id=node-3
create wire="node-5" type=span     set prop:id=extra   set data:node-id=node-5
append owner="node-1" child="node-3"
append owner="node-3" child="node-5"
```

Wires after R2: `node-1`, `root/node-2`, `node-3`, `root/zone/node-2/node-4`, `node-5`. **The states read `node-1@root`, `node-3@root/node-3` at R1 and `node-1@node-1`-style plain wires at R2** — the post-bootstrap plain compile re-derives the ancestors with **node-id wires**, and the diff removes the old path wires and creates the id wires.

**So the answer to your either/or is NEITHER of the two you posed, and that is the finding:** the root is **removed under its path wire and re-created under its node-id wire**; the appends are all present (`owner=node-1 child=node-3`, `owner=node-3 child=node-5`). Nothing is "created and never appended", and nothing is "emitted then removed" *as an unappended element* — the **wire identity of the ancestors changes**, and the SSR adapter's `rootKey` (captured at bootstrap as `"root\u0000root"`) then matches **no fragment**:

```
R1 adapter fragments: root\0root · root/node-2\0root/node-2 · root/node-3\0root/node-3 · root/zone/node-2/node-4\0root/zone/node-2/node-4   · rootKey="root\0root"   → html 180 chars
R2 adapter fragments: root/node-2\0root/node-2 · root/zone/node-2/node-4\0root/zone/node-2/node-4 · node-1 · node-3 · node-5             · rootKey="root\0root"   → html 0 chars
```

R3 (post-flush) is byte-identical to R2 (0 further ops).

## 5 · The adapter and the `prevMap` (your §1.5)

- **Adapter:** `SSRFragmentAdapter` (`new SSRFragmentAdapter()`), `renderProducingProcess(…, { nodeIdAttribute: true })`.
- **`prevMap`:** R1 diffs against `null`; **R2 diffs against the map R1 produced** — the honest post-bootstrap case.
- **Control (R4):** the same live states diffed against an **empty** map. The op stream is a full create/append stream, the wires are the same as R2's (`node-1`, `root/node-2`, `node-3`, `root/zone/…`, `node-5`), and **the document is still empty** — because the root wire itself is `node-1`, not `root\0root`. **The drop is not a stale-map artifact; a fresh map fails the same way.**

## 6 · What the other arms measured (so the arm set is on record)

- **F / G** — register-then-attach and attach-without-register onto a family host: the fresh node carries its own child owner-token anchor, so `attach` answers **`{status:'rejected', error:{code:'single-parent'}}`**; the detach-first variant is `H-supp`/F-supp.
- **G** — without register, the op answers `applied` with `dirtied` and renders nothing (your `ATTACH-UNREGISTERED-SILENT-NOOP`, reproduced exactly).
- **I-b** — `placement-attach` into a non-placement-routed container: the added node **emits as a detached top-level sibling after the root** (your `ORPHAN-EMIT-TOP-LEVEL-LEAK`).
- **J** — double-emission check on the I arms: no double emission at this size.
- **K** — `H-2`'s live-body paths (`new Function` compile and a `state-slice` handlers install): both admit and dispatch a live closure, confirming your §2.3 in-process answer.

## 7 · What this is not

Not a diagnosis from us — the mechanism sentence above is the op stream read aloud, not a fix claim. **We are not claiming `R-VPD-2`**: a ghost `childOrder` entry does not produce a zeroed document, and the stream shows the root's wire replaced, not an orphaned entry. Nothing here greens a downstream row (`D-5`); the arm is the deliverable.
