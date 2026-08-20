/**
 * Shared minimal-DOM shim for the demo smoke harness (scripts/demo-smoke.mjs)
 * and the per-page worker (scripts/smoke-page-worker.mjs). The shim mirrors a
 * real browser DOM close enough for the demo page modules: createElement /
 * getElementById / head, plus real-DOM move semantics on appendChild (re-appending
 * relocates) and an optional HTMLCollection-like `children` (no array methods)
 * when REAL_DOM_CHILDREN is set.
 *
 * NOTE (2026-08-16, d14 scaling probes): the heavy fork-family pages must run
 * in their OWN subprocess (the worker) — every page module instance retains its
 * frame (~50MB+ of shim elements + supervisor state at d14), and stacking a
 * dozen of those in one process balloons the live heap to hundreds of MB, where
 * each subsequent page's allocations trigger full mark-sweep storms (observed
 * 0.3s of page work costing 95s of wall time). The worker isolates each page so
 * the smoke stays deterministic (~1 min total instead of ~15).
 */
export function installSmokeShim() {
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
    removeEventListener(evt, fn) {
      const arr = this.listeners[evt]
      if (arr) {
        const i = arr.indexOf(fn)
        if (i !== -1) arr.splice(i, 1)
      }
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

  /** Collect the runner banner texts from every mounted element (the parent
   *  smoke walks the inline pages; the per-page WORKER walks its own subprocess
   *  shim and ships them back so the banner asserts stay in the parent). */
  function collectBanners() {
    const acc = []
    const walk = (el) => {
      if (el.className === 'runner-banner' || (el.textContent && el.textContent.includes('passed'))) {
        acc.push(el.textContent)
      }
      for (const c of el.children) walk(c)
    }
    for (const el of byId.values()) walk(el)
    return acc
  }

  return { El, byId, document, seedPage, seedRawText, extractScript, collectBanners }
}