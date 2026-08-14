import type { Anchor, AnchorOptions, AnchorTarget, LinkConfig, Role } from './types.js'
import { LinkConfigError } from './errors.js'

let linkSeq = 0

export function mintLinkId(): string {
  linkSeq += 1
  return `link-${linkSeq}`
}

export const DEFAULT_PARENT_CHILD: LinkConfig = {
  name: 'parent-child',
  parent: { count: 1 },
  children: { min: 1, max: Infinity, orderKey: 'unique' },
  roles: ['parent', 'child'],
}

export const DEFAULT_COMPONENT: LinkConfig = {
  name: 'component',
  roles: ['source', 'target', 'duplex'],
}

export const DEFAULT_PLACEMENT: LinkConfig = {
  name: 'placement',
  roles: ['container', 'content'],
}

function baseFor(name: LinkConfig['name']): LinkConfig {
  if (name === 'component') return DEFAULT_COMPONENT
  if (name === 'placement') return DEFAULT_PLACEMENT
  return DEFAULT_PARENT_CHILD
}

function effectiveOrder(a: Anchor): number | undefined {
  return a.options.priority ?? a.options.order
}

export class Link {
  readonly id: string
  readonly config: LinkConfig
  readonly anchors: Anchor[]

  constructor(config?: Partial<LinkConfig> & { name: LinkConfig['name'] }, id?: string) {
    const name = config?.name ?? 'parent-child'
    const base = baseFor(name)
    this.config = config ? { ...base, ...config } : { ...base }
    this.id = id ?? mintLinkId()
    this.anchors = []
  }

  anchorsOf(role: Role, target?: AnchorTarget): Anchor[] {
    return this.anchors.filter(a => a.role === role && (target === undefined || a.target === target))
  }

  parents(): Anchor[] {
    return this.anchorsOf('parent')
  }

  children(): Anchor[] {
    return this.anchorsOf('child')
  }

  sources(): Anchor[] {
    return this.anchorsOf('source')
  }

  targets(): Anchor[] {
    return this.anchorsOf('target')
  }

  addAnchor(a: Anchor): void {
    if (a.target instanceof Link) {
      throw new LinkConfigError('role-mismatch', this.id, this.config, {
        intendedAnchor: { role: a.role, target: a.target, options: a.options },
        conflicting: [],
        currentCell: this.anchors.slice(),
      })
    }
    if (!this.config.roles.includes(a.role)) {
      throw new LinkConfigError('role-mismatch', this.id, this.config, {
        intendedAnchor: { role: a.role, target: a.target, options: a.options },
        conflicting: [],
        currentCell: this.anchors.slice(),
      })
    }
    if (a.role === 'parent' && this.config.parent) {
      const existing = this.anchors.filter(x => x.role === 'parent')
      if (existing.length + 1 > this.config.parent.count) {
        throw new LinkConfigError('count-exceeded', this.id, this.config, {
          intendedAnchor: { role: 'parent', target: a.target, options: a.options },
          conflicting: existing,
          currentCell: this.anchors.slice(),
        })
      }
    }
    if (a.role === 'child' && this.config.children) {
      const eff = effectiveOrder(a)
      if (eff !== undefined) {
        const conflicting = this.anchors.filter(x => x.role === 'child' && x !== a && effectiveOrder(x) === eff)
        if (conflicting.length > 0) {
          throw new LinkConfigError('unique-order', this.id, this.config, {
            intendedAnchor: { role: 'child', target: a.target, options: a.options },
            conflicting,
            currentCell: this.anchors.slice(),
          })
        }
      }
    }
    this.anchors.push(a)
  }

  removeAnchor(a: Anchor): void {
    const idx = this.anchors.indexOf(a)
    if (idx === -1) return
    if (a.role === 'parent' && this.config.parent) {
      const count = this.anchors.filter(x => x.role === 'parent').length
      if (count - 1 < this.config.parent.count) {
        throw new LinkConfigError('count-underflow', this.id, this.config, {
          intendedAnchor: { role: 'parent', target: a.target, options: a.options },
          conflicting: [a],
          currentCell: this.anchors.slice(),
        })
      }
    }
    if (a.role === 'child' && this.config.children) {
      const count = this.anchors.filter(x => x.role === 'child').length
      if (count - 1 < this.config.children.min) {
        throw new LinkConfigError('count-underflow', this.id, this.config, {
          intendedAnchor: { role: 'child', target: a.target, options: a.options },
          conflicting: [a],
          currentCell: this.anchors.slice(),
        })
      }
    }
    this.anchors.splice(idx, 1)
  }

  setOrder(a: Anchor, priority: number): void {
    if (!Number.isFinite(priority)) {
      throw new LinkConfigError('unique-order', this.id, this.config, {
        intendedAnchor: { role: a.role, target: a.target, options: { ...a.options, priority } },
        conflicting: [],
        currentCell: this.anchors.slice(),
      })
    }
    if (a.role === 'child' && this.config.children) {
      const conflicting = this.anchors.filter(x => x.role === 'child' && x !== a && effectiveOrder(x) === priority)
      if (conflicting.length > 0) {
        throw new LinkConfigError('unique-order', this.id, this.config, {
          intendedAnchor: { role: 'child', target: a.target, options: { ...a.options, priority } },
          conflicting,
          currentCell: this.anchors.slice(),
        })
      }
    }
    a.options.priority = priority
  }

  destroy(): void {
    const snap = this.anchors.slice()
    this.anchors.length = 0
    for (const a of snap) {
      if (typeof a.target === 'object' && a.target !== null) {
        const owner = a.target as unknown as {
          anchors?: Anchor[]
          __onLinkDissolve?: (a: Anchor) => void
        }
        if (owner && Array.isArray(owner.anchors)) {
          const i = owner.anchors.indexOf(a)
          if (i !== -1) owner.anchors.splice(i, 1)
        }
        if (owner && typeof owner.__onLinkDissolve === 'function') {
          owner.__onLinkDissolve(a)
        }
      }
    }
  }
}