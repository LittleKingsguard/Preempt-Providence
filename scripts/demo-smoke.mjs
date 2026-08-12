// Headless smoke test: run the demo modules against a minimal DOM shim and
// assert every check passes (the same assertions the browser pages show).

class El {
  constructor(tag) {
    this.tagName = tag.toUpperCase()
    this.children = []
    this.attrs = {}
    this.dataset = {}
    this.style = {}
    this.listeners = {}
    this.textContent = ''
    this.className = ''
    this.id = ''
    this.value = ''
    this._innerHTML = ''
  }

  /** Real-DOM `children` is an HTMLCollection: indexable + .length + .item(),
   *  but NO .map/.filter — the harness must always Array.from() it. The shim
   *  mirrors that when globalThis.REAL_DOM_CHILDREN is set (regression guard:
   *  demo/lib/feature-matrix-tests.js and demo components must not rely on
   *  array methods on .children). */
  get htmlCollectionChildren() {
    const arr = this.children
    const col = []
    for (let i = 0; i < arr.length; i++) col[i] = arr[i]
    col.length = arr.length
    col.item = (i) => arr[i] ?? null
    return col
  }
  set innerHTML(v) {
    this._innerHTML = String(v)
  }
  get innerHTML() {
    return this._innerHTML
  }
  appendChild(c) {
    // real-DOM move semantics: re-appending an already-present child relocates
    // it (diffMinimal re-appends every child in order on each render)
    const i = this.children.indexOf(c)
    if (i !== -1) this.children.splice(i, 1)
    this.children.push(c)
    c.parent = this
    return c
  }
  setAttribute(k, v) {
    this.attrs[k] = String(v)
  }
  getAttribute(k) {
    return this.attrs[k] ?? null
  }
  addEventListener(evt, fn) {
    ;(this.listeners[evt] ??= []).push(fn)
  }
  remove() {
    this.removed = true
    if (this.parent) {
      const i = this.parent.children.indexOf(this)
      if (i !== -1) this.parent.children.splice(i, 1)
      this.parent = null
    }
  }
}

// Wrap: when REAL_DOM_CHILDREN is set, document.getElementById/createElement
// return proxies whose `.children` is an HTMLCollection-like (no array methods).
function wrapEl(el) {
  return new Proxy(el, {
    get(t, k) {
      if (k === 'children' && globalThis.REAL_DOM_CHILDREN) return t.htmlCollectionChildren
      return t[k]
    },
  })
}

const byId = new Map()
const document = {
  createElement: (tag) => wrapEl(new El(tag)),
  getElementById: (id) => {
    if (!byId.has(id)) byId.set(id, new El('div'))
    return wrapEl(byId.get(id))
  },
  head: { appendChild: () => {} },
}

const g = globalThis
g.document = document
g.window = g

const { fileURLToPath } = await import('node:url')
const base = fileURLToPath(new URL('..', import.meta.url))

// Seed the framework input data embedded in the generated pages
// (scripts/build-demo.mjs must run before this script).
const { readFile } = await import('node:fs/promises')
const { buildModeTogglePage } = await import('./mode-toggle-page.mjs')
const ssrHtml = await readFile(`${base}demo/ssr-render.html`, 'utf8')
const compHtml = await readFile(`${base}demo/components.html`, 'utf8')
function extractScript(html, id) {
  const m = html.match(new RegExp(`<script id="${id}" type="application/json">([\\s\\S]*?)<\\/script>`))
  if (!m) throw new Error(`missing <script id="${id}"> in the generated demo HTML — run npm run demo:build && node scripts/build-demo.mjs first`)
  return m[1].trim()
}
function seedPage(html) {
  byId.set('preempt-initial-data', Object.assign(new El('script'), { textContent: extractScript(html, 'preempt-initial-data') }))
  byId.set('server-data', Object.assign(new El('script'), { textContent: extractScript(html, 'server-data') }))
}
/** Seed a raw text element (script[type=text/plain] / pre) by id — used by the
 *  mode-toggle page for its SSR-received HTML and raw markdown source. */
function seedRawText(html, tag, id) {
  const m = html.match(new RegExp(`<${tag} id="${id}"[^>]*>([\\s\\S]*?)<\\/${tag}>`))
  if (!m) throw new Error(`missing <${tag} id="${id}"> in the generated demo HTML`)
  byId.set(id, Object.assign(new El(tag), { textContent: m[1].trim() }))
}

