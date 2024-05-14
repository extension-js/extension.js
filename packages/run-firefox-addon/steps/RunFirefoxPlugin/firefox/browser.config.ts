import {type RunFirefoxExtensionInterface} from '../../../types'
import createUserDataDir from './createUserDataDir'

export default async function browserConfig(
  configOptions: RunFirefoxExtensionInterface
) {
  const {
    startingUrl,
    preferences,
    userDataDir,
    browserConsole = false,
    browserFlags = []
  } = configOptions

  const profile = createUserDataDir(userDataDir, preferences)
  const binaryArgs: string[] = []

  if (startingUrl) {
    binaryArgs.push(`--url "${startingUrl}"`)
  }

  if (browserConsole) {
    binaryArgs.push('--jsconsole')
  }

  if (browserFlags) {
    binaryArgs.push(...browserFlags)
  }

  return [
    `--binary-args "${browserFlags.join(' ')}"`,
    `--profile "${profile.path()}"`,
    `--listen ${configOptions.port! + 100}`,
    '--verbose'
  ].join(' ')
}
