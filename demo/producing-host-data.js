// producing-host-data.js — Blind-test scenario data for
// docs/specs/landed-features-scenarios.md Group 4 (REQ-GAP-8).
// AUTHORED BY THE BLIND-TEST WRITER from the docs ONLY (specs + skill docs;
// no implementation reading). Legacy JSON envelope input, handler bodies as
// function-STRING data, core-only page module surface.
//
// Envelope shape (translate.md §1): { template: { root, component? }, content: [],
//   clientConfig: { runInstantiation: true, runRendering: true } }.
// Providers are real `template.component` bindings { reference, value } (value-carrying =
// source anchor) — never a `metadata.sources` field.

// ---------------------------------------------------------------------------
// Handler body string constants (legacy format: (event, context))
// ---------------------------------------------------------------------------

var CLICK_CONTENT = 'function (event, context) {\n' +
  '  context.node.receiveNextState({ content: "clicked" });\n' +
  '}';

var CLICK_CHILD_CONTENT = 'function (event, context) {\n' +
  '  context.node.receiveNextState({ content: "clicked-child" });\n' +
  '}';

// ---------------------------------------------------------------------------
// Envelope helpers
// ---------------------------------------------------------------------------

function baseEnvelope() {
  return {
    template: {
      root: { type: 'div', props: { id: 'root-producing-host' }, children: [] }
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true }
  };
}

// ---------------------------------------------------------------------------
// S4.1 + S4.2: OPT-IN threading (two-node page)
// ---------------------------------------------------------------------------

function twoNode() {
  var env = baseEnvelope();
  env.template.root.children.push(
    { type: 'div', props: { id: 'host-div' }, content: 'host' },
    { type: 'span', props: { id: 'sibling-span' }, content: 'sibling' }
  );
  return env;
}

// ---------------------------------------------------------------------------
// S4.3: prevMap chain (button with click handler)
// ---------------------------------------------------------------------------

function chain() {
  var env = baseEnvelope();
  env.template.component = [
    { reference: 'ClickContent', value: { name: 'ClickContent', body: CLICK_CONTENT } }
  ];
  env.template.root.children.push(
    { type: 'div', props: { id: 'host-div-chain' }, content: 'host' },
    {
      type: 'button',
      props: { id: 'chain-btn' },
      component: [{ target: 'handlers.click', reference: 'ClickContent' }],
      content: 'press me'
    }
  );
  return env;
}

// ---------------------------------------------------------------------------
// S4.4: destroy-prune (two nodes, one destroyed mid-flow)
// ---------------------------------------------------------------------------

function prune() {
  var env = baseEnvelope();
  env.template.component = [
    { reference: 'ClickChildContent', value: { name: 'ClickChildContent', body: CLICK_CHILD_CONTENT } }
  ];
  env.template.root.children.push(
    { type: 'div', props: { id: 'host-div-prune' }, content: 'host' },
    {
      type: 'div',
      props: { id: 'prune-panel' },
      children: [
        {
          type: 'span',
          css: { classes: ['kill-me'] },
          props: { id: 'victim-span' },
          content: 'victim'
        }
      ]
    }
  );
  return env;
}

// ---------------------------------------------------------------------------
// Envelope map (keyed exactly as the landed-features-scenarios.md Group 4)
// ---------------------------------------------------------------------------

function producingHostEnvelopes() {
  return {
    twoNode: twoNode(),
    chain: chain(),
    prune: prune()
  };
}

// ---------------------------------------------------------------------------
// Server data (placeholder census — the builder recomputes it)
// ---------------------------------------------------------------------------

function producingHostServerData() {
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
      mounts: 5
    },
    goals: [
      'S4.1 opt-in threading: data-node-id on every emitted element, real nodeById key',
      'S4.2 default off: no data-node-id, byte-identical render',
      'S4.3 prevMap chain: incremental re-render keeps stamping, zero-op on no change',
      'S4.4 destroy-prune: destroyed wire removed, never re-created; survivors keep stamp',
      'controls: barrel export identity; op stream == adapter call log'
    ]
  };
}

export {
  CLICK_CONTENT,
  CLICK_CHILD_CONTENT,
  twoNode,
  chain,
  prune,
  producingHostEnvelopes,
  producingHostServerData
};
