// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import rspack, {Compilation, Compiler} from '@rspack/core'
import {filterKeysForThisBrowser} from '../manifest-lib/manifest'
import * as messages from '../messages'
import {PluginInterface, FilepathList} from '../../../webpack-types'

export class CheckManifestFiles {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
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
    const patchedManifest = filterKeysForThisBrowser(manifest, 'chrome')
    const manifestName = patchedManifest.name || 'Extension.js'

    const entries = Object.entries(this.includeList || {})
    for (const [field, value] of entries) {
      if (value) {
        const valueArr = this.extractPaths(value)

        for (const item of valueArr) {
          const ext = path.extname(item as string)

          if (!fs.existsSync(item as string)) {
            // Normalize manifest-referenced paths before deciding:
            // - Leading "/" means extension root (served from public/), not OS root
            // - Relative paths resolved from manifest dir
            // - Absolute OS paths used as-is
            const manifestDir = path.dirname(this.manifestPath)
            const projectPath =
              (compilation.options?.context as string) || manifestDir
            const candidate = item as string

            // If the provided path exists as-is (absolute or relative from cwd), accept it.
            // Otherwise, normalize leading "/" to extension/public root first.
            let resolved = candidate

            if (!fs.existsSync(resolved)) {
              if (candidate.startsWith('/')) {
                const publicCandidate = path.join(
                  projectPath,
                  'public',
                  candidate.slice(1)
                )

                resolved = fs.existsSync(publicCandidate)
                  ? publicCandidate
                  : path.join(manifestDir, candidate.slice(1))
              } else {
                resolved = path.isAbsolute(candidate)
                  ? candidate
                  : path.join(manifestDir, candidate)
              }
            }

            if (fs.existsSync(resolved)) {
              continue
            }

            // Only treat as public-root when the original manifest reference
            // used a leading '/' AND it was not already normalized to an
            // absolute OS path. Absolute filesystem paths are not public-root.
            const isPublicRoot = ((): boolean => {
              const ref = item as string
              return ref.startsWith('/') && !path.isAbsolute(ref)
            })()
            const overrideNotFoundPath = isPublicRoot
              ? path.join(projectPath, 'public', (item as string).slice(1))
              : undefined
            const fieldError = messages.manifestFieldError(
              manifestName,
              field,
              resolved,
              {
                publicRootHint: isPublicRoot,
                overrideNotFoundPath
              }
            )
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
            let fieldsChecked = 0

            try {
              const entries = Object.entries(this.includeList || {})

              for (const [, value] of entries) {
                if (value) {
                  const arr = this.extractPaths(value)

                  fieldsChecked += Array.isArray(arr) ? arr.length : 0
                }
              }
            } catch {
              // ignore counting
            }
            const beforeErrors = (compilation.errors || []).length
            this.handleErrors(compilation, WebpackError)
            const afterErrors = (compilation.errors || []).length

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                messages.manifestValidationScanSummary(
                  fieldsChecked,
                  Math.max(0, afterErrors - beforeErrors)
                )
              )
            }
          }
        )
      }
    )
  }
}
