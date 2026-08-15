# Session Defect Review — demo/payload/render fixes (mode-toggle + feature-matrix polish)

Status: review of all defects observed and fixed in the session that built the
mode-toggle page, hardened the shared feature-matrix harness, fixed real-browser
DOM behavior, and added the manual-drop UX. All defects are FIXED and green
(438 tests, typecheck, build, demo:smoke).

Every defect below is classified into one of two families:

- **Class A — data/authoring oversights** (agent miscommunication with the
  data model or with other agents' fixture code): the code was consistent with
  itself, but the *data the agent wrote* (fixture JSON, expected strings,
  class hooks, copy text) disagreed with what the renderer/spec actually
  produces. Fix = correct the data + record the miscommunication so future
  authors don't repeat it.
- **Class B — renderer vs browser/expectation mismatch**: the renderer (or the
  harness/tests) did something that a real browser or a human reading the page
  experiences differently. Each entry records: spec-mismatch vs code-mismatch,
  why the headless tests failed to replicate the browser, and the fix.

---

## Defect inventory

| # | Symptom (observed) | Root cause | Class |
| --- | --- | --- | --- |
| D1 | SSR-mode check: `received HTML missing wire user-pane (id="node-85")` | harness checked `receivedHtml.includes('id="<nodeRef>"')`; SSR html carries the **props.id** (`user-pane`), not the node ref | A |
| D2 | markdown-mode check: `markdown display not rendered` | check asserted the display's *initial* parse (`md-prefix === 'Type'`) after the shared suite had already re-parsed the editor to `Goodbye **friend**!` | A |
| D3 | browser: `placements: … .children.map is not a function` (also payload lifecycle, forks) | harness called `.map` on `element.children`; real DOM `children` is an `HTMLCollection` (indexable, no `.map`) — the smoke shim used an Array, so headless passed | B (test/browser divergence) |
| D4 | browser: `article live state not preserved` | **cascade** of D3 — the payload check threw at the `.map` line before the article refresh ran, so reverse translation read stale roots | B (cascade of D3) |
| D5 | browser: `raw markdown source not embedded` when served statically | static client-mode build (or plain static serve) carried no mode payload; `?mode=markdown` forced a check the page couldn't satisfy | A (serve-contract misunderstanding) |
| D6 | Loop-safety probe 5 flake: `expected zero warnings` (intermittent, load-dependent) | probe counted process-global `console.warn` during a 3-tick window; other pages' `circular-source` warnings leaked in (headless smoke shares one process) | B (test isolation) |
| D7 | Login/Logout buttons present but unstylized | fixture user-pane nodes had no `css.classes`, so demo.css `.user-pane` styles never applied | A |
| D8 | markdown display showed `Type **bold** hereGoodbye friend!` | `md-display` node carried a base `content` AND parsed children — both render, concatenated | A |
| D9 | typing in the editor loses focus (real browser) | `diffMinimal` re-appended every child in order on every render; in a real DOM `appendChild` on an attached element detaches+re-inserts → focused textarea blurs. Smoke only checked wire identity, never DOM position | B (spec vs browser) |
| D10 | one keystroke ⇒ 29-node full compile | harness `render()` recompiled the whole graph per update (TODO-admitted deviation) instead of consuming `supervisor.takePass2States()` | B (code vs DECIDED spec) |
| D11 | loop probe promised surviving sibling content; none rendered | fixture note text claimed "sibling content below survives" but the section's only child was the dropped arm; harness pinned `children.length === 1` | A |
| D12 | no loop warning visible in logs | harness suppressed `console.warn` for the whole `render()`, swallowing the bootstrap's `circular-source` warnings | B (harness vs user expectation) |
| D13 | theme section renders as undecorated text | fork-demo section + arms had no `css.classes`; `.fork-arms`/`.arm-card` CSS never applied | A |
| D14 | comments zone empty / "Only third comment is visible" | after the manual-drop verification the page restored a single throwaway comment (`Third comment.`), not the zone's populated state | A (UX copy/restore) |
| D15 | `?mode=ssr requested but no SSR payload embedded; falling back to client` | same serve-contract as D5 — static page lacked payloads; fixed by embedding both payloads in every build | A (same as D5) |
| D16 | markdown-raw section promised a live parsed display; only raw source shown | section copy described a live display that didn't exist in the section | A (copy vs DOM) |

---

## Class A — data/authoring oversights: the miscommunications

These are the "agent wrote the wrong data" defects. Each entry: what the agent
assumed, what the model actually says, and the rule to follow.

### A-1 (D1) — node refs vs presentation ids

**Assumption**: the harness checked the received SSR html for
`id="<nodeRef>"` (e.g. `node-85`), taking `byName[name]` (the node ref) as the
element id.

**Reality**: `emitElements` maps `props.id` → `id="user-pane"` etc. The SSR
html's id attributes are the **presentation ids from props.id** — never the
node refs. `serverData.nodeLabels` maps **nodeRef → {name, type}**, not the
reverse.

**Rule**: when asserting on rendered HTML (SSR string, DOM attributes), match
`props.id` values (the presentation id). Node refs (`byName[x]`) are only for
graph access (`adapter.wires`, `statesOf`). See `demo/lib/feature-matrix-tests.js`
SSR-mode check.

### A-2 (D2) — asserting stale initial state after the suite mutated it

**Assumption**: the markdown-mode check asserted `md-prefix === 'Type'` (the
editor's shipped value) at the end of the run.

**Reality**: the shared feature-matrix suite re-parses the editor to
`Goodbye **friend**!` mid-run (markdown T8 check). By the time the mode check
runs, the live display holds the *re-parsed* content.

**Rule**: mode-specific/end-of-run checks must assert the **live end-state**,
not the initial value. If a check wants the initial state, it must run before
the mutation checks (or restore state first). Check-ordering is part of the
harness contract — document it where the checks are written.

### A-3 (D5/D15) — the page-serve contract (static vs dynamic)

> **Scope note**: the tri-mode render is a **demo-page test case — NOT
> expected real-world behavior**. No production app switches one document
> between SSR/client/markdown adapters on a single URL; the mode-toggle page
> exists purely as a comparative test fixture for the three adapter surfaces.
> The fixes below make that *fixture* robust under any serve method — they are
> not a statement about production routing.

**Assumption**: the mode-toggle page only worked when served by
`scripts/serve-demo.mjs` (per-`?mode=` payload embedding); the static
`demo/mode-toggle.html` and any plain static serve carried no mode payloads, so
`?mode=` requests degraded.

**Reality**: `scripts/build-demo.mjs` emits the static file and users may open
it from disk / any static server.

**Rule**: demo pages that advertise `?mode=` switching must embed **every**
mode payload in **every** build (SSR html string + raw markdown source), and
use `data-mode`/`hidden` only for reveal state. A "fallback to client" path is
a red flag that the page is coupled to one server. (Fixed: both payloads are
now always embedded; the fallback remains only as a stale-build safety net.)

### A-4 (D7/D13) — css classes are data, not magic

**Assumption**: the fixture nodes had no `css: { classes }`, so demo.css
styles (`.user-pane`, `.arm-card`, `.fork-arms`, `.login-btn`, `.logout-btn`,
`.editor`, `.display`) never applied — rendered as undecorated elements.

**Reality**: the renderer emits `css:classes` verbatim as the element `class`
attribute; it does not infer classes from element ids or types. Styling only
happens when the fixture's `css.classes` names match a demo.css selector.

**Rule**: every fixture node that should be styled must declare
`css: { classes: [...] }` naming the demo.css selectors — check the CSS file
first, then the fixture. Unstyled-but-styled-in-CSS is an authoring bug, not a
renderer bug. (Same class of oversight hit twice: user-pane and fork-demo.)

### A-5 (D8) — content + children both render (no shadowing)

**Assumption**: putting a base `content: 'Type **bold** here'` on `md-display`
*alongside* prefix/bold/suffix children would be replaced by the parsed parts.

**Reality**: `text` and children both render — the element shows
`Type **bold** here` **plus** `Goodbye friend!` concatenated. The e2e
(markdown-display) and components demo pattern: the display has **no** base
content; only the parts.

**Rule**: an element with children must not also carry `content` unless the
concatenation is intended. For a "parsed into parts" display, the container
node has NO content.

### A-6 (D11) — copy promising DOM that doesn't exist

**Assumption**: the loop-probe note text "sibling content below survives:"
implied surviving sibling content; the section's only real child was the
dropped loop arm.

**Reality**: the harness *pinned* `children.length === 1` (only the note),
so the promise was unfulfilled.

**Rule**: demo copy must match the DOM the fixture + harness actually produce.
When the copy promises behavior (sibling survives), the fixture must contain
that sibling (a plain content node with no component reference) and the
harness must assert it. Copy-first, DOM-second is the bug; DOM-first, copy
second is the fix.

### A-7 (D14) — restore step must match the narrative

**Assumption**: after the manual-drop verification, restoring a single
"Third comment." node was enough.

**Reality**: the zone is a comments placement — after restore the visitor saw
a comment that never existed in the lifecycle, and only one.

**Rule**: post-check restore steps must restore the *narrative* state (all
comments the demo created, with the contents they carried), not a throwaway.
Restore the data the copy describes.

### A-8 (D16) — copy promising a component the page lacks

**Assumption**: the markdown-raw section said "the live parsed display" but
contained only the raw `<pre>`.

**Reality**: no live display element existed in that section.

**Rule**: same as A-6 — a section that advertises a live view must contain it
(a `#markdown-live` container populated by the harness) — and the harness
must restore the editor to the shipped source so the live view matches the
raw source shown.

---

## Class B — renderer vs browser/expectation: spec vs code, and test blindness

For each defect: **spec-mismatch** (spec/skill said the wrong thing vs browser
reality) or **code-mismatch** (code deviated from an existing spec), plus why
the headless suite did not catch it and the fix.

### B-1 (D3/D4) — HTMLCollection vs Array (test shim blindness)

- **Spec or code?** Code was consistent with the **test shim**, which was
  wrong vs the browser: `demo-smoke.mjs`'s `El.children` was a plain Array
  (`.map` works); real DOM `children` is an `HTMLCollection`.
- **Why tests didn't catch it**: the shim over-modeled children as an Array —
  every `children.map(...)` in the harness passed headlessly.
- **Fix (done)**: harness wraps children in `Array.from(...)` at every read
  site; the smoke shim gained a `REAL_DOM_CHILDREN=1` mode exposing children
  as an HTMLCollection-like (indexable, `.item()`, **no** `.map`) so array-
  method misuse fails the smoke. Also strengthened D3's check detail.
- **Rule**: harness code that touches `element.children` must always
  `Array.from(...)` it, and the shim must emulate HTMLCollection (run smoke
  with `REAL_DOM_CHILDREN=1` as a browser-realism gate).

### B-2 (D9) — focus loss: spec said "re-append every child" (spec vs browser)

- **Spec or code?** **Spec mismatch with browser behavior.** The spec
  (`render.md` §3.2, `diffMinimal` header, D5 "re-append in compiled order")
  mandated re-appending every child every render. Code followed the spec
  exactly. But in a real DOM, `appendChild` on an already-attached element
  detaches and re-inserts it — blurring a focused textarea, even though the
  element object survives.
- **Why tests didn't catch it**: the headless identity check
  (`adapter.wires.get(wire) !== oldEl`) only verified the element object
  survived; it never checked DOM position or relocation. The shim even
  documented "real-DOM move semantics" — mirroring the *move*, not the *blur*.
- **Fix (done)**: refined D5 → appends fire only when the child order changed
  or the child was created/re-created this pass (ORD-H6). The harness now
  asserts the editor wire gets NO append/remove op on typing (the actual blur
  mechanism), and `tests/unit/render.test.ts` gained D5 cases pinning:
  unchanged order ⇒ 0 appends; reorder ⇒ re-append; new child ⇒ append.
- **Rule**: focus-safety assertions must target the *mechanism* (ops touching
  the focused wire), not just object identity. Spec text must be written
  against browser semantics, not op-stream convenience.

### B-3 (D10) — 29-node compile per keystroke: code deviated from DECIDED spec

- **Spec or code?** **Code mismatch with a documented DECIDED contract.**
  RENDER_PROCESS_NOTES §10.10.10 + `designing-pages.md` §5 say re-render never
  compiles after bootstrap — consume `supervisor.takePass2States()`. The
  harness had a TODO admitting the deviation (`rootNode.compile(renderNodes)`
  per update).
- **Why tests didn't catch it**: all checks assert *outcomes* (rendered
  content, parity); none asserted *compile scope*. The smoke's compile logs
  showed the 29-node passes but nothing failed on them.
- **Fix (done)**: rewrote the harness `render()` to the components.js pattern
  — bootstrap compiles once, incremental renders consume `takePass2States()`;
  direct payload mutations recompile only the changed zone's focused slice
  (`recompileFocusedFor` + `focusedSliceFor`) and prune departed states.
  Compile logs now show focused 3–8-node passes only.
- **Rule**: any test harness for a framework with a focused-pass contract must
  assert *scope* (node counts, `focus=`) somewhere — either via compile-pass
  logging or a `compile` spy — not just output.

### B-4 (D6) — loop-safety probe flake: global console.warn is not isolated

- **Spec or code?** Neither spec nor browser — **test isolation mismatch.**
  Probe 5 counted `console.warn` during a 3-tick window; the headless smoke
  runs every demo module in one process, so other pages' `circular-source`
  warnings (feature-matrix loop arms, mode-toggle compiles) leaked into the
  window. Load-dependent ⇒ intermittent.
- **Why tests didn't catch it**: it *was* caught — intermittently, in CI-like
  runs. Deterministic in isolation; flaky in the shared process.
- **Fix (done)**: probe 5 counts **diagnostics on its own EventBridge**
  (`events.subscribe('diagnostic')`) instead of the process-global
  `console.warn`. The supervisor pushes `diagnostic` events per-system, so the
  count is scoped and deterministic.
- **Rule**: in-process demos/tests must scope assertion inputs (own
  EventBridge, own node ids) — never global sinks (`console.warn`,
  `process.stdout`) when other modules share the process.

### B-5 (D12) — loop warning invisible: harness swallowed console.warn

- **Spec or code?** Code-vs-user-expectation: the harness suppressed
  `console.warn` during renders (to keep check noise down), which also
  swallowed the bootstrap's `circular-source` warnings — the loop probe's
  whole point was to show them.
- **Why tests didn't catch it**: checks asserted `cr.warnings` (the compile
  result object) — never the console output.
