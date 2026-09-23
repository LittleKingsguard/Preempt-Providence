// @ts-nocheck — the demo page module + builder under test are plain JS (no
// declarations), and the driver uses native dynamic imports (the smoke's path).
/**
 * FORK-STRESS-DATA-SHALLOW-LINK-STALE-EXPECTATIONS — the RUNTIME data-driven
 * family's SHALLOW `link` coverage (`docs/defects.md`).
 *
 * ── WHAT WAS WRONG (measured, now FIXED) ───────────────────────────────────
 * `demo/fork-stress-data.js` carried the stale `2^depth − 1`-for-every-
 * (depth, method) relation in THREE checks (the element census, the
 * `re-typed = familyStates − 3` pin and the `treeFromOps` total/leaf-depth
 * check), so a shallow `link` page reported
 *   `Fork Stress (data: link) — depth 2: 7 passed, 3 failed`
 * with `elements: expected 3, got 7`, `expected 0 re-typed def-chain elements
 * (no forkKey), got 4` and `leaf at depth 2, expected 1`. The 7 is CORRECT:
 * at d2/link the two level-1 def hosts' path-states are childless and
 * uncovered, so the standalone P-EMIT-3 def-fill branch
 * (`src/core/render-helpers.ts:743-746`) adds their def children —
 * `3 + 2·2 = 7`. The user RULED this the DOCUMENTED behaviour
 * (`docs/specs/render.md:224` DFC-1; `docs/decisions.md` row
 * DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION, 2026-09-23), so the EXPECTATIONS
 * were corrected — never the engine.
 *
 * ── WHY THIS FILE EXISTS (the coverage the defect row asked for) ───────────
 * The staleness was LATENT because no shallow single-method page is built or
 * run: `scripts/build-demo.mjs` builds the method variants at d12/d14 only and
 * the smoke runs exactly those, so nothing executed the three checks at a depth
 * where the def-fill term is non-zero. This file drives the REAL page module
 * (`demo/fork-stress-data.js`) against a page BUILT for (depth, method) by the
 * REAL builder (`scripts/fork-stress-data-page.mjs`) through the shared smoke
 * shim (`scripts/smoke-shim.mjs`) — the same in-process mount the static
 * family's shallow coverage uses in the smoke's `derived-fork-shallow-census`
 * guard — and asserts the page's OWN runner banner plus its published census.
 *
 * ── THE COVERAGE CHOICE (recorded) ─────────────────────────────────────────
 * IN-PROCESS page mounts in a UNIT file, NOT shallow pages added to the smoke:
 *   · the pages are 3- and 7-element builds, so the smoke's isolated
 *     subprocess-per-page discipline (heap isolation for the 4095-element d12
 *     pages — `scripts/smoke-page-worker.mjs`) buys nothing here;
 *   · adding shallow pages to the smoke would also mean new build outputs and
 *     new worker entries (the same reasoning `scripts/demo-smoke.mjs` records
 *     for the static family's shallow guard), and it would couple a page-side
 *     expectation correction to the harness the defect row warns about;
 *   · the smoke ITSELF is NOT touched by this pass, so this file spawns no
 *     smoke and is deliberately NOT listed in `SMOKE_SPAWNING_TEST_FILES`
 *     (`vitest.config.ts`, AGENTS.md item 4 — that list is for files that spawn
 *     `scripts/demo-smoke.mjs` or an equivalently heavy worker harness; these
 *     mounts are milliseconds).
 *
 * ── FALSIFIABILITY (what makes the corrected relation testable) ────────────
 * Every expectation here is DERIVED, never read from the page: the element
 * count, the def-fill term, the re-typed count and the `treeFromOps` leaf depth
 * are recomputed from the page's OWN envelope by this test's own translation /
 * path enumeration / emit pipeline. Reverting any of the three page checks to
 * the stale form therefore fails THREE ways at once: the page's banner stops
 * reporting `0 failed`, its published `elements` disagrees with the derived
 * relation, and the stale form is asserted here to be WRONG (the frozen
 * `expected 3 / got 7` + `expected 0 ... got 4` + `leaf at depth 2, expected 1`
 * signatures). MEASURED perturbation demonstration (the page's three sites
 * reverted to the stale forms in a scratch copy): the d2/link banner reads
 * `7 passed, 3 failed` with exactly those three failure details — recorded in
 * `docs/defects.md` FORK-STRESS-DATA-SHALLOW-LINK-STALE-EXPECTATIONS.
 */
