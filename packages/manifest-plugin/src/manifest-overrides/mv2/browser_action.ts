import {type ManifestData} from '../types'
import getFilename from '../../helpers/getFilename'

export default function getBrowserAction(
  manifest: ManifestData,
  exclude: string[]
) {
  return (
    manifest.browser_action && {
      browser_action: {
        ...manifest.browser_action,
        ...(manifest.browser_action.default_popup && {
          default_popup: getFilename(
            'browser_action',
            manifest.browser_action.default_popup,
            exclude
          )
        }),
        ...(manifest.browser_action.default_icon && {
          default_icon:
            typeof manifest.browser_action.default_icon === 'string'
              ? getFilename(
                  'browser_action',
                  manifest.browser_action.default_icon,
                  exclude
                )
              : Object.fromEntries(
                  Object.entries(manifest.browser_action.default_icon).map(
                    ([size, icon]) => {
                      return [
                        size,
                        getFilename('browser_action', icon as string, exclude)
                      ]
                    }
                  )
                )
        }),
        ...(manifest.browser_action.theme_icons && {
          theme_icons: manifest.browser_action.theme_icons.map(
            (themeIcon: {light: string; dark: string}) => {
              return {
                ...themeIcon,
                ...(themeIcon.light && {
                  light: getFilename('browser_action', themeIcon.light, exclude)
                }),
                ...(themeIcon.dark && {
                  dark: getFilename('browser_action', themeIcon.dark, exclude)
                })
              }
            }
          )
        })
      }
    }
  )
}
