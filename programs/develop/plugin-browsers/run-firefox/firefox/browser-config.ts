import {Compilation} from '@rspack/core'
import {createProfile} from './create-profile'
import {calculateDebugPort} from '../../browsers-lib/shared-utils'
import {
  type DevOptions,
  type BrowserConfig
} from '../../../commands/commands-lib/config-types'

export async function browserConfig(
  compilation: Compilation,
  configOptions: DevOptions &
    BrowserConfig & {
      keepProfileChanges?: boolean
      copyFromProfile?: string
    }
) {
  const {
    browser,
    startingUrl,
    preferences,
    profile,
    browserFlags = [],
    keepProfileChanges,
    copyFromProfile,
    source,
    watchSource
  } = configOptions

  const userProfilePath = createProfile(compilation, {
    browser,
    userProfilePath: profile,
    configPreferences: preferences,
    keepProfileChanges,
    copyFromProfile
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

  // Use portFromConfig if available, otherwise fall back to devServerPort
  const devServerPort = (compilation.options.devServer as any)?.port
  const debugPort = calculateDebugPort(portFromConfig, devServerPort, 9222)

  // Only enable remote debugging if source inspection is active
  const isSourceInspectionEnabled = source || watchSource
  const listenFlag = isSourceInspectionEnabled ? `--listen=${debugPort}` : ''

  return [
    `--binary-args="${binaryArgs.join(' ')}"`,
    `--profile="${userProfilePath.path()}"`,
    ...(listenFlag ? [listenFlag] : []),
    '--verbose'
  ].join(' ')
}
