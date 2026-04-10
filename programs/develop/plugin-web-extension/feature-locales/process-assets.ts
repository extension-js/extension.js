// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {Compiler, Compilation, sources} from '@rspack/core'
import * as messages from './messages'
import {getLocales} from './get-locales'

export function processLocaleAssets(
  compiler: Compiler,
  compilation: Compilation,
  manifestPath: string
): void {
  if (compilation.errors.length > 0) return

  const localesFields = getLocales(manifestPath)
  const discoveredList = getLocales(manifestPath) || []
  let emittedCount = 0
  let missingCount = 0

  for (const field of Object.entries(localesFields || [])) {
    const [feature, resource] = field
    const thisResource = resource

    // Resources from the manifest lib can come as undefined.
    if (thisResource) {
      // Only process .json files
      if (path.extname(thisResource) !== '.json') {
        continue
      }

      if (!fs.existsSync(thisResource)) {
        const ErrorConstructor = compiler?.rspack?.WebpackError || Error
        const warning = new ErrorConstructor(
          messages.entryNotFoundMessageOnly(feature)
        )

        // @ts-expect-error - file is not a property of Error
        warning.file = thisResource
        ;(warning as any).name = 'LocalesPluginMissingFile'

        if (!compilation.warnings) {
          compilation.warnings = []
        }

        compilation.warnings.push(warning)
        missingCount++
        continue
      }

      const source = fs.readFileSync(thisResource)
      const rawSource = new sources.RawSource(source)
      // Always emit locales at the bundle root: `_locales/...`
      // regardless of where the manifest lives (e.g., src/manifest.json)
      const manifestDir = path.dirname(manifestPath)
      const localesRoot = path.join(manifestDir, '_locales')
      const relativeToLocales = path.relative(localesRoot, thisResource)

      // Normalize to POSIX-style for asset keys
      const normalizedRel = relativeToLocales.split(path.sep).join('/')
      const filename = `_locales/${normalizedRel}`

      compilation.emitAsset(filename, rawSource)
      emittedCount++
    }
  }

  if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
    console.log(
      messages.localesEmitSummary(
        emittedCount,
        missingCount,
        discoveredList.length
      )
    )
  }
}
