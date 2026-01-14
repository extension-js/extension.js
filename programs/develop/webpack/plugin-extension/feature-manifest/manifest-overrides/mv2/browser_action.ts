// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto — presence implies inheritance

import * as path from 'path'
import {getFilename} from '../../manifest-lib/paths'
import {normalizeManifestOutputPath} from '../../normalize-manifest-path'
import {type Manifest} from '../../../../webpack-types'

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
                  const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                  const target = isPublic
                    ? normalizeManifestOutputPath(raw)
                    : `icons/${path.basename(raw)}`
                  return getFilename(target, raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.browser_action.default_icon as string
                  ).map(([size, icon]) => {
                    const raw = String(icon)
                    const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                    const target = isPublic
                      ? normalizeManifestOutputPath(raw)
                      : `icons/${path.basename(raw)}`
                    return [size, getFilename(target, raw)]
                  })
                )
        }),
        ...(manifest.browser_action.theme_icons && {
          theme_icons: manifest.browser_action.theme_icons.map(
            (themeIcon: {light: string; dark: string}) => {
              return {
                ...themeIcon,
                ...(themeIcon.light && {
                  light: (() => {
                    const raw = String(themeIcon.light)
                    const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                    const target = isPublic
                      ? normalizeManifestOutputPath(raw)
                      : `browser_action/${path.basename(raw)}`
                    return getFilename(target, raw)
                  })()
                }),
                ...(themeIcon.dark && {
                  dark: (() => {
                    const raw = String(themeIcon.dark)
                    const isPublic = /^(?:\/.+|(?:\.\/)?public\/)/i.test(raw)
                    const target = isPublic
                      ? normalizeManifestOutputPath(raw)
                      : `browser_action/${path.basename(raw)}`
                    return getFilename(target, raw)
                  })()
                })
              }
            }
          )
        })
      }
    }
  )
}
