import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function pageAction(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.page_action && {
      page_action: {
        ...manifest.page_action,
        ...(manifest.page_action.default_popup && {
          default_popup: getFilename(
            'page_action',
            manifest.page_action.default_popup,
            exclude
          )
        }),
        ...(manifest.page_action.default_icon && {
          default_icon:
            typeof manifest.page_action.default_icon === 'string'
              ? getFilename(
                  'page_action',
                  manifest.page_action.default_icon,
                  exclude
                )
              : Object.fromEntries(
                  Object.entries(
                    manifest.page_action.default_icon as Record<string, string>
                  ).map(([size, icon]) => {
                    return [size, getFilename('page_action', icon, exclude)]
                  })
                )
        })
      }
    }
  )
}
