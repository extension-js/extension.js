import * as path from 'path'
import * as fs from 'fs'
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

export function createProfile(
  browser: DevOptions['browser'],
  userProfilePath: string | undefined,
  configPreferences: BrowserConfig['preferences'] = {}
) {
  if (userProfilePath && fs.existsSync(userProfilePath)) {
    return userProfilePath
  }

  const defaultProfilePath = path.resolve(__dirname, `run-${browser}-profile`)

  if (!userProfilePath && fs.existsSync(defaultProfilePath)) {
    return path.resolve(__dirname, `run-${browser}-profile`)
  }

  const preferences =
    browser === 'chrome' ? chromeMasterPreferences : edgeMasterPreferences

  const userProfile = JSON.stringify({...preferences, ...configPreferences})

  addProgressBar(messages.creatingUserProfile(browser), () => {
    const profilePath = userProfilePath || defaultProfilePath
    const preferences = path.join(profilePath, 'Default')

    // Ensure directory exists
    fs.mkdirSync(preferences, {recursive: true})

    const preferencesPath = path.join(preferences, 'Preferences')

    // Actually write the user preferences
    fs.writeFileSync(preferencesPath, userProfile, 'utf8')
  })

  return path.resolve(__dirname, `run-${browser}-profile`)
}
