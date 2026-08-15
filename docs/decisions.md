# Active Decisions Summary

Maintained by the document-archival loop (AGENTS.md item 6): every decision
that pins current behavior, with its source and status. ACTIVE = governs the
current engine; SUPERSEDED = replaced by a later decision (recorded for
provenance); rows are archived (`archive/`) when a cleanup pass retires them.
Canonical decision records: `RENDER_PROCESS_NOTES.md` §10.10 (DECIDED:
entries) + the dispositions in `live-prod/placeholderLanding/FINDINGS.md`.

## ACTIVE

| Decision | Date | What it pins | Source |
| --- | --- | --- | --- |
| **D1 — placement arrays canonical** | 2026-08-14 | `placement: PlacementConfig[]` per-node; every entry maps (container mint / ordered content anchors); `[]` legal no-warn; `placement-entry-invalid` for bad entries; object convenience kept; reverse flat-merge / multi-producer array | FINDINGS D1, translate.md |
| **D2 — content is array-only** | 2026-08-14 | `doc.content: ContentPayload[]`; ANY non-array warns `payload-shape-obsolete` + skip (the `{content, metadata}` object form is OUTDATED legacy) | FINDINGS D2, translate.md |
| **D3 — css.style serialization** | 2026-08-14 | `css.style` objects serialize at translate to kebab-case `k: v;` strings; reverse ALWAYS parses back to objects (no provenance, F7) | FINDINGS D3, translate.md |
| **D4 — cssDef rules** | 2026-08-14 | cssDef → deduped stylesheet rules (`{sel}{k: v;}`, media-query nesting) from actionable states only; zero-or-one styles op per sweep | FINDINGS D4, render.md §3.4.1 |
| **D5 — content is TEXT-ONLY** | 2026-08-14 | No dual-parse (`content` = text only; `children` = nodes only; `children-shape-invalid` for non-arrays; `children-entry-invalid` for bad entries) | FINDINGS D5, translate.md |
| **D6 — handler defs parked** | 2026-08-14 | Legacy handler defs in `template.component` are not wired (K3 `component-binding-empty` fires; dead-as-components, no crash); TODO marker in handlers.md §6 | FINDINGS D6, handlers.md |
| **D7 — anchor-layer seam** | 2026-08-14 | `type`/`content`/`children` targets plan with `options.seam`; def children pre-minted as `'component'`-token prototypes; parent anchors on the resolved node; consumer's own parent untouched; multi-parent legal (G24) | FINDINGS D7, ops.md §2.7 |
| **F13 — content-target = text only** | 2026-08-14 | `target: "content"` delivers the def's TEXT; subtree delivery via `children`/`type` (the envelope was re-expressed accordingly) | FINDINGS F13 |
| **SED — delivery shapes** | 2026-08-14 | `type` = SHELL COLLAPSE (consumer becomes the def element); `children` = node data AS-IS + def-root added; `content` = text only | render.md §3.4.2 SED-1..3 |
| **B1 — children-target never collapses** | 2026-08-14 | The seam children-target keeps the consumer's OWN element, text, and authored children untouched; the def-root joins as an ADDITIONAL child (both empty and non-empty hosts) | user clarification, render.md SED-2 |
| **EMPTY-OWNER** | 2026-08-14 | Empty placement owners render `display: none` ONLY when they carry no renderable information (no text, no authored css.style); authored display wins | user rules, render.md §3.4.3 |
| **Veto = loop-prevention only** | 2026-08-14 | `placement-name-vetoed` fires ONLY when a family ancestor would attempt to place into the zone (`content` anchor); DUPLICATE presentation is legal | user correction, placement-path-spec §1.3 |
| **Placements never shadow** | 2026-08-14 | Placement resolution = best-fit `targetPlacement` + consume-ALL-zones (path-multiplicative fan-out); nearest-shadows-far is COMPONENT resolution only | user correction, placement-path-spec §1.2 |
| **S19 — value+target ⇒ duplex** | 2026-08-15 | A binding with BOTH value and target plans a DUPLEX anchor (not source); the self-provider seam materializes; seam detection reads target AND duplex | user directive, translate.md |
| **DEFECT #9 — clone link reuse** | 2026-08-15 | clone() REUSES the shared per-name registry Link for name-keyed roles; fresh links only for genuinely new connections (family-child attach) | user directive, node.ts clone() |
| **DEFECT #11 — runtime nodes reverse as nothing** | 2026-08-15 | clone-instance is HANDLER-LOGIC ONLY (never needed by translate or the base engine — the graph redesign removed literal cloning from placement/component logic); runtime-minted clones reverse as NOTHING (authored envelope = base truth) | user directive, payload.md §4, ops.md §2.4 |
| **DEFECT #10 — layer anchors die with their layer** | 2026-08-15 | removeLayer/removeLayersForSource remove the layer's GENERATING anchors (node.md §6.2); materializeSeam's reversion pass unwinds seam links whose driving seam anchor is gone (seam parents tagged `seamTarget`); materializeSeam runs for every viable node | node.md §6.2 letter, stress round 4 S37/S38 |
| **Path-fork baseline (§8-Q6)** | 2026-08-14 | The static path-fork page's single total is its OWN placement baseline; smoke records `[path-fork:baseline]`; §8-Q6 re-baseline TODO open | placement-path-spec §10.ad |

## SUPERSEDED

| Decision | Date | Replaced by |
| --- | --- | --- |
| "The translate-time §1.3 ancestor veto is NOT implemented (op-time only)" | — | DEFECT #3-1 fix (2026-08-14) — the veto fires at BOTH phases |
| "The D7 seam's SED-2 wrapper shell drops its own text" | 2026-08-14 | B1 (2026-08-14) — node data as-is |
| "Duplex is legacy-unexpressible" (K1/K2-era) | — | S19 (2026-08-15) — value+target ⇒ duplex IS expressible |
| "Cloned anchors always point to fresh links" (Pillar D-era) | — | DEFECT #9 (2026-08-15) — name-keyed links shared |

Canonical records: `RENDER_PROCESS_NOTES.md` §10.10 (DECIDED: entries),
`live-prod/placeholderLanding/FINDINGS.md` (dispositions + user rulings).
