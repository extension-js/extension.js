import * as path from 'path'
import colors from 'pintor'
import {Stats} from '@rspack/core'
import {Manifest} from '../webpack-types'
import {DevOptions} from '../../develop-lib/config-types'
import {CERTIFICATE_DESTINATION_PATH} from './constants'

type PrefixType = 'warn' | 'info' | 'error' | 'success'

function getLoggingPrefix(feature: string, type: PrefixType) {
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

export function capitalize(browser: DevOptions['browser']) {
  return `${browser} browser`
}

export function boring(manifestName: string, duration: number, stats: Stats) {
  let didShow = false

  if (!didShow) {
    const arrow = stats.hasErrors() ? colors.red('✖✖✖') : colors.green('►►►')

    return `${arrow} ${manifestName} compiled ${
      stats.hasErrors()
        ? colors.red('with errors')
        : colors.green('successfully')
    } in ${duration} ms.`
  }

  return undefined
}

export function integrationNotInstalled(
  integration: string,
  packageManager: string
) {
  return (
    `${getLoggingPrefix(integration, 'info')} Using ${integration}. ` +
    `Installing required dependencies via ` +
    `${colors.brightBlue(packageManager)}...`
  )
}

export function envFileLoaded() {
  return `${colors.blue('►►►')} ${colors.yellow('.env')} file loaded ${colors.green('successfully')}.`
}

export function isUsingIntegration(integration: any) {
  return `${colors.blue('►►►')} Using ${colors.brightBlue(integration)}...`
}

export function youAreAllSet(integration: string) {
  return (
    `${getLoggingPrefix(integration, 'success')} installation completed. ` +
    `Run the program again and happy hacking.`
  )
}

export function installingRootDependencies(integration: string) {
  return (
    `${getLoggingPrefix(
      integration,
      'info'
    )} dependencies are being installed. ` +
    `This only happens for core contributors...`
  )
}

export function integrationInstalledSuccessfully(integration: string) {
  return (
    `${getLoggingPrefix(integration, 'success')} dependencies ` +
    `installed ${colors.green('successfully')}.`
  )
}

export function failedToInstallIntegration(
  integration: string,
  error: unknown
) {
  return (
    `${getLoggingPrefix('Integration', 'error')} ` +
    `${colors.brightBlue(integration)} Installation Error\n` +
    `${colors.red('Failed to detect package manager or install dependencies.')}\n` +
    `${colors.red(String(error ?? ''))}`
  )
}

// Spacing updates for multi-line messages
export function firefoxServiceWorkerError() {
  return (
    `${getLoggingPrefix('Firefox runner', 'error')} No Service Worker Support\n\n` +
    `Firefox does not support the ${colors.yellow(
      'background.service_worker'
    )} field yet.\n` +
    `Update your ${colors.yellow('manifest.json')} file to use ${colors.yellow(
      'background.scripts'
    )} instead.\n\n` +
    `Mozilla bug: ${colors.underline('https://bugzilla.mozilla.org/show_bug.cgi?id=1573659')}.`
  )
}

export function insecurePolicy() {
  return (
    `${getLoggingPrefix(
      'content-security-policy',
      'error'
    )} Insecure Content-Security-Policy\n\n` +
    `${colors.red('Manifest includes insecure content-security-policy value ')}${colors.brightBlue("'unsafe-eval'")} ${colors.brightBlue('(in ')}${colors.brightBlue(
      "'script-src'"
    )}${colors.brightBlue(')')}.`
  )
}

export function noDefaultLocaleError() {
  return (
    `${getLoggingPrefix('_locales', 'error')} No Default Locale Specified\n` +
    `${colors.red('Localization used, but default_locale was not specified in the manifest.')}`
  )
}

function getManifestDocumentationURL(browser: DevOptions['browser']) {
  const isChrome = browser === 'chrome'
  const chromeUrl =
    'https://developer.chrome.com/docs/extensions/reference/manifest'
  const mdnUrl =
    'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json'

  return isChrome ? colors.underline(chromeUrl) : colors.underline(mdnUrl)
}

export function webAccessibleResourcesV2Type(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} has a wrong manifest field type\n\n` +
    `Field ${colors.yellow('web_accessible_resources')} must be a string array in ${colors.yellow('Manifest')} version ${colors.brightBlue('2')}.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function webAccessibleResourcesV3Type(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} has a wrong manifest field type\n\n` +
    `Field ${colors.yellow('web_accessible_resources')} must be an array of objects in ${colors.yellow('Manifest')} version ${colors.brightBlue('3')}.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function deprecatedMessage(
  browser: DevOptions['browser'],
  errorData: any
) {
  const schemaPath = errorData?.schemaPath
  const splitSchemaPath = schemaPath?.split('/')
  const field = splitSchemaPath?.slice(splitSchemaPath.length - 2).shift()

  return (
    `${getLoggingPrefix('manifest.json', 'error')} Deprecated Field\n\n` +
    `Field ${colors.yellow(field || '')} is deprecated in ${colors.yellow('Manifest V3')}. ` +
    `Update your ${colors.yellow('manifest.json')} file to run your extension.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function invalidFieldType(
  errorData: any,
  browser: DevOptions['browser']
) {
  const field = errorData?.instancePath.replaceAll('/', '.').slice(1) || ''
  const type: string = errorData?.params.type

  return (
    `${getLoggingPrefix('manifest.json', 'error')} Invalid Manifest Field\n\n` +
    `Field ${colors.yellow(field)} must be of type ${colors.brightBlue(type)}.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function missingRequiredMessage(
  browser: DevOptions['browser'],
  message: string | undefined
) {
  const hintMessage = `Update your ${colors.yellow('manifest.json')} file to run your extension.`
  const errorMessage =
    `${getLoggingPrefix(
      'manifest.json',
      'error'
    )} Missing Required Manifest Field\n\n` +
    `Field ${colors.yellow(message || '')} is required. ${hintMessage}\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  return errorMessage
}

export function handleMultipleAssetsError(
  manifestName: string,
  filename: string
) {
  const extFilename = filename.split('.').pop()
  const errorMsg =
    `${getLoggingPrefix(manifestName, 'error')} Content Script Import\n\n` +
    `One of your ${extFilename?.toUpperCase()} imports is also a ${colors.yellow('content_script')} CSS in ${colors.yellow('manifest.json')}.\n\n` +
    `Remove the duplicate entry and try again.`

  if (filename.startsWith('content_scripts')) {
    return errorMsg
  }
}

export function handleCantResolveError(
  manifestName: string,
  moduleName: string
) {
  const link = 'https://extension.js.org/n/development/special-folders'
  const isLocalModule = moduleName.startsWith('.')
  const text1 = `${getLoggingPrefix(manifestName, 'error')} Module ${colors.yellow(moduleName)} Not Found\n\n`

  const text2 = isLocalModule
    ? `Make sure the file exists in the extension directory. `
    : `Make sure module is installed via package manager. ` +
      `If you need to handle entries\nnot declared in ${colors.yellow('manifest.json')}, ` +
      `add them to a special folder.\n\nRead more: ${colors.underline(link)}.`

  return text1 + text2
}

export function handleTopLevelAwaitError(manifestName: string) {
  return (
    `${getLoggingPrefix(
      manifestName,
      'error'
    )} Top Level Await In Non-ECMAScript Module\n\n` +
    'Top-level await is only supported in ECMAScript modules.\n' +
    `To use it in your extension, make sure to set ${colors.yellow(
      '"type": "module"'
    )}\n` +
    `in your ${colors.yellow('package.json')} or use the ${colors.yellow(
      '.mjs'
    )} extension for your script files.`
  )
}

export function fileNotFound(
  errorSourcePath: string | undefined,
  missingFilePath: string
) {
  if (!errorSourcePath) {
    throw new Error('This operation is impossible. Please report a bug.')
  }

  switch (path.extname(missingFilePath)) {
    case '.js':
    case '.ts':
    case '.jsx':
    case '.tsx':
      return javaScriptError(errorSourcePath, missingFilePath)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(errorSourcePath, missingFilePath)
    default:
      return staticAssetError(errorSourcePath, missingFilePath)
  }
}

export function manifestFieldError(
  manifestName: string,
  manifestField: string,
  filePath: string
) {
  const manifestFieldName = manifestField.startsWith('content_scripts')
    ? `content_scripts`
    : manifestField.replace('/', '.')
  const contentIndex = manifestField.split('-')[1]
  const isPage = manifestField.startsWith('pages')

  const isContentScripts = manifestField.startsWith('content_scripts')
  const fieldLabel = isContentScripts
    ? `content_scripts (index ${contentIndex})`
    : manifestFieldName

  return (
    '' +
    `${
      isPage
        ? `Check the ${colors.yellow('pages')} folder in your project root directory.\n\n`
        : `Check the ${colors.yellow(fieldLabel)} field in your ${colors.yellow('manifest.json')} file.\n\n`
    }` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function entryNotFoundWarn(manifestField: string, filePath: string) {
  return (
    `File Not Found\n\n` +
    `Check the ${colors.yellow(manifestField)} field in your ${colors.yellow('manifest.json')} file.\n\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

// duplicate removed; see earlier implementation

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Invalid Manifest\n\n` +
    `Update your ${colors.yellow('manifest.json')} file and try again.\n\n` +
    colors.red(error.toString())
  )
}

export function serverRestartRequiredFromManifestError(
  fileAdded: string,
  fileRemoved: string
) {
  const fileRemovedText = fileRemoved
    ? `${colors.brightBlue('PATH')} ${colors.red('REMOVED')} ${colors.underline(fileRemoved)}\n`
    : ''
  const fileAddedText = fileAdded
    ? `${colors.brightBlue('PATH')} ${colors.green('ADDED')} ${colors.underline(fileAdded)}`
    : ''
  return (
    `${colors.red('ERROR')} in ${colors.yellow('manifest.json')} entrypoint: ` +
    `Changing the path of HTML or script files after compilation requires a server restart.\n` +
    fileRemovedText +
    fileAddedText
  )
}

export function resolverHtmlError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} File Not Found in HTML Entrypoint\n\n` +
    `Either add it to the ${colors.yellow('public')} directory or create an HTML file in the ${colors.yellow('pages/')} directory.\n\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function resolverJsError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Script File Not Found\n\n` +
    `Either add it to the ${colors.yellow('public')} directory or create a script file in the ${colors.yellow('scripts/')} directory.\n\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function resolverStaticError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Static File Not Found\n\n` +
    `If you want to keep the file path as-is, move it to the ${colors.yellow('public/')} directory.\n\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function serverRestartRequiredFromSpecialFolderError(
  addingOrRemoving: string,
  folder: string,
  typeOfAsset: string,
  pathRelative: string
) {
  return (
    `${colors.red('ERROR')} in ${colors.yellow('manifest.json')} entrypoint: ` +
    `${colors.underline(pathRelative)} in the ${colors.underline(
      folder + '/'
    )} folder after compilation requires a server restart.`
  )
}

export function manifestNotFoundError(
  manifestName: string,
  manifestPath: string
) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Manifest Not Found\n\n` +
    `Ensure you have a ${colors.yellow('manifest.json')} file at the root directory of your project.\n\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(manifestPath)}`
  )
}

export function creatingTSConfig() {
  return (
    `${getLoggingPrefix('TypeScript', 'info')} ` +
    `is being used but no config file was found. ` +
    `Creating ${colors.yellow('tsconfig.json')}...`
  )
}

export function serverIsRunning(useHttps: boolean, port: number) {
  return (
    `${getLoggingPrefix('Extension.js', 'success')}` +
    ` server running on ` +
    colors.underline(`${useHttps ? 'wss' : 'ws'}://localhost:${port}.`)
  )
}

export interface MessageData {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

export function isFirstRun(browser: DevOptions['browser']) {
  return (
    `This is your first run using Extension.js via ` +
    `${capitalize(browser)}. Welcome!\n` +
    `\nLearn more at ${colors.underline('https://extension.js.org')}`
  )
}

export function webSocketError(error: any) {
  return `${getLoggingPrefix('WebSocket', 'error')} General WebSocket Error:\n${colors.red(error)}`
}

export function backgroundIsRequired(
  backgroundChunkName: string,
  filePath: string
) {
  return (
    '' +
    `Check the ${colors.yellow(backgroundChunkName.replace('/', '.'))} ` +
    `field in your ${colors.yellow('manifest.json')} file.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function serverRestartRequiredFromHtml(filePath: string) {
  return (
    `${getLoggingPrefix('HTML', 'warn')} Entrypoint Change\n` +
    `Detected changes to ${colors.yellow('<script>')} or ${colors.yellow(
      '<link rel="stylesheet">'
    )} references in HTML. The extension will undergo a full recompilation and a reload.\n` +
    `${colors.brightBlue('PATH')} ${colors.underline(filePath)}`
  )
}

export function javaScriptError(
  errorSourcePath: string,
  missingFilePath: string
) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n` +
    `Check your ${colors.yellow('<script>')} tags in ${colors.underline(
      errorSourcePath
    )}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(missingFilePath)}`
  )
}

export function cssError(errorSourcePath: string, missingFilePath: string) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n` +
    `Check your ${colors.yellow('<link>')} tags in ${colors.underline(
      errorSourcePath
    )}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(missingFilePath)}`
  )
}

export function staticAssetError(
  errorSourcePath: string,
  missingFilePath: string
) {
  const extname = path.extname(missingFilePath)
  return (
    `${getLoggingPrefix('HTML', 'warn')} File Not Found\n` +
    `Check your ${colors.yellow('*' + extname)} assets in ${colors.underline(
      errorSourcePath
    )}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(missingFilePath)}`
  )
}

// `This is your first run using Extension.js. Welcome! 🎉\n\n` +
export function certRequired() {
  return (
    `${colors.yellow(
      'Note'
    )}: Firefox requires a secure certificate for localhost connections, ` +
    `needed for the reloader to work.\nBy default, your ${colors.yellow('manifest.json')} file ` +
    `is not being watched. To enable this feature, run:\n\n` +
    `  npx -y ${colors.brightBlue('mkcert-cli')} \\\n` +
    `    ${colors.blue('--outDir')} ${colors.underline(CERTIFICATE_DESTINATION_PATH)} \\\n` +
    `    ${colors.blue('--cert')} ${colors.yellow('localhost.cert')} \\\n` +
    `    ${colors.blue('--key')} ${colors.yellow('localhost.key')}\n\n` +
    `This will enable the secure certificate needed for Firefox via ${colors.brightBlue('mkcert')}.\n\n` +
    `Learn more about ${colors.brightBlue('mkcert')}: ${colors.underline('https://github.com/FiloSottile/mkcert')}`
  )
}

export function defaultPortInUse(port: number) {
  return (
    `${getLoggingPrefix('Port', 'error')} ` +
    `Selected port ${colors.brightBlue(port.toString())} in use. Choose a new port. `
  )
}

export function portInUse(requestedPort: number, newPort: number) {
  return (
    `${getLoggingPrefix('Port', 'warn')} ` +
    `Requested port ${colors.brightBlue(requestedPort.toString())} is in use; using ` +
    `${colors.brightBlue(newPort.toString())} instead.`
  )
}

export function noExtensionIdError() {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Extension ID Not Defined\n` +
    `For MAIN world content_scripts, the extension ID must be specified.\n` +
    `Ensure your extension have a fixed ID and that the ${colors.yellow('publicPath')}\n` +
    `of your ${colors.yellow('extension.config.js')} is defined as your extension URL.`
  )
}

