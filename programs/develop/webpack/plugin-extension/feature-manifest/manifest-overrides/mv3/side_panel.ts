import {type Manifest} from '../../../../types'
import {getFilename} from '../../../../lib/utils'

export function sidePanel(manifest: Manifest, exclude: string[]) {
  return (
    manifest.side_panel && {
      side_panel: {
        ...(manifest.side_panel.default_path && {
          default_path: getFilename(
            'side_panel/default_path.html',
            manifest.side_panel.default_path as string,
            exclude
          )
        })
      }
    }
  )
}
