// Blind-test scenario data for docs/specs/landed-features-scenarios.md (2026-08-20).
// CSS-CLASSES seam + RETAINED-HANDLER-MAP + Supervisor.dispatchEvent (Phase A).
// AUTHORED BY THE BLIND-TEST WRITER from the docs ONLY (specs + skill docs;
// no implementation reading). Legacy JSON envelope input, handler bodies as
// function-STRING data, core-only page module surface.
//
// Envelope shape (translate.md §1): { template: { root, component? }, content: [],
//   clientConfig: { runInstantiation: true, runRendering: true } }.
// Providers are real `template.component` bindings { reference, value } (value-carrying =
// source anchor) — never a `metadata.sources` field. Handler defs register as
// `{ reference: 'Name', value: { name: 'Name', body: '<source>' } }` (handlers.md §6);
// seam-installed def bodies are legacy `function (event, context) { ... }` (wrapped by
// the bridge — event stub carries `value: args[0]`, `target: <NodeView>`).

// ---------------------------------------------------------------------------
// Handler body string constants (legacy format: (event, context))
// ---------------------------------------------------------------------------

var ONESHOT = 'function (event, context) {\n' +
  '  context.node.receiveNextState({ content: "clicked" });\n' +
  '  context.clientAPI.apply(context.node.id, { kind: "state-slice", mutation: [{ targetProp: "handlers", mode: "replace", value: [] }] });\n' +
  '  return 1;\n' +
  '}';

var GONE = 'function (event, context) {\n' +
  '  return 0;\n' +
  '}';

var DESTROY_ME = 'function (event, context) {\n' +
  '  var view = event.target;\n' +
  '  var victim = null;\n' +
  '  while (view && !victim) {\n' +
  '    victim = view.findNode({ classes: ["remove-me"] });\n' +
  '    view = view.parent;\n' +
  '  }\n' +
  '  if (victim) { context.clientAPI.apply(victim.id, { kind: "destroy" }); }\n' +
  '  return 1;\n' +
  '}';

var SAY_HI = 'function (event, context) {\n' +
  '  context.node.receiveNextState({ content: String(event.value == null ? "" : event.value) + "!" });\n' +
  '}';

var READ_ARMS = 'function (event, context) {\n' +
  '  context.node.receiveNextState({ props: { arms: String(context.states ? context.states.length : -1) } });\n' +
  '  return 1;\n' +
  '}';

var READ_ONLY = 'function (event, context) {\n' +
  '  var st = context.tree.getState(context.node.id);\n' +
  '  var resolved = context.node.resolved;\n' +
  '  return { read: true, states: st ? st.length : -1, resolvedCount: resolved ? resolved.length : -1 };\n' +
  '}';

var PANEL_TOUCH = 'function (event, context) {\n' +
  '  var n = (Number(context.node.content) || 0) + 1;\n' +
  '  context.node.receiveNextState({ content: String(n) });\n' +
  '  return n;\n' +
  '}';

var BUTTON_TOUCH = 'function (event, context) {\n' +
  '  var n = (Number(context.node.content) || 0) + 1;\n' +
  '  context.node.receiveNextState({ content: String(n) });\n' +
  '  return n;\n' +
  '}';

var SELF_CLICK = 'function (event, context) {\n' +
  '  var inner = context.supervisor.dispatchEvent(context.node.id, "click");\n' +
  '  context.node.receiveNextState({ props: { nestedLen: String(inner ? inner.length : -1) } });\n' +
  '  return 1;\n' +
  '}';

var FOCUS_CAPTURE = 'function (event, context) {\n' +
  '  context.node.receiveNextState({ props: { focus: "1" } });\n' +
  '  return "focus";\n' +
  '}';

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function baseEnvelope() {
  return {
    template: {
      root: { type: 'div', props: { id: 'root-session-features' }, children: [] }
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true }
  };
}

// ---------------------------------------------------------------------------
// Group 1 — css.classes injection seam (scenarios 1.1-1.5)
// ---------------------------------------------------------------------------

function badge() {
  var env = baseEnvelope();
  env.template.component = [{ reference: 'tone', value: 'is-primary' }];
  env.template.root.children.push({
    type: 'div',
    css: { classes: ['badge'] },
    props: { id: 'badge-el' },
    component: [{ reference: 'tone', target: 'css.classes' }],
    content: 'Badge'
  });
  return env;
}

function badgeArray() {
  var env = baseEnvelope();
  env.template.component = [{ reference: 'tone', value: ['is-primary', 'is-large'] }];
  env.template.root.children.push({
    type: 'div',
    css: { classes: ['badge'] },
    props: { id: 'badge-array-el' },
    component: [{ reference: 'tone', target: 'css.classes' }],
    content: 'Badge'
  });
  return env;
}

