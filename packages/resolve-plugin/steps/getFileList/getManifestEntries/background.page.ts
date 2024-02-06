import {type ManifestData} from './types.js'

export default function background(manifest: ManifestData) {
  if (!manifest || !manifest.background || !manifest.background.page) {
    return undefined
  }

  const backgroundPage = manifest.background.page

  const backgroundAbsolutePath = backgroundPage

  return backgroundAbsolutePath
}
