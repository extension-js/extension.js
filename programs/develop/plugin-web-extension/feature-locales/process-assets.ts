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
import {debugLine, isDebug} from '../../lib/messaging'
import {hasJsonComments, parseAuthoredJson} from '../../lib/parse-json-safe'
import {
  privateFileKind,
  sourceFileMayShip
} from '../../lib/public-private-files'
import {
  getLocales,
  localeFoldersWithoutMessages,
  localesFolderIsCopiedByPublic,
  resolveLocalesFolder
} from './get-locales'
import * as messages from './messages'

function warnLocaleFoldersWithoutMessages(
  compiler: Compiler,
  compilation: Compilation,
  manifestPath: string,
  projectRoot?: string
): void {
  const ErrorConstructor = compiler?.rspack?.WebpackError || Error

  for (const folder of localeFoldersWithoutMessages(
    manifestPath,
    projectRoot
  )) {
    const warning = new ErrorConstructor(
      messages.localeFolderWithoutMessages(`_locales/${path.basename(folder)}`)
    )

    // @ts-expect-error - file is not a property of Error
    warning.file = folder
    ;(warning as Error).name = 'LocalesFolderWithoutMessages'

    if (!compilation.warnings) {
      compilation.warnings = []
    }

    compilation.warnings.push(warning)
  }
}

// Both engine families read // comments in a messages.json file and the
// stores refuse them, so a commented catalog ships as plain JSON.
function commentFreeLocaleSource(file: string, source: Buffer): Buffer {
  if (path.basename(file) !== 'messages.json') return source
  if (!hasJsonComments(source)) return source

  try {
    return Buffer.from(JSON.stringify(parseAuthoredJson(source), null, 2))
  } catch {
    return source
  }
}

export function processLocaleAssets(
  compiler: Compiler,
  compilation: Compilation,
  manifestPath: string
): void {
  if (compilation.errors.length > 0) return

  const projectRoot =
    (compiler.options.context as string | undefined) || undefined

  warnLocaleFoldersWithoutMessages(
    compiler,
    compilation,
    manifestPath,
    projectRoot
  )

  if (localesFolderIsCopiedByPublic(manifestPath, projectRoot)) {
    if (isDebug()) {
      const discovered = getLocales(manifestPath, projectRoot) || []
      debugLine(messages.localesEmitSummary(0, 0, discovered.length))
    }

    return
  }

  const localesFields = getLocales(manifestPath, projectRoot) || []
  const discoveredList = localesFields
  const resolvedLocalesRoot = resolveLocalesFolder(manifestPath, projectRoot)
  const projectRoots = [projectRoot, path.dirname(manifestPath)].filter(
    (root): root is string => Boolean(root)
  )
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
      // A file the build never copies is left out the way a missing one is.
      const withheld =
        fs.existsSync(thisResource) &&
        !sourceFileMayShip(thisResource, projectRoots, 'walked')

      if (withheld || !fs.existsSync(thisResource)) {
        const leftOutKind = withheld
          ? privateFileKind(path.basename(thisResource))
          : undefined

        // Editor and repository leftovers are skipped without a word, as
        // the public folder copier skips them.
        if (leftOutKind === 'os' || leftOutKind === 'tooling') continue

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

      const source = commentFreeLocaleSource(
        thisResource,
        fs.readFileSync(thisResource)
      )
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
    debugLine(
      messages.localesEmitSummary(
        emittedCount,
        missingCount,
        discoveredList.length
      )
    )
  }
}
