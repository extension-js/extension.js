import * as path from 'path'
import colors from 'pintor'
import {Manifest} from '../webpack-types'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {CERTIFICATE_DESTINATION_PATH} from './constants'
import {Stats} from '@rspack/core'
import {info} from 'console'
import packageJson from '../../package.json'

type PrefixType = 'warn' | 'info' | 'error' | 'success'

function getLoggingPrefix(feature: string, type: PrefixType): string {
  // For errors we invert the order
  if (type === 'error') {
    return `${colors.bold(colors.red('ERROR'))} in ${feature} ${colors.red('✖︎✖︎✖︎')}`
  }

  // For warns we invert the order
  if (type === 'warn') {
    return `${feature} ${colors.yellow('✖︎✖︎✖︎')}`
  }

  const arrow = type === 'info' ? colors.cyan('►►►') : colors.green('►►►')

  return `${arrow} ${colors.cyan(feature)}`
}

export function capitalize(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

export function boring(manifestName: string, duration: number, stats: Stats) {
  let didShow = false

  if (!didShow) {
    const arrow = stats.hasErrors()
      ? colors.red('✖︎✖︎✖︎')
      : colors.green('►►►')

    return (
      // `${getLoggingPrefix(manifestName, stats.hasErrors() ? 'error' : 'success')} ` +
      `${arrow} ${colors.cyan(manifestName)} ` +
      // `${getLoggingPrefix('manifestName', stats.hasErrors() ? 'error' : 'success')} ` +
      `compiled ${
        stats.hasErrors()
          ? colors.red('with errors')
          : colors.green('successfully')
      } in ${duration} ms.`
    )
  }

  return undefined
}

export function integrationNotInstalled(
  integration: string,
  packageManager: string
) {
  return (
    `${info('►►►')} Using ${colors.magenta(integration)}. ` +
    `Installing required dependencies via ` +
    `${colors.yellow(packageManager)}...`
  )
}

export function envFileLoaded() {
  return `${colors.cyan('►►►')} ${colors.magenta('.env')} file loaded ${colors.green('successfully')}.`
}

export function isUsingIntegration(integration: any) {
  return `${colors.cyan('►►►')} Using ${colors.magenta(integration)}...`
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
    `${integration} Installation Error\n\n` +
    `Failed to detect package ` +
    `manager or install ${integration} dependencies:\n` +
    `${colors.red(error?.toString() || '')}`
  )
}

export function firefoxServiceWorkerError() {
  return (
    `${getLoggingPrefix('Firefox runner', 'error')} No Service Worker Support\n\n` +
    `Firefox does not support the ${colors.yellow(
      'background.service_worker'
    )} field yet.\n` +
    `Update your manifest.json file to use ${colors.yellow(
      'background.scripts'
    )} instead.\n` +
    `If you really need to keep the ${colors.yellow('service_worker')} field, prefix it with\n` +
    `${colors.yellow('chromium:')} so it can target only Chromium-based browsers.\n\n` +
    `Mozilla bug: ${colors.underline(
      'https://bugzilla.mozilla.org/show_bug.cgi?id=1573659'
    )}.`
  )
}

export function insecurePolicy() {
  return (
    `${getLoggingPrefix(
      'content-security-policy',
      'error'
    )} Insecure Content-Security-Policy\n\n` +
    `Manifest includes insecure content-security-policy value ` +
    `${colors.yellow("'unsafe-eval'")} in directive ${colors.blue(
      "'script-src'"
    )}.`
  )
}

