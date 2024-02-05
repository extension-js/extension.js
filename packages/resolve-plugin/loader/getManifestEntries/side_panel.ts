import * as path from '../../helpers/pathUtils.js'

import {type ManifestData} from './types.js'

export default function sidePanel(manifest: ManifestData) {
  if (!manifest || !manifest.side_panel || !manifest.side_panel.default_path) {
    return undefined
  }

  const sidePanelPage = manifest.side_panel.default_path

  const sidepanelPageAbsolutePath = sidePanelPage

  return sidepanelPageAbsolutePath
}
