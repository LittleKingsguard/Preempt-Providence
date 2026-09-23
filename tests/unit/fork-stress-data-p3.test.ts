// @ts-nocheck — the demo page module + builder under test are plain JS (no
// declarations), and the page driver uses native dynamic imports.
/**
 * FORK-STRESS-DATA-P3 — the data-driven fork-stress family's conversion from
 * clone assembly to PATH ENUMERATION, and the typed property register.
 *
 * Contract: `docs/specs/fork-stress-data-p3.md` (§3 K1..K8, §5 the six-row
 * register, §7 the acceptance checklist, §8.1 the FD case set). Target model:
 * `docs/specs/placement-path-spec.md` §2/§5. Invariants: the converted family
 * must satisfy `docs/specs/no-clone-invariants.md` I1..I5 with the K7
 * re-derived cross-expression relation.
 *
 * ── THE STATE OF THE WORLD TODAY (measured 2026-09-22) ──────────────────────
 * The family still assembles by `{kind:'clone-instance'}` per level through its
 * `after-compile` `stress-expand` handler: at d12 it publishes
 * `registered=4117 inTree=4117 cloneOps=4094 journalCloneOps=4094` and — the
 * decisive gap — it publishes NO `states` / `elements` / `passes` field at all,
 * so the target census CANNOT be evaluated on it (the conversion is the
 * implementation that makes it evaluable). Measured in THIS file's own driver
 * (the page module run against its generated page, the smoke's own path):
 * d12 placement → 4117/4094/4094; d4 → 21/14/14 (all three methods); every run
 * publishes `states=undefined elements=undefined passes=undefined`.
 * **Every FD case below is therefore EXPECTED-RED today and GREEN after the
 * conversion** — the RED is the evidence the conversion is needed (spec §8.1),
 * never a reason to weaken an assertion.
 *
 * ── STATE ENUMERATION (what each case's states are) ─────────────────────────
 *   FD-1  census states @d12 × {placement, values, link}: the converted
 *         registered/inTree/unplaced/destroyed/cloneOps/states/elements/passes
 *         — plus the five stage boundaries of the emit pipeline (translate →
 *         register → compilePath → emitElements → diffMinimal → applyOps) with
 *         the registry's SIZE and OBJECT-IDENTITY array asserted unchanged.
 *   FD-2  per-depth states: d ∈ {2,4,6,12} × the same census derivation
 *         (`nodes = 2·depth − 1`, `states = elements = 2^depth − 1`) — the
 *         numbers are DERIVED here from the depth arithmetic and the static
 *         family's measured values, never copied from the implementation. (That
 *         equality is per the RULED element relation; the one shallow
 *         exception — the childless-uncovered def-fill term at d2/link, which
 *         the placement-only sweep here never reaches — is derived and asserted
 *         in FD-7 / `derivedElements`, and in the P-TP-1 row comment.)
 *   FD-3  topology states @d4: level-1 producers (no `targetPlacement`), each
 *         level k ∈ [1,3] owning exactly ONE shared zone name behind TWO
 *         containers; the k ≥ 2 consumer edges naming `['zone-<k−1>']`.
 *   FD-4  values states @d4: root (no source) / level-1 / level ≥ 2; one
 *         authored value per prototype realised on EVERY path-state of that
 *         prototype (one provider, N wires).
 *   FD-5  link states @d4: standalone (forkKey = pathKey) / re-typed (bare wire,
 *         no forkKey) / level-1 (own def, no def content) / level ≥ 2 (parent
 *         def content) + the ZERO-clone arm over the WHOLE pipeline and the
 *         mandatory handler positive control in the same body.
 *   FD-6  pin states: (a) converted pipeline, (b) + k=2 injected clones,
 *         (c) the two published sources agreeing on a complete window.
 *   FD-7  cross-expression states: d ∈ {2,4,6} × three methods (static arm from
 *         the builder-derived `expected`, runtime arm from the page's published
 *         census) + the link variant's def-prototype object identity. Since
 *         2026-09-23 the element field is checked against the RULED relation
 *         `2^depth − 1 + the childless-uncovered def-fill term` (derived from
 *         the path enumeration) on BOTH arms — the term is non-zero only at
 *         d2/link (see the case and `derivedElements`).
 *   FD-8  not-a-duplicate states: the envelope is buildable from (depth,
 *         method) ALONE; the builder's `server-data` carries no compiled census
 *         expectation; the runtime census is derived from the envelope.
 *   Register rows P-IM-1/P-IM-2/P-IM-3/P-TP-1 execute as seeded generators
 *         (P-SM-2 is the harness-half row and lives in
 *         tests/unit/fork-stress-data-p3-guards.test.ts).
 *
 * ── FAIL-STATES (the documented fail-states this file covers) ───────────────
 *   · a node minted per path or per element (registered → 2^depth − 1)
 *   · a node RE-MINTED with the same id (the object-identity clause)
 *   · a clone reappearing anywhere in the family's construction
 *   · a `cloneOps` that is a literal or an arithmetic identity (the injected-
 *     clone arm must read k, never 0)
 *   · a truncated journal window publishing a silently under-counted census
 *   · a single-chain topology (the two siblings of a level owning DIFFERENT
 *     zone names) — the R2.2 multiplicity collapse
 *   · a per-PATH value instead of a per-prototype value (the values falsifier)
 *   · a link element that is not a `div`, misses its parent def's content, or
 *     carries the DEF's layer instead of its own (the re-typed-child falsifier)
 *   · the DFC-1 phantom regression (elements = 2·(2^depth − 1))
 *   · a conversion by wholesale copy of the static page (server-data carrying a
 *     compiled census expectation) — the FD-8 falsifier
 *
 * ── FALSIFICATION EVIDENCE (one line per case) ──────────────────────────────
 *   FD-1  a per-path mint publishes registered=4095 with a non-empty journal; an
 *         unconverted page publishes no states/elements/passes at all.
 *   FD-2  registered tracking 2^depth − 1 (the clone model) at any depth.
 *   FD-3  an envelope whose level-k prototypes own k different names, or a
 *         level-1 prototype carrying a `targetPlacement`.
 *   FD-4  an element whose text lacks `value-<SLOT>-<k>`, or one whose value
 *         differs between two path-states of the SAME prototype.
 *   FD-5  a non-`div` element, missing `link-<k−1>.<slot>` content, a def layer
 *         leaking onto the child, a re-typed count ≠ 2^d − 1 − 3, or ANY
 *         non-zero `clone()` call on the family's own pipeline (spy).
 *   FD-6  the injected-clone arm reading 0 (a constant census), or registered
 *         reaching 2^depth − 1 while cloneOps stays 0.
 *   FD-7  the runtime side alone moving to 2^depth − 1, or cloneOps ≠ 0 on
 *         either side; and on the ELEMENT field — after the 2026-09-23 re-point
 *         the expectation is DERIVED, so its falsifier is: a def-fill that fires
 *         where it must not (any depth ≥ 3 or d2/placement|values → the
 *         derivation reads 2^depth − 1 there and the extra 4 fails it), a fill
 *         that STOPS firing at d2/link (→ 3 ≠ 7), or a DFC-1 phantom
 *         (2·(2^depth − 1)) — on either arm.
 *   FD-8  a conversion that embeds the static family's `expected`/`serverTreeSig`.
 */
import { describe, it, expect, vi, afterAll, beforeAll, afterEach } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { Node, Supervisor } from '../../src/core/node.js'
import { EventBridge } from '../../src/core/events.js'
import { createClient } from '../../src/core/client.js'
import { translateLegacy } from '../../src/core/translate.js'
import { emitElements, applyOps as applyOpsReal } from '../../src/core/render-helpers.js'
import { diffMinimal, MockAdapter } from '../../src/core/render.js'
import { setCompilePassLogging } from '../../src/core/debug.js'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..', '..')

/** Import a plain-JS repo module by ABSOLUTE PATH (non-literal specifier: the
 *  demo modules carry no declarations, and the native import must resolve their
 *  own `../dist/core/*` imports exactly as `scripts/demo-smoke.mjs` does). */
async function importFile(absPath, query) {
  return await import(/* @vite-ignore */ query ? `${absPath}?${query}` : absPath)
}

