// ██╗  ██╗████████╗███╗   ███╗██╗
// ██║  ██║╚══██╔══╝████╗ ████║██║
// ███████║   ██║   ██╔████╔██║██║
// ██╔══██║   ██║   ██║╚██╔╝██║██║
// ██║  ██║   ██║   ██║ ╚═╝ ██║███████╗
// ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import * as fs from 'node:fs'
import * as path from 'node:path'
import {Compilation, type Compiler, type StatsError} from '@rspack/core'
import type {FilepathList, PluginInterface} from '../../../types'
import {reportToCompilation} from '../../shared/compilation-issues'
import * as messages from '../html-lib/messages'
import {getAssetsFromHtml} from '../html-lib/utils'

// The page and the file behind a "Module not found" of a page entry.
function missingPageEntry(
  includesList: FilepathList,
  error: StatsError,
  manifestDir: string
): {page: string; missing: string; isPublicRoot: boolean} | null {
  const raw = String(error.message || '')
  const patterns = [
    "Module not found: Error: Can't resolve ",
    "Module not found: Can't resolve "
  ]
  const pattern = patterns.find((p) => raw.includes(p))

  if (!pattern) return null

  const customError = raw.replace(pattern, '')
  const quoted = customError.split("'")
  const wrongFilename = quoted.length > 1 ? quoted[1] : customError.trim()

  if (pattern) {
    for (const field of Object.entries(includesList)) {
      const [, resource] = field

      // Resources from the manifest lib can come as undefined.
      if (resource) {
        // One page without a file says nothing about the pages after it.
        if (!fs.existsSync(resource as string)) continue

        const htmlAssets = getAssetsFromHtml(resource as string)
        const rawJsAssets = htmlAssets?.js || []
        const rawCssAssets = htmlAssets?.css || []
        const jsAssets = rawJsAssets.map((filePath) => path.normalize(filePath))
        const cssAssets = rawCssAssets.map((filePath) =>
          path.normalize(filePath)
        )

        const dir = path.dirname(resource as string)
        const candidates = new Set<string>([path.normalize(wrongFilename)])

        try {
          candidates.add(path.normalize(path.join(dir, wrongFilename)))
          candidates.add(path.normalize(path.basename(wrongFilename)))
        } catch {
          // Ignore
        }

        const matches = (arr: string[]) =>
          arr.some((filePath) => candidates.has(path.normalize(filePath)))

        const hit = matches(jsAssets) || matches(cssAssets)

        if (hit) {
          const base = path.basename(wrongFilename)
          let isPublicRoot = false
          let matchedRawAttr: string | null = null

          const htmlText = fs.readFileSync(resource as string, 'utf8')
          const attrRe = /(src|href)=["']([^"']+)["']/g

          let m: RegExpExecArray | null

          while ((m = attrRe.exec(htmlText))) {
            const raw = m[2]

            if (path.basename(raw) === base || raw.endsWith(`/${base}`)) {
              isPublicRoot = raw.startsWith('/')
              matchedRawAttr = raw
              break
            }
          }

          const overrideNotFoundPath = isPublicRoot
            ? path.join(
                manifestDir,
                String(matchedRawAttr || base).replace(/^\//, '')
              )
            : matchedRawAttr && !matchedRawAttr.startsWith('/')
              ? path.join(dir, matchedRawAttr)
              : wrongFilename

          return {
            page: resource as string,
            missing: (overrideNotFoundPath || wrongFilename) as string,
            isPublicRoot
          }
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
    // The top compilation only: a `compilation` tap is copied into every
    // child compiler, which would run the same rewrite again per child.
    compiler.hooks.thisCompilation.tap(
      'html:handle-common-errors',
      (compilation) => {
        const manifestDir = path.dirname(this.manifestPath)
        // A script deleted while the session runs reads as it does at
        // startup and in a production build: a dead reference warns.
        const strictRefs = process.env.EXTENSION_STRICT_REFS === 'true'
        const deadRefs: Array<{page: string; missing: string; hint: boolean}> =
          []

        const report = (ref: (typeof deadRefs)[number]) =>
          reportToCompilation(
            compilation,
            compiler,
            messages.fileNotFound(ref.page, ref.missing, {
              publicRootHint: ref.hint,
              deadRefHint: !strictRefs
            }),
            strictRefs ? 'error' : 'warning',
            ref.page,
            'HtmlEntrypointMissing'
          )

        // The first asset stage: a module that cannot be found is known
        // by then, and the steps that skip a failed build run after it.
        compilation.hooks.processAssets.tap(
          {
            name: 'html:handle-common-errors',
            stage: Compilation.PROCESS_ASSETS_STAGE_ADDITIONAL
          },
          () => {
            const others: Error[] = []

            for (const error of [...compilation.errors]) {
              // A page entry that is gone fails as "Module not found". The
              // static files a page names are reported by the emit step.
              const entry = missingPageEntry(
                this.includeList || {},
                error as StatsError,
                manifestDir
              )

              if (!entry) {
                others.push(error as Error)
                continue
              }

              deadRefs.push({
                page: path.relative(manifestDir, entry.page),
                missing: entry.missing,
                hint: entry.isPublicRoot
              })
            }

            if (deadRefs.length === 0) return

            compilation.errors = others as typeof compilation.errors

            if (strictRefs) deadRefs.splice(0).forEach(report)
          }
        )

        // The asset step warns about the same file when the build is clean.
        // This one speaks only when that step was skipped over another error.
        compilation.hooks.processAssets.tap(
          {
            name: 'html:handle-common-errors',
            stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE
          },
          () => {
            for (const ref of deadRefs.splice(0)) {
              const said = Array.from(compilation.warnings).some(
                (warning) =>
                  warning.name === 'HtmlEntrypointMissing' &&
                  String(warning.message).includes(ref.missing)
              )

              if (!said) report(ref)
            }
          }
        )
      }
    )
  }
}
