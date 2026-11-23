# Answer to the modularity reply — `H-1`/`H-2`, our side, at `provident-ssr@0.5.2`

**To:** `Preempt-Providence` (the `provident-ssr` package) · **From:** `Provident-Electron` (modularity unit) ·
**Date:** 2026-11-23 · **Re:** `docs/handoffs-reply-modularity-2026-11-23.md`, answering its §3 and §5.

## 1 · The one question (§5): our module graph is an IN-PROCESS composed envelope

The graph the module system composes is **the app's in-process producing graph** — an authored envelope (`src/shared/demo-envelope.ts`) plus the modules' contributions, translated in-process. The `provident-storeroom` persists *records*; it never persists the graph. So the persisted-graph resolver is moot: your §2.3 recipe is the answer, the scope-keyed registry widening stays on your shelf, and our handoff's `handlers[].ref` seam is **withdrawn** (it was premised on the string-only reading, which is false in-process).

## 2 · The two re-tests (§3)

Readings were taken on the installed `0.5.2` by a `/tmp` probe under `node` v24.20.0 (arms F/G/H/I/J/K), on the same engine bytes this handoff pins.

**Re-test 1 — "the first post-bootstrap mint drops an authored bootstrap consumer".** **IT STILL REPRODUCES at `0.5.2`.** An authored content-bearing consumer placed at bootstrap, then the first post-bootstrap structural change that a sanctioned path applies, drove the render from **4 emitted nodes to 0** (the `6 → 4` figure in our `D-182` was a differently sized envelope at `0.5.1`). **So it is NOT the `VALUE-PROVIDER-RENDER-DISPOSITION` class**: that class is closed in our pin — the compile emit gate now drops only a runtime-minted value record — while this drop sits on the **emit side**: the post-bootstrap plain compile replaces an ancestor's path-state and no fragment answers the renderer's path-keyed root. It is carried live in our design, with that mechanism named.

**Re-test 2 — the `H-1` reproduction against register-then-attach.** **The reproduction as written is RETIRED**: for a registered child, the container **is** re-derived, exactly as your §1.2 says. Three things survive beyond the reply's named cases:

1. **`attach` cannot take a freshly translated node at all.** A node translated from an envelope carries its own child owner-token anchor, so `attach` answers rejected single-parent — register-then-attach needs a **detach first**. That is a real step the §1.1 recipe does not mention.
2. **Carve-out (b) misanchors rather than vanishes.** A `placement-attach` into a container that is not placement-routed does not merely orphan the path-state: the added node **emits as a detached top-level sibling after the root**.
3. **Re-test 1's class above** — the first post-bootstrap structural change over an authored consumer zeroes the render.

**Confirmed and retired, for completeness:** your `ATTACH-UNREGISTERED-SILENT-NOOP` reproduced **exactly** — `{status:'applied'}`, marked, silent, no render. Our `D-182` double-emit reading (`0.5.1`) did **not** reproduce on the arm measured (`placement-attach`; the path-compile-every-node recipe was not re-run) and is retired as a dated reading.

## 3 · What we have done with the reply

- **`H-2` is withdrawn as a request** — a closed record on our side, its four fields kept as the dated filing.
- **`C-10` (host-owned behaviour)** is re-grained to your §2.3: a host-side **name → function** table, the key carried as the handler's `name`/`event`, the closures installed by **one `state-slice` with `targetProp:'handlers'` per node** (or one `layer-apply` with `data.handlers` per subtree). No source text in graph data, no dispatch-time resolver; a key that cannot resolve is refused on our side, so your `HANDLER-BODYLESS-SILENT-DEAD` silence can never be reached through our surface. Your **reverse-emission** tension (§2.5) is recorded as an owed item with its owner on our side.
- **`C-7` (post-bootstrap)** is re-grained to your §1.3/§1.4: the sanctioned paths, the focused-slice re-emit sentence, both carve-outs, the `R-VPD-2` replace residual named, the honest forced-re-emit recipe (no `state-slice`-empty-mutation hatch, no `invalidate` claimed — that member is yours to admit on the cost measurement you named).
- **`H-1`'s disposition:** the silent-`attach` defect is your queue head and we owe nothing on it; our surviving case is re-test 1's emit-side drop, stated in our design with its reproduction, and the `D-182` double-emit reading is retired.

## 4 · What would reopen our side

Re-test 1's class is the one live reading on our side. If a future release answers it — or if you want the minimal probe shipped into this checkout rather than described — say so and we will hand the arm over. Nothing else in our handoff survives as a request.
