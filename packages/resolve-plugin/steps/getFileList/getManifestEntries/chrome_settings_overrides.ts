import {type ManifestData} from './types.js'

export default function chromeSettingsOverrides(manifest: ManifestData) {
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

  const settingsPageAbsolutePath = settingsPage

  return settingsPageAbsolutePath
}
