import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'

export function chromeUrlOverrides(
  manifest: Manifest,
  _excludeList: FilepathList
) {
  return (
    manifest.chrome_url_overrides && {
      chrome_url_overrides: {
        ...(manifest.chrome_url_overrides.bookmarks && {
          bookmarks: (() => {
            const raw = String(manifest.chrome_url_overrides.bookmarks)
            const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
            const target = isPublic
              ? normalizeManifestOutputPath(raw)
              : 'chrome_url_overrides/bookmarks.html'
            return getFilename(target, raw, {})
          })()
        }),
        ...(manifest.chrome_url_overrides.history && {
          history: (() => {
            const raw = String(manifest.chrome_url_overrides.history)
            const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
            const target = isPublic
              ? normalizeManifestOutputPath(raw)
              : 'chrome_url_overrides/history.html'
            return getFilename(target, raw, {})
          })()
        }),
        ...(manifest.chrome_url_overrides.newtab && {
          newtab: (() => {
            const raw = String(manifest.chrome_url_overrides.newtab)
            const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
            const target = isPublic
              ? normalizeManifestOutputPath(raw)
              : 'chrome_url_overrides/newtab.html'
            return getFilename(target, raw, {})
          })()
        })
      }
    }
  )
}