- **Fix (done)**: the bootstrap render captures `cr.warnings` and re-emits
  them through the restored `console.warn` as `[feature-matrix] circular-source
  at <path>`. Incremental renders stay quiet.
- **Rule**: when a demo's *raison d'être* is a visible diagnostic, the harness
  must surface it (re-emit bootstrap warnings), and the smoke should grep the
  emitted console output for it.

---

## Why the headless suite failed to replicate browser behavior (cross-cutting)

| Root cause | Affected | Solution (status) |
| --- | --- | --- |
| Shim `children` modeled as Array, not HTMLCollection | D3, D4 | `Array.from` everywhere + `REAL_DOM_CHILDREN=1` emulation gate (done) |
| Identity checks didn't model DOM relocation/blur | D9 | op-level "no append/remove on the focused wire" assertion + D5 unit tests (done) |
| No assertion of compile scope | D10 | incremental render contract enforced by code; compile logs show focused passes (done; consider a scope assertion in smoke) |
| Process-global sinks (console.warn) shared by all demo modules | D6, D12 | EventBridge-scoped diagnostics; bootstrap warnings re-emitted (done) |
| Page served statically vs by serve-demo | D5, D15 | payloads always embedded (done) |

**Proposed ongoing gate (not yet a CI check)**: add a smoke assertion that
counts full-tree compiles (`[compile] pass over <N> node(s)` without `focus=`)
and fails if any occurs after the bootstrap pass — making B-3 a regression
test rather than a review finding.

