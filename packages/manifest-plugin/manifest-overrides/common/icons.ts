import path from 'path'
import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'
import utils from '../../helpers/utils'

const getBasename = (filepath: string) => path.basename(filepath)

export default function icons(manifest: Manifest, exclude: string[]) {
  return (
    manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          const outputpath = utils.unixify(getFilename(`icons/${getBasename(icon)}`, icon, exclude));
          return [
            size,
            outputpath
          ]
        })
      )
    }
  )
}
