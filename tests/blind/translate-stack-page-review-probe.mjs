// translate-stack PAGE-REVIEW probe (blind-test loop, step c) — read-only
// verification of tests/blind/translate-stack-fixture.json through the core
// pipeline exactly as the demos do (path-fork-data.js surface:
// translateLegacy → Supervisor register → per-node compilePath → recordResolved
// → emitElements → diffMinimal → applyOps(SSRFragmentAdapter)). The fixture is
// placement-routed (targetPlacement consumer + placementName producers), so the
// placement-path demos' per-node compilePath bootstrap is the pipeline.
// Reviewer tooling — never imports engine internals beyond the core entry
// points the demos use.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { translateLegacy } from '../../dist/core/translate.js';
import { Supervisor } from '../../dist/core/supervisor.js';
import { emitElements, applyOps, wireKey } from '../../dist/core/render-helpers.js';
import { diffMinimal } from '../../dist/core/render.js';
import { SSRFragmentAdapter } from '../../dist/core/adapters.js';

const here = fileURLToPath(new URL('.', import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, 'translate-stack-fixture.json'), 'utf8'));

const results = [];
let failures = 0;
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail });
  if (!cond) failures += 1;
}
function report(name, lines) {
  console.log(`\n== ${name} ==`);
  for (const l of lines) console.log('  ' + l);
}

// ---- 1. translate ---------------------------------------------------------
const translated = translateLegacy(fixture);
report('translateLegacy', [
  `nodes=${translated.nodes.length} warnings=${translated.warnings.length}`,
  ...translated.warnings.map((w) => `${w.code} @ ${w.path ?? w.pathKey ?? ''}`),
]);
check('translate: ZERO warnings (incl. no component-target-gap, no K4 placement warns)', translated.warnings.length === 0,
  JSON.stringify(translated.warnings));
check('translate: no component-target-gap warn', !translated.warnings.some((w) => w.code === 'component-target-gap'), '');
check('translate: no placement-name-vetoed warn', !translated.warnings.some((w) => w.code === 'placement-name-vetoed'), '');

// ---- 2. register + ONE path-enumeration bootstrap pass --------------------
const supervisor = new Supervisor({});
for (const n of translated.nodes) supervisor.registerNode(n);
const actionable = [];
for (const n of translated.nodes) actionable.push(...n.compilePath().actionable);
supervisor.recordResolved(actionable);
const byNode = new Map(supervisor.allNodes().map((n) => [n.id, n]));
const els = emitElements(actionable, byNode);
const ops = diffMinimal(null, els);
const adapter = new SSRFragmentAdapter();
applyOps(adapter, ops);
const ssr = adapter.toString();

report('bootstrap', [
  `actionable path-states=${actionable.length}`,
  `elements=${els.length}`,
  `ops=${ops.length} (create=${ops.filter((o) => o.kind === 'create').length} set=${ops.filter((o) => o.kind === 'set').length} append=${ops.filter((o) => o.kind === 'append').length} styles=${ops.filter((o) => o.kind === 'styles').length} remove=${ops.filter((o) => o.kind === 'remove').length})`,
]);

// ---- 3. cssDef claims (STL-1..4) ------------------------------------------
const stylesOps = ops.filter((o) => o.kind === 'styles');
const ruleStrings = stylesOps.flatMap((o) => o.cssDefs ?? []);
report('styles ops', [
  `count=${stylesOps.length}`,
  `payload[0]=${JSON.stringify(ruleStrings)}`,
]);
check('STL-4: exactly ONE styles op (one sweep)', stylesOps.length === 1, String(stylesOps.length));
check('STL-4: payload entries are STRINGS (no raw object reaches the adapter)', ruleStrings.every((r) => typeof r === 'string'), '');
const expectRules = [
  '.blind-card{border: 1px solid #ccc;padding: 16px;}',
  'nav{display: flex;gap: 8px;align-items: center;}',
  '.blind-badge{background-color: #ffe08a;}',
  '.blind-menu{background-color: #222;color: #fff;}',
  '.blind-item{border-left: 3px solid #2a7;}',
];
for (const r of expectRules) check(`STL-1: rule emitted — ${r}`, ruleStrings.includes(r), '');
const blindItemCount = ruleStrings.filter((r) => r === '.blind-item{border-left: 3px solid #2a7;}').length;
check('STL-2: .blind-item rule emitted ONCE despite 2 owning path-states (signature dedup)', blindItemCount === 1, `count=${blindItemCount}`);
const ruleSet = new Set(ruleStrings);
check('STL-2: all 5 rules deduped (no duplicate rule strings in the payload)', ruleStrings.length === ruleSet.size, `rules=${ruleStrings.length} unique=${ruleSet.size}`);

