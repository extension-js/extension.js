import colors from 'pintor'
import packageJson from '../../../package.json'

// Helper function for consistent logging prefixes
type PrefixType = 'warn' | 'info' | 'error' | 'success'

export function capitalize(browser: any) {
  return browser.charAt(0).toUpperCase() + browser.slice(1)
}

function getLoggingPrefix(feature: string, type: PrefixType): string {
  // Prefix candidates (try swapping if desired): '►', '›', '→', '—'
  if (type === 'error') {
    return `${colors.red('ERROR')} ${feature}`
  }
  if (type === 'warn') {
    return `${colors.brightYellow('►►►')} ${feature}`
  }
  const arrow = type === 'info' ? colors.blue('►►►') : colors.green('►►►')
  return `${arrow} ${feature}`
}

const SI = 'Source Inspector'
const CDP = 'CDP Client'
const WS = 'WebSocket Server'
const FIREFOX_RDP = 'Firefox RDP Client'

export function sourceInspectorInitialized() {
  return getLoggingPrefix(SI, 'info') + ' initialized successfully'
}

export function sourceInspectorInitializationFailed(error: string) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Failed to initialize.\n${colors.red(error)}`
  )
}

export function sourceInspectorChromeDebuggingRequired(port: number) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Chrome is not running with remote debugging enabled on port ${colors.gray(port.toString())}. ` +
    `Ensure Chrome is launched with ${colors.blue('--remote-debugging-port')}=${colors.gray(port.toString())}`
  )
}

export function sourceInspectorFirefoxDebuggingRequired(port: number) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Firefox is not running with remote debugging enabled on port ${colors.gray(port.toString())}. ` +
    `Ensure Firefox is launched with ${colors.blue('-start-debugger-server')} ${colors.gray(port.toString())}`
  )
}

export function sourceInspectorWaitingForFirefox() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' is waiting for Firefox to be ready with remote debugging...'
  )
}

export function firefoxRemoteDebuggingReady() {
  return (
    getLoggingPrefix(SI, 'success') + ' Firefox is ready with remote debugging!'
  )
}

export function sourceInspectorFirefoxNotReadyYet(
  retries: number,
  maxRetries: number
) {
  return (
    getLoggingPrefix(SI, 'warn') +
    ` Firefox not ready yet, retrying... (${colors.gray(retries.toString())}/${colors.gray(maxRetries.toString())})`
  )
}

export function sourceInspectorWaitingForChrome() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' is waiting for Chrome to be ready with remote debugging...'
  )
}

export function chromeRemoteDebuggingReady() {
  return (
    getLoggingPrefix(SI, 'success') + ' Chrome is ready with remote debugging!'
  )
}

export function sourceInspectorChromeNotReadyYet(
  retries: number,
  maxRetries: number
) {
  return (
    getLoggingPrefix(SI, 'warn') +
    ` Chrome not ready yet, retrying... (${colors.gray(retries.toString())}/${colors.gray(maxRetries.toString())})`
  )
}

export function sourceInspectorOpeningUrl(url: string) {
  return (
    getLoggingPrefix(SI, 'info') + ` is opening URL: ${colors.underline(url)}`
  )
}

export function sourceInspectorWaitingForPageLoad() {
  return getLoggingPrefix(SI, 'info') + ' is waiting for the page to load...'
}

export function sourceInspectorCreatingTarget() {
  return getLoggingPrefix(SI, 'info') + ' is creating a new target...'
}

export function sourceInspectorFindingExistingTarget() {
  return getLoggingPrefix(SI, 'info') + ' is finding an existing target...'
}

export function sourceInspectorUsingExistingTarget(targetId: string) {
  return (
    getLoggingPrefix(SI, 'info') +
    ` is using existing target with ID: ${colors.gray(targetId)}`
  )
}

export function sourceInspectorTargetCreated(targetId: string) {
  return (
    getLoggingPrefix(SI, 'success') +
    ` created a target with ID: ${colors.gray(targetId)}`
  )
}

export function sourceInspectorAttachingToTarget() {
  return getLoggingPrefix(SI, 'info') + ' is attaching to the target...'
}

export function sourceInspectorAttachedToTarget(sessionId: string) {
  return (
    getLoggingPrefix(SI, 'success') +
    ` is attached to the target with session ID: ${colors.gray(sessionId)}`
  )
}

export function sourceInspectorExtractingHTML() {
  return getLoggingPrefix(SI, 'info') + ' is extracting page HTML...'
}

export function sourceInspectorHTMLExtractionComplete() {
  return getLoggingPrefix(SI, 'success') + ' HTML extraction is complete'
}

export function sourceInspectorInspectionFailed(error: string) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Failed to inspect source.\n${colors.red(error)}`
  )
}

