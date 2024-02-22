import path from 'path'
import {type RunEdgeExtensionInterface} from '../../../types'
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
  configOptions: RunEdgeExtensionInterface
) {
  const userBrowserExtension = configOptions.extensionPath?.replace(
    'manifest.json',
    ''
  )

  const extensionsToLoad = [`"${userBrowserExtension}"`, managerExtension]

  if (configOptions.autoReload) {
    extensionsToLoad.push(reloadExtension)
  }

  // Flags set by default:
  // https://github.com/GoogleChrome/edge-launcher/blob/master/src/flags.ts
  return [
    `--load-extension=${extensionsToLoad.join()}`,
    `--user-data-dir=${createUserDataDir(configOptions.userDataDir)}`,
    // Disable Edge's native first run experience.
    '--no-first-run',
    // Flags to pass to Edge
    // Any of http://peter.sh/experiments/chromium-command-line-switches/
    ...(configOptions.browserFlags || [])
  ].join(' ')
}
