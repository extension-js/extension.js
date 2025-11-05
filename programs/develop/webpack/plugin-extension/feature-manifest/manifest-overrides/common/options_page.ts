import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'

export function optionsPage(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.options_page && {
      options_page: getFilename(
        'options/index.html',
        manifest.options_page,
        excludeList
      )
    }
  )
}
