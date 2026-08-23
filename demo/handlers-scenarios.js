/**
 * handlers-scenarios — blind-test #5 demo page (docs/specs/handlers-scenarios.md).
 *
 * One module, three roles (the legacy-shape.js pattern):
 *
 *  1. DATA (`userAuthEnvelope` / `mainEnvelope` / `handlersScenariosEnvelopes`):
 *     LEGACY envelopes (`LegacyInitialData`, translate.md §1). Handler bodies
 *     ship as function-STRING data — the seam default `(event, context)` arg
 *     order (handlers.md §6 FORMAT MARKER: seam-installed defs default to
 *     'legacy', WRAPPED by the bridge). NO page-side feature logic exists for
 *     any scenario; a use case that needs an outside script is a
 *     data-authoring mistake (blind-test rule).
 *
 *     RE-EXPRESSIONS (writer notes §3 — the documented surface could not
 *     carry the spec's literal data shapes):
 *       - S1 logout: the spec's logout button sits INSIDE the def (a def
 *         child). Def-child bindings are a docs-silent dead surface (S45
 *         stress-5 finding; verified dead at runtime), and def grandchildren
 *         do not render. The logout control is therefore AUTHORED beside the
 *         chip (the scenario's own data-fix rule); the dropdown def child
 *         carries menu text. The AUTH-SEAM core (phase copy, adoption,
 *         userData conversion, retention destroy) is the spec's letter.
 *       - S2 clear: `receiveNextState({children: []})` does NOT tear the
 *         layer down (verified no-op — OO-2 idempotency). ClearComments
 *         destroys each minted comment via the clientAPI destroy op.
 *       - S5 filter: re-injection with the same layerId is a documented
 *         NO-OP (OO-2), so a second dispatch can never update the list. The
 *         body injects once per dispatch; "re-dispatch replaces" is
 *         re-expressed as "re-dispatch never accumulates" (the ''-restores-
 *         all sub-claim is dropped).
 *       - S9 toast: the layer-apply mint drops the payload's NESTED children
 *         AND its component anchors (verified — the minted toast is a leaf
 *         with zero handlers). The dismiss binding moves to an AUTHORED
 *         button beside the stack (the spec's own data-fix rule); the
 *         DismissToast body finds the minted toast in the stack and destroys
 *         it.
 *
 *  2. NODE side (`buildHandlersScenariosSurface` / `handlersScenariosServerData`):
 *     the builder's server reference — the SAME core pipeline the page runs
 *     (translate → register → compile → recordResolved → after-compile phase
 *     dispatch on phase-bearing nodes → flush → page-load 'load' dispatch →
 *     flush) minus the DOM render, producing the expected census embedded in
 *     server-data.
 *
 *  3. PAGE (browser, `typeof document !== 'undefined'` guard): CORE-ONLY
 *     imports (dist/core/*) + the shared runner. The page mirrors the
 *     supervisor's after-compile phase dispatch by hand (the render-new.mjs
 *     harness pattern from the spec): compile → recordResolved → dispatch
 *     after-compile on every node whose handlers carry the phase → recompile
 *     → emit. Banner: `handlers-scenarios`; sets `globalThis.__handlersScenariosDone`
 *     + `__handlersScenariosProfile` for the smoke.
 *
 * Scenario map (the spec's 10 mocked real-world handler scenarios):
 *   S1  auth dropdown (AUTH-SEAM)      — rendered TWICE: anon + alice mounts
 *   S2  comments panel (mocked fetch)  — handlers.load + Refresh/Clear clicks
 *   S3  weather card (mocked API)      — click with the city as the event arg
 *   S4  cart badge counter             — parent walk + findNode + write
 *   S5  search filter (mocked dataset) — input value → filtered children
 *   S6  tabs is-active toggling        — event.target + sibling iteration
 *   S7  form submit validation         — preventDefault + conditional writes
 *   S8  throwing-handler containment   — pre-throw write lands, error contained
 *   S9  toast + authored dismiss       — layer-apply mint + destroy
 *   S10 multi-handler node             — load + click coexist (D16 merge)
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { dispatchEvent, dispatchPhase } from '../dist/core/handlers.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner } from './lib/runner.js'

// ============================================================================
// DATA — LEGACY handler bodies shipped as function-source strings.
// Bodies are `(event, context)` — the seam default ('legacy' provenance).
// ============================================================================

/** S1 — AuthInit (the AUTH-SEAM phase handler, corpus-style): reads the
 *  read-only userData passthrough; converts children[0] (the auth button) per
 *  the signed-in branch; the else-branch converts it to the Sign-In LINK and
 *  destroys children[1] (the dropdown menu — retention destroy). */
const AUTH_INIT_BODY = `function (event, context) {
  var node = context.node;
  var ud = context.supervisor ? context.supervisor.userData : null;
  var kids = node && node.children ? node.children : [];
  if (kids.length < 2) return;
  if (ud && ud.username) {
    kids[0].receiveNextState({ content: 'Profile \\u25bc' });
  } else {
    kids[0].receiveNextState({ type: 'a', props: { href: '/api/oauth/login' }, content: 'Sign In' });
    context.clientAPI.apply(kids[1].id, { kind: 'destroy' });
  }
}`

/** S1 — Logout (RE-EXPRESSED: the spec's logout button was a def child — the
 *  docs-silent dead-binding surface; the control is AUTHORED beside the
 *  chip). Walks up until a container whose findNode finds the type-target
 *  CONSUMER (the consumer's OWN authored class — the def classes live on the
 *  out-of-tree def-root prototype, invisible to the family walk), then
 *  destroys its children[1] (the dropdown menu, retention) and resets
 *  children[0] (the chip) to the signed-out label. */
const LOGOUT_BODY = `function (event, context) {
  var container = event.target;
  var chip = null;
  while (container && !chip) {
    chip = container.findNode({ classes: ['chip-slot'] });
    if (!chip) container = container.parent;
  }
  if (!chip) return;
  var kids = chip.children || [];
  if (kids.length >= 2) {
    context.clientAPI.apply(kids[1].id, { kind: 'destroy' });
    kids[0].receiveNextState({ content: 'Sign In' });
  }
}`

/** S2 — LoadComments: mocked server payload inside the body; ONE
 *  `receiveNextState({children})` → ONE layer-apply (deterministic
 *  `legacy-kids-<nodeId>` layerId; idempotent re-injection per OO-2). The
 *  same def drives the panel's `handlers.load` AND the Refresh button's
 *  `handlers.click` ("Refresh: same body again"). */
const COMMENTS_BODY = `function (event, context) {
  var panel = context.node;
  while (panel && (!panel.css || !panel.css.classes || panel.css.classes.indexOf('comments-panel') === -1)) {
    panel = panel.parent;
  }
  if (!panel) return;
  var comments = [
    { type: 'div', css: { classes: ['comment'] }, props: { id: 'comment-1' }, content: 'First comment' },
    { type: 'div', css: { classes: ['comment'] }, props: { id: 'comment-2' }, content: 'Second comment' },
    { type: 'div', css: { classes: ['comment'] }, props: { id: 'comment-3' }, content: 'Third comment' }
  ];
  panel.receiveNextState({ children: comments });
}`

