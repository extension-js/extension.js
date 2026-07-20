// ███╗   ███╗ █████╗ ███╗   ██╗██╗███████╗███████╗███████╗████████╗
// ████╗ ████║██╔══██╗████╗  ██║██║██╔════╝██╔════╝██╔════╝╚══██╔══╝
// ██╔████╔██║███████║██╔██╗ ██║██║█████╗  █████╗  ███████╗   ██║
// ██║╚██╔╝██║██╔══██║██║╚██╗██║██║██╔══╝  ██╔══╝  ╚════██║   ██║
// ██║ ╚═╝ ██║██║  ██║██║ ╚████║██║██║     ███████╗███████║   ██║
// ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝╚═╝     ╚══════╝╚══════╝   ╚═╝
// MIT License (c) 2020–present Cezar Augusto, presence implies inheritance

import type {Manifest} from '../../../../types'
import {getFilename} from '../../../shared/paths'
import {iconOutputPath} from '../../normalize-manifest-path'

export function sidebarAction(manifest: Manifest) {
  return (
    manifest.sidebar_action && {
      sidebar_action: {
        ...manifest.sidebar_action,
        ...(manifest.sidebar_action.default_panel && {
          default_panel: getFilename(
            `sidebar/index.html`,
            manifest.sidebar_action.default_panel as string
          )
        }),

        ...(manifest.sidebar_action.default_icon && {
          default_icon:
            typeof manifest.sidebar_action.default_icon === 'string'
              ? (() => {
                  const raw = String(manifest.sidebar_action.default_icon)
                  return getFilename(iconOutputPath(raw), raw)
                })()
              : Object.fromEntries(
                  Object.entries(
                    manifest.sidebar_action.default_icon as Record<
                      string,
                      string
                    >
                  ).map(([size, icon]) => {
                    const raw = String(icon)
                    return [size, getFilename(iconOutputPath(raw), raw)]
                  })
                )
        })
      }
    }
  )
}
