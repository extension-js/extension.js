import {
  gray,
  underline,
  brightYellow,
  brightGreen,
  red,
  cyan
} from '@colors/colors/safe'
import {DevOptions} from '../../commands/dev'

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
          ? red('✖︎✖︎✖︎')
          : brightGreen('►►►')
  return `${gray('')}${arrow}`
}

export function capitalizedBrowserName(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

export function stdoutData(
  // name: string,
  browser: DevOptions['browser'],
  mode: DevOptions['mode']
) {
  const extensionOutput = browser === 'firefox' ? 'Add-on' : 'Extension'
  return (
    `${getLoggingPrefix(browser, 'success')} ` +
    `${capitalizedBrowserName(browser)} ${extensionOutput} ` +
    // `${cyan(name)} ` +
    `running in ${cyan(mode || 'unknown')} mode.`
  )
}

export function browserNotInstalled(
  browser: DevOptions['browser'],
  browserBinaryLocation: string
) {
  const browsername = capitalizedBrowserName(browser)
  const isUnreacheable =
    browserBinaryLocation == 'null'
      ? `${browsername} browser is not installed.\n\n`
      : `Path to ${browsername} browser is not found. \n\n${red(
          'NOT FOUND'
        )} ` + `${underline(browserBinaryLocation)}\n\n`

  return (
    `${getLoggingPrefix(browser, 'error')} ${isUnreacheable}` +
    `Either install the ${browsername} or choose a different browser via ` +
    `${brightYellow('--browser')} flag.`
  )
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

export function errorInjectingAddOns(
  browser: DevOptions['browser'],
  error: any
) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error injecting extensions into ${capitalizedBrowserName(
      browser
    )} profile.` +
    `\n\n${red(error)}`
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

export function errorLaunchingBrowser(
  browser: DevOptions['browser'],
  error: any
) {
  return (
    `${getLoggingPrefix(browser, 'error')} ` +
    `Error launching ${capitalizedBrowserName(browser)}. Error:` +
    `\n\n${red(error)}`
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

export function errorInstallingAddOn(
  browser: DevOptions['browser'],
  message: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Error while installing ` +
    `temporary addon: ${red(message)}`
  )
}

export function pathIsNotDir(
  browser: DevOptions['browser'],
  profilePath: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} The path is not a directory.\n\n` +
    `${gray('PATH')} ${underline(profilePath)}\n\n` +
    `Please provide a valid directory path.`
  )
}

export function parseMessageLengthError(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing message length.`
}

export function messagingClientClosed(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(
    browser,
    'error'
  )} MessagingClient connection closed.`
}

export function requestWithoutTargetActor(
  browser: DevOptions['browser'],
  requestType: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Unexpected MessagingClient ` +
    `request without target actor: ${brightYellow(requestType)}`
  )
}

export function connectionClosed(browser: DevOptions['browser']) {
  return `${getLoggingPrefix(
    browser,
    'error'
  )} MessagingClient connection closed.`
}

export function targetActorHasActiveRequest(
  browser: DevOptions['browser'],
  targetActor: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Target actor ` +
    `${brightYellow(targetActor)} already has an active request.`
  )
}

export function errorParsingPacket(browser: DevOptions['browser'], error: any) {
  return `${getLoggingPrefix(browser, 'error')} Error parsing packet: ${red(
    error
  )}`
}
export function messageWithoutSender(
  browser: DevOptions['browser'],
  message: {
    from?: string
    type?: string
    error?: any
  }
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Message received ` +
    `without a sender actor: ${brightYellow(JSON.stringify(message))}`
  )
}

export function unexpectedMessageReceived(
  browser: DevOptions['browser'],
  message: string
) {
  return (
    `${getLoggingPrefix(browser, 'error')} Received unexpected message: ` +
    `${red(message)}`
  )
}
