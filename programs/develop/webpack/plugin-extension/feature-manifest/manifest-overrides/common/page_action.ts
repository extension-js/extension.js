import * as path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)
export function pageAction(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.page_action && {
      page_action: {
        ...manifest.page_action,
        ...(manifest.page_action.default_popup && {
          default_popup: getFilename(
            'page_action/default_popup.html',
            manifest.page_action.default_popup as string,
            excludeList
          )
        }),
        ...(manifest.page_action.default_icon && {
          default_icon:
            typeof manifest.page_action.default_icon === 'string'
              ? getFilename(
                  `icons/${getBasename(
                    manifest.page_action.default_icon as string
                  )}`,
                  manifest.page_action.default_icon as string,
                  excludeList
                )
              : Object.fromEntries(
                  Object.entries(
                    manifest.page_action.default_icon as Record<string, string>
                  ).map(([size, icon]) => {
                    return [
                      size,
                      getFilename(
                        `icons/${getBasename(icon)}`,
                        icon,
                        excludeList
                      )
                    ]
                  })
                )
        })
      }
    }
  )
}
