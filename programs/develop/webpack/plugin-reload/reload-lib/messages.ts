import path from 'path'
import {type Compiler} from 'webpack'
import {
  red,
  underline,
  green,
  blue,
  yellow,
  magenta,
  cyan,
  gray
} from '@colors/colors/safe'

import {type Manifest} from '../../webpack-types'
import {DevOptions} from '../../../module'

interface Data {
  id: string
  manifest: Manifest
  management: chrome.management.ExtensionInfo
}

export function capitalizedBrowserName(browser: DevOptions['browser']) {
  return browser!.charAt(0).toUpperCase() + browser!.slice(1)
}

function getLoggingPrefix(
  packageName: string,
  type: 'warn' | 'info' | 'error' | 'success'
): string {
  const arrow =
    type === 'warn'
      ? yellow('►►►')
      : type === 'info'
        ? blue('►►►')
        : type === 'error'
          ? red('✖︎✖︎✖︎')
          : green('►►►')
  return `${packageName} ${arrow}`
}

export function extensionData(
  compiler: Compiler,
  packageName: string,
  message: {data?: Data}
) {
  if (!message.data) {
    // TODO: cezaraugusto this happens when the extension
    // can't reach the background script. This can be many
    // things such as a mismatch config or if after an error
    // the extension starts disabled. Improve this error.
    return (
      `${getLoggingPrefix(packageName, 'error')} No data received from client.\n` +
      `Ensure your extension is enabled and that no hanging browser instance is open then try again.`
    )
  }

  const compilerOptions = compiler.options
  const {id, management} = message.data

  if (!management) {
    if (process.env.EXTENSION_ENV === 'development') {
      return (
        `${getLoggingPrefix(packageName, 'error')} ` +
        `No management API info received from client. Investigate.`
      )
    }
  }

  const {name, version, hostPermissions, permissions, enabled} = management

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
${`🧩 ${gray('Extension.js')}`}
${`   Name:`} ${name}
${`   Version:`} ${version}
${`   ID:`} ${id} ${fixedId ? '(permantent)' : '(temporary)'}
${`   Host Permissions: ${hasHost ? hostPermissions.sort().join(', ') : 'n/a'}`} 
${`   Permissions:`} ${permissionsParsed.sort().join(', ') || 'n/a'}
${`   Enabled:`} ${enabled ? green('Yes') : red('No')}
`
}

export function stdoutData(compiler: Compiler, browser: DevOptions['browser']) {
  const compilerOptions = compiler.options
  const modeColor = compilerOptions.mode === 'production' ? magenta : cyan

  return (
    `Running browser extension in ${modeColor(compilerOptions.mode || 'unknown')} mode ` +
    `via ${capitalizedBrowserName(browser)} browser.`
  )
}

export function isFirstRun(browser: DevOptions['browser']) {
  return (
    `This is your first run using Extension.js via ${capitalizedBrowserName(browser)}. Welcome! 🎉\n` +
    `\n🧩 Learn more at ${underline(`https://extension.js.org`)}`
  )
}

export function webSocketError(packageName: string, error: any) {
  return `${getLoggingPrefix(packageName, 'error')} WebSocket error: ${error}`
}