export function deprecatedShadowRoot() {
  return (
    `${getLoggingPrefix('DEPRECATION', 'warn')} Using ` +
    `${colors.yellow('window.__EXTENSION_SHADOW_ROOT__')} in content_scripts is deprecated\n` +
    'and will be removed in a future version of Extension.js. To use content_scripts with\nthe shadow DOM, ' +
    'see one of the many examples at:\nhttps://github.com/extension-js/extension.js/tree/main/examples\n\n' +
    'If you really need to use the shadow DOM as-is, the latest version of Extension.js\n' +
    `to support it is ${colors.brightBlue('extension@2.0.0-beta.9')}.\n`
  )
}

export function isUsingCustomLoader(file: string) {
  // assume vue.loader.js , below should be "vue"
  const loaderName = file.split('.').shift() || 'custom'
  const capitalizedLoaderName =
    loaderName.charAt(0).toUpperCase() + loaderName.slice(1)

  return (
    `${getLoggingPrefix(capitalizedLoaderName, 'info')} ` +
    `Using custom loader configuration from ${colors.underline(file)}`
  )
}

export function webextensionPolyfillNotFound() {
  return (
    `${getLoggingPrefix('Warning', 'warn')} ${colors.brightBlue('webextension-polyfill')} not found. ` +
    `Browser API polyfill will not be available.\n` +
    `To fix this, install ${colors.brightBlue('webextension-polyfill')}: ` +
    `${colors.blue('npm install webextension-polyfill')}`
  )
}