// ---------------------------------------------------------------------------
// CONSOLE SUPPRESSION — the page module enables the engine's compile-pass
// logging at import (`setCompilePassLogging(true)`), which floods stderr with
// one line per compile pass (thousands at d12) and would bury both the vitest
// reporter and this file's own register report lines. The suppression is
// file-scoped (installed once) and the `[fork-stress-data:profile]` line is
// captured for diagnostics; the flag itself is turned back OFF in a finally
// block on every run and again in afterAll via the core API.
// ---------------------------------------------------------------------------
const profileLines = []
let realLog = null
let realInfo = null
beforeAll(() => {
  realLog = console.log
  realInfo = console.info
  console.log = (...a) => {
    const s = a.map(String).join(' ')
    if (s.startsWith('[fork-stress-data:profile]')) profileLines.push(s)
    else process.stdout.write(`${s}\n`)
  }
  console.info = () => {}
})
afterAll(() => {
  if (realLog) console.log = realLog
  if (realInfo) console.info = realInfo
  // no logging-flag leak into any other suite sharing this worker
  setCompilePassLogging(false)
  Reflect.deleteProperty(globalThis, 'setCompilePassLogging')
  Reflect.deleteProperty(globalThis, 'document')
  Reflect.deleteProperty(globalThis, 'window')
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** The generated page artifact the page run needs (the smoke's own path: the
 *  page module + the built page HTML). Absent on a clean checkout → the page
 *  cases report a precise SKIP reason instead of failing on a missing build. */
const PLACEMENT_D12 = 'demo/fork-stress-data-placement-d12.html'
const D2_PAGE = 'demo/fork-stress-data-d2.html'
const ARTIFACTS_PRESENT = existsSync(join(REPO, PLACEMENT_D12)) && existsSync(join(REPO, D2_PAGE))
const ARTIFACT_REASON = `demo artifacts absent — run \`npm run demo:build\` + \`node scripts/build-demo.mjs\` first (${PLACEMENT_D12} / ${D2_PAGE})`
if (!ARTIFACTS_PRESENT) console.warn(`[fork-stress-data-p3] SKIPPING the page-driven cases: ${ARTIFACT_REASON}`)

// ===========================================================================
// THE PAGE DRIVER — run the family's REAL page module (the module whose census
// the smoke pins) against a page built for (depth, method), and return the
// profile it PUBLISHES. This is the honest observable: a test-local
// re-implementation of the pipeline could not see the family's own assembly
// (its handler-driven clone expansion lives inside the module), and would
// report a census the page never produces.
// ===========================================================================
const pageCache = new Map()

async function runFamilyPage(depth, method) {
  const key = `${depth}:${method}`
  if (pageCache.has(key)) return await pageCache.get(key)
  const p = (async () => {
    if (!ARTIFACTS_PRESENT) return { skipped: ARTIFACT_REASON, profile: null }
    const builderMod = await importFile(join(REPO, 'scripts', 'fork-stress-data-page.mjs'))
    const { buildForkStressDataPage } = builderMod
    const { html } = await buildForkStressDataPage(depth, method)
    const shimMod = await importFile(join(REPO, 'scripts', 'smoke-shim.mjs'))
    const { installSmokeShim } = shimMod
    installSmokeShim().seedPage(html)
    const g = globalThis
    // BOTH global pairs are accepted: the family's own (`__forkStressDataDone` /
    // `__forkStressDataProfile`) and the static reference page's pair
    // (`__pathForkDone` / `__pathForkProfile`), because the spec's K5/§7
    // disposition lets the converted page adopt the static family's contract —
    // and a conversion that went that far must not fail on a global NAME. The
    // keys are resolved AFTER the import (the module body sets them
    // synchronously); the profile is then read from the same pair.
    // a FRESH module instance per (depth, method): the query busts the module
    // cache, the page's guarded browser block runs again with the new envelope
    let importError = null
    let doneKey = null
    let profKey = null
    try {
      await importFile(join(REPO, 'demo', 'fork-stress-data.js'), `${depth}-${method}`)
      doneKey = g.__forkStressDataDone !== undefined ? '__forkStressDataDone'
        : g.__pathForkDone !== undefined ? '__pathForkDone' : '__forkStressDataDone'
      profKey = doneKey === '__forkStressDataDone' ? '__forkStressDataProfile' : '__pathForkProfile'
      const done = Promise.race([g[doneKey], new Promise((r) => setTimeout(r, 60_000))])
      await done.catch(() => undefined)
    } catch (e) {
      importError = `the ${depth}/${method} page module import threw: ${e?.message ?? e}`
      doneKey = doneKey ?? '__forkStressDataDone'
      profKey = profKey ?? '__forkStressDataProfile'
    } finally {
      // the page set the engine's compile-pass logging ON at import; turn it
      // back off immediately so the rest of this suite (and any suite sharing
      // this worker) is quiet
      setCompilePassLogging(false)
    }
    const profile = g[profKey] ?? g.__forkStressDataProfile ?? g.__pathForkProfile ?? null
    // HYGIENE: the shim installed `document`/`window` on globalThis for the
    // page's sake, and the module set the compile-pass-logging global — delete
    // them so nothing leaks into a later suite sharing this worker. (The FD-5
    // DomAdapter case installs its OWN shim for the window it needs.)
    Reflect.deleteProperty(g, 'document')
    Reflect.deleteProperty(g, 'window')
    Reflect.deleteProperty(g, 'setCompilePassLogging')
    return { skipped: importError, profile, html, doneKey, profKey }
  })()
  pageCache.set(key, p)
  return await p
}

/** The published profile, with the page-driven cases' skip semantics: an absent
 *  artifact is a SKIP with the reason (never a silent pass), a run that
 *  published nothing is a FAILURE (a page that profiles nothing cannot be
 *  pinned). */
async function pageProfile(depth, method) {
  const run = await runFamilyPage(depth, method)
  if (run.skipped) return { profile: null, skipReason: run.skipped }
  if (run.profile === null || typeof run.profile !== 'object') {
    return { profile: null, skipReason: `the ${depth}/${method} page run published no profile on globalThis.${run.profKey} — the page did not finish profiling` }
  }
  return { profile: run.profile, skipReason: null }
}

// ===========================================================================
// THE PATH-ENUMERATION PIPELINE (in-test) — the converted model applied to the
// family's own envelope. Used where the observable is a per-path-state fact the
// page's profile cannot publish (element text, def content, tag types, registry
// object identity). It is the SAME five steps the static reference page runs
// (`demo/path-fork-data.js:395-401`), transcribed from the spec — never from
// the family's current implementation.
// ===========================================================================
function enumeration(envelope) {
  const translated = translateLegacy(envelope)
  const supervisor = new Supervisor({ events: new EventBridge() })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const snapshot = supervisor.allNodes().slice()
  const states = []
  for (const n of supervisor.allNodes()) states.push(...n.compilePath().actionable)
  supervisor.recordResolved(states)
  const byId = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = emitElements(states, byId)
  const ops = diffMinimal(null, els)
  return { translated, supervisor, snapshot, states, byId, els, ops }
}

/** THE RULED ELEMENT RELATION (re-pointed 2026-09-23 — see FD-7 for the ruling
 *  and the mechanism reference): the emitted element count of a fork family is
 *  `2^depth − 1` PLUS the standalone P-EMIT-3 def-fill children of every
 *  def-host path-state that is CHILDLESS and UNCOVERED
 *  (`src/core/render-helpers.ts:743-746`). Derived HERE from the family's own
 *  path enumeration — never a literal, never a read of the builder's numbers —
 *  so the shallow case cannot drift silently:
 *    · a def host is a path-state carrying a link-def binding (`type` present);
 *    · CHILDLESS is `(s.children ?? []).length === 0` — the state owns no
 *      path-derived children, which is what makes the gate's first clause fire;
 *    · UNCOVERED is `trace.length === 2` — a state that arrived as another
 *      host's def-re-typed child is `defCovered` and its own fill is skipped
 *      (`:743`'s `coveredChildless` gate, `:745`'s standalone-emission guard,
 *      which never suppresses a genuine fill);
 *    · the term is that host's `def.children.length`.
 *  MEASURED (2026-09-23, both families, d ∈ {2,3,4,6,12} × the three methods):
 *  the term is 0 everywhere EXCEPT d2/link, where the two level-1 prototypes
 *  are direct root children with childless path-states and a 2-child def
 *  (`3 + 2·2 = 7`). */
function derivedElements(envelope, depth) {
  const { states } = enumeration(envelope)
  const base = 2 ** depth - 1
  const fillHosts = []
  let defFill = 0
  for (const s of states) {
    const def = Object.values(s.bindings ?? {}).find((v) => v && typeof v === 'object' && v.type !== undefined)
    if (!def) continue // not a def host — the def-fill branch cannot fire
    if ((s.children ?? []).length !== 0) continue // populated host: the re-typing branch, never the fill
    if ((s.trace ?? []).length !== 2) continue // arrived as a def-re-typed child (defCovered) — the gate skips it
    const n = Array.isArray(def.children) ? def.children.length : 0
    defFill += n
    fillHosts.push(`${s.pathKey}:${n}`)
  }
  return { base, defFill, value: base + defFill, fillHosts }
}

/** The family's envelope (the DATA export the builder embeds). */
async function familyEnvelope(depth, method) {
  const mod = await importFile(join(REPO, 'demo', 'fork-stress-data.js'))
  return mod.forkStressLegacyData(depth, method)
}

/** The AUTHORED prototype node an injected `clone-instance` op copies — the
 *  first translated NON-ROOT node. Deliberately sourced from the translated
 *  NODES (never from `root.children`): the converted envelope is free to move
 *  the level-1 prototypes between `template.root.children` and the content
 *  payload, and an injection helper that hard-coded the clone-era envelope
 *  layout would break for a legal conversion (it would then fail on the
 *  ENVELOPE SHAPE rather than on the property the arm exists to prove). */
function injectableSource(translated) {
  return translated.nodes.find((n) => n !== translated.root)
}

/** A FREE child order on the root for an injected `clone-instance` op. The op's
 *  `priority` is an ORDER in the host link's child cell, and a taken order is
 *  rejected `unique-order` (`src/core/link.ts:96-107`; `effectiveOrder(a) =
 *  a.options.priority ?? a.options.order`), so the op follows `ops.md` §2.3's
 *  max+1 rule instead of guessing from an anchor COUNT (the pre-2026-09-22
 *  `anchorsOf('parent').length` form collided and rejected the op outright:
 *  measured 2026-09-22, `priority 0`/`1` are taken and only `≥ 2` applies).
 *  The order is read from the HOST link (`root.anchors`' `parent` anchor — the
 *  landed NC-1e helper shape at
 *  `tests/unit/no-clone-invariants.test.ts:382-389`), not from the root's OWN
 *  `childAnchor()`, which is a different link and reports the wrong cell.
 *  **This is a HELPER fix, not a re-point:** the injected arm is the §5
 *  `P-IM-3` liveness proof and MUST stay green (`EXPECTED-RED`/`HELD` rows
 *  alike), and a helper that cannot drive the sanctioned route would silence
 *  the row instead of proving it. Nothing the arm ASSERTS is changed. */
function freeChildOrder(host) {
  const link = host.anchors?.find((a) => a.role === 'parent')?.link
  const kids = link?.anchorsOf ? link.anchorsOf('child') : []
  let max = -1
  for (const k of kids) max = Math.max(max, k.options?.priority ?? k.options?.order ?? -1)
  return max + 1
}

/** Inject `k` explicit `clone-instance` ops through the documented
 *  `clientAPI.apply` route on a FRESH translation of the family envelope, and
 *  return the measured census (the §5 P-IM-3 arm (b) falsifier, shared by FD-5's
 *  positive control, FD-6(b) and the P-IM-3 row). */
async function injectedCloneArm(depth, method, k) {
  const t = translateLegacy(await familyEnvelope(depth, method))
  const sup = new Supervisor({ events: new EventBridge() })
  for (const n of t.nodes) sup.registerNode(n)
  const client = createClient(sup)
  const source = injectableSource(t)
  if (!source) return { ok: false, why: 'the translated envelope holds no non-root node to clone' }
  const base = freeChildOrder(t.root)
  for (let i = 0; i < k; i += 1) {
    const r = client.apply(source.id, {
      kind: 'clone-instance',
      source: source.id,
      slot: t.root,
      priority: base + i,
    })
    if (r.status !== 'applied') return { ok: false, why: `injected op ${i} rejected: ${r.status} (order ${base + i} on the root)` }
  }
  const measured = measuredCloneInstances(sup)
  return { ok: true, measured, copies: sup.allNodes().filter((n) => n.runtimeMinted), registered: sup.allNodes().length, t, sup, source }
}

// ===========================================================================
// FD-1 — K1/K2: the d12 census, per method, + the five stage boundaries
// ===========================================================================
describe('FD-1 — the converted family census at d12 (K1/K2)', () => {
  const D = 12

  it(`FD-1 census @d12: registered=inTree=${2 * D - 1}, unplaced=destroyed=0, cloneOps=0, states=elements=${2 ** D - 1}, passes=1 — per method`, async () => {
    // FALSIFICATION: an unconverted page publishes NO states/elements/passes
    // (today: undefined) and a per-path mint publishes registered = 2^depth − 1
    // with a non-empty journal; a clone reappearing reads cloneOps > 0.
    for (const method of ['placement', 'values', 'link']) {
      const { profile, skipReason } = await pageProfile(D, method)
      if (skipReason) {
        expect(skipReason, `the page-driven case could not run: ${skipReason}`).toBe(null)
        continue
      }
      expect(profile.registered, `${method} d${D}: registered (a node minted per path would read ${2 ** D - 1})`).toBe(2 * D - 1)
      expect(profile.inTree, `${method} d${D}: inTree`).toBe(2 * D - 1)
      expect(profile.unplaced, `${method} d${D}: unplaced`).toBe(0)
      expect(profile.destroyed, `${method} d${D}: destroyed`).toBe(0)
      expect(profile.cloneOps, `${method} d${D}: cloneOps (a clone reappearing reads non-zero)`).toBe(0)
      expect(profile.states, `${method} d${D}: states`).toBe(2 ** D - 1)
      expect(profile.elements, `${method} d${D}: elements (a DFC-1 phantom reads 2·(2^d − 1))`).toBe(2 ** D - 1)
      expect(profile.passes, `${method} d${D}: passes (ONE enumeration bootstrap)`).toBe(1)
    }
  }, 120_000)

  it('FD-1 registry: the node census and its OBJECT IDENTITY are unchanged across translate → compilePath → emitElements → diffMinimal → applyOps', async () => {
    // FALSIFICATION: a size-only check misses a same-id re-mint; this case fails
    // on any boundary where an entry is replaced by an equal-but-distinct object
    // (and on any boundary where the size grows — the per-path mint).
    const envelope = await familyEnvelope(4, 'placement')
    const translated = translateLegacy(envelope)
    const supervisor = new Supervisor({ events: new EventBridge() })
    const boundaries = []
    const snap = (label) => {
      const all = supervisor.allNodes()
      boundaries.push({ label, size: all.length, objs: all.slice() })
    }
    for (const n of translated.nodes) supervisor.registerNode(n)
    snap('register')
    const states = []
    for (const n of supervisor.allNodes()) states.push(...n.compilePath().actionable)
    snap('compilePath')
    supervisor.recordResolved(states)
    snap('recordResolved')
    const byId = new Map(supervisor.allNodes().map((n) => [n.id, n]))
    const els = emitElements(states, byId)
    snap('emitElements')
    const ops = diffMinimal(null, els)
    const adapter = countingAdapter()
    applyOpsReal(adapter, ops)
    snap('applyOps')

    const first = boundaries[0]
    for (const b of boundaries.slice(1)) {
      expect(b.size, `registry size moved ${first.size} → ${b.size} at "${b.label}"`).toBe(first.size)
      for (let i = 0; i < first.size; i += 1) {
        expect(b.objs[i], `registry entry ${i} (id ${first.objs[i]?.id}) was RE-MINTED at "${b.label}" — new object, same position`).toBe(first.objs[i])
      }
    }
    // the enumeration is REAL at this depth: 2^4 − 1 states over 7 nodes
    expect(states.length).toBe(2 ** 4 - 1)
    expect(adapter.ops.length).toBeGreaterThan(0)
  }, 30_000)
})

// ===========================================================================
// FD-2 — K2: the per-depth generalisation
// ===========================================================================
describe('FD-2 — the per-depth generalisation (K2)', () => {
  // DERIVED HERE, not copied from the implementation:
  //   prototypes = 2·(depth − 1) (two slots per layer 1..depth−1)
  //   nodes      = prototypes + root = 2·depth − 1
  //   states     = Σ 2^k for k = 1..depth−1, + root = 2^depth − 1 (= elements)
  // The static family's own measured values confirm the derivation at
  // d2/d4/d6/d12 (3/7/11/23 nodes; 3/15/63/4095 states).
  const DERIVED = {
    2: { nodes: 3, states: 3 },
    3: { nodes: 5, states: 7 },
    4: { nodes: 7, states: 15 },
    6: { nodes: 11, states: 63 },
    12: { nodes: 23, states: 4095 },
    14: { nodes: 27, states: 16383 },
  }

  it('FD-2 the derived table itself: nodes = 2·depth − 1 and states = 2^depth − 1 (incl. the d14 probe — the node count is NOT depth-invariant at 23)', () => {
    for (const [d, want] of Object.entries(DERIVED)) {
      const depth = Number(d)
      expect(2 * depth - 1, `nodes @d${depth}`).toBe(want.nodes)
      expect(2 ** depth - 1, `states @d${depth}`).toBe(want.states)
      expect(2 * (depth - 1) + 1, `nodes (long form) @d${depth}`).toBe(want.nodes)
    }
    // the spec's explicit warning: 23 holds ONLY at d12
    expect(DERIVED[12].nodes).toBe(23)
    expect(DERIVED[14].nodes).not.toBe(23)
  })

  it('FD-2 the family matches the derivation at every swept depth (states = elements = 2^depth − 1, registered = inTree = 2·depth − 1, cloneOps = 0)', async () => {
    // FALSIFICATION: the clone model's registered = 2^depth − 1 + 2·(depth−1)
    // + clones (4117 at d12, 21 at d4) and its absent states/elements field.
    const sweep = [2, 4, 6, 12]
    const seen = []
    for (const depth of sweep) {
      const { profile, skipReason } = await pageProfile(depth, 'placement')
      if (skipReason) {
        expect(skipReason, `depth ${depth}: page-driven case could not run: ${skipReason}`).toBe(null)
        continue
      }
      const want = DERIVED[depth]
      seen.push(depth)
      expect(profile.registered, `d${depth}: registered (derived ${want.nodes})`).toBe(want.nodes)
      expect(profile.inTree, `d${depth}: inTree (derived ${want.nodes})`).toBe(want.nodes)
      expect(profile.states, `d${depth}: states (derived ${want.states})`).toBe(want.states)
      expect(profile.elements, `d${depth}: elements (derived ${want.states})`).toBe(want.states)
      expect(profile.cloneOps, `d${depth}: cloneOps (0 at EVERY depth)`).toBe(0)
    }
    // the sweep actually ran (anti-vacuity: a skipped sweep asserts nothing)
    expect(seen, 'the depth sweep ran no page').toEqual(sweep)
  }, 120_000)
})

// ===========================================================================
// FD-3 — K2/K1: the R2.2 sibling-shared owner-name topology
// ===========================================================================
describe('FD-3 — the R2.2 topology of the converted envelope (K1/K2)', () => {
  it('FD-3 @d4: each level k ∈ [1,3] has TWO prototypes owning ONE shared zone name; k ≥ 2 consumers target [zone-<k−1>]; level 1 has no targetPlacement', async () => {
    // FALSIFICATION: the pre-conversion envelope has NO `placement` field at all
    // (it declares `handlers` + `stress:handler` instead), so every clause here
    // fails with `undefined`; a single-chain envelope (each prototype owning a
    // DISTINCT name per level) fails the "one shared name, two containers" clause.
    const depth = 4
    const env = await familyEnvelope(depth, 'placement')
    const l1 = env.template.root.children
    const rest = env.content[0].content
    expect(l1, 'level-1 prototypes are template.root.children').toHaveLength(2)
    expect(rest, 'levels 2..depth−1 are the content payload').toHaveLength(2 * (depth - 2))

    for (let k = 1; k <= depth - 1; k += 1) {
      const layer = k === 1 ? l1 : rest.filter((p) => p.props['stress:layer'] === k)
      expect(layer, `level ${k}: exactly two prototypes`).toHaveLength(2)
      const names = layer.map((p) => p.placement?.placementName)
      expect(names, `level ${k}: both prototypes own the SAME shared zone name (the R2.2 multiplicity)`).toEqual([`zone-${k}`, `zone-${k}`])
      expect(new Set(names).size, `level ${k}: distinct owner names (a distinct-name topology collapses the tree to a single chain)`).toBe(1)
      const containers = new Set(layer.map((p) => p.placement?.placementName))
      expect(containers.size, `level ${k}: ONE container name behind TWO containers`).toBe(1)
      for (const p of layer) {
        if (k === 1) {
          expect(p.placement?.targetPlacement, `level 1 (${p.props['stress:slot']}): producers only — no consumer side`).toBeUndefined()
        } else {
          expect(p.placement?.targetPlacement, `level ${k} (${p.props['stress:slot']}): requests the level above's SHARED name`).toEqual([`zone-${k - 1}`])
        }
      }
    }
    // the removed clone-model residue: the conversion deletes the handler
    // declaration, the per-node handler prop and the mechanism label
    expect(env.template.root.handlers, 'no `handlers` on the root').toBeUndefined()
    for (const p of [...l1, ...rest]) {
      expect(p.handlers, `prototype ${p.props['stress:slot']}: no handler declaration (the family no longer expands after compile)`).toBeUndefined()
      expect(p.props['stress:handler'], `prototype ${p.props['stress:slot']}: no stress:handler prop`).toBeUndefined()
    }
    expect(JSON.stringify(env).includes('stress-expand'), 'the envelope still names the clone-expansion handler').toBe(false)
  })

  it('FD-3 the topology actually MULTIPLIES: the path enumeration over that envelope yields 2^d − 1 states over 2·d − 1 nodes', async () => {
    // FALSIFICATION: an envelope without the shared-name multiplicity enumerates
    // a chain (d states) instead of 2^d − 1 — this is the arithmetic reading of
    // the R2.2 clause, and it is RED today (the envelope declares no placement,
    // so the enumeration finds no paths at all).
    const depth = 4
    const env = await familyEnvelope(depth, 'placement')
    const { states, snapshot, els } = enumeration(env)
    expect(snapshot.length, 'graph nodes (2·depth − 1)').toBe(2 * depth - 1)
    expect(states.length, 'path-states (2^depth − 1)').toBe(2 ** depth - 1)
    expect(els.length, 'emitted elements').toBe(2 ** depth - 1)
    expect(new Set(states.map((s) => s.pathKey)).size, 'distinct pathKeys').toBe(2 ** depth - 1)
  }, 30_000)
})

// ===========================================================================
// FD-4 — K3 values: the path-state expression of the value-bearing source
// ===========================================================================
describe('FD-4 — the values variant over path-states (K3)', () => {
  it('FD-4 @d4: every non-root path-state element carries `value-<SLOT>-<k>` for the PROTOTYPE it points at, on EVERY path-state of that prototype', async () => {
    // FALSIFICATION: today the envelope carries the component only on the
    // pre-conversion shape and the enumeration finds no paths, so elements for
    // non-root states do not exist at all; a per-PATH value (differing between
    // two path-states of the same prototype) fails the multiplicity clause.
    const depth = 4
    const env = await familyEnvelope(depth, 'values')
    const { states, byId, els } = enumeration(env)
    const elOfState = new Map(els.map((e) => [`${e.wire}\u0000${e.forkKey ?? ''}`, e]))
    const seenByProto = new Map()
    let checked = 0
    for (const s of states) {
      const proto = byId.get(s.nodeId)
      const k = proto?.props?.['stress:layer']
      if (k === undefined) continue // the root carries no source
      const slot = proto.props['stress:slot']
      const expected = `value-${slot.toUpperCase()}-${k}`
      const el = elOfState.get(`${s.pathKey}\u0000${s.pathKey}`)
      expect(el, `no element emitted for path-state ${s.pathKey} (the enumeration must be live)`).toBeDefined()
      expect(el.forkKey, `path-state ${s.pathKey}: standalone element keyed by its OWN pathKey`).toBe(s.pathKey)
      expect(stringOf(el.props?.text), `state ${s.pathKey} (L${k}${slot}): text lacks "${expected}"`).toContain(expected)
      const key = `${s.nodeId}`
      const texts = seenByProto.get(key) ?? new Set()
      texts.add(stringOf(el.props?.text))
      seenByProto.set(key, texts)
      checked += 1
    }
    // ONE authored value per prototype → ONE text on ALL path-states of it
    let multiPathProtos = 0
    for (const [nodeId, texts] of seenByProto) {
      expect(texts.size, `prototype ${nodeId}: its path-states carry ${texts.size} DIFFERENT texts — the value is keyed per PATH, not per (prototype, layer, slot)`).toBe(1)
      const count = states.filter((s) => s.nodeId === nodeId).length
      if (count > 1) multiPathProtos += 1
    }
    expect(checked, 'no non-root path-state was checked').toBe(2 ** depth - 2)
    // anti-vacuity: the multiplicity is really exercised (level ≥ 2 prototypes
    // own several path-states each at this depth)
    expect(multiPathProtos, 'no prototype owned more than one path-state — the one-provider-N-wires clause would be vacuous').toBeGreaterThan(0)
  }, 30_000)

  it('FD-4 the values envelope is data-declared only: a `component.reference`/`value` pair on every prototype, and NO page-side anchor attach', async () => {
    // FALSIFICATION: a variant realised by a page-side `addComponentSource`
    // (the K4 data-authoring failure) leaves the envelope without the declared
    // component, so this clause fails while the page still "works".
    const env = await familyEnvelope(4, 'values')
    const protos = [...env.template.root.children, ...env.content[0].content]
    expect(protos.length).toBe(2 * 3)
    for (const p of protos) {
      const k = p.props['stress:layer']
      const slot = p.props['stress:slot']
      expect(p.component, `prototype L${k}${slot}: no declared component source`).toBeDefined()
      expect(p.component.reference).toBe(`values-${k}.${slot}`)
      expect(p.component.value).toBe(`value-${slot.toUpperCase()}-${k}`)
      // a `theme` binding would win the scalar pick and change the text source
      expect(p.props['theme'], `prototype L${k}${slot}: a theme binding would displace the declared scalar`).toBeUndefined()
    }
  })
})

// ===========================================================================
// FD-5 — K3 link: the path-state def chain + the K8 ZERO-clone case
// ===========================================================================
describe('FD-5 — the link variant over path-states + ZERO clones (K3/K8)', () => {
  it('FD-5 (i)–(v) @d4: div re-type, parent def content, the CHILD\'s own layer props, the re-typed count 2^d−1−3, and elements = 2^d−1', async () => {
    // FALSIFICATION: a non-div element (a def that did not re-type), missing
    // `link-<k−1>.<slot>` content (the def chain broken), the DEF's layer leaking
    // onto the child (the dead-def-css lesson), a re-typed count ≠ 2^d−1−3 (the
    // adapter-key asymmetry lost), or elements = 2·(2^d − 1) (the DFC-1 phantom
    // regression, 8191 at d12).
    const depth = 4
    const env = await familyEnvelope(depth, 'link')
    const { states, byId, els, ops } = enumeration(env)
    expect(els.length, 'elements = 2^depth − 1 (a phantom regression reads 2·(2^d − 1))').toBe(2 ** depth - 1)
    const elOfState = new Map(els.map((e) => [e.wire, e]))
    let level1 = 0
    for (const s of states) {
      const proto = byId.get(s.nodeId)
      const k = proto?.props?.['stress:layer']
      if (k === undefined) continue // the root carries no def
      const slot = proto.props['stress:slot']
      const el = elOfState.get(s.pathKey)
      expect(el, `no element emitted for path-state ${s.pathKey}`).toBeDefined()
      expect(String(el.type).toLowerCase(), `state ${s.pathKey} (L${k}): expected div (the def's type), got ${el.type}`).toBe('div')
      if (k === 1) level1 += 1
      if (k > 1) {
        expect(stringOf(el.props?.text), `state ${s.pathKey} (L${k}): text lacks the PARENT def's content "link-${k - 1}.${slot}"`).toContain(`link-${k - 1}.${slot}`)
      }
      // the re-typed element carries the CHILD's OWN props, never the def's
      expect(stringOf(el.props?.['prop:data-depth'] ?? el.props?.['data-depth']), `state ${s.pathKey} (L${k}): data-depth is not the child's own level`).toBe(String(k))
      expect(stringOf(el.props?.['prop:stress:layer'] ?? el.props?.['stress:layer']), `state ${s.pathKey} (L${k}): stress:layer is not the child's own level`).toBe(String(k))
    }
    // the adapter-key asymmetry: covered re-typed children are bare-keyed (no
    // forkKey); only the root + all level-1 states (3) are standalone
    const retyped = els.filter((e) => e.forkKey === undefined)
    expect(retyped.length, 're-typed (bare-keyed) def-chain elements').toBe(2 ** depth - 1 - 3)
    expect(retyped.length).toBeGreaterThan(0)
    expect(retyped.every((e) => !String(e.wire).includes('\u0000')), 'a re-typed element was stored under a composite key').toBe(true)
    expect(level1).toBe(2)

    // the DOM-LEVEL reading of the same clause (the static page's own shape:
    // `wireOf`/`elText` over the adapter's elements): the re-typed child carries
    // the CHILD's data-depth/stress:layer ATTRIBUTES, never the def's. This is
    // the clause the dead-def-css lesson is about, read where a page would read it.
    const { installSmokeShim } = await importFile(join(REPO, 'scripts', 'smoke-shim.mjs'))
    const shim = installSmokeShim()
    try {
      const domMod = await importFile(join(REPO, 'dist', 'core', 'adapters.js'))
      const adapter = new domMod.DomAdapter(globalThis.document.getElementById('app'))
      adapter.beginBatch()
      applyOpsReal(adapter, ops)
      adapter.endBatch()
      const retypedStates = states.filter((s) => byId.get(s.nodeId)?.props?.['stress:layer'] > 1)
      expect(retypedStates.length, 'no level ≥ 2 path-state to read from the DOM').toBeGreaterThan(0)
      for (const s of retypedStates) {
        const k = byId.get(s.nodeId).props['stress:layer']
        const el = adapter.wires.get(s.pathKey)
        expect(el, `no DOM element for re-typed path-state ${s.pathKey} (bare-keyed lookup — the adapter-key asymmetry)`).toBeDefined()
        expect(el.getAttribute('data-depth'), `state ${s.pathKey} (L${k}): the DOM element's data-depth is not the CHILD's own level`).toBe(String(k))
        expect(el.getAttribute('stress:layer'), `state ${s.pathKey} (L${k}): the DOM element's stress:layer is not the CHILD's own level`).toBe(String(k))
      }
    } finally {
      Reflect.deleteProperty(globalThis, 'document')
      Reflect.deleteProperty(globalThis, 'window')
    }
  }, 30_000)

  it('FD-5 (vi) the family\'s own pipeline calls clone() ZERO times — with the mandatory handler positive control in the SAME body', async () => {
    // THE OWED ZERO-SIDE CASE (§3 K8): no existing case asserts that a
    // page-family pipeline performing 4095-path enumeration calls clone() zero
    // times. FALSIFICATION: any clone() on the family's pipeline shows as a
    // non-zero count with the stage printed; and a POSITIVE CONTROL of 0 means
    // the spy never matched ⇒ the row is UNDETERMINED, never HELD (NC-1e rule).
    const coreNodeMod = await importFile(join(REPO, 'dist', 'core', 'node.js'))
    const DistNode = coreNodeMod.Node
    const clientMod = await importFile(join(REPO, 'dist', 'core', 'client.js'))
    const distTranslateMod = await importFile(join(REPO, 'dist', 'core', 'translate.js'))
    const distSupervisorMod = await importFile(join(REPO, 'dist', 'core', 'supervisor.js'))
    const distEventsMod = await importFile(join(REPO, 'dist', 'core', 'events.js'))
    const spy = vi.spyOn(DistNode.prototype, 'clone')
    let controlCalls = 0
    let controlMinted = false
    let pipelineCalls = -1
    try {
      // ---- the family's own pipeline, under the spy -------------------------
      const env = await familyEnvelope(4, 'link')
      const pipeline = enumeration(env)
      expect(pipeline.states.length, 'the family pipeline emitted no path-states — the ZERO clause would be vacuous').toBe(2 ** 4 - 1)
      pipelineCalls = spy.mock.calls.length
      expect(
        pipelineCalls,
        `the family's path-enumeration pipeline called clone() ${pipelineCalls} time(s) — the converted family must call it ZERO times (E2E-1)`,
      ).toBe(0)

      // ---- the MANDATORY positive control, same body, same spy --------------
      // the sanctioned handler route stays drivable from a page-shaped caller:
      // 2 explicit clone-instance ops through `clientAPI.apply`
      spy.mockClear()
      const t = distTranslateMod.translateLegacy(await familyEnvelope(2, 'placement'))
      const sup = new distSupervisorMod.Supervisor({ events: new distEventsMod.EventBridge() })
      for (const n of t.nodes) sup.registerNode(n)
      const client = clientMod.createClient(sup)
      const source = injectableSource(t)
      expect(source, 'the translated envelope holds no non-root node to clone').toBeDefined()
      const controlBase = freeChildOrder(t.root)
      for (let i = 0; i < 2; i += 1) {
        const r = client.apply(source.id, {
          kind: 'clone-instance',
          source: source.id,
          slot: t.root,
          priority: controlBase + i,
        })
        expect(r.status, `control op ${i} rejected: ${r.status} (order ${controlBase + i} on the root)`).toBe('applied')
      }
      controlCalls = spy.mock.calls.length
      const copies = sup.allNodes().filter((n) => n.runtimeMinted)
      controlMinted = copies.length === 2 && copies.every((c) => c.runtimeMinted === true)
      expect(controlMinted, 'a control copy is not runtimeMinted').toBe(true)
    } finally {
      vi.restoreAllMocks()
    }
    // asserted AFTER the report: a control of 0 proves the spy never matched
    expect(controlCalls, 'FD-5 positive control never fired — the ZERO reading is UNDETERMINED, never evidence').toBe(2)
  }, 60_000)
})

// ===========================================================================
// FD-6 — K6: the clone-count pin + its falsifiability arm
// ===========================================================================
describe('FD-6 — the K6 pin and its falsifiability (K6)', () => {
  it('FD-6 (a) the converted pipeline: measured cloneOps = 0, journalCloneOps = 0, an empty clone-instance count, cloneOpKinds published, complete window', async () => {
    // FALSIFICATION: today the family reads 4094/4094 at d12 (measured in this
    // file's driver) and 14/14 at d4; a literal `cloneOps: 0` on a journal that
    // holds clone-instance entries fails the journal-count clause.
    const { profile, skipReason } = await pageProfile(4, 'placement')
    if (skipReason) {
      expect(skipReason, `FD-6 could not run: ${skipReason}`).toBe(null)
      return
    }
    expect(profile.cloneOps, 'the published census field').toBe(0)
    expect(profile.journalCloneOps, 'the independent per-kind walk').toBe(0)
    expect(typeof profile.cloneOpKinds, 'cloneOpKinds must be published (the journal composition is evidence, not an assertion inside the walk)').toBe('object')
    expect(profile.cloneOpKinds?.['clone-instance'] ?? 0, 'the per-kind tally still counts clone-instance entries').toBe(0)
    expect(profile.journalEntries, 'a converted family applies NO ops — the journal is empty').toBe(0)
    // the two published sources must agree (an alias would make this vacuous)
    expect(profile.cloneOps, 'the two independent sources must agree').toBe(profile.journalCloneOps)
  })

  it('FD-6 (b) the FALSIFIER: the same envelope + k=2 injected clone-instance ops reads exactly 2, not 0', async () => {
    // The injected arm proves the pin is a MEASUREMENT, not a constant. It is
    // GREEN today and must STAY green after the conversion (spec §5 status
    // table: the arm is the row's liveness proof).
    const k = 2
    const arm = await injectedCloneArm(2, 'placement', k)
    expect(arm.ok, `the injected arm could not be driven: ${arm.why}`).toBe(true)
    expect(arm.copies, 'every injected copy must be runtimeMinted').toHaveLength(k)
    expect(arm.copies.every((c) => c.runtimeMinted === true)).toBe(true)
    expect(arm.measured.complete, `the journal window is incomplete: ${JSON.stringify(arm.measured)}`).toBe(true)
    expect(arm.measured.count, 'the measured clone census on the injected pipeline').toBe(k)
    expect(arm.measured.count, 'the falsifier: a constant census would read 0 here').not.toBe(0)
    // the node-growth companion: a clone ADDS a node, so the injected pipeline's
    // registry exceeds 2·depth − 1 — the pair (cloneOps, registered) is what the
    // pin asserts (K6-e)
    expect(arm.registered, 'a clone adds a node — the injected registry exceeds 2·depth − 1').toBeGreaterThan(2 * 2 - 1)
  })

  it('FD-6 (c) the pin is the PAIR: registered = inTree = 2·depth − 1 with cloneOps = 0 — a per-path mint (cloneOps 0!) is caught by the node half', async () => {
    // The user's ruling's exact failure mode: `cloneOps === 0` AND
    // `registered === 2^depth − 1` must hold TOGETHER; a cloneOps-only pin would
    // pass while 4095 nodes were minted per path.
    const depth = 4
    const { profile, skipReason } = await pageProfile(depth, 'placement')
    if (skipReason) {
      expect(skipReason, `FD-6 could not run: ${skipReason}`).toBe(null)
      return
    }
    expect(profile.cloneOps, `d${depth}: cloneOps`).toBe(0)
    expect(profile.registered, `d${depth}: registered = 2·(depth−1) + 1 (a node per path would read 2^depth − 1)`).toBe(2 * depth - 1)
    expect(profile.inTree, `d${depth}: inTree = registered (every prototype is contentNodes-owned — F-13)`).toBe(2 * depth - 1)
    expect(profile.states, `d${depth}: the wire multiplicity carries the tree, not the nodes`).toBe(2 ** depth - 1)
  })

  it('FD-6 (d) the measurement refuses an incomplete window instead of publishing an under-count', () => {
    // FALSIFICATION: the K6-c clause — a truncated window silently under-counting
    // is the same defect class as a literal. The measurement helper must THROW.
    const incomplete = { entries: [], totalEntries: 500, fromIndex: 400, truncated: true }
    expect(() => measuredFromView(incomplete)).toThrow(/window incomplete/i)
    // and a complete window in either accepted form does NOT throw
    expect(measuredFromView({ entries: [], totalEntries: 0, fromIndex: 0, truncated: false })).toBe(0)
    expect(measuredFromView({ entries: [], totalEntries: 0, fromIndex: 0, truncated: true })).toBe(0)
    // a genuinely under-counted but "complete-looking" window is caught by the
    // fromIndex/entries clause
    expect(() => measuredFromView({ entries: [{ kind: 'state-slice' }], totalEntries: 9, fromIndex: 4, truncated: true })).toThrow(/window incomplete/i)
  })
})

// ===========================================================================
// FD-7 — K7: the re-derived cross-expression equality
// ===========================================================================
describe('FD-7 — the re-derived cross-expression equality (K7)', () => {
  it('FD-7 every censused field agrees between the static derived family and the converted data-driven family — both sides independently derived', async () => {
    // FALSIFICATION: today the two sides differ by 4094 in every node field
    // (4117 vs 23 at d12) and the runtime side publishes no states/elements at
    // all; a per-path mint moves ONLY the runtime side to 2^d − 1. The ELEMENT
    // count keeps its own falsifier after the 2026-09-23 re-point: the
    // expectation is DERIVED from the ruled relation below, so a def-fill that
    // fires where it must not (any depth ≥ 3, or d2/placement|values → 2^d − 1
    // + 4), a def-fill that stops firing at d2/link (→ 2^d − 1 = 3), or a
    // DFC-1 phantom (2·(2^d − 1)) each move one side off the derivation and
    // fail here.
    // ── THE RULED ELEMENT RELATION (re-pointed 2026-09-23; supersedes the bare
    // `2^depth − 1` this case used to hard-code at every swept depth/method) ──
    // The engine emits `2^depth − 1` elements PLUS the standalone P-EMIT-3
    // def-fill children of every def-host path-state that is CHILDLESS and
    // UNCOVERED (`src/core/render-helpers.ts:743-746`: `coveredChildless =
    // covered && children.length === 0`; `:744-746` then pushes
    // `emitted.defChildren` only when the state is NOT covered-childless and its
    // def child is not standalone-emitted). At `depth = 2` the family's
    // level-1 prototypes are DIRECT ROOT CHILDREN (never def re-typed children,
    // so no `defCovered` entry) and their path-states are childless — the
    // `link` method is the only one that puts a component DEF on them — so the
    // branch fires for the two level-1 hosts and adds `2 × 2 = 4`
    // (`3 + 4 = 7`). At `depth ≥ 3` those same level-1 states own their
    // path-derived children (the level-2 states) and the DEEPEST leaves are the
    // covered-childless ones, where the gate fires as it must and the fill is
    // correctly SKIPPED — so the count is exactly `2^depth − 1` at every method
    // (measured 2026-09-23: the relation holds on BOTH families at
    // d ∈ {2,3,4,6,12} × {placement, values, link}; user ruling: DOCUMENTED
    // behaviour, NOT an engine defect — the expectation is corrected, the
    // engine is not).
    const staticMod = await importFile(join(REPO, 'demo', 'path-fork-data.js'))
    for (const method of ['placement', 'values', 'link']) {
      for (const depth of [2, 4, 6]) {
        const built = staticMod.pathForkServerData(method, depth)
        const e = built.expected
        // THE DERIVATION (independent of the builder's own numbers): enumerate
        // the family's path-states and sum the def-fill term the rule above
        // names — a def-host state with NO children that is a direct child of
        // the root state (`trace.length === 2`, i.e. it cannot have arrived as
        // another host's def-re-typed child) contributes its def's child count.
        const derived = derivedElements(await familyEnvelope(depth, method), depth)
        // the base is the state count by construction (the two axes the K7
        // equality pins together); a divergence here means the derivation's
        // premise — one element per path-state — no longer holds
        expect(
          derived.base,
          `static arm d${depth}/${method}: the derivation's base (2^${depth} − 1 = ${derived.base}) must be the enumerated path-state count`,
        ).toBe(e.states)
        // the static side is the BUILDER-COMPUTED expression (2·depth−1 /
        // 2^depth−1 + the ruled def-fill term)
        expect(e.nodes, `static arm d${depth}: nodes`).toBe(2 * depth - 1)
        expect(e.states, `static arm d${depth}: states`).toBe(2 ** depth - 1)
        expect(
          e.elements,
          `static arm d${depth}/${method}: the builder's elements expectation must equal the RULED relation 2^depth − 1 + the childless-uncovered def-fill term (derived here as ${derived.base} + ${derived.defFill} = ${derived.value}; the d2/link case is the one depth where the term is non-zero — render-helpers.ts:743-746)`,
        ).toBe(derived.value)
        expect(e.cloneOps, `static arm d${depth}: cloneOps`).toBe(0)
        const staticCensus = {
          registered: e.nodes,
          inTree: e.nodes,
          unplaced: e.unplaced,
          destroyed: 0,
          cloneOps: e.cloneOps,
          states: e.states,
          elements: e.elements,
        }
        const { profile, skipReason } = await pageProfile(depth, method)
        if (skipReason) {
          expect(skipReason, `FD-7 d${depth}/${method} could not run: ${skipReason}`).toBe(null)
          continue
        }
        const runtimeCensus = {
          registered: profile.registered,
          inTree: profile.inTree,
          unplaced: profile.unplaced,
          destroyed: profile.destroyed,
          cloneOps: profile.cloneOps,
          states: profile.states,
          elements: profile.elements,
        }
        for (const field of Object.keys(staticCensus)) {
          expect(
            runtimeCensus[field],
            `K7(${field}) @d${depth}/${method}: the runtime census ${field}=${runtimeCensus[field]} ≠ the static expectation ${staticCensus[field]} — the two expressions must agree (the runtime-vs-static difference is 0 in every field)`,
          ).toBe(staticCensus[field])
        }
        expect(runtimeCensus.cloneOps, `@d${depth}/${method}: cloneOps must be 0 on BOTH sides`).toBe(0)
        // the RUNTIME side is checked against the SAME ruled derivation (an
        // independent observable — the page's published census, not the builder)
        // so a def-fill that over/under-fires at ANY swept depth/method fails
        // here even if the builder agreed with it
        expect(
          runtimeCensus.elements,
          `@d${depth}/${method}: the runtime census elements=${runtimeCensus.elements} ≠ the ruled relation ${derived.base} + ${derived.defFill} = ${derived.value} (def-fill hosts: ${derived.fillHosts.join(', ') || 'none'}; the fill fires only on CHILDLESS uncovered level-1 def hosts — render-helpers.ts:743-746)`,
        ).toBe(derived.value)
        // the static side must NOT be a page-side alias of the runtime side:
        // it is constructed from the depth arithmetic only
        expect(JSON.stringify(built.expected).includes('serverTreeSig'), 'the static arm is the builder-derived expression').toBe(false)
      }
    }
  }, 120_000)

  it('FD-7 the link variant is a path-state def-chain consumer: ONE authored def value per prototype → the SAME def-root object behind every consumer', async () => {
    // I3 applied to the converted family: a component is resolution + seam, never
    // a copy. FALSIFICATION: a per-consumer def mint shows as several distinct
    // def objects (each `bindings` map a NEW object) behind the path-states of
    // one prototype.
    const depth = 4
    const env = await familyEnvelope(depth, 'link')
    const { states, byId } = enumeration(env)
    const perNode = new Map()
    let consumers = 0
    for (const s of states) {
      const proto = byId.get(s.nodeId)
      if (proto?.props?.['stress:layer'] === undefined) continue
      const defs = Object.values(s.bindings ?? {}).filter((v) => v && typeof v === 'object' && v.type !== undefined)
      expect(defs.length, `state ${s.pathKey}: the def binding is not carried on the resolved state`).toBeGreaterThan(0)
      const set = perNode.get(s.nodeId) ?? new Set()
      for (const d of defs) set.add(d)
      perNode.set(s.nodeId, set)
      consumers += 1
    }
    expect(consumers, 'no def-carrying path-state was found').toBeGreaterThan(0)
    for (const [nodeId, defs] of perNode) {
      expect(defs.size, `prototype ${nodeId}: ${defs.size} DISTINCT def objects behind its path-state consumers — a per-consumer mint copies the def`).toBe(1)
    }
    // and the object identity survives the pass: the same def object is what the
    // authored envelope declared (one authored value per prototype)
    const authored = [...env.template.root.children, ...env.content[0].content]
    expect(authored.length).toBe(2 * (depth - 1))
    for (const p of authored) {
      expect(p.component?.value, `prototype L${p.props['stress:layer']}${p.props['stress:slot']}: no authored def declared`).toBeDefined()
    }
  }, 30_000)
})

// ===========================================================================
// FD-8 — K5: the family is not a duplicate of the static family
// ===========================================================================
describe('FD-8 — the family is not a duplicate of the static family (K5)', () => {
  it('FD-8 the envelope + census are derivable from (depth, method) ALONE — no builder-computed expectation is needed', async () => {
    // FALSIFICATION: a conversion that makes the envelope's construction depend
    // on a pre-computed surface (or a page that reads `expected` from
    // `server-data` rather than deriving) cannot satisfy this clause; and a
    // conversion that leaves the family cloning fails the census derivation.
    const env = await familyEnvelope(4, 'values')
    expect(env.template, 'the envelope is a legacy envelope built from (depth, method) alone').toBeDefined()
    expect(env.clientConfig, 'the envelope carries its own clientConfig').toBeDefined()
    const { states, els } = enumeration(env)
    const depth = 4
    expect(states.length, 'the runtime derivation yields 2^depth − 1 with no builder input').toBe(2 ** depth - 1)
    expect(els.length).toBe(2 ** depth - 1)
  })

  it('FD-8 the builder\'s server-data carries NO compiled census expectation (no `expected.nodes/states/elements/cloneOps`, no `serverTreeSig`, no SSR sample)', async () => {
    // THE copy-wholesale falsifier: an implementer who converts by copying
    // `demo/path-fork-data.js` embeds its `expected` census + `serverTreeSig` and
    // FAILS here — the family would then be redundant (K5).
    const builderMod = await importFile(join(REPO, 'scripts', 'fork-stress-data-page.mjs'))
    const { serverData } = await builderMod.buildForkStressDataPage(4, 'placement')
    expect(typeof serverData.depth, 'server-data carries the depth token').toBe('number')
    expect(serverData.depth).toBe(4)
    expect(serverData.method).toBe('placement')
    for (const forbidden of ['expected', 'serverTreeSig', 'expectedSsrSample']) {
      expect(serverData[forbidden], `server-data must NOT carry "${forbidden}" (the static family's builder-computed surface)`).toBeUndefined()
    }
    const serialized = JSON.stringify(serverData)
    for (const token of ['serverTreeSig', 'expectedSsrSample']) {
      expect(serialized.includes(token), `server-data still embeds "${token}"`).toBe(false)
    }
    const expected = serverData.expected ?? {}
    for (const field of ['nodes', 'states', 'elements', 'cloneOps', 'inTree']) {
      expect(expected[field], `server-data.expected.${field} is a builder-computed CENSUS expectation — the converted family must derive its census at runtime (K5)`).toBeUndefined()
    }
  })

  it('FD-8 the family\'s runtime census is a pure RUNTIME measurement (the page the builder did not measure publishes the live census)', async () => {
    // The static family's expectations are embedded by its builder; this family's
    // value is that its census is measured live. FALSIFICATION: the unconverted
    // page publishes a clone-model census (4117/4094 at d12, 21/14 at d4) and no
    // states/elements, i.e. a builder-side expectation would be the only way to
    // "pass" it.
    const { profile, skipReason } = await pageProfile(4, 'placement')
    if (skipReason) {
      expect(skipReason, `FD-8 could not run: ${skipReason}`).toBe(null)
      return
    }
    const derived = { registered: 2 * 4 - 1, states: 2 ** 4 - 1, cloneOps: 0 }
    expect(profile.registered, 'the runtime census is a live measurement, not an embedded expectation').toBe(derived.registered)
    expect(profile.states).toBe(derived.states)
    expect(profile.cloneOps).toBe(derived.cloneOps)
  })
})

// ===========================================================================
// §5 THE TYPED PROPERTY REGISTER — executed seeded generators
// ===========================================================================
const PINNED_SEED = 20260922
const PER_ROW_ATTEMPTS = 6
const TOTAL_ATTEMPTS_BUDGET = 400
let totalAttempts = 0

/** Inline seeded PRNG (mulberry32) — no new dependency (spec §8.4). */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function drawInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1))
}

