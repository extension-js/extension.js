import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function getBackground(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.background &&
    manifest.background.page && {
      background: {
        ...manifest.background,
        ...(manifest.background.page && {
          page: getFilename('background', manifest.background.page, exclude)
        })
      }
    }
  )
}
