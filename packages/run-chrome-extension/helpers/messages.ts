import path from 'path'
import {Compiler} from 'webpack'
import {log, error} from 'console'
import getDirectorySize from '../steps/calculateDirSize'
import {ManifestBase} from '../manifest-types'

function manifestNotFound() {
  log(`
# Error! Can't find the project's manifest file.

Check your extension \`manifest.json\` file and ensure its path points to
one of the options above, and try again.
  `)
}

interface Data {
  id: string
  manifest: ManifestBase
  management: chrome.management.ExtensionInfo
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
    error(
      '[⛔️] chrome-runtime ►►► No data received from client. Ensure no hanging Chrome instance open and try again.'
    )
    process.exit(1)
  }

  const compilerOptions = compiler.options
  const {id, manifest, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      error(
        '[⛔️] chrome-runtime ►►► No management API info received from client. Investigate.'
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
  management.enabled

  log('')
  log(`• Name: ${name}`)
  description && log(`• Description: ${description}`)
  log(`• Version: ${version}`)
  log(`• Size: ${getDirectorySize(compilerOptions.output.path || 'dist')}`)
  log(`• ID: ${id} (${fixedId ? 'fixed' : 'dynamic'})`)
  hasHost && log(`• Host Permissions: ${hostPermissions.sort().join(', ')}`)
  log(`• Permissions: ${permissionsParsed.sort().join(', ')}`)
  log(`• Settings URL: chrome://extensions/?id=${id}\n`)
  log(
    `🛰️ chrome-runtime ►►► Running Chrome in ${
      compilerOptions.mode
    } mode. Browser ${management.type} ${
      management.enabled ? 'enabled' : 'disabled'
    }.`
  )

  if (isFirstRun) {
    log('')
    log('This is your first run using extension-create. Welcome! 🎉')
    log(
      'To start developing your extension, terminate this process and run `yarn dev`.\n\nHappy hacking!'
    )
  }
}

function watchModeClosed(code: number, reason: Buffer) {
  const message = reason.toString()

  log(
    `[😓] chrome-runtime ►►► Watch mode closed (code ${code}). ${
      message && '\n\nReason!!! ' + message + '\n'
    }Exiting...\n`
  )
}

function browserNotFound(chromePath: string) {
  error(`chrome-runtime ►►► Chrome not found at ${chromePath}`)
}

function webSocketError(error: any) {
  error('[⛔️] chrome-runtime ►►► WebSocket error', error)
}

function parseFileError(error: any, filepath: string) {
  error(
    `[⛔️] chrome-runtime ►►► Error parsing file: ${filepath}. Reason: ${error.message}`
  )
}

export default {
  manifestNotFound,
  extensionData,
  watchModeClosed,
  browserNotFound,
  webSocketError,
  parseFileError
}