// Instance Manager messages
export function registrySaved(registryPath: string) {
  return (
    `${getLoggingPrefix('Instance Manager', 'info')} registry saved to: ` +
    `${colors.underline(registryPath)}`
  )
}

export function registrySaveError(error: unknown) {
  return (
    `${getLoggingPrefix('Instance Manager', 'error')} error saving ` +
    `registry:\n${colors.red(String(error))}`
  )
}

export function smartPortAllocationExistingPorts(usedPorts: number[]) {
  return `${getLoggingPrefix('Smart Port Allocation', 'info')} existing ports: ${colors.brightBlue(JSON.stringify(usedPorts))}`
}

export function smartPortAllocationExistingWebSocketPorts(
  usedWebSocketPorts: number[]
) {
  return `${getLoggingPrefix('Smart Port Allocation', 'info')} existing WebSocket ports: ${colors.brightBlue(JSON.stringify(usedWebSocketPorts))}`
}

export function smartPortAllocationUsingRequestedPort(
  port: number,
  webSocketPort: number
) {
  return `${getLoggingPrefix('Smart Port Allocation', 'info')} using requested port ${colors.brightBlue(port.toString())}; WebSocket ${colors.brightBlue(webSocketPort.toString())}`
}

export function smartPortAllocationRequestedPortUnavailable(port: number) {
  return `${getLoggingPrefix('Smart Port Allocation', 'warn')} requested port is unavailable: ${colors.brightBlue(port.toString())}`
}

