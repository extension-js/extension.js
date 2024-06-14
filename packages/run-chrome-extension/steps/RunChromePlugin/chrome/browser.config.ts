import path from 'path'
import {Compiler} from 'webpack'
import {type RunChromeExtensionInterface} from '../../../types'
import createUserDataDir from './createUserDataDir'

const managerExtension = path.resolve(
  __dirname,
  'extensions',
  'manager-extension'
)
const reloadExtension = path.resolve(
  __dirname,
  'extensions',
  'reload-extension'
)

export default function browserConfig(
  compiler: Compiler,
  configOptions: RunChromeExtensionInterface
) {
  const userBrowserExtension = configOptions.extensionPath?.replace(
    'manifest.json',
    ''
  )

  const extensionsToLoad = [userBrowserExtension]

  if (compiler.options.mode === 'development') {
    if (configOptions.autoReload) {
      extensionsToLoad.push(reloadExtension)
    }
  }

  if (compiler.options.mode === 'development') {
    extensionsToLoad.push(managerExtension)
  }

  // Flags set by default:
  // https://github.com/GoogleChrome/chrome-launcher/blob/master/src/flags.ts
  return [
    `--load-extension=${extensionsToLoad.join()}`,
    `--user-data-dir=${createUserDataDir(configOptions.userDataDir)}`,
    // Disable Chrome's native first run experience.
    '--no-first-run',
    // Flags to pass to Chrome
    // Any of http://peter.sh/experiments/chromium-command-line-switches/
    ...(configOptions.browserFlags || [])
  ]
}
