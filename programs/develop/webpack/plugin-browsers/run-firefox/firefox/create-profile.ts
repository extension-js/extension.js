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
import {BrowserConfig, DevOptions} from '../../../../develop-lib/config-types'
import {loadBrowserConfig} from '../../../../develop-lib/get-extension-config'

interface FirefoxProfileOptions {
  browser: DevOptions['browser']
  userProfilePath: string | false | undefined
  configPreferences: BrowserConfig['preferences']
  keepProfileChanges?: boolean
  copyFromProfile?: string
  instanceId?: string // Add instanceId for unique profiles
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
  {
    browser,
    userProfilePath,
    configPreferences = {},
    instanceId
  }: FirefoxProfileOptions
): FirefoxProfile {
  // For now, use the existing simple profile creation
  // TODO: Integrate the advanced FirefoxProfileManager when the linter issues are resolved
  let profile: FirefoxProfile

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

  // If explicitly disabled, do not create or use a managed profile
  if (requestedProfile === false) {
    // Return a minimal object with path() => '' so callers can detect disabled state
    return {path: () => ''} as unknown as FirefoxProfile
  }

  // Use the main output directory for profiles, not the browser-specific one
  // The compilation.options.output.path is browser-specific (e.g., dist/firefox)
  // We need the main output directory (e.g., dist)
  const browserSpecificOutputPath =
    compilation.options.output?.path || process.cwd() + '/dist'
  // Go up one level from dist/firefox to dist
  const mainOutputPath = path.dirname(browserSpecificOutputPath)

  // Use the same base layout as Chromium: dist/extension-js/profiles/<browser>-profile
  // This ensures parity across browsers and predictable cleanup paths.
  const defaultProfilePath: string = getDefaultProfilePath(
    mainOutputPath,
    browser
  )
  const shortId = instanceId ? String(instanceId).slice(0, 8) : undefined
  const instanceAwareProfilePath = shortId
    ? path.join(defaultProfilePath, shortId)
    : defaultProfilePath

  // If user provided a profile path, validate and use it
  if (requestedProfile) {
    const absoluteUserPath = path.resolve(requestedProfile)
    validateProfilePath(browser, absoluteUserPath)
    profile = new FirefoxProfile({destinationDirectory: absoluteUserPath})
    return configureProfile(compilation, profile, configPreferences)
  }

  // Create and validate default profile path
  validateProfilePath(browser, instanceAwareProfilePath)

  // If default profile exists and has prefs.js, use it
  const prefsPath = path.join(instanceAwareProfilePath, 'prefs.js')
  if (fs.existsSync(prefsPath)) {
    profile = new FirefoxProfile({
      destinationDirectory: instanceAwareProfilePath
    })
    return configureProfile(compilation, profile, configPreferences)
  }

  // Create new profile
  addProgressBar(messages.creatingUserProfile(browser), () => {})
  // Backoff if a previous Firefox left a lock (parity with Chromium retry/backoff)
  try {
    const lockPath = path.join(instanceAwareProfilePath, 'parent.lock')
    for (let i = 0; i < 5; i++) {
      if (!fs.existsSync(lockPath)) break
      Atomics.wait(
        new Int32Array(new SharedArrayBuffer(4)),
        0,
        0,
        100 * (i + 1)
      )
    }
  } catch {}
  createProfileDir(
    compilation,
    instanceAwareProfilePath,
    configPreferences,
    browser
  )

  // Return the profile after creation
  profile = new FirefoxProfile({destinationDirectory: instanceAwareProfilePath})
  return configureProfile(compilation, profile, configPreferences)
}
