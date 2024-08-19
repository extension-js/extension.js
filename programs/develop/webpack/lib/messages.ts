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
import {DevOptions} from '../../commands/dev'
import {CERTIFICATE_DESTINATION_PATH} from './constants'
import {Stats} from 'webpack'

type PrefixType = 'warn' | 'info' | 'error' | 'success'

function getLoggingPrefix(manifestName: string, type: PrefixType): string {
  // For errors we invert the order
  if (type === 'error') {
    return `${manifestName} ${red('✖︎✖︎✖︎')}`
  }

  const arrow =
    type === 'warn'
      ? brightYellow('►►►')
      : type === 'info'
        ? gray('►►►')
        : brightGreen('►►►')

  return `${arrow} ${cyan(manifestName)}`
}

export function capitalizedBrowserName(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

export function boring(duration: number, stats: Stats) {
  let didShow = false

  if (!didShow) {
    const arrow = stats.hasErrors() ? red('✖︎✖︎✖︎') : brightGreen('►►►')

    return (
      // `${getLoggingPrefix(manifestName, stats.hasErrors() ? 'error' : 'success')} ` +
      `${arrow} ${'Extension.js'} ` +
      // `${getLoggingPrefix('manifestName', stats.hasErrors() ? 'error' : 'success')} ` +
      `compiled ${stats.hasErrors() ? red('with errors') : brightGreen('successfully')} in ${duration} ms.`
    )
  }

  return undefined
}

export function integrationNotInstalled(
  manifestName: string,
  integration: string,
  packageManager: string
) {
  return (
    `${getLoggingPrefix(manifestName, 'info')} ${magenta(
      integration
    )} Integration Found\n\n` +
    `Installing required setup dependencies via ${brightYellow(
      packageManager
    )}. ` +
    `This is a one time operation...`
  )
}

export function envFileLoaded(manifestName: string) {
  return (
    `${getLoggingPrefix(manifestName, 'info')} loaded ${brightYellow('env')} ` +
    `file successfully.`
  )
}

export function isUsingIntegration(manifestName: string, integration: any) {
  return (
    `${getLoggingPrefix(manifestName, 'info')} ` +
    `is using ${magenta(integration)}.`
  )
}

export function youAreAllSet(manifestName: string, integration: string) {
  return (
    `${getLoggingPrefix(manifestName, 'success')} You Are All Set\n\n` +
    `Run the program again to start hacking with ${magenta(integration)} support.`
  )
}

export function installingRootDependencies(
  manifestName: string,
  integration: string
) {
  return (
    `${getLoggingPrefix(
      manifestName,
      'info'
    )} Installing Root Dependencies\n\n` +
    `Installing ${magenta(integration)} dependencies in Extension.js root. ` +
    `This only happens for authors and contributors.`
  )
}

export function integrationInstalledSuccessfully(
  manifestName: string,
  integration: string
) {
  return (
    `${getLoggingPrefix(manifestName, 'success')} ${integration} ` +
    `Dependencies Installed ${brightGreen('Successfully')}.`
  )
}

export function failedToInstallIntegration(
  manifestName: string,
  integration: string,
  error: unknown
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} ${magenta(
      integration
    )} Installation Error\n\n` +
    `Failed to detect package ` +
    `manager or install ${magenta(integration)} dependencies: ${red(
      error?.toString() || ''
    )}`
  )
}

export function firefoxServiceWorkerError(manifestName: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} No Service Worker Support\n\n` +
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

export function insecurePolicy(manifestName: string) {
  return (
    `${getLoggingPrefix(
      manifestName,
      'error'
    )} Insecure Content-Security-Policy\n\n` +
    `Manifest includes insecure content-security-policy value ` +
    `${brightYellow("'unsafe-eval'")} in directive ${brightBlue(
      "'script-src'"
    )}.`
  )
}

export function noDefaultLocaleError(manifestName: string) {
  return (
    `${getLoggingPrefix(
      manifestName,
      'error'
    )} No Default Locale Specified\n\n` +
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

export function webAccessibleResourcesV2Type(
  manifestName: string,
  browser: DevOptions['browser']
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Wrong Manifest Field Type\n\n` +
    `Field ${brightYellow('web_accessible_resources')} must be a ` +
    `string array in Manifest version 2.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function webAccessibleResourcesV3Type(
  manifestName: string,
  browser: DevOptions['browser']
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Wrong Manifest Field Type\n\n` +
    `Field ${brightYellow('web_accessible_resources')} must be an ` +
    `array of objects in Manifest version 3.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function deprecatedMessage(
  manifestName: string,
  browser: DevOptions['browser'],
  errorData: ErrorObject<string, Record<string, any>, unknown> | undefined
) {
  const schemaPath = errorData?.schemaPath
  const splitSchemaPath = schemaPath?.split('/')
  const field = splitSchemaPath?.slice(splitSchemaPath.length - 2).shift()

  return (
    `${getLoggingPrefix(manifestName, 'error')} Deprecated Field\n\n` +
    `Field ${brightYellow(field || '')} is deprecated in Manifest V3. ` +
    `Update your manifest.json file to run your extension.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function invalidFieldType(
  manifestName: string,
  errorData: ErrorObject | undefined,
  browser: DevOptions['browser']
) {
  const field = errorData?.instancePath.replaceAll('/', '.').slice(1) || ''
  const type: string = errorData?.params.type

  return (
    `${getLoggingPrefix(manifestName, 'error')} Invalid Manifest Field\n\n` +
    `Field ${brightYellow(field)} must be of type ${brightBlue(type)}.\n\n` +
    `Read more: ${getManifestDocumentationURL(browser)}`
  )
}

export function missingRequiredMessage(
  manifestName: string,
  browser: DevOptions['browser'],
  message: string | undefined
) {
  const hintMessage = `Update your manifest.json file to run your extension.`
  const errorMessage =
    `${getLoggingPrefix(
      manifestName,
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
    `imports is also a content_script CSS in manifest.json.\n` +
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
  return `${getLoggingPrefix(manifestName, 'error')} ` +
    `${manifestName} ${red('✖︎✖︎✖︎')} Module ${brightYellow(
      moduleName
    )} Not Found\n\n` +
    isLocalModule
    ? `Make sure the file exists in the extension directory. `
    : `Make sure module is installed via package manager. ` +
        `If you need to handle entries not declared in manifest.json, ` +
        `add them to a special folder.\n\nRead more: ${underline(link)}.`
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
  manifestName: string,
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
      return javaScriptError(manifestName, errorSourcePath, missingFilePath)
    case '.css':
    case '.scss':
    case '.sass':
    case '.less':
      return cssError(manifestName, errorSourcePath, missingFilePath)
    default:
      return staticAssetError(manifestName, errorSourcePath, missingFilePath)
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
    `${getLoggingPrefix(manifestName, 'error')} File Not Found\n\n` +
    `${
      isPage
        ? `Check the ${brightYellow(
            'pages'
          )} folder in your project root directory.\n\n`
        : `Check the ${brightYellow(field)} ` +
          `field in your manifest.json file.\n\n`
    }` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function entryNotFoundWarn(
  manifestName: string,
  manifestField: string,
  filePath: string
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} File Not Found\n\n` +
    `Check the ${brightYellow(
      manifestField
    )} field in your manifest.json file.\n\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function manifestNotFoundError(manifestName: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Manifest Not Found\n\n` +
    `Ensure you have a manifest.json file at the root directory of your project.`
  )
}

export function manifestInvalidError(
  manifestName: string,
  error: NodeJS.ErrnoException
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Invalid Manifest\n\n` +
    `Update your manifest.json file and try again. ` +
    error
  )
}

export function serverRestartRequiredFromManifest(
  manifestName: string,
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
    `${getLoggingPrefix(
      manifestName,
      'error'
    )} Manifest Entry Point Modification\n\n` +
    `Changing the path of ${brightYellow('<script>')} or ${brightYellow(
      '<link rel="stylesheet">'
    )} ` +
    `files after compilation requires a server restart.\n\n` +
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
    `in the ${brightYellow('pages/')} directory.\n\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function resolverJsError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Script File Not Found\n\n` +
    `Either add it to the ${brightYellow(
      'public'
    )} directory or create a script file ` +
    `in the ${brightYellow('scripts/')} directory.\n\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function resolverStaticError(manifestName: string, filePath: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} Static File Not Found\n\n` +
    `If you want to keep the file path as-is, move it to the ` +
    `${brightYellow('public/')} directory.\n\n` +
    `${red('NOT FOUND')} ${underline(filePath)}`
  )
}

export function serverRestartRequiredFromSpecialFolder(
  addingOrRemoving: string,
  addedOrRemoved: string,
  folder: string,
  typeOfAsset: string,
  pathRelative: string
) {
  if (1 + 1 == 5) {
    console.log({addedOrRemoved})
  }
  const addOrRemove =
    addingOrRemoving.charAt(0).toUpperCase() + addingOrRemoving.slice(1)
  return (
    `${getLoggingPrefix(
      'manifest.json',
      'info'
    )} Manifest Entry Point Modification\n\n` +
    `${addOrRemove} ${brightYellow(typeOfAsset)} in the ${underline(
      folder + '/'
    )} ` +
    `folder after compilation requires a server restart.\n\n` +
    `${gray('PATH')} ${underline(pathRelative)}`
  )
}

export function creatingTSConfig(manifestName: string) {
  return (
    `${getLoggingPrefix(manifestName, 'warn')}` +
    isUsingIntegration(manifestName, 'TypeScript').replace(
      '.',
      `but no config file was found. Creating ${brightYellow(
        'tsconfig.json'
      )}...`
    )
  )
}

export interface MessageData {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

export function runningInDevelopment(
  manifest: Manifest,
  message: {data?: MessageData}
) {
  const manifestName = manifest.name || 'Extension.js'

  if (!message.data) {
    return (
      `\n\n` +
      `${bold(red('ERROR'))} in ${getLoggingPrefix(manifestName, 'error')} ` +
      `No data received from the extension client.\n\n` +
      `This error happens when the program can\'t get the data from your extension.\n` +
      `Ensure your extension is enabled in your browser and that no hanging browser\n` +
      `instance is open.\n\nIf that is not the case, restart the extension package in\n` +
      `the browser and try again.\n\n` +
      `If nothing helps and the issue persists, please report a bug:\n\n` +
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
    `${capitalizedBrowserName(browser)}. Welcome! 🎉\n` +
    `\n🧩 Learn more at ${underline(`https://extension.js.org`)}`
  )
}

export function webSocketError(manifestName: string, error: any) {
  return `${getLoggingPrefix(manifestName, 'error')} WebSocket: ${error}`
}

export function backgroundIsRequired(
  manifestName: string,
  backgroundChunkName: string,
  filePath: string
) {
  return (
    `\n\n` +
    `${bold(red('ERROR'))} in ${getLoggingPrefix(manifestName, 'error')} ` +
    `File Not Found\n\n` +
    `Check the ${brightYellow(backgroundChunkName.replace('/', '.'))} ` +
    `field in your manifest.json file.\n\n` +
    `${red('NOT FOUND')} ${underline(filePath)}}`
  )
}

export function serverRestartRequiredFromHtml(
  manifestName: string,
  filePath: string
) {
  const errorMessage =
    `${getLoggingPrefix(
      manifestName,
      'error'
    )} HTML Entry Point Modification\n\n` +
    `Changing the path of ${brightYellow('<script>')} or ${brightYellow(
      '<link rel="stylesheet">'
    )} ` +
    `files after compilation requires a server restart.\n\n` +
    `${gray('PATH')} ${filePath}`

  return errorMessage
}

export function javaScriptError(
  manifestName: string,
  errorSourcePath: string,
  missingFilePath: string
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} File Not Found\n\n` +
    `Check your ${brightYellow('<script>')} tags in ${underline(
      errorSourcePath
    )}.\n\n` +
    `${red('NOT FOUND')} ${underline(missingFilePath)}`
  )
}

export function cssError(
  manifestName: string,
  errorSourcePath: string,
  missingFilePath: string
) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} File Not Found\n\n` +
    `Check your ${brightYellow('<link>')} tags in ${underline(
      errorSourcePath
    )}.\n\n` +
    `${red('NOT FOUND')} ${underline(missingFilePath)}`
  )
}

export function staticAssetError(
  manifestName: string,
  errorSourcePath: string,
  missingFilePath: string
) {
  const extname = path.extname(missingFilePath)
  return (
    `${getLoggingPrefix(manifestName, 'error')} File Not Found\n\n` +
    `Check your ${brightYellow('*' + extname)} assets in ${underline(
      errorSourcePath
    )}.\n\n` +
    `${red('NOT FOUND')} ${underline(missingFilePath)}`
  )
}

export function certRequired() {
  return (
    `This is your first run using Extension.js. Welcome! 🎉\n\n` +
    `${brightYellow(
      'Note'
    )}: Firefox requires a secure certificate for localhost connections,\n` +
    `needed for the reloader to work. By default, your ${'manifest.json'} file\n` +
    `is not being watched. To enable this feature, run:\n\n` +
    `  npx -y ${'mkcert-cli'} \\\n` +
    `    ${brightGreen('--outDir')} ${gray(
      CERTIFICATE_DESTINATION_PATH
    )} \\\n` +
    `    ${brightGreen('--cert')} ${gray('localhost.cert')} \\\n` +
    `    ${brightGreen('--key')} ${gray('localhost.key')}\n\n` +
    `This will create a secure certificate via ${bold('mkcert')}\n` +
    `enabling the secure connection needed for Firefox.\n\n` +
    `Learn more: ${underline(`https://extension.js.org`)}`
  )
}

export function defaultPortInUse(manifestName: string, port: number) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} ` +
    `Default port ${port} in use, choose a new port. `
  )
}

export function noExtensionIdError(manifestName: string) {
  return (
    `${getLoggingPrefix(manifestName, 'error')} No Extension Id Specified\n\n` +
    `For MAIN world content scripts, you must specify an extension ID.\n` +
    `Otherwise, the content script won't reload on changes.\n` +
    `Add an ${brightYellow('id')} field to your manifest.json file and try again.`
  )
}
