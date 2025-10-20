import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../../develop-lib/utils'

export function optionsUi(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.options_ui && {
      options_ui: {
        ...manifest.options_ui,
        ...(manifest.options_ui.page && {
          page: getFilename(
            'options/index.html',
            manifest.options_ui.page,
            excludeList
          )
        })
      }
    }
  )
}
