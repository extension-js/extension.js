// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

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
  if (compilation.errors?.length) return

  // Only the canonical `<projectRoot>/_locales/` is scanned; a `_locales/`
  // next to the manifest is rejected at validation time with a migration error.
  const localesFields = getLocales(manifestPath, projectRoot) || []
  let added = 0

  for (const thisResource of localesFields) {
    if (fs.existsSync(thisResource) && path.extname(thisResource) === '.json') {
      if (!compilation.fileDependencies.has(thisResource)) {
        compilation.fileDependencies.add(thisResource)
        added++
      }
    }
  }

  if (isDebug()) {
    console.log(messages.localesDepsTracked(added))
  }
}
