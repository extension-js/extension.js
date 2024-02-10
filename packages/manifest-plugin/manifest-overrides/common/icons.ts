import path from 'path'
import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

const getBasename = (filepath: string) => path.basename(filepath)

export default function icons(manifest: Manifest, exclude: string[]) {
  return (
    manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          return [
            size,
            getFilename(
              `icons/${getBasename(icon as string)}`,
              icon as string,
              exclude
            )
          ]
        })
      )
    }
  )
}
