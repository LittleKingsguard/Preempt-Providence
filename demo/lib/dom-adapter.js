/**
 * Minimal DOM RenderAdapter (render.md §2) for the browser demos:
 * createEl / setProp (namespaced prop:* css:* text on:*) / appendChild /
 * removeEl / hydrate (css.id reuse seam).
 * Newly created elements are attached to the mount root immediately, so the
 * only hand-written HTML is the placeholder root element.
 */
export class DomAdapter {
  constructor(mount) {
    this.mount = mount
    this.wires = new Map()
    this.reused = new Set()
    this.stylesEl = null
  }

  createEl(type, wire) {
    const el = document.createElement(type)
    el.dataset.wire = wire
    this.wires.set(wire, el)
    this.mount.appendChild(el)
    return el
  }

  setProp(wire, name, val) {
    const el = this.wires.get(wire)
    if (!el) return
    if (name === 'text') {
      el.textContent = String(val)
    } else if (name.startsWith('css:')) {
      const key = name.slice(4)
      if (key === 'id') el.id = String(val)
      else if (key === 'classes') el.className = Array.isArray(val) ? val.join(' ') : String(val)
      else if (key === 'style') el.style.cssText = String(val)
      else if (key === 'cssDef') this.ensureStyles(val)
      else el.setAttribute(key, String(val))
    } else if (name.startsWith('on:')) {
      el.addEventListener(name.slice(3), () => {})
    } else {
      const attr = name.startsWith('prop:') ? name.slice(5) : name
      if (attr === 'value' && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) el.value = String(val)
      else el.setAttribute(attr, String(val))
    }
  }

  ensureStyles(defs) {
    if (!this.stylesEl) {
      this.stylesEl = document.createElement('style')
      this.stylesEl.id = 'preempt-dynamic-styles'
      document.head.appendChild(this.stylesEl)
    }
    this.stylesEl.textContent += '\n' + String(defs)
  }

  appendChild(owner, child) {
    owner.appendChild(child)
  }

  removeEl(wire) {
    const el = this.wires.get(wire)
    if (el) {
      el.remove()
      this.wires.delete(wire)
    }
  }

  /** Hydration seam (render.md §5.1): css.id-keyed elements are "reused" SSR DOM. */
  hydrate(rootWire, vdom) {
    void rootWire
    const nodes = [vdom.template, ...(vdom.content ?? [])]
    for (const n of nodes) {
      if (n && typeof n === 'object' && n.css && typeof n.css.id === 'string') {
        this.reused.add(n.css.id)
      }
    }
  }
}
