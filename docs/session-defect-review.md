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
