import { describe, it, expect } from 'vitest'
import { TAG_SCHEMAS, registerTagSchema, validateNode, type TagSchema } from '../../src/core/validation.js'
import { Link, DEFAULT_PARENT_CHILD, DEFAULT_COMPONENT, DEFAULT_PLACEMENT } from '../../src/core/link.js'
import { Node, mintNodeId } from '../../src/core/node.js'
import { LinkConfigError, SingleParentError } from '../../src/core/errors.js'
import { execute, type OpContext } from '../../src/core/ops.js'
import {
  makeNode,
  childOf,
  makeRoot,
  makePrototype,
  addComponentSource,
  targetAnchor,
} from '../helpers/fixtures.js'
import type {
  Anchor,
  AnchorOptions,
  AnchorTarget,
  CompileResult,
  CompiledState,
} from '../../src/core/types.js'

interface AnchorSnap {
  role: Anchor['role']
  target: AnchorTarget
  options: AnchorOptions
}

function anchorSnap(a: Anchor): AnchorSnap {
  return { role: a.role, target: a.target, options: { ...a.options } }
}

function snapAnchors(anchors: readonly Anchor[]): AnchorSnap[] {
  return anchors.map(anchorSnap)
}

function errOf(fn: () => void): unknown {
  try {
    fn()
    return undefined
  } catch (e) {
    return e
  }
}

function compiledFor(res: CompileResult, nodeId: string): CompiledState | undefined {
  return res.actionable.find((s) => s.nodeId === nodeId)
}

function opCtx(...nodes: Node[]): OpContext {
  const links = new Map<string, Link>()
  const nodeMap = new Map<string, Node>()
  for (const n of nodes) nodeMap.set(n.id, n)
  return {
    hub: {
      linkFor(name: string, kind: 'component' | 'placement'): Link {
        const key = `${kind}:${name}`
        let link = links.get(key)
        if (!link) {
          link = new Link({ name: kind })
          links.set(key, link)
        }
        return link
      },
    },
    nodes: nodeMap,
  }
}

const QRCODE_SCHEMA: TagSchema = {
  required: ['content', 'handlers'],
  validate: { content: (v) => typeof v === 'string' },
}

function childAnchor(link: Link, target: Node, priority: number): Anchor {
  return { role: 'child', target, options: { priority }, link }
}

function parentAnchor(link: Link, target: AnchorTarget): Anchor {
  return { role: 'parent', target, options: {}, link }
}

describe('Pillar E — tag schemas (validation.md §1)', () => {
  it('registerTagSchema stores the schema in TAG_SCHEMAS keyed by tag', () => {
    registerTagSchema('qrcode', QRCODE_SCHEMA)
    const registered = TAG_SCHEMAS.get('qrcode')
    expect(registered).toBeDefined()
    expect(registered).toEqual(expect.objectContaining({ required: ['content', 'handlers'] }))
  })

  it('a QRCODE node with valid content passes schema', () => {
    registerTagSchema('qrcode', QRCODE_SCHEMA)
    const node = makeNode({ type: 'qrcode', content: 'value', handlers: [] })
    const res = validateNode(node, 'qrcode')
    expect(res.tag).toBe('qrcode')
    expect(res.errors).toHaveLength(0)
  })

  it('a QRCODE node failing the content validator or missing handlers is reported', () => {
    registerTagSchema('qrcode', QRCODE_SCHEMA)
    const badValue = makeNode({ type: 'qrcode', content: 42, handlers: [] })
    expect(validateNode(badValue, 'qrcode').errors.length).toBeGreaterThan(0)

    const missing = makeNode({ type: 'qrcode', content: 'ok' })
    expect(validateNode(missing, 'qrcode').errors.join(' ')).toContain('handlers')
  })

  it('an unknown tag produces an error list that names the tag', () => {
    const node = makeNode({ type: 'anything' })
    const res = validateNode(node, 'no-such-tag')
    expect(res.tag).toBe('no-such-tag')
    expect(res.errors.length).toBeGreaterThan(0)
    expect(res.errors.join(' ')).toContain('no-such-tag')
  })

  it('re-registering the same tag overwrites the previous schema', () => {
    registerTagSchema('overwrite-me', { required: ['a'], validate: {} })
    const newer: TagSchema = { required: ['b', 'c'], validate: { b: () => true } }
    registerTagSchema('overwrite-me', newer)
    expect(TAG_SCHEMAS.get('overwrite-me')).toEqual(newer)
    expect(TAG_SCHEMAS.get('overwrite-me')?.required).not.toEqual(['a'])
  })

  it('schema validation is content-scope only and never touches structure', () => {
    registerTagSchema('qrcode-clean', {
      required: ['content'],
      validate: { content: (v) => typeof v === 'string' },
    })
    const parent = makeNode({ type: 'qrcode-clean', content: 'ok' })
    childOf(parent, makeNode({ type: 'a' }), 0)
    childOf(parent, makeNode({ type: 'b' }), 1)
    const res = validateNode(parent, 'qrcode-clean')
    expect(res.errors).toHaveLength(0)
    expect(res.errors.join(' ').toLowerCase()).not.toMatch(/priority|child|role/i)
  })
})