// ---- 4. tree reconstruction from ops. Append ops carry BARE wires (no
//        forkKey — render.ts); path-state elements store under composite keys
//        wireKey(wire, forkKey) = `wire\0forkKey`. Resolution follows the
//        adapters' findEl contract (render-helpers.js): exact wire first, then
//        the `${wire}\0` prefix (exactly one such element exists per wire).
const nodesByKey = new Map();
const keyOf = (o) => wireKey(o.wire, o.forkKey);
function resolveKey(store, wire) {
  if (store.has(wire)) return wire;
  const prefix = `${wire}\0`;
  for (const k of store.keys()) if (k.startsWith(prefix)) return k;
  return undefined;
}
for (const o of ops) {
  if (o.kind === 'create') {
    nodesByKey.set(keyOf(o), { wire: o.wire, type: o.type, props: {}, children: [], styles: [] });
  } else if (o.kind === 'set') {
    const el = nodesByKey.get(keyOf(o));
    if (el) el.props[o.name] = o.value;
  } else if (o.kind === 'append') {
    const ok = resolveKey(nodesByKey, o.owner);
    const ck = resolveKey(nodesByKey, o.child);
    const owner = nodesByKey.get(ok);
    const child = nodesByKey.get(ck);
    if (owner && child) owner.children.push(child);
  }
}
const roots = [...nodesByKey.values()].filter((el) => ![...nodesByKey.values()].some((p) => p.children.includes(el)));
function treeString(el, indent = '') {
  const cls = el.props['css:classes'];
  const style = el.props['css:style'];
  const text = el.props['text'];
  const attrs = [
    el.type,
    el.wire !== undefined ? `wire=${el.wire}` : '',
    cls !== undefined ? `class=${Array.isArray(cls) ? cls.join(' ') : cls}` : '',
    style !== undefined ? `style=${style}` : '',
    text !== undefined ? `text=${JSON.stringify(text)}` : '',
    (el.styles ?? []).length > 0 ? `styles=[${el.styles.join(' ')}]` : '',
  ].filter(Boolean).join(' | ');
  const kids = el.children.map((c) => treeString(c, indent + '  '));
  return `${indent}<${attrs}>\n${kids.join('\n')}`;
}
report('emitted element tree', roots.map((r) => treeString(r)));
report('SSR HTML', [ssr.slice(0, 1200)]);

// ---- 5. seam-target claims (SED-1..3) -------------------------------------
const h1 = [...nodesByKey.values()].find((el) => el.type === 'h1');
check('SED-3: content-target h1 keeps its OWN element + class', !!h1 && h1.type === 'h1' && Array.isArray(h1.props['css:classes']) && h1.props['css:classes'].includes('blind-heading'), h1 ? treeString(h1) : 'missing');
check("SED-3: h1 content slot carries the def's text 'The def's text content'", !!h1 && h1.props['text'] === "The def's text content", h1 ? JSON.stringify(h1.props['text']) : 'missing');
check('SED-3: h1 has NO children (text-only delivery, no shape change)', !!h1 && h1.children.length === 0, h1 ? String(h1.children.length) : '');

const badge = [...nodesByKey.values()].find((el) => el.type === 'button');
const badgeEl = els.find((e) => e.type === 'button');
check('SED-1: type-target span collapses into button (def type, no span remains)', !!badge, '');
check('SED-1: button carries def classes blind-badge', !!badge && Array.isArray(badge.props['css:classes']) && badge.props['css:classes'].includes('blind-badge'), badge ? JSON.stringify(badge.props['css:classes']) : '');
check('SED-1: button carries def style (border + borderRadius serialized)', !!badge && typeof badge.props['css:style'] === 'string' && badge.props['css:style'].includes('border: 1px solid #333;') && badge.props['css:style'].includes('border-radius: 4px;'), badge ? JSON.stringify(badge.props['css:style']) : '');
check('SED-1: button has the def child strong("new")', !!badge && badge.children.length === 1 && badge.children[0].type === 'strong' && badge.children[0].props['text'] === 'new', badge ? badge.children.map((c) => c.type).join(',') : '');
check('SED-1: button element carries NO def-content text (SED-1 delivery = type + css + children only; def content is not delivered)', !!badgeEl && badgeEl.props['text'] === undefined, badgeEl ? JSON.stringify(badgeEl.props) : '');
const spans = [...nodesByKey.values()].filter((el) => el.type === 'span');
check('SED-1: no bare consumer span remains (no def-root element for type-target)', spans.every((s) => s.props['text'] === 'logo' || s.props['text'] === 'links'), spans.map((s) => s.props['text'] ?? '').join(','));

