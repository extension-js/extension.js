import {Compiler} from '@rspack/core'
import {createProfile} from './create-profile'
import {
  type DevOptions,
  type BrowserConfig
} from '../../../commands/commands-lib/config-types'

export async function browserConfig(
  compiler: Compiler,
  configOptions: DevOptions & BrowserConfig
) {
  const {
    browser,
    startingUrl,
    preferences,
    profile,
    browserFlags = []
  } = configOptions

  const userProfilePath = createProfile(browser, profile, preferences)
  const binaryArgs: string[] = []

  if (startingUrl) {
    binaryArgs.push(`--url=${startingUrl}`)
  }

  if (browserFlags) {
    binaryArgs.push(...browserFlags)
  }

  const port = (compiler.options.devServer as any)?.port
    ? (compiler.options.devServer as any)?.port + 100
    : 9222

  return [
    `--binary-args="${binaryArgs.join(' ')}"`,
    `--profile="${userProfilePath.path()}"`,
    `--listen=${port}`,
    '--verbose'
  ].join(' ')
}
