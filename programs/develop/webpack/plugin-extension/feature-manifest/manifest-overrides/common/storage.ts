import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../manifest-lib/paths'

export function storage(manifest: Manifest) {
  return (
    manifest.storage && {
      storage: {
        ...(manifest.storage.managed_schema && {
          managed_schema: getFilename(
            'storage/managed_schema.json',
            manifest.storage.managed_schema
          )
        })
      }
    }
  )
}