---

## Where the rules live now

- `docs/specs/render.md` — **ORD-P1** (diff must be O(N), never O(N²)):
  remove-pass uses a `Set` of next wires (no `next.some` per prev wire); the
  D5 order-signature map is built ONCE per side, never per element. A
  quadratic `diffMinimal` made a 4095-element stress render spend 900ms+ in
  diff; the O(N) form is ~10ms (90×). Pinned by `tests/unit/render.test.ts`
  ORD-P1 (4× size must cost < 8× time; quadratic measured 17×).
- `docs/skills/designing-pages.md` — authoring rules (A-1..A-8) + rendering
  rules (B-1..B-5) added: css classes are data, content+children don't
  shadow, copy must match DOM, node-ref vs presentation id, HTMLCollection
  handling, no-redundant-reappend focus guard, bootstrap-vs-incremental.
  §14.3 (demo-only helpers stay out of core docs) + §14.4 (css-stress
  lessons: guaranteed-not-hashed uniqueness, closed css serialization
  schema, def-retyped children keep own css, wireToNode registration) +
  §14.5 (data-driven assembly lessons: two-arg apply, no current-node in
  HandlerContext, pending-queue not graph scans, clone inherits layers not
  chains, flat legacy css, banner-as-gate).
- `docs/specs/fork-stress-data.md` — data-driven completion-test spec +
  implementation lessons.
