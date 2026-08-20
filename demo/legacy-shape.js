/**
 * legacy-shape — the REAL-LEGACY-SHAPE regression page (fix-pass plan item 5;
 * the D1–D8 live-prod legacy-shape dispositions, docs/skills/designing-pages.md
 * §11/§12 + docs/specs/translate.md).
 *
 * The main envelope is the blind-test translate-stack fixture
 * (tests/blind/translate-stack-fixture.json) — the legacy envelope the
 * page-review probe verified (tests/blind/translate-stack-page-review-probe.mjs,
 * 45 checks) — adapted for the demo (authored `props.id` on every node so the
 * PAR-5 shape signature is deterministic across processes; one nested
 * media-query cssDef rule added to the nav's StyleNodes). It demonstrates:
 *
 *   • cssDef StyleNodes with BOTH a class selector (.blind-card) and an
 *     element/tag selector (nav) emitting REAL deduped stylesheet rules from
 *     ACTIONABLE states only (D4/STL-1..4) — incl. a nested media-query rule;
 *   • the three seam delivery shapes (D7/SED-1..3): the h1's
 *     `{target: 'content', reference: titleDef}` delivers the def's TEXT only
 *     (F13); the span's `{target: 'type', reference: badgeDef}` SHELL-COLLAPSES
 *     into the def button (def type + css + def child strong, no def content
 *     text, no surviving wrapper); the div.blind-shell's
 *     `{target: 'children', reference: menuDef}` keeps its OWN element + text +
 *     authored children and GAINS the def-root nav.blind-menu as an ADDITIONAL
 *     seam-wired child (delivery-shape ruling SED-2);
 *   • def roots + children staying OUT-OF-TREE pre-minted prototypes
 *     (F16/D8 — never emitted by the host, no count-mismatch clobber: no
 *     stray span.blind-title anywhere);
 *   • multi-zone placement: `placement` ARRAY entries, the item's
 *     `targetPlacement: ['no-such-zone', 'side-zone']` first-match-with-known-
 *     container fan-out into BOTH side-zone asides (§1.2/§2.5 —
 *     activePlacement = 'side-zone', the first choice skipped, not fatal),
 *     pathKey = forkKey on every path-state (§2.2);
 *   • EMPTY-OWNER visibility: both asides keep their authored text + inline
 *     css.style, so they stay VISIBLE (no display:none);
 *   • css.style authored as OBJECTS, serialized by translate to kebab-case
 *     `k: v;` strings (D3 — no `style="[object Object]"`);
 *   • doc.content as a ContentPayload[] ARRAY (D2);
 *   • ZERO K4 warnings on the main envelope.
 *
 * Two K4 side cards exercise the guard channels with PURE DATA envelopes:
 *
 *   • `placement-entry-invalid` — a `placement: [42]` non-object entry is
 *     warned + skipped (D1); the node still renders its own content;
 *   • `payload-shape-obsolete` — the obsolete single-payload object form
 *     `{content, metadata}` for `doc.content` is warned + skipped (D2/F5);
 *     the envelope's own root children still render.
 *
 * Pipeline (main envelope): translateLegacy → Supervisor register → ONE
 * per-node compilePath bootstrap (the placement-path pipeline — the fixture is
 * placement-routed, so the §2 enumeration is the compile) → recordResolved →
 * emitElements → diffMinimal → applyOps(DomAdapter). The seam comparison
 * section additionally runs the seam-native `root.compile` slice to document
 * which claims each pipeline serves (probe section 7).
 *
 * One module, three roles:
 *   1. DATA (`legacyShapeEnvelope` / `legacyShapeSideCardEnvelopes`): the LEGACY
 *      envelopes — pure JSON data, no executable logic in the data.
 *   2. NODE side (`legacyShapeServerData` / `buildLegacyShapeSurface`): the
 *      builder's server reference (expected census + the PAR-5 shape
 *      signature); the SSR fragment embedding happens in
 *      scripts/legacy-shape-page.mjs.
 *   3. PAGE (browser, `typeof document !== 'undefined'` guard): CORE-ONLY
 *      imports (dist/core/*) + the shared runner — the full render as above.
 *      Banner: `legacy-shape`; sets `globalThis.__legacyShapeDone` and
 *      publishes `__legacyShapeProfile` for the smoke guard.
 */
import { translateLegacy } from '../dist/core/translate.js'
import { Supervisor } from '../dist/core/supervisor.js'
import { EventBridge } from '../dist/core/events.js'
import { DomAdapter } from '../dist/core/adapters.js'
import { emitElements, applyOps, treeFromOps, wireKey } from '../dist/core/render-helpers.js'
import { diffMinimal } from '../dist/core/render.js'
import { setCompilePassLogging } from '../dist/core/debug.js'
import { makeRunner } from './lib/runner.js'

// ============================================================================
// DATA — the LEGACY envelopes (pure data derivation, no graph construction).
// ============================================================================

/**
 * The main envelope — the blind-test translate-stack fixture, adapted:
 *   • `props.id` AUTHORED on every node (incl. the template.component defs) so
 *     the PAR-5 shape signature is deterministic: the builder (fresh process)
 *     and the page (shared smoke process) would otherwise mint different
 *     auto ids into props (path-fork-data.js §5 note, same pattern);
 *   • one nested media-query cssDef rule added to the nav's StyleNodes
 *     (`nav{@media (max-width: 600px){flex-direction:column;}}` — D4 nested
 *     block serialization).
 * Everything else is the fixture verbatim: both selector forms, the three seam
 * targets, the multi-zone placement with the FIRST choice missing, the
 * ContentPayload[] array, the css.style OBJECTS, zero K4 warnings.
 */