// CDP Client Messages
export function cdpClientExtensionReloaded(extensionId: string) {
  return (
    getLoggingPrefix(CDP, 'success') +
    ` Extension ${colors.gray(extensionId)} successfully force-reloaded via CDP`
  )
}

export function cdpClientExtensionReloadFailed(
  extensionId: string,
  error: string
) {
  return (
    getLoggingPrefix(CDP, 'error') +
    ` Failed to force-reload extension ${colors.gray(extensionId)}.\n${colors.red(error)}`
  )
}

export function cdpClientExtensionUnloadFailed(
  extensionId: string,
  error: string
) {
  return (
    getLoggingPrefix(CDP, 'error') +
    ` Failed to unload extension ${colors.gray(extensionId)}.\n${colors.red(error)}`
  )
}

export function cdpClientExtensionInfoFailed(
  extensionId: string,
  error: string
) {
  return (
    getLoggingPrefix(CDP, 'error') +
    ` Failed to get extension info for ${colors.gray(extensionId)}.\n${colors.red(error)}`
  )
}

export function cdpClientExtensionLoadFailed(path: string, error: string) {
  return (
    getLoggingPrefix(CDP, 'error') +
    ` Failed to load extension from ${colors.underline(path)}.\n${colors.red(error)}`
  )
}

export function cdpClientConnected(host: string, port: number) {
  return (
    getLoggingPrefix(CDP, 'success') +
    ` is connected to ${colors.gray(host)}:${colors.gray(port.toString())}`
  )
}

export function cdpClientConnectionError(error: string) {
  return (
    getLoggingPrefix(CDP, 'error') + ` connection error.\n${colors.red(error)}`
  )
}

export function cdpClientBrowserConnectionEstablished() {
  return getLoggingPrefix(CDP, 'success') + ' browser connection established'
}

export function sourceInspectorStartingWatchMode() {
  return getLoggingPrefix(SI, 'info') + ' is starting watch mode for sources...'
}

export function sourceInspectorWatchModeActive() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' HTML will be updated automatically when files change'
  )
}

export function sourceInspectorWatchModeStopped() {
  return getLoggingPrefix(SI, 'warn') + ' watch mode stopped'
}

export function sourceInspectorCDPConnectionMaintained() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' CDP connection maintained for continuous monitoring'
  )
}

export function sourceInspectorNoActiveSession() {
  return (
    getLoggingPrefix(SI, 'warn') +
    ' has no active CDP session for file change monitoring'
  )
}

export function sourceInspectorReExtractingHTML() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' is re-extracting page HTML after a file change...'
  )
}

export function sourceInspectorAttemptingReconnection() {
  return (
    getLoggingPrefix(SI, 'warn') +
    ' is attempting to reconnect to the target...'
  )
}

export function sourceInspectorCannotReconnect() {
  return (
    getLoggingPrefix(SI, 'error') +
    ' Cannot reconnect: missing CDP client or target ID'
  )
}

export function sourceInspectorReconnectingToTarget() {
  return getLoggingPrefix(SI, 'info') + ' is reconnecting to the target...'
}

