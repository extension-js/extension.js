import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type ManifestData} from '../../types'

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

  return getHtmlResources(backgroundAbsolutePath)
}
