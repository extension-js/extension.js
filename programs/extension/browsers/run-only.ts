// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {CODES, hasChannelPrefix} from '../helpers/messaging'
import {printProdBannerOnce} from './browsers-lib/banner'
import {
  isChromiumBrowser,
  isFirefoxBrowser
} from './browsers-lib/browser-family'
import {browserNeverStarted} from './browsers-lib/messages'
import {computeBinariesBaseDir} from './browsers-lib/output-binaries-resolver'
import {
  claimReadyPath,
  describeLaunchFailure,
  launchFailureCode,
  readReadyRunId,
  stampReadyBrowserLaunchFailed
} from './browsers-lib/ready-stamp'
import {buildBrowserLaunchRequest} from './browsers-lib/runtime-options'
import {
  isVersionProbeTimeout,
  probeChromiumBinaryVersion,
  probeGeckoBinaryVersion
} from './browsers-lib/version-probe'
import type {
  BrowserType,
  CompilationLike,
  PluginInterface
} from './browsers-types'
import {createChromiumContext} from './run-chromium/chromium-context'
import {ChromiumLaunchPlugin} from './run-chromium/chromium-launch'
import type {ChromiumLaunchOptions} from './run-chromium/chromium-types'
import {createFirefoxContext} from './run-firefox/firefox-context'
import {FirefoxLaunchPlugin} from './run-firefox/firefox-launch'
import type {FirefoxPluginRuntime} from './run-firefox/firefox-types'

type PreviewRunOptions = {
  browser: BrowserType
  outPath: string
  contextDir: string
  // Additional unpacked extension dirs to load before the user extension.
  // (Companion extensions: devtools/theme + user-provided companions)
  extensionsToLoad: string[]
  noOpen?: boolean
  profile?: string | false
  profileSource?: 'flag' | 'config'
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
  logLevel?: string
  logContexts?: string[]
  logFormat?: 'pretty' | 'json' | 'ndjson'
  logTimestamps?: boolean
  logColor?: boolean
  logUrl?: string
  logTab?: number | string
  // `start` runs the same launch, and its own name belongs on its lines.
  command?: 'preview' | 'start'
}

function createPreviewCompilationLike(
  opts: PreviewRunOptions
): CompilationLike {
  return {
    options: {
      mode: 'production',
      context: opts.contextDir,
      output: {path: opts.outPath}
    },
    errors: []
  } as unknown as CompilationLike
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
  | 'logLevel'
  | 'logContexts'
  | 'logFormat'
  | 'logTimestamps'
  | 'logColor'
  | 'logUrl'
  | 'logTab'
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
    dryRun: opts.dryRun,
    logLevel: opts.logLevel as PluginInterface['logLevel'],
    logContexts: opts.logContexts as PluginInterface['logContexts'],
    logFormat: opts.logFormat,
    logTimestamps: opts.logTimestamps,
    logColor: opts.logColor,
    logUrl: opts.logUrl,
    logTab: opts.logTab
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
    dryRun: pluginOptions.dryRun,
    logLevel: pluginOptions.logLevel,
    logContexts: pluginOptions.logContexts,
    logFormat: pluginOptions.logFormat,
    logTimestamps: pluginOptions.logTimestamps,
    logColor: pluginOptions.logColor,
    logUrl: pluginOptions.logUrl,
    logTab: pluginOptions.logTab
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
    profileSource: opts.profileSource,
    preferences: pluginOptions.preferences,
    browserFlags: pluginOptions.browserFlags,
    startingUrl: pluginOptions.startingUrl,
    noOpen: pluginOptions.noOpen,
    geckoBinary: pluginOptions.geckoBinary,
    instanceId: pluginOptions.instanceId,
    port: pluginOptions.port,
    dryRun: pluginOptions.dryRun,
    logLevel: pluginOptions.logLevel,
    logContexts: pluginOptions.logContexts,
    logFormat: pluginOptions.logFormat,
    logTimestamps: pluginOptions.logTimestamps,
    logColor: pluginOptions.logColor,
    logUrl: pluginOptions.logUrl,
    logTab: pluginOptions.logTab
  }
}

function pinnedBinaryPath(opts: PreviewRunOptions): string | undefined {
  const pinned = isFirefoxBrowser(opts.browser)
    ? opts.geckoBinary
    : opts.chromiumBinary

  return typeof pinned === 'string' && fs.existsSync(pinned)
    ? pinned
    : undefined
}

