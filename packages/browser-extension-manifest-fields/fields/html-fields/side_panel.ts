import path from 'path'
import getHtmlResources from '../../helpers/getHtmlFileResources'
import {type Manifest, type ManifestHtmlData} from '../../types'

export default function sidePanel(
  manifestPath: string,
  manifest: Manifest
): ManifestHtmlData | undefined {
  if (!manifest || !manifest.side_panel || !manifest.side_panel.default_path) {
    return undefined
  }

  const sidePanelPage: string = manifest.side_panel.default_path

  const sidepanelPageAbsolutePath = path.join(
    path.dirname(manifestPath),
    sidePanelPage
  )

  return getHtmlResources(sidepanelPageAbsolutePath)
}
