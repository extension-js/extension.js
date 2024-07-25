// Ideas here are adapted from
// https://github.com/jeremyben/webpack-edge-extension-launcher
// Released under MIT license.

import path from 'path'
import fs from 'fs'
import {bold} from '@colors/colors/safe'
import addProgressBar from '../../../helpers/addProgressBar'
import masterPreferences from './masterPreferences'

export default function createUserDataDir(
  dataDirPath?: string,
  silent?: boolean
) {
  if (
    dataDirPath ||
    fs.existsSync(path.resolve(__dirname, 'run-edge-data-dir'))
  ) {
    return dataDirPath || path.resolve(__dirname, 'run-edge-data-dir')
  }

  const userProfile = JSON.stringify(masterPreferences)

  if (!silent) {
    addProgressBar(`👤 Creating ${'Edge'} user data directory...`, () => {
      const profilePath = path.resolve(__dirname, 'run-edge-data-dir')
      const preferences = path.join(profilePath, 'Default')

      // Ensure directory exists
      fs.mkdirSync(preferences, {recursive: true})

      const preferencesPath = path.join(preferences, 'Preferences')

      // Actually write the user preferences
      fs.writeFileSync(preferencesPath, userProfile, 'utf8')
    })
  }

  return path.resolve(__dirname, 'run-edge-data-dir')
}
