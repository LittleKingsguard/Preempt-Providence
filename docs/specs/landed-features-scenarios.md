# Landed-Features Scenarios — css.classes seam + retained-handler-map + engine event dispatch (2026-08-20)

Status: SPEC defining the scenario tests for the three features landed
2026-08-20 — **CSS-CLASSES** (`translate.md` §2.1 register, decisions.md
CSS-CLASSES), **RETAINED-HANDLER-MAP** (adapters.md §3.2/§3.7, decisions.md
RETAINED-HANDLER-MAP), **EVENT-DISPATCH-WIRING Phase A**
(`Supervisor.dispatchEvent`, handlers.md §3, decisions.md
EVENT-DISPATCH-WIRING). The page input is LEGACY JSON envelopes
(function-STRING handler bodies) + CORE-ONLY page modules; a use case that
needs an outside script/function is a data-authoring mistake — re-express in
data or drop the claim (blind-test rule, test-findings §"Blind test #1").

Execution note: the unit/integration suites pin the MECHANICS (translate
K8/DV-C1/N1; adapters DOM-F5-flip + F6..F12; phases.test.ts "Supervisor
event dispatch"); these scenarios pin the USER-VISIBLE behavior across the
whole pipeline (translate → supervisor → render → interaction). The
scenario execution (page build + harness + proofreader + page review) runs
the blind-test/stress loop (AGENTS item 10/11) AFTER this document is
signed off.

**EXECUTION STATUS (2026-08-20): EXECUTED + DEFECT #27 FIXED** — the combined
scenario/blind-test loop ran (blind writer → proofreader/page-reviewer); the
page (`demo/session-features.html`, §12) is built, wired, and green
(`session-features: 28 passed`). The blind test exposed that Scenario 2.1's
self-removal (a `handlers` state-slice `replace []`) could NOT clear
seam-installed handlers — that became **DEFECT #27**, FIXED 2026-08-20: an
empty-array `handlers` write now CLEARS durably (merge reset + seam
suppression; handlers.md §4, defects.md DEFECT #27). The FULL S2.1 intended
output (first click writes content + clears handlers, diff emits
`set('on:click', undefined)`, listener detaches, second click inert) is now
asserted; the Group-2 NOTE's "only detach-on-removal and removeEl cleanup are
pipeline-reachable" is SUPERSEDED for the self-removal half by the fix.
Other findings: Scenario 2.2's envelope was re-expressed (the `destroy` op
dissolves the shared family link, so the destroyed node must be the sole
child of its container for the survivor to keep rendering); Scenario 3.2's
fork needs EQUAL-DEPTH providers (nearest-shadows-far collapses nested
providers to one arm). Full record:
`archive/findings/2026-08-20/2026-08-20-session-features-blind-test.md` +
`archive/analysis/2026-08-20/2026-08-20-session-features-rca.md`.

## Authoring constraints carried from the three decisions

- **css.classes is the ONLY css-family injection seam** (`target:
  'css.classes'`): flat form only, `applyPath: 'css.classes'` + synthesized
  `derived.css.classes = { $: 'bindings.<ref>' }`; the compiled bake APPENDS
  host-then-injected (a scalar coerces to one class; an array appends in
  order; a missing/null source keeps the authored list — never wipes).
  BLOCKED (`component-target-skipped`, warn + skip, never throw): `css`
  (whole dict), `css.id`, `css.style` + `css.style.<prop>`; bare `handlers`
  / `component` are not legacy targets (generic not-known gap warn); the
  configured `component-target-gap`/warnings ride the K4 additive channel.
  Reverse (N1): the synthesized `css.classes` key strips and
  `target: 'css.classes'` re-emits — the seeded doc round-trips warning-free
  with the authored class intact.
- **Retained-handler-map (`on:<event>` lifecycle):** attach = REPLACE (one
  listener per `(wireKey, event-name)` slot); `undefined` = real detach
  (`removeEventListener` of the exact fn); `removeEl` + duplicate-`createEl`
  purge the slot (the orphaned, still-mounted element stops firing). DOM/F12
  rule: the SSR inline `onclick="true"` attr is inert; a scenario asserts
  listener behavior ONLY via the DOM shim's listener state (dry-dispatch),
  never by pretending a native listener exists. The same-`event`-name BODY
  swap is invisible to `diffMinimal` (constant-`true` `on:` values) — a
  scenario MUST NOT assert differential dispatch for a same-name swap.
- **`Supervisor.dispatchEvent(target, event, ...args): HandlerResult[]`**
  (Phase A engine entry): target = Node / nodeId / wire string; wire
  resolution = full-string first, then first-`#` prefix (fork-arm
  `<nodeId>#<i>`). A fork-arm wire dispatches the NODE once, all arms in
  `ctx.states`. unknown/destroyed/unplaced → `[]` (no throw). Pins: it is a
  TRIGGER, never a journal entry; it never drains pass-2 states / never
  flushes applies / never emits EventBridge events — after a READ-ONLY
  dispatch no re-render happens (an apply is what re-renders); NO
  propagation (target handlers only); same-(node,event) reentrancy no-ops,
  a different event is not blocked; `event.value = args[0]` (the legacy
  stub), `event.type = event`. `ClientAPI` stays the 2-method surface and
  `DomAdapter.onEvent` stays an independent page-side path.

---

## Group 1 — css.classes injection seam

### Scenario 1.1 — provider-colored badge (scalar append)

Framing: a badge whose accent class comes from a component source (a theme
value) rather than authored CSS.

Envelope: host `div.badge` with authored `css: {classes: ['badge']}` and
`component: [{ reference: 'tone', target: 'css.classes' }]`; a provider
node `tone-src` (`component-source`, value `'is-primary'`) satisfying the
reference from root.

Intended output: the emitted element's class attribute = `badge is-primary`
(host class first, injected appended — `applyDerived` append order); the
host's authored class is never lost; translate emits NO gap warning for the
seam target.

Surface: css.classes seam planning + derived bake, append host-then-
injected, scalar → one class, source→target resolution.

### Scenario 1.2 — array-form multi-class injection (in order)

Framing: the SAME badge with a provider delivering an ordered class list.

Envelope: as Scenario 1.1 but the `tone` source value is `['is-primary',
'is-large']`.

Intended output: class attribute = `badge is-primary is-large` (array order
preserved, host-first).

Surface: array-form parity with `props.<key>` (translate.md §2.1 — the
`css.classes` register row), ordered append.

### Scenario 1.3 — missing/unresolved source keeps the authored list

Framing: a `css.classes` binding whose source does not exist anywhere on
the walk from self to root.

Envelope: host `div.badge` with authored `[ 'badge' ]` and
`component: [{ reference: 'missing-tone', target: 'css.classes' }]` — no
provider for `missing-tone`.

Intended output: the element still renders with class `badge` ONLY (the
missing-source carve-out keeps the authored list; nothing is wiped or
blanked); the unresolved-reference compile status is the documented
fail-state (the node still renders its own state, `unresolved-reference`
warning logged — api.md §4.3); no thrown error anywhere.

Surface: missing-source carve-out (mirror of the `props.<key>` missing
case), keep-authored-not-wipe.

### Scenario 1.4 — blocked css targets warn + skip, never throw

Framing: an envelope that tries to inject a whole css dict / an id / an
inline style via a component target — the disposition register says these
are BLOCKED.

Envelope: a button carrying FOUR bindings:
`[{reference: 'c', target: 'css'}, {reference: 'idSrc', target: 'css.id'},
{reference: 's', target: 'css.style'}, {reference: 'sp',
target: 'css.style.color'}]` (providers present so the ONLY reason not to
land them is the disposition).

Intended output: translate emits `component-target-skipped` for exactly
those four targets (K4 channel — assert the warn count and codes); the
element renders with its OWN authored css (type/classes/style untouched); no
`component-target-gap` confusing the register (they are BLOCKED, not
not-known); the page never throws at translate or emit.

Surface: CSS_BLOCKED_TARGETS disposition, warn+skip never throw, K4
diagnostics visibility.

### Scenario 1.5 — reverse round-trip: `target: 'css.classes'` persists warning-free

Framing: a seeded doc that already used the css.classes seam survives a
save/load cycle.

Envelope: Scenario 1.1's envelope re-expressed AFTER reverse: run
translate → `nodeToLegacy` → translate again. The reversed doc carries the
seam as `component: [{reference: 'tone', target: 'css.classes'}]` with the
synthesized `derived.css.classes` stripped (N1); the authored `badge` class
survives.

Intended output: re-translate is warning-free (no new gap warn, no
double-emit); the reversed doc's class plan is identical to the authored
envelope's; the element still renders `badge is-primary`.

Surface: N1 reverse strip + `target:` re-emit, warning-free round-trip, the
K5-style reverse contract.

## Group 2 — retained-handler-map listener lifecycle (pipeline-reachable halves only)

NOTE: **DEFECT #27 FIXED 2026-08-20** — a `handlers` state-slice `value: []`
now CLEARS the compiled handlers durably (merge reset + seam suppression,
handlers.md §4), so the self-removal half (2.1) IS pipeline-reachable and its
full intended output is asserted. The earlier "only detach-on-removal and
removeEl cleanup are pipeline-reachable" framing is SUPERSEDED for 2.1.
Replace/dedupe still only bites on a raw duplicate `setProp` (never emitted by
a correct pipeline — D3). The same-`event`-name body swap remains the
documented invisible residual and is NOT asserted here.

### Scenario 2.1 — a handler that removes its own binding really detaches

Framing: a dismiss-style one-shot control: the click handler removes itself
after the first click, so a second click does nothing (the `handlers`
state-slice path, handlers.md §4).

Envelope: a button binding `{target: 'handlers.click', reference:
'OneShot'}`. `OneShot` body: writes content `'clicked'` AND replaces its
own compiled handlers with `[]` via
`clientAPI.apply(selfId, {kind: 'state-slice', mutation: [{targetProp:
'handlers', mode: 'replace', value: []}]})`.

Intended output (after the engine/harness dispatches `click` on the
button): render 1 shows content `'clicked'` and the button's compiled
handlers are cleared; the re-render's `diffMinimal` emits
`set('on:click', undefined)` (the prop left the set); via the retained map
the listener is REMOVED — a second `click` dispatch (engine or dry-dispatch)
yields NO handler run and the DOM shim's `listeners['click']` slot for that
element is empty; the button still renders (content preserved).

Surface: handlers state-slice, diff-driven `on:` removal, retained-map
detach (DOM-F6 behavior through the full pipeline), no-propagation of stale
listeners.

### Scenario 2.2 — element removal purges the retained listener

Framing: a control that is removed from the tree (managed destroy) must not
leave a live listener behind.

Envelope: a `remove-me` button binding `{target: 'handlers.click',
reference: 'Gone'}` beside a `remove` button whose click handler destroys
`remove-me` via `clientAPI.apply(removeMeId, {kind: 'destroy'})`.

Intended output: after the destroy, `remove-me`'s element is removed
(`removeEl` → retained-map purge before `el.remove()`, DOM-F7); the removed
element's shim listener slot is empty (dry-dispatch fires nothing); the page
stays alive and re-renders without the control.

Surface: destroy → removeEl purge, orphaned-listener cleanup, retention
(graph slot kept), DOM-F7 through the pipeline.

## Group 3 — `Supervisor.dispatchEvent` engine entry

### Scenario 3.1 — drive a data-authored control through the ENGINE entry (not onEvent)

Framing: the canonical interaction, but the harness drives it via
`supervisor.dispatchEvent` instead of a hand-rolled resolver + onEvent
channel — the Phase A seam.

Envelope: a button binding `{target: 'handlers.click', reference: 'SayHi'}`;
`SayHi` body writes `content: event.value + '!'` via
`receiveNextState`/state-slice (`event.value = args[0]`).

Intended output: `supervisor.dispatchEvent(buttonId, 'click', 'hi')` →
body runs with `event.value === 'hi'`; the apply lands on the following
flush; the re-rendered button text is `hi!`; results return `[undefined]`
(contained), no error.

Surface: engine dispatch entry, `event.value` arg passthrough, apply → flush
→ re-render ordering, containment.

### Scenario 3.2 — fork-arm wire target fires the NODE once with all arms in ctx.states

Framing: a consumer whose value forks across two providers; dispatching to a
fork-arm element wire (`consumerId#0`) addresses the whole node.

Envelope: a `display` div with a `color` target anchor + two providers
(`red`/`blue` sources), binding `{target: 'handlers.click', reference:
'ReadArms'}`; `ReadArms` body records `context.states.length` and fires a
counter.

Intended output: after a pass renders 2 fork arms, `supervisor.dispatchEvent(
displayId + '#0', 'click')` runs the handler EXACTLY ONCE (never once-per-
arm), with `ctx.states` length 2 (both arms visible — read-only resolved
surface through the engine dispatch); results `[1]`.

Surface: `#`-prefix wire resolution, fork-arm once-fire, ctx.states
grouping, read-only resolved-state access from a dispatched body.

### Scenario 3.3 — unknown and destroyed targets are safe no-ops

Framing: a hostile or stale interaction (a removed control / a typo id)
must never break the page.

Envelope: the Scenario 3.1 button + a second button destroyed mid-flow.

Intended output: `supervisor.dispatchEvent('no-such-id', 'click')` → `[]`,
no throw, page alive; after the second button is destroyed,
`supervisor.dispatchEvent(destroyedId, 'click')` → `[]` (destroyed target
skip), no throw.

Surface: unknown/destroyed → `[]`, never-drain/no-crash invariants.

### Scenario 3.4 — dispatch is a trigger: a READ-ONLY dispatch re-renders nothing

Framing: distinguishing "dispatch fired a body" from "dispatch caused a
render" (the never-drain / never-flush / never-emit pins).

Envelope: a node with a `handlers.click` body that ONLY reads
(`context.tree.getState` / `node.resolved`, no apply).

Intended output: after `supervisor.dispatchEvent(id, 'click')` + awaiting
the flush, the render count / emitted tree is UNCHANGED (no new pass-2
states produced — `takePass2States()` empty in the harness); a subsequent
apply-only dispatch DOES re-render. This is the engine entry honoring
"dispatch is a trigger, never a drain".

Surface: trigger-not-journal, never-drain/flush/emit pins, host-awaits-flush
discipline.

### Scenario 3.5 — no propagation: only the target's handlers fire

Framing: a parent and child both handle `click`; dispatching on the child
must not bubble.

Envelope: a `panel` (handlers.click → `PanelTouch`) containing a `button`
(handlers.click → `ButtonTouch`).

Intended output: `supervisor.dispatchEvent(buttonId, 'click')` increments
ONLY `ButtonTouch` (results `[1]`); the panel handler stays silent.

Surface: target-handlers-only dispatch, no bubbling/propagation.

### Scenario 3.6 — same-(node,event) reentrancy no-ops; a different event fires

Framing: a body that (mistakenly or by design) re-dispatches itself must
not loop; dispatching a different event on the same node is unaffected.

Envelope: a node with `handlers.click` → `SelfClick` (which calls
`ctx.supervisor.dispatchEvent(nodeId, 'click')` inside the body) AND
`handlers.focus` → `FocusCapture`.

Intended output: one top-level `supervisor.dispatchEvent(id, 'click')` runs
`SelfClick` exactly ONCE (the nested same-event dispatch is guarded → `[]`);
then `supervisor.dispatchEvent(id, 'focus')` still runs `FocusCapture`
(guard key `event:<event>:<nodeId>` — different event not blocked).

Surface: reentrancy guard, same-event vs different-event semantics through
the engine entry.

---

## Page shape + execution contract

- ONE demo page `session-features.html` (+ `.js`), three card groups
  (Group 1 css.classes / Group 2 listener lifecycle / Group 3 engine
  dispatch); the module is CORE-ONLY (`dist/core/*`) + the envelope data.
  Banner: `session-features`. Wired into `scripts/build-demo.mjs` +
  `scripts/demo-smoke.mjs` (banner + per-scenario runner checks), listed in
  designing-pages.md §12; a `[session-features:profile]` profile line
  mirrors the other pages' `acc()` instrumentation.
- The harness mirrors the supervisor (translateLegacy → Supervisor +
  EventBridge → register → compile → recordResolved → after-compile phase
  dispatch → recompile → emitElements/diffMinimal/applyOps) and drives
  EVERY interaction through `Supervisor.dispatchEvent` (Group 3 is the
  seam the other groups' interactions already use — cross-coverage is
  intended). Assertions = the INTENDED OUTPUTS above; warnings (the K4
  channel) are asserted as counts/codes where the scenario calls for them.
- Honest-claim guardrails baked into the checks: no same-`event`-name
  differential-dispatch assertion (residual); listener assertions only via
  the shim's listener state (dry-dispatch, DOM-F12 no-pretend); blocked-css
  scenarios assert the warn channel, not render differences.
- Any intended output that cannot be expressed with the documented surface
  above is a DATA-AUTHORING mistake: re-express or drop the scenario
  (recorded in the execution report).