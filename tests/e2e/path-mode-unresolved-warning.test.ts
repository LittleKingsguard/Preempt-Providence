/**
 * `PATH-MODE-SILENT-UNRESOLVED` (`docs/defects.md` row of that name) — RED
 * FIRST (AGENTS.md item 8): written against a tree where the defect is live,
 * with no `src/**` change accompanying this file.
 *
 * THE MEASURED CONDITION (the row's probe P-7): a consumer referencing
 * `theme` whose provider sits three levels BELOW it is resolved by the
 * `family` walk (`resolve.ts` `fitReference`: self → descendants → ancestors)
 * and is NOT resolved by the `path` walk (`resolvePathTargets`: self → path
 * ancestors only). Today the two modes disagree on the DIAGNOSTICS as well:
 * `family` pushes `{code:'unresolved-reference', pathKey}` into
 * `CompileResult.warnings` and `console.warn`s it (`node.ts:1406-1410`),
 * while `compilePath()` pushes NOTHING and warns NOTHING — the only surviving
 * channel is `CompiledState.unresolved`, which no author reads.
 *
 * THE OWNER'S RULING: **the loud half only** — make the path resolver report
 * through the same channels the family resolver uses, deduped per
 * `(code, pathKey, referenceName)` following the W4 diagnostic discipline
 * (`docs/specs/bodyruns-drop-diagnostics.md` §3 C4). Resolution itself is
 * DELIBERATELY UNCHANGED, so **no case in this file asserts what the path
 * resolver should resolve** — only the diagnostics.
 *
 * WHAT THIS FILE ASSERTS:
 *  - **PU-1** (RED today on the two warning halves) path mode, descendant-
 *    provided name: the compiled state carries the `unresolved` entry **and**
 *    `CompileResult.warnings` (captured off `compilePath()` directly) holds
 *    `{code:'unresolved-reference'}` for that node's pathKey **and**
 *    `console.warn` was called with text containing `unresolved-reference`.
 *  - **PU-2** (RED today) dedup: the warning fires once per
 *    `(code, pathKey, referenceName)` across TWO consecutive compiles of the
 *    same node — while the state channel stays populated in both.
 *  - **PU-3** (CONTROL, green today) the family compile of a RESOLVABLE
 *    consumer pushes no warning and warns nothing (no regression).
 *  - **PU-4** (CONTROL, green today) an ANCESTOR-provided name under path mode
 *    resolves (probe arm A3) and therefore warns NOTHING — a fix must not turn
 *    a working resolution into a warning.
 *  - **PU-5** (RED today on the warning half) the supervisor's own pass-2
 *    `path` route (`compileMode:'path'`, `compilePathSlice`) reaches the same
 *    channel: the settled state carries the `unresolved` entry AND exactly one
 *    `console.warn` names the code. (`CompileResult.warnings` is merged and
 *    then discarded inside the supervisor, so `console.warn` is the only
 *    observable of that route.)
 *
 * NAMESPACE DISCIPLINE (the W4/C4 lesson, `docs/defects.md` FRS-CONSULTED-DEF /
 * ORACLE-1..4): the dedup set is PROCESS-level and never cleared, and the
 * signature embeds the pathKey. Every case here therefore builds its OWN tree
 * through `translateLegacy` — node ids are minted from a module counter, so
 * each case's consumer gets a distinct pathKey and its first emission can
 * never be suppressed by an earlier case.
 */
import { describe, it, expect, vi, afterEach, type MockInstance } from 'vitest'
import { Supervisor, type Node } from '../../src/core/node.js'
import { translateLegacy, type LegacyInitialData, type TranslatedTree } from '../../src/core/translate.js'
import type { CompiledState } from '../../src/core/types.js'

afterEach(() => {
  vi.restoreAllMocks()
})

// ============================================================================
// The two probe arms' envelopes (P-7 A1/A2/A3, P-7's `#panel`/`#deeper` shape)
// ============================================================================