describe('LinkConfig vs schema boundary (validation.md §2)', () => {
  it('a structural violation throws LinkConfigError even when the value passes the schema', () => {
    registerTagSchema('qrcode', QRCODE_SCHEMA)
    const parent = makeNode({ type: 'qrcode', content: 'valid', handlers: [] })
    childOf(parent, makeNode({ type: 'c1' }), 1)
    expect(validateNode(parent, 'qrcode').errors).toHaveLength(0)

    const e = errOf(() => childOf(parent, makeNode({ type: 'c2' }), 1))
    expect(e).toBeInstanceOf(LinkConfigError)
    expect((e as LinkConfigError).code).toBe('unique-order')
  })

  it('a value violation fails schema but leaves the family link valid and unchanged', () => {
    const parent = makeNode({ type: 'qrcode', content: 9001 })
    childOf(parent, makeNode({ type: 'c' }), 0)

    const before = snapAnchors(parent.anchors)
    const family = parent.anchors.find((a) => a.role === 'parent')
    const familyBefore = family ? snapAnchors(family.link.anchors) : []

    const res = validateNode(parent, 'qrcode')
    expect(res.errors.length).toBeGreaterThan(0)

    expect(snapAnchors(parent.anchors)).toEqual(before)
    expect(family ? snapAnchors(family.link.anchors) : []).toEqual(familyBefore)
    expect(parent.children).toHaveLength(1)
  })
})

