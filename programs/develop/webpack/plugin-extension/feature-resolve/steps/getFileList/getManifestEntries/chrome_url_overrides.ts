import {type ManifestData} from './types.js'

export function chromeUrlOverrides(manifest: ManifestData) {
  let chromeUrlOverride: Record<string, any> = {newtab: undefined}

  if (!manifest || !manifest.chrome_url_overrides) {
    return {'chrome_url_overrides/newtab.html': undefined}
  }

  if (manifest.chrome_url_overrides.history) {
    chromeUrlOverride = {
      'chrome_url_overrides/history.html': manifest.chrome_url_overrides.history
    }
  }

  if (manifest.chrome_url_overrides.newtab) {
    chromeUrlOverride = {
      'chrome_url_overrides/newtab.html': manifest.chrome_url_overrides.newtab
    }
  }

  if (manifest.chrome_url_overrides.bookmarks) {
    chromeUrlOverride = {
      'chrome_url_overrides/bookmarks.html':
        manifest.chrome_url_overrides.bookmarks
    }
  }

  return chromeUrlOverride
}