/**
 * **Descendant-provided** (probe arms A1/A2): `#root > #panel(consumer) >
 * `#inner > #deeper(provider 'dark')`. The consumer references `theme`; the
 * provider is three levels BELOW it — the one shape the two resolvers treat
 * differently.
 */
function descendantEnvelope(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        children: [
          {
            type: 'div',
            css: { id: 'panel' },
            props: { id: 'panel' },
            component: { reference: 'theme', target: 'props.theme' },
            children: [
              {
                type: 'div',
                css: { id: 'inner' },
                props: { id: 'inner' },
                children: [
                  {
                    type: 'span',
                    css: { id: 'deeper' },
                    props: { id: 'deeper' },
                    component: { reference: 'theme', value: 'dark' },
                  },
                ],
              },
            ],
          },
        ],
      },
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

/**
 * **Ancestor-provided** (probe arm A3): the direction `resolvePathTargets`
 * DOES cover — `#root(provider 'blue') > #mid > #consumer(consumer)`. Kept as
 * a separate tree so no case's pathKey is shared.
 */
function ancestorEnvelope(): LegacyInitialData {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'root' },
        props: { id: 'root' },
        component: { reference: 'accent', value: 'blue' },
        children: [
          {
            type: 'div',
            css: { id: 'mid' },
            props: { id: 'mid' },
            children: [
              {
                type: 'span',
                css: { id: 'consumer' },
                props: { id: 'consumer' },
                component: { reference: 'accent', target: 'props.accent' },
              },
            ],
          },
        ],
      },
    },
    content: [],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

function translate(env: LegacyInitialData): { tree: TranslatedTree; authored: (cssId: string) => Node } {
  const tree = translateLegacy(env)
  const authored = (cssId: string): Node => {
    const n = tree.nodes.find((x) => x.css?.id === cssId || x.props?.id === cssId)
    if (!n) throw new Error(`fixture: the envelope has no #${cssId} node`)
    return n
  }
  return { tree, authored }
}

/** The node's OWN compiled state out of a compile result (a compile result may
 *  carry more than the compiled node's states in the family scope). */
function ownState(cr: { actionable: CompiledState[] }, node: Node): CompiledState | undefined {
  return cr.actionable.find((s) => s.nodeId === node.id)
}

/** The `console.warn` calls whose joined arguments contain `needle` — the
 *  diagnostic channel is a two-argument call (`'unresolved-reference at',
 *  pathKey`), so every call is read as one text. */
function warnTexts(spy: MockInstance<typeof console.warn>): string[] {
  return spy.mock.calls.map((args) => args.map((a) => String(a)).join(' '))
}

function warnsContaining(spy: MockInstance<typeof console.warn>, needle: string): string[] {
  return warnTexts(spy).filter((t) => t.includes(needle))
}

// ============================================================================
// PU-1 — the three channels for the descendant-provided name under path mode
// ============================================================================

