//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

// Browsers skip an @import placed after other rules but rspack's native CSS
// parser fails the whole module. Blank those rules before it runs and warn.

import * as path from 'node:path'
import postcss, {type AtRule, type Root} from 'postcss'
import * as messages from './css-lib/messages'

interface LateCssImportLoaderContext {
  resourcePath: string
  rootContext?: string
  callback(err: Error | null, content?: string, map?: unknown): void
  emitWarning(warning: Error): void
}

export interface LateImport {
  start: number
  end: number
  line: number
}

// Mirrors rspack's css-module-lexer: an @import stays valid until the first
// top-level block. Anything after it, or nested inside a block, is late.
export function findLateImports(css: string): LateImport[] {
  let root: Root
  try {
    root = postcss.parse(css)
  } catch {
    // Unparseable CSS belongs to the parse guard and the bundler, not here.
    return []
  }

  const firstBlock = root.nodes.findIndex((node) =>
    Array.isArray((node as {nodes?: unknown}).nodes)
  )
  const late: LateImport[] = []

  root.walkAtRules('import', (node: AtRule) => {
    const start = node.source?.start?.offset
    const end = node.source?.end?.offset
    if (typeof start !== 'number' || typeof end !== 'number') return

    const atRoot = node.parent === root
    const index = atRoot ? root.index(node) : -1
    const isLate = !atRoot || (firstBlock !== -1 && index > firstBlock)
    if (!isLate) return

    late.push({start, end, line: node.source?.start?.line || 0})
  })

  return late.sort((a, b) => a.start - b.start)
}

// Replaces the rule text with spaces so every other offset, and the incoming
// source map, stays exactly where it was.
export function blankLateImports(css: string, late: LateImport[]): string {
  let out = css
  for (const {start, end} of late) {
    const blanked = out.slice(start, end).replace(/[^\n]/g, ' ')
    out = out.slice(0, start) + blanked + out.slice(end)
  }
  return out
}

export default function lateCssImportLoader(
  this: LateCssImportLoaderContext,
  source: string,
  map?: unknown
): void {
  const late = findLateImports(source)
  if (late.length === 0) {
    this.callback(null, source, map)
    return
  }

  const relative = this.rootContext
    ? path.relative(this.rootContext, this.resourcePath) || this.resourcePath
    : this.resourcePath
  // Forward slashes on every platform, so the message (and its specs) never
  // depend on the host separator.
  const issuer = relative.split(path.sep).join('/')
  for (const entry of late) {
    this.emitWarning(
      new Error(messages.lateCssImportIgnored(issuer, entry.line || undefined))
    )
  }

  this.callback(null, blankLateImports(source, late), map)
}
