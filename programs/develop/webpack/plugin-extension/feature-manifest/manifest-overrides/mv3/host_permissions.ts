import {type Manifest} from '../../../../webpack-types'

export function hostPermissions(manifest: Manifest) {
  return (
    (manifest as any).host_permissions && {
      host_permissions: (manifest as any).host_permissions
    }
  )
}
