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

  // Ensure that either the specified data directory or the default directory exists
  const profileDirectory = dataDirPath || defaultProfileDir

  console.log({profileDirectory})
  if (!fs.existsSync(profileDirectory)) {
    fs.mkdirSync(profileDirectory, {recursive: true})
    if (!silent) {
      addProgressBar(
        `👤 Creating ${bold(
          'Firefox'
        )} user data directory at ${profileDirectory}...`,
        () => {}
      )
    }
  }

  const browserProfile = new FirefoxProfile({
    destinationDirectory: profileDirectory
  })
  return configureProfile(browserProfile)
}
