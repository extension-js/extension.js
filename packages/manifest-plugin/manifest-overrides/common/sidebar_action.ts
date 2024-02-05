import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function sidebarAction(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.sidebar_action && {
      sidebar_action: {
        ...manifest.sidebar_action,

        ...(manifest.sidebar_action.default_panel && {
          default_panel: getFilename(
            'sidebar_action',
            manifest.sidebar_action.default_panel,
            exclude
          )
        }),

        ...(manifest.sidebar_action.default_icon && {
          default_icon: getFilename(
            'sidebar_action',
            manifest.sidebar_action.default_icon,
            exclude
          )
        })
      }
    }
  )
}
