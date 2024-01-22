import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function chromeSettingsOverrides(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.chrome_settings_overrides && {
      chrome_settings_overrides: {
        ...manifest.chrome_settings_overrides,
        ...(manifest.chrome_settings_overrides.favicon_url && {
          favicon_url: getFilename(
            'chrome_settings_overrides',
            manifest.chrome_settings_overrides.favicon_url,
            exclude
          )
        })
      }
    }
  )
}
