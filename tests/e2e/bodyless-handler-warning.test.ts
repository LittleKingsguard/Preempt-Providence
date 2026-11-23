/**
 * `HANDLER-BODYLESS-SILENT-DEAD` (`docs/defects.md`, row of that name) — RED
 * FIRST (AGENTS.md item 8): this file is written against the 0.5.2 tree, with
 * NO `src/**` change accompanying it.
 *
 * THE DEFECT (three sites, all verified in the row):
 *  (1) ADMISSION — the K8 NP11 guard fires only when a body is PRESENT and
 *      wrong (`src/core/translate.ts:378-383`:
 *      `h.body !== undefined && typeof h.body !== 'function' && typeof h.body !== 'string'`),
 *      so a handler with an `event`/`phase` and NO body at all passes
 *      untouched and is spread verbatim onto the node's base
 *      (`translate.ts:429-434`; `docs/specs/translate.md:289` — unknown extra
 *      fields are "ignored, never rejected").
 *  (2) DISPATCH — the body-less entry is skipped silently
 *      (`if (typeof handler.body !== 'function') continue`,
 *      `src/core/handlers.ts:102` event / `:118` phase; pin H-H3
 *      `docs/specs/handlers.md:210`).
 *  (3) EMIT — it is STILL published as a live-looking listener: emit sets
 *      `props['on:'+h.event] = true` for ANY handler object with a string
 *      `event`, with no body check (`src/core/render-helpers.ts:1522-1527`).
 *  So the package advertises an interactive element that can never run, and
 *  every channel (op result, compile `dropped`, `warnings`, journal) is
 *  silent. The row's own "observable lie".
 *
 * THE RULED SHAPE (gate `docs/specs/handoffs-review-11.md` §4.2 row R-2b +
 * §8 P-7; `docs/pending.md` Q7): a TRANSLATE-TIME CONTAINMENT WARN — a new
 * code in the `handler-body-invalid` family, `handler-body-missing` — that
 * **warns and KEEPS** (never rejects: the shape is tolerated today, so
 * rejecting would be breaking) and does **NOT** filter emit (filtering is a
 * behaviour change; the warn makes the existing behaviour honest — §7 pin 10
 * of the gate record). Every case below therefore asserts the OBSERVABILITY
 * of the existing behaviour, never a change to it:
 *  - the handler entry survives translate verbatim (warn + keep),
 *  - the element still emits and still carries `on:<event>` (emit unfiltered),
 *  - dispatch still returns `[]` for it (H-H3 — pinned, not changed here).
 *
 * CHANNEL (the existing family's): every translate warning goes through ONE
 * helper (`translate.ts:227-232` `warn()`), which BOTH pushes `{code, path}`
 * onto `TranslatedTree.warnings` AND `console.warn`s
 * `[legacy-translate] <code> at <path>: <detail>`. The family's path
 * convention is the tree position (`root.handlers[0]`,
 * `root.children[0].handlers[1]` — `TranslatedWarning.path`'s own doc,
 * `translate.ts:87-92`; cf. `tests/unit/translate.test.ts:628`, `:645`).
 * Both halves are asserted here: the row's complaint is that the channels are
 * silent, so a fix that reaches only one of them is half a fix.
 *
 * WHAT IS RED TODAY (against the 0.5.2 engine):
 *  - **BM-1** `{name, event}` with no body → ZERO warnings today (owed: one
 *    `handler-body-missing` at `root.handlers[0]`).
 *  - **BM-2** `{name, event, ref:'x'}` (the shape the downstream proposed) →
 *    ZERO warnings today (owed: the same one). This is the proof that a
 *    key-based seam must DIAGNOSE the shape before it can carry a key.
 *  - **BM-7** two body-less handlers on one node → ZERO today (owed: one
 *    warning EACH, `root.handlers[0]` + `root.handlers[1]` — the warn is per
 *    handler ENTRY, no collapsing, no noise).
 * WHAT IS GREEN TODAY AND MUST STAY GREEN (the controls):
 *  - **BM-3** a string body, **BM-4** an in-process function body → no warn.
 *  - **BM-5** a def-shaped `handlers.<event>` binding (the auth/component
 *    seam) → no warn: the seam resolves the body from the def registry, so
 *    the shape is legitimate. SEE THE BM-5 COMMENT for what the seam code
 *    actually does — the finding is important and is reported with this file.
 *  - **BM-6** a `format`-only handler → RECORD ONLY: the disposition is
 *    UNDOCUMENTED (see the case comment); no rule is invented here.
 *
 * FIXTURE DISCIPLINE: every case builds its own tree through
 * `translateLegacy` (node ids are minted from a module counter), and every
 * case installs its own `console.warn` spy so a case can never inherit
 * another's calls. `vi.restoreAllMocks()` runs in `afterEach`.
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest'
import {
  translateLegacy,
  type LegacyHandlerDef,
  type LegacyInitialData,
  type TranslatedTree,
} from '../../src/core/translate.js'
import type { Node } from '../../src/core/node.js'
import { Supervisor } from '../../src/core/supervisor.js'
import { emitElements } from '../../src/core/render-helpers.js'

afterEach(() => {
  vi.restoreAllMocks()
})

/** The owed code. It must sit in the `handler-body-invalid` family name space
 *  (the defect row's wording) — a sibling, never a replacement: the present-
 *  and-wrong cases keep `handler-body-invalid` / `handler-body-eval-blocked`. */