import { describe, it, expect } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { forkStressLegacyData } from '../../demo/fork-stress-data.js'
import { translateLegacy } from '../../dist/core/translate.js'
import { Supervisor } from '../../dist/core/supervisor.js'
import { EventBridge } from '../../dist/core/events.js'
import { emitElements } from '../../dist/core/render-helpers.js'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Import a repo file by ABSOLUTE PATH at runtime (a non-literal specifier, so
 *  no TS declaration is required for the plain-JS shim / demo page / builder —
 *  the same mechanism `tests/unit/no-clone-invariants.test.ts` uses). */
async function importFile(absPath: string, cacheBust?: string): Promise<unknown> {
  return await import(/* @vite-ignore */ cacheBust ? `${absPath}?${cacheBust}` : absPath)
}

// ===========================================================================
// THE INDEPENDENT DERIVATION — the ruled relation recomputed from the family's
// OWN envelope (never from the page's numbers). This is the same three-clause
// derivation `tests/unit/fork-stress-data-p3.test.ts`'s `derivedElements`
// applies (def host / childless / uncovered → its def's child count); it is
// DUPLICATED here rather than imported so this file's expectation cannot be
// satisfied by a change to that file's helper.
// ===========================================================================
type Relation = {
  base: number
  defFill: number
  elements: number
  fillHosts: string[]
  reTyped: number
  leafDepth: number
  leaves: number
}

function derivedRelation(depth: number, method: string | undefined, envelope?: unknown): Relation {
  const doc = envelope ?? forkStressLegacyData(depth, method)
  const translated = translateLegacy(doc)
  const sup = new Supervisor({ events: new EventBridge() })
  for (const n of translated.nodes) sup.registerNode(n)
  const states = []
  for (const n of translated.nodes) states.push(...n.compilePath().actionable)
  sup.recordResolved(states)
  const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
  const els = emitElements(states, byNode)
  let defFill = 0
  const fillHosts = []
  for (const s of states) {
    const def = Object.values(s.bindings ?? {}).find((v) => v && typeof v === 'object' && v.type !== undefined)
    if (!def) continue // not a def host — the fill branch cannot fire
    if ((s.children ?? []).length !== 0) continue // populated host: the re-typing branch, never the fill
    if ((s.trace ?? []).length !== 2) continue // def-covered (arrived as a re-typed child) — the gate skips it
    const n = Array.isArray(def.children) ? def.children.length : 0
    defFill += n
    fillHosts.push(`${s.pathKey}:${n}`)
  }
  const base = 2 ** depth - 1
  const layers = depth - 1
  return {
    base,
    defFill,
    elements: base + defFill,
    fillHosts,
    // the adapter-key asymmetry: root + the level-1 states are standalone
    // (forkKey = pathKey); every other element carries no forkKey — the covered
    // re-typed children from d3 on, and the def-fill synthetics at d2/link
    reTyped: base + defFill - 3,
    leafDepth: layers + (defFill > 0 ? 1 : 0),
    leaves: defFill > 0 ? defFill : 2 ** layers,
  }
}

/** The relation's own emitted count (the independent measurement of the SAME
 *  envelope the page compiles) — attached as a property by the caller. */
function derivedEmitted(depth: number, method: string | undefined): number {
  const translated = translateLegacy(forkStressLegacyData(depth, method))
  const sup = new Supervisor({ events: new EventBridge() })
  for (const n of translated.nodes) sup.registerNode(n)
  const states = []
  for (const n of translated.nodes) states.push(...n.compilePath().actionable)
  sup.recordResolved(states)
  const byNode = new Map(sup.allNodes().map((n) => [n.id, n]))
  return emitElements(states, byNode).length
}

// ===========================================================================
// THE PAGE DRIVER — the smoke's own path for a shallow page: build the page
// HTML with the REAL builder, seed it into the shared shim, import the page
// module (a fresh instance per (depth, method) — the query busts the module
// cache), await its done-promise, then read the banner it wrote and the census
// it PUBLISHED.
// ===========================================================================
type Mounted = {
  profile: Record<string, number> | null
  banner: string | null
  checks: string[]
  failures: string[]
}

let shimInstalled: { byId: Map<string, unknown> } | null = null

