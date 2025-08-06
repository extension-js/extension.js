import * as path from 'path'
import * as fs from 'fs'
import {Compilation} from '@rspack/core'
import {
  chromeMasterPreferences,
  edgeMasterPreferences
} from './master-preferences'
import * as messages from '../browsers-lib/messages'
import {addProgressBar} from '../browsers-lib/add-progress-bar'
import {
  validateProfilePath,
  getDefaultProfilePath,
  createProfileDirectory
} from '../browsers-lib/shared-utils'
import {
  BrowserConfig,
  DevOptions
} from '../../commands/commands-lib/config-types'

interface CreateProfile {
  browser: DevOptions['browser']
  userProfilePath: string | undefined
  configPreferences: BrowserConfig['preferences']
}

function createNewProfile(
  browser: DevOptions['browser'],
  profilePath: string,
  preferences: Record<string, any>
): void {
  createProfileDirectory(browser, profilePath, (tempPath) => {
    // Create Default directory
    const defaultDir = path.join(tempPath, 'Default')
    fs.mkdirSync(defaultDir, {recursive: true})

    // Write preferences
    const preferencesPath = path.join(defaultDir, 'Preferences')
    fs.writeFileSync(preferencesPath, JSON.stringify(preferences), 'utf8')
  })
}

export function createProfile(
  compilation: Compilation,
  {browser, userProfilePath, configPreferences = {}}: CreateProfile
): string {
  // If user provided a profile path, validate and use it
  if (userProfilePath) {
    const absoluteUserPath = path.resolve(userProfilePath)
    validateProfilePath(browser, absoluteUserPath)
    return absoluteUserPath
  }

  // Use the main output directory for profiles, not the browser-specific one
  // The compilation.options.output.path is browser-specific (e.g., dist/chrome)
  // We need the main output directory (e.g., dist)
  const browserSpecificOutputPath =
    compilation.options.output?.path || process.cwd() + '/dist'
  const mainOutputPath = path.dirname(browserSpecificOutputPath) // Go up one level from dist/chrome to dist
  const defaultProfilePath = getDefaultProfilePath(mainOutputPath, browser)

  // Create and validate default profile path
  validateProfilePath(browser, defaultProfilePath)

  // If default profile exists and has Default/Preferences, use it
  const preferencesPath = path.join(
    defaultProfilePath,
    'Default',
    'Preferences'
  )

  if (fs.existsSync(preferencesPath)) {
    return defaultProfilePath
  }

  // Create new profile with preferences
  const preferences =
    browser === 'chrome' ? chromeMasterPreferences : edgeMasterPreferences
  const userProfile = {...preferences, ...configPreferences}

  addProgressBar(messages.creatingUserProfile(browser), () => {
    createNewProfile(browser, defaultProfilePath, userProfile)
  })

  return defaultProfilePath
}
