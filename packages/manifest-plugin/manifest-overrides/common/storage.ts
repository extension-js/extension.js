import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

export default function storage(manifest: Manifest, exclude: string[]) {
  return (
    manifest.storage && {
      storage: {
        ...(manifest.storage.managed_schema && {
          managed_schema: getFilename(
            'storage/managed_schema.json',
            manifest.storage.managed_schema,
            exclude
          )
        })
      }
    }
  )
}
