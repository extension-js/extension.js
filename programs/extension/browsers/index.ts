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
import {
  readContentScriptRules,
  selectContentScriptRules,
  type ContentScriptTargetRule
} from './browsers-lib/content-script-targets'
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
 *
 * Browser process cleanup is owned by signal handlers installed during launch
 * (`setupFirefoxProcessHandlers` / Chromium equivalents). The controller is
 * deliberately not responsible for teardown, so there is no `close()`.
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
 * Convert canonical content-script entry names (e.g. `content_scripts/content-0`)
 * into the ContentScriptTargetRule[] shape that the browser controllers expect.
 *
 * `develop/plugin-browsers` only has raw entry paths at reload time; the
 * manifest (and therefore the match patterns those entries correspond to)
 * lives on the compilation. Resolving it here keeps the controller APIs
 * strongly typed and prevents silent HMR failures where rules/entries were
 * passed interchangeably.
 */
function resolveContentScriptRulesForReload(
  compilationLike: CompilationLike,
  extensionsToLoad: string[],
  entries: string[] | undefined
): ContentScriptTargetRule[] {
  if (!entries || entries.length === 0) return []

  // The user's extension is the one the reload is for. When dev loads
  // companion extensions (extension-js-devtools, extension-js-theme, etc.), they
  // appear first in `extensionsToLoad` — using `extensionsToLoad[0]` here
  // reads the companion's manifest, which declares a single narrow content
  // script, and every rule for the user's extension is silently dropped.
  // Prefer the actual output path (the user's dist) and fall back only if it
  // isn't known
  const outputPath = (compilationLike as any)?.options?.output?.path as
    | string
    | undefined
  const extensionRoot = outputPath || extensionsToLoad?.[0]
  const rules = readContentScriptRules(compilationLike, extensionRoot)
  return selectContentScriptRules(rules, entries)
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
      // For content-scripts, resolve entries → rules and use targeted reload.
      // For everything else, fall through to a full hard reload.
      if (instruction?.type === 'content-scripts') {
        const ctrl = cdpController as any
        if (typeof ctrl.reloadMatchingTabsForContentScripts === 'function') {
          const rules = resolveContentScriptRulesForReload(
            compilationLike,
            opts.extensionsToLoad,
            instruction.changedContentScriptEntries
          )
          // 1. In-place reinject into tabs that already have the content
          //    script running (Surface A' — preserves DOM/React state).
          await ctrl.reloadMatchingTabsForContentScripts(rules)
          // 2. Register a persistent CDP hook so fresh tabs, page reloads,
          //    and cross-URL navigations get the latest bundle evaluated in
          //    the extension's isolated world the moment it's created
          //    (Surfaces B + C). Preserves SW state + open extension pages.
          if (
            typeof ctrl.registerContentScriptsForFutureNavigations ===
            'function'
          ) {
            try {
              await ctrl.registerContentScriptsForFutureNavigations(rules)
            } catch {
              // Best-effort: open-tab reinjection already happened above.
            }
          }
          // 3. Re-execute any programmatic `chrome.scripting.executeScript`
          //    calls that referenced a changed `/scripts/<name>.js` file.
          //    Declarative content_scripts handle their own HMR via the
          //    reinject above; this brings programmatic injection closer to
          //    parity. No-op when no /scripts/* file changed or when the
          //    user's SW never called executeScript.
          const changedScripts = (instruction.changedAssets || []).filter(
            (asset) =>
              /(^|\/)scripts\//i.test(String(asset || '')) &&
              /\.[cm]?[jt]sx?$/i.test(String(asset || ''))
          )
          if (
            changedScripts.length > 0 &&
            typeof ctrl.replayProgrammaticScripts === 'function'
          ) {
            try {
              await ctrl.replayProgrammaticScripts(changedScripts)
            } catch {
              // Best-effort; the dist-on-disk is already fresh.
            }
          }
          return
        }
      }
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
    // Source inspection — forwarded to FirefoxRDPController via
    // setup-rdp-after-launch so that Firefox reaches parity with Chromium.
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
    async reload(instruction) {
      if (!rdpController) return
      if (instruction?.type === 'content-scripts') {
        const rules = resolveContentScriptRulesForReload(
          compilationLike,
          opts.extensionsToLoad,
          instruction.changedContentScriptEntries
        )
        try {
          await (rdpController as any).reloadMatchingTabsForContentScripts(
            rules
          )
          // F2 — after the in-place reinject, register a tabNavigated hook
          // so fresh tabs and same-tab navigations between rebuilds get the
          // current bundle without waiting for the next file edit. Mirrors
          // the Chromium launcher path at line 263.
          if (
            typeof (rdpController as any)
              .registerContentScriptsForFutureNavigations === 'function'
          ) {
            try {
              await (
                rdpController as any
              ).registerContentScriptsForFutureNavigations(rules)
            } catch {
              // Best-effort: open-tab reinjection already happened above.
            }
          }
          return
        } catch {
          // Fall through to hard reload
        }
      }
      try {
        await rdpController.hardReload(
          compilationLike,
          instruction?.changedAssets || []
        )
      } catch {
        // best-effort
      }
    },
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
