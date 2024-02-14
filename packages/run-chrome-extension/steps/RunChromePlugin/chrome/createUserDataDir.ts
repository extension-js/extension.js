// Ideas here are adapted from
// https://github.com/jeremyben/webpack-chrome-extension-launcher
// Released under MIT license.

import path from 'path'
import fs from 'fs-extra'
import addProgressBar from '../../../helpers/addProgressBar'

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

  // PROFILE PREFS aka "Master Preferences" aka "User Preferences"
  // * Official ref: https://www.chromium.org/administrators/configuring-other-preferences/
  // * Extra ref: https://serverfault.com/a/635203
  // * Source code: https://src.chromium.org/viewvc/chrome/trunk/src/chrome/common/pref_names.cc?view=markup
  const userProfile = JSON.stringify({
    extensions: {
      ui: {
        developer_mode: true
      }
    }
  })

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
