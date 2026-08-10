import type { Anchor, AnchorOptions, AnchorTarget, ApplyErrorCode, LinkConfig, LinkConfigErrorCode, Role } from './types.js'

export class LinkConfigError extends Error {
  readonly code: LinkConfigErrorCode
  readonly linkId: string
  readonly config: LinkConfig
  readonly detail: {
    intendedAnchor?: { role: Role; target: AnchorTarget; options: AnchorOptions }
    conflicting: Anchor[]
    currentCell: Anchor[]
  }
  constructor(
    code: LinkConfigErrorCode,
    linkId: string,
    config: LinkConfig,
    detail?: {
      intendedAnchor?: { role: Role; target: AnchorTarget; options: AnchorOptions }
      conflicting: Anchor[]
      currentCell: Anchor[]
    },
  ) {
    super()
    this.name = 'LinkConfigError'
    this.code = code
    this.linkId = linkId
    this.config = config
    this.detail = detail ?? { conflicting: [], currentCell: [] }
  }
}

export class SingleParentError extends Error {
  readonly nodeId: string
  constructor(nodeId: string, message?: string) {
    super(message)
    this.name = 'SingleParentError'
    this.nodeId = nodeId
  }
}

export class CycleError extends Error {
  readonly nodeId: string
  constructor(nodeId: string, message?: string) {
    super(message)
    this.name = 'CycleError'
    this.nodeId = nodeId
  }
}

export class PipelineError extends Error {
  readonly code: 'unknown-stage'|'duplicate-registration'
  constructor(code: 'unknown-stage'|'duplicate-registration', message?: string) {
    super(message)
    this.name = 'PipelineError'
    this.code = code
  }
}

export class PipelineLockError extends Error {
  readonly code: 'unlock-before-resolution'|'lock-order'|'cross-slice-emission'|'double-unlock'
  constructor(code: 'unlock-before-resolution'|'lock-order'|'cross-slice-emission'|'double-unlock', message?: string) {
    super(message)
    this.name = 'PipelineLockError'
    this.code = code
  }
}

export class ApplyError extends Error {
  readonly code: ApplyErrorCode
  readonly detail: unknown
  constructor(code: ApplyErrorCode, detail?: unknown) {
    super()
    this.name = 'ApplyError'
    this.code = code
    this.detail = detail
  }
}