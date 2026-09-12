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
import type {FilepathList, PluginInterface} from '../../../types'
import {
  type EntrypointLike,
  entryOwnJsFile,
  initialJsFiles
} from '../../shared/initial-files'
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

  public apply(compiler: Compiler) {
    compiler.hooks.thisCompilation.tap(
      'html:update-html-file',
      (compilation) => {
        const run = () => {
          const htmlEntries = this.includeList || {}
          const projectDir = path.dirname(this.manifestPath)

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
            // step templates $EXTENSION_* in it at this same stage. Building
            // on the asset instead of the file keeps that work, so the env
            // step stays the one owner of templating and this step the one
            // owner of script and asset rewriting, in either tap order.
            const currentHtml = readAssetSource(existing)

            const updated = patchHtml(
              compilation as unknown as Compilation,
              feature,
              resolved,
              (this.includeList || {}) as FilepathList,
              projectDir,
              siblingScriptsFor(compilation as unknown as Compilation, feature),
              currentHtml
            )

            const updatedHtml =
              typeof updated === 'string'
                ? updated
                : updated &&
                    typeof (updated as {html?: unknown}).html === 'string'
                  ? (updated as {html: string}).html
                  : null

            if (typeof updatedHtml === 'string') {
              compilation.updateAsset(
                assetFilename,
                new sources.RawSource(updatedHtml)
              )
            }
          }
        }

        const hasProcessAssets = Boolean(compilation?.hooks?.processAssets?.tap)
        if (hasProcessAssets) {
          compilation.hooks.processAssets.tap(
            {
              name: 'html:update-html-file',
              stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
            },
            () => run()
          )
        } else {
          run()
        }
      }
    )
  }
}
