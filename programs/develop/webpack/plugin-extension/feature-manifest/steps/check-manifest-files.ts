import * as fs from 'fs'
import * as path from 'path'
import rspack, {Compilation, Compiler} from '@rspack/core'
import * as utils from '../../../webpack-lib/utils'
import * as messages from '../../../webpack-lib/messages'
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
            // Normalize manifest-referenced paths before deciding:
            // - Leading "/" means extension root (relative to manifest dir)
            // - Relative paths resolved from manifest dir
            // - Absolute OS paths used as-is
            const manifestDir = path.dirname(this.manifestPath)
            const candidate = item as string

            // If the provided path exists as-is (absolute or relative from cwd), accept it.
            // Otherwise, normalize leading "/" to extension root.
            let resolved = candidate

            if (!fs.existsSync(resolved)) {
              resolved = candidate.startsWith('/')
                ? path.join(manifestDir, candidate.slice(1))
                : path.isAbsolute(candidate)
                  ? candidate
                  : path.join(manifestDir, candidate)
            }

            if (fs.existsSync(resolved)) {
              continue
            }

            const fieldError = messages.manifestFieldError(
              manifestName,
              field,
              item as string
            )
            // Print a helpful error to stdout to guide users before compilation fails.
            // Tests expect at least one console error to be emitted for missing files.
            try {
              console.error(fieldError)
            } catch {}
            const err = new WebpackError(fieldError) as Error & {file: string}
            // Hint Rspack to display "ERROR in manifest.json × ..."
            err.file = 'manifest.json'
            compilation.errors.push(err)
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
