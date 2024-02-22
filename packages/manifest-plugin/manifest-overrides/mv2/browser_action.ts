import path from 'path'
import {type Manifest} from '../../types'
import getFilename from '../../helpers/getFilename'

const getBasename = (filepath: string) => path.basename(filepath)
export default function getBrowserAction(
  manifest: Manifest,
  exclude: string[]
) {
  return (
    manifest.browser_action && {
      browser_action: {
        ...manifest.browser_action,
        ...(manifest.browser_action.default_popup && {
          default_popup: getFilename(
            'browser_action/default_popup.html',
            manifest.browser_action.default_popup as string,
            exclude
          )
        }),
        ...(manifest.browser_action.default_icon && {
          default_icon:
            typeof manifest.browser_action.default_icon === 'string'
              ? getFilename(
                  `browser_action/${getBasename(manifest.browser_action.default_icon as string)}`,
                  manifest.browser_action.default_icon as string,
                  exclude
                )
              : Object.fromEntries(
                  Object.entries(
                    manifest.browser_action.default_icon as string
                  ).map(([size, icon]) => {
                    return [
                      size,
                      getFilename(
                        `browser_action/${getBasename(icon)}`,
                        icon,
                        exclude
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
                    exclude
                  )
                }),
                ...(themeIcon.dark && {
                  dark: getFilename(
                    `browser_action/${getBasename(themeIcon.dark)}`,
                    themeIcon.dark,
                    exclude
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
