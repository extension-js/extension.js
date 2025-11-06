import {Compilation, Compiler, WebpackError} from '@rspack/core'
import {type PluginInterface} from '../../../webpack-types'
import {DevOptions} from '../../../types/options'
import {getManifestFieldsData} from 'browser-extension-manifest-fields'

export class ThrowIfManifestScriptsChange {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  private prevList: string[] | null = null
  private pending: {
    hasChange: boolean
    manifestField?: string
    pathAfter?: string
    pathBefore?: string
  } | null = null

  constructor(options: PluginInterface & {browser?: DevOptions['browser']}) {
    this.manifestPath = options.manifestPath
    this.browser = (options.browser as DevOptions['browser']) || 'chrome'
  }

  private readScriptList(): string[] {
    const fields = getManifestFieldsData({
      manifestPath: this.manifestPath,
      browser: this.browser
    })
    const scriptsMap = (fields.scripts || {}) as Record<
      string,
      string | string[]
    >
    const paths: string[] = []

    for (const [, val] of Object.entries(scriptsMap)) {
      if (Array.isArray(val)) paths.push(...(val.filter(Boolean) as string[]))
      else if (val) paths.push(val as string)
    }

    return paths
  }

  private async handleWatchRun(
    compilerWithModifiedFiles: any,
    callbackDone: () => void
  ) {
    try {
      const modifiedFiles: Set<string> =
        compilerWithModifiedFiles.modifiedFiles || new Set<string>()
      const shouldCheck = modifiedFiles.has(this.manifestPath)

      if (!shouldCheck) {
        callbackDone()
        return
      }

      const current = this.readScriptList()

      if (this.prevList === null) {
        this.prevList = current
        this.pending = null
        callbackDone()
        return
      }

      const before = (this.prevList || []).join(',')
      const after = (current || []).join(',')

      if (before !== after) {
        const maxLen = Math.max(this.prevList.length, current.length)
        let pathBefore: string | undefined
        let pathAfter: string | undefined

        for (let i = 0; i < maxLen; i++) {
          const a = this.prevList[i]
          const b = current[i]
          if (a !== b) {
            pathBefore = a
            pathAfter = b
            break
          }
        }

        this.pending = {
          hasChange: true,
          manifestField: 'scripts',
          pathBefore,
          pathAfter
        }
      } else {
        this.pending = null
      }

      this.prevList = current
      callbackDone()
    } catch {
      callbackDone()
    }
  }

  apply(compiler: Compiler): void {
    try {
      this.prevList = this.readScriptList()
    } catch {
      // Best-effort. Will be set on first watchRun otherwise
    }

    compiler.hooks.watchRun.tapAsync(
      'scripts:throw-if-manifest-scripts-change',
      (compilerWithModifiedFiles, cb) =>
        this.handleWatchRun(compilerWithModifiedFiles, cb)
    )

    compiler.hooks.thisCompilation.tap(
      'scripts:throw-if-manifest-scripts-change',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'scripts:throw-if-manifest-scripts-change',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            if (!this.pending?.hasChange) return
            const lines: string[] = []
            lines.push(
              'Entrypoint references changed in scripts. ' +
                'Restart the dev server to pick up changes to manifest script entrypoints.'
            )

            lines.push('')

            if (this.pending.pathBefore) {
              lines.push(`PATH BEFORE ${this.pending.pathBefore}`)
            }

            if (this.pending.pathAfter) {
              lines.push(`PATH AFTER ${this.pending.pathAfter}`)
            }

            const issue = new WebpackError(lines.join('\n')) as Error & {
              file?: string
            }

            issue.file = 'manifest.json'
            compilation.errors.push(issue)
            this.pending = null
          }
        )
      }
    )
  }
}
