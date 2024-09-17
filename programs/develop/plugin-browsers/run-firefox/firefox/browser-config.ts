import {Compiler} from 'webpack'
import {createUserDataDir} from './create-profile'
import {type DevOptions} from '../../../commands/dev'

export async function browserConfig(
  compiler: Compiler,
  configOptions: DevOptions
) {
  const {
    browser,
    startingUrl,
    preferences,
    userDataDir,
    browserFlags = []
  } = configOptions

  const userProfilePath = createUserDataDir(browser, userDataDir, preferences)
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