describe('LinkConfigError catalog (validation.md §3)', () => {
  it('unique-order: duplicate child priority is rejected with full diagnostic detail', () => {
    const link = new Link({ name: 'parent-child' })
    expect(link.config).toEqual(DEFAULT_PARENT_CHILD)

    const t1 = makeNode({ type: 'c1' })
    const t2 = makeNode({ type: 'c2' })
    link.addAnchor(childAnchor(link, t1, 1))
    const before = snapAnchors(link.anchors)

    const e = errOf(() => link.addAnchor(childAnchor(link, t2, 1)))
    expect(e).toBeInstanceOf(LinkConfigError)
    const err = e as LinkConfigError
    expect(err.code).toBe('unique-order')
    expect(err.linkId).toBe(link.id)
    expect(err.config).toEqual(link.config)
    expect(err.detail.currentCell.map(anchorSnap)).toEqual(before)
    expect(err.detail.conflicting.some((a) => a.options.priority === 1)).toBe(true)
  })

  it('count-exceeded: a second parent anchor on a max:1 parent slot is rejected', () => {
    const link = new Link({ name: 'parent-child' })
    link.addAnchor(parentAnchor(link, 'rootNode'))
    const before = snapAnchors(link.anchors)

    const e = errOf(() => link.addAnchor(parentAnchor(link, 'rootNode')))
    expect(e).toBeInstanceOf(LinkConfigError)
    const err = e as LinkConfigError
    expect(err.code).toBe('count-exceeded')
    expect(err.linkId).toBe(link.id)
    expect(err.config).toEqual(DEFAULT_PARENT_CHILD)
    expect(err.detail.currentCell.map(anchorSnap)).toEqual(before)
    expect(err.detail.conflicting).toBeInstanceOf(Array)
  })

  it('count-underflow: removing the last parent anchor below min:1 is rejected', () => {
    const link = new Link({ name: 'parent-child' })
    const only = parentAnchor(link, 'rootNode')
    link.addAnchor(only)
    const before = snapAnchors(link.anchors)

    const e = errOf(() => link.removeAnchor(only))
    expect(e).toBeInstanceOf(LinkConfigError)
    const err = e as LinkConfigError
    expect(err.code).toBe('count-underflow')
    expect(err.linkId).toBe(link.id)
    expect(err.config).toEqual(DEFAULT_PARENT_CHILD)
    expect(err.detail.currentCell.map(anchorSnap)).toEqual(before)
    expect(err.detail.conflicting).toBeInstanceOf(Array)
  })

  it('role-mismatch: a role outside the config roles whitelist is rejected', () => {
    const link = new Link({ name: 'parent-child' })
    const n = makeNode({ type: 'n' })
    const e = errOf(() => link.addAnchor({ role: 'source', target: n, options: {}, link }))
    expect(e).toBeInstanceOf(LinkConfigError)
    const err = e as LinkConfigError
    expect(err.code).toBe('role-mismatch')
    expect(err.linkId).toBe(link.id)
    expect(err.config.roles).toEqual(['parent', 'child'])
    expect(err.detail.conflicting).toHaveLength(0)
    expect(err.detail.currentCell).toHaveLength(0)
  })

  it('unresolved-reference and circular-source are compile outcomes, never LinkConfigError codes', () => {
    const link = new Link({ name: 'parent-child' })
    const t1 = makeNode({ type: 'a' })
    const t2 = makeNode({ type: 'b' })
    link.addAnchor(childAnchor(link, t1, 1))

    const unique = errOf(() => link.addAnchor(childAnchor(link, t2, 1))) as LinkConfigError
    expect(unique.code).not.toBe('unresolved-reference')
    expect(unique.code).not.toBe('circular-source')
    expect(['unique-order', 'count-exceeded', 'count-underflow', 'role-mismatch']).toContain(unique.code)

    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf' }))
    targetAnchor(leaf, 'ghost')
    const res = root.compile([root, leaf])
    expect(res).toBeDefined()
    expect(res.warnings.some((w) => w.code === 'unresolved-reference')).toBe(true)
  })

  it('single-parent is an op-level SingleParentError, not a LinkConfigError', () => {
    const root = makeRoot({ type: 'root' })
    const taken = makeNode({ type: 'taken' })
    childOf(makeNode({ type: 'home' }), taken, 0)

    const e = errOf(() =>
      execute({ kind: 'attach', node: taken, to: root }, opCtx(root, taken)),
    )
    expect(e).toBeInstanceOf(SingleParentError)
    expect(e).not.toBeInstanceOf(LinkConfigError)
    expect((e as SingleParentError).nodeId).toBe(taken.id)
  })
})

describe('Atomicity (validation.md §3.2)', () => {
  const trigger = (): { before: AnchorSnap[]; after: AnchorSnap[] } => {
    const link = new Link({ name: 'parent-child' })
    const t1 = makeNode({ type: 'a' })
    const t2 = makeNode({ type: 'b' })
    link.addAnchor(childAnchor(link, t1, 1))
    const before = snapAnchors(link.anchors)
    errOf(() => link.addAnchor(childAnchor(link, t2, 1)))
    const after = snapAnchors(link.anchors)
    return { before, after }
  }

  it('every rejecting Link call leaves anchors byte-identical to the pre-call state', () => {
    const { before, after } = trigger()
    expect(after).toEqual(before)
  })

  it('a rejected addAnchor never partially appends — the anchors array is the same length', () => {
    const link = new Link({ name: 'parent-child' })
    const t1 = makeNode({ type: 'a' })
    link.addAnchor(childAnchor(link, t1, 1))
    const e = errOf(() => link.addAnchor(childAnchor(link, t1, 1)))
    expect(e).toBeInstanceOf(LinkConfigError)
    expect(link.anchors).toHaveLength(1)
  })
})