describe('PATH-MODE-SILENT-UNRESOLVED — the path resolver must report unresolved references loudly', () => {
  it('PU-1 path mode: the consumer\'s state carries `unresolved` AND `compilePath().warnings` AND console.warn report it', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { authored } = translate(descendantEnvelope())
    const panel = authored('panel')

    const cr = panel.compilePath()
    const state = ownState(cr, panel)
    expect(state, 'FIXTURE: the path compile must mint a state for the consumer').toBeDefined()
    // FIXTURE: in this family-chain shape the path-state's key coincides with
    // the node's own (`pathKeyFor` 'root/<id>' and `Node.pathKey` agree), so
    // the family channel's `node.pathKey` and the state's `pathKey` are one
    // value — the assertion below can name either without ambiguity.
    expect(state!.pathKey, 'FIXTURE: the path-state key must be the consumer\'s own pathKey').toBe(panel.pathKey)

    // (0) the STATE channel — already correct today, and it must stay so.
    expect(
      state!.unresolved,
      'the compiled state lost its `unresolved` entry — the path resolver\'s ONLY surviving channel today',
    ).toContainEqual({ referenceName: 'theme', code: 'unresolved-reference' })

    // (a) the `CompileResult.warnings` channel — loud in family mode, absent here.
    expect(
      cr.warnings,
      `compilePath() reported ZERO warnings for a consumer whose reference "${'theme'}" is unresolved in the path universe: family mode pushes {code:'unresolved-reference', pathKey:'${state!.pathKey}'} (node.ts:1406-1410) and path mode pushes nothing, so the same condition is loud in one mode and silent in the other (PATH-MODE-SILENT-UNRESOLVED)`,
    ).toContainEqual({ code: 'unresolved-reference', pathKey: state!.pathKey })
    expect(
      cr.warnings,
      `the path compile pushed ${cr.warnings.length} warnings for ONE unresolved reference — exactly one is owed (nothing else in this arm is droppable/warnable)`,
    ).toHaveLength(1)

    // (b) the `console.warn` channel — the family channel's second half.
    const hits = warnsContaining(warn, 'unresolved-reference')
    expect(
      hits,
      `console.warn was called ${hits.length} time(s) containing "unresolved-reference" for the unresolved "${'theme'}" reference: the family resolver warns ("unresolved-reference at", pathKey) and the path resolver warns NOTHING, so an author under path mode has no observable at all. Calls measured: ${JSON.stringify(warnTexts(warn))}`,
    ).toHaveLength(1)
    expect(hits[0], 'the warned text must name the diagnostic code').toContain('unresolved-reference')
  })

  // ==========================================================================
  // PU-2 — dedup per (code, pathKey, referenceName)
  // ==========================================================================

  it('PU-2 dedup: the warning fires ONCE per (code, pathKey, referenceName) across two consecutive compiles', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { authored } = translate(descendantEnvelope())
    const panel = authored('panel')

    const first = panel.compilePath()
    const second = panel.compilePath()

    // the STATE channel must stay populated on BOTH compiles: dedup silences a
    // repeated WARNING, never the state record the renderer reads.
    for (const [label, cr] of [['first', first], ['second', second]] as const) {
      const state = ownState(cr, panel)
      expect(state, `FIXTURE: the ${label} compile must mint a state for the consumer`).toBeDefined()
      expect(
        state!.unresolved,
        `the ${label} compile lost the state's \`unresolved\` entry — the dedup must not suppress the state channel`,
      ).toContainEqual({ referenceName: 'theme', code: 'unresolved-reference' })
    }

    const hits = warnsContaining(warn, 'unresolved-reference')
    expect(
      hits,
      `two consecutive compiles of the same node warned ${hits.length} time(s): the same unresolved condition must be reported once per (code, pathKey, referenceName) — the W4 diagnostic discipline (docs/specs/bodyruns-drop-diagnostics.md §3 C4), not once per compile. Calls measured: ${JSON.stringify(warnTexts(warn))}`,
    ).toHaveLength(1)
  })

  // ==========================================================================
  // PU-3 — CONTROL: family mode, resolvable consumer, no warning
  // ==========================================================================

  it('PU-3 CONTROL family mode: the resolvable consumer pushes NO warning and warns nothing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tree, authored } = translate(descendantEnvelope())
    const panel = authored('panel')

    const cr = panel.compile(tree.nodes, { focusNodeId: panel.id })
    const state = ownState(cr, panel)
    expect(state, 'FIXTURE: the family compile must mint a state for the consumer').toBeDefined()
    // The control's TEETH: the family walk really does resolve the
    // descendant-provided name (pinned existing behaviour — the owner's ruling
    // does not change which providers resolve), so "no warning" is not vacuous.
    expect(
      state!.bindings,
      'the family compile no longer resolves the descendant-provided name — the control arm is vacuous without a real resolution',
    ).toMatchObject({ theme: 'dark' })
    expect(state!.unresolved, 'the family compile recorded an unresolved entry for a resolved name').toHaveLength(0)

    expect(cr.warnings, `the family compile of a RESOLVABLE consumer pushed a warning: ${JSON.stringify(cr.warnings)}`).toHaveLength(0)
    expect(
      warnsContaining(warn, 'unresolved-reference'),
      `the family compile warned about an unresolved reference that it actually resolved. Calls measured: ${JSON.stringify(warnTexts(warn))}`,
    ).toHaveLength(0)
  })

  // ==========================================================================
  // PU-4 — CONTROL: ancestor-provided name under path mode warns nothing
  // ==========================================================================

  it('PU-4 CONTROL ancestor-provided name under path mode: it resolves and therefore warns NOTHING', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { authored } = translate(ancestorEnvelope())
    const consumer = authored('consumer')

    const cr = consumer.compilePath()
    const state = ownState(cr, consumer)
    expect(state, 'FIXTURE: the path compile must mint a state for the consumer').toBeDefined()
    // arm A3's reading: the path walk DOES cover the ancestor direction.
    expect(
      state!.bindings,
      'the path compile no longer resolves an ANCESTOR-provided name — that direction is pinned working behaviour (probe arm A3)',
    ).toMatchObject({ accent: 'blue' })
    expect(state!.unresolved, 'the path compile recorded an unresolved entry for a name it resolved').toHaveLength(0)

    expect(
      cr.warnings,
      `a fix must not turn a WORKING resolution into a warning: the ancestor-provided name resolved, yet the path compile pushed ${JSON.stringify(cr.warnings)}`,
    ).toHaveLength(0)
    expect(
      warnsContaining(warn, 'unresolved-reference'),
      `the path compile warned about an unresolved reference that it actually resolved. Calls measured: ${JSON.stringify(warnTexts(warn))}`,
    ).toHaveLength(0)
  })

  // ==========================================================================
  // PU-5 — the supervisor's own pass-2 `path` route reaches the same channel
  // ==========================================================================

  it('PU-5 the supervisor\'s pass-2 path route reports the unresolved reference (state + console.warn)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { tree, authored } = translate(descendantEnvelope())
    const panel = authored('panel')
    // `compileMode:'path'` is the supervisor's documented explicit override
    // (R-1 §4.4(3)); pass-2 then re-mints every bounded-slice member through
    // its own `compilePath()` (`compilePathSlice`).
    const sup = new Supervisor({ compileMode: 'path' })
    for (const n of tree.nodes) sup.registerNode(n)

    const wrote = sup.apply({ kind: 'state-slice', node: panel, mutation: [{ targetProp: 'content', mode: 'replace', value: 'x' }] })
    expect(wrote.status, 'FIXTURE: the state-slice write is a sanctioned applied op').toBe('applied')
    await sup.flush()

    const settled = sup.takePass2States().get(panel.id) ?? []
    expect(settled.length, 'FIXTURE: the flush must settle a pass-2 state for the consumer').toBeGreaterThan(0)
    // the state channel through the supervisor route (green today)
    expect(
      settled[0]!.unresolved,
      'the supervisor\'s path-mode pass-2 state lost its `unresolved` entry',
    ).toContainEqual({ referenceName: 'theme', code: 'unresolved-reference' })

    // the warning channel on the same route (RED today: `compilePathSlice`
    // merges `CompileResult.warnings` and then never surfaces them, and
    // `compilePath()` pushes none to begin with).
    const hits = warnsContaining(warn, 'unresolved-reference')
    expect(
      hits,
      `the supervisor's path-mode pass-2 flush compiled the consumer through compilePath() and reported the unresolved "theme" reference on NO channel a host can hear: 0 console.warn calls (warnings measured: ${JSON.stringify(warnTexts(warn))})`,
    ).toHaveLength(1)
  })
})
