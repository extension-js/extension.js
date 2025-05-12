import * as path from 'path'
import {type Manifest, type FilepathList} from '../../../../webpack-types'
import {getFilename} from '../../../../lib/utils'

const getBasename = (filepath: string) => path.basename(filepath)
export function browserAction(manifest: Manifest, excludeList: FilepathList) {
  return (
    manifest.browser_action && {
      browser_action: {
        ...manifest.browser_action,
        ...(manifest.browser_action.default_popup && {
          default_popup: getFilename(
            'browser_action/default_popup.html',
            manifest.browser_action.default_popup as string,
            excludeList
          )
        }),
        ...(manifest.browser_action.default_icon && {
          default_icon:
            typeof manifest.browser_action.default_icon === 'string'
              ? getFilename(
                  `icons/${getBasename(
                    manifest.browser_action.default_icon as string
                  )}`,
                  manifest.browser_action.default_icon as string,
                  excludeList
                )
              : Object.fromEntries(
                  Object.entries(
                    manifest.browser_action.default_icon as string
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
        }),
        ...(manifest.browser_action.theme_icons && {
          theme_icons: manifest.browser_action.theme_icons.map(
            (themeIcon: {light: string; dark: string}) => {
              return {
                ...themeIcon,
                ...(themeIcon.light && {
                  light: getFilename(
                    `browser_action/${getBasename(themeIcon.light)}`,
                    themeIcon.light,
                    excludeList
                  )
                }),
                ...(themeIcon.dark && {
                  dark: getFilename(
                    `browser_action/${getBasename(themeIcon.dark)}`,
                    themeIcon.dark,
                    excludeList
                  )
                })
              }
            }
          )
        })
      }
    }
  )
}