export function sourceInspectorReconnectedToTarget(sessionId: string) {
  return (
    getLoggingPrefix(SI, 'success') +
    ` is reconnected to the target with session ID: ${colors.gray(sessionId)}`
  )
}

export function sourceInspectorReconnectionFailed(error: string) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Failed to reconnect to target.\n${colors.red(error)}`
  )
}

export function sourceInspectorEnsuringNavigation() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' is ensuring the target navigates to the URL...'
  )
}

export function sourceInspectorEnablingPageDomain() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' is enabling the page domain for load events...'
  )
}

export function sourceInspectorWaitingForContentScripts() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' is waiting for content scripts to inject...'
  )
}

export function sourceInspectorWaitingForContentScriptReinjection() {
  return (
    getLoggingPrefix(SI, 'info') +
    ' is waiting for content scripts to reinject...'
  )
}

export function sourceInspectorFileChanged() {
  return getLoggingPrefix(SI, 'warn') + ' Source file changed, updating HTML...'
}

export function sourceInspectorHTMLUpdateFailed(error: string) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Failed to update HTML.\n${colors.red(error)}`
  )
}

export function sourceInspectorCleanupComplete() {
  return getLoggingPrefix(SI, 'success') + ' cleaned up'
}

export function sourceInspectorCleanupError(error: string) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Error during cleanup.\n${colors.red(error)}`
  )
}

// HTML Entrypoint change message used by the reload plugin when forcing recompilation
export function htmlEntrypointChangeRestarting() {
  return (
    getLoggingPrefix('HTML', 'warn') +
    ' Entrypoint change detected. Restarting dev server to recompile…'
  )
}

export function manifestEntrypointChangeRestarting(filePath: string) {
  return (
    getLoggingPrefix('manifest.json', 'warn') +
    ` Entrypoint change detected at ${colors.underline(filePath)}. Restarting dev server to recompile…`
  )
}

export function sourceInspectorNotInitialized() {
  return getLoggingPrefix(SI, 'error') + ' not initialized'
}

export function sourceInspectorInvalidWebSocketServer() {
  return getLoggingPrefix(SI, 'warn') + ' Invalid WebSocket server provided'
}

export function sourceInspectorUrlRequired() {
  return (
    getLoggingPrefix(SI, 'error') +
    ` requires either ${colors.blue('--source')} ${colors.gray('<url>')} or ${colors.blue('--starting-url')} ${colors.gray('<url>')} to be specified`
  )
}

export function sourceInspectorWillInspect(url: string) {
  return (
    getLoggingPrefix(SI, 'info') + ` will inspect: ${colors.underline(url)}`
  )
}

export function sourceInspectorSetupFailed(error: string) {
  return (
    getLoggingPrefix(SI, 'error') +
    ` Failed to setup source inspection.\n${colors.red(error)}`
  )
}

// HTML Output formatting
export function sourceInspectorHTMLOutputHeader() {
  return '\n' + '='.repeat(80)
}

export function sourceInspectorHTMLOutputTitle(title: string) {
  return `${colors.bold(colors.blue('PAGE HTML'))} ${colors.gray('(')}${colors.gray(title)}${colors.gray(')')}:`
}

export function sourceInspectorHTMLOutputFooter() {
  return '='.repeat(80) + '\n'
}

// CDP Client messages
export function cdpClientFoundTargets(count: number) {
  return (
    getLoggingPrefix(CDP, 'info') +
    ` found ${colors.gray(count.toString())} targets`
  )
}

export function cdpClientUsingTarget(title: string, url: string) {
  return (
    getLoggingPrefix(CDP, 'info') +
    ` is using target: ${colors.gray(title)} (${colors.underline(url)})`
  )
}

export function cdpClientTargetWebSocketUrlStored() {
  return (
    getLoggingPrefix(CDP, 'info') +
    ' has stored the target WebSocket URL for future connections'
  )
}

export function cdpClientConnectionClosed() {
  return getLoggingPrefix(CDP, 'warn') + ' connection is closed'
}

export function cdpClientMessageParseError(error: string) {
  return (
    getLoggingPrefix(CDP, 'error') +
    ` Failed to parse CDP message.\n${colors.red(error)}`
  )
}

export function cdpClientPageLoadEventFired() {
  return getLoggingPrefix(CDP, 'info') + ' Page load event occurred'
}

export function cdpClientLoadEventTimeout() {
  return (
    getLoggingPrefix(CDP, 'warn') + ' Load event timeout, proceeding anyway...'
  )
}

export function cdpClientTestingEvaluation() {
  return getLoggingPrefix(CDP, 'info') + ' Testing basic CDP evaluation...'
}

export function cdpClientDocumentTitle(title: string) {
  return (
    getLoggingPrefix(CDP, 'info') + ` Document title: ${colors.gray(title)}`
  )
}

export function cdpClientGettingMainHTML() {
  return getLoggingPrefix(CDP, 'info') + ' is getting main HTML...'
}

export function cdpClientMainHTMLLength(length: number) {
  return (
    getLoggingPrefix(CDP, 'info') +
    ` Main HTML length: ${colors.gray(length.toString())}`
  )
}

export function cdpClientFailedToGetMainHTML() {
  return getLoggingPrefix(CDP, 'error') + ' Failed to get main HTML'
}

export function cdpClientCheckingShadowDOM() {
  return getLoggingPrefix(CDP, 'info') + ' is checking for Shadow DOM...'
}

export function cdpClientShadowDOMContentFound(found: boolean) {
  return (
    getLoggingPrefix(CDP, 'info') +
    ` Shadow DOM content found: ${found ? colors.gray('yes') : colors.gray('no')}`
  )
}

export function cdpClientShadowDOMContentLength(length: number) {
  return (
    getLoggingPrefix(CDP, 'info') +
    ` Shadow DOM content length: ${colors.gray(length.toString())}`
  )
}

export function cdpClientProcessingShadowDOM() {
  return getLoggingPrefix(CDP, 'info') + ' Processing Shadow DOM content...'
}

export function cdpClientFinalHTMLWithShadowDOMLength(length: number) {
  return (
    getLoggingPrefix(CDP, 'info') +
    ` Final HTML with Shadow DOM length: ${colors.gray(length.toString())}`
  )
}

export function cdpClientReturningMainHTML() {
  return (
    getLoggingPrefix(CDP, 'info') + ' is returning main HTML without Shadow DOM'
  )
}

// WebSocket Server Messages
export function webSocketServerInitialized() {
  return (
    getLoggingPrefix(WS, 'success') + ' initialized for file change monitoring'
  )
}

export function webSocketServerInitializationFailed(error: string) {
  return (
    getLoggingPrefix(WS, 'error') +
    ` Failed to initialize.\n${colors.red(error)}`
  )
}

export function webSocketServerPluginApplyFailed(error: string) {
  return (
    getLoggingPrefix(WS, 'error') +
    ` Failed to initialize during plugin apply.\n${colors.red(error)}`
  )
}

export function fileUpdated(relativePath: string, context: string) {
  return (
    getLoggingPrefix(WS, 'info') +
    ` Updated file \`${relativePath}\` ${colors.gray('(')}${colors.gray('relative to ')}${colors.underline(context)}${colors.gray(')')}`
  )
}

