import colors from 'pintor'
import type {DevOptions} from '../../../develop-lib/config-types'

type Browser = NonNullable<DevOptions['browser']>
type Mode = DevOptions['mode']

// Prefix candidates (try swapping if desired): '►', '›', '→', '—'
function getLoggingPrefix(type: 'warn' | 'info' | 'error' | 'success'): string {
  if (type === 'error') return colors.red('ERROR')
  if (type === 'warn') return colors.brightYellow('►►►')
  if (type === 'info') return colors.blue('►►►')
  return colors.green('►►►')
}

export function capitalizedBrowserName(browser: Browser): string {
  return `${browser.charAt(0).toUpperCase() + browser.slice(1)}`
}

export function creatingUserProfile(browser: Browser): string {
  const browsername = capitalizedBrowserName(browser)
  return `${getLoggingPrefix('info')} Creating new user profile for ${browsername}...`
}

export function browserInstanceAlreadyRunning(browser: Browser): string {
  return `${getLoggingPrefix('success')} ${capitalizedBrowserName(browser)} instance already running.`
}

export function browserInstanceExited(browser: Browser): string {
  return `${getLoggingPrefix('info')} ${capitalizedBrowserName(browser)} instance exited.`
}

export function stdoutData(browser: Browser, mode: Mode): string {
  const extensionOutput =
    browser === 'firefox' || browser === 'gecko-based' ? 'Add-on' : 'Extension'
  return `${getLoggingPrefix('info')} ${capitalizedBrowserName(browser)} ${extensionOutput} running in ${mode || 'unknown'} mode.`
}

export function browserNotInstalledError(
  browser: Browser,
  browserBinaryLocation: string
): string {
  const isUnreachable =
    browserBinaryLocation == 'null'
      ? `Browser ${capitalizedBrowserName(browser)} is not installed\n`
      : `Can't find the path for browser ${capitalizedBrowserName(browser)}\n`

  return (
    `${getLoggingPrefix('error')} ${isUnreachable}` +
    `Either install the missing browser or choose a different one via ` +
    `${colors.blue('--browser')} ${colors.gray('<chrome|edge|firefox>')}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(browserBinaryLocation || capitalizedBrowserName(browser) + 'BROWSER')}`
  )
}

export function injectingAddOnsError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix('error')} Can't inject extensions into ${capitalizedBrowserName(browser)} profile\n` +
    `${colors.red(String(error))}`
  )
}

export function firefoxServiceWorkerError(browser: Browser): string {
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

export function browserLaunchError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix('error')} Error launching ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(String(error))}`
  )
}

// Process Management messages
export function enhancedProcessManagementStarting(browser: Browser): string {
  return `${getLoggingPrefix('info')} Process Management starting for ${capitalizedBrowserName(browser)}`
}

export function enhancedProcessManagementCleanup(browser: Browser): string {
  return `${getLoggingPrefix('info')} Process Management cleanup for ${capitalizedBrowserName(browser)}`
}

export function enhancedProcessManagementTerminating(browser: Browser): string {
  return `${getLoggingPrefix('info')} Terminating ${capitalizedBrowserName(browser)} process gracefully`
}

export function enhancedProcessManagementForceKill(browser: Browser): string {
  return `${getLoggingPrefix('error')} Force killing ${capitalizedBrowserName(browser)} process after timeout`
}

export function enhancedProcessManagementCleanupError(
  browser: Browser,
  error: unknown
): string {
  return (
    `${getLoggingPrefix('error')} Error during ${capitalizedBrowserName(browser)} cleanup:\n` +
    `${colors.red(String(error))}`
  )
}

export function enhancedProcessManagementInstanceCleanup(
  browser: Browser
): string {
  return `${getLoggingPrefix('info')} Cleaning up ${capitalizedBrowserName(browser)} instance`
}

export function enhancedProcessManagementInstanceCleanupComplete(
  browser: Browser
): string {
  return `${getLoggingPrefix('success')} ${capitalizedBrowserName(browser)} instance cleanup completed`
}

export function enhancedProcessManagementSignalHandling(
  browser: Browser
): string {
  return `${getLoggingPrefix('info')} Enhanced signal handling enabled for ${capitalizedBrowserName(browser)}`
}

export function enhancedProcessManagementUncaughtException(
  browser: Browser,
  error: unknown
): string {
  return (
    `${getLoggingPrefix('error')} Uncaught exception in ${capitalizedBrowserName(browser)} process:\n` +
    `${colors.red(String(error))}`
  )
}

export function enhancedProcessManagementUnhandledRejection(
  browser: Browser,
  reason: unknown
): string {
  return (
    `${getLoggingPrefix('error')} Unhandled rejection in ${capitalizedBrowserName(browser)} process:\n` +
    `${colors.red(String(reason))}`
  )
}

export function generalBrowserError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix('error')} General error in ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(String(error))}`
  )
}

