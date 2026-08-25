# Feature Request — Multi-Graph / Registry Isolation (per-Supervisor registries)

**Status**: **REVIEWED — PROCEED-AS-RESHAPED (three-agent gate, 2026-08-25) →
PARKED for a future post-0.2.0 minor batch.** The gate verdict + the reshaped
hub-keyed shape (D1-D8) are in `docs/specs/multi-graph-isolation-review.md`.
**Filed by**: the Provident-Electron consumer (the Electron shell that tests
`provident-ssr` in a deployable environment).
**Date**: 2026-08-25.
**Target**: a FUTURE minor batch (post-0.2.0). This is a consumer-driven
feature request, not a defect — the current single-graph model is correct and
documented; this asks for an OPT-IN isolation surface the multi-graph host
needs. **The bare per-Supervisor flag form is REJECTED — the isolation requires
a hub-keyed graph-context scope (see the review).**

---

## 1. The use case (security / isolation)

The Provident-Electron shell renders an app through the provident graph and
exposes it to MCP agents (`provident.dispatch`, `get_rendered_html`,
`get_markdown`, `list_targets`, `get_node_state`). The shell's project-wide
constraint is that **every non-shell UI element is rendered with the provident
framework** — including the operator-facing **Security Settings pane** and the
**Debug / agent-visibility pane**.

The security pane is **manual-UI-only by construction** (an agent must never
be able to grant itself capabilities — `mcp-endpoint.md` §6.4). Its controls
(token clear/regenerate, per-group permission toggles) are exactly the kind of
UI the constraint says must be provident-rendered. But the pane is a
**different trust domain** from the app it administers:

- The **app graph** is agent-visible and agent-drivable (dispatch, read).
- The **security pane** must be operator-only — an agent must not be able to
  `dispatch` a click on the "enable code group" toggle, or read the token
  value, through the same graph the agent already has access to.

If both live in ONE graph, the agent's existing `dispatch`/`get_rendered_html`
access to that graph would also reach the security controls — defeating the
trust gate. The host needs a way to render the security pane through the
provident framework while keeping it **isolated from the agent-visible graph**.

This is the concrete, real-world driver for **multi-graph / registry
isolation**: two (or more) provident graphs in one process, each rendering to
its own root element, with **no cross-graph addressability** — an agent with
access to graph A cannot see, dispatch, or read graph B.

## 2. What the host wants to do

```
┌─ renderer (one process) ─────────────────────────────────────────────┐
│                                                                       │
│  Graph A — the app (agent-visible)          Graph B — security pane  │
│  Supervisor A + DomAdapter A → #app         Supervisor B + DomAdapter │
│  exposed to MCP: dispatch/read              B → #settings-pane       │
│  (the agent's surface)                      NOT exposed to MCP       │
│                                            (operator-only, manual-UI)│
│                                                                       │
│  Graph B's handlers call the IPC bridge                               │
│  (window.provident.security.set) — never an MCP tool                 │
└───────────────────────────────────────────────────────────────────────┘
```

The host already has the per-mount `DomAdapter` and the pure
`renderProducingProcess` seam — so **two graphs rendering to two roots is
architecturally possible today**. What is NOT cleanly possible is the
**isolation** between them, because the package keeps a **process-wide shared
registry** (see §3).

## 3. The current blocker — the shared module-level registry

`src/core/registry.ts` owns **process-wide singletons** shared across ALL
`Supervisor` instances in the same module instance:

| Shared state | Collision / leak risk for two graphs |
| --- | --- |
| `registered: Set<Node>` + `byId: Map<NodeId, Node>` | Node ids must be **globally unique** across graphs, or `resolveNodeRef`/`byId` collide (last-registered wins). A graph B node could resolve a graph A parent ref. |
| `runSweep` (the post-op sweep) | Iterates **all** registered nodes across every graph — a destroy in graph A participates in the same sweep as graph B; a graph B node could be finalized by a graph A teardown. |
| `contentNodes`, `defPrototypes`, `defRootPrototypes`, `mintedByLayer` | Keyed by `Link` object identity — **safe** if each graph uses its own hub (distinct Links), but the sweep + `byId` still couple them. |
| `handlerDefs: Map<string, HandlerDefRecord>` | Two graphs registering the same handler-def **name** collide (last wins). |
| `translateUserData` (single slot) | **Real collision** — the last `translateLegacy` wins. Concurrent translates of two graphs clobber each other's userData. |

