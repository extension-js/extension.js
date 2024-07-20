import path from 'path'
import fs from 'fs'
import {bold} from '@colors/colors/safe'
import {addProgressBar} from '../browser-lib/add-progress-bar'
import {
  chromeMasterPreferences,
  edgeMasterPreferences
} from './master-preferences'

export function createProfile(
  browser: string,
  profilePath?: string,
  silent?: boolean
) {
  if (
    profilePath ||
    fs.existsSync(path.resolve(__dirname, `run-${browser}-profile`))
  ) {
    return profilePath || path.resolve(__dirname, `run-${browser}-profile`)
  }

  const preferences =
    browser === 'chrome' ? chromeMasterPreferences : edgeMasterPreferences

  const userProfile = JSON.stringify(preferences)
  const capitalBrowsername = browser.charAt(0).toUpperCase() + browser.slice(1)

  if (!silent) {
    addProgressBar(
      `👤 Creating ${bold(capitalBrowsername)} user data directory...`,
      () => {
        const profilePath = path.resolve(__dirname, `run-${browser}-profile`)
        const preferences = path.join(profilePath, 'Default')

        // Ensure directory exists
        fs.mkdirSync(preferences, {recursive: true})

        const preferencesPath = path.join(preferences, 'Preferences')

        // Actually write the user preferences
        fs.writeFileSync(preferencesPath, userProfile, 'utf8')
      }
    )
  }

  return path.resolve(__dirname, `run-${browser}-profile`)
}
