import {type ManifestData} from './types.js'

export default function chromeUrlOverrides(manifest: ManifestData) {
  if (!manifest || !manifest.chrome_url_overrides) {
    return undefined
  }

  if (manifest.chrome_url_overrides.history) {
    const historyPage = manifest.chrome_url_overrides.history

    const historyPageAbsolutePath = historyPage

    return historyPageAbsolutePath
  }

  if (manifest.chrome_url_overrides.newtab) {
    const newtabPage = manifest.chrome_url_overrides.newtab

    const newtabPageAbsolutePath = newtabPage

    return newtabPageAbsolutePath
  }

  if (manifest.chrome_url_overrides.bookmarks) {
    const bookmarksPage = manifest.chrome_url_overrides.bookmarks

    const bookmarksPageAbsolutePath = bookmarksPage

    return bookmarksPageAbsolutePath
  }

  return undefined
}
