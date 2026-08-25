/**
 * rows-blind-test — LEGACY envelope data ONLY (the blind-test writer artifact).
 *
 * Exercises:
 *  - Feature 1: hooks array injection (rows-mint, fan-out census, linearity pin)
 *  - Feature 1a: def-prototype round-trip (serialize → loadState →
 *    reRegisterDefPrototypes → host re-mint)
 *
 * Blind-test writer rules: NO page-side feature logic exists; all mutation
 * logic lives in function-STRING handler bodies. Core-only imports from
 * dist/core/*. The census data is embedded in server-data by the builder
 * (the writer does NOT write the builder).
 */

/** The 5 product rows — natural fields only; no identifier column. */
export const ROWS_BLIND_TEST_ROWS = [
  { name: 'Alpha', price: '10.00', stock: '3' },
  { name: 'Beta', price: '25.50', stock: '8' },
  { name: 'Gamma', price: '7.25', stock: '15' },
  { name: 'Delta', price: '55.00', stock: '1' },
  { name: 'Epsilon', price: '3.99', stock: '42' },
]

/** The rows-mint DRIVE body (function-STRING data — legacy `(event, context)`
 *  arg order, handlers.md §6). Walks from the clicked control's NodeView up
 *  to the `.rows-list` container, resolves the live node through the
 *  context's real-supervisor passthrough, and applies the rows-mint op with
 *  the rows embedded at authoring time. */
const MINT_ROWS_BODY = `function (event, context) {
  var view = event.target;
  while (view && (!view.css || !view.css.classes || view.css.classes.indexOf('rows-list') === -1)) {
    view = view.parent;
  }
  if (!view) return;
  var target = context.supervisor ? context.supervisor.getNode(view.id) : null;
  if (!target) return;
  context.clientAPI.apply(target.id, {
    kind: 'rows-mint',
    target: target,
    hookName: 'product-list',
    mintKind: 'component',
    prototypeName: 'product-card',
    sourceName: 'rows-blind-test-mint',
    rows: ${JSON.stringify(ROWS_BLIND_TEST_ROWS)}
  });
}`

/** The ONE legacy envelope (keyed `main`). Tree shape:
 *
 *    #root
 *    └── .consumers-section
 *        └── #consumer-name    target 'name'
 *            └── #consumer-price   target 'props.price'
 *                └── #consumer-stock   target 'props.stock'
 *                    └── #rows-list    hooks + hooksKind; the rows-mint target
 *                        └── #mint-btn     handlers.click → MintRows
 *
 * Consumers are nested as ANCESTORS of the rows list so the compile fan-out
 * resolves N provider anchors per consumer (Feature 1.4 linearity pin). */
export function rowsBlindTestEnvelope() {
  return {
    template: {
      root: {
        type: 'div',
        props: { id: 'root' },
        children: [
          {
            type: 'section',
            props: { id: 'consumers-section' },
            css: { classes: ['consumers-section'] },
            children: [
              {
                type: 'div',
                props: { id: 'consumer-name' },
                css: { classes: ['consumer', 'consumer-name'] },
                content: 'name:',
                component: [{ reference: 'name' }],
                derived: { props: { name: { $: 'bindings.name' } } },
                children: [
                  {
                    type: 'div',
                    props: { id: 'consumer-price' },
                    css: { classes: ['consumer', 'consumer-price'] },
                    content: 'price:',
                    component: [{ reference: 'price', target: 'props.price' }],
                    children: [
                      {
                        type: 'div',
                        props: { id: 'consumer-stock' },
                        css: { classes: ['consumer', 'consumer-stock'] },
                        content: 'stock:',
                        component: [{ reference: 'stock', target: 'props.stock' }],
                        children: [
                          {
                            type: 'section',
                            props: { id: 'rows-list' },
                            css: { classes: ['rows-list'] },
                            hooks: ['product-list'],
                            hooksKind: { 'product-list': 'component' },
                            content: 'Rows appear here after the mint.',
                            children: [
                              {
                                type: 'button',
                                props: { id: 'mint-btn' },
                                css: { classes: ['mint-btn'] },
                                content: 'Mint 5 product rows',
                                component: [{ target: 'handlers.click', reference: 'MintRows' }],
                              },
                            ],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
      component: [
        {
          reference: 'product-card',
          value: {
            type: 'li',
            children: [
              { type: 'span', css: { classes: ['product-row'] }, content: 'product' },
            ],
          },
        },
        { reference: 'MintRows', value: { name: 'MintRows', body: MINT_ROWS_BODY } },
      ],
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

export function rowsBlindTestEnvelopes() {
  return { main: rowsBlindTestEnvelope() }
}
