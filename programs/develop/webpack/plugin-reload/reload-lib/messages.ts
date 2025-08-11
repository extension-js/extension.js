import colors from 'pintor'

// Helper function for consistent logging prefixes
type PrefixType = 'warn' | 'info' | 'error' | 'success'

function getLoggingPrefix(feature: string, type: PrefixType): string {
  // For errors we use "ERROR" format
  if (type === 'error') {
    return `${colors.bold(colors.red('ERROR'))} in ${feature} ${colors.red('ERROR')}`
  }

  // For warns we use "►►►" format
  if (type === 'warn') {
    return `${colors.yellow('►►►')} ${colors.cyan(feature)}`
  }

  const arrow = type === 'info' ? colors.cyan('►►►') : colors.green('►►►')

  return `${arrow} ${colors.cyan(feature)}`
}

export function sourceInspectorInitialized() {
  return `${colors.cyan('►►►')} Source inspector initialized successfully`
}

export function sourceInspectorInitializationFailed(error: string) {
  return `${colors.red('ERROR')} Failed to initialize source inspector: ${error}`
}

export function sourceInspectorChromeDebuggingRequired(port: number) {
  return (
    `${colors.red('ERROR')} Chrome is not running with remote debugging enabled on port ${port}. ` +
    `Please ensure Chrome is launched with --remote-debugging-port=${port}`
  )
}

export function sourceInspectorWaitingForChrome() {
  return `${colors.cyan('►►►')} Waiting for Chrome to be ready with remote debugging...`
}

export function chromeRemoteDebuggingReady() {
  return `${colors.green('►►►')} Chrome is ready with remote debugging!`
}

export function sourceInspectorChromeNotReadyYet(
  retries: number,
  maxRetries: number
) {
  return `${colors.yellow('►►►')} Chrome not ready yet, retrying... (${retries}/${maxRetries})`
}

export function sourceInspectorOpeningUrl(url: string) {
  return `${colors.cyan('►►►')} Opening URL: ${url}`
}

export function sourceInspectorWaitingForPageLoad() {
  return `${colors.cyan('►►►')} Waiting for page to load...`
}

export function sourceInspectorCreatingTarget() {
  return `${colors.cyan('►►►')} Creating new target...`
}

export function sourceInspectorFindingExistingTarget() {
  return `${colors.cyan('►►►')} Finding existing target...`
}

export function sourceInspectorUsingExistingTarget(targetId: string) {
  return `${colors.cyan('►►►')} Using existing target with ID: ${targetId}`
}

export function sourceInspectorTargetCreated(targetId: string) {
  return `${colors.green('►►►')} Target created with ID: ${targetId}`
}

export function sourceInspectorAttachingToTarget() {
  return `${colors.cyan('►►►')} Attaching to target...`
}

export function sourceInspectorAttachedToTarget(sessionId: string) {
  return `${colors.green('►►►')} Attached to target with session ID: ${sessionId}`
}

export function sourceInspectorExtractingHTML() {
  return `${colors.cyan('►►►')} Extracting page HTML...`
}

export function sourceInspectorHTMLExtractionComplete() {
  return `${colors.green('►►►')} HTML extraction complete`
}

export function sourceInspectorInspectionFailed(error: string) {
  return `${colors.red('ERROR')} Failed to inspect source: ${error}`
}

export function sourceInspectorStartingWatchMode() {
  return `${colors.cyan('►►►')} Starting source watching mode...`
}

export function sourceInspectorWatchModeActive() {
  return `${colors.cyan('►►►')} HTML will be updated automatically when files change`
}

export function sourceInspectorWatchModeStopped() {
  return `${colors.yellow('►►►')} Source inspector watch mode stopped`
}

export function sourceInspectorCDPConnectionMaintained() {
  return `${colors.cyan('►►►')} CDP connection maintained for continuous monitoring`
}

export function sourceInspectorNoActiveSession() {
  return `${colors.yellow('►►►')} No active CDP session for file change monitoring`
}