export function webSocketServerNotReady() {
  return (
    getLoggingPrefix(WS, 'warn') + ' not ready for file change notification'
  )
}

export function webSocketServerNotRunning() {
  return getLoggingPrefix(WS, 'error') + ' is not running'
}

// Start Server Messages
export function ignoringMessageFromWrongInstance(
  actualInstanceId: string,
  expectedInstanceId: string
) {
  return (
    getLoggingPrefix(WS, 'warn') +
    ` Ignoring message from wrong instance: ${colors.gray(actualInstanceId)} (expected: ${colors.gray(expectedInstanceId)})`
  )
}

export function failedToUpdateInstanceWithExtensionId(error: string) {
  return (
    getLoggingPrefix(WS, 'error') +
    ` Failed to update instance with extension ID.\n${colors.red(error)}`
  )
}

export function webSocketServerForInstanceClosed(instanceId: string) {
  return (
    getLoggingPrefix(WS, 'success') +
    ` for instance ${colors.yellow(instanceId.slice(0, 8))} closed`
  )
}

// Additional Start Server Messages
export function webSocketError(error: any) {
  return (
    getLoggingPrefix(WS, 'error') +
    ` WebSocket error.\n${colors.red(String(error))}`
  )
}

export function isFirstRun(browser: any) {
  return (
    getLoggingPrefix('This is the first time you are running', 'info') +
    ` ${capitalize(browser)} with Extension.js. Welcome!`
  )
}

