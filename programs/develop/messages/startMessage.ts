import path from 'path'
import {bold, blue} from '@colors/colors/safe'
import getDirectorySize from './sizes'
import {StartOptions} from '../extensionStart'

export function startWebpack(projectDir: string, options: StartOptions) {
  const outputPath = path.join(projectDir, 'dist', options.browser || 'chrome')
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest = require(manifestPath)

  const {name, description, version, hostPermissions, permissions} = manifest

  const manifestFromCompiler = require(manifestPath)
  // If a permission is used in the post compilation but not
  // in the pre-compilation step, add a "dev only" string to it.
  const id = manifestFromCompiler.id
  const hasHost = hostPermissions && hostPermissions.length
  const hasPermissions = permissions && permissions.length

  console.log('')
  console.log(`${bold(`• Name:`)} ${name}`)
  description && console.log(`${bold(`• Description:`)} ${description}`)
  console.log(`${bold(`• Version:`)} ${version}`)
  console.log(`${bold(`• Size:`)} ${getDirectorySize(outputPath)}`)
  id && console.log(`${bold(`• ID:`)} ${manifestFromCompiler.id}`)
  hasHost &&
    console.log(
      `${bold(`• Host Permissions`)}: ${hostPermissions.sort().join(', ')}`
    )
  hasPermissions &&
    console.log(
      `${bold(`• Permissions:`)} ${permissions.sort().join(', ')}` ||
        '(Using defaults)'
    )
}

export function ready(projectDir: string, options: StartOptions) {
  const outputPath = path.join(projectDir, 'dist', options.browser || 'chrome')
  const manifestPath = path.join(outputPath, 'manifest.json')
  const manifest = require(manifestPath)
  const capitalizedBrowserName =
    options.browser!.charAt(0).toUpperCase() + options.browser!.slice(1)

  console.log(
    bold(
      `\n🧩 Extension.js ${blue('►►►')} ${manifest.name} (v${manifest.version}) `
    ) + ` preview is ready. Starting ${bold(capitalizedBrowserName)}...`
  )
}

export function building(options: StartOptions) {
  const capitalizedBrowserName =
    options.browser!.charAt(0).toUpperCase() + options.browser!.slice(1)

  console.log(
    `${bold(`🧩 Extension.js ${blue('►►►')}`)}` +
    `Building the extension package against ${bold(capitalizedBrowserName)}...`
  )
}
