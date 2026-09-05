import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {isDebug} from '../../lib/messaging'
import {getLocales} from './get-locales'
import * as messages from './messages'

export function trackLocaleDependencies(
  compilation: Compilation,
  manifestPath: string,
  projectRoot?: string
): void {
  // Tracked even when this build errored: a broken messages.json is exactly
  // the file whose fix must trigger the next rebuild.
  const localesFields = getLocales(manifestPath, projectRoot) || []
  let added = 0
  for (const thisResource of localesFields) {
    if (path.extname(thisResource) !== '.json') continue
    if (!fs.existsSync(thisResource)) {
      compilation.missingDependencies?.add(thisResource)
      continue
    }
    if (!compilation.fileDependencies.has(thisResource)) {
      compilation.fileDependencies.add(thisResource)
      added++
    }
  }
  if (isDebug()) {
    console.log(messages.localesDepsTracked(added))
  }
}
