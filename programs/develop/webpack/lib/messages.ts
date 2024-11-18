import path from 'path'
import {type ErrorObject} from 'ajv'
import {
  red,
  brightGreen,
  underline,
  brightBlue,
  cyan,
  bold,
  gray,
  brightYellow,
  magenta
} from '@colors/colors/safe'
import {Manifest} from '../webpack-types'
import {DevOptions} from '../../commands/commands-lib/config-types'
import {CERTIFICATE_DESTINATION_PATH} from './constants'
import {Stats} from 'webpack'
import {info} from 'console'

type PrefixType = 'warn' | 'info' | 'error' | 'success'

function getLoggingPrefix(feature: string, type: PrefixType): string {
  // For errors we invert the order
  if (type === 'error') {
    return `${bold(red('ERROR'))} in ${feature} ${red('✖︎✖︎✖︎')}`
  }

  // For warns we invert the order
  if (type === 'warn') {
    return `${feature} ${brightYellow('✖︎✖︎✖︎')}`
  }

  const arrow = type === 'info' ? cyan('►►►') : brightGreen('►►►')

  return `${arrow} ${cyan(feature)}`
}

export function capitalize(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

export function boring(manifestName: string, duration: number, stats: Stats) {
  let didShow = false

  if (!didShow) {
    const arrow = stats.hasErrors() ? red('✖︎✖︎✖︎') : brightGreen('►►►')

    return (
      // `${getLoggingPrefix(manifestName, stats.hasErrors() ? 'error' : 'success')} ` +
      `${arrow} ${cyan(manifestName)} ` +
      // `${getLoggingPrefix('manifestName', stats.hasErrors() ? 'error' : 'success')} ` +
      `compiled ${
        stats.hasErrors() ? red('with errors') : brightGreen('successfully')
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
    `${info('►►►')} Using ${magenta(integration)}. ` +
    `Installing required dependencies via ` +
    `${brightYellow(packageManager)}...`
  )
}

export function envFileLoaded() {
  return `${cyan('►►►')} ${magenta('.env')} file loaded ${brightGreen('successfully')}.`
}

export function isUsingIntegration(integration: any) {
  return `${cyan('►►►')} Using ${magenta(integration)}...`
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
    `installed ${brightGreen('successfully')}.`
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
    `${red(error?.toString() || '')}`
  )
}

export function firefoxServiceWorkerError() {
  return (
    `${getLoggingPrefix('Firefox runner', 'error')} No Service Worker Support\n\n` +
    `Firefox does not support the ${brightYellow(
      'background.service_worker'
    )} field yet.\n` +
    `Update your manifest.json file to use ${brightYellow(
      'background.scripts'
    )} instead.\n` +
    `If you really need to keep the ${brightYellow('service_worker')} field, prefix it with\n` +
    `${brightYellow('chromium:')} so it can target only Chromium-based browsers.\n\n` +
    `Mozilla bug: ${underline(
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
    `${brightYellow("'unsafe-eval'")} in directive ${brightBlue(
      "'script-src'"
    )}.`
  )
}

export function noDefaultLocaleError() {
  return (
    `${getLoggingPrefix('_locales', 'error')} No Default Locale Specified\n\n` +
    `Localization used, but ${brightYellow('default_locale')} ` +
    `wasn't specified in the manifest.`
  )
}

function getManifestDocumentationURL(browser: DevOptions['browser']) {
  const isChrome = browser === 'chrome'
  const chromeUrl =
    'https://developer.chrome.com/docs/extensions/reference/manifest'
  const mdnUrl =
    'https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json'

  return isChrome ? underline(chromeUrl) : underline(mdnUrl)
}

export function webAccessibleResourcesV2Type(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Wrong Manifest Field Type\n\n` +
    `Field ${brightYellow('web_accessible_resources')} must be a ` +
    `string array in Manifest version 2.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function webAccessibleResourcesV3Type(browser: DevOptions['browser']) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Wrong Manifest Field Type\n\n` +
    `Field ${brightYellow('web_accessible_resources')} must be an ` +
    `array of objects in Manifest version 3.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function deprecatedMessage(
  browser: DevOptions['browser'],
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined
) {
  const schemaPath = errorData?.schemaPath
  const splitSchemaPath = schemaPath?.split('/')
  const field = splitSchemaPath?.slice(splitSchemaPath.length - 2).shift()

  return (
    `${getLoggingPrefix('manifest.json', 'error')} Deprecated Field\n\n` +
    `Field ${brightYellow(field || '')} is deprecated in Manifest V3. ` +
    `Update your manifest.json file to run your extension.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function invalidFieldType(
  errorData: ErrorObject | undefined,
  browser: DevOptions['browser']
) {
  const field = errorData?.instancePath.replaceAll('/', '.').slice(1) || ''
  const type: string = errorData?.params.type

  return (
    `${getLoggingPrefix('manifest.json', 'error')} Invalid Manifest Field\n\n` +
    `Field ${brightYellow(field)} must be of type ${brightBlue(type)}.\n\n` +
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
    `Field ${brightYellow(message || '')} is required. ${hintMessage}\n\n` +
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
    `imports is also a ${brightYellow('content_script')} CSS in manifest.json.\n` +
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
    `Module ${brightYellow(moduleName)} Not Found\n\n`

  const text2 = isLocalModule
    ? `Make sure the file exists in the extension directory. `
    : `Make sure module is installed via package manager. ` +
      `If you need to handle entries\nnot declared in manifest.json, ` +
      `add them to a special folder.\n\nRead more: ${underline(link)}.`

  return text1 + text2
}

export function handleTopLevelAwaitError(manifestName: string) {
  return (
    `${getLoggingPrefix(
      manifestName,
      'error'
    )} Top Level Await In Non-ECMAScript Module\n\n` +
    'Top-level await is only supported in ECMAScript modules.\n' +
    `To use it in your extension, make sure to set ${brightYellow(
      '"type": "module"'
    )}\n` +
    `in your package.json or use the ${brightYellow(
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
        ? `Check the ${brightYellow(
            'pages'
          )} folder in your project root directory.\n`
        : `Check the ${brightYellow(field)} ` +
          `field in your manifest.json file.\n`
    }` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function entryNotFoundWarn(manifestField: string, filePath: string) {
  // No need for prefix since webpack already logs the error
  return (
    `File Not Found\n\n` +
    `Check the ${brightYellow(
      manifestField
    )} field in your manifest.json file.\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function manifestNotFoundError(
  manifestName: string,
  manifestPath: string
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Manifest Not Found\n\n` +
    `Ensure you have a manifest.json file at the root directory of your project.\n` +
    `${red('NOT FOUND')} ${underline(manifestPath)}`
  )
}

export function manifestInvalidError(error: NodeJS.ErrnoException) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Invalid Manifest\n\n` +
    `Update your manifest.json file and try again. ` +
    red(error.toString())
  )
}

export function serverRestartRequiredFromManifestError(
  fileAdded: string,
  fileRemoved: string
) {
  const fileRemovedText =
    fileRemoved &&
    `${gray('PATH')} ${red('REMOVED')} ${underline(fileRemoved)}\n`
  const fileAddedText =
    fileAdded &&
    `${gray('PATH')} ${brightGreen('ADDED')} ${underline(fileAdded)}`
  return (
    `$manifest.json ${red('✖︎✖︎✖︎')} Manifest Entry Point Modification\n\n` +
    `Changing the path of ${brightYellow('HTML')} or ` +
    `${brightYellow('script')} files in manifest.json ` +
    `after compilation requires a server restart.\n` +
    fileRemovedText +
    fileAddedText
  )
}

export function resolverHtmlError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} HTML File Not Found\n\n` +
    `Either add it to the ${brightYellow(
      'public'
    )} directory or create an HTML file ` +
    `in the ${brightYellow('pages/')} directory.\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function resolverJsError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Script File Not Found\n\n` +
    `Either add it to the ${brightYellow(
      'public'
    )} directory or create a script file ` +
    `in the ${brightYellow('scripts/')} directory.\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function resolverStaticError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Static File Not Found\n\n` +
    `If you want to keep the file path as-is, move it to the ` +
    `${brightYellow('public/')} directory.\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
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
    `${addOrRemove} ${brightYellow(typeOfAsset)} in the ${underline(
      folder + '/'
    )} ` +
    `folder after compilation requires a server restart.\n` +
    `${gray('PATH')} ${underline(pathRelative)}`
  )
}

export function creatingTSConfig() {
  return (
    `${getLoggingPrefix('TypeScript', 'info')} ` +
    `is being used but no config file was found. ` +
    `Creating ${brightYellow('tsconfig.json')}...`
  )
}

export function serverIsRunning(useHttps: boolean, port: number) {
  return (
    `${getLoggingPrefix('Extension.js', 'success')}` +
    ` server running on ` +
    underline(`${useHttps ? 'wss' : 'ws'}://localhost:${port}.`)
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
      `- Your extension is set as enabled in ${underline(browserDevToolsUrl)}\n` +
      `- No previous ${capitalize(browser)} browser instance is open\n\n` +
      `If that is not the case, restart both the ${cyan(manifest.name || '')} and the\n` +
      `${brightYellow('Manager Extension')} in ${underline(browserDevToolsUrl)} and try again.\n\n` +
      `If the issue still persists, please report a bug:\n\n` +
      underline(`https://github.com/extension-js/extension.js/issues`)
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

  const packageVersion = require('../../package.json').version
  return `
 🧩 ${brightGreen('Extension.js')} ${gray(`${packageVersion}`)}
${`    Extension Name        `} ${gray(name)}
${`    Extension Version     `} ${gray(version)}
${`    Extension ID          `} ${gray(id)}`
}

export function isFirstRun(browser: DevOptions['browser']) {
  return (
    `This is your first run using Extension.js via ` +
    `${capitalize(browser)}. Welcome! 🎉\n` +
    `\n🧩 Learn more at ${underline(`https://extension.js.org`)}`
  )
}

export function webSocketError(error: any) {
  return `${getLoggingPrefix('WebSocket', 'error')} General WebSocket Error:\n${red(error)}`
}

export function backgroundIsRequired(
  backgroundChunkName: string,
  filePath: string
) {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} ` +
    `File Not Found\n\n` +
    `Check the ${brightYellow(backgroundChunkName.replace('/', '.'))} ` +
    `field in your manifest.json file.\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function serverRestartRequiredFromHtml(filePath: string) {
  const errorMessage =
    `${getLoggingPrefix('HTML', 'error')} Entry Point Modification\n\n` +
    `Changing the path of ${brightYellow('<script>')} or ${brightYellow(
      '<link rel="stylesheet">'
    )} ` +
    `files after compilation requires a server restart.\n` +
    `${gray('PATH')} ${underline(filePath)}`

  return errorMessage
}

export function javaScriptError(
  errorSourcePath: string,
  missingFilePath: string
) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n\n` +
    `Check your ${brightYellow('<script>')} tags in ${underline(
      errorSourcePath
    )}.\n` +
    `${red('NOT FOUND')} ${underline(missingFilePath)}`
  )
}

export function cssError(errorSourcePath: string, missingFilePath: string) {
  return (
    `${getLoggingPrefix('HTML', 'error')} File Not Found\n\n` +
    `Check your ${brightYellow('<link>')} tags in ${underline(
      errorSourcePath
    )}.\n` +
    `${red('NOT FOUND')} ${underline(missingFilePath)}`
  )
}

export function staticAssetError(
  errorSourcePath: string,
  missingFilePath: string
) {
  const extname = path.extname(missingFilePath)
  return (
    `${getLoggingPrefix('HTML', 'warn')} File Not Found\n\n` +
    `Check your ${brightYellow('*' + extname)} assets in ${underline(
      errorSourcePath
    )}.\n` +
    `${red('NOT FOUND')} ${underline(missingFilePath)}`
  )
}

// `This is your first run using Extension.js. Welcome! 🎉\n\n` +
export function certRequired() {
  return (
    `${brightYellow(
      'Note'
    )}: Firefox requires a secure certificate for localhost connections, ` +
    `needed for the reloader to work.\nBy default, your manifest.json file ` +
    `is not being watched. To enable this feature, run:\n\n` +
    `  npx -y ${'mkcert-cli'} \\\n` +
    `    ${brightGreen('--outDir')} ${underline(
      CERTIFICATE_DESTINATION_PATH
    )} \\\n` +
    `    ${brightGreen('--cert')} ${brightYellow('localhost.cert')} \\\n` +
    `    ${brightGreen('--key')} ${brightYellow('localhost.key')}\n\n` +
    `This will enable the secure certificate needed for Firefox via ${bold('mkcert')}.\n\n` +
    `Learn more about ${bold('mkcert')}: ${underline(`https://github.com/FiloSottile/mkcert`)}`
  )
}

export function defaultPortInUse(port: number) {
  return (
    `${getLoggingPrefix('Port', 'error')} ` +
    `Selected port ${brightYellow(port.toString())} in use. Choose a new port. `
  )
}

export function noExtensionIdError() {
  return (
    `${getLoggingPrefix('manifest.json', 'error')} Extension ID Not Defined\n\n` +
    `For MAIN world content_scripts, the extension ID must be specified.\n` +
    `Ensure your extension have a fixed ID and that the ${brightYellow('publicPath')}\n` +
    `of your ${brightYellow('extension.config.js')} is defined as your extension URL.`
  )
}
