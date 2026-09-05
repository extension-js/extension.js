// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {
  iconOutputPath,
  themeIconOutputPath
} from '../../normalize-manifest-path'

export function browserAction(manifest: Manifest) {
  return (
    manifest.browser_action && {
      browser_action: {
        ...manifest.browser_action,
        ...(manifest.browser_action.default_popup && {
          default_popup: getFilename(
            'action/index.html',
            manifest.browser_action.default_popup as string
          )
        }),
        ...(manifest.browser_action.default_icon && {
          default_icon:
            typeof manifest.browser_action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.browser_action.default_icon)
                  return getFilename(iconOutputPath(raw), raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.browser_action.default_icon as string
                  ).map(([size, icon]) => {
                    const raw = String(icon)
                    return [size, getFilename(iconOutputPath(raw), raw)]
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
                    themeIconOutputPath(
                      String(themeIcon.light),
                      'browser_action'
                    ),
                    String(themeIcon.light)
                  )
                }),
                ...(themeIcon.dark && {
                  dark: getFilename(
                    themeIconOutputPath(
                      String(themeIcon.dark),
                      'browser_action'
                    ),
                    String(themeIcon.dark)
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
