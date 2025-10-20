import * as path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../../develop-lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)

export function theme(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.theme && {
      theme: {
        ...manifest.theme,
        ...(manifest.theme.images && {
          images: Object.fromEntries(
            Object.entries(manifest.theme.images as Record<string, string>).map(
              ([key, value]) => [
                key,
                getFilename(
                  `theme/images/${getBasename(value)}`,
                  value,
                  excludeList
                )
              ]
            )
          )
        })
      }
    }
  )
}