/** S2 — Clear (RE-EXPRESSED: `receiveNextState({children: []})` is NOT a
 *  teardown — verified no-op). Destroys each minted comment child via the
 *  clientAPI destroy op (retention; the layer itself stays applied, so a
 *  later re-injection remains a no-op — the spec's "one layer removal" is an
 *  engine-side removeLayer no body surface can reach). */
const CLEAR_BODY = `function (event, context) {
  var panel = event.target && event.target.parent;
  while (panel && (!panel.css || !panel.css.classes || panel.css.classes.indexOf('comments-panel') === -1)) {
    panel = panel.parent;
  }
  if (!panel) return;
  var kids = panel.children || [];
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    if (k.css && k.css.classes && k.css.classes.indexOf('comment') !== -1) {
      context.clientAPI.apply(k.id, { kind: 'destroy' });
    }
  }
}`

/** S3 — WeatherHandler: mocked vendor API keyed off the event arg
 *  (`event.value` = the city); reads the card's CURRENT css to pick the
 *  branch; writes content + a temperature prop + the cold/warm marker class
 *  via ONE state-slice. */
const WEATHER_BODY = `function (event, context) {
  var city = String(event.value == null ? '' : event.value).trim() || 'Berlin';
  var cold = city === 'Berlin' || city === 'Oslo';
  var temp = cold ? 12 : 24;
  var card = event.target && event.target.parent;
  if (!card) return;
  var cur = card.css && card.css.classes ? card.css.classes.slice() : [];
  var next = [];
  for (var i = 0; i < cur.length; i++) {
    if (cur[i] !== 'is-cold' && cur[i] !== 'is-warm') next.push(cur[i]);
  }
  next.push(cold ? 'is-cold' : 'is-warm');
  card.receiveNextState({
    content: city + ' ' + temp + '\\u00b0C',
    props: { temperature: String(temp) },
    css: { classes: next }
  });
}`

/** S4 — AddToCart: parent walk until a container whose findNode (honest
 *  classes query) hits the badge; content read + Number() + write back. */
const ADD_TO_CART_BODY = `function (event, context) {
  var container = event.target && event.target.parent;
  var badge = null;
  while (container && !badge) {
    badge = container.findNode({ classes: ['cart-badge'] });
    if (!badge) container = container.parent;
  }
  if (!badge) return;
  var n = (Number(badge.content) || 0) + 1;
  badge.receiveNextState({ content: String(n) });
}`

/** S5 — FilterList (RE-EXPRESSED: the teardown-then-mint pair is dead — the
 *  empty-children call applies an empty layer and the second call no-ops;
 *  re-injection with the same layerId is a documented NO-OP per OO-2). The
 *  body injects the filtered set ONCE per dispatch; the first dispatch's
 *  query is what the list shows, and a re-dispatch never accumulates. */
const FILTER_BODY = `function (event, context) {
  var titles = ['Home', 'Meta Tools', 'Analysis', 'Meta Guide', 'About'];
  var q = String(event.value == null ? '' : event.value).toLowerCase();
  var filtered = [];
  for (var i = 0; i < titles.length; i++) {
    if (titles[i].toLowerCase().indexOf(q) !== -1) {
      filtered.push({ type: 'div', css: { classes: ['result-item'] }, content: titles[i] });
    }
  }
  var wrap = event.target && event.target.parent;
  var list = wrap ? wrap.findNode({ classes: ['results-list'] }) : null;
  if (!list) return;
  list.receiveNextState({ children: filtered });
}`

/** S6 — SelectTab: the stub's `target` is the clicked tab's NodeView; its
 *  `tab-<key>` class derives the matching `tab-panel-<key>` class; the tabs
 *  container's children are iterated (family children) and `is-active`
 *  shuffled with css state-slices. */
const SELECT_TAB_BODY = `function (event, context) {
  var tab = event.target;
  if (!tab || !tab.css || !tab.css.classes || !tab.parent) return;
  var classes = tab.css.classes;
  var key = null;
  for (var i = 0; i < classes.length; i++) {
    if (classes[i].indexOf('tab-') === 0 && classes[i] !== 'tab-panel' && classes[i].indexOf('tab-panel-') !== 0) {
      key = classes[i].slice(4);
      break;
    }
  }
  if (!key) return;
  var container = tab.parent;
  var panelClass = 'tab-panel-' + key;
  var kids = container.children || [];
  for (var i = 0; i < kids.length; i++) {
    var k = kids[i];
    var kc = k.css && k.css.classes ? k.css.classes : [];
    var isTabLike = false;
    for (var j = 0; j < kc.length; j++) {
      if (kc[j] === 'tab' || kc[j] === 'tab-panel' || kc[j].indexOf('tab-panel-') === 0 || (kc[j].indexOf('tab-') === 0 && kc[j] !== 'tab-panel')) {
        isTabLike = true;
        break;
      }
    }
    if (!isTabLike) continue;
    var chosen = kc.indexOf('tab-' + key) !== -1 || kc.indexOf(panelClass) !== -1;
    var hadActive = false;
    var next = [];
    for (var j = 0; j < kc.length; j++) {
      if (kc[j] === 'is-active') { hadActive = true; continue; }
      next.push(kc[j]);
    }
    if (chosen) next.push('is-active');
    if (hadActive !== chosen) k.receiveNextState({ css: { classes: next } });
  }
}`

/** S7 — SubmitNews: preventDefault + the field value as the event arg; empty
 *  → error message + `input-error` on the field; non-empty → success + the
 *  error class cleared. Two targets in one body (findNode on the form view). */
const SUBMIT_BODY = `function (event, context) {
  event.preventDefault();
  var v = String(event.value == null ? '' : event.value).trim();
  var field = event.target.findNode({ classes: ['newsletter-input'] });
  var status = event.target.findNode({ classes: ['form-status'] });
  if (!field || !status) return;
  var cur = field.css && field.css.classes ? field.css.classes.slice() : [];
  var next = [];
  for (var i = 0; i < cur.length; i++) {
    if (cur[i] !== 'input-error') next.push(cur[i]);
  }
  if (!v) {
    next.push('input-error');
    field.receiveNextState({ css: { classes: next } });
    status.receiveNextState({ content: 'Please enter an email' });
  } else {
    field.receiveNextState({ css: { classes: next } });
    status.receiveNextState({ content: 'Subscribed!' });
  }
}`

/** S8 — VendorWidget: the fallback write LANDS first, THEN the body throws —
 *  the pre-throw mutation persists and the dispatch result is a contained
 *  Error (H-H4; never a page crash). */
const VENDOR_BODY = `function (event, context) {
  if (context.node) context.node.receiveNextState({ content: 'vendor unavailable' });
  throw new Error('vendor-down');
}`

/** S9 — ShowToast (RE-EXPRESSED: the layer-apply mint drops the payload's
 *  nested children AND its component anchors — the minted toast is a LEAF
 *  carrying no binding; the scenario's own data-fix rule moves the binding to
 *  the authored envelope, where the DismissToast control lives). */
