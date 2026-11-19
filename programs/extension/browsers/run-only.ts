// ██████╗ ██████╗  ██████╗ ██╗    ██╗███████╗███████╗██████╗ ███████╗
// ██╔══██╗██╔══██╗██╔═══██╗██║    ██║██╔════╝██╔════╝██╔══██╗██╔════╝
// ██████╔╝██████╔╝██║   ██║██║ █╗ ██║███████╗█████╗  ██████╔╝███████╗
// ██╔══██╗██╔══██╗██║   ██║██║███╗██║╚════██║██╔══╝  ██╔══██╗╚════██║
// ██████╔╝██║  ██║╚██████╔╝╚███╔███╔╝███████║███████╗██║  ██║███████║
// ╚═════╝ ╚═╝  ╚═╝ ╚═════╝  ╚══╝╚══╝ ╚══════╝╚══════╝╚═╝  ╚═╝╚══════╝
// MIT License (c) 2020–present Cezar Augusto & the Extension.js authors, presence implies inheritance

import * as fs from 'node:fs'
import {CODES, hasChannelPrefix, humanWarn} from '../helpers/messaging'
import {printProdBannerOnce} from './browsers-lib/banner'
import {
  isChromiumBrowser,
  isFirefoxBrowser
} from './browsers-lib/browser-family'
import {builtBackgroundNamesRegistration} from './browsers-lib/built-boot-registrations'
import {
  claimDebugPortNear,
  type DebugPortClaim
} from './browsers-lib/debug-port-claim'
import {findIgnoredHostPermissionPatterns} from './browsers-lib/manifest-refusal'
import {
  browserNeverStarted,
  hostPermissionPatternsIgnored,
  runOnlyUnsupportedBrowser
} from './browsers-lib/messages'
import {computeBinariesBaseDir} from './browsers-lib/output-binaries-resolver'
import {FORCE_KILL_GRACE_MS} from './browsers-lib/process-teardown'
import {
  claimReadyPath,
  clearReadyCdpPort,
  describeLaunchFailure,
  launchFailureCode,
  readReadyRunId,
  stampReadyBrowserLaunchFailed,
  stampReadyCdpPort
} from './browsers-lib/ready-stamp'
import {
  buildBrowserLaunchRequest,
  resolveStartingUrl
} from './browsers-lib/runtime-options'
import {deriveDebugPortWithInstance} from './browsers-lib/shared-utils'
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
  // The build as it ships, when the browser is handed a copy of it that
  // carries the control channel. Read to learn what the author's code names.
  shippedPath?: string
}

