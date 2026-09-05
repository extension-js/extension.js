// ██╗      ██████╗  ██████╗ █████╗ ██╗     ███████╗███████╗
// ██║     ██╔═══██╗██╔════╝██╔══██╗██║     ██╔════╝██╔════╝
// ██║     ██║   ██║██║     ███████║██║     █████╗  ███████╗
// ██║     ██║   ██║██║     ██╔══██║██║     ██╔══╝  ╚════██║
// ███████╗╚██████╔╝╚██████╗██║  ██║███████╗███████╗███████║
// ╚══════╝ ╚═════╝  ╚═════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {type Compilation, type Compiler, sources} from '@rspack/core'
import {isDebug} from '../../lib/messaging'
import {getLocales, resolveLocalesFolder} from './get-locales'
import * as messages from './messages'

export function processLocaleAssets(
  compiler: Compiler,
  compilation: Compilation,
  manifestPath: string
): void {
  if (compilation.errors.length > 0) return

  const projectRoot =
    (compiler.options.context as string | undefined) || undefined
  const localesFields = getLocales(manifestPath, projectRoot) || []
  const discoveredList = localesFields
  const resolvedLocalesRoot = resolveLocalesFolder(manifestPath, projectRoot)
  let emittedCount = 0
  let missingCount = 0

  // The locale list is an array of file paths, so the field a message names
  // is the file itself: an index like "0" sends nobody to the right place.
  for (const thisResource of localesFields || []) {
    const feature = resolvedLocalesRoot
      ? path
          .join('_locales', path.relative(resolvedLocalesRoot, thisResource))
          .split(path.sep)
          .join('/')
      : thisResource

    // Resources from the manifest lib can come as undefined.
    if (thisResource) {
      if (path.extname(thisResource) !== '.json') {
        continue
      }

      if (!fs.existsSync(thisResource)) {
        const ErrorConstructor = compiler?.rspack?.WebpackError || Error
        // The message names the locale file; the absolute path rides on the
        // warning's file metadata like every other emit-time warning.
        const warning = new ErrorConstructor(
          messages.entryNotFoundMessageOnly(feature)
        )

        // @ts-expect-error - file is not a property of Error
        warning.file = thisResource
        ;(warning as Error).name = 'LocalesPluginMissingFile'

        if (!compilation.warnings) {
          compilation.warnings = []
        }

        compilation.warnings.push(warning)
        missingCount++
        continue
      }

      const source = fs.readFileSync(thisResource)
      const rawSource = new sources.RawSource(source)
      // Always emit locales at the bundle root (`_locales/...`) regardless of
      // where the source `_locales/` lives (project root or next to manifest).
      const localesRoot =
        resolvedLocalesRoot || path.join(path.dirname(manifestPath), '_locales')
      const relativeToLocales = path.relative(localesRoot, thisResource)

      // Normalize to POSIX-style for asset keys
      const normalizedRel = relativeToLocales.split(path.sep).join('/')
      const filename = `_locales/${normalizedRel}`

      compilation.emitAsset(filename, rawSource)
      emittedCount++
    }
  }

  if (isDebug()) {
    console.log(
      messages.localesEmitSummary(
        emittedCount,
        missingCount,
        discoveredList.length
      )
    )
  }
}
