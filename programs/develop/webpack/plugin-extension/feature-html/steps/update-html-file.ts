import * as path from 'path'
import * as fs from 'fs'
import {type Compiler, Compilation, sources} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import {getFilePath} from '../html-lib/utils'
import {patchHtml} from '../html-lib/patch-html'

export class UpdateHtmlFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = {}
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
            const existing = compilation.getAsset(assetFilename)
            if (!existing) continue

            const updated = patchHtml(
              compilation as unknown as Compilation,
              feature,
              resolved,
              (this.includeList || {}) as FilepathList,
              (this.excludeList || {}) as FilepathList
            )

            if (updated && typeof updated === 'string') {
              compilation.updateAsset(
                assetFilename,
                new (sources as any).RawSource(updated)
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
