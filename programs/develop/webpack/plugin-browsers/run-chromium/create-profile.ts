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
  createProfileDirectory,
  isChromiumProfileLocked
} from '../browsers-lib/shared-utils'
import * as os from 'os'
import {BrowserConfig, DevOptions} from '../../../develop-lib/config-types'

interface CreateProfile {
  browser: DevOptions['browser']
  userProfilePath: string | false | undefined
  configPreferences: BrowserConfig['preferences']
  instanceId?: string
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
  {browser, userProfilePath, configPreferences = {}, instanceId}: CreateProfile
): string {
  // Normalize and guard against string "false" or empty values coming from config/CLI
  let requestedProfile: string | false | undefined = userProfilePath
  if (typeof requestedProfile === 'string') {
    const trimmed = requestedProfile.trim()
    if (
      trimmed.length === 0 ||
      /^(false|null|undefined|off|0)$/i.test(trimmed)
    ) {
      requestedProfile = false
    } else {
      requestedProfile = trimmed
    }
  }

  // If explicitly disabled, indicate no custom profile path
  if (requestedProfile === false) {
    return ''
  }
  // If user provided a profile path, validate and use it
  if (requestedProfile) {
    const absoluteUserPath = path.resolve(requestedProfile)
    validateProfilePath(browser, absoluteUserPath)
    return absoluteUserPath
  }

  // Use the main output directory for profiles, not the browser-specific one
  // The compilation.options.output.path is browser-specific (e.g., dist/chrome)
  // We need the main output directory (e.g., dist)
  const browserSpecificOutputPath =
    compilation.options.output?.path || process.cwd() + '/dist'
  const mainOutputPath = path.dirname(browserSpecificOutputPath) // Go up one level
  const defaultProfilePath = getDefaultProfilePath(mainOutputPath, browser)
  const shortId = instanceId ? String(instanceId).slice(0, 8) : undefined
  const instanceAwareProfilePath = shortId
    ? path.join(defaultProfilePath, shortId)
    : defaultProfilePath

  // Create and validate default profile path
  validateProfilePath(browser, instanceAwareProfilePath)

  // Resolve Preferences target path for subsequent checks/writes
  const preferencesPath = path.join(
    instanceAwareProfilePath,
    'Default',
    'Preferences'
  )

  // If the profile directory already exists, seed Preferences only if missing
  // and the profile is not locked. Never overwrite an existing Preferences file.
  try {
    if (fs.existsSync(instanceAwareProfilePath)) {
      if (!fs.existsSync(preferencesPath)) {
        if (!isChromiumProfileLocked(instanceAwareProfilePath)) {
          const basePrefs =
            browser === 'chrome'
              ? chromeMasterPreferences
              : edgeMasterPreferences
          const mergedPrefs = {...basePrefs, ...configPreferences}
          try {
            fs.mkdirSync(path.dirname(preferencesPath), {recursive: true})
          } catch {}
          fs.writeFileSync(preferencesPath, JSON.stringify(mergedPrefs), 'utf8')
        }
      }
      return instanceAwareProfilePath
    }
  } catch {}

  // Create new profile with preferences
  const preferences =
    browser === 'chrome' ? chromeMasterPreferences : edgeMasterPreferences
  const userProfile = {...preferences, ...configPreferences}

  // Targeted retry/backoff on transient filesystem locks
  const maxAttempts = 5
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      addProgressBar(messages.creatingUserProfile(browser), () => {
        createNewProfile(browser, instanceAwareProfilePath, userProfile)
      })
      return instanceAwareProfilePath
    } catch (err: any) {
      const code = err?.code || ''
      const msg = String(err?.message || '')
      const isTransient =
        code === 'EACCES' ||
        code === 'ENOTEMPTY' ||
        code === 'EBUSY' ||
        msg.includes('Directory not empty')

      if (!isTransient || attempt === maxAttempts) {
        throw err
      }

      // Purge destination and backoff before retry
      try {
        if (fs.existsSync(instanceAwareProfilePath)) {
          fs.rmSync(instanceAwareProfilePath, {recursive: true, force: true})
        }
      } catch {}
      const backoffMs = 100 * attempt
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, backoffMs)
    }
  }
  return instanceAwareProfilePath
}
