# Use Case — Interleaving Placement Zones and Native Children in One Node's Body

- **Status:** **CONFIRMED WORKING (2026-08-31).** Verified by direct probe against
  the engine (provident-ssr 0.3.2). This document explains the configuration that
  lets a single node's rendered body interleave **plain text**, **native (family)
  child elements**, and **placement-routed content** in one ordered run.
- **Applies to:** provident-ssr 0.3.0+ (`bodyRuns`), 0.3.1 (authored-id child-ref
  resolution), 0.3.2 (def-fill/component-prototype `bodyRuns`).
- **Related specs:** `docs/specs/eng-inline-order.md` (the `bodyRuns` capability),
  `docs/specs/placement-path-spec.md` (placement zones), `docs/specs/
  eng-bodyruns-wire-ref-pathstate-review.md` (the def-fill/placement emit fix).

---

## 1. The capability

A node's rendered body is normally `escapeText(content) + children` — the node's
own text ALWAYS precedes its child elements, with no interleaving. The `bodyRuns`
field (an additive, opt-in `BodyRun[]`) overrides that: the body becomes an
**ordered run of segments**, each either a plain-text span (`{ text }`) or a child
element reference (`{ child: <id> }`), rendered in document order.

The key fact this use case demonstrates: **a placement content root that is a
child of the container CAN be interleaved with native children and text** — because
both land in the same `childOrder` (`pathChildrenFor`, node.ts:249-267 builds
family children first, then placement content roots).

---

## 2. The configuration

A container node that:
1. **Offers a placement zone** (`placementName`),
2. **Has native (family) children**,
3. **Carries `bodyRuns`** interleaving text with both,
4. **Receives placement content** into its zone.

```jsonc
{
  "template": {
    "root": {
      "type": "div",
      "placement": [{ "placementName": "zone-main" }],   // (1) offers the zone
      "content": "start",
      "bodyRuns": [                                       // (3) interleaved body
        { "text": "A " },
        { "child": "native-1" },                          // native family child
        { "text": " B " },
        { "child": "placed-1" },                          // placement content root
        { "text": " C" }
      ],
      "children": [                                       // (2) native children
        { "type": "span", "content": "native", "props": { "id": "native-1" } }
      ]
    }
  },
  "content": [
    { "content": [                                       // (4) placed content
      { "type": "em", "content": "placed",
        "props": { "id": "placed-1" },
        "placement": [{ "targetPlacement": ["zone-main"] }] }
    ] }
  ],
  "clientConfig": {}
}
```

### The four roles

| Role | Field | Meaning |
| --- | --- | --- |
| Zone producer (container) | `placement: [{ placementName: 'zone-main' }]` | this node OFFERS the drop-zone `zone-main` |
| Native child | `children: [{ type, content, props.id }]` | a family child of the container |
| Placed content | `placement: [{ targetPlacement: ['zone-main'] }]` | a content root routed INTO `zone-main` |
| Interleaved body | `bodyRuns: [{text}|{child}]` | the ordered run of text + child refs |

---

## 3. What the engine produces

**Emit** — the container's `childOrder` includes BOTH the native span and the
placed em, and the run-encoded text resolves both `{ child }` refs to their real
wires:

```
childOrder = ["root/node-2", "root/node-3"]
text (decoded) = [{text:'A '},{child:'root/node-2'},{text:' B '},{child:'root/node-3'},{text:' C'}]
```

**SSR render:**

```html
A <span id="native-1">native</span> B <em id="placed-1">placed</em> C
```

The DOM adapter produces the same ordered content (text nodes + child elements
interleaved in document order).

---

## 4. Why it works

- **`pathChildrenFor`** (`node.ts:249-267`) builds a path-state's children as
  **family children first, then placement content roots** (the `container`
  anchor's `content`-role owners). Both land in the same `childOrder`.
- **`bodyRuns` child refs resolve by authored `props.id`** to the child's real
  wire at emit time (0.3.1 `resolveBodyRunsChildWires` + the 0.3.2 global
  `authoredIdToWire` index). A `{ child: 'native-1' }` or `{ child: 'placed-1' }`
  resolves to `root/node-2` / `root/node-3` respectively.
- **The adapters** decode the run-encoded string and interleave text + child
  elements in order (SSR `contentHtml`, DOM `setProp('text')` full rebuild).

---

## 5. The boundary (what is NOT supported)

The interleaving works when the placed content is a **child of the same
container** (placed into the container's own zone). It does NOT support a
`bodyRuns` run referencing a placement content root that is a **sibling in a
DIFFERENT zone** — that is a foreign element not in the container's `childOrder`,
and the run is dropped (documented limitation, `eng-bodyruns-wire-ref-pathstate-
review.md` §2/§6).

| Case | Supported? |
| --- | --- |
| Text + native child + placed-into-own-zone content, interleaved | **Yes** (this use case) |
| Text + native child only | Yes (0.3.0) |
| Text + def-fill / component-prototype child | Yes (0.3.2) |
| Text + a placement content root in a DIFFERENT zone (foreign sibling) | No — dropped |

---

## 5b. Alternative: `<span>`/`text` child for "text after" (no `bodyRuns`)

For the trivial case of placing literal text **beside** children (text after the
parent's own content), a `<span>` child in `children[]` works without `bodyRuns`:

```jsonc
{ "type": "div", "content": "Title ",
  "children": [ { "type": "span", "content": "inline note", "props": { "id": "t1" } } ] }
```

renders `Title <span id="t1">inline note</span>`.

> **Limitation (per the 2026-08-31 gate, `docs/specs/content-xor-children-review.md`):**
> a `<span>`/`text`-node child can express text **only after** the parent's own
> content — it cannot interleave text **between** children (e.g. the
> `Some <strong>bold</strong> text` case where text precedes AND follows a child).
> That mid-line case requires `bodyRuns`. There is no wire-less bare-text node
> (every element gets a wrapper); a `text` type renders `<text>`, not bare text.

## 6. Consumer note (Astrographer)

Astrographer's `buildSubtree` (`src/main/traversal.ts`) emits inline children as
**family children** of a placement-routed content root — which is exactly the
supported shape above. Its re-expression of `bodyRuns` (the ENG-INLINE-ORDER
follow-up) can interleave text with those inline children, and with any
placement content routed into the same zone, in one ordered run.