/** The four-value report vocabulary (§8.4): HELD / BROKEN / EXPECTED-RED /
 *  UNDETERMINED. The line is emitted BEFORE the assertions. */
const rowReports = []
function reportRow(row) {
  const line = `[fork-stress-data-p3:register] seed=${PINNED_SEED} row=${row.id} strategy=${row.strategy} status=${row.status} attempts=${row.attempts} failures=${row.failures} liveness=${row.liveness} counterexample=${row.counterexample}`
  console.log(line)
  rowReports.push(row)
  return line
}

/** ROW-SCOPED liveness: a note is accepted only when it names the row it
 *  belongs to — a pooled sink could report an earlier row's note as a later
 *  row's liveness (the `no-clone-invariants.test.ts` T10 lesson). Returns the
 *  accepted liveness text, or a contamination failure string. */
function acceptLivenessNote(id, note) {
  if (note === null) return { liveness: null, contamination: null }
  if (note.startsWith(`row=${id} `)) return { liveness: note, contamination: null }
  return { liveness: null, contamination: `liveness note does not belong to row ${id}: "${note}"` }
}

/** Drive one register row's generator to the budget rules (≤ PER_ROW_ATTEMPTS
 *  per row, ≤ TOTAL_ATTEMPTS_BUDGET overall, stop after 5 failures per row).
 *  The generator may be asynchronous (the page-profile arms await page runs). */
