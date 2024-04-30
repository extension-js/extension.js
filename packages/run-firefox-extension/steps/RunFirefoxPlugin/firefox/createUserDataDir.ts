// Ideas here are adapted from
// https://github.com/jeremyben/webpack-firefox-extension-launcher
// Released under MIT license.

import path from 'path'
import fs from 'fs'
import {bold} from '@colors/colors/safe'
import addProgressBar from '../../../helpers/addProgressBar'
import FirefoxProfile from 'firefox-profile'
import masterPreferences from './masterPreferences'

function configureProfile(profile: FirefoxProfile): FirefoxProfile {
  // Apply default preferences
  const preferenceEntries = Object.entries(masterPreferences)

  preferenceEntries.forEach(([pref, value]) => {
    profile.setPreference(pref, value)
  })

  profile.updatePreferences()

  return profile
}

export default function createUserDataDir(
  dataDirPath?: string,
  silent?: boolean
): FirefoxProfile {
  const defaultProfileDir = path.resolve(__dirname, 'run-firefox-data-dir')

  if (!fs.existsSync(defaultProfileDir)) {
    fs.mkdirSync(defaultProfileDir, {recursive: true})
  }

  if (dataDirPath) {
    if (!fs.existsSync(dataDirPath)) {
      fs.mkdirSync(dataDirPath, {recursive: true})
    }
  }

  const profileDirectory = dataDirPath || defaultProfileDir
  const browserProfile = new FirefoxProfile({profileDirectory})
  const profilePath = configureProfile(browserProfile).path()

  if (!silent) {
    addProgressBar(
      `👤 Creating ${bold('Firefox')} user data directory...`,
      () => {
        fs.mkdirSync(profilePath, {recursive: true})
      }
    )
  }

  return configureProfile(browserProfile)
}
