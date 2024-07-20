import fs from 'fs'
import path from 'path'
import {bold, blue, magenta, green} from '@colors/colors/safe'
import getDirectorySize from './sizes'
import {type StartOptions} from '../extensionStart'

function getLocales(projectPath: string, manifest: Record<string, any>) {
  const defaultLocale = manifest.default_locale as string

  // Get the list of all locale folders
  const localesDir = path.join(projectPath, '_locales')

  if (!fs.existsSync(localesDir)) {
    return {
      defaultLocale: 'EN',
      otherLocales: []
    }
  }

  const localeFolders = fs
    .readdirSync(localesDir)
    .filter((folder) => folder !== defaultLocale)

  return {
    defaultLocale,
    otherLocales: localeFolders
  }
}

export function startWebpack(projectDir: string, options: StartOptions) {
  const outputPath = path.join(projectDir, 'dist', options.browser || 'chrome')
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest: Record<string, any> = require(manifestPath)

  const {name, description, version, hostPermissions, permissions} = manifest

  const defaultLocale = getLocales(projectDir, manifest).defaultLocale
  const otherLocales = getLocales(projectDir, manifest).otherLocales.join(', ')
  const locales = `${defaultLocale} (default) ${
    otherLocales && ', ' + otherLocales
  }`
  const hasHost = hostPermissions && hostPermissions.length
  const hasPermissions = permissions && permissions.length

  console.log('')
  console.log(`${bold(`• Name:`)} ${name}`)
  description && console.log(`${bold(`• Description:`)} ${description}`)
  console.log(`${bold(`• Version:`)} ${version}`)
  console.log(`${bold(`• Size:`)} ${getDirectorySize(outputPath)}`)
  console.log(`${bold(`• Locales:`)} ${locales}`)

  console.log(
    `${bold(`• Host Permissions`)}: ${
      hasHost ? hostPermissions.sort().join(', ') : 'Browser defaults'
    }`
  )

  console.log(
    `${bold(`• Permissions:`)} ${
      hasPermissions ? permissions.sort().join(', ') : 'Browser defaults'
    }`
  )

  console.log('')
}

export function ready(options: StartOptions) {
  const capitalizedBrowserName =
    options.browser!.charAt(0).toUpperCase() + options.browser!.slice(1)

  console.log(
    `${bold(`🧩 Extension.js ${green('►►►')}`)} ` +
      `Running ${capitalizedBrowserName} in ${magenta(
        bold('production')
      )} mode. Browser extension ${bold('enabled')}...`
  )
}

export function building(options: StartOptions) {
  const capitalizedBrowserName =
    options.browser!.charAt(0).toUpperCase() + options.browser!.slice(1)

  console.log(
    `${bold(`🧩 Extension.js ${blue('►►►')}`)} ` +
      `Building the extension package against ${bold(
        capitalizedBrowserName
      )}...`
  )
}
