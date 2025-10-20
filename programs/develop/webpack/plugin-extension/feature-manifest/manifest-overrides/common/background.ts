import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../../develop-lib/utils'

export function backgroundPage(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.background &&
    manifest.background.page && {
      background: {
        ...manifest.background,
        ...(manifest.background.page && {
          page: getFilename(
            'background/index.html',
            manifest.background.page as string,
            excludeList
          )
        })
      }
    }
  )
}
