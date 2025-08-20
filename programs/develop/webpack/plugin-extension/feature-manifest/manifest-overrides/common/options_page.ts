import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/utils'

export function optionsPage(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.options_page && {
      options_page: getFilename(
        'options_ui/page.html',
        manifest.options_page,
        excludeList
      )
    }
  )
}
