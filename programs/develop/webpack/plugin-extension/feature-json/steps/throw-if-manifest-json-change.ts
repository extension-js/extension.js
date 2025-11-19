import {Compilation, Compiler, WebpackError} from '@rspack/core'
import {createRequire} from 'node:module'
import type {PluginInterface, DevOptions} from '../../../webpack-types'
import {jsonManifestChangeDetected} from '../messages'

function isCriticalJsonFeatureKey(key: string): boolean {
  return (
    key.startsWith('declarative_net_request') ||
    key === 'storage.managed_schema'
  )
}

function buildRestartMessage(field?: string, after?: string, before?: string) {
  const yellow = (s: string) => s
  const green = (s: string) => s
  const red = (s: string) => s
  const lines: string[] = []
  const label = field || 'json'
  lines.push(
    `Entrypoint references changed in ${yellow(label)}. Restart the dev server to pick up changes to critical manifest JSON files.`
  )
  lines.push('')
  if (before) lines.push(`${red('PATH BEFORE')} ${before}`)
  if (after) lines.push(`${green('PATH AFTER')} ${after}`)
  return lines.join('\n')
}

export class ThrowIfManifestJsonChange {
  public readonly manifestPath: string
  public readonly browser: DevOptions['browser']

  private prevList: string[] | null = null
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

  private readCriticalJsonList(): string[] {
    const requireFn = createRequire(import.meta.url)
    const {getManifestFieldsData} = requireFn(
      'browser-extension-manifest-fields'
    ) as {getManifestFieldsData: (opts: any) => any}
    const fields = getManifestFieldsData({
      manifestPath: this.manifestPath,
      browser: this.browser
    })
    const jsonMap = (fields.json || {}) as Record<string, string | string[]>
    const paths: string[] = []
    for (const [key, val] of Object.entries(jsonMap)) {
      if (!isCriticalJsonFeatureKey(key)) continue
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

      const current = this.readCriticalJsonList()

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
          manifestField: 'json',
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
      this.prevList = this.readCriticalJsonList()
    } catch {}

    if (compiler?.hooks?.watchRun?.tapAsync) {
      compiler.hooks.watchRun.tapAsync(
        'json:throw-if-manifest-json-change',
        (compilerWithModifiedFiles, cb) =>
          this.handleWatchRun(compilerWithModifiedFiles, cb)
      )
    }

    compiler.hooks.thisCompilation.tap(
      'json:throw-if-manifest-json-change',
      (compilation) => {
        compilation.hooks.processAssets.tap(
          {
            name: 'json:throw-if-manifest-json-change',
            stage: Compilation.PROCESS_ASSETS_STAGE_OPTIMIZE_COMPATIBILITY
          },
          () => {
            if (!this.pending?.hasChange) return
            if (process.env.EXTENSION_AUTHOR_MODE === 'true') {
              console.log(
                jsonManifestChangeDetected(
                  String(this.pending.manifestField || 'json'),
                  this.pending.pathBefore,
                  this.pending.pathAfter
                )
              )
            }
            const issue = new WebpackError(
              buildRestartMessage(
                this.pending.manifestField,
                this.pending.pathAfter,
                this.pending.pathBefore
              )
            ) as Error & {file?: string}
            issue.file = 'manifest.json'
            compilation.errors.push(issue)
            this.pending = null
          }
        )
      }
    )
  }
}