const shell = [...nodesByKey.values()].find((el) => el.type === 'div' && Array.isArray(el.props['css:classes']) && el.props['css:classes'].includes('blind-shell'));
check('SED-2: children-target keeps its OWN element div.blind-shell', !!shell, '');
check('SED-2: shell keeps own classes + style', !!shell && Array.isArray(shell.props['css:classes']) && shell.props['css:classes'].includes('blind-shell') && shell.props['css:style'] === 'padding: 8px;', shell ? JSON.stringify(shell.props) : '');
check("SED-2: shell keeps own text 'shell text'", !!shell && shell.props['text'] === 'shell text', shell ? JSON.stringify(shell.props['text']) : '');
check('SED-2: shell keeps authored p child', !!shell && shell.children.some((c) => c.type === 'p' && c.props['text'] === 'authored paragraph'), shell ? shell.children.map((c) => `${c.type}(${c.props['text'] ?? ''})`).join(', ') : '');
const menu = shell ? shell.children.find((c) => c.type === 'nav') : undefined;
const menuEl = els.find((e) => e.type === 'nav' && e.wire.endsWith(':0'));
check('SED-2: shell GAINS the def-root nav.blind-menu as an ADDITIONAL child', !!menu && Array.isArray(menu.props['css:classes']) && menu.props['css:classes'].includes('blind-menu'), menu ? treeString(menu) : 'missing');
check('SED-2: def-root nav carries logo + links spans in order', !!menu && menu.children.length === 2 && menu.children[0].props['text'] === 'logo' && menu.children[1].props['text'] === 'links', menu ? menu.children.map((c) => c.props['text']).join(',') : '');
check('SED-2: authored p comes BEFORE the def-root (nav is additional, not replacing)', !!shell && shell.children.length === 2 && shell.children[0].type === 'p' && shell.children[1].type === 'nav', shell ? String(shell.children.length) : '');
check('SED-2: def-root cssDef rule joins the deduped styles op (STL-3 — rule visible in the styles block)', ruleStrings.includes('.blind-menu{background-color: #222;color: #fff;}'), JSON.stringify(ruleStrings));
check('SED-2: def-root element itself carries the rule on its styles field (sweep coalescer input)', !!menuEl && (menuEl.styles ?? []).includes('.blind-menu{background-color: #222;color: #fff;}'), menuEl ? JSON.stringify(menuEl.styles ?? []) : 'missing');

// ---- 6. multi-zone placement claims (§1.2) --------------------------------
const itemStates = actionable.filter((s) => s.nodeId === itemNodeId());
function itemNodeId() {
  for (const n of translated.nodes) if (n.content === 'placed item') return n.id;
  return null;
}
report('placement consumer states', itemStates.map((s) => JSON.stringify({ pathKey: s.pathKey, forkKey: s.forkKey, activePlacement: s.activePlacement })));
check('§1.2: TWO instances (fan-out into both side-zone containers)', itemStates.length === 2, String(itemStates.length));
check('§1.2: distinct pathKeys', new Set(itemStates.map((s) => s.pathKey)).size === 2, itemStates.map((s) => s.pathKey).join(' | '));
check('§2.2: forkKey === pathKey on both', itemStates.every((s) => s.forkKey === s.pathKey), '');
check('§2.5: activePlacement = side-zone on both (first choice no-such-zone skipped, not fatal)', itemStates.every((s) => s.activePlacement === 'side-zone'), itemStates.map((s) => String(s.activePlacement)).join(','));
check('§2.2: pathKeys route through the side-zone hop to two distinct owner ids (root/<family…>/side-zone/<ownerId>/<nodeId>)',
  itemStates.every((s) => /^root\/.+side-zone\/.+/.test(s.pathKey)),
  itemStates.map((s) => s.pathKey).join(' | '));