export function smartPortAllocationAllocatedPorts(
  port: number,
  webSocketPort: number
) {
  return `${getLoggingPrefix('Smart Port Allocation', 'success')} allocated ports ${colors.brightBlue(port.toString())} ${colors.brightBlue('(port)')} and ${colors.brightBlue(webSocketPort.toString())} ${colors.brightBlue('(WebSocket)')}`
}

export function instanceManagerCreateInstanceCalled(params: any) {
  return (
    `${getLoggingPrefix('Instance Manager', 'info')} createInstance called ` +
    `${colors.brightBlue(JSON.stringify(params))}`
  )
}

export function instanceManagerRegistryAfterCreateInstance(registry: any) {
  return (
    `${getLoggingPrefix('Instance Manager', 'info')} registry after ` +
    `createInstance: ${colors.brightBlue(JSON.stringify(registry))}`
  )
}

// Extension.js DevTools messages
export function extensionManagerInstanceInitialized(
  instanceId: string,
  webSocketPort: number
) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Extension.js DevTools', 'success')} instance ` +
    `${colors.yellow(instanceId)} initialized on port ` +
    `${colors.brightBlue(webSocketPort.toString())}`
  )
}

export function extensionManagerCopyFilesWarning(error: unknown) {
  return (
    `${getLoggingPrefix('Extension.js DevTools', 'warn')} could not copy ` +
    `extension files: ${colors.yellow(String(error))}`
  )
}