describe('Timing (validation.md §4)', () => {
  it('op-time LinkConfigError is thrown synchronously at the mutation boundary', () => {
    const link = new Link({ name: 'parent-child' })
    const t1 = makeNode({ type: 'a' })
    const t2 = makeNode({ type: 'b' })
    link.addAnchor(childAnchor(link, t1, 1))
    let sync = false
    expect(() => {
      link.addAnchor(childAnchor(link, t2, 1))
      sync = true
    }).toThrow(LinkConfigError)
    expect(sync).toBe(false)
  })

  it('op-time loop rollback leaves the destination unchanged and no partial edge', () => {
    const root = makeRoot({ type: 'root' })
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    childOf(root, a)
    childOf(a, b)

    const bBefore = snapAnchors(b.anchors)
    const aBefore = snapAnchors(a.anchors)

    const e = errOf(() => execute({ kind: 'attach', node: a, to: b }, opCtx(root, a, b)))

    expect(e).not.toBeUndefined()
    expect(snapAnchors(b.anchors)).toEqual(bBefore)
    expect(snapAnchors(a.anchors)).toEqual(aBefore)
  })

  it('compile-time outcomes surface as CompileResult status and warnings, not throws', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf' }))
    targetAnchor(leaf, 'ghost')
    let res: CompileResult | undefined
    expect(() => {
      res = root.compile([root, leaf])
    }).not.toThrow()
    expect(res).toBeDefined()
    expect(res!.warnings.some((w) => w.code === 'unresolved-reference')).toBe(true)
  })

  it('a rejected op-time mutation leaves the loop destination identical', () => {
    const root = makeRoot({ type: 'root' })
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    childOf(root, a)
    childOf(a, b)

    const before = snapAnchors(b.anchors)
    errOf(() => execute({ kind: 'attach', node: a, to: b }, opCtx(root, a, b)))
    expect(snapAnchors(b.anchors)).toEqual(before)
  })
})

describe('Unresolved-Reference (validation.md §5)', () => {
  it('depth-0 self-resolution resolves locally and does NOT trigger unresolved-reference', () => {
    const leaf = makeNode({ type: 'leaf', content: 'leaf-c' })
    addComponentSource(leaf, 'slot', 'SELF-VALUE')
    targetAnchor(leaf, 'slot')

    const res = leaf.compile([leaf])
    const st = compiledFor(res, leaf.id)
    expect(st).toBeDefined()
    expect(st?.unresolved ?? []).toHaveLength(0)
    expect(res.warnings.filter((w) => w.code === 'unresolved-reference')).toHaveLength(0)
    expect(st?.bindings['slot']).toBe('SELF-VALUE')
  })

  it('a target with no source up the chain is unresolved with a warning, and the node still renders its own state', () => {
    const root = makeRoot({ type: 'root', content: 'R' })
    const leaf = childOf(root, makeNode({ type: 'leaf2', content: 'own-content' }))
    targetAnchor(leaf, 'ghost')

    const res = root.compile([root, leaf])
    const st = compiledFor(res, leaf.id)
    expect(st).toBeDefined()
    expect(st?.unresolved).toContainEqual({ referenceName: 'ghost', code: 'unresolved-reference' })
    expect(res.warnings).toContainEqual({ code: 'unresolved-reference', pathKey: leaf.pathKey })
    expect(st?.type).toBe('leaf2')
    expect(st?.content).toBe('own-content')
  })

  it('nearest shadows far: the closest match wins over a farther loopback root match', () => {
    const root = makeRoot({ type: 'root' })
    const mid = childOf(root, makeNode({ type: 'mid' }))
    const leaf = childOf(mid, makeNode({ type: 'leaf3' }))
    addComponentSource(root, 'slotA', 'far-root')
    addComponentSource(mid, 'slotA', 'near-mid')
    targetAnchor(leaf, 'slotA')

    const res = root.compile([root, mid, leaf])
    const st = compiledFor(res, leaf.id)
    expect(st?.unresolved ?? []).toHaveLength(0)
    expect(st?.bindings['slotA']).toBe('near-mid')
  })

  it('root fallback is the last resort: a root-level source is used only when nothing closer exists', () => {
    const root = makeRoot({ type: 'root' })
    const mid = childOf(root, makeNode({ type: 'mid2' }))
    const leaf = childOf(mid, makeNode({ type: 'leaf4' }))
    addComponentSource(root, 'slotA', 'root-val')
    targetAnchor(leaf, 'slotA')

    const res = root.compile([root, mid, leaf])
    const st = compiledFor(res, leaf.id)
    expect(st?.unresolved ?? []).toHaveLength(0)
    expect(st?.bindings['slotA']).toBe('root-val')
  })
})

