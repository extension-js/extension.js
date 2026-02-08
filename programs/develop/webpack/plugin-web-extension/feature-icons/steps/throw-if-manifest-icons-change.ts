// ██╗ ██████╗ ██████╗ ███╗   ██╗███████╗
// ██║██╔════╝██╔═══██╗████╗  ██║██╔════╝
// ██║██║     ██║   ██║██╔██╗ ██║███████╗
// ██║██║     ██║   ██║██║╚██╗██║╚════██║
// ██║╚██████╗╚██████╔╝██║ ╚████║███████║
// ╚═╝ ╚═════╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import {createRequire} from 'node:module'
import {Compilation, Compiler, WebpackError} from '@rspack/core'
import {
  manifestIconsEntrypointChange,
  iconsManifestChangeDetected
} from '../messages'
import type {PluginInterface, DevOptions} from '../../../webpack-types'

export class ThrowIfManifestIconsChange {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  private prevIconsList: string[] | null = null
  private pending: {
    hasChange: boolean
    manifestField?: string
    pathAfter?: string
    pathBefore?: string
  } | null = null

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
  }

  private readIconsList(): string[] {
    const requireFn = createRequire(import.meta.url)
    const {getManifestFieldsData} = requireFn(
      'browser-extension-manifest-fields'
    ) as {getManifestFieldsData: (opts: any) => any}
    const fields = getManifestFieldsData({
      manifestPath: this.manifestPath,
      browser: this.browser
    })
    const icons = fields.icons as Record<string, string> | string[] | undefined
    if (!icons) return []
    if (Array.isArray(icons)) return icons
    return Object.values(icons)
  }

  private async handleWatchRun(
    compilerWithModifiedFiles: any,
    callbackDone: () => void
  ) {
    try {
      const modifiedFiles: Set<string> =
        compilerWithModifiedFiles.modifiedFiles || new Set<string>()
      const shouldCheckManifest = modifiedFiles.has(this.manifestPath)
      if (!shouldCheckManifest) {
        callbackDone()
        return
      }

      const currentIconsList = this.readIconsList()

      if (this.prevIconsList === null) {
        this.prevIconsList = currentIconsList
        this.pending = null
        callbackDone()
        return
      }

      // Compare shallowly – any difference requires restart
      const before = (this.prevIconsList || []).join(',')
      const after = (currentIconsList || []).join(',')

      if (before !== after) {
        // Find first delta for better message
        const maxLen = Math.max(
          this.prevIconsList.length,
          currentIconsList.length
        )
        let pathBefore: string | undefined
        let pathAfter: string | undefined

        for (let i = 0; i < maxLen; i++) {
          const a = this.prevIconsList[i]
          const b = currentIconsList[i]
          if (a !== b) {
            pathBefore = a
            pathAfter = b
            break
          }
        }

        this.pending = {
          hasChange: true,
          manifestField: 'icons',
          pathBefore,
          pathAfter
        }
      } else {
        this.pending = null
      }

      this.prevIconsList = currentIconsList
      callbackDone()
    } catch {
      callbackDone()
    }
  }

  apply(compiler: Compiler): void {
    try {
      this.prevIconsList = this.readIconsList()
    } catch {}

    compiler.hooks.watchRun.tapAsync(
      'icons:throw-if-manifest-icons-change',
      (compilerWithModifiedFiles, callbackDone) => {
        this.handleWatchRun(compilerWithModifiedFiles, callbackDone)
      }
    )

    compiler.hooks.thisCompilation.tap(
      'icons:throw-if-manifest-icons-change',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'icons:throw-if-manifest-icons-change',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            if (!this.pending?.hasChange) return
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                iconsManifestChangeDetected(
                  String(this.pending.manifestField || 'icons'),
                  this.pending.pathBefore,
                  this.pending.pathAfter
                )
              )
            }

            const body = manifestIconsEntrypointChange(
              this.pending.manifestField,
              this.pending.pathAfter,
              this.pending.pathBefore
            )
            const issue = new WebpackError(body) as Error & {file?: string}
            issue.file = 'manifest.json'
            compilation.errors.push(issue)
            this.pending = null
          }
        )
      }
    )
  }
}