- `docs/specs/render.md` — ORD-H6 (no re-append on unchanged order) added.
- `docs/specs/fork-stress.md` — layered stress-test spec (four runtime
  child-creation mechanisms cycling per layer; only core + handler code;
  per-level-property css stressor with the demo-only `levelCss` helper — NOT
  a core API).
- `docs/specs/compile-horizon-review.md` — memoized-chainRoot spec (depths
  9-12) + feasibility analysis.
- `RENDER_PROCESS_NOTES.md` §10.10 — DECIDED entries: incremental render
  (payload-focused-slice + prune), no redundant re-appends (ORD-H6 focus
  guard), fork-stress demo (idempotent after-compile handler guard;
  emitElements component-binding interpretations; per-node css stressor,
  demo-only helper), memoized root-first chainRoot.
- `demo/lib/feature-matrix-tests.js` — harness comments document the
  check-ordering + live-end-state rule (A-2), presentation-id matching (A-1),
  HTMLCollection rule (B-1), focus-op assertion (B-2).
- `scripts/demo-smoke.mjs` — `REAL_DOM_CHILDREN=1` browser-realism gate;
  per-depth fork-stress completion await.

## Validation (post-fix)

```
npm test           # 25 files, 438 tests — pass
npm run typecheck  # clean
npm run build      # clean
npm run demo:smoke # SSR 9/9, Loop-safety 7/7, Feature Matrix 12/12,
                   # Mode toggle client 12/12, ssr 14/14, markdown 13/13,
                   # Summary 8/8 — all green
```

