import fs from 'fs'
import webpack, {type Compiler, Compilation} from 'webpack'
import {sources} from 'webpack'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as messages from '../../../lib/messages'
import * as utils from '../../../lib/utils'
import {getFilePath} from '../html-lib/utils'

export class EmitHtmlFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  public apply(compiler: Compiler): void {
    const manifest = require(this.manifestPath)
    const manifestName = manifest.name || 'Extension.js'

    compiler.hooks.thisCompilation.tap('html:emit-html-file', (compilation) => {
      compilation.hooks.processAssets.tap(
        {
          name: 'AddAssetsToCompilationPlugin',
          // Derive new assets from the existing assets.
          stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
        },
        () => {
          const htmlFields = Object.entries(this.includeList || {})

          for (const field of htmlFields) {
            const [featureName, resource] = field

            if (resource) {
              // Do not output if file doesn't exist.
              // If the user updates the path, this script will
              // run again and update the file accordingly.
              if (!fs.existsSync(resource as string)) {
                const errorMessage = messages.manifestFieldError(
                  manifestName,
                  featureName,
                  resource as string
                )
                compilation.warnings.push(
                  new webpack.WebpackError(errorMessage)
                )
                return
              }

              const rawHtml = fs.readFileSync(resource as string, 'utf8')

              if (!utils.shouldExclude(resource as string, this.excludeList)) {
                const rawSource = new sources.RawSource(rawHtml)
                const filepath = getFilePath(featureName, '.html')
                compilation.emitAsset(filepath, rawSource)
              }
            }
          }
        }
      )
    })
  }
}