async function mountPage(depth: number, method: string): Promise<Mounted> {
  const { buildForkStressDataPage } = (await importFile(join(REPO, 'scripts', 'fork-stress-data-page.mjs'))) as {
    buildForkStressDataPage: (d: number, m?: string) => Promise<{ html: string }>
  }
  const { html } = await buildForkStressDataPage(depth, method)
  if (shimInstalled === null) {
    const { installSmokeShim } = (await importFile(join(REPO, 'scripts', 'smoke-shim.mjs'))) as {
      installSmokeShim: () => { byId: Map<string, unknown>; seedPage: (h: string) => void }
    }
    shimInstalled = installSmokeShim()
  }
  const shim = shimInstalled as {
    byId: Map<string, unknown>
    seedPage: (h: string) => void
  }
  // PER-MOUNT HYGIENE (a browser loads each page into a fresh document; one
  // shim process mounts several): `#app` is the DomAdapter host and `#results`
  // is the runner's check list, so both are dropped and re-created empty —
  // otherwise the previous mount's subtree would leak into this page's DOM
  // census and its FAIL marks would be indistinguishable from this page's.
  shim.byId.delete('app')
  shim.byId.delete('results')
  shim.seedPage(html)
  const g = globalThis as unknown as Record<string, unknown>
  // a FRESH module instance: the page's guarded browser block runs again against
  // the newly seeded envelope
  await importFile(join(REPO, 'demo', 'fork-stress-data.js'), `shallow=${depth}-${method}-${Date.now()}`)
  const done = g.__forkStressDataDone as Promise<void> | undefined
  await Promise.race([done, new Promise((r) => setTimeout(r, 60_000))]).catch(() => undefined)
  const profile = (g.__forkStressDataProfile ?? null) as Record<string, number> | null
  // THE PAGE'S OWN CHECKS: `runner.check` CATCHES a failure (it counts it and
  // writes the detail — it never rejects), so the banner the page's own runner
  // wrote is the only page-level proof that every check passed.
  const results = (globalThis as unknown as { document: { getElementById: (id: string) => unknown } })
    .document.getElementById('results') as { children?: unknown[] }
  const checks: string[] = []
  const failures: string[] = []
  const walk = (el: unknown): void => {
    const e = el as { className?: string; textContent?: string; children?: unknown[] }
    if (e?.className === 'pass' || e?.className === 'fail') {
      const spans = (e.children ?? []) as Array<{ textContent?: string }>
      checks.push(spans[1]?.textContent ?? '')
      if (e.className === 'fail') failures.push((e.children ?? []).map((c) => (c as { textContent?: string }).textContent).join(' — '))
    }
    for (const c of e?.children ?? []) walk(c)
  }
  walk(results)
  let banner: string | null = null
  const findBanner = (el: unknown): void => {
    const e = el as { className?: string; textContent?: string; children?: unknown[] }
    if (typeof e?.textContent === 'string' && /passed, \d+ failed/.test(e.textContent) && banner === null) banner = e.textContent
    for (const c of e?.children ?? []) findBanner(c)
  }
  findBanner(results)
  // the page turned the engine's compile-pass logging ON at import — turn it
  // back off so this suite stays quiet (the smoke's own hygiene, same call)
  if (typeof g.setCompilePassLogging === 'function') {
    ;(g.setCompilePassLogging as (v: boolean) => void)(false)
  }
  return { profile, banner, checks, failures }
}

