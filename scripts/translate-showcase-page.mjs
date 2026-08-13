// translate-showcase-page — builder for demo/translate-showcase.html +
// demo/translate-showcase.expected.html
//
// Blind-test WRITER artifact (AGENTS.md item 9, step a). Mirrors the
// fork-stress-data builder pattern (docs/specs/fork-stress-data.md): embeds
// the LEGACY envelope as preempt-initial-data + the checks' expectations as
// server-data. The SSR expected fragment is produced through the documented
// core path — translateLegacy -> Supervisor -> registerNode -> root.compile ->
// recordResolved(actionable) (handlers.md §2: the bootstrap direct-compile
// seed for the non-draining resolved store) -> getResolvedStates ->
// emitElements -> diffMinimal(null, els) ->
// applyOps(new SSRFragmentAdapter()) -> toString() — so the expected page is
// the same envelope through the real SSRFragmentAdapter (PAR-5 parity).

import { readFileSync, writeFileSync } from 'node:fs';
import { translateLegacy } from '../dist/core/translate.js';
import { Supervisor } from '../dist/core/supervisor.js';
import { diffMinimal } from '../dist/core/render.js';
import { emitElements, applyOps } from '../dist/core/render-helpers.js';
import { SSRFragmentAdapter } from '../dist/core/adapters.js';
import { translateShowcaseLegacyData, translateShowcaseServerData } from '../demo/translate-showcase.js';

const here = new URL('.', import.meta.url);
const demo = (name) => new URL(`../demo/${name}`, here);

const data = translateShowcaseLegacyData();
const serverData = translateShowcaseServerData();

const translated = translateLegacy(data);
const supervisor = new Supervisor({});
for (const n of translated.nodes) supervisor.registerNode(n);
const compiled = translated.root.compile(translated.nodes);
supervisor.recordResolved(compiled.actionable);
const states = translated.nodes
  .map((n) => supervisor.getResolvedStates(n.id))
  .filter(Boolean)
  .flat();
const els = emitElements(states);
const ops = diffMinimal(null, els);
const adapter = new SSRFragmentAdapter();
applyOps(adapter, ops);
const fragment = adapter.toString();

serverData.expectedHtml = fragment;

const template = readFileSync(demo('translate-showcase.template.html'), 'utf8');
const html = template
  .replace('__PREEMPT_INITIAL_DATA__', JSON.stringify(data))
  .replace('__SERVER_DATA__', JSON.stringify(serverData))
  .replace('__SR_EXPECTED__', escapeHtml(fragment));

writeFileSync(demo('translate-showcase.html'), html);

const expectedHtml = html
  .replace('<div id="app"></div>', `<div id="app">${fragment}</div>`)
  .replace('<script type="module" src="./translate-showcase.js"></script>', '');

writeFileSync(demo('translate-showcase.expected.html'), expectedHtml);

console.log(`[translate-showcase:build] wrote demo/translate-showcase.html + demo/translate-showcase.expected.html`);
console.log(`[translate-showcase:build] translate warnings (${translated.warnings.length}):`);
for (const w of translated.warnings) console.log(`  ${w.code} @ ${w.path}`);
console.log(`[translate-showcase:build] SSR fragment: ${fragment.length} chars`);

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
