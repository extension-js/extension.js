// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {
  BrowserType,
  CompilationLike,
  PluginInterface,
  Controller
} from './browsers-types'
import {computeBinariesBaseDir} from './browsers-lib/output-binaries-resolver'
import {printDevBannerOnce, printProdBannerOnce} from './browsers-lib/banner'
import {buildBrowserLaunchRequest} from './browsers-lib/runtime-options'
import {createChromiumContext} from './run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from './run-chromium/chromium-launch'
import type {ChromiumLaunchOptions} from './run-chromium/chromium-types'
import {createFirefoxContext} from './run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from './run-firefox/firefox-launch'
import type {FirefoxPluginRuntime} from './run-firefox/firefox-types'

export type {BrowserType, CompilationLike, Controller} from './browsers-types'

/**
 * Options for launching a browser with an extension loaded.
 */
export interface BrowserLaunchOptions {
  browser: BrowserType
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
  // Source inspection options
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
  // Unified logger options
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
}

/**
 * Handle returned by `launchBrowser` — provides reload and logging control.
 */
export interface BrowserController {
  reload(instruction?: {
    type: 'full' | 'service-worker' | 'content-scripts'
    changedContentScriptEntries?: string[]
    changedAssets?: string[]
  }): Promise<void>
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

function createCompilationLike(opts: BrowserLaunchOptions): CompilationLike {
  return {
    options: {
      mode: opts.mode || 'production',
      context: opts.contextDir,
      output: {path: opts.outputPath}
    },
    outputOptions: {path: opts.outputPath}
  }
}

function isChromiumBrowser(browser: BrowserType): boolean {
  return (
    browser === 'chrome' ||
    browser === 'edge' ||
    browser === 'chromium' ||
    browser === 'chromium-based'
  )
}

function isFirefoxBrowser(browser: BrowserType): boolean {
  return (
    browser === 'firefox' ||
    browser === 'gecko-based' ||
    browser === 'firefox-based'
  )
}

/**
 * Launch a browser with the given extension(s) loaded.
 *
 * Returns a `BrowserController` that provides reload and unified-logging control.
 * This is the primary entry point for the CLI orchestration layer — it replaces
 * the old BrowsersPlugin that lived inside the bundler.
 */
export async function launchBrowser(
  opts: BrowserLaunchOptions
): Promise<BrowserController> {
  const compilationLike = createCompilationLike(opts)
  const mode = opts.mode || 'production'

  // Provide shared cache dir guidance for install-hint printing.
  computeBinariesBaseDir(compilationLike)

  if (isChromiumBrowser(opts.browser)) {
    return launchChromium(opts, compilationLike, mode)
  }

  if (isFirefoxBrowser(opts.browser)) {
    return launchFirefox(opts, compilationLike, mode)
  }

  throw new Error(`Unsupported browser: ${String(opts.browser)}`)
}

async function launchChromium(
  opts: BrowserLaunchOptions,
  compilationLike: CompilationLike,
  mode: string
): Promise<BrowserController> {
  const chromiumOpts: ChromiumLaunchOptions = {
    extension: opts.extensionsToLoad,
    browser: opts.browser,
    noOpen: opts.noOpen,
    profile: opts.profile,
    preferences: opts.preferences,
    browserFlags: opts.browserFlags,
    excludeBrowserFlags: opts.excludeBrowserFlags,
    startingUrl: opts.startingUrl,
    chromiumBinary: opts.chromiumBinary,
    instanceId: opts.instanceId,
    port: opts.port,
    dryRun: opts.dryRun,
    source: opts.source,
    watchSource: opts.watchSource,
    sourceFormat: opts.sourceFormat,
    sourceSummary: opts.sourceSummary,
    sourceMeta: opts.sourceMeta,
    sourceProbe: opts.sourceProbe,
    sourceTree: opts.sourceTree,
    sourceConsole: opts.sourceConsole,
    sourceDom: opts.sourceDom,
    sourceMaxBytes: opts.sourceMaxBytes,
    sourceRedact: opts.sourceRedact,
    sourceIncludeShadow: opts.sourceIncludeShadow,
    sourceDiff: opts.sourceDiff,
    logLevel: opts.logLevel as PluginInterface['logLevel'],
    logContexts: opts.logContexts as PluginInterface['logContexts'],
    logFormat: opts.logFormat as PluginInterface['logFormat'],
    logTimestamps: opts.logTimestamps,
    logColor: opts.logColor,
    logUrl: opts.logUrl,
    logTab: opts.logTab
  }

  const ctx = createChromiumContext()
  const launcher = new ChromiumLaunchPlugin(chromiumOpts, ctx)

  // Enable CDP post-launch in dev mode (for reload, logging, source inspection).
  const enableCdp = mode === 'development'
  await launcher.runOnce(compilationLike, {enableCdpPostLaunch: enableCdp})

  // Resolve the CDP controller created during launch (if any).
  let cdpController: Controller | undefined
  if (enableCdp) {
    cdpController = ctx.getController?.()
  }

  return {
    async reload(instruction) {
      if (!cdpController) return
      // For a full reload or service-worker reload, use hardReload.
      // For content-scripts, use targeted tab reload.
      if (instruction?.type === 'content-scripts') {
        const ctrl = cdpController as any
        if (typeof ctrl.reloadMatchingTabsForContentScripts === 'function') {
          await ctrl.reloadMatchingTabsForContentScripts(
            instruction.changedContentScriptEntries || []
          )
          return
        }
      }
      // Default: full hard reload
      const ctrl = cdpController as any
      if (typeof ctrl.hardReload === 'function') {
        await ctrl.hardReload(instruction?.changedAssets)
      }
    },
    async enableUnifiedLogging(logOpts) {
      if (cdpController?.enableUnifiedLogging) {
        await cdpController.enableUnifiedLogging({
          level: logOpts.level,
          contexts: logOpts.contexts,
          format: logOpts.format as 'pretty' | 'json' | 'ndjson',
          timestamps: logOpts.timestamps,
          color: logOpts.color,
          urlFilter: logOpts.urlFilter,
          tabFilter: logOpts.tabFilter
        })
      }
    },
    async close() {
      // Chromium processes are managed by the launcher — close is a no-op
      // for now. The process cleanup is handled by signal handlers set up
      // during launch.
    }
  }
}

async function launchFirefox(
  opts: BrowserLaunchOptions,
  compilationLike: CompilationLike,
  mode: string
): Promise<BrowserController> {
  const firefoxOpts: FirefoxPluginRuntime = {
    extension: opts.extensionsToLoad,
    browser: opts.browser,
    profile: opts.profile,
    preferences: opts.preferences,
    browserFlags: opts.browserFlags,
    startingUrl: opts.startingUrl,
    geckoBinary: opts.geckoBinary,
    instanceId: opts.instanceId,
    port: opts.port,
    dryRun: opts.dryRun
  }

  const pluginOptions = {
    extension: opts.extensionsToLoad,
    browser: opts.browser,
    noOpen: opts.noOpen,
    profile: opts.profile,
    persistProfile: opts.persistProfile,
    preferences: opts.preferences,
    browserFlags: opts.browserFlags || [],
    excludeBrowserFlags: opts.excludeBrowserFlags,
    startingUrl: opts.startingUrl,
    geckoBinary: opts.geckoBinary,
    instanceId: opts.instanceId,
    port: opts.port,
    dryRun: opts.dryRun
  }

  const ctx = createFirefoxContext()
  const launcher = new FirefoxLaunchPlugin(firefoxOpts, ctx)

  const launchRequest = buildBrowserLaunchRequest(
    pluginOptions,
    mode as 'development' | 'production' | 'none',
    {
      persistProfile: opts.persistProfile,
      geckoBinary: opts.geckoBinary
    }
  )

  await launcher.runOnce(compilationLike, launchRequest as any)

  return {
    async reload() {
      // Firefox reload via RDP is currently handled internally during
      // the build event flow. For now, this is a placeholder.
    },
    async enableUnifiedLogging() {
      // Firefox unified logging is wired separately via the RDP controller.
    },
    async close() {
      // Firefox process cleanup handled by signal handlers.
    }
  }
}

// Re-export run-only for backward compatibility with the preview command
export {runOnlyPreviewBrowser} from './run-only'