async function runRow(id, strategy, seed, attemptFn) {
  const rng = mulberry32(seed)
  let attempts = 0
  let failures = 0
  let counterexample = 'none'
  let liveness = 'none'
  while (attempts < PER_ROW_ATTEMPTS && failures < 5 && totalAttempts < TOTAL_ATTEMPTS_BUDGET) {
    attempts += 1
    totalAttempts += 1
    let note = null
    let failure = null
    try {
      failure = await attemptFn(rng, attempts, (t) => { note = t })
    } catch (e) {
      failure = `threw: ${e?.message ?? e}`
    }
    if (failure === null) {
      const accepted = acceptLivenessNote(id, note)
      if (accepted.contamination) {
        failures += 1
        if (counterexample === 'none') counterexample = accepted.contamination
      } else if (accepted.liveness) {
        liveness = accepted.liveness
      }
    } else {
      failures += 1
      if (counterexample === 'none') counterexample = failure
    }
  }
  return { attempts, failures, counterexample, liveness }
}

/** The clone census MEASUREMENT (§3 I5 / K6-b/c) over a live supervisor: the
 *  `clone-instance` entries of the whole journal, read through the paged
 *  accessor, with the window-completeness guard. */
function measuredCloneInstances(sup) {
  let seen = 0
  let totalEntries = 0
  let count = 0
  let after = 0
  let complete = false
  for (;;) {
    const view = sup.journalEntries({ afterIndex: after, limit: 1000 })
    totalEntries = view.totalEntries
    for (const e of view.entries) {
      seen += 1
      if (e.kind === 'clone-instance') count += 1
    }
    if (view.truncated === false || view.entries.length === 0 || view.fromIndex + view.entries.length >= totalEntries) {
      complete = view.truncated === false || (view.fromIndex === 0 && seen === totalEntries)
      break
    }
    after = view.fromIndex + view.entries.length
  }
  return { count, totalEntries, seen, complete }
}

