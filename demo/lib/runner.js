/**
 * Shared demo runner — mirrors the vitest check surface in the browser.
 * Each `check` renders a visible goal line with a PASS/FAIL badge and detail;
 * `summary()` renders the totals banner.
 *
 * BANNER FORMAT (contract): `${title}: ${passed} passed, ${failed} failed`.
 * Headless assertions in scripts/demo-smoke.mjs and any page checks MUST match
 * this exact shape — e.g. a zero-failure scan tests `b.includes(title) &&
 * /0 failed/.test(b)` (NOT `failed: 0`, which never matches this format).
 */
export function makeRunner() {
  const container = document.createElement('section')
  container.className = 'runner'
  const header = document.createElement('h3')
  header.textContent = 'Test mirror (browser)'
  container.appendChild(header)
  const list = document.createElement('ul')
  container.appendChild(list)
  const banner = document.createElement('p')
  banner.className = 'runner-banner'
  container.appendChild(banner)
  let passed = 0
  let failed = 0

  function add(name, ok, detail) {
    const li = document.createElement('li')
    li.className = ok ? 'pass' : 'fail'
    const badge = document.createElement('span')
    badge.className = 'badge'
    badge.textContent = ok ? 'PASS' : 'FAIL'
    const text = document.createElement('span')
    text.textContent = name
    li.appendChild(badge)
    li.appendChild(text)
    if (!ok && detail) {
      const pre = document.createElement('pre')
      pre.textContent = String(detail)
      li.appendChild(pre)
    }
    list.appendChild(li)
  }

  return {
    el: container,
    async check(name, fn) {
      try {
        const maybe = fn()
        if (maybe && typeof maybe.then === 'function') await maybe
        passed++
        add(name, true)
      } catch (e) {
        failed++
        add(name, false, e && e.message ? e.message : String(e))
      }
    },
    summary(title) {
      banner.textContent = `${title}: ${passed} passed, ${failed} failed`
      banner.className = failed === 0 ? 'runner-banner ok' : 'runner-banner bad'
    },
  }
}