export function noDefaultLocaleError() {
  return (
    `${getLoggingPrefix('_locales', 'error')} No Default Locale Specified\n\n` +
    `Localization used, but ${colors.yellow('default_locale')} ` +
    `wasn't specified in the manifest.`
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
    `${getLoggingPrefix('manifest.json', 'error')} Wrong Manifest Field Type\n\n` +
    `Field ${colors.yellow('web_accessible_resources')} must be a ` +
    `string array in Manifest version 2.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function webAccessibleResourcesV3Type(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Wrong Manifest Field Type\n\n` +
    `Field ${colors.yellow('web_accessible_resources')} must be an ` +
    `array of objects in Manifest version 3.\n\n` +
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
    `Field ${colors.yellow(field || '')} is deprecated in Manifest V3. ` +
    `Update your manifest.json file to run your extension.\n\n` +
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
    `Field ${colors.yellow(field)} must be of type ${colors.blue(type)}.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function missingRequiredMessage(
  browser: DevOptions['browser'],
  message: string | undefined
) {
  const hintMessage = `Update your manifest.json file to run your extension.`
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
    `One of your ${extFilename?.toUpperCase()} ` +
    `imports is also a ${colors.yellow('content_script')} CSS in manifest.json.\n` +
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
  const text1 =
    `${getLoggingPrefix(manifestName, 'error')} ` +
    `Module ${colors.yellow(moduleName)} Not Found\n\n`

  const text2 = isLocalModule
    ? `Make sure the file exists in the extension directory. `
    : `Make sure module is installed via package manager. ` +
      `If you need to handle entries\nnot declared in manifest.json, ` +
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
    `in your package.json or use the ${colors.yellow(
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

  const field = manifestName.includes('content_scripts')
    ? `(index ${contentIndex})\n\n`
    : manifestFieldName
  return (
    `${getLoggingPrefix('manifest.json', 'error')} File Not Found\n\n` +
    `${
      isPage
        ? `Check the ${colors.yellow(
            'pages'
          )} folder in your project root directory.\n`
        : `Check the ${colors.yellow(field)} ` +
          `field in your manifest.json file.\n`
    }` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function entryNotFoundWarn(manifestField: string, filePath: string) {
  // No need for prefix since webpack already logs the error
  return (
    `File Not Found\n\n` +
    `Check the ${colors.yellow(
      manifestField
    )} field in your manifest.json file.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function manifestNotFoundError(
  manifestName: string,
  manifestPath: string
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Manifest Not Found\n\n` +
    `Ensure you have a manifest.json file at the root directory of your project.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(manifestPath)}`
  )
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Invalid Manifest\n\n` +
    `Update your manifest.json file and try again. ` +
    colors.red(error.toString())
  )
}

export function serverRestartRequiredFromManifestError(
  fileAdded: string,
  fileRemoved: string
) {
  const fileRemovedText =
    fileRemoved &&
    `${colors.gray('PATH')} ${colors.red('REMOVED')} ${colors.underline(fileRemoved)}\n`
  const fileAddedText =
    fileAdded &&
    `${colors.gray('PATH')} ${colors.green('ADDED')} ${colors.underline(fileAdded)}`
  return (
    `$manifest.json ${colors.red('✖︎✖︎✖︎')} Manifest Entry Point Modification\n\n` +
    `Changing the path of ${colors.yellow('HTML')} or ` +
    `${colors.yellow('script')} files in manifest.json ` +
    `after compilation requires a server restart.\n` +
    fileRemovedText +
    fileAddedText
  )
}

export function resolverHtmlError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} HTML File Not Found\n\n` +
    `Either add it to the ${colors.yellow(
      'public'
    )} directory or create an HTML file ` +
    `in the ${colors.yellow('pages/')} directory.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function resolverJsError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Script File Not Found\n\n` +
    `Either add it to the ${colors.yellow(
      'public'
    )} directory or create a script file ` +
    `in the ${colors.yellow('scripts/')} directory.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function resolverStaticError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Static File Not Found\n\n` +
    `If you want to keep the file path as-is, move it to the ` +
    `${colors.yellow('public/')} directory.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function serverRestartRequiredFromSpecialFolderError(
  addingOrRemoving: string,
  folder: string,
  typeOfAsset: string,
  pathRelative: string
) {
  const addOrRemove =
    addingOrRemoving.charAt(0).toUpperCase() + addingOrRemoving.slice(1)
  return (
    `${getLoggingPrefix(
      'manifest.json',
      'error'
    )} Manifest Entry Point Modification\n\n` +
    `${addOrRemove} ${colors.yellow(typeOfAsset)} in the ${colors.underline(
      folder + '/'
    )} ` +
    `folder after compilation requires a server restart.\n` +
    `${colors.gray('PATH')} ${colors.underline(pathRelative)}`
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

export function runningInDevelopment(
  manifest: Manifest,
  browser: DevOptions['browser'],
  message: {data?: MessageData}
) {
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
      `${getLoggingPrefix(manifestName, 'error')} ` +
      `No Client Data Received\n\n` +
      `This error happens when the program can\'t get the data from your extension.\n` +
      `There are many reasons this might happen. To fix, ensure that:\n\n` +
      `- Your extension is set as enabled in ${colors.underline(browserDevToolsUrl)}\n` +
      `- No previous ${capitalize(browser)} browser instance is open\n\n` +
      `If that is not the case, restart both the ${colors.cyan(manifest.name || '')} and the\n` +
      `${colors.yellow('Manager Extension')} in ${colors.underline(browserDevToolsUrl)} and try again.\n\n` +
      `If the issue still persists, please report a bug:\n\n` +
      colors.underline(`https://github.com/extension-js/extension.js/issues`)
    )
  }

  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      return (
        `${getLoggingPrefix(
          manifestName,
          'error'
        )} No management API info received ` + `from client. Investigate.`
      )
    }
  }

  const {name, version} = management

  return `
 🧩 ${colors.green('Extension.js')} ${colors.gray(`${packageJson.version}`)}
${`    Extension Name        `} ${colors.gray(name)}
${`    Extension Version     `} ${colors.gray(version)}
${`    Extension ID          `} ${colors.gray(id)}`
}

export function isFirstRun(browser: DevOptions['browser']) {
  return (
    `This is your first run using Extension.js via ` +
    `${capitalize(browser)}. Welcome! 🎉\n` +
    `\n🧩 Learn more at ${colors.underline(`https://extension.js.org`)}`
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
    `${getLoggingPrefix('manifest.json', 'error')} ` +
    `File Not Found\n\n` +
    `Check the ${colors.yellow(backgroundChunkName.replace('/', '.'))} ` +
    `field in your manifest.json file.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(filePath)}`
  )
}

export function serverRestartRequiredFromHtml(filePath: string) {
  const errorMessage =
    `${getLoggingPrefix('HTML', 'error')} Entry Point Modification\n\n` +
    `Changing the path of ${colors.yellow('<script>')} or ${colors.yellow(
      '<link rel="stylesheet">'
    )} ` +
    `files after compilation requires a server restart.\n` +
    `${colors.gray('PATH')} ${colors.underline(filePath)}`

  return errorMessage
}

export function javaScriptError(
  errorSourcePath: string,
  missingFilePath: string
) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n\n` +
    `Check your ${colors.yellow('<script>')} tags in ${colors.underline(
      errorSourcePath
    )}.\n` +
    `${colors.red('NOT FOUND')} ${colors.underline(missingFilePath)}`
  )
}

export function cssError(errorSourcePath: string, missingFilePath: string) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n\n` +
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
    `${getLoggingPrefix('HTML', 'warn')} File Not Found\n\n` +
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
    `needed for the reloader to work.\nBy default, your manifest.json file ` +
    `is not being watched. To enable this feature, run:\n\n` +
    `  npx -y ${'mkcert-cli'} \\\n` +
    `    ${colors.green('--outDir')} ${colors.underline(
      CERTIFICATE_DESTINATION_PATH
    )} \\\n` +
    `    ${colors.green('--cert')} ${colors.yellow('localhost.cert')} \\\n` +
    `    ${colors.green('--key')} ${colors.yellow('localhost.key')}\n\n` +
    `This will enable the secure certificate needed for Firefox via ${colors.bold('mkcert')}.\n\n` +
    `Learn more about ${colors.bold('mkcert')}: ${colors.underline(`https://github.com/FiloSottile/mkcert`)}`
  )
}

