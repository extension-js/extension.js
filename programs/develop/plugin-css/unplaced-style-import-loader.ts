//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {WebpackError} from '@rspack/core'
import {canonicalizeDir, canonicalizeResourcePath} from '../lib/resource-path'
import {
  collectModuleSpecifiers,
  createLocalImportResolver,
  readScriptText,
  walkLocalImportGraph
} from '../plugin-web-extension/shared/script-graph'
import * as messages from './css-lib/messages'
import {
  findUnplacedStyleImports,
  namesShadowHost
} from './css-lib/unplaced-style-imports'

interface UnplacedStyleImportLoaderContext {
  resourcePath: string
  rootContext?: string
  getOptions?: () => {projectPath?: string; declaredEntries?: string[]}
  emitWarning(warning: Error): void
  _compilation?: {warnings?: Error[]}
}

// A declared content script gets its imported sheet inside the shadow root
// of a host it marks, so a script that names that host anywhere is left alone.
function reachesShadowHost(entry: string, projectPath: string): boolean {
  const resolve = createLocalImportResolver(projectPath)
  let found = false

  walkLocalImportGraph([entry], (file) => {
    if (found) return []

    const text = readScriptText(file)
    if (text === undefined) return []

    if (namesShadowHost(text)) {
      found = true

      return []
    }

    return collectModuleSpecifiers(text)
      .map((specifier) => resolve(file, specifier))
      .filter((resolved): resolved is string => typeof resolved === 'string')
  })

  return found
}

export default function unplacedStyleImportLoader(
  this: UnplacedStyleImportLoaderContext,
  source: string
): string {
  const unplaced = findUnplacedStyleImports(source)
  if (unplaced.length === 0) return source

  const options = this.getOptions?.() || {}
  const projectPath = options.projectPath || this.rootContext || ''
  const resource = canonicalizeResourcePath(this.resourcePath)
  const declared = (options.declaredEntries || []).includes(resource)

  if (
    declared &&
    (namesShadowHost(source) ||
      reachesShadowHost(this.resourcePath, projectPath))
  ) {
    return source
  }

  // Both sides resolved the same way, or a symlinked folder prints a climb.
  const relative = projectPath
    ? path.relative(canonicalizeDir(projectPath), resource) || resource
    : resource
  const issuer = relative.split(path.sep).join('/')

  const report = new WebpackError(
    messages.unplacedStyleImport(issuer, unplaced, declared)
  )
  ;(report as Error & {file?: string}).file = issuer
  report.name = 'CssUnplacedImport'

  // Straight onto the compilation, so the message prints as written and
  // not under a "Module Warning (from <loader>)" line naming this file.
  const sink = this._compilation?.warnings

  if (sink) {
    sink.push(report)
  } else {
    this.emitWarning(report)
  }

  return source
}