const MISSING = 'handler-body-missing'

// ===========================================================================
// helpers
// ===========================================================================

/** The `console.warn` calls' text, one string per call — the family's calls
 *  are single-argument template strings today, but flattening keeps this
 *  helper correct if a future call passes several parts. */
function warnTexts(spy: MockInstance<typeof console.warn>): string[] {
  return spy.mock.calls.map((args) => args.map((a) => String(a)).join(' '))
}

function warnsNaming(spy: MockInstance<typeof console.warn>, code: string): string[] {
  return warnTexts(spy).filter((t) => t.includes(code))
}

/** The `handler-body-missing` entries pushed onto the tree's warning channel. */
function missing(t: TranslatedTree) {
  return t.warnings.filter((w) => w.code === MISSING)
}

/** The node's COMPILED handler entries, viewed field-by-field. */
interface CompiledHandlerView {
  name?: string
  event?: string
  phase?: string
  format?: string
  body?: unknown
  ref?: string
}
function compiledHandlers(node: Node): CompiledHandlerView[] {
  return (node.handlers ?? []) as CompiledHandlerView[]
}

/** family compile of the whole tree → the emitted element set (the real node
 *  map is passed so emit sees the compiled handlers and publishes `on:*`). */
function renderTree(t: TranslatedTree): { els: ReturnType<typeof emitElements> } {
  const cr = t.root.compile(t.nodes)
  const nodeById = new Map<string, Node>(t.nodes.map((n) => [n.id, n]))
  return { els: emitElements(cr.actionable, nodeById) }
}

function onPropKeys(el: { props?: Record<string, unknown> }): string[] {
  return Object.keys(el.props ?? {}).filter((k) => k.startsWith('on:'))
}

// ===========================================================================
// BM-1 — the owed warn: `{name, event}` with NO body
// ===========================================================================