const ownerIdsOf = itemStates.map((s) => /^root\/.+side-zone\/([^/]+)\//.exec(s.pathKey)?.[1]);
check('§2.2: the two fan-out instances route through TWO DIFFERENT container owners', new Set(ownerIdsOf).size === 2, ownerIdsOf.join(' | '));
const itemEls = els.filter((e) => itemStates.some((s) => e.wire === s.pathKey));
check('emit: TWO emitted elements for the placed item (one per path-state)', itemEls.length === 2, String(itemEls.length));
check('emit: both carry class blind-item + authored style + text', itemEls.every((e) => Array.isArray(e.props['css:classes']) && e.props['css:classes'].includes('blind-item') && e.props['css:style'] === 'padding: 4px;' && e.props['text'] === 'placed item'), JSON.stringify(itemEls.map((e) => e.props)));
const asides = [...nodesByKey.values()].filter((el) => el.type === 'aside');
check('EMPTY-OWNER-1a/1b: both asides stay VISIBLE (authored text + authored style → no display:none)', asides.length === 2 && asides.every((a) => (a.props['css:style'] ?? '').includes('width: 200px;') && !(a.props['css:style'] ?? '').includes('display: none')), asides.map((a) => `${a.props['css:classes']}=${JSON.stringify(a.props['css:style'])}/${JSON.stringify(a.props['text'])}`).join(' | '));
check('EMPTY-OWNER-1a: aside text intact', asides.every((a) => a.props['text'] === 'zone A' || a.props['text'] === 'zone B'), asides.map((a) => String(a.props['text'])).join(','));
check('fan-out: the item instances attach UNDER their respective asides', itemEls.every((e) => { const own = nodesByKey.get(wireKey(e.wire, e.forkKey)); return own && asides.some((a) => a.children.includes(own)); }), itemEls.map((e) => e.wire).join(' | '));
const asidePaths = asides.map((a) => a.wire);
check('fan-out: two distinct owner asides host the instances', new Set(asidePaths).size === 2, asidePaths.join(' | '));

// ---- 7. pipeline comparison: the seam-native root.compile slice ------------
// The e2e seam pins (legacy-shape.test.ts) run root.compile(t.nodes) — the
// seam materialization (materializeSeam) lives ONLY in compile(slice), never
// in compilePath. Comparison documents which claims each pipeline can serve.
{
  const supervisor2 = new Supervisor({});
  for (const n of translated.nodes) supervisor2.registerNode(n);
  const cr = translated.root.compile(translated.nodes);
  const nodeById2 = new Map(translated.nodes.map((n) => [n.id, n]));
  const els2 = emitElements(cr.actionable, nodeById2);
  const ops2 = diffMinimal(null, els2);
  const adapter2 = new SSRFragmentAdapter();
  applyOps(adapter2, ops2);
  const html2 = adapter2.toString();
  const styles2 = ops2.filter((o) => o.kind === 'styles').flatMap((o) => o.cssDefs ?? []);
  const itemStates2 = cr.actionable.filter((s) => s.nodeId === itemNodeId());
  const h1Html = /<h1[^>]*>([\s\S]*?)<\/h1>/.exec(html2)?.[1] ?? '(h1 missing)';
  const buttonHtml = /<button[^>]*>([\s\S]*?)<\/button>/.exec(html2)?.[1] ?? '(button missing)';
  report('root.compile (seam-native) comparison', [
    `actionable=${cr.actionable.length} (placement-consumer states=${itemStates2.length})`,
    `styles rules=[${styles2.join(' | ')}]`,
    `h1 body=${JSON.stringify(h1Html)}`,
    `button body=${JSON.stringify(buttonHtml)}`,
    `stylesOps=${ops2.filter((o) => o.kind === 'styles').length}`,
  ]);
  check('comparison: root.compile delivers SED-3 def text into h1 (seam-native pipeline works)', h1Html === "The def's text content", JSON.stringify(h1Html));
  check('comparison: root.compile DROPS the placement consumer (no multi-zone fan-out)', itemStates2.length === 0, String(itemStates2.length));
  check('comparison: root.compile also drops the .blind-item cssDef rule (STL-3 — actionable-only)', !styles2.some((r) => r.startsWith('.blind-item{')), JSON.stringify(styles2));
}

// ---- 8. summary ------------------------------------------------------------
console.log('\n== RESULTS ==');
for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.detail && !r.pass ? ` — ${r.detail}` : ''}`);
console.log(`\n${results.length - failures}/${results.length} passed, ${failures} failed`);
process.exit(failures > 0 ? 1 : 0);