describe('FORK-STRESS-DATA-SHALLOW-LINK-STALE-EXPECTATIONS — the shallow link pages run green (the relation is derived, not stale)', () => {
  // d2 is the ONE shallow point where the def-fill term is non-zero (the
  // staleness the defect row recorded); d3 is the control one hop deeper, where
  // the level-1 hosts own real children and the term is 0 again.
  const POINTS: Array<[number, string]> = [[2, 'link'], [3, 'link']]

  it('d2/link and d3/link: EVERY page check passes (the banner reports 0 failed) and the published census is the ruled relation', async () => {
    for (const [depth, method] of POINTS) {
      const rel = derivedRelation(depth, method)
      const mounted = await mountPage(depth, method)
      expect(mounted.banner, `d${depth}/${method}: the page published no runner banner — its checks could not be read`).not.toBeNull()
      expect(
        mounted.failures,
        `d${depth}/${method}: the page's OWN checks failed (${mounted.banner}): ${mounted.failures.join(' | ')} — the ruled relation is ` +
          `${rel.base} path-states${rel.defFill ? ` + ${rel.defFill} def-fill (${rel.fillHosts.join(', ')})` : ''} = ${rel.elements} elements` +
          ` (render-helpers.ts:743-746; render.md:224 DFC-1; decisions.md DERIVED-FAMILY-SHALLOW-DEF-FILL-EXCEPTION)`,
      ).toEqual([])
      expect(mounted.banner, `d${depth}/${method}: banner not 0-failed`).toMatch(/ 0 failed$/)
      // the page's own check TITLES must carry the DERIVED counts (a page that
      // kept the stale form but happened to pass would fail this)
      expect(mounted.checks.join('\n')).toContain(`element census: ${rel.elements} elements`)
      expect(mounted.checks.join('\n')).toContain(`treeFromOps: one root; full binary tree (2 children per non-leaf); ${rel.leaves} leaves at depth ${rel.leafDepth}; ${rel.elements} nodes total`)
      // the PUBLISHED census (the page measured its own emit) against the
      // independently derived relation
      expect(mounted.profile, `d${depth}/${method}: the page published no profile`).not.toBeNull()
      expect(mounted.profile!.states, `d${depth}/${method} states`).toBe(rel.base)
      expect(mounted.profile!.elements, `d${depth}/${method} elements`).toBe(rel.elements)
      expect(mounted.profile!.registered, `d${depth}/${method} registered`).toBe(2 * depth - 1)
      // and the derivation itself is a MEASUREMENT of the same envelope
      expect(derivedEmitted(depth, method), `d${depth}/${method}: the independent emit count`).toBe(rel.elements)
    }
  })

  it('the d2/link point really is the childless-uncovered def-fill boundary (term 4 = 2 hosts × 2 def children), and the stale relation is FALSIFIED by the measured emits', () => {
    // THE BOUNDARY IS MEASURED, not assumed: the term is non-zero at d2/link
    // ONLY — d3/link, d2/placement and d2/values all derive 0 (the level-1 hosts
    // own real children from d3 on; placement/values carry no def bindings).
    const d2link = derivedRelation(2, 'link')
    expect(d2link.defFill, 'the d2/link def-fill term').toBe(4)
    expect(d2link.fillHosts, 'the fill hosts are the two level-1 def hosts, 2 def children each').toHaveLength(2)
    for (const host of d2link.fillHosts) expect(host).toMatch(/^root\/[^/]+:2$/)
    expect(d2link.elements).toBe(7) // 3 + 4 — the ruled census
    for (const [depth, method] of [[3, 'link'], [2, 'placement'], [2, 'values'], [3, 'placement'], [3, 'values']] as Array<[number, string]>) {
      const rel = derivedRelation(depth, method)
      expect(rel.defFill, `d${depth}/${method}: the shallow term must be 0`).toBe(0)
      expect(rel.elements, `d${depth}/${method}: the census is plain 2^depth − 1`).toBe(2 ** depth - 1)
    }
    // THE FROZEN FAILURE SIGNATURES of the stale form (the defect row's
    // measurement): a page carrying `2^d − 1` expectations at d2/link reports
    // `elements: expected 3, got 7`, `expected 0 re-typed def-chain elements
    // (no forkKey), got 4` and `leaf at depth 2, expected 1`. Asserting them
    // WRONG here is what makes the correction falsifiable — a future revert
    // would have to re-satisfy these numbers.
    const emitted = derivedEmitted(2, 'link')
    expect(emitted).not.toBe(2 ** 2 - 1) // the stale element expectation is FALSE
    expect(d2link.reTyped).not.toBe(2 ** 2 - 1 - 3) // the stale `familyStates − 3` pin is FALSE (derived 4, stale 0)
    expect(d2link.reTyped).toBe(4)
    expect(d2link.leafDepth).not.toBe(2 - 1) // the stale leaf depth is FALSE (derived 2, stale 1)
    expect(d2link.leafDepth).toBe(2)
    expect(d2link.leaves).toBe(4)
  })

  it('the perturbation arm: with the d2/link def hosts MADE COVERED the term collapses to 0, so the term is genuinely derived from the states (not a constant)', () => {
    // A negative control that does not touch the page: strip the level-1
    // component defs from a copy of the envelope → no def host exists → the
    // derived term is 0 and the census is exactly 2^depth − 1. If the page's
    // term were a literal (or read the wrong quantity) this contrast could not
    // hold; the SAME envelope with the defs yields 4.
    const env = forkStressLegacyData(2, 'link')
    expect(derivedRelation(2, 'link', env).defFill, 'the control envelope (defs intact)').toBe(4)
    const stripped = JSON.parse(JSON.stringify(env))
    for (const proto of stripped.template.root.children) delete proto.component
    expect(derivedRelation(2, 'link', stripped).defFill, 'with the level-1 defs removed the fill branch cannot fire').toBe(0)
    expect(derivedRelation(2, 'link', stripped).elements).toBe(3)
  })
})
