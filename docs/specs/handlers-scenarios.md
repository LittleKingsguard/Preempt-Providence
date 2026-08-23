# Handler Use-Case Scenarios — blind-test #5 demo spec (2026-08-16)

Status: SPEC for the blind-test #5 demo page (`handlers-scenarios.html`).
Purpose: exercise the LANDED legacy-handler surface with MOCKED real-world
use cases. The page input is a LEGACY envelope (function-STRING handler
bodies, translate.md §2); the page module uses ONLY `dist/core/*` + data.
A use case that needs an outside script/function is a data-authoring
mistake — re-express in data or drop the claim (blind-test rule, test-
findings §"Blind test #1").

Authoring constraints (designing-pages §14):
- bodies are `(event, context) => …` legacy strings (the seam default); the
  arg order + event stub + legacy context come from the wrapper
  (handlers.md §6: `context.node` NodeView, `context.supervisor.userData`
  read-only, `context.clientAPI.apply(id, op)` state-slice/destroy,
  `context.tree.*`, event stub `{type, preventDefault, stopPropagation,
  target, isTrusted}` + `value = args[0]` when the dispatch carried an arg).
- NO timers, NO real fetch/network, NO window/session APIs in bodies —
  mocked data lives IN the body string. Dispatch is synchronous.
- Throw in a body = contained error in the dispatch results (never a page
  crash) — the throwing-handler scenario exploits this on purpose.
- Honest QueryUtils keys: `type`/`id`/`classes`/`props` (exact-eq) +
  predicate functions; any other key warns `legacy-query-unsupported`
  (once per dispatch) and matches NOTHING (handlers.md §6, B6).
- `receiveNextState({children})` → ONE layer-apply (deterministic
  `legacy-kids-<nodeId>` layerId); re-injection idempotent (OO-2 no-op);
  the mint is ONE LEVEL (a payload entry's NESTED children and `anchors`
  are dropped — anchors warn `layer-apply-anchors-rejected` + are stripped,
  nested children are silently dropped — payloads must be leaf-shaped);
  `{children: []}` is NOT a teardown (idempotent no-op on a layer-bearing
  node; an EMPTY layer that blocks later mints on a layer-less node); the
  teardown (removeLayer) is engine-side only — no body op kind invokes it,
  so a Clear-style flow destroys each minted child via
  `clientAPI.apply(id, {kind: 'destroy'})`; state keys → ONE state-slice
  (ops.md §2.8 OO-7).
- `handlers.afterAssembly` = the N5 carve-out → the `after-compile` PHASE
  (AUTH-SEAM): a def's phase handler copies to the type-target consumer
  (never runs on the prototype); nested (def-in-def) consumers install the
  same way (materialize runs for seam-bearers regardless of viability).
  The page harness mirrors the supervisor: compile → recordResolved →
  dispatch after-compile on every node whose handlers carry the phase →
  recompile → emit (the render-new.mjs harness pattern).
- Destroy of a runtime-minted adopted def child is retention (walk slot
  kept, `destroyed` flag set — the node keeps no states and is not
  actionable) — supervisor.ts; the emitted element set PRUNES the destroyed
  def child (DEFECT #20 FIXED 2026-08-16 — `defChildPruned` at every
  def-fill site + the blocked-def/nodeById reTyped path; tests N4/N5), so
  the destroyed child's element no longer renders. The GRAPH retention half
  (flag + slot) is the assertion surface — never claim the element either
  way without N4/N5.
- Event bindings (`handlers.click`, `handlers.load`, `handlers.input`,
  `handlers.submit`) fire ONLY when the harness dispatches them (page-load
  dispatches `load`; UI interactions dispatch the rest).
- **Def-child bindings are inert + def grandchildren (pinned standing
  surprises, handlers.md §6):** a `handlers.<event>` binding authored on a
  def CHILD never materializes/dispatches (planned-but-inert — the def
  child prototype never compiles); an adopted def child's OWN children
  render only while it is in-tree + actionable. Author event bindings on
  in-tree nodes only; express def children as leaf/text data (the S1
  dropdown carries its menu text directly; the logout control is an
  AUTHORED header button).
- Multi-handler nodes: layer handlers append-with-override per (name,
  event) — authored base + seam layer both dispatch (D16).

---

## Scenario 1 — Auth dropdown: login/profile button + logout (the corpus pattern)

