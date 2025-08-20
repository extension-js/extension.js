import {type Manifest} from '../../../../webpack-types'

export function permissions(manifest: Manifest) {
  return (
    manifest.permissions && {
      permissions: manifest.permissions
    }
  )
}
