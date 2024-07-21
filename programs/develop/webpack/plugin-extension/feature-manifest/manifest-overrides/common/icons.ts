import path from 'path'
import {type Manifest} from '../../../../types'
import {getFilename} from '../../../../lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)

export function icons(manifest: Manifest, exclude: string[]) {
  return (
    manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          return [
            size,
            getFilename(`icons/${getBasename(icon)}`, icon, exclude)
          ]
        })
      )
    }
  )
}
