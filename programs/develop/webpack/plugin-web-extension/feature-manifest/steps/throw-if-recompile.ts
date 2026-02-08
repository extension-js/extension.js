// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as fs from 'fs'
import {Compiler, Compilation, WebpackError} from '@rspack/core'
import * as messages from '../messages'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'
import type {
  DevOptions,
  PluginInterface,
  FilepathList
} from '../../../webpack-types'

export class ThrowIfRecompileIsNeeded {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']
  public readonly includeList?: FilepathList

  private prevHtml: string[] | null = null
  private prevScripts: string[] | null = null
  private pendingChange: {
    hasChange: boolean
    fileAdded?: string
    fileRemoved?: string
  } | null = null

  constructor(options: PluginInterface) {
    this.manifestPath = options.manifestPath
    this.browser = options.browser || 'chrome'
    this.includeList = options.includeList
  }

  private flattenAndSort(arr: any[]): string[] {
    return arr.flat(Infinity).filter(Boolean).map(String).sort()
  }

  private readUserEntrypointsFromDisk(): {html: string[]; scripts: string[]} {
    const fields = getManifestFieldsData({
      manifestPath: this.manifestPath,
      browser: this.browser
    })
    return {
      html: this.flattenAndSort(Object.values(fields.html)),
      scripts: this.flattenAndSort(Object.values(fields.scripts))
    }
  }

  public apply(compiler: Compiler): void {
    // Initialize snapshot once on plugin apply (captures state at server start)
    if (this.prevHtml === null || this.prevScripts === null) {
      try {
        const {html, scripts} = this.readUserEntrypointsFromDisk()
        this.prevHtml = html
        this.prevScripts = scripts
      } catch {
        // best-effort; will be set on first watchRun otherwise
      }
    }

    compiler.hooks.watchRun.tapAsync(
      'manifest:throw-if-recompile-is-needed',
      (compiler, done) => {
        const files = compiler.modifiedFiles || new Set<string>()
        if (!files.has(this.manifestPath)) {
          done()
          return
        }

        const context = compiler.options.context || ''
        const packageJsonPath = `${context}/package.json`
        if (!fs.existsSync(packageJsonPath)) {
          done()
          return
        }

        const {html: nextHtml, scripts: nextScripts} =
          this.readUserEntrypointsFromDisk()

        if (this.prevHtml === null || this.prevScripts === null) {
          // First run: initialize snapshot, never warn
          this.prevHtml = nextHtml
          this.prevScripts = nextScripts
          this.pendingChange = null
          done()
          return
        }

        const scriptsChanged =
          this.prevScripts.toString() !== nextScripts.toString()

        if (scriptsChanged) {
          const fileRemoved =
            this.prevScripts.filter((p) => !nextScripts.includes(p))[0] ||
            undefined
          const fileAdded =
            nextScripts.filter((p) => !this.prevScripts!.includes(p))[0] ||
            undefined
          this.pendingChange = {hasChange: true, fileAdded, fileRemoved}
        } else {
          this.pendingChange = null
        }

        // Update snapshot for next run
        this.prevHtml = nextHtml
        this.prevScripts = nextScripts

        done()
      }
    )

    compiler.hooks.thisCompilation.tap(
      'manifest:throw-if-recompile-is-needed',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'manifest:throw-if-recompile-is-needed',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            if (!this.pendingChange?.hasChange) return

            const fileAdded = this.pendingChange.fileAdded
            const fileRemoved = this.pendingChange.fileRemoved

            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                messages.manifestRecompileDetected(fileAdded, fileRemoved)
              )
            }

            const manifestEntrypointChangeWarning = new WebpackError(
              messages.serverRestartRequiredFromManifestError(
                fileAdded || '',
                fileRemoved || ''
              )
            )
            // @ts-expect-error file is not typed
            manifestEntrypointChangeWarning.file = 'manifest.json'
            // Treat as an error to align with MESSAGE_STYLE.md "Restart required"
            compilation.errors.push(manifestEntrypointChangeWarning)

            this.pendingChange = null
          }
        )
      }
    )
  }
}
