import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function action(
  manifestPath: string,
  manifest: Manifest
): ManifestHtmlData | undefined {
  if (!manifest || !manifest.action || !manifest.action.default_popup) {
    return undefined
  }

  const actionPage = manifest.action.default_popup

  const actionPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    actionPage
  )

  return getHtmlResources(actionPageAbsolutePath)
}
