// translate-showcase — data-driven demo of the translate-layer kernel (K1–K8)
//
// Blind-test WRITER artifact (AGENTS.md item 9, step a): authored from
// documentation only — docs/specs/translate.md (§1/§2/§2.1/§5),
// docs/specs/legacy-component-ref-only-review.md (K1–K8, Appendices A–E),
// docs/specs/payload.md (R-2/R-5), docs/specs/derived-state.md (§3/§4),
// docs/specs/fork-stress-data.md (data-driven page pattern),
// docs/skills/designing-pages.md §11/§12, and the legacy vocabulary
// (docs/skills/components.md, original Preempt project).
//
// Section -> doc row mapping (see also the template header annotation):
//   root template.component (5 value-bearing bindings)  -> translate.md §2.1
//       "Array form" (K7) + K6 (value-carrying root binding -> SOURCE provider)
//   #array-card   component ARRAY of 3 legal bindings    -> §2.1 "Array form
//       (post-K7)"; K1 synthesis; legal-matrix row 1
//   #consumer-card plain {reference} consumer            -> §2 TR-H2 + §5-A;
//       resolves the root depth-0 provider (K6); authored derived rides
//   #dup-card     duplicate reference + duplicate target -> §2.1 anti-patterns;
//       K8 pre-anchor warn+skip (component-duplicate-reference /
//       component-duplicate-target)
//   #vacuous-card component: {}                          -> K3
//       component-binding-empty, no anchors
//   #empty-array-card component: []                      -> K3 Array.isArray
//       carve-out (D3/N7) — VALID multi-binding form
//   #unresolved-card props.<key> consumer, NO provider   -> K1 + S-R4.3:
//       key omitted, own content renders
//   #syntax-card  target 'props.name.'                   -> D7 syntax edge:
//       component-target-skipped (skip + warn)
//   #gap-card     target 'bogus.path'                    -> NP1/N2: unknown
//       target path -> component-target-gap (K8 vocabulary pass)
//   #dotted-card  dotted reference + props.<key> target  -> K2 carve-out:
//       synthesis skipped (component-target-skipped), consumer anchor KEPT
//
// Warnings channel (K4): translated.warnings rendered into <pre id="warnings">.
// Reverse (K5 + payload.md R-2/R-5): reverseTranslate round-trip asserting the
// apply path persists as `target`, synthesized derived is stripped (authored
// derived stays), and re-translation fires no component-target-skipped /
// duplicate warnings.

import { translateLegacy, reverseTranslate } from '../dist/core/translate.js';
import { Supervisor } from '../dist/core/supervisor.js';
import { createClient } from '../dist/core/client.js';
import { diffMinimal } from '../dist/core/render.js';
import { emitElements, applyOps } from '../dist/core/render-helpers.js';
import { DomAdapter } from '../dist/core/adapters.js';
import { makeRunner } from './lib/runner.js';

export function translateShowcaseLegacyData() {
  return {
    template: {
      root: {
        type: 'app',
        props: { id: 'showcase-root' },
        children: [
          {
            type: 'div',
            props: { id: 'array-card' },
            component: [
              { reference: 'arrConsumer', target: 'props.apply-consumer' },
              { reference: 'rootValue' },
              { reference: 'selfApply', value: 'self-applied', target: 'props.self-apply' },
            ],
          },
          {
            type: 'div',
            props: { id: 'consumer-card' },
            component: [{ reference: 'rootValue' }],
            derived: { props: { 'authored-bake': 'authored-literal' } },
          },
          {
            type: 'div',
            props: { id: 'dup-card' },
            content: 'dup-card-content',
            component: [
              { reference: 'dupRef', target: 'props.keep1' },
              { reference: 'dupRef', target: 'props.keep2' },
              { reference: 'dupTgt', target: 'props.shared' },
              { reference: 'other', target: 'props.shared' },
            ],
          },
          {
            type: 'div',
            props: { id: 'vacuous-card' },
            content: 'vacuous-card-content',
            component: {},
          },
          {
            type: 'div',
            props: { id: 'empty-array-card' },
            content: 'empty-array-card-content',
            component: [],
          },
          {
            type: 'div',
            props: { id: 'unresolved-card' },
            content: 'unresolved-content',
            component: [{ reference: 'ghostRef', target: 'props.ghost' }],
          },
          {
            type: 'div',
            props: { id: 'syntax-card' },
            content: 'syntax-card-content',
            component: [{ reference: 'syntaxRef', target: 'props.name.' }],
          },
          {
            type: 'div',
            props: { id: 'gap-card' },
            content: 'gap-card-content',
            component: [{ reference: 'gapRef', target: 'bogus.path' }],
          },
          {
            type: 'div',
            props: { id: 'dotted-card' },
            content: 'dotted-card-content',
            component: [{ reference: 'dotted.ref.name', target: 'props.dot' }],
          },
        ],
      },
      component: [
        { reference: 'rootValue', value: 'root-provided' },
        { reference: 'arrConsumer', value: 'arr-consumed' },
        { reference: 'dupRef', value: 'dup-ref-value' },
        { reference: 'dupTgt', value: 'dup-tgt-value' },
        { reference: 'dotted.ref.name', value: 'dotted-value' },
      ],
    },
    clientConfig: { runInstantiation: false, runMonitoring: true },
  };
}

