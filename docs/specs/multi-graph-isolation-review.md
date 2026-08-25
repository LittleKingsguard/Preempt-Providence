# Review — Multi-Graph / Registry Isolation (per-graph scope)

**Status**: PROCEED-AS-RESHAPED (three-agent gate, AGENTS.md item 9 — validity
→ critique → change-analysis; all three read-only). **Date**: 2026-08-25.
**Source**: `docs/specs/multi-graph-isolation-proposal.md` (feature request from
the Provident-Electron consumer).

## What the proposal asks

A host may mount two provident graphs in one process (graph A = agent-visible
app, graph B = operator-only Security pane), each rendering to its own root,
with **no cross-graph addressability** — graph A's agent surface must be
provably unable to see, dispatch, or read graph B. Today that fails because the
package keeps process-wide singletons in `src/core/registry.ts` shared across
every Supervisor (the `registered`/`byId` registry, the coalesced sweep,
`contentNodes`/`defPrototypes`/`mintedByLayer`, the `handler` map, the
`translateUserData` slot). The proposal asks for an **opt-in additive**
per-Supervisor registry scope (`{ registryScope: 'isolated' }`, default
`'shared'` = today) so a host can isolate graphs without changing single-graph
behavior.

## Feasibility verdict

**Achievable, but NOT as a bare supervisor flag.** The good news: the isolation
surface is small — every cross-graph coupling funnels through one module
(`registry.ts`) and three directed seams:
1. `new Node(...)` self-registers globally (`registerNode(this)`, node.ts:437)
   and resolves serialized parent refs via the shared `byId` (node.ts:456).
2. `handlerDefs` — resolved + compiled at the consumer binding seam (node.ts:1750)
   from the global map.
3. `translateUserData` — read at the legacy bridge (legacy-handlers.ts:371) from
   the single module slot.

The bad news: the scope **cannot** be a bare Supervisor option, because seams 1
and 2 never touch the Supervisor — the Node class self-registers and
self-resolves. The scope must thread through the **Node constructor** + every
registration/read site, and the correct *key* is the **hub (a graph-context)**:
Node already carries `this.hub`; every existing graph-boundary fix
(`p.hubFor === this.hub`, `n.parent === target`) keys on hub identity; and
translate/supervisor/serialize already thread the hub. Keying scope on the hub
makes the guarantee **structural** and keeps scope congruent with hub identity —
the only way to guarantee the previously-fixed cross-graph leaks (ADV-C-S12,
ADV-KEYED-S15) do not reappear.

## The non-negotiable — the handlerDefs code-carriage breach (D1)

This is the one seam that is not a name-collision or clobber; it is
**cross-graph code execution**. A graph-B handler-def body registered by name
into the global map is resolved (node.ts:1750) + compiled (the `new Function`
gate, registry.ts:56) + executed inside any graph-A consumer that binds the same
name — with whatever IPC/permissions the security-pane body carries. For a
security boundary this is the definitive hole. It must be per-scope **resolution
AND compilation**, not merely registration. **Acceptance test**: an `'isolated'`
graph must never resolve or compile a handler-def body registered in any other
scope.

## Gaps + costs-benefits

- **Node-class design inversion (cost).** The module-level registry exists so
  the Node class stays free of global-state bookkeeping (registry.ts:2);
  isolation forces Node to become scope-aware (it must register against its own
  set). Unavoidable, confirmed at node.ts:437/456.
- **Blast radius (~6 modules / ~15 accessor sites).** registry.ts (all exports),
  node.ts (constructor + seam reads + `teardownMinted`), translate.ts, ops.ts,
  supervisor.ts, legacy-handlers.ts. Uniform shape (a scope object alongside the
  hub) but the principal regression risk is in the single-graph default.
- **Sweep-scheduler change (cheap).** Pass-2 is already per-graph in effect (the
  isolated sweep iterates fewer nodes — a win, not a loss). The only real cost
  is the module scheduler flag (registry.ts:225): a **hub-tagged single
  coalescer** (one timer, per-hub dirty partition/destroy sets) preserves the
  coalesced-sweep efficiency — NOT a per-scope timer (the expensive misread).
- **Unguarded plain layer-apply teardown.** `teardownMinted` (node.ts:725)
  iterates `mintedByOrigin(layerId)` with NO parent guard (the keyed rows path
  guards with `n.parent === target`, ops.ts:377). Without a guard a graph-A
  `removeLayer` on a layerId shared by a graph-B node of the same id detaches
  graph-B's minted node. `mintedByLayer` is node-id-keyed (DEFECT #23), which the
  proposal's §3 table omitted/wrongly listed as safe.

