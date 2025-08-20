import {Compilation} from '@rspack/core'
import {createProfile} from './create-profile'
import {
  type DevOptions,
  type BrowserConfig
} from '../../../../develop-lib/config-types'

export async function browserConfig(
  compilation: Compilation,
  configOptions: DevOptions &
    BrowserConfig & {
      keepProfileChanges?: boolean
      copyFromProfile?: string
      instanceId?: string // Add instanceId for unique profiles
    }
) {
  const {
    browser,
    startingUrl,
    preferences,
    profile,
    browserFlags = [],
    keepProfileChanges,
    copyFromProfile,
    instanceId
  } = configOptions

  const userProfilePath = createProfile(compilation, {
    browser,
    userProfilePath: profile,
    configPreferences: preferences,
    keepProfileChanges,
    copyFromProfile,
    instanceId
  })
  const binaryArgs: string[] = []

  // Do not open the starting URL at binary launch time.
  // We will navigate to it after the manager extension is installed and connected.

  // Support excludeBrowserFlags parity with Chromium
  const excludeFlags = (configOptions as any).excludeBrowserFlags || []
  const filteredFlags = (browserFlags || []).filter((flag) =>
    excludeFlags.every((ex: string) => !String(flag).startsWith(ex))
  )
  if (filteredFlags.length > 0) {
    binaryArgs.push(...filteredFlags)
  }

  const parts = [`--binary-args="${binaryArgs.join(' ')}"`, '--verbose']
  const profilePath = userProfilePath.path()
  if (profilePath) {
    parts.splice(1, 0, `--profile="${profilePath}"`)
  }
  return parts.join(' ')
}
