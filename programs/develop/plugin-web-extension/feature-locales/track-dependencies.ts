// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {Compilation} from '@rspack/core'
import * as messages from './messages'
import {getLocales} from './get-locales'

export function trackLocaleDependencies(
  compilation: Compilation,
  manifestPath: string,
  projectRoot?: string
): void {
  if (compilation.errors?.length) return

  // Strict project-root layout: only the canonical `<projectRoot>/_locales/`
  // is scanned. A `_locales/` folder next to the manifest is rejected at
  // validation time with a migration error — see validation.ts
  const localesFields = getLocales(manifestPath, projectRoot) || []
  let added = 0

  for (const thisResource of localesFields) {
    // Only add JSON files to the dependencies
    if (fs.existsSync(thisResource) && path.extname(thisResource) === '.json') {
      if (!compilation.fileDependencies.has(thisResource)) {
        compilation.fileDependencies.add(thisResource)
        added++
      }
    }
  }

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.localesDepsTracked(added))
  }
}
