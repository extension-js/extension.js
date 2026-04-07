// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors — presence implies inheritance

import type {Compilation} from '@rspack/core'
import type {DevOptions} from '../webpack-types'
import {computeBinariesBaseDir} from './browsers-lib/output-binaries-resolver'
import {printProdBannerOnce} from './browsers-lib/banner'
import {buildBrowserLaunchRequest} from './browsers-lib/runtime-options'
import type {PluginInterface} from './browsers-types'
import {createChromiumContext} from './run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from './run-chromium/chromium-launch'
import type {ChromiumLaunchOptions} from './run-chromium/chromium-types'
import {createFirefoxContext} from './run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from './run-firefox/firefox-launch'
import type {FirefoxPluginRuntime} from './run-firefox/firefox-types'

type PreviewRunOptions = {
  browser: DevOptions['browser']
  outPath: string
  contextDir: string
  // Additional unpacked extension dirs to load before the user extension.
  // (Companion extensions: devtools/theme + user-provided companions)
  extensionsToLoad: string[]
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
  readyPath?: string
}

function createPreviewCompilationLike(opts: PreviewRunOptions): Compilation {
  return {
    options: {
      mode: 'production',
      context: opts.contextDir,
      output: {path: opts.outPath}
    },
    errors: []
  } as any
}

function buildPreviewPluginOptions(opts: PreviewRunOptions): Pick<
  PluginInterface,
  | 'extension'
  | 'browser'
  | 'noOpen'
  | 'profile'
  | 'preferences'
  | 'browserFlags'
  | 'excludeBrowserFlags'
  | 'startingUrl'
  | 'chromiumBinary'
  | 'geckoBinary'
  | 'instanceId'
  | 'port'
  | 'dryRun'
> & {
  persistProfile?: boolean
} {
  return {
    extension: opts.extensionsToLoad,
    browser: opts.browser,
    noOpen: opts.noOpen,
    profile: opts.profile,
    persistProfile: opts.persistProfile,
    preferences: opts.preferences,
    browserFlags: opts.browserFlags,
    excludeBrowserFlags: opts.excludeBrowserFlags,
    startingUrl: opts.startingUrl,
    chromiumBinary: opts.chromiumBinary,
    geckoBinary: opts.geckoBinary,
    instanceId: opts.instanceId,
    port: opts.port,
    dryRun: opts.dryRun
  }
}

function buildPreviewChromiumOptions(
  opts: PreviewRunOptions
): ChromiumLaunchOptions {
  const pluginOptions = buildPreviewPluginOptions(opts)

  return {
    extension: pluginOptions.extension,
    browser: pluginOptions.browser,
    noOpen: pluginOptions.noOpen,
    profile: pluginOptions.profile,
    preferences: pluginOptions.preferences,
    browserFlags: pluginOptions.browserFlags,
    excludeBrowserFlags: pluginOptions.excludeBrowserFlags,
    startingUrl: pluginOptions.startingUrl,
    chromiumBinary: pluginOptions.chromiumBinary,
    instanceId: pluginOptions.instanceId,
    port: pluginOptions.port,
    dryRun: pluginOptions.dryRun
  }
}

function buildPreviewFirefoxOptions(
  opts: PreviewRunOptions
): FirefoxPluginRuntime {
  const pluginOptions = buildPreviewPluginOptions(opts)

  return {
    extension: pluginOptions.extension,
    browser: pluginOptions.browser,
    profile: pluginOptions.profile,
    preferences: pluginOptions.preferences,
    browserFlags: pluginOptions.browserFlags,
    startingUrl: pluginOptions.startingUrl,
    geckoBinary: pluginOptions.geckoBinary,
    instanceId: pluginOptions.instanceId,
    port: pluginOptions.port,
    dryRun: pluginOptions.dryRun
  }
}

function buildPreviewBannerOptions(opts: PreviewRunOptions) {
  return {
    browser: opts.browser,
    outPath: opts.outPath,
    includeExtensionId: true,
    includeRunId: false,
    readyPath: opts.readyPath
  }
}

export async function runOnlyPreviewBrowser(
  opts: PreviewRunOptions
): Promise<void> {
  let exitScheduled = false

  const scheduleExitOnSignal = () => {
    if (exitScheduled) return
    exitScheduled = true
    // Mirror `dev` behavior: exit promptly after cleanup kicks in.
    setTimeout(() => process.exit(0), 10)
  }

  process.once('SIGINT', scheduleExitOnSignal)
  process.once('SIGTERM', scheduleExitOnSignal)
  process.once('SIGHUP', scheduleExitOnSignal)

  const compilationLike = createPreviewCompilationLike(opts)
  const previewPluginOptions = buildPreviewPluginOptions(opts)
  const bannerOptions = buildPreviewBannerOptions(opts)

  // Provide shared cache dir guidance to the runner (pretty install hints).
  // This matches the behavior expected by the chromium launcher guidance printer.
  computeBinariesBaseDir(compilationLike)

  if (
    opts.browser === 'chrome' ||
    opts.browser === 'edge' ||
    opts.browser === 'chromium' ||
    opts.browser === 'chromium-based'
  ) {
    // Run Chromium launch without CDP post-launch wiring (keeps `ws` optional).
    const ctx = createChromiumContext()
    const launcher = new ChromiumLaunchPlugin(
      buildPreviewChromiumOptions(opts),
      ctx
    )
    await launcher.runOnce(compilationLike, {enableCdpPostLaunch: false})
    await printProdBannerOnce(bannerOptions)
    return
  }

  if (
    opts.browser === 'firefox' ||
    opts.browser === 'gecko-based' ||
    opts.browser === 'firefox-based'
  ) {
    const ctx = createFirefoxContext()
    const launcher = new FirefoxLaunchPlugin(
      buildPreviewFirefoxOptions(opts),
      ctx
    )
    await launcher.runOnce(
      compilationLike,
      buildBrowserLaunchRequest(previewPluginOptions, 'production', {
        persistProfile: previewPluginOptions.persistProfile,
        geckoBinary: previewPluginOptions.geckoBinary
      }) as any
    )

    await printProdBannerOnce(bannerOptions)
    return
  }

  throw new Error(`Unsupported browser: ${String(opts.browser)}`)
}
