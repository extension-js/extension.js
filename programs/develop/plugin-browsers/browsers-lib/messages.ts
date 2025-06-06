import chalk from 'chalk'
import {type DevOptions} from '../../commands/commands-lib/config-types'

function getLoggingPrefix(
  browser: DevOptions['browser'],
  type: 'warn' | 'info' | 'error' | 'success'
): string {
  const arrow =
    type === 'warn'
      ? chalk.yellow('►►►')
      : type === 'info'
        ? chalk.cyan('►►►')
        : type === 'error'
          ? `${chalk.bold(chalk.red('ERROR'))} in ${capitalizedBrowserName(browser)} ${chalk.red('✖︎✖︎✖︎')}`
          : chalk.green('►►►')
  return `${chalk.gray('')}${arrow}`
}

export function capitalizedBrowserName(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

export function creatingUserProfile(browser: DevOptions['browser']) {
  const browsername = capitalizedBrowserName(browser)
  return (
    `${getLoggingPrefix(browser, 'info')} Creating new ${browsername} ` +
    `user profile...`
  )
}

export function browserInstanceAlreadyRunning(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'success')} Instance already running.`
}

export function browserInstanceExited(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'info')} Instance exited.`
}

export function stdoutData(
  // name: string,
  browser: DevOptions['browser'],
  mode: DevOptions['mode']
) {
  const extensionOutput =
    browser === 'firefox' || browser === 'gecko-based' ? 'Add-on' : 'Extension'
  return (
    `${getLoggingPrefix(browser, 'success')} ` +
    `${capitalizedBrowserName(browser)} ${extensionOutput} ` +
    `running in ${chalk.blue(mode || 'unknown')} mode.`
  )
}

export function browserNotInstalledError(
  browser: DevOptions['browser'],
  browserBinaryLocation: string
) {
  const isUnreacheable =
    browserBinaryLocation == 'null'
      ? `Browser is not installed\n\n`
      : `Can\'t find the browser path\n\n`

  return (
    `${getLoggingPrefix(browser, 'error')} ${isUnreacheable}` +
    `Either install the missing browser or choose a different one via ` +
    `${chalk.yellow('--browser')} flag.\n` +
    `${chalk.red('NOT FOUND')} ${chalk.underline(browserBinaryLocation || capitalizedBrowserName(browser) + 'BROWSER')}`
  )
}

export function injectingAddOnsError(
  browser: DevOptions['browser'],
  error: any
) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Can\'t inject extensions into ` +
    `${capitalizedBrowserName(browser)} profile\n` +
    `${chalk.red(error)}`
  )
}

export function firefoxServiceWorkerError(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'error')} No Service Worker Support\n\n` +
    `Firefox does not support the ${chalk.yellow(
      'background.service_worker'
    )} field yet.\n` +
    `Update your manifest.json file to use ${chalk.yellow(
      'background.scripts'
    )} instead.\n\n` +
    `Read more: ${chalk.underline(
      'https://bugzilla.mozilla.org/show_bug.cgi?id=1573659'
    )}.`
  )
}

export function browserLaunchError(browser: DevOptions['browser'], error: any) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error launching browser:\n` +
    `${chalk.red(error)}`
  )
}

export function generalBrowserError(
  browser: DevOptions['browser'],
  error: any
) {
  return `${getLoggingPrefix(browser, 'error')} ${chalk.red(error.stack)}`
}

export function errorConnectingToBrowser(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'error')} Unable to connect to ` +
    `${capitalizedBrowserName(browser)}. Too many retries.`
  )
}

export function addonInstallError(
  browser: DevOptions['browser'],
  message: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Error while installing ` +
    `temporary addon:\n${chalk.red(message)}`
  )
}

export function pathIsNotDirectoryError(
  browser: DevOptions['browser'],
  profilePath: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Path is not directory\n\n` +
    `Please provide a valid directory path and try again.\n` +
    `${chalk.red('NOT DIRECTORY')} ${chalk.underline(profilePath)}`
  )
}

export function parseMessageLengthError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing message length.`
}

export function messagingClientClosedError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(
    browser,
    'error'
  )} ${chalk.magenta('MessagingClient')} connection closed.`
}

export function requestWithoutTargetActorError(
  browser: DevOptions['browser'],
  requestType: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Unexpected ${chalk.magenta('MessagingClient')} ` +
    `request without target actor: ${chalk.yellow(requestType)}`
  )
}

export function connectionClosedError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(
    browser,
    'error'
  )} ${chalk.magenta('MessagingClient')} connection closed.`
}

export function targetActorHasActiveRequestError(
  browser: DevOptions['browser'],
  targetActor: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Target actor ` +
    `${chalk.yellow(targetActor)} already has an active request.`
  )
}

export function parsingPacketError(browser: DevOptions['browser'], error: any) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing packet: ${chalk.red(
    error
  )}`
}

export function messageWithoutSenderError(
  browser: DevOptions['browser'],
  message: {
    from?: string
    type?: string
    error?: any
  }
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Message received ` +
    `without a sender actor:\n${chalk.yellow(JSON.stringify(message))}`
  )
}

export function unexpectedMessageReceivedError(
  browser: DevOptions['browser'],
  message: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Received unexpected message:\n` +
    `${chalk.red(message)}`
  )
}

export function isUsingStartingUrl(browser: DevOptions['browser'], value: any) {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using own ${chalk.magenta('starting URL')} ` +
    `${chalk.underline(value)}. `
  )
}

export function isUsingBrowserBinary(binary: string, binaryPath: any) {
  return (
    `${getLoggingPrefix(binary as DevOptions['browser'], 'info')} ` +
    `Using own ${chalk.magenta(`${capitalizedBrowserName(binary as any)} browser binary`)} ` +
    `${chalk.underline(binaryPath)}. `
  )
}

export function isUsingProfile(
  browser: DevOptions['browser'],
  profilePath: any
) {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using own ${chalk.magenta('browser profile')} ` +
    `${chalk.underline(profilePath)}. `
  )
}

export function isUsingPreferences(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using own ${chalk.magenta('browser preferences')}. `
  )
}

export function isUsingBrowserFlags(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Using own ${chalk.magenta('browser flags')}. `
  )
}

export function isBrowserLauncherOpen(
  browser: DevOptions['browser'],
  isOpen: boolean
) {
  return (
    `${getLoggingPrefix(browser, 'info')} ` +
    `Browser launcher is ${chalk.yellow(isOpen ? 'enabled' : 'disabled')}. `
  )
}

export function pathDoesNotExistError(
  browser: DevOptions['browser'],
  profilePath: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Profile path does not exist\n\n` +
    `Please provide a valid directory path and try again.\n` +
    `${chalk.red('NOT FOUND')} ${chalk.underline(profilePath)}`
  )
}

export function pathPermissionError(
  browser: DevOptions['browser'],
  profilePath: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Insufficient permissions\n\n` +
    `Cannot read or write to the profile directory.\n` +
    `${chalk.red('PERMISSION DENIED')} ${chalk.underline(profilePath)}`
  )
}

export function profileCreationError(
  browser: DevOptions['browser'],
  error: any
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Failed to create profile\n\n` +
    `An error occurred while creating the browser profile:\n` +
    `${chalk.red(error)}`
  )
}