Framing: the site header's user chip. NOT signed in → the chip is a
"Sign In" LINK (`/api/oauth/login`); signed in → "Profile ▼" button + the
dropdown survives. Logout destroys the session panel.

Envelope: def `userAuth` (css classes `user-auth-dropdown`; children:
`auth-main-btn` button, `dropdown-menu` div — a LEAF carrying its menu
text; def-child bindings are inert (handlers.md §6) so `ToggleDropdown`
and the dropdown's logout button are DROPPED from the data) whose
`component` array carries `{target: 'handlers.afterAssembly', reference:
'AuthInit'}`; defs `AuthInit` (the corpus-style body: reads
`context.supervisor.userData`; children[0] converted via
`receiveNextState({type, content, props})` / `{content: 'Profile ▼'}`;
else-branch destroys children[1] via `context.clientAPI.apply(id,
{kind: 'destroy'})`), `Logout` (`handlers.click` on an AUTHORED header
button → walk to the chip by its OWN authored class (`chip-slot` — the
def's classes are not findable on the consumer, render.md SED-1 read-side
pin) → destroy the dropdown menu + reset the chip content to "Sign In /
Profile"). The chip is found by the authored class; the def's
`user-auth-dropdown` class stays on the out-of-tree def-root prototype.

Intended output:
- without userData: chip = `<a …>Sign In</a>` href `/api/oauth/login`;
  the dropdown is `destroyed` but keeps its slot (retention) — the RETENTION
  half is the assertion surface (destroyed flag + walk slot + page alive);
  the destroyed def child's ELEMENT is pruned from the emitted set
  (DEFECT #20 FIXED 2026-08-16, tests N4/N5). REQ-GAP-11 (2026-08-22):
  destroyed nodes leave `allNodes()` (the self-evicting sweep) — the checks
  locate the destroyed dropdown via the chip's FAMILY WALK (its `children`)
  and assert `getNode(id)` resolution via the destroyed-ref tombstone.
- with userData `{username}`: chip = `Profile ▼` button; dropdown alive.
- dispatching click on the authored logout button destroys the dropdown menu
  (retention) — page still renders.

Surface: AUTH-SEAM phase copy, def-children adoption, NodeView children,
receiveNextState state-slice, clientAPI destroy (retention), userData
passthrough, event binding + dispatch.

## Scenario 2 — Server content load: comments panel (mocked fetch)

Framing: an article's comments container. On page load the panel loads
"from the server" (mocked payload inside the body); a Refresh button
re-fetches (idempotent re-injection); a Clear button tears the injected
children down.

Envelope: div `comments-panel` binding `{target: 'handlers.load',
reference: 'LoadComments'}` + a `handlers.click` Refresh + a
`handlers.click` Clear on small buttons. `LoadComments` body: builds an
ARRAY of NodeData (`{type: 'div', css: {classes: ['comment']}, props,
content}` — a few entries, LEAF-shaped — the mint is one level) and calls
`node.receiveNextState({children: […]})`. Refresh: same body again
(idempotent — re-injection is an OO-2 no-op). Clear: destroys each minted
comment via `clientAPI.apply(id, {kind: 'destroy'})` (retention — the
stack keeps its slot; `receiveNextState({children: []})` is NOT a
teardown, handlers.md §6).

Intended output: after load dispatch the panel's children are the comment
elements (in-tree, order preserved); a second load does NOT duplicate
(re-injection no-op — OO-2); clear destroys the minted comments (destroyed
flag + walk slot kept, panel alive).

Surface: children injection via the layer-apply op, idempotent
re-injection, teardown, `handlers.load` harness dispatch, event args.

## Scenario 3 — Third-party widget: weather card (mocked API)

Framing: a dashboard weather widget. "Load weather" click → the body
simulates the vendor API response (deterministic mock in the body, keyed
off the event's `value` arg — e.g. the city name) → writes the card's
content + a temperature prop + a css class (e.g. `is-cold` / `is-warm`).

Envelope: div `weather-card` with a `weather-btn` button binding
`handlers.click` → `WeatherHandler`. The button carries the city in a
data prop; the harness dispatches `click` WITH the city as the event arg
(`dispatchEvent(node, ctx, 'click', 'Berlin')` — `event.value` = 'Berlin').

Intended output: after dispatch, the card's content shows the mocked
report ("Berlin 12°C"), props carry `temperature`, css classes include
the cold/warm marker.

Surface: event args (`event.value`), state-slice content/props/css
writes, NodeView css read (the body reads the card's current css to pick
the branch), contained conditional logic in the body.

## Scenario 4 — Cart badge: add-to-cart counter

Framing: product cards; each "Add" click increments the header's cart
badge (a sibling found via the honest query surface).

Envelope: a `cart-badge` span (content '0') in the header; product
buttons binding `handlers.click` → `AddToCart`. Body: finds the badge
with `context.tree.descendantsOf`… — hmm — use the honest vocabulary:
`node.findNode({ classes: ['cart-badge'] })`? — findNode is on the
NodeView (its subtree). If the badge is NOT under the button, the body
walks up via `node.parent` and finds from there (`container.findNode`).
The corpus ToggleUserDropdown's parent-walk pattern is the reference
(while-walk to the `user-auth-dropdown` class). Body: read
`badge.content` ('0'), `Number()` + 1, write back via
`badge.receiveNextState({content: String(n)})`.

Intended output: N clicks on the product button → badge content 'N'
(independent of which product button; both buttons hit the same badge).

Surface: parent walk, findNode + honest classes query, content read
(parse) + state-slice write, multiple consumers of one handler def.

## Scenario 5 — Search filter: input-driven list (mocked dataset)

Framing: a search box over a small dataset. Each input dispatch filters
the list; the results re-inject as the list's children.

Envelope: `search-box` input binding `handlers.input` → `FilterList`; a
`results-list` div. The DATASET lives in the body string (an array of
titles — data-in-body is the mocked-server stand-in). Body: `const q =
String(event.value ?? '').toLowerCase()`; build the filtered NodeData
array; `results.receiveNextState({children: filtered})`.

Intended output: the FIRST dispatch injects the filtered set (leaf-shaped
entries); re-dispatch with the same layerId is an OO-2 NO-OP — it never
accumulates, and "re-dispatch replaces" / "'' restores all items" are NOT
expressible (re-injection is idempotent, `{children: []}` applies an empty
layer that blocks later mints — handlers.md §6). The checks cover "meta →
2 items (both containing 'meta')" + "re-dispatch never accumulates".

Surface: input event + `event.value`, per-dispatch children injection
(replace semantics), body-local data, lowercasing/filter logic in data.

## Scenario 6 — Tabs: active-state css toggling across the tree

Framing: a tab bar + panels. Clicking a tab sets `is-active` classes on
the tab and the matching panel, clears the others.

Envelope: `tabs` container with N tab buttons + N `tab-panel` divs; every
tab binds `handlers.click` → `SelectTab`. Body: `event.target` is the
clicked tab's NodeView (the stub's `target` member) — read
`event.target.css.classes` to find the tab index; walk `node.parent`
(the tabs container), `container.findNode({classes: ['tab-panel']})`… —
better: each panel's class includes its id (`tab-panel-a` etc.); the body
computes the target panel class from the tab's own class (`tab-a` →
`tab-panel-a`) and queries it: clear `is-active` on the sibling tabs via
`container.children` + `receiveNextState({css: {classes: [...]}})`,
set it on the chosen one.

Intended output: clicking tab-b → `tab-b` + `tab-panel-b` carry
`is-active`; `tab-a`/`tab-panel-a` lost it.

Surface: event stub `target`, css class read/write via state-slice,
family children iteration, sibling mutation, honest queries.

## Scenario 7 — Form submit: validation + status message (mocked)

Framing: a newsletter form. Submit → the stub's `preventDefault()` is
called; the field value arrives as the event arg; an empty value → error
message + `input-error` css on the field; a non-empty value → success
message + the form content resets.

Envelope: `newsletter-form` binding `handlers.submit` → `SubmitNews`;
inside: the `newsletter-input` field + a `form-status` div. Body:
`event.preventDefault()`; `const v = String(event.value ?? '').trim()`;
branch on emptiness; `status.receiveNextState({content: …})` + the field's
css toggled via `field.receiveNextState({css: {classes: […]}})`. `event.target`
= the form view (findNode({classes: ['newsletter-input']})).

Intended output: submit with '' → status 'Please enter an email', field
has `input-error`; submit with 'a@b.co' → status 'Subscribed!', field
lost `input-error`.

Surface: preventDefault, args, conditional writes, two targets in one
body (findNode + writes on both).

## Scenario 8 — Throwing-handler containment + fallback

Framing: a third-party widget whose handler throws (a mocked API failure
inside the body: `throw new Error('vendor down')`). The dispatch result
carries the error; the page still renders; the widget's own guard body
writes a fallback message first, THEN throws (so the fallback lands and
the error is observable in the results).

Envelope: `broken-widget` binding `handlers.load` → `VendorWidget` (body:
set `node.receiveNextState({content: 'vendor unavailable'})` then
`throw new Error('vendor-down')`).

Intended output: after the load dispatch, the widget's content = 'vendor
unavailable' (the pre-throw write LANDED), the dispatch result is an
Error (contained — no page crash, the harness records it), the rest of
the page renders normally.

Surface: error containment in dispatch, pre-throw mutations persist,
harness-level error surfacing.

## Scenario 9 — Toast: injected child with its own dismiss binding

Framing: "Show toast" → a toast is injected into the toast stack; the
toast's dismiss button carries `{target: 'handlers.click', reference:
'DismissToast'}`; clicking it destroys the toast.

Envelope: `toast-stack` div + a `toast-trigger` button (`handlers.click`
→ `ShowToast`) + an AUTHORED dismiss button beside the stack. `ShowToast`
body: `node.receiveNextState({children: [{type: 'div', css: {classes:
['toast']}, content: '…'}]})` on the STACK (findNode from the button's
parent) — the minted payload is a LEAF: the layer-apply mint DROPS a
payload entry's NESTED children AND its `anchors` (the dismiss binding
canNOT ride the injected toast — ops.md §2.8 OO-7; the spec's rule: never
engine code, re-express in data — the DISMISS binding moves to the
authored button). `DismissToast` body: find the minted toast in the stack
and destroy it (`clientAPI.apply(id, {kind: 'destroy'})` — a PLAIN destroy,
NOT the runtimeMinted retention class: the layer-apply mint marks
`originLayer`, never `runtimeMinted`, so the destroy dissolves the family
edge and the toast leaves the stack's children; the STACK keeps its slot in
its own parent — the check captures the toast node BEFORE the dismiss and
asserts `destroyed` + `getNode` resolution after (REQ-GAP-11: destroyed
nodes leave `allNodes()`; the destroyed-ref tombstone keeps stale refs
resolving).

Intended output: show → one `.toast` in the stack; dismiss → the toast is
destroyed (plain destroy — the minted toast was never runtimeMinted), the
stack keeps its slot.

Surface: nested component bindings on injected children, destroy via
parent walk, layer-apply mint semantics.

## Scenario 10 — Multi-handler node: load + click on ONE node

Framing: a panel that loads its content on page load AND has a
refresh-style click handler on the same node — both bindings dispatch,
neither kills the other (the D16 append-with-override merge).

Envelope: a div binding BOTH `{target: 'handlers.load', reference:
'LoadPanel'}` AND `{target: 'handlers.click', reference:
'TouchPanel'}`. LoadPanel writes `content: 'loaded'`; TouchPanel writes
`css: {classes: ['touched']}`.

Intended output: after load dispatch → content 'loaded'; after click
dispatch on the same node → the node still has the load handler's entry
AND now the touched class — both handlers present in `node.handlers`
(phase/event entries coexist), both effects visible.

Surface: append-with-override merge, multiple bindings on one node,
event + content writes on the same node.

---

## Page shape (blind-test #5 artifact)

- `demo/handlers-scenarios.html` + `.js` (+ `.template.html` if the
  builder pattern is followed — see scripts/*-page.mjs for the build
  convention): a card per scenario, each card self-contained; the module
  is CORE ONLY (`dist/core/*`) + the envelope data; scenario 1 renders
  TWICE (no-userData / userData variants). Banner: `handlers-scenarios`.
- The module: translateLegacy → Supervisor + EventBridge → register →
  compile → recordResolved → after-compile dispatch (phase-bound nodes) →
  recompile → emitElements/diffMinimal/applyOps (DomAdapter) → render →
  per-scenario runner checks (the demo-smoke `runner` pattern) that
  dispatch the scenario events with args and assert the INTENDED OUTPUTS
  above. The page embeds a `[handlers-scenarios:profile]`-style profile
  line mirroring the other pages' `acc()` instrumentation.
- Wired into `scripts/build-demo.mjs` (new page) + `scripts/demo-smoke.mjs`
  (banner + checks), listed in designing-pages.md §12.
- Any intended output that cannot be expressed with the documented
  surface above is a DATA-AUTHORING mistake: re-express or drop the
  scenario (recorded in the blind-test report).
