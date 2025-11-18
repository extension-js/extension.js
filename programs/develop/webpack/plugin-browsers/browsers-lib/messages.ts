import colors from 'pintor'
import * as path from 'path'
import type {DevOptions} from '../../webpack-types'

type Browser = NonNullable<DevOptions['browser']>
type Mode = DevOptions['mode']

// Prefix candidates (try swapping if desired): '►', '›', '→', '—'
function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success') {
  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('►►►')
  if (type === 'info') return colors.gray('►►►')
  return colors.green('►►►')
}

function errorDetail(error: unknown) {
  if (process.env.EXTENSION_DEBUG === '1') return String(error)
  const maybe = (error as {message?: string} | undefined)?.message
  return String(maybe || error)
}

export function capitalizedBrowserName(browser: Browser) {
  return colors.yellow(`${browser.charAt(0).toUpperCase() + browser.slice(1)}`)
}

export function creatingUserProfile(profilePath: string) {
  return `${getLoggingPrefix('info')} Creating a fresh user profile at ${colors.underline(profilePath)}...`
}

export function browserInstanceAlreadyRunning(browser: Browser) {
  return `${getLoggingPrefix('success')} ${capitalizedBrowserName(browser)} instance already running.`
}

export function browserInstanceExited(browser: Browser) {
  return `${getLoggingPrefix('info')} ${capitalizedBrowserName(browser)} instance exited.`
}

export function stdoutData(browser: Browser, mode: Mode) {
  const extensionOutput =
    browser === 'firefox' || browser === 'gecko-based' ? 'Add-on' : 'Extension'
  return `${getLoggingPrefix('info')} ${capitalizedBrowserName(browser)} ${extensionOutput} running in ${colors.green(mode || 'unknown')} mode.`
}

export function cdpClientAttachedToTarget(
  sessionId: string,
  targetType: string
) {
  return `${getLoggingPrefix('info')} Attached to target: ${targetType} (session ${sessionId})`
}

export function cdpPendingRejectFailed(message: string) {
  return `[CDP] Pending request reject failed: ${message}`
}

export function cdpFailedToHandleMessage(message: string) {
  return `[CDP] Failed to handle message: ${message}`
}

export function cdpAutoAttachSetupFailed(message: string) {
  return `[CDP] Failed to set discover/autoAttach: ${message}`
}

export function cdpProtocolEventHandlerError(message: string) {
  return `[CDP] Protocol event handler error: ${message}`
}

export function cdpFallbackManifestReadFailed(message: string) {
  return `[CDP] Fallback manifest read failed: ${message}`
}

export function bannerEventHandlerFailed(message: string) {
  return `[plugin-browsers] Banner event handler failed: ${message}`
}

export function bestEffortBannerPrintFailed(message: string) {
  return `[plugin-browsers] Best-effort banner print failed: ${message}`
}

export function firefoxUnifiedLoggingFailed(message: string) {
  return `[firefox] enableUnifiedLogging failed: ${message}`
}

export function firefoxRdpReloadCapabilitySummary(
  mode: 'native' | 'reinstall'
) {
  const txt = mode === 'native' ? 'native reloadAddon' : 'reinstall fallback'
  return `${getLoggingPrefix('info')} Firefox RDP reload: ${txt}`
}

export function rdpAddTabFailed(message: string) {
  return `[RDP] addTab failed: ${message}`
}

export function skippingBrowserLaunchDueToCompileErrors() {
  return `${getLoggingPrefix('warn')} Skipping browser launch due to compile errors`
}

export function manifestPreflightSummary(errorCount: number) {
  return `${getLoggingPrefix('warn')} Preflight manifest/asset check found ${errorCount} error(s)`
}

export function browserNotInstalledError(
  browser: Browser,
  browserBinaryLocation: string
) {
  const isUnreachable =
    browserBinaryLocation == 'null'
      ? `Browser ${capitalizedBrowserName(browser)} is not installed\n`
      : `Can't find the path for browser ${capitalizedBrowserName(browser)}\n`

  return (
    `${getLoggingPrefix('error')} ${isUnreachable}` +
    `Either install the missing browser or choose a different one via ` +
    `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}.\n\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(browserBinaryLocation || capitalizedBrowserName(browser) + 'BROWSER')}`
  )
}

export function installDifferentBrowserHint() {
  return (
    `Either install the missing browser or choose a different one via ` +
    `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}.`
  )
}

export function injectingAddOnsError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Can't inject extensions into ${capitalizedBrowserName(browser)} profile\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function firefoxServiceWorkerError(browser: Browser) {
  return (
    `${getLoggingPrefix('error')} No Service Worker Support for ${capitalizedBrowserName(browser)}\n` +
    `Firefox does not support the ${colors.yellow(
      'background.service_worker'
    )} field yet.\n` +
    `Update your ${colors.yellow('manifest.json')} file to use ${colors.yellow(
      'background.scripts'
    )} instead.\n` +
    `Read more: ${colors.underline('https://bugzilla.mozilla.org/show_bug.cgi?id=1573659')}.`
  )
}

