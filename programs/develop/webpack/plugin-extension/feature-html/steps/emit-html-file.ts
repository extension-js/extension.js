import * as fs from 'fs'
import rspack, {sources, type Compiler, Compilation} from '@rspack/core'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'
import * as messages from '../../../webpack-lib/messages'
import * as utils from '../../../webpack-lib/utils'
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
    const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf-8'))
    const patchedManifest = utils.filterKeysForThisBrowser(
      manifest,
      (compiler.options as any)?.devServer?.browser || 'chrome'
    )

    const manifestName = patchedManifest.name || 'Extension.js'

    compiler.hooks.thisCompilation.tap('html:emit-html-file', (compilation) => {
      const processAssetsHook: any = (compilation as any).hooks?.processAssets
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
              const errorMessage = messages.manifestFieldError(
                manifestName,
                featureName,
                resource
              )
              // Only warn for non-entrypoint HTML (special pages/*). Entrypoint
              // errors are handled by the manifest feature checks.
              if (featureName.startsWith('pages/')) {
                try {
                  // eslint-disable-next-line no-console
                  console.error(errorMessage)
                } catch {}
                compilation.warnings.push(new rspack.WebpackError(errorMessage))
              }
              continue
            }
            const rawHtml = fs.readFileSync(resolved, 'utf8')

            if (!utils.shouldExclude(resolved, this.excludeList)) {
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
