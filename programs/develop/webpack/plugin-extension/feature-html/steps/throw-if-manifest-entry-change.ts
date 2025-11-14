import {Compilation, Compiler, WebpackError} from '@rspack/core'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'
import {manifestHtmlEntrypointChange} from '../html-lib/messages'
import type {DevOptions, PluginInterface} from '../../../webpack-types'

export class ThrowIfManifestEntryChange {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  private prevHtmlMap: Record<string, string> | null = null
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

  private readHtmlMap(): Record<string, string> {
    const fields = getManifestFieldsData({
      manifestPath: this.manifestPath,
      browser: this.browser
    })
    return fields.html as Record<string, string>
  }

  private async handleWatchRun(
    compilerWithModifiedFiles: any,
    callbackDone: () => void
  ) {
    try {
      const modifiedFilesSet: Set<string> =
        compilerWithModifiedFiles.modifiedFiles || new Set<string>()
      const shouldCheckManifest: boolean = modifiedFilesSet.has(
        this.manifestPath
      )
      if (!shouldCheckManifest) {
        callbackDone()
        return
      }

      const currentHtmlMap: Record<string, string> = this.readHtmlMap()

      if (this.prevHtmlMap === null) {
        this.prevHtmlMap = currentHtmlMap
        this.pending = null
        callbackDone()
        return
      }

      let changedManifestField: string | undefined
      let htmlPathBefore: string | undefined
      let htmlPathAfter: string | undefined
      const allHtmlKeysToCompare: Set<string> = new Set([
        ...Object.keys(this.prevHtmlMap),
        ...Object.keys(currentHtmlMap)
      ])

      for (const htmlKey of allHtmlKeysToCompare) {
        const previousHtmlValue: string | undefined = this.prevHtmlMap[htmlKey]
        const nextHtmlValue: string | undefined = currentHtmlMap[htmlKey]
        if (previousHtmlValue !== nextHtmlValue) {
          changedManifestField = htmlKey
          htmlPathBefore = previousHtmlValue
          htmlPathAfter = nextHtmlValue
          break
        }
      }

      if (changedManifestField) {
        this.pending = {
          hasChange: true,
          manifestField: changedManifestField,
          pathBefore: htmlPathBefore,
          pathAfter: htmlPathAfter
        }
      } else {
        this.pending = null
      }

      this.prevHtmlMap = currentHtmlMap
      callbackDone()
    } catch {
      callbackDone()
    }
  }

  apply(compiler: Compiler): void {
    // Initialize snapshot once on plugin apply so the FIRST change is detected
    try {
      this.prevHtmlMap = this.readHtmlMap()
    } catch {}

    compiler.hooks.watchRun.tapAsync(
      'html:throw-if-manifest-entry-change',
      (compilerWithModifiedFiles, callbackDone) => {
        this.handleWatchRun(compilerWithModifiedFiles, callbackDone)
      }
    )

    compiler.hooks.thisCompilation.tap(
      'html:throw-if-manifest-entry-change',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'html:throw-if-manifest-entry-change',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            if (!this.pending?.hasChange) return

            const body = manifestHtmlEntrypointChange(
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
