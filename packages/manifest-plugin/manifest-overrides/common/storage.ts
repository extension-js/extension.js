import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function storage(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.storage && {
      storage: {
        ...(manifest.storage.managed_schema && {
          managed_schema: getFilename(
            'storage',
            manifest.storage.managed_schema,
            exclude
          )
        })
      }
    }
  )
}