export function legacyShapeEnvelope() {
  return {
    template: {
      root: {
        type: 'div',
        css: { id: 'blind-app' },
        props: { id: 'blind-app' },
        children: [
          {
            type: 'section',
            props: { id: 'blind-card' },
            css: {
              classes: ['blind-card'],
              cssDef: [
                { selector: '.blind-card', styles: { border: '1px solid #ccc', padding: '16px' } },
              ],
            },
            content: 'class-selector cssDef',
          },
          {
            type: 'nav',
            props: { id: 'blind-nav' },
            css: {
              cssDef: [
                { selector: 'nav', styles: { display: 'flex', gap: '8px', alignItems: 'center' } },
                // D4 — the nested media-query form serializes as a nested block
                { selector: 'nav', styles: { '@media (max-width: 600px)': { flexDirection: 'column' } } },
              ],
            },
            content: 'element-selector cssDef',
          },
          {
            type: 'h1',
            props: { id: 'blind-heading' },
            css: { classes: ['blind-heading'] },
            component: { reference: 'titleDef', target: 'content' },
          },
          {
            type: 'div',
            props: { id: 'blind-shell' },
            css: { classes: ['blind-shell'], style: { padding: '8px' } },
            content: 'shell text',
            children: [
              { type: 'p', props: { id: 'blind-shell-p' }, content: 'authored paragraph' },
            ],
            component: { reference: 'menuDef', target: 'children' },
          },
          {
            type: 'span',
            props: { id: 'blind-badge-slot' },
            component: { reference: 'badgeDef', target: 'type' },
          },
          {
            type: 'div',
            props: { id: 'blind-page', 'data-role': 'page' },
            children: [
              {
                type: 'aside',
                props: { id: 'side-a' },
                css: { classes: ['side-a'], style: { width: '200px' } },
                content: 'zone A',
                placement: [{ placementName: 'side-zone' }],
              },
              {
                type: 'aside',
                props: { id: 'side-b' },
                css: { classes: ['side-b'], style: { width: '200px' } },
                content: 'zone B',
                placement: [{ placementName: 'side-zone' }],
              },
            ],
          },
        ],
      },
      component: [
        {
          reference: 'titleDef',
          value: {
            type: 'span',
            props: { id: 'blind-title-def' },
            css: { classes: ['blind-title'] },
            content: "The def's text content",
          },
        },
        {
          reference: 'badgeDef',
          value: {
            type: 'button',
            props: { id: 'blind-badge-def' },
            css: {
              classes: ['blind-badge'],
              style: { border: '1px solid #333', borderRadius: '4px' },
              cssDef: [
                { selector: '.blind-badge', styles: { backgroundColor: '#ffe08a' } },
              ],
            },
            children: [
              { type: 'strong', props: { id: 'blind-badge-strong' }, content: 'new' },
            ],
          },
        },
        {
          reference: 'menuDef',
          value: {
            type: 'nav',
            props: { id: 'blind-menu-def' },
            css: {
              classes: ['blind-menu'],
              cssDef: [
                { selector: '.blind-menu', styles: { backgroundColor: '#222', color: '#fff' } },
              ],
            },
            children: [
              { type: 'span', props: { id: 'blind-logo' }, content: 'logo' },
              { type: 'span', props: { id: 'blind-links' }, content: 'links' },
            ],
          },
        },
      ],
    },
    content: [
      {
        metadata: { blindTest: 'translate-stack', demo: 'legacy-shape' },
        userData: { writer: 'blind-test-writer' },
        content: [
          {
            type: 'div',
            props: { id: 'blind-item' },
            css: {
              classes: ['blind-item'],
              style: { padding: '4px' },
              cssDef: [
                { selector: '.blind-item', styles: { borderLeft: '3px solid #2a7' } },
              ],
            },
            content: 'placed item',
            placement: [{ targetPlacement: ['no-such-zone', 'side-zone'] }],
          },
        ],
      },
    ],
    clientConfig: { runInstantiation: true, runRendering: true },
  }
}

/** The two K4 side-card envelopes — PURE DATA: translate itself emits the
 *  guard warns, the page just renders the envelope + the warnings channel.
 *  `placement: [42]` — a non-object placement ARRAY entry → warned + skipped
 *  (D1), the node still renders its own content. `doc.content` as the obsolete
 *  single-payload OBJECT → warned + skipped (D2/F5), the envelope's own root
 *  children still render. */
export function legacyShapeSideCardEnvelopes() {
  return {
    entryInvalid: {
      template: {
        root: {
          type: 'div',
          props: { id: 'entry-invalid-root' },
          children: [
            {
              type: 'p',
              props: { id: 'entry-invalid-card' },
              content: 'invalid-entry card renders (placement entry skipped)',
              placement: [42],
            },
          ],
        },
      },
      content: [],
      clientConfig: { runInstantiation: true, runRendering: true },
    },
    payloadObsolete: {
      template: {
        root: {
          type: 'div',
          props: { id: 'obsolete-payload-root' },
          children: [
            {
              type: 'p',
              props: { id: 'obsolete-payload-card' },
              content: 'obsolete-payload card renders (payload skipped)',
            },
          ],
        },
      },
      content: { content: [{ type: 'div', content: 'obsolete payload content' }], metadata: {} },
      clientConfig: { runInstantiation: true, runRendering: true },
    },
  }
}

// ============================================================================
// NODE-side surface: compile the envelope once → render ops (shared by the
// page's DomAdapter and the builder's SSRFragmentAdapter — PAR-5 parity).
// ============================================================================

/** Compile any of the legacy envelopes: translate → register → ONE
 *  path-enumeration bootstrap (compilePath per node — the placement-path
 *  pipeline, placement-path-spec §2) → emitElements → diffMinimal. */
export function buildLegacyShapeSurface(doc) {
  const translated = translateLegacy(doc)
  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)
  const actionable = []
  for (const n of translated.nodes) actionable.push(...n.compilePath().actionable)
  supervisor.recordResolved(actionable)
  const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = emitElements(actionable, byNode)
  const ops = diffMinimal(null, els)
  return { doc, translated, supervisor, byNode, actionable, els, ops }
}

/** Deterministic small hash (FNV-1a 64-bit) over a string — digests the PAR-5
 *  shape so the embedded reference stays tiny (path-fork-data.js pattern). */
export function hash64(str) {
  let h = 0xcbf29ce484222325n
  for (let i = 0; i < str.length; i += 1) {
    h ^= BigInt(str.charCodeAt(i))
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn
  }
  return h.toString(16).padStart(16, '0')
}

/** Recursive wire-agnostic shape digest: folds each tree node's (type, sorted
 *  props, children digests) into a small string and hashes it. Deterministic:
 *  same algorithm server + client; node ids / wires never enter the fold. */
