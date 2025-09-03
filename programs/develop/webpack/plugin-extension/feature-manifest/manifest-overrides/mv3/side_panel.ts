import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/utils'

export function sidePanel(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.side_panel && {
      side_panel: {
        ...manifest.side_panel,
        ...(manifest.side_panel.default_path && {
          default_path: getFilename(
            'sidebar/index.html',
            manifest.side_panel.default_path as string,
            excludeList
          )
        })
      }
    }
  )
}
