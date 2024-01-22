import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function getAction(manifest: ManifestData, exclude: string[]) {
  return (
    manifest.action && {
      action: {
        ...manifest.action,
        ...(manifest.action.default_popup && {
          default_popup: getFilename(
            'action',
            manifest.action.default_popup,
            exclude
          )
        }),

        ...(manifest.action.default_icon && {
          default_icon:
            typeof manifest.action.default_icon === 'string'
              ? getFilename('action', manifest.action.default_icon, exclude)
              : Object.fromEntries(
                  Object.entries(manifest.action.default_icon).map(
                    ([size, icon]) => {
                      return [
                        size,
                        getFilename('action', icon as string, exclude)
                      ]
                    }
                  )
                )
        })
      }
    }
  )
}
