import {Compilation, Compiler} from '@rspack/core'
import {createProfile} from './create-profile'
import {
  type DevOptions,
  type BrowserConfig
} from '../../../commands/commands-lib/config-types'

export async function browserConfig(
  compilation: Compilation,
  configOptions: DevOptions & BrowserConfig
) {
  console.log('🔍 browserConfig called!')
  console.log('🔍 configOptions:', configOptions)

  const {
    browser,
    startingUrl,
    preferences,
    profile,
    browserFlags = []
  } = configOptions

  const userProfilePath = createProfile(compilation, {
    browser,
    userProfilePath: profile,
    configPreferences: preferences
  })
  const binaryArgs: string[] = []

  if (startingUrl) {
    binaryArgs.push('--url', startingUrl)
  }

  if (browserFlags) {
    binaryArgs.push(...browserFlags)
  }

  // Use port from configOptions if available
  const portFromConfig = (configOptions as any)?.port
  console.log('🔍 Browser config - portFromConfig:', portFromConfig)

  // Use portFromConfig if available, otherwise fall back to devServerPort
  const devServerPort = (compilation.options.devServer as any)?.port
  const finalPort = portFromConfig
    ? typeof portFromConfig === 'string'
      ? parseInt(portFromConfig, 10)
      : portFromConfig
    : devServerPort
  const debugPort = typeof finalPort === 'number' ? finalPort + 100 : 9222
  console.log('🔍 Browser config - devServerPort:', devServerPort)
  console.log('🔍 Browser config - finalPort:', finalPort)
  console.log('🔍 Browser config - calculated debugPort:', debugPort)

  return [
    `--binary-args="${binaryArgs.join(' ')}"`,
    `--profile="${userProfilePath.path()}"`,
    `--listen=${debugPort}`,
    '--verbose'
  ].join(' ')
}
