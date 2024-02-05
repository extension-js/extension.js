import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function icons(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.icons && {
      icons: Object.fromEntries(
        Object.entries(manifest.icons).map(([size, icon]) => {
          return [size, getFilename('icons', icon as string, exclude)]
        })
      )
    }
  )
}
