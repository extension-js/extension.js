import * as fs from 'fs'
import {WebpackError, sources, type Compiler, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as messages from '../html-lib/messages'
import {getFilePath} from '../html-lib/utils'
import {reportToCompilation} from '../html-lib/utils'

export class EmitHtmlFile {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList
  public readonly browser?: PluginInterface['browser']

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = {}
    this.browser = options.browser
  }

  public apply(compiler: Compiler): void {
    compiler.hooks.thisCompilation.tap('html:emit-html-file', (compilation) => {
      const processAssetsHook = compilation.hooks?.processAssets
      const runner = () => {
        const htmlFields = Object.entries(this.includeList || {})

        for (const field of htmlFields) {
          const [featureName, resource] = field

          if (resource) {
            if (typeof resource !== 'string') continue
            // Normalize HTML resource path relative to manifest:
            // - Leading "/" means extension root (manifest dir)
            // - Relative paths are resolved from manifest dir
            // - Absolute OS paths are used as-is
            const projectDir = require('path').dirname(this.manifestPath)
            const resolved = require('path').isAbsolute(resource)
              ? resource
              : resource.startsWith('/')
                ? require('path').join(projectDir, resource.slice(1))
                : require('path').join(projectDir, resource)

            if (!fs.existsSync(resolved)) {
              // Only warn for non-entrypoint HTML (special pages/*). Entrypoint
              // errors are handled by the manifest feature checks.
              if (featureName.startsWith('pages/')) {
                reportToCompilation(
                  compilation,
                  compiler,
                  messages.manifestFieldMessageOnly(featureName),
                  'warning'
                )
              }
              continue
            }
            const rawHtml = fs.readFileSync(resolved, 'utf8')

            if (true) {
              const rawSource = new sources.RawSource(rawHtml)
              const filepath = getFilePath(featureName, '.html', false)
              compilation.emitAsset(filepath, rawSource)
            }
          }
        }
      }
      if (processAssetsHook && typeof processAssetsHook.tap === 'function') {
        processAssetsHook.tap(
          {
            name: 'AddAssetsToCompilationPlugin',
            // Derive new assets from the existing assets.
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => runner()
        )
      } else {
        // Fallback for environments without processAssets support (tests)
        runner()
      }
    })
  }
}
