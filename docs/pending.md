# Pending — parked decisions, not-yet-implemented features, speculative proposals

Maintained by the document-archival loop (AGENTS.md item 6). This tracker
holds what is NOT decided/landed: deliberately parked decisions (with their
revisit condition), pending decisions (awaiting the user gate), features
specified but not implemented, and speculative proposals (design constraints
recorded, no commitment). When an item lands, it moves to `docs/decisions.md`
or `docs/defects.md` (or the specs) and is removed here.

## PARKED decisions (deferred deliberately — revisit when the condition hits)

| Item | Parked (date) | Revisit when | Design constraints recorded |
| --- | --- | --- | --- |
| **Placeholder node feature** | 2026-08-16 | If the user wants the deterministic auto-clear variant (a `placeholder` NodeData field rendered ONLY for the EMPTY-OWNER case — content-driven, host-text, never a separate wire — the async "render while pending" + "separate op batch first" halves are REJECTED by the three-agent gate: the pipeline is one microtask (no pre-paint window), the stale/mid-pass-2 trigger is unobservable, and EMPTY-OWNER-1a already expresses the loading state today) | docs/specs/placeholder-node-review.md (full gate: status / feasibility / gaps + costs-benefits; disposition table) |
| **Set-op batching: style-write coalescing (B)** | 2026-08-16 | If the apply step ever becomes write-lookup-bound (currently it is style-machinery + live-tree-attachment bound — ~18µs/op real-browser on the fork pages; the per-set element lookup is ~0.5% of it). B would fall out of a batched-set op shape, which the RenderOp contract ripple (render.test/e2e/treeFromOps/journal-replay pins) currently outweighs | The op-stream shape is a pinned contract; the write count is unchanged by batching; the real first-render levers are a detached-fragment initial build (A) and per-element style-write coalescing (B) — both adapter-level, not op-shape |
| **§8-Q6 — path-fork ratio re-baseline** | 2026-08-14 | After the runtime pages' stability confirms no explosive time issues (smoke records `[path-fork:baseline]` each run) | The static page's single total is its OWN placement baseline; tripwire: static > runtime placement |
| **RENDER_PROCESS_NOTES → decisions.md fold** | 2026-08-15 | A future archival pass | The notes carry 71 §10.x provenance citations; decisions.md supersedes §10.10 as the ACTIVE reference |

## PENDING (awaiting the user gate)

— none — (the last row, Translate-stress probe mismatches, closed 2026-08-16 — see next-steps.md RESOLVED)

## NOT-YET-IMPLEMENTED features

| Feature | Specified in | Notes |
| --- | --- | --- |
| **Layer preservation-by-reversal flag** | archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review.md §11 (user ruling 2026-08-15) | A future feature: flag an anchor layer for PRESERVATION BY REVERSAL — origin-owned nodes created under a preserved layer reverse as deliberate edits (not excluded) |
| **Event-dispatch wiring** | archive/reviews/2026-08-16/2026-08-16-legacy-handler-reuse-review.md + blind test #5 (2026-08-16) | `dispatchEvent` has no engine caller — page-side convention (DomAdapter.onEvent; the handlers-scenarios + live-prod harnesses dispatch load/click/input/submit and the after-compile phase manually, mirroring the supervisor). A FORMAL synthetic-event contract for SSR pages is still unspecified (the demo harness pattern is the de-facto convention — designing-pages §12 handlers-scenarios entry) |

## SPECULATIVE proposals

| Proposal | Date | Constraints recorded |
| --- | --- | --- |
| **Origin/owner link type** (generalized create-owned-subtree) | 2026-08-15 | The origin/owner mechanism is the generalization of the anchor-layer + seam-link machinery (already engine-level: layers carry anchors, the role-scoped exemption admits layer-decl'd children, DEFECT #10 removal is symmetric, `runtimeMinted` excludes from reverse). **CORE LANDED 2026-08-15** — the `layer-apply` op is now an engine primitive (ONE journal entry — atomic, replayable, teardown = a single layer removal; decisions.md ORIGIN-OWNER row). Scope: engine-general in form (clone-instance and dynamic content injection could eventually ride it), and the legacy-handler bridge IS the committed consumer — its children-injection mapping (`receiveNextState({children})` → ONE layer-apply) LANDED with the runtime bridge (user directive 2026-08-15; handlers.md §6; ops.md §2.8 OO-7) — other consumers stay speculative. Chain semantics: origin-owned nodes are family-in-tree via the layer links (like clones); the teardown's pre-detach predicate detects the loss of a traceable permanent parent and deletes the node; the explicit origin marker doubles as the reverse-exclusion marker (the future preservation flag opts in). |
