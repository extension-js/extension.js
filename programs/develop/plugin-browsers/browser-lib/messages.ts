import {blue, yellow, green, red} from '@colors/colors/safe'
import {DevOptions} from '../../commands/dev'

function getLoggingPrefix(
  browser: DevOptions['browser'],
  type: 'warn' | 'info' | 'error' | 'success'
): string {
  const arrow =
    type === 'warn'
      ? yellow('►►►')
      : type === 'info'
        ? blue('►►►')
        : type === 'error'
          ? red('✖︎✖︎✖︎')
          : green('►►►')
  return `${browser} ${arrow}`
}

export function capitalizedBrowserName(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

export function watchModeClosed(
  browser: DevOptions['browser'],
  code: number,
  reason: Buffer
) {
  const message = reason.toString()
  return (
    `${getLoggingPrefix(browser, 'error')} Watch mode closed (code ${code}). ` +
    `${message && '\n\nReason ' + message + '\n'}Exiting...\n`
  )
}

export function browserNotFound(
  browser: DevOptions['browser'],
  binaryPath: string
) {
  return `${getLoggingPrefix(browser, 'error')} ${capitalizedBrowserName(
    browser
  )} not found at ${binaryPath}`
}

export function webSocketError(browser: DevOptions['browser'], error: any) {
  error(`[⛔️] ${getLoggingPrefix(browser, 'error')} WebSocket error`, error)
}

export function parseFileError(
  browser: DevOptions['browser'],
  error: any,
  filepath: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error parsing file: ${filepath}. Reason: ${error.message}`
  )
}

export function browserNameCapitalized(browser: DevOptions['browser']) {
  return browser?.charAt(0).toUpperCase() + (browser?.slice(1) || '')
}

export function browserNotInstalled(
  browser: DevOptions['browser'],
  browserBinaryLocation: string
) {
  const isUnreacheable =
    browserBinaryLocation == 'null'
      ? 'is not installed.'
      : `is not found at ${browserBinaryLocation}`

  const browsername = browserNameCapitalized(browser)
  return (
    `${browser} browser ${isUnreacheable}. Either install ${browsername} ` +
    `or choose a different browser via ${blue('--browser')}.`
  )
}

export function creatingUserProfile(browser: DevOptions['browser']) {
  const browsername = browserNameCapitalized(browser)
  return `👤 Creating ${browsername} profile directory...`
}

export function browserInstanceAlreadyRunning(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'success')} Instance already running.`
}

export function browserInstanceExited(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'success')} Instance exited.`
}

export function errorInjectingAddOns(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error injecting extensions into ${capitalizedBrowserName(browser)} profile.`
  )
}

export function errorLaunchingBrowser(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error launching ${capitalizedBrowserName(browser)}.`
  )
}

export function generalBrowserError(
  browser: DevOptions['browser'],
  error: any
) {
  return `${getLoggingPrefix(browser, 'error')} ${error.stack}`
}

export function errorConnectingToBrowser(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'error')} Unable to connect to ` +
    `${capitalizedBrowserName(browser)}. Too many retries.`
  )
}

export function errorInstallingAddOn(
  browser: DevOptions['browser'],
  message: string
) {
  return `${getLoggingPrefix(browser, 'error')} Error while installing temporary addon: ${message}`
}

export function errorParsingMessage(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing message length.`
}

export function pathIsNotDir(browser: DevOptions['browser'], profilePath: string) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `The path ${profilePath} is not a directory. ` +
    `Please provide a valid directory path.`
  )
}