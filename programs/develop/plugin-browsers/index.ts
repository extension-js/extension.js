// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import * as path from 'path'
import {EventEmitter} from 'node:events'
import type {Compiler} from '@rspack/core'
import {getCanonicalContentScriptEntryName} from '../plugin-web-extension/feature-scripts/contracts'

// ---------------------------------------------------------------------------
// Build event types
// ---------------------------------------------------------------------------

export type ReloadType = 'full' | 'service-worker' | 'content-scripts'

export interface ReloadInstruction {
  type: ReloadType
  changedContentScriptEntries?: string[]
  changedAssets?: string[]
}

export interface CompiledEvent {
  outputPath: string
  contextDir: string
  isFirstCompile: boolean
  reloadInstruction?: ReloadInstruction
  extensionsToLoad?: string[]
}

export interface BuildErrorEvent {
  errors: string[]
}

export interface BuildEventMap {
  compiled: [CompiledEvent]
  error: [BuildErrorEvent]
  close: []
}

export class BuildEmitter extends EventEmitter<BuildEventMap> {}

// ---------------------------------------------------------------------------
// Browser launcher contract (dependency-injected by the CLI)
// ---------------------------------------------------------------------------

export interface BrowserLaunchOptions {
  browser: string
  outputPath: string
  contextDir: string
  extensionsToLoad: string[]
  mode?: 'development' | 'production'
  enableDevtools?: boolean
  noOpen?: boolean
  profile?: string | false
  persistProfile?: boolean
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  startingUrl?: string
  chromiumBinary?: string
  geckoBinary?: string
  instanceId?: string
  port?: number | string
  dryRun?: boolean
  source?: string
  watchSource?: boolean
  sourceFormat?: 'pretty' | 'json' | 'ndjson'
  sourceSummary?: boolean
  sourceMeta?: boolean
  sourceProbe?: string[]
  sourceTree?: 'off' | 'root-only'
  sourceConsole?: boolean
  sourceDom?: boolean
  sourceMaxBytes?: number
  sourceRedact?: 'off' | 'safe' | 'strict'
  sourceIncludeShadow?: 'off' | 'open-only' | 'all'
  sourceDiff?: boolean
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

export interface BrowserController {
  reload(instruction?: ReloadInstruction): Promise<void>
  enableUnifiedLogging(opts: {
    level?: string
    contexts?: string[]
    format?: 'pretty' | 'json' | 'ndjson'
    timestamps?: boolean
    color?: boolean
    urlFilter?: string
    tabFilter?: number | string
  }): Promise<void>
  close(): Promise<void>
}

export type BrowserLauncherFn = (
  opts: BrowserLaunchOptions
) => Promise<BrowserController>

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

export interface BrowsersPluginOptions {
  /** Injected browser launcher — provided by the CLI from programs/extension/browsers/ */
  launcher: BrowserLauncherFn
  /** Browser-related options forwarded to the launcher (outputPath/contextDir/extensionsToLoad are filled at compile time) */
  browserOptions: Omit<
    BrowserLaunchOptions,
    'outputPath' | 'contextDir' | 'extensionsToLoad'
  >
}

// ---------------------------------------------------------------------------
// BrowsersPlugin — rspack plugin that wraps the browser API
// ---------------------------------------------------------------------------

/**
 * BrowsersPlugin
 *
 * An rspack plugin that manages the browser lifecycle for extension development.
 * On first successful compilation it launches a browser via the injected launcher
 * function; on subsequent compilations it classifies changed files and triggers
 * the appropriate reload strategy (full / service-worker / content-scripts).
 *
 * A `BuildEmitter` is exposed as `plugin.emitter` so that external consumers
 * (CLI telemetry, wait-mode, etc.) can subscribe to build events without
 * coupling to rspack.
 */
export class BrowsersPlugin {
  static readonly name = 'plugin-browsers'

  /** EventEmitter for build lifecycle events (compiled, error, close). */
  readonly emitter = new BuildEmitter()

  /**
   * Extension directories to load alongside the user extension.
   * Set externally by webpack-config after computing companion extensions,
   * before the first compilation.
   */
  extensionsToLoad: string[] = []

  private isFirstCompile = true
  private controller: BrowserController | undefined

  constructor(private readonly options: BrowsersPluginOptions) {}