/** The K6-c window-completeness rule as a standalone function (the page's
 *  `measuredCloneOps` THROWS on an incomplete window — this is the same
 *  contract, exercised directly by FD-6(d)). */
function measuredFromView(view) {
  const complete = view.truncated === false || (view.fromIndex === 0 && view.entries.length === view.totalEntries)
  if (!complete) {
    throw new Error(`clone census: journal window incomplete (fromIndex=${view.fromIndex} entries=${view.entries.length} totalEntries=${view.totalEntries} truncated=${view.truncated}) — refusing to publish a silently under-counted cloneOps`)
  }
  return view.entries.filter((e) => e.kind === 'clone-instance').length
}

/** A counting render adapter (the pipeline's applyOps target) — the core's own
 *  MockAdapter records every op, so the applyOps boundary is observable. */
function countingAdapter() {
  const a = new MockAdapter()
  return {
    adapter: a,
    get ops() { return a.calls },
    createEl: (...args) => a.createEl(...args),
    setProp: (...args) => a.setProp(...args),
    appendChild: (...args) => a.appendChild(...args),
    hydrate: (...args) => a.hydrate(...args),
    removeEl: (...args) => a.removeEl(...args),
  }
}

/** Coerce an emitted prop to a string without tripping on undefined. */
function stringOf(v) {
  if (v === undefined || v === null) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

/** Run ONE path-enumeration attempt over a generated envelope: the static arm
 *  (`demo/path-fork-data.js`) or the data-driven arm (`demo/fork-stress-data.js`)
 *  — both through the SAME five-step pipeline, so the arms differ only in the
 *  ENVELOPE they enumerate. */
async function enumerateArm(arm, depth, method, rng) {
  const mod = arm === 'static'
    ? await importFile(join(REPO, 'demo', 'path-fork-data.js'))
    : await importFile(join(REPO, 'demo', 'fork-stress-data.js'))
  const env = arm === 'static'
    ? mod.pathForkLegacyData(method, depth)
    : mod.forkStressLegacyData(depth, method)
  const run = enumeration(env)
  const r = rng()
  return { ...run, env, r }
}

/** The page-profile arm for the rows whose property is about the family's
 *  PUBLISHED census (K6/K7): the observable the smoke pins. */
async function profileArm(depth, method) {
  const { profile, skipReason } = await pageProfile(depth, method)
  return { profile, skipReason }
}

// ---- P-IM-1 — census invariance across the five stage boundaries -----------
const P_IM_1_ID = 'P-IM-1'
const P_IM_1_STRATEGY = 'node-growth:none(stages=5)/static+data-driven(d[3,6])/nodeRatio>1'

/** P-IM-1's per-attempt generator: enumerate one generated envelope and assert
 *  no node growth across the pipeline, by SIZE and by OBJECT IDENTITY. */
async function pim1Attempt(arm, rng, note) {
  const depth = drawInt(rng, 3, 6)
  const method = ['placement', 'values', 'link'][Math.floor(rng() * 3)]
  const { states, els, snapshot, supervisor } = await enumerateArm(arm, depth, method, rng)
  // LIVE CLAUSE 1 (the d ≥ 3 axis-separation floor): states > nodes strictly
  if (!(states.length > snapshot.length)) {
    return `d${depth}: states=${states.length} ≤ nodes=${snapshot.length} — the nodeRatio is not > 1 (the row would be vacuous at this depth)`
  }
  // LIVE CLAUSE 2: the enumeration must emit something
  if (els.length === 0) return `d${depth}/${method}: no element emitted — "no growth" would be vacuous`
  // LIVE CLAUSE 3 / the property's own demand: the enumeration must be COMPLETE
  if (states.length !== 2 ** depth - 1) {
    return `d${depth}/${method}: states=${states.length} ≠ 2^depth − 1 = ${2 ** depth - 1} — the family does not enumerate its paths (the unconverted envelope declares no placement, so no path exists)`
  }
  // THE PROPERTY: no registry growth and no same-position re-mint
  const after = supervisor.allNodes()
  if (after.length !== snapshot.length) return `registry size moved ${snapshot.length} → ${after.length} across the pipeline`
  const remint = snapshot.findIndex((n, idx) => after[idx] !== n)
  if (remint >= 0) return `registry entry ${remint} (id ${snapshot[remint].id}) was RE-MINTED across the pipeline — new object, same id`
  note(`row=${P_IM_1_ID}/${arm} d${depth} ${method} nodes=${snapshot.length} states=${states.length} ratio=${(states.length / snapshot.length).toFixed(2)}`)
  return null
}

describe(`P-IM-1 census invariance (strategy ${P_IM_1_STRATEGY})`, () => {
  it('P-IM-1 reports its §8.4 line with BOTH arms HELD: the STATIC control and the DATA-DRIVEN arm over the converted family', async () => {
    // FALSIFICATION: registered rising at any boundary; an entry replaced by an
    // equal-but-distinct object (the identity clause); a per-path node appearing
    // as the depth grows (states > nodes strictly beyond d ≥ 3); an unconverted
    // envelope that enumerates no path at all (pre-2026-09-22 state).
    // ── WHY THE DATA-DRIVEN ARM IS `HELD` AFTER THE CONVERSION (re-derived from
    // this generator's own clauses, not flipped): `pim1Attempt` returns a
    // failure string on ONLY three conditions — (1) `states > nodes` fails (the
    // d ≥ 3 liveness floor), (2) no element emitted, (3) `states ≠ 2^d − 1`, plus
    // the property itself: registry size moving or an entry re-minted. On the
    // CONVERTED envelope the family declares the R2.2 placement topology, so
    // `pathEnumeration` yields exactly `2^d − 1` path-states over `2d − 1`
    // nodes (clause 3 satisfied, clause 1 `2^d − 1 > 2d − 1` at every d ≥ 3),
    // `emitElements` emits one element per path-state (clause 2), and no pass
    // mints or re-mints a node (the property). ⇒ zero failures ⇒ `HELD`.
    // **historical note:** the data-driven arm was `EXPECTED-RED` before the
    // 2026-09-22 conversion (then: 1 state per prototype, no path enumeration).
    const armStatuses = {}
    for (const arm of ['static', 'data-driven']) {
      const outcome = await runRow(`${P_IM_1_ID}/${arm}`, P_IM_1_STRATEGY, PINNED_SEED + (arm === 'static' ? 11 : 12),
        (rng, _attempt, note) => pim1Attempt(arm, rng, note))
      armStatuses[arm] = outcome.failures > 0 ? 'EXPECTED-RED' : 'HELD'
      reportRow({
        id: `${P_IM_1_ID}/${arm}`,
        strategy: P_IM_1_STRATEGY,
        status: armStatuses[arm],
        attempts: outcome.attempts,
        failures: outcome.failures,
        liveness: outcome.liveness,
        counterexample: outcome.counterexample,
      })
    }
    // the arms are reported SEPARATELY (spec §5: the static arm is the row's
    // built-in control — reporting only the red would hide that the property is
    // already satisfiable)
    expect(Object.keys(armStatuses).sort()).toEqual(['data-driven', 'static'])
    expect(armStatuses.static, 'P-IM-1 STATIC arm: the property already holds on the reference envelope (the row\'s built-in control)').toBe('HELD')
    expect(armStatuses['data-driven'], 'P-IM-1 DATA-DRIVEN arm: the conversion makes the family enumerate its paths with no node growth, so the row derives HELD (a `registered` that rises between stages, or a re-minted entry, must return it to red — see the re-derivation comment above)').toBe('HELD')
  }, 120_000)
})

// ---- P-IM-2 — one node, many paths over the converted family ---------------
const P_IM_2_ID = 'P-IM-2'
const P_IM_2_STRATEGY = 'identity:nodeId∈registry/distinct=2d−1/states=2^d−1/forkKey=pathKey/no-arm-suffix'

/** P-IM-2's per-attempt generator: the identity/multiplicity pairing. */
async function pim2Attempt(arm, rng, attempt, note) {
  const depth = drawInt(rng, 3, 6)
  // the row's second live clause: at least one attempt per row carries a
  // link-method envelope (the def-chain consumer shape over the same node set)
  const method = attempt === 1 ? 'link' : ['placement', 'values', 'link'][Math.floor(rng() * 3)]
  const { states, snapshot, byId } = await enumerateArm(arm, depth, method, rng)
  const ids = new Set(snapshot.map((n) => n.id))
  // LIVE: the two axes must be separable (7 > 5 at d3, growing)
  if (!(2 ** depth - 1 > 2 * depth - 1)) return `d${depth}: 2^d − 1 ≤ 2d − 1 — "wires exceed nodes" is not meaningful here`
  // LIVE: the state count must be the FULL enumeration
  if (states.length !== 2 ** depth - 1) {
    return `d${depth}/${method}: states=${states.length} ≠ 2^depth − 1 = ${2 ** depth - 1} — the family does not enumerate (the unconverted envelope declares no placement, so every prototype yields exactly ONE state)`
  }
  // THE PROPERTY: distinct nodeIds = 2d − 1 while states = 2^d − 1 (the
  // multiplicity rides the WIRE, not the node)
  const distinct = new Set(states.map((s) => s.nodeId)).size
  if (distinct !== 2 * depth - 1) return `d${depth}: distinct nodeIds=${distinct} ≠ 2d − 1 = ${2 * depth - 1}`
  if (states.length === snapshot.length) return `d${depth}: the state count collapsed onto the node count (the two axes are one number)`
  for (const s of states) {
    if (!ids.has(s.nodeId)) return `state ${s.pathKey}: nodeId ${s.nodeId} is not a registry id`
    if (s.forkKey !== s.pathKey) return `state ${s.pathKey}: forkKey=${s.forkKey} ≠ pathKey`
    if (String(s.pathKey).includes('#')) return `state ${s.pathKey}: an arm suffix leaked into the pathKey`
    if (s.pathKey !== 'root' && !String(s.pathKey).startsWith('root/')) return `state ${s.pathKey}: bad pathKey`
  }
  if (byId.size < 2 * depth - 1) return `d${depth}: nodeById holds ${byId.size} nodes`
  note(`row=${P_IM_2_ID}/${arm} d${depth} ${method} distinct=${distinct} states=${states.length} ratio=${((2 ** depth - 1) / (2 * depth - 1)).toFixed(2)}`)
  return null
}

describe(`P-IM-2 one node, many paths (strategy ${P_IM_2_STRATEGY})`, () => {
  it('P-IM-2 reports its §8.4 line with BOTH arms HELD: the STATIC control and the DATA-DRIVEN arm over the converted family', async () => {
    // FALSIFICATION: a state whose nodeId is not a registry id; a distinct-nodeId
    // count that grows with the state count; forkKey ≠ pathKey; an arm suffix
    // (`#`) leaking into a pathKey; a state count equal to the node count (the
    // multiplicity collapsing onto the nodes — what the unconverted family does).
    // ── WHY THE DATA-DRIVEN ARM IS `HELD` AFTER THE CONVERSION (re-derived from
    // this generator's own clauses): `pim2Attempt` fails on (1) `2^d − 1 ≤ 2d − 1`
    // (the axis-separation liveness floor, satisfied at every d ≥ 3), (2)
    // `states ≠ 2^d − 1`, (3) `distinct nodeId ≠ 2d − 1`, (4) states collapsing
    // onto the node count, and then the per-state identity clauses. On the
    // CONVERTED envelope the path enumeration produces exactly `2^d − 1` states
    // over the `2d − 1` translated nodes, every state carrying `forkKey ===
    // pathKey` and a `pathKey` under `root` (never an `#` arm suffix), and the
    // link-method attempt (attempt 1) exercises the def-chain consumer shape on
    // the same node set. ⇒ zero failures ⇒ `HELD`.
    // **historical note:** the data-driven arm was `EXPECTED-RED` before the
    // 2026-09-22 conversion (then: `states = 1` per prototype).
    const armStatuses = {}
    for (const arm of ['static', 'data-driven']) {
      const outcome = await runRow(`${P_IM_2_ID}/${arm}`, P_IM_2_STRATEGY, PINNED_SEED + (arm === 'static' ? 21 : 22),
        (rng, attempt, note) => pim2Attempt(arm, rng, attempt, note))
      armStatuses[arm] = outcome.failures > 0 ? 'EXPECTED-RED' : 'HELD'
      reportRow({
        id: `${P_IM_2_ID}/${arm}`,
        strategy: P_IM_2_STRATEGY,
        status: armStatuses[arm],
        attempts: outcome.attempts,
        failures: outcome.failures,
        liveness: outcome.liveness,
        counterexample: outcome.counterexample,
      })
    }
    expect(armStatuses.static, 'P-IM-2 STATIC arm: the property already holds on the reference envelope').toBe('HELD')
    expect(armStatuses['data-driven'], 'P-IM-2 DATA-DRIVEN arm: the conversion makes every path-state point at a translated node id with the multiplicity on the WIRE, so the row derives HELD (a growing distinct-nodeId count, a `forkKey` ≠ `pathKey`, or an `#` suffix in a `pathKey` must return it to red — see the re-derivation comment above)').toBe('HELD')
  }, 120_000)
})

// ---- P-IM-3 — the clone-count ZERO pin, falsifiable ------------------------
const P_IM_3_ID = 'P-IM-3'
const P_IM_3_STRATEGY = 'clone-census:zero(page-profile)/injected(k[1,3],MANDATORY)/per-path-node(registered=2d−1)'

/** The MANDATORY injected-clone falsifier (§5 P-IM-3 arm (b)): apply `k`
 *  explicit clone-instance ops on a FRESH translation of the family envelope and
 *  require the measured census to read EXACTLY k (never 0 — a constant census
 *  fails here). GREEN today and it must STAY green. */
async function pim3InjectedArm(k) {
  const arm = await injectedCloneArm(2, 'placement', k)
  if (!arm.ok) return arm
  const measured = arm.measured
  if (!measured.complete) return { ok: false, why: `the journal window is incomplete: ${JSON.stringify(measured)}` }
  if (measured.count !== k) return { ok: false, why: `the injected arm read ${measured.count} ≠ k=${k} (a constant census fails here)` }
  if (measured.count === 0) return { ok: false, why: 'the injected arm read 0 — the measurement never matched (UNDETERMINED)' }
  return { ok: true, count: measured.count, registered: arm.registered }
}

describe(`P-IM-3 the clone-count ZERO pin (strategy ${P_IM_3_STRATEGY})`, () => {
  it('P-IM-3 reports its §8.4 line: the converted arm is HELD after the conversion, and the injected-clone (liveness) arm reads exactly k — green before AND after', async () => {
    // FALSIFICATION: a census reporting 0 while the journal holds clone-instance
    // entries; a CONSTANT census (the injected arm reads 0); a truncated window
    // silently under-counting; `registered` reaching 2^depth − 1 while cloneOps
    // stays 0 (the exact failure the user's ruling describes — a node minted per
    // path is NOT a clone, so a cloneOps-only pin would pass).
    // ── WHY THE ROW IS `HELD` AFTER THE CONVERSION (re-derived, not flipped):
    // the mandatory arm (b) is asserted FIRST on EVERY attempt and already reads
    // exactly `k ≠ 0` (green today — 5/5 on the pre-conversion run), so the row
    // is never `UNDETERMINED`. Arm (a) then demands the CONVERTED page's own
    // published census: `cloneOps === journalCloneOps === 0`, a zero
    // `cloneOpKinds['clone-instance']` tally, and arm (c) `registered ===
    // 2d − 1` with `states === 2^d − 1`. A converted family publishes exactly
    // those (§3 K2/K6), so `outcome.failures === 0` ⇒ `HELD`. The pin stays
    // falsifiable in the same body: arm (b)'s `k ≠ 0` reading is the proof the
    // measurement is real, and arm (c) catches the per-path mint that arm (a)'s
    // zero cannot see.
    // **historical note:** arm (a) was `EXPECTED-RED` before the 2026-09-22
    // conversion (then: `cloneOps = 4094`/`registered = 4117` at d12).
    let injectedOk = 0
    let injectedRuns = 0
    const outcome = await runRow(P_IM_3_ID, P_IM_3_STRATEGY, PINNED_SEED + 3, async (rng, attempt, note) => {
      const depth = [3, 4, 5, 6][(attempt - 1) % 4]
      const method = ['placement', 'values', 'link'][(attempt - 1) % 3]

      // ---- ARM (b) FIRST: the MANDATORY injected-clone falsifier -----------
      // Asserted BEFORE the converted arm (and before the row reports) so the
      // row's liveness proof is constructed on EVERY attempt — including the
      // attempts whose converted arm fails (today: all of them). A row that
      // skipped its falsifier whenever the converted arm failed would report
      // UNDETERMINED (or, worse, silently weaker evidence) for the one clause
      // that proves the measurement is real.
      const k = drawInt(rng, 1, 3)
      const injected = await pim3InjectedArm(k)
      injectedRuns += 1
      if (injected.ok) injectedOk += 1
      else return `the injected-clone falsifier (k=${k}) failed: ${injected.why} — the measurement is not live`

      const { profile, skipReason } = await profileArm(depth, method)
      if (skipReason) return `the ${depth}/${method} page run could not be driven: ${skipReason}`

      // ---- ARM (a) the converted pipeline: the published census must be 0 ----
      if (profile.cloneOps !== 0) return `d${depth}/${method}: cloneOps=${profile.cloneOps} ≠ 0 (the family still clones — §3 K6-a)`
      if (profile.journalCloneOps !== 0) return `d${depth}/${method}: journalCloneOps=${profile.journalCloneOps} ≠ 0`
      if (profile.cloneOps !== profile.journalCloneOps) return `d${depth}/${method}: the two published sources disagree (${profile.cloneOps} vs ${profile.journalCloneOps})`
      if (!(profile.cloneOpKinds && (profile.cloneOpKinds['clone-instance'] ?? 0) === 0)) {
        return `d${depth}/${method}: cloneOpKinds does not publish a zero clone-instance tally (${JSON.stringify(profile.cloneOpKinds)})`
      }
      // ---- ARM (c) the per-path-node clause (the failure a clone-only pin
      // cannot see): registered must be 2d − 1, NOT 2^d − 1 ------------------
      if (profile.registered !== 2 * depth - 1) {
        const perPath = profile.registered === 2 ** depth - 1 ? ' (a node minted per path-state while cloneOps stays 0 — the exact failure the ruling names)' : ''
        return `d${depth}/${method}: registered=${profile.registered} ≠ 2d − 1 = ${2 * depth - 1}${perPath}`
      }
      if (profile.states !== 2 ** depth - 1) return `d${depth}/${method}: states=${profile.states} ≠ 2^depth − 1 (the wire multiplicity is not published)`

      note(`row=${P_IM_3_ID} arm=converted d${depth} ${method} cloneOps=${profile.cloneOps} registered=${profile.registered} states=${profile.states} injected-k=${injected.count}`)
      return null
    })
    const rowStatus = injectedOk === 0 ? 'UNDETERMINED' : outcome.failures > 0 ? 'EXPECTED-RED' : 'HELD'
    reportRow({
      id: P_IM_3_ID,
      strategy: P_IM_3_STRATEGY,
      status: rowStatus,
      attempts: outcome.attempts,
      failures: outcome.failures,
      liveness: injectedOk > 0
        ? `injected-clone-arm=${injectedOk}/${injectedRuns} read exactly k ≠ 0 (the measurement is real) ${outcome.liveness}`
        : 'none',
      counterexample: outcome.counterexample,
    })
    // the anti-vacuity rule AS AN ASSERTION: a control that never read k means
    // the measurement never matched ⇒ UNDETERMINED, never HELD
    expect(injectedOk, 'P-IM-3 injected-clone arm never read k — the row MUST report UNDETERMINED, never HELD').toBeGreaterThan(0)
    expect(rowStatus, 'P-IM-3 arm (a): the converted family publishes a measured zero clone census with registered = 2d − 1 and states = 2^d − 1, so the row derives HELD (a non-zero measured cloneOps, a per-path `registered`, or an injected arm that never read k must move it off HELD)').toBe('HELD')
  }, 120_000)
})

// ---- P-TP-1 — the static-vs-data-driven cross-expression equality ----------
const P_TP_1_ID = 'P-TP-1'
const P_TP_1_STRATEGY = 'cross-expression:field-by-field(static builder vs runtime census) d[2,6]×method, both independently derived'

const P_TP_1_FIELDS = ['registered', 'inTree', 'unplaced', 'destroyed', 'cloneOps', 'states', 'elements']

describe(`P-TP-1 cross-expression equality (strategy ${P_TP_1_STRATEGY})`, () => {
  it('P-TP-1 reports its §8.4 line: HELD after the conversion — the two independently derived sides agree field-by-field', async () => {
    // FALSIFICATION: the two families disagreeing in any field (a per-path mint
    // moves ONLY the runtime side to 2^d − 1); cloneOps ≠ 0 on either side; a
    // MISSING field on the runtime profile (the row must FAIL, never skip); and
    // on the ELEMENT field, a def-fill that fires where it must not, or stops
    // firing at d2/link — whichever side gets the gate wrong moves that side's
    // count and the comparison fails.
    // ── WHY THE ROW IS `HELD` AFTER THE CONVERSION (re-derived from the two
    // arms, not flipped): the STATIC arm is the builder-computed expression from
    // `pathForkServerData(method, depth).expected` — `2d − 1` nodes, `2^d − 1`
    // states/elements, `cloneOps = 0` (asserted in-body before the comparison,
    // and green today). The ELEMENT field carries the ruled shallow-depth term:
    // `2^d − 1` PLUS the standalone P-EMIT-3 def-fill children of every
    // CHILDLESS, uncovered def-host path-state (`render-helpers.ts:743-746`) —
    // non-zero ONLY at d2/link (2 level-1 hosts × 2 def children = 4, so 7 ≠ 3;
    // ruled DOCUMENTED behaviour 2026-09-23, the SAME relation FD-7 derives).
    // The RUNTIME arm must publish the SAME seven fields from its OWN derivation
    // (live `allNodes()` + `journalEntries()`), which the converted family does
    // (§3 K2/K6) — no field can differ, and the two sides stay independently
    // derived (the static side is depth arithmetic; the runtime side is a
    // measurement). ⇒ zero failures ⇒ `HELD`. The liveness clause that keeps it
    // from being `x = x` is the asymmetry (§3 K7(c)): a per-path mint moves ONLY
    // the runtime side, a reappearing clone moves only `cloneOps`, and the
    // element relation moves whichever side implements the def-fill gate wrongly
    // — all remain asserted below.
    // **historical note:** the row was `EXPECTED-RED` before the 2026-09-22
    // conversion (then: static 23/0 vs runtime 4117/4094 at d12).
    let linkAttempts = 0
    const staticMod = await importFile(join(REPO, 'demo', 'path-fork-data.js'))
    const outcome = await runRow(P_TP_1_ID, P_TP_1_STRATEGY, PINNED_SEED + 5, async (rng, attempt, note) => {
      const depth = drawInt(rng, 2, 6)
      // the row's second live clause: at least one values and one link attempt
      const method = attempt === 1 ? 'values' : attempt === 2 ? 'link' : ['placement', 'values', 'link'][Math.floor(rng() * 3)]
      if (method === 'link') linkAttempts += 1
      // STATIC ARM — the BUILDER-COMPUTED expression (a pure function of depth:
      // 2·depth − 1 / 2^depth − 1 — never a page read)
      const built = staticMod.pathForkServerData(method, depth)
      const e = built.expected
      const staticCensus = {
        registered: e.nodes, inTree: e.nodes, unplaced: e.unplaced, destroyed: 0,
        cloneOps: e.cloneOps, states: e.states, elements: e.elements,
      }
      if (staticCensus.registered !== 2 * depth - 1) return `static arm d${depth}: registered=${staticCensus.registered} ≠ 2d − 1`
      if (staticCensus.states !== 2 ** depth - 1) return `static arm d${depth}: states=${staticCensus.states} ≠ 2^d − 1`
      if (staticCensus.cloneOps !== 0) return `static arm d${depth}: cloneOps=${staticCensus.cloneOps} ≠ 0`
      // RUNTIME ARM — the family's PUBLISHED census (a live measurement from
      // allNodes()/journalEntries(), a DIFFERENT derivation)
      const { profile, skipReason } = await profileArm(depth, method)
      if (skipReason) return `the ${depth}/${method} page run could not be driven: ${skipReason}`
      for (const f of P_TP_1_FIELDS) {
        if (typeof profile[f] !== 'number') {
          return `runtime arm d${depth}/${method}: the profile does not publish "${f}" (${JSON.stringify(profile[f])}) — a missing field must FAIL, never skip`
        }
        if (profile[f] !== staticCensus[f]) return `d${depth}/${method}: ${f}: runtime=${profile[f]} ≠ static=${staticCensus[f]}`
      }
      note(`row=${P_TP_1_ID} d${depth} ${method} static=${JSON.stringify(staticCensus)} runtime=${JSON.stringify(Object.fromEntries(P_TP_1_FIELDS.map((f) => [f, profile[f]])))}`)
      return null
    })
    const status = outcome.failures > 0 ? 'EXPECTED-RED' : 'HELD'
    reportRow({
      id: P_TP_1_ID,
      strategy: P_TP_1_STRATEGY,
      status,
      attempts: outcome.attempts,
      failures: outcome.failures,
      liveness: outcome.liveness,
      counterexample: outcome.counterexample,
    })
    expect(linkAttempts, 'P-TP-1 never drew a link-method attempt — the def-chain arm is uncovered').toBeGreaterThan(0)
    expect(status, 'P-TP-1: the two independently derived censuses agree in every field after the conversion, so the row derives HELD (any field disagreement — a per-path mint on the runtime side, or a non-zero cloneOps — must move it off HELD)').toBe('HELD')
  }, 120_000)
})


// ---- the register budget + the report contract -----------------------------
describe('the register execution contract (§8.4)', () => {
  it('every row reports id/strategy/status/attempts/failures/liveness/counterexample BEFORE its assertions, and the budget holds', () => {
    expect(rowReports.length, 'no register row reported its §8.4 line').toBeGreaterThan(0)
    const ids = new Set()
    for (const r of rowReports) {
      expect(['HELD', 'BROKEN', 'EXPECTED-RED', 'UNDETERMINED'], `${r.id}: status vocabulary`).toContain(r.status)
      expect(typeof r.attempts, `${r.id}: attempts must be reported`).toBe('number')
      expect(r.attempts).toBeLessThanOrEqual(PER_ROW_ATTEMPTS)
      expect(typeof r.failures, `${r.id}: failures must be reported`).toBe('number')
      expect(typeof r.liveness, `${r.id}: liveness must be reported (row-scoped, never pooled)`).toBe('string')
      expect(typeof r.counterexample, `${r.id}: counterexample must be reported`).toBe('string')
      const base = r.id.split('/')[0]
      ids.add(base)
      if (r.status === 'HELD') expect(r.failures, `${r.id}: HELD with failures reported`).toBe(0)
    }
    // the six-row register: four rows execute here, P-SM-2 executes in the
    // guards suite (its harness half)
    expect([...ids].sort()).toEqual([P_IM_1_ID, P_IM_2_ID, P_IM_3_ID, P_TP_1_ID].sort())
    expect(totalAttempts, 'the register exceeded its ≤400 total-attempt budget').toBeLessThanOrEqual(TOTAL_ATTEMPTS_BUDGET)
    console.log(`[fork-stress-data-p3:register] seed=${PINNED_SEED} total-attempts=${totalAttempts} rows=${rowReports.map((r) => `${r.id}:${r.status}`).join(' ')}`)
  })
})
