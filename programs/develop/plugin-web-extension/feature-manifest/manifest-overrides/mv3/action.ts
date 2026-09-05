// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest, ThemeIcon} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {
  iconOutputPath,
  themeIconOutputPath
} from '../../normalize-manifest-path'

export function action(manifest: Manifest) {
  return (
    manifest.action && {
      action: {
        ...manifest.action,
        ...(manifest.action.default_popup && {
          default_popup: getFilename(
            `action/index.html`,
            manifest.action.default_popup as string
          )
        }),

        ...(manifest.action.default_icon && {
          default_icon:
            typeof manifest.action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.action.default_icon)
                  return getFilename(iconOutputPath(raw), raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.action.default_icon as Record<string, string>
                  ).map(([size, icon]) => {
                    const raw = String(icon)
                    return [size, getFilename(iconOutputPath(raw), raw)]
                  })
                )
        }),
        // Firefox MV3 action.theme_icons (light/dark toolbar icons) mirror
        // browser_action.theme_icons and land under action/.
        ...(manifest.action.theme_icons && {
          theme_icons: (manifest.action.theme_icons as ThemeIcon[]).map(
            (themeIcon) => ({
              ...themeIcon,
              ...(themeIcon.light && {
                light: getFilename(
                  themeIconOutputPath(String(themeIcon.light), 'action'),
                  String(themeIcon.light)
                )
              }),
              ...(themeIcon.dark && {
                dark: getFilename(
                  themeIconOutputPath(String(themeIcon.dark), 'action'),
                  String(themeIcon.dark)
                )
              })
            })
          )
        })
      }
    }
  )
}
