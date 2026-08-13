/**
 * Feature-showcase page builder — emits two artifacts from ONE legacy envelope:
 *
 *  demo/feature-showcase.html          — the annotated page (data embedded,
 *                                        live DOM, SSR-parity expected output).
 *  demo/feature-showcase.expected.html — the expected FINAL OUTPUT: the same
 *                                        data rendered through the real
 *                                        SSRFragmentAdapter (PAR-5 parity).
 *
 * The page module (demo/feature-showcase.js) uses ONLY dist/core + the legacy
 * envelope; handler bodies are function-STRING data (translate.md §2), so no
 * feature logic exists outside the JSON.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { showcaseLegacyData, showcaseServerData, renderShowcaseSsrHtml } from '../demo/feature-showcase.js'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Build the embedded data + server reference + SSR expected output. */
export async function buildFeatureShowcasePage() {
  const initialData = showcaseLegacyData()
  const serverData = showcaseServerData()
  const ssrHtml = renderShowcaseSsrHtml()
  const template = await readFile(join(ROOT, 'demo', 'feature-showcase.template.html'), 'utf8')
  const html = template
    .replaceAll('__PREEMPT_INITIAL_DATA__', () => JSON.stringify(initialData))
    .replaceAll('__SERVER_DATA__', () => JSON.stringify(serverData))
    .replaceAll('__SR_EXPECTED__', () => ssrHtml
      .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;'))
  return { html, initialData, serverData, ssrHtml }
}

/** Expected final output page (standalone, static). */
export async function buildFeatureShowcaseExpectedPage() {
  const { ssrHtml } = await buildFeatureShowcasePage()
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Feature Showcase — expected final output (SSR parity)</title>
  <style>
    body { font-family: system-ui, sans-serif; background: #0b0f16; color: #dfe7f2; padding: 20px; }
    h1 { font-size: 18px; }
    .expect { color: #9ac; font-size: 13px; }
    .frame { border: 1px solid #345; padding: 14px; margin-top: 12px; }
  </style>
</head>
<body>
  <h1>Feature Showcase — expected final output</h1>
  <p class="expect">
    Rendered from the SAME legacy envelope as
    <code>demo/feature-showcase.html</code> through the
    <code>SSRFragmentAdapter</code> (PAR-5 parity). The live DOM in the demo
    page must resolve to this structure, content and the same baked
    <code>data-*</code> derived attributes.
  </p>
  <div class="frame" id="expected">${ssrHtml}</div>
</body>
</html>
`
}