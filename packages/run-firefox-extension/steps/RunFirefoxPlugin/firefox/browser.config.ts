import path from 'path'
import fs from 'fs'
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

function getManifestId(extensionPath: string) {
  const manifestPath = path.join(extensionPath, 'manifest.json')
  const manifest = require(manifestPath)

  return manifest?.id || manifest?.browser_specific_settings?.gecko?.id
}

function copyDirectory(srcDir: string, destDir: string) {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, {recursive: true})
  }

  const items = fs.readdirSync(srcDir, {withFileTypes: true})

  items.forEach((item) => {
    const srcPath = path.join(srcDir, item.name)
    const destPath = path.join(destDir, item.name)

    if (item.isDirectory()) {
      copyDirectory(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  })
}

export default function browserConfig(
  configOptions: RunFirefoxExtensionInterface
) {
  const userBrowserExtension =
    path.dirname(configOptions.manifestPath as string) + '/dist/firefox'

  // const extensionsToLoad: string[] = []
  const extensionsToLoad: string[] = [
    `"${userBrowserExtension}"`,
    managerExtension
  ]

  if (configOptions.autoReload) {
    extensionsToLoad.push(reloadExtension)
  }

  const profile = createUserDataDir(configOptions.userDataDir)
  // extensionsDir exists but is not typed in the library.
  const extensionsDir = (profile as any).extensionsDir

  for (const extensionPath of extensionsToLoad) {
    const extensionPathNormalized = extensionPath.replace(/"/g, '')
    const extensionId = getManifestId(extensionPathNormalized)

    const destPath = path.join(extensionsDir, `${extensionId}`)

    // BUG: cezaraugusto for some reason directory
    // is copied but then removed from the correct path.
    copyDirectory(extensionPathNormalized, destPath)
  }

  // Assume updatePreferences is a method of profile that needs to be called.
  profile.updatePreferences()
  return profile
}
