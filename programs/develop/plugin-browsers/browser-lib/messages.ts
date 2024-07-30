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

export function pathIsNotDir(
  browser: DevOptions['browser'],
  profilePath: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `The path ${profilePath} is not a directory. ` +
    `Please provide a valid directory path.`
  )
}

export function parseMessageLengthError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing message length.`
}

export function messagingClientClosed(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'error')} MessagingClient connection closed.`
}

export function requestWithoutTargetActor(
  browser: DevOptions['browser'],
  requestType: string
) {
  return `${getLoggingPrefix(browser, 'error')} Unexpected MessagingClient request without target actor: ${requestType}`
}

export function connectionClosed(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'error')} MessagingClient connection closed.`
}

export function targetActorHasActiveRequest(
  browser: DevOptions['browser'],
  targetActor: string
) {
  return `${getLoggingPrefix(browser, 'error')} Target actor ${targetActor} already has an active request.`
}

export function errorParsingPacket(browser: DevOptions['browser'], error: any) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing packet: ${error}`
}
export function messageWithoutSender(
  browser: DevOptions['browser'],
  message: {
    from?: string
    type?: string
    error?: any
  }
) {
  return `${getLoggingPrefix(browser, 'error')} Message received without a sender actor: ${JSON.stringify(message)}`
}

export function unexpectedMessageReceived(
  browser: DevOptions['browser'],
  message: string
) {
  return `${getLoggingPrefix(browser, 'error')} Received unexpected message: ${message}`
}
