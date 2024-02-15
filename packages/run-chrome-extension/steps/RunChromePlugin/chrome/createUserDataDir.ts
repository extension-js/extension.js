// Ideas here are adapted from
// https://github.com/jeremyben/webpack-chrome-extension-launcher
// Released under MIT license.

import path from 'path'
import fs from 'fs-extra'
import addProgressBar from '../../../helpers/addProgressBar'
import masterPreferences from './masterPreferences'

export default function createUserDataDir(dataDirPath?: string) {
  if (
    dataDirPath ||
    fs.existsSync(path.resolve(__dirname, 'run-chrome-data-dir'))
  ) {
    return {
      isFirstRun: false,
      userDataDir: dataDirPath || path.resolve(__dirname, 'run-chrome-data-dir')
    }
  }

  const userProfile = JSON.stringify(masterPreferences)

  addProgressBar('👤 Creating user data directory...', () => {
    const outputPath = path.resolve(__dirname, 'run-chrome-data-dir')
    const preferences = path.join(outputPath, 'Default')
    fs.ensureDirSync(preferences)

    const preferencesPath = path.join(preferences, 'Preferences')

    // Actually write the user preferences
    fs.writeFileSync(preferencesPath, userProfile, 'utf8')
  })

  return {
    isFirstRun: true,
    userDataDir: path.resolve(__dirname, 'run-chrome-data-dir')
  }
}
