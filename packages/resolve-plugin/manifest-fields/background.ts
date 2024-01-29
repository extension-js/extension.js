import path from 'path'
import {type ManifestData} from '../resolver-module/types'

export default function background(
  manifestPath: string,
  manifest: ManifestData
) {
  if (!manifest || !manifest.background || !manifest.background.page) {
    return undefined
  }

  const backgroundPage = manifest.background.page

  const backgroundAbsolutePath = path.join(
    path.dirname(manifestPath),
    backgroundPage
  )

  return backgroundAbsolutePath
}
