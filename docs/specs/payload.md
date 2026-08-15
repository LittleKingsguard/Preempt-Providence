# Spec — Payload Lifecycle & Reverse Translation

Derivative of `RENDER_PROCESS_NOTES.md` §10.10.1/§10.10.4 (DECIDED) and
`translate.md`. Behavior contract for the TestWriter — every state and
fail-state below is testable (`payload.test.ts`, `reverse.test.ts`,
`payload-flow.test.ts`, `e2e/payload-refresh.test.ts`).

---

## 1. Sources of truth

The **root node** and the **content/component arrays** are the primary
sources of truth for what the graph can access. Every other node has an
ORIGIN that decides its fate when it loses tree visibility:

| Origin | On placement-detach (payload alive) | On payload drop | On explicit destroy |
| --- | --- | --- | --- |
| Payload content/component (registered) | **persists** in the background (placement may return) | **destroyed** — even if placed | destroyed |
| Handler-created (no basis) | **discarded** (sweep destroy) | n/a | destroyed |
| Root / template children | destroyed | n/a | destroyed |

> **P3 §3.3 note (placement removal):** the placement REMOVAL surface is the
> `placement-attach` inverse — removing a placement kills the removed node's
> path-states too (their wires leave `diffMinimal`'s next set → `remove` ops,
> D2); the node itself stays registered/persistent per this table (placement
> may return).

Registration: `registerContentNode` / `unregisterContentNode` / `isContentNode`
(registry.ts). `translateLegacy` registers every content root; payload ops
manage registration on refresh/append.

## 2. Public surface

```ts
interface Payload { id: string; roots: Node[]; metadata?: unknown; userData?: unknown }

function dropPayload(payload: Payload): void
function refreshPayload(payload: Payload, newRoots: Node[], parent: Node): void
function appendToPayload(payload: Payload, nodes: Node[], parent: Node): void
function nextPriority(parent: Node): number
```

## 3. Semantics

| # | Rule |
| --- | --- |
| P-1 | `dropPayload` unregisters each root, then detaches it — the sweep finalizes it even when it was PLACED; `payload.roots` clears. Sibling payloads and nodes on the shared family link are untouched. |
| P-2 | `refreshPayload` drops old roots (P-1) and attaches new roots under `parent` (priorities continue after existing children); new roots are registered as content and become `payload.roots`. Same-tick re-attach blocks destruction of any overlap. |
| P-3 | `appendToPayload` registers and attaches new nodes (websocket append); existing roots stay untouched. |
| P-4 | A registered content node detached while its payload still owns it persists (sweep skips content nodes) — re-placing it later is legal. |
| P-5 | An unplaced registered content node is never destroyed by the sweep. |
| P-6 | A handler-created node (unregistered) that loses root visibility is discarded by the sweep. |
| P-7 | The sweep never tears down a shared family link during a single-node detach — only this node's child anchor is removed; the parent side dissolves when the last child leaves (S-R3.4). |
| P-8 | `nextPriority` = max existing child priority + 1 (0 when childless). |

## 4. Reverse translation (`reverseTranslate`)

```ts
interface ReversePayloadGroup { roots: Node[]; metadata?: unknown; userData?: unknown }
interface ReverseTranslateOptions {
  content?: Node[]; metadata?: unknown; userData?: unknown   // single ContentPayload
  payloads?: ReversePayloadGroup[]                            // one ContentPayload per group
}
function reverseTranslate(root: Node, opts?): LegacyInitialData
```

**Envelope shape contract (D2, 2026-08-14 — SPEC-ENCODED, fix pass PENDING;
expect RED):** the reversed document ALWAYS
emits `content` as an ARRAY of payloads (`ContentPayload[]`) — the obsolete
single-payload OBJECT form `{content, metadata}` is never emitted (it is
outdated legacy; translate warns `payload-shape-obsolete` on ANY non-array
`content`, translate.md §2/§3). `R-4`'s single-group `opts.content` emits a
ONE-ELEMENT array.
**Payload item content (D5, SPEC-ENCODED, fix pass PENDING):** payload
`NodeData.content` values are TEXT
only — the legacy dual-parse (content as NodeData ⇒ children) is discontinued;
children reverse from the `children` field only.
**D3/F7 reverse (2026-08-14 — SPEC-ENCODED, fix pass PENDING; expect RED):**
a node's serialized `css.style` STRING is
ALWAYS parsed back to the `Record<string,string>` object on reverse — no
provenance tracking; a string-authored style becomes an object on save
(legacy format is object-native, accepted). The string form is never
re-emitted.
**D1/F2 reverse (2026-08-14 — SPEC-ENCODED, fix pass PENDING; expect RED):**
placement reverses as ONE flat object per
node (merged anchors: `placementName` + `targetPlacement: string[]` in mint
order); only a multi-producer node (2+ container anchors) emits the `placement`
ARRAY (one entry per container anchor, content names in the first entry);
re-translate of either emission is anchor-identical (translate.md TR-H11).
**D7/F20 reverse (2026-08-14 — SPEC-ENCODED, fix pass PENDING; expect RED):**
seam-wired def children are NOT emitted as
the consumer's authored `data.children` — they stay in the def's JSON home;
the consumer reverses with its authored children ONLY (translate.md TR-H16).

