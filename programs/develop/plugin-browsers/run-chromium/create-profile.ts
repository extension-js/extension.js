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
  BrowserConfig,
  DevOptions
} from '../../commands/commands-lib/config-types'

interface CreateProfile {
  browser: DevOptions['browser']
  userProfilePath: string | undefined
  configPreferences: BrowserConfig['preferences']
}

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

function createNewProfile(
  browser: DevOptions['browser'],
  profilePath: string,
  preferences: Record<string, any>
): void {
  const tempPath = `${profilePath}.tmp`

  try {
    // Create temporary directory
    fs.mkdirSync(tempPath, {recursive: true})

    // Create Default directory
    const defaultDir = path.join(tempPath, 'Default')
    fs.mkdirSync(defaultDir, {recursive: true})

    // Write preferences
    const preferencesPath = path.join(defaultDir, 'Preferences')
    fs.writeFileSync(preferencesPath, JSON.stringify(preferences), 'utf8')

    // Atomic rename
    fs.renameSync(tempPath, profilePath)
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
  {browser, userProfilePath, configPreferences = {}}: CreateProfile
): string {
  // If user provided a profile path, validate and use it
  if (userProfilePath) {
    const absoluteUserPath = path.resolve(userProfilePath)
    validateProfilePath(browser, absoluteUserPath)
    return absoluteUserPath
  }

  // Use consistent path structure in output directory
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
