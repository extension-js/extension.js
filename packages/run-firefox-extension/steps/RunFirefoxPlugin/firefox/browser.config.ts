import path from 'path'
import {type RunFirefoxExtensionInterface} from '../../../types'
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
  configOptions: RunFirefoxExtensionInterface
) {
  const userBrowserExtension = configOptions.extensionPath?.replace(
    'manifest.json',
    ''
  )

  const extensionsToLoad = [`"${userBrowserExtension}"`, managerExtension]

  if (configOptions.autoReload) {
    extensionsToLoad.push(reloadExtension)
  }

  const profile = createUserDataDir(configOptions.userDataDir)

  profile.addExtensions(extensionsToLoad, function () {})

  // Flags set by default:
  // https://github.com/GoogleFirefox/firefox-launcher/blob/master/src/flags.ts
  return [
    `--user-data-dir=${profile.path()}`,
    // Flags to pass to Firefox
    // Any of http://peter.sh/experiments/chromium-command-line-switches/
    ...(configOptions.browserFlags || [])
  ].join(' ')
}
