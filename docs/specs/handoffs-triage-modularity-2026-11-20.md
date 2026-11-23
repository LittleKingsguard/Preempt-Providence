# Handoff TRIAGE — `Provident-Electron`'s modularity findings `H-1`/`H-2` (against `provident-ssr@0.5.2`)

**Status: TRIAGE — NOT A GATE VERDICT.** This record answers what the handoff asks,
what the current engine actually does, and which prior rows already decide/reject its
parts. It is the intake for the three-agent gate (AGENTS.md item 9) that the owner
queued on 2026-11-23 — **no spec, no code, no test has been written for either
finding, and nothing here is a disposition.** The gate verdict lands as
`docs/specs/handoffs-review-11.md`.

**Source:** `docs/handoff-modularity-2026-11-20.md` (committed 2026-11-23 with this
triage). Downstream record: `Provident-Electron/strata/records/modularity-unit.md:7`
(both findings "DELIVERED UPSTREAM 2026-11-20, on the user's word"; the downstream
never patches the package — `D-5`/`D-52`). Date of this triage: 2026-11-23.

**Evidence class of the handoff (stated so the gate does not over-read it):** both
findings are a downstream *symptom* plus a **static** root-cause reading of this
package's source. No failing test, no probe script and no measured upstream run backs
either finding. The downstream's cited rows `D-182`/`D-252` are **its own** runtime
facts, and its own findings record already narrows them
(`Provident-Electron/strata/records/modularity-findings.md:10` — "`D-182` is narrower
than the fact sheet reads … an authored node CAN be relocated post-bootstrap").

**Method.** Two independent read-only research passes (one per finding) re-derived
every claim from the 0.5.2 tree; the four load-bearing claims (the `attach` branch, the
flush skip, the `state-slice` dirty mark, the function-value `body` acceptance) were
then re-read by the supervisor. Every anchor below was read in the tree, not inferred.

---

## 1. `H-1` — "a post-compile structural change does not re-emit; no node-keyed invalidation entry"

### 1.1 What is TRUE

| Claim | Anchor |
| --- | --- |
| No structural add-op dirties the **container** or the **ancestor chain**; `markPass2` can only add the id it is given and never ascends | `src/core/supervisor.ts:650-654`, `:637` |
| `placement-attach` is the only add-op that marks the container (and it marks exactly `{container, added}`) | `src/core/supervisor.ts:1173-1197` (marks `:1194-1195`) |
| No identifier named `invalidate`/`recompile` exists anywhere in `src/`; the barrel exports none | `src/index.ts:26-42`, `:57-61` |

### 1.2 What is NOT established

- **"The ancestor's re-emit cannot be forced."** A node-keyed forced re-emit already
  composes from public parts: `Node.compile/compilePath/compileLocal/compileRemote`
  (`src/core/types.ts:41-46`; impls `node.ts:1038`, `:1096`, `:1110`, `:1426`),
  barrel-exported `focusedSliceFor` (`src/index.ts:27`), `Supervisor.recordResolved`
  (`supervisor.ts:624`), and the empty `state-slice` — `apply({kind:'state-slice',
  node, mutation: []})` passes validation and reaches `markPass2(node.id)`
  (`supervisor.ts:1021-1029`, `:1127`). The pass-2 slice for any dirty node **is** the
  ancestor chain (`focusedSliceFor` seeds path-to-root ∪ descendants,
  `supervisor.ts:51-59`, `:554-556`). So the recipe exists; it is **undocumented**
  (`docs/skills/designing-pages.md` carries no "force a re-emit" recipe — a targeted
  grep found none). This is a documentation gap, not necessarily a surface gap.
- **"Adding a child leaves the container's markup unchanged"** is not the general case.
  For a **registered** family child the flush compiles `focusedSliceFor(added)`, so the
  container's own `CompiledState` is regenerated with the new child in `children`
  (`node.ts:1294`), stored (`supervisor.ts:697`, `:702-706`), and its `childOrder`
  diff emits the `append` (`render-helpers.ts:325`; `render.ts:108-118`).

### 1.3 Where the symptom is real — three reachable cases

| # | Case | Verdict | Anchor |
| --- | --- | --- | --- |
| **(a)** | **`attach` of a node that was never `registerNode`d** — the only add-kind that omits registration, against a flush that **silently skips** ids absent from `this.nodes`, while the op still returns `{status:'applied', dirtied:[node.id]}` | **GENUINE CANDIDATE DEFECT** (silent no-op — nothing renders, nothing warns) | `supervisor.ts:1198-1211` (no `registerNode`, vs `:1186`/`:1244`/`:1290-1293`); skip `:671-676`; duty `docs/specs/contract.md:494` (REQ-GAP-9 "skipping step 4 renders a graph that never reaches pass-2"), `ops.md:106` pins registration only for `placement-attach` |
| **(b)** | `placement-attach` into a container that is **not** placement-routed | **PINNED AS EXPECTED — not a gap** | `docs/specs/placement-path-spec.md:485-495` |
| **(c)** | `detach` / `destroy` — no upward re-emit (`destroy` evicts the id before the flush) | **KNOWN OPEN RESIDUAL** (`R-VPD-2` ghost-`childOrder`) | `supervisor.ts:1164-1170`, `:1216`; `docs/defects.md:16` |

Case (a) is filed as `docs/defects.md` **ATTACH-UNREGISTERED-SILENT-NOOP**
(OPEN, static reading — needs a red-first probe to confirm it is not an undocumented
"attach expects a registered node" contract).

### 1.4 Prior art that bears on the ask

| Row / spec | Anchor | Status | What it pins |
| --- | --- | --- | --- |
| Parent-marking duty for ANY parent-scoped structural op | `docs/specs/handoffs-review-2.md:283-305` | REJECTED op, recorded constraint | "**mark the parent pass-2** (the parent's `resolvedStates` keep ghosts otherwise)" |
| E2E-4 affected set | `docs/specs/placement-path-spec.md:434-457`; `docs/specs/ops.md:109`, `:359` (G21) | ACTIVE | "invalidates: **the immediate parent** … **+ the added node** … Nothing deeper" |
| Dirty-propagation contract | `docs/specs/ops.md:281-300`; `node.md:383`, `:403`; `render.md:318`, `:553` | ACTIVE | pass-2 is node-local, ancestor-chain-bounded; "**no whole-tree recompile**" |
| `clear-children`/`reset-subtree` op (REQ-GAP-12) | `docs/pending.md:44`; `docs/decisions.md:61` | **REJECTED** as new surface | teardown-to-root = one `destroy` op (LANDED 2026-08-22) |
| `reset()`/`prune()`/`unregisterNode` (REQ-GAP-11) | `docs/pending.md:43`; `docs/decisions.md:62` | **REJECTED** as host-facing surface | self-evicting sweep is the approved shape |
| Public surface is op-kind based | `docs/specs/contract.md:219-233`; `src/index.ts:26-42` | ACTIVE | `registerNode`/`apply(op)`/`replay`/`undo`/`redo` |
| Pass-2 cost rows (the guard any new ancestor marking must not trip) | `docs/decisions.md:17`, `:18`, `:20` | ACTIVE | slice scope; 12.4× redundancy at d12; d10→d12 growth guard bound 10× |

**Version note.** The handoff's third reading ("the first post-bootstrap mint drops an
authored bootstrap consumer") describes the class closed by
**VALUE-PROVIDER-RENDER-DISPOSITION**, which shipped **in 0.5.2 — the version the
downstream pins** (`docs/decisions.md:15`, `docs/defects.md:70`). It must be re-tested
at 0.5.2 before it is carried as live.

---

## 2. `H-2` — "a handler body is only a function STRING; the dispatch path has no resolver indirection"

### 2.1 The premise is false at the API level

A **function value** is accepted as `body` (`src/core/translate.ts:380` — the guard
admits `typeof h.body === 'function'`; the branch pushes it verbatim `:429-434`), the
`Node` constructor copies `data.handlers` untouched (`node.ts:478-501`, `:1043`), and
dispatch calls `handler.body(...)` (`handlers.ts:100-108`, `:116-124`). What is actually
string-only is the **`new Function` compile** (`translate.ts:398`, `:505-511`;
`registry.ts:113-119` via `node.ts:1889-1892`) and the **JSON boundary**
(`serializeNode` emits no `handlers` key at all — `serialize.ts:104-166`; reverse
re-stringifies — `translate.ts:1349-1359`).

### 2.2 What is TRUE

- There is **no resolver indirection at dispatch** (`handlers.ts:100-108`): a matched
  handler whose `body` is not a function is **silently skipped** (pin H-H3,
  `docs/specs/handlers.md:210`). A `handlers[].ref` added naively would be silently
  dead, not an error.
- The consumer's premise "exactly as it already supplies adapter and **transform**
  hooks" is **false**: `translateLegacy` takes `{hub?, graphScope?}` only
  (`translate.ts:1112`); there are no transform hooks in `src/`; the single adapter
  callback is `DomAdapterOptions.onEvent` (`adapters.ts:34-36`).

### 2.3 The need is already served by three documented, sanctioned paths

| Path | Anchor | Scope |
| --- | --- | --- |
| `state-slice` with `targetProp:'handlers'` | `node.ts:1532`, `:1546-1547`; `docs/specs/handlers.md:134-150` | in-tree, LIVE, journaled, `markPass2`'d, undo-exact — real function bodies |
| `layer-apply` with `data.handlers` | `src/core/ops.ts:170-198` | mints family children carrying closures; teardown = one `removeLayer` |
| `addLayer` name→body seam (the REQ-GAP-10 **approved** letter) | `node.ts:703-720`; `docs/specs/handlers.md:164-203`; IMPLEMENTED doc-only 2026-08-22 | **pre-mount / out-of-tree prototypes only** |

So "a module exposes a renderer function to a node" is achievable **today, in-process**.
`registerHandlerBody` — a name→**string** registry — was **REJECTED** precisely because
it drags the `new Function` eval gate into the runtime write surface
(`docs/pending.md:42`; `docs/specs/handoffs-review-2.md:174-177`).

### 2.4 Why `handlers[].ref` is nevertheless NOT the rejected shape

The rejected shape carries **source text** into the graph. `H-2` asks for the
**opposite**: a key the **host** resolves to a **host-owned closure**, which *removes*
`new Function` from the node's data path. It is a genuinely new seam, and it would have
to be reconciled with, at minimum:

| Constraint | Anchor |
| --- | --- |
| dispatch admits only `typeof body === 'function'` (H-H3) | `docs/specs/handlers.md:210`; `src/core/handlers.ts:102`, `:118` |
| REQ-GAP-10 letter: pre-mount only, no runtime materialization of named bodies | `docs/specs/handlers.md:164-203` |
| **D2 scope-locality** — the resolver must be per-`GraphScope`/host-instance, never a module-global map (cross-graph resolution is the definitive security hole) | `docs/decisions.md:47`; `docs/pending.md:105` |
| reverse round-trip must carry `ref`, not degrade to a bodyless handler | `src/core/translate.ts:1349-1367`; `docs/specs/translate.md:283` |
| the script-DSL hard boundary ("runtime-written data can NEVER become a native handler closure") — a resolver key is *named host code*, not runtime-written data, so the boundary survives **only if that distinction is written down** | `docs/specs/script-dsl-review.md:88-93`, `:139-145` |
| containment precedent for an unresolved key (per-handler skip + warn / rejection) | `translate.ts:418-425`, `node.ts:1884-1895` (`handler-body-invalid`, `handler-body-eval-blocked`), `supervisor.ts:1056-1059` (`hook-name-unresolved`) |

### 2.5 The threat-model disagreement, stated plainly

The downstream's motive — graph text is readable through `dispatch`,
`get_rendered_html`, `get_markdown` — is **its** contract; `get_rendered_html` and
`get_markdown` appear nowhere in this package's `docs/` as contracts outside downstream
surface descriptions. This package's seal is the **trusted-backend write-gate**, not
concealment: *"the renderer performs NO authorization of its own — the backend/DB layer
that accepts loadable handler definitions MUST gate writes to admin/trusted-developer
only"* (`src/core/translate.ts:500-503`; `docs/specs/translate.md:283`;
`RENDER_PROCESS_NOTES.md:713-716`; `docs/specs/script-dsl-review.md:88-93`). Readability
of a body as data is **accepted by design** here. `H-2` is therefore an argument about
*where the eval boundary sits*, not about closing a leak.

---

## 3. What the gate inherits (unchanged by this triage)

- **`H-1b` (the public node-keyed invalidate/recompile entry):** needs a verdict on
  whether the existing composition (document it) suffices, whether to extend an
  existing op's dirty set (`attach` → container), or whether to gate a genuinely new
  member against the minimal-surface rulings (`decisions.md:61-62`, REQ-GAP-11/12) —
  and it must not trip the pass-2 growth guard (`decisions.md:20`).
- **`H-2` (a `handlers[].ref` host resolver):** needs a verdict on whether this package
  admits its first host-supplied executable hook into a node's handler list, and if so
  under which scope key (D2) and with which amendment to H-H3 / the REQ-GAP-10 letter /
  the script-DSL wording.
- **`H-1a` (the `attach` registration/silent-skip defect)** is **booked separately**
  (`docs/defects.md` ATTACH-UNREGISTERED-SILENT-NOOP) because its fix shape is clear,
  distinct, and independent of either verdict; it is queued behind the gate by the
  owner's choice, not parked.
- **Nothing here authorises a downstream green.** A handoff delivery greens no
  downstream row (`D-5`), and this triage greens nothing upstream.