---

## fork-stress-data session — pass-2 slice O(n²) regression (unnoticed until the browser)

### Symptom (observed)

Browser profile for the d12 values/link-only pages:

```
method=link   nodes=4095 ... load=1.0ms compile=1.0ms emit=22.0ms diff=7.0ms
              apply=56.0ms renders=2 handlers=8188 total=137289.0ms
method=values ... total=142010.0ms      (placement ≈ 6.6s)
```

Every *measured* section summed to <100ms; ~137s was unaccounted. The page's
own profiler could not explain its own total.

### Timeline — when each cause entered

1. **Latent (commit 49b8135, the bounded pass-2 "memoization update")**:
   `focusedSliceFor` = walk path + **every source/duplex-bearing node** (the
   "fallback universe"), scanned from `allNodes()` on EVERY dirty node's
   compile. The implicit design assumption — *providers are few* (a
   root-level source or two) — was never documented or enforced. Zero tests
   covered `focusedSliceFor`; the suite's only perf-shaped assertion is the
   sub-quadratic `diffMinimal` test.
2. **This session, implementation 1** (sources registered on the ROOT):
   shim totals already ~2× placement (values 12.2s / link 13.2s vs 6.6s) —
   the per-pass O(n) scan (allNodes() array build + anchor check) alone.
   Not flagged: smoke asserts correctness only; the profile prints totals
   but nothing compares them.
3. **This session, implementation 2** (legacy source attachment moved the
   providers ONTO THE PROTOTYPES): every one of the 4094 clones now carries
   a `source` anchor → the universe sweep swallows the ENTIRE tree → each of
   4094 dirty nodes compiles a ~4095-node slice → ≈16.7M `compileLocal`
   calls → ~6s in the shim, ~137s in the browser. User-reported.

### Root cause chain

- **Proximate**: the legitimate new capability (every node a self-providing
  provider, expressed as data-declared legacy sources) silently violated the
  universe's "providers are few" assumption.
- **Latent 1 (design)**: the arm-termination fallback classified providers
  through the slice-memoized `kinds` map → providers were forced INTO the
  slice → compile cost became O(providers in graph) per dirty node. The
  "plain graph query" the design promises (§10.8.2) was structurally
  impossible: `Anchor` had no owner backref, so the per-name Link could not
  enumerate provider NODES. The sweep was a workaround for a missing backref.
- **Latent 2 (measurement)**: the page profile times only the render loop
  (load/compile/emit/diff/apply). The supervisor's pass-2 pipeline
  (`runPass2AndFlush` — where the O(n²) lived) is never timed, so
  `total=137s` with all measured sections <100ms read as a contradiction,
  not a signal.
- **Latent 3 (gates)**: the validation trio asserts correctness only —
  vitest (no slice-coverage, no pass-2 cost assertion), typecheck/build
  (structural), demo:smoke (banners; exit 0 at 12–13s).
- **Latent 4 (process)**: the change was validated with the trio and the
  ~2× profile gap was reported without being flagged — no baseline
  comparison habit, no "watch the totals" checklist item.

### Why the layers each failed to notice

| Detection layer | Would have caught | Why it failed |
| --- | --- | --- |
| vitest | slice size / per-pass cost | `focusedSliceFor` had no tests |
| demo:smoke | elapsed time | asserts correctness only, exit 0 |
| page profile | where the time goes | pass-2 (the dominant cost) is unmeasured |
| agent review | the 2× total anomaly | no threshold or baseline comparison |

The browser was the first layer with any sensitivity to wall-clock time —
which is precisely the wrong place to discover an algorithmic regression.

### Fix (done)

1. `Anchor.owner` backref + per-name-Link fallback (`resolve.ts`) — the Link
   IS the provider registry; on-demand chain classification replaces the
   slice memo.
2. `focusedSliceFor` = walk path only for shared-hub trees; the universe
   sweep survives only for hub-less trees, target-gated + lazily
   materialized.
3. Pinned: `C7b` (prototype-terminated through the Link, provider outside
   the slice), phases tests (shared-hub slice = walk path only; hub-less
   sweep preserved). Post-fix: link d12 ≈ 8.7s shim, all pages 0 failed.

### Rule (regression gate for the next session)

- A per-pass cost invariant must be asserted: the pass-2 slice is
  O(walk path) + O(providers-of-path-targets) — now true by construction and
  pinned by tests; the smoke should additionally fail if a profile total
  ever exceeds a small multiple of the cycle-page baseline (or if
  `total − Σ(measured)` grows past the measured sum).
- The fork-stress-data profile should time the pass-2 pipeline too, so
  "total" can never hide an unmeasured pipeline again.

### The remaining blind spot — what the profile still does not time (current state)

