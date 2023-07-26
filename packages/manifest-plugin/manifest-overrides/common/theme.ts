import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function theme(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.theme && {
      theme: {
        ...manifest.theme,
        ...(manifest.theme.images && {
          images: {
            ...manifest.theme.images,
            theme_frame: getFilename(
              'theme',
              manifest.theme.images.theme_frame,
              exclude
            )
          }
        })
      }
    }
  )
}