export function shapeSigOfTrees(trees) {
  const sortVal = (v) => {
    if (Array.isArray(v)) return v.map(sortVal)
    if (v !== null && typeof v === 'object') {
      const o = {}
      for (const k of Object.keys(v).sort()) o[k] = sortVal(v[k])
      return o
    }
    return v
  }
  const fold = (nodes) => {
    let acc = ''
    for (const n of nodes) {
      const props = n.props ? JSON.stringify(sortVal(n.props)) : ''
      const kids = fold(n.children ?? [])
      acc += `${n.type}:${props}:${kids.length ? hash64(kids) : ''};`
    }
    return acc
  }
  return hash64(fold(trees))
}

/** Expected census + the PAR-5 parity reference (embedded in the page as
 *  server-data; the builder adds the SSR expectedHtml fragments). */
export function legacyShapeServerData() {
  const s = buildLegacyShapeSurface(legacyShapeEnvelope())
  return {
    expected: {
      nodes: 17,
      states: 12,
      elements: 16,
      stylesRules: 6,
    },
    serverTreeSig: shapeSigOfTrees(treeFromOps(s.ops)),
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

  const envelope = JSON.parse(document.getElementById('preempt-initial-data').textContent.trim())
  const serverData = JSON.parse(document.getElementById('server-data').textContent.trim())
  const expected = serverData.expected

  // ---- profiling -----------------------------------------------------------
  // Measured sections: load (translate), compile (the ONE path-enumeration
  // bootstrap), emit/diff/apply (render), side (the K4 side-card renders),
  // checks (the verification surface). coveredMs = Σ(all timed) — the smoke
  // asserts it covers ~all of totalMs so "total" can never hide an untimed
  // pipeline (RCA: docs/session-defect-review.md — the profiler does NOT time
  // pass-2; this page has no pass-2, its bootstrap IS the enumeration).
  const PROFILE = {
    loadMs: 0, compileMs: 0, emitMs: 0, diffMs: 0, applyMs: 0,
    sideMs: 0, checksMs: 0, totalMs: 0, coveredMs: 0,
    states: 0, elements: 0, registered: 0, inTree: 0, unplaced: 0, destroyed: 0, cloneOps: 0,
    prototypes: 0, passes: 0, warningsMain: 0, fanOut: 0, stylesRules: [],
  }
  const now = () => (globalThis.performance?.now ? performance.now() : Date.now())
  const tStart = now()
  function acc(key, fn) {
    const t0 = now()
    const r = fn()
    PROFILE[key] += now() - t0
    return r
  }

  // ---- translate the LEGACY envelope → graph (core-only) -------------------
  const translated = acc('loadMs', () => translateLegacy(envelope))

  const events = new EventBridge()
  const supervisor = new Supervisor({ events })
  for (const n of translated.nodes) supervisor.registerNode(n)

  // ---- ONE path-enumeration bootstrap pass --------------------------------
  const actionable = acc('compileMs', () => {
    const out = []
    for (const n of translated.nodes) out.push(...n.compilePath().actionable)
    return out
  })
  PROFILE.passes = 1
  supervisor.recordResolved(actionable)

  const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]))
  const els = acc('emitMs', () => emitElements(actionable, byNode))
  const ops = acc('diffMs', () => diffMinimal(null, els))
  const adapter = new DomAdapter(document.getElementById('app'))
  const appEl = adapter.mount ?? document.getElementById('app')
  acc('applyMs', () => {
    adapter.beginBatch()
    applyOps(adapter, ops)
    adapter.endBatch()
  })

  // ---- K4 side cards: pure DATA envelopes through the same core pipeline ---
  const sideCards = serverData.sideCards
  function renderSideCard(mountId, doc) {
    const t = translateLegacy(doc)
    const sup = new Supervisor({ events: new EventBridge() })
    for (const n of t.nodes) sup.registerNode(n)
    const act = []
    for (const n of t.nodes) act.push(...n.compilePath().actionable)
    sup.recordResolved(act)
    const m = new Map(sup.allNodes().map((n) => [n.id, n]))
    const e = emitElements(act, m)
    const o = diffMinimal(null, e)
    applyOps(new DomAdapter(document.getElementById(mountId)), o)
    const warnEl = document.getElementById(`${mountId}-warnings`)
    if (warnEl) warnEl.textContent = t.warnings.map((w) => `${w.code} @ ${w.path}`).join('\n')
    return { warnings: t.warnings, els: e }
  }
  const entryInvalid = acc('sideMs', () => renderSideCard('invalid-entry-mount', sideCards.entryInvalid))
  const payloadObsolete = acc('sideMs', () => renderSideCard('obsolete-payload-mount', sideCards.payloadObsolete))

  const mainWarningsEl = document.getElementById('main-warnings')
  if (mainWarningsEl) mainWarningsEl.textContent = translated.warnings.map((w) => `${w.code} @ ${w.path}`).join('\n')

  // ---- ops-level tree reconstruction (probe §4: append ops carry BARE wires,
  //      path-state elements store under composite keys wireKey(wire, forkKey);
  //      resolution follows the adapters' findEl contract — exact wire first,
  //      then the `${wire}\0` prefix). ----------------------------------------
  const nodesByKey = new Map()
  const keyOf = (o) => wireKey(o.wire, o.forkKey)
  function resolveKey(store, wire) {
    if (store.has(wire)) return wire
    const prefix = `${wire}\0`
    for (const k of store.keys()) if (k.startsWith(prefix)) return k
    return undefined
  }
  for (const o of ops) {
    if (o.kind === 'create') {
      nodesByKey.set(keyOf(o), { wire: o.wire, type: o.type, props: {}, children: [], styles: [] })
    } else if (o.kind === 'set') {
      const el = nodesByKey.get(keyOf(o))
      if (el) el.props[o.name] = o.value
    } else if (o.kind === 'append') {
      const ok = resolveKey(nodesByKey, o.owner)
      const ck = resolveKey(nodesByKey, o.child)
      const owner = nodesByKey.get(ok)
      const child = nodesByKey.get(ck)
      if (owner && child) owner.children.push(child)
    }
  }
  const roots = [...nodesByKey.values()].filter((el) => ![...nodesByKey.values()].some((p) => p.children.includes(el)))

  function treeString(el, indent = '') {
    const cls = el.props['css:classes']
    const style = el.props['css:style']
    const text = el.props['text']
    const attrs = [
      el.type,
      el.wire !== undefined ? `wire=${el.wire}` : '',
      cls !== undefined ? `class=${Array.isArray(cls) ? cls.join(' ') : cls}` : '',
      style !== undefined ? `style=${style}` : '',
      text !== undefined ? `text=${JSON.stringify(text)}` : '',
      (el.styles ?? []).length > 0 ? `styles=[${el.styles.join(' ')}]` : '',
    ].filter(Boolean).join(' | ')
    const kids = el.children.map((c) => treeString(c, indent + '  '))
    return `${indent}<${attrs}>\n${kids.join('\n')}`
  }

  const stateByWire = new Map(actionable.map((s) => [s.pathKey, s]))
  // every emitted element is stored under the composite key
  // wireKey(pathKey, forkKey) = `pathKey\x00pathKey` (forkKey = pathKey) —
  // bare pathKey lookups miss (the same composite-key contract as fork arms);
  // the adapter's wires map holds ONLY this page's elements, so DOM checks are
  // scoped to this render even under the smoke shim (which shares one #app
  // element across all demo pages)
  const domElOf = (pathKey) => adapter.wires.get(wireKey(pathKey, pathKey))
  const wireSet = new Set(els.map((e) => e.wire))
  const wireEls = [...adapter.wires.values()].filter((e) => e.dataset?.wire !== undefined && wireSet.has(e.dataset.wire))
  const elText = (el) => el?.textContent ?? ''
  // REAL-DOM own-text: `textContent` concatenates ALL descendant text in a
  // real browser (the shim's is own-only) — read the direct text-node
  // children when the DOM exposes childNodes, else fall back (shim).
  const ownText = (el) => {
    if (!el) return ''
    if (el.childNodes && el.childNodes.length > 0) {
      let out = ''
      for (const n of el.childNodes) if (n.nodeType === 3) out += n.textContent ?? ''
      return out
    }
    return el.textContent ?? ''
  }
  // REAL-DOM style normalization: darkreader rewrites inline styles (hex →
  // rgb + `--darkreader-*` var declarations) — strip the vars and normalize
  // rgb() back to hex so the checks pass in a real browser AND the shim.
  const normStyle = (el) => {
    const cssText = (el?.style?.cssText ?? '') || (el?.getAttribute?.('data-css-style') ?? '')
    const decls = []
    for (const pair of cssText.split(';')) {
      const idx = pair.indexOf(':')
      if (idx < 0) continue
      const k = pair.slice(0, idx).trim()
      let v = pair.slice(idx + 1).trim()
      if (k.startsWith('--darkreader-')) continue
      const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(v)
      if (m) v = `#${[1, 2, 3].map((i) => Number(m[i]).toString(16).padStart(2, '0')).join('')}`
      // colors embedded in compound values (`1px solid #333`) — replace
      // in-place: rgb(...) → hex, 3-digit hex → 6-digit (`#` is a non-word
      // char, so a `\b#` boundary never fires — use a hex-char lookbehind)
      v = v.replace(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/g, (_, r, g, b) => `#${[r, g, b].map((x) => Number(x).toString(16).padStart(2, '0')).join('')}`)
      v = v.replace(/(?<![0-9a-fA-F])#([0-9a-f]{3})(?![0-9a-fA-F])/gi, (_, c) => `#${c.split('').map((ch) => ch + ch).join('')}`)
      if (v) decls.push(`${k}: ${v}`)
    }
    return decls.join('; ')
  }
  function walkEl(el, fn) {
    fn(el)
    for (const c of el.children ?? []) walkEl(c, fn)
  }
  const elClass = (el) => (el?.className ?? '').split(' ')

  function itemNodeId() {
    for (const n of translated.nodes) if (n.content === 'placed item') return n.id
    return null
  }

  async function main() {
    // ---- checks -----------------------------------------------------------
    const checksT0 = now()

    // ---- 1. translate (probe §1) -------------------------------------------
    await runner.check('translate: ZERO warnings (incl. no component-target-gap, no K4 placement warns)', () => {
      if (translated.warnings.length !== 0) throw new Error(JSON.stringify(translated.warnings))
    })
    await runner.check('translate: no component-target-gap warn', () => {
      if (translated.warnings.some((w) => w.code === 'component-target-gap')) throw new Error('component-target-gap fired')
    })
    await runner.check('translate: no placement-name-vetoed warn', () => {
      if (translated.warnings.some((w) => w.code === 'placement-name-vetoed')) throw new Error('placement-name-vetoed fired')
    })

    // ---- 2. cssDef claims (probe §3 — STL-1..4) -----------------------------
    const stylesOps = ops.filter((o) => o.kind === 'styles')
    const ruleStrings = stylesOps.flatMap((o) => o.cssDefs ?? [])
    await runner.check('STL-4: exactly ONE styles op (one sweep)', () => {
      if (stylesOps.length !== 1) throw new Error(`styles ops: ${stylesOps.length}`)
    })
    await runner.check('STL-4: payload entries are STRINGS (no raw object reaches the adapter)', () => {
      if (!ruleStrings.every((r) => typeof r === 'string')) throw new Error('non-string rule in styles payload')
    })
    const expectRules = [
      '.blind-card{border: 1px solid #ccc;padding: 16px;}',
      'nav{display: flex;gap: 8px;align-items: center;}',
      '.blind-badge{background-color: #ffe08a;}',
      '.blind-menu{background-color: #222;color: #fff;}',
      '.blind-item{border-left: 3px solid #2a7;}',
    ]
    for (const r of expectRules) {
      await runner.check(`STL-1: rule emitted — ${r}`, () => {
        if (!ruleStrings.includes(r)) throw new Error('rule missing from styles op')
      })
    }
    await runner.check('STL-1: nested media-query rule emitted (D4 nested block) — nav{@media (max-width: 600px){flex-direction:column;}}', () => {
      const media = 'nav{@media (max-width: 600px){flex-direction:column;}}'
      if (!ruleStrings.includes(media)) throw new Error(`media rule missing; got ${JSON.stringify(ruleStrings)}`)
    })
    await runner.check('STL-2: .blind-item rule emitted ONCE despite 2 owning path-states (signature dedup)', () => {
      const n = ruleStrings.filter((r) => r === '.blind-item{border-left: 3px solid #2a7;}').length
      if (n !== 1) throw new Error(`count=${n}`)
    })
    await runner.check('STL-2: all 6 rules deduped (no duplicate rule strings in the payload)', () => {
      const ruleSet = new Set(ruleStrings)
      if (ruleStrings.length !== ruleSet.size || ruleSet.size !== 6) {
        throw new Error(`rules=${ruleStrings.length} unique=${ruleSet.size}`)
      }
    })

    // ---- 3. seam-target claims (probe §5 — SED-1..3) ------------------------
    const h1 = [...nodesByKey.values()].find((el) => el.type === 'h1')
    await runner.check("SED-3: content-target h1 keeps its OWN element + class", () => {
      if (!h1 || h1.type !== 'h1' || !Array.isArray(h1.props['css:classes']) || !h1.props['css:classes'].includes('blind-heading')) {
        throw new Error(h1 ? treeString(h1) : 'missing')
      }
    })
    await runner.check("SED-3: h1 content slot carries the def's text 'The def's text content'", () => {
      if (!h1 || h1.props['text'] !== "The def's text content") throw new Error(h1 ? JSON.stringify(h1.props['text']) : 'missing')
    })
    await runner.check('SED-3: h1 has NO children (text-only delivery, no shape change)', () => {
      if (!h1 || h1.children.length !== 0) throw new Error(h1 ? String(h1.children.length) : '')
    })

    const badge = [...nodesByKey.values()].find((el) => el.type === 'button')
    const badgeEl = els.find((e) => e.type === 'button')
    await runner.check('SED-1: type-target span collapses into button (def type, no span remains)', () => {
      if (!badge) throw new Error('no button in the emitted tree')
    })
    await runner.check('SED-1: button carries def classes blind-badge', () => {
      if (!badge || !Array.isArray(badge.props['css:classes']) || !badge.props['css:classes'].includes('blind-badge')) {
        throw new Error(badge ? JSON.stringify(badge.props['css:classes']) : 'missing')
      }
    })
    await runner.check('SED-1: button carries def style (border + borderRadius serialized)', () => {
      if (!badge || typeof badge.props['css:style'] !== 'string' ||
          !badge.props['css:style'].includes('border: 1px solid #333;') ||
          !badge.props['css:style'].includes('border-radius: 4px;')) {
        throw new Error(badge ? JSON.stringify(badge.props['css:style']) : 'missing')
      }
    })
    await runner.check('SED-1: button has the def child strong("new")', () => {
      if (!badge || badge.children.length !== 1 || badge.children[0].type !== 'strong' || badge.children[0].props['text'] !== 'new') {
        throw new Error(badge ? badge.children.map((c) => c.type).join(',') : 'missing')
      }
    })
    await runner.check('SED-1: button element carries NO def-content text (SED-1 delivery = type + css + children only; def content is not delivered)', () => {
      if (badgeEl && badgeEl.props['text'] !== undefined) throw new Error(JSON.stringify(badgeEl.props))
    })
    await runner.check('SED-1: no bare consumer span remains (no def-root element for type-target)', () => {
      const spans = [...nodesByKey.values()].filter((el) => el.type === 'span')
      if (!spans.every((s) => s.props['text'] === 'logo' || s.props['text'] === 'links')) {
        throw new Error(spans.map((s) => s.props['text'] ?? '').join(','))
      }
    })

    const shell = [...nodesByKey.values()].find((el) => el.type === 'div' && Array.isArray(el.props['css:classes']) && el.props['css:classes'].includes('blind-shell'))
    await runner.check('SED-2: children-target keeps its OWN element div.blind-shell', () => {
      if (!shell) throw new Error('shell missing')
    })
    await runner.check('SED-2: shell keeps own classes + style', () => {
      if (!shell || !Array.isArray(shell.props['css:classes']) || !shell.props['css:classes'].includes('blind-shell') || shell.props['css:style'] !== 'padding: 8px;') {
        throw new Error(shell ? JSON.stringify(shell.props) : 'missing')
      }
    })
    await runner.check("SED-2: shell keeps own text 'shell text'", () => {
      if (!shell || shell.props['text'] !== 'shell text') throw new Error(shell ? JSON.stringify(shell.props['text']) : '')
    })
    await runner.check('SED-2: shell keeps authored p child', () => {
      if (!shell || !shell.children.some((c) => c.type === 'p' && c.props['text'] === 'authored paragraph')) {
        throw new Error(shell ? shell.children.map((c) => `${c.type}(${c.props['text'] ?? ''})`).join(', ') : '')
      }
    })
    const menu = shell ? shell.children.find((c) => c.type === 'nav') : undefined
    const menuEl = els.find((e) => e.type === 'nav' && e.wire.endsWith(':0'))
    await runner.check('SED-2: shell GAINS the def-root nav.blind-menu as an ADDITIONAL child', () => {
      if (!menu || !Array.isArray(menu.props['css:classes']) || !menu.props['css:classes'].includes('blind-menu')) {
        throw new Error(menu ? treeString(menu) : 'missing')
      }
    })
    await runner.check('SED-2: def-root nav carries logo + links spans in order', () => {
      if (!menu || menu.children.length !== 2 || menu.children[0].props['text'] !== 'logo' || menu.children[1].props['text'] !== 'links') {
        throw new Error(menu ? menu.children.map((c) => c.props['text']).join(',') : '')
      }
    })
    await runner.check('SED-2: authored p comes BEFORE the def-root (nav is additional, not replacing)', () => {
      if (!shell || shell.children.length !== 2 || shell.children[0].type !== 'p' || shell.children[1].type !== 'nav') {
        throw new Error(shell ? String(shell.children.length) : '')
      }
    })
    await runner.check('SED-2: def-root cssDef rule joins the deduped styles op (STL-3 — rule visible in the styles block)', () => {
      if (!ruleStrings.includes('.blind-menu{background-color: #222;color: #fff;}')) throw new Error(JSON.stringify(ruleStrings))
    })
    await runner.check('SED-2: def-root element itself carries the rule on its styles field (sweep coalescer input)', () => {
      if (!menuEl || !(menuEl.styles ?? []).includes('.blind-menu{background-color: #222;color: #fff;}')) {
        throw new Error(menuEl ? JSON.stringify(menuEl.styles ?? []) : 'missing')
      }
    })

    // ---- 4. D8 — prototypes never emitted by the host (probe F16/D8) --------
    await runner.check('D8: seam-resolved def carriers never emit standalone — NO stray span.blind-title element (titleDef, unresolved, never emitted by the host)', () => {
      const stray = [...nodesByKey.values()].filter((el) => Array.isArray(el.props['css:classes']) && el.props['css:classes'].includes('blind-title'))
      if (stray.length !== 0) throw new Error(`stray def-root elements: ${stray.map((s) => treeString(s)).join('\n')}`)
    })
    await runner.check('D8: element census holds — exactly 16 emitted elements (no def-root doppelgängers, no count-mismatch clobber)', () => {
      if (els.length !== expected.elements) throw new Error(`elements=${els.length}, expected ${expected.elements}`)
    })

    // ---- 5. multi-zone placement claims (probe §6 — §1.2/§2.2/§2.5) ---------
    const itemStates = actionable.filter((s) => s.nodeId === itemNodeId())
    await runner.check('§1.2: TWO instances (fan-out into both side-zone containers)', () => {
      if (itemStates.length !== 2) throw new Error(String(itemStates.length))
    })
    await runner.check('§1.2: distinct pathKeys', () => {
      if (new Set(itemStates.map((s) => s.pathKey)).size !== 2) throw new Error(itemStates.map((s) => s.pathKey).join(' | '))
    })
    await runner.check('§2.2: forkKey === pathKey on both', () => {
      if (!itemStates.every((s) => s.forkKey === s.pathKey)) throw new Error('')
    })
    await runner.check('§2.5: activePlacement = side-zone on both (first choice no-such-zone skipped, not fatal)', () => {
      if (!itemStates.every((s) => s.activePlacement === 'side-zone')) throw new Error(itemStates.map((s) => String(s.activePlacement)).join(','))
    })
    await runner.check('§2.2: pathKeys route through the side-zone hop to two distinct owner ids (root/<family…>/side-zone/<ownerId>/<nodeId>)', () => {
      if (!itemStates.every((s) => /^root\/.+side-zone\/.+/.test(s.pathKey))) throw new Error(itemStates.map((s) => s.pathKey).join(' | '))
    })
    await runner.check('§2.2: the two fan-out instances route through TWO DIFFERENT container owners', () => {
      const ownerIdsOf = itemStates.map((s) => /^root\/.+side-zone\/([^/]+)\//.exec(s.pathKey)?.[1])
      if (new Set(ownerIdsOf).size !== 2) throw new Error(ownerIdsOf.join(' | '))
    })
    const itemEls = els.filter((e) => itemStates.some((s) => e.wire === s.pathKey))
    await runner.check('emit: TWO emitted elements for the placed item (one per path-state)', () => {
      if (itemEls.length !== 2) throw new Error(String(itemEls.length))
    })
    await runner.check('emit: both carry class blind-item + authored style + text', () => {
      if (!itemEls.every((e) => Array.isArray(e.props['css:classes']) && e.props['css:classes'].includes('blind-item') && e.props['css:style'] === 'padding: 4px;' && e.props['text'] === 'placed item')) {
        throw new Error(JSON.stringify(itemEls.map((e) => e.props)))
      }
    })
    const asides = [...nodesByKey.values()].filter((el) => el.type === 'aside')
    await runner.check('EMPTY-OWNER-1a/1b: both asides stay VISIBLE (authored text + authored style → no display:none)', () => {
      if (asides.length !== 2 || !asides.every((a) => (a.props['css:style'] ?? '').includes('width: 200px') && !(a.props['css:style'] ?? '').includes('display: none'))) {
        throw new Error(asides.map((a) => `${a.props['css:classes']}=${JSON.stringify(a.props['css:style'])}/${JSON.stringify(a.props['text'])}`).join(' | '))
      }
    })
    await runner.check('EMPTY-OWNER-1a: aside text intact', () => {
      if (!asides.every((a) => a.props['text'] === 'zone A' || a.props['text'] === 'zone B')) throw new Error(asides.map((a) => String(a.props['text'])).join(','))
    })
    await runner.check('fan-out: the item instances attach UNDER their respective asides', () => {
      if (!itemEls.every((e) => { const own = nodesByKey.get(wireKey(e.wire, e.forkKey)); return own && asides.some((a) => a.children.includes(own)) })) {
        throw new Error(itemEls.map((e) => e.wire).join(' | '))
      }
    })
    await runner.check('fan-out: two distinct owner asides host the instances', () => {
      const asidePaths = asides.map((a) => a.wire)
      if (new Set(asidePaths).size !== 2) throw new Error(asidePaths.join(' | '))
    })

    // ---- 6. pipeline comparison: the seam-native root.compile slice --------
    // (probe §7 — documents which claims each pipeline serves)
    const supervisor2 = new Supervisor({ events: new EventBridge() })
    for (const n of translated.nodes) supervisor2.registerNode(n)
    const cr = translated.root.compile(translated.nodes)
    const nodeById2 = new Map(translated.nodes.map((n) => [n.id, n]))
    const els2 = emitElements(cr.actionable, nodeById2)
    const ops2 = diffMinimal(null, els2)
    const styles2 = ops2.filter((o) => o.kind === 'styles').flatMap((o) => o.cssDefs ?? [])
    const itemStates2 = cr.actionable.filter((s) => s.nodeId === itemNodeId())
    const h1Html = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(serverData.expectedHtml)?.[1] ?? '(h1 missing)'
    await runner.check('comparison: root.compile delivers SED-3 def text into h1 (seam-native pipeline works)', () => {
      if (h1Html !== "The def's text content") throw new Error(JSON.stringify(h1Html))
    })
    await runner.check('comparison: root.compile DROPS the placement consumer (no multi-zone fan-out)', () => {
      if (itemStates2.length !== 0) throw new Error(String(itemStates2.length))
    })
    await runner.check('comparison: root.compile also drops the .blind-item cssDef rule (STL-3 — actionable-only)', () => {
      if (styles2.some((r) => r.startsWith('.blind-item{'))) throw new Error(JSON.stringify(styles2))
    })

    // ---- 7. node/state census ----------------------------------------------
    await runner.check('node census: registered=17, in-tree=14 (the seam-resolved menu subtree realizes in-tree — DEFECT #24; 3 unresolved def protos stay out-of-tree), unplaced=0, destroyed=0, cloneOps=0', () => {
      const all = supervisor.allNodes()
      if (all.length !== 17) throw new Error(`registered: expected 17, got ${all.length}`)
      const inTree = all.filter((n) => !n.destroyed && n.isInTree)
      if (inTree.length !== 14) throw new Error(`in-tree: expected 14 (3 unresolved 'component'-token def prototypes stay out-of-tree), got ${inTree.length}`)
      const prototypes = all.filter((n) => n.state === 'prototype')
      if (prototypes.length !== 3) throw new Error(`prototypes: expected 3 (unresolved def roots/children), got ${prototypes.length}`)
      const unplaced = all.filter((n) => !n.destroyed && n.state === 'unplaced')
      if (unplaced.length !== 0) throw new Error(`unplaced: expected 0, got ${unplaced.length}`)
      const destroyed = all.filter((n) => n.destroyed)
      if (destroyed.length !== 0) throw new Error(`destroyed: expected 0, got ${destroyed.length}`)
      if (supervisor.journal.length !== 0) throw new Error(`journal must be empty (no ops applied), got ${supervisor.journal.length}`)
      PROFILE.cloneOps = 0
      PROFILE.prototypes = prototypes.length
    })
    await runner.check('state census: 12 path-states, distinct pathKeys, forkKey = pathKey on every state', () => {
      if (actionable.length !== 12) throw new Error(`states: expected 12, got ${actionable.length}`)
      if (new Set(actionable.map((s) => s.pathKey)).size !== 12) throw new Error('pathKeys not distinct')
      for (const s of actionable) {
        if (s.forkKey !== s.pathKey) throw new Error(`forkKey ≠ pathKey on ${s.pathKey}`)
        if (s.pathKey !== 'root' && !s.pathKey.startsWith('root/')) throw new Error(`bad pathKey ${s.pathKey}`)
        if (s.pathKey.includes('#')) throw new Error(`arm suffix leaked into ${s.pathKey}`)
      }
    })

    // ---- 8. DOM-level mirror (the DomAdapter applied the same ops) ---------
    // Scoped to THIS adapter's wires map (the page's own elements — under the
    // smoke shim every demo page shares one #app element, so an unscoped DOM
    // walk would count the other pages' elements too).
    await runner.check('DOM: the DomAdapter rendered all 16 emitted elements on their pathKey wires', () => {
      if (wireEls.length !== expected.elements) throw new Error(`DOM wire elements=${wireEls.length}, expected ${expected.elements}`)
      if (wireEls.some((e) => !wireSet.has(e.dataset?.wire))) throw new Error('an adapter element is not one of the emitted wires')
      // every one of the page's elements chains up to the #app mount (real
      // DOM: `parentElement`; the shim exposes `parent`)
      for (const e of wireEls) {
        let p = e.parent ?? e.parentElement
        let mounted = false
        while (p) {
          if (p === appEl || p.id === 'app') { mounted = true; break }
          p = p.parent ?? p.parentElement
        }
        if (!mounted) throw new Error(`element ${e.dataset.wire} is not mounted under #app`)
      }
    })
    await runner.check("DOM: h1 rendered with its class + the def's text content", () => {
      const elsH1 = wireEls.filter((e) => elClass(e).includes('blind-heading'))
      if (elsH1.length !== 1 || elText(elsH1[0]) !== "The def's text content") throw new Error(elsH1.map((e) => elText(e)).join('|'))
    })
    await runner.check('DOM: button rendered with def classes + serialized style + strong child', () => {
      const btns = wireEls.filter((e) => elClass(e).includes('blind-badge'))
      if (btns.length !== 1) throw new Error(`blind-badge elements: ${btns.length}`)
      const b = btns[0]
      if (!normStyle(b).includes('border: 1px solid #333333; border-radius: 4px')) throw new Error(JSON.stringify(normStyle(b)))
      const kids = []
      walkEl(b, (e) => { if (e.tagName === 'STRONG') kids.push(elText(e)) })
      if (kids.join(',') !== 'new') throw new Error(`strong texts: ${kids.join(',')}`)
    })
    await runner.check('DOM: shell keeps own text + authored p + the gained nav.blind-menu with logo/links', () => {
      const shells = wireEls.filter((e) => elClass(e).includes('blind-shell'))
      if (shells.length !== 1 || ownText(shells[0]) !== 'shell text') throw new Error(`shell texts: ${shells.map((e) => ownText(e)).join('|')}`)
      const shell = shells[0]
      const p = Array.from(shell.children ?? []).find((c) => c.tagName === 'P')
      if (!p || elText(p) !== 'authored paragraph') throw new Error('shell authored p missing')
      const nav = Array.from(shell.children ?? []).find((c) => c.tagName === 'NAV')
      if (!nav || !elClass(nav).includes('blind-menu')) throw new Error('shell nav.blind-menu missing')
      const spans = Array.from(nav.children ?? []).map((c) => elText(c))
      if (spans.join(',') !== 'logo,links') throw new Error(`menu spans: ${spans.join(',')}`)
      if (shell.children.length !== 2 || shell.children[0].tagName !== 'P' || shell.children[1].tagName !== 'NAV') throw new Error('shell order wrong')
    })
    await runner.check('DOM: two .blind-item instances rendered under their asides (multi-zone fan-out), asides visible', () => {
      const items = wireEls.filter((e) => elClass(e).includes('blind-item'))
      if (items.length !== 2) throw new Error(`blind-item elements: ${items.length}`)
      const as = wireEls.filter((e) => elClass(e).includes('side-a') || elClass(e).includes('side-b'))
      if (as.length !== 2) throw new Error(`asides: ${as.length}`)
      for (const a of as) {
        if (!normStyle(a).includes('width: 200px')) throw new Error(`aside style: ${JSON.stringify(normStyle(a))}`)
        if (!Array.from(a.children ?? []).some((c) => elClass(c).includes('blind-item'))) throw new Error(`aside ${a.className} has no placed item`)
      }
    })
    await runner.check('DOM: no stray def-root elements in the live DOM (span.blind-title never emitted)', () => {
      if (wireEls.some((e) => elClass(e).includes('blind-title'))) throw new Error('stray blind-title element in DOM')
    })

    // ---- 9. K4 side cards (D1/D2 guard channels, pure DATA) ----------------
    await runner.check('side card: placement-entry-invalid warn on the K4 channel (non-object placement entry)', () => {
      if (!entryInvalid.warnings.some((w) => w.code === 'placement-entry-invalid')) throw new Error(JSON.stringify(entryInvalid.warnings))
    })
    await runner.check('side card: invalid-entry node still renders its own content (entry skipped, node kept)', () => {
      const txt = domText('invalid-entry-mount')
      if (!txt.includes('invalid-entry card renders')) throw new Error(JSON.stringify(txt))
    })
    await runner.check('side card: payload-shape-obsolete warn on the K4 channel (doc.content object form)', () => {
      if (!payloadObsolete.warnings.some((w) => w.code === 'payload-shape-obsolete')) throw new Error(JSON.stringify(payloadObsolete.warnings))
    })
    await runner.check('side card: obsolete payload content skipped (never renders)', () => {
      const txt = domText('obsolete-payload-mount')
      if (txt.includes('obsolete payload content')) throw new Error('obsolete payload content rendered')
    })
    await runner.check('side card: obsolete envelope root children still render (only the payload was skipped)', () => {
      const txt = domText('obsolete-payload-mount')
      if (!txt.includes('obsolete-payload card renders')) throw new Error(JSON.stringify(txt))
    })
    await runner.check('main envelope: zero K4 warnings rendered (warnings channel empty)', () => {
      if (mainWarningsEl && mainWarningsEl.textContent.trim() !== '') throw new Error(JSON.stringify(mainWarningsEl.textContent))
    })

    // ---- 10. PAR-5 parity against the builder's SSR render ------------------
    const trees = treeFromOps(ops)
    await runner.check('PAR-5: in-browser render shape ≡ server render shape (wire-agnostic signature)', () => {
      const clientSig = shapeSigOfTrees(trees)
      if (clientSig !== serverData.serverTreeSig) throw new Error('server/client shape signatures differ')
    })
    await runner.check("PAR-5: the builder's SSRFragmentAdapter fragment is embedded (expectedHtml, root div id=blind-app)", () => {
      if (typeof serverData.expectedHtml !== 'string' || !serverData.expectedHtml.includes('<div id="blind-app"')) {
        throw new Error('expected SSR fragment missing from the page data')
      }
    })
    await runner.check('PAR-5: fragment mirrors the live DOM markers (classes + media rule + both fan-out items)', () => {
      const frag = serverData.expectedHtml
      for (const cls of ['blind-card', 'blind-heading', 'blind-badge', 'blind-menu', 'blind-shell', 'blind-item']) {
        if (!frag.includes(`class="${cls}`) && !frag.includes(`class="${cls} `) && !frag.includes(` ${cls}`)) {
          throw new Error(`fragment missing class marker ${cls}`)
        }
        if (!wireEls.some((e) => elClass(e).includes(cls))) throw new Error(`live DOM missing class ${cls}`)
      }      if ((frag.match(/class="blind-item/g) ?? []).length !== 2) throw new Error(`fragment blind-item count ≠ 2`)
      if (!frag.includes('@media (max-width: 600px)')) throw new Error('fragment missing the media query rule')
    })
    await runner.check('PAR-5: side-card fragments embedded and mirrored by the live cards', () => {
      const f = serverData.sideCards
      if (!f?.expectedEntryInvalid?.includes('invalid-entry card renders')) throw new Error('expectedEntryInvalid fragment missing')
      if (!f?.expectedPayloadObsolete?.includes('obsolete-payload card renders')) throw new Error('expectedPayloadObsolete fragment missing')
      if (f.expectedPayloadObsolete.includes('obsolete payload content')) throw new Error('obsolete payload leaked into the expected fragment')
      if (!domText('invalid-entry-mount').includes('invalid-entry card renders')) throw new Error('live invalid-entry card missing')
      if (!domText('obsolete-payload-mount').includes('obsolete-payload card renders')) throw new Error('live obsolete-payload card missing')
    })

    PROFILE.checksMs = now() - checksT0

    runner.summary('legacy-shape — 17 nodes / 12 path-states / 16 elements / one compilePath bootstrap')

    // ---- census published for the smoke guard -------------------------------
    const censusNodes = supervisor.allNodes()
    PROFILE.states = actionable.length
    PROFILE.elements = els.length
    PROFILE.registered = censusNodes.length
    PROFILE.inTree = censusNodes.filter((n) => !n.destroyed && n.isInTree).length
    PROFILE.unplaced = censusNodes.filter((n) => !n.destroyed && n.state === 'unplaced').length
    PROFILE.destroyed = censusNodes.filter((n) => n.destroyed).length
    PROFILE.warningsMain = translated.warnings.length
    PROFILE.fanOut = itemStates.length
    PROFILE.stylesRules = ruleStrings

    PROFILE.totalMs = now() - tStart
    PROFILE.coveredMs =
      PROFILE.loadMs + PROFILE.compileMs + PROFILE.emitMs + PROFILE.diffMs + PROFILE.applyMs +
      PROFILE.sideMs + PROFILE.checksMs
    const f = (v) => v.toFixed(1)
    console.log(
      `[legacy-shape:profile] states=${PROFILE.states} passes=${PROFILE.passes} elements=${PROFILE.elements} ` +
      `load=${f(PROFILE.loadMs)}ms compile=${f(PROFILE.compileMs)}ms ` +
      `emit=${f(PROFILE.emitMs)}ms diff=${f(PROFILE.diffMs)}ms apply=${f(PROFILE.applyMs)}ms side=${f(PROFILE.sideMs)}ms checks=${f(PROFILE.checksMs)}ms ` +
      `warningsMain=${PROFILE.warningsMain} fanOut=${PROFILE.fanOut} stylesRules=${PROFILE.stylesRules.length} ` +
      `census(registered=${PROFILE.registered} inTree=${PROFILE.inTree} unplaced=${PROFILE.unplaced} destroyed=${PROFILE.destroyed} prototypes=${PROFILE.prototypes} cloneOps=${PROFILE.cloneOps}) ` +
      `covered=${f(PROFILE.coveredMs)}ms total=${f(PROFILE.totalMs)}ms ` +
      `unmeasured=${f(PROFILE.totalMs - PROFILE.coveredMs)}ms`,
    )
    globalThis.__legacyShapeProfile = PROFILE
  }

  /** Shim-compatible text walk of a mount's subtree. */
  function domText(id) {
    const mount = document.getElementById(id)
    const parts = []
    walkEl(mount, (e) => { if (e.textContent) parts.push(e.textContent) })
    return parts.join('')
  }

  globalThis.__legacyShapeDone = main()
}
