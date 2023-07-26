import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type ManifestData} from '../../types'

export default function action(manifestPath: string, manifest: ManifestData) {
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