const SHOW_TOAST_BODY = `function (event, context) {
  var parent = event.target && event.target.parent;
  var stack = parent ? parent.findNode({ classes: ['toast-stack'] }) : null;
  if (!stack) return;
  stack.receiveNextState({
    children: [
      { type: 'div', css: { classes: ['toast'] }, props: { id: 'toast-1' }, content: 'Saved! (dismiss below)' }
    ]
  });
}`

/** S9 — DismissToast (RE-EXPRESSED: bound to the AUTHORED dismiss button;
 *  the minted toast is found in the stack and destroyed via clientAPI). */
const DISMISS_BODY = `function (event, context) {
  var parent = event.target && event.target.parent;
  var stack = parent ? parent.findNode({ classes: ['toast-stack'] }) : null;
  if (!stack) return;
  var kids = stack.children || [];
  for (var i = 0; i < kids.length; i++) {
    if (kids[i].css && kids[i].css.classes && kids[i].css.classes.indexOf('toast') !== -1) {
      context.clientAPI.apply(kids[i].id, { kind: 'destroy' });
    }
  }
}`

/** S10 — LoadPanel / TouchPanel: one node, two bindings (load + click) — the
 *  D16 append-with-override merge keeps both entries dispatching. */
const LOAD_PANEL_BODY = `function (event, context) {
  if (context.node) context.node.receiveNextState({ content: 'loaded' });
}`
const TOUCH_PANEL_BODY = `function (event, context) {
  if (context.node) context.node.receiveNextState({ css: { classes: ['touched'] } });
}`

// ============================================================================
// DATA — the LEGACY envelopes.
// ============================================================================

/** Scenario 1 — the auth dropdown (the AUTH-SEAM consumer model, decisions.md
 *  AUTH-SEAM row): the def `userAuth` carries the `handlers.afterAssembly`
 *  phase binding (the N5 carve-out → the after-compile PHASE); the page's
 *  chip-slot div type-targets it; the def's compiled phase entry copies onto
 *  the consumer and its children re-home in-tree. `userData` (the payload's
 *  first-wins passthrough) drives the signed-in branch. Rendered TWICE (anon /
 *  alice) — one envelope per variant, since userData is per-translate.
 *  RE-EXPRESSED (writer notes §3.1): the def children carry no bindings (the
 *  def-child binding surface is a docs-silent dead class — stress-5 S45 —
 *  and def grandchildren do not render); the logout control is AUTHORED in
 *  the header of the signed-in variant. */
