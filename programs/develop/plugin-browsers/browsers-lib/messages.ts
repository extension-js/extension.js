import colors from 'pintor'
import type {DevOptions} from '../../commands/commands-lib/config-types'

type Browser = NonNullable<DevOptions['browser']>
type Mode = DevOptions['mode']

function getLoggingPrefix(
  browser: Browser,
  type: 'warn' | 'info' | 'error' | 'success'
): string {
  const arrow =
    type === 'warn'
      ? colors.yellow('►►►')
      : type === 'info'
        ? colors.cyan('►►►')
        : type === 'error'
          ? `${colors.bold(colors.red('ERROR'))} in ${capitalizedBrowserName(browser)} ${colors.red('✖︎✖︎✖︎')}`
          : colors.green('►►►')
  return `${colors.gray('')}${arrow}`
}

export function capitalizedBrowserName(browser: Browser): string {
  return browser.charAt(0).toUpperCase() + browser.slice(1)
}

export function creatingUserProfile(browser: Browser): string {
  const browsername = capitalizedBrowserName(browser)
  return (
    `${getLoggingPrefix(browser, 'info')} Creating new ${browsername} ` +
    `user profile...`
  )
}

export function browserInstanceAlreadyRunning(browser: Browser): string {
  return `${getLoggingPrefix(browser, 'success')} Instance already running.`
}

export function browserInstanceExited(browser: Browser): string {
  return `${getLoggingPrefix(browser, 'info')} Instance exited.`
}

export function stdoutData(browser: Browser, mode: Mode): string {
  const extensionOutput =
    browser === 'firefox' || browser === 'gecko-based' ? 'Add-on' : 'Extension'
  return (
    `${getLoggingPrefix(browser, 'success')} ` +
    `${capitalizedBrowserName(browser)} ${extensionOutput} ` +
    `running in ${colors.blue(mode || 'unknown')} mode.`
  )
}

export function browserNotInstalledError(
  browser: Browser,
  browserBinaryLocation: string
): string {
  const isUnreacheable =
    browserBinaryLocation == 'null'
      ? `Browser is not installed\n\n`
      : `Can\'t find the browser path\n\n`

  return (
    `${getLoggingPrefix(browser, 'error')} ${isUnreacheable}` +
    `Either install the missing browser or choose a different one via ` +
    `${colors.yellow('--browser')} flag.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(browserBinaryLocation || capitalizedBrowserName(browser) + 'BROWSER')}`
  )
}

export function injectingAddOnsError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Can\'t inject extensions into ` +
    `${capitalizedBrowserName(browser)} profile\n` +
    `${colors.red(String(error))}`
  )
}

export function firefoxServiceWorkerError(browser: Browser): string {
  return (
    `${getLoggingPrefix(browser, 'error')} No Service Worker Support\n\n` +
    `Firefox does not support the ${colors.yellow(
      'background.service_worker'
    )} field yet.\n` +
    `Update your manifest.json file to use ${colors.yellow(
      'background.scripts'
    )} instead.\n\n` +
    `Read more: ${colors.underline(
      'https://bugzilla.mozilla.org/show_bug.cgi?id=1573659'
    )}.`
  )
}

export function browserLaunchError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error launching browser:\n` +
    `${colors.red(String(error))}`
  )
}

export function generalBrowserError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `General browser error:\n` +
    `${colors.red(String(error))}`
  )
}

export function errorConnectingToBrowser(browser: Browser): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Unable to connect to ${capitalizedBrowserName(browser)}. Too many retries.`
  )
}

export function addonInstallError(browser: Browser, message: string): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Can\'t install add-on into ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(message)}`
  )
}

export function pathIsNotDirectoryError(
  browser: Browser,
  profilePath: string
): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Profile path is not a directory:\n` +
    `${colors.red(profilePath)}`
  )
}

export function parseMessageLengthError(browser: Browser): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Failed to parse message length from ${capitalizedBrowserName(browser)}`
  )
}

export function messagingClientClosedError(browser: Browser): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Messaging client closed unexpectedly for ${capitalizedBrowserName(browser)}`
  )
}

export function requestWithoutTargetActorError(
  browser: Browser,
  requestType: string
): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Request without target actor: ${requestType} for ${capitalizedBrowserName(browser)}`
  )
}