| # | Rule |
| --- | --- |
| R-1 | Template root + authored in-tree children (EXCLUDING content roots) → `template.root`/`template.children`; content roots emit as ContentPayload items, never template children — placement/component-induced tree state is reversed. |
| R-2 | Component bindings map back to `component.reference` (lifted to `template.component` for the root); placement anchors → `placement.placementName`; **`content` anchors → `placement.targetPlacement: string[]` in MINT order** (preference order preserved — P3 §6.2 reverse rows), plus the derived `activePlacement: string` read (P3 §2.5); the minted `contentNodes` permanent-owner anchor is **STRIPPED** on reverse (P3 §10.ad/F-13) — the reverse never ships the token edge. **K5 (landed):** the apply path persists on anchor options (`options.applyPath`) and emits as the legacy `target` field — consumer `{reference, target}`, provider `{reference, value, target}`; anchors WITHOUT an apply path emit the pre-kernel form (`{reference}` / `{reference, value}`). The runtime duplex shape is legacy-unexpressible: **any applyPath-less non-provider (consumer) anchor coexisting with a provider anchor on the same node is DROPPED** — this covers the name-target (no apply path) AND, because the drop is shape-based, the DECIDED plain-consumer form `{reference}` and gap/skipped-target consumers, whose graph shape is indistinguishable from the runtime two-name duplex (the reverse never emits a two-name duplex — `target` means apply path, never a second name; broadened from "a name-target" per stress scenario 10) — and same-reference runtime forks keep the first provider (legacy rejects duplicate references, K8 blocks them pre-anchor on re-translate). Multi-binding nodes reverse as the K7 array form, one binding per component anchor in anchor order. |
| R-3 | USER-CREATED edits are preserved: type/content/props/css/handlers read from the LIVE node state. |
| R-4 | `opts.payloads` emits one ContentPayload per group (metadata/userData per group); `opts.content` emits a single group. |
| R-5 | The reversed document re-translates through `translateLegacy` (round-trip) — apply-path bindings round-trip exactly (`{reference, target: 'props.<k>'}` re-synthesizes the same anchor + `bindings.*` derived read). **N1 (landed):** the translate-synthesized derived keys (K2 `bindings.*` machinery) are STRIPPED on reverse; authored derived stays, so the reversed doc carries no Preempt-only derived pollution and re-translates without self-collision (`component-target-skipped`/duplicate warnings never fire from the round-trip). |

## 5. Exhaustiveness gate

| ID | State | Expected |
| --- | --- | --- |
| P-H1 | placed payload root dropped | destroyed after sweep; siblings untouched |
| P-H2 | unplaced payload root dropped | destroyed (unregistered + pending) |
| P-H3 | registered content detached (placement removed, payload alive) | persists unplaced |
| P-H4 | same-tick re-attach after drop | survives |
| P-H5 | refresh replaces roots | old destroyed, new in-tree, other payloads intact |
| P-H6 | append (websocket) | new nodes in-tree, priorities continue, roots extended |
| P-H7 | handler-created node loses visibility | discarded |
| P-F1 | drop/refresh on a shared family link | siblings never torn down |
| R-H1 | reverse round-trip | template/content/payloads/placements/components preserved |
| R-H2 | user edit | preserved in reversed output |
| R-H3 | per-payload groups | separate ContentPayloads |
| R-H4 | reverse emits the payload envelope (D2) | `content` is ALWAYS a `ContentPayload[]` array — never the obsolete `{content, metadata}` single-object form; `opts.content` emits a one-element array |
| R-H5 | payload item `content` values (D5) | text-only on reverse — NodeData values never appear in `content` (dual-parse discontinued); children reverse from `children` only |
| R-H6 | reverse style strings (D3/F7) | a serialized `css.style` string parses back to the `Record<string,string>` OBJECT on reverse — ALWAYS, no provenance (string-authored styles become objects on save; accepted, legacy-format is object-native) |
| R-H7 | reverse placement shape (D1/F2) | ONE flat object per node (merged anchors; `targetPlacement: string[]` mint order); multi-producer node (2+ container anchors) → `placement` ARRAY (one entry per container anchor, content names in the first entry); re-translate anchor-identical |
| R-H8 | seam children on reverse (D7/F20) | seam-wired def children NOT emitted as the consumer's `data.children` — they stay in the def's JSON home; the consumer reverses with its authored children only |
| R-F1 | dropped/refreshed payload | no longer present in reversed output |

> **Rows R-H4..R-H8 are SPEC-ENCODED (2026-08-14 — fix pass PENDING; a
> TestWriter reading this file alone expects RED for these rows until the
> engine fix pass lands).**