seedPage(ssrHtml)
await import(`${base}demo/ssr-render.js`).catch((e) => {
  console.error('ssr-render failed:', e)
  process.exit(1)
})
seedPage(compHtml)
await import(`${base}demo/components.js`).catch((e) => {
  console.error('components failed:', e)
  process.exit(1)
})
await import(`${base}demo/loop-safety.js`).catch((e) => {
  console.error('loop-safety failed:', e)
  process.exit(1)
})
const fmHtml = await readFile(`${base}demo/feature-matrix.html`, 'utf8')
seedPage(fmHtml)
await import(`${base}demo/feature-matrix.js`).catch((e) => {
  console.error('feature-matrix failed:', e)
  process.exit(1)
})

// ---- mode-toggle page: every adapter mode drives the shared harness ---------
// Each mode is seeded and imported as a distinct module instance (cache-busted
// by `?mode=`), so all three banner titles land in the same run.
for (const mode of ['client', 'ssr', 'markdown']) {
  const pageHtml = await buildModeTogglePage(mode)
  seedPage(pageHtml)
  if (mode === 'ssr') seedRawText(pageHtml, 'script', 'received-html-data')
  if (mode === 'markdown') seedRawText(pageHtml, 'pre', 'markdown-source')
  await import(`${base}demo/mode-toggle.js?mode=${mode}`).catch((e) => {
    console.error(`mode-toggle (${mode}) failed:`, e)
    process.exit(1)
  })
}

// ---- fork-stress pages: one module instance per depth (cache-busted) --------
// Each depth's page seeds its own doc + server data; the module reads depth
// from server-data and drives the runtime layers (L4..depth).
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  const pageHtml = await readFile(`${base}demo/fork-stress-d${depth}.html`, 'utf8')
  seedPage(pageHtml)
  await import(`${base}demo/fork-stress.js?depth=${depth}`).catch((e) => {
    console.error(`fork-stress (depth ${depth}) failed:`, e)
    process.exit(1)
  })
}

// Give microtasks a chance (Supervisor event flushes + async page checks).
await new Promise((r) => setTimeout(r, 250))

const banners = [...byId.values()].flatMap((el) => walk(el, []))
function walk(el, acc) {
  if (el.className === 'runner-banner' || (el.textContent && el.textContent.includes('passed'))) {
    acc.push(el.textContent)
  }
  for (const c of el.children) walk(c, acc)
  return acc
}
console.log('banners:', banners.join(' | '))
{
  // probe: did the fork-stress runtime layers build? count handler-marked nodes
  const marked = [...byId.values()].filter(() => false)
  console.log('DBG fork-stress runtime probe (handler markers live on nodes, not shim): skipped in shim')
}
const fails = [...byId.values()].flatMap((el) => collect(el, []))
function collect(el, acc) {
  if (String(el.className).split(' ').includes('fail')) acc.push(el)
  for (const c of el.children) collect(c, acc)
  return acc
}
if (fails.length > 0) {
  console.error('FAILED CHECKS:', fails.length)
  for (const el of fails) {
    for (const c of el.children) if (c.tagName === 'PRE') console.error('  detail:', c.textContent)
  }
  process.exit(1)
}
if (banners.some((b) => /failed: [1-9]/.test(b))) {
  console.error('summary reports failures')
  process.exit(1)
}
if (!banners.some((b) => b.includes('Feature Matrix') && /0 failed/.test(b))) {
  console.error('feature-matrix page did not complete its checks (banner missing)')
  process.exit(1)
}
for (const mode of ['client', 'ssr', 'markdown']) {
  if (!banners.some((b) => b.includes(`Mode toggle — ${mode}`) && /0 failed/.test(b))) {
    console.error(`mode-toggle (${mode}) page did not complete its checks (banner missing)`)
    process.exit(1)
  }
}
for (const depth of [2, 4, 6, 8, 9, 10, 11, 12]) {
  if (!banners.some((b) => b.includes(`Fork Stress — depth ${depth}`) && /0 failed/.test(b))) {
    console.error(`fork-stress (depth ${depth}) page did not complete its checks (banner missing)`)
    process.exit(1)
  }
}

// component-driven page: every test is a content node — no FAIL text anywhere,
// and the footer summary (itself framework-rendered) must report zero failures.
const rootText = allText(byId.get('root'))
function allText(el) {
  if (!el) return ''
  return (el.textContent ?? '') + el.children.map(allText).join('')
}
if (rootText.includes('FAIL —')) {
  console.error('component page has failing test nodes')
  process.exit(1)
}
if (!rootText.includes('0 failed')) {
  console.error('component page summary missing or reports failures:', rootText.slice(0, 200))
  process.exit(1)
}
console.log('SMOKE OK — all demo checks passed')
