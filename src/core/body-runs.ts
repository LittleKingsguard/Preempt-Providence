// src/core/body-runs.ts — ENG-INLINE-ORDER text/element interleaving.
//
// A compiled node's body is normally `escapeText(content) + children` (own
// text ALWAYS before child elements; no interleaving). This module adds an
// OPT-IN interleaving capability via a `bodyRuns` segment field that coexists
// with the scalar `content` (whose meaning NEVER changes). When interleaving
// is present, the emit seam serializes the runs into a single STRING that the
// adapters decode and render order-aware.
//
// The serialization is deterministic, collision-free and byte-stable:
//   - a distinctive PREFIX (`\u0001BODY\u0001`) that no real text content
//     could plausibly start with (isBodyEncoded's cheap signature check);
//   - each run is a length-prefixed token (`T<len>:<payload>` for text,
//     `C<len>:<payload>` for child), so run ORDER is preserved and a text
//     payload can contain any character (including the delimiters) without
//     ambiguity;
//   - text payloads are percent-escaped (`%`/`<`/`>`/`&`) so the encoded form
//     never carries a bare `<`/`>`/`&` (escapeText is applied at the adapter
//     boundary later and would double-encode); decodeRuns restores the
//     ORIGINAL unescaped text.
// decodeRuns never throws on garbage (returns [] for a non-matching input).

export type BodyRun = { text: string } | { child: string }

const PREFIX = '\u0001BODY\u0001'

function escapeTextPayload(s: string): string {
  return s.replace(/%/g, '%25').replace(/</g, '%3C').replace(/>/g, '%3E').replace(/&/g, '%26')
}

function unescapeTextPayload(s: string): string {
  return s.replace(/%26/g, '&').replace(/%3E/g, '>').replace(/%3C/g, '<').replace(/%25/g, '%')
}

/** Serialize a run sequence into the deterministic, collision-free string
 *  form. Byte-stable for an identical input (the diff's `===` compare then
 *  emits no spurious `set` op). */
export function encodeRuns(runs: BodyRun[]): string {
  let out = PREFIX
  for (const run of runs) {
    if ('text' in run) {
      const payload = escapeTextPayload(run.text)
      out += 'T' + payload.length + ':' + payload
    } else {
      out += 'C' + run.child.length + ':' + run.child
    }
  }
  return out
}

/** The inverse of encodeRuns. Never throws on garbage — a non-matching input
 *  (or a malformed token stream) returns []. */
export function decodeRuns(s: string): BodyRun[] {
  if (typeof s !== 'string' || !s.startsWith(PREFIX)) return []
  const runs: BodyRun[] = []
  let i = PREFIX.length
  try {
    while (i < s.length) {
      const kind = s[i]
      i += 1
      let lenStr = ''
      while (i < s.length && s[i] !== ':') {
        lenStr += s[i]
        i += 1
      }
      if (i >= s.length) return []
      i += 1
      const len = parseInt(lenStr, 10)
      if (Number.isNaN(len) || len < 0) return []
      const payload = s.slice(i, i + len)
      if (payload.length !== len) return []
      i += len
      if (kind === 'T') runs.push({ text: unescapeTextPayload(payload) })
      else if (kind === 'C') runs.push({ child: payload })
      else return []
    }
  } catch {
    return []
  }
  return runs
}

/** Stable, cheap prefix/signature check: true for any string produced by
 *  encodeRuns, false for plain strings (including ''), undefined, and
 *  non-strings. */
export function isBodyEncoded(v: unknown): boolean {
  return typeof v === 'string' && v.startsWith(PREFIX)
}
