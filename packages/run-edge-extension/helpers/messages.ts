import path from 'path'
import {type Compiler} from 'webpack'
import {log, error} from 'console'
import {
  underline,
  bold,
  bgCyan,
  green,
  blue,
  red,
  yellow,
  white,
  magenta,
  cyan
} from '@colors/colors/safe'
import getDirectorySize from '../steps/calculateDirSize'
import {type ManifestBase} from '../manifest-types'

interface Data {
  id: string
  manifest: ManifestBase
  management: chrome.management.ExtensionInfo
}

function manifestFieldError(feature: string, htmlFilePath: string) {
  const hintMessage = `Check the ${
    feature
  } field in your manifest.json file and try again.`

  const errorMessage = `[manifest.json] File path ${underline(
    htmlFilePath
  )} not found. ${hintMessage}`
  return errorMessage
}

function manifestNotFound() {
  log(`
${"Error! Can't find the project's manifest file."}

Check your extension ${yellow(
    'manifest.json'
  )} file and ensure its path points to
one of the options above, and try again.
`)
}

function extensionData(
  compiler: Compiler,
  message: {data?: Data},
  isFirstRun?: boolean
) {
  if (!message.data) {
    // TODO: cezaraugusto this happens when the extension
    // can't reach the background script. This can be many
    // things such as a mismatch config or if after an error
    // the extension starts disabled. Improve this error.
    error(`[⛔️] ${bgCyan(white(` edge-browser `))} ${red(
      '✖︎✖︎✖︎'
    )} No data received from client.

Ensure your extension is enabled and that no hanging Edge instance is open then try again.`)

    process.exit(1)
  }

  const compilerOptions = compiler.options
  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      error(
        `[⛔️] ${bgCyan(white(` edge-browser `))} ${green(
          '►►►'
        )} No management API info received from client. Investigate.`
      )
    }
  }

  const {name, description, version, hostPermissions, permissions} = management

  const manifestPath = path.join(compilerOptions.context || '', 'manifest.json')
  const manifestFromCompiler = require(manifestPath)
  const permissionsBefore: string[] = manifestFromCompiler.permissions || []
  const permissionsAfter: string[] = permissions || []
  // If a permission is used in the post compilation but not
  // in the pre-compilation step, add a "dev only" string to it.
  const permissionsParsed: string[] = permissionsAfter.map((permission) => {
    if (permissionsBefore.includes(permission)) return permission
    return `${permission} (dev only)`
  })
  const fixedId = manifestFromCompiler.id === id
  const hasHost = hostPermissions && hostPermissions.length

  log('')
  log(`${`• Name:`} ${name}`)
  description && log(`${`• Description:`} ${description}`)
  log(`${`• Version:`} ${version}`)
  log(`${`• Size:`} ${getDirectorySize(compilerOptions.output.path || 'dist')}`)
  log(`${`• ID:`} ${id} (${fixedId ? 'permantent' : 'temporary'})`)
  hasHost &&
    log(`${`• Host Permissions`}: ${hostPermissions.sort().join(', ')}`)
  log(
    `${`• Permissions:`} ${permissionsParsed.sort().join(', ')}` ||
      '(Using defaults)'
  )
  log(
    `${`• Settings URL`}: ${underline(blue(`edge://extensions/?id=${id}`))}\n`
  )
}

function stdoutData(compiler: Compiler, message: {data?: Data}) {
  const compilerOptions = compiler.options
  const management = message.data?.management
  const edgeRuntime = bgCyan(white(` edge-browser `))
  const modeColor = compilerOptions.mode === 'production' ? magenta : cyan

  log(
    `${edgeRuntime} ${green('►►►')} Running Edge in ${modeColor(
      compilerOptions.mode || 'unknown'
    )} mode. Browser ${management?.type} ${
      management?.enabled ? 'enabled' : 'disabled'
    }.`
  )
}

function isFirstRun() {
  log('')
  log('This is your first run using Extension.js. Welcome! 🎉')
  log(`\n🧩 Learn more at ${blue(underline(`https://extension.js.org`))}`)
}

function watchModeClosed(code: number, reason: Buffer) {
  const message = reason.toString()

  log(
    `[😓] ${bgCyan(white(` edge-browser `))} ${red(
      '✖︎✖︎✖︎'
    )} Watch mode closed (code ${code}). ${
      message && '\n\nReason!!! ' + message + '\n'
    }Exiting...\n`
  )
}

function browserNotFound(edgePath: string) {
  error(
    `${bgCyan(white(` edge-browser `))} ${red(
      '✖︎✖︎✖︎'
    )} Edge not found at ${edgePath}`
  )
}

function webSocketError(error: any) {
  error(
    `[⛔️] ${bgCyan(white(` edge-browser `))} ${red(
      '✖︎✖︎✖︎'
    )} WebSocket error`,
    error
  )
}

function parseFileError(error: any, filepath: string) {
  error(
    `[⛔️] ${bgCyan(white(` edge-browser `))} ${red(
      '✖︎✖︎✖︎'
    )} Error parsing file: ${filepath}. Reason: ${error.message}`
  )
}

export default {
  manifestFieldError,
  manifestNotFound,
  extensionData,
  stdoutData,
  isFirstRun,
  watchModeClosed,
  browserNotFound,
  webSocketError,
  parseFileError
}
