import path from 'path'
import {type ManifestData} from '../resolver-module/types'

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

  return sidepanelPageAbsolutePath
}