export function extensionManagerInstanceNotFoundWarning(instanceId: string) {
  return (
    `${getLoggingPrefix('Extension.js DevTools', 'warn')} instance ` +
    `${colors.yellow(instanceId)} not found for cleanup`
  )
}

export function extensionManagerCleanupWarning(error: unknown) {
  return (
    `${getLoggingPrefix('Extension.js DevTools', 'warn')} could not cleanup ` +
    `temp extensions: ${colors.yellow(String(error))}`
  )
}

// Firefox Binary Detector messages
export function firefoxDetectedFlatpak() {
  return `${getLoggingPrefix('Firefox Detector', 'info')} detected a Flatpak Firefox installation`
}

export function firefoxDetectedSnap() {
  return `${getLoggingPrefix('Firefox Detector', 'info')} detected a Snap Firefox installation`
}

export function firefoxDetectedTraditional(firefoxPath: string) {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} detected traditional ` +
    `Firefox at: ${colors.underline(firefoxPath)}`
  )
}

export function firefoxDetectedCustom(firefoxPath: string) {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} detected custom ` +
    `Firefox build at: ${colors.underline(firefoxPath)}`
  )
}

export function firefoxUsingFlatpakWithSandbox() {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} using Flatpak ` +
    `Firefox with sandbox permissions`
  )
}

export function firefoxVersion(version: string) {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} Firefox version ` +
    `is: ${colors.brightBlue(version)}`
  )
}