function badgeMissing() {
  var env = baseEnvelope();
  env.template.root.children.push({
    type: 'div',
    css: { classes: ['badge'] },
    props: { id: 'badge-missing-el' },
    component: [{ reference: 'missing-tone', target: 'css.classes' }],
    content: 'Badge'
  });
  return env;
}

function blocked() {
  var env = baseEnvelope();
  env.template.component = [
    { reference: 'c', value: { classes: ['injected'] } },
    { reference: 'idSrc', value: 'injected-id' },
    { reference: 's', value: { background: 'red' } },
    { reference: 'sp', value: 'blue' }
  ];
  env.template.root.children.push({
    type: 'button',
    css: { classes: ['btn', 'blocked-btn'], style: 'color: green;' },
    props: { id: 'blocked-btn-el' },
    component: [
      { reference: 'c', target: 'css' },
      { reference: 'idSrc', target: 'css.id' },
      { reference: 's', target: 'css.style' },
      { reference: 'sp', target: 'css.style.color' }
    ],
    content: 'Blocked'
  });
  return env;
}

function roundtrip() {
  var env = baseEnvelope();
  env.template.component = [{ reference: 'tone', value: 'is-primary' }];
  env.template.root.children.push({
    type: 'div',
    css: { classes: ['badge'] },
    props: { id: 'badge-roundtrip-el' },
    component: [{ reference: 'tone', target: 'css.classes' }],
    content: 'Badge'
  });
  return env;
}

// ---------------------------------------------------------------------------
// Group 2 — retained-handler-map listener lifecycle (scenarios 2.1-2.2)
// ---------------------------------------------------------------------------

function selfRemove() {
  var env = baseEnvelope();
  env.template.component = [{ reference: 'OneShot', value: { name: 'OneShot', body: ONESHOT } }];
  env.template.root.children.push({
    type: 'button',
    props: { id: 'one-shot-btn' },
    component: [{ target: 'handlers.click', reference: 'OneShot' }],
    content: 'One-shot'
  });
  return env;
}

function removeEl() {
  var env = baseEnvelope();
  env.template.component = [
    { reference: 'Gone', value: { name: 'Gone', body: GONE } },
    { reference: 'DestroyMe', value: { name: 'DestroyMe', body: DESTROY_ME } }
  ];
  // BLIND-TEST FIX: the documented `destroy` op DISSOLVES the shared family
  // link (node.destroy → destroyLinks → linkOf(childAnchor).destroy()), which
  // orphans EVERY sibling on that link. The spec's original envelope put
  // remove-me AND the remove-trigger on ONE link, so destroying remove-me also
  // took out the trigger. Re-expressed: remove-me is the ONLY child of its
  // container; the remove-trigger is a SIBLING OF THE CONTAINER (not of
  // remove-me), so the destroy removes only remove-me and the page keeps the
  // trigger + panel (intended output).
  env.template.root.children.push(
    {
      type: 'div',
      props: { id: 'remove-panel' },
      children: [
        {
          type: 'button',
          css: { classes: ['remove-me'] },
          props: { id: 'remove-me-btn' },
          component: [{ target: 'handlers.click', reference: 'Gone' }],
          content: 'Remove me'
        }
      ]
    },
    {
      type: 'button',
      css: { classes: ['remove-trigger'] },
      props: { id: 'remove-trigger-btn' },
      component: [{ target: 'handlers.click', reference: 'DestroyMe' }],
      content: 'Destroy remove-me'
    }
  );
  return env;
}

// ---------------------------------------------------------------------------
// Group 3 — Supervisor.dispatchEvent engine entry (scenarios 3.1-3.6)
// ---------------------------------------------------------------------------

function sayhi() {
  var env = baseEnvelope();
  env.template.component = [{ reference: 'SayHi', value: { name: 'SayHi', body: SAY_HI } }];
  env.template.root.children.push({
    type: 'button',
    props: { id: 'sayhi-btn' },
    component: [{ target: 'handlers.click', reference: 'SayHi' }],
    content: 'Say hi'
  });
  return env;
}