export function errorConnectingToBrowser(browser: Browser): string {
  return `${getLoggingPrefix('error')} Unable to connect to ${capitalizedBrowserName(browser)}. Too many retries.`
}

export function addonInstallError(browser: Browser, message: string): string {
  return (
    `${getLoggingPrefix('error')} Can't install add-on into ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(message)}`
  )
}

export function pathIsNotDirectoryError(
  browser: Browser,
  profilePath: string
): string {
  return (
    `${getLoggingPrefix('error')} Profile path for ${capitalizedBrowserName(browser)} is not a directory.\n` +
    `${colors.gray('PATH')} ${colors.underline(profilePath)}`
  )
}

// removed: parseMessageLengthError (replaced by shared rdp-wire helpers)

export function messagingClientClosedError(browser: Browser): string {
  return `${getLoggingPrefix('error')} Messaging client closed unexpectedly for ${capitalizedBrowserName(browser)}`
}

export function requestWithoutTargetActorError(
  browser: Browser,
  requestType: string
): string {
  return `${getLoggingPrefix('error')} Request without target actor: ${colors.gray(requestType)} for ${capitalizedBrowserName(browser)}`
}

export function connectionClosedError(browser: Browser): string {
  return `${getLoggingPrefix('error')} Connection closed unexpectedly for ${capitalizedBrowserName(browser)}`
}

export function targetActorHasActiveRequestError(
  browser: Browser,
  targetActor: string
): string {
  return `${getLoggingPrefix('error')} Target actor ${colors.gray(targetActor)} has active request for ${capitalizedBrowserName(browser)}`
}

export function parsingPacketError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix('error')} Failed to parse packet from ${capitalizedBrowserName(browser)}:\n` +
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
    `${getLoggingPrefix('error')} Message without sender from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(JSON.stringify(message))}`
  )
}

export function unexpectedMessageReceivedError(
  browser: Browser,
  message: string
): string {
  return (
    `${getLoggingPrefix('error')} Unexpected message received from ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(message)}`
  )
}

// Debug messages - only used in development mode
export function isUsingStartingUrl(browser: Browser, value: unknown): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} ${capitalizedBrowserName(browser)} using starting URL: ${String(value)}`
}

export function isUsingBrowserBinary(
  binary: string,
  binaryPath: unknown
): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Using ${colors.gray(binary)} binary: ${colors.gray(String(binaryPath))}`
}

export function isUsingProfile(browser: Browser, profilePath: unknown): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} ${capitalizedBrowserName(browser)} using profile: ${colors.underline(String(profilePath))}`
}

export function isUsingPreferences(browser: Browser): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Using custom preferences for ${capitalizedBrowserName(browser)}`
}

export function isUsingBrowserFlags(browser: Browser): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Using custom browser flags for ${capitalizedBrowserName(browser)}`
}

export function isBrowserLauncherOpen(
  browser: Browser,
  isOpen: boolean
): string {
  return `${getLoggingPrefix('info')} Browser launcher for ${capitalizedBrowserName(browser)} is ${isOpen ? colors.green('open') : colors.red('closed')}`
}