export function browserLaunchError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Error launching ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

// Process Management messages
export function enhancedProcessManagementStarting(browser: Browser) {
  return `${getLoggingPrefix('info')} Process Management starting for ${capitalizedBrowserName(browser)}`
}

export function enhancedProcessManagementCleanup(browser: Browser) {
  return `${getLoggingPrefix('info')} Process Management cleanup for ${capitalizedBrowserName(browser)}`
}

export function enhancedProcessManagementTerminating(browser: Browser) {
  return `${getLoggingPrefix('info')} Terminating ${capitalizedBrowserName(browser)} process gracefully`
}

export function enhancedProcessManagementForceKill(browser: Browser) {
  return `${getLoggingPrefix('error')} Force killing ${capitalizedBrowserName(browser)} process after timeout`
}

export function enhancedProcessManagementCleanupError(
  browser: Browser,
  error: unknown
) {
  return (
    `${getLoggingPrefix('error')} Error during ${capitalizedBrowserName(browser)} cleanup:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementInstanceCleanup(browser: Browser) {
  return `${getLoggingPrefix('info')} Cleaning up ${capitalizedBrowserName(browser)} instance`
}

export function enhancedProcessManagementInstanceCleanupComplete(
  browser: Browser
) {
  return `${getLoggingPrefix('success')} ${capitalizedBrowserName(browser)} instance cleanup completed`
}

export function enhancedProcessManagementSignalHandling(browser: Browser) {
  return `${getLoggingPrefix('info')} Enhanced signal handling enabled for ${capitalizedBrowserName(browser)}`
}

export function enhancedProcessManagementUncaughtException(
  browser: Browser,
  error: unknown
) {
  return (
    `${getLoggingPrefix('error')} Uncaught exception in ${capitalizedBrowserName(browser)} process:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function enhancedProcessManagementUnhandledRejection(
  browser: Browser,
  reason: unknown
) {
  return (
    `${getLoggingPrefix('error')} Unhandled rejection in ${capitalizedBrowserName(browser)} process:\n` +
    `${colors.red(errorDetail(reason))}`
  )
}

export function generalBrowserError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} General error in ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function errorConnectingToBrowser(browser: Browser) {
  return `${getLoggingPrefix('error')} Unable to connect to ${capitalizedBrowserName(browser)}. Too many retries.`
}

export function addonInstallError(browser: Browser, message: string) {
  return (
    `${getLoggingPrefix('error')} Can't install add-on into ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(message)}`
  )
}

export function pathIsNotDirectoryError(browser: Browser, profilePath: string) {
  return (
    `${getLoggingPrefix('error')} Profile path for ${capitalizedBrowserName(browser)} is not a directory.\n` +
    `${colors.gray('PATH')} ${colors.underline(profilePath)}`
  )
}

// removed: parseMessageLengthError (replaced by shared rdp-wire helpers)

export function messagingClientClosedError(browser: Browser) {
  return `${getLoggingPrefix('error')} Messaging client closed unexpectedly for ${capitalizedBrowserName(browser)}`
}

export function requestWithoutTargetActorError(
  browser: Browser,
  requestType: string
) {
  return `${getLoggingPrefix('error')} Request without target actor: ${colors.gray(requestType)} for ${capitalizedBrowserName(browser)}`
}

export function connectionClosedError(browser: Browser) {
  return `${getLoggingPrefix('error')} Connection closed unexpectedly for ${capitalizedBrowserName(browser)}`
}

export function targetActorHasActiveRequestError(
  browser: Browser,
  targetActor: string
) {
  return `${getLoggingPrefix('error')} Target actor ${colors.gray(targetActor)} has active request for ${capitalizedBrowserName(browser)}`
}

export function parsingPacketError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Failed to parse packet from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(errorDetail(error))}`
  )
}

export function messageWithoutSenderError(
  browser: Browser,
  message: {
    from?: string
    type?: string
    error?: unknown
  }
) {
  return (
    `${getLoggingPrefix('error')} Message without sender from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(JSON.stringify(message))}`
  )
}

export function unexpectedMessageReceivedError(
  browser: Browser,
  message: string
) {
  return (
    `${getLoggingPrefix('error')} Unexpected message received from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(message)}`
  )
}

// Debug messages - only used in development mode
export function isUsingStartingUrl(browser: Browser, value: unknown) {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} ${capitalizedBrowserName(browser)} using starting URL: ${String(value)}`
}

// removed: isUsingBrowserBinary (unused)

// removed: isUsingProfile (unused)

export function profileFallbackWarning(browser: Browser, reason: string) {
  return (
    `${colors.brightYellow('►►►')} ${colors.brightYellow('Dev')} ${capitalizedBrowserName(browser)} falling back to per-instance profile` +
    (reason ? `: ${colors.gray(reason)}` : '')
  )
}

export function pathPermissionError(browser: Browser, profilePath: string) {
  return (
    `${getLoggingPrefix('error')} Insufficient permissions for the profile path for ${capitalizedBrowserName(browser)}.\n` +
    `${colors.gray('PATH')} ${colors.underline(profilePath)}`
  )
}

