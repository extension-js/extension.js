import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/paths'

export function storage(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.storage && {
      storage: {
        ...(manifest.storage.managed_schema && {
          managed_schema: getFilename(
            'storage/managed_schema.json',
            manifest.storage.managed_schema,
            excludeList
          )
        })
      }
    }
  )
}