export function pathDoesNotExistError(
  browser: Browser,
  profilePath: string
): string {
  return (
    `${getLoggingPrefix('error')} Profile path for ${capitalizedBrowserName(browser)} does not exist.\n` +
    `${colors.gray('PATH')} ${colors.underline(profilePath)}`
  )
}

export function pathPermissionError(
  browser: Browser,
  profilePath: string
): string {
  return (
    `${getLoggingPrefix('error')} Insufficient permissions for the profile path for ${capitalizedBrowserName(browser)}.\n` +
    `${colors.gray('PATH')} ${colors.underline(profilePath)}`
  )
}

export function profileCreationError(browser: Browser, error: unknown): string {
  return (
    `${getLoggingPrefix('error')} Failed to create profile for ${capitalizedBrowserName(browser)}:\n` +
    `${colors.red(String(error))}`
  )
}

// Chrome/Chromium specific messages
export function chromeProcessExited(code: number): string {
  return `${getLoggingPrefix('info')} Chrome process exited with code: ${colors.gray(code.toString())}`
}

export function chromeProcessError(error: unknown): string {
  return `${getLoggingPrefix('error')} Chrome process error:\n${colors.red(String(error))}`
}

export function chromeFailedToSpawn(error: unknown): string {
  return `${getLoggingPrefix('error')} Failed to spawn Chrome:\n${colors.red(String(error))}`
}

export function chromeInitializingEnhancedReload(): string {
  return `${getLoggingPrefix('info')} Initializing enhanced reload service with direct spawn for Chrome`
}

// Firefox specific messages
export function firefoxLaunchCalled(): string {
  return `${getLoggingPrefix('info')} launchFirefox called!`
}

export function firefoxDetectionFailed(error: unknown): string {
  return `${getLoggingPrefix('error')} Firefox detection failed:\n${colors.red(String(error))}`
}

export function firefoxBinaryArgsExtracted(args: string): string {
  return `${getLoggingPrefix('info')} Firefox binary args extracted: ${colors.gray(args)}`
}

export function firefoxNoBinaryArgsFound(): string {
  return `${getLoggingPrefix('info')} No Firefox binary args found`
}

export function firefoxFailedToExtractProfilePath(): string {
  return `${getLoggingPrefix('error')} Failed to extract profile path from Firefox config`
}

// removed: firefoxRunFirefoxPluginApplyArguments (no longer used)

export function firefoxFailedToStart(error: unknown): string {
  return `${getLoggingPrefix('error')} Firefox failed to start:\n${colors.red(String(error))}`
}

// Instance Manager health monitoring messages
// NOTE: Instance Manager messages are owned by webpack/lib/messages. Keep only browser-specific ones here.
export function instanceManagerHealthMonitoringStart(
  instanceId: string
): string {
  return `${getLoggingPrefix('info')} Starting health monitoring for Chrome instance ${colors.brightBlue(instanceId.slice(0, 8))}`
}

export function instanceManagerHealthMonitoringPassed(
  instanceId: string
): string {
  return `${getLoggingPrefix('success')} Chrome instance ${colors.brightBlue(instanceId.slice(0, 8))} health check passed`
}

export function instanceManagerHealthMonitoringOrphaned(
  instanceId: string
): string {
  return `${getLoggingPrefix('warn')} Chrome instance ${colors.brightBlue(instanceId.slice(0, 8))} appears orphaned, cleaning up`
}

export function instanceManagerHealthMonitoringFailed(
  instanceId: string,
  error: unknown
): string {
  return (
    `${getLoggingPrefix('error')} Health check failed for Chrome instance ${colors.brightBlue(instanceId.slice(0, 8))}:\n` +
    `${colors.red(String(error))}`
  )
}

export function instanceManagerForceCleanupProject(
  projectPath: string
): string {
  return `${getLoggingPrefix('info')} Force cleaning up all Chrome processes for project: ${colors.underline(projectPath)}`
}

export function instanceManagerForceCleanupFound(
  instanceCount: number
): string {
  return `${getLoggingPrefix('info')} Found ${colors.brightBlue(instanceCount.toString())} Chrome instances to clean up`
}

