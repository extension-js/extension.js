import path from 'path'
import {type Manifest} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)
export function sidebarAction(manifest: Manifest, exclude: string[]) {
  return (
    manifest.sidebar_action && {
      sidebar_action: {
        ...manifest.sidebar_action,
        ...(manifest.sidebar_action.default_panel && {
          default_panel: getFilename(
            `sidebar_action/default_panel.html`,
            manifest.sidebar_action.default_panel as string,
            exclude
          )
        }),

        ...(manifest.sidebar_action.default_icon && {
          default_icon: getFilename(
            `icons/${getBasename(
              manifest.sidebar_action.default_icon as string
            )}`,
            manifest.sidebar_action.default_icon as string,
            exclude
          )
        })
      }
    }
  )
}
