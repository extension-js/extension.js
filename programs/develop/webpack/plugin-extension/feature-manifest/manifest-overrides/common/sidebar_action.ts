import * as path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../webpack-lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)
export function sidebarAction(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.sidebar_action && {
      sidebar_action: {
        ...manifest.sidebar_action,
        ...(manifest.sidebar_action.default_panel && {
          default_panel: getFilename(
            `sidebar_action/default_panel.html`,
            manifest.sidebar_action.default_panel as string,
            excludeList
          )
        }),

        ...(manifest.sidebar_action.default_icon && {
          default_icon:
            typeof manifest.sidebar_action.default_icon === 'string'
              ? getFilename(
                  `icons/${getBasename(
                    manifest.sidebar_action.default_icon as string
                  )}`,
                  manifest.sidebar_action.default_icon as string,
                  excludeList
                )
              : Object.fromEntries(
                  Object.entries(
                    manifest.sidebar_action.default_icon as Record<
                      string,
                      string
                    >
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
