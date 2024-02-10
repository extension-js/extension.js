import path from 'path'
import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

const getBasename = (filepath: string) => path.basename(filepath)
export default function getAction(manifest: Manifest, exclude: string[]) {
  return (
    manifest.action && {
      action: {
        ...manifest.action,
        ...(manifest.action.default_popup && {
          default_popup: getFilename(
            `action/default_popup.html`,
            manifest.action.default_popup,
            exclude
          )
        }),

        ...(manifest.action.default_icon && {
          default_icon:
            typeof manifest.action.default_icon === 'string'
              ? getFilename(
                  `action/${getBasename(manifest.action.default_icon)}`,
                  manifest.action.default_icon,
                  exclude
                )
              : Object.fromEntries(
                  Object.entries(manifest.action.default_icon).map(
                    ([size, icon]) => {
                      return [
                        size,
                        getFilename(
                          `action/${getBasename(icon as string)}`,
                          icon as string,
                          exclude
                        )
                      ]
                    }
                  )
                )
        })
      }
    }
  )
}