// The card renders before the launch now, so it cannot lean on the version the
// launcher resolves. A pinned binary is the one case the card's own probe gets
// wrong: it would name the system browser instead of the one being run.
async function resolvePinnedBinaryVersionLine(
  opts: PreviewRunOptions
): Promise<string | undefined> {
  const pinned = pinnedBinaryPath(opts)
  if (!pinned) return undefined

  try {
    // Ask the binary the way the launcher does. Metadata alone misses a
    // binary outside an app bundle and the card fell back to another install.
    const line = isFirefoxBrowser(opts.browser)
      ? await probeGeckoBinaryVersion(pinned)
      : await probeChromiumBinaryVersion(pinned, String(opts.browser))

    return line || undefined
  } catch (error) {
    // The launch would ask the same binary again and wait as long.
    if (isVersionProbeTimeout(error)) throw error

    return undefined
  }
}

async function buildPreviewBannerOptions(opts: PreviewRunOptions) {
  const pinned = pinnedBinaryPath(opts)

  return {
    browser: opts.browser,
    outPath: opts.outPath,
    includeExtensionId: true,
    includeRunId: false,
    readyPath: opts.readyPath,
    browserVersionLine: await resolvePinnedBinaryVersionLine(opts),
    ...(pinned
      ? {
          binaryPath: pinned,
          binaryProvenance: 'pinned' as const
        }
      : {})
  }
}

// A launch that never produced a process is a refusal this command frames.
// Left bare it reached the sink as a Node spawn error printed with a stack.
function asLaunchFailure(
  error: unknown,
  browser: BrowserType,
  spawned: boolean
): unknown {
  const message = error instanceof Error ? error.message : String(error)

  // A browser that came up, or a refusal already framed or coded, keeps its
  // own words.
  if (spawned || hasChannelPrefix(message) || launchFailureCode(error)) {
    return error
  }

  return Object.assign(
    new Error(browserNeverStarted(browser, describeLaunchFailure(error))),
    {code: CODES.E_BROWSER_LAUNCH, cause: error}
  )
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

  // Every stamp the launchers write lands on the contract this session owns,
  // which is not beside the loaded directory when that is a source folder.
  claimReadyPath(opts.outPath, opts.readyPath)

  const compilationLike = createPreviewCompilationLike(opts)
  const previewPluginOptions = buildPreviewPluginOptions(opts)
  let bannerOptions: Awaited<ReturnType<typeof buildPreviewBannerOptions>>

  try {
    bannerOptions = await buildPreviewBannerOptions(opts)
  } catch (error) {
    // The card probes a pin before any launcher runs, so a refusal here owes
    // the contract the same verdict a launcher would have stamped.
    stampReadyBrowserLaunchFailed(
      opts.outPath,
      describeLaunchFailure(error),
      readReadyRunId(opts.outPath),
      launchFailureCode(error)
    )

    throw error
  }

  // Provide shared cache dir guidance to the runner (pretty install hints).
  // This matches the behavior expected by the chromium launcher guidance printer.
  computeBinariesBaseDir(compilationLike)

  if (isChromiumBrowser(opts.browser)) {
    // Run Chromium launch without CDP post-launch wiring (keeps `ws` optional).
    // Chromium forks (brave/opera/vivaldi/yandex) route here too.
    const ctx = createChromiumContext()
    const launcher = new ChromiumLaunchPlugin(
      buildPreviewChromiumOptions(opts),
      ctx
    )
    // Identity before the launch: the card is the header for the session, not
    // a summary trailing the browser it describes.
    await printProdBannerOnce(bannerOptions)

    try {
      await launcher.runOnce(compilationLike, {
        enableCdpPostLaunch: false,
        sessionCommand: opts.command
      })
    } catch (error) {
      throw asLaunchFailure(error, opts.browser, launcher.spawnedBrowser)
    }

    return
  }

  if (isFirefoxBrowser(opts.browser)) {
    // Gecko forks (waterfox/librewolf) route here too.
    const ctx = createFirefoxContext()
    const launcher = new FirefoxLaunchPlugin(
      buildPreviewFirefoxOptions(opts),
      ctx
    )
    // Identity before the launch here too: the add-on install still verifies
    // through the banner's nameability verdict, which survives a dedupe hit.
    await printProdBannerOnce(bannerOptions)

    try {
      await launcher.runOnce(
        compilationLike,
        buildBrowserLaunchRequest(previewPluginOptions, 'production', {
          persistProfile: previewPluginOptions.persistProfile,
          geckoBinary: previewPluginOptions.geckoBinary
        }) as unknown as Parameters<typeof launcher.runOnce>[1]
      )
    } catch (error) {
      throw asLaunchFailure(error, opts.browser, launcher.spawnedBrowser)
    }

    return
  }

  throw new Error(`Unsupported browser: ${String(opts.browser)}`)
}