// Asked only when a page will open: nothing else is held on the answer.
function holdsOnBuiltRegistrations(opts: PreviewRunOptions): boolean {
  if (!resolveStartingUrl(opts)) return false

  return builtBackgroundNamesRegistration(opts.shippedPath || opts.outPath)
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
    persistProfile: pluginOptions.persistProfile,
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
    logTab: pluginOptions.logTab,
    bootRegistrationsFromBackground: holdsOnBuiltRegistrations(opts)
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
    logTab: pluginOptions.logTab,
    bootRegistrationsFromBackground: holdsOnBuiltRegistrations(opts)
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

// Long enough for the debugger to greet and the parent process to answer.
const WAKE_BACKGROUND_TIMEOUT_MS = 3000

export interface PreviewBrowserSession {
  wakeBackground?(): Promise<boolean>
}

// Preview builds nothing, so no build warned about what it loads. Firefox
// drops such a pattern in silence, the way Chrome does.
export function warnIgnoredHostPermissionPatterns(opts: {
  outPath: string
  command?: 'preview' | 'start'
}): void {
  if (opts.command === 'start') return

  try {
    const patterns = findIgnoredHostPermissionPatterns(
      JSON.parse(fs.readFileSync(`${opts.outPath}/manifest.json`, 'utf8'))
    )

    if (patterns.length) {
      humanWarn(hostPermissionPatternsIgnored(opts.outPath, patterns))
    }
  } catch {
    // An unreadable manifest is the browser's to report.
  }
}

const SESSION_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'] as const

// Past the stop grace period, so a browser that ignored the ask has been
// killed by then. Polled at this interval until the browser is gone.
const EXIT_DEADLINE_MS = FORCE_KILL_GRACE_MS + 500
const EXIT_POLL_MS = 50

interface LaunchedBrowser {
  spawnedBrowser: boolean
  browserClosed: boolean
}

export async function runOnlyPreviewBrowser(
  opts: PreviewRunOptions
): Promise<PreviewBrowserSession | undefined> {
  // Refused before anything is registered or written for the session.
  if (!isChromiumBrowser(opts.browser) && !isFirefoxBrowser(opts.browser)) {
    throw Object.assign(
      new Error(runOnlyUnsupportedBrowser(String(opts.browser))),
      {code: CODES.E_UNSUPPORTED_BROWSER}
    )
  }

  let exitScheduled = false
  let launcher: LaunchedBrowser | undefined

  // The launchers ask the browser to stop on the same signal. Exiting before
  // it closes would SIGKILL it at once, so the exit waits for the close.
  const scheduleExitOnSignal = () => {
    if (exitScheduled) {
      process.exit(0)

      return
    }

    exitScheduled = true
    const deadline = Date.now() + EXIT_DEADLINE_MS

    const exitOnceClosed = () => {
      const running = launcher?.spawnedBrowser && !launcher.browserClosed

      if (!running || Date.now() >= deadline) {
        process.exit(0)

        return
      }

      setTimeout(exitOnceClosed, EXIT_POLL_MS)
    }

    setTimeout(exitOnceClosed, 10)
  }

  for (const signal of SESSION_SIGNALS) {
    process.on(signal, scheduleExitOnSignal)
  }

  try {
    return await launchPreviewSession(opts, (launched) => {
      launcher = launched
    })
  } catch (error) {
    // No session came of this call, so its listeners have nothing to end.
    // After a launch they stay: they are what ends the session on Ctrl+C.
    for (const signal of SESSION_SIGNALS) {
      process.removeListener(signal, scheduleExitOnSignal)
    }

    throw error
  }
}

async function launchPreviewSession(
  opts: PreviewRunOptions,
  onLauncher: (launcher: LaunchedBrowser) => void
): Promise<PreviewBrowserSession | undefined> {
  // Every stamp the launchers write lands on the contract this session owns,
  // which is not beside the loaded directory when that is a source folder.
  claimReadyPath(opts.outPath, opts.readyPath)
  // Read once here: read again at each stamp it names whoever owns the record
  // by then, so a run that replaced this one would be written over.
  const runId = readReadyRunId(opts.outPath)

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
      runId,
      launchFailureCode(error)
    )

    throw error
  }

  // Provide shared cache dir guidance to the runner (pretty install hints).
  // This matches the behavior expected by the chromium launcher guidance printer.
  computeBinariesBaseDir(compilationLike)

  if (isChromiumBrowser(opts.browser)) {
    // No reload wiring here, only the load check that tells the contract
    // whether the browser took the guest. Chromium forks route here too.
    const ctx = createChromiumContext()
    const chromiumOptions = buildPreviewChromiumOptions(opts)
    const launcher = new ChromiumLaunchPlugin(chromiumOptions, ctx)
    onLauncher(launcher)
    // A reader waits for the card, so the port is claimed and on the record
    // before it prints. The launch clears it if the browser opens none.
    let debugPortClaim: DebugPortClaim | undefined

    try {
      debugPortClaim = opts.dryRun
        ? undefined
        : await claimDebugPortNear(
            deriveDebugPortWithInstance(
              chromiumOptions.port,
              chromiumOptions.instanceId
            )
          )
    } catch (error) {
      // No launcher runs to stamp it, so the refusal is recorded here.
      stampReadyBrowserLaunchFailed(
        opts.outPath,
        describeLaunchFailure(error),
        runId,
        launchFailureCode(error)
      )

      throw error
    }

    if (debugPortClaim) {
      stampReadyCdpPort(opts.outPath, debugPortClaim.port, runId)
    }

    // Identity before the launch: the card is the header for the session, not
    // a summary trailing the browser it describes.
    await printProdBannerOnce(bannerOptions)

    try {
      await launcher.runOnce(compilationLike, {
        enableCdpPostLaunch: false,
        sessionCommand: opts.command,
        debugPortClaim
      })
    } catch (error) {
      debugPortClaim?.release()

      if (!launcher.spawnedBrowser) {
        clearReadyCdpPort(opts.outPath, runId)
      }

      throw asLaunchFailure(error, opts.browser, launcher.spawnedBrowser)
    }

    return
  }

  // Gecko forks (waterfox/librewolf) route here too.
  const ctx = createFirefoxContext()
  const launcher = new FirefoxLaunchPlugin(
    buildPreviewFirefoxOptions(opts),
    ctx
  )
  onLauncher(launcher)
  // Identity before the launch here too: the add-on install still verifies
  // through the banner's nameability verdict, which survives a dedupe hit.
  await printProdBannerOnce(bannerOptions)

  warnIgnoredHostPermissionPatterns(opts)

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

  // Firefox suspends an idle event page and the control producer with it,
  // so a start session's bridge asks for it back the way dev's does.
  return {
    async wakeBackground() {
      const controller = ctx.getController?.()
      if (!controller) return false

      return await controller.wakeBackground(WAKE_BACKGROUND_TIMEOUT_MS)
    }
  }
}
