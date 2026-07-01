// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import {printDevBannerOnce, printProdBannerOnce} from './browsers-lib/banner'
import {computeBinariesBaseDir} from './browsers-lib/output-binaries-resolver'
import {buildBrowserLaunchRequest} from './browsers-lib/runtime-options'
import type {
  BrowserType,
  CompilationLike,
  Controller,
  PluginInterface
} from './browsers-types'
import {isChromiumBrowser, isFirefoxBrowser} from './browsers-lib/browser-family'
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
 * Handle returned by `launchBrowser` — provides logging control.
 *
 * Reload is owned by the dev server's control-bridge SW producer (the same
 * executor for launched + `--no-browser`), not this controller; the CDP/RDP
 * controller is kept only for logging / source inspection.
 *
 * Browser process cleanup is owned by signal handlers installed during launch
 * (`setupFirefoxProcessHandlers` / Chromium equivalents). The controller is
 * deliberately not responsible for teardown, so there is no `close()`.
 */
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
    // Reload is owned by the dev server's control-bridge SW producer (the same
    // executor for launched + `--no-browser`); the CDP controller is kept only
    // for logging / source inspection.
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
    // Unified logger options — consumed by FirefoxRDPController.enableUnifiedLogging
    logLevel: opts.logLevel as PluginInterface['logLevel'],
    logContexts: opts.logContexts as PluginInterface['logContexts'],
    logFormat: opts.logFormat as PluginInterface['logFormat'],
    logTimestamps: opts.logTimestamps,
    logColor: opts.logColor,
    logUrl: opts.logUrl,
    logTab: opts.logTab
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

  await launcher.runOnce(compilationLike, launchRequest as any)

  // Resolve the RDP controller created during launch (when available).
  // In dry-run / VITEST paths launch() short-circuits and no controller
  // is created — reload/logging will degrade to no-ops in that case.
  const rdpController = ctx.getController?.()

  // F3 — front-load the runtime capability probe so the author-mode
  // summary lands once at install rather than on the first content-script
  // edit. Best-effort: if the addon background isn't reachable yet, the
  // probe returns null and the on-edit path fills the cache instead.
  if (
    rdpController &&
    typeof (rdpController as any).probeRuntimeCapability === 'function'
  ) {
    Promise.resolve((rdpController as any).probeRuntimeCapability()).catch(
      () => {
        // Best-effort capability probe; runtime path will degrade gracefully.
      }
    )
  }

  return {
    // Reload is owned by the dev server's control-bridge SW producer (the same
    // executor for launched + `--no-browser`); the RDP controller is kept only
    // for logging / source inspection.
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