## Recommended shape (D1..D8) — the disposition

**PROCEED, only in the reshaped hub-keyed form — never the bare flag.**

- **D1 — Scope = graph-context keyed on hub identity** (not a supervisor flag);
  threaded where the hub already is (constructor, translate, supervisor, render,
  serialize). Guarantee: scope congruent with hub; every cross-graph seam keys on it.
- **D2 — Per-scope handlerDefs resolution + compilation (security-critical,
  the acceptance criterion).** An isolated graph resolves/compiles bodies only
  from its own def registry. Definition of done.
- **D3 — Per-scope `byId`/`resolveNodeRef`/`registered`** (constructor
  self-registration + serialized-parent resolution stay scope-local).
- **D4 — Per-scope `translateUserData`** (per-hub slot; closes the single-slot
  clobber, registry.ts:43).
- **D5 — Guard the plain layer-apply teardown** with the same `parent ===
  target`/hub check the keyed path already has (ops.ts:377) — closes the
  cross-destroy of another graph's minted set.
- **D6 — Hub-tagged single sweep coalescer** — one module timer, per-hub dirty
  partition/destroy sets (preserves coalesced efficiency).
- **D7 — Pin EventBridge-per-graph** so graph A events never reach graph B.
- **D8 — Default `'shared'` pinned as zero-change (NON-BREAKING, verified
  2026-08-25).** The default must resolve to the CURRENT module-level singleton
  registry, NOT to a per-hub isolated scope. This is a subtle but decisive
  point: a single-graph host commonly calls `translateLegacy(doc)` with NO hub
  (translate.ts:1070 defaults to a FRESH `createLinkHub()` per call) and then
  `new Supervisor({ events })` (supervisor.ts:147 → `this.hub = null`). If the
  default were hub-keyed isolation, EVERY translate call would silently become
  its own scope — breaking the shared `registered`/`byId`/sweep/`translateUserData`
  those hosts rely on (e.g. the smoke's same-id re-seeded graphs sharing one
  `byId`, registry.ts:286-290). Therefore:
  - The **default** (no isolation opt-in) continues to use the module-level
    singleton registry exactly as today — zero behavior change, byte-identical
    tests.
  - The **isolated** scope is an EXPLICIT host opt-in (e.g. a
    `{ graphScope: 'isolated' }` option on translate/Supervisor/render), and
    only then does the scope key onto a hub/graph-context. The presence of the
    opt-in — NOT the hub — decides isolation. A default hub-less or fresh-hub
    host never isolates.
  - The "hub-keyed" phrasing in D1 means the ISOLATED scope is keyed on the
    hub (so its guarantee is structural); it does NOT mean the default derives
    isolation from hub presence. These are distinct.
  - Regression gate: the full trio (`npm test`, `npm run typecheck`, `npm run
    demo:smoke`) plus the existing cross-graph tests (the smoke's same-id
    re-seeded graphs, ADV-C-S12 def-census, ADV-KEYED-S15 parent guard) must
    pass UNCHANGED with no opt-in in play.

**Fallback (evaluate before building): two package instances per graph** — the
host runs one process but two bundled copies of the package, giving graph B its
own module-level registry with ZERO engine change. For a hard security boundary
this is the honest cheapest-correct option if bundling cost is acceptable. The
hub-keyed scope is preferred only if a single instance is required (shared
bundle / single worker / cannot instantiate two copies). Capture this fallback
in the spec, not silently.

**Full validation trio on landing (item 4):** `npm test`, `npm run typecheck`,
`npm run demo:smoke`; watch the d12 pass2/compile multiples — the hub-tagged
coalescer must not blow up the pass-2 pipeline. The subsequent blind-test
(AGENTS.md item 10) + stress-test (item 11) sub-agent loops run on the Mimo-2.5
model; if the delegation mechanism cannot switch the model for those sub-agents,
PAUSE and wait for the user to switch — never run them on another model.

## Gate record

- Step 1 validity — **VIABLE-WITH-RESHAPE** (scope must thread the Node
  constructor; `mintedByLayer` node-id-keyed omitted from §3; `contentNodes`
  Node-keyed not Link-keyed).
- Step 2 critique — **NEEDS-RESHAPE** (four live leak seams; the handlerDefs
  code-carriage is a security breach; better shape is hub-keyed graph-context).
- Step 3 change-analysis — **PROCEED-AS-RESHAPED** (this verdict).
- All three read-only; no files edited by the gate. The proposal + this review
  go through the AGENTS.md item 6 step gates before any spec/implementation work.
