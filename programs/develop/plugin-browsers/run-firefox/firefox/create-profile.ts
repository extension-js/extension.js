import path from 'path'
import fs from 'fs'
import FirefoxProfile from 'firefox-profile'
import {getPreferences} from './master-preferences'
import * as messages from '../../browsers-lib/messages'
import {addProgressBar} from '../../browsers-lib/add-progress-bar'
import {DevOptions} from '../../../commands/dev'
import {loadBrowserConfig} from '../../../commands/commands-lib/get-extension-config'

function configureProfile(
  profile: FirefoxProfile,
  customPreferences: Record<string, any>
) {
  const firefoxMasterPreferences: Record<string, any> = {
    ...loadBrowserConfig(path.resolve(__dirname, 'run-firefox'), 'firefox'),
    ...getPreferences(customPreferences)
  }

  const preferenceKeys = Object.keys(firefoxMasterPreferences)

  preferenceKeys.forEach((preference) => {
    profile.setPreference(
      preference,
      firefoxMasterPreferences[preference] as string
    )
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
  console.log({profileConfigured})
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
    throw new Error(messages.pathIsNotDirectoryError(browser, profilePath))
  }

  const profile = new FirefoxProfile({destinationDirectory})
  const profileConfigured = configureProfile(profile, customPreferences)

  return profileConfigured
}

export function createUserDataDir(
  browser: DevOptions['browser'],
  dataDirPath: string | undefined,
  configPreferences: DevOptions['preferences']
) {
  let profile: FirefoxProfile
  const dataDir = dataDirPath || path.resolve(__dirname, 'run-firefox-data-dir')
  const firefoxMasterPreferences: Record<string, any> = getPreferences(
    configPreferences || {}
  )

  const preferences = firefoxMasterPreferences

  const userPreferences = {...preferences, ...configPreferences}

  if (fs.existsSync(dataDir)) {
    profile = getProfile(browser, dataDir, userPreferences)
  } else {
    addProgressBar(messages.creatingUserProfile(browser), () => {})

    fs.mkdirSync(dataDir, {recursive: true})
    profile = createProfile(dataDir, userPreferences)
  }

  return profile
}
