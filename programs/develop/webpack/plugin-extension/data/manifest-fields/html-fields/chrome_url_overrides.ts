import path from 'path'

import {type Manifest} from '../../../../webpack-types'

export function chromeUrlOverrides(
  context: string,

  manifest: Manifest
): Record<string, Manifest | undefined> {
  let chromeUrlOverride: Record<string, any> = {newtab: undefined}

  if (!manifest || !manifest.chrome_url_overrides) {
    return {'chrome_url_overrides/newtab': undefined}
  }

  if (manifest.chrome_url_overrides.history) {
    const historyPage: string = manifest.chrome_url_overrides.history

    chromeUrlOverride = {
      'chrome_url_overrides/history': path.join(context, historyPage)
    }
  }

  if (manifest.chrome_url_overrides.newtab) {
    const newtabPage = manifest.chrome_url_overrides.newtab

    chromeUrlOverride = {
      'chrome_url_overrides/newtab': path.join(context, newtabPage)
    }
  }

  if (manifest.chrome_url_overrides.bookmarks) {
    const bookmarksPage = manifest.chrome_url_overrides.bookmarks

    chromeUrlOverride = {
      'chrome_url_overrides/bookmarks': path.join(context, bookmarksPage)
    }
  }

  return chromeUrlOverride
}