The O(n²) regression is fixed, but the measurement gap the RCA identified is
still open: the page profile times only `load / compile (bootstrap) / emit /
diff / apply` and counts `handlers` (a COUNT, not a time). Everything between
"bootstrap compiled" and `total` is one unmeasured region. Current numbers
(demo:smoke, d12):

| method | Σ(measured) | total | unmeasured gap | share of total |
| --- | --- | --- | --- | --- |
| cycle | 36.5ms | 3775.0ms | 3738.5ms | 99.0% |
| placement | 41.3ms | 4727.7ms | 4686.4ms | 99.1% |
| values | 48.3ms | 5776.8ms | 5728.5ms | 99.2% |
| link | 115.6ms | 7257.0ms | 7141.4ms | 98.4% |

(Browser run, placement d12: measured 54ms of a 1504ms total — same shape.)

#### What lives inside the unmeasured region (the missing timing steps)

1. **The pass-2 pipeline** (`runPass2AndFlush` — the exact stage the O(n²)
   regression lived in): every flush's `compile(slice)` for the dirtied
   generation + `after-compile` dispatch + state/diagnostic event pushes +
   journal writes. Untimed.
2. **The 4094 `after-compile` handler BODY executions** — each body runs
   2× `clone-instance` (clone construction, anchor copy, attach,
   registration, pass-2 dirty marking) + 2× state-slice chain writes; each
   op runs `compileLocal` synchronously + journals. `handlers=4094` in the
   profile is a count, not a duration.
3. **One-cascade expansion**: the recursion does NOT consume one round per
   generation — a single `flushMicrotasks()` cascade drains ALL 12
   generations (each handler's ops re-schedule the next pass-2 via
   microtasks), so the entire runtime tree build happens inside ONE
   unmeasured flush window. `renders=2` (bootstrap + one incremental) is the
   profile's only signal of that.
4. **`takePass2States()` + `mergeStates()`** per round (store drain +
   `isInTree` filter + by-node map rebuild) — untimed.
5. **`flushMicrotasks()` timer wall** — 8× `setTimeout(0)` per round; small
   in the shim (the cascade needs only 1–2 rounds), but the nested-timer
   clamp (~4ms/level in browsers) makes this a real share of a browser
   `total`.

#### Why `total − Σ(measured)` is the metric

The gap is the pass-2 pipeline + handler + structural-op cost — exactly the
machinery the trio's correctness-only gates cannot see. A regression like the
O(n²) would hide in it again: measured sections would stay small while the
gap balloons. The AGENTS.md item-4 guard ("flag if `total − Σ(measured)`
dominates") is currently a MANUAL habit, not an asserted gate.

> **Scope note (placement-path landing — P3 §5.2/§9-Q6):** all numbers in
> this section describe the RUNTIME fork-stress-data pages (after-compile
> expansion — 4094 per-node passes), which are KEPT as-is. The STATIC
> placement-path page (`demo/path-fork-data.*`, P3 §5) re-baselines: its ONE
> path-enumeration bootstrap replaces the 4094 per-node passes, its profile
> carries a `[path-fork:profile] … states=4095 passes=1` line with
> `total − Σ(measured) ≈ 0` (the page times its own check surface), and the
> smoke records its single total as `[path-fork:baseline]` (its OWN
> placement baseline — P3 §10.ad N-5, §8 Q6 TODO to re-baseline the runtime
> guard after testing confirms no explosive time issues). The AGENTS.md
> item-4 residual watch applies to both: the runtime pages' pass-2
> dominance, and the static page's enumeration-bootstrap total.

#### Recommended instrumentation (next session)

1. **Time the pipeline**: wrap the round loop (`flushMicrotasks` +
   `takePass2States`) and the handler bodies in accumulators → report
   `pass2=…ms handlers=…ms` on the profile line (extend the existing
   `acc()` pattern; `PROFILE.handlerMs` around the body execution).
2. **Make the guard an assertion**: fail the smoke if
   `total − Σ(measured) > Σ(measured)` (or > a small multiple of the
   placement baseline) — the "Rule" from the RCA above, promoted from
   manual to automated. **LANDED (P3 §6.4, Units 11/12):** the demo-smoke
   ratio guard + residual-coverage check (`[fork-stress-data:profile]`
   method ratios ~1.5×/2.5×, `[path-fork:baseline]` + the static page's
   `unmeasured ≈ 0` residual assert) now assert both halves; the AGENTS.md
   item-4 wording re-points the watch (runtime pages = method-ratio guard;
   static page = its own placement baseline + §8-Q6 TODO).
3. **Reduce the timer wall**: replace the 8×`setTimeout(0)` flush with a
   microtask-only drain where the pipeline's own scheduling permits.

### Imperative fork-stress — why it is slower than the data variants (in a real browser)

Observed (browser): `[fork-stress:profile] depth=12 … compile=188.0ms emit=49.0ms
diff=24.0ms apply=33.0ms renders=10 handlers=137 total=5656.0ms` while the
data-driven placement page totals ~1.5s on the same machine. Measured
sections sum to 294ms — the same 95%-unmeasured gap, with a DIFFERENT
dominant cause than the data pages:

1. **10 full-tree renders vs 2.** The imperative page renders after EVERY
   layer (`render()` per level, `renders=10`) and `diffMinimal` re-asserts
   every child's position on each render (D9 semantics: append-child move
   → detach+reinsert in a real DOM). ≈10 renders × up-to-4095 re-inserts ≈
   40k real DOM mutations + layout/style churn. The data page renders twice
   (bootstrap + one post-cascade). **The shim cannot see this**: its
   `appendChild` is an array splice (~O(1)), which is why the shim ordering
   is the REVERSE (data pages 4.3–7.1s pass-2 vs imperative 1.8s) — the
   shim's dominant cost is the data page's single giant pass-2 cascade,
   while the browser's dominant cost is the imperative page's DOM churn.
