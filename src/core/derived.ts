// src/core/derived.ts — variant D "derived state" (docs/specs/derived-state.md).
//
// A data-carried declaration of props DERIVED from a node's own compiled
// state, evaluated inside the existing compile path — no dispatch, no
// handler execution, no journal writes, NO eval: the DSL is JSON plus a
// whitelisted-path interpreter (the containment story, §3). Validation runs
// at every declaration boundary (Node constructor, addLayer, parseNodeState,
// baseFrom) and throws `derived-invalid` naming the offending expression;
// compile itself never throws for derived data (§7).
//
// Pure runtime module: no imports from node.ts — the Node/CompiledState
// shapes come in as types only (./types.js).
import type { CompiledState, DerivedDecl, DerivedExpr, Node } from './types.js'

export interface DerivedContext {
  node: Node
  cs: CompiledState
}

function derivedInvalid(expr: unknown): Error {
  let shown = '<non-JSON value>'
  try {
    shown = JSON.stringify(expr) ?? '<non-JSON value>'
  } catch {
    // circular or non-serializable — fall back to the placeholder
  }
  const err = new Error(`derived-invalid: malformed derived expression: ${shown}`) as Error & { code: string }
  err.code = 'derived-invalid'
  return err
}

const BARE_ROOTS = ['content', 'type', 'pathKey', 'placement'] as const

/** Path grammar (spec §3): whitelisted root + one key segment for
 *  props/bindings; children/unresolved ONLY as `.length`; everything else
 *  bare. Deep paths into resolved values are rejected. */
function validatePath(path: unknown): void {
  if (typeof path !== 'string' || path.length === 0) throw derivedInvalid(path)
  const parts = path.split('.')
  const root = parts[0]!
  if (root === 'props' || root === 'bindings') {
    if (parts.length !== 2 || parts[1] === '') throw derivedInvalid(path)
    return
  }
  if (root === 'children' || root === 'unresolved') {
    if (parts.length !== 2 || parts[1] !== 'length') throw derivedInvalid(path)
    return
  }
  if ((BARE_ROOTS as readonly string[]).includes(root)) {
    if (parts.length !== 1) throw derivedInvalid(path)
    return
  }
  throw derivedInvalid(path)
}

function validateExpr(expr: unknown): void {
  if (expr === null || typeof expr === 'string' || typeof expr === 'number' || typeof expr === 'boolean') return
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) throw derivedInvalid(expr)
  const o = expr as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length !== 1) throw derivedInvalid(expr)
  const form = keys[0]!
  if (form === '$') {
    validatePath(o.$)
    return
  }
  if (form === '$concat') {
    if (!Array.isArray(o.$concat) || o.$concat.length === 0) throw derivedInvalid(expr)
    for (const e of o.$concat) validateExpr(e)
    return
  }
  if (form === '$if') {
    const body = o.$if
    if (typeof body !== 'object' || body === null || Array.isArray(body)) throw derivedInvalid(expr)
    if (!('cond' in body)) throw derivedInvalid(expr)
    const cond = (body as Record<string, unknown>).cond
    if (cond === undefined) throw derivedInvalid(expr)
    validateExpr(cond)
    if (!('then' in body) || (body as Record<string, unknown>).then === undefined) throw derivedInvalid(expr)
    for (const k of ['then', 'else']) {
      if (k in body && (body as Record<string, unknown>)[k] !== undefined) {
        validateExpr((body as Record<string, unknown>)[k])
      }
    }
    return
  }
  if (form === '$eq' || form === '$gt') {
    const pair = o[form]
    if (!Array.isArray(pair) || pair.length !== 2) throw derivedInvalid(expr)
    validateExpr(pair[0])
    validateExpr(pair[1])
    return
  }
  throw derivedInvalid(expr)
}

/**
 * Fail-fast declaration gate (spec §7): non-`DerivedDecl` shapes, unknown
 * expression forms, non-whitelisted roots, multi-segment/dotted
 * props/bindings keys, children/unresolved without `.length`, deep paths
 * into resolved values, wrong $concat/$eq/$gt arity, $if without `cond`,
 * empty $concat, and the reserved prop key `id`.
 */
