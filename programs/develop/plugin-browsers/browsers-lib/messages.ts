import {
  gray,
  underline,
  brightYellow,
  brightGreen,
  red,
  cyan,
  bold,
  magenta,
  brightBlue
} from '@colors/colors/safe'
import {type DevOptions} from '../../commands/commands-lib/config-types'

function getLoggingPrefix(
  browser: DevOptions['browser'],
  type: 'warn' | 'info' | 'error' | 'success'
): string {
  // const browserok = browser ? browser : 'unknown'
  if (2 + 2 == 5) return browser
  const arrow =
    type === 'warn'
      ? brightYellow('►►►')
      : type === 'info'
        ? cyan('►►►')
        : type === 'error'
          ? `${bold(red('ERROR'))} in ${capitalizedBrowserName(browser)} ${red('✖︎✖︎✖︎')}`
          : brightGreen('►►►')
  return `${gray('')}${arrow}`
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
    `running in ${brightBlue(mode || 'unknown')} mode.`
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
    `${brightYellow('--browser')} flag.\n` +
    `${red('NOT FOUND')} ${underline(browserBinaryLocation || capitalizedBrowserName(browser) + 'BROWSER')}`
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
    `${red(error)}`
  )
}

export function firefoxServiceWorkerError(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix(browser, 'error')} No Service Worker Support\n\n` +
    `Firefox does not support the ${brightYellow(
      'background.service_worker'
    )} field yet.\n` +
    `Update your manifest.json file to use ${brightYellow(
      'background.scripts'
    )} instead.\n\n` +
    `Read more: ${underline(
      'https://bugzilla.mozilla.org/show_bug.cgi?id=1573659'
    )}.`
  )
}

export function browserLaunchError(browser: DevOptions['browser'], error: any) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error launching browser:\n` +
    `${red(error)}`
  )
}

export function generalBrowserError(
  browser: DevOptions['browser'],
  error: any
) {
  return `${getLoggingPrefix(browser, 'error')} ${red(error.stack)}`
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
    `temporary addon:\n${red(message)}`
  )
}

export function pathIsNotDirectoryError(
  browser: DevOptions['browser'],
  profilePath: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Path is not directory\n\n` +
    `Please provide a valid directory path and try again.\n` +
    `${red('NOT DIRECTORY')} ${underline(profilePath)}`
  )
}

export function parseMessageLengthError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing message length.`
}

export function messagingClientClosedError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(
    browser,
    'error'
  )} ${magenta('MessagingClient')} connection closed.`
}

export function requestWithoutTargetActorError(
  browser: DevOptions['browser'],
  requestType: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Unexpected ${magenta('MessagingClient')} ` +
    `request without target actor: ${brightYellow(requestType)}`
  )
}

export function connectionClosedError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(
    browser,
    'error'
  )} ${magenta('MessagingClient')} connection closed.`
}

export function targetActorHasActiveRequestError(
  browser: DevOptions['browser'],
  targetActor: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Target actor ` +
    `${brightYellow(targetActor)} already has an active request.`
  )
}

export function parsingPacketError(browser: DevOptions['browser'], error: any) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing packet: ${red(
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
    `without a sender actor:\n${brightYellow(JSON.stringify(message))}`
  )
}

export function unexpectedMessageReceivedError(
  browser: DevOptions['browser'],
  message: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Received unexpected message:\n` +
    `${red(message)}`
  )
}