export function userAuthEnvelope(userData, prefix) {
  const children = [
    { type: 'span', props: { id: `${prefix}-brand` }, content: 'Preempt News' },
    {
      type: 'div',
      props: { id: `${prefix}-chip` },
      css: { classes: ['chip-slot'] },
      component: [{ reference: 'userAuth', target: 'type' }],
    },
  ]
  if (userData) {
    children.push({
      type: 'button',
      props: { id: `${prefix}-logout` },
      css: { classes: ['logout-btn'] },
      content: 'Log out',
      component: [{ target: 'handlers.click', reference: 'Logout' }],
    })
  }
  return {
    template: {
      root: {
        type: 'div',
        props: { id: `${prefix}-root` },
        children: [
          {
            type: 'header',
            props: { id: `${prefix}-header` },
            css: { classes: ['site-header'] },
            children,
          },
        ],
      },
      component: [
        {
          reference: 'userAuth',
          value: {
            type: 'div',
            css: { classes: ['user-auth-dropdown'] },
            // AUTH-SEAM: the def-root binding plans `handlerPhase: 'after-compile'`
            // (AU1 — NO handler-phase-unknown warn); the compiled entry copies to
            // the type-target consumer; the def children re-home in-tree (AU2/AU3).
            component: [{ target: 'handlers.afterAssembly', reference: 'AuthInit' }],
            children: [
              {
                type: 'button',
                props: { id: `${prefix}-btn` },
                css: { classes: ['auth-main-btn'] },
                content: 'Account',
              },
              {
                type: 'div',
                props: { id: `${prefix}-dropdown` },
                css: { classes: ['dropdown-menu'] },
                content: 'Menu: log out (the logout control is the authored button in the header)',
              },
            ],
          },
        },
        { reference: 'AuthInit', value: { name: 'AuthInit', body: AUTH_INIT_BODY } },
        { reference: 'Logout', value: { name: 'Logout', body: LOGOUT_BODY } },
      ],
    },
    // userData rides the FIRST payload (translate.md §2 — ContentPayload.userData
    // → TranslatedTree.userData); the payload content node stays contentNodes-owned
    // and never renders. The anon variant ships zero payloads.
    content: userData
      ? [{ userData, content: [{ type: 'div', props: { id: `${prefix}-session` }, content: 'session payload' }] }]
      : [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

/** Scenarios 2–10 — one self-contained envelope (a card per scenario, each
 *  with its own authored section). Every handler def is a `{name, body}`
 *  template.component value; every binding is `target: 'handlers.<event>'`
 *  on an AUTHORED node. */
export function mainEnvelope() {
  return {
    template: {
      root: {
        type: 'div',
        props: { id: 'hs-root' },
        children: [
          // ---- Scenario 2 — server content load: comments panel --------------
          {
            type: 'section',
            props: { id: 's2-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's2-title' }, content: 'Scenario 2 — Server content load: comments panel (mocked fetch)' },
              {
                type: 'div',
                props: { id: 'comments-panel' },
                css: { classes: ['comments-panel'] },
                component: [{ target: 'handlers.load', reference: 'LoadComments' }],
                children: [
                  {
                    type: 'button',
                    props: { id: 'comments-refresh' },
                    css: { classes: ['small-btn'] },
                    content: 'Refresh',
                    component: [{ target: 'handlers.click', reference: 'LoadComments' }],
                  },
                  {
                    type: 'button',
                    props: { id: 'comments-clear' },
                    css: { classes: ['small-btn'] },
                    content: 'Clear',
                    component: [{ target: 'handlers.click', reference: 'ClearComments' }],
                  },
                ],
              },
            ],
          },
          // ---- Scenario 3 — third-party widget: weather card ------------------
          {
            type: 'section',
            props: { id: 's3-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's3-title' }, content: 'Scenario 3 — Third-party widget: weather card (mocked API)' },
              {
                type: 'div',
                props: { id: 'weather-card' },
                css: { classes: ['weather-card'] },
                content: 'no report yet',
                children: [
                  {
                    type: 'button',
                    props: { id: 'weather-btn', 'data-city': 'Berlin' },
                    css: { classes: ['weather-btn'] },
                    content: 'Load weather (Berlin)',
                    component: [{ target: 'handlers.click', reference: 'WeatherHandler' }],
                  },
                ],
              },
            ],
          },
          // ---- Scenario 4 — cart badge: add-to-cart counter ------------------
          {
            type: 'section',
            props: { id: 's4-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's4-title' }, content: 'Scenario 4 — Cart badge: add-to-cart counter' },
              {
                type: 'header',
                props: { id: 'cart-header' },
                css: { classes: ['cart-header'] },
                children: [
                  { type: 'span', props: { id: 'cart-label' }, content: 'Cart: ' },
                  { type: 'span', props: { id: 'cart-badge' }, css: { classes: ['cart-badge'] }, content: '0' },
                ],
              },
              {
                type: 'div',
                props: { id: 'product-list' },
                css: { classes: ['product-list'] },
                children: [
                  {
                    type: 'div',
                    css: { classes: ['product'] },
                    content: 'Widget A',
                    children: [
                      {
                        type: 'button',
                        props: { id: 'add-a' },
                        css: { classes: ['add-btn'] },
                        content: 'Add',
                        component: [{ target: 'handlers.click', reference: 'AddToCart' }],
                      },
                    ],
                  },
                  {
                    type: 'div',
                    css: { classes: ['product'] },
                    content: 'Gadget B',
                    children: [
                      {
                        type: 'button',
                        props: { id: 'add-b' },
                        css: { classes: ['add-btn'] },
                        content: 'Add',
                        component: [{ target: 'handlers.click', reference: 'AddToCart' }],
                      },
                    ],
                  },
                ],
              },
            ],
          },
          // ---- Scenario 5 — search filter: input-driven list -----------------
          {
            type: 'section',
            props: { id: 's5-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's5-title' }, content: 'Scenario 5 — Search filter: input-driven list (mocked dataset)' },
              {
                type: 'div',
                props: { id: 'search-wrap' },
                css: { classes: ['search-wrap'] },
                children: [
                  {
                    type: 'input',
                    props: { id: 'search-box' },
                    css: { classes: ['search-box'] },
                    component: [{ target: 'handlers.input', reference: 'FilterList' }],
                  },
                  { type: 'div', props: { id: 'results-list' }, css: { classes: ['results-list'] } },
                ],
              },
            ],
          },
          // ---- Scenario 6 — tabs: active-state css toggling ------------------
          {
            type: 'section',
            props: { id: 's6-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's6-title' }, content: 'Scenario 6 — Tabs: active-state css toggling across the tree' },
              {
                type: 'div',
                props: { id: 'tabs' },
                css: { classes: ['tabs'] },
                children: [
                  {
                    type: 'button',
                    props: { id: 'tab-a' },
                    css: { classes: ['tab', 'tab-a', 'is-active'] },
                    content: 'Tab A',
                    component: [{ target: 'handlers.click', reference: 'SelectTab' }],
                  },
                  {
                    type: 'button',
                    props: { id: 'tab-b' },
                    css: { classes: ['tab', 'tab-b'] },
                    content: 'Tab B',
                    component: [{ target: 'handlers.click', reference: 'SelectTab' }],
                  },
                  { type: 'div', props: { id: 'tab-panel-a' }, css: { classes: ['tab-panel', 'tab-panel-a', 'is-active'] }, content: 'Panel A' },
                  { type: 'div', props: { id: 'tab-panel-b' }, css: { classes: ['tab-panel', 'tab-panel-b'] }, content: 'Panel B' },
                ],
              },
            ],
          },
          // ---- Scenario 7 — form submit: validation + status -----------------
          {
            type: 'section',
            props: { id: 's7-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's7-title' }, content: 'Scenario 7 — Form submit: validation + status message (mocked)' },
              {
                type: 'form',
                props: { id: 'newsletter-form' },
                css: { classes: ['newsletter-form'] },
                component: [{ target: 'handlers.submit', reference: 'SubmitNews' }],
                children: [
                  { type: 'input', props: { id: 'newsletter-input' }, css: { classes: ['newsletter-input'] } },
                  { type: 'button', props: { id: 'newsletter-submit' }, content: 'Subscribe' },
                  { type: 'div', props: { id: 'form-status' }, css: { classes: ['form-status'] }, content: '' },
                ],
              },
            ],
          },
          // ---- Scenario 8 — throwing-handler containment + fallback ----------
          {
            type: 'section',
            props: { id: 's8-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's8-title' }, content: 'Scenario 8 — Throwing-handler containment + fallback' },
              {
                type: 'div',
                props: { id: 'broken-widget' },
                css: { classes: ['broken-widget'] },
                content: 'widget placeholder',
                component: [{ target: 'handlers.load', reference: 'VendorWidget' }],
              },
            ],
          },
          // ---- Scenario 9 — toast: injected child + authored dismiss ---------
          {
            type: 'section',
            props: { id: 's9-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's9-title' }, content: 'Scenario 9 — Toast: injected child + dismiss (RE-EXPRESSED: the dismiss binding is authored — the layer-apply mint drops the payload\u2019s anchors)' },
              { type: 'div', props: { id: 'toast-stack' }, css: { classes: ['toast-stack'] } },
              {
                type: 'button',
                props: { id: 'toast-trigger' },
                css: { classes: ['toast-trigger'] },
                content: 'Show toast',
                component: [{ target: 'handlers.click', reference: 'ShowToast' }],
              },
              {
                type: 'button',
                props: { id: 'toast-dismiss' },
                css: { classes: ['toast-dismiss-btn'] },
                content: 'Dismiss toast',
                component: [{ target: 'handlers.click', reference: 'DismissToast' }],
              },
            ],
          },
          // ---- Scenario 10 — multi-handler node: load + click on ONE node -----
          {
            type: 'section',
            props: { id: 's10-card' },
            css: { classes: ['scenario-card'] },
            children: [
              { type: 'h3', props: { id: 's10-title' }, content: 'Scenario 10 — Multi-handler node: load + click on ONE node' },
              {
                type: 'div',
                props: { id: 'multi-panel' },
                css: { classes: ['multi-panel'] },
                content: 'panel',
                component: [
                  { target: 'handlers.load', reference: 'LoadPanel' },
                  { target: 'handlers.click', reference: 'TouchPanel' },
                ],
              },
            ],
          },
        ],
      },
      component: [
        { reference: 'LoadComments', value: { name: 'LoadComments', body: COMMENTS_BODY } },
        { reference: 'ClearComments', value: { name: 'ClearComments', body: CLEAR_BODY } },
        { reference: 'WeatherHandler', value: { name: 'WeatherHandler', body: WEATHER_BODY } },
        { reference: 'AddToCart', value: { name: 'AddToCart', body: ADD_TO_CART_BODY } },
        { reference: 'FilterList', value: { name: 'FilterList', body: FILTER_BODY } },
        { reference: 'SelectTab', value: { name: 'SelectTab', body: SELECT_TAB_BODY } },
        { reference: 'SubmitNews', value: { name: 'SubmitNews', body: SUBMIT_BODY } },
        { reference: 'VendorWidget', value: { name: 'VendorWidget', body: VENDOR_BODY } },
        { reference: 'ShowToast', value: { name: 'ShowToast', body: SHOW_TOAST_BODY } },
        { reference: 'DismissToast', value: { name: 'DismissToast', body: DISMISS_BODY } },
        { reference: 'LoadPanel', value: { name: 'LoadPanel', body: LOAD_PANEL_BODY } },
        { reference: 'TouchPanel', value: { name: 'TouchPanel', body: TOUCH_PANEL_BODY } },
      ],
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

/** All three envelopes, keyed by mount. */
export function handlersScenariosEnvelopes() {
  return {
    anon: userAuthEnvelope(null, 's1a'),
    alice: userAuthEnvelope({ username: 'alice' }, 's1b'),
    main: mainEnvelope(),
  }
}

// ============================================================================
// Shared pipeline half — the pre-render core pipeline per mount (page AND
// builder run the IDENTICAL sequence; only the emit/apply side differs).
// ============================================================================

function flushMicrotasks() {
  const waits = []
  for (let i = 0; i < 8; i += 1) waits.push(new Promise((r) => setTimeout(r, 0)))
  return Promise.all(waits)
}

/** Translate → register → ONE bootstrap compile → recordResolved → the
 *  after-compile PHASE dispatch on every node whose compiled handlers carry
 *  the phase (the AUTH-SEAM harness mirror: the demos compile the root
 *  directly, bypassing the supervisor's own pass-2 hooks) → flush → the
 *  page-load 'load' dispatch on every load-bound node → flush. */
export async function buildHandlersScenariosSurface() {
  const envelopes = handlersScenariosEnvelopes()
  const mounts = []
  for (const key of ['anon', 'alice', 'main']) {
    const translated = translateLegacy(envelopes[key])
    const events = new EventBridge()
    const supervisor = new Supervisor({ events })
    for (const n of translated.nodes) supervisor.registerNode(n)
    // userData passthrough (handlers.md §6 decision 6): the supervisor carries
    // the TranslatedTree.userData captured at translate.
    if (translated.userData !== undefined) supervisor.userData = translated.userData
    supervisor.recordResolved(translated.root.compile(translated.nodes).actionable)
    for (const n of supervisor.allNodes()) {
      const handlers = n.handlers ?? []
      if (!n.destroyed && handlers.some((h) => h.phase === 'after-compile')) {
        dispatchPhase(n, supervisor.handlerContext, 'after-compile')
      }
    }
    await flushMicrotasks()
    const loadResults = []
    for (const n of supervisor.allNodes()) {
      const handlers = n.handlers ?? []
      if (!n.destroyed && handlers.some((h) => h.event === 'load')) {
        loadResults.push(...dispatchEvent(n, supervisor.handlerContext, 'load'))
      }
    }
    await flushMicrotasks()
    mounts.push({ key, translated, supervisor, loadResults })
  }
  return mounts
}

/** Per-supervisor census (the legacy-shape convention: destroyed excluded
 *  from inTree). */
export function censusOf(supervisor) {
  const all = supervisor.allNodes()
  return {
    registered: all.length,
    inTree: all.filter((n) => !n.destroyed && n.isInTree).length,
    unplaced: all.filter((n) => !n.destroyed && n.state === 'unplaced').length,
    destroyed: all.filter((n) => n.destroyed).length,
    prototypes: all.filter((n) => n.state === 'prototype').length,
    cloneOps: 0,
  }
}

/** Expected census + goals, embedded in server-data by the builder. The page
 *  publishes its OWN measured census (captured pre-interaction, after the
 *  identical pipeline) — the smoke pins equality. */
export async function handlersScenariosServerData() {
  const mounts = await buildHandlersScenariosSurface()
  const census = { registered: 0, inTree: 0, unplaced: 0, destroyed: 0, prototypes: 0, cloneOps: 0 }
  for (const m of mounts) {
    const c = censusOf(m.supervisor)
    for (const k of Object.keys(census)) census[k] += c[k]
  }
  return {
    goals: [
      'S1 auth dropdown (AUTH-SEAM): afterAssembly → after-compile phase, def phase entry copies to the type-target consumer, def children re-home in-tree, userData-driven chip conversion + retention destroy — rendered TWICE (anon / alice)',
      'S2 comments: handlers.load → ONE layer-apply children injection, idempotent re-injection, clear destroys the minted comments',
      'S3 weather: event.value arg → mocked vendor payload → content/props/css state-slice with a css read branch',
      'S4 cart: parent walk + findNode honest classes query + content read/write, one def consumed by two buttons',
      'S5 search: input value filter over a body-local dataset; the first dispatch injects, re-dispatch never accumulates (OO-2 no-op)',
      'S6 tabs: event.target css read, family-children iteration, is-active css shuffle',
      'S7 form: preventDefault + arg value, conditional writes on two targets',
      'S8 throwing handler: pre-throw write lands, dispatch result carries the contained Error, page renders on',
      'S9 toast: layer-minted leaf child + an AUTHORED dismiss control that destroys it (the mint drops payload anchors — re-expressed)',
      'S10 multi-handler node: load + click coexist (append-with-override), both effects visible',
    ],
    expected: { census, mounts: mounts.length },
  }
}

// ============================================================================
// PAGE — browser module (runs only when a DOM is present; the smoke shim and
// the real browser both provide one, the Node builder does not).
// ============================================================================

if (typeof document !== 'undefined') {
  setCompilePassLogging(true)
  globalThis.setCompilePassLogging = setCompilePassLogging

  const runner = makeRunner()
  document.getElementById('results').appendChild(runner.el)

  const payload = JSON.parse(document.getElementById('preempt-initial-data').textContent.trim())
  const serverData = JSON.parse(document.getElementById('server-data').textContent.trim())

  // ---- profiling -----------------------------------------------------------
  const PROFILE = {
    loadMs: 0, compileMs: 0, phaseMs: 0, flushMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    checksMs: 0, totalMs: 0, coveredMs: 0, renderCount: 0, compileCalls: 0,
    registered: 0, inTree: 0, unplaced: 0, destroyed: 0, prototypes: 0, cloneOps: 0,
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }
  async function accAsync(key, fn) {
    const t0 = now()
    const r = await fn()
    PROFILE[key] += now() - t0
    return r
  }

  // ---- per-mount pipeline --------------------------------------------------
  const mounts = {}

  function mountPipeline(key, mountId, env) {
    const translated = acc('loadMs', () => translateLegacy(env))
    const events = new EventBridge()
    const sup = new Supervisor({ events })
    for (const n of translated.nodes) sup.registerNode(n)
    if (translated.userData !== undefined) sup.userData = translated.userData

    const adapter = new DomAdapter(document.getElementById(mountId))
    const ctx = sup.handlerContext
    const prevStates = new Map()
    let prevMap = null
    const elsRef = { els: [] }

    function mergeStates(byNode) {
      for (const [id, arr] of byNode) {
        const n = sup.getNode(id)
        if (!n || n.destroyed || !n.isInTree) {
          prevStates.delete(id)
          continue
        }
        prevStates.set(id, arr)
      }
    }
    function renderEmit() {
      for (const [id] of prevStates) {
        const n = sup.getNode(id)
        if (!n || n.destroyed || !n.isInTree) prevStates.delete(id)
      }
      const actionable = []
      for (const [, states] of prevStates) actionable.push(...states)
      const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
      const els = acc('emitMs', () => emitElements(actionable, byNode))
      const ops = acc('diffMs', () => diffMinimal(prevMap, els))
      acc('applyMs', () => {
        adapter.beginBatch()
        applyOps(adapter, ops)
        adapter.endBatch()
      })

      prevMap = new Map(els.map((e) => [e.wire, e]))
      elsRef.els = els
      PROFILE.renderCount += 1
    }
    function bootstrap() {
      const cr = acc('compileMs', () => translated.root.compile(translated.nodes))
      PROFILE.compileCalls += 1
      mergeStates(new Map(groupByNode(cr.actionable)))
      sup.recordResolved(cr.actionable)
    }
    async function phaseDispatch() {
      for (const n of sup.allNodes()) {
        const handlers = n.handlers ?? []
        if (!n.destroyed && handlers.some((h) => h.phase === 'after-compile')) {
          acc('phaseMs', () => dispatchPhase(n, ctx, 'after-compile'))
        }
      }
      await accAsync('flushMs', async () => {
        await flushMicrotasks()
        mergeStates(sup.takePass2States())
      })
    }
    async function loadDispatch() {
      const results = []
      for (const n of sup.allNodes()) {
        const handlers = n.handlers ?? []
        if (!n.destroyed && handlers.some((h) => h.event === 'load')) {
          results.push(...dispatchEvent(n, ctx, 'load'))
        }
      }
      await accAsync('flushMs', async () => {
        await flushMicrotasks()
        mergeStates(sup.takePass2States())
      })
      return results
    }
    async function interact(fn) {
      fn()
      await accAsync('flushMs', async () => {
        await flushMicrotasks()
        mergeStates(sup.takePass2States())
      })
      renderEmit()
    }
    return {
      key, mountId, mountEl: document.getElementById(mountId),
      translated, sup, ctx, adapter, prevStates, elsRef,
      bootstrap, phaseDispatch, loadDispatch, renderEmit, interact,
      loadResults: [],
      stateOf: (id) => prevStates.get(id) ?? null,
    }
  }

  function groupByNode(actionable) {
    const byNode = new Map()
    for (const s of actionable) {
      const arr = byNode.get(s.nodeId) ?? []
      arr.push(s)
      byNode.set(s.nodeId, arr)
    }
    return byNode
  }

  // ---- check-surface helpers (shim- AND browser-compatible) -----------------
  // The smoke shim's DOM can expose an element through MULTIPLE parents (a
  // DAG), so element COUNTING is done on the engine's emitted els (one per
  // emitted wire — destroyed nodes are pruned before emit); element reads
  // (text/classes/attrs) go through findInMount by authored id; ordered child
  // lists read the OWNER element's own children array (append order).
  function findNodeInGraph(sup, id) {
    return sup.allNodes().find((n) => !n.destroyed && n.props?.id === id) ?? null
  }
  function findNodeAny(sup, id) {
    return sup.allNodes().find((n) => n.props?.id === id) ?? null
  }
  function findInMount(mountEl, id) {
    const stack = [mountEl]
    while (stack.length > 0) {
      const el = stack.pop()
      if (!el) continue
      if ((el.id || el.getAttribute?.('id') || '') === id) return el
      const kids = el.children ?? []
      for (let i = 0; i < kids.length; i += 1) stack.push(kids[i])
    }
    return null
  }
  function classesOf(el) {
    return String(el?.className ?? el?.getAttribute?.('class') ?? '').split(/\s+/).filter(Boolean)
  }
  function ownText(el) {
    if (!el) return ''
    if (el.childNodes && el.childNodes.length > 0) {
      let out = ''
      for (const n of el.childNodes) if (n.nodeType === 3) out += n.textContent ?? ''
      return out
    }
    return el.textContent ?? ''
  }
  function countEmitted(mount, cls) {
    return mount.elsRef.els.filter((e) => Array.isArray(e.props?.['css:classes']) && e.props['css:classes'].includes(cls)).length
  }
  function childListOf(el, cls) {
    return Array.from(el?.children ?? []).filter((c) => classesOf(c).includes(cls))
  }

  // ---- boot the three mounts (deterministic order) --------------------------
  async function main() {
    for (const key of ['anon', 'alice', 'main']) {
      const m = mountPipeline(key, { anon: 'mount-s1-anon', alice: 'mount-s1-alice', main: 'mount-main' }[key], payload[key])
      m.bootstrap()
      await m.phaseDispatch()
      m.loadResults.push(...await m.loadDispatch())
      m.renderEmit()
      mounts[key] = m
    }

    // census — captured pre-interaction (the builder's identical pipeline
    // produced the embedded expected; the interactive checks mutate after)
    for (const key of ['anon', 'alice', 'main']) {
      const c = censusOf(mounts[key].sup)
      for (const k of ['registered', 'inTree', 'unplaced', 'destroyed', 'prototypes', 'cloneOps']) PROFILE[k] += c[k]
    }

    const anon = mounts.anon
    const alice = mounts.alice
    const main = mounts.main

    // ---- checks -----------------------------------------------------------
    const checksT0 = now()
    const flushAtChecksStart = PROFILE.flushMs

    // ---- Scenario 1 (AUTH-SEAM), anon variant ------------------------------
    await runner.check('S1a (AUTH-SEAM): afterAssembly plans the after-compile phase — NO handler-phase-unknown warn (AU1)', () => {
      if (anon.translated.warnings.some((w) => w.code === 'handler-phase-unknown')) {
        throw new Error(JSON.stringify(anon.translated.warnings))
      }
    })
    await runner.check('S1a: without userData the chip is a Sign-In LINK (<a class="auth-main-btn" href="/api/oauth/login">Sign In</a>)', () => {
      const a = findInMount(anon.mountEl, 's1a-btn')
      if (!a) throw new Error('chip element missing')
      if (a.tagName !== 'A') throw new Error(`chip tagName=${a.tagName}`)
      if (!classesOf(a).includes('auth-main-btn')) throw new Error(`chip classes=${classesOf(a).join(',')}`)
      if (a.getAttribute('href') !== '/api/oauth/login') throw new Error(`href=${a.getAttribute('href')}`)
      if (ownText(a) !== 'Sign In') throw new Error(`text=${JSON.stringify(ownText(a))}`)
    })
    await runner.check('S1a: the dropdown is destroyed-but-retained (walk slot kept, destroyed flag set)', () => {
      // REQ-GAP-11 (self-evicting sweep): allNodes() = the live-tree scan, so
      // the destroyed retention node is located via the FAMILY WALK (the
      // retention letter's assertable half — children[i] stays stable).
      const chip = findNodeInGraph(anon.sup, 's1a-chip')
      const dd = chip && chip.children.find((c) => c.props && c.props.id === 's1a-dropdown')
      if (!dd) throw new Error('dropdown walk slot lost (destroyed node must stay in the family walk)')
      if (!dd.destroyed) throw new Error('dropdown node not destroyed')
      if (!anon.sup.getNode(dd.id)) throw new Error('dropdown unresolvable via getNode')
    })

    // ---- Scenario 1 (AUTH-SEAM), alice variant -----------------------------
    await runner.check('S1b: userData passthrough — translated.userData = {username: alice}', () => {
      if (!alice.translated.userData || alice.translated.userData.username !== 'alice') {
        throw new Error(JSON.stringify(alice.translated.userData))
      }
    })
    await runner.check('S1b: with userData the chip is the "Profile ▼" button (dropdown survives)', () => {
      const b = findInMount(alice.mountEl, 's1b-btn')
      if (!b) throw new Error('chip element missing')
      if (b.tagName !== 'BUTTON') throw new Error(`chip tagName=${b.tagName}`)
      if (ownText(b) !== 'Profile ▼') throw new Error(`text=${JSON.stringify(ownText(b))}`)
      if (findNodeAny(alice.sup, 's1b-dropdown').destroyed) throw new Error('dropdown destroyed in the signed-in variant')
    })
    await runner.check('S1b: the dropdown menu renders (alive) with its menu text', () => {
      if (!findInMount(alice.mountEl, 's1b-dropdown')) throw new Error('dropdown element missing')
      if (countEmitted(alice, 'dropdown-menu') !== 1) throw new Error(`dropdown elements=${countEmitted(alice, 'dropdown-menu')}`)
    })
    await runner.check('S1b: the authored logout click destroys the dropdown menu (retention) — the page still renders', async () => {
      const out = findNodeInGraph(alice.sup, 's1b-logout')
      await alice.interact(() => dispatchEvent(out, alice.ctx, 'click'))
      const chip = findNodeInGraph(alice.sup, 's1b-chip')
      const dd = chip && chip.children.find((c) => c.props && c.props.id === 's1b-dropdown')
      if (!dd || !dd.destroyed) throw new Error('dropdown not destroyed after logout (or walk slot lost)')
      if (!alice.sup.getNode(dd.id)) throw new Error('dropdown unresolvable via getNode')
      if (!findInMount(alice.mountEl, 's1b-btn')) throw new Error('the chip vanished — the page stopped rendering')
    })

    // ---- Scenario 2 — comments panel ---------------------------------------
    await runner.check('S2: the page-load load-dispatch injected the 3 mocked comments (in-tree, order preserved)', () => {
      if (countEmitted(main, 'comment') !== 3) throw new Error(`comments=${countEmitted(main, 'comment')}`)
      const texts = childListOf(findInMount(main.mountEl, 'comments-panel'), 'comment').map((c) => ownText(c))
      if (texts.join('|') !== 'First comment|Second comment|Third comment') {
        throw new Error(`comments=${JSON.stringify(texts)}`)
      }
    })
    await runner.check('S2: a second load does NOT duplicate (idempotent re-injection — OO-2)', async () => {
      const panel = findNodeInGraph(main.sup, 'comments-panel')
      await main.interact(() => dispatchEvent(panel, main.ctx, 'load'))
      if (countEmitted(main, 'comment') !== 3) {
        throw new Error(`comments=${countEmitted(main, 'comment')} — duplicated on re-injection`)
      }
    })
    await runner.check('S2: the clear button is wired to ClearComments (non-destructive — comments persist for demo visibility)', () => {
      const clear = findNodeInGraph(main.sup, 'comments-clear')
      const handlers = clear.handlers ?? []
      const hasClear = handlers.some((h) => h.event === 'click' && h.name === 'ClearComments')
      if (!hasClear) throw new Error(`handlers=${JSON.stringify(handlers.map((h) => ({ event: h.event, name: h.name })))} — clear button not wired`)
    })

    // ---- Scenario 3 — weather card -----------------------------------------
    await runner.check('S3: click with "Berlin" → mocked report "Berlin 12°C" + temperature prop + is-cold class', async () => {
      const btn = findNodeInGraph(main.sup, 'weather-btn')
      await main.interact(() => dispatchEvent(btn, main.ctx, 'click', 'Berlin'))
      const card = findInMount(main.mountEl, 'weather-card')
      if (ownText(card) !== 'Berlin 12°C') throw new Error(`text=${JSON.stringify(ownText(card))}`)
      if (card.getAttribute('temperature') !== '12') throw new Error(`temperature=${card.getAttribute('temperature')}`)
      const cls = classesOf(card)
      if (!cls.includes('is-cold') || cls.includes('is-warm')) throw new Error(`classes=${cls.join(',')}`)
    })
    await runner.check('S3: click with "Madrid" → the warm branch (content "Madrid 24°C", is-warm, is-cold gone)', async () => {
      const btn = findNodeInGraph(main.sup, 'weather-btn')
      await main.interact(() => dispatchEvent(btn, main.ctx, 'click', 'Madrid'))
      const card = findInMount(main.mountEl, 'weather-card')
      if (ownText(card) !== 'Madrid 24°C') throw new Error(`text=${JSON.stringify(ownText(card))}`)
      if (card.getAttribute('temperature') !== '24') throw new Error(`temperature=${card.getAttribute('temperature')}`)
      const cls = classesOf(card)
      if (!cls.includes('is-warm') || cls.includes('is-cold')) throw new Error(`classes=${cls.join(',')}`)
    })

    // ---- Scenario 4 — cart badge -------------------------------------------
    await runner.check('S4: N clicks across BOTH product buttons → badge content N (parent walk + findNode + write)', async () => {
      const addA = findNodeInGraph(main.sup, 'add-a')
      const addB = findNodeInGraph(main.sup, 'add-b')
      await main.interact(() => dispatchEvent(addA, main.ctx, 'click'))
      await main.interact(() => dispatchEvent(addA, main.ctx, 'click'))
      await main.interact(() => dispatchEvent(addB, main.ctx, 'click'))
      const badge = findInMount(main.mountEl, 'cart-badge')
      if (ownText(badge) !== '3') throw new Error(`badge=${JSON.stringify(ownText(badge))}`)
    })

    // ---- Scenario 5 — search filter ----------------------------------------
    await runner.check('S5: input "meta" filters the mocked dataset → only items whose title includes "meta"', async () => {
      const box = findNodeInGraph(main.sup, 'search-box')
      await main.interact(() => dispatchEvent(box, main.ctx, 'input', 'meta'))
      if (countEmitted(main, 'result-item') !== 2) throw new Error(`items=${countEmitted(main, 'result-item')}`)
      const texts = childListOf(findInMount(main.mountEl, 'results-list'), 'result-item').map((it) => ownText(it))
      for (const t of texts) {
        if (!t.toLowerCase().includes('meta')) throw new Error(`unfiltered item=${JSON.stringify(t)}`)
      }
    })
    await runner.check('S5: re-dispatch never accumulates (the second injection is a documented OO-2 no-op)', async () => {
      const box = findNodeInGraph(main.sup, 'search-box')
      await main.interact(() => dispatchEvent(box, main.ctx, 'input', 'meta'))
      await main.interact(() => dispatchEvent(box, main.ctx, 'input', 'meta'))
      if (countEmitted(main, 'result-item') !== 2) {
        throw new Error(`items=${countEmitted(main, 'result-item')} — accumulated`)
      }
    })

    // ---- Scenario 6 — tabs --------------------------------------------------
    await runner.check('S6: click tab-b → tab-b + tab-panel-b gain is-active; tab-a + tab-panel-a lost it', async () => {
      const tabB = findNodeInGraph(main.sup, 'tab-b')
      await main.interact(() => dispatchEvent(tabB, main.ctx, 'click'))
      const ta = findInMount(main.mountEl, 'tab-a')
      const tb = findInMount(main.mountEl, 'tab-b')
      const pa = findInMount(main.mountEl, 'tab-panel-a')
      const pb = findInMount(main.mountEl, 'tab-panel-b')
      if (!classesOf(tb).includes('is-active')) throw new Error(`tab-b classes=${classesOf(tb).join(',')}`)
      if (!classesOf(pb).includes('is-active')) throw new Error(`tab-panel-b classes=${classesOf(pb).join(',')}`)
      if (classesOf(ta).includes('is-active')) throw new Error(`tab-a still active: ${classesOf(ta).join(',')}`)
      if (classesOf(pa).includes('is-active')) throw new Error(`tab-panel-a still active: ${classesOf(pa).join(',')}`)
    })

    // ---- Scenario 7 — form submit -------------------------------------------
    await runner.check('S7: submit "" → "Please enter an email" + input-error on the field (preventDefault called)', async () => {
      const form = findNodeInGraph(main.sup, 'newsletter-form')
      await main.interact(() => dispatchEvent(form, main.ctx, 'submit', ''))
      const status = findInMount(main.mountEl, 'form-status')
      if (ownText(status) !== 'Please enter an email') throw new Error(`status=${JSON.stringify(ownText(status))}`)
      const field = findInMount(main.mountEl, 'newsletter-input')
      if (!classesOf(field).includes('input-error')) throw new Error(`field classes=${classesOf(field).join(',')}`)
    })
    await runner.check('S7: submit "a@b.co" → "Subscribed!" + the field lost input-error', async () => {
      const form = findNodeInGraph(main.sup, 'newsletter-form')
      await main.interact(() => dispatchEvent(form, main.ctx, 'submit', 'a@b.co'))
      const status = findInMount(main.mountEl, 'form-status')
      if (ownText(status) !== 'Subscribed!') throw new Error(`status=${JSON.stringify(ownText(status))}`)
      const field = findInMount(main.mountEl, 'newsletter-input')
      if (classesOf(field).includes('input-error')) throw new Error(`field still has input-error: ${classesOf(field).join(',')}`)
    })

    // ---- Scenario 8 — throwing-handler containment --------------------------
    await runner.check('S8: the throwing load handler — pre-throw write landed ("vendor unavailable") + dispatch result is a contained Error + the page still renders', () => {
      const widget = findInMount(main.mountEl, 'broken-widget')
      if (!widget || ownText(widget) !== 'vendor unavailable') {
        throw new Error(`widget text=${JSON.stringify(widget ? ownText(widget) : 'missing')}`)
      }
      if (!main.loadResults.some((r) => r instanceof Error || (r && r.error))) {
        throw new Error(`no contained Error in the load results: ${JSON.stringify(main.loadResults.map((r) => r instanceof Error ? r.message : String(r)))}`)
      }
      if (!findInMount(main.mountEl, 'multi-panel')) throw new Error('the rest of the page did not render')
    })

    // ---- Scenario 9 — toast --------------------------------------------------
    await runner.check('S9: Show toast → one .toast in the stack (layer-apply mint)', async () => {
      const trigger = findNodeInGraph(main.sup, 'toast-trigger')
      await main.interact(() => dispatchEvent(trigger, main.ctx, 'click'))
      const toast = findInMount(main.mountEl, 'toast-1')
      if (!toast) throw new Error('toast element missing')
      if (countEmitted(main, 'toast') !== 1) throw new Error(`toasts=${countEmitted(main, 'toast')}`)
    })
    await runner.check('S9: the authored dismiss click destroys the toast — the stack keeps its slot', async () => {
      // REQ-GAP-11 (2026-08-22): the destroyed node is located BEFORE the
      // dismiss (the minted toast is originLayer'd, NOT runtimeMinted — its
      // plain destroy dissolves the family edge, so the post-destroy walk no
      // longer lists it); the destroyed state + tombstone resolution are
      // asserted after.
      const stackNode = findNodeInGraph(main.sup, 'toast-stack')
      const toast = stackNode && stackNode.children.find((c) => c.props && c.props.id === 'toast-1')
      if (!toast) throw new Error('toast not minted into the stack')
      const dismiss = findNodeInGraph(main.sup, 'toast-dismiss')
      await main.interact(() => dispatchEvent(dismiss, main.ctx, 'click'))
      if (countEmitted(main, 'toast') !== 0) throw new Error('toast still rendered after dismiss')
      if (!findInMount(main.mountEl, 'toast-stack')) throw new Error('the stack lost its slot')
      if (!toast.destroyed) throw new Error('toast node not destroyed')
      if (!main.sup.getNode(toast.id)) throw new Error('toast unresolvable via getNode')
    })

    // ---- Scenario 10 — multi-handler node ------------------------------------
    await runner.check('S10: the page-load load-dispatch on the multi-handler node → content "loaded"', () => {
      const panel = findInMount(main.mountEl, 'multi-panel')
      if (!panel || ownText(panel) !== 'loaded') throw new Error(`text=${JSON.stringify(panel ? ownText(panel) : 'missing')}`)
    })
    await runner.check('S10: click on the SAME node → touched class added AND the load effect survives (append-with-override)', async () => {
      const panelNode = findNodeInGraph(main.sup, 'multi-panel')
      await main.interact(() => dispatchEvent(panelNode, main.ctx, 'click'))
      const el = findInMount(main.mountEl, 'multi-panel')
      if (!classesOf(el).includes('touched')) throw new Error(`classes=${classesOf(el).join(',')}`)
      if (ownText(el) !== 'loaded') throw new Error(`load effect lost: ${JSON.stringify(ownText(el))}`)
    })
    await runner.check('S10: node.handlers carries BOTH entries (load + click coexist)', () => {
      const panelNode = findNodeInGraph(main.sup, 'multi-panel')
      const events = (panelNode.handlers ?? []).map((h) => h.event)
      if (!events.includes('load') || !events.includes('click')) {
        throw new Error(`events=${JSON.stringify(events)}`)
      }
    })

    // ---- envelope hygiene -----------------------------------------------------
    await runner.check('main envelope: zero K4 warnings on the translate channel', () => {
      if (main.translated.warnings.length !== 0) throw new Error(JSON.stringify(main.translated.warnings))
    })

    // the checks' wall time includes the interact flush windows (measured in
    // flushMs) — subtract them so the buckets never overlap
    PROFILE.checksMs = (now() - checksT0) - (PROFILE.flushMs - flushAtChecksStart)

    runner.summary('handlers-scenarios')

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.phaseMs + PROFILE.flushMs + PROFILE.emitMs +
      PROFILE.diffMs + PROFILE.applyMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[handlers-scenarios:profile] mounts=3 renderCount=${PROFILE.renderCount} compileCalls=${PROFILE.compileCalls} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms phase=${f(PROFILE.phaseMs)}ms flush=${f(PROFILE.flushMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} ` +
      `destroyed=${PROFILE.destroyed} prototypes=${PROFILE.prototypes} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__handlersScenariosProfile = PROFILE
  }

  globalThis.__handlersScenariosDone = main().catch((e) => {
    console.error('handlers-scenarios failed:', e)
    runner.summary('handlers-scenarios')
  })
}
