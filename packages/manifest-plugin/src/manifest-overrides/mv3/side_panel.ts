import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function sidePanel(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.side_panel && {
      side_panel: {
        ...(manifest.side_panel.default_path && {
          default_path: getFilename(
            'side_panel',
            manifest.side_panel.default_path,
            exclude
          )
        })
      }
    }
  )
}
