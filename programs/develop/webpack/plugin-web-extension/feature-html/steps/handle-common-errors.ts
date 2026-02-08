// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import * as path from 'path'
import {
  WebpackError,
  type Compiler,
  type StatsError,
  Compilation
} from '@rspack/core'
import {getAssetsFromHtml} from '../html-lib/utils'
import * as messages from '../html-lib/messages'
import {type FilepathList, type PluginInterface} from '../../../webpack-types'

function handleCantResolveError(
  includesList: FilepathList,
  error: StatsError,
  compilation: Compilation,
  manifestDir: string
) {
  const raw = String(error.message || '')
  const patterns = [
    "Module not found: Error: Can't resolve ",
    "Module not found: Can't resolve "
  ]
  const pattern = patterns.find((p) => raw.includes(p))

  if (!pattern) return null

  const customError = raw.replace(pattern, '')
  // Prefer content between single quotes if present, otherwise trim
  const quoted = customError.split("'")
  const wrongFilename = quoted.length > 1 ? quoted[1] : customError.trim()

  if (pattern) {
    for (const field of Object.entries(includesList)) {
      const [, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource) {
        if (!fs.existsSync(resource as string)) return null

        const htmlAssets = getAssetsFromHtml(resource as string)
        const rawJsAssets = htmlAssets?.js || []
        const rawCssAssets = htmlAssets?.css || []
        const jsAssets = rawJsAssets.map((filePath) => path.normalize(filePath))
        const cssAssets = rawCssAssets.map((filePath) =>
          path.normalize(filePath)
        )

        // Normalize potential asset forms for matching
        const dir = path.dirname(resource as string)
        const candidates = new Set<string>([path.normalize(wrongFilename)])
        try {
          candidates.add(path.normalize(path.join(dir, wrongFilename)))
          candidates.add(path.normalize(path.basename(wrongFilename)))
        } catch {
          // Do nothing
        }

        const matches = (arr: string[]) =>
          arr.some((filePath) => candidates.has(path.normalize(filePath)))

        const hit = matches(jsAssets) || matches(cssAssets)

        if (hit) {
          const base = path.basename(wrongFilename)
          // Infer whether the original attribute used leading '/'
          let isPublicRoot = false
          let matchedRawAttr: string | null = null

          const htmlText = fs.readFileSync(resource as string, 'utf8')
          const attrRe = /(src|href)=["']([^"']+)["']/g

          let m: RegExpExecArray | null

          while ((m = attrRe.exec(htmlText))) {
            const raw = m[2]
            if (path.basename(raw) === base || raw.endsWith('/' + base)) {
              isPublicRoot = raw.startsWith('/')
              matchedRawAttr = raw
              break
            }
          }

          const outputRoot = compilation?.options?.output?.path || ''
          const overrideNotFoundPath = isPublicRoot
            ? path.join(
                outputRoot,
                String(matchedRawAttr || base).replace(/^\//, '')
              )
            : matchedRawAttr && !matchedRawAttr.startsWith('/')
              ? path.join(dir, matchedRawAttr)
              : wrongFilename

          const errorMsg = messages.fileNotFound(
            resource as string,
            (overrideNotFoundPath || wrongFilename) as string,
            {publicRootHint: isPublicRoot}
          )
          const warn = new WebpackError(errorMsg)
          warn.name = 'HtmlEntrypointMissing'
          // @ts-expect-error - file is not a property of WebpackError
          warn.file = require('path').relative(manifestDir, resource as string)
          return warn
        }
      }
    }
  }

  return null
}

export class HandleCommonErrors {
  public readonly manifestPath: string
  public readonly includeList?: FilepathList
  public readonly browser?: string

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.includeList = options.includeList
    this.browser = options.browser
  }

  apply(compiler: Compiler) {
    compiler.hooks.compilation.tap(
      'html:handle-common-errors',
      (compilation) => {
        const hasProcessAssets = Boolean(compilation?.hooks?.processAssets?.tap)

        if (hasProcessAssets) {
          compilation.hooks.processAssets.tap(
            {
              name: 'html:handle-common-errors',
              stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
            },
            () => {
              const errs = [...compilation.errors]
              errs.forEach((error, index) => {
                // Handle "Module not found" errors.
                // This is needed because we can't recompile entrypoints at runtime.
                // This does not cover static assets because they are not entrypoints.
                // For that we use the AddAssetsToCompilationPlugin.
                const cantResolveError = handleCantResolveError(
                  this.includeList || {},
                  error as StatsError,
                  compilation,
                  require('path').dirname(this.manifestPath)
                )
                if (cantResolveError) {
                  compilation.errors[index] = cantResolveError
                }
              })
            }
          )
          return
        }

        // Fallback for minimal/mock compilations without processAssets hook
        try {
          const transformed = (compilation.errors || []).map((error) => {
            const replaced = handleCantResolveError(
              this.includeList || {},
              error as unknown as StatsError,
              compilation,
              require('path').dirname(this.manifestPath)
            )
            return replaced || error
          })
          compilation.errors = transformed
        } catch {
          // Do nothing
        }
      }
    )

    if (compiler.hooks?.done?.tap) {
      compiler.hooks.done.tap('html:handle-common-errors:done', (stats) => {
        const compilation = stats.compilation as unknown as Compilation
        const transformed = (compilation.errors || []).map((error) => {
          const replaced = handleCantResolveError(
            this.includeList || {},
            error as unknown as StatsError,
            compilation,
            require('path').dirname(this.manifestPath)
          )
          return replaced || error
        })

        compilation.errors = transformed
      })
    }
  }
}
