// Ideas here are adapted from
// https://github.com/jeremyben/webpack-chrome-extension-launcher
// Released under MIT license.

import path from 'path'
import fs from 'fs-extra'

export default function createUserDataDir() {
  const userProfile = JSON.stringify({
    extensions: {
      ui: {
        developer_mode: true
      }
    }
  })

  const outputPath = path.resolve(__dirname, 'run-chrome-data-dir')
  const preferences = path.join(outputPath, 'Default')

  fs.ensureDirSync(preferences)

  const preferencesPath = path.join(preferences, 'Preferences')

  // Actually write the user preferences
  fs.writeFileSync(preferencesPath, userProfile, 'utf8')

  return outputPath
}
