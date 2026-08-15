# Test Findings — centralized log of blind-test & stress-test review loops

Status: LIVE document. Every major-feature blind test / subagent review loop
appends its findings here (same discipline as `docs/session-defect-review.md`,
but process-focused: what the review tool caught, what it missed, and the
rules it produced). The latest entries are on top.

---

## Live-prod legacy-shape review loop (placeholderLanding) — 2026-08-14

Status: ENGINE FIX PASS COMPLETE + ACCEPTED. Full TDD loop landed (spec →
red → green): 69 legacy-shape tests (57 + seam-flow + SED delivery-shape
pins), suite 760 passed | 1 skipped, typecheck/build clean, demo-smoke OK
(census 4117/4094, ratios values ~1.2× / link ~1.5×, path-fork baseline
~2.6s < runtime placement). Acceptance: the placeholderLanding render now
matches the production snapshot structurally (`div > nav.nav-bar > [logo,
links, auth]`, `header.page-header > [h1, p > span]`, `footer.page-footer`,
def cssDef rules deduped in the styles block); residual compare blocks are
the allowed classes (ids, handlers, runtime-auth artifacts, darkreader
noise, style-prefix position). The article payload stays unrendered
statically (contentNodes-owned — placement-attach lifecycle, documented).
An EMPTY-PLACEMENT-OWNER rule (render.md §3.4.3) landed 2026-08-14: an
empty drop-zone container emits `display: none` — fixes the live modal
overlay graying out the page while its zone is empty (matches the legacy
snapshot's hidden sidebar/modal).
Source: `live-prod/placeholderLanding/FINDINGS.md` — the render comparison of
a REAL production legacy envelope (`placeholderLanding.json`) through
`translateLegacy → Supervisor → root.compile → emitElements → diffMinimal →
SSRFragmentAdapter` vs the production snapshot. Verdict: render did NOT
match — every structural diff traced to a translate/emit defect on valid
legacy shapes (all repo demos authored the non-legacy convenience forms, so
no test saw them). The envelope has since been re-expressed: top-level
`content` → canonical array form AND the four subtree-delivering
`target:"content"` bindings → `target:"children"` (F13 ruling).

### Defects found

- **D1** — `placement: [...]` ARRAY silently dropped: translate read only the
  single-object form; an array passed the truthy gate, minted nothing, no
  warn. The page's entire placement topology (sidebar/article/modal zones,
  admin/contributor link consumers) vanished silently.
- **D2** — `doc.content` single-payload OBJECT form silently dropped (whole
  article payload never rendered); array form is canonical.
- **D3** — `css.style` OBJECTS flowed raw to the adapters → `style="[object
  Object]"` on every styled element.
- **D4** — `css.cssDef` never emitted as stylesheet rules (raw object →
  `"[object Object]"` into the dynamic-styles block); no styles on the page.
- **D5** — the legacy `content` dual-parse (text OR NodeData⇒children) was a
  discontinued confusion hazard; `target: 'content'` binding unwired.
- **D6** — handler defs stored as `template.component` values `{name, body}`
  misparsed as source anchors — silently dead, no warning.
- **D7** — `target: 'type'`/`handlers.*` component targets unwired
  (recognition-only gap); the dominant legacy wiring pattern (wrapper div as
  a SHELL with the def subtree layered INTO it) unreachable.
- **D8** — emitOne def-chain clobber on count mismatch: root's real wrapper
  wires re-typed to the auth component's children, footer text duplicated,
  id-less orphans at host level.

### Dispositions (user decisions, verbatim record in FINDINGS.md §"Disposition")

| # | Decision |
| --- | --- |
| D1 | Placement ARRAY is canonical; each entry mapped through the single-entry logic; object stays a convenience. |
| D2 | Object form is outdated legacy; content stays ARRAY of payloads; fix = data re-expression (APPLIED to the envelope 2026-08-14: `content` re-expressed to `[{metadata, content}]`; verified nodes 13→20, no other signatures touched). |
| D3 | Serialize `css.style` objects to reversible CSS strings (kebab-case, `k: v;`), reverse parses back. |
| D4 | Emit cssDef as real stylesheet rules; rule-signature dedup; renderable-states-only. |
| D5 | No dual-parse: content = text only; children = `children` only; `target: 'content'` delivers text. |
| D6 | Parked as TODO — handler implementation changed for understood reasons; no fix. |
| D7 | Anchor-layer seam: resolve def → pass def's children + placement links as an anchor layer on the consumer, parent anchor ON the resolved node, own parent untouched; multi-parent from repeated type-references is INTENDED (guards scoped). |
| D8 | Def children are out-of-tree prototypes — never emitted by the host; only the fork-stress 1:1 link-method def-chain survives. |
| D9 | Retracted (deliberate legacy test feature — bare `{reference}` unresolved). |

### Spec encoding (this pass)

All eight decisions are encoded (docs-only — no src/tests/demo changes):
`docs/specs/translate.md` (D1 array canonical + TR-H11, D2
`payload-shape-obsolete` + TR-H13/§3, D3 css.style serialization + TR-H12,
D5 text-only + TR-H14, D7 seam planning + TR-H15/TR-H16, D8 out-of-tree
pre-minting),
`docs/specs/render.md` (D4 §3.4.1/§10.6 STL-*, D8 §3.4.2/§10.6 DFC-*),
`docs/specs/adapters.md` (D3/D4 boundary + rule-string dedup DOM-H29/FRG-H27),
`docs/specs/ops.md` (D7 §2.7 ALS-1..6 + G23–G27, D8), `docs/specs/handlers.md`
(D6 §6 TODO), `docs/specs/payload.md` (D2/D3/D5 reverse contract + R-H6..H8),
`docs/specs/placement-path-spec.md` (§10.ag seam-vs-placement-links + F18
enumeration rule; stale translate.ts anchors fixed),
`RENDER_PROCESS_NOTES.md` §10.10.6 (D1–D8 DECIDED, Step-3 rulings
incorporated), `docs/skills/
designing-pages.md` (§3/§5/§8/§11/§12/§14.7 + the new `legacy-shape` demo
page per fix-pass plan item 5; §11 D1–D8 rows marked PENDING/spec-target).
New warn codes introduced: **`payload-shape-obsolete`** (D2 — extended to
ANY non-array `doc.content` by the Step-3 round), **`placement-entry-invalid`**
(D1 — non-object placement entry / non-array non-object placement),
**`children-shape-invalid`** (D5 — non-array `nodeData.children`). The trio
(`npm test`, `npm run typecheck`,
`npm run demo:smoke`) was re-run after this docs-only pass: unchanged counts
(the docs edits touched no code).

### Fix-pass plan (from FINDINGS.md — engine side, NOT this pass)

1. Translate: array placement (D1); content-array-only (D2, data side done);
   css.style object → reversible CSS string (D3); content text-only (D5).
2. Emit/render: cssDef → deduped stylesheet rules from renderable states
   only (D4); def-chain emit scoped to the 1:1 link-method case (D8).
3. Anchor-layer seam: resolve def → layer def's children + placement links
   on the consumer; multi-parent intended case reconciled with the
   single-parent guards (D7).
4. Handler defs: TODO marker only (D6).
5. Regression-pin: the `legacy-shape` demo page (real-legacy-shape fixtures:
   array placement, object styles, cssDef, content-array payloads).
6. Decision records: this pass (translate.md / placement-path-spec §10.ag /
   RENDER_PROCESS_NOTES §10.10.6 / designing-pages.md) landed the records.

### Step-3 review round (same day) — 29 findings, 8 rulings, re-encoding

The Step-3 reviewer audited the D1–D8 spec encoding and returned 29 findings
(1 `[ok]`, 7 `[must-fix]`, 14 `[a-big]`, 6 `[a-big]` pairs, 1 wording fix).
User rulings (authoritative, encoded in the specs):

- **F13 — content-target semantics:** `target: "content"` delivers the def's
  TEXT content only (D5 letter wins); subtree delivery happens via
  `target: "children"` / `target: "type"` (the D7 seam). The envelope was
  re-expressed: the four subtree-delivering bindings became
  `target: "children"` (root.children[0]/[1]/[3] navBar/header/footer
  wrappers + header-def p→articleSubtitle); the h1's `target: "content"`
  articleTitle tag stays content (text-delivery test feature, no def).
- **F7 — reverse always parses style strings to objects** (no provenance;
  string-authored styles become objects on save — accepted, object-native
  legacy format).
- **F15 — multi-parent bypass = role-scoped `addAnchor` exemption** for
  layer-materialized child anchors (seam flag on the anchor/decl,
  `options.seam = true`); family attach ops keep the `SingleParentError`
  gate (G25 stays).
- **F16 — def children PRE-MINTED at translate** as out-of-tree
  `'component'`-token prototype nodes (registered, census-visible,
  `mintNodeId()` ids); the seam's layer materializes their child links at
  `reconcileAnchors`.
- **F17 — seam target persisted** on the anchor options
  (`options.seam = 'type' | 'content' | 'children'`, `BindingPlan` →
  `applyPlans`) so assembly distinguishes seam candidates from plain
  consumers.
- **F18 — seam-wired def children enumerate via their PRIMARY family path**;
  seam links excluded from the path-walk's parent selection
  (placement-path-spec §10.ag supplement).
- **F19 — seam parent anchors are marked (`options.seam`) and `familyLinkFor`
  filters them**; the exactly-one-parent invariant is scoped to non-seam
  anchors; `attachChild` after a seam still grabs the family link.
- **F20 — seam-wired def children are NOT emitted as the consumer's authored
  `data.children` on reverse** — they stay in the def's JSON home
  (translate.md TR-H16, payload.md R-H8).

Review findings 1–29 resolution: all addressed in this pass (see the
per-finding report in the session log) — D1 shape pins (`placement: []`,
non-object entries → `placement-entry-invalid`) + reverse merge contract
(F2); no translate-time veto claim (F3, op-time only per §14.6 #11); D2
never-silent rule extended to ANY non-array `doc.content` (F5); D3 grammar
pins (first-`:` split, `url(...)` `;`-exception, vendor kebab-case, `{}` →
`''`) (F8); D4 "actionable" not "in-tree" (F10) + zero-or-one styles op
(F11); D5 `children-shape-invalid` (F14) + def-text-via-seam mechanism; D7
seam-target persistence (F17) + enumeration rule (F18) + familyLinkFor
scoping (F19) + reverse rule (F20); D8 DFC re-scope (F22: offset 0 only, no
synthetic wires; F23: link-method provenance gate); STATUS banner flipped to
SPEC-ENCODED/pending (F26); warn-coverage tag fixed (F27); §11 matrix rows
marked PENDING/spec-target (F28); stale translate.ts anchor refs fixed
(169-173 → 176-180).

### Delivery-shape ruling (2026-08-14, user — refines D7)

The seam's delivery shape depends on the target (SPEC-ENCODED — encoded in
translate.md §2 D7 row, ops.md §2.7 ALS-1/1b/2 + G23/G24/G29, render.md
§3.4.2 SED-1..3 + §10.7, designing-pages §3/§14.7 #7/§11/§12,
RENDER_PROCESS_NOTES §10.10.6 D7):

- **`target: 'type'` — SHELL COLLAPSE**: the consumer's element becomes the
  def's element (def type + css, incl. cssDef rules; the current empty-host
  def-fill is correct for type-targets). The type-target is the legacy form
  of the fork-suite values method. No separate def-root element.
