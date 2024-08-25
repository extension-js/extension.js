import path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)
export function action(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.action && {
      action: {
        ...manifest.action,
        ...(manifest.action.default_popup && {
          default_popup: getFilename(
            `action/default_popup.html`,
            manifest.action.default_popup as string,
            excludeList
          )
        }),

        ...(manifest.action.default_icon && {
          default_icon:
            typeof manifest.action.default_icon === 'string'
              ? getFilename(
                  `action/${getBasename(
                    manifest.action.default_icon as string
                  )}`,
                  manifest.action.default_icon as string,
                  excludeList
                )
              : Object.fromEntries(
                  Object.entries(manifest.action.default_icon as string).map(
                    ([size, icon]) => {
                      return [
                        size,
                        getFilename(
                          `action/${getBasename(icon)}`,
                          icon,
                          excludeList
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