// WebSocket messages
export function webSocketServerNotRunning() {
  return `${getLoggingPrefix('WebSocket', 'error')} WebSocket server is not running`
}

export function webSocketConnectionCloseError(error: unknown) {
  return `${getLoggingPrefix('WebSocket', 'error')} Error closing WebSocket connection.\n${colors.red(String(error))}`
}

// Port Manager messages
export function portManagerErrorAllocatingPorts(error: unknown) {
  let errorMessage = String(error)

  // Provide specific guidance for common errors
  if (errorMessage.includes('ENOENT')) {
    errorMessage +=
      '\n\nThis usually means the extension-js data directory could not be created.'
    errorMessage += '\nPossible solutions:'
    errorMessage +=
      '\n1. Check if you have write permissions to your home directory'
    errorMessage += '\n2. Try running: extension cleanup'
    errorMessage +=
      '\n3. Manually delete: ~/Library/Application Support/extension-js (macOS)'
    errorMessage += '\n4. Restart your terminal and try again'
  }

  return `${getLoggingPrefix('Port Manager', 'error')} Failed to allocate ports.\n${colors.red(errorMessage)}`
}

// Browser Plugin messages
export function browserPluginFailedToLoad(browser: string, error: unknown) {
  return `${getLoggingPrefix('Browser Plugin', 'error')} Failed to load the ${colors.brightBlue(browser)} plugin.\n${colors.red(String(error))}`
}

// Shared Utils messages
export function sharedUtilsWarning(message: string) {
  return `${getLoggingPrefix('Shared Utils', 'warn')} ${colors.yellow(message)}`
}

// Extension.js Runner messages
export function extensionJsRunnerError(error: unknown) {
  return `${getLoggingPrefix('Extension.js Runner', 'error')} Error in the Extension.js runner.\n${colors.red(String(error))}`
}

export function extensionJsRunnerCleanupError(error: unknown) {
  return `${getLoggingPrefix('Extension.js Runner', 'error')} Error during cleanup.\n${colors.red(String(error))}`
}

export function extensionJsRunnerUncaughtException(error: unknown) {
  return `${getLoggingPrefix('Extension.js Runner', 'error')} Uncaught exception.\n${colors.red(String(error))}`
}

export function extensionJsRunnerUnhandledRejection(
  promise: Promise<any>,
  reason: unknown
) {
  return (
    `${getLoggingPrefix('Extension.js Runner', 'error')} unhandled ` +
    `rejection at: ${colors.brightBlue(promise.toString())} reason: ` +
    `${colors.red(String(reason))}`
  )
}

export function emptyLine() {
  return ''
}

// Plugin Extension general messages
export function outputMapHeader() {
  return `${getLoggingPrefix('plugin-extension', 'info')} Output map:`
}

export function outputMapItem(assetPath: string) {
  return ` - ${assetPath}`
}

export function legacyManifestPathWarning(legacyPath: string) {
  return (
    `${getLoggingPrefix('manifest.json', 'warn')} Deprecated Path Detected\n` +
    `Found legacy output path ${colors.yellow(legacyPath)}. ` +
    `This will be rewritten to standardized folders in the next major.`
  )
}

export function configLoadingError(configType: string, error: unknown) {
  return `${getLoggingPrefix('Config', 'error')} Failed to load ${colors.brightBlue(configType)}.\n${colors.red(String(error))}`
}

// Auto mode hints for CI/AI runs
export function autoExitModeEnabled(ms: number) {
  return `${getLoggingPrefix('Auto Mode', 'info')} is enabled. The program will exit automatically after ${colors.brightBlue('(' + ms.toString() + 'ms)')}.`
}

export function autoExitTriggered(ms: number) {
  return `${getLoggingPrefix('Auto Mode', 'warn')} timer has elapsed ${colors.brightBlue('(' + ms.toString() + 'ms)')}. Cleaning up...`
}

