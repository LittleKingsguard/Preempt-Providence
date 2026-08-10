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
  set innerHTML(v) {
    this._innerHTML = String(v)
  }
  get innerHTML() {
    return this._innerHTML
  }
  appendChild(c) {
    this.children.push(c)
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
  }
}

const byId = new Map()
const document = {
  createElement: (tag) => new El(tag),
  getElementById: (id) => {
    if (!byId.has(id)) byId.set(id, new El('div'))
    return byId.get(id)
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

// Give microtasks a chance (Supervisor event flushes).
await new Promise((r) => setTimeout(r, 50))

const banners = [...byId.values()].flatMap((el) => walk(el, []))
function walk(el, acc) {
  if (el.className === 'runner-banner' || (el.textContent && el.textContent.includes('passed'))) {
    acc.push(el.textContent)
  }
  for (const c of el.children) walk(c, acc)
  return acc
}
console.log('banners:', banners.join(' | '))
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
