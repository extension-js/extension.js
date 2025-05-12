import * as path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)

export function theme(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.theme && {
      theme: {
        ...manifest.theme,
        ...(manifest.theme.images && {
          images: {
            ...manifest.theme.images,
            theme_frame: getFilename(
              `theme/images/${getBasename(
                manifest.theme.images.theme_frame as string
              )}`,
              manifest.theme.images.theme_frame as string,
              excludeList
            )
          }
        })
      }
    }
  )
}