export function profileCreationError(browser: Browser, error: unknown) {
  return (
    `${getLoggingPrefix('error')} Failed to create profile for ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(String(error))}`
  )
}

// Chrome/Chromium specific messages
export function chromeProcessExited(code: number) {
  return `${getLoggingPrefix('info')} Chrome process exited with code: ${colors.gray(code.toString())}`
}

export function chromeProcessError(error: unknown) {
  return `${getLoggingPrefix('error')} Chrome process error:\n${colors.red(errorDetail(error))}`
}

export function chromeFailedToSpawn(error: unknown) {
  return `${getLoggingPrefix('error')} Failed to spawn Chrome:\n${colors.red(errorDetail(error))}`
}

export function chromeInitializingEnhancedReload() {
  return `${getLoggingPrefix('info')} Initializing enhanced reload service with direct spawn for Chrome`
}

// Dev/utility formatting helpers
export function locatingBrowser(browser: Browser) {
  return `${getLoggingPrefix('info')} Locating ${capitalizedBrowserName(browser)} browser binary...`
}

export function devChromeProfilePath(path: string) {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Chrome profile: ${colors.underline(path)}`
}

export function chromiumDryRunNotLaunching() {
  return `${getLoggingPrefix('info')} [plugin-browsers] Dry run: not launching browser`
}

export function chromiumDryRunBinary(path: string) {
  return `${getLoggingPrefix('info')} [plugin-browsers] Binary: ${colors.underline(path)}`
}

export function chromiumDryRunFlags(flags: string) {
  return `${getLoggingPrefix('info')} [plugin-browsers] Flags: ${colors.gray(flags)}`
}

export function prettyPuppeteerInstallGuidance(
  browser: Browser,
  rawGuidance: string,
  cacheDir: string
): string {
  // Preserve the exact guidance text from the location package,
  // append the installation path (colored) as the only difference.
  const dim = colors.gray
  const body: string[] = []
  // Some callers pass String(Error) which prefixes with "Error: ".
  let cleaned = String(rawGuidance || '')
    .replace(/^Error:\s*/i, '')
    .trim()

  // If we only received a minimal one-liner (e.g. just the install command),
  // expand it using the location package's own getInstallGuidance to match npx output.
  try {
    const looksMinimal = cleaned.split(/\r?\n/).filter(Boolean).length < 2
    if (looksMinimal) {
      const b = String(browser || '').toLowerCase()
      if (b === 'chromium' || b === 'chromium-based') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const loc = require('chromium-location')
          const txt =
            typeof loc?.getInstallGuidance === 'function'
              ? loc.getInstallGuidance()
              : ''
          if (txt && typeof txt === 'string') cleaned = String(txt).trim()
        } catch {
          // fall through; keep minimal text
        }
      } else if (b === 'chrome') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const loc = require('chrome-location2')
          const txt =
            typeof loc?.getInstallGuidance === 'function'
              ? loc.getInstallGuidance()
              : ''
          if (txt && typeof txt === 'string') cleaned = String(txt).trim()
        } catch {
          // fall through; keep minimal text
        }
      } else if (b === 'firefox' || b === 'gecko-based') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const loc = require('firefox-location2')
          const txt =
            typeof loc?.getInstallGuidance === 'function'
              ? loc.getInstallGuidance()
              : ''
          if (txt && typeof txt === 'string') cleaned = String(txt).trim()
        } catch {
          // fall through; keep minimal text
        }
      } else if (b === 'edge') {
        try {
          // eslint-disable-next-line @typescript-eslint/no-var-requires
          const loc = require('edge-location')
          const txt =
            typeof loc?.getInstallGuidance === 'function'
              ? loc.getInstallGuidance()
              : ''
          if (txt && typeof txt === 'string') cleaned = String(txt).trim()
        } catch {
          // fall through; keep minimal text
        }
      }
    }
  } catch {
    // ignore expansion errors
  }

  // Normalize browser subdir for our binaries layout (shared across installers)
  let browserNorm = 'chromium'
  if (browser === 'chromium-based') {
    browserNorm = 'chromium'
  } else if (browser === 'gecko-based') {
    browserNorm = 'firefox'
  } else if (
    browser === 'chrome' ||
    browser === 'chromium' ||
    browser === 'firefox' ||
    browser === 'edge'
  ) {
    browserNorm = browser
  }

  const finalCachePath =
    browserNorm && cacheDir ? path.join(cacheDir, browserNorm) : cacheDir

  // Inject install destinations for Puppeteer/Playwright to land in our cache
  try {
    if (finalCachePath && finalCachePath.trim().length > 0) {
      const lines = cleaned.split(/\r?\n/)
      // Puppeteer path injection
      const idx = lines.findIndex((l) =>
        /npx\s+@puppeteer\/browsers\s+install\s+/i.test(l)
      )
      if (idx !== -1 && !/--path\s+/i.test(lines[idx])) {
        lines[idx] = `${lines[idx].trim()} --path "${finalCachePath}"`
        cleaned = lines.join('\n')
      }
      // Playwright custom install dir via PLAYWRIGHT_BROWSERS_PATH
      try {
        const pwIdx = lines.findIndex((l) =>
          /npx\s+playwright\s+install(\s+.+)?/i.test(l)
        )

        if (pwIdx !== -1) {
          if (finalCachePath && finalCachePath.trim().length > 0) {
            const cmd = lines[pwIdx].trim()
            const withEnv =
              process.platform === 'win32'
                ? `set PLAYWRIGHT_BROWSERS_PATH="${finalCachePath}" && ${cmd}`
                : `PLAYWRIGHT_BROWSERS_PATH="${finalCachePath}" ${cmd}`
            lines[pwIdx] = withEnv
            cleaned = lines.join('\n')
          }
        }
      } catch {
        // noop
      }
    }
  } catch {
    // noop
  }

  body.push(cleaned)
  if (finalCachePath) {
    body.push(`${dim('INSTALL PATH')} ${colors.underline(finalCachePath)}`)
  }
  return body.join('\n') + '\n'
}

// Firefox specific messages
export function firefoxLaunchCalled() {
  return `${getLoggingPrefix('info')} launchFirefox called!`
}

export function firefoxDetectionFailed(error: unknown) {
  return `${getLoggingPrefix('error')} Firefox detection failed:\n${colors.red(errorDetail(error))}`
}

export function firefoxBinaryArgsExtracted(args: string) {
  return `${getLoggingPrefix('info')} Firefox binary args extracted: ${colors.gray(args)}`
}

export function firefoxNoBinaryArgsFound() {
  return `${getLoggingPrefix('info')} No Firefox binary args found`
}

export function firefoxFailedToExtractProfilePath() {
  return `${getLoggingPrefix('error')} Failed to extract profile path from Firefox config`
}

// removed: firefoxRunFirefoxPluginApplyArguments (no longer used)

export function firefoxFailedToStart(error: unknown) {
  return `${getLoggingPrefix('error')} Firefox failed to start:\n${colors.red(errorDetail(error))}`
}

export function firefoxDryRunNotLaunching() {
  return `${getLoggingPrefix('info')} [plugin-browsers] Dry run: not launching browser`
}

export function firefoxDryRunBinary(path: string) {
  return `${getLoggingPrefix('info')} [plugin-browsers] Binary (detected): ${colors.underline(path)}`
}

export function firefoxDryRunConfig(cfg: string) {
  return `${getLoggingPrefix('info')} [plugin-browsers] Config: ${colors.gray(cfg)}`
}

export function sourceInspectorInitialized() {
  return `${getLoggingPrefix('info')} Chrome source inspector initialized successfully`
}

export function sourceInspectorInitializationFailed(error: string) {
  return `${getLoggingPrefix('error')} Failed to initialize Chrome source inspector: ${colors.red(error)}`
}

export function sourceInspectorChromeDebuggingRequired(port: number) {
  try {
    const p = Number(port)
    const shown = Number.isFinite(p) && p > 0 ? p : 9222
    return (
      `${getLoggingPrefix('error')} Chrome is not running with remote debugging enabled on port ${colors.gray(shown.toString())}. ` +
      `Ensure Chrome is launched with ${colors.blue('--remote-debugging-port')}=${colors.gray(shown.toString())}`
    )
  } catch {
    return (
      `${getLoggingPrefix('error')} Chrome is not running with remote debugging enabled on port ${colors.gray('9222')}. ` +
      `Ensure Chrome is launched with ${colors.blue('--remote-debugging-port')}=${colors.gray('9222')}`
    )
  }
}

export function sourceInspectorFirefoxDebuggingRequired(port: number) {
  return (
    `${getLoggingPrefix('error')} Firefox is not running with remote debugging enabled on port ${colors.gray(port.toString())}. ` +
    `Ensure Firefox is launched with ${colors.blue('-start-debugger-server')} ${colors.gray(port.toString())}`
  )
}

export function sourceInspectorWaitingForFirefox() {
  return `${getLoggingPrefix('info')} Waiting for Firefox to be ready with remote debugging...`
}

export function firefoxRemoteDebuggingReady() {
  return `${getLoggingPrefix('success')} Firefox is ready with remote debugging!`
}

export function sourceInspectorFirefoxNotReadyYet(
  retries: number,
  maxRetries: number
) {
  return `${getLoggingPrefix('warn')} Firefox not ready yet, retrying... (${colors.gray(retries.toString())}/${colors.gray(maxRetries.toString())})`
}

export function sourceInspectorWaitingForChrome() {
  return `${getLoggingPrefix('info')} Waiting for Chrome to be ready with remote debugging...`
}

export function chromeRemoteDebuggingReady() {
  return `${getLoggingPrefix('success')} Chrome is ready with remote debugging!`
}

export function sourceInspectorChromeNotReadyYet(
  retries: number,
  maxRetries: number
) {
  return `${getLoggingPrefix('warn')} Chrome not ready yet, retrying... (${colors.gray(retries.toString())}/${colors.gray(maxRetries.toString())})`
}

export function sourceInspectorOpeningUrl(url: string) {
  return `${getLoggingPrefix('info')} Chrome is opening URL: ${colors.underline(url)}`
}

export function sourceInspectorWaitingForPageLoad() {
  return `${getLoggingPrefix('info')} Chrome is waiting for the page to load...`
}

export function sourceInspectorCreatingTarget() {
  return `${getLoggingPrefix('info')} Chrome is creating a new target...`
}

export function sourceInspectorFindingExistingTarget() {
  return `${getLoggingPrefix('info')} Chrome is finding an existing target...`
}

export function sourceInspectorUsingExistingTarget(targetId: string) {
  return `${getLoggingPrefix('info')} Chrome is using existing target with ID: ${colors.gray(targetId)}`
}

export function sourceInspectorTargetCreated(targetId: string) {
  return `${getLoggingPrefix('success')} Chrome created a target with ID: ${colors.gray(targetId)}`
}

export function sourceInspectorAttachingToTarget() {
  return `${getLoggingPrefix('info')} Chrome is attaching to the target...`
}

export function sourceInspectorAttachedToTarget(sessionId: string) {
  return `${getLoggingPrefix('success')} Chrome is attached to the target with session ID: ${colors.gray(sessionId)}`
}

export function sourceInspectorExtractingHTML() {
  return `${getLoggingPrefix('info')} Chrome is extracting page HTML...`
}

export function sourceInspectorHTMLExtractionComplete() {
  return `${getLoggingPrefix('success')} Chrome HTML extraction is complete`
}

export function sourceInspectorInspectionFailed(error: string) {
  return `${getLoggingPrefix('error')} Failed to inspect Chrome source: ${colors.red(error)}`
}

export function sourceInspectorStartingWatchMode() {
  return `${getLoggingPrefix('info')} Chrome is starting watch mode for sources...`
}

export function sourceInspectorWatchModeActive() {
  return `${getLoggingPrefix('info')} Chrome HTML will be updated automatically when files change`
}

export function sourceInspectorWatchModeStopped() {
  return `${getLoggingPrefix('warn')} Chrome source inspector watch mode stopped`
}

export function sourceInspectorCDPConnectionMaintained() {
  return `${getLoggingPrefix('info')} Chrome CDP connection maintained for continuous monitoring`
}

export function sourceInspectorNoActiveSession() {
  return `${getLoggingPrefix('warn')} No active Chrome CDP session for file change monitoring`
}

export function sourceInspectorReExtractingHTML() {
  return `${getLoggingPrefix('info')} Chrome is re-extracting page HTML after a file change...`
}

export function sourceInspectorAttemptingReconnection() {
  return `${getLoggingPrefix('warn')} Chrome is attempting to reconnect to the target...`
}

export function sourceInspectorCannotReconnect() {
  return `${getLoggingPrefix('error')} Chrome cannot reconnect: missing CDP client or target ID`
}

export function sourceInspectorReconnectingToTarget() {
  return `${getLoggingPrefix('info')} Chrome is reconnecting to the target...`
}

export function sourceInspectorReconnectedToTarget(sessionId: string) {
  return `${getLoggingPrefix('success')} Chrome reconnected to target with session ID: ${colors.gray(sessionId)}`
}

export function sourceInspectorReconnectionFailed(error: string) {
  return `${getLoggingPrefix('error')} Failed to reconnect to Chrome target: ${colors.red(error)}`
}

export function sourceInspectorEnsuringNavigation() {
  return `${getLoggingPrefix('info')} Chrome ensuring target navigates to URL...`
}

export function sourceInspectorEnablingPageDomain() {
  return `${getLoggingPrefix('info')} Chrome enabling page domain for load events...`
}

export function sourceInspectorWaitingForContentScripts() {
  return `${getLoggingPrefix('info')} Chrome waiting for content scripts to inject...`
}

export function sourceInspectorWaitingForContentScriptReinjection() {
  return `${getLoggingPrefix('info')} Chrome waiting for content scripts to reinject...`
}

export function sourceInspectorFileChanged() {
  return `${getLoggingPrefix('warn')} Chrome source file changed, updating HTML...`
}

export function sourceInspectorHTMLUpdateFailed(error: string) {
  return `${getLoggingPrefix('error')} Failed to update Chrome HTML: ${colors.red(error)}`
}

export function sourceInspectorCleanupComplete() {
  return `${getLoggingPrefix('success')} Chrome source inspector cleaned up`
}

export function sourceInspectorCleanupError(error: string) {
  return `${getLoggingPrefix('error')} Error during Chrome cleanup: ${colors.red(error)}`
}

export function sourceInspectorNotInitialized() {
  return `${getLoggingPrefix('error')} Chrome source inspector not initialized`
}

export function sourceInspectorInvalidWebSocketServer() {
  return `${getLoggingPrefix('warn')} Chrome invalid WebSocket server provided`
}

export function sourceInspectorUrlRequired() {
  return `${getLoggingPrefix('error')} Chrome source inspection requires either ${colors.blue('--source')} ${colors.gray('<url>')} or ${colors.blue('--starting-url')} ${colors.gray('<url>')} to be specified`
}

export function sourceInspectorWillInspect(url: string) {
  return `${getLoggingPrefix('info')} Chrome source inspection will inspect: ${colors.underline(url)}`
}

export function sourceInspectorSetupFailed(error: string) {
  return `${getLoggingPrefix('error')} Failed to setup Chrome source inspection: ${colors.red(error)}`
}

export function sourceInspectorHTMLOutputHeader() {
  return '\n' + '='.repeat(80)
}

export function sourceInspectorHTMLOutputTitle(title: string) {
  return `${colors.bold(colors.blue('PAGE HTML'))} ${colors.gray('(')}${colors.gray(title)}${colors.gray(')')}:`
}

export function sourceInspectorHTMLOutputFooter() {
  return '='.repeat(80) + '\n'
}

// Generic source inspector errors (Firefox-specific helpers)
export function sourceInspectorClientNotInitialized() {
  return `${getLoggingPrefix('error')} Firefox source inspector client not initialized`
}

export function sourceInspectorNoTabActorAvailable() {
  return `${getLoggingPrefix('error')} No Firefox tab actor available for navigation`
}

export function sourceInspectorNoTabTargetFound() {
  return `${getLoggingPrefix('error')} No Firefox tab target found`
}

export function sourceInspectorHtmlExtractFailed() {
  return `${getLoggingPrefix('error')} Failed to extract Firefox HTML after retries`
}

// CDP Client messages (browser-owned)
export function cdpClientFoundTargets(count: number) {
  return `${getLoggingPrefix('info')} Chrome found ${colors.gray(count.toString())} targets`
}

export function cdpClientTargetWebSocketUrlStored() {
  return `${getLoggingPrefix('info')} Chrome target WebSocket URL stored for future connections`
}

export function cdpClientConnected(host: string, port: number) {
  return `${getLoggingPrefix('success')} Chrome CDP Client connected to ${colors.gray(host)}:${colors.gray(port.toString())}`
}

export function cdpClientConnectionError(error: string) {
  return `${getLoggingPrefix('error')} Chrome CDP Client connection error: ${colors.red(error)}`
}

export function cdpClientBrowserConnectionEstablished() {
  return `${getLoggingPrefix('success')} Chrome CDP Client browser connection established`
}

export function cdpClientConnectionClosed() {
  return `${getLoggingPrefix('warn')} Chrome CDP connection is closed`
}

export function cdpClientMessageParseError(error: string) {
  return `${getLoggingPrefix('error')} Failed to parse Chrome CDP message: ${colors.red(error)}`
}

export function cdpClientPageLoadEventFired() {
  return `${getLoggingPrefix('info')} Chrome page load event occurred`
}

export function cdpClientLoadEventTimeout() {
  return `${getLoggingPrefix('warn')} Chrome load event timed out; proceeding anyway...`
}

export function cdpClientTestingEvaluation() {
  return `${getLoggingPrefix('info')} Chrome testing basic CDP evaluation...`
}

export function cdpClientShadowDOMContentFound(found: boolean) {
  return `${getLoggingPrefix('info')} Chrome Shadow DOM content found: ${found ? colors.gray('yes') : colors.gray('no')}`
}

export function cdpClientShadowDOMContentLength(length: number) {
  return `${getLoggingPrefix('info')} Chrome Shadow DOM content length: ${colors.gray(length.toString())}`
}

export function cdpClientProcessingShadowDOM() {
  return `${getLoggingPrefix('info')} Chrome is processing Shadow DOM content...`
}

export function cdpClientFinalHTMLWithShadowDOMLength(length: number) {
  return `${getLoggingPrefix('info')} Chrome final HTML with Shadow DOM length: ${colors.gray(length.toString())}`
}

export function cdpClientReturningMainHTML() {
  return `${getLoggingPrefix('info')} Chrome is returning main HTML without Shadow DOM`
}

export function cdpClientExtensionReloadFailed(
  extensionId: string,
  error: string
) {
  return `${getLoggingPrefix('error')} Chrome CDP Client: Failed to force-reload extension ${colors.gray(extensionId)}: ${colors.red(error)}`
}

export function cdpClientExtensionUnloadFailed(
  extensionId: string,
  error: string
) {
  return `${getLoggingPrefix('error')} Chrome CDP Client: Failed to unload extension ${colors.gray(extensionId)}: ${colors.red(error)}`
}

export function cdpClientExtensionInfoFailed(
  extensionId: string,
  error: string
) {
  return `${getLoggingPrefix('error')} Chrome CDP Client: Failed to get extension info for ${colors.gray(extensionId)}: ${colors.red(error)}`
}

export function cdpClientExtensionLoadFailed(path: string, error: string) {
  return `${getLoggingPrefix('error')} Chrome CDP Client: Failed to load extension from ${colors.underline(path)}: ${colors.red(error)}`
}

// Firefox RDP Client messages (browser-owned)
export function firefoxRdpClientFoundTargets(count: number) {
  return `${getLoggingPrefix('info')} Found ${colors.gray(count.toString())} Firefox targets`
}

export function firefoxRdpClientUsingTarget(title: string, url: string) {
  return `${getLoggingPrefix('info')} is using Firefox target: ${colors.gray(title)} (${colors.underline(url)})`
}

export function firefoxRdpClientConnected(host: string, port: number) {
  return `${getLoggingPrefix('success')} Connected to Firefox Remote Debugging Protocol on ${colors.gray(host)}:${colors.gray(port.toString())}`
}

export function firefoxRdpClientConnectionError(error: string) {
  return `${getLoggingPrefix('error')} Firefox RDP connection error.\n${colors.red(error)}`
}

export function firefoxRdpClientConnectionClosed() {
  return `${getLoggingPrefix('warn')} Firefox RDP connection is closed`
}

export function firefoxRdpClientNoSuitableTargets() {
  return `${getLoggingPrefix('error')} No suitable Firefox targets available`
}

export function firefoxRdpClientPageLoadEventFired() {
  return `${getLoggingPrefix('info')} Firefox page load event occurred`
}

export function firefoxRdpClientLoadEventTimeout() {
  return `${getLoggingPrefix('warn')} Firefox load event timed out; proceeding anyway...`
}

export function firefoxRdpClientTestingEvaluation() {
  return `${getLoggingPrefix('info')} Testing basic Firefox RDP evaluation...`
}

export function firefoxRdpClientDocumentTitle(title: string) {
  return `${getLoggingPrefix('info')} Firefox document title: ${colors.gray(title)}`
}

export function firefoxRdpClientFailedToGetMainHTML() {
  return `${getLoggingPrefix('error')} Failed to get Firefox main HTML`
}

export function firefoxRdpClientFinalHTMLLength(length: number) {
  return `${getLoggingPrefix('info')} Firefox final HTML length: ${colors.gray(length.toString())}`
}

// Dev summary and helpers (browser-owned)
export interface DevManifestInfo {
  name?: string
  version?: string
}

export interface DevClientManagementInfo {
  name?: string
  version?: string
}

export interface DevClientMessage {
  data?: {id?: string; management?: DevClientManagementInfo}
}

export function runningInDevelopment(
  manifest: DevManifestInfo,
  browser: DevOptions['browser'],
  message: DevClientMessage
) {
  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
  const manifestName = manifest.name || 'Extension.js'
  let browserDevToolsUrl: string

  switch (browser) {
    case 'chrome':
      browserDevToolsUrl = 'chrome://extensions'
      break
    case 'edge':
      browserDevToolsUrl = 'edge://extensions'
      break
    case 'firefox':
      browserDevToolsUrl = 'about:debugging#/runtime/this-firefox'
      break
    default:
      browserDevToolsUrl = ''
  }

  if (!message.data) {
    return (
      `${getLoggingPrefix('error')} No Client Data Received for ${manifestName}\n\n` +
      `${colors.red("This error happens when the program can't get the data from your extension.")}\n` +
      `${colors.red('There are many reasons this might happen. To fix, ensure that:')}\n\n` +
      `- Your extension is set as enabled in ${colors.underline(browserDevToolsUrl)}\n` +
      `- No previous ${capitalize(browser)} browser instance is open\n\n` +
      `If that is not the case, restart both the ${colors.yellow(manifest.name || '')} and the\n` +
      `${colors.yellow('Manager Extension')} in ${colors.underline(browserDevToolsUrl)} and try again.\n` +
      `If the issue still persists, please report a bug:\n` +
      colors.underline(`https://github.com/extension-js/extension.js/issues`)
    )
  }

  const {id = '', management} = message.data as {
    id?: string
    management?: {name?: string; version?: string}
  }

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      return `${getLoggingPrefix('error')} No management API info received from client for ${manifestName}. Investigate.`
    }
  }

  const {name = '', version = ''} = management as {
    name?: string
    version?: string
  }
  // Note: keep dynamic import here to avoid ESM JSON import issues at compile time in some bundlers
  const extensionVersion = require('../../../package.json').version
  return `${
    ` 🧩 ${colors.blue('Extension.js')} ${colors.gray(`${extensionVersion}`)}\n` +
    `${`    Extension Name        `} ${colors.gray(name)}\n` +
    `${`    Extension Version     `} ${colors.gray(version)}\n` +
    `${`    Extension ID          `} ${colors.gray(id)}`
  }`
}

