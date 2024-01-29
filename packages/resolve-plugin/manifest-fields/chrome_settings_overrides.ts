import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function chromeSettingsOverrides(
  manifestPath: string,
  manifest: ManifestData
) {
  if (
    !manifest ||
    !manifest.chrome_settings_overrides ||
    !manifest.chrome_settings_overrides.homepage ||
    // Do nothing if homepage is a URL
    manifest.chrome_settings_overrides.homepage.startsWith('http')
  ) {
    return undefined
  }

  const settingsPage = manifest.chrome_settings_overrides.homepage

  const settingsPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    settingsPage
  )

  return settingsPageAbsolutePath
}
