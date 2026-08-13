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

    runner.check('warnings rendered: all expected codes present', () =>
      expected.every((w) => warningsText.includes(w.code)),
    );
    runner.check('warnings rendered: code @ path pairs present', () =>
      expected.every((w) => warningsText.includes(`${w.code} @ ${w.path}`)),
    );
    runner.check('warnings rendered: exact code counts (binding-empty 1, skipped 2, gap 1, dup-ref 1, dup-target 1)', () =>
      counts['component-binding-empty'] === 1 &&
      counts['component-target-skipped'] === 2 &&
      counts['component-target-gap'] === 1 &&
      counts['component-duplicate-reference'] === 1 &&
      counts['component-duplicate-target'] === 1,
    );

    runner.check('(a) array-card: consumer props.<key> binding bakes the resolved value', () =>
      attrAny(byId('array-card'), 'apply-consumer') === 'arr-consumed',
    );
    runner.check('(a) array-card: provide-and-self-apply bakes own value', () =>
      attrAny(byId('array-card'), 'self-apply') === 'self-applied',
    );
    runner.check('(b) consumer-card: plain consumer text = resolved value', () =>
      text(byId('consumer-card')).includes('root-provided'),
    );
    runner.check('(b) consumer-card: authored derived bakes (rule ships)', () =>
      attrAny(byId('consumer-card'), 'authored-bake') === 'authored-literal',
    );
    runner.check('(c) dup-card: kept bindings bake', () =>
      attrAny(byId('dup-card'), 'keep1') === 'dup-ref-value' &&
      attrAny(byId('dup-card'), 'shared') === 'dup-tgt-value',
    );
    runner.check('(c) dup-card: duplicate reference + duplicate target skipped (no bake)', () =>
      attrAny(byId('dup-card'), 'keep2') === null && attrAny(byId('dup-card'), 'other') === null,
    );
    runner.check('(d) vacuous {} binding: warn+skip, own content renders', () =>
      text(byId('vacuous-card')).includes('vacuous-card-content'),
    );
    runner.check('(d) component: [] is a VALID multi-binding form (renders)', () =>
      text(byId('empty-array-card')).includes('empty-array-card-content'),
    );
    runner.check('(e) unresolved consumer: key omitted, own content renders', () =>
      attrAny(byId('unresolved-card'), 'ghost') === null &&
      text(byId('unresolved-card')).includes('unresolved-content'),
    );
    runner.check('(f) target-syntax edge props.name.: skipped, no bake', () =>
      attrAny(byId('syntax-card'), 'name') === null &&
      text(byId('syntax-card')).includes('syntax-card-content'),
    );
    runner.check('(g) unknown target path: gap warn, no bake, content renders', () =>
      text(byId('gap-card')).includes('gap-card-content'),
    );
    runner.check('(h) dotted reference: synthesis skipped, anchor kept (resolves)', () =>
      attrAny(byId('dotted-card'), 'dot') === null &&
      text(byId('dotted-card')).includes('dotted-value'),
    );

    const rArray = legacyNodeById(reversed, 'array-card');
    const arrBindings = rArray && rArray.component ? rArray.component : [];
    runner.check('reverse (R-2): consumer apply path persists as target', () =>
      Array.isArray(arrBindings) &&
      arrBindings.some((b) => b.reference === 'arrConsumer' && b.target === 'props.apply-consumer' && !('value' in b)),
    );
    runner.check('reverse (R-2): provider emits {reference, value, target}', () =>
      Array.isArray(arrBindings) &&
      arrBindings.some((b) => b.reference === 'selfApply' && b.value === 'self-applied' && b.target === 'props.self-apply'),
    );
    runner.check('reverse (R-2): name-target next to a provider anchor is DROPPED (no two-name duplex)', () =>
      !Array.isArray(arrBindings) || !arrBindings.some((b) => b.reference === 'rootValue'),
    );
    runner.check('reverse (R-2): reference-only consumer emits without target', () => {
      const card = legacyNodeById(reversed, 'consumer-card');
      const b = card && card.component;
      return b && !Array.isArray(b) && b.reference === 'rootValue' && !('target' in b) && !('value' in b);
    });
    runner.check('reverse (R-2): root template.component stays value-bearing (K6)', () => {
      const rootComp = reversed.template && reversed.template.component;
      return Array.isArray(rootComp) &&
        rootComp.some((b) => b.reference === 'rootValue' && b.value === 'root-provided');
    });
    runner.check('reverse (N1/K5): synthesized derived stripped everywhere', () =>
      !legacyNodes(reversed).some((n) => {
        const d = (n && n.derived && n.derived.props) || {};
        return ['apply-consumer', 'self-apply', 'keep1', 'shared', 'ghost', 'dot'].some((k) =>
          Object.prototype.hasOwnProperty.call(d, k),
        );
      }),
    );
    runner.check('reverse (N1/K5): authored derived kept', () => {
      const card = legacyNodeById(reversed, 'consumer-card');
      return card && card.derived && card.derived.props && card.derived.props['authored-bake'] === 'authored-literal';
    });
    runner.check('(h) dotted reference: synthesis skipped, consumer anchor kept', () => {
      const dotted = legacyNodeById(reversed, 'dotted-card');
      const b = dotted && dotted.component;
      return attrAny(byId('dotted-card'), 'dot') === null &&
        b && !Array.isArray(b) && b.reference === 'dotted.ref.name' && !('target' in b);
    });
    runner.check('round-trip (R-5): re-translate fires NO component-target-skipped', () =>
      !again.warnings.some((w) => w.code === 'component-target-skipped'),
    );
    runner.check('round-trip (R-5): re-translate fires NO duplicate warnings', () =>
      !again.warnings.some((w) => w.code === 'component-duplicate-reference' || w.code === 'component-duplicate-target'),
    );

    const fragment = serverData.expectedHtml || '';
    runner.check('PAR-5: SSR baked attrs present in live DOM', () =>
      baked.every(([key, value]) => {
        if (!fragment.includes(`${key}="${value}"`) && !fragment.includes(`data-${key}="${value}"`)) return false;
        return findEl(appEl, (el) => el.getAttribute &&
          (el.getAttribute(key) === value || el.getAttribute(`data-${key}`) === value)) !== null;
      }),
    );
    const textMarkers = [
      'root-provided',
      'unresolved-content',
      'vacuous-card-content',
      'empty-array-card-content',
      'syntax-card-content',
      'gap-card-content',
      'authored-literal',
    ];
    runner.check('PAR-5: SSR fragment content markers present in live DOM', () =>
      textMarkers.every((m) => {
        if (!fragment.includes(m)) return false;
        if (text(appEl).includes(m)) return true;
        return baked.some(([, value]) => value === m &&
          findEl(appEl, (el) => el.getAttribute &&
            (el.getAttribute(value) === m || el.getAttribute(`data-${value}`) === m)) !== null);
      }),
    );
    runner.check('all 9 cards render under the mount (root non-actionable per S-R2.5/F3)', () => {
      const ids = ['array-card', 'consumer-card', 'dup-card', 'vacuous-card', 'empty-array-card',
        'unresolved-card', 'syntax-card', 'gap-card', 'dotted-card'];
      return ids.every(hasId);
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