export function defaultPortInUse(port: number) {
  return (
    `${getLoggingPrefix('Port', 'error')} ` +
    `Selected port ${colors.yellow(port.toString())} in use. Choose a new port. `
  )
}

export function portInUse(requestedPort: number, newPort: number) {
  return (
    `${getLoggingPrefix('Port', 'warn')} ` +
    `Port ${colors.yellow(requestedPort.toString())} is in use, using ` +
    `${colors.blue(newPort.toString())} instead.`
  )
}

export function noExtensionIdError() {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Extension ID Not Defined\n\n` +
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
    `to support it is ${'extension@2.0.0-beta.9'}.\n`
  )
}

export function isUsingCustomLoader(file: string) {
  // assume vue.loader.js , below should be "vue"
  const loaderName = file.split('.').shift() || 'custom'
  const capitalizedLoaderName =
    loaderName.charAt(0).toUpperCase() + loaderName.slice(1)

  return (
    `${getLoggingPrefix(capitalizedLoaderName, 'info')} ` +
    `Using custom loader configuration from ${file}`
  )
}

export function webextensionPolyfillNotFound() {
  return (
    `${getLoggingPrefix('Warning', 'warn')} webextension-polyfill not found. ` +
    `Browser API polyfill will not be available.\n` +
    `To fix this, install webextension-polyfill: ` +
    `npm install webextension-polyfill`
  )
}

// Instance Manager messages
export function registrySaved(registryPath: string) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Instance Manager', 'info')} registry saved to: ` +
    `${colors.blue(registryPath)}`
  )
}

