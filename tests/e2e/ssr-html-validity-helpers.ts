/**
 * Shared helpers for the SSR HTML-output-validity e2e suites
 * (tests/e2e/ssr-html-validity.test.ts, tests/e2e/markdown-html-validity.test.ts).
 *
 * Pure helpers only — no describe/it blocks (importing this module must not
 * register tests). Runs the REAL op decoder + REAL SSR adapter
 * (src/core/adapters.ts, src/core/render-helpers.ts) and validates the actual
 * emitted HTML string against the adapters.md serialization contract.
 */
import { SSRFragmentAdapter, VOID_TAGS } from '../../src/core/adapters.js'
import { applyOps } from '../../src/core/render-helpers.js'
import type { RenderOp } from '../../src/core/render.js'

/** Run the real op decoder + real SSR adapter over an op stream. */
export function renderOps(ops: RenderOp[]): string {
  const adapter = new SSRFragmentAdapter()
  applyOps(adapter, ops)
  return adapter.toString()
}

export interface HtmlProblem {
  at: number
  msg: string
}

const ENTITY_RE = /^&(amp|lt|gt|quot|#\d+|#x[0-9a-fA-F]+);/

/**
 * Stack-based well-formedness + escaping checker over the emitted HTML
 * (no DOM parser). Parses open/close tags, tracks nesting of non-void tags,
 * flags a close tag for a VOID_TAGS element, and flags any raw `<` / `&`
 * that is not tag syntax or a valid entity inside text runs and attribute
 * values. `<style>`/`<script>` content is raw text and is never parsed.
 */
export function validateHtml(html: string): HtmlProblem[] {
  const problems: HtmlProblem[] = []
  const open: string[] = []
  let i = 0
  const n = html.length
  const add = (at: number, msg: string): void => {
    problems.push({ at, msg })
  }

  const checkText = (from: number, to: number): void => {
    let j = from
    while (j < to) {
      const ch = html[j]!
      if (ch === '<') add(j, "raw '<' in text (unescaped)")
      else if (ch === '&') {
        const e = ENTITY_RE.exec(html.slice(j, to))
        if (!e) add(j, "raw '&' not followed by a valid entity")
        else j += e[0].length - 1
      }
      j += 1
    }
  }

  while (i < n) {
    const lt = html.indexOf('<', i)
    if (lt === -1) {
      checkText(i, n)
      break
    }
    checkText(i, lt)
    i = lt
    const c1 = html[i + 1]
    if (c1 === '/') {
      const m = /^<\/\s*([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i))
      if (!m) {
        add(i, `malformed close tag near ${html.slice(i, i + 16)}`)
        i += 1
        continue
      }
      const name = m[1]!
      const gt = html.indexOf('>', i)
      if (gt === -1) {
        add(i, `unterminated close tag </${name}>`)
        break
      }
      if (VOID_TAGS.has(name)) add(i, `close tag for void element <${name}>`)
      const top = open[open.length - 1]
      if (top === name) open.pop()
      else add(i, `mismatched close tag </${name}> (stack top: ${top ?? '∅'})`)
      i = gt + 1
    } else if (c1 === '!' || c1 === '?') {
      const gt = html.indexOf('>', i)
      if (gt === -1) {
        add(i, 'unterminated <!…>')
        break
      }
      i = gt + 1
    } else if (c1 !== undefined && /[a-zA-Z]/.test(c1)) {
      const m = /^<([a-zA-Z][a-zA-Z0-9-]*)/.exec(html.slice(i))
      if (!m) {
        add(i, 'malformed open tag')
        i += 1
        continue
      }
      const name = m[1]!
      let j = i + m[0].length
      let closed = false
      while (j < n) {
        const ch = html[j]!
        if (ch === '>') {
          closed = true
          j += 1
          break
        }
        if (ch === '<') {
          add(j, "raw '<' inside an open tag")
          j += 1
          continue
        }
        if (ch === '"') {
          let k = j + 1
          let closedQuote = false
          while (k < n) {
            const q = html[k]!
            if (q === '"') {
              closedQuote = true
              break
            }
            if (q === '<') add(k, "raw '<' inside an attribute value")
            else if (q === '&') {
              const e = ENTITY_RE.exec(html.slice(k))
              if (!e) add(k, "raw '&' in an attribute value not followed by a valid entity")
              else k += e[0].length - 1
            }
            k += 1
          }
          if (!closedQuote) {
            add(j, 'unterminated quoted attribute value')
            j = n
            break
          }
          j = k + 1
        } else if (ch === '&') {
          const e = ENTITY_RE.exec(html.slice(j))
          if (!e) add(j, "raw '&' in a tag not followed by a valid entity")
          else j += e[0].length
        } else if (ch === '/' && html[j + 1] === '>') {
          closed = true
          j += 2
          break
        } else {
          j += 1
        }
      }
      if (!closed) {
        add(i, `unterminated open tag <${name}>`)
        break
      }
      i = j
      if (VOID_TAGS.has(name)) continue
      open.push(name)
      if (name === 'style' || name === 'script') {
        const close = html.toLowerCase().indexOf(`</${name}`, i)
        if (close === -1) {
          add(i, `unterminated <${name}> (raw-text element, no close)`)
          break
        }
        i = close
      }
    } else {
      add(i, "raw '<' in text (unescaped)")
      i += 1
    }
  }
  for (const name of open) add(n, `unclosed <${name}>`)
  return problems
}

/** Split emitted html into the styles prefix (if present) and the root html. */
export function splitStylesPrefix(html: string): { prefix: string; body: string } {
  if (!html.startsWith('<style id="preempt-dynamic-styles">')) return { prefix: '', body: html }
  const end = html.indexOf('</style>')
  if (end === -1) return { prefix: html, body: '' }
  return { prefix: html.slice(0, end + '</style>'.length), body: html.slice(end + '</style>'.length) }
}

/** The §4.5 pinned join formula for the styles prefix. */
export function stylesPrefixOf(cssDefs: unknown[]): string {
  return '<style id="preempt-dynamic-styles">' + cssDefs.map((d) => '\n' + String(d)).join('') + '</style>'
}

/** First create op in a stream — the first-created wire = the SSR root (R-ORD-8). */
export function firstCreate(ops: RenderOp[]): Extract<RenderOp, { kind: 'create' }> {
  const c = ops.find((o): o is Extract<RenderOp, { kind: 'create' }> => o.kind === 'create')
  if (!c) throw new Error('stream has no create op')
  return c
}

export async function flushTicks(): Promise<void> {
  for (let i = 0; i < 4; i += 1) await new Promise((r) => setTimeout(r, 0))
}
