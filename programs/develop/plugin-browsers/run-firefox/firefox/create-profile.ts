import * as path from 'path'
import * as fs from 'fs'
import {Compilation} from '@rspack/core'
import FirefoxProfile from 'firefox-profile'
import {getPreferences} from './master-preferences'
import * as messages from '../../browsers-lib/messages'
import {addProgressBar} from '../../browsers-lib/add-progress-bar'
import {
  BrowserConfig,
  DevOptions
} from '../../../commands/commands-lib/config-types'
import {loadBrowserConfig} from '../../../commands/commands-lib/get-extension-config'

interface FirefoxProfileOptions {
  browser: DevOptions['browser']
  userProfilePath: string | undefined
  configPreferences: BrowserConfig['preferences']
}

/**
 * Validates a profile path for existence and permissions
 */
function validateProfilePath(
  browser: DevOptions['browser'],
  profilePath: string
): void {
  // Create directory if it doesn't exist
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(profilePath, {recursive: true})
  }

  const stats = fs.statSync(profilePath)
  if (!stats.isDirectory()) {
    throw new Error(messages.pathIsNotDirectoryError(browser, profilePath))
  }

  // Check if we have read/write permissions
  try {
    fs.accessSync(profilePath, fs.constants.R_OK | fs.constants.W_OK)
  } catch (error) {
    throw new Error(messages.pathPermissionError(browser, profilePath))
  }
}

function configureProfile(
  compilation: Compilation,
  profile: FirefoxProfile,
  customPreferences: Record<string, any>
) {
  const firefoxMasterPreferences: Record<string, any> = {
    ...loadBrowserConfig(compilation.options.context!),
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

function createProfileDir(
  compilation: Compilation,
  destinationDirectory: string,
  customPreferences: Record<string, any>,
  browser: DevOptions['browser']
) {
  const tempPath = `${destinationDirectory}.tmp`

  try {
    // Create temporary profile
    const profile = new FirefoxProfile({destinationDirectory: tempPath})
    const profileConfigured = configureProfile(
      compilation,
      profile,
      customPreferences
    )

    // Atomic rename
    fs.renameSync(tempPath, destinationDirectory)
    return profileConfigured
  } catch (error) {
    // Cleanup on failure
    if (fs.existsSync(tempPath)) {
      fs.rmSync(tempPath, {recursive: true, force: true})
    }
    throw new Error(messages.profileCreationError(browser, error))
  }
}

export function createProfile(
  compilation: Compilation,
  {browser, userProfilePath, configPreferences = {}}: FirefoxProfileOptions
) {
  let profile: FirefoxProfile
  const distPath = path.join(
    path.dirname(compilation.options.output.path!),
    '..'
  )
  const defaultProfilePath = path.resolve(
    distPath,
    'extension-js',
    'profiles',
    `${browser}-profile`
  )

  // If user provided a profile path, validate and use it
  if (userProfilePath) {
    const absoluteUserPath = path.resolve(userProfilePath)
    validateProfilePath(browser, absoluteUserPath)
    profile = new FirefoxProfile({destinationDirectory: absoluteUserPath})
    return configureProfile(compilation, profile, configPreferences)
  }

  // Create and validate default profile path
  validateProfilePath(browser, defaultProfilePath)

  // If default profile exists and has prefs.js, use it
  const prefsPath = path.join(defaultProfilePath, 'prefs.js')
  if (fs.existsSync(prefsPath)) {
    profile = new FirefoxProfile({destinationDirectory: defaultProfilePath})
    return configureProfile(compilation, profile, configPreferences)
  }

  // Create new profile
  addProgressBar(messages.creatingUserProfile(browser), () => {})
  return createProfileDir(
    compilation,
    defaultProfilePath,
    configPreferences,
    browser
  )
}
