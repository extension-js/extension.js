import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function chromeUrlOverrides(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.chrome_url_overrides && {
      chrome_url_overrides: {
        ...(manifest.chrome_url_overrides.bookmarks && {
          bookmarks: getFilename(
            'chrome_url_overrides',
            manifest.chrome_url_overrides.bookmarks,
            exclude
          )
        }),
        ...(manifest.chrome_url_overrides.history && {
          history: getFilename(
            'chrome_url_overrides',
            manifest.chrome_url_overrides.history,
            exclude
          )
        }),
        ...(manifest.chrome_url_overrides.newtab && {
          newtab: getFilename(
            'chrome_url_overrides',
            manifest.chrome_url_overrides.newtab,
            exclude
          )
        })
      }
    }
  )
}
