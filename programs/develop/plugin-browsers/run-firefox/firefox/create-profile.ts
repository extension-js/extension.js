import path from 'path'
import fs from 'fs'
import FirefoxProfile from 'firefox-profile'
import {getPreferences} from './master-preferences'
import * as messages from '../../browser-lib/messages'
import {addProgressBar} from '../../browser-lib/add-progress-bar'
import {DevOptions} from '../../../commands/dev'

function configureProfile(
  profile: FirefoxProfile,
  customPreferences: Record<string, any>
) {
  const preferences: Record<string, any> = getPreferences(customPreferences)
  const preferenceKeys = Object.keys(preferences)

  preferenceKeys.forEach((preference) => {
    profile.setPreference(preference, preferences[preference] as string)
  })

  const customPreferenceKeys = Object.keys(customPreferences)

  if (customPreferenceKeys.length > 0) {
    customPreferenceKeys.forEach((custom) => {
      profile.setPreference(custom, customPreferences[custom] as string)
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
  browser: DevOptions['browser'],
  profilePath: string,
  customPreferences: Record<string, any>
) {
  let destinationDirectory: string

  const profileIsDirPath = fs.statSync(profilePath).isDirectory()

  if (profileIsDirPath) {
    destinationDirectory = profilePath
  } else {
    throw new Error(messages.pathIsNotDir(browser, profilePath))
  }

  const profile = new FirefoxProfile({destinationDirectory})
  const profileConfigured = configureProfile(profile, customPreferences)

  return profileConfigured
}

export function createUserDataDir(
  browser: DevOptions['browser'],
  dataDirPath: string | undefined,
  preferences?: Record<string, any>,
  silent?: boolean
) {
  let profile: FirefoxProfile
  const dataDir = dataDirPath || path.resolve(__dirname, 'run-firefox-data-dir')

  if (fs.existsSync(dataDir)) {
    profile = getProfile(browser, dataDir, preferences || {})
  } else {
    if (!silent) {
      addProgressBar(messages.creatingUserProfile(browser), () => {})
    }

    fs.mkdirSync(dataDir, {recursive: true})
    profile = createProfile(dataDir, preferences || {})
  }

  return profile
}
