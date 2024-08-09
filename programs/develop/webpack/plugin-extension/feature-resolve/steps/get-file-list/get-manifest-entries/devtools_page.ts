import {type ManifestData} from './types.js'

export function devtoolsPage(manifest: ManifestData) {
  if (!manifest || !manifest.devtools_page) {
    return undefined
  }

  const devtoolsPage = manifest.devtools_page

  const devtoolsAbsolutePath = devtoolsPage

  return devtoolsAbsolutePath
}
