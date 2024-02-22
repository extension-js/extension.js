import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function background(
  manifestPath: string,
  manifest: Manifest
): ManifestHtmlData | undefined {
  if (!manifest || !manifest.background || !manifest.background.page) {
    return undefined
  }

  const backgroundPage: string = manifest.background.page

  const backgroundAbsolutePath = path.join(
    path.dirname(manifestPath),
    backgroundPage
  )

  return getHtmlResources(backgroundAbsolutePath)
}