Consequence: two graphs in one process are **not cleanly isolated**. The host
can work around id-uniqueness and per-hub Links, but the shared
`translateUserData` slot and the global sweep mean a teardown or translate in
one graph can affect the other. For a **security boundary** this is
unacceptable — the whole point is that graph B (the security pane) must be
provably unreachable from graph A (the agent surface).

## 4. The requested surface (OPT-IN, additive)

A per-Supervisor (or per-graph) **registry scope** so a host can opt into
isolation without changing the default single-graph behavior:

1. **Per-supervisor registry scope** — a `Supervisor` option (e.g.
   `{ registryScope: 'isolated' }`, default `'shared'` = today's behavior) that
   gives that supervisor its OWN `registered`/`byId`/`contentNodes`/
   `defPrototypes`/`mintedByLayer`/`handlerDefs`/`translateUserData` instead of
   the module-level singletons. The sweep runs per-scope, not process-wide.
2. **No cross-scope addressability** — a node in scope A is never resolvable
   from scope B (`resolveNodeRef`, `getNode`, `allNodes`, the sweep, the
   def-prototype registry all stay scope-local). This is the security
   guarantee the host needs.
3. **Per-scope `translateUserData`** — each scope carries its own userData
   slot, so concurrent translates of two graphs never clobber each other.
4. **Per-scope handler-def registry** — handler-def names are scoped, so two
   graphs can register the same name without collision.

The default stays `'shared'` (the current, documented, single-graph behavior —
zero change for existing consumers). The isolated scope is a host opt-in for
the multi-graph security case.

## 5. Why this is a feature request, not a defect

- The single-graph model is **correct and documented** (Pillar A/B — one
  producing process, one graph, one render surface). Nothing is broken.
- The shared registry is a **deliberate design** (module-level so the `Node`
  class stays free of global-state bookkeeping — `registry.ts` header).
- The multi-graph host is a **new consumer shape** the package does not yet
  serve: it needs isolation, not a fix to existing behavior.

## 6. Open questions for the future gate

- **Scope granularity (RESOLVED 2026-08-25 — see the review §D8):** per-`Supervisor`
  vs a shared "graph context" object. The verdict: an EXPLICIT opt-in decides
  isolation — NOT hub presence. A default single-graph host calls
  `translateLegacy(doc)` with a FRESH hub per call (translate.ts:1070) and often
  a hub-less `Supervisor` (`this.hub = null`, supervisor.ts:147); if isolation
  derived from the hub, every translate would silently isolate and break the
  shared registry. So the default (no opt-in) MUST keep the module-level
  singleton registry — zero-change, non-breaking — and the ISOLATED scope is an
  explicit opt-in threaded through translate/supervisor/render, keyed on a
  hub/graph-context for a structural guarantee.
- **The sweep**: per-scope sweep scheduling vs a scope-tagged global sweep.
- **`LinkConfigNameHub`**: already per-hub (distinct Links) — confirm the
  isolated scope also isolates the hub, or keeps the shared hub for
  cross-graph component reuse (probably NOT — isolation is the point).
- **Cost**: the module-level registry exists partly for the coalesced sweep
  efficiency; per-scope registries trade that for isolation. Acceptable for
  the security case (small graphs), but the pricing should be pinned.
- **Relationship to the parked `Supervisor.reset()`/`prune()`/`unregisterNode`
  row** (REQ-GAP-11, REJECTED): an isolated scope is a DIFFERENT surface — it
  does not add reset/prune; it scopes the existing registry. The REJECTED
  shapes stay parked.

## 7. Consumer status

The Provident-Electron shell is currently working around this by keeping the
security pane's **data** in the main process (over IPC) and rendering the pane
through the SAME graph as the app — which is acceptable for the demo but does
NOT satisfy the isolation requirement for a real deployment. The shell will
adopt the isolated-scope surface when it ships.

---

*Filed as a feature request from the Provident-Electron consumer. No package
code changed; no gate run. This document is the recorded use case + requested
surface for a future minor batch.*
