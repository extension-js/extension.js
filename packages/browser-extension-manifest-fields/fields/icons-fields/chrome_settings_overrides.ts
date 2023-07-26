import path from 'path'
import {type ManifestData} from '../../types'

export default function chromeSettingsOverrides(
  manifestPath: string,
  manifest: ManifestData
) {
  if (
    !manifest ||
    !manifest.chrome_settings_overrides ||
    !manifest.chrome_settings_overrides.favicon_url
  ) {
    return undefined
  }

  const settingsOverridesFaviconUrlAbsolutePath = path.join(
    path.dirname(manifestPath),
    manifest.chrome_settings_overrides.favicon_url
  )

  return settingsOverridesFaviconUrlAbsolutePath
}