  apply(compiler: Compiler) {
    let pendingReloadReason: ReloadType | undefined
    let pendingChangedSources: string[] = []

    // ---- watchRun: classify changed files ----
    compiler.hooks.watchRun.tap(BrowsersPlugin.name, () => {
      pendingReloadReason = undefined
      pendingChangedSources = []
      const modifiedFiles = compiler.modifiedFiles
      if (!modifiedFiles || modifiedFiles.size === 0) return

      const contextDir = compiler.options.context || ''
      for (const file of modifiedFiles) {
        const normalized = path.relative(contextDir, file).replace(/\\/g, '/')
        pendingChangedSources.push(normalized)

        if (normalized.includes('manifest.json')) {
          pendingReloadReason = 'full'
        } else if (normalized.includes('_locales/')) {
          pendingReloadReason = 'full'
        }
      }
    })

    // ---- done: launch / reload browser, emit events ----
    compiler.hooks.done.tapPromise(BrowsersPlugin.name, async (stats: any) => {
      const compilation = stats.compilation
      const hasErrors = compilation.errors && compilation.errors.length > 0

      if (hasErrors) {
        this.emitter.emit('error', {
          errors: compilation.errors.map((e: any) =>
            typeof e === 'string' ? e : e.message || String(e)
          )
        })
        return
      }

      const outputPath = String(compilation.options?.output?.path || '')
      const contextDir = String(compilation.options?.context || '')

      // Classify reload type from modified source files. Asset-name heuristics
      // are unreliable because `compilation.assets` contains every emitted
      // asset on each compile (including a persistent background/service_worker.js),
      // which made every classification resolve to 'service-worker' even when
      // only a content script changed.
      let reloadInstruction: ReloadInstruction | undefined

      if (!this.isFirstCompile && pendingReloadReason) {
        reloadInstruction = {type: pendingReloadReason}
      } else if (!this.isFirstCompile && pendingChangedSources.length > 0) {
        const isServiceWorkerSource = (rel: string) =>
          /(^|\/)background(\.|\/)/i.test(rel) ||
          /service[-_.]?worker/i.test(rel)

        const hasServiceWorkerChange = pendingChangedSources.some(
          isServiceWorkerSource
        )

        if (hasServiceWorkerChange) {
          reloadInstruction = {
            type: 'service-worker',
            changedAssets: pendingChangedSources
          }
        } else {
          // Any other source change falls under 'content-scripts'. Pass every
          // content-script entry name so the controller can URL-match against
          // open tabs and reload only the ones that actually run the scripts.
          const contentScriptCount = readContentScriptCount(
            compilation,
            outputPath
          )
          if (contentScriptCount > 0) {
            const entries: string[] = []
            for (let i = 0; i < contentScriptCount; i++) {
              entries.push(getCanonicalContentScriptEntryName(i))
            }
            reloadInstruction = {
              type: 'content-scripts',
              changedContentScriptEntries: entries,
              changedAssets: pendingChangedSources
            }
          }
        }
      }

      // --- Browser lifecycle ---
      const wasFirstCompile = this.isFirstCompile
      this.isFirstCompile = false

      if (wasFirstCompile) {
        try {
          this.controller = await this.options.launcher({
            ...this.options.browserOptions,
            outputPath,
            contextDir,
            extensionsToLoad: this.extensionsToLoad
          })

          // Enable unified logging when requested
          const logLevel = this.options.browserOptions.logLevel || 'off'
          if (logLevel !== 'off' && this.controller) {
            await this.controller.enableUnifiedLogging({
              level: logLevel,
              contexts: this.options.browserOptions.logContexts,
              format: this.options.browserOptions.logFormat,
              timestamps: this.options.browserOptions.logTimestamps,
              color: this.options.browserOptions.logColor,
              urlFilter: this.options.browserOptions.logUrl,
              tabFilter: this.options.browserOptions.logTab
            })
          }
        } catch (error) {
          this.emitter.emit('error', {
            errors: [error instanceof Error ? error.message : String(error)]
          })
        }
      } else if (this.controller && reloadInstruction) {
        try {
          await this.controller.reload(reloadInstruction)
        } catch {
          // Reload failures are non-fatal — the browser may have been closed
        }
      }

      // --- Emit event for external consumers (telemetry, wait-mode) ---
      this.emitter.emit('compiled', {
        outputPath,
        contextDir,
        isFirstCompile: wasFirstCompile,
        reloadInstruction,
        extensionsToLoad: wasFirstCompile ? this.extensionsToLoad : undefined
      })
    })
  }
}

function readContentScriptCount(compilation: any, outputPath: string): number {
  try {
    const asset = compilation.getAsset?.('manifest.json')
    if (asset?.source) {
      const manifest = JSON.parse(String(asset.source.source()))
      const list = manifest?.content_scripts
      if (Array.isArray(list)) return list.length
    }
  } catch {
    // fall through to disk read
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs') as typeof import('fs')
    const manifestPath = path.join(outputPath, 'manifest.json')
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      const list = manifest?.content_scripts
      if (Array.isArray(list)) return list.length
    }
  } catch {
    // ignore
  }

  return 0
}
