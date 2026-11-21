// ███████╗ ██████╗██████╗ ██╗██████╗ ████████╗███████╗
// ██╔════╝██╔════╝██╔══██╗██║██╔══██╗╚══██╔══╝██╔════╝
// ███████╗██║     ██████╔╝██║██████╔╝   ██║   ███████╗
// ╚════██║██║     ██╔══██╗██║██╔═══╝    ██║   ╚════██║
// ███████║╚██████╗██║  ██║██║██║        ██║   ███████║
// ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝        ╚═╝   ╚══════╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import {Compilation, type Compiler, sources, WebpackError} from '@rspack/core'
import {isChromiumBasedBrowser} from '../../../lib/constants'
import type {DevOptions, FilepathList, PluginInterface} from '../../../types'
import * as messages from '../messages'
import {
  firstPageRelativeTarget,
  injectedSheetRoot,
  inlinedInjectedSheet,
  isInjectedSheet,
  leadingSheetImports,
  namedInjectedSheets,
  publicInjectedSheets,
  rootedAtExtension
} from '../scripts-lib/injected-sheet-urls'

// Chromium resolves a url() in a sheet it injects against the visited page.
// Firefox does the same for a sheet a script fetches into a style element.
export class RootInjectedSheetUrls {
  public static readonly name: string = 'scripts:root-injected-sheet-urls'

  private readonly browser: DevOptions['browser']
  private readonly includeList: FilepathList

  constructor(options: Pick<PluginInterface, 'browser' | 'includeList'>) {
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList || {}
  }

  public apply(compiler: Compiler): void {
    const root = injectedSheetRoot(String(this.browser))
    if (!root) return

    const runtimeEntries = Object.keys(this.includeList).filter((feature) =>
      feature.startsWith('scripts/')
    )

    compiler.hooks.thisCompilation.tap(
      RootInjectedSheetUrls.name,
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: RootInjectedSheetUrls.name,
            // Behind every step that reads a sheet for the files it names,
            // which all expect a target spelled from the output root.
            stage: Compilation.PROCESS_ASSETS_STAGE_REPORT + 500
          },
          () => {
            // A sheet named by file keeps its own relative targets, which
            // only Chromium reads against the page. Firefox reads the file's.
            const chromium = isChromiumBasedBrowser(String(this.browser))
            const named = chromium
              ? namedInjectedSheets(compilation)
              : new Set<string>()
            // Every sheet is read as the build first wrote it, so one that
            // two sheets import is written into both the same way.
            const written = new Map<string, string | undefined>()

            const read = (name: string) => {
              if (!written.has(name)) {
                written.set(
                  name,
                  compilation.getAsset(name)?.source.source().toString()
                )
              }

              return written.get(name)
            }

            const warned = new Set<string>()

            const warn = (
              name: string,
              file: string,
              message: string,
              line = 0
            ) => {
              const key = `${name}\n${file}\n${line}`
              if (warned.has(key)) return

              warned.add(key)

              const warning = new WebpackError(message) as Error & {
                file?: string
              }
              warning.name = name
              warning.file = file
              compilation.warnings.push(warning)
            }

            const updates: Array<[string, string]> = []

            for (const asset of compilation.getAssets()) {
              const byFile = named.has(asset.name)

              if (!byFile && !isInjectedSheet(asset.name, runtimeEntries)) {
                continue
              }

              const before = read(asset.name) ?? ''
              const after = byFile
                ? inlinedInjectedSheet(before, asset.name, {
                    root,
                    read,
                    onSkipped: ({sheet, line, request, reason}) =>
                      warn(
                        'InjectedSheetImportKept',
                        sheet,
                        messages.injectedSheetImportKept(
                          sheet,
                          line,
                          request,
                          reason
                        ),
                        line
                      )
                  })
                : rootedAtExtension(before, root)

              if (after !== before) updates.push([asset.name, after])
            }

            for (const [name, after] of updates) {
              compilation.updateAsset(name, new sources.RawSource(after))
            }

            if (!chromium) return

            // A public/ sheet ships byte for byte, so what Chromium drops
            // from it is said once and the file stays as written.
            for (const name of publicInjectedSheets(compilation)) {
              const text = read(name) ?? ''
              const first = leadingSheetImports(text)[0]

              if (first) {
                warn(
                  'PublicInjectedSheetImportIgnored',
                  `public/${name}`,
                  messages.publicInjectedSheetImportIgnored(
                    `public/${name}`,
                    first.line,
                    first.request
                  )
                )
              }

              const target = firstPageRelativeTarget(text, name, root)

              if (target) {
                warn(
                  'PublicInjectedSheetPageRelativeTarget',
                  `public/${name}`,
                  messages.publicInjectedSheetPageRelativeTarget(
                    `public/${name}`,
                    target.line,
                    target.request,
                    target.named
                  )
                )
              }
            }
          }
        )
      }
    )
  }
}
