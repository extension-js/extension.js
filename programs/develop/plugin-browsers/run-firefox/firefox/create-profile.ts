import * as path from 'path'
import * as fs from 'fs'
import {Compilation} from '@rspack/core'
import FirefoxProfile from 'firefox-profile'
import {getPreferences} from './master-preferences'
import * as messages from '../../browsers-lib/messages'
import {addProgressBar} from '../../browsers-lib/add-progress-bar'
import {
  validateProfilePath,
  getDefaultProfilePath,
  createProfileDirectory,
  mergePreferences,
  applyPreferences
} from '../../browsers-lib/shared-utils'
import {
  BrowserConfig,
  DevOptions
} from '../../../commands/commands-lib/config-types'
import {loadBrowserConfig} from '../../../commands/commands-lib/get-extension-config'

interface FirefoxProfileOptions {
  browser: DevOptions['browser']
  userProfilePath: string | undefined
  configPreferences: BrowserConfig['preferences']
  keepProfileChanges?: boolean
  copyFromProfile?: string
}

function configureProfile(
  compilation: Compilation,
  profile: FirefoxProfile,
  customPreferences: Record<string, any>
) {
  const firefoxMasterPreferences: Record<string, any> = {
    ...getPreferences(customPreferences)
  }

  const allPreferences = mergePreferences(
    firefoxMasterPreferences,
    {},
    customPreferences
  )

  applyPreferences(profile, allPreferences)

  // Apply custom preferences last (highest priority)
  if (Object.keys(customPreferences).length > 0) {
    console.log(
      `🔧 Setting custom Firefox preferences: ${JSON.stringify(customPreferences, null, 2)}`
    )
    applyPreferences(profile, customPreferences)
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
  createProfileDirectory(browser, destinationDirectory, (tempPath) => {
    // Create temporary profile
    const profile = new FirefoxProfile({destinationDirectory: tempPath})
    configureProfile(compilation, profile, customPreferences)
  })
}

export function createProfile(
  compilation: Compilation,
  {browser, userProfilePath, configPreferences = {}}: FirefoxProfileOptions
): FirefoxProfile {
  // For now, use the existing simple profile creation
  // TODO: Integrate the advanced FirefoxProfileManager when the linter issues are resolved
  let profile: FirefoxProfile

  // Use the main output directory for profiles, not the browser-specific one
  // The compilation.options.output.path is browser-specific (e.g., dist/firefox)
  // We need the main output directory (e.g., dist)
  const browserSpecificOutputPath =
    compilation.options.output?.path || process.cwd() + '/dist'
  // Go up one level from dist/firefox to dist
  const mainOutputPath = path.dirname(browserSpecificOutputPath)
  const defaultProfilePath = getDefaultProfilePath(mainOutputPath, browser)

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
  createProfileDir(compilation, defaultProfilePath, configPreferences, browser)

  // Return the profile after creation
  profile = new FirefoxProfile({destinationDirectory: defaultProfilePath})
  return configureProfile(compilation, profile, configPreferences)
}
