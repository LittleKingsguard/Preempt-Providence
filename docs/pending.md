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
| **Legacy-handler reuse — the ORIGIN-OWNER element (CORE LANDED 2026-08-15 — moved to decisions.md)** | 2026-08-15 | ~~AFTER the other legacy-handler decisions are addressed (review §7 gate)~~ — RESOLVED: the element's CORE (the `layer-apply` op, minted-set registry, pre-detach teardown, reverse exclusion) shipped with the O1–O9 pins in tests/unit/legacy-shape-ops.test.ts | The unpark acceptance criteria (review §12.4) are implemented; the review §12.4-7 OPEN items stand: serialization fate (A2 — runtime-only + promotion), non-child-anchor cleanup vs render-path prune (A4), and the FUTURE preservation-by-reversal flag (NOT-YET-IMPLEMENTED row below). The legacy-bridge children-injection mapping (receiveNextState({children}) → ONE layer-apply) LANDED with the runtime bridge (user directive 2026-08-15 — review §7 decision 2 superseded; decisions.md HANDLER-SEAM + ORIGIN-OWNER rows; ops.md §2.8 OO-7) |
| **D6 — legacy handler defs** | 2026-08-14 | **SUPERSEDED — the handler-seam LANDED 2026-08-15** (decisions.md HANDLER-SEAM row): defs register by name, `handlers.<event>` targets wire provenance-marked handler layers (K3 superseded for the def shape only) | tests/unit/legacy-shape-translate.test.ts H1-H6 |
| **§8-Q6 — path-fork ratio re-baseline** | 2026-08-14 | After the runtime pages' stability confirms no explosive time issues (smoke records `[path-fork:baseline]` each run) | The static page's single total is its OWN placement baseline; tripwire: static > runtime placement |
| **RENDER_PROCESS_NOTES → decisions.md fold** | 2026-08-15 | A future archival pass | The notes carry 71 §10.x provenance citations; decisions.md supersedes §10.10 as the ACTIVE reference |

## PENDING (awaiting the user gate)

| Item | Date | Gate |
| --- | --- | --- |
| **DEFECT #12 fix — the ops detach/move sibling wipe** | 2026-08-15 | User gate on the legacy-handler-reuse review (§7 decisions); the fix changes runtime detach/move behavior (siblings currently cascade-destroyed on one child's detach). Spec-true fix shape + records: docs/defects.md (DEFECT #12 OPEN), legacy-handler-reuse-review.md §12.5 |
| **Legacy-handler reuse — the 8 review decisions** | 2026-08-15 | ~~legacy-handler-reuse-review.md §7 (PROCEED-WITH-CHANGES)~~ — RESOLVED 2026-08-15: decision 1 (event-only scope) adopted; decision 2's children-injection CUT is SUPERSEDED by the user directive (ships via the origin-owner `layer-apply` op — receiveNextState({children}) → ONE layer-apply); decisions 3 (NodeView proxy), 4 (arg-order wrapper + event stub + format marker), 5 (QueryUtils adapter-internal), 6 (userData read-only) LANDED with the runtime bridge (decisions.md HANDLER-SEAM row; handlers.md §6; legacy-bridge.test.ts B1-B8; legacy-shape-translate F1-F8); decision 7 (wiring seam + D6 un-park + K3 supersession + reverse) landed earlier (H1-H6); decision 8's rejects (Option C source transform; the composite children-replace op) stand |
| **Translate-stress probe mismatches** | archived 2026-08-15 | The `archive/test-data/2026-08-15/` scenario sets' red-by-design entries (RESULTS.md) — engine/doc gaps awaiting classification and TDD passes |

## NOT-YET-IMPLEMENTED features

| Feature | Specified in | Notes |
| --- | --- | --- |
| **Layer preservation-by-reversal flag** | legacy-handler-reuse-review.md §11 (user ruling 2026-08-15) | A future feature: flag an anchor layer for PRESERVATION BY REVERSAL — origin-owned nodes created under a preserved layer reverse as deliberate edits (not excluded) |
| **QueryUtils drift-prone keys** | legacy-handler-reuse-review.md | **LANDED 2026-08-15 — moved to decisions.md HANDLER-SEAM row / handlers.md §6:** the adapter-internal query surface is `type`/`id`/`classes`/`props` (exact-eq) + predicate functions; drift-prone keys (style/handlers/components/hasNonTypeTargetComponents, …) warn `legacy-query-unsupported` ONCE per dispatch and match NOTHING (the review §7 decision-5 "support-or-warn" drift half did NOT land — warn-only is the contract) |
| **Event-dispatch wiring** | legacy-handler-reuse-review.md | `dispatchEvent` has no engine caller — page-side convention (DomAdapter.onEvent); SSR pages need a defined synthetic-event contract |

## SPECULATIVE proposals

| Proposal | Date | Constraints recorded |
| --- | --- | --- |
| **Origin/owner link type** (generalized create-owned-subtree) | 2026-08-15 | The origin/owner mechanism is the generalization of the anchor-layer + seam-link machinery (already engine-level: layers carry anchors, the role-scoped exemption admits layer-decl'd children, DEFECT #10 removal is symmetric, `runtimeMinted` excludes from reverse). **CORE LANDED 2026-08-15** — the `layer-apply` op is now an engine primitive (ONE journal entry — atomic, replayable, teardown = a single layer removal; decisions.md ORIGIN-OWNER row). Scope: engine-general in form (clone-instance and dynamic content injection could eventually ride it), and the legacy-handler bridge IS the committed consumer — its children-injection mapping (`receiveNextState({children})` → ONE layer-apply) LANDED with the runtime bridge (user directive 2026-08-15; handlers.md §6; ops.md §2.8 OO-7) — other consumers stay speculative. Chain semantics: origin-owned nodes are family-in-tree via the layer links (like clones); the teardown's pre-detach predicate detects the loss of a traceable permanent parent and deletes the node; the explicit origin marker doubles as the reverse-exclusion marker (the future preservation flag opts in). |
