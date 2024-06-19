import path from 'path'
import {type Compiler} from 'webpack'
import {log, error} from 'console'
import {
  underline,
  bold,
  bgWhite,
  green,
  blue,
  red,
  yellow,
  magenta,
  cyan
} from '@colors/colors/safe'
import getDirectorySize from '../steps/calculateDirSize'
import {type ManifestBase} from '../manifest-types'
import type browser from 'webextension-polyfill-ts'

interface Data {
  id: string
  manifest: ManifestBase
  management: browser.Management.ExtensionInfo
}

function manifestFieldError(feature: string, htmlFilePath: string) {
  const hintMessage = `Check the ${bold(
    feature
  )} field in your manifest.json file and try again.`

  const errorMessage = `[manifest.json] File path ${underline(
    htmlFilePath
  )} not found. ${hintMessage}`
  return errorMessage
}

function manifestNotFound() {
  log(`
${bold("Error! Can't find the project's manifest file.")}

Check your extension ${yellow(
    'manifest.json'
  )} file and ensure its path points to
one of the options above, and try again.
`)
}

function extensionData(projectPath: string, message: {data?: Data}) {
  if (!message.data) {
    // TODO: cezaraugusto this happens when the extension
    // can't reach the background script. This can be many
    // things such as a mismatch config or if after an error
    // the extension starts disabled. Improve this error.
    error(`[⛔️] ${bgWhite(red(bold(` firefox-browser `)))} ${red(
      '✖︎✖︎✖︎'
    )} No data received from client.

Ensure your extension is enabled and that no hanging Firefox instance is open then try again.`)

    process.exit(1)
  }

  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      error(
        `[⛔️] ${bgWhite(red(bold(` firefox-browser `)))} ${green(
          '►►►'
        )} No management API info received from client. Investigate.`
      )
    }
  }

  const {name, description, version, hostPermissions, permissions} = management

  const outputPath = path.join(projectPath, 'dist', 'firefox')
  const manifestFromCompiler = require(path.join(outputPath, 'manifest.json'))
  const hostPermissionsParsed = hostPermissions?.filter(
    (permission) => !permission.startsWith('moz-extension://')
  )
  const permissionsBefore: string[] = manifestFromCompiler.permissions || []
  const permissionsAfter: string[] = permissions || []
  // If a permission is used in the post compilation but not
  // in the pre-compilation step, add a "dev only" string to it.
  const permissionsParsed: string[] = permissionsAfter.map((permission) => {
    if (permissionsBefore.includes(permission)) return permission
    return `${permission} (dev only)`
  })
  const fixedId = manifestFromCompiler.id === id
  const hasHost = hostPermissionsParsed && hostPermissionsParsed.length

  log('')
  log(`${bold(`• Name:`)} ${name}`)
  description && log(`${bold(`• Description:`)} ${description}`)
  log(`${bold(`• Version:`)} ${version}`)
  log(`${bold(`• Size:`)} ${getDirectorySize(outputPath)}`)
  log(`${bold(`• ID:`)} ${id} (${fixedId ? 'permantent' : 'temporary'})`)
  hasHost &&
    log(
      `${bold(`• Host Permissions`)}: ${hostPermissionsParsed?.sort().join(', ')}`
    )
  log(
    `${bold(`• Permissions:`)} ${permissionsParsed.length ? permissionsParsed.sort().join(', ') : 'Browser defaults'}`
  )
}

function stdoutData(compiler: Compiler, message: {data?: Data}) {
  const compilerOptions = compiler.options
  const management = message.data?.management
  const crRuntime = bgWhite(red(bold(` firefox-browser `)))

  const modeColor = compilerOptions.mode === 'production' ? magenta : cyan

  log(
    `\n${crRuntime} ${green('►►►')} Running Firefox in ${bold(
      modeColor(compilerOptions.mode || 'unknown')
    )} mode. Browser ${management?.type} ${bold(
      management?.enabled ? 'enabled' : 'disabled'
    )}.`
  )
}

function certRequired() {
  log('')
  log('This is your first run using Extension.js. Welcome! 🎉')
  log(
    '\nNote: Firefox requires a certificate for secure WebSocket connections on localhost, '
  )
  log(
    `needed for the reloader to work. By default, your ${yellow('manifest.json')} file is not being watched.`
  )
  log(`\nTo enable this feature, run:`)
  log(`
  npx -y ${bold('mkcert-cli')} \\
    ${green('--outDir')} ${path.join(process.cwd(), 'node_modules/webpack-run-firefox-addon/dist/certs')} \\
    ${green('--cert')} ${'localhost.cert'} \\
    ${green('--key')} ${'localhost.key'}
  `)
  log(
    `This will create a certificate in the plugin path via ${bold('mkcert')} and enable the secure connection for Firefox.`
  )
  log(`\n🧩 Learn more at ${blue(underline(`https://extension.js.org`))}`)
}

function isFirstRun() {
  log('')
  log('This is your first run using Extension.js. Welcome! 🎉')
}

function watchModeClosed(code: number, reason: any) {
  const message = reason.toString()

  log(
    `[😓] ${bgWhite(red(bold(` firefox-browser `)))} ${red(
      '✖︎✖︎✖︎'
    )} Watch mode closed (code ${code}). ${
      message && '\n\nReason ' + message + '\n'
    }Exiting...\n`
  )
}

function browserNotFound(chromePath: string) {
  error(
    `${bgWhite(red(bold(` firefox-browser `)))} ${red(
      '✖︎✖︎✖︎'
    )} Firefox not found at ${chromePath}`
  )
}

function webSocketError(error: any) {
  error(
    `[⛔️] ${bgWhite(red(bold(` firefox-browser `)))} ${red(
      '✖︎✖︎✖︎'
    )} WebSocket error`,
    error
  )
}

function parseFileError(error: any, filepath: string) {
  error(
    `[⛔️] ${bgWhite(red(bold(` firefox-browser `)))} ${red(
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
  certRequired,
  watchModeClosed,
  browserNotFound,
  webSocketError,
  parseFileError
}
