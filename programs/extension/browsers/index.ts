// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import {
  isChromiumBrowser,
  isFirefoxBrowser
} from './browsers-lib/browser-family'
import {computeBinariesBaseDir} from './browsers-lib/output-binaries-resolver'
import {buildBrowserLaunchRequest} from './browsers-lib/runtime-options'
import type {
  BrowserLogSink,
  BrowserType,
  CompilationLike,
  Controller,
  ExtensionLoadRetryResult,
  PluginInterface
} from './browsers-types'
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
  keepProfileChanges?: boolean
  copyFromProfile?: string
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  startingUrl?: string
  chromiumBinary?: string
  geckoBinary?: string
  instanceId?: string
  port?: number | string
  dryRun?: boolean
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
  /**
   * Host log pipeline for browser-generated CDP `Log.entryAdded` entries
   * (E21). Provided by the dev server so alarm clamps / CSP refusals land in
   * logs.ndjson; Chromium-only (Firefox RDP exposes no equivalent stream).
   */
  logSink?: BrowserLogSink
}

/**
 * Handle returned by `launchBrowser`, provides logging control.
 *
 * Reload is owned by the dev server's control-bridge SW producer (the same
 * executor for launched + `--no-browser`), not this controller; the CDP/RDP
 * controller is kept only for unified logging.
 *
 * Browser process cleanup is owned by signal handlers installed during launch
 * (`setupFirefoxProcessHandlers` / Chromium equivalents). The controller is
 * deliberately not responsible for teardown, so there is no `close()`.
 */
export type {ExtensionLoadRetryResult}

export interface BrowserController {
  enableUnifiedLogging(opts: {
    level?: string
    contexts?: string[]
    format?: 'pretty' | 'json' | 'ndjson'
    timestamps?: boolean
    color?: boolean
    urlFilter?: string
    tabFilter?: number | string
  }): Promise<void>
  /** The browser's refusal reason for this session, or null when it loaded. */
  getExtensionLoadRefusal?(): string | null
  /** Re-offer the current dist. Only ever called while the session is refused. */
  retryExtensionLoad?(): Promise<ExtensionLoadRetryResult>
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

/**
 * Launch a browser with the given extension(s) loaded.
 *
 * Returns a `BrowserController` that provides unified-logging control.
 * This is the primary entry point for the CLI orchestration layer, it replaces
 * the old BrowsersPlugin that lived inside the bundler.
 */
export async function launchBrowser(
  opts: BrowserLaunchOptions
): Promise<BrowserController> {
  const compilationLike = createCompilationLike(opts)
  const mode = opts.mode || 'production'

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
    persistProfile: opts.persistProfile,
    keepProfileChanges: opts.keepProfileChanges,
    copyFromProfile: opts.copyFromProfile,
    preferences: opts.preferences,
    browserFlags: opts.browserFlags,
    excludeBrowserFlags: opts.excludeBrowserFlags,
    startingUrl: opts.startingUrl,
    chromiumBinary: opts.chromiumBinary,
    instanceId: opts.instanceId,
    port: opts.port,
    dryRun: opts.dryRun,
    logLevel: opts.logLevel as PluginInterface['logLevel'],
    logContexts: opts.logContexts as PluginInterface['logContexts'],
    logFormat: opts.logFormat as PluginInterface['logFormat'],
    logTimestamps: opts.logTimestamps,
    logColor: opts.logColor,
    logUrl: opts.logUrl,
    logTab: opts.logTab,
    logSink: opts.logSink
  }

  const ctx = createChromiumContext()
  const launcher = new ChromiumLaunchPlugin(chromiumOpts, ctx)

  const enableCdp = mode === 'development'
  await launcher.runOnce(compilationLike, {enableCdpPostLaunch: enableCdp})

  let cdpController: Controller | undefined
  if (enableCdp) {
    cdpController = ctx.getController?.()
  }

  return {
    getExtensionLoadRefusal() {
      return launcher.getExtensionLoadRefusal()
    },

    // Ask the browser again with whatever is on disk now. verifyGuestLoaded
    // looks for a live target first, so an accepted guest is never restarted.
    async retryExtensionLoad() {
      if (!cdpController?.verifyGuestLoaded) return {status: 'unknown' as const}

      const outcome = await cdpController.verifyGuestLoaded()
      if (outcome.status === 'loaded') {
        launcher.clearExtensionLoadRefusal()
        await launcher.printBannerOnRecovery()
      }
      return outcome
    },

    // Reload is owned by the control-bridge SW producer (same executor for
    // launched + --no-browser); the CDP controller is kept only for logging.
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
    dryRun: opts.dryRun,
    logLevel: opts.logLevel as PluginInterface['logLevel'],
    logContexts: opts.logContexts as PluginInterface['logContexts'],
    logFormat: opts.logFormat as PluginInterface['logFormat'],
    logTimestamps: opts.logTimestamps,
    logColor: opts.logColor,
    logUrl: opts.logUrl,
    logTab: opts.logTab,
    logSink: opts.logSink
  }

  const pluginOptions = {
    extension: opts.extensionsToLoad,
    browser: opts.browser,
    noOpen: opts.noOpen,
    profile: opts.profile,
    persistProfile: opts.persistProfile,
    keepProfileChanges: opts.keepProfileChanges,
    copyFromProfile: opts.copyFromProfile,
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

  await launcher.runOnce(
    compilationLike,
    launchRequest as unknown as Parameters<typeof launcher.runOnce>[1]
  )

  // Resolve the RDP controller created during launch; in dry-run/VITEST paths
  // none is created and reload/logging degrade to no-ops.
  const rdpController = ctx.getController?.()

  return {
    getExtensionLoadRefusal() {
      return firefoxOpts.extensionLoadRefused || null
    },

    // Gecko's install is engine-driven, so the retry is the install itself
    // against whatever is on disk now. Bound at the refusal, absent otherwise.
    async retryExtensionLoad() {
      if (!firefoxOpts.retryAddonInstall) return {status: 'unknown' as const}
      return await firefoxOpts.retryAddonInstall()
    },

    // Reload is owned by the control-bridge SW producer (same executor for
    // launched + --no-browser); the RDP controller is kept only for logging.
    async enableUnifiedLogging(logOpts) {
      if (!rdpController?.enableUnifiedLogging) return
      await rdpController.enableUnifiedLogging({
        level: logOpts.level,
        contexts: logOpts.contexts,
        format: logOpts.format as 'pretty' | 'json' | 'ndjson',
        timestamps: logOpts.timestamps,
        color: logOpts.color,
        urlFilter: logOpts.urlFilter,
        tabFilter: logOpts.tabFilter
      })
    }
  }
}

// Re-export run-only for backward compatibility with the preview command
export {runOnlyPreviewBrowser} from './run-only'
