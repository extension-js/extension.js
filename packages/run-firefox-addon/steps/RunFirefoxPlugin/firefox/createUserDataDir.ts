import path from 'path'
import fs from 'fs'
import FirefoxProfile from 'firefox-profile'
import {getPreferences} from './masterPreferences'
import {bgWhite, red, bold} from '@colors/colors/safe'
import addProgressBar from '../../../helpers/addProgressBar'

function configureProfile(
  profile: FirefoxProfile,
  customPreferences: Record<string, any>
) {
  const preferences: Record<string, any> = getPreferences(customPreferences)
  const preferenceKeys = Object.keys(preferences)

  preferenceKeys.forEach((preference) => {
    profile.setPreference(preference, preferences[preference])
  })

  const customPreferenceKeys = Object.keys(customPreferences)

  if (customPreferenceKeys.length > 0) {
    customPreferenceKeys.forEach((custom) => {
      profile.setPreference(custom, customPreferences[custom])
    })
  }

  profile.updatePreferences()

  return profile
}

function createProfile(
  destinationDirectory: string,
  customPreferences: Record<string, any>
) {
  const profile = new FirefoxProfile({destinationDirectory})
  const profileConfigured = configureProfile(profile, customPreferences)

  return profileConfigured
}

function getProfile(
  profilePath: string,
  customPreferences: Record<string, any>
) {
  let destinationDirectory: string

  const profileIsDirPath = fs.statSync(profilePath).isDirectory()

  if (profileIsDirPath) {
    destinationDirectory = profilePath
  } else {
    throw new Error(
      `${bgWhite(red(` chrome-browser `))} ${red(`✖︎✖︎✖︎`)} ` +
        `The path ${profilePath} is not a directory. ` +
        `Please provide a valid directory path.`
    )
  }

  const profile = new FirefoxProfile({destinationDirectory})
  const profileConfigured = configureProfile(profile, customPreferences)

  return profileConfigured
}

export default function createUserDataDir(
  dataDirPath: string | undefined,
  preferences?: Record<string, any>,
  silent?: boolean
) {
  let profile: FirefoxProfile
  const dataDir = dataDirPath || path.resolve(__dirname, 'run-firefox-data-dir')

  if (fs.existsSync(dataDir)) {
    profile = getProfile(dataDir, preferences || {})
  } else {
    if (!silent) {
      addProgressBar(
        `👤 Creating ${bold('Firefox')} user data directory...`,
        () => {}
      )
    }

    fs.mkdirSync(dataDir, {recursive: true})
    profile = createProfile(dataDir, preferences || {})
  }

  return profile
}