export function registrySaveError(error: unknown) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Instance Manager', 'error')} error saving ` +
    `registry:\n${colors.red(String(error))}`
  )
}

export function smartPortAllocationExistingPorts(usedPorts: number[]) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Smart Port Allocation', 'info')} existing ` +
    `ports: ${colors.blue(JSON.stringify(usedPorts))}`
  )
}

export function smartPortAllocationExistingWebSocketPorts(
  usedWebSocketPorts: number[]
) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Smart Port Allocation', 'info')} existing ` +
    `WebSocket ports: ${colors.blue(JSON.stringify(usedWebSocketPorts))}`
  )
}

export function smartPortAllocationUsingRequestedPort(
  port: number,
  webSocketPort: number
) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Smart Port Allocation', 'info')} using requested port: ` +
    `${colors.blue(port.toString())} WebSocket: ${colors.blue(webSocketPort.toString())}`
  )
}

export function smartPortAllocationRequestedPortUnavailable(port: number) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Smart Port Allocation', 'warn')} requested port ` +
    `unavailable: ${colors.yellow(port.toString())}`
  )
}

export function smartPortAllocationAllocatedPorts(
  port: number,
  webSocketPort: number
) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Smart Port Allocation', 'success')} allocated ports ` +
    `${colors.blue(port.toString())} (port) and ` +
    `${colors.blue(webSocketPort.toString())} (WebSocket)`
  )
}

export function instanceManagerCreateInstanceCalled(params: any) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Instance Manager', 'info')} createInstance called ` +
    `${colors.blue(JSON.stringify(params))}`
  )
}

export function instanceManagerRegistryAfterCreateInstance(registry: any) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Instance Manager', 'info')} registry after ` +
    `createInstance: ${colors.blue(JSON.stringify(registry))}`
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
    `${colors.blue(instanceId)} initialized on port ` +
    `${colors.blue(webSocketPort.toString())}`
  )
}

export function extensionManagerCopyFilesWarning(error: unknown) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Extension.js DevTools', 'warn')} could not copy ` +
    `extension files: ${colors.yellow(String(error))}`
  )
}

export function extensionManagerInstanceNotFoundWarning(instanceId: string) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Extension.js DevTools', 'warn')} instance ` +
    `${colors.yellow(instanceId)} not found for cleanup`
  )
}

export function extensionManagerCleanupWarning(error: unknown) {
  if (process.env.EXTENSION_ENV !== 'development') return ''
  return (
    `${getLoggingPrefix('Extension.js DevTools', 'warn')} could not cleanup ` +
    `temp extensions: ${colors.yellow(String(error))}`
  )
}

// Firefox Binary Detector messages
export function firefoxDetectedFlatpak() {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} detected ` +
    `Flatpak Firefox installation`
  )
}

export function firefoxDetectedSnap() {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} detected ` +
    `Snap Firefox installation`
  )
}