describe('Gate — LinkConfigError trigger matrix (validation.md §7.1)', () => {
  it('unique-order minimal: duplicate priority on the same link throws; boundary: same priority across different links is legal', () => {
    const linkA = new Link({ name: 'parent-child' })
    const t = makeNode({ type: 't' })
    linkA.addAnchor(childAnchor(linkA, makeNode({ type: 'a' }), 1))
    expect(errOf(() => linkA.addAnchor(childAnchor(linkA, t, 1)))).toBeInstanceOf(LinkConfigError)

    const linkB = new Link({ name: 'parent-child' })
    expect(() => linkB.addAnchor(childAnchor(linkB, makeNode({ type: 'b1' }), 1))).not.toThrow()
    const place = new Link({ name: 'placement' })
    expect(place.config).toEqual(DEFAULT_PLACEMENT)
    expect(() => place.addAnchor({ role: 'placement', target: makeNode({ type: 'p' }), options: { priority: 1 }, link: place })).not.toThrow()
  })

  it('count-exceeded boundary: a second parent on the max:1 slot is rejected', () => {
    const link = new Link({ name: 'parent-child' })
    link.addAnchor(parentAnchor(link, 'rootNode'))
    const e = errOf(() => link.addAnchor(parentAnchor(link, 'rootNode')))
    expect(e).toBeInstanceOf(LinkConfigError)
    expect((e as LinkConfigError).code).toBe('count-exceeded')
  })

  it('count-underflow boundary: removing the last parent is rejected, and destroy orphans children to unplaced', () => {
    const root = makeRoot({ type: 'root' })
    const kid = makeNode({ type: 'kid' })
    childOf(root, kid)
    expect(kid.state).toBe('in-tree')

    const link = root.anchors.find((a) => a.role === 'parent')!.link
    const parentAnchorOnLink = link.anchors.find((a) => a.role === 'parent')
    expect(parentAnchorOnLink).toBeDefined()
    const e = errOf(() => link.removeAnchor(parentAnchorOnLink!))
    expect(e).toBeInstanceOf(LinkConfigError)
    expect((e as LinkConfigError).code).toBe('count-underflow')
    expect(kid.state).toBe('in-tree')

    link.destroy()
    expect(kid.state).toBe('unplaced')
  })

  it('role-mismatch whitelist: rejected role on parent-child link, admitted role on component link', () => {
    const link = new Link({ name: 'parent-child' })
    const n = makeNode({ type: 'n' })
    expect(errOf(() => link.addAnchor({ role: 'source', target: n, options: {}, link }))).toBeInstanceOf(
      LinkConfigError,
    )

    const comp = new Link({ name: 'component' })
    expect(comp.config).toEqual(DEFAULT_COMPONENT)
    expect(() =>
      comp.addAnchor({ role: 'source', target: n, options: {}, link: comp }),
    ).not.toThrow()
  })
})

