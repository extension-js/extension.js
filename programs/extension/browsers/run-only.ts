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
  keepProfileChanges?: boolean
  copyFromProfile?: string
  preferences?: Record<string, unknown>
  browserFlags?: string[]
  excludeBrowserFlags?: string[]
  startingUrl?: string
  chromiumBinary?: string
  geckoBinary?: string
  chromiumBinarySource?: string
  geckoBinarySource?: string
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
  keepProfileChanges?: boolean
  copyFromProfile?: string
} {
  return {
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
    keepProfileChanges: pluginOptions.keepProfileChanges,
    copyFromProfile: pluginOptions.copyFromProfile,
    preferences: pluginOptions.preferences,
    browserFlags: pluginOptions.browserFlags,
    excludeBrowserFlags: pluginOptions.excludeBrowserFlags,
    startingUrl: pluginOptions.startingUrl,
    chromiumBinary: pluginOptions.chromiumBinary,
    chromiumBinarySource: opts.chromiumBinarySource,
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
    persistProfile: pluginOptions.persistProfile,
    keepProfileChanges: pluginOptions.keepProfileChanges,
    copyFromProfile: pluginOptions.copyFromProfile,
    preferences: pluginOptions.preferences,
    browserFlags: pluginOptions.browserFlags,
    startingUrl: pluginOptions.startingUrl,
    noOpen: pluginOptions.noOpen,
    geckoBinary: pluginOptions.geckoBinary,
    geckoBinarySource: opts.geckoBinarySource,
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

function requestedBinaryPin(opts: PreviewRunOptions): string | undefined {
  const pinned = isFirefoxBrowser(opts.browser)
    ? opts.geckoBinary
    : opts.chromiumBinary

  return typeof pinned === 'string' && pinned ? pinned : undefined
}

function pinnedBinaryPath(opts: PreviewRunOptions): string | undefined {
  const pinned = requestedBinaryPin(opts)

  return pinned && fs.existsSync(pinned) ? pinned : undefined
}

// The config key that pinned the binary this browser runs, when one did.
function pinnedBinarySource(opts: PreviewRunOptions): string | undefined {
  return isFirefoxBrowser(opts.browser)
    ? opts.geckoBinarySource
    : opts.chromiumBinarySource
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
      ? await probeGeckoBinaryVersion(
          pinned,
          undefined,
          pinnedBinarySource(opts)
        )
      : await probeChromiumBinaryVersion(
          pinned,
          String(opts.browser),
          undefined,
          pinnedBinarySource(opts)
        )

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
    // A pin that names no file is still the only binary this run may use,
    // so the card reads no other install's version before the refusal.
    ...(requestedBinaryPin(opts)
      ? {
          ...(pinned ? {binaryPath: pinned} : {}),
          binaryProvenance: 'pinned' as const,
          binaryPinnedBy: pinnedBinarySource(opts)
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
  // Settles once the browser is gone, so the caller gives back what the
  // session held in a host that goes on running.
  ended?: Promise<void>
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

const BROWSER_GONE_POLL_MS = 250

// A launch that spawned nothing has no browser to wait for. The beat never
// keeps the process alive by itself.
function untilBrowserGone(launcher: LaunchedBrowser): Promise<void> {
  return new Promise<void>((resolve) => {
    const isGone = () => !launcher.spawnedBrowser || launcher.browserClosed

    if (isGone()) {
      resolve()

      return
    }

    const beat = setInterval(() => {
      if (!isGone()) return

      clearInterval(beat)
      resolve()
    }, BROWSER_GONE_POLL_MS)

    beat.unref?.()
  })
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

  const session: SessionOnSignal = {}

  holdSessionSignals(session)

  try {
    const started = await launchPreviewSession(opts, (launched) => {
      session.launcher = launched
    })

    if (stopAsked) return untilTheStopExits()

    session.settled = true

    return started
  } catch (error) {
    // The stop ended a browser that was still starting, which its launcher
    // reads as a failed launch. The run ends as stopped, so this says nothing.
    if (stopAsked) return untilTheStopExits()

    // No session came of this call, so it no longer holds the listeners.
    // After a launch it does: they are what ends the session on Ctrl+C.
    releaseSessionSignals(session)

    throw error
  }
}

interface SessionOnSignal {
  launcher?: LaunchedBrowser
  // The launch returned, so a browser that is not running will not start.
  settled?: boolean
}

// One listener per signal serves every session of the process, so a caller
// that runs preview again in the same process adds none.
const sessionsOnSignal = new Set<SessionOnSignal>()
let signalHandler: (() => void) | undefined
// True from the first signal on: the handler below then owns the exit.
let stopAsked = false

// Never settles. The signal handler exits the process within its deadline,
// and a result handed back before that would be reported as a second ending.
function untilTheStopExits(): Promise<never> {
  return new Promise<never>(() => {})
}

function isRunning(session: SessionOnSignal) {
  return Boolean(
    session.launcher?.spawnedBrowser && !session.launcher.browserClosed
  )
}

// The launchers ask the browser to stop on the same signal. Exiting before
// it closes would SIGKILL it at once, so the exit waits for the close.
function createSignalHandler() {
  let exitScheduled = false

  stopAsked = false

  return () => {
    if (exitScheduled) {
      process.exit(0)

      return
    }

    exitScheduled = true
    stopAsked = true
    const deadline = Date.now() + EXIT_DEADLINE_MS

    const exitOnceClosed = () => {
      if (![...sessionsOnSignal].some(isRunning) || Date.now() >= deadline) {
        process.exit(0)

        return
      }

      setTimeout(exitOnceClosed, EXIT_POLL_MS)
    }

    setTimeout(exitOnceClosed, 10)
  }
}

function holdSessionSignals(session: SessionOnSignal) {
  // A session with no browser running has nothing left to wait for.
  for (const other of sessionsOnSignal) {
    if (other.settled && !isRunning(other)) sessionsOnSignal.delete(other)
  }

  sessionsOnSignal.add(session)

  if (signalHandler && process.listeners('SIGINT').includes(signalHandler)) {
    return
  }

  signalHandler = createSignalHandler()

  for (const signal of SESSION_SIGNALS) {
    process.on(signal, signalHandler)
  }
}

function releaseSessionSignals(session: SessionOnSignal) {
  sessionsOnSignal.delete(session)

  if (sessionsOnSignal.size > 0 || !signalHandler) return

  for (const signal of SESSION_SIGNALS) {
    process.removeListener(signal, signalHandler)
  }

  signalHandler = undefined
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

    return {ended: untilBrowserGone(launcher)}
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
    ended: untilBrowserGone(launcher),
    async wakeBackground() {
      const controller = ctx.getController?.()
      if (!controller) return false

      return await controller.wakeBackground(WAKE_BACKGROUND_TIMEOUT_MS)
    }
  }
}
