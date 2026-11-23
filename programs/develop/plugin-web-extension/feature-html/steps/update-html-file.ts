// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, sources} from '@rspack/core'
import {readManifest} from '../../../lib/manifest/source-manifest'
import {filterKeysForThisBrowser} from '../../../lib/manifest-utils'
import type {
  DevOptions,
  FilepathList,
  Manifest,
  PluginInterface
} from '../../../types'
import {
  type EntrypointLike,
  entryOwnJsFile,
  initialJsFiles
} from '../../shared/initial-files'
import {
  needsOptionsDialogFloor,
  OPTIONS_DIALOG_FLOOR_CSS,
  OPTIONS_DIALOG_FLOOR_FILE
} from '../html-lib/options-dialog-floor'
import {patchHtml} from '../html-lib/patch-html'
import {getFilePath} from '../html-lib/utils'

// The chunk files a page entry loads besides its own bundle, root-absolute
// and in load order. Read from the final chunk graph, so a shared cache
// group chunk shows up here and nowhere else.
export function siblingScriptsFor(
  compilation: Compilation,
  feature: string
): string[] {
  const entrypoints = compilation.entrypoints as
    | ReadonlyMap<string, EntrypointLike>
    | undefined
  const entrypoint =
    typeof entrypoints?.get === 'function' ? entrypoints.get(feature) : null
  if (!entrypoint || typeof entrypoint.getFiles !== 'function') return []

  const files = initialJsFiles(entrypoint)
  if (files.length <= 1) return []

  const ownFile = entryOwnJsFile(feature, entrypoint, files)

  return files
    .filter((file) => file !== ownFile)
    .map((file) => getFilePath(file, '', true))
}

// The file the entry chunk was really emitted as, root-absolute. A size cap
// can number every part of a page, leaving no file under the entry's name.
export function entryScriptFor(
  compilation: Compilation,
  feature: string
): string | undefined {
  const entrypoints = compilation.entrypoints as
    | ReadonlyMap<string, EntrypointLike>
    | undefined
  const entrypoint =
    typeof entrypoints?.get === 'function' ? entrypoints.get(feature) : null
  if (!entrypoint || typeof entrypoint.getFiles !== 'function') return undefined

  const ownFile = entryOwnJsFile(
    feature,
    entrypoint,
    initialJsFiles(entrypoint)
  )

  return ownFile ? getFilePath(ownFile, '', true) : undefined
}

// The current markup of an emitted page, from either shape the compilation
// hands back: an Asset record wrapping a Source, or the Source itself.
function readAssetSource(asset: unknown): string | undefined {
  const holder = asset as {source?: unknown} | undefined
  const source = typeof holder?.source === 'function' ? holder : holder?.source
  const read = (source as {source?: () => unknown} | undefined)?.source
  if (typeof read !== 'function') return undefined

  const value = read.call(source)
  if (typeof value === 'string') return value
  if (Buffer.isBuffer(value)) return value.toString('utf8')

  return undefined
}

export class UpdateHtmlFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  // The manifest as this browser reads it, so a prefixed options_ui key
  // counts the same way the include list counted it.
  private readManifestForBrowser(): Manifest | undefined {
    try {
      return filterKeysForThisBrowser(
        readManifest(this.manifestPath),
        (this.browser || 'chrome') as DevOptions['browser']
      ) as Manifest
    } catch {
      return undefined
    }
  }

  public apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'html:update-html-file',
      (compilation) => {
        const run = () => {
          const htmlEntries = this.includeList || {}
          const projectDir = path.dirname(this.manifestPath)
          const manifest = this.readManifestForBrowser()

          for (const [feature, resource] of Object.entries(htmlEntries)) {
            if (!resource || typeof resource !== 'string') continue

            const resolved = path.isAbsolute(resource)
              ? resource
              : resource.startsWith('/')
                ? path.join(projectDir, resource.slice(1))
                : path.join(projectDir, resource)

            if (!fs.existsSync(resolved)) continue

            const assetFilename = getFilePath(feature, '.html', false)
            const getAssetFn = compilation.getAsset
            const existing =
              typeof getAssetFn === 'function'
                ? getAssetFn.call(compilation, assetFilename)
                : (
                    compilation as unknown as {
                      assets?: Record<string, unknown>
                    }
                  ).assets?.[assetFilename]

            if (!existing) continue

            // EmitHtmlFile copied the source file into this asset and the env
            // step, one stage earlier, already templated $EXTENSION_* in it.
            // Building on the asset keeps that work: the env step owns
            // templating and this step owns script and asset rewriting.
            const currentHtml = readAssetSource(existing)

            const optionsDialogFloor = needsOptionsDialogFloor(
              manifest,
              this.browser,
              feature
            )

            // The page links the floor as a file, so the file ships with it.
            if (
              optionsDialogFloor &&
              typeof compilation.emitAsset === 'function' &&
              !getAssetFn?.call(compilation, OPTIONS_DIALOG_FLOOR_FILE)
            ) {
              compilation.emitAsset(
                OPTIONS_DIALOG_FLOOR_FILE,
                new sources.RawSource(OPTIONS_DIALOG_FLOOR_CSS)
              )
            }

            const updated = patchHtml(
              compilation as unknown as Compilation,
              feature,
              resolved,
              (this.includeList || {}) as FilepathList,
              projectDir,
              siblingScriptsFor(compilation as unknown as Compilation, feature),
              currentHtml,
              {
                optionsDialogFloor,
                entryScript: entryScriptFor(
                  compilation as unknown as Compilation,
                  feature
                )
              }
            )

            compilation.updateAsset(
              assetFilename,
              new sources.RawSource(updated)
            )
          }
        }

        compilation.hooks.processAssets.tap(
          {
            name: 'html:update-html-file',
            // Before the size optimizers, so a minifier gets the shipped
            // markup. The env step templates the page one stage earlier.
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_SIZE - 1
          },
          () => run()
        )
      }
    )
  }
}
