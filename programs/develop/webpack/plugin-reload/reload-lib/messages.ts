import path from 'path'
import {type Compiler} from 'webpack'
import {
  bold,
  bgWhite,
  red,
  underline,
  green,
  blue,
  black,
  magenta,
  cyan
} from '@colors/colors/safe'

import {getDirectorySize} from './calculate-dir-size'
import {type Manifest} from '../../../types'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

export function extensionData(
  compiler: Compiler,
  browser: string,
  message: {data?: Data},
  isFirstRun?: boolean
) {
  if (!message.data) {
    // TODO: cezaraugusto this happens when the extension
    // can't reach the background script. This can be many
    // things such as a mismatch config or if after an error
    // the extension starts disabled. Improve this error.
    return `[⛔️] ${bgWhite(bold(` ${browser}-browser `))} ${red(
      '✖︎✖︎✖︎'
    )} No data received from client.

Ensure your extension is enabled and that no hanging browser instance is open then try again.`
  }

  const compilerOptions = compiler.options
  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      return (
        `[⛔️] ${bgWhite(bold(` ${browser}-browser `))} ${green('►►►')} ` +
        `No management API info received from client. Investigate.`
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

  return `
${bold(`• Name:`)} ${name}
${description && bold(`• Description:`)} ${description}
${bold(`• Version:`)} ${version}
${bold(`• Size:`)} ${getDirectorySize(compilerOptions.output.path || 'dist')}
${bold(`• ID:`)} ${id} ${fixedId ? '(permantent)' : '(temporary)'}
${hasHost && bold(`• Host Permissions:`)} ${hostPermissions.sort().join(', ')}
${bold(`• Permissions:`)} ${
    permissionsParsed.sort().join(', ') || 'Browser defaults'
  }
${bold(`• Settings URL:`)} ${underline(
    blue(`${browser}://extensions/?id=${id}`)
  )}\n`
}

export function stdoutData(
  compiler: Compiler,
  browser: string,
  message: {data?: Data}
) {
  const compilerOptions = compiler.options
  const management = message.data?.management
  const crRuntime = bgWhite(black(bold(` ${browser}-browser `)))

  const modeColor = compilerOptions.mode === 'production' ? magenta : cyan
  const capitalize = (str: string) => str.charAt(0).toUpperCase() + str.slice(1)
  return (
    `${crRuntime} ${green('►►►')} Running ${capitalize(browser)} in ${bold(
      modeColor(compilerOptions.mode || 'unknown')
    )} mode. ` +
    `Browser ${management?.type} ${bold(
      management?.enabled ? 'enabled' : 'disabled'
    )}.`
  )
}

export function isFirstRun() {
  ;`This is your first run using ${bold('Extension.js')}. Welcome! 🎉\n` +
    `\n🧩 Learn more at ${blue(underline(`https://extension.js.org`))}`
}

export function watchModeClosed(code: number, reason: Buffer) {
  const message = reason.toString()

  return `[😓] ${bgWhite(bold(` chrome-browser `))} ${red(
    '✖︎✖︎✖︎'
  )} Watch mode closed (code ${code}). ${
    message && '\n\nReason ' + message + '\n'
  }Exiting...\n`
}

export function webSocketError(error: any) {
  return `[⛔️] ${bgWhite(bold(` chrome-browser `))} ${red(
    '✖︎✖︎✖︎'
  )} WebSocket error: ${error}`
}