export function instanceManagerForceCleanupInstance(
  instanceId: string
): string {
  return `${getLoggingPrefix('info')} Cleaning up Chrome instance ${colors.brightBlue(instanceId.slice(0, 8))}`
}

export function instanceManagerForceCleanupTerminating(
  processId: number
): string {
  return `${getLoggingPrefix('info')} Terminating Chrome process ${colors.brightBlue(processId.toString())}`
}

export function instanceManagerForceCleanupForceKilled(
  processId: number
): string {
  return `${getLoggingPrefix('error')} Force killed Chrome process ${colors.brightBlue(processId.toString())}`
}

export function instanceManagerForceCleanupInstanceTerminated(
  instanceId: string
): string {
  return `${getLoggingPrefix('success')} Chrome instance ${colors.brightBlue(instanceId.slice(0, 8))} marked as terminated`
}

export function instanceManagerForceCleanupError(
  instanceId: string,
  error: unknown
): string {
  return (
    `${getLoggingPrefix('error')} Error terminating Chrome instance ${colors.brightBlue(instanceId.slice(0, 8))}:\n` +
    `${colors.red(String(error))}`
  )
}

export function instanceManagerForceCleanupComplete(): string {
  return `${getLoggingPrefix('success')} Chrome project cleanup completed`
}

export function sourceInspectorInitialized() {
  return `${getLoggingPrefix('info')} Chrome source inspector initialized successfully`
}

export function sourceInspectorInitializationFailed(error: string) {
  return `${getLoggingPrefix('error')} Failed to initialize Chrome source inspector: ${colors.red(error)}`
}

export function sourceInspectorChromeDebuggingRequired(port: number) {
  return (
    `${getLoggingPrefix('error')} Chrome is not running with remote debugging enabled on port ${colors.gray(port.toString())}. ` +
    `Ensure Chrome is launched with ${colors.blue('--remote-debugging-port')}=${colors.gray(port.toString())}`
  )
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

export function cdpClientDocumentTitle(title: string) {
  return `${getLoggingPrefix('info')} Chrome document title: ${colors.gray(title)}`
}

export function cdpClientGettingMainHTML() {
  return `${getLoggingPrefix('info')} Chrome is getting main HTML...`
}

export function cdpClientMainHTMLLength(length: number) {
  return `${getLoggingPrefix('info')} Chrome main HTML length: ${colors.gray(length.toString())}`
}

export function cdpClientFailedToGetMainHTML() {
  return `${getLoggingPrefix('error')} Failed to get Chrome main HTML`
}

export function cdpClientCheckingShadowDOM() {
  return `${getLoggingPrefix('info')} Chrome checking for Shadow DOM...`
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

  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      return `${getLoggingPrefix('error')} No management API info received from client for ${manifestName}. Investigate.`
    }
  }

  const {name, version} = management
  const extensionVersion = require('../../../package.json').version
  return `${
    ` 🧩 ${colors.blue('Extension.js')} ${colors.gray(`${extensionVersion}`)}\n` +
    `${`   Extension Name        `} ${colors.gray(name)}\n` +
    `${`   Extension Version     `} ${colors.gray(version)}\n` +
    `${`   Extension ID          `} ${colors.gray(id)}\n` +
    `${`   Extension Environment `} ${colors.gray(process.env.EXTENSION_ENV || 'development')}`
  }`
}

export function emptyLine() {
  return ''
}

export function devChromiumDebugPort(
  finalPort: number,
  requestedPort: number
): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Chromium debug port: ${colors.gray(finalPort.toString())} (requested ${colors.gray(requestedPort.toString())})`
}

export function devFirefoxDebugPort(
  finalPort: number,
  requestedPort: number
): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Firefox debug port: ${colors.gray(finalPort.toString())} (requested ${colors.gray(requestedPort.toString())})`
}

export function devFirefoxProfilePath(profilePath: string): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Dev')} Firefox profile: ${colors.underline(profilePath)}`
}
