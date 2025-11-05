import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'

export function chromeUrlOverrides(
  manifest: Manifest,
  excludeList: FilepathList
) {
  return (
    manifest.chrome_url_overrides && {
      chrome_url_overrides: {
        ...(manifest.chrome_url_overrides.bookmarks && {
          bookmarks: getFilename(
            'chrome_url_overrides/bookmarks.html',
            manifest.chrome_url_overrides.bookmarks,
            excludeList
          )
        }),
        ...(manifest.chrome_url_overrides.history && {
          history: getFilename(
            'chrome_url_overrides/history.html',
            manifest.chrome_url_overrides.history,
            excludeList
          )
        }),
        ...(manifest.chrome_url_overrides.newtab && {
          newtab: getFilename(
            'chrome_url_overrides/newtab.html',
            manifest.chrome_url_overrides.newtab,
            excludeList
          )
        })
      }
    }
  )
}