export function autoExitForceKill(ms: number) {
  return `${getLoggingPrefix('Auto Mode', 'error')} is force-killing the process after the fallback ${colors.brightBlue('(' + ms.toString() + 'ms)')}.`
}

// Reload Client messages
export function reloadClientForcingExtensionReload(timestamp: string) {
  return `${getLoggingPrefix('Reload Client', 'info')} is forcing an extension reload at ${colors.brightBlue(timestamp)}`
}

export function reloadClientFailedToReloadExtension(error: unknown) {
  return `${getLoggingPrefix('Reload Client', 'error')} Failed to reload the extension.\n${colors.red(String(error))}`
}

export function reloadClientBackgroundScriptLoaded(cacheBuster: string) {
  return `${getLoggingPrefix('Reload Client', 'info')} background script loaded with cache buster: ${colors.brightBlue(cacheBuster)}`
}

export function reloadClientBackgroundScriptStale() {
  return `${getLoggingPrefix('Reload Client', 'warn')} background script is stale; forcing a reload`
}

// Firefox-specific reload client messages
export function firefoxReloadClientReloadingExtension(changedFile: string) {
  return `${getLoggingPrefix('Firefox Reload Client', 'info')} is reloading the extension due to a critical file change: ${colors.brightBlue(changedFile)}`
}

export function firefoxReloadClientForcingExtensionReload(timestamp: string) {
  return `${getLoggingPrefix('Firefox Reload Client', 'info')} is forcing an extension reload at ${colors.brightBlue(timestamp)}`
}

export function firefoxReloadClientFailedToReloadExtension(error: unknown) {
  return `${getLoggingPrefix('Firefox Reload Client', 'error')} Failed to reload the extension.\n${colors.red(String(error))}`
}

export function firefoxReloadClientBackgroundScriptLoaded(cacheBuster: string) {
  return `${getLoggingPrefix('Firefox Reload Client', 'info')} Firefox background script loaded with cache buster: ${colors.brightBlue(cacheBuster)}`
}

export function firefoxReloadClientBackgroundScriptStale() {
  return `${getLoggingPrefix('Firefox Reload Client', 'warn')} Firefox background script is stale; forcing a reload`
}

// Process Management messages
export function enhancedProcessManagementStarting(
  browser: DevOptions['browser']
): string {
  return `${getLoggingPrefix('Process Management', 'info')} starting for ${capitalize(browser)}`
}

export function enhancedProcessManagementCleanup(
  browser: DevOptions['browser']
): string {
  return `${getLoggingPrefix('Process Management', 'info')} cleanup for ${capitalize(browser)}`
}

export function enhancedProcessManagementTerminating(
  browser: DevOptions['browser']
): string {
  return `${getLoggingPrefix('Process Management', 'info')} terminating ${capitalize(browser)} process gracefully`
}

export function enhancedProcessManagementForceKill(
  browser: DevOptions['browser']
): string {
  return `${getLoggingPrefix('Process Management', 'error')} force killing ${capitalize(browser)} process after timeout`
}

export function enhancedProcessManagementCleanupError(
  browser: DevOptions['browser'],
  error: unknown
): string {
  return (
    `${getLoggingPrefix('Process Management', 'error')} error during ${capitalize(browser)} cleanup:\n` +
    `${colors.red(String(error))}`
  )
}

export function enhancedProcessManagementInstanceCleanup(
  browser: DevOptions['browser']
): string {
  return `${getLoggingPrefix('Process Management', 'info')} cleaning up ${capitalize(browser)} instance`
}

export function enhancedProcessManagementInstanceCleanupComplete(
  browser: DevOptions['browser']
): string {
  return `${getLoggingPrefix('Process Management', 'success')} ${capitalize(browser)} instance cleanup completed`
}

export function enhancedProcessManagementSignalHandling(
  browser: DevOptions['browser']
): string {
  return `${getLoggingPrefix('Process Management', 'info')} enhanced signal handling enabled for ${capitalize(browser)}`
}

export function enhancedProcessManagementUncaughtException(
  browser: DevOptions['browser'],
  error: unknown
): string {
  return (
    `${getLoggingPrefix('Process Management', 'error')} uncaught exception in ${capitalize(browser)} process:\n` +
    `${colors.red(String(error))}`
  )
}

