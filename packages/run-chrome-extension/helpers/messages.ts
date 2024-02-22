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
  black
} from '@colors/colors/safe'
// @ts-ignore
import prefersYarn from 'prefers-yarn'
import getDirectorySize from '../steps/calculateDirSize'
import {type ManifestBase} from '../manifest-types'

interface Data {
  id: string
  manifest: ManifestBase
  management: chrome.management.ExtensionInfo
}

function manifestFieldError(feature: string, htmlFilePath: string) {
  const hintMessage = `Check the ${bold(feature)} field in your manifest.json file and try again.`

  const errorMessage = `[manifest.json] File path \`${htmlFilePath}\` not found. ${hintMessage}`
  return errorMessage
}

function manifestNotFound() {
  log(`
${bold("Error! Can't find the project's manifest file.")}

Check your extension ${yellow('manifest.json')} file and ensure its path points to
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
    error(`[⛔️] ${bgWhite(bold(` chrome-runtime `))} ${green(
      '►►►'
    )} No data received from client.

Ensure your extension is enabled and that no hanging Chrome instance is open then try again.`)

    process.exit(1)
  }

  const compilerOptions = compiler.options
  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      error(
        `[⛔️] ${bgWhite(bold(` chrome-runtime `))} ${green(
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
  log(`${bold(`• Name:`)} ${name}`)
  description && log(`${bold(`• Description:`)} ${description}`)
  log(`${bold(`• Version:`)} ${version}`)
  log(
    `${bold(`• Size:`)} ${getDirectorySize(
      compilerOptions.output.path || 'dist'
    )}`
  )
  log(`${bold(`• ID:`)} ${id} (${fixedId ? 'fixed' : 'dynamic'})`)
  hasHost &&
    log(`${bold(`• Host Permissions`)}: ${hostPermissions.sort().join(', ')}`)
  log(`${bold(`• Permissions:`)} ${permissionsParsed.sort().join(', ')}`)
  log(
    `${bold(`• Settings URL`)}: ${underline(
      blue(`chrome://extensions/?id=${id}`)
    )}\n`
  )

  const crRuntime = bgWhite(black(bold(` chrome-runtime `)))
  // 🟠brave ⚪️chrome 🔵edge ⭕️opera 🔴firefox 🟣safari 🟢edge 🟡
  // const edgeRuntime = bgCyan(black(bold(` edge-runtime `)))
  // const ffRuntime = bgRed(white(bold(` firefox-runtime `)))
  // const operaRuntime = bgWhite(red(bold(` opera-runtime `)))
  // const braveRuntime = bgBlack(white(bold(` brave-runtime `)))
  // const vivaldiRuntime = bgMagenta(white(bold(` vivaldi-runtime `)))
  // const safariRuntime = bgWhite(blue(bold(` safari-runtime `)))

  log(
    `${crRuntime} ${green('►►►')} Running Chrome in ${
      compilerOptions.mode
    } mode. Browser ${management.type} ${
      management.enabled ? 'enabled' : 'disabled'
    }.`
  )

  if (isFirstRun) {
    log('')
    log('This is your first run using extension-create. Welcome! 🎉')
    log(
      `To start developing your extension, terminate this process and run ${bold(
        blue(prefersYarn() ? `yarn dev` : `npm run dev`)
      )}.`
    )
    log(`\n🧩 More at ${blue(underline(`https://docs.extensioncreate.com`))}`)
  }
}

function watchModeClosed(code: number, reason: Buffer) {
  const message = reason.toString()

  log(
    `[😓] ${bgWhite(bold(` chrome-runtime `))} ${red(
      '✖︎✖︎✖︎'
    )} Watch mode closed (code ${code}). ${
      message && '\n\nReason!!! ' + message + '\n'
    }Exiting...\n`
  )
}

function browserNotFound(chromePath: string) {
  error(
    `${bgWhite(bold(` chrome-runtime `))} ${red('✖︎✖︎✖︎')} Chrome not found at ${chromePath}`
  )
}

function webSocketError(error: any) {
  error(
    `[⛔️] ${bgWhite(bold(` chrome-runtime `))} ${red('✖︎✖︎✖︎')} WebSocket error`,
    error
  )
}

function parseFileError(error: any, filepath: string) {
  error(
    `[⛔️] ${bgWhite(bold(` chrome-runtime `))} ${red(
      '✖︎✖︎✖︎'
    )} Error parsing file: ${filepath}. Reason: ${error.message}`
  )
}

export default {
  manifestFieldError,
  manifestNotFound,
  extensionData,
  watchModeClosed,
  browserNotFound,
  webSocketError,
  parseFileError
}