describe('HANDLER-BODYLESS-SILENT-DEAD — the body-less handler is diagnosed at translate (warn + keep)', () => {
  it('BM-1 `{name, event}` with no body: exactly ONE `handler-body-missing` warning, the handler is KEPT, the element still emits and still publishes `on:click`', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const env: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          content: 'Save',
          handlers: [{ name: 'save', event: 'click' }],
        },
      },
      content: [],
    }
    const t = translateLegacy(env)

    // (a) THE OWED DIAGNOSTIC — one entry, on the family's path convention.
    const hits = missing(t)
    expect(
      hits,
      `translateLegacy reported ${hits.length} "${MISSING}" warning(s) for a handler authored as ` +
        `{name:'save', event:'click'} with NO body: the K8 NP11 guard only fires when a body is ` +
        `PRESENT and wrong (translate.ts:378-383, \`h.body !== undefined && …\`), so this shape passes ` +
        `admission untouched and is spread verbatim onto the node base (translate.ts:429-434), is ` +
        `silently skipped at dispatch (handlers.ts:102, H-H3) and is STILL emitted as a live-looking ` +
        `listener (render-helpers.ts:1522-1527) — an element the package advertises as interactive ` +
        `that can never run, with no warning anywhere (HANDLER-BODYLESS-SILENT-DEAD).`,
    ).toHaveLength(1)
    expect(
      hits[0]!.path,
      `the "${MISSING}" warning must name the handler ENTRY's tree position (the ` +
        `handler-body-invalid family convention — 'root.handlers[0]', TranslatedWarning.path's own doc)`,
    ).toBe('root.handlers[0]')
    expect(
      t.warnings.map((w) => w.code),
      `the body-less handler raised warnings OTHER than the owed one: ${JSON.stringify(t.warnings)} — ` +
        `this arm authors nothing else warnable, so the diagnostic must be exactly the one entry`,
    ).toEqual([MISSING])

    // (b) THE SECOND HALF OF THE FAMILY'S CHANNEL — console.warn.
    const consoleHits = warnsNaming(warn, MISSING)
    expect(
      consoleHits,
      `console.warn was called ${consoleHits.length} time(s) naming "${MISSING}": every translate ` +
        `warning goes through the ONE helper (translate.ts:227-232 warn(), which pushes the channel ` +
        `entry AND console.warn\`s \`[legacy-translate] <code> at <path>: <detail>\`), so a diagnostic ` +
        `that never reaches this channel leaves the host that reads stderr deaf. Calls measured: ` +
        JSON.stringify(warnTexts(warn)),
    ).toHaveLength(1)
    expect(consoleHits[0], 'the warned text must name the diagnostic code').toContain(MISSING)

    // (c) WARN + KEEP, never reject — the ruled shape (R-2b): rejecting this
    // shape would break envelopes that ship today.
    const kept = compiledHandlers(t.root)
    expect(
      kept.map((h) => h.name),
      'the body-less handler was REMOVED by translate: the ruled shape is warn + KEEP (never reject — ' +
        'the shape is tolerated in 0.5.2, so rejecting is a breaking change)',
    ).toEqual(['save'])
    expect(
      kept[0]!.event,
      'the kept handler lost its `event` field — the keep half must preserve the entry verbatim',
    ).toBe('click')

    // (d) NO BEHAVIOUR CHANGE: the node still compiles and renders, and emit
    // still publishes `on:<event>` (gate §7 pin 10 — filtering at emit is a
    // behaviour change; the warn makes the existing behaviour honest).
    const { els } = renderTree(t)
    const el = els.find((e) => e.props?.['text'] === 'Save')
    expect(
      el,
      'FIXTURE: the authored root must still emit an element (a translate-time warn must not stop ' +
        'the node compiling or rendering)',
    ).toBeDefined()
    expect(
      el!.props?.['on:click'],
      'emit STOPPED publishing `on:click` for a body-less handler: the gate explicitly forbids ' +
        'filtering at emit (render-helpers.ts:1522-1527 is unchanged by R-2b) — the warn makes the ' +
        'already-published listener honest, it does not withdraw it',
    ).toBe(true)

    // (e) the pinned DEADNESS the warn exists to make honest (H-H3, handlers.ts:102).
    const sup = new Supervisor({})
    sup.registerNode(t.root)
    expect(
      sup.dispatchEvent(t.root.id, 'click'),
      'dispatch of the body-less handler must stay the H-H3 silent skip ([]): this case pins the ' +
        'observability of that deadness, never a change to dispatch',
    ).toEqual([])
  })

  // =========================================================================
  // BM-2 — the downstream's proposed key shape: `{name, event, ref:'x'}`
  // =========================================================================

  it('BM-2 `{name, event, ref:\'x\'}` (the proposed key shape): the SAME single warning today, and the `ref` key survives verbatim — a key-based seam must diagnose the shape BEFORE it can carry a key', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    // `ref` is not a legacy field (`translate.md:289`: unknown extra fields are
    // ignored, never rejected) — the cast is the fixture's, not a type hole in
    // the surface under test.
    const withRef = { name: 'save', event: 'click', ref: 'x' } as unknown as LegacyHandlerDef
    const env: LegacyInitialData = {
      template: { root: { type: 'div', content: 'Save', handlers: [withRef] } },
      content: [],
    }
    const t = translateLegacy(env)

    const hits = missing(t)
    expect(
      hits,
      `translateLegacy reported ${hits.length} "${MISSING}" warning(s) for {name:'save', event:'click', ` +
        `ref:'x'}: the \`ref\` key changes NOTHING at admission today (translate.ts:378-383 tests the ` +
        `BODY, and an absent body is invisible to the guard), so the shape the downstream proposed for ` +
        `the handler seam is exactly as silent as its body-less twin. The warn is the proof that a ` +
        `key-based seam must diagnose this shape BEFORE a key can be carried (handoffs-review-11 §4.2(iii)).`,
    ).toHaveLength(1)
    expect(hits[0]!.path, 'the warning must name the handler entry position').toBe('root.handlers[0]')
    expect(
      t.warnings.map((w) => w.code),
      `the \`ref\` key produced a warning of its own: ${JSON.stringify(t.warnings)} — the ruled shape is ` +
        `ONE diagnostic in the handler-body-invalid family (the field itself is tolerated, ` +
        `translate.md:289), never a second \`handler-ref-*\` code`,
    ).toEqual([MISSING])
    expect(
      warnsNaming(warn, MISSING),
      `console.warn never named "${MISSING}" for the \`ref\` shape. Calls measured: ` +
        JSON.stringify(warnTexts(warn)),
    ).toHaveLength(1)

    // the KEY IS CARRIED TODAY — that is precisely the hazard the warn guards:
    // nothing resolves it, yet nothing rejects it either.
    const kept = compiledHandlers(t.root)
    expect(
      kept[0]?.ref,
      'the tolerated `ref` key did not survive translate verbatim onto the compiled handler — today ' +
        'it is carried and IGNORED (no resolver exists), which is why the warn may not be replaced by ' +
        'a rejection of the field',
    ).toBe('x')
    expect(
      kept[0]?.body,
      'FIXTURE: this shape carries no resolvable body — the `ref` key resolves nothing at translate',
    ).toBeUndefined()
  })

  // =========================================================================
  // BM-3 / BM-4 — CONTROLS: a real body must never be diagnosed
  // =========================================================================

  it('BM-3 CONTROL a STRING body: NO warning (the body is instantiated at translate — the legitimate shape)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const env: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          content: 'Save',
          handlers: [{ name: 'save', event: 'click', body: 'function (ctx) { return 1 }' }],
        },
      },
      content: [],
    }
    const t = translateLegacy(env)

    expect(
      missing(t),
      `a handler WITH a function-source body was diagnosed "${MISSING}": the warn must key on a MISSING ` +
        `body, never on a body it merely fails to recognise`,
    ).toHaveLength(0)
    expect(
      t.warnings,
      `the string-body control raised a warning of any kind: ${JSON.stringify(t.warnings)}`,
    ).toEqual([])
    expect(
      warnsNaming(warn, MISSING),
      `console.warn named "${MISSING}" for a handler that HAS a body. Calls measured: ` +
        JSON.stringify(warnTexts(warn)),
    ).toHaveLength(0)
    // the control's TEETH: the string body really was instantiated (a vacuous
    // "no body" reading is what the warn must not confuse itself with).
    expect(
      typeof compiledHandlers(t.root)[0]?.body,
      'FIXTURE: a function-SOURCE body must be instantiated into a live function at translate',
    ).toBe('function')
  })

  it('BM-4 CONTROL a live FUNCTION body (authored in-process): NO warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const env: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          content: 'Save',
          handlers: [{ name: 'save', event: 'click', body: () => 1 }],
        },
      },
      content: [],
    }
    const t = translateLegacy(env)

    expect(
      missing(t),
      `a handler carrying a LIVE function body was diagnosed "${MISSING}"`,
    ).toHaveLength(0)
    expect(
      t.warnings,
      `the function-body control raised a warning of any kind: ${JSON.stringify(t.warnings)}`,
    ).toEqual([])
    expect(
      warnsNaming(warn, MISSING),
      `console.warn named "${MISSING}" for a handler that HAS a live body. Calls measured: ` +
        JSON.stringify(warnTexts(warn)),
    ).toHaveLength(0)
    expect(
      typeof compiledHandlers(t.root)[0]?.body,
      'FIXTURE: an in-process function body must reach the compiled handler as a function',
    ).toBe('function')
  })

  // =========================================================================
  // BM-5 — CONTROL: the def-shaped `handlers.<event>` binding (the auth seam)
  // =========================================================================

  /**
   * WHAT THE SEAM CODE ACTUALLY DOES (read before writing this case —
   * `docs/specs/handlers.md` §4/§6, `src/core/node.ts:1918` `rebuildHandlerSeamLayer`,
   * `src/core/translate.ts` def registration):
   *
   *  - A def-shaped `template.component` value `{reference, value: {name, body}}`
   *    registers a HANDLER DEF by NAME (`registerHandlerDef`) — it mints no
   *    consumer-side handler entry.
   *  - A `{reference, target: 'handlers.<event>'}` binding on the CONSUMER
   *    plans without a warn and persists `options.handlerEvent` on its anchor
   *    (the F17-style persistence channel).
   *  - At compile, `rebuildHandlerSeamLayer` walks the consumer's anchors,
   *    resolves each `handlerEvent`/`handlerPhase` anchor through
   *    `handlerDef(a.target)` and installs ONE provenance-marked
   *    `seam-handlers` LAYER whose entries are
   *    `{name, event: <suffix>, body: compileHandlerBody(def.body)}`.
   *
   *  SO: a body-less INLINE `handlers[]` entry can never be "filled by the
   *  seam". The seam reads the DEF REGISTRY keyed by the consumer's component
   *  ANCHORS and writes a LAYER; it never inspects the consumer's authored
   *  `NodeData.handlers`, and nothing at dispatch resolves a body by name either
   *  (`handlers.ts:102`/`:118` look only at `handler.body`; there is NO
   *  name→body lookup on that path). A body-less inline entry therefore stays
   *  body-less forever — which is exactly why the warn may not be suppressed
   *  by "maybe a def resolves it".
   *
   *  The legitimate shape this control pins is therefore the seam itself: a
   *  consumer that authors NO `handlers` at all and binds `handlers.click` to a
   *  registered def. It must warn NOTHING, and the seam must materialise a LIVE
   *  body — that is the "the seam resolves the body" case the gate ruled
   *  warn-free, and it is what a warn implementation must not turn into a false
   *  positive.
   */
  it('BM-5 CONTROL a def-shaped `handlers.click` binding (the auth/component seam): NO warning, and the seam materialises a LIVE body from the def', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const env: LegacyInitialData = {
      template: {
        root: {
          type: 'app',
          // the handler DEF — registered by name; its body lives in the registry
          component: [
            { reference: 'onSave', value: { name: 'onSave', body: 'function (event, context) { return 1 }' } },
          ],
          children: [
            // the CONSUMER — authors NO `handlers` array at all
            { type: 'button', content: 'Save', component: { reference: 'onSave', target: 'handlers.click' } },
          ],
        },
      },
      content: [],
    }
    const t = translateLegacy(env)

    expect(
      missing(t),
      `the def-shaped \`handlers.click\` binding was diagnosed "${MISSING}": this is the one LEGITIMATE ` +
        `body-less authoring shape (the consumer authors no body because the DEF supplies it). A warn ` +
        `that fires here is a false positive that makes the sanctioned auth/component seam unusable`,
    ).toHaveLength(0)
    expect(
      t.warnings,
      `the def-seam control raised a warning of any kind: ${JSON.stringify(t.warnings)} — the seam ` +
        `planning path is documented warn-free (handlers.md §6 'Seam planning')`,
    ).toEqual([])
    expect(
      warnsNaming(warn, MISSING),
      `console.warn named "${MISSING}" for a def-seam binding. Calls measured: ` + JSON.stringify(warnTexts(warn)),
    ).toHaveLength(0)

    // the control's TEETH: the seam really did resolve the def's body into a
    // live function on the consumer (otherwise "no warning" would be vacuous —
    // silence about a shape that simply did nothing).
    const sup = new Supervisor({})
    for (const n of t.nodes) sup.registerNode(n)
    t.root.compile(t.nodes)
    const consumer = t.nodes.find((n) => n.type === 'button')
    expect(consumer, 'FIXTURE: the seam consumer must be a translated node').toBeDefined()
    const seamEntry = compiledHandlers(consumer!).find((h) => h.event === 'click')
    expect(
      seamEntry,
      'the seam did not materialise a `click` handler entry on the consumer at compile ' +
        '(rebuildHandlerSeamLayer → the `seam-handlers` layer)',
    ).toBeDefined()
    expect(
      seamEntry!.name,
      'the seam entry must carry the DEF\'s name (the def registry is the body source)',
    ).toBe('onSave')
    expect(
      typeof seamEntry!.body,
      'the seam entry carries no LIVE body: this shape is legitimate precisely because ' +
        '`compileHandlerBody(def.body)` resolves a function — a warn keyed on "no inline body" would ' +
        'have to know that difference, which is why this control exists',
    ).toBe('function')
  })

  // =========================================================================
  // BM-6 — RECORD: a `format`-only handler (no event, no phase, no body)
  // =========================================================================

  /**
   * RECORD, NOT A REQUIREMENT — the disposition of a `format`-only handler is
   * **UNDOCUMENTED**: no spec, decision row or defect row states what a
   * `{name, format}` entry with no `event`, no `phase` and no `body` should do
   * (`grep` over `docs/` for a format-only disposition: nothing). The gate's
   * owed list (§8 P-7 (v), `docs/defects.md` HANDLER-BODYLESS-SILENT-DEAD)
   * asks only for "a `format`-only handler → documented disposition", and no
   * disposition exists to assert.
   *
   * What THIS case pins is therefore the CURRENT behaviour, measured:
   *  - translate keeps the entry verbatim (`{name, format:'legacy'}`) and
   *    raises NO warning (`handlers.ts`/`translate.ts` have no `event`/`phase`
   *    requirement at admission);
   *  - nothing dispatches (no `event`, no `phase` → both dispatch selectors
   *    miss it before the H-H3 body skip) and nothing is emitted (emit keys on
   *    a STRING `event`, so a phase-less/event-less entry publishes no `on:*`).
   * The ruled shape for R-2b targets "a handler with `event`/`phase` but no
   * body"; a `format`-only entry has NEITHER, so it is outside that ruling.
   * IF THE OWNER RULES A WARN FOR THIS SHAPE TOO, this case is the one to
   * update — it records today's silence, it does not assert a rule.
   */
  it('BM-6 RECORD a `format`-only handler (`{name, format:"legacy"}`, no event/phase/body): the disposition is UNDOCUMENTED — today it is kept verbatim, silently never dispatches, and publishes no `on:*` prop', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const env: LegacyInitialData = {
      template: { root: { type: 'div', content: 'Save', handlers: [{ name: 'fmtOnly', format: 'legacy' }] } },
      content: [],
    }
    const t = translateLegacy(env)

    // CURRENT READING (undocumented — recorded, not ruled).
    expect(
      t.warnings,
      `the format-only handler's disposition CHANGED: ${JSON.stringify(t.warnings)}. No documented ` +
        `disposition exists for \`{name, format}\` with no event/phase/body (the gate's P-7 (v) asks for ` +
        `one; none was written), so this case records the 0.5.2 reading — silently kept, no diagnostic. ` +
        `If the owner rules a warn for this shape, update this case and the row together`,
    ).toEqual([])
    expect(
      missing(t),
      `the format-only handler was diagnosed "${MISSING}": it carries no event/phase, so it is outside ` +
        `the ruled R-2b shape ("a handler with event/phase but no body and no resolvable def")`,
    ).toHaveLength(0)
    expect(
      warnsNaming(warn, MISSING),
      `console.warn named "${MISSING}" for the format-only shape. Calls measured: ` + JSON.stringify(warnTexts(warn)),
    ).toHaveLength(0)

    const kept = compiledHandlers(t.root)
    expect(
      kept.map((h) => ({ name: h.name, format: h.format, hasBody: h.body !== undefined })),
      'the format-only entry is not carried verbatim any more (name + the explicit format, no body)',
    ).toEqual([{ name: 'fmtOnly', format: 'legacy', hasBody: false }])

    // the dead-end facts that make the silence worth a disposition: no emit, no dispatch.
    const { els } = renderTree(t)
    const el = els.find((e) => e.props?.['text'] === 'Save')
    expect(el, 'FIXTURE: the node still renders').toBeDefined()
    expect(
      onPropKeys(el!),
      'the format-only handler published an `on:*` prop — emit keys on a STRING `event`, which this ' +
        'entry does not author, so it must publish none (a change here is a behaviour change)',
    ).toEqual([])
    const sup = new Supervisor({})
    sup.registerNode(t.root)
    expect(
      sup.dispatchEvent(t.root.id, 'fmtOnly'),
      'the format-only handler dispatched something: it has no body, so dispatch must be the H-H3 skip',
    ).toEqual([])
    expect(sup.dispatchEvent(t.root.id, 'click'), 'the format-only handler answered an event it never named').toEqual([])
  })

  // =========================================================================
  // BM-7 — the per-ENTRY discipline: two body-less handlers, one warn EACH
  // =========================================================================

  it('BM-7 two body-less handlers on ONE node warn ONCE EACH (paths `root.handlers[0]` + `root.handlers[1]`, no collapsing, no per-node de-duplication)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const env: LegacyInitialData = {
      template: {
        root: {
          type: 'div',
          content: 'Save',
          handlers: [
            { name: 'save', event: 'click' },
            { name: 'boot', phase: 'after-render' },
          ],
        },
      },
      content: [],
    }
    const t = translateLegacy(env)

    const hits = missing(t)
    expect(
      hits.map((w) => w.path),
      `a node with TWO body-less handlers produced ${hits.length} "${MISSING}" warning(s) ` +
        `(${JSON.stringify(hits)}): the K8/TR-F2 containment discipline is PER ENTRY — the existing ` +
        `family warns once per offending handler definition, at its own tree position ` +
        `(translate.test.ts:628/:645). One warn per NODE would hide the second dead listener, and two ` +
        `warns per entry is noise. Both the event-only and the phase-only axis owe one each`,
    ).toEqual(['root.handlers[0]', 'root.handlers[1]'])
    expect(
      t.warnings.map((w) => w.code),
      `the two-entry arm produced warning codes ${JSON.stringify(t.warnings.map((w) => w.code))} — ` +
        `exactly two "${MISSING}" entries are owed and nothing else`,
    ).toEqual([MISSING, MISSING])
    expect(
      warnsNaming(warn, MISSING),
      `console.warn named "${MISSING}" ${warnsNaming(warn, MISSING).length} time(s) for two body-less ` +
        `handlers — one per ENTRY is owed (the same per-entry count the \`warnings\` channel shows). ` +
        `Calls measured: ${JSON.stringify(warnTexts(warn))}`,
    ).toHaveLength(2)

    // warn + keep on BOTH entries: the phase handler is as dead as the event one.
    expect(
      compiledHandlers(t.root).map((h) => h.name),
      'a body-less handler was rejected at translate: warn + keep applies to the phase axis as well',
    ).toEqual(['save', 'boot'])
    // and the emit half: only the string-`event` entry is published (the phase
    // entry keys on `phase`, so emit never synthesises an `on:*` for it).
    const { els } = renderTree(t)
    const el = els.find((e) => e.props?.['text'] === 'Save')
    expect(el, 'FIXTURE: the node still renders').toBeDefined()
    expect(el!.props?.['on:click'], 'emit stopped publishing `on:click` (a behaviour change)').toBe(true)
    expect(onPropKeys(el!), 'emit published props no handler authored').toEqual(['on:click'])
  })
})