export function enhancedProcessManagementUnhandledRejection(
  browser: DevOptions['browser'],
  reason: unknown
): string {
  return (
    `${getLoggingPrefix('Process Management', 'error')} unhandled rejection in ${capitalize(browser)} process:\n` +
    `${colors.red(String(reason))}`
  )
}

// Instance Manager health monitoring messages
export function instanceManagerHealthMonitoringStart(
  instanceId: string
): string {
  return `${getLoggingPrefix('Instance Manager', 'info')} starting health monitoring for instance ${colors.brightBlue(instanceId.slice(0, 8))}`
}

export function instanceManagerHealthMonitoringPassed(
  instanceId: string
): string {
  return `${getLoggingPrefix('Instance Manager', 'success')} instance ${colors.brightBlue(instanceId.slice(0, 8))} health check passed`
}

export function instanceManagerHealthMonitoringOrphaned(
  instanceId: string
): string {
  return `${getLoggingPrefix('Instance Manager', 'warn')} instance ${colors.brightBlue(instanceId.slice(0, 8))} appears orphaned, cleaning up`
}

export function instanceManagerHealthMonitoringFailed(
  instanceId: string,
  error: unknown
): string {
  return (
    `${getLoggingPrefix('Instance Manager', 'error')} health check failed for instance ${colors.brightBlue(instanceId.slice(0, 8))}:\n` +
    `${colors.red(String(error))}`
  )
}

export function instanceManagerForceCleanupProject(
  projectPath: string
): string {
  return `${getLoggingPrefix('Instance Manager', 'info')} force cleaning up all processes for project: ${colors.underline(projectPath)}`
}

export function instanceManagerForceCleanupFound(
  instanceCount: number
): string {
  return `${getLoggingPrefix('Instance Manager', 'info')} found ${colors.brightBlue(instanceCount.toString())} instances to clean up`
}

export function instanceManagerForceCleanupInstance(
  instanceId: string
): string {
  return `${getLoggingPrefix('Instance Manager', 'info')} cleaning up instance ${colors.brightBlue(instanceId.slice(0, 8))}`
}

export function instanceManagerForceCleanupTerminating(
  processId: number
): string {
  return `${getLoggingPrefix('Instance Manager', 'info')} terminating process ${colors.brightBlue(processId.toString())}`
}

export function instanceManagerForceCleanupForceKilled(
  processId: number
): string {
  return `${getLoggingPrefix('Instance Manager', 'error')} force killed process ${colors.brightBlue(processId.toString())}`
}

export function instanceManagerForceCleanupInstanceTerminated(
  instanceId: string
): string {
  return `${getLoggingPrefix('Instance Manager', 'success')} instance ${colors.brightBlue(instanceId.slice(0, 8))} marked as terminated`
}

export function instanceManagerForceCleanupError(
  instanceId: string,
  error: unknown
): string {
  return (
    `${getLoggingPrefix('Instance Manager', 'error')} error terminating instance ${colors.brightBlue(instanceId)}:\n` +
    `${colors.red(String(error))}`
  )
}

export function instanceManagerForceCleanupComplete(): string {
  return `${getLoggingPrefix('Instance Manager', 'success')} project cleanup completed`
}

// Orphan cleanup DEV-only details
export function instanceManagerProcessNoLongerRunning(
  instanceId: string,
  processId: number
): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Instance Manager')} process ${colors.brightBlue(processId.toString())} for instance ${colors.brightBlue(instanceId.slice(0, 8))} is no longer running`
}

export function instanceManagerPortsNotInUse(
  instanceId: string,
  port: number,
  webSocketPort: number
): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Instance Manager')} ports ${colors.brightBlue(port.toString())} ${colors.brightBlue('(')}${colors.brightBlue('port')}${colors.brightBlue(')')}/${colors.brightBlue(webSocketPort.toString())} ${colors.brightBlue('(')}${colors.brightBlue('WebSocket')}${colors.brightBlue(')')} for instance ${colors.brightBlue(instanceId.slice(0, 8))} are not in use`
}

export function instanceManagerCleanedUpOrphanedInstance(
  instanceId: string
): string {
  return `${colors.brightMagenta('►►►')} ${colors.brightMagenta('Instance Manager')} cleaned up orphaned instance: ${colors.brightBlue(instanceId.slice(0, 8))}`
}
