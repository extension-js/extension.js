import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

export function storage(manifest: Manifest, exclude: string[]) {
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