export function connectionClosedError(browser: Browser): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Connection closed unexpectedly for ${capitalizedBrowserName(browser)}`
  )
}

export function targetActorHasActiveRequestError(
  browser: Browser,
  targetActor: string
): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Target actor ${targetActor} has active request for ${capitalizedBrowserName(browser)}`
  )
}

export function parsingPacketError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Failed to parse packet from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(String(error))}`
  )
}

export function messageWithoutSenderError(
  browser: Browser,
  message: {
    from?: string
    type?: string
    error?: unknown
  }
): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Message without sender from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(JSON.stringify(message))}`
  )
}

export function unexpectedMessageReceivedError(
  browser: Browser,
  message: string
): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Unexpected message received from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(message)}`
  )
}

// Debug messages - only used in development mode
export function isUsingStartingUrl(browser: Browser, value: unknown): string {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using starting URL: ${colors.blue(String(value))}`
  )
}

export function isUsingBrowserBinary(
  binary: string,
  binaryPath: unknown
): string {
  return (
    `${getLoggingPrefix('chrome', 'info')} ` +
    `Using ${binary} binary: ${colors.blue(String(binaryPath))}`
  )
}

export function isUsingProfile(browser: Browser, profilePath: unknown): string {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using profile: ${colors.blue(String(profilePath))}`
  )
}

export function isUsingPreferences(browser: Browser): string {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using custom preferences for ${capitalizedBrowserName(browser)}`
  )
}

export function isUsingBrowserFlags(browser: Browser): string {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using custom browser flags for ${capitalizedBrowserName(browser)}`
  )
}

export function isBrowserLauncherOpen(
  browser: Browser,
  isOpen: boolean
): string {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Browser launcher is ${isOpen ? colors.green('open') : colors.red('closed')} for ${capitalizedBrowserName(browser)}`
  )
}

export function pathDoesNotExistError(
  browser: Browser,
  profilePath: string
): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Profile path does not exist:\n` +
    `${colors.red(profilePath)}`
  )
}

export function pathPermissionError(
  browser: Browser,
  profilePath: string
): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Insufficient permissions for profile path:\n` +
    `${colors.red(profilePath)}`
  )
}

export function profileCreationError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Failed to create profile for ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(String(error))}`
  )
}

// Chrome/Chromium specific messages
export function chromeProcessExited(code: number): string {
  return `${getLoggingPrefix('chrome', 'info')} Chrome process exited with code: ${colors.blue(code.toString())}`
}

export function chromeProcessError(error: unknown): string {
  return `${getLoggingPrefix('chrome', 'error')} Chrome process error:\n${colors.red(String(error))}`
}

export function chromeFailedToSpawn(error: unknown): string {
  return `${getLoggingPrefix('chrome', 'error')} Failed to spawn Chrome:\n${colors.red(String(error))}`
}

export function chromeInitializingEnhancedReload(): string {
  return `${getLoggingPrefix('chrome', 'info')} Initializing enhanced reload service with direct spawn`
}

// Firefox specific messages
export function firefoxLaunchCalled(): string {
  return `${getLoggingPrefix('firefox', 'info')} launchFirefox called!`
}

export function firefoxDetectionFailed(error: unknown): string {
  return `${getLoggingPrefix('firefox', 'error')} Firefox detection failed:\n${colors.red(String(error))}`
}

export function firefoxBinaryArgsExtracted(args: string): string {
  return `${getLoggingPrefix('firefox', 'info')} Binary args extracted: ${colors.blue(args)}`
}

export function firefoxNoBinaryArgsFound(): string {
  return `${getLoggingPrefix('firefox', 'info')} No binary args found`
}

export function firefoxFailedToExtractProfilePath(): string {
  return `${getLoggingPrefix('firefox', 'error')} Failed to extract profile path from Firefox config`
}

export function firefoxRunFirefoxPluginApplyArguments(args: any): string {
  return `${getLoggingPrefix('firefox', 'info')} RunFirefoxPlugin.apply arguments: ${colors.blue(JSON.stringify(args))}`
}

export function firefoxFailedToStart(error: unknown): string {
  return `${getLoggingPrefix('firefox', 'error')} Firefox failed to start:\n${colors.red(String(error))}`
}