2. **8 whole-tree focused recompiles.** `recompileFocusedFor(rootNode)`
   after every layer compiles the root's focused slice = the ENTIRE tree at
   that level (8× ≈ O(n·levels) compile work; this IS measured —
   `compile=188ms` is bootstrap + those 8 recompiles, vs the data page's
   `compile=0.1ms`). The data page compiles only each generation's dirty
   slice (Σ O(n)).
3. **Flush windows + timers.** 8 per-level `flushMicrotasks()` rounds (8×
   `setTimeout(0)` each; browser nested-timer clamp ~4ms) — hundreds of ms,
   untimed, inside the 5.3s gap.
4. **Page-side layer construction** (per-node `addChild`/`addAnchor`/
   `linkFor` loops, direct graph mutation) — untimed page code.

**The honest cross-environment metric**: wall totals are not comparable
between the shim and a browser for DOM-heavy pages. The comparable signals
are `pass2Ms` (compile-side, already added to the data page) and the
**append-op count per render** (diffMinimal ops) — the DOM-churn proxy the
shim can measure. The imperative page's profile line needs the same
`pass2`/`covered` instrumentation to stop hiding its own gap.

---

# RCA — B1 children-target collapse miscommunication + the deliverable-spec chain clobber (2026-08-14)

Session: live-prod legacy-shape fix pass (D1-D8 + SED delivery shapes). Two
interlocked defects: (1) the SED-2 "children-target keeps the wrapper shell"
contract silently narrowed to EMPTY hosts (the wrapper's own children/text
were dropped and the wrapper collapsed into the def element whenever it had
authored children) — survived every prior clarification; (2) the underlying
emit-time def-chain re-typed a host's REAL children whenever the def's
children count happened to fit (`>=`), regardless of whether the def was a
re-typing spec or a deliverable subtree. Both FIXED (2026-08-14, tests
761+1, typecheck, smoke green).

## Timeline (evidence trail)

| Step | Artifact | What it said / did | Gap introduced |
| --- | --- | --- | --- |
| 1 | FINDINGS D5 correction (my write-up) | "wrapper div persists as a SHELL and the def subtree (def's type + cssDef + children + nested bindings) is layered INTO it as content" | "as-is" property of the wrapper's OWN children/text never stated — the live wrappers were bare, so the question never arose |
| 2 | D7 disposition (user) | "pass the links to the prototype's children and placement links as an anchor layer, without affecting the node's own parent" | anchors described; emission interaction with authored children unpinned |
| 3 | Delivery-shape ruling (user) | "collapse = type-target; children-target stays a distinct element that contains the referred node(s)" | framed as a shape binary; the authored-children state not in the frame |
| 4 | SpecDoc SED-2 / SED-H1 | "consumer emits its OWN element (wrapper shell, authored type/css) containing the DEF-ROOT element" | "authored type/css" — content and children never mentioned; the FAIL row pins only the wrapper-survival |
| 5 | Implementer SED-2 branch | nested INSIDE the pre-existing `if (allowed && childWires.length === 0)` def-fill block; comment: "the shell's own text is dropped — the def-root is the content carrier" | the empty-host gate inherited from the fork-stress P-EMIT-3 def-fill; the text-drop was an implementer invention (fork-stress hosts are leaves); the seam's "adds a child" semantics were conflated with the def-fill's "fills an empty host" semantics |
| 6 | TestWriter SED envelope | wrappers A/B bare (no authored children/text) | the empty-host state was the ONLY tested state; the state enumeration mirrored the spec's example instead of the state space |
| 7 | Reviewer round 2, F23 | "is length-equality the only gate, or must the def also originate from the link method (not a seam-target def)? A values-method def with 1:1 children on a node that ALSO carries a seam binding would double-materialize" | ASKED the right discrimination question — but the answer scoped provenance to the seam FLAG on the emitting node's anchors (isSeamDefBinding) |
| 8 | Implementer linkChainAllowed | `linkMethod(bind-specs) → 1:1`; **deliverable (non-bind) → `def.children.length >= childWires.length`** | the `>=` for deliverable defs generalized the blind emit-layer pin (TYPE-ONLY re-typing specs, 2-vs-1) to FULL deliverable defs — the defect's entry point |
| 9 | Live acceptance | navBar def 3 children vs root 5 → `3 >= 5` false → blocked BY COUNT LUCK; wrappers bare → SED-2 empty-host shape matched | both latent defects invisible to the strongest available signal |
| 10 | B1 probe (children-target + authored p, 1-vs-1) | counts fit → the `>=` chain fired → root's own source binding re-typed its child → wrapper collapsed | DISCOVERED here, via the edge probe |

