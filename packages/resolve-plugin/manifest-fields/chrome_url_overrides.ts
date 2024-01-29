import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function chromeUrlOverrides(
  manifestPath: string,
  manifest: ManifestData
) {
  if (!manifest || !manifest.chrome_url_overrides) {
    return undefined
  }

  if (manifest.chrome_url_overrides.history) {
    const historyPage = manifest.chrome_url_overrides.history

    const historyPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      historyPage
    )

    return historyPageAbsolutePath
  }

  if (manifest.chrome_url_overrides.newtab) {
    const newtabPage = manifest.chrome_url_overrides.newtab

    const newtabPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      newtabPage
    )

    return newtabPageAbsolutePath
  }

  if (manifest.chrome_url_overrides.bookmarks) {
    const bookmarksPage = manifest.chrome_url_overrides.bookmarks

    const bookmarksPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      bookmarksPage
    )

    return bookmarksPageAbsolutePath
  }

  return undefined
}