export function validateDerived(derived: unknown): asserts derived is DerivedDecl | undefined {
  if (derived === undefined) return
  if (typeof derived !== 'object' || derived === null || Array.isArray(derived)) throw derivedInvalid(derived)
  const decl = derived as Record<string, unknown>
  const props = decl.props
  if (props === undefined) return
  if (typeof props !== 'object' || props === null || Array.isArray(props)) throw derivedInvalid(props)
  const record = props as Record<string, unknown>
  for (const key of Object.keys(record)) {
    if (key === 'id') throw derivedInvalid(record[key]) // collides with the auto-id (ensureAutoIds)
    validateExpr(record[key])
  }
}

/** Spec §3 truthiness — COMPLETE: false/null/undefined/0/'' falsy;
 *  EVERYTHING else — including {} and [] — truthy. */
function isTruthy(v: unknown): boolean {
  if (v === false || v === null || v === undefined) return false
  if (v === 0 || v === '') return false
  return true
}

/** JSON-deep equality, null-safe (missing = null): key sets compared
 *  order-insensitively; arrays order-sensitive. */
function deepEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (a === null || a === undefined || b === null || b === undefined) {
    return (a === null || a === undefined) && (b === null || b === undefined)
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEquals(a[i], (b as unknown[])[i])) return false
    }
    return true
  }
  if (typeof a === 'object') {
    if (typeof b !== 'object' || Array.isArray(b)) return false
    const ka = Object.keys(a as object).sort()
    const kb = Object.keys(b as object).sort()
    if (ka.length !== kb.length) return false
    for (let i = 0; i < ka.length; i += 1) {
      if (ka[i] !== kb[i]) return false
      if (!deepEquals((a as Record<string, unknown>)[ka[i]!], (b as Record<string, unknown>)[kb[i]!])) return false
    }
    return true
  }
  return false
}