export function sourceInspectorReExtractingHTML() {
  return `${colors.cyan('►►►')} Re-extracting page HTML after file change...`
}

export function sourceInspectorAttemptingReconnection() {
  return `${colors.yellow('►►►')} Attempting to reconnect to target...`
}

export function sourceInspectorCannotReconnect() {
  return `${colors.red('►►►')} Cannot reconnect: missing CDP client or target ID`
}

export function sourceInspectorReconnectingToTarget() {
  return `${colors.cyan('►►►')} Reconnecting to target...`
}

export function sourceInspectorReconnectedToTarget(sessionId: string) {
  return `${colors.green('►►►')} Reconnected to target with session ID: ${sessionId}`
}

export function sourceInspectorReconnectionFailed(error: string) {
  return `${colors.red('►►►')} Failed to reconnect to target: ${error}`
}

export function sourceInspectorEnsuringNavigation() {
  return `${colors.cyan('►►►')} Ensuring target navigates to URL...`
}

export function sourceInspectorEnablingPageDomain() {
  return `${colors.cyan('►►►')} Enabling page domain for load events...`
}

export function sourceInspectorWaitingForContentScripts() {
  return `${colors.cyan('►►►')} Waiting for content scripts to inject...`
}

export function sourceInspectorWaitingForContentScriptReinjection() {
  return `${colors.cyan('►►►')} Waiting for content scripts to reinject...`
}

export function sourceInspectorFileChanged() {
  return `${colors.yellow('►►►')} Source file changed, updating HTML...`
}

export function sourceInspectorHTMLUpdateFailed(error: string) {
  return `${colors.red('ERROR')} Failed to update HTML: ${error}`
}

export function sourceInspectorCleanupComplete() {
  return `${colors.green('►►►')} Source inspector cleaned up`
}

export function sourceInspectorCleanupError(error: string) {
  return `${colors.red('ERROR')} Error during cleanup: ${error}`
}

export function sourceInspectorNotInitialized() {
  return `${colors.red('ERROR')} Source inspector not initialized`
}

export function sourceInspectorInvalidWebSocketServer() {
  return `${colors.yellow('►►►')} Invalid WebSocket server provided`
}

export function sourceInspectorUrlRequired() {
  return `${colors.red('ERROR')} Source inspection requires either --source <url> or --starting-url <url> to be specified`
}

export function sourceInspectorWillInspect(url: string) {
  return `${colors.cyan('►►►')} Source inspection will inspect: ${url}`
}

export function sourceInspectorSetupFailed(error: string) {
  return `${colors.red('ERROR')} Failed to setup source inspection: ${error}`
}

// HTML Output formatting
export function sourceInspectorHTMLOutputHeader() {
  return '\n' + '='.repeat(80)
}

export function sourceInspectorHTMLOutputTitle(title: string) {
  return `${colors.bold(colors.cyan('PAGE HTML'))} (${title}):`
}

export function sourceInspectorHTMLOutputFooter() {
  return '='.repeat(80) + '\n'
}

// CDP Client messages
export function cdpClientFoundTargets(count: number) {
  return `${colors.cyan('►►►')} Found ${count} targets`
}

export function cdpClientUsingTarget(title: string, url: string) {
  return `${colors.cyan('►►►')} Using target: ${title} (${url})`
}

export function cdpClientConnected(host: string, port: number) {
  return `${colors.green('►►►')} Connected to Chrome DevTools Protocol on ${host}:${port}`
}

export function cdpClientTargetWebSocketUrlStored() {
  return `${colors.cyan('►►►')} Target WebSocket URL stored for future connections`
}

export function cdpClientBrowserConnectionEstablished() {
  return `${colors.green('►►►')} Browser CDP connection established`
}

export function cdpClientConnectionError(error: string) {
  return `${colors.red('ERROR')} CDP connection error: ${error}`
}

export function cdpClientConnectionClosed() {
  return `${colors.yellow('►►►')} CDP connection closed`
}

export function cdpClientMessageParseError(error: string) {
  return `${colors.red('ERROR')} Failed to parse CDP message: ${error}`
}