export function translateShowcaseServerData() {
  const translated = translateLegacy(translateShowcaseLegacyData());
  return { title: 'translate-showcase', expectedWarnings: translated.warnings };
}

function findEl(container, predicate) {
  for (const el of Array.from(container.children ?? [])) {
    if (predicate(el)) return el;
    const hit = findEl(el, predicate);
    if (hit) return hit;
  }
  return null;
}

function legacyNodes(doc) {
  const out = [];
  const root = doc && doc.template ? doc.template.root : null;
  if (root) out.push(root);
  if (root && Array.isArray(root.children)) out.push(...root.children);
  if (doc && doc.template && Array.isArray(doc.template.children)) out.push(...doc.template.children);
  return out;
}

function legacyNodeById(doc, id) {
  return legacyNodes(doc).find((n) => n && n.props && n.props.id === id) || null;
}

if (typeof document !== 'undefined') {
  globalThis.__translateShowcaseDone = (async function runTranslateShowcase() {
    const t0 = performance.now();
    const envelope = JSON.parse(document.getElementById('preempt-initial-data').textContent.trim());
    const serverData = JSON.parse(document.getElementById('server-data').textContent.trim());
    const appEl = document.getElementById('app');

    const t1 = performance.now();
    const translated = translateLegacy(envelope);
    const supervisor = new Supervisor({});
    for (const n of translated.nodes) supervisor.registerNode(n);
    const client = createClient(supervisor);

    const t2 = performance.now();
    const compiled = translated.root.compile(translated.nodes);
    supervisor.recordResolved(compiled.actionable);
    const states = translated.nodes
      .map((n) => supervisor.getResolvedStates(n.id))
      .filter(Boolean)
      .flat();
    const els = emitElements(states);
    const ops = diffMinimal(null, els);
    const domAdapter = new DomAdapter(appEl);
    applyOps(domAdapter, ops);
    const t3 = performance.now();

    const warningsEl = document.getElementById('warnings');
    warningsEl.textContent = translated.warnings.map((w) => `${w.code} @ ${w.path}`).join('\n');

    const reversed = reverseTranslate(translated.root);
    const again = translateLegacy(reversed);

    const runner = makeRunner();
    document.getElementById('results').appendChild(runner.el);
    const expected = serverData.expectedWarnings || [];
    const warningsText = warningsEl.textContent;
    const counts = {};
    for (const w of translated.warnings) counts[w.code] = (counts[w.code] || 0) + 1;

    const byId = (id) => findEl(appEl, (el) => el.getAttribute && el.getAttribute('id') === id);
    const attr = (el, name) => (el && el.getAttribute ? el.getAttribute(name) : null);
    const attrAny = (el, key) => {
      const bare = attr(el, key);
      return bare !== null ? bare : attr(el, `data-${key}`);
    };
    const text = (el) => (el ? el.textContent || '' : '');
    const hasId = (id) => byId(id) !== null;
    const baked = [
      ['apply-consumer', 'arr-consumed'],
      ['self-apply', 'self-applied'],
      ['keep1', 'dup-ref-value'],
      ['shared', 'dup-tgt-value'],
      ['authored-bake', 'authored-literal'],
    ];

    // NOTE: every check below is throw-style (the shared runner counts a
    // check as PASS only when the callback does NOT throw; boolean returns
    // are ignored and would be vacuous).
    runner.check('warnings rendered: all expected codes present', () => {
      for (const w of expected) {
        if (!warningsText.includes(w.code)) throw new Error(`missing code ${w.code} in warnings text`);
      }
    });
    runner.check('warnings rendered: code @ path pairs present', () => {
      for (const w of expected) {
        if (!warningsText.includes(`${w.code} @ ${w.path}`)) throw new Error(`missing pair ${w.code} @ ${w.path}`);
      }
    });
    runner.check('warnings rendered: exact code counts (binding-empty 1, skipped 2, gap 1, dup-ref 1, dup-target 1)', () => {
      const want = {
        'component-binding-empty': 1,
        'component-target-skipped': 2,
        'component-target-gap': 1,
        'component-duplicate-reference': 1,
        'component-duplicate-target': 1,
      };
      for (const [code, n] of Object.entries(want)) {
        if (counts[code] !== n) throw new Error(`${code}: expected ${n}, got ${counts[code]}`);
      }
    });

    runner.check('(a) array-card: consumer props.<key> binding bakes the resolved value', () => {
      const v = attrAny(byId('array-card'), 'apply-consumer');
      if (v !== 'arr-consumed') throw new Error(`array-card apply-consumer=${JSON.stringify(v)} (expected arr-consumed)`);
    });
    runner.check('(a) array-card: provide-and-self-apply bakes own value', () => {
      const v = attrAny(byId('array-card'), 'self-apply');
      if (v !== 'self-applied') throw new Error(`array-card self-apply=${JSON.stringify(v)} (expected self-applied)`);
    });
    runner.check('(b) consumer-card: plain consumer text = resolved value', () => {
      const t = text(byId('consumer-card'));
      if (!t.includes('root-provided')) throw new Error(`consumer-card text=${JSON.stringify(t)} (expected root-provided)`);
    });
    runner.check('(b) consumer-card: authored derived bakes (rule ships)', () => {
      const v = attrAny(byId('consumer-card'), 'authored-bake');
      if (v !== 'authored-literal') throw new Error(`consumer-card authored-bake=${JSON.stringify(v)} (expected authored-literal)`);
    });
    runner.check('(c) dup-card: kept bindings bake', () => {
      const k1 = attrAny(byId('dup-card'), 'keep1');
      if (k1 !== 'dup-ref-value') throw new Error(`dup-card keep1=${JSON.stringify(k1)} (expected dup-ref-value)`);
      const sh = attrAny(byId('dup-card'), 'shared');
      if (sh !== 'dup-tgt-value') throw new Error(`dup-card shared=${JSON.stringify(sh)} (expected dup-tgt-value)`);
    });
    runner.check('(c) dup-card: duplicate reference + duplicate target skipped (no bake)', () => {
      const k2 = attrAny(byId('dup-card'), 'keep2');
      if (k2 !== null) throw new Error(`dup-card keep2=${JSON.stringify(k2)} (expected null)`);
      const o = attrAny(byId('dup-card'), 'other');
      if (o !== null) throw new Error(`dup-card other=${JSON.stringify(o)} (expected null)`);
    });
    runner.check('(d) vacuous {} binding: warn+skip, own content renders', () => {
      const t = text(byId('vacuous-card'));
      if (!t.includes('vacuous-card-content')) throw new Error(`vacuous-card text=${JSON.stringify(t)} (expected vacuous-card-content)`);
    });
    runner.check('(d) component: [] is a VALID multi-binding form (renders)', () => {
      const t = text(byId('empty-array-card'));
      if (!t.includes('empty-array-card-content')) throw new Error(`empty-array-card text=${JSON.stringify(t)} (expected empty-array-card-content)`);
    });
    runner.check('(e) unresolved consumer: key omitted, own content renders', () => {
      const g = attrAny(byId('unresolved-card'), 'ghost');
      if (g !== null) throw new Error(`unresolved-card ghost=${JSON.stringify(g)} (expected null)`);
      const t = text(byId('unresolved-card'));
      if (!t.includes('unresolved-content')) throw new Error(`unresolved-card text=${JSON.stringify(t)} (expected unresolved-content)`);
    });
    runner.check('(f) target-syntax edge props.name.: skipped, no bake', () => {
      const n = attrAny(byId('syntax-card'), 'name');
      if (n !== null) throw new Error(`syntax-card name=${JSON.stringify(n)} (expected null)`);
      const t = text(byId('syntax-card'));
      if (!t.includes('syntax-card-content')) throw new Error(`syntax-card text=${JSON.stringify(t)} (expected syntax-card-content)`);
    });
    runner.check('(g) unknown target path: gap warn, no bake, content renders', () => {
      const t = text(byId('gap-card'));
      if (!t.includes('gap-card-content')) throw new Error(`gap-card text=${JSON.stringify(t)} (expected gap-card-content)`);
    });
    runner.check('(h) dotted reference: synthesis skipped, anchor kept (resolves)', () => {
      const d = attrAny(byId('dotted-card'), 'dot');
      if (d !== null) throw new Error(`dotted-card dot=${JSON.stringify(d)} (expected null)`);
      const t = text(byId('dotted-card'));
      if (!t.includes('dotted-value')) throw new Error(`dotted-card text=${JSON.stringify(t)} (expected dotted-value)`);
    });

    const rArray = legacyNodeById(reversed, 'array-card');
    const arrBindings = rArray && rArray.component ? rArray.component : [];
    runner.check('reverse (R-2): consumer apply path persists as target', () => {
      if (!Array.isArray(arrBindings)) throw new Error(`array-card reversed component is not an array: ${JSON.stringify(arrBindings)}`);
      if (!arrBindings.some((b) => b.reference === 'arrConsumer' && b.target === 'props.apply-consumer' && !('value' in b))) {
        throw new Error(`consumer apply binding missing: ${JSON.stringify(arrBindings)}`);
      }
    });
    runner.check('reverse (R-2): provider emits {reference, value, target}', () => {
      if (!Array.isArray(arrBindings)) throw new Error(`array-card reversed component is not an array: ${JSON.stringify(arrBindings)}`);
      if (!arrBindings.some((b) => b.reference === 'selfApply' && b.value === 'self-applied' && b.target === 'props.self-apply')) {
        throw new Error(`provider binding missing: ${JSON.stringify(arrBindings)}`);
      }
    });
    runner.check('reverse (R-2): name-target next to a provider anchor is DROPPED (no two-name duplex)', () => {
      if (Array.isArray(arrBindings) && arrBindings.some((b) => b.reference === 'rootValue')) {
        throw new Error(`rootValue consumer survived reverse: ${JSON.stringify(arrBindings)}`);
      }
    });
    runner.check('reverse (R-2): reference-only consumer emits without target', () => {
      const card = legacyNodeById(reversed, 'consumer-card');
      const b = card && card.component;
      if (!b || Array.isArray(b)) throw new Error(`consumer-card reversed component: ${JSON.stringify(b)}`);
      if (b.reference !== 'rootValue' || 'target' in b || 'value' in b) throw new Error(`consumer-card binding: ${JSON.stringify(b)}`);
    });
    runner.check('reverse (R-2): root template.component stays value-bearing (K6)', () => {
      const rootComp = reversed.template && reversed.template.component;
      if (!Array.isArray(rootComp)) throw new Error(`reversed root template.component: ${JSON.stringify(rootComp)}`);
      if (!rootComp.some((b) => b.reference === 'rootValue' && b.value === 'root-provided')) {
        throw new Error(`rootValue provider missing from reversed template.component: ${JSON.stringify(rootComp)}`);
      }
    });
    runner.check('reverse (N1/K5): synthesized derived stripped everywhere', () => {
      const leak = legacyNodes(reversed).some((n) => {
        const d = (n && n.derived && n.derived.props) || {};
        return ['apply-consumer', 'self-apply', 'keep1', 'shared', 'ghost', 'dot'].some((k) =>
          Object.prototype.hasOwnProperty.call(d, k),
        );
      });
      if (leak) throw new Error('synthesized derived leaked through reverse');
    });
    runner.check('reverse (N1/K5): authored derived kept', () => {
      const card = legacyNodeById(reversed, 'consumer-card');
      if (!card || !card.derived || !card.derived.props || card.derived.props['authored-bake'] !== 'authored-literal') {
        throw new Error(`authored derived lost: ${JSON.stringify(card && card.derived)}`);
      }
    });
    runner.check('(h) dotted reference: synthesis skipped, consumer anchor kept', () => {
      const dotted = legacyNodeById(reversed, 'dotted-card');
      const b = dotted && dotted.component;
      const v = attrAny(byId('dotted-card'), 'dot');
      if (v !== null) throw new Error(`dotted-card dot=${JSON.stringify(v)} (expected null)`);
      if (!b || Array.isArray(b)) throw new Error(`dotted-card reversed component: ${JSON.stringify(b)}`);
      if (b.reference !== 'dotted.ref.name' || 'target' in b) throw new Error(`dotted-card binding: ${JSON.stringify(b)}`);
    });
    runner.check('round-trip (R-5): re-translate fires NO component-target-skipped', () => {
      const hits = again.warnings.filter((w) => w.code === 'component-target-skipped');
      if (hits.length > 0) throw new Error(`re-translate component-target-skipped: ${JSON.stringify(hits)}`);
    });
    runner.check('round-trip (R-5): re-translate fires NO duplicate warnings', () => {
      const hits = again.warnings.filter((w) => w.code === 'component-duplicate-reference' || w.code === 'component-duplicate-target');
      if (hits.length > 0) throw new Error(`re-translate duplicate warnings: ${JSON.stringify(hits)}`);
    });

    const fragment = serverData.expectedHtml || '';
    runner.check('PAR-5: SSR baked attrs present in live DOM', () => {
      for (const [key, value] of baked) {
        if (!fragment.includes(`${key}="${value}"`) && !fragment.includes(`data-${key}="${value}"`)) {
          throw new Error(`SSR fragment missing ${key}="${value}"`);
        }
        const el = findEl(appEl, (el) => el.getAttribute &&
          (el.getAttribute(key) === value || el.getAttribute(`data-${key}`) === value));
        if (el === null) throw new Error(`live DOM missing ${key}="${value}"`);
      }
    });
    const textMarkers = [
      'root-provided',
      'unresolved-content',
      'vacuous-card-content',
      'empty-array-card-content',
      'syntax-card-content',
      'gap-card-content',
      'authored-literal',
    ];
    runner.check('PAR-5: SSR fragment content markers present in live DOM', () => {
      for (const m of textMarkers) {
        if (!fragment.includes(m)) throw new Error(`SSR fragment missing marker ${m}`);
        // shim-compatible: textContent is not aggregated on parents by the
        // smoke shim — walk the #app subtree for any element carrying the marker
        const inText = findEl(appEl, (el) => el.textContent && el.textContent.includes(m)) !== null;
        if (inText) continue;
        const asAttr = baked.some(([key, value]) => value === m &&
          findEl(appEl, (el) => el.getAttribute && el.getAttribute(key) === value) !== null);
        if (!asAttr) throw new Error(`live DOM missing marker ${m}`);
      }
    });
    runner.check('all 9 cards render under the mount (root non-actionable per S-R2.5/F3)', () => {
      const ids = ['array-card', 'consumer-card', 'dup-card', 'vacuous-card', 'empty-array-card',
        'unresolved-card', 'syntax-card', 'gap-card', 'dotted-card'];
      for (const id of ids) {
        if (!hasId(id)) throw new Error(`card ${id} did not render`);
      }
    });

    console.log(
      `[translate-showcase:profile] translate=${(t1 - t0).toFixed(1)}ms ` +
      `compile=${(t2 - t1).toFixed(1)}ms render=${(t3 - t2).toFixed(1)}ms ` +
      `compileCalls=1 total=${(t3 - t0).toFixed(1)}ms`,
    );
    await runner.summary('translate-showcase');
  })().catch((err) => {
    console.error('[translate-showcase] fatal:', err);
    throw err;
  });
}
