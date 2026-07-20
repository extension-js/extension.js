import * as path from 'node:path'

export function normalizePathForAssert(filePath: string): string {
  return filePath.split(path.sep).join('/')
}

export function pathPattern(segments: string[]): RegExp {
  const escaped = segments.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  const pattern = escaped.join('[\\\\/]')
  return new RegExp(`${pattern}$`)
}
