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
  manifestPath: string
): void {
  if (compilation.errors?.length) return

  const localesFields = getLocales(manifestPath)
  let added = 0

  for (const field of Object.entries(localesFields || [])) {
    const [, resource] = field

    if (resource) {
      const fileDependencies = new Set(compilation.fileDependencies)

      const fileResources = localesFields || []

      for (const thisResource of fileResources) {
        // Only add JSON files to the dependencies
        if (
          fs.existsSync(thisResource) &&
          path.extname(thisResource) === '.json'
        ) {
          if (!fileDependencies.has(thisResource)) {
            fileDependencies.add(thisResource)
            compilation.fileDependencies.add(thisResource)
            added++
          }
        }
      }
    }
  }

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(messages.localesDepsTracked(added))
  }
}
