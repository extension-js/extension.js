import {Compiler} from 'webpack'
import {createUserDataDir} from './create-profile'
import {type PluginInterface} from '../../browsers-types'

export async function browserConfig(
  compiler: Compiler,
  configOptions: PluginInterface
) {
  const {
    browser,
    startingUrl,
    preferences,
    userDataDir,
    browserConsole = false,
    browserFlags = []
  } = configOptions

  const profile = createUserDataDir(browser, userDataDir, preferences)
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

  const port = (compiler.options.devServer as any)?.port
    ? (compiler.options.devServer as any)?.port + 100
    : 9222

  return [
    `--binary-args "${browserFlags.join(' ')}"`,
    `--profile "${profile.path()}"`,
    `--listen ${port}`,
    '--verbose'
  ].join(' ')
}
