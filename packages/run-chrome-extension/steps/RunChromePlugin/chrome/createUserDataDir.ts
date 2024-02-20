// Ideas here are adapted from
// https://github.com/jeremyben/webpack-chrome-extension-launcher
// Released under MIT license.

import path from 'path'
import fs from 'fs-extra'
import addProgressBar from '../../../helpers/addProgressBar'
import masterPreferences from './masterPreferences'

export default function createUserDataDir(
  dataDirPath?: string,
  silent?: boolean
) {
  if (
    dataDirPath ||
    fs.existsSync(path.resolve(__dirname, 'run-chrome-data-dir'))
  ) {
    return dataDirPath || path.resolve(__dirname, 'run-chrome-data-dir')
  }

  const userProfile = JSON.stringify(masterPreferences)

  if (!silent) {
    addProgressBar('👤 Creating user data directory...', () => {
      const outputPath = path.resolve(__dirname, 'run-chrome-data-dir')
      const preferences = path.join(outputPath, 'Default')
      fs.ensureDirSync(preferences)

      const preferencesPath = path.join(preferences, 'Preferences')

      // Actually write the user preferences
      fs.writeFileSync(preferencesPath, userProfile, 'utf8')
    })
  }

  return path.resolve(__dirname, 'run-chrome-data-dir')
}
