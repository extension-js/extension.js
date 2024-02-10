import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

export default function chromeUrlOverrides(
  manifest: Manifest,
  exclude: string[]
) {
  return (
    manifest.chrome_url_overrides && {
      chrome_url_overrides: {
        ...(manifest.chrome_url_overrides.bookmarks && {
          bookmarks: getFilename(
            'chrome_url_overrides/bookmarks.html',
            manifest.chrome_url_overrides.bookmarks,
            exclude
          )
        }),
        ...(manifest.chrome_url_overrides.history && {
          history: getFilename(
            'chrome_url_overrides/history.html',
            manifest.chrome_url_overrides.history,
            exclude
          )
        }),
        ...(manifest.chrome_url_overrides.newtab && {
          newtab: getFilename(
            'chrome_url_overrides/newtab.html',
            manifest.chrome_url_overrides.newtab,
            exclude
          )
        })
      }
    }
  )
}