describe('Timing guarantees across the gate (validation.md §7.2)', () => {
  it('op-time atomicity: rejected addAnchor leaves currentCell equal to pre-call state', () => {
    const link = new Link({ name: 'parent-child' })
    const t1 = makeNode({ type: 'a' })
    link.addAnchor(childAnchor(link, t1, 1))
    const pre = snapAnchors(link.anchors)
    errOf(() => link.addAnchor(childAnchor(link, t1, 1)))
    expect(snapAnchors(link.anchors)).toEqual(pre)
  })

  it('async orphan sweep: re-attach before the sweep drain blocks destruction', async () => {
    const root = makeRoot({ type: 'root' })
    const kid = makeNode({ type: 'kid' })
    childOf(root, kid)
    const family = root.anchors.find((a) => a.role === 'parent')!.link
    family.destroy()
    expect(kid.state).toBe('unplaced')

    const keeper = makeRoot({ type: 'keeper' })
    childOf(keeper, kid)
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(kid.state).toBe('in-tree')
    expect(kid.parent).toBe(keeper)
  })

  it('compile fork disposition: a root-terminated arm stays actionable', () => {
    const root = makeRoot({ type: 'root' })
    const leaf = childOf(root, makeNode({ type: 'leaf' }))
    addComponentSource(root, 'slotA', 'root-val')
    targetAnchor(leaf, 'slotA')
    const res = root.compile([root, leaf])
    expect(compiledFor(res, leaf.id)).toBeDefined()
    expect(res.dropped).toHaveLength(0)
  })

  it('compile fork disposition: a prototype-terminated arm is dropped silently', () => {
    const host = makeNode({ type: 'host' })
    const leaf = childOf(host, makeNode({ type: 'leaf' }))
    const proto = makePrototype({ type: 'proto' })
    addComponentSource(proto, 'slotP', 'proto-v')
    targetAnchor(leaf, 'slotP')

    const res = host.compile([host, leaf, proto])
    expect(res.dropped.some((d) => d.reason === 'prototype-terminated')).toBe(true)
    expect(res.warnings.filter((w) => w.code === 'circular-source')).toHaveLength(0)
  })

  it('compile fork disposition: a looping arm is dropped with a circular-source warning', () => {
    const a = makeNode({ type: 'a' })
    const b = makeNode({ type: 'b' })
    childOf(a, b)
    targetAnchor(a, 'x')
    addComponentSource(b, 'x', 'bx', 'duplex')
    targetAnchor(b, 'y')
    addComponentSource(a, 'y', 'ay', 'duplex')

    const res = a.compile([a, b])
    expect(res).toBeDefined()
    expect(res.warnings.some((w) => w.code === 'circular-source')).toBe(true)
    expect(res.dropped.some((d) => d.reason === 'loop')).toBe(true)
  })
})

describe('Clone participation (validation.md §7.3)', () => {
  it('a default clone copies base + layers and derives a fresh id', () => {
    const src = makeNode({ type: 'src', content: 'payload', props: { k: 1 } })
    src.addLayer({ id: 'L1', props: { extra: true } })
    const clone = src.clone('alice')
    expect(clone.id).not.toBe(src.id)
    expect(mintNodeId()).not.toBe(src.id)
    expect(clone.base).toEqual(src.base)
    expect(clone.layers).toHaveLength(1)
    expect(clone.layers[0]?.props).toEqual({ extra: true })
  })

  it('cloned anchors point to cloned links, not the originals', () => {
    const src = makeNode({ type: 'leaf' })
    const srcLink = new Link({ name: 'component' })
    src.addAnchor('source', 'slotA', {}, srcLink)
    const clone = src.clone('alice')
    const cloneAnchor = clone.anchors.find((a) => a.role === 'source')
    const srcAnchor = src.anchors.find((a) => a.role === 'source')
    expect(cloneAnchor).toBeDefined()
    expect(srcAnchor).toBeDefined()
    expect(cloneAnchor!.link).not.toBe(srcAnchor!.link)
    expect(cloneAnchor!.link.id).not.toBe(srcAnchor!.link.id)
    expect(srcAnchor!.link).toBe(srcLink)
  })

  it('cloning a destroyed source is rejected', () => {
    const src = makeNode({ type: 'doomed' })
    src.markDestroyed()
    expect(src.destroyed).toBe(true)
    expect(() => src.clone('alice')).toThrow()
  })
})