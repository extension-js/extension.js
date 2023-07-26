import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type ManifestData} from '../../types'

export default function sidePanel(
  manifestPath: string,
  manifest: ManifestData
) {
  if (!manifest || !manifest.side_panel || !manifest.side_panel.default_path) {
    return undefined
  }

  const sidePanelPage = manifest.side_panel.default_path

  const sidepanelPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    sidePanelPage
  )

  return getHtmlResources(sidepanelPageAbsolutePath)
}
