import type { Node } from './node.js'

export interface TagSchema {
  required: string[]
  validate: Record<string, (v: unknown) => boolean>
}

export const TAG_SCHEMAS = new Map<string, TagSchema>()

export function registerTagSchema(tag: string, schema: TagSchema): void {
  TAG_SCHEMAS.set(tag, schema)
}

function valueOf(node: Node, key: string): unknown {
  if (key === 'type') return node.type
  if (key === 'props') return node.props
  if (key === 'css') return node.css
  if (key === 'content') return node.content
  if (key === 'handlers') return node.hasHandlers ? node.handlers : undefined
  if (key.startsWith('props.')) return node.props?.[key.slice('props.'.length)]
  if (key.startsWith('css.')) return node.css?.[key.slice('css.'.length)]
  return (node as unknown as Record<string, unknown>)[key]
}

export function validateNode(node: Node, tag?: string): { tag: string; errors: string[] } {
  const tagName = tag ?? node.type
  const schema = TAG_SCHEMAS.get(tagName)
  if (!schema) {
    return tagName
      ? { tag: tagName, errors: [`no tag schema registered for '${tagName}'`] }
      : { tag: '', errors: [] }
  }

  const errors: string[] = []
  for (const key of schema.required) {
    const value = valueOf(node, key)
    if (value === undefined) {
      errors.push(`missing required value '${key}'`)
      continue
    }
    const validator = schema.validate[key]
    if (validator && !validator(value)) {
      errors.push(`'${key}' failed validation`)
    }
  }
  for (const key of Object.keys(schema.validate)) {
    if (schema.required.includes(key)) continue
    const value = valueOf(node, key)
    const validator = schema.validate[key]
    if (value !== undefined && validator && !validator(value)) {
      errors.push(`'${key}' failed validation`)
    }
  }
  return { tag: tagName, errors }
}