export function cdpClientPageLoadEventFired() {
  return `${colors.cyan('►►►')} Page load event fired`
}

export function cdpClientLoadEventTimeout() {
  return `${colors.yellow('►►►')} Load event timeout, proceeding anyway...`
}

export function cdpClientTestingEvaluation() {
  return `${colors.cyan('►►►')} Testing basic CDP evaluation...`
}

export function cdpClientDocumentTitle(title: string) {
  return `${colors.cyan('►►►')} Document title: ${title}`
}

export function cdpClientGettingMainHTML() {
  return `${colors.cyan('►►►')} Getting main HTML...`
}

export function cdpClientMainHTMLLength(length: number) {
  return `${colors.cyan('►►►')} Main HTML length: ${length}`
}

export function cdpClientFailedToGetMainHTML() {
  return `${colors.red('ERROR')} Failed to get main HTML`
}

export function cdpClientCheckingShadowDOM() {
  return `${colors.cyan('►►►')} Checking for Shadow DOM...`
}

export function cdpClientShadowDOMContentFound(found: boolean) {
  return `${colors.cyan('►►►')} Shadow DOM content found: ${found ? 'yes' : 'no'}`
}

export function cdpClientShadowDOMContentLength(length: number) {
  return `${colors.cyan('►►►')} Shadow DOM content length: ${length}`
}

export function cdpClientProcessingShadowDOM() {
  return `${colors.cyan('►►►')} Processing Shadow DOM content...`
}

export function cdpClientFinalHTMLWithShadowDOMLength(length: number) {
  return `${colors.cyan('►►►')} Final HTML with Shadow DOM length: ${length}`
}

export function cdpClientReturningMainHTML() {
  return `${colors.cyan('►►►')} Returning main HTML without Shadow DOM`
}

// WebSocket Server Messages
export function webSocketServerInitialized() {
  return `${colors.green('')} WebSocket server initialized for file change monitoring`
}

export function webSocketServerInitializationFailed(error: string) {
  return `${colors.red('ERROR')} Failed to initialize WebSocket server: ${error}`
}

export function webSocketServerPluginApplyFailed(error: string) {
  return `${colors.red('ERROR')} Failed to initialize WebSocket server during plugin apply: ${error}`
}

export function fileUpdated(relativePath: string, context: string) {
  return `►► Updated file \`${relativePath}\` (relative to ${context})`
}

export function webSocketServerNotReady() {
  return `${colors.yellow('►►►')} WebSocket server not ready for file change notification`
}

export function webSocketServerNotRunning() {
  return `${colors.red('ERROR')} WebSocket server is not running`
}

// Start Server Messages
export function ignoringMessageFromWrongInstance(actualInstanceId: string, expectedInstanceId: string) {
  return `${colors.yellow('►►►')} Ignoring message from wrong instance: ${actualInstanceId} (expected: ${expectedInstanceId})`
}

export function failedToUpdateInstanceWithExtensionId(error: string) {
  return `${colors.red('ERROR')} Failed to update instance with extension ID: ${error}`
}

export function webSocketServerForInstanceClosed(instanceId: string) {
  return `${colors.green('►►►')} WebSocket server for instance ${instanceId} closed`
}

// Additional Start Server Messages
export function webSocketError(error: any) {
  return `${colors.red('ERROR')} WebSocket error: ${error}`
}

export function runningInDevelopment(manifest: any, browser: any, message: any) {
  return `${colors.green('►►►')} Running ${colors.cyan(manifest.name)} in ${colors.yellow(browser)} development mode`
}

export function emptyLine() {
  return ''
}

export function isFirstRun(browser: any) {
  return `${colors.cyan('►►►')} First run detected for ${colors.yellow(browser)}`
}

export function certRequired() {
  return `${colors.yellow('►►►')} Certificate required for Firefox development`
}

export function webSocketConnectionCloseError(error: unknown) {
  return `${colors.red('ERROR')} Error closing WebSocket connection: ${String(error)}`
}