export function emptyLine() {
  return ''
}

export function separatorLine() {
  return ''.padEnd(80, '=')
}

export function devChromiumDebugPort(finalPort: number, requestedPort: number) {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Chromium debug port: ${colors.gray(finalPort.toString())} (requested ${colors.gray(requestedPort.toString())})`
}

export function devFirefoxDebugPort(finalPort: number, requestedPort: number) {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Firefox debug port: ${colors.gray(finalPort.toString())} (requested ${colors.gray(requestedPort.toString())})`
}

export function devFirefoxProfilePath(profilePath: string) {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Firefox profile: ${colors.underline(profilePath)}`
}

export function unifiedLogLine(head: string, message: string) {
  return `${head} - ${message}`
}

export function devHtmlSampleRetry(sample: string) {
  return `${colors.gray('[Extension.js] HTML sample (retry):')} ${colors.gray(sample)}`
}

export function devHtmlSampleLate(sample: string) {
  return `${colors.gray('[Extension.js] HTML sample (late):')} ${colors.gray(sample)}`
}

export function devSvelteProbeDetected(probe: string) {
  return `${colors.gray('[Extension.js] Svelte probe detected:')} ${colors.gray(probe)}`
}

export function cdpUnifiedExtensionLog(ts: string, payload: unknown) {
  const data = (() => {
    try {
      return JSON.stringify(payload)
    } catch {
      return String(payload)
    }
  })()
  return `[extension-log ${ts}] ${data}`
}

export function firefoxInspectSourceNonFatal(message: string) {
  return `${getLoggingPrefix('warn')} Firefox Inspect non-fatal error: ${colors.yellow(message)}`
}

export function browserPluginFailedToLoad(browser: string, error: unknown) {
  return `ERROR Browser Plugin Failed: ${colors.brightBlue(browser)}\n${colors.red(String(error))}`
}

export function unsupportedBrowser(browser: string) {
  const supported = ['chrome', 'edge', 'firefox'].join(', ')
  const hintFlag = `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}`
  const docsUrl = colors.underline(
    'https://github.com/extension-js/extension.js'
  )
  return (
    `${getLoggingPrefix('error')} Unsupported browser ${colors.yellow(`"${browser}"`)}\n\n` +
    `We currently support: ${colors.green(supported)}.\n` +
    `Try selecting a supported browser with ${hintFlag}.\n\n` +
    `Need another engine? Open a discussion or PR:\n` +
    `${docsUrl}`
  )
}

// Browser Runner error wrapper (pretty heading)
export function browserRunnerError(body: string) {
  return `${colors.red('ERROR')} ${colors.brightBlue('error in browser runner')}\n${body}`
}

// Configuration validation (succinct, Vercel-like tone)
export function requireChromiumBinaryForChromiumBased() {
  const body =
    `Configuration required\n` +
    `Provide ${colors.blue('--chromium-binary')} ${colors.gray('<abs-path>')} when using ${colors.yellow('chromium-based')}.\n`
  return browserRunnerError(body)
}

export function requireGeckoBinaryForGeckoBased() {
  const body =
    `Configuration required\n` +
    `Provide ${colors.blue('--gecko-binary')} ${colors.gray('<abs-path>')} when using ${colors.yellow('gecko-based')} or ${colors.yellow('firefox-based')}.\n`
  return browserRunnerError(body)
}

export function invalidChromiumBinaryPath(p: string) {
  const body =
    `Invalid binary path\n` +
    `Chromium binary not found at ${colors.underline(p)}.\n` +
    `Provide a working path via ${colors.blue('--chromium-binary')} ${colors.gray('<abs-path>')}.`
  return browserRunnerError(body)
}

export function invalidGeckoBinaryPath(p: string) {
  const body =
    `Invalid binary path\n` +
    `Firefox/Gecko binary not found at ${colors.underline(p)}.\n` +
    `Provide a working path via ${colors.blue('--gecko-binary')} ${colors.gray('<abs-path>')}.`
  return browserRunnerError(body)
}

export function firefoxDetectedFlatpak() {
  return `${colors.gray('►►►')} Firefox detected via Flatpak`
}

export function firefoxDetectedSnap() {
  return `${colors.gray('►►►')} Firefox detected via Snap`
}

export function firefoxDetectedTraditional(path: string) {
  return `${colors.gray('►►►')} Firefox detected at ${colors.underline(path)}`
}

export function firefoxDetectedCustom(path: string) {
  return `${colors.gray('►►►')} Using custom Firefox binary at ${colors.underline(path)}`
}

export function firefoxUsingFlatpakWithSandbox() {
  return `${colors.gray('►►►')} Using Flatpak launcher with sandbox arguments`
}

export function firefoxVersion(version: string) {
  return `${colors.gray('►►►')} Firefox version ${colors.gray(version)}`
}

export function rdpInvalidRequestPayload() {
  return `${getLoggingPrefix('error')} Invalid RDP request payload`
}

// Chromium developer mode guidance (succinct, Vercel-like tone)
export function chromiumDeveloperModeGuidance(browser?: DevOptions['browser']) {
  let exts = ''
  if (browser === 'edge') {
    exts = colors.underline('edge://extensions')
  } else if (
    browser === 'chrome' ||
    browser === 'chromium' ||
    browser === 'chromium-based'
  ) {
    exts = colors.underline('chrome://extensions')
  } else {
    exts = colors.underline('chrome://extensions')
  }

  return (
    `${getLoggingPrefix('warn')} Configuration required\n` +
    `Enable ${colors.yellow('Developer mode')} in ${exts} for reliable reloads.\n` +
    `Without it, hard reloads may disable your unpacked extension.`
  )
}
