import * as path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)

export function icons(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          return [
            size,
            getFilename(`icons/${getBasename(icon)}`, icon, excludeList)
          ]
        })
      )
    }
  )
}
