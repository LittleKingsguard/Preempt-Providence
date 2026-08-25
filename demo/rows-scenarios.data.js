/**
 * rows-scenarios — LEGACY envelope data ONLY (the Feature 1/1.5 demo gate,
 * docs/next-feature-batch-0.2.0.md §Feature 1.5 — the hooks-array rows demo).
 *
 * The page input is ONE legacy JSON envelope (translate.md §1
 * LegacyInitialData): a root + a consumers section, the `hooksKind`
 * declaration (`product-list: 'component'` — the row hook), N=8 product rows
 * (natural fields `name`/`price`/`stock` — NO `id`/`key` field), the
 * registered prototype (a def-shaped `template.component` value consumed by
 * the rows-mint op BY NAME), and CROSS-ROW consumers (nodes whose component
 * bindings reference the row field names, so the compile fan-out exercises
 * all N provider anchors). The rows-mint drive is a CONTROL (a button, the
 * handlers-scenarios pattern) whose function-STRING body calls
 * `clientAPI.apply` with the rows-mint op — the rows data is embedded in the
 * body string at authoring time.
 *
 * Blind-test writer rules: NO page-side feature logic exists for any
 * scenario; a use case needing an outside script/function is a
 * data-authoring mistake. All mutation logic lives in the string bodies.
 */

/** The 8 product rows — the raw row data (the `rows` payload of the mint).
 *  Natural fields only; no identifier column (Feature 1b's keyField is a
 *  later feature). Shared by the envelope's MintRows body (embedded into the
 *  function-STRING at authoring time) and by the builder/page pipeline. */
export const ROWS_SCENARIOS_ROWS = [
  { name: 'Widget A', price: '12.00', stock: '4' },
  { name: 'Gadget B', price: '34.50', stock: '7' },
  { name: 'Doohickey C', price: '5.99', stock: '22' },
  { name: 'Thingamajig D', price: '89.00', stock: '2' },
  { name: 'Whatchamacallit E', price: '15.25', stock: '11' },
  { name: 'Gizmo F', price: '42.10', stock: '5' },
  { name: 'Contraption G', price: '7.75', stock: '30' },
  { name: 'Apparatus H', price: '99.99', stock: '1' },
]

/** The rows-mint DRIVE body (function-STRING data — the seam default
 *  `(event, context)` arg order, handlers.md §6). Walks from the clicked
 *  control's NodeView up to the `.rows-list` container, resolves the LIVE
 *  node through the context's real-supervisor passthrough (legacy-handlers
 *  §5.2 — `context.supervisor` is the REAL Supervisor with only userData
 *  adapted), and applies the rows-mint op with the rows embedded.
 *
 *  DATA-FIX NOTE (the op's target surface): `clientAPI.apply(nodeRef,
 *  mutation)` resolves string refs ONLY for `to`/`source`/`container` and
 *  adds the node under `node` — the supervisor's rows-mint branch reads
 *  `op.target` as a LIVE Node, so the body passes the live node explicitly
 *  (the layer-apply bridge's `target: this.node` precedent, legacy-handlers
 *  :287-294). The body therefore reads the live node via the documented
 *  supervisor passthrough — a data-authoring shape, not page logic. */
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
    prototypeName: 'product-row',
    sourceName: 'rows-scenarios-mint',
    rows: ${JSON.stringify(ROWS_SCENARIOS_ROWS)}
  });
}`

/** The ONE legacy envelope (keyed `main`). Tree shape (the fan-out needs the
 *  consumers as ANCESTORS of the minted rows — fitReference's hit order is
 *  own → viable DESCENDANTS → viable ancestors, resolve.ts §2.5):
 *
 *    #rows-root
 *    └── .consumers-section
 *        └── #consumer-name    target 'name'  + authored derived name read
 *            └── #consumer-price   target 'props.price'  (K2-synthesized bake)
 *                └── #consumer-stock   target 'props.stock'  (K2-synthesized bake)
 *                    └── #rows-list    hooks + hooksKind; the rows-mint target
 *                        └── #mint-btn     handlers.click → MintRows (the drive)
 *
 * The consumers NEST so every consumer is an ANCESTOR of the minted rows
 * (the compile fan-out's hit order is own → viable DESCENDANTS → ancestors,
 * resolve.ts fitReference §2.5): the rows mint under #rows-list, which is a
 * descendant of ALL THREE consumers, so each consumer resolves N arms — the
 * multi-provider compile fan-out (§9.2 pin 6; Feature 1.4's pricing:
 * states-per-consumer = N, ratio 1.0, the 2× linearity tripwire asserted by
 * the checks).
 */
export function rowsScenariosEnvelope() {
  return {
    template: {
      root: {
        type: 'div',
        props: { id: 'rows-root' },
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
                                content: 'Mint 8 product rows',
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
        // the REGISTERED prototype — a def-shaped template.component value.
        // The rows-mint op resolves it BY NAME ('product-row' → the per-name
        // component Link's pre-minted def prototypes, ops.ts rowsMint). The
        // def carries DELIVERABLE children (no bind keys) so translate
        // pre-mints them (mintDefPrototypes); protos[0] supplies the minted
        // rows' type/css DEFAULTS (each row is pure field data — no type, no
        // css — so the prototype genuinely provides the row shape).
        {
          reference: 'product-row',
          value: {
            type: 'ul',
            children: [
              { type: 'li', css: { classes: ['product-row'] }, content: 'product' },
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

export function rowsScenariosEnvelopes() {
  return { main: rowsScenariosEnvelope() }
}