- **`target: 'children'` — SHELL + DEF-ROOT CHILD**: the consumer STAYS a
  distinct element (the wrapper shell div) CONTAINING the referred node(s):
  the def-ROOT element materializes as a seam-wired child of the wrapper
  (`div > nav.nav-bar > [logo, links, auth]`), carrying the def's type + css
  (classes + cssDef rules — the def-root is pre-minted as a
  `'component'`-token prototype too; its cssDef rules join the deduped
  styles block once seam-wired, D4 interplay). Parent anchors: the def-root
  is "the resolved node" — its children links carry parent anchors
  (target=self, `options.seam = true`); the consumer's seam child link
  points at the def-root; the consumer's own family parent untouched.
- **`target: 'content'` — TEXT ONLY** (unchanged).

New/changed warn codes: **`payload-shape-obsolete`** (extended: any non-array
`doc.content`), **`placement-entry-invalid`** (non-object placement entry /
non-array non-object placement), **`children-shape-invalid`** (non-array
`nodeData.children`).

Status: SPEC-ENCODED (docs-only; the trio re-run after this pass: unchanged
counts). Engine-side fix pass still pending.

---

## Path-fork page — SSR-fragment removal + memory/profile reference (2026-08-14)

Status: COMPLETE. The path-fork page's ~190MB embedded SSR snapshot (4095-element
nested binary tree — O(n·depth) serialization) was replaced by a hashed PAR-5
shape signature (FNV-1a 64-bit digest over the recursive type/props/children
fold, `shapeSigOfTrees`) + a 300-op SSR sample (`pathForkSsrSample`); the full
fragment is never rendered for embedding. Verified: serverData parity hash
`b62f1410db87d280` matches the client-side digest of the live DOM tree.

- **Browser memory reference (after the change)**: total **46.3MB** — objects
  3MB, strings 989kB, scripts 25kB, **domNodes 39MB** (the 4095-element DOM;
  ~9.5kB/element is the renderer's per-element cost for 4095 path-state wires).
  Pre-change the embedded fragment alone would have forced the page to hold a
  ~190MB string + its DOM parse.
- **Profile totals (smoke run, this date)**: `[path-fork:baseline]
  total=2650.5ms`, unmeasured=1.8ms — no pass-2 blow-up; runtime d12 ratios
  values 1.20× / link 1.47× of the placement total (4041.1ms) — inside the
  ~1.5× AGENTS watch and the 2.5× asserted guard. §8-Q6 re-baseline TODO
  marker still present.

---

## Blind test #3 — post-implementation layered loop (translate / compile / emit / ops / e2e)

Status: COMPLETE. The five writer-produced layer-contract suites under
`tests/blind/` (`translate-layer`, `compile-layer`, `emit-layer`,
`ops-layer`, `e2e-layer`) encoding the placement-path spec (FINAL) as
input→output pairs were executed and adjudicated by the reviewer (read-only
on engine code; test-expectation/data fixes only — the blind-test pattern).

Final state: **53 passed + 1 skipped (54)**, full trio + demos green
(`npm test` 686 passed | 1 skipped, `tsc --noEmit` clean, `npm run build`
clean, `npm run demo:build && node scripts/build-demo.mjs && node
scripts/demo-smoke.mjs` → SMOKE OK; `[path-fork:baseline] total≈3.97s,
unmeasured≈2ms — no pass-2 blow-up; runtime d12 `unmeasured=62.2ms` of
7796.1ms — no pipeline scaling regression).

### Per-layer verdicts

| Suite | Tests | Verdict |
| --- | --- | --- |
| translate-layer | 19 pass + **1 skipped** | 19 writer expectation fixes (harness/API-shape); **1 GENUINE ENGINE DEFECT** (T28, translate-time ancestor veto missing — skipped with a defect marker, NOT fixed) |
| compile-layer | 11 pass | 11 writer expectation fixes (per-node `compilePath` aggregate, pathKey grammar, unconditional forkKey) |
| emit-layer | 10 pass | 10 writer expectation fixes (`diffMinimal` prevMap contract, nodeById handler source, pathKey grammar, def chain semantics, unconditional forkKey) |
| ops-layer | 8 pass | 8 writer expectation fixes (Supervisor construction, takePass2States shape, getState surface, imperative addAnchor, attach dirty set) |
| e2e-layer | 5 pass | 5 writer expectation fixes (per-node bootstrap, spy surface, pathKey grammar, E2E-3 provider compile mode, E2E-4 append count) |

The four E2E constraints (USER-specified, not subject to adjudication) all
pass in `tests/blind/e2e-layer.test.ts`:

- **E2E-1** — 23 nodes at every stage; 4095 distinct path-states; 4095
  elements on pathKey wires; 4095 creates / 4094 appends / 0 removes;
  zero clone-instance ops; `[path-fork:profile]` one bootstrap pass.
- **E2E-2** — a shallow props slice on a depth-2 node regenerates ONLY
  that node's path-states (compile-scope spy = 1 call); element reused:
  zero create/remove/append, set ops only on the node's wires.
- **E2E-3** — a component SOURCE change invalidates ONLY the per-name
  component Link's target owners: all-consumers (10/10 consumers compile
  once, all 62 consumer pathKeys regenerate) and half-tree precision
  (affected = {p3a, p4a}; the b-column runs ZERO compilePath passes;
  p4b's 8 states stay).
- **E2E-4** — post-render placement-attach dirties EXACTLY {container,
  added}; nothing at depth>4 recalculates; ONE create + re-appends under
  the container's path wire; no set ops off the added node's wire.

### GENUINE ENGINE DEFECTS (reported — NOT fixed by this loop)

- **DEFECT #3-1 — translate-time ancestor-name veto was MISSING — FIXED
  2026-08-14** (`src/core/translate.ts`). placement-path-spec §1.3 + §6 CODE
  translate row + api.md T28 are unambiguous: "When translating a producer
  (`placementName`) whose ancestor chain already carries a `'container'`
  anchor with the same name, the anchor is NOT minted and a K4 warning
  (`placement-name-vetoed`) fires". The implementation minted the anchor
  verbatim at translate (only the `#`-check existed); the veto existed ONLY
  on the op-time half (`ancestorServesZone`). **Fix (user-directed):
  family attach is now CHILD-SIDE in translate** — the parent passes itself +
  the child index down the recursion; the child attaches itself to its family
  parent BEFORE its own placement minting, so the shared
  `ancestorServesZone` predicate (moved to node.ts, imported by both halves)
  walks a LIVE parent chain at translate; the producer mint now vetoes with
  `placement-name-vetoed` (translate.ts producer side). The T28 blind test
  was un-skipped and is green (the suite now has ZERO skipped tests).
  **CONDITION CORRECTED (user 2026-08-14):** the veto is LOOP-PREVENTION
  ONLY — it fires when a family ancestor WOULD ATTEMPT TO PLACE INTO the
  zone (a `content`-role anchor for it); DUPLICATE PRESENTATION (an
  ancestor merely OFFERS the zone) is LEGAL — placement resolution never
  shadows (nearest-shadows-far is component resolution): a consumer fans
  into ALL zones of its best-fit targetPlacement. The predicate is now
  `ancestorConsumesZone` (checks `content` anchors, not `container`);
  T28/P-A3 re-pinned to the loop condition + a legal-override pin added
  (T28b/P-A3b).

### Spec contradictions (recorded for the spec ledger)

- **C-3-1 — G22/§1.2 vs §3.3/E2E-4 (placement-attach affected set).**
  §1.2 + ops.md G22 read "the node that receives an update alert" — the
  changed placement Link's CONSUMERS — is relevance-gated and regenerates
  on a chosen-link change ("a relevant (chosen-link) update regenerates");
  §3.3 (E2E-4, user requirement) pins the dirty set to "{container, added}
  only". The implementation follows §3.3: placement-attach marks ONLY the
  container + added node; the trigger identity gates THOSE nodes'
  compiles (`placementChangeIrrelevant`), never the link's consumers. A
  consumer's fan-out onto a new container materializes on the consumer's
  OWN next compile (a state-slice), never on the attach. The ops-layer G22
  tests were re-expressed to the §3.3 reading. Neither section's letter is
  satisfied verbatim; the E2E-4 constraint (user-specified) is the
  load-bearing one — recommend a spec note resolving G22's "regenerates"
  to the attach's own dirty nodes.

### Adjudicated ambiguity table (writer readings vs implementation)

| ID | Writer reading | Verdict | Basis |
| --- | --- | --- | --- |
| A1 | `reverseTranslate(translated, {})` takes the whole TranslatedTree | **CORRECTED** — takes the ROOT Node + opts (`reverseTranslate(root, { content })`); engine pattern reverse.test.ts:57 | translate.md §8 names it without a signature; the engine's `nodeToLegacy(root, …)` contract is the sane reading |
| A2 | K4 `path` format: assert code + string-ness only | **CONFIRMED** | translate.ts warn channel |
| A3 | The §1.3 veto walks the FAMILY chain | **CONFIRMED** — `ancestorConsumesZone` walks `node.parent` for `content` anchors (loop-prevention; duplicate presentation legal per user 2026-08-14); both phases implemented | node.ts, ops.ts, translate.ts |
| A4 | `activePlacement` reverse emission = derived read (first requested name with any containers) | **CONFIRMED** | nodeToLegacy emits `placement.activePlacement` from the first content anchor whose link has containers (translate.ts:686-693) |
| B1 | `compilePath(node)` free function, whole-graph states | **CORRECTED** — per-node METHOD (`Node#compilePath`, types.ts:45, node.ts:947); census = per-node aggregate (compileAll pattern) | §2.1 pseudo-code is the ambiguous bit; §6 supervisor mode switch + node-local E2E-2 make the method the sane reading |
| B2 | Level-1 MUST consume zone-0 for the R2.2 census | **CONFIRMED as one valid shape** — the writer's fixture (level-1 consumes the root's zone-0) yields 4095 ✓; the engine's fixture (level-1 = family children, producers only) yields the same census with different keys | §5.1 arithmetic holds under both |
| B3 | `cs.children` = the child NODES' ids (not child state objects) | **CONFIRMED** | §4.2 letter; node.ts pathChildrenFor |
| B4 | `activePlacement` read as a field on path-states | **CONFIRMED** | types.ts CompiledState.activePlacement; mintPathState sets the chosen name |
| B5 | Family (non-path) states carry NO forkKey | **CORRECTED** — forkKey = pathKey is UNCONDITIONAL on every compilePath-minted state (family-first walks included); those states also emit on the family pathKey wire (`root/<id>`), not the nodeId wire | §2.2 "set unconditionally (node.ts:699-706)"; pathWireOf (render-helpers.ts:55-62) |
| B6 | Only the contentNodes-token termination is legacy-data-expressible | **CONFIRMED** — prototype-terminated arms not encoded | §2.4 |
| C1 | Export locations: `emitElements`/`minimalFromState` in render-helpers; `diffMinimal` in render | **CONFIRMED** | placement-path-spec §4.1/§6.2 citations |
| C2 | Def VALUE = `{ type, children: NodeData[] }`; re-types the def-carrying consumer | **CONFIRMED with the chain nuance** — `isLinkDef` (render-helpers.ts:385); a covered consumer is re-typed by the PARENT's def (its own def re-types its children only); the provider's own state re-types itself (seedOwnBindings) | emitElements def branch, render-helpers.ts:309-347 |
| C3 | Event-binding set op name = `on:<event>` | **CONFIRMED** — `props['on:click'] = true`; note: handler attachment requires the `nodeById` source (EmitNodeSource.handlers, engine P-EMIT-3) | render-helpers.ts:459-463 |
| C4 | MinimalElement = `{ wire, type, props, childOrder, forkKey? }` | **CONFIRMED** | render.ts |
| D1 | `new Supervisor()`, `registerNode`, `takePass2States()` | **CORRECTED** — constructor takes a root/opts (hub-less `new Supervisor({})` + registerNode per node); `takePass2States()` returns `Map<NodeId, CompiledState[]>` (flatten for keys) | supervisor.ts constructor/takePass2States; engine supOf pattern |
| D2 | Per-path exposure via `client.getState(...).fork` | **CORRECTED** — `getState` is surface-only (`nodeId/status/pathKey/state`, api.md:150-151); the W2/W3 per-path (nodeId, forkKey) exposure + `fork: {forkKey, nodeIds}` lives in the supervisor resolved store / events channel | api.md §6 + supervisor.ts:305-318 |
| D3 | `addAnchor({ referenceName, role, value })` decl form | **CORRECTED** — the imperative path is positional `addAnchor(role, target, options, link)`; the decl form is the private materializeAnchors (layer) path | node.ts:593 |
| D4 | Trigger: newly minted container ⇒ `container-added`, ensured ⇒ `content-added` | **CONFIRMED** | ops.ts derivePlacementTrigger |
| E1 | (= B2) level-1 consumes zone-0 | **CONFIRMED** | see B2 |
| E2 | E2E-4 render diff "ONE create + ONE append" | **CORRECTED** — ONE create ✓ but the D5 re-append fires for the container's whole changed order (3 appends under the container's wire: p4a, p4b, p4new); set ops only accompany the new element | render.ts diffMinimal orderChanged rule |
| E3 | E2E-3 provider = the root | **CONFIRMED with a mode-switch correction** — the root (no `content` anchors) is NOT placement-routed, so it compiles via the FOCUSED slice (§2.1), never `compilePath`; the compile-scope spy sees the 10 consumers only; the provider's focused pass lands its subtree states in the drain too | supervisor.ts:264-283 |
| E4 | Compile-scope spies target an exported `compilePath` | **CORRECTED** — spy `Node.prototype.compilePath` + `mock.instances` | node.ts method surface |
| E5 | Registry observable = `supervisor.allNodes()` | **CONFIRMED** | supervisor.ts |
| E6 | SSR sink = `new SSRFragmentAdapter(); applyOps(a, ops); a.toString()` | **CONFIRMED** | adapters.ts:189 |

