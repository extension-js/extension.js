import path from 'path'
import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

const getBasename = (filepath: string) => path.basename(filepath)

export default function theme(manifest: Manifest, exclude: string[]) {
  return (
    manifest.theme && {
      theme: {
        ...manifest.theme,
        ...(manifest.theme.images && {
          images: {
            ...manifest.theme.images,
            theme_frame: getFilename(
              `theme/images/${getBasename(manifest.theme.images.theme_frame)}`,
              manifest.theme.images.theme_frame,
              exclude
            )
          }
        })
      }
    }
  )
}