export function certRequired() {
  return (
    getLoggingPrefix('Certificate', 'warn') +
    ' required for Firefox development'
  )
}

export function webSocketConnectionCloseError(error: unknown) {
  return (
    getLoggingPrefix(WS, 'error') +
    ` Error closing WebSocket connection.\n${colors.red(String(error))}`
  )
}

// Firefox RDP Client messages
export function firefoxRdpClientFoundTargets(count: number) {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'info') +
    ` Found ${colors.gray(count.toString())} Firefox targets`
  )
}

export function firefoxRdpClientUsingTarget(title: string, url: string) {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'info') +
    ` is using Firefox target: ${colors.gray(title)} (${colors.underline(url)})`
  )
}

export function firefoxRdpClientConnected(host: string, port: number) {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'success') +
    ` Connected to Firefox Remote Debugging Protocol on ${colors.gray(host)}:${colors.gray(port.toString())}`
  )
}

export function firefoxRdpClientConnectionError(error: string) {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'error') +
    ` Firefox RDP connection error.\n${colors.red(error)}`
  )
}

export function firefoxRdpClientConnectionClosed() {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'warn') + ' Firefox RDP connection is closed'
  )
}

export function firefoxRdpClientNoSuitableTargets() {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'error') +
    ' No suitable Firefox targets available'
  )
}

export function firefoxRdpClientPageLoadEventFired() {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'info') + ' Firefox page load event occurred'
  )
}

export function firefoxRdpClientLoadEventTimeout() {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'warn') +
    ' Firefox load event timed out; proceeding anyway...'
  )
}

export function firefoxRdpClientTestingEvaluation() {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'info') +
    ' Testing basic Firefox RDP evaluation...'
  )
}

export function firefoxRdpClientDocumentTitle(title: string) {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'info') +
    ` Firefox document title: ${colors.gray(title)}`
  )
}

export function firefoxRdpClientFailedToGetMainHTML() {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'error') + ' Failed to get Firefox main HTML'
  )
}

export function firefoxRdpClientFinalHTMLLength(length: number) {
  return (
    getLoggingPrefix(FIREFOX_RDP, 'info') +
    ` Firefox final HTML length: ${colors.gray(length.toString())}`
  )
}

export function emptyLine() {
  return ''
}

export function runningInDevelopment(
  manifest: any,
  browser: any,
  message: {data?: any}
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
      `${getLoggingPrefix(manifestName, 'error')} No Client Data Received for ${manifestName}\n\n` +
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

  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      return `${getLoggingPrefix(
        manifestName,
        'error'
      )} No management API info received from client. Investigate.`
    }
  }

  const {name, version} = management

  const lines = [
    ` 🧩 ${colors.brightBlue('Extension.js')} ${colors.gray(`${packageJson.version}`)}`,
    `${`    Extension Name        `} ${colors.gray(name)}`,
    `${`    Extension Version     `} ${colors.gray(version)}`,
    `${`    Extension ID          `} ${colors.gray(id)}`
  ]

  return lines.join('\n')
}
