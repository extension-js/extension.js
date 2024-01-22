import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function background(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.background &&
    manifest.background.scripts && {
      background: {
        ...manifest.background,
        ...(manifest.background.scripts && {
          scripts: manifest.background.scripts.map((script: string) => {
            return getFilename('background', script, exclude)
          })
        })
      }
    }
  )
}
