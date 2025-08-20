import * as fs from 'fs'
import * as path from 'path'
import rspack, {Compilation, Compiler} from '@rspack/core'
import * as utils from '../../../lib/utils'
import * as messages from '../../../lib/messages'
import {PluginInterface, FilepathList} from '../../../webpack-types'

export class CheckManifestFiles {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly excludeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.excludeList = options.excludeList
  }

  extractPaths(
    value:
      | string
      | string[]
      | {light: string; dark: string}
      | {light: string; dark: string}[]
  ) {
    const valueArr = Array.isArray(value) ? value : [value]

    if (typeof valueArr[0] === 'string') return valueArr

    const paths: any[] = []

    if (typeof value === 'object' && !Array.isArray(value)) {
      const icon = value as {light?: string; dark?: string}

      if (icon.light) {
        paths.push(icon.light)
      }

      if (icon.dark) {
        paths.push(icon.dark)
      }
    }

    return paths
  }

  private handleErrors(
    compilation: Compilation,
    WebpackError: typeof rspack.WebpackError
  ) {
    const iconExts = ['.png', '.jpg', '.jpeg', '.svg', '.gif', '.webp']
    const jsonExts = ['.json']
    const scriptExts = ['.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs']
    const htmlExt = '.html'

    // Parse manifest once and filter per target browser
    const manifest = JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'))
    const patchedManifest = utils.filterKeysForThisBrowser(manifest, 'chrome')
    const manifestName = patchedManifest.name || 'Extension.js'

    const entries = Object.entries(this.includeList || {})
    for (const [field, value] of entries) {
      if (value) {
        const valueArr = this.extractPaths(value)

        for (const item of valueArr) {
          const ext = path.extname(item as string)
          // Skip excluded items
          if (
            this.excludeList &&
            Object.values(this.excludeList).some((excluded) =>
              typeof excluded === 'string'
                ? excluded === item
                : Array.isArray(excluded) && excluded.includes(item as string)
            )
          ) {
            continue
          }

          if (!fs.existsSync(item as string)) {
            // Assume that by refrencing an absolute path, the user
            // know what they are doing. Skip absolute paths.
            if (item.startsWith('/')) {
              continue
            }

            const fieldError = messages.manifestFieldError(
              manifestName,
              field,
              item as string
            )
            // Also surface the error immediately in stdout so users see it
            // before the browser runner attempts to launch.
            try {
              // eslint-disable-next-line no-console
              console.error(fieldError)
            } catch {}
            if (iconExts.includes(ext)) {
              compilation.errors.push(new WebpackError(fieldError))
            } else if (jsonExts.includes(ext)) {
              compilation.errors.push(new WebpackError(fieldError))
            } else if (scriptExts.includes(ext)) {
              compilation.errors.push(new WebpackError(fieldError))
            } else if (ext === htmlExt) {
              compilation.errors.push(new WebpackError(fieldError))
            } else {
              compilation.errors.push(new WebpackError(fieldError))
            }
          }
        }
      }
    }
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      'manifest:check-manifest-files',
      (compilation: Compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'compatibility:check-manifest-files',
            // One after PROCESS_ASSETS_STAGE_OPTIMIZE, where
            // feature-browser-fields cuts off the browser-specific field prefixes.
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COUNT
          },
          () => {
            const WebpackError = rspack.WebpackError

            // Handle all errors.
            this.handleErrors(compilation, WebpackError)
          }
        )
      }
    )
  }
}