function fork() {
  var env = baseEnvelope();
  env.template.component = [{ reference: 'ReadArms', value: { name: 'ReadArms', body: READ_ARMS } }];
  // BLIND-TEST FIX: a fork needs BOTH providers matched at EQUAL depth from the
  // consumer (the walk is own → descendants → ancestors with nearest-shadows-
  // far: nested providers collapse to ONE arm). Placing the two `color`
  // providers as DESCENDANTS of the display consumer (the phases.test.ts
  // pRed/pBlue pattern) yields the spec's 2-arm fork.
  env.template.root.children.push({
    type: 'div',
    css: { classes: ['display'] },
    props: { id: 'display-el' },
    component: [
      { reference: 'color', target: 'props.color' },
      { target: 'handlers.click', reference: 'ReadArms' }
    ],
    content: 'arms:',
    children: [
      { type: 'div', props: { id: 'src-red' }, component: [{ reference: 'color', value: 'red' }], content: 'red-src' },
      { type: 'div', props: { id: 'src-blue' }, component: [{ reference: 'color', value: 'blue' }], content: 'blue-src' }
    ]
  });
  return env;
}

function unknown() {
  var env = baseEnvelope();
  env.template.component = [
    { reference: 'SayHi', value: { name: 'SayHi', body: SAY_HI } },
    { reference: 'Gone', value: { name: 'Gone', body: GONE } }
  ];
  env.template.root.children.push(
    {
      type: 'button',
      props: { id: 'sayhi-btn-33' },
      component: [{ target: 'handlers.click', reference: 'SayHi' }],
      content: 'hi-33'
    },
    {
      type: 'button',
      props: { id: 'victim-btn' },
      component: [{ target: 'handlers.click', reference: 'Gone' }],
      content: 'victim'
    }
  );
  return env;
}

function readonly() {
  var env = baseEnvelope();
  env.template.component = [{ reference: 'ReadOnly', value: { name: 'ReadOnly', body: READ_ONLY } }];
  env.template.root.children.push({
    type: 'div',
    props: { id: 'readonly-el' },
    component: [{ target: 'handlers.click', reference: 'ReadOnly' }],
    content: 'read-only'
  });
  return env;
}

function noprop() {
  var env = baseEnvelope();
  env.template.component = [
    { reference: 'PanelTouch', value: { name: 'PanelTouch', body: PANEL_TOUCH } },
    { reference: 'ButtonTouch', value: { name: 'ButtonTouch', body: BUTTON_TOUCH } }
  ];
  env.template.root.children.push({
    type: 'div',
    props: { id: 'panel-el' },
    content: '0',
    component: [{ target: 'handlers.click', reference: 'PanelTouch' }],
    children: [
      {
        type: 'button',
        props: { id: 'child-btn' },
        content: '0',
        component: [{ target: 'handlers.click', reference: 'ButtonTouch' }]
      }
    ]
  });
  return env;
}

function reenter() {
  var env = baseEnvelope();
  env.template.component = [
    { reference: 'SelfClick', value: { name: 'SelfClick', body: SELF_CLICK } },
    { reference: 'FocusCapture', value: { name: 'FocusCapture', body: FOCUS_CAPTURE } }
  ];
  env.template.root.children.push({
    type: 'div',
    props: { id: 'reenter-el' },
    component: [
      { target: 'handlers.click', reference: 'SelfClick' },
      { target: 'handlers.focus', reference: 'FocusCapture' }
    ],
    content: 'reenter'
  });
  return env;
}

// ---------------------------------------------------------------------------
// Envelope map (keyed exactly as the landed-features-scenarios.md scenarios)
// ---------------------------------------------------------------------------

function sessionFeaturesEnvelopes() {
  return {
    badge: badge(),
    'badge-array': badgeArray(),
    'badge-missing': badgeMissing(),
    blocked: blocked(),
    roundtrip: roundtrip(),
    'self-remove': selfRemove(),
    'remove-el': removeEl(),
    sayhi: sayhi(),
    fork: fork(),
    unknown: unknown(),
    readonly: readonly(),
    noprop: noprop(),
    reenter: reenter()
  };
}

// ---------------------------------------------------------------------------
// Server data (placeholder census — a later builder recomputes it)
// ---------------------------------------------------------------------------

function sessionFeaturesServerData() {
  return {
    expected: {
      census: {
        registered: 0,
        inTree: 0,
        unplaced: 0,
        destroyed: 0,
        prototypes: 0,
        cloneOps: 0
      },
      mounts: 13
    },
    goals: [
      'group1-css-classes-seam',
      'group2-retained-handler-map-lifecycle',
      'group3-supervisor-dispatch-event'
    ]
  };
}

export {
  ONESHOT,
  GONE,
  DESTROY_ME,
  SAY_HI,
  READ_ARMS,
  READ_ONLY,
  PANEL_TOUCH,
  BUTTON_TOUCH,
  SELF_CLICK,
  FOCUS_CAPTURE,
  badge,
  badgeArray,
  badgeMissing,
  blocked,
  roundtrip,
  selfRemove,
  removeEl,
  sayhi,
  fork,
  unknown,
  readonly,
  noprop,
  reenter,
  sessionFeaturesEnvelopes,
  sessionFeaturesServerData
};