### Kept summary (per-layer input→output contract, as confirmed)

- **translate**: legacy envelope → TranslatedTree; `placementName` → one
  `container` anchor on the per-name placement Link; `targetPlacement:
  string[]` → ordered `content` anchors (string coerced w/ warn; `#`
  names skipped w/ warn; duplicates keep-first w/ warn); content payload +
  template.children roots are contentNodes-owned (token on the link's
  parent anchor) and family-in-tree; K4 warnings additive; reverse
  round-trips content anchors → `targetPlacement` in mint order +
  `placementName` + derived `activePlacement: string`, stripping the
  contentNodes anchor.
- **compile**: `Node#compilePath()` per node → one path-state per viable
  (node, path); `pathKey = root/<zone>/<owner>/…/<nodeId>` (root landing
  contributes nothing; a node's own consumer hop lands directly before its
  id); `forkKey = pathKey` unconditionally; `activePlacement` = chosen
  name; first-match prunes to the chosen name's zones (silent skip of
  no-container names; whole-array miss compiles nothing); path-derived
  children = child NODE ids at mint time; contentNodes/component tokens
  terminate silently; loops drop with `circular-source`; family-first
  walks key `root/<id>`.
- **emit**: every path-state emits at wire = pathKey with forkKey
  forwarded on every create/set op (appends carry none); per-path
  childOrder = the child STATES' pathKey wires (trace-indexed); `on:<event>`
  from the nodeById handler source; def re-typing per `isLinkDef` with the
  covered-consumer chain; `diffMinimal(prevMap|null, next)`; root-first
  create stream.
- **ops**: placement-attach registers-if-new, mints ordered content
  anchors (dedup keep-first) + ensures the container anchor under the
  op-time veto, dirty = {container, added} only, trigger identity
  `container-added`/`content-added` gated by `placementChangeIrrelevant`;
  state-slice placement writes hard-blocked; unplaced registered nodes →
  `no-usable-state`; contentNodes-owned roots clear the apply gate;
  component-source duplicates warn keep-first unconditionally.
- **e2e**: the four fixed user constraints hold end-to-end (see the
  E2E-1..4 confirmation above), with the E2E-3 provider focused-compile
  and E2E-4 D5 re-append notes as the corrected expectations.

### Harness/authoring fixes applied (data-only, no engine edits)

- Import depth/extension per repo convention (`../../src/core/*.js`).
- esbuild-broken doc comment (`prop:*/` inside a block comment).
- Writer fixtures moved to the per-node compileAll aggregate, the engine's
  supervisor construction, the prevMap diffMinimal contract, and the
  Node.prototype spy surface.
- `new Node(data, 'blind-test')` second-arg hub misuse corrected to the
  hub-less form (the supervisor falls back to `container.hubFor`).

### Validation trio

