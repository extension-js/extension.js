//  ██████╗███████╗███████╗
// ██╔════╝██╔════╝██╔════╝
// ██║     ███████╗███████╗
// ██║     ╚════██║╚════██║
// ╚██████╗███████║███████║
//  ╚═════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as path from 'node:path'
import {WebpackError} from '@rspack/core'
import {canonicalizeDir, toResourceKey} from '../lib/resource-path'
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

// One spelling per file on Windows, where a loader path and a manifest path
// can differ in separators and drive letter case. Other platforms compare as is.
export function comparablePathKey(
  file: string,
  platform: string = process.platform
): string {
  if (platform !== 'win32' || typeof file !== 'string') return file

  const key = path.win32.normalize(file)

  return /^[a-z]:/.test(key) ? key[0].toUpperCase() + key.slice(1) : key
}

export function isDeclaredEntry(
  resource: string,
  declaredEntries: string[],
  platform: string = process.platform
): boolean {
  const key = comparablePathKey(resource, platform)

  return declaredEntries.some(
    (entry) => comparablePathKey(entry, platform) === key
  )
}

export default function unplacedStyleImportLoader(
  this: UnplacedStyleImportLoaderContext,
  source: string
): string {
  const unplaced = findUnplacedStyleImports(source)
  if (unplaced.length === 0) return source

  const options = this.getOptions?.() || {}
  const projectPath = options.projectPath || this.rootContext || ''
  // Both sides take the same key: a short 8.3 temp path and its long form
  // are one file, and only the file system can tell.
  const resource = toResourceKey(this.resourcePath)
  const declared = isDeclaredEntry(
    resource,
    (options.declaredEntries || []).map(toResourceKey)
  )

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
