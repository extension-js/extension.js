import path from 'path'
import fs from 'fs'
import {
  chromeMasterPreferences,
  edgeMasterPreferences
} from './master-preferences'
import * as messages from '../browsers-lib/messages'
import {addProgressBar} from '../browsers-lib/add-progress-bar'
import {DevOptions} from '../../commands/dev'

export function createProfile(
  browser: DevOptions['browser'],
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

  if (!silent) {
    addProgressBar(messages.creatingUserProfile(browser), () => {
      const profilePath = path.resolve(__dirname, `run-${browser}-profile`)
      const preferences = path.join(profilePath, 'Default')

      // Ensure directory exists
      fs.mkdirSync(preferences, {recursive: true})

      const preferencesPath = path.join(preferences, 'Preferences')

      // Actually write the user preferences
      fs.writeFileSync(preferencesPath, userProfile, 'utf8')
    })
  }

  return path.resolve(__dirname, `run-${browser}-profile`)
}