export function firefoxDetectedTraditional(firefoxPath: string) {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} detected traditional ` +
    `Firefox at: ${colors.blue(firefoxPath)}`
  )
}

export function firefoxDetectedCustom(firefoxPath: string) {
  return (
    `${getLoggingPrefix('Firefox Detector', 'info')} detected custom ` +
    `Firefox build at: ${colors.blue(firefoxPath)}`
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
    `is: ${colors.blue(version)}`
  )
}

// WebSocket messages
export function webSocketServerNotRunning() {
  return `${getLoggingPrefix('WebSocket', 'error')} WebSocket server is not running`
}

export function webSocketConnectionCloseError(error: unknown) {
  return (
    `${getLoggingPrefix('WebSocket', 'error')} error closing ` +
    `WebSocket connection:\n${colors.red(String(error))}`
  )
}

// Port Manager messages
export function portManagerErrorAllocatingPorts(error: unknown) {
  return (
    `${getLoggingPrefix('Port Manager', 'error')} error allocating ` +
    `ports:\n${colors.red(String(error))}`
  )
}

// Browser Plugin messages
export function browserPluginFailedToLoad(browser: string, error: unknown) {
  return (
    `${getLoggingPrefix('Browser Plugin', 'error')} failed to load ` +
    `${colors.yellow(browser)} plugin:\n${colors.red(String(error))}`
  )
}

// Shared Utils messages
export function sharedUtilsWarning(message: string) {
  return `${getLoggingPrefix('Shared Utils', 'warn')} ${colors.yellow(message)}`
}

// Extension.js Runner messages
export function extensionJsRunnerError(error: unknown) {
  return (
    `${getLoggingPrefix('Extension.js Runner', 'error')} error in the ` +
    `Extension.js runner:\n${colors.red(String(error))}`
  )
}

export function extensionJsRunnerCleanupError(error: unknown) {
  return (
    `${getLoggingPrefix('Extension.js Runner', 'error')} error during ` +
    `cleanup:\n${colors.red(String(error))}`
  )
}

export function extensionJsRunnerUncaughtException(error: unknown) {
  return (
    `${getLoggingPrefix('Extension.js Runner', 'error')} uncaught ` +
    `exception:\n${colors.red(String(error))}`
  )
}

export function extensionJsRunnerUnhandledRejection(
  promise: Promise<any>,
  reason: unknown
) {
  return (
    `${getLoggingPrefix('Extension.js Runner', 'error')} unhandled ` +
    `rejection at: ${colors.yellow(promise.toString())} reason: ` +
    `${colors.red(String(reason))}`
  )
}

export function emptyLine() {
  return ''
}

export function configLoadingError(configType: string, error: unknown) {
  return (
    `${getLoggingPrefix('Config', 'error')} error loading ` +
    `${colors.yellow(configType)}: ${colors.red(String(error))}`
  )
}

// Reload Client messages
export function reloadClientForcingExtensionReload(timestamp: string) {
  return (
    `${getLoggingPrefix('Reload Client', 'info')} forcing extension ` +
    `reload at: ${colors.blue(timestamp)}`
  )
}

export function reloadClientFailedToReloadExtension(error: unknown) {
  return (
    `${getLoggingPrefix('Reload Client', 'error')} failed to reload ` +
    `extension:\n${colors.red(String(error))}`
  )
}

export function reloadClientBackgroundScriptLoaded(cacheBuster: string) {
  return (
    `${getLoggingPrefix('Reload Client', 'info')} background script loaded ` +
    `with cache buster: ${colors.blue(cacheBuster)}`
  )
}

export function reloadClientBackgroundScriptStale() {
  return (
    `${getLoggingPrefix('Reload Client', 'warn')} background script is ` +
    `stale, forcing reload`
  )
}

// Firefox-specific reload client messages
export function firefoxReloadClientReloadingExtension(changedFile: string) {
  return (
    `${getLoggingPrefix('Firefox Reload Client', 'info')} reloading ` +
    `extension due to critical file change: ${colors.blue(changedFile)}`
  )
}

export function firefoxReloadClientForcingExtensionReload(timestamp: string) {
  return (
    `${getLoggingPrefix('Firefox Reload Client', 'info')} forcing ` +
    `extension reload at: ${colors.blue(timestamp)}`
  )
}

export function firefoxReloadClientFailedToReloadExtension(error: unknown) {
  return (
    `${getLoggingPrefix('Firefox Reload Client', 'error')} failed to reload ` +
    `extension:\n${colors.red(String(error))}`
  )
}

export function firefoxReloadClientBackgroundScriptLoaded(cacheBuster: string) {
  return (
    `${getLoggingPrefix('Firefox Reload Client', 'info')} Firefox background ` +
    `script loaded with cache buster: ${colors.blue(cacheBuster)}`
  )
}

export function firefoxReloadClientBackgroundScriptStale() {
  return (
    `${getLoggingPrefix('Firefox Reload Client', 'warn')} Firefox ` +
    `background script is stale, forcing reload`
  )
}