function concatPart(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

/** N3 (2026-08-19) — authored-PRESENCE check: is a null read coming from a
 *  source slot that EXISTS with a null value (present-null — key authored)
 *  vs a MISSING slot (`?? null` collapses both to null, so the applyDerived
 *  seam needs this to decide carry-vs-omit)? Only `bindings.<k>` / `props.<k>`
 *  `$` reads carry the distinction; other roots (content/type/pathKey/
 *  placement/children.length/unresolved.length) have no present-null concept —
 *  a null there is always absence. */
function pathSourcePresent(path: string, ctx: DerivedContext): boolean {
  if (path.startsWith('bindings.') && path.length > 'bindings.'.length) {
    const key = path.slice('bindings.'.length)
    return key.length > 0 && Object.prototype.hasOwnProperty.call(ctx.cs.bindings, key)
  }
  if (path.startsWith('props.') && path.length > 'props.'.length) {
    const key = path.slice('props.'.length)
    return key.length > 0 && (ctx.node.props ?? {})[key] !== undefined
  }
  return false
}

/** N3 (2026-08-19) — is an evaluated-null derived result AUTHORED-PRESENT (a
 *  literal `null` declaration, or a `$` read of a present-null bindings/props
 *  slot) vs a COMPUTED/MISSING null (a falsy `$if` without `else`, a missing
 *  source, a non-match `$gt`)? Authored-present nulls CARRY as `key: null`;
 *  computed/missing nulls keep the existing omit. */
function nullIsAuthored(expr: DerivedExpr, ctx: DerivedContext): boolean {
  if (expr === null) return true
  if (typeof expr === 'object' && expr !== null && !Array.isArray(expr)) {
    const o = expr as { $?: unknown }
    if (typeof o.$ === 'string') return pathSourcePresent(o.$, ctx)
  }
  return false
}

/** Whitelisted path read (spec §3): a MISSING source yields null. Whole-array
 *  reads of children/unresolved are rejected at validation; unknown roots
 *  here are unreachable via supported paths and totalize to null. */
function pathValue(path: string, ctx: DerivedContext): unknown {
  const root = path.split('.')[0]
  switch (root) {
    case 'content':
      return ctx.node.content ?? null
    case 'type':
      return ctx.node.type
    case 'pathKey':
      return ctx.cs.pathKey
    case 'placement': {
      if (typeof ctx.cs.activePlacement === 'string') return ctx.cs.activePlacement
      const anchor = ctx.cs.anchors.find(a => a.role === 'container')
      return anchor && typeof anchor.target === 'string' ? anchor.target : null
    }
    case 'children':
      return path === 'children.length' ? ctx.cs.children.length : null
    case 'unresolved':
      return path === 'unresolved.length' ? ctx.cs.unresolved.length : null
    case 'props': {
      const key = path.slice('props.'.length)
      return key.length > 0 ? ctx.node.props[key] ?? null : null
    }
    case 'bindings': {
      const key = path.slice('bindings.'.length)
      return key.length > 0 ? ctx.cs.bindings[key] ?? null : null
    }
    default:
      return null
  }
}

/**
 * Pure evaluator (spec §3/§4). TOTAL by construction: unknown forms yield
 * null so the compile path can never throw for derived data (§7 — compile
 * stays non-throwing over its slice).
 */
export function evaluateDerived(expr: DerivedExpr, ctx: DerivedContext): unknown {
  if (expr === null || typeof expr === 'string' || typeof expr === 'number' || typeof expr === 'boolean') return expr
  if (typeof expr !== 'object' || expr === null || Array.isArray(expr)) return null
  const o = expr as Record<string, unknown>
  if ('$' in o && typeof o.$ === 'string') return pathValue(o.$, ctx)
  if ('$concat' in o && Array.isArray(o.$concat)) {
    return o.$concat.map(e => concatPart(evaluateDerived(e as DerivedExpr, ctx))).join('')
  }
  if ('$if' in o && typeof o.$if === 'object' && o.$if !== null) {
    const body = o.$if as { cond?: DerivedExpr; then?: DerivedExpr; else?: DerivedExpr }
    if (!('cond' in body)) return null
    const cond = evaluateDerived(body.cond!, ctx)
    if (isTruthy(cond)) {
      return 'then' in body ? evaluateDerived(body.then!, ctx) : null
    }
    return 'else' in body && body.else !== undefined ? evaluateDerived(body.else, ctx) : null
  }
  if ('$eq' in o && Array.isArray(o.$eq)) {
    const pair = o.$eq as DerivedExpr[]
    return deepEquals(evaluateDerived(pair[0]!, ctx), evaluateDerived(pair[1]!, ctx))
  }
  if ('$gt' in o && Array.isArray(o.$gt)) {
    const pair = o.$gt as DerivedExpr[]
    const a = evaluateDerived(pair[0]!, ctx)
    const b = evaluateDerived(pair[1]!, ctx)
    if (typeof a === 'number' && typeof b === 'number') return a > b
    if (typeof a === 'string' && typeof b === 'string') return a > b
    return null
  }
  return null
}

/**
 * Bake a node's merged derived declaration into a compiled state (spec §4).
 *  Clone-before-merge is mandatory: `cs.props` aliases the pass-1 cache, so
 *  the returned copy (or undefined when nothing derived) is what the CALLER
 *  assigns — cs.props / the pass-1 canon are never mutated in place. A result
 *  of undefined OMITS the key; a null result OMITS unless AUTHORED-PRESENT
 *  (N3, 2026-08-19 — a literal `null` declaration or a present-null
 *  bindings/props `$` read carries as `key: null`).
 */
export function applyDerived(node: Node, cs: CompiledState): Record<string, unknown> | undefined {
  const props = node.derived?.props
  if (!props) return undefined
  const evaluated: Record<string, unknown> = {}
  for (const key of Object.keys(props)) {
    const value = evaluateDerived(props[key]!, { node, cs })
    if (value === undefined) continue
    // N3 (2026-08-19) — null passthrough: an AUTHORED-PRESENT null (literal
    // declaration or a present-null bindings/props `$` read) carries as
    // `key: null`; a COMPUTED/MISSING null (falsy $if no-else, missing
    // source, $gt non-match) keeps the historical omit.
    if (value === null && !nullIsAuthored(props[key]!, { node, cs })) continue
    evaluated[key] = value
  }
  if (Object.keys(evaluated).length === 0) return undefined
  return { ...cs.props, ...evaluated }
}
