import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type ManifestData} from '../../types'

export default function chromeUrlOverrides(
  manifestPath: string,
  manifest: ManifestData
) {
  let chromeUrlOverride: Record<string, any> = {newtab: undefined}

  if (!manifest || !manifest.chrome_url_overrides) {
    return undefined
  }

  if (manifest.chrome_url_overrides.history) {
    const historyPage = manifest.chrome_url_overrides.history

    const historyPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      historyPage
    )

    chromeUrlOverride = {
      'chrome_url_overrides/history': getHtmlResources(historyPageAbsolutePath)
    }
  }

  if (manifest.chrome_url_overrides.newtab) {
    const newtabPage = manifest.chrome_url_overrides.newtab

    const newtabPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      newtabPage
    )

    chromeUrlOverride = {
      'chrome_url_overrides/newtab': getHtmlResources(newtabPageAbsolutePath)
    }
  }

  if (manifest.chrome_url_overrides.bookmarks) {
    const bookmarksPage = manifest.chrome_url_overrides.bookmarks

    const bookmarksPageAbsolutePath = path.join(
      path.dirname(manifestPath),
      bookmarksPage
    )

    chromeUrlOverride = {
      'chrome_url_overrides/bookmarks': bookmarksPageAbsolutePath
    }
  }

  return chromeUrlOverride
}
