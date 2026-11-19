import * as fs from 'node:fs'
import * as path from 'node:path'
import type {Compilation} from '@rspack/core'
import {debugLine, isDebug} from '../../lib/messaging'
import {
  getLocales,
  localeFoldersWithoutMessages,
  localesFolderCandidates,
  resolveLocalesFolder
} from './get-locales'
import * as messages from './messages'

export function trackLocaleDependencies(
  compilation: Compilation,
  manifestPath: string,
  projectRoot?: string
): void {
  // Tracked even when this build errored: a broken messages.json is exactly
  // the file whose fix must trigger the next rebuild.
  const localesFields = getLocales(manifestPath, projectRoot) || []
  const localesFolder = resolveLocalesFolder(manifestPath, projectRoot)
  let added = 0

  // The folder itself is watched, so a new locale or a new file beside
  // messages.json rebuilds. One that is not there yet is watched as missing.
  if (localesFolder) {
    compilation.contextDependencies?.add(localesFolder)
  } else {
    for (const candidate of localesFolderCandidates(
      manifestPath,
      projectRoot
    )) {
      compilation.missingDependencies?.add(candidate)
    }
  }

  for (const folder of localeFoldersWithoutMessages(
    manifestPath,
    projectRoot
  )) {
    compilation.missingDependencies?.add(path.join(folder, 'messages.json'))
  }

  for (const thisResource of localesFields) {
    if (!thisResource) continue

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
    debugLine(messages.localesDepsTracked(added))
  }
}