## RCA — why the miscommunication survived

1. **Two mechanisms conflated.** The seam (graph-time anchor layer: adds a
   child) and the def-fill (emit-time P-EMIT-3: fills an EMPTY host) are
   different contracts; the implementer nested SED-2 inside the def-fill
   branch, silently inheriting the empty-host gate. The spec pinned the
   SHAPE (shell + def-root) but never the interaction with the shell's own
   content — "leaves the original node data as-is" was stated only by the
   user AFTER the fact (B1 clarification), because every earlier statement
   was about anchors (graph) or shape (empty case).
2. **Example-driven test enumeration.** The TestWriter's SED envelope
   mirrored the spec's/live page's examples (bare wrappers) — the authored-
   children state was never enumerated. The 69-test suite exercised one
   state of a two-state contract.
3. **The reviewer asked the right question, scoped to the wrong surface.**
   F23's "must the def originate from the link method" was answered with the
   seam flag on the CONSUMER's anchor — but the clobber fires on the HOST's
   OWN source binding (seedOwnBindings publishes the host's own def values;
   findDefBinding picks the FIRST def-valued binding — the host's own). The
   provenance check keyed on the wrong side of the binding.
4. **The acceptance signal was count-luck-blind.** The live envelope's
   counts (3 def children vs 5 root children) blocked the chain by the `>=`
   rule — the page rendered correctly and every pipeline gate passed while
   the defect was live.

## RCA — where the clobber defect got in

1. **Origin: the blind emit-layer C2 pin** (def-retyping semantics: "the def
   re-types the def-carrying consumer's children" — prototype-as-child
   reading, legitimate for the fork-stress link method).
2. **Entry: the `>=` generalization.** D8's gate (count equality) was
   extended to "deliverable defs chain when they COVER the real children" to
   keep the blind pin green — the spec-kind dimension (re-typing spec vs
   deliverable subtree) was never part of the gate. The F23 review named the
   dimension but the fix keyed it to the seam flag only.
3. **Masking: live acceptance by count luck** (step 9 above) — the page that
   would have exposed it never triggered the branch.
4. **Fix:** linkChainAllowed now discriminates RE-TYPING-SPEC defs
   (bind-keyed or type-only children) from DELIVERABLE-spec defs (children
   carrying content/css/props/children/component) — deliverable defs NEVER
   chain; their subtree materializes via the seam. Plus SED-2 now fires for
   ALL children-targets (not just empty hosts), keeping the shell's authored
   text/children and appending the def-root.

## Rules produced (for the fix-pass docs and future sessions)

- **R1 — Seam ≠ def-fill.** A seam children-target NEVER collapses and NEVER
  drops the host's authored content: it is "original node data as-is +
  prototype node added as a child". The emit-time def-fill (empty-host) is a
  separate mechanism for the fork-stress/link-method pattern.
- **R2 — The def-chain gate discriminates SPEC KIND, not just count.** A
  chain may only re-type real children with RE-TYPING specs (bind-keyed or
  type-only); a deliverable-spec def (any child carrying
  content/css/props/children/component) never drives a chain — count-fit is
  never sufficient.
- **R3 — Provenance checks must cover the HOST's OWN bindings.** A gate
  scoped to the consumer's seam flag misses the host's own source-binding
  path (seedOwnBindings → findDefBinding first-wins). Discrimination
  questions must be answered over the full binding surface, not the anchor
  surface.
- **R4 — Enumerate the full state space in tests, not the examples.** When a
  contract has an unstated dimension (e.g. the wrapper's own children),
  enumerate BOTH states (empty + populated) in the state list before
  writing tests — example-shaped envelopes hide half the contract.
- **R5 — Acceptance green ≠ contract green when a gate is count-dependent.**
  A page that only passes because the numbers don't fit is a masked defect,
  not a validation — count-sensitive gates need a count-fitting probe.