`npm test` → 36 files, **686 passed | 1 skipped** (the skipped = the
DEFECT #3-1 marker); `npm run typecheck` → clean; `npm run build` → clean;
`npm run demo:build && node scripts/build-demo.mjs` → clean;
`node scripts/demo-smoke.mjs` → **SMOKE OK — all demo checks passed**
(`[path-fork:baseline] total=3973.4ms`, unmeasured 1.8ms — no pass-2
scaling regression; runtime d12 link total 7796.1ms, unmeasured 62.2ms —
measured sections dominate).

---

## Unit 12 (placement-path chain) — the consolidated E2E constraint suite

Status: COMPLETE. Red→green→verify per AGENTS.md item 7; verification trio
green (633 tests / typecheck / demo build) + smoke green (ALL pages — the
static page unchanged: census 23/4095/0/0, `[path-fork:profile]`
total≈3.98s, `unmeasured≈0`; the runtime pages' census re-pins 4117/0/4094
hold). Landed: `tests/e2e/path-fork-e2e.test.ts` — the four FIXED user
requirements (placement-path-spec §0) as full-pipeline Node tests (legacy
envelope → translate → register → ONE `compilePath` bootstrap →
`emitElements`/`diffMinimal`/`applyOps`) + the consolidated guard pins
(static census 23/4095/0/0 + per-level 2^k, runtime re-pin 4117, the
`component-source-duplicate` pin, the §8-Q6 ratio-baseline TODO pin), and
the E2E-3 GREEN fix in `src/core/supervisor.ts` (the state-slice affected
set for component SOURCE changes). Red set: exactly the two E2E-3 cases —
E2E-3a pressure (dirtied = the provider alone; the all-consumers set was
missing) and E2E-3b precision (the half-tree consumer set was missing).
E2E-1/2/4 and every guard pin were green against the Units 4–11 machinery
on the first red run (honest pass/fail per assertion, reported in §Return
of the unit handoff).

### Findings

| # | Class | Finding |
| --- | --- | --- |
| 1 | DECIDED (pinned) | **A component SOURCE change invalidates the per-name component Link's TARGET owners — not the provider's family subtree.** `supervisor.apply`'s state-slice branch now derives the affected set from the Link registry (`link.anchorsOf('target')` → `anchor.owner`), dedup keep-first, and marks those consumers pass-2 dirty alongside the provider (spec §3.2: "resolved through the graph, never by enumerating states"). This is what makes E2E-3's pressure (ALL descendants consume ⇒ every consumer's `compilePath` runs once, the non-consuming sibling runs zero passes) and precision (a provider consumed by HALF the tree — the a-column — regenerates exactly {provider, p3a, p4a}; p2b/p3b/p4b run ZERO compile passes; p4b's 8 max-depth states stay) both true. The provider node itself is unaffected: a source-free slice keeps the node-local set (E2E-2 unchanged). |
| 2 | PASS (E2E-1) | The 23-node census holds at EVERY pipeline stage: the depth-12 envelope registers exactly 23 nodes at translate, and the global registry count is unchanged through compile, emit, diff and apply — zero node creations (the 4095 compiled states and 4095 elements are pinned to the 23 graph nodes; journal stays empty of `clone-instance` ops). States: 4095 distinct pathKeys, `forkKey = pathKey`, no `#`-grammar; elements: 4095 on pathKey wires, level k has exactly 2^k; create ops = 4095, zero removes. |
| 3 | PASS (E2E-2) | A shallow props slice on a depth-2 placement-routed node regenerates ONLY that node's path-states (six sibling/ancestor `compilePath` spies + pass-2 keys prove it) and its rendered elements are REUSED: identical wires, zero create/remove ops, set ops only on that node's two pathKey wires (the §3.1 node-local invalidation + §4.1 wire-stability contract, through the supervisor + renderer). |
| 4 | PASS (E2E-4) | A post-render third depth-4 node via `placement-attach` dirties EXACTLY {container, added node}: pass-2 keys = {d3, d4c}, d3's path-states adopt d4c as a path-child, nothing at depth>4 recompiles (d5a at depth 5 — zero compile passes, no set ops on its wire), and the render diff is ONE create (d4c's pathKey wire) + appends under d3's path wire with every other element reused. Note (authoring lesson): a node's OWN pathKey contains its CONSUMER hops only — d3's key has no `zone-3` segment; its producer zone appears only in its CHILDREN's keys (d4c's key = d3's key with `zone-3/d3` inserted). |
| 5 | PASS (guard pins) | The consolidated pins hold: static census 23/23/0/0/cloneOps=0 (E2E-1), runtime re-pin arithmetic (in-tree = 4095 + 22 prototypes = 4117, unplaced = 0, cloneOps = 4094 — the F-13 reading demo-smoke asserts on the LIVE pages), the `component-source-duplicate` guard (keep-first, skip-second, warn — one provider anchor per name on the Link), and the §8-Q6 ratio-baseline TODO (demo-smoke's `[path-fork:baseline]` record + the re-baseline TODO marker stay present). |
| 6 | PASS (profile watch) | Static page unchanged by this unit (path-fork total ≈3.98s, `unmeasured ≈ 0` — the ONE enumeration pass still covers the total; no pass-2 blow-up). The runtime pages' d12 ratios (values ≈1.2× / link ≈1.5× of the runtime placement baseline) are inside the asserted 2.5× guard; the static total sits BELOW the runtime placement baseline (tripwire holds). |

---

## Unit 8 (placement-path chain) — `component-source-duplicate` guard

Status: COMPLETE. Red→green→verify per AGENTS.md item 7; verification trio
green + demo build + smoke green (ALL pages — no shipped demo doc carries the
anti-pattern; the re-expressed Unit-11 fixtures load clean under the guard).
Landed: the UNCONDITIONAL `component-source-duplicate` guard at
`Node.addAnchor` (placement-path-spec §6.2 node.ts row, §10.ab/§10.ae — warn,
keep-first, skip-second; NO seed-path opt-out), `addAnchor` return contract
`Anchor | null`, and the re-expression of every test that constructed the
anti-pattern (same-node same-name source/duplex anchors) to the legitimate
two-provider-NODES multiplicity (§10.ab #4). Red set: G1/G2/G3 (the guard
itself — second anchor was added, no warn) + the seeded fork-construction
tests (21 across render/path-emit/derived/adapters/ssr-render/
ssr-html-validity/resolved-exposure/reverse — they tripped the guard by
design and were re-expressed).

### Findings

| # | Class | Finding |
| --- | --- | --- |
| 1 | DECIDED (pinned) | **The guard is return-contract `Anchor \| null`.** A skipped anchor returns `null` (not the existing anchor) so value-setting call sites (constructor seed `node.ts`, clone, translate applyPlans, fixtures) null-guard — keep-first preserves the FIRST anchor's VALUE, not just its object identity (G2 pins `value: 'A'` survives the seed round-trip). |
| 2 | DECIDED (pinned) | **source and duplex share ONE provider namespace.** The match is name-keyed across both roles (resolve's `providersOn` + the legacy K8 reference-keyed guard), so a `source`-x add after a `duplex`-x anchor is also rejected — otherwise the fork hole reopens via mixed roles (G3 covers duplex+duplex). |
| 3 | DECIDED (pinned) | **materializeAnchors' decl-path dedup is COMPLEMENTARY, not the enforcement point.** Its same-role+target skip pre-filters layer-decl duplicates BEFORE addAnchor (idempotent layer re-application stays silent — G6 pins zero warns); the guard is the single warn+skip enforcement for everything that reaches addAnchor (imperative + constructor seed). |
| 4 | DECIDED (pinned) | **Fork-claim tests re-express as TWO PROVIDER NODES under the consumer** (the §10.ab #4 legitimate multiplicity — same shape as the shipped T3 test): `leaf → pA/pB` both providing the name. Verified wire-identical to the old same-node construction (arm wires `leaf#0/#1`, forkKey forwarding, parent childOrder adoption, create ops, round-trip) — no fork-claim assertion weakened. The serialized doc now includes the provider nodes (SER-H2's seeded-id set gains pA/pB) and reseed requires `reconcileParentTargets` (the descendants walk needs the shared family links — the old root-provider fixture walked ancestors, needing no reconciliation). |
| 5 | PASS (regression pin) | G5 pins the Unit-11 re-expressed shapes (feature-matrix `theme-dark`/`theme-light` distinct names on ONE node) never trip the guard and resolve side-by-side (the K7 multi-binding surface); the smoke run of every demo page confirms zero `component-source-duplicate` warns in the build output. |
| 6 | PASS (profile watch) | Static page unchanged under the guard (path-fork total ≈3.9s, `unmeasured ≈ 0`); runtime d12 ratios values ≈1.2× / link ≈1.5× of the runtime placement baseline — inside the asserted 2.5× guard and the AGENTS ~1.5× watch (runtime pages untouched by this unit). |

---

## Unit 11 (placement-path chain) — demos + smoke rebuild

Status: COMPLETE. Red→green→verify per AGENTS.md item 7; verification trio
green + demo build + smoke green (ALL pages — runtime fork-stress pages
unchanged, re-expressed demo pages green, new static page green). Landed:
the three same-node multi-source demo fixtures rebuilt to drop the fork
claims (anti-pattern compliance, placement-path-spec §10.ad), the static
placement-path page (`demo/path-fork-data.*` — 23 nodes → 4095 path-states,
ONE enumeration pass), builder `scripts/path-fork-page.mjs`, smoke census +
baseline guards, and the §11/§12 doc rows. Red set: `ERR_MODULE_NOT_FOUND
demo/path-fork-data.js` — the builder/smoke wiring (census 23/4095/0/0,
per-level 2^k, parity, profile, baseline) was written against the
not-yet-existing page module.

### Findings

| # | Class | Finding |
| --- | --- | --- |
| 1 | PASS (static census) | The static page's own checks + smoke `assertStaticPathCensus`: registered=23, in-tree=23, unplaced=0, destroyed=0, cloneOps=0, states=4095 (distinct pathKeys, `forkKey = pathKey`), elements=4095 (wires = pathKeys), passes=1 — the §5.2 census holds end-to-end through translate → compilePath → emit → DOM. |
| 2 | DECIDED (pinned) | **Every path-state element is stored at the adapter under the composite key `wireKey(pathKey, pathKey)`** (forkKey = pathKey ⇒ `wire\x00forkKey`), so bare-pathKey DOM lookups (`adapter.wires.get(pathKey)`) MISS. Page checks must use the composite key (the same contract as fork-arm wires — Unit 2 finding #1). |
| 3 | DECIDED (pinned) | **PAR-5 parity on a RE-TRANSLATED legacy envelope is key-agnostic**: the page translates the envelope at page time (fresh minted ids ≠ builder ids), so pathKeys/forkKeys AND the auto-minted `props.id` (`preempt-node-<id>`) are mint-time artifacts — `treeSig`'s forkKey dimension must be stripped AND the prototypes must carry AUTHORED `props.id` for the props dimension to compare. The parity contract is `type + props + binary children structure` (shapeSigOfTrees). |
| 4 | DECIDED (pinned) | **`treeFromOps` on 4095 path-states is the page's heaviest region** — every append edge resolves its bare-pathKey owner through `findEl`'s prefix fallback (create entries live under `wire\x00forkKey`), an O(n²) scan on the full map. The static page TIMES its check surface (`checksMs` in the profile) so `total − Σ(measured)` stays ~0 — the same coverage discipline as the runtime pages' pass2Ms/handlerMs (session-defect-review RCA). Not a core defect in this unit: `treeFromOps` is not on the §6 inventory. |
| 5 | PASS (fork-claim drops) | The three re-expressions behave as designed: feature-matrix `theme-dark`/`theme-light` (each consumer resolves ONE state carrying its own provider — the section renders both values), components `panel-a`/`panel-b` (the consumer's single state carries BOTH def bindings and renders ONE section element; `scalarBinding`'s `bindings['theme']` fallback is now dead weight but harmless), pane `feed-a`/`feed-b` (dock's single state carries both feed objects; SSR-F1 tamper re-resolution still returns exactly one state). |
| 6 | DECIDED (pinned) | **Ratio baseline**: the static page's single total (≈3.9s in the shim) is its OWN placement baseline (§10.ad N-5) — recorded by the smoke with the §8 Q6 TODO (re-baseline the runtime pages' guard after testing confirms no explosive time issues); a tripwire flags any future static total that EXCEEDS the runtime placement d12 total (the enumeration replacing 4094 per-node passes must not regress). |

---

## Unit 6 (placement-path chain) — supervisor/ops trigger-identity surface

Status: COMPLETE. Red→green→verify per AGENTS.md item 7; verification trio
green + demo build + smoke green (existing pages unchanged). Landed:
`placement-attach` op (types + ops.ts executor + supervisor apply branch,
journal/replay), trigger identity `{kind:'placement', linkName, direction}`
through `supervisor.apply` into the pass-2 dispatch, the silent-abort
relevance pre-check at the compiler entry (`placementChangeIrrelevant` +
`activePlacementOf` on the node's last states), the §9-Q3 event
re-expression (`#f` gate → "path-state ⇒ emit `{forkKey: pathKey,
nodeIds: trace}`" — path traces minted at `mintPathState`), and the client
wire carry-through (`container` ref resolution). One INHERITED engine defect
surfaced and was fixed (see below).

### Findings

| # | Class | Finding |
| --- | --- | --- |
| 1 | INHERITED ENGINE-DEFECT (fixed here) | **`supervisor.replay()` iterates the LIVE journal while `apply` appends to it** — any op that applies SUCCESSFULLY on replay (the placement-attach op is idempotent, so it always does) journals a new entry that the `for-of` then visits: an infinite journal-growth loop → worker OOM (caught as a vitest worker crash in the S-P2 replay test). Existing replay tests never hit it because structural re-attaches reject with `single-parent` (no journal entry). Fixed: replay iterates a snapshot (`[...this.journal]`) — the replayed ops are the ORIGINAL entries only. |
| 2 | PASS (E2E-4 hook) | Post-render placement-attach of a third depth-4 node: dirty set = the container node + the added node ONLY (S-P1) — nothing at depth>4 recompiles, no sibling depth-4 recalc; the container's path-states pick up the added node as a path-child (§2.3). |
| 3 | DECIDED (pinned) | **The silent abort is scoped to the aborted node's compile** — an irrelevant (less-favored) placement update skips that node's `compilePath` entirely (no states, no events, no dirty residue); other nodes in the op's fixed dirty set (the producer container) still recompile per the §3.3 contract. The chosen-name source is the node's LAST states' `activePlacement` (family-first states without one are skipped — `activePlacementOf`). |
| 4 | DECIDED (pinned) | **Path-state event traces are root-inclusive**: `mintPathState` sets `trace` = the enumerated walk's hop owners root-down + the node itself (`['root', 'P', 'C']` for `root/zone-1/P/C`), consistent with the walk recording the root landing. |

---

## Unit 2 (placement-path chain) — translate minting surface

Status: COMPLETE. Red→green→verify per AGENTS.md item 7; verification trio
green + demo build + smoke green. One INHERITED engine defect surfaced and
was fixed (see below); everything else landed per `docs/specs/
placement-path-spec.md` §1.1/§1.2/§2.5/§6.2 + §10.ad/ae.

### Findings

| # | Class | Finding |
| --- | --- | --- |
| 1 | INHERITED ENGINE-DEFECT (fixed here) | **DEFECT #1's applyOps/treeFromOps half was unexercised** — the DEFECT-1a/b forwarding fix landed, but `applyOps` stored fork-arm elements under `wireKey(wire, forkKey)` while append/remove ops carry the BARE arm wire, so `has()`/edge resolution silently missed fork arms: feature-matrix "fork arms not rendered into the DOM" (4 pages × mode-toggle). Fixed: `findEl()` (render-helpers.ts) — exact `(wire, forkKey)` match first, bare-wire prefix scan (`wire\x00`) for forkKey-less lookups; applied in `applyOps` (create/set/remove/append) and `treeFromOps` edges. RED test: DEFECT-1f (render.test.ts) — fork-arm appends reach the adapter; treeFromOps nests arm trees under the parent. Verified pre-existing: pure inherited-state smoke reproduced the same failure with my core hunks reverted. |
| 2 | PASS (census re-pin) | contentNodes-ownership minting flips the runtime fork-stress census exactly per §5.2 F-13: d12 `registered=4117 inTree=4117 unplaced=0 destroyed=0 cloneOps=4094`; page asserts + demo-smoke `assertForkStressCensus` re-pinned (inTree = 2^depth − 1 + 2·(depth−1), unplaced = 0, cloneOps = inTree − 1 − prototypes). |
| 3 | DECIDED (pinned) | **Duplicate names in `targetPlacement`** → `placement-duplicate-reference` warn + keep-first, skip-rest (K8-class behavior, mirrored on `component-duplicate-reference`); the string-coercion back-compat warn is `placement-string-coerced`; non-string/empty entries warn `placement-name-invalid` + skip. `activePlacement` is never minted (derived; typed `string`; reverse emits the derived read). |

---

## Stress-test review loop #2 — translate-layer kernel (subagent review loop)

Status: COMPLETE (review agent, step c of AGENTS.md item 10). Scenario
specs: `docs/specs/translate-stress-scenarios.md` (corrected expectations
marked `[reviewed]`); probe evidence: `scripts/translate-stress-probes/
RESULTS.md` + `run-all.mjs` (untouched, kept as evidence). Probe
methodology verified before adjudication: dist matches src at probe time
(`dist/core/translate.js` built after the last `src/core/translate.ts`
edit), the envelopes in `run-all.mjs` are byte-identical to the scenario
doc, and the one surprising result I re-derived from source (S2-E3's
cross-surface anchor order — `template.root.component` binds before
`template.component`) matches the probe's output. Each mismatch is
classified into exactly one of PASS / DOC-FIX / DATA-FIX / ENGINE-DEFECT.

### Per-scenario verdicts

| # | Verdict | Notes |
| --- | --- | --- |
| 1 | ENGINE-DEFECT #1 (self-apply half); PASS (trap + reverse halves) | cross-namespace caption/CAP trap CONFIRMED (binding NAME `caption` vs apply-path KEY `caption` are different namespaces); reverse + N1 + re-translate PASS (exact 4-binding array, anchors identical, warnings `[]`) — but "slotKey bakes self-val" FAILS: the node also carries a consumer anchor (`label`) → `resolveArms` path, `publishOwn` never runs (`node.ts:655-664`, requires `targetNames.length === 0`) → all three own-name synthesized reads null → `slotKey`/`caption` omitted on BOTH adapters. Violates translate.md §2.1's unqualified "self-provider ⇒ own value" |
| 2 | DOC-FIX (E2 order/numbering); E1+E3 PASS | E1 exactly one dup-reference warn, one anchor — PASS. E3 per-surface guard bypass confirmed (separate `seenReferences`/`seenTargets`), two `source:a` anchors + both syntheses, first-source-wins compile (bindings.a=2; w=2 z=2 bake), reverse keeps the first anchor only (K5 seenReferences — documented) — PASS. E2: mechanism right, ORDER wrong — strict array order makes the earlier binding's `component-duplicate-target` precede the later binding's `component-duplicate-reference`; the doc's 1-based "index 3/index 2" numbering was also wrong (3-element array). Guard order pinned in translate.md §2.1 |
| 3 | PASS | identical single warn, opposite kept halves, order-sensitive first-wins exactly as framed |
| 4 | PASS (doc sub-claim corrected) | RAW-string guard timing confirmed (`props.x` vs `props.x.` never dup-warns; edge binding skipped, no applyPath; control fires dup-target); the "warn array ORDER differs between the envelopes" prediction corrected — both produce the IDENTICAL single-element array; only anchor creation order differs |
| 5 | DOC-FIX | 13-path vocabulary partition, bare-`props` skip, `slash/ref` carve-out miss (literal `includes('.')` check), t14/u4 synthesis, both bakes, target-less reverse — all CONFIRMED. The "warns re-emitted on re-translate" claim was internally inconsistent with the doc's own reverse expectation (gap/skip bindings reverse WITHOUT target per K5 ⇒ nothing to re-warn); actual re-translate warnings `[]` — R-5 holds |
| 6 | PASS | object bakes `[object Object]` on both adapters while the compiled state carries the object (NP5); null provider publishes null but the bake omits the key (N3); both round-trip exactly; re-translate anchor-identical |
| 7 | DOC-FIX | exact 8-code order + 8 focused `console.warn`s + anchors + placement + zero live handlers CONFIRMED; "re-translate is NOT warning-clean" claim wrong — FULLY clean (vacuous `{}` produced no anchor; skipped/gap bindings reversed target-less; handler defs and `targetPlacement` gone; duplicate guards cannot re-fire — that half was right). **SUPERSEDED (P3 feed landed, placement-path-spec §6.2):** the "`targetPlacement` gone on reverse" claim is INVERTED — `content` anchors now reverse as `targetPlacement: string[]` in mint order (+ derived `activePlacement: string`; the minted contentNodes anchor stripped, F-13), so the placement config ROUND-TRIPS; the row's "handler defs gone" half still holds |
| 8 | PASS | phase-first guard ordering confirmed; invalid body never handed to `new Function` (NP11 downgrade holds); reverse drops the def; re-translate clean |
| 9 | DOC-FIX | authored-wins silent skip + no applyPath + no reverse `target` CONFIRMED (loss real + permanent); "not anchor-identical" claim WRONG — round-trip IS anchor-identical (the loss happens on pass 1; pass 2 reproduces the same shape). Authored-collision data-loss chain now documented in translate.md §2.1 reverse-emission note |
| 10 | DOC-FIX (payload.md R-2) | drop CONFIRMED mechanically for the plain consumer `{reference:'y'}` AND the gap-warned variant `{y,target:'y'}`; R-2's letter ("a name-target (no apply path)") was narrower than the code's shape-based branch (`translate.ts:626`). Code is the sane behavior — a legacy plain consumer's graph shape is indistinguishable from the runtime two-name duplex (no provenance) — so R-2 broadened to "any applyPath-less non-provider (consumer) anchor coexisting with a provider anchor" |
| 11 | PASS | 3-provider K7 array: anchor order preserved through reverse, idempotent, self-scoped render, depth-0 publication |
| 12 | PASS | K6 nearest-shadows-far with root fallback: deep-consumer `"near"`, sib-consumer `"far"`, one arm each, NO fork; F3 drops both providers; reverse exact; re-translate clean |
| 13 | PASS | K7 multi-source root: one source per name, no fork (FRK-H1); F3 root drop vs self-apply bake; variant (consumers removed) bakes `prop:rt="RV"` |
| 14 | ENGINE-DEFECT #1 (compile half); PASS (three surfaces) | placement + component + handlers coexist and round-trip without interference — PASS as framed; but `props.x` does NOT bake ("self-provider ⇒ own value" fails — the node also carries consumer `b` → publishOwn bypass). **P3 supersession note:** this scenario predates the placement feed — its "placement coexists" surface is now the §1.1 two-sided-role contract (container/content on the shared per-name Link, translate-minted) |
| 15 | ENGINE-DEFECT #1 + DOC-FIX (R-2) | unicode/root-keyword references, `bindings.bindings`-style reads, silent-absent `target:''`/`target:42` all CONFIRMED harmless at translate (zero warns, 7 syntheses, 1 plain consumer); the bake half FAILS (`empty`'s consumer anchor → publishOwn bypass → all seven reads null); the reverse half drops `{reference:'empty'}` (same shape-based R-2 drop — DOC fix; `numb` survives). **P3 supersession note:** the reverse half now additionally emits `content` anchors → `targetPlacement: string[]` + strips the minted contentNodes anchor (F-13) — see the P3 reverse rows in translate.md/payload.md |

### Engine defects (do NOT fix in this loop — report only)

**DEFECT #1 — publishOwn bypass: a node carrying ANY consumer (target)
anchor never publishes its own provider values (S1/S14/S15)**

> **STATUS: FIXED (engine fix landed — see "Fix landed" below).** The §2.1
> "self-provider ⇒ own value" contract now holds on mixed nodes; the fix
> was verified by the T1–T7 red→green unit set (`tests/unit/node.test.ts`
> "engine defect #1" describe) and the de-vacuoused translate-showcase
> smoke (`28 passed, 0 failed` genuinely, `self-apply="self-applied"`
> baked on the array-card live + SSR).

- Spec: translate.md §2.1 ("at a self-provider the applied value IS its own
  `value`"; row `props.<propertyName>`: "the node gains the synthesized
  derived read (apply of the RESOLVED value; at a self-provider that is its
  own value)"), §1 source-attachment note (provide-and-self-apply), TR-H2;
  review doc §2.2 K1 + §5-C ("the synthesized read is the resolved, per-arm
  value — which for a self-provider equals its own `value` (publishOwn
  `node.ts:640-647` runs before the derived bake)"). All unqualified.
- Observed vs required: `node.ts:655-664` routes ANY node with a target
  anchor through `resolveArms`, whose arm bindings carry only the CONSUMED
  names (`resolve.ts:167-255`); `publishOwn` runs only in the
  `targetNames.length === 0` branch. On a LEGAL K7 mix (distinct references
  + distinct targets — the §2.1 legality matrix says LEGAL, zero translate
  warnings) of "consume A + provide B (self-apply B)", the synthesized
  `{$:'bindings.B'}` read evaluates null (missing-key → null,
  `derived.ts:184-187`; omit-on-null `applyDerived`) and the self-apply is
  silently omitted from the compiled state and from both adapters'
  emission. No warning anywhere. Required per spec: the own-name read
  resolves to the node's own `value`.
- Repro: scenario 1 (`mix`: 3 providers + 1 consumer — `slotKey`/`caption`
  omitted), scenario 14 (`tri`: `props.x` never bakes), scenario 15
  (`names`: all seven bakes null because of the `empty` plain consumer).
  Pure-provider nodes are unaffected — spot-check-7's evidence holds (its
  node was target-less).
- Severity: MEDIUM — silent data loss in a legal, zero-warning
  configuration; the affected pattern (mixing a consumer and a self-apply
  on ONE node, different names) is legal legacy data whose legacy semantics
  (per-binding assembly) apply both halves. The showcase/demo surface uses
  pure providers/consumers, so real-world frequency is low — but the loss
  is completely invisible (no warn, key simply absent).
- Fix shape (future TDD pass, red → green): in the `resolveArms` path,
  seed each arm's bindings with the node's OWN source/duplex values
  (publishOwn semantics: `cs.bindings[ownName] = value` when undefined)
  alongside the consumed-name resolution. Red tests: S1/S14/S15 pins —
  mixed-node self-apply bakes; descendants' depth-0 reads and pure-provider
  behavior unchanged; no fork regression.

### Fix landed (TDD implementation of DEFECT #1)

- **Implementation** (`src/core/node.ts`, compile loop): `publishOwn`'s body
  extracted into a pure helper `seedOwnBindings(node, bindings)` —
  `bindings[name] = anchor.value` for every source/duplex anchor with
  `value !== undefined` and the name NOT already present (skip-if-present).
  Used in BOTH branches: the no-target branch via `publishOwn` (behavior
  unchanged — spot-check-7 pin holds) and, per arm, right after
  `cs.bindings = arm.bindings` and BEFORE `applyDerived`, so synthesized
  `{$:'bindings.<own-ref>'}` reads (K1/K2 self-apply) and authored
  `bindings.*` reads resolve to the node's own value on a LEGAL K7 mix.
- **Guarantees preserved**: consumed-wins precedence (skip-if-present: a
  same-name arm-resolved/duplex value is never overwritten); consumed-first
  key order (own names append after the consumed names — the mixed-node
  rendered text stays the first consumed scalar, T6 pin); per-arm
  determinism (own values are node-static; arms clone bindings per fork hit
  in `resolve.ts`); pure-provider behavior identical (T4 pin); no warnings
  added (T1: zero warnings, zero drops).
- **Red set (before the fix)**: unit T1/T2/T3/T6 failed (`bindings.B`
  undefined on mixed nodes); after de-vacuousing the showcase checks, smoke
  failed 2: `array-card self-apply=null (expected self-applied)` and `SSR
  fragment missing self-apply="self-applied"`. Green set: 546 unit tests
  (27 files), typecheck + build clean, demo:smoke all green with
  `translate-showcase: 28 passed, 0 failed` genuinely (throw-style checks),
  `compileCalls=1`, fork-stress d12 guard 1.21×/1.44× (≤1.5×).
- **Docs**: this defect block annotated FIXED; translate.md §1 reported-
  defect blockquote rewritten to a resolved-fix note; blind test #2 gained
  finding 5 (vacuous checks) + the post-fix re-verification note.
- **Side-effect note (accepted, deterministic)**: the feature-matrix /
  mode-toggle app root is itself a MIXED node (session duplex consumer +
  theme providers) — its arm bindings now carry the seeded `theme` values,
  and the pre-existing emission "first scalar in bindings" rule renders
  `theme: dark` as the root's text (its consumed `session` value is an
  object, so no consumed scalar exists to protect; first source anchor
  wins, same order as `publishOwn`). Both adapters agree (PAR-5/SSR
  regenerated consistently), all page checks pass, and the demo's intended
  assertions are unaffected — documented here, not pinned as spec.

### Adjudication of the probe's five findings

1. **S1/S14/S15 — publishOwn bypass: GENUINE ENGINE DEFECT (above), NOT
   spec-scope.** Scope check: translate.md §2.1's "self-provider ⇒ own
   value" is not limited to pure-provider nodes by any wording; TR-H2 and
   the review doc's §5-C cite publishOwn as the MECHANISM, and the mixed
   node bypasses exactly that branch. The gate's spot-check-7 evidence
   still holds for pure providers (target-less nodes keep the promise) —
   the defect is scoped to consumer-bearing nodes. K8's duplicate rules
   constrain same-NAME mixes only; the failing config is the DIFFERENT-name
   mix (consume A, provide B, self-apply B), which the K7 legality matrix
   explicitly declares LEGAL. A spec carve-out ("self-apply requires a
   consumer-free node") would criminalize legal legacy data silently and
   contradict the legacy per-binding apply semantics; the engine-side fix
   is small and localized.
2. **S2 — warning order: DOC-FIX + pinned.** The actual order
   `[component-duplicate-target, component-duplicate-reference]` is the
   sane behavior: strict binding-array order with per-binding
   reference-then-target checks; element order dominates the per-binding
   sequence. Pinning in translate.md §2.1: YES — the warning stream is a
   consumer-facing contract and was previously order-unspecified; added.
3. **S5/S7 — re-translate warning-clean: DOC-FIX (scenario expectations),
   behavior is CORRECT and desirable.** Reverse is applyPath-only (K5): a
   gap/skipped target never carries an applyPath ⇒ its binding reverses
   target-less ⇒ nothing left to re-warn; re-translate is clean by design,
   and payload.md R-5 already promises "warnings never fire from the
   round-trip". S5's claim was internally inconsistent with its own reverse
   expectation; both scenario expectations corrected to the clean outcome.
4. **S10/S15 — nodeToLegacy drop broader than R-2's letter: DOC-FIX
   (payload.md R-2 broadened).** Code branch confirmed
   (`translate.ts:626`: `!isProvider && applyPath === undefined &&
   hasProvider`); the DECIDED plain consumer `{reference}` IS affected when
   it coexists with a provider anchor. The legacy plain consumer's graph
   shape is INDISTINGUISHABLE from the runtime two-name duplex the drop was
   designed for (anchors carry no provenance) — the code's drop is
   shape-forced, the sane behavior. R-2 now reads "any applyPath-less
   non-provider (consumer) anchor coexisting with a provider anchor".
   **Plain-consumer-twin guard decision: RECOMMEND a K8-style translate-time
   warn (candidate code `component-consumer-loss-on-reverse`) as a follow-up
   DECIDED** — the loss is silent and the config is legal under the current
   matrix, so a translate-time advisory (precedent:
   `component-target-placement`) is worth a future TDD pass. NOT implemented
   in this loop. The full alternative (a translate-set provenance flag that
   lets `nodeToLegacy` keep plain consumers) is a larger engine change;
   noted, not the recommended first step.
5. **S9 — idempotent round-trip: DOC-FIX + one line in translate.md §2.1.**
   The "not anchor-identical" claim was wrong: the authored-collision loss
   happens on pass 1 and pass 2 reproduces the same shape — the round-trip
   IS anchor-identical. The permanent loss is intended (K2 authored-derived-
   wins, no warn) but translate.md documented the K2 carve-out without its
   data-loss consequence; the chain (authored-wins ⇒ no synthesis ⇒ no
   applyPath ⇒ no reverse `target`) is now documented in the reverse-
   emission note.

### Doc/data fixes applied

- `docs/specs/translate-stress-scenarios.md` — corrected expectations marked
  `[reviewed]`: S1 (self-apply half re-recorded as defect #1; trap + reverse
  PASS), S2 (E2 warn order + numbering), S4 (warning-array-identical
  sub-claim), S5 (re-translate clean), S7 (re-translate clean), S9
  (anchor-identical), S10 (drop adjudicated; R-2 broadened), S14 (compile
  half re-recorded as defect #1), S15 (bake half → defect #1; reverse half →
  R-2 doc fix). No envelope data changed — no DATA-FIXes this pass.
- `docs/specs/translate.md` — §1 boundary note: reported-defect block for
  the publishOwn bypass ("self-provider ⇒ own value" currently holds only
  on consumer-free nodes; spec'd fix shape); §2.1: guard-order pin
  (finding 2); mapping-table row 7 + reverse-emission blockquote: R-2 drop
  broadened (finding 4) + authored-collision chain line (finding 5).
- `docs/specs/payload.md` — R-2 drop clause broadened to "any applyPath-less
  non-provider (consumer) anchor coexisting with a provider anchor"
  (finding 4).
- No changes to `src/`, `dist/`, `demo/`, or `scripts/translate-stress-
  probes/` (probe artifacts untouched as evidence).

### Validation trio (after the review edits)

- `npm test`: ALL PASSED (27 files, 539 tests)
- `npm run typecheck`: tsc --noEmit clean (exit 0)
- `npm run build`: tsc -p tsconfig.json clean (exit 0)
- `npm run demo:smoke`: all demo checks green; fork-stress-data d12 totals:
  placement 3943.7ms, values 4927.2ms (1.25×), link 5773.7ms (1.46×) —
  within ~1.5×, no pass-2 regression (docs-only review; no engine touched).

---

## Blind test #2 — translate-layer kernel showcase (subagent review loop)

### What the test was

A documentation-only writer produced `demo/translate-showcase.js` (+
`translateShowcaseServerData()`), `demo/translate-showcase.template.html`, and
`scripts/translate-showcase-page.mjs` — one legacy envelope exercising the
translate kernel K1–K8: the legal K7 array form (K1 synthesis +
provide-and-self-apply), a plain consumer of the root's K6 depth-0 provider,
duplicate-reference/duplicate-target pre-anchor blocks, vacuous `{}` vs valid
`[]`, unresolved-consumer key omission, the `props.name.` syntax edge, the
unknown-path gap warn, the dotted-reference carve-out, the K4 warnings
channel, and the K5/N1 reverse round-trip (PAR-5 expected page via
`SSRFragmentAdapter`).

The page reviewer wired the page into the build/smoke, verified intended-vs-
actual per card against `docs/specs/translate.md` §2.1/§5,
`docs/specs/legacy-component-ref-only-review.md`, `src/core/translate.ts`, and
`tests/unit/translate.test.ts`, and fixed data only.

### Findings (page reviewer)

1. **server-data script tag must carry `type="application/json"`.** The
   template's `<script id="server-data">` (no type) failed
   `extractScript` in `scripts/demo-smoke.mjs` (`missing <script
   id="server-data">`); every other demo template annotates BOTH embedded
   scripts with `type="application/json"`. Fixed the template annotation —
   this is the shared seed contract, not a smoke-script quirk.
2. **The page module compiled the tree twice; the first result was
   discarded.** `translated.root.compile(...)` ran at line ~170 with the
   result thrown away, then again at line ~173. The builder pipeline (and
   the `compileCalls=1` profile guard) contracts exactly one compile for
   the single bootstrap render. Removed the redundant call and made the
   profile line emit `compileCalls=1` (matches `feature-showcase`).
3. **No data-authoring fixes were needed.** All 9 cards, the warnings
   channel, and the reverse round-trip matched the pinned contract on the
   first pass (see per-card verdicts below).
4. **Doc drift from the writer's own claims**: `designing-pages.md` §11/§12
   claimed the page was "NOT yet wired into `npm run build`/`demo:smoke`
   (follow-up)" — stale the moment the reviewer wired it. Fixed; rule: the
   §11/§12 entries must state the wiring truth at the time the review loop
   reports complete.
5. **Vacuous checks under the shared runner (browser-check tool defect) +
   repair + re-verified 28/28.** The shared runner `demo/lib/runner.js`
   `check(name, fn)` counts PASS when the callback does NOT THROW — the
   return value is ignored. EVERY check on this page was boolean-returning
   (`() => attrAny(el, key) === 'x'`, `expected.every(...)`, `baked.every(...)`,
   …), so all 28 were VACUOUS: they passed regardless of the DOM/fragment.
   The engine defect was invisible: the array-card element's attrs were
   `{"id","apply-consumer"}` — NO `self-apply` — yet smoke printed
   "28 passed, 0 failed". Repair: every check converted to throw-style
   (`if (x !== y) throw new Error(...)`, feature-showcase style), no
   expectations changed. This exposed 2 REAL failures (the publishOwn-bypass
   defect #1: `array-card self-apply=null` + SSR fragment missing
   `self-apply="self-applied"`) plus one check flaw: the PAR-5 content-marker
   check read `appEl.textContent` (never aggregated by the smoke shim) and
   its attr fallback used the VALUE as the attribute NAME; both re-expressed
   via the shim-compatible `findEl` subtree walk + proper `[key, value]`
   pairing (expectations unchanged). Rule: runner checks must be throw-style
   — a boolean-returning check under this runner is a defect by definition.

### Per-card intended-vs-actual verdicts (independent probe, not page checks)

| Card | Intended (contract) | Actual (probe) | Verdict |
| --- | --- | --- | --- |
| #array-card | 3 legal bindings: K1 consumer apply, plain consumer, provider+self-apply; no warns | anchors `target:arrConsumer→props.apply-consumer`, `target:rootValue`, `source:selfApply→props.self-apply`; bakes `apply-consumer="arr-consumed"`; text `arr-consumed` (scalar first-wins) | MATCH |
| #consumer-card | plain consumer resolves root depth-0 provider (K6); authored derived bakes | text `root-provided`; `authored-bake="authored-literal"` baked (constant string is a legal DerivedExpr) | MATCH |
| #dup-card | dup ref + dup target blocked pre-anchor, first wins | anchors only `dupRef→props.keep1` + `dupTgt→props.shared`; keep2/other absent; warns ×1 each | MATCH |
| #vacuous-card | `{}` → `component-binding-empty`, no anchors, content renders | warn @ root.children[3]; no anchors; `vacuous-card-content` renders | MATCH |
| #empty-array-card | `[]` valid (K3 Array.isArray carve-out), no warn | no warn; content renders | MATCH |
| #unresolved-card | key omitted on null, content renders, no translate warn | `ghostRef→props.ghost` anchor kept; compile unresolved-reference; no ghost attr; content renders | MATCH |
| #syntax-card | `props.name.` → `component-target-skipped`, no apply, anchor kept | skipped @ root.children[6]; anchor `target:syntaxRef` w/o applyPath; no bake | MATCH |
| #gap-card | unknown path → `component-target-gap`, no apply | gap @ root.children[7]; anchor kept w/o applyPath; content renders | MATCH |
| #dotted-card | dotted ref → skip synthesis, anchor kept, resolves | skipped @ root.children[8]; `target:dotted.ref.name` w/o applyPath; text `dotted-value` | MATCH |
| Warnings channel | 6 warns, 5 codes (binding-empty 1, skipped 2, gap 1, dup-ref 1, dup-target 1) | exact set + paths as claimed | MATCH |
| Root | non-actionable (S-R2.5/F3 — providers consumed in-scope) | root NOT in SSR fragment; actionable = 9 cards only | MATCH |
| Reverse (R-2/R-5/N1) | apply path persists as `target`; name-target beside provider dropped; synthesized derived stripped; authored kept; re-translate clean | reversed bindings exact; re-translate warnings `[]`; **round-trip SSR fragment identical to the original** | MATCH |
| PAR-5 | SSR expected == live DOM modulo pathKey/ids | fragment embedded in server-data; page asserts baked attrs + content markers in both | MATCH |

### Validation

`npm test` (539 passed), `npm run typecheck`, `npm run build`, and
`npm run demo:smoke` all green; `translate-showcase: 28 passed, 0 failed`;
profile `translate=0.0ms compile=0.3ms render=0.3ms compileCalls=1 total=0.6ms`
(no pass-2 blowup — tiny page); fork-stress d12 guard: placement 3921.8ms,
values 4915.8ms (1.25×), link 5774.4ms (1.47×) — within ~1.5×, no regression.

> **Post-fix re-verification (engine defect #1 landed — finding 5 above):**
> the "28 passed, 0 failed" claim was VACUOUS at the time (all checks
> boolean-returning under the throw-only runner). After the throw-style
> repair + the `seedOwnBindings` engine fix (`src/core/node.ts`), the page
> is GENUINELY green: `translate-showcase: 28 passed, 0 failed`, the
> array-card carries `self-apply="self-applied"` in both the live DOM and
> the regenerated PAR-5 expected fragment, profile
> `translate=0.0ms compile=0.3ms render=0.3ms compileCalls=1 total=0.7ms`,
> and the fork-stress d12 guard holds (placement 3896.3ms, values 4699.0ms
> = 1.21×, link 5592.3ms = 1.44×).

---

## Blind test #1 — data-only feature showcase (subagent review loop)

### What the test was

The main agent wrote a data-only demo (`demo/feature-showcase.*`) **from the
documentation alone** — one legacy JSON envelope
(`LegacyInitialData`, `docs/specs/translate.md` §1) demonstrating as many
framework features as possible both isolated and combined, with **no page-side
feature logic** (handler bodies ship as function-STRING data instantiated by
`translateLegacy`; page module = core-only plumbing). No implementation
reading was allowed during authoring.

Two independent sub-agents then reviewed the artifacts:

- **Proofreader (docs)**: compared `docs/framework-feature-summary.md` and the
  `designing-pages.md` §11/§12 entries against code + specs; fixed doc
  inconsistencies.
- **Page reviewer**: tested the render, verified the expected output
  (`feature-showcase.expected.html` = SSR parity snapshot) against intended
  behavior, and fixed **data only** to produce the intended output — any use
  case needing an outside script/function was to be declared a data-authoring
  mistake.

> **Kernel landing note (translate-layer K1–K8 — supersedes several findings
> below):** the legacy translate kernel landed AFTER this blind test —
> `component.target` is now the LOCAL `props.<key>` apply path (K1/K2, with
> synthesized `bindings.*` derived reads; never a second component name),
> `component` accepts the K7 ARRAY form (multiple bindings per node — the
> "one component binding per node" format limit F5 identified is GONE),
> duplicate reference/target within a node's array are blocked pre-anchor with
> warns (K8), the additive K4 warnings channel ships on `TranslatedTree`,
> the root `template.component` mirrors the node mapping (K6), and reverse
> persists the apply path + strips synthesized derived (K5/N1,
> `tests/unit/reverse.test.ts`). Suite: 539 green (`tests/unit/translate.test.ts`
> 52 tests + the 8-test K5/N1 reverse unit). Findings F4/F5/F7 are annotated
> below; F2/F3/F6/F8/F9/F10 are unaffected by the kernel.

### Findings (authoring errors + real behavior)

| # | What the data author assumed | What the pipeline actually does | Class |
| --- | --- | --- | --- |
| F1 | derived paths may name any component reference (`bindings.kpi.revenue`) | derived path KEYS are single segments; keys with dots are REJECTED at validation (`derived-invalid`, `docs/specs/derived-state.md` §3) — reference NAMES may contain dots, derived PATH KEYS may not | A (data) |
| F2 | an in-tree provider resolves for any descendant consumer | in-tree sources resolve only at **depth-0 (root)** or **self**; a sibling/ancestor-of-nonroot source is invisible to consumers (S-R2.6) | A (data) |
| F3 | a provider node renders its value as text wherever it sits | a value-bearing SOURCE node is actionable (renders its own value) ONLY when alone/self-scoped; the moment a same-name TARGET exists in its scope the provider is dropped (fork multiplicity, S-R2.5) | A (data, semi-surprising) |
| F4 | a duplex node self-renders its source value | a duplex node renders from its TARGET resolution only; its source half serves consumers, not its own text (probe: duplex-alone → no self binding). **Kernel landing (partial supersession):** the runtime rendering claim STANDS, but the two-name duplex anchor shape is now legacy-unexpressible — `target` is a local apply path, never a second name (K1–K8). The showcase's duplex demonstration moved to provide-and-self-apply (`{reference, value, target: 'props.<k>'}` — K1/K2 synthesized derived), so the data-level "duplex from legacy" premise is superseded | A (data) |
| F5 | consumer-side fork arms are expressible from legacy data | the legacy format carries ONE component binding per node; a multi-provider fork (N arms) needs N sources on root → demonstrated imperatively in `demo/components.html`, not from a legacy envelope. **SUPERSEDED by K7 (kernel landed):** the legacy `component` ARRAY form now expresses N bindings per node — verified mechanically, a root expresses TWO sources via `template.component: [{reference: 'a', value: 1}, {reference: 'b', value: 2}]` (and any node via its `component` array), anchoring every binding (`tests/unit/translate.test.ts` K7: "array of N bindings anchors EVERY binding"; "template.component accepts the array form too"). CAVEAT: same-name repeats within ONE node's array are K8-blocked (`component-duplicate-reference`), so an N-arm fork for a SINGLE name still needs N provider NODES — expressible from a legacy envelope as N sibling children, each carrying its own binding | A (format limit) — SUPERSEDED by K7 |
| F7 | two sibling targets referencing each other trigger `circular-source` | a sibling pair can never borrow-walk into each other — both are just `unresolved-reference`. A REAL borrow-walk loop needs a provider chain that revisits a walk-path node (duplex parent→child cycle). **Kernel landing (mechanism updated, substance stands):** the parent→child cycle is now authored via the K7 ARRAY form — `loop-a` declares `component: [{reference: 'loop.x', value: 'A'}, {reference: 'loop.y'}]` (provider + consumer on one node) with its child `loop-b` mirrored — no duplex anchors needed (duplex is legacy-unexpressible); the walk revisits a path node and the arm drops as `loop` + `circular-source`, never rendered (the showcase's loop pair does exactly this) | B (reviewer-corrected: re-expressed in data) |
| F8 | `data-path`/`pathKey` in a static expected-output snapshot is stable | pathKeys bake minted node ids → ids differ per process; the SSR snapshot and a live browser never agree on `data-path` values (structure/content parity only) | B (inherent) |
| F9 | the smoke shim behaves like a browser DOM | shim `getElementById` returns only seeded elements, no `querySelectorAll`/`classList`/`Event` dispatch → DOM checks must walk the `#app` subtree and read attrs via `getAttribute` | B (test) |
| F10 | SSR renders handlers like the DOM binds them | SSR inlines `on:*` as attributes (`oninput="true"`); DOM binds real listeners via the `onEvent` seam (documented divergence, adapters.md §4.2) — smoke drives `dispatchEvent` directly, so the live listener path is browser-verified only | B (documented) |

Class A = data/authoring oversights (writer misread the model). Class B =
renderer/spec/browser divergences the test surfaced.

### What the review loop caught that the author missed

1. **F7 was a real doc-vs-behavior gap in the demo, not just a wording issue** —
   the author's "loop-safety" section never exercised `circular-source` at all.
   The reviewer re-expressed it in data (duplex parent→child chain) so the
   documented mechanism is actually probed.
2. The proofreader corrected 9 stale/incorrect spec references in the summary
   (`node.md §10/§8` not `§7/§5`, journal lives in `api.md §1–§3` + `ops.md §6`,
   `css:cssDef` is not a set-prop name — it flows only through the batch
   `styles` op, etc.).
3. Both agents independently re-verified the final gates:
   `npm test` (496), `npm run typecheck`, `npm run build`,
   `npm run demo:smoke` (`feature-showcase: 14 passed, 0 failed`; profile
   `compileCalls=1`, no pass-2 scaling blow-up).

### Process rules this blind test established

- After ANY feature/behavior change: run the **blind-test review loop** (§
  "Blind-test → subagent review" in AGENTS.md) as a documentation test and
  consistency check.
- A demo claim that cannot be satisfied from the data alone (needs a custom
  function/fixture) is a **data-authoring mistake** — re-express in data or
  drop the claim; never paper over it with page JS.
- Derived-path keys: single segments, no dots — even when reference names
  carry dots.
- Expected-output snapshots: assert structure/content, not minted ids or
  `data-path` values.
- DOM checks in pages must be smoke-shim compatible (subtree walk +
  `getAttribute`), or the smoke will lie to you.

---

## Stress-test review loop #1 — legacy-JSON compile/render breakage probes

Status: COMPLETE (review agent, step c of AGENTS.md item 10). Scenario specs:
`docs/specs/stress-test-scenarios.md` (corrected entries marked `[reviewed]`);
probe evidence: `scripts/stress-probes/RESULTS.md` + `run-all.mjs` (untouched,
kept as evidence). Each mismatch classified into exactly one of PASS /
DOC-FIX / DATA-FIX / ENGINE-DEFECT.

### Per-scenario verdicts

| # | Verdict | Notes |
| --- | --- | --- |
| 1 | PASS | 1000-level acyclic chain compiles actionable root-first (compile-horizon §6.1 — uncapped, cycle-only); leaf pathKey 1001 segments; SSR nests 1000 deep; serializeSlice round-trips |
| 2 | PASS | 10,000 children all attach in order (10,001 actionable, 10,000 appends); **perf note (not a defect):** `SSRFragmentAdapter.appendChild` rematerializes the owner's contentHtml per append (adapters.md §4.3, FRG-H22 — documented mechanism, no complexity contract) → ~O(n²) SSR apply (10k ≈ 3.5–4s); DOM adapter unaffected |
| 3 | PASS (doc claim fixed) | void-tag DOM/SSR divergence CONFIRMED as documented (adapters.md §4.3/FRG-F1/FRG-H20 void = openTag-only vs §3.4 DOM move semantics — the scenario's "SSR-F4 class" guess was wrong; both sides follow their own table); `type: 42`/missing-type doc claim fixed: `baseFrom` copies string types only → silent `'div'` fallback (translate.js/node.js), no `<42>/<undefined>` ever emitted |
| 4 | DATA-FIX | primary envelope could not translate — array literal `[1,2]` is not a legal `$eq` operand (DSL adjudication below); re-expressed with `$`-path operands (`data-eq` self-compare → `"true"`, `data-eq-null` vs missing binding → `"false"`); all other assertions (falsy bakes, null omission, `$concat` object stringify, F3 provider drops, sibling invisibility) verified green on the corrected envelope |
| 5 | DATA-FIX | scenario text claimed `x-consumer` is a descendant of `du2`; authored JSON placed it as a root SIBLING → moved under `du2` in the envelope; corrected expectation verified green (`data-resolved="duplexval"`); everything else (root duplex self-bind, du2 unresolved `y`, y-source dropped) already matched |
| 6 | DOC-FIX | (a) "one circular-source warning" → the warnings array is per-dropping-node: 6 total (triangle 4 + linear 2), matching node.md warnings shape + api.md T13; (b) "consumer still renders its own state" → a loop-dropped arm exposes NO actionable state (api.md T13, S-R3.10) so tri/lin-consumers render NOTHING; only the unresolved-reference class renders (S-R4.3 — lin-p2..p10 do). Depth-cap-counts-as-loop is DOCUMENTED (pipeline.md §2.1, node.md FS-7, compile-horizon §6.4) — not a defect |
| 7 | ENGINE-DEFECT #1 + DOC-FIX | 5 fork arms compile with distinct `cs.forkKey`s but `emitOne` never forwards them → ops carry NO forkKey; scenario's "5 creates for ONE wire" premise corrected to the documented per-arm wire scheme `<nodeId>#<0..4>` (fork-stress.md); arm order is LIFO (m5→m1), all values present |
| 8 | PASS (prose fixed) | outcome matches (one actionable arm, `rootval`, no warnings); mechanism differs from scenario prose — the unplaced provider is never enumerated (D5 root fallback wins the ancestor walk first); the "arm terminates unplaced → silent drop" branch never fires; prose corrected |
| 9 | PASS | nearest-shadows-far: deep-consumer binds `"near"`, one arm, no fork; root duplex self-binds `"far"`; near-provider dropped (F3) |
| 10 | DATA-FIX (premise) | "placement multiplicity forks like components (P3)" is NOT expressible from a static legacy envelope — placement resolution is `attach` op + compile (api.md §4); P3 forks materialize only dynamically. Corrected expectation (each slot = one state, own wire; both render; unicode/dot/space names minted verbatim; dual-slot no role-mismatch, provides `dual`) verified green. **SUPERSEDED (placement-path-spec §1.2/§2, Units 2–12 landed):** the premise is INVERTED — P3 IS now statically expressible: `targetPlacement: string[]` mints ordered `content` anchors at translate and the path-enumeration compile forks one path-state per (node, path-to-root) (`forkKey = pathKey`, per-zone fan-out of the first-match name). The probe evidence (placement anchors inert at static compile, pre-model) stands as the historical record; the §5.2 static census (23/4095/0/0) is the landed replacement |
| 11 | PASS | translate throws a RAW SyntaxError (code=none — undocumented crash surface confirmed, not a structured guard); containment, observation-only returns, duplicate-handler double fire, event/phase cross-fire all confirmed |
| 12 | DATA-FIX + DOC-FIX | array-literal `$eq` re-expressed (see #4); "serialized authored state keeps authored-value untouched" corrected — `serializeNode` omits ALL derived-declared keys from shipped props (derived-state.md §2), probe: shipped keys = `["id"]`; pass-1 canon keeps it (DV-H5). Corrected envelope verified green incl. `data-eq=true`, root F3-dropped |
| 13 | ENGINE-DEFECT #2/#3 | expected output was SPEC-consistent (R6/HLP-H1/H13, DOM-H12/H13, FRG-H17); the canonical emit path leaks `css.cssDef` as a `css:cssDef` set op and never emits a `styles` op → DOM: cssDef attribute, NO style element; SSR: stylesBuffer block with `[object Object]`; two surfaces diverge for one op stream (SSR-F4 class) |
| 14 | PASS | escapeText/escapeAttr tables exact (`&` `<` `>` text; `&` `"` `<` `>` attrs); unicode verbatim; newline/tab preserved; PAR-5 structural parity holds (on:* skipped); handler body with escaped quotes dispatches unmangled |
| 15 | PASS | payload items unplaced/inert (no render, no warnings, no eager compile); pc1/pc2/pc3 anchors minted; duplicate literals mint two distinct nodes (TR-3/TR-4) |
| 16 | PASS | clientConfig mapping exact for all four envelopes; unmapped gates inert (TR-F2); serializeSlice preserves the 2-field shape |

### Engine defects (do NOT fix in this loop — report only)

**DEFECT #1 — `emitElements` drops `cs.forkKey` (fork-arm ops carry no forkKey)**
- Spec: render.md §3.1 (MinimalElement contract: "forkKey present on
  actionable fork arms (S-R3.10); forwarded onto emitted create/set/remove
  ops"; op table: "forkKey present only on actionable fork-arm emits");
  contract.md §render ("diffMinimal … forwards an element's forkKey (when
  present) onto the create/set/remove ops it emits"); adapters.md §10.3
  HLP-H16 ("a compiled fork … ops carry distinct forkKeys per arm (S-R3.10):
  one create per arm with a distinct forkKey, and each arm's set ops forward
  the same forkKey as its create"); S-R3.10.
- Observed vs required: `emitOne` (dist/core/render-helpers.js:212-273)
  returns MinimalElements `{ wire, type, props, childOrder }` without
  `forkKey`, so `diffMinimal` emits create/set ops with NO forkKey (probe
  scenario 7: creates have forkKeys=false, set-ops-with-forkKey=0). Required:
  each fork arm's element forwards `cs.forkKey` (exactly what
  `minimalFromState` does at render-helpers.js:18-19).
- Repro: scenario 7 — one consumer, 5 descendant providers; 5 actionable
  states with distinct `cs.forkKey`s; op stream has none; arms stay distinct
  only via the `<nodeId>#<i>` wire suffixes.
- Severity: MEDIUM. Mounting stays correct (documented emitElements arm-wire
  convention, fork-stress.md, masks the gap), but the op contract, the
  adapters' forkKey-keyed addressing (DOM-H27 "a set carrying a forkKey
  targets only that arm"; wireKey composites), `treeSig`'s forkKey dimension,
  and applyOps cross-batch fork identity are all unexercised by the canonical
  path.
- Fix shape (future TDD pass): in `emitOne`, forward
  `s.forkKey` onto the element in every return branch (mirror
  `minimalFromState`); red test: `Node.compile` → `emitElements` →
  `diffMinimal` on a 2+-arm fork asserts each arm's create AND its set ops
  carry distinct forkKeys equal to `cs.forkKey`.
- **RESOLVED (emit-layer TDD unit, placement-path §4.3/§6.5 prerequisite)**
  — `src/core/render-helpers.ts`: `emitElements`' actionable param + `EmitState`
  declare `forkKey?: ForkPathKey`; `emitOne` forwards `s.forkKey` in every
  return branch (def/type branch, plain branch, arm branch — mirroring
  `minimalFromState`). `render.ts` needed no change (`MinimalElement` +
  `diffMinimal` already forward forkKey). Tests: `tests/unit/render.test.ts`
  "DEFECT #1 — emitOne forwards forkKey onto emitted elements and ops"
  (DEFECT-1a..1e: arm elements + create/set ops carry `cs.forkKey` distinct
  per arm; non-fork states carry none; applyOps/treeFromOps preserve forkKey
  via `wireKey` composites; `treeSig` stable + exercises the forkKey
  dimension; def/type branch forwards). Full trio + build + demo:smoke green
  (only pre-existing feature-matrix fork-claim demo failures remain,
  unchanged by this unit — tracked for the §6.4 demo fork-claim rebuild).

**DEFECT #2 — `emitElements` leaks `css.cssDef` as a `css:cssDef` set op (R6/HLP-H1/H13 violation)**
- Spec: adapters.md §3.2/§4.2 + §10.3 HLP-H1/H13 (`css` → `css:*`
  EXCLUDING `cssDef` — "cssDefs flow via the styles op, R6");
  render.md §3.1 ("cssDef flows via the styles op, not here"); R-ORD-6
  (≤1 `styles` op per batch).
- Observed vs required: `emitOne` (render-helpers.js:217-218) maps `s.css`
  verbatim — including `cssDef` — into a `css:cssDef` set op; the R6
  exclusion exists only in `minimalFromState` (render-helpers.js:10-12), and
  NO `kind:'styles'` producer exists anywhere in dist/core, so legacy
  cssDef data never reaches a `styles` op. Required: `cssDef` must not
  appear as a set op; it flows via the (R-ORD-6 coalesced) `styles` op.
- Repro: scenario 13 — DOM renders `cssDef="[object Object]"` attribute and
  NO style element (DOM-H12/H13 unmet); SSR renders a
  `<style id="preempt-dynamic-styles">` block containing `[object Object]`.
  Same op stream, two different surfaces — the exact SSR-F4 class the
  spec forbids.
- Severity: MEDIUM. Deterministic (no crash), but PAR-5 parity is broken for
  the css surface on the canonical legacy path.
- Fix shape (future TDD pass): exclude `cssDef` in `emitOne` exactly as
  `minimalFromState` does, AND decide the R6 producer leg — either
  diffMinimal D5 emits one coalesced `styles` op per batch for
  cssDef-carrying elements (per R-ORD-6), or the payload is dropped at emit
  (spec decision required); red test: legacy envelope with `css.cssDef` →
  ops contain NO `css:cssDef` set; the cssDef payload arrives via exactly
  one `styles` op; DOM has exactly one style element (DOM-H12/H13) and SSR
  the same block.

**DEFECT #3 — `SSRFragmentAdapter` routes arriving `css:cssDef` sets into the styles buffer, contradicting its own §4.2/§4.5 fallback**
- Spec: adapters.md §4.2 ("if a `css:cssDef` set still arrives it is treated
  as a `css:<other>` attribute `cssDef="…"` (legacy-unsupported,
  deterministic)" — mirrors §3.2) and §4.5 ("`css:cssDef` sets do not feed
  this buffer (R6 — removed)").
- Observed vs required: adapters.js:207-208 — `if (key === 'cssDef')
  this.stylesBuffer.push(String(val))`; required: `cssDef="…"` attribute on
  the fragment, nothing in the buffer.
- Repro: scenario 13 (only reachable through defect #2's invalid op).
- Severity: LOW–MEDIUM (invalid-emit fallback only, but the two adapters'
  documented fallbacks for the same op are then diverging: §3.2 attribute vs
  §4.2 attribute-required).
- Fix shape (future TDD pass): mirror the §3.2 branch (escapeAttr attribute
  `cssDef="…"`), drop the stylesBuffer push; or amend §4.2/§4.5 if the
  buffer routing is the wanted behavior — review recommends the attribute
  fallback so both adapters agree.

### DSL-conflict adjudication (scenarios 4/12 — array-literal `$eq`/`$gt` operands)

**The validator (and the spec) give; the scenario docs were wrong.** The
`DerivedExpr` grammar in derived-state.md §3 lists literals as
`string` / `number` / `boolean` / `null` ONLY — an array is not a literal,
so an array operand makes the expression malformed. `validateExpr`
(src/core/derived.ts:56-58) rejects arrays as operands at every declaration
boundary (`derived-invalid: malformed derived expression: [1,2]`), matching
§7's fail-fast list; tests/unit/derived.test.ts:396-443 pins the gate (valid
`$eq` operands are scalar literals or `$`-paths; no array-literal operand
exists in the valid set; deep equality is tested via two `$`-paths, line
129). Deep-ARRAY `$eq` remains expressible through `$`-paths (`deepEquals`
handles arrays, derived.ts:133-139) — both scenarios are re-expressed that
way and verify green. The DSL's "JSON-deep equality" meaning row describes
the EVALUATION of valid operands, not a license for array literals. Classed
DATA-FIX (scenario data), not a spec or engine change.

### Adjunct assessments requested by the review brief

- **Scenario 6 semantic conflation (depth-cap trips reported as
  `circular-source`)**: DOCUMENTED behavior, not a defect — pipeline.md §2.1
  ArmDropReason `'loop'` ("loop-guard/depth-cap trips count AS loop — log
  'circular-source'"), node.md §2 + FS-7, compile-horizon-review.md §6.4
  ("provider chain ≥ 9 hops → drop"). The scenario doc's "semantically
  false" note stands as a DECIDED label quirk (a depth drop and a true cycle
  share the `loop` reason); it is pinned in the docs, so no code change was
  implied and none is proposed.
- **Scenario 2 SSR O(n²) append**: documented mechanism (adapters.md §4.3
  rematerialize-per-append, FRG-H22), no complexity contract exists, output
  correct, pre-existing — perf note only, not an engine defect.
- **Scenario 3 void-tag DOM/SSR divergence**: documented on both sides
  (FRG-F1/FRG-H20 vs §3.4) — inherent DOM-vs-string semantics, not an
  engine defect; the scenario doc's "exactly the class SSR-F4 forbids" guess
  was corrected.

### Validation trio (after the review edits)

- `npm test`: ALL PASSED (27 files, 496 tests)
- `npm run typecheck`: tsc --noEmit clean (exit 0)
- `npm run build`: tsc -p tsconfig.json clean (exit 0)
- `npm run demo:smoke`: all demo checks green (no engine/demo/test files
  touched by this review; probe artifacts unchanged)

Corrected-envelope re-verification (scenarios 4/5/12) run against
`dist/core/*` via a standalone core-only script: 27/27 checks pass — see
the `[reviewed]` entries in `docs/specs/stress-test-scenarios.md`.
